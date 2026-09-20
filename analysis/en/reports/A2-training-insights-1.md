# mimo-v2.6 RL Training Insights (Issue 1)

Data cutoff: 2026-09-17 10:50 UTC (18:50 Beijing time). pro is at step 14, flash is at step 18.
All numbers come from raw data from the site's public API; see `analysis/en/notes/05-identity-checks-and-derived-quantities.md` for the verification process.

---

## Abstract

1. Both training runs are steadily improving, at a rate of about **0.5 percentage points per step** in pass rate (pro slope 0.0049/step, flash 0.0057/step),
   The correlation coefficients are both above 0.94, and the trend is very clean.
2. The bottleneck has shifted from "generation" to "training". pro's generation time dropped by 16%, and training time rose by 67%,
   and the correlation coefficient between training time and context length is 0.968, almost a straight-line relationship. This is not a coincidence; it is an inevitable result of long-context agentic RL.
3. The structure of capability growth deserves caution: of pro's 5.06 percentage-point improvement, **4.86 points were eaten up by the "shrinking middle pool"**,
   only 2.06 points truly came from "medium problems getting better". About 15% of problems were never solved correctly even once from start to finish, and did not move across 14 steps.
4. Context length grew by 47% (pro) and 61% (flash), while problem length barely changed. All the extra is written by the model itself,
   on average, each problem writes 100,000 tokens over 60 turns.
5. The asynchronous pipeline is currently healthy: average data staleness is 1.2 generations, and the proportion of importance sampling that gets clipped is only three ten-thousandths.
   The curve on the front page for "trainer vs. inference engine divergence" looks like it increased 3-fold, but when broken down into the 8 buckets by data freshness, you will find that,
   **divergence on fresh data barely moved (only between 0.0022 and 0.0033); all the increase is the weighting effect from data getting stale.**
6. Offline evaluation has a low signal-to-noise ratio. DeepSWE single-step fluctuation can reach 6 points, and its correlation coefficient with online pass rate is only 0.48 (pro's step-wise increment).
   To read this metric, you have to look at the line over two or three steps.
7. Engineering reliability is the largest hidden cost right now: pro has **33% of machine time not falling in a completed step**,
   This time is still billed at $5.71 per second.

---

## 1. Cost and throughput: where the money goes

The cost rate given by the site is $5.71/second for pro and $2.855/second for flash; the two add up to $8.565/second.
Put another way: **this dashboard burns $8.57 per second, $30,800 per hour, and $740,000 per day.**

Multiplying the rate by each step's wall clock time gives the per-step cost (this also includes restart waiting, and is an upper bound):

| | Per-step cost range | Per-step training tokens | Cost per million training tokens |
| --- | --- | --- | --- |
| pro | $39,000 ~ $60,000 | 1.7B ~ 2.7B | About $22 (19.5 ~ 30.3) |
| flash | $14,000 ~ $29,000 | 1.8B ~ 2.8B | About $8 (7.1 ~ 12.0) |

These two numbers are interesting only when viewed together: **pro's per-token training cost is about three times flash's**,
but the per-step token volumes on both sides are similar. That is, the difference in cost is almost entirely in "how many GPUs it takes to compute the same token",
rather than in "how much was done." This is the most direct manifestation of the model-scale difference.

There is another trend worth recording. Compute each step's "trainer time ÷ training token count" as an efficiency metric:

- pro: from 1.49 seconds/million tokens at step 3 to 1.82 at step 14, up 22%.
- flash: from 1.05 at step 1 to 1.46 at step 18, up 39%.

The trainer is slowing down at processing the same number of tokens, and flash is slowing down even more. The likely reason is that once sequences get longer,
the computation in the attention part grows faster than the linear growth in token count, and long sequences also put more pressure on VRAM and communication.
If this curve continues upward, it will directly eat into the gains brought by longer context.

---

## 2. Bottleneck migration: from generation to training

This is the one I most want people to see in phase 1.

pro's complete elapsed-time changes (step 1 → step 14):

- Full-step time: 9570 seconds → 10492 seconds, up 9.6%
- Generation stage: 6514 seconds → 5451 seconds, **down 16.3%**
- Trainer stage: 2889 seconds → 4814 seconds, **up 66.6%**

Over the same period, training token volume rose 47%. That is:

- The generation stage is almost unaffected by the growth in token volume. This is easy to understand: generation is spread out in parallel—
  pro has about 23,000 sandboxes running simultaneously; how long generation itself takes depends on "how long the longest trajectory ran",
  not on "how many tokens need to be run in total." So even though tokens rose 47%, generation time actually fell.
- The trainer stage is almost proportional to token volume. I correlated context length with trainer time, and the coefficient is 0.968.

Another supporting point: within a step's time, the part outside generation + training accounts for only 2.3% (pro) / 3.0% (flash).
That is, **none of a step's time is wasted on scheduling; all of it is these two stages**.
Then the direction of full-step time is entirely determined by the tug-of-war between these two stages.

At the current slope, pro's per-step trainer time is increasing at 130 seconds/step, while generation time is basically flat.
In about another 10 to 15 steps, the trainer will overtake generation and become the dominant term in per-step time.
By then, per-step time will exceed 3 hours, and the generation stage will begin to show a large amount of idle compute.

The engineering implication is clear: **continuing to improve scores by "making the model write more" will have increasingly high marginal cost**.
In phase 2 I will watch this line to see whether the team intervenes (for example, shortening context, increasing generation concurrency, optimizing the training side).

---

## 3. The structure of capability growth: decomposing 5.06 percentage points

As mentioned earlier, if a task is attempted 16 times and is all-correct or all-wrong, there is no variation among those 16 attempts,
no learning signal can be produced, and sampling this task is wasted. This constraint gives structure to "improvements in pass rate."

Split each step's sampling pool into three parts: all-wrong (proportion p0), all-correct (proportion p1), and middle (proportion 1-p0-p1, average pass rate m).
The average pass rate is exactly `p1 + (1-p0-p1) × m`. Differencing the first and last:

pro from step 1 to step 14, avg@n rose by +0.0506; decomposed:

| Source | Contribution |
| --- | ---: |
| Increase in the proportion of all-correct tasks (p1: 0.178 → 0.256) | **+0.0786** |
| Shrinkage of the middle pool (because tasks were pushed to all-correct) | −0.0486 |
| Improvement in the tasks in the middle pool themselves (m: 0.572 → 0.605) | **+0.0206** |
| Total | +0.0506 |

flash decomposition (step 1 → step 18, total increase +0.0886):

| Source | Contribution |
| --- | ---: |
| Increase in the proportion of all-correct tasks (0.121 → 0.226) | +0.1049 |
| Shrinkage of the middle pool | −0.0597 |
| Improvement in the tasks in the middle pool themselves (0.547 → 0.612) | +0.0434 |

How to read:

- The largest single driver in both training runs is **pushing tasks that were "half right" into "right every time"**.
  This is good news: it shows that the model has indeed become more stable on tasks where it had already reached the threshold.
- But on the more fundamental part, "middle tasks themselves getting better," pro contributed only 2.06 points, while flash contributed 4.34 points.
  **flash's progress structure is healthier than pro's**—it improves more in the true middle zone, rather than pushing tasks on the boundary over.
- The most glaring thing is p0. pro's all-wrong proportion went from 0.146 to 0.150 over 14 steps, and flash from 0.161 to 0.159,
  **In both training runs it did not move at all**. About 15% of tasks the model never got right from beginning to end.

The same thing can also be seen from correlations: the correlation between pass rate and all-correct proportion is +0.93 (pro) / +0.95 (flash),
and with the all-wrong proportion it is only −0.47 / −0.30.

**Conclusion**: So far, these two RL training runs have mainly been "becoming stable on tasks it can partially do",
rather than "conquering tasks it cannot do at all." The 15% hard nuts are the difficulty ceiling of this batch of tasks, and may also be places the current reward design does not cover.

What phase 2 needs to verify is whether this 15% will start to loosen as training continues.
If it never moves, it means there is a batch of samples in the data for which **the current policy can never obtain a nonzero advantage**,
They consume sampling budget at every step but produce no gradient.

---

## 4. The length arms race and its ceiling

Data:

| Metric | pro step1 → step14 | flash step1 → step18 |
| --- | --- | --- |
| Average total context | 72,178 → 106,203（+47%） | 71,634 → 115,604（+61%） |
| Of which: task portion | 4099 → 4210（+2.7%） | 4171 → 4370（+4.8%） |
| Of which: model-written | 68,078 → 101,993（+50%） | 67,463 → 111,233（+65%） |
| Average number of turns | 47.5 → 59.5 | 47.3 → 63.2 |

The task portion almost did not get longer; all the growth is content generated by the model itself. And the number of turns rose only 25%~34%,
while context rose 47%~65%, meaning **each turn itself is also getting longer**.

This is not "the model becoming verbose." In agentic tasks, every step the model takes requires reading observation results (file contents, command output, error messages)
back into context, and this content keeps accumulating. The longer the context, the more on-site information it can "remember," and the higher the pass rate—
The correlation coefficient between context length and avg@n is +0.91 (pro)/+0.85 (flash).

But the cost of this path is a hard one:

- Training token count is proportional to context length (I verified: 1568 tasks × 16 times × average context = total tokens per step, error 1%~3%).
- Trainer time is proportional to training token count (correlation coefficient 0.968).

So **for every 1% longer context, training cost is 1% more expensive**, and Section 1 calculated that training efficiency per token itself is still getting worse.

The ceiling is 1,048,570 tokens. The site does not explain this number, but it is clearly a hard context limit
(very close to 2 to the 20th power). The fraction of truncated trajectories `ctx_total_length/clip_ratio` is currently a few ten-thousandths,
The absolute value is very small, but both are trending upward (pro from 4.0e-5 to 2.4e-4, flash's highest, step 18, reached 1.4e-3,
that is, 1.4 per thousand). At the current growth rate of length, this line is worth a look every period.

Another detail: at flash step 14, a trajectory with 2,236,430 tokens appeared, more than twice the ceiling.
This is an anomalous sample; the site does not explain it, and I won't guess what it is.

---

## V. Stability evaluation of the asynchronous pipeline

These lines are key to judging "whether the direction learned by training is correct", because they reflect
"how inconsistent the data used to compute gradients is with the current model".

### Data staleness

Average stale generations: pro is stable at 1.0~1.8, the most recent steps are 1.2; flash 1.7~1.9, falling back to 1.14 at step 18.

But averages mask the distribution. The distribution for pro at step 14 is:

| Stale generations | token share |
| ---: | ---: |
| 0 (fresh) | 27.4% |
| 1 | 38.5% |
| 2 | 19.5% |
| 3 | 14.6% |

**More than 70% of the training data was not produced by the current policy.** This is a normal cost of asynchronous RL, not a failure.
It should be specially noted that **low staleness does not equal good**: in the public framework documentation there is a set of 128-GPU controlled experiments,
relaxing the allowed staleness from 0 to 0.5, final accuracy rose from 0.2604 to 0.3094,
while the time for 400 steps dropped from 26 hours to 17.3 hours. The reason is that generation and training overlap, so machines don't idle,
as long as the importance sampling correction actually takes effect, slightly stale data is completely worth it.
So "stale" should be understood as a trade of bias for throughput, not a metric to be pushed to 0.
What really needs vigilance is if it keeps rising above 3 and does not fall back.

flash has a longer tail: from steps 11 to 15, 0.33%~0.47% of tokens were more than 8 generations stale,
which even the 8 bins provided by the site cannot contain. This is why my calculation of `Σ i × frac_i` is smaller than the value reported by the site,
and it also shows that flash's asynchronous pipeline depth is greater than pro's.

### Importance sampling correction pressure

Stale data must be corrected by weighting according to the probability ratio between the new and old policies, while the weights are bounded to prevent individual sample weights from running out of control.
The site exposes `actor/pg_tis_clipfrac` (fraction of samples that were clipped) and a set of `F(tau=…)` (out-of-range fractions at different thresholds).

| | Step 1 | Last step | Magnitude |
| --- | ---: | ---: | --- |
| pro `pg_tis_clipfrac` | 2.1e-5 | 3.3e-4 | Three ten-thousandths |
| flash `pg_tis_clipfrac` | 4.5e-5 | 1.9e-4 | Two ten-thousandths |
| pro `F(tau=1.5)` | 0.39% | 2.39% | Two percent |
| flash `F(tau=1.5)` | 0.60% | 2.10% | Two percent |

The increases are all non-trivial (more than tenfold to severalfold), and the absolute values are all very small. The judgment is: **the bias from stale data is still under control**.
This is consistent with the average stale generations being only 1.2—if stale generations rise above 3, these lines will raise the alarm first.

It is worth noting that these numbers **drop back after a restart** (flash step 16's `pg_tis_clipfrac` is only 4.0e-5,
one fifth of step 15). The reason is that after a restart all in-flight sampling is invalidated, and the data at step 16 is almost entirely fresh.
This also shows that these lines are very sensitive to pipeline state, making them a useful incident probe.

### Numerical divergence between trainer and inference engine

`train_infer_diff/new_infer/kl` measures how much the probability computed by the inference engine differs from the probability computed by the trainer for the same piece of text.

The surface numbers are frightening:

- pro: 0.0022 → 0.0094, increased by 3.3 times
- flash: 0.0029 → 0.0083, increased by 1.9 times
- Mean absolute difference `diff_abs_mean`: pro 0.024 → 0.046; flash 0.027 → 0.044

**But this curve cannot be read directly, because it is a mixture.** The dashboard splits the same set of metrics by data freshness into 8 buckets
(`partial/0/…` is fresh data, `partial/1/…` is one generation stale, and so on).
I multiplied these buckets by their shares and checked:

```
global KL = Σ (token share of bucket k × KL of bucket k)
```

This equation holds within 2% error on pro's 13 steps with data and flash's 16 steps.
That is, **the KL curve on the homepage is just the weighted average of the buckets, not an independent quantity**.

Looking at the buckets separately, the conclusion changes completely:

| | pro | flash |
| --- | ---: | ---: |
| KL of fresh data (bucket 0), first step → last step | 0.00219 → 0.00248（+13%） | 0.00287 → 0.00333（+16%） |
| Global KL, first step → last step | 0.00219 → 0.00937（+328%） | 0.00287 → 0.00834（+191%） |
| Fresh data's `diff_abs_mean` | 0.0238 → 0.0254（+7%） | 0.0271 → 0.0300（+11%） |
| Global `diff_abs_mean` | 0.0238 → 0.0459（+93%） | 0.0270 → 0.0444（+64%） |

Now look at correlations: the correlation coefficient between global KL and average stale generations is **+0.944** (in both trainings),
and with "fresh data share" it is **−0.877 / −0.722**, and with "bucket 0's own KL" it is only **+0.331 / +0.151**.

**Conclusion: the homepage KL curve increased by 3 times, and the vast majority is not the two engines drifting further apart, but the data becoming increasingly old.**
The quantity that truly measures "how much the engines themselves differ"—KL on fresh data—is almost a horizontal line.

So what is this horizontal line? pro is about 0.0022~0.0025, flash is about 0.0029~0.0033.
This magnitude is the numerical floor for "how much the probabilities computed by two different implementations of the same policy and same model can differ".
In public material, the KL of the same inference engine rerun twice is already on the order of 8.4e-4,
and MoE models are somewhat higher due to the discreteness of expert routing (about 1.5e-3).
The 2.2e-3 ~ 3.3e-3 measured on the dashboard is consistent with this magnitude; no anomaly is visible.

The remaining part of the increase is real: bucket 1's KL rose from 0.0045~0.0056 to 0.0075,
bucket 2 from 0.011 to 0.013, bucket 3 from 0.017 to 0.023, increases of 30% to 50%.
For one-generation-stale data, the divergence between the two engines is indeed slowly growing—this matches the expectation that "the farther the policy is from the initial point, the more dispersed the routing".

One extra use: because this decomposition exists, as long as you watch whether bucket 0's KL is still below 0.003,
you can separate "the engine is broken" from "the data is old". This is a much more reliable alarm line than looking at the homepage curve.

By the way, one guess that did not hold up. There is a claim in public material:
When the divergence between trainer and inference engine grows, the gradient norm shows synchronized spikes. I checked against the data, and **this does not hold**:
pro's correlation coefficient is +0.336, flash's is **−0.456**. Coincidentally, in both trainings, pro's step 9
`grad_norm` (0.00873, highest across the entire run) and KL (0.00980, highest across the entire run) did indeed peak at the same time,
But flash's `grad_norm` peak appears at step 16—which is exactly the step that was rerun after the restart—
whereas the KL peak is at step 11; the two do not coincide. So the synchronization at step 9 is more likely a coincidence,
and is not suitable as a general cross-validation method. The more likely cause of the gradient spike at flash step 16 is the batch change brought by the rerun after the restart.

Incidentally, one thing not clarified before: `actor/lr` is constantly 3e-6 throughout the entire run, never changing from start to finish.
The learning rate is a fixed value, with no warmup and no decay.

### Clipped samples

`actor/pg_clipfrac` and `actor/ppo_kl` are exactly equal to 0 in all steps of both training runs.
In standard PPO, clipfrac should be a decimal greater than 0; being identically 0 is not normal.
It may be that the clipping mechanism used by this system is not standard PPO (so this counter is not assigned a value), or it may be disabled in the configuration.

**I am not sure which reason it is, and the site does not explain it either, so I will not make any judgment in this issue.**
I will record only one operational conclusion: do not use these two metrics to judge the health of this training setup; they are identically 0 on this system.

---

## 6. Signal-to-noise ratio of offline evaluation

DeepSWE v1.1 currently has only this one offline evaluation. Putting the online pass rate together with it:

pro (10 steps with evaluation): level correlation coefficient +0.804, **the correlation coefficient of step-by-step increments is only +0.484**.
flash: level +0.792, step-by-step increment +0.584.

To translate: this benchmark can reflect long-term trends (level correlation 0.8), but **cannot be used to judge "whether the previous step of training was effective"**.
flash drops from 60.18 at step 10 to 54.13 at step 11, then returns to 60.77 at step 12,
A difference of one step is 6 points, while the online pass rate changes across these three steps are only within 1 percentage point.

Another easily overlooked fact: at step 1, the DeepSWE score for pro is already 58.41, and for flash 48.67.
This is **the base model level before this round of RL started**. After 11 steps, pro reaches 65.78, up 7.4 points.
So this round of RL is continuing to climb from an already decent baseline, not starting from zero.

A practical recommendation for readers: look at the benchmarks column, and treat it as a "weekly health check report",
not as an "acceptance checklist for every training run".

---

## 7. Reward validation pipeline: measures a lot, changes little

The `penalty/stage_credit_group` family has 535 metrics, the largest family.
From the field names, one can see a fairly complex reward validation pipeline for coding problems: grading pool, two-pass grading, grouping, tiering, suspected cheating detection.

Numeric facts that can be confirmed:

- The grading itself is very reliable: `pass1_success_rate` is stable above 0.95, and `pass2_success_rate` is identically 1.0.
- A bunch of protective cap counters have never been triggered: `select_r2_capped`, `keep_mass_capped`,
  `rollouts_masked`, `select_r3_gold_fails`, `groups_skipped_unbalanced` are all identically 0.
  Among them, `select_r3_gold_fails = 0` means that "the standard answer fails the newly generated tests" has never happened even once,
  indicating that the automatically generated tests have not produced serious false negatives.
- The trigger rate of suspected cheating detection is very high: `select_hack_attempt_rate` is 0.34~0.41 for pro and 0.38~0.47 for flash.
  But the ones actually marked as severe, `select_process_severe`, are only 15~30 per step.
  Whether "attempt" in the field name counts as "triggering a check" or "confirmed attempt", the site does not explain, so I will not draw a conclusion.
- The tier proportions are very stable: T1 about 64%, T2 about 33%, T3 about 0.8%, H about 1%.

The most noteworthy is the last item. The site's `train/adv_pos_sum_pre_penalty` and
`train/adv_pos_sum_post_penalty` have **exactly the same** value at every step,
`penalty/action/adv_reduction_total` is identically 0.
In other words, this seemingly very complex penalty pipeline **measures in fine detail, but in the end hardly actually changes the advantage values**.

There are two ways to read this. One reading is a good one: the protection mechanism not taking effect indicates that the model currently has no serious cheating behavior,
and the pipeline is only insurance. The other reading is: with such a high proportion of "suspected cheating" trigger rate,
it may simply be that the detector is overly sensitive, and the signals that truly need intervention are drowned out.

I lean toward the first, but only one piece of evidence supports it: truly severe `select_process_severe` is only a dozen to thirty per step,
on the order of one-thousandth of the total. The second issue will continue to follow this line, to see whether `select_hack_attempt_rate` rises with training
(cheating rate rising over time is a common phenomenon in RL).

---

## 8. Reliability: one-third of machine time did not turn into steps

pro has run for 48.3 hours since launch, and the 14 completed steps together account for only 32.3 hours,
**the 16 hours in between (33%) did not fall into any recorded step**.
for flash, it is 8.7 hours out of 43.6 hours (20%).

This time is billed at 5.71 / 2.855 dollars per second. Roughly calculated, those 16 hours for pro are worth about 330,000 dollars,
already more than half of flash's total expense.

Where this time went can be partly seen from the data:

- pro restarted 6 times, flash restarted 2 times. Reasons mentioned in the announcements include node VRAM issues,
  and "a certain type of infrastructure error was not alerted on the dataset and lasted for 3 hours".
- `train/verdicts/expired` (trajectories invalidated by timeout) ranges from 0~1488 per step for pro, with large fluctuations.
- `env/total_error` grows between 0~162 per step, and resets to zero after a restart (indicating it is a cumulative value since the last restart).

An interesting detail: **the per-step time did not become shorter because of the restart**.
flash step 16 took 10,193 seconds, the longest among all its steps—which is exactly the step rerun after the restart.
The reason is probably that after a restart all sandboxes need to be warmed up again and all in-flight trajectories need to be rerun, so the machine is half empty during the first half.

Conclusion: for this kind of long-running RL training, **stability itself is a cost item**,
and its magnitude (20%~33% of machine time) is larger than most people expect. The dashboard lays out both restarts and announcements, which is a very solid thing to do.

---

## 9. Comparison of pro and flash

Putting the two side by side shows what structural differences a "doubling of model scale" brings:

| | pro | flash |
| --- | --- | --- |
| Cost rate | $5.71/second | $2.855/second |
| Sandbox concurrency | about 23,000 | about 38,000 |
| Cost per million training tokens | about 22 dollars | about 8 dollars |
| Pass rate starting point → current | 0.565 → 0.615 | 0.514 → 0.602 |
| Pass rate increase | +8.9% | +17.2% |
| All-correct rate increase | +44% | +87% |
| Contribution of the middle pool improving | +0.0206 | +0.0434 |
| Infrastructure error rate | 0.3%~0.9% | 0.6%~1.4% |
| Number of restarts | 6 | 2 |
| Data staleness generations | 1.0~1.8 | 1.7~1.9 |
| Speculative decoding acceptance length | 3.41~3.55 | 2.75~2.86 |
| DeepSWE starting point → current | 58.41 → 65.78 | 48.67 → 60.77 |

A few observations:

- **flash's growth rate is twice that of pro** (17.2% vs 8.9%). This is as expected: a model with a lower starting point has more room to learn.
- But flash's stability is clearly worse: its infrastructure error rate is twice that of pro,
  its data staleness generations are higher (1.7~1.9 vs 1.0~1.8), and its pass rate curve is also more volatile (it dropped to 0.496 at step 2 and then was pulled back).
- flash's speculative decoding acceptance length is only 2.76~2.86, while pro has 3.41~3.55.
  Both are slowly declining. A declining acceptance length means the speedup ratio of inference decoding is getting worse,
  This is related to "generation time not growing with token count"—the generation side being able to keep time stable is partly thanks to the efficiency of these acceleration methods.
- Sandbox concurrency for flash is 65% higher than for pro, but flash's infrastructure error rate is instead higher.
  This indicates the error rate is not determined by concurrency alone; it may be related to the different distribution of task types used by flash.

---

## 10. Several lines to watch in issue 2

Ordered by priority:

1. **Will the all-wrong rate (`dynsam/passrate/zero`) loosen?** This is the only direct evidence for judging "whether the model is really tackling hard problems".
   If by step 20 it is still flat around 0.15, then we need to suspect there is a batch of samples in the data for which the policy can never obtain an advantage.
2. **Whether trainer time exceeds generation time.** pro's slope is 130 seconds/step, generation is basically flat, and the crossover point is within 10~15 steps.
3. **Whether the KL of fresh data (bucket 0) has broken through 0.004.** Currently pro is 0.0025 and flash 0.0033, both still at the order of the numerical floor.
   Don't look at the global curve on the homepage anymore; it rises as data gets stale and has nothing to do with whether the engine is good or bad.
4. **The ceiling on context length.** Is the truncated proportion still rising.
5. **Will `select_hack_attempt_rate` rise with training.** A cheating rate rising with training is a common phenomenon in RL.
6. **flash's infrastructure error rate.** It has already risen to 1.39%, and it has already rerun once because of an unalerted infrastructure error.
7. **Whether new benchmark items will appear in offline evaluation.** Currently there is only DeepSWE, too few samples,
   Fluctuation in a single benchmark cannot distinguish "real change" from "evaluation noise".

---

## Appendix: Core numbers used in this issue (for comparison in issue 2)

```
pro   step 14   cumulative cost $992,877   cumulative token 30.2B   cumulative trajectories 351k   restarts 6 times
flash step 18   cumulative cost $447,767   cumulative token 43.1B   cumulative trajectories 452k   restarts 2 times

pro   avg@n 0.5647 → 0.6152   rewards 0.5522 → 0.5876   entropy 0.3953 → 0.4050
flash avg@n 0.5137 → 0.6023   rewards 0.5167 → 0.5767   entropy 0.4133 → 0.4333

pro   context 72.2k → 106.2k   turns 47.5 → 59.5   stale generations 0 → 1.21   infer KL 0.0022 → 0.0094
flash context 71.6k → 115.6k   turns 47.3 → 63.2   stale generations 0 → 1.14   infer KL 0.0029 → 0.0083

pro   per-step 9570s → 10492s (generation 6514→5451, training 2889→4814)
flash per-step 6483s → 8930s (generation 4443→4585, training 1884→4123)

pro   all-wrong 0.146 → 0.150   all-correct 0.178 → 0.256
flash all-wrong 0.161 → 0.159   all-correct 0.121 → 0.226
```
