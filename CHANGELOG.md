# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-20

Initial public release: the telemetry tool and the analysis project, extracted from the
author's private workspace into a single standalone repository.

### Added

- **Data pipeline.** `src/sync.ts` fetches the public dashboard API
  (<https://mimo.xiaomi.com/rl/>) into a JSON warehouse under `data/store/`, with an
  incremental merge, an optional `--bootstrap` path that rebuilds from raw seed snapshots,
  and a derived SQLite index (`data/telemetry.sqlite`) rebuilt by `bun run reindex`.
- **Local dashboard.** `src/server.ts` serves the telemetry layer at
  `http://127.0.0.1:8787/`, and `src/export.ts` writes a self-contained offline copy
  (`site/offline.html` + `site/data/bundle.js`).
- **Telemetry layer features.** Historical replay (`?asof=<epoch>`), 116 metric explainers
  across 9 groups, 34 data insights, a 149-entry provenance registry with 32 explicit
  search gaps, linked crosshair across charts, "analyze this step" correlation analysis,
  bilingual notices with `pro@s17` / `flash@s24` step badges, custom boards, and the
  offline export.
- **Bilingual site and content.** The dashboard defaults to English and toggles to Chinese.
  `content/metrics.json`, `insights.json`, and `sources.json` are Chinese canonical, with
  generated `*.en.json` editions; `docs/` and `analysis/` are paired `zh-CN` / `en` trees.
- **Feature page.** `site/features.html`, the standalone full feature page linked from both
  READMEs.
- **Generated English content and documentation.** `bun run translate:content` and
  `bun run translate:docs` produce the English content and documentation from the Chinese
  originals, with a content-hash cache and a pinned terminology glossary.
- **Merged analysis reports.** 15 long-form analysis notes (site map, metric inventory,
  timeline, observation log, identity checks, pitfalls, the flash stop, generation length
  and its correlation, latent-factor structure, per-dataset heterogeneity, reward and
  grading, async pipeline and machine time, benchmark credibility, metric credibility) plus
  the A1 dashboard walkthrough, the three A2 training-insight issues, and the A3
  machine-readable numbers and 115-row benchmark judgement table.
- **Recomputation scripts.** Nine `bun run report:*` scripts, `bun run analyze`, and
  `bun run check`, all recomputing from `data/store/` with no hard-coded conclusion numbers.
- **Project documentation.** `README.md`, `README.zh-CN.md`, this changelog, an MIT
  `LICENSE`, and `CONTRIBUTING.md` covering the checks, the content and source workflow, and
  the upstream re-diff procedure.

### Changed

- **Renamed the concept from "telemetry" to "telemetry."** The project, its documentation, and
  its copy now describe a *telemetry layer* over the upstream dashboard. Files that the
  running site depends on (`site/js/telemetry.js`, `site/telemetry.css`, and the `[telemetry]`
  in-place markers in `site/js/app.js` and `site/index.html`) keep their historical names so
  the upstream diff stays auditable.
- **Consolidated the two private workstreams** — the sync/replay tool and the long-form
  analysis project — into one repository with one set of scripts and one data warehouse.
- **Default UI locale is English**, with Chinese as the canonical authoring language.
- **Default translation model is `gpt-5.6-luna`**, documented in `.env.example` alongside
  `OPENAI_API_KEY` and `OPENAI_BASE_URL`.

### Notes

- The repository ships with a complete `data/store/` snapshot (pro through step 27, flash
  through step 30), so the dashboard renders and the report scripts run without upstream
  access. The written analysis in `content/` and `analysis/` uses the pro step 24 / flash
  step 30 window; the snapshot has since advanced.
- The dashboard needs no model and no API key. A model is used only for translation of
  notices, content, and documentation; translation failures never fail a sync.
- There are no runtime dependencies; only Bun >= 1.1 is required.
- The upstream dashboard and the unmodified assets under `site/` and `data/upstream/`
  belong to Xiaomi MiMo and are included only as a reference copy. The MIT license covers
  this project's code and documentation; the analytical content is derived from public data
  and cites its sources verbatim in `content/sources.json`.

[1.0.0]: https://github.com/huanghw1989/mimo-rl-telemetry/releases/tag/v1.0.0
