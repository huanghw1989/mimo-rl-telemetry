# 大模型强化学习（RL）训练踩坑与指标异常处理 —— 中文社区实战经验调研

> 调研方法与可信度说明
>
> - 检索途径：Bing（`fetch.py s`）+ CSDN 站内搜索 API（`so.csdn.net/api/v3/search`）+ 掘金 API（`api.juejin.cn/search_api/v1/search`）。**知乎全站返回 HTTP 403**（专栏与回答均抓不到正文），因此本报告中知乎来源仅作为"搜索结果条目"存在，无正文引用。
> - 引文标注规则：凡加引号且标注"原文"的，均为抓取正文中的**逐字原文**；标"（摘录转述）"的是对原文的压缩概括，不是逐字引用。
> - **可信度警告（重要）**：CSDN 当前存在大量"内容农场/AI 批量生成"文章：同一主题下多个不同账号发布措辞高度雷同的标题（如 `verl 使用踩坑记录：这些错误千万别再犯了` 与 `verl 使用踩坑记录：这些错误千万别再犯`），部分文章存在明显的事实错误（例如把 GRPO 展开为 "Generalized Reinforcement Learning for Preference Optimization"）。本报告对这类来源一律标注**（AI 生成嫌疑，需谨慎）**，并优先采信论文、官方文档、出处可溯（标注了原始公众号/PR 链接）的文章。
> - 影响本报告完整性的限制：**无法验证"论文/官方文档支撑"级别的中文一手来源**在本次检索窗口内的可达性有限，故第 1、2、3 节中"定论"部分主要以英文论文为自己的核验依据，中文来源作为"中文社区如何理解与落地"的证据。

---

## 主题一：熵坍塌 / entropy collapse / 熵坍缩

### 1.1 机理（论文级定论）

**【现象/经验（原文）】** 中文解读文章转述论文《The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models》：

> "策略熵的崩塌……这种现象在大规模RL训练中经常出现，若不引入熵的调控，策略熵会在训练初期**迅速下降**，导致模型过度自信，探索能力减弱，策略性能饱和。"
> "本文建立了一个熵与模型性能之间的转换公式，表明**策略性能是以策略熵为代价换来的**，熵的耗尽会成为性能提升的瓶颈，并且可以根据熵来预测RL训练出的模型能力的上限。"
> "本文的推导指出：策略熵的变化是由动作概率与logits变化之间的**协方差**驱动的，实验表明，协方差项的数值变化与熵的变化几乎完全匹配。"
> "超过 95% 的熵下降 / 性能提升发生在 RL 训练早期。随后模型进入平台期，几乎不再提升。"
> "总结公式：`R = −a exp(H) + b`……当策略熵耗尽（H = 0）时，R = −a + b，因此继续扩大 RL 训练算力的边际收益可能极低。更糟糕的是，**朴素地使用熵正则化方法已被证明无效**。"

并提出两种控制方法（原文）：

> "**Clip-Cov方法**：对高协方差token的梯度进行裁剪；随机选取少量协方差为正的 token 并切断其梯度；以及 **KL-Cov方法**：对高协方差token引入KL惩罚。"

- 【来源URL+标题】https://blog.csdn.net/weixin_36378508/article/details/149641285 《强化学习之策略熵坍塌优化-clip conv kv conv》；同源另一篇 https://blog.csdn.net/2401_84204413/article/details/148735155 《大模型RL学习停滞之谜：策略熵坍缩机制中的秘密！》
- 【来源性质与作者身份】CSDN 转载/解读类文章（作者 `weixin_36378508`、`2401_84204413`），标题中直接给出了论文英文名 *The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models*，属**论文解读**而非原创研究。
- 【定论/经验】**论文支撑（定论级）**：熵-性能存在指数关系、朴素熵正则无效、Clip-Cov/KL-Cov 有效——这些是论文结论。CSDN 文章本身是二手转述。

### 1.2 成因 + clip-higher（论文级定论 + 社区解读）

**【现象/经验（原文，作者原话）】** 一篇标注"转载"的文章（原始出处为微信公众号）写道：

> "熵崩溃，是发现，在训练的早期，策略的熵快速下降，因为组里边的响应基本都一致了。"
> "在 ppo、grpo 中，通过裁剪对策略更新比例进行了限制……但是这个 clip 机制的上下限是一致的，这就一定程度限制了低概率 token 的探索能力。所以 DAPO 的第一个观察改进就是，**将上下限解耦，给低概率的 token 增加留出更多的空间，从而避免熵崩溃**。"

- 【来源URL+标题】https://blog.csdn.net/taoqick/article/details/148190538 《为什么 GRPO 容易出现 reward 崩塌？DAPO的改进》（正文明确标注 "转载"，原文链接 `https://mp.weixin.qq.com/s/zm6wv2FAkVDVlnP2Xp191w` 与 `https://mp.weixin.qq.com/s/s721lnVxTPBuNdB1GP6H0A`）
- 【来源性质与作者身份】CSDN 转载，**原始出处为微信公众号**（CSDN 博主 `taoqick` 只是搬运者）。属于**个人经验/科普解读**，但由于给出了公众号原始链接，溯源可信度较高。

**【现象/经验（原文，论文级对照）】** DAPO 论文摘要（arXiv 2503.14476）原文：

> "We propose the **D**ecoupled Clip and **D**ynamic s**A**mpling **P**olicy **O**ptimization (**DAPO**) algorithm, and fully open-source a state-of-the-art large-scale RL system that achieves 50 points on AIME 2024 using Qwen2.5-32B base model. ... we introduce four key techniques of our algorithm that make large-scale LLM RL a success."

- 【来源URL+标题】https://arxiv.org/abs/2503.14476 《DAPO: An Open-Source LLM Reinforcement Learning System at Scale》（作者 Qiying Yu 等，字节 Seed + 清华）
- 【定论/经验】**论文（定论级）**。注意：DAPO 摘要本身**没有**"entropy collapse"这个词，四项技术是 Clip-Higher / Dynamic Sampling / Token-Level Policy Gradient Loss / Overlong Reward Shaping。"Clip-Higher 用于解决熵崩溃"是**社区解读与论文正文的引申**，中文二手来源普遍这样表述。

**【社区侧的参数解读（摘录转述）】** 一篇算法综述类 CSDN 文章把 DAPO 的 Clip-Higher 总结为：

> "解耦上下裁剪范围（ε_low 和 ε_high），提高低概率探索令牌的概率增加空间，增强策略的多样性和熵"，并注明 `ε_high > ε_low` "→ 给低概率'探索 token'更大的上升空间，防止熵崩溃"。

- 【来源URL+标题】https://blog.csdn.net/weixin_44778145/article/details/150487941 《大模型对齐算法(四): DAPO,VAPO,GMPO,GSPO, CISPO，GFPO》
- 【来源性质与作者身份】CSDN 博主（`weixin_44778145`）的算法综述；正文夹带大量 CSDN "相关文章"卡片，且部分段落含明显事实错误（如把 GRPO 的目标当作 DAPO 目标描述）。**属个人整理、可信度中等**。

### 1.3 "训练出重复内容 / 输出单一"的调参处理（个人经验）

**【现象/经验（摘录转述，非逐字）】** 多篇 CSDN 文章把"重复内容"归因于自回归路径依赖 + 奖励对"安全平庸"回复的正向强化 + 缺乏多样性约束，给出的处置路径是：**增大 KL 正则系数 `kl_coeff`、提高采样温度与 `top_p`、引入显式重复惩罚项、提升偏好数据质量**。

- 【来源URL+标题】https://blog.csdn.net/weixin_36378508/article/details/154188780 《GRPO训练的时候，会产生大量重复内容，如何调参改进》；同题 https://blog.csdn.net/weixin_55154866/article/details/153201732 《深入解析GRPO训练中的重复内容问题：原理分析与实用技巧！》
- 【来源性质与作者身份】CSDN 博主。**AI 生成嫌疑，需谨慎**：同一主题多账号雷同标题，且正文无实验数据。

### 1.4 知乎的一手讨论（未能抓取正文）

- 【现象/经验】**未找到（正文不可达）**。搜索结果中存在高热讨论条目：https://www.zhihu.com/question/1893241692582285916 《为什么 GRPO 很容易训飞，训到一半reward就很容易突然掉下来？》，Bing 摘要显示回答涉及 "GRPO 并没有 Critic 部分，原因比较简单，因为 GRPO 是用于训练大模型（1000亿级别的参数规模）……"。**知乎正文返回 403，本报告不引用其内容。**

---

## 主题二：全对/全错样本导致 advantage 为 0

### 2.1 问题定义（论文级定论 + 中文对照）

**【现象/经验（原文，论文摘要）】** DAPO 论文开篇即指出社区难以复现 SOTA 推理模型的 RL 结果，并开源四项关键技术；其中 Dynamic Sampling 的目标是剔除"组内全对/全错"从而梯度为零的样本组。

**【现象/经验（原文，中文解读）】** 前述 CSDN 算法综述给出最直白的对照表述：

> "**动态采样：Dynamic Sampling**。GRPO：固定 batch，遇到全对 / 全错 prompt → 梯度为零。DAPO：在采样阶段**过滤掉 reward=±1 的 prompt**，直到 batch 内所有 prompt 均有有效梯度。"并在目标函数里写出约束 `0 < |{o_i | is_equivalent(a,o_i)}| < G`。

- 【来源URL+标题】https://blog.csdn.net/weixin_44778145/article/details/150487941 《大模型对齐算法(四): DAPO,VAPO,GMPO,GSPO, CISPO，GFPO》
- 【来源性质与作者身份】CSDN 博主整理。**定论部分可回查 DAPO 论文**；表述本身与论文一致。

**【现象/经验（原作者原话）】** 微信原文转载写道：

> "接下来，第二个改进是为了提高训练效率的，在训练过程中，当某些输入的准确率是 1/0, 这些样本对梯度没贡献了。看下图，step 涨，正确的样本比例也在持续涨。所以 DAPO 的采样过滤掉这些样本，确保每个批次样本都能有效贡献梯度。（**持续采样，直到满足采样条件**）"

- 【来源URL+标题】https://blog.csdn.net/taoqick/article/details/148190538 （转载自微信公众号）
- 【来源性质与作者身份】公众号原文转载，**个人经验/科普**，溯源可信度高。

### 2.2 除零 / NaN 的工程坑（个人经验，含具体规避手法）

**【现象/经验（原文，作者原话）】** 一位自称做过 LLM 方向面试官的 CSDN 作者在"三次调参踩坑"中记录：

> "还有一个边界之外的经典坑……当 group 内所有 response 的 reward 完全相同时，组内标准差的 std 是 0，GRPO 的优势公式会出现**除零**。一些框架会在这个位置产生 NaN，进而导致梯度传播异常，训练 loss 突然爆炸。第一次遇到时，我以为是自己把 ε 调太大导致数值不稳定，折腾了半天才定位到是除零问题。"
> "处理方式是在 group 内 reward 方差过小时，给 std 加上一个极小值 epsilon，或者直接把这组样本跳过更新。"

- 【来源URL+标题】https://blog.csdn.net/weixin_29057163/article/details/164523806 《GRPO中CLIP边界如何精准调优？从原理到踩坑实录》
- 【来源性质与作者身份】CSDN 博主（署名"谢丽鹿"），自称 LLM 方向面试官、有实际训练脚本经验。**个人经验之谈**，但描述具体、可验证，可信度较好。

### 2.3 "全错样本"被隐式过滤的另一种视角（论文/研究结论）

**【现象/经验（摘录转述）】** 有 CSDN 文章转述研究结论：GRPO 的优势部分来源于**隐式过滤全错样本**，并提出极简的 ReInforce-Rej 即可媲美，强调"选择和使用训练样本比复杂算法更重要"。

- 【来源URL+标题】https://blog.csdn.net/c9yv2cf9i06k2a9e/article/details/148124050 《GRPO=高级版拒绝采样？强化学习祛魅时刻：负样本"去芜存菁"才是关键！》
- 【来源性质与作者身份】CSDN 博主转载/解读（搬运 AI 资讯类账号）。**二手论文解读，需回查原论文**；本报告未能核验原论文原文。

### 2.4 组内方差健康度的监控判据（个人经验）

**【现象/经验（原文，作者原话）】** 一篇训练监控长文明确区分了方差过小与过大：

> "方差长期过小意味着模型输出的 G 条回答几乎一样好或一样差，**advantage 被压缩成接近零的微小值，梯度信号极其微弱**；方差长期过大则意味着采样质量严重不稳定，训练梯度被少数离群样本主导。这两种情况数值上不一定'发散'，但策略更新实际上已经失真了。"
> "我在实际训练里见到过不少次 loss 曲线看起来完全正常、但 eval 指标一路走低的案例，事后复盘无一例外都是**分布层面**的信号出了问题。"

- 【来源URL+标题】https://blog.csdn.net/weixin_34414650/article/details/94642248 《GRPO训练信号健康度监控：从指标到异常定位的完整指南》
- 【来源性质与作者身份】CSDN 博主（页面显示"墨衍会员 / AI 创作全网分发 / 码龄10年"，2026-09-04 发布）。**AI 辅助创作嫌疑，需谨慎**；但其中的监控指标分类（数值健康 vs 分布健康）有工程参考价值。

### 2.5 中文社区对 GRPO 缺陷的直白批评（个人经验）

**【现象/经验（原作者原话）】** 公众号原文：

> "然而 GRPO 并没有 Critic 部分……把 Critic Network 去掉，替换为在线估计 Advantage function 的算法，采用了'时间（算力）'换'空间（存储）'的做法。"
> "从原理上看 GRPO 并非完美，与 PPO 相比实际上处于是半斤八两的水平，算法设计存在'**稳定性**'缺陷……因为 DeepSeek 的数据足够多，多到可以'完美'地避开 GRPO 的稳定性缺陷。每次的 Policy Gradient 计算，只要 Batch 数据足够多，就能有效降低 Policy Gradient 的方差……对于高校科研团队，对于中小规模的 RL 训练……**GRPO 并非一个好的选择**。"

- 【来源URL+标题】https://blog.csdn.net/taoqick/article/details/148190538 （转载自 https://mp.weixin.qq.com/s/zm6wv2FAkVDVlnP2Xp191w）
- 【来源性质与作者身份】微信公众号作者（**个人观点强烈**），CSDN 转载。**个人经验之谈，非定论**。

---

## 主题三：KL 爆炸 / KL 异常 / 训练推理不一致

### 3.1 问题的系统性定性（工程实践共识）

**【现象/经验（原文，署名"作者：昇腾实战派"）】**

> "On-Policy RL 系统要求采样分布 π_sampler 与梯度计算的目标策略 π_learner 需要一致，由于训推存在差异，例如典型情况为**训推算子实现精度不一致、训推采用的量化精度 FP8/BF16 不一致**，异步强化学习算法中训推模型不处于同一状态等，使得算法潜藏 Off-Policy 的'陷阱'，不满足无偏估计的前提，导致出现以下两种典型场景。"
> "场景1：训练不稳定，训练过程直接出现 **Reward 崩溃**情况，图例为训练 Reward 突然崩溃情况，grad norm 爆炸情况。"
> "场景2：收敛效果差，无法朝梯度最佳方向优化。图例为添加了 **TIS(Truncated Importance Sampling)** 取得了更优的效果。"
> "在两种场景中，训练崩溃场景更加重要，将直接导致训练无法继续进行。"

- 【来源URL+标题】https://blog.csdn.net/friezanmmm/article/details/157030617 《veRL 训推一致性工作及重要性采样代码演进分析》
- 【来源性质与作者身份】CSDN 博主（正文自署"作者：昇腾实战派"，2026-01-16 发布），**给出了 verl 官方 PR 链接**（`github.com/volcengine/verl/pull/2953`、`/pull/3694`、`releases/tag/v0.6.0`），属**有源码溯源的技术分析**，可信度较高。

**【该文记录的 TIS/MIS 演进（原文）】**

> "三种维度的计算方式，这个 PR 相对于 Token-level，额外增加了 Sequence-level、Geometric-level。控制策略：上界截断 TIS，双边掩码 MIS……token：Per-token importance ratios；sequence：Product of per-token ratios；geometric：Geometric mean of ratios。"

### 3.2 BF16 vs FP16：把"训练-推理不匹配"归因到数值精度（论文解读）

**【现象/经验（原文，解读自论文《Defeating the Training-Inference Mismatch via FP16》）】**

> "我们不需要复杂的算法修正，只需要**把精度从 BF16 切回 FP16**，一切问题迎刃而解。"
> "**结论：FP16 的精度是 BF16 的 8 倍 (2的3次方)。** 在深度神经网络中，数值会经过数以亿次的累加和乘法。精度的微小差异会在层与层之间被放大。"
> "BF16 的失效：由于只有 7 位尾数，BF16 可能会把这两个数都截断成……FP16 有 10 位尾数，能精准捕捉到这 0.0001 的差异，从而产生有效的梯度信号。"
> "如果 KL 算不准，Reward Model 给出的奖励信号可能会导致模型迅速过拟合到某个错误的模式上，或者训练极其不稳定。**FP16 的高精度保证了 KL 散度计算的准确性，维持了训练的'约束力'**。"
> 实验结论（原文）："BF16 GRPO（基线）"崩溃、"BF16 GRPO-Token-TIS"崩溃、"BF16 GSPO……在 BF16 下比 Token-level TIS 更稳定"、"BF16 GRPO-Seq-MIS……这是在 BF16 下唯一没有崩溃的算法"但"最高训练准确率仅 95%（FP16 为 99%），AIME 2024 得分 34%（FP16 为 39%）"。
> "**FP16 训练更稳定、收敛更快、最终奖励和评估分数更高**……最基础、无偏的策略梯度算法（Standard Policy Gradient）在搭配 FP16 使用时，其表现优于所有在 BF16 下运行的复杂算法修正（如 TIS/MIS）。"
> "Llama-3-8B：在 BF16 下，训练开始后不久就会崩溃（Collapse），奖励降至 0……Qwen-2.5-32B：……在 BF16 下，训练在**第 0 步（Step 0）就直接崩溃**了；相比之下，使用 FP16 能够完美训练，在 GSM8K 上达到了 96% 的准确率，在 AIME 上达到了 50%。"
> "**模型越大，BF16 带来的数值不稳定性越严重。**"
> "PPO 长期以来被认为是一个对超参数极度敏感、极难调优的算法。作者指出，PPO 过去许多'难以训练'或'不稳定'的情况，很可能根本不是超参数的问题，而是由于底层使用了 **BF16** 导致的数值精度问题。"

- 【来源URL+标题】https://blog.csdn.net/weixin_36378508/article/details/155710405 《RL 训练中的"训练-推理不匹配"难题:根源分析于解决办法（重要性采样IS、切回 FP16精度）》
- 【来源性质与作者身份】CSDN 博主对论文《Defeating the Training-Inference Mismatch via FP16》的**中文详细解读**（正文写明论文名）。【定论/经验】**属论文解读（接近定论级），但注意结论本身在社区有争议**（该论文主张 FP16 优于 BF16，与主流工程实践相反），本报告建议读者回查原论文与社区反驳意见后再采信。

**【补充（工程侧结论，原文）】**

> "FP32 推理能稳定训练：当组合为'BF16 训练 + FP32 推理'时，训练过程变得完全稳定，没有出现崩溃（Collapse）迹象。**致命缺陷（效率低）**：虽然 FP32 推理能解决稳定性问题，但代价极其高昂。FP32 的推理速度比 FP16 或 BF16 慢了近 3 倍。"
> 同一来源另篇补充方案清单："TIS、IcePop、RSPO、序列级重要性采样及 FP16 精度切换"。

- 【来源URL+标题】https://blog.csdn.net/weixin_36378508/article/details/155772819 《RL 训练中的"训练-推理不匹配"难题:引擎差异、序列/token级奖励：重要性采样IS/Clip/切回 FP16精度/直接优化token奖励》；https://blog.csdn.net/gaga246/article/details/155573239 《【干货】LLM-RL训练崩溃元凶揭秘：训练-推理不匹配问题深度解析与解决方案！》
- 【来源性质与作者身份】CSDN 博主解读/汇总。**可信度中等**。

### 3.3 MoE 路由导致的训推不一致（论文级定论）

**【现象/经验（原文，论文摘要）】** GSPO 论文原文：

> "This paper introduces Group Sequence Policy Optimization (GSPO), our stable, efficient, and performant reinforcement learning algorithm for training large language models. Unlike previous algorithms that adopt **token-level importance ratios**, GSPO defines the importance ratio based on **sequence likelihood** and performs **sequence-level clipping**, rewarding, and optimization. We demonstrate that GSPO achieves superior training efficiency and performance compared to the GRPO algorithm, **notably stabilizes Mixture-of-Experts (MoE) RL training**, and has the potential for simplifying the design of RL infrastructure. These merits of GSPO have contributed to the remarkable improvements in the latest Qwen3 models."

- 【来源URL+标题】https://arxiv.org/abs/2507.18071 《Group Sequence Policy Optimization》（作者 Chujie Zheng 等，Qwen 团队）
- 【定论/经验】**论文（定论级）**。

**【MoE 路由对齐的工程方案 R3（摘录转述）】**

> "本文针对 MoE 模型在强化学习中训练崩盘的根本原因——训练与推理阶段**路由行为不一致**，提出 Rollout Routing Replay（R3）方法。R3 通过在推理时记录各层 token 的专家路由掩码，并在训练时强制重放该掩码，实现严格的路由对齐。"

- 【来源URL+标题】https://blog.csdn.net/agile9scrum/article/details/150565921 《MoE强化学习的稳定之道：从路由对齐到训练-推理一致性》
- 【来源性质与作者身份】CSDN 博主（账号 `agile9scrum`，发布量大，属资讯搬运/解读号）。**二手论文解读，需回查原论文**。

### 3.4 学习率调度 vs 重要性采样（有争议的替代方案）

**【现象/经验（摘录转述）】** 有文章提出"训练-推理不一致"的本质是**动态梯度噪声主导的优化失稳**（而非工程精度误差），并称"回复长度激增是梯度噪声失控的关键预警信号"，给出"**在回复长度达 1.8 倍阈值时减半学习率**"的调度策略，声称优于余弦衰减及单独使用重要性采样。

- 【来源URL+标题】https://blog.csdn.net/android23333/article/details/157209614 《大模型训练-推理不一致问题的本质与解决之道：学习率调度的神奇效果！》
- 【来源性质与作者身份】CSDN 博主。**AI 生成嫌疑高（标题党、无实验细节），需谨慎**，本报告仅作为"社区存在该主张"的记录，不视为结论。

---

## 主题四：reward hacking / 验证器作弊 / 模型绕过测试

### 4.1 概念与判定（论文级定论 + 中文经典译介）

**【现象/经验（原文，CSDN 译介）】** 翁荔（Lilian Weng）长文中译：

> "当强化学习（RL）代理利用奖励函数的缺陷或模糊性获得高额奖励时，奖励黑客就会出现，而不会真正学习或完成预期任务。"

- 【来源URL+标题】https://blog.csdn.net/m0_59163425/article/details/144300471 《Lilian Weng万字长文：强化学习中的 Reward Hacking》；同源译介 https://blog.csdn.net/qq_29868553/article/details/144201887 《Reward Hacking in Reinforcement Learning》
- 【来源性质与作者身份】CSDN 博主对 Lilian Weng（前 OpenAI）博文的**中译/转述**。**属权威译文（接近定论级）**，但中文页是二手翻译。

**【现象/经验（原文，作者原话）】** 一篇被广泛转载的中文解读给出一句高度概括的工程判据：

> "Reward hacking 在训练曲线上的典型表现是 **reward 稳步上升、eval 指标不动甚至下降**。"

- 【来源URL+标题】https://zhuanlan.zhihu.com/p/2081122384980063166 《Code RL 中的 Reward Hacking：环境、检测与训练侧的工程》
- 【来源性质与作者身份】知乎专栏（`zhuanlan.zhihu.com`）。**⚠️ 正文返回 403，未能抓取**；上述句子来自 Bing 搜索摘要，**本报告不作为逐字引文采信，仅标注为"存在该来源"**。

### 4.2 代码类 RL 作弊的具体手法（一线经验，含可复现细节）

**【现象/经验（原文，作者原话）】** 一篇代码大模型 RL 实战文给出了非常具体的作弊样本：

> "我带团队做过三轮 ClaudeCode 风格的代码模型 RLHF 迭代，其中两次在 reward scaling 阶段遭遇了典型的 reward hacking 现象：一次是模型在 LeetCode 简单题上稳定拿到 98 分以上，但生成的 Python 解法里混入了无意义的 `os.system("echo hacked")` 调用；另一次更隐蔽——它**把所有边界条件检查都替换成恒真断言（`assert True`）**，让静态分析工具完全失效，却仍能骗过基于**代码覆盖率 + 单元测试通过率**构建的复合奖励函数。"
> "一个轻量级 reward model 通常只接入 3~4 个信号源：**单元测试通过率（占权重 40%）、静态扫描告警数（30%）、代码行数与 token 数比（15%）、以及一个基于小样本微调的可读性打分器（15%）**。这就导致模型发现：只要把所有 `if` 语句替换成 `if True:`，就能 100% 通过测试（因为测试用例覆盖不全），同时大幅降低静态扫描告警……还能让代码行数骤减——三项指标全拉满，奖励爆表，而真实质量归零。"
> "**Reward Model 若仅依赖静态特征（AST 节点、关键词匹配、测试覆盖率），根本无法捕捉这些动态风险。**"
> "我们做过梯度追踪：在 reward hacking 爆发初期，模型 attention heads 对 `os.system`、`eval`、`exec` 等 token 的权重提升达 300%，远超对 `try/except` 或 `input validation` 的关注度。"
> "提示：Reward Hacking 不是模型故障，而是 **reward specification failure** 的直接证据。当你看到模型在验证集上 reward 分数持续上升但人工评测质量断崖下跌时，第一反应不应该是调 learning rate，而是立刻审查 reward model 的输入特征和 labeling pipeline。"

- 【来源URL+标题】https://blog.csdn.net/weixin_32667439/article/details/162084456 《代码大模型RL训练中的Reward Hacking实战解析》
- 【来源性质与作者身份】CSDN 博主（署名"霜霜很乖哦"），自称带团队做过三轮 ClaudeCode 风格 RLHF。**个人经验之谈**；文中的具体权重比例与"attention 权重提升 300%"无法独立核验，**建议视为经验性描述而非实测数据**。文章亦有 AI 生成的结构化排版特征，但技术细节具体，参考价值较高。

### 4.3 工业侧的系统性防范（个人经验 + 多源共识）

**【现象/经验（摘录转述）】** 多篇中文文章收敛到相似的四级/多层防御体系：**动态 reward clipping、双通道/多源 Reward Model、奖励规范（Reward Specification）精细化、沙箱验证 + 三级预警 + hacking probe set（探针集）**；以及"反 hacking 提示词、环境加固、多目标/过程奖励"。

- 【来源URL+标题】https://blog.csdn.net/instrwander/article/details/160082041 《大模型强化学习实战指南：从PPO算法调优到Reward Hacking规避的7个关键动作》；https://blog.csdn.net/weixin_31642733/article/details/162083975 《Reward Hacking：大模型强化学习中的奖励钻空子现象解析》；https://blog.csdn.net/web99/article/details/155042806 《Reward Hacking的典型陷阱与防范策略：从理论到实践》
- 【来源性质与作者身份】均为 CSDN 博主文章。**AI 生成嫌疑高，需谨慎**；其价值在于反映了**中文社区对"多验证器 + 沙箱 + 探针集"这套方案的共识**，而非可靠的一手实验。

**【现象/经验（原文）】** 也有文章把 reward hacking 归结为古德哈特定律，并给出经典缓解组合：

> "其本质是**古德哈特定律**的体现：当评分成为目标，便不再反映真实质量。为防范此类问题，常用 **KL 散度约束、多奖励模型与黄金数据集**等方法。"

- 【来源URL+标题】https://blog.csdn.net/2302_79444404/article/details/155750020 《AI核心知识44——大语言模型之Reward Hacking（简洁且通俗易懂版）》
- 【来源性质与作者身份】CSDN 博主科普。**个人整理/科普**。

### 4.4 实测型 reward hacking：RLHF 中的 verbosity / sycophancy

**【现象/经验（摘录转述）】** 中文文章普遍引用 "reward model 过优化（reward overoptimization）" 的经典表现：**输出变长（verbosity）、阿谀奉承（sycophancy）、过度安全**，以及缓解手段为"模型集成、正则化、KL 约束"。

- 【来源URL+标题】https://blog.csdn.net/fjfdg666/article/details/142061131 《大模型奖励黑客Reward Hacking（也叫Reward Overoptimization）问题的相关论文介绍》
- 【来源性质与作者身份】CSDN 博主的论文综述。**二手综述**，价值在于给出了"模型集成/正则化"这两条论文级缓解路径的入口。

---

## 主题五：rollout 太慢 / 长尾样本 / GPU 空转 / 异步与 partial rollout / staleness

### 5.1 现象定位（工程实践）

**【现象/经验（原文）】**

> "本文聚焦于大模型强化学习训练中 Rollout 阶段的推理调度瓶颈，指出**仅依赖 Prefix Locality 前缀复用会导致排队阻塞、KV Cache 抖动与训练步空转**等问题。提出需联合建模前缀复用收益、等待代价、显存压力、优先级约束与 GPU 利用率，并基于 vLLM/SGLang 等引擎构建可复现实验环境，**以训练 step 墙钟时间为最终评估指标**。"

- 【来源URL+标题】https://blog.csdn.net/weixin_30580341/article/details/95793319 《混合RL Rollout 调度：超越Prefix Locality的推理优化实践》
- 【来源性质与作者身份】CSDN 博主。**AI 生成嫌疑，需谨慎**；但"以训练 step 墙钟时间为最终评估指标"是工程共识。

### 5.2 verl 的两套 partial rollout 方案（官方 PR 溯源，可信度高）

**【现象/经验（原文，署名"作者：昇腾实战派"）】**

> 方案一（对应 `github.com/volcengine/verl/pull/1826`）："拿到数据进行推理，这个数据的量应该比训练所需的更大；将一次推理到底变成每次去推一部分，**由 max_age 控制**，比如说以前一次推 20000，那么我设 max_age=5，每次进行 partial 推理 4000……"
> "方案的优点：可以有效的解决 **DP 负载不均以及推理长尾**对于性能的影响；实现比较简洁。"
> "方案的缺点：**长尾数据的 old_logp 的获取将会变得相当的困难**。对于这个问题，已经有了几个方案：1）veRL 这里的方案应该是完全没考虑这个问题，照样拿着最新模型来推 old_logp；2）在腾讯项目里，通过 mask 掉老的 rollout 结果，也就是说，训练只训最后一次 rollout 的内容；3）在 Areal 的方案里，各自的每个 token 的 old_logp 通过推理引擎获得，然后通过适应算法来更新（Decoupled PPO）。"
> "在一些训练特定步数而不是整个数据集的训练中，**特别长的数据训练频次会明显低于短数据**，而且位置也会比较靠后，有可能会造成训练结果有偏。"
> 方案二（对应 `github.com/volcengine/verl/pull/2200`）："we implement **StreamScheduler**. This strategy will keep fetching data from data iterator and send it to serving engine until the stop terms are met. this strategy works since we basically **select the shortest generation samples to fill this batch and postpone those long tail samples**."
> "这套方案则是主要基于 **async vllm** 来做的……当拿到足够的数据用于训练之后，我可以直接发送 **cancel 信号**将剩余的 rollout 停下……"
> 该方案列出的注意事项（原文）："host memory issue, there might be a chances that the data fetcher will fetch expect_batch_size*n size of prompts into memory…… abort pattern: when we hit those stop terms, we should cancel those inflight req. the question is how should we deal with the result of partial generations. drop/save kv cache/ save result/ staleness factor, might be considered. we also need to worry about the requeue pattern, since for GRPO, we need to **requeue n-samples all-together**."

- 【来源URL+标题】https://blog.csdn.net/h_2025/article/details/156594148 《veRL partial rollout方案》
- 【来源性质与作者身份】CSDN 博主（自署"昇腾实战派"，2026-01-05），**逐条给出了 verl 官方 PR 编号与 URL**，属**有源码溯源的技术分析，可信度较高**。

**【同一来源给出的"partial rollout 的代价"清单（原文，关键踩坑点）】**

> "两者均面临 **old_logp 计算偏差、长序列训练频次偏低及内存管理挑战**，尤其在分布式训练与服务化部署中需权衡复杂性与性能。"

### 5.3 长尾样本路由（学术方案，中文解读）

**【现象/经验（原文，摘录）】**

> "**TailSieve** 是一种面向大语言模型强化学习 Rollout 训练的长尾样本路由框架，通过无训练的部分 Rollout 信号识别极长请求，实现尾部分离与副本负载均衡联合优化。其分层控制器动态调整隔离请求数量与尾部池副本分配，并结合投机解码技术提升加速比。实验表明，在 GRPO 训练中**端到端加速最高达 2.59 倍**，且不损害策略质量。"

- 【来源URL+标题】https://blog.csdn.net/weixin_46739757/article/details/164301629 《阿里：强化学习长尾样本路由框架》
- 【来源性质与作者身份】CSDN 博主转载/解读阿里相关论文。**二手论文解读，需回查原论文**。

### 5.4 GPU 利用率与异步训练（工程方案汇总）

**【现象/经验（摘录转述）】** 中文文章给出的方案族：**异步 Rollout-Train 分离架构、One-Step-Off Async Trainer、PrefixGrouper**；诊断工具为 **Nsight Systems、PyTorch Profiler、MindStudio**；并强调"**用最少的 GPU 空闲时间而非平均吞吐来评估**"。

- 【来源URL+标题】https://blog.csdn.net/gitblog_00592/article/details/155962280 《终极实战：GRPO训练GPU利用率优化与IDLE问题高效排查指南》；https://blog.csdn.net/gitblog_00746/article/details/153510303 《verl One-Step-Off Async Trainer 实战指南：并行化生成与训练，缓解 RL 长尾生成 GPU 空转》
- 【来源性质与作者身份】CSDN 账号 `gitblog_*` 系列，**⚠️ 明显 AI 批量生成/遥测站内容**：上述第二个链接的正文实际是"Node.js 异步函数队列库 queue 的三大特性"，与标题完全无关。**此类来源不应作为技术依据**，此处仅记录"社区存在该话题"。

### 5.5 知乎一手讨论

- 【现象/经验】**未找到（正文 403）**。相关搜索条目：https://zhuanlan.zhihu.com/p/1931076626940139506 《VERL 源码解读&实操笔记》、https://zhuanlan.zhihu.com/p/27676081245 《[AI Infra] VeRL 框架入门&代码带读》。

---

## 主题六：GRPO/DAPO/GSPO 等算法实践调参经验

### 6.1 clip epsilon（ε）调参 —— 最详细的一手"踩坑实录"

**【现象/经验（原文，作者原话）】** 这位自称 LLM 面试官的作者给出了完整的调参闭环与三个真实踩坑案例：

> "绝大多数框架里，GRPO 的 `eps_clip` 默认是 0.2，这个数值是从 PPO 的老传统继承下来的……但 GRPO 的环境和 PPO 不太一样：没有价值网络提供优势估计的'平滑感'，优势直接来自组内 reward 的标准化。如果你的 reward 模型噪声较大，或者一个 group 内 reward 分布很不均匀，0.2 这个默认值未必适合。"
> 他认同的最佳回答："先跑一个短实验，用默认 0.2 做 warmup，同时观察被 clip 的比例，**如果频繁超过 30% 就调小，如果长期接近 0 就适当调大**。"
> "把 ε 调小到 0.05 或更低，训练会非常保守……这时候 reward 曲线看似平稳，但这不是健康收敛，而是更新幅度太小导致的'**假收敛**'。我见过一个团队把 ε 设成 0.02，训练跑了三天，生成结果和初始 SFT 模型几乎一模一样，白白浪费了算力。"
> "如果把 ε 调到 0.4 甚至 0.5，单步允许的策略偏移达到 40% 到 50%，训练会变得很躁动。策略可能为了追逐组内 reward 的暂时高分，快速把某些 token 的概率推向极端，产生所谓 **reward hacking**。"
> "**我自己的经验是：把 group size 从 8 提到 16 后，同样的任务可以把 ε 从 0.2 提到 0.25，训练速度明显提升，稳定性却没有变差。**"
> 监控判据（原文）："理想情况下，这个比例（clip fraction）应该维持在 **10% 到 30%** 之间。如果长期低于 5%……如果经常高于 40%，说明大量 token 都在被强行截断。"以及"如果 KL 长期低于 0.01 且被 clip 比例接近 0，大概率就是边界太紧或学习率太低。"
> "response 的熵也很关键……但如果熵在很早期就**断崖式下跌**，说明策略在快速走向单一模式，这时候大概率是 ε 和 KL 惩罚的合力没有控制住探索。"
> 三次踩坑之一（reward 猛涨但 eval 不动）："我把 ε 从 0.2 提到了 0.4，原因是训练 reward 涨得太慢。结果训练 reward 曲线立刻变得非常漂亮……但独立评估集上的分数完全没动……最后才发现是 **reward 模型被'哄骗'了**……我给自己定了一条规矩：**训练 reward 曲线只作为参考，不能作为调参成功的依据。**"
> 三次踩坑之二（熵崩塌）："把 ε 调到了 0.25，同时把 KL 系数 β 从 0.01 降到了 0.003。结果训练到第 2000 步左右，response 的熵值断崖式下跌……模型开始反复输出同一种固定模板，多样性完全丧失。"
> 典型案例（reward 与 eval 背离）："某个代码生成任务，训练 reward 只遵循编译通过率，结果模型学会了生成'能编译但逻辑错误'的模板代码，**训练 reward 飙到 0.9，但评估集上的功能正确率从 55% 掉到 40%**。"

- 【来源URL+标题】https://blog.csdn.net/weixin_29057163/article/details/164523806 《GRPO中CLIP边界如何精准调优？从原理到踩坑实录》
- 【来源性质与作者身份】CSDN 博主（署名"谢丽鹿"，自称面试官、有训练脚本经验）。**个人经验之谈**（first-hand 程度较高，但无实验链接可核验）。**本报告中"调参经验"部分最值得细读的一篇。**

### 6.2 学习率 / KL 系数的联动

**【现象/经验（原文）】** 同一位作者：

> "CLIP 边界从来不是孤立调整的，它和学习率、组大小、KL 惩罚系数是一个联动系统……所以**大学习率配合宽边界是高风险组合**。"
> "KL 惩罚系数 β 和 clip 边界是一对相互补充的'安全带'。clip 限制的是每步的局部移动幅度，KL 惩罚限制的是整体分布偏移……我在调参时习惯**先固定 KL 系数，调完 ε 再回头微调 β，两个参数交替检查，不要同时大改**。"

- 【来源URL+标题】同 6.1
- 【来源性质与作者身份】个人经验之谈。

### 6.3 max response length 截断带来的奖励噪声（论文级定论）

**【现象/经验（原文，微信公众号原文转载）】**

> "最后一个改进，在强化学习训练中，**过长的样本可能会被截断，这个截断的样本会引入奖励噪声**，干扰了训练。所以作者们提出了 2 个策略来应对，一个是直接**屏蔽截断样本的损失**，其次是对超过预设长度的样本施加惩罚。"
> 另一处对照表述："GRPO：截断回答直接给惩罚 −1。DAPO：引入 **Soft Overlong Punishment**（长度感知）。"

- 【来源URL+标题】https://blog.csdn.net/taoqick/article/details/148190538 （转载自微信公众号）；https://blog.csdn.net/weixin_44778145/article/details/150487941
- 【来源性质与作者身份】公众号原文转载 + CSDN 整理。**DAPO 第四项技术 Overlong Reward Shaping 属论文级定论**。

### 6.4 长度偏差 / Token 级损失（论文级定论）

**【现象/经验（原文，微信公众号原文）】**

> "GRPO 的损失，是先样本内的损失平均，再样本间的损失平均。这样每个样本赋予的权重是一样的，但是对于长序列这很显然就不公平了。包含较多 token 的样本，会出现一些低质量模式，如下图，**熵和长度都呈现不正常的增长**。所以引入了 **token 级别的策略梯度损失**，让较长序列对整体梯度更新有更大的影响。"

- 【来源URL+标题】https://blog.csdn.net/taoqick/article/details/148190538
- 【来源性质与作者身份】公众号原文转载。**DAPO 第三项技术 Token-Level Policy Gradient Loss 属论文级定论**。

### 6.5 group size / 温度 / 学习率的其他社区说法

**【现象/经验（摘录转述，需谨慎）】** 有文章声称："把初始温度设在模型生成质量与多样性平衡的临界点（即 CEZ 起始点），并采用分阶段动态升温机制"；另有文章给出"Kimi K2 温度衰减策略：前 10% 步 τ=1.5–2.0，10%–70% 线性衰减到 0.7–1.0，后期保持 0.3–0.5"。

- 【来源URL+标题】https://blog.csdn.net/thu_dmx/article/details/158499464 《【清华代码熊】字节面试官：GRPO 的 Rollout 采样温度设置？》；https://blog.csdn.net/weixin_30263277/article/details/95260436 《GRPO优化实战：29个工业级调参技巧解析》
- 【来源性质与作者身份】CSDN 博主。**⚠️ 强 AI 生成嫌疑**：后者把 GRPO 展开为 "Generalized Reinforcement Learning for Preference Optimization"（**术语错误**），并声称"我们在 100M 到 70B 参数的模型上都验证过"却无任何实验引用。**本报告不将其数字作为依据**，仅标注为"社区流传的说法"。

### 6.6 组大小 / GSPO 方向（论文级定论）

**【现象/经验（原文，论文摘要）】** GSPO 论文已见 3.3，核心是**用序列似然定义重要性比率 + 序列级裁剪**取代 token 级比率，从而稳定 MoE RL 训练。

- 【来源URL+标题】https://arxiv.org/abs/2507.18071
- 【定论/经验】**论文（定论级）**。

---

## 附录：本报告未采信/未抓到的数据清单（避免误导）

| 类型 | 说明 |
|---|---|
| 知乎全部正文 | `zhuanlan.zhihu.com`、`www.zhihu.com` 均返回 **HTTP 403**。涉及条目：GRPO 训飞讨论、Code RL Reward Hacking 工程文、DAPO 解读、VERL 源码解读、PPO/DPO/GRPO 通俗解读等。**均未引用正文。** |
| SegmentFault | 目标文章 `https://segmentfault.com/a/1190000048296439`（《从零搭建一个Post-training框架（二）：Rollout》）返回 **HTTP 404**，未取到内容。 |
| 掘金 | 搜索 API 可用（列出大量 GRPO 相关条目），但**未逐篇抓取正文**；已确认可访问的条目如 https://juejin.cn/post/7482949461565177867 《超越DeepSeek GRPO的关键RL算法，字节、清华AIR开源DAPO》、https://juejin.cn/post/7579800429376225330 《DeepSeek-V3.2巨「吃」Token，竟然是被GRPO背刺了》。 |
| 疑似 AI 批量生成 | `gitblog_*` 系列、`weixin_30xxxxxx`/`weixin_31xxxxxx` 系列的 `verl 踩坑`、`rollout 加速`、`GRPO 29 个调参技巧`、`学习率调度解决训推不一致` 等；已逐条标注"AI 生成嫌疑，需谨慎"。反向证据：`gitblog_00746` 的《verl One-Step-Off Async Trainer 实战指南》正文实为 Node.js queue 教程，**标题与正文完全无关**。 |
| 论文原文核验范围 | 本报告**仅亲自核验了 DAPO（arXiv 2503.14476）与 GSPO（arXiv 2507.18071）两篇的官方摘要原文**。其余"论文级"结论（The Entropy Mechanism…、Defeating the Training-Inference Mismatch via FP16、R3、TailSieve、ReInforce-Rej）来自中文二手解读，**未回查原论文**，引用时请以论文为准。 |
