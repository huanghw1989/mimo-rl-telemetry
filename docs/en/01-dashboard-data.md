# mimo RL dashboard data documentation

This document explains clearly where the data on the `https://mimo.xiaomi.com/rl/` page comes from, what each field means,
what the units are, which parts can be trusted directly, and which parts warrant caution.

All content comes from actual scraping (about 18 syncs between 2026-09-17 and 2026-09-18), not copied verbatim from the page's text.
Wherever the official source provides an explanation, I mark it as "official explanation"; wherever I infer it myself, I state that it is an inference.

---

## 1. Where the data comes from

The page itself is a static site; all numbers come from the 7 public GET endpoints behind it. No login or token is required,
When the browser opens the page, the frontend just calls these endpoints. The endpoint root path is `https://mimo.xiaomi.com/rl/api`.

The page says "read directly from the trainer's logs"—the data is read directly from the trainer logs,
there is no manual-entry step in between (the only exception is offline evaluation scores, see 3.5, which are filled in by hand).

The site is running two training jobs:

| key | Name | Description |
| --- | --- | --- |
| `pro` | mimo-v2.6-pro | The larger one, cost rate $5.71/second |
| `flash` | mimo-v2.6-flash | The smaller one, cost rate $2.855/second |

The two jobs do not share the same set of metric names: pro has 2019 and flash has 2062. Most share names, but each has ones unique to it.

---

## 2. Endpoint list

| Path | What it does | Response size (measured) | Update frequency |
| --- | --- | --- | --- |
| `/runs` | Run list, fixed metrics on the homepage, numeric format rules, official metric explanations | approx. 3.5 KB | Basically unchanged |
| `/status?run=` | Current status: cost, progress, step event stream, cumulative total | approx. 3 KB | Second-level changes |
| `/live?run=` | Latest report from the dynamic sampler + the most recent 60 rolling detail entries | approx. 17 KB | approx. one per 30 seconds |
| `/notices` | Official announcements | approx. 1 KB | Random |
| `/benchmarks` | Offline benchmark evaluation scores | approx. 1.2 KB | When scores come out |
| `/tags?run=` | All metric names for the job + data version number | approx. 96 KB | When there are new metrics |
| `/series?run=&v=&tags=` | Step-by-step history for specified metrics | 335～424 KB | Synchronized with steps |

Two things to watch out for:

- **`/series` must be requested in batches.** Metric names are very long (some individual ones exceed 200 characters); stuffing all 2019 metrics at once into
  one URL returns 414. In testing, batches of 5000 characters after URL encoding are relatively stable; the 2019 metrics are cut into about 23 batches.
- **`/series` does not recognize range parameters.** I tried `from`, `since`, `start`, `step_from`, `offset`,
  all were ignored, and it always returns the full set. So if you want to save traffic, the only thing you can work on is "whether to send this request"; see Section 8.

---

## 3. Fields of each endpoint

### 3.1 `/runs`

```jsonc
{
  "title": "mimo-v2.6 RL",
  "subtitle": "Two reinforcement-learning runs, ... read directly from the trainer's logs.",
  "runs": [{ "key": "pro", "label": "mimo-v2.6-pro", "note": "", "color_index": 1 },
           { "key": "flash", "label": "mimo-v2.6-flash", "note": "", "color_index": 0 }],
  "pins": ["dynsam/avg@n", ...],          // the 18 metrics pinned in the homepage chart area, see section 5
  "formats": [["^timing_s/", "duration"], ...],  // numeric display rules, see section 6
  "compositions": [ ... ],                // how the two charts in the homepage "batch composition" block are grouped
  "categories": ["code", "general", "cyber", "visual", "chat"],
  "social": { "handle": "@XiaomiMiMo", "url": "https://x.com/XiaomiMiMo" },
  "footer_note": "Open is what we value.",
  "stream_start": 1789531200.0,           // 2026-09-16 04:00 UTC, livestream start time
  "descriptions": { "dynsam/avg@n": "mean pass rate: ...", ... },  // only 22 entries
  "about": ["We are streaming our RL big runs. ...", "Follow us @XiaomiMiMo."],
  "headline_tag": "dynsam/avg@n",         // which metric the homepage big number uses
  "hist_prefix": "dynsam/passrate/hist9_ratio/"
}
```

`compositions` tells the frontend how to slice those two "batch composition" charts:

```jsonc
[
  { "key": "source",  "label": "data source",      "prefix": "dynsam",
    "groups": ["code","general","cyber","visual","chat"], "derive": "trained", "unit": "prompts" },
  { "key": "harness", "label": "harness (trained)", "prefix": "train/harness",
    "metric": "training/rollouts", "unit": "rollouts" }
]
```

**`descriptions` only has 22 entries, while there are more than 2000 metrics.** This is the most important thing for understanding this dashboard:
The official source only explains the metrics used on the homepage; the remaining 99% of metric names have no public definition and can only be inferred from naming patterns and training common sense.
This repository's `analysis/en/notes/06-pitfalls-when-reading-the-dashboard.md` and `docs/en/A1-dashboard-walkthrough.md` contain detailed explanations of this part of the inference,
as well as which ones should not be hard-guessed.

### 3.2 `/status?run=`

```jsonc
{
  "run":   { "key": "pro", "label": "mimo-v2.6-pro",
             "start": 1789468339.334, "end": null, "mode": "live" },
  "cost":  { "rate_per_s": 5.71, "so_far": 1358312.77 },
  "clock": { "now": 1789706222.48 },
  "version": "3-5513.17.10.17",
  "step": {
    "last": 17,               // last completed step number
    "last_wall": 1789699763.5,// wall clock time when that step completed
    "since": 6458.97,         // seconds elapsed since that step completed
    "expected": 12807.7,      // the site's estimate of "roughly how long a step takes" (seconds)
    "progress": 0.5043,       // since / expected
    "phase": "training",      // current phase
    "gen_frac": 0.4855,       // proportion of this step that is generation, used for the separator tick on the progress bar
    "restarted_at": null      // when the current training process started
  },
  "totals": {
    "tokens_step": 2296260000,  // how many tokens were trained in this step
    "trained_step": 25088,      // how many sequences were trained in this step
    "sandboxes_step": 22365,    // how many sandboxes were started in this step
    "prompts_per_step": 1568,   // how many prompts are in a training batch
    "tokens_cum": 37159090000, // cumulative
    "trained_cum": 426496,
    "sandboxes_cum": 2108592,
    "restarts": 9               // cumulative restart count (the trainer process's own counter)
  },
  "events": [
    { "t": 1789475059.334, "kind": "restart" },
    { "t": 1789492877.82, "kind": "step", "step": 1, "value": 0.564662,
      "delta": null, "tokens": 1800520000.0, "redo": false }
  ],
  "headline": { "tag": "dynsam/avg@n", "last": 0.629303, "prev": 0.635523,
                "first": 0.564662, "first_step": 1 }
}
```

A few key points:

- **Cost is calculated, not recorded.** `cost.so_far` is identically equal to `rate_per_s × (clock.now − run.start)`.
  I checked it item by item against 15 historical snapshots; the error is 0.
  Inference: cost continues to accrue during restarts; the cost curve is an absolutely straight line and carries no information.
- **`run.start` never changed from start to finish**, even though there were 9 restarts in between. So the "restart" here restarts the trainer process,
  and the timing of the entire run is not reset.
- **`events` is an append-only complete event stream**, retained from the first step all the way to now, including every restart.
  Two event types: `kind: "restart"` (only `t`) and `kind: "step"`.
- **In `events`, the same step number may appear twice.** That means this step was rerun, and the `redo` of the second occurrence is `true`.
  In testing, flash's step 16 and 17 each appear twice, and the `value` of the two events is not the same either.
  This is a big pitfall; see Section 8, item 3.
- **`step.phase`** has been seen with values such as `training`, `rollout`; the site does not publicly enumerate them. It, together with `gen_frac`,
  drives that progress bar on the homepage.
- **`restarted_at`** is used to determine "whether this sampler report was sent by the current process"—if the report time is earlier than
  `restarted_at`, it indicates that it is a leftover from the previous process.

### 3.3 `/live?run=`

```jsonc
{
  "log_time": 1789705579.334,
  "latest": {
    "t": 1789705579.334,
    "step": 18,            // which step the currently running run is at
    "accept": 2504,        // number of sequences accepted in this run
    "target": 1568,        // target (= prompts_per_step)
    "judged": 2403,        // of which have been graded
    "judged_of": 2504,
    "ds": {                // four numbers per data source: [accepted, target, judged, in flight]
      "code/dataset-bvg7": [71, 52, 65, 41],
      "general/dataset-epqd": [95, 64, null, 5],
      ...
    },
    "passrate": 0.561,     // pass rate computed by the sampler itself
    "n": 7203,             // statistical base (number of sequences)
    "pr0": 0.155,          // share of prompts never answered correctly
    "pr1": 0.283,          // share of prompts answered correctly every time
    "partial": [0, 0, 0],
    "working": 256,        // sandboxes currently running
    "remain": 422,
    "remain_partial": 691,
    "remain_seq": 220,
    "prewarm": 351,        // sandboxes prewarming
    "prewarm_wait": 1841.6 // average prewarm wait in seconds
  },
  "entries": [ ... the most recent 60 entries with the same structure ... ]
}
```

- The `passrate` in `latest` and the `dynsam/avg@n` in `/series` **are not the same thing**.
  The sampler's statistic is "the sequences already received in the current round"; `avg@n` is "the average pass rate of all prompts trained in this step".
  The two numbers generally differ by a few percentage points; do not mix them. Conversely, `pr0` / `pr1` and `/series`'s
  `dynsam/passrate/zero` / `/one` are the same statistic; the difference is that the snapshot is an intra-step process value (pro step 23
  `pr0` 0.131 vs sequence 0.131014).
- **The column names of the `ds` four-tuple come from the original site's frontend** (`js/app.js`'s
  `{acc: v[0], tgt: v[1], j: v[2], r: v[3]}` → accepted / target / judged / in flight），
  but the site has not written any text explanation for these four numbers. The relationships that can be recomputed in the repository (see
  `src/sampler_report.ts`, as of 2026-09-20, 29 archived records in total):
  - `Σ accepted == 面板 accept`、`Σ target == 面板 target == 1568`（29/29）；
  - `Σ c + Σ accepted(未上报 c 的源) == 面板 judged`（29/29），
    equivalently `accept − judged == Σ(accepted − c)`; the gap comes only from the 8 code data sources that report `c`;
  - `c ≤ accepted` (232/232 non-null values); the remaining 17 data sources have this field identically null;
  - `Σ d == 面板 remain + remain_partial` (29/29, maximum difference 2).
  **No public material defines the counting unit of `judged` / `in flight`** (tasks or sequences, whether partial rollout is included);
  The site's `descriptions` also does not contain these four items. The `remaining` column in the header is not an endpoint field; it is computed on the page
  `max(0, target − accepted)`, so once accepted volume exceeds the quota, it is identically 0.
  For the complete verification process, see `docs/en/03-sampler-table-caliber.md`.

### 3.4 `/notices`

```jsonc
{ "notices": [
  { "id": "n-4e29eb", "t": 1789703382.889, "text": "the pro run restarted at step 17 due to a GPU OOM ...", "run": null }
] }
```

The `run` field is currently all `null`, indicating that announcements are not bound to a specific run. `id` is a stable deduplication key.
Announcements are the most important circumstantial evidence for understanding the data—for example, why a certain step took particularly long, why a certain metric jumped,
the answer is often in these few lines of text, not in the numbers.

### 3.5 `/benchmarks`

```jsonc
{ "benchmarks": [
  { "key": "deepswe", "title": "DeepSWE v1.1", "note": "mini-swe-agent, avg@3", "format": "num2",
    "results": { "flash": { "1": 48.67, "2": 53.1, ... }, "pro": { "1": 58.41, ... } } }
] }
```

Three benchmarks: DeepSWE v1.1, In-house Coding Bench, AutomationBench v1.0.6.

- **This is the only manually maintained data on the page.** The points do not appear automatically: the score for a given step appears after the evaluation run finishes and it is manually filled in
  only then does it pop up. So if a step has no point, it does not mean that step was not evaluated; it only means the score has not come out yet.
- key is the step number in string form, not a contiguous array—it often skips numbers.
- The frontend only draws this point when the corresponding training step has already completed.

### 3.6 `/tags?run=`

```jsonc
{ "run": "pro", "version": "3-5513.17.10.17", "tags": ["actor/entropy_loss", ...] }
```

- `tags` is **all metric names that have ever appeared for this job**, not those that currently have values.
  Of the 2019 metric names, only about 1926 actually have data.
- `version` is the data version number. It looks like `3-5513.<n>.<m>.<k>`, where `<n>` roughly follows the step count,
  But **it cannot be used as the step count**: at version `3-5513.26.4.25`, flash actually only ran to step 24.
  It is more like an internal revision counter on the site.
- **A change in `version` does not mean the data changed.** In tests, with pro's step count completely unchanged,
  version went from `3-5513.14.7.0` to `14.8.0` and then to `14.8.15`. Be careful if you want to use it as a cache key.
- **Metric names come and go.** flash's `penalty/signed/pos_scale_clamped`,
  `penalty/stage_credit_group/dev_neg_turns`, etc., 4 metrics disappeared entirely after a certain run.
  So the "metric set" is not monotonically growing.

### 3.7 `/series?run=&v=&tags=`

```jsonc
{
  "run": "pro", "version": "3-5513.17.10.17",
  "steps": [1, 2, 3, ..., 17],
  "walls": [1789492877.8, 1789506681.7, ...],   // wall clock times corresponding one-to-one with steps
  "run_start": 1789468339.334,
  "series": { "dynsam/avg@n": [0.564662, 0.555333, ...] }
}
```

- **The arrays and `steps` are strictly aligned, with equal lengths.** I checked all 15 snapshots; there were 0 with inconsistent lengths.
  Positions without data are `null`, not truncation. Overall fill rate is about 93%.
- `series` contains only metrics with **at least one non-empty value**. `/tags` lists 2019,
  `/series` generally returns only about 1926 of them.
- `walls[i]` is the wall-clock time when step `steps[i]` completes. **It updates only when a new step completes**——
  When repeatedly fetching between steps, the last entry of `walls` does not move.
- **Values can be overwritten, but only when rerun.** See Section 8, item 3.

---

## 4. How to read metric names

Metric names are path-style: the first segment is the module, and subsequent segments subdivide further. Take pro's 2019 as an example:

| Prefix | Count | Roughly what it is |
| --- | --- | --- |
| `penalty/` | 535 | Intermediate quantities of reward and penalty terms. Site-specific, no public documentation, mostly inferred |
| `partial/` | 327（pro）／385（flash） | Statistics bucketed by data freshness. See the separate explanation below |
| `critic/` | 324 | Value network-related quantities |
| `actor/` | 257 | Policy network loss, entropy, gradient |
| `train/` | 191 | Training-side statistics, including breakdowns by harness and dataset |
| `ctx_total_length/` | 108 | Distribution statistics of total context length (prompt + response) |
| `dynsam/` | 83 | Dynamic sampler: pass rate, number of tasks, number of runs |
| `ctx_prompt_length/` | 81 | prompt length distribution |
| `ctx_response_length/` | 81 | response length distribution |
| `env/` | 15 | Sandbox environment status |
| `train_infer_diff/` | 11 | Mismatch between trainer and inference engine |
| `timing_s/` | 3 | Elapsed time |
| `training/`、`perf/` | 3 | Miscellaneous |

Meanings of several common suffixes:

- `/mean`, `/max`, `/min`, `/p50`, `/p90`, `/p99` —— different quantiles of that statistic.
  That is where the 108 `ctx_total_length/*` come from.
- `/zero`, `/one`, `/mid` —— pass rate exactly 0, exactly 1, and the proportion in between.
- `/hist9_cnt/<k>`, `/hist9_ratio/<k>` (`k` = 0～8) —— counts/proportions after splitting prompts into nine buckets by pass rate.

**The `partial/` section needs a separate explanation.** It splits the same set of metrics into several buckets by "how old the data is":
`partial/<i>/<指标名>`, `i` is the bucket number; bucket 0 is newly sampled at this step, and larger bucket numbers are older.

**The two runs have different bucket counts**: pro has 0～7, 8 buckets total, and flash has 0～9, 10 buckets total.
When writing code to compute the weighted sum, do not hard-code 8——if you do, you will undercount part of it on flash,
and it will look like "the relation does not hold," when in fact you counted the wrong buckets.

There is also a global value `partial/avg_staleness` that is not bucketed, meaning "the average number of policy versions between sampling and training."

Measured relations (all hold across pro 17 steps and flash 24 steps, with maximum relative error 0.15%):

```
Global KL = Σ_i (bucket i's share × bucket i's KL)
```

That is, the "train-inference mismatch" curve on the homepage is the weighted average of these buckets. When it rises, it does not necessarily mean the model changed,
it may simply be that the data got older——these two things are mixed together in this metric. Section 8, item 1 discusses this in detail.

---

## 5. The 18 metrics permanently displayed on the homepage

The `pins` array of `/runs`, in page order:

| # | Metric | Official description (if any) |
| --- | --- | --- |
| 1 | `dynsam/avg@n` | mean pass rate: for each prompt sampled this step, the fraction of its n attempts that succeed, averaged over prompts |
| 2 | `critic/rewards/mean` | mean reward over trajectories trained on this step |
| 3 | `actor/entropy_loss` | mean per-token entropy of the policy |
| 4 | `actor/pg_loss` | clipped policy-gradient objective |
| 5 | `actor/grad_norm` | global gradient norm before clipping |
| 6 | `train_infer_diff/new_infer/kl` | KL between inference-engine and trainer log-probs on the same tokens |
| 7 | `ctx_total_length/mean` | total context length per trajectory (prompt + response), in tokens |
| 8 | `dynsam/agg_turn/mean` | agent turns per trajectory |
| 9 | `perf/total_num_tokens` | tokens trained on this step |
| 10 | `timing_s/step` | wall-clock of the whole step |
| 11 | `timing_s/outer_gen` | wall-clock of rollout generation |
| 12 | `timing_s/trainer_ops` | wall-clock of the trainer |
| 13 | `dynsam/passrate/zero` | share of prompts where no attempt succeeded |
| 14 | `dynsam/passrate/one` | share of prompts where every attempt succeeded |
| 15 | `dynsam/infra_error/seq_rate` | share of sequences lost to infrastructure failures |
| 16 | `env/active` | sandbox environments in flight |
| 17 | `partial/avg_staleness` | policy versions between sampling and training, on average |
| 18 | `dynsam/num_measurable` | prompts with a measurable pass rate this step |

There are still 4 entries in the official `descriptions` that are not in pins, but are used elsewhere on the homepage:

| Metric | Official description |
| --- | --- |
| `dynsam/avg@n_no_infra` | avg@n with attempts that failed for infrastructure reasons excluded |
| `ctx_response_length/mean` | tokens generated per trajectory |
| `dynsam/passrate/hist9_ratio` | share of prompts by pass rate, in nine bins from none solved to all solved |
| `train/harness/*/training/rollouts` | rollouts in the training batch, per agent harness |

---

## 6. How values are displayed (`formats`)

`/runs`'s `formats` is a list of `[正则, 格式名]`, **matched from top to bottom, and the first hit takes effect**; if none hit, `auto` is used.

```
^timing_s/                    → duration   converts seconds to something like "1h 20m"
^perf/time_per_step$          → duration
^perf/gpu_time_s/             → duration
_ns$                          → compact    compresses nanoseconds as a number like 1.5M
_gb$                          → gb         keep one decimal place, with GB
^actor/lr$                    → sci        scientific notation
(^|/)(avg@n|avg@n_no_infra|score_mean|accept_rate|valid_rate)$   → ratio   three decimal places
(^|/)(seq_rate|effect_ratio|ok_frac|missing_frac|zero|one|mid|
       zero_no_infra|one_no_infra|mid_no_infra|hist9_ratio/\d+)$ → pct     multiply by 100 and add a percent sign
(^|/)(hist9_cnt/\d+|num_[a-z_]+|n_[a-z_]+|count|size|in_flight|
       active|total|rollouts|max_load|min_load|dead_replaced)$    → int     integer with thousands separators
(length|tokens|_len|decode|prefill)                             → compact
```

Note that the last entry is **substring matching**, not anchored. Any metric whose name contains `length`, `tokens`, `decode`, `prefill`
will be compressed into the form `12.3M`. So when you see a metric displayed as an abbreviation, first check whether it was accidentally affected by this rule.

There is another pitfall: the `pct` rule only matches metric names whose **last segment** is `zero`/`one`/`mid`, etc.
`dynsam/passrate/zero` will hit, but `partial/0/dynsam/passrate/zero` will also hit——because it matches path segments.

---

## 7. Verified relations

I have verified each of the following one by one on the scraped data. They are not from the official documentation; I worked them out myself and confirmed they match,
I am writing them down because they can help you determine whether the data has been misread.

| Relation | Verification scope | Error |
| --- | --- | --- |
| `cost.so_far = rate_per_s × (clock.now − run.start)` | 18 sync points × 2 runs | 0 |
| `ctx_total_length/mean = ctx_prompt_length/mean + ctx_response_length/mean` | All steps | Within 5×10⁻⁶ relative |
| `perf/total_num_tokens = 1568 × 16 × ctx_total_length/mean` | All steps | 1～3% |
| `critic/rewards/mean == critic/score/mean` | All steps | Exact |
| `全局 KL = Σ_k (partial/k/frac × partial/k/train_infer_diff/new_infer/kl)` | pro 17 steps / flash 24 steps | Within 0.15% |
| `partial/avg_staleness = Σ_i i × partial/i/frac` | pro 17 steps / flash 24 steps | Within 4×10⁻⁶ |

The 5×10⁻⁶ for the `ctx_total_length` entry is not a real error; it is **value granularity**: the site only gives about 6 significant digits,
the granularity of a number around 120,000 is 0.5, and the rounding of the three numbers can add up to one token.
The largest absolute difference seen is 0.54 tokens, which is five parts per million relative.

In the `perf/total_num_tokens` entry, 1568 is `prompts_per_step`, and 16 is the number of sequences sampled per prompt
(displayed on the homepage as `1,568 × 16 seqs`). This product only matches approximately, because some sequences are judged invalid.

These relations are all written into `src/check.ts`; run it to re-verify:

```bash
bun src/check.ts
```

It can also serve as a sentinel for "whether the site secretly changed the algorithm"——if one day some relation no longer holds, it will report it.

---

## 8. Pitfalls

### Pitfall 1: The KL curve on the homepage tripled, but the model actually barely changed

During the observation period, `train_infer_diff/new_infer/kl` rose from 0.0022 to 0.0101. It looks like the train-inference divergence is worsening.
But if you break this number down by the `partial/` buckets, you find that is not what is happening.

| | pro step 1 | pro step 17 | flash step 1 | flash step 24 |
| --- | --- | --- | --- | --- |
| Global KL | 0.00219 | 0.00442 | 0.00287 | **0.01011** |
| KL of bucket 0 (freshest data) | 0.00219 | 0.00264 | 0.00287 | **0.00341** |
| Proportion of bucket 0 | 1.000 | 0.882 | 1.000 | **0.161** |
| `partial/avg_staleness` | 0.000 | 0.209 | 0.000 | **2.183** |

Ranges of the two curves over the entire observation period:

- pro: global KL 0.00219～0.00980, KL of bucket 0 only 0.00217～0.00264.
- flash: global KL 0.00287～0.01011, KL of bucket 0 only 0.00254～0.00351.

The correlation coefficient between the global value and `partial/avg_staleness` (average staleness in generations) is **+0.944** (for both runs);
with bucket 0, the correlation coefficient is only +0.331 (pro)／+0.151 (flash).

In other words, almost all of the rise and fall of global KL comes from the weighting effect of "the proportion of old data in the training data."
flash step 24 is the most typical: global 0.0101, but that is the result of only 16% of the weight coming from fresh data;
the KL of the fresh data itself is 0.0034, only 19% higher than at step 1.

The hardest evidence is a natural experiment: pro step 15, because of a restart, used 100% fresh data for that step,
Its global KL (0.00258) is **exactly equal to** the value for bucket 0 (0.00258), to the last digit.

**How to use**: to determine whether training-inference divergence has actually worsened, look at `partial/0/train_infer_diff/new_infer/kl`,
Do not look at the global value on the homepage. To see "how old the data is", look at `partial/avg_staleness`. These two numbers are two different things,
The homepage displays them multiplied together.

### Pitfall 2: `timing_s/step` and the card's "elapsed time for this step" do not include restart wait

Check item by item against the timestamps in the event stream: for steps without restarts, `timing_s/step` and the true wall clock differ by within ±14 seconds;
for steps with restarts, they differ by several hours.

- pro: across 15 steps, the excluded restart wait totals **16.8 hours**, accounting for 32% of the true wall clock 52.6 hours,
  at $5.71/second that comes to **$344,411**.
- flash: 7.6 hours excluded, about $78,422.

**How to use**: using `timing_s/step` to calculate "cost per step" and "throughput per step" both give lower bounds.
The true wall clock must use the time difference between two adjacent step events in `events`.

### Pitfall 3: for steps that were rerun, `/status` and `/series` will not match

The site handles "rerun" in two different ways:

- `/status`'s `events` only appends: the original event for step 16 is kept, and later an `redo: true` event is added.
- `/series`'s array is overwritten: the value of `dynsam/avg@n` at step 16 is replaced with the value after the rerun.

Measured for flash's steps 16 and 17:

| step | The first entry in events | The redo entry in events | The value in series |
| --- | --- | --- | --- |
| 16 | 0.602504 | 0.594958 (`redo: true`) | **0.594958** |
| 17 | 0.585664 | 0.601257 (`redo: true`) | **0.601257** |

So a curve of "main metric over time" drawn directly from `events`, and a curve drawn from `dynsam/avg@n`,
will differ at steps that were rerun. **When retrieving data, either use only `series`, or use only the last entry for each step number in `events`**,
Do not mix.

This also shows that the statement "series only appends, never changes" has an exception: by default it does not change, but a rerun will change it.
This repository's sync script handles this case specially: when it finds two events for a step, it refetches the series and allows overwriting that step's value.

### Pitfall 4: fewer metrics have data than are listed

`/tags` says pro has 2019 metrics, but `/series` returns only 1926 series.
The missing 93 are ones that never produced a value for this run from start to finish. Iterating over `/tags` to fetch data will get a bunch of empty arrays.

### Pitfall 5: do not force an interpretation of that large section of `penalty/`

Under `penalty/` there are 535 metrics, accounting for more than a quarter, but there is not a single official explanation.
This block is the site's in-house reward penalty pipeline; from the naming, it is probably related to "which step should get how much credit",
but there is no public documentation, and no corresponding implementation can be found online.

One thing that can be confirmed: `penalty/action/adv_reduction_total` is identically equal to 0, and
`train/adv_*_sum_pre_penalty` and `train/adv_*_sum_post_penalty` are exactly identical value by value.
That is, this penalty pipeline **is measuring, but does not actually rewrite the advantage values**. This is a fact that can be read from the data,
As for why, unknown.

### Pitfall 6: `actor/pg_clipfrac` and `actor/ppo_kl` are all 0

All runs, all steps, and all breakdowns (`actor/agentic/pg_clipfrac` etc.) are exactly 0.
It cannot be a coincidence, but the reason is unknown—it may be that these two metrics are not logged under the current configuration.
**Do not** interpret it as "training was not clipped at all".

### Pitfall 7: several ratios that "look like they can be divided directly" actually cannot be divided

- `dynsam/num_measurable` and `dynsam/agg_turn/mean` have different denominator bases, so dividing them is meaningless.
- `train/harness/*/training/rollouts` sums to about 22,400, while `totals.trained_step` is 25,088.
  The two numbers come from different accounting bases; it is normal that they do not match.
- `partial/i/n_tokens` sums to about half of `perf/total_num_tokens`, reason unknown.

### Pitfall 8: `env/total_setup` and `env/total_error` are in-process cumulative values

They are not quantities for "this step", but cumulative since "the current trainer process started". A restart will reset them to zero,
so these two metrics show apparently inexplicable sawtooth patterns. To judge the true situation at a given step, use the difference between two adjacent steps.

**But do not take the difference between these two numbers as the "environment error rate"**: earlier we calculated it this way and got below one thousandth;
while the official MiMo-V2-Flash README gives the runtime environment as "10,000+ concurrent pods, about 70% environment setup success rate",
it is off by three orders of magnitude. So `total_setup` is not the "number of environment setup attempts", and `total_error` is not the "number of setup failures",
this ratio has no interpretable denominator. For the official definition, see `content/sources.json`'s `mimo-v2-flash-readme-env`.

### Pitfall 9: the `cost` curve carries no information

Since `cost.so_far = rate × (now − start)` and `start` are constant, this line is a perfectly straight line.
Using it to derive any training-related conclusion is wrong.

---

## 9. What local telemetry adds

The original site can only show "now". This repository's telemetry adds replay on top of that: attach to any `api/*` request a
`asof=<epoch 秒>` parameter, and the server returns the data sliced to how it looked "up to that moment".

**It relies on the rule aside from Pitfall 3**: a step's value appears only when that step is completed,
once it appears, it no longer changes (except reruns; reruns leave traces in the event stream, and the sync script follows up to overwrite).

In replay mode:

- `steps` includes only steps whose completion time is earlier than `asof`, and the `series` array is truncated accordingly.
- `clock.now` returns `asof` itself, so the clock, cost, and "elapsed time" on the page are all frozen at that moment.
- `notices` returns only those whose publish time is earlier than `asof`.
- `benchmarks` returns only points whose corresponding training step is completed.
- `/live` returns the last sampler snapshot no later than `asof` (the 60 rolling details are not archived, so `entries` is empty).

The original site does not have this capability, so this is the incremental part of telemetry. See `docs/en/02-architecture-and-sync.md` for the specific implementation.
