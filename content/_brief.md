# 指标解读撰写须知（子智能体共用）

## 背景

`https://mimo.xiaomi.com/rl/` 是小米 MiMo 团队公开的 RL 大训练看板，两个 run：
`mimo-v2.6-pro`（$5.71/s）和 `mimo-v2.6-flash`（$2.855/s）。训练在 2026-09-15 开始，
现在 pro 到第 19 步、flash 到第 25 步，每步约 2~3 小时。

本地仓库在 `tasks/mimo-rl-telemetry/data/store/`，是从原站增量同步下来的权威副本。你要写的是
**"看板上这些图各自在讲什么"**——指标用途解读，给一个懂工程但不是 RL 训练专家的人看。

## 写什么

给分到的每个指标写一条解读。要有信息量，不要复述官方定义就完事。重点回答：

1. 这个数是什么量出来的（数据从哪来、怎么算）
2. 训练时为什么盯它——它坏了会怎样
3. 怎么读：什么样的形状正常、什么形状要警惕
4. 这一轮实测是什么样（**必须用真实数字**，见下）
5. 容易读错的地方

## 硬性要求

- **不许编。** 所有数字必须从仓库里读出来，而且你读到的就是你要写的。
  凡是你没在数据里见到的，不要写。凡是不确定的，写"看板上没有说明"。
- **不许造术语。** 用行业里已有的说法；官方有 description 的以官方为准（见下）。
  官方没解释的指标，就照 tag 名字直译，并说明"看板未给官方说明"。
- **语言**：中文，朴素平实，像技术负责人写给同事看的内部文档。
  不要排比句，不要"赋能/闭环/抓手"这类词，少用加粗，不要 emoji。
- 英文专有名词保留原文（KL、rollout、clip fraction 等），不要硬翻。

## 官方说明（22 条，原文照抄，别改写）

```
dynsam/avg@n                      mean pass rate: for each prompt sampled this step, the fraction of its n attempts that succeed, averaged over prompts
dynsam/avg@n_no_infra             avg@n with attempts that failed for infrastructure reasons excluded
critic/rewards/mean               mean reward over trajectories trained on this step
actor/entropy_loss                mean per-token entropy of the policy
actor/pg_loss                     clipped policy-gradient objective
actor/grad_norm                   global gradient norm before clipping
train_infer_diff/new_infer/kl     KL between inference-engine and trainer log-probs on the same tokens
ctx_response_length/mean          tokens generated per trajectory
dynsam/agg_turn/mean              agent turns per trajectory
perf/total_num_tokens             tokens trained on this step
timing_s/step                     wall-clock of the whole step
timing_s/outer_gen                wall-clock of rollout generation
timing_s/trainer_ops              wall-clock of the trainer
dynsam/passrate/zero              share of prompts where no attempt succeeded
dynsam/passrate/one               share of prompts where every attempt succeeded
dynsam/infra_error/seq_rate       share of sequences lost to infrastructure failures
env/active                        sandbox environments in flight
partial/avg_staleness             policy versions between sampling and training, on average
dynsam/num_measurable             prompts with a measurable pass rate this step; per data source under dynsam/<source>/num_measurable
dynsam/passrate/hist9_ratio       share of prompts by pass rate, in nine bins from none solved to all solved
train/harness/*/training/rollouts rollouts in the training batch, per agent harness
ctx_total_length/mean             total context length per trajectory (prompt + response), in tokens
```

看板首页固定展示 18 个图（pins）：

```
dynsam/avg@n  critic/rewards/mean  actor/entropy_loss  actor/pg_loss  actor/grad_norm
train_infer_diff/new_infer/kl  ctx_total_length/mean  dynsam/agg_turn/mean
perf/total_num_tokens  timing_s/step  timing_s/outer_gen  timing_s/trainer_ops
dynsam/passrate/zero  dynsam/passrate/one  dynsam/infra_error/seq_rate  env/active
partial/avg_staleness  dynsam/num_measurable
```

## 怎么读数据

仓库结构：

```
tasks/mimo-rl-telemetry/data/store/
  meta.json                     站点配置：pins、formats（数值格式化规则）、categories、22 条官方说明
  benchmarks.json               3 个离线评测榜的历史成绩
  notices.json                  官方公告（重启原因等）
  runs/<pro|flash>/
    series.json                 {指标名: [每步的值]}      ← 主要看这个
    axis.json                   {steps: [...], ...}
    status.json                 当前状态快照
    events.json                 事件流：step / restart
    timeline.jsonl              每个同步点一行
    tags.json                   指标名清单 + 版本历史
```

**关键：`series.json` 里 `值数组的下标 = 步号 - 1`。**
`null` 表示该步没这个值（指标是后加的，或者已经不再上报）。

现成工具（在项目根目录 `D:\workspace\hhw\my_claw` 执行）：

```bash
# 一份综合报告：逐步表、时间账、重启、关键指标轨迹、新鲜度桶、类目占比
bun codes/scripts/mimo_rl_telemetry/analyze.ts

# 自己取数
bun -e "const s=require('./tasks/mimo-rl-telemetry/data/store/runs/flash/series.json');
const a=s['dynsam/avg@n']; console.log(a.length, a[a.length-1]);"
```

## 几个已经查证过的事实（可以直接用，不用重复验证）

- pro 共 9 次重启、flash 4 次。pro 墙钟 72.2h 但 `Σ timing_s/step` 只有 48.4h，
  少报 23.7h（占 32.9%）；flash 少报 14.6h（占 21.6%）。**`timing_s/step` 不含重启等待。**
- 新鲜度桶：pro 8 个（`partial/0..7`），flash 10 个（`partial/0..9`），**两边数量不一样，别写死**。
- 全局 KL 与 `partial/avg_staleness` 的相关性：pro 0.930，flash 0.925。
  而桶 0（最新鲜数据）的 KL 与 staleness 几乎无关（pro -0.194，flash 0.197）。
- 桶 0 的 KL：pro 首步 0.002193 → 末步 0.002642；flash 0.002868 → 0.003549。
- `critic/rewards/mean` 与 `critic/score/mean` 数值完全相同（已核验，差 0）。
  但两者与 `dynsam/avg@n` **不相等**：pro 最大差约 0.045，flash 约 0.059。
  原因是口径不同——前者是"被训练轨迹的奖励平均"，后者是"采样 prompt 的通过率平均"，
  两者的分母（训练批次 vs 采样批次）不是同一批数据。不要混为一谈。
- `critic/advantages/mean` 与 `critic/returns/mean` 数值完全相同（已核验，差 0）。
- 离线评测（benchmarks）明显滞后：pro 只出到 step 15，flash 只出到 step 21，
  而两个 run 已经跑到 19 / 25 步。
- pro 从第 15 步起不再上报 cyber 数据集的 `n_tokens`（`partial/cyber/...` 从第 15 步起是 null），
  对应公告里"从 pro 的下一轮移除 cyber 数据集"。
- pro 第 19 步 `actor/grad_norm` = 0.03351，是其余各步中位数（约 0.0054）的 6.2 倍，一次性尖峰。
  flash 从未出现类似尖峰。

## 输出格式

写一个 JSON 数组到你被指定的文件里。每个元素：

```json
{
  "id": "指标名，必须和 series.json 里的 tag 一模一样",
  "name": "中文短名（可以带英文原名）",
  "group": "分组名",
  "unit": "单位/量纲，例如 比例 0~1、秒、token 数",
  "what": "它量的是什么。2~3 句。先给直觉，再说准确定义。",
  "how": "这个数是怎么算出来/从哪来的。2~4 句。官方有说明就用官方口径。",
  "why": "训练时为什么盯它。异常了意味着什么。2~4 句。",
  "read": ["判读要点 1", "判读要点 2", "判读要点 3"],
  "observed": "这一轮实测。带具体数字：范围、首末、转折点、pro 与 flash 的差别。3~6 句。",
  "traps": ["容易读错的地方，一条一句"],
  "related": ["相关的指标名"]
}
```

`read` 3~6 条，`traps` 1~4 条。字段都要有，没有内容就写空数组，不要省略键。
JSON 必须能被 `JSON.parse` 解析（注意中文引号、转义）。

写完用 `bun -e "JSON.parse(require('fs').readFileSync('<你的文件>','utf8'))"` 验证一下再交。
