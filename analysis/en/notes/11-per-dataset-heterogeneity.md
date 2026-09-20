# Per-dataset heterogeneity: on which datasets the score improvement actually occurs, and whether the aggregate metric is contaminated by the data mix

> Material provenance: **our own measurement**. All numbers come from local telemetry `data/store/`, recomputed by script `src/dataset_report.ts`; no conclusion numbers are hard-coded in the script.
> Data as of: **pro step 24, flash step 30** (`axis.json`'s `updated_at`: pro 1789808290, flash 1789787223).
> Recompute command (run from the project root): `bun src/dataset_report.ts`. Numbers are written in `analysis/zh-CN/numbers/A3-dataset-numbers.json`.
> This article only addresses heterogeneity at the **dataset level**, and does not repeat the content already written in `notes/06` (definition trap), `notes/08` (generation length), `notes/09` (length correlation).

---

## 1. Summary: Six Conclusions

1. **The two runs have exactly the same dataset list: 25, in 5 categories** (code 11, general 4, visual 6, chat 3, cyber 1). pro's cyber has a total of 42 metrics, and **all** of them stop reporting simultaneously after step 14; the announcement time (2026-09-17T12:20:11Z) falls exactly between the wall clock of step 14 and step 15—the "removal of cyber" is closed in the data. [Our own measurement]

2. **Who is being learned varies enormously by dataset.** pro is "6 clearly learned / 6 slowly improving / 7 stagnating / 4 degrading", flash is "9 / 8 / 3 / 3" (another 2 datasets cannot be classified because their pass rates contain suspected unreported 0s). The biggest gains for pro are `visual/dataset-jzd3` (+15.36pp), `general/dataset-1doa` (+15.17pp), `code/dataset-m1dt` (+14.10pp); the biggest regressions are `code/dataset-4onq` (−10.14pp), `chat/dataset-lm3t` (−9.78pp), `code/dataset-v7yx` (−9.17pp). **The rank correlation of gains for the same dataset across the two runs is ρ=0.582 (n=25, p=0.0023)**, indicating that this heterogeneity is reproducible, not single-run noise. [Our own measurement]

3. **Answer to the core question: there is no Simpson-style contamination; moving the mix is instead a drag.** Reweighting the overall pass rate by `dynsam/<cat>/dataset-<id>/num_accepted/step` (the number of questions from that dataset accepted into the training batch at this step) and doing an exact three-term decomposition: of pro's total change of +3.54pp, "datasets improving on their own" contributes **+3.81pp (107.6%)**, the mix term is only **+0.16pp**, the interaction term is −0.43pp, and the two together are **−0.27pp (−7.6% of the total change)**; of flash's total change of +9.15pp, "improving on their own" is **+8.31pp (90.8%)**, the mix term is +0.008pp and the interaction term is +0.835pp, together **+0.84pp (+9.2%)**. **Conclusion: 91%~108% of the aggregate score improvement comes from individual datasets improving themselves; mix-weight movement explains at most 9%, and on pro the direction is still negative.** [Our own measurement]

4. **But the aggregate metric "generation length" is different: it is more heavily contaminated by the mix.** The same algorithm applied to `ctx_response_length/mean`: of pro's total length growth of +58110 token, 8.3% (+4818), and of flash's +94262, **23.4%** (+22067), comes from weight shifting toward longer datasets. **On the same "aggregate metric", scores are almost clean while length is not.** [Our own measurement]

5. **"Longer length means higher scores" holds only in one corner.** Among 25 datasets × 2 runs, only 3 cases have both level regression and difference regression **significantly positive**: `visual/dataset-jzd3`@pro (difference +9.65pp/10k token, p=0.010), `visual/dataset-ve5o`@pro (+1.85, p=6.8e-5), `visual/dataset-ve5o`@flash (+0.63, p=0.011). There are 5 cases of **significantly opposite** (length increases while scores significantly decrease in the difference sense): `chat/dataset-eup7`@pro, `cyber/dataset-9aui`@pro, `cyber/dataset-9aui`@flash, `general/dataset-epqd`@pro, `visual/dataset-pt5v`@flash. The remaining 27 cases have **non-significant differences**—including all code-type datasets. [Our own measurement]

6. **There is no reliable "ordering" among datasets.** For the difference cross-correlation between all pairs of datasets, the absolute value of the average correlation coefficient over lag = −4…+4 is ≤0.022 (297~300 pairs per lag); the highest and lowest net lead scores differ by only 7 (pro) and 9 (flash), against 24 opponents, and the smallest sign-test p is only 0.064. The only thing resembling directionality is flash's "the harder at the start, the later the breakthrough" (ρ=0.434, n=23, p=0.039); on pro the same algorithm gives only 0.069 (p=0.78)—**the two runs disagree, so I do not treat it as evidence for curriculum structure**. [Our own measurement]

---

## II. Methods and Definitions

| Item | Content |
|---|---|
| Data | `runs/{pro,flash}/series.json` (pro 1944 metrics × 24 steps, flash 1974 × 30), `axis.json`, `status.json` (including `events[]`, `totals`), `tags.json`, `timeline.jsonl`; `data/store/{notices,benchmarks}.json`; `content/metrics.json` (109 Chinese explainers) |
| Recompute script | `src/dataset_report.ts`, no third-party dependencies; OLS slope / standard error / t-test p-value / 95% confidence interval / Spearman are all implemented in the script (for the t distribution, the regularized incomplete Beta is used to compute the CDF, then bisection is used to find quantiles) |
| Script artifacts | `analysis/zh-CN/numbers/A3-dataset-numbers.json`; stdout is a human-readable summary (`--json-only` can write only JSON) |
| Dataset inventory basis | Based on the `train/passrate/avg_passrate/<cat>/dataset-<id>` family, 25 in total |
| "Score" basis | The primary basis uses `train/passrate/avg_passrate/<cat>/dataset-<id>`, i.e. **the average pass rate of the batch of problems from that dataset that enters training at this step** (the success ratio of 16 samples per problem, then averaged across problems); below, it is always written as pp (percentage points) |
| "Weight" basis | Default `dynsam/<cat>/dataset-<id>/num_accepted/step` (the number of problems from that dataset accepted into the batch at this step); for robustness, also use `/held` (task pool holdings) and equal weight |
| Missing values | `null` in the sequence is always treated as missing and pairwise deleted. For pro's cyber, everything from step 15 onward is `null` |
| Sentinel value | The `avg_passrate` of `visual/dataset-gtav` and `visual/dataset-ol8x` contains exact 0s. The primary basis **treats exact 0 as missing**; a separate version treating "0 as a real value" is run for sensitivity (see §5 and §10) |
| Significance | Two-tailed; t-test for slopes, Pearson/Spearman for correlations (ranks with ties averaged). Sample sizes are small (pro 24 points, flash 30 points), the two-tailed 0.05 critical value for Spearman \|ρ\| : at n=25, 0.396; at n=23, 0.413; at n=19, 0.456 |
| Differencing basis | First-difference regression is used to eliminate the "common time trend"; this is the only usable basis for answering "if length rises a bit more, does the score rise a bit more" |
| Restart alignment | Compare the `events[]` timestamp of `status.json` with `axis.walls`; if it falls between step k and step k+1, record it as "the restart affects step k+1" |

### 2.1 Classification rules (hardcoded in the script, directly verifiable)

Let Δpp = last step with a value − first step with a value (pp), b = OLS slope of pass rate against step number (pp/step), and p be its two-tailed p-value:

1. **Degradation**: Δpp ≤ −3.0 or (b < 0 and p < 0.05)
2. **Clearly learned**: b > 0 and p < 0.05 and Δpp ≥ +5.0
3. **Slow improvement**: (b > 0 and p < 0.05 且 Δpp < +5.0）或（b > 0 and 0.05 ≤ p < 0.20 且 Δpp > 0)
4. **Stagnation**: the rest
5. Also **unreliable (sentinel 0)**: `visual/dataset-gtav`, `visual/dataset-ol8x`, rules do not apply

Rule 1 takes precedence over 2/3/4, so datasets with "a large first-to-last difference but a completely non-significant slope" fall into degradation—they carry a `classNote` flag in the JSON (pro has `code/dataset-4onq`, `code/dataset-v7yx`, `chat/dataset-lm3t`; flash has `chat/dataset-eup7`), and readers should not treat these as "really regressing".

### 2.2 Three-term shift-share decomposition (the core tool used in §5)

For two periods of the same set of datasets, let s be the share normalized by weight (Σs = 1), then

```
ΔA = Σ s_d(0) · Δp_d          ← self-improvement (priced at baseline mix)
   + Σ Δs_d · p_d(0)          ← mix shift (priced at baseline score)
   + Σ Δs_d · Δp_d            ← interaction term
```

The sum of the three terms is **exactly** equal to ΔA (the script outputs `checkSumError`, measured as 0). The reason for not drawing conclusions solely from the "difference between fixed data mix curves" is that this difference equals the “mix term + interaction term”, which mixes the fact that “the datasets moved over were also improving over the same period” into the mix. Both bases are given in §5.

### 2.3 What cannot be done (stated upfront)

- **The proportion of "0 out of 16 correct" for each dataset is not reported.** The entire database has only the global `dynsam/passrate/zero` (proportion of all-wrong problems), and the dataset level has only average pass rate. Therefore, for question 2, "which dataset the wall is on" can only use the two proxy readings **lowest average pass rate** and **dwell time in the low-score region**; this is explicitly noted in §4.
- **`train/passrate/passrate_0_ratio` / `passrate_1_ratio` have no entries in the 109 Chinese explainers**, so I cannot confirm what they are counting (see §10 for details).

---

## 3. Dataset inventory and availability (question 1)

**Conclusion**: Both runs have 25 datasets, 5 categories, and an identical inventory; datasets differ greatly in **which metric families they actually report on**, and 6 datasets have whole-family gaps (not scattered missing values). pro's cyber is the only dataset that "disappears entirely midway".

**Plain language**: The dataset layer of this dashboard is not a neat table. For things all called "a dataset", some have every metric, while others have only pass rate and one sampling count. Before making cross-dataset comparisons, you first need to know whose which column is empty; otherwise it is easy to mistake "not reported" for "performance is 0".

### 3.1 Inventory (same for both runs)

| Category | Count | Dataset code |
|---|---|---|
| code | 11 | 4onq, bvg7, dnpn, m1dt, obg8, sin0, ta4j, v7yx, x7wh, yfch, zg6q |
| visual | 6 | 053e, gtav, jzd3, ol8x, pt5v, ve5o |
| general | 4 | 1doa, 5610, epqd, trla |
| chat | 3 | 8kb6, eup7, lm3t |
| cyber | 1 | 9aui |

### 3.2 Coverage and whole-family gaps (consistent across both runs)

The pass rate sequence has **no holes** between the first and last values (the only exception is cyber's entire tail missing). The whole-family gaps are as follows:

| Dataset | What is missing (the same for both runs) |
|---|---|
| `visual/dataset-053e` | No `ctx_response_length/mean`, no `ctx_total_length/mean`, no `clip_ratio`, no `critic/.../score/mean`, no `entropy_loss`, no `pg_tis_clipfrac`, no `partial/.../avg_staleness` |
| `visual/dataset-gtav` | No `ctx_response_length/mean`, no `clip_ratio`, no `entropy_loss` |
| `code/dataset-v7yx` | No `entropy_loss`, no `pg_tis_clipfrac` |
| `code/dataset-x7wh` | No `critic/.../score/mean` |
| `code/dataset-obg8`（pro）/ `4onq`、`zg6q`（flash） | No `partial/.../avg_staleness` |
| The other 15 datasets | Do not have `env/<cat>/dataset-<id>/active` (only `code/dataset-m1dt`, `cyber/dataset-9aui`, the 4 general ones, and `visual`'s 053e/ol8x/pt5v/ve5o—these 10 have it) |

`visual/dataset-053e` has the largest gaps: apart from pass rate, sampling count (the `num_accepted` three-piece set), prompt length, and `critic/.../score/max|min`, it has **neither generation length nor total length, nor its own entropy, TIS clipping rate, and `partial` staleness**, so it cannot be used for length–score elasticity (§6). `visual/dataset-gtav` has `ctx_total_length/mean` (total length) but no generation length; in §6, total length is used as a fallback basis for it and explicitly noted.

### 3.3 Closing evidence that cyber stopped reporting

| Evidence | Value |
|---|---|
| cyber's **last non-empty step** in pro | Step **14** |
| The first fully empty step | Step **15** |
| Number of metrics that stopped reporting | pro's 42 cyber metrics **all** stop at step 14 (histogram `{"14": 42}`, no exceptions) |
| Announcement `n-15ac72` time | 2026-09-17T12:20:11.047Z |
| This time falls | **after** step 14's wall clock 1789627881.76 and **before** step 15's wall clock 1789657788.78; i.e. "14 steps completed" |
| Original announcement text | "…we also removed the cyber dataset from the upcoming pro run, since we observed some bad patterns in the rollout logs." |
| Comparison: flash | Of the 34 cyber metrics, 33 report all the way to step 30 (the final step); the other 1 (`partial/cyber/dataset-9aui/avg_staleness`) reports only to step 20 |

That is, the announcement says "removed from **subsequent** pro run", and in the data cyber disappears entirely starting exactly at the first reporting step after the announcement (step 15). **Direction, timing, and coverage all agree; this can be used as a definitive conclusion.**

### 3.4 A robust measurement-definition finding: the suspected "unreported" 0s all fall on restart steps

The positions where exact 0s appear for `visual/dataset-gtav` and `visual/dataset-ol8x` are **not random**:

| run | Step where exact 0 appears | Count | Value of `critic/.../score/mean` at the same moment |
|---|---|---|---|
| pro | 1, 2, 3, 11, 15, 17, 23 | 7 times each | gtav 0.53~0.57, ol8x 0.60~0.67 (both normal values) |
| flash | 1, 3, 16, 25, 28 | 5 times each | gtav 0.52~0.59、ol8x 0.63~0.67 |

The restart-affected steps given by pro's `events[]` are **3, 11, 15, 17, 23**, and for flash they are **16, 25, 28** (flash has another rerun at steps 16 and 17). Putting the two tables together: **the set of exact 0s = step 1 ∪ (step 2, pro only) ∪ all restart-affected steps**, no more and no less.

At the same moment, `critic/<cat>/dataset-<id>/score/mean` is a normal value, indicating that these questions **did not actually have 0% pass**, but the pass rate family simply was not reported. This goes further than the inference in `notes/09` of "suspected unreported sentinel": it is not scattered under-reporting, but **block missing reporting tied to restarts**.

> **Transferable concept 1｜Restart-coupled reporting gap (restart-coupled reporting gap)**
> Definition: certain metrics are missing for the entire family at the first reporting step after an operational restart, but other metric families for the same entity at the same moment still have values as usual. How to determine: intersect the "set of missing-value steps" with the "set of restart event steps"; if the gap is a superset of the restart steps, it is a measurement-definition problem rather than a data problem.
> In this work: the pass rate 0 for gtav/ol8x hits 5/5 restart steps in pro and 3/3 restart steps in flash, and `critic` score is normal over the same period.
> Transferable rule: **When you see "a slice suddenly becomes 0 or missing over a large area," first align it with operational events by time; if missing values appear only on event steps, do not treat it as a business signal—first remove it from trend statistics.**

---

## IV. Who is being learned, who is stuck (Question 2)

**Conclusion**: 60% of datasets in pro (12/25) statistically show an upward trend, and flash is 17/25; but the places that are "stuck" are highly concentrated—**the low-score region (pass rate persistently below 45%) falls almost entirely on the three chat datasets + `visual/dataset-jzd3` + `visual/dataset-gtav`, while no dataset in the code and general categories drops below 45% at any step**.

**In plain terms**: this round of training is not an "overall lift" but rather "code and general questions were already at the passing line; what is really struggling below the passing line is three kinds of things: chat questions, a class of visual questions, and gtav".

### 4.1 pro first-last comparison (sorted by Δpp, only key columns listed)

| Dataset | Category | Category | First value % | Last value % | Δpp | Slope pp/step | p | Mean % | Share of steps below 45% | Length ×first→last | Entropy first→last |
|---|---|---|---|---|---|---|---|---|---|---|---|
| visual/dataset-jzd3 | visual | Clearly learned | 41.63 | 56.99 | **+15.36** | 0.304 | 0.0063 | 47.70 | 25.0% | ×1.27 | 0.285→0.305 |
| general/dataset-1doa | general | Clearly learned | 49.07 | 64.24 | **+15.17** | 0.342 | 0.0397 | 56.46 | 4.2% | ×1.58 | 0.211→0.266 |
| code/dataset-m1dt | code | Clearly learned | 53.96 | 68.07 | **+14.10** | 0.611 | 8.2e-13 | 62.01 | 0 | ×1.82 | 0.352→0.437 |
| chat/dataset-eup7 | chat | Stalled* | 38.67 | 50.90 | +12.23 | 0.129 | 0.544 | 49.77 | 29.2% | ×0.73 | 0.554→0.550 |
| code/dataset-yfch | code | Slowly improving | 60.60 | 71.79 | +11.18 | 0.295 | 0.0618 | 69.62 | 0 | ×1.62 | 0.482→0.478 |
| visual/dataset-053e | visual | Slowly improving | 49.91 | 60.14 | +10.23 | 0.256 | 0.0842 | 52.52 | 8.3% | – (no data) | – |
| visual/dataset-ve5o | visual | Clearly learned | 82.69 | 91.05 | +8.36 | 0.284 | 9.8e-6 | **86.11** | 0 | ×1.63 | 0.385→0.398 |
| cyber/dataset-9aui | cyber | Clearly learned | 56.39 | 64.17 | +7.78 | 1.033 | 0.0086 | 60.16 | 0 | ×1.80 | 0.456→0.492 |
| code/dataset-x7wh | code | Clearly learned | 57.01 | 63.28 | +6.27 | 0.247 | 0.0021 | 59.43 | 0 | ×2.01 | 0.438→0.497 |
| general/dataset-trla | general | Stalled | 51.56 | 56.74 | +5.18 | 0.011 | 0.909 | 52.11 | 0 | ×1.42 | 0.425→0.477 |
| general/dataset-epqd | general | Slowly improving | 58.20 | 63.00 | +4.80 | 0.129 | 0.168 | 61.06 | 0 | ×1.71 | 0.294→0.321 |
| visual/dataset-pt5v | visual | Stalled | 72.27 | 76.28 | +4.00 | 0.077 | 0.414 | 74.00 | 0 | ×2.48 | 0.300→0.329 |
| code/dataset-sin0 | code | Slowly improving | 58.69 | 62.33 | +3.64 | 0.074 | 0.192 | 62.14 | 0 | ×1.54 | 0.411→0.473 |
| code/dataset-zg6q | code | Slowly improving | 54.14 | 57.49 | +3.35 | 0.290 | 0.0008 | 57.81 | 0 | ×2.01 | 0.415→0.517 |
| chat/dataset-8kb6 | chat | Stalled | 41.80 | 44.52 | +2.72 | 0.142 | 0.537 | **40.85** | **79.2%** | **×0.35** | 0.440→0.491 |
| code/dataset-dnpn | code | Slowly improving | 59.13 | 59.44 | +0.31 | 0.243 | 0.0043 | 61.94 | 0 | ×1.89 | 0.409→0.524 |
| code/dataset-ta4j | code | Stalled | 58.62 | 58.81 | +0.19 | −0.100 | 0.318 | 58.98 | 0 | ×1.84 | 0.432→0.494 |
| general/dataset-5610 | general | Stalled | 52.14 | 50.53 | −1.60 | −0.033 | 0.815 | 52.69 | 0 | ×1.81 | 0.381→0.438 |
| code/dataset-bvg7 | code | Stalled | 61.31 | 58.47 | −2.84 | −0.083 | 0.554 | 60.77 | 0 | ×1.85 | 0.413→0.481 |
| visual/dataset-gtav | visual | Unreliable | 29.79 | 26.68 | −3.11 | −0.262 | 0.033 | **26.21** | **100%** | – | – |
| code/dataset-obg8 | code | Degraded | 55.65 | 49.69 | −5.97 | −0.009 | 0.901 | 53.39 | 0 | ×2.11 | 0.441→0.491 |
| code/dataset-v7yx | code | Degraded* | 60.91 | 51.74 | −9.17 | 0.011 | 0.930 | 58.04 | 0 | ×2.28 | – |
| chat/dataset-lm3t | chat | Degraded* | 48.75 | 38.97 | −9.78 | 0.005 | 0.981 | **44.52** | **54.2%** | ×2.99 | 0.212→0.170 |
| code/dataset-4onq | code | Degraded* | 73.29 | 63.15 | −10.14 | −0.037 | 0.818 | 59.61 | 0 | ×1.45 | 0.523→0.501 |
| visual/dataset-ol8x | visual | Unreliable | 59.74 | 43.58 | −16.17 | −0.738 | 0.0058 | 54.54 | 17.7% | ×1.36 | 0.283→0.323 |

\* The three starred "degraded" cases are "large first-last difference but slope not significant"; see §2.1; `visual/dataset-ol8x`'s −16.17pp is even less credible because of sentinel 0.

### 4.2 flash first-last comparison (excerpt, same measurement definition)

| Dataset | Category | First value % | Last value % | Δpp | Slope pp/step | p | Mean % | Share of steps below 45% |
|---|---|---|---|---|---|---|---|---|
| code/dataset-yfch | Clearly learned | 47.18 | 82.17 | **+34.99** | 0.520 | 0.0010 | 64.92 | 0 |
| cyber/dataset-9aui | Clearly learned | 42.19 | 63.39 | +21.20 | 1.076 | 7.8e-10 | 58.79 | 16.7% |
| code/dataset-m1dt | Clearly learned | 49.81 | 67.59 | +17.78 | 0.615 | ~0 | 60.52 | 0 |
| chat/dataset-eup7 | Stalled* | 25.39 | 42.21 | +16.82 | −0.026 | 0.873 | 47.77 | 40.0% |
| code/dataset-x7wh | Clearly learned | 47.43 | 62.78 | +15.36 | 0.273 | 9.6e-6 | 57.25 | 0 |
| visual/dataset-ve5o | Clearly learned | 76.03 | 89.40 | +13.37 | 0.512 | 1.4e-13 | 83.31 | 0 |
| visual/dataset-jzd3 | Clearly learned | 36.12 | 49.12 | +13.00 | 0.306 | 0.0007 | **39.73** | **86.7%** |
| visual/dataset-pt5v | Clearly learned | 62.61 | 74.29 | +11.68 | 0.363 | 1.3e-5 | 68.45 | 0 |
| code/dataset-dnpn | Slowly improving | 53.80 | 64.82 | +11.02 | 0.141 | 0.125 | 59.13 | 0 |
| general/dataset-1doa | Slowly improving | 56.86 | 62.49 | +5.63 | 0.154 | 0.140 | 56.48 | 3.3% |
| code/dataset-obg8 | Stalled | 54.67 | 55.88 | +1.21 | −0.008 | 0.854 | 54.37 | 0 |
| code/dataset-bvg7 | Stalled | 57.69 | 56.28 | −1.41 | −0.103 | 0.252 | 59.98 | 0 |
| general/dataset-5610 | Degraded | 51.61 | 48.55 | −3.06 | 0.099 | 0.348 | 52.58 | 0 |
| chat/dataset-8kb6 | Degraded | 37.11 | 32.95 | −4.16 | 0.154 | 0.283 | **39.85** | **73.3%** |
| code/dataset-v7yx | Degraded | 57.21 | 52.71 | −4.50 | −0.047 | 0.493 | 56.12 | 0 |

(The full 25 rows are in `S2_perDataset` of the JSON.)

### 4.3 Where "that wall" is: using dwell time in the low-score region instead of "16 attempts all wrong"

**First, the limitation**: the dashboard does not report, per dataset, the share of questions where "none of the 16 attempts got it right." The global line (`dynsam/passrate/zero`, all-wrong question share) only drops from 14.62% to 13.48% in pro and from 16.05% to 14.74% in flash, indicating that the "all-wrong base" barely moved over the whole round; but **it cannot be broken down to the dataset level**.

Sort using the two proxy readings that are available:

| Reading | pro's worst three | flash's worst three |
|---|---|---|
| Lowest average pass rate | gtav 26.21%、8kb6 40.85%、lm3t 44.52% | gtav 28.83%、jzd3 39.73%、8kb6 39.85% |
| Highest share of steps below 45% | gtav 100%、8kb6 79.2%、lm3t 54.2% | gtav 100%、jzd3 86.7%、8kb6 73.3% |

The overlap between the two runs is **`visual/dataset-gtav` + `chat/dataset-8kb6`**; pro additionally has `chat/dataset-lm3t`, and flash additionally has `visual/dataset-jzd3`. Beyond that:

- **All 11 datasets in the code category, all 4 in the general category, and visual's 053e/ol8x/pt5v/ve5o have no step in either run with a pass rate below 45%.**
- Conversely, the side that is "already mastered" is `visual/dataset-ve5o` (pro mean 86.1%, flash 83.3%) and `visual/dataset-pt5v` (74.0% / 68.4%).

**So the shape of this wall is**: it is not that "programming questions are too hard," but rather **chat-type questions and a class of visual questions are overall in the low-score region, and this round of training did not lift them out of the low-score region** (8kb6 is still going down in both runs). gtav's pass rate reading is the lowest overall, but it carries sentinel 0, so I only list it as "suspected lowest," not as a conclusion.

> **Transferable concept 2｜How to measure the "never-got-it-right questions" wall: all-wrong share (passrate/zero) vs average pass rate**
> Definition: `passrate/zero` is "what share of questions had none of the 16 attempts succeed," measuring the **difficulty floor** (whether it is possible to learn); `avg@n`/average pass rate is the mean of per-question success proportions, measuring **overall progress**. A dataset can have an average pass rate of 0.40 with almost no all-wrong questions (the questions are all half-solved), or have an average of 0.40 with half the questions all wrong (bimodal difficulty).
> In this work: global `passrate/zero` stays pinned at 13%~17% throughout (pro drops only 1.14pp), while over the same period global `avg@n` rises by 6.88pp (pro)/12.71pp (flash)—**what rises is all "half-solved" questions becoming "all-correct"; the "completely unable" block was not lifted**. At the dataset level, only average pass rate is available, not the all-wrong proportion, so in §4.3 I use "share of steps below 45%" as a proxy reading and explicitly mark that this is a proxy, not the original metric.
> Transferable rule: **When evaluating a slice that will not train, first ask "has its all-wrong share decreased" rather than "has its average score increased"; an increase in average score may just be the middle improving, while an unchanged all-wrong share means this slice is actually not being learned.**

---

## V. Are aggregate metrics contaminated by the data mix? (Question 3, core)

**Conclusion**: **There is no Simpson-style contamination.** In the aggregate score improvement across the two runs, mix shifts account for at most 9% (flash), and on pro it is still −7.6% (a drag). But **the aggregate metric of generation length is contaminated by the mix much more: pro 8.3%, flash 23.4%**.

**In plain terms**: the worry was "average score went up, but only because training increasingly quizzes on easy questions." The data says this did not happen. What really needs attention is another thing: in the overall conclusion that "answers are getting longer," a large part is only because the sampler gave more traffic to datasets that already generated long outputs.

### 5.1 Aggregate score: three-term decomposition

| run | Measurement definition | Panel size | Total change | Own improvement (Σs₀Δp) | Mix term (ΣΔs·p₀) | Interaction term (ΣΔs·Δp) | Mix + interaction as share of total change |
|---|---|---|---|---|---|---|---|
| pro | Weighted by `num_accepted/step` | 22 | **+3.544pp** | +3.813（107.6%） | +0.162 | −0.431 | **−0.269pp（−7.6%）** |
| flash | Weighted by `num_accepted/step` | 23 | **+9.149pp** | +8.307（90.8%） | +0.008 | +0.835 | **+0.843pp（+9.2%）** |

Panel = datasets with pass rate at both first and last steps and weight > 0 (pro 22 = 25 − cyber − gtav − ol8x; flash 23 = 25 − gtav − ol8x). pro's cyber is excluded because the last step is missing; this is determined by the definition, not selective removal.

**Robustness** (all written in the same JSON paragraph):

| Measurement definition | pro data mix + interaction | flash data mix + interaction |
|---|---|---|
| weight switched to `num_accepted/held` (task pool holdings) | −0.936pp（−32.5%） | +0.933pp（+10.1%） |
| weight switched to equal weighting | identically zero (by construction) | identically zero (by construction) |
| gtav/ol8x's 0 treated as a true value (panel 24 / 25) | −0.814pp（−18.3%） | +0.878pp（+8.3%） |
| pro only takes the cyber era (steps 1~14, panel 23) | +0.149pp（+4.75%） | – |

**Under all four definitions, the absolute value of the data mix term does not exceed 1pp** (corresponding to 4.7%~32.5% of the total change), while the sign of the interaction term is negative for pro and positive for flash. **Under none of the definitions can "data mix shifting" explain the bulk of the score improvement.**

### 5.2 Fixed data mix control curve ("if the data mix is frozen at step 1")

| run | Actual final value (step 24/30) | Final value under data mix fixed at step 1 | Difference | Maximum on the curve \|Difference\| |
|---|---|---|---|---|
| pro | 60.40% | 60.67% | **+0.27pp** | 1.40pp (step 19) |
| flash | 61.16% | 61.09% | **−0.06pp** | 2.98pp (step 2) |

Fixing the average data mix of steps 1~3, or fixing the average data mix of the first half, gives the same conclusion (pro's final-value differences are +0.11 and +0.17pp respectively; flash's are +0.01 and +0.30pp). **With the data mix frozen versus not frozen, the final value differs by no more than 0.3pp.**

### 5.3 Total generation length: same decomposition, data mix term 10× larger

| run | Total length growth | own improvement | data mix term | interaction term | data mix + interaction share | Fixed data mix final-value difference |
|---|---|---|---|---|---|---|
| pro | +58110 token | +53293（91.7%） | +2292 | +2525 | **+4818（8.3%）** | −4818 |
| flash | +94262 token | +72195（76.6%） | +5765 | +16302 | **+22067（23.4%）** | −22068 |

**With the same weights and the same set of datasets, 8%~23% of the total change in length is not "the model writing longer and longer" but "traffic shifted to datasets that were already long".** flash is especially clear: `code/dataset-yfch` (the longest dataset in this run, average generation length 416513 token, ranked 1st overall) had its weight share rise from 2.10% to 5.28% (+3.18pp), while its pass rate rose +34.99pp——**the reason the interaction term is positive and large for flash is mainly this one dataset**.

### 5.4 Where did the weight actually shift to

pro (the 6 with the largest share changes):

| Dataset | Share first→last | Δshare | Pass rate Δpp |
|---|---|---|---|
| code/dataset-obg8 | 9.0% → 12.2% | **+3.21pp** | −5.97 |
| code/dataset-m1dt | 11.4% → 8.3% | **−3.09pp** | **+14.10** |
| code/dataset-bvg7 | 4.6% → 3.2% | −1.39pp | −2.84 |
| code/dataset-v7yx | 2.8% → 4.1% | +1.27pp | −9.17 |
| visual/dataset-jzd3 | 2.3% → 3.5% | +1.22pp | +15.36 |
| code/dataset-sin0 | 9.1% → 8.1% | −1.04pp | +3.64 |

flash：

| Dataset | Share first→last | Δshare | Pass rate Δpp |
|---|---|---|---|
| code/dataset-yfch | 2.1% → 5.3% | **+3.18pp** | **+34.99** |
| cyber/dataset-9aui | 3.1% → 5.6% | +2.46pp | +21.20 |
| code/dataset-x7wh | 11.1% → 8.6% | **−2.55pp** | **+15.36** |
| code/dataset-m1dt | 11.3% → 8.9% | **−2.35pp** | **+17.78** |
| code/dataset-obg8 | 9.4% → 11.0% | +1.55pp | +1.21 |
| code/dataset-pt5v | 1.7% → 2.6% | +0.87pp | +11.68 |

pro and flash each have half of their datasets where "the direction of score improvement is opposite to the direction of share change" (pro 11, flash 11), but **the largest single move on the two sides is in opposite directions**: pro withdrew traffic (−3.09pp) from the fastest-improving `m1dt` and gave it to the slightly regressing `obg8` (+3.21pp), so its data mix term is negative; flash added traffic (+3.18pp) to the fastest-improving `yfch`, so its data mix term is positive. This is the direct source of the negative interaction term for pro and positive for flash in §5.1.

> **Transferable concept 3｜Simpson's paradox and composition effect (composition effect / shift-share)**
> Definition: overall mean = weighted average of group means. When **the weights themselves change over time**, the change in the overall mean can be produced entirely by "weight shifting", and can even be opposite to the true change direction of each group——this is the time-series form of Simpson's paradox. The standard test is the three-term shift-share decomposition: `ΔA = Σ s₀Δp（自身变好）+ Σ Δs·p₀（配比）+ Σ Δs·Δp（交互）`, with the three terms summing exactly.
> In this paper: pro's overall pass rate is +3.54pp; after decomposition, +3.81pp comes from each dataset improving itself, and data mix is −0.27pp; switching the weights to `held`, equal weighting, or changing the sentinel handling, the data mix term never exceeds 1pp.
> Transferable rule: **When you see "the aggregate metric is rising", first do two things——(1) find out what the weights of this aggregate are and whether they are changing; (2) freeze the weights from the first period and recompute the aggregate curve. If the curve direction is unchanged after freezing, the rise is real; if it flips, the rise is a composition effect.** One more thing: even for a metric like "length" that appears to be pure model behavior, this test must be done; in this paper its composition effect is 3× larger than that of score.

---

## 6. Per-dataset "length—score" elasticity (Question 4)

**Conclusion**: In the level regression, 14 run×dataset pairs passed 0.05 (pro 6 positive + 1 unreliable negative, flash 8 positive, among which `x7wh`@pro is pseudo-significant), but **after first differencing only 3 remain significantly positive, 5 are significantly negative, and all the rest are not significant**. So "length rises → score rises" at the dataset level **basically does not hold**.

**Plain language**: Plotting two columns that are both rising will of course show positive correlation; but what truly answers "if length rises a bit more, does score rise a bit more as well" is the difference regression, and the answer is: most datasets have no relationship.

### 6.1 Definition

- Independent variable x = `ctx_response_length/mean` / 10000, i.e. "per additional 10k token"; dependent variable y = pass rate (pp). The slope unit is **pp / 10k token**.
- Level regression uses all steps with values (pro 24, flash 30; cyber uses 14); difference regression uses the difference between adjacent steps (n one fewer).
- Leverage robustness: rerun the level regression after removing the one point whose length is farthest from the mean; if significance disappears, mark it as "pseudo-significant".
- `visual/dataset-053e` has no length data at all → cannot be done; `visual/dataset-gtav`/`ol8x` pass rate is unreliable → conclusion marked unreliable; `gtav` uses `ctx_total_length/mean` as fallback definition (already annotated in `lenKind` of the JSON).
- **chat category needs special caution**: `chat/dataset-eup7`'s length spans 18.9× in flash, `lm3t` spans 27.8×, and there is no trend (lm3t flash length sequence 1580→683→…→18977); the significance of the level regression can easily be manufactured by a single high-leverage point.

### 6.2 Grouped table (only rows with conclusions are listed; the full 25 rows are in the JSON)

| Group | pro | flash |
|---|---|---|
| **Same direction and significant** (level positive significant + difference positive significant) | `visual/dataset-jzd3` (level +8.15 pp/10k, p=0.0013; difference +9.65, p=0.010), `visual/dataset-ve5o` (+0.96, p=1.1e-8; difference +1.85, p=6.8e-5) | `visual/dataset-ve5o` (+0.91, p=2.2e-13; difference +0.63, p=0.011) |
| **Opposite** (difference significantly negative) | `chat/dataset-eup7` (difference −27.34, p=0.0041), `cyber/dataset-9aui` (−2.77, p=0.0022), `general/dataset-epqd` (−1.81, p=0.051) | `cyber/dataset-9aui`（−1.50，p=9.9e-5）、`visual/dataset-pt5v`（−1.13，p=0.064） |
| **Level rises together, difference not significant** (common trend cannot be ruled out) | `code/dataset-dnpn`, `m1dt`, `zg6q` (difference still negative sign) | `code/dataset-lm3t`、`m1dt`、`x7wh`、`zg6q`、`visual/dataset-jzd3` |
| **Neither is significant** | 13 (8 of all code, 3 general, `pt5v`, `8kb6`, etc.) | 14 |
| **Pseudo-significant** (disappears after removing one point) | `code/dataset-x7wh` (level p=0.030 → after removing point p=0.086) | None |
| **Unreliable / no data** | gtav、ol8x、053e | gtav、ol8x、053e |

### 6.3 Three facts that need to be stated separately

1. **`code/dataset-m1dt` is "level highly significant, difference negative" on both runs** (pro level +2.93 pp/10k, p=1.2e-7, difference −0.50, p=0.40; flash level +3.34, p=6.2e-13, difference −0.45, p=0.46). It is also one of the datasets with the largest pass-rate increase in both runs (+14.1 / +17.8pp). **This is the cleanest case of "level regression contaminated by a common trend"**: its length and score are both steadily rising, but after differencing out the trend, the extra rise in length at that step is not accompanied by an extra rise in score.
2. **`cyber/dataset-9aui` is "level significantly positive, difference significantly negative" on both runs**, and on flash its pass-rate slope is the steepest among all datasets (+1.076 pp/step, p=7.8e-10). It is representative of the group "trains longer and longer, but the longer it gets, the less it improves".
3. **`chat/dataset-eup7`@pro's difference slope −27.34 pp/10k token is numerically frightening, but its length range is only 0.9k~8.3k token**, and a 10k-token extrapolation far exceeds the observed range; moreover, chat-category lengths fluctuate greatly (§6.1). I put it in the "opposite" group, but mark it as **low confidence**.

---

## 7. The removal of cyber (Question 5)

**Conclusion**: The data show that before cyber was removed, it **was not a dataset that "could not learn" or "collapsed"**—its pass-rate slope was 1st overall on flash and 3rd overall on pro, and its length and entropy were in normal ranges. The closest thing to a "bad pattern" that can be found is its **negative-reward tail**: the worst within-group score at each step often came from cyber, and the fraction of steps where `critic/.../score/min` was below −0.5 ranked 1st in both pro and flash. But under the same metrics `code/dataset-yfch` is more extreme than it on several dimensions.

**Therefore my honest conclusion is: I cannot find data evidence of a "bad pattern" that clearly separates cyber from the other datasets.** What the announcement says is "bad patterns in the rollout **logs**", which is something at the trajectory **content** level; training metrics only see scalars such as length, reward, and entropy, and cannot see content.

### 7.1 Cross-section before removal (within the pro step 1~14 window, 25 datasets)

| Metric | cyber's value | cross-section mean±sd | z | Rank (1 = highest/most extreme) |
|---|---|---|---|---|
| mean pass rate | 60.16% | 56.35% ± 10.96 | +0.35 | 8 / 25 |
| pass-rate slope | +1.03 pp/step | +0.29 ± 0.70 | +1.05 | 3 / 25 |
| `pg_tis_clipfrac` mean | 7.05e-4 | 1.80e-4 ± 3.15e-4 | +1.67 | 2 / 23 |
| `pg_tis_clipfrac` max | 1.10e-3 | 3.41e-4 ± 4.77e-4 | +1.60 | 2 / 23 |
| trajectory length mean | 185958 token | 78399 ± 71279 | +1.51 | 2 / 23 |
| entropy mean | 0.4663 | 0.3818 ± 0.0822 | +1.03 | 3 / 22 |
| `critic/score/min` mean | **−0.1705** | −0.0274 ± 0.0562 | **−2.55** | 22 / 23 (lower is more extreme) |
| `critic/score/min` worst value | **−0.80** | −0.199 ± 0.245 | −2.46 | 23 / 23 |
| fraction of steps for `score/min < −0.5` | **14.29%** | 1.55% ± 3.70% | **+3.44** | **1 / 23** |
| fraction of steps for `score/min < −0.3` | 14.29% | 3.73% ± 8.30% | +1.27 | 3 / 23 (1st is yfch 35.7%) |

The same rankings are more pronounced on flash (all 30 steps): `score/min` mean −0.4897 (z=−2.92, **23/23 worst**), step fraction for `< −0.3` 66.7% (**1/23**, z=+2.83), step fraction for `< −0.5` 46.7% (**1/23**, z=+2.78), pass-rate slope +1.076 pp/step (**1/25**).

### 7.2 The known outlier `actor/code/dataset-yfch/pg_tis_clipfrac`

In `notes` it was recorded as the only stable high-side outlier. Recalculation confirms:

| Dataset | pro mean | pro max | flash mean | flash max |
|---|---|---|---|---|
| `code/dataset-yfch` | 1.45e-3 | **2.22e-3** | 1.79e-3 | **2.60e-3** |
| `cyber/dataset-9aui` | 7.05e-4 | 1.10e-3 | 6.40e-4 | 1.03e-3 |
| third (pro: `visual/dataset-ve5o`; flash: `code/dataset-m1dt`) | 2.25e-4 | 4.69e-4 | 1.90e-4 | 3.41e-4 |

**yfch is a full order of magnitude higher than cyber, and yfch survived to the end in both runs and is the dataset with the largest pass-rate increase on flash (+34.99pp).** So the feature "`pg_tis_clipfrac` is high" by itself cannot explain why what was removed was cyber rather than yfch. The rankings of the four `pg_tis_clipfrac_*` sub-buckets (`pos_high/pos_low/neg_high/neg_low`) are exactly the same: yfch 1st, cyber 2nd.

### 7.3 Three types of evidence that cannot be found

- **There is no "cyber is collapsing"**: pass rate rose from 56.39% to 64.17% over pro's 14 steps, slope +1.03 pp/step (p=0.0086); entropy rose from 0.456 to 0.492, a normal rise; `clip_ratio` shows no anomaly.
- **`actor/*/ppo_kl` and `actor/*/pg_clipfrac` are identically zero at the dataset level** (all 542 values for pro and 690 values for flash are 0), these two families **cannot be used for any inference**, and therefore cannot carry a "bad pattern".
- **The only truly unique quantity for cyber is the "negative-reward tail"**, while yfch is heavier on the same dimension (pro's `< −0.3` share 35.7% vs cyber 14.3%). **So even this cannot single out cyber on its own.**

**One-sentence conclusion**: The data can support "before cyber was removed it had a relatively heavy negative-reward tail, and had the second-highest TIS clipping rate over the entire period and the second-longest trajectories over the entire period", but **cannot support "cyber had a problem while other datasets did not"**. The "bad patterns in the rollout logs" that the announcement relied on are not visible in this batch of scalar metrics.

---

## 8. Lead / lag between datasets (Question 6)

**Conclusion**: **There is no reliable ordering.** For all 300 dataset pairs at lag = −4…+4, the mean absolute differenced cross-correlation is ≤0.022; the highest and lowest net lead scores differ by only 7~9 (against 24 opponents), and the minimum sign-test p is 0.064.

### 8.1 Evidence

| Metric | pro | flash |
|---|---|---|
| Mean cross-correlation curve (lag = −4…+4, 297~300 pairs per cell) | All \|ρ\| ≤ 0.022 | All \|ρ\| ≤ 0.014 |
| Net lead score range (each pair judged once for win/loss) | 7 (16 wins vs 9 wins) | 9 (17 wins vs 8 wins) |
| Sign-test p for the highest lead score (against 24 opponents) | 0.152（`code/dataset-zg6q`） | 0.064（`code/dataset-obg8`） |
| Maximum single-pair \|lag asymmetry \| | 1.216 (ta4j vs gtav, gtav contains sentinel 0) | 0.886（053e vs gtav） |

**The mean cross-correlation curve does not peak at all at lag 0** (pro's lag 0 is −0.011, lag −4 is +0.022), which itself is direct evidence of "no common beat".

### 8.2 The only thing resembling an "order" is inconsistent between the two runs

| Hypothesis | pro | flash |
|---|---|---|
| The harder at the start → the later the breakthrough (breakthrough step = first step where the 3-step moving average exceeds the initial value by +2pp) | ρ=0.069，n=19，p=0.78 | **ρ=0.434, n=23, p=0.039** (critical 0.413) |
| The harder at the start → the larger the final increase | ρ=−0.360，n=23，p=0.092 | ρ=−0.375，n=23，p=0.078 |

In flash, "hard ones break through later" passed the 0.05 line, while in pro it did not at all; and "hard ones rise more" was only marginal at p≈0.08~0.09 in both runs. **The two runs are inconsistent + both are marginal, so I do not treat it as evidence of curriculum structure**, and it is more likely a composite of two things: "pass rate has a ceiling + datasets with low initial values have large statistical noise".

### 8.3 Conversely, what is truly robust is that "which dataset rises more" is itself reproducible

| Test | Result |
|---|---|
| Rank correlation of Δpp for 25 datasets across the two runs | **ρ=0.582, n=25, p=0.0023** (critical 0.396) |
| The big gainers shared by both runs | m1dt（+14.10 / +17.78）、x7wh（+6.27 / +15.36）、jzd3（+15.36 / +13.00）、ve5o（+8.36 / +13.37）、zg6q（+3.35 / +8.31） |
| The non-risers shared by both runs | bvg7（−2.84 / −1.41）、v7yx（−9.17 / −4.50）、5610（−1.60 / −3.06）、8kb6（+2.72 / −4.16） |

**This is the strongest "heterogeneity genuinely exists" evidence in this paper**: training two different models in succession (pro / flash), the dataset-level strength ranking is reproducible. It also in turn supports the conclusion of §5—if data mix shifts were the main cause, the rankings of the two runs would not be this consistent.

---

## 9. The behavior of dynamic sampling (Question 7)

**Conclusion**: ① The line in the Chinese explainer that "held ≈ accepted count for the current step + previous step's carryover" **holds**, on 74.7% of (dataset × step) for pro and 86.8% for flash; the broken-chain steps are **all** "the first reporting step after a restart" (plus steps 1~3 at the chain head). ② The design intent that "the sampler withdraws traffic from datasets that have already been learned and from datasets it cannot learn at all" **is not detectable in the data**: the inverted-U regression is not significant under any of the three approaches—pooled OLS, dataset fixed effects, and nonparametric binning.

### 9.1 Verification of the held identity

Test expression: `dynsam/<cat>/dataset-<id>/num_accepted/held(t) = 同族/step(t) + 同族/carryover(t−1)`, with the decision threshold being relative error ≤5%.

| run | Holds (dataset × step) | Share | Broken-chain steps | Characteristics of broken-chain steps |
|---|---|---|---|---|
| pro | 422 / 565 | **74.69%** | 2, 3, 11, **15, 17, 23** | Steps 3, 11, 15, 17, and 23 are all "the first reporting step after a restart"; step 2 is the chain head |
| flash | 629 / 725 | **86.76%** | 3, **16, 25, 28** | Step 16 is a rerun step, 25 and 28 are first steps after a restart; step 3 is the chain head |

Broken chains are not scattered: at every broken-chain step, **almost all 24~25 datasets break at the same time** (for example, pro step 11 25/25, step 15 24/24, step 17 24/24). This shows it is a **step-level event** (the carryover chain is reset), not dataset-level noise. The statement in the Chinese explainer that "at the step after a restart this relationship does not hold and the carryover chain is reset" is confirmed, and two points can be added: **(a) the first few steps of a chain can also break (pro step 2, flash step 3); (b) pro has one more broken-chain step than "restart steps": step 2.**

### 9.2 Is the sampler "withdrawing from what has already been learned and from what it cannot learn at all"?

Three tests, all rejected:

| Test | pro | flash |
|---|---|---|
| Dataset share change vs initial pass rate (Spearman) | ρ=0.039，n=23，p=0.86 | ρ=0.065，n=23，p=0.77 |
| Dataset share change vs final pass rate | ρ=−0.118，p=0.60 | ρ=0.042，p=0.85 |
| Dataset share change vs that dataset's pass-rate change | ρ=−0.059，p=0.79 | ρ=0.062，p=0.78 |
| Inverted-U regression (pooled OLS, n=519/667): quadratic term | −0.737，p=0.81 | +0.400，p=0.89 |
| Inverted-U regression: linear term | +1.021，p=0.79 | +0.355，p=0.92 |
| Same as above, with dataset fixed effects: quadratic term | −3.398，p=0.60 | +4.817，p=0.35 |
| Middle band p∈[0.35,0.75) vs share change at the two ends (Welch t) | Difference −0.091pp, p=0.66 | Difference −0.158pp, p=0.37 |

Nonparametric binning (mean of "next-period share change" within each bin, in pp):

| Lagged-one-period pass rate | pro | flash |
|---|---|---|
| [0, 0.35) | −0.252 | +0.028 |
| [0.35, 0.45) | +0.018 | −0.147 |
| [0.45, 0.55) | −0.002 | −0.019 |
| [0.55, 0.65) | +0.012 | −0.051 |
| [0.65, 1.01) | +0.016 | **+0.280** |

The inverted U should show "negative at the two ends, positive in the middle". pro shows a negative value only in the lowest bin (−0.252), and all the rest are flat; flash is exactly the opposite, **traffic clearly flows to the easiest bin (+0.280)**. **The shapes of the two runs are inconsistent with each other, and neither matches the design intent.**

### 9.3 The case that looks like "withdrawing from what has been learned"

In pro, `code/dataset-m1dt`'s share dropped 3.09pp (the largest drop), while its pass rate over the same period rose 14.10pp (one of the largest rises); in flash, `code/dataset-x7wh` (−2.55pp, pass rate +15.36pp) and `m1dt` (−2.35pp, +17.78pp) look the same. **Looking only at these two or three points, it looks a lot like "once learned, traffic is withdrawn".** But putting them into all 23 datasets for a rank correlation gives only ρ=−0.06 (p=0.79); at the same time, flash's largest share increase (+3.18pp) went precisely to `yfch`, which had the largest pass-rate increase (+34.99pp), the exact opposite direction. **So I do not think this is a pattern; it can only be called a case.**

> **Transferable concept 4｜Dynamic sampling's sample pool shrinkage (pool shrinkage) and the "traffic share" measure**
> Definition: Dynamic sampling uses some difficulty signal to decide how many problems from each data source are "accepted" into the training batch at each step. Its usual design intent is "to shift compute from the two ends—already learned (resampling gives no gradient) and completely unlearned (all negative samples, high noise)—toward intermediate difficulty". The correct measure for testing it is not the absolute accepted count (the magnitudes of the data sources differ by one to two orders of magnitude, and the total pool itself fluctuates by a factor of 2.9 per step), but the **change in normalized share**, and one must use "difficulty lagged one period" to explain "the current-period share change".
> In this paper: the magnitude of share change is only ±0.1pp/step, and the explanatory power of the pass-rate level for it is not significant under any of the four approaches (p 0.35~0.92). At the same time, the documentation explicitly warns that the sum of accepted counts at the dataset level is systematically 10%~18% higher than `dynsam/agentic/num_accepted/step`, and the two levels use different measures.
> Transferable rule: **To judge "whether a scheduler allocates resources according to some signal", use shares rather than absolute quantities, lag one period to avoid contemporaneous endogeneity, and always include entity fixed effects** (otherwise "a big pool stays big" will eat up all the explanatory power). If all three measures are insignificant, honestly write "the data does not support this design intent", and do not tell a story with two individual cases.

---

## 10. Uncertain, overturned, and wrong-looking points

### 10.1 Existing claims corrected/overturned by this analysis

| Existing claim | Result of this analysis |
|---|---|
| `notes/09`: gtav/ol8x's exact 0 "may be an unreported sentinel" | **Confirmed to be a sentinel, and further localized: all fall on "step 1 ∪ restart-affected steps"** (pro 7/7, flash 5/5), and the `critic` score over the same period is normal. They are not scattered missed reports, but restart-coupled block missing reports |
| `metrics.json`: the held identity "the step after a restart will break; pro has 3 places, flash has 3 places" | Broken-chain steps are pro **6** places (2,3,11,15,17,23) and flash **4** places (3,16,25,28); the extra pro step 2 is not a restart step, but the chain head. The restart-affected steps themselves are pro 5 (3,11,15,17,23) and flash 3 (16,25,28) |
| `notes/09`: pro's cyber "stops reporting after step 15" | Precisely, **step 14 is the last reporting step, and from step 15 onward all are empty**, with all 42 cyber metrics being no exception |
| `notes/09` uses "equal-weight category mean" to describe overall length | This paper uses "dataset mean weighted by `num_accepted/step`", which is a different measure (this paper's pro final value is 123136 rather than 114676). Both are correct, but they cannot be mixed; the composition effect can only be defined clearly under the weighted measure |

### 10.2 Explicitly uncertain

1. **`visual/dataset-053e` cannot be used for elasticity analysis**: it has no generation length or total length metric, only prompt length. This is a reporting-measure gap, not an analysis choice.
2. **`visual/dataset-gtav`'s `critic/.../score/mean` differs from its average pass rate by 27~30pp** (pro average difference 30.09pp, flash 27.45pp), the largest among all datasets (the second-largest, ol8x, is only 8.2pp / 2.9pp, and the rest are all ≤2pp). That is, gtav's "reward score" and "pass rate" are two different things. **I was unable to explain this difference** — it may be that gtav's scoring includes partial credit, or that the questions covered by the two metrics are not the same batch. I do not draw any "performance" conclusions involving gtav.
3. **I mark `chat/dataset-eup7`@pro's differential elasticity −27.34 pp/10k tokens (p=0.004) as low confidence**: its length is only 0.9k~8.3k, and the extrapolation span of 10k tokens is more than 1.2× the observed range.
4. **`code/dataset-x7wh`@pro's level elasticity is "pseudo-significant"**: after removing one high-leverage point, p goes from 0.030 to 0.086. Conclusions like this easily arise in a regression with n=24; I single it out as a warning.
5. **Is the "negative-reward tail" cyber's "bad mode"**: in the data, cyber's `< −0.5` step share ranks 1st in both runs, but yfch is heavier on `< −0.3`, and `pg_tis_clipfrac` is even an order of magnitude higher yet survives to the end. **I tend to think "bad mode" refers to the trajectory-content level (e.g. bypassing tests, unauthorized operations, etc.), which this batch of scalar metrics cannot see**, but I cannot prove it.

### 10.3 Cannot understand / does not match

1. **I don't know what `train/passrate/passrate_0_ratio` and `passrate_1_ratio` are counting.** These two are not among the 109 Chinese explainers. pro's `passrate_0_ratio` rises monotonically from 0.92% to 6.19% (step 14), **falls back to 1.12% at step 15**, then climbs again; flash rises monotonically from 0.91% to 8.30%, and a mid-run restart **does not** reset it. It is not on the same order of magnitude at all as the same-named `dynsam/passrate/zero` (13%~17%, almost unmoving). pro's "reset at step 15" and flash's "no reset" contradict each other; both of my guesses (cumulative quantity / sliding window) are ruled out by one of the runs, so I won't guess further.
2. **The dashboard-global `train/passrate/avg_passrate` and the value we reconstruct by weighting the dataset layer are not the same thing**. The median relative difference is only 0.73% (pro)/0.90% (flash), but **the maximum reaches 7.45% (pro step 15)/5.06% (flash step 3), and the largest difference occurs exactly at the restart steps**. The reason should be that the dashboard-global value includes an **agentic pool that is not broken out at the dataset layer** (`dynsam/agentic/num_accepted/step` is on the order of about 1300~2500, the same order of magnitude as the sum of the 25 datasets). Using the identity to back-solve this pool's pass rate, pro rises from 51.23% to 58.46% (+7.23pp), flash from 47.76% to 59.37% (+11.62pp) — **faster than the increase in the visible dataset layer (+3.54 / +9.15pp)**. This back-solution relies on the assumption that "the two layers' weights can be added directly", whereas `metrics.json` clearly states that the two layers have different definitions (the sum of the dataset layer is systematically 10%~18% higher than the agentic layer), so **this back-solution can only serve as an explanatory clue and cannot be used as a number**.
3. **`env/possible_leak` becomes 1 at pro's steps 19~22 and is 0 everywhere else** (flash is 0 throughout). This is a count, not a ratio; I don't know what it counts, nor why it appears only in pro's final stage. It appears **after** cyber is removed, so it is unrelated to cyber, but it may be the same kind of thing as the "bad mode" in the announcement. Leave it for the next round.

---

## 11. Terminology quick-reference table

| Term | One-sentence plain-language definition |
|---|---|
| `train/passrate/avg_passrate/<cat>/dataset-<id>` | The batch of questions from this dataset that enter training at this step; the per-question success ratio over 16 samples, then averaged across questions (= this dataset's "average score") |
| `dynsam/<cat>/dataset-<id>/num_accepted/step` | The number of questions the sampler "accepts" from this dataset at this step and actually sends into the training batch (= traffic) |
| `.../num_accepted/held` | The number of questions from this dataset currently remaining in the task pool that have not yet been consumed |
| `.../num_accepted/carryover` | The number of questions left in the pool at the previous step and carried over to this step |
| `dynsam/avg@n` | The homepage main metric, the cross-question average of per-question "success count/16"; not equal to "the proportion of questions answered correctly" |
| `dynsam/passrate/zero` | The proportion of questions for which all 16 attempts **never succeeded** (difficulty lower bound); available globally, not at the dataset layer |
| `ctx_response_length/mean` | How many tokens a trajectory generates on average (unit: token) |
| `actor/.../entropy_loss` | Policy entropy; lower means more deterministic output (at the dataset layer, it is this dataset's policy entropy at this step) |
| `pg_tis_clipfrac` | The proportion of samples clipped in truncated importance sampling; larger means greater disagreement between the trainer and the inference engine on the same batch of tokens (more offline/stale data) |
| `critic/.../score/min` | The score obtained by the **worst** trajectory for this dataset at this step, used to measure the negative-reward tail |
| Simpson's paradox / composition effect | Overall mean = group mean × weight; when the weights change, the overall can move in the opposite direction from all groups |
| shift-share three-term decomposition | `ΔA = Σs₀Δp + ΣΔs·p₀ + ΣΔs·Δp`, exactly decomposing the total change into "own improvement / mix shift / interaction" |
| Sentinel value (sentinel) | Use 0 or some fixed value to substitute for "this item was not reported"; not a real measured value |
| High-leverage point (leverage) | A single observation that is too far outlying in the independent-variable direction; it can make the slope in a small-sample regression significant yet spurious |

---

## Appendix: Core numbers (for comparison in the next version)

**Checklist**

| Item | pro | flash |
|---|---|---|
| Number of steps / number of datasets | 24 / 25 | 30 / 25 |
| Category distribution | code 11、visual 6、general 4、chat 3、cyber 1 | Same as left |
| Datasets with holes in the pass-rate series | None (except for the entire missing tail of cyber) | None |
| cyber's last reported step | 14 (all 42 metrics stop) | 30 (33 out of 34; the other 1 reaches 20) |

**Classification**

| Category | pro | flash |
|---|---|---|
| Clearly learned | 6 | 9 |
| Slowly improving | 6 | 8 |
| Stalled | 7 | 3 |
| Degraded | 4 | 3 |
| Unreliable (sentinel 0) | 2 | 2 |

**Composition effect (weighted by `num_accepted/step`, three-term shift-share)**

| Metric | run | Total change | own improvement | Data mix | Interaction | Data mix + interaction |
|---|---|---|---|---|---|---|
| Pass rate | pro | +3.544pp | +3.813（107.6%） | +0.162 | −0.431 | −0.269（−7.6%） |
| Pass rate | flash | +9.149pp | +8.307（90.8%） | +0.008 | +0.835 | +0.843（+9.2%） |
| Generation length | pro | +58110 token | +53293（91.7%） | +2292 | +2525 | +4818（8.3%） |
| Generation length | flash | +94262 token | +72195（76.6%） | +5765 | +16302 | +22067（23.4%） |

**Dashboard-global vs dataset-layer reconstruction**

| Item | pro | flash |
|---|---|---|
| Dashboard-global Δ (step 1 → last step) | +4.443pp | +9.952pp |
| Dataset panel Δ (same first step to last step) | +3.544pp | +9.150pp |
| Difference | −0.899pp | −0.802pp |
| Maximum per step \|Difference\| | 4.144pp @ step 15 | 2.788pp @ step 16 |
| The steps with the largest differences | 15, 17, 23, 1, 2, 21 | 16, 3, 1, 28, 25 |
| Back-solved pass-rate change of the agentic pool | +7.23pp | +11.62pp |

**dynsam identity and traffic redistribution**

| Item | pro | flash |
|---|---|---|
| `held = step + carryover(t−1)` hold rate | 74.69%（422/565） | 86.76%（629/725） |
| Broken-chain steps | 2, 3, 11, 15, 17, 23 | 3, 16, 25, 28 |
| Restart-affected steps | 3, 11, 15, 17, 23 | 16, 25, 28 |
| Δ share vs initial pass rate (ρ, p) | +0.039, 0.86 | +0.065, 0.77 |
| Inverted-U quadratic term p (mixed / fixed effects) | 0.81 / 0.60 | 0.89 / 0.35 |

**Cross-run consistency**: rank correlation of Δpp across the 25 datasets ρ=0.582 (p=0.0023, critical 0.396).

**Lead/lag**: average cross-correlation \|ρ\| over all lags ≤ 0.022 (pro) / 0.014 (flash), with 297~300 pairs per lag; net lead score range 7 / 9 (opponent 24).
