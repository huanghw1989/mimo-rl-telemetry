# mimo-v2.6 RL training insights (issue 2)

Data cutoff: 2026-09-17 15:11 UTC (23:11 Beijing time).
This is a follow-up analysis after 4 hours 21 minutes of continuous dashboard monitoring (14 collection rounds).
Issue 1 was written at pro step 14 / flash step 18; this issue's data goes up to pro step 15 / flash step 20.

In addition to supplementing new phenomena, this issue did one more thing: it rechecked every judgment made in issue 1 against new data,
explicitly listing **which were confirmed and which were overturned or revised**.

---

## Abstract

1. **Most important finding**: the curve on the homepage for "trainer vs. inference engine divergence" tripled, but it is actually an artifact of weighted averaging.
   Breaking it down into the 8 buckets split by data freshness, **the divergence on fresh data barely moved**.
   During monitoring we also got a natural experiment—pro step 15 became entirely fresh data due to a restart,
   For this step, the global value and the fresh-data value are exactly equal (0.00258 vs. 0.00258), nailing down this conclusion.
2. **One prediction from issue 1 was overturned**: flash's all-wrong rate at step 19 dropped to 0.1356, briefly making it look like the "15% wall" had loosened.
   But at step 20 it bounced back to 0.1576, and the pass rate also fell from 0.6262 back to 0.6071. **That was a fluctuation, not a trend.**
3. **pro completed step 15, with a real elapsed time of 8 hours 18 minutes**, three times its usual single step (2.3~2.9 hours),
   with two restarts in between. And found a structural fact: **the `timing_s/step` on the dashboard and the "time spent on this step" on the card
   both deduct the restart period**. pro therefore underreported by 16.8 hours (32% of the real wall clock),
   equivalent to USD 344,000. For steps without restarts, the reported value and the real value differ by within 10 seconds; for those with restarts, they differ by several hours.
4. **flash's training time exceeded generation time for two consecutive steps**, step 19 at 4889 seconds and step 20 at 4954 seconds.
   Issue 1's slope-based extrapolation that "training will become the bottleneck" has fully come true on flash.
   11 of the 20 steps had training taking longer than generation.
5. **Average context length continues to set records**: flash reached 129k tokens, while pro fell back to 91k due to restarts.
6. **The divergence between reward and pass rate is widening**: pro's "reward increase ÷ pass-rate increase" fell from 0.70 to 0.57,
   flash fell from 0.68 to 0.58. This is a newly emerging signal in this issue that is worth continuing to track.

---

## 1. What actually happened during these 4 hours 21 minutes

Listed in Beijing time:

| Time | event |
| --- | --- |
| 18:50 | Monitoring started. pro was at step 14, flash at step 18 |
| 19:10 | pro completed sampling for step 15 and entered the training phase |
| 19:21 | **pro restarted** (7th time cumulatively). Step 15 sampling progress was knocked back from 64% to 6% |
| 19:30-19:50 | pro resampled step 15: accepted problems 48 → 872, pass rate 0.384 → 0.523 |
| 20:10 | flash completed step 19 (avg@n 0.6262) and entered step 20 |
| 20:50 | pro's step 15 sampling reached full quota and entered the training phase |
| 22:59 | flash completed step 20, avg@n fell back to 0.6071 |
| 23:09 | pro completed step 15, real elapsed time 8 hours 18 minutes |
| 23:11 | Monitoring ended. pro entered a new step, flash entered step 21 |

Two points are worth noting.

**First, the cost of a restart can be quantified.** pro's restart (11:21 UTC) knocked sampling progress back from 64% to 6%,
What was lost was about 2600 problems that had already been sampled and graded.
From the sampling logs, the recovery speed can be seen to be about 20 problems per minute; going from zero to full quota takes close to 2 hours.
At 5.71 USD per second, the direct machine time loss from this restart is around USD 40,000,
not counting re-warming the sandbox and the fact that all those half-finished long trajectories were invalidated.

One detail can be read from the data: after the restart, pro's number of warmed sandboxes jumped from 286 to 512.
This indicates a restart is not just "starting sampling over"; it also requires rebuilding the entire environment pool, and during this time compute is half idle.

**Second, the dashboard's "time spent on this step" underestimates steps that have restarted.** See section 4 for details.

---

## 2. Review of judgments from issue 1

| Issue 1's judgment | This issue's conclusion |
| --- | --- |
| Both training runs are steadily improving | **Partially revised**. pro's trend over 15 steps still holds (about +0.005 per step), but flash fell back at step 20, and single-step fluctuation is clearly larger than the trend |
| Bottleneck shifted from generation to training | **Confirmed for flash, not yet for pro**. flash's last two steps both had training time exceeding generation; only 4 of pro's 15 steps were like this |
| Capability growth mainly comes from "partially capable becoming fully capable" | **Confirmed**. The growth structure on both sides has not changed; see section 5 |
| The 15% all-wrong rate is a wall | **Revised**. flash's step 19 briefly dropped to 0.1356, but step 20 bounced back to 0.1576. **Fluctuation, not trend** |
| Context length is a cost driver | **Further confirmed**. flash reached 129k tokens, still a new high |
| Asynchronous pipeline is healthy | **Confirmed**. The staleness generation and importance sampling clipping ratio are both in the normal range, but flash's staleness generation is slowly climbing (1.14 → 1.59) |
| The divergence between the trainer and the inference engine is slowly growing | **Refuted**. See section 3; this is the most substantive correction in this issue |
| The reward rises more slowly than the pass rate | **Confirmed and strengthened**. The ratio dropped from 0.68~0.70 to 0.57~0.58 |
| Offline evaluation is noisy | **Cannot update** (no new results during the observation period) |
| Stability is the largest hidden cost | **Confirmed and strengthened**. pro added two more restarts |

---

## 3. The most important correction: that "divergence" curve

### Surface phenomenon

On the dashboard home page there is a `train_infer_diff/new_infer/kl`, measuring how much the probabilities calculated by the trainer and the inference engine differ for the same piece of text.
During the observation period it rose from 0.0022 to 0.0094, an increase of more than threefold.

In issue 1 I explained it as "the farther the policy is from the initial point and the more dispersed the MoE routing, the larger the error".
This explanation sounds plausible, **but it is wrong**.

### How was it discovered

In the `partial/` namespace, this dashboard splits the same set of metrics into 8 buckets by data freshness:
`partial/0/...` is the latest data produced by the current policy, `partial/1/...` was produced by the previous policy version, and so on.
Each bucket contains a complete set of training-inference divergence metrics. In other words, the dashboard already provides
the answer to "does divergence grow as data gets staler" — it's just not shown on the home page.

Multiply each bucket's token share by that bucket's own KL and sum them, then compare with the global value on the home page step by step:

```
Global KL = Σ (token share of bucket k × KL of bucket k)
```

For pro, this equation **holds on all 15 steps**; for flash, it **holds on all 20 steps**, with errors within 2%.
That curve on the home page is not an independent quantity; it is just the weighted average of the buckets.

### A natural experiment that arrived during the monitoring period

pro step 15, because it restarted in the middle, had its sampling start over, so this step uses 100% fresh data.
Thus:

| pro step 14 | pro step 15 |
| --- | --- |
| Fresh data share 27.4%, stale by 1 generation 38.5%, by 2 generations 19.5%, by 3 generations 14.6% | Fresh data share 100% (average staleness generation = 0) |
| Global KL = 0.00937 | Global KL = 0.00258 |
| Bucket 0 KL = 0.00248 | Bucket 0 KL = 0.00258 |

**After the restart the global value drops straight back to 0.00258, exactly equal to the value for bucket 0.** This is, regarding the judgment that "the global value is a weighted average",
the most direct verification: when all data is fresh, the global value equals the fresh value. 97% of the KL change from step 14 to step 15 comes from data freshness,
not engine precision.

### After breaking it down

| | pro | flash |
| --- | ---: | ---: |
| Fresh data (bucket 0) KL, first step → last step | 0.00219 → 0.00258（+18%） | 0.00287 → 0.00344（+20%） |
| Global KL, first step → last step | 0.00219 → 0.00258 (falls back after restart) | 0.00287 → 0.00979（+241%） |
| Absolute difference for fresh data, first step → last step | 0.0238 → 0.0254（+7%） | 0.0271 → 0.0300（+11%） |
| Global absolute difference, first step → last step | 0.0238 → 0.0459（+93%） | 0.0270 → 0.0444（+64%） |

Correlations (computed using data from the entire observation period):

| Relationship | pro | flash |
| --- | ---: | ---: |
| Global KL and average staleness generation | +0.944 | +0.944 |
| Global KL and fresh data share | −0.877 | −0.722 |
| Global KL and the fresh data's own KL | +0.331 | +0.151 |

**Conclusion**: the rise in this curve is, for the most part, not the two engines drifting further and further apart, but the data becoming staler and staler.
The quantity that truly measures "how much the engines themselves differ" — KL on fresh data — slowly climbs from 0.0022 to 0.0034,
an increase of less than 20%, staying within a very narrow band the whole time.

### Is this horizontal line high or low

pro is between 0.0022 and 0.0026, flash is between 0.0029 and 0.0034.

This magnitude is the numerical floor for "with the same policy and the same model, using two different implementations to compute probabilities, how much can they differ."
There are two reference values in public sources: rerunning the same inference engine twice gives KL on the order of 8.4e-4;
For MoE models, because expert routing is discrete, training-inference inconsistency is higher than for dense models; public measurements are about 1.5e-3 versus 6.4e-4.
The dashboard-measured 2.2e-3 ~ 3.4e-3 matches this order of magnitude; no anomaly is apparent.

There is another related public result: in MoE models, 94% of tokens have at least one layer that selects a different expert, with an average of 6 layers differing.
This explains why "the probabilities computed on the two sides differ" is natural and not a bug.

### What is this correction useful for

Looking at that curve on the home page leads to a completely wrong conclusion — you would think engine precision is deteriorating and then go do some useless optimizations.
The correct approach is:

1. **Look only at the KL of bucket 0 (fresh data)**; that is the quantity that reflects "how much the engines themselves differ".
2. **Treat global KL as a "data freshness meter"**. When it rises, it means the stale data share is increasing,
   What you should look at is the cadence of sampling and training, not engine precision.
3. **Look at the two lines separately, and they won't mask each other**. If bucket 0 suddenly rises, that is a real problem;
   if only the global line rises while bucket 0 stays flat, then it's just that the data is old.

A cautionary lesson: `actor/pg_tis_clipfrac` (the proportion of importance sampling that is clipped) and global KL have almost the same trend.
Reading it according to global KL would yield "the bias from stale data is becoming harder and harder to keep down",
but the real cause is likewise "the proportion of stale data changed", not that the correction mechanism failed.

---

## 4. pro step 15: an easy pitfall when reading the dashboard

pro step 14 completed at 09-17 06:51:21 UTC, step 15 completed at 15:09:48 UTC,
**Actual elapsed time 8 hours 18 minutes**. Its 15 completed steps average 2.39 hours based on reported values,
of which the 11 steps without restarts are between 1.9 and 2.9 hours.

But the "time elapsed for this step" written on the dashboard's runtime card only ever showed up to 3.16 hours during the monitoring period.
The two numbers differ by more than a factor of two; the reason is: **the "time elapsed for this step" on the dashboard restarts its timer after every restart**.
pro restarted twice during step 15 (09:29 and 11:21 UTC), so the timer was interrupted twice.

There is no hint of this detail on the dashboard, but it is critical for judging "whether this step has a problem."
The correct way to read it is:

> Take the interval from "the completion time of the previous step" to "now" and compare it with the elapsed time displayed on the card; the larger the difference, the more restarts there were in between.

From the sampling log you can see the recovery process after a restart:

| Time (UTC) | Tasks collected | Judged | Total attempts | Pass rate | Sandbox warmup |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11:50 | 48 | 37 | 125 | 0.384 | 512 |
| 12:10 | 376 | 310 | 778 | 0.483 | 512 |
| 12:30 | 872 | 758 | 1666 | 0.523 | 512 |
| 13:51 | 2,664 | 2,585 | 4,594 | 0.580 | 462 |

The recovery speed is about 20 tasks per minute. Here there is a clearly observable bias: **the pass rate right after a restart is only 0.384,
far below the normal level (0.59~0.60)**, and only gradually recovers as sampling proceeds.
The reason is not hard to understand: the sandbox is prewarmed again, the first to finish are often short tasks, long tasks are still in flight, and early samples are biased.

So there is a second thing: **the first step after a restart cannot have its score directly compared with a normal step**.
At the bottom of the dashboard's "batch composition" panel, there is a line of small text specifically reminding of a similar issue, which shows the team is aware of this.

Step 15's final score is 0.6172, slightly higher than step 14's 0.6152, and it looks like it has "returned to normal."
But considering that this step's data is completely new, and the context length also dropped from 106k back to 91k,
this number has limited comparability. To judge pro's true level, you have to look at step 16.

### The same problem also exists in timing_s/step

Following this clue further, I found that the `timing_s/step` metric has the same flaw, and it can be verified precisely.

Align each step's "reported elapsed time" one by one with "the actual wall clock from completion of the previous step to completion of this step":

pro：

| step | Reported duration | Actual wall clock | Difference | Restart in between? |
| ---: | ---: | ---: | ---: | --- |
| 1 | 9,570 | 24,538 | −14,969 | Yes |
| 2 | 7,225 | 13,804 | −6,579 | Yes |
| 3 | 8,495 | 19,513 | −11,019 | Yes |
| 4 | 6,851 | 6,857 | −6 | No |
| 5 | 6,958 | 6,959 | −0 | No |
| … | … | … | within ±10 | No |
| 11 | 9,423 | 20,113 | −10,690 | Yes |
| 12 | 9,063 | 9,060 | +3 | No |
| 13 | 9,416 | 9,427 | −11 | No |
| 14 | 10,492 | 10,493 | −2 | No |
| 15 | 12,882 | 29,907 | **−17,025** | Yes (twice) |

The pattern is very clean: **for steps without restart, the reported value and the actual value are within 10 seconds of each other;
for steps with restart, the reported value subtracts the entire restart period.**

In total:

| | Total reported step duration | Actual wall clock | The deducted portion | The deducted money |
| --- | ---: | ---: | ---: | ---: |
| pro | 35.9 hours | 52.6 hours | **16.8 hours (32%)** | About 34.4 ten-thousand USD |
| flash | 40.1 hours | 47.9 hours | 7.6 hours (16%) | About 7.8 ten-thousand USD |

This has two direct implications for reading the dashboard:

**One, the `timing_s/step` curve underestimates actual per-step elapsed time, and it can only be noticed when the numbers don't reconcile.**
On the chart, pro step 15 is 12,882 seconds (3.6 hours), a normal rising curve;
In reality it took 8.3 hours. On the chart, you cannot tell at all that this step had a problem.

**Two, the per-step cost estimated with "cost per second × reported elapsed time" is a lower bound.** In Issue 1, the value I gave
"pro per-step $39,000 to $60,000" was calculated using reported elapsed time; the actual value must add the deducted portion.
pro step 15's actual cost is 29,907 seconds × $5.71 ≈ $171,000,
more than three times its regular per-step cost (about $50,000).

To see this, the only reliable way is to **look at timestamps as well**:
In the `status` interface, every step event carries an absolute timestamp; subtracting two adjacent ones gives the actual elapsed time.
Looking only at the curve on the chart won't reveal it.

---

## Five, that signal at flash step 19 was refuted by step 20

This is the most noteworthy "falsified prediction" of this issue.

The step 19 data was once very tempting:

| Metric | step 18 | step 19 | Change |
| --- | ---: | ---: | ---: |
| avg@n | 0.6023 | 0.6262 | +0.0239 |
| all-correct proportion | 0.2256 | 0.2608 | +0.0352 |
| All-wrong proportion | 0.1587 | 0.1356 | **−0.0231** |
| Average reward | 0.5767 | 0.5721 | −0.0046 |

The all-wrong proportion dropped from 0.1587 to 0.1356, the only time in the two trainings that it jumped outside the 0.142~0.169 range.
Issue 1 treated "about 15% of problems cannot be solved correctly even once" as a wall; step 19 looked like the wall was loosening.

The step 20 result:

| Metric | step 19 | step 20 | Change |
| --- | ---: | ---: | ---: |
| avg@n | 0.6262 | 0.6071 | **−0.0191** |
| all-correct proportion | 0.2608 | 0.2510 | −0.0098 |
| All-wrong proportion | 0.1356 | 0.1576 | **+0.0220** |
| Average reward | 0.5721 | 0.5713 | −0.0008 |
| average context | 123,900 | 129,400 | +4.4% |
| generation time (s) | 3,632 | 4,932 | +35.8% |
| training time (s) | 4,889 | 4,954 | +1.3% |
| average staleness generations | 1.48 | 1.59 | +7% |

The all-wrong proportion bounced back to 0.1576, and the pass rate fell back to 0.6071. **Step 19 was a fluctuation.**

The value of this record is not in the conclusion, but in that it demonstrates one thing: **on a curve with per-step noise this large,
a single data point says nothing.** In Issue 1 I wrote "offline evaluation can jump 6 points in a single step; you cannot look at a single point",
Now this proves the same holds for the training-side pass rate——flash's adjacent two steps can differ by 2 percentage points.

Looking across all 20 steps, flash's pass rate is still net increasing (0.5137 → 0.6071),
it's just that the path is much more volatile than pro.

---

## Six, the growth structure has not changed, but the reward is following more and more slowly

### Growth structure

Decompose the sampling pool into all-wrong (proportion p0), all-correct (proportion p1), and middle (proportion 1−p0−p1, average pass rate m),
The average pass rate equals `p1 + (1−p0−p1) × m`. Differencing the first and last:

| Source | pro (15 steps) | flash (20 steps) |
| --- | ---: | ---: |
| Increase in the proportion of all-correct problems | +0.0908 | +0.1302 |
| Shrinkage of the middle pool | −0.0552 | −0.0731 |
| Improvement of the problems themselves in the middle pool | **+0.0169** | **+0.0363** |
| Total | +0.0525 | +0.0934 |

The conclusion is the same as Issue 1, but clearer: **the largest single driver on both sides is "pushing problems that previously passed half the time to passing every time";
The contribution of truly "medium problems getting better" is only 30% for pro and 40% for flash.**

flash is still healthier than pro on this, but the gap between them is narrowing (in Issue 1 it was 2.06 versus 4.34 per-mille points,
now it is 1.69 versus 3.63——note that pro's middle term actually declined, mainly because the restart at step 15 disrupted the data).

### Reward is following more and more slowly

This change is new in this issue:

| | Issue 1 | Issue 2 |
| --- | ---: | ---: |
| pro reward increase ÷ pass-rate increase | 0.70 | **0.57** |
| flash reward increase ÷ pass-rate increase | 0.68 | **0.58** |

Both trainings' pass rates are rising, but the reward is increasingly unable to keep up.
There are several possible causes, and I cannot determine which one it is:

- Newly correctly solved problems are deducted more on process score (the answer is correct, but the solution process is not acceptable).
- Besides correctness, the reward has other components, and those components are getting worse.
- Reward and pass rate inherently have different statistical bases (pass rate is computed on the sampling pool, reward is computed on the batch that actually enters training),
  the two should not be fully synchronized.

Issue 1 was only "reward rising slowly"; now it has become "the gap is widening", which is worth continuing to track. If the reward eventually stops rising,
that means **the pass-rate metric is decoupling from the capability it represents**——this is one of the changes most worth being wary of in RL training.

---

## Seven, the roles of training and generation have swapped

For flash's last two steps, training time exceeded generation time in both:

| | step 18 | step 19 | step 20 |
| --- | ---: | ---: | ---: |
| generation time (s) | 4,585 | 3,632 | 4,932 |
| training time (s) | 4,123 | 4,889 | **4,954** |

Counting all 20 steps, flash has 11 steps where training took longer than generation (steps 5, 6, 7, 8, 9, 10, 12, 13, 15, 19, and 20).
Among pro's 15 steps, only 4 are like this. Moreover, flash step 20's training time (4954 seconds)
has already exceeded any step of pro (pro's maximum is 4814 seconds).

**This is not because flash trains slowly, but because flash's context is longer.**
flash's average context is 129,000 tokens, pro's is 91,000 (and pro just fell back due to a restart).
Training time mainly follows token count, whereas generation is inherently parallelized and is not linearly affected by token count.

Per-step training efficiency is also getting worse:

| Training time per million training tokens | First step | Last step |
| --- | ---: | ---: |
| pro | 1.60 seconds | 1.65 seconds (peak 1.82) |
| flash | 1.05 seconds | 1.54 seconds |

This metric rose 47% for flash and was basically flat for pro. This explains why flash's per-step time
rose from initially 1.8 hours to 2.4 hours.

---

## Eight, two small changes in the asynchronous pipeline

During the observation period, two lines are worth noting:

**flash's average staleness generations are slowly climbing**: from 0.84 at step 17 to 1.59 at step 20.
In the same period, pro is between 0.68~1.21, and step 15 became 0 due to a restart.

This trend itself is not yet a problem——public framework experiments show that allowing moderate staleness (proportion 0~0.5)
can instead improve final accuracy (0.2604 → 0.3094), while reducing the time for 400 steps from 26 hours to 17.3 hours.
The reason is that generation and training run overlapped, so machines are not idle. **So staleness is not the lower the better; it is a trade of bias for throughput.**

But flash's staleness generations nearly doubled in 4 hours; if this rate continues, in a few days it will approach a magnitude that warrants vigilance.
The next issue should focus on this line.

**flash's infrastructure error rate is falling back**: it once spiked to 3.04% at step 16 (because of rerunning after a restart),
afterward 1.39% → 1.06% → 0.85%, and it is returning to a normal level.

---

## Nine, what still cannot be determined

Listed for honesty:

1. **pro's true level.** Step 15 was affected by a restart (entirely new data, context falling back),
   it will only be known by looking at it together with step 16.
2. **The noise level of offline evaluation.** There were no new DeepSWE results during the observation period, and Issue 1
   "the stepwise incremental correlation coefficient is only 0.48" cannot be verified.
3. **Whether the reward validation pipeline has started taking effect.** `train/adv_pos_sum_pre_penalty`
   and `adv_pos_sum_post_penalty` are still exactly identical step by step, and `adv_reduction_total` remains identically 0.
   This line will not provide new information in the short term.
4. **Whether `select_hack_attempt_rate` rises with training.** pro is at 0.34~0.41,
   flash is at 0.38~0.47; neither has a unidirectional trend, and there is no sign of "the more it trains, the more it cheats", but the observation window is still too short.
5. **The reason `actor/pg_clipfrac` and `actor/ppo_kl` are identically equal to 0.** The site does not explain,
   so no conclusion has been drawn from Issue 1 to now.

---

## 10. What to watch if we keep following

1. **pro's step 16 score.** This is first-hand data for judging pro's true trend.
2. **flash's "reward ÷ pass rate" ratio.** It is now 0.58 and trending down; if it keeps falling, it means
   the pass rate is decoupling from capability.
3. **flash's average staleness generation count.** It doubled in 4 hours and is worth calculating the slope for.
4. **KL of bucket 0.** pro 0.00258, flash 0.00344; both are slowly drifting up within a narrow band,
   if it jumps out at any step, that is a real problem.
5. **All-wrong proportion.** Up to step 20, both sides are still flat at 0.14~0.16,
   the step 19 instance was a fluctuation.
6. **Whether there are new restarts.** pro restarted twice in 12 hours; if this frequency continues,
   it means a systemic problem has been encountered rather than an occasional failure.

---

## Appendix: Key numbers at the end of this issue

```
pro   step 15 (final step)   cumulative cost $1,082,255   cumulative token 32.5B   restarts 7 times
flash step 20 (final step)   cumulative cost $492,459     cumulative token 49.4B   restarts 2 times

pro   avg@n 0.5647 → 0.6172   all-wrong 0.1462 → 0.1496   all-correct 0.1779 → 0.2687
flash avg@n 0.5137 → 0.6071   all-wrong 0.1605 → 0.1576   all-correct 0.1208 → 0.2510

pro   global KL 0.00219 → 0.00258 (falls back after final-step restart)   bucket 0 KL 0.00219 → 0.00258
flash global KL 0.00287 → 0.00979                      bucket 0 KL 0.00287 → 0.00344

pro   context 72.2k → 91.5k (reached 106.2k at step 14)  flash context 71.6k → 129.4k
pro   actual duration of step 15: 8 hours 18 minutes (2 restarts)      flash per-step 1.8h → 2.4h

flash number of steps where training duration exceeds generation duration: 11 out of 20 steps
pro   number of steps where training duration exceeds generation duration: 4 out of 15 steps

Mixed identity (global KL = Σ bucket share × bucket KL) verification: holds for pro 15/15, flash 20/20
```
