# 国外一线解读：MiMo-V2.6 RL 公开看板（英文社区采集）

> 材料身份：调研/采集笔记。写的是**别人怎么说**，不是我方对看板的分析结论；
> 文中凡是标"我方实测"的部分，是我为了核对别人说法而顺手查的看板原始接口，口径写清在对应位置。
> 采集日期：2026-09-19（北京时间 09:10–09:25 对应 UTC 时间；下文所有"采集时间"都指这一窗口）。
> 观测对象：https://mimo.xiaomi.com/rl/ 以及英文社区对它的讨论。

---

## 一、采集背景（先说清方法和限制）

**范围**：英文社区对小米 MiMo-V2.6 两次 RL 公开训练的解读——X（推特）原始发言、Hacker News 讨论帖、Reddit（r/LocalLLaMA、r/reinforcementlearning、r/singularity、r/MachineLearning）、英文媒体报道与技术聚合站。

**方法**：
- X 用代理版 Playwright 打开 `x.com`。**关键发现：X 的单条帖子页在未登录状态下可以读到正文**（正文在页面 `<title>` 和 body 里都能拿到），但**回复列表在多数帖子里不渲染**。所以大部分推文我拿到了原句和精确时间戳，少数拿到了热门回复。
- HN 用 Algolia API（`hn.algolia.com/api/v1/search?tags=comment,story_<id>`）拉全部 155 条评论，比网页 DOM 完整。
- Reddit 用 `.json` 接口拉帖子正文和整棵评论树，未登录可用。
- 看板本身用代理浏览器直接打 `/rl/api/*` 接口核对数字。
- 截图放在仓库根目录 `.playwright-mcp/`，前缀 `mimo-en-`。**本次有 4 张是刻意留下的证据截图**（见文末清单）：推文会被删，原句的截图比链接更耐久。其余过程快照（页面无障碍树、控制台日志）已清理。

**环境限制（影响可复现性，必须先说）**：
1. **X 的回复串抓不到。** Sasha Rush 那条 80k→120k 的推文显示有 13 条回复，但回复内容不渲染；三个遥测站全部被挡：`xcancel.com` 返回 451「service is suspended」，`lightbrd.com` 返回 403，`nitter.perennialte.ch` 返回 403。Twitter 官方 embed 端点（`platform.twitter.com/embed/Tweet.html`）能渲染帖子但**不含回复**。所以「有没有人回复解释这个问题」我无法排除，只能说**在可访问的公开页面里没找到**。
2. **Yahoo 转载页 403**（`tech.yahoo.com` 那条 MiMo 报道），只能从 Forkast 原站读到同文。
3. **`ai.jp.net` 被 Cloudflare 拦**（返回 "Just a moment..."）。
4. **`pandaily.com` 只返回标题**，正文是 JS 渲染，未取到。
5. 有两篇英文内容标了「AI 撰写/AI 整理」：Forkast 那篇标注 "Forkast mind"、"This post was drafted with AI assistance"，RITS（NYU Shanghai 图书馆）那篇标注 "This post was drafted with AI assistance and reviewed by RITS staff"。两篇我都用了，但在**第十节**把它们降级为二手整理，并单独指出其中一处点名错误（ai-primer 的两条 X 引用也核错了）。
6. 36kr 英文版那篇是**中文稿（腾讯科技）的英译**，里面引的 X 发言属于转述，我逐条回到 X 核对了原文，差异写在第 3.1 节。

---

## 二、结论先给（6 条）

1. **Sasha Rush 的原始发言找到了，一共三连推，都在 2026-09-17。** 触发那条是：「I'm on my phone monitoring the MiMo v2.6 response length on coding-obg8 like a degenerate gambler.」（我正像个烂赌鬼一样在手机上盯着 MiMo v2.6 在 coding-obg8 上的回答长度。）紧接着他自己回复：「just feels like 80k->120k is too big a jump.」（就是觉得 80k 跳到 120k 太大了。）**他到这一步只是表达不安，没给机制解释，社区里也没人给。**（证据强度：官方一手 = Rush 本人 X 原帖）

2. **我顺着查了看板原始数据，80k→120k 是真的，而且现在早就不止 120k 了。** `ctx_total_length/code/dataset-obg8/mean`（该数据集的平均上下文总长度）在 pro 上：第 1 步 79,852 → 第 14 步 118,125 → 第 15 步 125,183 → **第 24 步 165,762**。同一数据集的 prompt 长度几乎不动（2,500–3,200），所以涨的确实全是模型自己生成的部分。（证据强度：我方实测，2026-09-19 09:20 UTC，直接打 `/rl/api/series`）

3. **「每小时约 3 万美元」对得上，但这是两条训练相加的费率，不是单条。** 我读到的实时费率：pro 5.71 美元/秒、flash 2.855 美元/秒，合计 8.565 美元/秒 = **30,834 美元/小时**，与 36kr 英文版写的 30,834 完全一致。换算下来 pro 约 49.3 万美元/天、flash 约 24.7 万美元/天——和 elie（@eliebakouch）那条被大量引用的推文给的 493k/247k 一天对得上。（证据强度：我方实测 + 一线经验）

4. **英文社区对卡数的推算只有一个，而且是个粗略假设：约 4,000 张卡训练 pro。** r/LocalLLaMA 用户 power97992 写：「if $5/gpu/hr, it's around 4000 gpus for 2.6 pro」——按 5 美元/卡/小时反推。用我实测的费率复算：pro 20,556 美元/小时 ÷ 5 = **约 4,111 张**，与他一致。但这个假设的分母（5 美元/卡/小时）没人证实，HN 上有人说这是 "3,000 B300 nodes on Modal"（约 3,000 个 B300 节点）的量级。**没有任何人从看板数据正面算出卡数或沙箱并发，都是拿账单反推。**（证据强度：一线经验，未见官方确认）

5. **benchmark overfitting 的质疑很集中，而且出现在三个不同的站。** HN 上 liuliu 直接问「边训边跑 benchmark 不就是 contamination 的定义吗」；r/singularity 上 Ill_Distribution8517 说「The benchmark is quite literally used while they are training, this is the worst way you can compare the model」；同一帖的 Odd_Buddy_3615 给了最具体的一种机制：拿评测结果去找漏洞、造数据、再来一遍，重复 100 次，「For some labs this is a closed automated loop」。**反驳的一方（HN 的 sspiff、brookst、lucrbvi）认为离线评测不回灌训练就不算污染，只算 validation set 被用来做停止判断，会有轻微 benchmaxxing。**（证据强度：一线经验）

6. **对看板数据本身的不信任主要来自 HN 的一个用户，且被其他人反驳。** `hsbalanxvxjsmab` 声称「refresh the page the progress goes back in time constantly」「0 data correlates the log messages」，即数据是回放或 LLM 编的；但 `Bolwin` 用进度条的类比反驳（"The intermediate tickers are fake but real data comes in and resets it"），`Retro_Dev` 指出重启不等于回滚模型状态。另外有人贴出看板上的一行 `"Claude Distill Requests":'hidden'`，以及多条「为什么不公布 MFU」的追问。**Forkast 那篇把"数字刷新会回跳"写成 HN 的普遍看法，实际上是一个人的说法加两条反驳，我按原帖降级处理。**（证据强度：一线经验，其中"数据造假"属未证实主张）

---

## 三、Sasha Rush 那条 80k→120k：原文、实据、机制

这一节是本次采集最优先的目标，单独展开。

### 3.1 原始发言（三连推，全部来自 Rush 本人 X 账号）

说话人：Sasha Rush，X 账号 @srush_nlp（个人简介 "Researcher, Programmer"，主页 rush-nlp.com）。
采集时间：2026-09-19 09:13–09:20 UTC。采集方式：代理浏览器直接打开 x.com 帖子页。

**第一条（触发帖）**，2026-09-17 11:30（帖子页显示时间），2.7 万次浏览，15 回复 / 6 转发 / 320 赞 / 38 收藏。
链接：https://x.com/srush_nlp/status/2100427133440950536

> "I'm on my phone monitoring the MiMo v2.6 response length on coding-obg8 like a degenerate gambler."

中文：我正像个烂赌鬼一样在手机上盯着 MiMo v2.6 在 coding-obg8 上的回答长度。

**第二条（自回复）**，同日，2 回复 / 15 转发 / 3,384 赞。
链接：https://x.com/srush_nlp/status/2100427931705098465

> "Just insane you can watch this -> mimo.xiaomi.com/rl/"

中文：能这样直接看着，太离谱了 -> mimo.xiaomi.com/rl/

**第三条（自回复，也是任务里点名的那句）**，2026-09-17 11:34（Twitter 官方 embed 端点给出的精确时间 "11:34 AM · Sep 17, 2026"），2,335 次浏览，13 回复 / 1 转发。
链接：https://x.com/srush_nlp/status/2100428266792272023
截图：`.playwright-mcp/mimo-en-srush-80k-120k.png`

> "just feels like 80k->120k is too big a jump."

中文：就是觉得 80k 跳到 120k 太大了。

**采到的性质**：这三条是**原始出处**，不是二手转述。我没有采到任何比这更早或更完整的 Rush 表述（他的博客 srush.github.io 在 9-16 那条推里推的是 "Lean Verified Transformers"，与本题无关；他的主页最近帖子里除上面三条外没有别的 MiMo 内容）。

**一个值得注意的差分**：这条常被概括成 Rush「表示好奇」（任务简报里也是这么写的），但原文语气不是好奇，是**怀疑**——"just feels like ... is too big a jump" 是觉得这个跳变幅度不自然。做转述时别把它写成"他很好奇为什么涨"。

另外要说明：**我查到的英文报道里没有一篇提到 Rush 这条或 80k→120k 这件事。** 36kr 英文版只引了 Han Xiao、elie 和一个叫 Zain 的网友；Forkast、RITS、TechNode、ai-primer 都没提。所以这条观察在英文媒体层面是**没人接的**，只在 X 上出现过。

**13 条回复抓不到**（原因见第一节第 1 条）。所以「有没有人在回复里解释」这件事我无法证否，只能报"未获取到"。

### 3.2 我顺着查了看板，80k→120k 是从哪来的

看板上没有叫「response length」的字段。与"回答长度"对应的是一组 `ctx_*_length` 指标，按数据组（code / general / cyber / visual / chat）和具体数据集分开。Rush 点名的 `coding-obg8` 在看板上确实存在，全名是 `code/dataset-obg8`。

（证据强度：我方实测。时间 2026-09-19 09:20 UTC；接口 `/rl/api/tags?run=pro` 共 2,029 个指标名、`/rl/api/series?run=pro&v=3-5513.24.12.23&tags=...`；口径是该数据集全部 rollout 的均值。）

**pro 的 `ctx_total_length/code/dataset-obg8/mean`，按步：**

| 步 | 1 | 4 | 8 | 10 | 12 | 14 | 15 | 18 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 平均上下文总长度 | 79,853 | 94,895 | 97,894 | 108,316 | 112,495 | **118,125** | **125,183** | 137,171 | 137,428 | 136,104 | **165,762** |

同数据集 `ctx_prompt_length/.../mean`（喂进去的 prompt 长度）全程在 2,509–3,221 之间，几乎水平。
所以 **回答部分 ≈ 总长 − prompt**：第 1 步约 77,051 → 第 14 步约 115,332 → 第 24 步约 162,741。

**flash 同数据集**：第 1 步 81,102 → 第 14 步 120,623 → 第 30 步 163,101，趋势一样。

**三条补充观察**（这三条是我的复算/推断，标清楚）：

- 这个 `ctx_total_length` 的**最大值在第 20、21 步都等于 1,048,570**，而 2^20 = 1,048,576。同时 `clip_ratio`（被截断的比例）只在第 20 步（0.000406）和第 21 步（0.000810）非零，其余全为 0。**推断：上下文有一个 100 万 token 的硬上限，已经有少量样本撞上了。**
- `dynsam/agg_turn/mean`（每条轨迹的平均回合数）在第 1–24 步之间是 42.4–64.8 上下摆动，**没有上升趋势**（第 1 步 47.5，第 24 步 52.2）。把总长除以回合数得到"每回合新增 token"：第 1 步约 1,682 → 第 24 步约 3,178，**翻了将近一倍**。所以长度膨胀主要不是"回合变多"，而是"每回合吐得更多"。
- 同一时段 `dynsam/avg@n`（训练侧平均通过率）第 1 步 0.5647，第 20 步见顶 0.6431，然后**连跌 4 步到第 24 步的 0.5964**，而长度还在往上走。**这是"长度涨、通过率反而回落"的形态，符合长度刷分的表象，但也可能只是这几步抽到的题更难——看板没有暴露能区分这两者的信息，我不下结论。**

### 3.3 有没有人给出机制解释？——没有找到

按任务要求逐项查，结果如下：

| 可能的解释路径 | 英文社区有没有人说 | 备注 |
|---|---|---|
| 长度与正确率的相关性 | 没找到 | 只有 Rush 的原始不安，没有相关性分析 |
| RL 的长度偏置 / GRPO-DAPO 类算法偏好长回答 | 没找到 | r/LocalLLaMA 讨论组里没人提 |
| thinking token 膨胀 | 没找到 | X 上没人把这条和看板数据连起来 |
| 长度惩罚缺失 / 截断上限 | 没找到 | 没人提到我上面算出的 1M 截断 |
| reward hacking / 长度刷分 | 有，但不是针对 80k→120k | 见第七节，讨论的是 benchmark 与 judge，不是长度 |

**结论：任务假设的"机制解释"在英文可访问范围内不存在。**唯一把长度单拎出来讲的人是 Rush，他自己也没给解释。我在任何时候都不要把"没人解释"写成"大家认为没问题"——真实情况是**这个现象几乎没被讨论**。

---

## 四、Hacker News：549 分、155 条评论

帖子：**"Xiaomi Mimo 2.6 live post-training dashboard"**，提交者 `krackers`，2026-09-16 20:09 UTC，**549 分、155 条评论**，链接指向 https://mimo.xiaomi.com/rl/ 。
帖子页：https://news.ycombinator.com/item?id=49732270
采集方式：Algolia API 拉全部 155 条，时间 2026-09-19 09:12–09:18 UTC。

**这条帖子的实际内容构成（我逐条读完后的判断）**：大约七成是"MiMo 2.5 用起来怎么样 / 比 DeepSeek 便宜吗 / 我用哪个套餐"的日常闲聊，与看板本身无关。真正针对看板的技术观点集中在我下面列的这些，另外还有一条明显的 benchmark 污染支线。

**成本与算力**
- `ttul`：
  > "$5 per second if my eyes don't fool me. That's ~$432K per day. Enough to rent 3,000 B300 nodes on Modal."
  > 中文：如果我没看错是每秒 5 美元。那是每天约 43.2 万美元。够在 Modal 上租 3,000 个 B300 节点。
- `ssn2000`：
  > "Total run cost is $1.2M until now, what resources are they using to train their model? Wish they shared more details on that and what the MFU metrics are."
  > 中文：到现在总成本 120 万美元了，他们到底用什么资源在训？希望他们多披露一点，还有 MFU 指标。
- `Cookingboy`（明显是玩笑）：
  > "That "training cost" is just live revenue count for Anthropic/OpenAI API calls! /s"
  > 中文：那个"训练成本"其实只是 Anthropic/OpenAI API 调用的实时营收计数器吧！/s

**benchmark 与污染**
- `liuliu`：
  > "When you run benchmarks while training, isn't that the definition of contamination? Asking because I am not sure if this is normal in big labs now."
  > 中文：边训练边跑 benchmark，这不就是污染的定义吗？问这个是因为我不确定现在大实验室是不是都这样。
- `jampekka` 的回复（本楼被引用最多的一条）：
  > "Kinda yes. The benchmarks become part of the validation set, which means the models get slightly overfit to them if they are used as criteria for stopping the training. But a lot less compared to using them in the training data. I'd guess everybody uses at least some benchmarks as stopping criteria, which is kinda sensible, but it also does induce some benchmaxxing, and explains partly why the newest models always tend to eke out in benchmarks."
  > 中文：某种意义上是的。benchmark 变成了验证集的一部分，如果被用作停止训练的判据，模型就会对它轻微过拟合，但比放进训练数据轻得多。我猜所有人都至少拿一些 benchmark 当停止条件，这其实挺合理，但它确实会带来一定程度的"刷榜"，也部分解释了为什么最新模型总能在 benchmark 上一点点挤上去。
- `sspiff`（技术性反驳，讲清了流程）：
  > "They run one step/iteration on an additional chunk of training data, then use the snapshot of the weights after that iteration in a separate validation benchmark while continuing to train on another chunk of data for the next iteration. They result of the benchmark does not feed back into the training, it simply serves to provide a measurement of progression over time."
  > 中文：他们在新的数据块上跑一步/一轮，然后拿这一步之后的权重快照去一个独立的验证 benchmark 上评，同时继续用下一个数据块训练。评测结果不会回灌到训练里，只是用来度量随时间的进展。
- `brookst` 与 `kingstnap` 的法庭类比（kingstnap 的补充比原贴更有信息量）：
  > `brookst`: "It's the difference between "study law until you can pass any random bar exam" and "here are 200 legal questions and we'll drill them, with me correcting and explaining when you get one wrong, until you can pass exactly these 200". Your right that tuning can aim for a benchmark, but it does not leak any information about the answers."
  > 中文：区别在于"一直学法律直到你能通过任何一场随机律考"和"这里有 200 道题，我们反复练，你错了我就讲，直到你恰好能过这 200 道"。
  > `kingstnap`: "It's actually close to the second. "Here are 200 software questions, will drill you on *other stuff* until you can pass exactly these 200. If the other stuff isn't improving your scores we will change ratios of it till it does." The reason it benchmaxes is that *other stuff* ends up looking more and more like SWE Bench without you realizing it."
  > 中文：其实更接近第二种，只是练的是"别的东西"：给你 200 道软件题，用别的内容训练你直到你能过这 200 道；如果那些"别的内容"没提升分数，就调它们的配比直到有提升。会刷榜的原因是，那些"别的内容"会在你不知不觉中越来越像 SWE Bench。

**看板可信度**
- `singularity2001`（整条评论就这一行）：
  > ""Claude Distill Requests":'hidden'"
  > 中文：看板上有一行是 "Claude Distill Requests"（Claude 蒸馏请求）：hidden（隐藏）。
- `hsbalanxvxjsmab`（同一个人，多条）：
  > "It said restarted step 15 5 mins ago and the progress showed they were working on step 16 for a day"
  > 中文：上面写着 5 分钟前从第 15 步重启，可进度显示第 16 步已经做了一天了。
  > "Haha yeah pretty wild how easily you can see the data is fake by the repeating numbers (refresh the page the progress goes back in time constantly) + watch for restarts. They say they happen but 0 data correlates the log messages. Just a replay of old data or being fed by an llm so they convince people they are open"
  > 中文：哈，太明显了，数据是假的——数字一直在重复，刷新页面进度还会倒退，再看那些重启，他们说要重启，但没有任何数据能对上那些日志。要么是回放旧数据，要么是 LLM 喂出来的，好让人相信他们很开放。
- `Bolwin`（反驳）：
  > "The intermediate tickers are fake but real data comes in and resets it. Its like a progress bar essentially. We don't call progress and bars fake"
  > 中文：中间那些跳动数字是假的，但真数据进来会把它重置。本质上就是个进度条。我们不会说进度条是假的。
- `Retro_Dev`（反驳）：
  > "A restart of the process does not necessarily mean reverting the model state. I don't know why you would even do that, because you'd lose all the progress you made."
  > 中文：进程重启不一定意味着模型状态回滚。我不明白为什么要那样做，那会把所有进展丢掉。
- `rozab` 与 `dude250711`（对"为什么突然公开"的猜测）：
  > `rozab`: "Why are they doing this? To try head off accusations about distillation?"
  > 中文：他们为什么这么做？是为了提前堵住关于蒸馏的指控？
  > `dude250711`: "Distillation in real-time? Very interesting!"
  > 中文：实时蒸馏？很有意思！
- `brookst`（关于公开能否自证清白）：
  > "I don't see how it would head off such accusations. This is post-training, and even it's data could be pulled from other models or run against other models in realtime. Not saying that's the case, just that the dashboard does not disprove."
  > 中文：我看不出这怎么堵得住这类指控。这是后训练，它的数据本身也可能是从别的模型那里来的，或者实时拿别的模型跑出来的。我不是说一定是这样，只是看板并不能证否。

**DeepSWE 分数与干扰**
- `ricardobeat`：
  > "For reference, Mimo-v2.5-Pro scored 19% on DeepSWE 1.1. This is looking great. Fable scores 70%, Kimi K3 69%, Astra 74% (all on max effort)."
  > 中文：作个参照，MiMo-v2.5-Pro 在 DeepSWE 1.1 上是 19%。这次看着很不错。Fable 70%、Kimi K3 69%、Astra 74%（都是最高档算力）。
- `arcanemachiner`：
  > "DeepSWE is saturated now IMO, and is basically worthless. Lots of new models get around 74%."
  > 中文：我觉得 DeepSWE 已经饱和了，基本没价值，一堆新模型都在 74% 附近。
- `esafak`：
  > "That's the kind of transparency we need! That DeepSWE benchmark puts it in frontier territory"
  > 中文：这才是我们需要的透明度！那个 DeepSWE 分数把它放进前沿梯队了。
- `Cookingboy`：
  > "2.6-pro just reached 63.7% by step 10, it's on step 11 right now. Even flash reached 60.7% by step 12... This is so exciting lmao."
  > 中文：2.6-pro 第 10 步就到 63.7% 了，现在在第 11 步。连 flash 第 12 步都有 60.7%……太刺激了。
- `buffalobuffalo`（唯一提到 harness 的）：
  > "Also worth taking a look at is the mimo harness. It's a fork of opencode with some new modes added for long horizon tasks. One of the better open harnesses out there at the moment."

**注意**：HN 全文 155 条里**没有一条讨论生成长度、长度膨胀或 thinking token**，也没有人复算卡数。这一点是本次采集的一个"负结果"，值得记下来。

---

## 五、Reddit：三个帖子，四种态度

### 5.1 r/LocalLLaMA —— 主战场

帖子：**"Xiaomi MiMo 2.6 Live Training Dashboard"**，2026-09-16，**446 分 / 75 条评论**，链接指向看板。
https://reddit.com/r/LocalLLaMA/comments/1wi9ebm/xiaomi_mimo_26_live_training_dashboard/
采集方式：`.json` 接口拉整棵评论树，时间 2026-09-19 09:15 UTC。

**卡数（本节最重要的一条）**
- `power97992`：
  > "if  $5/gpu/hr, it's around 4000 gpus for 2.6 pro. That is a lot less than astra…"
  > 中文：如果按 5 美元/卡/小时算，2.6 pro 大概 4,000 张卡。比 Astra 少多了……
- `power97992` / `zball_` 关于卡型：
  > `power97992`: "It could be more if they are using ascends. 5/hr is for a b300"
  > `zball_`: "They aren't. Most likely a lot of Hoppers."
  > 中文：如果用昇腾会更多，5 美元/小时是 B300 的价 / 不是昇腾，大概率是大量 Hopper。
- `NandaVegg` 引了一条传闻（**注意这是传闻，不是论文**）：
  > "There was a casual SNS report from DeepMind researcher that (for a single training run) GPU does not really scale above 4k cluster (it even slowed down above 8k presumably because bottlenecks) and mocking Meta and Tesla for acquiring too many GPUs just for training at the time. This is probably just one intermediate run for Xiaomi's model."
  > 中文：之前有位 DeepMind 研究员在社交媒体上随口说过，单次训练里 GPU 超过 4 千卡的集群其实不怎么涨（超过 8 千卡甚至变慢，估计是瓶颈），当时还嘲讽 Meta 和 Tesla 为训练囤那么多卡。小米这个大概只是其中一个中间 run。

**成本是不是真的**
- `ALIEN_POOP_DICK`：
  > "I wonder if the $ cost is "typical GPU-compute/s" or their raw electricity cost"
  > 中文：我好奇那个美元数字是"典型 GPU 算力成本"还是他们的电费。
- `fugogugo`（先贴 378k，5 小时后又贴）：
  > "428k 5 hours later they burn 10k per hour? damn"
  > 中文：5 小时后 428k，他们一小时烧 1 万？天。
- `roofedora`：
  > "Why is it so expensive? Don't they have the infra to support the trainings for cheap?"
- `ComposerGen`：`"$1,520,218 now"`
- `shy_monkee`（对"这看起来很不成体统"的反驳）：
  > "1M is like nothing for training a 1T parameters model, bro."
  > 中文：训一个 1T 参数模型，100 万简直不算什么，哥们。

**"这不健康吧"**
- `indicava`：
  > "Is it just me or do those loss functions not look healthy?"
  > 中文：是我多心还是那些 loss 曲线看着不健康？
- `viag` 反驳成本质疑时解释了长程 RL 的贵：
  > "And the price does not surprise me given the scale, doing RL on a 8B model on a single environment can quickly cost thousands / tens of thousands (especially for long-horizon tasks, with LLM-judges, web search etc.)"
  > 中文：这个价格以这个规模来说不意外。8B 模型在单个环境上做 RL 就能很快烧掉几千到几万美元（尤其是长程任务，还带 LLM 判分、联网搜索这些）。
- `Cool-Chemical-5629`（**指出离线评测落后**，见第八节）：
  > "Last time the Pro was tested against DeepSWE was at Step 8 of training. Currently it sits at Step 10 and the training is still on-going. It's not the final benchmark, just intermediate review of the current state which is imho a neat thing..."
  > 中文：Pro 上次在 DeepSWE 上测还是第 8 步。现在它到第 10 步了，训练还在继续。那不是最终成绩，只是对当前状态的中间检视，我个人觉得这是件好事。

**其它值得记的**
- `crusaderky`（关于 flash 与 pro 并行的意外）：
  > "I was not expecting Flash and Pro to be trained in parallel. I always assumed that Flash models were always distilled from the Pro model."
  > 中文：我没想到 Flash 和 Pro 是并行训的。我一直以为 Flash 都是从 Pro 蒸馏出来的。
- `Kahvana`（数据配比）：
  > "It's really heavily trained on code. I wish it would've been trained a bit more on general / chat data."
  > 中文：它非常偏代码。我希望能多训一点通用/对话数据。
- `Randomdotmath`：
  > "worth noting: they added visual to 2.6 pro training. does that mean it now has vision unlike 2.5 pro? (only 2.5 flash had it before)"
- `SlanderMans`：`"This is why sandboxing providers are so important right now"`
- `Terminator857` 贴了一段 Gemini 生成的"这轮要跑多久"的推算，里面把停止条件写成（这是 Gemini 的说法，不是看板口径）：
  > "In post-training RL, runs do not go on indefinitely because models experience diminishing returns, reward hacking, or entropy collapse."
  > 中文：后训练 RL 不会无限跑下去，因为模型会遇到收益递减、reward hacking（钻奖励的空子）或熵坍缩。

### 5.2 r/reinforcementlearning —— 帖子质量最高，评论很少

帖子：**"Xiaomi is literally live-streaming a $1M+ agentic RL run for MiMo-V2.6"**，2026-09-17，**114 分 / 11 条评论**。
https://reddit.com/r/reinforcementlearning/comments/1wifr2m/
采集时间：2026-09-19 09:15 UTC。

楼主正文里有一句是新信息（**注意它是"网友整理"，不是官方口径**）：

> "The dashboard shows live metrics: rewards, entropy, KL, context length (~90–100k mean!), grad norms, step timings."
> 中文：看板展示实时指标：奖励、熵、KL、上下文长度（均值约 9–10 万！）、梯度范数、每步耗时。

同帖还给了一张表，把 `dynsam/avg@n` 之外的指标也列了（Pro 第 10 步、DeepSWE 62.24、成本 $741k；Flash 第 16 步、60.77、$322k），并写 "Total cost on the board: ~$1.06M — and still climbing"。

评论里两条有信息量：
- `Prince_Corn`：
  > "This is amazing transparency work if all the frontier Labs livestreamed their training runs we could all know what's coming"
  > 中文：如果所有前沿实验室都直播训练过程，这份透明度就太棒了，我们都能知道接下来会出什么。
- `gigio123456789`（**benchmark 污染的另一处表述**）：
  > "Super cool. So the prompts they're currently training on are the ones from that benchmark?"
  > 中文：太酷了。所以他们现在训练用的 prompt 就是那个 benchmark 里的题？
- `petitponeyrose`（历史先例）：
  > "THat's good, but Bloom from Bigscience were doing it in 2019 already ;)"

### 5.3 r/singularity —— benchmark 质疑最激烈

帖子：**"Xiaomi Mimo 2.6 Live Training Dashboard"**，2026-09-16，**126 分 / 16 条评论**。
https://reddit.com/r/singularity/comments/1wi9e3i/
采集时间：2026-09-19 09:15 UTC。

- `cookingboy` 先给了对比（"v2.5-pro only scored 19%, and Kimi K3 is at 69% vs. Fable at 70%... There is a decent chance 2.6-Pro will be a Fable class model"），然后 `Ill_Distribution8517` 直接反驳：
  > "Absolutely not IMO. The benchmark is quite literally used while they are training, this is the worst way you can compare the model. Remember gemini 3.8 flash has a higher score than fable 5. No one in their right mind thinks fable 5 and 3.8 flash are equivalent."
  > 中文：我完全不认同。那个 benchmark 就是他们训练期间在用的，这是最没有意义的比较方式。想想 Gemini 3.8 Flash 分数比 Fable 5 还高，没哪个脑子正常的人会觉得 Fable 5 和 3.8 Flash 是一个水平。
- `Odd_Buddy_3615` 给出了**最具体的 overfitting 机制描述**（本次采集到的最好的一条）：
  > "I agree. When you do synthetic data generation and have large resources to spend on human labelling you can totally overfit to benchmarks without cheating on the holdout. E.g. you run eval, analyse your responses, find the holes and generate new data to plug them, repeat 100X. For some labs this is a closed automated loop."
  > 中文：同意。当你做合成数据、又有大量人力去做标注时，你完全可以在不碰 holdout 的情况下把 benchmark 过拟合掉。比如：跑评测、分析自己的回答、找出漏洞、造新数据补上、重复 100 次。对某些实验室来说这是一个闭环自动化流程。
- `0_op` / `Ill_Distribution8517` 的交锋（双方都没让步）：
  > `0_op`: "Do you understand the difference between training and validation?"
  > `Ill_Distribution8517`: "Are you that naive? Did they pinky promise that the benchmark they are using for the 10th in the last 24 hours is not in the RL curriculum? They have every incentive to train it on the bench."
  > 中文：你分得清训练和验证的区别吗？/ 你有那么天真吗？他们拉过钩保证过去 24 小时里第 10 次用的那个 benchmark 不在 RL 课程里吗？他们有十足动机把它训进去。
- `playpoxpax` 给了一段看板扫盲，其中关于数据集轮次的一段是**可复算的口径**（但他是网友解读，不是官方）：
  > "Total tokens is their entire post-training dataset. Current tokens is how much they take from the total on each step. Since they have 22B, and take 2.2B on each step, it means they need 10 steps to go over the entire dataset. They're currently on Step 11, so they're going the second round."
  > 中文：Total tokens 是他们后训练数据集的总量，current tokens 是每步取多少。既然总量 22B、每步取 2.2B，那走完一遍要 10 步。现在在第 11 步，也就是在走第二遍。

### 5.4 r/MachineLearning —— 没有相关帖子

用 `r/MachineLearning/search.json?q=mimo+OR+xiaomi&t=month` 查，返回空。**结论：r/MachineLearning 没有 MiMo RL 看板的讨论帖。**（采集时间 2026-09-19 09:15 UTC）

---

## 六、成本 / 卡数 / 沙箱并发：英文社区算了什么，没算什么

### 6.1 社区给出的数字（一线经验）

| 谁 | 说了什么 | 出处 |
|---|---|---|
| elie @eliebakouch | Pro（1.02T 总 / 42B 激活）493k 美元/天、70k/步、2.78 美元/样本轨迹、33.91 美元/百万 token；Flash（309B 总 / 15B 激活）247k/天、21k/步、0.86 美元/轨迹、9.25 美元/百万 token | https://x.com/eliebakouch/status/2100324137642131516 |
| `ttul`（HN） | 每秒 5 美元 → 约 43.2 万美元/天；够在 Modal 租 3,000 个 B300 节点 | HN 49732270 |
| `power97992`（Reddit） | 按 5 美元/卡/小时，2.6 pro 约 4,000 张卡 | r/LocalLLaMA 1wi9ebm |
| `ssn2000`（HN） | 总成本 120 万美元，追问 MFU 但不给数字 | HN 49732270 |
| 36kr 英文版 | 官方页面上设定的费率是 **30,834 美元/小时**，两轮合计约 115 万美元 | https://eu.36kr.com/en/p/3987697090722564 |
| Forkast | Pro 约 432,000 美元/天、5 美元/秒 | https://forkast.news/xiaomi-mimo-v2-6-breaks-cover-a-1t-class-chinese-lab-trains-in-public/ |

elie 那条推下面的回复也值得一提：`griff`（@dankschmoney）说 "$70k/step is so crazy when you parse it out like that"，`Mahesh KMB`（@reachmaheshkmb）问 "how many steps does a full run take at that rate? curious whether the RL phase ends up a small or major share of total training cost"，`Emanuel Teklu` 问 "Whos funding this?"。**没有人正面回答这几个问题。**

### 6.2 我用看板接口做的复算（我方实测）

采集时间 2026-09-19 09:20 UTC，接口 `/rl/api/status?run=pro` 与 `?run=flash`：

| | pro | flash | 合计 |
|---|---|---|---|
| 当前步 | 24 | 30 | — |
| 实时费率 | 5.71 美元/秒 | 2.855 美元/秒 | 8.565 美元/秒 |
| 折合每小时 | 20,556 | 10,278 | **30,834** |
| 折合每天 | 493,344 | 246,672 | 740,016 |
| 累计花费 | 1,948,319 美元 | 854,045 美元 | **2,802,364 美元** |
| 累计 token | 55,961,620,000 | 81,397,700,000 | — |
| 每步 token | 2,969,060,000 | 3,695,980,000 | — |
| 每步接受的轨迹数 | 25,088 | 25,088 | — |
| 每步启动的沙箱数 | 102,864 | 170,368 | — |
| 累计重启次数 | 11 | 5 | — |

pro 的 run_start 时间戳换算出来是 **2026-09-15 10:32 UTC**——所以「9 月 17 日开播」指的是罗福莉发推的时间，训练本身是 9 月 15 日就开始了。Forkast 和 RITS 写的"9 月 15 日开始"是对的。

**三个可以直接引用的派生结论**：

1. **"每小时约 3 万美元"完全自洽**，但它是 pro + flash 的合计费率（8.565 × 3600 = 30,834）。只看 pro 是 20,556 美元/小时。引用时要说清是哪一条。
2. **卡数只能反推，没有正面数据。** 按社区假设的 5 美元/卡/小时：pro 约 4,111 张、flash 约 2,056 张、合计约 6,167 张。分母换成 3 美元就是 1 万张出头，换成 1.5 美元就是 2 万张。**5 美元这个分母本身没有出处**，所以这个结论的误差范围极大，只适合当量级。
3. **沙箱并发没人算过，但数据是有的。** `env/active`（同时在跑的环境数）在 RITS 9 月 17 日的记录里是 pro 约 23,700、flash 约 37,800；我读到的 `sandboxes_step`（每步启动的沙箱总数）是 pro 102,864、flash 170,368。除以每步接受的 25,088 条轨迹：**pro 每接受 1 条轨迹要启动约 4.1 个沙箱，flash 约 6.8 个**。这个比值能解释为什么账单这么高——大量算力花在没被采用的 rollout 上。**注意这是我自己的除法，`sandboxes_step` 的确切口径看板没给说明，可能含重试，引用要带这个前提。**

---

## 七、benchmark overfitting / reward hacking / 长度刷分

按任务要求把三件事分开说，因为英文社区对这三件事的关注度差得很远。

### 7.1 benchmark overfitting：讨论最多，正反两方都有（一线经验）

赞成"有问题"的一方：
- HN `liuliu`（"边训边评不就是污染吗"）、HN `kingstnap`（配比会被无意识地推向 benchmark）、r/singularity `Ill_Distribution8517`（"这是最没意义的比较方式"）、r/singularity `Odd_Buddy_3615`（评测→找洞→造数据→重复 100 次的闭环）、r/reinforcementlearning `gigio123456789`（"训练用的 prompt 就是 benchmark 的题吗"）。

反对"有问题"的一方：
- HN `sspiff`（评测不回灌，只是测进展）、HN `lucrbvi`（"It's a common practice for big reinforcement learning runs"，大 RL run 的常规做法）、HN `brookst`（能瞄准 benchmark 不等于泄题）、r/LocalLLaMA `Cool-Chemical-5629`（中间检视不是最终成绩，而且是好事）。

**一个被反复提起但没人核实的细节**：DeepSWE 的评测口径。RITS 那篇写得很清楚（**官方二次，可信度较高**）：
> "The DeepSWE figures are intermediate checkpoints run by Xiaomi's own evaluation setup. They are not independent leaderboard entries. Scores from different harnesses or attempt counts are not directly comparable."
> 中文：DeepSWE 的数字是小米用自己的评测环境跑的中间 checkpoint，不是独立的榜单成绩。不同 harness 或不同尝试次数的分数不能直接比较。

### 7.2 reward hacking：有人提，但落在 judge 上，不在长度上

**最有价值的一条是 Andrew Carr（@andrew_n_carr）**，2026-09-17 12:04，链接 https://x.com/andrew_n_carr/status/2100435578030579982：

> "the weird part of this MiMo graph is that the judge and probe disagree 60% of the time. and for pro, disagreement goes up during training. would love to know how much of that is harder-to-judge behavior vs the model getting better at fooling the judge."

中文：这张 MiMo 图里最怪的地方是，judge（判分器）和 probe（探针）有 60% 的时间是不一致的。而且 pro 的不一致率在训练过程中是上升的。我很想知道这里面有多少是"行为变得更难判"，有多少是"模型变得更会骗判分器"。

对应的看板字段是 `penalty/stage_credit_group/select_v4/select_probe_disagree_rate`（判分器与探针的选择不一致率），ai-primer 记录的读数是 Pro 0.603、Flash 0.579。**Carr 自己明确说了公开图表只能证明不一致率在涨，证明不了是哪个机制。**

HN 上的 `transdev12` 也提了一句（但更泛）：
> "they've essentially exhausted pre training scaling and are looking to post training to expand capabilities, which is really just optimization via reinforcement learning against specific tasks aka bench maxing."
> 中文：他们基本把预训练扩展用尽了，转向后训练来扩能力，而后训练本质上就是针对特定任务的强化学习优化，也就是刷榜。

### 7.3 长度刷分 / length hacking：基本没人讨论

- **英文社区（HN 155 条 + Reddit 三个帖）里，把"长度"当成问题的只有 Sasha Rush 那三条推。**
- 没有人把长度上升和 `dynsam/avg@n` 的走势对照起来看，也没有人提"长度惩罚缺失""GRPO/DAPO 对长回答的偏好"这些可能机制。
- r/LocalLLaMA 帖子里只有楼主笼统提了一句 "context length (~90–100k mean!)"，没有人跟进。
- 我自己复算发现的一个可讨论点（**推测，不是社区观点**）：pro 的 `dynsam/avg@n` 在第 20 步见顶 0.6431 后连跌 4 步到 0.5964，而同期 obg8 的平均上下文长度还在从 13.7 万涨到 16.6 万。「长度涨、通过率回落」符合长度刷分的表象，但也可能只是这几步的题目更难，看板没有能区分两者的信息。**这条要标成我方推断，不能写成社区共识。**

---

## 八、看板数据的坑：英文社区指出了哪些

按任务点名的两类坑逐条查：

### 8.1 数字会回跳 / 可能是回放 —— 有人提，但只有一个人，且有反驳

**这是被误传最严重的一条。** Forkast 那篇（AI 撰写）写的是「Community members on Hacker News have noted that the dashboard numbers may reset or replay upon page refresh」，用了复数"community members"。回到原帖，实际只有 `hsbalanxvxjsmab` 一个人在反复讲这件事，而且被两个人反驳（`Bolwin` 的进度条类比、`Retro_Dev` 的"重启≠回滚"）。原句见第四节。
**采信度：不采信"数据是回放/假造"这个结论；采信"数字在页面刷新后可能回跳"这个现象本身，因为有两方都默认了中间数字是跳动的。**
`hsbalanxvxjsmab` 另外那条"重启日志和曲线对不上"（"the message stating the flash 2.6 flash run was restarted and 0 graphs correlate that restart"）我没能独立验证——看板上重启记录和曲线是否应该对应，看板没给口径。

### 8.2 离线评测落后训练进度 —— 有人提，而且是站得住的

- r/LocalLLaMA `Cool-Chemical-5629`：Pro 的 DeepSWE 分数还停在第 8 步，而训练已经到第 10 步。
- ai-primer（二手整理）转述看板口径：
  > "The DeepSWE chart is not presented as a fully live evaluator. The dashboard says it updates offline results for specific steps"
  > 中文：DeepSWE 图表并不是一个完全实时的评测器。看板说明它只针对特定步更新离线结果。
- RITS 也写了同样的话（"Mid-training evaluation... The latest plotted results were 63.72 for pro at step 10"，而当时训练已到第 13 步）。

**所以"离线评测落后训练进度"这条在英文社区有明确表述，可以采信。**

### 8.3 `timing_s/step` 是否含重启等待 —— 没有人提

任务点名的这个坑，**英文社区没有任何人讨论**。我也没有独立验证（看板没有给出字段定义说明）。看板确实暴露了 `timing_s/step`、`timing_s/outer_gen`、`timing_s/trainer_ops` 三个字段，并且 pro 的 `step.restarted_at` 字段是 null 而累计重启次数是 11，说明重启信息在别处——但**能不能从 `timing_s/step` 里看出重启等待，我不下结论，留给我方看板分析那边**。

### 8.4 其它被点到的口径问题

- **MFU 缺失**：`ssn2000`（HN）想要 MFU，`@auto_grad_` 在 wh（@nrehiew_）那条 "Any ideas?" 下面直接回了 "mfu"，而 MiMo 团队的 Lei Li（@_TobiasLee）回复 "yeah let us know if you want to see more metrics :)"。所以"该给什么指标"这件事，社区和官方在公开对话里已经有了互动。
- **成本口径不明**：r/LocalLLaMA 的 `ALIEN_POOP_DICK` 问那个美元数是"典型 GPU 算力成本"还是"电费"；36kr 英文版也写了「页面没有完整说明硬件折旧、能耗、人力等成本……不能代表完整的研发支出」（转述，原文是中文稿）。
- **判分器不一致率**：见 7.2，`andrew_n_carr` 指出这个指标涨了但无法归因。
- **`Claude Distill Requests: hidden`**：HN `singularity2001` 贴出的这一行，如果确实存在于看板上，属于"官方自己暴露了但没解释"的字段。**我没能独立验证这一行是否真在看板上**（当时没去翻全量字段名，2,029 个指标名里我只筛了 length/gen/obg8 相关的）。标为存疑。

---

## 九、任务点名的人：谁说了什么，谁没有

| 人 | 是否发言 | 内容 | 证据强度 |
|---|---|---|---|
| **Sasha Rush**（@srush_nlp） | 是，3 条推 | 见第三节；唯一谈生成长度的人 | 官方一手（本人 X） |
| **Nathan Lambert**（@natolambert / Interconnects） | 是，1 条引用推 | 2026-09-17：`"One of the coolest at-scale RL resources made public yet! You love to see it."`（这是迄今最有价值的、公开的大规模 RL 资源之一！乐见其成。）链接 https://x.com/natolambert/status/2100324332916335033 ，71k 浏览 | 官方一手（本人 X） |
| Nathan Lambert 的博客 | **没有** | 我把 Interconnects 的归档页和站内搜索 `search=mimo` 都翻了，最近一篇相关的是 2026-05-16 的 "Latest open artifacts (#21)"（提 MiMo 2.5），**没有关于这次看板的文章** | 我方实测（翻页结果） |
| **Yu-Xiang Wang**（@yuxiangw_cs） | 是，1 条引用推 | 2026-09-17：`"Great effort in keeping science in the open! Can't take my eyes off the run. Please try documenting any hiccups that may come up."`（把科学放在公开场合做，很了不起！我挪不开眼。请尽量把遇到的每一次故障都记录下来。）链接 https://x.com/yuxiangw_cs/status/2100318938878152936 。另注：他 9-11 发推说已从 UCSD 休假加入 NeoCognition 任 ML 总监（这与"UCSD 副教授"的现职描述已有出入） | 官方一手（本人 X） |
| **Han Xiao**（@hxiao） | 是，1 条回复 | 在罗福莉公告帖下：`"very nice and open! 🫡 just dont let cfo see this"`（非常好、很开放！🫡 就是别让 CFO 看到这个。）配了一张 GIF。**注意：36kr 英文版把这句转译成 "We should send this animated graph to the CFO."，语气和意思都不一样了——原文是"别让 CFO 看到"**。他的主页简介是 "VP, AI @Elastic prev: founder & ceo @JinaAI_"，所以"Jina AI 创始人"是历史职务 | 官方一手（本人 X 回复） |
| **Lucas Beyer**（@giffmana） | **没有** | 翻了他主页并滚动加载，含 MiMo/Xiaomi 关键词的帖子为 0 | 我方实测 |
| **Sebastian Raschka**（@rasbt） | **没有** | 同上，0 条 | 我方实测 |
| **Tim Dettmers**（@Tim_Dettmers） | **没有** | 同上，0 条 | 我方实测 |

### 其它在英文圈被引用的账号（都在罗福莉公告帖下）

- **elie（@eliebakouch）**——本次成本讨论的源头。第一条（2026-09-17 04:10）：`"wow insane, they are literally livestreaming the RL training run of Mimo V2.6 Pro (1T, 42B active) and Flash (309B, 15B active) with per batch data/harness composition and a ton of internal training metrics"`（18.8 万浏览）。第二条（4:41）给出上面第六节那张成本表。
- **`Atishay Jain`（@atishay404）**——提了一个很好的技术问题：
  > "per batch data/harness composition seems like a recipe for unstable training. do they control for distribution shift between batches?"
  > 中文：把每个 batch 的数据/harness 配比都露出来，看起来正是训练不稳的配方。他们有没有控制 batch 之间的分布漂移？
- **`SSH`（@SSHCodes）**：`"a. this is super cool b. the cost is going up a few dollars EVERY SECOND 😭"`
- **elvis（@omarsar0）**：`"This should be the standard for building open-source AI. $1M+ so far."`
- **wh（@nrehiew_）**：只发了 "Any ideas?"，官方 Lei Li 回 "yeah let us know if you want to see more metrics :)"，@auto_grad_ 回 "mfu"。
- **`Dmitry Legchikov`（@DLegchikov）** 在 Rush 帖子下：`"Twitch for training LLM models? We deserve it!"`

### 官方一侧（一手）

罗福莉（@_LuoFuli）2026-09-17 02:52 的公告帖，299.1 万浏览，是英文圈所有讨论的起点。全文：

> "Nearly half a year of silence. We spent it studying one problem: how far RL can scale. MiMo-V2.6 is in the middle of its RL run right now. Three things we scaled: compute (~2B tokens per step, 1568 prompts × 16 rollouts, fully async), environments and harnesses (multi-task agentic RL, mixed across multiple harnesses in one run), and grader compute (agentic in-group credit assignment, with test-case and rubric-based rewards). We'll open-source the details piece by piece over the coming weeks. Streaming the run: mimo.xiaomi.com/rl/"

中文：沉默了将近半年。我们一直在研究一个问题：RL 究竟能扩到多大。MiMo-V2.6 现在正在 RL 训练中。我们扩了三件事：算力（每步约 20 亿 token，1568 个 prompt × 16 条 rollout，全异步）、环境与 harness（多任务 agentic RL，一次训练里混多个 harness）、判分算力（agentic 组内信用分配，用测试用例和评分细则给奖励）。细节我们会在接下来几周里逐步开源。训练直播：mimo.xiaomi.com/rl/

同帖她自己补了两条：
> "We believe RL is one of the most scalable and efficient paths toward self-improvement."
> 中文：我们相信 RL 是通向自我改进的最可扩展、最高效的路径之一。
> "We hope this livestream sparks the research community's interest in the core challenges of scaling RL and encourages researchers to help us refine our training recipe. We've been delighted to see so much insightful analysis based on the detailed training metrics."
> 中文：我们希望这次直播能激发研究社区对 RL 扩展核心难题的兴趣，也鼓励研究者帮我们改进训练配方。看到基于这些详细训练指标的大量有见地分析，我们很高兴。

**官方口径里的技术要点（供对照）**：每步约 20 亿 token；1,568 prompt × 16 rollout；全异步；多 harness 混训；`grader compute` 与 "agentic in-group credit assignment"（组内信用分配，用测试用例和评分细则给奖励）。**注意"组内信用分配"和 GRPO 一类的组相对算法是同一个思路，但官方没有点名任何算法。**

---

## 十、没找到的、存疑的、不采信的

### 10.1 明确没找到

1. **80k→120k 的机制解释**——没有。第一节已说明 X 回复抓不到，HN 155 条和三个 Reddit 帖子都没有讨论长度。这是本次采集最清楚的负结果。
2. **r/MachineLearning 的讨论帖**——没有。
3. **Nathan Lambert / Interconnects 的文章**——没有，只有一条 X 引用推。
4. **Lucas Beyer、Sebastian Raschka、Tim Dettmers 的任何相关发言**——都没有（各自主页翻过）。
5. **`timing_s/step` 是否含重启等待**——英文社区零讨论。
6. **任何从看板数据正面推算卡数或沙箱并发的讨论**——没有。唯一的 4,000 卡是拿账单除以一个假设单价反推的。
7. **有人算过 grader compute 占多少**——没有。官方把 `grader compute` 列为三大扩展方向之一，但没人给出它的占比或单价。
8. **Pandaily 那篇的正文**——只拿到标题，JS 渲染没取到。

### 10.2 存疑（写了但不确定，引用要带前提）

1. **`"Claude Distill Requests":'hidden'` 这行是否真在看板上**。来源是 HN 用户 `singularity2001` 的一行评论，我没有独立验证。Forkast 据此推出"模型可能仍依赖外部专有模型的蒸馏"，**那一步是它的推断，不是事实**。
2. **"数字刷新会回跳"背后的机制**。现象有两方默认，但"是回放/假数据"只有一个人主张且被反驳。
3. **`sandboxes_step ÷ 每步轨迹数` 的意思**。我算出 pro 4.1、flash 6.8，但看板没给 `sandboxes_step` 的定义，可能含重试或预热（看板日志里有 "prewarm" 字样）。
4. **5 美元/卡/小时这个单价**。没有任何来源，是社区惯例假设。所有"约 4,000 张卡"的结论都建立在它上面。
5. **成本数字的口径**。罗福莉/看板没说明这个美元数包含什么。多位网友（HN `ssn2000`、Reddit `ALIEN_POOP_DICK`、36kr 转述）都在问，但没人得到答复。
6. **Yu-Xiang Wang 的现职**。任务描述写"UCSD 副教授"，他本人 9-11 的推文说已从 UCSD 休假加入 NeoCognition 任 ML 总监。

### 10.3 不采信

1. **Forkast 那句"Community members on Hacker News have noted..."**——把一个人的主张写成社区共识，且该主张有两条明确反驳。我按原帖处理，不引用 Forkast 的这个概括。
2. **ai-primer 声称的两条 X 证据**。它说 Cristóbal Valenzuela 那条推"把承诺说得更宽泛"，但我打开 `c_valenzuelab/status/2099898533331558800` 发现那条推**根本没提 MiMo**，是在讲 Runway 的幕后分享；它引的 `EMostaque/status/2099626935009657052` 也是**对别人的回复，与 MiMo 无关**。ai-primer 的其他部分（成本表、判分器不一致率）与 elie、Andrew Carr 的原帖对得上，但那两条链接是错的。**用 ai-primer 时只能用它转述的、能在原帖核对上的数字。**
3. **36kr 英文版对 Han Xiao 那句的转译**（"We should send this animated graph to the CFO"）——与原文 "just dont let cfo see this" 意思不同，以原文为准。
4. **把 Rush 那句概括成「表示好奇」的说法**——原文是怀疑（"too big a jump"），而且英文媒体一篇都没提过这条。以 X 原文为准。
5. **HN 用户 `hsbalanxvxjsmab` 关于"数据是假的"的整套主张**——单一来源、语气敌对、被两人反驳，且与我能实测到的接口数据（连续、量纲自洽、费率与独立来源对得上）矛盾。**不采信其结论，只记录其现象描述。**
6. **Forkast 的"47-point benchmark jump"**——它拿 65.97% 减 MiMo-V2.5 的 19% 得出 47 个点，但这两个数来自不同评测时间点，且 DeepSWE 1.1 的口径 RITS 已说明不可直接比较。这个差值不采信。

### 10.4 一个方法学提醒

这次采集最容易被后手误用的地方是：**"英文社区在热烈讨论 X"这句话，对长度、卡数、`timing_s/step` 这三件事都不成立。** 英文圈的热度集中在三处——成本账单、benchmark 是否被污染、看板是否可信。长度问题只有一个人提过一句；卡数和沙箱并发只有一个人反推过；`timing_s/step` 的口径零讨论。**把"没人讨论"写成"大家认可"是最容易犯的错。**

---

## 十一、来源清单

### 一手 X 帖子（均为本人账号，采集时间 2026-09-19 09:13–09:20 UTC）

1. Sasha Rush — "I'm on my phone monitoring the MiMo v2.6 response length on coding-obg8 like a degenerate gambler." https://x.com/srush_nlp/status/2100427133440950536
2. Sasha Rush — "Just insane you can watch this -> mimo.xiaomi.com/rl/" https://x.com/srush_nlp/status/2100427931705098465
3. Sasha Rush — "just feels like 80k->120k is too big a jump." https://x.com/srush_nlp/status/2100428266792272023
4. 罗福莉 Fuli Luo — 公告帖 https://x.com/_LuoFuli/status/2100296686719610932
5. elie — "wow insane, they are literally livestreaming the RL training run..." https://x.com/eliebakouch/status/2100316319459500128
6. elie — 成本拆解 https://x.com/eliebakouch/status/2100324137642131516
7. elie — 关于 OpenAI transparency 的对比 https://x.com/eliebakouch/status/2100362752845922405
8. Andrew Carr — judge/probe 不一致 60% https://x.com/andrew_n_carr/status/2100435578030579982
9. Nathan Lambert — "One of the coolest at-scale RL resources made public yet!" https://x.com/natolambert/status/2100324332916335033
10. Yu-Xiang Wang — "Great effort in keeping science in the open!" https://x.com/yuxiangw_cs/status/2100318938878152936
11. Han Xiao — "very nice and open! 🫡 just dont let cfo see this"（在 4 的回复区）
12. elvis（omarsar0）— "This should be the standard for building open-source AI. $1M+ so far." https://x.com/omarsar0/status/2100337683277173009
13. wh（nrehiew_）— "Any ideas?"（官方 Lei Li 回复）https://x.com/nrehiew_/status/2100394840123212261
14. Teortaxes — "huh. At least two labs are making a move now." https://x.com/teortaxesTex/status/2100314154892509644
15. Cristóbal Valenzuela — https://x.com/c_valenzuelab/status/2099898533331558800 （**经核对与 MiMo 无关**）
16. Emad Mostaque — https://x.com/EMostaque/status/2099626935009657052 （**经核对与 MiMo 无关**）

### Hacker News

17. "Xiaomi Mimo 2.6 live post-training dashboard"（549 分 / 155 评论，2026-09-16） https://news.ycombinator.com/item?id=49732270
18. Algolia 评论接口（我方取数入口） https://hn.algolia.com/api/v1/search?tags=comment,story_49732270&hitsPerPage=200

### Reddit

19. r/LocalLLaMA "Xiaomi MiMo 2.6 Live Training Dashboard"（446 分 / 75 评论） https://reddit.com/r/LocalLLaMA/comments/1wi9ebm/xiaomi_mimo_26_live_training_dashboard/
20. r/reinforcementlearning "Xiaomi is literally live-streaming a $1M+ agentic RL run for MiMo-V2.6"（114 分 / 11 评论） https://reddit.com/r/reinforcementlearning/comments/1wifr2m/xiaomi_is_literally_livestreaming_a_1m_agentic_rl/
21. r/singularity "Xiaomi Mimo 2.6 Live Training Dashboard"（126 分 / 16 评论） https://reddit.com/r/singularity/comments/1wi9e3i/xiaomi_mimo_26_live_training_dashboard/
22. r/MachineLearning 搜索（结果为空） https://www.reddit.com/r/MachineLearning/search.json?q=mimo+OR+xiaomi&restrict_sr=1&t=month

### 英文媒体与聚合站

23. RITS / NYU Shanghai Library — "Xiaomi Streams MiMo-V2.6 Reinforcement Learning Runs Live"（AI 辅助撰写，RITS 审核） http://rits.shanghai.nyu.edu/ai/xiaomi-mimo-v2-6-live-rl-dashboard/
24. Forkast — "Xiaomi MiMo-V2.6 Breaks Cover: A 1T-Class Chinese Lab Trains in Public"（署名 "Forkast mind"，AI 撰写） https://forkast.news/xiaomi-mimo-v2-6-breaks-cover-a-1t-class-chinese-lab-trains-in-public/
25. 36kr 英文版 — "$30,000 per hour, Luo Fuli's live stream is 'burning money'"（腾讯科技中文稿的英译） https://eu.36kr.com/en/p/3987697090722564
26. 36kr 英文版 — "Luo Fuli Follows Lei Jun to Launch Live Streaming..." https://eu.36kr.com/en/p/3986962267765767
27. TechNode — "Xiaomi livestreams MiMo-V2.6 reinforcement-learning runs" https://technode.com/2026/09/18/xiaomi-livestreams-mimo-v2-6-reinforcement-learning-runs/
28. AI Primer — "MiMo reportedly streams V2.6 Pro and Flash RL training metrics"（AI 聚合，两条 X 链接有误） https://www.ai-primer.com/engineer/stories/mimo-v26-live-rl-training
29. AI Weekly — "Xiaomi Publishes Live Post-Training Dashboard for Mimo 2.6 RL Run..." https://aiweekly.co/alerts/xiaomi-publishes-live-post-training-dashboard-for-mimo-26-rl-run-streams-real
30. Interconnects 归档页与站内搜索（用于确认**没有**相关文章） https://www.interconnects.ai/archive?sort=search&search=mimo

### 看板本体（我方实测取数）

31. 看板首页 https://mimo.xiaomi.com/rl/
32. `/rl/api/runs`、`/rl/api/status?run=pro|flash`、`/rl/api/tags?run=pro`、`/rl/api/series?run=pro&v=3-5513.24.12.23&tags=...`
    用到的具体指标名：`ctx_total_length/code/dataset-obg8/mean`、`ctx_prompt_length/code/dataset-obg8/mean`、`ctx_total_length/code/dataset-obg8/max`、`ctx_total_length/code/dataset-obg8/clip_ratio`、`ctx_total_length/mean`、`dynsam/agg_turn/mean`、`dynsam/avg@n`、`timing_s/step`、`env/active`、`partial/avg_staleness`。

### 被拦截 / 不可达

33. xcancel.com —— 451 "XCancel service is suspended"
34. lightbrd.com —— 403
35. nitter.perennialte.ch —— 403
36. tech.yahoo.com 转载页 —— 403
37. pandaily.com —— 只返回标题，正文 JS 渲染未取到
38. ai.jp.net —— Cloudflare 拦截（"Just a moment..."）

### 截图（过程产物，非交付物）

- `.playwright-mcp/mimo-en-srush-80k-120k.png` —— Rush 的 80k→120k 帖与其上下文
- `.playwright-mcp/mimo-en-srush-profile.png` —— Rush 主页（含 "monitoring ... coding-obg8" 那条）
- `.playwright-mcp/mimo-en-x-eliebakouch-cost.png` —— elie 的成本拆解帖（成本表的原始出处）
- `.playwright-mcp/mimo-en-dashboard.png` —— 看板首页

---

## 附：术语速查表

- **`dynsam/avg@n`** — 看板首页的主指标。把同一道题采样 n 次、算各次是否成功，再对所有题取平均。可以粗略理解为"训练时的平均通过率"，它和 DeepSWE 那种离线 benchmark 不是一回事。
- **`ctx_total_length` / `ctx_prompt_length`** — 前者是"进入模型的总上下文长度"（含喂进去的题面和模型自己生成的全部内容），后者只算喂进去的部分。两者相减才是模型生成了多少。Rush 说的"response length"在看板上没有单独字段，最接近的是 `ctx_total_length`。
- **`clip_ratio`** — 被长度上限截断的样本比例。非零就说明有样本撞到上下文上限了。
- **`dynsam/agg_turn/mean`** — 每条轨迹的平均回合数，agentic 任务里就是模型和环境来回交互了多少轮。
- **`partial/avg_staleness`** — 异步训练里，参与训练的数据平均落后当前模型多少个版本。数值越大说明样本越"陈旧"。
- **`train_infer_diff/*/kl`** — 训练器和推理引擎之间策略分布的差异，涨了说明两边跑偏了。
- **`passrate/zero` / `passrate/one`** — 一道题的 16 次尝试全失败 / 全成功的比例。全失败或全成功都给不出组内相对梯度，所以这类题对训练没用。
- **grader compute（判分算力）** — 官方列的三大扩展方向之一：跑测试用例、跑评分细则、判分所消耗的算力，和"训练参数更新"的算力是两笔账。
- **in-group credit assignment（组内信用分配）** — 官方原话。对同一道题的一组尝试互相比较、决定哪条该被强化，GRPO 一类算法就是这个思路，但官方没点名算法。
- **MFU** — Model FLOPs Utilization，模型实际算力利用率。衡量"卡有没有跑满"的标准指标，社区多次追问，看板没给。
- **benchmaxxing / 刷榜** — 通过数据配比或后处理把 benchmark 分数做上去，不必然等于泄题。
- **判分器与探针的不一致率** — 看板字段 `penalty/stage_credit_group/select_v4/select_probe_disagree_rate`。同一批行为，判分器（judge）和探针（probe）给出不同判断的比例。
