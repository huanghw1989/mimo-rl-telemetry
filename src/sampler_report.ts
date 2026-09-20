#!/usr/bin/env bun
/**
 * sampler_report.ts
 * 「dynamic sampler」面板那几张表的复算脚本。目标是回答一个问题：
 *
 *   表格上那几列（source / accepted / target / remaining / judged / in flight）
 *   到底是什么数？哪些能从数据里证实、哪些证不了？
 *
 * 看板的 /live 接口给的是滚动快照。真正被遥测仓库逐次留档的是每次同步取到的
 * `latest`（data/store/runs/<run>/live.jsonl 一行一个同步点）。本脚本只读这些留档
 * 和 series.json，用可复算的恒等式与滚动关系去校验页面上的读法：
 *
 *   1. ds[<source>] = [a, b, c, d]，页面把 a 当 accepted、b 当 target、
 *      c 当 judged、d 当 in flight（映射在 *原站* app.js 里，不是遥测层加的）。
 *   2. sum(a) == 面板上的 accept、sum(b) == target == prompts_per_step。
 *   3. c 只在一部分数据源上出现，且恒有 c <= a。
 *   4. 一步之内 c 的累计是否随 a 单调增长、c/a 是否收敛到 judged/accept。
 *   5. d 的累计在一步内怎么走（是否先涨后落、是否在步末收干）。
 *   6. remaining 这一列是页面现算的还是接口给的。
 *   7. 同一份快照的 live 统计（passrate / pr0 / pr1 / n）与步末序列
 *      （dynsam/avg@n、passrate/zero、passrate/one、num_measurable）差多少。
 *
 * 运行（项目根目录）：
 *   bun src/sampler_report.ts
 *   bun src/sampler_report.ts --json   # 只输出 JSON 路径
 *
 * 产物：
 *   analysis/zh-CN/numbers/A3-sampler-numbers.json
 *
 * 设计原则：脚本里不写任何结论数字，正文里出现的每个数都要能从这里复算。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE = join(ROOT, "data", "store");
const OUT = join(ROOT, "analysis", "zh-CN", "numbers", "A3-sampler-numbers.json");
const JSON_ONLY = process.argv.includes("--json");
const RUNS = ["pro", "flash"];

const jread = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);

interface Latest {
  t: number;
  step: number | null;
  accept: number;
  target: number;
  judged: number;
  judged_of?: number;
  passrate: number;
  n: number;
  pr0: number;
  pr1: number;
  partial?: number[];
  working?: number;
  remain?: number;
  remain_partial?: number;
  remain_seq?: number;
  prewarm?: number;
  prewarm_wait?: number;
  ds: Record<string, (number | null)[]>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ 读数据 */

function snapshots(run: string): Latest[] {
  const p = join(STORE, "runs", run, "live.jsonl");
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  const byT = new Map<number, Latest>();
  for (const line of rows) {
    const o = JSON.parse(line);
    if (o && o.latest) byT.set(o.latest.t, o.latest as Latest);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function runSeries(run: string): Record<string, (number | null)[]> {
  const p = join(STORE, "runs", run, "series.json");
  return existsSync(p) ? jread(p) : {};
}

/** 序列里第 step 步的值（下标 = step - 1）。 */
const at = (series: Record<string, (number | null)[]>, tag: string, step: number | null): number | null => {
  if (step == null) return null;
  const a = series[tag];
  if (!a || step - 1 < 0 || step - 1 >= a.length) return null;
  const v = a[step - 1];
  return num(v) ? v : null;
};

/* ------------------------------------------------------------- 逐列核验 */

const out: any = {
  generated_at: Math.floor(Date.now() / 1000),
  source: "data/store/runs/<run>/live.jsonl（每次同步一行）",
  runs: {},
};

for (const run of RUNS) {
  const snaps = snapshots(run);
  const series = runSeries(run);

  /* --- 1/2. 最基本的两个加总恒等式 --- */
  let sumA_ok = 0, sumB_ok = 0, judgedOf_ok = 0, judgedOf_total = 0;
  let sumA_bad: any[] = [], sumB_bad: any[] = [];
  for (const L of snaps) {
    const a = sum(Object.values(L.ds).map((v) => (v[0] as number) || 0));
    const b = sum(Object.values(L.ds).map((v) => (v[1] as number) || 0));
    if (a === L.accept) sumA_ok++; else sumA_bad.push({ t: L.t, step: L.step, sum: a, accept: L.accept });
    if (b === L.target) sumB_ok++; else sumB_bad.push({ t: L.t, step: L.step, sum: b, target: L.target });
    if (L.judged_of != null) { judgedOf_total++; if (L.judged_of === L.accept) judgedOf_ok++; }
  }

  /* --- 3. c（judged）在哪些数据源上出现、是否 <= a --- */
  const everC = new Set<string>();
  const neverC = new Set<string>();
  let cLeA = 0, cTotal = 0;
  for (const L of snaps) {
    for (const [k, v] of Object.entries(L.ds)) {
      if (v[2] != null) { cTotal++; if ((v[2] as number) <= (v[0] as number)) cLeA++; everC.add(k); }
      else neverC.add(k);
    }
  }
  const neverOnly = [...neverC].filter((k) => !everC.has(k)).sort();

  /* --- 3b. 面板合计 judged 的精确分解 ---
     这一条把第三列钉死了：有 c 的源按 c 计、没 c 的源按 accepted 计，正好等于面板的 judged。
     等价说法：accept − judged == 有 c 的源上 (accepted − c) 之和。 */
  let decompOk = 0, gapOk = 0;
  const decompBad: any[] = [];
  for (const L of snaps) {
    const sc = sum(Object.values(L.ds).filter((v) => v[2] != null).map((v) => v[2] as number));
    const aNull = sum(Object.values(L.ds).filter((v) => v[2] == null).map((v) => (v[0] as number) || 0));
    const pending = sum(Object.values(L.ds).filter((v) => v[2] != null).map((v) => (v[0] as number) - (v[2] as number)));
    if (sc + aNull === L.judged) decompOk++; else decompBad.push({ t: L.t, step: L.step, calc: sc + aNull, judged: L.judged });
    if (pending === L.accept - L.judged) gapOk++;
  }

  /* --- 4. 一步之内：c 的累计 / a 的累计 与整体 judged/accept --- */
  const byStep = new Map<number, Latest[]>();
  for (const L of snaps) {
    if (L.step == null) continue;
    if (!byStep.has(L.step)) byStep.set(L.step, []);
    byStep.get(L.step)!.push(L);
  }
  const perStep: any[] = [];
  for (const [step, list] of [...byStep.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.t - b.t);
    const monoC = new Set<string>();
    for (const k of Object.keys(list[0].ds)) {
      const vals = list.map((L) => L.ds[k]?.[2] ?? null).filter((x): x is number => x != null);
      if (vals.length > 1 && vals.every((v, i) => i === 0 || v >= vals[i - 1])) monoC.add(k);
    }
    const rows = list.map((L) => {
      const rep = Object.entries(L.ds).filter(([, v]) => v[2] != null);
      const sa = sum(rep.map(([, v]) => v[0] as number));
      const sc = sum(rep.map(([, v]) => v[2] as number));
      const sd = sum(Object.values(L.ds).map((v) => (v[3] as number) || 0));
      return {
        t: L.t,
        accept: L.accept,
        target: L.target,
        sum_a_reporters: sa,
        sum_c: sc,
        c_over_a: sa ? +(sc / sa).toFixed(4) : null,
        judged: L.judged,
        judged_over_accept: L.accept ? +(L.judged / L.accept).toFixed(4) : null,
        sum_d: sd,
        remain: L.remain ?? null,
        remain_partial: L.remain_partial ?? null,
        remain_sum: (L.remain ?? 0) + (L.remain_partial ?? 0),
      };
    });
    perStep.push({
      step,
      snapshots: list.length,
      reporters: Object.entries(list[0].ds).filter(([, v]) => v[2] != null).map(([k]) => k).sort(),
      c_monotonic_sources: [...monoC].sort(),
      rows,
    });
  }

  /* --- 5. d 的步内走势（只统计有多次快照的步） --- */
  const drainSteps = perStep
    .filter((s) => s.snapshots >= 3)
    .map((s) => ({
      step: s.step,
      sum_d: s.rows.map((r: any) => r.sum_d),
      accept: s.rows.map((r: any) => r.accept),
      peak_at: s.rows.reduce((bi: number, r: any, i: number) => (r.sum_d > s.rows[bi].sum_d ? i : bi), 0),
    }));

  /* --- 6. remaining 是不是页面现算的 --- */
  const remainingCheck = snaps
    .map((L) => {
      const rows = Object.entries(L.ds);
      const ok = rows.every(([, v]) => (v[1] as number) >= 0);
      return { t: L.t, step: L.step, formula: "max(0, target - accepted)", rows_nonneg_target: ok };
    })
    .slice(0, 1);

  /* --- 7. 快照统计 vs 步末序列 --- */
  const convergence = [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, list]) => {
      const L = list[list.length - 1];
      const v = (tag: string) => at(series, tag, step);
      return {
        step,
        snapshots: list.length,
        accept: L.accept,
        series_agentic_num_accepted_step: v("dynsam/agentic/num_accepted/step"),
        passrate: L.passrate,
        series_avg_at_n: v("dynsam/avg@n"),
        pr0: L.pr0,
        series_passrate_zero: v("dynsam/passrate/zero"),
        pr1: L.pr1,
        series_passrate_one: v("dynsam/passrate/one"),
        n: L.n,
        series_num_measurable: v("dynsam/num_measurable"),
      };
    });

  /* --- 8. d 与 remain/remain_partial 的关系（不是恒等式，只看差多少） --- */
  const dVsRemain = snaps.map((L) => {
    const sd = sum(Object.values(L.ds).map((v) => (v[3] as number) || 0));
    const rs = (L.remain ?? 0) + (L.remain_partial ?? 0);
    return { t: L.t, step: L.step, sum_d: sd, remain_plus_partial: rs, diff: sd - rs };
  });

  const allSources = [...new Set(snaps.flatMap((L) => Object.keys(L.ds)))].sort();

  out.runs[run] = {
    snapshots: snaps.length,
    steps_covered: [...byStep.keys()].sort((a, b) => a - b),
    sources: allSources,
    identities: {
      sum_accepted_equals_accept: { ok: sumA_ok, total: snaps.length, violations: sumA_bad },
      sum_target_equals_target: { ok: sumB_ok, total: snaps.length, violations: sumB_bad },
      judged_of_equals_accept: { ok: judgedOf_ok, total: judgedOf_total },
    },
    column_c_judged: {
      sources_reporting: [...everC].sort(),
      sources_never_reporting: neverOnly,
      values_leq_accepted: { ok: cLeA, total: cTotal },
      judged_decomposition: { ok: decompOk, total: snaps.length, violations: decompBad },
      pending_gap_identity: { ok: gapOk, total: snaps.length },
    },
    per_step: perStep,
    d_drain_steps: drainSteps,
    convergence,
    d_vs_remain: dVsRemain,
    remaining_is_derived: remainingCheck,
  };
}

mkdirSync(join(ROOT, "analysis", "zh-CN", "numbers"), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

if (!JSON_ONLY) {
  const line = (s = "") => console.log(s);
  line("# dynamic sampler table recomputation");
  line(`data source: data/store/runs/<run>/live.jsonl (one latest archived per sync)`);
  for (const run of RUNS) {
    const r = out.runs[run];
    line("");
    line(`## ${run} - ${r.snapshots} snapshots, covering steps ${r.steps_covered.join(", ")}, ${r.sources.length} data sources`);
    const id = r.identities;
    line(`  1) sum(accepted) == panel accept: ${id.sum_accepted_equals_accept.ok}/${id.sum_accepted_equals_accept.total}`);
    line(`     sum(target)  == panel target: ${id.sum_target_equals_target.ok}/${id.sum_target_equals_target.total}`);
    line(`     judged_of == accept: ${id.judged_of_equals_accept.ok}/${id.judged_of_equals_accept.total}`);
    line(`  2) the third number (labeled judged on the page) appears in only these ${r.column_c_judged.sources_reporting.length} data sources:`);
    line(`     ${r.column_c_judged.sources_reporting.join(", ")}`);
    line(`     never appears (${r.column_c_judged.sources_never_reporting.length}): ${r.column_c_judged.sources_never_reporting.join(", ")}`);
    line(`     always c <= accepted: ${r.column_c_judged.values_leq_accepted.ok}/${r.column_c_judged.values_leq_accepted.total}`);
    line(
      `  2b) exact decomposition of panel judged: Σc (reporting sources) + Σaccepted (non-reporting sources) == judged: ` +
        `${r.column_c_judged.judged_decomposition.ok}/${r.column_c_judged.judged_decomposition.total}; ` +
        `equivalently accept - judged == Σ(accepted - c): ${r.column_c_judged.pending_gap_identity.ok}/${r.column_c_judged.pending_gap_identity.total}`,
    );
    line(`  3) c growing with a within a step (only steps with multiple snapshots):`);
    for (const s of r.per_step) {
      if (s.snapshots < 2) continue;
      const first = s.rows[0], last = s.rows[s.rows.length - 1];
      line(
        `     step ${s.step} (${s.snapshots} snapshots) c/a ${first.c_over_a} → ${last.c_over_a}, ` +
          `judged/accept ${first.judged_over_accept} → ${last.judged_over_accept}`,
      );
    }
    line(`  4) within-step trajectory of d (labeled in flight on the page) (steps with multiple snapshots):`);
    for (const s of r.d_drain_steps) line(`     step ${s.step}: sum(d) = ${s.sum_d.join(" → ")}`);
    line(`  5) difference between the d total and remain+remain_partial (not an identity, check the magnitude):`);
    const near = r.d_vs_remain.filter((x: any) => Math.abs(x.diff) <= 2).length;
    line(`     ${near}/${r.d_vs_remain.length} snapshots differ by <= 2; max difference among the rest ${Math.max(...r.d_vs_remain.map((x: any) => Math.abs(x.diff)))}`);
    line(`  6) snapshot stats vs end-of-step series (accept is a running quantity, the series is the end-of-step value):`);
    for (const c of r.convergence) {
      line(
        `     step ${c.step}: accept ${c.accept} / series ${c.series_agentic_num_accepted_step} · ` +
          `pr0 ${c.pr0} vs zero ${c.series_passrate_zero} · pr1 ${c.pr1} vs one ${c.series_passrate_one} · ` +
          `passrate ${c.passrate} vs avg@n ${c.series_avg_at_n}`,
      );
    }
  }
  line("");
  line(`wrote ${OUT}`);
}
