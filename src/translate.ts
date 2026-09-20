/**
 * 原站公告的自动翻译：把仓库里还没有中文译文的公告翻出来，写进 content/notices.zh.json。
 *
 * 用法（都从项目根目录跑）：
 *   bun run telemetry:translate                只翻"新增"和"原文已更新"的
 *   bun run telemetry:translate --force        全部重翻（人工译文也会被覆盖）
 *   bun run telemetry:translate --dry-run      只调模型、打印结果，不写文件
 *
 * 常用开关：
 *   --model=<id>       override TEXT_MODEL (default: gpt-5.6-luna)
 *   --batch=<n>        一个请求里最多塞几条公告（默认 8）
 *   --concurrency=<n>  同时在跑的请求数（默认 2）
 *   --limit=<n>        本次最多翻几条（调试用）
 *   --print-prompt     把发给模型的 prompt 原样打出来
 *
 * 模型走 env（和 scripts/image_prompt.py 同一个通路）：
 *   OPENAI_BASE_URL / OPENAI_API_KEY are required; TEXT_MODEL is optional (default gpt-5.6-luna).
 *
 * 为什么要有这个脚本：sync.ts 只负责把公告搬进仓库，翻译是另一件事。
 * 公告是英文的，读者是中文的工程师，而模型（尤其模型名、数据集名、GPU OOM / VRAM 这类
 * 缩略语）翻错了比不翻更麻烦，所以 prompt 里把"保留英文"和"地道译法"两件事都写死了，
 * 并附了两条人工译文的示范。人工译文如果比模型好，直接改 content/notices.zh.json 即可，
 * 脚本不会覆盖它——除非原文变了（en 对不上）或者显式 --force。
 */
import { chatJson, chunk, mapPool, pickModel } from "./llm";
import { NOTICES_ZH_JSON } from "./paths";
import { readEvents, readMeta, readNotices } from "./store";
import { bj, withRetry, writeJson } from "./util";

/* ------------------------------------------------------------------ 命令行 */

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const flag = (name: string) => process.argv.slice(2).includes(`--${name}`);
const num = (name: string, dflt: number) => {
  const v = Number(arg(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
};

/* ------------------------------------------------------------------ prompt */

/** 保留英文原样的词：翻错了读者反而要去猜。 */
const KEEP_EN = `
- 轮次 / 模型代号：pro、flash、mimo-v2.6-pro（原文怎么写就怎么抄，不要译成"专业版""闪电版"）
- 数据集与评测名：cyber、DeepSWE、MIMO
- 硬件与系统缩略语：GPU OOM、VRAM
- 组件与流程名：expert、grader、rollout。这三个都保留英文，但前两个有通行中文译法，
  首次出现写成"中文（英文）"：experts → 专家（expert）、grader → 判分（grader），
  同一条里再出现就只写中文；rollout 没有通行中文译法，直接写 rollout
`.trim();

/** 逐字硬译会很别扭的说法，给死译法。 */
const GLOSSARY = `
| 英文 | 地道译法 |
| --- | --- |
| step 17 / at step 17 | 第 17 步 / 在第 17 步（不要译成"步骤 17"） |
| restart from step 15 | 从第 15 步重启（"at step N" 是"在第 N 步"、"from step N" 是"从第 N 步"，别混） |
| the pro run / this run | pro 这一轮 / 这一轮（run 是"训练轮次"，不是"运行"） |
| restart the run / the run is restarting | 重启这一轮 / 这一轮正在重启 |
| training cluster | 训练集群 |
| grader deployment | 判分服务 |
| network connectivity issue | 网络连通性故障 |
| GPU OOM issue | 显存溢出（GPU OOM） |
| vram issue | 显存（VRAM）问题 |
| expert load imbalance | 专家（expert）负载不均衡 |
| training parallelism strategy | 训练的并行策略 |
| infra error | 基础设施报错 |
| was not correctly detected | 没有被正确识别出来 |
| bad patterns in the rollout logs | rollout 日志里的异常模式 |
| remove X from the upcoming run | 把 X 从后续批次里去掉了 |
| offline evaluation results | 离线评测结果 |
| results（评测语境） | 成绩 |
| we will keep posting | 后续会继续更新 |
| due to | 因为 / 由于（口语用"因为"） |
| node | 节点 |
| dataset | 数据集 |
`.trim();

/**
 * 两条人工译文当示范，把语气和断句钉死。
 * 选这两条是因为它们各自代表一类公告（故障重启 / 成绩更新），
 * 且剩下的公告和它们措辞不重合，拿来做验证不会被 prompt 泄题。
 */
const EXAMPLES = [
  {
    in: "the mimo-v2.6-pro run is restarting due to a vram issue on one node.",
    out: "mimo-v2.6-pro 这一轮正在重启：某个节点出现显存（VRAM）问题。",
  },
  {
    in: "we have updated the latest deepswe results for flash step 12 & pro step 8. we will keep posting as the offline evaluation results come out.",
    out: "我们更新了最新的 DeepSWE 成绩：flash 第 12 步、pro 第 8 步。后续离线评测结果出来会继续更新。",
  },
];

const SYSTEM = "你是资深技术翻译，长期翻译机器学习训练系统的工程公告，中文表达地道、克制。";

function buildPrompt(batch: { id: string; text: string }[]): string {
  const examples = EXAMPLES.map(
    (e) => `输入：{"id":"x","text":${JSON.stringify(e.in)}}\n输出：{"x":${JSON.stringify(e.out)}}`,
  ).join("\n\n");
  return `把下面的英文训练公告翻译成中文。读者是懂技术的同事，译文要像工程师在群里同步进展，不要书面腔。

## 输出格式
只输出一个 JSON 对象：{"<id>": "<中文译文>"}。每条公告一个 key，id 原样照抄。
不要输出解释、不要 markdown 代码块、不要加别的话。

## 翻译要求
1. 忠实：不增不减。原文没说"因此""请注意""建议"，译文就不要加；原文用 we，译文用"我们"。
2. 简洁：一句话能说完就别拆成两句，不堆形容词；同一句里不要反复出现"我们"。
3. 语气照原文：原文是"we have adjusted"，译"我们已经调整了"，不要译得比原文更肯定或更委婉。
4. 标点：中文全角（，。：；、（）），数字 / 英文 / 专有名词用半角；句末用。结尾。
5. 中英文之间留一个半角空格："第 17 步""约 3 小时""flash 第 12 步"。
6. 数字、时间、步号、版本号、URL、id 原样保留（"~3 hours" → "约 3 小时"）。
7. 专有名词拿不准就保留英文，不要音译、不要自己编中文名。

## 保留英文不译
${KEEP_EN}

## 术语与地道译法
${GLOSSARY}

## 示范
${examples}

## 待翻译
${JSON.stringify(batch, null, 1)}`;
}

/* -------------------------------------------------------------------- 调用 */

/** One batched translation round trip. Results are keyed by notice id. */
async function callModel(model: string, prompt: string): Promise<Record<string, string>> {
  const parsed = await chatJson<Record<string, unknown>>(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    { model },
  );
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v.trim();
  return out;
}

/** 译文体检：空的、没中文的、和原文一模一样的，都算翻失败，宁可让调用方重试一次。 */
function checkTranslation(id: string, en: string, zh: string | undefined): string {
  if (!zh) throw new Error(`${id} returned no translation`);
  if (!/[\u4e00-\u9fff]/.test(zh)) throw new Error(`${id} translation contains no Chinese: ${zh.slice(0, 60)}`);
  if (zh.trim().toLowerCase() === en.trim().toLowerCase()) throw new Error(`${id} translation is identical to the original`);
  return zh;
}

/* -------------------------------------------------------------- 公告与步号 */

/** 每个 step 取最后一次完成时刻（重跑会覆盖前一次），按时间升序。口径与页面一致。 */
function stepTimeline(events: { kind: string; step?: number; t: number }[]): { step: number; t: number }[] {
  const byStep = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== "step" || e.step == null || e.t == null) continue;
    byStep.set(e.step, e.t);
  }
  return [...byStep.entries()].map(([step, t]) => ({ step, t })).sort((a, b) => a.t - b.t);
}

/** 公告发布时"已完成第几步" = 完成时刻不晚于它的最大步号。 */
function stepAt(timeline: { step: number; t: number }[], t: number): number | null {
  let best: number | null = null;
  for (const s of timeline) if (s.t <= t && (best == null || s.step > best)) best = s.step;
  return best;
}

/** 一条公告在各界面上看到的步号徽标，打印出来方便同步时对一眼。 */
function stepBadges(t: number): string {
  const meta = readMeta();
  const runs: any[] = meta?.runs ?? [];
  if (!runs.length) return "";
  return runs
    .map((r) => {
      const s = stepAt(stepTimeline(readEvents(r.key)), t);
      return `${r.key}@${s == null ? "—" : "s" + s}`;
    })
    .join("  ");
}

/* -------------------------------------------------------------------- 主逻辑 */

interface Job {
  id: string;
  text: string;
  why: "new" | "original updated" | "retranslate";
}

interface ZhFile {
  note?: string;
  updated_at?: string;
  items?: Record<string, { en?: string; zh?: string } | string>;
}

const FILE_NOTE =
  "原站 notices 的中文翻译。key 是公告 id；en 是写这条翻译时的英文原文，用来检测原文是否被改过" +
  "（对不上时页面会标出来，但仍按 id 用这份译文）。新增公告如果这里没有，页面回落到英文并标「未翻译」。" +
  "这份文件由 src/translate.ts 自动补全新公告；人工改过的译文不会被覆盖，除非原文变了。";

function readZhFile(): ZhFile {
  if (!existsSync(NOTICES_ZH_JSON)) return { items: {} };
  try {
    return JSON.parse(readFileSync(NOTICES_ZH_JSON, "utf8")) as ZhFile;
  } catch (e) {
    throw new Error(`failed to parse content/notices.zh.json: ${(e as Error).message}`);
  }
}

/** 挑出这一轮要翻的公告：没译文的、原文改过的、（--force 时）全部。 */
function pickJobs(notices: { id: string; t: number; text: string }[], zh: ZhFile, force: boolean, limit: number): Job[] {
  const jobs: Job[] = [];
  for (const n of notices) {
    const cur = zh.items?.[n.id];
    const en = typeof cur === "string" ? undefined : cur?.en;
    const val = typeof cur === "string" ? cur : cur?.zh;
    if (force) jobs.push({ id: n.id, text: n.text, why: "retranslate" });
    else if (!val || !String(val).trim()) jobs.push({ id: n.id, text: n.text, why: "new" });
    else if (en && en.trim() !== String(n.text).trim()) jobs.push({ id: n.id, text: n.text, why: "original updated" });
    if (limit && jobs.length >= limit) break;
  }
  return jobs;
}

export interface TranslateResult {
  /** 这一轮真的翻出来的条数。 */
  translated: number;
  /** 其中原文被改过、需要重翻的条数。 */
  stale: number;
  /** 仓库里的公告总数。 */
  total: number;
  /** 翻失败的条数（失败的条目不会写进文件，下次同步会重试）。 */
  failed: number;
}

export interface TranslateOptions {
  force?: boolean;
  dryRun?: boolean;
  model?: string;
  batch?: number;
  concurrency?: number;
  limit?: number;
  printPrompt?: boolean;
  quiet?: boolean;
}

export async function translateNotices(opts: TranslateOptions = {}): Promise<TranslateResult> {
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const batchSize = opts.batch ?? num("batch", 8);
  const concurrency = opts.concurrency ?? num("concurrency", 2);
  const limit = opts.limit ?? num("limit", 0);
  const model = pickModel(opts.model ?? arg("model"));
  const say = (s: string) => {
    if (!opts.quiet) console.log(s);
  };

  const notices = (readNotices() as { id: string; t: number; text: string }[]).slice().sort((a, b) => b.t - a.t);
  const zh = readZhFile();
  const jobs = pickJobs(notices, zh, force, limit);

  if (!notices.length) {
    say("no notices in the repo yet; run a sync first");
    return { translated: 0, stale: 0, total: 0, failed: 0 };
  }
  if (!jobs.length) {
    say(`notice translations are up to date (${notices.length} entries; nothing new, no originals changed)`);
    return { translated: 0, stale: 0, total: notices.length, failed: 0 };
  }

  const batches = chunk(jobs, batchSize);
  say(
    `model ${model}: ${jobs.length}/${notices.length} to translate` +
      ` (new ${jobs.filter((j) => j.why === "new").length}, original updated ${jobs.filter((j) => j.why === "original updated").length}` +
      `, retranslate ${jobs.filter((j) => j.why === "retranslate").length}), ${batches.length} batches x up to ${batchSize} entries, concurrency ${concurrency}`,
  );

  const results: Record<string, string> = {};
  const failures: { id: string; why: string }[] = [];
  await mapPool(batches, concurrency, async (b, i) => {
    const prompt = buildPrompt(b.map((j) => ({ id: j.id, text: j.text })));
    if (opts.printPrompt && i === 0) say(`\n----- prompt (batch 1) -----\n${prompt}\n----- end of prompt -----`);
    try {
      const reply = await withRetry(`translation batch ${i + 1} (${b.map((j) => j.id).join(", ")})`, () => callModel(model, prompt));
      for (const j of b) {
        try {
          results[j.id] = checkTranslation(j.id, j.text, reply[j.id]);
        } catch (e) {
          failures.push({ id: j.id, why: (e as Error).message });
        }
      }
      say(`  batch ${i + 1}/${batches.length} returned: ${b.map((j) => j.id).join(", ")}`);
    } catch (e) {
      for (const j of b) failures.push({ id: j.id, why: (e as Error).message });
      console.warn(`  !! batch ${i + 1}/${batches.length} failed: ${(e as Error).message}`);
    }
  });

  const byId = new Map(notices.map((n) => [n.id, n]));
  for (const j of jobs) {
    const zhText = results[j.id];
    if (!zhText) continue;
    const n = byId.get(j.id)!;
    say(`  [${j.why}] ${j.id}  ${bj(n.t).slice(5, 16)}  ${stepBadges(n.t)}`);
    say(`        ${zhText}`);
  }

  const translated = Object.keys(results).length;
  if (failures.length) {
    console.warn(`  !! ${failures.length} entries not translated; the next sync will retry:`);
    for (const f of failures) console.warn(`     ${f.id}: ${f.why}`);
  }

  if (!dryRun) {
    /* 合并：已有的条目原样保留（人工改过的译文不能因为翻别的公告而被覆盖），
       新条目的 key 依公告时间从新到旧排，和页面上的顺序一致。 */
    const items: Record<string, { en: string; zh: string }> = {};
    const old = zh.items ?? {};
    for (const n of notices) {
      const cur = old[n.id];
      const val = typeof cur === "string" ? cur : cur?.zh;
      const en = typeof cur === "string" ? undefined : cur?.en;
      if (results[n.id]) items[n.id] = { en: n.text, zh: results[n.id] };
      else if (val) items[n.id] = { en: en ?? n.text, zh: String(val) };
    }
    writeJson(NOTICES_ZH_JSON, {
      note: zh.note || FILE_NOTE,
      updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      items,
    });
    say(`wrote content/notices.zh.json: +${translated} entries, ${Object.keys(items).length} total`);
  } else {
    say(`--dry-run: ${translated} translations not written to disk`);
  }

  return {
    translated,
    stale: jobs.filter((j) => j.why === "original updated").length,
    total: notices.length,
    failed: failures.length,
  };
}

if (import.meta.main) {
  translateNotices({
    force: flag("force"),
    dryRun: flag("dry-run"),
    printPrompt: flag("print-prompt"),
  }).then(
    (r) => process.exit(r.failed ? 1 : 0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
