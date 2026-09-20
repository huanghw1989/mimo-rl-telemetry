# 调研简报：给指标解读找公开溯源依据

## 背景

`tasks/mimo-rl-telemetry/` 是 `https://mimo.xiaomi.com/rl/` 的本地遥测。我们抓了完整的
训练指标序列（pro 19 步 / flash 26 步，两个 run 共 2000 多个 tag），并为 **109 个指标**
写了中文解读（`content/metrics.json`，字段 what/how/why/read/observed/traps）。

现在要给这些解读补**溯源依据**：这条读法是来自公开论文、工程博客、官方文档，还是
我们自己从数据里算出来的结论。

## 你的任务

围绕分配给你的主题，去公开网络上找**真实存在、你能当场引用原文**的材料，判断它们
对我们现有解读是**支持**（support）、**存疑/边界条件**（challenge），还是**背景**
（context）。然后按下面的格式写一个 JSON 文件。

**最重要的要求：不许编造。** 每一个来源都必须是你亲自访问过的 URL，并且能从中摘出
一句**逐字原文**。摘不出原文就不要收录。找不到就写进 `gaps` 里，**空着比编造好得多**。
我们后面会把所有 arXiv id 批量核验一遍，编造的会被当场抓出来。

## 怎么找

- arXiv API 最好用，能直接拿元数据，且**元数据即原文**：
  `https://export.arxiv.org/api/query?id_list=2402.03300,2503.14476`
  `https://export.arxiv.org/api/query?search_query=all:%22dynamic+sampling%22+AND+all:GRPO&max_results=8`
  摘 `quote` 时从 `<summary>` 里**逐字**抄一句（不要改写、不要补词）。
- 已知的重要论文直接用 id_list 核验（下面"参考起点"给了一批人尽皆知的 id，务必逐个核验
  标题是否与你的预期一致——id 记错的情况很常见，标题不符就以 API 返回的为准或丢弃）。
- 非 arXiv 材料（工程博客、官方文档）也可以，但必须稳定可访问、来源可信，例如
  `joschu.github.io`（Schulman 的 KL 估计博客）、`verl.readthedocs.io`、HuggingFace blog、
  vLLM/SGLang 文档、`iclr-blog-track.github.io`（PPO 实现细节）。
- 用 `web_fetch` 抓。**不要**用 `web_search`（本会话没有配 key，会直接报错）。

## 要核验的"我们的读法"

对每条解读，我们已经写了一个说法。请针对下面列出的说法去找支持/反驳材料。你可以
（也应该）自己读 `content/metrics.json` 里对应条目的 what/how/why/read，写得越贴合越好。

### A 组｜优化器与策略（负责人：r1）
| 我们的说法 | 相关指标 id |
| --- | --- |
| grad_norm 有稳定基线（pro 中位数 0.0056），pro 第 19 步出现 6 倍单点尖峰，属于单步异常而不是趋势；梯度范数与裁剪阈值/不稳定性的关系 | `actor/grad_norm` |
| 熵在 26 步里上行（flash 0.413→0.455），且与 avg@n 正相关；熵上升是良性还是坍缩前兆、熵与性能的权衡 | `actor/entropy_loss`, `actor/agentic/entropy_loss`, `actor/code/entropy_loss` |
| `actor/pg_clipfrac` 与 `actor/ppo_kl` 全程恒等于 0，说明新旧策略比值恒为 1（单轮更新、裁剪从未生效）；PPO 里 clipfrac 的定义与"信任域不生效"意味着什么 | `actor/pg_clipfrac`, `actor/ppo_kl`, `actor/clip_low`, `actor/clip_high` |
| 只有 `actor/pg_tis_clipfrac` 那一路有非零裁剪，它量的是 rollout 与训练重算概率的偏差被截断的比例 | `actor/pg_tis_clipfrac`, `actor/code/dataset-yfch/pg_tis_clipfrac` |
| 学习率/优化器相关指标的常见陷阱 | `actor/lr`, `training/actor_optimizer_steps` |

### B 组｜离策略、陈旧度与训练推理一致性（负责人：r2）
| 我们的说法 | 相关指标 id |
| --- | --- |
| 全局 KL 是各"陈旧度桶"KL 的加权平均（权重是 token 占比），所以全局 KL 上行可能只是陈旧 token 占比变大，而不是每个桶都变差；实测相关性：全局 KL 与平均陈旧度 pro 0.930 / flash 0.925，而桶 0 的 KL 与陈旧度只有 −0.19 / +0.20 | `partial/avg_staleness`, `partial/<k>/frac`, `partial/<k>/n_tokens`, `partial/<k>/entropy_loss`, `partial/agentic/avg_staleness` |
| 陈旧样本（off-policy）如何被修正：截断重要性采样、序列级/Token 级比值、离策略程度与训练崩溃的关系 | `partial/*`、`actor/pg_tis_clipfrac` |
| rollout 与训练重算的 logprob 差（`train_infer_diff/*`）是训练推理不一致的直接度量；`F(tau)` 是差异超过阈值的 token 占比；KV 精度/算子差异/并行策略如何造成这种不一致 | `train_infer_diff/new_infer/diff_abs_mean`, `train_infer_diff/new_infer/diff_abs_max`, `train_infer_diff/new_infer/kl`, `train_infer_diff/new_infer/F(tau=1.5)`, `train_infer_diff/nll_loss/log_probs`, `train_infer_diff/nll_loss/rollout_log_probs` |

### C 组｜采样、奖励与优势（负责人：r3）
| 我们的说法 | 相关指标 id |
| --- | --- |
| `dynsam/avg@n` 是同一 prompt 采 n 次（n=16）的平均通过率；`passrate/one` 是全对占比、`passrate/zero` 是全错占比；`avg@n = p1 + 中间池占比 × 中间池质量` 这个分解；无偏 pass@k 估计量 | `dynsam/avg@n`, `dynsam/passrate/one`, `dynsam/passrate/zero`, `dynsam/num_measurable`, `dynsam/num_target` |
| RLVR 会提升 pass@1 但**收缩**可解范围（pass@k 覆盖下降）；"16 次一次没做对"的比例几乎不降是一条能力墙 | `dynsam/passrate/zero`, `dynsam/avg@n` |
| 动态采样会丢弃全对/全错（零优势）的组；组内标准差归一化对低方差 prompt 的系统性偏置 | `dynsam/*/num_accepted/*`, `dynsam/agentic/num_accepted/step`, `dynsam/infra_error/seq_rate` |
| `critic/` 命名下装的其实是奖励/优势计算，没有独立价值网络；`critic/advantages/*` 与 `critic/returns/*` 逐点完全相等意味着 GAE 的 λ=1、γ=1（蒙特卡洛回报） | `critic/advantages/mean`, `critic/returns/mean`, `critic/rewards/mean`, `critic/score/mean`, `critic/rewards/max`, `critic/rewards/min` |
| 对正/负优势做"抽掉一部分正质量、给负优势补质量，再把该符号总量缩放回原值"这种处理，公开方法里有没有对应物（非对称裁剪？只有一侧动下界？） | `penalty/signed/pos_scale`, `penalty/signed/neg_scale`, `penalty/signed/pos_mass_removed`, `penalty/signed/neg_mass_added`, `penalty/signed/neg_hit_tokens`, `penalty/signed/pos_hit_tokens`, `train/adv_pos_sum_pre_penalty`, `train/adv_neg_sum_post_penalty`, `penalty/action/adv_mul_tokens`, `penalty/action/adv_mul_min` |

### D 组｜判分、环境、系统与评测（负责人：r4）
| 我们的说法 | 相关指标 id |
| --- | --- |
| 判分流水线会把约一半候选组直接路由丢弃（`routed/off` 占 48.9%）；`pass2_success_rate` 恒为 1 且 `judge_pass2_attempts` 恒为 0（二审从未真正执行）；判分很慢（约 570 秒/组，97% 花在一审） | `penalty/stage_credit_group/groups_total`, `.../routed/off`, `.../pass1_success_rate`, `.../pass2_success_rate`, `.../time_total_sec_mean`, `.../judge_pending`, `.../select_groups_failed`, `.../groups_judged`, `.../groups_attempted` |
| 用 LLM/程序判分器做验证时的已知偏差：位置偏差、长度偏差、自一致性、多次验证取或、判分饱和 | `penalty/stage_credit_group/select_v4/select_probe_disagree_rate`, `.../select_v4/select_r2_flagged`, `.../select_v4/select_r3_rate`, `.../select_v4/select_tier_share_T1` |
| `select_hack_attempt_rate`（求解器尝试作弊的比例，0.40→0.52）对应"奖励攻击/作弊行为"的检测与监控 | `penalty/stage_credit_group/select_v4/select_hack_attempt_rate`, `.../select_v4/select_pass_new_tests_rate`, `env/possible_leak` |
| 用程序化测试/新生成的测试来筛解，是否属于常见做法（测试驱动、新增测试通过率） | `penalty/stage_credit_group/select_v4/select_pass_new_tests_rate` |
| 长上下文 RL 里响应长度膨胀与超长裁剪/惩罚 | `ctx_response_length/mean`, `ctx_total_length/mean`, `ctx_total_length/clip_ratio`, `ctx_total_length/max`, `ctx_prompt_length/mean`, `ctx_response_length/agentic/mean` |
| 混合控制器式的 RL 训练系统里，生成（rollout）与训练（trainer）的时间占比、吞吐与成本核算 | `timing_s/step`, `timing_s/outer_gen`, `timing_s/trainer_ops`, `perf/total_num_tokens`, `training/global_step` |
| RL 训练的算力/成本缩放规律（能不能从算力预测效果） | `perf/total_num_tokens` |
| 沙箱环境数量、环境错误/建立失败 | `env/active`, `env/code/shared/active`, `env/cyber/dataset-9aui/active`, `env/total_error`, `env/total_setup` |

### 通用｜官方材料（r4 兼顾）
找 MiMo（小米）与本次训练相关的**官方**材料：MiMo-V2 / MiMo-VL / MiMo-7B 的技术报告或
官方博客（arXiv 上搜 `ti:"MiMo"` 或 `all:"MiMo-V2"`），以及 `mimo.xiaomi.com` 上这次
RL 运行本身的说明。这是整个遥测最权威的溯源对象。

## 输出的 JSON 格式

写到 `tasks/mimo-rl-telemetry/content/_research/<你的代号>.json`，结构：

```json
{
  "agent": "r1",
  "topics": ["优化器与策略"],
  "fetched": 23,
  "items": [
    {
      "id": "grpo",
      "kind": "paper",
      "title": "DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models",
      "authors": "Zhihong Shao et al.",
      "venue": "arXiv:2402.03300",
      "year": "2024",
      "url": "https://arxiv.org/abs/2402.03300",
      "quote": "we propose Group Relative Policy Optimization (GRPO), which foregoes the critic model that is typically the same size as the policy model",
      "topic": "组相对优势",
      "attaches": [
        {
          "metric": "critic/advantages/mean",
          "stance": "support",
          "note": "GRPO 明确去掉了与策略同规模的价值网络，组内相对优势直接当优势用；这解释了本站 critic/ 命名下为什么 advantages 与 returns 逐点相等，也解释了为什么没有单独的 value loss 指标。"
        }
      ]
    }
  ],
  "gaps": ["没有找到直接讨论 <某个东西> 的公开材料"],
  "notes": "可选，写你在核验中发现的坑（比如某个流行 id 其实对应另一篇论文）"
}
```

字段要求：

- `id`：短 slug，全局唯一，`[a-z0-9-]+`（比如 `grpo`、`dapo`、`schulman-kl`）。
- `kind`：只能是 `paper` | `blog` | `doc` | `report`。
- `quote`：**逐字**原文，英文原句，长度 ≤ 60 词。中文材料也可以，同样逐字。
- `url`：可直接打开的绝对 URL。arXiv 用 `https://arxiv.org/abs/<id>`。
- `attaches[].metric`：必须是 `content/metrics.json` 里 `items[].id` 真实存在的 id
  （带 `<k>` 的族条目 id 也允许，照抄）。不确定就先读一遍 metrics.json 的 id 列表。
- `attaches[].stance`：`support`（支持我们的读法）| `challenge`（与之冲突、或给出边界条件，
  例如"论文说这只有在单轮更新时才成立"）| `context`（提供背景，不直接判定）。
- `attaches[].note`：中文，1~2 句，写清**这条材料具体佐证/推翻了我们哪一句说法**。
  不要写"该论文研究了 XX，与我们的解读一致"这种空话，要点名我们的哪一句话。
- 一个来源可以 `attaches` 到多个指标；一个指标也可以有多个来源。
- 覆盖优先：宁可给一个指标挂 1 条扎实的来源，也不要为了凑数挂 5 条泛泛的。
- `challenge` 很宝贵：如果某条材料说明我们的读法只在特定条件下成立，**一定要标出来**。

## 参考起点（务必逐个核验标题）

`1707.06347` PPO、`1506.02438` GAE、`2402.03300` DeepSeekMath/GRPO、`2503.14476` DAPO、
`2503.20783` Understanding R1-Zero-Like Training（Dr. GRPO）、`2507.18071` GSPO、
`2505.22617` The Entropy Mechanism of RL、`2506.17863` The Art of Scaling RL Compute、
`2504.13837` Does RL Really Incentivize Reasoning Capacity Beyond the Base Model、
`2506.10947` Pass@k Training、`2107.03374` Codex/HumanEval（无偏 pass@k 估计量）、
`2503.11926` Monitoring Reasoning Models for Misbehavior、`2409.19256` HybridFlow/verl、
`1711.05101` AdamW、`2502.16982` Muon is Scalable、`2002.11803` Why Gradient Clipping
Accelerates Training、`1502.05477` TRPO、`2310.06770` SWE-bench。

另外值得专门搜的关键词（2025~2026 的新工作）：
`training-inference mismatch`、`off-policy staleness LLM RL`、`truncated importance sampling`、
`asymmetric importance sampling`、`rollout correction`、`entropy collapse RLVR`、
`reward hacking detection`、`LLM-as-a-judge bias`、`dynamic sampling GRPO`、
`clip fraction PPO`、`sequence-level ratio`、`replay buffer async RL`、
`overlong reward shaping`、`length bias GRPO`、`verifier pass@k`。

## 收尾

1. 用 `python -c "import json;json.load(open(...,encoding='utf-8'))"`（解释器：
   `D:\workspace\venv313_next\Scripts\python.exe`）确认你的 JSON 能解析。
2. 自检：每一条 `attaches[].metric` 是否真的在 metrics.json 里？写个一次性脚本核对，
   别靠眼睛。
3. 在最终回复里用**不超过 15 行**汇报：收了几个来源、覆盖了哪些指标、发现了哪些
   `challenge`、以及 `gaps` 里有什么。细节都在文件里，不要在回复里重复全文。
