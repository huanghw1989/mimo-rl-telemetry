# Survey B: Metric explanations and common pitfalls in Chinese documentation of open-source RL training frameworks

Collection method: self-built script under `analysis/en/tools/` (requests+BeautifulSoup), **browser not used**. The verl Chinese site (`verl.org.cn/sitemap.xml`, all **120 pages**) and slime Chinese site (BFS **77 pages**) were downloaded locally and then full-text searched; for ROLL/AReaL/OpenRLHF, Chinese documents in the repositories were located via the GitHub API and then the original text was scraped. Anything not scraped is uniformly written as "not found"; Zhihu/CSDN blogs hit by Bing were not verified one by one, **not cited**.

## 1. verl (official Chinese documentation)

Source nature: verl official Chinese documentation (Sphinx, footer "© 2024 ByteDance Seed Foundation MLSys Team").

### 1.1 Dedicated metric explanation page (most comprehensive)

【URL】https://verl.org.cn/en/latest/ascend_tutorial/dev_guide/model_dev/parameter_and_metrics.html

Actor group original excerpt: `actor/pg_loss`「policy gradient loss (PPO clip loss), the policy gradient objective value based on the advantage function」; `actor/pg_clipfrac`「proportion of PPO clipping mechanism taking effect, reflecting the stability of the policy update magnitude」; `actor/ppo_kl`「actual KL divergence of the PPO algorithm (current policy vs old policy)」; `actor/entropy`「policy entropy, indicating the randomness or exploration ability of the policy (printed only when `calculate_entropy=True` or `entropy_coeff!=0`)」; `actor/grad_norm`「Actor gradient norm (after clipping)」; `actor/kl_loss`「KL divergence loss, measuring the degree of deviation between the current policy and the reference policy (printed only when `use_kl_loss=True`)」.
Critic group: `critic/vf_loss`「value function loss」; `critic/vf_clipfrac`「proportion of Critic clipping mechanism taking effect, reflecting the stability of the value function update magnitude」; `critic/vf_explained_var`「value function explained variance 1 - Var(returns-values)/Var(returns)」; `critic/rewards|advantages|returns/mean|max|min` are respectively the mean, max, and min of 「sequence reward of non-terminated samples」 and 「advantage value/return of valid tokens」; `response_length/clip_ratio`「proportion of response lengths reaching the maximum length」.
Section 2.8 「Conditional metrics」: 「printed only when `rollout_correction` is enabled, all with the `rollout_corr/` prefix」, including `rollout_is_mean|std|eff_sample_size`, `rollout_is_ratio_fraction_high`「proportion of IS weights exceeding the upper threshold」, `rollout_corr/kl`, `k3_kl`「K3 KL estimate (more stable)」, `ppl_ratio`; training-inference consistency metrics (requires `calculate_log_probs=True`) include `training/rollout_probs_diff_mean`.

**Key conclusion: this page only explains "what it is", and does not give "normal range/abnormal meaning"**; the only numerical empirical value on the entire page is the configuration item `actor.clip_ratio` default 0.2 「PPO clipping ratio, controls the policy update magnitude, **general value range [0.1, 0.3]**」.

### 1.2 Thresholds/empirical values actually specified in the Chinese documentation

| Original excerpt | Source URL / nature |
|---|---|
| 「Under normal circumstances, the value of `training/rollout_probs_diff_mean` should be lower than **0.005**. If you observe this value higher than **0.01**, this indicates that the inference engine has a precision problem」; trigger conditions: 「Using GPUs with a non-Hopper architecture, such as A100, L20, B200, etc.」「Using vLLM that has issue 22103」「Long input and output text」 | https://verl.org.cn/en/latest/faq/faq.html (Official · FAQ, entry title 「Inference and training sequences do not match (actor/grad_norm too high)」) |
| 「`rollout_is` (token)… **Common thresholds: 1.5 - 5.0**」「(sequence)… **Common thresholds: 2.0 - 10.0**」「All IS weights are clipped within the safety boundary `[exp(-20), exp(20)]`」「`rollout_is_threshold` … Default value: **2.0** … TIS (truncated importance sampling) is implemented through `.clamp(max=...)`」 | https://verl.org.cn/en/latest/algo/rollout_corr.html (Official · Rollout correction) |
| Troubleshooting subsection: 「Problem: IS weight variance is too large (distribution too wide) —— Symptom: `rollout_is_std` > **1.0**, `rollout_is_eff_sample_size` < **0.3**」；「问题：IS 权重均值偏离 1.0 较远—— 现象：`rollout_is_mean` < **0.5** 或 > **2.0**」 | Same as above |
| 「`staleness_threshold` … **It is recommended to set this value to less than 1**」; 「In the later stage of training, **metrics and generation length may become unstable**. To alleviate this problem, we can use Rollout Importance Sampling」; `algorithm.rollout_correction.bypass_mode`「The default value is True, using the rollout's log prob」 | https://verl.org.cn/en/latest/advance/fully_async.html (Official · Fully asynchronous policy trainer) |
| 「`data.truncation` … **If the training log shows a relatively large `clip_ratio` and the metrics are poor, please increase `data.max_prompt_length` or clean the data**」; `rollout.n`「**Typical values: 64 for GRPO, 16 for DAPO**」 | https://verl.org.cn/en/latest/perf/best_practices.html (Official · DAPO+Qwen3-235B best practices) |
| Entropy collapse: 「**the entropy collapse problem, i.e., policy entropy drops sharply during training, leading to overconfidence and performance saturation**」, empirical relationship \(R=-a\exp(H)+b\); 「When the baseline's entropy reaches a plateau … the KL-Cov method can still maintain an entropy level **more than 10 times higher**」(**no absolute entropy threshold**) | https://verl.org.cn/en/latest/algo/entropy.html (Official · Cookbook: Entropy mechanism) |
| 「Today's reinforcement learning infrastructure still has **inherent instability** … we **strongly recommend changing only one thing at a time**」; known issue: 「Enabling CUDA graphs (`enforce_eager=False`) **may cause model performance degradation**」 | https://verl.org.cn/en/latest/algo/dapo.html (Official · DAPO FAQ) |
| 「Methods without a trust region (PG-IS, CISPO) or methods with an incorrectly specified trust region (MiniRL) will face **ever-worsening mismatch and eventually collapse**」; PPO clipping「**over-penalizes low-probability tokens** … while **under-penalizes high-probability tokens**」 | https://verl.org.cn/en/latest/algo/dppo.html (Official · DPPO) |

The example log can serve as a reference value (https://verl.org.cn/en/latest/start/quickstart.html ): 「`critic/vf_clipfrac:0.000 - critic/grad_norm:1023.278 … actor/entropy_loss:0.433 - actor/pg_loss:-0.005 - actor/pg_clipfrac:0.000 - actor/ppo_kl:0.000 - actor/grad_norm:1.992`」; another step is 「`critic/vf_clipfrac:0.384 … actor/pg_clipfrac:0.002`」. Note that the log uses `actor/entropy_loss`, while the metrics page writes `actor/entropy`; **the naming is inconsistent**.

### 1.3 Clarify 「not found」

A full-text search of 120 Chinese pages found **0** hits for the following keywords: `num_zeros_in_grad`, `update_skipped`, `skipped_iter`, `pg_tis_clipfrac`. In addition, searches in `verl-project/verl`'s `verl/trainer/ppo/metric_utils.py`, `core_algos.py`, `rollout_corr_helper.py`, `verl/utils/skip/skip_manager.py` also had 0 hits (https://github.com/verl-project/verl , the entire repository was not exhaustively searched). Therefore, these metric names **do not come from the verl Chinese documentation**, and this article does not infer their meanings. Related but different: `SkipManager` (https://verl.org.cn/en/latest/advance/skip_manager.html ) is a debugging mechanism for 「skipping selected steps」, **not** a training metric; RL-Insight (https://verl.org.cn/en/latest/advance/rl_insight.html ) claims it can receive 「trainer scalar metrics, asynchronous rollout engine metrics, TransferQueue metrics」, but does not list metric names and thresholds.

### 1.4 Other FAQ pitfalls (https://verl.org.cn/en/latest/faq/faq.html )

「Unable to register worker with raylet」 (SLURM CPU limit) → reduce `ray_init.num_cpus`; TensorDict `in` error (no suitable version for linux-arm64); `CUDA error: an illegal memory access` during rollout → troubleshoot according to the vLLM documentation; Triton `compile_module_from_src` error → set `use_torch_compile` to disable JIT; use `ray_init.timeline_json_file` for Ray timeline; use `+trainer.wandb_proxy` only for wandb proxy.

## 2. slime (Official Chinese documentation)

### 2.1 Common Q&A——the most concentrated list of pitfalls

【URL】https://thudm.github.io/slime/zh/get_started/qa.html 【Nature】Official · Common Q&A

- 「**Why does garbled text appear during training?** Generally, this situation is because megatron was not loaded correctly. Please check whether `--load` or `--ref-load` has a corresponding ckpt.」
- 「**Why does OOM happen during training?** OOM is often because `max_tokens_per_gpu` is set too high … you can first set this value to `rollout_max_response_len / cp_size`」
- 「**grad norm is very high, and training collapsed—what should I do?** First, please ensure that the data and model match. For example, if the implementation has already prepared a chat template for the data, check whether this chat template is consistent with the original model.」
- 「**When grad NaN or Inf occurs during training**, you can try setting `--no-check-for-nan-in-loss-and-grad` to skip the corresponding training step.」
- sglang `Max retries exceeded … /get_model_info` → port conflict with multiple servers on a single machine; IMA 「it may be OOM, consider reducing `--sglang-mem-fraction-static`」; generation produces no output for a long time → check the stop token.

### 2.2 kl / grad_norm criteria and silent errors in the Debug guide

【URL】https://thudm.github.io/slime/zh/developer_guide/debug.html 【Nature】Official · Debug guide

- 「Check whether `log_probs` and `ref_log_probs` of the printed rollout stats **are exactly equal (i.e., kl=0 at the first step) and the values are small**」; 「If the values are relatively large (e.g., **>1**) … if the values are very large, there should be a problem with the training configuration; if the values are only slightly larger than the state of sft loss, for example the logprob of an instruct model reaches 0.8, it may be that the data does not conform to the training chat template」
- 「Check under **one-inference-one-training** (`num_steps_per_rollout == 1`), **whether kl is 0 and whether grad_norm is relatively small**」
- **Silent errors** in INT4/Compressed-Tensors quantization: 「MoE routing weights (`mlp.gate.weight`) become all zeros」, fix: ensure the ignore list includes `"re:.*mlp\\.gate\\..*"`; use `--check-weight-update-equal` to verify weight synchronization.

### 2.3 Metrics and monitoring

【URL】https://thudm.github.io/slime/zh/advanced/observability.html 【Nature】Official · Observation

「W&B and TensorBoard still record training metrics such as **reward、loss、KL、entropy、eval**」，additionally `perf/request/e2e_latency/mean`、`perf/decode/throughput/mean` etc.；「slime itself does not store Prometheus's per-second data」，SGLang exposes `sglang:num_queue_reqs`、`sglang:num_running_reqs` etc.。**The full text has no thresholds/normal ranges。**

### 2.4 Metric names、TIS、dynamic sampling and partial rollout

【URL】https://thudm.github.io/slime/zh/get_started/customization.html 、 https://thudm.github.io/slime/zh/get_started/quick_start.html 【Nature】Official

- 「Other metrics（such as **pg_clipfrac、ppo_kl、entropy_loss**）still use the default `sum_of_sample_mean`」
- 「`--use-kl-loss`: … compute the KL divergence between the current model and the reference model as a monitoring metric … **if this parameter is set to 0, then the KL divergence is only displayed as an observation metric**」（example `--kl-loss-coef 0.00 --entropy-coef 0.00 --eps-clip 0.2 --eps-clip-high 0.28`）
- 「`--use-tis`：if you need to enable **TIS (Truncated Importance Sampling)**, you can enable this setting.」
- Dynamic sampling filter function `check_reward_nonzero_std`「checks whether the reward standard deviation of a group of samples is greater than zero … to avoid data being too homogeneous」，reason is `zero_std_*`；「once the number of pending tasks drops below the target number (32) due to excessive discarding, the system will automatically trigger a new round of oversampling」。
- 「By enabling the `--partial-rollout` parameter, these half-generated samples can be cached and continue to be generated in the next Rollout stage」；「the `sample.metadata` of each partial rollout sample stores the rollout id of the first generation」。

### 2.5 Multi-turn / agentic

【URL】https://thudm.github.io/slime/zh/advanced/pd_disaggregation.html 、 https://thudm.github.io/slime/zh/advanced/sglang_config.html 【Nature】Official

「PD Disaggregation … is especially suitable for **multi-turn、long-context and agentic RL**」；「for multi-turn dialogue and agentic scenarios, session affinity ensures that all requests of the same conversation are routed to the same backend worker」；the sidebar also has 「Agentic RL Training Roadmap」（https://thudm.github.io/slime/zh/get_started/agent.html ）。

## 3、ROLL（Alibaba，in-repo Chinese documentation）

【Nature】Official Chinese documentation（`docs_roll/i18n/zh-Hans/`，Docusaurus Chinese localization）

【URL】https://github.com/alibaba/ROLL/blob/main/docs_roll/i18n/zh-Hans/docusaurus-plugin-content-docs/current/User%20Guides/Tracker%20%26%20Metrics/trackers_and_metrics.md

- 「`critic/advantages/mean`: mean of advantage (Advantages). Reflects how much extra reward taking a certain action under a given state can bring relative to the average level.」「`critic/returns/mean`: mean of return (Returns). The expected cumulative reward.」
- 「`critic/value`: the mean predicted value of the value network of the **old policy** for states in the batch at the start of data collection or training」「`critic/vpred`: the value network **currently being optimized**…」
- 「`critic/reward_clip_frac`: the proportion of reward clipping … **if it is too high, you may need to adjust the reward range or clipping threshold**.」（**the only statement with empirical judgment，no numerical value given**）
- 「`actor/ppo_ratio_high_clipfrac`: the high clipping fraction during PPO policy optimization」「`actor/approxkl`: the approximate KL divergence between the current policy and the old policy. Measures the step size of each policy update.」「`actor/policykl`: the exact KL divergence between the current policy and the old policy.」

【URL】https://github.com/alibaba/ROLL/blob/main/docs_roll/i18n/zh-Hans/docusaurus-plugin-content-docs/current/Getting%20Started/FAQ/qa_issues.md

「Error: `self.node2pg[node_rank] KeyError: 1` —— check the total number of requested GPUs and the configuration of `device_mapping`」；「Error: `AssertionError: batch_size 32 < chunks 64` —— `batch_size` is less than the DP size of `reference`/`actor_train` … can be resolved by adjusting `rollout_batch_size`」；`BackendCompilerFailed` → set `NVTE_TORCH_COMPILE: '0'`. This file **does not cover** algorithm-layer content such as training instability/KL/entropy；in the Chinese documentation, **TIS / rollout_correction / staleness are not seen**。

## 4、AReaL（inclusionAI，in-repo Chinese documentation docs/zh/）

【Nature】Official Chinese documentation

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/reference/metrics_tracking.md ：original text of the metric system——「supports … **streaming metrics**（for asynchronous Rollout workflows），**batch metrics**（for synchronous training updates）」，example `stats_tracker.stat(advantages=…, kl_rewards=…, denominator="n_valid_tokens")`。**Mechanism explanation，no thresholds。**

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/algo_perf.md （most specific numerical values）：

- 「The following two importance weight metrics are crucial for monitoring training stability——**their average values should stay close to 1.0**」；「if `importance_weight/avg` deviates significantly from 1, please reduce `ppo_n_minibatches`」「if the deviation still exists at `ppo_n_minibatches == 1`（**common in MoE training**），please … add `actor.megatron.use_deterministic_algorithms=1`」
- 「Make sure `behav_imp_weight_cap` is set（**recommended value：5**）。If the deviation still exists, please reduce `max_head_offpolicyness`」
- 「`ppo_actor/no_eos_ratio`：the proportion of trajectories truncated before generating the EOS token」「**if `no_eos_ratio` exceeds 0.05（5% of trajectories are truncated）**：increase `max_new_tokens` … use dynamic filtering to exclude overly long trajectories」
- When suspecting that asynchrony affects performance：「`max_head_offpolicyness: 0`  # 0 means synchronous training」「`use_decoupled_loss: false`  # restore to the original PPO loss」

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/debugging.md ：3 types of symptoms of hanging/deadlock、5 types of causes（「exceptions on some ranks」「collective call mismatch」「shape mismatch in PP」「NCCL timeout」「deadlock during initialization」）；`NCCL_TIMEOUT`「default is 1800s = 30 min」；「ensure `max_head_offpolicyness` and `max_concurrent_rollouts` are large enough, otherwise the rollout process will be **blocked indefinitely** due to staleness control」。Also https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/handling_oom.md ：「`actor.mb_spec.max_tokens_per_mb` … **cannot be set lower than `max_length + max_new_tokens`**」「`train_dataset.batch_size` does not affect peak memory usage」。

## 5、OpenRLHF（Chinese README）

【URL】https://github.com/OpenRLHF/OpenRLHF/blob/main/README_zh.md 【Nature】Official Chinese README（about 3.8k Chinese characters；the documentation site openrlhf.readthedocs.io is in **English**，there is no Chinese metrics page under `docs/`）

- 「**PPO observability：actor/critic grad-norm and breakdown of time spent in each stage**（`timing/make_experience`、`timing/ppo_train`、`timing/broadcast`、`timing/generation`、`timing/step_total`）」——**only metric names, no normal ranges**。
- TIS/off-policy correction：「`--algo.advantage.is_correction_level token` # vLLM importance sampling correction, for off-policy rollout：token | seq」；「`--algo.advantage.is_correction_mode mask` # out-of-bounds handling：**mask（ICEPOP / seq-mask-tis）| clip（TIS, token-level only）**」；「`--algo.advantage.is_correction_gating ratio` # gating statistic：ratio | binary_kl | tv」；「`--algo.advantage.is_correction_threshold 0.5 5.0` # the **[low, high] interval** of the gating statistic；providing only one value means upper bound only」。
- 「**Muon** … Newton-Schulz output is scale-invariant, so it is necessary to **disable global gradient clipping** via `--{actor,critic}.max_norm 0` (Adam's default `1.0` would clip the Muon update to nothing)」; 「**GPU index error troubleshooting**: … please set `export RAY_EXPERIMENTAL_NOSET_CUDA_VISIBLE_DEVICES=1`」.

## 6. Summary

1. The most complete on 「what each metric is」 is verl's 《Training Configuration Parameters and Metrics Description》 (8 groups of metrics), but it **only explains the meaning and does not give normal ranges**.
2. In the Chinese documentation, there are only 6 places with values that can be directly cited: verl (`rollout_probs_diff_mean` 0.005/0.01; IS token 1.5–5.0, seq 2.0–10.0, default 2.0; `rollout_is_std`>1.0 and ESS<0.3；`rollout_is_mean`<0.5 或 >2.0; `staleness_threshold`<1；`clip_ratio` [0.1,0.3]）、AReaL（importance weight 应接近 1.0；`behav_imp_weight_cap` 推荐 5；`no_eos_ratio`>0.05), OpenRLHF (`is_correction_threshold 0.5 5.0`). **How much KL exceeds to warrant caution / how high clipfrac is considered high / how low entropy must drop to count as collapse—the Chinese documentation has no absolute thresholds for any of these.**
3. **Not found**: `num_zeros_in_grad`, `update_skipped`, `skipped_iter`, `pg_tis_clipfrac` have 0 hits across all Chinese documentation. TIS itself exists in all three: verl=`rollout_is_threshold`, slime=`--use-tis`, OpenRLHF=`is_correction_mode clip` (also `mask`/ICEPOP); `rollout_correction`/`bypass_mode`/staleness only have systematic Chinese documentation in verl.
4. Limitation: the AReaL/ROLL documentation site **has no Chinese pages** (measured 0 Chinese characters), so Chinese can only be taken from `docs/zh`, `docs_roll/i18n/zh-Hans` in the repository; `verl.readthedocs.io/zh-cn/` returns "Translation not found", so for verl Chinese, **verl.org.cn** is authoritative. All citations in this article are **conclusions from official Chinese documentation**; personal blogs were not used.
