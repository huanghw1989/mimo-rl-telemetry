# Metric credibility audit: which numbers cannot be trusted, why, and how to verify them yourself

**One-sentence conclusion: of pro's 1944 metrics, 311 (16.0%) can be discarded outright, and 259 are "reported 0 but actually have no data or were not triggered";
Spot-checking the measured numbers in 12 Chinese explainers, 9 hold only within the old writing window, and 3 do not match; additionally, 3 classes of bad data that no one had previously pointed out were newly identified.**

> Material identity: **our own measurements**. Data comes from the local telemetry repository `data/store/` (pro 24 steps, flash 30 steps, snapshot time 2026-09-18).
> All numbers were computed on the fly from the raw series by `bun src/audit_report.ts` and written out
> `analysis/zh-CN/numbers/A3-audit-numbers.json`, without relying on any manually entered conclusions.
> This paper only addresses "whether the data itself is trustworthy" and does not repeat the pitfalls already spelled out in `docs/en/06-pitfalls-when-reading-the-dashboard.md`;
> For the parts overlapping with that note, this paper fills in its scale, boundaries, and recomputation criteria.

---

## Abstract

This time I went through all `series` metrics of the two runs on the dashboard one by one: pro has 1944 series (`tags` lists 2029 metric names,
of which 85 have no data from beginning to end), flash has 1974 series (lists 2062, 88 empty), with stepwise fill rates of 92.1% / 92.6%.
In addition, the 109 Chinese explainers in `content/metrics.json` were treated as a comparison set, and the measured numbers they cite were checked one by one.

Total hits:

| Category | pro | flash |
| --- | ---: | ---: |
| Can be discarded outright (all empty or constant-valued) | 311 (16.0%) | 290 (14.7%) |
| Relaxed to "only two values" also discardable | 362 (18.6%) | 314 (15.9%) |
| "Reported 0" (reported but exactly 0 in ≥90% of steps) | 259 | 230 |
| Coverage < 50% | 139 | 139 |
| Exact/affine duplicate clusters | 151 clusters, of which 133 are credible | 151 clusters, of which 136 are credible |
| Adjacent-step change ≥10× | 214 | 215 |
| Breakpoint count (adjacent-step jumps) | 286 | 610 |
| Breakpoints can be explained by restart/version switch/announcement | 43.0% | 44.4% |
| Metric names present in the data but not covered by any explainer | Both runs total 1796 (10.6% coverage) |  |

**The three most dangerous ones** (all newly identified this time, not a "second look"):

1. `train/passrate/passrate_0_ratio` and `train/passrate/passrate_1_ratio` (with ratio in the name,
   look like "this step's ratio") but are actually **cumulative averages**. In flash's 30 steps they are strictly monotonically increasing, with increments always positive;
   pro has one large drawdown each at steps 15 and 23. Reading it as a per-step ratio yields a conclusion with the completely opposite direction.
2. The exact 0s in `train/passrate/avg_passrate/visual/dataset-ol8x` and `.../dataset-gtav`
   are not "pass rate 0%", but **not sampled**. pro has 7 zero-value steps, flash has 5; the zero-value step sets of the two datasets
   completely identical, and with "the `partial/.../1/frac` of this dataset is null" and "`num_accepted/step` is exactly equal to `held`"
   The three are strictly aligned with each other. This is three types of signals pointing to the same thing, no longer "suspected".
3. `ctx_total_length/max` (the maximum total length of a single trajectory) has **two truncation caps**: most metrics repeatedly take
   1048570 (≈2²⁰), but `code/dataset-4onq` repeatedly takes 262144 (=2¹⁸), and flash's chat-type datasets also take
   262144. Using this metric to compare "who has stronger long-context ability" compares two different sets of truncation thresholds.

In addition, `partial/<k>/n_tokens` (token count bucketed by data freshness) appears on old buckets as
a repetition of "global, agentic slice, and a certain dataset slice, three different scopes reporting the same number", indicating that this family is not broken down by slice on old buckets.

---

## 1. Identity and derived metrics: not bad data, but they pollute any correlation leaderboard

### 1.1 A set of metrics with the same name at different levels is actually the same curve

**Observation.** Correlate every pair of metric series (requiring at least 6 overlapping steps); among the 1252011 candidate pairs in pro,
142 pairs are **value-by-value completely identical (including null positions)**, 48 pairs are exactly linear, 6 pairs are approximately linear; flash is 150 / 24 / 9 pairs.
After merging with union-find, the two runs each yield 151 duplicate clusters; after removing sparse clusters whose "values are almost all 0 or have values in only a few steps",
pro is left with 133 trustworthy clusters (covering 274 metrics), and flash is left with 136 (covering 278).

Typical clusters:

- `critic/advantages/max` = `critic/agentic/advantages/max` = `critic/returns/max` =
  `critic/agentic/returns/max` (the maximum advantage, the maximum return, and the same-named quantity in the agentic slice; the four are exactly the same).
- `critic/rewards/min` = `critic/score/min` = `critic/agentic/rewards/min` = `critic/agentic/score/min`。
- `critic/rewards/mean` = `critic/score/mean` (this was already written in the previous note; this time it is confirmed to still be exactly equal on 24/30 steps).
- For each dataset, `critic/<cat>/dataset-<id>/rewards/min` = the `score/min` of the same dataset.

**Why.** In this system, "reward" and "score" are the same quantity (`critic/rewards/*` and `critic/score/*` are value-by-value equal),
"returns" and "advantages" happen to also take the same batch of trajectories at the max/min quantiles. Thus the same physical quantity has been copied into
multiple tags. When doing correlation analysis, these tags push each other's correlation coefficient to 1.0, crowding out genuinely informative relationships.

**Verification method.**

```
bun src/audit_report.ts
```

See the "exactly identical / affine exact / duplicate clusters" row in section [1] of the output, as well as in the JSON
`identity.<run>.clustersTop[].members` (member list of each cluster) and
`identity.<run>.examples.identical` (pair-by-pair list). To manually recheck any pair, just compare the two arrays directly.

**Impact.** Any "metric correlation leaderboard" must first collapse these 133 (pro) / 136 (flash) high-confidence clusters into one representative each.
Direct sorting will put same-value pairs like `critic/rewards/mean` and `critic/score/mean` at the very top, making them look like the "strongest relationships",
when in fact they are just copy-paste.

An additional pitfall: the correlation scan itself can be fooled by **sparse series**. For example, `ctx_total_length/visual/dataset-ol8x/clip_ratio`
has 23 of 24 steps equal to 0, with only one nonzero value, and it will be "perfectly correlated" with another series that is likewise almost all 0.
The script marks such clusters separately as `sparse`: among the 151 clusters in pro, 18 are this kind of spurious duplication, and 133 are trustworthy (covering 274 metrics);
flash 15 / 136 (covering 278). **This kind of scan must add sparse filtering; otherwise the conclusions will be drowned by 0s.**

### 1.2 `ctx_total_length = prompt + response` holds only on `/mean`

**Observation.** Check this additive relationship quantile by quantile:

| Quantile | pro max relative error | flash max relative error |
| --- | ---: | ---: |
| `mean` | 6.3e-6 | 7.0e-6 |
| `max` | **0.645** | **0.684** |
| `min` | **0.947** | **0.925** |

The `mean` one is still exact on 24/30 steps (the error magnitude is just the rounding caused by the site providing only 6 significant digits).
But `max` and `min` differ by tens of percentage points.

**Why.** `max(总长)` takes one trajectory, while `max(prompt)` and `max(response)` take two other trajectories,
the three maxima are generally not on the same trajectory, so their sum does not equal the maximum of the total length. This is a mathematical fact, not a data error—
but the dashboard displays the three families `ctx_total_length/*`, `ctx_prompt_length/*`, and `ctx_response_length/*` side by side,
making it easy to think they can be added or subtracted with each other.

**Verification method.** For the same quantile, subtract the three series step by step: in script `identity.<run>.curated`,
the `ctx_total_length/<stat> = ctx_prompt_length/<stat> + ctx_response_length/<stat>` row gives
`maxAbs` and `maxRel`. When manually recomputing, note that the error upper bound of `mean` is rounding at the level of 1 token.

**Impact.** Using `max` or `min` to estimate the "context budget" will be wildly wrong (on pro, a single step can differ by 670k token).
To break down the context composition, you can only use the `mean` family.

### 1.3 `perf/total_num_tokens ≈ 1568 × 16 × ctx_total_length/mean` is an approximation, not an identity

**Observation.** It holds for all steps, but the deviation is systematically negative: pro 24 steps deviate −0.15%~−1.17% (average 0.42%),
flash 30 steps −0.29%~−2.69% (average 0.71%). The three steps with the largest error are flash steps 16, 17, and 18.

**Why.** 1568 is the number of problems per step (`dynsam/num_target`), and 16 is the number of sequences sampled per problem.
The product is a "theoretical upper bound"; some of the sequences that actually enter training are judged invalid or discarded, so the real token count is always slightly lower.
Steps 16 and 17 are anomalous because flash reran on these two steps (there are two step events each in `events`),
and the batch composition differs from the other steps.

**Verification method.** The `perf/total_num_tokens ≈ ...` in `identity.<run>.curated` gives `minRel/maxRel/meanRel`.
Single-step recheck: `系列[perf/total_num_tokens][i] / (1568*16*系列[ctx_total_length/mean][i]) - 1`.

**Impact.** Treating it as an identity to "verify whether the data was read incorrectly" will keep raising false alarms; conversely, when the deviation suddenly jumps from 0.4% to 2.5%
(this is the case for flash step 16), it indicates that the batch composition of this step is anomalous and deserves a separate look.

### 1.4 `partial/<k>/n_tokens` is not broken down by slice on old buckets

**Observation.** For pro's buckets 4~7 and flash's buckets 4~9, `partial/<k>/n_tokens` (global),
`partial/agentic/<k>/n_tokens` (agentic slice), `partial/code/dataset-yfch/<k>/n_tokens` (single-dataset slice)
are **value-by-value completely identical** (including null positions). Yet the `frac` of these three differ from each other. Buckets 0~3 do not have this phenomenon.

**Why.** Three slices with different scopes reporting the same absolute count cannot physically all hold at the same time (unless the three are the same set).
The most reasonable explanation is that per-slice counts for old buckets were not counted separately and fell back to the global value. The dashboard does not explain it.

**Verification method.** Directly compare whether the three arrays are value-by-value equal:

```
bun -e 'const s=require("./data/store/runs/flash/series.json");
for (const k of [3,4,5]) console.log(k,
  JSON.stringify(s[`partial/${k}/n_tokens`])===JSON.stringify(s[`partial/agentic/${k}/n_tokens`]),
  JSON.stringify(s[`partial/${k}/n_tokens`])===JSON.stringify(s[`partial/code/dataset-yfch/${k}/n_tokens`]));'
```

(`require` for JSON requires Bun's parser, or you can directly use `Bun.file(...).json()`.)
In the JSON, the corresponding clusters in `identity.<run>.clustersTop` that start with `partial/<k>/n_tokens`.

**Impact.** Half of the absolute values of `partial/<k>/n_tokens` already do not add up (item 8 of the previous note),
It can now be further stated: **per-slice splits of old buckets are unusable; only `frac` is usable**. Any "how much a given dataset accounts for in stale data"
analysis will, on buckets ≥4, yield a spurious "exactly the same".

---

## II. Identically zero and constant columns: how many of the 1944 / 1974 metrics can be discarded directly

**Observation.** Classified by "number of distinct values" (state the threshold clearly, because the sample is only 24 / 30 points):

| Category | Criterion | pro | flash |
| --- | --- | ---: | ---: |
| All empty | 24/30 steps are all null | 0 | 0 |
| constant 0 | Non-null values are all exactly 0 | 226 | 204 |
| Identically 1 | Non-null values are all exactly 1 | 69 | 69 |
| Other constants | Only one non-null value, and it is not 0/1 | 16 | 17 |
| Two values | Exactly two distinct values | 51 | 24 |
| Total | All empty + constant | **311（16.0%）** | **290（14.7%）** |
| Total (relaxed) | Plus "two values" | **362（18.6%）** | **314（15.9%）** |

**Answering that question: of pro's 1944, 311 (16.0%) can be discarded directly; of flash's 1974, 290 (14.7%).**
If one accepts that metrics with "only two values and no intermediate state between the two values" are of no value for trend analysis, then relax to 362 / 314.

**Why.** The largest source of identically 0 is protective counters and "never triggered" branches in the grading pipeline:
`penalty/stage_credit_group` as one family alone accounts for 139 identically 0 in pro and 123 in flash.
The second largest source is `actor/*/pg_clipfrac` and `actor/*/ppo_kl` (25 tags each) — these two quantities in
all steps of both runs are reported as numeric 0, not null. The largest family of identically 1 is
`critic/*/rewards/max` and `critic/*/score/max` (at least one full-score trajectory at every step),
as well as `penalty/stage_credit_group/*/pass2_success_rate`, `train/harness/*/training/nonzero_adv_rate`
(the "non-zero advantage rate" of a batch of harnesses is identically 1).

**Verification method.** Section 【2】 of the script directly gives the count of each class and the distribution by family;
In the JSON, `constants.<run>.const0ByFamily`, `.const1List`, `.constOtherList`, `.twoValuedByFamily`.
Recomputing entry by entry is `new Set(series[tag].filter(Number.isFinite)).size`.

**Impact.** Do not take "identically 0" as evidence that "training is very healthy" (the previous note already warned about this);
What is added here is the scale — it accounts for 1/6 of all metrics; any statement of "total number of metrics" "number of anomaly-detection dimensions" must first subtract this batch.
The non-zero constants in `constOtherList` are more noteworthy: `actor/num_zeros_in_grad_encoders` in pro's 24 steps
is exactly equal to 294705000 and has never changed once (see Section 7 for details).

---

## III. Coverage and "reporting 0": missing and reporting 0 are two different things; reporting 0 is more dangerous

**Observation.** Coverage distribution (steps where the metric has a value / total steps):

| Coverage interval | pro | flash |
| --- | ---: | ---: |
| [0, 0.1) | 30 | 16 |
| [0.1, 0.25) | 36 | 54 |
| [0.25, 0.5) | 73 | 69 |
| [0.5, 0.75) | 119 | 75 |
| [0.75, 0.9) | 3 | 61 |
| [0.9, 1] | 1683 | 1699 |

Metrics with coverage < 50%: 139 in pro, 139 in flash. The low-coverage families are almost all high-numbered buckets of `partial/`:
`partial/7` (pro, average 8%), `partial/9` (flash, average 17%), `partial/6`, `partial/8`, etc.

**Why.** `partial/<k>/` is a statistic "bucketed by data freshness"; the larger the bucket number, the older the data.
High-numbered buckets appear only after training has run continuously for many steps, so they naturally have values only in the last few steps — **this is by design, not missing data**.
The true "supply cutoff" is another category: 218 metrics in pro never report again after a certain step (tail cutoff),
177 in flash; 186 metrics in pro have holes in the middle, and 274 in flash.

**Verification method.** Section 【3】 of the script gives the histogram, families with <50%, cutoff families, and families with holes in the middle;
In the JSON, `coverage.<run>.hist`, `.below50Families`, `.trailingCutByFamily`, `.interiorMissingByFamily`.
Manually inspect a given metric: `arr.map(v => v===null)` to see whether the positions of null are "only at the tail" or "also in the middle".

**"Reporting 0" counted separately.** Metrics that are reported (non-null) but are exactly 0 for ≥90% of steps: 259 in pro, 230 in flash.
By family:

| Family | pro | flash |
| --- | ---: | ---: |
| `penalty/stage_credit_group` | 144 | 127 |
| `actor` | 56 | 57 |
| `critic` | 28 | 19 |
| `ctx_total_length` (`clip_ratio` for each dataset) | 18 | 13 |
| `train` | 8 | 8 |
| `penalty/action` | 3 | 3 |
| `penalty/signed` | 2 | 2 |
| `env` | 0 | 1 |

**Impact.** These 259 / 230 metrics all pass the "missing value check" (they have values) and all pass "whether there is an anomaly"
(the value is 0). They are the batch most easily silently ignored. Either explicitly write "this family currently does not work", or remove it from the dashboard.
Among them, `ctx_total_length/<cat>/dataset-<id>/clip_ratio` (proportion of trajectories truncated for a single dataset) is especially worth listing separately:
18 of pro's 25 datasets, and 13 of flash's 25, have ≥90% of steps exactly 0; the remaining one or two non-zero values are often
on the order of "one trajectory" (1e-3 order), which is more like "the long tail has not accumulated yet" rather than "there is no truncation".

### 3.1 Exact 0 for ol8x / gtav: three types of signals align strictly and can be characterized as an "unsampled sentinel"

**Observation.** `train/passrate/avg_passrate/visual/dataset-ol8x` and `.../dataset-gtav`
(per-step average pass rate for these two datasets) both show exact 0 in both runs:

- pro: each of the two datasets has 7 zeros, with step numbers all **1, 2, 3, 11, 15, 17, 23** (the two sets are exactly the same).
- flash: 5 zeros each, with step numbers all **1, 3, 16, 25, 28** (likewise the same).

On this same set of steps, two other things happen at the same time:

- `partial/visual/dataset-<id>/1/frac` (this dataset's share in the "stale 1 generation" bucket) is **null**;
- `dynsam/visual/dataset-<id>/num_accepted/step` (number of accepted tasks at this step) is exactly equal to
  `.../num_accepted/held` (task pool holdings).

The step-number sets of the three **are exactly identical** (the script checks cell by cell; all four datasets in pro/flash are `true`).

**Why.** The accepted count equals the holdings, meaning that at this step this dataset's task pool has no net consumption; the corresponding `partial/.../1/frac`
is null, meaning that at this step no data at all enters training. In this case "average pass rate" has no denominator,
The correct value is null. It was actually written as 0, so 0 is read as "not a single one was done correctly at this step".
In terms of timing, these 7 steps in pro coincide exactly with the restart steps in `events` (restarts fall on
1(×2), 2, 3, 11, 15(×2), 17(×2), 23(×2)), and the 5 steps in flash are 4 restart steps plus step 1 (the run's initial step).
**The two datasets share the same set of zero-valued steps, indicating that this is report behavior occurring per step, not a data problem of these two datasets themselves.**

**Verification method.** Section 【11】 of the script lists the step numbers of the three things side by side, and gives `alignedWithBucket1Null` /
`alignedWithStepEqHeld` two boolean values. Manual recomputation:

```
For each step i:
  zero   = series["train/passrate/avg_passrate/visual/dataset-gtav"][i] === 0
  noData = series["partial/visual/dataset-gtav/1/frac"][i] === null
  flat   = series["dynsam/visual/dataset-gtav/num_accepted/step"][i]
           === series["dynsam/visual/dataset-gtav/num_accepted/held"][i]
The three boolean values should be completely consistent (pro 7 steps / flash 5 steps).
```

**Impact.**

- The pass-rate curves of these two datasets are broken at restart steps, not "dropping to 0". Any reading of "quality crashing after restart" is wrong.
- When computing the "average pass rate of vision datasets", these 0s pull the mean down. Among the 6 vision datasets at step 15 in pro,
  averaging as-is gives 0.4420; after excluding these two "no-data" 0s, it is 0.6630 — **a difference of 22 percentage points**.
  The differences at steps 2, 17, and 23 are 20.7, 20.9, and 23.7 percentage points, respectively. A deviation of this magnitude is enough to change the conclusion.
- Conversely, if one uses "the three signals agree" as a detector, it can be used to **find restart steps without relying on `events`**:
  pro is {1,2,3,11,15,17,23}, flash is {1,3,16,25,28}.

---

## 4. Sentinel values: besides 0 and 1, there are also "repeatedly occurring round large numbers"

**Observation.** Using "some round value (exact 0, exact 1, integer powers of 2, integer powers of 10, close to these values) among reported steps
with proportion ≥50% and the metric is not constant" as the criterion, pro hits 78 metrics, flash 77. Besides ol8x/gtav in 3.1,
Two other categories are worth listing separately:

1. **Repeatedly occurring two-valued "counters"**. For example
   `penalty/stage_credit_group/harness/harness-A/groups_judged_after_drop`
   in pro, 23 of the 24 steps are 0, only 1 step is 1; flash's
   `actor/chat/dataset-eup7/pg_tis_clipfrac_pos_high`: 29 of 30 steps are 0, the only non-zero is 7.6e-8.
   The "mean", "trend", and "correlation" of such sequences are all meaningless.
2. **Long-context metrics hitting the ceiling**. `ctx_*_length/*/max` has 7 metrics in pro and 10 in flash
   repeatedly take some round large value, and that value is exactly the maximum of that metric over the entire period:

| Ceiling tier | pro hit metrics | flash hit metrics |
| --- | ---: | ---: |
| 1048570 (≈2²⁰, i.e. 2²⁰−6) | 5 (global `ctx_total_length/max` 11/24 steps, `ctx_total_length/agentic/max` 11/24, `code/dataset-yfch/max` 9/24, etc.) | 7 (`ctx_total_length/cyber/dataset-9aui/max` 13/30, global 15/30, etc.) |
| 262144（=2¹⁸） | 2: `chat/dataset-lm3t/max` 7/24, `code/dataset-4onq/max` 16/24 | 3: `chat/dataset-lm3t/max` 14/30, `code/dataset-4onq/max` 25/30, `chat/dataset-eup7/max` 6/30 |

**Why.** Most of the 0s in the first category are "this branch was not triggered"; 0 is a true value but does not mean "proportion zero".
The two round values in the second category are both close to integer powers of 2, typical truncation thresholds (token limits). The coexistence of the two tiers shows
**Different datasets/different modules have different truncation lengths**: most go with 2²⁰, `code/dataset-4onq` and some chat datasets go with 2¹⁸.

**Verification method.**

```
bun src/audit_report.ts    # see sections 【4】 and 【12】
```

In JSON, `sentinels.<run>.sentinelCandidates` (for each candidate gives value, occurrence count, number of reported steps, proportion, other values),
`caps.<run>.tiers` (tiered by ceiling value). Manually recheck a metric:

```
const a = series["ctx_total_length/code/dataset-4onq/max"].filter(Number.isFinite);
a.filter(v => v === 262144).length / a.length      // should be ≈ 0.67 (pro)
Math.max(...a) === 262144                          // true, indicating it is the upper limit
```

**Impact.**

- Using `ctx_total_length/<cat>/dataset-*/max` to compare long-context ability between datasets compares two sets of thresholds.
  `code/dataset-4onq`'s ceiling is one quarter of the others', so it is always "shorter" on the chart; this has nothing to do with model ability.
- A more important detail: **1048570 is not a hard ceiling.** In flash's `ctx_total_length/max` there are
  1049640, 1048610, 1048690, 1054990 are four values above it, plus 2236430 at step 14 (about 2.13 times the ceiling).
  pro also has values above 1.05 million. So the assumption "this quantity is necessarily ≤ 2²⁰" is wrong; it cannot be used as a data validation rule.
- `actor/num_zeros_in_grad_encoders` is identically equal to 294705000 (pro 24 steps; flash does not have this tag).
  It is neither a power of 2 nor a power of 10, but it never changed even once. See section 7.

---

## 5. Scale and units: many jumps, but the true out-of-bounds count is 0

### 5.1 There are 214 / 215 metrics with ≥10× change between adjacent steps, the vast majority are bucketing structure

**Observation.** pro 214, flash 215 metrics change by more than 10× between adjacent two steps. The largest change factors:

| Metric | Change | Step |
| --- | --- | ---: |
| flash `partial/visual/dataset-ve5o/0/n_tokens` | 1629 → 57318600（×35186） | 16 |
| flash `partial/visual/dataset-ve5o/0/frac` | 0.0000299 → 1（×33398） | 16 |
| flash `partial/code/dataset-yfch/0/frac` | 0.0000913 → 1（×10948） | 16 |
| pro `critic/code/dataset-zg6q/advantages/mean` | 3.49e-6 → −0.007698 (×2206, sign flip) | 9 |
| pro `partial/visual/dataset-ve5o/0/n_tokens` | 50424 → 58943500（×1169） | 23 |

**Why.** Most are "bucket just opened": in `partial/<slice>/<k>/{frac,n_tokens}`, a staleness bucket before this step
had no data (`frac` extremely small or null), and this step suddenly has data, so `frac` jumps from ~0 to close to 1.
This is a normal start of bucketed statistics, not an anomaly. After excluding by this criterion, the jumps pro really needs to look at are 194,
flash 186 — still many, most of which are "quantities close to 0 flipping in sign or magnitude"
(e.g., the above `critic/*/advantages/mean`, flipping from the −1e-5 level to the −1e-2 level).
Relative changes of such quantities are meaningless; **look at absolute changes**.

**Verification method.** script section [5] lists the jump list; in JSON, `scale.<run>.jumps[].bucketOpen`
marks which ones belong to "bucket opening". Manually recheck a metric: find the ratio of adjacent two steps, then see whether the two steps'
`partial/.../frac` changed from null/extremely small to 1.

**Impact.** Using "change by more than 10×" as an anomaly alarm line yields more than 200 alarms, which is equivalent to no alarms.
Either filter out the bucket family first, or switch to "absolute change / the metric's own MAD" (see section 6).

### 5.2 Out-of-bounds check: no out-of-bounds for proportion-type metrics, no negative numbers for count-type metrics

**Observation.** For metrics whose names end with `frac`, `ratio`, `rate`, `share`, `pct`, `clipfrac`, `zero`, `one`, `mid`
check whether they fall outside [0,1]; for metrics whose names contain `num_`, `n_tokens`, `count`, `rollouts`, `groups`, `tokens`
check whether they are negative. **Both runs have 0 out-of-bounds.**

`ctx_total_length/clip_ratio` (proportion of truncated trajectories) has max 9.18e-4 in pro and max 3.10e-3 in flash, neither reaching 1.
`actor/clip_high` / `actor/clip_low` (the clipping lower and upper bounds of the PPO ratio) are 0.27 and 0.2 respectively across all steps of the two runs.

**Why.** The site clearly clamps before writing logs, or these quantities themselves cannot go out of bounds.
"No out-of-bounds" is itself a useful conclusion: it means **if out-of-bounds ever appears, something truly went wrong**,
you can safely treat it as a hard alarm line.

**Verification method.** The last two lines of script section [5] give the count of `outOfRange` and the range of `clip_ratio`;
in JSON, `scale.<run>.outOfRange` (an empty array means none), `.clipRatio`, `.clipBounds`.

**Impact.** This is positive evidence that "the data is not broken", worth writing into the validation script — it is stronger than "looks normal",
because it is decidable.

---

## 6. Structural breakpoints: pro's claim that "step 15 has the most" no longer holds

**Criterion.** For each metric, take the difference between adjacent two steps `Δ`, and use the median absolute deviation of this metric's own differences
(MAD, median absolute deviation, a measure of fluctuation insensitive to outliers) as the scale:
`|Δ| / (1.4826 × MAD) > 8` and relative change > 5% is recorded as a breakpoint. The advantage of this is that each metric is scaled according to its own
normal fluctuation, and will not falsely report stable small quantities the way "change by 10×" does.

**Observation.** pro has a total of 286 breakpoints, flash 610. The steps with the most breakpoints:

| | Top 6 by raw count | Top 6 after dividing by the number of comparable metrics at that step |
| --- | --- | --- |
| pro | 14:29、22:29、23:29、15:24、21:24、7:16 | 23:1.66%、22:1.60%、14:1.60%、15:1.44%、21:1.34%、20:0.91% |
| flash | 25:60、3:42、30:39、29:35、28:33、16:32 | 25:3.29%、3:2.45%、30:2.24%、29:2.06%、28:1.92%、16:1.89% |

**Independent verification conclusion:**

- On the flash side, "step 25 has the most breakpoints" **holds and is even more pronounced** (raw count 60, 1.4× the second place;
  after normalization 3.29%, 1.3× the second place). Step 25 indeed has two restarts falling in the same step interval.
- On the pro side, "step 15 has the most breakpoints" **no longer holds**. Step 15 now ranks 4th (24),
  Steps 14, 22, and 23 each have 29 tied for first. The reason is straightforward: the previous analysis was written when pro had only reached step 19,
  Steps 20~24 only appeared later, and steps 22 and 23 happen to sit exactly where the metric-set version changes from 2019 to 2029.

**"How many breakpoints can be explained by external events".** Define "a restart, a version-number switch, or an announcement occurred within this step's interval"
as an event step. pro has 11 event steps (1,2,3,11,15,16,17,18,20,23,24), and breakpoints falling on them are 123/286 = **43.0%**;
flash has 9 (3,16,19,20,21,25,26,27,28), and breakpoints falling on them are 271/610 = **44.4%**.
**That is, more than half of the breakpoints have no corresponding external event.**

The steps with the most breakpoints and no external event:

- pro: 14 (29), 22 (29), 21 (24), 7 (16), 6 (14), 19 (11).
- flash：30（39）、29（35）、2（30）、4（29）、17（24）、24（21）。

**Why.** Breakpoints are concentrated in a few steps. Some come from restarts (after a restart there is re-warming up, and the sampling distribution changes,
the mechanism was already covered in item 2 of the previous note); some come from version switches (new tags appear, old tags disappear, and the metric set changes);
The remaining large part is the **sparse structure of the metrics themselves**: many metrics only have values at some steps, and once the value pair of the previous step/this step
appears on the boundary of "a bucket having just opened", a breakpoint is recorded.

**Verification method.** Script section [6] gives the raw breakpoint count per step, the normalized breakpoint count, the event-step list,
and the gap table for "wall clock vs reported duration". In the JSON, `breakpoints.<run>.counts` (per-step counts),
`.ranked`, `.rankedRate`, and `eventAlignment.<run>.intervals` (each step interval's
`restarts` / `notices` / `versions`）。

Manually recompute the breakpoint count for a given step: for each metric compute the `Δ` sequence, MAD, then count `|Δ|/(1.4826MAD) > 8 && rel > 0.05`.

**Impact.** Treating "the most breakpoints" directly as "something went wrong at this step" does not hold: 44% of breakpoints have a corresponding event,
and the other 56% need other signals (such as the triple alignment in 3.1, or the wall-clock gap below) to distinguish.

### 6.1 flash step 25: two restarts map to the same step, wall clock exceeds reported by 4.5 hours

**Observation.** Map each restart event's timestamp onto "the first step whose completion time is later than it":

| run | The step that a restart maps to | Multiple restarts within the same step |
| --- | --- | --- |
| pro | 1(×2)、2、3、11、15(×2)、17(×2)、23(×2) | 1、15、17、23 |
| flash | 3、16、25(×2)、28 | 25 |

The interval wall clock for flash step 25 is 7.51 hours, while `timing_s/step` reported only 3.02 hours, a difference of 4.49 hours.
The breakpoint count for this step (60) is also the highest overall.

**Why.** `timing_s/step` does not include restart waiting (item 1 of the previous note), and step 25 has two restarts crammed into it,
so the entire gap shows up in this step. The average step is about 1.6~2.5 hours, and 7.51 hours amounts to compressing the wall clock of three steps into one step number.
The dashboard draws this step as a single point, but it actually spans the time of three "normal steps".

**Verification method.** The last subsection of script section [6] directly lists the four columns "wall clock, reported, gap, restarts within interval",
sorted by gap. Manual recomputation: take consecutive step-event timestamps in `events` and subtract them to get the wall clock,
subtract `series["timing_s/step"]` to get the gap.

**Impact.** Any "per unit time" derived quantity for flash step 25 (tokens per second, cost per hour, throughput) is incomparable;
this step's `partial/0/frac` (fraction of fresh data) is instead 0.844, different from pro step 15's 1.000 "all fresh",
so one also cannot simply apply the rule "restart step = all fresh".

---

## 7. Metric lifecycle and semantic drift: neither of `tags.json`'s two timestamps can be used directly

### 7.1 `first_seen` is rewritten, `last_seen` all equal the latest sync

**Observation.** In pro's `tags.json`, the `first_seen` of 2029 metrics has only three values:
2011 are 1789642198 (the moment telemetry first recorded), 5 are 1789706684, and 13 are 1789787223.
`last_seen`, however, has **all 2029** equal to the most recent sync time. flash is the same: 2040 / 7 / 15, and `last_seen` is 2062/2062 all equal.

Further checking the repository's own history (`git show 1810150:...tags.json` compared with the current file) reveals that,
`partial/visual/dataset-gtav/{1/frac, 1/n_tokens, avg_staleness}`'s `first_seen` for three tags
in the old version was 1789642198 (first record), and now is 1789787223 (40 hours later).

**Why.** The update condition for `last_seen` is "the metric is still in the list during this sync round", and currently all tags are present,
so it degenerates into "the most recent sync time" and **cannot be used to find disappeared metrics**. That `first_seen` is rewritten indicates that it records
"the last time telemetry saw it appear", and metrics that disappear and come back midway get their timer reset. In addition, telemetry itself is
**left-truncated** (at the first sync, pro had already reached step 14), so metrics that appeared or disappeared before step 14 are completely invisible.

**Verification method.**

```
bun -e 'const t=await Bun.file("data/store/runs/pro/tags.json").json();
const f={},l={}; for(const v of Object.values(t.tags)){f[v.first_seen]=(f[v.first_seen]||0)+1;l[v.last_seen]=(l[v.last_seen]||0)+1;}
console.log(f,l);'
git show 1810150:data/store/runs/pro/tags.json > /tmp/old.json   # compare with the current file
```

Script section [7] directly prints two histograms.

**Impact.** Any "metric lifecycle" analysis can only reach two conclusions: metrics **added** midway (whose `first_seen` is later than the first record)
can be trusted, 18 for pro and 22 for flash; metrics that **disappeared** midway cannot be read directly from `tags` and must use the method below.

### 7.2 Infer disappearances by subtracting "the number of added metrics" from "the total number of metrics in the version": 8 for pro, 12 for flash

**Observation.** `tags.json`'s `versions` array records the total metric count `n` at each version switch.
Put together the "number added" between two adjacent versions (the number of tags whose `first_seen` falls within the interval) and the change in `n`:

| run | Version interval | n change | New | Inferred disappearances |
| --- | --- | ---: | ---: | ---: |
| pro | 14.7.0 → 15.8.15 | 0 | 0 | 0 |
| pro | 15.8.15 → 17.10.17 | 0 | 5 | **5** |
| pro | 19.10.17 → 22.12.23 | +10 | 13 | **3** |
| flash | 21.3.16 → 22.3.16 | +4 | 7 | **3** |
| flash | 22.3.16 → 26.4.25 | +6 | 15 | **9** |

In total, 8 disappeared for pro and 12 for flash.

**Why.** `n` is the total metric count returned by the site at that moment, and `first_seen` is the additions recorded by telemetry.
Subtracting the two gives "how many disappeared within this interval". **But the names of the disappeared metrics cannot be read out**—
`tags.json` only keeps metrics that currently exist; telemetry also did not store historical tag lists.

**Verification method.** The `removalByInterval` table in script section [7] gives `nFrom/nTo/delta/added/removed` interval by interval.
Note that this method is only valid for disappearances "after telemetry started recording" (pro from step 14, flash from step 19 onward).

**Impact.** Using it to explain "why a certain metric suddenly disappeared" is feasible;
but **which ones specifically** can only be guessed from external announcements and common sense. Two known matches:

- pro has 52 metrics whose last value is at step 14: 42 of them have `cyber` in their names (`actor/cyber/dataset-9aui/*`,
  `dynsam/cyber/dataset-9aui/*`, `env/cyber/dataset-9aui/active`, etc.), and the announcement
  "we also removed the cyber dataset from the upcoming pro run" (2026-09-17T12:20Z) matches.
  **But the remaining 10 are unrelated to cyber**: the 6 under `train/harness/harness-R/training/`
  （`advantage_mean`、`negative_adv_rate`、`nonzero_adv_rate`、`positive_adv_rate`、`rollouts`、
  `trained_rollout_share`), plus 4 scattered `partial/` bucket labels. The disappearance of these 10 has no announced explanation.
- flash has 4 metrics whose last value is at step 19 and are all empty for the next 11 steps: `penalty/signed/pos_scale_clamped`,
  `penalty/stage_credit_group/dev_neg_turns`、`.../end2end_success_rate`、`.../groups_attempted`。
  The disappearance of these four **also has no announcement at all**.

### 7.3 Semantic drift (a metric with the same name changed its definition): only 4 candidates were found, and none are "an overall change of order of magnitude"

**Phenomenon.** Search using two criteria: one is "using the version switch point as the boundary, the median ratio of the two segments before and after is ≥10 and their value ranges do not overlap",
the second is "cut the series into two segments arbitrarily, and find the cut where the median ratio is largest and the ranges do not overlap".

- By version switch: pro 0, flash 1.
- By arbitrary split: pro 0, flash 3.

All candidates:

| Metric | Cut point | Median change | Multiple |
| --- | --- | --- | ---: |
| flash `partial/visual/dataset-pt5v/2/n_tokens` | step 14 | 2026580 → 44953600 | ×22.2 |
| flash `partial/visual/dataset-pt5v/2/frac` | step 19 | 0.0568 → 0.7509 | ×13.2 |
| flash `ctx_response_length/general/dataset-trla/min` | step 6 | 349 → 3822 | ×11.0 |
| flash `partial/visual/dataset-pt5v/2/n_tokens` | (version 21.3.16, step 20) | 3670705 → 56273800 | ×15.3 |

**Why.** These four are all `partial` buckets or statistics of the `min` type: `partial/.../2/*` is a "stale by 2 generations" bucket,
In the early stage of training this bucket has no data at all, and only gradually gets values later, so "the early segment has a small median and the later segment has a large median" is the growth of the bucket,
not a definition change. `ctx_response_length/*/min` is the length of a single shortest trajectory, and its values naturally jump between several hundred and several thousand.

**Verification method.** Script sections 【8】 (by version) and 【14】 (arbitrary split) list the candidates separately,
In JSON, `drift.<run>.driftHits` and `levelShift.<run>.hits`. Each candidate gives the cut point step, the medians before and after, and the multiple.
Manual review: split the metric into two segments at the cut point, and take the median and value range of each.

**Impact.** **No evidence was found for "a same-name metric quietly changing its order of magnitude".** This is an important negative conclusion:
In this data, the most dangerous situation of "the metric name is unchanged but the meaning changed" did not occur.
Conversely, using the criterion "median ratio ≥10 and ranges do not overlap" can withstand interference from bucket growth and restarts,
and can be put into routine validation.

### 7.4 Inconsistent behavior of same-name metrics between two runs (more subtle than version drift)

**Phenomenon.** `actor/num_zeros_in_grad_vocab` (count of vocab dimensions that are zero in the gradient):

- pro: 24 steps fluctuate between 2.13e8 ~ 3.42e8, and have an exact affine relationship with `actor/num_zeros_in_grad`
  (slope 0.9999993, relative residual 8.5e-6, equivalent to `_grad − 2.95e8`).
- flash: **all 30 steps are exactly 0.**

`actor/num_zeros_in_grad_encoders`, however, is constantly 294705000 for pro, and flash does not have this tag at all.
`actor/update_successful` exists only in flash and is constantly 1.

**Why.** These three tags belong to the same family of optimizer diagnostic quantities, but the two runs have different reporting definitions:
pro counts both the vocab and encoder parts; flash counts only the total, and the vocab part is constantly 0.
On the dashboard they are listed side by side under the same prefix, so this difference is not visible.

**Verification method.**

```
bun -e 'for (const r of ["pro","flash"]) {
  const s = await Bun.file(`data/store/runs/${r}/series.json`).json();
  for (const t of ["actor/num_zeros_in_grad","actor/num_zeros_in_grad_vocab","actor/num_zeros_in_grad_encoders"])
    console.log(r, t, s[t] ? [...new Set(s[t])].length + " distinct values" : "does not exist");
}'
```

**Impact.** When comparing optimizer states across runs, one cannot assume that same-name metrics have the same definition.
`actor/num_zeros_in_grad_vocab` is constantly 0 on flash; using it directly as "health" would lead to the opposite conclusion that "flash has no zero gradients".

---

## 8. Documentation and data consistency: of 109 explainers, 12 were spot-checked; 9 hold only within the writing window, 3 do not match

### 8.1 Overall situation: the writing window for the explainers is pro 19 steps / flash 25 steps, while the data has already reached 24 / 30

**Phenomenon.** Among the 109 explainers for `content/metrics.json`, the entries that have the `observed` ("measured this round") field,
the step number ranges cited all end at pro step 19 and flash step 25. But the current `series` is pro 24 steps and flash 30 steps.
Spot-check 12 explainers containing specific numbers one by one (script section 【9】):

- **9 entries can be precisely reproduced within their own writing window, but are already outdated for the current full period.**
  For example, `dynsam/avg@n` writes "flash step 25 is 0.640833, and the highest is the last step"——
  The value at step 25 is indeed 0.640833, and within ≤25 steps it is indeed the highest; but the full-period highest has become 0.662291 at step 29,
  the current last step (step 30) is 0.643526. `critic/rewards/max` writes "all steps are 1",
  now the 24+30=54 values are still all 1; only the count "44 values in total" is outdated.
- **3 do not match.**

### 8.2 Three places that do not match (this is for correcting the documentation)

**Error 1 (hard error): the flash upper-limit step count for `ctx_total_length/max` is written incorrectly.**
The explainer's original text: "among flash's 25 steps, 17 steps equal 1048570". Measured in flash steps 1~25,
`ctx_total_length/max` is exactly equal to 1048570 for only **13 steps** (steps 6, 7, 9, 12, 13, 15, 18, 19, 20, 21, 22, 23, 24),
not 17. The same statement appears again in the `ctx_total_length/mean` explainer ("pro has 8/19 steps, flash has 17/25 steps"),
pro's 8/19 is correct, and flash's 17/25 is wrong. This number is the core evidence for "the upper limit indeed exists",
getting it wrong would weaken the conclusion.

**Error 2: `benchmark/lag` (how many steps the offline leaderboard lags behind training) says "exactly 4 steps".**
Measured now: the pro leaderboard reaches step 18 and training reaches step 24 (difference 6); the flash leaderboard reaches step 25 and training reaches step 30 (difference 5).
"exactly 4 in both cases" was probably a coincidence at the time: offline evaluation scores are manually backfilled, training keeps running, and the leaderboard does not follow in sync.
**This should not be written as a stable number; it should be written as "the leaderboard lag grows as training progresses".**

**Error 3: the flash deviation upper bound for `perf/total_num_tokens` does not match.**
The explainer writes "flash −0.29% ~ −2.77% (average 0.77%)". Measured within the ≤25-step window it is
−0.29% ~ **−2.69%** (average 0.76%); for the full period it is −0.29% ~ −2.69% (average 0.71%).
The steps with the largest error are still steps 18, 16, 17, consistent with the explainer's qualitative description.
**Speculation** (marked as speculation): steps 16 and 17 were rerun on flash, and the values in `series` were rewritten,
The deviation changed from −2.77% to −2.69%. The old values can no longer be reproduced from the current repository.

### 8.3 Metrics covered by the explainers but entirely absent from the data

- `dynsam/avg@n_no_infra`: the explainer itself writes "this repository has no data", and verified correct——
  neither run's `tags` nor `series` contains it. The official 22 notes include it, but the site does not report it.
- `penalty/stage_credit_group/always-zero`: this is a "group entry" (combining a batch of identically-zero counters into one entry),
  it is not a real metric name; this is normal writing.

Also check the 22 names pointed to by the official `descriptions` (the official metric descriptions in `meta.json`),
Of these, **2 do not exist in the data at all**: `dynsam/avg@n_no_infra` and
`dynsam/passrate/hist9_ratio` (for the latter, the official documentation also specifically gives the `hist_prefix` prefix,
but in the `series` of both runs there is no metric beginning with `hist9`).

### 8.4 Metrics present in the data but not covered at all by any explainer

After expanding the ids of the 109 explainers (including wildcard and family matching), they hit only, out of the 2009 metric names after deduplicating pro+flash,
**213 (10.6%)**, leaving **1796** with no explainer. Sorted by family (number of metrics in family):
`penalty/stage_credit_group` 507、`critic` 289、`actor` 210、`train/harness` 138、
`partial/code` 108、`partial/visual` 54、`train` 49……

**Verification method.** The `perId` table in section 【9】 of the script gives the number of metrics hit by each explainer id,
`uncoveredByFamily` gives the distribution of uncovered families, `priorityFamilies` gives the supplementary-writing priority sorted by "number of metrics in family × average coverage ×
fluctuation magnitude". JSON field paths: `docAudit.perId`, `docAudit.uncoveredByFamily`,
`docAudit.priorityFamilies`、`docAudit.officialDescriptions`。

**Impact.** The coverage of the explainers and the scope of the data are not on the same order of magnitude. The current 109 are more like
"a selection of metrics with stories told thoroughly", which is reasonable in itself; but if someone uses this explainer as a "dashboard field dictionary",
they will think all 2000 metrics have been explained.

---

## 9. List of discardable metrics (by family)

**Decision rules (can be written directly into the validation script):**

1. All empty: the metric has no non-null value in 24/30 steps (both runs in this case are 0).
2. Constant: number of distinct values among non-null values = 1. **pro: 226 identically 0, 69 identically 1, 16 other constants; flash: 204 / 69 / 17.**
3. Two values: number of distinct values = 2. **pro: 51, flash: 24.**

1+2 combined: pro 311 (16.0%), flash 290 (14.7%); adding 3 gives pro 362 (18.6%), flash 314 (15.9%).

**By family (identically 0 + identically 1 + other constants):**

| Family | pro | flash | Description |
| --- | ---: | ---: | --- |
| `penalty/stage_credit_group` | 139 + 7 + 0 | 123 + 7 + 0 | Protective counters and untriggered branches of the grading pipeline account for half of the discardable metrics |
| `actor` | 54 + 0 + 4 | 56 + 1 + 3 | `*/pg_clipfrac`, `*/ppo_kl` each have 25 tags identically 0; `actor/lr`, `actor/clip_high`, `actor/clip_low` are configuration constants |
| `critic` | 13 + 45 + 0 | 9 + 45 + 4 | Mainly `*/rewards/max`, `*/score/max` are identically 1 (45 in pro) |
| `train` + `train/harness` | 8 + 15 + 1 | 8 + 14 + 1 | `train/verdicts/trained` is identically 25088; `train/harness/*/training/nonzero_adv_rate` is identically 1 (pro: 15, flash: 14) |
| `penalty/action` | 3 + 1 + 0 | 3 + 1 + 0 | Action-type penalties were never triggered, `adv_mul_min` is identically 1 |
| `penalty/signed` | 2 + 0 + 0 | 2 + 0 + 0 | `pos_scale_clamped`、`neg_scale_clamped` |
| `ctx_*_length/<cat>/dataset` | 7 + 0 + 0 | 2 + 0 + 0 | Each dataset's `clip_ratio` |
| `partial/{code,visual,general}` | 0 + 0 + 10 | 0 + 0 + 8 | Staleness buckets that appear only once have constant values |
| Other | 0 + 1 + 1 | 1 + 1 + 1 | `training/actor_optimizer_steps` is identically 1, `dynsam/num_target` is identically 1568, etc. |

**Note two things:**

- "Discardable" holds only for **trend/correlation analysis**. The identically 1 `critic/*/rewards/max` indicates "there is a full-score trajectory at every step",
  This information is useful in itself, it's just that it should not occupy the place of a "time-series metric".
- Among the identically 0 ones, some are **things that truly did not happen** (protective upper limits were never triggered), and some are **not assigned a value**.
  The two cannot be distinguished numerically, so do not use them to draw conclusions about "training health" (this was already written in the previous note,
  what is added here is the count: the `penalty/stage_credit_group` family alone has 139 / 123).

---

## 10. The 10 most in need of added explainers

Ranking basis: number of metrics in the family, average coverage, value fluctuation magnitude, then manually excluding those that "have already been mentioned in passing by other entries".
The script gives a candidate list (`docAudit.priorityFamilies`); below are the 10 I selected, with reasons.

1. **`critic/<cat>/dataset-<id>/advantages/{mean,min,max}`** (about 290 uncovered).
   This is the raw output of the value network, but the max/min of `advantages` and `returns` are exactly the same (Section 1.1),
   while `advantages/mean` and `returns/mean` are another pair. If not explained clearly, readers will think they are two independent sets of signals.
2. **`critic/<cat>/dataset-<id>/rewards/min`** (included in the previous item, but worth listing separately).
   For a large number of datasets, ≥90% of steps in this family are exactly 0 (28 pro `critic` metrics belong to the "report 0 camp"),
   and they are equal value-by-value to `score/min`. This is one of the places where the "sparse 0 sentinel" is most concentrated.
3. **The four rates of `penalty/stage_credit_group/select_v4/*`**:
   `select_hack_attempt_rate`、`select_pass_new_tests_rate`、`select_probe_disagree_rate`、`select_r3_rate`。
   The existing explainers only cover the counts and pass rate of this pipeline, not these four rates; their magnitudes are in the 0.4~0.7 range,
   and they are among the few signals in this family that are actually moving.
4. **The two parallel prefixes `penalty/stage_credit_group/<harness>/…` and `select_v4_nogold/…`**.
   The same set of metrics is sliced once by harness and once by "whether there is a gold case"; together they amount to 507 uncovered metrics.
   Without clearly explaining the relationship between these two slicings, readers cannot know which one to look at.
5. **`train/harness/<harness>/training/{advantage_mean,negative_adv_rate,nonzero_adv_rate}`** (138 uncovered).
   This is the only entry point for "which agent harness produces better training signals", while `nonzero_adv_rate` is identically 1 on a set of harnesses.
6. **`train/passrate/avg_passrate/<cat>/dataset-<id>`** (the majority of the 49 uncovered `train`).
   The top-level `avg_passrate` has an explainer; those split by dataset do not; and the sentinel problem in 3.1 occurs precisely in this family.
7. **`ctx_total_length/<cat>/dataset-<id>/max` and `/clip_ratio`** (44 + 18 uncovered).
   Section 4 proves that this family has two tiers of truncation upper limits; if this is not written clearly, horizontal comparisons will inevitably be wrong.
8. **`partial/<k>/train_infer_diff/new_infer/*`** (bucket-level KL and tail distribution).
   The existing explainers cover global KL and bucket 0, but not bucket-level median/tail (`diff_abs_mean`, `F(tau=2)`, etc.),
   and this is precisely the direct evidence for "how the training-inference divergence changes as data gets stale".
9. **`actor/<cat>/<dataset>/pg_tis_clipfrac{,_pos_low,_pos_high,_neg_low,_neg_high}`** (about 130).
   `actor/pg_tis_clipfrac` has already been explained separately (dataset `yfch` is an outlier), but the five per-side tags are not covered;
   The conclusion in the existing explainer that "the low-boundary side is an order of magnitude higher than the high-boundary side" needs to be recomputed from them.
10. **The virtual dataset rows in `dynsam/<cat>/<dataset>/num_accepted/{step,held,carryover}`**.
    `agentic` is not a real dataset (it is an aggregate over the harness dimension, but it is listed under `dynsam/`),
    In this family there is also the issue of `dynsam/<cat>/dataset-<id>/...` and `dynsam/agentic/...` being mixed together,
    The existing explainers only cover the aggregate definition.

---

## 11. Things we do not understand (do not fill in with guesses)

1. **`actor/num_zeros_in_grad_encoders` is identically 294705000.**
   In pro it has not changed once over 24 steps, and flash does not have this tag. It is neither a power of 2 nor a power of 10,
   it does not look like a configuration constant; but no announcement or official description mentions it either. **It is unclear whether it is truly a "zero-gradient count" or an un-updated initial value.**
2. **`actor/num_zeros_in_grad_vocab` is identically 0 on flash and is an affine function of another count on pro.**
   If flash really has no zero-gradient vocab dimensions, then its relationship with `actor/num_zeros_in_grad` should also match up,
   but flash's `_grad` fluctuates at the 4e8 scale. **Why the definitions for the two runs differ is unknown.**
3. **The drawdown conditions for `train/passrate/passrate_0_ratio` / `passrate_1_ratio`.**
   pro drew down once each at steps 15 and 23 (0.0619→0.0112, 0.0443→0.0351),
   But pro has 7 restart steps, flash has 4 restart steps, and flash did not draw down even once.
   Step 15 is exactly the step in the announcement "we have restarted the run" (network issue),
   Step 23 has no announcement. **The trigger condition for the drawdown is unknown**, so these two metrics can only be used as "cumulative average, not comparable after the drawdown point."
4. **Why the old bucket of `partial/<k>/n_tokens` reports the same number across three definitions.**
   Confirmed phenomenon (Section 1.4), but it is not known whether it is a rollback, duplication, or whether these three slices actually overlap.
   Until this is clarified, per-slice token counts for the old bucket are unavailable.
5. **`partial/<k>/n_tokens` added together total only about half of `perf/total_num_tokens`.**
   The previous note already recorded this; this time confirm it still holds at 24/30 steps (pro 45%~55%, flash 44%~56%).
   **Where the other half of the tokens are recorded, unknown.**
6. **The truncation of `ctx_total_length/*/max` is neither a hard cap nor a single definition.**
   1048570 and 262144 coexist as two tiers, and there are also 1049640, 1048690, 1054990, 2236430, values exceeding the upper limit.
   **Which code path the over-limit values come from is unknown** (cross-sectional statistics and global statistics are probably not from the same source).
7. **The specific semantics of that `penalty/stage_credit_group` family.**
   996 metrics, no official documentation, and the naming can only be translated literally. This article only counts it as "the family with the highest share of identically zero",
   Do not provide any mechanistic explanation for it.
8. **The reason for the disappearance of those 4 metrics in flash after step 19.**
   (see 7.2) There is neither an announcement nor a version number change corresponding to it——`versions`'s `n` has been 2062 since 26.4.25.
This indicates that **the version number is not a reliable signal of changes in the metric set**.
9. **This post uses the threshold for automatically judging "constant".** "≤1 distinct values counts as constant, ≤2 counts as two-valued" will miss on 24 points
   "repeats every 12 steps" — this kind of periodic sequence. This paper does not detect periodicity; this is a known blind spot.

---

## 12. How to recompute it yourself

```
# From the project root directory
bun src/audit_report.ts
```

The script prints all sections 【0】~【15】 and writes out `analysis/zh-CN/numbers/A3-audit-numbers.json`.
The script contains no hard-coded conclusion numbers, only thresholds (concentrated in the `T` object at the top of the file:
Correlation coefficient 0.999, affine residual 1e-9 / 1e-4, breakpoint 8× MAD, jump 10×, sentinel proportion 50%,
reported 0s account for 90%, magnitude drift 10×). Changing the threshold only requires changing this one place.

Corresponding JSON fields for common issues:

| What do you want to know | Where to look |
| --- | --- |
| How many metrics can be dropped directly, and which ones are they? | `constants.<run>` |
| coverage distribution, supply cut-off, reporting 0 | `coverage.<run>` |
| Which metrics are duplicated? | `identity.<run>.clustersTop` / `.examples` |
| Is there any out-of-bounds? | `scale.<run>.outOfRange` |
| Which steps are the breakpoints concentrated in | `breakpoints.<run>.ranked` / `.rankedRate` |
| At which step does the restart land? | `eventAlignment.<run>.restartsByStep` / `.intervals` |
| When metrics are added/disappear | `lifecycle.<run>` |
| Did the definition change? | `drift.<run>` / `levelShift.<run>` |
| Are the numbers in the explainer correct? | `claims[]` (containing two boolean values, `ok` and `stale`) |
| Which metrics have no explainer | `docAudit` |

One last point: **This audit itself also has boundaries.** There are only 24 / 30 points, any "constant" determination is a finite-sample determination;
All conclusions correspond to the 2026-09-18 snapshot; after the site continues running, the script must be rerun.

---

## Appendix: Glossary

| Term | One-sentence explanation |
| --- | --- |
| `pro` / `flash` | The site is running two training jobs: pro is the large model ($5.71/second), flash is the small model ($2.855/second) |
| sequence (series) | A series of per-step values corresponding to a metric name; the length is strictly aligned with the step number array; positions without data are `null` |
| coverage rate | Proportion of steps where this metric has a value (not `null`) out of total steps |
| identically zero / constant | All non-`null` values are identical; "the number of distinct values = 1" is the criterion used this time. |
| Sentinel value | Placeholder numbers written in to represent "no data" or "not triggered", most commonly 0 and 1, cannot be distinguished numerically from true values. |
| reports 0 | The metric has a value, and the value is exactly 0, but the actual meaning may be "no data" or "the branch was not triggered" |
| Bucketing（`partial/<k>/`） | Split the same set of statistics by "how many policy versions separate the data from sampling to training", the larger the bucket number, the older the data. |
| `frac` | A given bucket's weight (share) in this step's tokens; the sum across buckets ≈ 1 |
| `staleness` (staleness generation) | The number of policy versions between data sampling and training; `partial/avg_staleness` is its average. |
| Identity / affine relation | The two sequences are equal element-wise, or satisfy `y = a + b·x`; this time, use "residual / value range < 1e-4" to judge approximate equality |
| MAD (median absolute deviation) | An outlier-insensitive volatility measure, used here to calibrate each metric's own "normal volatility". |
| breakpoint | The change between two adjacent steps exceeds 8 times the metric's own MAD, and the relative change exceeds 5%. |
| running mean (cumulative average) | The average over all steps up to the current step will converge monotonically and drop abruptly when reset. |
| `harness` (agent framework) | The same batch of tasks run with different agent scaffolds, `train/harness/<名字>/...` is the statistics broken down by framework. |
| `tags.json`'s `first_seen` / `last_seen` | Timestamp of the first/most recent time telemetry saw this metric name; this proves that neither can be used directly as a lifecycle |
