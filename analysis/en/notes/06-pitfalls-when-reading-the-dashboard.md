# Pitfalls when reading this dashboard (with verification methods)

This note records only one kind of thing: **structural details that the dashboard does not indicate but that can make judgments wrong**.
Each item is accompanied by a verification method, so you can recompute it yourself.

---

## 1. `timing_s/step` and the "time used for this step" on the card both exclude restart waiting time

### Phenomenon

`timing_s/step` is one of the metrics permanently displayed on the homepage; literally it means "the wall clock time of the entire step".
**But if there was a restart in the middle, the time during the restart is not counted.**

The same applies to "this step has been running for 1 hour 4 minutes" on the run card; after a restart, timing starts over.

### Verification method

In the `status` interface, each step event carries an absolute Unix timestamp.
Calculate the interval between two adjacent step events and compare it with `series`'s `timing_s/step`:

| step | Reported duration | Actual wall clock interval | Difference | Restart in between? |
| ---: | ---: | ---: | ---: | --- |
| pro 4 | 6,851 | 6,857 | −6 | No |
| pro 5 | 6,958 | 6,959 | −0 | No |
| pro 7 | 7,819 | 7,822 | −3 | No |
| pro 13 | 9,416 | 9,427 | −11 | No |
| pro 14 | 10,492 | 10,493 | −2 | No |
| pro 1 | 9,570 | 24,538 | **−14,969** | Yes |
| pro 11 | 9,423 | 20,113 | **−10,690** | Yes |
| pro 15 | 12,882 | 29,907 | **−17,025** | Yes (twice) |

For steps without a restart, the error is within 10 seconds; with a restart, it differs by several hours. The pattern is very clean.

### Total

| | Total reported step duration | Actual wall clock | Deducted | Equivalent cost |
| --- | ---: | ---: | ---: | ---: |
| pro | 35.9 hours | 52.6 hours | 16.8 hours (32%) | About 34.4 ten-thousand USD |
| flash | 40.1 hours | 47.9 hours | 7.6 hours (16%) | About 7.8 ten-thousand USD |

### Impact

- The per-step cost estimated using "cost per second × `timing_s/step`" is a **lower bound**. The actual cost of pro step 15 is about 17.1 ten-thousand USD,
  calculated from the reported value, it is only 7.4 ten-thousand USD.
- A flat curve does not mean this step ran fast; it may just be that the restart period was not counted.

---

## 2. The first step after a restart has systematic bias in all metrics

### Phenomenon

From the sampling logs, when pro resamples after a restart:

| Time (UTC) | Tasks collected | Pass rate |
| --- | ---: | ---: |
| 11:50 | 48 | 0.384 |
| 12:10 | 376 | 0.483 |
| 12:30 | 872 | 0.523 |
| 13:51 | 2,664 | 0.580 |

Right after the restart, the pass rate is only 0.384, while the normal level is 0.59~0.60; it only recovers as sampling progresses.

### Cause

The sandbox is re-warmed; the first to finish are often short tasks, while long tasks are still in progress,
so early samples have systematic bias along the "task length" dimension.

### Impact

For the first step after a restart, its pass rate, context length, and staleness generations cannot be directly compared with a normal step.
At the bottom of the "batch composition" panel, the dashboard has a small note warning about similar issues, but it does not say which metrics are affected.

An example: the final score of pro step 15 is 0.6172, which looks higher than 0.6152 at step 14,
but its average context drops from 10.6 ten-thousand back to 9.1 ten-thousand, and the staleness generation is 0.
This step is not comparable with the steps before and after; look at step 16.

---

## 3. The "trainer-inference engine divergence" on the homepage is a weighted average, not a single quantity

### Phenomenon

`train_infer_diff/new_infer/kl` rises from 0.0022 to 0.0094, which looks like the engine precision is deteriorating.

### Reality

Under the `partial/` namespace, the dashboard splits the same set of metrics into 8 buckets by data freshness
(`partial/0/...` to `partial/7/...`). The global value is the weighted average of these buckets:

```
Global KL = Σ (token share of bucket k × KL of bucket k)
```

This holds for all 15 steps of pro and all 20 steps of flash, within 2% error.

KL on fresh data (bucket 0) slowly climbs from 0.0022 to 0.0034, an increase of less than 20%;
The global value rises two to three times; the entire difference comes from the data getting stale.

### A natural experiment

Because of the restart, pro step 15 used 100% fresh data; for this step:

- Bucket 0 KL = 0.00258
- Global KL = 0.00258

The two are equal. When all data is fresh, the global value equals the fresh value.

### Impact

- Looking only at the front-page curve leads to the wrong conclusion that "engine precision is deteriorating".
- The correct alert line is **bucket 0's KL breaking through 0.004**.
- Global KL should be read as a "data freshness gauge".

---

## 4. `env/total_setup` and `env/total_error` are cumulative values since the last restart

### Phenomenon

`env/total_setup` in pro's step 11 drops from 330,720 back to 22,629;
`env/total_error` goes from 158 to zero at the same position.

### Conclusion

They are not per-step quantities, but cumulative quantities, and **they reset to zero on every restart**.
To use them you must difference them yourself, and differencing across restarts is meaningless.

The dashboard gives no explanation for these two fields.

---

## 5. Do not treat several fields that are identically 0 as proof of health

The following fields are exactly equal to 0 in all steps of both training runs:

| Field | Description |
| --- | --- |
| `actor/pg_clipfrac` | The clipping ratio of standard PPO should not be identically zero |
| `actor/ppo_kl` | Same as above |
| `actor/update_skipped` / `actor/skipped_iter` | It may really not have happened |
| `train/verdicts/dropped_zero_adv` | It may really not have happened |
| `env/possible_leak` | The check may not be implemented |
| `penalty/action/adv_reduction_total` | Exactly identical to `adv_*_sum_pre/post_penalty`, corroborating each other |
| `select_r2_capped` / `keep_mass_capped` / `rollouts_masked` / `select_r3_gold_fails` | Protective upper limit, never triggered |

Being identically zero has two possible explanations: it really did not happen, or this counter was never assigned.
**The site does not explain this, and from the numbers alone it cannot be distinguished.** So do not use them to conclude that "training is very healthy."

---

## 6. Single-step noise is larger than expected; adjacent steps can differ by 2 percentage points

Pass rates of adjacent steps for flash:

| step | avg@n | All-wrong proportion | Average reward |
| ---: | ---: | ---: | ---: |
| 18 | 0.6023 | 0.1587 | 0.5767 |
| 19 | 0.6262 | 0.1356 | 0.5721 |
| 20 | 0.6071 | 0.1576 | 0.5713 |

At step 19 it once looked like the "15% all-wrong wall" had loosened, and at step 20 it bounced back.
A single-step difference of ±2 percentage points is within the normal range.

Offline evaluation (DeepSWE) has larger noise; a single step can jump 6 points.

**Conclusion: any "trend" counts only if it goes in the same direction for at least three consecutive steps.**

---

## 7. Different metrics have different definitions and cannot be treated as the same thing

| Metric pair | How much they differ | Description |
| --- | --- | --- |
| `dynsam/avg@n` vs `train/passrate/avg_passrate` | About 3 percentage points | The former is computed on the sampling pool, the latter on the batch that enters training |
| `dynsam/passrate/zero` vs `train/passrate/passrate_0_ratio` | 0.15 vs 0.06 | The former includes those filtered out, the latter is what actually enters training |
| `critic/rewards/mean` vs `critic/score/mean` | Exactly the same | In this system, score and reward are the same thing |
| `timing_s/step` vs actual wall clock | With restarts, it differs by several hours | See item 1 |

Fields like `train/passrate/passrate_0_ratio` whose names contain `ratio`, judging from numerical monotonicity, are cumulative in definition
(the per-step increment decreases, consistent with a running average), but the site does not explain it, so this point is doubtful.

---

## 8. The definition of `partial/i/n_tokens` is unclear

The sum from `partial/0/n_tokens` to `partial/7/n_tokens` is only about half of `perf/total_num_tokens`.
It is unknown which part it counts (it may count only the carried-over portion of trajectories).
The definition of `partial/i/frac` is certain (`Σ i × frac_i` exactly equals `partial/avg_staleness`),
But `n_tokens` is not.

**Recommendation for use:** To compare the relative sizes of buckets, you can use `frac`, but do not use the absolute value of `n_tokens`.

---

*This note is based on 15 snapshots from 2026-09-17 18:50 to 23:11 (Beijing time).*
