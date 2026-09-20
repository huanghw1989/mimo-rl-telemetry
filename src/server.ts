/**
 * 本地全栈服务：一台机器上同时提供遥测页面和接口。
 *
 *   bun src/server.ts [--port 8787] [--live]
 *
 * 两类模式：
 *
 *   存档模式（默认，URL 不带 asof）
 *     所有接口都从仓库里的 JSON / SQLite 重建，一行网络请求都不发。页面因此不会被
 *     上游的墙钟拖着走：页头时钟和累计成本停在最后一次同步的时刻（服务端会带上
 *     from_archive，前端据此把读数冻住并说明数据采集自什么时间）。要看更新的数据就
 *     bun run sync；要"页面自己跟着上游动"就加 --live。
 *
 *   转发模式（--live）
 *     /api/runs /api/status /api/live /api/notices /api/benchmarks 这五个小接口
 *     直接转发原站 —— 一共约 25 KB，换来的是时钟、阶段、采样器日志和线上完全一致。
 *     /api/tags 和 /api/series 这两个大接口（约 500 KB）始终走本地仓库，不碰网络。
 *     转发失败（断网、原站挂了）就退回用仓库里的数据重建，页面不会白屏。
 *
 *   回放模式（带 asof=<epoch 秒>，两种模式都一样）
 *     所有接口都从本地仓库重建，返回"那一刻之前完成的步"组成的切面。
 *     不联网，所以关掉网络也能翻历史。
 *
 * 默认不转发上游，是因为这个仓库的权威副本是 data/store/：图表（/api/series）本来就
 * 只从仓库出，只让页头那几个数字跟着上游的墙钟跳，页面会自相矛盾 —— 图停在 11:51，
 * 成本却按"费率 × 现在"一直涨。上游跑着的时候想镜像它，再加 --live。
 *
 * 为什么能按 asof 截断：序列里的数值只在对应训练步完成时才出现，且一旦出现就不再变
 * （docs/02 有 15 份快照的验证）。所以"某时刻的看板"= 把每个指标数组截到那个时刻为止。
 */
import { existsSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import {
  API_BASE,
  DB_PATH,
  DEFAULT_LOCALE,
  INSIGHTS_EN_JSON,
  INSIGHTS_JSON,
  METRICS_EN_JSON,
  METRICS_JSON,
  NOTICES_ZH_JSON,
  SITE,
  SOURCES_EN_JSON,
  SOURCES_JSON,
  type Locale,
} from "./paths";
import { checkpoint, closeDb, openDb, rebuildAll, costAt, getAssets, getAxisInfo, getBenchmarks, getLiveBefore, getLiveEntriesBefore, getLiveLatestHistory, getMeta, getNotices, getRunRow, getRestarts, getSeries, getSteps, getTagList, getTimelineAll, getTimelineAt, listSyncs, maxVisibleStep, pickSync } from "./db";
import { readMeta, readEvents, readStatus, readTags } from "./store";
import { readRegistry, readResolvedItems } from "./sources";

const argv = process.argv.slice(2);
const PORT = Number(argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : 8787);
/* 默认不转发上游（存档模式）；--live 才镜像上游那几个小接口。
   --offline 是旧名字，等价于默认行为，仍然接受，免得老的启动脚本报错。 */
const LIVE = argv.includes("--live");
const OFFLINE = !LIVE;
const UA = "mimo-rl-telemetry/1.0";

/* A fresh clone ships data/store/ but not the derived SQLite index (it is
   gitignored). Build it on first run instead of making the user discover
   `sync --reindex`. */
if (!existsSync(DB_PATH)) {
  if (!readMeta()) {
    console.error(`repo is empty: neither the index ${DB_PATH} nor data/store/meta.json exists.`);
    process.exit(1);
  }
  console.log(`index missing; building it from data/store/ first: ${DB_PATH}`);
  openDb().transaction(() => rebuildAll())();
  checkpoint();
  closeDb();
}
const db = openDb(true);

/* ------------------------------------------------------------------ 转发 */

/** 只有 --live 才真去问上游；默认（存档模式）一律返回 null，调用方随即从仓库重建。 */
async function proxy(path: string, params: Record<string, string>): Promise<any | null> {
  if (!LIVE) return null;
  try {
    const u = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- 由仓库重建 status */

/** 状态时间线里 captured <= asof 的最后一行（含 totals）。 */
function timelineAt(run: string, asof: number | null): any {
  return getTimelineAt(run, asof) ?? null;
}

function deriveStatus(run: string, asof: number | null): any {
  const meta = getMeta();
  const cfg = (meta.runs ?? []).find((r: any) => r.key === run) ?? { key: run, label: run };
  const row = getRunRow(run);
  const steps = getSteps(run, asof);
  const events = readEvents(run).filter((e) => asof == null || e.t <= asof);
  const stepEvents = events.filter((e) => e.kind === "step");

  const tl = timelineAt(run, asof);
  const stored = readStatus(run);

  /* 走到这里说明这份数字是从仓库重建的（没连上游，或转发失败）——它是一份存档，
     "现在"不该是本机的 Date.now()，而是最后一次同步时上游报出的时刻（tl.now），
     拿不到才退回同步时间。按 Date.now() 算等于假设它一直在跑：成本会按费率继续
     往上跳（pro 的费率 5.71/s，每小时多算约 $2 万），耗时也继续走，页头那个
     "实时"时钟同样是假的。 */
  const archiveNow = tl?.now ?? tl?.captured ?? stored?.clock?.now ?? null;
  const now = asof ?? archiveNow ?? Date.now() / 1000;

  const lastStep = steps.length ? steps[steps.length - 1] : null;
  const lastWall = lastStep ? (lastStep.wall ?? lastStep.t) : null;
  const since = lastWall != null ? Math.max(0, now - lastWall) : (tl?.since ?? null);
  const expected = tl?.expected ?? stored?.step?.expected ?? null;
  const progress = tl?.progress ?? (since != null && expected ? Math.min(1, since / expected) : null);
  const rate = tl?.rate ?? row?.rate ?? null;
  const start = tl?.start ?? row?.start ?? null;

  const tag = meta.headline_tag ?? stored?.headline?.tag ?? null;
  const first = stepEvents[0] ?? null;
  const last = stepEvents[stepEvents.length - 1] ?? null;
  const prev = stepEvents[stepEvents.length - 2] ?? null;

  const totals = tl?.totals ? JSON.parse(tl.totals) : { ...(stored?.totals ?? {}) };
  totals.restarts = events.filter((e) => e.kind === "restart").length;

  /* 成本要分"还在跑"和"已结束"两种算法，与离线包 bundleStatus 口径一致 ——
     同一次同步的同一个切面，两条路径必须给出同一个数：
       · 还在跑：费率 ×（now − start），这是站点自己的口径；
       · 已结束：用留档时的累计值，并带上留档的结束时间。继续按费率乘下去等于
         假设它一直在跑，成本会虚高，已经停了的 run 也不该显示 1970 年的停止时刻。 */
  const ended = !!(tl && tl.mode === "ended");

  return {
    run: {
      key: run,
      label: cfg.label,
      start,
      // 回放切片里的 run 依然是活的，mode 保持原样；前端靠 Telemetry.replay() 冻结时钟
      end: ended ? (tl?.captured ?? null) : null,
      mode: tl?.mode ?? row?.mode ?? "live",
    },
    /* 这份 status 源自仓库存档（不是上游实时值）。前端据此把页头时钟和总成本停在
       数据时刻，并说明数据采集自什么时间 —— 存档不该看着像还在跑。 */
    from_archive: true,
    cost: { rate_per_s: rate, so_far: ended && tl?.cost != null ? tl.cost : costAt(rate, start, now) },
    clock: { now },
    version: tl?.version ?? row?.version ?? null,
    step: {
      last: lastStep ? lastStep.step : (tl?.step ?? null),
      last_wall: lastWall,
      since,
      expected,
      progress,
      phase: tl?.phase ?? "training",
      gen_frac: tl?.gen_frac ?? null,
      restarted_at: tl?.restarted_at ?? null,
    },
    totals,
    events,
    headline: {
      tag,
      last: last?.value ?? null,
      prev: prev?.value ?? null,
      first: first?.value ?? null,
      first_step: first?.step ?? null,
    },
  };
}

/* ------------------------------------------------------ 相关性分析（共享内核） */

/**
 * 相关性分析的内核在 site/js/correlate.js —— 服务端和浏览器用的是同一份实现，
 * 所以在线调 /api/correlate 和离线（file:// + bundle.js）就地算出来的数字完全一致。
 * 那个文件是 UMD，import 进来的副作用就是把实现挂到 globalThis.TelemetryCorrelate。
 */
async function correlateKernel(): Promise<any> {
  if (!correlateMod) {
    await import(join(SITE, "js", "correlate.js"));
    correlateMod = (globalThis as any).TelemetryCorrelate ?? null;
    if (!correlateMod) throw new Error("site/js/correlate.js did not attach globalThis.TelemetryCorrelate");
  }
  return correlateMod;
}
let correlateMod: any = null;

/** 全指标的逐步序列是这个接口里最贵的一步，仓库没动就不再读第二遍。 */
let seriesCache: { key: string; steps: number[]; walls: number[]; series: Record<string, (number | null)[]> } | null = null;

function allSeries(run: string, asof: number | null) {
  const key = `${run}|${asof ?? "live"}|${listSyncs().length}`;
  if (seriesCache && seriesCache.key === key) return seriesCache;
  const tags = getTagList(run, asof);
  const d = getSeries(run, tags, asof);
  seriesCache = { key, steps: d.steps, walls: d.walls, series: d.series };
  return seriesCache;
}

/** 某个时间戳落在第几步之后：返回墙钟 <= t 的最后一个步号（没有就返回 null）。 */
function stepAfter(walls: number[], t: number): number | null {
  let out: number | null = null;
  for (let i = 0; i < walls.length; i++) if (walls[i] <= t) out = i + 1;
  return out;
}

async function correlatePayload(url: URL, run: string, asof: number | null): Promise<any> {
  const K = await correlateKernel();
  const data = allSeries(run, asof);
  const steps = data.steps;
  const walls = data.walls;
  const stepRaw = url.searchParams.get("step");
  const step = stepRaw ? Number(stepRaw) : null;

  /* 锚点：可以是某个训练指标（metric=<tag>），也可以是某个离线评测榜（bench=<key>）。
     评测榜在序列里没有对应 tag，得单独取。 */
  const metric = url.searchParams.get("metric");
  const benchKey = url.searchParams.get("bench");
  let anchor: any = null;
  let anchorLabel: string | null = null;
  if (metric && data.series[metric]) {
    anchor = { kind: "metric", id: metric, label: metric, values: data.series[metric] };
  } else if (benchKey) {
    const bench = getBenchmarks(asof).find((b: any) => b.key === benchKey);
    if (bench) {
      const res = bench.results?.[run] ?? {};
      anchorLabel = bench.title || bench.key;
      anchor = {
        kind: "bench", id: bench.key, label: anchorLabel,
        values: steps.map((s) => (res[String(s)] == null ? null : Number(res[String(s)]))),
      };
    }
  }

  const out = K.analyze({
    series: data.series,
    steps,
    step,
    anchor,
    /* The kernel writes its caveat sentences itself, so it needs the language. */
    lang: url.searchParams.get("lang") === "zh-CN" ? "zh-CN" : DEFAULT_LOCALE,
    opts: {
      top: Math.min(40, Math.max(3, Number(url.searchParams.get("top")) || 12)),
      seriesOnly: true,
    },
  });

  /* 锚点落定时段：上一步完成之后、这一步完成之前。这段时间里发生的事情
     （重启、版本切换）才是这一步的"原因候选"。 */
  const index = out.index;
  const to = walls[index] ?? null;
  const from = index > 0 ? walls[index - 1] : null;
  const inWindow = (t: number) => to != null && t <= to && (from == null || t >= from);

  /* 公告要放宽到"下一步完成之前"：官方是事后补发的。
     实例：pro 第 17 步的重启公告（GPU OOM / 专家负载不均衡）发布于第 17 步完成之后、
     第 18 步完成之前，按严格时段根本看不到 —— 而它正是那一步唯一的原因说明。
     这一步恰好是切面里最后一步时没有"下一步"可放宽，就放到切面当前时刻为止
     （回放时是 asof，实时是服务器时钟）。
     所以每条公告带一个 after_step：落在本步之后的会标成「随后发布」。 */
  const noticeTo = walls[index + 1] ?? asof ?? (readStatus(run)?.clock?.now ?? to) ?? to;
  const inNoticeWindow = (t: number) => noticeTo != null && t <= noticeTo && (from == null || t >= from);

  /* 事件流是滚动保留的：仓库里 flash 的事件从第 8 步才有。早期步查不到重启，
     只能说明"没留档"，不能说"没重启" —— 这个区别很容易被读成结论。 */
  const evs = readEvents(run);
  const evFrom = evs.length ? Math.min.apply(null, evs.map((e: any) => e.t)) : null;
  if (evFrom != null && to != null && to < evFrom) {
    out.caveats.push(
      `this step completed at (${new Date(to * 1000).toISOString().slice(0, 16)}Z), earlier than the first record in the local event stream, ` +
      "OOMs / restarts in this period were not logged, so \"no restarts in the window\" only means none could be found, not that none happened.",
    );
  }

  const noticesZh: Record<string, any> = readJsonFile(NOTICES_ZH_JSON)?.items ?? {};
  const notices = getNotices(asof)
    .filter((n: any) => inNoticeWindow(n.t))
    .map((n: any) => ({
      id: n.id, t: n.t, run: n.run, text: n.text,
      text_zh: noticesZh[n.id]?.zh ?? null,
      after_step: stepAfter(walls, n.t),
      /* 发布时间晚于这一步完成的时刻 → 是事后补发，UI 会标「随后发布」。
         after_step 只能说明"发布时已经完成到第几步"，不等于晚于本步。 */
      late: to != null && n.t > to,
    }));

  const restarts = getRestarts(run, asof)
    .filter(inWindow)
    .map((t) => ({ t, after_step: stepAfter(walls, t) }));

  /* 注意这不是"训练配置版本"，是**看板标签集快照版本**：版本串 3-5513.<步>.<x>.<y> 的第二段
     就等于当时已完成的步号（pro 9 条快照逐条核对全中），`tags` 是那一刻的指标名条数。
     它变化说明看板暴露的指标清单变了（新增/减少了指标名），是遥测口径的变化 —— 对"这一步为什么跳"
     仍然是有用的上下文（清单变了，新老指标的跨步比较要小心），但**不能读成训练改了配置**。 */
  const tagsetVersions = (readTags(run)?.versions ?? [])
    .filter((v) => (asof == null || v.at <= asof) && inWindow(v.at))
    .map((v) => ({ version: v.version, at: v.at, tags: v.n, after_step: stepAfter(walls, v.at) }));

  /* 相邻几步的抬头指标与 token 量：上一步/下一步是不是也在动，用来判断
     "这一步的异常是孤立的还是连着几步"。 */
  const rows = getSteps(run, asof);
  const neighbors = rows
    .filter((r: any) => Math.abs(r.step - (out.step ?? 0)) <= 2)
    .map((r: any) => ({ step: r.step, t: r.t, wall: r.wall, headline: r.value, delta: r.delta, tokens: r.tokens, redo: !!r.redo }));

  return {
    run, step: out.step, steps, walls,
    anchor: out.anchor ? Object.assign({}, out.anchor, { label: anchorLabel ?? out.anchor.label }) : null,
    movers: out.movers, corr: out.corr, counts: out.counts, caveats: out.caveats,
    context: {
      window: { from, to },
      restarts, tagset_versions: tagsetVersions, notices, neighbors,
      restarts_total: readStatus(run)?.totals?.restarts ?? null,
    },
    generated_at: Date.now() / 1000,
  };
}

/* ------------------------------------------------- 指标解读与洞察（人写的） */

/**
 * content/ 下的两份内容：metrics.json（逐指标解读）和 insights.json（数据洞察）。
 * 都是人写的，跟着仓库走版本管理，同步流程不动它们。
 * 内容不进 SQLite —— 它是文档不是数据，回放切面对它没有意义，所以忽略 asof。
 */
function readJsonFile(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function contentPayload(locale: Locale = DEFAULT_LOCALE): any {
  /* English files are generated by src/translate_content.ts. Until they exist
     (fresh clone, no API key) we fall back to the Chinese originals so the
     dashboard still renders. */
  const useEn = locale === "en" && existsSync(METRICS_EN_JSON) && existsSync(INSIGHTS_EN_JSON);
  const metricsFile = useEn ? METRICS_EN_JSON : METRICS_JSON;
  const insightsFile = useEn ? INSIGHTS_EN_JSON : INSIGHTS_JSON;
  const sourcesFile = useEn && existsSync(SOURCES_EN_JSON) ? SOURCES_EN_JSON : SOURCES_JSON;
  const resolvedLocale: Locale = useEn ? "en" : "zh-CN";

  const metrics = readJsonFile(metricsFile);
  /* metrics.*.json is a build artifact with sources already expanded;
     insights*.json only stores refs, so they are expanded here
     (readResolvedItems is idempotent for already-expanded entries). */
  const insights = readResolvedItems(insightsFile, "insights.json", resolvedLocale, sourcesFile);
  if (insights.problems.length) insights.problems.slice(0, 5).forEach((p) => console.warn("  ! " + p));
  const reg = readRegistry(sourcesFile);
  return {
    lang: resolvedLocale,
    metrics: metrics?.items ?? [],
    metrics_meta: metrics
      ? { schema_version: metrics.schema_version, updated_at: metrics.updated_at, groups: metrics.groups ?? [] }
      : null,
    insights: insights.items,
    insights_window: readJsonFile(insightsFile)?.window ?? null,
    insights_updated_at: readJsonFile(insightsFile)?.updated_at ?? null,
    /* The provenance tab shows the registry itself, including material not yet cited. */
    sources: reg.all,
    sources_note: readJsonFile(sourcesFile)?.note ?? null,
    sources_gaps: readJsonFile(sourcesFile)?.gaps ?? [],
    /* Chinese translations of the upstream notices, keyed by notice id; the page
       uses them to show English notices in Chinese. Always the same file. */
    notices_zh: readJsonFile(NOTICES_ZH_JSON)?.items ?? {},
  };
}

/* -------------------------------------------------------------- 接口实现 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleApi(url: URL): Promise<Response> {
  const p = url.pathname.replace(/^\/api/, "");
  const run = url.searchParams.get("run") ?? "";
  const raw = url.searchParams.get("asof");
  const asof = raw && raw !== "" ? Number(raw) : null;
  const replay = asof != null && Number.isFinite(asof);

  try {
    switch (p) {
      case "/runs": {
        if (!replay) {
          const up = await proxy("/runs", {});
          if (up) return json(up);
        }
        const meta = getMeta();
        return json(meta);
      }

      case "/status": {
        if (!run) return json({ error: "run required" }, 400);
        if (!replay) {
          const up = await proxy("/status", { run });
          if (up) return json(up);
        }
        return json(deriveStatus(run, replay ? asof : null));
      }

      case "/live": {
        if (!run) return json({ error: "run required" }, 400);
        if (!replay) {
          const up = await proxy("/live", { run });
          if (up) return json(up);
        }
        /* 回放（或转发失败）时从本地留档重建。关键是**只能往回取**：
           以前这里拿不到当前 sid 的采样器行就用"最新那条"兜底，
           于是早期切面会显示未来的采样器数据。现在按 captured <= asof 严格回找。
           滚动明细：优先用逐次留档的 entries；老仓库没有 entries，
           退回用每次同步的 latest 拼一份粗粒度报告（粒度为同步间隔，不是 30 秒）。 */
        const row = getLiveBefore(run, replay ? asof : null);
        const latest = row?.json ? JSON.parse(row.json) : null;
        let entries = getLiveEntriesBefore(run, replay ? asof : null, 60);
        let entriesApprox = false;
        if (!entries.length) {
          /* 老仓库里没有 30 秒级的明细，退回同步粒度 —— 明确标出来，
             免得把"每 20 分钟一条"当成"每 30 秒一条"。 */
          entries = getLiveLatestHistory(run, replay ? asof : null, 60);
          entriesApprox = entries.length > 1;
        }
        if (!latest && !entries.length) return json({ log_time: null, latest: null, entries: [], entries_approx: false });
        const last = entries.length ? entries[entries.length - 1] : null;
        return json({
          log_time: latest?.t ?? last?.t ?? row?.t ?? null,
          latest: latest ?? last ?? null,
          entries,
          entries_approx: entriesApprox,
        });
      }

      case "/notices": {
        if (!replay) {
          const up = await proxy("/notices", {});
          if (up) return json(up);
        }
        return json({ notices: getNotices(replay ? asof : null) });
      }

      case "/benchmarks": {
        if (!replay) {
          const up = await proxy("/benchmarks", {});
          if (up) return json(up);
        }
        return json({ benchmarks: getBenchmarks(replay ? asof : null) });
      }

      case "/tags": {
        if (!run) return json({ error: "run required" }, 400);
        const tags = getTagList(run, replay ? asof : null);
        // 回显前端传来的版本号：前端拿它当缓存键（version 变了就重取序列）。
        // 统一回显可以避免"实时 status 的版本比仓库新"时序列缓存被反复作废。
        return json({ run, version: url.searchParams.get("v") || getRunRow(run)?.version || "", tags });
      }

      case "/series": {
        if (!run) return json({ error: "run required" }, 400);
        const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
        if (!tags.length) return json({ run, version: "", steps: [], walls: [], run_start: 0, series: {} });
        const axis = getAxisInfo(run);
        const data = getSeries(run, tags, replay ? asof : null);
        return json({
          run,
          version: url.searchParams.get("v") || axis.version || "",
          steps: data.steps,
          walls: data.walls,
          run_start: axis.run_start,
          series: data.series,
        });
      }

      /* ---- 下面是原站没有的接口，专给回放用 ---- */

      case "/content": {
        const lang = url.searchParams.get("lang");
        return json(contentPayload(lang === "zh-CN" ? "zh-CN" : DEFAULT_LOCALE));
      }

      case "/telemetry/timeline": {
        // 回放滑杆的时间轴：同步点 + 每个同步点的状态摘要
        const syncs = listSyncs();
        const meta = getMeta();
        const runs: Record<string, any[]> = {};
        for (const r of meta.runs ?? []) runs[r.key] = getTimelineAll(r.key);
        return json({ syncs, runs, offline: OFFLINE });
      }

      case "/telemetry/summary": {
        // 某个切面的横向摘要，回放面板用
        const meta = getMeta();
        const sid = pickSync(replay ? asof : null);
        const out: any = { asof: replay ? asof : null, sync: sid, runs: {} };
        for (const r of meta.runs ?? []) {
          const s = deriveStatus(r.key, replay ? asof : null);
          out.runs[r.key] = {
            label: s.run.label,
            step: s.step.last,
            headline: s.headline.last,
            headline_tag: s.headline.tag,
            cost: s.cost.so_far,
            rate: s.cost.rate_per_s,
            phase: s.step.phase,
            version: s.version,
            restarts: s.totals.restarts,
            tokens_cum: s.totals.tokens_cum,
            steps_done: maxVisibleStep(r.key, replay ? asof : null),
            steps_total: maxVisibleStep(r.key, null),
          };
        }
        return json(out);
      }

      /* ---- 相关性分析：页面上点某一步的"分析这一步"按钮就打到这儿 ---- */

      case "/correlate": {
        if (!run) return json({ error: "run required" }, 400);
        return json(await correlatePayload(url, run, replay ? asof : null));
      }

      case "/telemetry/store": {
        const meta = getMeta();
        const sizes: Record<string, any> = {};
        for (const r of meta.runs ?? []) {
          sizes[r.key] = {
            tags: getTagList(r.key, null).length,
            steps: maxVisibleStep(r.key, null),
            restarts: getRestarts(r.key, null).length,
          };
        }
        return json({
          syncs: listSyncs().length,
          first_sync: listSyncs()[0]?.captured ?? null,
          last_sync: listSyncs().at(-1)?.captured ?? null,
          runs: sizes,
          assets: getAssets().length,
          offline: OFFLINE,
        });
      }

      default:
        return json({ error: `unknown endpoint ${p}` }, 404);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/* -------------------------------------------------------------- 静态文件 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const full = normalize(join(SITE, rel));
  if (!full.startsWith(normalize(SITE))) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  if (!(await file.exists())) return new Response(`not found: ${pathname}`, { status: 404 });
  /* 本地遥测经常改 js/css，Bun.file 不带校验头，浏览器会拿启发式缓存当新鲜的用，
     结果改了代码刷新还是旧的。这里一律要求回源（文件在本地，代价可以忽略）。 */
  return new Response(file, {
    headers: {
      "content-type": MIME[extname(full)] ?? "application/octet-stream",
      "cache-control": "no-cache, must-revalidate",
    },
  });
}

/* ------------------------------------------------------------------- 启动 */

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(url);
    return serveStatic(url.pathname);
  },
});

console.log(`mimo RL local telemetry  →  http://127.0.0.1:${server.port}/`);
console.log(`  page: ${SITE}`);
console.log(`  data: ${DB_PATH}`);
console.log(LIVE
  ? `  mode: live — /api/runs /status /live /notices /benchmarks are proxied from ${API_BASE}`
  : `  mode: archive — everything is rebuilt from the local repo; the page clock and cost stay at the last sync (pass --live to mirror upstream instead)`);
console.log(`  replay: the \"replay\" button at the top right of the page, or append ?asof=<epoch seconds>`);
