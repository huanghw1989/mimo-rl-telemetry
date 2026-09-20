Luo Fuli, head of Xiaomi's large model team (former core researcher at DeepSeek), has made public the full ongoing **MiMo-V2.6 (including the Pro and Flash versions)** reinforcement learning (RL) training process, and launched the world's first **public live dashboard for large-model training (Live RL Dashboard)**, “live-streaming” to the community in real time the model's training steps, reward curves, Token consumption, software/hardware failure notifications, and cumulative bill.

Luo Fuli said that over the past half year the team has been tackling "**how far reinforcement learning can actually scale (Scaling RL)**", and is scaling in three directions: compute resources (about 2 billion tokens per step, 1568 prompts × 16 rollouts running asynchronously), task environment (multi-task Agentic RL), and evaluation compute (Grader Compute / intra-group credit assignment). They promise to gradually open-source model details and weights in the coming weeks.

This “transparent live-streamed training” operation triggered enormous shockwaves and discussion in domestic and international developer circles, academia, Hacker News, and Reddit (such as r/LocalLLaMA), mainly focusing on the following dimensions:

---

### 1. Widespread praise and spectating of “unprecedented engineering transparency”
* **Breaking the industry black box and beautified reports**: Previously, frontier labs typically only presented carefully selected Loss curves and smoothed Benchmark scores in technical reports. By contrast, MiMo-V2.6 directly posts such real industrial-grade challenges as **out-of-memory (OOM) restarts, data pipeline infrastructure errors, step rollbacks, and periodic drops in evaluation scores** without concealment in real time on the bulletin board.
* **Hailed by scholars as the "gold mine" of large-scale RL**:
  * AI researcher **Nathan Lambert** calls it one of the coolest large-scale reinforcement learning resources made public to date;
  * Associate professor at the University of California, San Diego (UCSD) **Yu-Xiang Wang** says outright that he “couldn’t look away,” and calls on the Xiaomi team to be sure to fully document and make public all the engineering pitfalls and failure-handling experience encountered along the way;
  * A large number of RL practitioners regard this as a rare industrial-grade distributed asynchronous reinforcement learning live open class.

---

### 2. Compute consumption and the banter and technical estimates around the “money-burning speed”
* **The visual impact of “burning a car per hour”**: the bill ticking in real time on the dashboard quickly went viral. Combined across the Pro and Flash lines, the training cost exceeds **$30,000 per hour** (equivalent to more than 200,000 RMB per hour), consuming over one million and even two million USD within days.
* **Banter from industry heavyweights**:
  * Jina AI founder **Han Xiao (肖涵)** joked: “You should send this GIF to the CFO; definitely don’t let the CFO see it”;
  * Meta/former OpenAI researcher **Lucas Beyer** reposted and jokingly summarized that Luo Fuli’s so-called three expansion dimensions translate to: “compute, compute, and still compute.”
* **Compute-scale estimate**: Based on 2 billion tokens per step and asynchronous throughput, industry estimates suggest that the training decode side alone may occupy **6,000–8,000 H100-equivalent compute cards**, while simultaneously maintaining more than 60,000 active concurrent code-execution sandbox environments.

---

### 3. Geeky breakdown of the core technical details of Agentic RL
* **Long-horizon reasoning and context fluctuations**: Former Cornell professor and Cursor participant **Sasha Rush** joked that he stared at the training logs like “a gambler watching the market,” and raised discussion and curiosity about the sharp jump in the model’s generation length from 80k to 120k on coding tasks.
* **Asynchronous pipeline (Fully Asynchronous Pipeline)**: Developers are highly focused on its fully asynchronous design for rollout generation, environment feedback execution, reward scoring, and parameter updates, believing that this architecture effectively avoids idle waste in the GPU cluster caused by long-tail latency of small-batch samples.
* **Heavy grading (Grader Compute) and credit assignment**: The community is hotly discussing the in-group credit assignment (In-group Credit Assignment) it introduces for multi-step Agent tasks, and why it uses a dynamic sampling data-mix mechanism to filter out “all-correct” or “all-wrong” samples that contribute no gradient.

---

### 4. Controversy, skepticism, and sober reflection in the community
* **Does training while testing lead to “leaderboard overfitting”**: On Hacker News and Reddit, some engineers raised concerns about whether continuously running benchmarks such as DeepSWE v1.1 during training could introduce into the reward model or sampling strategy a potential risk of “overfitting (Reward Hacking / Benchmark Overfitting)” aimed at the evaluation set.
* **Traces of distillation and the boundary of autonomous scaling**: Some sharp-eyed developers, while scraping dashboard data or front-end code, pointed out guesses about certain hidden fields such as `Claude Distill`, sparking a debate over “how much pure autonomous exploration there is in this long-horizon agentic reinforcement learning and how much distillation capability from top commercial models it has absorbed.”
* **Local playability and deployment concerns**:
  * In open-source on-device communities such as r/LocalLLaMA, many users said that although watching is very entertaining, given that MiMo’s top-tier models have parameter scales of hundreds of billions or even trillions, individuals or small and medium-sized teams simply cannot deploy them locally on consumer-grade hardware, and ultimately still need to rely on APIs;
  * There is also a view that this is both a hardcore technical evolution and a high-profile technical PR and team brand-building effort; a big rise in training scores is one thing, but whether it can ultimately translate into high retention and commercial recognition for developer tools such as MiMo Code still awaits the real test after the open-source release.

---

**Summary**: The public training of MiMo-V2.6 is generally regarded in the community as **a radical attempt to move from “code open-sourcing” to “open-sourcing the observability of the training process”**. On the one hand, the community highly recognizes its confidence and transparency in showing engineering setbacks in real time; on the other hand, it is also closely watching the open-source code, environment Harness, and weight details it is about to deliver in a few weeks.

------

To infer the compute investment in the ongoing reinforcement learning (RL) phase of **MiMo-V2.6** (the Pro and Flash versions), it is necessary to combine the underlying engineering metrics disclosed by Xiaomi’s official training monitoring dashboard (Dashboard) and standard large-model computation formulas, and perform cross-estimation from three dimensions: **“theoretical model effective computation (Model FLOPs)”**, **“actual hardware cluster consumption (Hardware FLOPs)”**, and **“the full-system pipeline of asynchronous reinforcement learning”**.

---

### 1. Collection of core basic data (from official disclosures and architecture whitepaper)

Based on the training parameters and real-time monitoring data publicly disclosed by the Xiaomi MiMo team:

1. **Model parameter architecture**:
   * **MiMo-V2.6-Pro**: Continues the previous generation’s trillion-scale MoE architecture, with total parameters of about **1.02T** (10,200 hundred million), active parameters per token $P_{\text{active}} \approx \mathbf{42B}$ (70 layers, Top-8 expert routing, sliding window SWA + global hybrid attention).
   * **MiMo-V2.6-Flash**: total parameter count **309B**, active parameters per token $P_{\text{active}} \approx \mathbf{15B}$ (Top-8 expert routing).
2. **RL training per-step (Step) throughput**:
   * Configured as $1568 \text{ prompts} \times 16 \text{ rollouts} = 25,088$ asynchronous concurrent trajectories.
   * **Pro**: processes about **2.33 billion tokens** per step, with an average context length (`ctx_total_length`) of about 93.1K.
   * **Flash**: processes about **2.69 billion tokens** per step, with an average context length of about 107K.
3. **Time and cost data (based on the first public data at about the 40-hour mark)**:
   * **Per-step time**: Pro about 2 hours 31 minutes (generation about 87 minutes, training backward update about 60 minutes); Flash about 2 hours 05 minutes (generation about 58 minutes, update about 63 minutes).
   * **Cumulative bill**: Pro about $20,000/hour (duration about 45 hours, cost over $930,000); Flash about $10,500/hour (duration about 40 hours, cost over $420,000); **combined for both versions, about $31,000 per hour**.
   * **Environment scale**: Pro has 23,848 concurrent active code sandboxes; Flash has 37,786 concurrent sandboxes.

---

### 2. Calculation method 1: theoretical model computation (Model FLOPs) based on token count and active parameters

In the reinforcement learning pipeline, computation is divided into two core stages:
* **Generation sampling (Rollout/Inference)**: requires only forward propagation; the theoretical compute per token is $\approx 2 \times P_{\text{active}}$ FLOPs.
* **Policy update (Trainer Ops/Backward)**: contains forward and backward propagation; the theoretical compute per token is $\approx 6 \times P_{\text{active}}$ FLOPs.

#### 1. Pure model compute for a single step (Step):
* **MiMo-V2.6-Pro**（$P_{\text{active}} = 42 \times 10^9$，$N = 2.33 \times 10^9$ Tokens）：
  * Generation stage: $2 \times 42\text{B} \times 2.33\text{B} \approx 1.96 \times 10^{20} \text{ FLOPs}$
  * Update stage: $6 \times 42\text{B} \times 2.33\text{B} \approx 5.87 \times 10^{20} \text{ FLOPs}$
  * *Single-step total*: $\approx \mathbf{7.83 \times 10^{20} \text{ FLOPs}}$ (approximately **0.78 ZettaFLOPs**)
* **MiMo-V2.6-Flash**（$P_{\text{active}} = 15 \times 10^9$，$N = 2.69 \times 10^9$ Tokens）：
  * Generation stage: $2 \times 15\text{B} \times 2.69\text{B} \approx 8.07 \times 10^{19} \text{ FLOPs}$
  * Update stage: $6 \times 15\text{B} \times 2.69\text{B} \approx 2.42 \times 10^{20} \text{ FLOPs}$
  * *Single-step total*: $\approx \mathbf{3.23 \times 10^{20} \text{ FLOPs}}$ (approximately **0.32 ZettaFLOPs**)

*(Note: both models adopt a 5:1/6:1 sliding window attention mechanism SWA, with a window size of 128; the vast majority of layers avoid the $O(N^2)$ explosion caused by a 100k context, and the additional effective floating-point overhead from attention layers is around 10%).*

#### 2. Cumulative theoretical compute estimation by stage:
* **Early public monitoring period (about 20~25 steps, when cumulative spend was about $1.35 million)**:
  * Pro (about 18 steps) investment: $18 \times 7.83 \times 10^{20} \approx 1.4 \times 10^{21} \text{ FLOPs}$
  * Flash (about 20 steps) investment: $20 \times 3.23 \times 10^{20} \approx 0.65 \times 10^{21} \text{ FLOPs}$
  * **Initial cumulative effective model compute: about $2.0 \times 10^{21} \sim 2.5 \times 10^{21}$ FLOPs (about 2~2.5 ZettaFLOPs)**.
* **Full-cycle estimate (if calculated by the usual 50~100 steps of large-model post-training)**:
  * The cumulative pure-model effective compute over the entire reinforcement learning stage will be **$0.5 \times 10^{22} \sim 1.5 \times 10^{22}$ FLOPs** (i.e., on the order of **$10^{22}$**).

---

### III. Calculation method two: based on cloud cost and physical hardware utilization (Hardware Peak FLOPs)

In actual engineering, hardware cannot run at 100% efficiency to reach theoretical values; it also includes data scheduling, distributed communication, and MFU (model FLOPs utilization) losses.

#### 1. Back-inference of hardware cluster scale:
* The current combined spend for Pro + Flash is about **$31,000/hour**.
* In the market, the long-term large-customer combined rental/self-built amortized cost of industrial-grade **NVIDIA H100 SXM5** (80GB) is about **$2.5 / GPU-hour** (including InfiniBand network, data center power, and depreciation).
* After deducting the cost of maintaining more than 60,000 concurrent CPU code sandbox virtual machines (about 15%~20% of the total budget):
  * The budget invested in GPUs is about $25,000 / hour.
  * **The inferred scale of the hardware resource pool occupied behind this is about 10,000 H100-equivalent GPUs** (of which Pro is allocated about 6,500~7,000 GPUs, and Flash is allocated about 3,000~3,500 GPUs).

#### 2. Total actual floating-point operations of physical hardware (Hardware FLOPs):
* The theoretical dense FP16/BF16 Tensor Core peak of a single H100 SXM5 is about $989 \text{ TFLOPS} \approx 10^{15} \text{ FLOPs/s}$.
* Cluster aggregate compute peak (calculated with $10^4$ H100s):
  $$\text{Peak Capacity} = 10,000 \times 10^{15} \text{ FLOPs/s} = 10^{19} \text{ FLOPs/s} \quad (\mathbf{10 \text{ ExaFLOPs/s}})$$
* In an asynchronous long-context RL system:
  * Rollout generation stage (GPU memory bandwidth and KV Cache intensive): effective MFU is about 20%~25%;
  * Trainer policy update stage: effective MFU is about 35%~45%;
  * The full-link weighted average effective utilization (MFU) is conservatively estimated at **30%**.
* **Publicly disclosed hardware compute investment for the first 40 hours (about 144,000 seconds)**:
  $$\text{Actual floating-point operations executed by hardware} \approx 10^{19} \text{ FLOPs/s} \times 144,000 \text{ s} \times 30\% \approx \mathbf{4.3 \times 10^{23} \text{ FLOPs}}$$
  *(If calculated at the hardware theoretical peak, this is equivalent to locking in **$1.4 \times 10^{24}$ FLOPs** of physical hardware capacity)*.

---

### IV. Calculation method three: decomposition of RL-specific “end-to-end full-link system compute”

Unlike traditional pretraining that only counts forward and backward, Luo Fuli's team emphasizes that this RL is **“Agentic RL (agentic multi-task reinforcement learning)”**, and compute is split into three parts:

1. **Rollout generation-side compute**:
   * It must simultaneously maintain 25,088 concurrent interaction sequences with lengths reaching 100K; their KV Cache throughput and dynamic speculative decoding (MTP) occupy a large amount of floating-point computation on the generation servers.
2. **Grader Compute (additional compute added by the grading process)**:
   * 团队在评估端引入了“带有量规奖励的组内信用分配（In-group Credit Assignment）”。这意味着每一条行动轨迹的中间步骤，都需要由专门的 **Judge/Critic 模型（甚至多模型交叉对比）** 进行语义打分和单元测试分析。这一过程属于**纯额外的 LLM 推理计算投入**，在传统 RL 中通常被忽视，但在本轮训练中占用了相当比例的算力配比。
3. **Trainer 策略反向更新端**：
   * 负责接收高奖励轨迹并对 1.02T MoE 权重进行梯度更新。

在全链路视角下，**主模型参数更新的纯计算量实际上只占整个训练集群开销的 30%~40%**，其余 60%~70% 的计算量全部被 Rollout 轨迹探索和 Grader 智能体评估所消耗。

---

### 综合推断结论

对于 MiMo-V2.6 的这次强化学习训练投入：

| 计算口径 | 初期阶段（已公开的 40 小时内） | 预计全训练周期（预估 50~100 步） | 数量级特征 |
| :--- | :--- | :--- | :--- |
| **理论模型有效算力 (Model FLOPs)**<br>*(基于 $2P/6P \times \text{Tokens}$)* | $\approx 2.0 \times 10^{21} \sim 2.5 \times 10^{21} \text{ FLOPs}$ | $\approx \mathbf{0.5 \times 10^{22} \sim 1.5 \times 10^{22} \text{ FLOPs}}$ | **$10^{22}$ FLOPs 数量级**<br>*(数十个 ZettaFLOPs)* |
| **底层硬件实际交付算力 (Hardware Executed)**<br>*(按 ~30% MFU 实际吞吐)* | $\approx 4.3 \times 10^{23} \text{ FLOPs}$ | $\approx \mathbf{1.0 \times 10^{24} \sim 1.5 \times 10^{24} \text{ FLOPs}}$ | **$10^{24}$ FLOPs 数量级**<br>*(约 1~1.5 YottaFLOPs)* |
| **底层硬件峰值算力池消耗 (Hardware Peak Capacity)** | $\approx 1.4 \times 10^{24} \text{ FLOPs}$ | $\approx \mathbf{3.5 \times 10^{24} \sim 5.0 \times 10^{24} \text{ FLOPs}}$ | **$10^{24}$ FLOPs 数量级** |

**行业横向对比**：  
常规开源模型通常仅把 5% 以内的算力留给后训练（RL/SFT），而 MiMo-V2.6 这一轮 RL 消耗的硬件物理算力（$10^{24}$ 级别），**已经相当于完整预训练一个数千亿参数级别稠密模型（如 Llama-3-70B 预训练通常在 $10^{24}$ FLOPs 左右）的算力投入**。这也印证了团队“将计算资源、环境与评估全面 Scaling”的实验目的——后训练强化学习正从轻量微调阶段，演进为一场真正的超大规模算力工业工程。

------

# 知识笔记：超大规模智能体强化学习（Agentic RL）步数与算力估算指南

---

## 1. 核心认知重塑：现代 LLM-RL 的“单步（Step）”本质

在现代万亿参数 / 混合专家（MoE）大语言模型的后训练强化学习中，“Step”已从传统机器学习的“单一微批次更新（Micro-batch Update）”演变为一个重型的**端到端分布式宏观周期（Macro-Step）**。

一个典型的 Agentic RL 训练步由四部分解耦组成：
$$\text{Step Time} = t_{\text{rollout}} (\text{高并发生成}) + t_{\text{sandbox}} (\text{环境执行}) + t_{\text{grader}} (\text{评分与信用分配}) + t_{\text{trainer}} (\text{梯度更新})$$

* **探索规模**：单步通常包含数千个 Prompt，每个 Prompt 展开 8~16 条并行 Rollout（单步并发轨迹达数万条，单步探索 Token 吞吐达 **20 亿 ~ 30 亿** 数量级）。
* **物理耗时**：单步受长程交互（~100k 上下文）与沙箱编译延迟约束，通常耗时 **1.5 ~ 3 小时**。
* **结论**：在大规模 RL 中，**极少的步数即代表海量的状态空间采样**。

---

## 2. 经验估算基准（Rules of Thumb）

| 维度 | 工业级前沿实践经验值 | 设计逻辑与物理约束 |
| :--- | :--- | :--- |
| **总步数（Step Count）** | **50 ~ 120 步**（通常不超过 150 步） | 边际收益递减拐点通常在 60~80 步出现；超过 120 步模型崩溃风险急剧上升。 |
| **Token 总预算** | **100B ~ 300B Tokens** | 约为基础预训练 Token 量的 **0.5% ~ 2%**，过多会导致严重的策略偏移与灾难性遗忘。 |
| **单日推进速度** | **8 ~ 12 步 / 天** | 受限于长程多轮生成的内存带宽与分布式异步聚合延迟。 |
| **训练周期（Wall-clock）** | **7 ~ 14 天** | 超过两周的实验周期会导致研发反馈循环过长，不符合模型敏捷迭代规律。 |
| **预算规模（单次 Run）** | **200 万 ~ 500 万美元** | 基于数千至上万张顶级加速卡（如 H100 集群）的 1~2 周租用与电力综合成本。 |

---

## 3. 动态终止判定矩阵（Stopping Criteria）

大模型强化学习从不预设绝对固定的总步数，而是由**多维监控指标的临界状态**触发提前终止（Early Stopping）：

```
                  ┌──────────────────────┐
                  │ Real-time training monitoring Dashboard │
                  └──────────┬───────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
【Metric 1: Reward saturation】   【Metric 2: Exploration entropy loss】   【Metric 3: Policy divergence】
dynsam/avg@n flattens      actor/entropy_loss    actor/pg_loss diverges abnormally
No gains on benchmarks such as DeepSWE   falls below critical threshold (collapse)     or KL divergence exceeds budget
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             ▼
                 【Trigger condition: any 1 met】
                             │
                             ▼
                    [ Execution terminates and weights are frozen ]
```

1. **奖励饱和（Reward Saturation）**：
   * 动态采样平均得分（`dynsam/avg@n`）以及外挂的独立代码/推理评测集分数连续 5~10 个 Step 处于平台期，方差无显著正向收益。
2. **探索熵坍塌（Policy Entropy Collapse）**：
   * `actor/entropy_loss` 持续单调下跌至极限安全线以下。这意味着模型已失去探索不同解答路径的随机性，开始退化为确定性的固定输出模板。
3. **古德哈特作弊涌现（Reward Hacking）**：
   * 模型输出长度异常暴涨但解答质量停滞，甚至开始利用环境沙箱超时、评测用例的边界缺陷刷分。
4. **策略漂移超标（KL Budget Exhaustion）**：
   * 策略模型与参考模型（Reference Model）之间的 KL 散度突破预设阈值，通识语义分布受到不可逆破坏。

---

## 4. 架构差异考量：MoE vs. Dense 在超长 RL 中的行为分化

模型架构对 RL 步数的耐受能力存在本质差异：

### 1) 混合专家模型（MoE，如 1T 总参 / 40B 激活）
* **优势**：总参数容量极大，能容纳更复杂、异构的智能体策略逻辑。
* **致命风险：专家路由坍塌（Router Collapse）**
  * 在强化学习的高奖励刺激下，门控网络（Router）极具“贪心”倾向，容易过早收敛并高度依赖某几个在当前任务上见效快的“优势专家”。
  * **Shorter step tolerance**: If the step count is too long, experts that are not activated will remain in a state of gradient starvation for a long time, leading to the collapse of expert division of labor. Therefore, MoE models in the RL stage usually need to control the step count more strictly than Dense, or must apply an auxiliary load balancing loss with extremely high weight (Auxiliary Load Balancing Loss).

### 2) Dense model (Dense)
* **Characteristics**: Every backpropagation updates all parameters, and the gradient field is relatively continuous and smooth.
* **Behavior**: The tolerance for training with longer step counts is slightly higher than MoE, but the physical VRAM overhead faced is larger, and the speed of capacity saturation (Capacity Saturation) is often earlier than MoE.

---

## 5. Quick Estimation Engineering Formulas (Cheat Sheet)

When planning projects and cluster scheduling, the following formulas can be used for reverse derivation:

### ① Total step budget calculation:
$$S = \left\lceil \frac{\text{Target Token Budget}}{N_{\text{prompts}} \times K_{\text{rollouts}} \times L_{\text{avg\_ctx}}} \right\rceil$$
> *Example: Target token budget 250 billion, per step 1568 prompts × 16 rollouts, average length 100k, then $S = \frac{2.5 \times 10^{11}}{1568 \times 16 \times 10^5} \approx 99.6 \text{ steps}$.*

### ② Experimental scheduling days calculation:
$$D = \frac{S \times (t_{\text{rollout}} + t_{\text{grader}} + t_{\text{trainer}})}{24 \times \eta_{\text{infra}}}$$
> *Where $\eta_{\text{infra}}$ is the infrastructure availability factor (taking into account OOM restarts, network jitter, checkpoint saving, and other overheads, empirically taken as **0.75 ~ 0.85**).*

### ③ Cluster throughput effective compute requirement (Model FLOPs / Step):
$$\text{FLOPs}_{\text{step}} \approx \underbrace{2 \cdot P_{\text{active}} \cdot N_{\text{tokens}}}_{\text{Rollout}} + \underbrace{6 \cdot P_{\text{active}} \cdot N_{\text{tokens}}}_{\text{Trainer Update}} = 8 \cdot P_{\text{active}} \cdot N_{\text{tokens}}$$
*(Note: If the quadratic overhead of long-range global attention and the computation of the Grader grading model are included, the actual coefficient usually fluctuates between $9 \sim 11$).*
