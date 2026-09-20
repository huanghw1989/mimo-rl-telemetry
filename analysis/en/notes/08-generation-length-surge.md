# Generation length rising from 80k to 120k: where this statement came from and what the data says

> Material identity: **analysis report**. The main body is **our own measurements**—all numbers come from local telemetry `data/store/`,
> recomputed from `src/length_report.ts`; the other two sections are respectively labeled **collection verification** (original text from two communities, see
> `analysis/en/notes/research-C-english-community.md`, `analysis/en/notes/research-C-chinese-community.md`) and **external literature** (original text from papers and official documentation).
> Wherever it is my inference, I wrote "this is an inference".
>
> Data as of **pro step 24, flash step 30** (sync of local repository 2026-09-19 08:58Z / 03:07Z).
> To see the full correlation scan and its robustness checks, read it together with `analysis/en/notes/09-generation-length-correlation.md`; that one uses another independent script
> (`correlate_report.ts`), the first and last values computed by the two scripts agree.

---

## I. Conclusion first

1. **This statement is secondhand and has been retold twice; its source is a tweet by Sasha Rush, and the tone is skepticism, not curiosity.** Original wording
   "just feels like 80k->120k is too big a jump." (it just feels like the jump from 80k to 120k is too big), 2026-09-17 11:34.
   Domestically, after Zimubang reported it, multiple outlets reprinted it (same source); English-language media abroad **did not mention this item at all**.(Collection verification)

2. **I reconstructed which segment of data "80k→120k" corresponds to: it is the single dataset `code/dataset-obg8` of pro,
   rising from around 80k at steps 1～3 to 112k～118k at steps 12～14.** It is not the site-wide mean—at that moment the site-wide mean was only
   87k～101k, so the question in domestic collection notes of "not seeing 120k" is a matter of metric definition, not a data problem. (Our own measurement recomputation)

3. **Describing it as a "sudden jump" is wrong; it is a continuous climb repeatedly interrupted by restarts.** A linear trend explains 85.1% of the variance in pro generation length,
   while a single-step model of "jumping up at some step" explains only 59.7% (flash: 91.9% vs. 73.0%). The two most violent steps in the whole run are precisely both **drops**
   (pro step 15 −14.2%, that step had restarts combined with three version switches).

4. **The length is not "thinking longer"; it is most likely "each sentence is longer".** Decompose length into "number of turns × length per turn": pro's length rose 64.7%,
   of which only 18.9% comes from more turns, and 81.1% comes from longer turns (per turn 1,521 → 2,278 tokens). flash is half and half
   (51.2% / 48.8%). (Our own measurement)

5. **The dashboard's line that "length is highly positively correlated with performance" is an illusion caused by a common trend.** pro's `dynsam/avg@n` (average pass rate)
   has a rank correlation with length of +0.786; after taking first differences, only −0.063 remains (p=0.77); flash is even more reversed: +0.932 → −0.484 (p=0.0078).
   **At the steps where length jumps, the pass rate tends not to rise or even to fall.** (Our own measurement, see `notes/09` for details)

6. **The cost falls on the trainer, not on generation, nor on truncation.** Trainer time per billion tokens rose by 47%～48% (generation time instead dropped to
   0.55～0.70 times); a context limit does exist (`ctx_total_length/max` has long been pinned at **1,048,570 = 2²⁰−6**),
   but truncated trajectories account for at most three per thousand. (Our own measurement)

In one sentence: **this curve looks more like a side effect of the objective function, not like "length bought score"; and it has not stopped—pro's last step +13.1%,
flash's last step +13.0%, both the largest single-step increases in the whole run.**

---

## II. Where this statement came from: the results of the two collections put together

### 2.1 Original text and tone

Sasha Rush (former Cornell professor, involved with Cursor) posted a three-tweet thread on 2026-09-17; this is the original source, not a retelling:

| Time | Original | Chinese |
|---|---|---|
| 09-17 11:30 | "I'm on my phone monitoring the MiMo v2.6 response length on coding-obg8 like a degenerate gambler." | I'm staring at the answer length of MiMo v2.6 on coding-obg8 on my phone like a degenerate gambler. |
| 09-17 same as above | "Just insane you can watch this -> mimo.xiaomi.com/rl/" | Being able to watch it directly like this is too absurd. |
| 09-17 11:34 | "just feels like 80k->120k is too big a jump." | It just feels like the jump from 80k to 120k is too big. |

(Source: `x.com/srush_nlp/status/2100427133440950536`, `.../2100427931705098465`, `.../2100428266792272023`;
Screenshot `.playwright-mcp/mimo-en-srush-80k-120k.png`. Evidence strength: official first-hand = the person's own account)

Two points worth noting:

- **The tone is skepticism, not curiosity.** A common summary is that Rush "was curious about the jump," but `is too big a jump` says this magnitude
  is unnatural. When retelling it, don't write "he really wants to know why it rose."
- **English-language media did not pick up this item at all.** 36kr's English edition only quoted Han Xiao, elie, and a netizen Zain; TechNode, Forkast, RITS
  did not mention it. So in English-language circles it is just an observation on X, and no discussion formed.
- Rush's tweet has 13 replies, but X's reply thread does not render when not logged in, and three telemetry sites (xcancel 451, lightbrd 403,
  nitter 403) are all blocked. **So whether anyone explained it in the replies is something we cannot disprove; we can only say we did not find it on accessible pages.**

### 2.2 Which segment of data is "80k→120k" exactly

There is no field called `response length` on the dashboard. What corresponds to "answer length" is the `ctx_*_length` family, split by task category and dataset.
The `coding-obg8` that Rush named is `code/dataset-obg8` on the dashboard. I list pro's series for this one step by step:

| Step | 1 | 2 | 3 | 4 | 8 | 10 | 11 | **12** | 13 | **14** | 15 | 20 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Average context length for this dataset | 79,853 | 77,582 | 83,172 | 94,895 | 97,894 | 108,316 | 101,513 | **112,495** | 105,875 | **118,125** | 125,183 | 131,733 | **165,762** |

(unit: tokens. For the same dataset, `ctx_prompt_length/.../mean` is 2,509～3,221 throughout, almost flat, so all of the increase is the part generated by the model itself:
step 1 about 77,052 → step 24 about 162,741, ×2.11. Evidence strength: our own measurement)

**Can it be matched to which step?** Rush tweeted at 09-17 11:34.

- If read as UTC: at that time pro had just completed step 14 (06:51Z), obg8 = 118,125;
- If read as Beijing time (UTC+8): that is 03:34Z, pro had just completed step 12 (01:19Z), obg8 = 112,495.

**Both readings fall in the step 12–14, 112k–118k range, so "120k" matches; whereas "80k" is the step 1–3 reading.**

**This also resolves one open question.** The domestic collection notes say: "The Chinese-side length metric is `ctx_total_length` with mean 86k–104k,
120k is not visible, so this number is suspected to be a single-task step." — The metric was found correctly, but that person was looking at the **site-wide mean**
(`ctx_total_length/mean`), while Rush was watching **a single dataset** (`code/dataset-obg8/mean`). At the same moment,
The site-wide mean is 87k, obg8 is 112k, a 30% difference. **So it is not that "120k is not visible"; it is that the line being looked at is different.**

**Both communities only relay it and neither explains it.** Among 38 foreign sources, no one gives a mechanism; among 19 domestic pages, no one connects it to length inflation or
reward hacking — the only Chinese thing adjacent to this is the vibe life metric dictionary's `dynsam/agg_turn/mean` (average turn count)
line, which left a note: "Must be viewed alongside the pass rate, to prevent 'turn count inflating while performance does not'." **That is exactly the question this article aims to answer, and at the time it did not answer it.**
(Evidence strength: collection cross-check)

---

## 3. Shape: not a sudden jump, but a climb interrupted by restarts

| Metric | pro (24 steps) | flash (30 steps) |
|---|---|---|
| Trajectory mean generation length first→last | 68,078 → 114,676（×1.68） | 67,463 → 143,385（×2.13） |
| code-category equal-weight mean first→last | 73,447 → 134,017（×1.82） | 71,829 → 158,571（×2.21） |
| Increase for each of the 11 code datasets | ×1.40 ～ ×2.28 | ×1.40 ～ ×3.21 |
| Variance explained by a linear trend | 85.1% | 91.9% |
| Variance explained by "a jump at some step" | 59.7% | 73.0% |
| Largest single-step change over the whole run | Step 15 **−14.2%**, step 24 +13.1% | Step 16 **−8.6%**, step 30 +13.0% |

(Evidence strength: our own measurement)

**How to read this table**: to judge "sudden jump or climb," there is a dumb method — separately fit "a straight line" and "a step-like rise after some step,"
and see which explains more variance. Here the straight line wins in all cases, and wins by a lot, so it is a **sustained climb**. Meanwhile, the two most extreme steps over the whole run are both declines,
pro's step 15 happened to coincide with one restart and three **dashboard metric-set snapshot updates** (`3-5513.14.7.0` / `.14.8.0` / `.14.8.15` — the second segment of the version string is the step number at the time, all 14, so this is a change in the telemetry manifest, not training config being changed three times),
`timing_s` also shows that this type of step cannot be used as an algorithmic conclusion.

**Restarts systematically push length down**: for pro, the mean length change at the "first reported step after a restart" is −3.3% (4 out of 5 are negative),
other steps not affected by engineering events are +5.5% (only 1 out of 13 is negative); flash is cleaner, with first step after restart −6.3% (all 3 negative),
other steps +3.9%. (Our own measurement; this is also the key to the "spurious correlation" section in `notes/09`: remove steps adjacent to restarts,
and many beautiful correlations fall apart.)

**So the statement "a sudden jump from 80k to 120k" needs two corrections**: first, it is a single dataset, not site-wide; second, its climb upward was interrupted by restarts
at least twice, not a one-step jump.

---

## 4. Where does length come from: break it into "turn count × per turn"

Training is agentic — the model goes back and forth with the environment for multiple turns (write code, run tests, look at errors, revise), so "how long a trajectory is" is the product of two things:

```
trajectory length = number of turns (dynsam/agg_turn/mean) × average tokens emitted per turn
```

| run | Length increase | Turn count increase | Per-turn increase | Share of length growth from turns | Share from per turn |
|---|---|---|---|---|---|
| pro | +64.7% | +9.9% | +49.8% | 18.9% | **81.1%** |
| flash | +106.3% | +44.8% | +42.4% | 51.2% | 48.8% |

(Tokens per turn: pro 1,521 → 2,278; flash 1,514 → 2,156. Shares are computed with logarithmic decomposition, because "45% increase then another 45% increase" is not "90% increase". Evidence strength: our own measurement)

**This is more useful than "how much length increased"**: pro's length inflation is almost entirely "more emitted per turn"; the turn count barely increased (47.5 → 52.2,
and in the middle step 23 it even dropped to 42.5); flash is half and half. **So although both lines are lengthening, the mechanisms are not entirely the same** —
applying pro's conclusion to flash would be half wrong. This also explains why, when that domestic metric dictionary flags "turn count inflating" as the main risk,
the data actually gives a finer answer: pro's risk is not in the turn count, but in the length per turn.

One counter-evidence should also be presented: `code/dataset-yfch` (this dataset is itself the longest, 180k–520k token) on flash length
×3.21, while the training pass rate over the same period rose from 0.4717 to 0.8217. **So "longer length is definitely useless" is likewise an overgeneralization.**

**One metric caveat that must be added**: the "overall generation length" above is the traffic-weighted average across datasets, and **the traffic itself is changing**.
Use `dynsam/<类别>/dataset-<代号>/num_accepted/step` from step 1 and the final step (the number of problems the sampler allocates to each dataset)
as weights, and decompose the total increase into three terms — each dataset itself getting longer (within), traffic mix shifting (between), and the interaction of the two:

| run | Total first→last | Own lengthening | Mix shift | Interaction |
|---|---|---|---|---|
| pro | 70,224 → 123,136（+52,912） | **74.2%** | −5.5% | 31.3% |
| flash | 66,964 → 161,227（+94,262） | **76.6%** | +6.1% | 17.3% |

(Our own measurement; weights use `num_accepted/step`, 23 datasets that have this weight. The interaction term is "the datasets traffic shifts toward happen to also be lengthening,"
and by convention is not attributed separately to either side — split half-and-half onto the mix gives pro 12.9% / flash 11.7%.)

**How to read**: **Three quarters comes from "each dataset itself writing longer," and the remaining one to two tenths is related to traffic mix** — mainly falling on
`code/dataset-yfch`, the dataset that is itself the longest in the whole run (flash's problem-count share rose from 2.10% to 5.28%).
So the main conclusion that "the model writes longer and longer" holds, but **when reading aggregate metrics like "total length," one must first ask "did the weights change?"**:
If you look only at the total, you cannot distinguish "the model changed" from "the sampler swapped in a different batch of problems."
(Applying the same decomposition to **scores**, the mix term is only −7.6% (pro) / +9.2% (flash), and **the score aggregate is much cleaner than length** —
this is also an independent conclusion of `notes/11`.)

---

## 5. Length and scores: level correlation is a shared trend; remove the trend and it disappears

| Metric (versus generation length `ctx_response_length/mean`) | pro level ρ | pro first-difference ρ | flash level ρ | flash first-difference ρ |
|---|---|---|---|---|
| `dynsam/avg@n` mean pass rate (homepage main metric) | +0.786 | **−0.063**（p=0.77） | +0.932 | **−0.484**（p=0.0078） |
| `train/passrate/avg_passrate` training-batch mean pass rate | +0.749 | +0.508（p=0.013） | +0.898 | +0.247（p=0.20） |
| `critic/score/mean` mean trajectory score for this step | +0.871 | −0.082（p=0.71） | +0.896 | −0.106（p=0.58） |
| `critic/advantages/mean` mean advantage | −0.477 | −0.471（p=0.023） | −0.778 | −0.378（p=0.043） |

(Evidence strength: our own measurement. Spearman rank correlation, pairwise deletion of missing values; n is 24 / 30 respectively, and the critical |ρ| at p=0.05 is 0.404 / 0.361)

**The difference between "level correlation" and "difference correlation" is the one concept from this material most worth taking away.** Two curves both going upward over time,
Correlation coefficients are naturally very high—this is called **spurious correlation**. What can answer "if length increases a bit more, does the score also increase a bit more" is to take both curves
**First-order differencing** (this step minus the previous step) and then compute correlation, because differencing removes the common time trend. Here after differencing:
pro goes to zero, flash turns significantly negative.

**A sharper cut**: the only significantly positive one on pro (training pass rate +0.508) after **removing steps adjacent to restarts/version switches**
becomes −0.133 (p=0.73)—**it is almost entirely propped up by the few points around engineering events**. And because flash has fewer restarts (5 total vs pro 11),
after removal, the negative correlation of `avg@n` is instead stronger (−0.623, p=0.0044). Putting the relative differences of the two runs together (n=52),
`avg@n` versus length is −0.302 (p=0.030).

**Aligning with offline evaluation leaderboards is the same**: DeepSWE v1.1's **level** correlation with length is pro +0.725 / flash +0.815, which looks rock-solid;
after differencing it is +0.041 / −0.023, gone. (Our own measurement)

Conclusion: **In this dataset, "length rising" is not evidence of "score rising."**

---

## 6. Cost: the trainer slows by half, the hard cap really exists, but truncation is not the bottleneck

| Metric | pro | flash |
|---|---|---|
| `timing_s/trainer_ops` (trainer time for this step) ÷ token count for this step | 1,605 → 2,374 seconds per billion tokens (×1.48, r=0.803) | 1,053 → 1,553（×1.47） |
| `timing_s/outer_gen` (sampling generation time) ÷ token count for this step | ×0.55 | ×0.70 |
| `ctx_total_length/clip_ratio` max | 9.18e-4 (step 22, about 23 trajectories / 25,088) | 3.1e-3 (step 19, about 78) |
| `train/verdicts/dropped_empty_response` (discarded because response was empty) | 0 throughout | 0 throughout |
| Number of steps where `ctx_total_length/max` lands on 1,048,570 | 11 / 24 | 15 / 30 |
| Cost rate / cumulative | $5.71/second / $1,941,107 | $2.855/second / $854,045 |
| Total restarts over the whole run | 11 | 5 |

(Evidence strength: our own measurement. The two together total $2,795,152, $30,834/hour, cumulative 137.36B tokens, which matches the often-cited Chinese-media
"about $30,000 per hour" matches; but **this cumulative figure is "fixed rate × runtime," not actual metered billing**; it keeps accumulating during restart waits.)

**Three things need to be said separately:**

1. **The trainer pays for length.** Training time per token rose by nearly 50%, the typical cost of attention growing with sequence length
   (attention cost is superlinear in length). The generation side is instead "cheaper"—indicating generation time is not billed linearly per token,
   it is dominated by agent turns and sandbox waits.
2. **The hard cap is real.** 2²⁰ = 1,048,576, while the measured maximum has long been exactly 1,048,570, a difference of 6. **This is not a coincidence**,
   indicating there is a hard cap of 1 million tokens, and trajectories have already hit it. (By the way: the domestic collection notes record
   "context limit 1,048,576" is correct; the measured ceiling-hitting value is 1,048,570.)
3. **But "hitting the cap" is not yet the bottleneck.** Truncated trajectories are at most 3 per thousand (pro max 23 in one step, flash max 78),
   and there are zero empty responses. So the claim that "longer responses blow up the context and pollute the training signal" **does not yet hold**;
   for it to hold, the truncation rate would need to enter the 1% range and rise clearly with length.

**A counterintuitive contrast**: `timing_s/step` (per-step time reported on the dashboard, excluding restart waits) has correlation with length on pro of only +0.760
(after differencing −0.144), far less stable than the trainer-time one. Because it is dominated by sampling and sandbox queueing time, length is not its main explanatory variable.

---

## 7. Mechanism: why the objective function pushes length upward

The data itself can only point the way; explanations must be sought in the literature. Three line up:

| Literature | What was said | Does it line up with our data? |
|---|---|---|
| [DAPO](https://arxiv.org/abs/2503.14476)（arXiv:2503.14476）§3.3 | sample-level loss aggregation "cannot effectively penalize low-quality patterns in long samples (garbled text, repetition), leading to unhealthy growth in entropy and response length" | Lines up: our policy entropy rises throughout (pro 0.3953 → 0.4437, flash 0.4133 → 0.4706), and length rises over the same period |
| [Dr. GRPO](https://arxiv.org/abs/2503.20783)（arXiv:2503.20783） | GRPO has an optimization bias toward "artificially lengthening responses, especially incorrect responses" | Directionally lines up (see below) |
| [Concise Reasoning via RL](https://ar5iv.labs.arxiv.org/html/2504.05185)（arXiv:2504.05185） | Gives a theorem: **negative advantage is a sufficient condition for lengthening responses**; and observes that correct responses are generally shorter than incorrect ones | Lines up: our `critic/advantages/mean` has a **negative** correlation with length (pro −0.477, flash −0.778) |
| [verl's DAPO recipe](https://verl.readthedocs.io/en/latest/algo/dapo.html) | Gives the formula for overlong penalty, and states that the official best experiment **did not enable** overlong filtering | Echoes Section 6: this kind of training may not necessarily treat "long" as a problem to begin with |

(Evidence strength: external literature; all are papers/documentation originals we can open)

**Putting this mechanism in plain language**: the length growth in this data **does not appear to be the model discovering "writing longer scores points," but rather the optimization process itself pushing it**.

- If length were produced by "score farming," we should see "length rises → score also rises." But under the differencing measure the score **does not rise** (Section 5),
  the `critic/score/mean` used in training is not significant under any measure.
- If length were a capability improvement like "the model learned a longer reasoning chain," it should not be erased by a single operational restart by 6%～14%. But it was erased.
- The remaining explanation is: **length is a side effect of the objective function and the within-batch data composition**—negative-advantage samples are pushed toward longer outputs
  (the theorem in the literature), and once samples get longer, data in the asynchronous pipeline gets staler and the share of fresh data is lower
  (`partial/avg_staleness`'s differenced correlation with length is pro +0.651 / flash +0.717, one of the most stable mechanistic signals in this dataset).

**One last layer of uncertainty**: `penalty/stage_credit_group` includes a count of "suspected attempts to bypass evaluation," and its level correlation with length is very high
(ρ=0.945 on flash), but **after differencing it drops to 0.074, and it is not significant throughout training** (`select_hack_attempt_rate` differenced correlation
pro 0.263 (p=0.23) / flash 0.318 (p=0.093)). So **we cannot say "length growth is accompanied by increased score-farming behavior."**
The observation on the grader side (`select_probe_disagree_rate` to 60% and rising) was raised by Andrew Carr (@andrew_n_carr) in the English-speaking community,
he said he also cannot distinguish "questions are harder to grade" from "better at fooling the grader" (link to original post see `analysis/en/notes/research-C-english-community.md`).

---

## 8. What I am uncertain about, what has been overturned

1. **The claim "80k suddenly jumps to 120k" itself is half overturned**—see Sections 2 and 3: it is a single dataset, it is a climb not a sudden jump,
   and it was interrupted by restarts in the middle. What should be kept is "this magnitude is worth questioning"; what should be removed is "sudden jump."
2. **"Length and score are highly positively correlated" has been refuted** (Section 5). This was exactly the conclusion most easily drawn last run, and it does not survive differencing and event removal.
3. **flash DeepSWE's big drop at step 11 (−6.05, −10.1%) cannot be explained by our data.** For this step, on the training side only 10 metrics
   jumped, there was no restart, no version switch, and length even rose 7.5%. The standard deviation of adjacent-step changes on that leaderboard is 3.84, so this step's z ≈ −1.77,
   **not enough to rule out noise from the evaluation itself** (avg@3, limited number of problems), and step 12 already recovered +6.64.
   Attributing it to "the model getting worse" or "length growth" has no basis. (Our own measurement; in our dashboard you can click this step to directly view the correlation——
   see Section 9)
4. **`critic/returns/mean` and `critic/advantages/mean` are the same series**, after merging across runs the sign flips,
   that is an artifact of concatenating different baselines, not adopted.
5. **`train/spec_accept_length/*` (speculative decoding acceptance length) decreases with length (ρ=−0.926 / −0.944), but after differencing it is not significant**
   (p=0.14 / 0.90). Whether there is a mechanism by which "long answers make self-speculative decoding hit rate worse", I am not sure.
6. **`train/passrate/avg_passrate/visual/dataset-ol8x` and `gtav` contain a large number of exact 0s** (29.2% / 16.7% of steps),
   very likely sentinel values for "not reported" rather than a true 0%, so any conclusion involving the pass rates of these two datasets is unreliable.
7. **Mismatches**: the global values of `actor/ppo_kl` and `actor/pg_clipfrac` are identically zero for the entire period (only per-dataset
   `pg_tis_clipfrac` has nonzero values), it is impossible to tell whether it is a real reading or not connected; `ctx_prompt_length/*/max` will, between two adjacent steps
   drop from 566,065 to 4,879, source unknown; flash has two restarts both mapped to step 25, but step 24→25 spans 7.5 hours
   (average step length 1.6–2.5 hours), whether this 3-hour difference is restart waiting or a statistical convention does not add up.
8. **A new finding I have not explained but that is directly related to this article's topic**: the dashboard has a metric called `env/possible_leak`
   (literally translated by name, "possible data leakage"). **pro equals 1 for four consecutive steps from step 19–22, while all other steps, and all of flash, are 0.**
   These four steps are exactly the segment where pro's `dynsam/avg@n` peaks (0.6431 at step 20) and begins a continuous decline.
   **Whether the two are related, I do not know** —— the dashboard gives no official explanation for this metric, and we do not know what triggers it.
   I write it here because it deserves dedicated investigation next run (the `env/` family has 15 more metrics, likely from the same source).

---

## 9. Recompute it yourself / view directly on the page

**Command-line recomputation** (project root):

```bash
# All numbers used in this material (first/last, shape, multiplicative decomposition, jumps, upper bounds, correlations)
bun src/length_report.ts
# Full correlation scan + robustness check (a separate independent script)
bun src/correlate_report.ts
```

Artifacts: `analysis/A3-生成长度-numbers.json`, `analysis/A3-生成长度相关性-numbers.json` (+ `.txt` human-readable summary).

**View it by clicking on the page** (`http://127.0.0.1:8787/#overview`):

1. Check the **「Linkage」** at the far right of the chart toolbar;
2. On any chart, click a step (for example, click the flash point at step 11 on `DeepSWE v1.1`);
3. A badge will appear saying **「Analyze this step」**; clicking it opens this correlation analysis: which other metrics moved together at this step,
   which ones rise and fall together with this curve, and the restarts / version switches / announcements within this step's time period.

The numbers in the panel are computed by `/api/correlate` (the offline copy computes in place using the same kernel `site/js/correlate.js`, and the results on both sides agree).
That "flash step 11" in Section 8, item 3 was found using this panel.

---

## 10. Three judgment rules you can take away

### Rule 1: First distinguish "climb / step change / interruption"

When you see a curve rise a lot within a few days, do not rush to call it a "surge". Fit it with a straight line and a single step change respectively, and compare the explained variance
(in this data the straight line wins: 85.1% vs 59.7%), then mark the known engineering events (restarts, version switches, evaluation backfills) on the timeline.
**If the largest single-step changes all fall on engineering events, then the shape of this curve is mainly determined by operations, not by the model.**

### Rule 2: Decompose the multiplication and locate "which segment got longer"

Quantities such as length, cost, and elapsed time are often the product of two factors (length = number of turns × length per turn; cost = number of GPUs × time).
**Reporting only the total increase has no diagnostic value**——the same ×1.68 could be "70% more turns" or "each turn got 50% longer",
and the corresponding handling is completely opposite. After decomposition, pro's answer (81% from per turn) and flash's answer (half and half) are two different things.
Use logarithmic decomposition; do not add percentages directly ("up 45% then up 45%" is not 90%).

### Rule 3: Objective function side effects vs. capability improvement

There are two criteria, neither of which depends on the reward curve:

- **Look at differenced correlation**: take the first difference of both time series, then compute correlation. Level correlation has almost no explanatory power in this kind of data.
- **See whether it survives a restart**: if it is a capability improvement, one operations restart should not wipe out 6%–14% of it; if it is intra-batch data composition
  or a product of optimization bias, then it will jitter along with the pipeline.

Only when both criteria point to the same answer can you dare say "this is training making progress". In this data, length growth passes neither.

---

## Terminology quick reference

| Term | One-sentence explanation |
|---|---|
| `ctx_response_length/mean` | How many tokens one trajectory generated on average in this step's training batch (the protagonist of this article) |
| `ctx_total_length/mean` | Combined length of generation + prompt; empirically approximately equal to generation length plus prompt length |
| `ctx_prompt_length/mean` | Average length of input prompts; for pro it is 3,964–4,489 throughout and barely moves |
| `code/dataset-obg8` | One of the 11 coding datasets (the one named by Rush) |
| `dynsam/avg@n` | Main metric on the homepage: average problem pass rate (16 samples per problem) |
| `dynsam/agg_turn/mean` | Average number of turns per trajectory (how many back-and-forths between agent and environment) |
| `critic/advantages/mean` | Average advantage: how much better this step's samples are than the group's average level (negative advantage pushes outputs longer) |
| `actor/entropy_loss` | Policy entropy; the larger it is, the more random the output distribution |
| `partial/avg_staleness` | Average data staleness: on average how many policy versions old the data used for training is |
| `timing_s/trainer_ops` / `outer_gen` / `step` | Trainer time / sampler generation time / whole-step time (the latter does not include restart waiting) |
| `ctx_total_length/clip_ratio` | Proportion of trajectories truncated by hitting the length limit |
| Spurious correlation / first difference | Two series that are both monotonic over time will necessarily be correlated; taking the difference between adjacent steps and then computing correlation removes the common trend |
| Length bias (length bias) | The objective function or the evaluator systematically prefers long answers, so the policy learns to "get longer" rather than "get it right" |

---

## References

- Original collected texts from two communities: `analysis/en/notes/research-C-english-community.md` (38 sources), `analysis/en/notes/research-C-chinese-community.md` (19 pages)
- Full correlation scan and robustness checks: `analysis/en/notes/09-generation-length-correlation.md`
- Metric meanings and definitions: `analysis/en/notes/02-metric-inventory.md`, `analysis/en/notes/06-pitfalls-when-reading-the-dashboard.md`
- Recomputation scripts: `src/length_report.ts`, `src/correlate_report.ts`
- Correlation panel on the page: `README.md`
