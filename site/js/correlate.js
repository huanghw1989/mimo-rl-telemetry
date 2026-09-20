/**
 * 相关性分析内核 —— 服务端与浏览器共用的一份实现。
 *
 * 这个文件被三方加载，所以写成 UMD 形态（既给 Bun 的 import，也给浏览器的 <script>）：
 *   · codes/scripts/mimo_rl_telemetry/server.ts   在线时算 /api/correlate，import 本文件
 *   · site/js/telemetry.js                        离线时（file:// + bundle.js）就地算同一件事
 * 只有一份数学实现，在线和离线的结果就不会各算各的。
 *
 * 输入只有"一堆按步对齐的指标序列"，没有任何取数逻辑 —— 取数在调用方。
 *
 * 为什么不用现成的统计库：只有 24~30 个点，要的是能自己复算的两三个统计量
 * （配对删除的 Pearson/Spearman、一阶差分相关、中位数/MAD 的稳健 z 分数），
 * 引一个库进来比写这 200 行更贵，而且离线包里也没法引。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.TelemetryCorrelate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v) { return isNum(v) ? v : null; }

  function mean(xs) {
    if (!xs.length) return null;
    var s = 0;
    for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  function stdev(xs) {
    if (xs.length < 2) return null;
    var m = mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  }

  function median(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function (p, q) { return p - q; });
    var h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }

  /** 中位数绝对偏差。乘 1.4826 之后和正态分布的标准差同尺度。 */
  function mad(xs) {
    var m = median(xs);
    if (m == null) return null;
    return 1.4826 * median(xs.map(function (v) { return Math.abs(v - m); }));
  }

  /** 成对删除：两个序列里都非空的位置才进样本。 */
  function pairs(a, b) {
    var x = [], y = [];
    var n = Math.min(a ? a.length : 0, b ? b.length : 0);
    for (var i = 0; i < n; i++) {
      if (isNum(a[i]) && isNum(b[i])) { x.push(a[i]); y.push(b[i]); }
    }
    return [x, y];
  }

  function pearson(x, y) {
    var n = x.length;
    if (n < 3) return null;
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx <= 0 || syy <= 0) return null;      // 有一条是常数：没有相关性可言
    return sxy / Math.sqrt(sxx * syy);
  }

  /** 平均秩（并列取平均），Spearman 用。 */
  function ranks(xs) {
    var idx = xs.map(function (v, i) { return [v, i]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var out = new Array(xs.length);
    var i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var r = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) out[idx[k][1]] = r;
      i = j + 1;
    }
    return out;
  }

  function spearman(x, y) {
    if (x.length < 3) return null;
    return pearson(ranks(x), ranks(y));
  }

  /** 相邻两点的一阶差分；任一侧为空则该位置为空（不跨空洞做差）。 */
  function diff(v) {
    var out = [];
    for (var i = 0; i < (v ? v.length : 0); i++) {
      out.push(i > 0 && isNum(v[i]) && isNum(v[i - 1]) ? v[i] - v[i - 1] : null);
    }
    return out;
  }

  /**
   * 取某一步的读数、相对上一有效点的变化、以及这个变化有多"反常"。
   *
   * 反常程度给两个口径，因为样本只有 20 来个点，单个离群点会把标准差撑大：
   *   z  —— 变化量相对"全部变化量"的均值/标准差；
   *   zr —— 变化量相对中位数/MAD。MAD 为 0（大多数步变化量完全相同）时为空。
   *
   * 排序分数取两者的较小值，即"两种尺度下都算异常"才排前面。这条规则是必需的：
   * 轨迹级 max/min 这类极值指标常年顶在上限附近，变化量的 MAD 几乎是 0，
   * 于是任何一次轻微抖动在 MAD 尺度下都会算成几十倍的标准差 —— 只看 |zr|
   * 的话排行榜会被这一族占满，而它们在 |z| 尺度下其实毫不异常。
   */
  function stepAnomaly(values, index) {
    if (!values || index < 0 || index >= values.length) return null;
    var v = num(values[index]);
    if (v == null) return null;
    var prev = null, prevIndex = null;
    for (var i = index - 1; i >= 0; i--) { if (isNum(values[i])) { prev = values[i]; prevIndex = i; break; } }
    if (prev == null) return { value: v, prev: null, delta: null, pct: null, z: null, zr: null, score: null, prevIndex: null };
    var delta = v - prev;
    var ds = [];
    for (var k = 1; k < values.length; k++) {
      if (isNum(values[k]) && isNum(values[k - 1])) ds.push(values[k] - values[k - 1]);
    }
    var z = null, zr = null;
    if (ds.length >= 5) {
      var m = mean(ds), s = stdev(ds);
      if (s != null && s > 0) z = (delta - m) / s;
      var md = mad(ds);
      if (md != null && md > 0) zr = (delta - median(ds)) / md;
    }
    var score = null;
    if (z != null && zr != null) score = Math.min(Math.abs(z), Math.abs(zr));
    else if (z != null) score = Math.abs(z);
    else if (zr != null) score = Math.abs(zr);
    return {
      value: v, prev: prev, delta: delta, pct: prev !== 0 ? delta / prev : null,
      z: z, zr: zr, score: score, prevIndex: prevIndex,
    };
  }

  /* 纯粹的步数计数器：它和所有随训练推进的指标都相关，进榜只会挤掉真信息。 */
  var SKIP_TAGS = { "training/global_step": 1 };

  function skipTag(tag) { return SKIP_TAGS[tag] === 1; }

  /**
   * 指标族名：把只差一个数据集代号 / harness 代号 / 分桶下标的指标折叠成同一个族。
   * 例如 dynsam/code/dataset-4onq/num_accepted/step 与 dynsam/code/dataset-bvg7/... 同族，
   * train/harness 下面各个 harness 代号同族，partial 下面各个数字桶同族。
   * 折叠只为让榜单可读（不然 33 个 code 数据集会把前几名占满），不是统计口径。
   */
  function familyOf(tag) {
    return String(tag)
      .replace(/dataset-[a-z0-9]+/g, "dataset-*")
      .replace(/harness-[A-Za-z0-9-]+/g, "harness-*")
      .split("/")
      .map(function (seg) { return /^\d+$/.test(seg) ? "<k>" : seg; })
      .join("/");
  }

  /** 说明文字的最小双语词表。新增语言时在这里加一条即可。 */
  var CAVEATS = {
    "zh-CN": {
      fewSteps: function (n) {
        return "只有 " + n + " 个采样的步，相关系数噪声很大；两条都在单调上升的曲线天然高度相关，这属于伪相关。";
      },
      firstDiff: function (n) {
        return "一阶差分相关（d_spearman）剥掉共同趋势后更接近「同时涨跌」，但差分点更少（约 " + n + " 个），只当参考。";
      },
      notCausal: "这里全是相关，不是因果；判断因果要回到公告、重启记录和版本切换。",
      stepFallback: function (want, got) {
        return "你指定的第 " + want + " 步在这个切面里还没有数据，下面是切面里最后一步（第 " + got + " 步）。";
      },
      skipped: function (n) {
        return "有 " + n + " 个指标因为有效点太少或在该步没有读数，没有进榜。";
      },
    },
    en: {
      fewSteps: function (n) {
        return "Only " + n + " sampled steps are available, so these coefficients are very noisy; two curves that both rise monotonically are inherently highly correlated, and that is spurious correlation.";
      },
      firstDiff: function (n) {
        return "First-difference correlation (d_spearman) removes the shared trend and is closer to \"moving together\", but it has even fewer points (about " + n + ") and is a reference only.";
      },
      notCausal: "This is all correlation, not causation; to argue causation, go back to the notices, the restart log and version changes.",
      stepFallback: function (want, got) {
        return "The step you picked (step " + want + ") has no data in this snapshot yet; shown below is the last step in the snapshot (step " + got + ").";
      },
      skipped: function (n) {
        return n + " metrics were left out because they had too few valid points or no reading at this step.";
      },
    },
  };

  /**
   * 主入口。
   *
   * @param {object} input
   *   series   {tag: (number|null)[]}  所有指标，数组下标与 steps 对齐
   *   steps    number[]                步号
   *   step     number|null             锚点步（缺省取最后一个有数据的步）
   *   anchor   {kind, id, values, label} | null   锚点（某个指标或某个评测榜）
   *   opts     {top, minPoints, minPairs, seriesOnly}
   * @returns {object} {step, index, anchor, movers, corr, counts, caveats}
   */
  function analyze(input) {
    var series = input.series || {};
    var steps = input.steps || [];
    var opts = input.opts || {};
    var top = opts.top || 12;
    var minPoints = opts.minPoints || 5;
    var minPairs = opts.minPairs || 8;
    var tags = Object.keys(series);

    /* ---- 锚点在哪一步：优先用调用方指定的步号，否则取最后一个有值的步 ---- */
    var anchorValues = input.anchor ? input.anchor.values : null;
    var index = -1;
    var step = input.step;
    if (step != null) {
      index = steps.indexOf(step);
      if (index < 0 && step >= 1 && step <= steps.length) index = step - 1;
    }
    if (index < 0) {
      if (anchorValues) {
        for (var i = anchorValues.length - 1; i >= 0; i--) { if (isNum(anchorValues[i])) { index = i; break; } }
      }
      if (index < 0) index = steps.length - 1;
      step = steps[index] != null ? steps[index] : index + 1;
    }

    var anchor = null;
    if (input.anchor) {
      var an = stepAnomaly(anchorValues, index);
      anchor = {
        kind: input.anchor.kind || "metric",
        id: input.anchor.id || null,
        label: input.anchor.label || input.anchor.id || null,
        value: an ? an.value : null,
        prev: an ? an.prev : null,
        delta: an ? an.delta : null,
        pct: an ? an.pct : null,
        z: an ? an.z : null,
        zr: an ? an.zr : null,
      };
    }

    /* ---- 一、这一步一起动的是什么：按稳健 z 排序，按族折叠 ---- */
    var fams = {}, usable = 0, skipped = 0;
    for (var t = 0; t < tags.length; t++) {
      var tag = tags[t];
      var vals = series[tag];
      if (!vals || skipTag(tag)) continue;
      var nonNull = 0;
      for (var q = 0; q < vals.length; q++) if (isNum(vals[q])) nonNull++;
      if (nonNull < minPoints) { skipped++; continue; }
      var a = stepAnomaly(vals, index);
      if (!a || a.score == null) { skipped++; continue; }
      usable++;
      var fam = familyOf(tag);
      var box = fams[fam] || (fams[fam] = { family: fam, members: [] });
      box.members.push({ tag: tag, value: a.value, prev: a.prev, delta: a.delta, pct: a.pct, z: a.z, zr: a.zr, score: a.score, n: nonNull });
    }
    var movers = Object.keys(fams).map(function (f) {
      var box = fams[f];
      box.members.sort(function (p, q) { return q.score - p.score; });
      var best = box.members[0];
      return {
        family: f, tag: best.tag, value: best.value, prev: best.prev, delta: best.delta, pct: best.pct,
        z: best.z, zr: best.zr, score: best.score, n: best.n, members: box.members.slice(0, 4), member_count: box.members.length,
      };
    }).sort(function (p, q) { return q.score - p.score; }).slice(0, top);

    /* ---- 二、与锚点同涨同跌的指标：全周期 + 一阶差分，都按族折叠 ---- */
    var corr = [];
    if (anchorValues) {
      var famMax = {};
      for (var u = 0; u < tags.length; u++) {
        var tg = tags[u];
        if (skipTag(tg)) continue;
        if (input.anchor && input.anchor.kind === "metric" && tg === input.anchor.id) continue;
        var vs = series[tg];
        if (!vs) continue;
        var pr = pairs(anchorValues, vs);
        if (pr[0].length < minPairs) continue;
        var r = pearson(pr[0], pr[1]);
        var rho = spearman(pr[0], pr[1]);
        if (r == null && rho == null) continue;
        /* 一阶差分相关：两个序列同时都在涨才算相关，能剥掉"共同趋势"这层伪相关。
           只有 20 来个差分点，噪声大，所以只当参考值，不参与排序。 */
        var dr = pairs(diff(anchorValues), diff(vs));
        var drho = dr[0].length >= minPairs ? spearman(dr[0], dr[1]) : null;
        var fam2 = familyOf(tg);
        var sort = Math.abs(rho != null ? rho : (r != null ? r : 0));
        /* 成员只留薄薄一层 {tag, rho, ...}，不要把 item 自己塞进自己的 members —— 
           那会构成自引用，JSON.stringify 直接报环。 */
        var light = { tag: tg, spearman: rho, d_spearman: drho, n: pr[0].length };
        var box = famMax[fam2];
        if (!box) {
          box = famMax[fam2] = { item: null, best: -1, members: [] };
        }
        box.members.push(light);
        if (sort > box.best) {
          box.best = sort;
          box.item = {
            tag: tg, family: fam2, pearson: r, spearman: rho, d_spearman: drho,
            n: pr[0].length, n_diff: dr[0].length, sort: sort,
          };
        }
      }
      corr = Object.keys(famMax).map(function (f) {
        var b = famMax[f];
        b.item.members = b.members.slice().sort(function (p, q) {
          return Math.abs(q.spearman) - Math.abs(p.spearman);
        });
        return b.item;
      }).sort(function (p, q) { return q.sort - p.sort; }).slice(0, top);
    }

    /* 取值口径的说明文字按语言生成：这个内核既被服务端 import，也被浏览器
       直接加载，所以不能依赖页面上的 T()，只能自己带一份最小词表。 */
    var C = CAVEATS[input.lang] || CAVEATS["zh-CN"];
    var caveats = [
      C.fewSteps(steps.length),
      C.firstDiff(Math.max(0, steps.length - 1)),
      C.notCausal,
    ];
    /* 回放切面里，被指定的那一步可能还没完成。这时会退到切面里最后一步，
       但必须说出来 —— 否则用户以为看的是自己点的那一步。 */
    if (input.step != null && step !== input.step) {
      caveats.unshift(C.stepFallback(input.step, step));
    }
    if (skipped) caveats.push(C.skipped(skipped));

    return {
      step: step, index: index, anchor: anchor, movers: movers, corr: corr,
      counts: { tags: tags.length, usable: usable, skipped: skipped, families: Object.keys(fams).length },
      caveats: caveats,
    };
  }

  return {
    analyze: analyze,
    familyOf: familyOf,
    pearson: pearson,
    spearman: spearman,
    stepAnomaly: stepAnomaly,
    mean: mean,
    stdev: stdev,
    median: median,
    mad: mad,
    diff: diff,
    pairs: pairs,
  };
});
