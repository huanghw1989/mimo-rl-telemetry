/*
 * 遥测层（本地新增，原站没有这个文件）。
 *
 * 干四件事：
 *   1. 回放开关 —— 打开以后给所有 api/* 请求挂上 asof=<epoch 秒>，
 *      app.js 一行都不用改就能拿到"某个历史时刻"的数据。
 *   2. 回放面板 —— 时间滑杆 + 切面摘要 + 逐步表格 + 该时刻已发布的公告和成绩。
 *      这是比原站多出来的视图：原站只能看"现在"，这里能看任意一个同步点。
 *   3. 图表联动 —— 勾上以后点任意一张图的某一步，所有图都跳到同一步：
 *      竖线、取值点、读数框和卡片数值列一起跟着走，用来横向对比同一步的各个指标。
 *   4. 离线兜底 —— 如果页面里带了 data/bundle.js（bun run mimo:export 生成），
 *      就不再发请求，全部从内存里的那份数据切片，双击 html 也能打开。
 *
 * app.js 与本文件的接口只有两个：window.Telemetry.replay() 和 Telemetry.bind()。
 */
(function () {
  "use strict";

  var BUNDLE = window.__TELEMETRY_BUNDLE__ || null;
  var origFetch = window.fetch.bind(window);
  var app = null;                       // app.js 通过 bind() 交进来的句柄
  var state = {
    asof: null,                         // 当前切面（epoch 秒）；null = 实时
    slices: [],                         // 可选的切面：每个同步点一个
    index: 0,
    playing: false,
    timer: null,
    expanded: true,     // 明细面板默认整屏展开
    on: false,          // 回放开着没有：导航上那个按钮是 toggle，再点一次回实时
  };

  /* 打开页面时 URL 上就带了 asof，说明是要回放 —— 必须在 app.js 启动前
     就把开关置好，这样它第一次拉数据拿到的就是切片。 */
  (function initAsofFromUrl() {
    var q = new URLSearchParams(location.search).get("asof");
    if (q && isFinite(Number(q))) state.asof = Number(q);
  })();

  // ------------------------------------------------------------------ 取数
  /** 只拦 api/ 下面的请求；页面在根路径下，所以路径形态就是 /api/xxx。 */
  function isApi(url) {
    try { return /(^|\/)api\//.test(new URL(url, location.href).pathname); } catch (e) { return false; }
  }

  /* 切面时间戳必须原样传给服务端。同步点的 captured 是带小数的（例如
     1789871319.416），以前四舍五入成整数再传：小数部分小于 0.5 时结果
     会比 captured 小，服务端 pickSync 就落到**上一个**同步点 —— 每个切面
     都可能显示成前一格的数据，最新一格永远看不到自己。原样传即可。 */
  function asofParam(t) { return String(t); }

  /** 统一的取数入口：挂 asof、走 bundle 或走服务端。 */
  async function api(pathAndQuery) {
    var u = new URL(pathAndQuery, location.href);
    if (state.asof != null) u.searchParams.set("asof", asofParam(state.asof));
    if (BUNDLE) return bundleApi(u);
    var res = await origFetch(u.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + u.pathname);
    var j = await res.json();
    if (j && j.error) throw new Error(j.error);
    if (apiPath(u) === "/runs") j = patchRunsBody(j);
    return j;
  }

  function apiPath(u) { return u.pathname.replace(/^.*\/api/, ""); }

  /* 拦住 app.js 的 fetch，把 asof 补上。 */
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (!isApi(url)) return origFetch(input, init);
    var u = new URL(url, location.href);
    if (state.asof != null) u.searchParams.set("asof", asofParam(state.asof));
    if (BUNDLE) {
      return bundleApi(u).then(function (body) {
        if (apiPath(u) === "/runs") body = patchRunsBody(body);
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }).catch(function (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
      });
    }
    var p = origFetch(u.toString(), init);
    /* 首页固定的图表集合只在 /runs 的原始响应里有；复制一份留着，
       免得自定义看板把 S.cfg.pins 改掉之后再也拿不回原值（切不回「默认」）。 */
    if (apiPath(u) === "/runs") {
      return p.then(function (res) {
        return res.json().then(function (body) {
          return new Response(JSON.stringify(patchRunsBody(body)), {
            status: res.status, statusText: res.statusText,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        });
      });
    }
    return p;
  };

  // ------------------------------------------------ 离线包（没有服务端时用）
  function visibleSteps(run, asof) {
    var R = BUNDLE.runs[run];
    if (!R) return [];
    return asof == null ? R.steps.slice() : R.steps.filter(function (s) { return (s.t != null ? s.t : s.wall) <= asof; });
  }

  /* 取 list 里 captured <= asof 的最后一条。asof 为空（实时）取最后一条。
     回放时如果 asof 早于第一条，返回 null —— 不能拿第一条兜底，那是"未来"的数据。 */
  function lastAtOrBefore(list, asof) {
    if (!list || !list.length) return null;
    if (asof == null) return list[list.length - 1];
    var hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].captured <= asof) hit = list[i];
    return hit;
  }

  /* 离线回放的采样器滚动明细：把 asof 之前各次留档的 entries 拼起来，按 t 去重。 */
  function bundleLiveEntries(run, asof, limit) {
    var R = BUNDLE.runs[run];
    var rows = (R && R.live) || [];
    var byT = {};
    for (var i = 0; i < rows.length; i++) {
      if (asof != null && rows[i].captured > asof) continue;
      var list = rows[i].entries || [];
      for (var j = 0; j < list.length; j++) if (list[j] && typeof list[j].t === "number") byT[list[j].t] = list[j];
    }
    var out = Object.keys(byT).map(function (k) { return byT[k]; }).sort(function (a, b) { return a.t - b.t; });
    if (out.length) return { entries: out.slice(-(limit || 60)), approx: false };
    /* 老仓库没有 entries：退回把每次同步的 latest 当一条粗粒度报告（同一个 t 只留一条，
       run 停了以后每次同步抓到的 latest 是一样的，不去重会刷出一排重复行）。 */
    var fallback = [], seenT = {};
    for (var k = 0; k < rows.length; k++) {
      if (asof != null && rows[k].captured > asof) continue;
      var L = rows[k].latest;
      if (!L || typeof L.t !== "number" || seenT[L.t]) continue;
      seenT[L.t] = 1;
      fallback.push(L);
    }
    fallback.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return { entries: fallback.slice(-(limit || 60)), approx: fallback.length > 1 };
  }

  function bundleStatus(run, asof) {
    var R = BUNDLE.runs[run];
    if (!R) throw new Error(T("离线副本里没有 run：{0}", run));
    var cfg = (BUNDLE.config.runs || []).filter(function (r) { return r.key === run; })[0] || { key: run, label: run };
    var steps = visibleSteps(run, asof);
    var events = R.events.filter(function (e) { return asof == null || e.t <= asof; });
    var tl = lastAtOrBefore(R.timeline, asof);
    var se = events.filter(function (e) { return e.kind === "step"; });
    var now = asof == null ? ((lastAtOrBefore(R.timeline, null) || {}).now || R.axis.run_start) : asof;
    var lastStep = steps.length ? steps[steps.length - 1] : null;
    var lastWall = lastStep ? (lastStep.wall != null ? lastStep.wall : lastStep.t) : null;
    var since = lastWall != null ? Math.max(0, now - lastWall) : null;
    var rate = tl ? tl.rate : null, start = tl ? tl.start : R.axis.run_start;
    var totals = (tl && tl.totals) ? JSON.parse(JSON.stringify(tl.totals)) : {};
    totals.restarts = events.filter(function (e) { return e.kind === "restart"; }).length;
    var first = se[0] || null, last = se[se.length - 1] || null, prev = se[se.length - 2] || null;

    /* 成本要分"还在跑"和"已结束"两种算法，不能一律按 费率 × 时长：
       - 还在跑：上游看板自己就是 rate × (now − start)，所以这里跟着算才能继续跳动；
       - 已结束：必须用留档时的累计值。若也按 rate × 时长算，等于假设它一直在跑，
         会严重虚高（flash 已结束，实测虚高 $322,161，约 9.8%）。
       回放时 tl 取的是 asof 之前最后一条，mode 正确反映"那一刻它结束没有"。 */
    var ended = !!(tl && tl.mode === "ended");
    var costSoFar = ended
      ? (tl.cost != null ? tl.cost : null)
      : (rate != null && start != null ? rate * Math.max(0, now - start) : (tl ? tl.cost : null));

    return {
      run: { key: run, label: cfg.label, start: start, end: ended ? (tl.captured != null ? tl.captured : null) : null, mode: tl ? tl.mode : "live" },
      cost: { rate_per_s: rate, so_far: costSoFar },
      clock: { now: now },
      version: tl ? tl.version : null,
      step: {
        last: lastStep ? lastStep.step : (tl ? tl.step : null), last_wall: lastWall, since: since,
        expected: tl ? tl.expected : null,
        progress: tl && tl.progress != null ? tl.progress : (since != null && tl && tl.expected ? Math.min(1, since / tl.expected) : null),
        phase: tl ? tl.phase : "training", gen_frac: tl ? tl.gen_frac : null, restarted_at: tl ? tl.restarted_at : null,
      },
      totals: totals,
      events: events,
      headline: {
        tag: BUNDLE.config.headline_tag, last: last ? last.value : null, prev: prev ? prev.value : null,
        first: first ? first.value : null, first_step: first ? first.step : null,
      },
    };
  }

  /** 当前页面语言对应的内容语言：在线用 /api/content?lang=，离线取 bundle.content[lang]。 */
  function contentLang() { return (window.I18N && window.I18N.lang === "zh-CN") ? "zh-CN" : "en"; }

  /* 公告正文该显示哪一种语言。官方原文只有英文；content/notices.zh.json 里的中文译文是
     给中文读者看的辅助，**不是所有语言的默认值**。
     这条规则集中在这里，是因为它踩过坑：分析面板曾经写死 `text_zh || text`，
     结果英文界面下浮层里冒出一整句中文（界面文案是英文、正文是中文）。
     中文模式下没有译文就退回英文原文，并让调用方标一个「未翻译」——
     这跟首页公告面板的规则一致。 */
  function noticeText(n) {
    if (contentLang() === "zh-CN") {
      if (n.text_zh) return { text: n.text_zh, original: n.text, untranslated: false };
      return { text: n.text, original: null, untranslated: true };
    }
    return { text: n.text, original: null, untranslated: false };
  }

  function bundleApi(u) {
    var p = u.pathname.replace(/^.*\/api/, "");
    var run = u.searchParams.get("run") || "";
    var q = u.searchParams.get("asof");
    var asof = q ? Number(q) : null;
    if (p === "/runs") { noteSitePins(BUNDLE.config); return Promise.resolve(BUNDLE.config); }
    if (p === "/status") return Promise.resolve(bundleStatus(run, asof));
    if (p === "/live") {
      var L = lastAtOrBefore(BUNDLE.runs[run].live, asof);
      var le = bundleLiveEntries(run, asof, 60);
      return Promise.resolve({
        log_time: (L && L.log_time) || (le.entries.length ? le.entries[le.entries.length - 1].t : null),
        latest: (L && L.latest) || le.entries[le.entries.length - 1] || null,
        entries: le.entries,
        entries_approx: le.approx,
      });
    }
    if (p === "/notices") return Promise.resolve({ notices: BUNDLE.notices.filter(function (n) { return asof == null || n.t <= asof; }) });
    if (p === "/benchmarks") {
      var vis = {};
      ["pro", "flash"].forEach(function (r) {
        vis[r] = {};
        visibleSteps(r, asof).forEach(function (s) { vis[r][s.step] = 1; });
      });
      return Promise.resolve({
        benchmarks: BUNDLE.benchmarks.map(function (b) {
          var out = { key: b.key, title: b.title, note: b.note, format: b.format, results: {} };
          Object.keys(b.results || {}).forEach(function (r) {
            out.results[r] = {};
            Object.keys(b.results[r]).forEach(function (s) { if (vis[r] && vis[r][Number(s)]) out.results[r][s] = b.results[r][s]; });
          });
          return out;
        }).filter(function (b) { return Object.keys(b.results).length; }),
      });
    }
    if (p === "/tags") {
      var R2 = BUNDLE.runs[run];
      if (!R2) return Promise.reject(new Error(T("离线副本里没有 run：{0}", run)));
      // 回放时只返回那一刻已经出现过的指标名。tagFirstSeen 与 tags 一一对应，
      // 是导出时按指标名排序后一起写下来的。
      var names = R2.tags, fs = R2.tagFirstSeen || [];
      if (asof != null && fs.length === names.length) {
        names = names.filter(function (t, i) { return fs[i] <= asof; });
      }
      return Promise.resolve({ run: run, version: u.searchParams.get("v") || "", tags: names });
    }
    if (p === "/series") {
      var R3 = BUNDLE.runs[run];
      var want = (u.searchParams.get("tags") || "").split(",").filter(Boolean);
      var steps = visibleSteps(run, asof);
      var out = {};
      want.forEach(function (t) {
        var full = R3.series[t];
        out[t] = steps.map(function (s) { var v = full ? full[s.step - 1] : null; return v === undefined ? null : v; });
      });
      return Promise.resolve({
        run: run, version: u.searchParams.get("v") || "", steps: steps.map(function (s) { return s.step; }),
        walls: steps.map(function (s) { return s.wall; }), run_start: R3.axis.run_start, series: out,
      });
    }
    if (p === "/content") {
      var byLang = BUNDLE.content || {};
      var C = byLang[contentLang()] || byLang["zh-CN"] || byLang.en || { metrics: [], insights: [] };
      return Promise.resolve({
        metrics: C.metrics || [], insights: C.insights || [],
        metrics_meta: C.metrics_meta || null, insights_window: C.insights_window || null,
        insights_updated_at: C.insights_updated_at || null,
        /* 溯源总览页签的资料（导出时就在包里，漏了这三个字段离线就只剩空列表） */
        sources: C.sources || [], sources_note: C.sources_note || null, sources_gaps: C.sources_gaps || [],
        notices_zh: C.notices_zh || {},
      });
    }
    if (p === "/correlate") {
      /* 离线副本里全量序列都在手上，用一个不存在的东西换几毫秒：直接算。
         内核和服务端是同一份 site/js/correlate.js，所以两边数字一致。 */
      var R4 = BUNDLE.runs[run];
      if (!R4) return Promise.reject(new Error(T("离线副本里没有 run：{0}", run)));
      var K = window.TelemetryCorrelate;
      if (!K) return Promise.reject(new Error(T("离线副本缺少 site/js/correlate.js")));
      var vis = visibleSteps(run, asof);
      var cSteps = vis.map(function (s) { return s.step; });
      var cWalls = vis.map(function (s) { return s.wall; });
      var cSeries = {};
      Object.keys(R4.series || {}).forEach(function (t) {
        var full = R4.series[t];
        /* 这里要 map 步对象而不是步号数组：序列是按"第 N 步 → 下标 N-1"取的。 */
        cSeries[t] = vis.map(function (s) { var v = full ? full[s.step - 1] : null; return v === undefined ? null : v; });
      });
      /* 口径要对齐服务端：那边数的是标签表，连"整轮都没有读数"的指标也算在总数里；
         导出包里的 series 只存真正有值的那些，直接算会比线上少几十条，
         同一句"这一步共 N 个指标"在线说 2029、离线说 1944。补齐键集合，
         空序列交给内核按"有效点太少"归入 skipped，两边就同一句话。 */
      (R4.tags || []).forEach(function (t) {
        if (cSeries[t]) return;
        cSeries[t] = cSteps.map(function () { return null; });
      });

      var qStep = u.searchParams.get("step");
      var qMetric = u.searchParams.get("metric");
      var qBench = u.searchParams.get("bench");
      var cAnchor = null, cLabel = null;
      if (qMetric && cSeries[qMetric]) {
        cAnchor = { kind: "metric", id: qMetric, label: qMetric, values: cSeries[qMetric] };
      } else if (qBench) {
        var bb = (BUNDLE.benchmarks || []).filter(function (x) { return x.key === qBench; })[0];
        var rres = bb && bb.results ? (bb.results[run] || {}) : {};
        if (bb) {
          cLabel = bb.title || bb.key;
          cAnchor = { kind: "bench", id: bb.key, label: cLabel, values: cSteps.map(function (s) { return rres[String(s)] == null ? null : Number(rres[String(s)]); }) };
        }
      }
      var res = K.analyze({
        series: cSeries, steps: cSteps, step: qStep ? Number(qStep) : null, anchor: cAnchor,
        lang: typeof contentLang === "function" ? contentLang() : "en",
        opts: { top: Math.min(40, Math.max(3, Number(u.searchParams.get("top")) || 12)) },
      });
      var idx = res.index;
      var cTo = cWalls[idx] != null ? cWalls[idx] : null;
      var cFrom = idx > 0 ? cWalls[idx - 1] : null;
      var inWin = function (t) { return cTo != null && t <= cTo && (cFrom == null || t >= cFrom); };
      /* 公告放宽到"下一步完成之前"（官方事后补发）；这一步是切面最后一步时放宽到切面当前时刻 */
      var cNow = asof != null ? asof : ((R4.status && R4.status.clock && R4.status.clock.now) || cTo);
      var cNoticeTo = cWalls[idx + 1] != null ? cWalls[idx + 1] : (cNow != null ? cNow : cTo);
      var inNoticeWin = function (t) { return cNoticeTo != null && t <= cNoticeTo && (cFrom == null || t >= cFrom); };
      var afterStep = function (t) {
        var o = null;
        for (var i2 = 0; i2 < cWalls.length; i2++) if (cWalls[i2] <= t) o = i2 + 1;
        return o;
      };
      var cb = (BUNDLE.content && (BUNDLE.content[contentLang()] || BUNDLE.content["zh-CN"] || BUNDLE.content.en)) || {};
      var zh = cb.notices_zh || {};
      /* 事件流是滚动保留的，早期步查不到重启 —— 说"没重启"之前先把这个区别讲清楚 */
      var evList = (R4.events || []).filter(function (e) { return asof == null || e.t <= asof; });
      if (evList.length && cTo != null && cTo < Math.min.apply(null, evList.map(function (e) { return e.t; }))) {
        res.caveats.push(T("这一步完成的时刻早于本地事件流的第一条记录，这一段的 OOM / 重启没有留档，所以「时段内没有重启」只代表查不到，不代表没发生。"));
      }
      return Promise.resolve({
        run: run, step: res.step, steps: cSteps, walls: cWalls,
        anchor: res.anchor ? Object.assign({}, res.anchor, { label: cLabel || res.anchor.label }) : null,
        movers: res.movers, corr: res.corr, counts: res.counts, caveats: res.caveats,
        context: {
          window: { from: cFrom, to: cTo },
          restarts: (R4.events || []).filter(function (e) { return e.kind === "restart" && inWin(e.t); })
            .map(function (e) { return { t: e.t, after_step: afterStep(e.t) }; }),
          /* 看板标签集快照版本（不是训练配置版本），见 server.ts 的说明 */
          tagset_versions: (R4.versions || []).filter(function (v) { return (asof == null || v.at <= asof) && inWin(v.at); })
            .map(function (v) { return { version: v.version, at: v.at, tags: v.n, after_step: afterStep(v.at) }; }),
          notices: (BUNDLE.notices || []).filter(function (n) { return inNoticeWin(n.t); })
            .map(function (n) { return { id: n.id, t: n.t, run: n.run, text: n.text, text_zh: (zh[n.id] || {}).zh || null, after_step: afterStep(n.t), late: cTo != null && n.t > cTo }; }),
          neighbors: (R4.steps || []).filter(function (s) { return Math.abs(s.step - res.step) <= 2; })
            .map(function (s) { return { step: s.step, t: s.t, wall: s.wall, headline: s.value, delta: s.delta, tokens: s.tokens, redo: !!s.redo }; }),
          restarts_total: (R4.events || []).filter(function (e) { return e.kind === "restart"; }).length,
        },
        generated_at: Date.now() / 1000,
      });
    }
    if (p === "/telemetry/timeline") {
      var runs = {};
      Object.keys(BUNDLE.runs).forEach(function (r) { runs[r] = BUNDLE.runs[r].timeline; });
      return Promise.resolve({ syncs: BUNDLE.syncs, runs: runs, offline: true });
    }
    if (p === "/telemetry/summary") {
      var o = { asof: asof, sync: null, runs: {} };
      var sList = BUNDLE.syncs || [];
      for (var si = sList.length - 1; si >= 0; si--) {
        if (asof == null || sList[si].captured <= asof) { o.sync = sList[si]; break; }
      }
      Object.keys(BUNDLE.runs).forEach(function (r) {
        var s = bundleStatus(r, asof);
        o.runs[r] = {
          label: s.run.label, step: s.step.last, headline: s.headline.last, headline_tag: s.headline.tag,
          cost: s.cost.so_far, rate: s.cost.rate_per_s, phase: s.step.phase, version: s.version,
          restarts: s.totals.restarts, tokens_cum: s.totals.tokens_cum,
          steps_done: s.step.last, steps_total: BUNDLE.runs[r].steps.length,
        };
      });
      return Promise.resolve(o);
    }
    return Promise.reject(new Error(T("offline bundle 没有这个接口: {0}", p)));
  }

  // -------------------------------------------------------------- 格式化
  function utc(sec) {
    if (sec == null) return "—";
    return new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }
  function bj(sec) {
    if (sec == null) return "—";
    return new Date((sec + 8 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 16);
  }

  /* 把切面写进 URL，刷新以后还在。用 file:// 打开时 replaceState 会被浏览器拒绝
     （opaque origin），所以失败就算了 —— 回放照样能用，只是刷新后不记得切面。 */
  function setUrl(asof) {
    try {
      var u = new URL(location.href);
      if (asof == null) u.searchParams.delete("asof");
      else u.searchParams.set("asof", asofParam(asof));
      history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
    } catch (e) { /* file:// 下忽略 */ }
  }
  function money(v) {
    if (v == null) return "—";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function num(v, d) {
    if (v == null) return "—";
    return Number(v).toFixed(d == null ? 3 : d);
  }
  function compact(v) {
    if (v == null) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(3) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(3) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
    return String(v);
  }
  function dur(sec) {
    if (sec == null) return "—";
    sec = Math.max(0, Math.round(sec));
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return T("{0} 天 {1} 小时", d, h);
    if (h) return T("{0} 小时 {1} 分", h, m);
    if (m) return T("{0} 分钟", m);
    return T("{0} 秒", sec);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /** 太长就中间截断，只给 tooltip 和角标这类一行放不下的地方用。 */
  function shortLabel(s, n) {
    s = String(s == null ? "" : s);
    if (s.length <= n) return s;
    var head = Math.ceil((n - 1) / 2), tail = Math.floor((n - 1) / 2);
    return s.slice(0, head) + "…" + s.slice(s.length - tail);
  }

  // ------------------------------------------------------ 图表联动（点击同步 epoch）
  /* 原站的每张图各自为政：鼠标移到哪里，只有那张图显示那一刻的读数。
     同一屏上有 18 张固定指标图，想横向比"第 15 步时这些指标各自是多少"，
     就得一张一张去挪鼠标——这个功能把这一步合起来：

       勾上"联动" → 在任意一张图上点某一步 → 所有图都跳到那一步
         · 每张图画出那一步的竖线和各条曲线的取值点（复用原站的 hover 绘制）
         · 每张图弹出那一步的读数框（step N · 运行时长 + 各 run 的值）
         · 卡片右上角的数值列从"最新值"切成"那一步的值"
       再点同一步、点角标的 ✕、或取消勾选，都取消联动。

     实现上 charts.js 一个字都不改：这里把 Charts.Line / Charts.Stacked 的构造函数
     包一层，拿到实例以后补自己需要的事件和重绘——和回放层换掉 window.fetch 是一个思路。
     联动关着的时候，事件处理器什么也不做，行为与原站完全一致。 */
  var sync = { on: false, step: null, charts: [], anchor: null, run: null };
  try { sync.on = localStorage.getItem("telemetry.sync") === "1"; } catch (e) { }

  var OrigLine = window.Charts && window.Charts.Line;
  var OrigStacked = window.Charts && window.Charts.Stacked;
  var valBase = [];            // [{el, html}]：联动前的数值列，取消时原样还原

  var isStacked = function (inst) { return !!(OrigStacked && inst instanceof OrigStacked); };

  /* 鼠标底下那一步。Line 的 hover 是按 x 对齐的，x 反查回步号；
     Stacked 直接按柱子的下标取。 */
  function chartStepUnder(inst, e) {
    if (!inst.data || !inst.L) return null;
    inst._hover(e);
    if (isStacked(inst)) {
      return inst.hoverI >= 0 && inst.data.steps ? inst.data.steps[inst.hoverI] : null;
    }
    var p = inst.prepared;
    if (!p || inst.hoverX == null) return null;
    for (var i = 0; i < p.series.length; i++) {
      var s = p.series[i], k = s.steps ? s.xs.indexOf(inst.hoverX) : -1;
      if (k >= 0 && s.steps[k] != null) return s.steps[k];
    }
    return null;
  }

  /* 某张图在指定步上的 x 坐标。time 轴下两个 run 的 x 不同，
     取第一条含这一步、且那一点画得出来的曲线。 */
  function chartXForStep(inst, step) {
    var p = inst.prepared;
    if (!p) return null;
    for (var i = 0; i < p.series.length; i++) {
      var s = p.series[i];
      for (var k = 0; k < s.steps.length; k++) {
        if (s.steps[k] === step) { if (s.y[k] != null) return s.xs[k]; break; }
      }
    }
    return null;
  }

  /* 把联动标注画到一张图上；这张图没有那一步（指标缺值、benchmark 是散点、
     或者这个 run 还没走到）就把它自己上一轮的标注清掉，不能留着。 */
  function applyPin(inst) {
    if (!sync.on || sync.step == null || !inst.L) return;
    if (isStacked(inst)) {
      var d = inst.data;
      var i = d && d.steps ? d.steps.indexOf(sync.step) : -1;
      if (i < 0) { clearPinFrom(inst); return; }
      inst.__pinI = i;
      if (inst.hoverI === i && inst.tip.style.display === "block") return;
      var rect = inst.canvas.getBoundingClientRect();
      inst._hover({ clientX: rect.left + inst.L.toX(d.steps[i]) });
      return;
    }
    var x = chartXForStep(inst, sync.step);
    if (x == null) { clearPinFrom(inst); return; }
    inst.__pinX = x;
    if (inst.hoverX === x) return;
    inst.hoverX = x;
    inst.draw();
    inst._tooltip(x);
  }

  /* 只清掉自己画的标注：用户正在悬停别的点时不动他。 */
  function clearPinFrom(inst) {
    if (inst.__pinX == null && inst.__pinI == null) return;
    inst.__pinX = null; inst.__pinI = null;
    if (isStacked(inst)) {
      if (inst.hoverI >= 0) { inst.hoverI = -1; inst.draw(); }
    } else if (inst.hoverX != null) {
      inst.hoverX = null; inst.draw();
    }
    if (inst.tip) { inst.tip.style.display = "none"; inst.tip.classList.remove("telemetry-tip-pinned"); }
  }

  /* anchor / run 由点击图表时传进来；不传就保持不变（用来给面板内的切换留口子）。 */
  function setPin(step, anchor, run) {
    noteReturnHash();
    sync.step = step;
    if (anchor !== undefined) sync.anchor = anchor;
    if (run !== undefined) sync.run = run;
    for (var i = 0; i < sync.charts.length; i++) applyPin(sync.charts[i]);
    updateValColumns();
    renderSyncState();
    syncUrl();
  }

  function clearPin() {
    sync.step = null;
    sync.anchor = null;
    sync.run = null;
    for (var i = 0; i < sync.charts.length; i++) clearPinFrom(sync.charts[i]);
    restoreValColumns();
    renderSyncState();
    syncUrl();
  }

  function setSyncOn(on) {
    sync.on = !!on;
    try { localStorage.setItem("telemetry.sync", sync.on ? "1" : "0"); } catch (e) { }
    if (sync.on) renderSyncState(); else clearPin();
  }

  /* ==================================================================
   * 深链：把"联动锁在某一步"和"分析这一步"做成可以贴出去的 URL
   *
   *   #step/<run>/<step>[/<anchor>]    联动打开、锁定这一步，每张图都标出它
   *   #corr/<run>/<step>[/<anchor>]    同上，并把「分析这一步」面板直接打开
   *
   * <anchor> 是"点住的那条曲线"：评测榜写榜单代号（deepswe），训练指标写 URL 编码后的
   * 指标名（actor%2Fentropy_loss）。没有斜杠的当榜单、有斜杠的当指标 —— 指标名一定有
   * 命名空间、榜单代号一定没有，这一条就能把两者分开，URL 里不用再标类型。
   *
   * 为什么这两个状态值得有个地址：联动锁步原本是"点一下"才有的临时状态，关掉标签页
   * 就没了，也没法发给别人。要说清"这一步发生了什么"，与其让读者自己从两千条曲线里
   * 找到那张图、再点对那一步，不如直接把地址给他。
   *
   * 写地址用 history.replaceState 而不是 location.hash =，理由和文档面板一样：
   * #step 不是 app.js 的路由，改 hash 会让它把整页重画一遍（图全部重建、滚动回顶），
   * 而这里要的只是"地址栏跟着状态走"。
   * ================================================================== */
  var deep = { returnHash: null, looking: 0 };

  function fallbackHash() {
    var a = document.querySelector("#tabs a.active");
    return (a && a.dataset && a.dataset.view) ? "#" + a.dataset.view : "#overview";
  }
  /* 进这一步之前地址栏是什么。清掉锁步时按它还原，而不是一律跳回 overview。 */
  function noteReturnHash() {
    if (!/^#(step|corr)\//.test(location.hash || "")) deep.returnHash = location.hash || fallbackHash();
  }

  function stepHash() {
    var runs = corrRuns();
    var segs = ["step", sync.run || corr.run || (runs[0] && runs[0].key) || "flash", String(sync.step)];
    if (sync.anchor) segs.push(encodeURIComponent(sync.anchor.id));
    return "#" + segs.join("/");
  }
  function corrHash() {
    var runs = corrRuns();
    var segs = ["corr", corr.run || sync.run || (runs[0] && runs[0].key) || "flash", String(corr.step)];
    if (corr.anchor) segs.push(encodeURIComponent(corr.anchor.id));
    return "#" + segs.join("/");
  }

  /** 地址栏跟上"锁步 / 分析面板"这两个状态；两个都没有就把属于自己的地址收掉。 */
  function syncUrl() {
    if (doc.open) return;                            // 解读面板自己管地址，别抢
    if (corr.open) { setHash(corrHash()); return; }
    if (sync.on && sync.step != null) { setHash(stepHash()); return; }
    if (/^#(step|corr)\//.test(location.hash || "")) setHash(deep.returnHash || fallbackHash());
  }

  function parseStepHash(hash) {
    var parts = String(hash || "").replace(/^#/, "").split("/");
    if (parts[0] !== "step" && parts[0] !== "corr") return null;
    var run = dec(parts[1] || ""), step = Number(parts[2]);
    if (!run || !isFinite(step) || step <= 0) return null;
    var id = parts.length > 3 ? dec(parts.slice(3).join("/")) : "";
    return { mode: parts[0], run: run, step: Math.round(step), anchor: id ? anchorFromId(id) : null };
  }
  function anchorFromId(id) {
    return id.indexOf("/") < 0 ? { kind: "bench", id: id, label: id } : { kind: "metric", id: id, label: id };
  }
  function sameAnchor(a, b) {
    if (!a && !b) return true;
    return !!(a && b && a.kind === b.kind && a.id === b.id);
  }

  /* 榜单锚点的名字要显示成「DeepSWE v1.1」而不是代号 deepswe —— 联动角标和分析面板
     的标题栏都用它。离线副本直接查 bundle，在线问一次 /api/benchmarks；查不到就留着代号。 */
  function resolveAnchorLabel(anchor) {
    if (!anchor || anchor.kind !== "bench" || anchor.label !== anchor.id) return;
    var found = function (list) {
      for (var i = 0; list && i < list.length; i++) {
        if (list[i].key === anchor.id && list[i].title) { setAnchorLabel(anchor, list[i].title); return true; }
      }
      return false;
    };
    if (BUNDLE && found(BUNDLE.benchmarks)) return;
    api("api/benchmarks").then(function (d) { found(d && d.benchmarks); }).catch(function () { });
  }
  function setAnchorLabel(anchor, label) {
    if (!label) return;
    anchor.label = label;
    if (sync.anchor && sync.anchor.id === anchor.id) { sync.anchor.label = label; renderSyncState(); }
    if (corr.anchor && corr.anchor.id === anchor.id) { corr.anchor.label = label; if (corr.open) renderCorr(); }
  }

  /* 锚点那张图：评测榜看 data-bench，训练指标看卡片自己的 __card.tag。
     两项都是 app.js 写上去的，这里只读不写。 */
  function anchorCard(anchor) {
    if (!anchor) return null;
    if (anchor.kind === "bench") {
      var key = (window.CSS && CSS.escape) ? CSS.escape(anchor.id) : anchor.id;
      return document.querySelector('.chart-card[data-bench="' + key + '"]');
    }
    var cards = document.querySelectorAll(".chart-card");
    for (var i = 0; i < cards.length; i++) {
      var rec = cards[i].__card;
      if (rec && rec.tag === anchor.id) return cards[i];
    }
    return null;
  }

  /* 锚点那张图：先等它出现（首页图表是懒加载的，滚到跟前才建），出现后滚过去。
     app.js 渲染收尾时会 scrollTo(0,0)，正好能把刚滚好的位置顶掉 —— 所以开头两秒里
     再确认几次，位置被顶掉就滚回去，之后完全交还给用户。一直找不到就算了：
     状态本身已经生效，只是没滚动过去。 */
  function focusAnchor(anchor) {
    if (!anchor) return;
    var mine = ++deep.looking, waited = 0;
    (function find() {
      if (mine !== deep.looking) return;
      var el = anchorCard(anchor);
      if (!el) { if ((waited += 250) < 6000) setTimeout(find, 250); return; }
      var flash = true;
      [0, 400, 800, 1400, 2000].forEach(function (d) {
        setTimeout(function () {
          if (mine !== deep.looking || !el.isConnected) return;
          var r = el.getBoundingClientRect();
          var off = r.top < 60 || r.bottom > window.innerHeight - 40;
          if (d === 0 || off) {
            try { el.scrollIntoView({ block: "center", behavior: d === 0 ? "smooth" : "auto" }); }
            catch (e) { el.scrollIntoView(); }
          }
          if (flash) {
            flash = false;
            el.classList.remove("telemetry-anchor-flash");
            void el.offsetWidth;                    // 强制回流，连着开同一条也能重新闪
            el.classList.add("telemetry-anchor-flash");
            setTimeout(function () { el.classList.remove("telemetry-anchor-flash"); }, 2400);
          }
        }, d);
      });
    })();
  }

  /** 把 URL 描述的状态落到界面上（刷新、别人发来的链接、手动改地址都走这里）。 */
  function applyStepState(st) {
    resolveAnchorLabel(st.anchor);
    if (st.mode === "step" && corr.open) closeCorrPanel(true);
    noteReturnHash();
    sync.on = true;
    try { localStorage.setItem("telemetry.sync", "1"); } catch (e) { }
    sync.run = st.run;
    sync.anchor = st.anchor;
    sync.step = st.step;
    for (var i = 0; i < sync.charts.length; i++) applyPin(sync.charts[i]);
    updateValColumns();
    renderSyncState();
    focusAnchor(st.anchor);
    if (st.mode === "corr") openCorrPanel({ step: st.step, anchor: st.anchor, run: st.run });
    else syncUrl();
  }
  function routeStepHash(hash) {
    var st = parseStepHash(hash);
    if (!st) return false;
    applyStepState(st);
    return true;
  }

  /* 数值列：联动时显示"那一步"的值。某条 run 没有这一步就退到它最近的一步，
     并把实际的步号标出来（@s19），免得被当成那一步的数字。 */
  function valHTMLAt(inst, step) {
    var series = (inst.data && inst.data.series) || [];
    var fmt = (inst.opts && inst.opts.format) || "auto";
    var exactOnly = !!(inst.opts && inst.opts.points);      // benchmarks 是散点，不做顺延
    var card = inst.container.closest ? inst.container.closest(".card") : null;
    var val = card && card.querySelector(".card-head .val");
    var withLabel = !!(val && val.querySelector("span.dim"));
    var html = series.map(function (s) {
      var head = '<i class="swatch" style="background:' + s.color + '"></i>' +
        (withLabel ? '<span class="dim">' + esc(s.label) + "</span> " : "");
      var idx = -1;
      for (var i = 0; i < s.steps.length && s.steps[i] <= step; i++) if (s.values[i] != null) idx = i;
      if (idx < 0 || (exactOnly && s.steps[idx] !== step)) return "<div>" + head + "—</div>";
      var at = s.steps[idx] === step ? "" : '<span class="sync-at">@s' + s.steps[idx] + "</span>";
      var pidx = -1;
      for (var j = idx - 1; j >= 0; j--) if (s.values[j] != null) { pidx = j; break; }
      var d = pidx >= 0 ? Fmt.delta(s.values[idx], s.values[pidx], fmt) : null;
      return "<div>" + head + Fmt.text(s.values[idx], fmt) + at + (d ? Fmt.deltaHTML(d, null, "") : "") + "</div>";
    }).join("");
    return html || '<span class="muted">—</span>';
  }

  function updateValColumns() {
    if (sync.step == null) return;
    for (var i = 0; i < sync.charts.length; i++) {
      var inst = sync.charts[i];
      if (isStacked(inst) || (OrigLine && !(inst instanceof OrigLine))) continue;
      var card = inst.container.closest ? inst.container.closest(".card") : null;
      var val = card && card.querySelector(".card-head .val");
      if (!val) continue;
      if (val.getAttribute("data-sync") == null) {          // 第一次改之前先记下原样
        valBase.push({ el: val, html: val.innerHTML });
        val.setAttribute("data-sync", "1");
        val.classList.add("synced");
      }
      val.innerHTML = valHTMLAt(inst, sync.step);
    }
  }

  function restoreValColumns() {
    valBase.forEach(function (b) {
      b.el.innerHTML = b.html;
      b.el.removeAttribute("data-sync");
      b.el.classList.remove("synced");
    });
    valBase = [];
  }

  /* 图表是懒加载的：滚动到哪一张才建哪一张。新建的图 setData 之后再补一次标注，
     数值列的改写也一并推后，避免一次渲染里改上十几遍。 */
  var valTimer = null;
  function scheduleVals() {
    if (valTimer) return;
    valTimer = setTimeout(function () {
      valTimer = null;
      if (sync.on && sync.step != null) updateValColumns();
    }, 60);
  }

  /* 点住的是哪一条曲线。两个 run 在 step 轴上完全对齐，光看 x 分不出来，
     所以拿点击点跟"这一步上各条曲线的点"比像素距离 —— 离哪条近就是点了哪条。
     只在有这一步取值的曲线上比，免得某条曲线缺这一步而被算到隔壁步上。 */
  function chartRunAtStep(inst, step, e) {
    if (isStacked(inst) || !inst.L || !inst.canvas) return null;
    var rect = inst.canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var p = inst.prepared, best = null, bd = Infinity;
    for (var i = 0; i < p.series.length; i++) {
      var s = p.series[i];
      if (!s.steps || !s.xs) continue;
      for (var k = 0; k < s.steps.length; k++) {
        if (s.steps[k] !== step || s.y[k] == null) continue;
        var dx = inst.L.toX(s.xs[k]) - px, dy = inst.L.toY(s.y[k]) - py;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best ? best.key : null;
  }

  /* 点的是哪张图 —— 训练指标在 card.__card.tag 上，评测榜卡片没有 tag，
     用的是 app.js 写进 data-bench 的榜单代号。 */
  function anchorFromChart(inst) {
    var card = inst.container && inst.container.closest ? inst.container.closest(".chart-card") : null;
    if (!card) return null;
    if (card.dataset && card.dataset.bench) {
      var t = card.querySelector(".card-title");
      /* 卡片标题是「榜单名 + muted 备注（min-swe-agent, avg@3）」，备注不要带进锚点名 */
      var label = t ? String(t.childNodes[0] ? t.childNodes[0].textContent : t.textContent).trim() : card.dataset.bench;
      return { kind: "bench", id: card.dataset.bench, label: label || card.dataset.bench };
    }
    var rec = card.__card;
    if (rec && rec.tag) return { kind: "metric", id: rec.tag, label: rec.tag };
    return null;
  }

  function onChartClick(inst, e) {
    if (!sync.on) return;
    var step = chartStepUnder(inst, e);
    if (step == null) return;
    if (sync.step === step) { clearPin(); return; }
    setPin(step, anchorFromChart(inst), chartRunAtStep(inst, step, e));
  }

  /* 锁在某一步时，读数框会一直压在曲线上，挡住它正要说明的那段走势。
     把"这一次的读数框就是锁定那一步的"标出来，样式里据此调成半透明。
     判据用坐标/下标而不是"现在是不是联动状态"：联动开着但用户把鼠标移到别处时，
     那是他临时在看，不该跟着变淡。 */
  function markTip(inst, pinned) {
    if (inst.tip) inst.tip.classList.toggle("telemetry-tip-pinned", !!pinned);
  }

  function registerChart(inst) {
    sync.charts.push(inst);
    inst.canvas.style.cursor = sync.on ? "crosshair" : "";
    var destroy = inst.destroy;
    inst.destroy = function () {
      var i = sync.charts.indexOf(inst);
      if (i >= 0) sync.charts.splice(i, 1);
      return destroy.apply(inst, arguments);
    };
    var setData = inst.setData;
    inst.setData = function () {
      var r = setData.apply(inst, arguments);
      if (sync.on && sync.step != null) { applyPin(inst); scheduleVals(); }
      return r;
    };
    /* Line 走 _tooltip(x)、Stacked 在自己的 _hover 里直接写 innerHTML，
       两条路都得盖一层才知道框里画的是不是锁定那一步。 */
    if (typeof inst._tooltip === "function") {
      var tooltip = inst._tooltip;
      inst._tooltip = function (x) {
        var r = tooltip.apply(inst, arguments);
        markTip(inst, inst.__pinX != null && x === inst.__pinX);
        return r;
      };
    }
    if (typeof inst._hover === "function") {
      var hover = inst._hover;
      inst._hover = function () {
        var r = hover.apply(inst, arguments);
        if (isStacked(inst)) markTip(inst, inst.__pinI != null && inst.hoverI === inst.__pinI);
        return r;
      };
    }
    inst.canvas.addEventListener("click", function (e) { onChartClick(inst, e); });
    /* 原站的 pointerleave 会把竖线和读数框收掉；联动时这里再补回来。
       两个处理器在同一个事件派发里跑，浏览器只重绘一次，看不出跳动。 */
    inst.canvas.addEventListener("pointerleave", function () {
      if (sync.on && sync.step != null) applyPin(inst);
    });
  }

  (function wrapCharts() {
    if (!window.Charts) return;
    function wrap(Orig) {
      var Wrapped = function (container, opts) {
        var inst = new Orig(container, opts);
        registerChart(inst);
        return inst;                    // 构造函数返回对象，new 出来的就是原实例
      };
      Wrapped.prototype = Orig.prototype;
      return Wrapped;
    }
    if (OrigLine) window.Charts.Line = wrap(OrigLine);
    if (OrigStacked) window.Charts.Stacked = wrap(OrigStacked);
  })();

  /* 控件挂在图表工具条（step/time · linear/log · smoothing 那一行）的最右边，
     和它管的东西放在一起。工具条是 app.js 每次重画视图时重建的，
     所以用 MutationObserver 盯着 #main，缺了就补上；一个视图一行，各自带一个步号角标。 */
  function makeSyncControl() {
    var label = document.createElement("label");
    label.className = "check telemetry-sync";
    label.title = T("勾选后，在任意图表上点某一步，所有图表都跳到同一步（再点一次取消）");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "telemetry-sync-on";
    box.checked = !!sync.on;
    var text = document.createElement("span");
    text.textContent = T("联动");
    label.append(box, text);
    var at = document.createElement("span");
    at.className = "telemetry-sync-at hidden";
    return [label, at];
  }

  function ensureSyncControl() {
    var rows = document.querySelectorAll("#main .controls");
    var added = false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      /* 只认图表工具条：批组成那块也有 .controls，但里面有 by/run 下拉，别挂上去 */
      if (!row.querySelector(".slider") || row.querySelector(".telemetry-sync")) continue;
      row.append.apply(row, makeSyncControl());
      added = true;
    }
    if (added) renderSyncState();
  }

  function hookControls() {
    var main = document.getElementById("main");
    if (main && window.MutationObserver) {
      new MutationObserver(function () {
        ensureSyncControl(); ensureNoticesPanel();
        ensureBoards(); ensurePickBoxes(); ensurePickBar();
      }).observe(main, { childList: true, subtree: true });
    }
    /* 勾选/取消和角标上的 ✕ 用事件委托，工具条重建多少次都不用重新绑定 */
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains("telemetry-sync-on")) setSyncOn(t.checked);
      else if (t.classList.contains("telemetry-pick-box")) {
        if (t.checked) pick[t.dataset.pickTag] = true;
        else delete pick[t.dataset.pickTag];
        ensurePickBar();
      }
    });
    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest(".telemetry-sync-at button")) {
        if (e.target.closest("[data-corr-open]")) {
          openCorrPanel({ step: sync.step, anchor: sync.anchor, run: sync.run });
        } else {
          clearPin();
        }
      }
    });
    /* Esc 先关浮动框（命名 / 选 Tab 的小弹层），关掉了就不再往下传，
       免得连带把底下的编辑弹窗或解读面板一起关掉。 */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (boardPop) { closePop(); e.stopPropagation(); return; }
      if (corr.open) { closeCorrPanel(); e.stopPropagation(); }
    }, true);
    ensureSyncControl();
    ensureNoticesPanel();
  }

  function renderSyncState() {
    var i;
    var boxes = document.querySelectorAll(".telemetry-sync-on");
    for (i = 0; i < boxes.length; i++) boxes[i].checked = !!sync.on;
    var labels = document.querySelectorAll(".telemetry-sync");
    for (i = 0; i < labels.length; i++) labels[i].classList.toggle("on", !!sync.on);
    /* 导航上那个按钮和工具条里的勾选框是同一份状态，两边一起变 */
    var btns = document.querySelectorAll("#telemetry-sync-btn");
    for (i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", !!sync.on);
      btns[i].title = sync.on
        ? (sync.step == null ? T("图表联动已开启：在任意图表上点某一步，所有图表都跳到同一步") : T("图表联动已开启，当前锁定 step {0}；点一下关闭", sync.step))
        : T("图表联动：在任意图表上点某一步，所有图表都跳到同一步");
    }
    var ats = document.querySelectorAll(".telemetry-sync-at");
    for (i = 0; i < ats.length; i++) {
      if (sync.step == null) {
        ats[i].classList.add("hidden");
        ats[i].innerHTML = "";
      } else {
        ats[i].classList.remove("hidden");
        /* 点住某一步之后，这里同时是"这一步发生了什么"的入口：
           锚点（点的那条曲线）和步号都已经有了，只差点一下。 */
        ats[i].innerHTML = "step " + sync.step +
          (sync.anchor ? '<span class="telemetry-sync-anchor" title="' + esc(sync.anchor.label) + '">' + esc(shortLabel(sync.anchor.label, 22)) + "</span>" : "") +
          '<button type="button" class="telemetry-sync-go" data-corr-open="1" title="' + T("看这一步哪些指标一起动了、以及和这条曲线同涨同跌的指标") + '">' + T("分析这一步") + '</button>' +
          '<button type="button" data-corr-clear="1" title="' + T("取消标注") + '">✕</button>';
      }
    }
    for (i = 0; i < sync.charts.length; i++) sync.charts[i].canvas.style.cursor = sync.on ? "crosshair" : "";
  }

  // ------------------------------------ overview notices（翻译 + 关联训练步 + 定位）
  /* 原站的 notices 是一份只增不减的英文清单：越攒越长，把首页越撑越长，而且只有英文。
     遥测层把它换成自己的一块（原站那份照常渲染，只是藏起来——不去改 app.js 的渲染逻辑，
     只拿它的 DOM 变化当"公告更新了"的信号）：

       · 中文译文，可一键切回英文原文；想逐条核对时勾"对照原文"，中文下面会补一行英文原句
       · 默认只铺最近 3 条，更早的点按钮展开成一个固定高度的滚动列表——
         不让一屏公告把下面的状态卡和图表顶下去，也不出现"某一行被拦腰切断"的样子
       · 每条公告标出"发布时两个 run 各自完成了第几步"（从 /api/status 的 step 事件算）
       · 每个 run 一根滑杆，拖到某一步就把那一刻前后的公告滚到眼前并高亮

     译文放在 content/notices.zh.json（按公告 id 索引，人写，进版本管理），
     经 /api/content 下发；离线副本打进 bundle。没有译文的公告自动回落到英文并标出来。 */
  var nz = {
    /* 公告默认跟随页面语言：英文模式看上游英文原文，中文模式看译文。
       面板里那个 中文/原文 小开关只是当前会话里临时对照用，不再单独持久化 ——
       语言的正主是导航上的 EN | 中文，那个一改就整页重载。 */
    lang: (window.I18N && window.I18N.lang === "zh-CN") ? "zh" : "en",   // zh | en
    para: false,        // 中文下面是否同时显示英文原句
    expanded: false,    // 是否展开全部历史公告
    locate: false,      // 是否铺开按训练步定位的滑杆（默认收起，省一屏高度）
    recent: 3,          // 收起时铺几条
    panel: null,        // 遥测层自己那块
    src: null,          // 原站的 #notices
    obs: null,
    data: null,         // {notices, runs, timelines, zh}
    runs: null,
    pos: {},            // run -> 滑杆当前位置（timeline 下标），面板重画后不跳回去
    seq: 0,
    timer: null,
  };
  try {
    nz.para = localStorage.getItem("telemetry.notices.para") === "1";
    nz.expanded = localStorage.getItem("telemetry.notices.expand") === "1";
    nz.locate = localStorage.getItem("telemetry.notices.locate") === "1";
  } catch (e) { }

  function saveNoticesPrefs() {
    try {
      localStorage.setItem("telemetry.notices.para", nz.para ? "1" : "0");
      localStorage.setItem("telemetry.notices.expand", nz.expanded ? "1" : "0");
      localStorage.setItem("telemetry.notices.locate", nz.locate ? "1" : "0");
    } catch (e) { }
  }

  /* 每个 step 取最后一次完成时刻（重跑会覆盖前一次），按时间升序排。
     一条公告发布时"已完成第几步"＝ 完成时刻不晚于它的最大步号。 */
  function stepTimeline(status) {
    var byStep = {};
    ((status && status.events) || []).forEach(function (e) {
      if (e.kind !== "step" || e.step == null || e.t == null) return;
      byStep[e.step] = e.t;
    });
    return Object.keys(byStep).map(function (s) { return { step: Number(s), t: byStep[s] }; })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function stepAt(timeline, t) {
    var best = null;
    for (var i = 0; i < timeline.length; i++) {
      if (timeline[i].t <= t && (best == null || timeline[i].step > best)) best = timeline[i].step;
    }
    return best;
  }

  function runColorAt(runs, key) {
    var pal = window.Charts ? Charts.palette() : ["#2a78d6"];
    var i = 0;
    for (var k = 0; k < runs.length; k++) if (runs[k].key === key) { i = k; break; }
    var r = runs[i] || {};
    return pal[(r.color_index != null ? r.color_index : i) % pal.length];
  }

  /* 译文条目允许是字符串（只要译文）或 {en, zh}（en 用来检测原文有没有被改过）。 */
  function zhOf(d, n) {
    var e = d.zh[n.id];
    if (!e) return null;
    var text = typeof e === "string" ? e : e.zh;
    if (!text) return null;
    var stale = !!(e.en && String(e.en).trim() !== String(n.text || "").trim());
    return { text: text, stale: stale };
  }

  function loadNoticesData() {
    var seq = ++nz.seq;
    return Promise.all([
      api("api/notices").catch(function () { return { notices: [] }; }),
      nz.runs ? Promise.resolve(nz.runs) : api("api/runs").then(function (r) { return r.runs || []; }).catch(function () { return []; }),
      loadContent().catch(function () { return null; }),
    ]).then(function (r) {
      var runs = r[1].length ? r[1] : (nz.runs || []);
      nz.runs = runs;
      /* 每个 run 的 step 完成时间：回放时 /api/status 会自动带上 asof，拿到的就是切面内的 */
      return Promise.all(runs.map(function (x) {
        return api("api/status?run=" + encodeURIComponent(x.key)).catch(function () { return null; });
      })).then(function (sts) {
        if (seq !== nz.seq) return;                 // 有更新的一次在路上，这次结果丢掉
        var timelines = {};
        runs.forEach(function (x, i) { timelines[x.key] = stepTimeline(sts[i]); });
        nz.data = {
          notices: (r[0].notices || []).slice().sort(function (a, b) { return b.t - a.t; }),
          runs: runs,
          timelines: timelines,
          zh: (r[2] && r[2].noticesZh) || {},
        };
        renderNoticesPanel();
      });
    });
  }

  function noticeItem(d, n) {
    var zh = nz.lang !== "en";
    var tr = zhOf(d, n);
    var body;
    if (zh && tr) {
      body = '<div class="mn-text">' + esc(tr.text) +
        (tr.stale ? ' <span class="mn-stale" title="' + T("写这条译文时的英文原文和现在这句不一样，可能已经过时") + '">' + T("原文已更新") + '</span>' : "") +
        "</div>" +
        (nz.para ? '<div class="mn-en">' + esc(n.text) + "</div>" : "");
    } else if (!zh) {
      body = '<div class="mn-text">' + esc(n.text) + "</div>";
    } else {
      body = '<div class="mn-text">' + esc(n.text) +
        ' <span class="mn-untranslated" title="' + T("content/notices.zh.json 里还没有这条的译文") + '">' + T("未翻译") + '</span></div>';
    }
    var badges = d.runs.map(function (r) {
      var s = stepAt(d.timelines[r.key] || [], n.t);
      var tip = T("{0}：这条公告发布时已完成 {1}", r.label || r.key, s == null ? T("0 步（还没开始）") : T("{0} 步", s));
      return '<span class="mn-badge" data-run="' + esc(r.key) + '" style="--mn-c:' + runColorAt(d.runs, r.key) +
        '" title="' + esc(tip) + '">' + esc(r.key) + "@" + (s == null ? "—" : "s" + s) + "</span>";
    }).join("");
    var u = utc(n.t), b = bj(n.t);
    return '<div class="mn-item" data-id="' + esc(n.id) + '" data-t="' + n.t + '">' +
      '<div class="mn-meta">' +
        '<span class="mn-date" title="' + esc(u) + '">' + esc(b.slice(5)) + T(" 北京") + "</span>" +
        '<span class="mn-utc">' + esc(u.slice(11, 16)) + "Z</span>" +
        (n.run ? '<span class="mn-for">' + esc(n.run) + T(" 专属") + "</span>" : "") +
        '<span class="mn-steps">' + badges + "</span>" +
      "</div>" + body + "</div>";
  }

  /* 滚动到底时去掉底部渐隐，别让最后一条看着像被切掉 */
  function updateFade(list) {
    if (!list) return;
    list.classList.toggle("mn-fade", list.scrollTop + list.clientHeight < list.scrollHeight - 4);
  }

  function renderNoticesPanel() {
    var d = nz.data, panel = nz.panel;
    if (!panel) return;
    if (!d || !d.notices.length) {          // 没公告就把原站那块露出来（它自己是空的）
      panel.classList.add("hidden");
      panel.innerHTML = "";
      if (nz.src) nz.src.classList.remove("mn-src-hidden");
      return;
    }
    if (nz.src) nz.src.classList.add("mn-src-hidden");
    panel.classList.remove("hidden");
    var zh = nz.lang !== "en";
    var shown = nz.expanded ? d.notices : d.notices.slice(0, nz.recent);
    var more = d.notices.length - shown.length;
    var locators = nz.locate ? d.runs.map(function (r) {
      var tl = d.timelines[r.key] || [];
      if (!tl.length) return "";
      /* 滑杆走的是"记录到的步"的下标，不是 1..N：早于第一份快照的步号没有完成时刻，
         放进去只会拖出一段没有对应公告的空档。 */
      var first = tl[0], last = tl[tl.length - 1];
      /* 当前位置存在 nz.pos 里，面板因为展开 / 切语言重画时不会跳回最新一步 */
      var moved = nz.pos[r.key] != null && nz.pos[r.key] < tl.length;
      var pos = moved ? nz.pos[r.key] : tl.length - 1;
      var at = tl[pos];
      return '<div class="mn-locate-row">' +
        '<span class="mn-run" title="' + esc(T("{0}：本地记录到的步范围 s{1}–s{2}", r.label || r.key, first.step, last.step)) + '">' +
          '<i class="swatch" style="background:' + runColorAt(d.runs, r.key) + '"></i>' + esc(r.label || r.key) + "</span>" +
        '<input class="mn-range" type="range" min="0" max="' + (tl.length - 1) + '" step="1" value="' + pos +
          '" data-run="' + esc(r.key) + '" title="' + T("拖到某一步，就滚到那一步完成前后的公告") + '">' +
        '<output class="mn-step" data-run="' + esc(r.key) + '">s' + at.step +
          (moved ? " · " + esc(utc(at.t).slice(5, 16)) : "") + "</output></div>";
    }).join("") : "";
    panel.innerHTML =
      '<article class="card mn-card">' +
        '<div class="card-head">' +
          '<div class="card-title">notices <span class="muted">' + d.notices.length + T(" 条 · 最新在上") + "</span></div>" +
          '<div class="mn-tools">' +
            '<button class="mn-locate-toggle' + (nz.locate ? " active" : "") +
              '" title="' + T("铺开按训练步定位公告的滑杆") + '">' + T("定位") + '</button>' +
            '<label class="check mn-para" title="' + T("中文下面同时显示英文原句，方便逐条核对译文") + '">' +
              '<input type="checkbox" class="mn-para-on"' + (nz.para ? " checked" : "") + "><span>" + T("对照原文") + "</span></label>" +
            '<div class="seg mn-lang">' +
              '<button data-lang="zh"' + (zh ? ' class="active"' : "") + ">" + T("中文") + "</button>" +
              '<button data-lang="en"' + (zh ? "" : ' class="active"') + ">" + T("原文") + "</button>" +
            "</div>" +
          "</div>" +
        "</div>" +
        (locators ? '<div class="mn-locate"><span class="mn-locate-hint">' + T("拖到某一步，定位那前后的公告") + '</span>' + locators + "</div>" : "") +
        '<div class="mn-list' + (nz.expanded ? " mn-scroll" : "") + '">' +
          shown.map(function (n) { return noticeItem(d, n); }).join("") +
        "</div>" +
        /* 页脚只在"还有更早的"时候出现。列表能不能滚，看滚动条和底部渐隐就够了，
           再写一句"列表可滚动"是废话；条数标题上已经写了，也不用重复。 */
        (more > 0 || nz.expanded
          ? '<div class="mn-foot"><button class="mn-more">' +
              (nz.expanded ? T("收起，只看最近 {0} 条", nz.recent) : T("显示更早的 {0} 条", more)) +
            "</button></div>"
          : "") +
      "</article>";
    updateFade(panel.querySelector(".mn-list"));
  }

  /* 把某一步对应的那条公告滚到眼前。收到的是 timeline 下标 → 该步的完成时刻，
     再找时间上离它最近的那条公告；目标如果还在"收起"的那几条之外，先展开再滚。 */
  function locateStep(runKey, idx) {
    var d = nz.data, panel = nz.panel;
    if (!d || !panel) return;
    var x = (d.timelines[runKey] || [])[idx];
    var out = panel.querySelector('.mn-step[data-run="' + runKey + '"]');
    if (!x) { if (out) out.textContent = "—"; return; }
    nz.pos[runKey] = idx;
    if (out) out.textContent = "s" + x.step + " · " + utc(x.t).slice(5, 16);
    var best = null, bd = Infinity;
    d.notices.forEach(function (n) {
      var dd = Math.abs(n.t - x.t);
      if (dd < bd) { bd = dd; best = n; }
    });
    if (!best) return;
    var shown = nz.expanded ? d.notices : d.notices.slice(0, nz.recent);
    if (shown.indexOf(best) < 0) {
      nz.expanded = true;
      saveNoticesPrefs();
      renderNoticesPanel();
    }
    highlightNotice(best.id);
  }

  function highlightNotice(id) {
    var panel = nz.panel;
    if (!panel) return;
    var items = Array.prototype.slice.call(panel.querySelectorAll(".mn-item"));
    items.forEach(function (el) { el.classList.remove("mn-hit"); });
    var hit = null;
    for (var i = 0; i < items.length; i++) if (items[i].dataset.id === id) { hit = items[i]; break; }
    if (!hit) return;
    hit.classList.add("mn-hit");
    /* 用 rect 差算滚动量：offsetTop 的参照物是最近的定位祖先，跟滚动容器不一定同一个。 */
    var list = panel.querySelector(".mn-list");
    if (list) {
      var lr = list.getBoundingClientRect(), br = hit.getBoundingClientRect();
      list.scrollTop = Math.max(0, list.scrollTop + (br.top - lr.top) - 8);
      updateFade(list);
    }
  }

  function buildNoticesPanel() {
    var panel = document.createElement("div");
    panel.id = "telemetry-notices";
    panel.className = "mn-wrap";
    panel.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest(".mn-lang button");
      if (b) {
        nz.lang = b.dataset.lang === "en" ? "en" : "zh";
        saveNoticesPrefs();
        renderNoticesPanel();
        return;
      }
      if (t.closest(".mn-more")) {
        nz.expanded = !nz.expanded;
        saveNoticesPrefs();
        renderNoticesPanel();
        return;
      }
      if (t.closest(".mn-locate-toggle")) {
        nz.locate = !nz.locate;
        saveNoticesPrefs();
        renderNoticesPanel();
      }
    });
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("mn-para-on")) {
        nz.para = !!t.checked;
        saveNoticesPrefs();
        renderNoticesPanel();
      }
    });
    panel.addEventListener("input", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("mn-range")) locateStep(t.dataset.run, Number(t.value));
    });
    /* scroll 不冒泡，用捕获阶段接住列表的滚动，好把底部渐隐收掉 */
    panel.addEventListener("scroll", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("mn-list")) updateFade(t);
    }, true);
    return panel;
  }

  function refreshNoticesSoon() {
    if (nz.timer) clearTimeout(nz.timer);
    nz.timer = setTimeout(function () { nz.timer = null; loadNoticesData(); }, 120);
  }

  /* #notices 会被 app.js 整块重建（换视图、换回放切面、数据版本变化），
     所以这里每次都对一遍：面板没了就补，节点换了就重新挂观察器并重取数据。 */
  function ensureNoticesPanel() {
    var src = document.getElementById("notices");
    if (!src || !src.parentNode) return;
    var panel = document.getElementById("telemetry-notices");
    if (!panel) {
      panel = buildNoticesPanel();
      src.parentNode.insertBefore(panel, src.nextSibling);
    }
    nz.panel = panel;
    if (nz.src !== src) {
      if (nz.obs) nz.obs.disconnect();
      nz.src = src;
      nz.obs = new MutationObserver(refreshNoticesSoon);
      nz.obs.observe(src, { childList: true });
      if (!panel.innerHTML) panel.innerHTML = '<article class="card mn-card"><div class="muted">' + T("正在读公告…") + '</div></article>';
      refreshNoticesSoon();
    }
  }

  // ------------------------------------------------------------------ 界面
  var el = {};

  function buildUI() {
    var dock = document.createElement("div");
    dock.className = "telemetry-dock";
    dock.innerHTML =
      '<button class="telemetry-btn" id="telemetry-toggle" title="' + T("按时间切面查看历史数据；再点一次回到实时") + '">' + T("回放") + '</button>' +
      '<button class="telemetry-btn ghost" id="telemetry-doc-btn" title="' + T("指标解读与数据洞察") + '">' + T("解读") + '</button>' +
      '<button class="telemetry-btn" id="telemetry-sync-btn" title="' + T("图表联动：在任意图表上点某一步，所有图表都跳到同一步；再点一次关闭") + '">' + T("联动") + '</button>' +
      '<a class="telemetry-btn ghost" id="telemetry-offline" hidden>' + T("离线副本") + '</a>';
    var bar = document.createElement("div");
    bar.className = "telemetry-bar hidden expanded";
    bar.id = "telemetry-bar";
    bar.innerHTML =
      '<div class="wrap telemetry-inner">' +
        '<span class="telemetry-badge">' + T("回放") + '</span>' +
        '<button class="telemetry-ico" id="telemetry-prev" title="' + T("上一个切面（快捷键 [）") + '">‹</button>' +
        '<input class="telemetry-range" id="telemetry-range" type="range" min="0" max="0" step="1" value="0">' +
        '<button class="telemetry-ico" id="telemetry-next" title="' + T("下一个切面（快捷键 ]）") + '">›</button>' +
        '<button class="telemetry-ico" id="telemetry-play" title="' + T("自动播放") + '">▶</button>' +
        '<span class="telemetry-when" id="telemetry-when">—</span>' +
        '<span class="telemetry-spacer"></span>' +
        '<button class="telemetry-btn small" id="telemetry-view" title="' + T("切换切面明细 / 该切面的原始看板") + '">' + T("看板") + '</button>' +
        '<button class="telemetry-btn small" id="telemetry-exit">' + T("回到实时") + '</button>' +
      '</div>' +
      '<div class="wrap telemetry-panel" id="telemetry-panel"></div>';
    var nav = document.querySelector("header.nav");
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);

    var navRight = document.querySelector(".nav-right");
    if (navRight) navRight.insertBefore(dock, navRight.firstChild);
    else document.body.appendChild(dock);

    el.toggle = document.getElementById("telemetry-toggle");
    el.bar = document.getElementById("telemetry-bar");
    el.range = document.getElementById("telemetry-range");
    el.when = document.getElementById("telemetry-when");
    el.panel = document.getElementById("telemetry-panel");
    el.play = document.getElementById("telemetry-play");
    el.offline = document.getElementById("telemetry-offline");
    el.view = document.getElementById("telemetry-view");

    if (BUNDLE) {
      el.offline.hidden = false;
      el.offline.textContent = T("离线副本 · {0}", utc(BUNDLE.generated_at).slice(0, 16));
    }

    el.toggle.addEventListener("click", function () { if (state.on) exitReplay(); else enterReplay(); });
    document.getElementById("telemetry-doc-btn").addEventListener("click", function () { openDoc("metrics"); });
    document.getElementById("telemetry-sync-btn").addEventListener("click", function () { setSyncOn(!sync.on); });
    document.getElementById("telemetry-exit").addEventListener("click", exitReplay);
    document.getElementById("telemetry-prev").addEventListener("click", function () { goto(state.index - 1); });
    document.getElementById("telemetry-next").addEventListener("click", function () { goto(state.index + 1); });
    el.play.addEventListener("click", togglePlay);
    el.view.addEventListener("click", function () { setExpanded(!state.expanded); });
    el.range.addEventListener("input", function () { goto(Number(el.range.value), true); });
    document.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "[") goto(state.index - 1);
      else if (e.key === "]") goto(state.index + 1);
      else if (e.key === "Escape" && state.expanded) setExpanded(false);
    });
  }

  function setBarVisible(on) {
    state.on = on;
    el.bar.classList.toggle("hidden", !on);
    document.body.classList.toggle("telemetry-replaying", on);
    el.toggle.classList.toggle("active", on);
    el.toggle.textContent = on ? T("回放中") : T("回放");
    el.toggle.title = on ? T("点一下回到实时数据") : T("按时间切面查看历史数据");
  }

  /* 明细面板展开时占满整屏（导航以下都是它），收起时只留一条工具条，
     下面的原看板就露出来显示这个切面。默认展开——进回放本来就是为了看历史数据。 */
  function setExpanded(on) {
    state.expanded = on;
    el.bar.classList.toggle("expanded", on);
    document.body.classList.toggle("telemetry-fullscreen", on);
    el.view.textContent = on ? T("看板") : T("明细");
    el.view.title = on ? T("收起明细，看这个切面的原始看板") : T("全屏展开切面明细");
    if (on) renderSlice(state.slices[state.index], state.index);
  }

  async function loadSlices() {
    var t = await api("api/telemetry/timeline");
    // 两个 run 的同步点合起来作为可选切面；同一轮同步只算一个切面
    var byCaptured = {};
    (t.syncs || []).forEach(function (s) {
      if (!s.sid) return;
      byCaptured[s.captured] = { captured: s.captured, source: s.source, runs: {} };
    });
    Object.keys(t.runs || {}).forEach(function (run) {
      t.runs[run].forEach(function (row) {
        if (!byCaptured[row.captured]) return;
        byCaptured[row.captured].runs[run] = row;
      });
    });
    state.slices = Object.keys(byCaptured).map(function (k) { return byCaptured[k]; })
      .sort(function (a, b) { return a.captured - b.captured; });
    return state.slices;
  }

  async function enterReplay() {
    if (!el.bar) buildUIOnce();
    setBarVisible(true);
    if (!state.slices.length) {
      el.panel.innerHTML = '<div class="mp-empty">' + T("正在读取本地仓库……") + '</div>';
      try { await loadSlices(); } catch (e) { el.panel.innerHTML = '<div class="mp-empty">' + T("读不到时间轴：{0}", e.message) + "</div>"; return; }
    }
    el.range.max = String(Math.max(0, state.slices.length - 1));
    /* 没带 asof 就从最新一个切面开始；带了 asof 就落在那之前最近的一个切面上。
       注意带 asof 时默认值要取 0（最早），不能沿用"最新"——URL 上的切面比本地
       最早的同步点还早时，循环一次都命中不了，会一路滑到最新，正好是反的。 */
    var idx = state.asof == null ? state.slices.length - 1 : 0;
    if (state.asof != null) {
      for (var i = 0; i < state.slices.length; i++) if (state.slices[i].captured <= state.asof) idx = i;
    }
    setExpanded(true);
    await goto(idx);
  }

  function exitReplay() {
    stopPlay();
    state.asof = null;
    setBarVisible(false);
    setUrl(null);
    if (app) app.refresh();
  }

  function goto(i, fromInput) {
    if (!state.slices.length) return;
    i = Math.max(0, Math.min(state.slices.length - 1, i));
    state.index = i;
    var s = state.slices[i];
    state.asof = s.captured;
    if (!fromInput) el.range.value = String(i);
    setUrl(s.captured);
    renderSlice(s, i);
    if (app) app.refresh();
  }

  function togglePlay() {
    if (state.playing) return stopPlay();
    state.playing = true;
    el.play.textContent = "❚❚";
    state.timer = setInterval(function () {
      if (state.index >= state.slices.length - 1) return stopPlay();
      goto(state.index + 1);
    }, 900);
  }
  function stopPlay() {
    state.playing = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (el.play) el.play.textContent = "▶";
  }

  // ------------------------------------------------------------ 切面面板
  async function renderSlice(slice, i) {
    var prev = i > 0 ? state.slices[i - 1] : null;
    el.when.innerHTML =
      T("第 {0}/{1} 个切面 · {2}", i + 1, state.slices.length, esc(utc(slice.captured))) +
      ' <span class="mp-bj">' + T("北京 {0}", esc(bj(slice.captured).slice(5))) + "</span>";

    var summary, notices, bench;
    try {
      var r = await Promise.all([api("api/telemetry/summary"), api("api/notices"), api("api/benchmarks")]);
      summary = r[0]; notices = r[1].notices || []; bench = r[2].benchmarks || [];
    } catch (e) {
      if (i === state.index) el.panel.innerHTML = '<div class="mp-empty">' + T("读取切面失败：{0}", e.message) + "</div>";
      return;
    }
    /* 切面面板的渲染是异步的，而 enterReplay 会先 setExpanded() 再 goto()：
       两次 renderSlice 并发跑（第一次还带着 asof=null 的实时请求），谁后到谁覆盖 DOM。
       滑块停在最后一个切面、面板却显示第一个切面的时间戳 + 实时数据，就是这么来的。
       只让"当前选中的那个切面"写 DOM，晚到的旧渲染直接丢掉。 */
    if (i !== state.index) return;

    var tag = (summary.runs.pro || summary.runs.flash || {}).headline_tag || "dynsam/avg@n";
    var seriesByRun = {};
    try {
      var got = await Promise.all(Object.keys(summary.runs).map(function (run) {
        return api("api/series?run=" + run + "&tags=" + encodeURIComponent(tag));
      }));
      Object.keys(summary.runs).forEach(function (run, k) { seriesByRun[run] = got[k]; });
    } catch (e) { /* 表格拿不到就不显示表格 */ }

    var cards = Object.keys(summary.runs).map(function (run) {
      var s = summary.runs[run];
      var p = prev && prev.runs[run] ? prev.runs[run].step : null;
      var dStep = p != null && s.step != null ? s.step - p : null;
      return '<article class="mp-card">' +
        '<div class="mp-card-head"><span class="mp-run">' + esc(s.label) + "</span>" +
        '<span class="mp-step">step ' + (s.step == null ? "—" : s.step) + "</span>" +
        (dStep ? '<span class="mp-delta">' + T("本切面 +{0} 步", dStep) + "</span>" : "") + "</div>" +
        '<div class="mp-kv">' +
          "<div><span>" + T("主指标 {0}", esc(tag.split("/").pop())) + "</span><b>" + num(s.headline) + "</b></div>" +
          "<div><span>" + T("累计成本") + "</span><b>" + money(s.cost) + "</b></div>" +
          "<div><span>" + T("累计 token") + "</span><b>" + compact(s.tokens_cum) + "</b></div>" +
          "<div><span>" + T("阶段") + "</span><b>" + esc(s.phase || "—") + "</b></div>" +
          "<div><span>" + T("重启次数") + "</span><b>" + (s.restarts == null ? "—" : s.restarts) + "</b></div>" +
          "<div><span>" + T("接口版本") + "</span><b class='mono small'>" + esc(s.version || "—") + "</b></div>" +
        "</div></article>";
    }).join("");

    var tables = Object.keys(seriesByRun).map(function (run) {
      var d = seriesByRun[run];
      var vals = d.series[tag] || [];
      var rows = d.steps.slice().reverse().map(function (st, k) {
        var idx = d.steps.length - 1 - k;
        var v = vals[idx];
        var pv = idx > 0 ? vals[idx - 1] : null;
        var dv = v != null && pv != null ? v - pv : null;
        return "<tr><td class='mono'>" + st + "</td><td class='mono dim'>" + esc(utc(d.walls[idx]).slice(0, 16)) + "</td>" +
          "<td class='mono'>" + num(v) + "</td>" +
          "<td class='mono " + (dv == null ? "" : dv > 0 ? "up" : dv < 0 ? "down" : "") + "'>" +
          (dv == null ? "—" : (dv > 0 ? "▲" : dv < 0 ? "▼" : "") + Math.abs(dv).toFixed(3)) + "</td></tr>";
      }).join("");
      return '<div class="mp-table-wrap"><div class="mp-table-title">' + esc(run) + T(" · 该切面已完成的步") + '</div>' +
        "<table class='mp-table'><thead><tr><th>step</th><th>" + T("完成时刻 (UTC)") + "</th><th>" + esc(tag.split("/").pop()) +
        "</th><th>" + T("较上一步") + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
    }).join("");

    var noticeHtml = notices.length
      ? notices.slice(0, 6).map(function (n) {
          return '<div class="mp-notice"><span class="mono dim">' + esc(utc(n.t).slice(0, 16)) + "</span> " + esc(n.text) + "</div>";
        }).join("")
      : '<div class="mp-muted">' + T("这一时刻还没有公告") + "</div>";

    var benchHtml = bench.length
      ? bench.map(function (b) {
          var cells = Object.keys(b.results).map(function (r) {
            var ks = Object.keys(b.results[r]).map(Number).sort(function (a, c) { return a - c; });
            var last = ks.length ? ks[ks.length - 1] : null;
            return "<div><span>" + esc(r) + "</span><b>" + (last == null ? "—" : num(b.results[r][String(last)], 2)) +
              " <i class='mp-muted'>@s" + last + "</i></b></div>";
          }).join("");
          return '<div class="mp-bench"><div class="mp-bench-title">' + esc(b.title) + "</div><div class='mp-kv'>" + cells + "</div></div>";
        }).join("")
      : '<div class="mp-muted">' + T("这一时刻还没有评测成绩") + "</div>";

    var stepTotal = Object.keys(summary.runs).map(function (r) { return summary.runs[r].steps_total; })
      .filter(function (n) { return n != null; });
    var head =
      '<div class="mp-head">' +
        "<div><div class='mp-title'>" + T("时间切面 · {0}", esc(utc(slice.captured))) + "</div>" +
        '<div class="mp-sub">' + T("北京时间 {0}", esc(bj(slice.captured))) +
        " · " + T("第 {0}/{1} 个同步点", i + 1, state.slices.length) +
        " · " + T("来源：{0}", slice.source === "bootstrap" ? T("导入自历史快照") : T("本机在线同步")) +
        (prev ? " · " + T("比上一个切面晚 {0}", dur(slice.captured - prev.captured)) : "") + "</div></div>" +
        "<div class='mp-head-note'>" + T("这是本地仓库按时间切出来的视图，原站只能看当前状态。") + "<br>" +
        T("每个切面只包含那一刻之前完成的训练步") +
        (stepTotal.length ? T("（最多 {0} 步）", Math.max.apply(null, stepTotal)) : "") + T("。") + "</div>" +
      "</div>";

    el.panel.innerHTML =
      head +
      '<div class="mp-runs">' + cards + "</div>" +
      '<div class="mp-cols">' + tables + "</div>" +
      '<div class="mp-cols">' +
        '<div class="mp-block"><div class="mp-table-title">' + T("该时刻已发布的公告 · {0} 条", notices.length) + "</div>" + noticeHtml + "</div>" +
        '<div class="mp-block"><div class="mp-table-title">' + T("该时刻已发布的评测") + "</div>" + benchHtml + "</div>" +
      "</div>";
  }

  /* 面板是动态插进来的，第一次进入回放时补建（DOM 此时肯定已经就绪）。 */
  var uiBuilt = false;
  function buildUIOnce() {
    if (uiBuilt) return;
    uiBuilt = true;
    buildUI();
  }

  /* ==================================================================
   * 自定义看板（本地新增，原站没有）
   *
   * 原站首页那批图是站点写死的（/runs 的 pins，18 张）。这里让读者自己攒：
   *   · metrics 页每张图卡左上角一个勾选框，批量勾完「加入看板」
   *   · overview 图表区上面一排 Tab，一个 Tab 一组图，可新建 / 重命名 / 删除
   *   · Tab 右边的「编辑」是批量勾选弹窗：分组浏览、搜索、一键清空
   *   · 「默认」Tab = 站点固定那批，不参与编辑
   *
   * 实现上完全不碰 app.js 的渲染逻辑：切 Tab 就是换 S.cfg.pins 再让它重画一遍，
   * 所以图表、悬浮十字线、值列、图表联动、点标题看解读这些能力全都自动继承。
   * 看板存在 localStorage 的 telemetry.boards 里 —— 这是"我这台机器上想看什么"，
   * 不属于站点数据，所以不写进仓库；离线副本（file://）一样能用。
   * ================================================================== */

  var BOARDS_KEY = "telemetry.boards";
  var boards = { active: "default", list: [] };   // list: [{id, name, tags: []}]
  var boardPins = null;                            // 站点固定那批图，第一次注入时抓下来
  var pick = {};                                   // metrics 页勾选：tag -> true
  var boardEdit = { open: false, id: null, q: "", only: false };  // 批量勾选弹窗的状态
  var boardTimer = null;
  var boardPop = null;
  var toastTimer = null;
  var boardTagsCache = { state: "idle", list: [], p: null };

  function boardById(id) {
    for (var i = 0; i < boards.list.length; i++) if (boards.list[i].id === id) return boards.list[i];
    return null;
  }
  function activeBoard() { return boardById(boards.active); }

  /* /runs 的响应里带着首页固定的图表集合（pins）。这里做两件事：
     1. 抄一份原值 —— 自定义看板会把 app.js 那份改写，改完就拿不回"默认"了；
     2. 当前开着自定义 Tab 的话，直接把响应里的 pins 换掉 —— 否则首屏先画站点那批图再替换，会闪一下。
     必须在 app.js 第一次取 /runs 之前就知道 active 是哪个，所以 loadBoards() 在脚本求值时就调，
     不能等 DOMContentLoaded。 */
  function patchRunsBody(body) {
    if (!body) return body;
    noteSitePins(body);
    var b = activeBoard();
    if (!b) return body;
    return Object.assign({}, body, { pins: b.tags.slice() });
  }

  function loadBoards() {
    try {
      var raw = JSON.parse(localStorage.getItem(BOARDS_KEY) || "null");
      if (raw && raw.list instanceof Array) {
        boards.list = raw.list
          .filter(function (b) { return b && b.id && b.name && b.tags instanceof Array; })
          .map(function (b) { return { id: String(b.id), name: String(b.name), tags: b.tags.map(String) }; });
        boards.active = (raw.active === "default" || boardById(raw.active)) ? raw.active : "default";
      }
    } catch (e) { /* 本地存的东西坏了就当没有，别让首页开不出来 */ }
  }
  function saveBoards() {
    try { localStorage.setItem(BOARDS_KEY, JSON.stringify({ active: boards.active, list: boards.list })); } catch (e) { }
  }
  loadBoards();   // 见 patchRunsBody 的注释：必须赶在 app.js 第一次取 /runs 之前

  /* 「默认」Tab 是站点固定那批图。它只在 /api/runs 的原始响应里有：
     S.cfg.pins 会被自定义看板改写，改完就再也拿不回原值，所以这里趁响应刚到就留一份。 */
  function noteSitePins(body) {
    if (boardPins) return;
    if (body && body.pins instanceof Array && body.pins.length) boardPins = body.pins.slice();
  }
  function sitePins() {
    /* 兜底：万一响应还没经过上面那条路（比如直接调 bundleApi），
       在没有自定义看板的情况下从 app.js 那儿抓一次；此时它还没被改写过。 */
    if (!boardPins && !activeBoard() && app && app.pins) {
      var p = app.pins();
      if (p && p.length) boardPins = p.slice();
    }
    return boardPins || [];
  }
  function sameTags(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  /** 把当前 Tab 的图表集合推给 app.js 并重画。集合没变就什么都不做（否则会和注入互相点火）。 */
  function applyBoard(force) {
    if (!app || !app.pins || !app.render) return Promise.resolve();
    var b = activeBoard();
    var want = b ? b.tags.slice() : sitePins();
    if (!force && sameTags(app.pins() || [], want)) return Promise.resolve();
    app.pins(want);
    /* 图表区已经渲染出来了就只换里面的图：整页重画会把文档高度瞬间清零，
       浏览器趁机把滚动位置夹回顶部，切 Tab 就成了"页面跳一下"。
       只有还没渲染过（刚开机、或视图没建）才走整页重画，并顺手把滚动位置还原。 */
    var grid = document.querySelector("#view-overview .chart-grid");
    if (grid && app.board) {
      app.board(grid, want.slice());
      ensureBoardEmpty(grid);
      return Promise.resolve();
    }
    var y = window.scrollY;
    return app.render().then(function () {
      if (y > 0 && window.scrollY < y - 4) window.scrollTo(0, y);
      setTimeout(function () { if (y > 0 && window.scrollY < y - 4) window.scrollTo(0, y); }, 80);
    });
  }
  function scheduleBoardApply() {
    clearTimeout(boardTimer);
    boardTimer = setTimeout(function () { boardTimer = null; applyBoard(true); }, 500);
  }

  /* ---------------------------------------------------------- Tab 栏（overview） */

  function ensureBoards() {
    var grid = document.querySelector("#view-overview .chart-grid");
    if (!grid) return;
    sitePins();                       // 顺手抓一份原始 pins
    var bar = document.getElementById("telemetry-boards");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "telemetry-boards";
      bar.id = "telemetry-boards";
      grid.parentNode.insertBefore(bar, grid);
      bar.addEventListener("click", onBoardBarClick);
      /* 刷新后如果上次选的是自定义 Tab，这里把它接上（集合一致时是空操作） */
      applyBoard(false);
    }
    renderBoardBar();
    ensureBoardEmpty(grid);
  }

  function renderBoardBar() {
    var bar = document.getElementById("telemetry-boards");
    if (!bar) return;
    var b = activeBoard();
    var chips = '<button class="mb-tab' + (b ? "" : " active") + '" data-board="default" title="' + T("站点固定的那批图") + '">' + T("默认") + '</button>';
    chips += boards.list.map(function (x) {
      return '<button class="mb-tab' + (b && b.id === x.id ? " active" : "") + '" data-board="' + esc(x.id) + '" title="' + esc(x.name) + " · " + T("{0} 张图", x.tags.length) + '">' +
        esc(x.name) + '<span class="mb-num">' + x.tags.length + "</span></button>";
    }).join("");
    chips += '<button class="mb-tab mb-new" data-act="new" title="' + T("新建一个 Tab") + '">' + T("＋ 新建 Tab") + '</button>';
    var n = b ? b.tags.length : sitePins().length;
    /* 只在内容真的变了才写 innerHTML：这个栏在 #main 里面，
       每次写都会触发注入用的 MutationObserver，不挡住就是自己点自己。 */
    var sig = boards.active + "|" + n + "|" +
      boards.list.map(function (x) { return x.id + ":" + x.name + ":" + x.tags.length; }).join(",");
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.innerHTML =
      '<span class="mb-label">' + T("自定义看板") + '</span><div class="mb-tabs" id="mb-tabs">' + chips + "</div>" +
      '<span class="mb-spacer"></span>' +
      '<span class="mb-count">' + (b ? T("本 Tab {0} 张图", n) : T("站点固定 {0} 张图", n)) + "</span>" +
      '<button class="mb-act" data-act="edit"' + (b ? "" : " disabled") +
        ' title="' + (b ? T("批量勾选这个 Tab 里的图表") : T("「默认」是站点固定的图，新建一个 Tab 才能编辑")) + '">' + T("编辑") + '</button>' +
      '<button class="mb-act" data-act="clear"' + (b && b.tags.length ? "" : " disabled") +
        ' title="' + T("清空这个 Tab（一键清除）") + '">' + T("清空") + '</button>';
  }

  /** 空 Tab 给一段引导，不然图表区是一片空白，看不出是"没选图"还是"坏了"。 */
  function ensureBoardEmpty(grid) {
    var b = activeBoard();
    var hint = grid.querySelector(".telemetry-board-empty");
    if (b && !b.tags.length) {
      if (!hint) {
        hint = document.createElement("div");
        hint.className = "telemetry-board-empty";
        hint.innerHTML = T("这个 Tab 还没有图表：去 {0} 页勾选后「加入看板」，或者点上面的「编辑」批量勾选。", '<a href="#metrics">metrics</a>') +
          '<br><span class="dim">' + T("「默认」Tab 里是站点固定的图，随时可以切回去。") + "</span>";
        grid.appendChild(hint);
      }
    } else if (hint) {
      hint.remove();
    }
  }

  function onBoardBarClick(e) {
    var chip = e.target.closest("[data-board]");
    if (chip) { switchBoard(chip.dataset.board); return; }
    var act = e.target.closest("[data-act]");
    if (!act) return;
    var what = act.dataset.act;
    if (what === "new") newBoardFlow(null, act);
    else if (what === "edit") openBoardEditor(boards.active);
    else if (what === "clear") clearBoard(boards.active);
  }

  function switchBoard(id) {
    if (id !== "default" && !boardById(id)) return;
    if (boards.active === id) return;
    boards.active = id;
    saveBoards();
    renderBoardBar();
    applyBoard(true);
  }

  function clearBoard(id) {
    var b = boardById(id);
    if (!b || !b.tags.length) return;
    if (!window.confirm(T("清空「{0}」里的 {1} 张图？", b.name, b.tags.length))) return;
    b.tags = [];
    saveBoards();
    renderBoardBar();
    if (boardEdit.open && boardEdit.id === id) renderBoardEditor();
    applyBoard(true).then(function () { toast(T("已清空「{0}」", b.name)); });
  }

  /** 新建 Tab：先问名字，再把（可选的）一批图表塞进去。 */
  function newBoardFlow(tags, anchor) {
    askName(anchor || document.getElementById("telemetry-boards") || document.body,
      T("新建 Tab 名称"), T("自定义 {0}", boards.list.length + 1), function (name) {
        if (!name) return;
        var b = { id: "b" + Date.now().toString(36) + (boards.list.length + 1), name: name, tags: (tags || []).slice() };
        boards.list.push(b);
        boards.active = b.id;
        saveBoards();
        renderBoardBar();
        applyBoard(true);
        if (tags && tags.length) {
          clearPick();   // 勾选的这批已经进看板了，清掉免得下次误加
          toast(T("已新建「{0}」并加入 {1} 张图", name, tags.length));
        } else {
          openBoardEditor(b.id);
        }
      });
  }

  /* --------------------------------------------------- 批量勾选弹窗（编辑看板） */

  function openBoardEditor(id) {
    var b = boardById(id || boards.active);
    if (!b) { toast(T("「默认」Tab 是站点固定的图，先新建一个 Tab 再编辑")); return; }
    if (doc.open) closeDoc();
    buildBoardEditor();
    boardEdit.open = true;
    boardEdit.id = b.id;
    boardEdit.q = "";
    boardEdit.only = false;
    var d = document.getElementById("telemetry-board-editor");
    d.classList.remove("hidden");
    document.body.classList.add("telemetry-doc-open");
    var box = document.getElementById("mb-q");
    if (box) box.value = "";
    renderBoardEditor();
    /* app.js 的 union 可能还没建好（刚开机就点编辑），自己补拉一次再重画 */
    loadAllTags().then(function () { if (boardEdit.open) renderBoardEditor(); }).catch(function () { });
  }

  function closeBoardEditor() {
    if (!boardEdit.open) return;
    boardEdit.open = false;
    var d = document.getElementById("telemetry-board-editor");
    if (d) d.classList.add("hidden");
    document.body.classList.remove("telemetry-doc-open");
    clearTimeout(boardTimer);
    boardTimer = null;
    applyBoard(true);           // 编辑过程里攒的改动一次推给首页
    renderBoardBar();
  }

  function buildBoardEditor() {
    if (document.getElementById("telemetry-board-editor")) return;
    var d = document.createElement("div");
    d.className = "telemetry-doc hidden";
    d.id = "telemetry-board-editor";
    d.innerHTML =
      '<div class="md-head"><div class="wrap md-head-inner">' +
        '<span class="md-brand">' + T("自定义看板") + '</span>' +
        '<input class="mb-name" id="mb-name" type="text" maxlength="24" title="' + T("Tab 名称，改完自动保存") + '">' +
        '<span class="mb-sel" id="mb-sel">' + T("0 张") + '</span>' +
        '<input class="md-search mb-search" id="mb-q" type="search" placeholder="' + T("搜索指标名") + '">' +
        '<button class="telemetry-btn small" id="mb-only" title="' + T("只看已经勾上的") + '">' + T("只看已选") + '</button>' +
        '<button class="telemetry-btn small" id="mb-clearall" title="' + T("一键清除这个 Tab 的全部图表") + '">' + T("清空全部") + '</button>' +
        '<button class="telemetry-btn small" id="mb-done">' + T("完成") + '</button>' +
        '<button class="telemetry-ico" id="mb-del" title="' + T("删除这个 Tab") + '">🗑</button>' +
        '<button class="telemetry-ico" id="mb-x" title="' + T("关闭（Esc）") + '">✕</button>' +
      "</div></div>" +
      '<div class="wrap md-body"><aside class="md-side" id="mb-side"></aside><main class="md-main" id="mb-main"></main></div>';
    document.body.appendChild(d);

    document.getElementById("mb-x").addEventListener("click", closeBoardEditor);
    document.getElementById("mb-done").addEventListener("click", closeBoardEditor);
    document.getElementById("mb-del").addEventListener("click", deleteEditingBoard);
    document.getElementById("mb-clearall").addEventListener("click", function () { clearBoard(boardEdit.id); });
    document.getElementById("mb-only").addEventListener("click", function () {
      boardEdit.only = !boardEdit.only;
      this.classList.toggle("active", boardEdit.only);
      renderBoardEditor();
    });
    document.getElementById("mb-name").addEventListener("input", function () {
      var b = boardById(boardEdit.id);
      if (!b) return;
      b.name = this.value.trim() || b.name;
      saveBoards();
      renderBoardBar();
    });
    var q = document.getElementById("mb-q");
    var qt = null;
    q.addEventListener("input", function () {
      clearTimeout(qt);
      qt = setTimeout(function () { boardEdit.q = q.value.trim().toLowerCase(); renderBoardEditor(); }, 120);
    });
    document.getElementById("mb-main").addEventListener("change", function (e) {
      var box = e.target;
      if (!box.classList || !box.classList.contains("mb-box")) return;
      toggleBoardTag(box.dataset.tag, box.checked);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && boardEdit.open) { closeBoardEditor(); e.stopPropagation(); }
    }, true);
  }

  function deleteEditingBoard() {
    var b = boardById(boardEdit.id);
    if (!b) return;
    if (!window.confirm(T("删除 Tab「{0}」？里面的图表选择会一起丢掉。", b.name))) return;
    boards.list = boards.list.filter(function (x) { return x.id !== b.id; });
    if (boards.active === b.id) boards.active = "default";
    boardEdit.id = boards.active;
    saveBoards();
    renderBoardBar();
    applyBoard(true);
    if (boardById(boardEdit.id)) renderBoardEditor();
    else closeBoardEditor();
    toast(T("已删除「{0}」", b.name));
  }

  function toggleBoardTag(tag, on) {
    var b = boardById(boardEdit.id);
    if (!b) return;
    if (on) {
      if (b.tags.indexOf(tag) < 0) b.tags.push(tag);
    } else {
      b.tags = b.tags.filter(function (t) { return t !== tag; });
    }
    saveBoards();
    updateBoardCounts();
    if (boards.active === b.id) scheduleBoardApply();
  }

  /** 勾选只更新计数，不重画列表 —— 重画会把 <details> 的展开状态和滚动位置冲掉。 */
  function updateBoardCounts() {
    var b = boardById(boardEdit.id);
    if (!b) return;
    var sel = document.getElementById("mb-sel");
    if (sel) sel.textContent = T("{0} 张", b.tags.length);
    var total = document.getElementById("mb-total");
    if (total) total.textContent = b.tags.length;
    var groups = document.querySelectorAll("#mb-main .mb-group");
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var tags = (g.dataset.group ? groupTags(g.dataset.group) : []);
      var n = tags.filter(function (t) { return b.tags.indexOf(t) >= 0; }).length;
      var badge = g.querySelector(".mb-gcount");
      if (badge) badge.textContent = n ? n + " / " + tags.length : String(tags.length);
      g.classList.toggle("has-sel", n > 0);
    }
    var side = document.querySelectorAll("#mb-side [data-side]");
    for (var j = 0; j < side.length; j++) {
      var key = side[j].dataset.side;
      var list = key === "" ? availableTags() : groupTags(key);
      var m = list.filter(function (t) { return b.tags.indexOf(t) >= 0; }).length;
      var c = side[j].querySelector(".md-cnt");
      if (c) c.textContent = m ? m + " / " + list.length : String(list.length);
      side[j].classList.toggle("has-sel", m > 0);
    }
  }

  function groupTags(prefix) {
    return availableTags().filter(function (t) { return t.split("/")[0] === prefix; });
  }

  /** 所有指标名。app.js 的 union 是现成的；还没建好就自己按 run 拉一次。 */
  function loadAllTags() {
    if (boardTagsCache.state === "done") return Promise.resolve(boardTagsCache.list);
    if (boardTagsCache.state === "loading") return boardTagsCache.p;
    boardTagsCache.state = "loading";
    boardTagsCache.p = api("api/runs").then(function (cfg) {
      var runs = (cfg && cfg.runs) || [];
      return Promise.all(runs.map(function (r) {
        return api("api/tags?run=" + encodeURIComponent(r.key)).catch(function () { return { tags: [] }; });
      }));
    }).then(function (rows) {
      var set = {};
      rows.forEach(function (r) { (r.tags || []).forEach(function (t) { set[t] = 1; }); });
      boardTagsCache.list = Object.keys(set).sort();
      boardTagsCache.state = "done";
      return boardTagsCache.list;
    }).catch(function (e) {
      boardTagsCache.state = "idle";
      throw e;
    });
    return boardTagsCache.p;
  }
  function availableTags() {
    var u = (app && app.union) ? app.union() : null;
    if (u && u.length) return u;
    if (!boardTagsCache.list.length) loadAllTags().then(function () { if (boardEdit.open) renderBoardEditor(); }).catch(function () { });
    return boardTagsCache.list;
  }

  function tagDim(tag) {
    var i = tag.lastIndexOf("/");
    if (i < 0) return esc(tag);
    return '<span class="dim">' + esc(tag.slice(0, i + 1)) + "</span>" + esc(tag.slice(i + 1));
  }

  function renderBoardEditor() {
    var b = boardById(boardEdit.id);
    if (!b) return;
    var name = document.getElementById("mb-name");
    if (name && name.value !== b.name) name.value = b.name;
    var sel = document.getElementById("mb-sel");
    if (sel) sel.textContent = T("{0} 张", b.tags.length);

    var tags = availableTags();
    var q = boardEdit.q;
    var hit = q ? tags.filter(function (t) { return t.toLowerCase().indexOf(q) >= 0; })
      : (boardEdit.only ? b.tags.slice() : tags);
    /* 侧栏：全部 + 各分组（分组 = 第一段路径），带"已选 / 总数" */
    var counts = {};
    tags.forEach(function (t) { var g = t.split("/")[0]; counts[g] = (counts[g] || 0) + 1; });
    var side = document.getElementById("mb-side");
    if (side) {
      var keys = Object.keys(counts).sort();
      side.innerHTML = '<div class="md-side-title">' + T("分组") + '</div>' +
        '<button class="md-side-item" data-side="">' + T("全部") + '<span class="md-cnt">' + tags.length + "</span></button>" +
        keys.map(function (k) {
          var n = groupTags(k).filter(function (t) { return b.tags.indexOf(t) >= 0; }).length;
          return '<button class="md-side-item" data-side="' + esc(k) + '">' + esc(k) +
            '<span class="md-cnt">' + (n ? n + " / " + counts[k] : counts[k]) + "</span></button>";
        }).join("") +
        '<div class="md-side-note"><p>' + T("已选 {0} 张。勾选即时保存，回到 overview 就是新的一组图；「默认」Tab 不受影响。", '<b id="mb-total">' + b.tags.length + "</b>") + "</p>" +
        '<p>' + T("这个 Tab 里站点没有的指标会标出来，多半是站点改了指标名。") + "</p></div>";
      side.querySelectorAll("[data-side]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var key = btn.dataset.side;
          if (!key) { boardEdit.q = ""; boardEdit.only = false; var box = document.getElementById("mb-q"); if (box) box.value = ""; document.getElementById("mb-only").classList.remove("active"); renderBoardEditor(); return; }
          var el = document.querySelector('#mb-main .mb-group[data-group="' + cssq(key) + '"]');
          if (el) { el.open = true; el.scrollIntoView({ block: "start" }); }
        });
      });
    }
    /* 正文 */
    var main = document.getElementById("mb-main");
    if (!main) return;
    var known = {};
    tags.forEach(function (t) { known[t] = 1; });
    var head = '<div class="md-count">' + (q ? T("{0} 个指标匹配「{1}」", hit.length, esc(boardEdit.q))
      : boardEdit.only ? T("只看已选 · {0} 张", b.tags.length)
        : boardEdit.only ? "" : T("{0} 个指标，按分组折叠", tags.length)) + "</div>";
    if (!hit.length) {
      main.innerHTML = head + '<div class="md-empty">' + T("没有匹配的指标。") + "</div>";
      return;
    }
    var rows = function (list, group) {
      return list.map(function (t) {
        var on = b.tags.indexOf(t) >= 0;
        return '<label class="mb-row' + (on ? " on" : "") + '">' +
          '<input type="checkbox" class="mb-box" data-tag="' + esc(t) + '"' + (on ? " checked" : "") + ">" +
          '<span class="mb-tag">' + tagDim(t) + "</span></label>";
      }).join("");
    };
    if (q || boardEdit.only) {
      /* 关键词很短时可能命中上千条，先画前 300 条：够挑就行，也免得一次插几千个节点 */
      var cap = 300;
      var shown = hit.slice(0, cap);
      main.innerHTML = head + '<div class="mb-list">' + rows(shown) + "</div>" +
        (hit.length > shown.length
          ? '<div class="md-count">' + T("还有 {0} 条没列出来，把关键词写具体一点", hit.length - shown.length) + "</div>"
          : "");
    } else {
      var byGroup = {};
      hit.forEach(function (t) { var g = t.split("/")[0]; (byGroup[g] = byGroup[g] || []).push(t); });
      main.innerHTML = head + Object.keys(byGroup).sort().map(function (g) {
        var list = byGroup[g];
        var n = list.filter(function (t) { return b.tags.indexOf(t) >= 0; }).length;
        return '<details class="mb-group' + (n ? " has-sel" : "") + '" data-group="' + esc(g) + '"' + (n ? " open" : "") + ">" +
          "<summary><span class=\"mb-gname\">" + esc(g) + "</span>" +
          '<span class="mb-gcount">' + (n ? n + " / " + list.length : String(list.length)) + "</span></summary>" +
          '<div class="mb-list">' + rows(list) + "</div></details>";
      }).join("");
      /* 看板里有、但站点已经没有的指标：单独列出来，让用户能删掉 */
      var missing = b.tags.filter(function (t) { return !known[t]; });
      if (missing.length) {
        main.innerHTML += '<details class="mb-group mb-missing" open>' +
          '<summary><span class="mb-gname">' + T("站点已没有这些指标") + '</span><span class="mb-gcount">' + missing.length + "</span></summary>" +
          '<div class="mb-list">' + rows(missing) + "</div></details>";
      }
    }
  }

  function cssq(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* ------------------------------------------------- metrics 页：批量勾选 + 浮动条 */

  function ensurePickBoxes() {
    var view = document.getElementById("view-metrics");
    if (!view) return;
    var cards = view.querySelectorAll(".chart-grid .chart-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.dataset.telemetryPick) continue;
      var tagEl = card.querySelector(".card-head .tag");
      var head = card.querySelector(".card-head");
      if (!tagEl || !head) continue;
      var tag = tagEl.getAttribute("title") || tagEl.textContent || "";
      card.dataset.telemetryPick = "1";
      var label = document.createElement("label");
      label.className = "telemetry-pick";
      label.title = T("勾选后可以批量加入自定义看板");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "telemetry-pick-box";
      box.dataset.pickTag = tag;
      box.checked = !!pick[tag];
      label.appendChild(box);
      head.insertBefore(label, head.firstChild);
    }
  }

  function ensurePickBar() {
    var view = document.getElementById("view-metrics");
    var bar = document.getElementById("telemetry-pickbar");
    var n = Object.keys(pick).length;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "telemetry-pickbar hidden";
      bar.id = "telemetry-pickbar";
      bar.innerHTML =
        '<span class="mp-count" id="mp-count">' + T("已选 {0} 个", 0) + '</span>' +
        '<button class="telemetry-btn small" data-pick="page" title="' + T("勾选本页所有图表") + '">' + T("全选本页") + '</button>' +
        '<button class="telemetry-btn small" data-pick="none">' + T("清空") + '</button>' +
        '<button class="telemetry-btn small mp-add" data-pick="add">' + T("加入看板 ▾") + '</button>';
      document.body.appendChild(bar);
      bar.addEventListener("click", onPickBarClick);
    }
    var show = !!(view && view.classList.contains("active") && n);
    if (bar.dataset.show !== String(!!show)) {
      bar.dataset.show = String(!!show);
      bar.classList.toggle("hidden", !show);
    }
    var c = document.getElementById("mp-count");
    var text = T("已选 {0} 个", n);
    if (c && c.textContent !== text) c.textContent = text;
  }

  function pickedTags() { return Object.keys(pick).sort(); }

  function onPickBarClick(e) {
    var btn = e.target.closest("[data-pick]");
    if (!btn) return;
    var what = btn.dataset.pick;
    if (what === "page") {
      var boxes = document.querySelectorAll("#view-metrics .telemetry-pick-box");
      for (var i = 0; i < boxes.length; i++) { boxes[i].checked = true; pick[boxes[i].dataset.pickTag] = true; }
      ensurePickBar();
      toast(T("已勾选本页 {0} 张", boxes.length));
    } else if (what === "none") {
      clearPick();
    } else if (what === "add") {
      openAddMenu(btn);
    }
  }

  function clearPick() {
    pick = {};
    var boxes = document.querySelectorAll(".telemetry-pick-box");
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    ensurePickBar();
  }

  function openAddMenu(anchor) {
    var tags = pickedTags();
    if (!tags.length) return;
    var box = document.createElement("div");
    box.className = "telemetry-ask";
    box.innerHTML = '<div class="ma-title">' + T("把 {0} 张图加入", tags.length) + "</div>";
    var list = document.createElement("div");
    list.className = "ma-list";
    boards.list.forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = "ma-item";
      btn.innerHTML = '<span class="ma-name">' + esc(b.name) + "</span><span class=\"md-cnt\">" + b.tags.length + "</span>";
      btn.addEventListener("click", function () { closePop(); addToBoard(b.id, tags); });
      list.appendChild(btn);
    });
    if (!boards.list.length) list.innerHTML = '<div class="ma-hint">' + T("还没有自定义 Tab，下面新建一个。") + "</div>";
    var mk = document.createElement("button");
    mk.className = "ma-item ma-new";
    mk.textContent = T("＋ 新建 Tab…");
    mk.addEventListener("click", function () { closePop(); newBoardFlow(tags, anchor); });
    list.appendChild(mk);
    box.appendChild(list);
    openPop(anchor, box);
  }

  function addToBoard(id, tags) {
    var b = boardById(id);
    if (!b) return;
    var added = 0;
    tags.forEach(function (t) { if (b.tags.indexOf(t) < 0) { b.tags.push(t); added++; } });
    saveBoards();
    renderBoardBar();
    clearPick();
    if (boards.active === b.id) {
      applyBoard(true).then(function () { toast(T("已加入「{0}」{1} 张（共 {2} 张）", b.name, added, b.tags.length)); });
    } else {
      toast(T("已加入「{0}」{1} 张（共 {2} 张）；切到该 Tab 可见", b.name, added, b.tags.length));
    }
  }

  /* -------------------------------------------------------- 小玩意：浮动框 / 提示 */

  function onPopDown(e) { if (boardPop && !boardPop.contains(e.target)) closePop(); }
  function closePop() {
    if (!boardPop) return;
    boardPop.remove();
    boardPop = null;
    document.removeEventListener("mousedown", onPopDown, true);
  }
  function openPop(anchor, node) {
    closePop();
    boardPop = document.createElement("div");
    boardPop.className = "telemetry-pop";
    boardPop.appendChild(node);
    document.body.appendChild(boardPop);
    var r = anchor.getBoundingClientRect();
    var w = boardPop.offsetWidth, h = boardPop.offsetHeight;
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    boardPop.style.top = Math.round(top) + "px";
    boardPop.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + "px";
    setTimeout(function () { document.addEventListener("mousedown", onPopDown, true); }, 0);
  }
  function askName(anchor, title, value, onOk) {
    var box = document.createElement("div");
    box.className = "telemetry-ask";
    box.innerHTML = '<div class="ma-title">' + esc(title) + "</div>";
    var input = document.createElement("input");
    input.className = "ma-input";
    input.type = "text";
    input.maxLength = 24;
    input.value = value || "";
    var row = document.createElement("div");
    row.className = "ma-row";
    var ok = document.createElement("button");
    ok.className = "telemetry-btn small"; ok.textContent = T("确定");
    var no = document.createElement("button");
    no.className = "telemetry-btn small telemetry-btn-ghost"; no.textContent = T("取消");
    row.append(ok, no);
    box.append(input, row);
    var submit = function () { var v = input.value.trim(); closePop(); onOk(v); };
    ok.addEventListener("click", submit);
    no.addEventListener("click", closePop);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.preventDefault(); closePop(); }
      e.stopPropagation();
    });
    openPop(anchor, box);
    setTimeout(function () { input.focus(); input.select(); }, 0);
  }
  function toast(msg) {
    var t = document.getElementById("telemetry-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "telemetry-toast";
      t.id = "telemetry-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  /* ==================================================================
   * 指标解读与数据洞察（本地新增，原站没有）
   *
   * content/metrics.json 和 content/insights.json 是手写的文档，跟着仓库走版本管理。
   * 这里提供两个入口，目的是让"看曲线"和"看懂曲线"在同一屏里完成：
   *   1. 点任意图表弹出的详情框里会补一段这个指标的解读（这正是用户在看的那个数）
   *   2. 导航上的"解读"按钮打开全屏文档，可以按分组浏览、搜索、互相跳转
   * ================================================================== */

  var content = null;                 // 当前语言的内容，其他地方直接读它
  var contentByLang = {};             // 语言 -> 已加载内容（按语言的记忆化）
  var contentLoadingByLang = {};      // 语言 -> 加载中的 Promise
  var metricIndex = {};
  var sourceUses = {};
  var doc = {
    built: false, open: false, tab: "metrics", group: null, q: "", kind: null, srcKind: null,
    item: null,        // 当前定位到的那一条（指标 id / 洞察 id / 材料 id），写进 URL
    returnHash: null,  // 打开面板之前的 hash，关掉时还回去
  };

  /* 反向索引：某个来源被哪些指标/洞察引用了、stance 是什么。溯源总览页签要用。 */
  function buildSourceUses() {
    sourceUses = {};
    var add = function (list, kindLabel) {
      (list || []).forEach(function (x) {
        (x.sources || []).forEach(function (s) {
          if (!s || !s.id) return;
          (sourceUses[s.id] || (sourceUses[s.id] = [])).push({
            id: x.id,
            name: x.name || x.title || x.id,
            kind: kindLabel,
            stance: s.stance || "context",
            note: s.note || "",
          });
        });
      });
    };
    add(content.metrics, T("指标"));
    add(content.insights, T("洞察"));
    Object.keys(sourceUses).forEach(function (k) {
      sourceUses[k].sort(function (a, b) { return a.id.localeCompare(b.id); });
    });
  }

  function loadContent() {
    var lang = contentLang();
    if (contentByLang[lang]) return Promise.resolve(contentByLang[lang]);
    if (contentLoadingByLang[lang]) return contentLoadingByLang[lang];
    contentLoadingByLang[lang] = api("api/content?lang=" + encodeURIComponent(lang)).then(function (c) {
      var built = {
        metrics: (c && c.metrics) || [],
        insights: (c && c.insights) || [],
        sources: (c && c.sources) || [],
        sourcesNote: (c && c.sources_note) || "",
        gaps: (c && c.sources_gaps) || [],
        window: (c && c.insights_window) || null,
        updated: (c && c.insights_updated_at) || null,
        /* notices 的中文译文：按公告 id 索引，overview 那块公告面板用它 */
        noticesZh: (c && c.notices_zh) || {},
      };
      contentByLang[lang] = built;
      content = built;
      metricIndex = {};
      built.metrics.forEach(function (m) { metricIndex[m.id] = m; });
      buildSourceUses();
      return built;
    }).catch(function (err) { contentLoadingByLang[lang] = null; throw err; });
    return contentLoadingByLang[lang];
  }

  /* 找某个 tag 的解读。有些解读是按"族"写的（一份覆盖一族 tag），所以精确匹配不到时
     把 tag 逐级泛化再找：纯数字段换成 <k>（partial/0/frac）、类目与数据集段换成占位
     （dynsam/code/dataset-yfch/...）。 */
  function lookupMetric(tag) {
    if (!tag) return null;
    if (metricIndex[tag]) return metricIndex[tag];
    var parts = tag.split("/");
    var forms = [];
    forms.push(parts.map(function (p) { return /^\d+$/.test(p) ? "<k>" : p; }).join("/"));
    if (parts.length > 3 && parts[0] === "dynsam" && /^dataset-/.test(parts[2])) {
      var g = parts.slice();
      g[1] = "<cat>"; g[2] = "dataset-<id>";
      forms.push(g.join("/"));
    }
    forms.push(tag.replace(/\/\d+$/, ""));
    for (var i = 0; i < forms.length; i++) if (metricIndex[forms[i]]) return metricIndex[forms[i]];
    return null;
  }

  /* 族级条目的 id 里带 <k>，不能直接拿去画图。 */
  function isLiteralTag(id) { return id && id.indexOf("<") < 0; }

  function mdList(arr, cls) {
    if (!arr || !arr.length) return "";
    return '<ul class="' + (cls || "") + '">' + arr.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }

  /* 材料类型 / 立场的显示名。注意：T() 必须等字典加载完再调，所以这里写成
     "按 kind 现取现译" 的函数，而不是在模块加载时就求值的常量表。 */
  function srcKindLabel(kind) {
    if (kind === "paper") return T("论文");
    if (kind === "blog") return T("博客");
    if (kind === "doc") return T("官方文档");
    if (kind === "report") return T("技术报告");
    if (kind === "self") return T("自有分析");
    if (kind === "data") return T("本站数据");
    return kind;
  }
  function srcStanceLabel(stance) {
    if (stance === "support") return T("支持");
    if (stance === "challenge") return T("存疑 · 边界");
    if (stance === "context") return T("背景");
    return stance;
  }

  /** 溯源依据：每条解读挂着的外部材料或自有分析，可折起来看详情。 */
  function sourcesHTML(m) {
    if (!m.sources || !m.sources.length) return "";
    var items = m.sources.map(function (s) {
      var head = s.url
        ? '<a class="md-src-title" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>"
        : '<span class="md-src-title">' + esc(s.title) + "</span>";
      var meta = [s.authors, s.venue, s.year].filter(Boolean).join(" · ");
      return '<li class="md-src-item">' +
        '<div class="md-src-head">' + head +
          '<span class="md-src-kind">' + esc(srcKindLabel(s.kind)) + "</span>" +
          '<span class="md-src-stance md-stance-' + esc(s.stance || "context") + '">' + esc(srcStanceLabel(s.stance)) + "</span>" +
        "</div>" +
        (meta ? '<div class="md-src-meta">' + esc(meta) + "</div>" : "") +
        (s.note ? '<p class="md-src-note">' + esc(s.note) + "</p>" : "") +
        (s.quote ? '<blockquote class="md-src-quote">' + esc(s.quote) + "</blockquote>" : "") +
        "</li>";
    }).join("");
    return '<details class="md-src"><summary>' + T("溯源依据 · {0} 条", m.sources.length) + "</summary>" +
      '<ul class="md-src-list">' + items + "</ul></details>";
  }

  /** 让搜索能命中来源标题和溯源说明。 */
  function srcText(m) {
    return (m.sources || []).map(function (s) { return (s.title || "") + " " + (s.note || ""); }).join(" ");
  }

  /** 指标解读的完整卡片。data-docid 是这条解读的逻辑 id，URL 定位和滚动监听都靠它。 */
  function metricCard(m) {
    /* table/ 开头的是"看板表格逐列解读"，没有对应的曲线，不画"看这条曲线"按钮。 */
    var chartable = isLiteralTag(m.id) && m.id.indexOf("table/") !== 0;
    return '<article class="md-card" id="md-' + esc(m.id.replace(/[^\w]+/g, "-")) + '" data-docid="' + esc(m.id) + '">' +
      '<div class="md-card-head">' +
        '<h3 data-doc-jump="1" title="' + T("点标题把这一条的地址钉住") + '">' + esc(m.name || m.id) + "</h3>" +
        '<div class="md-meta"><code class="mono">' + esc(m.id) + "</code>" +
        (m.unit ? '<span class="md-chip">' + esc(m.unit) + "</span>" : "") +
        '<span class="md-chip md-chip-group">' + esc(m.group || "") + "</span></div>" +
      "</div>" +
      '<div class="md-sec"><h4>' + T("它量的是什么") + '</h4><p>' + esc(m.what) + "</p></div>" +
      (m.how ? '<div class="md-sec"><h4>' + T("怎么算出来的") + '</h4><p>' + esc(m.how) + "</p></div>" : "") +
      (m.why ? '<div class="md-sec"><h4>' + T("为什么要盯它") + '</h4><p>' + esc(m.why) + "</p></div>" : "") +
      (m.read && m.read.length ? '<div class="md-sec"><h4>' + T("怎么读") + "</h4>" + mdList(m.read) + "</div>" : "") +
      (m.observed ? '<div class="md-sec md-obs"><h4>' + T("这一轮实测") + '</h4><p>' + esc(m.observed) + "</p></div>" : "") +
      (m.traps && m.traps.length ? '<div class="md-sec md-warn"><h4>' + T("容易读错的地方") + "</h4>" + mdList(m.traps) + "</div>" : "") +
      (m.table ? '<div class="md-sec"><h4>' + T("分数据源对照") + '</h4>' +
        '<div class="md-tbl-wrap"><table class="md-tbl"><caption>' + esc(m.table.caption || "") + "</caption><thead><tr>" +
        (m.table.head || []).map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
        "</tr></thead><tbody>" +
        (m.table.rows || []).map(function (r) {
          return "<tr>" + r.map(function (c, i) { return "<td" + (i ? ' class="mono"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div></div>" : "") +
      sourcesHTML(m) +
      ((m.related && m.related.length) || chartable
        ? '<div class="md-rel">' +
            (chartable ? '<button class="telemetry-btn small" data-chart="' + esc(m.id) + '">' + T("看这条曲线") + '</button>' : "") +
            (m.related || []).map(function (t) { return '<button class="md-relchip mono" data-metric="' + esc(t) + '">' + esc(t) + "</button>"; }).join("") +
          "</div>"
        : "") +
      "</article>";
  }

  function kindLabel(kind) {
    if (kind === "structural") return T("结构性事实");
    if (kind === "watch") return T("需要盯的");
    if (kind === "note") return T("说明");
    return kind;
  }

  /** 数据洞察的卡片。 */
  function insightCard(it) {
    return '<article class="md-card md-insight" id="md-' + esc(it.id) + '" data-docid="' + esc(it.id) + '">' +
      '<div class="md-card-head"><h3 data-doc-jump="1" title="' + T("点标题把这一条的地址钉住") + '">' + esc(it.title) + "</h3>" +
        '<div class="md-meta"><span class="md-chip md-chip-' + esc(it.kind) + '">' + esc(kindLabel(it.kind)) + "</span></div></div>" +
      '<p class="md-summary">' + esc(it.summary) + "</p>" +
      '<div class="md-sec">' + (it.body || []).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") + "</div>" +
      (it.facts && it.facts.length
        ? '<div class="md-sec"><h4>' + T("关键数字") + '</h4><table class="md-facts"><tbody>' +
            it.facts.map(function (f) {
              return "<tr><th>" + esc(f.label) + '</th><td class="mono">' + esc(f.value) + "</td><td>" + esc(f.note || "") + "</td></tr>";
            }).join("") + "</tbody></table></div>"
        : "") +
      (it.verify ? '<div class="md-sec md-obs"><h4>' + T("怎么自己复核") + '</h4><p>' + esc(it.verify) + "</p></div>" : "") +
      sourcesHTML(it) +
      (it.metrics && it.metrics.length
        ? '<div class="md-rel">' + it.metrics.map(function (t) {
            return '<button class="md-relchip mono" data-metric="' + esc(t) + '">' + esc(t) + "</button>";
          }).join("") + "</div>"
        : "") +
      "</article>";
  }

  function docCounts() {
    var byGroup = {};
    content.metrics.forEach(function (m) { byGroup[m.group || T("其他")] = (byGroup[m.group || T("其他")] || 0) + 1; });
    return byGroup;
  }

  /** 同一篇材料会被多处引用（每处摘不同原文），按 URL 去重才是"多少份材料"。 */
  function materials() {
    var m = {};
    content.sources.forEach(function (s) { m[s.url || "id:" + s.id] = 1; });
    return m;
  }

  /** 检索空白：没找到能验证对应读法的公开材料。写在页面上比藏着好。 */
  function gapCard(g, i) {    return '<article class="md-card md-gap" data-docid="' + esc("gap:" + i) + '">' +
      '<div class="md-card-head"><h3 data-doc-jump="1" title="' + T("点标题把这一条的地址钉住") + '">' + T("检索空白") + '</h3>' +
        '<div class="md-meta"><span class="md-chip md-chip-group">' + esc(g.from || "") + "</span></div></div>" +
      '<p class="md-src-note">' + esc(g.text) + "</p></article>";
  }

  /** 溯源总览里的一张来源卡片：材料本身 + 它被用在哪些指标上、各是什么立场。 */
  function sourceCard(s) {    var uses = sourceUses[s.id] || [];
    var head = s.url
      ? '<a class="md-src-title" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>"
      : '<span class="md-src-title">' + esc(s.title) + "</span>";
    var meta = [s.authors, s.venue, s.year].filter(Boolean).join(" · ");
    var challenge = uses.filter(function (u) { return u.stance === "challenge"; }).length;
    return '<article class="md-card md-source" id="md-src-' + esc(s.id) + '" data-docid="' + esc(s.id) + '">' +
      '<div class="md-card-head"><h3 data-doc-jump="1" title="' + T("点标题把这一条的地址钉住（点链接本身是打开原文）") + '">' + head + "</h3>" +
        '<div class="md-meta"><span class="md-src-kind">' + esc(srcKindLabel(s.kind)) + "</span>" +
        (challenge ? '<span class="md-src-stance md-stance-challenge">' + T("含 {0} 处边界条件", challenge) + "</span>" : "") +
        (uses.length ? '<span class="md-chip md-chip-group">' + T("{0} 处引用", uses.length) + "</span>" : '<span class="md-chip md-chip-group">' + T("未被引用") + "</span>") +
        "</div></div>" +
      (meta ? '<div class="md-src-meta">' + esc(meta) + "</div>" : "") +
      (s.quote ? '<blockquote class="md-src-quote">' + esc(s.quote) + "</blockquote>" : "") +
      (uses.length
        ? '<div class="md-sec"><h4>' + T("这条材料被用在哪") + '</h4><ul class="md-src-uses">' +
            uses.map(function (u) {
              return "<li>" +
                '<span class="md-src-stance md-stance-' + esc(u.stance) + '">' + esc(srcStanceLabel(u.stance)) + "</span>" +
                '<button class="md-relchip mono" data-metric="' + esc(u.id) + '">' + esc(u.id) + "</button>" +
                '<p class="md-src-note">' + esc(u.note) + "</p></li>";
            }).join("") + "</ul></div>"
        : '<div class="md-sec"><p class="md-src-note">' + T("这条材料登记在册，但当前没有条目引用它。") + "</p></div>") +
      "</article>";
  }

  function renderDocSide() {
    var host = document.getElementById("md-side");
    if (doc.tab === "metrics") {
      var counts = docCounts();
      var total = content.metrics.length;
      host.innerHTML =
        '<div class="md-side-title">' + T("分组") + '</div>' +
        '<button class="md-side-item' + (doc.group == null ? " active" : "") + '" data-group="">' + T("全部") + '<span class="md-cnt">' + total + "</span></button>" +
        Object.keys(counts).sort().map(function (g) {
          return '<button class="md-side-item' + (doc.group === g ? " active" : "") + '" data-group="' + esc(g) + '">' +
            esc(g) + '<span class="md-cnt">' + counts[g] + "</span></button>";
        }).join("");
    } else if (doc.tab === "sources") {
      var kinds2 = {};
      content.sources.forEach(function (s) { kinds2[s.kind] = (kinds2[s.kind] || 0) + 1; });
      var cited = content.sources.filter(function (s) { return (sourceUses[s.id] || []).length; }).length;
      var chal = 0;
      Object.keys(sourceUses).forEach(function (k) {
        sourceUses[k].forEach(function (u) { if (u.stance === "challenge") chal++; });
      });
      host.innerHTML =
        '<div class="md-side-title">' + T("材料类型") + '</div>' +
        '<button class="md-side-item' + (doc.srcKind == null ? " active" : "") + '" data-srckind="">' + T("全部") + '<span class="md-cnt">' + content.sources.length + "</span></button>" +
        Object.keys(kinds2).sort().map(function (k) {
          return '<button class="md-side-item' + (doc.srcKind === k ? " active" : "") + '" data-srckind="' + esc(k) + '">' +
            esc(srcKindLabel(k)) + '<span class="md-cnt">' + kinds2[k] + "</span></button>";
        }).join("") +
        (content.gaps.length
          ? '<button class="md-side-item' + (doc.srcKind === "__gap__" ? " active" : "") + '" data-srckind="__gap__">' +
            T("检索空白") + '<span class="md-cnt">' + content.gaps.length + "</span></button>"
          : "") +
        '<div class="md-side-note"><div class="md-side-title">' + T("交叉验证结果") + '</div>' +
          '<p>' + T("登记 {0} 条引文（去重后 {1} 份材料），被解读引用 {2} 条。", content.sources.length, Object.keys(materials()).length, cited) + "</p>" +
          '<p>' + T("其中 {0} 处标为「存疑 · 边界」—— 这一类说明我们的读法只在特定条件下成立，是最值得先看的部分。", chal) + "</p>" +
          (content.gaps.length
            ? "<p>" + T("另有 {0} 处检索空白：没找到能验证对应读法的公开材料。空白也是一种结论，不要当成「已被文献支持」。", content.gaps.length) + "</p>"
            : "") +
          (content.sourcesNote ? '<p class="dim">' + esc(content.sourcesNote) + "</p>" : "") +
        "</div>";
    } else {
      var kinds = {};
      content.insights.forEach(function (i) { kinds[i.kind || "note"] = (kinds[i.kind || "note"] || 0) + 1; });
      var w = content.window || {};
      host.innerHTML =
        '<div class="md-side-title">' + T("类型") + '</div>' +
        '<button class="md-side-item' + (doc.kind == null ? " active" : "") + '" data-kind="">' + T("全部") + '<span class="md-cnt">' + content.insights.length + "</span></button>" +
        Object.keys(kinds).sort().map(function (k) {
          return '<button class="md-side-item' + (doc.kind === k ? " active" : "") + '" data-kind="' + esc(k) + '">' +
            esc(kindLabel(k)) + '<span class="md-cnt">' + kinds[k] + "</span></button>";
        }).join("") +
        (w.note ? '<div class="md-side-note"><div class="md-side-title">' + T("观察窗口") + '</div><p>' + esc(w.note) + "</p>" +
          '<p class="mono dim">' + T("pro 到第 {0} 步 · flash 到第 {1} 步", esc(String(w.pro_step)), esc(String(w.flash_step))) + "</p></div>" : "");
    }
    host.querySelectorAll("[data-group]").forEach(function (b) {
      b.addEventListener("click", function () { doc.group = b.dataset.group || null; renderDocSide(); renderDocMain(); });
    });
    host.querySelectorAll("[data-kind]").forEach(function (b) {
      b.addEventListener("click", function () { doc.kind = b.dataset.kind || null; renderDocSide(); renderDocMain(); });
    });
    host.querySelectorAll("[data-srckind]").forEach(function (b) {
      b.addEventListener("click", function () { doc.srcKind = b.dataset.srckind || null; renderDocSide(); renderDocMain(); });
    });
  }

  function renderDocMain(focus) {
    var host = document.getElementById("md-main");
    var q = doc.q.trim().toLowerCase();
    if (doc.tab === "metrics") {
      var list = content.metrics.filter(function (m) {
        if (doc.group && (m.group || T("其他")) !== doc.group) return false;
        if (!q) return true;
        return [m.id, m.name, m.what, m.why, m.observed, (m.read || []).join(" "), (m.traps || []).join(" "), srcText(m)]
          .join(" ").toLowerCase().indexOf(q) >= 0;
      });
      host.innerHTML = list.length
        ? '<div class="md-count">' + T("{0} 条指标解读", list.length) + "</div>" + list.map(metricCard).join("")
        : '<div class="md-empty">' + T("没有匹配的指标。") + "</div>";
    } else if (doc.tab === "sources") {
      if (doc.srcKind === "__gap__") {
        // 只列检索空白
        host.innerHTML = '<div class="md-count">' + T("{0} 处检索空白 —— 这些读法没有找到可以对照的公开材料", content.gaps.length) + "</div>" + content.gaps.map(gapCard).join("");
      } else {
        var srcs = content.sources.filter(function (s) {
          if (doc.srcKind && s.kind !== doc.srcKind) return false;
          if (!q) return true;
          var uses = sourceUses[s.id] || [];
          return [s.id, s.title, s.quote, s.authors, s.venue, s.year, s.topic,
            uses.map(function (u) { return u.id + " " + u.note; }).join(" ")]
            .join(" ").toLowerCase().indexOf(q) >= 0;
        });
        host.innerHTML = srcs.length
          ? '<div class="md-count">' + T("{0} 条溯源材料（按类型和关键词筛）", srcs.length) + "</div>" + srcs.map(sourceCard).join("") +
            (!doc.srcKind && !q && content.gaps.length
              ? '<div class="md-count" style="padding-top:18px">' + T("检索空白 · {0} 条（没找到能验证对应读法的公开材料）", content.gaps.length) + "</div>" + content.gaps.map(gapCard).join("")
              : "")
          : '<div class="md-empty">' + T("没有匹配的溯源材料。") + "</div>";
      }
    } else {
      var items = content.insights.filter(function (it) {
        if (doc.kind && (it.kind || "note") !== doc.kind) return false;
        if (!q) return true;
        return [it.title, it.summary, (it.body || []).join(" "), (it.facts || []).map(function (f) { return f.label + " " + f.value; }).join(" ")]
          .join(" ").toLowerCase().indexOf(q) >= 0;
      });
      host.innerHTML = items.length
        ? '<div class="md-count">' + T("{0} 条洞察", items.length) + (content.updated ? T(" · 数据截至 {0}", esc(utc(content.updated))) : "") + "</div>" + items.map(insightCard).join("")
        : '<div class="md-empty">' + T("没有匹配的洞察。") + "</div>";
    }
    // 卡片里的跳转
    host.querySelectorAll("[data-metric]").forEach(function (b) {
      b.addEventListener("click", function () { openDoc("metrics", b.dataset.metric); });
    });
    host.querySelectorAll("[data-chart]").forEach(function (b) {
      b.addEventListener("click", function () {
        closeDoc();
        location.hash = "#chart/" + encodeURIComponent(b.dataset.chart);
      });
    });
    /* 定位：URL / 外部跳进来的 focus 可能是个具体 tag（图上点进来的），
       卡片是按解读条目的 id 建的，找不到就按族泛化一次再试。 */
    if (focus) {
      var want = focus;
      if (!docCard(want) && doc.tab === "metrics") {
        var mm = lookupMetric(want);
        if (mm && docCard(mm.id)) want = mm.id;
      }
      if (docCard(want)) { jumpToDocItem(want, { noUrl: true, instant: true }); doc.item = want; }
      else doc.item = null;
    } else {
      doc.item = null;
    }
    // 渲染完把当前"栏 + 筛选 + 定位"写进地址栏，刷新能回到同一个地方
    if (doc.open) writeDocHash();
  }

  /* ------------------------------------------------- 文档面板的 URL（本地新增）
     面板开着的时候把状态写进 location.hash：

       #doc/<页签>[/<筛选名>:<值>][/@<条目 id>]
       #doc/metrics                                 指标解读，全部
       #doc/insights                                数据洞察
       #doc/metrics/group:%E5%A5%96%E5%8A%B1%E4%BF%A1%E5%8F%B7   只看"奖励信号"这个分组
       #doc/sources/srckind:paper/@adamw            只看论文，并定位到 adamw 这条材料
       #doc/metrics/@critic%2Frewards%2Fmean        定位到 critic/rewards/mean 这条解读

     为什么用 history.replaceState 而不是 location.hash = ：后者会触发 app.js 的
     hashchange 路由，而 #doc 不是它的路由，会被当成未知视图回落到 overview 重画一遍。
     面板是浮在整屏上的，下面那张图重画纯属白费（还可能闪一下），所以这里"改地址但不触发路由"。
     replaceState 在个别 file:// 场景会被拦，那时退回改 hash；routeDocHash 幂等，不会来回弹。
     刷新（或把 URL 发给别人）时 app.js 照常渲染 overview，然后由 routeDocHash 把面板按
     URL 里的栏位和条目重新打开、滚到那一条。 */
  function dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return String(s || ""); }
  }

  function docFilterName(tab) {
    return tab === "metrics" ? "group" : tab === "sources" ? "srckind" : "kind";
  }
  function docFilterValue(tab) {
    return tab === "metrics" ? doc.group : tab === "sources" ? doc.srcKind : doc.kind;
  }
  /** 当前面板状态的 hash 串。 */
  function docHash() {
    var segs = ["doc", doc.tab];
    var f = docFilterValue(doc.tab);
    if (f) segs.push(docFilterName(doc.tab) + ":" + encodeURIComponent(f));
    if (doc.item) segs.push("@" + encodeURIComponent(doc.item));
    return "#" + segs.join("/");
  }
  /** 解析 hash；不是 #doc/... 就返回 null。 */
  function parseDocHash(hash) {
    var parts = String(hash || "").replace(/^#/, "").split("/");
    if (parts[0] !== "doc") return null;
    var tab = ["metrics", "insights", "sources"].indexOf(parts[1]) >= 0 ? parts[1] : "metrics";
    var out = { tab: tab, filter: null, item: null };
    for (var i = 2; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg) continue;
      if (seg.charAt(0) === "@") out.item = dec(seg.slice(1)) || null;
      else {
        var k = seg.indexOf(":");
        if (k > 0) out.filter = { name: seg.slice(0, k), value: dec(seg.slice(k + 1)) };
      }
    }
    return out;
  }
  function setHash(h) {
    if (!h || location.hash === h) return;
    try {
      history.replaceState(null, "", h);
    } catch (e) {
      location.hash = h; // 极少数环境拦 replaceState，退回改 hash
    }
  }
  function writeDocHash() {
    setHash(docHash());
  }

  /** 面板状态 → 界面。URL 直接进面板（刷新、改地址、外部链接）走这里。 */
  function applyDocState(st) {
    var box = document.getElementById("md-search");
    if (doc.tab !== st.tab) {
      doc.q = "";
      if (box) box.value = "";
    }
    doc.tab = st.tab;
    var name = docFilterName(st.tab);
    var value = st.filter && st.filter.name === name ? st.filter.value : null;
    if (st.tab === "metrics") doc.group = value;
    else if (st.tab === "sources") doc.srcKind = value;
    else doc.kind = value;
    if (!doc.open && !parseDocHash(location.hash)) doc.returnHash = location.hash || "#overview";
    doc.open = true;
    document.getElementById("telemetry-doc").classList.remove("hidden");
    document.body.classList.add("telemetry-doc-open");
    setDocChrome();
    renderDocSide();
    renderDocMain(st.item || undefined);
  }

  /** hash 变了：是要开/改面板，还是把面板关掉。 */
  function routeDocHash() {
    var st = parseDocHash(location.hash);
    if (!st) {
      if (doc.open) closeDoc(true); // 地址被改成别的视图了（比如按了后退），面板让位
      return;
    }
    if (doc.open && docHash() === location.hash) return; // 地址就是这个面板，不用动
    buildDocUI(); // 首次可能是刷新直接带着 #doc/... 进来，面板 DOM 还没建
    loadContent().then(function () { applyDocState(st); }).catch(docLoadFailed);
  }

  /** 定位到某一条：滚动 + 闪一下 + 记进 URL。 */
  function docCard(id) {
    var host = document.getElementById("md-main");
    if (!host || !id) return null;
    var cards = host.querySelectorAll(".md-card[data-docid]");
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.docid === id) return cards[i];
    return null;
  }
  var docSpy = { until: 0 };  // 主动定位后短暂闭麦，别让滚动监听把刚钉住的条目又改掉
  function jumpToDocItem(id, opts) {
    var el = docCard(id);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: opts && opts.instant ? "auto" : "smooth" });
      el.classList.remove("md-flash");
      // 强制回流，让同一个元素连着点两次也能重新闪
      void el.offsetWidth;
      el.classList.add("md-flash");
      clearTimeout(jumpToDocItem.timer);
      jumpToDocItem.timer = setTimeout(function () { el.classList.remove("md-flash"); }, 1600);
    }
    if (!(opts && opts.noUrl)) {
      doc.item = id || null;
      docSpy.until = Date.now() + 900;
      writeDocHash();
    }
  }

  /* 滚动时把"当前在看哪一条"同步进 URL：滚完把地址栏复制走，别人打开就落在同一条。
     只改地址不重画，所以用 replaceState，滚一路也不会堆历史记录。 */
  function spyDocItem() {
    if (Date.now() < docSpy.until) return;
    var host = document.getElementById("md-main");
    if (!host || !doc.open) return;
    var cards = host.querySelectorAll(".md-card[data-docid]");
    if (!cards.length) return;
    var top = host.getBoundingClientRect().top;
    var best = null;
    for (var i = 0; i < cards.length; i++) {
      // 卡片是按顺序排的：第一张还没到顶就说明视口在列表最上面
      if (cards[i].getBoundingClientRect().top - top > 12) break;
      best = cards[i];
    }
    var id = best ? best.dataset.docid : null;
    if (id === doc.item) return;
    doc.item = id;
    writeDocHash();
  }

  /** 打开面板时更新页签高亮与搜索框提示。 */
  function setDocChrome() {
    document.querySelectorAll(".md-tab").forEach(function (b) { b.classList.toggle("active", b.dataset.md === doc.tab); });
    var box = document.getElementById("md-search");
    if (box) {
      box.placeholder = doc.tab === "metrics" ? T("搜索指标名或关键词")
        : doc.tab === "insights" ? T("搜索洞察内容")
        : T("搜索材料标题、原文或指标名");
    }
  }

  /** 解读内容读不出来时也要把面板打开，并在正文里说明原因。 */
  function docLoadFailed(err) {
    doc.open = true;
    document.getElementById("telemetry-doc").classList.remove("hidden");
    document.getElementById("md-main").innerHTML = '<div class="md-empty">' + T("读不到解读内容：{0}", err.message) + "</div>";
  }

  function openDoc(tab, focus) {
    buildDocUI();
    loadContent().then(function () {
      var t = tab || "metrics";
      // 从图表详情跳进来时按分组定位过去：先把这一条所在的分组挑出来当筛选条件
      var filter = null;
      if (t === "metrics" && focus) {
        var m = lookupMetric(focus);
        if (m && m.group) filter = { name: "group", value: m.group };
      }
      if (focus) {
        doc.q = "";
        var box = document.getElementById("md-search");
        if (box) box.value = "";
      }
      applyDocState({ tab: t, filter: filter, item: focus || null });
    }).catch(docLoadFailed);
  }

  function closeDoc(keepUrl) {
    if (!doc.built) return;
    var wasOpen = doc.open;
    doc.open = false;
    document.getElementById("telemetry-doc").classList.add("hidden");
    document.body.classList.remove("telemetry-doc-open");
    /* 关面板就把地址换回打开前的视图，否则刷新一下面板又自己弹出来 */
    if (!keepUrl && wasOpen && parseDocHash(location.hash)) setHash(doc.returnHash || "#overview");
  }

  function buildDocUI() {
    if (doc.built) return;
    doc.built = true;
    var d = document.createElement("div");
    d.className = "telemetry-doc hidden";
    d.id = "telemetry-doc";
    d.innerHTML =
      '<div class="md-head"><div class="wrap md-head-inner">' +
        '<span class="md-brand">' + T("遥测文档") + '</span>' +
        '<nav class="md-tabs">' +
          '<button class="md-tab active" data-md="metrics">' + T("指标解读") + '</button>' +
          '<button class="md-tab" data-md="insights">' + T("数据洞察") + '</button>' +
          '<button class="md-tab" data-md="sources">' + T("溯源总览") + '</button>' +
        "</nav>" +
        '<input class="md-search" id="md-search" type="search" placeholder="' + T("搜索指标名或关键词") + '">' +
        '<button class="telemetry-ico" id="md-close" title="' + T("关闭（Esc）") + '">✕</button>' +
      "</div></div>" +
      '<div class="wrap md-body"><aside class="md-side" id="md-side"></aside><main class="md-main" id="md-main"></main></div>';
    document.body.appendChild(d);

    document.getElementById("md-close").addEventListener("click", function () { closeDoc(); });
    d.querySelectorAll(".md-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        doc.q = ""; doc.group = null; doc.kind = null; doc.srcKind = null;
        var box = document.getElementById("md-search");
        if (box) box.value = "";
        applyDocState({ tab: b.dataset.md, filter: null, item: null });
      });
    });
    var search = document.getElementById("md-search");
    var t = null;
    search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { doc.q = search.value; renderDocMain(); }, 150);
    });
    /* 点条目标题 = 把这一条钉进地址栏（顺带滚到它），刷新或分享就落在这条上。 */
    var main = document.getElementById("md-main");
    main.addEventListener("click", function (e) {
      if (e.target.closest("a")) return; // 溯源卡片的标题是外链，别抢
      var jump = e.target.closest("[data-doc-jump]");
      if (!jump) return;
      var card = jump.closest(".md-card");
      if (card) jumpToDocItem(card.dataset.docid);
    });
    /* 滚动停止后把"当前在看哪一条"写进地址。150ms 防抖，滚一路只写最后那一条。 */
    var spyTimer = null;
    main.addEventListener("scroll", function () {
      clearTimeout(spyTimer);
      spyTimer = setTimeout(spyDocItem, 150);
    });
    // Esc 关文档。用捕获阶段抢在 app.js 的 Esc（关图表详情）之前。
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && doc.open) { closeDoc(); e.stopPropagation(); }
    }, true);
  }

  /* 原站把详情框做成 max-height:100% 的纵向 flex，解读块塞进去后所有子项会被等比压缩，
     图表被挤到几十像素（canvas 反而溢出容器，坐标轴与曲线叠成一团）。这里把统计和图表
     收进左栏、解读单独占右栏并自己滚动，图表列不再参与挤压。只动 DOM 位置，不动 app.js：
     统计和图表仍按 id 查找，只是换了父节点。 */
  function modalSplit(card) {
    var split = card.querySelector(".mm-split");
    if (split) return split;
    split = document.createElement("div");
    split.className = "mm-split";
    var left = document.createElement("div");
    left.className = "mm-left";
    card.appendChild(split);
    split.appendChild(left);
    [card.querySelector("#modal-stats"), card.querySelector("#modal-chart")].forEach(function (el) {
      if (el) left.appendChild(el);
    });
    return split;
  }

  /** 把解读塞进原站的图表详情框 —— 用户正看着这条曲线的时候最需要它。 */
  function injectModalDoc(tag) {
    var card = document.querySelector("#modal .modal-card");
    if (!card) return;
    var old = card.querySelector(".telemetry-mdoc");
    if (old) old.remove();
    if (!content) {
      loadContent().then(function () { injectModalDoc(tag); }).catch(function () {});
      return;
    }
    var m = lookupMetric(tag);
    var box = document.createElement("div");
    box.className = "telemetry-mdoc";
    if (!m) {
      box.innerHTML = '<div class="mm-head"><span class="mm-name">' + T("这个指标还没有写解读") + '</span></div>' +
        '<p class="mm-what">' + T("遥测文档里目前收了 {0} 条指标解读，涵盖首页固定的图和各指标族。", content.metrics.length) + "</p>" +
        '<div class="mm-foot"><button class="telemetry-btn small" data-open-doc="1">' + T("浏览全部解读") + '</button></div>';
    } else {
      box.innerHTML =
        '<div class="mm-head"><span class="mm-name">' + esc(m.name || m.id) + "</span>" +
          '<span class="mm-group">' + esc(m.group || "") + "</span>" +
          (m.unit ? '<span class="mm-unit">' + esc(m.unit) + "</span>" : "") + "</div>" +
        '<p class="mm-what">' + esc(m.what) + "</p>" +
        (m.why ? '<p class="mm-why">' + esc(m.why) + "</p>" : "") +
        (m.observed ? '<p class="mm-obs"><b>' + T("这一轮实测") + '</b>' + esc(m.observed) + "</p>" : "") +
        ((m.read && m.read.length) || (m.traps && m.traps.length)
          ? "<details class=\"mm-more\"><summary>" + T("怎么读 · 容易读错的地方") + "</summary>" +
            (m.read && m.read.length ? "<b>" + T("怎么读") + "</b>" + mdList(m.read) : "") +
            (m.traps && m.traps.length ? "<b>" + T("容易读错") + "</b>" + mdList(m.traps, "mm-warn") : "") +
            "</details>"
          : "") +
        sourcesHTML(m) +
        '<div class="mm-foot"><button class="telemetry-btn small" data-open-doc="1">' + T("看完整解读") + '</button>' +
          '<button class="telemetry-btn small ghost" data-corr-step="1">' + T("分析这一步") + '</button></div>';
    }
    modalSplit(card).appendChild(box);
    var btn = box.querySelector("[data-open-doc]");
    if (btn) btn.addEventListener("click", function () { openDoc("metrics", m ? m.id : tag); });
    /* 没锁步就拿这张图的最后一步；锚点就是这张图对应的指标。 */
    var cbtn = box.querySelector("[data-corr-step]");
    if (cbtn) cbtn.addEventListener("click", function () {
      var step = sync.step != null ? sync.step : modalLastStep();
      openCorrPanel({ step: step, anchor: { kind: "metric", id: tag, label: tag }, run: sync.run });
    });
  }

  /* ==================================================================
   * 看板表格的逐列解读：点列头打开对应的解读卡片
   *
   * dynamic sampler 的 data sources 表和 batch composition 的两张表都由 app.js 渲染，
   * 遥测层不改它的渲染逻辑；这里用事件委托接住列头上的点击，按"表的种类 + 列头文字"
   * 映射到 content/_draft/table-columns.json 里那批 table/... 条目，再走和图表详情框
   * 同一个 openDoc 入口。表格每 10 秒轮询就重建一次，所以不能直接给 th 绑监听。
   * ================================================================== */

  var SAMPLER_COL_DOC = {
    "source": "table/sampler/source",
    "accepted / target": "table/sampler/accepted-target",
    "": "table/sampler/accepted-target",        // 比例条那一列没有表头
    "remaining": "table/sampler/remaining",
    "judged": "table/sampler/judged",
    "in flight": "table/sampler/inflight",
  };

  /** 列头 → 解读条目 id。认不出来的列返回 null（回放明细里的表就走不到这里）。 */
  function tableDocId(th) {
    var table = th.closest ? th.closest("table") : null;
    if (!table) return null;
    if (table.classList.contains("src")) {
      var text = (th.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
      return SAMPLER_COL_DOC[text] || null;
    }
    if (table.closest(".comp-table")) {
      /* 批组成有两张表：第一张首列是 category，第二张首列是数据源 / harness 名。 */
      var first = table.querySelector("thead th");
      var head = first ? (first.textContent || "").trim().toLowerCase() : "";
      return head === "category" ? "table/comp/trained" : "table/comp/metric";
    }
    return null;
  }

  function hookTableDocs() {
    /* title 是惰性补的：表格重建后标记就没了，鼠标再扫过会重新补上。 */
    document.addEventListener("mouseover", function (e) {
      var th = e.target && e.target.closest ? e.target.closest("th") : null;
      if (!th || th.dataset.mdTableTip) return;
      if (!tableDocId(th)) return;
      th.dataset.mdTableTip = "1";
      th.title = T("点这一列看解读");
    });
    document.addEventListener("click", function (e) {
      var th = e.target && e.target.closest ? e.target.closest("th") : null;
      if (!th) return;
      var id = tableDocId(th);
      if (!id) return;
      e.preventDefault();
      openDoc("metrics", id);
    });
  }

  /* 详情框是 app.js 自己开关的，这里靠观察 class 变化搭上去，不用改 app.js。 */
  function hookModal() {
    var modal = document.getElementById("modal");
    if (!modal) return;
    var last = null;
    new MutationObserver(function () {
      var open = !modal.classList.contains("hidden");
      var tag = (document.getElementById("modal-title") || {}).textContent || "";
      if (!open) { last = null; return; }
      if (tag === last) return;
      last = tag;
      injectModalDoc(tag);
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }

  /* ----------------------------------------- 相关性分析（点住某一步之后）

     用户的动作是"在图上点某一步" —— 这一步为什么跳，摊开来看无非两种线索：
     同一步里还有哪些指标一起动了（横截面），以及历史上跟这条曲线同涨同跌的
     是哪些指标（时间序列）。这个面板把两者并排摆出来，再补上这一步时段内的
     重启、版本切换和官方公告 —— 那才是"原因候选"，相关性只负责指路。

     算的地方在服务端 /api/correlate（2000 个指标 × 30 步，页面手里没有全量序列），
     离线副本里则由 bundleApi 用同一个内核 site/js/correlate.js 就地算。 */
  var corr = { open: false, run: null, step: null, anchor: null, tab: "movers", data: null, busy: false, err: null, seq: 0 };

  function corrRuns() {
    var cfg = BUNDLE && BUNDLE.config && BUNDLE.config.runs;
    if (cfg && cfg.length) return cfg.map(function (r) { return { key: r.key, label: r.label || r.key }; });
    return [{ key: "pro", label: "mimo-v2.6-pro" }, { key: "flash", label: "mimo-v2.6-flash" }];
  }
  function corrRunLabel(key) {
    var hit = corrRuns().filter(function (r) { return r.key === key; })[0];
    return hit ? hit.label : key;
  }

  /** 自适应数值：这几千个指标横跨 1e-6（各种 frac）到 1e6（token 数），固定小数位没法看。 */
  function corrNum(v) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return (v / 1e3).toFixed(1) + "k";
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return "0";
    return v.toPrecision(3);
  }
  function corrPct(p) {
    if (p == null || !isFinite(p)) return "—";
    var s = p * 100;
    return (s > 0 ? "+" : "") + (Math.abs(s) >= 100 ? s.toFixed(0) : s.toFixed(1)) + "%";
  }
  function corrUp(v) { return v == null ? "" : (v > 0 ? "up" : v < 0 ? "down" : ""); }
  /** 相关强度分档。样本只有 20 来个点时，"强"也只是"值得去看一眼"。 */
  function corrStrength(rho) {
    var a = Math.abs(rho);
    return a >= 0.8 ? T("强") : a >= 0.5 ? T("中") : T("弱");
  }

  function buildCorrPanel() {
    if (document.getElementById("telemetry-corr")) return;
    var d = document.createElement("div");
    d.id = "telemetry-corr";
    d.className = "hidden";
    d.innerHTML =
      '<div class="mc-head"><div class="wrap mc-head-inner">' +
        '<span class="mc-brand">' + T("这一步发生了什么") + '</span>' +
        '<span class="mc-sub" id="mc-sub"></span>' +
        '<div class="mc-ctrls" id="mc-ctrls"></div>' +
        '<button class="telemetry-ico" id="mc-close" title="' + T("关闭（Esc）") + '">✕</button>' +
      "</div></div>" +
      '<div class="wrap mc-body">' +
        '<div class="mc-summary" id="mc-summary"></div>' +
        '<div class="mc-tabs" id="mc-tabs">' +
          '<button class="mc-tab" data-mc-tab="movers">' + T("这一步一起动的") + '</button>' +
          '<button class="mc-tab" data-mc-tab="corr">' + T("与锚点同涨同跌") + '</button>' +
        "</div>" +
        '<div class="mc-pane" id="mc-pane"></div>' +
        '<div class="mc-foot" id="mc-foot"></div>' +
      "</div>";
    document.body.appendChild(d);
    document.getElementById("mc-close").addEventListener("click", closeCorrPanel);
    d.addEventListener("click", onCorrClick);
  }

  function onCorrClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tab = t.closest("[data-mc-tab]");
    if (tab) { corr.tab = tab.dataset.mcTab; renderCorr(); return; }
    var run = t.closest("[data-mc-run]");
    if (run) { corr.run = run.dataset.mcRun; loadCorr(); syncUrl(); return; }
    var jump = t.closest("[data-mc-jump]");
    if (jump) {
      /* 步号必须夹在切面可见的范围内：回放时"往后 5 步"很容易越界，
         越界了服务端会退到最后一步，但按钮却看着没反应。 */
      var lo = 1, hi = Infinity;
      var ds = corr.data && corr.data.steps;
      if (ds && ds.length) { lo = ds[0]; hi = ds[ds.length - 1]; }
      corr.step = Math.min(hi, Math.max(lo, corr.step + Number(jump.dataset.mcJump)));
      loadCorr();
      syncUrl();
      return;
    }
    if (t.closest("[data-mc-drop-anchor]")) {
      corr.anchor = null;
      /* 没有锚点就没有"同涨同跌"这一栏，页签要跟着落回异动榜，
         否则会看到一个禁用着的高亮页签配着异动榜的内容。 */
      if (corr.tab === "corr") corr.tab = "movers";
      loadCorr();
      syncUrl();
      return;
    }
    var doc = t.closest("[data-mc-doc]");
    if (doc) { openDoc("metrics", doc.dataset.mcDoc); return; }
  }

  function openCorrPanel(opts) {
    opts = opts || {};
    if (opts.anchor !== undefined) corr.anchor = opts.anchor;
    if (opts.step != null) corr.step = opts.step;
    if (opts.run) corr.run = opts.run;
    if (!corr.run) corr.run = sync.run || "flash";
    if (corr.step == null) corr.step = 1;
    noteReturnHash();
    resolveAnchorLabel(corr.anchor);
    corr.open = true;
    /* 没有锚点时"与锚点同涨同跌"那一栏是空的，直接落到异动榜 */
    if (!corr.anchor) corr.tab = "movers";
    buildCorrPanel();
    document.getElementById("telemetry-corr").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    loadCorr();
    syncUrl();
  }

  function closeCorrPanel(skipUrl) {
    var d = document.getElementById("telemetry-corr");
    if (d) d.classList.add("hidden");
    corr.open = false;
    document.body.style.overflow = "";
    /* 关掉面板不等于解锁：步还锁着，地址就退回 #step/...，那个链接照样能贴出去 */
    if (!skipUrl) syncUrl();
  }

  function corrQuery() {
    var q = "/api/correlate?run=" + encodeURIComponent(corr.run) + "&step=" + encodeURIComponent(corr.step) + "&top=12" +
      "&lang=" + encodeURIComponent(contentLang());
    if (corr.anchor && corr.anchor.kind === "bench") q += "&bench=" + encodeURIComponent(corr.anchor.id);
    else if (corr.anchor && corr.anchor.kind === "metric") q += "&metric=" + encodeURIComponent(corr.anchor.id);
    return q;
  }

  function loadCorr() {
    var seq = ++corr.seq;
    corr.busy = true;
    corr.err = null;
    renderCorr();
    api(corrQuery()).then(function (d) {
      if (seq !== corr.seq) return;
      /* 回放切面里被指定的步可能还没完成，服务端会退到切面里最后一步 ——
         把面板的状态跟着改过来，免得标题写着一个步号、算的是另一个。 */
      if (d && d.step != null && d.step !== corr.step) corr.step = d.step;
      corr.data = d;
      corr.busy = false;
      renderCorr();
      syncUrl();                                    // 服务端退步了，地址跟着改
    }).catch(function (err) {
      if (seq !== corr.seq) return;
      corr.err = String((err && err.message) || err);
      corr.busy = false;
      renderCorr();
    });
  }

  /** 面板里面的指标名点一下能跳到解读 —— 和图表详情框里那套是同一个入口。 */
  function metricLink(tag) {
    var m = lookupMetric(tag);
    if (!m || !isLiteralTag(m.id)) return "";
    return '<button class="telemetry-btn small ghost" data-mc-doc="' + esc(m.id) + '" title="' + T("看这个指标的解读") + '">' + T("解读") + '</button>';
  }

  function memberList(members) {
    if (!members || members.length < 2) return "";
    return '<details class="mc-members"><summary>' + T("同族 {0} 项", members.length) + "</summary><ul>" +
      members.map(function (m) {
        /* 异动榜的成员带 pct，相关榜的成员带 spearman，两边共用一个渲染函数 */
        var tail = m.pct != null ? corrPct(m.pct) : (m.spearman == null ? "" : "ρ " + m.spearman.toFixed(2));
        return "<li>" + esc(m.tag) + ' <span class="dim">' + tail + "</span></li>";
      }).join("") + "</ul></details>";
  }

  function renderCorr() {
    if (!corr.open) return;
    var d = corr.data;
    /* 算的时候不遮住旧结果（遮了会闪），只把整块调暗一点 */
    document.getElementById("telemetry-corr").classList.toggle("busy", !!corr.busy);
    var sub = document.getElementById("mc-sub");
    sub.textContent = corrRunLabel(corr.run) + " · step " + corr.step;

    /* 控件：换 run、前后翻步、丢掉锚点（丢掉之后只剩"这一步一起动了什么"） */
    document.getElementById("mc-ctrls").innerHTML =
      corrRuns().map(function (r) {
        /* 只写 pro / flash：完整名字已经在左边的 mc-sub 里，这里再写一遍会两边重复 */
        return '<button class="mc-chip' + (r.key === corr.run ? " on" : "") + '" data-mc-run="' + esc(r.key) +
          '" title="' + T("切换到 {0}", esc(r.label)) + '">' + esc(r.key) + "</button>";
      }).join("") +
      '<span class="mc-stepnav">' +
        '<button data-mc-jump="-5" title="' + T("往前 5 步") + '">«</button>' +
        '<button data-mc-jump="-1" title="' + T("前一步") + '">‹</button>' +
        '<button data-mc-jump="1" title="' + T("后一步") + '">›</button>' +
        '<button data-mc-jump="5" title="' + T("往后 5 步") + '">»</button>' +
      "</span>" +
      (corr.anchor
        ? '<span class="mc-anchor" title="' + esc(corr.anchor.label) + '">' + T("锚点 {0}", esc(shortLabel(corr.anchor.label, 26))) +
          '<button data-mc-drop-anchor="1" title="' + T("只看这一步的异动，不跟锚点比") + '">✕</button></span>'
        : "");

    var tabs = document.getElementById("mc-tabs");
    tabs.querySelectorAll("[data-mc-tab]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mcTab === corr.tab);
      b.disabled = !corr.anchor && b.dataset.mcTab === "corr";
    });

    if (corr.err) {
      document.getElementById("mc-summary").innerHTML = '<span class="mc-bad">' + T("取数失败：{0}", corr.err) + "</span>";
      document.getElementById("mc-pane").innerHTML = "";
      document.getElementById("mc-foot").innerHTML = "";
      return;
    }
    if (!d) {
      document.getElementById("mc-summary").innerHTML = '<span class="dim">' + T("正在算…") + '</span>';
      document.getElementById("mc-pane").innerHTML = "";
      document.getElementById("mc-foot").innerHTML = "";
      return;
    }

    /* 摘要：锚点自己这一步的读数，加一句"参与比较了多少指标" */
    var a = d.anchor;
    document.getElementById("mc-summary").innerHTML =
      '<div class="mc-sum">' +
        (a
          ? '<span class="mc-sum-anchor"><b>' + esc(a.label || a.id) + "</b>" + T(" 这一步 {0}", corrNum(a.value)) +
            ' <span class="' + corrUp(a.delta) + '">' + (a.delta == null ? "—" : T("{0}（{1}）", corrPct(a.pct), (a.delta > 0 ? "+" : "") + corrNum(a.delta))) + "</span>" +
            (a.z == null ? "" : ' <span class="dim">' + T("z={0}（相对它自己的历史波动）", a.z.toFixed(2)) + "</span>") + "</span>"
          : '<span class="dim">' + T("没有锚点：只看这一步有哪些指标一起动了。在图上点某一步会带上那条曲线当锚点。") + "</span>") +
      "</div>" +
      '<div class="mc-counts">' + (d.counts.skipped
        ? T("参与比较 {0} 个指标（这一步共 {1} 个，其中 {2} 个有效点太少或这一步没有读数，没进榜），折叠成 {3} 个族", d.counts.usable, d.counts.tags, d.counts.skipped, d.counts.families)
        : T("参与比较 {0} 个指标（这一步共 {1} 个，其余都进了榜），折叠成 {2} 个族", d.counts.usable, d.counts.tags, d.counts.families)) + "</div>";

    var pane = document.getElementById("mc-pane");
    if (corr.tab === "corr" && corr.anchor) {
      pane.innerHTML = d.corr.length
        ? '<div class="mc-tbl"><div class="mc-row mc-head"><span>' + T("相关") + '</span><span>' + T("指标族") + '</span><span>' + T("全周期") + '</span><span>' + T("去趋势") + '</span><span>' + T("样本") + '</span><span></span></div>' +
          d.corr.map(function (c) {
            return '<div class="mc-row">' +
              '<span class="mc-score" data-lv="' + (Math.abs(c.spearman) >= 0.8 ? 3 : Math.abs(c.spearman) >= 0.5 ? 2 : 1) + '">' + c.spearman.toFixed(2) + "</span>" +
              '<span class="mc-name"><span class="mc-fam" title="' + esc(c.tag) + '">' + esc(c.family) + "</span>" +
                '<span class="mc-why">' + T("{0}相关 · {1}", corrStrength(c.spearman), c.spearman > 0 ? T("同向") : T("反向")) + memberList(c.members) + "</span></span>" +
              '<span class="mc-val">ρ ' + (c.spearman == null ? "—" : c.spearman.toFixed(3)) + " · r " + (c.pearson == null ? "—" : c.pearson.toFixed(3)) + "</span>" +
              '<span class="mc-pct ' + corrUp(c.d_spearman) + '">' + (c.d_spearman == null ? "—" : c.d_spearman.toFixed(3)) + "</span>" +
              '<span class="mc-z">n=' + c.n + "</span>" +
              '<span class="mc-act">' + metricLink(c.tag) + "</span>" +
            "</div>";
          }).join("") + "</div>" +
          '<p class="mc-hint">' + T("ρ 是秩相关（Spearman），对离群点不敏感；「去趋势」是把两条曲线都取一阶差分之后再算秩相关，它高才说明是同步涨跌而不是各涨各的。两条都在爬升的曲线天然相关，先看这一列。") + "</p>"
        : '<p class="mc-empty">' + T("没有指标能和这个锚点凑够样本量。") + "</p>";
    } else {
      pane.innerHTML = d.movers.length
        ? '<div class="mc-tbl"><div class="mc-row mc-head"><span>' + T("异常度") + '</span><span>' + T("指标族") + '</span><span>' + T("这一步") + '</span><span>' + T("变化") + '</span><span>' + T("怎么算的") + '</span><span></span></div>' +
          d.movers.map(function (m) {
            return '<div class="mc-row">' +
              '<span class="mc-score" data-lv="' + (m.score >= 3 ? 3 : m.score >= 2 ? 2 : 1) + '">' + m.score.toFixed(2) + "</span>" +
              '<span class="mc-name"><span class="mc-fam" title="' + esc(m.tag) + '">' + esc(m.family) + "</span>" +
                memberList(m.members) + "</span>" +
              '<span class="mc-val">' + corrNum(m.value) + ' <i class="dim">← ' + corrNum(m.prev) + "</i></span>" +
              '<span class="mc-pct ' + corrUp(m.delta) + '">' + corrPct(m.pct) + "</span>" +
              '<span class="mc-z">z ' + (m.z == null ? "—" : m.z.toFixed(2)) + " · MAD " + (m.zr == null ? "—" : m.zr.toFixed(2)) + "</span>" +
              '<span class="mc-act">' + metricLink(m.tag) + "</span>" +
            "</div>";
          }).join("") + "</div>" +
          '<p class="mc-hint">' + T("异常度取 z 与 MAD 两个尺度里较小的那个：只有在两种尺度下都算异常才排前面。轨迹级 max/min 这类极值指标常年顶在上限附近，只看 MAD 尺度会把排行榜占满。") + "</p>"
        : '<p class="mc-empty">' + T("这一步没有指标的变化幅度够得上异常。") + "</p>";
    }

    renderCorrFoot(d);
  }

  function renderCorrFoot(d) {
    var c = d.context || {};
    var bits = [];
    if (c.restarts && c.restarts.length) {
      bits.push('<span class="mc-bad">' + T("重启 {0} 次", c.restarts.length) + "</span>");
    } else {
      bits.push('<span class="dim">' + T("没有重启") + "</span>");
    }
    if (c.tagset_versions && c.tagset_versions.length) {
      /* 这是看板的指标名清单换了一版（版本串里就带着当时的步号），不是训练配置变了。 */
      bits.push('<span title="' + T("看板暴露的指标名清单在这一步前后换过一版。版本串 3-5513.<步>.<x>.<y> 的第二段就是当时的步号；这是遥测口径的变化，不代表训练改了配置。") + '">' +
        T("指标集快照 {0}", c.tagset_versions.map(function (v) { return esc(v.version); }).join(T("、"))) + "</span>");
    }
    if (c.notices && c.notices.length) {
      bits.push(T("公告 {0} 条", c.notices.length));
    } else {
      bits.push('<span class="dim">' + T("没有新公告") + "</span>");
    }
    if (c.restarts_total != null) bits.push('<span class="dim">' + T("全程重启 {0} 次", c.restarts_total) + "</span>");

    var notices = (c.notices || []).map(function (n) {
      /* 官方常事后补发：这一步完成之后才贴出来的公告，标一下，别当成"发这一步时已知"。 */
      var late = !!n.late;
      /* 公告正文按界面语言取，不能写死 text_zh：官方原文只有英文，中文译文是给中文读者
         的辅助（content/notices.zh.json），不是"所有语言的默认值"。以前这里写
         `esc(n.text_zh || n.text)`，英文界面下整块面板的界面文案是英文、正文却是中文。 */
      var nt = noticeText(n);
      return '<li><span class="dim">' + bj(n.t) + "</span> " +
        (late ? '<span class="mc-late" title="' + T("这条公告是在第 {0} 步完成之后才发布的", n.after_step) + '">' + T("随后发布") + "</span> " : "") +
        /* 中文模式下把英文原文挂在 title 上：译文是意译，要逐句核对时还得看原文 */
        '<span' + (nt.original ? ' title="' + esc(T("原文") + " · " + nt.original) + '"' : "") + ">" + esc(nt.text) + "</span>" +
        (nt.untranslated ? ' <span class="mn-untranslated" title="' + T("content/notices.zh.json 里还没有这条的译文") + '">' + T("未翻译") + "</span>" : "") +
        "</li>";
    }).join("");

    var nb = (c.neighbors || []).map(function (n) {
      return "<li><b>step " + n.step + "</b> avg@n " + corrNum(n.headline) +
        ' <span class="dim">' + (n.delta == null ? "" : (n.delta > 0 ? "+" : "") + corrNum(n.delta)) + "</span> · " +
        corrNum(n.tokens) + " token" + (n.redo ? ' <span class="mc-bad">' + T("重跑") + "</span>" : "") + "</li>";
    }).join("");

    document.getElementById("mc-foot").innerHTML =
      '<div class="mc-ctx"><b>' + T("这一步的时段内") + '</b> ' + bits.join(" · ") + "</div>" +
      (notices ? '<ul class="mc-notices">' + notices + "</ul>" : "") +
      (nb ? '<div class="mc-neigh"><b>' + T("相邻步（抬头指标 avg@n 与本步 token）") + '</b><ul>' + nb + "</ul></div>" : "") +
      '<details class="mc-caveats"><summary>' + T("这些数怎么算的 / 别当成结论") + '</summary><ul>' +
        (d.caveats || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
      "</ul></details>";
  }

  /** 详情框里那张图的最后一步，用来在没有联动锁步时选一个合理的默认值。 */
  function modalLastStep() {
    for (var i = 0; i < sync.charts.length; i++) {
      var inst = sync.charts[i];
      if (!inst.container || !inst.container.closest || !inst.container.closest("#modal")) continue;
      var p = inst.prepared;
      if (!p) continue;
      var best = null;
      for (var j = 0; j < p.series.length; j++) {
        var steps = p.series[j].steps || [], y = p.series[j].y || [];
        for (var k = steps.length - 1; k >= 0; k--) {
          if (y[k] != null) { if (best == null || steps[k] > best) best = steps[k]; break; }
        }
      }
      if (best != null) return best;
    }
    return null;
  }

  // ------------------------------------------------------------ 对外接口
  window.Telemetry = {
    /** app.js 用它判断当前是不是回放模式。 */
    replay: function () { return state.asof != null; },
    asOf: function () { return state.asof; },
    /** app.js 用它判断"手上这份数据是不是冻结的存档快照"：离线副本，或某个回放切面。
        快照里没有"现在"，凡是按"现在"算出来的读数（成本、耗时、"2 小时前"）都该停在
        数据自己的时刻，否则一份静止的存档会被读成"还在跑"。 */
    frozen: function () { return !!BUNDLE || state.asof != null; },
    /** 存档数据自己的时刻（epoch 秒）。离线副本取最后一次同步的采集时间（拿不到就退回
        导出时间），回放取切面时间。在线实时（有服务端、能连上上游）没有这个概念，返回 null。 */
    dataAt: function () {
      if (state.asof != null) return state.asof;
      if (!BUNDLE) return null;
      var syncs = BUNDLE.syncs || [];
      for (var i = syncs.length - 1; i >= 0; i--) {
        if (syncs[i] && syncs[i].captured != null) return syncs[i].captured;
      }
      return BUNDLE.generated_at != null ? BUNDLE.generated_at : null;
    },
    /** app.js 启动时把刷新句柄交进来。 */
    bind: function (handle) { app = handle; },
    /** 遥测层自己用的取数入口（同样受 asof 影响）。 */
    api: api,
    offline: !!BUNDLE,
    setAsof: function (t) { state.asof = t; },
    /** 打开文档面板：openDoc("metrics"|"insights", 可选指标名)。 */
    openDoc: openDoc,
  };

  function boot() {
    buildUIOnce();
    hookModal();
    hookControls();
    hookTableDocs();
    /* 解读内容不急，等首屏渲染完再悄悄拉，免得拖慢看板。 */
    setTimeout(function () { loadContent().catch(function () {}); }, 1200);
    if (state.asof != null) {
      enterReplay();
    }
    /* 地址栏里就是某个解读条目（刷新 / 别人发来的链接）→ 直接把面板开在那一栏、那一条。
       监听 hashchange 是为了手动改地址、以及从别处点 #doc/... 链接时也能跟上。
       顺带在换视图时补一次注入：切走 metrics 不会重建它的 DOM，
       只有 hashchange 才叫得醒浮动勾选条。 */
    window.addEventListener("hashchange", function (e) {
      routeDocHash();
      setTimeout(function () {
        ensureBoards(); ensurePickBoxes(); ensurePickBar();
        closePop();
      }, 120);
    });
    if (parseDocHash(location.hash)) routeDocHash();

    /* 深链：刷新/贴链接直接落在"锁定某一步"或"分析这一步"上。
       必须在 app.js 渲染之前只做状态赋值 —— 图表是在 setData 里补标注的，
       状态先摆好，后面的图自己就会带上。 */
    window.addEventListener("hashchange", function (e) {
      var h = location.hash;
      /* app.js 与解读面板都会在 hashchange 里改地址；用事件自带的 newURL 取用户的意图，
         否则 #doc 关掉时把地址改回去，这里就看不到刚才那个 #step 了。 */
      try { if (e && e.newURL) h = new URL(e.newURL).hash; } catch (err) { }
      routeStepHash(h);
    });
    routeStepHash(location.hash);
  }

  /* 字典是异步加载的；等它到位再画遥测层，英文模式下首屏就不会先闪一下中文。
     I18N.ready 在加载失败时也会 resolve，t() 那时回落到中文源串。 */
  function start() {
    var ready = window.I18N && window.I18N.ready;
    if (ready && typeof ready.then === "function") ready.then(boot, boot);
    else boot();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
