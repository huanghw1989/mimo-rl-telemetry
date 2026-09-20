# mimo-rl-telemetry

**English** | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Bun >= 1.1](https://img.shields.io/badge/bun-%E2%89%A51.1-black.svg)
![Release v1.0.0](https://img.shields.io/badge/release-v1.0.0-blue.svg)

Enhanced telemetry for Xiaomi MiMo's $2M+ live RL run: interactive metric explainers,
cross-curve correlation analysis, and step-by-step historical replay.

**What this is.** The MiMo team publishes a live dashboard for the reinforcement-learning
training of `mimo-v2.6-pro` and `mimo-v2.6-flash` at <https://mimo.xiaomi.com/rl/>. This
project archives that stream, replays it, and explains it. It syncs the public JSON API
into a local warehouse, serves a dashboard that adds replay, metric explainers, data
insights, provenance and cross-chart analysis on top of the original page, and ships a
long-form analysis of the run in both English and Chinese.

> **Unofficial, community project.** This is not affiliated with, endorsed by, or
> maintained by Xiaomi or the MiMo team. It reads only the public dashboard API. The
> upstream dashboard and the unmodified assets copied under `site/` and `data/upstream/`
> remain the property of Xiaomi MiMo; see [Credits](#credits).

## Why it exists

The upstream dashboard shows **"now"**. Three days into a training run you can no longer
see:

- what the curves looked like earlier — only the latest step;
- what a notice said at a given step, or when a given step finished;
- what a metric actually means, beyond one English sentence — and only 22 tags have an
  official description at all.

This project fixes that. It keeps an authoritative local warehouse of every value the site
has ever published, adds a replay layer over the original page, and pairs every metric and
every finding with a written explanation, a source, or a recomputation script.

## Highlights over the official dashboard

| Capability | Official dashboard | This project |
| --- | --- | --- |
| History | current state only | replay any captured sync point; deep link with `?asof=<epoch>` |
| Metric explainers | a one-line English description for 22 tags | **116 explainers** across 9 groups: what it measures, how it is computed, why to watch it, what this run showed, and how it is misread |
| Data insights | none | **34 insights** mined from the data, each with numbers and a recomputation path |
| Provenance | none | **149 citation entries** (109 deduplicated materials) with verbatim quotes, plus **32 explicit search gaps** where no public material supports the reading |
| Reading one step across charts | each chart hovers independently | linked crosshair: click a step on any chart and every chart jumps to it |
| "Why did this step jump?" | not available | **analyze this step**: per-step outliers, rank and detrended correlation against an anchor curve, and the events (restart, version change, notice) inside that step's window |
| Notices | an ever-growing English-only list | Chinese translations, a `pro@s17` / `flash@s24` step badge on every notice, and jump-to-step |
| Chart selection | fixed set of pinned charts | custom boards: save your own chart sets as tabs |
| Offline use | requires the live site | `bun run export` writes a self-contained `site/offline.html` |
| UI language | English | English default, one-click Chinese toggle |

See [`site/features.html`](site/features.html) for the full feature page.

## Quick start

Prerequisites: [Bun](https://bun.sh) **>= 1.1**. Network access is needed only for
syncing from upstream, verifying citations, and translation.

```bash
git clone https://github.com/huanghw1989/mimo-rl-telemetry.git
cd mimo-rl-telemetry

bun install          # no runtime dependencies
bun run server       # -> http://127.0.0.1:8787/  (builds the SQLite index on first run)
```

The repository ships with a complete data snapshot in `data/store/` (pro through step 27,
flash through step 30), so the dashboard renders immediately and the analysis scripts run
without any upstream access. `data/telemetry.sqlite` is a derived index, so it is not
committed: the server builds it from `data/store/` on first start, and `bun run reindex`
does the same thing explicitly (no network either way).

You do **not** need an API key or a model to run the dashboard. Copy the environment
template only if you want translation:

```bash
cp .env.example .env    # only needed for translation (notices / content / docs)
```

`.env.example` documents `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `TEXT_MODEL`; the
default model is `gpt-5.6-luna`. Nothing in the dashboard itself calls a model.

Other entry points:

```bash
bun run sync         # incremental fetch from the upstream API, then update the index
bun run bootstrap    # rebuild the warehouse from raw seed snapshots in data/seed/ (optional, not shipped)
bun run export       # write the offline single-file copy: site/offline.html
```

## Feature tour

### Historical replay
The upstream page has no history. The telemetry layer adds a replay toggle: pick any
captured sync point and the whole dashboard renders that instant — run status cards, the
steps completed by then, the notices published by then, and the dynamic-sampler tables as
they stood. The replay clock is frozen, the timeline slider steps between captures, and
`?asof=<epoch>` deep-links straight into a slice. Replay works offline as well.

### Metric explainers
116 explainers cover the 18 pinned home-page charts, every metric family (`actor`,
`critic`, `penalty`, `partial`, `dynsam`, `ctx`, `env`, `timing`), grader-group
statistics, the benchmark boards, and the dynamic-sampler tables (7 column-by-column
entries). Each entry answers four questions — what the number measures, how it is derived,
why it matters during training, and what this run actually showed — and ends with a list
of common misreadings. Clicking any chart surfaces the explainer for that metric in place.

### Data insights
34 conclusions extracted from the data, each with key numbers and a documented way to
check them. They are grouped by type (structural fact, counterintuitive, method, numeric)
and every one carries a provenance entry that names the recomputation script and its
calibration.

### Provenance and search gaps
Read the source graph in reverse: 149 citation entries (papers, technical reports, blogs,
official docs, and `self` entries for our own recomputations) each record title, authors,
year, a link, and a **verbatim quote**, plus whether they support, bound, or merely
contextualize a claim. Where nothing public supports a reading, the entry is listed as a
**search gap** (32 of them) instead of being presented as documented. Verified entries are
re-checked with `bun run verify-sources`.

### Linked crosshair
Turn on linkage, click a step on any chart, and every chart on the page marks that step:
the crosshair, the value points, the readout box, and each card's value column all switch
from "latest" to "at this step". A run that has not reached the step falls back to its
nearest step and says so (`@s19`) rather than drawing a marker that does not line up.

### Notices
Notices get a Chinese translation, a `pro@s17` / `flash@s24` badge for the step each run
had completed when it was published, a compare-with-original toggle, and a jump-to-step
slider. Translations live in `content/notices.zh.json`; `bun run sync` translates new
notices automatically, and a hand-edited translation is never overwritten unless the
English original changes.

### Custom boards
The pinned home-page charts are fixed upstream. Here you can build your own chart sets as
tabs: batch-select metrics from the metrics page or the editor, switch tabs, and keep
several boards. Boards live in `localStorage`, so they follow the machine and work in the
offline copy.

### Correlation: "analyze this step"
Pin a step with the linked crosshair, then hit **analyze this step**. The panel shows
three things: which of the ~2,000 metrics moved most unusually at that step (ranked by the
smaller of a z-score and a MAD scale, grouped by family), which curves move with the
anchor (rank correlation, plus a detrended first-difference version), and what else
happened in that step's window (restarts, version changes, notices, headline metrics).
Correlation points; the window events are the candidate explanation. The kernel is shared
with the offline bundle (`site/js/correlate.js`), so online and offline numbers agree.

### Offline export
`bun run export` writes `site/data/bundle.js` and a single-file `site/offline.html`. Open
the file directly: replay, explainers, insights, boards, linkage, and correlation all work
with no server and no network. The export is a snapshot of the moment it was produced.

### Bilingual UI
The site defaults to English and toggles to Chinese. The English rendering of the
explainers, insights, and sources is generated from the Chinese canonical files; see
[Bilingual content](#bilingual-content).

## Architecture

```
upstream API  ──►  src/sync.ts  ──►  data/store/            (authoritative JSON)
                                          │
                                          ├──►  data/telemetry.sqlite   (derived index, rebuildable)
                                          │
                     src/server.ts  ◄─────┴─────►  site/          (live dashboard)
                     src/export.ts  ───────────►  site/offline.html + site/data/bundle.js
```

`src/sync.ts` is the only writer of `data/store/`. The JSON warehouse is the
authoritative copy; `data/telemetry.sqlite` is a derived index that can be deleted and
rebuilt at any time (`bun run reindex`). `src/server.ts` serves the dashboard and proxies
the small live endpoints when online, while the large series endpoints come from the local
warehouse; in replay mode everything is reconstructed from the store. `src/export.ts`
reads the same store and emits the offline bundle.

**Upstream assets are copied, not forked.** A pristine copy of the upstream static files
is kept in `data/upstream/`, and the working copy is `site/`. The telemetry layer is
implemented as *new* files — `site/js/telemetry.js`, `site/js/correlate.js`, `site/telemetry.css`
— that wrap the upstream chart constructors and intercept the `api/*` requests, so the
upstream render logic is reused rather than reimplemented. Only a handful of in-place edits
to `site/js/app.js` and `site/index.html` are needed, and each is marked with a `[telemetry]`
comment so the divergence stays auditable. When upstream rewrites its frontend, `bun run
sync` reports an asset hash mismatch and the patches are re-applied deliberately instead of
a fork silently rotting; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository map

| Path | Contents |
| --- | --- |
| `src/` | the pipeline: `sync.ts` (fetch/merge), `store.ts` and `db.ts` (warehouse + index), `server.ts`, `export.ts`, the `*_report.ts` recomputation scripts, and the i18n tooling |
| `site/` | the dashboard: pristine upstream assets plus the telemetry layer (`js/telemetry.js`, `js/correlate.js`, `telemetry.css`) |
| `content/` | human-written explainers, insights, sources, and notice translations; Chinese canonical, generated `*.en.json` alongside |
| `data/` | the warehouse: `store/` (shipped JSON), `upstream/` (pristine asset copy), `telemetry.sqlite` (derived), `seed/` (optional raw snapshots for `bun run bootstrap`), `logs/` |
| `docs/` | the data and engineering documentation, paired `en` + `zh-CN` |
| `analysis/` | long-form reports, per-metric analysis notes, and machine-readable number dumps, paired `en` + `zh-CN` |

## Bilingual content

The site defaults to English and toggles to Chinese. The **Chinese files are canonical**;
the English files are generated and must not be hand-edited:

| Canonical (Chinese) | Generated (English) | Generator |
| --- | --- | --- |
| `content/metrics.json` | `content/metrics.en.json` | `bun run translate:content` |
| `content/insights.json` | `content/insights.en.json` | `bun run translate:content` |
| `content/sources.json` | `content/sources.en.json` | `bun run translate:content` |
| `docs/zh-CN/*.md` | `docs/en/*.md` | `bun run translate:docs` |
| `analysis/zh-CN/**/*.md` | `analysis/en/**/*.md` | `bun run translate:docs` |

Notice translations are the exception: `content/notices.zh.json` holds Chinese translations
of the English upstream notices, keyed by notice id, and is maintained directly (new
notices are translated automatically during sync). Terminology is pinned by a glossary in
`src/i18n_core.ts` so the same Chinese sentence always renders the same way in English.

## Reproduce every number

None of the analysis scripts hard-code a conclusion number — each one recomputes from
`data/store/`. From the repository root:

| Command | Produces |
| --- | --- |
| `bun run report:length` | generation-length shape, multiplicative decomposition, ceilings, correlations (note 08) |
| `bun run report:correlate` | every metric × length, with first-difference and event-removal robustness (note 09) |
| `bun run report:factor` | effective degrees of freedom, principal components, redundancy, change points (note 10) |
| `bun run report:dataset` | per-dataset strength, composition effects, length–score elasticity (note 11) |
| `bun run report:reward` | reward distribution, trainable-pool shrink, grading funnel and rubric scores (note 12) |
| `bun run report:pipeline` | wall-clock decomposition, restart gap, queueing, backpressure (note 13) |
| `bun run report:bench` | minimum detectable change, autocorrelation, lags, saturation extrapolation (note 14) |
| `bun run report:audit` | full metric credibility audit (note 15) |
| `bun run report:sampler` | column-by-column verification of the dynamic-sampler tables (docs 03) |
| `bun run analyze` | a general warehouse health report |
| `bun run check` | the identity self-check suite (exit code 0 means every check passed) |

## Analysis index

The long-form analysis lives under `analysis/zh-CN/` (canonical Chinese); English
renderings are generated to `analysis/en/` by `bun run translate:docs`. Takeaways:

| Document | Takeaway |
| --- | --- |
| [`notes/01-站点地图与数据来源.md`](analysis/zh-CN/notes/01-站点地图与数据来源.md) | What the page contains, which endpoints feed it, and how often it updates. |
| [`notes/02-指标清单.md`](analysis/zh-CN/notes/02-指标清单.md) | Every metric name the site exposes, grouped by namespace, plus the 22 official descriptions. |
| [`notes/03-指标时间线.md`](analysis/zh-CN/notes/03-指标时间线.md) | Per-step value tables, first/last comparison, benchmark scores, and notices. |
| [`notes/04-观测记录.md`](analysis/zh-CN/notes/04-观测记录.md) | A condensed timeline of the capture rounds. |
| [`notes/05-数值核查与派生量.md`](analysis/zh-CN/notes/05-数值核查与派生量.md) | Verified identities plus derived cost and throughput quantities. |
| [`notes/06-读看板容易踩的坑.md`](analysis/zh-CN/notes/06-读看板容易踩的坑.md) | Structural traps that silently corrupt a reading, each with a verification method. |
| [`notes/07-flash停止与资源配比解读.md`](analysis/zh-CN/notes/07-flash停止与资源配比解读.md) | How to read an orderly stop: three stop shapes, the cost rate as a machine count, three signals of "data points exhausted". |
| [`notes/08-生成长度突增解读.md`](analysis/zh-CN/notes/08-生成长度突增解读.md) | The full reading of the generation-length curve: ten decision rules and a glossary. |
| [`notes/09-生成长度相关性分析.md`](analysis/zh-CN/notes/09-生成长度相关性分析.md) | All 1,944 / 1,974 metrics correlated against length, with first-difference and event-removal robustness checks. |
| [`notes/10-指标空间与潜在因子.md`](analysis/zh-CN/notes/10-指标空间与潜在因子.md) | The ~2,000 metrics have an effective freedom of only 11–13; the first two principal components align across runs, the third is already each run's own operational detail. Participation ratio 11.21 (pro) / 12.99 (flash); 15 metrics reproduce 83.5% of the variance; cross-run per-metric trajectory correlation has a median of just 0.156. |
| [`notes/11-逐数据集异质性.md`](analysis/zh-CN/notes/11-逐数据集异质性.md) | The score gain is **not** a shift of weight onto easy tasks (mix term −0.27pp / +0.84pp); but the "total generation length" aggregate is 8%–23% composition effect. 25 datasets, cross-run gain rank correlation ρ = 0.582 (p = 0.0023). |
| [`notes/12-奖励与判分结构.md`](analysis/zh-CN/notes/12-奖励与判分结构.md) | Grading did not loosen, it tightened; the trainable-pool shrink cancels 58% of the all-correct gain. Five-dimension rubric score 4.4051 → 4.2902 (p = 2.5e-8); pool share 0.7188 → 0.5528 (flash). |
| [`notes/13-异步管线与机时账.md`](analysis/zh-CN/notes/13-异步管线与机时账.md) | The step-time gap reproduces exactly but is not all downtime — part of it is rollouts that finished and were thrown away by a `redo`. Gap: pro 26.15 h ≈ $537k (27.7% of the bill); flash 14.15 h ≈ $145k (17.0%). |
| [`notes/14-评测可信度与饱和预测.md`](analysis/zh-CN/notes/14-评测可信度与饱和预测.md) | The recent benchmark points show no statistically discernible progress: the last five points of all six series have slopes whose intervals include 0, and only 1 of 115 single-step changes survives multiple-comparison correction. DeepSWE minimum detectable change 4.56 (pro) / 6.43 (flash). |
| [`notes/15-指标可信度审计.md`](analysis/zh-CN/notes/15-指标可信度审计.md) | 16.0% (pro) / 14.7% (flash) of metrics can be discarded outright; 311 are identically zero/one/constant, 259 are "reported 0", and only 43.0% / 44.4% of breakpoints can be explained by an external event. |
| [`reports/A1-看板数据解读.md`](analysis/zh-CN/reports/A1-看板数据解读.md) | A panel-by-panel walkthrough: plain language first, then the precise meaning. |
| [`reports/A2-训练洞察-第1期.md`](analysis/zh-CN/reports/A2-训练洞察-第1期.md) – [第3期](analysis/zh-CN/reports/A2-训练洞察-第3期.md) | Three follow-ups over the first 25 steps; part 3 records which earlier judgements were confirmed and which were overturned. |
| [`reports/A3-bench-judgement-table.md`](analysis/zh-CN/reports/A3-bench-judgement-table.md) and `analysis/zh-CN/numbers/` | Machine-readable recomputations (`A3-*-numbers.json`), the candidate insights merged into the dashboard, and the 115-row per-step benchmark verdict table. |

## Key findings

All figures below are as written in the analysis window (pro step 24 / flash step 30) and
are recomputed by the scripts in [Reproduce every number](#reproduce-every-number).

1. **The home-page "trainer vs. inference-engine divergence" curve is a weighted-average
   illusion.** Global KL rises from 0.00219 to 0.00769, but the freshest data bucket only
   moves 0.00219 → 0.00264 (+20%); the global rise comes from stale data taking a larger
   share of the batch. Flash step 25 gives a second, cleaner test: after a restart the data
   is fresh, average staleness drops 2.18 → 0.32, global KL drops 0.0101 → 0.0060, while
   bucket-0 KL barely moves 0.0034 → 0.0035. Global KL correlates +0.93 with staleness;
   bucket-0 KL correlates only −0.19 / +0.20.
2. **`timing_s/step` and the run card's "elapsed this step" both omit restart waits.** Pro
   under-reports by **23.7 h** — 33% of true wall clock, worth about **$488k**; flash
   under-reports by 14.6 h (22%), about **$150k**. On steps without a restart the reported
   and true values differ by less than 10 seconds; on steps with one they differ by hours,
   so the gap really does come from restarts.
3. **The score gains come from turning half-solved tasks into always-solved ones, not from
   cracking tasks that were never solved.** Pro's `avg@n` rises **6.88 percentage points**:
   "all-correct rate up" contributes +8.41, the middle pool shrinking is −4.16, and the
   middle pool improving is +2.62. The share of prompts where none of the 16 attempts
   succeeds only falls from 14.6% to 13.5% (flash: 16.1% → 14.6%). Across 26 steps that
   wall did not move.
4. **The core cost difference is how many GPUs a token needs, not how much work is done.**
   Per-step training token volume is similar (pro averages **2.22 B**, flash **2.59 B**),
   but per **1 B tokens** pro costs **$35.2k** and flash **$10.7k** — a factor of **3.3×**.
   Cumulative at the time of writing: pro **$1.491M**, flash **$0.697M**.
5. **Generation length grows 1.68× (pro) / 2.13× (flash), and "length buys score" does not
   survive testing.** On the home page, length and mean pass rate look almost synchronized
   (rank correlation +0.79 / +0.93), but both simply rise over time. After first
   differencing, pro is −0.06 (p = 0.77) and flash is −0.48 (p = 0.008): **in the steps
   where length jumps, the pass rate tends not to rise and may fall.** The cost lands on
   the trainer — training time per 1 B tokens rises 47%–48%.
6. **The ~2,000 metrics are worth about 12 independent curves.** The effective degrees of
   freedom are 11.21 (pro) / 12.99 (flash); 15 metrics reproduce 83.5% of the variance; and
   the median cross-run correlation of per-metric trajectories is only 0.156.
7. **16% of the metrics are droppable.** 16.0% (pro) / 14.7% (flash) can be discarded
   outright, and a further batch only looks like it carries data.

## Documentation index

| Document | Contents |
| --- | --- |
| [`docs/en/01-dashboard-data.md`](docs/en/01-dashboard-data.md) | Field meanings, units, metric naming conventions, verified identities, and nine pitfalls when reading the data. |
| [`docs/en/02-architecture-and-sync.md`](docs/en/02-architecture-and-sync.md) | Directory layout, the differential sync algorithm, storage-format choices with measured sizes, the SQLite schema, and how replay / explainers / linkage / notices / boards / correlation are implemented. |
| [`docs/en/03-sampler-table-caliber.md`](docs/en/03-sampler-table-caliber.md) | What each dynamic-sampler table column means: which are API fields, which are computed in the page, which identities can be recomputed, and which claims have no public basis. |

`docs/zh-CN/` holds the canonical Chinese originals. The English files are generated by
`bun run translate:docs`; the initial English tree may be incomplete while translation runs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, how to run the checks, how to add
a metric explainer or an insight, the source-registry rules, and the bilingual workflow.
Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE). This covers this project's code and documentation.

## Credits

- The dashboard, the API, and the unmodified static assets under `site/` and
  `data/upstream/` belong to **Xiaomi MiMo** (<https://mimo.xiaomi.com/rl/>) and are
  included here only as a reference copy for local replay and diffing. They are not covered
  by this project's MIT license.
- All analytical content in this repository is derived from the publicly available
  dashboard data and public sources, which are cited verbatim in `content/sources.json`.
- Built with [Bun](https://bun.sh). The local dashboard uses Bun's built-in SQLite driver
  and has no runtime dependencies.
