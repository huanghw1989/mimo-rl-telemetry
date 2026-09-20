/**
 * Paths and shared constants. Every script reads its paths from here so that
 * no file has to assemble directory strings on its own.
 *
 * Layout (all paths are relative to the repository root):
 *   site/                the local dashboard (upstream assets + the telemetry layer)
 *   content/             metric explainers, insights, sources, notice translations
 *   data/                the local data warehouse
 *     ├── store/         JSON warehouse, human readable, the authoritative copy
 *     ├── telemetry.sqlite  SQLite index, derived from store/, rebuildable at will
 *     ├── upstream/      pristine copies of the upstream static assets (for diffing)
 *     ├── seed/          optional raw snapshots used by `sync --bootstrap`
 *     └── logs/          sync logs
 *   docs/                documentation (docs/en, docs/zh-CN)
 *   analysis/            long-form analysis reports (analysis/en, analysis/zh-CN)
 */
import { join } from "node:path";

/** Repository root. This file lives in <root>/src/. */
export const ROOT = join(import.meta.dir, "..");

export const SITE = join(ROOT, "site");
export const DOCS = join(ROOT, "docs");
export const ANALYSIS = join(ROOT, "analysis");
export const ANALYSIS_ZH = join(ANALYSIS, "zh-CN");
export const ANALYSIS_EN = join(ANALYSIS, "en");
/** Recomputable numeric dumps produced by src/*_report.ts. */
export const NUMBERS_DIR = join(ANALYSIS_ZH, "numbers");
export const NOTES_DIR = join(ANALYSIS_ZH, "notes");
export const REPORTS_DIR = join(ANALYSIS_ZH, "reports");

export const DATA = join(ROOT, "data");
export const STORE = join(DATA, "store");
export const UPSTREAM = join(DATA, "upstream");
export const LOGS = join(DATA, "logs");
export const DB_PATH = join(DATA, "telemetry.sqlite");
export const STATE_PATH = join(DATA, "sync_state.json");

/** Metric explainers and insights. Human-written, version controlled, never touched by sync. */
export const CONTENT = join(ROOT, "content");
export const METRICS_JSON = join(CONTENT, "metrics.json");
export const METRICS_EN_JSON = join(CONTENT, "metrics.en.json");
export const INSIGHTS_JSON = join(CONTENT, "insights.json");
export const INSIGHTS_EN_JSON = join(CONTENT, "insights.en.json");
/** Source registry: title, author, link and verbatim quote of every citation. */
export const SOURCES_JSON = join(CONTENT, "sources.json");
export const SOURCES_EN_JSON = join(CONTENT, "sources.en.json");
/** Chinese translations of the upstream notices, indexed by notice id. */
export const NOTICES_ZH_JSON = join(CONTENT, "notices.zh.json");
/** Site metadata captured from upstream; its `descriptions` are the official metric docs. */
export const META_JSON = join(STORE, "meta.json");

/** Optional raw snapshots (one directory per capture, `YYYYMMDDTHHMMSSZ`) for `sync --bootstrap`. */
export const BOOTSTRAP_RAW = join(DATA, "seed");

export const API_BASE = "https://mimo.xiaomi.com/rl/api";
export const SITE_BASE = "https://mimo.xiaomi.com/rl/";

/** Upstream static assets. Sync fetches these too so it can detect a frontend rewrite. */
export const ASSETS = [
  "index.html",
  "style.css",
  "favicon.svg",
  "fonts/InterVariable.woff2",
  "js/theme.js",
  "js/format.js",
  "js/charts.js",
  "js/app.js",
];

/** Maximum encoded URL length for a single GET. Measured 414 above ~5000 characters. */
export const MAX_ENCODED_CHARS = 5000;

/** store/ format version. Bump on breaking field changes; sync will ask for a rebuild. */
export const SCHEMA_VERSION = 1;

/**
 * Default chat model for the auxiliary LLM calls (notice translation, content and
 * documentation translation). Override with TEXT_MODEL in the environment or `.env`.
 */
export const DEFAULT_TEXT_MODEL = "gpt-5.6-luna";

/** Supported locales for the website and the documentation. */
export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
