// World Rankings: who leads each measure of web/data/world-rankings.json, where a country stands, and how a figure
// is written (pipeline/build_world_rankings.py makes the file). The screen itself is ./rankingsView.js.
//
// A measure is ranked on its own year (`year` in the file). A country's figure from any other year is shown with that
// year and never ranked, so figures from different years are never put in one order. Equal values share a rank: the
// rank is one more than the number of countries with a higher value.
//
// This module imports nothing and never touches the page, so tests/js/rankings.test.mjs runs it in Node.

export const OVERALL = "overall";

const fin = Number.isFinite;

/** The measure with this key, or null. */
export function measureOf(doc, key) {
  return doc?.measures?.find((m) => m.key === key) || null;
}

/** The group (tab) a measure belongs to, or the group with this key; null if neither. */
export function groupOf(doc, key) {
  return doc?.groups?.find((g) => g.key === key || g.measures.includes(key)) || null;
}

/**
 * The tab a value of the address's #rankings= names: "overall", a measure's key, or a group's key (its first measure).
 * Anything else is the Overall tab. Before the file has loaded a value is kept as it is, to be checked once it is here.
 */
export function tabOf(doc, value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === OVERALL) return OVERALL;
  if (!doc) return v.slice(0, 40);
  if (measureOf(doc, v)) return v;
  return doc.groups?.find((g) => g.key === v)?.lead || OVERALL;
}

/** A country's figure for a measure: {year, value, ranked}, or null when it has none. */
export function cellOf(doc, key, iso) {
  const m = measureOf(doc, key);
  const c = doc?.countries?.[iso]?.[key];
  if (!m || !Array.isArray(c) || c.length !== 2 || !fin(c[1])) return null;
  return { year: c[0], value: c[1], ranked: c[0] === m.year };
}

const cache = new WeakMap(); // doc → Map(key → ranking), so a screen of ten rankings sorts each one once

/**
 * Every country with a figure for the measure. `rows` have a figure for the measure's year, highest first, each
 * with its `rank` (equal values share one, `tied` says so). `others` have a figure from another year only: they are
 * in the order of `nameOf` (A–Z), never by value, since that would rank figures of different years.
 */
export function ranking(doc, key, nameOf = (iso) => iso) {
  const m = measureOf(doc, key);
  if (!m) return null;
  let byDoc = cache.get(doc);
  if (!byDoc) cache.set(doc, (byDoc = new Map()));
  const memo = byDoc.get(key);
  if (memo && memo.nameOf === nameOf) return memo.result;
  const rows = [];
  const others = [];
  for (const [iso, row] of Object.entries(doc.countries || {})) {
    const c = row?.[key];
    if (!Array.isArray(c) || c.length !== 2 || !fin(c[1])) continue;
    (c[0] === m.year ? rows : others).push({ iso, year: c[0], value: c[1] });
  }
  const byName = (a, b) => String(nameOf(a.iso)).localeCompare(String(nameOf(b.iso)));
  rows.sort((a, b) => b.value - a.value || byName(a, b));
  const counts = new Map();
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.value === rows[i - 1].value ? rows[i - 1].rank : i + 1;
    counts.set(r.rank, (counts.get(r.rank) || 0) + 1);
  });
  for (const r of rows) r.tied = counts.get(r.rank) > 1;
  others.sort(byName);
  const result = { measure: m, year: m.year, rows, others };
  byDoc.set(key, { nameOf, result });
  return result;
}

/** Where a country stands on a measure: {rank, of, tied}, or null when it is not ranked on it. */
export function rankOf(doc, key, iso) {
  const r = ranking(doc, key);
  const row = r?.rows.find((x) => x.iso === iso);
  return row ? { rank: row.rank, of: r.rows.length, tied: row.tied } : null;
}

/** The ranked figures' highest and lowest (each with every country that has it) and their plain average. */
export function summary(doc, key) {
  const r = ranking(doc, key);
  if (!r?.rows.length) return null;
  const values = r.rows.map((x) => x.value);
  const hi = values[0];
  const lo = values[values.length - 1];
  return {
    year: r.year,
    n: values.length,
    average: values.reduce((a, b) => a + b, 0) / values.length,
    highest: { value: hi, isos: r.rows.filter((x) => x.value === hi).map((x) => x.iso) },
    lowest: { value: lo, isos: r.rows.filter((x) => x.value === lo).map((x) => x.iso) },
  };
}

/** A country on every measure, in the file's order: {measure, cell, rank, of, tied}; cell is null without a figure. */
export function standing(doc, iso) {
  return (doc?.measures || []).map((m) => {
    const cell = cellOf(doc, m.key, iso);
    const at = cell?.ranked ? rankOf(doc, m.key, iso) : null;
    return { measure: m, cell, rank: at?.rank ?? null, of: at?.of ?? ranking(doc, m.key).rows.length, tied: !!at?.tied };
  });
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 102nd… */
export function ordinal(n) {
  const k = n % 100;
  const end = k >= 11 && k <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${end}`;
}

/** "Canada", "Canada and Mexico", "Canada, Mexico and Chile". */
export function listWords(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// --- writing a figure ------------------------------------------------------------------------------------------------
const STEPS = [
  [1e12, " trillion", "T"],
  [1e9, " billion", "B"],
  [1e6, " million", "M"],
];
const group = (v, digits = 0) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// In trillions, billions or millions: four significant figures written out ("30.77 trillion", "552.3 billion"), three
// when short ("30.8T", "552B"). Below a million, whole numbers with separators ("48,986"; short from 100,000: "147K"),
// and below ten, two decimals at most ("0.13").
const fixed = (x, short) => {
  const a = Math.abs(x);
  return short ? x.toFixed(a >= 99.95 ? 0 : a >= 9.995 ? 1 : 2) : x.toFixed(a >= 99.995 ? 1 : 2);
};
function big(v, short) {
  const a = Math.abs(v);
  for (let i = 0; i < STEPS.length; i++) {
    const [unit, long, abbr] = STEPS[i];
    if (a < unit * 0.9995) continue;
    const text = fixed(v / unit, short);
    // 999.96 billion rounds to "1000.0": write it in the larger unit instead
    if (Math.abs(Number(text)) >= 1000 && i > 0) {
      const [u2, l2, a2] = STEPS[i - 1];
      return `${fixed(v / u2, short)}${short ? a2 : l2}`;
    }
    return `${text}${short ? abbr : long}`;
  }
  if (short && a >= 1e5) return `${fixed(v / 1e3, true)}K`;
  if (a >= 10 || Number.isInteger(v)) return group(Math.round(v));
  return String(Number(v.toFixed(2)));
}

/**
 * A figure as the screen writes it. Long ({short: false}, the default): "US$30.77 trillion", "41.65 million",
 * "82.1 years", "94.4%", "8.79 million km²", "63.66 million tonnes". Short, for a table: "$30.8T", "41.7M", "82.1",
 * "94.4%", "8.79M", "63.7M". Missing values are "–".
 */
export function formatValue(measure, value, { short = false } = {}) {
  if (!fin(value)) return "–";
  switch (measure?.format) {
    case "usd": {
      const sign = value < 0 ? "−" : "";
      return `${sign}${short ? "$" : "US$"}${big(Math.abs(value), short)}`;
    }
    case "years":
      return short ? value.toFixed(1) : `${value.toFixed(1)} years`;
    case "pct":
      return `${value >= 99.95 ? Math.round(value) : value.toFixed(1)}%`;
    case "km2":
      return short ? big(value, true) : `${big(value, false)} km²`;
    case "tonnes":
      return short ? big(value, true) : `${big(value, false)} tonnes`;
    case "people":
    case "articles":
    default:
      return big(value, short);
  }
}

// --- colour scale (map lens and the bars in a ranking) -----------------------------------------------------------------
/**
 * The scale a measure is drawn on: its ranked figures from the 2nd to the 98th percentile (end to end where those
 * meet), on a log scale where the file says so. t(value) is 0..1 (clamped); a zero on a log scale is 0.
 */
export function lensScale(doc, key) {
  const r = ranking(doc, key);
  if (!r?.rows.length) return null;
  const log = r.measure.scale === "log";
  const values = r.rows.map((x) => x.value).filter((v) => (log ? v > 0 : fin(v))).sort((a, b) => a - b);
  if (!values.length) return null;
  const at = (p) => values[Math.round(p * (values.length - 1))];
  let d0 = at(0.02);
  let d1 = at(0.98);
  if (!(d1 > d0)) [d0, d1] = [values[0], values[values.length - 1]];
  const f = log ? Math.log : (x) => x;
  const span = f(d1) - f(d0) || 1;
  const t = (v) => {
    if (!fin(v)) return null;
    if (log && v <= 0) return 0;
    return Math.max(0, Math.min(1, (f(v) - f(d0)) / span));
  };
  const valueAt = (p) => (log ? Math.exp(f(d0) + p * span) : d0 + p * span);
  return { log, d0, d1, t, ticks: [0, 0.25, 0.5, 0.75, 1].map(valueAt) };
}

/** A country without a figure for the open tab's year, on the map. */
export const NO_DATA = "#41464e";

/** Each tab's colours on the map, dark to light, from its advisor's colour (web/js/ext/advisors/core/roster.js). */
export const RAMPS = {
  economy: ["#2b1f08", "#5c4314", "#937024", "#c9a43a", "#e6cb72", "#fff2c2"],
  people: ["#2b1009", "#5c2717", "#91442c", "#c46a4f", "#e19a7d", "#fbd8c6"],
  knowledge: ["#0b1730", "#17356b", "#2b5ca6", "#4a86d6", "#8cb7ec", "#d9e9ff"],
  land: ["#15210b", "#2d4515", "#4c6f23", "#6e9a3c", "#a4c56a", "#e2f1bf"],
  commerce: ["#05202a", "#0c4552", "#167383", "#2fa4b8", "#76cfdb", "#d2f2f5"],
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** The colour at t (0..1) along a ramp of hex stops, as #rrggbb. */
export function rampColor(stops, t) {
  const x = Math.max(0, Math.min(1, fin(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const k = x - i;
  return `#${a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}
