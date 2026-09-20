/**
 * i18n gate for the telemetry layer.
 *
 *   bun src/check_i18n.ts
 *
 * The telemetry layer (site/js/telemetry.js) is written in Chinese and English is the
 * default, so every user-visible Chinese string must go through T(...) — the
 * runtime lookup defined in site/js/i18n.js. This script proves that none was
 * missed.
 *
 * It scans the raw source with a small hand-written JS scanner rather than a
 * regex, because a regex cannot tell a string literal from a comment or from a
 * regex literal. Both of those occur here:
 *
 *   // 图例里的中文说明              <- comment, must be ignored
 *   s.replace(/["\\]/g, "")          <- regex literal holding a quote, must not
 *                                       open a bogus string
 *
 * A string is accepted only when it is a direct argument of a `T(` call, i.e.
 * the innermost enclosing bracket context belongs to an identifier named `T`.
 * Template literals are handled as text chunks plus `${...}` substitutions, so
 * interpolation does not swallow the rest of the file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Han ideographs (incl. extension A and the compatibility block) plus CJK
 * punctuation and fullwidth forms. The extra ranges matter because a lone
 * Chinese full stop or fullwidth bracket is just as visible as a Han glyph,
 * even though it is not a "Han character" in the narrow sense.
 */
const HAN = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** After these keywords a `/` starts a regex literal, not a division. */
const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

type TokKind = "ident" | "num" | "str" | "regex" | "punct";
interface Tok { kind: TokKind; value: string }

type CtxKind = "paren" | "brace" | "bracket" | "subst" | "template";
interface Ctx { kind: CtxKind; isT: boolean }

interface Offender { line: number; col: number; text: string }

interface ScanResult {
  offenders: Offender[];
  /** Chinese string literals found in total (wrapped or not). */
  total: number;
  /** Chinese string literals that pass the T(...) check. */
  wrapped: number;
}

function scan(src: string): ScanResult {
  const offenders: Offender[] = [];
  const stack: Ctx[] = [];
  let prev: Tok | null = null;
  let i = 0;
  const n = src.length;
  let line = 1;
  let inTemplate = false;
  let total = 0;

  const columnAt = (pos: number): number => pos - Math.max(src.lastIndexOf("\n", pos - 1), -1);

  const check = (text: string, atLine: number, col: number): void => {
    if (!HAN.test(text)) return;
    total++;
    /* Direct argument of T(...): walk down past template frames to the nearest
       real bracket context. A template frame is transparent because the whole
       template is the argument. */
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].kind === "template") continue;
      if (stack[k].isT) return;
      break;
    }
    offenders.push({ line: atLine, col, text });
  };

  const regexAllowed = (): boolean => {
    if (!prev) return true;
    if (prev.kind === "punct") return prev.value !== ")" && prev.value !== "]" && prev.value !== "}";
    if (prev.kind === "ident") return REGEX_AFTER_KEYWORD.has(prev.value);
    return false;
  };

  while (i < n) {
    /* ---- inside a template literal's text run ---------------------------- */
    if (inTemplate) {
      const startLine = line;
      const startCol = columnAt(i);
      let buf = "";
      while (i < n) {
        const c = src[i];
        if (c === "\\") {
          buf += src.slice(i, i + 2);
          if (src[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (c === "`") break;
        if (c === "$" && src[i + 1] === "{") break;
        if (c === "\n") line++;
        buf += c;
        i++;
      }
      check(buf, startLine, startCol);
      if (i >= n) { inTemplate = false; break; }
      if (src[i] === "`") {
        i++;
        stack.pop(); // matching "template" frame
        inTemplate = stack.length > 0 && stack[stack.length - 1].kind === "template";
        prev = { kind: "str", value: "`" };
        continue;
      }
      // "${" -> scan the substitution as normal JS
      i += 2;
      stack.push({ kind: "subst", isT: false });
      inTemplate = false;
      prev = null;
      continue;
    }

    const ch = src[i];

    if (ch === "\n") { line++; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") { i++; continue; }

    /* ---- comments -------------------------------------------------------- */
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
      i = stop;
      continue;
    }

    /* ---- string literals ------------------------------------------------- */
    if (ch === '"' || ch === "'") {
      const startLine = line;
      const startCol = columnAt(i);
      const quote = ch;
      i++;
      let buf = "";
      while (i < n) {
        const c = src[i];
        if (c === "\\") {
          buf += src.slice(i, i + 2);
          if (src[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (c === quote) { i++; break; }
        if (c === "\n") line++;
        buf += c;
        i++;
      }
      check(buf, startLine, startCol);
      prev = { kind: "str", value: quote };
      continue;
    }

    /* ---- template literal starts ----------------------------------------- */
    if (ch === "`") {
      i++;
      stack.push({ kind: "template", isT: false });
      inTemplate = true;
      continue;
    }

    /* ---- regex literal (only when a value cannot precede it) ------------- */
    if (ch === "/" && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < n) {
        const c = src[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-zA-Z]/.test(src[i])) i++;
      prev = { kind: "regex", value: "/" };
      continue;
    }

    /* ---- identifiers / numbers ------------------------------------------- */
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
      prev = { kind: "ident", value: src.slice(start, i) };
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      while (i < n && /[0-9A-Fa-fxXoObBeE._n]/.test(src[i])) i++;
      prev = { kind: "num", value: "0" };
      continue;
    }

    /* ---- brackets -------------------------------------------------------- */
    if (ch === "(") {
      const isT = !!prev && prev.kind === "ident" && prev.value === "T";
      stack.push({ kind: "paren", isT });
      prev = { kind: "punct", value: "(" };
      i++;
      continue;
    }
    if (ch === "[") { stack.push({ kind: "bracket", isT: false }); prev = { kind: "punct", value: "[" }; i++; continue; }
    if (ch === "{") { stack.push({ kind: "brace", isT: false }); prev = { kind: "punct", value: "{" }; i++; continue; }
    if (ch === ")" || ch === "]" ) {
      if (stack.length && (stack[stack.length - 1].kind === "paren" || stack[stack.length - 1].kind === "bracket")) stack.pop();
      prev = { kind: "punct", value: ch };
      i++;
      continue;
    }
    if (ch === "}") {
      const top = stack[stack.length - 1];
      if (top && top.kind === "subst") {
        stack.pop();
        inTemplate = stack.length > 0 && stack[stack.length - 1].kind === "template";
      } else if (top && top.kind === "brace") {
        stack.pop();
      }
      prev = { kind: "punct", value: "}" };
      i++;
      continue;
    }

    /* ---- any other punctuation ------------------------------------------- */
    prev = { kind: "punct", value: ch };
    i++;
  }

  return { offenders, total, wrapped: total - offenders.length };
}

function main(): void {
  /* Optional argument is only for self-tests; the project default is the
     telemetry layer itself. */
  const target = process.argv[2] ?? join(import.meta.dir, "..", "site", "js", "telemetry.js");
  let src: string;
  try {
    src = readFileSync(target, "utf8");
  } catch (e) {
    console.error(`cannot read ${target}: ${(e as Error).message}`);
    process.exit(2);
  }

  const { offenders, total, wrapped } = scan(src);
  const rel = process.argv[2] ?? "site/js/telemetry.js";

  if (offenders.length) {
    console.error(`${rel}: ${offenders.length} Chinese strings not wrapped in T(...):\n`);
    for (const o of offenders) {
      const snippet = o.text.length > 90 ? o.text.slice(0, 87) + "..." : o.text;
      console.error(`  ${rel}:${o.line}:${o.col}  ${JSON.stringify(snippet)}`);
    }
    console.error(`\nsummary: ${wrapped}/${total} wrapped, ${offenders.length} to fix.`);
    process.exit(1);
  }

  console.log(`${rel}: ${total} Chinese strings, all wrapped in T(...).`);
  console.log("i18n check passed.");
}

main();
