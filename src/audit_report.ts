/**
 * 指标可信度审计：把看板全部指标系统性过一遍，回答"哪些不能信、为什么、怎么自己验证"。
 *
 *   bun src/audit_report.ts
 *
 * 输入（只读）：
 *   data/store/runs/{pro,flash}/series.json  逐步序列
 *   data/store/runs/{pro,flash}/axis.json    steps / walls / run_start
 *   data/store/runs/{pro,flash}/tags.json    指标名 + 版本切换史 + first_seen/last_seen
 *   data/store/runs/{pro,flash}/events.json  重启与 step 事件
 *   data/store/{notices,benchmarks,meta}.json
 *   content/metrics.json                     109 条人工解读（对照面）
 *
 * 输出：
 *   analysis/zh-CN/numbers/A3-audit-numbers.json   （本脚本自动写）
 *
 * 设计纪律：
 *   1. 不硬编码结论数字——所有判定都由序列现算，脚本里出现的常量只有阈值。
 *   2. 每个判定给出可复算依据（用了哪些步、算的什么量、阈值多少）。
 *   3. 样本量只有 24 / 30 个点，"常数"一律说清是"不同取值数 ≤ k"，不用方差当唯一判据。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT, NUMBERS_DIR, ROOT, STORE } from "./paths";

/* ------------------------------------------------------------------ *
 * 阈值集中放这里，改阈值只改这一处，报告里的口径描述跟着它走
 * ------------------------------------------------------------------ */
const T = {
  /** 两两相关系数达到这个值才进入"疑似同一曲线"候选 */
  corrCandidate: 0.999,
  /** 仿射拟合的最大绝对残差 / y 取值范围，小于它算"精确线性" */
  affineExact: 1e-9,
  affineNear: 1e-4,
  /** 相关系数达到这个值算"近似重复"（只是相关，不保证线性可还原） */
  corrNearDup: 0.995,
  /** 参与相关判定所需的最小重叠步数 */
  minOverlap: 6,
  /** 相邻步变化倍数达到它算"量级跳变" */
  jumpFactor: 10,
  /** 断点：|Δ| / (1.4826×MAD) 超过它，且相对变化超过 minRelChange */
  breakZ: 8,
  minRelChange: 0.05,
  /** 覆盖率的直方图切点 */
  covBins: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0000001],
  /** 长期反复出现的"整齐值"占比达到它，才列为哨兵候选 */
  sentinelShare: 0.5,
  /** 精确 0 占已上报步的比例达到它，算"报 0 派" */
  zeroReportShare: 0.9,
  /** 量级漂移：版本切换前后中位数比值达到它算"口径可能变了" */
  driftFactor: 10,
};

const ANALYSIS_DIR = NUMBERS_DIR;
const OUT_JSON = join(ANALYSIS_DIR, "A3-audit-numbers.json");

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */
type V = (number | null)[];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mad(xs: number[]): number {
  if (!xs.length) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

function round(x: number, d = 6): number {
  if (!Number.isFinite(x)) return x;
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** 指标族：第一段路径；partial/ 带上桶号，penalty/ 与 train/harness 带上子模块。 */
function family(tag: string): string {
  const s = tag.split("/");
  if (s[0] === "partial") return `partial/${s[1]}`;
  if (s[0] === "penalty") return `penalty/${s[1]}`;
  if (s[0] === "train" && s[1] === "harness") return "train/harness";
  if (s[0] === "ctx_total_length" || s[0] === "ctx_prompt_length" || s[0] === "ctx_response_length") {
    return s.length > 2 && /^dataset-/.test(s[2]) ? `${s[0]}/${s[1]}/dataset` : s[0];
  }
  return s[0];
}

/** 顶层前缀，用于粗分组统计。 */
const topPrefix = (tag: string) => tag.split("/")[0];

/* ------------------------------------------------------------------ *
 * 载入
 * ------------------------------------------------------------------ */
interface RunData {
  key: string;
  label: string;
  steps: number[];
  walls: number[];
  runStart: number;
  series: Record<string, V>;
  tags: string[];
  versions: { version: string; at: number; n: number }[];
  tagLife: Record<string, { first_seen: number; last_seen: number }>;
  events: any[];
  notices: any[];
  benchmarks: any[];
  descriptions: Record<string, string>;
  pins: string[];
}

function readJson<T>(p: string, dflt: T): T {
  if (!existsSync(p)) return dflt;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return dflt;
  }
}

const meta: any = readJson(join(STORE, "meta.json"), {});
const notices: any[] = readJson(join(STORE, "notices.json"), { notices: [] }).notices ?? [];
const benchmarks: any[] = (() => {
  const j = readJson<any>(join(STORE, "benchmarks.json"), [] as any);
  return Array.isArray(j) ? j : (j.benchmarks ?? []);
})();

function loadRun(key: string): RunData {
  const dir = join(STORE, "runs", key);
  const axis: any = readJson(join(dir, "axis.json"), { steps: [], walls: [], run_start: 0 });
  const series = readJson<Record<string, V>>(join(dir, "series.json"), {});
  const tagFile: any = readJson(join(dir, "tags.json"), { tags: {}, versions: [] });
  const events: any[] = readJson(join(dir, "events.json"), []);
  return {
    key,
    label: (meta.runs ?? []).find((r: any) => r.key === key)?.label ?? key,
    steps: axis.steps ?? [],
    walls: axis.walls ?? [],
    runStart: axis.run_start ?? 0,
    series,
    tags: Object.keys(tagFile.tags ?? {}),
    versions: tagFile.versions ?? [],
    tagLife: tagFile.tags ?? {},
    events,
    notices,
    benchmarks,
    descriptions: meta.descriptions ?? {},
    pins: meta.pins ?? [],
  };
}

const RUNS: RunData[] = [loadRun("pro"), loadRun("flash")];

/* ------------------------------------------------------------------ *
 * 0. 概览
 * ------------------------------------------------------------------ */
const overview = RUNS.map((r) => {
  const keys = Object.keys(r.series);
  let cells = 0;
  let filled = 0;
  let anyFilled = 0;
  for (const k of keys) {
    const a = r.series[k];
    let has = false;
    for (let i = 0; i < r.steps.length; i++) {
      cells++;
      if (isNum(a?.[i])) {
        filled++;
        has = true;
      }
    }
    if (has) anyFilled++;
  }
  return {
    run: r.key,
    label: r.label,
    steps: r.steps.length,
    stepFrom: r.steps[0],
    stepTo: r.steps.at(-1),
    seriesKeys: keys.length,
    seriesKeysWithAnyValue: anyFilled,
    tagListed: r.tags.length,
    tagsWithoutAnySeriesRow: r.tags.filter((t) => !(t in r.series)).length,
    cells,
    filled,
    fillRate: filled / cells,
    versions: r.versions.length,
    baselineVersionN: r.versions[0]?.n ?? null,
    latestVersionN: r.versions.at(-1)?.n ?? null,
  };
});

/* ------------------------------------------------------------------ *
 * 每个指标的派生画像
 * ------------------------------------------------------------------ */
interface Profile {
  tag: string;
  run: string;
  fam: string;
  top: string;
  n: number;
  nNull: number;
  coverage: number;
  /** 非 null 值，按步序 */
  vals: number[];
  /** 值出现的步号 */
  atSteps: number[];
  min: number;
  max: number;
  mean: number;
  distinct: number;
  constant: boolean;
  distinct2: boolean;
  allNull: boolean;
  constKind: "all-null" | "const-0" | "const-1" | "const-other" | "two-valued" | "varying";
  exactZero: number;
  exactOne: number;
  zeroShareNonNull: number;
  modeValue: number | null;
  modeShareNonNull: number;
  /** 尾部断供：最后一个非 null 之后还有没有步 */
  trailingNulls: number;
  leadingNulls: number;
  interiorNulls: number;
  /** 相邻步（都在轴上直接相邻）变化倍数最大值 */
  maxJump: { factor: number; from: number; to: number; toStep: number } | null;
}

function buildProfiles(r: RunData): Profile[] {
  const out: Profile[] = [];
  for (const tag of Object.keys(r.series)) {
    const a = r.series[tag] ?? [];
    const vals: number[] = [];
    const atSteps: number[] = [];
    let nNull = 0;
    let leading = 0;
    let trailing = 0;
    let seen = false;
    for (let i = 0; i < r.steps.length; i++) {
      const v = a[i];
      if (isNum(v)) {
        vals.push(v);
        atSteps.push(r.steps[i]);
        seen = true;
      } else {
        nNull++;
        if (!seen) leading++;
      }
    }
    if (seen) {
      for (let i = r.steps.length - 1; i >= 0; i--) {
        if (isNum(a[i])) break;
        trailing++;
      }
    }
    const interior = nNull - leading - trailing;
    const set = new Set(vals);
    const cnt = new Map<number, number>();
    for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    let modeValue: number | null = null;
    let modeCount = 0;
    for (const [v, c] of cnt) if (c > modeCount) ((modeCount = c), (modeValue = v));
    const distinct = set.size;
    let maxJump: Profile["maxJump"] = null;
    for (let i = 0; i + 1 < r.steps.length; i++) {
      const x = a[i];
      const y = a[i + 1];
      if (!isNum(x) || !isNum(y)) continue;
      if (x === 0) continue;
      const f = Math.abs(y) / Math.abs(x);
      if (!Number.isFinite(f)) continue;
      if (!maxJump || f > maxJump.factor) maxJump = { factor: f, from: x, to: y, toStep: r.steps[i + 1] };
    }
    const constant = distinct === 1;
    const distinct2 = distinct <= 2;
    const allNull = vals.length === 0;
    let constKind: Profile["constKind"] = "varying";
    if (allNull) constKind = "all-null";
    else if (constant) constKind = vals[0] === 0 ? "const-0" : vals[0] === 1 ? "const-1" : "const-other";
    else if (distinct2) constKind = "two-valued";
    out.push({
      tag,
      run: r.key,
      fam: family(tag),
      top: topPrefix(tag),
      n: r.steps.length,
      nNull,
      coverage: r.steps.length ? vals.length / r.steps.length : 0,
      vals,
      atSteps,
      min: vals.length ? Math.min(...vals) : NaN,
      max: vals.length ? Math.max(...vals) : NaN,
      mean: vals.length ? sum(vals) / vals.length : NaN,
      distinct,
      constant,
      distinct2,
      allNull,
      constKind,
      exactZero: vals.filter((v) => v === 0).length,
      exactOne: vals.filter((v) => v === 1).length,
      zeroShareNonNull: vals.length ? vals.filter((v) => v === 0).length / vals.length : NaN,
      modeValue,
      modeShareNonNull: vals.length ? modeCount / vals.length : NaN,
      trailingNulls: trailing,
      leadingNulls: leading,
      interiorNulls: interior,
      maxJump,
    });
  }
  return out;
}

const PROFILES: Record<string, Profile[]> = Object.fromEntries(RUNS.map((r) => [r.key, buildProfiles(r)]));

/* ------------------------------------------------------------------ *
 * 1. 恒等 / 派生指标
 * ------------------------------------------------------------------ */
interface PairHit {
  a: string;
  b: string;
  overlap: number;
  r: number;
  slope: number;
  intercept: number;
  maxAbsResid: number;
  rangeY: number;
  relResid: number;
  kind: "identical" | "affine-exact" | "affine-near" | "correlated";
}

function pairwiseIdentities(r: RunData, profs: Profile[]): { hits: PairHit[]; scannedPairs: number; skippedNoOverlap: number } {
  const live = profs.filter((p) => !p.allNull && !p.constant && p.vals.length >= 5);
  // 每个指标的定长数组，null -> NaN
  const vec = live.map((p) => {
    const a = r.series[p.tag];
    const v = new Float64Array(r.steps.length);
    for (let i = 0; i < r.steps.length; i++) v[i] = isNum(a[i]) ? (a[i] as number) : NaN;
    return v;
  });
  const nz: number[][] = live.map((p, k) => {
    const idx: number[] = [];
    for (let i = 0; i < vec[k].length; i++) if (!Number.isNaN(vec[k][i])) idx.push(i);
    return idx;
  });
  // 精确相同（含 null 位置一致）先做一遍，避免后面重复计算
  const sig = new Map<string, number[]>();
  live.forEach((p, k) => {
    const key = vec[k].length + "|" + Array.from(vec[k], (x) => (Number.isNaN(x) ? "N" : String(x))).join(",");
    if (!sig.has(key)) sig.set(key, []);
    sig.get(key)!.push(k);
  });
  const hits: PairHit[] = [];
  const seenPair = new Set<string>();
  for (const [, ks] of sig) {
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++) {
        const A = live[ks[i]];
        const B = live[ks[j]];
        const n = nz[ks[i]].length;
        const sx = sum(nz[ks[i]].map((k) => vec[ks[i]][k]));
        const sy = sum(nz[ks[j]].map((k) => vec[ks[j]][k]));
        const sxx = sum(nz[ks[i]].map((k) => vec[ks[i]][k] ** 2));
        const sxy = sum(nz[ks[i]].map((k) => vec[ks[i]][k] * vec[ks[j]][k]));
        const mx = sx / n;
        const my = sy / n;
        const b = (sxy - n * mx * my) / Math.max(sxx - n * mx * mx, 1e-300);
        const a0 = my - b * mx;
        const ys = nz[ks[i]].map((k) => vec[ks[j]][k]);
        const rangeY = Math.max(...ys) - Math.min(...ys);
        const maxAbs = Math.max(...nz[ks[i]].map((k) => Math.abs(vec[ks[j]][k] - (a0 + b * vec[ks[i]][k]))));
        seenPair.add(`${ks[i]}|${ks[j]}`);
        hits.push({
          a: A.tag,
          b: B.tag,
          overlap: n,
          r: 1,
          slope: b,
          intercept: a0,
          maxAbsResid: maxAbs,
          rangeY,
          relResid: rangeY > 0 ? maxAbs / rangeY : 0,
          kind: "identical",
        });
      }
  }
  let scanned = 0;
  let skipped = 0;
  for (let i = 0; i < live.length; i++) {
    const ii = nz[i];
    if (!ii.length) continue;
    for (let j = i + 1; j < live.length; j++) {
      const key = `${i}|${j}`;
      if (seenPair.has(key)) continue;
      const jj = nz[j];
      if (!jj.length) continue;
      scanned++;
      // 用较短的一侧做外循环
      const [si, sj] = ii.length <= jj.length ? [i, j] : [j, i];
      const idxS = si === i ? ii : jj;
      const vS = vec[si];
      const vL = vec[sj];
      let n = 0,
        sx = 0,
        sy = 0,
        sxx = 0,
        syy = 0,
        sxy = 0;
      for (const k of idxS) {
        const y = vL[k];
        if (Number.isNaN(y)) continue;
        const x = vS[k];
        n++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
      }
      if (n < T.minOverlap) {
        skipped++;
        continue;
      }
      const cov = sxy - (sx * sy) / n;
      const vx = sxx - (sx * sx) / n;
      const vy = syy - (sy * sy) / n;
      if (vx <= 0 || vy <= 0) continue;
      const rr = cov / Math.sqrt(vx * vy);
      if (Math.abs(rr) < T.corrCandidate) continue;
      const b = cov / vx;
      const a0 = sy / n - b * (sx / n);
      // 在短侧索引上算残差（重叠点集）
      const resid: number[] = [];
      const ys: number[] = [];
      for (const k of idxS) {
        const y = vL[k];
        if (Number.isNaN(y)) continue;
        const x = vS[k];
        resid.push(Math.abs(y - (a0 + b * x)));
        ys.push(y);
      }
      const rangeY = Math.max(...ys) - Math.min(...ys);
      const maxAbs = Math.max(...resid);
      const rel = rangeY > 0 ? maxAbs / rangeY : 0;
      const kind: PairHit["kind"] =
        rel <= T.affineExact ? "affine-exact" : rel <= T.affineNear ? "affine-near" : "correlated";
      hits.push({ a: live[i].tag, b: live[j].tag, overlap: n, r: rr, slope: b, intercept: a0, maxAbsResid: maxAbs, rangeY, relResid: rel, kind });
    }
  }
  return { hits, scannedPairs: scanned, skippedNoOverlap: skipped };
}

function clusterIdentities(hits: PairHit[], sparseOf: (tag: string) => boolean, minKind: PairHit["kind"][] = ["identical", "affine-exact", "affine-near"]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const usable = hits.filter((h) => minKind.includes(h.kind));
  for (const h of usable) {
    parent.set(h.a, parent.get(h.a) ?? h.a);
    parent.set(h.b, parent.get(h.b) ?? h.b);
    union(h.a, h.b);
  }
  const groups = new Map<string, { members: string[]; pairs: PairHit[] }>();
  for (const h of usable) {
    const root = find(h.a);
    if (!groups.has(root)) groups.set(root, { members: [], pairs: [] });
    groups.get(root)!.pairs.push(h);
  }
  for (const [, g] of groups) {
    const s = new Set<string>();
    for (const p of g.pairs) {
      s.add(p.a);
      s.add(p.b);
    }
    g.members = [...s].sort();
  }
  return [...groups.values()]
    .filter((g) => g.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length)
    .map((g) => {
      const worst = Math.max(...g.pairs.map((p) => p.relResid));
      const kinds = new Set(g.pairs.map((p) => p.kind));
      const kind = kinds.has("identical") ? "identical" : kinds.has("affine-exact") ? "affine-exact" : kinds.has("affine-near") ? "affine-near" : "correlated";
      const sparseMembers = g.members.filter((m) => sparseOf(m));
      return {
        size: g.members.length,
        kind,
        worstRelResid: worst,
        members: g.members,
        pairs: g.pairs.length,
        /** 只要簇里有一个成员"取值几乎全是 0"，这个簇就不可信：稀疏序列之间会假性相同 */
        sparse: sparseMembers.length > 0,
        sparseMembers,
      };
    });
}

/**
 * 已知的多指标恒等式（两两相关扫不出来的一类：加和、加权和、比值近似常数）。
 * 全部现算，返回误差统计。
 */
function curatedIdentities(r: RunData) {
  const idx = new Map(r.steps.map((s, i) => [s, i]));
  const get = (tag: string, step: number): number | null => {
    const i = idx.get(step);
    if (i === undefined) return null;
    const v = r.series[tag]?.[i];
    return isNum(v) ? v : null;
  };
  const res: any[] = [];

  // A. ctx_total = prompt + response，逐分位
  const stats = ["mean", "max", "min", "p50", "p90", "p99"];
  for (const st of stats) {
    const rows: any[] = [];
    for (const s of r.steps) {
      const t = get(`ctx_total_length/${st}`, s);
      const p = get(`ctx_prompt_length/${st}`, s);
      const q = get(`ctx_response_length/${st}`, s);
      if (t === null || p === null || q === null) continue;
      rows.push({ s, t, p, q, abs: Math.abs(t - (p + q)), rel: Math.abs(t - (p + q)) / Math.max(Math.abs(t), 1e-12) });
    }
    if (rows.length)
      res.push({
        name: `ctx_total_length/${st} = ctx_prompt_length/${st} + ctx_response_length/${st}`,
        steps: rows.length,
        maxAbs: Math.max(...rows.map((x) => x.abs)),
        maxRel: Math.max(...rows.map((x) => x.rel)),
      });
  }

  // B. perf/total_num_tokens ≈ 1568 × 16 × ctx_total_length/mean
  {
    const rows: any[] = [];
    for (const s of r.steps) {
      const t = get("perf/total_num_tokens", s);
      const m = get("ctx_total_length/mean", s);
      if (t === null || m === null) continue;
      const pred = 1568 * 16 * m;
      rows.push({ s, t, pred, rel: (t - pred) / pred });
    }
    if (rows.length)
      res.push({
        name: "perf/total_num_tokens ≈ 1568×16×ctx_total_length/mean",
        steps: rows.length,
        maxRel: Math.max(...rows.map((x) => Math.abs(x.rel))),
        minRel: Math.min(...rows.map((x) => x.rel)),
        meanRel: sum(rows.map((x) => x.rel)) / rows.length,
      });
  }

  // C. adv pre/post penalty 逐值相等
  for (const sign of ["adv_pos", "adv_neg"]) {
    const rows: any[] = [];
    for (const s of r.steps) {
      const a = get(`train/${sign}_sum_pre_penalty`, s);
      const b = get(`train/${sign}_sum_post_penalty`, s);
      if (a === null || b === null) continue;
      rows.push(Math.abs(a - b));
    }
    if (rows.length) res.push({ name: `train/${sign}_sum_pre_penalty == train/${sign}_sum_post_penalty`, steps: rows.length, maxAbs: Math.max(...rows) });
  }

  // D. rewards/mean == score/mean
  {
    let n = 0,
      maxAbs = 0;
    for (const s of r.steps) {
      const a = get("critic/rewards/mean", s);
      const b = get("critic/score/mean", s);
      if (a === null || b === null) continue;
      n++;
      maxAbs = Math.max(maxAbs, Math.abs(a - b));
    }
    if (n) res.push({ name: "critic/rewards/mean == critic/score/mean", steps: n, maxAbs });
  }

  // E. partial 桶：Σ frac ≤ 1、Σ i·frac ≈ avg_staleness、Σ frac×bucketKL ≈ 全局 KL
  {
    const buckets = [...new Set(Object.keys(r.series).map((t) => /^partial\/(\d+)\//.exec(t)?.[1]).filter(Boolean))]
      .map(Number)
      .sort((a, b) => a - b);
    const rowsFrac: any[] = [];
    const rowsStale: any[] = [];
    const rowsKL: any[] = [];
    for (const s of r.steps) {
      const fr = buckets.map((b) => get(`partial/${b}/frac`, s));
      const have = fr.filter((x) => x !== null) as number[];
      if (have.length) rowsFrac.push({ s, sum: sum(have) });
      const stale = get("partial/avg_staleness", s);
      if (stale !== null) {
        let ws = 0;
        for (const b of buckets) {
          const f = get(`partial/${b}/frac`, s);
          if (f !== null) ws += b * f;
        }
        rowsStale.push({ s, abs: Math.abs(ws - stale), rel: Math.abs(ws - stale) / Math.max(Math.abs(stale), 1e-12), stale, ws });
      }
      const kl = get("train_infer_diff/new_infer/kl", s);
      if (kl !== null) {
        let w = 0;
        let any = false;
        for (const b of buckets) {
          const f = get(`partial/${b}/frac`, s);
          const k = get(`partial/${b}/train_infer_diff/new_infer/kl`, s);
          if (f !== null && k !== null) {
            w += f * k;
            any = true;
          }
        }
        if (any) rowsKL.push({ s, rel: Math.abs(w - kl) / Math.max(Math.abs(kl), 1e-12), kl, w });
      }
    }
    if (rowsFrac.length) res.push({ name: `Σ_k partial/k/frac ≤ 1 (buckets ${buckets.length})`, steps: rowsFrac.length, maxSum: Math.max(...rowsFrac.map((x) => x.sum)), minSum: Math.min(...rowsFrac.map((x) => x.sum)) });
    if (rowsStale.length) res.push({ name: "partial/avg_staleness == Σ i×frac_i", steps: rowsStale.length, maxAbs: Math.max(...rowsStale.map((x) => x.abs)), maxRel: Math.max(...rowsStale.map((x) => x.rel)) });
    if (rowsKL.length) res.push({ name: "global KL == Σ_k frac_k × partial/k/.../kl", steps: rowsKL.length, maxRel: Math.max(...rowsKL.map((x) => x.rel)) });
  }

  // F. 恒 0 / 恒 1 的成组字段
  for (const g of [
    ["penalty/action/adv_reduction_total", "penalty/action/adv_reduction_tokens", "penalty/action/adv_mul_tokens"],
  ]) {
    const stats = g.map((t) => {
      const p = PROFILES[r.key].find((x) => x.tag === t);
      return { tag: t, distinct: p?.distinct ?? 0, values: p?.modeValue ?? null, n: p?.vals.length ?? 0 };
    });
    res.push({ name: `${g.join(" / ")} identity check`, steps: stats[0].n, perTag: stats });
  }
  return res;
}

/* ------------------------------------------------------------------ *
 * 2. 恒零 / 常数列
 * ------------------------------------------------------------------ */
function constantStats(r: RunData) {
  const profs = PROFILES[r.key];
  const buckets: Record<string, Profile[]> = { "all-null": [], "const-0": [], "const-1": [], "const-other": [], "two-valued": [] };
  for (const p of profs) if (p.constKind !== "varying") buckets[p.constKind].push(p);
  const byFamily = (ps: Profile[]) => {
    const m = new Map<string, number>();
    for (const p of ps) m.set(p.fam, (m.get(p.fam) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([fam, n]) => ({ fam, n }));
  };
  // 按族 × 常数类型 的交叉表（报告第九节的可丢弃清单直接用它）
  const kinds: [string, Profile[]][] = [
    ["const-0", buckets["const-0"]],
    ["const-1", buckets["const-1"]],
    ["const-other", buckets["const-other"]],
  ];
  const byFamilyPerKind: Record<string, { fam: string; n: number }[]> = {};
  for (const [kind, list] of kinds) byFamilyPerKind[kind] = byFamily(list);
  return {
    run: r.key,
    total: profs.length,
    byFamilyPerKind,
    allNull: buckets["all-null"].length,
    const0: buckets["const-0"].length,
    const1: buckets["const-1"].length,
    constOther: buckets["const-other"].length,
    twoValued: buckets["two-valued"].length,
    /** 严格无信息：全空 + 严格常数 */
    droppableStrict: buckets["all-null"].length + buckets["const-0"].length + buckets["const-1"].length + buckets["const-other"].length,
    /** 严格无信息 + 只有两个取值 */
    droppableLoose: buckets["all-null"].length + buckets["const-0"].length + buckets["const-1"].length + buckets["const-other"].length + buckets["two-valued"].length,
    constOtherList: buckets["const-other"].map((p) => ({ tag: p.tag, value: p.vals[0], n: p.vals.length })),
    twoValuedByFamily: byFamily(buckets["two-valued"]),
    const0ByFamily: byFamily(buckets["const-0"]),
    allNullByFamily: byFamily(buckets["all-null"]),
    const1List: buckets["const-1"].map((p) => p.tag),
  };
}

/* ------------------------------------------------------------------ *
 * 3. 覆盖率
 * ------------------------------------------------------------------ */
function coverageStats(r: RunData) {
  const profs = PROFILES[r.key];
  const bins = T.covBins;
  const hist = bins.slice(0, -1).map((lo, i) => ({
    lo,
    hi: bins[i + 1] > 1 ? 1 : bins[i + 1],
    n: profs.filter((p) => p.coverage >= lo && p.coverage < bins[i + 1]).length,
  }));
  const low = profs.filter((p) => p.coverage < 0.5);
  const famAgg = new Map<string, { n: number; covSum: number; zeroReport: number }>();
  for (const p of profs) {
    const e = famAgg.get(p.fam) ?? { n: 0, covSum: 0, zeroReport: 0 };
    e.n++;
    e.covSum += p.coverage;
    if (isNum(p.zeroShareNonNull) && p.zeroShareNonNull >= T.zeroReportShare) e.zeroReport++;
    famAgg.set(p.fam, e);
  }
  const lowFamilies = [...famAgg.entries()]
    .map(([fam, e]) => ({ fam, n: e.n, meanCoverage: e.covSum / e.n }))
    .filter((x) => x.meanCoverage < 0.5)
    .sort((a, b) => a.meanCoverage - b.meanCoverage);
  // "报 0"（已上报但全是 0）与"缺失"分开
  const zeroReported = profs.filter((p) => !p.allNull && isNum(p.zeroShareNonNull) && p.zeroShareNonNull >= T.zeroReportShare);
  const trailingCut = profs.filter((p) => p.trailingNulls > 0);
  const interiorMissing = profs.filter((p) => p.interiorNulls > 0);
  return {
    run: r.key,
    total: profs.length,
    hist,
    below50: low.length,
    below50Families: lowFamilies,
    zeroReportedCount: zeroReported.length,
    zeroReportedFamilies: [...new Set(zeroReported.map((p) => p.fam))].sort(),
    trailingCutCount: trailingCut.length,
    trailingCutByFamily: [...new Set(trailingCut.map((p) => p.fam))].sort(),
    interiorMissingCount: interiorMissing.length,
    interiorMissingByFamily: [...new Set(interiorMissing.map((p) => p.fam))].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * 4. 哨兵值
 * ------------------------------------------------------------------ */
function isPowerOfTwo(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  const l = Math.log2(n);
  return Math.abs(l - Math.round(l)) < 1e-9;
}
function isRoundValue(v: number): boolean {
  const a = Math.abs(v);
  if (a === 0 || a === 1) return true;
  if (isPowerOfTwo(a)) return true;
  // 贴着 2 的整数次幂（例如 1048570 贴着 2^20=1048576）也算"像界"
  if (a >= 1000) {
    const k = Math.round(Math.log2(a));
    if (k > 8 && Math.abs(a - 2 ** k) / 2 ** k < 1e-5) return true;
    const t = Math.round(Math.log10(a));
    if (Math.abs(a - 10 ** t) / 10 ** t < 1e-5) return true;
  }
  if (a >= 1000 && Math.abs(a - Math.round(a)) < 1e-9 && Math.round(a) % 10000 === 0) return true;
  if (/^-?\d+(\.\d+)?e\+?\d+$/.test(String(v)) && a >= 1e6) return true;
  return false;
}

function sentinelStats(r: RunData) {
  const profs = PROFILES[r.key];
  const hits: any[] = [];
  for (const p of profs) {
    if (p.allNull) continue;
    const share = p.modeShareNonNull;
    const mv = p.modeValue;
    if (mv === null) continue;
    const repeated = p.vals.filter((v) => v === mv).length;
    const suspiciousValue = mv === 0 || mv === 1 || isRoundValue(mv);
    if (share >= T.sentinelShare && p.distinct >= 2 && suspiciousValue) {
      const isZero = mv === 0;
      const isOne = mv === 1;
      hits.push({
        run: r.key,
        tag: p.tag,
        fam: p.fam,
        value: mv,
        count: repeated,
        reported: p.vals.length,
        share,
        distinct: p.distinct,
        classification: isZero ? "zero-sentinel-candidate" : isOne ? "one-sentinel-candidate" : "round-value-candidate",
        min: p.min,
        max: p.max,
        otherValues: [...new Set(p.vals)].filter((v) => v !== mv).slice(0, 8),
      });
    }
  }
  hits.sort((a, b) => b.share - a.share);
  // 撞上限：某个值反复出现且 y 的最大值就是它，同时它像"界"
  const caps: any[] = [];
  for (const p of profs) {
    if (p.allNull || p.distinct < 3) continue;
    const mv = p.modeValue;
    if (mv === null) continue;
    const cnt = p.vals.filter((v) => v === mv).length;
    if (cnt >= 3 && cnt / p.vals.length >= 0.3 && p.max === mv && isRoundValue(mv) && mv > 1000) {
      caps.push({ run: r.key, tag: p.tag, capValue: mv, count: cnt, reported: p.vals.length, share: cnt / p.vals.length, maxIsCap: true });
    }
  }
  caps.sort((a, b) => b.share - a.share);
  return { run: r.key, sentinelCandidates: hits, capCandidates: caps, capCount: caps.length };
}

/* ------------------------------------------------------------------ *
 * 5. 尺度与量纲
 * ------------------------------------------------------------------ */
const RATIO_SUFFIX = /(^|\/)(frac|ratio|rate|share|pct|clipfrac|effect_ratio|ok_frac|missing_frac|zero|one|mid|zero_no_infra|one_no_infra|mid_no_infra)$|(_frac|_ratio|_rate|_share)$/;
const COUNT_LIKE = /(num_|n_tokens|_cnt|count|rollouts|tokens|groups|attempts|sandboxes|size|in_flight)/;

function scaleStats(r: RunData) {
  const profs = PROFILES[r.key];
  const jumps: any[] = [];
  for (const p of profs) {
    if (!p.maxJump) continue;
    if (p.maxJump.factor >= T.jumpFactor) {
      // "桶刚开启"型：partial/<x>/<k>/{frac,n_tokens} 从近 0 跳到大值，属于结构性刷新而非异常
      const isBucketFrac = /^partial\/.*\/\d+\/frac$/.test(p.tag) && p.maxJump.to === 1;
      const isBucketTokens = /^partial\/.*\/\d+\/n_tokens$/.test(p.tag);
      jumps.push({ run: r.key, tag: p.tag, fam: p.fam, factor: p.maxJump.factor, from: p.maxJump.from, to: p.maxJump.to, atStep: p.maxJump.toStep, bucketOpen: isBucketFrac || isBucketTokens });
    }
  }
  jumps.sort((a, b) => b.factor - a.factor);
  // 越界
  const outOfRange: any[] = [];
  for (const p of profs) {
    if (p.allNull) continue;
    if (RATIO_SUFFIX.test(p.tag) && !/max|min/.test(p.tag.split("/").at(-1) ?? "")) {
      const bad = p.vals.filter((v) => v < -1e-12 || v > 1 + 1e-12);
      if (bad.length) outOfRange.push({ run: r.key, tag: p.tag, kind: "ratio-out-of-[0,1]", count: bad.length, reported: p.vals.length, min: p.min, max: p.max, examples: [...new Set(bad)].slice(0, 6) });
    }
    if (COUNT_LIKE.test(p.tag)) {
      const neg = p.vals.filter((v) => v < 0);
      if (neg.length) outOfRange.push({ run: r.key, tag: p.tag, kind: "count-negative", count: neg.length, reported: p.vals.length, min: p.min, max: p.max, examples: [...new Set(neg)].slice(0, 6) });
    }
  }
  // 专门的 clip_ratio / clip 边界
  const clipRatio = profs.find((p) => p.tag === "ctx_total_length/clip_ratio");
  const clipBounds = profs.filter((p) => /^actor\/clip_(high|low)$/.test(p.tag)).map((p) => ({ tag: p.tag, distinct: p.distinct, value: p.modeValue }));
  return { run: r.key, jumps: jumps.slice(0, 80), jumpCount: jumps.length, jumpCountNonBucket: jumps.filter((j) => !j.bucketOpen).length, outOfRange, clipRatio: clipRatio ? { n: clipRatio.vals.length, min: clipRatio.min, max: clipRatio.max, over1: clipRatio.vals.filter((v) => v > 1).length } : null, clipBounds };
}

/* ------------------------------------------------------------------ *
 * 6. 结构性断点
 * ------------------------------------------------------------------ */
interface BreakHit {
  run: string;
  tag: string;
  fam: string;
  step: number;
  delta: number;
  z: number;
  rel: number;
}

function breakpointStats(r: RunData) {
  const profs = PROFILES[r.key];
  const hits: BreakHit[] = [];
  for (const p of profs) {
    if (p.vals.length < 6) continue;
    const a = r.series[p.tag];
    const ds: { step: number; d: number; rel: number }[] = [];
    for (let i = 0; i + 1 < r.steps.length; i++) {
      const x = a[i];
      const y = a[i + 1];
      if (!isNum(x) || !isNum(y)) continue;
      ds.push({ step: r.steps[i + 1], d: y - x, rel: Math.abs(y - x) / Math.max(Math.abs(x), 1e-12) });
    }
    if (ds.length < 5) continue;
    const diffs = ds.map((z) => z.d);
    const scale = 1.4826 * mad(diffs);
    const fallback = median(diffs.map((x) => Math.abs(x)));
    const sc = scale > 0 ? scale : fallback;
    if (!(sc > 0)) continue;
    for (const z of ds) {
      const zz = Math.abs(z.d) / sc;
      if (zz > T.breakZ && z.rel > T.minRelChange) hits.push({ run: r.key, tag: p.tag, fam: p.fam, step: z.step, delta: z.d, z: zz, rel: z.rel });
    }
  }
  const byStep = new Map<number, number>();
  for (const h of hits) byStep.set(h.step, (byStep.get(h.step) ?? 0) + 1);
  // 每步的分母：有多少个指标在这一步和上一步都有值（可比对的指标数）
  const denom = new Map<number, number>();
  for (const p of profs) {
    const a = r.series[p.tag];
    for (let i = 1; i < r.steps.length; i++) if (isNum(a[i - 1]) && isNum(a[i])) denom.set(r.steps[i], (denom.get(r.steps[i]) ?? 0) + 1);
  }
  const counts = r.steps.map((s) => {
    const n = denom.get(s) ?? 0;
    const bp = byStep.get(s) ?? 0;
    return { step: s, breakpoints: bp, comparableMetrics: n, rate: n ? bp / n : 0 };
  });
  const ranked = [...counts].sort((a, b) => b.breakpoints - a.breakpoints);
  const rankedRate = [...counts].sort((a, b) => b.rate - a.rate);
  const totalBP = hits.length;
  const topN = ranked.slice(0, 6).reduce((a, b) => a + b.breakpoints, 0);
  return { run: r.key, hits, counts, ranked, rankedRate, totalBreakpoints: totalBP, top6Share: totalBP ? topN / totalBP : 0 };
}

/** 重启事件 → 落在哪一步的区间里；版本切换 → 同样对齐。 */
function eventAlignment(r: RunData) {
  const restarts = r.events.filter((e) => e.kind === "restart").map((e) => e.t as number).sort((a, b) => a - b);
  const mapToStep = (t: number) => {
    for (let i = 0; i < r.steps.length; i++) if (r.walls[i] >= t) return r.steps[i];
    return null;
  };
  const mapped: { t: number; step: number | null }[] = restarts.map((t) => ({ t, step: mapToStep(t) }));
  const byStep = new Map<number, number>();
  for (const m of mapped) if (m.step !== null) byStep.set(m.step, (byStep.get(m.step) ?? 0) + 1);
  // 每一步的区间与真实墙钟
  const intervals = r.steps.map((s, i) => {
    const prevWall = i === 0 ? r.runStart : r.walls[i - 1];
    const wall = r.walls[i];
    const inInterval = restarts.filter((t) => t > prevWall && t <= wall);
    const noticesIn = r.notices.filter((n) => n.t > prevWall && n.t <= wall);
    const versionsIn = r.versions.filter((v) => v.at > prevWall && v.at <= wall);
    return { step: s, prevWall, wall, wallDelta: wall - prevWall, restarts: inInterval.length, notices: noticesIn.map((n) => n.id), versions: versionsIn.map((v) => v.version) };
  });
  return {
    run: r.key,
    restartEvents: restarts.length,
    restartsByStep: [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, n]) => ({ step, n })),
    multiRestartSteps: [...byStep.entries()].filter(([, n]) => n > 1).map(([step, n]) => ({ step, n })),
    intervals,
  };
}

/* ------------------------------------------------------------------ *
 * 7. 指标生命周期
 * ------------------------------------------------------------------ */
function lifecycleStats(r: RunData) {
  const firstCount = new Map<number, number>();
  const lastCount = new Map<number, number>();
  for (const t of Object.keys(r.tagLife)) {
    const l = r.tagLife[t];
    firstCount.set(l.first_seen, (firstCount.get(l.first_seen) ?? 0) + 1);
    lastCount.set(l.last_seen, (lastCount.get(l.last_seen) ?? 0) + 1);
  }
  const latestSync = Math.max(...Object.values(r.tagLife).map((l) => l.last_seen), 0);
  const firstSync = Math.min(...Object.values(r.tagLife).map((l) => l.first_seen), Infinity);
  const lateComers = Object.entries(r.tagLife)
    .filter(([, l]) => l.first_seen > firstSync)
    .map(([tag, l]) => ({ tag, first_seen: l.first_seen, versionAt: r.versions.find((v) => v.at === l.first_seen)?.version ?? null }));
  // 版本 n 的净变化 vs first_seen 的新增 → 推断"消失"数量
  const vers = r.versions;
  let removals = 0;
  const removalByInterval: any[] = [];
  for (let i = 1; i < vers.length; i++) {
    const added = Object.values(r.tagLife).filter((l) => l.first_seen > vers[i - 1].at && l.first_seen <= vers[i].at).length;
    const delta = vers[i].n - vers[i - 1].n;
    const removed = added - delta;
    removals += removed;
    removalByInterval.push({ from: vers[i - 1].version, to: vers[i].version, nFrom: vers[i - 1].n, nTo: vers[i].n, delta, added, removed });
  }
  const lifeEndsAtLatest = Object.values(r.tagLife).filter((l) => l.last_seen >= latestSync).length;
  // 版本切换点 → 对应步号（用 at 落在哪个 step 区间）
  const stepOfTime = (t: number) => {
    for (let i = 0; i < r.steps.length; i++) if (r.walls[i] >= t) return r.steps[i];
    return null;
  };
  const versionSteps = vers.map((v) => ({ version: v.version, at: v.at, n: v.n, step: stepOfTime(v.at) }));
  return {
    run: r.key,
    tagCount: Object.keys(r.tagLife).length,
    firstSync,
    latestSync,
    firstSeenHistogram: [...firstCount.entries()].sort((a, b) => a[0] - b[0]).map(([at, n]) => ({ at, n, version: vers.find((v) => v.at === at)?.version ?? null })),
    lastSeenHistogram: [...lastCount.entries()].sort((a, b) => a[0] - b[0]).map(([at, n]) => ({ at, n })),
    lateComers,
    lateComerCount: lateComers.length,
    tagsWithLastSeenAtLatest: lifeEndsAtLatest,
    inferredRemovals: removals,
    removalByInterval,
    versionSteps,
  };
}

/**
 * 语义漂移：同一个指标名在某个版本切换前后，取值量级整体位移。
 * 判据：以版本切换所在的步为界，前段与后段各有 ≥3 个值，且两段中位数之比（大/小，忽略 0）
 *       达到 driftFactor，且两段的取值区间不重叠。
 */
function driftStats(r: RunData) {
  const profs = PROFILES[r.key];
  const vers = r.versions;
  const stepOfTime = (t: number) => {
    for (let i = 0; i < r.steps.length; i++) if (r.walls[i] >= t) return r.steps[i];
    return null;
  };
  const boundaries = vers.slice(1).map((v) => ({ version: v.version, at: v.at, step: stepOfTime(v.at) })).filter((b) => b.step !== null) as { version: string; at: number; step: number }[];
  const hits: any[] = [];
  for (const p of profs) {
    if (p.vals.length < 8) continue;
    for (const b of boundaries) {
      const before: number[] = [];
      const after: number[] = [];
      for (let i = 0; i < r.steps.length; i++) {
        const v = r.series[p.tag]?.[i];
        if (!isNum(v)) continue;
        if (r.steps[i] < b.step) before.push(v);
        else after.push(v);
      }
      if (before.length < 3 || after.length < 3) continue;
      const mb = median(before);
      const ma = median(after);
      const ab = Math.abs(mb);
      const aa = Math.abs(ma);
      if (ab === 0 || aa === 0) continue;
      const ratio = Math.max(ab, aa) / Math.min(ab, aa);
      const rangeB = [Math.min(...before), Math.max(...before)];
      const rangeA = [Math.min(...after), Math.max(...after)];
      const overlap = Math.min(rangeB[1], rangeA[1]) >= Math.max(rangeB[0], rangeA[0]);
      const sameSign = Math.sign(mb) === Math.sign(ma);
      if (ratio >= T.driftFactor && !overlap && sameSign) {
        hits.push({ run: r.key, tag: p.tag, fam: p.fam, version: b.version, atStep: b.step, beforeMedian: mb, afterMedian: ma, ratio, beforeN: before.length, afterN: after.length });
      }
    }
  }
  hits.sort((a, b) => b.ratio - a.ratio);
  // 去重：同一 tag 只留比值最大的那次
  const seen = new Set<string>();
  const dedup = hits.filter((h) => (seen.has(h.tag) ? false : (seen.add(h.tag), true)));
  return { run: r.key, boundaries, driftHits: dedup.slice(0, 80), driftCount: dedup.length };
}

/* ------------------------------------------------------------------ *
 * 8. 文档一致性
 * ------------------------------------------------------------------ */
function expandDocId(id: string): RegExp | null {
  if (id === "notices" || id.startsWith("benchmark/")) return null; // 不是 series 指标
  let pat = id.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "*" ? m : "\\" + m));
  pat = pat.replace(/\*/g, "[^/]+");
  pat = pat.replace(/<cat>/g, "(code|general|cyber|visual|chat)");
  pat = pat.replace(/<id>/g, "[a-z0-9]+");
  pat = pat.replace(/<k>/g, "\\d+");
  if (/[<>]/.test(pat)) return null;
  return new RegExp("^" + pat + "$");
}

/** 族条目用的松散匹配：允许 id 的每一段之间再插若干段（dataset-xxx 之类）。 */
function looseRe(id: string): RegExp {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + id.split("/").map(esc).join("(/[^/]+)*/") + "$");
}

function docAudit(metrics: any[]) {
  const allTags = new Set<string>();
  for (const r of RUNS) for (const t of Object.keys(r.series)) allTags.add(t);
  const perId: any[] = [];
  for (const it of metrics) {
    const re = expandDocId(it.id);
    if (!re) {
      perId.push({ id: it.id, kind: "pseudo", matched: 0 });
      continue;
    }
    let matched = [...allTags].filter((t) => re.test(t));
    let kind = it.id.includes("<") || it.id.includes("*") ? "pattern" : "exact";
    // 有些条目是"族条目"：id 写族名，实际指标中间还多一层（如 actor/code/dataset-xxx/entropy_loss）
    if (!matched.length && kind === "exact") {
      const loose = looseRe(it.id);
      matched = [...allTags].filter((t) => loose.test(t));
      if (matched.length) kind = "family";
    }
    perId.push({ id: it.id, kind, matched: matched.length, sample: matched.slice(0, 5) });
  }
  // 未被任何 id（含族条目）覆盖的指标
  const reByIndex = new Map<number, RegExp | null>(perId.map((p, i) => [i, expandDocId(metrics[i].id)]));
  const uncovered = [...allTags].filter((t) =>
    !perId.some((p, i) => {
      if (p.kind === "pseudo" || p.matched === 0) return false;
      const re = reByIndex.get(i);
      if (re && re.test(t)) return true;
      return p.kind === "family" && looseRe(p.id).test(t);
    }),
  );
  // 覆盖族
  const coveredFams = new Map<string, number>();
  for (const t of allTags) if (!uncovered.includes(t)) coveredFams.set(family(t), (coveredFams.get(family(t)) ?? 0) + 1);
  // 按族统计未覆盖，并给出"最该补"排序：官方面板 pin > 官方 descriptions > 族内指标数 × 覆盖率
  const famAgg = new Map<string, { n: number; covSum: number; pinned: number; described: number; varianceSum: number; examples: string[] }>();
  for (const r of RUNS) {
    for (const p of PROFILES[r.key]) {
      if (!uncovered.includes(p.tag)) continue;
      if (p.allNull) continue;
      const e = famAgg.get(p.fam) ?? { n: 0, covSum: 0, pinned: 0, described: 0, varianceSum: 0, examples: [] };
      e.n++;
      e.covSum += p.coverage;
      if (p.tag in meta.descriptions) e.described++;
      if (meta.pins?.includes(p.tag)) e.pinned++;
      const rng = p.max - p.min;
      e.varianceSum += Math.abs(p.mean) > 0 ? rng / Math.abs(p.mean) : 0;
      if (e.examples.length < 3) e.examples.push(p.tag);
      famAgg.set(p.fam, e);
    }
  }
  const priority = [...famAgg.entries()]
    .map(([fam, e]) => ({
      fam,
      metrics: e.n,
      meanCoverage: e.covSum / e.n,
      pinned: e.pinned,
      described: e.described,
      meanRelRange: e.varianceSum / e.n,
      examples: e.examples,
      score: e.n * (e.covSum / e.n) * (1 + Math.min(e.varianceSum / e.n, 5)),
    }))
    .sort((a, b) => b.score - a.score);
  const descKeys = Object.keys(meta.descriptions ?? {});
  const descMissing: string[] = [];
  const descMatchCount: Record<string, number> = {};
  for (const k of descKeys) {
    const re = expandDocId(k);
    if (!re) {
      descMatchCount[k] = -1;
      continue;
    }
    // 官方说明里的族名（例如 dynsam/passrate/hist9_ratio）实际指标名带子桶，允许前缀命中
    const m = [...allTags].filter((t) => re.test(t) || t.startsWith(k + "/")).length;
    descMatchCount[k] = m;
    if (m === 0) descMissing.push(k);
  }
  const matchedTags = new Set<string>();
  for (const t of allTags)
    for (const [i, p] of perId.entries()) {
      if (p.kind === "pseudo" || p.matched === 0) continue;
      const re = reByIndex.get(i);
      if ((re && re.test(t)) || (p.kind === "family" && looseRe(p.id).test(t))) {
        matchedTags.add(t);
        break;
      }
    }
  return { taggedMetricCount: allTags.size, matchedByDoc: matchedTags.size, perId, officialDescriptions: { total: descKeys.length, missing: descMissing, matchCount: descMatchCount }, unmatchedIds: perId.filter((x) => x.kind !== "pseudo" && x.matched === 0), uncoveredCount: uncovered.length, uncoveredByFamily: [...(() => {
    const m = new Map<string, number>();
    for (const t of uncovered) m.set(family(t), (m.get(family(t)) ?? 0) + 1);
    return m;
  })()].sort((a, b) => b[1] - a[1]).map(([fam, n]) => ({ fam, n })), priorityFamilies: priority.slice(0, 20) };
}

/* ------------------------------------------------------------------ *
 * 9. 抽查：解读里的 observed 数字 vs 现算
 * ------------------------------------------------------------------ */
interface Claim {
  docId: string;
  metric: string;
  step?: number;
  claim: string;
  check: (r: RunData) => { actual: string; ok: boolean; detail: string; stale?: boolean };
}

function mk(runKey: string) {
  const r = RUNS.find((x) => x.key === runKey)!;
  const idx = new Map(r.steps.map((s, i) => [s, i]));
  const get = (tag: string, step: number): number | null => {
    const i = idx.get(step);
    if (i === undefined) return null;
    const v = r.series[tag]?.[i];
    return isNum(v) ? v : null;
  };
  const col = (tag: string) => (r.series[tag] ?? []).filter(isNum);
  return { r, get, col };
}

const CLAIMS: Claim[] = [
  {
    docId: "dynsam/avg@n",
    metric: "dynsam/avg@n",
    claim: "flash step 1 0.513693 → step 25 0.640833 (+12.71pp), the max is the last step 0.640833",
    check: () => {
      const { r, get, col } = mk("flash");
      const win = { steps: r.steps.filter((s) => s <= 25) };
      const a = get("dynsam/avg@n", 1);
      const b = get("dynsam/avg@n", 25);
      const inWin = win.steps.map((s) => get("dynsam/avg@n", s)).filter(isNum) as number[];
      const mxWin = Math.max(...inWin);
      const full = col("dynsam/avg@n");
      const mxFull = Math.max(...full);
      const mxFullStep = r.steps[full.indexOf(mxFull)];
      const ok = a === 0.513693 && b === 0.640833 && mxWin === b;
      return {
        actual: `step1=${a}, step25=${b}; max in the writing window (≤step25) ${mxWin}; max over the full range (30 steps) ${mxFull}@step${mxFullStep}, last step ${full.at(-1)}`,
        ok,
        stale: mxFullStep !== 25,
        detail: ok ? "both numbers cited by the explainer and its \"max is the last step\" hold inside the writing window; but it is no longer the current last step" : "explainer numbers do not match",
      };
    },
  },
  {
    docId: "ctx_total_length/max",
    metric: "ctx_total_length/max",
    claim: "pro: 8 of 19 steps equal 1048570; flash: 17 of 25 steps equal 1048570, step 14 is 2236430, 2.13× the cap",
    check: () => {
      const p = mk("pro");
      const f = mk("flash");
      const cnt = (m: ReturnType<typeof mk>, maxStep: number) => m.r.steps.filter((s) => s <= maxStep && m.get("ctx_total_length/max", s) === 1048570).length;
      const pcWin = cnt(p, 19);
      const fcWin = cnt(f, 25);
      const pcAll = cnt(p, 24);
      const fcAll = cnt(f, 30);
      const fx = f.get("ctx_total_length/max", 14);
      const ok = pcWin === 8 && fcWin === 17 && fx === 2236430;
      return {
        actual: `in the writing window pro ${pcWin}/19, flash ${fcWin}/25 steps =1048570; current full range pro ${pcAll}/24, flash ${fcAll}/30; flash step14=${fx} (${(fx! / 1048570).toFixed(2)}× 1048570)`,
        ok,
        stale: pcAll !== pcWin || fcAll !== fcWin,
        detail: ok ? "the explainer reproduces exactly inside its writing window; step counts changed under the full-range convention" : "explainer numbers do not match",
      };
    },
  },
  {
    docId: "critic/rewards/max",
    metric: "critic/rewards/max",
    claim: "all steps in both runs are 1 (pro 19 steps, flash 25 steps, 44 values in total)",
    check: () => {
      const p = mk("pro");
      const f = mk("flash");
      const pv = p.col("critic/rewards/max");
      const fv = f.col("critic/rewards/max");
      const allOnes = [...pv, ...fv].every((v) => v === 1);
      const winOnes = p.r.steps.filter((s) => s <= 19).every((s) => p.get("critic/rewards/max", s) === 1) && f.r.steps.filter((s) => s <= 25).every((s) => f.get("critic/rewards/max", s) === 1);
      return {
        actual: `pro ${pv.length} values, flash ${fv.length} values, all 1=${allOnes} (also all 1 inside the writing window=${winOnes}), ${pv.length + fv.length} values in total`,
        ok: allOnes && winOnes,
        stale: pv.length !== 19 || fv.length !== 25,
        detail: allOnes ? "values are still all 1; only the step counts changed from 19/25 to 24/30" : "a non-1 value appeared",
      };
    },
  },
  {
    docId: "benchmark/lag",
    metric: "benchmark/deepswe",
    claim: "the (offline board vs training) lag is exactly 4 steps in both runs",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const r of RUNS) {
        const rows = r.benchmarks.filter((b) => b.results?.[r.key]);
        const maxB = Math.max(...rows.flatMap((b: any) => Object.keys(b.results[r.key]).map(Number)));
        const trainLast = r.steps.at(-1)!;
        const lag = trainLast - maxB;
        out.push(`${r.key}: board ${maxB}, training ${trainLast}, lag=${lag}`);
        if (lag !== 4) ok = false;
      }
      return { actual: out.join("; "), ok, stale: !ok, detail: ok ? "still 4" : "lag is no longer 4: the board is backfilled by hand and training continues, so \"4 steps\" was just a coincidence at the time" };
    },
  },
  {
    docId: "training/global_step",
    metric: "training/global_step",
    claim: "pro global_step 1~19, flash 1~25; steps 16 and 17 each have a redo in the flash events",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const r of RUNS) {
        const winLast = r.key === "pro" ? 19 : 25;
        const win = (r.series["training/global_step"] ?? []).filter(isNum).filter((v) => v <= winLast);
        const gs = (r.series["training/global_step"] ?? []).filter(isNum);
        const stepEvents = r.events.filter((e) => e.kind === "step");
        const cnt = new Map<number, number>();
        for (const e of stepEvents) cnt.set(e.step, (cnt.get(e.step) ?? 0) + 1);
        const redo = [...cnt.entries()].filter(([, n]) => n > 1).map(([s, n]) => `${s}(${n})`);
        out.push(`${r.key}: writing window 1~${win.at(-1)} (doc says 1~${winLast}), current 1~${gs.at(-1)}, ${stepEvents.length} events, duplicate steps ${redo.join(",") || "none"}`);
        if (r.key === "pro" && win.at(-1) !== 19) ok = false;
        if (r.key === "flash" && win.at(-1) !== 25) ok = false;
      }
      return { actual: out.join("; "), ok, stale: true, detail: ok ? "the range matches inside the writing window; the current step count has advanced" : "range does not match" };
    },
  },
  {
    docId: "partial/avg_staleness",
    metric: "partial/avg_staleness",
    claim: "pro peak 1.8208 at step 9, steps 1/15 are 0; flash peak 2.1832 at step 24, steps 1/16 are 0",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const key of ["pro", "flash"]) {
        const m = mk(key);
        const winLast = key === "pro" ? 19 : 25;
        const winVals = m.r.steps.filter((s) => s <= winLast).map((s) => m.get("partial/avg_staleness", s)).filter(isNum) as number[];
        const fullVals = m.col("partial/avg_staleness");
        const mxWin = Math.max(...winVals);
        const mxFull = Math.max(...fullVals);
        const mxFullStep = m.r.steps[m.col("partial/avg_staleness").indexOf(mxFull)];
        const zeros = m.r.steps.filter((s) => m.get("partial/avg_staleness", s) === 0);
        out.push(`${key}: window peak ${round(mxWin, 4)}; full-range peak ${round(mxFull, 4)}@step${mxFullStep}; zero steps ${zeros.join(",")}`);
        if (key === "pro" && Math.abs(mxWin - 1.8208) > 5e-5) ok = false;
        if (key === "flash" && Math.abs(mxWin - 2.1832) > 5e-5) ok = false;
      }
      return { actual: out.join("; "), ok, stale: true, detail: ok ? "the peak matches the explainer, but the explainer window only goes to pro19/flash25" : "peaks do not match" };
    },
  },
  {
    docId: "env/possible_leak",
    metric: "env/possible_leak",
    claim: "pro: 18 of 19 steps are 0, only step 19 is 1; flash is all 0",
    check: () => {
      const p = mk("pro");
      const f = mk("flash");
      const nzWin = p.r.steps.filter((s) => s <= 19).filter((s) => {
        const v = p.get("env/possible_leak", s);
        return v !== null && v !== 0;
      });
      const nzAll = p.r.steps.filter((s) => {
        const v = p.get("env/possible_leak", s);
        return v !== null && v !== 0;
      });
      const fv = f.col("env/possible_leak");
      const ok = nzWin.length === 1 && nzWin[0] === 19 && fv.every((v) => v === 0);
      return {
        actual: `non-zero steps for pro in the writing window=[${nzWin.join(",")}]; non-zero steps for pro over the full range=[${nzAll.join(",")}] (${(p.r.series["env/possible_leak"] ?? []).filter(isNum).length} reported values); non-zero count for flash=${fv.filter((v) => v !== 0).length}`,
        ok,
        stale: nzAll.length !== nzWin.length,
        detail: ok ? "matches inside the writing window; the full range has 3 more non-zero steps" : "does not match",
      };
    },
  },
  {
    docId: "timing_s/step",
    metric: "timing_s/step",
    claim: "all pro restart gaps fall on steps 1, 2, 3, 11, 15, 17; other steps differ by <2 minutes",
    check: () => {
      const r = RUNS[0];
      const stepEvents = r.events.filter((e) => e.kind === "step");
      const lastOf = new Map<number, number>();
      for (const e of stepEvents) lastOf.set(e.step, e.t);
      const rows: any[] = [];
      for (let i = 0; i < r.steps.length; i++) {
        const prev = i === 0 ? r.runStart : (lastOf.get(r.steps[i - 1]) ?? r.walls[i - 1]);
        const wall = lastOf.get(r.steps[i]) ?? r.walls[i];
        const reported = r.series["timing_s/step"]?.[i];
        if (!isNum(reported)) continue;
        rows.push({ step: r.steps[i], gap: wall - prev - reported });
      }
      const bigWin = rows.filter((x) => x.gap > 120 && x.step <= 19).map((x) => x.step);
      const big = rows.filter((x) => x.gap > 120).map((x) => x.step);
      const ok = JSON.stringify(bigWin) === JSON.stringify([1, 2, 3, 11, 15, 17]);
      return {
        actual: `steps with gap >2min in the writing window (≤19 steps)=[${bigWin.join(",")}]; current full range=[${big.join(",")}]; total gap over the full range ${round(sum(rows.filter((x) => x.gap > 0).map((x) => x.gap)) / 3600, 2)}h`,
        ok,
        stale: JSON.stringify(big) !== JSON.stringify(bigWin),
        detail: ok ? "matches inside the writing window; step 23 later gained another 3.5h gap" : "the steps carrying the gaps changed",
      };
    },
  },
  {
    docId: "penalty/signed/pos_scale_clamped",
    metric: "penalty/signed/pos_scale_clamped",
    claim: "pro is all 0; flash steps 1~19 are 0 and steps 20~25 are null",
    check: () => {
      const out: string[] = [];
      for (const key of ["pro", "flash"]) {
        const m = mk(key);
        const a = m.r.series["penalty/signed/pos_scale_clamped"];
        if (!a) {
          out.push(`${key}: not present in series`);
          continue;
        }
        const nulls = m.r.steps.filter((s) => m.get("penalty/signed/pos_scale_clamped", s) === null);
        const nz = m.r.steps.filter((s) => {
          const v = m.get("penalty/signed/pos_scale_clamped", s);
          return v !== null && v !== 0;
        });
        out.push(`${key}: reported ${m.col("penalty/signed/pos_scale_clamped").length} steps, null steps [${nulls.join(",")}], non-zero steps [${nz.join(",")}]`);
      }
      const f = mk("flash");
      const fnull = f.r.steps.filter((s) => f.get("penalty/signed/pos_scale_clamped", s) === null);
      const ok = fnull[0] === 20 && f.r.steps.filter((s) => s <= 19).every((s) => f.get("penalty/signed/pos_scale_clamped", s) === 0);
      return { actual: out.join("; "), ok, stale: fnull.at(-1) !== 25, detail: ok ? "the structure matches: flash cuts off completely from step 20, and its last step has extended to 30" : "the cut-off position changed" };
    },
  },
  {
    docId: "perf/total_num_tokens",
    metric: "perf/total_num_tokens",
    claim: "pro deviation over 19 steps -0.18%~-1.19% (mean 0.46%); flash -0.29%~-2.77% (mean 0.77%)",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const key of ["pro", "flash"]) {
        const m = mk(key);
        const winLast = key === "pro" ? 19 : 25;
        const calc = (maxStep: number) => {
          const rows: number[] = [];
          for (const s of m.r.steps.filter((x) => x <= maxStep)) {
            const t = m.get("perf/total_num_tokens", s);
            const c = m.get("ctx_total_length/mean", s);
            if (t === null || c === null) continue;
            rows.push((t - 1568 * 16 * c) / (1568 * 16 * c));
          }
          return rows;
        };
        const w = calc(winLast);
        const all = calc(1e9);
        const fmt = (v: number[]) => `${(Math.min(...v) * 100).toFixed(2)}%~${(Math.max(...v) * 100).toFixed(2)}% (mean ${((sum(v.map(Math.abs)) / v.length) * 100).toFixed(2)}%, ${v.length} steps)`;
        out.push(`${key}: window ${fmt(w)}; full range ${fmt(all)}`);
        if (key === "pro" && (Math.abs(Math.min(...w) + 0.0119) > 2e-4 || Math.abs(Math.max(...w) + 0.0018) > 2e-4)) ok = false;
        if (key === "flash" && (Math.abs(Math.min(...w) + 0.0277) > 2e-4 || Math.abs(Math.max(...w) + 0.0029) > 2e-4)) ok = false;
      }
      return { actual: out.join("; "), ok, stale: true, detail: ok ? "both explainer numbers reproduce exactly inside the writing window; the full range widens slightly" : "numbers do not match" };
    },
  },
  {
    docId: "actor/lr",
    metric: "actor/lr",
    claim: "pro 19 steps and flash 25 steps are all 0.000003",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const key of ["pro", "flash"]) {
        const m = mk(key);
        const v = m.col("actor/lr");
        out.push(`${key}: currently ${v.length} steps, distinct=${new Set(v).size}, values=${[...new Set(v)].join(",")}`);
        if (new Set(v).size !== 1 || v[0] !== 0.000003) ok = false;
      }
      return { actual: out.join("; "), ok, stale: true, detail: ok ? "still constant at 3e-6 (the explainer step counts are stale)" : "values changed" };
    },
  },
  {
    docId: "dynsam/num_target",
    metric: "dynsam/num_target",
    claim: "pro all 19 steps 1568; flash all 25 steps 1568",
    check: () => {
      const out: string[] = [];
      let ok = true;
      for (const key of ["pro", "flash"]) {
        const m = mk(key);
        const v = m.col("dynsam/num_target");
        out.push(`${key}: currently ${v.length} steps, distinct=${new Set(v).size}`);
        if (new Set(v).size !== 1 || v[0] !== 1568) ok = false;
      }
      return { actual: out.join("; "), ok, stale: true, detail: ok ? "still constant at 1568 (the explainer step counts are stale)" : "values changed" };
    },
  },
];


/* ------------------------------------------------------------------ *
 * 10. 重启指纹：哪些步是重启步（用数据内部信号判定，不依赖 events）
 * ------------------------------------------------------------------ */
function restartFingerprint(r: RunData) {
  const idx = new Map(r.steps.map((s, i) => [s, i]));
  const num = (tag: string, step: number): number | null => {
    const i = idx.get(step);
    if (i === undefined) return null;
    const v = r.series[tag]?.[i];
    return isNum(v) ? v : null;
  };
  // 信号 1：全局 partial/0/frac 精确等于 1（这一步的数据 100% 是新采的）
  const freshSteps = r.steps.filter((s) => num("partial/0/frac", s) === 1);
  // 信号 2：avg_staleness 精确等于 0
  const staleZero = r.steps.filter((s) => num("partial/avg_staleness", s) === 0);
  // 信号 3：per-step 计数器的锯齿（env/total_setup 等"进程内累计量"下降）
  const resets: { tag: string; step: number; from: number; to: number }[] = [];
  for (const tag of Object.keys(r.series)) {
    if (!/(^env\/total_|^training\/|_cum$|\/total_setup$)/.test(tag)) continue;
    const a = r.series[tag];
    for (let i = 1; i < r.steps.length; i++) {
      const x = a[i - 1];
      const y = a[i];
      if (!isNum(x) || !isNum(y)) continue;
      if (y < x * 0.5 && x > 0) resets.push({ tag, step: r.steps[i], from: x, to: y });
    }
  }
  const resetSteps = [...new Set(resets.map((x) => x.step))].sort((a, b) => a - b);
  return { run: r.key, freshSteps, staleZero, resetSteps, resetExamples: resets.slice(0, 12) };
}

/* ------------------------------------------------------------------ *
 * 11. 数据集级"报 0"三元对齐（ol8x / gtav 类问题）
 * ------------------------------------------------------------------ */
function datasetZeroAlignment(r: RunData) {
  const steps = r.steps;
  const num = (tag: string, i: number): number | null => {
    const v = r.series[tag]?.[i];
    return isNum(v) ? v : null;
  };
  const datasets = [
    ...new Set(
      Object.keys(r.series)
        .map((t) => /^dynsam\/([a-z]+)\/dataset-[a-z0-9]+\/num_accepted\/step$/.exec(t)?.[0])
        .filter(Boolean),
    ),
  ] as string[];
  const perDataset: any[] = [];
  for (const key of datasets) {
    const base = key.replace(/^dynsam\//, "").replace(/\/num_accepted\/step$/, "");
    const tag = `train/passrate/avg_passrate/${base}`;
    if (!(tag in r.series)) continue;
    const zeroSteps: number[] = [];
    const nullSteps: number[] = [];
    const staleNull: number[] = [];
    const eqHeld: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      const v = num(tag, i);
      if (v === null) nullSteps.push(steps[i]);
      else if (v === 0) zeroSteps.push(steps[i]);
      const fr = num(`partial/${base}/1/frac`, i);
      if (fr === null) staleNull.push(steps[i]);
      const st = num(`dynsam/${base}/num_accepted/step`, i);
      const hd = num(`dynsam/${base}/num_accepted/held`, i);
      if (st !== null && hd !== null && st === hd) eqHeld.push(steps[i]);
    }
    if (!zeroSteps.length) continue;
    const agree = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
    perDataset.push({
      dataset: base,
      zeroCount: zeroSteps.length,
      zeroSteps,
      nullSteps,
      alignedWithBucket1Null: agree(zeroSteps, staleNull),
      alignedWithStepEqHeld: agree(zeroSteps, eqHeld),
    });
  }
  const allZero = perDataset.flatMap((d) => d.zeroSteps);
  return {
    run: r.key,
    datasets: perDataset,
    totalZeroCells: allZero.length,
    zeroStepUnion: [...new Set(allZero)].sort((a, b) => a - b),
  };
}

/* ------------------------------------------------------------------ *
 * 12. 上下文长度上限：逐指标反复取到的"整齐大值"
 * ------------------------------------------------------------------ */
function capStats(r: RunData) {
  const hits: any[] = [];
  for (const tag of Object.keys(r.series)) {
    if (!/^ctx_(total|prompt|response)_length\/.*(max|p99|p90)$/.test(tag)) continue;
    const vals = (r.series[tag] ?? []).filter(isNum);
    if (vals.length < 5) continue;
    const cnt = new Map<number, number>();
    for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    let mode = 0;
    let modeC = 0;
    for (const [v, c] of cnt) if (c > modeC) ((modeC = c), (mode = v));
    const mx = Math.max(...vals);
    if (modeC >= 3 && mode === mx && mode > 1000 && isRoundValue(mode)) {
      hits.push({ tag, capValue: mode, count: modeC, reported: vals.length, share: modeC / vals.length, isMax: true });
    }
  }
  const byValue = new Map<number, any[]>();
  for (const h of hits) {
    if (!byValue.has(h.capValue)) byValue.set(h.capValue, []);
    byValue.get(h.capValue)!.push(h);
  }
  return {
    run: r.key,
    hits: hits.sort((a, b) => b.count - a.count),
    tiers: [...byValue.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([v, l]) => ({ capValue: v, metrics: l.length, examples: l.slice(0, 6).map((x: any) => `${x.tag}(${x.count}/${x.reported})`) })),
  };
}

/* ------------------------------------------------------------------ *
 * 13. 累计口径（running mean）：单调递增、增量恒正的 ratio/rate/frac/share
 * ------------------------------------------------------------------ */
function cumulativeStats(r: RunData) {
  const monotone: any[] = [];
  const sawtooth: any[] = [];
  for (const tag of Object.keys(r.series)) {
    if (!/(ratio|rate|frac|share)$/.test(tag)) continue;
    const a = r.series[tag];
    const v = a.filter(isNum) as number[];
    if (v.length < 10) continue;
    const d: number[] = [];
    for (let i = 1; i < v.length; i++) d.push(v[i] - v[i - 1]);
    const neg = d.filter((x) => x < 0).length;
    const pos = d.filter((x) => x > 0).length;
    if (neg === 0 && pos >= v.length - 2) monotone.push({ tag, n: v.length, first: v[0], last: v.at(-1), valueChange: v.at(-1)! - v[0] });
    // 锯齿：整体上行但中途出现 ≥1 次大幅回撤（回撤幅度 >= 此前累计涨幅的一部分）
    const drops = d.map((x, i) => ({ x, i })).filter((z) => z.x < 0);
    if (drops.length && drops.length <= 4 && pos > drops.length) {
      sawtooth.push({ tag, n: v.length, drops: drops.map((z) => ({ atStep: r.steps[z.i + 1], delta: round(z.x, 6) })), first: v[0], last: v.at(-1) });
    }
  }
  return { run: r.key, monotone, sawtooth };
}

/* ------------------------------------------------------------------ *
 * 14. 量级漂移（不依赖版本号）：把序列切成两段，中位数比值最大且区间不重叠
 * ------------------------------------------------------------------ */
function levelShift(r: RunData) {
  const hits: any[] = [];
  for (const tag of Object.keys(r.series)) {
    const a = r.series[tag];
    const idxs: number[] = [];
    for (let i = 0; i < r.steps.length; i++) if (isNum(a[i])) idxs.push(i);
    if (idxs.length < 10) continue;
    let best: any = null;
    for (let cut = 5; cut <= idxs.length - 5; cut++) {
      const before = idxs.slice(0, cut).map((i) => a[i] as number);
      const after = idxs.slice(cut).map((i) => a[i] as number);
      const mb = median(before);
      const ma = median(after);
      if (!(Math.abs(mb) > 0) || !(Math.abs(ma) > 0)) continue;
      if (Math.sign(mb) !== Math.sign(ma)) continue;
      const ratio = Math.max(Math.abs(mb), Math.abs(ma)) / Math.min(Math.abs(mb), Math.abs(ma));
      if (ratio < T.driftFactor) continue;
      const overlap = Math.min(Math.max(...before), Math.max(...after)) >= Math.max(Math.min(...before), Math.min(...after));
      if (overlap) continue;
      if (!best || ratio > best.ratio)
        best = { tag, atStep: r.steps[idxs[cut]], beforeMedian: mb, afterMedian: ma, ratio, beforeN: before.length, afterN: after.length };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.ratio - a.ratio);
  return { run: r.key, hits: hits.slice(0, 60), count: hits.length };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
const metricsDoc: any[] = readJson(join(CONTENT, "metrics.json"), { items: [] }).items ?? [];

const result: any = {
  generated_from: {
    store: "data/store",
    metrics_doc: "content/metrics.json",
    script: "src/audit_report.ts",
  },
  thresholds: T,
  overview,
  identity: {} as any,
  constants: {} as any,
  coverage: {} as any,
  sentinels: {} as any,
  scale: {} as any,
  breakpoints: {} as any,
  eventAlignment: {} as any,
  lifecycle: {} as any,
  drift: {} as any,
  restartFingerprint: {} as any,
  datasetZeros: {} as any,
  caps: {} as any,
  cumulative: {} as any,
  levelShift: {} as any,
  docAudit: null as any,
  claims: [] as any[],
};

for (const r of RUNS) {
  const profs = PROFILES[r.key];
  const { hits, scannedPairs, skippedNoOverlap } = pairwiseIdentities(r, profs);
  const sparseOf = (tag: string) => {
    const p = profs.find((x) => x.tag === tag);
    if (!p) return true;
    // 稀疏 = 取值种类太少 / 几乎全是 0 / 上报步数太少。这三类都会让"两条曲线完全相同"变成巧合
    return p.distinct < 3 || (isNum(p.zeroShareNonNull) && p.zeroShareNonNull >= 0.8) || p.coverage < 0.5 || p.vals.length < 8;
  };
  const clusters = clusterIdentities(hits, sparseOf);
  const denseClusters = clusters.filter((c) => !c.sparse);
  const identical = hits.filter((h) => h.kind === "identical");
  const affine = hits.filter((h) => h.kind === "affine-exact" || h.kind === "affine-near");
  const correlated = hits.filter((h) => h.kind === "correlated");
  result.identity[r.key] = {
    metricsConsidered: profs.filter((p) => !p.allNull && !p.constant && p.vals.length >= 5).length,
    pairsScanned: scannedPairs,
    pairsSkippedNoOverlap: skippedNoOverlap,
    identicalPairs: identical.length,
    afflineExactPairs: hits.filter((h) => h.kind === "affine-exact").length,
    affineNearPairs: hits.filter((h) => h.kind === "affine-near").length,
    correlatedOnlyPairs: correlated.length,
    clustersTop: clusters.filter((c) => !c.sparse).slice(0, 25),
    clusterCount: clusters.length,
    denseClusterCount: denseClusters.length,
    sparseClusterCount: clusters.length - denseClusters.length,
    denseClusterMembers: denseClusters.reduce((a, c) => a + c.size, 0),
    largeSparseClusters: clusters.filter((c) => c.sparse && c.size >= 2).slice(0, 6),
    largestClusterSize: clusters[0]?.size ?? 0,
    examples: { identical: identical.slice(0, 10), affine: affine.slice(0, 10), correlated: correlated.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 10) },
    curated: curatedIdentities(r),
  };
  result.constants[r.key] = constantStats(r);
  result.coverage[r.key] = coverageStats(r);
  result.sentinels[r.key] = sentinelStats(r);
  result.scale[r.key] = scaleStats(r);
  result.breakpoints[r.key] = breakpointStats(r);
  result.eventAlignment[r.key] = eventAlignment(r);
  result.lifecycle[r.key] = lifecycleStats(r);
  result.drift[r.key] = driftStats(r);
  result.restartFingerprint[r.key] = restartFingerprint(r);
  result.datasetZeros[r.key] = datasetZeroAlignment(r);
  result.caps[r.key] = capStats(r);
  result.cumulative[r.key] = cumulativeStats(r);
  result.levelShift[r.key] = levelShift(r);
}

result.docAudit = docAudit(metricsDoc);
result.claims = CLAIMS.map((c) => {
  const res = c.check(RUNS[0]) as any;
  return { docId: c.docId, metric: c.metric, claim: c.claim, actual: res.actual, ok: res.ok, stale: !!res.stale, detail: res.detail };
});

/* ------------------------------------------------------------------ *
 * 打印
 * ------------------------------------------------------------------ */
const L = (s = "") => console.log(s);
L("=".repeat(96));
L("Metric credibility audit  |  source: data/store");
L("=".repeat(96));
L();
L("[0] Overview");
for (const o of overview)
  L(`  ${o.run.padEnd(6)} steps ${o.stepFrom}~${o.stepTo} (${o.steps})  series ${o.seriesKeys} / tags listed ${o.tagListed} (${o.tagsWithoutAnySeriesRow} with no series)  fill rate ${(o.fillRate * 100).toFixed(1)}%  versions ${o.versions} (${o.baselineVersionN}→${o.latestVersionN})`);

L();
L("[1] Identity / derived metrics");
for (const o of overview) {
  const i = result.identity[o.run];
  L(`  ${o.run}: ${i.metricsConsidered} scanned (all-null/constant excluded), ${i.pairsScanned} pairs compared`);
  L(`    identical (incl. null positions) ${i.identicalPairs} pairs; affine-exact ${i.afflineExactPairs} pairs; affine-near ${i.affineNearPairs} pairs; correlation-only ${i.correlatedOnlyPairs} pairs`);
  L(`    merged into ${i.clusterCount} duplicate clusters; ${i.denseClusterCount} high-confidence clusters (neither side sparse, covering ${i.denseClusterMembers} metrics), ${i.sparseClusterCount} remaining are sparse false duplicates. Top 8 high-confidence clusters:`);
  for (const c of i.clustersTop.slice(0, 8)) L(`      [${c.kind}, ${c.size}, worst relative residual ${c.worstRelResid.toExponential(2)}] ${c.members.slice(0, 6).join(" = ")}${c.members.length > 6 ? ` …${c.members.length} total` : ""}`);
  L(`    Multi-metric identity checks:`);
  for (const x of i.curated) L(`      ${x.name}: ${JSON.stringify(x)}`);
}

L();
L("[2] All-zero / constant series");
for (const o of overview) {
  const c = result.constants[o.run];
  L(`  ${o.run} (${c.total} metrics): all-null ${c.allNull}; const-0 ${c.const0}; const-1 ${c.const1}; const-other ${c.constOther}; two-valued ${c.twoValued}`);
  L(`    strictly droppable (all-null + constant) = ${c.droppableStrict} (${((c.droppableStrict / c.total) * 100).toFixed(1)}%); loosely (two-valued) = ${c.droppableLoose} (${((c.droppableLoose / c.total) * 100).toFixed(1)}%)`);
  L(`    two-valued by family: ${c.twoValuedByFamily.slice(0, 8).map((x: any) => `${x.fam}:${x.n}`).join("  ")}`);
  L(`    const-0 by family: ${c.const0ByFamily.slice(0, 8).map((x: any) => `${x.fam}:${x.n}`).join("  ")}`);
  L(`    constants other than 0/1: ${c.constOtherList.map((x: any) => `${x.tag}=${x.value}`).join("  ") || "none"}`);
  L(`    cross-tab by family: ${["const-0", "const-1", "const-other"].map((k) => `${k}[${(c.byFamilyPerKind[k] ?? []).slice(0, 6).map((x: any) => `${x.fam}:${x.n}`).join(" ")}]`).join("  ")}`);
  L(`    const-1 list: ${c.const1List.join("  ")}`);
}

L();
L("[3] Coverage");
for (const o of overview) {
  const c = result.coverage[o.run];
  L(`  ${o.run}: coverage histogram ${c.hist.map((h: any) => `[${h.lo}~${h.hi}) ${h.n}`).join("  ")}`);
  L(`    metrics with coverage < 50%: ${c.below50}; families: ${c.below50Families.slice(0, 10).map((x: any) => `${x.fam}(mean ${(x.meanCoverage * 100).toFixed(0)}%,${x.n})`).join("  ")}`);
  L(`    zero-reporters (reported but ≥90% exact 0): ${c.zeroReportedCount}, families involved ${c.zeroReportedFamilies.slice(0, 12).join(",")}`);
  L(`    trailing cut-off ${c.trailingCutCount}: families ${c.trailingCutByFamily.join(",")}`);
  L(`    interior gaps ${c.interiorMissingCount}: families ${c.interiorMissingByFamily.slice(0, 10).join(",")}`);
}

L();
L("[4] Sentinel values");
for (const o of overview) {
  const s = result.sentinels[o.run];
  L(`  ${o.run}: sentinel candidates ${s.sentinelCandidates.length}, cap-hit candidates ${s.capCount}`);
  for (const h of s.sentinelCandidates.slice(0, 14))
    L(`    ${h.tag}  value=${h.value} seen ${h.count}/${h.reported} (${(h.share * 100).toFixed(0)}%) distinct=${h.distinct} other values=[${h.otherValues.slice(0, 4).join(",")}] class=${h.classification}`);
  for (const h of s.capCandidates.slice(0, 10)) L(`    [cap] ${h.tag} repeatedly takes ${h.capValue}, ${h.count}/${h.reported} (${(h.share * 100).toFixed(0)}%) and is the metric max`);
}

L();
L("[5] Scale and units");
for (const o of overview) {
  const s = result.scale[o.run];
  L(`  ${o.run}: metrics with adjacent-step change ≥${T.jumpFactor}×: ${s.jumpCount} (${s.jumpCount - s.jumpCountNonBucket} bucket-open type, ${s.jumpCountNonBucket} other); out of range ${s.outOfRange.length}`);
  for (const j of s.jumps.slice(0, 12)) L(`    ${j.tag}  ${j.from} → ${j.to} (×${j.factor.toFixed(1)}, step ${j.atStep})`);
  for (const q of s.outOfRange.slice(0, 10)) L(`    [out-of-range:${q.kind}] ${q.tag} ${q.count}/${q.reported} values, range ${q.min}~${q.max}`);
  L(`    ctx_total_length/clip_ratio: ${JSON.stringify(s.clipRatio)}`);
}

L();
L("[6] Structural breakpoints");
for (const o of overview) {
  const b = result.breakpoints[o.run];
  const e = result.eventAlignment[o.run];
  const evSteps = new Set(e.intervals.filter((x: any) => x.restarts > 0 || x.versions.length > 0 || x.notices.length > 0).map((x: any) => x.step));
  const bpAtEvent = b.hits.filter((h: any) => evSteps.has(h.step)).length;
  L(`  ${o.run}: total breakpoints ${b.totalBreakpoints} (criterion |Δ|/(1.4826·MAD) > ${T.breakZ} and relative change > ${(T.minRelChange * 100).toFixed(0)}%)`);
  L(`    steps with most breakpoints (raw count): ${b.ranked.slice(0, 6).map((x: any) => `step${x.step}:${x.breakpoints}`).join("  ")}; top 6 steps hold ${(b.top6Share * 100).toFixed(1)}% of all breakpoints`);
  L(`    steps with most breakpoints (divided by comparable metrics that step): ${b.rankedRate.slice(0, 6).map((x: any) => `step${x.step}:${(x.rate * 100).toFixed(2)}%(${x.breakpoints}/${x.comparableMetrics})`).join("  ")}`);
  L(`    restart mapping: ${e.restartsByStep.map((x: any) => `step${x.step}×${x.n}`).join("  ")}; steps with multiple restarts: ${e.multiRestartSteps.map((x: any) => `step${x.step}×${x.n}`).join(",") || "none"}`);
  L(`    breakpoints on steps with external events (restart/version/notice) ${bpAtEvent}/${b.totalBreakpoints} = ${((bpAtEvent / Math.max(b.totalBreakpoints, 1)) * 100).toFixed(1)}%`);
  L(`    steps with events (${evSteps.size}): ${[...evSteps].join(",")}`);
  const unexp = b.ranked.filter((x: any) => !evSteps.has(x.step) && x.breakpoints > 0).slice(0, 8);
  L(`    steps with most breakpoints but no external event: ${unexp.map((x: any) => `step${x.step}:${x.breakpoints}`).join("  ")}`);
  L(`    intervals where real wall clock and reported time mismatch most:`);
  const bad = e.intervals.map((x: any) => ({ ...x, reported: r0(o.run, x.step) })).filter((x: any) => isNum(x.reported)).map((x: any) => ({ ...x, gap: x.wallDelta - x.reported })).sort((a: any, b: any) => b.gap - a.gap).slice(0, 6);
  for (const x of bad) L(`      step${x.step}: wall clock ${(x.wallDelta / 3600).toFixed(2)}h, reported ${(x.reported / 3600).toFixed(2)}h, gap ${(x.gap / 3600).toFixed(2)}h, restarts in interval ${x.restarts}`);
}

function r0(run: string, step: number): number | null {
  const r = RUNS.find((x) => x.key === run)!;
  const i = r.steps.indexOf(step);
  const v = r.series["timing_s/step"]?.[i];
  return isNum(v) ? v : null;
}

L();
L("[7] Metric lifecycle");
for (const o of overview) {
  const l = result.lifecycle[o.run];
  L(`  ${o.run}: ${l.tagCount} tags; first telemetry sync ${l.firstSync}`);
  L(`    first_seen histogram: ${l.firstSeenHistogram.map((x: any) => `${x.version ?? x.at}→${x.n}`).join("  ")}`);
  L(`    last_seen histogram: ${l.lastSeenHistogram.map((x: any) => `${x.at}→${x.n}`).join("  ")} (${l.tagsWithLastSeenAtLatest}/${l.tagCount} equal the latest sync time)`);
  L(`    late-arriving metrics ${l.lateComerCount}: ${l.lateComers.slice(0, 20).map((x: any) => `${x.tag}@${x.versionAt}`).join("  ")}`);
  L(`    "removed" metrics inferred from version n and additions: ${l.inferredRemovals}`);
  for (const x of l.removalByInterval) L(`      ${x.from} → ${x.to}: n ${x.nFrom}→${x.nTo} (Δ${x.delta}), added ${x.added}, ⇒ removed ${x.removed}`);
  L(`    version switches aligned to steps: ${l.versionSteps.map((x: any) => `${x.version}@step${x.step}`).join("  ")}`);
}

L();
L("[8] Semantic drift (same metric name jumps in magnitude across a version switch)");
for (const o of overview) {
  const d = result.drift[o.run];
  L(`  ${o.run}: suspected drift ${d.driftCount}`);
  for (const h of d.driftHits.slice(0, 15)) L(`    ${h.tag} @${h.version}(step${h.atStep}) median ${h.beforeMedian} → ${h.afterMedian} (×${h.ratio.toFixed(1)})`);
}

L();
L("[9] Documentation consistency");
const da = result.docAudit;
L(`  ${metricsDoc.length} explainer ids; ${da.perId.filter((x: any) => x.kind === "pseudo").length} of them are non-series metric ids (benchmark/notices)`);
L(`  ids that matched no metric name after expansion: ${da.unmatchedIds.length}:`);
for (const u of da.unmatchedIds) L(`    ${u.id}`);
L(`  explainer ids matched metrics (pro+flash deduped ${da.taggedMetricCount} total): ${da.matchedByDoc} matched = ${((da.matchedByDoc / da.taggedMetricCount) * 100).toFixed(1)}%`);
L(`  metrics present in data but covered by no explainer: ${da.uncoveredCount}; by family: ${da.uncoveredByFamily.slice(0, 12).map((x: any) => `${x.fam}:${x.n}`).join("  ")}`);
L(`  families most in need of explainers (sorted by metrics × coverage × volatility):`);
for (const p of da.priorityFamilies.slice(0, 12)) L(`    ${p.fam}: ${p.metrics} metrics, mean coverage ${(p.meanCoverage * 100).toFixed(0)}%, pinned ${p.pinned}, official descriptions ${p.described}, e.g. ${p.examples.join(", ")}`);
L(`  Spot-checking observed numbers:`);
for (const c of result.claims) L(`    [${c.ok ? "consistent in window" : "mismatch"}${c.stale ? "/stale" : ""}] ${c.docId} — ${c.claim}\n        actual: ${c.actual}\n        note: ${c.detail}`);


L();
L("[10] Restart fingerprint (events-independent; data-internal signals only)");
for (const o of overview) {
  const f = result.restartFingerprint[o.run];
  L(`  ${o.run}: steps with partial/0/frac exactly = 1 [${f.freshSteps.join(",")}]; steps with avg_staleness = 0 [${f.staleZero.join(",")}]`);
  L(`    steps where in-process cumulative counters halved [${f.resetSteps.join(",")}]${f.resetExamples.length ? ", e.g. " + f.resetExamples.map((x: any) => `${x.tag}@step${x.step}`).join(", ") : ""}`);
}

L();
L("[11] Dataset-level zero-report triple alignment");
for (const o of overview) {
  const d = result.datasetZeros[o.run];
  L(`  ${o.run}: passrate series with exact 0: ${d.datasets.length}, zero cells ${d.totalZeroCells}, union of zero steps [${d.zeroStepUnion.join(",")}]`);
  for (const x of d.datasets)
    L(`    ${x.dataset}: ${x.zeroCount} zero values @ [${x.zeroSteps.join(",")}]; exact match with partial/.../1/frac null=${x.alignedWithBucket1Null}; exact match with num_accepted step==held=${x.alignedWithStepEqHeld}`);
}

L();
L("[12] Context-length caps (round large values repeatedly taken by ctx_*_length/*/max)");
for (const o of overview) {
  const c = result.caps[o.run];
  L(`  ${o.run}: ${c.hits.length} metrics hit, across ${c.tiers.length} distinct cap tiers`);
  for (const t of c.tiers) L(`    cap ${t.capValue} (≈2^${Math.round(Math.log2(t.capValue))}): ${t.metrics} metrics, e.g. ${t.examples.join("  ")}`);
}

L();
L("[13] Cumulative-metric (running mean) suspects");
for (const o of overview) {
  const c = result.cumulative[o.run];
  L(`  ${o.run}: strictly monotone increasing ratio/rate/frac/share metrics ${c.monotone.length}; sawtooth (uptrend with ≥1 drawdown) ${c.sawtooth.length}`);
  for (const m of c.monotone.slice(0, 10)) L(`    monotone: ${m.tag}  ${m.first} → ${m.last} (${m.n} steps)`);
  for (const m of c.sawtooth.slice(0, 6)) L(`    sawtooth: ${m.tag}  ${m.first} → ${m.last}, drawdowns ${m.drops.map((x: any) => `step${x.atStep}:${x.delta}`).join(", ")}`);
}

L();
L("[14] Level shift (split series in two; median ratio ≥10 and disjoint value ranges)");
for (const o of overview) {
  const d = result.levelShift[o.run];
  L(`  ${o.run}: ${d.count} hits`);
  for (const h of d.hits.slice(0, 12)) L(`    ${h.tag}  cut at step ${h.atStep}: median ${h.beforeMedian} → ${h.afterMedian} (×${h.ratio.toFixed(1)})`);
}

L();
L("[15] Official descriptions coverage");
L(`  official descriptions ${da.officialDescriptions.total}; matching no metric after expansion: ${da.officialDescriptions.missing.length}: ${da.officialDescriptions.missing.join("  ") || "none"}`);

mkdirSync(ANALYSIS_DIR, { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
L();
L(`written: ${OUT_JSON.replace(ROOT + "/", "")}`);
