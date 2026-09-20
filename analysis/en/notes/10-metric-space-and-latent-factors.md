# Metric space and latent factors: those 2000 metrics are actually equivalent to a few curves

> Material identity: **our own measurements**. Data comes from local read-only telemetry `data/store/`; all numbers are computed on the fly by script `src/factor_report.ts` from the raw JSON, and the script does not hard-code any conclusion numbers; running `bun src/factor_report.ts` (project root) reproduces everything in one click and also writes `analysis/zh-CN/numbers/A3-factor-numbers.json`.
> Data cutoff: **pro step 24 (2026-09-19 08:58:10Z snapshot), flash step 30 (2026-09-19 03:07:03Z snapshot, already ended)**.
> Sample size is extremely small: pro has only 24 time points, flash 30. The correlation matrix is estimated on 1389 / 1465 metrics, which is a high-dimensional small-sample case where "variables outnumber samples by two orders of magnitude"; eigenvalues and loadings both have large sampling noise, and the robustness checks in Section 3 are a part of this report that cannot be skipped.
> Relation to existing material: `analysis/en/notes/09-generation-length-correlation.md` has already done level correlation and first differencing from the angle of "what is length correlated with"; this report does the **structure of the metric space itself** (dimensionality, latent factors, redundancy, phases, partial correlation, cross-run alignment), intersecting with it at only one necessary point in Section 5, as noted.

---

## 1. Summary

1. **The effective degrees of freedom of this dashboard are 11–13, not 2000.** After standardizing each of pro's 1389 analyzable metrics (coverage ≥80% and non-constant) and computing the correlation matrix, the participation ratio (explained in the glossary below) is **11.21**; for flash it is **12.99** (after truncating to the same 24 steps, **12.12**). Explaining 80% of variance requires **14** principal components for pro and **17** for flash (also 14 after truncating to 24 steps), and 90% requires **18 / 22** respectively. **In one sentence: about 2000 metrics are roughly equivalent to 12 independent curves**, and the rest are sliced copies of these curves and noise.

2. **At minimum 15 metrics can reproduce 83% of the dashboard's total variance, and 20 can reach 95%.** Using "variance-greedy forward selection" (at each step, pick the metric that makes the remaining variance drop the most) over pro's full 1389 metrics: the cumulative explained variance at the 5th / 10th / 15th / 20th metric is **51.1% / 69.2% / 83.5% / 94.8%**. Using only 285 "root-level aggregate metrics" (the layer without dataset id, without freshness bucket number, without harness letter) gives almost the same result (**51.0% / 68.7% / 82.8% / 94.5%**). For flash the corresponding values are 47.7% / 62.5% / 74.6% / 85.0%.

3. **The first two principal components account for more than one third of the variance, and the two runs align.** For pro, PC1 accounts for **21.0%** and PC2 for **14.6%**; for flash it is **18.6% / 14.8%**. Pairing by cosine of loading vectors, pro PC1↔flash PC1 **|cos|=0.799** and PC2↔PC2 **0.793**; after truncating to the same 24 steps it is **0.759 / 0.696**. By PC3 it drops to **0.449** (0.248 after truncating to 24 steps), and PC4 is only **0.269**. **The two runs share only two macro factors; from the third onward, they are each their own operational details.**

4. **The "large number" of metrics is mainly duplication at the naming level, not redundancy at the signal level.** Of the 1389 analyzable metrics, **1072 (77.2%)** belong to "only the slice differs" copy groups (the same metric split by dataset, by harness letter, by freshness bucket; for flash it is 1159/1465 = 79.1%). But statistically they are not highly redundant: the median |ρ| between any two metrics is only **0.187** (flash 0.167), and metric pairs with |ρ|≥0.9 account for only **0.41%**. Another **294 metrics are constant** (15.1% of the original 1944), of which **224 are identically zero**, almost all in the `pg_clipfrac` / `ppo_kl` family.

5. **The correlation between length and score is a common time trend, while the correlation between data staleness and global KL is not.** After controlling for step number (residual method): `ctx_response_length/mean` (average generation length this step) and `dynsam/avg@n` (main average pass rate metric) go from **0.766 → −0.013** (pro), **0.920 → −0.140** (flash); whereas `partial/avg_staleness` (average staleness of this step's data) and `train_infer_diff/new_infer/kl` (numerical divergence between trainer and inference engine) go from **0.923 → 0.941** (pro), **0.866 → 0.892** (flash), with **no shrinkage**. Equally counterintuitive, `actor/entropy_loss` (policy entropy loss) and `avg@n` **change sign** after controlling for trend: 0.578 → **−0.620** (pro), 0.889 → **−0.395** (flash).

6. **The vast majority of "phases" are ops events, not changes in model state.** Performing breakpoint detection on PC1-3 coordinates, the largest breakpoints for both pro and flash fall at **step 15** (pro's restart is exactly at step 15 on the wall clock, difference 0 hours), and the displacement **returns to the original level** within 3 steps (return ratio pro **0.97**, flash **0.93**) — this is an instantaneous shock from the restart flushing the queue, not a step change. The remaining candidate breakpoints after detrending also all line up within 0–4 hours with a restart or version switch (pro step 23: displacement 2.56, most recent restart at the same step, most recent version switch 1.09 hours away; what moved was `env/active` and the length truncation rate, i.e., dataset composition).

---

## 2. Methods and Data Sources

| Item | Content |
|---|---|
| Data files | `data/store/runs/pro/series.json` (1944 metrics × 24 steps), `runs/flash/series.json` (1974 × 30), the two people's `axis.json` / `status.json` / `tags.json`, `data/store/notices.json`, `content/metrics.json` (109 Chinese per-metric explainers, used to name metric families) |
| Collection time | pro snapshot 2026-09-19 08:58:10Z (3965 seconds after step 24 completed, still in rollout); flash snapshot 2026-09-19 03:07:03Z (after step 30, run has ended) |
| Unit of analysis | **Metric × step** matrix; each column (one metric) is first z-scored on its own (subtract mean, divide by population standard deviation), then the correlation matrix and eigendecomposition are computed. Therefore identities that hold at the absolute-value level do not necessarily hold after standardization; Section 5 deals with this specifically |
| Missing-data convention | 7.86% of raw cells (pro) / 7.43% (flash) are null. **Main convention: coverage ≥80%** (pro requires ≥20/24 steps non-empty, flash requires ≥24/30); after passing, perform **linear interpolation** (take the nearest known value at both ends), then z-score. → 1389 for pro and 1465 for flash enter the analysis |
| Exclusions | Insufficient coverage: pro 261 / flash 232; **zero variance (constant)**: pro 294 / flash 277 (zero variance cannot be standardized and must be excluded; it is not "missing data") |
| Eigendecomposition | Self-written Jacobi cyclic rotation (script self-check `max|Av−λv| = 9.3e-15`） |
| Clustering | distance = `1 − |ρ|`, average linkage (UPGMA). Script self-check: the self-written "nearest-neighbor cache greedy" and naive O(n³) average linkage on n=60 random points give **ARI = 1.0000** (initially used nearest-neighbor chain NNC; self-check found that for UPGMA it converges to local mutual nearest-neighbor pairs, not global nearest pairs; replaced) |
| Breakpoint | Greedy binary segmentation on principal component coordinates (PC1-3, each standardized to unit variance), with acceptance condition `RSS 降幅 > dim·ln(N)·σ²` (BIC-style); also provide an **unpenalized** per-position statistic ranking, so that conclusions do not depend on penalty strength |
| Partial correlation | Control variable = step index (0-based). Each of the two series is regressed on the step index by least squares, residuals are taken, then Pearson is computed. This is the standard way to see "how much relationship remains after removing the common linear trend". |
| Recompute | `bun src/factor_report.ts`, about 5 seconds, output all numbers and write `A3-factor-numbers.json` |

**Definition of metric family** (used throughout this report for merging): the template obtained by replacing `dataset-xxxx` in the metric name with `dataset-<id>`, `partial/3/` with `partial/<k>/`, `harness-A` with `harness-<x>`, and the category segment (agentic/chat/code/visual/general/cyber) with `<cat>`. For example, the family of `ctx_response_length/code/dataset-bvg7/mean` is `ctx_response_length/<cat>/dataset-<id>/mean`.

---

## III. First remove "mechanical structure": which things necessarily occupy dimensions and do not count as findings

> **Conclusion**: There are indeed three types of mechanical relationships on this dashboard, but **after standardization, they do not each occupy an independent principal component**; they appear as "two copies of the same signal".

**Plain English**: Several numbers on the dashboard are computed from other numbers, so looking at them is equivalent to repeatedly looking at the same number. But because I analyze by "standardizing each metric separately", these identities no longer hold exactly after standardization, so they do not dominate everything as they would on the original scale. Remove them and look again, the spectrum shape barely moves.

**Evidence table**

| Mechanical relationship | Recompute results (pro / flash) | Handling |
|---|---|---|
| `ctx_total_length/*/mean ≈ ctx_prompt_length/*/mean + ctx_response_length/*/mean` (total context length = prompt length + generation length) | 22 groups, **maximum residual 0.920 / 0.960 token** (negligible relative to means of hundreds of thousands of tokens) | After removing `ctx_total_length/*` (102 of them), look at the spectrum again |
| `Σ_k partial/<k>/frac = 1` (the sum of token fractions across the 8 freshness buckets is identically 1) | Maximum deviation **1.00e-6 / 1.12e-6** | Retained as redundant evidence; removal method see below |
| Global `train_infer_diff/new_infer/kl = Σ_k partial/<k>/frac × partial/<k>/…/kl` | Maximum absolute deviation **1.19e-5 / 1.14e-5** (relative to 0.148% / 0.151%) | Same as above |
| `partial/<k>/n_tokens = frac × 本步 token 数` | Jointly determined by the frac summation identity and `perf/total_num_tokens` | Removed together |

**After removal the spectrum barely changed**: pro went from d=1389 down to d=1294, PC1 changed from 21.0% to **20.5%**, n80 is still 14, participation ratio changed from 11.21 to **11.34**; flash went from 1465 down to 1361, PC1 changed from 18.6% to **17.7%**, n80 is still 17, PR 13.0 → 13.16. **In other words, no principal component was "created" by the identities.**

**But the identity family is still a pair of twins in the standardized space**: the average |ρ| between `ctx_total_length/<cat>/mean` and `ctx_response_length/<cat>/mean` is **0.947 (pro) / 0.970 (flash)**, whereas between it and `ctx_prompt_length/<cat>/mean` it is only **0.276 / 0.172**. The reason is straightforward: `ctx_prompt_length/mean` over the whole period is only in the range 3964～4489 token (coefficient of variation **2.85%**), while response length is in the range 65100～114700 (coefficient of variation **14.0%**). **The total length line is effectively plotting generation length**; prompt length has almost no information content. Displaying both `ctx_total_length` and `ctx_response_length` on the dashboard is redundant, while displaying `ctx_prompt_length` is nearly constant.

The other two, "not identities but close": `training/global_step` is just the step number itself from 1..24 (mean 12.5, standard deviation 6.922, perfectly collinear); `dynsam/num_target` is identically equal to 1568 over the whole period (zero variance), so its correlation with other metrics is undefined (reported as NaN in the script). Metrics that genuinely "move monotonically with time" are few: only **13 (0.9%, pro) / 27 (1.8%, flash)** have |corr|≥0.95 with the step index.

---

## IV. Effective dimensionality: eigenvalues and participation ratio

> **Conclusion**: pro's effective degrees of freedom is **11.21**, flash **12.99** (12.12 when both have 24 steps). The first 5 components explain 53.1% for pro and 49.6% for flash; reaching 80% requires 14 (pro) / 17 (flash) components.

**Plain English**: Principal component analysis recombines many curves into "mutually uncorrelated new curves"; the first new curve explains the most variance, then decreasing. If 2000 metrics really each spoke for themselves, the variance would be spread evenly across many components; if they are actually repeating a few things, the first few components will eat up most of the variance. The "participation ratio" compresses the whole eigenvalue spectrum into one number: the more concentrated the variance is in a few components, the smaller it is. What it answers is "the number of equivalent independent signals".

**Evidence table**

| Metric | pro（d=1389, N=24） | flash（d=1465, N=30） | flash truncated to 24 steps |
|---|---|---|---|
| PC1 / PC2 / PC3 variance share | 21.0% / 14.6% / 7.0% | 18.6% / 14.8% / 6.4% | 20.2% / 12.9% / 7.3% |
| First 5 components cumulative | 53.1% | 49.6% | 51.0% |
| Number of components needed to explain 80% / 90% / 95% | 14 / 18 / 20 | 17 / 22 / 26 | 14 / 19 / — |
| Participation ratio (Σλ)²/Σλ² | **11.21** | **12.99** | **12.12** |
| After removing mechanical families | 11.34（d=1294） | 13.16（d=1361） | — |
| PC1 score and step index \|corr\| | 0.822 | 0.888 | — |
| PC1 / PC2 after per-metric linear detrending | 18.9% / 10.3% | 17.6% / 9.3% | — |
| Pure noise upper edge (1+√(d/(N−1)))² | 76.9 | 65.7 | — |
| Number of components exceeding the noise upper edge | 23 (= all nonzero) | 30 (= all nonzero) | 23 |

Two reading traps that must be made clear:

- **n80 cannot be compared directly across runs.** flash has more time points (30 vs 24), so its upper limit on resolvable components is inherently higher; therefore part of its n80=17 is due to "more points" rather than "more complexity". After truncating flash to the first 24 steps, n80 is also **14**, on par with pro; participation ratio 12.12 vs 11.18, and the gap shrinks from 1.78 to 0.93.
- **The "pure noise upper edge" comparison does not constitute a filter on this data.** What it gives is "how large an eigenvalue could be at most if all metrics were mutually uncorrelated" (pro 76.9). The actual smallest nonzero eigenvalue is also far above it, so all 23 components **all** have structure——but this "structure" includes common trends and operational shocks, and does not equal 23 independent scientific discoveries. Effective dimensionality should be based on the participation ratio / 80% criterion.

**Intuitive conclusion: 2000 metrics ≈ 12 independent curves.** Of these, the first 2 (together ~35%) are macro factors, the 3rd～14th are the respective signals of each subsystem, and the rest are slice copies of the same curve and small-sample noise.

---

## V. Latent factors: what the first 5 principal components are saying

> **Conclusion**: PC1 is the "scale and length axis of training progress" (collinearity with step index 0.82/0.89); PC2 is "data freshness and sampling flow mix"; PC3 and beyond are grading/selection process details and the lower tail of reward, and the two runs already fail to match by PC3.

**Plain language**: Each principal component is a weighted combination of many metrics; the metrics with large weights (loadings) are what this component is mainly plotting. Note that the loadings themselves are very "flat"—the maximum loading is about 0.05～0.09, while under complete uniformity it is 1/√1389 ≈ 0.027—so no single metric can represent a component on its own. To avoid the illusion of "whichever family has more members gets on the list," I also report the **enrichment factor**: a family's share of loadings in this component ÷ its own share of the metric count; only greater than 1 counts as overrepresentation.

### PC1 (pro 21.0% / flash 18.6%): progress and length axis

- The batch with the largest loadings (pro): `+0.054 train/adv_neg_sum_pre_penalty`, `+0.054 train/adv_neg_sum_post_penalty`, `−0.054 perf/total_num_tokens`, `−0.054 ctx_total_length/mean`, `−0.054 ctx_response_length/mean`, `−0.050 ctx_total_length/general/dataset-trla/max`, `−0.050 timing_s/trainer_ops` (trainer time for this step).
- The same component for flash has the opposite sign (paired cosine **−0.799**): `+0.059 train/adv_pos_sum_pre_penalty`, `+0.059 perf/total_num_tokens`, `+0.059 ctx_total_length/mean`, `+0.058 timing_s/trainer_ops`, `−0.057 train/adv_neg_sum_*`.
- Enrichment factor (pro): `ctx_response_length/<cat>/dataset-<id>/mean` **×2.3**, `actor/<cat>/…/pg_tis_clipfrac` **×2.3**, `ctx_total_length/<cat>/dataset-<id>/mean` ×2.2; flash: `ctx_response_length/…/mean` **×3.3**, `ctx_total_length/…/mean` **×3.2**, `actor/<cat>/…/entropy_loss` ×2.0.
- Evidence supporting the name "progress and length axis": score vs. step index |corr| 0.822 (pro) / 0.888 (flash); the largest-loading items also include total token count, context length, trainer time, and sum of advantages—quantities that "amplify with training." **It is a trend, but not a pure time axis** (0.82 is not 1.0); length and truncation structure are also mixed in.

### PC2 (pro 14.6% / flash 14.8%): data freshness and sampling traffic mix

- pro: `+0.066 dynsam/visual/dataset-gtav/num_accepted/step` (number of tasks accepted by the sampler at this step), `+0.066 train/trace/files`, `+0.065 train/trace/writer_seconds_sum`, `+0.064 partial/code/dataset-zg6q/0/n_tokens` (token count of the freshest bucket), `+0.061 penalty/…/harness-A/groups_judged`.
- flash：`+0.065 dynsam/num_measurable`、`−0.062 env/general/dataset-trla/active`、`+0.061 partial/0/n_tokens`、`+0.061 penalty/…/groups_total`。
- Enrichment factor: pro `partial/<cat>/…/0/n_tokens` **×4.1**, `dynsam/<cat>/…/num_accepted/step` **×3.2**, `partial/<cat>/…/avg_staleness` ×2.7, `partial/<cat>/…/0/frac` ×2.7; flash same family ×4.5 / ×4.3 / ×4.1 / ×4.0. **The two runs are highly consistent on this component** (paired cosine 0.793, truncated to 24 steps 0.696), so the name can be assigned with confidence.
- The score vs. step index |corr| is only 0.477 (pro) / 0.328 (flash), so it is a "non-trend" real fluctuation axis.

### PC3 (pro 7.0% / flash 6.4%): quota/conflict in the grading and selection process

- pro: `+0.082 train/verdicts/carried`, `+0.075 penalty/stage_credit_group/harness/harness-D/select_rank_invalid`, `+0.071 …/select_tier_mismatch`, `+0.065 …/select_r2_flagged`, `+0.065 critic/code/dataset-4onq/score/mean`, `+0.062 penalty/…/select_v4/time_total_sec_mean` (time spent in each grading stage), and `−0.063 partial/0/train_infer_diff/new_infer/F(tau=10)`.
- flash：`+0.075 penalty/…/harness-A/select_renorm_k_mean`、`−0.069 penalty/…/select_v4/select_score_S_mean`、`+0.069 …/select_rank_score_conflict`、`−0.069 …/select_tier_share_T1`。
- The paired cosine is only **0.449** (truncated to 24 steps **0.248**): the third factor of the two runs is already describing **different grading details** (pro describes "selection failure/level mismatch," while flash describes "score renormalization/rubric-tier share"). The name holds for pro; for flash it can only be called the "grading quota axis."

### PC4 (pro 5.7% / flash 5.6%): the two sides of the grading success rate

pro: `+0.079 penalty/…/select_v4_nogold/end2end_success_rate`, `+0.078 …/pass1_success_rate`, `+0.077 …/select_hack_attempt_rate` versus `−0.078 penalty/…/harness-D/groups_failed_select`, `−0.075 penalty/…/groups_failed_select`. That is, "grading success" and "dropping groups at the selection stage" are the two ends of the same axis. Enrichment factor: `dynsam/…/num_accepted/held` ×2.0 (tasks held), `select_v4_nogold/<metric>` ×1.9. Paired cosine 0.269.

### PC5 (pro 4.9% / flash 4.2%): length truncation and reward lower tail

pro: `+0.093 critic/code/dataset-v7yx/advantages/min`, `+0.093 …/returns/min`, `+0.091 …/rewards/min`, `+0.091 …/score/min` (the four "minimum" metrics of the same dataset move together, indicating that they themselves are four copies of one signal), paired with `−0.089 ctx_prompt_length/general/dataset-5610/max`, `−0.089 ctx_total_length/code/dataset-dnpn/clip_ratio` (truncation rate). Enrichment factor: `ctx_total_length/<cat>/…/clip_ratio` ×3.5, `critic/<cat>/…/*/min` ×2.4～2.6. flash's PC5, by contrast, is `partial/<cat>/…/1/frac` (share of staleness bucket 1) and sampler carryover, and the paired cosine is only 0.101～0.113, **basically run-specific things**.

---

## 6. Redundancy structure: one giant background + several tight small clusters

> **Conclusion**: At the top level, the clustering is almost inseparable—one cluster in pro holds 847/1389 (after detrending), and under raw correlations it holds as many as 1069/1389 (77%), with all top-level merge distances above 0.7. **The "8～15 clusters" cut is a usable reading tool, but it is not a natural partition present in the data** (the median ARI of leave-one-step reruns is only 0.53/0.55).

**Plain language**: Hierarchical clustering first merges the two most similar metrics, then the next most similar. If there really were several "families" in the data, the last few merges would occur at very low distances, forming clear blocks. This dashboard is not like that: the vast majority of metrics are only weakly positively correlated with each other (median |ρ| 0.19), and in the end everything is strung into one big clump by a single "background correlation," with small clusters hanging outside the big clump.

**Evidence table (raw |ρ| distribution)**

| Metric | pro | flash |
|---|---|---|
| Number of metric pairs | 0.96M | 1.07M |
| \|ρ\| Median / quartile | 0.187 / [0.088, 0.328] | 0.167 / [0.078, 0.296] |
| \|ρ\|Share of pairs with ≥0.98 / ≥0.95 / ≥0.90 / ≥0.80 | 0.08% / 0.18% / 0.41% / 1.24% | 0.06% / 0.16% / 0.40% / 1.13% |
| After detrending \|ρ\| Median | 0.169 | 0.153 |
| K=12 (raw correlation) largest cluster | 1069/1389 = **77.0%** | 1102/1465 = **75.2%** |
| K=15 (detrended) largest cluster | 847/1389 = **61.0%** | 1016/1465 = **69.4%** |
| Top-level merge distance (1−\|ρ\|） | 0.783～0.817 | 0.818～0.835 |

### 6.1 Which families are actually different copies of the same signal

Group metrics whose keys differ only by the "slice segment" (same metric × dataset × harness letter × freshness bucket), yielding **101 groups (pro, covering 1072 metrics = 77.2%) / 103 groups (flash, 1159 metrics = 79.1%)**. The median within-group mean |ρ| is only **0.260 (pro) / 0.282 (flash)**—**the names are copies, but the values are not necessarily copies**.

| Copy groups (pro) | Number of copies | Within-group mean \|ρ\|(Raw / detrended) |
|---|---|---|
| `dynsam/<cat>/dataset-<id>/num_accepted/step` | 24 | **0.723 / 0.758** ← truly highly synchronized |
| `dynsam/<cat>/dataset-<id>/num_accepted/carryover` | 24 | 0.398 / 0.422 |
| `dynsam/<cat>/dataset-<id>/num_accepted/held` | 24 | 0.370 / 0.415 |
| `train/passrate/avg_passrate/<cat>/dataset-<id>` | 24 | 0.199 / 0.184 |
| `ctx_total_length/<cat>/dataset-<id>/mean` | 23 | **0.606 / 0.232** ← the correlation almost entirely comes from a common trend |
| `critic/<cat>/dataset-<id>/rewards/mean` | 23 | 0.204 / 0.176 |

In addition, `penalty/stage_credit_group/harness/harness-{A,B,C,D}/<metric>` is **the same set of 74 grading metrics recorded once on each of 4 harnesses** (296 in total for pro), and `critic/<cat>/dataset-<id>/{rewards,score,advantages,returns}/{min,max,mean}` is the same batch of statistics recorded once on each of different datasets (see the PC5 example: the four min loadings of `critic/code/dataset-v7yx` appear together, differing by no more than 0.002).

**Near-duplicate connected components** (connecting metrics into groups under an |ρ| threshold): at |ρ|≥0.999, pro has 1116 groups (largest 6); ≥0.99 has 1008 groups (largest 10); ≥0.98 has 940 groups (largest 19); ≥0.95 has 798 groups (largest 45, the `dynsam/agentic/num_accepted/step` family); ≥0.9 has 638 groups (largest 220, the `actor/…/pg_tis_clipfrac` family). **Once the threshold is loosened, the largest group expands explosively**, which is another piece of evidence for "no clear blocks."

### 6.2 Minimum number of metrics needed

**Method**: Does not rely on subjective selection; uses "variance-greedy forward selection"—at each step, among all candidate metrics, it picks the one whose "own direction can explain away the most remaining variance"; after selecting k of them, it reports cumulative explained variance. This is equivalent to using the subspace spanned by k metrics to approximate the entire matrix.

| Number of selected metrics | 5 | 10 | 15 | 20 |
|---|---|---|---|---|
| pro full set of 1389 candidates | 51.1% | 69.2% | **83.5%** | **94.8%** |
| pro using only 285 root-level aggregate metrics | 51.0% | 68.7% | **82.8%** | **94.5%** |
| flash full set of 1465 candidates | 47.7% | 62.5% | 74.6% | 85.0% |

**Conclusion: using only root-level aggregate metrics can achieve almost the same explanatory power as the full set**, so the list of 15 metrics below can be used directly as a "minimal dashboard" (the order is the greedy selection order; the parentheses give the marginal increment of each additional one):

| # | Metric | One-sentence Chinese explanation | Marginal explained variance |
|---|---|---|---|
| 1 | `ctx_total_length/agentic/mean` | Average total context length for agentic tasks (≈ generation length) | +19.2pp |
| 2 | `partial/agentic/0/frac` | Token share of the freshest bucket (bucket 0) in the batch | +14.0pp |
| 3 | `penalty/stage_credit_group/groups_total` | Total number of task groups entering the grading stage at this step | +6.8pp |
| 4 | `ctx_total_length/agentic/clip_ratio` | Proportion of agentic trajectories truncated by the length limit | +5.6pp |
| 5 | `penalty/stage_credit_group/select_v4_nogold/select_score_S_mean` | Average S-item score for v4 without the gold-standard selector | +5.4pp |
| 6 | `ctx_total_length/clip_ratio` | Proportion of all trajectories truncated | +4.3pp |
| 7 | `critic/agentic/rewards/mean` | Average reward for agentic tasks | +3.6pp |
| 8 | `train_infer_diff/new_infer/diff_abs_mean` | Mean absolute value of the log-prob difference between the trainer and the inference engine (numerical consistency) | +3.6pp |
| 9 | `penalty/…/select_v4_nogold/groups_judged` | Number of task groups already graded | +3.2pp |
| 10 | `ctx_response_length/agentic/max` | Generation length of the longest agentic trajectory | +3.0pp |
| 11 | `env/possible_leak` | Count of suspected environment leakage | +3.0pp |
| 12 | `penalty/signed/neg_scale` | Scaling coefficient of the negative-advantage penalty | +2.9pp |
| 13 | `partial/agentic/avg_staleness` | Average staleness of agentic data (how many policy versions apart) | +2.8pp |
| 14 | `dynsam/passrate/zero` | Proportion of problems that are all wrong (not a single correct attempt) | +2.8pp |
| 15 | `penalty/…/select_hack_attempt_ge_min_rate` | Rate at which the suspected cheating-attempt proportion exceeds the threshold | +2.7pp |

These 15 cover the main directions in the greedy sense; if you also want to save face for the "grader group statistics" family (it is enriched on PC3/PC4), just add another 2–3 `penalty/stage_credit_group/<metric>` and `train/trace/*` to reach 20 and 95%. **The ~1370 metrics that did not make this list contribute only 5% of the variance in total.**

**Cluster representatives (detrended clustering K=15, by cluster size)**—as a complementary "one per cluster" view: `partial/agentic/0/n_tokens`(847), `train/trace/drain_wait_seconds`(128), `penalty/…/select_process_severe`(124), `train/harness/harness-H/training/nonzero_adv_rate`(63), `penalty/stage_credit_group/pass1_success_rate`(62, average within-cluster \|ρ\| **0.68**, the only relatively tight cluster), `train/verdicts/expired`(50), `penalty/…/select_tier_share_H`(34), `train/harness/harness-P/training/advantage_mean`(19), `ctx_response_length/agentic/min`(18), `actor/code/dataset-dnpn/pg_loss`(18), `train/harness/harness-G-pw/training/nonzero_adv_rate`(14), `penalty/…/select_adv_group_sum_abs_mean`(9), and three singleton clusters `actor/clip_high`, `actor/clip_low`, `training/global_step` (the latter is the step number itself).

---

## 7. Step phasing: who caused these "phases"

> **Conclusion**: Almost all identifiable phase boundaries line up with ops events; **for change points that line up with restarts, the displacement falls back within 3 steps (fallback ratio ≈1); this is the transient shock of "a restart flushing the queue"; the few persistent steps that remain after detrending correspond to dataset additions/removals and version switches.**

**In plain terms**: Two things can make the curve "change shape" at a certain step: the model changes (it learned something new, and the step will persist), or ops resets the pipeline (restart, version change, dataset addition/removal; the curve jumps and then returns to its original trajectory). The way to distinguish them is to see whether it comes back after the jump, and whether the jump location lines up in time with the restart/version change.

**pro evidence**

| Change point (first step of a new phase) | Displacement (Euclidean distance in PC1-3 space) | Fallback ratio within 3 steps | Nearest ops event | Family dominating the change |
|---|---|---|---|---|
| Step 15 (raw PC coordinates, statistic 19.1, largest overall) | 1.94 | **0.97 (fully reverted)** | **Restart is exactly at step 15 (difference 0h)** | `train/passrate/*`、`train/harness/harness-D-pw/training/{rollouts,trained_rollout_share}` |
| Step 16 (raw) | 1.33 | 1.15 | Restart at step 15 (difference 2.2h) | `train/trace/outcome_write_seconds`、`critic/advantages/mean` |
| Step 4 (detrended, statistic 6.0) | 2.10 | 0.62 | Restart at step 3 (difference 1.9h) | `partial/<cat>/0/frac`、`partial/<k>/train_infer_diff/nll_loss/*` |
| Step 23 (detrended, statistic 4.7) | 2.56 | — (to the end) | **Restart is also at step 23 (difference 0h)**; version switch to `3-5513.22.12.23` differs by 1.09h | `env/active`、`env/<cat>/shared/active`、`ctx_total_length/<cat>/clip_ratio` |

**flash evidence**

| Breakpoint | Displacement | Fallback ratio | Nearest event | Dominant family |
|---|---|---|---|---|
| Step 15 (raw, statistic 24.9, largest) | 1.60 | **0.93 (reverted)** | Restart at step 16 (difference 8.5h) | `ctx_total_length/<cat>/max`、`ctx_response_length/<cat>/max`、`dynsam/infra_error/seq_rate` |
| Step 16 (raw) | 1.23 | 1.12 | Restart is also at step 16 (difference 0h) | `dynsam/infra_error/seq_rate`、`env/total_setup` |
| Step 25 (detrended, statistic 8.2) | 1.89 | 0.73 | **Restart is also at step 25 (difference 0h)**; version `3-5513.27.5.25` differs by 2.4h | `env/total_error`、`partial/<cat>/`、`partial/<cat>/avg_staleness` |
| Step 24 (detrended) | 1.78 | 0.39 | Restart at step 25 (difference 7.5h); version `3-5513.26.4.25` differs by 4.0h | `ctx_total_length/<cat>/min`、`harness-G-pw/training/positive_adv_rate` |
| Step 29 (detrended, statistic 8.8, largest) | 2.07 | — (to the end) | Restart at step 28 (difference 2.7h); version `3-5513.32.6.28` differs by 5.5h | `penalty/signed/neg_mass_added`、`neg_scale`、`neg_hit_tokens` |

**The claim that "displacement is larger near restarts" holds only for flash; for pro it is the opposite**: grouping the detrended position statistic by "whether it is within the restart step and the following 2 steps", flash has median **5.92** near restarts (n=9) versus **2.36** for the others (n=18), while pro has **2.42** (n=12) versus **3.44** (n=9). pro has 11 restarts but they fall on only 5 step boundaries (steps 3, 11, 15, 17, 23); restarts are dense, so instead they do not constitute "more special steps".

**Are these phases model state or ops?** Three pieces of evidence all point to ops:

1. **The largest change point falls on the restart step, and the displacement returns to its original level within 3 steps** (fallback ratio 0.97 / 0.93). A model capability improvement would not be returned within 3 steps.
2. **The persistent steps after detrending move quantities of the "environment/data" type** (`env/active`, `env/total_error`, length truncation rate, `partial` bucket share), not effect sizes like `critic/rewards/mean` and `dynsam/avg@n`. For pro, step 23 has displacement 2.56 while the nearby version switch is only 1.09 hours away, exactly corresponding to changes such as "removing the cyber dataset" in the announcement.
3. **The metric set itself is changing**: `tags.json`'s `versions[].n` changed from 2019 to 2029 (pro, switch point 2026-09-19 03:07:03Z), and 5 metrics in `penalty/stage_credit_group/<metric>` appear only partway through; at the sequence level, for pro 218 metrics stop reporting partway through and 232 start reporting partway through, **the vast majority of which are freshness-bucket metrics like `partial/<cat>/<id>/<k>/{frac,n_tokens}`**—buckets 1/2/3 exist only when the data is sufficiently stale (for pro, bucket 1 first appears at step 2, bucket 2 at step 5, bucket 3 at step 6; for flash, the corresponding steps are 2/3/6). These "metric going online/offline" events are themselves pipeline state, not model state.

**One limitation that must be stated clearly**: almost all of `tags.json`'s `last_seen` are equal to the file write time (for example, pro's 45 cyber keys `last_seen` are all 1789808290.716), so **from tags you cannot tell "who was removed"**; removal can only be inferred from null gaps in the sequence and announcements (pro's cyber sequence has only 14 non-null steps, consistent with the announcement "remove cyber from the next pro round"). In addition, for `notices.json`, the `run` field of its 5 announcements is all `null`; this article maps it to the corresponding run based on the body topic.

---

## 8. Partial correlation: after removing the common time trend, which relationships are still alive

> **Conclusion**: the relationship between length ↔ performance is **entirely a common trend** (goes to zero after controlling for step index); the relationship between data staleness ↔ global KL is **real** (after controlling, it does not decrease but increases); policy entropy ↔ performance **changes sign** after controlling for trend.

**Plain language**: two numbers rise together, either because they really are related, or because "time is moving forward and both change along with it." Regressing each of the two series on "which step" and keeping only the residuals before computing correlation strips out the latter case.

**Evidence table (raw Pearson / partial correlation after controlling for step index)**

| Metric pair | pro | flash | Interpretation |
|---|---|---|---|
| Generation length ~ `dynsam/avg@n` | 0.766 → **−0.013** | 0.920 → **−0.140** | Pure common trend (consistent with the first-difference conclusion for `notes/09`; here the residual method is used to confirm it again) |
| Total length ~ `dynsam/avg@n` | 0.764 → **−0.017** | 0.919 → **−0.134** | Same as above |
| `partial/avg_staleness` ~ global KL | 0.923 → **0.941** | 0.866 → **0.892** | **Real relationship**, not a trend |
| `partial/avg_staleness` ~ `dynsam/avg@n` | 0.142 → 0.221 | 0.073 → 0.107 | Inherently weak |
| `timing_s/step` ~ `ctx_total_length/mean` | 0.733 → **−0.301** | 0.833 → **−0.131** | Trend-driven spurious correlation |
| `timing_s/trainer_ops` ~ `ctx_total_length/mean` | 0.845 → 0.150 | 0.974 → **0.922** | **The two runs disagree**: flash is real, pro is not |
| `actor/entropy_loss` ~ `dynsam/avg@n` | 0.578 → **−0.620** | 0.889 → **−0.395** | **Changes sign after controlling for trend** (see below) |
| `critic/rewards/mean` ~ `dynsam/avg@n` | 0.898 → 0.614 | 0.929 → 0.220 | Same direction but very different strength, unstable |
| Generation length ~ `train/passrate/avg_passrate` | 0.775 → 0.641 | 0.912 → 0.261 | The two runs disagree |
| global KL ~ `dynsam/avg@n` | 0.304 → 0.221 | 0.311 → 0.109 | Weak |
| `timing_s/step` ~ `timing_s/trainer_ops` | 0.850 → 0.371 | 0.780 → −0.059 | Trend-dominated |

The relationship between entropy and performance deserves separate mention: after controlling for "which step", higher entropy means worse performance (pro −0.62, flash −0.40), while the level correlation is positive (0.58 / 0.89). This is not a new finding (`insights.json` contains `entropy-rising`, which has already noticed that entropy and success rate rise in the same direction), but **the direction of the partial correlation indicates that "rising in the same direction" itself is caused by time**: when comparing near the same training step, those steps with higher entropy have worse performance. There are only 24/30 points, so this negative sign should not be treated as a definitive conclusion.

---

## 9. Cross-run comparability: only two factors match between the two runs

> **Conclusion**: after taking the intersection of metrics, PC1/PC2 for pro and flash can be paired (|cos| 0.80/0.79, under the same 24-step basis 0.76/0.70), while PC3 and beyond do not match (0.25～0.45). The median per-metric trajectory correlation is only **0.156**, and it is even lower when aligned by wall clock (0.128).

**Plain language**: the two runs use the same dashboard basis, but the models differ, the step sizes differ, and the durations differ. If the "metric structure" were universal, the loadings of the two runs should be highly consistent; in reality only the first two macro factors are consistent, and individual metrics mostly go their own way.

**Evidence table**

| Metric | Value |
|---|---|
| Intersection metrics / both sides pass coverage | 1909 / **1363** |
| PC pairing \|cos\|(flash all 30 steps) | PC1 **0.799**、PC2 **0.793**、PC3 0.449、PC4 0.269、PC5 0.101 |
| PC pairing \|cos\|(flash truncated to 24 steps) | PC1 **0.759**、PC2 **0.696**、PC3 0.248、PC4 0.259 |
| Per-metric cross-run trajectory correlation (step index aligned 1..24, n=1359) | Median **0.156**, quartiles [−0.030, 0.381]; r>0.5 accounts for **17.2%**, r<−0.5 accounts for **0.3%** |
| Same as above, but changed to wall-clock time interpolated alignment (22 points per metric) | Median **0.128**, quartiles [−0.048, 0.347]; r>0.5 accounts for 14.1% |
| Median consistency at the family level (n≥5) | `ctx_total_length/<cat>/dataset-<id>/mean` **0.751**、`ctx_response_length/<cat>/…/mean` **0.765**、`dynsam/<cat>/…/carryover` 0.338、`dynsam/<cat>/…/held` 0.332、`train/passrate/avg_passrate/<cat>/…` 0.190、`penalty/…/harness/<metric>` **0.051**、`penalty/…/select_v4/<metric>` 0.066、`ctx_prompt_length/<cat>/…/max` **−0.039** |

**Behaving consistently**: context length (mean of `ctx_total_length`, `ctx_response_length`, median r 0.75～0.77; 8 of the 10 most consistent metrics are length-type), total token count (`perf/total_num_tokens` r=0.94), `training/global_step` (1.00, because it is the step number), sampler's held/carryover amount (0.33).

**Behaving oppositely** (r ≤ −0.4, about 10 in total): `actor/visual/dataset-jzd3/entropy_loss`(−0.64), `ctx_prompt_length/code/dataset-m1dt/min`(−0.61), `ctx_prompt_length/min`(−0.49), `critic/code/dataset-zg6q/{returns,advantages}/max`(−0.52), `train/passrate/avg_passrate/code/dataset-obg8`(−0.44), `critic/visual/dataset-jzd3/{returns,advantages}/max`(−0.44). Most of these are **extreme-value metrics such as "minimum/maximum"** and quantities from a single dataset; the magnitudes are small and the jitter is large, so it is not surprising that the sign flips across runs; **do not read them as "the two models trade off along that dimension"**.

**The entire `penalty/stage_credit_group/harness/<metric>` family (212 metrics) has a cross-run median r of only 0.051**—the count metrics of the grading pipeline are basically uncorrelated between the two runs; they mostly reflect each pipeline's congestion, not model properties.

---

## 10. Uncertain, unstable, and contrary to expectations.

1. **【Unstable】The clustering is not a stable structure.** Leave-one-step-out reruns of the detrended clustering (remove any one step, re-standardize, recompute correlations, re-cluster) give a **median ARI of only 0.526 (pro) / 0.554 (flash)** versus the full sample, with minimum 0.371 / 0.448. Along with "the top-level merge distances are all above 0.7, with no gap", my interpretation is: **the 15-cluster map in Section 6 is a reading tool, not an objectively existing partition in the data**; do not cite "which metric belongs to which cluster" as a conclusion. By contrast, conclusions such as "at least 15 metrics can explain 83%" do not depend on cluster boundaries and are more robust.
2. **【Unstable】flash's PC3 loadings are almost irreproducible.** In leave-one-step-out recomputation, the median loading cosine for PC1/PC2 is 0.998/0.997 (minimum 0.890/0.886), so they can be used with confidence; **flash's PC3 minimum cosine is only 0.075**, and after removing a certain step the third component completely changes direction. pro's PC3 minimum is 0.784. So the naming of PC3 in Section 5 is only a rough description for flash.
3. **【Contrary to expectations】"Restarts make metrics jump more" does not hold on pro.** On flash, the detrended location statistic near restarts has median 5.92 versus 2.36 elsewhere (a 2.5× difference); on pro it is instead 2.42 versus 3.44 (smaller displacement near restarts). I originally thought restarts were the main "phase maker", but pro's data does not support this generalization.
4. **【Refuted】"Most of the 2000 metrics are just rising with time" is wrong.** I initially assumed the common trend would eat everything (so I first made a detrended version and then clustered). In reality, only **13/1389 (0.9%, flash 27 = 1.8%)** metrics have |corr|≥0.95 with the step index, and the median |ρ| is only 0.19. The trend is indeed concentrated in PC1 (score correlated with step index 0.822/0.888, i.e. time explains **68% / 79%** of PC1 variance), but after per-metric linear detrending and re-standardization, PC1 only drops from 21.0% to **18.9%** (flash 18.6% → **17.6%**), while PC2 falls from 14.6% to **10.3%**, and flash from 14.8% to **9.3%**—**more than half of the second factor is non-trend fluctuation**. The trend is the background, not everything.
5. **【Uncertain】The definition of "effective degrees of freedom" itself is not unique.** The participation ratio gives 11.2/13.0; 80% variance gives 14/17; 90% gives 18/22; "greedily selecting 15 metrics" gives another definition (83% variance). These numbers do not contradict each other (they respectively answer "number of equivalent independent signals", "how much variance to cover", "minimum number of metrics to read"), but when citing them you must include the definition. **Do not just write "about 12 factors" and leave it at that.**
6. **【Uncertain】Part of the cross-run per-metric low correlation (median 0.156) may be because "the two runs were never supposed to align".** pro is 24 steps at about 87 hours, flash is 30 steps at about 80 hours, and flash step 1 is 0.85 hours earlier than pro step 1; I used two alignments (step index, wall-clock interpolation) and both gave low correlation (0.156 / 0.128), so I lean toward the low correlation being real, but **cannot rule out the explanation that "the two runs' training phases are fundamentally different"**.
7. **【Uncertain】Small-sample noise in partial correlations.** The standard error of the partial correlation for n=24/30 is about 0.2. In the table, ones like "0.923 → 0.941" that far exceed the noise can be trusted; ones like "0.142 → 0.221" cannot. Also, `dynsam/num_target` is identically equal to 1568 and has zero variance, so the correlation is undefined (NaN), not a script error.

---

## Appendix A: Core numbers for this period (for comparison with the next version)

**Data scale**: pro 1944×24, null 7.86%; flash 1974×30, null 7.43%. Analysis set pro 1389 (excluding 261 insufficient coverage, 294 constants), flash 1465 (excluding 232, 277). Among constants, identically 0: 224 / 202.

**Spectrum**: pro PC1-5 = 21.0 / 14.6 / 7.0 / 5.7 / 4.9 (cumulative 53.1%), n80=14, n90=18, n95=20, PR=**11.21**, noise upper edge 76.9. flash PC1-5 = 18.6 / 14.8 / 6.4 / 5.6 / 4.2 (cumulative 49.6%), n80=17, n90=22, n95=26, PR=**12.99**, edge 65.7. flash truncated to 24 steps: PC1 20.2%, n80=14, PR=**12.12**.

**Robustness**: under six definitions of coverage 0.8/0.95/1.0 × interpolation/mean imputation, pro PC1 21.0～21.1%, PR 11.18～11.21; flash PC1 18.5～18.7%, PR 12.99～13.09. Under the Spearman (rank correlation) definition, pro PR 11.38, flash 13.87. Metric bootstrap (B=200, resampling metrics): pro PC1 median 21.3% [20.4, 21.9], PR median 11.17 [10.81, 11.56]; flash PC1 18.7% [17.7, 19.4], PR 12.84 [12.37, 13.57]. Leave-one-step-out loadings |cos|: pro PC1/2/3 minimum 0.977/0.971/0.784; flash 0.890/0.886/**0.075**. Detrended clustering leave-one-step-out ARI: pro median 0.526, flash 0.554.

**Redundancy**: median |ρ| 0.187 / 0.167; pairs with |ρ|≥0.9 account for 0.41% / 0.40%. Duplicate groups: 101 groups covering 77.2% / 103 groups covering 79.1%, within-group average |ρ| median 0.260 / 0.282. Near-duplicate connected components: 1008 / 1089 groups at |ρ|≥0.99 (maximum 10 / 10), 638 / 737 groups at ≥0.9 (maximum 220 / 241).

**Minimum metrics**: greedy forward selection cumulative explained variance pro 51.1/69.2/83.5/94.8% (k=5/10/15/20), root-level pool 51.0/68.7/82.8/94.5%; flash 47.7/62.5/74.6/85.0%.

**Partial correlation**: see table in Section 8. The three most critical: length~pass rate 0.766→−0.013 (pro), 0.920→−0.140 (flash); staleness~global KL 0.923→0.941, 0.866→0.892; entropy~pass rate 0.578→−0.620, 0.889→−0.395.

**Phases**: raw PC1-3 binary segmentation change points pro = steps 4/15/18/23, flash = steps 4/15/24; the maximum location statistic is at step 15 for both (19.1 / 24.9), fallback ratio 0.97 / 0.93. pro restarts fall at steps 3/11/15/17/23 (11 total), flash at steps 16/25/28 (5 total). Version switches: pro at steps 15/16/18/20/23/24, flash at steps 19/20/21/25/26/27/30. Median displacement near restarts: flash 5.92 vs 2.36 (larger), pro 2.42 vs 3.44 (smaller).

**Cross-run**: intersection 1909, common analysis 1363. PC pairing |cos| 0.799/0.793/0.449/0.269 (all 30 steps), 0.759/0.696/0.248/0.259 (truncated to 24 steps). Per-metric trajectory correlation median 0.156 (step-index alignment) / 0.128 (wall-clock alignment).

## Appendix B: Terminology quick reference

| Term | One-sentence explanation | Transferable judgment rules |
|---|---|---|
| **z-score / standardization** | Subtract each metric's own mean and divide by its own standard deviation, turning it into a "mean 0, variance 1" curve | As long as metrics have **different units or magnitudes**, you must standardize before any multivariate analysis; otherwise metrics with large variance will monopolize the principal components |
| **Correlation matrix / eigenvalues** | A square matrix of pairwise correlations between metrics; its eigenvalues describe "how concentrated the variance is along certain directions" | The sum of eigenvalues is identically equal to the number of metrics; an eigenvalue divided by the number of metrics is the proportion of variance explained by that principal component |
| **Principal component (PC)** | Linearly combine many curves into new, mutually uncorrelated curves; the first one explains the most variance | When the loadings (weights) are very "flat" (the largest loading is only 2～3 times the uniform value), do not give the component an overly specific name |
| **Participation ratio (PR)** | (Σλ)²/Σλ², compresses the entire eigenvalue spectrum into a single number, meaning "equivalent number of independent signals" | The more concentrated λ is, the smaller PR is. If PR is far smaller than the number of metrics, it indicates that the metrics are highly redundant; it is the most stable definition of "effective degrees of freedom" |
| **How many components are needed to explain 80% variance (n80)** | Number of components when the cumulative variance share first reaches 80% | **Cannot be compared across sample sizes**: the more time points, the more distinguishable components, and n80 becomes systematically larger. To compare, the point counts must be aligned |
| **Marchenko–Pastur upper edge** | If all metrics are independent of one another, the largest eigenvalue of the sample correlation matrix can reach approximately (1+√(d/n))², i.e. the "pure-noise upper limit" | Eigenvalues below this number have no structure; in this case the smallest eigenvalues are all far above it, indicating that this filter has no discriminating power here, so the participation ratio should be used instead |
| **Hierarchical clustering + average linkage (UPGMA)** | At each step, merge the two most similar clusters; the distance between the two clusters is the average of the pairwise distances between their members | Check whether there is a gap in the **top-level merge distance**: no gap (all >0.7 in this case) means the "clusters" are cut out, not grown |
| **ARI (Adjusted Rand Index)** | Degree of agreement between two clustering results; 1 is complete agreement, 0 is random | Use it for a stability check: if after rerunning with one step held out the median ARI is only 0.5, do not treat cluster membership as a conclusion |
| **Change-point detection / binary segmentation** | Find positions in a sequence where the "properties changed"; binary segmentation greedily finds, at each step, the position that makes the within-segment variance drop the most | Must look at both **penalty strength** (this report ranks the unpenalized position statistic to avoid conclusions depending on a threshold) and **reversion ratio** (whether it comes back after the jump) |
| **Reversion ratio (reversion ratio)** | How much the new level 3 steps after the change point differs from the average level over a longer period after the change point, divided by the shift of the change point itself | ≈0 means the level shift persists (the model/config really changed), ≈1 means it reverts within 3 steps (a transient shock from an ops reset) |
| **Partial correlation (residual method)** | Regress each of the two series on "step number", take the residuals, and then compute the correlation | High correlation in levels ≠ a real relationship. Common trends are the most common source of spurious correlation on this dashboard; only those that do not drop or even grow after controlling for time (staleness ↔ KL) are real relationships |
