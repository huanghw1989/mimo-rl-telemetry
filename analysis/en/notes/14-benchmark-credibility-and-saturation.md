# Benchmark leaderboard credibility and saturation prediction: does a 「score drop」 really count as a real change

> Material identity: **our own measurements**. All numbers are recomputed by script `src/bench_report.ts` from local telemetry
> recomputed from `data/store/`'s raw JSON; the script contains no hard-coded conclusion numbers;
> Reproduction commands are in section 13. Any paragraph marked 【Inference】 in the text is model extrapolation or my interpretation, not something directly proven by the data.
> Data as of: **pro step 24 / flash step 30 (flash has already `ended`)**.
> Sample size is the biggest constraint of this paper: each (benchmark, run) has only 16~25 points, and every conclusion in the paper reports n.
> This paper is a sequel to `analysis/en/notes/09-generation-length-correlation.md` and does not repeat its existing first-difference/correlation coefficient conclusions.

---

## 1. Summary: Six Conclusions

1. **Every benchmark has a "don't take it seriously" line.** The score difference between adjacent steps must exceed the following number to be worth taking seriously (95%, trend already removed):
   DeepSWE v1.1 pro **4.56 points** / flash **6.43 points**, In-house Coding Bench pro **1.55** / flash **1.68**,
   AutomationBench v1.0.6 pro **2.20** / flash **2.70**. The same threshold for the online main metric `dynsam/avg@n` is
   pro **4.1 percentage points** / flash **3.1 percentage points**. DeepSWE's noise is the largest of the three benchmarks, 3~4 times larger than In-house.

2. **Of 115 single-step changes, only 1 survives multiple comparisons.** Without correction, 9 are "significant" (8 up / 1 down);
   After Holm-Bonferroni correction within each benchmark×run, only **1** remains (In-house Coding / pro steps 16→18, +1.99 points,
   raw p=0.0019); if "whether this step deviates from the trend" is taken as the test object, **0** pass correction.
   In other words: **the vast majority of "score drops/score gains" on this dashboard are measurement noise, not model changes.**

3. **The overall trends of the three benchmarks are real; the recent trend cannot be seen.** The Theil–Sen slopes of all six (benchmark, run) are positive,
   all bootstrap 95% intervals exclude 0; when calculated by wall clock time (score per hour), the ordering and significance are completely consistent.
   But looking only at the **last 5 evaluation points**, all six slopes include 0 — the most recent evaluations have **no statistically discernible improvement**.
   Contrast: the online `dynsam/avg@n` on pro **declines significantly over the last 5 steps** (−1.09pp/step, CI [−1.93, −0.40]).

4. **The point estimate of lag L is 4~7 steps (pro) / 0~5 steps (flash); it cannot be pinned down as "4 steps".** After removing the common trend,
   the cross-correlation of pro's "generation length ↔ benchmark score" is optimal at L=4 on DeepSWE (bootstrap 84% falls at L=4),
   L=5 on In-house (88% falls at L=5), L=7 on Automation (67%); flash's distribution is scattered (mode 0~1, frequency 30%~35%).
   The optimal L differs for the same run across different benchmarks, so what the data supports is "**there is a positive lag on the order of 0~7 steps, with a magnitude of about 4 steps**",
   not "the lag is exactly equal to 4". Also, the nominal step number and "when this score can be read" are two different things (see section 6).

5. **Saturation extrapolation is basically unreliable; only the piecewise model dares to draw a conclusion, and what it says is "it has already reached a plateau".**
   In the extrapolation sense (**all of the following is 【Inference】**): smooth models (exponential saturation / Gompertz / logistic) in 5 of the 6 benchmark series
   have "plateau values" whose confidence intervals cannot even be determined (the interval upper bound runs to tens of thousands or even 10¹⁰⁸ in magnitude, because when c→0, a→∞ is not identifiable);
   The only identifiable one is In-house Coding / flash; its four models give a plateau of 61.6~67.2, a span of 5.5 points.
   The estimated plateaus of the piecewise linear-to-plateau model across the 6 benchmark series are **all below or close to the last observed value**.
   For `dynsam/avg@n`: pro's four models all give a plateau of 0.614~0.646 (measured peak 0.643@step 20),
   remaining headroom 1.7~4.9pp, while single-step noise is 4.1pp — **pro's remaining headroom is of the same order as the noise, which is to say "you can't tell how much is left"**;
   flash's plateau is between 0.648 (piecewise) and 0.766 (exponential), a model span of 9.3pp, **this prediction is not credible**.

6. **The claim that "flash is just faster" only reverses when aligned by cost.** At the same step number pro leads (`avg@n` in 24 common steps
   pro is higher 22 times; DeepSWE 16/16, In-house 15/15 all pro is higher); at the same cumulative token count, pro also leads
   (at 20B token, DeepSWE pro 63.53 / flash 58.90); **on the same cumulative cost, flash leads at all comparison points**
   (at $0.6M, `avg@n` 0.600 / 0.618, DeepSWE 63.23 / 65.68, In-house 60.92 / 62.24, Automation 46.93 / 52.22).
   The reason is that flash's `cost/rate_per_s` (cost rate, money burned per second) is exactly half of pro's, while it burns more tokens per step
   (30 steps 81.4B vs pro 24 steps 56.0B). So flash's advantage is **unit cost efficiency**, not sample efficiency.

---

## 2. Methods and Data Sources

| Item | Content |
|---|---|
| Leaderboard data | `data/store/benchmarks.json`: three leaderboards, `avg@3` (average of 3 samples per question), values sparsely stored by training step number |
| Training-side data | `data/store/runs/{pro,flash}/series.json` (pro 1944 metrics × 24 steps, flash 1974 × 30), `axis.json` (`steps`/`walls`/`run_start`), `status.json` (`events`/`totals`/`cost`) |
| Announcement | `data/store/notices.json` (5 items) |
| Recompute script | `src/bench_report.ts`, run `bun src/bench_report.ts` from the project root directory |
| Script artifacts | `analysis/zh-CN/numbers/A3-bench-numbers.json` (all numbers), `A3-bench-judgement-table.md` (complete decision table, generated with `--emit-md` parameter) |
| Randomness | Fixed seed `mulberry32(20260919)`; bootstrap 4000 times, permutation test 5000 times, saturated-parameter bootstrap 500 times. Rerun results are bitwise identical |
| Dependencies | No new dependencies. Student's t distribution, chi-square quantiles, Newey-West, autocorrelation, permutation test, bootstrap, and four nonlinear fits are all implemented within the scripts |

**Coverage and missing steps** (computed by the script from data, not copied):

| Leaderboard | run | Points | Covered steps | Missing steps |
|---|---|---|---|---|
| DeepSWE v1.1 | pro | 17 | 1~18 | 9 |
| DeepSWE v1.1 | flash | 23 | 1~25 | 7、9 |
| In-house Coding Bench | pro | 17 | 1~18 | 17 |
| In-house Coding Bench | flash | 23 | 1~25 | 7、9 |
| AutomationBench v1.0.6 | pro | 16 | 1~16 | None |
| AutomationBench v1.0.6 | flash | 25 | 1~25 | None |

Note that the insight in `content/insights.json` that "offline evaluation lags training progress by **4** steps" is already outdated: when it was written, the leaderboard had reached step 15/21,
now the leaderboard has reached step **18/25**, while training has reached step **24/30**, and the gap has become pro **6 steps** (AutomationBench missing 8 steps), flash **5 steps**.

**Three key definitional decisions**:

1. **"Single-step measurement noise" uses trend residuals, not adjacent differences.** Adjacent differences mix in the trend itself (+0.28~+0.57 points per step),
   Moreover, when the series has negative first-order autocorrelation, adjacent differences also **overestimate** noise (DeepSWE/flash's residual first-order autocorrelation is −0.461,
   its adjacent-difference standard deviation is 3.98 points; after removing autocorrelation, single-point noise is only 2.25 points). So the primary definition is
   **the standard deviation σ_pt of residuals after Theil–Sen detrending**, with the adjacent-difference definition also reported as a comparison.
2. **MDE (minimum detectable change)**: under single-point noise σ_pt, the standard error of the difference between two independent measurements is
   σ_pt·√2, so "how large must this difference be to take it seriously" is `MDE = 1.96 · σ_pt · √2 = 2.7716 · σ_pt`.
   All MDEs in the report use the 95% definition.
3. **Time axis**: the primary definition uses **training step number**; the robustness check uses **wall clock time** (`axis.walls` is the wall clock time at which each step completed,
   and has been checked point by point to be exactly consistent with the timestamps of the same-named steps in `status.events`). Because `cost/rate_per_s` is constant throughout for both runs,
   "by wall clock" and "by cost" are the same thing and are no longer listed separately.

---

## 3. How large is the measurement error for each leaderboard

**Conclusion**: DeepSWE's single-step noise is 3~4 times larger than the other two leaderboards; the three leaderboards' MDEs are 4.6~6.4 points, 1.6~1.7 points, and 2.2~2.7 points, respectively.
Of the 115 single-step changes, only 1 survives multiple comparisons.

**Plain English**: these three leaderboards are not the same ruler. The −6.05-point drop on DeepSWE looks scary, but even its "standalone" significance is only
barely enough (p=0.046), and it completely falls apart when placed among the 22 comparisons in that series. Conversely, because the In-house leaderboard has much less noise,
its "+1.99 points" is the only single-step change in this data that holds up.

### 3.1 Noise and MDE for each (leaderboard, run)

| Leaderboard | run | n | Adjacent-step σ_Δ | σ_pt (residual SD) | **MDE(95%)** | MDE interval derived from the σ interval | MDE (adjacent-difference definition) | Trend τ/step |
|---|---|---|---|---|---|---|---|---|
| DeepSWE v1.1 | pro | 17 | 2.01 | 1.59 | **4.56** | [3.25, 6.82] | 3.93 | +0.567 |
| DeepSWE v1.1 | flash | 23 | 3.98 | 2.25 | **6.43** | [4.79, 8.91] | 7.80 | +0.506 |
| In-house Coding | pro | 17 | 0.64 | 0.56 | **1.55** | [1.15, 2.41] | 1.25 | +0.388 |
| In-house Coding | flash | 23 | 0.66 | 0.49 | **1.68** | [1.05, 1.94] | 1.29 | +0.328 |
| AutomationBench | pro | 16 | 0.95 | 0.79 | **2.20** | [1.61, 3.47] | 1.85 | +0.276 |
| AutomationBench | flash | 25 | 1.39 | 0.97 | **2.70** | [2.10, 3.78] | 2.73 | +0.355 |
| `dynsam/avg@n` (control, unit=percentage points) | pro | 24 | 1.30 | 1.49 | **4.12** | [3.19, 5.84] | 2.55 | +0.37 |
| `dynsam/avg@n` (control) | flash | 30 | 1.81 | 1.11 | **3.08** | [2.45, 4.17] | 3.55 | +0.48 |

How to read: DeepSWE/flash's "adjacent-difference definition" (7.80) is even larger than the primary definition (6.43) because its residual first-order autocorrelation is **−0.461**,
the differencing noise is amplified by `(1−ρ)`, while the primary definition has already stripped this part out. **This is why one cannot estimate noise using only the adjacent-difference standard deviation**—
When the series swings back and forth between "high-scoring steps/low-scoring steps" (as DeepSWE/flash does), it systematically overestimates.

### 3.2 Back-inferring the "equivalent number of questions"

Assumption 1: each step's leaderboard score is the average pass rate of "Q questions, 3 independent samples per question", with homogeneous difficulty across questions;
Assumption 2: single-point noise comes entirely from sampling. Then σ_pt² = p(100−p)/N (p in percentage points), and N is the effective number of independent Bernoulli trials.

| Leaderboard | Q_pro ≈ | Q_flash ≈ | Ratio of the estimates from the two runs | Description |
|---|---|---|---|---|
| DeepSWE v1.1 | 290 | 150 | 1.94 | Fewest questions among the three leaderboards (or largest per-question variance) |
| In-house Coding Bench | 2536 | 2203 | 1.15 | The two runs are highly consistent |
| AutomationBench v1.0.6 | 1325 | 879 | 1.51 | Middle |

This is an [inference], not a fact provided by the dashboard—the dashboard did not provide the number of questions (`content/metrics.json`'s `benchmark/deepswe` entry clearly states
"did not provide the number of questions, sampling parameters, or grading details"). Two assessments:

- **May be correct**: SWE-bench-derived leaderboards like DeepSWE usually have only a few hundred questions, and the back-inferred 150~290 questions are a reasonable order of magnitude;
  In-house and AutomationBench back-infer thousands of questions, indicating that their question counts are far larger than DeepSWE's, which exactly explains why their curves are much smoother.
- **Not fully trustworthy**: on the same question set, the back-inferred values for pro and flash differ by a factor of 1.94 on DeepSWE. If the number of questions were the same number,
  this ratio should be close to 1, so at least half of the error in this back-inference comes from "the noise is not all sampling noise" (the model itself is drifting,
  and the question subset used for weekly evaluation may differ). **Use Q as a "lower bound on the effective number of independent questions", not as the true number of questions.**

### 3.3 Full determination: which single-step changes should be taken seriously

115 single-step changes (including changes spanning 2 steps caused by missing steps):

| Measurement definition | Significant count | Up / down |
|---|---|---|
| Naive 5% (compared only with within-series noise, no correction) | 9 | 8 / 1 |
| After Holm-Bonferroni correction (15~24 comparisons within group) | **1** | 1 / 0 |
| Deviation from trend + Holm correction | **0** | – |

Details for each group:

| Group | Number of changes | Naive significant | After Holm | Minimum p |
|---|---|---|---|---|
| DeepSWE / pro | 16 | 1 | 0 | 0.0167 |
| DeepSWE / flash | 22 | 0 | 0 | 0.0950 |
| In-house / pro | 16 | 3 | **1** | 0.0019 |
| In-house / flash | 22 | 2 | 0 | 0.0073 |
| AutomationBench / pro | 15 | 1 | 0 | 0.0264 |
| AutomationBench / flash | 24 | 2 | 0 | 0.0119 |

The only one that survived is **In-house Coding / pro step 16→18 +1.99 points** (spanning 2 steps, raw p=0.0019,
Holm threshold 0.05/16=0.0031). But note its identity: the **trend itself** of this step contributed +0.78 points,
After subtracting it, the residual +1.21 points is only 1.53σ (p=0.126). So the more accurate statement is "it is the step in this data that most resembles a real change,
but half of its significance comes from the 2-step time span".

The other 8 naively significant changes (all fail under Holm):

| Group | Step | Δ | Raw p | Note |
|---|---|---|---|---|
| DeepSWE / pro | 7→8 | +4.80 | 0.0167 | Single-step, within MDE |
| In-house / pro | 3→4 | +1.64 | 0.0104 | Single-step, just over MDE 1.25 (adjacent-difference criterion) |
| In-house / pro | 8→9 | +1.48 | 0.0208 | Same as above |
| In-house / flash | 11→12 | +1.77 | 0.0073 | Single-step, within MDE (this series has two gaps) |
| In-house / flash | 15→16 | +1.38 | 0.0364 | Single-step, within MDE |
| AutomationBench / pro | 6→7 | −2.10 | 0.0264 | Single-step, one of the few "below-trend" points in this data |
| AutomationBench / flash | 6→7 | +3.00 | 0.0311 | Spanning 2 steps |
| AutomationBench / flash | 14→15 | +3.50 | 0.0119 | Single-step, exceeds MDE 2.70; **this is the step with flash's highest point of the entire run, 51.2** |

**Update on the conclusion about `notes/09`**: it said flash's −6.05 points at step 11 "z≈−1.77, cannot rule out evaluation noise".
Recomputed on a trend-residual basis, this step's deviation is −6.56 points, **z=−2.00, uncorrected p=0.0456** —— nominally just crosses 0.05,
but it still cannot rule out noise, for two reasons: first, this series has 22 comparisons, so the Holm threshold is 0.0023; second, "−6.05 is the largest single-step drop over the entire run"
is itself a post hoc selected maximum, and the multiple-comparison effect will be more severe than in a per-test procedure. **The conclusion is unchanged, but the reason must be stronger than in notes/09:
it is not that "z is not large enough", but that "it is the maximum selected from 115 changes".**

---

## 4. Is the trend real

**Conclusion**: The overall trend is significant under both time axes, and the ordering is consistent; no trend is visible in the last 5 evaluation points.

**Plain language**: Looking at the entire training process over a longer horizon, all three leaderboards are rising steadily; this conclusion is very robust. But if you look only at the most recent evaluations,
that is "no trend within the noise" —— not "it has stopped", but **too few samples to see it**.

### 4.1 Full-series trend (Theil–Sen robust slope + bootstrap 4000 times)

| Leaderboard | run | n | Per step (points) | 95% CI | Per hour (points) | 95% CI | Last point relative to first point |
|---|---|---|---|---|---|---|---|
| DeepSWE | pro | 17 | +0.567 | [0.430, 0.743] | +0.171 | [0.129, 0.256] | +9.05 |
| DeepSWE | flash | 23 | +0.506 | [0.354, 0.613] | +0.194 | [0.140, 0.249] | +16.23 |
| In-house | pro | 17 | +0.388 | [0.312, 0.473] | +0.121 | [0.092, 0.173] | +6.13 |
| In-house | flash | 23 | +0.328 | [0.284, 0.368] | +0.128 | [0.103, 0.159] | +8.10 |
| AutomationBench | pro | 16 | +0.276 | [0.233, 0.480] | +0.101 | [0.076, 0.144] | +3.60 |
| AutomationBench | flash | 25 | +0.355 | [0.300, 0.400] | +0.143 | [0.119, 0.170] | +8.30 |

The ordering given by the two measures is completely consistent: **DeepSWE rises fastest > In-house > AutomationBench** (by step number).
By wall clock, the points per hour gained by the two runs are close (0.17 vs 0.19, 0.12 vs 0.13, 0.10 vs 0.14),
showing that "which leaderboard rises faster" is not an artifact caused by evaluation cadence. All six slopes exclude 0; the trend is real.

### 4.2 Do the most recent evaluations show discernible improvement

| Leaderboard | run | Last 5-point interval | Net change | Slope (points/step) | 95% CI | Exclude 0? |
|---|---|---|---|---|---|---|
| DeepSWE | pro | 14→18 | +2.86 | +1.115 | [−0.232, 1.553] | No |
| DeepSWE | flash | 21→25 | +5.31 | +1.106 | [−0.883, 3.242] | No |
| In-house | pro | 13→18 | +1.13 | −0.070 | [−0.433, 0.639] | No |
| In-house | flash | 21→25 | +0.60 | +0.252 | [−0.105, 0.630] | No |
| AutomationBench | pro | 12→16 | +1.10 | +0.475 | [−0.313, 0.800] | No |
| AutomationBench | flash | 21→25 | +1.70 | +0.538 | [−0.217, 0.925] | No |

**All six cannot exclude 0.** Moving the window to the last 8 points, only two become discernible:
In-house/flash +0.142 points/step [0.050, 0.303], AutomationBench/pro +0.563 [0.233, 0.667].
So for the question of "the most recent evaluations", the honest answer is **neither statistically discernible improvement nor statistically discernible stagnation**.

**Compare with the online main metric** (it exists at every step, with a much larger n):

| run | Full-run slope | Net change over last 5 steps | Trend expectation | Difference | z | Slope over last 5 steps | 95% CI | Exclude 0? |
|---|---|---|---|---|---|---|---|---|
| pro | +0.37pp/step | **−4.67pp** | +1.46pp | −6.13pp | −1.95 | **−1.09pp/step** | [−1.93, −0.40] | **Yes (decreasing)** |
| flash | +0.48pp/step | +0.55pp | +1.93pp | −1.37pp | −0.48 | +0.20pp/step | [−0.93, 1.36] | No |

pro's late-segment decline on the main metric is the **only significant "recently getting worse" signal in this data**, but it has no corresponding reading on the offline leaderboards
(pro's leaderboard goes only up to step 18, and the decline occurs after step 20) —— so it is a decline "seen only by the online metric and not externally verifiable".

---

## 5. Autocorrelation and effective sample size

**Conclusion**: pro's evaluation series has first-order autocorrelation 0.25~0.32, leaving only half the effective sample size; but after accounting for autocorrelation, the trends of the three leaderboards
**are still significant** (Newey-West p≤0.0026, block permutation p≤0.0008); at the single-step change level, after accounting for autocorrelation and multiple comparisons
**none remain**.

**Plain language**: Adjacent evaluation points are not independent pieces of information —— if step 12 is good, step 13 often is too. This makes "20 points" actually "10 points",
inflating significance. After discounting that, **"it is rising" still holds, but "this step rose" basically does not hold**.

### 5.1 First-order autocorrelation and effective sample size

Effective sample size uses the AR(1) standard formula `n_eff = n(1−ρ)/(1+ρ)`; ρ is the first-order autocorrelation of the Theil–Sen residuals.

| Leaderboard | run | n | ρ₁(residuals) | ρ₁(first differences) | n_eff | n_eff/n |
|---|---|---|---|---|---|---|
| DeepSWE | pro | 17 | +0.282 | −0.213 | 9.5 | 0.56 |
| DeepSWE | flash | 23 | −0.461 | −0.699 | 23.0 (the formula gives 62.4, which exceeds n, so it has been truncated to n) | 1.00 |
| In-house | pro | 17 | +0.251 | −0.396 | 10.2 | 0.60 |
| In-house | flash | 23 | +0.087 | +0.057 | 19.3 | 0.84 |
| AutomationBench | pro | 16 | +0.316 | −0.271 | 8.3 | 0.52 |
| AutomationBench | flash | 25 | −0.002 | −0.015 | 25.0 | 1.00 |

DeepSWE/flash's ρ₁ is −0.461, indicating that it is **not** a smooth autocorrelated series, but rather "high-low alternation" (one step high, one step low).
In this case the naive OLS test is conservative, so this paper truncates n_eff at an upper limit (not exceeding n),
and keeps the formula's original value in the JSON (`n_eff_formula_raw`) for reference.

### 5.2 Comparison of six methods for trend significance

| Leaderboard | run | n | p (naive OLS) | p (n_eff corrected) | p（Newey-West） | p (permutation: directly shuffle y) | p (permutation: circular block residuals) | p (differenced sign flip) |
|---|---|---|---|---|---|---|---|---|
| DeepSWE | pro | 17 | 0.0000 | 0.0005 | 0.0000 | 0.0002 | 0.0002 | 0.260 |
| DeepSWE | flash | 23 | 0.0000 | 0.0000 | 0.0000 | 0.0002 | 0.0002 | 0.119 |
| In-house | pro | 17 | 0.0000 | 0.0000 | 0.0000 | 0.0002 | 0.0002 | 0.132 |
| In-house | flash | 23 | 0.0000 | 0.0000 | 0.0000 | 0.0002 | 0.0002 | 0.753 |
| AutomationBench | pro | 16 | 0.0000 | 0.0026 | 0.0000 | 0.0008 | 0.0002 | 0.564 |
| AutomationBench | flash | 25 | 0.0000 | 0.0000 | 0.0000 | 0.0002 | 0.0002 | 0.994 |

(0.0002 = the lower bound among 5000 permutations. Block permutation rearranges residuals using circular blocks of length ⌈n^(1/3)⌉, preserving the autocorrelation structure.)

**Among the six methods, the three that discount autocorrelation (n_eff, Newey-West, block permutation) all give p≤0.0026.**
The sign test (number of rising steps vs falling steps) is the weakest, none are significant (the closest is In-house/flash with 16 rises / 6 falls, p=0.055) ——
because the sign test discards magnitude information and has little power at n≈20 to begin with.

### 5.3 After accounting for autocorrelation, how many "improvements/regressions" are still significant

- Single-step changes (115): naive 9 significant → **1 after Holm correction** → **0** after relative-to-trend + Holm.
- Series trends (6): all significant, and still significant after discounting autocorrelation.
- Late-segment trends (6 series, last 5 points): 0 significant.

One sentence: **「this leaderboard is rising overall」 withstands autocorrelation; 「this step rose/fell」 does not.**

---

## 6. Lag structure: how many steps evaluation lags behind training

**Conclusion**: After removing the common trend, pro's "length ↔ leaderboard score" cross-correlation does have an optimal lag of 4~7 steps
(the bootstrap distribution is very concentrated), but **the three leaderboards do not give the same L, and flash gives one even less**. So the data support "there is a lag, of magnitude about 4 steps",
and do not support "the lag is exactly 4 steps".

**Plain language**: The "step 12 score" on the evaluation leaderboard is produced by **the model at step 12**, but **it can only be seen once training reaches step 13**.
The official announcement itself said that the scores were backfilled. So "the leaderboard reaches step 18" does not equal "you have information for step 18".

### 6.1 Cross-correlation scan (L=0~8)

The trend must be removed first. If you scan directly with level values, the correlation coefficient for any L is 0.82~0.98 (DeepSWE/flash's `train/passrate` at L=0 is 0.819),
because both lines are rising over time — that is spurious correlation, not lag structure. Below are the results **after detrending**:

| Leaderboard | run | Training-side metrics | Optimal L | r (detrended) | Number of pairs for that L | bootstrap mode L (frequency) | L near the optimum within same-sample noise |
|---|---|---|---|---|---|---|---|
| DeepSWE | pro | `ctx_response_length/mean` | **4** | +0.663 | 13 | 4（84%） | 3,4,5 |
| DeepSWE | pro | `train/passrate/avg_passrate` | **4** | +0.389 | 13 | 4（43%） | 0~8 |
| DeepSWE | pro | `critic/score/mean` | 1 | +0.533 | 16 | 1（67%） | 0~8 |
| DeepSWE | pro | `dynsam/avg@n` | （6） | −0.367 | 11 | 1（26%） | 0~8 |
| In-house | pro | `ctx_response_length/mean` | **5** | +0.842 | 12 | 5（88%） | 4,5,6 |
| In-house | pro | `train/passrate/avg_passrate` | **5** | +0.756 | 12 | 5（69%） | 2,4~8 |
| In-house | pro | `critic/score/mean` | 1 | +0.649 | 16 | 2（41%） | 0~8 |
| AutomationBench | pro | `ctx_response_length/mean` | **7** | −0.472 | 9 | 7（67%） | 5~8 |
| AutomationBench | pro | `train/passrate/avg_passrate` | 0 | −0.620 | 16 | 6（81%） | 6,7,8 |
| DeepSWE | flash | `ctx_response_length/mean` | 1 | +0.339 | 22 | 1（32%） | 0~8 |
| In-house | flash | `ctx_response_length/mean` | 0 | +0.253 | 23 | 0（35%） | 0~8 |
| AutomationBench | flash | `ctx_response_length/mean` | 5 | +0.437 | 20 | 5（38%） | 0~8 |

How to read:

- **On pro, "length/training pass rate → leaderboard score" does have lag structure.** `ctx_response_length/mean` (average generation length of the training trajectories at this step)
  gives L=4/5/7 on the three leaderboards respectively; under bootstrap, 84%/88%/67% of resamples place the optimal L at the same value — this concentration shows
  the lag is not pure noise. `train/passrate/avg_passrate` (average pass rate of the batch of tasks entering training) gives L=4/5, consistent with it.
- **But the three leaderboards' L values are inconsistent (4 / 5 / 7), and flash's distribution is flattened over 0~8.** So the statement "the optimal L is 4"
  holds only on DeepSWE/pro; generalizing it to "evaluation overall lags 4 steps" is overgeneralization.
- **`dynsam/avg@n` (online primary metric) gives no lag at all.** Its detrended correlation on pro is entirely negative for L=0~5
  (L=0 is −0.36, and only L=6 has −0.37) — because the online metric and the offline leaderboards are both being pushed along by the same batch of data,
  after detrending, what remains is noise. **Using the online metric to guess evaluation lag is meaningless.**
- **Scanning L too far up loses samples.** At L=8, DeepSWE/pro has only 9 pairs left; the 95% critical |r| for the correlation coefficient is 0.666,
  the |r| values at L=8 are basically all below this threshold. So the "optima" at L=7 and L=8 are inherently unreliable.

### 6.2 Announcement backfill: nominal step number ≠ time at which the value becomes available

`notices.json` contains one entry (timestamp t=1789581497.496, i.e. **2026-09-16T17:58:17Z**):

> "we have updated the latest deepswe results for flash step 12 & pro step 8. we will keep posting as the offline evaluation results come out."

Cross-reference against `axis.walls` to find the moment this announcement was issued:

| run | Backfilled nominal step | Time that step completed | Step the run had completed at announcement time | Training steps between the nominal step and the announcement | Wall-clock interval |
|---|---|---|---|---|---|
| pro | Step 8 | 1789562521.98（2026-09-16T12:42:02Z） | Step 10 | 2 steps | **5.27 hours** |
| flash | Step 12 | 1789567997.15（2026-09-16T14:13:17Z） | Step 13 | 1 step | **3.75 hours** |

**This shows that the value of "nominal step 12" can only be read after 1~2 more training steps (several hours) after that step finishes running.**
Thus there are two different concepts of "progress":

- **Model-identity progress**: the score describes the checkpoint at which step (this is the convention used in this article, x-axis = nominal step number).
- **Information-availability progress**: as of a certain moment, the latest evaluation in your hands is for which step.

Any analysis of "**what we knew at a certain moment**" (e.g., retrospective decisions, computing as-of metrics) must use the latter;
this article uses the former when doing trend and saturation fitting, because the question being asked is "what the model looks like at step s".
If an as-of convention is to be used, the most conservative approach is to shift the observation window right by 1~2 steps overall (about 4~5 hours).
Another consequence is: **the current gap (pro 6~8 steps, flash 5 steps) is a "nominal gap"; with the backfill delay added, the actual information gap is even larger.**

---

## 7. Saturation prediction: how much room is left (★this entire section is inference/extrapolation)

**Conclusion**: more than three saturation models give highly divergent answers on this dataset, and **the "plateau value" of most series simply cannot be determined**.
The only relatively consistent point is: **pro's online primary metric remaining room (1.7~4.9pp) is of the same order as single-step noise (4.1pp)**,
that is, "you can't see how much is left". For flash's state at stopping, reading with a piecewise model gives "already at plateau", while reading with a smoothing model gives "still 8~10pp short",
**both readings are self-consistent, and the data is insufficient to decide**.

**In plain language**: for a curve with around 20 points that is still going upward, if you ask "where it can ultimately reach", mathematically it can be brute-forced,
but the computed answer is extremely sensitive to model choice. This report does not pick good-looking models to report numbers, but instead puts the answers of more than three models side by side,
so you can see how large the disagreement is.

### 7.1 Fitting methods and the "identifiability" criterion

Four models, all parameters solved with "profile + one-dimensional golden-section search" (after the nonlinear parameter c or K is given, the remaining parameters are linear and can be solved exactly):

| Model | Form | Parameters |
|---|---|---|
| `exp_saturation` | y = a − b·exp(−c·x) | a=plateau, b=total rise, c=rate |
| `gompertz` | y = a·exp(−b·exp(−c·x)) | a=plateau |
| `logistic` | y = K/(1+exp(−r(x−x₀))) | K=plateau |
| `piecewise_linear_plateau` | y = min(α+βx, P) | P=plateau, breakpoint grid search |

Parameter intervals use **residual bootstrap** (resample residuals, add them back to the fitted curve, refit 500 times). An **identifiability criterion** was added:
If the width of the 95% bootstrap interval for the plateau value exceeds "2 times the data range (max−min)", mark `identifiable=false`.
The reason is straightforward: for exponential/Gompertz, as c→0, a→∞, and with data from a finite window **it is mathematically impossible to distinguish "already close to the plateau" from "still rising slowly and linearly"**.
This report does not use such numerical values as predictions.

### 7.2 `dynsam/avg@n`

| run | n | First | Last | Peak | MDE | Model | Plateau value [95%CI] | Identifiable | Remaining (plateau−last) | Steps still needed to reach 90% | Remaining/MDE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pro | 24 | 0.565 | 0.596 | 0.643@20 | 0.041 | exp | 0.636 [0.623, 0.679] | Yes | +0.039 | −1.2 | 0.95 |
| pro | 24 | | | | | gompertz | 0.636 [0.622, 0.678] | Yes | +0.039 | −1.4 | 0.95 |
| pro | 24 | | | | | logistic | 0.646 [0.639, 0.726] | Yes | +0.049 | +2.5 | 1.20 |
| pro | 24 | | | | | piecewise | 0.614 [0.604, 0.622] | Yes | +0.017 | −11.9 | 0.42 |
| flash | 30 | 0.514 | 0.644 | 0.662@29 | 0.031 | exp | 0.766 [0.691, 1.190] | **No** | +0.123 | +52.7 | 3.98 |
| flash | 30 | | | | | gompertz | 0.742 [0.685, 0.975] | Yes | +0.098 | +37.6 | 3.18 |
| flash | 30 | | | | | logistic | 0.727 [0.679, 0.895] | Yes | +0.084 | +28.9 | 2.71 |
| flash | 30 | | | | | piecewise | 0.648 [0.633, 0.660] | Yes | +0.005 | −6.1 | 0.15 |

"Steps still needed to reach 90%" is "how many more steps from the last observed step are needed to complete 90% of the rise from the first point to the plateau"; a negative number means
"according to this model, 90% was already completed long ago".

- **pro**: all four models agree that the plateau is 0.614~0.646, while the measured peak is already 0.643 (step 20).
  Calculated as plateau minus **measured peak**, the remaining room is −0.029~+0.003 (essentially zero); calculated as plateau minus **last step** (0.596, which is a pullback value), it is +1.7~4.9pp.
  Both calculations are correct, depending on whether you treat the pullback at step 24 as "noise" or as a "real decline". **Either way, the remaining room does not exceed single-step noise (4.1pp).**
- **flash**: the piecewise model says the plateau is 0.648 (almost exactly the last step, 0.644), while the three smoothing models say 0.727~0.766,
  with an inter-model span of **9.3pp (about 3 times MDE)**. This is a textbook case of "unreliable prediction"; **you cannot pick that gompertz 0.742 as the conclusion**.

### 7.3 Three leaderboards

| Leaderboard | run | n | Last value | MDE | Identifiable models | Plateau value of identifiable models |
|---|---|---|---|---|---|---|
| DeepSWE | pro | 17 | 67.46 | 4.56 | piecewise only | 65.09 [61.08, 66.00] → remaining **−2.37** |
| DeepSWE | flash | 23 | 64.90 | 6.43 | piecewise only | 65.34 [60.96, 66.94] → remaining +0.44 |
| In-house | pro | 17 | 63.67 | 1.55 | piecewise only | 62.54 [61.92, 63.32] → remaining **−1.13** |
| In-house | flash | 23 | 61.93 | 1.68 | all four | exp 67.16 [64.51, 75.09]；gompertz 66.55 [63.85, 73.57]；logistic 66.18 [63.96, 71.20]；**piecewise 61.62 [61.09, 61.97]** |
| AutomationBench | pro | 16 | 49.80 | 2.20 | piecewise only | 49.48 [46.35, 49.15] → remaining −0.32 |
| AutomationBench | flash | 25 | 51.60 | 2.70 | piecewise only | 50.71 [49.69, 51.71] → remaining −0.89 |

**Of the 6 leaderboard series, 5 have only the piecewise model identifiable**, because their curves are still basically linear within this window,
Smooth models can only estimate the plateau by "assuming it will definitely bend," and this assumption cannot be tested with the data.

- The piecewise model's answer is uniformly "**already at the plateau or slightly above the plateau**" (5 have negative remaining, 1 has +0.44).
- For In-house/flash, the only one where all four models are identifiable, the answer ranges from 61.6 to 67.2, a span of 5.5 points, 3.3 times the MDE (1.68).

### 7.4 Goodness of fit, model comparison, and "which model is better"

| Criterion | Result |
|---|---|
| R² range | Leaderboard series 0.74~0.98; `avg@n` 0.79~0.95 |
| RMSE range | Leaderboard series 0.36~2.18 points; `avg@n` 0.010~0.012 |
| AICc best model | Among the 6 leaderboard series, piecewise wins 4 times, exp 1 time, gompertz 1 time; `avg@n` pro is piecewise, flash is gompertz |
| **AICc differences** | On DeepSWE/flash, exp (42.39) differs from piecewise (43.16) by only 0.77; on In-house/pro, piecewise (−15.53) differs from logistic (−14.70) by 0.83. **These differences are all less than 2, amounting to "no difference."** |
| Cross-model range of plateau values | All models: 0.03 (`avg@n` pro) ~ 10¹⁰⁸ (AutomationBench pro, contaminated by unidentifiable models); **counting only identifiable models**: 0 (only one identifiable) ~ 9.3pp (`avg@n` flash) |
| Whether the 95% CIs of plateau values overlap across models | Among the 6 leaderboard series, only DeepSWE/flash has all available-model CIs overlapping; for `avg@n`, the CI intersections for both runs are empty |

**Conclusion from the criterion**: AICc cannot distinguish these models (ΔAICc < 2), while their plateau predictions diverge enormously ——
By the principle that "if the three models' predictions differ greatly, the prediction is unreliable," **except for In-house/flash (locally), this paper does not present any leaderboard's
plateau value as a conclusion.**

### 7.5 Cross-check: does flash stopping at step 30 agree with saturation?

**Conclusion**: **The data cannot decide, and lean more toward "inconsistent."** Specifically:

- flash's last two steps are **0.6623 (step 29, the highest over the entire run) → 0.6435 (step 30)**, a drop of **1.88pp**,
  less than the single-step MDE **3.08pp** → this decline itself is **within the noise**, and cannot show that the model got worse.
- Piecewise model: plateau 0.6483, 95% CI **[0.6331, 0.6598], enclosing the last step 0.6435** → consistent with "already saturated,"
  remaining space +0.47pp (0.15 times MDE).
- Gompertz: plateau 0.7415, CI [0.6847, 0.9745], **the entire CI is above the last step** → inconsistent with "already saturated,"
  remaining 9.8pp (3.2 times MDE); it says "another 37.6 steps (CI [13.8, 116.6]) are needed to complete 90% of the observed trend."
- Logistic: plateau 0.7271, CI [0.6792, 0.8948], also above the last step → remaining 8.4pp (2.7 times MDE), with 28.9 more steps needed.

So: **of the 3 identifiable models, 1 supports "stopping was reasonable," and 2 do not.** And these two models also said
"Even by your current curve, there are still 28~38 steps to go to complete 90%."

**But I will also list the counterevidence** (this paragraph is my independent data check on this question):

1. **The final segment is indeed flattening.** Steps 23~30 have a net change of only **+0.87pp**, whereas at the overall slope (+0.48pp/step) these 8 steps
   "should" have risen 3.37pp; the difference is −2.5pp, z≈−0.66 (within noise), but the direction is consistent with "flattening." The last 5 steps have a net change of +0.55pp,
    Likewise far smaller than the +1.93pp expected from the overall slope (z=−0.48). **With data for n=8~30, one cannot tell whether "+0.87pp is the arrival of the plateau,"
    nor can one tell whether "it is a trough along the continued rise."**
2. **Adjacent leaderboards are also flattening in the same period.** In flash steps 18~25 (the window of its last submission for evaluation), DeepSWE net +0.89,
   In-house +1.01, AutomationBench +1.20, all falling near or within their respective MDEs.
3. **The question "can training 5 more steps buy more than 3pp of avg@n" cannot be answered with this dataset**, because
   the 95% CI of flash's final-segment trend slope +0.20pp/step is [−0.93, +1.36] —— it is simultaneously compatible with "still rising 1.36pp/step"
   and "falling 0.93pp/step."

**Judgment**: For `notes/07`, the conclusion that "stopping is consistent with saturation" **can only be "not ruled out" on the current data, not "supported."**
If a leaning must be given: **the piecewise model (the only one that does not require assuming a curve shape) supports it, while the two models that require assuming a curve shape do not support it**,
and the piecewise model is not worse than them on AICc (difference < 2). So my statement is:
**"There is no evidence that stopping was wrong, nor evidence that the top has been reached; read with the least assumption-dependent model, stopping at step 30 is consistent with the plateau." (inference)**

---

## 8. pro vs. flash side-by-side comparison

**Conclusion**: **By step number, pro leads; by cumulative cost, flash leads; by cumulative tokens, pro leads.** flash's advantage comes entirely from
being cheaper per token (`rate_per_s` is half of pro), not from being more effective per step.

**In plain terms**: when asking "which model is stronger," it depends on what you align on. With the same 20 training steps, pro is stronger; with the same $600,000 spent, flash is stronger;
with the same 20B tokens burned, pro is stronger. All three answers are correct, because two things are changing at the same time: flash burns more tokens per step (longer responses),
but each token is cheaper.

### 8.1 Same step number (key readings)

| Step | pro cost | flash cost | `avg@n` pro / flash | DeepSWE pro / flash | In-house pro / flash | Automation pro / flash |
|---|---|---|---|---|---|---|
| 1 | $140k | $19k | 0.5647 / 0.5137 | 58.41 / 48.67 | 57.54 / 53.83 | 46.2 / 43.3 |
| 5 | $409k | $108k | 0.5699 / 0.5473 | 59.59 / 57.23 | 58.74 / 56.41 | 47.0 / 44.2 |
| 10 | $631k | $196k | 0.5904 / 0.5693 | 63.72 / 60.18 | 61.38 / 58.23 | 47.5 / 46.5 |
| 15 | $1,082k | $301k | 0.6172 / 0.5963 | 63.42 / 60.77 | 62.26 / 58.96 | 50.7 / **51.2** |
| 18 | $1,393k | $436k | 0.6174 / 0.6023 | 67.46 / 64.01 | 63.67 / 60.92 | – / 50.4 |
| 20 | $1,539k | $490k | **0.6431** / 0.6071 | – / 63.72 | – / 61.28 | – / 50.2 |
| 24 | $1,918k | $591k | 0.5964 / **0.6155** | – / 65.78 | – / 62.28 | – / 52.3 |

Who is higher at common steps:

| Metric | Common step count | flash higher | pro higher |
|---|---|---|---|
| `dynsam/avg@n` | 24 | 2 | **22** |
| DeepSWE | 16 | 0 | **16** |
| In-house Coding | 15 | 0 | **15** |
| AutomationBench | 16 | 4 | **11** |

flash overtakes only at 6 points: `avg@n` steps 23 and 24 (step 24: 0.6155 vs 0.5964, exactly the step where pro's final segment fell back, +2.0pp),
and AutomationBench steps 7, 9, 12, and 15 (respectively +1.60 / +0.30 / +1.10 / +0.50 points).
**5 of these 6 occur near pro's own low steps or flash's own high steps** (AutomationBench step 15's 51.2
is the highest point of that entire flash sequence), so they look more like intersections of the two curves' independent fluctuations than a sustained overtake.

### 8.2 Alignment by cumulative cost

For sampling points aligned by cost (one every $0.1M), flash **leads at every common cost point**:

| Cost | `avg@n` pro / flash | DeepSWE pro / flash | In-house pro / flash | Automation pro / flash |
|---|---|---|---|---|
| $0.2M | 0.558 / 0.567 | 56.77 / 58.89 | 57.28 / 58.06 | 45.59 / 46.99 |
| $0.3M | 0.564 / 0.596 | 57.82 / 60.71 | 57.24 / 58.97 | 46.35 / **51.02** |
| $0.4M | 0.571 / 0.598 | 59.80 / 60.86 | 58.78 / 60.14 | 47.00 / 49.72 |
| $0.5M | 0.590 / 0.616 | 58.14 / 62.04 | 59.23 / 61.30 | 45.59 / 50.08 |
| $0.6M | 0.600 / 0.618 | 63.23 / 65.68 | 60.92 / 62.24 | 46.93 / 52.22 |
| $0.7M~$0.8M | pro 0.605→0.610 / flash ended | pro 64.96→65.83 / – | 61.50→61.69 / – | 48.29→48.72 / – |

Lead margin (flash − pro): `avg@n` mean **+2.80pp** (range +0.94~+4.90), DeepSWE **+2.48 points**,
In-house **+1.45 points**, AutomationBench **+3.71 points**. All positive.

### 8.3 Alignment by cumulative token (important counterexample)

| Cumulative token | `avg@n` pro / flash | DeepSWE pro / flash | In-house pro / flash | Automation pro / flash |
|---|---|---|---|---|
| 10B | 0.574 / 0.545 | 59.30 / 57.03 | 58.85 / 56.34 | 47.14 / 44.25 |
| 20B | 0.594 / 0.572 | **63.53 / 58.90** | 61.21 / 57.92 | 47.29 / 46.91 |
| 30B | 0.616 / 0.577 | **64.49 / 57.73** | 62.54 / 58.85 | 49.74 / 47.52 |
| 40B | 0.620 / 0.601 | pro ended | – | – |
| 50B | 0.625 / 0.612 | – | – | – |

**Aligned by token, pro instead leads by 4.6~6.8 points (DeepSWE).**

### 8.4 "Is flash just faster"

It's not "just faster", it's "**cheaper per token**". Three sets of facts:

1. **flash burns more tokens per step**: 81.4B total over 30 steps, pro 56.0B total over 24 steps (`perf/total_num_tokens` summed step by step,
   exactly equal to `totals.tokens_cum`). This is consistent with "flash's answers are longer" (`notes/09`: flash generation length ×2.13, pro ×1.68).
2. **flash's wall clock per step is shorter**: by step 24 pro had used 93.3 hours, by step 30 flash had used 81.8 hours.
   because `rate_per_s` is constant (pro 5.71/s, flash 2.855/s, ratio exactly 2.000), alignment by wall clock and by cost is the same thing.
3. **But token efficiency is the opposite**: at the same token count, pro scores higher, indicating that pro's sample efficiency (capability learned per token) is better;
   flash's advantage comes from "cost per billion tokens is only 30% of pro's" (the two back-inference paths of `notes/07`).

**So "flash leads pro" holds only under the "by money" framing, and what it measures is not model capability but cost-effectiveness per unit of compute.**

---

## 9. The question "Does testing while training cause overfitting": what can the data provide

**Conclusion**: what the data provides is a **signal in the opposite direction** —— the external benchmark (DeepSWE) improves **faster than** the in-house benchmark (In-house Coding),
The slope differences for both runs are −0.176/−0.177 points/step, and the 95% CIs of the paired bootstrap both exclude 0.
If "the in-house tasks are overfit" held, we should see the opposite direction. **But this cannot prove the evaluation set is clean**,
It can only show that "there are no signs of overfitting the in-house tasks on this dashboard".

**In plain terms**: plot the pass rate on the training distribution (`dynsam/avg@n`) together with the fixed test set score; the gap between them is the "gap".
If the gap grows with training, it means the online reading increasingly fails to represent true capability. Here automation's gap is indeed growing,
but the in-house benchmark's gap is instead shrinking, and DeepSWE is basically flat.

### 9.1 Change in gap over steps (gap = `avg@n`×100 − benchmark score, both in percentage points)

| Leaderboard | run | n | gap first→last | Slope (points/step) | 95% CI | Exclude 0? |
|---|---|---|---|---|---|---|
| DeepSWE | pro | 17 | −1.94 → −5.72 | −0.163 | [−0.313, +0.021] | No (tending to widen) |
| DeepSWE | flash | 23 | +2.70 → −0.82 | +0.033 | [−0.097, +0.225] | No (flat) |
| In-house | pro | 17 | −1.07 → −1.93 | +0.050 | [−0.043, +0.168] | No |
| In-house | flash | 23 | −2.46 → **+2.15** | **+0.197** | [+0.099, +0.298] | **Yes (narrowing)** |
| AutomationBench | pro | 16 | +10.27 → +13.75 | **+0.178** | [+0.023, +0.303] | **Yes (widening)** |
| AutomationBench | flash | 25 | +8.07 → +12.48 | **+0.160** | [+0.076, +0.274] | **Yes (widening)** |

- **AutomationBench's gap widens significantly on both runs (+0.16~+0.18 points/step)**. The implication is:
  the online pass rate rises 0.37~0.48pp per step, while AutomationBench rises only 0.28~0.36 points,
  the difference (+0.10~+0.16pp/step) accumulated into a 4-percentage-point rift over 6 steps.
  both explanations hold: (a) the online metric drifts with the data mix and increasingly deviates from the fixed test set;
  (b) AutomationBench saturates faster (its overall slope is indeed the lowest of the three benchmarks). **The data cannot separate the two.**
- **The In-house/flash gap is significantly narrowing**, meaning flash on its own task set is improving **more** quickly **than** the online metric.
- **The DeepSWE/pro gap tends to widen but is not significant** (−0.163, CI upper bound +0.021).

### 9.2 In-house tasks vs external tasks

On the step numbers common to both runs (16 common steps for pro, 23 for flash), we do a paired comparison:

| run | Common steps | In-house net change | In-house slope | DeepSWE net change | DeepSWE slope | Slope difference (In-house − DeepSWE) | 95% CI | Exclude 0? |
|---|---|---|---|---|---|---|---|---|
| pro | 16 | +6.13 | +0.384 | +9.05 | +0.560 | **−0.176** | [−0.355, −0.041] | **Yes** |
| flash | 23 | +8.10 | +0.328 | +16.23 | +0.506 | **−0.177** | [−0.266, −0.042] | **Yes** |

The differences between the two runs are almost exactly the same (−0.176 and −0.177), and both point in the direction of "**the external benchmark rises faster**".

**This conclusion has a rebuttal that must be stated clearly**: flash's DeepSWE starting point (48.67) is 5.16 points lower than In-house (53.83),
a lower starting point can itself rise faster (ceiling effect), while pro's two starting points are almost identical (58.41 and 57.54) yet also have the same slope difference ——
So the ceiling effect cannot fully explain it, but **this dataset cannot completely rule out the "ceiling effect"** (there is no third-party reference on a comparable scale).
Treat it as "one piece of evidence against the overfitting hypothesis", not as "proof that there is no overfitting".

### 9.3 Why this dashboard alone cannot determine contamination, and what else is needed

**What can be said**:

- The dashboard provides scores and step numbers, and **provides no information whatsoever about whether test tasks appear in the training data**.
- `train/passrate/passrate_0_ratio` (all-wrong task share) rises from 0.92% to 3.89% on pro (step 23),
  flash rises monotonically from 0.91% to 8.30% —— this is "more and more tasks in the training data can be solved correctly, and all-wrong tasks are accumulating",
  This is unrelated to contamination detection (it is about the difficulty structure within the training distribution).
- `penalty/stage_credit_group/*` has fields such as "share of suspected attempts to bypass evaluation" (`notes/09` section 6 has already analyzed),
  but the difference correlation is not significant (pro 0.263 / flash 0.318, neither passes 0.05), **not enough to support "score-gaming behavior"**.
- The previous point's "in-house tasks rise slowly, external tasks rise quickly" is **counter-evidence**, but it does not constitute exclusion.

**To determine contamination, at least these data are still needed** (the first three come from common practice in external literature):

1. **Per-question identity of the test set + a searchable index of the training corpus.** Only with these two can you do n-gram/string overlap detection,
   Near-duplicate detection (MinHash/SimHash), and canary string injection. The dashboard cannot provide them.
2. **Per-question scores rather than aggregate scores.** Currently there are only total scores (and only 3 samples), so it is impossible to get "which questions were answered correctly".
   The signature of contamination is "a few specific questions going from 0/3 to 3/3", which is averaged away in the total score.
3. **Distractors/control experiments**: the same checkpoint evaluated on a parallel question set **confirmed never to have entered training**,
   see whether the score gap between the two question sets widens with training; or perform decontamination retraining (ablation) on the training corpus.
4. **Model-internal signals**: memorization / membership inference cannot be judged only from log-prob,
   because the literature has shown that the RL stage masks such signals (see below).
5. **Grading-pipeline logs**: `env/possible_leak` (pro at step 19 had the only non-zero occurrence across the entire run),
   the harness's sandbox and network access records. These can only rule out "runtime leakage"; they cannot rule out "overlap in the data".

**External literature supports the judgment that "looking only at scores cannot reveal contamination"**:

- **Nourbakhsh et al. (GEM 2026, Outstanding Paper) systematically reviewed 55 contamination-detection studies**, and the original conclusion is
  "Across studies, no detection method is consistently reliable across contamination tiers, model-access settings,
  and training stages", and it specifically points out that "**RL/post-training contamination auditing is only beginning to mature**",
  reports performance-inflation estimates spanning 6%~40%.
  （[Are LLM Benchmarks Already Contaminated? A Systematic Review of Contamination Detection Methods](https://aclanthology.org/2026.gem-main.50/)，ACL Anthology 2026.gem-main.50）
- **Wang et al. (ICLR 2026) found that "RL hides contamination traces"**: contamination that can be detected during the SFT stage,
  "even a brief GRPO training can markedly conceal contamination signals that most detection methods rely on"，
  the mechanism is the PPO-style importance sampling and clipping objective; by the final stage, most detection methods "perform near random guesses".
  This means that **using post-training model behavior to infer whether data was contaminated is basically ineffective after RL**.
  （[On The Fragility of Benchmark Contamination Detection in Reasoning Models](https://arxiv.org/abs/2510.02386)，arXiv:2510.02386，ICLR 2026）

So the complete answer to "does training-while-evaluating cause overfitting" is:
**The strongest conclusion the dashboard can give is "no sign of overfitting to its own questions was seen (the direction is opposite, and the two runs agree)";
"Whether the evaluation set is contaminated" is a question this dashboard cannot answer in principle, and it requires the type 1~5 data above.**

---

## 10. Uncertain, overturned, and mismatched

1. **"Recent progress" does not hold.** The slopes of the last 5 evaluation points include 0 on all 6 series. The previous version
   `content/insights.json`'s `offline-eval-lag` said "progress over recent steps can only be seen from the online avg@n"—
   Now even the online main metric on pro has become a **significant decline** (last 5 steps −1.09pp/step, CI [−1.93, −0.40]). **【Overturned】**

2. **The timeliness of the insight "offline evaluation lags 4 steps" has expired.** Now pro is missing 6 steps (AutomationBench missing 8 steps), and flash is missing 5 steps.
   Moreover, the number "4 steps" itself was obtained by directly subtracting "training steps − the leaderboard's last step", and is a **nominal gap**;
   Adding the delayed reporting in section 6, the actual information gap is even larger. **【Overturned/Needs update】**

3. **"The lag is 4 steps" does not hold.** The optimal L given by the three leaderboards is 4/5/7 (pro), and flash's bootstrap distribution is flattened over 0~8.
   The data supports "a positive lag of 0~7 steps exists" and does not support a definite L. **【Uncertain】**

4. **The saturated plateau value is unidentifiable on most series.** Of the 6 leaderboard series, 5 are identifiable only by the piecewise model;
   The upper CI bound of exponential/Gompertz runs to the order of 10¹⁰⁸. **This is not a numerical bug, it is the model's own unidentifiability** (as c→0, a→∞).
   Any statement citing "what a given leaderboard's plateau is" must first ask "which model gave it, and is it identifiable". **【Uncertain】**

5. **The judgment on stopping flash is "cannot rule out", not "supports".** See 7.5: the piecewise model supports it, the two smoothing models do not.
   The reason I lean that way is "the piecewise model does not depend on curve-shape assumptions, and AICc ties with them"; this is a **judgment**, not a data conclusion. **【Inference】**

6. **The back-inferred "equivalent number of questions" can only be used as a lower bound.** On the same question set, the back-inferred values for pro and flash differ by a factor of 1.94 on DeepSWE.
   If the 3 samples per question are not independent (e.g. all three times for the same question are affected by the same environmental issue), Q will be systematically underestimated. **【Inference】**

7. **`MAD×1.4826` is larger than the ordinary standard deviation on both series** (DeepSWE/flash: 5.03 vs 3.98; In-house/flash: 0.79 vs 0.66),
   The reason is that the difference distribution is skewed/bimodal, and the median is not the center. **In this case robust estimators are instead unreliable**,
   The script will print this warning (`mad_over_sd_flag`), and the primary measure switches to residual SD. **【Methodological pitfall, handled】**

8. **Mismatches**:
   - The exponential model for AutomationBench/pro gives a plateau of 11847 points (full score 100). This is a direct manifestation of unidentifiability,
     not "the model predicts scores will rise to ten thousand points"; but **I cannot rule out from the data that "the official has a different scale for AutomationBench than 100 points"**,
     because the `format` field only writes `num2`.
   - `axis.walls` is described in `notes/09` as "the final value after redo, and it will be misaligned", but I compared point by point and found it to be
     **exactly equal** to the timestamp of the same-named step in `status.events` (pro and flash each sampled 7 points, difference 0.0 seconds).
     I found no evidence of "misalignment"; this article uses it to align wall clock. **If the statement in 09 has another basis, this point needs rechecking.**
   - `status.events` is a truncated window (pro only steps 3~24, flash only steps 8~30), so I did not use it for cumulative token,
     and instead used `perf/total_num_tokens` (the sum is exactly equal to `totals.tokens_cum`).

---

## 11. Three transferable professional concepts

### Concept 1: minimum detectable change (MDE, minimum detectable change)

- **Definition**: how large a measurement tool's own noise is determines "how large a change is worth taking seriously". If the noise of a single measurement is σ,
  The standard error of the difference between two measurements is σ√2, and under the 95% convention `MDE = 1.96·σ·√2 ≈ 2.77σ`.
  Changes smaller than the MDE, you **cannot see**—not "there is no change", but "this ruler cannot measure it".
  The two accompanying pitfalls: **you must remove the trend before estimating σ** (otherwise the trend leaks into the noise);
  **Adjacent differencing overestimates σ due to negative autocorrelation** (use residuals, not just differences).
- **How this appears in this paper's data**: DeepSWE's MDE is flash 6.43 points / pro 4.56 points, In-house is 1.68 / 1.55,
  a 3~4× difference. The largest single-step change in the entire dataset (DeepSWE/flash step 10→11 −6.05 points) is **just at the edge of the MDE**,
  and it is the maximum picked out of 115 changes, and after multiple-comparison correction it is not significant at all.
- **Transferable judgment rule**: When given any claim that "metric A dropped by X", first ask two numbers—**what is σ, and how many comparisons were made**.
  Only if `|Δ| > 2.77σ` **and** this Δ passes the multiple-comparison correction for that series is it worth writing into the conclusion.
  Measure yourself with the same yardstick: every "went up/went down" in the conclusion must be able to state its corresponding MDE.

### Concept 2: "effective sample size shrinkage" caused by autocorrelation

- **Definition**: When adjacent observations in a time series are not independent, n points carry less information than n independent points.
  Under an AR(1) structure, `n_eff = n·(1−ρ)/(1+ρ)`, where ρ is the first-order autocorrelation.
  When ρ=0.3, 20 points are worth only 10.8 points; when ρ=0.5, only 6.7 points. Without correction, significance is systematically calculated too high.
  In engineering practice, three common alternatives: Newey-West (HAC) robust standard errors, block permutation tests, or directly using n_eff to recompute degrees of freedom.
- **How this appears in this paper's data**: the residual ρ₁ of pro's three leaderboard series = 0.25~0.32, n_eff drops from 16~17 to 8.3~10.2 (52%~60% remaining).
  After recomputing with it, the trend p-value for AutomationBench/pro changes from <1e-4 to 0.0026 (still significant).
  Conversely, DeepSWE/flash's ρ₁ = −0.461 (alternating high and low), and the naive OLS test is actually **conservative**
  —so "accounting for autocorrelation" does not mean "uniformly lowering significance"; it depends on the sign of ρ.
- **Transferable judgment rule**: For any "step-by-step/daily/weekly" series, compute ρ₁ before performing a significance test.
  If `|ρ₁| > 0.2`, you must switch to n_eff or HAC; at the same time, **the same batch of conclusions must be run through three methods (n_eff / Newey-West / block permutation)**,
  Only if all three pass should you write the conclusion. This paper's trend conclusions pass all three methods; the single-step change conclusions pass none of the three.

### Concept 3: Parameter uncertainty of saturation curves and "when to stop"

- **Definition**: Fitting a "saturation plateau" to a curve that is still rising; the model makes strong shape assumptions.
  For exponential/Gompertz, as the rate parameter c→0, the plateau a→∞; **with finite-window data, it is mathematically impossible to distinguish "approaching a plateau" from "slowly rising linearly"**,
  This is called parameter unidentifiability. The criterion must hard-code a threshold (this paper uses "plateau CI width > 2× data range ⇒ unidentifiable"),
  and you must report the **disagreement in predictions between models**; you cannot report only the AICc-optimal one.
- **How this appears in this paper's data**: Of 6 leaderboard series, 5 have unidentifiable smooth models; the between-model plateau span for `avg@n`/flash is 9.3pp
  (3× its own MDE of 3.08pp). The piecewise model (the only one that does not require shape assumptions) says "already at plateau" on all 6 leaderboards,
  while the two smooth models say flash still has 8.4~9.8pp of room and needs 28~38 more steps.
  **The answer to the question "how many steps are still needed" swings between −6 steps and +38 steps.**
- **Transferable judgment rule**: When using extrapolation models to answer "how much longer to run / how much more to invest", the deliverable must simultaneously contain three things:
  (1) side-by-side plateau predictions from at least 3 models; (2) bootstrap interval widths for the parameters; (3) a reference quantity that **does not use extrapolation**
  (in this paper, it is the MDE — if the remaining room itself is smaller than the MDE, then the judgment "there is still room" is unverifiable no matter what).
  If any one of the three is missing, downgrade the conclusion to "cannot tell".

---

## 12. Terminology Quick Reference

| Term | One-sentence explanation |
|---|---|
| `avg@3` | Each task is sampled 3 times, and the average pass rate is taken; the three offline leaderboards all use this convention |
| `dynsam/avg@n` | Training-side main metric: average pass rate over n (=16) samples per task; it measures the training distribution, not a fixed test set |
| MDE | Minimum detectable change: the smallest score difference this ruler can resolve; this paper uses `2.77 × σ_pt` |
| σ_pt | Standard deviation of single-point measurement noise; this paper estimates it as the SD of trend residuals (not the SD of adjacent differences) |
| Theil–Sen slope | Robust trend estimate: the median of all pairwise slopes, insensitive to outliers |
| n_eff | Effective sample size: after accounting for autocorrelation, how many independent points n points are actually equivalent to |
| Permutation test / block permutation | A significance test that does not assume a distribution shape; the block version preserves the autocorrelation structure |
| Holm-Bonferroni | Multiple-comparison correction: when comparing k times within the same group, the most significant p must be less than 0.05/k |
| Saturation model | A fitted model that assumes the curve eventually flattens out (has a plateau); this paper uses four kinds |
| Identifiable | The parameters can be pinned down by the data. A particularly wide CI is a signal of unidentifiability |
| `piecewise_linear_plateau` | Piecewise linear-to-plateau: first rises linearly, then becomes constant after some step; does not require assuming the curve shape |
| bootstrap | Interval estimated by repeatedly resampling the parameters; this paper uses a fixed seed, so results are reproducible |
| `cost/rate_per_s` | Cost rate ($ burned per second) = the reading of machine count; pro 5.71/s, flash 2.855/s, constant throughout |
| `axis.walls` | Wall-clock time at which each step **completes**; this paper uses it for time-based alignment |
| gap | Difference between online pass rate ×100 and leaderboard score, measuring "how far the online reading is from true capability" |

---

## 13. Appendix: Reproduction and Core Numbers

```bash
# Run from the project root (the script writes the JSON itself)
bun src/bench_report.ts

# Also generates the complete single-step decision table (markdown)
bun src/bench_report.ts --emit-md analysis/zh-CN/numbers/A3-bench-judgement-table.md
```

Artifacts:

- `analysis/zh-CN/numbers/A3-bench-numbers.json` — all recomputed numbers (about 238 KB)
- `analysis/zh-CN/numbers/A3-bench-judgement-table.md` — complete decision table for the 115 single-step changes

**Core numbers at a glance**

| Number | pro | flash |
|---|---|---|
| Training steps / token / cost | 24 steps / 56.0B / $1,941,107 | 30 steps (already `ended`) / 81.4B / $854,045 |
| Cost rate | 5.71 /s（$20,556/h） | 2.855 /s（$10,278/h） |
| Wall clock (to the last observed step) | 93.3 hours | 81.8 hours |
| `avg@n` first→last (peak) | 0.5647 → 0.5964 (peak 0.6431@20) | 0.5137 → 0.6435 (peak 0.6623@29) |
| `avg@n` MDE（95%） | 4.12pp | 3.08pp |
| `avg@n` full-run slope | +0.37pp/step [+0.21, +0.44] | +0.48pp/step [+0.43, +0.55] |
| `avg@n` last 5-step slope | **−1.09pp/step [−1.93, −0.40] (significant decline)** | +0.20pp/step [−0.93, +1.36] |
| DeepSWE coverage / first→last / slope / MDE | 17 points (missing 9) 58.41→67.46 / +0.567/step / 4.56 | 23 points (missing 7,9) 48.67→64.90 / +0.506/step / 6.43 |
| In-house coverage / first→last / slope / MDE | 17 points (missing 17) 57.54→63.67 / +0.388/step / 1.55 | 23 points (missing 7,9) 53.83→61.93 / +0.328/step / 1.68 |
| AutomationBench coverage / first→last / slope / MDE | 16 points (continuous) 46.20→49.80 / +0.276/step / 2.20 | 25 points (continuous) 43.30→51.60 / +0.355/step / 2.70 |
| Total single-step changes / naive significant / after Holm | 115 / 9 / **1** | |
| Residual ρ₁ / n_eff ratio | DeepSWE 0.282 → 0.56、In-house 0.251 → 0.60、Automation 0.316 → 0.52 | DeepSWE −0.461、In-house 0.087、Automation −0.002 |
| Back-calculated equivalent question count Q | 290 / 2536 / 1325 | 150 / 2203 / 879 |
| Optimal lag L (length ↔ leaderboard score, detrended) | 4 / 5 / 7 (bootstrap frequency 84% / 88% / 67%) | 1 / 0 / 5 (frequency 32% / 35% / 38%) |
| Cross-model range of plateau values (only identifiable models) | `avg@n` 0.032; leaderboard series mostly 0 (only one identifiable) | `avg@n` **0.093**；In-house 5.54 |
| At flash stop: whether plateau CI includes the last step | — | gompertz no (difference 9.8pp), logistic no (8.4pp), piecewise yes (0.5pp) |
| Same-cost lead (flash−pro) | `avg@n` +2.80pp; DeepSWE +2.48; In-house +1.45; Automation +3.71 (all positive) | |
| Same-token lead (20B, DeepSWE) | pro 63.53 vs flash 58.90 | |
| In-house − DeepSWE slope difference | −0.176 [−0.355, −0.041] | −0.177 [−0.266, −0.042] |

**External literature comparison**

| Literature | Which claim in this paper it supports |
|---|---|
| [Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations](https://arxiv.org/abs/2411.00640)（Evan Miller，arXiv:2411.00640） | Concept 1: Analyze evaluation as an experiment, giving error bars and the variance definition for "difference between two measurements", sharing the same algorithmic origin as this paper's MDE |
| [Are LLM Benchmarks Already Contaminated? A Systematic Review of Contamination Detection Methods](https://aclanthology.org/2026.gem-main.50/) (Nourbakhsh et al., GEM 2026, Outstanding Paper) | Section 9.3: reviews 55 papers, explicitly stating "no detection method is consistently reliable across all contamination levels/access settings/training stages", and points out that contamination auditing in the RL/post-training stage "has only just begun to mature" |
| [On The Fragility of Benchmark Contamination Detection in Reasoning Models](https://arxiv.org/abs/2510.02386) (Wang et al., arXiv:2510.02386, ICLR 2026) | Section 9.3: a brief GRPO training run can substantially mask the signals that contamination detection relies on (the mechanism is PPO-style importance sampling and clipping), indicating that "inferring data contamination from post-training model behavior" largely fails after RL |
| [Statistical Methods in the Atmospheric Sciences](https://eva.fing.edu.uy/pluginfile.php/41497/mod_resource/content/1/Statistical%20Methods%20in%20the%20Atmospheric%20Sciences.pdf) (Wilks, 3rd ed.; AR(1) section) | Concept 2: standard source for `n_eff = n(1−ρ)/(1+ρ)`; this paper uses it to convert n=16~17 to 8.3~10.2 |

---

## Appendix A: complete decision table for 115 single-step changes

**deepswe / pro** (n=17, MDE=4.56, adjacent-step σ=2.01)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 58.41 → 56.25 | -2.16 | -2.73 | -1.17 | Consistent with trend/within noise | Within noise | 0.2815 | No |
| 2→3 | 56.25 → 58.41 | +2.16 | +1.59 | 0.69 | Consistent with trend/within noise | Within noise | 0.2815 | No |
| 3→4 | 58.41 → 60.47 | +2.06 | +1.49 | 0.64 | Consistent with trend/within noise | Within noise | 0.3044 | No |
| 4→5 | 60.47 → 59.59 | -0.88 | -1.45 | -0.62 | Consistent with trend/within noise | Within noise | 0.6608 | No |
| 5→6 | 59.59 → 58.55 | -1.04 | -1.61 | -0.69 | Consistent with trend/within noise | Within noise | 0.6041 | No |
| 6→7 | 58.55 → 57.44 | -1.11 | -1.68 | -0.72 | Consistent with trend/within noise | Within noise | 0.5800 | No |
| 7→8 | 57.44 → 62.24 | +4.80 | +4.23 | 1.82 | Consistent with trend/within noise | Rise | 0.0167 | No |
| 8→10 (spanning 2 steps) | 62.24 → 63.72 | +1.48 | +0.35 | 0.15 | Consistent with trend/within noise | Within noise | 0.4606 | No |
| 10→11 | 63.72 → 65.78 | +2.06 | +1.49 | 0.64 | Consistent with trend/within noise | Within noise | 0.3044 | No |
| 11→12 | 65.78 → 65.97 | +0.19 | -0.38 | -0.16 | Consistent with trend/within noise | Within noise | 0.9245 | No |
| 12→13 | 65.97 → 63.27 | -2.70 | -3.27 | -1.41 | Consistent with trend/within noise | Within noise | 0.1782 | No |
| 13→14 | 63.27 → 64.60 | +1.33 | +0.76 | 0.33 | Consistent with trend/within noise | Within noise | 0.5072 | No |
| 14→15 | 64.60 → 63.42 | -1.18 | -1.75 | -0.75 | Consistent with trend/within noise | Within noise | 0.5563 | No |
| 15→16 | 63.42 → 65.18 | +1.76 | +1.19 | 0.51 | Consistent with trend/within noise | Within noise | 0.3802 | No |
| 16→17 | 65.18 → 66.37 | +1.19 | +0.62 | 0.27 | Consistent with trend/within noise | Within noise | 0.5530 | No |
| 17→18 | 66.37 → 67.46 | +1.09 | +0.52 | 0.23 | Consistent with trend/within noise | Within noise | 0.5868 | No |

**deepswe / flash** (n=23, MDE=6.43, adjacent-step σ=3.98)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 48.67 → 53.10 | +4.43 | +3.92 | 1.20 | Consistent with trend/within noise | Within noise | 0.2653 | No |
| 2→3 | 53.10 → 56.78 | +3.68 | +3.17 | 0.97 | Consistent with trend/within noise | Within noise | 0.3548 | No |
| 3→4 | 56.78 → 54.03 | -2.75 | -3.26 | -0.99 | Consistent with trend/within noise | Within noise | 0.4893 | No |
| 4→5 | 54.03 → 57.23 | +3.20 | +2.69 | 0.82 | Consistent with trend/within noise | Within noise | 0.4211 | No |
| 5→6 | 57.23 → 54.57 | -2.66 | -3.17 | -0.97 | Consistent with trend/within noise | Within noise | 0.5036 | No |
| 6→8 (spanning 2 steps) | 54.57 → 57.08 | +2.51 | +1.50 | 0.46 | Consistent with trend/within noise | Within noise | 0.5280 | No |
| 8→10 (spanning 2 steps) | 57.08 → 60.18 | +3.10 | +2.09 | 0.64 | Consistent with trend/within noise | Within noise | 0.4357 | No |
| 10→11 | 60.18 → 54.13 | -6.05 | -6.56 | -2.00 | Below trend (beyond MDE) | Within noise | 0.1282 | No |
| 11→12 | 54.13 → 60.77 | +6.64 | +6.13 | 1.87 | Consistent with trend/within noise | Within noise | 0.0950 | No |
| 12→13 | 60.77 → 57.52 | -3.25 | -3.76 | -1.15 | Consistent with trend/within noise | Within noise | 0.4138 | No |
| 13→14 | 57.52 → 59.59 | +2.07 | +1.56 | 0.48 | Consistent with trend/within noise | Within noise | 0.6027 | No |
| 14→15 | 59.59 → 60.77 | +1.18 | +0.67 | 0.21 | Consistent with trend/within noise | Within noise | 0.7667 | No |
| 15→16 | 60.77 → 63.86 | +3.09 | +2.58 | 0.79 | Consistent with trend/within noise | Within noise | 0.4372 | No |
| 16→17 | 63.86 → 58.11 | -5.75 | -6.26 | -1.91 | Consistent with trend/within noise | Within noise | 0.1482 | No |
| 17→18 | 58.11 → 64.01 | +5.90 | +5.39 | 1.64 | Consistent with trend/within noise | Within noise | 0.1380 | No |
| 18→19 | 64.01 → 61.65 | -2.36 | -2.87 | -0.87 | Consistent with trend/within noise | Within noise | 0.5529 | No |
| 19→20 | 61.65 → 63.72 | +2.07 | +1.56 | 0.48 | Consistent with trend/within noise | Within noise | 0.6027 | No |
| 20→21 | 63.72 → 59.59 | -4.13 | -4.64 | -1.41 | Consistent with trend/within noise | Within noise | 0.2991 | No |
| 21→22 | 59.59 → 64.01 | +4.42 | +3.91 | 1.19 | Consistent with trend/within noise | Within noise | 0.2664 | No |
| 22→23 | 64.01 → 61.36 | -2.65 | -3.16 | -0.96 | Consistent with trend/within noise | Within noise | 0.5052 | No |
| 23→24 | 61.36 → 65.78 | +4.42 | +3.91 | 1.19 | Consistent with trend/within noise | Within noise | 0.2664 | No |
| 24→25 | 65.78 → 64.90 | -0.88 | -1.39 | -0.42 | Consistent with trend/within noise | Within noise | 0.8249 | No |

**inhouse-coding / pro** (n=17, MDE=1.55, adjacent-step σ=0.64)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 57.54 → 57.20 | -0.34 | -0.73 | -0.92 | Consistent with trend/within noise | Within noise | 0.5953 | No |
| 2→3 | 57.20 → 57.26 | +0.06 | -0.33 | -0.41 | Consistent with trend/within noise | Within noise | 0.9253 | No |
| 3→4 | 57.26 → 58.90 | +1.64 | +1.25 | 1.58 | Consistent with trend/within noise | Rise | 0.0104 | No |
| 4→5 | 58.90 → 58.74 | -0.16 | -0.55 | -0.69 | Consistent with trend/within noise | Within noise | 0.8026 | No |
| 5→6 | 58.74 → 59.13 | +0.39 | +0.00 | 0.00 | Consistent with trend/within noise | Within noise | 0.5423 | No |
| 6→7 | 59.13 → 59.23 | +0.10 | -0.29 | -0.36 | Consistent with trend/within noise | Within noise | 0.8758 | No |
| 7→8 | 59.23 → 59.25 | +0.02 | -0.37 | -0.46 | Consistent with trend/within noise | Within noise | 0.9751 | No |
| 8→9 | 59.25 → 60.73 | +1.48 | +1.09 | 1.38 | Consistent with trend/within noise | Rise | 0.0208 | No |
| 9→10 | 60.73 → 61.38 | +0.65 | +0.26 | 0.33 | Consistent with trend/within noise | Within noise | 0.3099 | No |
| 10→11 | 61.38 → 61.58 | +0.20 | -0.19 | -0.24 | Consistent with trend/within noise | Within noise | 0.7547 | No |
| 11→12 | 61.58 → 61.64 | +0.06 | -0.33 | -0.41 | Consistent with trend/within noise | Within noise | 0.9253 | No |
| 12→13 | 61.64 → 62.54 | +0.90 | +0.51 | 0.65 | Consistent with trend/within noise | Within noise | 0.1597 | No |
| 13→14 | 62.54 → 62.54 | 0.00 | -0.39 | -0.49 | Consistent with trend/within noise | Within noise | 1.0000 | No |
| 14→15 | 62.54 → 62.26 | -0.28 | -0.67 | -0.84 | Consistent with trend/within noise | Within noise | 0.6618 | No |
| 15→16 | 62.26 → 61.68 | -0.58 | -0.97 | -1.22 | Consistent with trend/within noise | Within noise | 0.3649 | No |
| 16→18 (spanning 2 steps) | 61.68 → 63.67 | +1.99 | +1.21 | 1.53 | Consistent with trend/within noise | Rise | 0.0019 | Yes |

**inhouse-coding / flash** (n=23, MDE=1.68, adjacent-step σ=0.66)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 53.83 → 54.69 | +0.86 | +0.53 | 0.62 | Consistent with trend/within noise | Within noise | 0.1921 | No |
| 2→3 | 54.69 → 55.02 | +0.33 | +0.00 | 0.00 | Consistent with trend/within noise | Within noise | 0.6167 | No |
| 3→4 | 55.02 → 55.34 | +0.32 | -0.01 | -0.01 | Consistent with trend/within noise | Within noise | 0.6275 | No |
| 4→5 | 55.34 → 56.41 | +1.07 | +0.74 | 0.87 | Consistent with trend/within noise | Within noise | 0.1046 | No |
| 5→6 | 56.41 → 56.50 | +0.09 | -0.24 | -0.28 | Consistent with trend/within noise | Within noise | 0.8914 | No |
| 6→8 (spanning 2 steps) | 56.50 → 57.47 | +0.97 | +0.31 | 0.37 | Consistent with trend/within noise | Within noise | 0.1413 | No |
| 8→10 (spanning 2 steps) | 57.47 → 58.23 | +0.76 | +0.10 | 0.12 | Consistent with trend/within noise | Within noise | 0.2491 | No |
| 10→11 | 58.23 → 57.45 | -0.78 | -1.11 | -1.29 | Consistent with trend/within noise | Within noise | 0.2368 | No |
| 11→12 | 57.45 → 59.22 | +1.77 | +1.44 | 1.68 | Consistent with trend/within noise | Rise | 0.0073 | No |
| 12→13 | 59.22 → 58.81 | -0.41 | -0.74 | -0.86 | Consistent with trend/within noise | Within noise | 0.5341 | No |
| 13→14 | 58.81 → 59.19 | +0.38 | +0.05 | 0.06 | Consistent with trend/within noise | Within noise | 0.5644 | No |
| 14→15 | 59.19 → 58.96 | -0.23 | -0.56 | -0.65 | Consistent with trend/within noise | Within noise | 0.7272 | No |
| 15→16 | 58.96 → 60.34 | +1.38 | +1.05 | 1.23 | Consistent with trend/within noise | Rise | 0.0364 | No |
| 16→17 | 60.34 → 59.96 | -0.38 | -0.71 | -0.83 | Consistent with trend/within noise | Within noise | 0.5644 | No |
| 17→18 | 59.96 → 60.92 | +0.96 | +0.63 | 0.74 | Consistent with trend/within noise | Within noise | 0.1454 | No |
| 18→19 | 60.92 → 61.09 | +0.17 | -0.16 | -0.18 | Consistent with trend/within noise | Within noise | 0.7965 | No |
| 19→20 | 61.09 → 61.28 | +0.19 | -0.14 | -0.16 | Consistent with trend/within noise | Within noise | 0.7732 | No |
| 20→21 | 61.28 → 61.33 | +0.05 | -0.28 | -0.33 | Consistent with trend/within noise | Within noise | 0.9396 | No |
| 21→22 | 61.33 → 61.02 | -0.31 | -0.64 | -0.75 | Consistent with trend/within noise | Within noise | 0.6383 | No |
| 22→23 | 61.02 → 61.53 | +0.51 | +0.18 | 0.21 | Consistent with trend/within noise | Within noise | 0.4393 | No |
| 23→24 | 61.53 → 62.28 | +0.75 | +0.42 | 0.49 | Consistent with trend/within noise | Within noise | 0.2554 | No |
| 24→25 | 62.28 → 61.93 | -0.35 | -0.68 | -0.79 | Consistent with trend/within noise | Within noise | 0.5956 | No |

**automation / pro** (n=16, MDE=2.20, adjacent-step σ=0.95)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 46.20 → 45.40 | -0.80 | -1.08 | -0.96 | Consistent with trend/within noise | Within noise | 0.3975 | No |
| 2→3 | 45.40 → 46.70 | +1.30 | +1.02 | 0.91 | Consistent with trend/within noise | Within noise | 0.1692 | No |
| 3→4 | 46.70 → 47.00 | +0.30 | +0.02 | 0.02 | Consistent with trend/within noise | Within noise | 0.7510 | No |
| 4→5 | 47.00 → 47.00 | 0.00 | -0.28 | -0.25 | Consistent with trend/within noise | Within noise | 1.0000 | No |
| 5→6 | 47.00 → 47.50 | +0.50 | +0.22 | 0.20 | Consistent with trend/within noise | Within noise | 0.5969 | No |
| 6→7 | 47.50 → 45.40 | -2.10 | -2.38 | -2.12 | Below trend (beyond MDE) | Fall | 0.0264 | No |
| 7→8 | 45.40 → 46.70 | +1.30 | +1.02 | 0.91 | Consistent with trend/within noise | Within noise | 0.1692 | No |
| 8→9 | 46.70 → 46.70 | 0.00 | -0.28 | -0.25 | Consistent with trend/within noise | Within noise | 1.0000 | No |
| 9→10 | 46.70 → 47.50 | +0.80 | +0.52 | 0.47 | Consistent with trend/within noise | Within noise | 0.3975 | No |
| 10→11 | 47.50 → 48.80 | +1.30 | +1.02 | 0.91 | Consistent with trend/within noise | Within noise | 0.1692 | No |
| 11→12 | 48.80 → 48.70 | -0.10 | -0.38 | -0.34 | Consistent with trend/within noise | Within noise | 0.9158 | No |
| 12→13 | 48.70 → 49.10 | +0.40 | +0.12 | 0.11 | Consistent with trend/within noise | Within noise | 0.6723 | No |
| 13→14 | 49.10 → 49.80 | +0.70 | +0.42 | 0.38 | Consistent with trend/within noise | Within noise | 0.4591 | No |
| 14→15 | 49.80 → 50.70 | +0.90 | +0.62 | 0.56 | Consistent with trend/within noise | Within noise | 0.3412 | No |
| 15→16 | 50.70 → 49.80 | -0.90 | -1.18 | -1.05 | Consistent with trend/within noise | Within noise | 0.3412 | No |

**automation / flash** (n=25, MDE=2.70, adjacent-step σ=1.39)

| Step | Score | Δ | Deviation relative to trend | z(relative trend) | Decision (relative trend) | Decision (raw Δ) | naive p | Significant after Holm |
|---|---|---|---|---|---|---|---|---|
| 1→2 | 43.30 → 43.80 | +0.50 | +0.14 | 0.11 | Consistent with trend/within noise | Within noise | 0.7193 | No |
| 2→3 | 43.80 → 45.30 | +1.50 | +1.14 | 0.83 | Consistent with trend/within noise | Within noise | 0.2810 | No |
| 3→4 | 45.30 → 45.00 | -0.30 | -0.66 | -0.48 | Consistent with trend/within noise | Within noise | 0.8293 | No |
| 4→5 | 45.00 → 44.20 | -0.80 | -1.16 | -0.84 | Consistent with trend/within noise | Within noise | 0.5653 | No |
| 5→6 | 44.20 → 44.00 | -0.20 | -0.56 | -0.40 | Consistent with trend/within noise | Within noise | 0.8857 | No |
| 6→7 | 44.00 → 47.00 | +3.00 | +2.64 | 1.92 | Consistent with trend/within noise | Rise | 0.0311 | No |
| 7→8 | 47.00 → 45.70 | -1.30 | -1.66 | -1.20 | Consistent with trend/within noise | Within noise | 0.3501 | No |
| 8→9 | 45.70 → 47.00 | +1.30 | +0.94 | 0.69 | Consistent with trend/within noise | Within noise | 0.3501 | No |
| 9→10 | 47.00 → 46.50 | -0.50 | -0.86 | -0.62 | Consistent with trend/within noise | Within noise | 0.7193 | No |
| 10→11 | 46.50 → 48.80 | +2.30 | +1.94 | 1.41 | Consistent with trend/within noise | Within noise | 0.0983 | No |
| 11→12 | 48.80 → 49.80 | +1.00 | +0.64 | 0.47 | Consistent with trend/within noise | Within noise | 0.4723 | No |
| 12→13 | 49.80 → 47.50 | -2.30 | -2.66 | -1.93 | Consistent with trend/within noise | Within noise | 0.0983 | No |
| 13→14 | 47.50 → 47.70 | +0.20 | -0.16 | -0.11 | Consistent with trend/within noise | Within noise | 0.8857 | No |
| 14→15 | 47.70 → 51.20 | +3.50 | +3.14 | 2.29 | Above trend (beyond MDE) | Rise | 0.0119 | No |
| 15→16 | 51.20 → 49.30 | -1.90 | -2.26 | -1.64 | Consistent with trend/within noise | Within noise | 0.1720 | No |
| 16→17 | 49.30 → 50.10 | +0.80 | +0.44 | 0.32 | Consistent with trend/within noise | Within noise | 0.5653 | No |
| 17→18 | 50.10 → 50.40 | +0.30 | -0.06 | -0.04 | Consistent with trend/within noise | Within noise | 0.8293 | No |
| 18→19 | 50.40 → 50.80 | +0.40 | +0.04 | 0.03 | Consistent with trend/within noise | Within noise | 0.7737 | No |
| 19→20 | 50.80 → 50.20 | -0.60 | -0.96 | -0.69 | Consistent with trend/within noise | Within noise | 0.6663 | No |
| 20→21 | 50.20 → 49.90 | -0.30 | -0.66 | -0.48 | Consistent with trend/within noise | Within noise | 0.8293 | No |
| 21→22 | 49.90 → 50.80 | +0.90 | +0.54 | 0.40 | Consistent with trend/within noise | Within noise | 0.5177 | No |
| 22→23 | 50.80 → 51.20 | +0.40 | +0.04 | 0.03 | Consistent with trend/within noise | Within noise | 0.7737 | No |
| 23→24 | 51.20 → 52.30 | +1.10 | +0.74 | 0.54 | Consistent with trend/within noise | Within noise | 0.4292 | No |
| 24→25 | 52.30 → 51.60 | -0.70 | -1.06 | -0.77 | Consistent with trend/within noise | Within noise | 0.6149 | No |
