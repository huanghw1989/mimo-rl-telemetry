# mimo-v2.6 RL dashboard metric list

> Data source: https://mimo.xiaomi.com/rl/, snapshot directory `data/raw/20260917T151117Z/`

The site exposes all metric names via `/rl/api/tags?run=<pro|flash>`. Below, they are grouped by first-level namespace, and the number of sub-namespaces under each first-level namespace is marked.


## pro (data version `3-5513.15.8.15`, 2019 metric names in total)

| First-level namespace | Metric count | Second-level namespace example |
| --- | ---: | --- |
| `penalty` | 535 | action、signed、stage_credit_group |
| `partial` | 327 | 0、1、2、3、4、5、6、7… |
| `critic` | 324 | advantages、agentic、chat、code、cyber、general、returns、rewards… |
| `actor` | 257 | agentic、chat、clip_high、clip_low、code、cyber、entropy_loss、general… |
| `train` | 191 | adv_neg_sum_post_penalty、adv_neg_sum_pre_penalty、adv_pos_sum_post_penalty、adv_pos_sum_pre_penalty、harness、passrate、spec_accept_length、trace… |
| `ctx_total_length` | 108 | agentic、chat、clip_ratio、code、cyber、general、max、mean… |
| `dynsam` | 83 | agentic、agg_turn、avg@n、chat、code、cyber、general、infra_error… |
| `ctx_prompt_length` | 81 | agentic、chat、code、cyber、general、max、mean、min… |
| `ctx_response_length` | 81 | agentic、chat、code、cyber、general、max、mean、min… |
| `env` | 15 | active、code、cyber、general、possible_leak、total_error、total_setup、visual |
| `train_infer_diff` | 11 | new_infer、nll_loss |
| `timing_s` | 3 | outer_gen、step、trainer_ops |
| `training` | 2 | actor_optimizer_steps、global_step |
| `perf` | 1 | total_num_tokens |

### Metrics with an official one-sentence explanation

| Metric | Official explanation (original text) |
| --- | --- |
| `dynsam/avg@n` | mean pass rate: for each prompt sampled this step, the fraction of its n attempts that succeed, averaged over prompts |
| `dynsam/avg@n_no_infra` | avg@n with attempts that failed for infrastructure reasons excluded |
| `critic/rewards/mean` | mean reward over trajectories trained on this step |
| `actor/entropy_loss` | mean per-token entropy of the policy |
| `actor/pg_loss` | clipped policy-gradient objective |
| `actor/grad_norm` | global gradient norm before clipping |
| `train_infer_diff/new_infer/kl` | KL between inference-engine and trainer log-probs on the same tokens |
| `ctx_response_length/mean` | tokens generated per trajectory |
| `dynsam/agg_turn/mean` | agent turns per trajectory |
| `perf/total_num_tokens` | tokens trained on this step |
| `timing_s/step` | wall-clock of the whole step |
| `timing_s/outer_gen` | wall-clock of rollout generation |
| `timing_s/trainer_ops` | wall-clock of the trainer |
| `dynsam/passrate/zero` | share of prompts where no attempt succeeded |
| `dynsam/passrate/one` | share of prompts where every attempt succeeded |
| `dynsam/infra_error/seq_rate` | share of sequences lost to infrastructure failures |
| `env/active` | sandbox environments in flight |
| `partial/avg_staleness` | policy versions between sampling and training, on average |
| `dynsam/num_measurable` | prompts with a measurable pass rate this step; per data source under dynsam/<source>/num_measurable |
| `dynsam/passrate/hist9_ratio` | share of prompts by pass rate, in nine bins from none solved to all solved |
| `train/harness/*/training/rollouts` | rollouts in the training batch, per agent harness |
| `ctx_total_length/mean` | total context length per trajectory (prompt + response), in tokens |

(Of all 2019 metric names, only the 22 in the table above have a text explanation; the rest are raw key names from the training logs, and the site does not explain them.)


### Metrics permanently displayed on the site homepage

`dynsam/avg@n`、`critic/rewards/mean`、`actor/entropy_loss`、`actor/pg_loss`、`actor/grad_norm`、`train_infer_diff/new_infer/kl`、`ctx_total_length/mean`、`dynsam/agg_turn/mean`、`perf/total_num_tokens`、`timing_s/step`、`timing_s/outer_gen`、`timing_s/trainer_ops`、`dynsam/passrate/zero`、`dynsam/passrate/one`、`dynsam/infra_error/seq_rate`、`env/active`、`partial/avg_staleness`、`dynsam/num_measurable`

## flash (data version `3-5513.22.3.16`, 2056 metric names in total)

| First-level namespace | Metric count | Second-level namespace example |
| --- | ---: | --- |
| `penalty` | 521 | action、signed、stage_credit_group |
| `partial` | 379 | 0、1、2、3、4、5、6、7… |
| `critic` | 324 | advantages、agentic、chat、code、cyber、general、returns、rewards… |
| `actor` | 256 | agentic、chat、clip_high、clip_low、code、cyber、entropy_loss、general… |
| `train` | 191 | adv_neg_sum_post_penalty、adv_neg_sum_pre_penalty、adv_pos_sum_post_penalty、adv_pos_sum_pre_penalty、harness、passrate、spec_accept_length、trace… |
| `ctx_total_length` | 108 | agentic、chat、clip_ratio、code、cyber、general、max、mean… |
| `dynsam` | 83 | agentic、agg_turn、avg@n、chat、code、cyber、general、infra_error… |
| `ctx_prompt_length` | 81 | agentic、chat、code、cyber、general、max、mean、min… |
| `ctx_response_length` | 81 | agentic、chat、code、cyber、general、max、mean、min… |
| `env` | 15 | active、code、cyber、general、possible_leak、total_error、total_setup、visual |
| `train_infer_diff` | 11 | new_infer、nll_loss |
| `timing_s` | 3 | outer_gen、step、trainer_ops |
| `training` | 2 | actor_optimizer_steps、global_step |
| `perf` | 1 | total_num_tokens |

### Metrics with an official one-sentence explanation

| Metric | Official explanation (original text) |
| --- | --- |
| `dynsam/avg@n` | mean pass rate: for each prompt sampled this step, the fraction of its n attempts that succeed, averaged over prompts |
| `dynsam/avg@n_no_infra` | avg@n with attempts that failed for infrastructure reasons excluded |
| `critic/rewards/mean` | mean reward over trajectories trained on this step |
| `actor/entropy_loss` | mean per-token entropy of the policy |
| `actor/pg_loss` | clipped policy-gradient objective |
| `actor/grad_norm` | global gradient norm before clipping |
| `train_infer_diff/new_infer/kl` | KL between inference-engine and trainer log-probs on the same tokens |
| `ctx_response_length/mean` | tokens generated per trajectory |
| `dynsam/agg_turn/mean` | agent turns per trajectory |
| `perf/total_num_tokens` | tokens trained on this step |
| `timing_s/step` | wall-clock of the whole step |
| `timing_s/outer_gen` | wall-clock of rollout generation |
| `timing_s/trainer_ops` | wall-clock of the trainer |
| `dynsam/passrate/zero` | share of prompts where no attempt succeeded |
| `dynsam/passrate/one` | share of prompts where every attempt succeeded |
| `dynsam/infra_error/seq_rate` | share of sequences lost to infrastructure failures |
| `env/active` | sandbox environments in flight |
| `partial/avg_staleness` | policy versions between sampling and training, on average |
| `dynsam/num_measurable` | prompts with a measurable pass rate this step; per data source under dynsam/<source>/num_measurable |
| `dynsam/passrate/hist9_ratio` | share of prompts by pass rate, in nine bins from none solved to all solved |
| `train/harness/*/training/rollouts` | rollouts in the training batch, per agent harness |
| `ctx_total_length/mean` | total context length per trajectory (prompt + response), in tokens |

(Of all 2056 metric names, only the 22 in the table above have a text explanation; the rest are raw key names from the training logs, and the site does not explain them.)


### Metrics permanently displayed on the site homepage

`dynsam/avg@n`、`critic/rewards/mean`、`actor/entropy_loss`、`actor/pg_loss`、`actor/grad_norm`、`train_infer_diff/new_infer/kl`、`ctx_total_length/mean`、`dynsam/agg_turn/mean`、`perf/total_num_tokens`、`timing_s/step`、`timing_s/outer_gen`、`timing_s/trainer_ops`、`dynsam/passrate/zero`、`dynsam/passrate/one`、`dynsam/infra_error/seq_rate`、`env/active`、`partial/avg_staleness`、`dynsam/num_measurable`
