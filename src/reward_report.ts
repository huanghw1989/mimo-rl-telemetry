#!/usr/bin/env bun
/**
 * A3 奖励信号与判分结构 —— 可复算脚本
 *
 * 用法（从项目根目录执行）：
 *   bun src/reward_report.ts
 *
 * 输入（只读）：
 *   data/store/runs/{pro,flash}/series.json
 *   data/store/runs/{pro,flash}/axis.json
 *   data/store/runs/{pro,flash}/tags.json
 *   data/store/notices.json
 *
 * 输出：
 *   analysis/zh-CN/numbers/A3-reward-numbers.json
 *
 * 本脚本只做统计与恒等式核对，不写任何结论数字；所有出现在报告里的
 * 数字都必须能在这个 JSON 里找到对应字段。
 * 不引入任何第三方依赖：相关、差分、回归、t 检验的 p 值全部自行实现。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS_DIR = join(ROOT, "data/store/runs");
const NOTICES = join(ROOT, "data/store/notices.json");
const OUT = join(ROOT, "analysis/zh-CN/numbers/A3-reward-numbers.json");

type V = number | null;
type Series = Record<string, V[]>;

const RUNS = ["pro", "flash"] as const;
type RunName = (typeof RUNS)[number];

/* ------------------------------------------------------------------ */
/* 统计工具（无第三方依赖）                                            */
/* ------------------------------------------------------------------ */

function logGamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** 双侧 p 值，H0: r = 0 */
function pFromR(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return NaN;
  if (Math.abs(r) >= 1) return 0;
  const t = r * Math.sqrt(df / (1 - r * r));
  return betai(df / 2, 0.5, df / (df + t * t));
}

function pearson(xs: number[], ys: number[]): { r: number; n: number; p: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return { r: NaN, n, p: NaN };
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { r: 0, n, p: 1 };
  const r = sxy / Math.sqrt(sxx * syy);
  return { r, n, p: pFromR(r, n) };
}

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function spearman(xs: number[], ys: number[]) {
  return pearson(rank(xs), rank(ys));
}

function ols(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = ys.slice(0, n).reduce((a, y, i) => a + (y - (intercept + slope * xs[i])) ** 2, 0);
  const r2 = syy === 0 ? 0 : 1 - ssRes / syy;
  return { slope, intercept, r2, residual: ys.slice(0, n).map((y, i) => y - (intercept + slope * xs[i])) };
}

function diffs(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) out.push(v[i] - v[i - 1]);
  return out;
}

function quantile(sortedOrNot: number[], q: number): number {
  if (!sortedOrNot.length) return NaN;
  const a = [...sortedOrNot].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
function sd(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/* ------------------------------------------------------------------ */
/* 序列工具                                                            */
/* ------------------------------------------------------------------ */

function clean(a: V[] | undefined): number[] {
  if (!a) return [];
  return a.filter((v): v is number => v !== null && typeof v === "number" && Number.isFinite(v));
}

/** 只保留“有值”的下标（步号）与值，供成对比较使用 */
function aligned(a: V[] | undefined, b: V[] | undefined) {
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  const xs: number[] = [], ys: number[] = [], steps: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = a![i], y = b![i];
    if (x !== null && y !== null && Number.isFinite(x as number) && Number.isFinite(y as number)) {
      xs.push(x as number); ys.push(y as number); steps.push(i + 1);
    }
  }
  return { xs, ys, steps };
}

interface TrendResult {
  n: number;
  slopePerStep: number;
  rLevel: number;
  pLevel: number;
  rSpearman: number;
  pSpearman: number;
  rDiff: number;
  pDiff: number;
  nDiff: number;
  rDetrended: number;
  pDetrended: number;
  /** 两条序列各自的趋势方向都一致时，水平相关会虚高；这里给出对方相对步号的趋势 */
  partnerRWithStep: number;
}

/**
 * 与步号（1..n）做相关。level 是原始值对步号；diff 是一阶差分对差分后的步号；
 * detrended 是两边各自去掉线性趋势后的残差相关。
 */
function trendVsStep(vals: number[]): TrendResult {
  const n = vals.length;
  if (n < 4) {
    return {
      n, slopePerStep: NaN, rLevel: NaN, pLevel: NaN, rSpearman: NaN, pSpearman: NaN,
      rDiff: NaN, pDiff: NaN, nDiff: 0, rDetrended: NaN, pDetrended: NaN, partnerRWithStep: NaN,
    };
  }
  const steps = vals.map((_, i) => i + 1);
  const lvl = pearson(steps, vals);
  const sp = spearman(steps, vals);
  const d = diffs(vals);
  const dSteps = d.map((_, i) => i + 2);
  const df = d.length >= 3 ? pearson(dSteps, d) : { r: NaN, p: NaN, n: d.length };
  return {
    n,
    slopePerStep: ols(steps, vals).slope,
    rLevel: lvl.r,
    pLevel: lvl.p,
    rSpearman: sp.r,
    pSpearman: sp.p,
    rDiff: df.r,
    pDiff: df.p,
    nDiff: d.length,
    // 单序列的 detrended 无意义，交给 pair 函数
    rDetrended: NaN,
    pDetrended: NaN,
    partnerRWithStep: NaN,
  };
}

interface PairResult {
  n: number;
  steps: number[];
  rLevel: number;
  pLevel: number;
  rSpearman: number;
  pSpearman: number;
  /** 一阶差分相关：n-1 个点 */
  rDiff: number;
  pDiff: number;
  nDiff: number;
  /** 各自对步号做 OLS 去趋势后的残差相关：n 个点 */
  rDetrended: number;
  pDetrended: number;
  /** 两条序列各自与步号的（水平）相关，用来判断“共同趋势导致的伪相关” */
  rAWithStep: number;
  rBWithStep: number;
}

function pairCorr(a: V[] | undefined, b: V[] | undefined): PairResult {
  const { xs, ys, steps } = aligned(a, b);
  const n = xs.length;
  const lvl = pearson(xs, ys);
  const sp = spearman(xs, ys);
  const flat = {
    n, steps, rLevel: lvl.r, pLevel: lvl.p, rSpearman: sp.r, pSpearman: sp.p,
    rDiff: NaN, pDiff: NaN, nDiff: 0, rDetrended: NaN, pDetrended: NaN,
    rAWithStep: NaN, rBWithStep: NaN,
  };
  if (n < 4) return flat;
  const dxs = diffs(xs), dys = diffs(ys);
  // 差分相关只在两边差分都非恒定时有定义；与“步号”本身做相关时差分恒为 1，这里明确置 NaN
  const diffDefined = dxs.length >= 3 && (sd(dxs) ?? 0) > 0 && (sd(dys) ?? 0) > 0;
  const df = diffDefined ? pearson(dxs, dys) : { r: NaN, p: NaN, n: dxs.length };
  const rA = ols(steps, xs).residual;
  const rB = ols(steps, ys).residual;
  const dt = (sd(rA) ?? 0) > 0 && (sd(rB) ?? 0) > 0 ? pearson(rA, rB) : { r: NaN, p: NaN };
  return {
    n, steps, rLevel: lvl.r, pLevel: lvl.p, rSpearman: sp.r, pSpearman: sp.p,
    rDiff: df.r, pDiff: df.p, nDiff: dxs.length,
    rDetrended: dt.r, pDetrended: dt.p,
    rAWithStep: pearson(steps, xs).r,
    rBWithStep: pearson(steps, ys).r,
  };
}

interface SeriesStat {
  key: string;
  n: number;
  nMissing: number;
  nTotal: number;
  firstStep: number | null;
  lastStep: number | null;
  first: number | null;
  last: number | null;
  delta: number | null;
  deltaRel: number | null;
  mean: number | null;
  sd: number | null;
  cv: number | null;
  min: number | null;
  max: number | null;
  /** 众数值出现次数占比：判断“max 是否被钉在某个常数上” */
  modalShare: number | null;
  modalValue: number | null;
  nDistinct: number;
  /** 恒为零 / 恒为常数 的判定 */
  allZero: boolean;
  constant: boolean;
  constantValue: number | null;
  trend: TrendResult;
  values: V[];
}

function stat(key: string, s: Series): SeriesStat {
  const raw = s[key] ?? [];
  const v = clean(raw);
  const steps = raw.map((x, i) => (x === null || x === undefined ? null : i + 1)).filter((x): x is number => x !== null);
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  let modalValue: number | null = null, modalCount = 0;
  for (const [k, c] of counts) if (c > modalCount) { modalCount = c; modalValue = k; }
  const m = mean(v);
  const sdd = sd(v);
  const first = v.length ? raw[steps[0] - 1] as number : null;
  const last = v.length ? raw[steps[steps.length - 1] - 1] as number : null;
  return {
    key,
    n: v.length,
    nMissing: raw.length - v.length,
    nTotal: raw.length,
    firstStep: steps.length ? steps[0] : null,
    lastStep: steps.length ? steps[steps.length - 1] : null,
    first,
    last,
    delta: first !== null && last !== null ? last - first : null,
    deltaRel: first !== null && last !== null && first !== 0 ? (last - first) / Math.abs(first) : null,
    mean: v.length ? m : null,
    sd: v.length ? sdd : null,
    cv: v.length && m !== 0 ? sdd / Math.abs(m) : null,
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
    modalShare: v.length ? modalCount / v.length : null,
    modalValue,
    nDistinct: counts.size,
    allZero: v.length > 0 && v.every((x) => x === 0),
    constant: counts.size === 1,
    constantValue: counts.size === 1 ? modalValue : null,
    trend: trendVsStep(v),
    values: raw,
  };
}

/* ------------------------------------------------------------------ */
/* 恒等式核对                                                          */
/* ------------------------------------------------------------------ */

type Verdict = "exact" | "near" | "range-only" | "broken" | "not-comparable";

interface IdentityCheck {
  name: string;
  lhs: string;
  rhs: string[];
  relation: "sum" | "difference" | "ratio" | "equal";
  n: number;
  maxAbsDiff: number | null;
  maxRelDiff: number | null;
  worstStep: number | null;
  worstLhs: number | null;
  worstRhs: number | null;
  perStepRelDiff: number[];
  verdict: Verdict;
  note?: string;
}

function checkIdentity(
  run: RunName,
  s: Series,
  name: string,
  relation: "sum" | "difference" | "ratio" | "equal",
  lhsKey: string,
  rhsKeys: string[],
  opts: { exactTol?: number; nearTol?: number; absNear?: number; scale?: "abs" | "value"; note?: string } = {},
): IdentityCheck {
  const tol = opts.exactTol ?? 0;
  const nearTol = opts.nearTol ?? 0.01;
  const lhsArr = s[lhsKey] ?? [];
  const rhsArrs = rhsKeys.map((k) => s[k] ?? []);
  const n = Math.min(lhsArr.length, ...rhsArrs.map((a) => a.length));
  let maxAbsDiff = 0, maxRelDiff = 0;
  let worstStep: number | null = null, worstLhs: number | null = null, worstRhs: number | null = null;
  const rels: number[] = [];
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const L = lhsArr[i];
    const vs = rhsArrs.map((a) => a[i]);
    if (L === null || L === undefined) continue;
    if (vs.some((x) => x === null || x === undefined)) continue;
    let R = 0;
    if (relation === "sum") R = (vs as number[]).reduce((a, b) => a + b, 0);
    else if (relation === "difference") R = (vs as number[]).reduce((a, b) => a - b);
    else if (relation === "ratio") R = (vs as number[]).reduce((a, b) => a / b);
    else R = (vs as number[])[0];
    const ad = Math.abs((L as number) - R);
    // 相对误差的分母：默认用 rhs 的绝对值，但 rhs 接近 0 时改用 lhs 量级，
    // 避免“两边都接近 0”被算成巨大相对误差。
    const denom = opts.scale === "value"
      ? Math.max(Math.abs(R), Math.abs(L as number))
      : Math.abs(R);
    const rd = denom > 1e-12 ? ad / denom : ad;
    if (ad > maxAbsDiff) { maxAbsDiff = ad; worstStep = i + 1; worstLhs = L as number; worstRhs = R; }
    maxRelDiff = Math.max(maxRelDiff, rd);
    rels.push(rd);
    cnt++;
  }
  const absNear = opts.absNear ?? 0;
  const verdict: Verdict = cnt === 0
    ? "not-comparable"
    : maxAbsDiff <= tol ? "exact"
    : maxRelDiff <= nearTol ? "near"
    : maxAbsDiff <= absNear ? "near"
    : "broken";
  return {
    name,
    lhs: lhsKey,
    rhs: rhsKeys,
    relation,
    n: cnt,
    maxAbsDiff: cnt ? maxAbsDiff : null,
    maxRelDiff: cnt ? maxRelDiff : null,
    worstStep, worstLhs, worstRhs,
    perStepRelDiff: rels,
    verdict,
    note: opts.note,
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const notices = JSON.parse(readFileSync(NOTICES, "utf8"));

const METRIC_GROUPS: Record<string, string[]> = {
  globalReward: [
    "critic/score/mean", "critic/score/min", "critic/score/max",
    "critic/rewards/mean", "critic/rewards/min", "critic/rewards/max",
    "critic/advantages/mean", "critic/advantages/min", "critic/advantages/max",
    "critic/returns/mean", "critic/returns/min", "critic/returns/max",
    "critic/agentic/score/mean", "critic/agentic/advantages/mean",
    "critic/agentic/advantages/min", "critic/agentic/advantages/max",
  ],
  pool: [
    "dynsam/avg@n", "dynsam/passrate/zero", "dynsam/passrate/one",
    "dynsam/num_measurable", "dynsam/num_target", "dynsam/agg_turn/mean",
    "dynsam/infra_error/seq_rate",
    "train/passrate/passrate_0_ratio", "train/passrate/passrate_1_ratio",
    "train/passrate/avg_passrate",
    "train/verdicts/carried", "train/verdicts/rejected", "train/verdicts/expired",
    "train/verdicts/trained", "train/verdicts/dropped_empty_response",
    "train/verdicts/dropped_zero_adv",
  ],
  graderTraffic: [
    "penalty/stage_credit_group/groups_total",
    "penalty/stage_credit_group/routed/off",
    "penalty/stage_credit_group/routed/select_v4",
    "penalty/stage_credit_group/routed/select_v4_nogold",
    "penalty/stage_credit_group/groups_attempted",
    "penalty/stage_credit_group/groups_judged",
    "penalty/stage_credit_group/groups_judged_after_drop",
    "penalty/stage_credit_group/groups_expired_unjudged",
    "penalty/stage_credit_group/groups_skipped_empty_inputs",
    "penalty/stage_credit_group/groups_skipped_unbalanced",
    "penalty/stage_credit_group/groups_failed_pass1",
    "penalty/stage_credit_group/groups_failed_pass2",
    "penalty/stage_credit_group/groups_failed_pod",
    "penalty/stage_credit_group/groups_failed_select",
    "penalty/stage_credit_group/select_groups_failed",
    "penalty/stage_credit_group/select_groups_skipped_uniform",
    "penalty/stage_credit_group/end2end_success_rate",
    "penalty/stage_credit_group/pass1_success_rate",
    "penalty/stage_credit_group/pass2_success_rate",
    "penalty/stage_credit_group/judge_pass1_attempts",
    "penalty/stage_credit_group/judge_pass2_attempts",
    "penalty/stage_credit_group/judge_pending",
    "penalty/stage_credit_group/judge_pool_in_flight",
    "penalty/stage_credit_group/judge_pool_max_load",
    "penalty/stage_credit_group/judge_pool_dead_replaced",
    "penalty/stage_credit_group/judge_aux_missing_rollouts",
    "penalty/stage_credit_group/keep_mass_capped",
    "penalty/stage_credit_group/rollouts_masked",
    "penalty/stage_credit_group/dev_neg_turns",
  ],
  graderScore: [
    "penalty/stage_credit_group/select_score_A_mean",
    "penalty/stage_credit_group/select_score_B_mean",
    "penalty/stage_credit_group/select_score_E_mean",
    "penalty/stage_credit_group/select_score_P_mean",
    "penalty/stage_credit_group/select_score_S_mean",
    "penalty/stage_credit_group/select_above_gold_share",
    "penalty/stage_credit_group/select_impl_over_gold_mean",
    "penalty/stage_credit_group/select_factor_mean",
    "penalty/stage_credit_group/select_renorm_k_mean",
    "penalty/stage_credit_group/select_renorm_capped_rate",
    "penalty/stage_credit_group/select_spread_logratio_mean",
    "penalty/stage_credit_group/select_tier_share_T1",
    "penalty/stage_credit_group/select_tier_share_T2",
    "penalty/stage_credit_group/select_tier_share_T3",
    "penalty/stage_credit_group/select_tier_share_H",
  ],
  graderQuality: [
    "penalty/stage_credit_group/select_probe_disagree_rate",
    "penalty/stage_credit_group/select_rank_score_conflict",
    "penalty/stage_credit_group/select_rank_invalid",
    "penalty/stage_credit_group/select_regression_flagged",
    "penalty/stage_credit_group/select_tier_mismatch",
    "penalty/stage_credit_group/select_r1_rate",
    "penalty/stage_credit_group/select_r1_masked",
    "penalty/stage_credit_group/select_r2_rate",
    "penalty/stage_credit_group/select_r2_flagged",
    "penalty/stage_credit_group/select_r2_capped_rate",
    "penalty/stage_credit_group/select_r2_evidence_rejected",
    "penalty/stage_credit_group/select_r3_rate",
    "penalty/stage_credit_group/select_r3_groups",
    "penalty/stage_credit_group/select_r3_gold_fails",
    "penalty/stage_credit_group/select_process_severe",
    "penalty/stage_credit_group/select_adv_group_sum_abs_mean",
    "penalty/stage_credit_group/select_tq_adv_rows_rewritten",
  ],
  hack: [
    "penalty/stage_credit_group/select_hack_attempt",
    "penalty/stage_credit_group/select_hack_attempt_rate",
    "penalty/stage_credit_group/select_hack_attempt_ge_min",
    "penalty/stage_credit_group/select_hack_attempt_ge_min_rate",
    "penalty/stage_credit_group/select_hack_attempt_turns_per_pass",
    "penalty/stage_credit_group/select_hack_exposed_not_relied",
    "penalty/stage_credit_group/select_pass_new_tests_rate",
    "penalty/stage_credit_group/select_v4/select_hack_attempt_rate",
    "penalty/stage_credit_group/select_v4_nogold/select_hack_attempt_rate",
    "penalty/stage_credit_group/select_v4/select_above_gold_share",
  ],
  cost: [
    "penalty/stage_credit_group/time_total_sec_mean",
    "penalty/stage_credit_group/time_total_sec_max",
    "penalty/stage_credit_group/time_pass1_sec_mean",
    "penalty/stage_credit_group/time_pass2_sec_mean",
    "penalty/stage_credit_group/time_pod_setup_sec_mean",
    "penalty/stage_credit_group/select_pass_turns_mean",
    "penalty/stage_credit_group/select_v4/time_total_sec_mean",
    "penalty/stage_credit_group/select_v4_nogold/time_total_sec_mean",
  ],
  penalty: [
    "penalty/signed/pos_scale", "penalty/signed/neg_scale",
    "penalty/signed/pos_hit_tokens", "penalty/signed/neg_hit_tokens",
    "penalty/signed/pos_mass_added", "penalty/signed/neg_mass_added",
    "penalty/signed/pos_scale_clamped", "penalty/signed/neg_scale_clamped",
    "penalty/action/adv_mul_min", "penalty/action/adv_mul_tokens",
    "penalty/action/adv_reduction_tokens", "penalty/action/adv_reduction_total",
    "train/adv_pos_sum_pre_penalty", "train/adv_pos_sum_post_penalty",
    "train/adv_neg_sum_pre_penalty", "train/adv_neg_sum_post_penalty",
  ],
  policy: [
    "actor/entropy_loss", "actor/agentic/entropy_loss", "actor/pg_loss",
    "actor/pg_tis_clipfrac", "actor/pg_clipfrac", "actor/ppo_kl",
    "actor/grad_norm", "actor/lr", "actor/clip_high", "actor/clip_low",
  ],
  timing: [
    "perf/total_num_tokens", "timing_s/step", "timing_s/outer_gen", "timing_s/trainer_ops",
  ],
};

interface RunOut {
  run: RunName;
  steps: number[];
  walls: number[];
  runStart: number;
  wallSpanHours: number;
  reportedStepSeconds: number;
  timingGapHours: number;
  stats: Record<string, SeriesStat>;
  groups: Record<string, Record<string, SeriesStat>>;
  perDataset: Record<string, Record<string, SeriesStat>>;
  identities: IdentityCheck[];
  compositeChecks: unknown[];
  constancy: unknown;
  derived: Record<string, V[]>;
  shape: unknown;
  poolDecomposition: unknown;
  costModel: unknown;
  harness: unknown;
  coverage: unknown;
  envCounterResets: unknown;
  noticeAlignment: unknown;
  versionShift: unknown;
  versionHistory: unknown;
  correlations: Record<string, PairResult>;
}

const out: Record<string, unknown> = {};

for (const run of RUNS) {
  const dir = join(RUNS_DIR, run);
  const series: Series = JSON.parse(readFileSync(join(dir, "series.json"), "utf8"));
  const axis = JSON.parse(readFileSync(join(dir, "axis.json"), "utf8"));
  const tags = JSON.parse(readFileSync(join(dir, "tags.json"), "utf8"));
  const steps: number[] = axis.steps;
  const walls: number[] = axis.walls;

  const stats: Record<string, SeriesStat> = {};
  const groups: Record<string, Record<string, SeriesStat>> = {};

  for (const [gname, keys] of Object.entries(METRIC_GROUPS)) {
    groups[gname] = {};
    for (const k of keys) {
      const st = stat(k, series);
      stats[k] = st;
      groups[gname][k] = st;
    }
  }

  /* ---------- 数据集级 ---------- */
  const dsKeys = Object.keys(series).filter((k) => /^critic\/[^/]+\/dataset-[^/]+\//.test(k));
  const dsNames = [...new Set(dsKeys.map((k) => k.match(/^critic\/([^/]+\/dataset-[^/]+)\//)![1]))].sort();
  const perDataset: Record<string, Record<string, SeriesStat>> = {};
  for (const ds of dsNames) {
    perDataset[ds] = {};
    for (const mdl of ["score", "rewards", "advantages", "returns"]) {
      for (const agg of ["mean", "min", "max"]) {
        const k = `critic/${ds}/${mdl}/${agg}`;
        if (series[k]) perDataset[ds][`${mdl}/${agg}`] = stat(k, series);
      }
    }
  }

  /* ---------- 恒等式核对 ---------- */
  const SCG = "penalty/stage_credit_group/";
  const identities: IdentityCheck[] = [
    checkIdentity(run, series, "score/mean == rewards/mean", "equal",
      "critic/score/mean", ["critic/rewards/mean"], { exactTol: 0 }),
    checkIdentity(run, series, "score/min == rewards/min", "equal",
      "critic/score/min", ["critic/rewards/min"], { exactTol: 0 }),
    checkIdentity(run, series, "score/max == rewards/max", "equal",
      "critic/score/max", ["critic/rewards/max"], { exactTol: 0 }),
    checkIdentity(run, series, "advantages/mean == returns/mean", "equal",
      "critic/advantages/mean", ["critic/returns/mean"], { exactTol: 0 }),
    checkIdentity(run, series, "advantages/min == returns/min", "equal",
      "critic/advantages/min", ["critic/returns/min"], { exactTol: 0 }),
    checkIdentity(run, series, "groups_total = off + v4 + v4_nogold", "sum",
      SCG + "groups_total",
      [SCG + "routed/off", SCG + "routed/select_v4", SCG + "routed/select_v4_nogold"],
      { exactTol: 0 }),
    checkIdentity(run, series, "groups_attempted = v4 + nogold attempted", "sum",
      SCG + "groups_attempted",
      [SCG + "select_v4/groups_attempted", SCG + "select_v4_nogold/groups_attempted"],
      { exactTol: 0 }),
    checkIdentity(run, series, "groups_judged = v4 + nogold judged", "sum",
      SCG + "groups_judged",
      [SCG + "select_v4/groups_judged", SCG + "select_v4_nogold/groups_judged"],
      { exactTol: 0 }),
    checkIdentity(run, series, "attempted = judged + select_groups_failed", "sum",
      SCG + "groups_attempted", [SCG + "groups_judged", SCG + "select_groups_failed"],
      { exactTol: 4, note: "小数取整导致 ±4" }),
    checkIdentity(run, series, "select_groups_failed = failed_select + failed_pod", "sum",
      SCG + "select_groups_failed", [SCG + "groups_failed_select", SCG + "groups_failed_pod"],
      { exactTol: 4, note: "取整；flash 没有 groups_failed_pod 这个 tag，会得到 not-comparable" }),
    checkIdentity(run, series, "select_groups_judged == groups_judged", "equal",
      SCG + "select_groups_judged", [SCG + "groups_judged"], { exactTol: 0 }),
    checkIdentity(run, series, "pass1_success_rate ≈ end2end_success_rate", "equal",
      SCG + "end2end_success_rate", [SCG + "pass1_success_rate"],
      { exactTol: 0, nearTol: 0.01, note: "看板未给定义，只核对两者是否同量级同走向" }),
    checkIdentity(run, series, "select_above_gold_share == select_v4/select_above_gold_share", "equal",
      SCG + "select_above_gold_share", [SCG + "select_v4/select_above_gold_share"],
      { exactTol: 0, note: "若成立，说明 above_gold 只在 v4 这条有 gold 的路上算" }),
    checkIdentity(run, series, "critic/advantages/mean vs critic/agentic/advantages/mean", "equal",
      "critic/advantages/mean", ["critic/agentic/advantages/mean"],
      { exactTol: 0, nearTol: 0.05, absNear: 0.002, scale: "value",
        note: "两个量都在 0 附近（|值|<0.05），相对差失去意义；用绝对差 0.002 作为 near 门槛，同时给 max(|L|,|R|) 分母的相对差" }),
    checkIdentity(run, series, "time_total = time_pass1 + time_pod_setup", "sum",
      SCG + "time_total_sec_mean",
      [SCG + "time_pass1_sec_mean", SCG + "time_pod_setup_sec_mean"],
      { exactTol: 0, nearTol: 0.01, note: "残差最大约 4.3 秒（0.8%），口径未公开" }),
    checkIdentity(run, series, "stage_credit_group/harness-A..D groups_attempted = 全局", "sum",
      SCG + "groups_attempted",
      ["A", "B", "C", "D"].map((h) => `${SCG}harness/harness-${h}/groups_attempted`),
      { exactTol: 0, note: "证明 harness-A..D 是并行分片、不是版本" }),
    checkIdentity(run, series, "harness-A..D groups_judged = 全局", "sum",
      SCG + "groups_judged",
      ["A", "B", "C", "D"].map((h) => `${SCG}harness/harness-${h}/groups_judged`),
      { exactTol: 0 }),
    checkIdentity(run, series, "adv_pos_sum_pre == adv_pos_sum_post", "equal",
      "train/adv_pos_sum_pre_penalty", ["train/adv_pos_sum_post_penalty"], { exactTol: 0 }),
    checkIdentity(run, series, "adv_neg_sum_pre == adv_neg_sum_post", "equal",
      "train/adv_neg_sum_pre_penalty", ["train/adv_neg_sum_post_penalty"], { exactTol: 0 }),
  ];

  /* ---------- 派生量 ---------- */
  const D: Record<string, V[]> = {};
  const n = steps.length;

  // neg_scale 的推导值：1 - neg_mass_added / |adv_neg_sum_pre|
  D["derived/neg_scale_from_mass"] = Array.from({ length: n }, (_, i) => {
    const a = series["penalty/signed/neg_mass_added"]?.[i];
    const b = series["train/adv_neg_sum_pre_penalty"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return 1 - a / Math.abs(b);
  });
  // pos_scale 的推导值：1 + pos_mass_removed / adv_pos_sum_pre
  D["derived/pos_scale_from_mass"] = Array.from({ length: n }, (_, i) => {
    const a = series["penalty/signed/pos_mass_removed"]?.[i];
    const b = series["train/adv_pos_sum_pre_penalty"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return 1 + a / b;
  });
  // 反推的 pos_mass_removed（用 pos_scale），用于补 pos_mass_added 缺失
  D["derived/pos_mass_removed_from_scale"] = Array.from({ length: n }, (_, i) => {
    const a = series["penalty/signed/pos_scale"]?.[i];
    const b = series["train/adv_pos_sum_pre_penalty"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return (a - 1) * b;
  });
  // factor_mean x renorm_k_mean
  D["derived/factor_x_renorm_k"] = Array.from({ length: n }, (_, i) => {
    const a = series["penalty/stage_credit_group/select_factor_mean"]?.[i];
    const b = series["penalty/stage_credit_group/select_renorm_k_mean"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return a * b;
  });
  // 优势总量 ÷ 本步 token 数
  D["derived/adv_pos_sum_pre_per_token"] = Array.from({ length: n }, (_, i) => {
    const a = series["train/adv_pos_sum_pre_penalty"]?.[i];
    const b = series["perf/total_num_tokens"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  D["derived/adv_neg_sum_pre_per_token"] = Array.from({ length: n }, (_, i) => {
    const a = series["train/adv_neg_sum_pre_penalty"]?.[i];
    const b = series["perf/total_num_tokens"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  // 五档评分维度的等权平均（A/B/E/P/S）
  D["derived/score_rubric_mean"] = Array.from({ length: n }, (_, i) => {
    const dims = ["A", "B", "E", "P", "S"].map((d) => series[SCG + `select_score_${d}_mean`]?.[i]);
    if (dims.some((v) => v === null || v === undefined)) return null;
    return mean(dims as number[]);
  });
  // 判分失败占受理的比例
  D["derived/groups_failed_share_of_attempted"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "select_groups_failed"]?.[i];
    const b = series[SCG + "groups_attempted"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  // 每个候选组摊到的整步墙钟
  D["derived/step_wall_per_candidate_group"] = Array.from({ length: n }, (_, i) => {
    const a = series["timing_s/step"]?.[i];
    const b = series[SCG + "groups_total"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  // 判一组所需墙钟 ÷ 每组摊到的整步墙钟
  D["derived/judging_over_step_budget"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "time_total_sec_mean"]?.[i];
    const b = D["derived/step_wall_per_candidate_group"][i];
    if (a === null || a === undefined || b === null || b === 0) return null;
    return a / (b as number);
  });
  // 判分组数占候选组比例
  D["derived/judged_share_of_total"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "groups_judged"]?.[i];
    const b = series[SCG + "groups_total"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  D["derived/attempted_share_of_total"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "groups_attempted"]?.[i];
    const b = series[SCG + "groups_total"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  D["derived/judge_success_rate_from_counts"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "groups_judged"]?.[i];
    const b = series[SCG + "groups_attempted"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  // 判分侧“标记数 / 判完组数”的归一化率（用于替代缺失的官方 rate）
  for (const short of [
    "select_regression_flagged", "select_tier_mismatch", "select_r2_flagged",
    "select_r1_masked", "select_process_severe", "select_rank_invalid",
    "select_rank_score_conflict", "select_hack_attempt", "select_hack_exposed_not_relied",
    "select_groups_failed", "select_groups_skipped_uniform",
  ]) {
    D[`derived/${short}_per_judged_group`] = Array.from({ length: n }, (_, i) => {
      const a = series[SCG + short]?.[i];
      const b = series[SCG + "groups_judged"]?.[i];
      if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
      return a / b;
    });
  }
  // 每个被训练 rollout 摊到的判分墙钟秒数
  D["derived/grader_sec_per_step"] = Array.from({ length: n }, (_, i) => {
    const a = series[SCG + "groups_judged"]?.[i];
    const b = series[SCG + "time_total_sec_mean"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return a * b;
  });
  D["derived/grader_sec_per_trained_rollout"] = Array.from({ length: n }, (_, i) => {
    const a = D["derived/grader_sec_per_step"][i];
    const b = series["train/verdicts/trained"]?.[i];
    if (a === null || b === null || b === undefined || b === 0) return null;
    return (a as number) / b;
  });
  D["derived/grader_sec_per_candidate_group"] = Array.from({ length: n }, (_, i) => {
    const a = D["derived/grader_sec_per_step"][i];
    const b = series[SCG + "groups_total"]?.[i];
    if (a === null || b === null || b === undefined || b === 0) return null;
    return (a as number) / b;
  });
  // 需要的判分并发路数：判分总秒数 ÷ 该步墙钟
  D["derived/required_grader_slots"] = Array.from({ length: n }, (_, i) => {
    const a = D["derived/grader_sec_per_step"][i];
    const b = series["timing_s/step"]?.[i];
    if (a === null || b === null || b === undefined || b === 0) return null;
    return (a as number) / b;
  });
  // 每步墙钟里非生成非训练的残差
  D["derived/step_residual_sec"] = Array.from({ length: n }, (_, i) => {
    const a = series["timing_s/step"]?.[i];
    const b = series["timing_s/outer_gen"]?.[i];
    const c = series["timing_s/trainer_ops"]?.[i];
    if (a === null || b === null || c === null || a === undefined || b === undefined || c === undefined) return null;
    return a - b - c;
  });
  D["derived/gen_plus_train_share_of_step"] = Array.from({ length: n }, (_, i) => {
    const a = series["timing_s/step"]?.[i];
    const b = series["timing_s/outer_gen"]?.[i];
    const c = series["timing_s/trainer_ops"]?.[i];
    if (!a || b === null || b === undefined || c === null || c === undefined) return null;
    return (b + c) / a;
  });
  // 可训练池占比 = 1 - 全错 - 全对
  for (const [tagName, zk, ok] of [
    ["dynsam", "dynsam/passrate/zero", "dynsam/passrate/one"],
    ["trainbatch", "train/passrate/passrate_0_ratio", "train/passrate/passrate_1_ratio"],
  ] as const) {
    D[`derived/trainable_share_${tagName}`] = Array.from({ length: n }, (_, i) => {
      const z = series[zk]?.[i], o = series[ok]?.[i];
      if (z === null || z === undefined || o === null || o === undefined) return null;
      return 1 - z - o;
    });
  }
  // 覆盖度：哪些 tag 在某一步之后不再上报
  const coverage = (() => {
    const all: Array<{ key: string; n: number; nTotal: number; firstStep: number | null; lastStep: number | null; missingTail: number }> = [];
    for (const [k, arr] of Object.entries(series)) {
      const idx = arr.map((v, i) => (v === null || v === undefined ? null : i + 1)).filter((x): x is number => x !== null);
      if (!idx.length) continue;
      const lastStep = idx[idx.length - 1];
      all.push({ key: k, n: idx.length, nTotal: arr.length, firstStep: idx[0], lastStep, missingTail: arr.length - lastStep });
    }
    const tailMissing = all.filter((x) => x.missingTail > 0).sort((a, b) => b.missingTail - a.missingTail);
    return {
      nKeysWithData: all.length,
      nKeysWithoutData: Object.keys(series).length - all.length,
      keysMissingTail: tailMissing.map((x) => ({ key: x.key, n: x.n, lastStep: x.lastStep, missingSteps: x.missingTail })),
      keysStartingLate: all.filter((x) => (x.firstStep ?? 1) > 1).map((x) => ({ key: x.key, firstStep: x.firstStep, n: x.n })),
    };
  })();

  // 环境计数器归零的步（用于对照重启公告；与奖励/判分结构本身无关，仅作口径提示）
  const envCounterResets = (() => {
    const arr = series["env/total_setup"] ?? [];
    const resets: Array<{ step: number; prev: number; cur: number }> = [];
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i];
      if (a !== null && a !== undefined && b !== null && b !== undefined && b < a) resets.push({ step: i + 1, prev: a, cur: b });
    }
    return resets;
  })();

  // 公告时间戳落在哪一步（用于把重启/数据集增删对齐到步）
  const noticeList: Array<{ id: string; t: number; text: string }> = Array.isArray(notices) ? notices : notices.items;
  const noticeAlignment = noticeList.map((nn: { id: string; t: number; text: string }) => {
    let stepAtOrAfter: number | null = null;
    for (let i = 0; i < walls.length; i++) {
      if (nn.t <= walls[i]) { stepAtOrAfter = steps[i]; break; }
    }
    const prevStep = steps.filter((_, i) => walls[i] < nn.t).slice(-1)[0] ?? null;
    return { id: nn.id, t: nn.t, text: nn.text, prevStep, firstStepAtOrAfter: stepAtOrAfter };
  });

  // 版本边界处有没有系统性跳变：拿“边界后 3 步均值 − 边界前 3 步均值”
  // 与所有可能切点的同一统计量作比较，给出分位。样本极小，只作排除性证据。
  const shiftMetrics = [
    SCG + "select_probe_disagree_rate",
    SCG + "select_hack_attempt_rate",
    SCG + "select_above_gold_share",
    SCG + "select_score_P_mean",
    SCG + "select_factor_mean",
    SCG + "groups_judged",
    SCG + "end2end_success_rate",
    "actor/entropy_loss",
    "critic/score/mean",
    "dynsam/avg@n",
  ];
  const jumpAt = (vals: number[], s: number, w = 3) => {
    const before = vals.slice(Math.max(0, s - 1 - w), s - 1);
    const after = vals.slice(s - 1, s - 1 + w);
    if (before.length < w || after.length < w) return null;
    return mean(after) - mean(before);
  };
  const versionShift = (() => {
    const bounds = tags.versions
      .map((v: { version: string; at: number }) => {
        for (let i = 0; i < walls.length; i++) if (v.at <= walls[i]) return steps[i];
        return null;
      })
      .filter((x: number | null): x is number => x !== null);
    const out: Record<string, unknown> = {};
    for (const k of shiftMetrics) {
      const v = clean(series[k] ?? []);
      if (v.length < 8) { out[k] = { n: v.length, note: "样本太少，跳过" }; continue; }
      const all: number[] = [];
      for (let s = 4; s <= v.length - 2; s++) { const j = jumpAt(v, s); if (j !== null) all.push(j); }
      out[k] = {
        nSeries: v.length,
        boundaryJumps: bounds.map((b: number) => ({ step: b, jump: jumpAt(v, b) })),
        nullQuantiles: {
          p05: quantile(all, 0.05), p50: quantile(all, 0.5), p95: quantile(all, 0.95),
        },
        note: "jump = 边界后 3 步均值 − 边界前 3 步均值；null 分布由所有切点构成。序列本身有趋势时，该统计量在边界处不显著不代表没有变化。",
      };
    }
    return out;
  })();

  // 各版本时间戳落在哪一步
  const versionHistory = {
    currentVersion: tags.version,
    versions: tags.versions.map((v: { version: string; at: number; n: number }) => {
      let stepAtOrAfter: number | null = null;
      for (let i = 0; i < walls.length; i++) {
        if (v.at <= walls[i]) { stepAtOrAfter = steps[i]; break; }
      }
      return { ...v, firstStepAtOrAfter: stepAtOrAfter };
    }),
    tagFirstSeenCohorts: (() => {
      const by: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(tags.tags as Record<string, { first_seen: number }>)) {
        (by[v.first_seen] = by[v.first_seen] ?? []).push(k);
      }
      return Object.keys(by).sort((a, b) => Number(a) - Number(b)).map((t) => ({
        firstSeen: Number(t),
        count: by[t].length,
        sample: by[t].slice(0, 8),
      }));
    })(),
  };

  /* ---------- 组合式核对（依赖 derived 序列） ---------- */
  const composite = (name: string, lhs: V[], rhs: V[], note: string, nearTol = 0.01) => {
    const { xs, ys } = aligned(lhs, rhs);
    let maxAbs = 0;
    for (let i = 0; i < xs.length; i++) maxAbs = Math.max(maxAbs, Math.abs(xs[i] - ys[i]));
    const rel = xs.map((x, i) => (Math.max(Math.abs(x), Math.abs(ys[i])) > 1e-12
      ? Math.abs(x - ys[i]) / Math.max(Math.abs(x), Math.abs(ys[i])) : Math.abs(x - ys[i])));
    const maxRel = rel.length ? Math.max(...rel) : NaN;
    return {
      name, n: xs.length, maxAbsDiff: maxAbs, maxRelDiff: maxRel,
      verdict: (xs.length === 0 ? "not-comparable"
        : maxAbs <= 1e-9 ? "exact"
        : maxRel <= nearTol ? "near" : "broken") as Verdict,
      note,
    };
  };
  const SCG2 = SCG;
  // 把派生序列并入查找表，供需要“推导值”的核对使用
  const combined: Series = { ...series };
  for (const [k, v] of Object.entries(D)) combined[k] = v;
  // neg_scale 的推导恒等式
  identities.push(checkIdentity(run, combined, "neg_scale ≈ 1 - neg_mass_added/|adv_neg_sum_pre|", "equal",
    "penalty/signed/neg_scale", ["derived/neg_scale_from_mass"],
    { exactTol: 0, nearTol: 0.001, absNear: 0.002,
      note: "推导序列在 derived/neg_scale_from_mass；偏离最大的那一步见 worstStep/worstLhs/worstRhs" }));
  identities.push(checkIdentity(run, combined, "pos_scale ≈ 1 + pos_mass_removed/adv_pos_sum_pre", "equal",
    "penalty/signed/pos_scale", ["derived/pos_scale_from_mass"],
    { exactTol: 0, nearTol: 0.001, note: "flash 后段 pos_mass_removed 缺失，故 n 小于步数" }));
  // trained / num_target 是否恒定
  D["derived/trained_per_target"] = Array.from({ length: n }, (_, i) => {
    const a = series["train/verdicts/trained"]?.[i], b = series["dynsam/num_target"]?.[i];
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
    return a / b;
  });
  // 全局 hack rate 是否等于 v4/nogold 按判完组数加权
  D["derived/hack_rate_weighted_v4_nogold"] = Array.from({ length: n }, (_, i) => {
    const w1 = series[SCG + "select_v4/groups_judged"]?.[i];
    const w2 = series[SCG + "select_v4_nogold/groups_judged"]?.[i];
    const r1 = series[SCG + "select_v4/select_hack_attempt_rate"]?.[i];
    const r2 = series[SCG + "select_v4_nogold/select_hack_attempt_rate"]?.[i];
    if ([w1, w2, r1, r2].some((v) => v === null || v === undefined)) return null;
    const W = (w1 as number) + (w2 as number);
    if (W === 0) return null;
    return ((w1 as number) * (r1 as number) + (w2 as number) * (r2 as number)) / W;
  });
  const compositeChecks = [
    composite("hack_attempt_rate = v4/nogold 按判完组数加权",
      series[SCG + "select_hack_attempt_rate"] ?? [],
      D["derived/hack_rate_weighted_v4_nogold"],
      "口径说明：全局率是两条路的加权，不是独立测量（flash 最大相对差 1.6%，两条路的 judged 之和与全局存在口径差）", 0.02),
  ];
  const constancy = {
    trainedPerTarget: stat("derived/trained_per_target", D),
    factorXRenormK: stat("derived/factor_x_renorm_k", D),
    advPosSumPerToken: stat("derived/adv_pos_sum_pre_per_token", D),
    advNegSumPerToken: stat("derived/adv_neg_sum_pre_per_token", D),
    stepWallPerCandidateGroup: stat("derived/step_wall_per_candidate_group", D),
    judgingOverStepBudget: stat("derived/judging_over_step_budget", D),
    scoreRubricMean: stat("derived/score_rubric_mean", D),
    groupsFailedShareOfAttempted: stat("derived/groups_failed_share_of_attempted", D),
    judgedShareOfTotal: stat("derived/judged_share_of_total", D),
    attemptedShareOfTotal: stat("derived/attempted_share_of_total", D),
    judgeSuccessRateFromCounts: stat("derived/judge_success_rate_from_counts", D),
    // 归一化率（按判完组数）——替代看板缺失的官方 rate
    normalizedRatesPerJudgedGroup: Object.fromEntries(
      Object.keys(D)
        .filter((k) => k.startsWith("derived/") && k.endsWith("_per_judged_group"))
        .map((k) => [k, stat(k, D)]),
    ),
  };


  const scgHarnesses = [...new Set(
    Object.keys(series)
      .filter((k) => k.startsWith(SCG + "harness/"))
      .map((k) => k.match(/harness-(.+?)\//)![1]),
  )].sort();
  const trainHarnesses = [...new Set(
    Object.keys(series)
      .filter((k) => k.startsWith("train/harness/"))
      .map((k) => k.match(/harness-(.+?)\/training/)![1]),
  )].sort();
  const harness = {
    scg: {
      allTagNames: scgHarnesses,
      withData: scgHarnesses.filter((h) => clean(series[`${SCG}harness/harness-${h}/groups_attempted`]).length > 0),
      perHarness: Object.fromEntries(scgHarnesses.map((h) => [h, {
        nFieldsWithData: Object.keys(series).filter(
          (k) => k.startsWith(`${SCG}harness/harness-${h}/`) && clean(series[k]).length > 0,
        ).length,
        groupsAttempted: stat(`${SCG}harness/harness-${h}/groups_attempted`, series),
        groupsJudged: stat(`${SCG}harness/harness-${h}/groups_judged`, series),
        probeDisagree: stat(`${SCG}harness/harness-${h}/select_probe_disagree_rate`, series),
      }])),
      sharePerStep: Array.from({ length: n }, (_, i) => {
        const vals = ["A", "B", "C", "D"].map((h) => series[`${SCG}harness/harness-${h}/groups_attempted`]?.[i] ?? null);
        const tot = vals.reduce((a, b) => a + (b ?? 0), 0);
        return { step: steps[i], values: vals, shares: vals.map((v) => (v !== null && tot ? v / tot : null)) };
      }),
    },
    train: {
      allTagNames: trainHarnesses,
      perHarness: Object.fromEntries(trainHarnesses.map((h) => [h, {
        firstStep: stat(`train/harness/harness-${h}/training/rollouts`, series).firstStep,
        lastStep: stat(`train/harness/harness-${h}/training/rollouts`, series).lastStep,
        n: stat(`train/harness/harness-${h}/training/rollouts`, series).n,
        rolloutsMean: stat(`train/harness/harness-${h}/training/rollouts`, series).mean,
        rolloutsFirst: stat(`train/harness/harness-${h}/training/rollouts`, series).first,
        rolloutsLast: stat(`train/harness/harness-${h}/training/rollouts`, series).last,
      }])),
      totalPerStep: Array.from({ length: n }, (_, i) => {
        let t = 0, c = 0;
        for (const h of trainHarnesses.filter((x) => !x.endsWith("-pw"))) {
          const v = series[`train/harness/harness-${h}/training/rollouts`]?.[i];
          if (v !== null && v !== undefined) { t += v; c++; }
        }
        return { step: steps[i], total: t, contributingHarnesses: c };
      }),
    },
  };

  /* ---------- 奖励分布形状 ---------- */
  const shape = (() => {
    const shareEq = (arr: V[], v: number) => {
      const c = clean(arr);
      return c.length ? c.filter((x) => Math.abs(x - v) < 1e-12).length / c.length : null;
    };
    const global = {
      scoreMaxEq1Share: shareEq(series["critic/score/max"] ?? [], 1),
      scoreMinAtFloorShare: shareEq(series["critic/score/min"] ?? [], -0.8),
      scoreMinBelowHalfShare: (() => {
        const c = clean(series["critic/score/min"] ?? []);
        return c.length ? c.filter((x) => x <= -0.5).length / c.length : null;
      })(),
      advMaxAbove1Share: (() => {
        const c = clean(series["critic/advantages/max"] ?? []);
        return c.length ? c.filter((x) => x > 1.1).length / c.length : null;
      })(),
      advMinBelow1Share: (() => {
        const c = clean(series["critic/advantages/min"] ?? []);
        return c.length ? c.filter((x) => x < -1.1).length / c.length : null;
      })(),
      maxMinusMean: Array.from({ length: n }, (_, i) => {
        const a = series["critic/score/max"]?.[i], b = series["critic/score/mean"]?.[i];
        return a === null || a === undefined || b === null || b === undefined ? null : a - b;
      }),
      meanMinusMin: Array.from({ length: n }, (_, i) => {
        const a = series["critic/score/mean"]?.[i], b = series["critic/score/min"]?.[i];
        return a === null || a === undefined || b === null || b === undefined ? null : a - b;
      }),
      advAbsMeanUpperBound: Array.from({ length: n }, (_, i) => {
        const a = series["critic/advantages/mean"]?.[i], b = series["critic/advantages/min"]?.[i];
        if (a === null || a === undefined || b === null || b === undefined) return null;
        return Math.abs(a) / Math.abs(b);
      }),
    };
    const perDatasetSummary = Object.fromEntries(Object.entries(perDataset).map(([ds, m]) => {
      const sm = m["score/mean"], smin = m["score/min"], smax = m["score/max"];
      const am = m["advantages/mean"], amin = m["advantages/min"], amax = m["advantages/max"];
      return [ds, {
        nSteps: sm ? sm.n : 0,
        scoreMean: sm ? { first: sm.first, last: sm.last, delta: sm.delta, min: sm.min, max: sm.max, trend: sm.trend } : null,
        scoreMin: smin ? { first: smin.first, last: smin.last, min: smin.min, max: smin.max, atFloorShare: smin.values.filter((x) => x !== null && Math.abs((x as number) + 0.8) < 1e-12).length / (smin.n || 1), trend: smin.trend } : null,
        scoreMax: smax ? { nDistinct: smax.nDistinct, modalValue: smax.modalValue, modalShare: smax.modalShare, min: smax.min, max: smax.max } : null,
        advMean: am ? { first: am.first, last: am.last, min: am.min, max: am.max, trend: am.trend } : null,
        advMin: amin ? { first: amin.first, last: amin.last, min: amin.min, max: amin.max, trend: amin.trend } : null,
        advMax: amax ? { first: amax.first, last: amax.last, min: amax.min, max: amax.max, modalShare: amax.modalShare, nDistinct: amax.nDistinct, trend: amax.trend } : null,
      }];
    }));
    const datasetAggregates = {
      nDatasetsWithScoreMean: Object.values(perDatasetSummary).filter((v: any) => v.scoreMean && v.scoreMean.first != null).length,
      nDatasetsScoreMinZeroAtBothEnds: Object.values(perDatasetSummary).filter(
        (v: any) => v.scoreMin && v.scoreMin.first === 0 && v.scoreMin.last === 0,
      ).length,
      nDatasetsScoreMinHitFloor: Object.values(perDatasetSummary).filter(
        (v: any) => v.scoreMin && v.scoreMin.atFloorShare > 0,
      ).length,
      nDatasetsScoreMeanUp: Object.values(perDatasetSummary).filter(
        (v: any) => v.scoreMean && v.scoreMean.delta != null && v.scoreMean.delta > 0.005,
      ).length,
      nDatasetsScoreMeanDown: Object.values(perDatasetSummary).filter(
        (v: any) => v.scoreMean && v.scoreMean.delta != null && v.scoreMean.delta < -0.005,
      ).length,
      nDatasetsScoreMeanFlat: Object.values(perDatasetSummary).filter(
        (v: any) => v.scoreMean && v.scoreMean.delta != null && Math.abs(v.scoreMean.delta) <= 0.005,
      ).length,
      nDatasetsWithoutScoreMean: Object.values(perDatasetSummary).filter((v: any) => !v.scoreMean || v.scoreMean.first == null).length,
    };
    return {
      global,
      datasetAggregates,
      maxMinusMeanStat: stat("derived/_maxMinusMean", { "derived/_maxMinusMean": global.maxMinusMean }),
      meanMinusMinStat: stat("derived/_meanMinusMin", { "derived/_meanMinusMin": global.meanMinusMin }),
      advAbsMeanUpperBoundStat: stat("derived/_advAbsMeanUpperBound", { "derived/_advAbsMeanUpperBound": global.advAbsMeanUpperBound }),
      perDatasetSummary,
    };
  })();

  /* ---------- 池子收缩分解：avg@n = p1 + M * m ---------- */
  const poolDecomposition = (() => {
    const zero = series["dynsam/passrate/zero"] ?? [];
    const one = series["dynsam/passrate/one"] ?? [];
    const avg = series["dynsam/avg@n"] ?? [];
    const rows = [] as Array<Record<string, number | null>>;
    for (let i = 0; i < n; i++) {
      const z = zero[i], o = one[i], a = avg[i];
      if (z === null || z === undefined || o === null || o === undefined || a === null || a === undefined) {
        rows.push({ step: steps[i], p0: null, p1: null, M: null, avgN: null, mImplied: null });
        continue;
      }
      const M = 1 - z - o;
      rows.push({ step: steps[i], p0: z, p1: o, M, avgN: a, mImplied: M !== 0 ? (a - o) / M : null });
    }
    const valid = rows.filter((r) => r.M !== null) as Array<{ step: number; p0: number; p1: number; M: number; avgN: number; mImplied: number }>;
    const first = valid[0], last = valid[valid.length - 1];
    const Mbar = (first.M + last.M) / 2;
    const mbar = (first.mImplied + last.mImplied) / 2;
    const dAvg = last.avgN - first.avgN;
    const dP1 = last.p1 - first.p1;
    const dM = last.M - first.M;
    const dm = last.mImplied - first.mImplied;
    const termP1 = dP1;
    const termPoolLoss = mbar * dM;
    const termWithinPool = Mbar * dm;
    const interaction = dAvg - (termP1 + termPoolLoss + termWithinPool);
    // 半段增速：看 avg@n 的增量是否在放缓
    const half = Math.floor(valid.length / 2);
    const incr = diffs(valid.map((r) => r.avgN));
    return {
      first, last,
      delta: { avgN: dAvg, p1: dP1, M: dM, m: dm },
      decomposition: {
        // 逐项分解：Δavg@n = Δp1 + m̄·ΔM + M̄·Δm + 交互残差
        termFromMastery: termP1,
        termFromPoolShrink: termPoolLoss,
        termFromWithinPool: termWithinPool,
        interactionResidual: interaction,
        checkSum: termP1 + termPoolLoss + termWithinPool + interaction,
      },
      mbar, Mbar,
      rows,
      avgNIncrementStats: {
        n: incr.length,
        firstHalfMean: mean(incr.slice(0, half)),
        secondHalfMean: mean(incr.slice(half)),
        slope: ols(incr.map((_, i) => i + 1), incr).slope,
        rWithIncrementIndex: pearson(incr.map((_, i) => i + 1), incr).r,
        pWithIncrementIndex: pearson(incr.map((_, i) => i + 1), incr).p,
      },
      trainBatchPool: {
        firstTrainable: D["derived/trainable_share_trainbatch"][0],
        lastTrainable: D["derived/trainable_share_trainbatch"].filter((x) => x !== null).slice(-1)[0],
        note: "train/passrate/* 的分母口径与 dynsam/passrate/* 不同，两者不能互相换算；见报告口径一节",
      },
    };
  })();

  /* ---------- 判分成本模型 ---------- */
  const costModel = {
    graderSecondsPerStep: stat("derived/grader_sec_per_step", D),
    graderSecondsPerTrainedRollout: stat("derived/grader_sec_per_trained_rollout", D),
    graderSecondsPerCandidateGroup: stat("derived/grader_sec_per_candidate_group", D),
    requiredGraderSlots: stat("derived/required_grader_slots", D),
    observedInFlight: stat(SCG + "judge_pool_in_flight", series),
    observedPending: stat(SCG + "judge_pending", series),
    observedMaxLoad: stat(SCG + "judge_pool_max_load", series),
    stepResidualSeconds: stat("derived/step_residual_sec", D),
    genPlusTrainShareOfStep: stat("derived/gen_plus_train_share_of_step", D),
    stepWallSeconds: stat("timing_s/step", series),
    outerGenSeconds: stat("timing_s/outer_gen", series),
    trainerOpsSeconds: stat("timing_s/trainer_ops", series),
    perGroupJudgingSeconds: stat(SCG + "time_total_sec_mean", series),
    perGroupPodSetupSeconds: stat(SCG + "time_pod_setup_sec_mean", series),
    perGroupPass1Seconds: stat(SCG + "time_pass1_sec_mean", series),
    pass2Seconds: stat(SCG + "time_pass2_sec_mean", series),
    passTurnsMean: stat(SCG + "select_pass_turns_mean", series),
    tokensPerStep: stat("perf/total_num_tokens", series),
    envActive: stat("env/active", series),
    envTotalSetup: stat("env/total_setup", series),
    podSetupShareOfJudging: (() => {
      const a = clean(series[SCG + "time_pod_setup_sec_mean"] ?? []);
      const b = clean(series[SCG + "time_total_sec_mean"] ?? []);
      const k = Math.min(a.length, b.length);
      const vals = Array.from({ length: k }, (_, i) => a[i] / b[i]);
      return { values: vals, mean: mean(vals), min: Math.min(...vals), max: Math.max(...vals) };
    })(),
  };

  /* ---------- 相关系数对 ---------- */
  const pairs: Array<[string, string, string]> = [
    ["entropy vs avg@n", "actor/entropy_loss", "dynsam/avg@n"],
    ["entropy vs score/mean", "actor/entropy_loss", "critic/score/mean"],
    ["advantages/mean vs avg@n", "critic/advantages/mean", "dynsam/avg@n"],
    ["advantages/min vs avg@n", "critic/advantages/min", "dynsam/avg@n"],
    ["advantages/max vs avg@n", "critic/advantages/max", "dynsam/avg@n"],
    ["score/mean vs avg@n", "critic/score/mean", "dynsam/avg@n"],
    ["score/min vs avg@n", "critic/score/min", "dynsam/avg@n"],
    ["passrate_one vs avg@n", "dynsam/passrate/one", "dynsam/avg@n"],
    ["passrate_zero vs avg@n", "dynsam/passrate/zero", "dynsam/avg@n"],
    ["trainable pool share vs avg@n", "derived/trainable_share_dynsam", "dynsam/avg@n"],
    ["probe_disagree vs step", "penalty/stage_credit_group/select_probe_disagree_rate", "training/global_step"],
    ["probe_disagree vs avg@n", "penalty/stage_credit_group/select_probe_disagree_rate", "dynsam/avg@n"],
    ["above_gold vs step", "penalty/stage_credit_group/select_above_gold_share", "training/global_step"],
    ["above_gold vs avg@n", "penalty/stage_credit_group/select_above_gold_share", "dynsam/avg@n"],
    ["score_P_mean vs step", "penalty/stage_credit_group/select_score_P_mean", "training/global_step"],
    ["score_P_mean vs avg@n", "penalty/stage_credit_group/select_score_P_mean", "dynsam/avg@n"],
    ["score_S_mean vs step", "penalty/stage_credit_group/select_score_S_mean", "training/global_step"],
    ["factor_mean vs step", "penalty/stage_credit_group/select_factor_mean", "training/global_step"],
    ["renorm_k vs step", "penalty/stage_credit_group/select_renorm_k_mean", "training/global_step"],
    ["hack_attempt_rate vs step", "penalty/stage_credit_group/select_hack_attempt_rate", "training/global_step"],
    ["hack_attempt_rate vs avg@n", "penalty/stage_credit_group/select_hack_attempt_rate", "dynsam/avg@n"],
    ["hack_attempt_count vs step", "penalty/stage_credit_group/select_hack_attempt", "training/global_step"],
    ["hack_exposed_not_relied vs step", "penalty/stage_credit_group/select_hack_exposed_not_relied", "training/global_step"],
    ["pass_new_tests_rate vs step", "penalty/stage_credit_group/select_pass_new_tests_rate", "training/global_step"],
    ["time_total vs step", "penalty/stage_credit_group/time_total_sec_mean", "training/global_step"],
    ["time_total vs groups_judged", "penalty/stage_credit_group/time_total_sec_mean", "penalty/stage_credit_group/groups_judged"],
    ["pass_turns_mean vs step", "penalty/stage_credit_group/select_pass_turns_mean", "training/global_step"],
    ["groups_judged vs step", "penalty/stage_credit_group/groups_judged", "training/global_step"],
    ["groups_total vs step", "penalty/stage_credit_group/groups_total", "training/global_step"],
    ["end2end_success vs step", "penalty/stage_credit_group/end2end_success_rate", "training/global_step"],
    ["neg_scale vs neg_mass_added", "penalty/signed/neg_scale", "penalty/signed/neg_mass_added"],
    ["neg_hit_tokens vs step", "penalty/signed/neg_hit_tokens", "training/global_step"],
    ["pos_hit_tokens vs step", "penalty/signed/pos_hit_tokens", "training/global_step"],
    ["adv_pos_sum_pre vs tokens", "train/adv_pos_sum_pre_penalty", "perf/total_num_tokens"],
    ["avg@n vs step", "dynsam/avg@n", "training/global_step"],
    ["num_measurable vs step", "dynsam/num_measurable", "training/global_step"],
    ["num_measurable vs avg@n", "dynsam/num_measurable", "dynsam/avg@n"],
    ["agg_turn vs step", "dynsam/agg_turn/mean", "training/global_step"],
    ["grad_norm vs step", "actor/grad_norm", "training/global_step"],
    ["pg_loss vs step", "actor/pg_loss", "training/global_step"],
    ["entropy vs step", "actor/entropy_loss", "training/global_step"],
  ];
  const correlations: Record<string, PairResult> = {};
  for (const [label, ka, kb] of pairs) {
    const a = ka === "training/global_step" ? steps : (series[ka] ?? D[ka]);
    const b = kb === "training/global_step" ? steps : (series[kb] ?? D[kb]);
    correlations[label] = pairCorr(a as V[], b as V[]);
  }

  const wallSpan = walls[walls.length - 1] - walls[0];
  const reportedStep = clean(series["timing_s/step"] ?? []).reduce((a, b) => a + b, 0);

  out[run] = {
    run,
    steps,
    walls,
    runStart: axis.run_start,
    wallSpanHours: wallSpan / 3600,
    reportedStepSeconds: reportedStep,
    timingGapHours: (wallSpan - reportedStep) / 3600,
    stats,
    groups,
    perDataset,
    identities,
    compositeChecks,
    constancy,
    derived: D,
    shape,
    poolDecomposition,
    costModel,
    harness,
    coverage,
    envCounterResets,
    noticeAlignment,
    versionShift,
    versionHistory,
    correlations,
  } as RunOut;
}

/* ------------------------------------------------------------------ */
/* 跨 run 汇总                                                         */
/* ------------------------------------------------------------------ */

const summary: Record<string, unknown> = {};
for (const run of RUNS) {
  const r = out[run] as RunOut;
  const g = (grp: string, k: string) => r.groups[grp][k];
  summary[run] = {
    steps: r.steps.length,
    scoreMean: g("globalReward", "critic/score/mean"),
    scoreMin: g("globalReward", "critic/score/min"),
    scoreMax: g("globalReward", "critic/score/max"),
    advantagesMean: g("globalReward", "critic/advantages/mean"),
    advantagesMin: g("globalReward", "critic/advantages/min"),
    advantagesMax: g("globalReward", "critic/advantages/max"),
    avgN: g("pool", "dynsam/avg@n"),
    entropy: g("policy", "actor/entropy_loss"),
    probeDisagree: g("graderQuality", "penalty/stage_credit_group/select_probe_disagree_rate"),
    aboveGold: g("graderScore", "penalty/stage_credit_group/select_above_gold_share"),
    hackRate: g("hack", "penalty/stage_credit_group/select_hack_attempt_rate"),
    end2end: g("graderTraffic", "penalty/stage_credit_group/end2end_success_rate"),
    timeTotal: g("cost", "penalty/stage_credit_group/time_total_sec_mean"),
  };
}

const result = {
  meta: {
    generatedBy: "src/reward_report.ts",
    repoRoot: ROOT,
    inputs: {
      series: RUNS.map((r) => `data/store/runs/${r}/series.json`),
      axis: RUNS.map((r) => `data/store/runs/${r}/axis.json`),
      tags: RUNS.map((r) => `data/store/runs/${r}/tags.json`),
      notices: "data/store/notices.json",
    },
    statsPerRun: Object.fromEntries(RUNS.map((r) => [r, Object.keys((out[r] as RunOut).stats).length])),
    notes: [
      "所有序列均为逐步上报值，下标与 axis.json 的 steps 一一对应；null 表示该步未上报。",
      "相关性一律给样本量 n；水平相关在两条序列都随步单调变化时天然虚高，故同时给一阶差分相关与去线性趋势残差相关。",
      "p 值为双侧 t 检验（H0: r=0），由脚本内实现的不完全 beta 函数计算，未使用近似正态。",
      "本文件只放统计量，不含结论文字；报告中的每个数字都能在此按 key 复算。",
    ],
  },
  notices,
  runs: out,
  summary,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
console.log(`written: ${OUT}`);
console.log(`size: ${(JSON.stringify(result).length / 1024).toFixed(1)} KiB`);

/* 人读摘要：把 summary 里每个 run 的关键序列首末值、趋势与"是不是常数"打出来。
   报告里的每个数字仍然以 JSON 为准，这里只是省得读者去翻 1.4 MB 的文件。 */
const fmt = (v: any, d = 5) => (v == null ? "—" : Number(v).toFixed(d));
for (const run of RUNS) {
  const sm = (result.summary as any)?.[run];
  if (!sm) continue;
  console.log(`\n===== ${run}  steps=${sm.steps}`);
  for (const [name, st] of Object.entries(sm)) {
    if (!st || typeof st !== "object" || !("key" in (st as any))) continue;
    const t = (st as any).trend ?? {};
    const flags = [
      (st as any).allZero ? "always 0" : null,
      (st as any).constant ? `constant=${(st as any).constantValue}` : null,
      (st as any).nDistinct === 1 ? `only 1 distinct value=${(st as any).modalValue}` : null,
    ].filter(Boolean).join(" ");
    console.log(
      `  ${String((st as any).key).padEnd(48)} ${fmt((st as any).first)} → ${fmt((st as any).last)}` +
      `  n=${(st as any).n}${(st as any).nMissing ? `(missing ${(st as any).nMissing})` : ""}` +
      (t.rLevel != null ? `  r=${fmt(t.rLevel, 3)} p=${t.pLevel == null ? "—" : Number(t.pLevel).toExponential(1)}` : "") +
      (t.rDiff != null ? `  diff r=${fmt(t.rDiff, 3)}` : "") +
      (flags ? `  [${flags}]` : ""),
    );
  }
}
