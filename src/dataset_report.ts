#!/usr/bin/env bun
/**
 * dataset_report.ts
 * MiMo-V2.6 RL 公开看板本地遥测数据的「逐数据集异质性」分析。
 *
 * 运行（项目根目录）：
 *   bun src/dataset_report.ts
 *   bun src/dataset_report.ts --json-only   # 只写 JSON，不打人读摘要
 *
 * 产物：
 *   analysis/zh-CN/numbers/A3-dataset-numbers.json    全部复算数字（机器可读）
 *   stdout                                                    人读摘要
 *
 * 设计原则：脚本里不写任何结论数字。报告里每一个数字都必须能从
 * data/store/runs/{pro,flash}/series.json + axis.json + status.json + tags.json
 * 与 data/store/{benchmarks,notices}.json 复算出来。
 *
 * 统计：不引入依赖。OLS 斜率、标准误、t 检验 p 值、95% 置信区间、Spearman/Pearson
 * 全部在此文件内实现（t 分布用正则化不完全 Beta 函数计算 CDF，再二分求分位点）。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STORE = resolve(ROOT, "data/store");
const ANALYSIS = resolve(ROOT, "analysis/zh-CN/numbers");
const OUT_JSON = resolve(ANALYSIS, "A3-dataset-numbers.json");

const JSON_ONLY = process.argv.includes("--json-only");
const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// ===========================================================================
// 0. 统计工具（无依赖实现）
// ===========================================================================

/** Lanczos 近似的 log Γ(x) */
function lgamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 正则化不完全 Beta 的连分式部分 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
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
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全 Beta 函数 I_x(a,b) */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Student-t 累积分布 */
function tCDF(t: number, df: number): number {
  const tail = 0.5 * betai(df / 2, 0.5, df / (df + t * t));
  return t > 0 ? 1 - tail : tail;
}

/** Student-t 分位点（二分法） */
function tQuantile(p: number, df: number): number {
  let lo = -1e4, hi = 1e4;
  for (let i = 0; i < 300; i++) {
    const m = (lo + hi) / 2;
    if (tCDF(m, df) < p) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** 成对剔除缺失 */
function pairs(x: (number | null)[], y: (number | null)[]): { x: number[]; y: number[]; idx: number[] } {
  const X: number[] = [], Y: number[] = [], I: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const a = x[i], b = y[i];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    X.push(a); Y.push(b); I.push(i);
  }
  return { x: X, y: Y, idx: I };
}

/** pairs() 之后直接跑 OLS 的便捷入口 */
function olsP(x: (number | null)[], y: (number | null)[]): OlsResult | null {
  const pr = pairs(x, y);
  return ols(pr.x, pr.y);
}

export interface OlsResult {
  n: number; slope: number; intercept: number; se: number; t: number; p: number;
  r: number; r2: number; ci95: [number, number]; df: number;
  sdX: number; meanX: number; meanY: number;
  /** 标准化斜率（每 +1 个 x 标准差，y 变化多少） */
  stdSlope: number;
}

function ols(xs: number[], ys: number[]): OlsResult | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const df = n - 2;
  const se = df > 0 ? Math.sqrt(sse / df / sxx) : NaN;
  const t = se > 0 ? slope / se : NaN;
  const p = Number.isFinite(t) ? 2 * (1 - tCDF(Math.abs(t), df)) : NaN;
  const r = syy > 0 && sxx > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  const tc = df > 0 ? tQuantile(0.975, df) : NaN;
  const sdX = Math.sqrt(sxx / (n - 1));
  return {
    n, slope, intercept, se, t, p, r, r2: r * r,
    ci95: [slope - tc * se, slope + tc * se], df, sdX, meanX: mx, meanY: my,
    stdSlope: Number.isFinite(r) && sdX > 0 && sd(ys) > 0 ? (slope * sdX) / sd(ys) : NaN,
  };
}

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return { n, r: NaN, p: NaN, ci95: [NaN, NaN] as [number, number] };
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2;
  }
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  const df = n - 2;
  const t = Number.isFinite(r) && Math.abs(r) < 1 ? (r * Math.sqrt(df)) / Math.sqrt(1 - r * r) : NaN;
  const p = Number.isFinite(t) ? 2 * (1 - tCDF(Math.abs(t), df)) : NaN;
  let ci: [number, number] = [NaN, NaN];
  if (Number.isFinite(r) && Math.abs(r) < 1 && df > 1) {
    const z = 0.5 * Math.log((1 + r) / (1 - r));
    const sez = 1 / Math.sqrt(n - 3);
    const zc = 1.959964; // 正态近似，Fisher z
    ci = [Math.tanh(z - zc * sez), Math.tanh(z + zc * sez)];
  }
  return { n, r, p, ci95: ci };
}

function rankify(xs: number[]): number[] {
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
  const base = pearson(rankify(xs), rankify(ys));
  return base;
}

/** 双尾 Spearman 显著临界 |rho|（t 近似，反解） */
function spearmanCrit(n: number, alpha = 0.05): number {
  const df = n - 2;
  const tc = tQuantile(1 - alpha / 2, df);
  return tc / Math.sqrt(tc * tc + df);
}

const round = (v: number, k = 6) => (v === null || v === undefined || !Number.isFinite(v) ? v : +v.toFixed(k));
const pRound = (v: number) => (v === null || v === undefined || !Number.isFinite(v) ? v : +v.toPrecision(4));

// ===========================================================================
// 1. 读取数据
// ===========================================================================

type NumSeries = Record<string, (number | null)[]>;

interface RunData {
  run: string;
  series: NumSeries;
  steps: number[];
  walls: number[];
  runStart: number;
  status: any;
  notices: any[];
  tags: any;
  timeline: any[];
  benchmarks: any[];
}

const notices = jread(resolve(STORE, "notices.json"));
const benchmarks = jread(resolve(STORE, "benchmarks.json"));

function loadRun(run: string): RunData {
  const base = resolve(STORE, "runs", run);
  const series: NumSeries = jread(resolve(base, "series.json"));
  const axis = jread(resolve(base, "axis.json"));
  const status = jread(resolve(base, "status.json"));
  const tags = jread(resolve(base, "tags.json"));
  const timeline = readFileSync(resolve(base, "timeline.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { run, series, steps: axis.steps, walls: axis.walls, runStart: axis.run_start, status, notices, tags, timeline, benchmarks };
}

const RUNS: Record<string, RunData> = { pro: loadRun("pro"), flash: loadRun("flash") };

/**
 * 已知的「精确 0 疑似未上报哨兵」数据集。
 * 依据：这两条的 train/passrate/avg_passrate 里大量精确 0，而同期
 * critic/visual/<ds>/score/mean 是正常值（见 JSON 的 sentinelEvidence 段）。
 */
const SENTINEL_DS = new Set(["visual/dataset-gtav", "visual/dataset-ol8x"]);

const dsList = (r: RunData) =>
  Object.keys(r.series)
    .filter((k) => k.startsWith("train/passrate/avg_passrate/"))
    .map((k) => k.replace("train/passrate/avg_passrate/", ""))
    .sort();

const catOf = (d: string) => d.split("/")[0];

/** 取通过率；mode="missing" 时把哨兵 0 当缺失（主口径），"zero" 时当真实 0 */
function passrate(r: RunData, d: string, i: number, mode: "missing" | "zero" = "missing"): number | null {
  const v = r.series[`train/passrate/avg_passrate/${d}`]?.[i];
  if (v === null || v === undefined) return null;
  if (mode === "missing" && SENTINEL_DS.has(d) && v === 0) return null;
  return v;
}

function seriesOf(r: RunData, key: string): (number | null)[] | null {
  const v = r.series[key];
  return v ? v : null;
}

function weight(r: RunData, d: string, i: number, kind: "step" | "held" | "carryover" = "step"): number | null {
  const v = r.series[`dynsam/${d}/num_accepted/${kind}`]?.[i];
  return v === null || v === undefined ? null : v;
}

// ===========================================================================
// 2. S1 数据集清单与可用性
// ===========================================================================

function buildInventory(r: RunData) {
  const dsets = dsList(r);
  const n = r.steps.length;
  const rows = dsets.map((d) => {
    const p = r.series[`train/passrate/avg_passrate/${d}`];
    const idxNonNull = p.map((v, i) => (v === null || v === undefined ? -1 : i)).filter((i) => i >= 0);
    const idxNonZero = p.map((v, i) => (v === null || v === undefined ? -1 : v !== 0 ? i : -1)).filter((i) => i >= 0);
    const firstStep = idxNonNull.length ? r.steps[idxNonNull[0]] : null;
    const lastStep = idxNonNull.length ? r.steps[idxNonNull[idxNonNull.length - 1]] : null;
    // 连续性：首末之间有没有洞
    const holes: number[] = [];
    if (idxNonNull.length) {
      for (let s = idxNonNull[0]; s <= idxNonNull[idxNonNull.length - 1]; s++) {
        if (p[s] === null || p[s] === undefined) holes.push(r.steps[s]);
      }
    }
    const fam = (f: string) => {
      const v = r.series[f];
      if (!v) return { present: false, n: 0, firstStep: null as number | null, lastStep: null as number | null };
      const ii = v.map((x, i) => (x === null || x === undefined ? -1 : i)).filter((i) => i >= 0);
      return {
        present: true, n: ii.length,
        firstStep: ii.length ? r.steps[ii[0]] : null,
        lastStep: ii.length ? r.steps[ii[ii.length - 1]] : null,
      };
    };
    const families = {
      passrate: { present: true, n: idxNonNull.length, firstStep, lastStep },
      passrate_nonzero: { present: true, n: idxNonZero.length },
      ctx_response_length_mean: fam(`ctx_response_length/${d}/mean`),
      ctx_total_length_mean: fam(`ctx_total_length/${d}/mean`),
      ctx_total_length_clip_ratio: fam(`ctx_total_length/${d}/clip_ratio`),
      critic_score_mean: fam(`critic/${d}/score/mean`),
      actor_entropy_loss: fam(`actor/${d}/entropy_loss`),
      actor_pg_tis_clipfrac: fam(`actor/${d}/pg_tis_clipfrac`),
      dynsam_step: fam(`dynsam/${d}/num_accepted/step`),
      dynsam_held: fam(`dynsam/${d}/num_accepted/held`),
      dynsam_carryover: fam(`dynsam/${d}/num_accepted/carryover`),
      partial_avg_staleness: fam(`partial/${d}/avg_staleness`),
      env_active: fam(`env/${d}/active`),
    };
    return {
      dataset: d, category: catOf(d),
      passrateNonNull: idxNonNull.length, passrateExactZero: idxNonNull.length - idxNonZero.length,
      passrateMissing: n - idxNonNull.length,
      firstStep, lastStep, holes, families,
      sentinelSuspected: SENTINEL_DS.has(d),
    };
  });
  // 类别汇总
  const byCat: Record<string, string[]> = {};
  for (const row of rows) (byCat[row.category] ||= []).push(row.dataset);
  return { run: r.run, nSteps: n, nDatasets: rows.length, byCategory: byCat, datasets: rows };
}

// ===========================================================================
// 3. S2 谁在被学会、谁卡住了
// ===========================================================================

type ClassName = "learned" | "slow-improving" | "stagnant" | "regressing";

/**
 * 分类规则（写死在文档里，脚本只执行）：
 *   记 Δpp = 末值(最后一个有值步) − 首值(第一个有值步)，单位百分点；
 *   记 b = 通过率对步号 OLS 斜率（pp/步），p 为其双尾 p 值。
 *   1) 退化        : Δpp ≤ −3.0  或  (b < 0 且 p < 0.05)
 *   2) 明显学会    : b > 0 且 p < 0.05 且 Δpp ≥ +5.0
 *   3) 缓慢改善    : b > 0 且 (p < 0.05 且 Δpp < +5.0)  或  (0.05 ≤ p < 0.20 且 Δpp > 0)
 *   4) 停滞        : 其余
 */
function classify(deltaPp: number, b: number, p: number): ClassName {
  if (deltaPp <= -3.0 || (b < 0 && p < 0.05)) return "regressing";
  if (b > 0 && p < 0.05 && deltaPp >= 5.0) return "learned";
  if ((b > 0 && p < 0.05 && deltaPp < 5.0) || (b > 0 && p >= 0.05 && p < 0.20 && deltaPp > 0)) return "slow-improving";
  return "stagnant";
}

function perDatasetStats(r: RunData, prMode: "missing" | "zero") {
  const n = r.steps.length;
  const stepIdx = r.steps.map((s, i) => i);
  return dsList(r).map((d) => {
    const pRaw = r.series[`train/passrate/avg_passrate/${d}`];
    const pEff: (number | null)[] = pRaw.map((_, i) => passrate(r, d, i, prMode));
    const pp = pEff.map((v) => (v === null ? null : v * 100));
    const o = olsP(r.steps, pp);
    const idx = pEff.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    const first = idx.length ? pEff[idx[0]]! * 100 : null;
    const last = idx.length ? pEff[idx[idx.length - 1]]! * 100 : null;
    const deltaPp = first !== null && last !== null ? last - first : null;
    const cls = SENTINEL_DS.has(d) ? "unreliable(sentinel 0)" : (o && deltaPp !== null ? classify(deltaPp, o.slope, o.p) : null);
    const classNote = (!SENTINEL_DS.has(d) && deltaPp !== null && o && Math.abs(deltaPp) >= 8 && o.p >= 0.20)
      ? "首末差大但斜率不显著：可能是单步跳变/噪声，别当趋势"
      : null;

    const lenKey = `ctx_response_length/${d}/mean`;
    const lenSer = r.series[lenKey] ?? null;
    const lo = lenSer ? ols(r.steps, lenSer as any) : null;
    const lenIdx = lenSer ? lenSer.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0) : [];
    const lenFirst = lenIdx.length ? (lenSer![lenIdx[0]] as number) : null;
    const lenLast = lenIdx.length ? (lenSer![lenIdx[lenIdx.length - 1]] as number) : null;

    const ent = r.series[`actor/${d}/entropy_loss`] ?? null;
    const entIdx = ent ? ent.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0) : [];
    const cscore = r.series[`critic/${d}/score/mean`] ?? null;
    const csIdx = cscore ? cscore.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0) : [];

    // 通过率 <0.45 的步占比（"低分区"停留）
    const lowShare = pEff.filter((v) => v !== null).length
      ? pEff.filter((v) => v !== null && v! < 0.45).length / pEff.filter((v) => v !== null).length
      : null;

    return {
      dataset: d, category: catOf(d),
      nStepsReported: idx.length,
      passrateFirstPct: round(first, 3),
      passrateLastPct: round(last, 3),
      passrateDeltaPp: round(deltaPp, 3),
      passrateSlopePpPerStep: o ? round(o.slope, 4) : null,
      passrateSlopeCI95: o ? [round(o.ci95[0], 4), round(o.ci95[1], 4)] : null,
      passrateSlopeP: o ? pRound(o.p) : null,
      passrateSlopeR: o ? round(o.r, 4) : null,
      passrateMeanPct: round(mean(pEff.filter((v) => v !== null) as number[]) * 100, 3),
      passrateLowShareUnder45: round(lowShare, 4),
      class: cls, classNote,
      lenFirst: round(lenFirst as number, 1),
      lenLast: round(lenLast as number, 1),
      lenRatio: lenFirst && lenLast ? round((lenLast as number) / (lenFirst as number), 4) : null,
      lenSlopePerStep: lo ? round(lo.slope, 2) : null,
      entropyFirst: entIdx.length ? round(ent![entIdx[0]] as number, 4) : null,
      entropyLast: entIdx.length ? round(ent![entIdx[entIdx.length - 1]] as number, 4) : null,
      entropyMean: entIdx.length ? round(mean(entIdx.map((i) => ent![i] as number)), 4) : null,
      criticScoreFirst: csIdx.length ? round(cscore![csIdx[0]] as number, 4) : null,
      criticScoreLast: csIdx.length ? round(cscore![csIdx[csIdx.length - 1]] as number, 4) : null,
      sentinelSuspected: SENTINEL_DS.has(d),
      reliability: SENTINEL_DS.has(d) ? "通过率含疑似未上报 0，相关结论不可靠" : "ok",
    };
  });
}

// ===========================================================================
// 4. S3 总量指标被数据配比污染了吗（辛普森/构成效应）
// ===========================================================================

interface CompResult {
  run: string;
  metric: string;
  weightKind: string;
  prMode: string;
  baseSteps: number[];
  panel: string[];
  panelSize: number;
  excludedFromPanel: { dataset: string; reason: string }[];
  /** 精确两期分解（Bennet 式），单位由 metric 决定 */
  decomposition: {
    totalChange: number;
    within: number;
    composition: number;
    withinSharePct: number;
    compositionSharePct: number;
  };
  /** 逐步：实际配比聚合 vs 固定基准配比聚合 vs 看板全局值 */
  timeline: { step: number; actual: number | null; fixed: number | null; dashboard: number | null; gapActualVsFixed: number | null }[];
  /** 逐数据集的两项贡献 */
  contributions: { dataset: string; s0: number; sT: number; p0: number; pT: number; withinTerm: number; compTerm: number }[];
  /** 全程曲线差（固定配比 vs 实际配比）的最大值与末值 */
  curveGap: { maxAbsGap: number; maxAbsGapStep: number; endGap: number } | null;
}

/** metric 取值函数：返回 (i)=>number|null 与是否百分比口径 */
function metricGetter(metric: string): { get: (r: RunData, d: string, i: number) => number | null; unitScale: number; label: string } {
  if (metric === "passrate") {
    return { get: (r, d, i) => passrate(r, d, i, "missing"), unitScale: 100, label: "通过率(pp)" };
  }
  if (metric === "passrate_keepzero") {
    return { get: (r, d, i) => passrate(r, d, i, "zero"), unitScale: 100, label: "通过率(pp,0当真实值)" };
  }
  if (metric === "response_length_mean") {
    return { get: (r, d, i) => r.series[`ctx_response_length/${d}/mean`]?.[i] ?? null, unitScale: 1, label: "生成长度(token)" };
  }
  throw new Error("unknown metric " + metric);
}

function composition(r: RunData, metric: string, weightKind: "step" | "held" | "equal") {
  const n = r.steps.length;
  const dsets = dsList(r);
  const { get, unitScale } = metricGetter(metric);
  const w = (d: string, i: number) => (weightKind === "equal" ? (get(r, d, i) === null ? null : 1) : weight(r, d, i, weightKind));

  const t0 = 0, tT = n - 1;
  const panel: string[] = [];
  const excluded: { dataset: string; reason: string }[] = [];
  for (const d of dsets) {
    const g0 = get(r, d, t0), gT = get(r, d, tT);
    const w0 = w(d, t0), wT = w(d, tT);
    if (g0 === null && gT === null) { excluded.push({ dataset: d, reason: "首末均无该指标" }); continue; }
    if (g0 === null || gT === null) { excluded.push({ dataset: d, reason: "首或末该指标缺失（pro 的 cyber 第 15 步起停报；gtav/ol8x 首值疑似未上报 0）" }); continue; }
    if (w0 === null || wT === null || w0 <= 0 || wT <= 0) { excluded.push({ dataset: d, reason: "首或末权重缺失/为 0" }); continue; }
    panel.push(d);
  }
  const W0 = panel.reduce((a, d) => a + (w(d, t0) as number), 0);
  const WT = panel.reduce((a, d) => a + (w(d, tT) as number), 0);
  const sOf = (d: string, i: number, W: number) => (w(d, i) as number) / W;

  // 精确三项 shift-share 分解（每一项都精确、无残差）：
  //   ΔA = Σ s_d0 · Δp_d            （自身变好，按基准配比计价）
  //      + Σ Δs_d · p_d0            （配比挪动，按基准成绩计价）
  //      + Σ Δs_d · Δp_d            （交互项：挪过去的那些数据集同期也在变）
  // 另给两个对照口径：Laspeyres（冻结基准配比）与 Paasche（用当期配比给 Δp 计价）。
  let withinBase = 0, compBase = 0, interaction = 0, withinPaasche = 0;
  const contributions = panel.map((d) => {
    const p0 = get(r, d, t0) as number, pT = get(r, d, tT) as number;
    const s0d = sOf(d, t0, W0), sTd = sOf(d, tT, WT);
    const ds = sTd - s0d, dp = pT - p0;
    const wTerm = s0d * dp * unitScale;
    const cTerm = ds * p0 * unitScale;
    const iTerm = ds * dp * unitScale;
    const wP = sTd * dp * unitScale;
    withinBase += wTerm; compBase += cTerm; interaction += iTerm; withinPaasche += wP;
    return {
      dataset: d, s0: round(s0d, 5), sT: round(sTd, 5), shareDeltaPp: round(ds * 100, 4),
      p0: round(p0 * (metric.startsWith("passrate") ? 100 : 1), 4),
      pT: round(pT * (metric.startsWith("passrate") ? 100 : 1), 4),
      withinTerm: round(wTerm, 4), compTerm: round(cTerm, 4), interactionTerm: round(iTerm, 4),
    };
  });
  contributions.sort((a, b) => b.compTerm + b.interactionTerm + b.withinTerm - (a.compTerm + a.interactionTerm + a.withinTerm));

  // 实际配比曲线（用当期权重），限制在与分解同一个 panel 上，保证与 withinBase 自洽
  const actual: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    let num = 0, den = 0;
    for (const d of panel) { const g = get(r, d, i); const ww = w(d, i); if (g === null || ww === null || ww <= 0) continue; num += ww * g; den += ww; }
    actual.push(den ? num / den : null);
  }
  // 全数据集口径（含不进 panel 的那些）另记一条，仅供对照
  const actualAll: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    let num = 0, den = 0;
    for (const d of dsets) { const g = get(r, d, i); const ww = w(d, i); if (g === null || ww === null || ww <= 0) continue; num += ww * g; den += ww; }
    actualAll.push(den ? num / den : null);
  }
  // 固定配比曲线（基准期权重均值）
  const makeCurve = (label: string, baseSteps: number[]) => {
    const baseW: Record<string, number> = {};
    for (const d of dsets) {
      const vals = baseSteps.map((s) => w(d, s - 1)).filter((v): v is number => v !== null);
      baseW[d] = vals.length ? mean(vals) : 0;
    }
    const fixed: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      let num = 0, den = 0;
      for (const d of panel) { const g = get(r, d, i); if (g === null || baseW[d] <= 0) continue; num += baseW[d] * g; den += baseW[d]; }
      fixed.push(den ? num / den : null);
    }
    const timeline = r.steps.map((st, i) => ({
      step: st,
      actual: actual[i] === null ? null : round(actual[i]! * unitScale, 4),
      actualAllDatasets: actualAll[i] === null ? null : round(actualAll[i]! * unitScale, 4),
      fixed: fixed[i] === null ? null : round(fixed[i]! * unitScale, 4),
      gapFixedMinusActual: fixed[i] === null || actual[i] === null ? null : round((fixed[i]! - actual[i]!) * unitScale, 4),
    }));
    const gs = timeline.filter((x) => x.gapFixedMinusActual !== null).map((x) => Math.abs(x.gapFixedMinusActual as number));
    const worst = timeline.filter((x) => x.gapFixedMinusActual !== null)
      .reduce((a, b) => (Math.abs(b.gapFixedMinusActual!) > Math.abs(a.gapFixedMinusActual!) ? b : a), timeline.filter((x) => x.gapFixedMinusActual !== null)[0]);
    return {
      label, baseSteps, panelSize: panel.length,
      endpointFixedAtT: fixed[tT] === null ? null : round(fixed[tT]! * unitScale, 4),
      endpointActualAtT: actual[tT] === null ? null : round(actual[tT]! * unitScale, 4),
      endGap: (fixed[tT] !== null && actual[tT] !== null) ? round((fixed[tT]! - actual[tT]!) * unitScale, 4) : null,
      maxAbsGap: gs.length ? round(Math.max(...gs), 4) : null,
      maxAbsGapStep: worst ? worst.step : null,
      timeline,
    };
  };
  const dash = r.series["train/passrate/avg_passrate"];
  const dashTimeline = r.steps.map((st, i) => ({ step: st, dashboardGlobalPct: dash && dash[i] !== null ? round((dash[i] as number) * 100, 4) : null }));

  const total = withinBase + compBase + interaction;
  const totalCheck = get(r, panel[0], tT - 1) !== undefined ? null : null; // 占位，不对
  return {
    run: r.run, metric, weightKind,
    prMode: metric === "passrate_keepzero" ? "zero" : "missing",
    unitScale, panel, panelSize: panel.length, excludedFromPanel: excluded,
    decomposition: {
      totalChange: round(total, 4),
      withinBaseWeights: round(withinBase, 4),
      compositionBaseRates: round(compBase, 4),
      interaction: round(interaction, 4),
      withinPaascheWeights: round(withinPaasche, 4),
      withinSharePct: total !== 0 ? round((withinBase / total) * 100, 2) : null,
      compositionPlusInteractionSharePct: total !== 0 ? round(((compBase + interaction) / total) * 100, 2) : null,
      note: "ΔA = Σ s_d0·Δp_d (自身变好) + Σ Δs_d·p_d0 (配比) + Σ Δs_d·Δp_d (交互)，三项之和精确等于 ΔA；s 为 num_accepted 归一化份额",
      checkSumError: round(total - (withinBase + compBase + interaction), 10),
    },
    contributions,
    curves: {
      base1: makeCurve("base=step1", [1]),
      base123: makeCurve("base=step1..3 均值", [1, 2, 3]),
      baseFirstHalf: makeCurve(`base=前 ${Math.ceil(n / 2)} 步均值`, r.steps.slice(0, Math.ceil(n / 2))),
    },
    dashboardGlobal: dashTimeline,
  };
}

// ===========================================================================
// 5. S4 每数据集「长度—成绩」弹性
// ===========================================================================

function elasticity(r: RunData, prMode: "missing" | "zero") {
  const n = r.steps.length;
  const rows = dsList(r).map((d) => {
    let len = r.series[`ctx_response_length/${d}/mean`] ?? null;
    let lenKind = "ctx_response_length/mean";
    if (!len) {
      len = r.series[`ctx_total_length/${d}/mean`] ?? null;
      lenKind = len ? "ctx_total_length/mean(回退口径)" : "无长度指标";
    }
    const pEff: (number | null)[] = (r.series[`train/passrate/avg_passrate/${d}`] ?? []).map((_, i) => passrate(r, d, i, prMode));
    if (!len) {
      return { dataset: d, category: catOf(d), n: 0, lenKind, note: "该数据集既无 ctx_response_length/mean 也无 ctx_total_length/mean", reliable: !SENTINEL_DS.has(d), verdict: "no length data, cannot estimate elasticity" };
    }
    // 水平回归：y = pp, x = 长度/10000（每 +1 万 token 的百分点变化）
    const pr = pairs(len, pEff.map((v) => (v === null ? null : v * 100)));
    const xLvl = pr.x.map((v) => v / 10000);
    const oLvl = ols(xLvl, pr.y);
    // 差分回归
    const dx: number[] = [], dy: number[] = [];
    for (let i = 1; i < n; i++) {
      const a = len[i], b = len[i - 1];
      const c = pEff[i], e = pEff[i - 1];
      if (a === null || b === null || c === null || e === null) continue;
      dx.push((a - b) / 10000); dy.push((c - e) * 100);
    }
    const oDiff = ols(dx, dy);
    // 对数口径（弹性：长度 +1% 通过率变化多少 pp）
    const lx: number[] = [], ly: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = len[i], c = pEff[i];
      if (a === null || a <= 0 || c === null) continue;
      lx.push(Math.log(a)); ly.push(c * 100);
    }
    const oLog = ols(lx, ly);
    // 杠杆稳健性：去掉长度离均值最远的那一个点后再做水平回归
    let oLvlRobust: OlsResult | null = null;
    if (xLvl.length >= 6) {
      const mx = mean(xLvl);
      let k = 0;
      for (let i = 1; i < xLvl.length; i++) if (Math.abs(xLvl[i] - mx) > Math.abs(xLvl[k] - mx)) k = i;
      const xr = xLvl.filter((_, i) => i !== k), yr = pr.y.filter((_, i) => i !== k);
      oLvlRobust = ols(xr, yr);
    }
    return {
      dataset: d, category: catOf(d), n: pr.x.length, nDiff: dx.length, lenKind,
      reliable: !SENTINEL_DS.has(d),
      level: oLvl ? {
        slopePpPer10k: round(oLvl.slope, 4), ci95: [round(oLvl.ci95[0], 4), round(oLvl.ci95[1], 4)],
        p: pRound(oLvl.p), r: round(oLvl.r, 4), r2: round(oLvl.r2, 4),
      } : null,
      diff: oDiff ? {
        slope: round(oDiff.slope, 4), ci95: [round(oDiff.ci95[0], 4), round(oDiff.ci95[1], 4)],
        p: pRound(oDiff.p), r: round(oDiff.r, 4), n: oDiff.n,
      } : null,
      logLevel: oLog ? { slopePpPerLogToken: round(oLog.slope, 2), p: pRound(oLog.p), r: round(oLog.r, 4) } : null,
      levelRobustDropMaxLeverage: oLvlRobust ? { slopePpPer10k: round(oLvlRobust.slope, 4), p: pRound(oLvlRobust.p), n: oLvlRobust.n } : null,
      lenRangeRatio: (() => { const v = (len as (number | null)[]).filter((x): x is number => x !== null && x > 0); return v.length ? round(Math.max(...v) / Math.min(...v), 3) : null; })(),
      verdict: ElasticVerdict(oLvl, oDiff, SENTINEL_DS.has(d), oLvlRobust),
    };
  });
  return rows;
}

function ElasticVerdict(oLvl: OlsResult | null, oDiff: OlsResult | null, sentinel: boolean, oLvlRobust?: OlsResult | null): string {
  if (sentinel) return "unreliable (passrate likely unreported 0)";
  if (!oLvl || !oDiff) return "insufficient sample";
  const lvlSig = oLvl.p < 0.05 && oLvl.slope > 0;
  const lvlRobustSig = oLvlRobust ? oLvlRobust.p < 0.05 && oLvlRobust.slope > 0 : false;
  const diffSigPos = oDiff.p < 0.10 && oDiff.slope > 0;
  const diffSigNeg = oDiff.p < 0.10 && oDiff.slope < 0;
  if (diffSigPos) return "same direction and significant (diff also positive)";
  if (diffSigNeg) return "opposite (length up, score diff significantly down)";
  if (lvlSig && oLvlRobust && !lvlRobustSig) return "level significant but vanishes after dropping one high-leverage point (spurious)";
  if (lvlSig) return "level rises together but diff not significant (common time trend not ruled out)";
  return "neither significant";
}

// ===========================================================================
// 6. S5 cyber 被移除的证据
// ===========================================================================

function cyberEvidence(r: RunData) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const CY = "cyber/dataset-9aui";
  const hasCyber = dsets.includes(CY);
  const lastCyberStep = hasCyber
    ? Math.max(...r.series[`train/passrate/avg_passrate/${CY}`].map((v, i) => (v === null ? -1 : i)))
    : -1;

  // 通知与步边界对齐
  const cyberNotice = notices.find((x: any) => /cyber/i.test(x.text));
  let noticeAlign: any = null;
  if (cyberNotice) {
    const before = r.walls.filter((w) => w <= cyberNotice.t).length; // 已完成的步数
    noticeAlign = {
      noticeId: cyberNotice.id, noticeT: cyberNotice.t, noticeText: cyberNotice.text,
      noticeISO: new Date(cyberNotice.t * 1000).toISOString(),
      completedStepsBeforeNotice: before,
      lastCyberReportingStep: hasCyber ? r.steps[lastCyberStep] : null,
      firstMissingStep: hasCyber ? r.steps[lastCyberStep + 1] ?? null : null,
      runStart: r.runStart, wallsAround: r.walls.slice(Math.max(0, before - 1), before + 2),
    };
  }

  const stat = (ds: string) => {
    const p = (r.series[`train/passrate/avg_passrate/${ds}`] ?? []).map((v, i) => (v === null ? null : v));
    const pClean = p.map((v, i) => (SENTINEL_DS.has(ds) && v === 0 ? null : v));
    const oP = ols(r.steps, pClean as any);
    const len = r.series[`ctx_response_length/${ds}/mean`] ?? null;
    const ent = r.series[`actor/${ds}/entropy_loss`] ?? null;
    const sc = r.series[`critic/${ds}/score/mean`] ?? null;
    const tis = r.series[`actor/${ds}/pg_tis_clipfrac`] ?? null;
    const clip = r.series[`ctx_total_length/${ds}/clip_ratio`] ?? null;
    const st = r.series[`partial/${ds}/avg_staleness`] ?? null;
    const acc = r.series[`dynsam/${ds}/num_accepted/step`] ?? null;
    const take = <T,>(s: (number | null)[] | null, f: (v: number[]) => T): T | null =>
      s ? f(s.filter((v): v is number => v !== null)) : null;
    return {
      dataset: ds,
      passrateFirst: pClean[0] === null ? null : round(pClean[0]! * 100, 3),
      passrateLast: (() => { const ii = pClean.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0); return ii.length ? round(pClean[ii[ii.length - 1]]! * 100, 3) : null; })(),
      passrateSlopePpPerStep: oP ? round(oP.slope, 4) : null,
      passrateSlopeP: oP ? pRound(oP.p) : null,
      passrateMeanPct: take(pClean, (v) => round(mean(v) * 100, 3)),
      lenFirst: take(len, (v) => round(v[0], 0)),
      lenLast: take(len, (v) => round(v[v.length - 1], 0)),
      lenMean: take(len, (v) => round(mean(v), 0)),
      lenSlope: len ? round(ols(r.steps, len as any)!.slope, 1) : null,
      entropyMean: take(ent, (v) => round(mean(v), 4)),
      criticScoreMean: take(sc, (v) => round(mean(v), 4)),
      criticScoreMinMean: (() => { const s = r.series[`critic/${ds}/score/min`]; return s ? round(mean(s.filter((v): v is number => v !== null)), 4) : null; })(),
      criticScoreMinWorst: (() => { const s = r.series[`critic/${ds}/score/min`]; const v = s ? s.filter((x): x is number => x !== null) : []; return v.length ? round(Math.min(...v), 4) : null; })(),
      tisMean: take(tis, (v) => round(mean(v), 6)),
      tisMax: take(tis, (v) => round(Math.max(...v), 6)),
      clipRatioMax: take(clip, (v) => round(Math.max(...v), 8)),
      stalenessMean: take(st, (v) => round(mean(v), 4)),
      acceptedShareMeanPct: acc ? round((mean(acc.filter((v): v is number => v !== null)) / mean((r.series["dynsam/agentic/num_accepted/step"] ?? []).filter((v): v is number => v !== null))) * 100, 2) : null,
    };
  };

  const all = dsets.map(stat);
  // 只在 cyber 存在的步（pro: 1..14）上重算，做同类比较
  const windowEnd = hasCyber ? lastCyberStep : n - 1;
  const windowed = dsets.map((ds) => {
    const sub = (key: string) => {
      const s = r.series[key];
      return s ? s.slice(0, windowEnd + 1) : null;
    };
    const pClean = (sub(`train/passrate/avg_passrate/${ds}`) ?? []).map((v) => (v === null ? null : v));
    const pFixed = pClean.map((v) => (SENTINEL_DS.has(ds) && v === 0 ? null : v));
    const oP = ols(r.steps.slice(0, windowEnd + 1), pFixed as any);
    const tis = sub(`actor/${ds}/pg_tis_clipfrac`)?.filter((v): v is number => v !== null) ?? [];
    const ent = sub(`actor/${ds}/entropy_loss`)?.filter((v): v is number => v !== null) ?? [];
    const len = sub(`ctx_response_length/${ds}/mean`)?.filter((v): v is number => v !== null) ?? [];
    const scmin = sub(`critic/${ds}/score/min`)?.filter((v): v is number => v !== null) ?? [];
    return {
      dataset: ds,
      passrateMeanPct: pFixed.filter((v) => v !== null).length ? round(mean(pFixed.filter((v) => v !== null) as number[]) * 100, 3) : null,
      passrateSlopePpPerStep: oP ? round(oP.slope, 4) : null,
      tisMean: tis.length ? round(mean(tis), 6) : null,
      tisMax: tis.length ? round(Math.max(...tis), 6) : null,
      entropyMean: ent.length ? round(mean(ent), 4) : null,
      lenMean: len.length ? round(mean(len), 0) : null,
      scoreMinMean: scmin.length ? round(mean(scmin), 4) : null,
      scoreMinWorst: scmin.length ? round(Math.min(...scmin), 4) : null,
      scoreMinBelowNeg03Share: scmin.length ? round(scmin.filter((x) => x < -0.3).length / scmin.length, 4) : null,
      scoreMinBelowNeg05Share: scmin.length ? round(scmin.filter((x) => x < -0.5).length / scmin.length, 4) : null,
    };
  });

  // cyber 在同窗口下的横截面排名与 z 分数
  const zOf = (key: string, target = CY) => {
    const vals = windowed.map((x) => (x as any)[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length < 3) return null;
    const m = mean(vals), s = sd(vals);
    const tv = (windowed.find((x) => x.dataset === target) as any)?.[key];
    if (typeof tv !== "number") return null;
    const rank = windowed
      .filter((x) => typeof (x as any)[key] === "number")
      .sort((a, b) => ((b as any)[key] as number) - ((a as any)[key] as number))
      .findIndex((x) => x.dataset === target) + 1;
    return { value: tv, crossMean: round(m, 6), crossSd: round(s, 6), z: s > 0 ? round((tv - m) / s, 3) : null, rankDesc: rank, n: vals.length };
  };

  // cyber 的每一个指标族是不是都在同一步停报
  const cyberKeys = Object.keys(r.series).filter((k) => /cyber/i.test(k));
  const lastSteps = cyberKeys.map((k) => {
    const v = r.series[k];
    let last = -1;
    for (let i = 0; i < v.length; i++) if (v[i] !== null) last = i;
    return { key: k, lastNonNullStep: last >= 0 ? r.steps[last] : null, nNonNull: v.filter((x) => x !== null).length };
  });
  const lastStepHistogram: Record<string, number> = {};
  for (const l of lastSteps) lastStepHistogram[String(l.lastNonNullStep)] = (lastStepHistogram[String(l.lastNonNullStep)] || 0) + 1;

  return {
    run: r.run,
    cyberPresent: hasCyber,
    cyberMetricFamilies: cyberKeys.length,
    cyberLastNonNullStepHistogram: lastStepHistogram,
    cyberMetricLastSteps: lastSteps,
    lastCyberReportingStep: hasCyber ? r.steps[lastCyberStep] : null,
    firstMissingStep: hasCyber ? r.steps[lastCyberStep + 1] ?? null : null,
    noticeAlign,
    cyberFullWindow: hasCyber ? all.find((x) => x.dataset === CY) : null,
    crossSectionFirst14: windowed,
    cyberZ: {
      passrateMeanPct: zOf("passrateMeanPct"),
      passrateSlope: zOf("passrateSlopePpPerStep"),
      tisMean: zOf("tisMean"),
      tisMax: zOf("tisMax"),
      entropyMean: zOf("entropyMean"),
      lenMean: zOf("lenMean"),
      scoreMinMean: zOf("scoreMinMean"),
      scoreMinWorst: zOf("scoreMinWorst"),
      scoreMinBelowNeg03Share: zOf("scoreMinBelowNeg03Share"),
      scoreMinBelowNeg05Share: zOf("scoreMinBelowNeg05Share"),
    },
    crossSectionFirst14TopByNegativeTail: [...windowed]
      .sort((a: any, b: any) => (b.scoreMinBelowNeg03Share ?? -1) - (a.scoreMinBelowNeg03Share ?? -1))
      .slice(0, 8)
      .map((x: any) => ({ dataset: x.dataset, scoreMinMean: x.scoreMinMean, scoreMinWorst: x.scoreMinWorst, shareBelowNeg03: x.scoreMinBelowNeg03Share, shareBelowNeg05: x.scoreMinBelowNeg05Share })),
    otherDatasets: all,
  };
}

// ===========================================================================
// 7. S6 数据集之间的领先 / 滞后
// ===========================================================================

function leadLag(r: RunData, prMode: "missing" | "zero") {
  const n = r.steps.length;
  const dsets = dsList(r);
  // 差分序列
  const diffs: Record<string, (number | null)[]> = {};
  for (const d of dsets) {
    const p: (number | null)[] = (r.series[`train/passrate/avg_passrate/${d}`] ?? []).map((_, i) => passrate(r, d, i, prMode));
    const dd: (number | null)[] = [null];
    for (let i = 1; i < n; i++) dd.push(p[i] !== null && p[i - 1] !== null ? (p[i]! - p[i - 1]!) * 100 : null);
    diffs[d] = dd;
  }
  const shifted = (s: (number | null)[], lag: number) => s.map((_, i) => (i - lag >= 0 && i - lag < n ? s[i - lag] : null));

  // 平均互相关曲线（对全部无向配对）
  const lagCurve: Record<number, { sum: number; n: number; mean: number | null }> = {};
  for (let lag = -4; lag <= 4; lag++) lagCurve[lag] = { sum: 0, n: 0, mean: null };
  const pairLead: { a: string; b: string; fwd: number; bwd: number; diff: number }[] = [];
  for (let i = 0; i < dsets.length; i++) {
    for (let j = i + 1; j < dsets.length; j++) {
      const A = diffs[dsets[i]], B = diffs[dsets[j]];
      for (let lag = -4; lag <= 4; lag++) {
        const pr = pairs(shifted(A, lag), B);
        if (pr.x.length < 8) continue;
        const c = pearson(pr.x, pr.y);
        if (!Number.isFinite(c.r)) continue;
        lagCurve[lag].sum += c.r; lagCurve[lag].n++;
      }
      const fp = pairs(shifted(A, 0), shifted(B, 1)); const f = pearson(fp.x, fp.y);
      const bp = pairs(shifted(B, 0), shifted(A, 1)); const b = pearson(bp.x, bp.y);
      if (Number.isFinite(f.r) && Number.isFinite(b.r)) {
        pairLead.push({ a: dsets[i], b: dsets[j], fwd: round(f.r, 4), bwd: round(b.r, 4), diff: round(f.r - b.r, 4) });
      }
    }
  }
  const lagSummary = Object.entries(lagCurve).map(([k, v]) => ({ lag: +k, meanR: v.n ? round(v.sum / v.n, 4) : null, nPairs: v.n }));

  // 净领先分：对每一对 (X,Y)，若 corr(ΔX_t, ΔY_{t+1}) > corr(ΔY_t, ΔX_{t+1}) 记 X 领先 Y 一分
  const leadScore: Record<string, number> = {};
  for (const d of dsets) leadScore[d] = 0;
  let decisive = 0;
  for (const p of pairLead) {
    if (Math.abs(p.diff) < 1e-9) continue;
    decisive++;
    if (p.diff > 0) leadScore[p.a]++; else leadScore[p.b]++;
  }
  const leadRank = Object.entries(leadScore).map(([d, v]) => ({ dataset: d, netLeadWins: v, pairs: dsets.length - 1 })).sort((a, b) => b.netLeadWins - a.netLeadWins);

  // 符号检验：领先分是否显著偏离「随机一半」
  const pairsN = dsets.length - 1;
  // 双尾精确二项检验：p = 2 * min(P(X<=k), P(X>=k))，X~Bin(m, 0.5)
  const binomPmf = (i: number, m: number) => {
    let c = 1;
    for (let t = 0; t < i; t++) c = (c * (m - t)) / (t + 1);
    return c * Math.pow(0.5, m);
  };
  const signTest = (k: number, m: number) => {
    let lower = 0, upper = 0;
    for (let i = 0; i <= k; i++) lower += binomPmf(i, m);
    for (let i = k; i <= m; i++) upper += binomPmf(i, m);
    return Math.min(1, 2 * Math.min(lower, upper));
  };
  for (const row of leadRank as any[]) row.pSignTestVs50pct = pRound(signTest(row.netLeadWins, pairsN));

  // 突破步：3 步滑动均值首次 ≥ 首值 +2pp
  const breakthrough: { dataset: string; firstStep: number | null; firstPassratePct: number | null; smooth: (number | null)[] }[] = [];
  for (const d of dsets) {
    const p: (number | null)[] = (r.series[`train/passrate/avg_passrate/${d}`] ?? []).map((_, i) => passrate(r, d, i, prMode));
    const base = p.find((v) => v !== null) ?? null;
    let hitStep: number | null = null;
    for (let i = 2; i < n; i++) {
      const win = [p[i], p[i - 1], p[i - 2]].filter((v): v is number => v !== null);
      if (win.length < 2 || base === null) continue;
      if (mean(win) >= base + 0.02) { hitStep = r.steps[i]; break; }
    }
    breakthrough.push({ dataset: d, firstStep: hitStep, firstPassratePct: base === null ? null : round(base * 100, 3), smooth: p });
  }
  const bt = breakthrough.filter((x) => x.firstStep !== null && x.firstPassratePct !== null);
  const spBt = spearman(bt.map((x) => x.firstPassratePct as number), bt.map((x) => x.firstStep as number));

  // 首值难度 vs 提升幅度
  const stats = perDatasetStats(r, prMode).filter((x) => x.passrateDeltaPp !== null && !SENTINEL_DS.has(x.dataset));
  const spDiff = spearman(stats.map((x) => x.passrateFirstPct as number), stats.map((x) => x.passrateDeltaPp as number));

  return {
    run: r.run,
    nDiffs: n - 1,
    pairCount: pairLead.length,
    lagSummary,
    leadRank,
    leadRankSpread: leadRank.length ? leadRank[0].netLeadWins - leadRank[leadRank.length - 1].netLeadWins : null,
    signTestNote: `净领先分来自 ${pairsN} 个对手的成对比较；p 为「相对 50% 随机」的双尾二项检验`,
    breakthrough,
    breakthroughVsFirstPassrate: { n: spBt.n, rho: round(spBt.r, 4), p: pRound(spBt.p), crit: round(spearmanCrit(spBt.n), 4) },
    deltaVsFirstPassrate: { n: spDiff.n, rho: round(spDiff.r, 4), p: pRound(spDiff.p), crit: round(spearmanCrit(spDiff.n), 4) },
    topPairs: pairLead.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 10),
  };
}

/** 跨 run 一致性：同一数据集在 pro 与 flash 上的提升幅度是否同序 */
function crossRunConsistency(common: string[], proStats: any[], flashStats: any[]) {
  const a: number[] = [], b: number[] = [];
  for (const d of common) {
    const x = proStats.find((s) => s.dataset === d)?.passrateDeltaPp;
    const y = flashStats.find((s) => s.dataset === d)?.passrateDeltaPp;
    if (typeof x === "number" && typeof y === "number") { a.push(x); b.push(y); }
  }
  const sp = spearman(a, b);
  return { n: sp.n, rho: round(sp.r, 4), p: pRound(sp.p), crit: round(spearmanCrit(sp.n), 4), pairs: a.map((v, i) => ({ pro: v, flash: b[i] })) };
}

// ===========================================================================
// 8. S7 动态采样的行为
// ===========================================================================

function dynsam(r: RunData, baseStepCount = 3) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const restartSteps = r.status.events.filter((e: any) => e.kind === "restart").map((e: any) => e.t);
  // 事件里的 restart 落在哪两步之间（返回「重启后的第一个上报步」）
  const restartAffected: number[] = [];
  for (const t of restartSteps) {
    let k = 0;
    for (let i = 0; i < n; i++) if (r.walls[i] < t) k = i + 1;
    restartAffected.push(k + 1); // walls[i] 是第 i+1 步的墙钟，k 个已完成 → 下一个上报步
  }
  const restartAffectedSteps = [...new Set(restartAffected)].filter((s) => s >= 1 && s <= n).sort((a, b) => a - b);

  // held(t) ?= step(t) + carryover(t-1)
  const violations: { step: number; nDatasets: number; nTotal: number; badDatasets: string[] }[] = [];
  let ok = 0, bad = 0;
  for (let i = 1; i < n; i++) {
    let nBad = 0, nTot = 0; const badDs: string[] = [];
    for (const d of dsets) {
      const h = weight(r, d, i, "held"), s = weight(r, d, i, "step"), c = weight(r, d, i - 1, "carryover");
      if (h === null || s === null || c === null) continue;
      nTot++;
      const rel = Math.abs(h - (s + c)) / Math.max(1, h);
      if (rel <= 0.05) ok++; else { bad++; nBad++; badDs.push(d); }
    }
    if (nBad > 0) violations.push({ step: r.steps[i], nDatasets: nBad, nTotal: nTot, badDatasets: badDs });
  }

  // 流量是否从「已学会 / 完全不会」撤走
  // 1) 份额变化 vs 期初通过率（横截面，n=数据集数）
  const shareChange = dsets.map((d) => {
    const s = r.series[`dynsam/${d}/num_accepted/step`];
    const tot = (i: number) => dsets.reduce((a, x) => a + ((r.series[`dynsam/${x}/num_accepted/step`]?.[i] as number) || 0), 0);
    const s0 = s[0] !== null ? (s[0] as number) / tot(0) : null;
    const sT = s[n - 1] !== null ? (s[n - 1] as number) / tot(n - 1) : null;
    const p0 = passrate(r, d, 0, "missing");
    const pT = passrate(r, d, n - 1, "missing");
    return {
      dataset: d, s0: round(s0 as number, 5), sT: round(sT as number, 5),
      deltaSharePp: s0 !== null && sT !== null ? round((sT - s0) * 100, 3) : null,
      passrateFirst: p0 === null ? null : round(p0, 5),
      passrateLast: pT === null ? null : round(pT, 5),
    };
  });
  const sc = shareChange.filter((x) => x.deltaSharePp !== null && x.passrateFirst !== null && !SENTINEL_DS.has(x.dataset));
  const spShareVsP0 = spearman(sc.map((x) => x.passrateFirst as number), sc.map((x) => x.deltaSharePp as number));
  const spShareVsPT = spearman(
    sc.map((x) => x.passrateLast as number), sc.map((x) => x.deltaSharePp as number));

  // 2) 面板回归：Δshare 对「滞后一期的通过率」与其平方（倒 U 形 = 采样器把流量收向 p≈0.5）
  const X1: number[] = [], X2: number[] = [], Y: number[] = [], meta: any[] = [];
  for (let i = 1; i < n; i++) {
    const totP = dsets.reduce((a, x) => a + ((r.series[`dynsam/${x}/num_accepted/step`]?.[i - 1] as number) || 0), 0);
    const totC = dsets.reduce((a, x) => a + ((r.series[`dynsam/${x}/num_accepted/step`]?.[i] as number) || 0), 0);
    if (!totP || !totC) continue;
    for (const d of dsets) {
      const wPrev = weight(r, d, i - 1, "step"), wCur = weight(r, d, i, "step");
      const pPrev = passrate(r, d, i - 1, "missing");
      if (wPrev === null || wCur === null || pPrev === null || SENTINEL_DS.has(d)) continue;
      const dShare = wCur / totC - wPrev / totP;
      X1.push(pPrev); X2.push(pPrev * pPrev); Y.push(dShare * 100);
      meta.push({ run: r.run, dataset: d, step: r.steps[i], pPrev, dSharePp: dShare * 100 });
    }
  }
  // 多元 OLS（两个自变量）
  function ols2(x1: number[], x2: number[], y: number[]) {
    const m = x1.length;
    if (m < 10) return null;
    // 正规方程
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    const cols = [new Array(m).fill(1), x1, x2];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) { let s = 0; for (let i = 0; i < m; i++) s += cols[a][i] * cols[b][i]; M[a][b] = s; }
      let s = 0; for (let i = 0; i < m; i++) s += cols[a][i] * y[i]; v[a] = s;
    }
    // 高斯消元
    const A = M.map((row, i) => [...row, v[i]]);
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let rr = c + 1; rr < 3; rr++) if (Math.abs(A[rr][c]) > Math.abs(A[piv][c])) piv = rr;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let rr = 0; rr < 3; rr++) {
        if (rr === c) continue;
        const f = A[rr][c] / A[c][c];
        for (let cc = c; cc < 4; cc++) A[rr][cc] -= f * A[c][cc];
      }
    }
    const beta = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
    let sse = 0;
    for (let i = 0; i < m; i++) { const fit = beta[0] + beta[1] * x1[i] + beta[2] * x2[i]; sse += (y[i] - fit) ** 2; }
    const df = m - 3;
    const s2 = sse / df;
    // (X'X)^-1 对角
    const inv = (() => {
      const Aug = M.map((row, i) => [...row, i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]);
      for (let c = 0; c < 3; c++) {
        let piv = c;
        for (let rr = c + 1; rr < 3; rr++) if (Math.abs(Aug[rr][c]) > Math.abs(Aug[piv][c])) piv = rr;
        [Aug[c], Aug[piv]] = [Aug[piv], Aug[c]];
        const pv = Aug[c][c];
        for (let cc = 0; cc < 6; cc++) Aug[c][cc] /= pv;
        for (let rr = 0; rr < 3; rr++) {
          if (rr === c) continue;
          const f = Aug[rr][c];
          for (let cc = 0; cc < 6; cc++) Aug[rr][cc] -= f * Aug[c][cc];
        }
      }
      return Aug.map((r) => r.slice(3));
    })();
    const se = [Math.sqrt(s2 * inv[0][0]), Math.sqrt(s2 * inv[1][1]), Math.sqrt(s2 * inv[2][2])];
    const t = [beta[0] / se[0], beta[1] / se[1], beta[2] / se[2]];
    const p = t.map((x) => 2 * (1 - tCDF(Math.abs(x), df)));
    const tc = tQuantile(0.975, df);
    return {
      n: m, df,
      intercept: { b: round(beta[0], 5), se: round(se[0], 5), p: pRound(p[0]), ci95: [round(beta[0] - tc * se[0], 5), round(beta[0] + tc * se[0], 5)] },
      linear: { b: round(beta[1], 5), se: round(se[1], 5), p: pRound(p[1]), ci95: [round(beta[1] - tc * se[1], 5), round(beta[1] + tc * se[1], 5)] },
      quad: { b: round(beta[2], 5), se: round(se[2], 5), p: pRound(p[2]), ci95: [round(beta[2] - tc * se[2], 5), round(beta[2] + tc * se[2], 5)] },
      vertexP: beta[2] !== 0 ? round(-beta[1] / (2 * beta[2]), 4) : null,
    };
  }
  const quadFit = ols2(X1, X2, Y);

  // 固定效应版：扣掉每个数据集自己的均值，只看「同一数据集内部」份额随难度的变化
  const byDs: Record<string, number[]> = {};
  meta.forEach((m: any, k: number) => { (byDs[m.dataset] ||= []).push(k); });
  const X1d: number[] = [], X2d: number[] = [], Yd: number[] = [];
  for (const d of Object.keys(byDs)) {
    const ks = byDs[d];
    if (ks.length < 5) continue;
    const mp = mean(ks.map((k) => X1[k]));
    const mp2 = mean(ks.map((j) => X1[j] * X1[j]));
    const ms = mean(ks.map((k) => Y[k]));
    for (const k of ks) { X1d.push(X1[k] - mp); X2d.push(X1[k] * X1[k] - mp2); Yd.push(Y[k] - ms); }
  }
  const quadFitFE = ols2(X1d, X2d, Yd);

  // 更粗的非参检验：中间带 [0.35,0.75) 与两端的下一期份额变化
  const midArr = meta.filter((m: any) => m.pPrev >= 0.35 && m.pPrev < 0.75).map((m: any) => m.dSharePp);
  const edgeArr = meta.filter((m: any) => !(m.pPrev >= 0.35 && m.pPrev < 0.75)).map((m: any) => m.dSharePp);
  const welch = (() => {
    if (midArr.length < 5 || edgeArr.length < 5) return null;
    const m1 = mean(midArr), m2 = mean(edgeArr), v1 = sd(midArr) ** 2, v2 = sd(edgeArr) ** 2;
    const se = Math.sqrt(v1 / midArr.length + v2 / edgeArr.length);
    if (!(se > 0)) return null;
    const t = (m1 - m2) / se;
    const df = (v1 / midArr.length + v2 / edgeArr.length) ** 2 /
      ((v1 / midArr.length) ** 2 / (midArr.length - 1) + (v2 / edgeArr.length) ** 2 / (edgeArr.length - 1));
    return { nMid: midArr.length, nEdge: edgeArr.length, meanMidPp: round(m1, 5), meanEdgePp: round(m2, 5), diffPp: round(m1 - m2, 5), se: round(se, 5), t: round(t, 4), df: round(df, 2), p: pRound(2 * (1 - tCDF(Math.abs(t), df))) };
  })();

  // 3) 非参数：按滞后一期通过率分箱，看下一期的份额变化
  const bins = [0, 0.35, 0.45, 0.55, 0.65, 1.01];
  const binRows = bins.slice(0, -1).map((lo, k) => {
    const hi = bins[k + 1];
    const sel = meta.filter((m) => m.pPrev >= lo && m.pPrev < hi);
    return {
      bin: `[${lo},${hi})`, n: sel.length,
      meanPassrate: sel.length ? round(mean(sel.map((m) => m.pPrev)), 4) : null,
      meanDeltaSharePp: sel.length ? round(mean(sel.map((m) => m.dSharePp)), 5) : null,
    };
  });

  // 4) 首末份额变化最大的数据集
  const sortedShare = [...shareChange].sort((a, b) => (b.deltaSharePp ?? -99) - (a.deltaSharePp ?? -99));

  return {
    run: r.run,
    nSteps: n,
    restartAffectedSteps,
    heldIdentity: {
      tested: "held(t) = step(t) + carryover(t-1)",
      okCount: ok, badCount: bad, okPct: round((100 * ok) / (ok + bad), 2),
      violationSteps: violations.map((v) => ({ step: v.step, nBadDatasets: v.nDatasets, nTotalDatasets: v.nTotal })),
      violationStepsAllDatasets: violations.filter((v) => v.nDatasets >= v.nTotal * 0.8).map((v) => v.step),
    },
    shareChange: sortedShare,
    shareVsImprovement: shareVsImprovement(r),
    shareVsInitialPassrate: { n: spShareVsP0.n, rho: round(spShareVsP0.r, 4), p: pRound(spShareVsP0.p), crit: round(spearmanCrit(spShareVsP0.n), 4) },
    shareVsFinalPassrate: { n: spShareVsPT.n, rho: round(spShareVsPT.r, 4), p: pRound(spShareVsPT.p), crit: round(spearmanCrit(spShareVsPT.n), 4) },
    quadRegression: {
      spec: "Δshare_d(t) = a + b·p_d(t−1) + c·p_d(t−1)² (pp)，混合 OLS",
      result: quadFit,
      n: X1.length,
    },
    quadRegressionFE: {
      spec: "同上但扣掉每个数据集自己的均值（数据集固定效应）",
      result: quadFitFE,
      n: X1d.length,
    },
    midVsEdge: { spec: "中间带 p∈[0.35,0.75) vs 两端 的下一期份额变化（Welch t）", result: welch },
    bins: binRows,
    binNote: "倒 U（中间箱 Δshare 为正、两端为负）即采样器把流量从「已学会」和「完全不会」收向中间难度",
  };
}

// ===========================================================================
// 9. 附加核查（机械恒等式 vs 发现）
// ===========================================================================

function mechanicalChecks(r: RunData) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const checks: any[] = [];

  // (a) 全局 passrate 是否等于按 num_accepted 加权的数据集平均
  const g = r.series["train/passrate/avg_passrate"];
  for (const wKind of ["step", "held", "equal"] as const) {
    let maxRel = 0, medRel: number[] = [], worstStep = 0;
    for (let i = 0; i < n; i++) {
      let num = 0, den = 0;
      for (const d of dsets) {
        const p = passrate(r, d, i, "missing"); if (p === null) continue;
        const w = wKind === "equal" ? 1 : weight(r, d, i, wKind);
        if (w === null || !w) continue;
        num += w * p; den += w;
      }
      if (!den || g[i] === null) continue;
      const rel = Math.abs(num / den - (g[i] as number)) / (g[i] as number);
      medRel.push(rel);
      if (rel > maxRel) { maxRel = rel; worstStep = r.steps[i]; }
    }
    checks.push({
      check: `dashboard train/passrate/avg_passrate ?= dataset level weighted by ${wKind}`,
      maxRelErrPct: round(maxRel * 100, 3), medianRelErrPct: round(median(medRel) * 100, 3), worstStep,
      note: "数据集层不含 agentic（agentic 只在类别层上报），因此不应当作恒等式",
    });
  }

  // (b) 会话熵 / KL / clipfrac 是否恒为 0
  for (const suf of ["ppo_kl", "pg_clipfrac", "pg_tis_clipfrac", "entropy_loss"]) {
    const ks = Object.keys(r.series).filter((k) => k.includes("dataset-") && k.endsWith("/" + suf));
    let allZero = true, cnt = 0, mx = 0;
    for (const k of ks) for (const v of r.series[k]) if (v !== null) { cnt++; if (v !== 0) allZero = false; mx = Math.max(mx, v); }
    checks.push({ check: `all actor/*/dataset-*/${suf}`, nSeries: ks.length, nValues: cnt, allZero, max: mx, note: allZero ? "机械恒等（恒为 0），不可用于任何推断" : "有非零值" });
  }

  // (c) 哨兵 0 的证据：同期 critic score/mean 是正常值
  const sentinelRows = [...SENTINEL_DS].map((d) => {
    const p = r.series[`train/passrate/avg_passrate/${d}`];
    const cs = r.series[`critic/${d}/score/mean`];
    const zeroSteps: number[] = [];
    const csAtZero: (number | null)[] = [];
    for (let i = 0; i < n; i++) if (p[i] === 0) { zeroSteps.push(r.steps[i]); csAtZero.push(cs ? cs[i] : null); }
    const nonZeroP = p.filter((v) => v !== null && v > 0) as number[];
    return {
      dataset: d, zeroSteps, nZeros: zeroSteps.length,
      criticScoreAtZeroSteps: csAtZero,
      passrateNonZeroMin: nonZeroP.length ? round(Math.min(...nonZeroP), 4) : null,
      passrateNonZeroMax: nonZeroP.length ? round(Math.max(...nonZeroP), 4) : null,
      criticScoreNonZeroMean: cs ? round(mean(cs.filter((v): v is number => v !== null)), 4) : null,
      verdict: "同期 critic/score/mean 不为 0 → 精确 0 更可能是未上报而非真实 0%",
    };
  });

  // (d) critic/score/mean 与 train/passrate 的差（不是恒等，量化差值）
  const diffs: { dataset: string; meanAbsDiffPp: number; maxAbsDiffPp: number; n: number }[] = [];
  for (const d of dsets) {
    const p = r.series[`train/passrate/avg_passrate/${d}`];
    const cs = r.series[`critic/${d}/score/mean`];
    if (!cs) continue;
    let s = 0, m = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (p[i] === null || cs[i] === null) continue;
      if (SENTINEL_DS.has(d) && p[i] === 0) continue;
      const dd = Math.abs(cs[i]! - p[i]!) * 100; s += dd; m = Math.max(m, dd); k++;
    }
    if (k) diffs.push({ dataset: d, meanAbsDiffPp: round(s / k, 4), maxAbsDiffPp: round(m, 4), n: k });
  }
  diffs.sort((a, b) => b.meanAbsDiffPp - a.meanAbsDiffPp);

  return { run: r.run, dashboardAggregation: checks.slice(0, 3), zeroMetrics: checks.slice(3), sentinelEvidence: sentinelRows, criticVsPassrate: diffs };
}

// ===========================================================================
// 10. 组装 + 输出
// ===========================================================================

const pro = RUNS.pro, flash = RUNS.flash;
const proStats = perDatasetStats(pro, "missing");
const flashStats = perDatasetStats(flash, "missing");
const proStatsZero = perDatasetStats(pro, "zero");
const flashStatsZero = perDatasetStats(flash, "zero");

const common24 = dsList(pro).filter((d) => dsList(flash).includes(d));

const out: any = {
  meta: {
    generatedAt: new Date().toISOString(),
    note: "MiMo-V2.6 RL 看板本地遥测的逐数据集异质性分析。脚本不硬编码结论数字。",
    sourceFiles: [
      "data/store/runs/{pro,flash}/{series,axis,status,tags}.json",
      "data/store/{notices,benchmarks}.json",
    ],
    sentinelDatasets: [...SENTINEL_DS],
    proSteps: pro.steps.length, flashSteps: flash.steps.length,
    proDatasets: dsList(pro).length, flashDatasets: dsList(flash).length,
    restartEvents: { pro: pro.status.events.filter((e: any) => e.kind === "restart").length, flash: flash.status.events.filter((e: any) => e.kind === "restart").length },
    totals: { pro: pro.status.totals, flash: flash.status.totals },
  },
  S1_inventory: [buildInventory(pro), buildInventory(flash)],
  S2_perDataset: { pro: proStats, flash: flashStats, pro_zeroAsReal: proStatsZero, flash_zeroAsReal: flashStatsZero },
  S2_classificationCounts: {
    pro: countBy(proStats.map((x) => x.class)),
    flash: countBy(flashStats.map((x) => x.class)),
  },
  S3_composition: {
    pro_passrate_accW: composition(pro, "passrate", "step"),
    pro_passrate_eqW: composition(pro, "passrate", "equal"),
    pro_passrate_heldW: composition(pro, "passrate", "held"),
    pro_passrate_zeroAsReal: composition(pro, "passrate_keepzero", "step"),
    pro_length_accW: composition(pro, "response_length_mean", "step"),
    pro_passrate_cyberEra: compositionWindow(pro, "passrate", "step", [1], 14, "train/passrate/avg_passrate"),
    flash_passrate_accW: composition(flash, "passrate", "step"),
    flash_passrate_eqW: composition(flash, "passrate", "equal"),
    flash_passrate_heldW: composition(flash, "passrate", "held"),
    flash_passrate_zeroAsReal: composition(flash, "passrate_keepzero", "step"),
    flash_length_accW: composition(flash, "response_length_mean", "step"),
  },
  S3c_dashboardVsPanelGap: { pro: dashboardVsPanel(pro), flash: dashboardVsPanel(flash) },
  S3b_simpsonDirection: {
    pro: simpsonDirection(pro, proStats),
    flash: simpsonDirection(flash, flashStats),
  },
  S4_elasticity: { pro: elasticity(pro, "missing"), flash: elasticity(flash, "missing"), pro_zeroAsReal: elasticity(pro, "zero"), flash_zeroAsReal: elasticity(flash, "zero") },
  S5_cyber: { pro: cyberEvidence(pro), flash: cyberEvidence(flash) },
  S6_leadLag: { pro: leadLag(pro, "missing"), flash: leadLag(flash, "missing") },
  S6b_crossRun: crossRunConsistency(common24, proStats, flashStats),
  S7_dynsam: { pro: dynsam(pro), flash: dynsam(flash) },
  S8_mechanicalChecks: [mechanicalChecks(pro), mechanicalChecks(flash)],
};

function countBy(xs: (string | null)[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x ?? "null"] = (m[x ?? "null"] || 0) + 1;
  return m;
}

/** 只在 [1, endStep] 这段窗口里做分解（用于 pro 的 cyber 时代对照） */
function compositionWindow(r: RunData, metric: string, weightKind: "step" | "held" | "equal", baseSteps: number[], endStep: number, dashKey: string) {
  const { get, unitScale } = metricGetter(metric);
  const dsets = dsList(r);
  const w = (d: string, i: number) => (weightKind === "equal" ? (get(r, d, i) === null ? null : 1) : weight(r, d, i, weightKind));
  const t0 = 0, tT = endStep - 1;
  const baseW: Record<string, number> = {};
  for (const d of dsets) {
    const vals = baseSteps.map((s) => w(d, s - 1)).filter((v): v is number => v !== null);
    baseW[d] = vals.length ? mean(vals) : 0;
  }
  const panel: string[] = [];
  const excluded: { dataset: string; reason: string }[] = [];
  for (const d of dsets) {
    const g0 = get(r, d, t0), gT = get(r, d, tT);
    const w0 = w(d, t0), wT = w(d, tT);
    if (g0 === null && gT === null) { excluded.push({ dataset: d, reason: "窗口内无该指标" }); continue; }
    if (g0 === null || gT === null) { excluded.push({ dataset: d, reason: "首或末该指标缺失" }); continue; }
    if (w0 === null || wT === null || w0 <= 0 || wT <= 0) { excluded.push({ dataset: d, reason: "首或末权重缺失/为 0" }); continue; }
    panel.push(d);
  }
  const W0 = panel.reduce((a, d) => a + (w(d, t0) as number), 0);
  const WT = panel.reduce((a, d) => a + (w(d, tT) as number), 0);
  const s0 = (d: string) => (w(d, t0) as number) / W0;
  const sT = (d: string) => (w(d, tT) as number) / WT;
  let within = 0, comp = 0, inter = 0;
  const contributions = panel.map((d) => {
    const p0 = get(r, d, t0) as number, pT = get(r, d, tT) as number;
    const ds = sT(d) - s0(d), dp = pT - p0;
    const wTerm = s0(d) * dp * unitScale, cTerm = ds * p0 * unitScale, iTerm = ds * dp * unitScale;
    within += wTerm; comp += cTerm; inter += iTerm;
    return { dataset: d, s0: round(s0(d), 5), sT: round(sT(d), 5), shareDeltaPp: round(ds * 100, 4), p0: round(p0, 5), pT: round(pT, 5), withinTerm: round(wTerm, 4), compTerm: round(cTerm, 4), interactionTerm: round(iTerm, 4) };
  });
  contributions.sort((a, b) => b.compTerm + b.withinTerm - (a.compTerm + a.withinTerm));
  const timeline: any[] = [];
  for (let i = 0; i <= tT; i++) {
    let num = 0, den = 0;
    for (const d of dsets) { const g = get(r, d, i); const ww = w(d, i); if (g === null || ww === null || ww <= 0) continue; num += ww * g; den += ww; }
    const a = den ? num / den : null;
    let num2 = 0, den2 = 0;
    for (const d of panel) { const g = get(r, d, i); if (g === null || baseW[d] <= 0) continue; num2 += baseW[d] * g; den2 += baseW[d]; }
    const f = den2 ? num2 / den2 : null;
    timeline.push({ step: r.steps[i], actual: a === null ? null : round(a * unitScale, 4), fixed: f === null ? null : round(f * unitScale, 4), gapActualVsFixed: a === null || f === null ? null : round((a - f) * unitScale, 4) });
  }
  const total = within + comp + inter;
  return {
    run: r.run, metric, weightKind, window: [r.steps[0], r.steps[tT]], baseSteps, panel, panelSize: panel.length, excludedFromPanel: excluded,
    decomposition: {
      totalChange: round(total, 4), withinBaseWeights: round(within, 4), compositionBaseRates: round(comp, 4), interaction: round(inter, 4),
      withinSharePct: total !== 0 ? round((within / total) * 100, 2) : null,
      compositionPlusInteractionSharePct: total !== 0 ? round(((comp + inter) / total) * 100, 2) : null,
      note: "同 composition()：三项 shift-share，窗口首末两步",
    },
    timeline, contributions, curveGap: null,
  };
}

/**
 * 辛普森方向检查：每个数据集自己的斜率符号 vs 它在加权聚合里的方向。
 * 输出「自己的趋势向上但权重份额下降（或反之）」的数据集。
 */
function simpsonDirection(r: RunData, stats: any[]) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const share = shareSeries(r);
  const rows = dsets.map((d) => {
    const st = stats.find((s) => s.dataset === d);
    const s = share[d];
    const o = ols(r.steps, s as any);
    return {
      dataset: d,
      passrateSlopePpPerStep: st?.passrateSlopePpPerStep ?? null,
      passrateDeltaPp: st?.passrateDeltaPp ?? null,
      shareSlopePctPerStep: o ? round(o.slope * 100, 5) : null,
      shareDeltaPct: round((s[n - 1]! - s[0]!) * 100, 4),
    };
  });
  const opposite = rows.filter((x) => x.passrateDeltaPp !== null && x.shareDeltaPct !== null &&
    Math.sign(x.passrateDeltaPp) !== 0 && Math.sign(x.shareDeltaPct) !== 0 &&
    Math.sign(x.passrateDeltaPp) !== Math.sign(x.shareDeltaPct));
  return { rows, weightMovedOppositeToImprovement: opposite };
}

/**
 * 看板全局 train/passrate/avg_passrate 与「数据集层 panel 加权重构」的差，
 * 并用恒等式反解未在数据集层拆出的 agentic 池子的通过率（口径近似，仅作解释性证据）。
 */
function dashboardVsPanel(r: RunData) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const g = r.series["train/passrate/avg_passrate"];
  // 与 S3 分解同一个共同 panel：首末两步都有通过率且权重 > 0
  const panelCommon = dsets.filter((d) => {
    const p0 = passrate(r, d, 0, "missing"), pT = passrate(r, d, n - 1, "missing");
    const w0 = weight(r, d, 0, "step"), wT = weight(r, d, n - 1, "step");
    return p0 !== null && pT !== null && w0 !== null && wT !== null && w0 > 0 && wT > 0;
  });
  const agg = (list: string[], i: number) => {
    let num = 0, den = 0, cnt = 0;
    for (const d of list) {
      const p = passrate(r, d, i, "missing");
      const w = weight(r, d, i, "step");
      if (p === null || w === null || !w) continue;
      num += w * p; den += w; cnt++;
    }
    return { mean: den ? num / den : null, weight: den, count: cnt, num };
  };
  const rows: any[] = [];
  let maxGap = 0, maxGapStep = 0;
  for (let i = 0; i < n; i++) {
    const pc = agg(panelCommon, i);
    const pa = agg(dsets, i);
    const wa = r.series["dynsam/agentic/num_accepted/step"]?.[i] ?? null;
    let impliedAgentic: number | null = null;
    if (pa.mean !== null && wa !== null && wa > 0 && g[i] !== null) {
      impliedAgentic = ((g[i] as number) * (pa.weight + wa) - pa.num) / wa;
    }
    const gap = pc.mean !== null && g[i] !== null ? (pc.mean - (g[i] as number)) * 100 : null;
    if (gap !== null && Math.abs(gap) > Math.abs(maxGap)) { maxGap = gap; maxGapStep = r.steps[i]; }
    rows.push({
      step: r.steps[i],
      dashboardGlobalPct: g[i] === null ? null : round((g[i] as number) * 100, 4),
      commonPanelPct: pc.mean === null ? null : round(pc.mean * 100, 4),
      commonPanelDatasets: pc.count,
      allAvailablePanelPct: pa.mean === null ? null : round(pa.mean * 100, 4),
      allAvailableDatasets: pa.count,
      commonPanelMinusDashboardPp: gap === null ? null : round(gap, 4),
      agenticPoolWeight: wa,
      impliedAgenticPassratePct: impliedAgentic === null ? null : round(impliedAgentic * 100, 4),
    });
  }
  const first = rows[0], last = rows[n - 1];
  const iaFirst = rows.find((x) => x.impliedAgenticPassratePct !== null);
  const iaLast = [...rows].reverse().find((x) => x.impliedAgenticPassratePct !== null);
  return {
    run: r.run,
    note: "看板全局含未在数据集层拆出的 agentic 池（dynsam/agentic/num_accepted/step），两者不是同一口径，只比变化量；commonPanel 与 S3 分解同一批数据集。",
    commonPanel: panelCommon, commonPanelSize: panelCommon.length,
    timeline: rows,
    dashboardChangePp: last.dashboardGlobalPct !== null && first.dashboardGlobalPct !== null ? round(last.dashboardGlobalPct - first.dashboardGlobalPct, 4) : null,
    commonPanelChangePp: last.commonPanelPct !== null && first.commonPanelPct !== null ? round(last.commonPanelPct - first.commonPanelPct, 4) : null,
    commonPanelMinusDashboardChangePp: (last.commonPanelPct !== null && first.commonPanelPct !== null && last.dashboardGlobalPct !== null && first.dashboardGlobalPct !== null)
      ? round((last.commonPanelPct - first.commonPanelPct) - (last.dashboardGlobalPct - first.dashboardGlobalPct), 4) : null,
    maxAbsGapPp: round(maxGap, 4), maxAbsGapStep: maxGapStep,
    impliedAgenticFirstPct: iaFirst ? iaFirst.impliedAgenticPassratePct : null,
    impliedAgenticLastPct: iaLast ? iaLast.impliedAgenticPassratePct : null,
    impliedAgenticChangePp: iaFirst && iaLast ? round(iaLast.impliedAgenticPassratePct - iaFirst.impliedAgenticPassratePct, 4) : null,
  };
}

/** 权重份额变化与同期通过率变化的相关（直接检验「是否从变好的数据集撤流量」） */
function shareVsImprovement(r: RunData) {
  const n = r.steps.length;
  const dsets = dsList(r);
  const rows = dsets.map((d) => {
    const p = r.series[`train/passrate/avg_passrate/${d}`];
    const ii = p.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    if (!ii.length) return null;
    const p0 = passrate(r, d, ii[0], "missing"), pT = passrate(r, d, ii[ii.length - 1], "missing");
    const share = shareSeries(r)[d];
    return {
      dataset: d,
      passrateDeltaPp: p0 !== null && pT !== null ? round((pT - p0) * 100, 3) : null,
      shareDeltaPp: round((share[ii[ii.length - 1]] - share[ii[0]]) * 100, 4),
    };
  }).filter(Boolean) as any[];
  const use = rows.filter((x) => !SENTINEL_DS.has(x.dataset) && x.passrateDeltaPp !== null);
  const sp = spearman(use.map((x) => x.passrateDeltaPp), use.map((x) => x.shareDeltaPp));
  return { run: r.run, n: sp.n, rho: round(sp.r, 4), p: pRound(sp.p), crit: round(spearmanCrit(sp.n), 4), rows };
}

function shareSeries(r: RunData): Record<string, number[]> {
  const dsets = dsList(r);
  const n = r.steps.length;
  const tot = (i: number) => dsets.reduce((a, x) => a + ((r.series[`dynsam/${x}/num_accepted/step`]?.[i] as number) || 0), 0);
  const out2: Record<string, number[]> = {};
  for (const d of dsets) {
    const w = r.series[`dynsam/${d}/num_accepted/step`];
    out2[d] = Array.from({ length: n }, (_, i) => ((w?.[i] as number) || 0) / (tot(i) || 1));
  }
  return out2;
}

mkdirSync(ANALYSIS, { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

// ===========================================================================
// 11. stdout 人读摘要
// ===========================================================================
if (!JSON_ONLY) {
  const L = (s = "") => console.log(s);
  L(`# Per-dataset heterogeneity - recomputation summary`);
  L(`Wrote file: ${OUT_JSON}`);
  L();
  L(`## 1 Dataset inventory`);
  for (const inv of out.S1_inventory) {
    L(`  ${inv.run}: ${inv.nSteps} steps, ${inv.nDatasets} datasets`);
    for (const [c, list] of Object.entries(inv.byCategory)) L(`    ${c} (${list.length}): ${list.map((d) => d.split("/")[1]).join(" ")}`);
    const dropped = inv.datasets.filter((d: any) => d.passrateMissing > 0);
    for (const d of dropped) L(`    ! ${d.dataset}: passrate missing ${d.passrateMissing} steps, first ${d.firstStep} last ${d.lastStep}`);
  }
  L();
  L(`## 2 Per-dataset classification`);
  for (const run of ["pro", "flash"]) {
    L(`  ${run}: ${JSON.stringify(out.S2_classificationCounts[run])}`);
    for (const s of out.S2_perDataset[run]) {
      L(`    ${(s.class ?? "-").padEnd(5)} ${s.dataset.padEnd(28)} Δ=${String(s.passrateDeltaPp).padStart(7)}pp b=${String(s.passrateSlopePpPerStep).padStart(7)} p=${String(s.passrateSlopeP).padStart(9)} len×${s.lenRatio ?? "-"} ent ${s.entropyFirst}→${s.entropyLast}`);
    }
  }
  L();
  L(`## 3 Composition effect (fixed weights vs actual weights)`);
  for (const [k, v] of Object.entries(out.S3_composition) as any) {
    if (!v) continue;
    const D = v.decomposition;
    L(`  ${k}: nPanel=${v.panelSize} Δtotal=${D.totalChange} own=${D.withinBaseWeights} (${D.withinSharePct}%) composition=${D.compositionBaseRates} interaction=${D.interaction} shareOfTotal=${D.compositionPlusInteractionSharePct}%`);
    if (v.curves) for (const [ck, cv] of Object.entries(v.curves) as any) {
      L(`      ${ck}: end actual=${cv.endpointActualAtT} fixed=${cv.endpointFixedAtT} gap=${cv.endGap} max|gap|=${cv.maxAbsGap}@step${cv.maxAbsGapStep}`);
    }
  }
  L();
  L(`## 3b Where weights move (improvement vs opposite share)`);
  for (const run of ["pro", "flash"]) {
    const rows = out.S3b_simpsonDirection[run].weightMovedOppositeToImprovement;
    L(`  ${run}: ${rows.length} datasets where score change and weight-share change point in opposite directions: ${rows.map((x: any) => `${x.dataset}(${x.passrateDeltaPp}pp/${x.shareDeltaPct}%)`).join(" ")}`);
  }
  L();
  L(`## 4 Length-score elasticity`);
  for (const run of ["pro", "flash"]) {
    L(`  ${run}:`);
    for (const e of out.S4_elasticity[run]) {
      L(`    ${e.dataset.padEnd(28)} n=${String(e.n).padStart(2)} level=${String(e.level?.slopePpPer10k ?? "-").padStart(8)} p=${String(e.level?.p ?? "-").padStart(9)} | diff=${String(e.diff?.slope ?? "-").padStart(8)} p=${String(e.diff?.p ?? "-").padStart(9)} → ${e.verdict}`);
    }
  }
  L();
  L(`## 5 cyber evidence`);
  for (const run of ["pro", "flash"]) {
    const c = out.S5_cyber[run];
    L(`  ${run}: cyber present=${c.cyberPresent} last reporting step=${c.lastCyberReportingStep} first missing step=${c.firstMissingStep}`);
    if (c.noticeAlign) L(`    notice ${c.noticeAlign.noticeISO} landed after ${c.noticeAlign.completedStepsBeforeNotice} completed steps`);
    if (c.cyberZ) for (const [k, v] of Object.entries(c.cyberZ)) L(`    ${k}: ${JSON.stringify(v)}`);
    if (c.crossSectionFirst14TopByNegativeTail) L(`    top 8 heaviest negative tails: ${JSON.stringify(c.crossSectionFirst14TopByNegativeTail)}`);
  }
  L();
  L(`## 6 Lead/lag`);
  for (const run of ["pro", "flash"]) {
    const l = out.S6_leadLag[run];
    L(`  ${run}: mean cross-correlation curve ${l.lagSummary.map((x: any) => `lag${x.lag}:${x.meanR}`).join(" ")}`);
    L(`    net lead score spread=${l.leadRankSpread}, breakthrough step vs first-value difficulty rho=${l.breakthroughVsFirstPassrate.rho} p=${l.breakthroughVsFirstPassrate.p}`);
    L(`    Δ vs first-value difficulty rho=${l.deltaVsFirstPassrate.rho} p=${l.deltaVsFirstPassrate.p}`);
  }
  L(`  cross-run consistency: ${JSON.stringify(out.S6b_crossRun)}`);
  L();
  L(`## 7 Dynamic sampling`);
  for (const run of ["pro", "flash"]) {
    const d = out.S7_dynsam[run];
    L(`  ${run}: held identity ok=${d.heldIdentity.okPct}% broken steps=${JSON.stringify(d.heldIdentity.violationStepsAllDatasets)} restart-affected steps=${JSON.stringify(d.restartAffectedSteps)}`);
    L(`    Δshare vs initial passrate rho=${d.shareVsInitialPassrate.rho} p=${d.shareVsInitialPassrate.p}; vs final rho=${d.shareVsFinalPassrate.rho} p=${d.shareVsFinalPassrate.p}`);
    L(`    inverted-U regression (pooled): quad=${JSON.stringify(d.quadRegression.result?.quad)} linear=${JSON.stringify(d.quadRegression.result?.linear)}`);
    L(`    inverted-U regression (fixed effects): quad=${JSON.stringify(d.quadRegressionFE.result?.quad)} linear=${JSON.stringify(d.quadRegressionFE.result?.linear)} n=${d.quadRegressionFE.n}`);
    L(`    middle band vs edges: ${JSON.stringify(d.midVsEdge.result)}`);
    L(`    bins: ${d.bins.map((b: any) => `${b.bin}:${b.meanDeltaSharePp}`).join(" ")}`);
  }
  L();
  L(`## 8 Mechanical identity checks`);
  for (const m of out.S8_mechanicalChecks) {
    L(`  ${m.run}:`);
    for (const c of m.dashboardAggregation) L(`    ${c.check} → max ${c.maxRelErrPct}% median ${c.medianRelErrPct}% (worst step ${c.worstStep})`);
    for (const c of m.zeroMetrics) L(`    ${c.check}: allZero=${c.allZero} max=${c.max} (n=${c.nValues})`);
    for (const s of m.sentinelEvidence) L(`    ${s.dataset}: 0 occurs ${s.nZeros} times @ ${JSON.stringify(s.zeroSteps)}; same-step critic score=${JSON.stringify(s.criticScoreAtZeroSteps)}; non-zero passrate range [${s.passrateNonZeroMin},${s.passrateNonZeroMax}]`);
  }
}
