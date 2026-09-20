# Understanding the mimo-v2.6 RL dashboard: what each piece of data is used for

> The measured numbers in this article are based on the first collection (2026-09-17 10:50 UTC, pro step 14 / flash step 18),
> A few places are annotated with later updated values. To see the latest data at the end of the observation period, see `docs/en/A2-training-insights-2.md`.

This article is aimed at readers who "know what large models are but have never run RL training themselves." It assumes you have never opened https://mimo.xiaomi.com/rl/,
Starting from what the page looks like, then explain one by one what the numbers on the page are saying.

Writing principle: whatever I can verify from the data itself, I directly draw a conclusion and give the verification method; whatever the site does not explain and I cannot verify,
I explicitly write "uncertain" and do not guess.

---

## 1. First, figure out what this page is live-streaming

Xiaomi's MiMo team put two reinforcement learning training processes directly on the public internet, where anyone can see them.
The two training runs are mimo-v2.6-pro (started September 15 10:32 UTC) and mimo-v2.6-flash (started 15:16 UTC the same day),
The page started live-streaming publicly from September 16 04:00 UTC.

To understand this page, you first need to understand one thing: **reinforcement learning training for large models is not something you can "run to completion and look at the result"; it is a gamble**.
You will spend several million dollars and tens of days of machine time, and midway you can only rely on a bunch of curves to judge "whether it is currently moving in a good direction, or has already gone bad".
The entire value of this page is laying out these bases for judgment for people to see.

So there are two major categories of content on the page:

- One is "money and machines": how much money was spent, how long it has run, how many environments were started, how many restarts occurred.
- The other is "how well the model is learning": pass rate, reward, policy entropy, gradient, degree of off-policy.

Below, I explain in order from top to bottom of the page.

---

## 2. Top bar: total spend and the clocks for four cities

In the upper left of the page there is a total spend number; at the time of recording it was around 1.44 million USD, and it ticks every second. Next to it are the current times in Beijing, Los Angeles, New York, and London.

These four clocks look decorative, but they are actually useful. Training logs and announcements are recorded in UTC, while the team dashboard uses local time,
And distributed training runs in data centers in multiple locations; when investigating the time point of a failure, "is this error 3 p.m. in Beijing or 3 a.m. in Los Angeles"
often determines which shift of people you go find. Listing all four clocks at once saves you from doing conversions in your head.

This total spend number is very concrete. It is the sum of the two training runs pro and flash (at the time of recording 992,877 + 447,767; the top of the page displays 1,440,708,
The tens-of-dollars difference is because the two numbers were not captured at the same millisecond).

How is this money calculated? The API gives each training run a "dollars burned per second rate": pro is 5.71 USD/s, flash is 2.855 USD/s.
The two add up to 8.565 USD/s, which is 30,800 USD per hour, 740,000 USD per day. This number is directly tied to "how many GPUs the training used",
flash's rate is roughly exactly half of pro's, indicating that flash's machine scale is about half of pro's.

One detail is worth noting: this rate is the rate for "current uptime", not the rate for "effective compute".
As long as the machines are on, they are burning money, including time spent on restarts, queuing, and waiting for data.

---

## 3. notices: official announcements

This section is written by hand, not automatically generated. At the time of recording there are three items in total, with a lot of information:

1. September 17 02:27 UTC: flash reruns from step 15, because "a certain type of infrastructure error was not correctly detected on the dataset and lasted for about 3 hours".
2. September 16 20:08 UTC: pro needs a restart due to a VRAM problem on one node.
3. September 16 17:58 UTC: updated the DeepSWE scores for flash step 12 and pro step 8; more will be posted later.

The meanings of these three items are respectively:

- Item 1 is the ugliest kind of failure — **it did not crash; it was wrong but did not report an error**. The data was contaminated for three hours before being discovered; the weights trained during those three hours are dirty, and it can only be rolled back and rerun.
- Item 2 is a common hardware-level failure. VRAM problems usually do not kill the entire task; instead, they make computation on some of the GPUs fail, and the way to handle it is to restart.
- Item 3 reminds you: **offline evaluation and training are not synchronized**. When training reaches step 18, evaluation scores may only be available up to step 12.

On the dashboard, "restart" is the norm rather than an accident. pro has restarted 6 times from the beginning until now, and flash has restarted 2 times.

---

## 4. Two run cards

Fields on each card:

**step 14 / step 18** —— number of training steps completed.
In RL training, a "step" is not just a parameter update; it contains three major stages:
Let the model solve problems (rollout, also called sampling), score the solutions (reward / judge), and use the scoring results to update parameters (trainer).
The stage hint below the card tells you which stage it is currently stuck in: `step 19: training · 2,616/1,568 accepted · 1h 04m in`
It means "step 19 has already entered the training stage; the sampling stage accepted 2616 qualified problems (target 1568), and this step has already been running for 1 hour 4 minutes".

**2d 00:16:18** —— total duration of this run from startup to now.

There is an easy pitfall here: **the "how long this step has been running" in the stage hint restarts after every restart**.
So if this step was restarted midway, this number will be noticeably smaller than the actual elapsed time.
The way to judge is simple: take the interval from "the time the previous step completed" to "now" and compare it with the elapsed time shown on the card,
The greater the difference, the more restarts there have been. In actual measurements, pro step 15 showed 2.49 hours on the card,
while the real wall clock had already passed 7 hours since step 14 completed.

**dynsam/avg@n 0.615 ▲0.051** —— this is the single most important number on the entire dashboard; it is discussed separately below.

**cost so far** —— how much this training run itself has cost.

**tokens · step 14 / tokens · total** —— how many tokens were trained in this step / how many tokens have been trained cumulatively.
pro cumulative 30.2B, flash cumulative 43.1B. Note that flash has more steps (18 vs 14), yet its cumulative tokens are higher,
which means flash trains a larger token count per step (because its model is smaller, the same GPUs can fit a longer context).

**samples trained 351k** —— how many trajectories (rollouts) have been trained cumulatively.
351232 divided by 14 steps equals 25088, exactly 25088 per step.

**train batch size × n = 1,568 × 16seqs** —— configuration for this step: 1568 problems, each problem given to the model for 16 attempts.
1568 × 16 = 25088, which matches the previous item.

Here we need to point out the biggest difference between RL training and pretraining: **during pretraining a sample is learned only once, while in RL a sample is learned 16 times**,
and these 16 attempts must be compared with one another. Why this is necessary will be explained below when discussing avg@n.

### What is dynsam/avg@n

The official definition is: for each problem sampled in this step, let the model make n attempts (here 16 times),
the proportion of successful attempts among the total attempts is the pass rate for that problem; averaging the pass rates of all problems gives avg@n.

In plain terms: **the model's average score rate on this exam**. 0.615 means that on average it answers 61.5% of problems correctly.

Why do 16 attempts instead of 1? Because a single sample has too much randomness. A problem answered correctly once might just be luck,
doing 16 attempts can reveal "whether this model truly knows it or just happened to get it right". At the same time, the differences among the 16 attempts are precisely the source of RL's learning signal——
If all 16 are correct or all are wrong, it means this problem is either too hard or too easy for it, and there is nothing to learn; only when there are both correct and wrong attempts can it know which attempt was good and which was bad.

The "▲0.051" on the card is compared with step 1. pro rose from 0.565 to 0.615, an increase of 5.1 percentage points.

---

## 5. benchmarks: offline benchmark scores

This column is different from all previous columns: the previous ones are real-time data during training, while this column is **the score of the trained model on a standard exam**.

Currently there is only one item: DeepSWE v1.1, run using the mini-swe-agent scaffold, avg@3 (each problem tested 3 times and averaged).
It tests "giving the model a real code repository and issue, letting it modify code and run tests itself, and seeing whether it can fix it".

Existing scores:

| step | flash | pro |
| ---: | ---: | ---: |
| 1 | 48.67 | 58.41 |
| 2 | 53.10 | 56.25 |
| 3 | 56.78 | 58.41 |
| 4 | 54.03 | 60.47 |
| 5 | 57.23 | 59.59 |
| 6 | 54.57 | 58.55 |
| 7 | — | 57.44 |
| 8 | 57.08 | 62.24 |
| 10 | 60.18 | 63.72 |
| 11 | 54.13 | 65.78 |
| 12 | 60.77 | — |

What most deserves attention in this table is **how large its noise is**. flash dropped from 60.18 at step 10 to 54.13 at step 11, then returned to 60.77 at step 12;
pro rose from 62.24 at step 8 to 65.78 at step 11. A fluctuation of 6 points in one step is normal jitter on an evaluation set with only a few dozen problems.

So the correct way to use this column is not "look at the latest entry" but **look at the direction across two or three evaluations in a row**.
Drawing conclusions as soon as a single score comes out is the most common misreading of this kind of dashboard.

Also note a time lag: training has run to step 18, while evaluation has only come out to step 12. Evaluation requires separately starting machines and separately running a full set of problems,
its cost is not the same as training, so being slow is inevitable.

---

## 6. Main chart area: 18 permanent metrics

The page pins 18 metrics on the home page; you can switch the x-axis between step / time, the y-axis between linear / log, and there is a smoothing slider.
Explain them one by one.

### 1. dynsam/avg@n —— average pass rate

It was discussed above. It is the primary indicator of "model capability".

### 2. critic/rewards/mean —— mean reward

In plain terms: the average score the model got this time.

It looks very similar to avg@n, but **it is not the same thing**. avg@n only cares about "correct or not", while reward also includes process bonuses and penalties.
In agentic RL (tasks where the model calls tools and runs code by itself), if the final answer is correct but the process is a mess, points will be deducted.

The relationship between the two can be seen in the data: pro's avg@n has a correlation of 0.938 with rewards, indicating they are broadly synchronized;
but rewards rose from 0.552 to 0.588, an increase of only 0.036, while avg@n rose by 0.051. **Rewards rise more slowly than the pass rate**,
indicating that a considerable portion of the "newly correctly solved problems" had points deducted for process.

One verifiable fact to add: in the API, the values of `critic/score/mean` and `critic/rewards/mean` are exactly the same at every step,
so on this dashboard "score" and "reward" are two names for the same thing, not an additional metric.

### 3. actor/entropy_loss —— policy entropy

This is the number that most needs watching in all RL training.

In plain terms: **how "hesitant" the model's output is**. High entropy means it is wavering among multiple options; low entropy means it is already very confident about what to output.

Entropy dropping very low (commonly called "entropy collapse") is a classic failure mode of RL training: the model decides too early that "there is only this one solution",
once this path fails, it gets completely stuck and can no longer explore new solutions.

**Interestingly, the entropy of both training runs is slowly rising**, not falling. pro rose from 0.395 to 0.405, flash rose from 0.413 to 0.433,
flash rises more noticeably. While entropy is rising, the pass rate is also rising, which in RL is a good thing:
This shows the model "learned more solution methods", rather than "squeezed one solution method to the extreme and then lost its exploration ability".

### 4. actor/pg_loss — policy gradient loss

Plain English: **the "learning signal strength" of this step**. It measures "how much the model's behavior needs to change", not "how bad the model is".
The number itself has no good or bad; only trend and magnitude.

What to look for is whether it suddenly blows up by tens of times. A sudden blow-up pushes the parameters far away from their original position,
and in the next few steps you usually see entropy drop and pass rate drop.

pro's pg_loss oscillates between 0.002 and 0.0074; flash climbs all the way from 0.00084 to 0.0128,
a large increase (14×), but the absolute value is still a very small number, and flash's entropy is rising over the same period, with no sign of deterioration.

### 5. actor/grad_norm — gradient norm

Plain English: **how big the force pushing on the parameters is this time**.

When this number suddenly grows large, it usually means an anomalous sample was hit, or the training and inference numerics have already diverged too far,
it is the classic precursor of "something is about to go wrong".

In these two training runs grad_norm stays in the very narrow range of 0.005-0.009, very stable.
flash had a 0.00905 at step 16, about 1.5× the mean, and it fell back immediately after, a single-point jitter.
Also the interface has `actor/clip_low = 0.2`, `actor/clip_high = 0.27`,
these are the upper and lower bounds at which the gradient/probability ratio is clipped, i.e. "no matter how big the force, only this much is allowed through".

### 6. train_infer_diff/new_infer/kl — divergence between trainer and inference engine

This metric has the most awkward name, but its purpose is very clear.

Plain English: **for the same sentence, do the program responsible for "generation" and the program responsible for "training" compute the same probability?**

In RL training, generation uses the inference engine (chasing throughput, making all kinds of approximations), while training uses the training framework (chasing precision).
The two sides cannot compute exactly the same probability for the same piece of text; the reasons include: how experts are routed in MoE,
different operator implementations, different floating-point precision, different batch sizes, and so on.

If this difference is small, it means the "model used for scoring" and the "model used for updating" are basically the same;
if it grows, it means training is measuring itself with an inaccurate ruler, and the direction it learns is wrong.

**There is a notable phenomenon here**: pro's this KL rose from 0.0022 at step 1 to 0.0094, more than 3×;
flash rose from 0.0029 to 0.0083. Over the same period `diff_abs_mean` (the mean absolute difference in probability between the two sides) also rose from 0.024 to 0.046.

**But this number cannot be read directly, because it is a weighted average after bucketing by data freshness.**
In the `partial/` namespace the dashboard splits the same set of metrics into 8 parts by "how many generations the data is stale":
`partial/0/train_infer_diff/new_infer/kl` is the divergence on fresh data,
`partial/1/...` is for one generation stale, and so on. I summed "each bucket's share × each bucket's KL",
and compared it step by step against the global KL on the home page; the error is within 2% — the identity holds.

Once broken out, the conclusion is completely different: **the KL on fresh data went only from 0.00219 to 0.00248 from step 1 to step 14 (up 13%)**,
while the global figure rose 328%. The correlation coefficient between global KL and "average staleness in generations" is +0.944,
and with "bucket 0's own KL" only +0.331.

In other words, the main driver of that curve on the home page is "the data got stale", not "the two engines diverging further and further".
There is no hint of this on the dashboard; it was computed by this project itself, see the second analysis for details.

### 7-8. ctx_total_length/mean, ctx_response_length/mean — context length

Plain English: **how long the model writes on average to solve one problem**. total is "problem + answer", response is just "answer".

In the data there is a verifiable identity: total is prompt plus response, and it holds exactly at every step
（pro step 14：4210 + 101993 = 106203）。

Here appears the most astonishing number on the whole dashboard: **pro writes 102,000 tokens on average per problem**,
and it rose from 68,000 at step 1 to 102,000 at step 14, an increase of 50%.
flash is even more extreme, rising from 67,000 to 111,000, up 65%.

The length of the problems themselves barely changed (around 4000 tokens, rising only 2.7% over 14 steps).
That is, **all the growth is content the model itself wrote**.

This is not as simple as "the model got more verbose". This is a typical phenomenon of agentic RL:
within a single answer the model has to repeatedly read files, edit code, run tests, look at errors, and edit again,
and all these actions accumulate in the context. The longer it writes, the more it can do, and the higher the pass rate —
in the data the correlation coefficient between `ctx_total_length/mean` and `avg@n` is 0.91.

The cost is below: context length almost directly determines training time and GPU memory usage.

There is also a cap in the interface: `ctx_total_length/max` repeatedly shows 1048570, a hard cap just over 1 million tokens,
which means trajectories exceeding this length get truncated. The truncation ratio `ctx_total_length/clip_ratio` is very small (a few parts per ten thousand),
not a problem for now, but its highest values appear in the last few steps, and the direction is upward.

### 9. dynsam/agg_turn/mean — mean turn count

Plain English: **how many turns back and forth the model takes on average to solve one problem**.

pro rose from 47 turns to 59 turns, flash from 47 turns to 63 turns. This explains why the context got longer:
the turn count rose 25%~34%, and the content per turn is also getting longer.

This turn-count metric does not exist at all in ordinary RL (one question, one answer); it is specific to agentic RL.
It corresponds directly to "how hard this task is and how many steps the model is willing to spend trying".

### 10. perf/total_num_tokens — total token count of this step's training

Plain English: how many tokens were actually fed into the trainer at this step.

pro rose from 1.8 billion to 2.65 billion, up 47%. This number can be calculated directly; I verified it:
1568 problems × 16 attempts × average context length ≈ 2.66 billion, which matches the actual value.

This identity is important, because it shows that **the training cost of this step is almost entirely determined by context length**.
The chain of cost transmission is: the model writes longer → more tokens per step → slower and more expensive training.

### 11-13. timing_s/step, timing_s/outer_gen, timing_s/trainer_ops — the three timing segments

- `step`: wall clock time of one whole step
- `outer_gen`: time spent in the sampling (letting the model solve problems) phase
- `trainer_ops`: time spent in the trainer (actually updating parameters) phase

Plain English: where the time in a step goes.

There is a premise you must know: **`timing_s/step` does not include restart wait time**.
I checked each step's absolute timestamp one by one: for steps without restarts, this number is within 10 seconds of the real wall clock;
for steps with restarts, it differs by several hours. Because pro has many restarts, the total duration reported for 15 steps is 35.9 hours,
while the real wall clock is 52.6 hours; the 16.8 hours (32%) in between were not counted.

So be extra careful when looking at this curve: **it being flat does not mean this step ran fast; it may just be that the restart period was not counted**.
To judge the real elapsed time, look at the interval "from when the previous step completed to now" on the run card.

pro's data: the step rises from 9570 seconds to 10492 seconds (2.66 hours → 2.91 hours).
But broken down, `outer_gen` **dropped** from 6514 seconds to 5451 seconds, while `trainer_ops` rose from 2889 seconds to 4814 seconds (up 67%).

That is, **the bottleneck is shifting from "generation" to "training"**.

This is not hard to understand. Generation can be spread out in parallel—on the dashboard, pro has 23,000 sandbox environments running at the same time,
The generation phase's time depends on "how long the longest trajectory takes to run," and has little to do with total token count.
Training, by contrast, feeds all tokens into the model one by one to compute gradients, and its time is almost proportional to total token count.
I calculated the correlation between the two: the correlation coefficient between `ctx_total_length/mean` and `trainer_ops` is 0.968, almost a straight-line relationship.

This is currently the most typical engineering bottleneck in long-context agentic RL, and the second analysis will expand on it specifically.

### 14-15. dynsam/passrate/zero, dynsam/passrate/one — proportion of all-wrong tasks and all-correct tasks

In plain terms: **how many tasks the model never got right even once, and how many tasks the model got right every time**.

Why are these two numbers important? Back to what was said earlier: for a task with 16 attempts, if it is all wrong or all correct,
there is no difference among these 16 attempts, so there is no way to judge "which one is better," and this task **produces no gradient at all** for training.
In other words, these two groups of tasks were "sampled in vain."

There is a very noteworthy phenomenon in pro's data:

- `passrate/zero` stayed flat between 0.143 and 0.160 from start to finish, barely moving across 14 steps.
- `passrate/one` rose from 0.178 to 0.256, up 44%.

Calculating the correlation: pass rate correlates with `passrate/one` at +0.93, and with `passrate/zero` at only -0.47.
**That is, almost all of the model's progress over these 50 days comes from "turning tasks it could originally get right half the time into tasks it gets right every time,"
rather than "conquering tasks it originally could not solve at all."** About 15% of the tasks stand there like a wall and have never been climbed over.

This is the one point in the first analysis that I most want people to see. The second one will continue to track this phenomenon.

### 16. dynsam/infra_error/seq_rate — infrastructure error rate

In plain terms: **how many trajectories were taken down by machine failures**.

These are not the model getting it wrong; they are sandboxes crashing, networks dropping, and containers failing to start.
This portion of data has to be discarded or rerun, which is pure waste.

pro fluctuates between 0.3% and 0.9%; flash rose from 0.57% to 1.39%, and flash is clearly higher.
Combined with the announcement that flash reran for 3 hours because "infrastructure errors were not detected," it is fair to say that sandbox stability on the flash run is currently a weak point.

### 17. env/active — number of sandbox environments running at the same time

In plain terms: **how many "virtual machines for the model to solve tasks on" are currently open at the same time**.

pro has about 23,000, and flash has about 38,000 (flash's model is smaller, so the same machines can run more).
This number is basically a flat line, indicating that the cluster size is fixed.

It is a purely engineering metric, but it explains why the generation phase can be so fast: 23,000 sandboxes in parallel,
equivalent to 23,000 "test takers" answering questions at the same time.

### 18. partial/avg_staleness — average "number of stale versions"

This metric is a bit roundabout to understand.

In plain terms: **the answers the model is holding were written by a version of itself from "several generations ago"**.

RL runs like this: use the current parameters to generate a batch of answers, then use that batch of answers to update the parameters.
If generation and update are strictly serial, the answers are always "written by the latest generation of itself."
But that is too slow—generation takes two hours, and during those two hours the trainer sits idle.

So the modern approach is **asynchronous**: while the trainer is updating generation N, the generator is already using generation N to generate data for step N+1.
The cost is that by the time this batch of data is actually used for training, the parameters may have already been updated once or twice. The data has become "stale."

`avg_staleness = 1.2` means that on average, the data used for training was produced by a policy 1.2 generations earlier.

**I fully verified this metric**, because the interface provides the full distribution: `partial/0/frac`, `partial/1/frac` …
respectively representing "the share of tokens that are stale by 0 generations / 1 generation / 2 generations ……".
I added them back according to `Σ i × frac_i`, and all 14 steps exactly equal the `avg_staleness` reported on the dashboard.
So it can be confirmed: `partial/i/frac` is exactly the staleness distribution.

Looking at the distribution is much more interesting than looking at the average. The distribution for pro step 14 is:
0 generations 27.4%, 1 generation 38.5%, 2 generations 19.5%, 3 generations 14.6%.
**More than 70% of the data is stale**, and less than 30% is fresh.

flash has a longer tail. From step 11 to 15, 0.33%~0.47% of tokens are more than 8 generations stale,
even 8 bins cannot hold them (this is why my calculated `Σ i × frac_i` is smaller than the reported value).

**One thing that is easy to get backwards**: stale does not equal bad. In the public framework documentation, there is a set of controlled experiments,
relaxing the allowed staleness from 0 to 0.5 actually raised the final accuracy from 0.2604 to 0.3094,
and the time for the same 400 steps dropped from 26 hours to 17.3 hours. The reason is that generation and training can overlap, so the machines do not sit idle,
and as long as the correction is truly done properly, the bias introduced by slightly older data is acceptable.
So seeing that this number is not 0 should not be treated as a fault; what you really need to watch out for is it continuously rising above 3 and not falling back.

Stale data is not unusable, but it needs correction when used, which is item 19 below.

### 19. dynsam/num_measurable — number of tasks with a "measurable pass rate"

In plain terms: **how many tasks in this step have a pass rate that "can show a difference"**.

As said earlier, all-correct and all-wrong tasks have no gradient. This number counts exactly the remaining tasks.
It fluctuates between 2200 and 4000 at each step, while the target is 1568 tasks.
In other words, **the sampler has to collect more than twice as many tasks to gather 1568 useful ones**.

This piece of data explains the existence of the entire "dynamic sampler" block on the page:
The sampler does not just grab 1568 tasks at random and call it done; it has to sample while judging whether each task's pass rate is in the middle,
If not, discard it and move on to the next one. This is "dynamic sampling".

---

## 7. dynamic sampler panel

This section has the highest information density on the whole page, but it is also the one fewest people understand.

On the left is a scrolling log, about one line every 30 seconds, for example:

```
accepted 2,616/1,568 · judged 2,458 · pass 0.601 (n=12,189) · remaining 89 +1,057 partial +396 rewarding · prewarm 292
accepted 2,616/1,568 · judged 2,458 · pass 0.601 (n=12,189) · remaining 89 +1,057 partial +396 rewarding · prewarm 292
```

Translation section by section:

- `accepted 2,616/1,568`: This step has already received 2616 qualified tasks, with a target of 1568. **Exceeded by 67%**.
- `judged 2,458`: Of these, 2458 have already been graded.
- `pass 0.601 (n=12,189)`: Among all attempts graded so far, the pass rate is 60.1%, out of 12,189 attempts in total.
- `remaining 89 +1,057 partial +396 rewarding`: 89 not started, 1057 half done, 396 already have scores.
- `prewarm 292`: Number of pre-warmed sandboxes (bring environments up in advance so you don't have to wait when using them).

On the right is a table broken down by data source:

| source | accepted / target | remaining | judged | in flight |
| --- | --- | ---: | ---: | ---: |
| code/dataset-obg8 | 261 / 154 | 0 | 234 | 178 |
| code/dataset-zg6q | 213 / 154 | 0 | 202 | 44 |
| … | | | | |
| chat/dataset-lm3t | 23 / 15 | 0 | — | 0 |
| total | 2,616 / 1,568 | 0 | 2,458 | 1,146 |

This table answers a very practical question: **"Is the data mix right?"**.
The overall target of 1568 tasks is not scattered randomly, but allocated by major-category quotas:
code: 11 datasets, general: 4, cyber: 1, visual: 6, chat: 3, for a total of 25 data sources.

Data source names are anonymized into random suffixes like `dataset-obg8`; you cannot tell which dataset it specifically is, but you can see the mix and progress.
For example, `code/dataset-yfch` brought in 335 tasks in this step, with a target of 55, **6 times over**,
meaning most tasks produced by this data source are "unqualified" (pass rate not in the middle), and the sampler can only keep swapping;
while `chat/dataset-lm3t` collected 23 tasks against a target of 15, not much over, meaning this source's tasks are relatively "usable".

The ratio in this column `accepted / target` is actually the **effective rate per data source**; this is the truly valuable part of this panel.

A "—" appearing in the `judged` column means this source has not started grading yet; `in flight` is the number of running sandboxes.
`cyber/dataset-9aui` in the flash step `accepted 63/64` but `in flight` has 241,
indicating that quite a few tasks from this source are stuck in sandboxes and cannot run to completion; this is a long tail.

---

## 8. batch composition panel

This section answers the question: **what proportions make up the 1568 tasks actually used for training in this step**.

You can view by "data source" or "by harness", and you can also view counts or proportions. The current view is by major category:

| category | sources | prompts | share | Δ share |
| --- | ---: | ---: | ---: | ---: |
| code | 11 | 1,061 | 67.7% | ▲0.5 pt |
| general | 4 | 190 | 12.1% | ▼0.3 pt |
| cyber | 1 | 64 | 4.1% | ▼0.1 pt |
| visual | 6 | 206 | 13.1% | ▼0.3 pt |
| chat | 3 | 47 | 3.0% | ▲0.1 pt |
| total | 25 | 1,568 | 100% | |

In plain terms: **how this step's "exam paper" is assembled**. Code tasks account for 67.7%, chat only 3%.

This ratio is adjustable, and it is critical: if code tasks account for too high a share, the model will become able only to write code;
if too low, it will not solve practical problems. The dashboard displays it so outsiders can see "whether the data mix has quietly skewed".

At the bottom of the panel there is also a line of small text, a reminder to the reader of the table:
"The step right after a restart reports consumption of the previous pool; the composition at that time is carried-over plus newly collected tasks allocated by proportion."
Translated, this means: for the first step after a restart, this ratio cannot be treated as a normal value.

Viewing by harness is more interesting. Harness refers to **the outer "scaffolding"**—
The same model, wrapped with different prompts and tool sets, can perform completely differently.
The interface has 23 harnesses (harness-A to harness-U, several of which have the -pw suffix),
Each has 6 metrics: how many trajectories were run in this step, how many actually entered the training batch,
the ratio of positive to negative advantage, mean advantage, etc.

As an example, the number of trajectories per harness for pro's most recent step:
harness-A 2974、harness-B 3541、harness-C 3633、harness-D 3814、harness-H 2446、harness-T 1010、
harness-E 544, harness-A-pw 127 …… totaling about 22,400.

This tells us: **these two training runs are not "one model, one prompt", but dozens of different task forms trained together**.
This is also why the page needs a separate "by harness" toggle button—
If the performance of a certain harness suddenly drops, it means there is a problem with that form of task.

---

## 9. metrics view and another 1,000-plus metrics

Click the metrics tab; on the left is a tree, and the upper right says `all 2069 tags`.
That is, this dashboard exposes 2069 metric names in total; the 18 on the homepage are just pinned at the top.

**The site provides textual explanations for only 22 of them** (the batch on the homepage, plus `dynsam/passrate/hist9_ratio`,
`train/harness/*/training/rollouts` and a few others). The remaining 2000-plus have only names, no explanations.

Below I explain by namespace roughly what each family does, while marking which ones I can confirm and which ones I am not sure about.

### Confirmed (there are official explanations; I checked the values item by item)

| Namespace | Metric count | Description |
| --- | ---: | --- |
| `dynsam/` | 83 | Dynamic sampler. Pass rate, all-correct/all-wrong ratio, infrastructure error rate, number of runs, number of measurable tasks |
| `actor/` | 257 | The policy (model) itself. Loss, entropy, gradient, learning rate, various clipping ratios |
| `critic/` | 324 | Grading side. Mean/max/min of reward, advantage, return |
| `ctx_*_length/` | 270 | Context length, split into 3 sets: prompt / response / total, each with global and per-data-source breakdowns |
| `env/` | 15 | Sandbox environment. Number running, cumulative starts, cumulative errors, whether leakage is possible |
| `partial/` | 377 | Degree of data "staleness". See item 18 above; I fully verified it |
| `timing_s/` | 3 | 3 timing segments |
| `perf/` | 1 | Total token count for training in this step |
| `train_infer_diff/` | 11 | Numerical divergence between the inference engine and the trainer |
| `training/` | 2 | Global step number and optimizer step count |

### A few families worth calling out separately

**`critic/advantages/*` (advantage, advantage value).**
This is the quantity in RL that actually drives learning: it answers "how much better this attempt is than average".
The mean is almost 0 (for pro, -0.003 to -0.014), the maximum is 1.1~1.3, and the minimum is -0.9~-1.6.
A mean close to 0 is normal, because the 16 attempts on the same task have their own average score subtracted,
The remaining positives and negatives cancel out exactly. The degree of symmetry between the maximum and minimum reflects how well normalization is done.

**`actor/pg_tis_clipfrac` series (importance sampling clipping ratio).**
This is a patch for "stale data". As said earlier, asynchronous training makes data stale, and stale data cannot be used directly to compute gradients,
you must first apply a weighted correction based on the probability ratio between the new and old policies (this practice is called importance sampling correction, truncated importance sampling, TIS),
and the correction weights are constrained to a range to prevent individual samples from having absurdly large weights.
`pg_tis_clipfrac` is precisely the "proportion of samples that are constrained". For pro, it rose from 0.00002 to 0.00033,
an increase of more than 10-fold, but the absolute value is still only 3 ten-thousandths; for flash, from 0.000045 to 0.00019.
**This number is small, indicating that the bias caused by stale data is still under control for now**, which is consistent with `avg_staleness` being only 1.2.

The interface also has this group `partial/i/train_infer_diff/new_infer/F(tau=…)`,
F is the proportion of samples whose "weight exceeds the bound" at different thresholds; the smaller tau is, the stricter it is.
For pro, F(1.5) rose from 0.4% to 2.4%, and F(2) rose from 0.06% to 0.83%. It is likewise "rising, but still small".

**`actor/ppo_kl` and `actor/pg_clipfrac` are identically zero.**
These two metrics are exactly equal to 0 in all steps of the two training runs.
By the usual understanding, PPO's clipfrac should be a decimal greater than 0. There are two possibilities for it being identically zero:
Either the clipping mechanism used in this training differs from standard PPO (so this counter was not assigned a value),
or these two fields are inactive under this training configuration.
**I am not sure which it is, and the site does not explain it either, so I will not interpret it.** I can only record this fact:
If you only look at pg_clipfrac to judge training health, on this system you will get the erroneous conclusion of "always perfect".

**`train/verdicts/*` (where trajectories go).**
Each step has 25088 candidate trajectories, and each ultimately has to be accounted for:
`trained` are the ones that actually enter training (identically 25088), `rejected` are discarded (about 12,000~29,000),
`expired` are invalidated due to timeout, `carried` are kept for the next step to continue using, `dropped_zero_adv` are discarded because they have no advantage.
Two interesting facts: `dropped_zero_adv` and `dropped_empty_response` are identically zero;
`rejected` is comparable in order of magnitude to `trained`, indicating that **about half of the sampling results were discarded**.

**`penalty/stage_credit_group/*` (535 metrics, the largest family).**
Judging from the field names, these are internal counts of a **code-problem reward validation pipeline**:
There is a judge pool (`judge_pool_in_flight`, `judge_pool_max_load`), two-pass judging (`pass1_success_rate`, `pass2_success_rate`),
grouping (`groups_attempted`, `groups_judged`), tiering (`select_tier_share_T1/T2/T3/H`),
and a set of counts for suspected cheating detection (`select_hack_attempt`, `select_process_severe`,
`select_r2_flagged`、`select_r3_gold_fails`、`select_regression_flagged`）。

A few numbers that can be confirmed:

- Judging success rate is very high: `pass1_success_rate` is steadily above 0.95, `pass2_success_rate` is identically 1.0.
- `select_hack_attempt_rate` is 0.34~0.41 in pro and 0.38~0.47 in flash, **close to 40%**.
  This number looks alarming, but in the field name "attempt" means "try", and it is very likely "triggered a check" rather than "confirmed cheating",
  The genuinely serious `select_process_severe` is only 15~30 per step. **The site has not published the specific definition, so I will not interpret further.**
- A bunch of cap-type counters are identically zero: `select_r2_capped`, `keep_mass_capped`, `rollouts_masked`,
  `select_r3_gold_fails`, `groups_skipped_unbalanced`. This means these protection mechanisms **have never been triggered**.
- `train/adv_pos_sum_pre_penalty` and `train/adv_pos_sum_post_penalty` are exactly the same at every step,
  `penalty/action/adv_reduction_total` is identically zero.
  In other words, this complex penalty pipeline **measures very finely, but in the end barely changes the advantage values**.

This last point is a rather intriguing signal in this dashboard; the second analysis will discuss it further.

**`train/harness/*`。**
23 harnesses × 6 metrics. Besides trajectory count, there is also `nonzero_adv_rate` (how many trajectories have a nonzero advantage,
that is, the "share of effective learning signal"). For pro, this value across harnesses is mostly 0.97~0.99, and harness-E is identically 1.0.

**`env/possible_leak` is identically zero.**
This metric is probably checking "whether the model might read the answer from the sandbox" (for example, the standard answer is hidden in the test files).
Being identically zero is a good thing, but it could also simply mean this check is not implemented. Likewise, I will not interpret it.

**`train/spec_accept_length/token_mean` (speculative decoding acceptance length).**
This is a technical metric for inference acceleration: during generation, first guess several tokens; if guessed correctly, one forward pass is saved.
This value is "how many are guessed correctly on average per attempt". It is 3.4~3.55 for pro and 2.75~2.86 for flash.
Both numbers are **slowly declining** (pro from 3.51 to 3.41, flash from 2.86 to 2.76).
This decline is consistent in direction with the change in generation-phase time, and is worth noting.

---

## 10. Things I cannot understand (explicitly listed)

When writing this, I genuinely did not understand the following, and the site gives no explanation, so I list them instead of guessing:

1. The total token count recorded by `partial/i/n_tokens` is only about half that of `perf/total_num_tokens`,
   I do not know which part it is counting.
2. Why `actor/ppo_kl` and `actor/pg_clipfrac` are identically zero.
3. `select_hack_attempt_rate` is close to 40%; what exactly does this "attempt" count?
4. `train/passrate/avg_passrate` and `dynsam/avg@n` are not the same number (in pro they differ by about 3 percentage points),
   This indicates the two use different measurement definitions, but the site does not say where the difference lies.
5. `dynsam/passrate/hist9_ratio` (nine bins of pass rate) is mentioned in the official explanation,
   but I did not find the corresponding series in the API.
6. What scaffolding are `harness-A` through `harness-U` specifically?
7. What does the `-pw` suffix mean?

Writing out these uncertainties is more useful than fabricating a self-consistent explanation.

---

## 11. One-sentence summary of each section

| Section | One sentence |
| --- | --- |
| Total spend | How much money this gamble has burned, $8.57 per second |
| Clocks in four cities | Used to check the time when troubleshooting |
| notices | Official explanation of "why it reran" |
| Run card | What step it is at now, which stage it is stuck at, and how much it has learned |
| benchmarks | Standard exam score; noisy, so look at the trend, not a single point |
| 18 resident metrics | Training dashboard: how well it is learning, how much it costs, and whether it has gone off track |
| dynamic sampler | How the sampler selects problems while sampling, and the effective rate of each data source |
| batch composition | How this step's exam is assembled, and which problem types the compute is spent on |
| metrics view | Raw data for all 2069 metrics, of which more than 2000 have no official explanation |
