/**
 * 导出一份可以脱离服务端的离线副本。
 *
 *   bun src/export.ts
 *
 * 产出两个文件：
 *   site/data/bundle.js    把仓库里的数据压成 window.__TELEMETRY_BUNDLE__，约 1.5 MB
 *   site/offline.html      index.html 加一行 <script src="data/bundle.js">
 *
 * 之后直接双击 site/offline.html 就能看，不需要起服务、不联网。
 * 原理是 telemetry.js 本来就拦了 api/* 的请求，有 bundle 就地切片返回，回放照样能用。
 *
 * 注意：离线副本是导出那一刻的快照，不会自己更新。数据变了要重新导出。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
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
import { readAxis, readBenchmarks, readEvents, readLiveLog, readMeta, readNotices, readSeries, readStatus, readSyncs, readTags, readTimeline } from "./store";
import { readResolvedItems, readRegistry } from "./sources";
import { getTagList } from "./db";
import { writeText } from "./util";

function main(): void {
  const meta = readMeta();
  if (!meta) {
    console.error("repo is empty; run sync.ts --bootstrap first");
    process.exit(1);
  }

  // 站点配置去掉 updated_at，免得每次导出都产生无意义 diff
  const config: any = { ...meta };
  delete config.schema_version;

  const syncs = readSyncs();

  const runs: Record<string, any> = {};
  for (const r of meta.runs ?? []) {
    const axis = readAxis(r.key);
    const tags = readTags(r.key);
    const events = readEvents(r.key);

    /* 步列表要以 axis 为准，不能拿事件流行数去推：重跑过的步在事件流里有两行，
       直接展开会让那一步在明细表里出现两次，步数也会虚高。 */
    const lastEvent = new Map<number, (typeof events)[number]>();
    for (const e of events) if (e.kind === "step" && e.step != null) lastEvent.set(e.step, e);
    const steps = (axis?.steps ?? []).map((s, i) => {
      const e = lastEvent.get(s);
      return {
        step: s,
        t: e?.t ?? null,
        wall: axis!.walls[i] ?? null,
        value: e?.value ?? null,
        delta: e?.delta ?? null,
        tokens: e?.tokens ?? null,
        redo: e?.redo ?? false,
      };
    });

    // 指标名只保留真的有数据的那些，减少体积。
    // tagFirstSeen 与 tagList 一一对应（同一个排序），离线回放要靠它过滤"那一刻已有的指标"。
    const life = tags?.tags ?? {};
    const tagList = getTagList(r.key, null);

    // 时间线补上 sid/source/sync_id/run，和在线服务的 /api/telemetry/timeline 保持同一形状
    const timeline = readTimeline(r.key).map((row) => {
      const i = syncs.findIndex((s) => s.captured === row.captured);
      const sid = i >= 0 ? i + 1 : null;
      return { ...row, sync_id: sid, run: r.key, sid, source: row.source ?? (i >= 0 ? syncs[i].source : null) };
    });

    runs[r.key] = {
      steps,
      events,
      axis: axis ? { steps: axis.steps, walls: axis.walls, run_start: axis.run_start } : { steps: [], walls: [], run_start: 0 },
      version: tags?.version ?? null,
      /* 版本切换史：离线版的 /api/correlate 要拿它标出"这一步前后换了版本"，
         只带当前版本号不够。 */
      versions: tags?.versions ?? [],
      tags: tagList,
      tagFirstSeen: tagList.map((t) => life[t]?.first_seen ?? 0),
      series: readSeries(r.key),
      timeline,
      live: readLiveLog(r.key),
      status: readStatus(r.key),
    };
  }

  /* Metric explainers and insights are hand-written documents; they are packed
     into the bundle too so "click a chart, read the explainer" keeps working
     offline. They are documents, not data, so `asof` does not apply to them.
     Both locales ship in the bundle; the page picks one at runtime.

     Insights store their sources as refs, so they are expanded here — an
     offline copy cannot call back into the server. */
  const readContent = (locale: Locale) => {
    const useEn = locale === "en" && existsSync(METRICS_EN_JSON) && existsSync(INSIGHTS_EN_JSON);
    const metricsFile = useEn ? METRICS_EN_JSON : METRICS_JSON;
    const insightsFile = useEn ? INSIGHTS_EN_JSON : INSIGHTS_JSON;
    const sourcesFile = useEn && existsSync(SOURCES_EN_JSON) ? SOURCES_EN_JSON : SOURCES_JSON;
    const resolved: Locale = useEn ? "en" : "zh-CN";
    const read = (f: string) => {
      if (!existsSync(f)) return null;
      try {
        return JSON.parse(readFileSync(f, "utf8"));
      } catch {
        console.warn(`  ! failed to parse ${f}; this part will be missing from the offline copy`);
        return null;
      }
    };
    const jm = read(metricsFile);
    const ji = read(insightsFile);
    const jsrc = read(sourcesFile);
    return {
      lang: resolved,
      metrics: jm?.items ?? [],
      metrics_meta: jm
        ? { schema_version: jm.schema_version, updated_at: jm.updated_at, groups: jm.groups ?? [] }
        : null,
      insights: ji ? readResolvedItems(insightsFile, "insights.json", resolved, sourcesFile).items : [],
      insights_window: ji?.window ?? null,
      insights_updated_at: ji?.updated_at ?? null,
      /* The provenance tab shows the registry itself. */
      sources: readRegistry(sourcesFile).all,
      sources_note: jsrc?.note ?? null,
      sources_gaps: jsrc?.gaps ?? [],
      notices_zh: existsSync(NOTICES_ZH_JSON)
        ? JSON.parse(readFileSync(NOTICES_ZH_JSON, "utf8")).items ?? {}
        : {},
    };
  };
  const content = { en: readContent("en"), "zh-CN": readContent("zh-CN") };

  /* 界面字典（site/i18n/en.json）也打进离线副本：file:// 下 fetch('i18n/en.json')
     会被浏览器拦掉，i18n.js 会优先读 window.__TELEMETRY_BUNDLE__.i18n，离线打开才是英文。 */
  const uiI18n = (() => {
    const f = join(SITE, "i18n", "en.json");
    if (!existsSync(f)) return {};
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      console.warn("  ! failed to parse site/i18n/en.json; the offline UI will fall back to Chinese");
      return {};
    }
  })();

  const bundle = {
    generated_at: Date.now() / 1000,
    source: "data/store",
    config,
    notices: readNotices(),
    benchmarks: readBenchmarks(),
    syncs: syncs.map((s, i) => ({ sid: i + 1, captured: s.captured, server_now: s.server_now ?? null, source: s.source })),
    runs,
    content,
    i18n: uiI18n,
  };

  const js = "/* Offline bundle generated by src/export.ts — do not edit by hand. */\n" +
    "window.__TELEMETRY_BUNDLE__ = " + JSON.stringify(bundle) + ";\n";
  const bundlePath = join(SITE, "data", "bundle.js");
  writeText(bundlePath, js);

  // offline.html 就是在 index.html 里多插一行数据脚本
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const marker = '<script src="js/format.js"></script>';
  if (!html.includes(marker)) {
    console.error("index.html structure changed; no insertion point found");
    process.exit(1);
  }
  const offline = html.replace(marker, '<script src="data/bundle.js"></script>\n' + marker);
  writeText(join(SITE, "offline.html"), offline);

  const kb = (n: number) => (n / 1024).toFixed(0) + " KB";
  console.log(`Offline copy generated`);
  console.log(`  ${bundlePath}  ${kb(Buffer.byteLength(js))}`);
  console.log(`  ${join(SITE, "offline.html")}`);
  console.log(`  data as of ${new Date(bundle.generated_at * 1000).toISOString()}`);
  console.log(`  content: ${content["zh-CN"].metrics.length} ZH + ${content.en.metrics.length} EN metric explainers`);
  console.log(`  Open offline.html directly; no server or network needed.`);
}

main();
