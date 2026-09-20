/**
 * factor_report.ts — 看板指标空间的多元统计与降维分析（A3）
 *
 * 从项目根目录执行：
 *   bun src/factor_report.ts
 *
 * 输出：
 *   1) stdout 全部数字（分节打印）
 *   2) analysis/zh-CN/numbers/A3-factor-numbers.json
 *
 * 依赖：无（特征值分解自己实现：Jacobi 循环旋转；层次聚类用最近邻链 NNC + Lance-Williams）
 * 本脚本不硬编码任何结论数字，所有数字从数据现算。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const STORE = join(ROOT, "data/store");
const OUT_DIR = join(ROOT, "analysis/zh-CN/numbers");

const T0 = Date.now();
const log = (...a: unknown[]) => console.log(...a);
const hr = (t: string) => log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78));

// ---------------------------------------------------------------- 工具：数值

/** 对称矩阵 Jacobi 特征分解。A: n×n row-major（会被复制）。返回降序特征值与特征向量（vectors[row*n+k] = 第k个特征向量的第row个分量）。 */
function jacobiEigen(Ain: Float64Array, n: number, maxSweeps = 200) {
  const A = Float64Array.from(Ain);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  let sweeps = 0;
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(A[i * n + i]);
  const eps = Math.max(trace, 1) * 1e-15;
  for (let sw = 0; sw < maxSweeps; sw++) {
    sweeps = sw + 1;
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (Math.sqrt(2 * off) < eps) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p], aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const sgn = theta >= 0 ? 1 : -1;
        const t = sgn / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const vals = new Float64Array(n);
  for (let i = 0; i < n; i++) vals[i] = A[i * n + i];
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => vals[b] - vals[a]);
  const values = new Float64Array(n), vectors = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    values[k] = vals[idx[k]];
    for (let r = 0; r < n; r++) vectors[r * n + k] = V[r * n + idx[k]];
  }
  return { values, vectors, sweeps };
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; }
  if (sa <= 0 || sb <= 0) return NaN;
  return sab / Math.sqrt(sa * sb);
}

function ranks(v: ArrayLike<number>) {
  const n = v.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && v[idx[j + 1]] === v[idx[i]]) j++;
    const avg = (i + j) / 2;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

function quantile(sorted: ArrayLike<number>, p: number) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------------------------------------------------------------- 数据加载

type Series = Record<string, (number | null)[]>;

const seriesPro: Series = JSON.parse(readFileSync(join(STORE, "runs/pro/series.json"), "utf8"));
const seriesFlash: Series = JSON.parse(readFileSync(join(STORE, "runs/flash/series.json"), "utf8"));
const axisPro = JSON.parse(readFileSync(join(STORE, "runs/pro/axis.json"), "utf8"));
const axisFlash = JSON.parse(readFileSync(join(STORE, "runs/flash/axis.json"), "utf8"));
const statusPro = JSON.parse(readFileSync(join(STORE, "runs/pro/status.json"), "utf8"));
const statusFlash = JSON.parse(readFileSync(join(STORE, "runs/flash/status.json"), "utf8"));
const tagsPro = JSON.parse(readFileSync(join(STORE, "runs/pro/tags.json"), "utf8"));
const tagsFlash = JSON.parse(readFileSync(join(STORE, "runs/flash/tags.json"), "utf8"));
const notices = JSON.parse(readFileSync(join(STORE, "notices.json"), "utf8"));
const metricsDoc = JSON.parse(readFileSync(join(ROOT, "content/metrics.json"), "utf8"));

const RUNS = {
  pro: { series: seriesPro, axis: axisPro, status: statusPro, tags: tagsPro, N: axisPro.steps.length },
  flash: { series: seriesFlash, axis: axisFlash, status: statusFlash, tags: tagsFlash, N: axisFlash.steps.length },
} as const;
type RunKey = keyof typeof RUNS;

// ---------------------------------------------------------------- 指标元数据：族 / 组

/** 把具体 key 归一成模板：dataset-xxxx → dataset-<id>；partial/3/ → partial/<k>/；harness-A → harness-<x> */
function normalizeKey(k: string) {
  return k
    .replace(/dataset-[a-z0-9]+/g, "dataset-<id>")
    .replace(/^partial\/\d+\//, "partial/<k>/")
    .replace(/\/harness-[A-Z]\//, "/harness-<x>/")
    .replace(/\/(agentic|chat|code|visual|general|cyber)\//g, "/<cat>/");
}

const groupMap = new Map<string, string>();
for (const it of metricsDoc.items) groupMap.set(normalizeKey(it.id), it.group);

const PREFIX_GROUP: [RegExp, string][] = [
  [/^actor\//, "优化器与策略"],
  [/^critic\//, "奖励信号"],
  [/^penalty\//, "奖励信号"],
  [/^train\/adv_/, "奖励信号"],
  [/^train\/passrate/, "效果与采样"],
  [/^train\/harness/, "判分组统计"],
  [/^train\/trace/, "判分组统计"],
  [/^ctx_(total|prompt|response)_length\//, "系统、性能与成本"],
  [/^dynsam\//, "效果与采样"],
  [/^env\//, "系统、性能与成本"],
  [/^timing_s\//, "系统、性能与成本"],
  [/^training\//, "系统、性能与成本"],
  [/^perf\//, "系统、性能与成本"],
  [/^partial\//, "训练推理一致性与数据新鲜度"],
  [/^train_infer_diff\//, "训练推理一致性与数据新鲜度"],
];

function groupOf(k: string) {
  const g = groupMap.get(normalizeKey(k));
  if (g) return g;
  for (const [re, name] of PREFIX_GROUP) if (re.test(k)) return name;
  return "未归类";
}

/** 族（family）= key 去掉数据集 id、桶号、harness 字母后的模板，再截到语义前缀 */
function familyOf(k: string) {
  const nk = normalizeKey(k);
  const seg = nk.split("/");
  if (seg[0] === "penalty" && seg[1] === "stage_credit_group") {
    // penalty/stage_credit_group/harness-<x>/<metric> 与 penalty/stage_credit_group/<metric>
    if (seg.length >= 4 && seg[2] === "harness-<x>") return `penalty/stage_credit_group/harness/<${seg[3]}>`;
    if (seg.length >= 4) return `penalty/stage_credit_group/${seg[2]}/<metric>`;
    return `penalty/stage_credit_group/<metric>`;
  }
  if (seg[0] === "ctitic") return nk;
  if (seg[0] === "partial" && seg[1] === "<k>") return `partial/<k>/${seg.slice(2).join("/")}`;
  if (seg[0] === "partial") return `partial/<cat>/${seg.slice(2).join("/")}`;
  if (seg[0].startsWith("ctx_")) return `${seg[0]}/<cat>/${seg.slice(2).join("/")}`;
  if (seg[0] === "dynsam" && seg[1] !== "<cat>") return `dynsam/${seg.slice(1).join("/")}`;
  if (seg[0] === "dynsam") return `dynsam/<cat>/${seg.slice(2).join("/")}`;
  return nk;
}

/** 恒等式/机械关系家族：ctx_total = prompt + response；partial 各桶 frac 求和为 1；partial n_tokens = frac × 总 token */
function isMechanical(k: string) {
  if (/^ctx_total_length\//.test(k)) return "ctx_total = prompt + response";
  if (/^partial\/(\d+)\/frac$/.test(k)) return "Σ_k partial/<k>/frac = 1";
  if (/^partial\/(\d+)\/n_tokens$/.test(k)) return "partial n_tokens = frac × tokens_step";
  return null;
}

// ---------------------------------------------------------------- 预处理

type Cohort = {
  names: string[];
  /** Z[d*N+s]，每个指标内部 z-score 后的值 */
  Z: Float64Array;
  N: number;
  d: number;
  dropped: { constant: string[]; lowCoverage: number; mechanicalExcluded: number };
  coverage: Float64Array;
};

function fillSeries(v: (number | null)[], mode: "interp" | "mean"): Float64Array | null {
  const N = v.length;
  const x = new Float64Array(N);
  const known: number[] = [];
  for (let i = 0; i < N; i++) if (v[i] !== null && Number.isFinite(v[i] as number)) known.push(i);
  if (known.length === 0) return null;
  if (mode === "mean") {
    let m = 0;
    for (const i of known) m += v[i] as number;
    m /= known.length;
    for (let i = 0; i < N; i++) x[i] = v[i] !== null && Number.isFinite(v[i] as number) ? (v[i] as number) : m;
  } else {
    for (let i = 0; i < N; i++) {
      if (v[i] !== null && Number.isFinite(v[i] as number)) { x[i] = v[i] as number; continue; }
      // 线性插值；两端取最近的已知值
      let lo = -1, hi = -1;
      for (const j of known) { if (j < i) lo = j; if (j > i && hi < 0) hi = j; }
      if (lo < 0) x[i] = v[hi] as number;
      else if (hi < 0) x[i] = v[lo] as number;
      else {
        const a = v[lo] as number, b = v[hi] as number;
        x[i] = a + (b - a) * (i - lo) / (hi - lo);
      }
    }
  }
  return x;
}

function buildCohort(run: RunKey, opt: {
  coverage: number; fill: "interp" | "mean"; excludeMechanical: boolean; keys?: string[];
}): Cohort {
  const R = RUNS[run];
  const allKeys = opt.keys ?? Object.keys(R.series);
  const names: string[] = [];
  const cols: Float64Array[] = [];
  const constant: string[] = [];
  let lowCoverage = 0, mechanicalExcluded = 0;
  const coverage: number[] = [];
  const N = R.N;
  for (const k of allKeys) {
    const raw = R.series[k];
    if (!raw) { lowCoverage++; continue; }
    let ok = 0;
    for (let i = 0; i < N; i++) if (raw[i] !== null && Number.isFinite(raw[i] as number)) ok++;
    if (ok / N < opt.coverage) { lowCoverage++; continue; }
    if (opt.excludeMechanical && isMechanical(k)) { mechanicalExcluded++; continue; }
    const f = fillSeries(raw.slice(0, N), opt.fill);
    if (!f) { lowCoverage++; continue; }
    let mean = 0;
    for (let i = 0; i < N; i++) mean += f[i];
    mean /= N;
    let ss = 0;
    for (let i = 0; i < N; i++) ss += (f[i] - mean) ** 2;
    const sd = Math.sqrt(ss / N);
    if (!(sd > 0)) { constant.push(k); continue; }
    const z = new Float64Array(N);
    for (let i = 0; i < N; i++) z[i] = (f[i] - mean) / sd;
    names.push(k); cols.push(z); coverage.push(ok / N);
  }
  const d = names.length;
  const Z = new Float64Array(d * N);
  for (let j = 0; j < d; j++) Z.set(cols[j], j * N);
  return { names, Z, N, d, dropped: { constant, lowCoverage, mechanicalExcluded }, coverage: Float64Array.from(coverage) };
}

// ---------------------------------------------------------------- PCA

/** 去趋势：每个指标对步序号做最小二乘回归，取残差再 z-score（去掉共同的时间趋势） */
function detrendCohort(c: Cohort): Cohort {
  const { d, N } = c;
  const Z = new Float64Array(d * N);
  for (let j = 0; j < d; j++) {
    const off = j * N;
    let mt = 0, mx = 0;
    for (let s = 0; s < N; s++) { mt += s; mx += c.Z[off + s]; }
    mt /= N; mx /= N;
    let stt = 0, sxt = 0;
    for (let s = 0; s < N; s++) { stt += (s - mt) ** 2; sxt += (s - mt) * (c.Z[off + s] - mx); }
    const b = sxt / stt, a = mx - b * mt;
    let ss = 0;
    for (let s = 0; s < N; s++) { const r = c.Z[off + s] - (a + b * s); Z[off + s] = r; ss += r * r; }
    const sd = Math.sqrt(ss / N) || 1;
    for (let s = 0; s < N; s++) Z[off + s] /= sd;
  }
  return { ...c, Z };
}

/** 给定聚类距离矩阵 D（=1-|ρ|），找出 |ρ| ≥ thr 的连通分量（近重复组） */
function nearDuplicateGroups(C: Cohort, D: Float32Array, thr: number) {
  const d = C.d;
  const parent = new Int32Array(d);
  for (let i = 0; i < d; i++) parent[i] = i;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const lim = 1 - thr;
  let pairs = 0;
  for (let i = 0; i < d; i++) {
    for (let j = i + 1; j < d; j++) {
      if (D[i * d + j] <= lim + 1e-7) {
        pairs++;
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < d; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const arr = Array.from(groups.values()).map(members => {
    const fam: Record<string, number> = {};
    for (const i of members) fam[familyOf(C.names[i])] = (fam[familyOf(C.names[i])] ?? 0) + 1;
    return {
      size: members.length,
      example: C.names[members[0]],
      top_families: Object.entries(fam).sort((x, y) => y[1] - x[1]).slice(0, 4),
      sample: members.slice(0, 5).map(i => C.names[i]),
    };
  }).sort((x, y) => y.size - x.size);
  return { threshold: thr, n_pairs: pairs, n_groups: arr.length, sizes: arr.map(a => a.size), top_groups: arr.slice(0, 8) };
}

type PcaResult = {
  N: number; d: number;
  values: Float64Array;          // 特征值（降序），Σ = d*N
  frac: Float64Array;            // λ / Σλ
  cum: Float64Array;
  loadings: Float64Array;        // k×d row-major，单位长度
  n80: number; n90: number; n95: number;
  PR: number;                    // 参与率 (Σλ)²/Σλ²
  noiseEdge: number;             // Marchenko–Pastur 上边缘（对应 (1+√(d/n))²）
  nAboveNoise: number;
  K: number;                     // 分解出的成分数（= min(N,d) 个非零，实际保留 N）
};

function pca(Z: Float64Array, d: number, N: number): PcaResult {
  // G[s1*N+s2] = Σ_d z_d[s1] z_d[s2]
  const G = new Float64Array(N * N);
  for (let j = 0; j < d; j++) {
    const off = j * N;
    for (let s1 = 0; s1 < N; s1++) {
      const z1 = Z[off + s1];
      if (z1 === 0) continue;
      for (let s2 = s1; s2 < N; s2++) G[s1 * N + s2] += z1 * Z[off + s2];
    }
  }
  for (let s1 = 0; s1 < N; s1++) for (let s2 = 0; s2 < s1; s2++) G[s1 * N + s2] = G[s2 * N + s1];
  const { values, vectors } = jacobiEigen(G, N);
  const total = d * N;
  const frac = new Float64Array(N), cum = new Float64Array(N);
  let acc = 0;
  for (let k = 0; k < N; k++) { frac[k] = values[k] / total; cum[k] = (acc += frac[k]); }
  const nAt = (thr: number) => { for (let k = 0; k < N; k++) if (cum[k] >= thr) return k + 1; return N; };
  let s1 = 0, s2 = 0;
  for (let k = 0; k < N; k++) { s1 += values[k]; s2 += values[k] * values[k]; }
  const PR = (s1 * s1) / s2;
  const noiseEdge = Math.pow(1 + Math.sqrt(d / (N - 1)), 2);
  let nAboveNoise = 0;
  for (let k = 0; k < N; k++) if (values[k] > noiseEdge) nAboveNoise++;
  // 载荷：L[k][d] = (Zᵀ v_k)[d] / sqrt(λ_k)，λ_k 为 G 的特征值 → ||L[k]|| = 1
  const loadings = new Float64Array(N * d);
  for (let k = 0; k < N; k++) {
    const s = Math.sqrt(Math.max(values[k], 1e-300));
    for (let j = 0; j < d; j++) {
      let acc2 = 0;
      const off = j * N;
      for (let st = 0; st < N; st++) acc2 += vectors[st * N + k] * Z[off + st];
      loadings[k * d + j] = acc2 / s;
    }
    // 符号约定：最大 |载荷| 取正
    let bi = 0, bv = 0;
    for (let j = 0; j < d; j++) if (Math.abs(loadings[k * d + j]) > bv) { bv = Math.abs(loadings[k * d + j]); bi = j; }
    if (loadings[k * d + bi] < 0) for (let j = 0; j < d; j++) loadings[k * d + j] *= -1;
  }
  return { N, d, values, frac, cum, loadings, n80: nAt(0.8), n90: nAt(0.9), n95: nAt(0.95), PR, noiseEdge, nAboveNoise, K: N };
}

/** 步在主成分空间的坐标：score[s][k] = Σ_d z_d[s] * L[k][d] */
function pcScores(Z: Float64Array, d: number, N: number, P: PcaResult, kUse: number) {
  const S = new Float64Array(N * kUse);
  for (let k = 0; k < kUse; k++) {
    for (let j = 0; j < d; j++) {
      const l = P.loadings[k * d + j];
      if (l === 0) continue;
      const off = j * N;
      for (let s = 0; s < N; s++) S[s * kUse + k] += Z[off + s] * l;
    }
  }
  return S;
}

// ---------------------------------------------------------------- 层次聚类（平均连接 + 最近邻链）

function ari(labelsA: Int32Array, labelsB: Int32Array) {
  const n = labelsA.length;
  const key = (a: number, b: number) => a + ":" + b;
  const cont = new Map<string, number>();
  const ra = new Map<number, number>(), rb = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    cont.set(key(labelsA[i], labelsB[i]), (cont.get(key(labelsA[i], labelsB[i])) ?? 0) + 1);
    ra.set(labelsA[i], (ra.get(labelsA[i]) ?? 0) + 1);
    rb.set(labelsB[i], (rb.get(labelsB[i]) ?? 0) + 1);
  }
  let sumIJ = 0;
  for (const v of cont.values()) sumIJ += (v * (v - 1)) / 2;
  let sa = 0; for (const v of ra.values()) sa += (v * (v - 1)) / 2;
  let sb = 0; for (const v of rb.values()) sb += (v * (v - 1)) / 2;
  const tot = (n * (n - 1)) / 2;
  const exp = (sa * sb) / tot;
  const mx = (sa + sb) / 2;
  return (sumIJ - exp) / (mx - exp);
}

type Linkage = { labels: Int32Array; merges: { h: number; size: number; remaining: number }[]; K: number };

/**
 * 精确贪心平均连接（UPGMA），用"最近邻缓存 + 惰性重扫"实现：
 * 每个活簇缓存它的最近邻 nn[i] 与距离 nnd[i]；每轮合并全局最近的一对；
 * 合并后只重扫 nn 指向被合并簇的那些簇。均摊 O(n²)。
 * （注：实测"最近邻链 NNC"在 UPGMA 上会收敛到局部互近邻对、并非全局最近对，故不用。）
 */
function averageLinkageNNC(n: number, Dist: Float32Array, targetK: number): Linkage {
  const D = Float32Array.from(Dist);
  const sz = new Float64Array(n).fill(1);
  const alive = new Uint8Array(n).fill(1);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  let nAlive = n;
  const merges: { h: number; size: number; remaining: number }[] = [];
  const nn = new Int32Array(n).fill(-1);
  const nnd = new Float64Array(n).fill(Infinity);
  const rescan = (i: number) => {
    let best = -1, bd = Infinity;
    const row = i * n;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === i) continue;
      const dd = D[row + k];
      if (dd < bd) { bd = dd; best = k; }
    }
    nn[i] = best; nnd[i] = bd;
  };
  for (let i = 0; i < n; i++) rescan(i);
  while (nAlive > targetK) {
    let i = -1, bd = Infinity;
    for (let k = 0; k < n; k++) if (alive[k] && nnd[k] < bd) { bd = nnd[k]; i = k; }
    if (i < 0) break;
    const j = nn[i];
    if (j < 0) break;
    const h = D[i * n + j];
    const si = sz[i], sj = sz[j], tot = si + sj;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === i || k === j) continue;
      const nd = (si * D[i * n + k] + sj * D[j * n + k]) / tot;
      D[i * n + k] = nd; D[k * n + i] = nd;
    }
    sz[i] = tot; alive[j] = 0; parent[j] = i; nAlive--;
    merges.push({ h, size: tot, remaining: nAlive });
    // 受影响的重扫：新簇 i 本身，以及 nn 指向 i 或 j 的簇
    const affected: number[] = [i];
    for (let k = 0; k < n; k++) if (alive[k] && k !== i && (nn[k] === i || nn[k] === j)) affected.push(k);
    for (const k of affected) rescan(k);
  }
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const labelMap = new Map<number, number>();
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!labelMap.has(r)) labelMap.set(r, labelMap.size);
    labels[i] = labelMap.get(r)!;
  }
  return { labels, merges, K: labelMap.size };
}

/** 朴素平均连接（仅用于自检小样本） */
function averageLinkageNaive(n: number, Dist: Float32Array, targetK: number): Int32Array {
  const D = Float64Array.from(Dist);
  const sz = new Float64Array(n).fill(1);
  const mem: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const alive = new Uint8Array(n).fill(1);
  let nAlive = n;
  const D2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D2[i * n + j] = D[i * n + j];
  while (nAlive > targetK) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) { if (!alive[j]) continue;
        if (D2[i * n + j] < bd) { bd = D2[i * n + j]; bi = i; bj = j; } } }
    const si = sz[bi], sj = sz[bj], tot = si + sj;
    for (let k = 0; k < n; k++) { if (!alive[k] || k === bi || k === bj) continue;
      const nd = (si * D2[bi * n + k] + sj * D2[bj * n + k]) / tot;
      D2[bi * n + k] = nd; D2[k * n + bi] = nd; }
    sz[bi] = tot; mem[bi].push(...mem[bj]); mem[bj] = []; alive[bj] = 0; nAlive--;
  }
  const labels = new Int32Array(n);
  let c = 0;
  for (let i = 0; i < n; i++) if (alive[i]) { for (const m of mem[i]) labels[m] = c; c++; }
  return labels;
}

// ---------------------------------------------------------------- 变点

type SegResult = { breaks: number[]; deltas: number[]; penalty: number; rss: number };

function binarySegmentation(X: Float64Array, n: number, dim: number, maxCP: number): SegResult {
  const rss = (a: number, b: number) => { // [a,b)
    let tot = 0;
    for (let k = 0; k < dim; k++) {
      let s = 0, s2 = 0;
      for (let i = a; i < b; i++) { const v = X[i * dim + k]; s += v; s2 += v * v; }
      const m = s / (b - a);
      tot += s2 - (b - a) * m * m;
    }
    return tot;
  };
  const segs: [number, number][] = [[0, n]];
  const breaks: number[] = [], deltas: number[] = [];
  let total = rss(0, n);
  let penalty = 0;
  for (let step = 0; step < maxCP; step++) {
    let bestGain = -Infinity, bestSeg = -1, bestPos = -1;
    for (let si = 0; si < segs.length; si++) {
      const [a, b] = segs[si];
      if (b - a < 4) continue;
      const base = rss(a, b);
      for (let p = a + 2; p <= b - 2; p++) {
        const g = base - rss(a, p) - rss(p, b);
        if (g > bestGain) { bestGain = g; bestSeg = si; bestPos = p; }
      }
    }
    if (bestSeg < 0) break;
    const sigma2 = total / (n * dim);
    penalty = dim * Math.log(n) * sigma2;
    if (bestGain <= penalty) break;
    const [a, b] = segs[bestSeg];
    segs.splice(bestSeg, 1, [a, bestPos], [bestPos, b]);
    breaks.push(bestPos); deltas.push(bestGain);
    total -= bestGain;
  }
  breaks.sort((x, y) => x - y);
  return { breaks, deltas, penalty, rss: total };
}

/** 逐候选位置的两段均值差统计量（对标准化后的 score 矩阵） */
function splitProfile(X: Float64Array, n: number, dim: number) {
  const out: { pos: number; stat: number }[] = [];
  for (let p = 2; p <= n - 2; p++) {
    let stat = 0;
    for (let k = 0; k < dim; k++) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < p; i++) s1 += X[i * dim + k];
      for (let i = p; i < n; i++) s2 += X[i * dim + k];
      const m1 = s1 / p, m2 = s2 / (n - p);
      stat += (m1 - m2) ** 2;
    }
    out.push({ pos: p, stat: (p * (n - p) / n) * stat });
  }
  return out;
}

// ---------------------------------------------------------------- 偏相关

function partialVsTime(v: Float64Array | (number | null)[], N: number) {
  const x = new Float64Array(N), t = new Float64Array(N);
  for (let i = 0; i < N; i++) { x[i] = v[i] as number; t[i] = i; }
  let mt = 0, mx = 0;
  for (let i = 0; i < N; i++) { mt += t[i]; mx += x[i]; }
  mt /= N; mx /= N;
  let stt = 0, sxt = 0;
  for (let i = 0; i < N; i++) { stt += (t[i] - mt) ** 2; sxt += (t[i] - mt) * (x[i] - mx); }
  const b = sxt / stt, a = mx - b * mt;
  const r = new Float64Array(N);
  for (let i = 0; i < N; i++) r[i] = x[i] - (a + b * t[i]);
  return r;
}

// ================================================================ 主流程

const RESULT: Record<string, any> = { generated_at: new Date().toISOString(), script: "src/factor_report.ts", inputs: [] };

hr("0. Self-check: Jacobi and NNC clustering");
{
  // Jacobi 自检
  const n = 8;
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = Math.sin(i * 1.7 + j * 0.3) + (i === j ? 3 : 0);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[i * n + j] = A[j * n + i];
  const { values, vectors } = jacobiEigen(A, n);
  let maxRes = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      let av = 0;
      for (let j = 0; j < n; j++) av += A[i * n + j] * vectors[j * n + k];
      maxRes = Math.max(maxRes, Math.abs(av - values[k] * vectors[i * n + k]));
    }
  }
  // NNC 自检：与朴素平均连接对比
  const m = 60;
  const P = new Float64Array(m * m);
  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  const pts: number[][] = Array.from({ length: m }, () => [rnd(), rnd(), rnd()]);
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    let dd = 0; for (let k = 0; k < 3; k++) dd += (pts[i][k] - pts[j][k]) ** 2;
    const v = Math.sqrt(dd); P[i * m + j] = v; P[j * m + i] = v;
  }
  const a1 = averageLinkageNNC(m, Float32Array.from(P), 5).labels;
  const a2 = averageLinkageNaive(m, Float32Array.from(P), 5);
  const rand = ari(a1, a2);
  log(`  Jacobi self-check: max |A·v - λv| = ${maxRes.toExponential(2)}`);
  log(`  NNC vs naive average linkage (n=60, 3D random points, K=5) ARI = ${rand.toFixed(4)} (should be 1)`);
  RESULT.selfcheck = { jacobiMaxResidual: maxRes, nncVsNaiveARI: rand };
}

hr("1. Data scale and missing-data handling");
const COVERAGE = 0.8;
const COHORT: Record<RunKey, Cohort> = {
  pro: buildCohort("pro", { coverage: COVERAGE, fill: "interp", excludeMechanical: false }),
  flash: buildCohort("flash", { coverage: COVERAGE, fill: "interp", excludeMechanical: false }),
};
for (const run of ["pro", "flash"] as RunKey[]) {
  const R = RUNS[run], C = COHORT[run];
  const keys = Object.keys(R.series);
  const totalCells = keys.length * R.N;
  let nullCells = 0;
  for (const k of keys) for (const v of R.series[k].slice(0, R.N)) if (v === null || !Number.isFinite(v as number)) nullCells++;
  log(`  ${run}: metrics ${keys.length} × steps ${R.N}; raw null ${nullCells}/${totalCells} = ${(100 * nullCells / totalCells).toFixed(2)}%`);
  log(`    coverage ≥${COVERAGE} and non-constant → analyzed ${C.d}; dropped for low coverage ${C.dropped.lowCoverage}; constant (zero variance) dropped ${C.dropped.constant.length}`);
  const cc = C.dropped.constant;
  const zeroLike = cc.filter(k => {
    const R2 = RUNS[run]; const v = R2.series[k].slice(0, R2.N).filter(x => x !== null) as number[];
    return v.every(x => x === 0);
  }).length;
  log(`    constant metrics identically 0: ${zeroLike} (e.g. pg_clipfrac / ppo_kl family)`);
  const constFam: Record<string, number> = {};
  for (const k of cc) constFam[familyOf(k)] = (constFam[familyOf(k)] ?? 0) + 1;
  log(`    constant metrics by family: ${Object.entries(constFam).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, b]) => `${a}×${b}`).join(", ")}`);
  // 时间轴代理：与步序号几乎共线的指标
  const tIdx = new Float64Array(R.N);
  for (let i = 0; i < R.N; i++) tIdx[i] = i;
  const trendCount = (thr: number) => { let n = 0; for (let j = 0; j < C.d; j++) if (Math.abs(pearson(C.Z.subarray(j * R.N, j * R.N + R.N), tIdx)) >= thr) n++; return n; };
  log(`    metrics with |corr| vs step index ≥0.95: ${trendCount(0.95)} (${(100 * trendCount(0.95) / C.d).toFixed(1)}%); ≥0.99: ${trendCount(0.99)}`);
  RESULT[`cohort_${run}`] = {
    n_indicators_raw: keys.length, n_steps: R.N, null_cells: nullCells, total_cells: totalCells,
    coverage_threshold: COVERAGE, n_analyzed: C.d, n_dropped_low_coverage: C.dropped.lowCoverage,
    n_dropped_constant: cc.length, n_constant_all_zero: zeroLike,
    n_constant_by_family: constFam,
    n_trendlike_095: trendCount(0.95), n_trendlike_099: trendCount(0.99),
    constant_examples: cc.slice(0, 8),
  };
}

hr("2. Mechanical identity checks (these structures are not findings)");
const identityChecks: Record<string, any> = {};
{
  for (const run of ["pro", "flash"] as RunKey[]) {
    const R = RUNS[run], ks = Object.keys(R.series), N = R.N;
    // ctx_total = prompt + response
    let maxRes = 0, worst = "", pairs = 0;
    for (const k of ks) {
      const mm = k.match(/^ctx_total_length\/(.+)\/mean$/);
      if (!mm) continue;
      const p = `ctx_prompt_length/${mm[1]}/mean`, r = `ctx_response_length/${mm[1]}/mean`;
      if (!(p in R.series) || !(r in R.series)) continue;
      pairs++;
      for (let i = 0; i < N; i++) {
        const a = R.series[k][i], b = R.series[p][i], c = R.series[r][i];
        if (a == null || b == null || c == null) continue;
        const dd = Math.abs((a as number) - ((b as number) + (c as number)));
        if (dd > maxRes) { maxRes = dd; worst = `${k}@step${i + 1}`; }
      }
    }
    // Σ frac = 1
    const buckets = new Set<string>();
    for (const k of ks) { const m2 = k.match(/^partial\/(\d+)\/frac$/); if (m2) buckets.add(m2[1]); }
    let maxFracDev = 0;
    for (let i = 0; i < N; i++) {
      let s = 0, cnt = 0;
      for (const b of buckets) { const v = R.series[`partial/${b}/frac`][i]; if (v != null) { s += v as number; cnt++; } }
      if (cnt > 0) maxFracDev = Math.max(maxFracDev, Math.abs(s - 1));
    }
    // 全局 KL = Σ frac·KL
    let maxKlDev = 0, klRel = 0;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const b of buckets) {
        const f = R.series[`partial/${b}/frac`][i], kl = R.series[`partial/${b}/train_infer_diff/new_infer/kl`]?.[i];
        if (f != null && kl != null) s += (f as number) * (kl as number);
      }
      const g = R.series["train_infer_diff/new_infer/kl"]?.[i];
      if (g != null) { maxKlDev = Math.max(maxKlDev, Math.abs(s - (g as number))); klRel = Math.max(klRel, Math.abs(s - (g as number)) / Math.abs(g as number)); }
    }
    log(`  ${run}: ctx_total identity ${pairs} groups, max residual ${maxRes.toPrecision(3)} token (${worst}); Σfrac=1 max deviation ${maxFracDev.toExponential(2)}; global KL=Σfrac·KL max abs deviation ${maxKlDev.toExponential(2)} (relative ${(100 * klRel).toFixed(3)}%)`);
    identityChecks[run] = { ctx_pairs: pairs, ctx_max_abs_residual: maxRes, ctx_worst: worst, frac_sum_max_dev: maxFracDev, kl_weighted_max_abs_dev: maxKlDev, kl_weighted_max_rel_dev: klRel, n_buckets: buckets.size };
  }
}
RESULT.identities = identityChecks;

// ---- 主 PCA（含机械家族）
hr("3. Effective dimensionality: eigenvalue spectrum, explained variance, participation ratio");
const PCA: Record<RunKey, PcaResult> = { pro: pca(COHORT.pro.Z, COHORT.pro.d, COHORT.pro.N), flash: pca(COHORT.flash.Z, COHORT.flash.d, COHORT.flash.N) };
const COHORT_NOMECH: Record<RunKey, Cohort> = {
  pro: buildCohort("pro", { coverage: COVERAGE, fill: "interp", excludeMechanical: true }),
  flash: buildCohort("flash", { coverage: COVERAGE, fill: "interp", excludeMechanical: true }),
};
const PCA_NOMECH: Record<RunKey, PcaResult> = {
  pro: pca(COHORT_NOMECH.pro.Z, COHORT_NOMECH.pro.d, COHORT_NOMECH.pro.N),
  flash: pca(COHORT_NOMECH.flash.Z, COHORT_NOMECH.flash.d, COHORT_NOMECH.flash.N),
};
for (const run of ["pro", "flash"] as RunKey[]) {
  const P = PCA[run], C = COHORT[run], R = RUNS[run];
  log(`  ${run} (d=${C.d}, N=${R.N})`);
  log(`    top 5 component explained variance: ${Array.from(P.frac.slice(0, 5)).map(x => (100 * x).toFixed(1) + "%").join(" / ")}`);
  log(`    cumulative: PC1 ${(100 * P.cum[0]).toFixed(1)}%, PC2 ${(100 * P.cum[1]).toFixed(1)}%, PC3 ${(100 * P.cum[2]).toFixed(1)}%`);
  log(`    80% explained needs ${P.n80} components, 90% needs ${P.n90}, 95% needs ${P.n95} (at most ${R.N - 1} non-zero)`);
  log(`    participation ratio PR = (Σλ)²/Σλ² = ${P.PR.toFixed(2)}  → effective dof about ${P.PR.toFixed(1)}`);
  log(`    pure-noise upper edge (1+√(d/(N-1)))² = ${P.noiseEdge.toFixed(1)} (λ units); components above it ${P.nAboveNoise}`);
  log(`    eigenvalues 1/2/3/5/10 = ${Array.from(P.values.slice(0, 10)).map(v => v.toFixed(1)).join(" / ")}`);
  const S5 = pcScores(C.Z, C.d, C.N, P, 5);
  const trend: number[] = [];
  for (let k = 0; k < 5; k++) {
    const v = new Float64Array(R.N), t = new Float64Array(R.N);
    for (let s = 0; s < R.N; s++) { v[s] = S5[s * 5 + k]; t[s] = s; }
    trend.push(pearson(v, t));
  }
  log(`    |corr| of PC1-5 scores vs step index: ${trend.map(x => Math.abs(x).toFixed(3)).join(" / ")} (closer to 1 means more like the "time axis itself")`);
  RESULT[`pca_${run}`] = {
    d: C.d, N: R.N,
    eigenvalues_top20: Array.from(P.values.slice(0, 20)),
    frac_top10: Array.from(P.frac.slice(0, 10)), cum_top10: Array.from(P.cum.slice(0, 10)),
    n80: P.n80, n90: P.n90, n95: P.n95, PR: P.PR, noise_edge: P.noiseEdge, n_above_noise: P.nAboveNoise,
    trend_corr_pc1_5: trend,
  };
  const Pn = PCA_NOMECH[run];
  log(`    after excluding mechanical families (ctx_total / partial frac / partial n_tokens) d=${Pn.d}: PC1 ${(100 * Pn.frac[0]).toFixed(1)}%, n80=${Pn.n80}, n90=${Pn.n90}, PR=${Pn.PR.toFixed(2)}, above-noise components ${Pn.nAboveNoise}`);
  RESULT[`pca_nomech_${run}`] = { d: Pn.d, n80: Pn.n80, n90: Pn.n90, PR: Pn.PR, frac_top5: Array.from(Pn.frac.slice(0, 5)), n_above_noise: Pn.nAboveNoise };
}

// ---- 载荷
hr("4. Loadings and candidate naming for the top 5 components");
function topLoadings(run: RunKey, P: PcaResult, C: Cohort, k: number, topN = 15) {
  const idx = Array.from({ length: C.d }, (_, i) => i)
    .sort((a, b) => Math.abs(P.loadings[k * C.d + b]) - Math.abs(P.loadings[k * C.d + a])).slice(0, topN);
  return idx.map(i => ({ key: C.names[i], loading: P.loadings[k * C.d + i], group: groupOf(C.names[i]), family: familyOf(C.names[i]) }));
}
const LOADINGS: Record<string, any> = {};
for (const run of ["pro", "flash"] as RunKey[]) {
  const P = PCA[run], C = COHORT[run];
  LOADINGS[run] = [];
  const famAgg: Record<string, any> = {};
  const famEnrich: Record<string, any> = {};
  for (let k = 0; k < 5; k++) {
    const top = topLoadings(run, P, C, k);
    const famCount: Record<string, number> = {}, grpCount: Record<string, number> = {};
    for (const t of top) { famCount[t.family] = (famCount[t.family] ?? 0) + 1; grpCount[t.group] = (grpCount[t.group] ?? 0) + 1; }
    // 全体载荷的族集中度：该 PC 上每族 Σ载荷² 占比 + 富集倍数（相对该族在 cohort 中的规模占比）
    const m = new Map<string, number>();
    const famSize = new Map<string, number>();
    for (let j = 0; j < C.d; j++) {
      const f = familyOf(C.names[j]);
      m.set(f, (m.get(f) ?? 0) + P.loadings[k * C.d + j] ** 2);
      famSize.set(f, (famSize.get(f) ?? 0) + 1);
    }
    const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
    famAgg[`PC${k + 1}`] = Object.fromEntries(Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, b]) => [a, +(b / tot).toFixed(4)]));
    const enrich = Array.from(m.entries())
      .map(([f, v]) => ({ family: f, size: famSize.get(f)!, share: v / tot, enrichment: (v / tot) / (famSize.get(f)! / C.d) }))
      .filter(x => x.size >= 5)
      .sort((a, b) => b.enrichment - a.enrichment).slice(0, 8);
    famEnrich[`PC${k + 1}`] = enrich;
    let nPos = 0, sumL = 0;
    for (let j = 0; j < C.d; j++) { if (P.loadings[k * C.d + j] > 0) nPos++; sumL += P.loadings[k * C.d + j]; }
    const posFrac = nPos / C.d;
    log(`  ${run} PC${k + 1} (${(100 * P.frac[k]).toFixed(1)}% variance, positive loadings ${(100 * posFrac).toFixed(0)}%) | top 15 loadings:`);
    for (const t of top) log(`      ${t.loading >= 0 ? "+" : ""}${t.loading.toFixed(3)}  ${t.key}   [${t.group}]`);
    log(`      family distribution: ${Object.entries(famCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, b]) => `${a}×${b}`).join(", ")}`);
    log(`      families contributing most variance to this component (Σloading²): ${Object.entries(famAgg[`PC${k + 1}`]).map(([a, b]) => `${a} ${(100 * (b as number)).toFixed(1)}%`).join("; ")}`);
    log(`      most "over-represented" families (enrichment = loading share / size share): ${enrich.map(e => `${e.family} ×${e.enrichment.toFixed(1)}(${e.size})`).join("; ")}`);
    LOADINGS[run].push({ pc: k + 1, var_frac: P.frac[k], pos_loading_frac: posFrac, loading_sum: sumL, top15: top, family_hist_top15: famCount, group_hist_top15: grpCount, family_variance_share: famAgg[`PC${k + 1}`], family_enrichment: enrich });
  }
  LOADINGS[run].famAgg = famAgg;
}
RESULT.loadings = LOADINGS;

// ---- ctx 三兄弟：标准化之后还是不是"同一个信号"
hr("4b. How much redundancy remains in z-space for identity families");
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const C = COHORT[run], R = RUNS[run];
    const idx = new Map<string, number>();
    C.names.forEach((n, i) => idx.set(n, i));
    const rows: any[] = [];
    for (const k of C.names) {
      const m = k.match(/^ctx_total_length\/(.+)\/mean$/);
      if (!m) continue;
      const p = `ctx_prompt_length/${m[1]}/mean`, r = `ctx_response_length/${m[1]}/mean`;
      if (!idx.has(p) || !idx.has(r)) continue;
      const col = (key: string) => { const i = idx.get(key)!; return C.Z.subarray(i * C.N, i * C.N + C.N); };
      rows.push({ dataset: m[1], rho_total_prompt: pearson(col(k), col(p)), rho_total_response: pearson(col(k), col(r)), rho_prompt_response: pearson(col(p), col(r)) });
    }
    const avg = (f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
    log(`  ${run}: pairwise correlations of the three ctx siblings in z-space (${rows.length} groups): total~prompt ${avg(r => r.rho_total_prompt).toFixed(3)}, total~response ${avg(r => r.rho_total_response).toFixed(3)}, prompt~response ${avg(r => r.rho_prompt_response).toFixed(3)}`);
    out[run] = { n_datasets: rows.length, mean_rho: { total_prompt: avg(r => r.rho_total_prompt), total_response: avg(r => r.rho_total_response), prompt_response: avg(r => r.rho_prompt_response) }, rows };
  }
  RESULT.ctx_trio = out;
}

// ---- 冗余结构：层次聚类
hr("5. Redundancy structure: average-linkage hierarchical clustering (distance 1-|ρ|)");
const DETREND: Record<RunKey, Cohort> = { pro: detrendCohort(COHORT.pro), flash: detrendCohort(COHORT.flash) };
const CLUSTERS: Record<string, any> = {};
const DIST: Record<RunKey, Float32Array> = {} as any;
const DIST_DET: Record<RunKey, Float32Array> = {} as any;

function distMatrix(C: Cohort) {
  const { d, N, Z } = C;
  const D = new Float32Array(d * d);
  for (let i = 0; i < d; i++) {
    const oi = i * N;
    for (let j = i + 1; j < d; j++) {
      const oj = j * N;
      let s = 0;
      for (let s2 = 0; s2 < N; s2++) s += Z[oi + s2] * Z[oj + s2];
      const rho = s / N;
      const v = 1 - Math.abs(rho);
      D[i * d + j] = v; D[j * d + i] = v;
    }
  }
  return D;
}

for (const run of ["pro", "flash"] as RunKey[]) {
  const C = COHORT[run], d = C.d;
  const t = Date.now();
  const D = distMatrix(C);
  DIST[run] = D;
  const DD = distMatrix(DETREND[run]);
  DIST_DET[run] = DD;
  // (a) 原始 |ρ| 分布 + 近重复连通分量
  const rhos: number[] = [];
  let cnt98 = 0, cnt95 = 0, cnt90 = 0, cnt80 = 0;
  for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) {
    const a = 1 - D[i * d + j];
    rhos.push(a);
    if (a >= 0.98) cnt98++; else if (a >= 0.95) cnt95++; else if (a >= 0.9) cnt90++; else if (a >= 0.8) cnt80++;
  }
  rhos.sort((a, b) => a - b);
  const npairs = rhos.length;
  log(`  ${run} raw |ρ| (${(npairs / 1e6).toFixed(2)}M pairs): median ${quantile(rhos, 0.5).toFixed(3)}, quartiles [${quantile(rhos, 0.25).toFixed(3)}, ${quantile(rhos, 0.75).toFixed(3)}]`);
  log(`    pairs with |ρ|≥0.98 ${(100 * cnt98 / npairs).toFixed(2)}%, ≥0.95 ${(100 * (cnt98 + cnt95) / npairs).toFixed(2)}%, ≥0.90 ${(100 * (cnt98 + cnt95 + cnt90) / npairs).toFixed(2)}%, ≥0.80 ${(100 * (cnt98 + cnt95 + cnt90 + cnt80) / npairs).toFixed(2)}%`);
  // 去趋势后的 |ρ|
  const rhod: number[] = [];
  for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) rhod.push(1 - DD[i * d + j]);
  rhod.sort((a, b) => a - b);
  log(`    (detrended |ρ|: median ${quantile(rhod, 0.5).toFixed(3)}, quartiles [${quantile(rhod, 0.25).toFixed(3)}, ${quantile(rhod, 0.75).toFixed(3)}])`);
  const dupGroups: any[] = [];
  for (const thr of [0.999, 0.99, 0.98, 0.95, 0.9]) {
    const g = nearDuplicateGroups(C, D, thr);
    dupGroups.push(g);
    const big = g.sizes.filter(s => s >= 3).length;
    log(`    |ρ|≥${thr}: ${g.n_groups} groups, largest ${g.sizes[0] ?? 0} metrics; groups with size≥3: ${big}; e.g. ${g.top_groups[0]?.example ?? "-"} (${g.top_groups[0]?.size ?? 0})`);
  }
  // (b) 原始相关聚类
  const Lraw = averageLinkageNNC(d, D, 12);
  const rawSizes = new Array(Lraw.K).fill(0);
  for (let i = 0; i < d; i++) rawSizes[Lraw.labels[i]]++;
  rawSizes.sort((a, b) => b - a);
  log(`    raw-correlation clustering K=12: largest cluster ${rawSizes[0]}/${d} = ${(100 * rawSizes[0] / d).toFixed(1)}%; cluster sizes ${rawSizes.join(", ")}`);
  log(`    top-level merge heights (1-|ρ|): ${Lraw.merges.slice(-10).map((m: any) => m.h.toFixed(3)).join(" ")} (all above 0.7, so no clean block structure)`);
  // (c) 去趋势聚类
  const L = averageLinkageNNC(d, DD, 15);
  const buckets: number[][] = Array.from({ length: L.K }, () => []);
  for (let i = 0; i < d; i++) buckets[L.labels[i]].push(i);
  const summarise = (members: number[]) => {
    let best = members[0], bestScore = Infinity;
    const scoreOf = new Map<number, number>();
    for (const i of members) {
      let s = 0;
      for (const j of members) if (i !== j) s += DD[i * d + j];
      const sc = s / Math.max(1, members.length - 1);
      scoreOf.set(i, sc);
      if (sc < bestScore) { bestScore = sc; best = i; }
    }
    const isRoot = (k: string) => !/dataset-/.test(k) && !/^partial\/\d+\//.test(k) && !/harness-[A-D]/.test(k);
    const roots = members.filter(i => isRoot(C.names[i]));
    let pick = best, pickNote = "medoid";
    if (roots.length > 0) {
      let rb = roots[0], rs = Infinity;
      for (const i of roots) { const sc = scoreOf.get(i)!; if (sc < rs) { rs = sc; rb = i; } }
      pick = rb; pickNote = "根级聚合指标";
    }
    const fam: Record<string, number> = {}, grp: Record<string, number> = {};
    for (const i of members) { fam[familyOf(C.names[i])] = (fam[familyOf(C.names[i])] ?? 0) + 1; grp[groupOf(C.names[i])] = (grp[groupOf(C.names[i])] ?? 0) + 1; }
    return {
      size: members.length, medoid: C.names[best], medoid_family: familyOf(C.names[best]), medoid_group: groupOf(C.names[best]),
      n_root_level: roots.length,
      representative: C.names[pick], representative_family: familyOf(C.names[pick]), representative_group: groupOf(C.names[pick]), representative_note: pickNote,
      internal_mean_abs_rho: 1 - bestScore,
      top_families: Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 5),
      top_groups: Object.entries(grp).sort((a, b) => b[1] - a[1]).slice(0, 3),
      sample_members: members.slice(0, 8).map(i => C.names[i]),
      members: members.map(i => C.names[i]),
      internal_mean_dist: bestScore,
    };
  };
  const blocks = buckets.map(summarise).sort((a, b) => b.size - a.size);
  log(`  ${run} detrended clustering K=${L.K} (sorted by size, ${d} metrics total):`);
  for (const b of blocks) {
    log(`    n=${String(b.size).padStart(4)}  rep ${b.representative}${b.representative_note === "medoid" ? "" : " (root-level)"}  [${b.representative_group}]`);
    log(`          families: ${b.top_families.map(([a, c]) => `${a}(${c})`).join(", ")}`);
  }
  const sizesAt: Record<string, number[]> = {};
  for (const K of [8, 12]) {
    const LK = averageLinkageNNC(d, DD, K);
    const cnt = new Array(LK.K).fill(0);
    for (let i = 0; i < d; i++) cnt[LK.labels[i]]++;
    sizesAt[`K${K}`] = cnt.sort((a, b) => b - a);
  }
  // (d) 同一信号的不同副本：键只差"切片段"（数据集 id / harness 字母 / 新鲜度桶 / 类别）的指标
  const copyKey = (k: string) => normalizeKey(k).replace(/harness-[A-Z]/g, "harness-<x>");
  const byCopy = new Map<string, number[]>();
  for (let i = 0; i < d; i++) {
    const ck = copyKey(C.names[i]);
    if (!byCopy.has(ck)) byCopy.set(ck, []);
    byCopy.get(ck)!.push(i);
  }
  const copyGroups = Array.from(byCopy.entries()).filter(([, m]) => m.length >= 3).map(([ck, m]) => {
    let sRaw = 0, sDet = 0, np = 0;
    for (let a = 0; a < m.length; a++) for (let b = a + 1; b < m.length; b++) {
      sRaw += 1 - D[m[a] * d + m[b]];
      sDet += 1 - DD[m[a] * d + m[b]];
      np++;
    }
    return { copy_key: ck, copies: m.length, n_pairs: np, mean_abs_rho_raw: sRaw / np, mean_abs_rho_detrended: sDet / np, example: C.names[m[0]] };
  }).sort((a, b) => b.copies - a.copies || b.mean_abs_rho_raw - a.mean_abs_rho_raw);
  const copyIndicators = copyGroups.reduce((a, g) => a + g.copies, 0);
  log(`    "same-signal copy groups" differing only by slicing segment (≥3 members): ${copyGroups.length} groups, covering ${copyIndicators}/${d} = ${(100 * copyIndicators / d).toFixed(1)}% of metrics; median within-group mean |ρ| ${quantile(copyGroups.map(g => g.mean_abs_rho_raw).sort((a, b) => a - b), 0.5).toFixed(3)}`);
  for (const g of copyGroups.slice(0, 8)) log(`      ${g.copy_key}  ×${g.copies}  raw |ρ| ${g.mean_abs_rho_raw.toFixed(3)} / detrended ${g.mean_abs_rho_detrended.toFixed(3)}   e.g. ${g.example}`);
  CLUSTERS[run] = {
    d, raw_sizes_K12: rawSizes, raw_merge_heights_tail: Lraw.merges.slice(-20).map((m: any) => +m.h.toFixed(4)),
    rho_stats: { median: quantile(rhos, 0.5), q25: quantile(rhos, 0.25), q75: quantile(rhos, 0.75), frac_ge_098: cnt98 / npairs, frac_ge_095: (cnt98 + cnt95) / npairs, frac_ge_090: (cnt98 + cnt95 + cnt90) / npairs, frac_ge_080: (cnt98 + cnt95 + cnt90 + cnt80) / npairs, detrended_median: quantile(rhod, 0.5) },
    near_duplicate_groups: dupGroups,
    copy_groups: { n_groups: copyGroups.length, n_indicators: copyIndicators, median_mean_abs_rho_raw: quantile(copyGroups.map(g => g.mean_abs_rho_raw).sort((a, b) => a - b), 0.5), top: copyGroups.slice(0, 20) },
    K: L.K, detrended_merge_heights_tail: L.merges.slice(-20).map((m: any) => +m.h.toFixed(4)),
    blocks, sizes_at_K: sizesAt,
    labels: Array.from(L.labels), names: C.names,
  };
}
RESULT.clusters = {
  pro: { ...CLUSTERS.pro, labels: undefined, names: undefined, blocks: CLUSTERS.pro.blocks.map((b: any) => ({ ...b, members: undefined })) },
  flash: { ...CLUSTERS.flash, labels: undefined, names: undefined, blocks: CLUSTERS.flash.blocks.map((b: any) => ({ ...b, members: undefined })) },
};


// ---- 最小指标集
hr("6. Minimum indicator count: variance-greedy forward selection and cluster representatives");
// 目标：用 k 个指标张成的子空间去逼近整张 d×N 矩阵 Z 的列空间。
// 解释方差占比 = Σ_d (||z_d||² − ||残差_d||²) / (d·N)。
// 贪心准则：每一步选"残差方向"的 Rayleigh 商 r_jᵀ(M)r_j/(r_jᵀ r_j) 最大的候选（M = RᵀR，R 为去掉已选子空间后的残差矩阵）。
function greedyBasis(C: Cohort, pool: number[], k: number) {
  const N = C.N, d = C.d;
  const R = Float64Array.from(C.Z);
  const picked: number[] = [], capture: number[] = [], gain: number[] = [];
  const totalVar = d * N;
  const M = new Float64Array(N * N);
  const recomputeM = () => {
    M.fill(0);
    for (let j = 0; j < d; j++) {
      const o = j * N;
      for (let a = 0; a < N; a++) {
        const va = R[o + a];
        if (va === 0) continue;
        for (let b = a; b < N; b++) M[a * N + b] += va * R[o + b];
      }
    }
    for (let a = 0; a < N; a++) for (let b = 0; b < a; b++) M[a * N + b] = M[b * N + a];
  };
  const capturedNow = () => {
    let acc = 0;
    for (let j = 0; j < d; j++) {
      const o = j * N;
      for (let s = 0; s < N; s++) { const z = C.Z[o + s], r = R[o + s]; acc += z * z - r * r; }
    }
    return acc / totalVar;
  };
  let prev = 0;
  for (let step = 0; step < k; step++) {
    recomputeM();
    let bestJ = -1, bestQ = -Infinity;
    const inPicked = new Set(picked);
    for (const j of pool) {
      if (inPicked.has(j)) continue;
      const o = j * N;
      let rn = 0, num = 0;
      for (let a = 0; a < N; a++) rn += R[o + a] * R[o + a];
      if (rn <= 1e-12) continue;
      for (let a = 0; a < N; a++) {
        let rowsum = 0;
        const oa = a * N;
        for (let b = 0; b < N; b++) rowsum += M[oa + b] * R[o + b];
        num += R[o + a] * rowsum;
      }
      const q = num / rn;
      if (q > bestQ) { bestQ = q; bestJ = j; }
    }
    if (bestJ < 0) break;
    const o = bestJ * N;
    let rn = 0; for (let a = 0; a < N; a++) rn += R[o + a] ** 2;
    rn = Math.sqrt(rn) || 1;
    const u = new Float64Array(N);
    for (let a = 0; a < N; a++) u[a] = R[o + a] / rn;
    for (let j = 0; j < d; j++) {
      const oj = j * N;
      let dot = 0;
      for (let a = 0; a < N; a++) dot += R[oj + a] * u[a];
      for (let a = 0; a < N; a++) R[oj + a] -= dot * u[a];
    }
    picked.push(bestJ);
    const cap = capturedNow();
    capture.push(cap); gain.push(cap - prev); prev = cap;
  }
  return { picked, capture, gain };
}
const MINIMAL: Record<string, any> = {};
for (const run of ["pro", "flash"] as RunKey[]) {
  const C = COHORT[run];
  const all = Array.from({ length: C.d }, (_, i) => i);
  const isRootKey = (k: string) => !/dataset-/.test(k) && !/^partial\/\d+\//.test(k) && !/harness-[A-Z]/.test(k);
  const rootPool = all.filter(i => isRootKey(C.names[i]));
  const labels = CLUSTERS[run].labels as number[];
  const clusterSizeOf = (i: number) => labels.filter(l => l === labels[i]).length;
  const gAll = greedyBasis(C, all, 20);
  const gRoot = greedyBasis(C, rootPool, 20);
  const fmt = (g: typeof gAll) => g.picked.map((j, i) => ({ rank: i + 1, key: C.names[j], group: groupOf(C.names[j]), family: familyOf(C.names[j]), cluster_size: clusterSizeOf(j), marginal_capture: g.gain[i], cumulative_capture: g.capture[i] }));
  log(`  ${run} variance-greedy forward selection over all ${C.d} metrics:`);
  log(`    cumulative explained variance at metrics 5/10/15/20: ${[4, 9, 14, 19].map(i => (100 * gAll.capture[i]).toFixed(1) + "%").join(" / ")}`);
  gAll.picked.forEach((j, i) => log(`      ${String(i + 1).padStart(2)}. ${C.names[j]}  [+${(100 * gAll.gain[i]).toFixed(1)}pp]`));
  log(`  using only "root-level aggregate metrics" (${rootPool.length} candidates): cumulative at 5/10/15/20 ${[4, 9, 14, 19].map(i => (100 * gRoot.capture[i]).toFixed(1) + "%").join(" / ")}`);
  gRoot.picked.forEach((j, i) => log(`      ${String(i + 1).padStart(2)}. ${C.names[j]}  [+${(100 * gRoot.gain[i]).toFixed(1)}pp]`));
  const blocks = CLUSTERS[run].blocks as any[];
  log(`  ${blocks.length} detrended clusters (representative / within-cluster mean |ρ|):`);
  blocks.forEach((b, i) => log(`      ${String(i + 1).padStart(2)}. n=${String(b.size).padStart(4)} mean |ρ| ${b.internal_mean_abs_rho.toFixed(3)}  ${b.representative}  [${b.representative_group}]`));
  MINIMAL[run] = {
    n_indicators: C.d, n_root_level_candidates: rootPool.length,
    greedy_all_k20: fmt(gAll),
    greedy_root_k20: fmt(gRoot),
    capture_all: gAll.capture, capture_root: gRoot.capture,
    cluster_representatives: blocks.map(b => ({ size: b.size, internal_mean_abs_rho: b.internal_mean_abs_rho, representative: b.representative, group: b.representative_group, top_families: b.top_families })),
  };
}
RESULT.minimal_set = MINIMAL;

// ---- 稳健性
hr("7. Robustness checks");
const ROBUST: Record<string, any> = {};

// (a) 覆盖率阈值 / 缺失填充口径
{
  const variants: Record<string, any> = {};
  for (const cv of [0.8, 0.95, 1.0]) {
    for (const fill of ["interp", "mean"] as const) {
      for (const run of ["pro", "flash"] as RunKey[]) {
        const c = buildCohort(run, { coverage: cv, fill, excludeMechanical: false });
        const p = pca(c.Z, c.d, c.N);
        const key = `${run}|cov${cv}|${fill}`;
        variants[key] = { d: c.d, frac1: p.frac[0], frac2: p.frac[1], frac3: p.frac[2], n80: p.n80, n90: p.n90, PR: p.PR, nAboveNoise: p.nAboveNoise };
        log(`  ${key}: d=${c.d}  PC1=${(100 * p.frac[0]).toFixed(1)}% PC2=${(100 * p.frac[1]).toFixed(1)}% PC3=${(100 * p.frac[2]).toFixed(1)}%  n80=${p.n80} n90=${p.n90} PR=${p.PR.toFixed(2)} above-noise=${p.nAboveNoise}`);
      }
    }
  }
  ROBUST.missing_variants = variants;
}

// (a2) 把 flash 截到前 24 步，和 pro 的 24 步做同样点数的对比（n80/PR 受步数上限影响，必须对齐步数才能比）
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const c0 = buildCohort(run, { coverage: 0.8, fill: "interp", excludeMechanical: false });
    const NB = 24;
    const c = { ...c0, N: NB };
    const Z = new Float64Array(c0.d * NB);
    for (let j = 0; j < c0.d; j++) {
      const col = new Float64Array(NB);
      for (let s = 0; s < NB; s++) col[s] = c0.Z[j * c0.N + s];
      let m = 0; for (let s = 0; s < NB; s++) m += col[s]; m /= NB;
      let ss = 0; for (let s = 0; s < NB; s++) ss += (col[s] - m) ** 2;
      const sd = Math.sqrt(ss / NB) || 1;
      for (let s = 0; s < NB; s++) Z[j * NB + s] = (col[s] - m) / sd;
    }
    const p = pca(Z, c0.d, NB);
    out[run] = { d: c0.d, N: NB, frac_top5: Array.from(p.frac.slice(0, 5)), n80: p.n80, n90: p.n90, PR: p.PR, nAboveNoise: p.nAboveNoise };
    log(`  aligned to 24 steps (${run}): d=${c0.d} PC1=${(100 * p.frac[0]).toFixed(1)}% PC2=${(100 * p.frac[1]).toFixed(1)}% n80=${p.n80} n90=${p.n90} PR=${p.PR.toFixed(2)}`);
  }
  ROBUST.aligned_24_steps = out;
}

// (b) Spearman（秩相关）
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const R = RUNS[run];
    const c = buildCohort(run, { coverage: 0.8, fill: "interp", excludeMechanical: false });
    const Z = new Float64Array(c.d * c.N);
    for (let j = 0; j < c.d; j++) {
      const col = new Float64Array(c.N);
      for (let s = 0; s < c.N; s++) col[s] = c.Z[j * c.N + s];
      const r = ranks(col);
      let m = 0; for (let s = 0; s < c.N; s++) m += r[s]; m /= c.N;
      let ss = 0; for (let s = 0; s < c.N; s++) ss += (r[s] - m) ** 2;
      const sd = Math.sqrt(ss / c.N) || 1;
      for (let s = 0; s < c.N; s++) Z[j * c.N + s] = (r[s] - m) / sd;
    }
    const p = pca(Z, c.d, c.N);
    out[run] = { d: c.d, frac_top5: Array.from(p.frac.slice(0, 5)), n80: p.n80, n90: p.n90, PR: p.PR, nAboveNoise: p.nAboveNoise };
    log(`  Spearman(${run}): d=${c.d} PC1=${(100 * p.frac[0]).toFixed(1)}% n80=${p.n80} n90=${p.n90} PR=${p.PR.toFixed(2)} above-noise=${p.nAboveNoise}`);
  }
  ROBUST.spearman = out;
}

// (c) 指标 bootstrap（重采样指标，看谱的抽样波动）
{
  const out: Record<string, any> = {};
  const B = 200;
  for (const run of ["pro", "flash"] as RunKey[]) {
    const c = buildCohort(run, { coverage: 0.8, fill: "interp", excludeMechanical: false });
    const d = c.d, N = c.N;
    const rng = (() => { let s = 987654321; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
    const f1: number[] = [], pr: number[] = [], n80: number[] = [], n90: number[] = [];
    for (let b = 0; b < B; b++) {
      const w = new Float64Array(d);
      for (let i = 0; i < d; i++) w[Math.floor(rng() * d)]++;
      const G = new Float64Array(N * N);
      for (let j = 0; j < d; j++) {
        const wt = w[j]; if (wt === 0) continue;
        const off = j * N;
        for (let s1 = 0; s1 < N; s1++) {
          const z1 = c.Z[off + s1] * wt;
          for (let s2 = s1; s2 < N; s2++) G[s1 * N + s2] += z1 * c.Z[off + s2];
        }
      }
      for (let s1 = 0; s1 < N; s1++) for (let s2 = 0; s2 < s1; s2++) G[s1 * N + s2] = G[s2 * N + s1];
      const { values } = jacobiEigen(G, N);
      const total = d * N;
      let s1v = 0, s2v = 0;
      for (let k = 0; k < N; k++) { s1v += values[k]; s2v += values[k] * values[k]; }
      f1.push(values[0] / total); pr.push((s1v * s1v) / s2v);
      let acc = 0, a80 = N, a90 = N;
      for (let k = 0; k < N; k++) { acc += values[k] / total; if (acc >= 0.8 && a80 === N) a80 = k + 1; if (acc >= 0.9 && a90 === N) a90 = k + 1; }
      n80.push(a80); n90.push(a90);
    }
    const q = (a: number[], p: number) => quantile(a.slice().sort((x, y) => x - y), p);
    out[run] = {
      B, frac1_median: q(f1, 0.5), frac1_ci90: [q(f1, 0.05), q(f1, 0.95)],
      PR_median: q(pr, 0.5), PR_ci90: [q(pr, 0.05), q(pr, 0.95)],
      n80_median: q(n80, 0.5), n80_range: [q(n80, 0.05), q(n80, 0.95)],
      n90_median: q(n90, 0.5), n90_range: [q(n90, 0.05), q(n90, 0.95)],
    };
    log(`  metric bootstrap (B=${B}, ${run}): PC1 variance share median ${(100 * q(f1, 0.5)).toFixed(1)}% [${(100 * q(f1, 0.05)).toFixed(1)}%, ${(100 * q(f1, 0.95)).toFixed(1)}%]; PR median ${q(pr, 0.5).toFixed(2)} [${q(pr, 0.05).toFixed(2)}, ${q(pr, 0.95).toFixed(2)}]; n80 median ${q(n80, 0.5)} [${q(n80, 0.05)}, ${q(n80, 0.95)}]; n90 median ${q(n90, 0.5)} [${q(n90, 0.05)}, ${q(n90, 0.95)}]`);
  }
  ROBUST.indicator_bootstrap = out;
}

// (d) 留一步（leave-one-step-out）：载荷的 Tucker 同余系数
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const c0 = buildCohort(run, { coverage: 0.8, fill: "interp", excludeMechanical: false });
    const N = c0.N;
    const cos: number[][] = [[], [], []];
    for (let hold = 0; hold < N; hold++) {
      // 构造去掉该步的矩阵（步数 N-1，覆盖率按新步数判定：保持原 cohort 名单）
      const c = buildCohort(run, { coverage: 0.8, fill: "interp", excludeMechanical: false, keys: c0.names });
      // 重新构造 Z：去掉 hold 步
      const d = c0.d, N2 = N - 1;
      const Z2 = new Float64Array(d * N2);
      for (let j = 0; j < d; j++) {
        let m = 0, cnt = 0;
        for (let s = 0; s < N; s++) if (s !== hold) { m += c.Z[j * N + s]; cnt++; }
        m /= cnt;
        let ss = 0;
        for (let s = 0; s < N; s++) if (s !== hold) ss += (c.Z[j * N + s] - m) ** 2;
        const sd = Math.sqrt(ss / cnt) || 1;
        let t = 0;
        for (let s = 0; s < N; s++) if (s !== hold) Z2[j * N2 + t++] = (c.Z[j * N + s] - m) / sd;
      }
      const P = pca(Z2, d, N2);
      for (let k = 0; k < 3; k++) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += P.loadings[k * d + j] * PCA[run].loadings[k * d + j];
        cos[k].push(dot);
      }
    }
    const summ = cos.map(a => {
      const abs = a.map(Math.abs).sort((x, y) => x - y);
      return { min: abs[0], median: quantile(abs, 0.5), max: abs[abs.length - 1] };
    });
    out[run] = { pc_congruence: summ };
    log(`  leave-one-step-out (LOO step, ${run}) loading |cos|: PC1 min ${summ[0].min.toFixed(3)} / median ${summ[0].median.toFixed(3)}; PC2 min ${summ[1].min.toFixed(3)} / median ${summ[1].median.toFixed(3)}; PC3 min ${summ[2].min.toFixed(3)} / median ${summ[2].median.toFixed(3)}`);
  }
  ROBUST.leave_one_step_out = out;
}

// (e) 聚类稳定性：留一步，用"去趋势"相关重跑聚类，与全样本的 ARI
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const c0 = DETREND[run];
    const d = c0.d, N = c0.N;
    const baseL = Int32Array.from(CLUSTERS[run].labels as number[]);
    const aris: number[] = [];
    const t = Date.now();
    for (let hold = 0; hold < N; hold++) {
      const Z2 = new Float64Array(d * (N - 1));
      for (let j = 0; j < d; j++) {
        let m = 0, cnt = 0;
        for (let s = 0; s < N; s++) if (s !== hold) { m += c0.Z[j * N + s]; cnt++; }
        m /= cnt;
        let ss = 0;
        for (let s = 0; s < N; s++) if (s !== hold) ss += (c0.Z[j * N + s] - m) ** 2;
        const sd = Math.sqrt(ss / cnt) || 1;
        let tt = 0;
        for (let s = 0; s < N; s++) if (s !== hold) Z2[j * (N - 1) + tt++] = (c0.Z[j * N + s] - m) / sd;
      }
      const D = distMatrix({ ...c0, Z: Z2, N: N - 1 });
      const L = averageLinkageNNC(d, D, 15);
      aris.push(ari(baseL, L.labels));
    }
    aris.sort((a, b) => a - b);
    out[run] = { n_loo: N, ari_min: aris[0], ari_median: quantile(aris, 0.5), ari_max: aris[aris.length - 1], seconds: (Date.now() - t) / 1000 };
    log(`  cluster stability LOO (${run}, detrended correlation): ARI median ${quantile(aris, 0.5).toFixed(3)}, min ${aris[0].toFixed(3)}, max ${aris[aris.length - 1].toFixed(3)} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  ROBUST.cluster_loo = out;
}
RESULT.robustness = ROBUST;

// ---- 步的阶段性
hr("8. Step regimes: change-point detection on principal-component coordinates");
function wallToStep(run: RunKey, t: number) {
  const walls = RUNS[run].axis.walls as number[];
  let s = 1;
  for (let i = 0; i < walls.length; i++) if (walls[i] <= t) s = i + 2; // 该事件发生时正在跑第 i+2 步
  return Math.min(s, RUNS[run].N);
}
function stepWall(run: RunKey, firstStep: number) { return (RUNS[run].axis.walls as number[])[firstStep - 1]; }
function hours(x: number) { return x / 3600; }

const REGIMES: Record<string, any> = {};
for (const run of ["pro", "flash"] as RunKey[]) {
  const C = COHORT[run], P = PCA[run], N = C.N;
  const kUse = 3;
  const standardizeCols = (X: Float64Array, n: number, k: number) => {
    const out = new Float64Array(n * k);
    for (let c = 0; c < k; c++) {
      let m = 0, sd = 0;
      for (let s = 0; s < n; s++) m += X[s * k + c];
      m /= n;
      for (let s = 0; s < n; s++) sd += (X[s * k + c] - m) ** 2;
      sd = Math.sqrt(sd / n) || 1;
      for (let s = 0; s < n; s++) out[s * k + c] = (X[s * k + c] - m) / sd;
    }
    return out;
  };
  // (i) 原始 PC1..3 坐标（标准化成单位方差）
  const Sz = standardizeCols(pcScores(C.Z, C.d, N, P, kUse), N, kUse);
  // (ii) 去趋势后重做
  const Zd = DETREND[run].Z;
  const Pd = pca(Zd, C.d, N);
  const Sdz = standardizeCols(pcScores(Zd, C.d, N, Pd, kUse), N, kUse);
  const segRaw = binarySegmentation(Sz, N, kUse, 5);
  const segDet = binarySegmentation(Sdz, N, kUse, 5);
  const profRaw = splitProfile(Sz, N, kUse).sort((a, b) => b.stat - a.stat).slice(0, 6);
  const profDet = splitProfile(Sdz, N, kUse).sort((a, b) => b.stat - a.stat).slice(0, 6);
  log(`  ${run} (N=${N} steps)`);
  log(`    raw PC1-3 coordinates greedy binary segmentation change points (new regime starts at that step): ${segRaw.breaks.map(b => b + 1).join(", ") || "none"}; accepted RSS drops ${segRaw.deltas.map(d => d.toFixed(1)).join(", ")}; BIC threshold ${segRaw.penalty.toFixed(2)}`);
  log(`    detrended greedy binary segmentation change points: ${segDet.breaks.map(b => b + 1).join(", ") || "none"}; drops ${segDet.deltas.map(d => d.toFixed(1)).join(", ")}; threshold ${segDet.penalty.toFixed(2)}`);
  log(`    unpenalized position statistic Top6 (raw): ${profRaw.map(p => `step ${p.pos + 1}(${p.stat.toFixed(1)})`).join(", ")}`);
  log(`    unpenalized position statistic Top6 (detrended): ${profDet.map(p => `step ${p.pos + 1}(${p.stat.toFixed(1)})`).join(", ")}`);
  // 运维事件对齐
  const restarts = (RUNS[run].status.events as any[]).filter(e => e.kind === "restart");
  const stepsWithRestart = new Set<number>();
  for (const r of restarts) stepsWithRestart.add(wallToStep(run, r.t));
  const versions = RUNS[run].tags.versions as any[];
  const stepsWithVersion = new Set<number>();
  for (const v of versions) stepsWithVersion.add(wallToStep(run, v.at));
  const noticesForRun = (notices as any[]).filter(n => (n.run === null || n.run === run));
  const noticeSteps = noticesForRun.map(n => ({ t: n.t, step: wallToStep(run, n.t), text: (n.text as string).slice(0, 70) }));
  const align = (b: number) => {
    const stepStart = b + 1;
    const w = stepWall(run, stepStart);
    const nearRestart = Array.from(stepsWithRestart).map(s => ({ s, d: Math.abs(stepWall(run, s) - w) })).sort((a, z) => a.d - z.d)[0];
    const nearVer = versions.map(v => ({ v: v.version, d: Math.abs(v.at - w) })).sort((a, z) => a.d - z.d)[0];
    const nearNotice = noticeSteps.map(n => ({ ...n, d: Math.abs(n.t - w) })).sort((a, z) => a.d - z.d)[0];
    return {
      break_before_step: stepStart,
      wall_hours_from_run_start: +hours(w - RUNS[run].axis.run_start).toFixed(2),
      nearest_restart_step: nearRestart?.s ?? null, nearest_restart_hours: nearRestart ? +hours(nearRestart.d).toFixed(2) : null,
      nearest_version: nearVer?.v ?? null, nearest_version_hours: nearVer ? +hours(nearVer.d).toFixed(2) : null,
      nearest_notice_step: nearNotice?.step ?? null, nearest_notice_hours: nearNotice ? +hours(nearNotice.d).toFixed(2) : null, nearest_notice: nearNotice?.text ?? null,
    };
  };
  // 断点诊断：位移大小、是否回退（运维瞬时冲击 vs 持续台阶）、主导族
  const diagnose = (p: number, X: Float64Array, dim: number) => {
    const a1 = Math.max(0, p - 3), b1 = Math.min(N, p + 3), c1 = N;
    const meanRange = (from: number, to: number) => {
      const m = new Float64Array(dim);
      for (let s = from; s < to; s++) for (let c = 0; c < dim; c++) m[c] += X[s * dim + c];
      for (let c = 0; c < dim; c++) m[c] /= (to - from);
      return m;
    };
    const norm = (v: Float64Array) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    const mPrev = meanRange(a1, p), mNext = meanRange(p, b1), mRest = p + 3 < N ? meanRange(Math.min(p + 3, N), N) : null;
    const dvec = new Float64Array(dim);
    for (let c = 0; c < dim; c++) dvec[c] = mNext[c] - mPrev[c];
    const shift = norm(dvec);
    let reversion: number | null = null;
    if (mRest) { let s2 = 0; for (let c = 0; c < dim; c++) s2 += (mRest[c] - mNext[c]) ** 2; reversion = Math.sqrt(s2) / (shift || 1); }
    // 主导族（用原始 z 空间，前 3 步 vs 后 3 步）
    const famShift: Record<string, { ss: number; n: number }> = {};
    for (let j = 0; j < C.d; j++) {
      let m1 = 0, m2 = 0;
      for (let s = a1; s < p; s++) m1 += C.Z[j * N + s];
      for (let s = p; s < b1; s++) m2 += C.Z[j * N + s];
      m1 /= (p - a1); m2 /= (b1 - p);
      const f = familyOf(C.names[j]);
      famShift[f] ??= { ss: 0, n: 0 };
      famShift[f].ss += (m2 - m1) ** 2; famShift[f].n++;
    }
    const ranked = Object.entries(famShift).map(([f, v]) => ({ family: f, mean_sq_shift: v.ss / v.n, n: v.n })).sort((a, b) => b.mean_sq_shift - a.mean_sq_shift).slice(0, 6);
    return { shift_norm: shift, reversion_ratio: reversion, top_families: ranked };
  };
  const rawDiag = profRaw.slice(0, 4).map(pf => ({ pos: pf.pos, stat: pf.stat, ...diagnose(pf.pos, Sz, kUse), ...align(pf.pos) }));
  const detDiag = profDet.slice(0, 4).map(pf => ({ pos: pf.pos, stat: pf.stat, ...diagnose(pf.pos, Sdz, kUse), ...align(pf.pos) }));
  log(`    candidate change-point diagnostics (raw PC coordinates; reversion≈0 means the new level holds, ≈1 means it returns to the original level within 3 steps):`);
  for (const a of rawDiag) log(`      step ${a.break_before_step}: shift ${a.shift_norm.toFixed(2)}, reversion ratio ${a.reversion_ratio === null ? "-" : a.reversion_ratio.toFixed(2)}; nearest restart step ${a.nearest_restart_step} (${a.nearest_restart_hours}h away); dominant families ${a.top_families.slice(0, 3).map(f => f.family).join(", ")}`);
  log(`    candidate change-point diagnostics (detrended PC coordinates):`);
  for (const a of detDiag) log(`      step ${a.break_before_step}: shift ${a.shift_norm.toFixed(2)}, reversion ratio ${a.reversion_ratio === null ? "-" : a.reversion_ratio.toFixed(2)}; nearest restart step ${a.nearest_restart_step} (${a.nearest_restart_hours}h away); nearest version ${a.nearest_version} (${a.nearest_version_hours}h away); dominant families ${a.top_families.slice(0, 3).map(f => f.family).join(", ")}`);
  const perStep = Array.from({ length: N }, (_, i) => ({
    step: i + 1, restart: stepsWithRestart.has(i + 1), version_switch: stepsWithVersion.has(i + 1),
    wall_hours: +hours(stepWall(run, i + 1) - RUNS[run].axis.run_start).toFixed(2),
  }));
  REGIMES[run] = {
    N,
    raw: { breaks_step: segRaw.breaks.map(b => b + 1), deltas: segRaw.deltas, penalty: segRaw.penalty, profile_top: profRaw, diagnostics: rawDiag, alignment: segRaw.breaks.map(align) },
    detrended: { breaks_step: segDet.breaks.map(b => b + 1), deltas: segDet.deltas, penalty: segDet.penalty, profile_top: profDet, diagnostics: detDiag, alignment: segDet.breaks.map(align) },
    steps_with_restart: Array.from(stepsWithRestart).sort((a, b) => a - b),
    steps_with_version_switch: Array.from(stepsWithVersion).sort((a, b) => a - b),
    notices: noticeSteps, per_step: perStep,
    detrended_pca_frac_top5: Array.from(Pd.frac.slice(0, 5)),
  };
}
RESULT.regimes = REGIMES;

// 8b. 变点是否与"有重启的步"系统性相关（用位置统计量分组比较，而不是只看对齐）
hr("8b. Shift magnitude: restart steps vs non-restart steps, and indicator-set additions/removals");
{
  const out: Record<string, any> = {};
  for (const run of ["pro", "flash"] as RunKey[]) {
    const C = COHORT[run], N = C.N;
    const Zd = DETREND[run].Z;
    const Pdd = pca(Zd, C.d, N);
    const kUse = 3;
    const Sd = pcScores(Zd, C.d, N, Pdd, kUse);
    const Sz = new Float64Array(N * kUse);
    for (let k = 0; k < kUse; k++) {
      let m = 0, sd = 0;
      for (let s = 0; s < N; s++) m += Sd[s * kUse + k];
      m /= N;
      for (let s = 0; s < N; s++) sd += (Sd[s * kUse + k] - m) ** 2;
      sd = Math.sqrt(sd / N) || 1;
      for (let s = 0; s < N; s++) Sz[s * kUse + k] = (Sd[s * kUse + k] - m) / sd;
    }
    const prof = splitProfile(Sz, N, kUse);
    const restartSteps = new Set<number>(REGIMES[run].steps_with_restart as number[]);
    const near = (p: number) => restartSteps.has(p) || restartSteps.has(p + 1) || restartSteps.has(p + 2);
    const withR = prof.filter(x => near(x.pos)).map(x => x.stat).sort((a, b) => a - b);
    const withoutR = prof.filter(x => !near(x.pos)).map(x => x.stat).sort((a, b) => a - b);
    log(`  ${run} detrended position statistic: near restart (within the following 2 steps) median ${quantile(withR, 0.5).toFixed(2)} (n=${withR.length}), others ${quantile(withoutR, 0.5).toFixed(2)} (n=${withoutR.length})`);
    // 指标集增删
    const tags = RUNS[run].tags.tags as Record<string, { first_seen: number; last_seen: number }>;
    const allT = Object.values(tags);
    const tMax = Math.max(...allT.map(x => x.last_seen));
    const tMin = Math.min(...allT.map(x => x.first_seen));
    const retired = Object.entries(tags).filter(([, v]) => v.last_seen < tMax - 1).map(([k, v]) => ({ key: k, last_seen: v.last_seen, step: wallToStep(run, v.last_seen) }));
    const added = Object.entries(tags).filter(([, v]) => v.first_seen > tMin + 1).map(([k, v]) => ({ key: k, first_seen: v.first_seen, step: wallToStep(run, v.first_seen) }));
    const famCount = (arr: { key: string }[]) => {
      const m: Record<string, number> = {};
      for (const a of arr) m[familyOf(a.key)] = (m[familyOf(a.key)] ?? 0) + 1;
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
    };
    log(`  indicator set changes: disappeared mid-run ${retired.length} (by family: ${famCount(retired).map(([a, b]) => `${a}×${b}`).join(", ")}`);
    const retiredSteps: Record<number, number> = {};
    for (const r of retired) retiredSteps[r.step] = (retiredSteps[r.step] ?? 0) + 1;
    log(`    disappeared at ${Object.keys(retiredSteps).sort((a, b) => +a - +b).map(s => `step ${s}(${retiredSteps[+s]})`).join(", ")}`);
    log(`    added mid-run ${added.length} (by family: ${famCount(added).map(([a, b]) => `${a}×${b}`).join(", ")}`);
    // 从序列本身看"谁中途不再上报 / 谁中途才开始上报"（tags.json 的 last_seen 全等于文件写入时刻，查不出移除）
    const stopsByFamily: Record<string, { n: number; lastStep: number }> = {};
    const startsByFamily: Record<string, { n: number; firstStep: number }> = {};
    let stopCount = 0, startCount = 0;
    for (const [k, v] of Object.entries(RUNS[run].series)) {
      let first = -1, last = -1;
      for (let i = 0; i < N; i++) if (v[i] !== null && Number.isFinite(v[i] as number)) { if (first < 0) first = i; last = i; }
      if (last < 0) continue;
      if (last < N - 1) {
        stopCount++;
        const f = familyOf(k);
        const cur = stopsByFamily[f];
        if (!cur) stopsByFamily[f] = { n: 1, lastStep: last + 1 };
        else { cur.n++; cur.lastStep = Math.max(cur.lastStep, last + 1); }
      }
      if (first > 0) {
        startCount++;
        const f = familyOf(k);
        const cur = startsByFamily[f];
        if (!cur) startsByFamily[f] = { n: 1, firstStep: first + 1 };
        else { cur.n++; cur.firstStep = Math.min(cur.firstStep, first + 1); }
      }
    }
    const stops = Object.entries(stopsByFamily).sort((a, b) => b[1].n - a[1].n);
    const starts = Object.entries(startsByFamily).sort((a, b) => b[1].n - a[1].n);
    log(`  from the series: metrics that stopped reporting mid-run ${stopCount} (${stops.length} families), e.g. ${stops.slice(0, 5).map(([f, v]) => `${f}×${v.n}(last step ${v.lastStep})`).join(", ")}`);
    log(`    started reporting mid-run ${startCount}, e.g. ${starts.slice(0, 5).map(([f, v]) => `${f}×${v.n}(first step ${v.firstStep})`).join(", ")}`);
    out[run] = {
      restart_near_median_stat: quantile(withR, 0.5), restart_near_n: withR.length,
      other_median_stat: quantile(withoutR, 0.5), other_n: withoutR.length,
      retired_n: retired.length, retired_by_family: famCount(retired), retired_examples: retired.slice(0, 10),
      added_n: added.length, added_by_family: famCount(added), added_examples: added.slice(0, 10),
      retired_steps: retiredSteps,
      series_stop_n: stopCount, series_stop_by_family: stops.slice(0, 15),
      series_start_n: startCount, series_start_by_family: starts.slice(0, 15),
    };
  }
  RESULT.regime_ops = out;
}

// ---- 偏相关
hr("9. Partial correlation: relationships after controlling for step index");
const PAIRS: [string, string][] = [
  ["ctx_response_length/mean", "dynsam/avg@n"],
  ["ctx_total_length/mean", "dynsam/avg@n"],
  ["partial/avg_staleness", "train_infer_diff/new_infer/kl"],
  ["partial/avg_staleness", "dynsam/avg@n"],
  ["timing_s/trainer_ops", "ctx_total_length/mean"],
  ["timing_s/step", "ctx_total_length/mean"],
  ["actor/entropy_loss", "dynsam/avg@n"],
  ["critic/rewards/mean", "dynsam/avg@n"],
  ["ctx_response_length/mean", "train/passrate/avg_passrate"],
  ["train_infer_diff/new_infer/kl", "dynsam/avg@n"],
  ["timing_s/step", "timing_s/trainer_ops"],
  ["dynsam/num_target", "dynsam/avg@n"],
];
const PARTIAL: Record<string, any> = {};
for (const run of ["pro", "flash"] as RunKey[]) {
  const R = RUNS[run], N = R.N;
  const rows: any[] = [];
  for (const [ka, kb] of PAIRS) {
    const va = R.series[ka], vb = R.series[kb];
    if (!va || !vb) { rows.push({ a: ka, b: kb, note: "序列不存在" }); continue; }
    const ia: number[] = [], xa: number[] = [], xb: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = va[i], b = vb[i];
      if (a == null || b == null || !Number.isFinite(a as number) || !Number.isFinite(b as number)) continue;
      ia.push(i); xa.push(a as number); xb.push(b as number);
    }
    if (ia.length < 6) { rows.push({ a: ka, b: kb, n: ia.length, note: "有效点不足" }); continue; }
    const raw = pearson(xa, xb);
    const ra = new Float64Array(xa.length), rb = new Float64Array(xb.length);
    for (let i = 0; i < xa.length; i++) { ra[i] = xa[i]; rb[i] = xb[i]; }
    // 用（重编号后的）步序号做控制变量
    const tt = new Float64Array(ia.length);
    for (let i = 0; i < ia.length; i++) tt[i] = ia[i];
    const resid = (v: Float64Array) => {
      let mt = 0, mv = 0;
      for (let i = 0; i < v.length; i++) { mt += tt[i]; mv += v[i]; }
      mt /= v.length; mv /= v.length;
      let stt = 0, svt = 0;
      for (let i = 0; i < v.length; i++) { stt += (tt[i] - mt) ** 2; svt += (tt[i] - mt) * (v[i] - mv); }
      const b = svt / stt, a = mv - b * mt;
      const r = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) r[i] = v[i] - (a + b * tt[i]);
      return r;
    };
    const pr = pearson(resid(ra), resid(rb));
    rows.push({ a: ka, b: kb, n: ia.length, raw_r: raw, partial_r_control_step: pr, shrink: raw - pr });
    log(`  ${run}: corr(${ka}, ${kb}) = ${raw.toFixed(3)} → after controlling for step index ${pr.toFixed(3)} (n=${ia.length})`);
  }
  PARTIAL[run] = rows;
}
RESULT.partial_corr = PARTIAL;

// ---- 跨 run 可比性
hr("10. Cross-run comparability (intersection of indicators)");
const CROSS: Record<string, any> = {};
{
  const keysPro = new Set(Object.keys(seriesPro));
  const common = Object.keys(seriesFlash).filter(k => keysPro.has(k));
  const cPro = buildCohort("pro", { coverage: 0.8, fill: "interp", excludeMechanical: false, keys: common });
  // flash 用同一批指标、各自覆盖率判定
  const cFlash = buildCohort("flash", { coverage: 0.8, fill: "interp", excludeMechanical: false, keys: common });
  const setP = new Set(cPro.names);
  const both = cFlash.names.filter(k => setP.has(k));
  const cp = buildCohort("pro", { coverage: 0.8, fill: "interp", excludeMechanical: false, keys: both });
  const cf = buildCohort("flash", { coverage: 0.8, fill: "interp", excludeMechanical: false, keys: both });
  log(`  intersection metrics ${common.length}; passing coverage on both sides ${both.length}`);
  const Pp = pca(cp.Z, cp.d, cp.N);
  const Pf = pca(cf.Z, cf.d, cf.N);
  // 主成分配对：载荷向量的 |cos|
  const kMatch = 5;
  const match: any[] = [];
  for (let k = 0; k < kMatch; k++) {
    let bestK = -1, bestC = 0;
    for (let l = 0; l < kMatch; l++) {
      let dot = 0, n1 = 0, n2 = 0;
      for (let j = 0; j < cp.d; j++) { const x = Pp.loadings[k * cp.d + j], y = Pf.loadings[l * cf.d + j]; dot += x * y; n1 += x * x; n2 += y * y; }
      const c = dot / Math.sqrt(n1 * n2);
      if (Math.abs(c) > Math.abs(bestC)) { bestC = c; bestK = l; }
    }
    match.push({ pro_pc: k + 1, pro_var: Pp.frac[k], flash_pc: bestK + 1, flash_var: Pf.frac[bestK], cosine: bestC });
  }
  log(`  principal-component matching (loading-space cosine):`);
  for (const m of match) log(`    pro PC${m.pro_pc} (${(100 * m.pro_var).toFixed(1)}%) ↔ flash PC${m.flash_pc} (${(100 * m.flash_var).toFixed(1)}%) |cos| = ${Math.abs(m.cosine).toFixed(3)}`);
  // 公平对比：把 flash 也截到 24 步再配对（步数不同时成分数上限不同）
  const NB2 = cp.N;
  const Zf24 = new Float64Array(cf.d * NB2);
  for (let j = 0; j < cf.d; j++) {
    const col = new Float64Array(NB2);
    for (let s = 0; s < NB2; s++) col[s] = cf.Z[j * cf.N + s];
    let m = 0; for (let s = 0; s < NB2; s++) m += col[s]; m /= NB2;
    let ss = 0; for (let s = 0; s < NB2; s++) ss += (col[s] - m) ** 2;
    const sd = Math.sqrt(ss / NB2) || 1;
    for (let s = 0; s < NB2; s++) Zf24[j * NB2 + s] = (col[s] - m) / sd;
  }
  const Pf24 = pca(Zf24, cf.d, NB2);
  const match24: any[] = [];
  for (let k = 0; k < kMatch; k++) {
    let bestK = -1, bestC = 0;
    for (let l = 0; l < kMatch; l++) {
      let dot = 0, n1 = 0, n2 = 0;
      for (let j = 0; j < cp.d; j++) { const x = Pp.loadings[k * cp.d + j], y = Pf24.loadings[l * cf.d + j]; dot += x * y; n1 += x * x; n2 += y * y; }
      const c = dot / Math.sqrt(n1 * n2);
      if (Math.abs(c) > Math.abs(bestC)) { bestC = c; bestK = l; }
    }
    match24.push({ pro_pc: k + 1, pro_var: Pp.frac[k], flash_pc: bestK + 1, flash_var: Pf24.frac[bestK], cosine: bestC });
  }
  log(`  after truncating flash to ${NB2} steps, rematched: ${match24.map(m => `pro PC${m.pro_pc}↔flash PC${m.flash_pc} |cos|=${Math.abs(m.cosine).toFixed(3)}`).join("; ")}`);
  // 每个指标在两 run 上的轨迹相关（对齐到相同步序号 1..24）
  const Nmin = Math.min(cp.N, cf.N);
  const traj: { key: string; r: number; family: string; group: string }[] = [];
  for (let j = 0; j < cp.d; j++) {
    const a = new Float64Array(Nmin), b = new Float64Array(Nmin);
    for (let s = 0; s < Nmin; s++) { a[s] = cp.Z[j * cp.N + s]; b[s] = cf.Z[j * cf.N + s]; }
    const r = pearson(a, b);
    if (Number.isFinite(r)) traj.push({ key: cp.names[j], r, family: familyOf(cp.names[j]), group: groupOf(cp.names[j]) });
  }
  traj.sort((x, y) => y.r - x.r);
  const rs = traj.map(t => t.r).sort((a, b) => a - b);
  const fracHigh = traj.filter(t => t.r > 0.5).length / traj.length;
  const fracLow = traj.filter(t => t.r < -0.5).length / traj.length;
  const fracMid = 1 - fracHigh - fracLow;
  log(`  per-metric cross-run trajectory correlation (step indices aligned 1..${Nmin}, n=${traj.length}): median ${quantile(rs, 0.5).toFixed(3)}, quartiles [${quantile(rs, 0.25).toFixed(3)}, ${quantile(rs, 0.75).toFixed(3)}]`);
  log(`    r>0.5 ${(100 * fracHigh).toFixed(1)}%; |r|≤0.5 ${(100 * fracMid).toFixed(1)}%; r<-0.5 ${(100 * fracLow).toFixed(1)}%`);
  const byFam: Record<string, number[]> = {};
  for (const t of traj) (byFam[t.family] ??= []).push(t.r);
  const famSummary = Object.entries(byFam).filter(([, v]) => v.length >= 5)
    .map(([f, v]) => ({ family: f, n: v.length, median_r: quantile(v.slice().sort((a, b) => a - b), 0.5) }))
    .sort((a, b) => b.n - a.n);
  log(`  family-level cross-run consistency (n≥5):`);
  for (const f of famSummary.slice(0, 18)) log(`    ${f.family}  n=${f.n}  median r=${f.median_r.toFixed(3)}`);
  log(`  top 10 most consistent: ${traj.slice(0, 10).map(t => `${t.key}(${t.r.toFixed(2)})`).join(", ")}`);
  log(`  top 10 most opposite: ${traj.slice(-10).reverse().map(t => `${t.key}(${t.r.toFixed(2)})`).join(", ")}`);
  // 换一种对齐口径：按墙钟时间把 flash 插值到 pro 的每一步墙钟时刻
  const wallP = RUNS.pro.axis.walls as number[], wallF = RUNS.flash.axis.walls as number[];
  const interpAt = (walls: number[], vals: Float64Array, t: number): number | null => {
    if (t < walls[0] || t > walls[walls.length - 1]) return null;
    let hi = 1;
    while (hi < walls.length && walls[hi] < t) hi++;
    const lo = hi - 1;
    const span = walls[hi] - walls[lo];
    const f = span <= 0 ? 0 : (t - walls[lo]) / span;
    return vals[lo] + (vals[hi] - vals[lo]) * f;
  };
  const trajWall: number[] = [];
  let usedSteps = 0;
  for (let j = 0; j < cp.d; j++) {
    const a: number[] = [], b: number[] = [];
    const fc = cf.Z.subarray(j * cf.N, j * cf.N + cf.N);
    for (let s = 0; s < cp.N; s++) {
      const v = interpAt(wallF, fc, wallP[s]);
      if (v === null) continue;
      a.push(cp.Z[j * cp.N + s]); b.push(v);
    }
    if (a.length < 8) continue;
    usedSteps = a.length;
    const r = pearson(a, b);
    if (Number.isFinite(r)) trajWall.push(r);
  }
  trajWall.sort((x, y) => x - y);
  log(`  same metrics aligned by "wall-clock interpolation" (each metric uses ${usedSteps} of pro's steps falling inside the flash interval): median r=${quantile(trajWall, 0.5).toFixed(3)}, quartiles [${quantile(trajWall, 0.25).toFixed(3)}, ${quantile(trajWall, 0.75).toFixed(3)}], r>0.5 ${(100 * trajWall.filter(r => r > 0.5).length / trajWall.length).toFixed(1)}%`);
  CROSS.intersection = common.length;
  CROSS.both_coverage = both.length;
  CROSS.pca_pro = { d: cp.d, frac_top5: Array.from(Pp.frac.slice(0, 5)), n80: Pp.n80, n90: Pp.n90, PR: Pp.PR };
  CROSS.pca_flash = { d: cf.d, frac_top5: Array.from(Pf.frac.slice(0, 5)), n80: Pf.n80, n90: Pf.n90, PR: Pf.PR };
  CROSS.pc_matching = match;
  CROSS.pc_matching_flash24 = match24;
  CROSS.traj = { n: traj.length, median_r: quantile(rs, 0.5), q25: quantile(rs, 0.25), q75: quantile(rs, 0.75), frac_gt_0_5: fracHigh, frac_mid: fracMid, frac_lt_neg0_5: fracLow };
  CROSS.traj_wallclock = { n: trajWall.length, steps_used: usedSteps, median_r: quantile(trajWall, 0.5), q25: quantile(trajWall, 0.25), q75: quantile(trajWall, 0.75), frac_gt_0_5: trajWall.filter(r => r > 0.5).length / trajWall.length };
  CROSS.traj_top_consistent = traj.slice(0, 15);
  CROSS.traj_top_opposite = traj.slice(-15).reverse();
  CROSS.family_consistency = famSummary;
}
RESULT.cross_run = CROSS;

// ---- 写 JSON
hr("11. Write JSON");
mkdirSync(OUT_DIR, { recursive: true });
RESULT.notes = {
  coverage_rule: `覆盖率 ≥ ${COVERAGE}（pro 需 ≥${Math.ceil(0.8 * 24)}/24 步非空，flash 需 ≥${Math.ceil(0.8 * 30)}/30 步）`,
  fill_rule: "先按覆盖率筛选，再线性插值（两端取最近已知值），最后每个指标单独 z-score（除以总体标准差）",
  distance_rule: "聚类距离 = 1 - |ρ|；平均连接（UPGMA，最近邻链实现）",
  change_point_rule: "主成分坐标（PC1-3，各自标准化）上做贪心二分分割，接受条件为 RSS 降幅 > dim·ln(N)·σ²（BIC 风格）",
  partial_corr_rule: "控制变量 = 步序号（0-based）；两条序列各自对步序号做最小二乘回归取残差，再算 Pearson",
};
RESULT.runtime_seconds = (Date.now() - T0) / 1000;
writeFileSync(join(OUT_DIR, "A3-factor-numbers.json"), JSON.stringify(RESULT, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 1));
log(`  wrote ${join(OUT_DIR, "A3-factor-numbers.json")} (${((Date.now() - T0) / 1000).toFixed(1)}s)`);
