# Numerical checks and derived quantities

> Snapshot `data/raw/20260917T151117Z/`. All numbers are calculated directly from the raw data of the public interface; see `codes/scripts/insight_mimo_rl.py` for the script.


## pro (15 steps)

### Identity checks

| Relationship to verify | Result |
| --- | --- |
| `ctx_total_length/mean` = `ctx_prompt_length/mean` + `ctx_response_length/mean` | Holds for all steps |
| `partial/avg_staleness` = Σ i × `partial/i/frac` | For 15/15 steps it holds exactly; for the remaining steps, the sum of the 8 frac values is less than 1 (there is a long tail with staleness ≥ 8) |
| `perf/total_num_tokens` = 1568 × 16 × `ctx_total_length/mean` | Maximum relative deviation 1.17% |
| `critic/rewards/mean` and `critic/score/mean` | Identical step by step |

### Long tail of the staleness distribution

| step | Proportion of tokens outside the 8 bins | Σ i×frac | Reported value |
| ---: | ---: | ---: | ---: |

### Derived quantity

| step | Time used (h) | Training token (B) | Cost for this step (thousand USD) | Cost per million training tokens ($) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2.66 | 1.80 | 54.6 | 30.3 |
| 2 | 2.01 | 1.73 | 41.3 | 23.8 |
| 3 | 2.36 | 1.86 | 48.5 | 26.1 |
| 4 | 1.90 | 2.01 | 39.1 | 19.5 |
| 5 | 1.93 | 2.01 | 39.7 | 19.8 |
| 6 | 1.93 | 2.12 | 39.6 | 18.7 |
| 7 | 2.17 | 2.25 | 44.6 | 19.9 |
| 8 | 2.15 | 2.27 | 44.2 | 19.5 |
| 9 | 2.41 | 2.33 | 49.5 | 21.3 |
| 10 | 2.11 | 2.22 | 43.3 | 19.5 |
| 11 | 2.62 | 2.16 | 53.8 | 24.9 |
| 12 | 2.52 | 2.33 | 51.7 | 22.2 |
| 13 | 2.62 | 2.49 | 53.8 | 21.6 |
| 14 | 2.91 | 2.65 | 59.9 | 22.6 |
| 15 | 3.58 | 2.29 | 73.6 | 32.2 |

Total: trained 32.5B tokens, spent about 737 thousand USD, averaging about 23 USD per million training tokens.

### Trends and correlations

| Relationship | Correlation coefficient | Slope (y on x) | Description |
| --- | ---: | ---: | --- |
| `step` → `avg@n` | +0.947 | 0.004648 | Linear trend of score over step (how much improvement per step) |
| `step` → `ctx_total_length/mean` | +0.887 | 2018 | Growth rate of context length over step |
| `step` → `timing_s/trainer_ops` | +0.809 | 109.5 | Growth rate of trainer time over step |
| `ctx_total_length/mean` → `timing_s/trainer_ops` | +0.967 | 0.0575 | Relationship between trainer time and context length |
| `avg@n` → `passrate/one` | +0.927 | 1.338 | Relationship between score improvement and "all-correct proportion" |
| `avg@n` → `passrate/zero` | -0.433 | -0.09355 | Relationship between score improvement and "all-wrong proportion" |
| `avg@n` → `critic/rewards/mean` | +0.933 | 0.5166 | Relationship between pass rate and mean reward |
| `ctx_total_length/mean` → `avg@n` | +0.899 | 1.938e-06 | Relationship between length growth and score |
| `dynsam/agg_turn/mean` → `avg@n` | +0.608 | 0.002217 | Relationship between rounds and score |
| `actor/entropy_loss` → `avg@n` | +0.733 | 2.137 | Relationship between entropy and score |

### First-to-last difference (in absolute terms, not percentage)

| Metric | step 1 | Last step | Absolute change |
| --- | ---: | ---: | ---: |
| `dynsam/avg@n` | 0.5647 | 0.6172 | +0.05254 |
| `critic/rewards/mean` | 0.5522 | 0.5824 | +0.03019 |
| `actor/entropy_loss` | 0.3953 | 0.4013 | +0.006008 |
| `dynsam/passrate/zero` | 0.1462 | 0.1496 | +0.003396 |
| `dynsam/passrate/one` | 0.1779 | 0.2687 | +0.09081 |
| `ctx_total_length/mean` | 7.218e+04 | 9.146e+04 | +1.928e+04 |
| `dynsam/agg_turn/mean` | 47.47 | 49.69 | +2.218 |
| `train_infer_diff/new_infer/kl` | 0.002189 | 0.002577 | +0.0003875 |
| `partial/avg_staleness` | 0 | 0 | +0 |
| `timing_s/step` | 9570 | 1.288e+04 | +3312 |
| `timing_s/outer_gen` | 6514 | 8900 | +2386 |
| `timing_s/trainer_ops` | 2889 | 3778 | +888.8 |
| `perf/total_num_tokens` | 1.801e+09 | 2.286e+09 | +4.855e+08 |
| `env/active` | 3.114e+04 | 2.242e+04 | -8720 |
| `dynsam/infra_error/seq_rate` | 0.007257 | 0.005065 | -0.002191 |

## flash (20 steps)

### Identity checks

| Relationship to verify | Result |
| --- | --- |
| `ctx_total_length/mean` = `ctx_prompt_length/mean` + `ctx_response_length/mean` | Holds for all steps |
| `partial/avg_staleness` = Σ i × `partial/i/frac` | For 15/20 steps it holds exactly; for the remaining steps, the sum of the 8 frac values is less than 1 (there is a long tail with staleness ≥ 8) |
| `perf/total_num_tokens` = 1568 × 16 × `ctx_total_length/mean` | Maximum relative deviation 2.69% |
| `critic/rewards/mean` and `critic/score/mean` | Identical step by step |

### Long tail of the staleness distribution

| step | Proportion of tokens outside the 8 bins | Σ i×frac | Reported value |
| ---: | ---: | ---: | ---: |
| 11 | 0.47% | 1.66586 | 1.70337 |
| 12 | 0.43% | 1.67125 | 1.70778 |
| 13 | 0.33% | 1.77491 | 1.80394 |
| 14 | 0.40% | 1.8557 | 1.88947 |
| 15 | 0.37% | 1.84403 | 1.87435 |

### Derived quantity

| step | Time used (h) | Training token (B) | Cost for this step (thousand USD) | Cost per million training tokens ($) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.80 | 1.79 | 18.5 | 10.3 |
| 2 | 1.36 | 1.96 | 14.0 | 7.1 |
| 3 | 1.92 | 1.94 | 19.8 | 10.2 |
| 4 | 1.87 | 2.19 | 19.2 | 8.8 |
| 5 | 1.57 | 2.26 | 16.1 | 7.1 |
| 6 | 1.70 | 2.30 | 17.4 | 7.6 |
| 7 | 1.76 | 2.44 | 18.1 | 7.4 |
| 8 | 1.62 | 2.35 | 16.6 | 7.1 |
| 9 | 1.72 | 2.33 | 17.7 | 7.6 |
| 10 | 1.73 | 2.40 | 17.8 | 7.4 |
| 11 | 1.96 | 2.57 | 20.1 | 7.8 |
| 12 | 1.95 | 2.59 | 20.0 | 7.7 |
| 13 | 1.98 | 2.60 | 20.3 | 7.8 |
| 14 | 2.27 | 2.81 | 23.3 | 8.3 |
| 15 | 2.10 | 2.69 | 21.6 | 8.0 |
| 16 | 2.83 | 2.42 | 29.1 | 12.0 |
| 17 | 2.22 | 2.66 | 22.8 | 8.6 |
| 18 | 2.48 | 2.82 | 25.5 | 9.0 |
| 19 | 2.43 | 3.08 | 25.0 | 8.1 |
| 20 | 2.82 | 3.22 | 29.0 | 9.0 |

Total: trained 49.4B tokens, spent about 412 thousand USD, averaging about 8 USD per million training tokens.

### Trends and correlations

| Relationship | Correlation coefficient | Slope (y on x) | Description |
| --- | ---: | ---: | --- |
| `step` → `avg@n` | +0.951 | 0.005632 | Linear trend of score over step (how much improvement per step) |
| `step` → `ctx_total_length/mean` | +0.941 | 2351 | Growth rate of context length over step |
| `step` → `timing_s/trainer_ops` | +0.877 | 114.3 | Growth rate of trainer time over step |
| `ctx_total_length/mean` → `timing_s/trainer_ops` | +0.975 | 0.05082 | Relationship between trainer time and context length |
| `avg@n` → `passrate/one` | +0.964 | 1.216 | Relationship between score improvement and "all-correct proportion" |
| `avg@n` → `passrate/zero` | -0.442 | -0.1084 | Relationship between score improvement and "all-wrong proportion" |
| `avg@n` → `critic/rewards/mean` | +0.874 | 0.4416 | Relationship between pass rate and mean reward |
| `ctx_total_length/mean` → `avg@n` | +0.872 | 2.069e-06 | Relationship between length growth and score |
| `dynsam/agg_turn/mean` → `avg@n` | +0.378 | 0.002692 | Relationship between rounds and score |
| `actor/entropy_loss` → `avg@n` | +0.792 | 2.518 | Relationship between entropy and score |

### First-to-last difference (in absolute terms, not percentage)

| Metric | step 1 | Last step | Absolute change |
| --- | ---: | ---: | ---: |
| `dynsam/avg@n` | 0.5137 | 0.6071 | +0.09337 |
| `critic/rewards/mean` | 0.5167 | 0.5713 | +0.05462 |
| `actor/entropy_loss` | 0.4133 | 0.4343 | +0.02102 |
| `dynsam/passrate/zero` | 0.1605 | 0.1576 | -0.00289 |
| `dynsam/passrate/one` | 0.1208 | 0.251 | +0.1302 |
| `ctx_total_length/mean` | 7.163e+04 | 1.294e+05 | +5.776e+04 |
| `dynsam/agg_turn/mean` | 47.31 | 62.97 | +15.65 |
| `train_infer_diff/new_infer/kl` | 0.002868 | 0.009786 | +0.006918 |
| `partial/avg_staleness` | 0 | 1.591 | +1.591 |
| `timing_s/step` | 6483 | 1.014e+04 | +3659 |
| `timing_s/outer_gen` | 4443 | 4932 | +489.3 |
| `timing_s/trainer_ops` | 1884 | 4954 | +3070 |
| `perf/total_num_tokens` | 1.79e+09 | 3.217e+09 | +1.427e+09 |
| `env/active` | 3.928e+04 | 3.817e+04 | -1111 |
| `dynsam/infra_error/seq_rate` | 0.005716 | 0.008499 | +0.002783 |
