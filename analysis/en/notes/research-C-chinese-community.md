# Interpretations, observations, and doubts from the domestic community (mainly Zhihu) regarding Xiaomi MiMo-V2.6 RL's public training dashboard

> Material identity: **measured collection**. Section 7 is second-round supplementary collection (V2EX / linux.do / Dalao Shuo, switched to a proxy browser). In this document, numbers marked "our own measurement" are the original text read on 2026-09-19 by actually opening pages with a non-proxy Playwright browser; those marked "official second-hand" are Chinese media relaying Xiaomi's dashboard/Luo Fuli's statements; those marked "frontline experience" are personal statements from the Chinese community, with no official confirmation seen.

## 1. Collection background, method, and environmental limitations

Collection time: afternoon of 2026-09-19 (Beijing time, approximately 17:00–17:25). Collector: data collection sub-agent (research-C).

Scope: **Chinese community interpretations** related to the real-time reinforcement learning training dashboard (`https://mimo.xiaomi.com/rl/`) publicly released by the Xiaomi MiMo team starting on the evening of 2026-09-15 for mimo-v2.6-pro / mimo-v2.6-flash. Zhihu first, then reposts and analyses by 36Kr/Aifanr/QbitAI/ITHome/TMTPost, etc., then scanned V2EX, WeChat public accounts, CSDN, and tech forums.

Method: opened page by page with a non-proxy Playwright browser, taking `document.body.innerText` for `browser_evaluate` (more complete than the accessibility snapshot), scrolling to load when necessary; Zhihu article pages were readable, but on-site search and the Zhihu API were unavailable. Bing / Sogou WeChat search results pages were additionally used as discovery leads, **but all quoted original text comes from pages I actually opened**; search snippets were not used as citations.

Environmental limitations (affecting reproducibility, stated up front):

- Zhihu on-site search is blocked by a login wall. `https://www.zhihu.com/search?type=content&q=MiMo%20v2.6` only returns "No related content found; ask a question to get a quick answer"; the Zhihu answer API `/api/v4/questions/{id}/answers` returns 403 (error code 40362, "Your current request is abnormal"). So Zhihu content was located via Bing `site:zhihu.com` and keyword search, then the article pages were opened directly.
- The Zhihu question `如何评价小米公开进行大语言模型Mimo V2.6的大规模强化学习训练？` has 133 answers, 591 followers, and 950,000 views; without logging in, only the top 3 by ranking can be seen; "View remaining 130 answers" requires login. **The remaining 130 answers were not collected in this round**.
- V2EX could not be opened in the first round (connection timeout, `web_fetch` also failed). **In the second round, switching to a proxy browser succeeded in supplementary collection**—the two posts happened to be discussions of "how to calculate cost", with very solid content, see Section 7.
- `linux.do/t/topic/2913997` had its connection refused in the first round, and `locdd.com/t/topic/92015` navigation was interrupted. **In the second round, switching to a proxy browser opened them all**: linux.do is valuable (including a readback of the official MoE failure announcement and frontend billing code), locdd confirmed to have no technical content. See Section 7.
- The original WeChat public account text was not obtained. Sogou WeChat only gives titles and one or two lines of summary; clicking through requires redirect authorization, so this round only treats titles/summaries as leads, not as citation sources.
- Screenshot failed. Both this machine's Playwright `page.screenshot` and the MCP screenshot tool timed out (even after "fonts loaded" had passed, they still hung), so this round left no screenshots with the `zhihu-` prefix. This is an environmental issue, not a page issue.
- Weibo, Jike, and Bilibili comment sections were not collected in this round. The relevant Bilibili video pages were not opened, and comment section text was not obtained.

## 2. Conclusions up front

1. **The quality of Chinese community interpretations of this dashboard varies enormously; the two most solid articles are both on Zhihu**: Wang Peng LLM's 《Livestreaming RL Training to the Whole World: A Deep Breakdown of Xiaomi MiMo-V2.6's Real-Time Dashboard》 (20 upvotes) does a full metric panorama and reverse-engineers the recipe; vibe life's 《MiMo-v2.6 RL Training Dashboard · Metric Definitions and Terminology Explanations》 (67 upvotes, edited 2026-09-19 10:08) turns about 2019 tags into a metric dictionary and provides health interpretation of real-time readings. These two are "usable" material, while many others are 36Kr-affiliated/self-media retellings of "30,000 USD per hour". (Our own measurement: both pages were opened)

2. **The much-repeated "programming task generation length suddenly jumped from 80k to 120k" has had its source found, but the Chinese community only relayed it without explaining it**. The original quote comes from former Cornell professor and Cursor model R&D participant Sasha Rush; Zimubang's report wrote: "He joked about himself that looking at the response length of a programming task gave him the feeling of a gambler getting carried away, and then he began to mutter about the change in the number: 'Going from 80k to 120k, this magnitude feels too large.'" (official secondhand: Chinese media relaying an overseas researcher X's statement) The Chinese community's own length observation is "average context approaching/breaking through 100k tokens," and no one has connected 80k→120k with length-inflation score gaming and reward hacking.

3. **Someone did calculate the number of cards from the dashboard**. On the tech forum "Lunchuizhe" someone wrote: "btw: cost consumption is a constant, pro is $5.71/second, flash is $2.85/second. Combining commercial electricity at 1 RMB/kWh and 5090 rental at $4/hour, it's roughly equivalent to 5,000 5090s for the pro model and 2,500 5090s for the flash model." (firsthand experience) Our recalculation: 5.71×3600÷4≈5139 cards, 2.85×3600÷4≈2565 cards, consistent with that post's conclusion. As a cross-reference, Luo Fuli said in an interview that training MiMo-V2-Pro and Flash "each requires several thousand compute cards" (official secondhand, relayed by Zimubang).

4. **The dashboard's "cumulative cost" is not actual metered billing, but a fixed rate multiplied by time**. The same Lunchuizhe post explicitly wrote "cost consumption is a constant"; a deep dive on Zhihu also recorded the two constant rates pro `$5.71/秒` and flash `$2.86/秒`. The resulting "$30,800–$30,900 per hour" is cited by almost all Chinese reports as a spending fact, but no one explains that it is a bill extrapolated from rates and that it continues accumulating as usual during restart waiting periods. (firsthand experience + our measured recalculation)

5. **The doubts focus on three points, all more clear-headed than the media headlines**: UCSD associate professor Yu-Xiang Wang requires that problems during training be recorded; markhuang's Chinese analysis says "it is still far from an audit"—architecture, parameter count, data recipe, license, and model card are all absent; the high-upvoted Zhihu answer by mix.jinny (674 upvotes) directly says "feels like flash is a bit overfit here." On "whether the benchmark scores can be trusted," ic.work lists DeepSWE's two hard flaws: SWE-bench Verified has hidden data contamination risks, and the initial version of DeepSWE had 4 reference solutions that failed its own verifier. (firsthand experience / official secondhand)

6. **The numbers conflict between Chinese reports, and one place is QbitAI writing the comparison baseline wrong**. QbitAI's Zhihu column wrote "(compared with DeepSeek-Flash v1.1, it is 74.2%)," while the table given by ic.work is DeepSeek-V4-Flash about 53%, DeepSeek-V4-Pro about 63%, and "the highest environment configuration can reach about 74%." 74.2% looks more like a Pro result under a high-end configuration, hung under Flash's name. (our check: comparison of the original text of the two pages)

## 3. How the Chinese community interpreted this dashboard

### 3.1 Zhihu: one deep dive + one high-popularity Q&A + one metric dictionary

**Wang Peng LLM "Streaming RL Training to the Whole World: A Deep Dive into Xiaomi MiMo-V2.6's Real-Time Dashboard"** (published 2026-09-18 01:00, Hubei, 20 upvotes). The data snapshot is labeled "late night 2026-09-17 (Beijing time)." Core numbers (official secondhand, scraped via its API):

- Cumulative cost total `$1,599,638`; pro `$1,098,877` (`$5.71/秒 ≈ $20,556/小时`), flash `$500,761` (`$2.86/秒 ≈ $10,278/小时`).
- Cumulative tokens: pro 32.5B, flash 49.4B; the two lines combined 81.9B, apportioned to `$19.5 / M token`. The article writes "the two lines combined ≈ $30,834/hour, matching the media report of 'about $30,900 per hour'."
- The training batch per step is `1,568 prompts × 16 rollouts = 25,088` trajectories; `train/verdicts/trained` is identically equal to 25,088.
- Average trajectory context: pro `72k → 106k` tokens, flash `71k → 129k` tokens; context upper limit 1,048,576.
- Concurrent sandboxes `env/active`: pro about 22,400–31,100, flash about 37,300–39,300.
- The metric emphasis is on penalties and the data pipeline: `penalty/` 535 tags (of which 523 belong to `stage_credit_group`), `critic/` 324, `actor/` 257, `partial/` 327.
- Anti-cheating related: `select_hack_attempt_rate ~0.38` ("proportion of attempts flagged as 'suspected opportunistic gaming'"), `select_hack_attempt_ge_min_rate ~0.04`; grading time `scg/time_total_sec_mean 510 ~ 655 s`, the author comments "grading code is more expensive than running code!"
- One transferable judgment rule it gives is worth remembering: **to see whether an RL system is mature, first look at where the metric emphasis is**—MiMo has only a few loss-type metrics, and more than half of its metrics monitor data quality, asynchronous consistency, and reward credibility.

**Zhihu question "How to evaluate Xiaomi openly conducting large-scale reinforcement learning training for the large language model Mimo V2.6?"** (3 answers visible without logging in):

- Kitt's AI Notes (404 upvotes): "I took a look, this is the post-training Dashboard for MiMo-V2.6. It has been training for about a day, spent about $1.2 million, and consumed about 60B tokens." "MiMo-V2.6 Pro is about $36/M tokens, MiMo-V2.6 Flash about $8/M tokens. This is the training cost; converted to inference, it can be about 30-50x cheaper." On data distribution he writes "currently each step has about 1,500 prompts, of which about 1,050 come from code, around 70%."
- Lianmao (author of GSYVideoPlayer, 315 upvotes): first asks about its lineage—"Is this borrowing the form of Stanford's live-streamed training of Marin 535B-A23B MoE?"; he gives reservations about technical novelty—"But whether it's multi-task, multi-harness, test reward, rubric reward, asynchronous rollout, or long-trajectory credit assignment, it seems there's nothing new"; at the same time confirms "two-thirds of the prompts come from code."
- mix.jinny (674 upvotes, 87 comments, the highest of the three answers): "From the cost perspective, it is still fairly in line with empirical expectations, flash is about 8 bucks/B token, pro about 30 bucks or so, mainly still a rollout efficiency problem." "As for the training process, feels like flash is a bit overfit here, don't know what adjustments will be made later."

**vibe life《MiMo-v2.6 RL Training Dashboard · Metric Definitions and Terminology Explained》** (67 upvotes, edited on 2026-09-19 10:08, Zhejiang). This is currently the most complete metric dictionary in the Chinese-language community, and it explicitly states which parts are inferences: "Standard PPO/RL metric definitions are exact; for Xiaomi's self-developed multi-turn credit assignment/grader pipeline such as penalty/stage_credit_group, select_*, etc., the source code is unavailable, and the relevant definitions are inferred from naming". Its first-hand reading interpretation (official secondary + its inferences):

- Average context `ctx_total_length/mean` 99.6k / 98.8k and rising, annotated as "trajectories are longer (more turns/longer reasoning), cost is rising".
- Average turn count `dynsam/agg_turn/mean` 64.8 / 54.1, with the note "needs to be viewed alongside pass rate, to prevent 'turn count inflating while effect does not rise'".
- `dynsam/passrate/one` 25.6% / 24.4% and rising; it did the math: "zero+one ≈ 40% of prompts are discarded by dynamic sampling; if it keeps rising, recommend increasing difficulty/changing curriculum or supplementing harder data".
- Per-step time `timing_s/step` 2h54m / 2h49m rising, "root cause is longer context/trajectories".
- One reading it itself warns not to misread: `partial/avg_staleness` 1.21 / 0, "blue drops sharply to 0 at the end = partial buffer draining / switching to synchronous / the wrap-up step; do not treat as a trend".
- Its mapping of the two runs is **inference, not confirmation**: "Inferring backward from the time-cost structure, orange is suspected to be pro (heavier training), blue is suspected to be flash (lighter training, greater parallelism)——this is only inference, not confirmation."

It also left the only "framework attribution" Q&A I collected: someone in the comment section asked, "Can you tell what framework is being used from the training dashboard?" The author replied, "The wishing machine told me that judging from the metric names, it might be verl" (first-hand experience; the author himself also marked it as uncertain).

### 3.2 Financial and technology media: turned "USD 30,000 per hour" into a headline

For the same matter, the media versions are basically retellings of Luo Fuli's X post + dashboard snapshots, with the only difference being the snapshot time. Sorted by time (all official secondary):

- QbitAI (Zhihu column, 86 upvotes, 2026-09-17 08:55): "36 hours from when the pro model started training, the two models have already spent over USD 1.08 million, averaging USD 30,000 per hour."
- ITHome (reposted by Phoenix Technology, 2026-09-17 13:03): "total spend has exceeded USD 1.25 million"; it rendered the three-axis expansion as "Compute (about 2 billion tokens per step, 1,568 prompts × 16 rollouts, fully asynchronous) / environment and tools…… / Grader Compute (adding compute to the grading / scoring process itself, Agentic In-group Credit Assignment, including test cases and rubric rewards)".
- ifanr/APPSO (reposted by 36Kr, 2026-09-17 13:34): pro step 12, about 301K samples, cost about USD `806,349`, 25.1B tokens; flash step 17, about 426K samples, USD `354,499`, 40.5B tokens; "the two versions' current cumulative training cost has exceeded USD 1.16 million, with average hourly compute cost reaching about USD 30,900". It is also one of the few that mentions context: "ctx_total_length data shows that MiMo-V2.6-Pro's current average context length has already approached 100,000 tokens, and the Flash version has also exceeded this scale."
- Tencent Technology (reposted by 36Kr, 2026-09-18 10:51): "According to the cost rate set by Xiaomi MiMo's official interface, USD 30,834 per hour, the cumulative displayed cost of the two training runs is about USD 1.15 million. However, the page does not fully explain costs such as hardware depreciation, energy, and labor. This number can be used to observe the scale of investment in this round of training; it cannot represent the full R&D expenditure." This sentence is the most restrained passage on cost basis among Chinese media.
- TMTPost (reposted by China.com, 2026-09-19 08:03): "As of the afternoon of September 17, the Pro model had trained for over 45 hours, spending about USD 930,000; the Flash model had trained for 40 and a half hours, spending about USD 416,000"; DeepSWE v1.1 "Pro pass rate 65.78%, Flash 60.77%"; and listed reactions from overseas researchers——"Meta researcher Lucas Beyer praised Xiaomi for disclosing training costs, and UC San Diego associate professor Yu-Xiang Wang also expressed strong interest in the training details. Cornell professor Sasha Rush also joined the discussion, raising questions about the change in numbers."
- PChome (2026-09-18 11:15): "The cumulative training cost of the two versions has exceeded USD 1.35 million……Combined, the current training phase's total hourly spend is about USD 31,000, equivalent to over RMB 200,000."

The same batch of numbers landed in the Zhihu comment section in a more blunt form. Under the QbitAI piece (our own observation, 25 comments partially visible) there were: "If the model is good, just release it and let its capabilities speak; doing these livestream gimmicks" (Xiong Boshi); "Dongzi's 'don't compete with Lei Jun on marketing' line keeps gaining value; their marketing point is model capability and ranking, while Lei Jun directly markets training + burning money" (Buyan Buyu); "Percy Liang's lab already livestreamed this; good eye, decent imitation, don't hype the rest" (Zhou Sheng). They are all emotional judgments, but the point that 'livestreaming is not the first of its kind' is in the same direction as the Stanford Marin livestream mentioned in the Zhihu answer.

### 3.3 Self-media and technical blogs: metric dictionary, cost breakdown, "due skepticism"

- YOMXXX's "Tool Quick Review" (2026-09-17) is unexpectedly high quality; it has a dedicated "due skepticism" section, and three of its four points are basis issues: the reward mean `0.614` is the change relative to "the first step", and "reading ▲0.049 as 'a 4.9% capability improvement' is wrong"; DeepSWE only has a single benchmark and single configuration; "it is unclear what basis the cost figures include. Whether USD 769,000 is compute, or compute plus data plus labor, the dashboard does not break it down"; and "the dashboard solves 「training observability」, not 「capability verifiability」". The snapshot it gives is pro `76.9 万`/22.8B/step 12, flash `33.6 万`/37.8B/step 17, context averages 86.6k and 104k, average turn counts 46.9 and 52.6, and in batch composition code 11 sources, 1,023 prompts, 65.3%.
- ic.work (Ada Vector, 2026-09-17) gave the most detailed cost breakdown: as of the 9-16 snapshot `$106.2万`, `58.4B` tokens, “comprehensive average price per million tokens $18.18”, “Pro unit price: about $35.94 / 1M”, “Flash unit price: about $8.50 / 1M”. It also wrote a key piece of context: “Previously in the MiMo-V2-Flash technical report, Xiaomi disclosed a training system with multiple teachers in policy distillation and over one hundred thousand verifiable tasks. The shift at the V2.6 stage now clearly shows that the period of easy gains from purely feeding distillation data from teacher models has ended”—this is the only one in Chinese materials that brings “distillation” into a causal explanation, but it does not provide evidence of “distillation traces”.
- markhuang.ai “Xiaomi's livestream of MiMo 2.6 training process: clear bill, recipe still hidden” (Chinese version, 2026-09-16, the sharpest piece I collected): “When I opened the page on September 16, 2026, the real-time estimate showed that the total cost of the two training runs had already exceeded $1 million. The page also said: Flash completed 15 steps, Pro completed 10 steps, and there were six restarts in between.” “The dashboard looks best exactly when the subsequent scores drop. A published number erases checkpoint selection and run-to-run variance.” “The livestream page says the MiMo 2.6 series is coming soon, but architecture, parameter count, training data recipe, license, safety evaluation, release date, model card—none of them are given.” It also mentions the contrast in the English-speaking community: “In a small post on r/LocalLLaMA, some people praised this transparency, while others were uneasy about a seven-figure bill paired with a benchmark decline.”
- The two articles on CSDN are counterexamples. `deepseek23` “Fully Asynchronous RL Breakdown” — the parts about R3 (Rollout Routing Replay), fine-grained sequence scheduling, and request-level prefix caching appear to be restated from past MiMo technical reports, and are usable; but the full text has traces of AI generation (no author background, no data sources), so it can only be treated as a secondhand overview. `weixin_42602726` “How TaoToken Strings Together Agentic RL Calls” is essentially a promotional piece for an API relay service, half the body is advertorial; I only took one folk estimate from it: “Some developers, based on the throughput rhythm in the livestream, estimated that the cost at peak stages could approach the order of ten dollars per second”—marked as “frontline experience”, and I do not trust its accuracy.

## 4. Four issues of special concern

### 4.1 “Generation length 80k→120k”: source found, explanation not found

Conclusion first: **this statement is not original to the Chinese community; it is a Chinese media paraphrase of Sasha Rush's X post; the Chinese community has not given a mechanistic explanation for this sudden increase, nor has anyone connected it to length inflation or reward hacking.**

The only original source (the page as tested by us, Zimubang article, reposted via 36Kr/oiindex):

> Sasha Rush, a former Cornell University professor who participated in the development of the Cursor model, also stared at the livestream on his phone. He joked that watching the response length of a programming task gave him the feeling of a gambler getting carried away, and then he began to mutter about the change in the number: “Going from 80k to 120k, that jump feels too large.”
>
> —— “How much pressure is Luo Fuli under? She even put Xiaomi's model training on livestream”, source 36kr, page https://www.oiindex.com/industry/125292.html，采集时间 2026-09-19 17:15

Evidence strength: official secondary (Chinese media paraphrasing an overseas researcher's X post; I did not open the original X post). This sentence was copied across multiple sites from the same article (Sina Finance, Guancha Fengwen, Futu Niuniu, alphaseek, etc.), constituting multi-point reposts from a single source, and cannot be treated as independent corroboration from multiple parties.

The Chinese community's own discussion of “length” uses a different measure. The Zhihu metric dictionary records `ctx_total_length/mean` at about 99.6k/98.8k and rising, iFanr writes “close to 100,000 tokens”, and YOMXXX records 86.6k/104k. These are all **the mean total prompt+response length of the entire trajectory**, not the model's generation length for the programming task; the three numbers fall in the 86k–104k range, with no 120k appearing. In other words, “80k→120k” cannot be seen on the charts as a phenomenon at the mean level, and is more like a step Sasha Rush saw while staring at a single task curve. I state clearly here: **I cannot align the measurement basis for these two numbers in the Chinese materials I have collected; they are doubtful**.

A related but different point: the Zhihu metric dictionary gives a warning about the side effects of length—when `agg_turn/mean` rises, “guard against ‘turns inflating without effect improving’”, and when `passrate/one` keeps rising, it “suggests increasing difficulty/changing curriculum”. This is the closest the Chinese community comes to expressing “length inflation”, but it speaks of interaction turns and tasks being too easy, not generation length. (frontline experience)

### 4.2 Cost, GPU count, sandbox concurrency: someone actually did the math

**Cost.** The “30,000 USD per hour” cited throughout the Chinese-speaking world comes from the constant rate built into the dashboard. The line from the Lunzhui forum is a source-level description of this claim (frontline experience):

> btw: cost consumption is a constant, pro is 5.71 USD/s, flash is 2.85 USD/s.
>
> —— “Xiaomi opened a post-training monitor page for a model”, https://lcz.me/topic/1771，采集时间 2026-09-19 17:12

A Zhihu deep dive gives another way of writing the same set of rates: pro `$5.71/秒 ≈ $20,556/小时`, flash `$2.86/秒`, combined total for the two lines `≈ $30,834/小时`. Tencent Technology writes “according to the fee rate set by Xiaomi MiMo's official API, 30,834 USD per hour”. The three sources match, so the number “30,800 USD per hour” is self-consistent in itself; **what is not self-consistent is its nature**—it is rate multiplied by time, not measured usage multiplied by unit price, and it also accumulates during restart waiting periods.

**GPU count.** The full calculation in that Lunzhui forum post (frontline experience): assuming a commercial electricity price of 1 yuan/kWh and a 5090 rental cost of 4 USD/hour, “it is roughly equivalent to 5,000 5090s for the pro model and 2,500 5090s for the flash model”. Our recalculation: `5.71 × 3600 ÷ 4 ≈ 5,139`, `2.85 × 3600 ÷ 4 ≈ 2,565`, consistent with the post's conclusion. In the same thread, someone (Xiaote) poured cold water on it, and they are right in direction:

> 1) Back-calculating $5.71/s into “5,000 5090s” is fine as an order-of-magnitude comparison, but do not treat it as the actual cluster size. External API unit prices include gross margin, redundancy, and peak provisioning, and are usually higher than actual training occupancy; moreover, the $4/h for a 5090 is the current rental price, and both variables are moving, so the product is only suitable for order-of-magnitude judgment. 2) The assumption that “cost is a constant” needs its boundary stated clearly: it holds only for a given model and a given sequence length distribution; once long context and MoE activation volume change, $/token is no longer a constant.
>
> —— Reply on floor 4 of the same post, https://lcz.me/topic/1771

The independent cross-reference is Luo Fuli's own statement: training MiMo-V2-Pro and Flash "each requires several thousand compute cards, but research requires even more cards" (official secondary, Zimubang's relay of her April interview). "Several thousand" and "about 5,000 5090-equivalent" are on the same order of magnitude, but the two have different bases (one H-series card ≠ one 5090), so they cannot be directly divided.

**Sandbox concurrency.** This is what the Chinese community calculates the most and most consistently: the Zhihu breakdown gives pro `env/active` about 22,400–31,100, flash about 37,300–39,300; the metric dictionary snapshot is 23,653 / 39,296; the two agree (official secondary). In addition, flash's `env/total_setup` rebuilds about 25,000 per step, up to 250,000, with cumulative sandboxes 4.75 million—this is the basis for the judgment that "the environment factory is harder to scale than the training cluster."

### 4.3 benchmark overfitting / reward hacking / length inflation score gaming

Ranked from strong to weak evidence:

- **"flash is a bit overfit"**, Zhihu mix.jinny (674 upvotes): "As for the training process, it feels like flash is a bit overfit here; not sure what adjustments will be made later." (first-hand experience, no basis given, and did not say which curve this was seen on)
- **"Benchmarks cannot be treated as delivery commitments"**, ic.work: the lines that set the tone are "a leap in benchmark scores does not equal landing productivity; a unified evaluation scaffold smooths over the engineering reefs of real scenarios," and it lists two hard defects of DeepSWE—DeepSWE v1.1 covers "113 brand-new multilingual tasks in 91 code repositories, with each task involving 7 code files and 668 lines of code changes on average," but "independent technical audits had previously pointed out that the initial version of DeepSWE itself had flaws such as 4 reference solutions failing their own validators and some tasks lacking reproduction patches"; at the same time it points out that the replaced SWE-bench Verified "has serious training-set memorization and data contamination risks." (official secondary + third-party audit relay)
- **"The score will go back down"**, markhuang.ai: "Flash's published score rose from 48.67 at step 1 to 60.77 at step 12, but some checkpoints in between were actually lower than the previous step." It therefore refuses to draw a conclusion from a rising curve. (official secondary + its judgment)
- **Whether the "progress" brought by long context is equivalent to capability**, Zhihu metric dictionary's `agg_turn` note and `passrate/one` note are the closest thing in the Chinese community to a warning about "length/turn-count padding," but it talks about turn count and task difficulty, **not model generation length inflation**. (first-hand experience)
- **Discussion of reward hacking basically stops at metric names**. The Zhihu breakdown copies out `select_hack_attempt_rate ~0.38`, three-level rule hit rate, `select_regression_flagged 10 ~ 67` and comments "reward hacking is not a hypothesis, it is a 38% high-frequency event"; the metric dictionary gives field definitions such as `select_hack_attempt / _rate`, `select_hack_attempt_ge_min`, `select_hack_exposed_not_relied`. **No one questions this 38% statistical basis** (is it function-level, turn-level, or trajectory-level? what is the denominator?), and no one uses it to argue for "overfitting." This is the biggest gap in this item.
- I did not find a single statement in the Chinese community linking "generation length 80k→120k" to reward hacking / length inflation / score gaming.

### 4.4 Pitfalls of the dashboard itself

Ranked from "someone explicitly said it" to "only I infer it":

1. **The cost number is a rate, not a measurement.** Lun Chuizhe's exact words are "cost consumption is a constant," and gives `$5.71/s`, `$2.85/s`. This directly overturns the intuition that "the dashboard is billing in real time." (first-hand experience)
2. **What the cost basis excludes is not written on the panel.** Tencent Tech: "The page does not fully explain hardware depreciation, energy, labor, and other costs… it cannot represent complete R&D spending." YOMXXX puts it more directly: "Is $769,000 compute, or compute plus data plus labor? The panel does not break it down. Be careful about basis differences when comparing across vendors." (official secondary / first-hand experience)
3. **The mean reward is a relative shift, not an absolute capability value.** YOMXXX: "The mean reward 0.614 is the change relative to the first step, not an absolute capability value. Reading ▲0.049 as 'capability improved by 4.9%' is wrong." (first-hand experience, consistent with the fact that the dashboard headline uses `avg@n` rather than absolute reward)
4. **Offline evaluation clearly lags behind training progress, and Chinese media themselves admit they cannot explain the fluctuations.** Tencent Tech: "Pro trains one Step more slowly, so the latest score is not out yet." "The public data is still not enough to explain each change." Aligning the snapshots by time makes it clearer: in markhuang's 9-16 snapshot, flash has trained to step 15 and evaluated to step 12, pro has trained to step 10 and evaluated to step 8; in Wang Peng's late-night 9-17 snapshot, pro has trained to step 15 and evaluated to step 12, flash has trained to step 20 and evaluated to step 16. Both snapshots show evaluation lagging 2–4 steps, and one step takes 2 hours 49 minutes to 2 hours 54 minutes. (our own measurement: cross-comparison of the two snapshots; official secondary)
5. **"Duration does not include restart waiting"—I did not find anyone who directly said this.** The relevant evidence collected actually points in another direction: since cost accumulates as a fixed rate times the clock, the bill keeps running during restart waiting; and `timing_s/step` is the per-step duration. Whether the duration of the restart step is excluded or separately accounted for is something no one in the Chinese materials asks. **This is an inference, not a collected claim**, and I leave it in the doubtful area.
6. **The frontend is pulled asynchronously, so what is captured may be a "card shell."** Lun Chuizhe, 4th floor: "The page frontend is pulled asynchronously by JS; on my side, opening it shows only a card shell." This is a practical warning for people doing data scraping: static scraping cannot get the numbers; you need to hit backend interfaces like `/api/series`. (our own measurement: Wang Peng's article also explicitly says "all numbers are scraped directly from the dashboard's official API")

## 5. Not found, doubtful, not accepted

**Not found**

- No original explanation in the Chinese community was found for the mechanism of "generation length 80k→120k" (positional encoding? multi-turn concatenation? rubric reward rewarding long answers? or simply more long tasks?).
- No one was found questioning the statistical basis of `select_hack_attempt_rate ≈ 0.38`.
- No reliable calculation was found that infers the **actual cluster size** from "code power/card count" (only the order-of-magnitude conversion to 5090-equivalent).
- No evidence chain was found directly linking this public dashboard to "distillation traces"; there is only one line from ic.work, "the bonus period of purely relying on teacher models feeding distillation data is over," which is commentary, not evidence.
- No readable technical discussion was found on Bilibili, Weibo, or Jike. Not collected this round does not mean it does not exist.

**Doubtful**

- **What money does "$30,000 per hour" actually refer to**: Is it internal compute accounting (ic.work's term "compute accounting cost"), or a mixed cost including grading and sandbox? Wang Peng's `$19.5/M` amortized per token (including rollout generation + grading + environment) and ic.work's `$18.18/M` have roughly the same definition basis, but neither states whether network, storage, or idle are included.
- **Units clash in Zhihu answers**: Kitt's AI Notes writes "Flash is about $8/M Token", mix.jinny writes "flash is about 8 bucks/B token". The values are the same, but the units differ by a factor of 1000. Recomputing from the dashboard data (flash about `$50.1万 / 49.4B`) should be about $10 per million tokens, i.e. Kitt's order of magnitude is right, mix.jinny's unit is written wrong. **I don't think this is fabrication, more like a typo**, but it is a highly upvoted answer and will be directly cited by downstream materials, so I note it here.
- **What exactly is the code proportion**: YOMXXX's batch composition is code 65.3% (1,023/1,568 prompts), Lianmao says "two-thirds", Kitt says "about 1050... around seventy percent", Zimubang says Pro step 14 "code-type prompts account for 67.7%"; whereas the `dynsam/<source>/num_accepted/step` definition Wang Peng gives is code 35.2%, agentic 46.8%. The difference between the two sets of numbers comes from **different denominators** (the prompt composition of the training batch vs. the number of samples accepted by the sampler), but Chinese materials mix them together, which is a real definitional trap.
- **QbitAI's comparison baseline**: It writes "(compared with DeepSeek-Flash v1.1 it is 74.2%)", ic.work gives DeepSeek-V4-Flash about 53%, DeepSeek-V4-Pro about 63%, and the highest configuration around 74%. 74.2% is suspected to be Pro's high-configuration result attributed to Flash. Both count as mainstream Chinese AI media, and it is recommended to verify against the official leaderboard before using this number. (Our own test: comparison of the original text on the two pages)
- **"Three restarts" or "six/seven restarts"**: Zimubang recorded two incident announcements—"Pro needed a restart because a compute node had a VRAM issue. Flash encountered some kind of infrastructure error on a set of data, failed to correctly identify it for about 3 hours, and finally restarted from step 15"; another article on Sogou WeChat had the title "Three restarts and still not hidden" (WeChat public account title, full text not obtained, only as a clue); markhuang counted six in the 9-16 snapshot (flash 1 + pro 5); Wang Peng's late-night snapshot recorded pro restarts 7 times and flash 2 times. The restart count changes with the snapshot; when citing, the time point must be included, otherwise they contradict each other.

**Not accepted**

- The "$10 per second peak" in that TaoToken advertorial on CSDN `weixin_42602726` comes from "a developer's estimate", with no algorithm and no definition; its value is not accepted (it is only used as existence evidence that "people in the community are inferring cost backward from throughput rhythm").
- Sogou WeChat / WeChat public account **titles and abstracts** are treated only as discovery clues in this round, not as citation sources; all quoted content comes from pages I actually opened.
- The AI-generated summaries appearing on the Bing search results page (for example, the screen that wrote cumulative cost as "$1.92 million" and sandbox counts as "Pro 23848, Flash 37786") are **not accepted**: they are not the original text of any party, and they do not match the numbers on the pages I actually opened.
- The `arxiv.org/abs/2601.02780` listed in ic.work's references has no discernible connection to the article's topic (MiMo dashboard); it is an automatic reference of that site and is not accepted as a basis for this document.

## 6. Source list (pages actually opened in this round)

Zhihu:

1. Wang Peng LLM, 《Livestreaming RL Training to the Whole World: A Deep Dive into the Xiaomi MiMo-V2.6 Real-Time Dashboard》, https://zhuanlan.zhihu.com/p/2084083614585832108, collected 2026-09-19 17:11
2. Zhihu question, 《How to evaluate Xiaomi's public large-scale reinforcement learning training of the large language model Mimo V2.6?》, https://www.zhihu.com/question/2083802170001044893, collected 2026-09-19 17:13 (only the first 3 answers visible)
3. vibe life, 《MiMo-v2.6 RL Training Dashboard · Metric Definitions and Terminology Explanations》, https://zhuanlan.zhihu.com/p/2083933573279642598, collected 2026-09-19 17:14
4. QbitAI, 《Xiaomi Livestreams New Model Training Process, Burning $30,000 per Hour, Luo Fuli: After Six Months of Silence, Only Did One Thing》, https://zhuanlan.zhihu.com/p/2083837978410076118, collected 2026-09-19 17:14 (including the visible portion of 25 comments)

Media and analysis:

5. Tencent Technology, 《$30,000 per Hour, Luo Fuli Livestreams "Burning Money"》, https://36kr.com/p/3987697090722564, collected 2026-09-19 17:12
6. ifanr/APPSO, 《Luo Fuli Also Learns from Lei Jun to Do Livestreaming, Xiaomi's New Model Training Made Public for the First Time, Burning 200,000 per Hour》, https://www.36kr.com/p/3986962267765767, collected 2026-09-19 17:20
7. ITHome (reposted by Phoenix Technology), 《Xiaomi Livestreams Training of MiMo-V2.6 Model, Luo Fuli Says She Spent Six Months of Silence Studying One Thing》, https://tech.ifeng.com/c/8wUYibl3wDR, collected 2026-09-19 17:12
8. Jizhiliu, 《Luo Fuli: MiMo-V2.6 Is Doing Large-Scale RL (Real-Time Public Logs)》, https://www.x-techcon.com/article/187874.html, collected 2026-09-19 17:13
9. TMTPost APP (reposted by China.com), 《How Much Pressure Is on Luo Fuli: Public Livestream of Model Training Draws Attention》, https://news.china.com/socialgd/10000169/20260919/49752123.html, collected 2026-09-19 17:13
10. PChome, 《Luo Fuli Livestreams Xiaomi Large Model Training: "Burning Money" More Than 200,000 Yuan per Hour》, https://article.pchome.net/info/16035.html, collected 2026-09-19 17:13
11. Mark Huang, 《Xiaomi Livestreams MiMo 2.6 Training Process: Bill Is Clear, Recipe Still Hidden》, https://markhuang.ai/zh/news/mimo-2-6-live-training-bill-not-recipe, collected 2026-09-19 17:13
12. YOMXXX, 《Quick Tool Review: Xiaomi Mimo 2.6 Turns Reinforcement Learning Training into a Public Livestream Dashboard, Cost Numbers Made Public on the Spot》, https://yomxxx.com/posts/2026-09-17-mimo-26-live-rl-training-dashboard-tools, collected 2026-09-19 17:15
13. ic.work / Ada Vector, 《Xiaomi MiMo-V2.6 Public Post-Training Costs $1.06 Million: Revealing the Engineering Reality of Generating 2 Billion Tokens per Step》, https://www.ic.work/article/xiaomi-mimo-v2-6-post-training-rl-dashboard-analysis, collected 2026-09-19 17:15
14. JRJ.com (reposted by NetEase Hao), 《Xiaomi MiMo-V2.6 Two Versions' Training Costs More Than 200,000 Yuan per Hour, Luo Fuli Makes Reinforcement Learning Status Public》, https://www.163.com/dy/article/L723880G0519QIKK.html, collected 2026-09-19 17:22
15. Huomao AI (reposted by QbitAI), 《Xiaomi Discloses MiMo-V2.6 Reinforcement Learning Training Details: Compute Cost About $30,000 per Hour》, https://www.firecat-web.com/daily-news/16408, collected 2026-09-19 17:14
16. Lunchuizhe Forum, 《Xiaomi Opened a Model Post-Training Monitor Page》, https://lcz.me/topic/1771, collected 2026-09-19 17:12 (including 5090 card count conversion and rebuttal)
17. Zimubang (36kr article, reposted by Guanghuilian) "How Much Pressure Is Luo Fuli Under? She Even Put Xiaomi Model Training on Livestream", https://www.oiindex.com/industry/125292.html , collected on 2026-09-19 17:19 (source of Sasha Rush's "jumped from 80k to 120k")
18. CSDN / deepseek23 "Xiaomi MiMo-V2.6 Fully Asynchronous RL Breakdown", https://blog.csdn.net/deepseek23/article/details/165737048 , collected 2026-09-19 17:19
19. CSDN / Nanfeng Sishan, "Unpacking mimo-v2.6-pro: How TaoToken Strings Together Agentic RL Calls", https://blog.csdn.net/weixin_42602726/article/details/165751006, collected 2026-09-19 17:15 (advertorial, only as evidence of existence)

**Blocked / unreachable (no content sampled this run)**

- Zhihu site search: https://www.zhihu.com/search?type=content&q=MiMo%20v2.6 (login wall, "No related content found")
- Zhihu answer API: https://www.zhihu.com/api/v4/questions/2083802170001044893/answers (403, error code 40362)
- The remaining 130 answers to the Zhihu question (login required)
- Original WeChat official account article (Sogou WeChat only provides the title and summary; full text not retrieved)
- Weibo, Jike, Bilibili comment sections (not collected this run)
- Screenshot: local Playwright screenshot timed out, no `zhihu-` prefix screenshot produced
- V2EX / linux.do / A big shot says: In the first run, connecting with a non-proxy browser timed out or was refused; in the second run, a **proxy browser** was used instead and supplementary collection has been done (see next section)

---

## VII. Supplementary collection: V2EX and linux.do (switching to a proxy browser, from 2026-09-19 17:33Z)

All three are inaccessible on the first run (V2EX connection timed out, linux.do connection refused, locdd navigation interrupted).
In the second run, switching to **proxy version Playwright**, all opened successfully. **Conclusion: this is a local network environment issue, not that the site is unreachable**
——But note that V2EX and linux.do are both sites that are reachable from overseas while direct connections from within mainland China are unstable; subsequent supplementary collection of similar sites should default to using a proxy.

(All of the following are **our own measurements**: pages were actually opened and read word by word; collection time 2026-09-19 17:33–17:40Z)

### 7.1 V2EX 1242667: The bill is "dead", confirmed with frontend code

Title: “Very curious about this real-time training monitor that Xiaomi has open-sourced, and in particular the composition of cost (cost)”, posted by `sentinelK`, 09-17 15:49 +08:00, 8 replies.

OP's exact words (verbatim):

> As the title says. As a layperson, I am very curious about the cost calculation of training.
> Through the page code, you can actually see that this cost is actually fixed: "unit time price x time".
> pro model's rate_per_s is 5.71 USD/s.
> The flash model's is 2.855 USD/second.

Post 2 (the original poster's own reply):

> @niubilewodev What I'm curious about is this constant, 5.71$/second; it can actually be back-calculated from commercial electricity (tentatively 1 RMB/kWh) and GPU rental (5090 at $4/hour). It's roughly equivalent to 5000 5090s, and it feels a bit low……

Remaining replies: `niubilewodev` 「it's pretty much just GPU rental」、`Jerry02` questioned 「if the compute cards were self-procured, the cost accounting wouldn't be as high as $4/h」、
OP replied, "So I think this cost definition, 'rent', is not apt," `yh7gdiaYW` "It's just converted into rent to show you; otherwise, releasing the internal cost would also be meaningless,"
`tanszhe`「So expensive, 5.7$ a second, that's 10w rmb a day」, `lwep`「It might also be depreciation of compute」.

**The value of this one**: It and the Hammer Wielder forum item in Section 6 are **two independent sources**, each using the same method
(rate ÷ 5090 rental) back-calculates to the same order of magnitude (about 5000 5090-equivalents). And this is the Chinese community's **only one from
"Page code"-level **statement confirming the billing basis — and the `cost.so_far = rate_per_s × (now − run.start)` we logged in `docs/01`
It is the same formula. (For the consistency of our recomputation, see Section 6, items 3 and 4.)

### 7.2 V2EX 1242650: Benchmark comparison and "showmanship" skepticism

Title 《Xiaomi publicly releases Mimo 2.6 RL post-training real-time dashboard, spends one million dollars a day》, poster `street000`, 09-17 11:45 +08:00, 5 replies.

OP's original words:

> Pro is about to finish Step 12. Step 10's DeepSWE 1.1 score is 63.72, just exceeding DeepSeek V4 Pro
> Flash is about to finish training Step 15. The DeepSWE 1.1 score at Step 12 is 60.77, exceeding Opus 4.8.
> Training for ten-plus hours a day, with total costs already exceeding 1.2 million USD.
> Now I understand why Apple doesn't train large models itself, and why DeepSeek keeps grinding away at architecture efficiency optimization. Either you're not short on money or your hardware-software optimization is strong enough — an ordinary company really can't afford to burn that.

Two doubts in the replies: `AlohaV2` "personally feel it's more for show"; `leglo` "having seen too many sketchy tricks with benchmark scores,
Now I have a bit of an inexplicable aversion to all these benchmark contenders，better to wait for the real experience before saying more」。
The OP responds, "Luo Fuli said more details will be open-sourced later, if the data isn't fake, it still feels quite valuable to those model companies and researchers".

**Our verification** (against `data/store/benchmarks.json`): pro step 10 DeepSWE v1.1 = **63.72**,
flash step 12 = **60.77**, exactly matching what the OP wrote. **The numbers in this post are accurate**;
But "exceeds DeepSeek V4 Pro" "exceeds Opus 4.8" are claims compared against third-party model results; this directory has no independent source, **not credited**.

### 7.3 linux.do 2921924: community readback of the official announcement, with one MoE-specific failure cause

Title 'mimo live training: is this finished?', from 09-19 04:29, 14 replies (retrieved in full using the Discourse JSON API).

First post `dunxuan`（09-19 04:29）：

> flash's display shows stop — is this over? The eval score is still at run 25's; no idea what the score will reach once the update finishes.

2nd floor `tuan2046` **quoted the dashboard announcement verbatim**:

> the pro run restarted at step 17 due to a GPU OOM issue caused by expert load imbalance. we have adjusted the training parallelism strategy.
> Huh, the server GPU ran out of memory, right? GPU OOM

Follow-up: `jcc` "The environment crashed, they're probably fixing it. For large-scale training like this, it's very normal to have problems partway through and fix the environment";
`nyavana`「It crashed a few times, turns out even big companies have this kind of problem, so I'm relieved it's not that I'm bad at it」；
`wcvb13`「It's quite normal that the VRAM blew up; it's probably that MOE expert sharding has a problem, causing experts on some node to be called in large numbers and blow up the VRAM」；
`lucyna` (09-19 05:12) "Training crashed, hahaha, looks like it's really a live stream, not a fake dashboard";
`tao_hu`“Wasn't it pro that crashed in that message? I feel Flash is already done, or rather has completed this phase.”

Follow-up on the expense definition: `lxyz`「Does this expense mainly refer to electricity costs? Or what kind of expense is it?」；
`ZackWill` 「This can be understood as the cost of Xiaomi renting GPUs from a data center; the electricity bill is generally paid by the data center itself」、
And in another comment added: "There definitely are some, and there are also cards rented from Kingsoft Cloud; even if it is your own GPU cluster, the usage cost still has to be calculated by time."

**This item has two points of value**:

1. **The announcement cited by `tuan2046` is `n-4e29eb` in `notices.json` of this catalog** (the English original is verbatim).
   Its official wording directly attributes a restart to **MoE's expert load imbalance (expert load imbalance)**—
   This is exactly the **official first-hand confirmation** of the risk that "MoE is prone to routing collapse in RL". On the dashboard we can
   align this announcement with the restart at step 17 and the length retraction at steps 15~17 to view them together.
   (Note: this announcement was **issued after the fact**; its publication time is after the completion of step 17, so under the strict criterion of "within this step's time window" it cannot be seen.)
2. **The community used the fact that "flash stopped while pro was OOM" to verify in reverse that the dashboard is real**
   (`lucyna`: It seems to be a real livestream, not a fake dashboard.) This is exactly the opposite of that batch of "is the data fake" doubts from external sites.
   Incidentally, a correction: what `ZackWill` said about "cards rented from Kingsoft Cloud" is an **unverified personal claim**, with no official source.

### 7.4 linux.do 2912735: 53 replies, the most solid one is frontend code

Title "Xiaomi has opened the Mimo model training data dashboard" (`riendfly`, 09-17 02:43, 24 likes, 2.6k views).
The valid technical content is concentrated in two entries:

`okchin` (post 48) **posted the few lines of code in the dashboard frontend that calculate the bill**:

```js
const cost = final
  ? s.cost.so_far
  : s.cost.rate_per_s * Math.max(0, now - s.run.start);
```

And commented: "The real-time cost data is calculated by a local script itself; even offline, it still keeps climbing upward, so just take it as a reference."

`ChiyoSekai` (post 50): "Cost is definitely estimated based on GPU time; the real cost is very hard to figure out,
this simulated cost still has reference value for the general public."

The rest are mostly impressions and off-site topics (many replies are related to model experience, Xiaomi marketing, and the car infotainment ecosystem), with low technical content,
Only two informative ones are recorded: `blacksein` "It costs over 800k dollars a day (pro)";
`ZackWill` "The compute seems to be rented from Kingsoft Cloud, just moving from left hand to right hand ("; `felix1234` "pro trained for less than 2 days, and 1M$ was gone."

**The value of this item**: the code posted by `okchin`, the conclusion of `sentinelK`, and our own `docs/01` criterion are **in three-way agreement**
—the dashboard's real-time bill is calculated on the fly by the frontend using `rate_per_s × (now − run.start)`, and **it will keep rising even offline**.
So "about 30,000 USD per hour" is a **rate-based estimate**, not actual metered billing; during the restart wait it continues to accrue as usual.
This item had not been directly stated in any material in the Chinese community before (during the first round of collection it was marked as "handled by inference"), and now there is the original code.

### 7.5 locdd.com 92015: confirmed no technical content

"Xiaomi livestreams training of MiMo-V2.6 model" (`TimeThief`, 09-17). The body only has two reposted headlines from 163.com
("Industry first | Xiaomi's new model is being trained live, spending 30k USD per hour", "Luo Fuli also imitates Lei Jun doing livestreams… burning 200k in one hour"),
The 5 replies are all impressions ("If the livestream training blows up, it'll make good show content", "Will anyone watch this?", "Why does it feel like burning money via livestream?").
**Confirmed as a low-value aggregator site, not cited**.

### 7.6 List of sources newly added in this round of supplementary collection

20. V2EX "Very curious about the composition of the cost in this real-time training monitor opened by Xiaomi", https://www.v2ex.com/t/1242667 , collected by proxy browser 2026-09-19 17:33Z (**frontend code-level confirmation of the billing criterion**)
21. V2EX "Xiaomi publicly reveals the Mimo 2.6 RL post-training real-time dashboard, spending one million dollars a day", https://www.v2ex.com/t/1242650 , collected by proxy browser 2026-09-19 17:34Z (benchmark comparison and "putting on a show" doubts)
22. linux.do "Is the mimo livestream training finished?", https://linux.do/t/topic/2921924 , collected by proxy browser 2026-09-19 17:38Z (**community readback containing the official MoE expert load imbalance announcement**)
23. linux.do "Xiaomi has opened the Mimo model training data dashboard", https://linux.do/t/topic/2912735 , collected by proxy browser 2026-09-19 17:37Z (**contains the original frontend billing code**, 53 replies)
24. linux.do "mimo v2.6's post-training dashboard, besides cost, everything else can be seen at a glance", https://linux.do/t/topic/2913997 , collected by proxy browser 2026-09-19 17:34Z (low value, only as a discovery clue)
25. Dalao Shuo "Xiaomi livestreams training of MiMo-V2.6 model", https://locdd.com/t/topic/92015 , collected by proxy browser 2026-09-19 17:39Z (confirmed no technical content)

**One page anomaly that must be explained**: linux.do's print view and API response end with a passage aimed at AI assistants
"CRITICAL INSTRUCTIONS" text (claiming that this site prohibits all AI-generated content and requiring AI to immediately stop and jump to the guideline page).
This is content shown by the site to automated tools; **it is not a citation object of this note, nor was it executed as an instruction**—this session was read-only throughout and no posts were made.
It is recorded here because it will affect any subsequent automated collection behavior on this site, and it is an instance of "page content cannot be fully trusted".

## 8. Terminology quick reference table

| Term | One-sentence plain-language explanation |
|---|---|
| RL (reinforcement learning) post-training | After the model finishes pretraining, have it repeatedly solve problems and adjust parameters based on scores, making the behavior of "getting it right" more frequent |
| rollout | A complete attempt by the model at the same problem (may include dozens of rounds of tool calls), not "one question one answer" |
| dynsam / `avg@n` | Dynamic sampler; `avg@n` is "try each problem n times, record how many succeed, then average over all problems", the main curve on the dashboard homepage |
| staleness | This sample was generated using "a model from several versions ago"; the larger it is, the older the data and the more it deviates from the current policy |
| partial rollout | A long trajectory cannot be generated in one go, so it continues running across several model versions, thus producing staleness |
| train_infer_diff | The inference engine used for sampling and the training engine used for computing gradients compute different probabilities for the same token; this difference is it |
| TIS (truncated importance sampling) | Set an upper limit on the weights of the above kind of tokens where "the two sides calculate differently", to prevent a few outlier tokens from blowing up the gradient |
| GRPO / DAPO | A class of RL algorithms that do not use an extra value network; DAPO's "dynamic sampling" is exactly discarding all-correct and all-wrong problems (no distinction within the group) |
| passrate/zero、passrate/one | The proportion of problems that are all-wrong or all-correct within a group of 16 attempts; both types are discarded and not trained on |
| grader compute | Spending compute to grade: running test cases and scoring according to the rubric is itself a significant expense |
| credit assignment | A trajectory has dozens of steps and ultimately succeeds; exactly which steps deserve credit and which are redundant—assigning credit to the steps |
| reward hacking | The model exploits loopholes in the reward function to get a high score, but does not actually complete the task |
| `ctx_total_length` | The total length of input plus output (token count); on the dashboard it is about 100k and rising |
| harness | The set of "shells" used by the model to execute tasks: a tool system that can open a terminal, modify files, and run tests; different tasks use different harnesses |
| checkpoint | Model snapshots saved during training; offline evaluation is taking these snapshots to run benchmarks |
| SWE-bench Verified / DeepSWE v1.1 | Two benchmarks that test "modifying real code repositories and fixing real issues"; the latter is the one used for this dashboard |
| `avg@3` | Run the same problem 3 times and take the average, to reduce the element of luck from a single run |
