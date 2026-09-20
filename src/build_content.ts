/**
 * 把 content/_draft/*.json 合成 content/metrics.json。
 *
 * 子智能体各写各的草稿文件（避免并发写同一个文件），这里统一校验、去重、排序。
 * 校验不通过就退出码 1，避免把半成品合并进去。
 *
 *   bun src/build_content.ts [--check]
 *
 * --check 只校验不写文件（CI 或改动后自检用）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT, METRICS_JSON, NOTICES_ZH_JSON, ROOT } from "./paths";
import { readOfficial, readRegistry, resolveSources, usage, type ResolvedSource } from "./sources";

const CHECK_ONLY = process.argv.includes("--check");
const DRAFT = join(CONTENT, "_draft");

/** 分组顺序：按"看这个指标时脑子里问的问题"排，不是按字母。 */
const GROUP_ORDER = [
  "效果与采样",
  "采样器表格",
  "奖励信号",
  "优化器与策略",
  "训练推理一致性与数据新鲜度",
  "判分组统计",
  "系统、性能与成本",
  "评测榜",
  "公告",
];

/*
 * `dynsam/<类目>/<数据集>/num_accepted/{step,held,carryover}` 是采样器按数据源拆的
 * 计数，两个 run 加起来 75 个 tag。逐个写解读会得到 75 条内容雷同的卡片，把它们按
 * 后缀收成 3 条"族"条目，各数据源的差异放进一张表里 —— 概念讲一次，数字全保留。
 */
const NUM_ACC = /^(dynsam\/([^/]+)\/dataset-([^/]+)\/num_accepted\/(step|held|carryover))$/;

const SUFFIX_LABEL: Record<string, string> = {
  step: "本步受理题数",
  held: "题池持有量",
  carryover: "结转余量",
};

/** 从仓库里取各数据源的这组计数，用来生成族条目的对照表。 */
function numAcceptedTable(suffix: string, ids: string[]) {
  const store = join(ROOT, "data", "store", "runs");
  const data: Record<string, Record<string, (number | null)[]>> = {};
  for (const run of ["pro", "flash"]) {
    const p = join(store, run, "series.json");
    if (existsSync(p)) data[run] = JSON.parse(readFileSync(p, "utf8"));
  }
  const rows: string[][] = [];
  for (const id of ids) {
    const m = NUM_ACC.exec(id)!;
    const label = m[2] + "/dataset-" + m[3];
    /* 不用"首→末"：有些数据源的计数首末都是 0、中间才起来（比如某些 carryover），
       那样写会读成"全程为空"。用均值（区间）更能反映实际量级。 */
    const cell = (run: string) => {
      const arr = data[run] && data[run][id];
      if (!arr) return ["—", "—"];
      const v = arr.filter((x): x is number => x != null && isFinite(x));
      if (!v.length) return ["—", "—"];
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return [mean.toFixed(1), Math.min(...v) + "~" + Math.max(...v)];
    };
    const p = cell("pro"), f = cell("flash");
    rows.push([label, p[0], p[1], f[0], f[1]]);
  }
  // 按 pro 均值降序，量大的排前面
  rows.sort((a, b) => Number(b[1]) - Number(a[1]));
  return {
    caption: `各数据源的${SUFFIX_LABEL[suffix] ?? suffix}，均值与区间（pro 19 步 / flash 25 步）`,
    head: ["数据源", "pro 均值", "pro 区间", "flash 均值", "flash 区间"],
    rows,
  };
}

function collapseNumAccepted(items: Entry[], problems: string[]): Entry[] {
  const groups = new Map<string, Entry[]>();
  const kept: Entry[] = [];
  for (const e of items) {
    const m = NUM_ACC.exec(e.id);
    if (!m) { kept.push(e); continue; }
    const s = m[4];
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(e);
  }
  for (const [suffix, members] of groups) {
    const ids = members.map((m) => m.id);
    problems.push(`merged ${members.length} dynsam/*/dataset-*/num_accepted/${suffix} entries → 1 family entry (with comparison table)`);
    /* 溯源依据按 ref 取并集：子智能体可能把来源挂在各个数据集条目上，归并后不能丢。 */
    const refsOf = (e: Entry) => (e.sources ?? []) as Entry[];
    const seenRef = new Set<string>();
    const sources: Entry[] = [];
    for (const m of members) {
      for (const s of refsOf(m)) {
        const key = typeof s === "string" ? s : s?.ref;
        if (!key || seenRef.has(key)) continue;
        seenRef.add(key);
        sources.push(s);
      }
    }
    /* carryover 这一族和公开材料里的「简单题回采池」是同一个机制：满分的题被动态采样
       滤掉之后，仍按比例从池子里回采，所以会有跨步结转。挂一条背景来源。 */
    if (suffix === "carryover" && !seenRef.has("mimo-7b-easy-pool")) {
      seenRef.add("mimo-7b-easy-pool");
      sources.push({
        ref: "mimo-7b-easy-pool",
        stance: "context",
        note: "公开材料说明满分题会被存进一个池子、再按比例回采；这是「结转余量」这个计数存在的机制背景，但接口没有给出它的准确口径。",
      });
    }
    kept.push({
      id: `dynsam/<cat>/dataset-<id>/num_accepted/${suffix}`,
      name: `各数据源${SUFFIX_LABEL[suffix] ?? suffix}（按数据源拆开的采样器计数）`,
      group: "效果与采样",
      unit: "题数",
      what:
        `采样器按数据源统计的${SUFFIX_LABEL[suffix] ?? suffix}。` +
        (suffix === "step"
          ? "这一步从该数据源受理、进入训练 batch 的题数。"
          : suffix === "held"
            ? "该数据源当前留在题池里、还没被消耗掉的题数。"
            : "上一步留在池子里、结转到这一步的题数。") +
        "同一族在 pro 和 flash 上各有 25 个左右的数据源，看板的官方说明只覆盖了汇总口径，数据集这一层没有说明。",
      how:
        "看板未给官方说明。数据里能验证的关系是：多数步满足 held ≈ 本步受理数 + 上一步 carryover，" +
        "即题池 = 新收的 + 上一步攒下的。重启后的那一步这个关系不成立，结转链会被重置。",
      why:
        "这组数说明采样器把流量分给了谁。某个数据源的受理数突然掉下去，可能是数据配方改了、" +
        "也可能是它被临时剔除；如果不看这一层，只会在总 batch 大小变化时找不到原因。" +
        "pro 在第 15 步之后不再上报 cyber 的计数，对应的公告就是从下一轮移除 cyber 数据集。",
      read: [
        "这是给采样器做流量分配用的计数，不是效果指标。它变了先去看数据配方，不要拿它推断模型能力。",
        "受理数、持有量、结转余量要一起看：受理数在放量而持有量也在涨，说明这个数据源在攒题不是在被消耗。",
        "held ≈ 本步受理数 + 上一步 carryover 在多数步成立，但重启后的那一步会断，别当恒等式用。",
        "各数据源量级差一到两个数量级，横向比较要用占比，不要用绝对值。",
      ],
      observed:
        `pro 和 flash 各 25 个左右的数据源都有完整序列。各自的量级、走势差别很大：` +
        `有的数据源随训练放量（例如 code/dataset-yfch 的受理数从 55 涨到 121），有的在收缩。` +
        `下表列出每个数据源的首末值和均值；重启那几步的断链在 pro 有 3 处、flash 有 3 处。`,
      traps: [
        "看板对 num_accepted/{step,held,carryover} 这一族没有任何官方说明。这里的读法是从 tag 名字直译、再用数据里的滚动关系验证出来的，不是官方口径。",
        "held = 本步受理数 + 上一步 carryover 不是恒等式，重启后的那一步会破坏它，不要拿它去校验数据。",
        "数据集这一层的计数加起来比 dynsam/agentic/num_accepted/step 系统性偏高 10%~18%，两层口径不同，不要互相校验。",
      ],
      related: ["dynsam/agentic/num_accepted/step", "dynsam/num_target"],
      ...(sources.length ? { sources } : {}),
      table: numAcceptedTable(suffix, ids),
    });
  }
  return kept;
}

const REQUIRED = ["id", "name", "group", "unit", "what", "how", "why", "read", "observed", "traps", "related"];

type Entry = Record<string, any>;

function fail(msg: string): never {
  console.error("× " + msg);
  process.exit(1);
}

if (!existsSync(DRAFT)) fail(`draft directory does not exist: ${DRAFT}`);

const files = readdirSync(DRAFT).filter((f) => f.endsWith(".json")).sort();
if (!files.length) fail(`no json drafts under ${DRAFT}`);

const byId = new Map<string, Entry>();
const problems: string[] = [];
let total = 0;

for (const f of files) {
  let arr: any;
  try {
    arr = JSON.parse(readFileSync(join(DRAFT, f), "utf8"));
  } catch (e) {
    fail(`${f} is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(arr)) fail(`${f} top level is not an array`);
  total += arr.length;

  for (const raw of arr) {
    const e = raw as Entry;
    const where = `${f} · ${e && e.id ? e.id : "(缺 id)"}`;

    for (const k of REQUIRED) {
      if (!(k in e)) { problems.push(`${where} missing field ${k}`); continue; }
      const v = e[k];
      if (k === "read" || k === "traps" || k === "related") {
        if (!Array.isArray(v)) problems.push(`${where} ${k} is not an array`);
      } else if (typeof v !== "string" || !v.trim()) {
        problems.push(`${where} ${k} is empty`);
      }
    }
    if (e.read && e.read.length < 3) problems.push(`${where} read has only ${e.read.length} entries (3-6 required)`);
    if (e.read && e.read.length > 6) problems.push(`${where} read has ${e.read.length} entries (3-6 required)`);
    if (e.traps && e.traps.length > 4) problems.push(`${where} traps has ${e.traps.length} entries (1-4 required)`);
    if (e.group && GROUP_ORDER.indexOf(e.group) < 0) problems.push(`${where} group "${e.group}" is not in the allowed list`);

    if (byId.has(e.id)) {
      const prev = byId.get(e.id)!;
      // 同一指标被两组都写了：保留字段更全的那条，并报出来
      const score = (x: Entry) => REQUIRED.reduce((p, k) => p + (x[k] && (Array.isArray(x[k]) ? x[k].length : String(x[k]).length) ? 1 : 0), 0)
        + (x.what || "").length + (x.observed || "").length;
      const keep = score(e) >= score(prev) ? e : prev;
      problems.push(`duplicate id ${e.id} (${prev.group} and ${e.group}); keeping the more complete entry`);
      byId.set(e.id, keep);
    } else {
      byId.set(e.id, e);
    }
  }
}

const merged = collapseNumAccepted([...byId.values()], problems);

const items = merged.sort((a, b) => {
  const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
  return a.id.localeCompare(b.id);
});

const groups: Record<string, number> = {};
for (const it of items) groups[it.group] = (groups[it.group] || 0) + 1;

// 硬性错误：缺字段、类型不对。软性问题只提示。
const hard: string[] = problems.filter((p) => /missing field|is not an array|is empty/.test(p));

/*
 * insights.json 是手写的，不受这套草稿合并管，但同样要挡住低级错误。
 * 这里特意校验一次：JSON 里把中文引号写成半角引号会让整个文件解析失败，
 * 而那个位置很难一眼看出来，所以给它一个明确的报错。
 */
{
  const p = join(CONTENT, "insights.json");
  if (!existsSync(p)) {
    problems.push("content/insights.json does not exist; the site will have no data insights");
  } else {
    try {
      const ins = JSON.parse(readFileSync(p, "utf8"));
      if (!Array.isArray(ins.items) || !ins.items.length) hard.push("insights.json has no items");
      for (const it of ins.items ?? []) {
        for (const k of ["id", "kind", "title", "summary", "body"]) {
          if (!(k in it)) hard.push(`insights.json ${it.id ?? "?"} missing field ${k}`);
        }
        if (!Array.isArray(it.body) || !it.body.length) hard.push(`insights.json ${it.id} body is empty`);
      }
      console.log(`insights content/insights.json  ${ins.items?.length ?? 0} entries`);
    } catch (e) {
      hard.push(
        `failed to parse content/insights.json: ${(e as Error).message}. ` +
          `The most common cause is a Chinese quote written as an ASCII ", which truncates the string early.`,
      );
    }
  }
}

/*
 * 原站公告的中文译文（content/notices.zh.json）。不参与上面的草稿合并，但同样是人手写的文件，
 * 挡一下低级错误：每条至少要有 zh；写不写 en 不强制，但缺了它，原文以后被改过时
 * 页面就没法提示"这条译文可能过时"。
 */
{
  const p = NOTICES_ZH_JSON;
  if (!existsSync(p)) {
    problems.push("content/notices.zh.json does not exist; the overview notices panel can only show the English originals");
  } else {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const dict: Record<string, unknown> = j.items ?? {};
      const ids = Object.keys(dict);
      let noEn = 0;
      for (const id of ids) {
        const e: any = dict[id];
        const zh = typeof e === "string" ? e : e?.zh;
        if (!zh || !String(zh).trim()) hard.push(`content/notices.zh.json ${id} has no zh translation`);
        if (typeof e === "object" && !e?.en) noEn++;
      }
      if (noEn) problems.push(`content/notices.zh.json has ${noEn} entries without en (cannot flag stale translations when the original changes)`);
      console.log(`notice translations content/notices.zh.json  ${ids.length} entries`);
    } catch (e) {
      hard.push(
        `failed to parse content/notices.zh.json: ${(e as Error).message}. ` +
          `As with insights.json, a Chinese quote written as an ASCII " truncates the string early.`,
      );
    }
  }
}

/*
 * 溯源依据：条目里只写 ref，这里展开成完整来源。引用不存在的 ref、stance 写错、
 * note 空着，都算硬性错误 —— 页面上不允许出现"点开什么都没有"的来源按钮。
 */
{
  const { all, byId, problems: regProblems } = readRegistry();
  regProblems.forEach((p) => problems.push(p));
  const official = readOfficial();
  const resolved: ResolvedSource[][] = [];
  for (const it of items) {
    const r = resolveSources(it, byId, official);
    r.problems.forEach((p) => hard.push(`metrics/${p}`));
    it.sources = r.sources;
    resolved.push(r.sources);
  }
  let withoutLiterature = 0;
  for (const list of resolved) {
    if (list.every((s) => s.kind === "data" || s.kind === "doc")) withoutLiterature++;
  }
  console.log(usage(resolved, all));
  console.log(`  of these, ${withoutLiterature} entries have only the official description or site data, with no external literature`);
}

console.log(`\ndrafts ${files.length} files / ${total} entries → ${items.length} after merge`);
for (const g of Object.keys(groups).sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))) {
  console.log(`  ${g.padEnd(24, " ")} ${String(groups[g]).padStart(3)} entries`);
}
if (problems.length) {
  console.log(`\nwarnings: ${problems.length}`);
  problems.slice(0, 40).forEach((p) => console.log("  · " + p));
  if (problems.length > 40) console.log(`  ... ${problems.length - 40} more`);
}

if (hard.length) {
  console.error(`\n× ${hard.length} hard errors; nothing written:`);
  hard.slice(0, 20).forEach((p) => console.error("  · " + p));
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log("\n--check: validation only, no file written.");
} else {
  const out = {
    schema_version: 1,
    updated_at: Math.floor(Date.now() / 1000),
    note: "逐指标解读。id 是看板上的指标名；带 <k> 的条目是按族写的（比如 partial/<k>/frac 一份覆盖所有新鲜度桶）。",
    groups: GROUP_ORDER.filter((g) => groups[g]),
    items,
  };
  writeFileSync(METRICS_JSON, JSON.stringify(out, null, 1) + "\n", "utf8");
  console.log(`\nwrote ${METRICS_JSON} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}
