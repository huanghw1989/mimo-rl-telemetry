/* Canvas line chart. Plain: 1.5px lines, hairline grid, an end marker, a
   crosshair with a readout. Series may have different x sets (a baseline
   run has its own steps). No animation. */
(function () {
  "use strict";

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const PALETTE = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  };
  const palette = () => PALETTE[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];

  function rgba(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  }

  /* `unit` scales the nice-number search (3600 → ticks land on whole hours). */
  function linearTicks(lo, hi, count, unit) {
    if (!(hi > lo)) { const c = lo || 0; const p = Math.abs(c) * 0.05 || 0.01; lo = c - p; hi = c + p; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    unit = unit || 1;
    const step = niceStep((hi - lo) / unit, count) * unit;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(12));
    return { ticks, lo, hi, step };
  }

  function logTicks(lo, hi) {
    const l0 = Math.log10(lo), l1 = Math.log10(hi);
    const pad = Math.max(0.05, (l1 - l0) * 0.08);
    const a = l0 - pad, b = l1 + pad;
    const ticks = [];
    for (let e = Math.floor(a); e <= Math.ceil(b); e++) {
      for (const m of (b - a < 1.5 ? [1, 2, 5] : [1])) {
        const v = m * Math.pow(10, e);
        if (Math.log10(v) >= a && Math.log10(v) <= b) ticks.push(v);
      }
    }
    return { ticks, lo: a, hi: b, step: 1 };
  }

  const HOUR_STEPS = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336, 720];
  function timeTicks(x0, x1, count) {
    const spanH = Math.max(1, (x1 - x0) / 3600);
    const stepH = HOUR_STEPS.find((s) => spanH / s <= count) || HOUR_STEPS[HOUR_STEPS.length - 1];
    const step = stepH * 3600;
    const out = [];
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) out.push(v);
    return out;
  }

  function stepTicks(x0, x1, count) {
    const step = Math.max(1, Math.round(niceStep(Math.max(1, x1 - x0), count)));
    const out = [];
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) out.push(v);
    if (!out.length) out.push(Math.round(x0));
    return out;
  }

  /* TensorBoard's debiased EMA; nulls are skipped. */
  function ema(values, w) {
    if (!w) return values;
    const out = new Array(values.length);
    let last = 0, n = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !isFinite(v)) { out[i] = null; continue; }
      last = last * w + (1 - w) * v;
      n++;
      out[i] = last / (1 - Math.pow(w, n));
    }
    return out;
  }

  class Line {
    /* opts: format, xMode ('step'|'time'), smoothing, log, compact, endLabel */
    constructor(container, opts) {
      this.container = container;
      this.opts = Object.assign({ format: "auto", xMode: "step", smoothing: 0, log: false, compact: false, endLabel: true, legend: true, points: false }, opts || {});
      this.data = null;
      this.hoverX = null;
      this.highlight = null;

      container.classList.add("chart");
      this.legendEl = document.createElement("div");
      this.legendEl.className = "chart-legend";
      this.plotEl = document.createElement("div");
      this.plotEl.className = "chart-plot";
      this.canvas = document.createElement("canvas");
      this.tip = document.createElement("div");
      this.tip.className = "chart-tip";
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "chart-empty";
      this.emptyEl.textContent = "no data";
      this.plotEl.append(this.canvas, this.tip, this.emptyEl);
      container.append(this.legendEl, this.plotEl);

      this._onMove = (e) => this._hover(e);
      this._onLeave = () => { this.hoverX = null; this.tip.style.display = "none"; this.draw(); };
      this.canvas.addEventListener("pointermove", this._onMove);
      this.canvas.addEventListener("pointerdown", this._onMove);
      this.canvas.addEventListener("pointerleave", this._onLeave);
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(this.plotEl);
    }

    destroy() {
      this.ro.disconnect();
      this.container.innerHTML = "";
      this.container.classList.remove("chart");
    }

    setOptions(opts) { Object.assign(this.opts, opts); this._prepare(); this.draw(); }

    /* data = {series: [{key, label, color, steps, walls, runStart, values, dashed?}]} */
    setData(data) { this.data = data; this._prepare(); this._legend(); this.draw(); }

    _prepare() {
      const d = this.data;
      if (!d) { this.prepared = null; return; }
      const w = this.opts.smoothing;
      const xsUnion = new Set();
      const series = d.series.map((s) => {
        const xs = this.opts.xMode === "time" ? s.walls.map((t) => t - s.runStart) : s.steps.slice();
        const raw = s.values.map((v) => (v == null || !isFinite(v) || (this.opts.log && v <= 0)) ? null : v);
        const y = w ? ema(raw, w) : raw;
        const byX = new Map();
        xs.forEach((x, i) => { if (y[i] != null) byX.set(x, i); xsUnion.add(x); });
        return { ...s, xs, raw, y, byX };
      });
      this.prepared = { series, xs: Array.from(xsUnion).sort((a, b) => a - b) };
    }

    _legend() {
      const d = this.data;
      this.legendEl.innerHTML = "";
      if (!d || d.series.length < 2 || !this.opts.legend) { this.legendEl.style.display = "none"; return; }
      this.legendEl.style.display = "";
      for (const s of d.series) {
        const item = document.createElement("span");
        item.className = "legend-item";
        item.innerHTML = `<i class="swatch" style="background:${s.color}"></i>${s.label}`;
        item.addEventListener("pointerenter", () => { this.highlight = s.key; this.draw(); });
        item.addEventListener("pointerleave", () => { this.highlight = null; this.draw(); });
        this.legendEl.appendChild(item);
      }
    }

    _layout(ctx, w, h) {
      const p = this.prepared;
      const compact = this.opts.compact;
      const all = [];
      for (const s of p.series) for (const v of s.raw) if (v != null) all.push(v);
      const hasData = all.length > 0;
      let ticks;
      if (!hasData) ticks = { ticks: [], lo: 0, hi: 1, step: 1 };
      else if (this.opts.log) ticks = logTicks(Math.min(...all), Math.max(...all));
      else {
        const mx = Math.max(...all);
        const unit = this.opts.format === "duration" ? (mx >= 7200 ? 3600 : mx >= 120 ? 60 : 1) : 1;
        ticks = linearTicks(Math.min(...all), Math.max(...all), compact ? 3 : 5, unit);
      }

      ctx.font = `11px ${cssVar("--mono")}`;
      const labels = ticks.ticks.map((t) => Fmt.tick(t, this.opts.format, ticks.step));
      let labelW = 0;
      for (const l of labels) labelW = Math.max(labelW, ctx.measureText(l).width);
      const nameW = compact ? 0 : ctx.measureText(this.opts.xMode === "time" ? "run time" : "step").width;

      let endW = 0;
      const primary = p.series[0];
      if (this.opts.endLabel && hasData && primary) {
        let last = null;
        for (let i = primary.y.length - 1; i >= 0; i--) if (primary.y[i] != null) { last = primary.y[i]; break; }
        if (last != null) endW = ctx.measureText(Fmt.text(last, this.opts.format)).width + 12;
      }
      const pad = { l: Math.max(Math.ceil(labelW) + 14, Math.ceil(nameW) + 12), r: Math.max(10, Math.ceil(endW) + 4), t: 10, b: compact ? 20 : 24 };

      // the time axis starts at the run's launch (0h), the step axis at the first step
      let x0 = this.opts.xMode === "time" ? 0 : p.xs[0], x1 = p.xs[p.xs.length - 1];
      if (x1 == null) { x0 = 0; x1 = 1; }
      if (x1 === x0) { x0 -= 1; x1 += 1; }
      const toY = this.opts.log
        ? (v) => pad.t + (1 - (Math.log10(v) - ticks.lo) / (ticks.hi - ticks.lo)) * (h - pad.t - pad.b)
        : (v) => pad.t + (1 - (v - ticks.lo) / (ticks.hi - ticks.lo)) * (h - pad.t - pad.b);
      const toX = (v) => pad.l + ((v - x0) / (x1 - x0)) * (w - pad.l - pad.r);
      return { pad, ticks, labels, x0, x1, toX, toY, hasData };
    }

    draw() {
      const canvas = this.canvas;
      const w = this.plotEl.clientWidth, h = this.plotEl.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!this.prepared || !this.prepared.xs.length) { this.emptyEl.style.display = "flex"; return; }

      const L = this._layout(ctx, w, h);
      this.L = L;
      this.emptyEl.style.display = L.hasData ? "none" : "flex";
      const p = this.prepared;
      const mono = cssVar("--mono"), ink = cssVar("--ink"), ink3 = cssVar("--ink-3"), grid = cssVar("--grid"), surface = cssVar("--surface");

      ctx.lineWidth = 1;
      ctx.strokeStyle = grid;
      ctx.fillStyle = ink3;
      ctx.font = `11px ${mono}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      L.ticks.ticks.forEach((t, i) => {
        const y = Math.round(L.toY(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(L.pad.l, y); ctx.lineTo(w - L.pad.r, y); ctx.stroke();
        ctx.fillText(L.labels[i], L.pad.l - 8, y);
      });

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xt = this.opts.xMode === "time" ? timeTicks(L.x0, L.x1, this.opts.compact ? 4 : 8) : stepTicks(L.x0, L.x1, this.opts.compact ? 4 : 10);
      const yLab = h - L.pad.b + 8;
      const axisName = this.opts.compact ? "" : (this.opts.xMode === "time" ? "run time" : "step");
      const nameRight = axisName ? L.pad.l - 8 : -Infinity;
      for (const v of xt) {
        const label = this.opts.xMode === "time" ? Fmt.runTime(v) : String(v);
        const x = L.toX(v);
        if (x - ctx.measureText(label).width / 2 < nameRight + 6) continue;   // would collide with the axis name
        ctx.fillText(label, x, yLab);
      }
      if (axisName) {
        ctx.textAlign = "right";
        ctx.fillText(axisName, L.pad.l - 8, yLab);
      }
      if (!L.hasData) return;

      const drawPath = (s, ys) => {
        let open = false;
        ctx.beginPath();
        for (let i = 0; i < s.xs.length; i++) {
          const v = ys[i];
          if (v == null) { open = false; continue; }
          const x = L.toX(s.xs[i]), y = L.toY(v);
          if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
        }
      };

      // baseline / secondary series first so the primary sits on top
      const order = p.series.slice().reverse();
      for (const s of order) {
        const dim = this.highlight && this.highlight !== s.key;
        const alpha = dim ? 0.2 : 1;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        if (this.opts.smoothing) {
          drawPath(s, s.raw);
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba(s.color, 0.3 * alpha);
          ctx.setLineDash([]);
          ctx.stroke();
        }
        drawPath(s, s.y);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = dim ? rgba(s.color, alpha) : s.color;
        ctx.setLineDash(s.dashed ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.opts.points) {           // sparse series (benchmarks): mark every point
          ctx.fillStyle = dim ? rgba(s.color, alpha) : s.color;
          for (let i = 0; i < s.xs.length; i++) {
            if (s.y[i] == null) continue;
            ctx.beginPath(); ctx.arc(L.toX(s.xs[i]), L.toY(s.y[i]), 2.5, 0, Math.PI * 2); ctx.fill();
          }
        }

        let li = -1;
        for (let i = s.y.length - 1; i >= 0; i--) if (s.y[i] != null) { li = i; break; }
        if (li >= 0 && !dim) {
          const x = L.toX(s.xs[li]), y = L.toY(s.y[li]);
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
          if (s === p.series[0] && this.opts.endLabel && this.hoverX == null) {
            ctx.font = `11px ${mono}`;
            ctx.fillStyle = ink;
            ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(Fmt.text(s.y[li], this.opts.format), x + 9, y);
          }
        }
      }

      if (this.hoverX != null) {
        const x = Math.round(L.toX(this.hoverX)) + 0.5;
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, L.pad.t); ctx.lineTo(x, h - L.pad.b); ctx.stroke();
        for (const s of p.series) {
          const i = s.byX.get(this.hoverX);
          if (i == null) continue;
          const y = L.toY(s.y[i]);
          ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
        }
      }
    }

    _hover(e) {
      if (!this.prepared || !this.L || !this.prepared.xs.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let best = null, bd = Infinity;
      for (const x of this.prepared.xs) {
        const d = Math.abs(this.L.toX(x) - px);
        if (d < bd) { bd = d; best = x; }
      }
      if (best === this.hoverX && this.tip.style.display === "block") return;
      this.hoverX = best;
      this.draw();
      this._tooltip(best);
    }

    _tooltip(x) {
      const p = this.prepared;
      const rows = [];
      let head = "";
      for (const s of p.series) {
        const i = s.byX.get(x);
        if (i == null) continue;
        if (!head) {
          const rt = Fmt.runTime(s.walls[i] - s.runStart);
          head = this.opts.xMode === "time" ? `${rt} · step ${s.steps[i]}` : `step ${s.steps[i]} · ${rt}`;
        }
        const raw = this.opts.smoothing && s.raw[i] != null && Math.abs(s.raw[i] - s.y[i]) > 1e-12 ? `<span class="tip-raw">${Fmt.text(s.raw[i], this.opts.format)}</span>` : "";
        rows.push(`<div class="tip-row"><i class="swatch" style="background:${s.color}"></i><span class="tip-label">${s.label}</span><span class="tip-val">${Fmt.text(s.y[i], this.opts.format)}${raw}</span></div>`);
      }
      if (!head) head = this.opts.xMode === "time" ? Fmt.runTime(x) : `step ${x}`;
      this.tip.innerHTML = `<div class="tip-head">${head}</div>${rows.join("")}`;
      this.tip.style.display = "block";
      const cx = this.L.toX(x);
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      const w = this.plotEl.clientWidth, h = this.plotEl.clientHeight;
      let left = cx + 12;
      if (left + tw > w - 4) left = cx - tw - 12;
      if (left < 4) left = 4;
      this.tip.style.left = `${left}px`;
      this.tip.style.top = `${Math.max(4, Math.min(h - th - 4, this.L.pad.t + 4))}px`;
    }
  }

  /* Stacked bars per step: batch composition. series values are counts; the
     chart shows counts or shares. Segments are separated by a 1px surface gap. */
  class Stacked {
    constructor(container, opts) {
      this.container = container;
      this.opts = Object.assign({ mode: "count", format: "int", xMode: "step" }, opts || {});
      this.data = null;
      this.hoverI = -1;
      container.classList.add("chart");
      this.legendEl = document.createElement("div");
      this.legendEl.className = "chart-legend";
      this.plotEl = document.createElement("div");
      this.plotEl.className = "chart-plot";
      this.canvas = document.createElement("canvas");
      this.tip = document.createElement("div");
      this.tip.className = "chart-tip";
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "chart-empty";
      this.emptyEl.textContent = "no data";
      this.plotEl.append(this.canvas, this.tip, this.emptyEl);
      container.append(this.legendEl, this.plotEl);
      this._onMove = (e) => this._hover(e);
      this._onLeave = () => { this.hoverI = -1; this.tip.style.display = "none"; this.draw(); };
      this.canvas.addEventListener("pointermove", this._onMove);
      this.canvas.addEventListener("pointerdown", this._onMove);
      this.canvas.addEventListener("pointerleave", this._onLeave);
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(this.plotEl);
    }
    destroy() { this.ro.disconnect(); this.container.innerHTML = ""; this.container.classList.remove("chart"); }
    setOptions(o) { Object.assign(this.opts, o); this.draw(); }
    setData(d) {
      this.data = d;
      this.legendEl.innerHTML = "";
      if (d && d.series.length) {
        for (const s of d.series) {
          const item = document.createElement("span");
          item.className = "legend-item";
          item.innerHTML = `<i class="swatch" style="background:${s.color}"></i>${s.label}`;
          this.legendEl.appendChild(item);
        }
      }
      this.draw();
    }
    _xs() {
      const d = this.data;
      return this.opts.xMode === "time" ? d.walls.map((w) => w - d.runStart) : d.steps;
    }
    draw() {
      const canvas = this.canvas;
      const w = this.plotEl.clientWidth, h = this.plotEl.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const d = this.data;
      const n = d && d.steps ? d.steps.length : 0;
      if (!n || !d.series.length) { this.emptyEl.style.display = "flex"; return; }
      this.emptyEl.style.display = "none";
      const share = this.opts.mode === "share";
      const totals = d.steps.map((_, i) => d.series.reduce((a, s) => a + (s.values[i] || 0), 0));
      const maxT = Math.max(1e-9, ...totals);
      const mono = cssVar("--mono"), ink3 = cssVar("--ink-3"), grid = cssVar("--grid"), surface = cssVar("--surface"), ink = cssVar("--ink");
      const ticks = share ? { ticks: [0, 0.25, 0.5, 0.75, 1], lo: 0, hi: 1, step: 0.25 } : (() => { const t = linearTicks(0, maxT, 4); t.lo = 0; return t; })();
      ctx.font = `11px ${mono}`;
      const labels = ticks.ticks.map((t) => share ? `${Math.round(t * 100)}%` : Fmt.tick(t, this.opts.format, ticks.step));
      let labelW = 0; for (const l of labels) labelW = Math.max(labelW, ctx.measureText(l).width);
      const pad = { l: Math.ceil(labelW) + 14, r: 10, t: 10, b: 24 };
      const xs = this._xs();
      let x0 = this.opts.xMode === "time" ? 0 : xs[0], x1 = xs[n - 1];
      if (x1 === x0) { x0 -= 1; x1 += 1; }
      // size the bars from the data spacing, then inset the x range by half a
      // bar so the first and last bars stay clear of the axis labels
      const plotW = w - pad.l - pad.r, span = x1 - x0;
      let slot = Infinity;
      for (let i = 1; i < n; i++) slot = Math.min(slot, (xs[i] - xs[i - 1]) / span * plotW);
      if (!isFinite(slot)) slot = plotW / 2;
      const bw = Math.max(3, Math.min(24, slot * 0.72));
      const inset = bw / 2 + 4;
      const toX = (v) => pad.l + inset + ((v - x0) / span) * (plotW - 2 * inset);
      const toY = (v) => pad.t + (1 - (v - ticks.lo) / (ticks.hi - ticks.lo)) * (h - pad.t - pad.b);
      this.L = { toX, toY, pad, xs, bw };

      ctx.lineWidth = 1; ctx.strokeStyle = grid; ctx.fillStyle = ink3;
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ticks.ticks.forEach((t, i) => { const y = Math.round(toY(t)) + 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(labels[i], pad.l - 8, y); });
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const xt = this.opts.xMode === "time" ? timeTicks(x0, x1, 8) : stepTicks(x0, x1, 10);
      const yLab = h - pad.b + 8;
      for (const v of xt) ctx.fillText(this.opts.xMode === "time" ? Fmt.runTime(v) : String(v), toX(v), yLab);

      for (let i = 0; i < n; i++) {
        const cx = toX(xs[i]);
        const tot = totals[i];
        if (!tot) continue;
        let acc = 0;
        const dim = this.hoverI >= 0 && this.hoverI !== i;
        for (const s of d.series) {
          const v = s.values[i] || 0;
          if (!v) continue;
          const y0 = toY(share ? acc / tot : acc), y1 = toY(share ? (acc + v) / tot : acc + v);
          ctx.fillStyle = dim ? rgba(s.color, 0.35) : s.color;
          const top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y0 - y1) - 1);
          ctx.fillRect(Math.round(cx - bw / 2), Math.round(top), Math.round(bw), Math.round(hgt));
          acc += v;
        }
      }
      if (this.hoverI >= 0) {
        const cx = Math.round(toX(xs[this.hoverI])) + 0.5;
        ctx.strokeStyle = ink; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(cx - bw / 2) - 1.5, pad.t - 0.5, Math.round(bw) + 3, h - pad.t - pad.b + 1);
      }
    }
    _hover(e) {
      if (!this.L || !this.data) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let best = -1, bd = Infinity;
      this.L.xs.forEach((x, i) => { const dd = Math.abs(this.L.toX(x) - px); if (dd < bd) { bd = dd; best = i; } });
      if (best === this.hoverI && this.tip.style.display === "block") return;
      this.hoverI = best;
      this.draw();
      const d = this.data;
      const tot = d.series.reduce((a, s) => a + (s.values[best] || 0), 0);
      const rows = d.series.map((s) => ({ s, v: s.values[best] || 0 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
      this.tip.innerHTML = `<div class="tip-head">step ${d.steps[best]} · ${Fmt.int(tot)} total</div>` +
        rows.map((r) => `<div class="tip-row"><i class="swatch" style="background:${r.s.color}"></i><span class="tip-label">${r.s.label}</span><span class="tip-val">${Fmt.int(r.v)}<span class="tip-raw">${(100 * r.v / tot).toFixed(1)}%</span></span></div>`).join("");
      this.tip.style.display = "block";
      const cx = this.L.toX(this.L.xs[best]);
      const tw = this.tip.offsetWidth, w = this.plotEl.clientWidth;
      let left = cx + 14; if (left + tw > w - 4) left = cx - tw - 14; if (left < 4) left = 4;
      this.tip.style.left = `${left}px`;
      this.tip.style.top = `${this.L.pad.t + 4}px`;
    }
  }

  window.Charts = { Line, Stacked, palette, ema };
})();
