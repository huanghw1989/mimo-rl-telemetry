#!/usr/bin/env bun
/**
 * correlate_report.ts
 * MiMo-V2.6 RL 公开看板本地遥测数据的「生成长度」全指标相关性分析。
 *
 * 运行（项目根目录）：
 *   bun src/correlate_report.ts
 *   bun src/correlate_report.ts --json-only   # 只写 JSON
 *
 * 产物：
 *   analysis/zh-CN/numbers/A3-生成长度相关性-numbers.json   全部复算数字（机器可读）
 *   stdout                                                      人读摘要
 *
 * 设计原则：脚本里不写任何结论数字，报告里的每个数字都必须能从原始
 * data/store/runs/{pro,flash}/series.json + axis.json + status.json + tags.json
 * 与 data/store/{benchmarks,notices}.json 复算出来。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STORE = resolve(ROOT, "data/store");
const OUT_JSON = resolve(ROOT, "analysis/zh-CN/numbers/A3-生成长度相关性-numbers.json");

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------
const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));

type NumSeries = Record<string, (number | null)[]>;

interface RunData {
  run: string;
  series: NumSeries;
  steps: number[];
  walls: number[];
  runStart: number;
  updatedAt: number;
  status: any;
  versions: { version: string; at: number; n: number }[];
  tags: Record<string, unknown>;
  timeline: any[];
}

function loadRun(run: string): RunData {
  const base = resolve(STORE, "runs", run);
  const series: NumSeries = jread(resolve(base, "series.json"));
  const axis = jread(resolve(base, "axis.json"));
  const status = jread(resolve(base, "status.json"));
  const tagsFile = jread(resolve(base, "tags.json"));
  const timeline = readFileSync(resolve(base, "timeline.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    run,
    series,
    steps: axis.steps,
    walls: axis.walls,
    runStart: axis.run_start,
    updatedAt: axis.updated_at,
    status,
    versions: tagsFile.versions ?? [],
    tags: tagsFile.tags ?? {},
    timeline,
  };
}

const pro = loadRun("pro");
const flash = loadRun("flash");
const benchmarks: any[] = jread(resolve(STORE, "benchmarks.json"));
const notices: any[] = jread(resolve(STORE, "notices.json"));

// 指标解读（109 条中文条目 + 族）
const metricsDoc = jread(resolve(ROOT, "content/metrics.json"));
interface MetricDoc {
  id: string;
  name?: string;
  group?: string;
  unit?: string;
  what?: string;
  why?: string;
}
const metricItems: MetricDoc[] = metricsDoc.items ?? [];

/** 把 `dynsam/<cat>/dataset-<id>/num_accepted/step` 这类模板转成正则 */
function tmplToRegex(id: string): RegExp {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withWild = esc.replace(/<[a-z0-9]+>/g, "[^/]+");
  return new RegExp("^" + withWild + "$");
}
const docMatchers = metricItems.map((it) => ({ it, re: tmplToRegex(it.id) }));

/** 给任意指标名找一条最贴切的解读（精确 → 模板 → 族前缀） */
function describe(metric: string): { src: string; name?: string; group?: string; unit?: string; what?: string } {
  for (const { it, re } of docMatchers) if (it.id === metric) return { src: "exact", ...it };
  for (const { it, re } of docMatchers) if (re.test(metric)) return { src: "template", ...it };
  for (const it of metricItems) if (it.id.endsWith("/*") && metric.startsWith(it.id.slice(0, -1)))
    return { src: "family", ...it };
  return { src: "none" };
}

function familyOf(metric: string): string {
  const parts = metric.split("/");
  const top = parts[0];
  if (top === "critic" || top === "actor" || top === "penalty" || top === "partial") {
    return parts.slice(0, 2).join("/");
  }
  if (top === "ctx_response_length" || top === "ctx_total_length" || top === "ctx_prompt_length") {
    return parts.slice(0, 2).join("/");
  }
  if (top === "train") {
    if (parts[1] === "harness") return "train/harness";
    if (parts[1] === "verdicts") return "train/verdicts";
    if (parts[1] === "passrate") return "train/passrate";
    return "train/" + (parts[1] ?? "");
  }
  if (top === "dynsam") {
    if (parts[1] === "avg@n" || parts[1] === "avg@n_no_infra") return "dynsam/avg@n";
    return "dynsam/" + (parts[1] ?? "");
  }
  if (top === "train_infer_diff") return "train_infer_diff";
  return top;
}

// ---------------------------------------------------------------------------
// 统计工具（无第三方依赖）
// ---------------------------------------------------------------------------
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function pairs(x: (number | null)[], y: (number | null)[]): { x: number[]; y: number[]; idx: number[] } {
  const px: number[] = [], py: number[] = [], idx: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (isNum(x[i]) && isNum(y[i])) { px.push(x[i] as number); py.push(y[i] as number); idx.push(i); }
  }
  return { x: px, y: py, idx };
}

function mean(a: number[]): number {
  if (!a.length) return NaN;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function std(a: number[], ddof = 1): number {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - ddof));
}
function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((p, q) => p - q);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
/** 平均秩（处理并列） */
function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

function spearman(x: number[], y: number[]): number {
  if (x.length < 3) return NaN;
  return pearson(ranks(x), ranks(y));
}

// t 分布双尾 p 值：用正则化不完全贝塔（Numerical Recipes 风格）
function gammaln(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - bt * betacf(b, a, 1 - x) / b;
}
/** 相关系数的双尾 p 值（H0: rho=0）。点二列/积矩都按 t 检验近似。 */
function corrP(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 4) return NaN;
  const rr = Math.min(Math.abs(r), 0.999999);
  const df = n - 2;
  const t = rr * Math.sqrt(df / (1 - rr * rr));
  return betai(df / 2, 0.5, df / (df + t * t));
}
/** 相关系数的 95% 置信区间（Fisher z） */
function corrCI(r: number, n: number): [number, number] {
  if (!Number.isFinite(r) || n < 4) return [NaN, NaN];
  const rr = Math.min(Math.max(r, -0.999999), 0.999999);
  const z = 0.5 * Math.log((1 + rr) / (1 - rr));
  const se = 1 / Math.sqrt(n - 3);
  const lo = z - 1.96 * se, hi = z + 1.96 * se;
  const inv = (v: number) => (Math.exp(2 * v) - 1) / (Math.exp(2 * v) + 1);
  return [inv(lo), inv(hi)];
}
/** 一阶差分（保留 null 传播） */
function firstDiff(a: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < a.length; i++) out.push(isNum(a[i]) && isNum(a[i - 1]) ? (a[i] as number) - (a[i - 1] as number) : null);
  return out;
}
/** 线性回归斜率 + r + r²；x 为步号 */
function linreg(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const slope = sxx === 0 ? NaN : sxy / sxx;
  const r = pearson(x, y);
  return { slope, intercept: my - slope * mx, r, r2: r * r, n };
}

/** 指定「采样区间」[from, to]（含端点，按步号）做裁剪 */
function sliceSteps(s: (number | null)[], steps: number[], from: number, to: number): (number | null)[] {
  return s.filter((_, i) => steps[i] >= from && steps[i] <= to);
}
function stepsIn(steps: number[], from: number, to: number): number[] {
  return steps.filter((v) => v >= from && v <= to);
}

// 成对相关（含差分、置信区间、p）
interface CorrRes {
  n: number; pearson: number; spearman: number; pPearson: number; pSpearman: number;
  ciPearson: [number, number]; ciSpearman: [number, number];
  dPearson: number; dSpearman: number; dN: number;
  dPPearson: number; dPSpearman: number;
}
function fullCorr(x: (number | null)[], y: (number | null)[]): CorrRes {
  const p = pairs(x, y);
  const dx = firstDiff(x), dy = firstDiff(y);
  // 差分对齐：d[i] 对应 (i+1,i)，因此成对仍旧按位置对齐
  const dp = pairs(dx, dy);
  const r = pearson(p.x, p.y), rho = spearman(p.x, p.y);
  const dr = pearson(dp.x, dp.y), drho = spearman(dp.x, dp.y);
  return {
    n: p.x.length,
    pearson: r,
    pPearson: corrP(r, p.x.length),
    spearman: rho,
    pSpearman: corrP(rho, p.x.length),
    ciPearson: corrCI(r, p.x.length),
    ciSpearman: corrCI(rho, p.x.length),
    dPearson: dr, dSpearman: drho, dN: dp.x.length,
    dPPearson: corrP(dr, dp.x.length), dPSpearman: corrP(drho, dp.x.length),
  };
}

// 稳健 z：|Δ - median(Δ)| / (1.4826·MAD(Δ))
function robustJumpStats(a: (number | null)[]) {
  const d: number[] = [];
  for (let i = 1; i < a.length; i++) if (isNum(a[i]) && isNum(a[i - 1])) d.push((a[i] as number) - (a[i - 1] as number));
  if (d.length < 3) return null;
  const med = median(d);
  const mad = median(d.map((v) => Math.abs(v - med)));
  const scale = 1.4826 * mad;
  return { med, mad, scale, nDiff: d.length, nonzero: d.filter((v) => v !== 0).length };
}

// ---------------------------------------------------------------------------
// 形状诊断：平滑上升 vs 阶跃
// ---------------------------------------------------------------------------
interface ShapeDiag {
  n: number;
  r2Linear: number; slopePerStep: number;
  sseTotal: number; sseLinear: number;
  bestSplitIndex: number; bestSplitStep: number | null; // 切在 v[k-1] 与 v[k] 之间
  ssePiecewise: number; piecewiseExplained: number;
  meanBefore: number; meanAfter: number; meanRatio: number;
  maxAbsJump: number; maxJumpStep: number | null; medianAbsJump: number; jumpRatio: number;
}
function shapeDiagnostics(vals: (number | null)[], steps: number[]): ShapeDiag | null {
  const v: number[] = [], st: number[] = [];
  for (let i = 0; i < vals.length; i++) if (isNum(vals[i])) { v.push(vals[i] as number); st.push(steps[i]); }
  const n = v.length;
  if (n < 8) return null;
  const ixs = v.map((_, i) => i);
  const lr = linreg(ixs, v);
  const sseTotal = v.reduce((s, x) => s + (x - mean(v)) ** 2, 0);
  const sseLinear = v.reduce((s, x, i) => s + (x - (lr.intercept + lr.slope * i)) ** 2, 0);
  // 单分割点分段常数
  let bestK = -1, bestSse = Infinity, meanB = NaN, meanA = NaN;
  for (let k = 3; k <= n - 3; k++) {
    const a = v.slice(0, k), b = v.slice(k);
    const sse = a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) + b.reduce((s, x) => s + (x - mean(b)) ** 2, 0);
    if (sse < bestSse) { bestSse = sse; bestK = k; meanB = mean(a); meanA = mean(b); }
  }
  const d: { step: number; delta: number }[] = [];
  for (let i = 1; i < n; i++) d.push({ step: st[i], delta: v[i] - v[i - 1] });
  const absD = d.map((x) => Math.abs(x.delta));
  const maxAbs = Math.max(...absD);
  const maxIdx = absD.indexOf(maxAbs);
  const medAbs = median(absD);
  return {
    n,
    r2Linear: lr.r2, slopePerStep: lr.slope,
    sseTotal, sseLinear,
    bestSplitIndex: bestK, bestSplitStep: bestK >= 0 ? st[bestK] : null,
    ssePiecewise: bestSse, piecewiseExplained: 1 - bestSse / sseTotal,
    meanBefore: meanB, meanAfter: meanA, meanRatio: meanA / meanB,
    maxAbsJump: maxAbs, maxJumpStep: d[maxIdx]?.step ?? null, medianAbsJump: medAbs,
    jumpRatio: medAbs > 0 ? maxAbs / medAbs : Infinity,
  };
}

// 硬上限证据：序列里重复出现的极大值
function capEvidence(a: (number | null)[]) {
  const counts = new Map<number, number>();
  const nums: number[] = [];
  for (const v of a) if (isNum(v)) { const r = Math.round(v); counts.set(r, (counts.get(r) ?? 0) + 1); nums.push(v); }
  if (!nums.length) return null;
  const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const [topVal, topCount] = sorted[0];
  const twoPow20 = 1048576;
  return {
    n: nums.length,
    max: Math.max(...nums),
    topRepeatedValue: topVal, topRepeatedCount: topCount,
    topRepeatedShare: topCount / nums.length,
    secondDistinct: sorted.length,
    distFrom2p20: topVal - twoPow20,
    isNear2p20: Math.abs(topVal - twoPow20) < 1000,
  };
}

// ---------------------------------------------------------------------------
// 事件 / 版本 → 步号映射
// ---------------------------------------------------------------------------
function stepIndexAtWall(run: RunData, t: number): number | null {
  // 返回第一个 wall >= t 的步下标；若 t 在所有 wall 之后返回 null
  for (let i = 0; i < run.walls.length; i++) if (run.walls[i] >= t) return i;
  return null;
}

/**
 * 重启对齐「事件序列」而不是墙钟->步号。
 * 原因：axis.walls 是最终上报的墙钟，被 redo 覆盖过，用它找「重启后第一步」会错位。
 * status.events 是有序的（restart 与 step 交错），重启后的第一个 step 事件就是重启后首步。
 */
function restartsOf(run: RunData) {
  const evs = run.status.events ?? [];
  const out: any[] = [];
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].kind !== "restart") continue;
    let prevStep: number | null = null, nextStep: number | null = null, nextRedo: boolean | null = null;
    for (let j = i - 1; j >= 0; j--) if (evs[j].kind === "step") { prevStep = evs[j].step; break; }
    for (let j = i + 1; j < evs.length; j++) if (evs[j].kind === "step") { nextStep = evs[j].step; nextRedo = !!evs[j].redo; break; }
    out.push({
      t: evs[i].t,
      iso: new Date(evs[i].t * 1000).toISOString(),
      prevStep, nextStep, nextRedo,
    });
  }
  return out;
}

/** redo=true 的步：重启后被重新计算的步 */
function redoSteps(run: RunData) {
  return (run.status.events ?? []).filter((e: any) => e.kind === "step" && e.redo)
    .map((e: any) => ({ step: e.step, t: e.t, iso: new Date(e.t * 1000).toISOString() }));
}

/** 版本首次出现时正在处理的步（用 timeline.jsonl 的 version+step 字段） */
function versionsWithStep(run: RunData) {
  const seen = new Map<string, { step: number; captured: number; iso: string }>();
  for (const c of run.timeline) {
    if (c.version && !seen.has(c.version)) seen.set(c.version, { step: c.step, captured: c.captured, iso: new Date(c.captured * 1000).toISOString() });
  }
  return run.versions.map((v) => {
    const hit = seen.get(v.version);
    const i = stepIndexAtWall(run, v.at);
    return {
      ...v, iso: new Date(v.at * 1000).toISOString(),
      firstStepAtWall: i === null ? null : run.steps[i],
      stepAtVersionCapture: hit?.step ?? null,
      versionFirstSeenIso: hit?.iso ?? null,
    };
  });
}
function stepEvents(run: RunData) {
  return (run.status.events ?? []).filter((e: any) => e.kind === "step");
}

/** 受工程事件影响的步：重启后的首个上报步、redo 步，以及它们的前一步（差分进出都会受影响） */
function eventAffectedSteps(run: RunData): Set<number> {
  const s = new Set<number>();
  const evs = run.status.events ?? [];
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].kind === "restart") {
      for (let j = i + 1; j < evs.length; j++) if (evs[j].kind === "step") { s.add(evs[j].step); s.add(evs[j].step - 1); break; }
    }
  }
  for (const r of redoSteps(run)) { s.add(r.step); s.add(r.step - 1); }
  return s;
}

/** 某一步上的事件注记 */
function eventsAtStep(run: RunData, step: number) {
  const restarts = restartsOf(run).filter((r) => r.nextStep === step);
  const redos = redoSteps(run).filter((r) => r.step === step);
  const vers = versionsWithStep(run).filter((v) => v.stepAtVersionCapture === step || v.firstStepAtWall === step);
  return {
    restarts: restarts.map((r) => r.iso),
    redo: redos.length > 0,
    versions: vers.map((v) => v.version),
    affected: eventAffectedSteps(run).has(step),
  };
}

/** 一阶差分相关，可排除指定差分下标（差分 i 连接 steps[i] 与 steps[i+1]） */
function diffCorrExcluding(x: (number | null)[], y: (number | null)[], steps: number[], exclude: Set<number>) {
  const dx = firstDiff(x), dy = firstDiff(y);
  const xx: (number | null)[] = [], yy: (number | null)[] = [];
  for (let i = 0; i < dx.length; i++) {
    const s0 = steps[i], s1 = steps[i + 1];
    if (exclude.has(s0) || exclude.has(s1)) { xx.push(null); yy.push(null); continue; }
    xx.push(dx[i]); yy.push(dy[i]);
  }
  const p = pairs(xx, yy);
  const r = pearson(p.x, p.y), rho = spearman(p.x, p.y);
  return { n: p.x.length, pearson: r, spearman: rho, pSpearman: corrP(rho, p.x.length) };
}

// ---------------------------------------------------------------------------
// 段 1：生成长度增长的形状
// ---------------------------------------------------------------------------
function lengthShape(run: RunData) {
  const S = run.series;
  const steps = run.steps;
  const pick = (m: string) => S[m] ?? new Array(steps.length).fill(null);

  const catKeys = ["agentic", "code", "chat", "general", "visual", "cyber"];
  const catDatasets: Record<string, string[]> = {};
  for (const k of Object.keys(S)) {
    const m = k.match(/^ctx_response_length\/([^/]+)\/([^/]+)\/mean$/);
    if (!m) continue;
    (catDatasets[m[1]] ??= []).push(m[2]);
  }
  for (const c of Object.keys(catDatasets)) catDatasets[c].sort();

  // 按类别聚合：有 dataset 子层的取「该类别下各数据集 mean 的等权平均」；
  // agentic 只有一条 `ctx_response_length/agentic/mean`，直接用。
  const catMeanSteps: Record<string, (number | null)[]> = {};
  for (const c of catKeys) {
    const ds = catDatasets[c] ?? [];
    if (ds.length === 0) {
      catMeanSteps[c] = pick(`ctx_response_length/${c}/mean`);
      continue;
    }
    catMeanSteps[c] = steps.map((_, i) => {
      const vals = ds.map((d) => S[`ctx_response_length/${c}/${d}/mean`]?.[i]).filter(isNum) as number[];
      return vals.length ? mean(vals) : null;
    });
  }

  const overall = pick("ctx_response_length/mean");
  const overallMax = pick("ctx_response_length/max");
  const overallMin = pick("ctx_response_length/min");
  const total = pick("ctx_total_length/mean");
  const prompt = pick("ctx_prompt_length/mean");

  const stepTable = steps.map((st, i) => {
    const row: Record<string, number | null> = {
      step: st,
      wall_iso: new Date(run.walls[i] * 1000).toISOString(),
      "ctx_response_length/mean": overall[i],
      "ctx_response_length/max": overallMax[i],
      "ctx_response_length/min": overallMin[i],
      "ctx_total_length/mean": total[i],
      "ctx_prompt_length/mean": prompt[i],
      d_overall: i === 0 ? null : (isNum(overall[i]) && isNum(overall[i - 1]) ? (overall[i] as number) - (overall[i - 1] as number) : null),
      rel_overall: i === 0 ? null : (isNum(overall[i]) && isNum(overall[i - 1]) && (overall[i - 1] as number) !== 0
        ? ((overall[i] as number) - (overall[i - 1] as number)) / (overall[i - 1] as number) : null),
    };
    for (const c of catKeys) row[`cat:${c}`] = catMeanSteps[c][i];
    return row;
  });

  // 每个 code 数据集的逐步表
  const codeDatasets = catDatasets["code"] ?? [];
  const codeTable = codeDatasets.map((d) => {
    const s = pick(`ctx_response_length/code/${d}/mean`);
    return {
      dataset: d,
      values: s,
      first: s.find(isNum) ?? null,
      last: [...s].reverse().find(isNum) ?? null,
      mean: mean(s.filter(isNum) as number[]),
      max: Math.max(...(s.filter(isNum) as number[])),
      maxStep: steps[(s.findIndex((v) => v === Math.max(...(s.filter(isNum) as number[]))))],
      min: Math.min(...(s.filter(isNum) as number[])),
      slopePerStep: (() => {
        const p = pairs(steps, s); return linreg(p.x, p.y).slope;
      })(),
      rStep: (() => { const p = pairs(steps, s); return linreg(p.x, p.y).r; })(),
    };
  });

  // 阶跃检测：总体 mean 的单步相对变化排序
  const jumps = stepTable.filter((r) => isNum(r.rel_overall as number))
    .map((r) => ({ step: r.step as number, from: r["ctx_response_length/mean"] as number, rel: r.rel_overall as number }))
    .sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));

  // 首尾与分段均值
  const numOverall = overall.filter(isNum) as number[];
  const w = Math.min(5, steps.length);
  const head5 = overall.slice(0, w).filter(isNum) as number[];
  const tail5 = overall.slice(-w).filter(isNum) as number[];
  const summary = {
    n_steps: steps.length,
    first: overall.find(isNum) ?? null,
    last: [...overall].reverse().find(isNum) ?? null,
    lastStep: (() => { for (let i = overall.length - 1; i >= 0; i--) if (isNum(overall[i])) return steps[i]; return null; })(),
    first5Mean: mean(head5),
    last5Mean: mean(tail5),
    min: Math.min(...numOverall), minStep: steps[overall.findIndex((v) => v === Math.min(...numOverall))],
    max: Math.max(...numOverall), maxStep: steps[overall.findIndex((v) => v === Math.max(...numOverall))],
    slopePerStep: linreg(pairs(steps, overall).x, pairs(steps, overall).y).slope,
    rStep: linreg(pairs(steps, overall).x, pairs(steps, overall).y).r,
    n_nonnull: numOverall.length,
  };

  // 类别级形状诊断
  const catDiag: Record<string, ShapeDiag | null> = {};
  for (const c of catKeys) catDiag[c] = shapeDiagnostics(catMeanSteps[c], steps);
  const codeDiag = shapeDiagnostics(
    steps.map((_, i) => {
      const vals = (catDatasets["code"] ?? []).map((d) => S[`ctx_response_length/code/${d}/mean`]?.[i]).filter(isNum) as number[];
      return vals.length ? mean(vals) : null;
    }), steps);

  // 硬上限证据
  const caps = {
    "ctx_response_length/max": capEvidence(pick("ctx_response_length/max")),
    "ctx_total_length/max": capEvidence(pick("ctx_total_length/max")),
    "ctx_prompt_length/max": capEvidence(pick("ctx_prompt_length/max")),
  };

  // 恒等性核对：ctx_total_length/mean 是否 ≈ response + prompt
  const resid = steps.map((_, i) => {
    const t = total[i], r = overall[i], p = prompt[i];
    return isNum(t) && isNum(r) && isNum(p) ? (t as number) - ((r as number) + (p as number)) : null;
  });
  const residPct = resid.filter(isNum).map((v) => (v as number) / (mean(overall.filter(isNum) as number[])));
  const identityCheck = {
    maxAbsResid: Math.max(...resid.filter(isNum).map((v) => Math.abs(v as number))),
    maxRelResid: Math.max(...residPct.map(Math.abs)),
    n: resid.filter(isNum).length,
  };

  return {
    catKeys, catDatasets, stepTable, codeTable, jumps, summary,
    diagOverall: shapeDiagnostics(overall, steps),
    diagCode: codeDiag,
    diagTotal: shapeDiagnostics(total, steps),
    catDiag,
    caps,
    identityCheck,
  };
}

// ---------------------------------------------------------------------------
// 段 2：长度 vs 成绩
// ---------------------------------------------------------------------------
const PERF_TARGETS = [
  "dynsam/avg@n",
  "dynsam/avg@n_no_infra",
  "train/passrate/avg_passrate",
  "critic/score/mean",
  "critic/rewards/mean",
  "critic/returns/mean",
  "critic/advantages/mean",
];

function lengthVsPerf(run: RunData) {
  const S = run.series;
  const len = S["ctx_response_length/mean"];
  const lenTotal = S["ctx_total_length/mean"];
  const rows = PERF_TARGETS.filter((t) => S[t]).map((t) => ({
    metric: t,
    vs_response: fullCorr(len, S[t]),
    vs_total: fullCorr(lenTotal, S[t]),
    series: S[t],
  }));
  // 语言/任务类别层面的长度回归斜率（长度自身随步）
  return rows;
}

/** 离线基准（DeepSWE 等）与长度的关系：基准按步号对齐训练长度（注意基准落后训练数步） */
function benchVsLength(run: RunData) {
  const out: any[] = [];
  for (const b of benchmarks) {
    const res = b.results?.[run.run];
    if (!res) continue;
    const benchSteps = Object.keys(res).map(Number).sort((a, b2) => a - b2);
    const benchVals = benchSteps.map((s) => res[String(s)]);
    const lenAligned: (number | null)[] = benchSteps.map((s) => {
      const i = run.steps.indexOf(s);
      return i >= 0 ? run.series["ctx_response_length/mean"]?.[i] ?? null : null;
    });
    const totalAligned: (number | null)[] = benchSteps.map((s) => {
      const i = run.steps.indexOf(s);
      return i >= 0 ? run.series["ctx_total_length/mean"]?.[i] ?? null : null;
    });
    const c = fullCorr(lenAligned, benchVals);
    const c2 = fullCorr(totalAligned, benchVals);
    // 单步跌幅排行
    const drops = benchSteps.slice(1).map((s, i) => {
      const prev = res[String(benchSteps[i])];
      return { step: s, value: res[String(s)], delta: res[String(s)] - prev };
    }).sort((a, b2) => a.delta - b2.delta);
    // 相邻步变化本身的波动（用来判断「大幅下降」是不是噪声）
    const dAll = benchSteps.slice(1).map((s, i) => res[String(s)] - res[String(benchSteps[i])]);
    const dStd = std(dAll), dMean = mean(dAll), dMad = (() => {
      const m = median(dAll); return median(dAll.map((v) => Math.abs(v - m)));
    })();
    const deltaStats = {
      n: dAll.length, mean: dMean, std: dStd, mad: dMad,
      robustSigma: 1.4826 * dMad,
      maxAbs: Math.max(...dAll.map(Math.abs)),
      worstZ: Math.min(...dAll.map((v) => (v - dMean) / (dStd || 1e-9))),
    };
    // 滞后对齐：basis 用「s-L 步的训练长度」去解释「标称第 s 步的基准分」
    const lagged = [] as any[];
    for (let L = 0; L <= 4; L++) {
      const la: (number | null)[] = benchSteps.map((s) => {
        const i = run.steps.indexOf(s - L);
        return i >= 0 ? run.series["ctx_response_length/mean"]?.[i] ?? null : null;
      });
      const cc = fullCorr(la, benchVals);
      lagged.push({ lag: L, n: cc.n, spearman: cc.spearman, pearson: cc.pearson, dSpearman: cc.dSpearman });
    }
    out.push({
      key: b.key, title: b.title, note: b.note,
      n: benchSteps.length, steps: benchSteps, values: benchVals,
      vs_response: c, vs_total: c2,
      lagged, deltaStats,
      worstDrops: drops.slice(0, 5),
      bestGains: drops.slice().reverse().slice(0, 3),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 段 2b：跨 run 合并（相对一阶差分，n≈52）
// ---------------------------------------------------------------------------
/** 相对一阶差分：Δx / mean(x)；用于跨 run 合并时消除量纲 */
function relDiff(a: (number | null)[]): (number | null)[] {
  const base = mean(a.filter(isNum) as number[]);
  const out: (number | null)[] = [];
  for (let i = 1; i < a.length; i++) {
    out.push(isNum(a[i]) && isNum(a[i - 1]) && base !== 0 ? ((a[i] as number) - (a[i - 1] as number)) / base : null);
  }
  return out;
}
function pooledDiff(maxPerf: string[]) {
  const rows: any[] = [];
  const refPro = relDiff(pro.series["ctx_response_length/mean"]);
  const refFlash = relDiff(flash.series["ctx_response_length/mean"]);
  for (const m of maxPerf) {
    if (!pro.series[m] || !flash.series[m]) continue;
    const aP = relDiff(pro.series[m]), aF = relDiff(flash.series[m]);
    const x = [...refPro, ...refFlash];
    const y = [...aP, ...aF];
    const p = pairs(x, y);
    const r = pearson(p.x, p.y), rho = spearman(p.x, p.y);
    rows.push({
      metric: m, n: p.x.length,
      pearson: r, spearman: rho, pPearson: corrP(r, p.x.length), pSpearman: corrP(rho, p.x.length),
      // 分 run
      pro: (() => { const q = pairs(refPro, aP); const rr = spearman(q.x, q.y); return { n: q.x.length, spearman: rr, p: corrP(rr, q.x.length) }; })(),
      flash: (() => { const q = pairs(refFlash, aF); const rr = spearman(q.x, q.y); return { n: q.x.length, spearman: rr, p: corrP(rr, q.x.length) }; })(),
    });
  }
  rows.sort((a, b) => Math.abs(b.spearman) - Math.abs(a.spearman));
  return rows;
}

// ---------------------------------------------------------------------------
// 段 3：长度增长的代价
// ---------------------------------------------------------------------------
const COST_TARGETS = [
  "timing_s/step",
  "timing_s/outer_gen",
  "timing_s/trainer_ops",
  "ctx_total_length/clip_ratio",
  "train/verdicts/dropped_empty_response",
  "train/verdicts/expired",
  "train/verdicts/dropped_zero_adv",
  "train/verdicts/carried",
  "train/verdicts/rejected",
  "train/verdicts/trained",
  "dynsam/num_measurable",
  "dynsam/agg_turn/mean",
  "partial/avg_staleness",
  "perf/total_num_tokens",
  "training/global_step",
  "training/actor_optimizer_steps",
  "dynsam/agentic/num_accepted/step",
];

// 机制/健康度指标（不直接是代价，但能解释长度为什么变、变了以后哪里动）
const MECH_TARGETS = [
  "actor/entropy_loss",
  "actor/agentic/entropy_loss",
  "actor/code/dataset-m1dt/entropy_loss",
  "actor/grad_norm",
  "actor/pg_loss",
  "actor/pg_tis_clipfrac",
  "train/spec_accept_length/token_mean",
  "train/spec_accept_length/request_mean",
  "dynsam/infra_error/seq_rate",
  "env/total_error",
  "train/trace/late_finishes",
  "dynsam/passrate/one",
  "dynsam/passrate/zero",
  "train/passrate/passrate_0_ratio",
  "train/passrate/passrate_1_ratio",
  "partial/0/frac",
  "partial/avg_staleness",
  "penalty/stage_credit_group/select_hack_attempt_rate",
  "critic/score/mean",
];

function costOfLength(run: RunData) {
  const S = run.series;
  const steps = run.steps;
  const len = S["ctx_response_length/mean"];
  const lenTotal = S["ctx_total_length/mean"];
  const rows = COST_TARGETS.filter((t) => S[t]).map((t) => ({
    metric: t,
    desc: describe(t),
    vs_response: fullCorr(len, S[t]),
    vs_total: fullCorr(lenTotal, S[t]),
    series: S[t],
  }));
  // clip_ratio 按类别
  const clipCats = Object.keys(S).filter((k) => /^ctx_total_length\/.+\/clip_ratio$/.test(k)).sort();
  const clip = clipCats.map((k) => ({
    metric: k,
    first: S[k].find(isNum) ?? null,
    last: [...S[k]].reverse().find(isNum) ?? null,
    max: Math.max(...(S[k].filter(isNum) as number[])),
    mean: mean(S[k].filter(isNum) as number[]),
    vs_total: fullCorr(S[k], lenTotal),
  }));
  // 总 clip_ratio 与长度的一阶差分关系
  const clipTotal = S["ctx_total_length/clip_ratio"];

  // 归一化代价：把耗时除以本步 token 数，看单位 token 成本有没有变
  const tokens = S["perf/total_num_tokens"];
  const normSpec: [string, string][] = [
    ["timing_s/trainer_ops", "perf/total_num_tokens"],
    ["timing_s/outer_gen", "perf/total_num_tokens"],
    ["timing_s/step", "perf/total_num_tokens"],
  ];
  const normalized = normSpec.filter(([a, b]) => S[a] && S[b]).map(([a, b]) => {
    const v: (number | null)[] = steps.map((_, i) => {
      const x = S[a][i], y = S[b][i];
      return isNum(x) && isNum(y) && (y as number) !== 0 ? ((x as number) / (y as number)) * 1e9 : null;
    });
    const p = pairs(steps, v);
    const lr = linreg(p.x, p.y);
    const nums = v.filter(isNum) as number[];
    return {
      metric: `${a} / (${b}/1e9)`,
      unit: "秒 / 十亿 token",
      series: v,
      first: nums[0], last: nums[nums.length - 1],
      ratio: nums[nums.length - 1] / nums[0],
      slopePerStep: lr.slope, rStep: lr.r, r2: lr.r2,
      vsLen: fullCorr(len, v),
    };
  });
  // token 数 / 生成长度：验证「每步 token 数 ≈ 固定轨迹数 × 长度」
  const tokensPerLen: (number | null)[] = steps.map((_, i) => {
    const t = tokens?.[i], l = len[i];
    return isNum(t) && isNum(l) && (l as number) !== 0 ? (t as number) / (l as number) : null;
  });
  const tp = pairs(steps, tokensPerLen);
  const tokensPerLenStats = {
    series: tokensPerLen,
    mean: mean(tokensPerLen.filter(isNum) as number[]),
    std: std(tokensPerLen.filter(isNum) as number[]),
    cv: std(tokensPerLen.filter(isNum) as number[]) / mean(tokensPerLen.filter(isNum) as number[]),
    slopePerStep: linreg(tp.x, tp.y).slope, r: linreg(tp.x, tp.y).r,
    vsLen: fullCorr(len, tokensPerLen),
  };

  // 机制族
  const mech = MECH_TARGETS.filter((t) => S[t]).map((t) => ({
    metric: t,
    desc: describe(t),
    series: S[t],
    vs_response: fullCorr(len, S[t]),
    vs_total: fullCorr(lenTotal, S[t]),
    first: S[t].find(isNum) ?? null,
    last: [...S[t]].reverse().find(isNum) ?? null,
  }));

  const costMeta = {
    rate_per_s: run.status?.cost?.rate_per_s ?? null,
    cost_so_far: run.status?.cost?.so_far ?? null,
    totals: run.status?.totals ?? null,
    step: run.status?.step ?? null,
  };

  return {
    rows, clip, normalized, tokensPerLenStats, mech, costMeta,
    clipTotalVsLength: fullCorr(clipTotal, lenTotal),
    clipTotalVsResponse: fullCorr(clipTotal, len),
  };
}

// ---------------------------------------------------------------------------
// 段 4：全指标 Spearman 排行
// ---------------------------------------------------------------------------
/** 明显同义/机械派生：与长度定义上同源或由长度机械决定的量。返回理由，null 表示不是。 */
function derivedReason(metric: string): string | null {
  if (/^ctx_response_length\//.test(metric)) return "同义：同一生成长度的另一个层级";
  if (/^ctx_total_length\//.test(metric)) return "派生：总长度 = 生成长度 + 提示长度";
  if (metric === "perf/total_num_tokens") return "机械派生：本步 token 数 ≈ batch 大小 × 长度";
  if (metric === "training/global_step") return "趋势项：纯步号，与任何单调序列都会高相关";
  if (/^train\/adv_(pos|neg)_sum/.test(metric)) return "机械派生：按 token 求和的正/负优势总量 ≈ 常数 × 本步 token 数（见 mechanicalChecks）";
  if (/\/n_tokens$/.test(metric)) return "机械派生：token 计数";
  if (/^train\/harness\/.*\/training\/rollouts$/.test(metric)) return "机械派生：rollout 计数";
  return null;
}
function isDerivedOrSynonym(metric: string): boolean {
  return derivedReason(metric) !== null;
}

/** top-N 相关里的族分布 */
function familyTally(rows: any[], n: number) {
  const t: Record<string, number> = {};
  for (const r of rows.slice(0, n)) t[r.family] = (t[r.family] ?? 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}

function topCorrelations(run: RunData, target: string, topN = 30) {
  const S = run.series;
  const tgt = S[target];
  if (!tgt) return [];
  const rows: any[] = [];
  for (const k of Object.keys(S)) {
    if (k === target) continue;
    const p = pairs(tgt, S[k]);
    if (p.x.length < 8) continue;
    if (std(p.y) === 0 || !Number.isFinite(std(p.y))) continue;
    const r = pearson(p.x, p.y);
    const rho = spearman(p.x, p.y);
    if (!Number.isFinite(rho)) continue;
    const dp = pairs(firstDiff(tgt), firstDiff(S[k]));
    const drho = dp.x.length >= 8 ? spearman(dp.x, dp.y) : NaN;
    rows.push({
      metric: k,
      family: familyOf(k),
      desc: describe(k),
      n: p.x.length,
      pearson: r, spearman: rho,
      pSpearman: corrP(rho, p.x.length),
      ciSpearman: corrCI(rho, p.x.length),
      dSpearman: drho, dN: dp.x.length, dPSpearman: corrP(drho, dp.x.length),
      derived: derivedReason(k) !== null,
      derivedReason: derivedReason(k),
    });
  }
  rows.sort((a, b) => Math.abs(b.spearman) - Math.abs(a.spearman));
  return rows.slice(0, topN);
}

// Spearman 的显著性门槛（n 点、双尾 0.05 的临界 |rho|，用 t 检验反解）
function spearmanCritical(n: number, alpha = 0.05): number {
  // 二分搜索 |rho| 使 p == alpha
  let lo = 0, hi = 0.999999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (corrP(mid, n) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// 段 5：奇异点定位
// ---------------------------------------------------------------------------
interface JumpRow {
  metric: string; family: string; step: number; prev: number; cur: number;
  delta: number; rel: number; rz: number; desc: any;
}

function detectJumps(run: RunData, opts: { relMin: number; rzMin: number }) {
  const S = run.series;
  const steps = run.steps;
  const rows: JumpRow[] = [];
  for (const k of Object.keys(S)) {
    const a = S[k];
    const st = robustJumpStats(a);
    if (!st || st.nonzero < 3) continue;
    // 过滤稀疏计数序列：差分大半是 0、稳健尺度为 0、或取值过少
    if (st.nonzero < 0.6 * st.nDiff) continue;
    if (!(st.scale > 0)) continue;
    const distinct = new Set(a.filter(isNum).map((v) => Math.round((v as number) * 1e6) / 1e6)).size;
    if (distinct < 5) continue;
    for (let i = 1; i < a.length; i++) {
      if (!isNum(a[i]) || !isNum(a[i - 1])) continue;
      const cur = a[i] as number, prev = a[i - 1] as number;
      const delta = cur - prev;
      if (delta === 0) continue;
      const denom = Math.max(Math.abs(prev), Math.abs(cur), 1e-12);
      const rel = Math.abs(delta) / denom;
      const rz = Math.min(Math.abs(delta - st.med) / st.scale, 9999);
      if (rel >= opts.relMin && rz >= opts.rzMin) {
        rows.push({ metric: k, family: familyOf(k), step: steps[i], prev, cur, delta, rel, rz, desc: describe(k) });
      }
    }
  }
  rows.sort((a, b) => b.rz - a.rz);
  return rows;
}

/** 每步的「跳变指标数」画像 */
function stepAnomalyProfile(run: RunData, opts: { relMin: number; rzMin: number }) {
  const jumps = detectJumps(run, opts);
  const byStep: Record<number, { n: number; families: Record<string, number>; top: JumpRow[] }> = {};
  for (const j of jumps) {
    (byStep[j.step] ??= { n: 0, families: {}, top: [] });
    byStep[j.step].n++;
    byStep[j.step].families[j.family] = (byStep[j.step].families[j.family] ?? 0) + 1;
    byStep[j.step].top.push(j);
  }
  const profile = run.steps.map((s) => {
    const b = byStep[s];
    return {
      step: s,
      n_jumps: b?.n ?? 0,
      top_families: b ? Object.entries(b.families).sort((a, c) => c[1] - a[1]).slice(0, 6) : [],
      top3: (b?.top ?? []).slice(0, 3).map((x) => ({ metric: x.metric, rz: Math.round(x.rz * 10) / 10, rel: x.rel })),
    };
  });
  return { profile, all: jumps };
}

/** 某一步「同步一起跳」的指标 */
function jumpsAtStep(run: RunData, step: number, opts: { relMin: number; rzMin: number }, limit = 40) {
  return detectJumps(run, opts).filter((j) => j.step === step)
    .sort((a, b) => b.rz - a.rz).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 段 7：数据质量（可疑的 0 值 —— 很可能是「未上报」而不是真值）
// ---------------------------------------------------------------------------
function dataQuality(run: RunData) {
  const S = run.series;
  const out: any[] = [];
  // 只查「比例/分数类」指标：这类量的 0 才有「未上报」的解释空间；
  // 计数类（groups_failed_pod 等）本身就是 0/1 稀疏，不在此列。
  const isRatioLike = (k: string) => /passrate|avg@n|_rate$|\/frac$|score\/mean|rewards\/mean|\/one$|\/zero$/.test(k);
  for (const k of Object.keys(S)) {
    if (!isRatioLike(k)) continue;
    const nums = S[k].filter(isNum) as number[];
    if (nums.length < 8) continue;
    const zeros = nums.filter((v) => v === 0).length;
    if (zeros < 3 || zeros / nums.length < 0.15) continue;
    const nonZero = nums.filter((v) => v !== 0);
    if (nonZero.length < 4) continue;
    const med = median(nums);
    if (med <= 0.05 || med >= 0.95) continue;
    const minNZ = Math.min(...nonZero.map(Math.abs));
    if (minNZ > 0.05 * med) {
      out.push({ metric: k, n: nums.length, zeros, zeroShare: zeros / nums.length, median: med, minNonZero: minNZ });
    }
  }
  out.sort((a, b) => b.zeroShare - a.zeroShare);
  return out;
}

// ---------------------------------------------------------------------------
// 段 8：机械恒等式核对（证明某些高相关只是单位换算）
// ---------------------------------------------------------------------------
function mechanicalChecks(run: RunData) {
  const S = run.series, steps = run.steps;
  const combos: [string, string, string][] = [
    ["perf/total_num_tokens", "ctx_response_length/mean", "每步 token 数 ÷ 平均生成长度"],
    ["train/adv_pos_sum_pre_penalty", "perf/total_num_tokens", "正优势总量 ÷ 每步 token 数"],
    ["train/adv_neg_sum_pre_penalty", "perf/total_num_tokens", "负优势总量 ÷ 每步 token 数"],
  ];
  const out: any[] = [];
  for (const [num, den, label] of combos) {
    if (!S[num] || !S[den]) continue;
    const v: (number | null)[] = steps.map((_, i) => {
      const a = S[num][i], b = S[den][i];
      return isNum(a) && isNum(b) && (b as number) !== 0 ? (a as number) / (b as number) : null;
    });
    const nums = v.filter(isNum) as number[];
    const m = mean(nums), sd = std(nums);
    const p = pairs(steps, v);
    const lr = linreg(p.x, p.y);
    out.push({
      label, numerator: num, denominator: den,
      mean: m, std: sd, cv: sd / Math.abs(m),
      min: Math.min(...nums), max: Math.max(...nums),
      slopePerStep: lr.slope, rStep: lr.r,
      corrNumDen: fullCorr(S[num], S[den]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 段 8：重启前后对照（重启后首步的生成长度变化 vs 其它步）
// ---------------------------------------------------------------------------
function restartContrast(run: RunData) {
  const len = run.series["ctx_response_length/mean"];
  const steps = run.steps;
  const rel = (i: number) => (i > 0 && isNum(len[i]) && isNum(len[i - 1]) && (len[i - 1] as number) !== 0
    ? ((len[i] as number) - (len[i - 1] as number)) / (len[i - 1] as number) : null);
  const affected = eventAffectedSteps(run);
  const rows = steps.map((s, i) => {
    const isFirstAfterRestart = restartsOf(run).some((r) => r.nextStep === s);
    const isRedo = redoSteps(run).some((r) => r.step === s);
    return { step: s, rel: rel(i), isFirstAfterRestart, isRedo, affected: affected.has(s) };
  });
  const restartVals = rows.filter((r) => r.isFirstAfterRestart && r.rel !== null).map((r) => r.rel as number);
  const redoVals = rows.filter((r) => r.isRedo && !r.isFirstAfterRestart && r.rel !== null).map((r) => r.rel as number);
  const otherVals = rows.filter((r) => !r.affected && r.rel !== null).map((r) => r.rel as number);
  const stats = (a: number[]) => a.length ? { n: a.length, mean: mean(a), median: median(a), negShare: a.filter((v) => v < 0).length / a.length, min: Math.min(...a), max: Math.max(...a) } : null;
  return { rows, restart: stats(restartVals), redo: stats(redoVals), other: stats(otherVals) };
}

// ---------------------------------------------------------------------------
// 段 6：反向证据（长度涨但分数没涨 / 数据集层面分裂）
// ---------------------------------------------------------------------------
function reversalEvidence(run: RunData) {
  const S = run.series;
  const steps = run.steps;
  const rows: any[] = [];
  for (const k of Object.keys(S)) {
    const m = k.match(/^ctx_response_length\/([^/]+)\/([^/]+)\/mean$/);
    if (!m) continue;
    const [, cat, ds] = m;
    const pr = S[`train/passrate/avg_passrate/${cat}/${ds}`] ?? S[`dynsam/${cat}/${ds}/passrate`];
    if (!pr) continue;
    const len = S[k];
    const c = fullCorr(len, pr);
    const p = pairs(steps, len);
    const lr = linreg(p.x, p.y);
    const prP = pairs(steps, pr);
    const prr = linreg(prP.x, prP.y);
    rows.push({
      cat, ds, metric_len: k, metric_pass: `train/passrate/avg_passrate/${cat}/${ds}`,
      n: c.n,
      spearman_level: c.spearman,
      spearman_diff: c.dSpearman,
      lenSlopePerStep: lr.slope, lenR: lr.r,
      passSlopePerStep: prr.slope, passR: prr.r,
      lenFirst: len.find(isNum) ?? null,
      lenLast: [...len].reverse().find(isNum) ?? null,
      passFirst: pr.find(isNum) ?? null,
      passLast: [...pr].reverse().find(isNum) ?? null,
      // 方向分裂：长度显著上行而通过率显著下行
      divergent: lr.r > 0.3 && prr.r < -0.2,
    });
  }
  rows.sort((a, b) => a.spearman_level - b.spearman_level);
  return rows;
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
function buildRun(run: RunData) {
  const shape = lengthShape(run);
  const perf = lengthVsPerf(run);
  const bench = benchVsLength(run);
  const cost = costOfLength(run);
  const jumpOpts = { relMin: 0.15, rzMin: 5 };
  const topResp = topCorrelations(run, "ctx_response_length/mean", 150);
  const topTotal = topCorrelations(run, "ctx_total_length/mean", 150);
  const anomaly = stepAnomalyProfile(run, jumpOpts);
  const reversal = reversalEvidence(run);
  // 焦点步：跳变数最多的 5 步 + 约定关注步（11/15 附近）
  const byCount = [...anomaly.profile].sort((a, b) => b.n_jumps - a.n_jumps).slice(0, 6).map((p) => p.step);
  const focus = Array.from(new Set([...byCount, 11, 15, 16])).sort((a, b) => a - b)
    .map((s) => ({ step: s, jumps: jumpsAtStep(run, s, jumpOpts, 40), events: eventsAtStep(run, s) }));

  // 每步画像加事件注记
  const profileWithEvents = anomaly.profile.map((p: any) => ({ ...p, events: eventsAtStep(run, p.step) }));

  // 剔除工程事件相邻步之后的一阶差分相关（关键指标）
  const affected = eventAffectedSteps(run);
  const robustKey = ["dynsam/avg@n", "train/passrate/avg_passrate", "critic/score/mean", "partial/avg_staleness", "timing_s/trainer_ops", "ctx_total_length/clip_ratio"]
    .filter((m) => run.series[m]).map((m) => ({
      metric: m,
      all: fullCorr(run.series["ctx_response_length/mean"], run.series[m]),
      exclEvents: diffCorrExcluding(run.series["ctx_response_length/mean"], run.series[m], run.steps, affected),
    }));

  // 基准大跌步 × 同步跳变 × 事件
  const benchJumpAlignment = bench.map((b: any) => ({
    key: b.key, title: b.title,
    worst: b.worstDrops.slice(0, 4).map((d: any) => {
      const j = anomaly.all.filter((x: any) => x.step === d.step);
      const lenIdx = run.steps.indexOf(d.step);
      const lenPrev = lenIdx > 0 ? run.series["ctx_response_length/mean"][lenIdx - 1] : null;
      const lenCur = lenIdx >= 0 ? run.series["ctx_response_length/mean"][lenIdx] : null;
      return {
        step: d.step, value: d.value, delta: d.delta,
        lengthDeltaPct: isNum(lenPrev) && isNum(lenCur) && (lenPrev as number) !== 0 ? ((lenCur as number) - (lenPrev as number)) / (lenPrev as number) : null,
        nJumps: j.length,
        topJumpFamilies: [...j.reduce((m: Map<string, number>, x: any) => m.set(x.family, (m.get(x.family) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, c) => c[1] - a[1]).slice(0, 5),
        topJumps: j.slice(0, 5).map((x: any) => x.metric),
        events: eventsAtStep(run, d.step),
      };
    }),
  }));

  return {
    run: run.run,
    n_metrics: Object.keys(run.series).length,
    n_steps: run.steps.length,
    data_updated_at: run.updatedAt,
    data_updated_iso: new Date(run.updatedAt * 1000).toISOString(),
    shape, perf, bench, cost,
    topResp, topTotal, anomaly: { ...anomaly, profile: profileWithEvents }, reversal,
    topRespInformative: topResp.filter((r: any) => !r.derived).slice(0, 30),
    topTotalInformative: topTotal.filter((r: any) => !r.derived).slice(0, 30),
    familyTallyResp: familyTally(topResp, 100),
    familyTallyTotal: familyTally(topTotal, 100),
    focus,
    robustKey,
    benchJumpAlignment,
    dataQuality: dataQuality(run),
    mechanicalChecks: mechanicalChecks(run),
    restartContrast: restartContrast(run),
    eventAffectedSteps: [...affected].sort((a, b) => a - b),
    restarts: restartsOf(run),
    redoSteps: redoSteps(run),
    versions: versionsWithStep(run),
    stepEvents: stepEvents(run),
    jumpOpts,
  };
}

const report: any = {
  generated_at: new Date().toISOString(),
  script: "src/correlate_report.ts",
  root: ROOT,
  source_files: {
    pro: "data/store/runs/pro/{series,axis,status,tags}.json",
    flash: "data/store/runs/flash/{series,axis,status,tags}.json",
    benchmarks: "data/store/benchmarks.json",
    notices: "data/store/notices.json",
    metrics_doc: "content/metrics.json",
  },
  notices,
  crit05: {} as Record<string, number>,
  pooled: {} as any,
  pro: buildRun(pro),
  flash: buildRun(flash),
};
report.crit05.pro = spearmanCritical(pro.steps.length);
report.crit05.flash = spearmanCritical(flash.steps.length);
report.pooledCrit05 = spearmanCritical(pro.steps.length - 1 + flash.steps.length - 1);
report.pooled = {
  note: "跨 run 合并：对每条序列取相对一阶差分 (x_t - x_{t-1}) / mean(x)，pro 与 flash 的差分拼在一起算相关（n≈52）。这样同时消掉量纲和共同趋势。",
  perf: pooledDiff(PERF_TARGETS),
  cost: pooledDiff(COST_TARGETS),
  mech: pooledDiff(MECH_TARGETS),
};

mkdirSync(dirname(OUT_JSON), { recursive: true });
// 瘦身：JSON 里去掉原始序列数组与冗长的中文解读正文（stdout 不受影响）
const jsonText = JSON.stringify(report, (k, v) => {
  if (k === "series") return undefined;
  if (k === "desc" && v && typeof v === "object") return { name: v.name, group: v.group, unit: v.unit, src: v.src };
  return v;
}, 1);
writeFileSync(OUT_JSON, jsonText, "utf8");

// ---------------------------------------------------------------------------
// stdout 摘要
// ---------------------------------------------------------------------------
const fmt = (v: any, d = 3) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v));
const pct = (v: any, d = 1) => (typeof v === "number" && Number.isFinite(v) ? (v * 100).toFixed(d) + "%" : String(v));
const line = (s = "") => console.log(s);

const onlyJson = process.argv.includes("--json-only");
if (!onlyJson) {
  for (const R of [report.pro, report.flash]) {
    line("=".repeat(100));
    line(`# ${R.run.toUpperCase()}  metrics=${R.n_metrics} steps=${R.n_steps} dataUpdated=${R.data_updated_iso}`);
    line(`# Spearman two-tailed 0.05 critical |rho| (n=${R.n_steps}) = ${fmt(report.crit05[R.run], 3)}`);
    line("=".repeat(100));

    line("\n## 1. Response length growth shape");
    const s = R.shape.summary;
    line(`overall ctx_response_length/mean: first step ${s.first} → last(step ${s.lastStep}) ${s.last}`);
    line(`  ratio last/first = ${fmt(s.last / s.first, 3)}x ; first5mean=${fmt(s.first5Mean, 0)} last5mean=${fmt(s.last5Mean, 0)} (+${pct(s.last5Mean / s.first5Mean - 1)})`);
    line(`  min=${fmt(s.min, 0)}(step ${s.minStep}) max=${fmt(s.max, 0)}(step ${s.maxStep}) ; slope=${fmt(s.slopePerStep, 1)}/step r=${fmt(s.rStep)} n=${s.n_nonnull}`);
    line("\n step | resp_mean | resp_max | ctx_total | prompt  | d(resp) | rel%");
    for (const r of R.shape.stepTable) {
      line([
        String(r.step).padStart(4),
        fmt(r["ctx_response_length/mean"], 0).padStart(9),
        fmt(r["ctx_response_length/max"], 0).padStart(8),
        fmt(r["ctx_total_length/mean"], 0).padStart(9),
        fmt(r["ctx_prompt_length/mean"], 0).padStart(7),
        fmt(r.d_overall, 0).padStart(8),
        (r.rel_overall === null ? "-" : pct(r.rel_overall)).padStart(7),
      ].join(" | "));
    }
    line("\n Categories (equal-weight mean of per-dataset means):");
    line(" step | " + R.shape.catKeys.map((c) => c.padStart(9)).join(" | "));
    for (const r of R.shape.stepTable) {
      line(String(r.step).padStart(4) + " | " + R.shape.catKeys.map((c) => fmt(r["cat:" + c], 0).padStart(9)).join(" | "));
    }
    line("\n code datasets by step (mean):");
    for (const c of R.shape.codeTable) {
      line(`  code/${c.dataset}: first=${fmt(c.first, 0)} last=${fmt(c.last, 0)} ratio=${fmt((c.last as number) / (c.first as number), 2)}x mean=${fmt(c.mean, 0)} max=${fmt(c.max, 0)}@step${c.maxStep} slope=${fmt(c.slopePerStep, 1)}/step r=${fmt(c.rStep)}`);
      line("     " + c.values.map((v, i) => `${R.shape.stepTable[i].step}:${fmt(v, 0)}`).join(" "));
    }
    line("\n Overall mean single-step relative change ranking (|rel| desc):");
    for (const j of R.shape.jumps.slice(0, 8)) line(`  step ${j.step}: ${fmt(j.from, 0)} rel=${pct(j.rel)}`);

    const sd = R.shape.diagOverall, cd = R.shape.diagCode;
    line("\n Shape diagnostics (smooth vs step):");
    line(`   overall: r2_linear=${fmt(sd.r2Linear)} slope=${fmt(sd.slopePerStep, 0)}/step | best split step=${sd.bestSplitStep} segment means ${fmt(sd.meanBefore, 0)}→${fmt(sd.meanAfter, 0)} (×${fmt(sd.meanRatio, 2)}) piecewise-constant explained variance=${pct(sd.piecewiseExplained)} | max single-step jump ${fmt(sd.maxAbsJump, 0)}@step${sd.maxJumpStep} median single-step jump ${fmt(sd.medianAbsJump, 0)} ratio=${fmt(sd.jumpRatio, 1)}`);
    line(`   code: r2_linear=${fmt(cd.r2Linear)} slope=${fmt(cd.slopePerStep, 0)}/step | best split step=${cd.bestSplitStep} segment means ${fmt(cd.meanBefore, 0)}→${fmt(cd.meanAfter, 0)} (×${fmt(cd.meanRatio, 2)}) piecewise-constant explained variance=${pct(cd.piecewiseExplained)} | max single-step jump ${fmt(cd.maxAbsJump, 0)}@step${cd.maxJumpStep} ratio=${fmt(cd.jumpRatio, 1)}`);
    for (const c of R.shape.catKeys) {
      const d = R.shape.catDiag[c];
      if (!d) continue;
      line(`   ${c.padEnd(8)}: slope=${fmt(d.slopePerStep, 0)}/step r2=${fmt(d.r2Linear)} splitStep=${d.bestSplitStep} ×${fmt(d.meanRatio, 2)} piecewise explained=${pct(d.piecewiseExplained)} first=${fmt(R.shape.stepTable[0]["cat:" + c], 0)} last=${fmt(R.shape.stepTable[R.shape.stepTable.length - 1]["cat:" + c], 0)}`);
    }
    line("\n Hard-cap evidence (repeated maxima of ctx_*_length/max):");
    for (const [k, v] of Object.entries(R.shape.caps)) {
      if (!v) continue;
      line(`   ${k}: max=${(v as any).max} most common value=${(v as any).topRepeatedValue} appears in ${(v as any).topRepeatedCount}/${(v as any).n} steps dist from 2^20=${(v as any).distFrom2p20} near2p20=${(v as any).isNear2p20}`);
    }
    line(` Identity check ctx_total_length/mean ≈ response + prompt: n=${R.shape.identityCheck.n} max abs residual=${fmt(R.shape.identityCheck.maxAbsResid, 1)} max rel residual=${pct(R.shape.identityCheck.maxRelResid, 4)}`);

    line("\n## 2. Length vs score (level correlation + first-difference correlation)");
    line(" metric | n | pearson | spearman | p_spearman | 95%CI(spearman) | d_spearman | dN | p_diff");
    for (const row of R.perf) {
      const c = row.vs_response;
      line(`  ${row.metric}: n=${c.n} r=${fmt(c.pearson)} rho=${fmt(c.spearman)} p=${fmt(c.pSpearman, 4)} CI=[${fmt(c.ciSpearman[0], 2)},${fmt(c.ciSpearman[1], 2)}] d_rho=${fmt(c.dSpearman)} dN=${c.dN} p_d=${fmt(c.dPSpearman, 4)}`);
    }
    line(" (vs ctx_total_length/mean)");
    for (const row of R.perf) {
      const c = row.vs_total;
      line(`  ${row.metric}: rho=${fmt(c.spearman)} d_rho=${fmt(c.dSpearman)} p_d=${fmt(c.dPSpearman, 4)}`);
    }
    line(`\n Pooled cross-run relative first-difference correlation (n=${report.pooled.perf[0]?.n ?? "?"}=pro+flash differences concatenated, critical |rho|≈${fmt(report.pooledCrit05, 3)}):`);
    for (const r of report.pooled.perf) {
      line(`  ${r.metric}: n=${r.n} rho=${fmt(r.spearman)} p=${fmt(r.pSpearman, 4)} [pro rho=${fmt(r.pro.spearman)} n=${r.pro.n} p=${fmt(r.pro.p, 3)} | flash rho=${fmt(r.flash.spearman)} n=${r.flash.n} p=${fmt(r.flash.p, 3)}]`);
    }
    line("\n Offline benchmarks vs length:");
    for (const b of R.bench) {
      line(`  ${b.key} (${b.title}) n=${b.n} rho(len)=${fmt(b.vs_response.spearman)} d_rho=${fmt(b.vs_response.dSpearman)} dN=${b.vs_response.dN}`);
      line(`     lag (length at step s-L explains benchmark at step s) ` + b.lagged.map((l: any) => `L${l.lag}:rho=${fmt(l.spearman)}`).join(" "));
      line(`     Step-to-step change: n=${b.deltaStats.n} mean=${fmt(b.deltaStats.mean, 2)} std=${fmt(b.deltaStats.std, 2)} robust σ=${fmt(b.deltaStats.robustSigma, 2)} max abs=${fmt(b.deltaStats.maxAbs, 2)} worst z=${fmt(b.deltaStats.worstZ, 2)}`);
      line(`     worst drops: ` + b.worstDrops.map((d: any) => `step${d.step} ${fmt(d.value, 2)} Δ=${fmt(d.delta, 2)}`).join(" ; "));
    }

    line("\n## 3. The cost of length growth");
    line(" metric | n | rho(len_resp) | d_rho | rho(len_total) | d_rho_total");
    for (const row of R.cost.rows) {
      line(`  ${row.metric}: n=${row.vs_response.n} rho=${fmt(row.vs_response.spearman)} d_rho=${fmt(row.vs_response.dSpearman)} | total rho=${fmt(row.vs_total.spearman)} d_rho=${fmt(row.vs_total.dSpearman)}`);
    }
    line("\n clip_ratio by category (first/last/max/mean + rho vs ctx_total_length/mean):");
    for (const c of R.cost.clip) line(`  ${c.metric}: first=${c.first} last=${c.last} max=${c.max} mean=${fmt(c.mean, 7)} rho=${fmt(c.vs_total.spearman)}`);
    const zeroClip = R.cost.clip.filter((c: any) => !(c.max > 0)).map((c: any) => c.metric);
    line(" Datasets with clip_ratio always 0:" + (zeroClip.length ? zeroClip.join(", ") : "(none)"));
    line(" Constant series (no variance, correlation undefined):" + R.cost.rows.filter((r: any) => !Number.isFinite(r.vs_response.spearman)).map((r: any) => r.metric).join(", "));

    line("\n Normalized cost (seconds per billion tokens; first/last/ratio/slope/r):");
    for (const n of R.cost.normalized) {
      line(`  ${n.metric}: ${fmt(n.first, 0)} → ${fmt(n.last, 0)} ×${fmt(n.ratio, 2)} slope=${fmt(n.slopePerStep, 2)}/step r=${fmt(n.rStep)} | rho vs length=${fmt(n.vsLen.spearman)}`);
    }
    const tpl = R.cost.tokensPerLenStats;
    line(` Tokens per step / response length: mean=${fmt(tpl.mean, 0)} CV=${pct(tpl.cv)} slope=${fmt(tpl.slopePerStep, 1)} r=${fmt(tpl.r)} | rho vs length=${fmt(tpl.vsLen.spearman)}`);
    line(` Cost metadata: rate=${R.cost.costMeta.rate_per_s}/s so_far=${fmt(R.cost.costMeta.cost_so_far, 0)} tokens_cum=${R.cost.costMeta.totals?.tokens_cum} trained_cum=${R.cost.costMeta.totals?.trained_cum} restarts=${R.cost.costMeta.totals?.restarts}`);

    line("\n Mechanism/health metrics (first→last, correlation with length level/diff):");
    for (const m of R.cost.mech) {
      line(`  ${m.metric}: ${fmt(m.first, 4)} → ${fmt(m.last, 4)} | rho=${fmt(m.vs_response.spearman)} d_rho=${fmt(m.vs_response.dSpearman)} p_d=${fmt(m.vs_response.dPSpearman, 4)}${m.desc?.name ? "  # " + m.desc.name : ""}`);
    }
    line("\n Pooled cross-run relative first-difference correlation (cost family):");
    for (const r of report.pooled.cost) {
      line(`  ${r.metric}: n=${r.n} rho=${fmt(r.spearman)} p=${fmt(r.pSpearman, 4)} [pro rho=${fmt(r.pro.spearman)} | flash rho=${fmt(r.flash.spearman)}]`);
    }
    line("\n Pooled cross-run relative first-difference correlation (mechanism family):");
    for (const r of report.pooled.mech) {
      line(`  ${r.metric}: n=${r.n} rho=${fmt(r.spearman)} p=${fmt(r.pSpearman, 4)} [pro rho=${fmt(r.pro.spearman)} | flash rho=${fmt(r.flash.spearman)}]`);
    }

    line(`\n## 4. Top Spearman vs ctx_response_length/mean (n=${R.n_steps}, critical |rho|=${fmt(report.crit05[R.run], 3)})`);
    R.topResp.slice(0, 30).forEach((r: any, i: number) => {
      line(`  ${String(i + 1).padStart(2)}. rho=${fmt(r.spearman)} d_rho=${fmt(r.dSpearman)} p=${fmt(r.pSpearman, 4)} fam=${r.family} derived=${r.derived} | ${r.metric}`);
      if (r.desc?.name) line(`       name: ${r.desc.name}`);
    });
    line("\n Top 30 after dropping synonyms/derived (the actually informative ones):");
    R.topRespInformative.slice(0, 30).forEach((r: any, i: number) => {
      line(`  ${String(i + 1).padStart(2)}. rho=${fmt(r.spearman)} d_rho=${fmt(r.dSpearman)} p=${fmt(r.pSpearman, 4)} fam=${r.family} | ${r.metric}${r.desc?.name ? "  # " + r.desc.name : ""}`);
    });
    line(`\n Top100 family distribution: ` + R.familyTallyResp.map(([f, n]: any) => `${f}:${n}`).join(", "));

    line(`\n## 4b. Top Spearman vs ctx_total_length/mean`);
    R.topTotal.slice(0, 30).forEach((r: any, i: number) => {
      line(`  ${String(i + 1).padStart(2)}. rho=${fmt(r.spearman)} d_rho=${fmt(r.dSpearman)} p=${fmt(r.pSpearman, 4)} fam=${r.family} derived=${r.derived} | ${r.metric}`);
      if (r.desc?.name) line(`       name: ${r.desc.name}`);
    });
    line("\n Top 30 after dropping synonyms/derived (the actually informative ones):");
    R.topTotalInformative.slice(0, 30).forEach((r: any, i: number) => {
      line(`  ${String(i + 1).padStart(2)}. rho=${fmt(r.spearman)} d_rho=${fmt(r.dSpearman)} p=${fmt(r.pSpearman, 4)} fam=${r.family} | ${r.metric}${r.desc?.name ? "  # " + r.desc.name : ""}`);
    });

    line("\n Per-step jump profile + engineering event annotations:");
    line(" step | n_jumps | events | top families");
    for (const p of R.anomaly.profile) {
      const ev = p.events;
      const tag = [ev.restarts.length ? "restart" : "", ev.redo ? "REDO" : "", ev.versions.length ? "v:" + ev.versions.join(",") : ""].filter(Boolean).join(" ") || "-";
      line(`  ${String(p.step).padStart(3)} | ${String(p.n_jumps).padStart(6)} | ${tag.padEnd(24)} | ` + p.top_families.map(([f, n]: any) => `${f}:${n}`).join(", "));
    }
    line("\n Steps affected by engineering events (first step after restart / redo steps / the step before):" + R.eventAffectedSteps.join(", "));
    line("\n First-difference correlation after excluding steps adjacent to engineering events (key metrics):");
    for (const r of R.robustKey) {
      line(`  ${r.metric}: all diffs d_rho=${fmt(r.all.dSpearman)} dN=${r.all.dN} p=${fmt(r.all.dPSpearman, 4)} → excluding event-adjacent steps d_rho=${fmt(r.exclEvents.spearman)} dN=${r.exclEvents.n} p=${fmt(r.exclEvents.pSpearman, 4)}`);
    }
    line("\n Benchmark worst drops × synchronous jumps × events:");
    for (const b of R.benchJumpAlignment) {
      for (const w of b.worst) {
        line(`  ${b.key} step${w.step}: ${fmt(w.value, 2)} (Δ=${fmt(w.delta, 2)}) length Δ=${w.lengthDeltaPct === null ? "n/a" : pct(w.lengthDeltaPct)} synchronous jumps=${w.nJumps} events=${[w.events.restarts.length ? "restart" : "", w.events.redo ? "REDO" : "", w.events.versions.length ? "v:" + w.events.versions.join(",") : ""].filter(Boolean).join(" ") || "-"}`);
        line(`      top families: ${w.topJumpFamilies.map(([f, n]: any) => `${f}:${n}`).join(", ") || "-"}`);
        line(`      top metrics: ${w.topJumps.join(" | ") || "-"}`);
      }
    }
    line("\n Restart events → first reported step after restart (aligned to event sequence):");
    for (const r of R.restarts) line(`  ${r.iso} prevStep=${r.prevStep} → nextStep=${r.nextStep}${r.nextRedo ? " (redo=true)" : ""}`);
    line("\n Version switches → effective step:");
    for (const v of R.versions) line(`  ${v.iso} ${v.version} n=${v.n} first seen running step=${v.stepAtVersionCapture} (wall→step ${v.firstStepAtWall})`);
    line("\n redo (recomputed after restart) steps:" + (R.redoSteps.length ? R.redoSteps.map((x: any) => `step${x.step}@${x.iso}`).join(", ") : "(none)"));

    line("\n Metrics with synchronous jumps at focus steps (by rz desc, up to 25):");
    for (const f of R.focus) {
      line(`  --- step ${f.step}: ${f.jumps.length} satisfy rel>=${R.jumpOpts.relMin} and rz>=${R.jumpOpts.rzMin}`);
      for (const j of f.jumps.slice(0, 25)) {
        line(`      rz=${fmt(j.rz, 1)} rel=${pct(j.rel)} ${j.metric}: ${fmt(j.prev, 4)} → ${fmt(j.cur, 4)}  [${j.family}]`);
      }
    }

    line("\n## 6. Counter-evidence (dataset level: length vs pass rate)");
    line(" Datasets where length rises but pass rate falls (divergent):");
    const dv = R.reversal.filter((r: any) => r.divergent);
    if (!dv.length) line("  (none)");
    for (const r of dv) line(`  ${r.cat}/${r.ds}: lenSlope=${fmt(r.lenSlopePerStep, 1)} r=${fmt(r.lenR)} passSlope=${fmt(r.passSlopePerStep, 5)} r=${fmt(r.passR)} rho_level=${fmt(r.spearman_level)}`);
    line(" 8 datasets with the lowest Spearman(length, pass rate):");
    for (const r of R.reversal.slice(0, 8)) line(`  ${r.cat}/${r.ds}: rho_level=${fmt(r.spearman_level)} d_rho=${fmt(r.spearman_diff)} len ${fmt(r.lenFirst, 0)}→${fmt(r.lenLast, 0)} pass ${fmt(r.passFirst, 4)}→${fmt(r.passLast, 4)}`);

    line("\n## 6b. Mechanical identity checks (is the high correlation just unit conversion)");
    for (const m of R.mechanicalChecks) {
      line(`  ${m.label}: mean=${fmt(m.mean, 6)} std=${fmt(m.std, 6)} CV=${pct(m.cv)} range[${fmt(m.min, 6)},${fmt(m.max, 6)}] slope=${fmt(m.slopePerStep, 8)} r=${fmt(m.rStep)} | numerator/denominator rho=${fmt(m.corrNumDen.spearman)}`);
    }
    const rc = R.restartContrast;
    line("\n Single-step relative change in ctx_response_length/mean: first step after restart vs other steps:");
    for (const [label, s] of [["first step after restart", rc.restart], ["redo steps (not restart first step)", rc.redo], ["steps unaffected by events", rc.other]] as [string, any][]) {
      if (!s) { line(`  ${label}: no samples`); continue; }
      line(`  ${label}: n=${s.n} mean=${pct(s.mean)} median=${pct(s.median)} negative share=${pct(s.negShare)} range[${pct(s.min)},${pct(s.max)}]`);
    }

    line("\n## 7. Data quality: series with suspected \"0 = not reported\" sentinel values");
    line(` ${R.dataQuality.length} hits:`);
    for (const q of R.dataQuality.slice(0, 25)) {
      line(`  ${q.metric}: 0 appears ${q.zeros}/${q.n} (${pct(q.zeroShare)}) median=${fmt(q.median, 4)} min nonzero=${fmt(q.minNonZero, 4)}`);
    }
  }
  line(`\nJSON written: ${OUT_JSON}`);
}
