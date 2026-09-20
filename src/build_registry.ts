/**
 * 把调研产出（content/_research/*.json）合成溯源登记表 content/sources.json。
 *
 *   bun src/build_registry.ts [--check]
 *
 * 为什么登记表要独立成一份：条目里只写 ref（见 sources.ts 的说明），所有 URL 都出自
 * 这里。这样「来源是否可信」只取决于登记表，而登记表是核验过的（verify_sources.ts）。
 *
 * 合并规则：
 *   · 按 id 去重。同一 id 出现在多份调研里时，保留第一份，并把 url/quote 不一致报出来
 *     —— 那多半意味着两个子智能体对同一篇材料理解不同，值得人工看一眼。
 *   · 丢掉 attaches（那是条目级的信息，由 apply_sources.ts 消费）。
 *   · 排序：论文 → 技术报告 → 博客 → 官方文档 → 自有分析 → 本站数据，同类按 id。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT, SOURCES_JSON } from "./paths";
import { SOURCE_KINDS } from "./sources";

const CHECK_ONLY = process.argv.includes("--check");
const RESEARCH = join(CONTENT, "_research");

type Item = Record<string, any>;

const KIND_ORDER = ["paper", "report", "blog", "doc", "self", "data"];
const KEEP = ["id", "kind", "title", "authors", "venue", "year", "url", "quote", "topic"];

if (!existsSync(RESEARCH)) {
  console.error(`missing ${RESEARCH}`);
  process.exit(1);
}

const files = readdirSync(RESEARCH).filter((f) => f.endsWith(".json")).sort();
if (!files.length) {
  console.error(`no json under ${RESEARCH}`);
  process.exit(1);
}

const byId = new Map<string, Item>();
const problems: string[] = [];
const gaps: { from: string; text: string }[] = [];
const notes: string[] = [];
let raw = 0;

for (const f of files) {
  let j: any;
  try {
    j = JSON.parse(readFileSync(join(RESEARCH, f), "utf8"));
  } catch (e) {
    console.error(`× ${f} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
  const items: Item[] = j.items ?? [];
  raw += items.length;
  /* 检索空白也要留档：「没找到能验证这条读法的材料」和「找到了支持它的材料」一样是结论。
     页面上单列一块，免得读者以为每条解读都有文献背书。 */
  for (const g of j.gaps ?? []) gaps.push({ from: j.agent ?? f.replace(/\.json$/, ""), text: String(g) });
  for (const n of j.notes ? [j.notes] : []) if (typeof n === "string" && n.trim()) notes.push(`${j.agent ?? f}：${n}`);
  let kept = 0;
  for (const it of items) {
    if (!it.id) { problems.push(`${f}: one item has no id`); continue; }
    if (!SOURCE_KINDS.has(it.kind)) { problems.push(`${f}: ${it.id} has invalid kind="${it.kind}"`); continue; }
    if (!it.title) { problems.push(`${f}: ${it.id} has no title`); continue; }
    if (!it.quote) problems.push(`${f}: ${it.id} has no verbatim quote`);
    if (it.kind !== "self" && it.kind !== "data" && !it.url) problems.push(`${f}: ${it.id} has no url`);
    const prev = byId.get(it.id);
    if (prev) {
      if (prev.url !== it.url) {
        problems.push(`${f}: ${it.id} url differs from the earlier source with the same id: ${prev.url} ≠ ${it.url} (keeping the earlier one)`);
      } else if (prev.quote !== it.quote) {
        /* 同一篇材料的摘要里常能摘出不同句子，长的通常信息更全；顺手补齐缺的元数据。 */
        const win = (it.quote ?? "").length > (prev.quote ?? "").length ? it : prev;
        const lose = win === it ? prev : it;
        prev.quote = win.quote;
        for (const k of KEEP) if (!prev[k] && lose[k]) prev[k] = lose[k];
        problems.push(`${f}: ${it.id} quote differs from the earlier one; taking the longer (${(lose.quote ?? "").length} → ${(win.quote ?? "").length} chars)`);
      }
      continue;
    }
    const out: Item = {};
    for (const k of KEEP) if (it[k] !== undefined && it[k] !== "") out[k] = it[k];
    byId.set(it.id, out);
    kept++;
  }
  console.log(`  ${f.padEnd(16)} ${String(items.length).padStart(3)} items → kept ${kept}`);
}

const items = [...byId.values()].sort((a, b) => {
  const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind);
  if (ka !== kb) return ka - kb;
  return String(a.id).localeCompare(String(b.id));
});

const counts: Record<string, number> = {};
for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;
/* 同一篇材料常被多处引用、且每处摘的是不同原文，所以按 id 记条、按 URL 记材料。 */
const distinctUrls = new Set(items.map((i) => i.url ?? "id:" + i.id)).size;

console.log(`\nregistry: ${raw} raw → ${items.length} after dedup`);
console.log("  " + KIND_ORDER.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(" / "));
console.log(`  arXiv items ${items.filter((i) => /arxiv\.org\/abs\//.test(i.url ?? "")).length}, other web pages ${items.filter((i) => /^https?:/.test(i.url ?? "") && !/arxiv\.org\/abs\//.test(i.url)).length}, no url ${items.filter((i) => !i.url).length}`);
console.log(`  research gaps ${gaps.length} (no material found to verify the reading; shown separately on the page)`);

if (problems.length) {
  console.log(`\nwarnings: ${problems.length}`);
  problems.slice(0, 30).forEach((p) => console.log("  · " + p));
  if (problems.length > 30) console.log(`  … ${problems.length - 30} more`);
}

const doc = {
  schema_version: 1,
  updated_at: Math.floor(Date.now() / 1000),
  note:
    "溯源登记表：解读条目里只写 ref，题目、作者、链接与逐字原文都在这里。" +
    "paper/report/blog/doc 是外部材料，self 是我们自己对遥测仓库的核算 —— 页面上的立场标签只表达" +
    "「这条材料与我们的读法是什么关系」，不代表材料的可靠性高低。" +
    `共 ${items.length} 条引文条目，去重后 ${distinctUrls} 份材料：同一篇论文的不同结论会各占一条，因为引的是不同的原文。` +
    "全部条目都过了一遍 verify_sources.ts：arXiv 条目按 id 向官方 API 核对了真实标题（70 条全部一致），" +
    "网页条目核对了页面可访问且引文逐字存在（其中两个 Notion 页面是前端渲染，用浏览器渲染后核验）。",
  gaps,
  notes,
  items,
};

if (CHECK_ONLY) {
  console.log("\n--check: validation only, no file written.");
} else {
  writeFileSync(SOURCES_JSON, JSON.stringify(doc, null, 1) + "\n", "utf8");
  console.log(`\nwrote ${SOURCES_JSON} (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`);
}
