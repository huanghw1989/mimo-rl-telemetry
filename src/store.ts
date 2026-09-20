/**
 * JSON 仓库（权威副本）。
 *
 * 布局：
 *   data/store/meta.json                    站点配置：标题、pins、数值格式规则、官方指标说明……
 *   data/store/notices.json                 官方公告（按 id 去重，追加型）
 *   data/store/benchmarks.json              离线基准成绩
 *   data/store/syncs.jsonl                  每次同步一行，回放功能的索引
 *   data/store/runs/<run>/axis.json         /series 给的时间轴：steps / walls / run_start
 *   data/store/runs/<run>/series.json       {指标名: [与 axis.steps 对齐的数组]}
 *   data/store/runs/<run>/events.json       /status 给的事件流：每一步的完成时间与主指标、重启
 *   data/store/runs/<run>/status.json       最近一次 /status 的全量返回
 *   data/store/runs/<run>/tags.json         指标名的生命周期（何时出现、何时消失、版本号）
 *   data/store/runs/<run>/live.jsonl        每次同步一行的采样器摘要
 *   data/store/runs/<run>/timeline.jsonl    每次同步一行的运行状态，回放时按时间取
 *
 * 两条不变式（已在 15 份历史快照上验证过，见 docs/02）：
 *   1. 序列只增不改 —— 同一步的数值一旦出现就不再变化，所以合并时永不覆盖已有非空值；
 *   2. 指标名会来也会走 —— penalty/* 一类指标会整条消失，所以只标记 last_seen，不删数据。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE } from "./paths";
import { appendLine, ensureDir, readJson, readJsonl, writeText } from "./util";

export interface StepEvent {
  t: number;
  kind: "step" | "restart";
  step?: number;
  value?: number | null;
  delta?: number | null;
  tokens?: number | null;
  redo?: boolean;
}

export interface Axis {
  run: string;
  steps: number[];
  walls: number[];
  run_start: number;
  updated_at: number;
}

export interface TagLife {
  run: string;
  version: string;
  versions: { version: string; at: number; n: number }[];
  tags: Record<string, { first_seen: number; last_seen: number }>;
}

export interface BenchRow {
  key: string;
  title: string;
  note: string;
  format: string;
  results: Record<string, Record<string, number>>;
  updated_at: number;
}

export interface SyncRecord {
  captured: number;
  server_now: number | null;
  source: "bootstrap" | "live";
  snapshot_dir?: string;
  runs: Record<string, { step: number | null; phase: string | null; cost: number | null; version: string | null; headline: number | null }>;
}

export function storeDir(...parts: string[]): string {
  return join(STORE, ...parts);
}

export function runDir(run: string): string {
  return storeDir("runs", run);
}

/* ------------------------------------------------------------------ 读取 */

export const readMeta = () => readJson<any>(storeDir("meta.json"), null);
export const writeMeta = (v: unknown) => writeJson(storeDir("meta.json"), v);

export const readNotices = () => readJson<any[]>(storeDir("notices.json"), []);
export const writeNotices = (v: unknown) => writeJson(storeDir("notices.json"), v);

export const readBenchmarks = () => readJson<BenchRow[]>(storeDir("benchmarks.json"), []);
export const writeBenchmarks = (v: unknown) => writeJson(storeDir("benchmarks.json"), v);

export const readAxis = (run: string): Axis | null => readJson<Axis | null>(join(runDir(run), "axis.json"), null);
export const readTags = (run: string): TagLife | null => readJson<TagLife | null>(join(runDir(run), "tags.json"), null);
export const readEvents = (run: string): StepEvent[] => readJson<StepEvent[]>(join(runDir(run), "events.json"), []);
export const readSeries = (run: string): Record<string, (number | null)[]> =>
  readJson<Record<string, (number | null)[]>>(join(runDir(run), "series.json"), {});
export const readStatus = (run: string) => readJson<any>(join(runDir(run), "status.json"), null);
export const readTimeline = (run: string) => readJsonl<any>(join(runDir(run), "timeline.jsonl"));
export const readLiveLog = (run: string) => readJsonl<any>(join(runDir(run), "live.jsonl"));
export const readSyncs = () => readJsonl<SyncRecord>(storeDir("syncs.jsonl"));

/* ------------------------------------------------------------------ 写入 */

/** series.json 自定义序列化：一个指标一行，方便 grep 和看 diff。 */
export function writeSeries(run: string, series: Record<string, (number | null)[]>): void {
  const keys = Object.keys(series).sort();
  const lines: string[] = ["{"];
  keys.forEach((k, i) => {
    const arr = series[k].map((v) => (v === null || v === undefined ? "null" : JSON.stringify(v)));
    lines.push(`${JSON.stringify(k)}: [${arr.join(",")}]${i === keys.length - 1 ? "" : ","}`);
  });
  lines.push("}");
  writeText(join(runDir(run), "series.json"), lines.join("\n") + "\n");
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2) + "\n");
}

export const writeAxis = (run: string, v: Axis) => writeJson(join(runDir(run), "axis.json"), v);
export const writeTags = (run: string, v: TagLife) => writeJson(join(runDir(run), "tags.json"), v);
export const writeEvents = (run: string, v: StepEvent[]) => writeJson(join(runDir(run), "events.json"), v);
export const writeStatus = (run: string, v: unknown) => writeJson(join(runDir(run), "status.json"), v);
export const appendTimeline = (run: string, v: unknown) => appendLine(join(runDir(run), "timeline.jsonl"), v);
export const appendLive = (run: string, v: unknown) => appendLine(join(runDir(run), "live.jsonl"), v);
export const appendSync = (v: SyncRecord) => appendLine(storeDir("syncs.jsonl"), v);

/* --------------------------------------------------------------- 合并逻辑 */

export interface MergeResult {
  newSteps: number[];
  newTags: string[];
  changedCells: number;
  /** 因为那一步被重跑而改写掉的格子（预期内）。 */
  rewrittenCells: { tag: string; step: number; was: number | null; now: number | null }[];
  /** 没有重跑却对不上的格子（预期外，一律保留本地值并告警）。 */
  conflicts: { tag: string; step: number; was: number | null; now: number | null }[];
  droppedTags: string[];
}

/**
 * 找出被重跑过的步。
 *
 * 站点对"重跑"的处理是两套：
 *   /status.events  只追加 —— 原来那次 step 16 的事件留着，后面再补一条 redo 事件；
 *   /series         会被重写 —— 数组里 step 16 的值换成重跑后的值。
 * 结果是同一个 step 在事件流里出现两次、值还不一样（flash step 16/17 就是这样）。
 * 所以只要某一步出现了两条 step 事件，就必须重新抓序列，并且允许覆盖那一步的旧值。
 */
export function findRedoSteps(events: StepEvent[]): number[] {
  return [...redoCounts(events).entries()].filter(([, n]) => n > 1).map(([step]) => step).sort((a, b) => a - b);
}

/** 每个步号出现了几条 step 事件。>1 说明这一步被重跑过。 */
export function redoCounts(events: StepEvent[]): Map<number, number> {
  const seen = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== "step" || e.step == null) continue;
    seen.set(e.step, (seen.get(e.step) ?? 0) + 1);
  }
  return seen;
}

/**
 * 把新抓到的一份序列并进仓库。
 *
 * 合并规则：
 *   - steps 只允许往后接。
 *   - 指标名的数组长度对齐 axis.steps；新指标先补足 null 再填值。
 *   - 已有非空值默认不覆盖；只有 overwriteSteps（重跑过的步）里的位置才允许改写，
 *     改写了什么会记在 rewrittenCells 里。
 */
export function mergeSeries(
  run: string,
  fresh: { steps: number[]; walls: number[]; run_start: number; series: Record<string, (number | null)[]> },
  at: number,
  overwriteSteps?: Set<number>,
): MergeResult {
  const axis = readAxis(run);
  const store = readSeries(run);
  const tags = readTags(run);

  const oldSteps = axis?.steps ?? [];
  const newSteps = fresh.steps.filter((s) => !oldSteps.includes(s));
  const nFresh = fresh.steps.length;
  const nOld = oldSteps.length;

  const result: MergeResult = {
    newSteps,
    newTags: [],
    changedCells: 0,
    rewrittenCells: [],
    conflicts: [],
    droppedTags: [],
  };

  for (const [tag, arr] of Object.entries(fresh.series)) {
    let target = store[tag];
    if (!target) {
      target = new Array(nFresh).fill(null);
      store[tag] = target;
      result.newTags.push(tag);
      if (tags) tags.tags[tag] = { first_seen: at, last_seen: at };
    } else if (target.length < nFresh) {
      while (target.length < nFresh) target.push(null);
    }
    const upto = Math.min(nFresh, arr.length);
    for (let i = 0; i < upto; i++) {
      const v = arr[i];
      if (v === null || v === undefined) continue;
      const step = fresh.steps[i];
      const canRewrite = overwriteSteps?.has(step) ?? false;
      if (target[i] === null || target[i] === undefined) {
        target[i] = v;
        result.changedCells++;
        if (tags && i >= nOld) tags.tags[tag].last_seen = at;
      } else if (target[i] !== v) {
        if (canRewrite) {
          result.rewrittenCells.push({ tag, step, was: target[i], now: v });
          target[i] = v;
        } else {
          result.conflicts.push({ tag, step, was: target[i], now: v });
        }
      }
    }
    if (tags) tags.tags[tag].last_seen = Math.max(tags.tags[tag]?.last_seen ?? at, at);
  }

  // 本次没返回的指标：保留数据，只标记"最近一次没见到"
  for (const tag of Object.keys(store)) {
    if (!(tag in fresh.series)) {
      result.droppedTags.push(tag);
      if (tags && tags.tags[tag]) tags.tags[tag].last_seen = Math.max(tags.tags[tag].last_seen, at);
    }
  }

  // 补齐那些既有 tag 但这次没在 fresh 里出现的数组长度
  for (const arr of Object.values(store)) {
    while (arr.length < nFresh) arr.push(null);
  }

  writeAxis(run, { run, steps: fresh.steps, walls: fresh.walls, run_start: fresh.run_start, updated_at: at });
  writeSeries(run, store);
  if (tags) writeTags(run, tags);
  return result;
}

/** 事件流按 (kind, step, t) 去重合并，保持时间序。 */
export function mergeEvents(run: string, incoming: StepEvent[]): { added: number; total: number; all: StepEvent[] } {
  const kept = readEvents(run);
  const seen = new Set(kept.map((e) => `${e.kind}|${e.step ?? ""}|${e.t}`));
  let added = 0;
  for (const e of incoming) {
    const key = `${e.kind}|${e.step ?? ""}|${e.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(e);
    added++;
  }
  kept.sort((a, b) => a.t - b.t);
  writeEvents(run, kept);
  return { added, total: kept.length, all: kept };
}

/** 公告按 id 去重合并。 */
export function mergeNotices(incoming: any[]): { added: number; total: number } {
  const kept = readNotices();
  const seen = new Set(kept.map((n) => n.id));
  let added = 0;
  for (const n of incoming) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    kept.push(n);
    added++;
  }
  kept.sort((a, b) => b.t - a.t);
  writeNotices(kept);
  return { added, total: kept.length };
}

/** 基准成绩按 (key, run, step) 合并，只增不改。 */
export function mergeBenchmarks(incoming: any[], at: number): { added: number; total: number } {
  const kept = readBenchmarks();
  const byKey = new Map(kept.map((b) => [b.key, b]));
  let added = 0;
  for (const b of incoming) {
    let row = byKey.get(b.key);
    if (!row) {
      row = { key: b.key, title: b.title, note: b.note ?? "", format: b.format ?? "num2", results: {}, updated_at: at };
      byKey.set(b.key, row);
    }
    row.title = b.title;
    row.note = b.note ?? "";
    row.format = b.format ?? row.format;
    for (const [run, vals] of Object.entries<any>(b.results ?? {})) {
      row.results[run] = row.results[run] ?? {};
      for (const [step, value] of Object.entries<any>(vals)) {
        if (row.results[run][step] === undefined) {
          row.results[run][step] = value as number;
          added++;
        }
      }
    }
    row.updated_at = at;
  }
  writeBenchmarks([...byKey.values()]);
  return { added, total: [...byKey.values()].reduce((n, b) => n + Object.values(b.results).reduce((m, r) => m + Object.keys(r).length, 0), 0) };
}

/** 指标名生命周期。version 变化时记一条，方便看出站点什么时候改了指标口径。 */
export function mergeTags(run: string, version: string, list: string[], at: number): { added: string[]; versionChanged: boolean } {
  const existing = readTags(run) ?? { run, version: "", versions: [], tags: {} };
  const versionChanged = existing.version !== version;
  if (versionChanged) {
    existing.versions.push({ version, at, n: list.length });
    existing.version = version;
  }
  const added: string[] = [];
  for (const tag of list) {
    if (!existing.tags[tag]) {
      existing.tags[tag] = { first_seen: at, last_seen: at };
      added.push(tag);
    }
  }
  const present = new Set(list);
  for (const tag of Object.keys(existing.tags)) {
    if (present.has(tag)) existing.tags[tag].last_seen = Math.max(existing.tags[tag].last_seen, at);
  }
  writeTags(run, existing);
  return { added, versionChanged };
}
