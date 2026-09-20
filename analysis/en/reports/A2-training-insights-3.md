# A2 · Training Insights Issue 3

Observation window: extends from the end of the previous issue (pro step 15 / flash step 20) to
**pro step 19 / flash step 26** (2026-09-18 11:02 UTC).

The previous two issues were conclusions from 4-hour windows. This issue's data volume has nearly doubled; its role is to **turn "looks-like" judgments into hard numbers**,
and to settle two accounts that could not be calculated clearly before. Each item below is marked as confirmed, corrected, or newly discovered.

---

## 1. Pinned down: what is rising in that KL curve is the data mix, not engine disagreement

Issue 1 raised this suspicion, and Issue 2 held it up with an isolated piece of evidence at pro step 15 (global KL exactly equal to the KL of bucket 0).
This issue, flash step 25 provides a cleaner natural experiment.

flash restarted twice in a row on 2026-09-18; after restart, sampling started completely over, so step 25 used 100% fresh data:

| Metric | step 24 | step 25 | Change |
| --- | --- | --- | --- |
| Average staleness generation count `partial/avg_staleness` | 2.1832 | 0.3198 | −85% |
| Global KL `train_infer_diff/new_infer/kl` | 0.010106 | 0.005971 | −41% |
| KL of bucket 0 | 0.003407 | 0.003549 | +4% |

As soon as the data was fresh, the global value immediately dropped by 40%, while the quantity "how much the engines really differ" barely moved.
The immediately following step 26 provided a reverse confirmation: staleness went from 0.3198 back to 0.8207, and global KL rose to 0.006266 along with it,
while the KL of bucket 0 instead fell to 0.003399. The two lines move in opposite directions—they are indeed not measuring the same thing.

The same holds at the correlation level:

- pro: corr(global KL, staleness generation count) = +0.930, corr(bucket 0 KL, staleness generation count) = −0.194
- flash: corr(global KL, staleness generation count) = +0.925, corr(bucket 0 KL, staleness generation count) = +0.197

Do one more decomposition to confirm what determines the shape: use only the real bucket mix, and substitute the average value for all bucket KLs,
and it can reconstruct 79% of pro's and 90% of flash's global curve; conversely, fixing the mix and using only the real bucket KLs gives a correlation coefficient of only 0.53 / 0.55,
with errors two to three times larger. **The shape is mainly determined by the data mix.**

KL of bucket 0 from start to end: pro 0.002193 → 0.002642 (+20%), flash 0.002872 → 0.003549 (+24%).
This is the floor for "how much the probabilities computed by two different implementations of the same policy can differ"; it is slowly ticking up but does not constitute an alert.

Incidentally, correcting a statement from Issue 2. Issue 2 said the KL of bucket 0 was "a horizontal line"; a more accurate statement is
**a slow rise of 20%**; describing it as completely flat would make people think it needs no watching, but in fact it is still worth setting a threshold (0.004 is a reasonable line).

---

## 2. Confirmed: the improvement comes from "half-capable becoming fully capable"; that 15% wall has not loosened

Issue 2 discussed whether this wall would loosen based on a fluctuation at flash step 19 (all-wrong rate dropping to 0.1356). Now, looking across 25 steps:

Decompose `avg@n` as "all-correct rate + middle pool share × middle pool average pass rate" and take differences; the three terms add up algebraically to exactly the measured increase:

| Source | pro (step 1→19) | flash (step 1→26) |
| --- | --- | --- |
| All-correct rate rises | +8.41 pp | +17.08 pp |
| Middle pool shrinks (tasks are pushed to all-correct) | −4.16 pp | −8.52 pp |
| Tasks in the middle pool improve on their own | +2.62 pp | +3.88 pp |
| Total | **+6.88 pp** | **+12.43 pp** |
| and the change in the proportion of "all 16 wrong" | −1.14 pp | −1.49 pp |

Two things are therefore established:

1. **The main mechanism is pushing tasks that are "half right" into "right every time".** The increase in all-correct rate (+8.41 / +17.08)
   is far larger than the increase in `avg@n`; the shrink of the middle pool is a negative term—tasks graduate out of that middle cell.
2. **The "all-wrong" wall has barely moved.** pro 14.62% → 13.48%, flash 16.05% → 14.56%.
   In 26 steps, flash fell below 0.14 only at step 19, and it bounced back the next step.

One accompanying methodological reminder: before comparing passrate across different steps, look at the denominator first.
`dynsam/num_measurable` jumped from 1636 to 4728 in pro, a 2.9-fold difference; at the magnitude of p≈0.15,
the single-step standard error is 0.52~0.88 percentage points, while the swing between adjacent steps is often 2~3 percentage points.
Ignoring the denominator easily mistakes sampling noise for progress.

---

## 3. New account: restarts ate one-third to one-fifth of machine time

Issue 1 found that `timing_s/step` underreported time; Issue 2 attributed it to restarts. This issue has calculated the account to the end.

| | pro | flash |
| --- | --- | --- |
| Actual wall clock | 72.18 h | 67.44 h |
| Σ `timing_s/step` | 48.43 h | 52.87 h |
| Underreported | **23.74 h（32.9%）** | **14.57 h（21.6%）** |
| Equivalent amount | **$488,074** | **$149,757** |
| Number of restarts | 9 | 4 |

The underreported time almost all immediately follows restarts. In pro, 6 restarts were directly followed by completing a new step,
These 6 waiting periods total 20.76 hours, accounting for 87.4% of its total underreported amount:

| # | Restart time (Z) | Completed after | Wait | Equivalent |
| --- | --- | --- | --- | --- |
| 1 | 09-15 12:24 | s1 | 2.29 h | $47,100 |
| 2 | 09-15 18:58 | s2 | 1.83 h | $37,564 |
| 3 | 09-16 00:02 | s3 | 3.06 h | $62,917 |
| 4 | 09-16 19:58 | s11 | 2.97 h | $61,040 |
| 5 | 09-17 09:29 | s15 | 4.73 h | $97,215 |
| 6 | 09-17 20:20 | s17 | 5.88 h | $120,897 |

The announcement corresponding to the largest segment was "network unreachable between the training cluster and the grading service".
flash's largest segment was between the two consecutive restarts on 09-18 and step 25, at 4.49 hours.

**This gap is not a drift in statistical methodology**: for steps without a restart, reported values and actual elapsed time differ by less than 10 seconds.
So "underreporting = restart" is verifiable, not guessed.

---

## 4. New finding: the penalty branch does not change the total, it changes the allocation

This issue is the first to have read through part of the 535 fields of `penalty/`.

The misleading phenomenon is: `train/adv_pos_sum_pre_penalty` and `post_penalty` at every step of the two runs
**are exactly equal** (maximum difference 0), and likewise on the negative side. In addition, the three tags under `penalty/action/` are identically 0,
`adv_mul_min` is identically 1, making it easy to conclude that "the penalty term did not run at all".

But two identity relations can be verified:

- `pos_scale ≈ 1 + pos_mass_removed / adv_pos_sum_pre_penalty`
  (residual pro 5.2e-6, flash 7.9e-6)
- `neg_scale ≈ 1 − neg_mass_added / |adv_neg_sum_pre_penalty|`
  (residual pro 6.3e-5, flash 8.2e-4)

That is, the penalty branch first removes part of the mass from the positive side and adds part to the negative side, **then rescales the total amount for that sign back to its original value**.
Total conservation is how it is constructed, not that it did not run. To see how much it moved, look at scale and mass.

In what actually happened this period, the two runs are very different:

- **flash's negative side concentrated a surge in the final segment.** `neg_mass_added` from 4.6e4~162e4 in steps 1~17
  (mean about 38e4) jumps to 206e4~683e4 in steps 18~24 (step 24 peak 683e4);
  `neg_hit_tokens` rushes to 783.8e4 at step 22; `neg_scale` probes 0.971 over the same period (step 24, deviating from 1 by 2.9%).
  Its `rewards/min` has been stuck at −0.8 since step 15.
  At step 25, because it had just restarted (all-new data), this quantity falls back to 47.7e4; but at step 26 it rises again to 81.2e4,
  the surge pattern has not ended.
- **pro does not have this pattern.** `neg_mass_added` only spiked once to 143e4 at step 14, and 3e4~33e4 at the other steps;
  `neg_scale` reaches a minimum of only 0.992.

The dashboard does not explain why this is, nor does it say whether −0.8 is the reward lower bound. But this is not background noise—
pro has 19 steps of the same observation window, and nothing similar appears.

---

## 5. New finding: half of the groups in the grading pipeline are not graded at all

Among the 227 fields under `penalty/stage_credit_group/` (pro), there is one identity relation that can be verified:

```
groups_total = routed/off + routed/select_v4 + routed/select_v4_nogold
```

Pointwise verification error is 0, holding for all steps in both runs. The proportions are:

- pro：`routed/off` 48.9%、`select_v4` 25.3%、`select_v4_nogold` 25.8%
- flash：48.3% / 26.1% / 25.6%

**Nearly half of the candidate groups are excluded before grading.** Grading (running tests, running the evaluator) is much more expensive than sampling,
This is a common compute-saving practice—but the dashboard does not say where this batch of groups goes, so one can only say "not entering grading", not "discarded".

The other two are also verified:

- `groups_attempted = select_v4/groups_attempted + select_v4_nogold/groups_attempted` (error 0)
- `groups_attempted − groups_judged ≈ select_groups_failed` (error ≤4, from rounding), grading completion rate about 95%

The state of the grading pool is "at full load but with no backlog": `judge_pending` and `judge_pool_in_flight` are almost pointwise equal
(pro mean 95 vs 94, flash 114 vs 113), indicating newly arrived groups are immediately taken, with no queueing buffer.
Average grading per group is 562 seconds (pro) / 570 seconds (flash), of which 97% is spent on the first pass,
The second pass `pass2` never ran throughout (`judge_pass2_attempts` is identically zero, while `pass2_success_rate` is identically 1.0—
the latter is "no data", not "100% success").

---

## 6. Two corrections

### `dynsam/agg_turn/mean` has no downward trend

Period 2 described it as "the round count is decreasing". Looking across 25 steps, it is **oscillating at a high level with a slight upward trend**:
pro 47.47 → 56.04 rounds (r = 0.261), flash 47.31 → 51.99 rounds (r = 0.188).
Only the latter half is decreasing (pro's latter-half slope is about −0.32 rounds/step), while start to end is still rising.
So the combination "round count decreasing + pass rate increasing" **does not exist** in this data and should not be written that way.

### flash's reward did not overtake pro

On `critic/rewards/mean`, flash's starting point 0.5167 is indeed lower than pro's 0.5522,
but in steps 1~19, which both runs have, **pro is higher at every step**, and no crossing ever occurs.
Only at flash step 24 (0.595029) is it 0.000395 higher than pro's final value (0.594634),
and immediately at step 25 (0.593547) it is lower again. So "flash overtakes at the endpoint" holds only for the single step 24 and does not constitute a trend.

Also correct a statement left over from period 1: `critic/rewards/mean` and `critic/score/mean` are pointwise equal,
but they are **not equal to** `dynsam/avg@n`—pro's maximum difference is 0.044750, flash's 0.059080, and the direction is not always consistent.
The definitions differ: the former is the "average reward of trained trajectories" (training batch), while the latter is the "average pass rate of sampled prompts" (sampling batch).

---

## 7. Newly emerged this period and worth watching

### Three system-side anomalies appear simultaneously at pro step 19

| Metric | step 19 | Reference |
| --- | --- | --- |
| `actor/grad_norm` | 0.03351 | Median of the other 18 steps is 0.005626, **6.0 times** |
| `timing_s/trainer_ops` accounts for `timing_s/step` | 62.0% | Highest across all steps; the previous highest was 52.7% at step 8 |
| `env/possible_leak` | 1 | The other 18 steps are all 0; flash is 0 throughout |

But the effect side is completely normal: at the same step, `avg@n` 0.6334 (second highest overall), `pg_loss` 0.00529,
`critic/advantages/mean` −0.00436 are all in the normal range.
Checked the same step's `entropy_loss`, `rewards/mean`, `train_infer_diff/new_infer/kl`,
`pg_tis_clipfrac`, `lr`, and they are also normal—**this spike is isolated**.

In timing, it comes right after an announcement: pro restarted at step 17 due to GPU OOM caused by expert load imbalance,
the official statement said "the training parallelism strategy was adjusted"; steps 18 and 19 were run under the new configuration.
One point cannot establish causality, but step 20 is worth watching: if it falls back, it may be a short-term cost of the change; if it continues to spike, it must be viewed as a trend.

### Policy entropy is rising, and in the same direction as the success rate

pro 0.3953 → 0.4063 (+0.0110, 8 of 18 intervals decreased), flash 0.4133 → 0.4554
(+0.0421, 9 of 25 intervals decreased). Over the same period, all-correct rate pro +8.41 pp, flash +17.08 pp.
Correlation between entropy and `avg@n`: pro 0.827, flash 0.861.

This is not the usual entropy collapse. But the dashboard does not say whether there is a target entropy or entropy regularization,
so one can only say "exploration is broadening and the success rate is also rising"; one cannot judge whether it is good or bad.
What really warrants caution is "entropy keeps rising while the success rate no longer follows"—that is what turns into money-wasting exploration.

---

## 8. What still cannot be determined

- The reason `actor/ppo_kl` and `actor/pg_clipfrac` are identically zero. Hard-verified tag by tag:
  The two families each have 25 tags (including those split by category and by dataset), with 475 values per family for pro and 625 values per family for flash,
  all are the number 0 rather than null values. A clip fraction that is identically zero cannot be used to determine whether clipping occurred.
- Why `penalty/signed/*` surges in the final segment of flash. The dashboard does not explain.
- `partial/<k>/n_tokens`'s definition: the sum of the buckets is only 44%~56% of `perf/total_num_tokens`;
  while the two sets of slices "split by category" and "split by dataset" each sum to close to the full amount, and the two sets together exceed 1.6 times—
  indicating they are not the two halves of the same partition, and the denominator is unknown.
- Why `num_measurable` is persistently greater than the constant `num_target` (1568), with the ratio fluctuating between 1.04~3.02.
  The official documentation mentions `dynsam/<source>/num_measurable` under each data source, but this layer is not present in the repository.
- `select_hack_attempt_rate` is between 0.32~0.55 and both runs trend upward throughout.
  Whether "attempt" actually counts as "triggering a check" or "confirming cheating" determines whether it is good news or bad news. The dashboard doesn't say.
- Why that `penalty/action/*` pathway was never triggered throughout (three tags identically 0, `adv_mul_min` identically 1).
- `env/possible_leak`'s decision condition.
- Are `judge_pending` and `judge_pool_in_flight` in a containment or parallel relationship.
- That 2,236,430-token trajectory at flash step 14 (pro's upper limit is about 1,048,570).

---

## Appendix: Data provenance for this issue

- Data warehouse: `data/store/` (20 sync points, pro 19 steps / flash 25 steps)
- Health check report: `bun src/analyze.ts`
- Identity self-check: `bun src/check.ts` (all 22 items pass)
- Metric-by-metric explainer and data insights: `content/`
  (After starting the service with `bun run mimo:telemetry`, click "Explainer" in the top right, or view directly in any chart detail box)
