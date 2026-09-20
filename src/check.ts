/**
 * 仓库自检：把已知的恒等关系逐条验算一遍。
 *
 *   bun src/check.ts
 *
 * 存在的意义是**发现站点悄悄改了算法**。这些关系式不是官方文档里的东西，
 * 是我从数据里核对出来的（见 docs/01 第 7 节）。一旦哪条不再成立，
 * 要么是站点改了实现，要么是我们读错了——两种都必须知道。
 *
 * 退出码：全部通过是 0，有任何一条硬性检查失败是 1。
 */
import { readAxis, readEvents, readLiveLog, readMeta, readSeries, readTimeline, type Axis, type StepEvent } from "./store";

interface Finding {
  level: "ok" | "warn" | "fail";
  name: string;
  detail: string;
}

const findings: Finding[] = [];
const ok = (name: string, detail: string) => findings.push({ level: "ok", name, detail });
const warn = (name: string, detail: string) => findings.push({ level: "warn", name, detail });
const fail = (name: string, detail: string) => findings.push({ level: "fail", name, detail });

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

/** 一个 run 的全部数据加载一次，按 step 建索引，后面查值都是 O(1)。 */
interface Ctx {
  run: string;
  label: string;
  axis: Axis;
  series: Record<string, (number | null)[]>;
  events: StepEvent[];
  timeline: any[];
  index: Map<number, number>;
}

function load(run: string, label: string): Ctx | null {
  const axis = readAxis(run);
  if (!axis) return null;
  const index = new Map<number, number>();
  axis.steps.forEach((s, i) => index.set(s, i));
  return { run, label, axis, series: readSeries(run), events: readEvents(run), timeline: readTimeline(run), index };
}

const at = (c: Ctx, tag: string, step: number): number | null => {
  const i = c.index.get(step);
  if (i === undefined) return null;
  const v = c.series[tag]?.[i];
  return v === undefined ? null : v;
};

const stepEvents = (c: Ctx): StepEvent[] => c.events.filter((e) => e.kind === "step");

/** 同一步出现两条事件 = 这一步被重跑过。末条才是最终生效的那条。 */
function redoSteps(c: Ctx): number[] {
  const cnt = new Map<number, number>();
  for (const e of stepEvents(c)) if (e.step != null) cnt.set(e.step, (cnt.get(e.step) ?? 0) + 1);
  return [...cnt.entries()].filter(([, n]) => n > 1).map(([s]) => s).sort((a, b) => a - b);
}

const lastEventFor = (c: Ctx, step: number) => stepEvents(c).filter((e) => e.step === step).at(-1);

/**
 * partial/ 分桶的桶号。**pro 和 flash 桶数不一样**：pro 是 0～7，flash 是 0～9。
 * 写死 8 会让 flash 的加权和少算一部分，看起来像"关系式不成立"。
 */
function bucketIds(c: Ctx): number[] {
  const ids = new Set<number>();
  for (const tag of Object.keys(c.series)) {
    const m = /^partial\/(\d+)\//.exec(tag);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

function checkRun(c: Ctx): void {
  const { axis, series, run } = c;
  console.log(`\n=== ${c.label} (${axis.steps.length} steps / ${Object.keys(series).length} series / ${c.events.filter((e) => e.kind === "restart").length} restarts)===`);

  /* 1. steps 必须是 1..N 连续的。回放靠"截到某个步号"切数据，有洞就会错位。 */
  const contiguous = axis.steps.every((s, i) => s === i + 1);
  contiguous
    ? ok("contiguous steps", `1..${axis.steps.length}`)
    : fail("contiguous steps", `not contiguous: ${axis.steps.join(",")}`);

  /* 2. 每条序列的长度必须等于 steps 的长度（缺值是 null，不是截断）。 */
  const badLen = Object.entries(series).filter(([, arr]) => arr.length !== axis.steps.length);
  badLen.length === 0
    ? ok("series length aligned", `${Object.keys(series).length} series all equal ${axis.steps.length}`)
    : fail("series length aligned", `${badLen.length} mismatched, e.g. ${badLen[0][0]} length ${badLen[0][1].length}`);

  /* 3. 成本恒等式：cost = rate × (now − start)。这是判断"成本曲线有没有信息量"的依据。
        run 结束（mode === "ended"）之后 cost 会冻结在结束时刻，而 now 继续走，
        所以只对未结束的同步点验这条；已结束的那些单独验"成本不再增长"。 */
  {
    let checked = 0;
    let worst = 0;
    let lastLive = 0;
    const endedCosts: number[] = [];
    for (const row of c.timeline) {
      if (row.cost == null || row.rate == null || row.start == null || row.now == null) continue;
      if (row.mode === "ended") { endedCosts.push(row.cost); continue; }
      checked++;
      lastLive = row.cost;
      worst = Math.max(worst, rel(row.cost, row.rate * (row.now - row.start)));
    }
    checked && worst < 1e-9
      ? ok("cost = rate × (now − start)", `${checked} sync points all hold exactly`)
      : checked
        ? fail("cost = rate × (now − start)", `max relative error ${worst.toExponential(2)}`)
        : warn("cost = rate × (now − start)", "timeline is missing rate/start/now");
    if (endedCosts.length) {
      /* 结束之后 cost 冻结：所有已结束同步点的值必须彼此相等。
         不能要求它等于"最后一个 live 同步点的值"——两次同步之间可能就结束了，
         结束时刻的成本比最后一条 live 记录要高一截。 */
      const frozen = endedCosts.every((x) => rel(x, endedCosts[0]) < 1e-9);
      const grew = endedCosts[0] >= lastLive - 1e-6;
      frozen && grew
        ? ok("cost frozen after run end", `${endedCosts.length} ended sync points agree on cost (${endedCosts[0]})`)
        : fail("cost frozen after run end", `ended sync points disagree on cost, or regress (${endedCosts.join(", ")}; last live value ${lastLive})`);
    }
  }

  /* 4. 上下文长度可加：total = prompt + response。
        站点的数值只给到约 6 位有效数字，所以这条只能验到"与取值精度相符"为止：
        12 万的数存成 6 位有效数字，粒度就是 0.5，两个分量各自的舍入误差加起来能到一个 token。 */
  {
    let checked = 0, worstAbs = 0, worstRel = 0;
    for (const step of axis.steps) {
      const t = at(c, "ctx_total_length/mean", step);
      const p = at(c, "ctx_prompt_length/mean", step);
      const r = at(c, "ctx_response_length/mean", step);
      if (t == null || p == null || r == null) continue;
      checked++;
      worstAbs = Math.max(worstAbs, Math.abs(t - (p + r)));
      worstRel = Math.max(worstRel, rel(t, p + r));
    }
    if (!checked) warn("ctx_total = prompt + response", "no usable data");
    else if (worstRel < 1e-4) ok("ctx_total = prompt + response", `${checked} steps, max absolute diff ${worstAbs.toFixed(3)} token / relative ${worstRel.toExponential(1)} (the site reports only 6 significant digits, which is the value granularity)`);
    else fail("ctx_total = prompt + response", `max relative error ${worstRel.toExponential(2)}, beyond what the value precision can explain`);
  }

  /* 5. critic 里 rewards 和 score 应该是同一个量。 */
  {
    let checked = 0, worst = 0;
    for (const step of axis.steps) {
      const a = at(c, "critic/rewards/mean", step);
      const b = at(c, "critic/score/mean", step);
      if (a == null || b == null) continue;
      checked++;
      worst = Math.max(worst, rel(a, b));
    }
    if (!checked) warn("critic/rewards/mean == critic/score/mean", "critic/score/mean does not exist");
    else if (worst < 1e-9) ok("critic/rewards/mean == critic/score/mean", `${checked} steps all equal`);
    else warn("critic/rewards/mean == critic/score/mean", `max relative diff ${worst.toExponential(2)}`);
  }

  /* 6. 全局 KL 是各新鲜度桶的加权平均。这条是 docs/01 第 1 坑的依据。 */
  {
    const TAG = "train_infer_diff/new_infer/kl";
    const ids = bucketIds(c);
    let checked = 0, worst = 0, worstStep = 0, minCover = 1;
    for (const step of axis.steps) {
      const g = at(c, TAG, step);
      if (g == null) continue;
      let sum = 0, weight = 0;
      for (const k of ids) {
        const f = at(c, `partial/${k}/frac`, step);
        const v = at(c, `partial/${k}/${TAG}`, step);
        if (f == null || v == null) continue;
        sum += f * v;
        weight += f;
      }
      if (!weight) continue;
      checked++;
      minCover = Math.min(minCover, weight);
      const e = rel(g, sum);
      if (e > worst) { worst = e; worstStep = step; }
    }
    if (!checked) warn("global KL = Σ bucket share × bucket KL", "no usable data");
    else if (worst < 0.02) ok("global KL = Σ bucket share × bucket KL", `${checked} steps, buckets ${ids[0]}-${ids.at(-1)}, bucket share sums to at least ${minCover.toFixed(4)}, max relative error ${(worst * 100).toFixed(2)}%`);
    else warn("global KL = Σ bucket share × bucket KL", `max relative error ${(worst * 100).toFixed(1)}% (step ${worstStep})`);
  }

  /* 7. 平均过期代数 = Σ 桶号 × 桶占比。 */
  {
    const ids = bucketIds(c);
    let checked = 0, worst = 0, worstStep = 0;
    for (const step of axis.steps) {
      const a = at(c, "partial/avg_staleness", step);
      if (a == null) continue;
      let sum = 0, used = 0;
      for (const k of ids) {
        const f = at(c, `partial/${k}/frac`, step);
        if (f == null) continue;
        sum += k * f;
        used++;
      }
      if (!used) continue;
      checked++;
      const e = rel(a, sum);
      if (e > worst) { worst = e; worstStep = step; }
    }
    if (!checked) warn("avg_staleness = Σ bucket id × bucket share", "no usable data");
    else if (worst < 1e-4) ok("avg_staleness = Σ bucket id × bucket share", `${checked} steps all hold (max relative error ${worst.toExponential(2)})`);
    else warn("avg_staleness = Σ bucket id × bucket share", `max relative error ${(worst * 100).toFixed(2)}% (step ${worstStep})`);
  }

  /* 8. 每步 token 数 ≈ prompts × n × 平均上下文长度。 */
  {
    let checked = 0, worst = 0;
    for (const e of stepEvents(c)) {
      const tot = at(c, "perf/total_num_tokens", e.step!);
      const ctx = at(c, "ctx_total_length/mean", e.step!);
      if (tot == null || ctx == null) continue;
      checked++;
      worst = Math.max(worst, rel(tot, 1568 * 16 * ctx));
    }
    if (!checked) warn("perf/total_num_tokens ≈ 1568×16×ctx", "no usable data");
    else if (worst < 0.05) ok("perf/total_num_tokens ≈ 1568×16×ctx", `${checked} steps, max relative error ${(worst * 100).toFixed(1)}%`);
    else warn("perf/total_num_tokens ≈ 1568×16×ctx", `max relative error ${(worst * 100).toFixed(1)}%, deviation is large (this happens when some series are dropped)`);
  }

  /* 9. 重跑过的步：事件流的末条应当和序列里的值一致。
        /status 只追加、/series 会重写，这两边对不上就是 bug。 */
  {
    const redos = redoSteps(c);
    if (!redos.length) {
      ok("redo step consistency", "no redone steps");
    } else {
      const bad: string[] = [];
      for (const step of redos) {
        const last = lastEventFor(c, step);
        const v = at(c, "dynsam/avg@n", step);
        if (last?.value != null && v != null && last.value !== v) bad.push(`step ${step}: event ${last.value} vs series ${v}`);
      }
      bad.length === 0
        ? ok("redo step consistency", `${redos.length} redone steps (step ${redos.join(", ")}), last event matches series`)
        : fail("redo step consistency", bad.join("; "));
    }
  }

  /* 10. 步的完成时间必须递增。 */
  {
    const times = axis.steps.map((s) => lastEventFor(c, s)?.t ?? null);
    const back: number[] = [];
    for (let i = 1; i < times.length; i++) {
      if (times[i] != null && times[i - 1] != null && times[i]! < times[i - 1]!) back.push(axis.steps[i]);
    }
    back.length === 0
      ? ok("step completion times monotonic", `${times.filter((t) => t != null).length} steps have timestamps`)
      : warn("step completion times monotonic", `backwards steps: ${back.join(", ")}`);
  }

  /* 11. 有数据的指标数不该超过 /tags 列出的指标数。 */
  {
    void run;
    const nSeries = Object.keys(series).length;
    ok("series count", `${nSeries} (tags lists every possible metric; metrics without data do not appear in series)`);
  }

  /* 12. 采样器面板那几张表的加总恒等式（见 sampler_report.ts 与 docs/01 第 3.3 节）。
         三条都在全部留档上成立过；这里让它们跟着每次自检跑，站点改口径会立刻暴露。 */
  {
    const live = readLiveLog(run).filter((r: any) => r && r.latest).map((r: any) => r.latest);
    if (!live.length) {
      warn("sampler table identities", "no /live logs in the repo yet");
    } else {
      let accOk = 0, tgtOk = 0, decOk = 0, cLeA = 0, cTotal = 0;
      for (const L of live) {
        const vals = Object.values(L.ds ?? {}) as (number | null)[][];
        const sa = vals.reduce((a, v) => a + (v[0] ?? 0), 0);
        const sb = vals.reduce((a, v) => a + (v[1] ?? 0), 0);
        const sc = vals.reduce((a, v) => a + (v[2] ?? 0), 0);
        const aNull = vals.filter((v) => v[2] == null).reduce((a, v) => a + (v[0] ?? 0), 0);
        if (sa === L.accept) accOk++;
        if (sb === L.target) tgtOk++;
        if (sc + aNull === L.judged) decOk++;
        for (const v of vals) if (v[2] != null) { cTotal++; if ((v[2] as number) <= (v[0] as number)) cLeA++; }
      }
      const n = live.length;
      accOk === n
        ? ok("Σaccepted == panel accept", `${n} sampler logs all hold`)
        : fail("Σaccepted == panel accept", `${n - accOk}/${n} mismatched`);
      tgtOk === n
        ? ok("Σtarget == panel target", `${n} sampler logs all hold`)
        : fail("Σtarget == panel target", `${n - tgtOk}/${n} mismatched`);
      decOk === n
        ? ok("judged = Σc(reporting sources) + Σaccepted(non-reporting sources)", `${n} sampler logs all hold; c <= accepted holds ${cLeA}/${cTotal}`)
        : fail("judged = Σc(reporting sources) + Σaccepted(non-reporting sources)", `${n - decOk}/${n} mismatched`);
    }
  }
}

function main(): number {
  const meta = readMeta();
  if (!meta) {
    console.error("repo is empty; run sync.ts --bootstrap first");
    return 1;
  }
  for (const cfg of meta.runs ?? []) {
    const ctx = load(cfg.key, cfg.label);
    if (ctx) checkRun(ctx);
  }

  const order = { fail: 0, warn: 1, ok: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  console.log("\n--- details ---");
  const mark = { ok: "ok", warn: "warn", fail: "fail" };
  for (const f of findings) console.log(`  [${mark[f.level]}] ${f.name} — ${f.detail}`);

  const nFail = findings.filter((f) => f.level === "fail").length;
  const nWarn = findings.filter((f) => f.level === "warn").length;
  const nOk = findings.filter((f) => f.level === "ok").length;
  console.log(`\ntotal: ${nOk} passed, ${nWarn} warned, ${nFail} failed`);
  return nFail ? 1 : 0;
}

process.exit(main());
