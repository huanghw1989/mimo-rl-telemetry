/**
 * Generate the English edition of the documentation and the long-form analysis.
 *
 *   bun run translate:docs                       translate everything new
 *   bun run translate:docs -- --force            re-translate from scratch
 *   bun run translate:docs -- --dry-run          report only
 *   bun run translate:docs -- --only=docs        docs/ only
 *   bun run translate:docs -- --only=analysis    analysis/ only
 *   bun run translate:docs -- --file=notes/08-…  one file (Chinese basename ok)
 *
 * Layout:
 *   docs/zh-CN/*.md            -> docs/en/*.md
 *   analysis/zh-CN/**\/*.md    -> analysis/en/**\/*.md   (English slug filenames)
 *
 * Markdown is not sent to the model as one blob. It is segmented first:
 * fenced code blocks are copied verbatim, tables are translated cell by cell,
 * headings and list items keep their markers, and inline code, URLs, links and
 * HTML tags are masked as @@n@@ placeholders that the model is told to copy
 * through. A unit whose placeholders do not survive is left in the original
 * language rather than shipped corrupted.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DOC_SLUGS, localizeDocPaths, needsTranslation, translateTexts } from "./i18n_core";
import { ANALYSIS_ZH, CONTENT, DOCS, ROOT } from "./paths";

const args = process.argv.slice(2);
const has = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const DRY = has("dry-run");
const FORCE = has("force");
const CONCURRENCY = Number(opt("concurrency")) || 5;
const ONLY = opt("only");
const FILE = opt("file");

function slugFor(basename: string): string {
  return DOC_SLUGS[basename] ?? basename.replace(/[\u4e00-\u9fff]+/g, (m) => m); // keep as-is if unmapped
}

/* -------------------------------------------------------------- segmentation */

interface Unit {
  /** Placeholder-masked text actually sent to the model. */
  masked: string;
  /** Inline fragments (code, urls, html) keyed by placeholder index. */
  parts: string[];
}

function maskInline(text: string): Unit {
  const parts: string[] = [];
  const masked = text.replace(
    /(`[^`]*`|\]\([^)]*\)|<[^>]+>|https?:\/\/[^\s)>\]]+)/g,
    (m) => `@@${parts.push(m) - 1}@@`,
  );
  return { masked, parts };
}

function unmask(unit: Unit, translated: string): string {
  return translated.replace(/@@(\d+)@@/g, (m, i) => unit.parts[Number(i)] ?? m);
}

/** A line, decomposed into literal pieces and translatable units. */
type Piece = { lit: string } | { unit: Unit };

function splitLine(line: string): Piece[] | null {
  if (!needsTranslation(line)) return null;

  /* Headings: keep the #'s and any trailing anchors. */
  const heading = /^(#{1,6}\s+)(.*)$/.exec(line);
  if (heading) return [{ lit: heading[1] }, { unit: maskInline(heading[2]) }];

  /* Table rows: translate every cell, keep the pipes and alignment. */
  if (/^\s*\|/.test(line)) {
    const cells = line.split("|");
    const pieces: Piece[] = [];
    cells.forEach((cell, i) => {
      if (i > 0) pieces.push({ lit: "|" });
      /* Preserve a single leading/trailing space around the cell text. */
      const m = /^(\s*)(.*?)(\s*)$/.exec(cell)!;
      pieces.push({ lit: m[1] });
      if (needsTranslation(m[2])) pieces.push({ unit: maskInline(m[2]) });
      else pieces.push({ lit: m[2] });
      pieces.push({ lit: m[3] });
    });
    return pieces;
  }

  /* List items and blockquotes: keep the marker. */
  const li = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/.exec(line);
  if (li) return [{ lit: li[1] }, { unit: maskInline(li[2]) }];
  const bq = /^(\s*>\s?)(.*)$/.exec(line);
  if (bq) return [{ lit: bq[1] }, { unit: maskInline(bq[2]) }];

  return [{ unit: maskInline(line) }];
}

/* ------------------------------------------------------------------- walking */

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

interface Task {
  src: string;
  dst: string;
  lines: string[];
  /** One entry per line that needs work. */
  lineUnits: (Piece[] | null)[];
  units: Unit[];
}

function plan(srcDir: string, dstDir: string): Task[] {
  const tasks: Task[] = [];
  for (const src of walk(srcDir)) {
    const rel = relative(srcDir, src);
    const basename = rel.split("/").pop()!;
    const dst = join(dstDir, rel.replace(basename, slugFor(basename)));
    const lines = readFileSync(src, "utf8").split("\n");
    const lineUnits: (Piece[] | null)[] = [];
    const units: Unit[] = [];
    let fenced = false;
    for (const raw of lines) {
      if (/^\s*(```|~~~)/.test(raw)) {
        fenced = !fenced;
        lineUnits.push(null);
        continue;
      }
      if (fenced) {
        lineUnits.push(null);
        continue;
      }
      const pieces = splitLine(raw);
      if (pieces) for (const p of pieces) if ("unit" in p) units.push(p.unit);
      lineUnits.push(pieces);
    }
    tasks.push({ src, dst, lines, lineUnits, units });
  }
  return tasks;
}

/* ---------------------------------------------------------------------- main */

async function run(scope: "docs" | "analysis"): Promise<void> {
  const srcDir = scope === "docs" ? join(DOCS, "zh-CN") : join(ANALYSIS_ZH);
  const dstDir = scope === "docs" ? join(DOCS, "en") : join(join(ROOT, "analysis", "en"));
  let tasks = plan(srcDir, dstDir);
  if (FILE) tasks = tasks.filter((t) => t.src.includes(FILE));
  if (!tasks.length) {
    console.log(`${scope}: nothing to do`);
    return;
  }

  const allUnits = tasks.flatMap((t) => t.units.map((u) => u.masked));
  const distinct = [...new Set(allUnits)];
  console.log(`\n${scope}: ${tasks.length} files, ${distinct.length} distinct text units`);

  /* Docs keep their own cache file: the content pipeline may be running at the
     same time and the two must not overwrite each other's progress. */
  const translated = await translateTexts(distinct, {
    model: opt("model") ?? undefined,
    concurrency: CONCURRENCY,
    force: FORCE,
    cachePath: join(CONTENT, ".i18n-docs-cache.json"),
  });
  const dict = new Map(distinct.map((s, i) => [s, translated[i]]));

  let wrote = 0;
  let unresolved = 0;
  for (const task of tasks) {
    const out: string[] = [];
    let dropped = 0;
    for (let i = 0; i < task.lines.length; i++) {
      const pieces = task.lineUnits[i];
      if (!pieces) {
        out.push(task.lines[i]);
        continue;
      }
      let line = "";
      for (const p of pieces) {
        if ("lit" in p) {
          line += p.lit;
          continue;
        }
        const tr = dict.get(p.unit.masked);
        const restored = tr ? unmask(p.unit, tr) : p.unit.masked;
        if (/@@\d+@@/.test(restored)) {
          /* A placeholder was lost: keep the original rather than ship a mangled line. */
          dropped++;
          line += unmask(p.unit, p.unit.masked);
        } else {
          line += restored;
        }
      }
      out.push(line);
    }
    if (dropped) {
      unresolved += dropped;
      console.warn(`  ! ${relative(ROOT, task.src)}: ${dropped} line(s) kept in Chinese (placeholder lost)`);
    }
    /* Same placeholder mapping as the content pipeline: the model keeps
       backticked tags verbatim, so Chinese placeholders are fixed up here. */
    const text = localizeDocPaths(out.join("\n")).replace(/<(数据集|类目|数据源|数字)>/g, (m) =>
      ({ "<数据集>": "<dataset>", "<类目>": "<category>", "<数据源>": "<source>", "<数字>": "<index>" })[m] ?? m,
    );
    if (DRY) continue;
    mkdirSync(dirname(task.dst), { recursive: true });
    if (!existsSync(task.dst) || readFileSync(task.dst, "utf8") !== text) {
      writeFileSync(task.dst, text);
      wrote++;
    }
  }
  console.log(`${scope}: ${DRY ? "would write" : "wrote"} ${wrote}/${tasks.length} files` + (unresolved ? `, ${unresolved} unresolved units` : ""));
}

async function main(): Promise<void> {
  if (!ONLY || ONLY === "docs") await run("docs");
  if (!ONLY || ONLY === "analysis") await run("analysis");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
