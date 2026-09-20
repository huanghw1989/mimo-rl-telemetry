/* mimo-v2.6 live page. All runs on one page, every public tag, lazy charts.
   Runs are named by their model label only. A run is "live" until the server
   reports mode "ended".
   Routes: #overview · #metrics/<path> · #about · #chart/<encoded tag> */
(function () {
  "use strict";

  const STATUS_MS = 10000;   // the page ticks locally between polls; a new step or report shows within 10 s
  const MAX_SERIES = 8;
  const BATCH = 96;
  const PAGE = 48;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));


  // ------------------------------------------------------------------ state
  const S = {
    cfg: null,
    view: "overview",
    path: "",
    query: "",
    status: {}, statusAt: {},
    live: {},          // run -> /api/live snapshot
    notices: [],       // /api/notices, newest first
    benchmarks: null,  // /api/benchmarks
    benchCharts: {},   // key -> Charts.Line
    tags: {},          // run -> {version, list, set}
    union: null,       // {key, list, set, tree}
    series: {},        // run -> {version, steps, walls, runStart, map, pending, queue, timer}
    prefs: Object.assign({ xMode: "step", smoothing: 0, log: false, compMode: "count" }, JSON.parse(localStorage.getItem("prefs3") || "{}")),
    cards: [],
    io: null,
    expanded: new Set(), expandedFor: null,
    sel: {}, slots: {}, metric: {}, sort: {},
    bdRun: null, compRun: null, comp: null,
    modal: null,
    failures: 0,
    page: PAGE,
    rendered: false,
  };
  const savePrefs = () => localStorage.setItem("prefs3", JSON.stringify(S.prefs));
  const runs = () => S.cfg.runs;
  const runCfg = (key) => runs().find((r) => r.key === key);
  const runName = (key) => { const r = runCfg(key); return r ? r.label : key; };
  /* A run's colour: config.json runs[].color_index into the palette, else its position. */
  const runColor = (key) => { const i = runs().findIndex((r) => r.key === key); const r = runs()[i]; return Charts.palette()[(r && r.color_index != null ? r.color_index : Math.max(0, i)) % 8]; };
  const fmtOf = (tag) => Fmt.forTag(tag, S.cfg.formats);
  const descOf = (tag) => S.cfg.descriptions[tag] || S.cfg.descriptions[tag.replace(/\/\d+$/, "")] || "";
  const lastOf = (arr) => { if (!arr) return null; for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const prevOf = (arr) => { if (!arr) return null; let seen = 0; for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) { if (seen) return arr[i]; seen++; } return null; };
  const st = (run) => S.status[run];
  /* [telemetry] Telemetry 由 js/telemetry.js 在本文件之前定义，提供回放开关和一个刷新入口。
     没加载遥测层时它是空壳，行为与上游站点一致。 */
  const M = window.Telemetry || { replay: () => false, bind: () => {} };
  /* [telemetry] 界面文案走语言层 js/i18n.js（中文源串 + 英文词典）。上游站点没装这一层，
     这里的 T 退化成"原文返回"，行为与上游一致。 */
  const T = window.T || ((s) => s);
  /* [telemetry] 回放模式下不能把 run 当成"已停止"：切片里的 run 依然是活的，
     只是被冻结在过去的某一刻，采样器面板和时间线都还得照常渲染。 */
  const isFinal = (run) => !!(st(run) && st(run).run.mode === "ended" && !M.replay());
  /* [telemetry] 手上这份数据是不是冻结的存档快照。三种情况：离线副本、正在看的回放
     切面、以及服务端明确说这份 status 是从仓库存档重建的（连不上上游时的兜底）。
     快照里没有"现在"：成本、耗时、"2 小时前"这些跟着本机时钟走的读数都会停住 ——
     数据不再更新、读数却还在变，一份静止的存档就会被读成"还在跑"。只有上游实时
     （服务端转发到了真数据）才保留原来的逐秒推进。 */
  const isSnapshot = () => {
    if (M.frozen && M.frozen()) return true;
    const list = (S.cfg && S.cfg.runs) || [];
    return list.length > 0 && list.every((r) => { const s = S.status[r.key]; return !!(s && s.from_archive); });
  };
  /* The run's "now": the server clock at the last status poll, advanced
     locally since. A snapshot is frozen at the data's own clock instead. */
  function vnow(run) {
    const s = st(run);
    if (!s) return null;
    if (isSnapshot()) return s.clock.now;   // [telemetry] 冻结在数据时刻，不随本地时钟前进
    return s.clock.now + (performance.now() - S.statusAt[run]) / 1000;
  }

  // ------------------------------------------------------------------ fetch
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  async function loadStatus(run) {
    const s = await getJSON(`api/status?run=${run}`);
    S.status[run] = s;
    S.statusAt[run] = performance.now();
    return s;
  }
  async function loadLive(run) {
    try { S.live[run] = await getJSON(`api/live?run=${run}`); } catch (e) { /* keep the last snapshot */ }
    return S.live[run];
  }
  async function loadNotices() {
    try {
      const n = (await getJSON("api/notices")).notices || [];
      const changed = JSON.stringify(n) !== JSON.stringify(S.notices);
      S.notices = n;
      return changed;
    } catch (e) { return false; }
  }
  async function loadBenchmarks() {
    try {
      const b = (await getJSON("api/benchmarks")).benchmarks || [];
      const changed = JSON.stringify(b) !== JSON.stringify(S.benchmarks);
      S.benchmarks = b;
      return changed;
    } catch (e) { return false; }
  }
  /* Hand-filled benchmark scores per run and step (live/benchmarks.json); a
     point appears when its step is on air. Step axis, linear, no smoothing. */
  function renderBenchmarks() {
    const host = $("benchmarks");
    if (!host) return;
    const list = S.benchmarks || [];
    if (!list.length) { host.innerHTML = ""; host.classList.add("hidden"); return; }
    host.classList.remove("hidden");
    if (!host.dataset.built) {
      host.innerHTML = `<div class="section-title">benchmarks</div><div class="bench-grid"></div>`;
      host.dataset.built = "1";
    }
    const grid = host.querySelector(".bench-grid");
    for (const c of Object.values(S.benchCharts)) c.destroy();
    S.benchCharts = {};
    grid.innerHTML = "";
    for (const b of list) {
      const format = b.format || "num2";
      const card = el("article", "card chart-card bench");
      /* [telemetry] 评测榜卡片没有 tag，遥测层靠这个属性知道点的是哪个榜 */
      card.dataset.bench = b.key;
      card.innerHTML = `<div class="card-head"><div class="card-title">${esc(b.title)}${b.note ? ` <span class="muted">${esc(b.note)}</span>` : ""}</div><div class="val"></div></div><div class="chart-body"></div>`;
      grid.appendChild(card);
      const series = runs().filter((r) => b.results[r.key]).map((r) => {
        const steps = Object.keys(b.results[r.key]).map(Number).sort((a, c) => a - c);
        return { key: r.key, label: runName(r.key), color: runColor(r.key), steps, walls: steps, runStart: 0, values: steps.map((st) => b.results[r.key][String(st)]) };
      });
      card.querySelector(".val").innerHTML = series.map((sr) => `<div><i class="swatch" style="background:${sr.color}"></i><span class="dim">${esc(sr.label)}</span> ${Fmt.text(lastOf(sr.values), format)}</div>`).join("") || `<span class="muted">—</span>`;
      const chart = new Charts.Line(card.querySelector(".chart-body"), { format, compact: true, legend: false, xMode: "step", smoothing: 0, log: false, points: true });
      chart.setData({ series });
      S.benchCharts[b.key] = chart;
    }
  }
  /* Operator notices (developer announcements, restart reasons), newest first;
     the block is absent when there are none. */
  function renderNotices() {
    const host = $("notices");
    if (!host) return;
    if (!S.notices.length) { host.innerHTML = ""; host.classList.add("hidden"); return; }
    host.classList.remove("hidden");
    const clockRun = runs()[0].key;
    host.innerHTML = `<div class="card notices"><div class="card-head"><div class="card-title">notices</div></div>` +
      S.notices.map((n) => `<div class="notice"><span class="tl-time" data-run="${esc(n.run || clockRun)}" data-t="${n.t}">${Fmt.ago(Math.max(0, (vnow(n.run || clockRun) || n.t) - n.t))}</span><span class="notice-text">${n.run ? `<span class="mono dim">${esc(runName(n.run))}</span> · ` : ""}${esc(n.text)}</span></div>`).join("") + `</div>`;
  }
  /* A report from before the latest trainer launch describes a process that
     no longer exists. */
  function beforeRestart(run, t) {
    const s = st(run);
    return !!(s && s.step.restarted_at != null && t != null && t < s.step.restarted_at);
  }
  /* Latest sampler report if it describes the step in progress: from the
     current trainer process and for the round after the last completed step.
     Age does not matter — the sampler goes quiet while the trainer trains,
     and its last count is the state of that round. */
  function liveLatest(run) {
    const l = S.live[run], s = st(run);
    if (!l || !l.latest || !l.latest.t || !s) return null;
    if (beforeRestart(run, l.latest.t)) return null;
    if (l.latest.step != null && l.latest.step <= s.step.last) return null;
    return l.latest;
  }
  async function loadTags(run) {
    const s = st(run);
    const have = S.tags[run];
    if (have && have.version === s.version) return have;
    const t = await getJSON(`api/tags?run=${run}&v=${encodeURIComponent(s.version)}`);
    S.tags[run] = { version: t.version, list: t.tags, set: new Set(t.tags) };
    S.union = null;
    return S.tags[run];
  }
  /* Union of every run's tags, as a list, a set and a folder tree. */
  async function loadUnion() {
    await Promise.all(runs().map((r) => loadTags(r.key)));
    const key = runs().map((r) => S.tags[r.key].version).join("|");
    if (S.union && S.union.key === key) return S.union;
    const set = new Set();
    for (const r of runs()) for (const t of S.tags[r.key].list) set.add(t);
    const list = Array.from(set).sort();
    S.union = { key, list, set, tree: buildTree(list) };
    return S.union;
  }
  const hasTag = (run, tag) => S.tags[run] && S.tags[run].set.has(tag);

  function store(run) {
    const s = st(run);
    let sc = S.series[run];
    if (!sc || (s && sc.version !== s.version)) {
      sc = S.series[run] = { version: s ? s.version : null, steps: null, walls: null, runStart: null, map: new Map(), pending: new Map(), queue: new Set(), timer: null };
    }
    return sc;
  }
  /* Batched, cached fetch. Resolves to the run's store; values in .map. */
  function getSeries(run, tags) {
    const sc = store(run);
    const need = tags.filter((t) => !sc.map.has(t));
    if (!need.length) return Promise.resolve(sc);
    const waits = [];
    for (const t of need) {
      if (!sc.pending.has(t)) {
        let resolve; const p = new Promise((r) => { resolve = r; }); p.resolve = resolve;
        sc.pending.set(t, p);
        sc.queue.add(t);
      }
      waits.push(sc.pending.get(t));
    }
    if (!sc.timer) sc.timer = setTimeout(() => flush(run), 30);
    return Promise.all(waits).then(() => sc);
  }
  async function flush(run) {
    const sc = store(run);
    sc.timer = null;
    const all = Array.from(sc.queue);
    sc.queue.clear();
    for (let i = 0; i < all.length; i += BATCH) {
      const chunk = all.slice(i, i + BATCH);
      try {
        const r = await getJSON(`api/series?run=${run}&v=${encodeURIComponent(sc.version || "")}&tags=${encodeURIComponent(chunk.join(","))}`);
        sc.steps = r.steps; sc.walls = r.walls; sc.runStart = r.run_start;
        for (const t of chunk) sc.map.set(t, r.series[t] || null);
      } catch (err) {
        for (const t of chunk) sc.map.set(t, null);
      }
      for (const t of chunk) { const p = sc.pending.get(t); if (p) { p.resolve(); sc.pending.delete(t); } }
    }
  }
  /* The same tag from every run that has it → chart series (run colours). */
  async function runSeries(tag) {
    const keys = runs().map((r) => r.key).filter((k) => hasTag(k, tag) || !S.tags[k]);
    const stores = await Promise.all(keys.map((k) => getSeries(k, [tag])));
    const out = [];
    keys.forEach((k, i) => {
      const sc = stores[i];
      const vals = sc.map.get(tag);
      if (!sc.steps || !vals) return;
      out.push({ key: k, label: runName(k), color: runColor(k), steps: sc.steps, walls: sc.walls, runStart: sc.runStart, values: vals });
    });
    return out;
  }

  // ------------------------------------------------------------- tag tree
  function buildTree(list) {
    const root = { name: "", path: "", children: new Map(), leaves: [], total: 0 };
    for (const tag of list) {
      const parts = tag.split("/");
      let node = root;
      node.total++;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        let c = node.children.get(p);
        if (!c) { c = { name: p, path: node.path ? `${node.path}/${p}` : p, children: new Map(), leaves: [], total: 0 }; node.children.set(p, c); }
        node = c;
        node.total++;
      }
      node.leaves.push(tag);
    }
    return root;
  }
  function nodeAt(tree, path) {
    if (!path) return tree;
    let node = tree;
    for (const p of path.split("/")) { node = node.children.get(p); if (!node) return null; }
    return node;
  }
  const sortedChildren = (node) => Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  /* Children c of prefix such that `${prefix}/${c}/${metric}` exists in the union (or the run). */
  function childrenWith(prefix, metric, run) {
    const node = nodeAt(S.union.tree, prefix);
    if (!node) return [];
    const has = (t) => run ? hasTag(run, t) : S.union.set.has(t);
    return sortedChildren(node).filter((c) => has(`${prefix}/${c.name}/${metric}`)).map((c) => c.name);
  }

  // -------------------------------------------------------------- controls
  function seg(pref, options, onChange, getVal, setVal) {
    const wrap = el("div", "seg");
    if (pref) wrap.dataset.pref = pref;
    const get = getVal || (() => S.prefs[pref]);
    const set = setVal || ((v) => { S.prefs[pref] = v; savePrefs(); });
    for (const [val, label] of options) {
      const b = el("button", null, label);
      b.dataset.val = String(val);
      b.addEventListener("click", () => { set(val); wrap.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.val === String(val))); (onChange || applyPrefs)(); });
      b.classList.toggle("active", String(get()) === String(val));
      wrap.appendChild(b);
    }
    return wrap;
  }
  function slider() {
    const wrap = el("div", "slider");
    wrap.dataset.pref = "smoothing";
    wrap.innerHTML = `<span class="ctl-label">smoothing</span><input type="range" min="0" max="0.95" step="0.05"><output></output>`;
    const input = wrap.querySelector("input"), out = wrap.querySelector("output");
    const sync = () => { input.value = S.prefs.smoothing; out.textContent = S.prefs.smoothing ? S.prefs.smoothing.toFixed(2) : "off"; };
    input.addEventListener("input", () => { S.prefs.smoothing = parseFloat(input.value); savePrefs(); sync(); applyPrefs(); });
    sync();
    return wrap;
  }
  function legendRow() {
    const lg = el("span", "legend-inline");
    lg.innerHTML = runs().map((r) => `<i class="swatch" style="background:${runColor(r.key)}"></i>${esc(runName(r.key))}`).join("");
    return lg;
  }
  function controlsRow(extra, opts) {
    const row = el("div", "controls");
    if (extra) row.append(...extra.filter(Boolean));
    row.append(seg("xMode", [["step", "step"], ["time", "time"]]), seg("log", [[false, "linear"], [true, "log"]]), slider());
    if (!(opts && opts.noLegend)) row.appendChild(legendRow());
    return row;
  }
  function applyPrefs() {
    const o = { xMode: S.prefs.xMode, smoothing: S.prefs.smoothing, log: S.prefs.log };
    for (const c of S.cards) if (c.chart) c.chart.setOptions(o);
    if (S.modal && S.modal.chart) S.modal.chart.setOptions(o);
    document.querySelectorAll(".seg[data-pref]").forEach((w) => { const p = w.dataset.pref; w.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === String(S.prefs[p]))); });
  }

  // ------------------------------------------------------------ chart card
  function clearCards() {
    for (const c of S.cards) if (c.chart) c.chart.destroy();
    S.cards = [];
    for (const c of Object.values(S.benchCharts)) c.destroy();
    S.benchCharts = {};
    if (S.io) S.io.disconnect();
    S.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const c = e.target.__card; if (c && !c.loaded) c.load(); }
    }, { rootMargin: "300px 0px" });
  }
  function tagHTML(tag, leafOnly) {
    const i = tag.lastIndexOf("/");
    if (leafOnly || i < 0) return esc(i < 0 ? tag : tag.slice(i + 1));
    return `<span class="dim">${esc(tag.slice(0, i + 1))}</span>${esc(tag.slice(i + 1))}`;
  }
  /* One lazily-loaded chart for a tag, every run overlaid. The value column
     shows each run's latest value. */
  function chartCard(tag, opts) {
    opts = opts || {};
    const format = fmtOf(tag);
    const card = el("article", `card chart-card${opts.large ? " large" : ""}`);
    card.innerHTML = `<div class="card-head"><div class="tag" title="${esc(tag)}">${tagHTML(tag, opts.leafOnly)}</div><div class="val"></div></div>
      ${opts.desc ? `<div class="desc">${esc(opts.desc)}</div>` : ""}<div class="chart-body"></div>`;
    card.querySelector(".tag").addEventListener("click", () => openChart(tag));
    const rec = { el: card, tag, format, chart: null, loaded: false };
    rec.load = async () => {
      rec.loaded = true;
      const series = await runSeries(tag);
      if (!card.isConnected) return;
      if (!rec.chart) rec.chart = new Charts.Line(card.querySelector(".chart-body"), { format, compact: !opts.large, legend: false, xMode: S.prefs.xMode, smoothing: S.prefs.smoothing, log: S.prefs.log });
      rec.chart.setData({ series });
      card.querySelector(".val").innerHTML = series.map((s) => {
        const last = lastOf(s.values), prev = prevOf(s.values), d = Fmt.delta(last, prev, format);
        return `<div><i class="swatch" style="background:${s.color}"></i>${last == null ? "—" : Fmt.text(last, format)}${d ? Fmt.deltaHTML(d, null, "") : ""}</div>`;
      }).join("") || `<span class="muted">—</span>`;
    };
    card.__card = rec;
    S.cards.push(rec);
    S.io.observe(card);
    return card;
  }

  // --------------------------------------------------------------- overview
  async function renderOverview(root) {
    root.innerHTML = `<div id="notices" class="hidden"></div>`;
    renderNotices();
    for (const r of runs()) root.appendChild(statusBlock(r.key));
    root.appendChild(Object.assign(el("div", "section hidden"), { id: "benchmarks" }));
    renderBenchmarks();
    root.appendChild(controlsRow());
    const grid = el("div", "chart-grid");
    root.appendChild(grid);
    for (const tag of S.cfg.pins) grid.appendChild(chartCard(tag));
    for (const r of runs()) {
      const sec = el("div", "section");
      sec.innerHTML = `<div class="section-title">dynamic sampler <span class="muted">${esc(runName(r.key))}</span></div>`;
      const row = el("div", "live-row");
      row.dataset.run = r.key;
      row.innerHTML = `<article class="card feed"><div class="card-head"><div class="card-title">feed</div><div class="card-note" data-f="log-time"></div></div><div class="feed-list" data-f="feed"></div></article>
        <article class="card sources"><div class="card-head"><div class="card-title" data-f="src-title">data sources</div><div class="card-note" data-f="src-note"></div></div><div class="table-wrap" data-f="src-table"></div></article>`;
      sec.appendChild(row);
      root.appendChild(sec);
      renderLive(r.key);
    }

    const comp = el("div", "section");
    comp.innerHTML = `<div class="section-title">batch composition <span class="muted">what each step's samples are made of</span></div><div id="comp"></div>`;
    root.appendChild(comp);
    tick();
    await loadUnion();
    if (!root.isConnected || S.view !== "overview") return;
    await renderComposition($("comp"));
  }

  function statusBlock(run) {
    const s = st(run), rc = runCfg(run);
    const final = s.run.mode === "ended";
    // [telemetry] 回放时把状态词换成切面时刻，免得被读成"这一步正在跑"
    const stateText = M.replay()
      ? `replay · ${new Date((s.clock.now || 0) * 1000).toISOString().replace("T", " ").slice(5, 16)}Z`
      : final ? "stopped" : "in progress";
    const block = el("div", "status");
    block.dataset.run = run;
    block.innerHTML = `
      <div class="status-line">
        <span class="status-name"><i class="swatch" style="background:${runColor(run)}"></i><b class="mono">${esc(rc.label)}</b><span class="muted state">${stateText}</span></span>
        <span class="big" data-f="step"></span>
        <span class="clock-col"><span class="mono" data-f="clock"></span><span class="started" data-f="started"></span></span>
        <span class="phase" data-f="phase"><span class="phase-track"><span class="phase-fill"></span><span class="phase-divider"></span></span><span class="phase-text"></span></span>
      </div>
      <div class="kv" data-f="kv"></div>`;
    return block;
  }

  function renderKV(run) {
    const block = document.querySelector(`.status[data-run="${run}"]`);
    if (!block) return;
    const s = st(run), t = s.totals || {}, h = s.headline || {};
    const hf = h.tag ? fmtOf(h.tag) : "ratio";
    const hd = Fmt.delta(h.last, h.first, hf);   // total row: change since the first step
    // rollouts per prompt: sequences trained this step ÷ prompts in the batch (16 on every step so far)
    const nPer = t.trained_step && t.prompts_per_step && Math.abs(t.trained_step / t.prompts_per_step - Math.round(t.trained_step / t.prompts_per_step)) < 1e-6 ? Math.round(t.trained_step / t.prompts_per_step) : null;
    const cells = [
      [`${h.tag || "headline"}${h.first_step != null && s.step.last > h.first_step ? ` · Δ vs step ${h.first_step}` : ""}`, h.last == null ? "—" : `${Fmt.text(h.last, hf)}${hd ? ` <span class="delta ${hd.dir === "flat" ? "flat" : ""}">${hd.dir === "up" ? "▲" : hd.dir === "down" ? "▼" : ""}${hd.text}</span>` : ""}`],
      ["cost so far", `<span data-f="cost">—</span>`],
      [`tokens · step ${s.step.last || "—"}`, Fmt.compact(t.tokens_step, 3)],
      ["tokens · total", Fmt.compact(t.tokens_cum, 3)],
      ["samples trained", Fmt.compact(t.trained_cum, 3)],
      ["train batch size × n", nPer ? `${Fmt.int(t.prompts_per_step)} × ${nPer}<span class="u">seqs</span>` : `${Fmt.int(t.prompts_per_step)}<span class="u">prompts</span>`],
    ];
    block.querySelector('[data-f="kv"]').innerHTML = cells.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join("");
  }

  // ------------------------------------------------------------------ live
  /* Feed = sampler reports + step completions + restarts, newest first; plus
     the per-source table of the latest report. */
  function renderLive(run) {
    const row = document.querySelector(`.live-row[data-run="${run}"]`);
    if (!row) return;
    const l = S.live[run], s = st(run);
    const now = vnow(run);
    const feed = row.querySelector('[data-f="feed"]');
    // step of a sampler report: from the log's own step marks, else the last
    // completed step before it (from the metrics timeline) + 1
    const done = (s.events || []).filter((e) => e.kind === "step").map((e) => e.t).sort((a, b) => a - b);
    const stepAt = (t) => { let n = 0; for (const d of done) if (d <= t) n++; else break; return n + 1; };
    const items = [];
    if (l) for (const e of l.entries) items.push({ t: e.t, kind: "rew", e: e.step ? e : { ...e, step: e.t ? stepAt(e.t) : null } });
    for (const e of (s.events || [])) items.push({ t: e.t, kind: e.kind, e });
    items.sort((a, b) => (b.t || 0) - (a.t || 0));
    const hf = s.headline && s.headline.tag ? fmtOf(s.headline.tag) : "ratio";
    feed.innerHTML = items.slice(0, 40).map((it) => {
      const when = `<span class="tl-time" data-run="${run}" data-t="${it.t || ""}">${it.t ? Fmt.ago(now - it.t) : ""}</span>`;
      if (it.kind === "rew") {
        const e = it.e;
        return `<div class="tl-item rew">${when}<span class="tl-text">accepted <b>${Fmt.int(e.accept)}/${Fmt.int(e.target)}</b> · judged ${Fmt.int(e.judged)} · pass ${e.passrate.toFixed(3)} <span class="muted">(n=${Fmt.int(e.n)})</span> · remaining ${Fmt.int(e.remain)} <span class="muted">+${Fmt.int(e.remain_partial)} partial +${Fmt.int(e.remain_seq)} rewarding</span> · prewarm ${Fmt.int(e.prewarm)}</span><span class="tl-meta">${e.step ? `step ${e.step}` : ""}</span></div>`;
      }
      if (it.kind === "step") {
        const e = it.e;
        const d = e.delta != null ? `<span class="delta">${e.delta > 0 ? "▲" : e.delta < 0 ? "▼" : ""}${Math.abs(e.delta).toFixed(3)}</span>` : "";
        return `<div class="tl-item step">${when}<span class="tl-text"><b>step ${e.step} done${e.redo ? " again" : ""}</b> · ${esc(s.headline.tag || "")} ${e.value != null ? Fmt.text(e.value, hf) : "—"} ${d}</span><span class="tl-meta">${e.tokens != null ? `${Fmt.compact(e.tokens, 3)} tok` : ""}</span></div>`;
      }
      if (it.kind === "end") return `<div class="tl-item restart">${when}<span class="tl-text">run stopped</span><span class="tl-meta"></span></div>`;
      return `<div class="tl-item restart">${when}<span class="tl-text">trainer restarted</span><span class="tl-meta"></span></div>`;
    }).join("") || `<div class="muted">no sampler reports yet</div>`;
    // [telemetry] 回放时采样器明细可能只有同步粒度（老仓库没留 30 秒级明细），标出来
    const granNote = l && l.entries_approx ? T(" · 明细为同步粒度") : "";
    row.querySelector('[data-f="log-time"]').textContent = (l && l.log_time && now != null ? `log ${Fmt.ago(Math.max(0, now - l.log_time))}`.replace("just now", "up to date") : "") + granNote;

    const latest = l && l.latest;
    const title = row.querySelector('[data-f="src-title"]'), note = row.querySelector('[data-f="src-note"]'), tbl = row.querySelector('[data-f="src-table"]');
    if (!latest) { title.textContent = "data sources"; note.textContent = ""; tbl.innerHTML = `<div class="muted">no sampler report yet</div>`; return; }
    const stepNo = latest.step || (latest.t ? stepAt(latest.t) : s.step.last + 1);
    const stale = beforeRestart(run, latest.t);
    title.innerHTML = `step ${stepNo} · accepted <span class="mono">${Fmt.int(latest.accept)}/${Fmt.int(latest.target)}</span>${stale ? ` <span class="muted">· last report before the restart</span>` : ""}`;
    note.textContent = latest.t ? Fmt.ago(now - latest.t) : "";
    const rows = Object.entries(latest.ds).map(([name, v]) => ({ name, acc: v[0], tgt: v[1], j: v[2], r: v[3] })).sort((a, b) => b.tgt - a.tgt || b.acc - a.acc);
    const inflight = rows.reduce((a, r) => a + (r.r || 0), 0);
    tbl.innerHTML = `<table class="tbl src"><thead><tr><th>source</th><th>accepted / target</th><th></th><th>remaining</th><th>judged</th><th>in flight</th></tr></thead><tbody>
      ${rows.map((r) => { const pct = r.tgt ? Math.min(1, r.acc / r.tgt) : 0; return `<tr><td>${esc(r.name)}</td><td>${Fmt.int(r.acc)} / ${Fmt.int(r.tgt)}</td><td class="bar"><div class="row-bar"><div class="row-bar-fill" style="width:${pct * 100}%"></div></div></td><td>${Fmt.int(Math.max(0, r.tgt - r.acc))}</td><td class="${r.j == null ? "dim" : ""}">${r.j == null ? "—" : Fmt.int(r.j)}</td><td class="${r.r == null ? "dim" : ""}">${r.r == null ? "—" : Fmt.int(r.r)}</td></tr>`; }).join("")}
      <tr class="total"><td>total</td><td>${Fmt.int(latest.accept)} / ${Fmt.int(latest.target)}</td><td></td><td>${Fmt.int(Math.max(0, latest.target - latest.accept))}</td><td>${Fmt.int(latest.judged)}</td><td>${Fmt.int(inflight)}</td></tr>
      </tbody></table>`;
  }

  // ----------------------------------------------------------- composition
  async function renderComposition(host) {
    const presets = S.cfg.compositions || [];
    if (!presets.length) { host.innerHTML = ""; return; }
    const cp = presets.find((p) => p.key === S.comp) || presets[0];
    S.comp = cp.key;
    if (!S.compRun || !runCfg(S.compRun)) S.compRun = runs()[0].key;
    const run = S.compRun;
    host.innerHTML = "";
    const ctl = el("div", "controls");
    ctl.append(
      el("span", "ctl-label", "by"),
      seg(null, presets.map((p) => [p.key, p.label]), () => renderComposition(host), () => S.comp, (v) => { S.comp = v; }),
      el("span", "ctl-label", "run"),
      seg(null, runs().map((r) => [r.key, runName(r.key)]), () => renderComposition(host), () => S.compRun, (v) => { S.compRun = v; }),
      seg("compMode", [["count", "count"], ["share", "share"]], () => renderComposition(host)),
    );
    host.appendChild(ctl);
    const layout = el("div", "comp-layout");
    host.appendChild(layout);
    if (cp.derive === "trained") await renderTrainedComposition(layout, cp, run);
    else await renderMetricComposition(layout, cp, run);
  }

  /* Trained prompts per step per category. A source's pool of accepted
     prompts obeys held(t) = held(t−1) + accepted(t) − trained(t) − expired(t),
     so trained(t) ≈ held(t−1) + accepted(t) − held(t) (dynsam/<src>/num_accepted/*);
     summed over sources it equals the train batch. On the first step after
     a (re)start `held` is reported before consumption, so those steps fall
     back to carryover + a proportional share of the fresh accepts. */
  async function renderTrainedComposition(layout, cp, run) {
    const groups = cp.groups || S.cfg.categories || [];
    const items = groups.flatMap((g) => childrenWith(`${cp.prefix}/${g}`, "num_accepted/step", run).map((d) => ({ g, key: `${g}/${d}` })));
    layout.innerHTML = `<article class="card"><div class="card-head"><div class="card-title">trained prompts per step, by category</div><div class="card-note">${items.length} sources · derived from ${esc(cp.prefix)}/*/num_accepted</div></div><div class="comp-chart"></div></article><article class="card comp-table"></article>`;
    if (!items.length) { layout.querySelector(".comp-chart").innerHTML = `<div class="muted">no data</div>`; return; }
    const tags = items.flatMap((it) => ["step", "held", "carryover"].map((k) => `${cp.prefix}/${it.key}/num_accepted/${k}`));
    tags.push("dynsam/num_target");
    const sc = await getSeries(run, tags);
    if (!layout.isConnected) return;
    const n = sc.steps.length;
    const get = (it, k) => sc.map.get(`${cp.prefix}/${it.key}/num_accepted/${k}`) || [];
    const bszSeries = sc.map.get("dynsam/num_target") || [];
    const trained = items.map(() => new Array(n).fill(0));
    const approx = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const bsz = bszSeries[i] || (st(run).totals && st(run).totals.prompts_per_step) || 0;
      let sum = 0;
      const rec = items.map((it, k) => { const a = get(it, "step")[i] || 0, h = get(it, "held")[i] || 0, hp = i ? (get(it, "held")[i - 1] || 0) : null; const v = hp == null ? null : Math.max(0, hp + a - h); if (v != null) sum += v; return v; });
      const sane = i > 0 && bsz && Math.abs(sum - bsz) <= 0.05 * bsz;
      if (sane) rec.forEach((v, k) => { trained[k][i] = v; });
      else {
        approx[i] = true;
        const carry = items.map((it) => get(it, "carryover")[i] || 0), acc = items.map((it) => get(it, "step")[i] || 0);
        const fresh = Math.max(0, bsz - carry.reduce((x, y) => x + y, 0)), accSum = acc.reduce((x, y) => x + y, 0) || 1;
        items.forEach((it, k) => { trained[k][i] = carry[k] + acc[k] * fresh / accSum; });
      }
    }
    const pal = Charts.palette();
    const series = groups.map((g, gi) => ({ key: g, label: g, color: pal[gi % pal.length],
      values: Array.from({ length: n }, (_, i) => items.reduce((a, it, k) => a + (it.g === g ? trained[k][i] : 0), 0)) }));
    const chart = new Charts.Stacked(layout.querySelector(".comp-chart"), { mode: S.prefs.compMode, xMode: S.prefs.xMode });
    chart.setData({ steps: sc.steps, walls: sc.walls, runStart: sc.runStart, series });
    S.cards.push({ chart, loaded: true, load() {} });

    const last = n - 1, prev = n - 2;
    const tot = (i) => series.reduce((a, sr) => a + sr.values[i], 0);
    const total = tot(last), prevTotal = prev >= 0 ? tot(prev) : 0;
    const bsz = bszSeries[last] || (st(run).totals && st(run).totals.prompts_per_step);
    const tbl = layout.querySelector(".comp-table");
    tbl.innerHTML = `<div class="card-head"><div class="card-title">step ${sc.steps[last]}</div><div class="card-note">${approx[last] ? "≈ " : ""}${Fmt.int(total)} prompts${bsz ? ` · train batch ${Fmt.int(bsz)}` : ""}</div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>category</th><th>sources</th><th>prompts</th><th>share</th><th>Δ share</th></tr></thead><tbody>
      ${series.map((sr, gi) => { const v = sr.values[last], sh = total ? v / total : 0, ps = prevTotal ? sr.values[prev] / prevTotal : null, d = ps == null ? null : sh - ps;
        return `<tr><td><i class="swatch" style="background:${sr.color}"></i>${esc(sr.label)}</td><td class="dim">${items.filter((it) => it.g === sr.key).length}</td><td>${Fmt.int(v)}</td><td>${(sh * 100).toFixed(1)}%</td><td class="${d == null ? "dim" : ""}">${d == null ? "—" : `${d > 0 ? "▲" : d < 0 ? "▼" : ""}${Math.abs(d * 100).toFixed(1)} pt`}</td></tr>`; }).join("")}
      <tr class="total"><td>total</td><td class="dim">${items.length}</td><td>${Fmt.int(total)}</td><td>100%</td><td></td></tr>
      </tbody></table></div>${approx.some(Boolean) ? `<div class="muted" style="margin-top:8px;font-size:11.5px">≈ steps right after a restart report the pool before consumption; there the split is carryover + a proportional share of fresh accepts.</div>` : ""}`;
  }

  async function renderMetricComposition(layout, cp, run) {
    let items = childrenWith(cp.prefix, cp.metric, run);
    if (cp.expand) items = items.flatMap((c) => { const sub = childrenWith(`${cp.prefix}/${c}`, cp.metric, run).filter((g) => g !== "harness"); return sub.length ? sub.map((g) => `${c}/${g}`) : [c]; });
    layout.innerHTML = `<article class="card"><div class="card-head"><div class="card-title mono">${esc(cp.prefix)}/*/${esc(cp.metric)}</div><div class="card-note">${items.length} sources · ${esc(cp.unit || "")} per step</div></div><div class="comp-chart"></div></article><article class="card comp-table"></article>`;
    if (!items.length) { layout.querySelector(".comp-chart").innerHTML = `<div class="muted">no data</div>`; return; }
    const tags = items.map((c) => `${cp.prefix}/${c}/${cp.metric}`);
    const sc = await getSeries(run, tags);
    if (!layout.isConnected) return;
    const n = sc.steps.length;
    const rows = items.map((c, i) => ({ c, vals: sc.map.get(tags[i]) || [], last: lastOf(sc.map.get(tags[i])), prev: prevOf(sc.map.get(tags[i])) }));
    rows.sort((a, b) => (b.last || 0) - (a.last || 0));
    const shown = rows.length > MAX_SERIES ? rows.slice(0, MAX_SERIES - 1) : rows;
    const tail = rows.length > MAX_SERIES ? rows.slice(MAX_SERIES - 1) : [];
    const pal = Charts.palette();
    const series = shown.map((r, i) => ({ key: r.c, label: r.c, color: pal[i], values: r.vals.map((v) => v || 0) }));
    if (tail.length) series.push({ key: "_other", label: `other (${tail.length})`, color: getComputedStyle(document.documentElement).getPropertyValue("--baseline").trim(), values: Array.from({ length: n }, (_, i) => tail.reduce((a, r) => a + (r.vals[i] || 0), 0)) });
    const chart = new Charts.Stacked(layout.querySelector(".comp-chart"), { mode: S.prefs.compMode, xMode: S.prefs.xMode });
    chart.setData({ steps: sc.steps, walls: sc.walls, runStart: sc.runStart, series });
    S.cards.push({ chart, loaded: true, load() {} });
    const total = rows.reduce((a, r) => a + (r.last || 0), 0), prevTotal = rows.reduce((a, r) => a + (r.prev || 0), 0);
    const tbl = layout.querySelector(".comp-table");
    tbl.innerHTML = `<div class="card-head"><div class="card-title">step ${sc.steps[n - 1]}</div><div class="card-note">${Fmt.int(total)} ${esc(cp.unit || "")}</div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>source</th><th>${esc(cp.unit || "n")}</th><th>share</th><th>Δ share</th></tr></thead><tbody>
      ${rows.map((r, i) => { const sh = total ? (r.last || 0) / total : 0, ps = prevTotal ? (r.prev || 0) / prevTotal : null, d = ps == null ? null : sh - ps; const color = i < shown.length ? pal[i] : "var(--surface-3)";
        return `<tr><td><i class="swatch" style="background:${color}"></i>${esc(r.c)}</td><td>${Fmt.int(r.last)}</td><td>${(sh * 100).toFixed(1)}%</td><td class="${d == null ? "dim" : ""}">${d == null ? "—" : `${d > 0 ? "▲" : d < 0 ? "▼" : ""}${Math.abs(d * 100).toFixed(1)} pt`}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- metrics
  async function renderMetrics(root) {
    root.innerHTML = `<div id="m-controls"></div><div class="metrics-layout"><nav class="tree" id="tree"></nav><div id="m-main"><div class="muted">loading tags…</div></div></div>`;
    const search = el("input", "search");
    search.type = "search"; search.placeholder = "filter tags (substring or /regex/)"; search.value = S.query;
    let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { S.query = search.value.trim(); S.page = PAGE; renderMetricsMain(); }, 150); });
    $("m-controls").replaceWith(controlsRow([search]));
    await loadUnion();
    if (!root.isConnected || S.view !== "metrics") return;
    renderTree();
    renderMetricsMain();
  }
  function renderTree() {
    const host = $("tree");
    if (!host) return;
    host.innerHTML = "";
    if (S.expandedFor !== S.path) { for (const p of ancestors(S.path)) S.expanded.add(p); S.expandedFor = S.path; }
    const build = (node) => {
      const frag = document.createDocumentFragment();
      for (const c of sortedChildren(node)) {
        const has = c.children.size > 0;
        const open = S.expanded.has(c.path);
        const row = el("div", `tree-node${S.path === c.path ? " active" : ""}`);
        row.innerHTML = `<span class="tw">${has ? (open ? "▾" : "▸") : ""}</span><span class="nm">${esc(c.name)}</span><span class="cnt">${c.total}</span>`;
        row.querySelector(".tw").addEventListener("click", (e) => { e.stopPropagation(); if (S.expanded.has(c.path)) S.expanded.delete(c.path); else S.expanded.add(c.path); renderTree(); });
        row.addEventListener("click", () => { location.hash = `#metrics/${c.path}`; });
        frag.appendChild(row);
        if (has && open) { const kids = el("div", "tree-children"); kids.appendChild(build(c)); frag.appendChild(kids); }
      }
      return frag;
    };
    host.appendChild(build(S.union.tree));
  }
  function ancestors(path) {
    const out = [];
    if (!path) return out;
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
    return out;
  }
  function renderMetricsMain() {
    const main = $("m-main");
    if (!S.union || !main) return;
    for (const c of S.cards) if (c.chart) c.chart.destroy();
    S.cards = [];
    main.innerHTML = "";
    let leaves, folders = [], title;
    if (S.query) {
      let test;
      const m = S.query.match(/^\/(.+)\/([a-z]*)$/);
      try { test = m ? new RegExp(m[1], m[2]) : null; } catch (e) { test = null; }
      const q = S.query.toLowerCase();
      leaves = S.union.list.filter((t) => test ? test.test(t) : t.toLowerCase().includes(q));
      title = `<div class="crumbs"><span class="cur">${leaves.length} tags match</span> <span class="muted">${esc(S.query)}</span></div>`;
    } else {
      const node = nodeAt(S.union.tree, S.path);
      if (!node) { main.innerHTML = `<div class="muted">no such path: ${esc(S.path)}</div>`; return; }
      leaves = node.leaves.slice().sort();
      folders = sortedChildren(node);
      const parts = S.path ? S.path.split("/") : [];
      title = `<div class="crumbs"><a data-p="">all</a>${parts.map((p, i) => `<span class="sepc">/</span>${i === parts.length - 1 ? `<span class="cur">${esc(p)}</span>` : `<a data-p="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`}`).join("")}<span class="muted">&nbsp; ${node.total} tags</span></div>`;
    }
    main.innerHTML = title;
    main.querySelectorAll(".crumbs a").forEach((a) => a.addEventListener("click", () => { location.hash = `#metrics/${a.dataset.p}`; }));
    if (folders.length) {
      const fl = el("div", "folders");
      for (const f of folders) { const b = el("button", "folder", `${esc(f.name)}/<span class="cnt">${f.total}</span>`); b.addEventListener("click", () => { location.hash = `#metrics/${f.path}`; }); fl.appendChild(b); }
      main.appendChild(fl);
    }
    const grid = el("div", "chart-grid");
    main.appendChild(grid);
    const show = leaves.slice(0, S.page);
    for (const tag of show) grid.appendChild(chartCard(tag, { leafOnly: !S.query }));
    if (leaves.length > show.length) {
      const more = el("div", "more", `<button>show ${Math.min(PAGE, leaves.length - show.length)} more <span class="muted">(${leaves.length - show.length} left)</span></button>`);
      more.querySelector("button").addEventListener("click", () => { S.page += PAGE; renderMetricsMain(); });
      main.appendChild(more);
    }
    if (!leaves.length && !folders.length) main.appendChild(el("div", "muted", "nothing here"));
  }

  // ------------------------------------------------------------------ about
  function renderAbout(root) {
    const linkify = (t) => esc(t)
      .replace(/(https?:\/\/[^\s)]+)/g, (u) => `<a class="link" href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/(^|\s)(@[A-Za-z0-9_]+)/g, (m, sp, h) => `${sp}<a class="link" href="${esc((S.cfg.social && S.cfg.social.url) || `https://x.com/${h.slice(1)}`)}" target="_blank" rel="noopener">${h}</a>`);
    root.innerHTML = `<div class="page-head"><div><h1 class="page-title">about</h1></div></div><div class="prose">${(S.cfg.about || []).map((t) => `<p>${linkify(t)}</p>`).join("")}</div>`;
  }

  // ------------------------------------------------------------------ modal
  async function openChart(tag) {
    const format = fmtOf(tag);
    $("modal-title").textContent = tag;
    $("modal-desc").textContent = descOf(tag);
    $("modal-stats").innerHTML = "";
    if (S.modal && S.modal.chart) S.modal.chart.destroy();
    S.modal = { tag, chart: new Charts.Line($("modal-chart"), { format, xMode: S.prefs.xMode, smoothing: S.prefs.smoothing, log: S.prefs.log }) };
    $("modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    if (!S.returnHash) S.returnHash = location.hash || "#overview";
    history.replaceState(null, "", `#chart/${encodeURIComponent(tag)}`);
    const series = await runSeries(tag);
    if (!S.modal || S.modal.tag !== tag) return;
    S.modal.chart.setData({ series });
    const stat = (k, v) => `<span class="stat"><span class="stat-label">${k}</span><span>${v}</span></span>`;
    $("modal-stats").innerHTML = series.map((s) => {
      const clean = s.values.filter((v) => v != null);
      const last = lastOf(s.values), prev = prevOf(s.values), d = Fmt.delta(last, prev, format);
      return `<div class="stat-row"><i class="swatch" style="background:${s.color}"></i><span class="stat-run">${esc(s.label)}</span>${stat("last", Fmt.text(last, format))}${stat("Δ", d ? Fmt.deltaHTML(d, null, "") : "—")}${clean.length ? stat("min", Fmt.text(Math.min(...clean), format)) + stat("max", Fmt.text(Math.max(...clean), format)) + stat("mean", Fmt.text(clean.reduce((a, b) => a + b, 0) / clean.length, format)) : ""}${stat("points", String(clean.length))}</div>`;
    }).join("");
  }
  function closeModal(restore) {
    if ($("modal").classList.contains("hidden")) return;
    $("modal").classList.add("hidden");
    document.body.style.overflow = "";
    if (S.modal && S.modal.chart) S.modal.chart.destroy();
    S.modal = null;
    if (restore !== false) history.replaceState(null, "", S.returnHash || "#overview");
    S.returnHash = null;
  }
  $("modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ----------------------------------------------------------------- clocks
  const ZONES = [["Beijing", "Asia/Shanghai"], ["Los Angeles", "America/Los_Angeles"], ["New York", "America/New_York"], ["London", "Europe/London"]];
  const zoneFmt = ZONES.map(([, tz]) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
  /* [telemetry] 存档快照自己的时刻（epoch 秒）：离线副本、回放切面由遥测层给出；
     服务端重建的存档用 status 自己的 clock（服务端已按数据时刻上报，不是本机时间）。
     在线实时没有这个概念，返回 null —— 那种情况才该显示本机当前时间。 */
  function dataAt() {
    if (M.dataAt) { const t = M.dataAt(); if (t != null) return t; }
    if (!isSnapshot()) return null;
    let t = null;
    for (const r of runs()) {
      const s = st(r.key);
      if (s && s.clock && s.clock.now != null) t = t == null ? s.clock.now : Math.max(t, s.clock.now);
    }
    return t;
  }
  /* 采集时间的两种写法：UTC 一份、北京一份（读者不用自己换算）。北京那边只有跨天时
     才带上日期，否则一个时刻写两遍日期反而更长。 */
  function stamps(at) {
    const iso = (sec) => new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16);
    const u = iso(at), b = iso(at + 8 * 3600);
    return [`${u} UTC`, b.slice(0, 10) === u.slice(0, 10) ? b.slice(11) : b];
  }
  function renderClocks(total) {
    const host = $("nav-status");
    if (!host.dataset.built) {
      host.innerHTML = `<div class="nav-cell nav-cost"><span class="k">total cost</span><span class="v" data-f="cost"></span></div>` +
        ZONES.map(([city], i) => `<div class="nav-cell"><span class="k">${city}</span><span class="v" data-z="${i}"></span></div>`).join("");
      host.dataset.built = "1";
    }
    host.querySelector('[data-f="cost"]').textContent = total == null ? "—" : `$${Math.floor(total).toLocaleString("en-US")}`;
    const at = dataAt();
    const now = at == null ? new Date() : new Date(at * 1000);
    host.querySelectorAll("[data-z]").forEach((e) => { e.textContent = zoneFmt[+e.dataset.z].format(now); });
    /* [telemetry] 快照里的时钟与总成本都停在采集那一刻，鼠标移上去说明"数据是什么时候采的"。
       实时模式下按原样显示本机时间，不挂提示。 */
    const cells = Array.from(host.querySelectorAll(".nav-cell"));
    if (at == null) { cells.forEach((c) => { c.classList.remove("is-static"); c.removeAttribute("title"); }); return; }
    const [u, b] = stamps(at), isReplay = M.replay();
    cells.forEach((c) => {
      const cost = c.classList.contains("nav-cost");
      c.classList.add("is-static");
      c.title = cost
        ? (isReplay ? T("这个切面的累计成本（{0} / 北京时间 {1}）", u, b) : T("快照里的累计成本（采集于 {0} / 北京时间 {1}）", u, b))
        : (isReplay ? T("回放切面 · 时钟停在 {0}（北京时间 {1}）", u, b) : T("存档快照 · 数据采集自 {0}（北京时间 {1}）", u, b));
    });
  }

  // ------------------------------------------------------------------- tick
  function tick() {
    if (!S.cfg) return;
    // nav: total cost across runs + a UTC clock
    let total = 0, any = false;
    for (const r of runs()) {
      const s = st(r.key);
      if (!s || !s.cost || !s.cost.rate_per_s) continue;
      any = true;
      total += s.run.mode === "ended" ? s.cost.so_far : s.cost.rate_per_s * Math.max(0, vnow(r.key) - s.run.start);
    }
    renderClocks(any ? total : null);

    for (const r of runs()) {
      const s = st(r.key), block = document.querySelector(`.status[data-run="${r.key}"]`);
      if (!s || !block) continue;
      const final = s.run.mode === "ended";
      const now = vnow(r.key);
      const p = s.step;
      block.querySelector('[data-f="step"]').textContent = `step ${p.last}`;
      block.querySelector('[data-f="clock"]').textContent = Fmt.clock((final ? s.run.end : now) - s.run.start);
      block.querySelector('[data-f="started"]').textContent = `started ${new Date(s.run.start * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
      const phase = block.querySelector('[data-f="phase"]');
      if (final) {
        phase.innerHTML = `<span class="phase-text">stopped ${new Date(s.run.end * 1000).toISOString().slice(0, 10)}</span>`;
      } else {
        /* [telemetry] 快照（离线副本 / 回放切面）里这一步不会真的往前走，耗时也停在数据时刻 */
        const since = p.since + (isSnapshot() ? 0 : (performance.now() - S.statusAt[r.key]) / 1000);
        const fill = phase.querySelector(".phase-fill"), div = phase.querySelector(".phase-divider"), text = phase.querySelector(".phase-text");
        const lv = liveLatest(r.key);
        if (fill && lv) {
          const q = lv.target ? Math.min(1, lv.accept / lv.target) : 0;
          const ph = lv.accept >= lv.target ? "training" : "rollout";
          fill.classList.remove("indeterminate");
          fill.style.width = `${q * 100}%`;
          div.classList.remove("visible");
          text.innerHTML = `step ${lv.step || p.last + 1}: <b>${ph}</b> · ${Fmt.int(lv.accept)}/${Fmt.int(lv.target)} accepted · ${Fmt.duration(since, { seconds: true })} in`;
        } else if (fill && p.restarted_at != null) {
          // a new trainer process, no sampler report from it yet: nothing to measure
          fill.classList.add("indeterminate");
          div.classList.remove("visible");
          text.innerHTML = `<b>restarting</b> · trainer relaunched ${Fmt.duration(since, { seconds: true })} ago`;
        } else if (fill) {
          let ph = "rollout";
          if (p.expected) {
            const q = Math.min(1, since / p.expected);
            if (p.gen_frac != null && q >= p.gen_frac) ph = "training";
            fill.classList.remove("indeterminate");
            fill.style.width = `${q * 100}%`;
            div.classList.toggle("visible", p.gen_frac != null);
            if (p.gen_frac != null) div.style.left = `${p.gen_frac * 100}%`;
            text.innerHTML = `step ${p.last + 1}: <b>${ph}</b> · ${Fmt.duration(since, { seconds: true })} in`;
          } else {
            fill.classList.add("indeterminate");
            div.classList.remove("visible");
            text.innerHTML = `step ${p.last + 1}: <b>rollout</b> · ${Fmt.duration(since, { seconds: true })} in`;
          }
        }
      }
      const costEl = block.querySelector('[data-f="cost"]');
      if (costEl && s.cost && s.cost.rate_per_s) {
        const cost = final ? s.cost.so_far : s.cost.rate_per_s * Math.max(0, now - s.run.start);
        costEl.textContent = `$${Math.floor(cost).toLocaleString("en-US")}`;
      }
    }
    document.querySelectorAll(".tl-time[data-t]").forEach((e) => { const now = vnow(e.dataset.run); if (now != null) e.textContent = Fmt.ago(now - parseFloat(e.dataset.t)); });
  }

  // ----------------------------------------------------------------- router
  function parseHash() {
    const parts = location.hash.replace(/^#/, "").split("/");
    const view = parts.shift() || "overview";
    return { view, rest: parts };
  }
  async function route() {
    if (!S.cfg) return;
    const { view, rest } = parseHash();
    let chartTag = null;
    if (view === "chart") { try { chartTag = decodeURIComponent(rest.join("/")); } catch (e) { chartTag = null; } }
    if (!chartTag) {
      closeModal(false);
      S.view = ["overview", "metrics", "about"].includes(view) ? view : "overview";
      if (S.view === "metrics") { S.path = rest.join("/"); S.page = PAGE; }
    } else if (!S.rendered) S.view = "overview";
    document.querySelectorAll("#tabs a").forEach((a) => { a.classList.toggle("active", a.dataset.view === S.view); a.href = `#${a.dataset.view}`; });
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${S.view}`));
    if (chartTag) {
      if (!S.rendered) await renderView();
      S.returnHash = `#${S.view}`;
      openChart(chartTag);
      return;
    }
    await renderView();
    window.scrollTo(0, 0);
  }
  async function renderView() {
    if (!S.cfg || !runs().every((r) => st(r.key))) return;
    clearCards();
    S.rendered = true;
    const root = $(`view-${S.view}`);
    try {
      if (S.view === "overview") { await renderOverview(root); for (const r of runs()) renderKV(r.key); }
      else if (S.view === "metrics") await renderMetrics(root);
      else renderAbout(root);
    } catch (err) {
      root.innerHTML = `<div class="muted">failed to render: ${esc(err.message || err)}</div>`;
    }
    tick();
  }

  // ------------------------------------------------------------------- poll
  async function poll() {
    try {
      let changed = false;
      for (const r of runs()) {
        if (isFinal(r.key) && st(r.key)) continue;           // a finished run does not change
        const before = st(r.key) ? st(r.key).version : null, beforeMode = st(r.key) ? st(r.key).run.mode : null;
        const s = await loadStatus(r.key);
        if (before && s.version !== before) { store(r.key); changed = true; }
        if (beforeMode && s.run.mode !== beforeMode) changed = true;
      }
      S.failures = 0;
      $("status-pill").classList.add("hidden");
      for (const r of runs()) await loadLive(r.key);
      const noticesChanged = await loadNotices();
      const benchChanged = await loadBenchmarks();
      if (changed) await renderView();
      else if (S.view === "overview") { for (const r of runs()) { renderKV(r.key); renderLive(r.key); } if (noticesChanged) renderNotices(); if (benchChanged) renderBenchmarks(); }
      tick();
    } catch (err) {
      S.failures += 1;
      if (S.failures >= 2) $("status-pill").classList.remove("hidden");
      tick();
    }
  }

  /* [telemetry] 交给遥测层的入口：换了回放切面以后强制重取数据并重画。
     序列是按指标缓存的，切面一变缓存就必须作废，否则图还是老数据。
     另外三个是自定义看板要用的：读 / 写首页图表集合，以及换集合后重画当前视图。 */
  M.bind({
    refresh: async () => {
      /* [telemetry] 直接带 ?asof= 打开时，遥测层的回放初始化会赶在 app.js 取到
         /api/runs 之前叫到这里（S.cfg 还是 null），runs() 会抛
         "Cannot read properties of null"。此时什么都不用做 —— boot 走完
         本来就会按当前切面渲染一次。 */
      if (!S.cfg) return;
      S.series = {};
      for (const r of runs()) {
        S.statusAt[r.key] = performance.now();
        await loadStatus(r.key);
        await loadLive(r.key);
      }
      await loadNotices();
      await loadBenchmarks();
      await renderView();
    },
    pins: (tags) => { if (tags) S.cfg.pins = tags; return S.cfg.pins; },
    render: () => renderView(),
    union: () => (S.union ? S.union.list : null),
    /* [telemetry] 换首页图表集合时只换图表区，不重画整页：整页重画会先把
       #view-overview 清空，文档高度瞬间掉到只剩页头，浏览器趁机把滚动位置
       夹回顶部 —— 表现就是"切个 Tab 页面跳一下"。 */
    board: (grid, tags) => {
      const drop = S.cards.filter((c) => grid.contains(c.el));
      S.cards = S.cards.filter((c) => !drop.includes(c));
      for (const c of drop) { if (c.chart) c.chart.destroy(); c.el.remove(); }
      grid.innerHTML = "";
      for (const tag of tags) grid.appendChild(chartCard(tag));
      /* 新图淡入一下：硬切会让人觉得"闪了一下"，淡入看着是"换好了" */
      grid.classList.add("telemetry-swap");
      clearTimeout(grid.__swapTimer);
      grid.__swapTimer = setTimeout(() => grid.classList.remove("telemetry-swap"), 260);
    },
  });

  // ------------------------------------------------------------------- boot
  $("theme-toggle").addEventListener("click", () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem("theme", t);
    renderView();
  });
  window.addEventListener("hashchange", route);

  (async function boot() {
    try {
      S.cfg = await getJSON("api/runs");
      S.cfg.formats = S.cfg.formats || [];
      S.cfg.descriptions = S.cfg.descriptions || {};
      document.title = S.cfg.title || "RL";
      const soc = S.cfg.social || {};
      const fh = $("foot-handle");
      fh.textContent = soc.handle || ""; fh.href = soc.url || "#";
      if (S.cfg.stream_start) $("foot-stream").textContent = `streaming since ${new Date(S.cfg.stream_start * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
      $("foot-note").textContent = S.cfg.footer_note || "";
      await Promise.all(runs().map((r) => loadStatus(r.key)));
      await Promise.all(runs().map((r) => loadLive(r.key)));
      await loadNotices();
      await loadBenchmarks();
      await route();
    } catch (err) {
      $("foot-note").textContent = `could not load: ${err.message || err}`;
      $("status-pill").classList.remove("hidden");
    }
    setInterval(poll, STATUS_MS);
    setInterval(tick, 500);
  })();
})();
