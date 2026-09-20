/**
 * 增量同步：把原站的数据搬进本地仓库，并维护 SQLite 索引。
 *
 * 三种用法（都从项目根目录跑）：
 *   bun src/sync.ts --bootstrap   把早期 15 份原始快照灌进仓库（只跑一次）
 *   bun src/sync.ts               增量抓一次
 *   bun src/sync.ts --reindex     只重建 SQLite 索引
 *
 * 常用开关：
 *   --force          跳过"没有新数据"的判断，强制重抓全部序列
 *   --reindex        只重建索引，不联网
 *   --no-assets      不比对原站前端资源
 *   --no-translate   不给新增公告补中文译文（默认会调用 env 里配的模型自动翻）
 *
 * 差量是怎么做的：
 *   /series 不支持区间参数，每次都会吐全量数组。所以差量分两层：
 *   1. 要不要发这个请求 —— /status 里的版本号和数据版本号、已完成步数都对得上时直接跳过，
 *      一次同步的流量从约 1 MB 降到约 40 KB。默认每 12 次同步强制全量一次兜底。
 *   2. 写不写这份数据 —— 序列只增不改（docs/02 有验证），合并时只补新格子和新指标，
 *      已有非空值一律不覆盖。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { apiGet, fetchAsset, fetchSeries } from "./api";
import { ASSETS, BOOTSTRAP_RAW, DB_PATH, SCHEMA_VERSION, STORE, UPSTREAM } from "./paths";
import { appendLive, appendSync, appendTimeline, mergeBenchmarks, mergeEvents, mergeNotices, mergeSeries, mergeTags, readAxis, readEvents, readLiveLog, readMeta, readSeries, readSyncs, readTags, redoCounts, writeMeta, writeStatus, type SyncRecord } from "./store";
import { checkpoint, getMeta, getRunRow, getSteps, getTagList, indexBenchmarks, indexMeta, indexNotices, indexRun, indexSyncs, openDb, putAssets, rebuildAll } from "./db";
import { translateNotices } from "./translate";
import { bj, ensureDir, iso, readJson, sha256, writeJson } from "./util";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const REINDEX_ONLY = args.has("--reindex");
const NO_ASSETS = args.has("--no-assets");
const NO_TRANSLATE = args.has("--no-translate");
const BOOTSTRAP = args.has("--bootstrap");

/** 连续跳过多少次序列抓取后强制全量一次，防止漏掉迟到的数值。 */
const FORCE_FULL_EVERY = 12;

interface Snapshot {
  status: any;
  live: any;
  tags: any;
  series: any;
}

/** 一次快照入库。bootstrap 和在线同步走同一条路径，保证口径一致。 */
function ingest(
  snap: Snapshot,
  meta: any,
  opts: { at: number; source: "bootstrap" | "live"; snapshotDir?: string },
): Record<string, any> {
  const { at } = opts;

  // ---- 站点配置（只在有变化时落盘，文件时间戳才有意义）
  const prevMeta = readMeta();
  const metaValue = {
    schema_version: SCHEMA_VERSION,
    title: meta.title,
    subtitle: meta.subtitle,
    runs: meta.runs,
    pins: meta.pins,
    formats: meta.formats,
    compositions: meta.compositions,
    categories: meta.categories,
    social: meta.social,
    footer_note: meta.footer_note,
    stream_start: meta.stream_start,
    descriptions: meta.descriptions,
    about: meta.about,
    headline_tag: meta.headline_tag,
    hist_prefix: meta.hist_prefix,
    updated_at: at,
  };
  const sameConfig = prevMeta && JSON.stringify({ ...prevMeta, updated_at: 0 }) === JSON.stringify({ ...metaValue, updated_at: 0 });
  writeMeta(sameConfig ? { ...prevMeta, updated_at: at } : metaValue);

  const out: Record<string, any> = {};

  for (const [run, s] of Object.entries<Snapshot>(snap)) {
    if (!s?.status) continue;
    const status = s.status;
    writeStatus(run, status);
    appendTimeline(run, {
      captured: at,
      now: status.clock?.now ?? null,
      source: opts.source,
      cost: status.cost?.so_far ?? null,
      rate: status.cost?.rate_per_s ?? null,
      start: status.run?.start ?? null,
      mode: status.run?.mode ?? null,
      step: status.step?.last ?? null,
      phase: status.step?.phase ?? null,
      progress: status.step?.progress ?? null,
      gen_frac: status.step?.gen_frac ?? null,
      since: status.step?.since ?? null,
      expected: status.step?.expected ?? null,
      restarted_at: status.step?.restarted_at ?? null,
      version: status.version ?? null,
      value: status.headline?.last ?? null,
      n_restarts: status.totals?.restarts ?? null,
      totals: status.totals ?? null,
    });

    if (s.live) {
      /* 采样器的滚动明细（最近约 60 条，30 秒一条）也要留档，否则回放时
         feed 里只剩 step/restart 事件，"accepted X/Y · judged … · pass …"
         这些采样器报告全丢了。两次同步之间会有重叠（窗口 30 分钟 > 同步间隔），
         按上一条留档的 log_time 去重，只存这之后的新报告。 */
      const prevLog = readLiveLog(run).at(-1)?.log_time ?? null;
      const entries = (s.live.entries ?? []).filter((e: any) => prevLog == null || (e?.t ?? 0) > prevLog);
      appendLive(run, {
        captured: at,
        log_time: s.live.log_time ?? null,
        latest: s.live.latest ?? null,
        ...(entries.length ? { entries: entries.slice(-60) } : {}),
      });
    }

    const before = redoCounts(readEvents(run));
    const ev = mergeEvents(run, status.events ?? []);
    // mergeTags 必须先跑：它负责登记新出现的指标名，mergeSeries 再往里填值。
    const tg = s.tags
      ? mergeTags(run, s.tags.version, s.tags.tags, at)
      : { added: [], versionChanged: false };
    // 本次新出现的重跑步：站点会改写 /series 里这几步的值，合并时要允许覆盖
    const after = redoCounts(ev.all);
    const redo = new Set([...after.entries()].filter(([step, n]) => n > (before.get(step) ?? 0)).map(([step]) => step));
    const mg = s.tags && s.series
      ? mergeSeries(run, s.series, at, redo)
      : { newSteps: [], newTags: [], changedCells: 0, rewrittenCells: [], conflicts: [], droppedTags: [] };

    out[run] = {
      step: status.step?.last ?? null,
      phase: status.step?.phase ?? null,
      cost: status.cost?.so_far ?? null,
      version: status.version ?? null,
      headline: status.headline?.last ?? null,
      new_steps: mg.newSteps.length,
      new_tags: mg.newTags.length,
      new_cells: mg.changedCells,
      redo_steps: redo.size,
      rewritten_cells: mg.rewrittenCells.length,
      conflicts: mg.conflicts.length,
      events_added: ev.added,
      tags_added: tg.added.length,
      tags_removed: mg.droppedTags.length,
    };

    if (mg.rewrittenCells.length) {
      console.log(`  ${run}: ${redo.size} steps were redone (step ${[...redo].join(", ")}), ${mg.rewrittenCells.length} cells rewritten`);
    }
    if (mg.conflicts.length) {
      console.warn(`  !! ${run}: ${mg.conflicts.length} cells disagree with the site and are not from a redo; keeping local values. First few:`);
      for (const r of mg.conflicts.slice(0, 5)) console.warn(`     ${r.tag} step ${r.step}: local ${r.was} / site ${r.now}`);
    }
  }

  if (snap.__notices) {
    const n = mergeNotices(snap.__notices);
    if (n.added) console.log(`  notices +${n.added} (${n.total} total)`);
  }
  if (snap.__benchmarks) {
    const b = mergeBenchmarks(snap.__benchmarks, at);
    if (b.added) console.log(`  benchmarks +${b.added} points`);
  }

  appendSync({
    captured: at,
    server_now: snap.pro?.status?.clock?.now ?? snap.flash?.status?.clock?.now ?? null,
    source: opts.source,
    snapshot_dir: opts.snapshotDir,
    runs: Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, { step: v.step, phase: v.phase, cost: v.cost, version: v.version, headline: v.headline }])),
  } as SyncRecord);

  return out;
}

/* --------------------------------------------------------------- bootstrap */

function bootstrap(): number {
  if (!existsSync(BOOTSTRAP_RAW)) {
    /* The repository ships a finished warehouse in data/store/, so a fresh
       clone does not need this path at all. Bootstrap only matters when you
       want to rebuild the warehouse from raw periodic snapshots. */
    console.error(
      `no raw snapshot directory available: ${BOOTSTRAP_RAW}\n` +
        "  data/store/ already ships the full repository; just use `bun run server`;\n" +
        "  only put snapshots named YYYYMMDDTHHMMSSZ/ under data/seed/ if you need to rebuild from raw snapshots.",
    );
    return 0;
  }
  const dirs = readdirSync(BOOTSTRAP_RAW).filter((d) => /^\d{8}T\d{6}Z$/.test(d)).sort();
  console.log(`Bootstrapping from ${dirs.length} historical snapshots...`);
  let n = 0;
  for (const d of dirs) {
    const dir = join(BOOTSTRAP_RAW, d);
    const at = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`) / 1000;
    const meta = readJson<any>(join(dir, "runs.json"), null);
    if (!meta) continue;
    const snap: any = {};
    for (const run of (meta.runs ?? []).map((r: any) => r.key)) {
      const status = readJson<any>(join(dir, `status_${run}.json`), null);
      const tags = readJson<any>(join(dir, `tags_${run}.json`), null);
      const series = readJson<any>(join(dir, `series_${run}.json`), null);
      if (!status || !tags || !series) continue;
      snap[run] = { status, live: readJson<any>(join(dir, `live_${run}.json`), null), tags, series };
    }
    snap.__notices = readJson<any>(join(dir, "notices.json"), null)?.notices ?? null;
    snap.__benchmarks = readJson<any>(join(dir, "benchmarks.json"), null)?.benchmarks ?? null;
    if (!Object.keys(snap).some((k) => !k.startsWith("__"))) continue;
    const res = ingest(snap, meta, { at, source: "bootstrap", snapshotDir: `seed/${d}` });
    const brief = Object.entries(res).map(([k, v]: any) => `${k} step=${v.step} +${v.new_steps} steps/+${v.new_tags} metrics/+${v.new_cells} cells`).join("  ");
    console.log(`  ${d}  ${brief}`);
    n++;
  }
  return n;
}

/* -------------------------------------------------------------- live sync */

const RUN_KEYS = () => (readMeta()?.runs ?? []).map((r: any) => r.key);

function shouldSkipSeries(run: string, status: any): { skip: boolean; why: string } {
  const axis = readAxis(run);
  const tags = readTags(run);
  const stored = readSeries(run);
  if (!axis || !tags || !Object.keys(stored).length) return { skip: false, why: "no data for this run in the repo yet" };

  const storedMax = axis.steps.length ? axis.steps[axis.steps.length - 1] : 0;
  if (status.step?.last !== storedMax) return { skip: false, why: `new steps (${storedMax} → ${status.step?.last})` };

  // 事件流里同一步出现两次 = 那一步被重跑过，序列会被改写，必须重抓。
  // 注意不能用"事件条数 == 步数"判断：重跑会让事件条数比步数多。
  // 只对"我们还没吃进去的"重跑动手，否则每一步都会触发全量重抓。
  const now = redoCounts(status.events ?? []);
  const storedRedo = redoCounts(readEvents(run));
  const fresh = [...now.entries()].filter(([step, n]) => n > (storedRedo.get(step) ?? 0)).map(([step]) => step);
  if (fresh.length) return { skip: false, why: `newly appeared redone steps (step ${fresh.join(", ")})` };

  const state = readJson<any>(join(STORE, "state.json"), { skips: {} });
  const skips = state.skips?.[run] ?? 0;
  if (skips >= FORCE_FULL_EVERY) return { skip: false, why: `skipped ${skips} times in a row; forcing a full fetch` };
  return { skip: true, why: "version and step count unchanged" };
}

function markSkip(run: string, skipped: boolean): void {
  const p = join(STORE, "state.json");
  const state = readJson<any>(p, { skips: {} });
  state.skips = state.skips ?? {};
  state.skips[run] = skipped ? (state.skips[run] ?? 0) + 1 : 0;
  state.updated_at = Date.now() / 1000;
  writeJson(p, state);
}

async function syncLive(): Promise<void> {
  const meta = await apiGet("/runs");
  const notices = await apiGet("/notices");
  const benchmarks = await apiGet("/benchmarks");
  const at = Date.now() / 1000;

  const snap: any = { __notices: notices.notices ?? [], __benchmarks: benchmarks.benchmarks ?? [] };
  const runs = (meta.runs ?? []).map((r: any) => r.key);

  for (const run of runs) {
    const status = await apiGet("/status", { run });
    const live = await apiGet("/live", { run }).catch(() => null);
    const decision = FORCE ? { skip: false, why: "--force" } : shouldSkipSeries(run, status);

    if (decision.skip) {
      console.log(`  ${run}: skipping series fetch (${decision.why})`);
      markSkip(run, true);
      snap[run] = { status, live, tags: null, series: null };
      continue;
    }
    markSkip(run, false);
    console.log(`  ${run}: fetching series (${decision.why})`);
    const tags = await apiGet("/tags", { run });
    const t0 = Date.now();
    const series = await fetchSeries(run, tags.version, tags.tags, (done, total) => {
      if (done === total && total > 1) process.stdout.write(`    ${run}: all ${total} batches fetched\n`);
    });
    console.log(`    ${run}: ${tags.tags.length} metrics / ${series.chunks} batches / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    snap[run] = { status, live, tags, series };
  }

  const res = ingest(snap, meta, { at, source: "live" });
  for (const [run, v] of Object.entries<any>(res)) {
    console.log(
      `  ${run}: step=${v.step} ${v.phase} avg@n=${v.headline} cost=$${(v.cost ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}` +
        `  +${v.new_steps} steps +${v.new_tags} metrics +${v.new_cells} cells +${v.tags_added} metric names`,
    );
  }
}

/* ------------------------------------------------------------ 前端资源比对 */

async function telemetryAssets(): Promise<void> {
  ensureDir(UPSTREAM);
  const manifest = readJson<Record<string, { sha256: string; bytes: number }>>(join(UPSTREAM, "manifest.json"), {});
  const rows: { path: string; sha256: string; bytes: number; fetched: number }[] = [];
  const changed: string[] = [];
  const now = Date.now() / 1000;
  for (const a of ASSETS) {
    const buf = await fetchAsset(a);
    const h = sha256(buf);
    rows.push({ path: a, sha256: h, bytes: buf.length, fetched: now });
    if (manifest[a] && manifest[a].sha256 !== h) changed.push(a);
    if (!manifest[a]) changed.push(`${a}(new)`);
    // 只更新 data/upstream 的原始副本；site/ 是带回放层的工作副本，不自动覆盖
    const dest = join(UPSTREAM, a);
    ensureDir(dirname(dest));
    await Bun.write(dest, buf);
  }
  writeJson(join(UPSTREAM, "manifest.json"), Object.fromEntries(rows.map((r) => [r.path, { sha256: r.sha256, bytes: r.bytes }])));
  putAssets(rows);
  if (changed.length) {
    console.log(`  ! upstream assets changed: ${changed.join(", ")}`);
    console.log(`    site/ is a working copy with the replay layer and is not auto-overwritten; compare the raw files in data/upstream/ manually.`);
  } else {
    console.log(`  upstream assets unchanged (${ASSETS.length} files)`);
  }
}

/* --------------------------------------------------------------------- 主流程 */

async function main(): Promise<void> {
  ensureDir(STORE);

  if (!REINDEX_ONLY && BOOTSTRAP) {
    const n = bootstrap();
    console.log(`Bootstrap done: ${n} snapshots`);
  }

  if (!REINDEX_ONLY) {
    console.log(`\nLive sync ${iso(Date.now() / 1000)} (${bj(Date.now() / 1000)})`);
    await syncLive();
    if (!NO_ASSETS) await telemetryAssets();
  }

  const t0 = Date.now();
  if (REINDEX_ONLY) {
    console.log("\nRebuilding SQLite index from scratch...");
    // 放进一个事务里：服务端可能是另一个进程在只读查询，
    // 逐表 DELETE + 重插会让它读到半成品。
    openDb().transaction(() => rebuildAll())();
  } else {
    console.log("\nIncrementally updating SQLite index...");
    const m = readMeta();
    openDb().transaction(() => {
      indexMeta();
      indexNotices();
      indexBenchmarks();
      for (const r of m?.runs ?? []) {
        const s = indexRun(r.key);
        console.log(`  ${r.key}: ${s.steps} steps / ${s.tags} metrics / ${s.newCells} new values`);
      }
      indexSyncs();
    })();
  }
  checkpoint();
  const { size } = statSync(DB_PATH);
  console.log(`Index done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(size / 1024 / 1024).toFixed(1)} MB`);

  /* 公告的中文译文。数据已经入库了，翻译失败不该把整次同步判死：
     译文只是显示层的东西，缺了下一次同步会补。 */
  if (!REINDEX_ONLY && !NO_TRANSLATE) {
    console.log("\nNotice translation (only new or changed originals)...");
    try {
      await translateNotices({});
    } catch (err) {
      console.warn(`  ! notice translation skipped: ${(err as Error).message}`);
    }
  }

  // 收尾：打印仓库规模与最新状态
  const m = getMeta();
  const syncs = readSyncs();
  console.log(`\nRepo: ${syncs.length} sync points`);
  for (const r of m.runs) {
    const row = getRunRow(r.key);
    const steps = getSteps(r.key, null);
    console.log(
      `  ${r.label}: ${steps.length} steps / ${getTagList(r.key, null).length} metrics` +
        ` / latest step ${steps.length ? steps[steps.length - 1].step : "—"}` +
        ` / version ${row?.version ?? "—"} / mode ${row?.mode ?? "—"}`,
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
