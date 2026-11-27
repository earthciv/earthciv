// Tests for World Rankings on the world map: the rules (web/js/ext/ports/rankings.js) and the screen's markup
// (web/js/ext/ports/rankingsView.js), on made-up figures and on web/data/world-rankings.json itself.
//
// tests/test_world_rankings.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/rankings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OVERALL, cellOf, formatValue, lensScale, listWords, measureOf, ordinal, rampColor, rankOf, ranking, standing, summary, tabOf, RAMPS,
} from "../../web/js/ext/ports/rankings.js";
import { demographicsHtml, lensFills, lensLegendHtml, lensTip, rankingsHtml } from "../../web/js/ext/ports/rankingsView.js";

const ROOT = new URL("../../", import.meta.url);
const DOC = JSON.parse(readFileSync(new URL("web/data/world-rankings.json", ROOT), "utf8"));
const G20 = ["AR", "AU", "BR", "CA", "CN", "DE", "FR", "GB", "ID", "IN", "IT", "JP", "KR", "MX", "RU", "SA", "TR", "US", "ZA"];

// A small world: internet users with a three-way tie at the top, one figure from another year and one country with none.
const measure = (key, more = {}) => ({ key, label: key, unit: "", format: "pct", scale: "linear", indicator: "X", origin: "o", about: "a", year: 2024, ...more });
const SMALL = {
  version: 1,
  source: { title: "World Development Indicators", publisher: "World Bank", url: "https://example.org/", license: "CC BY 4.0", updated: "2026-11-11" },
  first_year: 2015,
  groups: [{ key: "knowledge", label: "Knowledge", lead: "net", measures: ["net", "papers"] }],
  measures: [measure("net"), measure("papers", { format: "articles", scale: "log", year: 2023 })],
  countries: {
    AE: { net: [2024, 100], papers: [2023, 7075] },
    BH: { net: [2024, 100], papers: [2023, 718] },
    SA: { net: [2024, 100], papers: [2023, 24595] },
    DK: { net: [2024, 99.8], papers: [2023, 15603] },
    TV: { net: [2017, 35.2], papers: [2023, 0.42] },
    ZZ: { papers: [2023, 0] },
  },
};
const NAMES = { AE: "United Arab Emirates", BH: "Bahrain", SA: "Saudi Arabia", DK: "Denmark", TV: "Tuvalu", ZZ: "Zedland", TW: "Taiwan" };
const nameOf = (iso) => NAMES[iso] || iso;
const ctx = (more = {}) => ({
  tab: OVERALL, mine: null, details: false, about: true, failed: false, nameOf, flag: (iso) => `[${iso}]`,
  countries: Object.entries(NAMES).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), ...more,
});

test("ordinals and lists of names", () => {
  const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 186].map(ordinal);
  assert.deepEqual(got, ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "186th"]);
  assert.equal(listWords(["Bahrain"]), "Bahrain");
  assert.equal(listWords(["Bahrain", "Saudi Arabia"]), "Bahrain and Saudi Arabia");
  assert.equal(listWords(["Bahrain", "Saudi Arabia", "United Arab Emirates"]), "Bahrain, Saudi Arabia and United Arab Emirates");
});

test("equal figures share a rank, and the next rank skips past them", () => {
  const r = ranking(SMALL, "net", nameOf);
  assert.deepEqual(r.rows.map((x) => [x.iso, x.rank, x.tied]), [["BH", 1, true], ["SA", 1, true], ["AE", 1, true], ["DK", 4, false]]);
  assert.deepEqual(rankOf(SMALL, "net", "DK"), { rank: 4, of: 4, tied: false });
  assert.deepEqual(rankOf(SMALL, "net", "AE"), { rank: 1, of: 4, tied: true });
});

test("a figure from another year is listed with its year and never ranked", () => {
  const r = ranking(SMALL, "net", nameOf);
  assert.deepEqual(r.others, [{ iso: "TV", year: 2017, value: 35.2 }]);
  assert.equal(rankOf(SMALL, "net", "TV"), null);
  assert.deepEqual(cellOf(SMALL, "net", "TV"), { year: 2017, value: 35.2, ranked: false });
  assert.equal(cellOf(SMALL, "net", "ZZ"), null); // no figure at all
  assert.equal(rankOf(SMALL, "net", "TW"), null);
});

test("figures from other years are in A–Z order, so they are never put in order of size", () => {
  const doc = structuredClone(SMALL);
  doc.countries.AA = { net: [2019, 99.9] };
  doc.countries.ZY = { net: [2020, 1] };
  const names = (iso) => ({ AA: "Aaland", ZY: "Zyland" })[iso] || nameOf(iso);
  assert.deepEqual(ranking(doc, "net", names).others.map((x) => x.iso), ["AA", "TV", "ZY"]);
});

test("a zero is a figure, ranked last", () => {
  const r = ranking(SMALL, "papers", nameOf);
  assert.equal(r.rows.at(-1).iso, "ZZ");
  assert.equal(r.rows.at(-1).value, 0);
  assert.equal(r.rows.length, 6);
  const s = summary(SMALL, "papers");
  assert.deepEqual(s.lowest, { value: 0, isos: ["ZZ"] });
  assert.deepEqual(s.highest, { value: 24595, isos: ["SA"] });
});

test("the highest names every country that shares it, and the average is plain", () => {
  const s = summary(SMALL, "net");
  assert.deepEqual(new Set(s.highest.isos), new Set(["AE", "BH", "SA"]));
  assert.equal(s.n, 4);
  assert.equal(s.average, (100 * 3 + 99.8) / 4);
});

test("a country on every measure", () => {
  const st = standing(SMALL, "TV");
  assert.equal(st.length, 2);
  assert.deepEqual([st[0].cell.ranked, st[0].rank, st[0].of], [false, null, 4]);
  assert.deepEqual([st[1].cell.ranked, st[1].rank, st[1].of], [true, 5, 6]); // 0.42 articles, above Zedland's 0
});

test("an address names a tab", () => {
  assert.equal(tabOf(SMALL, ""), OVERALL);
  assert.equal(tabOf(SMALL, "overall"), OVERALL);
  assert.equal(tabOf(SMALL, "NET"), "net");
  assert.equal(tabOf(SMALL, "knowledge"), "net"); // a group: its first measure
  assert.equal(tabOf(SMALL, "nonsense"), OVERALL);
  assert.equal(tabOf(null, "gdp"), "gdp"); // kept until the file is here
  assert.equal(tabOf(DOC, "economy"), "gdp");
});

test("figures are written in words, in U.S. dollars whatever the edition", () => {
  const usd = { format: "usd" };
  assert.equal(formatValue(usd, 30769700000000), "US$30.77 trillion");
  assert.equal(formatValue(usd, 30769700000000, { short: true }), "$30.8T");
  assert.equal(formatValue(usd, 626000000000, { short: true }), "$626B");
  assert.equal(formatValue(usd, 2319899772426, { short: true }), "$2.32T");
  assert.equal(formatValue(usd, 552324919096), "US$552.3 billion");
  assert.equal(formatValue(usd, 999960000000), "US$1.00 trillion");
  assert.equal(formatValue(usd, 48986.2), "US$48,986");
  assert.equal(formatValue(usd, 147300, { short: true }), "$147K");
  assert.equal(formatValue(usd, 55697.7, { short: true }), "$55,698");
  assert.equal(formatValue({ format: "people" }, 41651653, { short: true }), "41.7M");
  assert.equal(formatValue({ format: "people" }, 999700000, { short: true }), "1.00B");
  assert.equal(formatValue(usd, 0), "US$0");
  assert.equal(formatValue({ format: "people" }, 1463865525), "1.46 billion");
  assert.equal(formatValue({ format: "people" }, 341784857), "341.8 million");
  assert.equal(formatValue({ format: "people" }, 9492), "9,492");
  assert.equal(formatValue({ format: "years" }, 82.108), "82.1 years");
  assert.equal(formatValue({ format: "years" }, 82.108, { short: true }), "82.1");
  assert.equal(formatValue({ format: "pct" }, 100), "100%");
  assert.equal(formatValue({ format: "pct" }, 94.3533), "94.4%");
  assert.equal(formatValue({ format: "km2" }, 8788700), "8.79 million km²");
  assert.equal(formatValue({ format: "km2" }, 2.084), "2.08 km²");
  assert.equal(formatValue({ format: "tonnes" }, 0), "0 tonnes");
  assert.equal(formatValue({ format: "articles" }, 0.13), "0.13");
  assert.equal(formatValue({ format: "articles" }, 63719.9), "63,720");
  assert.equal(formatValue(usd, null), "–");
});

test("the colour scale: log where the file says so, a zero at the bottom, clamped at both ends", () => {
  const sc = lensScale(DOC, "gdp");
  assert.equal(sc.log, true);
  assert.equal(sc.t(0), 0);
  assert.equal(sc.t(1e20), 1);
  assert.ok(sc.t(1e12) > sc.t(1e10));
  assert.equal(sc.ticks.length, 5);
  assert.equal(lensScale(DOC, "life").log, false);
  assert.equal(rampColor(RAMPS.economy, 0), RAMPS.economy[0]);
  assert.equal(rampColor(RAMPS.economy, 1), RAMPS.economy.at(-1));
  assert.match(rampColor(RAMPS.land, 0.37), /^#[0-9a-f]{6}$/);
});

test("the file: every measure ranks the G20 on one year, and counts add up", () => {
  for (const m of DOC.measures) {
    const r = ranking(DOC, m.key);
    assert.equal(r.rows.length, m.ranked, m.key);
    assert.equal(r.rows.length + r.others.length, m.listed, m.key);
    assert.ok(r.rows.every((x) => x.year === m.year && Number.isFinite(x.value)), m.key);
    assert.ok(r.others.every((x) => x.year !== m.year), m.key);
    for (const iso of G20) assert.ok(rankOf(DOC, m.key, iso), `${iso} is not ranked on ${m.key}`);
  }
  assert.ok(measureOf(DOC, "gdp") && measureOf(DOC, "imports"));
});

test("Overall: a card per tab, a shared lead in words, the visitor's place", () => {
  let html = rankingsHtml(SMALL, ctx());
  assert.equal((html.match(/class="rk-card"/g) || []).length, 1);
  assert.match(html, /share the lead/);
  assert.match(html, /4 countries and territories ranked/);
  html = rankingsHtml(SMALL, ctx({ mine: "DK" }));
  assert.match(html, /You are in 4th place of 4/);
  html = rankingsHtml(SMALL, ctx({ mine: "AE" }));
  assert.match(html, /<b>You<\/b> share the lead/);
  html = rankingsHtml(SMALL, ctx({ mine: "TV" }));
  assert.match(html, /Tuvalu has no 2024 figure, so it is not ranked/);
  html = rankingsHtml(SMALL, ctx({ mine: "TW" }));
  assert.match(html, /The World Bank has no figure for Taiwan/);
});

test("a tab: every country in order, then other years, then the places with no figure", () => {
  const html = rankingsHtml(SMALL, ctx({ tab: "net", mine: "DK", details: true }));
  assert.equal((html.match(/class="rk-row[" ]/g) || []).length, 5); // 4 ranked + Tuvalu
  assert.match(html, /class="rk-row is-me" data-select="DK"/);
  assert.match(html, /No 2024 figure <span>1 · not ranked<\/span>/);
  assert.match(html, /<small>2017<\/small>/);
  assert.match(html, /No figure since 2015:<\/b> Taiwan, Zedland\./);
  assert.match(html, /class="rk-detail">papers 2023/); // "Show details": the tab's other measure
  assert.match(html, /<b>4th<\/b> of 4/);
  assert.doesNotMatch(html, /<img/);
});

test("before the file is here, and when it could not load", () => {
  assert.match(rankingsHtml(null, ctx()), /Gathering the figures/);
  assert.match(rankingsHtml(null, ctx({ failed: true })), /data-act="rankings-retry"/);
});

test("names are escaped", () => {
  NAMES.XX = "<b>Evil</b>";
  const doc = structuredClone(SMALL);
  doc.countries.XX = { net: [2024, 50] };
  const html = rankingsHtml(doc, ctx({ tab: "net" }));
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt;/);
  delete NAMES.XX;
});

test("Demographics: every measure, the country's rank and figure beside the highest, average and lowest", () => {
  const html = demographicsHtml(SMALL, "DK", { nameOf, flag: (iso) => `[${iso}]` });
  assert.equal((html.match(/<tr>/g) || []).length, 1 + SMALL.measures.length); // the header row and one per measure
  assert.match(html, /Demographics <span>where Denmark stands<\/span>/);
  assert.match(html, /class="dm-k" data-rank-tab="net"/); // a measure's name opens its tab
  assert.match(html, /<td class="dm-rank">4<\/td>/);
  assert.match(html, /\[BH\]<i>\+2<\/i><\/span>100%/); // a shared highest: the first flag and how many more
  assert.match(html, /https:\/\/data\.worldbank\.org\/indicator\/X\?locations=DK/);
});

test("Demographics: a figure from another year shows its year and no rank; no figures at all says so", () => {
  const html = demographicsHtml(SMALL, "TV", { nameOf, flag: (iso) => `[${iso}]` });
  assert.match(html, /<td class="dm-rank is-none" title="Not ranked: no 2024 figure">–<\/td>/);
  assert.match(html, /35\.2%<\/a><small>2017<\/small>/);
  assert.match(demographicsHtml(SMALL, "TW", { nameOf, flag: (iso) => iso }), /The World Bank publishes no figures for Taiwan\./);
});

test("the lens colours every ranked country, and only those", () => {
  for (const m of DOC.measures) {
    const fills = lensFills(DOC, m.key);
    const r = ranking(DOC, m.key);
    assert.equal(fills.size, r.rows.length, m.key);
    for (const x of r.rows) assert.match(fills.get(x.iso), /^#[0-9a-f]{6}$/, `${m.key} ${x.iso}`);
    for (const x of r.others) assert.equal(fills.has(x.iso), false, `${m.key} ${x.iso} is from another year`);
  }
  // The highest and the lowest take the ramp's two ends.
  const gdp = ranking(DOC, "gdp");
  assert.equal(lensFills(DOC, "gdp").get(gdp.rows[0].iso), RAMPS.economy.at(-1));
  assert.equal(lensFills(DOC, "gdp").get(gdp.rows.at(-1).iso), RAMPS.economy[0]);
});

test("the lens's key: measure, year, scale and the colour of no figure", () => {
  const html = lensLegendHtml(DOC, "gdp");
  assert.match(html, /<b>GDP<\/b><small>2025 · current US\$ · log scale<\/small>/);
  assert.equal((html.match(/<span>/g) || []).length, 5);
  assert.match(html, /<span>≤ \$/);
  assert.match(html, /<span>≥ \$/);
  assert.match(html, /No 2025 figure, so not ranked/);
  assert.doesNotMatch(lensLegendHtml(DOC, "life"), /log scale/);
  assert.equal(lensLegendHtml(DOC, "nonsense"), "");
});

test("the hover tip under the lens: figure, year and rank, or why there is no rank", () => {
  assert.deepEqual(lensTip(SMALL, "net", "DK"), { value: "net 2024: 99.8%", rank: "4th of 4" });
  assert.deepEqual(lensTip(SMALL, "net", "BH"), { value: "net 2024: 100%", rank: "1st of 4 (tied)" });
  assert.deepEqual(lensTip(SMALL, "net", "TV"), { value: "net 2017: 35.2%", rank: "Not ranked: no 2024 figure" });
  assert.deepEqual(lensTip(SMALL, "net", "ZZ"), { value: "net: no figure", rank: "" });
});
