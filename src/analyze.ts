/* 对本地仓库做分析，输出「上一轮观测窗口之后」的新增训练情况。
   只读 data/store/，不联网。
   用法：bun src/analyze.ts [--json <out>] */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE = join(ROOT, "data/store");

type Series = Record<string, (number | null)[]>;

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

export interface RunData {
  key: string;
  series: Series;
  axis: { steps: number[]; [k: string]: unknown };
  status: any;
  events: any[];
  timeline: any[];
  tags: any;
}

export function loadRun(key: string): RunData {
  const base = join(STORE, "runs", key);
  return {
    key,
    series: read(join(base, "series.json")),
    axis: read(join(base, "axis.json")),
    status: read(join(base, "status.json")),
    events: read(join(base, "events.json")),
    timeline: readFileSync(join(base, "timeline.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)),
    tags: read(join(base, "tags.json")),
  };
}

export const at = (s: Series, tag: string, step: number): number | null => {
  const a = s[tag];
  if (!a) return null;
  const v = a[step - 1];
  return v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v)) ? null : v;
};

export const last = (s: Series, tag: string): number | null => {
  const a = s[tag];
  if (!a) return null;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return a[i] as number;
  return null;
};

export const seriesOf = (s: Series, tag: string): (number | null)[] => s[tag] || [];

const f = (x: number | null | undefined, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pct = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x * 100).toFixed(d) + "%");
const int = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString("en-US"));
const big = (x: number | null | undefined, d = 2) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1e12) return (x / 1e12).toFixed(d) + "T";
  if (a >= 1e9) return (x / 1e9).toFixed(d) + "B";
  if (a >= 1e6) return (x / 1e6).toFixed(d) + "M";
  if (a >= 1e3) return (x / 1e3).toFixed(d) + "K";
  return x.toFixed(d);
};
const hrs = (s: number | null | undefined) => (s === null || s === undefined ? "—" : (s / 3600).toFixed(2) + "h");
const day = (t: number) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z";

export function pearson(a: (number | null)[], b: (number | null)[]): number | null {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== null && b[i] !== null && Number.isFinite(a[i]!) && Number.isFinite(b[i]!)) { xs.push(a[i]!); ys.push(b[i]!); }
  }
  if (xs.length < 3) return null;
  const mx = xs.reduce((p, c) => p + c, 0) / xs.length, my = ys.reduce((p, c) => p + c, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/* 每步的墙钟耗时 = 距上一个步完成（或运行开始）的时间。
   刻意不在 restart 处重置：重启等待要留在 gap 里，让 timing_s/step 少报的量看得见。 */
export function stepWall(events: any[], start: number): Map<number, number> {
  const m = new Map<number, number>();
  let prev: number | null = start;
  for (const e of events) {
    if (e.kind === "step") {
      if (prev !== null) m.set(e.step, e.t - prev);
      prev = e.t;
    }
  }
  return m;
}

/* 每次重启造成的停机：从上一个步完成到下一个步完成，再减去那一步自己上报的训练时长。
   连续多次重启只算一次（都摊在同一段等待里），否则会重复计数。 */
export function restartGaps(events: any[], series: Series): { t: number; until: number | null; lost: number | null }[] {
  const out: { t: number; until: number | null; lost: number | null }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind !== "restart") continue;
    const nxt = events.slice(i + 1).find((e) => e.kind === "step");
    if (!nxt) { out.push({ t: events[i].t, until: null, lost: null }); continue; }
    if (seen.has(nxt.step)) continue;
    seen.add(nxt.step);
    const before = events.slice(0, i).reverse().find((e) => e.kind === "step");
    const rep = at(series, "timing_s/step", nxt.step) ?? 0;
    out.push({ t: events[i].t, until: nxt.step, lost: nxt.t - (before ? before.t : events[i].t) - rep });
  }
  return out;
}

/* 桶：partial/<k>/... ，k 是数据新鲜度桶 */
export function buckets(run: RunData): { k: number; id: string }[] {
  const out: { k: number; id: string }[] = [];
  for (const t of Object.keys(run.series)) {
    const m = /^partial\/(\d+)\/frac$/.exec(t);
    if (m) out.push({ k: Number(m[1]), id: m[1] });
  }
  return out.sort((a, b) => a.k - b.k);
}

function table(rows: string[][]) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => (c ?? "").padEnd(w[i])).join("  ")).join("\n");
}

// ------------------------------------------------------------------ 主流程

export function report(runs: string[]) {
  const out: string[] = [];
  const P = (s = "") => out.push(s);
  const data = runs.map(loadRun);
  const now = Math.max(...data.map((d) => d.timeline[d.timeline.length - 1].now));

  P(`# Repository analysis  ${day(now)}`);
  P();

  for (const d of data) {
    const s = d.series;
    const st = d.status;
    const events = d.events;
    const steps = events.filter((e) => e.kind === "step").map((e) => e.step);
    const uniq = [...new Set(steps)];
    const wall = stepWall(events, st.run.start);
    const tl = d.timeline;
    const first = tl[0], cur = tl[tl.length - 1];
    const restarts = events.filter((e) => e.kind === "restart").length;

    P(`## ${st.run.label}  (${d.key})`);
    P();
    P(`start ${day(st.run.start)}   now ${day(cur.now)}   wall ${hrs(cur.now - st.run.start)}`);
    P(`step ${st.step.last}   phase ${st.step.phase}   progress ${pct(st.step.progress)}   restarts ${restarts}`);
    P(`headline ${st.headline.tag} = ${f(st.headline.last, 6)}  (prev ${f(st.headline.prev, 6)}, first ${f(st.headline.first, 6)} @ step ${st.headline.first_step})`);
    P(`version ${d.tags.version}`);
    P();

    // --- 逐步表
    P(`### Steps`);
    const rows = [["step", "value", "Δ", "tokens", "wall", "reported", "gap", "cost $", "done(Z)"]];
    let prevV: number | null = null;
    for (const e of events) {
      if (e.kind !== "step") continue;
      const w = wall.get(e.step);
      const rep = at(s, "timing_s/step", e.step);
      rows.push([
        String(e.step) + (e.redo ? "*" : ""),
        f(e.value, 6),
        prevV === null ? "—" : (e.value - prevV >= 0 ? "+" : "") + (e.value - prevV).toFixed(6),
        big(e.tokens),
        w ? hrs(w) : "—",
        rep ? hrs(rep) : "—",
        w && rep ? hrs(w - rep) : "—",
        int((e.t - st.run.start) * (d.key === "pro" ? 5.71 : 2.855)),
        day(e.t),
      ]);
      prevV = e.value;
    }
    P(table(rows));
    P();
    P(`  * marks a redone step (the same step number appears twice; the later one overrides the earlier)`);
    P(`  step rows in events ${steps.length}, ${uniq.length} steps after dedup`);
    P();

    // --- 时间账
    const sumRep = uniq.reduce((p, n) => p + (at(s, "timing_s/step", n) ?? 0), 0);
    const sumWall = [...wall.values()].reduce((p, n) => p + n, 0);
    const spanWall = cur.now - st.run.start;
    const tail = cur.now - events.filter((e) => e.kind === "step").slice(-1)[0].t;
    P(`### Time accounting`);
    P(`  wall clock (start → now)   ${hrs(spanWall)}`);
    P(`  sum of per-step wall       ${hrs(sumWall)} (${hrs(tail)} from last step to now)`);
    P(`  Σ timing_s/step          ${hrs(sumRep)}`);
    P(`  under-reported             ${hrs(spanWall - sumRep)}  ${pct((spanWall - sumRep) / spanWall)} of wall clock`);
    P(`  at $${d.key === "pro" ? 5.71 : 2.855}/s = $${int((spanWall - sumRep) * (d.key === "pro" ? 5.71 : 2.855))}`);
    P();
    const rg = restartGaps(events, s);
    P(`### Restarts`);
    const rrows = [["#", "restart time (Z)", "completed after", "under-reported", "$"]];
    rg.forEach((r, i) => rrows.push([
      String(i + 1), day(r.t), r.until ? "s" + r.until : "—",
      r.lost === null ? "—" : hrs(r.lost),
      r.lost === null ? "—" : "$" + int(r.lost * (d.key === "pro" ? 5.71 : 2.855)),
    ]));
    P(table(rrows));
    P(`  total under-reported ${hrs(rg.reduce((p, r) => p + (r.lost ?? 0), 0))}, ${pct(rg.reduce((p, r) => p + (r.lost ?? 0), 0) / (spanWall - sumRep))} of all under-reporting`);
    P();

    // --- 关键指标轨迹（末 8 步）
    const tracks = [
      ["dynsam/avg@n", "avg@n"],
      ["dynsam/passrate/zero", "all-wrong rate"],
      ["dynsam/passrate/one", "all-correct rate"],
      ["dynsam/num_measurable", "measurable questions"],
      ["dynsam/infra_error/seq_rate", "infra error rate"],
      ["dynsam/agg_turn/mean", "mean turns"],
      ["critic/rewards/mean", "reward mean"],
      ["critic/score/mean", "score mean"],
      ["actor/entropy_loss", "entropy"],
      ["actor/pg_loss", "pg_loss"],
      ["actor/grad_norm", "grad_norm"],
      ["ctx_total_length/mean", "ctx total"],
      ["ctx_response_length/mean", "response len"],
      ["ctx_prompt_length/mean", "prompt len"],
      ["train_infer_diff/new_infer/kl", "train/infer KL"],
      ["partial/avg_staleness", "avg staleness"],
      ["perf/total_num_tokens", "total tokens"],
      ["env/active", "active sandboxes"],
    ];
    P(`### Key metrics (last 8 steps)`);
    const head = ["metric", ...uniq.slice(-8).map((n) => `s${n}`)];
    const trs = [head];
    for (const [tag, label] of tracks) {
      const a = seriesOf(s, tag);
      if (!a.length) continue;
      const digits = /frac|rate|passrate|avg@n|progress|gen_frac/.test(tag) ? 4 : tag.includes("length") || tag.includes("num") || tag === "env/active" || tag === "perf/total_num_tokens" ? 1 : 6;
      trs.push([label, ...uniq.slice(-8).map((n) => f(at(s, tag, n), digits))]);
    }
    P(table(trs));
    P();

    // --- 桶分解
    const bs = buckets(d);
    P(`### Freshness buckets (${bs.length} total; larger k = older data)`);
    const bhead = ["step", ...bs.map((b) => "frac" + b.k), "avg_staleness", "Σfrac"];
    const brows = [bhead];
    for (const n of uniq.slice(-6)) {
      const fr = bs.map((b) => at(s, `partial/${b.id}/frac`, n));
      brows.push([
        "s" + n,
        ...fr.map((x) => f(x, 4)),
        f(at(s, "partial/avg_staleness", n), 4),
        f(fr.reduce((p, c) => p + (c ?? 0), 0), 4),
      ]);
    }
    P(table(brows));
    P();
    P(`### Per-bucket KL vs global KL`);
    const khead = ["step", "global KL", ...bs.map((b) => "KL" + b.k), "Σ frac·KL", "staleness"];
    const krows = [khead];
    for (const n of uniq.slice(-6)) {
      const kl = bs.map((b) => at(s, `partial/${b.id}/train_infer_diff/new_infer/kl`, n));
      const fr = bs.map((b) => at(s, `partial/${b.id}/frac`, n));
      krows.push([
        "s" + n,
        f(at(s, "train_infer_diff/new_infer/kl", n), 6),
        ...kl.map((x) => f(x, 6)),
        f(kl.reduce((p, c, i) => p + (c ?? 0) * (fr[i] ?? 0), 0), 6),
        f(at(s, "partial/avg_staleness", n), 4),
      ]);
    }
    P(table(krows));
    const gk = seriesOf(s, "train_infer_diff/new_infer/kl");
    const stl = seriesOf(s, "partial/avg_staleness");
    const k0 = seriesOf(s, `partial/${bs[0].id}/train_infer_diff/new_infer/kl`);
    P();
    P(`  corr(global KL, avg_staleness) = ${f(pearson(gk, stl), 4)}`);
    P(`  corr(bucket 0 KL, avg_staleness)  = ${f(pearson(k0, stl), 4)}`);
    P(`  global KL  first ${f(gk[0], 6)} → last ${f(gk[gk.length - 1], 6)}   extremum ${f(Math.max(...gk.filter((x): x is number => x !== null)), 6)}`);
    P(`  bucket 0 KL  first ${f(k0[0], 6)} → last ${f(k0[k0.length - 1], 6)}`);
    P();

    // --- 数据集构成
    const cats = [...new Set(Object.keys(s).map((t) => /^partial\/([^/]+)\/dataset-/.exec(t)?.[1]).filter(Boolean))] as string[];
    P(`### Dataset category token share (n_tokens of partial/agentic|chat|code|...)`);
    const catRows = [["step", ...cats]];
    for (const n of uniq.slice(-5)) {
      catRows.push(["s" + n, ...cats.map((c) => {
        const ids = Object.keys(s).filter((t) => t.startsWith(`partial/${c}/dataset-`) && t.endsWith("/n_tokens"));
        const tot = ids.reduce((p, id) => p + (at(s, id, n) ?? 0), 0);
        const all = cats.reduce((p, cc) => p + Object.keys(s).filter((t) => t.startsWith(`partial/${cc}/dataset-`) && t.endsWith("/n_tokens")).reduce((q, id) => q + (at(s, id, n) ?? 0), 0), 0);
        return all ? pct(tot / all, 1) : "—";
      })]);
    }
    P(table(catRows));
    P();

    if (d.key === "pro") { P(`  note: pro's cyber category only has avg_staleness left; frac/n_tokens are gone (the notice says the cyber dataset was removed from pro)`); P(); }
  }

  return out.join("\n");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
  const txt = report(["pro", "flash"]);
  console.log(txt);
  if (jsonOut) writeFileSync(jsonOut, txt, "utf8");
}
