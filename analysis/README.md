# Analysis

Long-form, human-readable analysis of the two public RL runs, plus the numeric
dumps that back every figure.

> English | [简体中文](#简体中文)

## Layout

```
analysis/
├── zh-CN/                  canonical (hand-written)
│   ├── notes/              research notes, 01–15 + three rounds of web research
│   │   └── refs/           reference material kept for citation checking
│   ├── reports/            A1 dashboard walkthrough, A2 training insights 1–3,
│   │                       A3 benchmark step-change table
│   ├── numbers/            A3-*-numbers.json — recomputable dumps from src/*_report.ts
│   └── guides/             rendered HTML guides (Chinese)
└── en/                     generated from zh-CN by `bun run translate:docs`
```

The Chinese tree is canonical. The English tree is generated; never hand-edit
it — edit the Chinese file and re-run the translation.

## Notes index

| File | What it covers |
| --- | --- |
| `01-site-map-and-data-sources.md` | Page structure, every endpoint, update cadence |
| `02-metric-inventory.md` | The 2,000+ metric names the dashboard exposes, plus the official descriptions |
| `03-metric-timeline.md` | Step-by-step value tables, first/last comparison, benchmark scores, notices |
| `04-observation-log.md` | Condensed capture timeline |
| `05-identity-checks-and-derived-quantities.md` | Identity checks, cost/throughput derivations, correlations |
| `06-pitfalls-when-reading-the-dashboard.md` | Structural traps and how to verify around them |
| `07-flash-stop-and-resource-mix.md` | How to read flash's orderly stop, and the data mix |
| `08-generation-length-surge.md` | The generation-length curve: ten reading rules, glossary |
| `09-generation-length-correlation.md` | Correlation against length across ~1,950 metrics, with differencing and event exclusion |
| `10-metric-space-and-latent-factors.md` | Effective degrees of freedom, principal components, redundancy |
| `11-per-dataset-heterogeneity.md` | Per-dataset strength, composition effects, length–score elasticity |
| `12-reward-and-grading-structure.md` | Reward distribution, trainable-pool shrinkage, grading funnel, rubric tiers |
| `13-async-pipeline-and-machine-time.md` | Wall-clock decomposition, restart gaps, queueing, staleness, back-pressure |
| `14-benchmark-credibility-and-saturation.md` | Minimum detectable change, autocorrelation, lags, saturation projection |
| `15-metric-credibility-audit.md` | Which metrics are trustworthy: constant, sentinel, coverage, breakpoints |
| `research-A-rl-metric-semantics.md` | What RL metrics mean (~30k characters, 221 sources) |
| `research-B-chinese-practitioner-notes.md` | Practitioner tuning and monitoring experience |
| `research-B-raw-*.md` | Verbatim excerpts behind the above (frameworks, pitfalls, agentic) |
| `research-C-english-community.md` | English-community reading of the public run (38 sources) |
| `research-C-chinese-community.md` | Chinese-community reading and criticism (25 pages) |

## Reproducing the numbers

Every figure in the reports and notes is recomputed from `data/store/` by a
script in `src/`; none of them hard-codes a conclusion number.

```bash
bun run report:length      # notes/08  shape, multiplicative decomposition, ceiling, correlation
bun run report:correlate   # notes/09  all metrics × length, plus differencing and event exclusion
bun run report:factor      # notes/10  effective dof, PCA, redundancy, change points
bun run report:dataset     # notes/11  per-dataset strength, composition, elasticity
bun run report:reward      # notes/12  reward distribution, pool shrinkage, grading funnel
bun run report:pipeline    # notes/13  wall-clock split, gap composition, queueing, back-pressure
bun run report:bench       # notes/14  MDE, autocorrelation, lags, saturation
bun run report:audit       # notes/15  all-metric credibility audit
bun run report:sampler     # sampler table column-by-column recomputation
```

Most scripts accept `--json` to emit the numbers only. The `numbers/` dumps are
checked in so the reports stay verifiable offline; they can be deleted and
regenerated at any time.

`guides/` holds rendered HTML guides. They are Chinese-only artifacts; the
bilingual feature overview lives at `site/features.html`.

---

## 简体中文

这里是两次公开 RL 训练的成篇分析，以及支撑每个数字的复算产物。

```
analysis/
├── zh-CN/                  正文（人写，权威）
│   ├── notes/              调研笔记 01–15，外加三轮联网调研
│   │   └── refs/           核对引用时留下的参考材料
│   ├── reports/            A1 看板解读、A2 训练洞察 1–3、A3 评测单步变化判定表
│   ├── numbers/            A3-*-numbers.json，由 src/*_report.ts 复算产出
│   └── guides/             渲染好的 HTML 讲解页
└── en/                     由 `bun run translate:docs` 从 zh-CN 生成
```

**中文是正文，英文是生成物。** 英文目录不要手改 —— 改中文再重新翻译。

每个数字都由 `src/` 下的脚本从 `data/store/` 现算，脚本里没有硬编码任何结论数字；
复算命令见上表（`bun run report:*`）。`numbers/` 里的 JSON 是为了让报告能离线核对，
不需要时删掉即可，随时能重算。

`guides/` 里的 HTML 讲解页是中文单语产物；双语的功能说明在 `site/features.html`。
