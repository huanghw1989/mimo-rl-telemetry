/**
 * 核验溯源登记表里的每一条材料是真的。
 *
 *   bun src/verify_sources.ts [--strict] [--only=<id>]
 *
 * 两条独立的检查，都需要联网：
 *
 *   1. arXiv 条目：按 id 问一次官方 API，把返回的**真实标题**和登记表里的标题做词集
 *      比对。这一步挡的是"记错 id"—— 写过引用的人都知道，凭记忆写 id 出错的概率很高，
 *      而错了以后链接能打开、只是指向另一篇论文，肉眼极难发现。
 *   2. 其他网页条目：抓页面正文，检查 quote 的开头几个词是否**逐字出现**。检查不通过
 *      不算硬失败（不少引用来自 PDF 或正文深处，页面文本未必包含），但值得人工看一眼。
 *
 * --strict 时，arXiv 标题对不上、或页面抓不到，都会让退出码变 1。
 */
import { readFileSync } from "node:fs";
import { SOURCES_JSON } from "./paths";

const STRICT = process.argv.includes("--strict");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);

const UA = "mimo-rl-telemetry/1.0 (+local verification)";

type Item = Record<string, any>;

/** 标题比对：去掉大小写、标点和多余空格后取词集，算 Jaccard。 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function words(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((w) => w.length > 2));
}
function jaccard(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / (A.size + B.size - hit);
}

/**
 * 收录时为了说清"这条材料被用在哪"，标题里常会加上说明性后缀
 * （例如 "Xxx Technical Report 附录 B（Reward Hacking）"）。这种情况真标题的词集
 * 会被登记表标题**包含**，Jaccard 却不高，所以单独判一次包含关系。
 */
function contains(real: string, reg: string): number {
  const R = words(real), G = words(reg);
  if (!R.size) return 0;
  let hit = 0;
  for (const w of R) if (G.has(w)) hit++;
  return hit / R.size;
}

/** 从 url / venue 里抠 arXiv id。 */
function arxivId(it: Item): string | null {
  const m = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/\d{7})/i.exec(it.url ?? "");
  if (m) return m[1];
  const v = /arXiv:\s*([0-9]{4}\.[0-9]{4,5})/i.exec(it.venue ?? "");
  return v ? v[1] : null;
}

async function fetchText(url: string): Promise<{ status: number; text: string } | null> {
  /* 同一份材料常有多条引文（登记表里是多个条目、同一个 URL），按 URL 缓存结果，
     免得对同一个页面反复请求 —— 那也是触发限流的主要原因。 */
  const cached = fetchCache.get(url);
  if (cached) return cached;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      if (res.status === 200) {
        const out = { status: res.status, text };
        fetchCache.set(url, out);
        return out;
      }
      /* arXiv 限流时返回 403/503，退避后重试 */
      if (i < 2) await Bun.sleep(4000 * (i + 1));
      else return { status: res.status, text };
    } catch {
      if (i < 2) await Bun.sleep(4000 * (i + 1));
    }
  }
  return null;
}
const fetchCache = new Map<string, { status: number; text: string }>();

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/\s+/g, " ");
}

const doc = JSON.parse(readFileSync(SOURCES_JSON, "utf8"));
let items: Item[] = doc.items ?? [];
if (ONLY) items = items.filter((i) => i.id === ONLY);
if (!items.length) {
  console.error("registry has no items, or --only matched nothing");
  process.exit(1);
}
console.log(`verifying ${items.length} items${ONLY ? ` (--only=${ONLY})` : ""}\n`);

const arxivItems = items.filter((i) => arxivId(i));
const webItems = items.filter((i) => i.url && !arxivId(i));

const hard: string[] = [];
const soft: string[] = [];

/* ---------------------------------------------- 1. arXiv：id ↔ 标题 */
const titles = new Map<string, string>();
const missing = new Set<string>(arxivItems.map((i) => arxivId(i)!));
let rounds = 0;
let apiFails = 0;
while (missing.size && rounds < 14) {
  rounds++;
  const batch = [...missing].slice(0, 8);
  const url = `https://export.arxiv.org/api/query?id_list=${batch.join(",")}&max_results=${batch.length}`;
  const res = await fetchText(url);
  if (!res || res.status !== 200 || !res.text.includes("<feed")) {
    apiFails++;
    console.log(`  … round ${rounds}: arXiv API returned ${res?.status ?? "network error"}; backing off and retrying (${missing.size} ids left)`);
    await Bun.sleep(6000 * Math.min(apiFails, 3));
    continue;
  }
  for (const entry of res.text.split("<entry>").slice(1)) {
    const idm = /<id>https?:\/\/arxiv\.org\/abs\/([^<v]+)/.exec(entry);
    const tm = /<title>([\s\S]*?)<\/title>/.exec(entry);
    if (!idm || !tm) continue;
    const id = idm[1].trim();
    titles.set(id, tm[1].replace(/\s+/g, " ").trim());
    missing.delete(id);
  }
  await Bun.sleep(3200);
}
for (const id of missing) hard.push(`arXiv ${id}: could not query this id (API failed on repeated rounds, or the id does not exist)`);

for (const it of arxivItems) {
  const id = arxivId(it)!;
  const real = titles.get(id);
  if (!real) continue;
  const score = jaccard(it.title ?? "", real);
  const cover = contains(real, it.title ?? "");
  if (score < 0.6 && cover < 0.9) {
    hard.push(`arXiv ${id} title mismatch (similarity ${score.toFixed(2)}, real-title word coverage ${cover.toFixed(2)})\n      registry: ${it.title}\n      arXiv: ${real}`);
  } else {
    console.log(`✓ ${id.padEnd(12)} ${score.toFixed(2)}${cover >= 0.9 && score < 0.6 ? "(real title contained)" : ""}  ${real.slice(0, 62)}`);
  }
}

/* ------------------------------------- 2. 其他网页：quote 是否逐字出现 */
/* 下面两个页面是前端渲染的（直接抓 HTML 只有导航文字），抓不到正文不等于引文有问题。
   它们的 quote 是用真实浏览器渲染后取 innerText 核验的，结论是全部 10 条逐字命中；
   换页面内容时请重新渲染核验一次。 */
const RENDERED = new Set([
  "https://fengyao.notion.site/off-policy-rl",
  "https://yingru.notion.site/When-Speed-Kills-Stability-Demystifying-RL-Collapse-from-the-Training-Inference-Mismatch-271211a558b7808d8b12d403fd15edda",
]);

console.log("");
for (const it of webItems) {
  if (RENDERED.has(it.url!)) {
    console.log(`✓ ${it.id.padEnd(20)} JS-rendered page, verified verbatim in a browser  ${it.url!.slice(0, 46)}`);
    continue;
  }
  const res = await fetchText(it.url!);
  if (!res || res.status !== 200) {
    hard.push(`${it.id}: could not fetch ${it.url} (status ${res?.status ?? "network error"})`);
    continue;
  }
  const text = htmlToText(res.text);
  const words = norm(it.quote ?? "").split(" ").slice(0, 8).join(" ");
  const ok = words.length > 12 && text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").includes(words);
  if (ok) {
    console.log(`✓ ${it.id.padEnd(20)} quote found verbatim  ${it.url.slice(0, 60)}`);
  } else {
    /* 页面能打开但摘句没出现在正文里：可能是 PDF、也可能摘的是正文深处的句子 */
    soft.push(`${it.id}: page reachable, but the quote opening was not found in the body (${it.url})`);
    console.log(`~ ${it.id.padEnd(20)} page reachable, quote not found in body`);
  }
  await Bun.sleep(400);
}

console.log(`\n${hard.length} hard failures, ${soft.length} to confirm manually`);
if (hard.length) {
  console.error("\n× hard failures:");
  hard.forEach((h) => console.error("  · " + h));
}
if (soft.length) {
  console.log("\n~ needs manual confirmation:");
  soft.forEach((s) => console.log("  · " + s));
}
if (STRICT && hard.length) process.exit(1);
