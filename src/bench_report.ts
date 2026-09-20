#!/usr/bin/env bun
/**
 * bench_report.ts
 * MiMo-V2.6 RL 看板遥测数据 —— 离线评测榜的「测量误差 / 趋势 / 滞后 / 饱和外推」分析。
 *
 * 运行（项目根目录）：
 *   bun src/bench_report.ts
 *
 * 读取（只读）：
 *   data/store/benchmarks.json          三个离线榜的稀疏逐步成绩
 *   data/store/notices.json             5 条公告
 *   data/store/runs/{pro,flash}/series.json   全量训练指标
 *   data/store/runs/{pro,flash}/axis.json     {steps, walls, run_start}
 *   data/store/runs/{pro,flash}/status.json   {events, totals, cost}
 *
 * 产物：
 *   analysis/zh-CN/numbers/A3-bench-numbers.json    全部复算数字（机器可读）
 *   stdout                                                   人读摘要
 *
 * 设计原则：脚本里不写任何结论数字。所有数字从原始 JSON 复算。
 * 随机数一律走固定种子的确定性 PRNG（mulberry32），保证多次运行结果逐位一致。
 * 不引入任何新依赖：自相关、Newey-West、置换检验、bootstrap、非线性拟合都自己实现。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STORE = resolve(ROOT, "mimo-rl-telemetry", "data", "store");
const OUT_JSON = resolve(ROOT, "analysis/zh-CN", "analysis", "A3-bench-numbers.json");
const SEED = 20260919;

// ===========================================================================
// 0. 基础设施：PRNG、统计工具、分布函数
// ===========================================================================

/** mulberry32：固定种子确定性 PRNG */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);
function variance(a: number[]) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return sum(a.map((v) => (v - m) ** 2)) / (a.length - 1);
}
const sd = (a: number[]) => Math.sqrt(variance(a));
function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
const mad = (a: number[]) => median(a.map((v) => Math.abs(v - median(a))));
/** 稳健标准差：MAD × 1.4826（正态一致估计） */
const madSd = (a: number[]) => mad(a) * 1.4826;

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function pearson(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { r: NaN, n, p: NaN };
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { r: NaN, n, p: NaN };
  const r = sxy / Math.sqrt(sxx * syy);
  const rp = Math.max(-0.999999999, Math.min(0.999999999, r));
  const t = rp * Math.sqrt((n - 2) / (1 - rp * rp));
  return { r, n, p: twoSidedT(t, n - 2) };
}

function rank(a: number[]) {
  const idx = a.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
  const r = new Array(a.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k].i] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { r: NaN, n, p: NaN };
  const a = rank(x.slice(0, n)), b = rank(y.slice(0, n));
  return pearson(a, b);
}

// --- 不完全 Beta / Student-t（自己实现，避免依赖） ---
function logGamma(x: number) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a: number, b: number, x: number) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a: number, b: number, x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** 双尾 p 值 P(|T_df| >= |t|) */
function twoSidedT(t: number, df: number) {
  if (!isFinite(t) || df <= 0) return NaN;
  return betai(df / 2, 0.5, df / (df + t * t));
}
function tCrit(df: number, alpha = 0.05) {
  let lo = 0, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (twoSidedT(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Pearson |r| 的 0.05 双尾临界值（n 个点） */
function critR(n: number, alpha = 0.05) {
  if (n < 4) return NaN;
  const tc = tCrit(n - 2, alpha);
  return tc / Math.sqrt(tc * tc + (n - 2));
}
/** 卡方分位数（Wilson–Hilferty 近似），用于 σ 的置信区间 */
function chi2Quantile(p: number, k: number) {
  const z = normInv(p);
  const t = 1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k));
  return k * t * t * t;
}
function normInv(p: number) {
  // Acklam 近似
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// --- 回归 ---
function ols(x: number[], y: number[]) {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const resid = y.map((v, i) => v - (intercept + slope * x[i]));
  const sse = sum(resid.map((r) => r * r));
  const dof = n - 2;
  const sigma = Math.sqrt(sse / dof);
  const seSlope = sigma / Math.sqrt(sxx);
  return { slope, intercept, resid, sse, sigma, seSlope, dof, sxx, n };
}
/** Theil–Sen 稳健斜率 + 中位截距 */
function theilSen(x: number[], y: number[]) {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++)
    for (let j = i + 1; j < x.length; j++)
      if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
  const slope = median(slopes);
  const intercept = median(y.map((v, i) => v - slope * x[i]));
  const resid = y.map((v, i) => v - (intercept + slope * x[i]));
  return { slope, intercept, resid, sigma: madSd(resid), nSlopes: slopes.length };
}
/** Newey–West HAC 标准误（对 OLS 斜率） */
function neweyWest(x: number[], y: number[], lagOverride?: number) {
  const fit = ols(x, y);
  const n = x.length;
  const mx = mean(x);
  const u = x.map((v, i) => (v - mx) * fit.resid[i]);
  const L = lagOverride ?? Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
  let s = sum(u.map((v) => v * v));
  for (let l = 1; l <= L; l++) {
    let acc = 0;
    for (let t = l; t < n; t++) acc += u[t] * u[t - l];
    s += 2 * (1 - l / (L + 1)) * acc;
  }
  const se = Math.sqrt(Math.max(s, 1e-300)) / fit.sxx;
  const t = fit.slope / se;
  return { se, t, p: twoSidedT(t, n - 2), lag: L, slope: fit.slope };
}
/** 残差 lag-1 自相关 */
function lag1Autocorr(r: number[]) {
  const m = mean(r);
  const c = r.slice(0, -1).map((v, i) => (v - m) * (r[i + 1] - m));
  const v = r.map((x) => (x - m) ** 2);
  return sum(c) / sum(v);
}
/** AR(1) 下的有效样本量 */
function effN(n: number, rho: number) {
  const r = Math.max(-0.99, Math.min(0.99, rho));
  return n * (1 - r) / (1 + r);
}

function bootstrapCI(n: number, stat: (idx: number[]) => number, B: number) {
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = Math.floor(rng() * n);
    const v = stat(idx);
    if (isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return {
    lo: quantile(vals, 0.025), hi: quantile(vals, 0.975),
    median: quantile(vals, 0.5), n_valid: vals.length, width: quantile(vals, 0.975) - quantile(vals, 0.025),
  };
}

// ===========================================================================
// 1. 读数
// ===========================================================================
const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));

interface Pt { step: number; value: number }

const benchmarks: any[] = jread(resolve(STORE, "benchmarks.json"));
const notices: any[] = jread(resolve(STORE, "notices.json"));

const RUNS = ["pro", "flash"] as const;
type RunKey = (typeof RUNS)[number];

const runs: Record<string, any> = {};
for (const r of RUNS) {
  const base = resolve(STORE, "runs", r);
  runs[r] = {
    series: jread(resolve(base, "series.json")) as Record<string, (number | null)[]>,
    axis: jread(resolve(base, "axis.json")) as { steps: number[]; walls: number[]; run_start: number },
    status: jread(resolve(base, "status.json")),
  };
}

function benchSeries(b: any, run: RunKey): Pt[] {
  const obj = b.results?.[run] ?? {};
  return Object.keys(obj).map(Number).sort((a, b2) => a - b2).map((s) => ({ step: s, value: obj[String(s)] }));
}
function metricAt(run: RunKey, name: string, step: number): number | null {
  const arr = runs[run].series[name];
  if (!arr || step < 1 || step > arr.length) return null;
  const v = arr[step - 1];
  return v === null || v === undefined || !isFinite(v as number) ? null : (v as number);
}
function metricSeries(run: RunKey, name: string): Pt[] {
  const arr = runs[run].series[name] || [];
  const out: Pt[] = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v !== null && v !== undefined && isFinite(v as number)) out.push({ step: i + 1, value: v as number });
  }
  return out;
}
function wallOf(run: RunKey, step: number) { return runs[run].axis.walls[step - 1]; }
function costAtStep(run: RunKey, step: number) {
  const rate = runs[run].status.cost.rate_per_s;
  return rate * (wallOf(run, step) - runs[run].axis.run_start);
}
const tokenSeriesCache: Record<string, number[]> = {};
function cumTokens(run: RunKey): number[] {
  if (tokenSeriesCache[run]) return tokenSeriesCache[run];
  const per = runs[run].series["perf/total_num_tokens"] as number[];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < per.length; i++) { acc += per[i]; out.push(acc); }
  tokenSeriesCache[run] = out;
  return out;
}
function tokensAtStep(run: RunKey, step: number) { return cumTokens(run)[step - 1]; }

const TRAIN_METRICS = [
  "dynsam/avg@n",
  "train/passrate/avg_passrate",
  "ctx_response_length/mean",
  "critic/score/mean",
];

const seriesList: { bench: string; benchTitle: string; run: RunKey; pts: Pt[] }[] = [];
for (const b of benchmarks) for (const r of RUNS) seriesList.push({ bench: b.key, benchTitle: b.title, run: r, pts: benchSeries(b, r) });

const MAIN = "dynsam/avg@n";

const OUT: any = {
  meta: {
    script: "src/bench_report.ts",
    run_command: "bun src/bench_report.ts",
    seed: SEED,
    note: "全部数字由脚本从 data/store/ 的原始 JSON 复算；脚本内无硬编码结论数字。",
    benches: benchmarks.map((b) => ({ key: b.key, title: b.title, note: b.note, format: b.format })),
  },
};

// ===========================================================================
// 2. 第一节：单步测量噪声与最小可检测变化（MDE）
// ===========================================================================
function mdeForSeries(label: string, benchTitle: string, run: RunKey, pts: Pt[]) {
  const steps = pts.map((p) => p.step);
  const vals = pts.map((p) => p.value);
  const diffs: { from: number; to: number; gap: number; diff: number }[] = [];
  for (let i = 1; i < pts.length; i++)
    diffs.push({ from: pts[i - 1].step, to: pts[i].step, gap: pts[i].step - pts[i - 1].step, diff: pts[i].value - pts[i - 1].value });

  const dAll = diffs.map((d) => d.diff);
  const dAdj = diffs.filter((d) => d.gap === 1).map((d) => d.diff);
  const sdAdj = sd(dAdj);
  const madAdj = madSd(dAdj);

  const ts = theilSen(steps, vals);
  const residSd = sd(ts.resid);            // 主口径：趋势残差的普通标准差
  const residSdRobust = madSd(ts.resid);   // 稳健对照

  // MDE：单点测量噪声 σ_pt 已知时，相邻两步之差的噪声是 σ_pt·√2
  //   MDE_95 = 1.96 · σ_pt · √2 = 2.7716 · σ_pt
  const K = 1.96 * Math.SQRT2;
  const sdPtFromAdjRaw = sdAdj / Math.SQRT2;       // 假设 Δ 的噪声 iid：σ_Δ=σ_pt√2
  const sdPtFromAdjRobust = madAdj / Math.SQRT2;
  // 主口径取「趋势残差 SD」与「残差 MAD」中较大者（保守）
  const sdPtPrimary = Math.max(residSd, residSdRobust);
  const sdPt = sdPtPrimary;

  const pMean = mean(vals);
  const impliedN = (s: number) => (s > 0 ? (pMean * (100 - pMean)) / (s * s) : NaN);
  // σ 的 χ² 区间 → N 的区间（反比平方）
  const m = Math.max(2, dAdj.length);
  const chiLo = chi2Quantile(0.025, m), chiHi = chi2Quantile(0.975, m);
  const sdAdjLo = sdAdj * Math.sqrt(m / chiHi), sdAdjHi = sdAdj * Math.sqrt(m / chiLo);
  const nFromSd = (s: number) => impliedN(s / Math.SQRT2);
  // 残差口径的 σ 区间（自由度 n−2）
  const dfRes = Math.max(1, vals.length - 2);
  const residSdLo = residSd * Math.sqrt(dfRes / chi2Quantile(0.975, dfRes));
  const residSdHi = residSd * Math.sqrt(dfRes / chi2Quantile(0.025, dfRes));

  const entries: any[] = [];
  const critRaw = K * sdPtFromAdjRaw;
  const critPrimary = K * sdPt;
  for (const d of diffs) {
    const expected = ts.slope * d.gap;
    const dev = d.diff - expected;
    const zRaw = d.diff / (sdPtFromAdjRaw * Math.SQRT2);
    const zTrend = dev / (sdPt * Math.SQRT2);
    const pRaw = 2 * (1 - normCdf(Math.abs(zRaw)));
    const pTrend = 2 * (1 - normCdf(Math.abs(zTrend)));
    entries.push({
      bench: label, run, from: d.from, to: d.to, gap: d.gap,
      v_from: vals[steps.indexOf(d.from)], v_to: vals[steps.indexOf(d.to)],
      diff: d.diff, trend_expect: expected, dev_from_trend: dev,
      z_raw: zRaw, z_trend: zTrend, p_raw_norm: pRaw, p_trend_norm: pTrend,
      verdict_raw: Math.abs(d.diff) > critRaw ? (d.diff > 0 ? "up (over raw MDE)" : "down (over raw MDE)") : "within noise",
      verdict_primary: Math.abs(dev) > critPrimary ? (dev > 0 ? "above trend (over MDE)" : "below trend (over MDE)") : "consistent with trend / within noise",
      mde_raw: critRaw, mde_primary: critPrimary,
      naive_significant_5pct: pRaw < 0.05,
    });
  }

  const first = vals[0], last = vals[vals.length - 1];
  const stat = {
    bench: label, benchTitle, run,
    n: pts.length, steps, values: vals,
    step_first: steps[0], step_last: steps[steps.length - 1],
    value_first: first, value_last: last, net_change: last - first,
    n_diffs: diffs.length, n_diffs_adjacent: dAdj.length,
    gap_pattern: diffs.filter((d) => d.gap > 1).map((d) => `${d.from}->${d.to}(+${d.gap})`),
    mean_p_pct: pMean,
    sd_adj_raw: sdAdj, mad_adj_robust: madAdj, sd_diff_all_gaps: sd(dAll),
    mad_over_sd_flag: madAdj > sdAdj ? "MAD×1.4826 > SD: Δ distribution skewed/bimodal (asymmetric around the median); the MAD basis is unreliable on this series" : "ok",
    sd_point_from_adj_raw: sdPtFromAdjRaw,
    sd_point_from_adj_robust: sdPtFromAdjRobust,
    theil_sen_slope_per_step: ts.slope, theil_sen_intercept: ts.intercept,
    resid_sd: residSd, resid_sd_robust: residSdRobust,
    sd_point_primary: sdPt,
    mde_adjacent_raw_95: critRaw,
    mde_adjacent_robust_95: K * sdPtFromAdjRobust,
    mde_primary_95: critPrimary,
    mde_primary_95_ci_from_resid_sd: [K * residSdLo, K * residSdHi],
    implied_N_bernoulli_trials_raw: impliedN(sdPtFromAdjRaw),
    implied_N_bernoulli_trials_primary: impliedN(sdPt),
    implied_N_ci_from_raw_adj_diffs: [nFromSd(sdAdjHi), nFromSd(sdAdjLo)],
    implied_Q_if_3_independent_samples_per_question: impliedN(sdPt) / 3,
    implied_Q_if_3_samples_fully_correlated: impliedN(sdPt),
    note_N: "N = 等效独立伯努利试验数（σ²=p(100−p)/N，p 用百分点）；若每题 3 次独立采样且各题难度同质，则题目数 Q ≈ N/3；若 3 次采样对同一题完全相关（全对/全错），则 Q ≈ N。看板未给题目数，无法外部核对。",
  };
  return { stat, entries };
}

function holmAdjust(rows: any[], pKey: string, flagKey: string) {
  const k = `${rows[0].bench}|${rows[0].run}`;
  const sorted = [...rows].sort((a, b) => a[pKey] - b[pKey]);
  const m = sorted.length;
  let maxReject = -1;
  sorted.forEach((r, i) => { if (r[pKey] <= 0.05 / (m - i)) maxReject = i; });
  sorted.forEach((r, i) => { r[flagKey] = i <= maxReject; });
  return { group: k, m_tests: m, n_significant_naive: sorted.filter((r) => r[pKey] < 0.05).length, n_significant_holm: maxReject + 1, min_p: sorted[0][pKey] };
}

function sectionMDE() {
  const perSeries: any[] = [];
  const table: any[] = [];
  for (const S of seriesList) {
    const { stat, entries } = mdeForSeries(S.bench, S.benchTitle, S.run, S.pts);
    perSeries.push(stat);
    table.push(...entries);
  }
  // 训练侧主指标作为对照（不进榜的判定表，单独放）
  const auxMainMetric: any[] = [];
  const auxTable: any[] = [];
  for (const r of RUNS) {
    const { stat, entries } = mdeForSeries(`dynsam/avg@n`, "在线主指标（非离线榜）", r, metricSeries(r, MAIN));
    auxMainMetric.push(stat);
    auxTable.push(...entries);
  }

  const holm: any[] = [];
  const holmTrend: any[] = [];
  const groups = new Map<string, any[]>();
  for (const row of table) {
    const k = `${row.bench}|${row.run}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }
  for (const [, rows] of groups) {
    holm.push(holmAdjust(rows, "p_raw_norm", "holm_significant"));
    holmTrend.push(holmAdjust(rows, "p_trend_norm", "holm_significant_trend"));
  }
  const holmAux: any[] = [];
  for (const r of RUNS) holmAux.push(holmAdjust(auxTable.filter((x) => x.run === r), "p_raw_norm", "holm_significant"));

  // 反推「等效题目数」在两 run 之间是否一致（一致性越差，说明该反推越不可靠）
  const impliedQAgreement: any[] = [];
  for (const b of benchmarks) {
    const a = perSeries.find((x) => x.bench === b.key && x.run === "pro");
    const c = perSeries.find((x) => x.bench === b.key && x.run === "flash");
    impliedQAgreement.push({
      bench: b.key,
      Q_pro: a ? a.implied_Q_if_3_independent_samples_per_question : null,
      Q_flash: c ? c.implied_Q_if_3_independent_samples_per_question : null,
      ratio_pro_over_flash: a && c ? a.implied_Q_if_3_independent_samples_per_question / c.implied_Q_if_3_independent_samples_per_question : null,
    });
  }
  return { per_series: perSeries, aux_main_metric: auxMainMetric, judgement_table: table, aux_judgement_table: auxTable, holm, holm_trend: holmTrend, holm_aux_main_metric: holmAux, implied_Q_agreement_between_runs: impliedQAgreement };
}

function normCdf(z: number) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function erf(x: number) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// ===========================================================================
// 3. 第二节：趋势（按步号 / 按墙钟）
// ===========================================================================
function sectionTrend() {
  const out: any[] = [];
  for (const S of seriesList) {
    const pts = S.pts;
    const steps = pts.map((p) => p.step);
    const vals = pts.map((p) => p.value);
    const wallsH = pts.map((p) => (wallOf(S.run, p.step) - runs[S.run].axis.run_start) / 3600);
    const n = steps.length;

    const tsStep = theilSen(steps, vals);
    const olsStep = ols(steps, vals);
    const tsWall = theilSen(wallsH, vals);
    const olsWall = ols(wallsH, vals);

    const bStep = bootstrapCI(n, (idx) => theilSen(idx.map((i) => steps[i]), idx.map((i) => vals[i])).slope, 4000);
    const bWall = bootstrapCI(n, (idx) => theilSen(idx.map((i) => wallsH[i]), idx.map((i) => vals[i])).slope, 4000);

    // 最近 k 次评测
    const recent = (k: number) => {
      const v = vals.slice(-k);
      const st = steps.slice(-k);
      if (v.length < 3) return null;
      const t = theilSen(st, v);
      const b = bootstrapCI(v.length, (idx) => theilSen(idx.map((i) => st[i]), idx.map((i) => v[i])).slope, 2000);
      return {
        k, from_step: st[0], to_step: st[st.length - 1],
        value_from: v[0], value_to: v[v.length - 1], net: v[v.length - 1] - v[0],
        slope: t.slope, slope_ci: [b.lo, b.hi], ci_excludes_zero: b.lo > 0 || b.hi < 0,
      };
    };

    out.push({
      bench: S.bench, run: S.run, n, step_first: steps[0], step_last: steps[steps.length - 1],
      theil_sen_slope_per_step: tsStep.slope,
      theil_sen_slope_per_step_ci: [bStep.lo, bStep.hi], theil_sen_ci_excludes_zero: bStep.lo > 0 || bStep.hi < 0,
      ols_slope_per_step: olsStep.slope, ols_se: olsStep.seSlope,
      ols_p: twoSidedT(olsStep.slope / olsStep.seSlope, olsStep.dof),
      ols_r2: 1 - olsStep.sse / sum(vals.map((v) => (v - mean(vals)) ** 2)),
      theil_sen_slope_per_hour: tsWall.slope,
      theil_sen_slope_per_hour_ci: [bWall.lo, bWall.hi], theil_sen_hour_ci_excludes_zero: bWall.lo > 0 || bWall.hi < 0,
      ols_slope_per_hour: olsWall.slope, ols_hour_p: twoSidedT(olsWall.slope / olsWall.seSlope, olsWall.dof),
      wall_span_hours: wallsH[wallsH.length - 1] - wallsH[0],
      recent_last5: recent(5), recent_last8: recent(8),
      per_hour_net: (vals[vals.length - 1] - vals[0]) / (wallsH[wallsH.length - 1] - wallsH[0]),
    });
  }

  // 训练侧主指标作为对照
  const mainTrend: any[] = [];
  for (const r of RUNS) {
    const pts = metricSeries(r, MAIN);
    const x = pts.map((p) => p.step), y = pts.map((p) => p.value);
    const ts = theilSen(x, y); const ol = ols(x, y);
    const b = bootstrapCI(x.length, (idx) => theilSen(idx.map((i) => x[i]), idx.map((i) => y[i])).slope, 4000);
    const rec = (k: number) => {
      const v = y.slice(-k), st = x.slice(-k);
      if (v.length < 3) return null;
      const t2 = theilSen(st, v);
      const bb = bootstrapCI(v.length, (idx) => theilSen(idx.map((i) => st[i]), idx.map((i) => v[i])).slope, 3000);
      const net = v[v.length - 1] - v[0];
      const expected = ts.slope * (st[st.length - 1] - st[0]);
      const residSd = madSd(ts.resid);
      const seNet = residSd * Math.sqrt(2 * (k - 1));
      return {
        k, from_step: st[0], to_step: st[st.length - 1], value_from: v[0], value_to: v[v.length - 1],
        net, expected_from_full_trend: expected, net_minus_expected: net - expected,
        z_of_net_vs_full_trend: (net - expected) / seNet,
        slope: t2.slope, slope_ci95: [bb.lo, bb.hi], slope_ci_excludes_zero: bb.lo > 0 || bb.hi < 0,
      };
    };
    mainTrend.push({
      metric: MAIN, run: r, n: x.length, slope_per_step: ts.slope, ci: [b.lo, b.hi],
      ols_p: twoSidedT(ol.slope / ol.seSlope, ol.dof), first: y[0], last: y[y.length - 1],
      max: Math.max(...y), max_step: x[y.indexOf(Math.max(...y))],
      recent_last5: rec(5), recent_last8: rec(8),
    });
  }
  return { bench_trends: out, main_metric_trends: mainTrend };
}

// ===========================================================================
// 4. 第三节：自相关、有效样本量、置换检验
// ===========================================================================
function sectionAutocorr(mde: any) {
  const out: any[] = [];
  for (const S of seriesList) {
    const pts = S.pts;
    const steps = pts.map((p) => p.step), vals = pts.map((p) => p.value);
    const n = steps.length;
    const ts = theilSen(steps, vals);
    const olsFit = ols(steps, vals);
    const rhoResid = lag1Autocorr(ts.resid);
    const rhoDiff = lag1Autocorr(vals.slice(1).map((v, i) => v - vals[i]));
    const nEffRaw = effN(n, rhoResid);
    const nEff = Math.min(n, nEffRaw);   // ρ<0 时公式给出 >n；有效样本量不应超过 n，此处取上限并在 JSON 里保留原始值
    const nw = neweyWest(steps, vals);

    // (a) 朴素 OLS
    const pNaive = twoSidedT(olsFit.slope / olsFit.seSlope, olsFit.dof);
    // (b) 有效样本量校正
    const seNeff = olsFit.seSlope * Math.sqrt(n / Math.max(1, nEff));
    const tNeff = olsFit.slope / seNeff;
    const pNeff = twoSidedT(tNeff, Math.max(1, nEff - 2));
    // (c) Newey-West
    const pNW = nw.p;
    // (d) 置换检验 1：直接打乱 y（破坏自相关，仅作对照）
    const stat = () => theilSen(steps, vals).slope;
    const obs = stat();
    let cntNaive = 0; const B = 5000;
    for (let b = 0; b < B; b++) {
      const yp = [...vals];
      for (let i = yp.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [yp[i], yp[j]] = [yp[j], yp[i]]; }
      if (Math.abs(theilSen(steps, yp).slope) >= Math.abs(obs)) cntNaive++;
    }
    const pPermNaive = (cntNaive + 1) / (B + 1);
    // (e) 置换检验 2：环形分块置换残差（保留自相关）
    const block = Math.max(2, Math.round(Math.pow(n, 1 / 3)));
    let cntBlock = 0;
    const B2 = 5000;
    for (let b = 0; b < B2; b++) {
      const res = [...ts.resid];
      // 环形分块重排：随机起点取 ceil(n/block) 块拼成 n 长
      const nBlocks = Math.ceil(n / block);
      const starts = Array.from({ length: nBlocks }, () => Math.floor(rng() * n));
      const yp: number[] = [];
      for (const s of starts) for (let k = 0; k < block && yp.length < n; k++) yp.push(res[(s + k) % n]);
      const ynew = yp.map((v) => mean(vals) + v);
      if (Math.abs(theilSen(steps, ynew).slope) >= Math.abs(obs)) cntBlock++;
    }
    const pPermBlock = (cntBlock + 1) / (B2 + 1);
    // (f) 差分符号置换：H0 = 平均单步变化为 0
    const diffs = vals.slice(1).map((v, i) => v - vals[i]);
    const md = median(diffs);
    const centered = diffs.map((d) => d - md);
    const obsMeanDiff = mean(diffs);
    const obsStat = Math.abs(sum(centered));   // 检验 H0：变化量的中位数就是其中心（无系统性漂移）
    let cntSign = 0;
    const B3 = 20000;
    for (let b = 0; b < B3; b++) {
      let acc = 0;
      for (const d of centered) acc += rng() < 0.5 ? d : -d;
      if (Math.abs(acc) >= obsStat) cntSign++;
    }
    const pSignFlip = (cntSign + 1) / (B3 + 1);
    // 符号检验：涨的步数 vs 跌的步数（二项检验正态近似 + 连续校正）
    const nUp = diffs.filter((d) => d > 0).length;
    const nDown = diffs.filter((d) => d < 0).length;
    const nNZ = nUp + nDown;
    const zSign = nNZ ? (Math.abs(nUp - nNZ / 2) - 0.5) / Math.sqrt(nNZ / 4) : NaN;
    const pSignTest = nNZ ? 2 * (1 - normCdf(Math.max(0, zSign))) : NaN;

    out.push({
      bench: S.bench, run: S.run, n,
      rho1_residual: rhoResid, rho1_first_difference: rhoDiff,
      n_eff: nEff, n_eff_formula_raw: nEffRaw, n_eff_capped_at_n: nEffRaw > n, n_eff_ratio: nEff / n,
      slope: olsFit.slope,
      p_ols_naive: pNaive, p_neff_corrected: pNeff, p_newey_west: pNW, nw_lag: nw.lag,
      p_perm_naive_yshuffle: pPermNaive,
      p_perm_block_residual: pPermBlock, block_len: block,
      p_perm_signflip_diff: pSignFlip,
      n_up_steps: nUp, n_down_steps: nDown, p_sign_test: pSignTest,
      mean_diff: obsMeanDiff,
      significant_at_5pct: {
        ols_naive: pNaive < 0.05, neff: pNeff < 0.05, newey_west: pNW < 0.05,
        perm_naive: pPermNaive < 0.05, perm_block: pPermBlock < 0.05, signflip: pSignFlip < 0.05,
      },
    });
  }

  // 全部单步变化里，考虑多重比较后还剩几个显著
  const allChanges = mde.judgement_table;
  const byGroup: any = {};
  for (const row of allChanges) {
    const k = `${row.bench}|${row.run}`;
    byGroup[k] = byGroup[k] || { total: 0, significant_naive: 0, significant_holm: 0, up_naive: 0, down_naive: 0, up_holm: 0, down_holm: 0 };
    const g = byGroup[k];
    g.total++;
    if (row.naive_significant_5pct) { g.significant_naive++; if (row.diff > 0) g.up_naive++; else g.down_naive++; }
    if (row.holm_significant) { g.significant_holm++; if (row.diff > 0) g.up_holm++; else g.down_holm++; }
  }
  const total = {
    changes: allChanges.length,
    significant_naive: allChanges.filter((r) => r.naive_significant_5pct).length,
    significant_holm: allChanges.filter((r) => r.holm_significant).length,
    up_naive: allChanges.filter((r) => r.naive_significant_5pct && r.diff > 0).length,
    down_naive: allChanges.filter((r) => r.naive_significant_5pct && r.diff < 0).length,
    up_holm: allChanges.filter((r) => r.holm_significant && r.diff > 0).length,
    down_holm: allChanges.filter((r) => r.holm_significant && r.diff < 0).length,
  };
  // 用「相对趋势的偏离 + Holm」再数一次
  const byGroupTrend: any = {};
  for (const row of allChanges) {
    const k = `${row.bench}|${row.run}`;
    byGroupTrend[k] = byGroupTrend[k] || { total: 0, significant_holm_trend: 0, up: 0, down: 0 };
    const g = byGroupTrend[k]; g.total++;
  }
  const groups = new Map<string, any[]>();
  for (const row of allChanges) {
    const k = `${row.bench}|${row.run}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }
  for (const [k, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.p_trend_norm - b.p_trend_norm);
    const m = sorted.length;
    let maxReject = -1;
    sorted.forEach((r, i) => { if (r.p_trend_norm <= 0.05 / (m - i)) maxReject = i; });
    sorted.forEach((r, i) => { r.holm_significant_trend = i <= maxReject; });
    byGroupTrend[k].significant_holm_trend = maxReject + 1;
    byGroupTrend[k].up = sorted.filter((r, i) => i <= maxReject && r.dev_from_trend > 0).length;
    byGroupTrend[k].down = sorted.filter((r, i) => i <= maxReject && r.dev_from_trend < 0).length;
  }
  const totalTrend = {
    changes: allChanges.length,
    significant_holm_trend: allChanges.filter((r) => r.holm_significant_trend).length,
    up: allChanges.filter((r) => r.holm_significant_trend && r.dev_from_trend > 0).length,
    down: allChanges.filter((r) => r.holm_significant_trend && r.dev_from_trend < 0).length,
  };
  return { per_series: out, change_counts: { naive: total, holm: total, trend_holm: totalTrend, by_group: byGroup, by_group_trend: byGroupTrend } };
}

// ===========================================================================
// 5. 第四节：滞后结构（互相关扫描）
// ===========================================================================
function sectionLag() {
  const out: any[] = [];
  const bestLDist: any[] = [];
  const LMAX = 8;
  for (const S of seriesList) {
    const benchPts = S.pts;
    const bSteps = benchPts.map((p) => p.step);
    const bVals = benchPts.map((p) => p.value);
    const bTS = theilSen(bSteps, bVals);
    const bResidMap = new Map(bSteps.map((s, i) => [s, bTS.resid[i]]));

    const perMetric: any[] = [];
    for (const mName of TRAIN_METRICS) {
      const mPts = metricSeries(S.run, mName);
      const mMap = new Map(mPts.map((p) => [p.step, p.value]));
      const scan: any[] = [];
      for (let L = 0; L <= LMAX; L++) {
        const xsL: number[] = [], ysL: number[] = [], xr: number[] = [], yr: number[] = [];
        for (const s of bSteps) {
          const ms = s - L;
          if (ms < 1) continue;
          const mv = mMap.get(ms);
          if (mv === undefined) continue;
          xsL.push(mv); ysL.push(bVals[bSteps.indexOf(s)]);
        }
        // 去趋势版本：训练指标在同一批步上做 Theil-Sen 去趋势
        if (xsL.length >= 4) {
          const xsArr = [], tmpIdx: number[] = [];
          for (const s of bSteps) {
            const ms = s - L;
            if (ms < 1) continue;
            const mv = mMap.get(ms);
            if (mv === undefined) continue;
            xsArr.push(ms); tmpIdx.push(mv);
          }
          const mTS = theilSen(xsArr, tmpIdx);
          tmpIdx.forEach((v, i) => xr.push(v - (mTS.intercept + mTS.slope * xsArr[i])));
          for (const s of bSteps) {
            const ms = s - L;
            if (ms < 1) continue;
            const mv = mMap.get(ms);
            if (mv === undefined) continue;
            yr.push(bResidMap.get(s)!);
          }
        }
        const lv = pearson(xsL, ysL);
        const dt = xr.length >= 4 ? pearson(xr, yr) : { r: NaN, p: NaN, n: 0 };
        scan.push({
          L, n: lv.n, r_level: lv.r, p_level: lv.p,
          n_detrended: xr.length, r_detrended: dt.r, p_detrended: dt.p,
          crit_r: critR(lv.n),
        });
      }
      const valid = scan.filter((s) => isFinite(s.r_level));
      const best = valid.reduce((a, b) => (Math.abs(b.r_level) > Math.abs(a.r_level) ? b : a), valid[0]);
      const bestDet = scan.filter((s) => isFinite(s.r_detrended));
      const bestD = bestDet.length ? bestDet.reduce((a, b) => (Math.abs(b.r_detrended) > Math.abs(a.r_detrended) ? b : a), bestDet[0]) : null;
      // 稳定性：bootstrap 重采样 step 对，看最优 L 的分布
      const pairs: { b: number; m: number; br: number }[] = [];
      for (const s of bSteps) {
        const mv = mMap.get(s);
        if (mv === undefined) continue;
        pairs.push({ b: s, m: mv, br: bResidMap.get(s)! });
      }
      const B = 1500;
      const counts = new Array(LMAX + 1).fill(0);
      let nValidBoot = 0;
      for (let b2 = 0; b2 < B; b2++) {
        const samp = Array.from({ length: pairs.length }, () => pairs[Math.floor(rng() * pairs.length)]);
        let bestL = -1, bestAbs = -1;
        for (let L = 0; L <= LMAX; L++) {
          const xs: number[] = [], ys: number[] = [];
          for (const p of samp) {
            const ms = p.b - L;
            if (ms < 1) continue;
            const mv = mMap.get(ms);
            if (mv === undefined) continue;
            xs.push(mv); ys.push(p.m === undefined ? NaN : bestBenchValAt(bSteps, bVals, p.b));
          }
          if (xs.length < 4) continue;
          const r = Math.abs(pearson(xs, ys).r);
          if (isFinite(r) && r > bestAbs) { bestAbs = r; bestL = L; }
        }
        if (bestL >= 0) { counts[bestL]++; nValidBoot++; }
      }
      const dist = counts.map((c, L) => ({ L, freq: nValidBoot ? c / nValidBoot : 0 }));
      const modal = dist.reduce((a, b) => (b.freq > a.freq ? b : a), dist[0]);
      const withinNoise = valid.filter((s) => {
        if (!isFinite(s.r_level) || !isFinite(best.r_level)) return false;
        const zBest = 0.5 * Math.log((1 + Math.min(0.999, Math.abs(best.r_level))) / (1 - Math.min(0.999, Math.abs(best.r_level))));
        const zS = 0.5 * Math.log((1 + Math.min(0.999, Math.abs(s.r_level))) / (1 - Math.min(0.999, Math.abs(s.r_level))));
        const se = 1 / Math.sqrt(Math.max(1, s.n - 3));
        return Math.abs(zBest - zS) <= 1.96 * se * Math.SQRT2;
      }).map((s) => s.L);

      perMetric.push({
        metric: mName,
        scan,
        best_L: best.L, best_r: best.r_level, best_p: best.p_level, best_n: best.n,
        best_L_detrended: bestD ? bestD.L : null, best_r_detrended: bestD ? bestD.r_detrended : null,
        best_L_bootstrap_modal: modal.L, best_L_bootstrap_freq: modal.freq,
        best_L_bootstrap_dist: dist,
        L_within_noise_of_best: withinNoise,
        crit_r: critR(best.n),
        best_r_exceeds_crit: Math.abs(best.r_level) > critR(best.n),
      });
      bestLDist.push({ bench: S.bench, run: S.run, metric: mName, best_L: best.L, r: best.r_level, modalL: modal.L, freq: modal.freq, withinNoise });
    }
    out.push({ bench: S.bench, run: S.run, n_points: benchPts.length, per_metric: perMetric });
  }

  // 公告「补发」的可达时间分析
  const backfillNotice = notices.find((n) => /deepswe/i.test(n.text) && /step 12/i.test(n.text));
  const noticeAnalysis: any = { notice: backfillNotice ?? null, per_run: [] };
  if (backfillNotice) {
    const nominal: Record<string, number> = { flash: 12, pro: 8 };
    for (const r of RUNS) {
      const walls = runs[r].axis.walls;
      // 公告时刻 → 该时刻已经完成的最后一步
      let lastDone = 0;
      for (let i = 0; i < walls.length; i++) if (walls[i] <= backfillNotice.t) lastDone = i + 1;
      const nominalStep = nominal[r];
      const nominalWall = walls[nominalStep - 1];
      noticeAnalysis.per_run.push({
        run: r,
        notice_t: backfillNotice.t,
        nominal_step_backfilled: nominalStep,
        nominal_step_wall: nominalWall,
        steps_completed_at_notice: lastDone,
        total_steps: walls.length,
        // >0 表示补发发生在该标称步完成之后若干训练步
        training_steps_between_nominal_and_notice: lastDone - nominalStep,
        hours_between_nominal_step_and_notice: (backfillNotice.t - nominalWall) / 3600,
        note: "公告原文：已更新 flash 第 12 步与 pro 第 8 步的最新 DeepSWE 结果，后续随离线评测出结果持续发布。标称步号的分数在公告时刻才可读。",
      });
    }
    for (const b of benchmarks) {
      const obj = b.results?.flash ?? {};
      const has12 = Object.prototype.hasOwnProperty.call(obj, "12");
      noticeAnalysis[`flash_${b.key}_has_step12`] = has12;
    }
  }
  function bestBenchValAt(steps: number[], vals: number[], s: number) {
    const i = steps.indexOf(s);
    return i >= 0 ? vals[i] : NaN;
  }
  return { lag_scan: out, notice_analysis: noticeAnalysis, LMAX };
}

// ===========================================================================
// 6. 第五节：饱和模型拟合与外推
// ===========================================================================
type FitModel = {
  name: string;
  k: number;
  fit: (x: number[], y: number[]) => { params: number[]; predict: (t: number) => number; plateau: number; rss: number } | null;
};

function goldenMin(f: (t: number) => number, lo: number, hi: number, iters = 60) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

/** 线性最小二乘（两参数，设计矩阵 2 列） */
function ls2(col1: number[], col2: number[], y: number[]) {
  const n = y.length;
  let s11 = 0, s12 = 0, s22 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { s11 += col1[i] * col1[i]; s12 += col1[i] * col2[i]; s22 += col2[i] * col2[i]; b1 += col1[i] * y[i]; b2 += col2[i] * y[i]; }
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-14) return null;
  const c1 = (b1 * s22 - b2 * s12) / det;
  const c2 = (s11 * b2 - s12 * b1) / det;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (y[i] - (c1 * col1[i] + c2 * col2[i])) ** 2;
  return { c1, c2, rss };
}

const MODELS: FitModel[] = [
  {
    name: "exp_saturation", k: 3,
    fit(x, y) {
      // y = a − b·exp(−c·x)，给定 c 线性可解
      const xs = x.map((v) => v - x[0]);
      const score = (c: number) => {
        const e = xs.map((v) => Math.exp(-c * v));
        const r = ls2(e.map(() => 1), e.map((v) => -v), y);
        return r ? r.rss : Infinity;
      };
      let cGrid: number[] = [];
      for (let i = 0; i <= 120; i++) cGrid.push(1e-4 * Math.pow(3 / 1e-4, i / 120));
      let bestC = cGrid[0], bestRss = Infinity;
      for (const c of cGrid) { const r = score(c); if (r < bestRss) { bestRss = r; bestC = c; } }
      const cLo = Math.max(1e-5, bestC / 4), cHi = Math.min(5, bestC * 4);
      const cOpt = goldenMin(score, cLo, cHi, 80);
      const c = score(cOpt) <= bestRss ? cOpt : bestC;
      const e = xs.map((v) => Math.exp(-c * v));
      const r = ls2(e.map(() => 1), e.map((v) => -v), y)!;
      const a = r.c1, b = r.c2;
      return { params: [a, b, c], plateau: a, rss: r.rss, predict: (t: number) => a - b * Math.exp(-c * (t - x[0])) };
    },
  },
  {
    name: "gompertz", k: 3,
    fit(x, y) {
      // log y = A − B·exp(−c·x) → y = exp(A)·exp(−B e^{−cx})
      const ly = y.map((v) => Math.log(Math.max(1e-9, v)));
      const m = MODELS.find((z) => z.name === "exp_saturation")!;
      const r = m.fit(x, ly);
      if (!r) return null;
      const A = r.params[0], B = r.params[1], c = r.params[2];
      const a = Math.exp(A);
      const predict = (t: number) => Math.exp(A - B * Math.exp(-c * (t - x[0])));
      let rss = 0; for (let i = 0; i < x.length; i++) rss += (y[i] - predict(x[i])) ** 2;
      return { params: [a, B, c], plateau: a, rss, predict };
    },
  },
  {
    name: "logistic", k: 3,
    fit(x, y) {
      // y = K / (1 + exp(−r(x−x0)))，给定 K 线性可解：logit(y/K) = r·x − r·x0
      const ymax = Math.max(...y);
      let best: any = null;
      const Kg = [];
      for (let i = 0; i <= 200; i++) Kg.push(ymax * (1 + 1e-6) + (ymax * 3) * (i / 200));
      const score = (K: number) => {
        const lg: number[] = [];
        for (const v of y) {
          const p = v / K;
          if (p <= 1e-9 || p >= 1 - 1e-9) return Infinity;
          lg.push(Math.log(p / (1 - p)));
        }
        const r = ls2(x, x.map(() => 1), lg);
        if (!r) return Infinity;
        let rss = 0;
        for (let i = 0; i < x.length; i++) {
          const pred = K / (1 + Math.exp(-(r.c1 * x[i] + r.c2)));
          rss += (y[i] - pred) ** 2;
        }
        return rss;
      };
      for (const K of Kg) { const r = score(K); if (!best || r < best.rss) best = { K, rss: r }; }
      const Kopt = goldenMin(score, ymax * (1 + 1e-6), best.K * 1.5 + 1e-6, 80);
      const K = score(Kopt) < best.rss ? Kopt : best.K;
      const lg = y.map((v) => Math.log((v / K) / (1 - v / K)));
      const r = ls2(x, x.map(() => 1), lg)!;
      const rr = r.c1, rx0 = -r.c2;
      const predict = (t: number) => K / (1 + Math.exp(-(rr * t + r.c2)));
      let rss = 0; for (let i = 0; i < x.length; i++) rss += (y[i] - predict(x[i])) ** 2;
      return { params: [K, rr, rx0], plateau: K, rss, predict };
    },
  },
  {
    name: "piecewise_linear_plateau", k: 3,
    fit(x, y) {
      // y = min(α + β·x, P)：网格扫断点，段内 OLS / 段内均值
      const n = x.length;
      let best: any = null;
      for (let cut = 2; cut <= n - 2; cut++) {
        const x1 = x.slice(0, cut), y1 = y.slice(0, cut);
        const x2 = y.slice(cut);
        const f = ols(x1, y1);
        const P = mean(x2);
        let rss = 0;
        for (let i = 0; i < cut; i++) rss += (y[i] - (f.intercept + f.slope * x[i])) ** 2;
        for (let i = cut; i < n; i++) rss += (y[i] - P) ** 2;
        if (!best || rss < best.rss) best = { cut, alpha: f.intercept, beta: f.slope, P, rss };
      }
      if (!best) return null;
      const { alpha, beta, P } = best;
      return { params: [alpha, beta, P], plateau: P, rss: best.rss, predict: (t: number) => Math.min(alpha + beta * t, P), cut: best.cut };
    },
  },
];

function aicc(rss: number, n: number, k: number) {
  if (rss <= 0) return -Infinity;
  return n * Math.log(rss / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
}

function solveX90(predict: (t: number) => number, plateau: number, y0: number, xLast: number, x0: number) {
  const target = y0 + 0.9 * (plateau - y0);
  if (plateau <= y0) return null;
  // 二分：从 x0 到 xLast + 100000
  let lo = x0, hi = xLast + 100000;
  const f = (t: number) => predict(t) - target;
  if (f(hi) < 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function sectionSaturation() {
  const seriesToFit: { label: string; kind: string; key: string; run: RunKey; pts: Pt[]; unit: string }[] = [];
  for (const r of RUNS) seriesToFit.push({ label: `${MAIN} / ${r}`, kind: "train_metric", key: MAIN, run: r, pts: metricSeries(r, MAIN), unit: "通过率(0~1)" });
  for (const b of benchmarks) for (const r of RUNS)
    seriesToFit.push({ label: `${b.key} / ${r}`, kind: "benchmark", key: b.key, run: r, pts: benchSeries(b, r), unit: "分(0~100)" });

  const out: any[] = [];
  for (const S of seriesToFit) {
    const x = S.pts.map((p) => p.step), y = S.pts.map((p) => p.value);
    const n = x.length;
    const yLast = y[y.length - 1], yMax = Math.max(...y), yFirst = y[0];
    const fits: any[] = [];
    for (const M of MODELS) {
      const f = M.fit(x, y);
      if (!f) { fits.push({ model: M.name, ok: false }); continue; }
      const rmse = Math.sqrt(f.rss / n);
      const tss = sum(y.map((v) => (v - mean(y)) ** 2));
      const r2 = 1 - f.rss / tss;
      // 残差 bootstrap
      const resid = y.map((v, i) => v - f.predict(x[i]));
      const rmean = mean(resid);
      const cen = resid.map((v) => v - rmean);
      const B = 500;
      const plateaus: number[] = [], x90s: number[] = [], x90fromLast: number[] = [];
      let nOk = 0;
      for (let b = 0; b < B; b++) {
        const ys = x.map((t, i) => f.predict(t) + cen[Math.floor(rng() * n)]);
        const fb = M.fit(x, ys);
        if (!fb || !isFinite(fb.plateau)) continue;
        const q = solveX90(fb.predict, fb.plateau, yFirst, x[n - 1], x[0]);
        plateaus.push(fb.plateau);
        if (q !== null && isFinite(q)) { x90s.push(q); x90fromLast.push(q - x[n - 1]); }
        nOk++;
      }
      plateaus.sort((a, b) => a - b); x90fromLast.sort((a, b) => a - b);
      const dataRange = yMax - Math.min(...y);
      const farAbove = plateaus.filter((v) => v > yMax + Math.max(dataRange, 1e-9)).length;
      const pci: any = {
        lo: quantile(plateaus, 0.025), hi: quantile(plateaus, 0.975), median: quantile(plateaus, 0.5),
        q16: quantile(plateaus, 0.16), q84: quantile(plateaus, 0.84),
        n_valid: plateaus.length,
        frac_plateau_more_than_one_data_range_above_max: plateaus.length ? farAbove / plateaus.length : NaN,
        identifiable: plateaus.length ? (quantile(plateaus, 0.975) - quantile(plateaus, 0.025)) <= 2 * Math.max(dataRange, 1e-9) : false,
      };
      const x90ci: any = {
        lo: quantile(x90fromLast, 0.025), hi: quantile(x90fromLast, 0.975), median: quantile(x90fromLast, 0.5),
        q16: quantile(x90fromLast, 0.16), q84: quantile(x90fromLast, 0.84), n_valid: x90fromLast.length,
      };
      const x90 = solveX90(f.predict, f.plateau, yFirst, x[n - 1], x[0]);
      fits.push({
        model: M.name, ok: true, params: f.params,
        plateau: f.plateau, rmse, r2, rss: f.rss, aicc: aicc(f.rss, n, M.k), k: M.k,
        plateau_ci95: pci, plateau_ci_width: pci.hi - pci.lo,
        plateau_ci_width_over_data_range: (pci.hi - pci.lo) / Math.max(1e-9, yMax - Math.min(...y)),
        headroom_vs_last: f.plateau - yLast,
        headroom_vs_max: f.plateau - yMax,
        headroom_ci95_vs_last: [pci.lo - yLast, pci.hi - yLast],
        headroom_ci95_vs_max: [pci.lo - yMax, pci.hi - yMax],
        x90_abs: x90, x90_steps_from_last: x90 === null ? null : x90 - x[n - 1],
        x90_steps_from_last_ci95: x90ci,
        bootstrap_n_ok: nOk,
        residsd: sd(resid),
      });
    }
    const okFits = fits.filter((f) => f.ok);
    const identFits = okFits.filter((f) => f.plateau_ci95.identifiable);
    const bestAICc = okFits.length ? okFits.reduce((a, b) => (b.aicc < a.aicc ? b : a), okFits[0]).model : null;
    const bestIdentAICc = identFits.length ? identFits.reduce((a, b) => (b.aicc < a.aicc ? b : a), identFits[0]).model : null;
    const plateaus = okFits.map((f) => f.plateau);
    const modelSpread = plateaus.length ? Math.max(...plateaus) - Math.min(...plateaus) : NaN;
    const identPlateaus = identFits.map((f) => f.plateau);
    const modelSpreadIdent = identPlateaus.length ? Math.max(...identPlateaus) - Math.min(...identPlateaus) : NaN;
    const ciOverlap = (() => {
      if (okFits.length < 2) return null;
      let lo = -Infinity, hi = Infinity;
      for (const f of okFits) { lo = Math.max(lo, f.plateau_ci95.lo); hi = Math.min(hi, f.plateau_ci95.hi); }
      return { common_lo: lo, common_hi: hi, all_overlap: lo <= hi };
    })();
    out.push({
      label: S.label, kind: S.kind, key: S.key, run: S.run, unit: S.unit,
      n, step_first: x[0], step_last: x[n - 1], value_first: yFirst, value_last: yLast, value_max: yMax,
      observed_max_step: x[y.indexOf(yMax)],
      fits, best_by_AICc: bestAICc, best_by_AICc_among_identifiable: bestIdentAICc,
      models_identifiable: identFits.map((f) => f.model),
      plateau_model_spread: modelSpread, plateau_model_spread_among_identifiable: modelSpreadIdent,
      plateau_ci_overlap: ciOverlap,
    });
  }
  return out;
}

// ===========================================================================
// 7. 第六节：pro vs flash 横向比较（按步 / 按成本 / 按 token）
// ===========================================================================
function interpAt(points: { x: number; y: number }[], xq: number) {
  const s = [...points].sort((a, b) => a.x - b.x);
  if (!s.length || xq < s[0].x || xq > s[s.length - 1].x) return null;
  for (let i = 1; i < s.length; i++) {
    if (xq <= s[i].x) {
      const t = (xq - s[i - 1].x) / (s[i].x - s[i - 1].x || 1);
      return s[i - 1].y + t * (s[i].y - s[i - 1].y);
    }
  }
  return s[s.length - 1].y;
}

function sectionCrossRun() {
  const res: any = { by_step: [], by_cost: [], by_tokens: [], summary: {} };

  // 按步对齐：只用两步都有的步
  const seriesKeys = [MAIN, ...benchmarks.map((b) => b.key)];
  for (const k of seriesKeys) {
    const get = (run: RunKey, s: number): number | null =>
      benchmarks.some((b) => b.key === k) ? (benchSeries(benchmarks.find((b) => b.key === k), run).find((p) => p.step === s)?.value ?? null) : metricAt(run, k, s);
    const steps: number[] = [];
    for (let s = 1; s <= 30; s++) { const a = get("pro", s), b = get("flash", s); if (a !== null && b !== null) steps.push(s); }
    const rows = steps.map((s) => ({ step: s, pro: get("pro", s), flash: get("flash", s), diff: (get("flash", s)! - get("pro", s)!) }));
    res.by_step.push({ metric: k, n_common_steps: steps.length, steps, rows, flash_leads_on: rows.filter((r) => r.diff > 0).length, pro_leads_on: rows.filter((r) => r.diff < 0).length });
  }

  // 按成本对齐
  const costGrid: number[] = [];
  const maxCost = Math.min(costAtStep("pro", runs.pro.axis.walls.length), costAtStep("flash", runs.flash.axis.walls.length));
  for (let c = 0.1e6; c <= maxCost; c += 0.1e6) costGrid.push(c);
  const perMetricCost: any[] = [];
  for (const k of seriesKeys) {
    const ptsR: any = {};
    for (const r of RUNS) {
      const arr: { x: number; y: number }[] = [];
      for (let s = 1; s <= runs[r].axis.walls.length; s++) {
        let v: number | null;
        if (benchmarks.some((b) => b.key === k)) v = benchSeries(benchmarks.find((b) => b.key === k), r).find((p) => p.step === s)?.value ?? null;
        else v = metricAt(r, k, s);
        if (v !== null) arr.push({ x: costAtStep(r, s), y: v });
      }
      ptsR[r] = arr;
    }
    const rows = costGrid.map((c) => {
      const a = interpAt(ptsR.pro, c), b = interpAt(ptsR.flash, c);
      return { cost_usd: c, pro: a, flash: b, diff: a !== null && b !== null ? b - a : null };
    }).filter((r) => r.pro !== null || r.flash !== null);
    perMetricCost.push({
      metric: k, max_cost_usd: maxCost, rows,
      first_cost_where_flash_available: ptsR.flash.length ? ptsR.flash[0].x : null,
      last_cost_pro_available: ptsR.pro.length ? ptsR.pro[ptsR.pro.length - 1].x : null,
    });
  }
  res.by_cost = perMetricCost;
  // 成本对齐下的领先计数汇总
  const costLead: any[] = [];
  for (const m of perMetricCost) {
    const both = m.rows.filter((r: any) => r.pro !== null && r.flash !== null);
    if (!both.length) { costLead.push({ metric: m.metric, n_common_cost_points: 0 }); continue; }
    const dd = both.map((r: any) => r.flash - r.pro);
    costLead.push({
      metric: m.metric, n_common_cost_points: both.length,
      flash_leads: dd.filter((d: number) => d > 0).length,
      pro_leads: dd.filter((d: number) => d < 0).length,
      mean_diff_flash_minus_pro: mean(dd),
      min_diff: Math.min(...dd), max_diff: Math.max(...dd),
      cost_range_usd: [both[0].cost_usd, both[both.length - 1].cost_usd],
    });
  }
  res.cost_alignment_summary = costLead;

  // 按累计 token 对齐
  const maxTok = Math.min(tokensAtStep("pro", runs.pro.axis.walls.length), tokensAtStep("flash", runs.flash.axis.walls.length));
  const tokGrid: number[] = [];
  for (let t = 10e9; t <= maxTok; t += 10e9) tokGrid.push(t);
  const perMetricTok: any[] = [];
  for (const k of seriesKeys) {
    const ptsR: any = {};
    for (const r of RUNS) {
      const arr: { x: number; y: number }[] = [];
      for (let s = 1; s <= runs[r].axis.walls.length; s++) {
        let v: number | null;
        if (benchmarks.some((b) => b.key === k)) v = benchSeries(benchmarks.find((b) => b.key === k), r).find((p) => p.step === s)?.value ?? null;
        else v = metricAt(r, k, s);
        if (v !== null) arr.push({ x: tokensAtStep(r, s), y: v });
      }
      ptsR[r] = arr;
    }
    const rows = tokGrid.map((c) => {
      const a = interpAt(ptsR.pro, c), b = interpAt(ptsR.flash, c);
      return { tokens: c, pro: a, flash: b, diff: a !== null && b !== null ? b - a : null };
    }).filter((r) => r.pro !== null || r.flash !== null);
    perMetricTok.push({ metric: k, max_tokens: maxTok, rows });
  }
  res.by_tokens = perMetricTok;

  res.summary = {
    rate_pro: runs.pro.status.cost.rate_per_s,
    rate_flash: runs.flash.status.cost.rate_per_s,
    rate_ratio: runs.pro.status.cost.rate_per_s / runs.flash.status.cost.rate_per_s,
    pro_steps: runs.pro.axis.walls.length,
    flash_steps: runs.flash.axis.walls.length,
    pro_total_cost: runs.pro.status.cost.so_far,
    flash_total_cost: runs.flash.status.cost.so_far,
    pro_total_tokens: runs.pro.status.totals.tokens_cum,
    flash_total_tokens: runs.flash.status.totals.tokens_cum,
    pro_cost_per_step_last: costAtStep("pro", runs.pro.axis.walls.length),
    flash_cost_per_step_last: costAtStep("flash", runs.flash.axis.walls.length),
    pro_hours: (runs.pro.axis.walls[runs.pro.axis.walls.length - 1] - runs.pro.axis.run_start) / 3600,
    flash_hours: (runs.flash.axis.walls[runs.flash.axis.walls.length - 1] - runs.flash.axis.run_start) / 3600,
  };

  // 同一步号上两条 run 的关键读数表（用于报告）
  const keySteps = [1, 5, 10, 15, 18, 20, 24];
  const keyTable: any[] = [];
  for (const s of keySteps) {
    const row: any = { step: s, pro_cost: s <= runs.pro.axis.walls.length ? costAtStep("pro", s) : null, flash_cost: s <= runs.flash.axis.walls.length ? costAtStep("flash", s) : null };
    row.pro_avg = metricAt("pro", MAIN, s);
    row.flash_avg = metricAt("flash", MAIN, s);
    for (const b of benchmarks) {
      row[`${b.key}_pro`] = benchSeries(b, "pro").find((p) => p.step === s)?.value ?? null;
      row[`${b.key}_flash`] = benchSeries(b, "flash").find((p) => p.step === s)?.value ?? null;
    }
    keyTable.push(row);
  }
  res.key_step_table = keyTable;
  return res;
}

// ===========================================================================
// 8. 第七节：在线通过率与离线榜的 gap / 自家题 vs 外部题
// ===========================================================================
function sectionGap() {
  const perBench: any[] = [];
  for (const b of benchmarks) {
    for (const r of RUNS) {
      const pts = benchSeries(b, r);
      const rows: any[] = [];
      for (const p of pts) {
        const a = metricAt(r, MAIN, p.step);
        if (a === null) continue;
        rows.push({ step: p.step, avg_n_pct: a * 100, bench: p.value, gap: a * 100 - p.value });
      }
      if (rows.length < 3) { perBench.push({ bench: b.key, run: r, n: rows.length, insufficient: true }); continue; }
      const x = rows.map((q) => q.step), g = rows.map((q) => q.gap);
      const ts = theilSen(x, g);
      const bt = bootstrapCI(x.length, (idx) => theilSen(idx.map((i) => x[i]), idx.map((i) => g[i])).slope, 4000);
      perBench.push({
        bench: b.key, benchTitle: b.title, run: r, n: rows.length,
        gap_first: g[0], gap_last: g[g.length - 1], gap_min: Math.min(...g), gap_max: Math.max(...g),
        gap_slope_per_step: ts.slope, gap_slope_ci95: [bt.lo, bt.hi],
        gap_ci_excludes_zero: bt.lo > 0 || bt.hi < 0,
        rows,
      });
    }
  }
  // 自家题(in-house) vs 外部题(DeepSWE) 的进步幅度
  const compare: any[] = [];
  for (const r of RUNS) {
    const inH = benchmarks.find((b) => b.key === "inhouse-coding");
    const ext = benchmarks.find((b) => b.key === "deepswe");
    const a = benchSeries(inH, r), e = benchSeries(ext, r);
    // 只用两者都有值的共同步，算净变化与斜率
    const common = a.map((p) => p.step).filter((s) => e.some((q) => q.step === s));
    const av = common.map((s) => a.find((p) => p.step === s)!.value);
    const ev = common.map((s) => e.find((p) => p.step === s)!.value);
    const bp = bootstrapCI(common.length, (idx) => {
      const st = idx.map((i) => common[i]);
      return theilSen(st, idx.map((i) => av[i])).slope - theilSen(st, idx.map((i) => ev[i])).slope;
    }, 4000);
    compare.push({
      run: r, n_common: common.length, steps: common,
      delta_slope_ci95: [bp.lo, bp.hi], delta_slope_ci_excludes_zero: bp.lo > 0 || bp.hi < 0,
      inhouse_first: av[0], inhouse_last: av[av.length - 1], inhouse_net: av[av.length - 1] - av[0],
      inhouse_slope: theilSen(common, av).slope,
      deepswe_first: ev[0], deepswe_last: ev[ev.length - 1], deepswe_net: ev[ev.length - 1] - ev[0],
      deepswe_slope: theilSen(common, ev).slope,
      delta_slope_inhouse_minus_deepswe: theilSen(common, av).slope - theilSen(common, ev).slope,
    });
  }
  return { per_bench_gap: perBench, inhouse_vs_deepswe: compare };
}

// ===========================================================================
// 主流程
// ===========================================================================
const t0 = Date.now();
const mdeSec = sectionMDE();
const trendSec = sectionTrend();
const acSec = sectionAutocorr(mdeSec);
const lagSec = sectionLag();
const satSec = sectionSaturation();
const crossSec = sectionCrossRun();
const gapSec = sectionGap();

OUT.s1_mde = mdeSec;
OUT.s2_trend = trendSec;
OUT.s3_autocorr = acSec;
OUT.s4_lag = lagSec;
// 把 MDE 接到饱和外推表上：判断「剩余空间」是否大于该序列的单步测量噪声
const mdeLookup = new Map<string, number>();
for (const st of mdeSec.per_series) mdeLookup.set(`${st.bench}|${st.run}`, st.mde_primary_95);
for (const st of mdeSec.aux_main_metric) mdeLookup.set(`${MAIN}|${st.run}`, st.mde_primary_95);
for (const st of satSec) {
  st.mde_95 = mdeLookup.get(`${st.key}|${st.run}`) ?? null;
  for (const fit of st.fits) {
    if (!fit.ok) continue;
    fit.headroom_over_mde = st.mde_95 ? fit.headroom_vs_last / st.mde_95 : null;
    fit.headroom_ci_lo_over_mde = st.mde_95 ? fit.headroom_ci95_vs_last[0] / st.mde_95 : null;
    fit.last_value_inside_plateau_ci = st.value_last >= fit.plateau_ci95.lo && st.value_last <= fit.plateau_ci95.hi;
    fit.headroom_exceeds_mde = st.mde_95 ? fit.headroom_vs_last > st.mde_95 : null;
  }
  const okf = st.fits.filter((x: any) => x.ok);
  const ident = okf.filter((x: any) => x.plateau_ci95.identifiable);
  st.saturation_consistency = {
    last_value: st.value_last,
    max_value: st.value_max,
    n_models: okf.length,
    n_models_identifiable: ident.length,
    n_models_plateau_ci_contains_last_value: okf.filter((x: any) => x.last_value_inside_plateau_ci).length,
    n_identifiable_models_plateau_ci_contains_last_value: ident.filter((x: any) => x.last_value_inside_plateau_ci).length,
    n_models_headroom_exceeds_mde: st.mde_95 ? okf.filter((x: any) => x.headroom_exceeds_mde).length : null,
    n_identifiable_models_headroom_exceeds_mde: st.mde_95 ? ident.filter((x: any) => x.headroom_exceeds_mde).length : null,
    identifiable_plateau_range: ident.length ? [Math.min(...ident.map((x: any) => x.plateau_ci95.lo)), Math.max(...ident.map((x: any) => x.plateau_ci95.hi))] : null,
  };
}
OUT.s5_saturation = satSec;
OUT.s6_cross_run = crossSec;
OUT.s7_gap = gapSec;
OUT.meta.runtime_ms = Date.now() - t0;
OUT.meta.generated_at = new Date().toISOString();

// 可选的 markdown 判定表输出（--emit-md <path>）
const mdIdx = process.argv.indexOf("--emit-md");
if (mdIdx >= 0 && process.argv[mdIdx + 1]) {
  const lines: string[] = [];
  const F = (v: any, d = 2) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : String(v));
  for (const key of ["deepswe", "inhouse-coding", "automation"]) {
    for (const run of RUNS) {
      const rows = mdeSec.judgement_table.filter((r: any) => r.bench === key && r.run === run);
      if (!rows.length) continue;
      const st = mdeSec.per_series.find((x: any) => x.bench === key && x.run === run);
      lines.push(`\n**${key} / ${run}** (n=${st.n}, MDE=${F(st.mde_primary_95)}, adjacent-step σ=${F(st.sd_adj_raw)})\n`);
      lines.push("| step | score | Δ | deviation from trend | z(vs trend) | verdict(vs trend) | verdict(raw Δ) | naive p | significant after Holm |");
      lines.push("|---|---|---|---|---|---|---|---|---|");
      for (const r of rows) {
        const gapMark = r.gap > 1 ? `(gap ${r.gap} steps)` : "";
        lines.push(`| ${r.from}→${r.to}${gapMark} | ${F(r.v_from)} → ${F(r.v_to)} | ${r.diff > 0 ? "+" : ""}${F(r.diff)} | ${r.dev_from_trend > 0 ? "+" : ""}${F(r.dev_from_trend)} | ${F(r.z_trend)} | ${r.verdict_primary} | ${Math.abs(r.diff) > r.mde_raw ? (r.diff > 0 ? "rise" : "drop") : "within noise"} | ${F(r.p_raw_norm, 4)} | ${r.holm_significant ? "yes" : "no"} |`);
      }
    }
  }
  writeFileSync(resolve(ROOT, process.argv[mdIdx + 1]), lines.join("\n") + "\n", "utf8");
  console.log("wrote markdown judgement table: " + process.argv[mdIdx + 1]);
}

mkdirSync(resolve(ROOT, "analysis/zh-CN/numbers"), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(OUT, null, 1), "utf8");

// ===========================================================================
// stdout 人读摘要
// ===========================================================================
const f = (v: any, d = 3) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : String(v));
/** 自适应小数位：小量级（avg@n 这类 0~1 的数）用更多位，避免被四舍五入成 0.00 */
const fa = (v: any, big = 3, small = 4) => {
  if (typeof v !== "number" || !isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e5) return v.toExponential(2);
  return v.toFixed(Math.abs(v) >= 0.1 ? big : small);
};
console.log("=".repeat(100));
console.log("MiMo-V2.6 RL offline benchmark board: measurement error / trend / lag / saturation extrapolation");
console.log(`seed=${SEED}  output=${OUT_JSON.replace(ROOT + "/", "")}  runtime=${OUT.meta.runtime_ms}ms`);
console.log("=".repeat(100));

console.log("\n## 1 Per-step measurement noise and MDE (units: benchmark score)");
console.log("bench                 run    n  adjacent Δ | σ_Δ raw  MAD×1.4826 | σ_pt(resid SD) σ_pt(MAD) | τ/step  | ★MDE_primy(95%) [σ CI]        | MDE_raw  | equiv N   Q≈N/3");
const printMde = (s: any, tag = "") => {
  console.log(
    `${(s.bench + tag).padEnd(20)} ${s.run.padEnd(6)} ${String(s.n).padStart(3)} ${String(s.n_diffs_adjacent).padStart(5)} | ` +
    `${fa(s.sd_adj_raw, 2).padStart(7)} ${fa(s.mad_adj_robust, 2).padStart(10)} | ` +
    `${fa(s.resid_sd, 2).padStart(10)} ${fa(s.resid_sd_robust, 2).padStart(9)} | ` +
    `${fa(s.theil_sen_slope_per_step, 4).padStart(7)} | ${fa(s.mde_primary_95, 2).padStart(6)} [${fa(s.mde_primary_95_ci_from_resid_sd[0], 2)}, ${fa(s.mde_primary_95_ci_from_resid_sd[1], 2)}] | ` +
    `${fa(s.mde_adjacent_raw_95, 2).padStart(7)} | ${f(s.implied_N_bernoulli_trials_primary, 0).padStart(7)} ${f(s.implied_Q_if_3_independent_samples_per_question, 1).padStart(8)}`
  );
  if (s.mad_over_sd_flag !== "ok") console.log(`    ⚠ ${s.bench}/${s.run}: ${s.mad_over_sd_flag}`);
};
for (const s of mdeSec.per_series) printMde(s);
console.log("Back-inferred equivalent question count across runs (same question set; estimates for both runs should be close):");
for (const q of mdeSec.implied_Q_agreement_between_runs)
  console.log(`  ${q.bench.padEnd(18)} Q_pro≈${f(q.Q_pro, 0).padStart(6)}  Q_flash≈${f(q.Q_flash, 0).padStart(6)}  ratio=${f(q.ratio_pro_over_flash, 2)}`);
console.log("(control) online main metric dynsam/avg@n:");
for (const s of mdeSec.aux_main_metric) printMde(s, " [train]");

console.log("\n## 2 Trend (Theil–Sen, bootstrap 4000 draws)");
console.log("bench                 run    per step: slope/step [95%CI]           per wall clock: slope/hour [95%CI]       last-5 net change");
for (const t of trendSec.bench_trends) {
  const r = t.recent_last5;
  console.log(
    `${t.bench.padEnd(20)} ${t.run.padEnd(6)} ${f(t.theil_sen_slope_per_step, 4).padStart(8)} [${f(t.theil_sen_slope_per_step_ci[0], 4)}, ${f(t.theil_sen_slope_per_step_ci[1], 4)}]  ` +
    `${f(t.theil_sen_slope_per_hour, 3).padStart(8)} [${f(t.theil_sen_slope_per_hour_ci[0], 3)}, ${f(t.theil_sen_slope_per_hour_ci[1], 3)}]   ` +
    `n=${t.n}  last-5 ${r ? f(r.net, 2) : "n/a"}`
  );
}
console.log("\nMain metric trend:");
for (const t of trendSec.main_metric_trends) {
  console.log(`  ${t.metric} / ${t.run}: n=${t.n} slope/step=${fa(t.slope_per_step, 4)} CI=[${fa(t.ci[0], 4)}, ${fa(t.ci[1], 4)}] p_naive=${f(t.ols_p, 4)} peak=${fa(t.max)}@${t.max_step}`);
  for (const rr of [t.recent_last5, t.recent_last8]) if (rr) console.log(`     last ${rr.k} steps (${rr.from_step}→${rr.to_step}): net=${fa(rr.net)} trend-expected=${fa(rr.expected_from_full_trend)} diff=${fa(rr.net_minus_expected)} z=${f(rr.z_of_net_vs_full_trend, 2)} slope=${fa(rr.slope, 4)} CI=[${fa(rr.slope_ci95[0], 4)}, ${fa(rr.slope_ci95[1], 4)}] significant=${rr.slope_ci_excludes_zero}`);
}

console.log("\n## 3 Autocorrelation and effective sample size / permutation tests");
console.log("bench                run    n   rho1_resid  n_eff  n_eff/n  p_OLS   p_n_eff  p_NW   p_perm(shuffle)  p_perm(block)  p_signflip  up/down steps  sign test p");
for (const a of acSec.per_series) {
  console.log(
    `${a.bench.padEnd(20)} ${a.run.padEnd(6)} ${String(a.n).padStart(3)}  ${f(a.rho1_residual, 3).padStart(8)} ${f(a.n_eff, 1).padStart(6)} ${f(a.n_eff_ratio, 2).padStart(6)}  ` +
    `${f(a.p_ols_naive, 4).padStart(6)} ${f(a.p_neff_corrected, 4).padStart(8)} ${f(a.p_newey_west, 4).padStart(6)} ${f(a.p_perm_naive_yshuffle, 4).padStart(11)} ${f(a.p_perm_block_residual, 4).padStart(12)} ${f(a.p_perm_signflip_diff, 4).padStart(11)}  ${String(a.n_up_steps + "/" + a.n_down_steps).padStart(7)}  ${f(a.p_sign_test, 3).padStart(9)}`
  );
}
console.log(`\nall single-step changes=${acSec.change_counts.naive.changes}; naive 5% significant=${acSec.change_counts.naive.significant_naive} (up${acSec.change_counts.naive.up_naive}/down${acSec.change_counts.naive.down_naive});` +
  `Holm-corrected=${acSec.change_counts.holm.significant_holm} (up${acSec.change_counts.holm.up_holm}/down${acSec.change_counts.holm.down_holm});` +
  `deviation from trend + Holm=${acSec.change_counts.trend_holm.significant_holm_trend} (high${acSec.change_counts.trend_holm.up}/low${acSec.change_counts.trend_holm.down})`);
for (const g of mdeSec.holm) console.log(`   ${g.group}: changes=${g.m_tests} naive significant=${g.n_significant_naive} Holm=${g.n_significant_holm} min_p=${f(g.min_p, 4)}`);

console.log("\n## 4 Lag scan (cross-correlation; level / detrended)");
console.log("bench                run   metric                          best L  r level  p       r detrend  best L(detrend)  bootstrap modal L(freq)  L within noise of best");
for (const l of lagSec.lag_scan) for (const m of l.per_metric) {
  console.log(
    `${l.bench.padEnd(20)} ${l.run.padEnd(5)} ${m.metric.padEnd(32)} ${String(m.best_L).padStart(3)} ${f(m.best_r, 3).padStart(6)} ${f(m.best_p, 3).padStart(6)}  ` +
    `${f(m.best_r_detrended, 3).padStart(7)} ${String(m.best_L_detrended).padStart(6)}        ${String(m.best_L_bootstrap_modal).padStart(3)} (${f(m.best_L_bootstrap_freq, 2)})   [${m.L_within_noise_of_best.join(",")}]`
  );
}
console.log("\nWhen notice backfills become readable (nominal step ≠ when the value is readable):");
for (const p of lagSec.notice_analysis.per_run)
  console.log(`  ${p.run}: backfilled nominal step ${p.nominal_step_backfilled}; at notice time this run had completed step ${p.steps_completed_at_notice}/${p.total_steps} → ` +
    `the value was readable ${f(p.training_steps_between_nominal_and_notice, 0)} training steps after the nominal step, i.e. ${f(p.hours_between_nominal_step_and_notice, 1)} wall-clock hours later`);
if (lagSec.notice_analysis.notice) console.log(`  notice timestamp t=${lagSec.notice_analysis.notice.t} (${new Date(lagSec.notice_analysis.notice.t * 1000).toISOString()})`);
console.log(`  current benchmark coverage: ` + benchmarks.map((b) => {
  const p = benchSeries(b, "pro"), fl = benchSeries(b, "flash");
  return `${b.key} pro→s${p[p.length - 1].step}(trained to ${runs.pro.axis.walls.length}) flash→s${fl[fl.length - 1].step}(trained to ${runs.flash.axis.walls.length})`;
}).join("; "));

console.log("\n## 5 Saturation model extrapolation (★all inference/extrapolation, not conclusions)");
for (const s of satSec) {
  console.log(`\n--- ${s.label}  n=${s.n}  first=${fa(s.value_first)} last=${fa(s.value_last)} peak=${fa(s.value_max)}@step${s.observed_max_step}` + (s.mde_95 ? `   MDE(95%)=${fa(s.mde_95)}` : ""));
  console.log("    model                     RMSE    R²     AICc   plateau  [95%CI]             CI width/range  ident  headroom(plateau−last) [95%CI]  steps to 90% [CI]  headroom/MDE");
  for (const fit of s.fits) {
    if (!fit.ok) { console.log(`    ${fit.model.padEnd(26)} fit failed`); continue; }
    console.log(
      `    ${fit.model.padEnd(26)} ${fa(fit.rmse).padStart(6)} ${f(fit.r2, 4).padStart(6)} ${f(fit.aicc, 2).padStart(8)} ` +
      `${fa(fit.plateau).padStart(7)} [${fa(fit.plateau_ci95.lo)}, ${fa(fit.plateau_ci95.hi)}]` +
      `${f(fit.plateau_ci_width_over_data_range, 2).padStart(10)} ${String(fit.plateau_ci95.identifiable).padStart(6)} ` +
      `${fa(fit.headroom_vs_last).padStart(8)} [${fa(fit.headroom_ci95_vs_last[0])}, ${fa(fit.headroom_ci95_vs_last[1])}]  ` +
      `${fit.x90_steps_from_last === null ? "n/a" : f(fit.x90_steps_from_last, 1)} [${f(fit.x90_steps_from_last_ci95.lo, 1)}, ${f(fit.x90_steps_from_last_ci95.hi, 1)}]  ` +
      `${fit.headroom_over_mde === null || fit.headroom_over_mde === undefined ? "n/a" : f(fit.headroom_over_mde, 2)}`
    );
  }
  console.log(`    best AICc=${s.best_by_AICc} (among identifiable=${s.best_by_AICc_among_identifiable}); identifiable models=${JSON.stringify(s.models_identifiable)};` +
    `plateau spread across models: all=${fa(s.plateau_model_spread)} / identifiable only=${fa(s.plateau_model_spread_among_identifiable)};` +
    `common plateau CI intersection=[${fa(s.plateau_ci_overlap?.common_lo)}, ${fa(s.plateau_ci_overlap?.common_hi)}] all overlap=${s.plateau_ci_overlap?.all_overlap}`);
}

console.log("\n## 6 pro vs flash (by step / by cumulative cost)");
console.log(`cost rate pro=${f(crossSec.summary.rate_pro, 3)}/s flash=${f(crossSec.summary.rate_flash, 3)}/s ratio=${f(crossSec.summary.rate_ratio, 3)}; steps ${crossSec.summary.pro_steps} vs ${crossSec.summary.flash_steps}`);
console.log("Readings at the same step (avg/benchmark score; null=no reading at that step):");
for (const row of crossSec.key_step_table) {
  console.log(`  step ${String(row.step).padStart(2)} | pro cost $${f((row.pro_cost ?? 0) / 1000, 0)}k flash cost $${f((row.flash_cost ?? 0) / 1000, 0)}k | avg@n p=${row.pro_avg === null ? "null" : f(row.pro_avg, 4)} f=${row.flash_avg === null ? "null" : f(row.flash_avg, 4)}` +
    benchmarks.map((b) => ` | ${b.key} p=${row[`${b.key}_pro`] ?? "null"} f=${row[`${b.key}_flash`] ?? "null"}`).join(""));
}
console.log("\nCounts of which run leads on the same set of cost points:");
for (const c of crossSec.cost_alignment_summary) {
  if (!c.n_common_cost_points) { console.log(`  ${c.metric.padEnd(18)} no common cost points`); continue; }
  console.log(`  ${c.metric.padEnd(18)} common cost points=${String(c.n_common_cost_points).padStart(2)}  flash higher=${String(c.flash_leads).padStart(2)} times / pro higher=${String(c.pro_leads).padStart(2)} times  flash−pro mean=${fa(c.mean_diff_flash_minus_pro)} range=[${fa(c.min_diff)}, ${fa(c.max_diff)}]`);
}
console.log("\nCounts of which run leads on the same common steps:");
for (const b of crossSec.by_step) {
  console.log(`  ${b.metric.padEnd(18)} common steps=${String(b.n_common_steps).padStart(2)}  flash higher=${String(b.flash_leads_on).padStart(2)} times / pro higher=${String(b.pro_leads_on).padStart(2)} times`);
}
console.log("\nAligned by cumulative cost (one sample point per $0.1M; '-' = that run has no data at that cost point):");
for (const m of crossSec.by_cost) {
  console.log(`  ${m.metric}: ` + m.rows.map((r) => `$${f(r.cost_usd / 1e6, 1)}M(p=${r.pro === null ? "-" : f(r.pro, 3)},f=${r.flash === null ? "-" : f(r.flash, 3)})`).join("  "));
}
console.log("\nAligned by cumulative tokens (every 10B):");
for (const m of crossSec.by_tokens) {
  console.log(`  ${m.metric}: ` + m.rows.map((r) => `${f(r.tokens / 1e9, 0)}B(p=${r.pro === null ? "-" : f(r.pro, 3)},f=${r.flash === null ? "-" : f(r.flash, 3)})`).join("  "));
}

console.log("\n## 7 Gap between online avg@n and offline benchmark (mean pass rate ×100 − benchmark score)");
for (const g of gapSec.per_bench_gap) {
  if (g.insufficient) { console.log(`  ${g.bench}/${g.run}: n=${g.n} too few points`); continue; }
  console.log(`  ${g.bench.padEnd(18)} ${g.run.padEnd(6)} n=${String(g.n).padStart(2)} gap ${f(g.gap_first, 2)}→${f(g.gap_last, 2)} slope/step=${f(g.gap_slope_per_step, 4)} CI=[${f(g.gap_slope_ci95[0], 4)}, ${f(g.gap_slope_ci95[1], 4)}] significant=${g.gap_ci_excludes_zero}`);
}
console.log("\nIn-house vs external (DeepSWE) slope on common steps (paired bootstrap 4000 draws):");
for (const c of gapSec.inhouse_vs_deepswe)
  console.log(`  ${c.run}: common steps ${c.n_common} | in-house net ${f(c.inhouse_net, 2)} slope ${f(c.inhouse_slope, 4)} | deepswe net ${f(c.deepswe_net, 2)} slope ${f(c.deepswe_slope, 4)} | slope diff ${f(c.delta_slope_inhouse_minus_deepswe, 4)} CI=[${f(c.delta_slope_ci95[0], 4)}, ${f(c.delta_slope_ci95[1], 4)}] significant=${c.delta_slope_ci_excludes_zero}`);

console.log("\nDone. JSON: " + OUT_JSON);
