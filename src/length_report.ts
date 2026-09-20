#!/usr/bin/env bun
/**
 * length_report.ts
 * 生成长度这条线的复算脚本：把"编程任务的生成长度从约 80k 涨到 120k+"
 * 拆成能逐项核对的小问题，并把结论要用到的每个数字打出来。
 *
 * 运行（项目根目录）：
 *   bun src/length_report.ts
 *   bun src/length_report.ts --json   # 只输出 JSON
 *
 * 数据来源（只读，不改）：
 *   data/store/runs/{pro,flash}/{series,axis,status,events}.json
 * 产物：
 *   analysis/zh-CN/numbers/A3-生成长度-numbers.json
 *
 * 设计原则：脚本里不写任何结论数字，报告里出现的每个数都要能从这里复算。
 * 相关性也在这里重算一遍（不引第三方库），口径与 site/js/correlate.js 一致。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STORE = resolve(ROOT, "data", "store");
const OUT = resolve(ROOT, "analysis", "zh-CN", "numbers", "A3-生成长度-numbers.json");
const JSON_ONLY = process.argv.includes("--json");

const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);

/* ------------------------------------------------------------------ 统计 */

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

/** 成对删除。返回两个等长数组，样本量就是它们的长度。 */
function pairs(a: (number | null)[], b: (number | null)[]): [number[], number[]] {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (num(a[i]) && num(b[i])) { x.push(a[i] as number); y.push(b[i] as number); }
  }
  return [x, y];
}

/** 相邻两点的一阶差分；任一侧为空则该位置为空。 */
function diff(v: (number | null)[]): (number | null)[] {
  return v.map((x, i) => (i > 0 && num(x) && num(v[i - 1]) ? x - (v[i - 1] as number) : null));
}

/* -------------------------------------------------------------- 读数据 */

interface Run {
  key: string;
  steps: number[];
  walls: number[];
  runStart: number;
  status: any;
  events: any[];
  versions: { version: string; at: number; n: number }[];
  series: Record<string, (number | null)[]>;
}

function readRun(key: string): Run {
  const dir = resolve(STORE, "runs", key);
  const axis = jread(resolve(dir, "axis.json"));
  const tags = jread(resolve(dir, "tags.json"));
  return {
    key,
    steps: axis.steps,
    walls: axis.walls,
    runStart: axis.run_start,
    status: jread(resolve(dir, "status.json")),
    events: jread(resolve(dir, "events.json")),
    versions: tags?.versions ?? [],
    series: jread(resolve(dir, "series.json")),
  };
}

const runs = { pro: readRun("pro"), flash: readRun("flash") } as Record<string, Run>;
const benchmarks = jread(resolve(STORE, "benchmarks.json"));

/** 取某个指标在某个 run 上的逐步数组；缺就抛，免得悄悄算出一堆 null。 */
function S(r: Run, tag: string): (number | null)[] {
  const v = r.series[tag];
  if (!v) throw new Error(`metric not found: ${r.key} / ${tag}`);
  return v;
}

/* ------------------------------------------------------- 一、总量与形状 */

const firstLast = (v: (number | null)[]) => {
  const nz = v.filter(num) as number[];
  return { n: nz.length, first: nz[0] ?? null, last: nz.at(-1) ?? null, min: Math.min(...nz), max: Math.max(...nz) };
};
const growth = (v: (number | null)[]) => {
  const { first, last } = firstLast(v);
  return first && last ? last / first - 1 : null;
};

const overall: any = {};
for (const r of Object.values(runs)) {
  overall[r.key] = {
    steps: r.steps.length,
    response_length_mean: firstLast(S(r, "ctx_response_length/mean")),
    response_length_mean_growth: growth(S(r, "ctx_response_length/mean")),
    total_length_mean: firstLast(S(r, "ctx_total_length/mean")),
    total_length_mean_growth: growth(S(r, "ctx_total_length/mean")),
    prompt_length_mean_range: firstLast(S(r, "ctx_prompt_length/mean")),
    turn_mean: firstLast(S(r, "dynsam/agg_turn/mean")),
    turn_mean_growth: growth(S(r, "dynsam/agg_turn/mean")),
    tokens_step: firstLast(S(r, "perf/total_num_tokens")),
    tokens_step_growth: growth(S(r, "perf/total_num_tokens")),
  };
}

/* --------------------------------------- 二、code 类各数据集（"80k→120k" 的落点） */

const codeSets = (r: Run) =>
  Object.keys(r.series)
    .filter((k) => /^ctx_response_length\/code\/dataset-[a-z0-9]+\/mean$/.test(k))
    .sort();

const perDataset: any = {};
for (const r of Object.values(runs)) {
  perDataset[r.key] = codeSets(r).map((tag) => {
    const v = S(r, tag);
    const { first, last } = firstLast(v);
    return {
      tag, dataset: tag.split("/")[2], category: tag.split("/")[1],
      first, last, growth: growth(v),
      // 逐步相对变化，用来看"跳"还是"爬"
      stepChanges: v.map((x, i) => (i === 0 || !num(x) || !num(v[i - 1]) ? null : x / (v[i - 1] as number) - 1)),
    };
  });
}

/* ----------------------------------------- 三、乘法分解：长度 = 回合数 × 每回合 */

const decompose: any = {};
for (const r of Object.values(runs)) {
  const len = S(r, "ctx_total_length/mean");
  const turns = S(r, "dynsam/agg_turn/mean");
  const per = len.map((x, i) => (num(x) && num(turns[i]) ? x / (turns[i] as number) : null));
  const fl = firstLast(len), ft = firstLast(turns), fp = firstLast(per);
  decompose[r.key] = {
    length: fl, turns: ft, per_turn: fp,
    // 用对数相加来分解：ln(倍数) 可加，直接比百分比会重复计数
    growth: {
      length: growth(len), turns: growth(turns), per_turn: growth(per),
      share_from_turns: null as number | null,
      share_from_per_turn: null as number | null,
    },
    perTurnByStep: per,
  };
  const gl = growth(len), gt = growth(turns), gp = growth(per);
  if (gl != null && gt != null && gp != null) {
    const total = Math.log(1 + gl);
    decompose[r.key].growth.share_from_turns = Math.log(1 + gt) / total;
    decompose[r.key].growth.share_from_per_turn = Math.log(1 + gp) / total;
  }
}

/* -------------------------------------------- 四、长度的异常跳变（单步幅度） */

const jumps: any = {};
for (const r of Object.values(runs)) {
  const rows: any[] = [];
  const tags = Object.keys(r.series).filter((k) => /^ctx_(response|total)_length\/code\/dataset-[a-z0-9]+\/mean$/.test(k));
  for (const tag of tags) {
    const v = S(r, tag);
    for (let i = 1; i < v.length; i++) {
      if (!num(v[i]) || !num(v[i - 1]) || (v[i - 1] as number) === 0) continue;
      const pct = (v[i] as number) / (v[i - 1] as number) - 1;
      rows.push({ tag, step: r.steps[i], pct, from: v[i - 1], to: v[i] });
    }
  }
  jumps[r.key] = {
    topIncreases: rows.slice().sort((a, b) => b.pct - a.pct).slice(0, 10),
    topDecreases: rows.slice().sort((a, b) => a.pct - b.pct).slice(0, 10),
  };
}

/* ------------------------------------- 五、1M 上下文上限与截断（clip_ratio） */

const ceiling: any = {};
for (const r of Object.values(runs)) {
  const mx = (S(r, "ctx_total_length/max").filter(num) as number[]).slice().sort((a, b) => b - a);
  const clip = S(r, "ctx_total_length/clip_ratio");
  const nz = clip.map((x, i) => [r.steps[i], x] as const).filter(([, x]) => num(x) && (x as number) > 0);
  const m = r.status?.totals?.trained_step ?? 25088;
  ceiling[r.key] = {
    maxValuesTop: Array.from(new Set(mx)).slice(0, 6),
    stepsAtTop: r.steps.filter((_, i) => num(S(r, "ctx_total_length/max")[i]) && Math.abs((S(r, "ctx_total_length/max")[i] as number) - 1048570) < 1),
    clipNonZeroSteps: nz.length,
    clipTop: nz.slice().sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5)
      .map(([s, x]) => ({ step: s, ratio: x, perTrajectory: Math.round((x as number) * m) })),
    clipPerTrajectoryAll: nz.map(([s, x]) => ({ step: s, perTrajectory: Math.round((x as number) * m) })),
    trainedStep: m,
    // 上限的候选解释：2^20 与实测最大值的差
    pow2_20: 2 ** 20,
    maxMinusPow2: 1048570 - 2 ** 20,
    // obg8 这个数据集自己的截断
    obg8ClipNonZero: S(r, "ctx_total_length/code/dataset-obg8/clip_ratio")
      .map((x, i) => [r.steps[i], x] as const).filter(([, x]) => num(x) && (x as number) > 0),
  };
}

/* -------------------------------- 六、长度与成绩/耗时/成本的关系（含去趋势） */

/** 从 status.json 的 events 里拿逐步抬头指标；长度与它做相关用得到。 */
function headline(r: Run): (number | null)[] {
  const byStep = new Map<number, number>();
  for (const e of r.events) if (e.kind === "step" && e.step != null) byStep.set(e.step, e.value);
  return r.steps.map((s) => (byStep.has(s) ? (byStep.get(s) as number) : null));
}

function corrBlock(r: Run, anchorTag: string, otherTags: string[]) {
  const a = S(r, anchorTag);
  return otherTags.map((tag) => {
    const b = S(r, tag);
    const [x, y] = pairs(a, b);
    const [dx, dy] = pairs(diff(a), diff(b));
    return {
      tag,
      n: x.length,
      pearson: x.length >= 3 ? pearson(x, y) : null,
      spearman: x.length >= 3 ? spearman(x, y) : null,
      n_diff: dx.length,
      d_spearman: dx.length >= 3 ? spearman(dx, dy) : null,
    };
  }).sort((p, q) => Math.abs((q.spearman ?? 0)) - Math.abs((p.spearman ?? 0)));
}

const relations: any = {};
for (const r of Object.values(runs)) {
  const others = [
    "dynsam/avg@n", "train/passrate/avg_passrate",
    "critic/code/dataset-obg8/score/mean", "critic/code/dataset-obg8/rewards/mean",
    "critic/agentic/score/mean", "ctx_total_length/clip_ratio",
    "timing_s/outer_gen", "timing_s/trainer_ops", "timing_s/step",
    "perf/total_num_tokens", "train/adv_pos_sum_post_penalty", "train/adv_neg_sum_post_penalty",
    "env/active", "train/trace/backpressure_wait_seconds_sum",
  ].filter((t) => r.series[t]);
  relations[r.key] = {
    anchor: "ctx_response_length/mean",
    headline_tail: (() => {
      const h = headline(r);
      // 末段：抬头指标见顶之后还涨了几步
      return { values: h, byStep: r.steps.map((s, i) => ({ step: s, value: h[i] })) };
    })(),
    corr: corrBlock(r, "ctx_response_length/mean", others),
    // 与实际用时/成本的对照
    timing: {
      outer_gen: firstLast(S(r, "timing_s/outer_gen")),
      trainer_ops: firstLast(S(r, "timing_s/trainer_ops")),
      step_reported: firstLast(S(r, "timing_s/step")),
      rate_per_s: r.status?.cost?.rate_per_s ?? null,
      so_far: r.status?.cost?.so_far ?? null,
    },
  };
}

/* --------------------------- 七、末段背离：抬头指标见顶而长度继续涨 --------------------------- */

const divergence: any = {};
for (const r of Object.values(runs)) {
  const len = S(r, "ctx_response_length/mean");
  const h = headline(r);
  const valid = h.map((x, i) => (num(x) ? i : -1)).filter((i) => i >= 0);
  let peak = valid[0];
  for (const i of valid) if ((h[i] as number) > (h[peak] as number)) peak = i;
  const after = valid.filter((i) => i > peak);
  divergence[r.key] = {
    peakStep: r.steps[peak], peakValue: h[peak],
    lastStep: r.steps.at(-1), lastValue: h.at(-1),
    afterPeakSteps: after.map((i) => r.steps[i]),
    lengthAtPeak: len[peak], lengthAtLast: len.at(-1),
    lengthGrowthAfterPeak: num(len[peak]) && num(len.at(-1)) ? (len.at(-1) as number) / (len[peak] as number) - 1 : null,
    headlineChangeAfterPeak: (h.at(-1) as number) - (h[peak] as number),
  };
}

/* ----------------------------------------- 八、DeepSWE 上的奇异点（step 11 flash） */

const benchPoint = (key: string, run: string) => {
  const b = benchmarks.find((x: any) => x.key === key);
  const res = b?.results?.[run] ?? {};
  const steps = runs[run].steps;
  return { title: b?.title, note: b?.note, values: steps.map((s) => (res[String(s)] == null ? null : Number(res[String(s)]))) };
};

const sweeps: any = {};
for (const key of benchmarks.map((b: any) => b.key)) {
  const per: any = {};
  for (const run of Object.keys(runs)) {
    const vals = benchPoint(key, run).values;
    per[run] = {
      ...benchPoint(key, run),
      changes: vals.map((x, i) => (i === 0 || !num(x) || !num(vals[i - 1]) ? null : { step: runs[run].steps[i], delta: x - (vals[i - 1] as number), pct: x / (vals[i - 1] as number) - 1 })),
    };
    const cs = per[run].changes.filter(Boolean) as any[];
    per[run].worstDrop = cs.slice().sort((a, b) => a.delta - b.delta)[0] ?? null;
    per[run].bestRise = cs.slice().sort((a, b) => b.delta - a.delta)[0] ?? null;
  }
  sweeps[key] = per;
}

/* --------------------------------------------------------------- 汇总输出 */

const out = {
  generated_at: new Date().toISOString(),
  generated_from: "data/store",
  note:
    "本文件是 src/length_report.ts 的输出。" +
    "解释性文字在 analysis/zh-CN/notes/08-生成长度突增解读.md，" +
    "相关性扫描在 analysis/A3-生成长度-numbers.json（同名文档）与 notes/09。" +
    "数组下标与 axis.json 的 steps 一一对应。",
  data_window: Object.fromEntries(
    Object.values(runs).map((r) => [r.key, {
      steps: r.steps.length,
      first_step: r.steps[0],
      last_step: r.steps.at(-1),
      last_wall_utc: new Date((r.walls.at(-1) ?? 0) * 1000).toISOString(),
      restarts_total: r.status?.totals?.restarts ?? null,
      phase: r.status?.step?.phase ?? null,
      version: r.status?.version ?? null,
    }]),
  ),
  overall,
  perDataset,
  decompose,
  jumps,
  ceiling,
  relations,
  divergence,
  sweeps,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

if (!JSON_ONLY) {
  const k = (v: number | null) => (v == null ? "—" : (v / 1000).toFixed(1) + "k");
  const pct = (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%");

  console.log("=== 1. Overall (generation length and context length) ===");
  for (const [key, o] of Object.entries(overall) as any) {
    console.log(`  ${key}  ${o.steps} steps`);
    console.log(`    ctx_response_length/mean  ${k(o.response_length_mean.first)} → ${k(o.response_length_mean.last)}  (${pct(o.response_length_mean_growth)})`);
    console.log(`    ctx_total_length/mean     ${k(o.total_length_mean.first)} → ${k(o.total_length_mean.last)}  (${pct(o.total_length_mean_growth)})`);
    console.log(`    ctx_prompt_length/mean    ${k(o.prompt_length_mean_range.min)} ~ ${k(o.prompt_length_mean_range.max)} (input side, roughly flat)`);
    console.log(`    token/step                ${k(o.tokens_step.first)} → ${k(o.tokens_step.last)}  (${pct(o.tokens_step_growth)})`);
  }

  console.log("\n=== 2. Multiplicative decomposition: length = turns × length per turn ===");
  for (const [key, d] of Object.entries(decompose) as any) {
    console.log(`  ${key}: length ${pct(d.growth.length)} = turns ${pct(d.growth.turns)} × per-turn ${pct(d.growth.per_turn)}`);
    console.log(`      share from turns ${pct(d.growth.share_from_turns)}, share from per-turn growth ${pct(d.growth.share_from_per_turn)}`);
    console.log(`      turns ${d.turns.first?.toFixed(1)} → ${d.turns.last?.toFixed(1)}; per-turn ${d.per_turn.first?.toFixed(0)} → ${d.per_turn.last?.toFixed(0)} token`);
  }

  console.log("\n=== 3. code datasets (first and last) ===");
  for (const [key, list] of Object.entries(perDataset) as any) {
    console.log(`  ${key}:`);
    for (const d of list) console.log(`    ${d.dataset}  ${k(d.first)} → ${k(d.last)}  (${pct(d.growth)})`);
  }

  console.log("\n=== 4. Largest single-step length jumps (code datasets, top 5 per run) ===");
  for (const [key, j] of Object.entries(jumps) as any) {
    console.log(`  ${key} increases (code only):`);
    for (const r of j.topIncreases.slice(0, 5)) console.log(`    step ${r.step}  ${pct(r.pct)}  ${k(r.from)} → ${k(r.to)}  ${r.tag}`);
    console.log(`  ${key} decreases (code only):`);
    for (const r of j.topDecreases.slice(0, 5)) console.log(`    step ${r.step}  ${pct(r.pct)}  ${k(r.from)} → ${k(r.to)}  ${r.tag}`);
  }

  console.log("\n=== 5. 1M context ceiling and truncation ===");
  for (const [key, c] of Object.entries(ceiling) as any) {
    console.log(`  ${key}: top values of ctx_total_length/max ${JSON.stringify(c.maxValuesTop)}`);
    console.log(`      steps landing exactly at 1048570: ${JSON.stringify(c.stepsAtTop)}`);
    console.log(`      2^20 = ${c.pow2_20}, 1048570 - 2^20 = ${c.maxMinusPow2}`);
    console.log(`      steps with nonzero clip_ratio ${c.clipNonZeroSteps}; converted to "trajectories clipped per step": ${JSON.stringify(c.clipPerTrajectoryAll)}`);
    console.log(`      obg8's own truncation: ${JSON.stringify(c.obg8ClipNonZero)}`);
  }

  console.log("\n=== 6. Length vs score/time/cost correlations (anchor = ctx_response_length/mean) ===");
  for (const [key, rel] of Object.entries(relations) as any) {
    console.log(`  ${key}: timing_s/step reported mean ${rel.timing.step_reported?.first?.toFixed(0)} → ${rel.timing.step_reported?.last?.toFixed(0)}; rate $${rel.timing.rate_per_s}/s; cumulative $${Math.round(rel.timing.so_far)}`);
    for (const c of rel.corr) {
      console.log(`    ρ=${c.spearman == null ? "—" : c.spearman.toFixed(3)}  detrended ρ=${c.d_spearman == null ? "—" : c.d_spearman.toFixed(3)}  n=${c.n}  ${c.tag}`);
    }
  }

  console.log("\n=== 7. Late-run divergence (length still rising after the headline metric peaks) ===");
  for (const [key, d] of Object.entries(divergence) as any) {
    console.log(`  ${key}: headline metric peaks at step ${d.peakStep} at ${d.peakValue}, by step ${d.lastStep} it is ${d.lastValue} (${d.headlineChangeAfterPeak.toFixed(4)})`);
    console.log(`      generation length over the same period ${k(d.lengthAtPeak)} → ${k(d.lengthAtLast)} (${pct(d.lengthGrowthAfterPeak)}); steps after the peak: ${JSON.stringify(d.afterPeakSteps)}`);
  }

  console.log("\n=== 8. Largest single-step swings on the eval leaderboard ===");
  for (const [key, per] of Object.entries(sweeps) as any) {
    for (const [run, d] of Object.entries(per) as any) {
      if (!d.worstDrop) continue;
      console.log(`  ${key} / ${run}: max drop step ${d.worstDrop.step} ${d.worstDrop.delta.toFixed(2)} (${pct(d.worstDrop.pct)}); max rise step ${d.bestRise.step} +${d.bestRise.delta.toFixed(2)}`);
    }
  }

  console.log(`\nnumbers written to ${OUT}`);
}
