# Asynchronous training pipeline and machine-time accounting: where a step's wall clock goes, how much restarts consume, and where the pipeline is blocked

**One-sentence conclusion: the step durations reported on the dashboard are accurate on clean steps; pro has 26.15 hours ($537,478, 27.7% of the bill) and flash has 14.15 hours ($145,403, 17.0%) that were not recorded; however, more than half of this gap is not "downtime" but discarded recomputation and a fixed 12~13 minutes (pro) / 5~6 minutes (flash) of recovery overhead; the pipeline has no backpressure at the trajectory-write layer (all 0 across 54 step observations), and the staleness metric is a clock that is zeroed by restarts, not a load table.**

> Material identity: **our own measurements**. All numbers are recomputed from the local telemetry repository `data/store/`,
> Recomputation script `src/pipeline_report.ts`, executed from the project root:
> `bun src/pipeline_report.ts`。
> Data cut: pro completed step 24, flash completed step 30 and has already `end` (`status.json`'s `clock.now` is
> 2026-09-19T08:58:08Z, and the file sync time is likewise 08:58:12Z).
> Sample size: pro 24 steps / 11 restarts; flash 30 steps / 5 restarts. **This is a very small sample; all comparisons involving restarts report effect sizes and are marked as not significant.**
> This article does not repeat the conclusions of `analysis/en/notes/07-flash-stop-and-resource-mix.md`; it only builds forward on the "cost rate = machine-count reading" that she has already confirmed.
> The related insight in the previous version is in `content/insights.json`'s `timing-excludes-restart` (the basis is the old cut at steps 19/25); Section 5 of this article corrects it.

---

## 1. Summary: conclusion first

1. **The fact that "reported duration excludes restarts" is confirmed, but both the magnitude and the denominator need a change of basis.** Calculated using "sum of true step durations − sum of reported durations",
   pro gap **26.15 hours** (28.0% of the sum of true step durations, equivalent to **$537,478**, **27.7%** of the total bill of $1,941,107);
   flash gap **14.15 hours** (17.3%, equivalent to **$145,403**, **17.0%** of the total bill of $854,045).
   The 23.7 hours / $488k in the old insight can be reproduced, but that is another basis ("the old cut as of step 19 + using wall clock as the denominator") (see 5.1).

2. **The gap is not equal to "restart wait"; reading it as downtime would be wrong.** The gap can and can only be split into three parts:
   (a) the span from completion of the previous step → the last recovery run, (b) the overhead from recovery run → the start of this step's timer, (c) recomputation work discarded for an entire step.
   (b) can be measured precisely and is very stable: **pro 740~800 seconds per occurrence, flash 328~367 seconds per occurrence**.
   Of the 5.63-hour gap at flash step 16, **3.96 hours were "two full steps (s16, s17) that had already run and were then invalidated and rerun"**
   (with the `redo=true` event as evidence), the true recovery wait was only 0.09 hours. **This is compute burned for nothing, not downtime.**

3. **The pipeline is not blocked at these layers: across 54 step observations, the backpressure counters are all identically zero.**
   `train/trace/backpressure_waits`、`backpressure_wait_seconds_sum/max`、`orphan_resolves`、
   `failed_writes`, `terminal_conflicts` are **without exception all 0** across pro 24 steps + flash 30 steps;
   drain wait `drain_wait_seconds` maximum 8.23 seconds, write-out `outcome_write_seconds` maximum 1.60 seconds.
   The story that "long tails eat throughput" leaves no trace in this round of data—not because there are no long tails, but because this layer still has headroom.

4. **Staleness (`partial/avg_staleness`) is not a proxy for queueing delay; it is a "restart clock".**
   Within segments, it has a rank correlation of **0.944 (pro) / 0.885 (flash)** with "number of steps since the last restart", but with true step duration only
   **−0.235 / −0.070**. Therefore the chain "steps get longer → trajectories cannot finish → data gets stale" **does not hold** in this data:
   Getting longer is real (rank correlation of true duration on clean steps +0.931/+0.909), and getting stale is also real (at flash step 24 there are 9 buckets and about 84% of tokens come from 1 version earlier),
   But the middle link does not connect—**the variance in staleness is eaten by restarts, not by load**.

5. **Unit cost: pro $23,197 per 1 billion training tokens, flash $8,203 (both using only clean steps without restarts).**
   The cumulative-basis "declining curve from $77,819/B to $34,282/B" is mainly because step 1 was contaminated by a restart (that step spent $140,115 and bought only 1.80B tokens),
   not an efficiency improvement; on clean steps, unit cost **slightly rises** with step (pro rank correlation with step number +0.84). The dollar share of grading compute **cannot be estimated**,
   only the order of concurrency can be given: pro median about 80 grader groups, flash about 112 (see 3.7 for basis).

---

## II. Methods and Definitions

### 2.1 Three time bases (the most easily confused part of this article; pin them down first)

| Measurement definition | Definition | Data source | pro | flash |
| --- | --- | --- | --- | --- |
| True step duration | `axis.walls[i] − walls[i−1]` (step 1 uses `run_start`) | `axis.json` | Total 93.329 h | Total 81.800 h |
| Reported step duration | `timing_s/step[i]` | `series.json` | Total 67.182 h | Total 67.653 h |
| Gap (Basis A) | True − reported, **counted only within the step window** | The two rows above | **26.147 h** | **14.147 h** |
| Gap (Basis B) | Billed seconds − reported total; billed seconds = `end ?? now` − `run_start` | `status.json` | **27.248 h** (now still running) | **15.441 h** (stopped at `end`) |
| Old insight Basis C | (`now` − `run_start`) − reported total, with wall clock as the denominator | Old cut | 23.74 h / 32.9% | 14.57 h / 21.6% |

Basis A is "the account within the step window"; Basis B additionally counts the tail after the last completion; Basis C is the previous version.
**The main text of this article uses Basis A throughout**; percentages are denominated by the bill (`rate × 计费秒数`), and the proportion of `占真实步耗时之和` is also given.

### 2.2 Parsing basis (which row, which field represents what)

- The difference between adjacent entries in `axis.walls` is the **only** source from which true step duration can be obtained; `timing_s/step` is in-process timing.
- `events.json`'s `kind:"restart"`'s `t` is **the time when the new process resumes running**, not the crash time. Basis: `timeline.jsonl`'s
  `restarted_at` is exactly equal to that `t`, and `step.since` is counted from that `t` (point-by-point differences agree to within 1 second). The crash time is unobservable,
  This is the fundamental reason why all "wait vs wasted compute" figures in this article can only be given as intervals.
- In `timeline.jsonl`, `step` = `status.json`'s `step.last` (the most recently **completed** step), `since` / `expected` / `progress` /
  `gen_frac` describes **the step currently running**. The file has 27 rows total (27 sync points), not one row per step.
- `live.jsonl`'s `latest` field (`accept` / `judged` / `remain` / `prewarm_wait`, etc.) has no official explanation from the dashboard,
  This article uses it only as corroborating evidence; it does not participate in any conclusion calculation.
- Cost definition follows the dashboard as-is: `cost = rate_per_s × (now − run_start)`, a **rate-inferred bill, not measured billing**.
  pro `rate = 5.71`, flash `rate = 2.855` (exactly 2:1).

### 2.3 Statistics

The sample is small, so: correlations always use Spearman rank correlation; for two-group comparisons, use Mann-Whitney U (normal approximation + tie correction) to give p-values,
and also give Cliff's delta effect size. **The n=11 / n=5 restart comparison provides no "pattern"-level conclusion.**
All numbers are recomputed by the script and written to `analysis/zh-CN/numbers/A3-pipeline-numbers.json`.

---

## 3. Section-by-section main text

### 3.1 Wall-clock time breakdown for one step

**Conclusion: Of 24 steps, 7 steps (pro) / 5 steps (flash) have substantial gaps; the gaps in the remaining steps are within ±15 seconds, i.e., for clean steps the "true ≈ reported" holds.**

Plain English: the dashboard's "how long each step took" curve is accurate for steps without incidents; once a restart has occurred in that step, it reports only "how long it ran after the last recovery," and not a word is written about the discarded part before it.

| pro step | true h | reported h | gap h | gap share | restarts within window |
| --- | --- | --- | --- | --- | --- |
| 1 | 6.82 | 2.66 | 4.16 | 61.0% | 2 |
| 2 | 3.83 | 2.01 | 1.83 | 47.7% | 1 |
| 3 | 5.42 | 2.36 | 3.06 | 56.5% | 1 |
| 11 | 5.59 | 2.62 | 2.97 | 53.1% | 1 |
| 15 | 8.31 | 3.58 | 4.73 | 56.9% | 2 |
| 17 | 9.44 | 3.56 | 5.88 | 62.3% | 2 |
| 23 | 7.44 | 3.94 | 3.50 | 47.1% | 2 |
| the other 17 steps | — | — | −6.6 ~ +16.2 seconds | ≤0.2% | 0 |

| flash step | true h | reported h | gap h | gap share | restarts within window |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.84 | 1.80 | 0.04 | 2.4% | **0** |
| 3 | 3.86 | 1.92 | 1.94 | 50.2% | 1 |
| 16 | 8.46 | 2.83 | 5.63 | 66.5% | 1 |
| 25 | 7.51 | 3.02 | 4.49 | 59.8% | 2 |
| 28 | 5.37 | 3.35 | 2.02 | 37.6% | 1 |
| the other 25 steps | — | — | −11.4 ~ +12.7 seconds | ≤0.2% | 0 |

**All 11 restarts in pro fall in the 7 steps with gaps, and not one restart falls in a step without a gap** (the script checked window membership one by one).
flash's 5 restarts fall in 4 steps with gaps; there is also one **gap with no event record: 158 seconds in step 1 (2.4%)**—
That is boot overhead from "process startup to the start of the step 1 timer," not a restart. Apart from it, neither run has a step with "a large gap but no event."

### 3.2 Are all gaps from restarts?

**Conclusion: the "cause" of the gaps is 100% restarts, but the "content" of the gaps is not waiting; it is a mix of three things, only one of which can be measured precisely.**

The gap has an exact identity (the script verifies it for every step, error < 0.001 seconds):

```
gap = (previous step completion → last recovery run)          ← mixed term: discarded progress + downtime from crash to recovery
     + (last recovery run → this step completion) − this step's reported duration   ← recovery overhead: can be measured precisely
```

| Step | gap s | mixed term s | of which confirmed "whole-step discard" | of which partial progress (upper bound) | recovery overhead s |
| --- | --- | --- | --- | --- | --- |
| pro s1 | 14,968.7 | 14,636.0 | 0 | 0 | 332.7 |
| pro s2 | 6,578.7 | 5,820.5 | 0 | 0 | 758.2 |
| pro s3 | 11,018.7 | 10,255.6 | 0 | 0 | 763.1 |
| pro s11 | 10,690.0 | 9,928.0 | 0 | 0 | 762.0 |
| pro s15 | 17,025.4 | 16,225.6 | 0 | 0 | 799.9 |
| pro s17 | 21,172.9 | 20,410.4 | 0 | 0 | 762.5 |
| pro s23 | 12,615.9 | 11,875.6 | 0 | 0 | 740.3 |
| flash s3 | 6,980.0 | 6,642.0 | 0 | 0 | 338.0 |
| flash s16 | 20,277.7 | 19,945.6 | **14,265.4** (s16+s17 once each) | 5,680.2 | 332.1 |
| flash s25 | 16,180.7 | 15,852.3 | 0 | 0 | 328.3 |
| flash s28 | 7,270.1 | 6,903.1 | 0 | 0 | 367.0 |

Three things are worth remembering separately:

1. **Recovery overhead is a constant, and the two runs differ by a factor of two.** pro is 740~800 seconds each time (12.3~13.3 minutes), flash is 328~367 seconds each time
   (5.5~6.1 minutes). This is the time between "the new process coming up and the step timer starting" that is not counted (most likely loading weights and rebuilding the data pipeline).
   It can be used directly to estimate "how much money each restart burns at minimum": pro about $4,300 per restart, flash about $980 per restart.
2. **70% of the gap in flash step 16 is wasted compute, not downtime.** In `events.json`, steps 16 and 17 each appear twice, with the second occurrence carrying
   `redo=true`, and announcement `n-b60f90` states "we restarted the flash run from step 15". These two whole steps were discarded and rerun after finishing,
   totaling **14,265.4 seconds = 3.96 hours**, which at the flash rate is **$40,728**. Add the 18,193.1 seconds consumed by the rerun itself (5.05 hours,
   which was normally counted in reported duration), and this incident made flash spend **24,202 seconds = 6.72 hours ≈ $69,097** more than "if nothing had happened".
3. **Every restart in pro leaves only the "mixed term"; there is no whole-step discard at all** (in `events.json`, pro has no `redo=true`).
   That is, in pro's 24.78 hours of mixed time, how much "progress discarded before the crash" and "downtime from crash to recovery" each account for,
   **cannot be separated with the available data**—this is the biggest data gap in this article, and it is not something that can be filled by analyzing harder.

### 3.3 Reported duration cannot be broken down internally

**Conclusion: in `timing_s/step`, `outer_gen` + `trainer_ops` account for 97.9% (pro) / 97.2% (flash); the remaining "other" is 166~320 seconds and grows with load, but **no** existing metric can explain it.**

- `outer_gen + trainer_ops ≤ timing_s/step` holds for all 54 steps (the script checks point by point).
- "Other" (script `othersplit.other_s`): pro median 200.7 seconds (1.58%~2.64% of a step), flash median 224.7 seconds (1.81%~5.67%).
- It tracks load: Pearson correlation with `perf/total_num_tokens` is pro 0.884 / flash 0.719.
- **Candidates that do not match** (magnitude comparison for the same step; all differ by more than an order of magnitude or are off by orders of magnitude):

| Candidate | pro magnitude | flash magnitude | Does it match "other" (200 / 225 s)? |
| --- | --- | --- | --- |
| grader total duration per group `time_total_sec_mean` | median 553.7 s | median 570.9 s | Same order of magnitude, but it runs on the **grader cluster**, which is a different pool from the training step timer and cannot be added |
| grader pod startup `time_pod_setup_sec_mean` | median 14.66 s | median 14.95 s | off by a factor of 10~15 |
| drain wait `drain_wait_seconds` | 1.29~8.23 s | 2.55~5.87 s | off by a factor of 25~170 |
| result write-out `outcome_write_seconds` | 0.46~1.60 s | 0.52~0.85 s | off by a factor of more than 100 |
| new sandboxes per clean step | median 41,216 | median 42,032 | It is a "count"; without seconds per setup, it cannot be converted into time |

**How far can we confirm:** we can only confirm that "other" exists, is stable, and grows with token count; we **cannot** attribute it to sandbox setup, grading, or disk write.
The missing data are: per-phase breakdown of the step timer, checkpoint write / weight sync time, and seconds per sandbox setup.
**This is a "cannot understand" cell, not an "unimportant" cell**—it accumulates 5,060 seconds / 6,717 seconds per run.

### 3.4 Queueing theory perspective: average sandbox lifetime measured by Little's law

**Conclusion: inferring back from `env/active = λ × W`, the average sandbox lifetime has a pro median of 1.43 hours and a flash median of 1.99 hours, and it increases monotonically as training progresses.**

Concept (transferable): **Little's law `L = λW`**. In any stable queueing system, the "average number of customers in the system" equals "arrival rate × average sojourn time".
On the training pipeline it has a particularly useful form: `env/active` (in-flight sandbox count) is itself an instantaneous level, which seems usable only as a "busy or not" reading;
but as long as you also have the "sandbox creation rate λ", you can back out "how long each sandbox is occupied on average, W" **without breakpoints**.

Definition: `L` = mean of `env/active` over the segment; `λ` = "cumulative sandboxes created since reset ÷ wall-clock seconds since reset" for the segment;
Reset time = timestamp of the last `restart` event within the segment (basis: after restart, `env/total_setup` exactly equals `env/active`; checked point by point for the 7/5 reset steps in pro/flash, respectively).
Use only segments with length ≥ 3 steps (for segments of length 1~2 steps, counter reset merges in the creation count from the previous segment).

| run | Segment (steps) | λ (items/s) | L (mean in flight) | **W (implied survival)** | per-step per-slot turnover |
| --- | --- | --- | --- | --- | --- |
| pro | 3–10 | 5.35 | 23,061 | 1.198 h | 1.79 |
| pro | 11–14 | 4.55 | 23,450 | 1.430 h | 1.90 |
| pro | 17–22 | 3.60 | 23,231 | 1.793 h | 2.02 |
| flash | 3–15 | 6.17 | 37,840 | 1.705 h | 1.09 |
| flash | 16–24 | 5.25 | 38,270 | 2.023 h | 1.24 |
| flash | 25–27 | 5.52 | 38,729 | 1.951 h | 1.44 |
| flash | 28–30 | 4.96 | 38,675 | 2.168 h | 1.47 |

Two things:

1. **W increases monotonically with step on both runs** (pro 1.20 → 1.79 h, flash 1.71 → 2.17 h),
   consistent in direction with the concurrent rise in average generation length (pro 68k → 115k token, flash 67k → 143k token).
   That is, "sandboxes are occupied longer by long trajectories" can be measured on this chain—this is a system-side supplementary reading for `notes/08` (surge in generation length).
2. **The popular reading `env/total_setup ÷ env/active` on the dashboard overestimates the turnover rate.** It is the **within-segment cumulative** creation count divided by the water level
   (pro segment 3–10 gives 14.341); only dividing by the in-segment step count gives per-step turnover (1.793). Reading 14 as "14 turnovers per step" would get the sandbox count wrong by a factor of 8.
3. **Does not match `time_pod_setup_sec_mean`:** W is "the time the entire agentic trajectory occupies the sandbox" (thousands of seconds),
   grader pod setup is "the startup time of the grading container" (ten-odd seconds); the two are not the same quantity, and **this article does not claim they line up**.

### 3.5 Staleness: not a proxy for queueing delay, but a restart clock (a refuted chain)

**Conclusion: the chain "steps get longer → trajectories cannot finish → data becomes stale" breaks in the middle in this data. Longer steps are real, staleness is real, but there is no causal relationship between the two.**

Three facts first (both runs alike):

| Check (using only non-restart steps) | pro | flash |
| --- | --- | --- |
| `avg_staleness` vs steps since last restart | **+0.944** | **+0.885** |
| `avg_staleness` vs number of buckets | +0.944 | +0.880 |
| Number of buckets vs steps since last restart | **+1.000** | +0.998 |
| `avg_staleness` vs actual step duration | −0.235 | −0.070 |
| `avg_staleness` vs average generation length | −0.177 | +0.031 |
| Clean-step actual step duration vs step number | +0.931 | +0.909 |

Mechanical identity ruled out first: `avg_staleness = Σ_k k × frac_k` (point-by-point verification, maximum error < 1e-7),
So it is not an independent observable, but a weighted sum of the "bucket mix", and it changes with the bucket mix.
The bucket mix itself is uniquely determined by the **number of steps since the last restart**: after each restart, pro's bucket count goes from 1 to 8, flash from 1 to 10, monotonically with no exceptions.

**The truth of the chain:** restart resets the data pipeline to zero (bucket 0 = freshly sampled data); thereafter, each training step advances by mixing one older version into the batch,
until the next restart resets it to zero again. So `avg_staleness` plotted is a sawtooth; **the "height" of each tooth is how many versions accumulated in that segment**:
pro's three tooth peaks are 1.82 (s9, reset at s11), 1.21 (s14, reset at s15), 1.29 (s22, reset at s23); before the run ended it was still climbing at 0.75;
flash's two tooth peaks are 1.89 (s15, reset at s16), 2.18 (s24, reset at s25); when the final segment climbed to 1.19, the run ended (no further reset).
**The number and height of the teeth are determined by the restart interval and have nothing to do with step length.**

**The "trajectories cannot finish" link has only indirect corroborating evidence**: `live.jsonl`'s sampler snapshot contains `remain_partial` (number of unfinished prompts)
and the `partial` triple, but the dashboard gives no field definitions, and the magnitude is between several hundred and just over a thousand; this article does not draw conclusions from it.

### 3.6 Backpressure: this layer is not blocked

**Conclusion: among 13 tracing-type metrics, 6 "overflow counters" are identically zero across 54 step observations.**

| Metric | pro (24 steps) | flash (30 steps) |
| --- | --- | --- |
| `backpressure_waits` | All 0 | All 0 |
| `backpressure_wait_seconds_sum` | All 0 | All 0 |
| `backpressure_wait_seconds_max` | All 0 | All 0 |
| `orphan_resolves` | All 0 | All 0 |
| `failed_writes` | All 0 | All 0 |
| `terminal_conflicts` | All 0 | All 0 |
| `drain_wait_seconds` | 1.29 ~ 8.23 s | 2.55 ~ 5.87 s |
| `outcome_write_seconds` | 0.46 ~ 1.60 s | 0.52 ~ 0.85 s |
| `late_finishes` | 0 ~ 47 (median 0) | 0 ~ 210 (median 24) |
| `writer_seconds_max` | 16 ~ 57 s | 16 ~ 51 s |
| `files` (per step) | 3,038 ~ 6,019 | 2,639 ~ 5,882 |

Concept (transferable): **backpressure is a direct reading of queue overflow.** When a bounded queue cannot accept writes, the producer is blocked,
"Being blocked" will definitely be counted; so to determine "whether this layer is blocked", what you look at is the **number of nonzero overflow-counter occurrences**,
not the utilization percentage. **The correct reading of all 0 is "this layer's buffer is large enough / the long tail is absorbed by concurrency", not "there is no long tail".**
Decision rule: overflow counters all 0 + drain wait in seconds → this layer is not the bottleneck; do not optimize here;
Overflow counters nonzero and wait time reaching minutes → that is true backpressure; prioritize expanding this layer's buffer or write parallelism.

Corroborating evidence: `train/trace/records` jumps from 1.63e6 to 3.27e6 at pro step 17 (exactly doubles),
at the same moment `writer_seconds_sum` rises from about 5,000 seconds to about 8,000 seconds—it looks like the parallel strategy adjustment at step 17 doubled trace write parallelism along the way.
The dashboard gives no definitions for these two fields; this is only a coincident timing match and **is not used as a conclusion**.

### 3.7 Where the money goes

**Conclusion: the only thing the bill can be broken down into is "time × rate"; money per step increases with step, while money per token on clean steps is basically flat and slightly rising.**

| Measurement definition | pro | flash |
| --- | --- | --- |
| Rate | $5.71/s | $2.855/s (exactly half) |
| Bill (`rate × 计费秒数`) | **$1,941,107** (now still running) | **$854,045** (stopped at `end`) |
| Cumulative training token | 55.96 B | 81.40 B |
| Per 1 billion token (cumulative basis) | $34,686 | $10,492 |
| Per 1 billion token (**clean steps only**) | **$23,197** (17 steps / 46.48 h / 41.19 B) | **$8,203** (26 steps / 56.59 h / 70.91 B) |
| Cost per step (median, clean steps) | $51,731 | $22,201 |
| Cost per step (first step / last step, including restarts) | $140,115 / $75,167 | $18,959 / $35,464 |
| Clean-step unit cost vs step number | +0.84 | +0.28 |
| Gap (Basis A) | 26.147 h = **$537,478 = 27.7% of the bill** | 14.147 h = **$145,403 = 17.0% of the bill** |

- **How cost per step changes with step**: clean-step actual duration rises from pro's 1.905 h to 3.657 h (rank correlation +0.931),
  flash rises from 1.845 h to 3.451 h (+0.909). Longer steps mean more expensive steps; this is the direct bill for longer context.
- **How much is spent per billion token**: **the cumulative-basis "decrease" is an illusion.** pro's cumulative value drops from $77,819/B to $34,282/B,
  but step 1 itself had two restarts within 6.82 hours and produced only 1.80B token, raising the starting point extremely high.
  After excluding restart steps, pro's unit cost **rises** with step (+0.84), while flash is basically flat (+0.28).
  So the correct statement is "**unit cost does not decrease with scale**", not "training became cheaper".
- **How much is the "did nothing" time worth**: pro $537,478 (27.7%), flash $145,403 (17.0%).
  But note the conclusion in 3.2—the portion of this money that is truly "pure downtime" cannot be measured for either run; only flash's 3.96 hours can **prove** it was wasted compute.
- **Share of grading compute: cannot be estimated, only the concurrency magnitude can be given.** Median total time per grader group 553.7 s (pro) / 570.9 s (flash),
  of which pass1 accounts for **97.2%**, pod setup only 2.7%; groups per step (`groups_total`) median 1,548 / 1,668,
  Thus the number of concurrent grader groups ≈ `组数 × 每组秒数 ÷ 真实步耗时` ≈ **pro 80, flash 112** (if `groups_attempted` is used, then 36 / 65).
  **The reason the dollar share cannot be calculated is hard: `status.json` has only one global `rate_per_s`, with no rate specific to the grading cluster.**
  Whether this rate is "the machine-count reading of the training cluster" (the `notes/07` reading) or "training + grading together", the data has no answer.

### 3.8 Restart profile

**Conclusion: only 6 of the 16 restarts had official announcements; restart intervals have no trend; no "under what conditions restarts are more likely" can be found.**

| run | Count | Observation span | MTBF | Median interval | Shortest / longest interval | Interval trend (Spearman vs order) |
| --- | --- | --- | --- | --- | --- | --- |
| pro | 11 | 93.33 h | 8.48 h | 4.72 h | 0.96 h / 24.05 h | −0.03 (n=10, no trend) |
| flash | 5 | 81.80 h | 16.36 h | 17.54 h | 2.34 h / 29.79 h | −0.80 (**n=4, not trusted**) |

**Classified by cause** (announcements name a run and a step number, then nearest-in-time matching is done; consecutive restarts within 3 hours in the same incident are grouped under one announcement):

| Cause | Count | pro | flash | Covering announcement |
| --- | --- | --- | --- | --- |
| Single-node VRAM (vram) | 1 | 1 | 0 | `n-92030c`（pro s11） |
| Network disconnection between the training cluster and the grading deployment | 2 | 2 | 0 | `n-15ac72` (pro s15, twice) |
| Expert load imbalance causing GPU OOM | 2 | 2 | 0 | `n-4e29eb` (pro s17, twice) |
| Dataset infra error went undetected for about 3 hours | 1 | 0 | 1 | `n-b60f90`（flash s16） |
| **Unknown (no announcement)** | **10** | **6** | **4** | — |
| Total | 16 | 11 | 5 | 4 announcements |

**This is inconsistent with the existing insight `notices-explain-outages` ("five announcements explain almost all restarts").**
Based on the current complete data, 4 of the 5 announcements are related to restarts; they can only explain pro's 5 (s11, s15×2, s17×2) and flash's 1 (s16),
**the remaining 10 have no announcement**: pro's s1×2, s2, s3, s23×2 (the latter two are exactly the two from the morning of 09-19 mentioned by `notes/07`),
flash's s3, s25×2, s28. The announcement board is not a complete log of restarts.

**"Are restarts more likely under specific conditions"—the test result is not significant, and all effect sizes are very small.**

Definition: sample = feature values of "the **previous completed step** of the step interrupted by the restart" (pro n=6 vs the other 18; flash n=4 vs the other 26).

| Feature | pro median (before restart / other) | Cliff's δ | p | flash median | Cliff's δ | p |
| --- | --- | --- | --- | --- | --- | --- |
| Average generation length | 87,360 / 88,390 | −0.111 | 0.572 | 113,600 / 101,900 | +0.192 | 0.388 |
| Training tokens this step | 2.289B / 2.312B | −0.111 | 0.572 | 2.941B / 2.631B | +0.212 | 0.343 |
| Average number of turns | 52.64 / 53.42 | −0.093 | 0.637 | 57.69 / 58.35 | −0.077 | 0.730 |
| Time per grader group | 560.3 / 552.3 s | +0.185 | 0.346 | 558.9 / 570.9 s | −0.327 | 0.142 |
| In-flight sandboxes | 23,300 / 23,220 | +0.019 | 0.925 | 38,110 / 38,080 | −0.019 | 0.931 |
| Policy entropy | 0.3993 / 0.3970 | −0.056 | 0.777 | 0.4378 / 0.4340 | +0.058 | 0.796 |
| Reported step duration | 8,781 / 9,420 s | −0.167 | 0.396 | 8,493 / 8,086 s | 0.000 | 1.000 |

**All p > 0.14, all |δ| ≤ 0.33.** The only direction worth noting is flash's "slightly shorter grading time + a bit longer + a bit more tokens" (|δ| = 0.19~0.33),
But n=4, **this is a noise-level difference and cannot be written as a regularity**. The honest conclusion is: **on these 6 features, the step before a restart and an ordinary step have no detectable difference.**

### 3.9 Why flash "stopped in an orderly way": what state it stopped in from the system side

**Conclusion: after `end` the billing meter stopped; the rate never changed from beginning to end; when it stopped, the clock of that "in-progress step" also froze.**

`notes/07` has already established "rate = machine-count reading, flash's machines were not freed up for pro". This article adds three verifiable system-side facts under the same definition:

1. **The billing meter froze at `end`, rather than continuing to run.** `cost.so_far ÷ rate = 299,140.0 秒`, while
   `run.end − run_start = 299,140 秒`, **exactly equal**; at the same moment `now − run_start = 322,900 秒`.
   That is, flash's final bill is exactly $854,044.70; the 6.6 hours after the stop (23,760 seconds) were not billed.
   (pro has no `end`, `cost.so_far ÷ rate` equals `now − run_start`, indicating this identity holds for both runs.)
2. **The rate is indeed half of pro's, and there is no step change before or after the stop.** flash `rate_per_s = 2.855`, pro `5.71`, ratio 2.000;
   In the 27 synchronization points of `timeline.jsonl`, flash's `rate` field is 2.855 throughout, with no jump.
   **The question "does the rate still hold after the stop" has a harder answer than `notes/07`: it no longer accumulates, so the quantity "rate after the stop" does not exist.**
3. **The "in-step state" at the instant of the stop was frozen together.** Among the last 5 synchronization points (after step 30 completed),
   `step` is identically 30, `since` is identically 4659.006 seconds, `gen_frac` is identically 0.5173, `progress`/`phase` become `null`.
   That is: the dashboard stops at "step 31 has run for 4659 seconds (expected 12066 seconds, progress 39%)", and this number no longer refreshes.
   This explains why what the community saw was "it stopped there" rather than "it reported an error".
4. flash stopped at step 30, while pro was still running; the comparison of their `env/active` also supports "the machines were not moved away":
   flash was 38,694 before stopping; pro jumped from 23,400 to 38,437 in the same period—**pro raised its own concurrency watermark to flash's level**,
   but its `rate_per_s` did not move at all. **(This is a new finding in this article; `notes/07` had not yet seen step 23 at the time: pro's `env/active`
   jumped from 23,419 to 37,888 within one step at s23, +61.8%, and stayed there afterward; in the same period, s24 created 64,976 sandboxes in a single step, 1.58 times the clean-step median of 41,216.)
   According to the `notes/07` reading "rate = machine count", the unchanged rate means **the training machine count did not change; what changed was the sandbox concurrency cap**—
   This was a configuration change at the orchestration layer, not adding machines.

### 3.10 Are `step.since` / `expected` / `progress` / `gen_frac` trustworthy

**Conclusion: `since` and `phase` are real signals; `progress`, `expected`, and `gen_frac` are all not real-time observations of "the current step". The median of `expected` is almost unbiased, but the error distribution is very wide, and it is one-sidedly optimistic when it is most needed to be accurate (when step length steps up).**

(First correct a place where I myself wrote it wrong: the draft wrote the `gen_frac` of flash's step 20 trajectory as 0.5318; after recomputation, the correct value is **0.4144**,
equal to the `3632.2 ÷ 8765.3` of the previous step s19. The table in Section 3 has been corrected; the `gen_frac` definition has no exception.)

Three mechanical identities, all verified point by point at the 27 synchronization points (both runs hit 27/27, maximum error 0):

| Field | Actual definition | Hit |
| --- | --- | --- |
| `progress` | `min(1, since / expected)` | Maximum absolute error **0** |
| `expected` | **Median reported time of the last 3 completed steps** (rolling 3 median, frozen when entering the current step) | 27/27 |
| `gen_frac` | **The previous step's `outer_gen ÷ 上一步的上报耗时`**, frozen unchanged for the entire step | 27/27 |

So:
- `progress` contains no new information; it is a derived value of `since / expected`;
- `gen_frac` **cannot** be used to see "how far this step's generation has progressed"—it describes the **previous step's** generation fraction, and this step is the same number from start to finish;
- `expected` is a "backward-looking 3-step median" predictor: it does not look at this step's load or at the trend, and only uses the history of the most recent three steps.

Quantified deviation (using only non-restart steps; `expected`'s relative error against that step's true duration):

| run | Step count | Median | Mean | Minimum (most optimistic) | Maximum (most pessimistic) | Optimistic-biased step count |
| --- | --- | --- | --- | --- | --- | --- |
| pro | 17 | +0.13% | +0.68% | **−11.26% (step 7)** | +31.24% | 8 / 17 |
| flash | 25 | −1.57% | −1.13% | **−21.54% (step 30)** | +32.24% | 16 / 25 |

**Reading must be precise**: `expected` is **not** "always optimistic"—by median it is almost unbiased (pro +0.13%, flash −1.57%),
Pessimistic and optimistic each account for half. The real issue is the **error magnitude**: pro's decile is −10.7%, flash's is −13.6%,
That is, "the first 10% on the optimistic side underestimates by more than 10%." These large deviations are concentrated in **the steps where step length jumps up**:
pro steps 7, 9, and 14 are −11.3% / −10.7% / −10.3%, respectively; flash steps 30, 14, and 20 are −21.5% / −13.9% / −13.6%.
The mechanism is straightforward: the rolling 3-step median cannot catch up with a monotonic increase, and rising step length is the norm in this training run (for clean steps, the rank correlation of true duration is +0.93 / +0.91).
Conversely, on steps where step length fluctuates, it is pessimistic (pro's maximum is +31.2%).
**Using `progress` to judge "how much longer" will not deceive you continuously, but it will deceive you the most on the slowest steps.**

**Three complete within-step trajectories (reconstruction approach: connect rows in `timeline.jsonl` with the same "in-progress step number", `since` monotonically increasing,
`restarted_at` unchanged):**

**(1) flash step 20—the only sample that starts from 0 seconds and covers the entire process (9 collection points, interval 1205 seconds)**

| Wall clock | `since` | `progress` field | Recompute `since/expected` | `phase` | `gen_frac` |
| --- | --- | --- | --- | --- | --- |
| 1789647041 | 8.2 | 0.0009 | 0.0009 | rollout | 0.4144 |
| 1789648245 | 1211.3 | 0.1382 | 0.1382 | rollout | 0.4144 |
| 1789649450 | 2417.8 | 0.2758 | 0.2758 | rollout | 0.4144 |
| 1789650655 | 3617.9 | 0.4127 | 0.4127 | rollout | 0.4144 |
| 1789651858 | 4824.0 | 0.5503 | 0.5503 | **training** | 0.4144 |
| 1789653062 | 5989.5 | 0.6833 | 0.6833 | training | 0.4144 |
| 1789654266 | 7232.2 | 0.8251 | 0.8251 | training | 0.4144 |
| 1789655469 | 8437.0 | 0.9625 | 0.9625 | training | 0.4144 |
| 1789656673 | 9640.9 | **1.0000** | 1.0000 | training | 0.4144 |

Actual completion at wall clock 1789657177.8 (`since` = 10,143.5 seconds), reported 10,142.1 seconds (difference 1.4 seconds; it is a clean step).
Three readings: `gen_frac` stays pinned at **0.4144** throughout (= `3632.2 / 8765.3` of the previous step s19),
`phase` flips from rollout to training between `since` 3617.9~4824.0 (roughly consistent with the reported `outer_gen` = 4932.0 seconds),
`progress` hits 1.0 at `since` = 8765.3 (= `expected`), while this step actually ran for 10,143.5 seconds
—**That is, the "100% progress" state lasted 1376.8 seconds, accounting for 13.6% of the step** (exact value = reported duration − `expected` = 10,142.1 − 8,765.3).

**(2) flash step 19—second-half sample (5 collection points, missing the first 3931.9 seconds)**

`since` 3931.9 → 7570.9, `phase` flips from rollout to training at 5159.1, `expected` 8,930.4 seconds,
Actual 8,766.1 seconds / reported 8,765.3 seconds. For this step, `expected` is pessimistic by 1.9%—**which matches "the step is getting shorter":**
s19's 8,765 seconds is shorter than s18's 8,930 seconds, and the rolling 3-step median has not caught up yet.

**(3) pro step 15—a step with a restart, best illustrating why `progress` cannot be trusted (11 collection points)**

Restart #7 resumes at 1789644107.334; after that, `since` rises from 526.0 to 12564.7, `expected` = 9416.42 (rolling 3-step median =
the median of 9063.0 / 9416.4 / 10491.6 for s12/s13/s14). `progress` hits 1.0 at `since` = 9416.4,
**But this step then ran for another 3465.2 seconds—26.9% of the step's reported duration (12881.6 seconds)**,
and these 3465 seconds are `phase = training` and `progress = 1.0000` throughout (script field `progress_pinned_seconds_exact`).
Judging "it will be done soon" by "100% progress" will be wrong by nearly an hour.
(The minimum duration that can be directly counted from the collection points is 3148.3 seconds, because the last collection point falls at 12564.7 seconds.)

**(4) freeze after flash stops (step 31, 6 collection points)**

`since` is identically 4659.006, `progress` and `phase` are `null`, `gen_frac` is identically 0.5173.
This is not "stuck"; it is that the run has already `end`, and the dashboard no longer updates—this is also evidence for item 3 in 3.9.

---

## IV. Uncertain, overturned, inconsistent

**Overturned / need correction**

1. **Old insight `timing-excludes-restart`'s 23.7 hours / $488k**: it can be reproduced under "old slice as of step 19 + wall clock as denominator"
   (script recomputation: 23.75 h / 32.9% / $488,205; the difference from the original $488,074 comes from wall-clock rounding).
   After switching to the current slice and definition A, it is **26.15 h / 28.0% / $537,478**. **The conclusion is not overturned, but the numbers need to be re-reported along with the slice and denominator.**
2. **Old insight `notices-explain-outages` ("five announcements explained almost all restarts")**: according to the complete data, only 6/16 restarts had announcements; 10 did not.
3. **`notes/07` and `env/total_setup ÷ env/active ≈ 14` in the metric explainer are "turnover rate"**: that is the **within-segment cumulative** turnover count,
   Dividing by the number of steps in the segment gives per-step turnover (pro 1.79~2.02, flash 1.09~1.47). The original reading overestimated the sandbox count by about 8×.
   The opposite of "sandbox lifetime matches trajectory length fairly stably" in the same passage is also overturned: W monotonically lengthens on both runs (3.4).
4. **In `notes/07`, "pro's env/active steady state is about 22k~24k"**: from step 23 onward it becomes 37.9k~38.4k,
   The data slice for `notes/07` has not yet reached step 23; this item needs updating.

**An item "assumed in the task but not supported by the data"**

5. **The chain "steps get longer → trajectories cannot finish → data gets stale" breaks in the middle** (3.5). Getting longer and getting stale are both facts,
   but there is no detectable association between them: the rank correlation between `avg_staleness` and true step duration is −0.235 / −0.070,
   With "steps since last restart", it is +0.944 / +0.885. **The version that holds up is "steps since last restart → data becoming stale".**

**Mismatches (state them explicitly, do not fill in by guessing)**

6. **The sum of buckets `n_tokens` is only 45%~56% of `perf/total_num_tokens`** (pro median 0.511, flash 0.526),
   All 54 steps are like this, direction consistent but ratio not fixed. The dashboard gives no definition, **do not draw any conclusion from this**.
7. **"The rest" (`step − outer_gen − trainer_ops`) has no counterpart** (3.3). Magnitude 200~225 seconds, grows with token count,
   Same order of magnitude as grading time but a different pool, and 1~2 orders of magnitude off from pod setup / drain wait / write-out.
8. **`timeline.jsonl` has only 27 synchronization points**, so "within-step trajectories" are complete only for flash step 20;
   The remaining steps either lack the beginning (pro s24, flash s19), cross a restart (pro s15, flash s25), or are frozen for the entire segment (flash s31).
   **The conclusion about "whether the progress fields are accurate" is based on 4 trajectories, 35 collection points total; by collection points the sample size is very small.**
9. **The fields of `live.jsonl` (the `accept` / `judged` / `remain` / `remain_partial` / `prewarm_wait` / `partial` triples)
   The dashboard has no official explanation.** Among them `prewarm_wait` is large in magnitude (pro max 7,671 seconds, flash max 5,309 seconds),
   but it is unclear whether it is "cumulative wait" or "current wait", and also unclear whether it overlaps with `outer_gen`,
   **This article deliberately did not use it in any calculation**, only mentioned it once in 3.5 as indirect corroborating evidence that "the trajectory cannot be completed".
10. **The optimistic bias in `expected` is one place I got wrong in the first draft and corrected after recomputing** (3.10): the median is actually almost unbiased,
    The real problem is that "the steps where accuracy is most needed have the largest error". This shows that on dashboards like this,
    **A judgment like "a field is systematically biased to one side" must look at the distribution, not a few examples.**

**Hard limitations of the method**

11. **The crash moment is unobservable**, only the recovery moment. So "downtime" and "progress burned before the crash" cannot be separated on all 11 pro restarts;
    Only flash step 16, because of the `redo=true` event, can **prove** 3.96 hours as wasted.
    To separate them, you need: the "last heartbeat/progress snapshot" moment of each restart, or process-level exit logs.
12. **The dollar share of grading compute cannot be calculated**, because `status.json` only has one global rate (3.7).

---

## 5. Appendix: Core Numbers

Recomputation: `bun src/pipeline_report.ts` → `analysis/zh-CN/numbers/A3-pipeline-numbers.json`

| Metric | pro | flash |
| --- | --- | --- |
| Steps / Restarts | 24 / 11 | 30 / 5 |
| Rate | $5.71/s | $2.855/s |
| Billed seconds | 339,948.7 s（now） | 299,140.0 s (stopped at `end`) |
| Bill | $1,941,106.95 | $854,044.70 |
| Sum of real step durations | 93.329 h | 81.800 h |
| Sum of reported step durations | 67.182 h | 67.653 h |
| Gap (Basis A) | 26.147 h = $537,478 (bill 27.7% / real sum 28.0%) | 14.147 h = $145,403（17.0% / 17.3%） |
| Gap (Basis B) | 27.248 h = $560,119（28.9%） | 15.441 h = $158,705（18.6%） |
| Recovery overhead (last restart each time) | 740.3 ~ 799.9 s | 328.3 ~ 367.0 s |
| Proven wasted compute | 0 (no `redo`) | 14,265.4 s（s16+s17） |
| Clean step real duration median | 2.517 h | 2.160 h |
| Clean step real duration vs step number | +0.931 | +0.909 |
| Cost per step median (clean steps) | $51,731 | $22,201 |
| Per 1 billion tokens (clean steps) | $23,197 | $8,203 |
| Per 1 billion tokens (cumulative) | $34,686 | $10,492 |
| Little's law W median (reliable segment) | 1.430 h | 1.987 h |
| Per-step per-slot turnover (reliable segment) | 1.90 ~ 2.02 | 1.09 ~ 1.47 |
| Steady state `env/active` | 23,060 ~ 23,450 (38,163 from s23) | 37,840 ~ 38,729 |
| New sandboxes per step in steady state (median, clean steps) | 41,216 | 42,032 |
| `avg_staleness` peak / bucket count cap | 1.821 / 8 | 2.183 / 10 |
| Grading time per group median / pass1 share | 553.7 s / 97.2% | 570.9 s / 97.3% |
| Grading concurrency median (`groups_total` / `groups_attempted`) | 79.8 / 36.1 | 112.1 / 64.9 |
| MTBF / median restart interval | 8.48 h / 4.72 h | 16.36 h / 17.54 h |
| Announced restarts | 5 / 11 | 1 / 5 |
| Nonzero count of backpressure-class counters | 0 (24 steps × 6 items total) | 0 (30 steps × 6 items total) |
| `drain_wait_seconds` max | 8.23 s | 5.87 s |

### Step-by-step details (all omitted columns are output by the script)

| pro step | true h | Reported s | gap s | Other s | active | New sandboxes | staleness | Bucket count | Generation length k |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 6.82 | 9569.8 | 14968.7 | 166.6 | 31135 | 31135 | 0.0000 | 1 | 68.1 |
| 2 | 3.83 | 7225.2 | 6578.7 | 165.9 | 22352 | 22352 | 0.1826 | 2 | 65.1 |
| 3 | 5.42 | 8494.5 | 11018.7 | 173.8 | 22368 | 22368 | 0.0594 | 2 | 70.0 |
| 4 | 1.90 | 6850.6 | 6.1 | 174.3 | 23266 | 90400 | 0.8151 | 2 | 76.1 |
| 5 | 1.93 | 6958.4 | 0.3 | 173.8 | 22998 | 128528 | 1.1668 | 3 | 76.4 |
| 6 | 1.93 | 6941.0 | 8.1 | 183.6 | 23064 | 168144 | 1.4141 | 4 | 80.6 |
| 7 | 2.17 | 7818.9 | 2.9 | 189.4 | 23153 | 206656 | 1.6207 | 5 | 85.5 |
| 8 | 2.15 | 7747.3 | −6.6 | 193.0 | 23124 | 248448 | 1.7459 | 6 | 87.3 |
| 9 | 2.41 | 8662.0 | 14.4 | 198.0 | 23332 | 287312 | 1.8208 | 7 | 89.6 |
| 10 | 2.11 | 7589.1 | 0.9 | 192.2 | 23180 | 330720 | 1.7878 | 8 | 84.9 |
| 11 | 5.59 | 9422.8 | 10690.0 | 216.2 | 22629 | 22629 | 0.4403 | 8 | 82.4 |
| 12 | 2.52 | 9063.0 | −3.3 | 187.3 | 23848 | 86528 | 0.6779 | 2 | 89.0 |
| 13 | 2.62 | 9416.4 | 10.9 | 208.2 | 23671 | 137712 | 1.0074 | 3 | 95.5 |
| 14 | 2.91 | 10491.6 | 1.8 | 227.3 | 23653 | 178352 | 1.2125 | 4 | 102.0 |
| 15 | 8.31 | 12881.6 | 17025.4 | 203.4 | 22415 | 22415 | 0.0000 | 1 | 87.5 |
| 16 | 2.22 | 7992.3 | 1.9 | 194.3 | 22827 | 102528 | 0.8234 | 2 | 89.9 |
| 17 | 9.44 | 12807.7 | 21172.9 | 236.5 | 22365 | 22365 | 0.2094 | 3 | 87.8 |
| 18 | 3.50 | 12593.1 | 16.2 | 232.1 | 23687 | 91088 | 0.6793 | 2 | 95.4 |
| 19 | 3.29 | 11831.2 | −2.0 | 232.1 | 23168 | 147904 | 1.0133 | 3 | 97.0 |
| 20 | 3.80 | 13694.5 | 2.6 | 244.9 | 23375 | 184256 | 1.2340 | 4 | 104.2 |
| 21 | 3.75 | 13509.9 | −5.0 | 281.6 | 23370 | 230656 | 1.1966 | 5 | 103.6 |
| 22 | 3.60 | 12952.0 | 6.7 | 269.0 | 23419 | 281408 | 1.2945 | 6 | 106.2 |
| 23 | 7.44 | 14180.2 | 12615.9 | 260.5 | **37888** | 37888 | 0.1294 | 6 | 101.4 |
| 24 | 3.66 | 13161.2 | 2.9 | 256.0 | **38437** | 102864 | 0.7505 | 2 | 114.7 |

| flash step | true h | Reported s | gap s | Other s | active | New sandboxes | staleness | Bucket count | Generation length k |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.84 | 6482.8 | 158.0 | 155.7 | 39280 | 39280 | 0.0000 | 1 | 67.5 |
| 2 | 1.36 | 4898.8 | 3.4 | 151.3 | 37732 | 108768 | 0.8519 | 2 | 74.6 |
| 3 | 3.86 | 6923.1 | 6980.0 | 179.2 | 38272 | 38272 | 0.1810 | 3 | 73.4 |
| 4 | 1.87 | 6725.6 | −2.2 | 173.4 | 37624 | 106064 | 0.8437 | 2 | 83.4 |
| 5 | 1.57 | 5653.5 | 1.8 | 320.3 | 37257 | 143616 | 1.2779 | 3 | 86.2 |
| 6 | 1.70 | 6107.0 | 5.5 | 186.0 | 37449 | 178608 | 1.6127 | 4 | 88.0 |
| 7 | 1.76 | 6353.9 | −2.7 | 193.1 | 37448 | 214752 | 1.7809 | 5 | 93.5 |
| 8 | 1.62 | 5831.8 | 8.6 | 195.0 | 37900 | 253184 | 1.7438 | 6 | 89.7 |
| 9 | 1.72 | 6192.0 | 9.1 | 199.3 | 38070 | 291872 | 1.7004 | 7 | 89.0 |
| 10 | 1.73 | 6219.7 | −0.8 | 203.4 | 38039 | 330800 | 1.7033 | 8 | 92.0 |
| 11 | 1.96 | 7041.9 | 0.1 | 219.9 | 38074 | 370688 | 1.7034 | 9 | 98.9 |
| 12 | 1.95 | 7012.9 | 4.2 | 212.2 | 38087 | 413488 | 1.7078 | 10 | 99.2 |
| 13 | 1.98 | 7122.4 | 2.2 | 221.1 | 37988 | 455232 | 1.8039 | 10 | 99.7 |
| 14 | 2.27 | 8171.8 | 8.6 | 228.3 | 37922 | 496480 | 1.8895 | 10 | 107.9 |
| 15 | 2.10 | 7552.1 | 3.3 | 223.2 | 37786 | 538096 | 1.8743 | 10 | 103.3 |
| 16 | 8.46 | 10192.6 | 20277.7 | 184.2 | 39296 | 39296 | 0.0000 | 1 | 94.4 |
| 17 | 2.22 | 8000.5 | −3.4 | 226.2 | 38194 | 115456 | 0.8369 | 2 | 104.1 |
| 18 | 2.48 | 8930.4 | 12.7 | 222.5 | 38055 | 160768 | 1.1400 | 3 | 111.2 |
| 19 | 2.44 | 8765.3 | 0.8 | 244.4 | 37964 | 206624 | 1.4814 | 4 | 119.3 |
| 20 | 2.82 | 10142.1 | 1.4 | 255.8 | 38169 | 249760 | 1.5905 | 5 | 124.8 |
| 21 | 2.28 | 8202.7 | 5.7 | 243.4 | 37896 | 297088 | 1.8013 | 6 | 118.3 |
| 22 | 2.54 | 9130.5 | 2.0 | 253.4 | 38232 | 339552 | 1.9269 | 7 | 121.7 |
| 23 | 2.33 | 8376.9 | 7.0 | 254.5 | 38197 | 386336 | 2.0337 | 8 | 120.1 |
| 24 | 2.62 | 9433.7 | 3.7 | 268.6 | 38425 | 428368 | 2.1832 | 9 | 124.0 |
| 25 | 7.51 | 10866.8 | 16180.7 | 260.4 | 38368 | 38368 | 0.3198 | 10 | 114.4 |
| 26 | 2.63 | 9454.2 | −3.4 | 232.9 | 39013 | 119056 | 0.8207 | 2 | 121.7 |
| 27 | 2.71 | 9746.7 | 0.3 | 235.0 | 38807 | 167616 | 1.1222 | 3 | 126.7 |
| 28 | 5.37 | 12066.1 | 7270.1 | 254.9 | 38639 | 38639 | 0.3711 | 4 | 123.2 |
| 29 | 2.65 | 9520.6 | 6.5 | 255.5 | 38692 | 123424 | 0.8495 | 2 | 126.8 |
| 30 | 3.45 | 12433.3 | −11.4 | 264.1 | 38694 | 170368 | 1.1918 | 3 | 143.4 |

---

## 6. Transferable Professional Concepts (definition + how this article embodies it + one decision rule)

### Concept 1: Little's law applied to training pipelines—using concurrency level to infer service time

**Definition**: In a stable queueing system, `L = λW`: average number of customers in the system = arrival rate × average dwell time. Knowing two of the three lets you calculate the third.
**How this article embodies it**: `env/active` is L, the single-step increment of `env/total_setup` divided by the real step duration is λ,
Thus W (average sandbox lifetime) can be calculated without instrumentation: pro 1.43 h, flash 1.99 h, increasing monotonically as training progresses (table in 3.4).
**Decision rule**: As long as you have the two metrics "level + arrival rate", you can infer "how long each unit is occupied",
With it you can determine "whether the metric worsened because more arrived or because each one ran longer"—in this article, W increasing indicates the latter (trajectories getting longer), not concurrency being suppressed.

### Concept 2: Staleness as a proxy for queueing delay—but first ask when it resets to zero

**Definition**: In an asynchronous pipeline, the data used for training was collected "several policy versions ago"; `avg_staleness = Σ k × frac_k`
(k is the version gap, frac is that version's token share) is "how many versions behind the data is on average". It is conceptually equivalent to the sojourn time of a queueing system.
**How this article embodies it**: After each restart, pro's staleness rises from 0 to 1.82, flash's rises to 2.18, then resets to zero and starts over;
Its rank correlation with "steps since last restart" is 0.944 / 0.885, and with real step duration only −0.235 / −0.070.
**Decision rule**: **For any "latency-type" metric, first find its reset event.** If the reset is triggered by an external event (restart, rollback, reset),
then the variance of that metric mainly comes from the reset frequency, and it cannot be used directly as a load meter; to measure the effect of load on it, you must run a regression within the segment between two reset events.

### Concept 3: Backpressure is a direct reading of queue overflow, not utilization

**Definition**: When a bounded queue is full and producers are blocked, this is called backpressure; in engineering it usually appears as explicit counters such as "wait count" and "wait seconds".
**How this article embodies it**: `backpressure_waits` / `backpressure_wait_seconds_sum` / `backpressure_wait_seconds_max` /
`orphan_resolves` / `failed_writes` / `terminal_conflicts` are identically zero across 54 step observations,
`drain_wait_seconds` ≤ 8.23 seconds (table in 3.6).
**Decision rule**: To judge "whether this layer is congested", look at the **nonzero count of the overflow counters**, not utilization.
All zeros only mean "the buffer is sufficient / the long tail was absorbed by concurrency"; it does not mean there is no long tail; nonzero and waits reaching the minute level are true backpressure.

### Concept 4: Cumulative counters vs single-step increments—reset semantics can create "false patterns"

**Definition**: Many monitoring quantities are "cumulative values since the last process start/reset" (in this article, `env/total_setup`, `env/total_error`,
`train/trace/records`). Two numbers placed together on a dashboard may be one cumulative and one instantaneous.
**How this article embodies it**: `env/total_setup ÷ env/active ≈ 14` looks like "14 turnovers per step", but it is actually the cumulative number of turnovers within the segment
(pro segment 3–10, 8 steps total), divided by the number of steps it is only 1.793; `env/total_setup` at the restart step is exactly equal to `env/active`,
Thus the increment at the first step after restart will include the creation amount missed in the previous segment (pro at that position is about 64k~80k, while clean steps have a median of 41k).
**Judgment rule**: when you see two numbers with an "abnormally large/abnormally stable ratio", first confirm whether the two are on the same time basis;
Cumulative values must be differenced and segmented by reset points; otherwise "segment length" will be read as "rate".

---

## 7. Quick terminology reference

| Term | Plain language |
| --- | --- |
| `axis.walls` | Wall clock timestamp at the **completion** of each step; the difference between adjacent entries is the true wall clock duration of that step |
| `timing_s/step` | The "how long each step takes" line on the dashboard; it counts only time the process is alive, excluding restart waiting and reruns |
| gap (gap) | True step duration − reported step duration. Includes three things: "progress lost before crash + downtime from crash to recovery + startup overhead after recovery" |
| `timing_s/outer_gen` | Wall clock spent on rollout generation within a step |
| `timing_s/trainer_ops` | Wall clock spent on the trainer's forward/backward pass and parameter update within a step |
| `env/active` | Current number of in-flight sandboxes (instantaneous level, not cumulative) |
| `env/total_setup` | Cumulative number of sandboxes created since the last restart (cumulative value, resets) |
| `partial/avg_staleness` | The average number of versions by which the data used for training at this step lags behind the current policy |
| `partial/<k>/frac` | Proportion of tokens that lag k versions behind in this step's batch |
| `train/trace/*` | Counters for the trajectory write pipeline (backpressure, drain, write-out, orphan parsing, write failures, etc.) |
| `predicted/expected`（`step.expected`） | Dashboard estimate of "how long the current step is expected to take"; in practice it is the median of the reported durations of the most recent 3 steps |
| `step.since` | How long the current step has been running (counted from the completion of the previous step or recovery from the last restart) |
| `step.progress` | `min(1, since / expected)`, not an independent observable |
| `gen_frac` | Ratio of the previous step's generation duration to that step's reported duration, frozen for the whole step |
| `redo` | Marker in the event stream indicating that this step was rerun once |
| MTBF | Mean time between failures; in this paper = observation span ÷ number of restarts |
| Little's law | `L = λW`, the queuing system's "number = arrival rate × sojourn time" |
| Cliff's delta | Nonparametric effect size, takes values −1~1; with small samples it is more worth looking at than p-values |
