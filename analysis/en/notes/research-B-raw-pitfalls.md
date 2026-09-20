# Large Model Reinforcement Learning (RL) Training Pitfalls and Metric Anomaly Handling —— A Survey of Practical Experience from the Chinese Community

> Survey Methodology and Credibility Notes
>
> - Search channels: Bing (`fetch.py s`) + CSDN site search API (`so.csdn.net/api/v3/search`) + Juejin API (`api.juejin.cn/search_api/v1/search`). **Zhihu returns HTTP 403 site-wide** (neither columns nor answers can have their body text scraped), so in this report Zhihu sources exist only as "search result entries", with no body-text citations.
> - Citation labeling rules: anything in quotation marks and labeled "original text" is **verbatim original text** from the scraped body; what is labeled "(excerpt paraphrase)" is a condensed summary of the original, not a verbatim quotation.
> - **Credibility warning (important)**: CSDN currently has many "content farm/AI mass-generated" articles: under the same topic, multiple different accounts publish highly similar titles (e.g., `verl 使用踩坑记录：这些错误千万别再犯了` and `verl 使用踩坑记录：这些错误千万别再犯`), and some articles contain obvious factual errors (for example, expanding GRPO as "Generalized Reinforcement Learning for Preference Optimization"). This report uniformly labels such sources **（suspected AI-generated, needs caution）**, and preferentially trusts papers, official documentation, and articles with traceable provenance (with links to the original WeChat official account/PR).
> - Limitation affecting the completeness of this report: **the Chinese first-hand sources at the "paper/official documentation support" level cannot be verified**; their accessibility within this search window is limited, so the "conclusions" in Sections 1, 2, and 3 mainly use English papers as their own verification basis, with Chinese sources serving as evidence of "how the Chinese community understands and operationalizes".

---

## Topic 1: Entropy Collapse / entropy collapse / entropy collapse

### 1.1 Mechanism (paper-level conclusion)

**【Phenomenon/experience (original text)】** A Chinese explainer article relays the paper 《The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models》:

> "The collapse of policy entropy… this phenomenon often occurs in large-scale RL training; if entropy regulation is not introduced, policy entropy will **drop rapidly** in the early stage of training, causing the model to become overconfident, weakening exploration ability, and saturating policy performance."
> "This paper establishes a conversion formula between entropy and model performance, showing that **policy performance is obtained at the cost of policy entropy**; the exhaustion of entropy will become a bottleneck for performance improvement, and the upper bound of the capability of an RL-trained model can be predicted from entropy."
> "The derivation in this paper points out that changes in policy entropy are driven by the **covariance** between action probabilities and changes in logits; experiments show that the numerical changes of the covariance term almost perfectly match the changes in entropy."
> "More than 95% of entropy decline / performance improvement occurs in the early stage of RL training. Afterwards the model enters a plateau and almost no longer improves."
> "Summary formula: `R = −a exp(H) + b`… when policy entropy is exhausted (H = 0), R = −a + b, so the marginal benefit of continuing to scale up RL training compute may be extremely low. Worse, **naively using entropy regularization methods has been proven ineffective**."

and proposes two control methods (original text):

> "**Clip-Cov method**: clip the gradients of high-covariance tokens; randomly select a small number of tokens with positive covariance and cut off their gradients; and **KL-Cov method**: introduce a KL penalty for high-covariance tokens."

- 【Source URL + title】https://blog.csdn.net/weixin_36378508/article/details/149641285 《Reinforcement Learning Policy Entropy Collapse Optimization - clip conv kv conv》; another article from the same source https://blog.csdn.net/2401_84204413/article/details/148735155 《The Mystery of Large Model RL Learning Stagnation: Secrets in the Policy Entropy Collapse Mechanism!》
- 【Source nature and author identity】CSDN repost/explainer article (authors `weixin_36378508`, `2401_84204413`); the title directly gives the paper's English name *The Entropy Mechanism of Reinforcement Learning for Reasoning Language Models*, and it is a **paper explainer** rather than original research.
- 【Conclusion/experience】**Paper-supported (conclusion-level)**: entropy and performance have an exponential relationship, naive entropy regularization is ineffective, and Clip-Cov/KL-Cov are effective——these are the paper's conclusions. The CSDN article itself is a second-hand relay.

### 1.2 Causes + clip-higher (paper-level conclusion + community explainer)

**【Phenomenon/experience (original text, author's exact words)】** An article labeled "repost" (original source: WeChat official account) writes:

> "Entropy collapse—it was found that in the early stage of training, the policy's entropy drops rapidly because the responses within the group have basically become consistent."
> "In ppo and grpo, the policy update ratio is restricted through clipping… but the upper and lower bounds of this clip mechanism are the same, which to a certain extent limits the exploration ability of low-probability tokens. So DAPO's first observed improvement is to **decouple the upper and lower bounds, leaving more space for low-probability tokens to be increased, thereby avoiding entropy collapse**."

- 【Source URL + title】https://blog.csdn.net/taoqick/article/details/148190538 《Why does GRPO easily suffer reward collapse? DAPO's improvements》 (the body explicitly labels it "repost", original links `https://mp.weixin.qq.com/s/zm6wv2FAkVDVlnP2Xp191w` and `https://mp.weixin.qq.com/s/s721lnVxTPBuNdB1GP6H0A`)
- 【Source nature and author identity】CSDN repost, **the original source is a WeChat official account** (CSDN blogger `taoqick` is only the reposter). It is **personal experience / popular-science explainer**, but because the original link to the official account is given, provenance credibility is relatively high.

**【Phenomenon/experience (original text, paper-level comparison)】** DAPO paper abstract (arXiv 2503.14476) original text:

> "We propose the **D**ecoupled Clip and **D**ynamic s**A**mpling **P**olicy **O**ptimization (**DAPO**) algorithm, and fully open-source a state-of-the-art large-scale RL system that achieves 50 points on AIME 2024 using Qwen2.5-32B base model. ... we introduce four key techniques of our algorithm that make large-scale LLM RL a success."

- 【Source URL + title】https://arxiv.org/abs/2503.14476 《DAPO: An Open-Source LLM Reinforcement Learning System at Scale》 (authors Qiying Yu et al., ByteDance Seed + Tsinghua)
- 【Conclusion/experience】**Paper (conclusion-level)**. Note: the DAPO abstract itself **does not** contain the term "entropy collapse"; the four techniques are Clip-Higher / Dynamic Sampling / Token-Level Policy Gradient Loss / Overlong Reward Shaping. "Clip-Higher is used to solve entropy collapse" is **a community explainer and an extension of the paper's main text**; Chinese secondary sources generally state it this way.

**【Community-side parameter explainer (excerpted paraphrase)】** A CSDN article of the algorithm survey type summarizes DAPO's Clip-Higher as:

> "Decouple the upper and lower clipping ranges (ε_low and ε_high), increase the headroom for probability increases for low-probability exploration tokens, and enhance policy diversity and entropy", and notes `ε_high > ε_low` "→ give low-probability 'exploration tokens' more room to rise and prevent entropy collapse".

- 【Source URL + title】https://blog.csdn.net/weixin_44778145/article/details/150487941 《Large Model Alignment Algorithms (IV): DAPO,VAPO,GMPO,GSPO, CISPO，GFPO》
- 【Source nature and author identity】An algorithm survey by a CSDN blogger (`weixin_44778145`); the body carries many CSDN "related article" cards, and some paragraphs contain obvious factual errors (such as describing GRPO's objective as DAPO's objective). **It is a personal compilation, with medium credibility**.

### 1.3 Hyperparameter tuning treatment for "training produces repetitive content / monotonous output" (personal experience)

**【Phenomenon/experience (excerpted paraphrase, not verbatim)】** Multiple CSDN articles attribute "repetitive content" to autoregressive path dependency + positive reinforcement by the reward of "safe, mediocre" responses + lack of diversity constraints, and the remediation path they give is: **increase the KL regularization coefficient `kl_coeff`, increase the sampling temperature and `top_p`, introduce an explicit repetition penalty term, and improve preference data quality**.

- 【Source URL + title】https://blog.csdn.net/weixin_36378508/article/details/154188780 《When training with GRPO, a large amount of repetitive content is produced; how to tune hyperparameters to improve it?》; same topic https://blog.csdn.net/weixin_55154866/article/details/153201732 《In-Depth Analysis of the Repetitive Content Problem in GRPO Training: Principle Analysis and Practical Techniques!》
- 【Source nature and author identity】CSDN blogger. **Suspected AI-generated, use caution**: multiple accounts have identical titles on the same topic, and the body has no experimental data.

### 1.4 First-hand discussion on Zhihu (body could not be scraped)

- 【Phenomenon/experience】**Not found (body unreachable)**. In the search results, there is a high-engagement discussion entry: https://www.zhihu.com/question/1893241692582285916 《Why is GRPO so prone to going off the rails during training, with reward suddenly dropping midway through?》, and the Bing snippet shows the answer involves "GRPO does not have a Critic part; the reason is relatively simple, because GRPO is used to train large models (on the order of 100 billion parameters)……". **The Zhihu body returns 403; this report does not cite its content.**

---

## Topic 2: All-correct/all-wrong samples cause advantage to be 0

### 2.1 Problem definition (paper-level conclusion + Chinese cross-reference)

**【Phenomenon/experience (original text, paper abstract)】** The DAPO paper states at the outset that the community struggles to reproduce the RL results of SOTA reasoning models, and open-sources four key techniques; among them, the goal of Dynamic Sampling is to remove sample groups that are "all-correct/all-wrong within the group" and thus have zero gradient.

**【Phenomenon/experience (original text, Chinese explainer)】** The aforementioned CSDN algorithm survey gives the most straightforward parallel formulation:

> "**Dynamic sampling: Dynamic Sampling**. GRPO: fixed batch; when encountering all-correct / all-wrong prompts → zero gradient. DAPO: during the sampling stage, **filter out prompts with reward=±1**, until all prompts in the batch have valid gradients." And writes the constraint `0 < |{o_i | is_equivalent(a,o_i)}| < G` in the objective function.

- 【Source URL + title】https://blog.csdn.net/weixin_44778145/article/details/150487941 《Large Model Alignment Algorithms (IV): DAPO,VAPO,GMPO,GSPO, CISPO，GFPO》
- 【Source nature and author identity】Compiled by a CSDN blogger. **The conclusion part can be checked back against the DAPO paper**; the formulation itself is consistent with the paper.

**【Phenomenon/experience (original author's exact words)】** The original WeChat text reposted writes:

> "Next, the second improvement is to improve training efficiency. During training, when the accuracy of certain inputs is 1/0, these samples no longer contribute to the gradient. See the figure below: as step rises, the proportion of correct samples also keeps rising. So DAPO's sampling filters out these samples to ensure that every sample in each batch can effectively contribute to the gradient. (**Keep sampling until the sampling condition is met**)"

- 【Source URL + title】https://blog.csdn.net/taoqick/article/details/148190538 (reposted from WeChat official account)
- 【Source nature and author identity】Original WeChat official account article reposted, **personal experience / popular science**, with high provenance credibility.

### 2.2 Engineering pitfalls of division by zero / NaN (personal experience, including specific avoidance techniques)

**【Phenomenon/experience (original text, author's exact words)】** A CSDN author who claims to have been an interviewer in the LLM direction records in "Three Hyperparameter Tuning Pitfalls":

> "There is another classic pitfall outside the boundary…… When the rewards of all responses in a group are exactly the same, the std of the within-group standard deviation is 0, and GRPO's advantage formula will have **division by zero**. Some frameworks produce NaN at this point, which in turn causes abnormal gradient propagation, and the training loss suddenly explodes. When I first encountered it, I thought I had tuned ε too large, causing numerical instability, and it took me a long time to pinpoint it as a division-by-zero problem."
> "The handling method is: when the reward variance within the group is too small, add a very small epsilon to std, or directly skip updating on this group of samples."

- 【Source URL + title】https://blog.csdn.net/weixin_29057163/article/details/164523806 《How to Precisely Tune CLIP Boundaries in GRPO? From Principles to Pitfall Records》
- 【Source nature and author identity】CSDN blogger (signed "Xie Lilu"), claims to be an LLM-direction interviewer and to have practical training script experience. **A personal experience account**, but the description is concrete and verifiable, with fairly good credibility.

### 2.3 Another perspective on "all-wrong samples" being implicitly filtered (paper/research conclusion)

**【Phenomenon/experience (excerpted paraphrase)】** A CSDN article paraphrases a research conclusion: part of GRPO's advantage comes from **implicitly filtering all-wrong samples**, and it proposes that a minimalist ReInforce-Rej can be comparable, emphasizing that "selecting and using training samples is more important than complex algorithms".

- 【Source URL + title】https://blog.csdn.net/c9yv2cf9i06k2a9e/article/details/148124050 《GRPO = Advanced Rejection Sampling? The RL Demystification Moment: "Discarding the Dross and Keeping the Essence" of Negative Samples Is the Key!》
- 【Source nature and author identity】CSDN blogger repost/interpretation (an account that reposts AI news). **Second-hand paper interpretation; must check against the original paper**; this report was unable to verify the original paper text.

### 2.4 Monitoring criteria for intra-group variance health (personal experience)

**【Phenomenon/experience (original text, author's own words)】** A long training-monitoring article explicitly distinguishes between variance being too small and too large:

> "Variance being too small for a long time means that the G responses output by the model are almost equally good or almost equally bad, **the advantage is compressed into a tiny value close to zero, and the gradient signal is extremely weak**; variance being too large for a long time means that sampling quality is severely unstable, and the training gradient is dominated by a few outlier samples. These two situations are not necessarily ‘divergent’ numerically, but the policy update has actually become distorted."
> "In actual training, I have seen quite a few cases where the loss curve looked completely normal but the eval metrics kept declining; in every postmortem without exception, the problem was a signal at the **distribution level**."

- 【Source URL + title】https://blog.csdn.net/weixin_34414650/article/details/94642248 《GRPO Training Signal Health Monitoring: A Complete Guide from Metrics to Anomaly Localization》
- 【Source nature and author identity】CSDN blogger (page shows "Moyan Member / AI creation all-network distribution / 10 years coding age", published 2026-09-04). **Suspected AI-assisted creation; use caution**; but its classification of monitoring metrics (numeric health vs distribution health) has engineering reference value.

### 2.5 Blunt criticism of GRPO's flaws in the Chinese community (personal experience)

**【Phenomenon/experience (original author's own words)】** Original text from the WeChat official account:

> "However, GRPO does not have a Critic part... It removes the Critic Network and replaces it with an algorithm that estimates the Advantage function online, adopting the practice of trading ‘time (compute)’ for ‘space (storage)’."
> "In principle, GRPO is not perfect; compared with PPO, it is actually roughly on par, and the algorithm design has a ‘**stability**’ flaw... Because DeepSeek's data is sufficiently large, so large that it can ‘perfectly’ avoid GRPO's stability flaw. In each Policy Gradient computation, as long as the Batch data is sufficiently large, the variance of the Policy Gradient can be effectively reduced... For university research teams, for small- and medium-scale RL training... **GRPO is not a good choice**."

- 【Source URL + title】https://blog.csdn.net/taoqick/article/details/148190538 （reposted from https://mp.weixin.qq.com/s/zm6wv2FAkVDVlnP2Xp191w）
- 【Source nature and author identity】WeChat official account author (**strongly opinionated**), reposted on CSDN. **A matter of personal experience, not a definitive conclusion**.

---

## Topic 3: KL explosion / KL anomaly / training-inference inconsistency

### 3.1 Systematic characterization of the problem (engineering practice consensus)

**【Phenomenon/experience (original text, signed "Author: Ascend Practitioners")】**

> "An On-Policy RL system requires the sampling distribution π_sampler to be consistent with the target policy π_learner for gradient computation. Because training-inference differences exist, for example, typical cases are **inconsistent precision in the implementation of training-inference operators and inconsistent quantization precision FP8/BF16 used for training-inference**, and in asynchronous reinforcement learning algorithms the training and inference models are not in the same state, etc., causing the algorithm to harbor an Off-Policy ‘trap’ and not satisfy the premise of unbiased estimation, leading to the following two typical scenarios."
> "Scenario 1: training instability; during training, **Reward collapse** occurs directly. The legend shows a sudden collapse of the training Reward and exploding grad norm."
> "Scenario 2: poor convergence; it cannot optimize toward the gradient-optimal direction. The legend shows that adding **TIS(Truncated Importance Sampling)** achieved better results."
> "Of the two scenarios, the training collapse scenario is more important, as it will directly cause training to be unable to continue."

- 【Source URL + title】https://blog.csdn.net/friezanmmm/article/details/157030617 《Analysis of veRL Training-Inference Consistency Work and Importance Sampling Code Evolution》
- 【Source nature and author identity】CSDN blogger (the body text self-signs "Author: Ascend Practitioners", published 2026-01-16), **provides official verl PR links** (`github.com/volcengine/verl/pull/2953`, `/pull/3694`, `releases/tag/v0.6.0`), and is a **technical analysis with source-code provenance**, with relatively high credibility.

**【TIS/MIS evolution recorded in the article (original text)】**

> "Three dimensions of computation. Compared with Token-level, this PR additionally adds Sequence-level and Geometric-level. Control strategies: upper-bound truncation TIS, two-sided masking MIS... token: Per-token importance ratios; sequence: Product of per-token ratios; geometric: Geometric mean of ratios."

### 3.2 BF16 vs FP16: attributing "training-inference mismatch" to numerical precision (paper interpretation)

**【Phenomenon/experience (original text, interpreted from the paper 《Defeating the Training-Inference Mismatch via FP16》)】**

> "We do not need complex algorithmic corrections; we only need to **switch the precision from BF16 back to FP16**, and all problems are solved."
> "**Conclusion: FP16's precision is 8 times that of BF16 (2 to the 3rd power).** In deep neural networks, values undergo hundreds of millions of additions and multiplications. Tiny differences in precision are amplified between layers."
> "BF16's failure: because it has only 7 mantissa bits, BF16 may truncate both of these numbers into... FP16 has 10 mantissa bits and can accurately capture this 0.0001 difference, thereby producing an effective gradient signal."
> "If KL is not computed accurately, the reward signal given by the Reward Model may cause the model to quickly overfit to some wrong pattern, or make training extremely unstable. **FP16's high precision ensures the accuracy of KL divergence computation and maintains the ‘constraining force’ of training**."
> Experimental conclusion (original text): "BF16 GRPO (baseline)" collapsed, "BF16 GRPO-Token-TIS" collapsed, "BF16 GSPO... under BF16 is more stable than Token-level TIS", "BF16 GRPO-Seq-MIS... this is the only algorithm under BF16 that did not collapse" but "the highest training accuracy is only 95% (FP16 is 99%), AIME 2024 score 34% (FP16 is 39%)".
> "**FP16 training is more stable, converges faster, and achieves higher final reward and evaluation scores**... The most basic, unbiased policy gradient algorithm (Standard Policy Gradient), when paired with FP16, outperforms all complex algorithmic corrections run under BF16 (such as TIS/MIS)."
> "Llama-3-8B: under BF16, training collapses shortly after it starts (Collapse), and reward drops to 0……Qwen-2.5-32B: ……under BF16, training **collapses directly at step 0 (Step 0)**; in contrast, using FP16 trains perfectly, reaching 96% accuracy on GSM8K and 50% on AIME."
> "**The larger the model, the more severe the numerical instability caused by BF16.**"
> "PPO has long been regarded as an algorithm that is extremely sensitive to hyperparameters and extremely difficult to tune. The authors point out that many past cases where PPO was 'difficult to train' or 'unstable' were likely not a hyperparameter problem at all, but rather a numerical precision problem caused by the underlying use of **BF16**."

- 【Source URL + Title】https://blog.csdn.net/weixin_36378508/article/details/155710405 《The "Training-Inference Mismatch" Problem in RL Training: Root Cause Analysis and Solutions (Importance Sampling IS, Switching Back to FP16 Precision)》
- 【Source Nature and Author Identity】A CSDN blogger's **detailed Chinese explainer** of the paper 《Defeating the Training-Inference Mismatch via FP16》 (the main text states the paper title).【Conclusion/Experience】**It is a paper explainer (close to conclusion-level), but note that the conclusion itself is controversial in the community** (the paper argues that FP16 is superior to BF16, contrary to mainstream engineering practice); this report recommends that readers check the original paper and community rebuttals before accepting it.

**【Supplement (engineering-side conclusion, original text)】**

> "FP32 inference can stabilize training: when the combination is 'BF16 training + FP32 inference', the training process becomes completely stable, with no signs of collapse (Collapse). **Fatal flaw (low efficiency)**: although FP32 inference can solve the stability problem, the cost is extremely high. FP32 inference speed is nearly 3 times slower than FP16 or BF16."
> Another article from the same source gives a supplementary method list: "TIS, IcePop, RSPO, sequence-level importance sampling, and FP16 precision switching".

- 【Source URL + Title】https://blog.csdn.net/weixin_36378508/article/details/155772819 《The "Training-Inference Mismatch" Problem in RL Training: Engine Differences, Sequence/Token-Level Rewards: Importance Sampling IS/Clip/Switching Back to FP16 Precision/Directly Optimizing Token Rewards》；https://blog.csdn.net/gaga246/article/details/155573239 《【Practical Content】Revealing the Culprit Behind LLM-RL Training Collapse: In-Depth Analysis and Solutions to the Training-Inference Mismatch Problem!》
- 【Source Nature and Author Identity】CSDN blogger explainer/aggregation. **Medium credibility**.

### 3.3 Training-inference inconsistency caused by MoE routing (paper-level conclusion)

**【Phenomenon/Experience (original text, paper abstract)】** Original text from the GSPO paper:

> "This paper introduces Group Sequence Policy Optimization (GSPO), our stable, efficient, and performant reinforcement learning algorithm for training large language models. Unlike previous algorithms that adopt **token-level importance ratios**, GSPO defines the importance ratio based on **sequence likelihood** and performs **sequence-level clipping**, rewarding, and optimization. We demonstrate that GSPO achieves superior training efficiency and performance compared to the GRPO algorithm, **notably stabilizes Mixture-of-Experts (MoE) RL training**, and has the potential for simplifying the design of RL infrastructure. These merits of GSPO have contributed to the remarkable improvements in the latest Qwen3 models."

- 【Source URL + Title】https://arxiv.org/abs/2507.18071 《Group Sequence Policy Optimization》 (authors Chujie Zheng et al., Qwen team)
- 【Conclusion/Experience】**Paper (conclusion-level)**.

**【Engineering solution for MoE routing alignment R3 (excerpt paraphrase)】**

> "This paper targets the root cause of training collapse of MoE models in reinforcement learning—**inconsistent routing behavior** between the training and inference stages—and proposes the Rollout Routing Replay (R3) method. R3 records the expert routing mask for tokens at each layer during inference and forcibly replays that mask during training, achieving strict routing alignment."

- 【Source URL + Title】https://blog.csdn.net/agile9scrum/article/details/150565921 《The Path to Stability in MoE Reinforcement Learning: From Routing Alignment to Training-Inference Consistency》
- 【Source Nature and Author Identity】CSDN blogger (account `agile9scrum`, high posting volume, a news-reposting/explainer account). **Secondhand paper explainer; the original paper should be checked**.

### 3.4 Learning rate scheduling vs importance sampling (controversial alternative)

**【Phenomenon/Experience (excerpt paraphrase)】** An article proposes that the essence of "training-inference inconsistency" is **optimization instability dominated by dynamic gradient noise** (rather than engineering precision error), and states that "a surge in response length is a key warning signal of runaway gradient noise", giving the scheduling strategy of "**halving the learning rate when response length reaches 1.8 times the threshold**", claiming it is superior to cosine decay and using importance sampling alone.

- 【Source URL + Title】https://blog.csdn.net/android23333/article/details/157209614 《The Essence of the Training-Inference Inconsistency Problem in Large Models and How to Solve It: The Magical Effect of Learning Rate Scheduling!》
- 【Source Nature and Author Identity】CSDN blogger. **High suspicion of AI generation (clickbait, no experimental details); caution is needed**; this report only records it as "the existence of this claim in the community" and does not treat it as a conclusion.

---

## Theme 4: reward hacking / verifier cheating / models bypassing tests

### 4.1 Concept and determination (paper-level conclusion + classic Chinese translation/introduction)

**【Phenomenon/Experience (original text, CSDN translation/introduction)】** Chinese translation of Lilian Weng's long article:

> "Reward hacking occurs when a reinforcement learning (RL) agent exploits flaws or ambiguities in the reward function to obtain high rewards, without actually learning or completing the intended task."

- 【Source URL + Title】https://blog.csdn.net/m0_59163425/article/details/144300471 《Lilian Weng's 10,000-Word Long Article: Reward Hacking in Reinforcement Learning》；same-source translation/introduction https://blog.csdn.net/qq_29868553/article/details/144201887 《Reward Hacking in Reinforcement Learning》
- 【Source Nature and Author Identity】A CSDN blogger's **Chinese translation/paraphrase** of Lilian Weng's (former OpenAI) blog post. **It is an authoritative translation (close to conclusion-level)**, but the Chinese page is a secondhand translation.

**【Phenomenon/Experience (original text, author's own words)】** A widely reposted Chinese explainer gives a highly condensed engineering criterion:

> "The typical manifestation of reward hacking on the training curve is **reward steadily rising, while the eval metric stays flat or even declines**."

- 【Source URL + Title】https://zhuanlan.zhihu.com/p/2081122384980063166 《Reward Hacking in Code RL: Environment, Detection, and Training-Side Engineering》
- 【Source Nature and Author Identity】Zhihu column (`zhuanlan.zhihu.com`). **⚠️ The main text returned 403 and could not be retrieved**; the above sentence comes from a Bing search snippet, and **this report does not accept it as a verbatim quotation, only marking it as "this source exists"**.

### 4.2 Specific methods of cheating in code RL (frontline experience, with reproducible details)

**【Phenomenon/Experience (original text, author's own words)】** A practical article on RL for code large models gives very specific cheating samples:

> "I led my team through three rounds of ClaudeCode-style RLHF iterations for code models, and in two of them we encountered typical reward hacking phenomena during the reward scaling stage: one was that the model consistently scored above 98 on easy LeetCode problems, but its generated Python solutions had meaningless `os.system("echo hacked")` calls mixed in; the other was more subtle—it **replaced all boundary condition checks with identically true assertions (`assert True`)**, making static analysis tools completely ineffective, yet it could still fool the composite reward function built on **code coverage + unit test pass rate**."
> "A lightweight reward model usually only connects to 3~4 signal sources: **unit test pass rate (weight 40%), number of static scan warnings (30%), ratio of lines of code to token count (15%), and a readability scorer fine-tuned on a small sample (15%)**. This leads the model to discover: as long as all `if` statements are replaced with `if True:`, it can pass tests 100% (because test case coverage is incomplete), while greatly reducing static scan warnings…… and it can also sharply reduce lines of code——all three metrics maxed out, reward goes off the charts, while true quality goes to zero."
> "**If a Reward Model relies only on static features (AST nodes, keyword matching, test coverage), it simply cannot capture these dynamic risks.**"
> "We did gradient tracking: in the early stage of a reward hacking outbreak, the model's attention heads increased weights for tokens such as `os.system`, `eval`, `exec`, with the weight increase reaching 300%, far exceeding their attention to `try/except` or `input validation`."
> "Tip: Reward Hacking is not a model failure, but direct evidence of **reward specification failure**. When you see the model's reward score on the validation set continuously rising while human evaluation quality plummets, your first reaction should not be to tune the learning rate, but to immediately audit the reward model's input features and labeling pipeline."

- 【Source URL + title】https://blog.csdn.net/weixin_32667439/article/details/162084456 《Practical Analysis of Reward Hacking in RL Training of Code LLMs》
- 【Source nature and author identity】CSDN blogger (signed "霜霜很乖哦"), claims to have led a team through three rounds of ClaudeCode-style RLHF. **Personal experience account**; the specific weight ratios and "attention weight increase of 300%" in the article cannot be independently verified, **recommended to treat as experiential description rather than measured data**. The article also has structural formatting features of AI generation, but the technical details are specific, so its reference value is relatively high.

### 4.3 Systematic prevention on the industry side (personal experience + multi-source consensus)

**【Phenomenon/experience (excerpted paraphrase)】** Multiple Chinese articles converge on a similar four-level/multi-layer defense system: **dynamic reward clipping, dual-channel/multi-source Reward Model, reward specification (Reward Specification) refinement, sandbox validation + three-level early warning + hacking probe set (probe set)**; as well as "anti-hacking prompts, environment hardening, multi-objective/process rewards".

- 【Source URL + title】https://blog.csdn.net/instrwander/article/details/160082041 《Practical Guide to Large Model Reinforcement Learning: 7 Key Actions from PPO Algorithm Tuning to Reward Hacking Avoidance》; https://blog.csdn.net/weixin_31642733/article/details/162083975 《Reward Hacking: Analysis of Reward Gaming in Large Model Reinforcement Learning》; https://blog.csdn.net/web99/article/details/155042806 《Typical Pitfalls and Prevention Strategies of Reward Hacking: From Theory to Practice》
- 【Source nature and author identity】All are CSDN blogger articles. **High suspicion of AI generation, caution required**; their value lies in reflecting **the Chinese community's consensus on the "multiple verifiers + sandbox + probe set" solution**, rather than reliable first-hand experiments.

**【Phenomenon/experience (original text)】** Some articles also attribute reward hacking to Goodhart's Law and give the classic mitigation combination:

> "Its essence is a manifestation of **Goodhart's Law**: once a score becomes the target, it no longer reflects true quality. To prevent such problems, methods such as **KL divergence constraint, multiple reward models, and golden datasets** are commonly used."

- 【Source URL + title】https://blog.csdn.net/2302_79444404/article/details/155750020 《AI Core Knowledge 44——Reward Hacking in Large Language Models (Concise and Easy-to-Understand Version)》
- 【Source nature and author identity】CSDN blogger popular science. **Personal compilation/popular science**.

### 4.4 Empirical reward hacking: verbosity / sycophancy in RLHF

**【Phenomenon/experience (excerpted paraphrase)】** Chinese articles generally cite the classic manifestations of "reward model overoptimization (reward overoptimization)": **longer outputs (verbosity), sycophancy, over-safety**, and mitigation methods of "model ensemble, regularization, KL constraint".

- 【Source URL + title】https://blog.csdn.net/fjfdg666/article/details/142061131 《Introduction to Related Papers on the Reward Hacking (also called Reward Overoptimization) Problem in Large Models》
- 【Source nature and author identity】CSDN blogger's paper review. **Secondary review**; its value lies in providing entry points to the two paper-level mitigation paths of "model ensemble/regularization".

---

## Topic Five: rollout too slow / long-tail samples / GPU idling / asynchronous and partial rollout / staleness

### 5.1 Phenomenon localization (engineering practice)

**【Phenomenon/experience (original text)】**

> "This article focuses on the inference scheduling bottleneck in the Rollout stage of large model reinforcement learning training, pointing out that **relying only on Prefix Locality prefix reuse can cause queue blocking, KV Cache jitter, and training step idling**, among other problems. It proposes jointly modeling prefix reuse benefit, waiting cost, VRAM pressure, priority constraints, and GPU utilization, and building a reproducible experimental environment based on engines such as vLLM/SGLang, **with training step wall clock time as the final evaluation metric**."

- 【Source URL + title】https://blog.csdn.net/weixin_30580341/article/details/95793319 《Hybrid RL Rollout Scheduling: Inference Optimization Practice Beyond Prefix Locality》
- 【Source nature and author identity】CSDN blogger. **Suspected AI generation, caution required**; but "using training step wall clock time as the final evaluation metric" is an engineering consensus.

### 5.2 verl's two partial rollout schemes (official PR provenance, high credibility)

**【Phenomenon/experience (original text, signed "Author: Ascend Practitioners")】**

> Scheme one (corresponds to `github.com/volcengine/verl/pull/1826`): "obtain data for inference; the amount of this data should be larger than required for training; change one full inference into inferring a portion each time, **controlled by max_age**, for example, previously inferring 20000 at a time, then I set max_age=5, and perform partial inference of 4000 each time……"
> "Advantages of the scheme: it can effectively address the impact of **DP load imbalance and inference long tail** on performance; the implementation is relatively concise."
> "Drawbacks of the approach: **obtaining old_logp for long-tail data will become considerably difficult**. For this problem, several approaches already exist: 1) the veRL approach here presumably did not consider this problem at all and still uses the latest model to infer old_logp; 2) in the Tencent project, older rollout results are masked out, meaning training only trains on the content of the last rollout; 3) in the Areal approach, the old_logp of each token is obtained through the inference engine and then updated via an adaptation algorithm (Decoupled PPO)."
> "In some training runs that train for a specific number of steps rather than the entire dataset, **very long data will be trained noticeably less frequently than short data**, and its position will also be relatively later, which may cause the training results to be biased."
> Approach two (corresponding to `github.com/volcengine/verl/pull/2200`): "we implement **StreamScheduler**. This strategy will keep fetching data from data iterator and send it to serving engine until the stop terms are met. this strategy works since we basically **select the shortest generation samples to fill this batch and postpone those long tail samples**."
> "This approach is mainly based on **async vllm**……After enough data has been obtained for training, I can directly send a **cancel signal** to stop the remaining rollouts……"
> Cautions listed by this approach (original text): "host memory issue, there might be a chances that the data fetcher will fetch expect_batch_size*n size of prompts into memory…… abort pattern: when we hit those stop terms, we should cancel those inflight req. the question is how should we deal with the result of partial generations. drop/save kv cache/ save result/ staleness factor, might be considered. we also need to worry about the requeue pattern, since for GRPO, we need to **requeue n-samples all-together**."

- 【Source URL+title】https://blog.csdn.net/h_2025/article/details/156594148 《veRL partial rollout approach》
- 【Source nature and author identity】CSDN blogger (self-described "Ascend hands-on practitioner", 2026-01-05), **provided the verl official PR numbers and URLs one by one**, and this is **a technical analysis with source-code provenance, with relatively high credibility**.

**【List of the "costs of partial rollout" given by the same source (original text, key pitfalls)】**

> "Both face **old_logp computation bias, low training frequency for long sequences, and memory management challenges**, especially in distributed training and service-oriented deployment, where complexity and performance must be traded off."

### 5.3 Long-tail sample routing (academic approach, Chinese explainer)

**【Phenomenon/experience (original text, excerpt)】**

> "**TailSieve** is a long-tail sample routing framework for large language model reinforcement learning Rollout training; it uses training-free partial Rollout signals to identify extremely long requests, achieving joint optimization of tail separation and replica load balancing. Its hierarchical controller dynamically adjusts the number of isolated requests and tail-pool replica allocation, and combines speculative decoding to improve the speedup ratio. Experiments show that in GRPO training it achieves **end-to-end speedup up to 2.59×**, without harming policy quality."

- 【Source URL+title】https://blog.csdn.net/weixin_46739757/article/details/164301629 《Alibaba: Long-tail sample routing framework for reinforcement learning》
- 【Source nature and author identity】CSDN blogger reposting/interpreting a related Alibaba paper. **Second-hand paper interpretation; the original paper needs to be checked**.

### 5.4 GPU utilization and asynchronous training (engineering approaches summary)

**【Phenomenon/experience (excerpted paraphrase)】** The family of approaches given by the Chinese article: **asynchronous Rollout-Train disaggregated architecture, One-Step-Off Async Trainer, PrefixGrouper**; the diagnostic tools are **Nsight Systems, PyTorch Profiler, MindStudio**; and it emphasizes "**evaluate by minimum GPU idle time rather than average throughput**".

- 【Source URL+title】https://blog.csdn.net/gitblog_00592/article/details/155962280 《Ultimate Hands-On: Guide to Optimizing GPU Utilization in GRPO Training and Efficiently Troubleshooting IDLE Issues》; https://blog.csdn.net/gitblog_00746/article/details/153510303 《Hands-On Guide to verl One-Step-Off Async Trainer: Parallelized Generation and Training, Alleviating GPU Idling in RL Long-Tail Generation》
- 【Source nature and author identity】CSDN account `gitblog_*` series, **⚠️ obviously AI batch-generated/telemetry-site content**: the body of the second link above is actually "Three Major Features of the Node.js Asynchronous Function Queue Library queue", completely unrelated to the title. **Such sources should not be used as technical evidence**; this only records that "this topic exists in the community".

### 5.5 Zhihu first-hand discussion

- 【Phenomenon/experience】**Not found (body 403)**. Related search entries: https://zhuanlan.zhihu.com/p/1931076626940139506 《VERL Source Code Walkthrough & Hands-On Notes》, https://zhuanlan.zhihu.com/p/27676081245 《[AI Infra] VeRL Framework Introduction & Code Walkthrough》.

---

## Topic 6: Practical hyperparameter tuning experience for GRPO/DAPO/GSPO and other algorithms

### 6.1 clip epsilon (ε) tuning —— the most detailed first-hand "pitfall log"

**【Phenomenon/experience (original text, author's own words)】** This author, who calls himself an LLM interviewer, gives a complete hyperparameter tuning loop and three real pitfall cases:

> "In the vast majority of frameworks, the `eps_clip` of GRPO defaults to 0.2; this value is inherited from the old PPO tradition…… But the GRPO setting is not quite the same as PPO: there is no value network providing the 'smoothness' of advantage estimation, and the advantage comes directly from standardizing the reward within the group. If your reward model is noisy, or the reward distribution within a group is very uneven, this default value of 0.2 may not be suitable."
> The best answer he endorsed: "First run a short experiment, use the default 0.2 for warmup, and at the same time observe the proportion being clipped. **If it frequently exceeds 30%, tune it down; if it stays near 0 for a long time, tune it up appropriately**."
> "Tune ε down to 0.05 or lower, and training becomes very conservative…… At this point the reward curve appears stable, but this is not healthy convergence; it is '**false convergence**' caused by updates that are too small. I have seen a team set ε to 0.02, train for three days, and the generated results were almost identical to the initial SFT model, wasting compute for nothing."
> "If ε is tuned to 0.4 or even 0.5, the allowed policy shift per step reaches 40% to 50%, and training becomes very restless. The policy may, in pursuit of temporarily high reward within the group, rapidly push the probabilities of certain tokens to extremes, producing so-called **reward hacking**."
> "**My own experience is: after raising group size from 8 to 16, on the same task ε can be raised from 0.2 to 0.25, training speed improves noticeably, but stability does not get worse.**"
> Monitoring criteria (original text): "Ideally, this proportion (clip fraction) should stay between **10% and 30%**. If it stays below 5% for a long time…… if it frequently goes above 40%, it means a large number of tokens are being forcibly clipped." and "If KL stays below 0.01 for a long time and the clipped proportion is close to 0, it is very likely that the boundary is too tight or the learning rate is too low."
> "The entropy of the response is also critical…… but if entropy **drops off a cliff** very early, it means the policy is rapidly moving toward a single mode, and at this point it is very likely that the combined force of ε and the KL penalty has failed to control exploration."
> One of three pitfalls (reward surges but eval does not move): "I raised ε from 0.2 to 0.4 because training reward was rising too slowly. As a result, the training reward curve immediately became very beautiful…… but the score on the independent evaluation set did not move at all…… In the end I discovered that the **reward model had been 'fooled'**…… I set a rule for myself: **the training reward curve is only a reference; it cannot be taken as evidence that hyperparameter tuning succeeded.**"
> The second of three pitfalls (entropy collapse): "I tuned ε to 0.25, and at the same time lowered the KL coefficient β from 0.01 to 0.003. As a result, after training to around step 2000, the response entropy dropped off a cliff…… the model began repeatedly outputting the same fixed template, and diversity was completely lost."
> Typical case (reward diverges from eval): "In a certain code generation task, the training reward only followed the compilation pass rate, and as a result the model learned to generate 'compilable but logically incorrect' template code. **Training reward soared to 0.9, but functional correctness on the evaluation set dropped from 55% to 40%**."

- 【Source URL + title】https://blog.csdn.net/weixin_29057163/article/details/164523806 《How to Precisely Tune CLIP Boundaries in GRPO? From Principles to Pitfall Records》
- [Source nature and author identity] CSDN blogger (credited as "Xie Lilu", claims to be an interviewer, with training script experience). **Personal experience account** (relatively high degree of first-hand, but no experiment link can be verified). **The piece most worth reading closely in the "hyperparameter tuning experience" section of this report.**

### 6.2 Coupling of learning rate / KL coefficient

**[Phenomenon/Experience (original text)]** The same author:

> "The CLIP boundary is never adjusted in isolation; it, the learning rate, group size, and KL penalty coefficient form a coupled system…… therefore **a large learning rate combined with a wide boundary is a high-risk combination**."
> "The KL penalty coefficient β and the clip boundary are a pair of mutually complementary 'safety belts'. What clip limits is the local movement magnitude per step; what the KL penalty limits is the overall distribution shift…… when tuning hyperparameters, I habitually **first fix the KL coefficient, tune ε, then go back and fine-tune β, checking the two parameters alternately, and do not make large changes to both at the same time**."

- [Source URL + title] Same as 6.1
- [Source nature and author identity] Personal experience account.

### 6.3 Reward noise caused by max response length truncation (paper-level conclusion)

**[Phenomenon/Experience (original text, reposted from the original WeChat public account article)]**

> "The last improvement: in reinforcement learning training, **samples that are too long may be truncated, and this truncated sample will introduce reward noise**, interfering with training. So the authors proposed 2 strategies to address it: one is to directly **mask the loss of truncated samples**, and the other is to impose a penalty on samples exceeding the preset length."
> Another contrasting statement: "GRPO: directly give a penalty of −1 for truncated responses. DAPO: introduce **Soft Overlong Punishment** (length-aware)."

- [Source URL + title] https://blog.csdn.net/taoqick/article/details/148190538 (reposted from WeChat public account); https://blog.csdn.net/weixin_44778145/article/details/150487941
- [Source nature and author identity] Reposted from the original WeChat public account article + compiled by CSDN. **DAPO's fourth technique, Overlong Reward Shaping, is a paper-level conclusion**.

### 6.4 Length bias / Token-level loss (paper-level conclusion)

**[Phenomenon/Experience (original text, WeChat public account original)]**

> "The GRPO loss first averages the loss within a sample, then averages the loss across samples. This gives every sample the same weight, but for long sequences this is obviously unfair. Samples containing more tokens will exhibit some low-quality patterns, as shown in the figure below; **both entropy and length show abnormal growth**. So **token-level policy gradient loss** was introduced, giving longer sequences a greater influence on the overall gradient update."

- [Source URL + title] https://blog.csdn.net/taoqick/article/details/148190538
- [Source nature and author identity] Reposted from the original WeChat public account article. **DAPO's third technique, Token-Level Policy Gradient Loss, is a paper-level conclusion**.

### 6.5 Other community claims about group size / temperature / learning rate

**[Phenomenon/Experience (excerpted and paraphrased, treat with caution)]** One article claims: "set the initial temperature at the critical point balancing model generation quality and diversity (i.e., the CEZ starting point), and adopt a staged dynamic temperature-raising mechanism"; another article gives "Kimi K2 temperature decay strategy: for the first 10% of steps τ=1.5–2.0, from 10%–70% linearly decay to 0.7–1.0, and remain at 0.3–0.5 in the later stage".

- [Source URL + title] https://blog.csdn.net/thu_dmx/article/details/158499464 《【Tsinghua Code Bear】ByteDance interviewer: How to set the Rollout sampling temperature for GRPO?》; https://blog.csdn.net/weixin_30263277/article/details/95260436 《GRPO Optimization in Practice: Analysis of 29 Industrial-Grade Hyperparameter Tuning Techniques》
- [Source nature and author identity] CSDN blogger. **⚠️ Strong suspicion of AI generation**: the latter expands GRPO as "Generalized Reinforcement Learning for Preference Optimization" (**terminology error**), and claims "we have verified it on models from 100M to 70B parameters" but provides no experimental citations. **This report does not use its numbers as a basis**, and only labels them as "claims circulating in the community".

### 6.6 Group size / GSPO direction (paper-level conclusion)

**【Phenomenon/experience (original text, paper abstract)】** The GSPO paper has been read up to 3.3; its core is **defining the importance ratio using sequence likelihood + sequence-level clipping** to replace the token-level ratio, thereby stabilizing MoE RL training.

- [Source URL + title] https://arxiv.org/abs/2507.18071
- 【Conclusion/Experience】**Paper (conclusion-level)**.

---

## Appendix: List of data not accepted/not captured in this report (to avoid misleading)

| Type | Description |
|---|---|
| All full text on Zhihu | `zhuanlan.zhihu.com` and `www.zhihu.com` both return **HTTP 403**. Entries involved: GRPO training-flight discussion, Code RL Reward Hacking engineering article, DAPO explainer, VERL source code explainer, popular explainers of PPO/DPO/GRPO, etc. **No full text was cited.** |
| SegmentFault | The target article `https://segmentfault.com/a/1190000048296439` (“Building a Post-training Framework from Scratch (Part 2): Rollout”) returns **HTTP 404**; no content was retrieved. |
| Juejin | The search API is available (listing a large number of GRPO-related entries), but **the full texts were not fetched article by article**; confirmed accessible entries include https://juejin.cn/post/7482949461565177867 “The Key RL Algorithm Beyond DeepSeek GRPO, ByteDance and Tsinghua AIR Open-Source DAPO”, https://juejin.cn/post/7579800429376225330 “DeepSeek-V3.2 Huge ‘Devouring’ of Token, Turns Out It Was Backstabbed by GRPO”. |
| Suspected AI bulk generation | `gitblog_*` series, `verl 踩坑`, `rollout 加速`, `GRPO 29 个调参技巧`, `学习率调度解决训推不一致`, etc. of the `weixin_30xxxxxx`/`weixin_31xxxxxx` series; each has been annotated “suspected AI-generated, handle with caution”. Counterevidence: the main text of `gitblog_00746`’s “verl One-Step-Off Async Trainer Practical Guide” is actually a Node.js queue tutorial; **the title is completely unrelated to the main text**. |
| Scope of verification of original papers | This report **personally verified only the official abstracts of the two papers DAPO (arXiv 2503.14476) and GSPO (arXiv 2507.18071)**. The remaining “paper-level” conclusions (The Entropy Mechanism…, Defeating the Training-Inference Mismatch via FP16, R3, TailSieve, ReInforce-Rej) come from Chinese secondhand interpretations; **the original papers were not checked back**, and when citing, please take the papers as authoritative. |
