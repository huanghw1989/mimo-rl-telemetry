# How to read a training run stopping —— taking the stop of mimo-v2.6-flash as an example

> Independent saved note. Saved on 2026-09-19 (Beijing time).
> Data as of 2026-09-19 06:23 UTC: pro step 23 completed (step 24 in progress) / flash step 30 (stopped).
> External sources were collected the same day using a proxy browser; the list is in Section 6.
> This article is independent of the A2 series in `analysis/`: A2 is the formal analysis sequence for the observation window,
> This article distills this event into a portable way of reading, and uses the event itself as a case.

## I. Conclusion (in plain language first)

1. **flash's stop is a deliberate, orderly wrap-up, not a crash, nor a hang.**
   The dashboard status field is `run.mode = "ended"`, and there is a clean `end` event in the event stream,
   After the last step (s30, completed at 09:04 Beijing time) there is no trace of any restart.
2. **Its machines were not freed up for pro.** pro's cost rate (money burned per second) from the first day to after flash stopped
   has remained $5.71/sec, never changing by a cent; the 2:1 machine ratio of the two lines was fixed from the start.
3. **The only explanation the data supports: the RL data points for the small-model tier have been fully collected**——
   The main metric has flattened, offline evaluation is no longer being submitted, entropy is rising but not converting; all three signals are present (Section 4).
4. **The officials have not explained the motive** (no announcement on the bulletin board, no new posts on Luo Fuli's X since 9/17), and the community is asking the same question.
   "Finished" and "paused as planned (evaluation/release/new round)" both currently hold.

---

## II. Knowledge 1: Three stopping patterns, distinguishable with two fields

When a training run stops in the dashboard, there are only three patterns, all of which can be distinguished from `run.mode` (the run status field)
and the tail of the event stream (`events`), without needing to wait for an official explanation:

| Pattern | `run.mode` | Event stream tail | Associated phenomena |
| --- | --- | --- | --- |
| Normal training | `live` | `step` (step completed) events continue | — |
| Crash / failure stop | `live` | `restart` (restart) events appear, step numbers go backward or repeat | The bulletin board usually has a restart announcement; gaps between steps far exceed the normal step duration |
| Clean wrap-up | `ended` | After the last `step` there is only one `end`, **no** `restart` | No announcement, no restart, limited wrap-up interval |

The judgment takes just two steps: check whether `run.mode` is `ended`, and check whether the event stream tail is `restart` or `end`.

Three pieces of evidence for flash this time:

- In `status.json`, `run.mode = "ended"`, `run.end = 2026-09-19 10:22` (Beijing time);
- The last step s30 completed normally at 09:04, and afterward there is no `restart`——the previous 5 failures
  (1 each on 09-16 and 09-17, three on 09-18, all `restart` events) all had patterns different from this one;
- The interval from s30 completion to `end` is 78 minutes, a finite short interval. For failures awaiting repair, according to the patterns of the previous 5
  they would first leave `restart` and then wait several hours; this time it wrapped up directly.

**The data can only determine the pattern of the stop, not the motive for the stop**——this is the easiest step to overstep when using this kind of dashboard.

---

## III. Knowledge 2: Cost rate is a reading of machine count (resource allocation judgment + scale comparison)

**Method**: `cost/rate_per_s` (cost rate, money burned per second) is a direct reading of machine count——
For the same machine type, the unit price per second is constant; "how many machines are burning money" divided by the unit price gives this number.
When machines are freed up or added, this number shows a step change.

**This judgment**:

| | pro | flash |
| --- | --- | --- |
| Cost rate | $5.71/sec | $2.855/sec |
| Changes within the observation window (09-17 18:49 → 09-19 14:23, about 44 hours) | **Flat, not a single jump** | Flat, until the stop |
| Converted per hour | $20,556 | $10,278 |
| pro : flash | **2.000 : 1** (accurate to three decimal places) | |

If flash's machines (about $10.3k/hour) were freed up for pro, pro's rate should jump from $5.71 to about $7.6,
or the expected duration of the current step would shorten by about one third. Both can be directly verified, and neither appeared:
After 10:22, pro's rate is still $5.71/sec; pro's current step 24 has passed 130 minutes, expected 225 minutes,
progress 58%, at the same speed as the previous few steps (197~228 minutes/step).

Comparison: **pro itself is slowing down, not speeding up**——the first half (s3–s10) averaged 153 minutes per step,
Second half (s18–s22) 202 minutes; the reason is that per-step token count rose from 2.29–2.35 billion at s15–17
to 2.49–2.77 billion at s18–23. Compute was consumed by increasingly difficult problems and was not reallocated.

### Does the 2:1 ratio line up with the model scale?

2:1 has been this number since the earliest observation point (09-17 18:49), media "about $1.08 million in 36 hours,
averaging $30,000 per hour" (QbitAI) and the Zhihu teardown (late night 09-17, pro $5.71/s, flash $2.86/s)
Two independent snapshots agree — **a configuration fixed from the start**, unrelated to this stop.

Two independent paths reconcile the 2:1 with the model scale, both pointing to the same number:

- **Path 1 (cost per token)**: cumulative basis (through 09-19 06:23), pro $1.888M / 53.0B token,
  flash $854k / 81.4B. Per 1B token, cost is pro $35.6k, flash $10.5k, **a 3.4× difference**.
  For MoE models, compute per token is proportional to activated parameters (the portion of total parameters actually involved in computing that token),
  On the same hardware, the per-token cost ratio ≈ the activated-parameter ratio.
- **Path 2 (machine count × throughput)**: machine ratio 2.0 ÷ measured token throughput ratio
  (second-half average: pro about 203k token/s, flash about 305k, ratio about 0.67) ≈ **3.0**.

Taken together, this reads as "**pro's activated parameters are about 3× flash's**" (inference, assuming per-unit compute efficiency is comparable on the same type of machine;
the difference between the two paths is a readout of the efficiency difference).

Parameter-count background (evidence strength separated):

- Previous generation disclosed: MiMo-V2.5-Pro total parameters 1T (code agent direction), MiMo-V2.5 total parameters 310B
  (multimodal direction), open-sourced on 2026-04-28 (Luo Fuli X post, official first-hand);
  MiMo-V2-Flash total parameters 309B / activated 15B MoE (official technical report arXiv:2601.02780 abstract, official first-hand).
- The parameter counts for the two v2.6 lines **have not been published** (the site's about page only says "coming soon");
  On 9/17, a community report of a "1T-parameter MiMo RL run" was circulating (community claim, not officially confirmed).
- If v2.6-flash's activation is still on the order of 15B, pro's activation of about 45~50B is a reasonable order of magnitude for a 1T-total MoE (inference).

### The two lines are the same recipe: two points on a scaling curve

The Zhihu teardown (community analysis) compared the two lines' configurations item by item: **batch is the same at 1568 prompts × 16 rollouts,
data mix is nearly identical (agentic about 47%, code about 36%), learning rate is the same at 3e-6, same set of 23 execution harnesses**
— only model size and machine count differ.

If so, the two lines are essentially **two points on the same RL scaling curve**: the research question Luo Fuli announced is
"how far can RL scale", a scaling curve needs at least two points to be drawn, and running in parallel saves the most time.
This is inference, not an official statement — Dinghuai Zhang asked the same question in an X reply, and there was no official answer
(the reply section is behind a login wall; this sentence is quoted from explainx's compilation).

---

## 4. Knowledge 3: the three signals of "this scale's data point has been exhausted"

To judge whether a run is worth continuing to train, don't only look at the main metric slope; look at the three signals together:

**Signal 1: the main metric flattens.** `dynsam/avg@n` (average pass rate over n samples per problem, the dashboard main metric)
flash last 6 steps: 0.641 / 0.638 / 0.644 / 0.643 / 0.662 / 0.644,
6 steps net gain +0.0027; in the first half, each step could gain +0.005~0.01, while the final segment is ±0.02 oscillation with no center-of-mass movement.

**Signal 2: offline evaluation is no longer submitted.** DeepSWE (offline evaluation for long-horizon software engineering tasks) flash's last entry is
**step 25 (64.9)**; across the eight steps s18–s25, it oscillated between 59.6~65.8 with no new high;
Checkpoints for s26–s30 were not submitted for evaluation — the evaluation cadence stopped along with training, which is itself an action.

**Signal 3: entropy is rising but not converting.** `actor/entropy_loss` (policy entropy, the breadth of exploration)
s20–s30 went from 0.4343 to 0.4706 (6 of 10 intervals upward), while the pass rate over the same period is the flatness from Signal 1.
Exploration has widened, but no new capability was mined.

Taken together, the three form the shape of "the data point has been exhausted": flash used 30 steps, 81.4B token, $854k,
avg@n 0.514 → 0.644 (+13.0 percentage points), DeepSWE 48.67 → 64.9,
answered "how much more RL can be squeezed out at this scale" — the marginal return from continuing to train afterward is near zero,
stopping is rational. (Note the status: the three signals are facts; "exhausted" is an interpretation of the signals and is an inference.)

**Comparison with pro (be honest)**: pro is also slowing. Its DeepSWE was still rising through s18
(s13→s18: 63.27 → 67.46, +4.2 over 5 steps), but the online main metric in the last 2 steps (s22–s23)
has fallen 2 percentage points from 0.642~0.643 at s20–s21 to 0.622, and offline evaluation likewise stopped at s18
(training reached 23 steps). "flash flattened, pro is still rising" only holds up to s21 —
Both lines are actually slowing in the final segment; the difference is that pro's pullback is smaller.
Whether pro has peaked is likewise assessed with the three signals: currently one and a half (evaluation lagging, main metric slowing, entropy rising but converting).

**Transferable decision rule**: all three signals present → the run has reached the upper limit for that scale, and "stopping to switch to a larger one" is more rational than "continuing to burn";
only one or two present → it's most likely fluctuation; keep running.

---

## 5. Fact list for the event itself (as of 2026-09-19 14:23 Beijing time)

**flash stop timeline**

- 09:04 s30 completed normally (the last `step` event)
- 10:22 `end` event, `run.mode` becomes `ended`; by 14:23 it has been stopped for about 4 hours
- Total wall clock 85.1 hours (started 09-15 23:16 → ended 09-19 10:22)

**flash cumulative ledger**: 30 steps / 81.4B token / $854,045 / 5 restarts /
avg@n 0.514 → 0.644 / DeepSWE 48.67 → 64.9 (last submitted for grading s25).

**pro-side same-period facts**

- Step 24 in progress: 130 minutes elapsed / 225 minutes expected / 58% progress / 51% generation share, pace normal.
- Cumulative: 23 steps completed / 53.0B token / $1,887,966 / 11 restarts.
- Two new restarts on the morning of 09-19 (07:06, 08:03), together bringing s23's total duration to 7.5 hours (normally about 3.5 hours);
  These two had **no** corresponding announcement.
- The 09-18 `actor/grad_norm` (gradient norm) spike (0.0335, 6 times the median,
  occurring after the s17 GPU OOM restart + parallel strategy adjustment) confirmed to be an isolated point:
  the following 4 steps (s20–s23) returned to the normal band of 0.0046~0.0061, and the new configuration ran stably for 6 steps.
- New fact: pro's `penalty/signed/neg_mass_added` (the advantage mass added to the negative side by the penalty branch,
  the site does not explain the purpose of this field) surged in s20–s22 (5.57M / 8.11M / 5.82M), then fell back to 72K in s23;
  flash's final segment also has the same pattern (s18–s24 about 2.06M~6.83M). Whether the two share a mechanism cannot be determined from the data.
  Also note: in flash's last step s30, this value jumped to 2.89M, while avg@n in the same step fell 1.9 percentage points.

**The announcement board is not a complete restart log**: of 16 restarts (pro 11, flash 5), only 4 were restart-related announcements;
The `events` returned by `/status` is still a truncated window (this time containing only the most recent 8 restarts).
The complete restart history is in the telemetry repository `data/store/runs/<run>/events.json`.

---

## 6. External source collection (collected via proxy browser on 2026-09-19)

| # | Source | Time | What was said | Evidence strength |
| --- | --- | --- | --- | --- |
| 1 | [Luo Fuli X pinned post](https://x.com/_LuoFuli/status/2100296686719610932) | 09-17 | Three scaling axes: compute (about 2B token/step, 1568 prompts × 16 rollouts, fully async), multi-harness environments, grading compute; details will be open-sourced in batches. Did not explain the design of the two lines | Official statement |
| 2 | [Luo Fuli X post](https://x.com/_LuoFuli) | 04-28 | MiMo-V2.5-Pro (code agent, 1T total parameters) and MiMo-V2.5 (multimodal, 310B total parameters) open-sourced | Official first-hand |
| 3 | [MiMo-V2-Flash technical report](https://arxiv.org/abs/2601.02780) | 2026 | 309B total / 15B activated MoE, SWA and global attention mixed 5:1, 27T token pretraining | Official first-hand |
| 4 | [explainx.ai report](https://www.explainx.ai/blog/xiaomi-mimo-v2-6-rl-scaling-livestream-2026) | 09-17, updated 09-18 | 09-18 update: cost about $493K/day—exactly equal to the pro line alone ($5.71/s × 86400); the media counted only pro; also mentioned the "1T parameters" community report. Reply section: Yifan Jiang questioned "fully async", Dinghuai Zhang asked why the two lines run simultaneously; no official answer | Second-hand report |
| 5 | [QbitAI](https://www.firecat-web.com/daily-news/16408) (reposted by firecat) | 09-17 | Cumulative over 36 hours exceeded $1.08M, averaging about $30K/hour; at the time DeepSWE: pro 62.24, flash 60.77 | Second-hand report |
| 6 | [Zhihu in-depth breakdown](https://zhuanlan.zhihu.com/p/2084083614585832108) | Late night 09-17 | Item-by-item comparison of the two lines' configurations: same batch, same data mix, same lr, 23 harnesses; all-in cost about $19.5 per million token | Community analysis |
| 7 | [Zhihu metric dictionary](https://zhuanlan.zhihu.com/p/2083933573279642598) | 09-17 | About 2019 tags defined one by one; "orange suspected to be pro (heavier training), blue suspected to be flash (lighter training, greater parallelism)—inference only" | Community analysis |
| 8 | [LINUX DO post](https://linux.do/t/topic/2921924) | 09-19 (about 1 hour before saving) | The community is also asking "flash shows stop, is this the end? The evaluation score is still stuck at run 25" | Community discussion |

Note: the X reply section is behind a login wall; the reply content in item 4 is quoted from explainx's compilation; the rest were obtained by directly visiting the original text.

---

## 7. Still cannot be determined

- The official motivation for flash stopping ("finished" vs "planned pause", awaiting announcement board or X).
- Whether flash will start a new run afterward, and in what form (same recipe with more machines? new recipe? directly into the release pipeline?).
- The parameter counts of the two v2.6 lines; the community report of a "1T parameter RL run" has not been officially confirmed.
- The cause of the negative-side surge in pro (s20–s22), and whether it shares a mechanism with the final-segment surge in flash.
- What the 2.89M `neg_mass_added` in flash s30 means (the site does not explain the field's purpose).

---

---

## 8. Editor's note: two additions from a later independent review (evening of 2026-09-19)

This section comes from `analysis/en/notes/13-async-pipeline-and-machine-time.md` (an independent `pipeline_report.ts`), and **supplements rather than overturns** this article.

1. **The statement in section 3 of this article that "the cost rate did not jump once" holds, but resources did indeed move once over the same period.**
   The review found that pro's `env/active` (number of concurrently active sandboxes) **jumped within a single step, step 23, from 23,419 to 37,888 (+61.8%)**,
   while `rate_per_s` remained unchanged at $5.71/s. That is, the point that "the number of machines burning money did not change" still holds,
   but **the sandbox concurrency configuration at the orchestration layer changed** — these two things can be separated; only the former has a price tag on the dashboard.
   So the inference "flat rate = resources did not move" needs to be tightened to "flat rate = the number of machines in the billing scope did not move".

2. **That "sandbox turnover rate" reading needs a revised definition.** One popular reading uses `env/total_setup ÷ env/active` to calculate turnover rate
   (pro step 10 about 14.3, flash step 15 about 14.2). The review found that `env/total_setup` is **the cumulative number of starts since the last restart**
   — at each restart step it drops back to the same order of magnitude as `active` and then climbs again (zeroing can be seen at pro steps 11/15/17/23 and flash steps 16/25/28).
   So that 14 means "in this segment, each sandbox slot served about 14 trajectories on average",
   **not "14 turnovers per step"**; dividing by the number of steps in the segment gives about 2 per step. The relevant metric explainer has been corrected.

One additional correction from the same source: this article said the billing table stopped growing after flash stopped — the review confirms it **froze exactly**:
`cost.so_far ÷ rate = 299,140.0 秒`, exactly equal to `end − run_start`; no further billing within 6.6 hours after stopping.

---

## Appendix: Data sources and recomputation method

- Data repository: `data/store/` (25 sync points, as of 2026-09-19 06:23 UTC)
  - Stop pattern, restart, cost → `runs/<run>/status.json` (`run.mode`, `run.end`, `events`, `cost`) and `runs/<run>/events.json` (complete history)
  - Cost rate timeline → `runs/<run>/timeline.jsonl` (`rate` field)
  - grad_norm / entropy / neg_mass_added → `runs/<run>/series.json` (list index = step number − 1)
  - offline evaluation → `store/benchmarks.json`
- Health check: `bun src/analyze.ts`; identity self-check: `bun src/check.ts`
- Previously (the formal analysis of the previous observation window): `docs/en/A2-training-insights-3.md`

## Terminology quick reference

| Term | Plain language |
| --- | --- |
| `run.mode` | run status fields: `live` (running) / `ended` (concluded) |
| `end` / `restart` events | Two types of stop events at the tail of the event stream: the former wraps up cleanly, the latter restarts after a crash |
| Cost rate `cost/rate_per_s` | Money burned per second; under the same machine type = number of machines × per-machine price, usable as a readout of machine count |
| `dynsam/avg@n` | Average pass rate for sampling n times per problem; the dashboard's main metric |
| `actor/entropy_loss` | Policy entropy: the breadth of exploration; if it keeps rising while the success rate doesn't follow = exploration that wastes money |
| `penalty/signed/neg_mass_added` | The advantage mass that the penalty branch adds to the negative side; the site does not explain its purpose |
| Active parameters | The part of MoE total parameters that actually participates in computation for each token; per-token compute is proportional to it |
| MFU (model compute utilization) | The actual degree of utilization of machine compute; part of the difference between the two reverse-inference paths in Section 3 comes from it |
