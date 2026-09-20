#!/usr/bin/env bun
/**
 * merge_insights.ts
 * 把子智能体产出的"候选洞察"合并进看板的数据洞察（`content/insights.json`）与溯源登记表
 * （`content/sources.json`）。
 *
 *   bun src/merge_insights.ts            # 合并
 *   bun src/merge_insights.ts --check    # 只报告会改什么
 *
 * 输入：`analysis/zh-CN/numbers/A3-candidates-*.json`（每个子智能体一个文件）
 *   每项形如 {id, kind, title, summary, body[], facts[], source:{id,title,venue,quote,topic}}
 *
 * 为什么要有这一步：子智能体只允许产出"候选"，正文措辞、条数、与已有洞察的去重都由人把关。
 * 这个脚本负责机械的部分（字段校验、id 去重、忠实写入两份 JSON），不负责判断哪条值得收 ——
 * 所以每轮实际收了哪几条，另由人工在 README / 笔记里记明。
 *
 * 幂等：已存在的洞察 id 与来源 id 都会跳过，所以可以重复跑。
 *
 * 注意：insights.json / sources.json 里**不能用半角双引号写中文引号**（会把字符串提前截断），
 * 这个脚本用 JSON.stringify 写出，天然安全。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ANALYSIS = resolve(ROOT, "analysis", "zh-CN", "numbers");
const INSIGHTS = resolve(ROOT, "content", "insights.json");
const SOURCES = resolve(ROOT, "content", "sources.json");
const CHECK = process.argv.includes("--check");

const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const jwrite = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n");

/** 只认这几个 kind，和 sources.ts 的 SOURCE_KINDS / 页面上的分组保持一致。 */
const INSIGHT_KINDS = new Set(["structural", "counterintuitive", "method", "numeric"]);

const problems: string[] = [];

/* ---------------------------------------------------------------- 收候选 */

const files = existsSync(ANALYSIS) ? readdirSync(ANALYSIS).filter((f) => /^A3-candidates-.*\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error(`no candidate files found: ${ANALYSIS}/A3-candidates-*.json`);
  process.exit(1);
}

const candidates: any[] = [];
for (const f of files) {
  let arr: any;
  try {
    arr = jread(resolve(ANALYSIS, f));
  } catch (e) {
    problems.push(`${f} failed to parse: ${(e as Error).message}`);
    continue;
  }
  if (!Array.isArray(arr)) {
    problems.push(`${f} is not an array`);
    continue;
  }
  for (const c of arr) {
    for (const k of ["id", "kind", "title", "summary", "body", "facts", "source"]) {
      if (c[k] == null) problems.push(`${f} · ${c.id ?? "(no id)"} missing field ${k}`);
    }
    if (c.kind && !INSIGHT_KINDS.has(c.kind)) problems.push(`${f} · ${c.id}: kind "${c.kind}" is not in the allowed list`);
    if (!Array.isArray(c.body) || !c.body.length) problems.push(`${f} · ${c.id}: body is not a non-empty array`);
    if (!Array.isArray(c.facts) || !c.facts.length) problems.push(`${f} · ${c.id}: facts is not a non-empty array`);
    if (!c.source?.quote) problems.push(`${f} · ${c.id}: source has no quote (readers must be able to recompute from it)`);
    candidates.push({ ...c, __file: f });
  }
  console.log(`  ${f}  ${arr.length} candidates`);
}

/* ---------------------------------------------------------------- 读现状 */

const insights = jread(INSIGHTS);
const sources = jread(SOURCES);
const haveInsight = new Set((insights.items ?? []).map((x: any) => x.id));
const INSIGHT_SOURCE_FIELD = "sources";   // resolveSources 只认这个字段名
const haveSource = new Set((sources.items ?? []).map((x: any) => x.id));
/** 同一个来源 id 被多条候选引用时，若 quote 不同就各留一条（id-2、id-3…），
    否则会丢掉后面几条的复算口径。 */
const sourceQuote = new Map<string, string>();
for (const s of sources.items ?? []) sourceQuote.set(s.id, s.quote ?? "");

function uniqueSourceId(base: string, quote: string): string {
  if (!sourceQuote.has(base) && !haveSource.has(base)) return base;
  if (sourceQuote.get(base) === quote) return base;   // 同一条来源，复用
  let i = 2;
  while (sourceQuote.has(`${base}-${i}`) || haveSource.has(`${base}-${i}`)) {
    if (sourceQuote.get(`${base}-${i}`) === quote) return `${base}-${i}`;
    i++;
  }
  return `${base}-${i}`;
}

/* ---------------------------------------------------------------- 合并 */

const addedInsights: string[] = [];
const addedSources: string[] = [];

for (const c of candidates) {
  if (haveInsight.has(c.id)) continue;             // 幂等：已有就跳过
  const sid = uniqueSourceId(c.source.id, c.source.quote);
  if (!haveSource.has(sid) && !sourceQuote.has(sid)) {
    sources.items.push({
      id: sid,
      kind: "self",                                 // 都是我们自己在遥测仓库上的核算
      title: c.source.title,
      venue: c.source.venue,
      year: "2026",
      quote: c.source.quote,
      topic: c.source.topic,
    });
    haveSource.add(sid);
    sourceQuote.set(sid, c.source.quote);
    addedSources.push(sid);
  }
  insights.items.push({
    id: c.id,
    kind: c.kind,
    title: c.title,
    summary: c.summary,
    body: c.body,
    facts: c.facts,
    /* 字段名必须是 sources（不是 refs）：sources.ts 的 resolveSources 只认 entry.sources，
       写错的话每条洞察都会退化成只有兜底的 site-store 来源，而且不报错。 */
    sources: [{ ref: sid, stance: "support", note: "本条洞察的核算依据；复算口径与关键数字见引文" }],
  });
  haveInsight.add(c.id);
  addedInsights.push(c.id);
}

/* 观测窗口：这批洞察覆盖到最新一步，不再是上一轮那个窗口。 */
const window_ = {
  label: "2026-09-16 00:02Z ~ 2026-09-19 08:58Z",
  note:
    "覆盖两次训练各自全部已完成的步：pro 24 步、flash 30 步（flash 训练已结束）。" +
    "上一轮窗口停在 pro 第 19 步 / flash 第 26 步，这一轮把窗口推到当前最新的数据。" +
    "每条洞察的证据强度在正文里另行标注。",
  pro_step: 24,
  flash_step: 30,
};

console.log(`\n${candidates.length} candidates → ${addedInsights.length} new insights, ${addedSources.length} new sources`);
if (addedInsights.length) console.log("  " + addedInsights.join("\n  "));

if (problems.length) {
  console.error(`\n× ${problems.length} problems:`);
  problems.slice(0, 30).forEach((p) => console.error("  · " + p));
  if (!CHECK) {
    console.error("\nproblems found; no file written.");
    process.exit(1);
  }
}

insights.window = window_;
insights.updated_at = Math.floor(Date.now() / 1000);
sources.updated_at = insights.updated_at;

if (CHECK) {
  console.log("\n--check: report only, no file written.");
} else {
  jwrite(INSIGHTS, insights);
  jwrite(SOURCES, sources);
  console.log(`\nwrote:\n  ${INSIGHTS} (${insights.items.length} items)\n  ${SOURCES} (${sources.items.length} items)`);
  console.log("next: bun run mimo:content && bun run mimo:export");
}
