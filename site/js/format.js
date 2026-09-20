/* Number and time formatting shared by every view. */
(function () {
  "use strict";

  const fmtInt = (v) => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");

  function sig(x, d) {
    return String(parseFloat(x.toPrecision(d)));
  }

  function compact(v, d) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    d = d == null ? 3 : d;
    if (a >= 1e12) return sig(v / 1e12, d) + "T";
    if (a >= 1e9) return sig(v / 1e9, d) + "B";
    if (a >= 1e6) return sig(v / 1e6, d) + "M";
    if (a >= 1e3) return sig(v / 1e3, d) + "k";
    return sig(v, d);
  }

  /* Picks decimals from magnitude: 1234.5 → 1,234 · 12.345 → 12.3 · 0.0055 → 0.0055 */
  function auto(v) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 1e5) return compact(v, 3);
    if (a >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return sig(v, 3);
  }

  function sci(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(v)));
    const m = v / Math.pow(10, e);
    return `${parseFloat(m.toFixed(2))}e${e}`;
  }

  function duration(s, opts) {
    if (s == null || !isFinite(s)) return "—";
    s = Math.max(0, Math.round(s));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${String(h).padStart(2, "0")}h`;
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m) return opts && opts.seconds ? `${m}m ${String(sec).padStart(2, "0")}s` : `${m}m`;
    return `${sec}s`;
  }

  function clock(s) {
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return d ? `${d}d ${hms}` : hms;
  }

  const ago = (s) => s < 60 ? "just now" : duration(s) + " ago";

  /* Short run-time label for a time axis: 6h · 1d 12h · 3d */
  function runTime(s) {
    s = Math.max(0, s);
    const d = Math.floor(s / 86400), h = Math.round((s % 86400) / 3600);
    if (d && h) return `${d}d ${h}h`;
    if (d) return `${d}d`;
    return `${h}h`;
  }

  /* {text, unit} for a value in a named format. */
  function value(v, format) {
    if (v == null || !isFinite(v)) return { text: "—", unit: "" };
    switch (format) {
      case "ratio": case "num3": return { text: v.toFixed(3), unit: "" };
      case "num2": return { text: v.toFixed(2), unit: "" };
      case "num1": return { text: v.toFixed(1), unit: "" };
      case "num0": return { text: fmtInt(v), unit: "" };
      case "pct": return { text: (v * 100).toFixed(v * 100 >= 10 ? 1 : 2), unit: "%" };
      case "tokens": return { text: compact(v, 3), unit: "tok" };
      case "compact": return { text: compact(v, 3), unit: "" };
      case "int": return { text: fmtInt(v), unit: "" };
      case "duration": return { text: duration(v), unit: "" };
      case "gb": return { text: v.toFixed(1), unit: "GB" };
      case "sci": return { text: sci(v), unit: "" };
      case "auto": default: return { text: auto(v), unit: "" };
    }
  }

  const text = (v, format) => { const f = value(v, format); return f.unit ? `${f.text} ${f.unit}` : f.text; };

  /* Axis tick label: fewer digits than a value. */
  function tick(v, format, step) {
    if (v == null) return "";
    switch (format) {
      case "pct": return `${parseFloat((v * 100).toPrecision(3))}%`;
      case "duration": {
        if (v >= 3600) { const h = v / 3600; return `${parseFloat(h.toFixed(h % 1 ? 1 : 0))}h`; }
        if (v >= 60) return `${Math.round(v / 60)}m`;
        return `${Math.round(v)}s`;
      }
      case "tokens": case "compact": case "int": case "num0": return compact(v, 3);
      case "gb": return `${parseFloat(v.toPrecision(3))}`;
      case "sci": return sci(v);
      default: {
        const dec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
        if (Math.abs(v) >= 1e4) return compact(v, 3);
        return v.toFixed(dec);
      }
    }
  }

  /* {dir, text} of cur − prev in the value's own units. */
  function delta(cur, prev, format) {
    if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return null;
    const d = cur - prev;
    const dir = Math.abs(d) < 1e-12 ? "flat" : d > 0 ? "up" : "down";
    let t;
    switch (format) {
      case "ratio": case "num3": t = Math.abs(d).toFixed(3); break;
      case "num2": t = Math.abs(d).toFixed(2); break;
      case "num1": t = Math.abs(d).toFixed(1); break;
      case "pct": t = `${(Math.abs(d) * 100).toFixed(2)} pt`; break;
      case "tokens": case "compact": t = compact(Math.abs(d), 2); break;
      case "int": case "num0": t = fmtInt(Math.abs(d)); break;
      case "duration": t = duration(Math.abs(d)); break;
      case "gb": t = Math.abs(d).toFixed(1); break;
      case "sci": t = sci(Math.abs(d)); break;
      default: t = auto(Math.abs(d));
    }
    return { dir, text: t, raw: d };
  }

  /* HTML for a delta. `good` = "up" | "down" | null decides whether the
     direction is coloured; text is otherwise secondary ink. */
  function deltaHTML(dl, good, suffix) {
    if (!dl) return "";
    if (dl.dir === "flat") return `<span class="delta flat">no change${suffix ? ` ${suffix}` : ""}</span>`;
    const arrow = dl.dir === "up" ? "▲" : "▼";
    const tone = good ? (good === dl.dir ? "good" : "bad") : "";
    return `<span class="delta ${tone}"><span class="arrow">${arrow}</span>${dl.text}${suffix ? ` <span class="delta-suffix">${suffix}</span>` : ""}</span>`;
  }

  /* Format for a public tag name from the config's [regex, format] rules;
     first match wins, default "auto". Compiled once per rule list. */
  let compiled = null, compiledFrom = null;
  function forTag(tag, rules) {
    if (rules !== compiledFrom) { compiledFrom = rules; compiled = (rules || []).map(([re, f]) => [new RegExp(re), f]); }
    for (const [re, f] of compiled) if (re.test(tag)) return f;
    return "auto";
  }

  window.Fmt = { int: fmtInt, compact, auto, sci, duration, clock, ago, runTime, value, text, tick, delta, deltaHTML, forTag };
})();
