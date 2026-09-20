# Reward signal and grading structure: is the score graded, or does the model raise it itself

> Material identity: **our own measurements**. The data comes from local telemetry `data/store/`; all numbers in this article were recomputed by script `src/reward_report.ts` from the raw JSON, and no conclusion numbers were hard-coded in the script; every number can be found by key in `analysis/zh-CN/numbers/A3-reward-numbers.json`. Parts involving external papers are marked separately as **【External literature】**.
> Data window: **pro steps 1~24, flash steps 1~30** (`axis.json`; pro's last wall clock 2026-09-19 07:52Z, flash 2026-09-19 01:04Z).
> Sample size: **only 24 / 30 points throughout**. All correlations in this article come with n and p values; level correlation, first-difference correlation, and detrended residual correlation are all given simultaneously. Any p>0.05 is always written as "not significant"; trend words are not used to describe accidental fluctuations.
> **This article does not overlap with `notes/05` (identity check), `notes/06` (definitional pitfalls), `notes/08` (generation length), `notes/09` (length correlation)**: those discuss length and definitions; this article only discusses reward signals and the grading pipeline. The only exception is the penalty-term identity in Section 7, which needs to cite the already-confirmed conclusion from `notes/05` as a comparison.

---

## 1. Summary: Six Conclusions

1. 【Our own measurements】 **The reward's "upper limit" was pinned down from the first step; what changes is the median and the lower bound, not the upper limit.** For both runs, `critic/score/max` (the highest trajectory score at this step) **equals exactly 1.000 for all 24/24 and 30/30 steps**, with only one value. Over the same period, `critic/score/mean` rises from 0.5522 to 0.5963 (pro, r=0.904, p=1.4e-9) and from 0.5167 to 0.6005 (flash, r=0.939, p=1.8e-14), respectively. Therefore, "rewards are increasingly concentrated on a few samples (max rising)" **does not hold**——max has no room to rise further; the real change is that the middle of the entire distribution shifts up. While the direction of min is **opposite** between the two runs: pro's worst trajectory improves from start to end (mean−min narrows from 1.2593 to 0.7384, but in the middle it hits bottom twice at steps 14 and 22 at −0.8), while flash's worst trajectory is worsening (mean−min widens from 1.3139 to 1.4005, r=0.523, p=0.003, and the share of steps at the −0.8 floor is 33%).

2. 【Our own measurements】 **The trainable pool is indeed shrinking, but the two runs differ by an order of magnitude; moreover, it has already eaten a large chunk of avg@n's growth rate.** Using `avg@n = p1 + M·m` decomposition (p1 = all-correct proportion, M = 1−all-wrong−all-correct = trainable pool proportion, m = average pass rate within the pool): pro's M drops from 0.6759 to 0.6545 (−0.0213), flash from 0.7188 to 0.5528 (**−0.1659**). Item-by-item decomposition of Δavg@n: pro's +0.0318 = all-correct rate contribution +0.0236 − pool shrinkage −0.0125 + within-pool improvement +0.0207; flash's +0.1298 = +0.1700 − 0.0983 + 0.0582 (residual 0). **"Pool shrinkage" is not the cause of the slowdown in growth; it is the term being subtracted; what actually holds up performance is the rise in within-pool pass rate and all-correct rate.** Additionally, pro's avg@n **peaks at 0.6431 at step 20 and then falls back** to 0.5964 at step 24; the mean of the last 11 increments is **−0.0025**, while the first half is +0.0049.

3. 【Our own measurements】 **There is no evidence that the grader side has become more lenient; instead, on several internal readings it has systematically tightened.** The grader funnel's entrance/exit are both flat: `groups_total` pro 1811 (mean) r=−0.192 (p=0.37), flash 1750 (mean) r=−0.004 (p=0.98); `groups_judged` pro 794 r=−0.094 (p=0.66). The failure rate has not risen (`select_groups_failed / groups_attempted` pro 3.5%→4.2%, r=0.109, p=0.61). Yet the grader's own **rubric absolute scores are declining**: the equal-weighted mean of the five dimensions A/B/E/P/S falls for pro from 4.4051 to 4.2902 (r=−0.874, p=2.5e-8), and for flash from 4.3919 to 4.3108 (r=−0.482, p=0.007); `select_factor_mean` (post-grading multiplier) for pro falls from 0.8319 to 0.8033 (r=−0.767, p=1.2e-5), while `select_renorm_k_mean` moves in the opposite direction, rising from 1.1852 to 1.2179 (r=0.854, p=1.1e-7).

4. 【Our own measurements】 **`select_above_gold_share` (the proportion that the grader considers "exceeds the reference solution") did not rise.** pro goes from 0.3185 to 0.3182 (r=−0.003, p=0.99, **completely flat**); flash goes from 0.3018 to 0.3261 (r=0.377, p=0.040, but first difference r=−0.341, p=0.071 not significant; detrended r=−0.058, p=0.76). That is, the premise "above_gold is rising" in this data is **wrong for pro, and for flash is only a rise too weak to stand**. At the same time, the grader probe inconsistency rate `select_probe_disagree_rate` is **at a high level of 0.59~0.61 and rising** (pro start 0.5748→end 0.6331, r=0.687, p=2.1e-4; flash start 0.5460→end 0.6018, r=0.704, p=1.4e-5)——**the reading from the external web that "the grader inconsistency rate reaches 60% and is rising" has a corresponding metric in this data, and both direction and magnitude match up**.

5. 【Our own measurements】 **The rise in the "suspected cheating attempt rate" is real, but its moving in the same direction as performance is just a common trend.** `select_hack_attempt_rate` pro 0.3833→0.4228 (r=0.706, p=1.2e-4), flash 0.3824→0.4985 (r=0.788, p=2.4e-7). **Independent recheck conclusion: first-difference correlation is not significant** (pro r=0.043, p=0.85; flash r=−0.242, p=0.21); detrended residual correlation is also not significant (pro r=0.116, p=0.59; flash r=−0.185, p=0.33). Meanwhile, the **counts** over the same period barely move (pro 4563→3830, r=0.103, p=0.63; flash 4298→4953, r=0.334, p=0.071), indicating that the rate increase mainly comes from the denominator (number of completed grader groups) rather than the numerator.

6. [Our own measurement] **Grading is not the bottleneck of full-step time, but "grading one group" itself is extremely expensive.** The full-step wall clock has only three buckets (generation / training / residual); generation + training account for **97.9% (pro)/97.2% (flash)**, and grading has no independent time bucket at all—it runs overlapped with generation. But according to the `groups_judged × time_total_sec_mean` estimate, grading consumes **4.46e5 (pro)/4.47e5 (flash) seconds** of grading machine time per step; grading one group averages **559 seconds (pro)/569 seconds (flash)**, while the full-step wall-clock budget allocated to the same batch of candidate groups is only **5.77 seconds (pro)/4.75 seconds (flash)**—**the wall clock for grading one group is 106 times (pro)/127 times (flash) the full-step allocation to each candidate group**. Amortized over the rollouts being trained, grading is **17.8 seconds/item** (both runs). Environment preparation (`time_pod_setup_sec_mean` 14.6/15.2 seconds) accounts for only **2.63% / 2.68%** of grading time.

---

## 2. Methods and Data Sources

| Item | Content |
|---|---|
| Data | `runs/{pro,flash}/series.json` (pro 1944 metrics × 24 steps; flash 1974 × 30), `axis.json`, `tags.json`, `data/store/notices.json`; refer to `content/metrics.json`'s 109 Chinese metric explainers and `content/insights.json`'s 10 existing insights |
| Recompute script | `src/reward_report.ts`, run `bun src/reward_report.ts` in the project root directory |
| Script artifacts | `analysis/zh-CN/numbers/A3-reward-numbers.json` (about 1.4 MB; contains per-sequence step-by-step raw values, statistics, trends, identity checks, derived quantities, harness and version alignment) |
| Dependencies | **Zero third-party dependencies**. Pearson / Spearman (average rank for ties) / OLS / first differences / detrended residuals / t-test p-values (using a self-implemented regularized incomplete beta function, not a normal approximation) are all implemented in the script |
| Sample size | pro n=24, flash n=30 (the effective n for each metric is given separately; pairwise deletion is used for missing data) |
| Three correlation definitions | **Level correlation** (raw value vs raw value); **first-difference correlation** (Δx vs Δy, n−1 points); **detrended residual correlation** (each side is regressed on step number by OLS, residuals taken, then correlated). When two series both change monotonically over time, level correlation is inflated, so the difference and detrended definitions are the primary evidence, and level correlation serves only as a control |
| Special case for correlation with step number | For "a metric vs step number", the first difference of step number is identically 1 (a constant), and the Pearson correlation of the differences is undefined. In this case the script sets `rDiff`/`pDiff` to `null` rather than 0, to avoid reading undefined as "uncorrelated" |
| Identity criteria | `exact` = maximum absolute difference ≤ given tolerance (mostly 0); `near` = maximum relative difference ≤ 1% or maximum absolute difference ≤ specified absolute threshold; `broken` = both exceeded; `not-comparable` = one side has no data |

### 2.3 Five definitional issues that must be clarified first

1. **The tag `penalty/signed/pos_mass_added` does not exist**. The `pos_mass_added` written in the task list has 0 values in both runs; what actually exists is `penalty/signed/pos_mass_removed` (pro has values for all 24 steps, flash only for steps 1~20). Below, `pos_mass_removed` is used throughout.
2. **`critic/rewards/*` and `critic/score/*` are the same set of numbers** (the maximum absolute difference is 0 across all three layers mean/min/max), and likewise for `critic/returns/*` and `critic/advantages/*` (mean/min are also 0). So "reward has four metrics" is an illusion; there are actually only two independent quantities: **score** and **advantage**.
3. **`critic/advantages/mean` is a quantity near 0 that is determined by construction**. Its absolute value is only **0.36%~2.8%** of the absolute value of `critic/advantages/min` (pro first 0.0036, flash last 0.0235). Using its trajectory to say "advantage is decaying" is an invalid reading; see Section 8.
4. **`train/passrate/passrate_0_ratio` and `dynsam/passrate/zero` are not the same thing**. The former rises from 0.0092 to 0.0389 for pro and from 0.0091 to 0.0830 for flash; the latter goes from 0.1462 to 0.1440 for pro and from 0.1605 to 0.1564 for flash. The two have different denominators (the former is "trajectories that entered the training batch", the latter is "the measured candidate pool"), so they cannot be converted into each other, and the former cannot be used to say "the all-wrong rate is lying flat" or "the all-wrong rate rose 4-fold" without clarifying the denominator.
5. **A set of flash tags stops reporting after the middle steps**, not becoming 0: `groups_attempted`, `end2end_success_rate`, `dev_neg_turns`, `pos_scale_clamped` all have values for **steps 1~19**, then are null; `pos_mass_removed`, `pos_scale` are **steps 1~20**. Meanwhile `pass1_success_rate`, `groups_judged`, `groups_total` have the full 30 steps. Any flash "whole-run mean" must state how many steps it is computed over.

---

## 3. Distribution shape of the reward signal

**Conclusion**: the upper bound is pinned (max≡1), the middle shifts upward continuously, and the lower bound moves in opposite directions in the two runs (pro tightens, flash expands). The overall distribution rises, rather than concentrating toward a few samples.

**Plain language**: if the scores of this batch of trajectories are sorted, the highest-scoring one is a full score of 1.0 from the first step and never changes afterward—the reward function has an upper bound (the upper bound is 1, and the lower bound of `critic/score/min` is −0.8, which neither run ever breaks through over the whole run). So "the model is getting better at gaming high scores" can only show up as an increase in the mean score. At the lower-bound end, the two runs move in opposite directions: pro's first-to-last minimum scores tighten upward (−0.71 → −0.14, but in between it hits bottom at −0.8 twice, at steps 14 and 22), while flash's minimum score keeps dropping deeper (10 of 30 steps are exactly −0.8).

### Evidence Table A: Distribution endpoints of global score and advantage (`critic/*`)

| Metric | pro first→last | pro trend (r, p) | flash first→last | flash trend (r, p) |
|---|---|---|---|---|
| `critic/score/mean` | 0.5522 → 0.5963 | r=0.904, p=1.4e-9 | 0.5167 → 0.6005 | r=0.939, p=1.8e-14 |
| `critic/score/max` | 1.000 → 1.000 | Only 1 distinct value, 24/24 steps = 1 | 1.000 → 1.000 | Only 1 distinct value, 30/30 steps = 1 |
| `critic/score/min` | −0.7071 → −0.1420 | r=−0.115, p=0.59 (not significant) | −0.7972 → −0.8000 | r=−0.432, p=0.017 |
| `score/max − score/mean` | 0.4478 → 0.4037 | r=−0.904, p=1.4e-9 | 0.4833 → 0.3995 | r=−0.939, p=1.8e-14 |
| `score/mean − score/min` | 1.2593 → 0.7384 | r=0.159, p=0.46 (not significant) | 1.3139 → 1.4005 | r=0.523, p=0.003 |
| `critic/advantages/min` | −0.9311 → −0.9307 | r=−0.328, p=0.12 | −1.2115 → −1.6658 | r=−0.521, p=0.003 |
| `critic/advantages/max` | 1.3234 → 1.1890 (11 distinct values) | r=−0.099, p=0.64 | 1.1607 → 1.1225 (13 distinct values) | r=−0.077, p=0.69 |
| Proportion of steps where score is pinned to the upper bound 1 | **100%**（24/24） | — | **100%**（30/30） | — |
| Proportion of steps where score is pinned to the lower bound −0.8 | 8.3%（2/24） | — | 33.3%（10/30） | — |
| fraction of steps for `score/min ≤ −0.5` | 37.5% | — | **80.0%** | — |
| Proportion of steps with advantage max > 1.1 | 95.8% | — | 96.7% | — |
| Proportion of steps with advantage min < −1.1 | 37.5% | — | **76.7%** | — |

**How to read**: the significant decline of `score/max − score/mean` is entirely caused by the rise in mean, not by a change in max—**this is not a signal of "declining concentration", but an arithmetic result of "capping above, mean catching up"**. What is truly informative is the last two rows: 76.7% of flash steps have a negative end with |advantage| > 1.1, while pro has only 37.5%.

### Evidence Table B: Dataset level (25 `critic/<cat>/dataset-<id>`, of which 23 have `score/mean`)

| Observation | pro | flash |
|---|---|---|
| Datasets with `score/mean` first-to-last difference > +0.005 | 16 | 17 |
| Datasets with `score/mean` first-to-last difference < −0.005 | 7 | 3 |
| change essentially flat (within ±0.005) | 0 | 3 |
| largest increase | visual/ve5o 0.838→0.916（+0.078）；general/1doa 0.481→0.628（+0.146）；visual/jzd3 0.417→0.570（+0.153） | code/yfch 0.472→0.726（+0.254）；cyber/9aui 0.407→0.590（+0.183）；code/m1dt 0.497→0.676（+0.179） |
| largest decrease | chat/lm3t 0.481→0.389（−0.092）；code/4onq 0.706→0.621（−0.085） | chat/8kb6 0.364→0.326（−0.038）；code/v7yx 0.547→0.525（−0.022） |
| Datasets whose first and last values of `score/min` are both 0 | 18/23 | 7/23 |
| There are datasets where `score/min` touches −0.8 | **3** (code/bvg7, code/yfch, cyber/9aui) | **6** (code/bvg7, code/obg8, code/v7yx, code/yfch, code/zg6q, cyber/9aui) |

**How to read**: at the dataset level `score/min` is mostly 0, indicating that "**the worst one in a group gets 0**" is the norm (for most datasets the reward lower bound is 0 rather than −0.8); −0.8 is a deep floor that only a few datasets trigger at only a few steps. **Do not use the global `score/min` to represent any single dataset**; the global min is the minimum across 23 datasets, and its jumps are almost all determined by one step of one dataset.

---

## 4. Is the sample pool shrinking?

**Conclusion**: it is shrinking, but pro barely moved (−2.1 percentage points), while flash shrank substantially (−16.6 percentage points); pool shrinkage **is already dragging down avg@n**, and it is not the cause of the growth slowdown — it is the term being subtracted.

**Plain language**: the rule of dynamic sampling is to discard "all-correct" and "all-wrong" tasks — all-correct tasks provide no gradient, and all-wrong tasks provide no useful contrast. So the stronger the model, the higher the all-correct rate, and the smaller the trainable pool. This is very clear on flash: the trainable pool share dropped from 71.9% to 55.3%, a decrease of nearly one-sixth. But scores are still rising, because the pass rate of the remaining tasks in the pool is rising at the same time, and the all-correct rate itself is also part of the score.

### Evidence table C: pool metrics (n = 24 / 30)

| Metric | pro first → last | flash first → last |
|---|---|---|
| `dynsam/passrate/zero` (all-wrong share) | 0.1462 → 0.1440 | 0.1605 → 0.1564 |
| `dynsam/passrate/one` (all-correct share) | 0.1779 → 0.2014 | 0.1208 → 0.2907 |
| **Trainable pool M = 1 − zero − one** | **0.6759 → 0.6545（−0.0213）** | **0.7188 → 0.5528（−0.1659）** |
| Average pass rate within the pool m (back-solved from `avg@n = p1 + M·m`) | 0.5723 → 0.6035 | 0.5467 → 0.6382 |
| `dynsam/avg@n` | 0.5647 → 0.5964 | 0.5137 → 0.6435 |
| `dynsam/num_measurable` | 4040 → 2790 | 3642 → 3553 |
| `dynsam/num_target` | constant 1568 | constant 1568 |
| `train/verdicts/trained` | **constant 25088** | **constant 25088** |

### Evidence table D: isolating "pool shrinkage" from avg@n growth

Decomposition: `Δavg@n = Δp1 + m̄·ΔM + M̄·Δm + 交互残差` (m̄, M̄ taken as the mean of first and last)

| Component | pro | flash | Meaning |
|---|---|---|---|
| Δp1 (direct contribution from the rise in all-correct rate) | **+0.0236** | **+0.1700** | Tasks originally correct half the time become correct every time |
| m̄·ΔM (deduction for pool shrinkage) | **−0.0125** | **−0.0983** | Fewer trainable tasks, pure drag |
| M̄·Δm (increase in in-pool pass rate) | +0.0207 | +0.0582 | The remaining tasks are done better |
| Interaction residual | 0.0000 | 0.0000 | Decomposition closes |
| **Total = Δavg@n** | **+0.0318** | **+0.1298** | — |

**"Is this the same thing as the slowdown in avg@n growth?" — no, it is not the same thing, but there is a difference in the direction of causality.**
- Pool shrinkage is a subtracted term that is **already accounted for** (−0.0125 / −0.0983); it does not make avg@n "slow down", it directly makes avg@n lower.
- The growth slowdown is another phenomenon: pro's avg@n peaked at 0.6431 at step 20 and then fell back to 0.5964 (−0.0467, −7.3%); among the 24 increments, the first 12 average +0.0049 and the last 11 average **−0.0025** (increments vs. index r=−0.305, p=0.16, **not significant**); flash's first 15 increments average +0.0054 and the last 14 average +0.0035 (r=−0.076, p=0.69, **not significant**). **Neither run has a statistically defensible "growth slowdown"**; pro's behavior looks more like "falling back after peaking" rather than "the slope getting smaller".
- The true common cause is more likely: **rising all-correct rate → pool shrinkage → fewer remaining learnable tasks → avg@n's room to rise is eaten up by itself**. On flash this is quantified as: of the +0.1700 contributed by the all-correct rate, 58% is offset by pool shrinkage (−0.0983).

### On `num_measurable` and `num_target` (one mismatch)

`dynsam/num_target` is always 1568, `train/verdicts/trained` is always 25088 = 1568 × 16 (the script checked that `trained/num_target` equals 16 at all steps, coefficient of variation 0). So each step trains a fixed **1568 tasks × 16 samples**. But `dynsam/num_measurable` (number of measurable tasks) for pro dropped from 4040 to 2790 (−31%, vs. step number r=0.007, p=0.97, **no trend**), and for flash from 3642 to 3553. Its correlation with `avg@n` is pro r=−0.079 (p=0.71), flash r=0.327 (p=0.078), **both not significant**.
**Conclusion: `num_measurable` is not the count version of the "trainable pool size", and it is not synchronized with the pool share M (M dropped by 16.6 percentage points on flash, while num_measurable barely moved). The dashboard does not give its denominator/definition, so I do not make further inferences.** This is the first place in this article explicitly marked as a "mismatch".

---

## 5. Is the grading side loosening or tightening?

**Conclusion**: **there is no loosening or tightening change on the traffic side** (entries, exits, failure rate, and end-to-end success rate are all flat); **the internal grading readings are drifting toward "tighter + more divergent"** (rubric tier absolute scores decline, post-processing multipliers decline / renormalization rises, probe inconsistency rate rises); but **the share of "exceeding the reference solution" has not risen**. So the hypothesis that "the scores are from the grader letting up" has **no supporting evidence** in this data, and at the same time there is also **no evidence** that "the model really exceeded the reference solution" — neither can be established with this data.

**Plain language**: the grading process is a funnel: candidate groups → half are directly not graded (`routed/off`) → the other half are assigned to two grading paths (`select_v4` has a reference solution, `select_v4_nogold` does not) → after grading, scores are taken. The shape of this funnel is basically unchanged over 24 steps / 30 steps. But the ruler used for grading is moving: the absolute scores of five dimensions are trending down, the factors that multiply scores down in post-processing are getting larger, and the compensatory renormalization coefficients are also getting larger. At the same time, the share of the two internal probe sets contradicting each other rose from 55% to above 60%.

### Evidence table E: grading funnel (`penalty/stage_credit_group/*`, n = 24 / 30)

| Metric | pro first → last (mean) | pro trend (r, p) | flash first → last (mean) | flash trend (r, p) |
|---|---|---|---|---|
| `groups_total` (candidate groups, funnel entry) | 2736 → 1836（1811） | r=−0.192, p=0.37 | 2625 → 1971（1750） | r=−0.004, p=0.98 |
| `routed/off` (directly not graded) | 1333 → 829（882） | r=−0.277, p=0.19 | 1180 → 969（846） | r=−0.017, p=0.93 |
| `groups_attempted` (accepted for grading) | 1223 → 938（836） | r=−0.078, p=0.72 | 1172 → 604 (804, only 19 steps) | r=−0.147, p=0.55 |
| `groups_judged` (grading finished) | 1180 → 899（794） | r=−0.094, p=0.66 | 1125 → 959（786） | r=0.053, p=0.78 |
| `select_groups_failed / groups_attempted` | 3.52% → 4.16% | r=0.109, p=0.61 | 4.01% → 3.64% | r=0.020, p=0.93 |
| `groups_judged / groups_attempted` (grading completion rate) | 96.5% → 95.8% (mean 94.98%) | r=−0.109, p=0.61 | 96.0% → 96.2% (mean 95.94%) | r=−0.078, p=0.75 |
| `groups_expired_unjudged` (expired, not graded) | whole period 0~1, mean 0.29 | r=−0.007, p=0.98 | **This tag does not exist at all on flash** | — |
| `groups_skipped_unbalanced` | constant 0 | — | constant 0 | — |
| `groups_skipped_empty_inputs` | constant 0 | — | This tag does not exist | — |
| `groups_failed_pass1` / `_pass2` | constant 0 | — | This tag does not exist | — |
| `select_groups_skipped_uniform` | 124 → 60（67.0） | r=−0.282, p=0.18 | 126 → 46（66.3） | r=−0.227, p=0.23 |
| `end2end_success_rate` | 0.9648 → 0.9584 (mean 0.9498, minimum 0.7662) | r=−0.109, p=0.61 | 0.9599 → 0.9619 (mean 0.9594, minimum 0.9417, only 19 steps) | r=−0.078, p=0.75 |
| `judge_pool_in_flight` | 55 → 104（92） | r=−0.493, p=0.014 | 145 → 53（108） | r=−0.467, p=0.009 |
| `judge_pending` | 56 → 104（92.5） | r=−0.488, p=0.016 | 147 → 55（108.8） | r=−0.466, p=0.010 |

**Answering the three questions**am:
- **Is grader group size rising or falling?** The absolute values fluctuate with sampling batches (pro 358~1393), **but all trends are not significant**; the proportion of graded groups among candidate groups in pro slightly rises from 0.4313 to 0.4897 (range 0.344~0.516), and in flash from 0.4286 to 0.4866 (range 0.366~0.500)——the fluctuation comes from sampling batch structure, not from a change in grading capacity.
- **How do failures/skips/expirations change?** **They are all flat, and most are identically zero**. `groups_expired_unjudged` is 0 or 1 throughout; `groups_failed_pass1/pass2`, `groups_skipped_unbalanced`, `groups_skipped_empty_inputs`, `judge_aux_missing_rollouts`, `keep_mass_capped`, `rollouts_masked`, `select_r2_capped*`, `dev_neg_turns`, `select_r3_gold_fails` are all identically zero for both runs (`select_adv_group_sum_abs_mean` is floating-point residue on the order of 1.3e-16, effectively zero). **There is no sign that grading is "becoming less and less able to grade".**
- **`end2end_success_rate` trend?** It is normally 0.94~0.97, with no trend throughout. pro's only low point is **0.7662 (step 14)**, which matches in timing with the previous announcement (network unreachable between the training cluster and the grading deployment; the timestamp falls after pro step 14 and before step 15)——this is a single-step infrastructure event, not a degradation in grading quality.

### Evidence table F: grading scores and "tightness/looseness" (n = 24 / 30)

| Metric | pro first → last | pro trend (r, p) | flash first → last | flash trend (r, p) |
|---|---|---|---|---|
| Equal-weighted mean of five-dimensional rubric scores (A/B/E/P/S) | 4.4051 → 4.2902 | **r=−0.874, p=2.5e-8** | 4.3919 → 4.3108 | **r=−0.482, p=0.007** |
| `select_score_E_mean` | 4.5403 → 4.3483 | r=−0.955, p=4.6e-13 | 4.5167 → 4.3836 | r=−0.628, p=2.0e-4 |
| `select_score_B_mean` | 4.4379 → 4.2661 | r=−0.927, p=7.8e-11 | 4.4481 → 4.3122 | r=−0.710, p=1.1e-5 |
| `select_score_A_mean` | 4.3091 → 4.1978 | r=−0.787, p=5.1e-6 | 4.2836 → 4.2163 | r=−0.287, p=0.12 (not significant) |
| `select_score_S_mean` | 4.1362 → 4.0606 | r=−0.640, p=7.6e-4 | 4.1038 → 4.0654 | r=−0.131, p=0.49 (not significant) |
| `select_score_P_mean` | 4.6020 → 4.5780 | r=−0.296, p=0.16 (not significant) | 4.6074 → 4.5766 | r=−0.184, p=0.33 (not significant) |
| `select_above_gold_share` | 0.3185 → 0.3182 | **r=−0.003, p=0.99 (flat)** | 0.3018 → 0.3261 | r=0.377, p=0.040 (not significant after differencing, see below) |
| `select_factor_mean` (post-processing multiplier) | 0.8319 → 0.8033 | r=−0.767, p=1.2e-5 | 0.8338 → 0.8038 | r=−0.407, p=0.026 |
| `select_renorm_k_mean` (renormalization coefficient) | 1.1852 → 1.2179 | r=0.854, p=1.1e-7 | 1.1861 → 1.2167 | r=0.304, p=0.10 (not significant) |
| `select_renorm_capped_rate` | 0.0346 → 0.0639 | r=0.574, p=0.003 | 0.0289 → 0.0704 | r=0.334, p=0.072 |
| `select_tier_share_T1` | 0.6530 → 0.5901 | r=−0.815, p=1.3e-6 | 0.6536 → 0.5846 | r=−0.405, p=0.026 |
| `select_tier_share_T2` | 0.3263 → 0.3821 | r=0.802, p=2.4e-6 | 0.3310 → 0.3936 | r=0.383, p=0.037 |

**Is the rise in `above_gold_share` because "the model truly surpasses the reference solution" or because "the grading standard loosened"?——To what extent can the data distinguish:**

1. **The premise is first half-refuted**: pro's `above_gold_share` is completely flat over 24 steps (r=−0.003, p=0.99). pro is the only run with a full 24 steps and with the cyber dataset removed from step 15 onward. So "above_gold rising" **does not hold on pro**.
2. **flash's "rise" does not withstand robustness checks**: level r=0.377 (p=0.040) just crosses the threshold, first difference r=−0.341 (p=0.071), detrended r=−0.058 (p=0.76). **Two of the three specifications are not significant, and the signs are opposite.**
3. **Absolute grading scores in the same period are tightening, not loosening**: the five-dimensional rubric score drops significantly (pro r=−0.874 / flash r=−0.482), the post-processing multiplier `select_factor_mean` drops significantly (pro r=−0.767 / flash r=−0.407), and the compensatory `select_renorm_k_mean` rises significantly. If grading were loosening, these three directions should be reversed.
4. **What can and cannot be determined**: What can be determined——**there is no evidence of "systematic loosening of grading"** (rubric score decreases and post-processing multiplier decreases both point toward tightening; failure rate, expiry rate, and end-to-end success rate are all flat). What cannot be determined——**there is also no evidence that "the model truly surpasses the reference solution"**, because `above_gold_share` is flat, and the only quantity that can independently measure "whether it surpasses" (offline evaluation) itself lags training progress by 4 steps (see `insights.json`'s `offline-eval-lag`).
5. **A piece of circumstantial evidence in the opposite direction**: the behaviors of the two paths, `select_v4` and `select_v4_nogold`, are diverging. `select_v4/select_hack_attempt_rate` rises significantly (pro r=0.820, p=9.5e-7; flash r=0.900, p=1.3e-11), while `select_v4_nogold/select_hack_attempt_rate` has no trend (pro r=−0.172, p=0.42; flash r=0.022, p=0.91). That is, **the growth in behavior judged as suspected evaluation bypass all comes from the path that "has a gold reference solution"**; the path without gold remains flat. [Inference] This is more like the model learning to "walk the boundary close to the reference answer" on problems with a reference solution, rather than the grader overall loosening.

### Proxy metrics for grader inconsistency (`disagree` / `probe` / `conflict` / `regression_flagged`)

| Metric | pro mean (first→last) | pro trend (r, p) | flash mean (first→last) | flash trend (r, p) |
|---|---|---|---|---|
| `select_probe_disagree_rate` | 0.6059（0.5748→0.6331） | **r=0.687, p=2.1e-4** | 0.5857（0.5460→0.6018） | **r=0.704, p=1.4e-5** |
| `select_rank_score_conflict` (per graded group) | 0.0144→0.0178 | r=−0.347, p=0.096 | 0.0240→0.0250 | r=−0.447, p=0.013 |
| `select_rank_invalid` (per graded group) | 0.0314→0.0278 | r=0.341, p=0.10 | 0.0276→0.0334 | r=0.187, p=0.32 |
| `select_regression_flagged` (per graded group) | 0.0568→0.0456 | r=−0.026, p=0.91 | 0.0391→0.0605 | r=−0.056, p=0.77 |
| `select_tier_mismatch` (per graded group) | 0.3576→0.3192 | r=−0.430, p=0.036 | 0.3991→0.3702 | r=−0.354, p=0.055 |
| `select_r1_masked` (per graded group) | 0.3822→0.4716 | r=0.675, p=2.9e-4 | 0.3058→0.4515 | r=0.542, p=0.002 |
| `select_r2_flagged` (per graded group) | 0.3212→0.2080 | r=−0.743, p=3.2e-5 | 0.3129→0.2200 | r=−0.706, p=1.3e-5 |
| `select_process_severe` (per graded group) | 0.0237→0.0178 | r=−0.032, p=0.88 | 0.0533→0.0188 | r=−0.545, p=0.002 |

(Most official `rate` fields for count-type metrics do not exist; the table above uses `count / groups_judged` to construct a normalized rate; in the script, both the raw count and the normalized rate are output for every count.)

**The verification result in this data for the external reading that "the grader inconsistency rate reaches 60% and is rising":**
- **A corresponding metric exists**: `penalty/stage_credit_group/select_probe_disagree_rate` (grader probe inconsistency rate).
- **The magnitude matches**: pro mean **0.6059**, flash **0.5857**, both around "60%".
- **The direction matches**: both runs rise significantly with step number (p=2.1e-4 / 1.4e-5).
- **But three caveats must be added**: (a) the dashboard does not give a definition for this label, and "disagreement" does not equal "incorrect grading"; (b) `select_r2_flagged`, `select_process_severe`, `select_tier_mismatch`—these **counts that are closer to "something actually went wrong" decline on the same timeline**——probe disagreements increase, but review red flags decrease, and the two directions are opposite; (c) an **honest warning**: `probe_disagree`'s trend with respect to step number is "a single series vs. time" (there is no object to detrend), and such trends on 24/30 points are **naturally prone to significant results**; it can only prove that "this reading is drifting", not that "grading has worsened".

**Conclusion: is the grading side tightening or loosening?** By observable measures: **there is no evidence of loosening, multiple readings point to tightening (rubric score, post-processing multiplier); at the same time, internal uncertainty in grading is rising (probe disagreement).** The two are not contradictory——"the grader gives more mutually contradictory intermediate conclusions for the same batch of samples" and "final scoring is more conservative" can hold at the same time.

### `select_hack_attempt_*` (suspected attempts to bypass evaluation)

| Metric | pro first→last (mean) | pro trend (r, p) | flash first→last (mean) | flash trend (r, p) |
|---|---|---|---|---|
| `select_hack_attempt_rate` (global rate) | 0.3833 → 0.4228（0.3937） | r=0.706, p=1.2e-4 | 0.3824 → 0.4985（0.4424） | r=0.788, p=2.4e-7 |
| `select_hack_attempt` (count) | 4563 → 3830（3205） | r=0.103, p=0.63 | 4298 → 4953（3509） | r=0.334, p=0.071 |
| count / number of graded groups | 3.87 → 4.26 | r=0.762, p=1.5e-5 | 3.82 → 5.16 | r=0.842, p=5.6e-9 |
| `select_hack_attempt_ge_min_rate` | 0.0455 → 0.0636（0.0457） | r=0.710, p=1.0e-4 | 0.0446 → 0.0881（0.0650） | r=0.943, p=6.3e-15 |
| `select_hack_attempt_turns_per_pass` | 0.7906 → 0.9171（0.7989） | r=0.713, p=9.2e-5 | 0.7643 → 1.2071（0.9800） | r=0.908, p=4.6e-12 |
| `select_hack_exposed_not_relied` (exposure-independent, count) | 71 → 102（62.8） | r=0.549, p=0.006 | 57 → 116（67.4） | r=0.594, p=5.4e-4 |
| `select_pass_new_tests_rate` | 0.7043 → 0.7323（0.7185） | r=0.558, p=0.005 | 0.6646 → 0.7586（0.7200） | r=0.682, p=3.4e-5 |

**Independently verify the point that "difference correlation is not significant" (without copying existing conclusions):**
- With `dynsam/avg@n`, the **level correlation is significant**: pro r=0.634 (p=8.8e-4), flash r=0.736 (p=3.5e-6).
- **First-difference correlation is not significant**: pro r=0.043 (p=0.85), flash r=−0.242 (p=0.21).
- **Detrended residual correlation is not significant**: pro r=0.116 (p=0.59), flash r=−0.185 (p=0.33).
- **Attribution**: `select_hack_attempt_rate` and `avg@n` both rise monotonically over time (respective correlations with step number r=0.706 / 0.788 and 0.833 / 0.970); the level correlation is basically a spurious correlation caused by a common trend. **The conclusion from the existing analysis holds after my recheck**: there is no signal after first differencing. One additional point it did not mention: **the rate increase mainly comes from the denominator**—the count itself barely moves (pro even decreases), while the number of graded groups on pro drops from 1000+ early on to around 800 later, so the rate rises naturally. Any claim that "the model is learning bad behavior" must first pass this check.

### One mismatch: the denominator of hack_attempt

`select_hack_attempt_rate`'s implied denominator = count / rate; for pro the first five steps are 11903, 8509, 11038, 6640, 7031, with **coefficient of variation 26%**. It does not match any known denominator (5~10 times any of `groups_total`, `groups_attempted`, `groups_judged`, `num_measurable`); count / number of graded groups is stable at 3.8~5.2 (not a constant). **Conclusion: the dashboard does not give the numerator/denominator definitions for this rate; this article only uses it for same-definition temporal comparisons and does not do cross-metric conversion.** This is the second place in this article explicitly marked as "mismatch". (The script has already used "global rate = v4 and nogold weighted by number of graded groups" as a composite check: pro's maximum relative difference is 0.76%, flash 1.56%, which counts as near, showing that **the global rate is not an independent measurement but a weighted combination of the two paths' rates**.)

---

## 6. Grading cost: Does "grading code is more expensive than running code" hold up

**Conclusion**: grading **is not the bottleneck of full-step time** (it runs overlapped with generation and has no independent time bucket), but **"grading one group" itself is extremely expensive**: per-group grading takes 9~11 minutes, while the full-step wall-clock budget allocated to each candidate group is only around 5 seconds, a gap of about two orders of magnitude (a factor of 106). The statement "grading code is more expensive than running code" **can be verified in this data only to the extent that "the unit cost of grading is far higher than that of the other pipeline stages in the same period", but cannot be verified with dollar pricing**—what is missing is very specific.

**In plain terms**: the total wall clock of one training step is split into two parts, "generation" and "training", which together account for 97%~98%, leaving a residual of only a little over 3 minutes. That is, grading is not on the critical path of this step; it runs asynchronously in the background. But adding up the grading workload: one step has about 800 groups to grade, each group requires on average more than 9 minutes of grading wall clock, which together is 446,000 seconds of grading machine time. The entire wall clock of this step is only 10077 seconds. **To finish this work within one step, at least 46 lanes of grading concurrency are needed (pro) / 57 lanes (flash); the observed number of in-flight grader groups is 92 / 108, about twice what is needed, so grading has slack and is not tight.**

### Evidence table G: grading time and full-step time

| Metric | pro（n=24） | flash（n=30） |
|---|---|---|
| `time_total_sec_mean` (average per-group grading wall clock) | first 655.1 → last 563.7, mean **558.95**, range 508~655 | first 524.8 → last 580.9, mean **568.95**, range 523~624 |
| `time_pass1_sec_mean` (pass 1) | mean 543.65 (accounting for 97.3%) | mean 553.27 (accounting for 97.2%) |
| `time_pod_setup_sec_mean` (environment setup) | mean 14.64, **accounting for 2.63% of grading time** (range 2.21%~2.93%) | mean 15.21, **accounting for 2.68%** (range 2.40%~3.07%) |
| `time_pass2_sec_mean` (pass 2) | **identically 0** | **identically 0** |
| `timing_s/step` (full-step wall clock) | mean 10077 seconds | mean 8118 seconds |
| `timing_s/outer_gen` (generation) | mean 5012 seconds | mean 4130 seconds |
| `timing_s/trainer_ops` (training) | mean 4854 seconds | mean 3764 seconds |
| **Generation + training as a proportion of the full step** | mean **97.85%** (minimum 97.36%) | mean **97.15%** (minimum 94.33%) |
| Full-step residual (neither generation nor training) | mean 210.8 seconds | mean 223.9 seconds |
| `groups_judged × time_total_sec_mean` (grading machine time) | mean **4.46e5 seconds/step** | mean **4.47e5 seconds/step** |
| grading machine time ÷ full-step wall clock = required number of grading concurrency lanes | mean **46.2** | mean **56.7** |
| measured `judge_pool_in_flight` (in-flight grader groups) | mean **92** | mean **108** |
| grading machine time ÷ `train/verdicts/trained` | **17.79 seconds per training trajectory** | **17.82 seconds per trajectory** |
| `timing_s/step` ÷ `groups_total` (full-step budget allocated per group) | mean **5.77 seconds** | mean **4.75 seconds** |
| per-group grading ÷ full-step budget per group | mean **105.8 times** | mean **126.6 times** |
| `select_pass_turns_mean` | 49.2 → 60.9，r=0.487, p=0.016 | 50.2 → 72.9，r=0.682, p=3.4e-5 |

### Does "grading code is more expensive than running code" hold up

**The part that holds up (our own measurements)**:
- **The unit cost of grading is high enough that it must be amortized through parallelism**: grading one group takes 559 seconds, while the full-step wall-clock budget for each candidate group is only 5.77 seconds, **a factor of 106**. That is, for the same "candidate group", the wall clock of grading it once is on the order of a hundred times the entire time reserved for it in this step. This point **quantifies the intuition that "grading is expensive"**.
- **The expense is not in environment setup**: `time_pod_setup_sec_mean` accounts for only 2.6% of grading time, so "grading is expensive" is not because starting the sandbox is slow; it is the grading logic itself running (pass 1 grading accounts for 97.3%).
- **pass 2 is not enabled at all** (`time_pass2_sec_mean` is identically 0, `judge_pass2_attempts` is identically 0, `pass2_success_rate` is identically 1.0, which is a null value), so the claim that "two-pass grading is twice as expensive" does not hold in this run.

**The part that does not hold up (what is missing)**:
1. **There is no dollar numerator**. `cost = rate_per_s × (now − run_start)` (`notes/05` confirmed) gives only total cost; the dashboard does not give the respective `rate_per_s` for the grading fleet and training fleet, so "money spent on grading vs money spent on generation+training" **cannot be settled**.
2. **Grading has no independent time bucket**. `timing_s/*` has only three keys, `step` / `outer_gen` / `trainer_ops`; grading is hidden in the overlap of `outer_gen`, and it is impossible to directly isolate from the wall clock "what percentage grading accounts for".
3. **There is no generation wall clock for a single rollout**. To compare the unit cost of "grading one vs generating one", we need "generation time per trajectory"; the dashboard only gives `ctx_response_length/mean` (about 68,000~143,000 tokens, see `notes/08`) and `dynsam/agg_turn/mean` (average rounds per step), with no per-round latency, so it cannot be converted to seconds.
4. **One alternative definition that can be calculated**: calculated as "grading machine time allocated per training trajectory", both runs are **17.8 seconds/trajectory**—this is the number closest to "grading unit cost" that this data can provide, but it is still machine time, not money.

**Conclusion**: **"grading code is more expensive than running code" can neither be confirmed nor refuted in this data**. The data supports "grading is the stage with the longest per-item time in this pipeline (9~11 minutes per group, 1/18 of this step's entire wall clock)", but does not support any dollar-level comparison. This is the third place in this article explicitly marked as "what is missing".

---

## 7. Advantage scaling and penalties: which are identities and which are real signals

**Conclusion**: `penalty/action/*` as a whole **never triggered** (3 identically 0 + 1 identically 1); `penalty/signed/*` keeps moving but the magnitude is extremely small (positive side deviates from 1 by no more than 0.31%, negative side at most 2.9%); `pre == post` is an **exact identity** (the penalty uses "proportional scaling + renormalization"; total conservation is by design). The only thing that truly qualifies as signal is **the negative-side burst in flash steps 19~24 and the final step**.

**Plain English**: The penalty module has two paths. One is called action (adds/subtracts or multiplies/divides advantage), and **it was never taken even once**. The other is called signed (splits advantage by sign, scales each side, then renormalizes back), and it keeps acting slightly: the positive side is pressed down a little, the negative side is increased a little, and after that a renormalization restores the total——so the "pre-penalty total" and the "post-penalty total" are exactly equal point by point. This is not "the penalty had no effect"; rather, **total conservation is the design objective** (`insights.json`'s `penalty-redistributes` already pointed this out, and this section quantifies it).

### Evidence Table H: penalty terms (n = 24 / 30)

| Metric | pro | flash |
|---|---|---|
| `penalty/action/adv_mul_tokens` | **identically 0** (24/24) | **identically 0** (30/30) |
| `penalty/action/adv_reduction_tokens` | **identically 0** | **identically 0** |
| `penalty/action/adv_reduction_total` | **identically 0** | **identically 0** |
| `penalty/action/adv_mul_min` | **identically 1** | **identically 1** |
| `penalty/signed/pos_scale_clamped` | **identically 0** (all 24 steps covered) | **identically 0, but reported for only 19 steps** |
| `penalty/signed/neg_scale_clamped` | **identically 0** (all 24 steps covered) | **identically 0** (all 30 steps covered) |
| `penalty/signed/pos_scale` | 1.00119 → 1.00013, range 1.00008~1.00186 | 1.00306 → 1.00026, range 1.00020~1.00306 (only 20 steps) |
| `penalty/signed/neg_scale` | 0.99692 → 0.99799, minimum 0.95579 (step 21) | 0.99561 → **0.89556** (step 30, lowest over the whole period), with 0.9923→0.9710 continuously over steps 19~24 |
| `penalty/signed/neg_mass_added` | 326,695 → 410,776; maximum 8,113,600 (step 21) | 464,698 → **28,902,700** (step 30); steps 19~24: 2.1e6~6.8e6 |
| `penalty/signed/neg_hit_tokens` | 1,020,450 → 842,280; maximum 5,626,870 | 1,343,760 → **25,829,000**; step 22: 7,837,940 |
| `penalty/signed/pos_hit_tokens` | 825,655 → 114,406（−86%，r=−0.916, p=3.3e-10） | 1,276,900 → 76,716（−94%，r=−0.807, p=7.0e-8） |

**On whether "`pos_scale_clamped` / `neg_scale_clamped` are really identically 0"**: **They are**, but **coverage differs**——`neg_scale_clamped` is fully covered and all 0 in both runs; `pos_scale_clamped` is fully covered and all 0 in pro, while in flash **only steps 1~19 have values (all 0), and steps 20~30 are null**. An existing explainer said "all 44 step values are 0", which held in the 19+25 step window at the time; under the current full window of 24+30 steps, the correct statement is "**pro 24/24 all 0 + flash first 19 steps all 0; after flash step 20 this tag is not reported**".

### List of identities (mechanical conversions, not discoveries)

The script checked each one point by point; the "verdict" and "maximum deviation" in the table below both come from `A3-reward-numbers.json`'s `identities` field.

| Relationship | Verdict | Maximum deviation | Description |
|---|---|---|---|
| `critic/score/mean` = `critic/rewards/mean` | **exact** | 0（n=24/30） | Same set of numbers |
| `critic/score/min` = `critic/rewards/min` | **exact** | 0 | Same as above |
| `critic/score/max` = `critic/rewards/max` | **exact** | 0 | Same as above |
| `critic/advantages/mean` = `critic/returns/mean` | **exact** | 0 | Same set of numbers |
| `critic/advantages/min` = `critic/returns/min` | **exact** | 0 | Same as above |
| `train/adv_pos_sum_pre_penalty` = `..._post_penalty` | **exact** | 0 | The penalty does not conserve the total; it only redistributes |
| `train/adv_neg_sum_pre_penalty` = `..._post_penalty` | **exact** | 0 | Same as above |
| `groups_total` = `routed/off` + `routed/select_v4` + `routed/select_v4_nogold` | **exact** | 0 | Routing is three-way and mutually exclusive |
| `groups_attempted` = `select_v4/groups_attempted` + `select_v4_nogold/...` | **exact** | 0 | pro 24 steps, flash first 19 steps |
| `groups_judged` = `select_v4/groups_judged` + `select_v4_nogold/...` | **exact** | 0 | — |
| `select_groups_judged` = `groups_judged` | **exact** | 0 | The two tags are the same quantity |
| `select_above_gold_share` = `select_v4/select_above_gold_share` | **exact** | 0 | above_gold **is computed only on v4 paths that have gold** |
| `select_groups_failed` = `groups_failed_select` + `groups_failed_pod` | **exact**（pro）/ not-comparable（flash） | 0（pro） | flash does not have the `groups_failed_pod` tag |
| `groups_attempted` = `groups_judged` + `select_groups_failed` | **exact** | ≤4 (rounding) | grading-completion-rate identity |
| Sum of `stage_credit_group/harness-A..D` fields = global tag of the same name | **exact** | 0 | A~D are parallel shards (see Section 9) |
| `time_total_sec_mean` = `time_pass1_sec_mean` + `time_pod_setup_sec_mean` | **near** | 4.29 seconds (0.79%) | Second pass identically 0 |
| `neg_scale` = 1 − `neg_mass_added`/`|adv_neg_sum_pre|` | **near**（pro）/ **broken**（flash） | pro 1.87e-3; flash **9.88e-3 (step 30)** | The relationship breaks down at flash's final step, see below |
| `pos_scale` = 1 + `pos_mass_removed`/`adv_pos_sum_pre` | **near** | 7.9e-6 (at most 20 points) | Highly consistent |
| `trained` / `num_target` = 16 | **exact** | Identically 16, coefficient of variation 0 | 1568 tasks × 16 samples per step |
| `adv_*_sum_pre` / token count for this step | Mainly conversion | Coefficient of variation: pro positive side 3.97% / negative side 6.18%; flash 1.91% / 10.97% | The positive side is close to a unit conversion; the negative side's 10.97% in flash shows there is still real fluctuation there |
| `select_factor_mean × select_renorm_k_mean` | Close to a constant but not 1 | pro 0.976~0.998 (mean 0.985); flash 0.971~0.995 (mean 0.981) | **Not exactly mutually inverse**; there is a systematic gap of 1.5%~1.9% |

**True signal vs mechanical identities**:
- **True signal**: `neg_scale`'s downward excursion in flash (0.996→0.896, continuously deviating over steps 19~24); the bursts of `neg_mass_added`/`neg_hit_tokens` in flash at steps 19~24 and step 30; `pos_hit_tokens`'s continuous decline in both runs (−86% / −94%).
- **Mechanical identity/unit conversion**: all `exact` items in the table above; `adv_pos_sum_pre` and token count (`adv_pos_sum_pre vs tokens` correlation r=0.986/0.994, still r=0.930/0.958 after detrending —— this is **not** a spurious correlation, but the conversion relationship "total advantage ≈ per-token advantage × token count"); the r=−0.999 between `penalty/signed/neg_scale` and `neg_mass_added` (differenced −0.999, detrended −1.000) **comes entirely from the definition formula**, not two independent metrics corroborating each other.
- **One breakdown**: at flash step 30, `neg_scale` measures **0.895555**, whereas the value inferred from `1 − neg_mass_added/|adv_neg_sum_pre|` is **0.905433**, a difference of 0.0099. Over the first 29 steps, the maximum deviation of this relationship was only on the order of 2e-4. **At the step with the largest action, this derivation relationship fails**——most likely renormalization or clipping changed the actually applied factor at extreme values. The "maximum difference 2.16e-4" given by the existing explainer using a 19/25 step window no longer holds under the full window. This is the fourth place in this article that is "inconsistent with an existing conclusion".

---

## 8. Entropy rises, advantage falls, score rises: all three hold simultaneously

**Conclusion**: All three observations hold and can all be recomputed, but **the phrase "advantage falls" itself has a problematic definition**——`critic/advantages/mean` is a near-zero quantity determined by construction, and its trajectory carries no information about "signal strength". The picture that truly holds simultaneously is: **pass rate rises → all-correct rate rises → trainable pool shrinks → the remaining training signal concentrates on the part that is "still not good enough" → the negative-advantage side is pushed deeper, and the policy continues exploring at these positions → entropy rises.**

**Plain English**: These three things are not contradictory, because they are measured with three different rulers:
- Entropy measures "how uncertain the model's output is". It rising means the model has not become more rigid.
- The **mean** of the advantage is almost identically 0 (this is how it should be after within-group baseline subtraction); its drift from −0.003 to −0.004 is decimal-place drift; the **distribution of the advantage** is the signal, and flash's negative end clearly deepens (min from −1.21 to −1.67).
- Pass rate measures "whether the problem is solved correctly." When it rises, it indicates the model is more stable on easy/medium problems.
That all three things hold simultaneously means **the model becomes more certain on simple problems (all-correct rate rises), while it continues to explore on problems it has not fully solved (entropy rises)**.

### Evidence table I: quantification of three observations

| Observation | pro | flash | Significance |
|---|---|---|---|
| `actor/entropy_loss` up | 0.3953 → 0.4437 | 0.4133 → 0.4706 | pro r=0.885, p=9.3e-9；flash r=0.948, p=1.7e-15 |
| `dynsam/avg@n` up | 0.5647 → 0.5964 (peaks at 0.6431 at step 20) | 0.5137 → 0.6435 | pro r=0.833, p=4.3e-7；flash r=0.970, p=1.2e-18 |
| `critic/advantages/mean` down | −0.003361 → −0.004433 | +0.001749 → −0.039060 | pro r=−0.298, **p=0.16 (not significant)**; flash r=−0.625, p=2.2e-4 |
| `critic/advantages/min` down | −0.9311 → −0.9307 (**unchanged**) | −1.2115 → −1.6658 | pro r=−0.328, **p=0.12**；flash r=−0.521, p=0.003 |
| `critic/advantages/max` | 1.3234 → 1.1890 | 1.1607 → 1.1225 | pro p=0.64; flash p=0.69 (both not significant) |
| `|adv/mean| / |adv/min|`(proportion of mean relative to distribution) | 0.36% → 0.48% (max 1.15%) | 0.14% → 2.35% (max 2.81%) |
| `actor/entropy_loss` vs `avg@n` level correlation | r=0.578, p=0.0031 | r=0.889, p=5.3e-11 | both significant |
| Same as above, **first difference** | r=0.127, **p=0.56 (not significant)** | r=−0.255, **p=0.18 (not significant)** | No signal after differencing |
| Same as above, **residual after removing linear trend** | r=−0.620, **p=0.0012 (significantly negative)** | r=−0.395, **p=0.031 (significantly negative)** | After removing the common trend, **the sign flips** |

**Why entropy rises, advantage falls, and performance nevertheless rises—five mechanisms, each with its evidence strength**:

1. **【Our measurement, high strength】"The advantage mean falls" is a metric-definition artifact, not signal attenuation.** The absolute value of `critic/advantages/mean` is only 0.14%~2.8% of the absolute value of `critic/advantages/min`. The within-group baseline-subtraction construction determines that the global advantage mean must be close to 0; its drift after the decimal point can be fully explained by "the negative tail deepens while the positive end is capped": `critic/advantages/max` is pinned at 1.08~1.33 (not significant in either run), while `critic/advantages/min` on flash drops from −1.21 to −1.67. **Judging "advantage is decaying" by mean is wrong; one should look at the spread of min/max.**
2. **【Our measurement + external literature, medium strength】Within-group normalization zeroes out the advantage of "all-correct/all-wrong" samples, so the trainable-pool contraction is itself a mechanism of "advantage total becoming thinner".** The all-correct rate for flash rises from 12.1% to 29.1%, and the pool shrinks by 16.6 percentage points. This and the point noted by **【External literature】Dr. GRPO** (Liu et al., *Understanding R1-Zero-Like Training: A Critical Perspective*, [arXiv:2503.20783](https://arxiv.org/abs/2503.20783)) that "GRPO's normalization term introduces optimization bias" are two sides of the same family of problems: within-group baseline/standard-deviation normalization makes "the closer a group is to all-correct/all-wrong, the weaker the signal", and dynamic sampling is precisely meant to discard these groups.
3. **【External literature + our measurement】This data lies in the regime where "entropy has not collapsed", so the mainstream "entropy collapse → performance saturation" narrative cannot be used to read it.** **【External literature】Cui et al., *The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models*, [arXiv:2505.22617](https://arxiv.org/abs/2505.22617)** gives the empirical law `R = −a·e^H + b`, i.e. "performance is traded from policy entropy"; the observed norm is **entropy decreases with training and performance rises accordingly**. **This data's entropy is rising (pro +0.0484, flash +0.0573), opposite in sign to this empirical law**—that is, this run **has not entered the entropy-collapse regime**, and `actor/entropy_loss` in this segment is not an upper-bound constraint on performance. **This is both a "local counterexample" to that paper and a hint that its empirical law describes later-stage behavior.**
4. **【External literature + our measurement】The performance rise mainly comes from "sharpening" rather than "acquiring new capabilities".** **【External literature】Yue et al., *Does Reinforcement Learning Really Incentivize Reasoning Capacity in LLMs Beyond the Base Model?*, [arXiv:2504.13837](https://arxiv.org/abs/2504.13837)** (NeurIPS 2025 Oral) use large-k pass@k to show that RLVR mainly **sharpens capabilities the base model already has**, rather than acquiring reasoning patterns the base model lacks; at small k the RL model wins, at large k the base model is higher. **Corresponding evidence in this data**: the increase in all-correct rate is far larger than the increase in average pass rate (graduation effect), and `above_gold_share` is completely flat (pro)—"turning problems solved half the time into solved every time" is consistent with "sharpening", while "exceeding the reference solution" did not occur.
5. **【External literature】Rising entropy in RLVR is something that needs to be actively managed, not simply a good thing or a bad thing.** **【External literature】DAPO** (Yu et al., *DAPO: An Open-Source LLM Reinforcement Learning System at Scale*, [arXiv:2503.14476](https://arxiv.org/abs/2503.14476)) uses clip-higher to avoid entropy collapse; its motivation is precisely that "entropy too low causes the policy to lose exploration". **In this data, entropy rises + pass rate rises; by that paper's judgment this belongs to the category of "exploration is productive"**, consistent with the reading given by the `actor/entropy_loss` entry in `content/metrics.json` ("entropy rises and success rate also rises, so exploration is productive").

**One methodological limitation that must be made clear**: `entropy vs avg@n`'s **detrended residual correlation is significantly negative in both runs** (pro −0.620, p=0.0012; flash −0.395, p=0.031). That is, **after removing the common time trend, "in the steps where entropy rises more, the pass rate tends to rise less"**. Therefore the reading that "entropy and performance go in the same direction" holds only at the level measure; **under the detrended measure it is reversed**. This is the same type of phenomenon as the pattern `notes/09` found on generation length (positive correlation at level, turning negative after differencing): **spurious correlation manufactured by a common trend**. Any statement that "entropy and performance are mutually causal" does not hold on this data.

---

## 9. Grading harness and version switching

**Conclusion**: **There is no version switch of the grader harness in this dataset.** The task premise ("`harness-<X>` has multiple codenames, which ones appear/disappear and when") is **overturned** at the data level: `penalty/stage_credit_group/harness/harness-A..D` are **four parallel grading shards**, not four versions; `harness-E..U` has only a tag name, **never any data**; `tags.json`'s `versions` is a **dashboard label-set version**, not a trainer or grader version. The only real structural change is the removal of the cyber dataset at pro step 15 (one fewer harness shard on the training side).

**Plain English**: To judge "shard or version", there is a hard test: if they are shards, at the same moment the quantities of the shards should **sum to the global value**, and the share of each shard should be roughly stable; if they are versions, at the same moment only one version should be running (or old and new versions see-saw). The data gives a very clean answer——**the `groups_attempted` of the four shards A~D add up pointwise exactly to the global, maximum absolute difference 0**, and the four shares are stable throughout (pro means 0.231 / 0.256 / 0.260 / 0.252), with none disappearing or newly appearing.

### Evidence table J: harness structure

| Check | pro | flash |
|---|---|---|
| Codenames that appeared in `stage_credit_group/harness/*` | A,B,C,D,E,F,H,I,J,K,L,M,N,O,P,Q,R,S,T,U (20) | Same |
| Those with data | **Only A, B, C, D** | **Only A, B, C, D** |
| Number of fields with data for each of A~D | 74 each (completely identical) | 72 each (completely identical) |
| Sum of `groups_attempted` for A~D = global | **exact, maximum absolute difference 0** (24/24 steps) | **exact, maximum absolute difference 0** (30/30 steps) |
| Sum of `groups_judged` for A~D = global | exact，0 | exact，0 |
| Share range of each shard (`groups_attempted`) | A 0.159~0.324 (mean 0.231), B 0.218~0.286 (0.256), C 0.233~0.298 (0.260), D 0.203~0.281 (0.252) | A 0.197~0.284（0.243）、B 0.208~0.289（0.256）、C 0.221~0.281（0.253）、D 0.211~0.273（0.248） |
| `train/harness/*` codenames | 23: A, A-pw, B, C, D, D-pw, E, F, G-pw, H, I, J, K, L, M, N, O, P, Q, R, S, T, U | The same 23 |
| Training-side shard coverage | **R has data only for steps 1~14**, the other 22 have full coverage | All 23 have full coverage |
| Per-step sum of rollouts for the 20 (non -pw) shards | Steps 1~14: 21861~21989 (20 shards); **from step 15: 21007~21098 (only 19 shards left)** | Throughout: 21347~21946 (20 shards) |

**pro's harness-R disappearance aligns with the announcement**: the timestamp 1789647611.05 of announcement `n-15ac72` ("the network between the pro training cluster and grading deployment is down… we also removed the cyber dataset from the upcoming pro run") falls after pro step 14 wall clock (1789627881.76) and before step 15 wall clock (1789657788.78), i.e. **the next step to run is step 15**. The data side matches completely: pro's `train/harness/harness-R/*` is all null after step 14, and `critic/cyber/dataset-9aui/*`, `dynsam/cyber/dataset-9aui/*`, `actor/cyber/dataset-9aui/*`, `env/cyber/dataset-9aui/active` also all end at step 14. [Inference] **harness-R corresponds to the cyber line** (one training shard ≈ one group of datasets, 20 non -pw shards correspond to the trained dataset groups).

### What is `tags.json`'s `versions`?

| Check | pro | flash |
|---|---|---|
| Version entry count | 9 | 7 |
| Version string form | `3-5513.<步号>.<x>.<y>` (e.g. `3-5513.14.7.0`, `3-5513.19.10.17`, `3-5513.24.12.23`) | `3-5513.<步号>.<x>.<y>` |
| Second segment of the version string vs the step the timestamp falls in | 14→before step 15, 15→before step 16, 17→before step 18, 19→before step 20, 22→before step 23, 23→before step 24, 24→after the last step | 20→before step 19, 21→before step 20, 22→before step 21, 26→before step 25, 27→before step 26, 28→before step 27, 32→after the last step |
| Change in `n` (total tag count) | 2019 → 2019 → 2019 → 2019 → 2019 → 2019 → **2029** → 2029 → 2029 | 2052 → 2052 → **2056** → **2062** → 2062 → 2062 → 2062 |
| Categories of newly added tags | The 2029 addition was 13 `partial/*` (e.g. `partial/visual/dataset-gtav/1/frac`) | The 2056 addition added 7 (including `penalty/stage_credit_group/groups_total`, `groups_judged_after_drop`, etc.); the 2062 addition added 15 `partial/*` |

**Conclusion**: `versions` records **the dashboard's own label-set snapshot version**; the second segment of the version string is the current step number when the snapshot occurred, `n` is the tag count at that time, and the additions are all `partial/*` and a few `stage_credit_group/*`. **It is not a model version, not a trainer version, and not a grader version.** Any reading that cites `tags.json.versions` as a "model/harness switch time" is a misreading.

### Whether there are systematic jumps at version boundaries

The script computed the same statistic for each version boundary: **"mean of 3 steps after the boundary − mean of 3 steps before the boundary"**, then used all possible cut points to construct a null distribution, giving 5%/50%/95% quantiles. Results:

| Metric | pro boundary jumps vs null distribution | flash boundary jumps vs null distribution |
|---|---|---|
| `select_probe_disagree_rate` | The jumps at boundaries 15/16/18/20 are −0.0164/−0.0119/−0.0057/+0.0041, null distribution P05=−0.0165 → **all fall within the null distribution** | The jumps at boundaries 19/20/21 are −0.0200/−0.0197/−0.0233, null distribution P05=−0.0199 → **all three boundaries are just outside P05 (weak signal)**, but 25/26/27 return to −0.0185/−0.0183/−0.0057 |
| `end2end_success_rate` | Boundary 15/16 jumps +0.0643/+0.0694, null distribution P95=+0.0682 → borderline; but this is **recovery** after 0.766 at step 14, not a boundary effect | This label has only 19 steps, no data at the boundary |
| `select_hack_attempt_rate` | Boundary 18 jump +0.0281, P95=+0.0286 → falls within the null distribution | All fall within the null distribution |
| `groups_judged`、`critic/score/mean`、`dynsam/avg@n`、`actor/entropy_loss`、`select_factor_mean`、`select_score_P_mean` | All fall within the null distribution | All fall within the null distribution |

**Conclusion: at these version boundaries, neither the grading side nor the training side has a systematic jump that holds up.** flash's `probe_disagree` shows a small downward jump at three consecutive boundaries, the only trace in this dataset that looks "version-related", but (a) the magnitude is only 0.0001~0.0034 larger than P05, (b) 3 of 6 boundaries do not fit, (c) 10 metrics × 6 boundaries were subjected to multiple comparisons. (b)(c) are enough to downgrade it to **"seen it, but not treating it as a conclusion"**. This is the fifth place in this article of "can't make sense of it/evidence too weak".

---

## 10. Uncertain, overturned, and contrary to expectations

### Overturned or contrary to expectations

1. **【Refuting the task premise】“harness-<X> is a version, and it appears/disappears”** — A~D are four parallel shards (the sum exactly equals the global, and the share is stable throughout); E~U never had data; `tags.json.versions` is a dashboard label-set version, not a model/grader version. See Section 9.
2. **【Refuting the task premise】“`above_gold_share` rises”** — pro is completely flat over 24 steps (r=−0.003, p=0.99); flash's weak rise (p=0.040) does not hold under first differencing (p=0.071) or detrending (p=0.76). See Section 5 evidence table F.
3. **【Refuting the task premise】“max lifts / rewards concentrate on a few samples”** — `critic/score/max` in both runs **is exactly equal to 1 at every step**; there is only one value, with no room to lift. See Section 3.
4. **【Inconsistent with existing explainer】`pos_scale_clamped` is not “all 44 step values are 0”** — flash only reports steps 1~19 (all 0), and from step 20 onward it is null. `neg_scale_clamped` is the one with full coverage all 0.
5. **【Inconsistent with existing explainer】`neg_scale = 1 − neg_mass_added/|adv_neg_sum_pre|` breaks under the full window** — this relationship at flash step 30 deviates by 0.0099 (the maximum deviation in the first 29 steps is only on the order of 2e-4). The existing explainer's “max difference 2.16e-4” given with a 19/25-step window does not hold under a 24/30-step window.
6. **【Inconsistent with existing explainer】the tag `pos_mass_added` does not exist** — both runs have 0 values; what actually exists is `pos_mass_removed`.
7. **【Contrary to expectation】“entropy rise and performance rise are in the same direction” flips sign under the detrended measure** — first differencing is not significant (p=0.56 / 0.18), while the linearly detrended residual is **significantly negative** (pro −0.620, p=0.0012; flash −0.395, p=0.031). See Section 8.
8. **【Contrary to expectation】pro's online pass rate peaks at step 20 and then declines** — 0.6431 → 0.5964 (−7.3%), and the mean of the last 11 increments is negative. No existing insight mentions this.
9. **【Contrary to expectation】`select_tq_adv_rows_rewritten` is not 0** — the `always-zero` entry of `content/metrics.json` classifies “the batch of `select_adv_group_sum_abs_mean` and `tq_adv_*`” as zero throughout. Checked key by key: `tq_adv_mul_tokens` / `tq_adv_neg_mass` / `tq_adv_pos_mass` / `tq_adv_rows_rewritten` / `tq_adv_set_tokens` **are indeed all 0**; `select_adv_group_sum_abs_mean` is floating-point residue of 1.25e-16~1.43e-16 (essentially 0); but **`select_tq_adv_rows_rewritten` has real nonzero data** (pro mean 12685, range 5476~21256). The two differ only by a `select_` prefix. **When citing “tq_adv_* are all 0”, the full prefix must be included.**

### Uncertain / insufficient data to judge

1. **Whether grading is going easy cannot ultimately be concluded.** We can only prove “there is no evidence of going easy” (rubric score decline, post-processing multiplier decline, steady failure rate). “The model really surpassed the reference solution” requires independent evaluation, and offline evaluation lags training progress by 4 steps. **Neither can be established.**
2. **The denominator convention for `select_hack_attempt_rate` cannot be determined.** The implied denominator coefficient of variation is 26%, and it does not match any known denominator. See Section 5's “one mismatch”.
3. **`dynsam/num_measurable` is out of sync with the trainable pool.** flash's pool share dropped 16.6 percentage points, while `num_measurable` only went from 3642 to 3553. The dashboard does not give its convention.
4. **The relationship between `num_measurable/held/carryover` and `groups_total` matches only in the first three steps** (for pro steps 1~3, `sum(num_accepted/held)` exactly equals `groups_total`; from step 4 it diverges: 2417 vs 1529), and after that it does not match. **I have not found an explanation and will not infer one.**
5. **Whether the negative-side penalty burst at flash steps 19~24 is one-off: the data recovers only by step 25, but at step 30 it bursts again to a higher level (`neg_mass_added` 2.89e7).** All we can say is that this mechanism triggers intermittently in these two runs; the dashboard does not give the trigger conditions.
6. **Whether pro's negative-side burst at steps 19~21 (`neg_scale` minimum 0.9558) and what is recorded in `notes`—“pro step 19 grad_norm spike, possible_leak nonzero for the first time”—are from the same source: this script can only confirm that these three things fall on adjacent steps; it cannot establish causality.**
7. **“Grading code is more expensive than running code” cannot be settled in dollars**, and three things are missing: the `rate_per_s` for grading/training respectively, an independent time bucket for grading, and the generation wall clock of a single rollout. See Section 6.
8. **flash's `probe_disagree` downward jump at the version boundary**: the magnitude just exceeds P05, and with multiple comparisons, it is not treated as a conclusion.

---

## 11. Four transferable professional concepts

### Concept 1: Sample pool shrinkage in dynamic sampling (trainable-pool shrinkage)

**Definition**: In RLVR with group-relative advantage, if the n samples of a prompt are **all correct** or **all wrong**, the within-group reward has no variance, and after normalization the advantages are all 0; this sample produces no gradient. Dynamic sampling therefore actively discards these two types of prompts, keeping only prompts that are “partially correct”. **The stronger the model, the higher the all-correct rate, and the smaller the trainable pool.**

**Manifestation in this paper's data**: Define `M = 1 − p0 − p1` (p0 = `dynsam/passrate/zero`, p1 = `dynsam/passrate/one`). pro's M goes from 0.6759 to 0.6545 (−2.1pp), flash from 0.7188 to 0.5528 (**−16.6pp**). Decomposing with `Δavg@n = Δp1 + m̄·ΔM + M̄·Δm`, the pool-shrinkage term is negative for both runs (−0.0125 / −0.0983), and on flash it consumed 58% of the all-correct rate contribution.

**Transferable decision rule**: When you see avg@n or pass@1 rise, **first compute M and its change**. If M is falling rapidly, then part of the “performance rise” is an **accounting effect** (the all-correct rate itself enters the numerator of the average pass rate), and “how much longer it can keep rising” depends on how much M remains. **When M approaches 0, the average pass rate will approach 1, but the training signal will be exhausted first**—at this point, what should appear on the dashboard is passrate-type metrics rising and advantage/entropy-type metrics thinning out, not gradient explosion. In this paper, pro's avg@n decline after step 20 coincides with M having dropped to 0.65; this is a candidate case for this rule (causality unproven).

### Concept 2: Measurement convention for grader disagreement rate (probe disagreement)

**Definition**: When a grading task is jointly determined by multiple decision paths (probes / multi-round review), "the proportion of inconsistent conclusions among probes" measures **the certainty of the grading itself**, not the model's accuracy. It is naturally high—because the task itself may have multiple valid solutions.

**Evidence in this paper's data**: `select_probe_disagree_rate` is at a **high level of 0.586~0.606** in both runs and rises significantly (pro r=0.687, p=2.1e-4; flash r=0.704, p=1.4e-5). On the same timeline, the three counts "closer to genuinely indicating a problem" **decline in the opposite direction**: `select_r2_flagged / groups_judged` pro 0.321→0.208 (r=−0.743), flash 0.313→0.220 (r=−0.706); `select_process_severe / groups_judged` flash 0.0533→0.0188 (r=−0.545, p=0.002). That is, **"disagreement increases" and "confirmed errors decrease" occur at the same time**.

**Transferable judgment rule**: When seeing readings like "grading inconsistency rate 60% and rising," do not directly read it as "grading has collapsed." Three-step check: (1) find the contemporaneous counts **that require manual/multi-round review to confirm** (`*_flagged`, `*_rejected`, `*_severe`), and see whether they move in the same direction; (2) if disagreement rises while confirmed errors fall, it means the grader encountered more boundary samples in the first round, but the review mechanism blocked them—this is "the task became harder," not "grading got worse"; (3) only "disagreement rate rises + confirmed error rate also rises" constitutes evidence of grading quality deterioration. **In addition, one must distinguish**: the denominator of such rates (number of graded groups) is itself shrinking, and a rising rate may be caused purely by the denominator (in this paper `select_hack_attempt_rate` is this case).

### Concept 3: The effect of advantage normalization on entropy (the within-group baseline makes the advantage mean identically zero)

**Definition**: Algorithms in the GRPO/DAPO family subtract the mean within a group (n samples of the same prompt) and divide by the standard deviation to obtain advantage. **The "subtract the mean" step makes the sum of advantages in each group identically 0**, so the global advantage mean is ideally identically 0; the "divide by the standard deviation" step amplifies advantages when within-group variance is small and compresses advantages when variance is large, thereby encoding "within-group difficulty" into the gradient scale.

**Evidence in this paper's data**: The absolute value of `critic/advantages/mean` is only **0.36%~2.81%** of the absolute value of `critic/advantages/min`; its lower bound −0.0142 (pro step 14) is completely negligible relative to the spread [−1.67, +1.33]. And `critic/advantages/max` does not change significantly in either run (p=0.64 / 0.69), while `critic/advantages/min` declines significantly in flash (p=0.003). **Therefore the correct reading of "advantage decline" is "the negative-end spread widened," not "the mean shifted down."** At the same time, entropy rises significantly in both runs (p<1e-8), consistent with the direction of "within-group standardization amplifies advantages in low-variance groups."

**Transferable judgment rule**: For any algorithm that uses a within-group baseline/standardization, **do not use the mean of advantage for trend judgment** (it is pinned near 0 by construction); look at the two ends of the distribution or the standard deviation. Conversely, **when the mean of advantage starts to significantly deviate from 0, that is the anomaly signal**—it means the baseline estimate is disconnected from the actual reward distribution (typical causes are groups being truncated, groups with different n mixed into the batch, or the reward distribution itself drifting). In this paper, the means of both runs are still within 0.03, which is normal.

### Concept 4: The "tightness/looseness" of post-grading processing must be read with recomputable measures, not with "pass rate"

**Definition**: In addition to scoring, the grading pipeline usually has a layer of post-processing (scaling by coefficients, renormalization, clipping). "Grading becoming looser/tighter" should be read from **the direction of these coefficients**, not from the final pass rate—the pass rate is simultaneously affected by model capability and post-processing and cannot be disentangled.

**Evidence in this paper's data**: `select_factor_mean` significantly declines in both runs (pro r=−0.767, p=1.2e-5; flash r=−0.407, p=0.026), `select_renorm_k_mean` significantly rises in pro (r=0.854, p=1.1e-7), and their product is stable near 0.98 (not 1; there is a 1.5%~1.9% gap); five-dimensional rubric-tier absolute scores significantly decline. **These three lines consistently point to "grading more conservative," not "grading loosening."**

**Transferable judgment rule**: To judge tightness on the grading side, look for evidence in this order: (1) **the mean of rubric tier/dimension absolute scores** (whether there is an overall downward shift); (2) **post-processing multipliers and their renormalization compensation** (whether the product is conserved, and which way each is moving); (3) **failure rate/staleness rate/end-to-end success rate** (whether throughput has changed); (4) only last look at "pass rate" or "the proportion exceeding the reference solution," and **must acknowledge that it cannot distinguish capability from grading**. In this paper, (1)(2) point to tightening, (3) is stable, so the interpretive space for (4) is compressed to "cannot prove loosening," but that is all.

---

## 12. Appendix: Core Numbers Quick Reference

Recomputation entry: `bun src/reward_report.ts` → `analysis/zh-CN/numbers/A3-reward-numbers.json`

| Metric | pro | flash | JSON path |
|---|---|---|---|
| Steps / wall-clock span (wall-clock difference from step 1 to the last step) | 24 steps / 86.51 h | 30 steps / 79.96 h | `runs.<run>.wallSpanHours` |
| `critic/score/mean` first→last | 0.5522 → 0.5963 | 0.5167 → 0.6005 | `runs.<run>.groups.globalReward["critic/score/mean"]` |
| `critic/score/max` | identically 1 (24/24) | identically 1 (30/30) | Same as above |
| `critic/score/min` first→last | −0.7071 → −0.1420 | −0.7972 → −0.8000 | Same as above |
| `critic/advantages/mean` first→last | −0.003361 → −0.004433 | +0.001749 → −0.039060 | Same as above |
| `critic/advantages/min` first→last | −0.9311 → −0.9307 | −1.2115 → −1.6658 | Same as above |
| `dynsam/avg@n` first→last | 0.5647 → 0.5964 (step 20 peaks at 0.6431) | 0.5137 → 0.6435 | `...groups.pool["dynsam/avg@n"]` |
| Trainable pool M (`1−zero−one`) | 0.6759 → 0.6545 | 0.7188 → 0.5528 | `runs.<run>.poolDecomposition` |
| Δavg@n decomposition (all-correct / pool shrinkage / within-pool) | +0.0236 / −0.0125 / +0.0207 | +0.1700 / −0.0983 / +0.0582 | `runs.<run>.poolDecomposition.decomposition` |
| `actor/entropy_loss` first→last | 0.3953 → 0.4437 | 0.4133 → 0.4706 | `...groups.policy` |
| `select_probe_disagree_rate` mean (first→last) | 0.6059（0.5748→0.6331） | 0.5857（0.5460→0.6018） | `...groups.graderQuality` |
| `select_above_gold_share` first→last | 0.3185 → 0.3182（r=−0.003） | 0.3018 → 0.3261（r=0.377, p=0.040） | `...groups.graderScore` |
| Equal-weight mean of five-dimensional rubric-tier scores, first→last | 4.4051 → 4.2902 | 4.3919 → 4.3108 | `runs.<run>.constancy.scoreRubricMean` |
| `select_factor_mean` / `select_renorm_k_mean` first→last | 0.8319→0.8033 / 1.1852→1.2179 | 0.8338→0.8038 / 1.1861→1.2167 | `...groups.graderScore` |
| `select_hack_attempt_rate` first→last | 0.3833 → 0.4228 | 0.3824 → 0.4985 | `...groups.hack` |
| Same as above, correlated with the first difference of `avg@n` | r=0.043, p=0.85 (not significant) | r=−0.242, p=0.21 (not significant) | `correlations["hack_attempt_rate vs avg@n"]` |
| `groups_judged` mean | 793.7 | 785.6 (30 steps; `groups_attempted` only has 19 steps) | `...groups.graderTraffic` |
| `end2end_success_rate` mean (lowest) | 0.9498（0.7662） | 0.9594（0.9417） | Same as above |
| Grading machine time / step | 4.46e5 seconds | 4.47e5 seconds | `runs.<run>.costModel.graderSecondsPerStep` |
| Single-group grading mean | 558.95 seconds | 568.95 seconds | `...costModel.perGroupJudgingSeconds` |
| Environment preparation share of grading time | 2.63% | 2.68% | `...costModel.podSetupShareOfJudging` |
| Grading unit cost (per training trajectory) | 17.79 seconds | 17.82 seconds | `...costModel.graderSecondsPerTrainedRollout` |
| Generation + training share of full step | 97.85% | 97.15% | `...costModel.genPlusTrainShareOfStep` |
| per-group grading ÷ full-step budget per group | 105.8 times | 126.6 times | `runs.<run>.constancy.judgingOverStepBudget` |
| `penalty/signed/neg_scale` first→last (lowest) | 0.99692→0.99799（0.95579） | 0.99561→0.89556（0.89556） | `...groups.penalty` |
| harness A~D sum = global | exact (difference 0) | exact (difference 0) | `runs.<run>.identities` |
| Training-side shard disappearance | harness-R only reaches step 14 | None | `runs.<run>.harness.train.perHarness.R` |
| `tags.json.versions` entry count / tag count change | 9 / 2019→2029 | 7 / 2052→2056→2062 | `runs.<run>.versionHistory` |

**Footnote: External references cited in this paper**
- Cui, Zhang, Chen, et al. *The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models*. arXiv:2505.22617. <https://arxiv.org/abs/2505.22617>
- Liu, Chen, Li, et al. *Understanding R1-Zero-Like Training: A Critical Perspective*. arXiv:2503.20783. <https://arxiv.org/abs/2503.20783>
- Yu, et al. *DAPO: An Open-Source LLM Reinforcement Learning System at Scale*. arXiv:2503.14476. <https://arxiv.org/abs/2503.14476>
- Yue, Chen, Lu, et al. *Does Reinforcement Learning Really Incentivize Reasoning Capacity in LLMs Beyond the Base Model?* arXiv:2504.13837（NeurIPS 2025 Oral）. <https://arxiv.org/abs/2504.13837>
