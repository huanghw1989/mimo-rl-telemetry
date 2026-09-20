/**
 * SQLite 索引层。由 JSON 仓库派生，删掉可以随时重建。
 *
 * 为什么不直接拿 JSON 服务前端：
 *   - 按 tag 取序列要遍历整个 series.json；指标上千、步数上百以后，每次请求都要解析
 *     几十 MB 的 JSON。
 *   - 回放要按"某时刻之前完成的步"筛数据，用 SQL 就是一句 WHERE。
 *   - bun 自带 bun:sqlite，不需要装任何依赖。
 *
 * 数值列为什么存 BLOB 而不是 (tag, step, value) 长表：
 *   实测长表要 10.6 MB（指标名在每一行重复一遍，平均 45 字节），而同样的数据压成
 *   Float64 只要 0.6 MB。一个指标一个 blob、下表按 step-1 定位，既省空间又是列式的，
 *   取某个指标的历史就是一次主键查询加一次切片。缺值用 NaN 表示 —— 站点的数值来自
 *   JSON，不可能是 NaN，所以不会和真值撞车。
 */
import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { DB_PATH } from "./paths";
import { ensureDir } from "./util";
import { readAxis, readBenchmarks, readEvents, readLiveLog, readMeta, readNotices, readSeries, readStatus, readSyncs, readTags, readTimeline } from "./store";

let db: Database | null = null;

export function openDb(readonly = false): Database {
  if (db) return db;
  ensureDir(dirname(DB_PATH));
  db = new Database(DB_PATH, readonly ? { readonly: true } : undefined);
  if (!readonly) {
    db.run(SCHEMA);
    migrate(db);
  }
  return db;
}

/* 索引是可再生的，但升级时不必强制全量重建：只补缺的列即可。
   live.entries 是后加的（采样器滚动明细，回放 feed 用），老库 ALTER 一下就行。 */
function migrate(d: Database): void {
  const cols = (d.prepare("PRAGMA table_info(live)").all() as any[]).map((c) => c.name);
  if (!cols.includes("entries")) d.run("ALTER TABLE live ADD COLUMN entries TEXT");
}

export function closeDb(): void {
  db?.close();
  db = null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS runs (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, note TEXT, color_index INTEGER,
  start REAL, mode TEXT, rate REAL, headline_tag TEXT, version TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  run TEXT NOT NULL, tag TEXT NOT NULL, first_seen REAL NOT NULL, last_seen REAL NOT NULL,
  PRIMARY KEY (run, tag)
);

CREATE TABLE IF NOT EXISTS steps (
  run TEXT NOT NULL, step INTEGER NOT NULL, t REAL, wall REAL,
  value REAL, delta REAL, tokens REAL, redo INTEGER,
  PRIMARY KEY (run, step)
) WITHOUT ROWID;

/* 列式数值：v 是 Float64 数组，下标 = step - 1，缺值为 NaN，n = 已写入的格数 */
CREATE TABLE IF NOT EXISTS series (
  run TEXT NOT NULL, tag TEXT NOT NULL, n INTEGER NOT NULL, v BLOB NOT NULL,
  PRIMARY KEY (run, tag)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, t REAL, run TEXT, text TEXT
);

CREATE TABLE IF NOT EXISTS benchmarks (
  bkey TEXT NOT NULL, title TEXT, note TEXT, format TEXT,
  run TEXT NOT NULL, step INTEGER NOT NULL, value REAL, ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bkey, run, step)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS syncs (
  sid INTEGER PRIMARY KEY, captured REAL NOT NULL, server_now REAL, source TEXT
);

CREATE TABLE IF NOT EXISTS timeline (
  sync_id INTEGER NOT NULL, run TEXT NOT NULL,
  now REAL, cost REAL, step INTEGER, phase TEXT, progress REAL, gen_frac REAL,
  since REAL, expected REAL, restarted_at REAL, version TEXT,
  value REAL, n_restarts INTEGER, totals TEXT, mode TEXT, rate REAL, start REAL,
  PRIMARY KEY (sync_id, run)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS live (
  sync_id INTEGER NOT NULL, run TEXT NOT NULL,
  t REAL, step INTEGER, passrate REAL, n INTEGER, pr0 REAL, pr1 REAL, json TEXT,
  entries TEXT,
  PRIMARY KEY (sync_id, run)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS assets (
  path TEXT PRIMARY KEY, sha256 TEXT, bytes INTEGER, fetched REAL
);

CREATE INDEX IF NOT EXISTS ix_steps_t ON steps(run, t);
`;

/* ------------------------------------------------------------ 全量重建 */

const TABLES = ["meta", "runs", "tags", "steps", "series", "notices", "benchmarks", "syncs", "timeline", "live", "assets"];

export function wipe(): void {
  const d = openDb();
  for (const t of TABLES) d.run(`DELETE FROM ${t}`);
}

/* ------------------------------------------------------------ blob 读写 */

const EMPTY = new Float64Array(0);

function blobToFloats(b: Uint8Array | null): Float64Array {
  if (!b || b.byteLength < 8) return EMPTY;
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function floatsToBlob(a: Float64Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

/* ------------------------------------------------------------ 写入索引 */

export function indexMeta(): void {
  const d = openDb();
  const meta = readMeta();
  if (!meta) return;
  const put = d.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const k of Object.keys(meta)) put.run(k, JSON.stringify(meta[k]));

  const runPut = d.prepare(
    `INSERT INTO runs(key,label,note,color_index,start,mode,rate,headline_tag,version) VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET label=excluded.label, note=excluded.note, color_index=excluded.color_index,
       start=COALESCE(excluded.start,runs.start), mode=COALESCE(excluded.mode,runs.mode),
       rate=COALESCE(excluded.rate,runs.rate), headline_tag=excluded.headline_tag, version=COALESCE(excluded.version,runs.version)`,
  );
  for (const r of meta.runs ?? []) {
    const st = readStatus(r.key);
    runPut.run(
      r.key, r.label, r.note ?? "", r.color_index ?? null,
      st?.run?.start ?? null, st?.run?.mode ?? null, st?.cost?.rate_per_s ?? null,
      meta.headline_tag ?? null, st?.version ?? null,
    );
  }
}

export function indexNotices(): void {
  const d = openDb();
  const put = d.prepare("INSERT INTO notices(id,t,run,text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET t=excluded.t, text=excluded.text, run=excluded.run");
  for (const n of readNotices()) put.run(n.id, n.t ?? null, n.run ?? null, n.text ?? "");
}

export function indexBenchmarks(): void {
  const d = openDb();
  d.run("DELETE FROM benchmarks");
  const put = d.prepare("INSERT INTO benchmarks(bkey,title,note,format,run,step,value,ord) VALUES(?,?,?,?,?,?,?,?)");
  // ord 记住站点返回的顺序。表的主键是 (bkey, run, step)，不存 ord 的话
  // 查出来会按 key 的字母序排，页面上的顺序就和原站不一样了。
  readBenchmarks().forEach((b, ord) => {
    for (const [run, vals] of Object.entries<any>(b.results ?? {})) {
      for (const [step, value] of Object.entries<any>(vals)) {
        put.run(b.key, b.title, b.note ?? "", b.format ?? "num2", run, Number(step), value as number, ord);
      }
    }
  });
}

/** 某一步被重跑过（事件流里出现两条 step 事件）就返回它的步号。 */
function readRedoSteps(run: string): number[] {
  const seen = new Map<number, number>();
  for (const e of readEvents(run)) {
    if (e.kind !== "step" || e.step == null) continue;
    seen.set(e.step, (seen.get(e.step) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
}

export interface IndexStat {
  tags: number;
  steps: number;
  cells: number;
  newCells: number;
  bytes: number;
}

/** 把一个 run 的 JSON 仓库搬进索引。只补新的格子，已写入的位置不动。 */
export function indexRun(run: string): IndexStat {
  const d = openDb();
  const axis = readAxis(run);
  if (!axis) return { tags: 0, steps: 0, cells: 0, newCells: 0, bytes: 0 };
  const maxStep = axis.steps.length ? axis.steps[axis.steps.length - 1] : 0;

  const stepPut = d.prepare(
    `INSERT INTO steps(run,step,t,wall,value,delta,tokens,redo) VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(run,step) DO UPDATE SET t=COALESCE(excluded.t,steps.t), wall=COALESCE(excluded.wall,steps.wall),
       value=COALESCE(excluded.value,steps.value), delta=COALESCE(excluded.delta,steps.delta),
       tokens=COALESCE(excluded.tokens,steps.tokens), redo=COALESCE(excluded.redo,steps.redo)`,
  );
  const wallByStep = new Map<number, number>();
  axis.steps.forEach((s, i) => wallByStep.set(s, axis.walls[i] ?? null));
  for (const e of readEvents(run)) {
    if (e.kind !== "step" || e.step == null) continue;
    stepPut.run(run, e.step, e.t ?? null, wallByStep.get(e.step) ?? null, e.value ?? null, e.delta ?? null, e.tokens ?? null, e.redo ? 1 : 0);
  }
  for (const s of axis.steps) stepPut.run(run, s, null, wallByStep.get(s) ?? null, null, null, null, null);

  const tagLife = readTags(run);
  const tagPut = d.prepare(
    `INSERT INTO tags(run,tag,first_seen,last_seen) VALUES(?,?,?,?)
     ON CONFLICT(run,tag) DO UPDATE SET first_seen=MIN(excluded.first_seen,tags.first_seen), last_seen=MAX(excluded.last_seen,tags.last_seen)`,
  );
  const tagEntries = Object.entries(tagLife?.tags ?? {});
  for (const [tag, life] of tagEntries) tagPut.run(run, tag, life.first_seen, life.last_seen);

  const existing = new Map<string, Float64Array>();
  for (const row of d.prepare("SELECT tag,n,v FROM series WHERE run=?").all(run) as any[]) {
    existing.set(row.tag, blobToFloats(row.v));
  }

  const series = readSeries(run);
  const put = d.prepare("INSERT INTO series(run,tag,n,v) VALUES(?,?,?,?) ON CONFLICT(run,tag) DO UPDATE SET n=excluded.n, v=excluded.v");

  // 重跑过的步在 JSON 仓库里是被覆盖过的，索引也得跟着覆盖一次，
  // 否则索引会一直留着第一次写入的旧值。
  const rewritable = new Set(readRedoSteps(run).map((s) => s - 1));

  let newCells = 0;
  let cells = 0;
  let bytes = 0;

  // 不用自带事务：调用方（sync.ts）会把整个索引阶段包在一个事务里，
  // SQLite 不支持嵌套事务，这里再开一层会直接报错。
  for (const [tag, arr] of Object.entries(series)) {
    const old = existing.get(tag) ?? EMPTY;
    const size = Math.max(maxStep, old.length, arr.length);
    const next = new Float64Array(size);
    next.fill(NaN);
    next.set(old.subarray(0, Math.min(old.length, size)));
    let touched = false;
    const upto = Math.min(arr.length, axis.steps.length);
    for (let i = 0; i < upto; i++) {
      const v = arr[i];
      if (v === null || v === undefined) continue;
      const slot = axis.steps[i] - 1;
      if (slot < 0 || slot >= size) continue;
      if (Number.isNaN(next[slot])) {
        next[slot] = v;
        newCells++;
        touched = true;
      } else if (rewritable.has(slot) && next[slot] !== v) {
        next[slot] = v;
        touched = true;
      }
    }
    cells += upto;
    if (touched || old.length !== size) {
      put.run(run, tag, size, floatsToBlob(next));
      bytes += size * 8;
    } else {
      bytes += old.length * 8;
    }
  }

  // 已经完全消失的指标名，索引里也留着；只把引用清掉的那些删掉即可，这里不做删除。
  return { tags: tagEntries.length, steps: axis.steps.length, cells, newCells, bytes };
}

export function indexSyncs(): void {
  const d = openDb();
  const syncs = readSyncs();
  const syncPut = d.prepare("INSERT OR IGNORE INTO syncs(sid,captured,server_now,source) VALUES(?,?,?,?)");
  syncPut.run(0, 0, null, "origin"); // 占位，保证 sid 与 syncs.jsonl 的行号一致
  syncs.forEach((s, i) => syncPut.run(i + 1, s.captured, s.server_now ?? null, s.source));

  const tlPut = d.prepare(
    `INSERT INTO timeline(sync_id,run,now,cost,step,phase,progress,gen_frac,since,expected,restarted_at,version,value,n_restarts,totals,mode,rate,start)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sync_id,run) DO NOTHING`,
  );
  const livePut = d.prepare(
    `INSERT INTO live(sync_id,run,t,step,passrate,n,pr0,pr1,json,entries) VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(sync_id,run) DO NOTHING`,
  );

  // 时间线日志按 captured 建索引，避免同步点一多就退化成 O(n²)
  const meta = readMeta();
  const tlIndex = new Map<string, Map<number, any>>();
  const liveIndex = new Map<string, Map<number, any>>();
  for (const r of meta?.runs ?? []) {
    tlIndex.set(r.key, new Map(readTimeline(r.key).map((row) => [row.captured, row])));
    liveIndex.set(r.key, new Map(readLiveLog(r.key).map((row) => [row.captured, row])));
  }

  syncs.forEach((s, i) => {
    const sid = i + 1;
    for (const run of Object.keys(s.runs ?? {})) {
      const row = tlIndex.get(run)?.get(s.captured);
      if (row) {
        tlPut.run(
          sid, run, row.now ?? null, row.cost ?? null, row.step ?? null, row.phase ?? null, row.progress ?? null, row.gen_frac ?? null,
          row.since ?? null, row.expected ?? null, row.restarted_at ?? null, row.version ?? null, row.value ?? null,
          row.n_restarts ?? null, row.totals ? JSON.stringify(row.totals) : null, row.mode ?? null, row.rate ?? null, row.start ?? null,
        );
      }
      const lrow = liveIndex.get(run)?.get(s.captured);
      if (lrow) {
        const L = lrow.latest ?? {};
        const entries = Array.isArray(lrow.entries) ? lrow.entries : null;
        livePut.run(
          sid, run, L.t ?? null, L.step ?? null, L.passrate ?? null, L.n ?? null, L.pr0 ?? null, L.pr1 ?? null,
          JSON.stringify(L), entries ? JSON.stringify(entries) : null,
        );
      }
    }
  });
}

/** 从头重建整个索引。 */
export function rebuildAll(): void {
  wipe();
  indexMeta();
  indexNotices();
  indexBenchmarks();
  for (const r of readMeta()?.runs ?? []) indexRun(r.key);
  indexSyncs();
}

/** 同步结束把 WAL 落盘，否则 -wal 文件会一直长。 */
export function checkpoint(): void {
  const d = openDb();
  d.run("PRAGMA wal_checkpoint(TRUNCATE)");
  d.run("PRAGMA optimize");
}

/* ------------------------------------------------------------ 查询 */

export function getMeta(): any {
  const d = openDb(true);
  const out: any = {};
  for (const r of d.prepare("SELECT key,value FROM meta").all() as any[]) out[r.key] = JSON.parse(r.value);
  out.runs = (d.prepare("SELECT key,label,note,color_index FROM runs").all() as any[]).map((r) => ({
    key: r.key, label: r.label, note: r.note, color_index: r.color_index,
  }));
  return out;
}

export function getRunRow(run: string): any {
  return openDb(true).prepare("SELECT * FROM runs WHERE key=?").get(run);
}

/** 回放定位：captured <= asof 的最后一个同步点；asof 为空则取最新的。 */
export function pickSync(asof: number | null): any {
  const d = openDb(true);
  const cols = "sid,captured,server_now,source";
  return asof == null
    ? d.prepare(`SELECT ${cols} FROM syncs ORDER BY sid DESC LIMIT 1`).get()
    : d.prepare(`SELECT ${cols} FROM syncs WHERE captured<=? ORDER BY sid DESC LIMIT 1`).get(asof);
}

export function listSyncs(): any[] {
  return openDb(true).prepare("SELECT sid,captured,server_now,source FROM syncs WHERE sid>0 ORDER BY sid").all() as any[];
}

/* 一步什么时候算"完成可见"：优先用事件流的时间戳，没有就退回序列里的 wall。 */
const STEP_TIME = "COALESCE(t, wall)";

export function maxVisibleStep(run: string, asof: number | null): number {
  const d = openDb(true);
  const row = (asof == null
    ? d.prepare("SELECT MAX(step) AS m FROM steps WHERE run=?").get(run)
    : d.prepare(`SELECT MAX(step) AS m FROM steps WHERE run=? AND ${STEP_TIME}<=?`).get(run, asof)) as any;
  return row?.m ?? 0;
}

export function getSteps(run: string, asof: number | null): any[] {
  const d = openDb(true);
  return (asof == null
    ? d.prepare("SELECT step,t,wall,value,delta,tokens,redo FROM steps WHERE run=? ORDER BY step").all(run)
    : d.prepare(`SELECT step,t,wall,value,delta,tokens,redo FROM steps WHERE run=? AND ${STEP_TIME}<=? ORDER BY step`).all(run, asof)) as any[];
}

export function getRestarts(run: string, asof: number | null): number[] {
  return readEvents(run).filter((e) => e.kind === "restart" && (asof == null || e.t <= asof)).map((e) => e.t);
}

export function getTagList(run: string, asof: number | null): string[] {
  const d = openDb(true);
  const rows = (asof == null
    ? d.prepare("SELECT tag FROM tags WHERE run=? ORDER BY tag").all(run)
    : d.prepare("SELECT tag FROM tags WHERE run=? AND first_seen<=? ORDER BY tag").all(run, asof)) as any[];
  return rows.map((r) => r.tag);
}

export function getRunVersion(run: string): string | null {
  return (openDb(true).prepare("SELECT version FROM runs WHERE key=?").get(run) as any)?.version ?? null;
}

/**
 * 取一批指标的逐步历史。
 * 返回的数组与 steps 对齐，并且已经按 asof 截断 —— 只包含该时刻之前完成的步。
 */
export function getSeries(
  run: string,
  tags: string[],
  asof: number | null,
): { steps: number[]; walls: number[]; series: Record<string, (number | null)[]> } {
  const d = openDb(true);
  const stepRows = getSteps(run, asof);
  const steps = stepRows.map((r) => r.step);
  const walls = stepRows.map((r) => r.wall);
  const out: Record<string, (number | null)[]> = {};
  if (!tags.length) return { steps, walls, series: out };

  const get = d.prepare("SELECT n,v FROM series WHERE run=? AND tag=?");
  for (const tag of tags) {
    const row = get.get(run, tag) as any;
    const arr = blobToFloats(row?.v ?? null);
    out[tag] = steps.map((s) => {
      const i = s - 1;
      if (i < 0 || i >= arr.length) return null;
      const v = arr[i];
      return Number.isNaN(v) ? null : v;
    });
  }
  return { steps, walls, series: out };
}

export function getAxisInfo(run: string): { run_start: number; version: string | null } {
  return { run_start: readAxis(run)?.run_start ?? 0, version: getRunVersion(run) };
}

export function getNotices(asof: number | null): any[] {
  const d = openDb(true);
  return (asof == null
    ? d.prepare("SELECT id,t,run,text FROM notices ORDER BY t DESC").all()
    : d.prepare("SELECT id,t,run,text FROM notices WHERE t<=? ORDER BY t DESC").all(asof)) as any[];
}

/** 离线基准：某个 (run, step) 的成绩只有在对应训练步已完成时才应该出现。 */
export function getBenchmarks(asof: number | null): any[] {
  const d = openDb(true);
  // 按 ord 排，保持站点返回的顺序（deepswe / inhouse-coding / automation），不是字母序
  const rows = d.prepare("SELECT bkey,title,note,format,run,step,value FROM benchmarks ORDER BY ord").all() as any[];
  const visible = new Set<string>();
  for (const run of ["pro", "flash"]) for (const r of getSteps(run, asof)) visible.add(`${run}|${r.step}`);
  const byKey = new Map<string, any>();
  for (const r of rows) {
    if (!visible.has(`${r.run}|${r.step}`)) continue;
    let b = byKey.get(r.bkey);
    if (!b) {
      b = { key: r.bkey, title: r.title, note: r.note, format: r.format, results: {} };
      byKey.set(r.bkey, b);
    }
    (b.results[r.run] ??= {})[String(r.step)] = r.value;
  }
  return [...byKey.values()];
}

export function getTimelineRow(run: string, sid: number): any {
  return openDb(true).prepare("SELECT * FROM timeline WHERE sync_id=? AND run=?").get(sid, run);
}

/**
 * 回放用：captured <= asof 的最后一行完整状态。
 * 必须连 totals 一起取回来 —— 累计 token、累计样本这些量在回放里也得是那个时刻的值，
 * 拿最新 status 兜底会显示成"现在"的数字。
 */
export function getTimelineAt(run: string, asof: number | null): any {
  const d = openDb(true);
  return asof == null
    ? d.prepare(
        `SELECT t.*, s.captured FROM timeline t JOIN syncs s ON s.sid=t.sync_id
         WHERE t.run=? ORDER BY s.captured DESC LIMIT 1`,
      ).get(run)
    : d.prepare(
        `SELECT t.*, s.captured FROM timeline t JOIN syncs s ON s.sid=t.sync_id
         WHERE t.run=? AND s.captured<=? ORDER BY s.captured DESC LIMIT 1`,
      ).get(run, asof);
}

export function getLiveRow(run: string, sid: number): any {
  return openDb(true).prepare("SELECT * FROM live WHERE sync_id=? AND run=?").get(sid, run);
}

/**
 * 回放用：captured <= asof 的最后一条采样器留档。
 *
 * 不能用"最新那条"兜底 —— 那会把未来的数据塞进过去的切面。这里严格按
 * captured 往回找，找不到就返回 null（早期同步点可能没留采样器数据）。
 */
export function getLiveBefore(run: string, asof: number | null): any {
  const d = openDb(true);
  return asof == null
    ? d.prepare("SELECT l.*, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? ORDER BY s.captured DESC LIMIT 1").get(run)
    : d.prepare("SELECT l.*, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? AND s.captured<=? ORDER BY s.captured DESC LIMIT 1").get(run, asof);
}

/**
 * 回放用：某个切面之前留下的采样器滚动明细，按时间拼起来。
 *
 * 每条明细只在它所属的那次同步里存了一份（sync.ts 按上一条 log_time 去过重），
 * 所以这里把 asof 之前所有留档的 entries 合起来、按 t 去重排序。
 * 老仓库里没有 entries（这个字段是后加的），返回空数组，调用方再退回用
 * 每次同步的 latest 拼一份粗粒度报告。
 */
export function getLiveEntriesBefore(run: string, asof: number | null, limit = 60): any[] {
  const d = openDb(true);
  const rows = (asof == null
    ? d.prepare("SELECT l.entries, l.t, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? AND l.entries IS NOT NULL ORDER BY s.captured DESC LIMIT 40").all(run)
    : d.prepare("SELECT l.entries, l.t, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? AND l.entries IS NOT NULL AND s.captured<=? ORDER BY s.captured DESC LIMIT 40").all(run, asof)) as any[];
  const byT = new Map<number, any>();
  for (const r of rows) {
    let list: any[] = [];
    try { list = JSON.parse(r.entries) ?? []; } catch { list = []; }
    for (const e of list) if (e && typeof e.t === "number") byT.set(e.t, e);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t).slice(-limit);
}

/** 粗粒度兜底：把 asof 之前每次同步记下的 latest 当作一条采样器报告（同一个 t 只留一条）。 */
export function getLiveLatestHistory(run: string, asof: number | null, limit = 60): any[] {
  const d = openDb(true);
  const rows = (asof == null
    ? d.prepare("SELECT l.json, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? ORDER BY s.captured DESC LIMIT ?").all(run, limit)
    : d.prepare("SELECT l.json, s.captured FROM live l JOIN syncs s ON s.sid=l.sync_id WHERE l.run=? AND s.captured<=? ORDER BY s.captured DESC LIMIT ?").all(run, asof, limit)) as any[];
  const byT = new Map<number, any>();
  for (const r of rows) {
    try {
      const o = JSON.parse(r.json);
      if (o && typeof o.t === "number") byT.set(o.t, o);
    } catch { /* 忽略坏行 */ }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * 回放滑杆用的完整状态时间线。
 * 字段形状和 JSON 仓库里的 timeline.jsonl 保持一致（外加 sid/source），
 * 这样离线副本和在线服务两条路径返回的东西可以直接互换比较。
 */
export function getTimelineAll(run: string): any[] {
  const rows = openDb(true).prepare(
    `SELECT t.*, s.sid AS sid, s.captured AS captured, s.source AS source
     FROM timeline t JOIN syncs s ON s.sid=t.sync_id WHERE t.run=? ORDER BY s.captured`,
  ).all(run) as any[];
  return rows.map((r) => ({ ...r, totals: r.totals ? JSON.parse(r.totals) : null }));
}

export function getAssets(): any[] {
  return openDb(true).prepare("SELECT path,sha256,bytes,fetched FROM assets ORDER BY path").all() as any[];
}

export function putAssets(rows: { path: string; sha256: string; bytes: number; fetched: number }[]): void {
  const put = openDb().prepare(
    "INSERT INTO assets(path,sha256,bytes,fetched) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256, bytes=excluded.bytes, fetched=excluded.fetched",
  );
  for (const r of rows) put.run(r.path, r.sha256, r.bytes, r.fetched);
}

/** 某时刻的累计成本。站点口径：成本 = 费率 ×（now − run.start），与重启无关。 */
export function costAt(rate: number | null, start: number | null, at: number): number | null {
  if (rate == null || start == null) return null;
  return rate * Math.max(0, at - start);
}
