/**
 * 溯源依据：登记表 + 解析。
 *
 * 设计取舍：指标/洞察条目里**只存 ref**（`{"ref":"grpo","stance":"support","note":"…"}`），
 * 完整的题目、作者、链接、原文引用统一放在 `content/sources.json`。这样做的好处：
 *
 *   1. 引用错的 ref 会在构建时直接报错，页面上不会出现点不开或对不上的来源；
 *   2. 一个来源被多处引用时，改一次就够了；
 *   3. 子智能体只被允许写 ref，编不出 URL —— 所有 URL 都出自登记表，且登记表里的每条
 *      都经过核验。
 *
 * 解析发生在构建时（build_content.ts）和导出时（export.ts），页面上拿到的已经是
 * 展开后的完整对象，离线副本不需要额外请求。
 */
import { existsSync, readFileSync } from "node:fs";
import { META_JSON, SOURCES_JSON, type Locale } from "./paths";

export type SourceEntry = {
  id: string;
  kind: string;
  title: string;
  authors?: string;
  venue?: string;
  year?: string;
  url?: string;
  quote?: string;
  topic?: string;
};

export type ResolvedSource = SourceEntry & { stance: string; note: string };

export const SOURCE_KINDS = new Set(["paper", "blog", "doc", "report", "self", "data"]);
export const SOURCE_STANCES = new Set(["support", "challenge", "context"]);

/** 带 <k> 之类占位符的"族"条目，不能直接拿去画图，也就没有对应的曲线可以点开。 */
export function isLiteralTag(id: string): boolean {
  return !!id && id.indexOf("<") < 0;
}

export function readRegistry(registryPath: string = SOURCES_JSON): { all: SourceEntry[]; byId: Map<string, SourceEntry>; problems: string[] } {
  const problems: string[] = [];
  const all: SourceEntry[] = [];
  const byId = new Map<string, SourceEntry>();
  if (!existsSync(registryPath)) {
    problems.push(`source registry does not exist: ${registryPath} -- all source references will fail to resolve`);
    return { all, byId, problems };
  }
  let reg: any;
  try {
    reg = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (e) {
    problems.push(`failed to parse source registry (${registryPath}): ${(e as Error).message}`);
    return { all, byId, problems };
  }
  for (const s of reg.items ?? []) {
    if (!s.id) { problems.push(`an entry in sources.json has no id`); continue; }
    if (byId.has(s.id)) { problems.push(`duplicate id in sources.json: ${s.id}`); continue; }
    if (!SOURCE_KINDS.has(s.kind)) problems.push(`source ${s.id} kind "${s.kind}" is not in the allowed list`);
    if (!s.title) problems.push(`source ${s.id} has no title`);
    if (s.kind !== "self" && s.kind !== "data" && !s.url) problems.push(`source ${s.id} is ${s.kind} but has no url`);
    if (s.url && !/^(https?:|#)/.test(s.url)) problems.push(`source ${s.id} url is neither http(s) nor a site anchor: ${s.url}`);
    byId.set(s.id, s);
    all.push(s);
  }
  return { all, byId, problems };
}

/** 原站自己给这批固定指标写的官方说明（英文），是"它量的是什么"的第一口径。 */
export function readOfficial(): Record<string, string> {
  if (!existsSync(META_JSON)) return {};
  try {
    return JSON.parse(readFileSync(META_JSON, "utf8")).descriptions ?? {};
  } catch {
    return {};
  }
}

/**
 * 把一条条目上的 ref 展开成完整来源，并补上两类自动来源：
 *   · 官方口径（原站 descriptions 里有的指标）
 *   · 兜底的本站数据来源（既没有文献也没有官方说明时，至少告诉读者结论是怎么来的）
 */
/**
 * Wording of the two auto-added source entries. They are generated at build or
 * serve time, so unlike the rest of the content they cannot come from a
 * translated JSON file — the table has to exist per locale.
 */
const AUTO_TEXT: Record<Locale, {
  officialTitle: string;
  officialNote: string;
  storeTitle: string;
  storeTitleFamily: string;
  storeNote: string;
}> = {
  "zh-CN": {
    officialTitle: "看板官方指标说明",
    officialNote: "原站自己给这个指标写的说明。它是口径基准：我们的解读如果和它冲突，以官方为准。",
    storeTitle: "本站遥测仓库的原始序列",
    storeTitleFamily: "本站遥测仓库的原始序列（族条目）",
    storeNote:
      "这条解读来自遥测仓库里的原始序列、tag 命名，以及数据内部可验证的恒等关系。这一轮溯源没有检索到直接对应的公开文献，如果读者知道相关材料，欢迎补充。",
  },
  en: {
    officialTitle: "Official dashboard description",
    officialNote:
      "The upstream site's own description of this metric. It is the baseline for interpretation: where our reading conflicts with it, the official wording wins.",
    storeTitle: "Raw series from this repository's warehouse",
    storeTitleFamily: "Raw series from this repository's warehouse (family entry)",
    storeNote:
      "This explainer is derived from the raw series in the warehouse, the tag naming, and identities that can be recomputed from the data itself. No directly matching public material was found for this reading; corrections and references are welcome.",
  },
};

export function resolveSources(
  entry: Record<string, any>,
  reg: Map<string, SourceEntry>,
  official: Record<string, string>,
  locale: Locale = "zh-CN",
): { sources: ResolvedSource[]; problems: string[] } {
  const auto = AUTO_TEXT[locale] ?? AUTO_TEXT["zh-CN"];
  const problems: string[] = [];
  const out: ResolvedSource[] = [];
  const seen = new Set<string>();
  const id = String(entry.id ?? "");

  for (const raw of entry.sources ?? []) {
    /* 已经展开过的来源（有 title 没有 ref）：metrics.json 是构建产物，可能被再解析一次
       （服务端、离线导出都会读它），重复展开要安全。 */
    if (raw && typeof raw === "object" && !raw.ref && raw.title) {
      if (!seen.has(raw.id)) { seen.add(raw.id); out.push(raw as ResolvedSource); }
      continue;
    }
    const ref = typeof raw === "string" ? raw : raw?.ref;
    if (!ref) { problems.push(`a source on ${id} has no ref`); continue; }
    const stance = (typeof raw === "string" ? "context" : raw.stance) || "context";
    const note = (typeof raw === "string" ? "" : raw.note) || "";
    if (!SOURCE_STANCES.has(stance)) problems.push(`${id} references ${ref} with stance "${stance}", not support/challenge/context`);
    if (!note.trim()) problems.push(`${id} references ${ref} without a note (it must say which claim it supports)`);
    if (seen.has(ref)) { problems.push(`${id} references ${ref} twice`); continue; }
    const src = reg.get(ref);
    if (!src) { problems.push(`${id} references unregistered source "${ref}"`); continue; }
    seen.add(ref);
    out.push({ ...src, stance, note });
  }

  if (isLiteralTag(id) && official[id] && !seen.has("official-desc")) {
    out.unshift({
      id: "official-desc",
      kind: "doc",
      title: auto.officialTitle,
      venue: "mimo.xiaomi.com/rl",
      url: "https://mimo.xiaomi.com/rl/",
      quote: official[id],
      stance: "context",
      note: auto.officialNote,
    });
  }

  if (!out.length) {
    out.push({
      id: "site-store",
      kind: "data",
      title: isLiteralTag(id) ? auto.storeTitle : auto.storeTitleFamily,
      url: isLiteralTag(id) ? "#chart/" + encodeURIComponent(id) : "",
      stance: "context",
      note: auto.storeNote,
    });
  }
  return { sources: out, problems };
}

/**
 * 读一份内容文件（metrics.json / insights.json）并展开来源。
 * 服务端和离线导出都用它，免得两边各写一份解析逻辑走偏。
 */
export function readResolvedItems(
  path: string,
  label: string,
  locale: Locale = "zh-CN",
  registryPath: string = SOURCES_JSON,
): { items: any[]; problems: string[] } {
  if (!existsSync(path)) return { items: [], problems: [`${label} does not exist: ${path}`] };
  let j: any;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { items: [], problems: [`failed to parse ${label}: ${(e as Error).message}`] };
  }
  const reg = readRegistry(registryPath);
  const official = readOfficial();
  const problems = [...reg.problems];
  const items = (j.items ?? []).map((it: any) => {
    const r = resolveSources(it, reg.byId, official, locale);
    r.problems.forEach((p) => problems.push(`${label} · ${p}`));
    return { ...it, sources: r.sources };
  });
  return { items, problems };
}

/** 统计一下登记表的使用情况，构建时打印。 */
export function usage(resolved: ResolvedSource[][], all: SourceEntry[]): string {
  const used = new Map<string, number>();
  for (const list of resolved) for (const s of list) used.set(s.id, (used.get(s.id) ?? 0) + 1);
  const unused = all.filter((s) => !used.has(s.id)).map((s) => s.id);
  const external = [...used.keys()].filter((k) => k !== "site-store" && k !== "official-desc").length;
  return (
    `provenance: registry ${all.length} entries, ${used.size} referenced (${external} external)` +
    (unused.length ? `; unreferenced: ${unused.join(", ")}` : "")
  );
}
