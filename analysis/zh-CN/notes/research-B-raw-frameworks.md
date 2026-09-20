# 调研 B：开源 RL 训练框架中文文档中的指标说明与常见踩坑

采集方式：`analysis/zh-CN/tools/` 下自建脚本（requests+BeautifulSoup），**未使用浏览器**。verl 中文站（`verl.org.cn/sitemap.xml`，全部 **120 页**）、slime 中文站（BFS **77 页**）落地本地后全文检索；ROLL/AReaL/OpenRLHF 经 GitHub API 定位仓库内中文文档后抓原文。未抓到的一律写"未找到"；Bing 命中的知乎/CSDN 博客未逐篇核验，**不引用**。

## 一、verl（官方中文文档）

来源性质：verl 官方中文文档（Sphinx，页脚 "© 2024 ByteDance Seed Foundation MLSys Team"）。

### 1.1 专门的指标说明页（最全）

【URL】https://verl.org.cn/en/latest/ascend_tutorial/dev_guide/model_dev/parameter_and_metrics.html

Actor 组原文摘录：`actor/pg_loss`「策略梯度损失（PPO clip loss），基于优势函数的策略梯度目标函数值」；`actor/pg_clipfrac`「PPO 裁剪机制生效的比例，反映策略更新幅度的稳定性」；`actor/ppo_kl`「PPO 算法的实际 KL 散度（当前策略 vs 旧策略）」；`actor/entropy`「策略熵，表示策略的随机性或探索能力（仅 `calculate_entropy=True` 或 `entropy_coeff!=0` 时打印）」；`actor/grad_norm`「Actor 梯度范数（裁剪后）」；`actor/kl_loss`「KL 散度损失，衡量当前策略与参考策略之间的偏离程度（仅 `use_kl_loss=True` 时打印）」。
Critic 组：`critic/vf_loss`「值函数损失」；`critic/vf_clipfrac`「Critic 裁剪机制生效的比例，反映值函数更新幅度的稳定性」；`critic/vf_explained_var`「值函数解释方差 1 - Var(returns-values)/Var(returns)」；`critic/rewards|advantages|returns/mean|max|min` 分别为「非中止样本的序列奖励」「有效 token 的优势值/回报」的均值、最大、最小值；`response_length/clip_ratio`「响应长度达到最大长度的比例」。
2.8 节「条件性指标」：「仅启用 `rollout_correction` 时打印，均带 `rollout_corr/` 前缀」，含 `rollout_is_mean|std|eff_sample_size`、`rollout_is_ratio_fraction_high`「超过上限阈值的 IS 权重比例」、`rollout_corr/kl`、`k3_kl`「K3 KL 估计（更稳定）」、`ppl_ratio`；训推一致性指标（需 `calculate_log_probs=True`）含 `training/rollout_probs_diff_mean`。

**关键结论：该页只解释"是什么"，不给"正常范围/异常含义"**；全页唯一数值经验值是配置项 `actor.clip_ratio` 默认 0.2「PPO 裁剪比例，控制策略更新幅度，**一般取值范围 [0.1, 0.3]**」。

### 1.2 中文文档中确实写明的阈值/经验值

| 原文摘录 | 来源 URL / 性质 |
|---|---|
| 「正常情况下，`training/rollout_probs_diff_mean` 的值应该低于 **0.005**。如果您观察到该值高于 **0.01**，这表明推理引擎存在精度问题」；触发条件：「使用非 Hopper 架构的 GPU，例如 A100、L20、B200 等」「使用存在 issue 22103 问题的 vLLM」「输入和输出文本较长」 | https://verl.org.cn/en/latest/faq/faq.html （官方·常见问题解答，条目标题「推理和训练序列不匹配（actor/grad_norm 偏高）」） |
| 「`rollout_is`（token）… **常用阈值：1.5 - 5.0**」「（sequence）… **常用阈值：2.0 - 10.0**」「所有 IS 权重都被限制在安全边界 `[exp(-20), exp(20)]` 内」「`rollout_is_threshold` … 默认值：**2.0** … 通过 `.clamp(max=...)` 实现 TIS (截断重要性采样)」 | https://verl.org.cn/en/latest/algo/rollout_corr.html （官方·Rollout 校正） |
| 排错小节：「问题：IS 权重方差过大（分布过宽）—— 现象：`rollout_is_std` > **1.0**, `rollout_is_eff_sample_size` < **0.3**」；「问题：IS 权重均值偏离 1.0 较远—— 现象：`rollout_is_mean` < **0.5** 或 > **2.0**」 | 同上 |
| 「`staleness_threshold` … **建议将此值设置为小于 1**」；「在训练后期**指标和生成长度可能会变得不稳定**。为了缓解这个问题，我们可以使用 Rollout Importance Sampling」；`algorithm.rollout_correction.bypass_mode`「默认值为 True，使用 rollout 的 log prob」 | https://verl.org.cn/en/latest/advance/fully_async.html （官方·全异步策略训练器） |
| 「`data.truncation` … **如果训练日志显示较大的 `clip_ratio` 且指标不佳，请增加 `data.max_prompt_length` 或清洗数据**」；`rollout.n`「**典型值：GRPO 为 64，DAPO 为 16**」 | https://verl.org.cn/en/latest/perf/best_practices.html （官方·DAPO+Qwen3-235B 最佳实践） |
| 熵崩塌：「**熵崩塌（entropy collapse）问题，即策略熵在训练期间急剧下降，导致过度自信和性能饱和**」，经验关系 \(R=-a\exp(H)+b\)；「当基线的熵达到平台期 … KL-Cov 方法仍能保持**高出 10 倍以上**的熵水平」（**无绝对熵阈值**） | https://verl.org.cn/en/latest/algo/entropy.html （官方·秘籍：熵机制） |
| 「如今的强化学习基础设施仍然存在**固有的不稳定性** … 我们**强烈建议每次只修改一处内容**」；已知问题：「启用 CUDA 图（`enforce_eager=False`）**可能会导致模型性能下降**」 | https://verl.org.cn/en/latest/algo/dapo.html （官方·DAPO 常见问题） |
| 「没有置信域的方法（PG-IS、CISPO）或置信域指定错误的方法（MiniRL）则会面临**不断加剧的不匹配，并最终导致崩溃**」；PPO 裁剪「**过度惩罚低概率 Token** … 同时**惩罚不足高概率 Token**」 | https://verl.org.cn/en/latest/algo/dppo.html （官方·DPPO） |

示例日志可作参照值（https://verl.org.cn/en/latest/start/quickstart.html ）：「`critic/vf_clipfrac:0.000 - critic/grad_norm:1023.278 … actor/entropy_loss:0.433 - actor/pg_loss:-0.005 - actor/pg_clipfrac:0.000 - actor/ppo_kl:0.000 - actor/grad_norm:1.992`」；另一步为「`critic/vf_clipfrac:0.384 … actor/pg_clipfrac:0.002`」。注意日志用 `actor/entropy_loss`，指标页写 `actor/entropy`，**命名不一致**。

### 1.3 明确「未找到」

对 120 个中文页面全文检索，下列关键词命中 **0**：`num_zeros_in_grad`、`update_skipped`、`skipped_iter`、`pg_tis_clipfrac`。另在 `verl-project/verl` 的 `verl/trainer/ppo/metric_utils.py`、`core_algos.py`、`rollout_corr_helper.py`、`verl/utils/skip/skip_manager.py` 中检索同样 0 命中（https://github.com/verl-project/verl ，未穷尽全仓）。故这些指标名**不出自 verl 中文文档**，本文不推断其含义。相关但不同：`SkipManager`（https://verl.org.cn/en/latest/advance/skip_manager.html ）是调试用「跳过所选步骤」机制，**不是**训练指标；RL-Insight（https://verl.org.cn/en/latest/advance/rl_insight.html ）称可接收「训练器标量指标、异步 rollout 引擎指标、TransferQueue 指标」，但未列指标名与阈值。

### 1.4 FAQ 其他踩坑（https://verl.org.cn/en/latest/faq/faq.html ）

「Unable to register worker with raylet」（SLURM CPU 限制）→ 调小 `ray_init.num_cpus`；TensorDict `in` 报错（linux-arm64 无合适版本）；rollout 期 `CUDA error: an illegal memory access` → 按 vLLM 文档排查；Triton `compile_module_from_src` 错误 → 设 `use_torch_compile` 关 JIT；Ray timeline 用 `ray_init.timeline_json_file`；仅 wandb 代理用 `+trainer.wandb_proxy`。

## 二、slime（官方中文文档）

### 2.1 常见 Q&A——最集中的踩坑清单

【URL】https://thudm.github.io/slime/zh/get_started/qa.html 【性质】官方·常见 Q&A

- 「**训练过程中为什么会出现乱码？** 一般来说这种情况是 megatron 没有被正确加载。请检查 `--load` 或 `--ref-load` 是否有对应的 ckpt。」
- 「**为什么训着训着 OOM 了？** OOM 往往是因为 `max_tokens_per_gpu` 设置过高了 … 可以先把这个值设成 `rollout_max_response_len / cp_size`」
- 「**grad norm 好高，训练训崩了怎么办？** 首先请确保数据和模型是匹配的，例如说，如果数据是实现已经做好 chat template 的了，这个 chat template 是否和原模型一致。」
- 「**训练出现 grad NaN 或者 Inf 的情况** 可以通过设置 `--no-check-for-nan-in-loss-and-grad` 来尝试跳过对应的训练步。」
- sglang `Max retries exceeded … /get_model_info` → 单机多 server 端口冲突；IMA「有可能是 OOM 了，可以考虑缩小 `--sglang-mem-fraction-static`」；生成很久无输出 → 检查 stop token。

### 2.2 Debug 指南中的 kl / grad_norm 判据与静默错误

【URL】https://thudm.github.io/slime/zh/developer_guide/debug.html 【性质】官方·Debug 指南

- 「查看打印的 rollout stats 的 `log_probs` 和 `ref_log_probs` **是否完全相等（即第一步 kl=0），且值较小**」；「如果数值较大（例如 **>1**）… 如果值非常大，应该是训练配置有问题；如果值只是比 sft loss 的状态略大，例如 instruct 模型的 logprob 到了 0.8，有可能是数据不符合训练的 chat template」
- 「查看在**推一训一**（`num_steps_per_rollout == 1`），**kl 是否为 0，grad_norm 是否较小**」
- INT4/Compressed-Tensors 量化的**静默错误**：「MoE 路由权重（`mlp.gate.weight`）变成全零」，修复：确保 ignore list 含 `"re:.*mlp\\.gate\\..*"`；用 `--check-weight-update-equal` 验证权重同步。

### 2.3 指标与监控

【URL】https://thudm.github.io/slime/zh/advanced/observability.html 【性质】官方·观测

「W&B 和 TensorBoard 仍然记录 **reward、loss、KL、entropy、eval** 等训练指标」，额外 `perf/request/e2e_latency/mean`、`perf/decode/throughput/mean` 等；「slime 自己不存 Prometheus 的每秒数据」，SGLang 暴露 `sglang:num_queue_reqs`、`sglang:num_running_reqs` 等。**全文无阈值/正常范围。**

### 2.4 指标名、TIS、动态采样与 partial rollout

【URL】https://thudm.github.io/slime/zh/get_started/customization.html 、 https://thudm.github.io/slime/zh/get_started/quick_start.html 【性质】官方

- 「其他指标（**pg_clipfrac、ppo_kl、entropy_loss** 等）仍使用默认的 `sum_of_sample_mean`」
- 「`--use-kl-loss`: … 计算当前模型与参考模型之间的 KL 散度作为一项监控指标 … **若该参数设置为 0，则 KL 散度仅作为观测指标显示**」（示例 `--kl-loss-coef 0.00 --entropy-coef 0.00 --eps-clip 0.2 --eps-clip-high 0.28`）
- 「`--use-tis`：如果需要开启 **TIS (Truncated Importance Sampling)**，可以开启这一设置。」
- 动态采样过滤函数 `check_reward_nonzero_std`「会检查一组样本的奖励标准差是否大于零 … 避免数据过于单一」，reason 为 `zero_std_*`；「一旦待处理的任务数因丢弃过多而降至目标数 (32) 以下，系统会自动触发新一轮的过采样」。
- 「通过启用 `--partial-rollout` 参数，可以将这些生成到一半的样本缓存起来，在下一个 Rollout 阶段继续生成」；「每条 partial rollout sample 的 `sample.metadata` 中存储了第一次进行生成的 rollout id」。

### 2.5 多轮 / agentic

【URL】https://thudm.github.io/slime/zh/advanced/pd_disaggregation.html 、 https://thudm.github.io/slime/zh/advanced/sglang_config.html 【性质】官方

「PD Disaggregation … 特别适合 **multi-turn、long-context 和 agentic RL**」；「对于多轮对话和 agentic 场景，会话亲和确保同一对话的所有请求路由到同一个 backend worker」；侧栏另有「Agentic RL 训练路线图」（https://thudm.github.io/slime/zh/get_started/agent.html ）。

## 三、ROLL（阿里，仓库内中文文档）

【性质】官方中文文档（`docs_roll/i18n/zh-Hans/`，Docusaurus 中文本地化）

【URL】https://github.com/alibaba/ROLL/blob/main/docs_roll/i18n/zh-Hans/docusaurus-plugin-content-docs/current/User%20Guides/Tracker%20%26%20Metrics/trackers_and_metrics.md

- 「`critic/advantages/mean`: 优势（Advantages）的均值。反映了在给定状态下采取某个行动相对于平均水平能带来多少额外奖励。」「`critic/returns/mean`: 回报（Returns）的均值。期望的累计奖励。」
- 「`critic/value`: 数据收集或训练开始时**旧策略**的价值网络对批次中状态的预测值均值」「`critic/vpred`: **当前正在优化中**的价值网络…」
- 「`critic/reward_clip_frac`: 奖励裁剪的比例 … **如果太高可能需要调整奖励范围或裁剪阈值**。」（**唯一带经验判断的表述，未给数值**）
- 「`actor/ppo_ratio_high_clipfrac`: PPO 策略优化时的高裁剪比例」「`actor/approxkl`: 当前策略与旧策略之间的近似 KL 散度。衡量每一步策略更新的步长。」「`actor/policykl`: 当前策略与旧策略之间的精确 KL 散度。」

【URL】https://github.com/alibaba/ROLL/blob/main/docs_roll/i18n/zh-Hans/docusaurus-plugin-content-docs/current/Getting%20Started/FAQ/qa_issues.md

「错误：`self.node2pg[node_rank] KeyError: 1` —— 检查申请的 GPU 总数和 `device_mapping` 的配置」；「错误：`AssertionError: batch_size 32 < chunks 64` —— `batch_size` 小于 `reference`/`actor_train` 的 DP size … 可以调整 `rollout_batch_size` 解决」；`BackendCompilerFailed` → 设 `NVTE_TORCH_COMPILE: '0'`。该文件**未涉及**训练不稳定/KL/熵等算法层内容；中文文档中**未见 TIS / rollout_correction / staleness**。

## 四、AReaL（inclusionAI，仓库内中文文档 docs/zh/）

【性质】官方中文文档

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/reference/metrics_tracking.md ：指标体系原文——「支持 … **流式指标**（用于异步 Rollout 工作流），**批量指标**（用于同步训练更新）」，示例 `stats_tracker.stat(advantages=…, kl_rewards=…, denominator="n_valid_tokens")`。**机制说明，无阈值。**

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/algo_perf.md （数值最具体）：

- 「以下两个重要性权重指标对于监控训练稳定性至关重要——**它们的平均值应保持接近 1.0**」；「如果 `importance_weight/avg` 明显偏离 1，请减少 `ppo_n_minibatches`」「如果在 `ppo_n_minibatches == 1` 时偏差仍然存在（**MoE 训练中常见**），请 … 添加 `actor.megatron.use_deterministic_algorithms=1`」
- 「确保设置了 `behav_imp_weight_cap`（**推荐值：5**）。如果偏差仍然存在，请减少 `max_head_offpolicyness`」
- 「`ppo_actor/no_eos_ratio`：在生成 EOS token 之前被截断的轨迹比例」「**如果 `no_eos_ratio` 超过 0.05（5% 的轨迹被截断）**：增加 `max_new_tokens` … 使用动态过滤排除过长的轨迹」
- 怀疑异步影响效果时：「`max_head_offpolicyness: 0`  # 0 表示同步训练」「`use_decoupled_loss: false`  # 恢复为原始的 PPO 损失」

【URL】https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/debugging.md ：挂起/死锁 3 类症状、5 类原因（「部分 ranks 上的异常」「集合调用不匹配」「PP 中的形状不匹配」「NCCL 超时」「初始化中的死锁」）；`NCCL_TIMEOUT`「default is 1800s = 30 min」；「确保 `max_head_offpolicyness` 和 `max_concurrent_rollouts` 足够大，否则 rollout 进程将因过期控制而**无限期阻塞**」。另 https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/handling_oom.md ：「`actor.mb_spec.max_tokens_per_mb` … **不能设置为低于 `max_length + max_new_tokens`**」「`train_dataset.batch_size` 不影响峰值内存使用」。

## 五、OpenRLHF（中文 README）

【URL】https://github.com/OpenRLHF/OpenRLHF/blob/main/README_zh.md 【性质】官方中文 README（约 3.8k 中文字符；文档站 openrlhf.readthedocs.io 为**英文**，`docs/` 下无中文指标页）

- 「**PPO 可观测性：actor/critic grad-norm 以及各阶段耗时细分**（`timing/make_experience`、`timing/ppo_train`、`timing/broadcast`、`timing/generation`、`timing/step_total`）」——**只有指标名，无正常范围**。
- TIS/离策修正：「`--algo.advantage.is_correction_level token` # vLLM 重要性采样修正，用于 off-policy rollout：token | seq」；「`--algo.advantage.is_correction_mode mask` # 越界处理：**mask（ICEPOP / seq-mask-tis）| clip（TIS，仅 token 级）**」；「`--algo.advantage.is_correction_gating ratio` # 门控统计量：ratio | binary_kl | tv」；「`--algo.advantage.is_correction_threshold 0.5 5.0` # 门控统计量的 **[low, high] 区间**；只给一个值表示仅上界」。
- 「**Muon** … Newton-Schulz 输出是尺度无关的，因此需通过 `--{actor,critic}.max_norm 0` **关闭全局梯度裁剪**（Adam 默认的 `1.0` 会把 Muon 更新裁没）」；「**GPU 索引错误故障排除**：… 请设置 `export RAY_EXPERIMENTAL_NOSET_CUDA_VISIBLE_DEVICES=1`」。

## 六、汇总

1. 「每个指标是什么」最全的是 verl《训练配置参数与指标说明》（8 组指标），但**只解释含义，不给正常范围**。
2. 中文文档中可直接引用的数值只有 6 处：verl（`rollout_probs_diff_mean` 0.005/0.01；IS token 1.5–5.0、seq 2.0–10.0、默认 2.0；`rollout_is_std`>1.0 且 ESS<0.3；`rollout_is_mean`<0.5 或 >2.0；`staleness_threshold`<1；`clip_ratio` [0.1,0.3]）、AReaL（importance weight 应接近 1.0；`behav_imp_weight_cap` 推荐 5；`no_eos_ratio`>0.05）、OpenRLHF（`is_correction_threshold 0.5 5.0`）。**KL 超过多少警惕 / clipfrac 多少算高 / entropy 降到多少算坍塌，中文文档中均无绝对阈值。**
3. **未找到**：`num_zeros_in_grad`、`update_skipped`、`skipped_iter`、`pg_tis_clipfrac` 在全部中文文档 0 命中。TIS 本身三家都有：verl=`rollout_is_threshold`、slime=`--use-tis`、OpenRLHF=`is_correction_mode clip`（另有 `mask`/ICEPOP）；`rollout_correction`/`bypass_mode`/staleness 仅 verl 有系统中文文档。
4. 限制：AReaL/ROLL 文档站**无中文页**（实测中文 0 字符），中文只能取自仓库内 `docs/zh`、`docs_roll/i18n/zh-Hans`；`verl.readthedocs.io/zh-cn/` 返回 "Translation not found"，故 verl 中文以 **verl.org.cn** 为准。本文全部引文均为**官方中文文档定论**，未采信个人博客。
