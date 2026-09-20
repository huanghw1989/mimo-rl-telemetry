# mimo-v2.6 RL dashboard: site map and data sources

> Recorded at: 2026-09-17 (UTC+8, that evening). Page: https://mimo.xiaomi.com/rl/
> This document only covers "what is on the dashboard, where the data comes from, and how often it updates"; it does not involve data interpretation. For interpretation, see the two reports under `analysis/`.

---

## 1. What this page is

The Xiaomi MiMo team has opened its two large reinforcement learning training runs directly on the public internet; the page calls itself "mimo-v2.6 RL",
The subtitle reads "two reinforcement learning training runs, mimo-v2.6-pro and mimo-v2.6-flash, read directly from the trainer's logs".
At the bottom of the page it says "streaming since 2026-09-16 04:00 UTC" (i.e., the public stream started at 12:00 Beijing time on 09-16).

Start times of the two training runs (as labeled by the page itself):

| Run | Start time (UTC) | Start time (Beijing time) |
| --- | --- | --- |
| mimo-v2.6-pro | 2026-09-15 10:32 | 09-15 18:32 |
| mimo-v2.6-flash | 2026-09-15 15:16 | 09-15 23:16 |

That is, when the stream started, the two training runs had already been running for about a day and a half.

---

## 2. Page structure (three tabs)

At the top of the page there are three anchors, `overview` / `metrics` / `about`, which are actually different views of the same page:

### 1. overview (overview, default page)

From top to bottom, they are:

1. **Top bar time and world clock**: real-time times for the four cities Beijing / Los Angeles / New York / London, plus "Toggle theme" to switch between light and dark themes.
2. **TOTAL COST**: cumulative cost of the two training runs (USD); the number ticks every second.
3. **notices (announcements)**: short messages manually published by the official team, with relative times of the form "N hours ago". As of recording, there are 3 in total: one flash rerun from step 15 (some kind of infrastructure error was not correctly identified for about 3 hours), one pro restart due to a VRAM issue on a node, and one offline evaluation score update.
4. **Two run cards**: corresponding to pro and flash respectively, each showing:
   - Run name + `in progress` status
   - Current step number
   - Elapsed runtime (like `2d 00:16:18`)
   - Start time
   - A one-line stage hint, e.g. `step 19: training · 2,616/1,568 accepted · 1h 04m in`, or `restarting · trainer relaunched 1h 19m ago`
   - Six numbers: `dynsam/avg@n` (and change relative to step 1), `cost so far`, `tokens · step N`, `tokens · total`, `samples trained`, `train batch size × n` (fixed 1,568 × 16seqs)
5. **benchmarks (benchmarks)**: currently only one item, DeepSWE v1.1 (mini-swe-agent, avg@3), giving the scores at the current best step for the two training runs. This section updates the slowest; the official announcement says "offline evaluation results will continue to be posted as they come out".
6. **Main chart area**: the x-axis can be switched between `step` / `time`, the y-axis between `linear` / `log`, and there is a `smoothing` smoothing slider. Below are thumbnails for 18 metrics (official pins), each showing the current values for both runs and an arrow for the change relative to the previous step.
7. **dynamic sampler (dynamic sampler)**: divided into two sections, pro / flash. On the left is a scrolling log (`feed`), about one entry every 30 seconds; the format is
   `accepted 2,616/1,568 · judged 2,458 · pass 0.601 (n=12,189) · remaining 89 +1,057 partial +396 rewarding · prewarm 292`；
   On the right is the **per-data-source detail table for the current step**, with columns `source / accepted、target / remaining / judged / in flight`.
8. **batch composition (batch composition)**: can switch between "by data source" or "by harness (the one actually trained)", can switch pro / flash, and can switch between "count" or "share". It currently shows "how many prompts were trained at each step and which broad category they belong to", with a stacked bar chart by step.

### 2. metrics (metrics browser)

On the left is a tree, grouped by first-level namespace (`actor` 257, `critic` 324, `ctx_prompt_length` 81 …),
In the upper right it says `all 2069 tags`. At the top there is a filter box, supporting substrings and `/正则/`.
Clicking any metric opens a modal, containing the metric's **official one-sentence explanation** (if any), the `last / Δ / min / max / mean / points` for the two runs, and a line chart.
When the modal is open, the address bar changes to `#chart/<URL编码的指标名>`, so you can directly share a link to a single metric.

### 3. about (about)

It contains only one sentence: "We are streaming our RL big runs. The mimo-v2.6 series is coming soon." and the X account @XiaomiMiMo.

---

## 3. Data APIs (the JSON behind the page)

The page itself is a frontend application; all data comes from public GET endpoints under the same domain. These endpoints require no login and no token,
With ordinary HTTP requests, you can get exactly the same JSON as the page. Understanding this is the prerequisite for this project's "continuous monitoring".

| Interface | Effect |
| --- | --- |
| `/rl/api/runs` | Run list, the list of metrics fixed on the homepage, number formatting rules, **22 official metric explanations**, batch composition configuration, footer text |
| `/rl/api/status?run=pro\|flash` | Current status of a single run: cost, current step, stage (`rollout`, etc.), progress, cumulative token / sandbox count, number of restarts, and the **complete event sequence for each step** (step value, increment, tokens, whether it was rerun, restart time point) |
| `/rl/api/live?run=pro\|flash` | The **latest sampling log entry** of the dynamic sampler, including `latest` summary fields and the most recent 60 scrolling detail entries |
| `/rl/api/notices` | Official announcements |
| `/rl/api/benchmarks` | Offline benchmark scores, organized by step |
| `/rl/api/tags?run=pro\|flash` | All metric names for that run (pro 2019, flash 2052) and the current data version number `v` |
| `/rl/api/series?run=&v=&tags=` | Step-by-step history for a specified metric. Metric names are very long, so requests must be batched; otherwise the URL is too long and returns 414 |

The page itself only requests the batch of metrics on the homepage on each refresh; it only fetches more series on demand after switching to the metrics view.

**Data version number** (`v`) has the form `3-5513.14.7.0` (pro) and `3-5513.20.3.16` (flash),
The version numbers of the two runs are different. After each restart, the step sequence is rearranged (flash's step 16 and 17 carry an `redo: true` marker),
The `steps` array returned by the `series` endpoint is the currently valid step list.

---

## 4. Update cadence

| Content | Update frequency (measured) |
| --- | --- |
| TOTAL COST, elapsed runtime, world clock | Every second (estimated locally on the frontend + aligned with the server) |
| step / stage / `since` on the run cards | On the order of ten-odd seconds |
| dynamic sampler scrolling log | approx. one per 30 seconds |
| Metric values for each step | Written at the end of a step; the interval between steps is usually 1.5~3 hours |
| notices | Manual publishing |
| benchmarks | Manually updated, slowest (by day) |

**Key implication**: the vast majority of "points on the curve" on the dashboard are **one point per step**, and one step takes 1.5~3 hours to run.
So the only genuinely high-frequency data is cost, the clock, the dynamic sampler log, and the progress of the current step.
The monitoring frequency for this project is therefore set to once every 20 minutes—enough to capture step boundaries, restarts, and sampler anomalies, without producing meaningless duplicate data.

---

## 5. Data organization in this directory

```
analysis/en/
├── README.md                     index
├── notes/
│   ├── docs/en/01-site-map-and-data-sources.md    ← this file
│   ├── docs/en/02-metric-inventory.md             all metric names exposed by the site + official descriptions
│   ├── docs/en/03-metric-timeline.md           step-by-step numeric table, first/last comparison, baseline table, announcements
│   ├── docs/en/04-observation-log.md             compact timeline with one entry per collection
│   ├── research-A-*.md            metric meaning research (online)
│   └── research-B-*.md            research on Chinese practitioners' experience (online)
├── analysis/                      two formal analysis reports
├── output/                        final HTML explainer
└── data/
    ├── raw/<UTC timestamp>/            complete raw JSON for each collection (runs/status/live/tags/series/…)
    ├── snapshots.jsonl            compact records, one line per collection
    ├── latest.json                compact record of the latest collection
    └── monitor.log                run log of the background monitoring loop
```

The collection script is under `codes/scripts/` in the project root directory (per project convention, scripts are not placed in the tasks subdirectory):

- `capture_mimo_rl.py` —— collect all endpoints once and write to disk
- `monitor_mimo_rl.ps1` —— call the above script in a loop at a fixed interval
- `analyze_mimo_rl.py` —— organize raw snapshots into `notes/03`, `notes/04`
- `inventory_mimo_rl.py` —— generate `notes/02`
