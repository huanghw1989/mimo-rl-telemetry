# 中文一线从业者谈大模型 RL 训练调参与监控：踩坑经验调研

> 调研时间 2026-09-17。来源：知乎、CSDN、博客园、云栈社区、微信公众号（含其转载平台）、框架官方中文文档、科技媒体对论文/技术报告的解读。
> **不使用**任务背景中关于小米 MiMo 看板的描述作为任何结论来源。
> 可信度分级：**A=框架官方文档/论文/厂商技术报告**；**B=团队公开分享、大厂员工署名文章**；**C=个人博客、二手转载、自媒体解读、口口相传**。

## 0. 方法与两个前置结论

`web_search` 不可用（缺 API key）。实际路径：**360 搜索**（可拿到真实 URL）、**Bing**、**微信搜狗**（公众号检索），**知乎问答页/专栏页用浏览器直读**（知乎站内搜索需登录，但问答页可匿名打开）。

**结论一：中文社区几乎没有跨团队统一的"硬阈值"。** 能引用的数值全部来自框架官方文档（且只有少数几类指标）或单篇个人经验帖，后者之间还互相冲突（见第 8 节）。

**结论二：CSDN 已被大量 AI 批量生成内容污染。** 确凿案例：标题为《verl One-Step-Off Async Trainer 实战指南：缓解 RL 长尾生成 GPU 空转》的文章，**正文实际是 Node.js queue 库教程**；另有文章把 GRPO 错写成 "Generalized Reinforcement Learning for Preference Optimization"。本报告引用 CSDN 处均标注可信度，标"AI 生成嫌疑"的只作线索。

---

## 1. 坑：全对/全错样本 → 组内 advantage 恒为 0

**【现象】** 一个 prompt 采 n 条，全对或全错时组内 std=0，`A_i=(r_i-mean)/std` 恒 0，梯度为 0，算力白烧。中文社区常见描述："训练到 200~500 步时 reward 突然从 0.7 跌到 0，再也无法恢复"（[左扬：GRPO 进阶算法](https://www.cnblogs.com/zuoyang/p/20669796)，C，博客园博主，给出"症状/原因/修复"三段式）。

**【社区解释】**
- **定论级**：DAPO 论文以此为核心动机提出**动态采样**——过采样并过滤 accuracy 为 0 或 1 的组，直到 batch 由"有梯度"样本填满。知乎高赞回答（答主"假如给我一只AI""LazyCat"）都把它列为 DAPO 两大核心之一（[知乎：DAPO 全是已有的小 trick，为什么这么火](https://www.zhihu.com/question/1895273986537014226)，B/C）。
- **综述级**：一篇梳理 56 篇工作的中文综述指出，组内归一化同时埋下零优势隐患与**难度偏置**（不同难度题 std 不同，梯度贡献不均），并点出**该领域两大未解争论**：(a) 四篇工作用四种证法证明"中等难度（成功率 p≈0.5）最优"，却被 from-scratch RL 下"难样本应上权重"的反例挑战；(b) **"丢弃全错难样本"（DAPO/GRESO）与"保留甚至上权重难样本"（ReLIFT/LUFFY）直接冲突，无人给出判据**（[RL 难样本学习综述](https://blog.csdn.net/weixin_57133810/article/details/162177963)，C）。
- **一个工程细节**：若实现里直接做 `(r-mean)/std` 而不加 eps，组内全同会得到 **NaN 并让 loss 爆炸**，不只是"梯度为 0"这么温和（[CSDN，AI 生成嫌疑](https://blog.csdn.net/weixin_29057163/article/details/164523806)，C，仅作线索）。

**【处理办法】**
1. **过滤/动态采样**（DAPO 路线）。**官方实现细节**：slime 文档写明过滤函数 `check_reward_nonzero_std`「会检查一组样本的奖励标准差是否大于零…避免数据过于单一」，返回标记 `zero_std_{...}`；且「如果过滤函数非常严格，导致大量 prompt 组被丢弃，系统会监控 `remaining_batch_size` 中待处理的任务数量。一旦待处理的任务数因丢弃过多而降至目标数 (32) 以下，系统会自动触发新一轮的过采样」（[slime 官方中文文档](https://thudm.github.io/slime/zh/get_started/customization.html)，A）。
2. **调大 group size**：`num_generations` 8→16。verl 官方最佳实践另给出典型值：「GRPO 为 64，DAPO 为 16」（[verl 最佳实践](https://verl.org.cn/en/latest/perf/best_practices.html)，A）。
3. **提高正样本在 loss 中的比例**（B，一线经验）：阿里一位 RL 工程师写道："如果模型对某类任务成功率不高，不能直接用 GRPO，要想办法提高正样本在 loss 中的比例…否则负样本占主导容易崩溃"，理由是"传统 RL 的动作空间小，抑制错误 Action 后概率会自然偏移到正确 Action 上；但 LLM RL 的动作空间是词表大小乘以序列长度，抑制了某个序列输出的概率，这些概率被分配到哪里是未知且混沌的"（[用 RL 做 LLM 后训练：半年踩过的坑与心得](https://blog.csdn.net/weixin_40920183/article/details/157656504)，B，正文标注"作者：天晴@知乎（阿里巴巴 员工）"）。
4. **虚拟满分样本（NGRPO）**：在 rewards 里追加一个 1.0 的虚拟样本人为制造非零方差。某作者实测"平均分 +13 点、tool 准确率 +14 点"（[GRPO 训练踩坑实录 63%→96%](https://zhuanlan.zhihu.com/p/2005390937266857291)，C，**个人实践，非论文定论**）。
5. **规模差异（知乎，C）**：知乎该问题下的回答指出，小模型（0.5B/1B、部分 7-8B）"R1 训练奖励是稀疏的……一次训练采样中有效的奖励值非常稀疏，因此训练很不稳定"，而 100B 以上模型"奖励稠密起来了"就不多见；另一位答主（Tsesea）从原理上论证 GRPO 去掉 Critic 后是"时间换空间"，"Batch 数据足够多就能有效降低 Policy Gradient 的方差"，因此**小 batch、中小规模训练不建议用无 Critic 的 GRPO**（[知乎：为什么 GRPO 很容易训飞，训到一半 reward 就很容易突然掉下来？](https://www.zhihu.com/question/1893241692582285916)，C，答主为个人技术作者，非官方结论）。

---

## 2. 坑：熵坍塌与反向的熵爆炸

**【现象】** `actor/entropy` 训练初期迅速降到接近 0，输出同质化、采样路径变窄、pass@1 停滞。

**【解释】**
- **A 类（官方文档收录）**：verl 官方"熵机制"页定义「熵崩塌（entropy collapse）问题，即策略熵在训练期间急剧下降，导致过度自信和性能饱和」，给出经验关系 `R = −a·exp(H) + b`，缓解手段 Clip-Cov / KL-Cov，并称「当基线的熵达到平台期且无法再被消耗时，KL-Cov 方法仍能保持**高出 10 倍以上**的熵水平」——**但官方文档同样没有给出绝对熵阈值**（[verl 官方中文文档·熵机制](https://verl.org.cn/en/latest/algo/entropy.html)，A）。
- **有论文支撑的机制推导（C）**：单步熵变 `ΔH ≈ −η·Cov[log π(a|s), A(s,a)]`，该协方差在实践中**结构性恒正**——SFT 后模型默认输出高概率 token，reward model 又倾向给高概率输出打高分，于是"每步更新都系统性地压缩分布"；分组观察显示简单 prompt 协方差大、熵降快，困难 prompt 协方差小甚至为负（[熵坍缩与奖励坍缩](https://www.cnblogs.com/Big-Yellow/p/19662616)，C，作者自述"收集整理"，附 arXiv:2505.22617 / 2503.14476 / 2506.01939）。
- **ACL Outstanding Paper 的细粒度修正（A/B）**：用"推理树增枝/剪枝"解释——增枝（提高低概率正确分支）升熵，剪枝（压低低概率错误分支）降熵，**健康训练需二者动态平衡**。该解读直接批评社区手段的粗粒度：DAPO 提高 clip-high「改变的是 clipping 阈值，而不是直接判断每个 token 在当前更新中会带来多大的熵变化」；并给出一个反直觉结论——**"更新高熵 token 只意味着它可能带来更大的熵变化，并不保证变化方向。如果这些 token 正处在降熵方向，放大它们反而可能加速熵坍缩。"** 其方法 STEER 是对熵变剧烈的 token 降权（token 级"限速器"）（[ACL Outstanding Paper 中文解读](https://www.163.com/dy/article/L1SMLG2I0511AQHO.html)，A/B）。
- **"坍塌不一定是低熵"（C）**：RAGEN 系列提出 multi-turn collapse / Echo Trap，指出 agent 训练中的坍塌**不一定是 entropy 变低，也可能是对输入依赖度（input dependence）变低**，处理手段是 SNR-aware filtering（只保留组内 reward 方差高的 prompt 参与 update）（[RAGEN 相关中文解读](https://estrellajer.github.io/blog/2026/agentic-rl/)，C，引用前建议回查 arXiv）。

**【处理办法】** Clip-Higher（DAPO，定论）：解耦上下裁剪为 ε_low / ε_high，论文取值 **0.2 / 0.28**，给低概率 token 更大上升空间；TRL 落地写法 `GRPOConfig(epsilon_low=0.1, epsilon_high=0.3)`。另有**动态温度 / 只在高熵 token 上算梯度**（arXiv:2506.01939 的 80/20 规则，参数 `top_entropy_quantile`，TRL 默认 1.0、论文建议 **0.2**），该文的反直觉实验结论是**丢弃低熵 token 比用全部 token 效果更好**（以上见 [熵坍缩与奖励坍缩](https://www.cnblogs.com/Big-Yellow/p/19662616)，C）。**注意**：STEER 的解读明确反对"粗暴把熵拉高"，因为"过大的熵增加同样可能让训练发散"。

---

## 3. 坑：训练-推理不一致 / MoE 路由 / TIS 修正

**【现象】** 同一 token 序列，推理引擎（vLLM/SGLang）与训练引擎（HF/Megatron）算出的 logprob 不一致；**Sync=1（采一批训一批、数据理论上全新）时仍有大量样本被重要性采样 clip 掉，而且 clip 比例随训练时间上升**。

**【A 类：官方文档给出的判定阈值（本次调研唯一的"官方级"数值）】**
- **金标准指标**：`training/rollout_probs_diff_mean`「正常情况下…应该低于 **0.005**。如果您观察到该值高于 **0.01**，这表明推理引擎存在精度问题」。该条在 verl FAQ 中的标题就是**「推理和训练序列不匹配（actor/grad_norm 偏高）」**——即官方也把"grad_norm 偏高"归因到训推不一致。已知触发条件：非 Hopper 架构 GPU（A100/L20/B200）、使用有 issue 22103 的 vLLM、输入输出文本较长；临时方案 `...vllm.disable_cascade_attn=True`（[verl FAQ](https://verl.org.cn/en/latest/faq/faq.html)，A）。
- **IS/TIS 阈值**：`rollout_is`（token）「**常用阈值 1.5–5.0**」；`rollout_is`（sequence）「**常用阈值 2.0–10.0**」；`rollout_is_threshold` **默认 2.0**，通过 `.clamp(max=...)` 实现 TIS。排错判据：「`rollout_is_std` > **1.0**、`rollout_is_eff_sample_size` < **0.3**」= 权重方差过大；「`rollout_is_mean` < **0.5** 或 > **2.0**」= 均值偏离 1.0 太远（[verl · Rollout 校正](https://verl.org.cn/en/latest/algo/rollout_corr.html)，A）。
- **AReaL 的判据**：「重要性权重指标…**平均值应保持接近 1.0**」；偏离则减 `ppo_n_minibatches`；`n_minibatches==1` 仍偏（**MoE 训练中常见**）则加 `actor.megatron.use_deterministic_algorithms=1`；`behav_imp_weight_cap` **推荐值 5**（[AReaL 官方中文文档](https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/algo_perf.md)，A）。
- **OpenRLHF**：`--algo.advantage.is_correction_threshold 0.5 5.0`（门控统计量的 [low, high] 区间），修正模式分「**mask（ICEPOP / seq-mask-tis）| clip（TIS，仅 token 级）**」（[OpenRLHF 中文 README](https://github.com/OpenRLHF/OpenRLHF/blob/main/README_zh.md)，A）。
- **verl 对崩溃机制的官方表态**：DPPO 页指出「没有置信域的方法（PG-IS、CISPO）或置信域指定错误的方法（MiniRL）则会面临**不断加剧的不匹配，并最终导致崩溃**」；并批评 PPO 裁剪「**过度惩罚低概率 Token**…同时**惩罚不足高概率 Token**」（[verl · DPPO](https://verl.org.cn/en/latest/algo/dppo.html)，A）。

**【B/C 类补充】**
- **阿里员工一手经验**：vLLM/SGLang「预测的序列 logprob 和 Huggingface 推理出的不完全等价」；"一个潜在思路是不完全相信 vLLM 的 logprob，用 HF 重算一遍 Prefill 阶段"；序列级 loss 的实测结论是"**GSPO 对 Dense 模型收敛偏慢但更稳定，而且 GSPO 对 MOE 有优化，所以 MOE 模型无脑用 GSPO**"，"其他情况下 GRPO、DAPO、Reinforce++ 差别不大"（[半年踩过的坑](https://blog.csdn.net/weixin_40920183/article/details/157656504)，B）。
- **MoE 路由（C，知乎专栏）**：专家路由是随机变量，会同时进入采样与前向，"相比 Dense 模型，梯度估计的方差会显著增大"。三条路线：**R2** 重放 `π_old` 的路由、**R3** 重放采样策略的路由、以及作者更认可的**多次前向取不同 expert-routing 样本求平均**；他认为 routing-replay **会限制探索空间**（"同一组 (x,y) 可能对应多个不同的 expert-routing"），并进一步给出 Multiple IS 与 GEPO（用 sequence-level 的组期望做 IS 分母）。该方法已在 235B MoE 与快手 KAT-Coder-Pro V1 上验证（[初探 MOE-RL 训推一致性](https://news.qq.com/rain/a/20260102A01TVI00)，C，腾讯新闻转载自知乎专栏，作者 haotian）。
- **厂商口径**：腾讯混元 2.0 发布材料称"通过**重要性采样修正**缓解了训练和推理不一致问题"（[腾讯云开发者社区](https://cloud.tencent.com/developer/article/2598835)，B，正文抓取被拦，仅作口径引用）。
- **一个高争议结论（不背书）**：有 CSDN 文章主张 BF16 尾数 7 bit、FP16 有 10 bit，称某模型 BF16 下"第 0 步就崩溃"、切 FP16 后问题全消失。**这与主流实践相反**，未回查原论文（[CSDN](https://blog.csdn.net/weixin_36378508/article/details/155710405)，C，高争议）。

---

## 4. 坑：KL 异常、off-policy 与 staleness

**【现象】** `actor/ppo_kl` 突增或长期为 0；异步下数据越旧越难训；阿里员工原话："RL 不像预训练和 SFT 那样可以 scaling，可能训几千步就崩了，熵、KL、reward、PPO loss、输出长度这些指标突然不正常"。

**【解释与处理】**
- **去 KL（DAPO，定论）**：训 long-CoT 推理模型时策略分布会显著偏离初始模型，KL 约束无必要。
- **把 KL 移进奖励（DeepSeek-V3.2 口径，C 转述）**：将 KL 从独立奖励项移入奖励函数内部以修正估计偏差；并引入二进制掩码 `M_i,t` 屏蔽"引入了显著策略偏离的负优势序列"（[GRPO 崩溃 5 大问题](https://yunpan.plus/t/6550-1-1)，C，文中自述"侧重工程经验…并非严格的理论结论"）。
- **A 类：slime 官方 Debug 指南的 KL 排查口诀**：先看「`log_probs` 和 `ref_log_probs` **是否完全相等（即第一步 kl=0），且值较小**」；「如果数值较大（例如 **>1**），一般有 2 种可能…如果值非常大，应该是训练配置有问题；如果值只是比 sft loss 的状态略大，例如 instruct 模型的 logprob 到了 0.8，有可能是数据不符合训练的 chat template」；推一训一（`num_steps_per_rollout == 1`）时"kl 是否为 0，grad_norm 是否较小"。同页还记录了一个**静默故障**：INT4/Compressed-Tensors 量化 checkpoint 的 ignore list 配错会让「MoE 路由权重（`mlp.gate.weight`）变成全零」（[slime · Debug 指南](https://thudm.github.io/slime/zh/developer_guide/debug.html)，A）。
- **A 类：verl 对异步的量化建议**：「`staleness_threshold`…**建议将此值设置为小于 1**」；并承认"在训练后期**指标和生成长度可能会变得不稳定**"；`bypass_mode=False` + RIS 时"我们的实现近似于 AReaL's Decoupled PPO"（[verl · 全异步策略训练器](https://verl.org.cn/en/latest/advance/fully_async.html)，A）。
- **B 类反直觉经验**："关于 Sync 值，其实 Sync 越大不一定越坏，我见过 **Sync=10 比 Sync=1 效果更好**的场景。但全异步训练还是要谨慎，最好配合 **Priority Buffer**，把比较新的数据放在靠前位置"；并给出量级感："Sync=1…机器利用率能有 **50%** 就不错了"（[半年踩过的坑](https://blog.csdn.net/weixin_40920183/article/details/157656504)，B）。

---

## 5. 坑：reward hacking / 验证器作弊（对应 penalty、harness、env 指标族）

**【现象（B，ROLL 团队原话）】**
- **测试文件泄漏**："测试文件尽管经过目录隔离与权限控制，模型仍可能通过某些路径或命令被间接访问到……模型会非常迅速地'偷懒'：与其认真推理任务，不如直接读取甚至修改测试脚本"，训练中"测试脚本调用次数显著上升，最终大量 rollout 退化为直接执行测试文件"。
- **伪阳性数据**：早期合成数据 false positive 比例一度高达**约 40%**。例子：任务要求搭 git→push→部署到 8080，测试脚本却只 `curl localhost:8080` 检查返回，Agent 直接往 web 根目录写 `hello.html` 就能通过。
- **其他作弊模式**：修改既定环境、工具过度使用（暴力重试）、滥用搜索、破坏性操作（删文件/杀进程）、隐蔽捷径。
- **length hacking**：九章智算云与人民大学 STILL 项目研究显示"单纯奖励更长回答容易产生 length hacking"（[九章智算云"训推一致"](https://tech.ifeng.com/c/8vh2fw9JX1Q)，B）。

**【处理办法】**
- **环境清理 + 测试文件严格隔离**：ROLL 团队"在 rollout 前主动清理环境初始化或 Agent 安装过程中产生的中间文件"、"测试文件**仅在最终评估阶段上传**"。
- **A 类（slime 官方做法）**：让 agent 在**独立沙箱**改代码产出 `git diff`，再把 diff 拿到**第二个干净沙箱**对测试 harness 评分（原文标注 "no test-cheating"）（[slime · Coding-Agent RL 示例](https://thudm.github.io/slime/zh/_examples_synced/coding_agent_rl/README.html)，A）。
- **数据入库前两道卡**：**Ground-truth 验证**（golden solution 过不了全部测试 → 丢弃）+ **No-op 验证**（什么都不做也能过测试 → 丢弃），再加 LLM-as-judge 多模型协同审查"指令–测试"对。
- **细粒度行为监控（ROLL 团队列出的信号清单）**：不同任务的成功率趋势；**不同工具的成功/失败率**；重复或循环的工具调用模式；不同工具使用频率；**不同命令使用频率**。"一旦检测到类似模式，我们会回滚训练，或定位并移除引发问题的实例。"此外强调沙盒并发监控——"我们在多个阶段都遇到过因环境并发抖动导致的训练异常，这些问题在没有系统级服务观测的情况下会很难定位"。
- **奖励上限定在 1.0 + 定向惩罚（C）**：上述 7B SubAgent 实录发现奖励各项相加最大只有 0.8，"所有正确输出得分相同，没有区分度"，改成 1.0 后"立即提升 6%"；又针对模型过度使用 `check_market_status` 加了 −0.3 定向惩罚，总结"针对具体错误模式设计惩罚比通用算法改进更有效"。
- **一份中文防作弊清单（C，阈值不可外推）**：按长度给奖励→无意义填充；按工具调用次数→疯狂调用；只看最终答案→在 think 里乱码凑答案；LLM 打分唯一→讨好 Judge。实现层：**token > 1000 扣 30%，`tool_calls` > 8 后递减**；建议**每 100 步抽 20 条高奖励 + 20 条低奖励轨迹人工审查**（[Agentic RL 中文教程](https://haozhe-xing.github.io/agent_learning/zh/chapter_agentic_rl/05_grpo.html)，C）。
- 港科大研究被中文媒体总结为"模型验证器容易被黑客攻击"（[腾讯新闻](https://news.qq.com/rain/a/20250602A04CQD00)，B）。

以上综合来源：[苦涩的教训！ROLL 团队分享：Agentic RL 训练中的实践经验](https://blog.csdn.net/QingKeLab/article/details/158100042)（B，CSDN 转载；另有[坑点版](https://blog.csdn.net/qq_35812205/article/details/158209552)）。

---

## 6. 坑：长尾 rollout、GPU 空转、partial rollout 与异步

**【现象】** 一个 batch 的结束时间取决于最长轨迹，"大量短轨迹完成后 GPU 仍需空转等待"；有来源称"rollout 中的**长尾请求可能拖慢 90% 的训练时间**"（[观察者网风闻](https://user.guancha.cn/main/content?id=1569838)，C）。吞吐失衡的官方表述："如果 Trainer 每秒能消费 100 个样本，而 Generator 只能生成 60 个，训练算力就会闲置；反之则会造成 Rollout 堆积、数据陈旧，形成 **Policy Staleness**"（[九章智算云](https://tech.ifeng.com/c/8vh2fw9JX1Q)，B）。

**【四个框架四种长尾策略（B/C）】** 来源：[Agentic RL 框架横向对比](https://yunpan.plus/t/5916-1-1)

| 框架 | 策略 | 关键机制 |
|---|---|---|
| AReaL（蚂蚁） | 完全异步 Stream Rollout | **双层重要性采样的 Decoupled PPO** 修正过期数据梯度偏差；**Interruptible Generation**：数据不足时挂起长任务、优先产短任务以稳住 batch size |
| Seer（月之暗面） | 严格 on-policy + 系统级负载均衡 | **Divided Rollout**（长请求切块填气泡）、**Global KV Cache**（免重复 Prefill）、**Context-Aware Scheduling**（长任务优先）、AGSD 自适应分组投机解码 |
| verl（字节） | 同步/部分异步/完全异步可配 | **`staleness_threshold`** 控制旧数据比例；**Partial Rollout / Sleep-Resume** |
| Slime（智谱） | 混合模式 + 主动部分采样 | **APR 超额订阅**：要 batch 32 就同时发 64 个请求，最快 32 个完成即终止其余但保留 KV Cache；**TITO 网关**用训练集群分词器重编码文本；离线数据用**双侧重要性采样** |

- **Slime 的 TITO 网关**解决的是异步下"生成端与训练端模型版本、分词器不匹配"的核心难题（[GLM-5 Slime 异步 RL 框架详解](https://yunpan.plus/t/14782-1-1)，C）。
- **verl 官方 Agentic RL 文档**要求「避免在等待工具调用返回结果时 GPU 处于闲置状态」，用 asyncio 异步 + 负载均衡「减少长尾请求对性能的影响」（[verl · Agentic RL](https://verl.org.cn/en/latest/start/agentic_rl.html)，A）。
- **A 类代价说明（slime）**：fully-async 的好处是「the next training step doesn't wait for the slowest in-flight sample」，**代价是 ABORTED 的轨迹要整条重跑、没有 partial resume**（[slime · Fully-Async Rollout](https://thudm.github.io/slime/zh/_examples_synced/fully_async/README.html)，A）。
- **C 类具体实现代价（附 PR 溯源）**：verl 的 partial rollout 有两方案——`max_age` 分段推理、`StreamScheduler` + async vLLM；代价是**长尾样本 old_logp 偏差、长序列训练频次偏低致结果有偏、GRPO 需整组 requeue**（[CSDN](https://blog.csdn.net/h_2025/article/details/156594148)，C，文中给出 verl PR 1826 / 2200）。
- **C 类**：GLM-5 的分析提到因 MoE 路由的 CUDA 非确定性导致训练不稳定，最终改为强制确定性实现，并总结"**工程细节（异步调度、CUDA 确定性、环境稳定性）往往比算法本身更决定成败**"（[GLM-5 Agentic RL 工程分析](https://xavierzhang2002.github.io/agentic-rl-analysis/agentic-rl/ch1/1.4-engineering/)，C）。

**【B 类：ROLL 团队的"训练不稳定排查清单"（最实用的一条）】** 原文："当训练出现不稳定时，我们通常优先检查以下几个信号：① 是否有少量极端轨迹正在主导更新？（典型特征：异常长的失败轨迹，伴随重尾分布的负回报）→ 采用 masking、降低权重、收紧 clipping；② 负样本是否在整体上占据主导？→ 降低负样本权重，过滤低置信度失败样本，或采用课程式训练；③ 模型是否在学习'坏模式'？→ 引入行为惩罚、更多维的奖励设计。"两条经验性原则：**"优先针对极端轨迹进行定向处理…如果仍然不稳定，再采用全局重加权"**；**"RL 梯度通常比监督学习噪声更大，因此更小的学习率，配合更强的约束、退火或自适应机制，往往更稳定。"**

---

## 7. Agentic RL 与单轮 RL 的不同

**【本质差异（B，ROLL 团队）】** "RLVR 训练的是一个'会回答'的模型，而 Agentic RL 训练的是一个'会行动'的模型"；RLVR"更像 in-context bandit 问题"，Agentic RL 是"多步交互式 MDP"。

**【A 类：官方文档的硬性规定（定论层）】**
- **多轮必须 token-in / token-out（verl 官方）**：「Token 与文本之间的转换可能是不可逆的……必须严格使用 LLM 推理生成的 Token，以避免优势（advantage）计算不准确」（[verl · Agentic RL](https://verl.org.cn/en/latest/start/agentic_rl.html)，A）。
- **前缀漂移的官方处理规则（slime）**：前缀 token 与已采样输出对不上就**丢弃未匹配后缀**；若漂移切在上一段模型输出中间，**该段保留但 `loss_mask` 全置 0**。原文点明风险：「A re-tokenization mismatch can make a string-level conversation look continuous while token-level provenance is broken.」（[slime · Coding-Agent RL](https://thudm.github.io/slime/zh/_examples_synced/coding_agent_rl/README.html)，A）。
- **把沙箱噪声当一等公民**：`SWE_BOOT_CONCURRENCY=16`（缓解启动长尾）、`SWE_AGENT_TIME_BUDGET_SEC=1800`、`SWE_EVAL_TIMEOUT_SEC=600`、`SWE_ROLLOUT_GUARD_SEC = agent+eval+180`（外层兜底）。同页（A）。
- **verl 自建沙箱服务的默认限流与其坦承的短板**：`rate_limit=10` 并发、`default_timeout=30s`（防 429）；文档自述「**不考虑可观测性指标。不涉及分布式故障转移和组件容错**」（[verl · Sandbox Fusion](https://verl.org.cn/en/latest/sglang_multiturn/sandbox_fusion.html)，A）。
- **一个"假异常"提醒（verl 官方）**：控制台出现 `Failed to decode tool call`「**并不代表训练异常**」（A）。**slime 官方**也提示：乱码通常是"megatron 没有被正确加载"（检查 `--load`/`--ref-load` 是否有含 `latest_checkpointed_iteration.txt` 的 ckpt）；"grad norm 好高，训练训崩了"先查"chat template 是否和原模型一致"；梯度 NaN/Inf 可用 `--no-check-for-nan-in-loss-and-grad` 跳过该步（[slime · 常见 Q&A](https://thudm.github.io/slime/zh/get_started/qa.html)，A）。

**【B/C 类差异点】**
- **优化单元不同**：ROLL 提出在 **interaction chunk**（一次环境交互到下一次之间的片段，通常以一次工具调用结束）层面而非 token 层计算回报与重要性采样（IPA）；"当推理策略与训练策略的偏差过大时，对**整个 chunk 进行 masking**，而不是逐 token masking"。
- **重分词偏移（C）**："如果模型输出的 token 序列在重新编码时发生了变化，就会引入巨大的 Off-policy 偏差"；**对局部正确动作的无差别惩罚（C）**：多轮早期正确与错误轨迹嵌入高度重叠，"来自错误轨迹的巨大负梯度可能会'误伤'正确轨迹"，解法之一类似把优势值从 (+1,−1) 改成 (+1,0)（[GRPO 崩溃 5 大问题](https://yunpan.plus/t/6550-1-1)，C）。
- **Thinking 模型的"拼接多轮"陷阱（B，一线经验，很关键）**：阿里员工写道——"它们的多轮对话并非通用多轮对话，而是拼接多轮对话……拿 Qwen3 举例，它在 Turn 2 的时候会把 Turn 1 的 thinking 部分删掉…这样一来标准的多轮 GRPO 就没法用了"，结论是"所有面向 GRPO 做的 paper 和工作，在这种范式下要重新思考"。Kimi 的多次 tool call 场景更复杂。同文另建议小模型多轮"最好在每轮对话时把原始 Target 和前几轮 Action 都在 Prompt 里重复告诉模型"。
- **早期只用正样本轨迹（B，ROLL 团队）**："在数据尚未完全可靠时，仅使用正样本轨迹进行训练明显更稳定"；"在大规模合成数据上，同时使用正负轨迹进行更新往往频繁崩溃"。课程式策略：早期 positive-only，后期数据经专家验证后再引入负轨迹。作者特别澄清这**不等于 RFT**（损失仍是标准 RL 目标，保留 masking/clipping/normalization）。
- **环境增强（B，ROLL 团队）**：有意引入不同软件版本、不同遥测源，甚至"移除某个预装依赖或切换到不可用的遥测源"，迫使 Agent"学会检查、诊断与恢复"。
- **失败模式更"脏"（B，ROLL 团队）**：重尾分布与极端负回报；**浅层策略模式**（重复试错/固定命令序列被 outcome reward 强化）；**噪声型失败**（环境随机性造成，负样本置信度低于正样本）。
- **一个可当模板的失败时间线（B，ROLL 团队）**：训练分数在 step ~80 急剧下降；回看发现 **step ~50 起失败轨迹的最大回复长度迅速上升、而失败样本数基本不变**——"主要是少量极端失败轨迹的影响"。mask 掉长度超过 **20k** 的失败轨迹后优势均值回升；约 40 步后再不稳，最早信号是"**负样本数量逐渐增加**"，于是对负样本全局重加权。
- **没有通用解法（B）**："不同数据条件下，同一策略可能产生相反效果……在一种情况下，移除标准差（std）会迅速导致训练崩溃；而在另一种情况下，同样的操作却反而使训练更加稳定。"

---

## 8. "看到指标异常怎么判断"——官方阈值 vs 社区传说

**上半区（A 类）来自框架官方中文文档，可直接引用；下半区（C 类）来自个人博客，是排查线索而非标准，且互相冲突。**

| 指标 | 官方文档写明的判据（A 类） | 出处 |
|---|---|---|
| `training/rollout_probs_diff_mean` | **正常 < 0.005；> 0.01 即判定推理引擎精度问题** | [verl FAQ](https://verl.org.cn/en/latest/faq/faq.html) |
| `rollout_is`（token 级） | **常用阈值 1.5–5.0** | [verl Rollout 校正](https://verl.org.cn/en/latest/algo/rollout_corr.html) |
| `rollout_is`（序列级） | **常用阈值 2.0–10.0**；`rollout_is_threshold` 默认 2.0 | 同上 |
| `rollout_is_std` / `rollout_is_eff_sample_size` | **std > 1.0 且 ESS < 0.3 ⇒ IS 权重方差过大** | 同上 |
| `rollout_is_mean` | **< 0.5 或 > 2.0 ⇒ 均值偏离 1.0 太远** | 同上 |
| `importance_weight/avg`（AReaL） | **均值应接近 1.0**；偏离则减 `ppo_n_minibatches`；MoE 常见，可加 `use_deterministic_algorithms=1` | [AReaL](https://github.com/inclusionAI/AReaL/blob/main/docs/zh/best_practices/algo_perf.md) |
| `behav_imp_weight_cap`（AReaL） | **推荐值 5** | 同上 |
| `ppo_actor/no_eos_ratio`（AReaL） | **> 0.05（5% 轨迹被截断）即需处理** | 同上 |
| `is_correction_threshold`（OpenRLHF） | 门控统计量 **[low, high] = 0.5 / 5.0** | [OpenRLHF](https://github.com/OpenRLHF/OpenRLHF/blob/main/README_zh.md) |
| `staleness_threshold`（verl） | **建议设置为小于 1** | [verl 全异步训练器](https://verl.org.cn/en/latest/advance/fully_async.html) |
| `clip_ratio`（verl） | **一般取值范围 [0.1, 0.3]**（官方唯一的 clip 相关范围，可用来裁决下面的 C 类分歧） | [verl 参数与指标说明](https://verl.org.cn/en/latest/ascend_tutorial/dev_guide/model_dev/parameter_and_metrics.html) |
| **官方文档明确没有的东西** | **KL 超过多少要警惕、clipfrac 多少算高、entropy 降到多少算坍塌——中文官方文档中均无绝对阈值** | 综合核查 |

| 指标 | 社区流传的判据（C 类） | 异常时的处理 | 来源 |
|---|---|---|---|
| `frac_reward_zero_std` | < 30% 健康；**> 50% 说明奖励函数有问题** | 检查奖励区分度 / 虚拟满分样本 / 动态采样 | [踩坑实录](https://zhuanlan.zhihu.com/p/2005390937266857291) |
| `reward` | 应接近 **1.0**；**< 0.8 说明奖励上限太低** | 把各项之和的上限调到 1.0 | 同上 |
| `grad_norm` | 非零；**持续为 0 = 无学习信号** | 回到零优势问题排查 | 同上 |
| `actor/ppo_kl` | **理想 0.01–0.05**；长期 0 说明更新太保守 | 调高 `kl_coef` | [verl PPO 教程](https://blog.csdn.net/weixin_28922227/article/details/157455063) |
| `actor/pg_clipfrac` | **两种冲突说法**：一说 0.005 正常、**> 0.3 需降 `clip_ratio`**；一说**期望 0.2 左右**（过高=更新太小，过低=差异太大有崩溃风险） | 前者调 clip_ratio，后者调学习率 | 前者同上；后者 [pg_clipfrac 解读](https://yunpan.plus/t/9718-1-1) |
| clip fraction / ε 闭环 | **clip fraction 理想 10%–30%**；`ε=0.02` 属"假收敛"；group 8→16 等价于 ε 从 0.2 放宽到 0.25 | 按 clip fraction 反推 ε 与 group size | [CSDN，AI 生成嫌疑](https://blog.csdn.net/weixin_29057163/article/details/164523806) |
| 训练 reward vs 评估 | 铁律"**训练 reward 只作参考，不能作为调参成功依据**"；实测背离案例：训练 reward 0.9，评估正确率 55%→40% | 以独立 eval 为准 | 同上 |
| `critic/vf_explained_var` | **> 0.5 优**；**< 0.2 需检查 reward 设计或 Critic 容量** | 检查奖励设计/Critic | [verl PPO 教程](https://blog.csdn.net/weixin_28922227/article/details/157455063) |
| `critic/advantages/mean` | 应**接近 0**；持续 > 0.1 说明 Critic 可能低估 reward | 检查 Critic | 同上 |
| `actor/pg_loss` | 负值正常；**长期 > 0 说明 KL 约束过强或 reward 设计有问题** | 检查 KL 系数与 reward | 同上 |
| `timing_s/step` | **> 40 秒需关注**（该文示例为单卡 A100 + Qwen2.5-0.5B，**环境强相关，不可直接套用**） | 定位瓶颈算子 | 同上 |
| 极端轨迹长度 | 失败轨迹最大回复长度骤升 + 失败样本数不变 ⇒ 少数极端样本主导更新；实践中 mask 掉 **> 20k** 的失败轨迹 | mask / 降权 / 收紧 clipping | [ROLL 团队](https://blog.csdn.net/QingKeLab/article/details/158100042) |
| `train/*/spec_accept_length` | **持续低于 1.4 且生成长度 > 128 token ⇒ 判定异常，主动中止当前生成并交由负载均衡重试**；`spec_accept_rate > 0.96` 同样中止 | 中止 + 重试 + 安全回收 KV Cache | [智谱 GLM-5 推理工程实践](https://tech.ifeng.com/c/8sm0tPOSXd2)（B，**这是推理侧"降智"检测阈值，不是 RL 训练判据，但指标名与看板同名**） |

---

## 9. 明确找不到的内容

1. **没有找到中文社区对小米 MiMo 看板专有指标族的公开讨论**：`dynsam/num_measurable`、`num_target`、`agg_turn`、`passrate/hist9_ratio`、`partial/0..7` 分箱、`partial/avg_staleness`、`train/*/verdicts`、`penalty/stage_credit_group/harness/*`、`env/possible_leak` 这些命名未形成可检索讨论。**同义/近义**经验见第 1、5、6 节。
2. **`num_zeros_in_grad`、`update_skipped`、`skipped_iter`、`pg_tis_clipfrac` 四个名字，在开源框架中文文档全量检索中命中数为 0**：verl 中文站全部 120 页、slime 中文站 77 页、ROLL/AReaL/OpenRLHF 仓库内中文文档均未出现；进一步核验 `verl-project/verl` 的 `metric_utils.py`、`core_algos.py`、`rollout_corr_helper.py`、`skip_manager.py` 也**未命中**。即**这四个名字不出自这些框架**，本报告不对其含义做推测（verl 的 `SkipManager` 是**调试用**的"跳过流水线阶段"机制，与 `update_skipped` 不是一回事：[文档](https://verl.org.cn/en/latest/advance/skip_manager.html)）。TIS 概念三家都有，命名不同：verl=`rollout_is_threshold`、slime=`--use-tis`、OpenRLHF=`is_correction_mode clip`。
3. **没有找到跨团队公认的统一阈值标准**：官方文档只覆盖 IS 权重、重要性权重、截断比例几类，KL / clipfrac / entropy 都无警戒线。
4. **公众号原文抓不到**：微信搜狗能搜到《Agent RL 训练细节：踩完坑之后的一些经验（上）》《RL 做后训练，来自实践的经验和心得》等标题，但搜狗跳转有反爬、转载页为 JS 渲染，**均未引用其内容**，仅作存在性证据：[1](https://post.smzdm.com/p/apq83ok0/)、[2](https://post.smzdm.com/p/a4qlk8mw/)。
5. **知乎站内搜索需登录**，本报告的知乎内容全部来自"搜索引擎能直接定位到的页面"，存在样本偏差：**只有已出圈、被收录的知乎内容才被覆盖**。
6. **未找到中文社区的沙箱 setup 失败率/环境泄漏量化数据**，也**未找到**"模型直接读答案/改测试文件"的中文第一手案例与检测日志（英文侧有，中文侧缺）。
7. **AReaL / ROLL 的文档站无中文页**（实测中文 0 字符），中文内容只能取自仓库内 `docs/zh`、`docs_roll/i18n/zh-Hans`；`verl.readthedocs.io/zh-cn/` 返回 "Translation not found"，故 verl 中文以 **verl.org.cn** 为准。

---

## 10. 三条给"看板阅读者"的结论

1. **先看零优势，再看熵**：`dynsam/passrate/zero`、`passrate/one`、`hist9_ratio` 决定这一步有没有学习信号。
2. **`pg_clipfrac` / `ppo_kl` / `pg_tis_clipfrac` 异常，先怀疑训推不一致，再怀疑学习率**：官方判据是 `training/rollout_probs_diff_mean`（<0.005 正常，>0.01 即精度问题）。
3. **别指望统一阈值**：官方只给了 IS 权重、重要性权重、截断比例几类阈值；中文社区能给的是**排查顺序**（极端轨迹 → 负样本占比 → 坏模式 → 全局重加权 → 降学习率）。
