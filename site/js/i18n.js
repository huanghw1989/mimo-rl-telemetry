/*
 * 语言层（本地新增，原站没有这个文件）。
 *
 * 遥测层（telemetry.js）的界面文案以中文源串写就，本文件负责把它翻成英文：
 *   · 默认英文，选择存在 localStorage['telemetry.lang']；
 *   · 字典在 site/i18n/en.json，键就是 telemetry.js 里的中文源串原样；
 *   · T(zh, ...args) 查字典 + 填 {0}/{1} 占位符，查不到就回落中文源串（绝不抛错）；
 *   · 导航右侧的 EN | 中文 分段控件由这里接管点击，切换后整页重载。
 *
 * 为什么 setLang 直接 location.reload() 而不是"就地重画"：
 * 语言影响的不只是几处文案，还有回放面板、看板 Tab、解读面板、相关性面板，
 * 以及按语言重新取的内容（/api/content?lang=）。就地重画要把每处渲染都登记一遍，
 * 漏一处就会中英混杂；整页重载是最省心、也最不会漏的做法，代价只是刷新一下。
 *
 * 离线副本（file://）下 fetch('i18n/en.json') 会被浏览器拦掉，所以导出脚本会把
 * 这份字典一并打进 data/bundle.js（window.__TELEMETRY_BUNDLE__.i18n），这里优先用它。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "telemetry.lang";
  var SUPPORTED = ["en", "zh-CN"];
  var DEFAULT = "en";

  var dict = Object.create(null);
  var listeners = [];

  function readStored() {
    var v = null;
    try { v = localStorage.getItem(STORAGE_KEY); } catch (e) { }
    return SUPPORTED.indexOf(v) >= 0 ? v : DEFAULT;
  }

  var lang = readStored();

  function desiredTitle() {
    return lang === "zh-CN" ? "mimo-v2.6 RL 遥测" : "mimo-v2.6 RL telemetry";
  }

  /* 只有看板页（index.html / offline.html 都有导航）由这里接管 <title>。
     features.html 用的是自己那一套双语标题，不能被这里覆盖。 */
  var MANAGE_TITLE = !!document.getElementById("tabs");

  function applyDocument() {
    document.documentElement.lang = lang;
    /* 中文标题由这里运行时设置；index.html 里写的是英文默认值。 */
    if (MANAGE_TITLE) document.title = desiredTitle();
  }

  /* app.js 会在 /runs 回来后把 <title> 改成站点配置里的标题（它不归遥测层管，
     也不能改）。这里盯着 <title>，被改掉就按当前语言改回来；先比较再写，
     免得自己触发自己的观察器。 */
  function guardTitle() {
    if (!MANAGE_TITLE) return;
    var node = document.querySelector("title");
    if (!node || !window.MutationObserver) return;
    new MutationObserver(function () {
      var want = desiredTitle();
      if (node.textContent !== want) node.textContent = want;
    }).observe(node, { childList: true, characterData: true, subtree: true });
  }

  /**
   * 翻译。zhSource 是 telemetry.js 里的中文源串；args 依次填 {0}、{1}…
   * 英文模式下查不到译文就原样返回中文，保证界面不会出现空白。
   */
  function t(zhSource) {
    var s = zhSource == null ? "" : String(zhSource);
    if (lang === "en") {
      var hit = dict[s];
      if (typeof hit === "string" && hit) s = hit;
    }
    var args = arguments;
    if (args.length > 1) {
      s = s.replace(/\{(\d+)\}/g, function (m, i) {
        var v = args[Number(i) + 1];
        return v == null ? "" : String(v);
      });
    }
    return s;
  }

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { }
    }
  }

  /** 注册切换后的回调；返回传入的函数，方便调用方取消（本文件里没用到）。 */
  function onChange(cb) {
    if (typeof cb === "function") listeners.push(cb);
    return cb;
  }

  function setLang(next) {
    if (SUPPORTED.indexOf(next) < 0) next = DEFAULT;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { }
    if (next === lang) { applyDocument(); return; }
    lang = next;
    applyDocument();
    fire();
    /* 整页重载：见文件头注释，保证每个视图都用新语言重画一遍。 */
    location.reload();
  }

  function mergeDictionary(obj) {
    if (!obj || typeof obj !== "object") return;
    Object.keys(obj).forEach(function (k) {
      if (typeof obj[k] === "string") dict[k] = obj[k];
    });
  }

  /* 字典是异步来的：加载期间 t() 先返回中文源串，页面不阻塞。
     telemetry.js 会等 I18N.ready 之后再画自己的界面，所以首屏仍是英文。 */
  var ready = Promise.resolve().then(function () {
    var bundle = window.__TELEMETRY_BUNDLE__;
    if (bundle && bundle.i18n && typeof bundle.i18n === "object") { mergeDictionary(bundle.i18n); return null; }
    if (window.__I18N_EN__ && typeof window.__I18N_EN__ === "object") { mergeDictionary(window.__I18N_EN__); return null; }
    return fetch("i18n/en.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(mergeDictionary).catch(function () {
      /* 文件缺失或 file:// 被拦：退化为中文源串，不抛错。 */
    });
  });

  function applySwitcher() {
    var host = document.getElementById("nav-lang");
    if (!host) return;
    var btns = host.querySelectorAll("button[data-lang]");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-lang") === lang;
      btns[i].classList.toggle("active", on);
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function initSwitcher() {
    var host = document.getElementById("nav-lang");
    if (!host) return;
    applySwitcher();
    host.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button[data-lang]") : null;
      if (b) setLang(b.getAttribute("data-lang"));
    });
  }

  var api = {
    setLang: setLang,
    t: t,
    onChange: onChange,
    SUPPORTED: SUPPORTED.slice(),
    DEFAULT: DEFAULT,
    /** 已加载的字典，其他代码可以读。 */
    dictionary: dict,
    /** 字典加载完成的 Promise；telemetry.js 首屏渲染前会等它。 */
    ready: ready,
    /** 重新把语言写到 <html lang>、标题和切换控件上。 */
    apply: function () { applyDocument(); applySwitcher(); },
  };
  Object.defineProperty(api, "lang", {
    enumerable: true,
    get: function () { return lang; },
  });

  window.I18N = api;
  window.T = function () { return t.apply(null, arguments); };

  applyDocument();
  guardTitle();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSwitcher);
  else initSwitcher();
})();
