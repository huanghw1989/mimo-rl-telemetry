# Generation length correlation analysis: full-metric scan of MiMo-V2.6 RL dashboard telemetry data

> Material identity: **our own measurement**. Data comes from local telemetry `data/store/`; all numbers were recomputed from the raw JSON by a script `src/correlate_report.ts` that I wrote myself; the script hardcodes no conclusion numbers.
> Data as of: **pro step 24 (collected 2026-09-19 08:58Z), flash step 30 (collected 2026-09-19 03:07Z)**.
> Definition: `ctx_response_length/mean` is "how many tokens one trajectory generated on average in this step's training batch", unit: token; pro has 25088 training trajectories per step (1568 tasks × 16 samples, from `status.json`'s `totals.trained_step`), same for flash. Small sample size: pro has only 24 points, flash 30 points; correlation noise is high. All ρ in this paper are reported together with sample size and p-value; we do not treat ρ from small samples as ironclad conclusions.

---

## 1. Summary: Six Conclusions

> Evidence strength annotation convention: 【Our own measurement】 ＝ numbers recomputed from local telemetry raw data; 【External literature】 ＝ original text of papers/official documentation; 【Inference】 ＝ my interpretation, not directly proven by data; 【Uncertain】 ＝ data insufficient to judge. Except where annotated, all numbers in this article are 【Our own measurement】, and can be recomputed with one click using the script in Section 2.

1. 【Our own measurement】**The length is 「smooth rise + restart interruptions」, not a single step change.** pro's `ctx_response_length/mean` (trajectory mean generation length, token) rose from 68078 at step 1 to 114676 at step 24, ×1.684; flash from 67462.9 to 143385, ×2.125. A linear trend explains pro's generation length with R²=0.851, while 「a single step」 explains only 59.7%; for flash it is 0.919 versus 0.730. That is, reading it as 「jumping up at some step」 is wrong; it is a **sustained climb**, just repeatedly interrupted by restarts. **Programming tasks (code category) rose the most**: pro's code-category equal-weight mean 73447 → 134017 (×1.82), flash 71829 → 158571 (×2.21).

2. [Our measurement] **Restarts systematically pull length down.** For pro, the mean one-step change in length at the “first reported step after restart” is **−3.3%** (4 of 5 negative), while at other steps not affected by engineering events it is **+5.5%** (only 1 of 13 negative); flash is cleaner: the first step after restart is **−6.3%, 3 of 3 negative**, other steps +3.9%. Restarts also drive `partial/avg_staleness` (mean data staleness) from 1.7878 down to 0.4403 (pro step 11). [Inference] This is consistent with “restarts flush out the long trajectories and stale data accumulated in the queue together.”

3. [Our measurement] **The surface correlation between length and score is almost entirely spurious correlation caused by a common trend.** In pro, `ctx_response_length/mean` and `dynsam/avg@n` (the main average pass-rate metric on the homepage) have Spearman ρ=0.786 (p<1e-4), but after first differencing only **−0.063 (p=0.77)** remains; with `critic/score/mean` (mean trajectory score at this step) ρ=0.871, and after differencing −0.082 (p=0.71). Flash is more counterintuitive: level ρ=0.932, after differencing **−0.484 (p=0.0078)**—**in those steps where length jumps up, the pass rate tends not to rise and even to fall**. The cross-run pooled relative difference correlation with n=52 is also negative (−0.302, p=0.030).

4. [Our measurement] **Truncation is not the bottleneck for this length growth.** `ctx_total_length/clip_ratio` (fraction of trajectories truncated by the length cap) for pro rises from 4.0e-5 to a maximum of 9.18e-4 (step 22), and for flash to a maximum of 3.1e-3 (step 18)—even at the maximum, only three per thousand trajectories are truncated. `train/verdicts/dropped_empty_response` (number of trajectories discarded because the answer was empty) is identically zero over the whole period. But **some trajectories do hit the hard cap**: `ctx_total_length/max` exactly equals **1048570** (≈2²⁰=1048576) in 11 of pro's 24 steps and 15 of flash's 30 steps. [Inference] The cap is real; it is just that the vast majority of samples are still far from it.

5. [Our measurement] **The real cost of length growth falls on the trainer side, not the generation side.** `timing_s/trainer_ops` (trainer time for this step, seconds) has level ρ=0.918 and difference ρ=0.559 with length (p=0.0055, pro); after **dividing it by this step's token count** (seconds per billion tokens), it still rises from 1605 to 2374 (×1.48, trend r=0.803). Conversely, on the generation side, `timing_s/outer_gen` divided by token count falls from 3618 to 1972 (×0.55). Incidental finding: this step's token count ÷ mean generation length = 26173 (pro, coefficient of variation only 0.7%), which is an identity (tokens per step ≈ fixed trajectory count × mean length), so `perf/total_num_tokens`'s ρ=0.998 with length carries no information at all.

6. [External literature] + [Our measurement] **The literature supports “length growth comes from the objective function, not reward score farming.”** The DAPO paper explicitly writes that sample-level loss aggregation leads to “unhealthy growth of entropy and response length” ([arXiv:2503.14476](https://arxiv.org/abs/2503.14476)]); Dr. GRPO points out that GRPO has an “optimization bias that artificially lengthens responses (especially incorrect responses)” ([arXiv:2503.20783](https://arxiv.org/abs/2503.20783)]); *Concise Reasoning via RL* gives a theorem: **negative advantage is the sufficient condition for lengthening length**, and provides data showing that correct answers are generally shorter than incorrect answers ([arXiv:2504.05185](https://ar5iv.labs.arxiv.org/html/2504.05185)). [Our measurement] In our data, `critic/advantages/mean` is **negatively** correlated with length (pro ρ=−0.477, flash ρ=−0.778), matching in direction.

---

## 2. Methods and Data Sources

| Item | Content |
|---|---|
| Data | `data/store/runs/{pro,flash}/series.json` (pro 1944 metrics × 24 steps; flash 1974 × 30), `axis.json`, `status.json`, `tags.json`, `timeline.jsonl`; `data/store/benchmarks.json`; `data/store/notices.json`; `content/metrics.json` (109 Chinese metric explainers) |
| Recompute script | `src/correlate_report.ts`, run `bun src/correlate_report.ts` from the project root directory |
| Script artifacts | All numbers are written to `analysis/zh-CN/numbers/A3-生成长度相关性-numbers.json`, while the full human-readable summary is printed to stdout (also saved to `analysis/zh-CN/numbers/A3-生成长度相关性-numbers.txt`) |
| Correlation methodology | Pearson and Spearman (ranks with ties averaged); pairwise deletion of missing values (the series do contain nulls: 3666 in pro, 4398 in flash); significance approximated with a t-test (two-tailed); 95% confidence intervals use Fisher z |
| Spurious-correlation controls | **First-difference correlation** (Δx vs. Δy), removing the “common time trend”; additionally, two robustness checks are performed: **cross-run pooling** (concatenating the relative first differences of pro and flash, n=52) and **excluding steps adjacent to engineering events** (the first step after restart, redo steps and the step before them). |
| Critical value | Two-tailed Spearman 0.05 critical \|ρ\|: pro (n=24) **0.404**, flash (n=30) **0.361**, pooled differenced (n=52) **0.273**. Anything below the critical value is uniformly treated as “cannot rule out chance” |
| Outlier criteria | A single-step jump must simultaneously satisfy “relative change ≥15%” and “robust z ≥5” (z is constructed from the median and MAD of the differences); sparse count-type series (where more than half of the differences are 0, or there are fewer than 5 distinct values) have been removed, otherwise they would dominate the ranking |
| Event alignment | Restarts are aligned by the `events` **event sequence** of `status.json` (not wall clock → step number, because `axis.walls` is the final value after redo and would be misaligned); version switches are aligned by the **step in progress when that version first appears** in `timeline.jsonl` |

### Two definitional issues in the data that need to be explained first

- **`ctx_total_length/mean` ≈ `ctx_response_length/mean` + `ctx_prompt_length/mean`**: measured maximum absolute residual 0.7 token (pro), 0.9 token (flash), relative residual 0.0008%. So “total length” is not independent information; this article mainly uses generation length.
- **The 0 values of `train/passrate/avg_passrate/visual/dataset-ol8x` and `.../dataset-gtav` are very likely “not reported” rather than truly 0%**: ol8x has exactly 0 for 7/24 steps on pro and 5/30 steps on flash, while all of its nonzero values are between 0.41~0.65; gtav is similar (median 0.25~0.27, minimum nonzero 0.19~0.24). The data quality checks in the script hit exactly these two. Treat pass-rate correlations involving these two datasets as unreliable.

---

## 3. The shape of generation length growth

**Conclusion**: continuously climbing, not a single step change; the code category is fastest (pro ×1.82, flash ×2.21); every 2~3 steps it is interrupted by a restart and drops back, but after dropping back it continues to reach new highs.

**In plain terms**: the more the model is trained, the more it likes to write long answers, and there is no sign of it stopping (pro's last step +13.1% is the largest single-step increase over the whole run, and flash's last step +13.0% is too). The several pullbacks in the middle of training almost all correspond to ops restarts; it is not that the model got shorter.

### pro step by step (`ctx_response_length/mean`, equal-weight category mean)

| step | Overall | agentic | code | chat | general | visual | cyber | ΔOverall | Relative change |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 68078 | 73117 | 73447 | 4137 | 52440 | 76773 | 134486 | – | – |
| 4 | 76055 | 82076 | 83365 | 2096 | 51794 | 78269 | 196334 | +6076 | +8.7% |
| 7 | 85524 | 92350 | 104297 | 5173 | 58907 | 82861 | 167372 | +4903 | +6.1% |
| 9 | 89571 | 96852 | 106890 | 2930 | 60801 | 82942 | 186472 | +2288 | +2.6% |
| 11 | 82443 | 88960 | 92705 | 3200 | 59041 | 85520 | 200113 | −2414 | −2.8% |
| 14 | 101993 | 110672 | 121564 | 4255 | 67253 | 95171 | 242592 | +6523 | +6.8% |
| **15** | **87494** | 96422 | 101910 | 2947 | 73024 | 97955 | (stopped reporting) | **−14499** | **−14.2%** |
| 18 | 95415 | 105884 | 112985 | 3763 | 71240 | 103321 | – | +7616 | +8.7% |
| 20 | 104221 | 115317 | 136206 | 3699 | 71525 | 103568 | – | +7247 | +7.5% |
| 22 | 106180 | 117404 | 132636 | 4346 | 78163 | 114607 | – | +2558 | +2.5% |
| 24 | 114676 | 127109 | 134017 | 2724 | 85550 | 132017 | – | +13301 | +13.1% |

(The full 24-row per-step table is in the “## 1” section of the script stdout; below only key numbers are listed. Category mean convention: equal-weight average of `mean` across datasets in that category; agentic has only one series and is used directly.)

### flash step by step (excerpt)

| step | Overall | code | general | visual | ΔOverall | Relative change |
|---|---|---|---|---|---|---|
| 1 | 67463 | 71829 | 57787 | 79125 | – | – |
| 4 | 83447 | 94187 | 52370 | 87803 | +10082 | +13.7% |
| 11 | 98931 | 122822 | 67181 | 103730 | +6895 | +7.5% |
| 14 | 107888 | 123317 | 76960 | 113170 | +8192 | +8.2% |
| **16** | **94442** | 101675 | 66914 | 120782 | **−8872** | **−8.6%** (restart redo) |
| 20 | 124824 | 151713 | 87272 | 130265 | +5514 | +4.6% |
| **25** | **114444** | 123943 | 86541 | 136988 | **−9534** | **−7.7%** (restart) |
| 28 | 123225 | 137979 | 84141 | 147145 | −3441 | −2.7% (restart) |
| 30 | 143385 | 158571 | 104069 | 162989 | +16551 | +13.0% |

### Shape diagnostics (smooth vs step change)

| Metric | pro | flash |
|---|---|---|
| Linear trend R² (overall / code category) | 0.851 / 0.812 | 0.919 / 0.749 |
| Variance explained by single-breakpoint piecewise constant (overall / code category) | 59.7% / 60.1% | 73.0% / 64.0% |
| Optimal breakpoint (overall / code category) | step 12 / step 13 | step 18 / step 18 |
| Ratio of segment means before and after the breakpoint (overall / code category) | ×1.25 / ×1.32 | ×1.35 / ×1.32 |
| Maximum single-step jump ÷ median single-step jump | 3.1 / 2.9 | 3.3 / 2.8 |

The variance explained by the linear model is **greater than** that of the single step-change model, so “smooth climb” is a better description. At the category level: flash's visual category linear r²=0.956, slope +3095/step; pro's visual slope +2154, r²=0.912; the chat category barely moves (pro slope +53/step, r²=0.089, flash slope +134, r²=0.370). The cyber category stops reporting after pro step 15 (corresponding to the announcement “remove the cyber dataset from subsequent pro run”).

### code per-dataset increase (first step → last step)

| Dataset | pro | flash |
|---|---|---|
| code/dataset-obg8 | 77052→162741（×2.11） | 78245→160332（×2.05） |
| code/dataset-v7yx | 57269→130502（×2.28） | 59106→123170（×2.08） |
| code/dataset-x7wh | 76907→154376（×2.01） | 80060→153168（×1.91） |
| code/dataset-zg6q | 43776→88126（×2.01） | 41830→92294（×2.21） |
| code/dataset-ta4j | 80371→148036（×1.84） | 78986→140479（×1.78） |
| code/dataset-yfch | 188016→304033 (×1.62; peak 520800@step20) | 163328→524848（×3.21） |
| code/dataset-4onq | 38787→56407 (×1.45, smallest increase) | 44191→62024 (×1.40, smallest) |

yfch is the most peculiar one: it is itself the longest dataset (180k–520k token), extremely volatile, with a very weak linear trend (pro r=0.401, flash r=0.339). **This is not “coding tasks generally rose from 80k to 120k”, but rather the 11 code datasets' increases range from ×1.40 to ×2.28, and the long-tail datasets are extremely noisy**—this point is more accurate than the intuitive “overall surge”.

---

## 4. Length went up—did performance go up?

**Conclusion**: the level correlation is large (0.75~0.93), but **after first differencing it largely disappears, and on flash it even turns significantly negative**. Length and performance in this training run are not a causally synchronized pair.

**In plain terms**: both “length” and “pass rate” go up over time, so plotting them directly together shows an almost perfect positive correlation; but that is the same time trend pushing both lines simultaneously. What can actually answer “if length goes up a bit more, does performance go up a bit more” is the differenced correlation, and the answer is basically “no”.

| Metric (on `ctx_response_length/mean`) | pro level ρ | pro differenced ρ (p) | flash level ρ | flash differenced ρ (p) | pooled differenced ρ (n=52) |
|---|---|---|---|---|---|
| `dynsam/avg@n` average pass rate primary metric | 0.786 | −0.063 (0.77) | 0.932 | **−0.484 (0.0078)** | −0.302 (0.030) |
| `train/passrate/avg_passrate` training-batch mean pass rate | 0.749 | +0.508 (0.013) | 0.898 | +0.247 (0.20) | +0.342 (0.013) |
| `critic/score/mean` mean trajectory score for this step | 0.871 | −0.082 (0.71) | 0.896 | −0.106 (0.58) | −0.077 (0.59) |
| `critic/rewards/mean` average reward (same value as score) | 0.871 | −0.082 (0.71) | 0.896 | −0.106 (0.58) | −0.077 (0.59) |
| `critic/returns/mean` average return | −0.477 | −0.471 (0.023) | −0.778 | −0.378 (0.043) | +0.403 (0.0031) |
| `critic/advantages/mean` mean advantage | −0.477 | −0.471 (0.023) | −0.778 | −0.378 (0.043) | +0.403 (0.0031) |

Note that `critic/returns/mean` and `critic/advantages/mean` have exactly the same values (they are the same series), and the sign of the pooled differenced correlation is opposite to that of the per-run ones; this is caused by baseline differences when concatenating across runs (pro and flash have different average advantage levels), so this item **cannot be taken as a conclusion**.

### Recompute after excluding steps adjacent to engineering events (the most important robustness check)

| Metric | pro full differences | pro excluding adjacent event steps (n=9) | flash full differences | flash excluding adjacent event steps (n=19) |
|---|---|---|---|---|
| `dynsam/avg@n` | −0.063 | +0.367 (p=0.33) | −0.484 | **−0.623 (p=0.0044)** |
| `train/passrate/avg_passrate` | **+0.508 (p=0.013)** | **−0.133 (p=0.73)** | +0.247 | −0.077 (p=0.75) |
| `critic/score/mean` | −0.082 | +0.017 (p=0.97) | −0.106 | −0.235 (p=0.33) |
| `partial/avg_staleness` | **+0.651 (p=0.0008)** | +0.083 (p=0.83) | **+0.717** | **+0.509 (p=0.026)** |
| `timing_s/trainer_ops` | +0.559 (p=0.0055) | +0.650 (p=0.058) | **+0.675** | **+0.721 (p=0.0005)** |
| `ctx_total_length/clip_ratio` | +0.570 (p=0.0045) | +0.150 (p=0.70) | +0.292 (p=0.12) | +0.251 (p=0.30) |

**This is the table most worth remembering in this article.** In pro, the seemingly prettiest “length up, training pass rate up” (+0.508, p=0.013) becomes −0.133 (p=0.73) after excluding steps adjacent to restarts; `partial/avg_staleness`'s +0.651 also drops to only +0.083. Because flash has fewer restarts, after exclusion its average pass rate is actually stronger (−0.623), while the relationship between trainer time and length is stable under both conventions (+0.675 → +0.721). **That is: on pro, the evidence that “length is positively correlated with performance” is basically contributed by the points around restarts and is not robust; on flash, “pass rate does not increase when length jumps” is instead stable.**

### Offline benchmark (`benchmarks.json`)

| Benchmark | run | n | Level ρ(length) | Differenced ρ | Standard deviation of adjacent-step changes | Maximum single-step drop |
|---|---|---|---|---|---|---|
| DeepSWE v1.1 | pro | 17 | 0.725 | +0.041 | 1.95 | −2.70（step13） |
| DeepSWE v1.1 | flash | 23 | 0.815 | −0.023 | 3.84 | **−6.05（step11）** |
| In-house Coding Bench | pro | 17 | 0.921 | +0.350 | 0.75 | −0.58（step16） |
| In-house Coding Bench | flash | 23 | 0.934 | −0.045 | 0.65 | −0.78（step11） |
| AutomationBench v1.0.6 | pro | 16 | 0.644 | −0.254 | 0.95 | −2.10（step7） |
| AutomationBench v1.0.6 | flash | 25 | 0.907 | +0.193 | 1.39 | −3.50（step25） |

Lag test (using length at step s−L to explain the benchmark score nominally at step s): DeepSWE on pro has L4 ρ=0.846 higher than L0's 0.725; on flash, L1's 0.817 is essentially on par with L0's 0.815; the optimal lag for other benchmarks falls at L1~L2. **Directionally, it is “the further back the length, the stronger or equal its explanatory power”, consistent with the known fact that “offline evaluation lags training by several steps”, but the sample is only 16~24 points, and the differences between lags are far smaller than the noise, so one cannot assert from this that the lag is 4 steps.**

---

## 5. The cost of length growth

**Conclusion**: trainer cost per unit token increases by about 1.5× and is robust; generation side did not slow down; truncation is extremely rare; there are no empty responses at all.

**Plain language**: Writing longer did not blow up the system (truncation rate on the order of one in a thousand), but it consumed more trainer compute—training time per billion tokens rose by about 47%~48%, a typical cost of attention growing with sequence length. The generation stage instead was not slower, indicating generation was never "billed linearly per token" to begin with; it is dominated by agent turns and sandbox waiting.

| Metric | pro first→last | pro factor/trend | flash first→last | flash factor/trend |
|---|---|---|---|---|
| `timing_s/trainer_ops` (seconds) | 2889 → 7049 | ×2.44, with length ρ=0.918 | 1884 → 5738 | ×3.05, with length ρ=0.940 |
| `timing_s/trainer_ops` ÷ (this step token/1e9) | 1605 → 2374 | **×1.48，r=0.803** | 1053 → 1553 | **×1.47，r=0.631** |
| `timing_s/outer_gen` ÷ (this step token/1e9) | 3618 → 1972 | ×0.55 | 2482 → 1740 | ×0.70 |
| `timing_s/step` ÷ (this step token/1e9) | 5315 → 4433 | ×0.83，r=0.472 | 3622 → 3364 | ×0.93，r=0.272 |
| `ctx_total_length/clip_ratio` max | 4.0e-5 → 9.18e-4（step22） | with length difference ρ=0.570 | max 3.1e-3 (step18) | difference ρ=0.292 |
| `train/verdicts/dropped_empty_response` | 0 throughout | correlation coefficient undefined | 0 throughout | correlation coefficient undefined |

Note: `timing_s/step` does not include restart wait time (a confirmed definitional fact), so it does not count restart machine time; when this article uses it and "per-unit-token time," keep this in mind.

**Hard-cap evidence**: the most common value of `ctx_total_length/max` is **1048570** (≈2²⁰), occurring for 11/24 steps in pro and 15/30 steps in flash; the most common values of `ctx_response_length/max` are 1046420/1047910. That is, the length cap really exists and is often hit, but `clip_ratio` is only 1e-4~3e-3. **The statement that "longer answers push the context to truncation" holds only with small probability, and the growing lengths are still far from pushing the truncation rate high enough to contaminate training (max 0.3%).**

Truncation rate by dataset: in pro the highest is `code/dataset-4onq` (mean 0.0042, max 0.0215), while `chat/dataset-8kb6`, `code/dataset-sin0`, `code/dataset-v7yx`, `general/1doa`, `general/5610`, `general/epqd`, `visual/dataset-ve5o` are 0 throughout.

---

## 6. Which metrics correlate most with length growth

**Conclusion**: Among all 1944 / 1974 metrics, of the top 30 by absolute Spearman correlation with `ctx_response_length/mean`, more than half are "another way of writing the same quantity" or "mechanical conversion by summing over tokens." After stripping these away, the genuinely informative ones are three categories: **trainer time**, **policy entropy/advantage structure**, and **data staleness and freshness bucket shares**.

First tier (highest duplication, but all mechanical relationships, not discoveries):

| Rank | Metric | pro ρ | Why it doesn't count as a discovery |
|---|---|---|---|
| 1 | `ctx_total_length/mean` trajectory average context length | 0.998 | Identity: total length = generation length + prompt length (`ctx_prompt_length/mean` is almost constant: 3964~4489 throughout in pro, 3995~4589 in flash) |
| 2 | `perf/total_num_tokens` this step's training token count | 0.998 | Mechanical identity: this step's token count ÷ average generation length = 26173 (pro, coefficient of variation 0.7%), i.e. "fixed trajectory count × length" |
| 3 | `ctx_response_length/agentic/mean` | 0.997 | Synonym (at another level) |
| 5/7 | `train/adv_pos_sum_pre_penalty` / `train/adv_neg_sum_*` total positive/negative advantage | +0.983 / −0.959 | Mechanical identity: the coefficient of variation of total ÷ this step's token count is only 4.0% (pro) / 1.9% (flash), i.e. "constant × token count" |
| 14 | `training/global_step` global step number | 0.923 | Pure trend term; will be highly correlated with any monotonic sequence |

Top 15 after excluding these (pro; flash ordering is similar, with flash ρ in parentheses):

| Metric | pro ρ | pro difference ρ | flash ρ | One-sentence meaning |
|---|---|---|---|---|
| `train/spec_accept_length/token_mean` | −0.926 | −0.314 | −0.944 | Speculative decoding average acceptance length (how many tokens are accepted per draft step); decreases as length increases |
| `timing_s/trainer_ops` | 0.918 | **+0.559** | 0.940 | This step's trainer time |
| `penalty/stage_credit_group/select_score_B_mean` | −0.910 | −0.303 | — | Mean score of tier B in the grading/selection process |
| `actor/code/dataset-m1dt/entropy_loss` | 0.903 | +0.427 | 0.957 | Policy entropy for that dataset (larger = more random) |
| `critic/code/dataset-m1dt/score/mean` | 0.903 | +0.002 | 0.936 | Average trajectory score for that dataset |
| `train/passrate/avg_passrate/code/dataset-m1dt` | 0.903 | −0.011 | 0.938 | Training pass rate for that dataset |
| `penalty/stage_credit_group/harness/harness-A/select_hack_attempt_ge_min_rate` | −0.875 | −0.095 | — (on flash it is the `select_v4/...` definition ρ=0.945) | Proportion of suspected "bypassing evaluation" attempts (proportion exceeding threshold) |
| `critic/score/mean` | 0.871 | −0.082 | 0.896 | This step's average trajectory score |
| `penalty/signed/pos_scale` | −0.867 | −0.486 | — | Positive advantage scaling factor |
| `actor/agentic/entropy_loss` | 0.861 | +0.132 | 0.916 | Agentic policy entropy |
| `actor/entropy_loss` | 0.852 | +0.138 | 0.901 | Global policy entropy |
| `partial/0/train_infer_diff/new_infer/kl` | 0.847 | −0.308 | 0.877 | Inference/training log-prob difference for the freshest bucket of data (the real engine disagreement) |
| `train/passrate/passrate_0_ratio` | — | — | 0.964 | All-wrong question proportion (ranks 3rd on flash) |
| `dynsam/avg@n` | 0.786 | −0.063 | 0.932 | Homepage average pass rate main metric |
| `partial/avg_staleness` | 0.260 | **+0.651** | 0.172 | Average data staleness (larger means older data used for training) |

Top100 family distribution (pro): `penalty/stage_credit_group` 20 entries, `ctx_response_length/code` 10 entries, `ctx_total_length/code` 9 entries, `partial/0` 5 entries, `actor/code` 4 entries; on flash `penalty/stage_credit_group` 12 entries, `ctx_response_length/code` and `ctx_total_length/code` 9 entries each, `train/passrate` 5 entries.

**My read**: What is really worth pursuing is the following three clusters; the remaining high-scoring items are either conversions or different dataset copies of the same metric family.

1. **Time-cost cluster**: `timing_s/trainer_ops` (stable under both definitions), `train/spec_accept_length/*` (decreases over the same period). This cluster is "longer answers → slower trainer/worse self-speculation hit."
2. **Entropy and advantage cluster**: `actor/entropy_loss` (pro 0.3953→0.4437, flash 0.4133→0.4706, rising throughout), `critic/advantages/mean` (falling), `penalty/signed/pos_scale` (falling). This exactly matches what DAPO says: "sample-level loss aggregation leads to unhealthy growth in entropy and length."
3. **Staleness cluster**: `partial/avg_staleness` (difference ρ pro +0.651 / flash +0.717), `partial/0/frac` (freshest bucket share, difference ρ pro −0.469 / flash −0.542), `partial/0/train_infer_diff/new_infer/kl`. These three are saying the same thing: **the longer the answer → the slower the rollout → the older the data when it enters training → the lower the share of fresher data.**

---

## 7. Outlier localization

**Conclusion**: The largest metric jumps all fall on engineering events; the step with the largest single-step drop in DeepSWE (flash step 11, −6.05) instead had **no training-side metric anomalies at all**.

Step-by-step portrait of jump counts (rel≥15% and robust z≥5):

| run | Steps with the most jumps (number of jumps) |
|---|---|
| pro | step15（75）、step23（55）、step14（43）、step21（42）、step20（38）、step24（29）、step16（26） |
| flash | step25（117）、step28（69）、step16（65）、step30（58）、step26（57）、step2（46） |

Restart and version alignment (results after aligning the script by event sequence):

| run | Restart → first reported step after restart | Whether this step is redo | The step that was running when the version first appeared |
|---|---|---|---|
| pro | 09-16T00:02 → step3; 09-16T19:58 → step11; 09-17T09:29 and 11:21 → step15; 09-17T20:20 and 23:03 → step17; 09-18T23:06 and 09-19T00:03 → step23 | None | 14, 14, 14, 15, 17, 19, 22, 23, 24 |
| flash | 09-17T02:06 → step16; 09-18T02:49 and 05:09 → step25; 09-18T15:31 → step28 | step16、step17 | 18, 19, 20, 24, 24, 25, 26, 30 |

### Judgment for each focus step

- **pro step 11 (32 jumps) = engineering event.** The previous step had just restarted (vram issue, announcement 09-16T20:08Z). The synchronized jumps are `partial/4/*` 8 items (stale bucket 4's KL/F(tau)/diff all around +30%), `partial/avg_staleness` 1.7878→0.4403, `env/total_setup` 330720→22629 (−93%), `train/verdicts/expired` 1128→288. All are fingerprints of "resampling after restart, the queue being reset". Length itself at this step is **−2.8%**.
- **pro step 14 (43 items) = engineering event (grading side).** 24 items cluster on `penalty/stage_credit_group/*`: `select_groups_failed` 21→194, `groups_failed_select` 32→205, `end2end_success_rate` 0.9507→0.7662. The announcement 09-17T12:20Z says the network between the training cluster and the grading cluster was disconnected and restarted; the timing matches.
- **pro step 15 (75 items) = engineering event × version switch overlay.** `train_infer_diff/*` 9 items and `penalty/*` 26 items jump simultaneously; `end2end_success_rate` returns to 0.9548 (grading recovered); three versions (3-5513.14.7.0 / .14.8.0 / .14.8.15) take effect at this step. Length **−14.2%**, the largest single-step drop in the whole run. **This step cannot be used as an algorithmic conclusion.**
- **pro step 23 (55 items) = engineering event.** Two restarts (09-18T23:06, 09-19T00:03) both point to step23, and two versions `3-5513.22.12.23` and `3-5513.23.12.23` switch in at the same time. The jumps are mainly `critic/general`, `env`, `partial/code`.
- **flash step 25 (117 items, the most in the whole run) = engineering event.** Two restarts + (`3-5513.26.4.25`, `3-5513.27.5.25`). The jumps are almost all `partial/<k>/frac` and `n_tokens`: `partial/visual/dataset-053e/0/frac` 0.0226→1.0000, `partial/8/n_tokens` 167613000→835957 (−99.5%). This is direct evidence that "the restart emptied the stale buckets and turned everything into fresh data". Length −7.7%.
- **flash step 16 (65 items) = engineering event (redo).** The announcement 09-17T02:27Z "restart flash from step 15; the infra error of a certain dataset was not correctly detected for the past ~3 hours", the event sequence shows step16 and step17 are both `redo=true`. The jumps are concentrated on `partial/code` 20 items. Length −8.6%.

### Alignment of DeepSWE single-step big drops

| run | big-drop step | score difference | synchronized jumps | event | judgment |
|---|---|---|---|---|---|
| flash | step11 | −6.05 | Only 10 items, and all are `ctx_prompt_length/*/max` and penalty counts | None | **No corresponding anomaly on the training side, and length even rose 7.5%**. deepseek's single-step change standard deviation is 3.84, this step z≈−1.77, **not enough to rule out evaluation noise** |
| flash | step17 | −5.75 | 41 items (partial/code 18 items) | REDO | engineering event |
| flash | step21 | −4.13 | 22 items (critic/code 9 items) | version switch (3-5513.22.3.16) | version / engineering event |
| pro | step13 | −2.70 | 6 items | None | The change is smaller than 1.4× the adjacent-step standard deviation of 1.95 for this leaderboard, **too weak, no conclusion drawn** |
| pro | step15 | −1.18 | 75 items | restart + 4 versions | engineering event |

**My inference (not a fact)**: the −6.05 DeepSWE drop at flash step 11 is most likely explained by the variance of the evaluation itself (avg@3, limited number of tasks), or by a reasoning-configuration difference invisible to the training-side metrics; our data **does not support** attributing it to "the model got worse" or "caused by length growth".

---

## 8. Counter-evidence: which data does not support "length is a means of gaming the score"

1. **Datasets where length rose but the pass rate did not exist.** pro's `code/dataset-ta4j`: length 80371→148036 (×1.84, regression slope +2510/step, r=0.909), over the same period the pass rate 0.5862→0.5880 barely moved, the two have Spearman ρ=−0.293. pro's `code/dataset-4onq` length ×1.45, pass rate fell from 0.7329 to 0.6315 (ρ=−0.058). flash's `code/dataset-bvg7` length ×2.06, pass rate 0.5769→0.5628 (ρ=−0.325); `code/dataset-v7yx` length ×2.08, pass rate 0.5721→0.5271 (ρ=−0.149); `code/dataset-obg8` length ×2.05, pass rate 0.5467→0.5588 (ρ=−0.118).

2. **There are also clear counterexamples of "length buying score".** flash's `code/dataset-yfch`: length ×3.21 (163328→524848), pass rate 0.4717→0.8217 (+35 percentage points). So "length is useless" is likewise an overgeneralization.

3. **The truncation rate did not blow up along with it.** See Section 5: maximum 0.3%. And `train/verdicts/dropped_empty_response` is 0 for the whole period — the phenomenon of "a long answer filling up the context and causing an empty answer" did not appear.

4. **flash's `dynsam/passrate/one` (share of all-correct tasks) has a differenced ρ of −0.545 (p=0.0022).** In the steps where length jumped up, the share of "tasks the model has already fully mastered" instead fell. This is inconsistent with "length is gaming the score of a metric that has already been conquered".

5. **The differenced correlation between `critic/score/mean` and length is insignificant under all definitions** (pro −0.082, flash −0.106, combined −0.077). The score used for training did not improve in step with length.

6. **Length falls back after a restart, rather than "accumulating" a sustained gain through length.** If length growth were a stable capability improvement (e.g. having learned a longer reasoning chain), it should not be erased 6%~14% by a single ops restart. This pattern looks more like **within-batch data composition** driving the reading, rather than a monotonic jump in model capability. (This is my inference; the observable evidence is that the first-step length after a restart is negative in 80% (pro) / 100% (flash) of cases.)

---

## 9. Uncertain, refuted, mismatched

1. **"Coding tasks surged from 80k to 120k" is inaccurate.** What the data supports is: 11 code datasets each with a sustained climb of ×1.40~×3.21, pro's code-class equal-weight mean first crosses 120k at step 14 (121564), then is knocked back to 101910 by the step 15 restart, and only at step 19 (125104) does it stably stand above 120k. Writing it as a one-time "surge" would obscure the pullback caused by the restart.

2. **"Length rises, so the score rises" was refuted (partially) by my own robustness check.** The conclusion easiest to reach from the previous round's observation is "length is highly positively correlated with avg@n (pro 0.786 / flash 0.932)". After adding first differences and removing events: pro's +0.508 becomes −0.133, flash's avg@n differenced is −0.484 and stronger after removing events (−0.623). **Level correlation has almost no explanatory power in this data and can only be taken as a common trend.**

3. **`critic/returns/mean` and `critic/advantages/mean` are the same series**; after cross-run pooling the sign flips (negative in each run, +0.403 when pooled). This is an artifact of concatenating different baselines; I do not adopt the pooled result. **(uncertain)**

4. **`train/spec_accept_length/*` decreases with length (pro ρ=−0.926 / flash −0.944), but is not significant after differencing** (pro −0.314, p=0.14; flash +0.024, p=0.90). Whether there really is a mechanism whereby “long responses make self-speculative-decoding hit rate worse,” **I am not sure**; it may be just a byproduct of “the model's output distribution becoming more complex.” The speculative-decoding acceptance length itself is not an explanatory variable for this length either; it is just a parallel metric.

5. **The “suspected attempts to bypass evaluation” in `penalty/stage_credit_group` are positively correlated with length, but the correlation is very weak after differencing.** For flash, `select_v4/select_hack_attempt_ge_min_rate` level ρ=0.945 and `..._turns_per_pass` ρ=0.944, but after differencing they drop to 0.074 and 0.284; the aggregate measure `select_hack_attempt_rate` (suspected cheating attempt rate) has differenced correlations of pro 0.263 (p=0.23) / flash 0.318 (p=0.093), **neither reaching significance at 0.05**, and the sign is inconsistent on pro. I **dare not** say on this basis that “length growth is accompanied by increased score-gaming behavior.” In addition, the `penalty/stage_credit_group` family was perturbed as a whole by an engineering event at steps 14/15 (24~26 metrics in the same family jumped together), so the correlations are mixed with engineering noise.

6. **`train/passrate/avg_passrate/visual/dataset-ol8x` and `dataset-gtav` contain a large number of 0s**; I suspect they are the “not reported” sentinel rather than a true 0% (the script's data-quality check flagged these two). I have marked any pass-rate numbers involving these two datasets as unreliable and have not relied on them.

7. **Things I don't understand / that don't match up:**
   - `train/verdicts/dropped_zero_adv` (number of discarded zero-advantage groups), `train/verdicts/trained`, and `training/actor_optimizer_steps` have only 1~2 distinct values; it is impossible to determine whether this is constant reporting or a dashboard bug.
   - `actor/ppo_kl` (policy KL) and `actor/pg_clipfrac` (PPO clipping ratio) are identically zero globally for the entire period; only the per-dataset `pg_tis_clipfrac` (TIS clipping ratio) has nonzero values. Whether the global PPO KL being 0 is a real reading or is not wired in **cannot be determined**.
   - `ctx_prompt_length/*/max` can drop from 566065 to 4879 between adjacent steps, or rise from 5305 to 30533 (pro steps 11, 14, and 15). I cannot explain the source of the extreme-value jitter caused by a single overlong prompt; I only know that it is max rather than mean, and has almost no effect on the mean.
   - flash has two restarts (09-18T02:49, 05:09) that both map to step25, but the step24→25 span is 7.5 hours (steps average about 1.6~2.5 hours); **whether the 3-hour difference is restart wait or statistical convention, I cannot reconcile it**.

---

## 10. Three transferable professional concepts

### Concept 1: Length bias (length bias) and “length score-farming”

- **Definition**: A reward signal or evaluator systematically prefers longer answers, so the policy learns to “make answers longer” rather than “get the problem right.” In RLHF, it comes from the reward model's spurious preference for length; in algorithms like GRPO/PPO that have only outcome rewards, it comes from **the loss function itself**—DAPO explicitly points out that sample-level loss aggregation “cannot effectively penalize low-quality patterns in long samples (gibberish, repetition), leading to unhealthy growth in entropy and answer length”; Dr. GRPO directly says GRPO has an optimization bias that “artificially lengthens answers, especially incorrect ones”; *Concise Reasoning via RL* goes further and gives a theorem: **negative advantage is a sufficient condition for lengthening**, and observes that correct answers are generally shorter than incorrect answers.
- **Manifestation in this paper's data**: `critic/advantages/mean` is negatively correlated with length (pro ρ=−0.477, flash ρ=−0.778); `actor/entropy_loss` trends upward throughout (pro 0.3953→0.4437, flash 0.4133→0.4706); length increases the most in the code category (×1.82 / ×2.21), while the pass rate in the code category did not rise substantially in tandem (multiple datasets ρ≤0). These are fingerprints of “the loss structure pushing length,” not “length buying accuracy.”
- **Transferable decision rule**: When you see “length rising + task metric also rising,” first compute the first difference. If the differenced correlation disappears or turns negative, treat length as a **side effect of the objective function** rather than evidence of capability improvement; what should actually be examined is the loss aggregation method (token-level vs sample-level normalization), the KL/clipping settings, and whether there is an overlong penalty.

### Concept 2: Truncation convention (truncation / overlong handling)

- **Definition**: Trajectories exceeding the context limit are hard-truncated; the truncated answers often cannot obtain the correct reward, making them samples that “burn compute and also contaminate the signal.” There are two mainstream approaches: **overlong filtering** (directly removing overlong samples from the loss) and **overlong reward shaping** (giving overlong samples that have not yet reached the hard limit a linearly increasing penalty). verl's implementation is the latter: after length exceeds `max_response_length - overlong_buffer.len`, the reward decreases linearly from 0 to `penalty_factor`; the best result in the DAPO paper instead comes from **not enabling overlong filtering**.
- **Manifestation in this paper's data**: `ctx_total_length/max` is pinned at 1048570 for a long time (≈2²⁰=1048576); this value appears in 11/24 steps for pro and 15/30 steps for flash, indicating that the hard limit really exists and is being hit; however, `ctx_total_length/clip_ratio` is only 4.0e-5 ~ 3.1e-3, and `train/verdicts/dropped_empty_response` is 0 over the entire period. **“The limit exists” and “the limit becomes a bottleneck” are two different things.**
- **Transferable decision rule**: When discussing whether long-context training is “dragged down by truncation,” you must look at three numbers at the same time—the limit value (look at the repeated value of max), the truncated proportion (`clip_ratio`), and the number of discarded empty answers/overlong samples. Only when “the proportion rises markedly with length and reaches the 1% order of magnitude or above” is it worth changing the length limit or adding a penalty for this; merely seeing max hug the limit requires first calculating the proportion.

### Concept 3: Spurious correlation and detrending of trend series

- **Definition**: Two series that both change monotonically over time will necessarily have a high correlation coefficient, even if there is no causal relationship between them (among N independent random walks, the expectation of |ρ| is also close to 0.5 or above). The countermeasure is to take a **first difference** (correlate Δx with Δy to eliminate the common slow-varying trend), then perform **event removal** (remove known exogenous shock points) so that shock points do not dominate the differenced sample.
- **Manifestation in this paper's data**: The level ρ of `ctx_response_length/mean` and `dynsam/avg@n` is 0.786 for pro and 0.932 for flash, which looks like ironclad proof; after differencing, pro becomes −0.063 (p=0.77). Even more striking, after removing steps adjacent to engineering events, the only significant positive differenced correlation on pro (training pass rate +0.508, p=0.013) flips to −0.133 (p=0.73), indicating that it is mainly contributed by points around restarts. `perf/total_num_tokens` and length have ρ=0.998, which is another extreme: it is an identity (token count for this step ÷ average length = 26173, coefficient of variation 0.7%), not “correlation” at all but “conversion.”
- **Transferable decision rule**: For any conclusion from training logs that “A rises and B also rises,” before delivering it, do at least three things—(1) report the first-differenced correlation; (2) report the sample size and the significance critical value (in this paper, the critical |ρ| for pro n=24 is 0.404, and for flash n=30 it is 0.361); (3) mark known engineering events (restarts, version switches, evaluation backfills) on the timeline and check whether the conclusion is supported only by these points.

---

## 11. Terminology quick reference

| Term | One-sentence explanation |
|---|---|
| `ctx_response_length/mean` | How many tokens one trajectory generated on average in the training batch at this step (the main subject of this paper) |
| `ctx_total_length/mean` | Total length of generation + prompt; measured ≈ generation length + prompt length |
| `ctx_prompt_length/mean` | Average length of input prompts; stable at 3964~4489 throughout, almost unchanged |
| `dynsam/avg@n` | Main metric on the homepage: average problem pass rate (16 samples per problem) |
| `dynsam/passrate/one` / `zero` | Proportion of questions all correct across 16 attempts / proportion of questions all wrong across 16 attempts |
| `train/passrate/avg_passrate` | Average pass rate of the batch of questions that entered training |
| `critic/score/mean`、`critic/rewards/mean` | Average score / average reward of trajectories at this step (the two values are the same) |
| `critic/advantages/mean`、`critic/returns/mean` | Average advantage / average return (the two values are the same) |
| `actor/entropy_loss` | Policy entropy (larger is more random) |
| `partial/avg_staleness` | Average data staleness: the average number of policy versions separating the tokens used for training |
| `partial/<k>/frac` | Token proportion of the k-th staleness bucket; bucket 0 is the freshest |
| `timing_s/trainer_ops`、`timing_s/outer_gen`、`timing_s/step` | Trainer time at this step / sampling generation time / full-step time; the latter does not include restart wait |
| `ctx_total_length/clip_ratio` | Proportion of trajectories truncated because they hit the length limit |
| `train/verdicts/dropped_empty_response` | Number of trajectories discarded because the answer was empty (0 over the entire period) |
| `train/spec_accept_length/*` | Average accepted length of speculative decoding (self-speculative decoding) |
| `penalty/stage_credit_group/*` | Statistics of the grading/group-scoring process (success-rate ones, failure ones, suspected evaluation-bypass ones) |
| `train/adv_pos_sum_*`、`train/adv_neg_sum_*` | Total of positive/negative advantages summed by token (≈ constant × this step's token count) |
| `perf/total_num_tokens` | Training token count for this step (≈ fixed number of trajectories × average generation length) |

---

## XII. Appendix: Core numbers and reproduction

**Reproduction command** (project root):

```bash
# JSON is written by the script itself; .txt is a redirect of the same stdout, the two commands are run together
bun src/correlate_report.ts
bun src/correlate_report.ts > analysis/zh-CN/numbers/A3-生成长度相关性-numbers.txt
```

Artifacts:
- `analysis/zh-CN/numbers/A3-生成长度相关性-numbers.json` (all recomputed numbers, machine-readable, about 1.4 MB)
- `analysis/zh-CN/numbers/A3-生成长度相关性-numbers.txt` (full human-readable summary of script stdout, generated by the second command above)

> Another script with a parallel convention, `length_report.ts`, outputs `A3-生成长度-numbers.json`,
> for `notes/08` to use; the two are implemented independently, and the first/last values (68078→114676 / 67463→143385) agree.

**Core numbers at a glance**

| Number | pro | flash |
|---|---|---|
| Number of metrics × number of steps | 1944 × 24 | 1974 × 30 |
| Data collection time | 2026-09-19T08:58:10Z | 2026-09-19T03:07:03Z |
| Generation length first→last | 68078 → 114676（×1.684） | 67463 → 143385（×2.125） |
| Mean of first 5 steps → mean of last 5 steps | 71121 → 106015（+49.1%） | 77025 → 128361（+66.6%） |
| Linear trend slope / r / R² | +1658/step / 0.923 / 0.851 | +2046/step / 0.958 / 0.919 |
| code category first→last | 73447 → 134017（×1.82） | 71829 → 158571（×2.21） |
| Single step-change model vs linear (explained variance) | 59.7% vs 85.1% | 73.0% vs 91.9% |
| Maximum single-step relative change | step15 −14.2%、step24 +13.1% | step4 +13.7%、step30 +13.0%、step16 −8.6% |
| Length change of first step after restart vs other steps | −3.3% (80% negative, n=5) vs +5.5% (7.7% negative, n=13) | −6.3% (100% negative, n=3) vs +3.9% (22.7% negative, n=22) |
| Spearman critical \|ρ\|（p=0.05） | 0.404 | 0.361 |
| Length vs avg@n: level / difference | 0.786 / −0.063 | 0.932 / −0.484 |
| Length vs training pass rate: level / difference / excluding events | 0.749 / +0.508 / −0.133 | 0.898 / +0.247 / −0.077 |
| Length vs staleness: level / difference / excluding events | 0.260 / +0.651 / +0.083 | 0.172 / +0.717 / +0.509 |
| Length vs trainer_ops: difference / excluding events | +0.559 / +0.650 | +0.675 / +0.721 |
| clip_ratio maximum | 9.18e-4（step22） | 3.1e-3（step18） |
| Number of steps with `ctx_total_length/max` = 1048570 | 11/24 | 15/30 |
| Trainer seconds per billion tokens first→last | 1605 → 2374（×1.48） | 1053 → 1553（×1.47） |
| This step's token count ÷ average generation length | 26173 (coefficient of variation 0.7%) | 25953 (coefficient of variation 1.0%) |
| Number of restarts (`status.totals.restarts`) | 11 | 5 |
| Cost rate / cumulative | 5.71/s / 1,941,107 | 2.855/s / 854,045 |

**External literature comparison (all from `web_search` / `web_fetch`, no browser used)**

| Literature | Which observation of this paper it supports/refutes |
|---|---|
| [DAPO: An Open-Source LLM Reinforcement Learning System at Scale](https://arxiv.org/abs/2503.14476)（arXiv:2503.14476） | Supports items 1 and 6: §3.3 explicitly writes that sample-level loss aggregation "cannot effectively penalize low-quality patterns in long samples…leading to unhealthy growth in entropy and response length"; §3.4 proposes overlong reward shaping |
| [verl DAPO recipe documentation](https://verl.readthedocs.io/en/latest/algo/dapo.html) | Gives the precise definition of the overlong penalty (after exceeding `max_response_length - overlong_buffer.len`, reward linearly decreases to −penalty_factor), and states that the official best experiment **did not enable** overlong filtering——supporting the reading in Section 5 that "truncation is not the bottleneck in this run". |
| [Understanding R1-Zero-Like Training: A Critical Perspective（Dr. GRPO）](https://arxiv.org/abs/2503.20783)（arXiv:2503.20783） | Supports item 6: the abstract's original text points out that GRPO has an optimization bias that "artificially increases response length (especially for incorrect outputs)" |
| [Concise Reasoning via Reinforcement Learning](https://ar5iv.labs.arxiv.org/html/2504.05185)（arXiv:2504.05185） | Supports item 6 and Section 4: the theorem (GRPO Prolixity) shows that negative advantage is a sufficient condition for lengthening; Table 1 gives "correct responses are generally shorter than incorrect responses"; and argues that length growth stems from loss minimization rather than reward hacking |
| [Beyond Excess and Deficiency: Adaptive Length Bias Mitigation in Reward Models for RLHF](https://aclanthology.org/2025.findings-naacl.169/)（Findings of NAACL 2025） | Supports concept 1: reward models have a bias that "the longer, the more preferred," which leads to overly verbose responses |
| [Bias Fitting to Mitigate Length Bias of Reward Model in RLHF](https://aclanthology.org/2026.acl-long.133/)（ACL 2026） | Supports concept 1: directly calls length bias a typical example of reward hacking, and points out that the length-reward relationship is nonlinear |
| [Length-Controlled AlpacaEval](https://arxiv.org/abs/2404.04475)（arXiv:2404.04475） | Supports concept 3: "length confounding" on the evaluation side is a known bias; after controlling for length, the Spearman between metrics and human preference rises from 0.94 to 0.98——indicating that "length" is a confounder that must be controlled in evaluation |
| [Stable Asynchrony: Variance-Controlled Off-Policy RL for LLMs](https://icml.cc/virtual/2026/poster/62012)、[Deconstructing Off-Policy Ratios: Entropy-Scaled Trust Regions for Asynchronous RL](https://arxiv-org.ezproxy.obspm.fr/html/2607.22186v1) | Related to the "staleness cluster" in Section 6 (stale data in asynchronous RL and off-policy ratios need correction). **I have only seen the title and abstract fragment, not the full text**, so this is only a clue |

---

## XIII. Editorial note: corrections from two subsequent rounds of independent accounting (2026-09-19 evening)

This section contains **two corrections to this paper**, from two other independent scripts (`bench_report.ts`, `dataset_report.ts`),
not self-revisions by the original author —— the original text is kept and the corrections are recorded here so that readers can see the disagreement itself.

1. **For that "big drop you don't need to draw a conclusion from" in Section 7, the reason needs to be changed.** This paper's judgment is "flash DeepSWE step 11 −6.05 points,
   the standard deviation of adjacent-step changes for this leaderboard is 3.84, z≈−1.77, insufficient to rule out evaluation noise".
   The conclusion is unchanged, but the stronger reason is **multiple comparisons**: the minimum detectable change computed by `bench_report.ts` using Theil–Sen residuals
   (MDE) for DeepSWE/flash is **6.43 points**, and this step's drop of 6.05 points is **smaller than it**;
   more importantly, among all 115 single-step changes, after Holm correction by leaderboard×run only 1 remains significant; under the "whether it deviates from trend" criterion, it is **0**.
   that is, this step itself is "the maximum selected from 115 cases"; whether the z value is large is not the key point.
   (The difference between `z≈−1.77` and `z=−2.00` comes from different residual criteria: this paper uses the standard deviation of adjacent-step differences, while that side uses trend residuals.)

2. **The reason in Section 2 that "`axis.walls` will be misaligned due to redo" could not be reproduced.** Based on this, this paper chooses "align by `events` event sequence".
   `bench_report.ts` compared the timestamps of `axis.walls` and `status.events` point by point (7 points sampled each from pro / flash),
   the difference is 0.0 seconds, and **no misalignment was observed**. The alignment method itself is still usable (aligning by event sequence is the more stable approach),
   but the specific reason that "it will be misaligned" currently has support from only one place; readers who want to reuse it should verify it themselves.
