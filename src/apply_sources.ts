/**
 * 把调研结果（content/_research/*.json）里的 attaches 合并进内容条目。
 *
 *   bun src/apply_sources.ts [--check]
 *
 * 为什么要有这一步：调研子智能体只被允许输出**登记表里的 ref**（`{ref, stance, note}`），
 * 不允许自己写 URL。这样"来源"的可信度只取决于登记表，而登记表是人工核验过的。
 * 这个脚本负责把 attaches 落到 `content/_draft/*.json` 与 `content/insights.json` 上。
 *
 * 落点规则：
 *   · metric 命中草稿条目 → 写进那一条；
 *   · metric 命中 insights.json 的洞察 → 写进那一条；
 *   · metric 是被构建时归并掉的族 id（dynsam/<cat>/dataset-<id>/num_accepted/<kind>）：
 *     写到该后缀下所有数据集条目上，构建时按 ref 取并集，最终落在族条目上；
 *   · 其余命中不了的 → 报出来，人工处理（宁可不挂，也不要挂错）。
 *
 * --check 只报告不写文件。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT, INSIGHTS_JSON } from "./paths";
import { SOURCE_STANCES } from "./sources";

const CHECK_ONLY = process.argv.includes("--check");
const DRAFT = join(CONTENT, "_draft");
const RESEARCH = join(CONTENT, "_research");
const NUM_ACC = /^(dynsam\/([^/]+)\/dataset-([^/]+)\/num_accepted\/(step|held|carryover))$/;

type Attach = { metric: string; ref: string; stance: string; note: string; from: string };

function loadJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

/* ------------------------------------------------------- 1. 收集 attaches */
if (!existsSync(RESEARCH)) {
  console.error(`no research directory ${RESEARCH}; have the subagents write content/_research/*.json first`);
  process.exit(1);
}
const researchFiles = readdirSync(RESEARCH).filter((f) => f.endsWith(".json")).sort();
if (!researchFiles.length) {
  console.error(`no json under ${RESEARCH}`);
  process.exit(1);
}

const attaches: Attach[] = [];
const problems: string[] = [];
const seen = new Set<string>();
let sourceCount = 0;

for (const f of researchFiles) {
  let j: any;
  try {
    j = loadJson(join(RESEARCH, f));
  } catch (e) {
    problems.push(`${f} is not valid JSON: ${(e as Error).message}`);
    continue;
  }
  for (const src of j.items ?? []) {
    sourceCount++;
    if (!src.id) { problems.push(`${f}: one source has no id`); continue; }
    /* self（我们自己的核算）没有外部链接是正常的，不当作问题 */
    if (!src.url && src.kind !== "self" && src.kind !== "data") problems.push(`${f}: source ${src.id} has no url`);
    if (!src.quote) problems.push(`${f}: source ${src.id} has no verbatim quote`);
    let n = 0;
    for (const a of src.attaches ?? []) {
      n++;
      const metric = String(a.metric ?? "");
      const stance = String(a.stance ?? "context");
      const note = String(a.note ?? "").trim();
      if (!metric) { problems.push(`${src.id}: an attach has no metric`); continue; }
      if (!SOURCE_STANCES.has(stance)) problems.push(`${src.id} → ${metric}: invalid stance "${stance}"`);
      if (!note) problems.push(`${src.id} → ${metric}: empty note`);
      const key = metric + "\u0000" + src.id;
      if (seen.has(key)) { problems.push(`${src.id} → ${metric}: duplicate, keeping the first only`); continue; }
      seen.add(key);
      attaches.push({ metric, ref: src.id, stance, note, from: f });
    }
    if (!n) problems.push(`${f}: source ${src.id} attaches to no metric (effectively dropped)`);
  }
  for (const g of j.gaps ?? []) problems.push(`[gap · ${f}] ${g}`);
}
console.log(`read ${researchFiles.length} research files: ${sourceCount} sources, ${attaches.length} attaches`);

/* ------------------------------------- 2. 落到草稿条目与洞察条目上 */
const byMetric = new Map<string, Attach[]>();
for (const a of attaches) {
  if (!byMetric.has(a.metric)) byMetric.set(a.metric, []);
  byMetric.get(a.metric)!.push(a);
}

/** 已有 sources 时不覆盖已有 ref，只补齐。 */
function mergeSources(entry: any, list: Attach[]): number {
  if (!Array.isArray(entry.sources)) entry.sources = [];
  const have = new Set(entry.sources.map((s: any) => (typeof s === "string" ? s : s?.ref)));
  let added = 0;
  for (const a of list) {
    if (have.has(a.ref)) continue;
    have.add(a.ref);
    entry.sources.push({ ref: a.ref, stance: a.stance, note: a.note });
    added++;
  }
  return added;
}

const unmatched = new Set(byMetric.keys());
let touchedEntries = 0;
let addedTotal = 0;
const changedFiles: string[] = [];

for (const f of readdirSync(DRAFT).filter((x) => x.endsWith(".json")).sort()) {
  const p = join(DRAFT, f);
  const arr = loadJson(p);
  if (!Array.isArray(arr)) continue;
  let added = 0;
  let touched = 0;
  for (const e of arr) {
    let list = byMetric.get(e.id) ?? [];
    unmatched.delete(e.id);
    /* 族 id：写到该后缀下每一条上，构建时按 ref 取并集后落在族条目上。
       前提是这一条本身属于同一个后缀，免得把别的后缀也带上。 */
    const m = NUM_ACC.exec(e.id);
    if (m) {
      for (const [metric, l] of byMetric) {
        const mm = NUM_ACC.exec(metric);
        if (mm && mm[4] === m[4]) { list = list.concat(l); unmatched.delete(metric); }
      }
    }
    if (!list.length) continue;
    const n = mergeSources(e, list);
    if (n) { added += n; touched++; }
  }
  if (added) {
    changedFiles.push(f);
    addedTotal += added;
    touchedEntries += touched;
    if (!CHECK_ONLY) writeFileSync(p, JSON.stringify(arr, null, 2) + "\n", "utf8");
    console.log(`  ${f.padEnd(24)} ${touched} entries +${added} attaches`);
  }
}

/* 洞察也一样：id 命中就写进去 */
{
  const ins = loadJson(INSIGHTS_JSON);
  let added = 0;
  for (const it of ins.items ?? []) {
    const list = byMetric.get(it.id);
    if (!list) continue;
    unmatched.delete(it.id);
    const n = mergeSources(it, list);
    if (n) {
      added += n;
      ins.updated_at = Math.floor(Date.now() / 1000);
    }
  }
  if (added) {
    addedTotal += added;
    if (!CHECK_ONLY) writeFileSync(INSIGHTS_JSON, JSON.stringify(ins, null, 1) + "\n", "utf8");
    console.log(`  insights.json            +${added} attaches`);
  }
}

console.log(`\nwrote ${addedTotal} attaches across ${touchedEntries} metric entries (${CHECK_ONLY ? "check only, no file written" : "written to disk"})`);
if (unmatched.size) {
  console.log(`\n${unmatched.size} metric ids matched no entry (manual review needed):`);
  for (const u of unmatched) console.log(`  · ${u}  ← ${byMetric.get(u)![0].ref}`);
}
if (problems.length) {
  console.log(`\nwarnings: ${problems.length}`);
  problems.slice(0, 40).forEach((p) => console.log("  · " + p));
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
}
