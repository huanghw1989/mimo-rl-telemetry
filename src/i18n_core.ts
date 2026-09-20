/**
 * Translation core: a cached, batched, retrying bridge between the Chinese
 * source material in this repository and its English rendering.
 *
 * Everything the project ships in two languages goes through `translateTexts`:
 *   · content/metrics.json     -> content/metrics.en.json
 *   · content/insights.json    -> content/insights.en.json
 *   · content/sources.json     -> content/sources.en.json
 *   · docs/zh-CN/*.md          -> docs/en/*.md
 *   · analysis/zh-CN markdown    -> analysis/en markdown
 *
 * Design notes
 * ------------
 * · A content-hash cache (`content/.i18n-cache.json`, gitignored) makes reruns
 *   cheap and keeps terminology stable: the same Chinese sentence is never
 *   translated twice, so repeated boilerplate comes out identical everywhere.
 * · Batches are bounded by character count, not item count, so one long metric
 *   explainer does not blow the context or the JSON budget.
 * · A batch whose reply cannot be parsed or does not line up is retried one
 *   string at a time; only the strings that really fail are reported.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatJson, mapPool, pickModel } from "./llm";
import { CONTENT } from "./paths";

const CACHE_PATH = join(CONTENT, ".i18n-cache.json");

/** Per-request ceiling. Reasoning models can be slow under load. */
const TIMEOUT_MS = 300_000;

/**
 * Glossary pinned in the prompt. Terminology consistency matters more than
 * stylistic variety here: the same concept must read the same on every page.
 */
const GLOSSARY = `
run / 轮次 -> run (keep the pro / flash run names untranslated)
step / 步 -> step (e.g. "第 17 步" -> "step 17")
trainer / 训练器 -> trainer
inference engine / 推理引擎 -> inference engine
sampler / 采样器 -> sampler
dynamic sampler / 动态采样器 -> dynamic sampler
grader / 判分 / 判分器 -> grader (verb: grade / grading)
grader group / 判分组 -> grader group
grader bucket / 判分档位 -> rubric tier; 档位分 -> rubric score
reward / 奖励 -> reward
advantage / 优势 -> advantage
rollout / rollout -> rollout
trajectory / 轨迹 -> trajectory
restart / 重启 -> restart
staleness / 过期程度 / 陈旧度 -> staleness
freshness / 新鲜度 -> freshness
bucket / 桶 -> bucket (as in freshness bucket)
wall clock / 墙钟 -> wall clock
machine time / 机时 -> machine time
token / token 数 -> token count
generation length / 生成长度 -> generation length
all-correct rate / 全对率 -> all-correct rate
trainable pool / 可训练池 -> trainable pool
task pool / 题池 -> task pool
carryover / 结转余量 -> carryover
accepted / 受理 -> accepted
in flight / 在途 -> in flight
data mix / 配比 -> data mix; 构成效应 -> composition effect
effective degrees of freedom / 有效自由度 -> effective degrees of freedom
principal component / 主成分 -> principal component
provenance / 溯源 -> provenance
citation / 引文 -> citation
insight / 洞察 -> insight
explainer / 解读 -> explainer
gap / 缺口 / 检索空白 -> gap / search gap
sentinel value / 哨兵值 -> sentinel value
breakpoint / 断点 -> breakpoint
identically zero / 恒为 0 -> identically zero
`.trim();

const SYSTEM = [
  "You are a senior technical translator working on a reinforcement-learning telemetry project.",
  "You translate Simplified Chinese into precise, natural English for ML systems engineers.",
  "You never summarise, never add emphasis the source lacks, and never drop a caveat.",
].join(" ");

function rules(count: number): string {
  return `Translate each of the ${count} Chinese strings below into English.

## Output
Return one JSON object: {"t": ["<translation 1>", "<translation 2>", ...]}.
The array MUST have exactly ${count} entries, in the same order as the input.
Output JSON only — no prose, no markdown fence, no commentary.

## Rules
1. Faithful: translate exactly what is there. Do not add "note that", "it is important", or any framing the source does not have.
2. Keep verbatim: metric tag names (critic/rewards/mean, partial/<k>/frac, dynsam/...), dataset ids, run names (pro, flash), model names, numbers, units, step numbers, URLs, file paths, code identifiers, and anything inside backticks.
3. Markdown, punctuation and structure must survive: keep **bold**, _italic_, \`code\`, [links](url), list markers, table pipes and newlines exactly as they are.
4. Numbers stay Arabic numerals. Do not convert units or recompute anything.
5. Metric explainers are technical and terse. Match that register; do not turn them into marketing prose.
6. Where a percent sign, a multiplication sign (×), a minus sign or an en dash appears, keep the same symbol.
7. Tokens of the form @@0@@, @@1@@, … are placeholders for code, links or inline markup. Copy them through exactly, unchanged, and in the same order they appear.
8. If a string is already English or is pure data (an id, a number, a URL), return it unchanged.

## Glossary (use these renderings consistently)
${GLOSSARY}`;
}

interface CacheFile {
  model?: string;
  entries?: Record<string, string>;
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

export class TranslationCache {
  private entries: Record<string, string> = {};
  private dirty = false;

  constructor(public model: string, public path: string = CACHE_PATH) {
    if (existsSync(this.path)) {
      try {
        const j = JSON.parse(readFileSync(this.path, "utf8")) as CacheFile;
        this.entries = j.entries ?? {};
      } catch {
        this.entries = {};
      }
    }
  }

  get(text: string): string | undefined {
    return this.entries[sha1(text)];
  }

  set(text: string, out: string): void {
    this.entries[sha1(text)] = out;
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    writeFileSync(
      this.path,
      JSON.stringify({ model: this.model, entries: this.entries }, null, 1) + "\n",
    );
    this.dirty = false;
  }

  get size(): number {
    return Object.keys(this.entries).length;
  }
}

export interface TranslateOptions {
  model?: string;
  /** Max characters of source text per request. */
  budget?: number;
  concurrency?: number;
  /** Re-translate even when the cache has an answer. */
  force?: boolean;
  quiet?: boolean;
  /** Called after each batch settles, for progress reporting. */
  onProgress?: (done: number, total: number) => void;
  /** Cache file to use. Separate scopes must use separate files or they clobber each other. */
  cachePath?: string;
}

/** True when a string actually needs translating (has Han characters). */
export function needsTranslation(s: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
}

/**
 * Translate a list of strings, preserving order and identity of already-English
 * entries. Cached per source string, so reruns only pay for new material.
 */
export async function translateTexts(texts: string[], opts: TranslateOptions = {}): Promise<string[]> {
  const cache = new TranslationCache(pickModel(opts.model), opts.cachePath);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const budget = Math.max(400, opts.budget ?? 2600);

  /* Work out which distinct strings still need a model call. */
  const pending = new Set<string>();
  for (const t of texts) {
    if (!needsTranslation(t)) continue;
    if (!opts.force && cache.get(t) != null) continue;
    pending.add(t);
  }
  const total = pending.size;

  const batches = packBatches([...pending], budget);
  let done = 0;
  const say = (s: string) => {
    if (!opts.quiet) console.log(s);
  };
  if (total) say(`  ${total} strings to translate, ${batches.length} batch(es), concurrency ${concurrency}`);

  await mapPool(batches, concurrency, async (batch) => {
    try {
      const out = await chatJson<{ t: unknown }>(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${rules(batch.length)}\n\n## Input\n${JSON.stringify(batch, null, 1)}` },
        ],
        { model: cache.model, temperature: 0, timeoutMs: TIMEOUT_MS },
      );
      const arr = Array.isArray(out.t) ? out.t : null;
      if (!arr || arr.length !== batch.length) throw new Error(`expected ${batch.length} items, got ${arr ? arr.length : "none"}`);
      for (let i = 0; i < batch.length; i++) {
        const v = arr[i];
        if (typeof v !== "string" || !v.trim()) throw new Error(`item ${i} came back empty`);
        cache.set(batch[i], v);
      }
    } catch (e) {
      /* Fall back to one-at-a-time so a single bad string cannot poison a batch. */
      say(`  ! batch of ${batch.length} failed (${(e as Error).message}); retrying individually`);
      for (const one of batch) {
        try {
          const out = await chatJson<{ t: unknown }>(
            [
              { role: "system", content: SYSTEM },
              { role: "user", content: `${rules(1)}\n\n## Input\n${JSON.stringify([one])}` },
            ],
            { model: cache.model, temperature: 0, timeoutMs: TIMEOUT_MS },
          );
          const arr = Array.isArray(out.t) ? out.t : [];
          const v = arr[0];
          if (typeof v === "string" && v.trim()) cache.set(one, v);
          else console.warn(`  !! could not translate: ${one.slice(0, 80)}`);
        } catch (e2) {
          console.warn(`  !! could not translate (${(e2 as Error).message}): ${one.slice(0, 80)}`);
        }
      }
    }
    done += batch.length;
    /* Persist as we go: a long run that dies halfway should not lose the
       batches that already succeeded. */
    cache.save();
    opts.onProgress?.(done, total);
  });

  cache.save();

  return texts.map((t) => (needsTranslation(t) ? cache.get(t) ?? t : t));
}

/** Greedy packer: keep each batch under `budget` characters. */
function packBatches(items: string[], budget: number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && size + it.length > budget) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* --------------------------------------------------------------- JSON walking */

/**
 * Keys whose values are identifiers, not prose. They are copied through
 * untouched even if they happen to contain Han characters.
 */
export const STRUCTURAL_KEYS = new Set(["id", "ref", "url", "kind", "stance", "from", "schema_version"]);

function walkStrings(
  v: unknown,
  skip: Set<string>,
  visit: (s: string, parent: Record<string, unknown> | null, key: string) => void,
  parent: Record<string, unknown> | null = null,
  key = "",
): void {
  /* A bare string inherits its parent's key, so arrays of prose (`read`,
     `traps`, `body`, `groups`) are handled exactly like object fields. */
  if (typeof v === "string") {
    if (!skip.has(key) && needsTranslation(v)) visit(v, parent, key);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) walkStrings(x, skip, visit, parent, key);
    return;
  }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      walkStrings(val, skip, visit, v as Record<string, unknown>, k);
    }
  }
}

/** Every Chinese string in a JSON document, in traversal order, deduplicated. */
export function collectTranslatable(value: unknown, skip: Set<string> = STRUCTURAL_KEYS): string[] {
  const seen = new Set<string>();
  walkStrings(value, skip, (s) => seen.add(s));
  return [...seen];
}

/** Deep-clone `value`, replacing every translatable string through `lookup`. */
export function mapTranslatable(
  value: unknown,
  lookup: (s: string) => string,
  skip: Set<string> = STRUCTURAL_KEYS,
): unknown {
  const walk = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") return !skip.has(key) && needsTranslation(v) ? lookup(v) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val, k);
      return o;
    }
    return v;
  };
  return walk(value);
}

/* ------------------------------------------------------- documentation paths */

/**
 * Chinese -> English filename map for the documentation and analysis trees.
 * Shared by the docs translator (to name the English files) and by the content
 * translator (to rewrite the Chinese file references that appear inside
 * explainer prose, which the model faithfully copies through).
 */
export const DOC_SLUGS: Record<string, string> = {
  // docs
  "01-网站数据文档.md": "01-dashboard-data.md",
  "02-本地遥测与同步机制.md": "02-architecture-and-sync.md",
  "03-采样器表格字段口径考证.md": "03-sampler-table-caliber.md",
  // analysis notes
  "01-站点地图与数据来源.md": "01-site-map-and-data-sources.md",
  "02-指标清单.md": "02-metric-inventory.md",
  "03-指标时间线.md": "03-metric-timeline.md",
  "04-观测记录.md": "04-observation-log.md",
  "05-数值核查与派生量.md": "05-identity-checks-and-derived-quantities.md",
  "06-读看板容易踩的坑.md": "06-pitfalls-when-reading-the-dashboard.md",
  "07-flash停止与资源配比解读.md": "07-flash-stop-and-resource-mix.md",
  "08-生成长度突增解读.md": "08-generation-length-surge.md",
  "09-生成长度相关性分析.md": "09-generation-length-correlation.md",
  "10-指标空间与潜在因子.md": "10-metric-space-and-latent-factors.md",
  "11-逐数据集异质性.md": "11-per-dataset-heterogeneity.md",
  "12-奖励与判分结构.md": "12-reward-and-grading-structure.md",
  "13-异步管线与机时账.md": "13-async-pipeline-and-machine-time.md",
  "14-评测可信度与饱和预测.md": "14-benchmark-credibility-and-saturation.md",
  "15-指标可信度审计.md": "15-metric-credibility-audit.md",
  "research-A-RL指标含义调研.md": "research-A-rl-metric-semantics.md",
  "research-B-中文从业者经验.md": "research-B-chinese-practitioner-notes.md",
  "research-C-国内社区解读.md": "research-C-chinese-community.md",
  "research-C-国外一线解读.md": "research-C-english-community.md",
  "260919-Gemini回答.md": "260919-gemini-reply.md",
  // analysis reports
  "A1-看板数据解读.md": "A1-dashboard-walkthrough.md",
  "A2-训练洞察-第1期.md": "A2-training-insights-1.md",
  "A2-训练洞察-第2期.md": "A2-training-insights-2.md",
  "A2-训练洞察-第3期.md": "A2-training-insights-3.md",
  "A3-bench-judgement-table.md": "A3-bench-judgement-table.md",
};
/** Basenames only, for lookups that have to ignore the directory prefix. */
export const DOC_SLUG_BY_BASENAME: Record<string, string> = DOC_SLUGS;

/**
 * Rewrite references to Chinese-source documents into their English paths.
 * Handles `docs/zh-CN/01-….md`, `docs/01-….md`, `notes/08-….md`,
 * `analysis/zh-CN/notes/08-….md`, and bare filenames.
 */
export function localizeDocPaths(s: string): string {
  return s.replace(/[A-Za-z0-9_\-\/]*[\u4e00-\u9fff][^\s`<>"'()\[\]，。、）]*\.md/g, (whole: string) => {
    const basename = whole.split("/").pop() ?? whole;
    const slug = DOC_SLUGS[basename];
    if (!slug) return whole;
    const dir = whole.slice(0, whole.length - basename.length);
    if (/notes\/$/.test(dir)) return `analysis/en/notes/${slug}`;
    if (/reports\/$/.test(dir)) return `analysis/en/reports/${slug}`;
    if (/docs\/(zh-CN\/)?$/.test(dir)) return `docs/en/${slug}`;
    if (/analysis\/zh-CN\/$/.test(dir)) return `analysis/en/${slug}`;
    return `docs/en/${slug}`;
  });
}
