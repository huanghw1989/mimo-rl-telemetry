#!/usr/bin/env bun
/**
 * pipeline_report.ts
 * 把 mimo-v2.6 的看板当"异步训练流水线 + 排队系统"算账：一步的墙钟时间去哪了、
 * 重启吃掉了多少机时和多少钱、管线在哪里堵。
 *
 * 运行（项目根目录）：
 *   bun src/pipeline_report.ts
 *   bun src/pipeline_report.ts --json   # 只输出 JSON，不打印摘要
 *
 * 数据来源（只读，不改）：
 *   data/store/runs/{pro,flash}/{series,axis,status,events,timeline,live}.json(l)
 *   data/store/notices.json
 * 产物：
 *   analysis/zh-CN/numbers/A3-pipeline-numbers.json
 *
 * 设计原则：脚本里不写任何结论数字；报告里出现的每个数都要能从这里复算。
 * 统计全部自算（不引第三方库），口径写在输出 JSON 的 caliber 字段里。
 *
 * 解析口径（重要）：
 *   - axis.walls[i] = 第 i+1 步"完成时"的墙钟时间戳；相邻两项之差 = 该步真实墙钟耗时。
 *   - series[M][i]      = 第 i+1 步的指标值（数组下标 = 步号 − 1）。
 *   - timing_s/step[i]  = 该步"上报"耗时，只覆盖进程内计时，不含重启的等待与重跑。
 *   - events.json 里的 kind:"restart" 的 t = 新进程恢复运行的时刻（不是崩溃时刻）。
 *     依据：timeline 的 restarted_at 就等于该 t，且 step.since 从该 t 起算（差值逐点吻合）。
 *   - timeline.jsonl 的 step = status.json 的 step.last（最近"完成"的步），
 *     since / expected / progress / gen_frac 都是"当前进行中那一步"的字段；
 *     文件里每行是一行一次采集的快照，同一行内的字段属于同一时刻。
 *   - live.jsonl 的 latest 是采样器日志的最后一条，字段名看板未给官方说明，只用做旁证。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STORE = resolve(ROOT, "data", "store");
const OUT = resolve(ROOT, "analysis", "zh-CN", "numbers", "A3-pipeline-numbers.json");
const JSON_ONLY = process.argv.includes("--json");

const RUNS = ["pro", "flash"] as const;
type RunKey = (typeof RUNS)[number];

const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (v: number | null, d = 4) => (v === null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

/* ------------------------------------------------------------------ 统计 */

function mean(x: number[]): number | null {
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
}
function median(x: number[]): number | null {
  if (!x.length) return null;
  const s = [...x].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(x: number[]): number | null {
  if (x.length < 2) return null;
  const m = mean(x)!;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}
function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n))!, my = mean(y.slice(0, n))!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out = new Array(x.length).fill(0);
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
function spearman(x: number[], y: number[]): number | null {
  if (x.length < 3) return null;
  return pearson(ranks(x), ranks(y));
}
/** erf 的 A&S 7.1.26 近似，用来把 z 换成双侧 p 值（自算，不引库）。 */
function erfc(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return z >= 0 ? 1 - y : 1 + y;
}
/** Mann-Whitney U（正态近似 + 并列校正）。样本量很小，只当"显不显著"的参考。 */
function mannWhitney(a: number[], b: number[]): { U: number; z: number | null; p: number | null; n1: number; n2: number; rankBiserial: number } {
  const n1 = a.length, n2 = b.length;
  const all = [...a, ...b];
  const rg = ranks(all);
  const r1 = a.map((_, i) => rg[i]).reduce((s, v) => s + v, 0);
  const U = r1 - (n1 * (n1 + 1)) / 2;
  if (n1 < 2 || n2 < 2) return { U, z: null, p: null, n1, n2, rankBiserial: NaN };
  const mU = (n1 * n2) / 2;
  // 并列校正
  const cnt = new Map<number, number>();
  for (const v of all) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  let tie = 0;
  for (const c of cnt.values()) if (c > 1) tie += c ** 3 - c;
  const N = n1 + n2;
  const varU = ((n1 * n2) / 12) * (N + 1 - tie / (N * (N - 1)));
  const z = varU > 0 ? (U - mU) / Math.sqrt(varU) : null;
  const p = z === null ? null : erfc(Math.abs(z));
  return { U, z: r2(z, 3), p: r2(p, 4), n1, n2, rankBiserial: r2(2 * U / (n1 * n2) - 1, 3)! };
}
/** Cliff's delta：非参数效应量，[-1,1]，小样本比 p 值稳。 */
function cliffsDelta(a: number[], b: number[]): number | null {
  if (!a.length || !b.length) return null;
  let gt = 0, lt = 0;
  for (const x of a) for (const y of b) { if (x > y) gt++; else if (x < y) lt++; }
  return r2((gt - lt) / (a.length * b.length), 3);
}

/* ------------------------------------------------------------------ 载入 */

interface RunData {
  key: RunKey;
  steps: number[];
  walls: number[];
  runStart: number;
  series: Record<string, (number | null)[]>;
  status: any;
  events: any[];
  timeline: any[];
  live: any[];
  rate: number;
  now: number;
  end: number | null;
  mode: string;
  n: number;
}

function loadRun(key: RunKey): RunData {
  const dir = resolve(STORE, "runs", key);
  const axis = jread(resolve(dir, "axis.json"));
  const status = jread(resolve(dir, "status.json"));
  const timeline = readFileSync(resolve(dir, "timeline.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const live = readFileSync(resolve(dir, "live.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return {
    key,
    steps: axis.steps,
    walls: axis.walls,
    runStart: axis.run_start,
    series: jread(resolve(dir, "series.json")),
    status,
    events: jread(resolve(dir, "events.json")),
    timeline,
    live,
    rate: status.cost.rate_per_s,
    now: status.clock.now,
    end: status.run.end ?? null,
    mode: status.run.mode,
    n: axis.steps.length,
  };
}

/** series 取值；缺失/undefined 一律当 null，方便统计里整列跳过。 */
function col(R: RunData, name: string): (number | null)[] {
  const a = R.series[name];
  if (!a) return new Array(R.n).fill(null);
  return a.map((v: unknown) => (num(v) ? (v as number) : null));
}
/** 只要非空值的数组（配对的另外几列由调用方自己保证等长）。 */
function vals(a: (number | null)[]): number[] {
  return a.filter(num) as number[];
}

/* ------------------------------------------------------------------ 主体 */

const runs: Record<string, any> = {};
for (const key of RUNS) runs[key] = buildRun(loadRun(key));
const notices = jread(resolve(STORE, "notices.json"));
const cross = buildCross(runs, notices);

const out = {
  script: "src/pipeline_report.ts",
  run_cmd: "bun src/pipeline_report.ts",
  generated_at_utc: new Date().toISOString(),
  caliber: {
    real_step_seconds: "axis.walls 相邻两项之差；第 1 步用 axis.run_start 作起点。单位：秒。",
    reported_step_seconds: "series['timing_s/step']。进程内计时，不含重启等待与重跑。",
    gap_seconds: "real − reported。含三部分：(a) 崩溃前被丢弃的进度、(b) 崩溃到恢复之间的停机、(c) 恢复后到步计时器启动之间的开销。只有 (c) 可从数据直接量出。",
    cost_usd: "cost 字段口径为 rate_per_s × (now − run_start)；本文所有 $ 都是这一口径的推算，不是实测计费。",
    cpu_hours: "1 机时 = 1 秒墙钟 × rate_per_s 的费率折算；本文把机时统一说成墙钟小时，$ 由 rate 换算。",
    staleness_identity: "avg_staleness = Σ_k k × frac_k（k 为陈旧度桶号），已逐点验算。",
    bucket_frac: "partial/<k>/frac 是该桶在全部桶 token 里的占比，Σ frac = 1。",
    live_semantics: "live.jsonl 的 latest 字段（accept/judged/remain/prewarm_wait 等）看板未给官方说明，只作旁证，不参与结论计算。",
  },
  data_cut: dataCut(),
  cross,
  runs,
};

mkdirSync(resolve(OUT, ".."), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));

if (!JSON_ONLY) printSummary(out);

/** 数据切口：每个文件的同步时刻，避免"截至何时"说不清。 */
function dataCut(): any {
  const files = ["runs/pro/status.json", "runs/flash/status.json", "runs/pro/axis.json", "runs/flash/axis.json", "runs/pro/events.json", "runs/flash/events.json", "notices.json"];
  const out: any = {};
  for (const f of files) {
    const st = statSync(resolve(STORE, f));
    out[f] = { mtime_utc: st.mtime.toISOString(), bytes: st.size };
  }
  out["status.clock.now_utc"] = { pro: runs.pro.money.now_utc, flash: runs.flash.money.now_utc };
  return out;
}

/* ================================================================== 单 run */

function buildRun(R: RunData): any {
  const n = R.n;
  const S = (k: string) => col(R, k);

  /* --- 1. 真实步耗时 / 上报耗时 / 缺口 --- */
  const restarts = R.events.filter((e: any) => e.kind === "restart").map((e: any) => e.t as number).sort((a, b) => a - b);
  const stepsIn = R.events.filter((e: any) => e.kind === "step");

  const steps: any[] = [];
  let prevWall = R.runStart;
  for (let i = 0; i < n; i++) {
    const real = R.walls[i] - prevWall;
    const rep = S("timing_s/step")[i] as number;
    const lo = prevWall, hi = R.walls[i];
    const inWin = restarts.filter((t) => t > lo && t <= hi);
    // 该步内第一次完成过、后来又重跑的步（redo=true 的步，其第一次完成被丢弃）
    const redoSteps = stepsIn.filter((e: any) => e.redo === true && e.t > lo && e.t <= hi).map((e: any) => e.step);
    steps.push({
      step: R.steps[i],
      real_s: r2(real, 3),
      reported_s: r2(rep, 3),
      gap_s: r2(real - rep, 3),
      gap_frac: r2((real - rep) / real, 5),
      restarts_in_window: inWin.length,
      restart_times: inWin,
      redo_step_numbers: redoSteps,
      outer_gen_s: r2(S("timing_s/outer_gen")[i], 3),
      trainer_ops_s: r2(S("timing_s/trainer_ops")[i], 3),
      other_s: r2(rep - (S("timing_s/outer_gen")[i] as number) - (S("timing_s/trainer_ops")[i] as number), 3),
      other_frac_of_step: r2(
        (rep - (S("timing_s/outer_gen")[i] as number) - (S("timing_s/trainer_ops")[i] as number)) / rep,
        5,
      ),
      gen_frac_reported: r2((S("timing_s/outer_gen")[i] as number) / rep, 5),
      tokens_trained: S("perf/total_num_tokens")[i],
      env_active: S("env/active")[i],
      env_setup: S("env/total_setup")[i],
      env_error: S("env/total_error")[i],
      avg_staleness: S("partial/avg_staleness")[i],
      bucket_count: countBuckets(R, i),
      stale_tokens_ge3_frac: r2(staleShare(R, i, 3), 5),
      response_len_mean: S("ctx_response_length/mean")[i],
      turns_mean: S("dynsam/agg_turn/mean")[i],
      entropy_loss: S("actor/entropy_loss")[i],
      judge_time_total_mean_s: S("penalty/stage_credit_group/time_total_sec_mean")[i],
      judge_pod_setup_mean_s: S("penalty/stage_credit_group/time_pod_setup_sec_mean")[i],
      judge_pass1_mean_s: S("penalty/stage_credit_group/time_pass1_sec_mean")[i],
      judge_groups_total: S("penalty/stage_credit_group/groups_total")[i],
      judge_groups_attempted: S("penalty/stage_credit_group/groups_attempted")[i],
      cost_usd_this_step: r2(real * R.rate, 2),
      cost_usd_cum: r2((R.walls[i] - R.runStart) * R.rate, 2),
      tokens_cum: cumSum(S("perf/total_num_tokens")).at(-1)!,
    });
    prevWall = R.walls[i];
  }
  // tokens_cum 按步累计
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (S("perf/total_num_tokens")[i] as number) ?? 0;
    steps[i].tokens_cum = r2(acc, 0);
    steps[i].usd_per_billion_tokens_cum = r2(steps[i].cost_usd_cum / (acc / 1e9), 1);
    steps[i].usd_per_billion_tokens_step = r2(
      steps[i].cost_usd_this_step / ((S("perf/total_num_tokens")[i] as number) / 1e9),
      1,
    );
  }

  /* --- 2. 缺口归因 ---
     恒等关系（每步都能逐位对上）：
       gap = (上一步完成 → 最后一次重启) + (最后一次重启 → 本步完成) − 本步上报耗时
     前一项里含"崩溃前被丢弃的进度 + 崩溃到恢复的停机"（不可分），
     后一项减上报就是"恢复后到步计时器启动"的开销（可量出）。 */
  const wallBefore = (i: number) => (i === 0 ? R.runStart : R.walls[i - 1]);
  const gapAttr = steps
    .map((s, i) => {
      if (!s.restarts_in_window) return null;
      const lo = wallBefore(i), hi = R.walls[i];
      const ts: number[] = s.restart_times;
      const last = ts[ts.length - 1];
      const beforeLast = last - lo;
      const tail = hi - last;
      const tailUncounted = tail - s.reported_s;
      // betweenRestarts：新进程恢复后又在同一个步的窗口内二次崩溃的时间跨度（工作 or 停机不可分）
      const between: number[] = [];
      for (let k = 1; k < ts.length; k++) between.push(ts[k] - ts[k - 1]);
      // 被丢弃的已完成步 + 崩溃前那段没计入的进度
      const discarded = discardedWork(R, lo, last, hi);
      return {
        step: s.step,
        real_s: s.real_s,
        reported_s: s.reported_s,
        gap_s: s.gap_s,
        n_restarts: ts.length,
        span_before_last_restart_s: r2(beforeLast, 3),
        between_restarts_s: between.map((v) => r2(v, 3)),
        tail_after_last_restart_s: r2(tail, 3),
        tail_minus_reported_s: r2(tailUncounted, 3),
        reconstructed_gap_s: r2(beforeLast + tailUncounted, 3),
        identity_error_s: r2(Math.abs(beforeLast + tailUncounted - (s.real_s - s.reported_s)), 6),
        discarded_completed_steps: discarded.completed,
        discarded_completed_steps_total_s: r2(discarded.completedSeconds, 3),
        partial_progress_before_crash_s: r2(discarded.partialSeconds, 3),
        confirmed_thrown_away_s: r2(discarded.completedSeconds + discarded.partialSeconds, 3),
        span_mixed_work_or_downtime_s: r2(beforeLast - discarded.completedSeconds - discarded.partialSeconds, 3),
      };
    })
    .filter(Boolean);

  /* --- 3. 上报耗时内部拆分 --- */
  const otherSeries = steps.map((s) => s.other_s as number);
  const reported = steps.map((s) => s.reported_s as number);
  const realSeries = steps.map((s) => s.real_s as number);
  const tokSeries = steps.map((s) => s.tokens_trained as number);
  const otherSplit = {
    other_s: { min: r2(Math.min(...otherSeries), 2), max: r2(Math.max(...otherSeries), 2), mean: r2(mean(otherSeries)!, 2), median: r2(median(otherSeries)!, 2) },
    other_frac_of_reported: {
      min: r2(Math.min(...steps.map((s) => s.other_frac_of_step)), 5),
      max: r2(Math.max(...steps.map((s) => s.other_frac_of_step)), 5),
      mean: r2(mean(steps.map((s) => s.other_frac_of_step)), 5),
    },
    reported_sum_s: r2(reported.reduce((a, b) => a + b, 0), 2),
    outer_plus_trainer_sum_s: r2(
      steps.reduce((a, s) => a + (s.outer_gen_s as number) + (s.trainer_ops_s as number), 0),
      2,
    ),
    other_sum_s: r2(otherSeries.reduce((a, b) => a + b, 0), 2),
    corr_other_vs_tokens: r2(pearson(otherSeries, tokSeries)),
    corr_other_vs_reported: r2(pearson(otherSeries, reported)),
    corr_other_vs_real: r2(pearson(otherSeries, realSeries)),
    // 候选对应物（同一步的量级对照）
    candidates: {
      judge_time_total_mean_s: r2(median(vals(S("penalty/stage_credit_group/time_total_sec_mean")))!, 2),
      judge_pod_setup_mean_s: r2(median(vals(S("penalty/stage_credit_group/time_pod_setup_sec_mean")))!, 2),
      drain_wait_seconds: { min: r2(Math.min(...vals(S("train/trace/drain_wait_seconds"))), 3), max: r2(Math.max(...vals(S("train/trace/drain_wait_seconds"))), 3) },
      outcome_write_seconds: { min: r2(Math.min(...vals(S("train/trace/outcome_write_seconds"))), 4), max: r2(Math.max(...vals(S("train/trace/outcome_write_seconds"))), 4) },
      env_setup_delta_median_clean_steps: r2(median(cleanSetupDeltas(R)), 0),
      env_setup_delta_note: "只用'本步与其前一步都没有重启'的步，避开计数器复位造成的虚高。",
    },
    verifiable: {
      outer_plus_trainer_le_reported_all_steps: steps.every(
        (s) => (s.outer_gen_s as number) + (s.trainer_ops_s as number) <= s.reported_s + 1e-6,
      ),
    },
  };

  /* --- 4. Little 定律（沙箱并发） --- */
  const little = littleLaw(R, steps);

  /* --- 5. 陈旧度链 --- */
  const staleness = stalenessChain(R, steps);

  /* --- 6. 背压 --- */
  const bpKeys = [
    "train/trace/backpressure_waits",
    "train/trace/backpressure_wait_seconds_sum",
    "train/trace/backpressure_wait_seconds_max",
    "train/trace/orphan_resolves",
    "train/trace/failed_writes",
    "train/trace/terminal_conflicts",
  ];
  const bp: any = {};
  for (const k of bpKeys) {
    const v = vals(S(k));
    bp[k] = { n_nonnull: v.length, n_nonzero: v.filter((x) => x !== 0).length, max: v.length ? Math.max(...v) : null };
  }
  for (const k of ["train/trace/drain_wait_seconds", "train/trace/late_finishes", "train/trace/outcome_write_seconds", "train/trace/writer_seconds_max", "train/trace/writer_seconds_sum", "train/trace/records", "train/trace/files"]) {
    const v = vals(S(k));
    bp[k] = { min: r2(Math.min(...v), 4), median: r2(median(v)!, 4), max: r2(Math.max(...v), 4) };
  }

  /* --- 7. 钱 --- */
  const totalBill = R.rate * ((R.end ?? R.now) - R.runStart);
  const gapTotal = steps.reduce((a, s) => a + (s.gap_s as number), 0);
  const billedSeconds = (R.end ?? R.now) - R.runStart;
  const reportedSum = steps.reduce((a, s) => a + (s.reported_s as number), 0);
  const cleanSteps = steps.filter((s) => (s.restarts_in_window as number) === 0);
  const fc = cleanSteps[0], lc = cleanSteps[cleanSteps.length - 1];
  const money = {
    rate_per_s: R.rate,
    run_start_utc: new Date(R.runStart * 1000).toISOString(),
    end_utc: R.end ? new Date(R.end * 1000).toISOString() : null,
    meter_stops_at_end: R.end ? Math.abs(R.status.cost.so_far / R.rate - (R.end - R.runStart)) < 1 : null,
    cost_so_far_usd: r2(R.status.cost.so_far, 2),
    cost_so_far_div_rate_s: r2(R.status.cost.so_far / R.rate, 1),
    now_utc: new Date(R.now * 1000).toISOString(),
    now_minus_start_s: r2(R.now - R.runStart, 1),
    end_minus_start_s: R.end ? r2(R.end - R.runStart, 1) : null,
    billed_seconds_used: r2(billedSeconds, 1),
    last_step_wall_s: r2(R.walls[n - 1] - R.runStart, 1),
    total_bill_usd: r2(totalBill, 2),
    // 三种"没记进 timing_s/step 的时间"口径全部列出，避免混用
    gap_def_A_walls_minus_reported_s: r2(gapTotal, 3),
    gap_def_A_h: r2(gapTotal / 3600, 3),
    gap_def_A_usd: r2(gapTotal * R.rate, 2),
    gap_def_A_pct_of_bill: r2((gapTotal * R.rate) / totalBill, 5),
    gap_def_A_pct_of_real_sum: r2(gapTotal / realSeries.reduce((a, b) => a + b, 0), 5),
    gap_def_B_billed_minus_reported_s: r2(billedSeconds - reportedSum, 3),
    gap_def_B_h: r2((billedSeconds - reportedSum) / 3600, 3),
    gap_def_B_usd: r2((billedSeconds - reportedSum) * R.rate, 2),
    gap_def_B_pct_of_bill: r2(((billedSeconds - reportedSum) * R.rate) / totalBill, 5),
    reported_sum_h: r2(reportedSum / 3600, 3),
    real_sum_h: r2(realSeries.reduce((a, b) => a + b, 0) / 3600, 3),
    unaccounted_vs_now_h: r2((R.now - R.runStart - reportedSum) / 3600, 3),
    unaccounted_vs_now_usd: r2((R.now - R.runStart - reportedSum) * R.rate, 2),
    cost_per_step_usd: {
      first: steps[0].cost_usd_this_step,
      last: steps[n - 1].cost_usd_this_step,
      mean: r2(mean(steps.map((s) => s.cost_usd_this_step)), 2),
      median_clean_steps: r2(median(cleanSteps.map((s) => s.cost_usd_this_step as number))!, 2),
      trend_vs_step_r: r2(pearson(steps.map((s) => s.step), steps.map((s) => s.cost_usd_this_step))),
    },
    real_step_h: {
      first_clean: fc ? r2((fc.real_s as number) / 3600, 3) : null,
      last_clean: lc ? r2((lc.real_s as number) / 3600, 3) : null,
      median_clean_steps: r2(median(cleanSteps.map((s) => (s.real_s as number) / 3600))!, 3),
      trend_vs_step_r_clean: r2(pearson(cleanSteps.map((s) => s.step), cleanSteps.map((s) => (s.real_s as number) / 3600))),
    },
    usd_per_billion_tokens_cum: {
      first: steps[0].usd_per_billion_tokens_cum,
      last: steps[n - 1].usd_per_billion_tokens_cum,
      trend_vs_step_r: r2(pearson(steps.map((s) => s.step), steps.map((s) => s.usd_per_billion_tokens_cum))),
    },
    usd_per_billion_tokens_per_step: {
      first: steps[0].usd_per_billion_tokens_step,
      last: steps[n - 1].usd_per_billion_tokens_step,
      median: r2(median(steps.map((s) => s.usd_per_billion_tokens_step))!, 1),
      median_clean_steps: r2(median(cleanSteps.map((s) => s.usd_per_billion_tokens_step as number))!, 1),
      trend_vs_step_r: r2(pearson(steps.map((s) => s.step), steps.map((s) => s.usd_per_billion_tokens_step))),
      trend_vs_step_r_clean: r2(pearson(cleanSteps.map((s) => s.step), cleanSteps.map((s) => s.usd_per_billion_tokens_step as number))),
    },
    tokens_cum_billion: r2(steps[n - 1].tokens_cum / 1e9, 4),
    clean_steps_only: {
      n: cleanSteps.length,
      sum_real_h: r2(cleanSteps.reduce((a, s) => a + (s.real_s as number), 0) / 3600, 3),
      sum_tokens_billion: r2(cleanSteps.reduce((a, s) => a + (s.tokens_trained as number), 0) / 1e9, 4),
      usd_per_billion_tokens: r2(
        (cleanSteps.reduce((a, s) => a + (s.real_s as number), 0) * R.rate) /
          (cleanSteps.reduce((a, s) => a + (s.tokens_trained as number), 0) / 1e9),
        1,
      ),
      note: "只用无重启的步算，剔掉被重启污染的步。",
    },
    judge_concurrency_estimate: judgeConcurrency(R, steps),
    judge_wall_share_of_grading: r2(
      median(vals(S("penalty/stage_credit_group/time_pass1_sec_mean")))! /
        median(vals(S("penalty/stage_credit_group/time_total_sec_mean")))!,
      4,
    ),
  };

  /* --- 8. 重启画像 --- */
  const restartProfile = restartPortrait(R, steps, restarts);

  /* --- 9. 步内进度字段可信度 --- */
  const progressFields = progressFieldAudit(R, steps);

  /* --- 10. 同一步的进度轨迹还原 --- */
  const trajectories = reconstructTrajectories(R, steps);

  return {
    run: R.key,
    n_steps: n,
    steps,
    gap_attribution: gapAttr,
    othersplit: otherSplit,
    little_law: little,
    staleness_chain: staleness,
    backpressure: bp,
    money,
    restart_profile: restartProfile,
    progress_fields: progressFields,
    trajectories,
    env_active_jump: envActiveJump(R),
  };
}

/** 干净步（本步与前一步都无重启）的 env/total_setup 单步增量。 */
function cleanSetupDeltas(R: RunData): number[] {
  const v = col(R, "env/total_setup");
  const act = col(R, "env/active");
  const restartWin = new Set<number>();
  let prev = R.runStart;
  for (let i = 0; i < R.n; i++) {
    const lo = prev, hi = R.walls[i];
    if (R.events.some((e: any) => e.kind === "restart" && e.t > lo && e.t <= hi)) restartWin.add(R.steps[i]);
    prev = hi;
  }
  const out: number[] = [];
  for (let i = 1; i < R.n; i++) {
    if (restartWin.has(R.steps[i]) || restartWin.has(R.steps[i - 1])) continue;
    if (Math.abs((v[i] as number) - (act[i] as number)) < 1) continue;
    const d = (v[i] as number) - (v[i - 1] as number);
    if (d > 0) out.push(d);
  }
  return out;
}

function cumSum(a: (number | null)[]): number[] {
  let s = 0;
  return a.map((v) => (s += v ?? 0));
}

/**
 * 找出"崩溃前被丢掉的工作"。
 * 入口：events.json 里出现两次的 step（第二次带 redo=true）说明第一次跑完又被重跑。
 * 返回：completed = 那些整步跑完却作废的步（用相邻 step 事件时间戳之差算耗时）；
 *       partialSeconds = 被重跑的起点之前、最后一次 step 事件到重启之间的那段（部分进度，已丢弃）。
 */
function discardedWork(R: RunData, lo: number, lastRestart: number, hi: number): { completed: any[]; completedSeconds: number; partialSeconds: number } {
  const evs = R.events.filter((e: any) => e.kind === "step" && e.t > lo && e.t <= hi);
  const redoNums = new Set(evs.filter((e: any) => e.redo === true).map((e: any) => e.step));
  const completed: any[] = [];
  if (redoNums.size) {
    const sMin = Math.min(...redoNums);
    // 整段事件序列（含本窗口之前），用于给"第一次尝试"找起点
    const all = R.events.filter((e: any) => e.kind === "step").sort((a: any, b: any) => a.t - b.t);
    const firstIdx = all.findIndex((e: any) => e.step === sMin && e.redo !== true && e.t > lo);
    if (firstIdx > 0) {
      for (let k = firstIdx; k < all.length; k++) {
        const e = all[k];
        if (e.t >= lastRestart) break;
        const p = all[k - 1];
        completed.push({ step: e.step, from: p.t, to: e.t, span_s: r2(e.t - p.t, 3), prev_step: p.step });
      }
    }
  }
  const completedSeconds = completed.reduce((a, b) => a + b.span_s, 0);
  const beforeRestart = R.events.filter((e: any) => e.kind === "step" && e.t > lo && e.t < lastRestart).sort((a: any, b: any) => a.t - b.t);
  const lastEv = beforeRestart.length ? beforeRestart[beforeRestart.length - 1] : null;
  const lastEvInWin = R.events.filter((e: any) => e.kind === "step" && e.t > lo && e.t <= hi).sort((a: any, b: any) => a.t - b.t);
  const partialSeconds = lastEv ? lastRestart - lastEv.t : lastEvInWin.length ? 0 : lastRestart - lo;
  return { completed, completedSeconds, partialSeconds };
}

function countBuckets(R: RunData, i: number): number {
  let c = 0;
  for (let k = 0; k < 12; k++) {
    const f = R.series[`partial/${k}/frac`];
    if (f && num(f[i]) && (f[i] as number) > 0) c++;
  }
  return c;
}
function staleShare(R: RunData, i: number, ge: number): number | null {
  let s = 0, any = false;
  for (let k = ge; k < 12; k++) {
    const f = R.series[`partial/${k}/frac`];
    if (f && num(f[i])) { s += f[i] as number; any = true; }
  }
  return any ? s : null;
}
/** 每步"新起的沙箱数"：区间内累计计数的增量；重启步的计数器会复位，记 null。 */
function setupDelta(R: RunData): number[] {
  const v = col(R, "env/total_setup").map((x) => x ?? 0);
  const act = col(R, "env/active").map((x) => x ?? 0);
  const out: number[] = [];
  for (let i = 0; i < R.n; i++) {
    if (i === 0) { out.push(NaN); continue; }
    const d = v[i] - v[i - 1];
    // 复位判据：当步 setup 恰好等于当步 active（看板口径：重启后累计计数回到水位）
    if (Math.abs(v[i] - act[i]) < 1) { out.push(NaN); continue; }
    out.push(d > 0 ? d : NaN);
  }
  return out;
}

/* ------------------------------------------------------ Little 定律 */

function littleLaw(R: RunData, steps: any[]): any {
  const setup = col(R, "env/total_setup");
  const act = col(R, "env/active");
  const restarts = R.events.filter((e: any) => e.kind === "restart").map((e: any) => e.t as number).sort((a, b) => a - b);
  // 复位步：该步快照里 env/total_setup 恰好等于 env/active（看板口径：重启后累计计数回到水位）
  const isReset: boolean[] = [];
  for (let i = 0; i < R.n; i++) isReset.push(Math.abs((setup[i] as number) - (act[i] as number)) < 1);
  const bounds = R.steps.map((_, i) => i).filter((i) => isReset[i]);
  if (!bounds.length || bounds[0] !== 0) bounds.unshift(0);
  const rows: any[] = [];
  for (let b = 0; b < bounds.length; b++) {
    const i0 = bounds[b];
    const i1 = b + 1 < bounds.length ? bounds[b + 1] - 1 : R.n - 1;
    if (i1 < i0) continue;
    const wallEnd = R.walls[i1];
    const prevBreak = i0 === 0 ? R.runStart : R.walls[i0 - 1];
    const rsIn = restarts.filter((t) => t > prevBreak && t <= wallEnd);
    const tReset = rsIn.length ? rsIn[rsIn.length - 1] : R.runStart;
    const seconds = wallEnd - tReset;
    const created = setup[i1] as number; // 自复位以来的累计创建数
    const L = mean(vals(act.slice(i0, i1 + 1)))!;
    const lambda = created / seconds;
    rows.push({
      steps_from: R.steps[i0],
      steps_to: R.steps[i1],
      n_steps_in_segment: i1 - i0 + 1,
      reset_step: R.steps[i0],
      reset_moment_utc: new Date(tReset * 1000).toISOString(),
      seconds_since_reset: r2(seconds, 1),
      sandboxes_created_since_reset: created,
      lambda_per_s: r2(lambda, 4),
      L_active_mean: r2(L, 1),
      W_seconds: r2(L / lambda, 1),
      W_hours: r2(L / lambda / 3600, 3),
      turnover_per_slot_per_step: r2(created / L / (i1 - i0 + 1), 3),
      reliable: i1 - i0 + 1 >= 3,
    });
  }
  const rel = rows.filter((r) => r.reliable);
  const totalCreated = rows.reduce((a, r) => a + r.sandboxes_created_since_reset, 0);
  const totalSeconds = rows.reduce((a, r) => a + r.seconds_since_reset, 0);
  const wAvgL = rows.reduce((a, r) => a + r.L_active_mean * r.seconds_since_reset, 0) / totalSeconds;
  const wAll = wAvgL / (totalCreated / totalSeconds);
  return {
    definition: "Little 定律 L = λ·W。L = env/active（在飞沙箱均值）；λ = 复位以来累计创建的沙箱数 / 复位以来的墙钟秒数；W = 隐含平均沙箱存活时间。复位时刻 = 该段内最后一次 restart 事件的时间戳。",
    segments: rows,
    reliable_segments: rel,
    aggregate: {
      total_sandboxes_created: totalCreated,
      total_seconds: r2(totalSeconds, 1),
      lambda_per_s: r2(totalCreated / totalSeconds, 4),
      L_weighted_mean: r2(wAvgL, 1),
      W_seconds: r2(wAll, 1),
      W_hours: r2(wAll / 3600, 3),
    },
    W_hours_median_reliable: rel.length ? r2(median(rel.map((r) => r.W_hours))!, 3) : null,
    turnover_median_reliable: rel.length ? r2(median(rel.map((r) => r.turnover_per_slot_per_step))!, 3) : null,
    naive_cumulative_reading: rows.map((r) => ({
      segment: r.steps_from + "-" + r.steps_to,
      n_steps: r.n_steps_in_segment,
      cumulative_setup_over_active: r2(r.sandboxes_created_since_reset / r.L_active_mean, 3),
      divided_by_steps: r2(r.sandboxes_created_since_reset / r.L_active_mean / r.n_steps_in_segment, 3),
    })),
    naive_note: "看板常见读法 'env/total_setup ÷ env/active' 给的是段内累计翻台次数，不是每步翻台率；除以步数才是每步翻台。",
    cross_check_pod_setup: {
      judge_pod_setup_mean_s: r2(median(vals(col(R, "penalty/stage_credit_group/time_pod_setup_sec_mean")))!, 2),
      note: "判分侧 pod setup 只是判分流程里的一小段（每组十几秒）；沙箱存活时间含整条 agentic 轨迹（上千秒），两者不是同一个量，不能直接对上。",
    },
  };
}

/* ------------------------------------------------------ 陈旧度链 */

function stalenessChain(R: RunData, steps: any[]): any {
  const st = steps.map((s) => s.avg_staleness as number);
  const real = steps.map((s) => s.real_s as number);
  const rep = steps.map((s) => s.reported_s as number);
  const len = steps.map((s) => s.response_len_mean as number);
  const tok = steps.map((s) => s.tokens_trained as number);
  const bc = steps.map((s) => s.bucket_count as number);
  const staleTok = steps.map((s) => s.stale_tokens_ge3_frac as number | null);
  // 段内位置（自上次重启后第几步）
  const pos: number[] = [];
  let p = 0;
  for (let i = 0; i < R.n; i++) {
    if (i === 0 || (steps[i].restarts_in_window as number) > 0) p = 0; else p++;
    pos.push(p);
  }
  // 段内相关性：剔掉重启步本身（重启会让陈旧度归零）
  const keep = steps.map((s, i) => i).filter((i) => (steps[i].restarts_in_window as number) === 0 && st[i] > 0);
  const g = (a: number[]) => keep.map((i) => a[i]);
  const consistency = steps.map((s, i) => {
    let sum = 0;
    for (let k = 0; k < 12; k++) {
      const f = R.series[`partial/${k}/frac`];
      if (f && num(f[i])) sum += k * (f[i] as number);
    }
    return sum;
  });
  const identityErr = steps.map((s, i) => Math.abs(consistency[i] - st[i]));
  return {
    identity_check: {
      formula: "Σ_k k×frac_k",
      max_abs_error: r2(Math.max(...identityErr), 8),
      note: "逐点验算，等于 avg_staleness（机械恒等，不是发现）。",
    },
    within_segment: {
      n_used: keep.length,
      corr_staleness_vs_segment_pos: r2(spearman(g(st), g(pos))),
      corr_staleness_vs_real_step_s: r2(spearman(g(st), g(real))),
      corr_staleness_vs_reported_step_s: r2(spearman(g(st), g(rep))),
      corr_staleness_vs_response_len: r2(spearman(g(st), g(len))),
      corr_staleness_vs_tokens: r2(spearman(g(st), g(tok))),
      corr_staleness_vs_bucket_count: r2(spearman(g(st), g(bc))),
      corr_bucket_count_vs_segment_pos: r2(spearman(g(bc), g(pos))),
    },
    all_steps: {
      corr_staleness_vs_real_step_s: r2(spearman(st, real)),
      corr_staleness_vs_response_len: r2(spearman(st, len)),
      corr_staleness_vs_tokens: r2(spearman(st, tok)),
    },
    per_step: steps.map((s, i) => ({ step: s.step, avg_staleness: r2(st[i], 4), bucket_count: bc[i], stale_ge3_frac: r2(staleTok[i] as number, 4), segment_pos: pos[i], real_s: s.real_s })),
    bucket_token_sum_vs_total: tokenReconcile(R),
  };
}

/** 桶 n_tokens 之和 vs perf/total_num_tokens —— 对不上的话如实报出来。 */
function tokenReconcile(R: RunData): any {
  const rows: any[] = [];
  for (let i = 0; i < R.n; i++) {
    let s = 0, any = false;
    for (let k = 0; k < 12; k++) {
      const a = R.series[`partial/${k}/n_tokens`];
      if (a && num(a[i])) { s += a[i] as number; any = true; }
    }
    const tot = R.series["perf/total_num_tokens"][i];
    if (any && num(tot)) rows.push({ step: R.steps[i], sum_bucket_n_tokens: r2(s, 0), total_num_tokens: r2(tot, 0), ratio: r2(s / (tot as number), 4) });
  }
  const rs = rows.map((r) => r.ratio);
  return { ratio_min: r2(Math.min(...rs), 4), ratio_median: r2(median(rs)!, 4), ratio_max: r2(Math.max(...rs), 4), note: "桶 token 之和与 perf/total_num_tokens 不成 1:1，看板未给口径，本文不据此下结论。", rows: rows.slice(0, 3) };
}

/* ------------------------------------------------------ 判分并发 */

function judgeConcurrency(R: RunData, steps: any[]): any {
  const rows = steps.map((s) => {
    const g = (s.judge_groups_total as number) ?? null;
    const ga = (s.judge_groups_attempted as number) ?? null;
    const t = s.judge_time_total_mean_s as number;
    return g && t ? { step: s.step, groups_total: g, groups_attempted: ga, concurrent_groups_from_total: r2((g * t) / s.real_s, 1), concurrent_groups_from_attempted: ga ? r2((ga * t) / s.real_s, 1) : null } : null;
  }).filter(Boolean);
  return {
    definition: "并发判分组数 ≈ 每步 group 数 × 每组判分墙钟 / 该步真实墙钟。前提：假定 group 在步内均匀到达、且判分与训练在不同资源池上并行。",
    rows,
    median_concurrent_groups_from_total: r2(median(rows.map((r: any) => r.concurrent_groups_from_total))!, 1),
    median_concurrent_groups_from_attempted: r2(median(rows.filter((r: any) => r.concurrent_groups_from_attempted !== null).map((r: any) => r.concurrent_groups_from_attempted))!, 1),
    dollar_share: null,
    dollar_share_note: "判分集群的 $/s 费率不在数据里（cost 只有一个全局 rate_per_s），因此判分算力占总账单的百分比估不出来。",
  };
}

/* ------------------------------------------------------ 重启画像 */

function restartPortrait(R: RunData, steps: any[], restarts: number[]): any {
  const intervals = restarts.slice(1).map((t, i) => t - restarts[i]);
  const spanH = (R.walls[R.n - 1] - R.runStart) / 3600;
  // 重启落在哪一步
  const wallBefore = (i: number) => (i === 0 ? R.runStart : R.walls[i - 1]);
  const stepOf = (t: number) => {
    for (let i = 0; i < R.n; i++) if (t > wallBefore(i) && t <= R.walls[i]) return R.steps[i];
    return null;
  };
  const list = restarts.map((t, k) => ({
    idx: k + 1,
    t,
    utc: new Date(t * 1000).toISOString(),
    hours_since_run_start: r2((t - R.runStart) / 3600, 2),
    step_interrupted: stepOf(t),
    hours_since_prev_restart: k === 0 ? null : r2((t - restarts[k - 1]) / 3600, 2),
  }));
  // 特征对比：以"被重启打断的那一步的前一步"为样本（n 很小）
  const featKeys: [string, string][] = [
    ["ctx_response_length/mean", "平均生成长度"],
    ["perf/total_num_tokens", "本步训练 token"],
    ["dynsam/agg_turn/mean", "平均回合数"],
    ["penalty/stage_credit_group/time_total_sec_mean", "判分每组耗时"],
    ["env/active", "在飞沙箱"],
    ["actor/entropy_loss", "策略熵"],
    ["timing_s/step", "上报步耗时"],
  ];
  const interruptedSteps = new Set<number>();
  list.forEach((l) => { if (l.step_interrupted !== null && l.step_interrupted > 1) interruptedSteps.add(l.step_interrupted); });
  const testRows: any[] = [];
  for (const [k, label] of featKeys) {
    const arr = col(R, k);
    const A: number[] = [], B: number[] = [];
    for (let i = 0; i < R.n; i++) {
      const prevStep = R.steps[i] + 1; // 第 i 步的"后一步"；用于判断第 i 步是不是某次重启的前一步
      void prevStep;
    }
    for (let i = 0; i < R.n; i++) {
      const v = arr[i];
      if (!num(v)) continue;
      // 第 i 步（1-based 步号 R.steps[i]）的后继步是否被重启打断
      const nextStep = R.steps[i] + 1;
      if (interruptedSteps.has(nextStep)) A.push(v as number); else B.push(v as number);
    }
    const mw = mannWhitney(A, B);
    testRows.push({
      metric: k,
      label,
      n_before_restart: A.length,
      median_before_restart: r2(median(A), 4),
      n_other: B.length,
      median_other: r2(median(B), 4),
      cliffs_delta: cliffsDelta(A, B),
      mannwhitney_p: mw.p,
      significant_at_0_05: mw.p !== null ? mw.p < 0.05 : null,
    });
  }
  return {
    n_restarts: restarts.length,
    mtbf_h: r2(spanH / restarts.length, 2),
    mtbf_h_excl_first_4: restarts.length > 4 ? r2((spanH - (restarts[3] - R.runStart) / 3600) / (restarts.length - 4), 2) : null,
    mtbf_h_excl_first_4_n_intervals: restarts.length - 4,
    median_interval_h: r2(median(intervals)! / 3600, 2),
    interval_min_h: r2(Math.min(...intervals) / 3600, 2),
    interval_max_h: r2(Math.max(...intervals) / 3600, 2),
    interval_trend_spearman: r2(spearman(intervals.map((_, i) => i + 1), intervals)),
    interval_trend_n: intervals.length,
    interval_first_half_median_h: r2(median(intervals.slice(0, Math.floor(intervals.length / 2)))! / 3600, 2),
    interval_second_half_median_h: r2(median(intervals.slice(Math.ceil(intervals.length / 2)))! / 3600, 2),
    intervals_h: intervals.map((v) => r2(v / 3600, 2)),
    list,
    condition_test: {
      definition: "对比：'某次重启打断的那一步的前一步' vs '其余步'。样本量极小（重启 11/5 次），只报效应量与显著性，不下结论。",
      rows: testRows,
    },
  };
}

/* ------------------------------------------------------ 步内进度字段 */

function progressFieldAudit(R: RunData, steps: any[]): any {
  const tl = R.timeline;
  // 口径 A：progress 是否等于 since/expected
  const progErr = tl.filter((d) => num(d.since) && num(d.expected) && num(d.progress))
    .map((d) => Math.abs(Math.min(1, d.since / d.expected) - d.progress));
  // 口径 B：expected 是否等于"最近 3 个已完成步的上报耗时之中位数"（滚动 3 中位）
  const rep = col(R, "timing_s/step");
  const med3 = (uptoStep: number) => {
    const a: number[] = [];
    for (let s = Math.max(1, uptoStep - 2); s <= uptoStep; s++) if (num(rep[s - 1])) a.push(rep[s - 1] as number);
    return a.length ? median(a) : null;
  };
  const expMatch: any[] = [];
  let expOk = 0, expTot = 0;
  for (const d of tl) {
    if (!num(d.expected) || !num(d.step)) continue;
    const lc = d.step; // 已经完成的步号
    const cand = med3(lc);
    if (cand === null) continue;
    expTot++;
    const ok = Math.abs(cand - d.expected) < 0.05;
    if (ok) expOk++;
    expMatch.push({ captured: d.captured, last_completed_step: lc, current_step: lc + 1, expected_field: r2(d.expected, 2), rolling3_median_reported_s: r2(cand, 2), match: ok });
  }
  // 口径 C：gen_frac 是否等于"上一步的 outer_gen / 上一步的 reported"
  const og = col(R, "timing_s/outer_gen");
  const genMatch: any[] = [];
  let genOk = 0, genTot = 0;
  for (const d of tl) {
    if (!num(d.gen_frac) || !num(d.step)) continue;
    const lc = d.step;
    if (!num(og[lc - 1]) || !num(rep[lc - 1])) continue;
    genTot++;
    const v = (og[lc - 1] as number) / (rep[lc - 1] as number);
    const ok = Math.abs(v - d.gen_frac) < 1e-3;
    if (ok) genOk++;
    genMatch.push({ captured: d.captured, last_completed_step: lc, gen_frac_field: r2(d.gen_frac, 6), prev_outer_over_prev_step: r2(v, 6), match: ok });
  }
  // expected 偏差：expected(=最近 3 步上报中位) vs 当前步的真实耗时
  const bias: any[] = [];
  for (let i = 1; i < R.n; i++) {
    const expct = med3(R.steps[i] - 1); // 进入第 i 步时，已完成到 i-1
    if (expct === null) continue;
    bias.push({
      step: R.steps[i],
      expected_s: r2(expct, 2),
      real_s: steps[i].real_s,
      reported_s: steps[i].reported_s,
      optimism_vs_real: r2((expct - (steps[i].real_s as number)) / (steps[i].real_s as number), 4),
      optimism_vs_reported: r2((expct - (steps[i].reported_s as number)) / (steps[i].reported_s as number), 4),
      step_in_window_has_restart: (steps[i].restarts_in_window as number) > 0,
    });
  }
  const clean = bias.filter((b) => !b.step_in_window_has_restart);
  return {
    progress_identity: {
      formula: "progress = min(1, since / expected)",
      n_checked: progErr.length,
      max_abs_error: progErr.length ? r2(Math.max(...progErr), 8) : null,
      note: "progress 不是独立观测量，是 since/expected 的派生值。",
    },
    expected_identity: {
      formula: "expected = 最近 3 个已完成步的上报 timing_s/step 的中位数（滚动 3 中位，进入当前步时冻结）",
      n_checked: expTot,
      n_match: expOk,
      ratio_match: expTot ? r2(expOk / expTot, 4) : null,
      examples: expMatch.slice(0, 4),
    },
    gen_frac_identity: {
      formula: "gen_frac = 上一步的 outer_gen / 上一步的上报 timing_s/step（整步内冻结，不随步内进度变化）",
      n_checked: genTot,
      n_match: genOk,
      ratio_match: genTot ? r2(genOk / genTot, 4) : null,
      examples: genMatch.slice(0, 4),
    },
    expected_bias: {
      n_total: bias.length,
      n_clean_steps: clean.length,
      median_optimism_clean_vs_reported: r2(median(clean.map((b) => b.optimism_vs_reported))!, 4),
      median_optimism_clean_vs_real: r2(median(clean.map((b) => b.optimism_vs_real))!, 4),
      note: "expected 只在步变长时偏乐观（用上一步的实际时长预测下一步），步变短时反过来偏悲观。",
      rows: bias,
    },
    live_fields: {
      note: "live.jsonl 的字段看板未说明。这里只记录范围，不参与计算。",
      remain_seq: range(R.live.map((d) => d.latest?.remain_seq)),
      prewarm_wait: range(R.live.map((d) => d.latest?.prewarm_wait)),
      prewarm: range(R.live.map((d) => d.latest?.prewarm)),
      target: [...new Set(R.live.map((d) => d.latest?.target))],
    },
  };
}
function range(a: any[]): any {
  const v = a.filter(num) as number[];
  return v.length ? { min: r2(Math.min(...v), 1), median: r2(median(v)!, 1), max: r2(Math.max(...v), 1) } : null;
}

/* ------------------------------------------------------ 单步进度轨迹还原 */

function reconstructTrajectories(R: RunData, steps: any[]): any[] {
  // 按 timeline 的 step 分组：同一 step 值下、since 递增的一段，就是"下一步"的步内轨迹
  const byStep = new Map<number, any[]>();
  for (const d of R.timeline) {
    if (!num(d.step)) continue;
    const cur = d.step + 1;
    if (!byStep.has(cur)) byStep.set(cur, []);
    byStep.get(cur)!.push(d);
  }
  const out: any[] = [];
  for (const [cur, arrRaw] of byStep) {
    const arr = arrRaw.slice().sort((a, b) => a.captured - b.captured);
    // 只保留 since 单调递增、且属于同一个进程生命周期的连续段（restarted_at 变化就切断）
    const segs: any[][] = [];
    let curSeg: any[] = [];
    for (const d of arr) {
      if (curSeg.length && (d.restarted_at !== curSeg[curSeg.length - 1].restarted_at || (d.since ?? 0) < (curSeg[curSeg.length - 1].since ?? 0))) {
        segs.push(curSeg); curSeg = [];
      }
      curSeg.push(d);
    }
    if (curSeg.length) segs.push(curSeg);
    const seg = segs.sort((a, b) => b.length - a.length)[0];
    if (!seg || seg.length < 3) continue;
    const i = R.steps.indexOf(cur);
    const st = i >= 0 ? steps[i] : null;
    const phaseFlips: any[] = [];
    for (let k = 1; k < seg.length; k++) if (seg[k].phase !== seg[k - 1].phase) phaseFlips.push({ at_since: r2(seg[k].since, 1), from: seg[k - 1].phase, to: seg[k].phase, captured: seg[k].captured });
    out.push({
      step: cur,
      n_samples: seg.length,
      sample_interval_s: r2(median(seg.slice(1).map((d, k) => d.captured - seg[k].captured))!, 1),
      first_since: r2(seg[0].since, 1),
      last_since: r2(seg[seg.length - 1].since, 1),
      expected_field: r2(seg[0].expected, 2),
      reported_step_s: st?.reported_s ?? null,
      real_step_s: st?.real_s ?? null,
      outer_gen_s: st?.outer_gen_s ?? null,
      trainer_ops_s: st?.trainer_ops_s ?? null,
      gen_frac_field_constant: new Set(seg.map((d) => d.gen_frac)).size === 1,
      // progress = since/expected，所以它精确地在 since = expected 时打到 1.0；
      // 「钉在 1.0 的时长」= 上报耗时 − expected（前提：这一步没有再次重启把 since 清零）。
      progress_pinned_seconds_exact: st ? r2(Math.max(0, (st.reported_s as number) - seg[0].expected), 1) : null,
      progress_pinned_frac_of_reported: st ? r2(Math.max(0, (st.reported_s as number) - seg[0].expected) / (st.reported_s as number), 4) : null,
      progress_pinned_seconds_observed_min: r2(Math.max(0, seg[seg.length - 1].since - seg[0].expected), 1),
      since_frozen_within_segment: Math.max(...seg.map((d) => d.since)) - Math.min(...seg.map((d) => d.since)) < 1e-6 && seg.length > 1,
      phase_flips: phaseFlips,
      trajectory: seg.map((d) => ({ captured: d.captured, since: r2(d.since, 1), progress: r2(d.progress, 4), progress_recomputed: r2(Math.min(1, d.since / d.expected), 4), phase: d.phase, gen_frac: r2(d.gen_frac, 5), rate: d.rate, n_restarts: d.n_restarts })),
    });
  }
  return out.sort((a, b) => a.step - b.step);
}

/* ------------------------------------------------------ env/active 台阶 */

function envActiveJump(R: RunData): any {
  const a = col(R, "env/active");
  const rows: any[] = [];
  for (let i = 1; i < R.n; i++) {
    const d = (a[i] as number) - (a[i - 1] as number);
    if (Math.abs(d) / (a[i - 1] as number) > 0.1) rows.push({ from_step: R.steps[i - 1], to_step: R.steps[i], from: a[i - 1], to: a[i], delta: r2(d, 0), pct: r2(d / (a[i - 1] as number), 4) });
  }
  return { jumps_over_10pct: rows, min: r2(Math.min(...vals(a)), 0), max: r2(Math.max(...vals(a)), 0) };
}

/* ------------------------------------------------------ 跨 run */

function buildCross(runs: Record<string, any>, notices: any[]): any {
  const restartNotices = notices.filter((x: any) => /restart|vram|network|infra|OOM|imbalance/i.test(x.text));
  /** 公告正文里点名了哪条 run（"the pro run" / "the flash run" / "mimo-v2.6-pro"）。 */
  const runHintOf = (text: string): RunKey | null => {
    const hasPro = /\bpro\b/i.test(text) || /mimo-v2\.6-pro/i.test(text);
    const hasFlash = /\bflash\b/i.test(text);
    if (hasPro && !hasFlash) return "pro";
    if (hasFlash && !hasPro) return "flash";
    return null;
  };
  /** 公告正文里点名了第几步。 */
  const stepHintOf = (text: string): number | null => {
    const m = text.match(/step\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const attr: any[] = [];
  {
    // 收集两条 run 的全部重启，按时间排序
    type RR = { run: RunKey; idx: number; t: number; step: number | null; utc: string };
    const all: RR[] = [];
    for (const key of RUNS) for (const l of runs[key].restart_profile.list) all.push({ run: key, idx: l.idx, t: l.t, step: l.step_interrupted, utc: l.utc });
    all.sort((a, b) => a.t - b.t);
    const coveredBy = new Map<string, { id: string; text: string; delta: number }>();
    const EPISODE_S = 3 * 3600; // 同一次故障里可能连着重启好几次，一条公告覆盖 3 小时内的同一 run 的重启
    for (const nn of [...restartNotices].sort((a, b) => a.t - b.t)) {
      const hint = runHintOf(nn.text);
      const sHint = stepHintOf(nn.text);
      let cands = all.filter((r) => (hint ? r.run === hint : true));
      if (sHint !== null) cands = cands.filter((r) => r.step !== null && Math.abs(r.step - sHint) <= 1);
      cands = cands.filter((r) => Math.abs(r.t - nn.t) <= 12 * 3600);
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs(a.t - nn.t) - Math.abs(b.t - nn.t));
      const anchor = cands[0];
      for (const r of all) {
        if (r.run !== anchor.run) continue;
        if (Math.abs(r.t - anchor.t) > EPISODE_S) continue;
        const k = `${r.run}#${r.idx}`;
        if (coveredBy.has(k)) continue;
        coveredBy.set(k, { id: nn.id, text: nn.text, delta: r.t - nn.t });
      }
    }
    for (const r of all) {
      const c = coveredBy.get(`${r.run}#${r.idx}`);
      attr.push({ run: r.run, restart_idx: r.idx, utc: r.utc, step_interrupted: r.step, notice_id: c?.id ?? null, notice_delta_s: c ? r2(c.delta, 0) : null, notice_text: c?.text ?? null });
    }
    attr.sort((a, b) => (a.run === b.run ? a.restart_idx - b.restart_idx : a.run < b.run ? -1 : 1));
  }
  const reasonOf = (text: string | null): string => {
    if (!text) return "unknown";
    if (/vram/i.test(text)) return "single_node_vram";
    if (/network connectivity/i.test(text)) return "network_grader";
    if (/infra error/i.test(text)) return "infra_error_undetected";
    if (/OOM|imbalance/i.test(text)) return "expert_imbalance_oom";
    return "unknown";
  };
  const byReason: Record<string, { run: string; idx: number }[]> = {};
  for (const a of attr) {
    const r = reasonOf(a.notice_text);
    byReason[r] ??= [];
    byReason[r].push({ run: a.run, idx: a.restart_idx });
  }
  const counts: any = {};
  for (const [k, v] of Object.entries(byReason)) counts[k] = { n: v.length, pro: v.filter((x) => x.run === "pro").length, flash: v.filter((x) => x.run === "flash").length };
  // 两条 run 的对照表
  const side: any = {};
  for (const key of RUNS) {
    const R = runs[key];
    side[key] = {
      n_steps: R.n_steps,
      rate_per_s: R.money.rate_per_s,
      bill_usd: R.money.total_bill_usd,
      tokens_billion: R.money.tokens_cum_billion,
      usd_per_billion_tokens: r2(R.money.total_bill_usd / R.money.tokens_cum_billion, 1),
      wall_h_to_last_step: r2(R.money.last_step_wall_s / 3600, 3),
      reported_sum_h: R.money.reported_sum_h,
      gap_h: R.money.gap_def_A_h,
      gap_usd: R.money.gap_def_A_usd,
      gap_pct_of_bill: R.money.gap_def_A_pct_of_bill,
      n_restarts: R.restart_profile.n_restarts,
      mtbf_h: R.restart_profile.mtbf_h,
      little_W_hours: R.little_law.W_hours_median_reliable,
      median_real_step_h: r2(median(R.steps.map((s: any) => s.real_s))! / 3600, 3),
      median_usd_per_step: R.money.cost_per_step_usd.mean,
      usd_per_billion_first: R.money.usd_per_billion_tokens_cum.first,
      usd_per_billion_last: R.money.usd_per_billion_tokens_cum.last,
      usd_per_billion_trend_r: R.money.usd_per_billion_tokens_cum.trend,
      backpressure_all_zero: Object.entries(R.backpressure)
        .filter(([k]) => k.startsWith("train/trace/backpressure") || /orphan|failed_writes|terminal/.test(k))
        .every(([, v]: any) => v.n_nonzero === 0),
      other_s_median: R.othersplit.other_s.median,
      expected_identity_match_ratio: R.progress_fields.expected_identity.ratio_match,
      gen_frac_identity_match_ratio: R.progress_fields.gen_frac_identity.ratio_match,
      progress_identity_max_err: R.progress_fields.progress_identity.max_abs_error,
      meter_stops_at_end: R.money.meter_stops_at_end,
    };
  }
  return {
    notices_n: notices.length,
    restart_notices_n: restartNotices.length,
    restart_attribution: attr,
    restart_reason_counts: counts,
    attributed_restarts: attr.filter((a) => a.notice_id).length,
    unattributed_restarts: attr.filter((a) => !a.notice_id).length,
    side_by_side: side,
    restart_condition_test: {
      pro: runs.pro.restart_profile.condition_test.rows,
      flash: runs.flash.restart_profile.condition_test.rows,
    },
  };
}

/* ------------------------------------------------------ 打印 */

function printSummary(out: any): void {
  const L: string[] = [];
  const p = (s = "") => L.push(s);
  p(`# pipeline_report  ${out.generated_at_utc}`);
  for (const key of RUNS) {
    const R = out.runs[key];
    p(`\n===== ${key}  steps=${R.n_steps}  rate=$${R.money.rate_per_s}/s`);
    p(`  wall h (run_start→last-step completion) = ${(R.money.last_step_wall_s / 3600).toFixed(2)}`);
    p(`  Σreported = ${R.money.reported_sum_h} h   Σreal = ${R.money.real_sum_h} h   gap = ${R.money.gap_def_A_h} h = $${R.money.gap_def_A_usd} (${(R.money.gap_def_A_pct_of_bill * 100).toFixed(1)}% of total bill)`);
    p(`  bill = $${R.money.total_bill_usd}   token = ${R.money.tokens_cum_billion} B   $/B = ${(R.money.total_bill_usd / R.money.tokens_cum_billion).toFixed(0)}`);
    p(`  restarts ${R.restart_profile.n_restarts}  MTBF=${R.restart_profile.mtbf_h} h  median interval=${R.restart_profile.median_interval_h} h`);
    p(`  Little: λ×W → W median=${R.little_law.W_hours_median_reliable} h  turnover per step per slot=${R.little_law.turnover_median_reliable}`);
    p(`  other (step−outer−trainer) median=${R.othersplit.other_s.median} s  ${(R.othersplit.other_frac_of_reported.mean * 100).toFixed(2)}% of step`);
    p(`  progress=since/expected max error=${R.progress_fields.progress_identity.max_abs_error}  expected match ratio=${R.progress_fields.expected_identity.ratio_match}  gen_frac match ratio=${R.progress_fields.gen_frac_identity.ratio_match}`);
  }
  p("\n===== gap attribution (steps with restarts)");
  for (const key of RUNS) {
    p(`-- ${key}`);
    for (const g of out.runs[key].gap_attribution) {
      p(`   s${String(g.step).padStart(2)} gap=${g.gap_s}s | span before last restart=${g.span_before_last_restart_s}s | between restarts=${JSON.stringify(g.between_restarts_s)} | uncounted after recovery=${g.tail_minus_reported_s}s`);
    }
  }
  p("\n===== restart attribution");
  p(`  ${out.cross.restart_notices_n} notices, ${out.cross.attributed_restarts + out.cross.unattributed_restarts} restarts, ${out.cross.attributed_restarts} with a notice`);
  p(`  reason distribution ${JSON.stringify(out.cross.restart_reason_counts)}`);
  p("\n===== backpressure (all 0 = no evidence)");
  for (const key of RUNS) p(`  ${key}: ${JSON.stringify(Object.fromEntries(Object.entries(out.runs[key].backpressure).filter(([k]) => k.startsWith("train/trace/backpressure") || /orphan|failed|terminal/.test(k))))}`);
  console.log(L.join("\n"));
}
