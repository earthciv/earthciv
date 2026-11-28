// Tests for World Rankings' Ratings tab: how the maps' star ratings put the maps in order
// (web/js/ext/ports/rankingsRatings.js) and how the screen shows them, each with its maker
// (web/js/ext/ports/rankingsView.js), on made-up maps and ratings and on web/data/ports.json itself.
//
// tests/test_world_rankings.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/rankingsRatings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OVERALL, RAMPS, cellOf, measureOf, rankOf, ranking, tabOf } from "../../web/js/ext/ports/rankings.js";
import {
  RATING, RATINGS, START, START_RATINGS, formatScore, mapsOf, namesRatings, placeOf, scoreOf, tallyRatings, tallySignature, withRatings,
} from "../../web/js/ext/ports/rankingsRatings.js";
import { demographicsHtml, lensFills, lensLegendHtml, mapStandingHtml, rankingsHtml } from "../../web/js/ext/ports/rankingsView.js";
import { createRatings, rateable } from "../../web/js/ext/ports/ratings.js";

const ROOT = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
const CATALOG = json("web/data/ports.json").ports;
const DOC = json("web/data/world-rankings.json");
const OUTLINES = json("web/data/world-outlines.json").countries;

// A small catalog, in its own order. Canada has an edition and a community map; France a map of the whole country
// and one of a part of it; one map covers three countries. Germany's own map is source code, which cannot be rated,
// and neither can a link that a visitor saved.
const live = (id, countries, more = {}) => ({ id, name: id, author: `${id}-maker`, status: "live", url: `https://${id}.example/`, embed: true, countries, ...more });
const PORTS = [
  { id: "ca", name: "Canada", author: "Ada", status: "merged", editionId: "ca", url: null, countries: ["CA"] },
  live("canciv", ["CA"]),
  live("frciv", ["FR"]),
  live("bretagne", ["FR"], { scope: "region" }),
  live("jpciv", ["JP"]),
  live("plciv", ["PL"]),
  live("europe", ["FR", "DE", "PL"], { scope: "multi" }),
  { id: "deciv", name: "deciv", author: "Dora", status: "repo", url: null, repo: "someone/deciv", countries: ["DE"] },
  { id: "mine", name: "my link", status: "custom", url: "https://mine.example/", embed: true, countries: ["JP"] },
];
// [number of ratings, sum of their stars]
const RATED = { ca: [2, 6], frciv: [1, 5], bretagne: [1, 5], plciv: [1, 5], europe: [40, 200], deciv: [9, 45], mine: [3, 15] };
const ratingOf = (table) => (id) => (table[id] ? { n: table[id][0], sum: table[id][1] } : { n: 0, sum: 0 });
const ids = (rows) => rows.map((x) => x.port.id);

const measure = (key, more = {}) => ({ key, label: key, unit: "", format: "pct", scale: "linear", indicator: "X", origin: "o", about: "a", year: 2024, ...more });
const SMALL = {
  version: 1,
  source: { title: "World Development Indicators", publisher: "World Bank", url: "https://example.org/", license: "CC BY 4.0", updated: "2026-11-11" },
  first_year: 2015,
  groups: [{ key: "knowledge", label: "Knowledge", lead: "net", measures: ["net"] }],
  measures: [measure("net")],
  countries: { CA: { net: [2024, 94] }, FR: { net: [2024, 88] }, DE: { net: [2024, 93] }, JP: { net: [2024, 87] } }, // none for Poland
};
const NAMES = { CA: "Canada", DE: "Germany", FR: "France", JP: "Japan", PL: "Poland", ZZ: "Zedland" };
const nameOf = (iso) => NAMES[iso] || iso;
// What ./index.js gives the screen for a map: its emblem (HTML), its maker (a name, and the line of HTML with their
// picture and links) and the country whose card its row opens.
const ctx = (more = {}) => ({
  tab: RATING, mine: null, details: false, about: true, failed: false, nameOf, flag: (iso) => `[${iso}]`,
  countries: Object.entries(NAMES).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  canRate: true, ratingsUrl: "https://example.org/RATINGS.md",
  icon: (p) => `(${p.id})`, makerName: (p) => p.author || "", maker: (p) => (p.author ? `<a class="by" href="https://example.org/${p.id}">${p.author}</a>` : ""),
  home: (p) => p.countries[0] || null,
  ...more,
});
const tally = (table = RATED, ports = PORTS, day = 0) => tallyRatings(ports, ratingOf(table), { day });
const rated = (table = RATED, ports = PORTS, doc = SMALL) => withRatings(doc, tally(table, ports));
const rowIds = (html) => [...html.matchAll(/<button type="button" class="rk-row" [^>]*data-map="([^"]+)"/g)].map((x) => x[1]);

test("every map that can be rated is listed: of one country, of a part of one, or of several", () => {
  const t = tally();
  assert.deepEqual(ids(t.rows), ["europe", "frciv", "bretagne", "plciv", "ca"]);
  assert.deepEqual(ids(t.waiting), ["canciv", "jpciv"]); // nobody has rated them yet
  // Source code and a visitor's own link cannot be rated, whatever totals arrive for them.
  assert.equal(t.unlisted, 2);
  for (const port of PORTS) assert.equal([...t.rows, ...t.waiting].some((x) => x.port === port), rateable(port), port.id);
  assert.deepEqual([t.n, t.sum], [45, 221]);
  assert.deepEqual(t.rows[0], { port: PORTS[6], n: 40, sum: 200, average: 5, score: 4.86, rank: 1, tied: false });
  assert.deepEqual(t.waiting[0], { port: PORTS[1], n: 0, sum: 0, average: null, score: null, rank: null, tied: false });
});

test("a score starts in the middle of the scale and its ratings pull it from there", () => {
  assert.equal(START, 3);
  assert.equal(START_RATINGS, 3);
  assert.equal(scoreOf(0, 0), null);
  assert.equal(scoreOf(1, 5), 3.5);
  assert.equal(scoreOf(10, 50), 4.54);
  assert.equal(scoreOf(100, 500), 4.94);
  assert.equal(scoreOf(1, 1), 2.5);
  assert.equal(scoreOf(100, 100), 1.06);
  assert.equal(scoreOf(7, 21), 3); // ratings that average the middle leave it there
  // More ratings of the same average move it further from the middle, up to the average and never past it.
  let last = START;
  for (const n of [2, 4, 10, 20, 100]) {
    const s = scoreOf(n, n * 4.5);
    assert.ok(s > last && s < 4.5, `${n} ratings: ${s}`);
    last = s;
  }
  assert.equal(scoreOf(100000, 450000), 4.5);
  last = START;
  for (const n of [2, 4, 10, 20, 100]) {
    const s = scoreOf(n, n * 1.5);
    assert.ok(s < last && s > 1.5, `${n} ratings: ${s}`);
    last = s;
  }
  // Every score is on the scale, to two decimals.
  for (let n = 1; n <= 40; n++) {
    for (let sum = n; sum <= 5 * n; sum++) {
      const s = scoreOf(n, sum);
      assert.ok(s >= 1 && s <= 5, `${n}/${sum}`);
      assert.equal(s, Number(s.toFixed(2)));
    }
  }
});

test("a map's place is one more than the maps with a higher score, and equal scores share it", () => {
  const t = tally();
  assert.deepEqual(t.rows.map((x) => [x.port.id, x.score, x.rank, x.tied]), [
    ["europe", 4.86, 1, false], ["frciv", 3.5, 2, true], ["bretagne", 3.5, 2, true], ["plciv", 3.5, 2, true], ["ca", 3, 5, false],
  ]);
  assert.deepEqual([placeOf(t, "ca").rank, placeOf(t, "ca").of, placeOf(t, "ca").tied], [5, 5, false]);
  assert.deepEqual([placeOf(t, "plciv").rank, placeOf(t, "plciv").of, placeOf(t, "plciv").tied], [2, 5, true]);
  assert.equal(placeOf(t, "plciv").port, PORTS[5]);
  assert.equal(placeOf(t, "jpciv"), null); // no rating yet
  assert.equal(placeOf(t, "deciv"), null); // cannot be rated
  assert.equal(placeOf(t, "nowhere"), null);
  assert.equal(placeOf(null, "ca"), null);
  // The scores that read alike share a place: (9 + 12) / 6 is 3.50, as one five-star rating is.
  assert.deepEqual(tally({ jpciv: [3, 12], plciv: [1, 5] }).rows.map((x) => [x.port.id, x.score, x.rank, x.tied]), [["jpciv", 3.5, 1, true], ["plciv", 3.5, 1, true]]);
});

test("maps that share a place: the most rated first, and then they take turns by the day", () => {
  // Three ratings come before one, whichever is first in the catalog.
  assert.deepEqual(ids(tally({ plciv: [1, 5], jpciv: [3, 12], ca: [1, 5] }).rows), ["jpciv", "ca", "plciv"]);
  // The same place and as many ratings: the catalog's order, moved round by one place every day.
  const even = { ca: [1, 5], frciv: [1, 5], plciv: [1, 5] };
  assert.deepEqual(ids(tally(even, PORTS, 0).rows), ["ca", "frciv", "plciv"]);
  assert.deepEqual(ids(tally(even, PORTS, 1).rows), ["frciv", "plciv", "ca"]);
  assert.deepEqual(ids(tally(even, PORTS, 3).rows), ["plciv", "ca", "frciv"]);
  assert.deepEqual(ids(tally(even, PORTS, 7).rows), ids(tally(even, PORTS, 0).rows)); // seven maps can be rated: a week later, the same
  for (const day of [0, 1, 3]) assert.deepEqual(tally(even, PORTS, day).rows.map((x) => x.rank), [1, 1, 1]); // a turn is not a place
  // So do the maps without a rating: each is first on its day.
  const first = new Set();
  for (let day = 0; day < 7; day++) {
    const t = tally({}, PORTS, day);
    assert.equal(t.waiting.length, 7);
    first.add(t.waiting[0].port.id);
  }
  assert.equal(first.size, 7);
  assert.deepEqual(ids(tally({}, PORTS, 2).waiting), ["frciv", "bretagne", "jpciv", "plciv", "europe", "ca", "canciv"]);
  // A higher score is never a matter of turns.
  for (let day = 0; day < 7; day++) assert.equal(tally(RATED, PORTS, day).rows[0].port.id, "europe");
  // Any day will do: one before the count began, one that is no number at all.
  assert.deepEqual(ids(tally(even, PORTS, -1).rows), ids(tally(even, PORTS, 6).rows));
  assert.deepEqual(ids(tallyRatings(PORTS, ratingOf(even), { day: "soon" }).rows), ids(tally(even, PORTS, 0).rows));
  assert.deepEqual(ids(tallyRatings(PORTS, ratingOf(even)).rows), ids(tally(even, PORTS, 0).rows));
  assert.equal("turn" in tally().rows[0], false);
});

test("a map's score depends on its own ratings alone", () => {
  const before = tally();
  const after = tally({ ...RATED, plciv: [50, 60], jpciv: [3, 15], europe: [1, 1] });
  for (const id of ["frciv", "bretagne", "ca"]) assert.equal(placeOf(after, id).score, placeOf(before, id).score, id);
  assert.notEqual(placeOf(after, "plciv").score, placeOf(before, "plciv").score);
  assert.notEqual(placeOf(after, "ca").rank, placeOf(before, "ca").rank); // only its place moves
});

test("totals that could not be are brought back within the scale", () => {
  const t = tally({ frciv: [2, 99], ca: [3, 0], canciv: [-4, 9], jpciv: [2.9, 9], plciv: ["2", 8] });
  assert.deepEqual([placeOf(t, "frciv").n, placeOf(t, "frciv").sum, placeOf(t, "frciv").score], [2, 10, 3.8]);
  assert.deepEqual([placeOf(t, "ca").n, placeOf(t, "ca").sum], [3, 3]);
  assert.deepEqual([placeOf(t, "jpciv").n, placeOf(t, "jpciv").sum], [2, 9]);
  assert.equal(placeOf(t, "canciv"), null); // fewer than no ratings is no rating
  assert.equal(placeOf(t, "plciv"), null); // nor is a count that is not a number
  assert.deepEqual([t.n, t.sum], [7, 22]);
  assert.equal(tallyRatings(PORTS, () => null).n, 0);
  assert.deepEqual(tallyRatings(null), { n: 0, sum: 0, rows: [], waiting: [], unlisted: 0 });
});

test("the tab joins the rankings file as one more group, and the file is left as it was", () => {
  const frozen = JSON.stringify(SMALL);
  const t = tally();
  const doc = withRatings(SMALL, t);
  assert.equal(JSON.stringify(SMALL), frozen);
  assert.deepEqual(doc.groups.map((g) => g.key), ["knowledge", RATINGS]);
  assert.deepEqual(doc.groups.at(-1), { key: RATINGS, label: "Ratings", lead: RATING, measures: [RATING] });
  const m = measureOf(doc, RATING);
  assert.deepEqual([m.live, m.year, m.top], [true, null, 5]);
  assert.doesNotMatch(m.label + m.unit + m.about, /[<>]/);
  assert.equal(doc.tally, t);
  assert.equal(doc.countries, SMALL.countries); // what it ranks is maps: no country gets a figure
  assert.equal(tabOf(doc, "ratings"), RATING);
  assert.equal(tabOf(doc, "Rating"), RATING);
  assert.equal(tabOf(SMALL, "ratings"), OVERALL); // where no ratings are kept there is no such tab
  // Added twice, it is there once.
  const twice = withRatings(doc, tally());
  assert.equal(twice.groups.filter((g) => g.key === RATINGS).length, 1);
  assert.equal(twice.measures.filter((x) => x.key === RATING).length, 1);
  assert.equal(withRatings(SMALL, null), SMALL);
  assert.equal(withRatings(null, tally()), null);
});

test("the other tabs rank the countries as before, and the tab colours no country", () => {
  const doc = rated();
  assert.deepEqual(ranking(doc, "net", nameOf).rows.map((x) => x.iso), ["CA", "DE", "FR", "JP"]);
  assert.deepEqual(ranking(doc, "net", nameOf).rows.map((x) => x.rank), ranking(SMALL, "net", nameOf).rows.map((x) => x.rank));
  assert.deepEqual(ranking(doc, RATING, nameOf).rows, []);
  assert.equal(cellOf(doc, RATING, "FR"), null);
  assert.equal(rankOf(doc, RATING, "FR"), null);
  // Under the tab the world map keeps the maps' pins: there is no lens of countries, and no key for one.
  assert.equal(lensFills(doc, RATING).size, 0);
  assert.equal(lensLegendHtml(doc, RATING), "");
  assert.equal(RAMPS[RATINGS], undefined);
  assert.equal(lensFills(doc, "net").size, 4);
});

test("an address can name the tab before it is known to exist", () => {
  for (const v of ["ratings", "rating", " Ratings ", "RATING"]) assert.equal(namesRatings(v), true, v);
  for (const v of ["", null, undefined, "overall", "rate", "ratingsx", "gdp"]) assert.equal(namesRatings(v), false, String(v));
});

test("a tally that would draw the same has the same signature", () => {
  const a = tally();
  assert.equal(tallySignature(a), tallySignature(tally({ ...RATED })));
  assert.notEqual(tallySignature(a), tallySignature(tally({ ...RATED, ca: [2, 7] })));
  assert.notEqual(tallySignature(a), tallySignature(tally({ ...RATED, jpciv: [1, 3] })));
  assert.notEqual(tallySignature(a), tallySignature(tally(RATED, PORTS.slice(0, -1)))); // one map fewer in the catalog
  assert.notEqual(tallySignature(a), tallySignature(tally(RATED, PORTS, 3))); // another day, on which the turns put the maps in another order
  assert.equal(tallySignature(a), tallySignature(tally(RATED, PORTS, 1))); // and a day on which they do not
  assert.equal(tallySignature(null), "");
});

test("a score is written with its two decimals", () => {
  assert.equal(formatScore(3.5), "3.50");
  assert.equal(formatScore(4.54), "4.54");
  assert.equal(formatScore(5), "5.00");
  assert.equal(formatScore(null), "–");
  assert.equal(formatScore(undefined), "–");
});

test("the maps of a country: every listed map that covers it, its best placed first", () => {
  const t = tally();
  assert.deepEqual(ids(mapsOf(t, "FR")), ["europe", "frciv", "bretagne"]); // the map of several countries is France's too
  assert.deepEqual(ids(mapsOf(t, "CA")), ["ca", "canciv"]); // the rated one, then the one that waits
  assert.deepEqual(ids(mapsOf(t, "JP")), ["jpciv"]); // not the visitor's own link
  assert.deepEqual(ids(mapsOf(t, "DE")), ["europe"]); // not its source code
  assert.deepEqual(mapsOf(t, "ZZ"), []);
  assert.deepEqual(mapsOf(t, null), []);
  assert.deepEqual(mapsOf(null, "FR"), []);
});

test("Overall: the tab has its card, with the map that leads and who made it", () => {
  let html = rankingsHtml(rated(), ctx({ tab: OVERALL }));
  assert.equal((html.match(/class="rk-card"/g) || []).length, 2);
  assert.match(html, /data-rank-tab="rating"[^>]*aria-label="Ratings, Visitors&#39; score now: europe by europe-maker leading\. 5 maps ranked on 45 ratings\. Open the Ratings tab\."/);
  assert.match(html, /Ratings <small>Visitors&#39; score · now<\/small>/);
  assert.match(html, /<b>europe<\/b> by europe-maker leading/);
  assert.match(html, /on the World Bank's newest figures, and how this site's visitors rate the maps\./);
  assert.match(html, /Ratings: this site's visitors\./);
  // The first maps' emblems, in order; the one leader's is the large one.
  const card = html.slice(html.indexOf('class="rk-card" data-rank-tab="rating"'));
  assert.deepEqual([...card.matchAll(/<span class="rk-em[^"]*" title="([^"]+)">/g)].map((x) => x[1]), ["1st: europe", "2nd: frciv", "2nd: bretagne", "2nd: plciv", "5th: Canada"]);
  assert.match(card, /<span class="rk-em is-lead" title="1st: europe">\(europe\)<\/span>/);
  assert.equal((card.match(/is-lead/g) || []).length, 1);
  // One rating altogether, by a map nobody is named for.
  html = rankingsHtml(rated({ plciv: [1, 4] }), ctx({ tab: OVERALL, makerName: () => "" }));
  assert.match(html, /<b>plciv<\/b> leading/);
  assert.match(html, /1 map ranked on 1 rating/);
  // Without the tab the screen is as it was.
  html = rankingsHtml(SMALL, ctx({ tab: OVERALL }));
  assert.equal((html.match(/class="rk-card"/g) || []).length, 1);
  assert.doesNotMatch(html, /Ratings|visitors/);
  assert.match(html, /newest figures\. Each card is one tab's first\s+measure; open it for every country in order\./);
});

test("Overall: the card says where the best placed map of the visitor's country stands", () => {
  const card = (mine, table = RATED) => {
    const html = rankingsHtml(rated(table), ctx({ tab: OVERALL, mine }));
    return html.slice(html.indexOf('class="rk-card" data-rank-tab="rating"'));
  };
  assert.match(card("CA"), /The best-placed map of Canada is 5th of 5</);
  assert.match(card("FR"), /The best-placed map of France is 1st of 5</); // the map of several countries covers it
  assert.match(card("PL", { plciv: [1, 5], frciv: [1, 5] }), /The best-placed map of Poland is 1st of 2 \(tied\)</);
  assert.match(card("JP"), /Nobody has rated a map of Japan yet/);
  assert.match(card("ZZ"), /No map of Zedland can be rated yet/);
  // Its maps are marked among the emblems, and the other cards still speak of the country itself.
  assert.match(card("CA"), /<span class="rk-em is-me" title="5th: Canada">/);
  assert.match(rankingsHtml(rated(), ctx({ tab: OVERALL, mine: "CA" })), /<b>You<\/b> are leading/);
});

test("Overall: before anyone has rated a map the card says so", () => {
  const html = rankingsHtml(rated({}), ctx({ tab: OVERALL }));
  const card = html.slice(html.indexOf('class="rk-card" data-rank-tab="rating"'));
  assert.match(card, /<b>No ratings yet<\/b>/);
  assert.match(card, /Rate a map to put it on the board/);
  assert.doesNotMatch(card, /leading/);
  assert.doesNotMatch(card, /class="rk-flags"/); // no row of emblems to show
});

test("Overall: many maps with the same score are counted, not all named", () => {
  const ports = ["aa", "bb", "cc", "dd", "ee"].map((id) => live(id, [id.toUpperCase()]));
  const table = Object.fromEntries(ports.map((p) => [p.id, [1, 5]]));
  let html = rankingsHtml(rated(table, ports), ctx({ tab: OVERALL }));
  assert.match(html, /<b>5 maps<\/b> share the lead/);
  assert.doesNotMatch(html.slice(html.indexOf('class="rk-card" data-rank-tab="rating"')), /is-lead/); // no emblem stands for a lead that five share
  html = rankingsHtml(rated(table, ports.slice(0, 3)), ctx({ tab: OVERALL }));
  assert.match(html, /<b>aa, bb and cc<\/b> share the lead/);
});

test("the tab: every rated map in order, each with the ratings behind its score and its maker", () => {
  const html = rankingsHtml(rated(), ctx());
  assert.match(html, /<div class="rk" data-tab="rating">/);
  assert.match(html, /data-rank-tab="rating" aria-pressed="true"[^>]*title="Ratings: Tribune of the People"/);
  assert.match(html, /<small>Tribune of the People<\/small><h3>Ratings<\/h3>/);
  assert.deepEqual(rowIds(html), ["europe", "frciv", "bretagne", "plciv", "ca", "canciv", "jpciv"]); // five ranked, then the two that wait
  assert.match(html, /<span>Map and maker<\/span><span title="Each bar is the score as a share of 5">Visitors&#39; score · now<\/span>/);
  // A ranked map: its place, emblem, name and score, the ratings behind the score, its maker, and the score as a bar.
  const europe = html.slice(html.indexOf('<li class="rk-map" data-port-id="europe"'), html.indexOf('<li class="rk-map" data-port-id="frciv"'));
  assert.match(europe, /^<li class="rk-map" data-port-id="europe">/); // of several countries: none to name on the world map
  assert.match(europe, /<button type="button" class="rk-row" data-select="FR" data-map="europe" title="europe: open its card, with its stars">/);
  assert.match(europe, /<span class="rk-rank is-top">1<\/span><span class="rk-em" aria-hidden="true">\(europe\)<\/span>\s*<span class="rk-name">europe<\/span>/);
  assert.match(europe, /<span class="rk-val">4\.86<\/span><span class="rk-detail">.*<b>5\.0<\/b> from 40 ratings<\/span><\/span>/);
  assert.match(europe, /<\/button>\s*<div class="rk-by"><a class="by" href="https:\/\/example\.org\/europe">europe-maker<\/a><\/div>/); // links: beside the button, not in it
  assert.match(europe, /<i class="rk-bar" style="--t:0\.972" aria-hidden="true"><\/i>/); // 4.86 of 5
  assert.equal((europe.match(/<button/g) || []).length, 1);
  // A map of one country names it for the world map; maps that share a place say so.
  assert.match(html, /<li class="rk-map" data-port-id="frciv" data-hover="FR">/);
  assert.match(html, /<span class="rk-rank is-top" title="Tied for 2nd">2<\/span><span class="rk-em" aria-hidden="true">\(frciv\)/);
  assert.match(html, /<span class="rk-rank">5<\/span><span class="rk-em" aria-hidden="true">\(ca\)<\/span>\s*<span class="rk-name">Canada<\/span>/);
  assert.match(html, /<b>3\.0<\/b> from 2 ratings/);
  assert.match(html, /<b>5\.0<\/b> from 1 rating</);
  // A map that waits: no place, no score, no bar; its row asks for a rating.
  const waiting = html.slice(html.indexOf('<li class="rk-map" data-port-id="canciv"'), html.indexOf('<li class="rk-map" data-port-id="jpciv"'));
  assert.match(waiting, /data-select="CA" data-map="canciv" title="canciv: open its card to rate it">/);
  assert.match(waiting, /<span class="rk-rank is-none" title="Not ranked">–<\/span>/);
  assert.match(waiting, /<div class="rk-by"><a class="by"/);
  assert.doesNotMatch(waiting, /rk-val|rk-bar|rk-detail/);
  assert.match(html, /No ratings yet <span>2 · not ranked<\/span>/);
  assert.match(html, /<b>5<\/b> maps are ranked on <b>45<\/b> ratings\. <b>2<\/b> more have no rating yet: they follow, unranked, a different one first each day\. Open a map's card to rate it\./);
  assert.match(html, /<b>Not listed:<\/b> 2 maps that are source code only\.\s+A map can be rated once it can be opened\./);
  assert.match(html, /<a href="https:\/\/example\.org\/RATINGS\.md" target="_blank" rel="noopener noreferrer">How ratings are kept<\/a>/);
  // No measure to switch to, no second figure to show, and nothing of the World Bank's.
  assert.doesNotMatch(html, /rk-seg|rk-details|World Bank|undefined|null|NaN/);
  assert.doesNotMatch(html, /Civilization<\/span>/); // the other tabs' column: these rows are maps
});

test("the tab: a map nobody is named for has no maker's line, and one without a country opens itself", () => {
  const ports = [live("lone", ["ZZ"], { author: null }), live("nowhere", [])];
  const html = rankingsHtml(rated({ lone: [1, 5], nowhere: [2, 8] }, ports), ctx({ home: (p) => (p.countries.length ? p.countries[0] : null) }));
  const lone = html.slice(html.indexOf('data-port-id="lone"'), html.indexOf('data-port-id="nowhere"'));
  assert.doesNotMatch(lone, /rk-by/);
  assert.match(html, /<li class="rk-map" data-port-id="nowhere">\s*<button type="button" class="rk-row" data-open-port="nowhere" data-map="nowhere" title="Open nowhere">/);
  assert.doesNotMatch(html, /data-select=""|data-hover=""/);
});

test("the tab: where ratings can no longer be given it does not ask for them", () => {
  const html = rankingsHtml(rated(), ctx({ canRate: false, ratingsUrl: "javascript:alert(1)" }));
  assert.doesNotMatch(html, /to rate it|with its stars|Be the first/);
  assert.match(html, /title="europe: open its card"/);
  assert.doesNotMatch(html, /javascript:/); // only a web address is linked
  assert.match(html, /<b>5<\/b> maps are ranked on <b>45<\/b> ratings\./);
});

test("the tab: before anyone has rated a map, every map that can be rated waits", () => {
  const html = rankingsHtml(rated({}), ctx());
  assert.match(html, /Nobody has rated a map yet, so none is ranked\. <b>7<\/b> maps can be rated: they follow, a different one first each day\./);
  assert.match(html, /<p class="rk-none">No map is ranked yet\. Be the first to rate one\.<\/p>/);
  assert.match(html, /No ratings yet <span>7 · not ranked<\/span>/);
  assert.deepEqual(rowIds(html), ["ca", "canciv", "frciv", "bretagne", "jpciv", "plciv", "europe"]);
  assert.doesNotMatch(html, /rk-bar|rk-val/);
  // One map in all: the words agree.
  const one = rankingsHtml(rated({}, PORTS.slice(0, 1)), ctx());
  assert.match(one, /<b>1<\/b> map can be rated: it follows\./);
  assert.doesNotMatch(one, /Not listed/);
  assert.match(rankingsHtml(rated({ ca: [1, 4] }, PORTS.slice(0, 2)), ctx()), /<b>1<\/b> map is ranked on <b>1<\/b> rating\. <b>1<\/b> more has no rating yet: it follows, unranked\./);
  assert.match(rankingsHtml(rated({}, [PORTS[0], PORTS[7]]), ctx()), /<b>Not listed:<\/b> 1 map that is source code only\./);
});

test("the tab: the maps of the visitor's own country are marked, and the best placed can be shown", () => {
  let html = rankingsHtml(rated(), ctx({ mine: "CA" }));
  assert.match(html, /<span class="rk-mine-at">Top map <b>5th<\/b> of 5<\/span><button type="button" class="rk-find" data-act="rankings-find">Show<\/button>/);
  assert.deepEqual([...html.matchAll(/<li class="rk-map is-me" data-port-id="([^"]+)"/g)].map((x) => x[1]), ["ca", "canciv"]);
  html = rankingsHtml(rated(), ctx({ mine: "PL" }));
  assert.match(html, /Top map <b>1st<\/b> of 5</); // the map of several countries
  assert.deepEqual([...html.matchAll(/<li class="rk-map is-me" data-port-id="([^"]+)"/g)].map((x) => x[1]), ["europe", "plciv"]);
  html = rankingsHtml(rated({ plciv: [1, 5], frciv: [1, 5] }), ctx({ mine: "PL" }));
  assert.match(html, /Top map <b>1st<\/b> of 2 \(tied\)</);
  html = rankingsHtml(rated(), ctx({ mine: "JP" }));
  assert.match(html, /<span class="rk-mine-at">No ratings yet<\/span><button type="button" class="rk-find"/); // its row can be shown
  assert.match(html, /<li class="rk-map is-me" data-port-id="jpciv"/);
  html = rankingsHtml(rated(), ctx({ mine: "ZZ" }));
  assert.match(html, /<span class="rk-mine-at">No map to rate<\/span>\s*<\/div>/);
  assert.doesNotMatch(html, /data-act="rankings-find"|is-me" data-port-id/);
  // No "You" on a map: the word is for the visitor's country in the other tabs.
  assert.doesNotMatch(rankingsHtml(rated(), ctx({ mine: "CA" })), /rk-you/);
  assert.match(rankingsHtml(rated(), ctx({ tab: "net", mine: "CA" })), /<span class="rk-you">You<\/span>/);
});

test("names are escaped", () => {
  const ports = [live("evil", ["XX"], { name: "<b>Evil</b>", author: '"Worse" & co' }), live("fine", ["YY"])];
  const more = { nameOf: (iso) => (iso === "XX" ? "<u>X</u>" : iso), countries: [{ id: "XX", name: "<u>X</u>" }] };
  const doc = rated({ evil: [1, 5] }, ports);
  let html = rankingsHtml(doc, ctx(more));
  assert.match(html, /<span class="rk-name">&lt;b&gt;Evil&lt;\/b&gt;<\/span>/);
  assert.match(html, /title="&lt;b&gt;Evil&lt;\/b&gt;: open its card, with its stars"/);
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  html = rankingsHtml(doc, ctx({ ...more, tab: OVERALL, mine: "XX" }));
  assert.match(html, /<b>&lt;b&gt;Evil&lt;\/b&gt;<\/b> by &quot;Worse&quot; &amp; co leading/);
  assert.match(html, /The best-placed map of &lt;u&gt;X&lt;\/u&gt; is 1st of 1/);
  assert.match(html, /title="1st: &lt;b&gt;Evil&lt;\/b&gt;"/);
  assert.doesNotMatch(html.slice(html.indexOf('class="rk-card" data-rank-tab="rating"')), /<b>Evil<\/b>|"Worse"/);
  const line = mapStandingHtml(doc, "evil");
  assert.match(line, /title="&lt;b&gt;Evil&lt;\/b&gt;: 1st of 1 among the maps/);
  assert.doesNotMatch(line, /<b>Evil<\/b>/);
});

test("a rated map's card says where the map stands", () => {
  const doc = rated();
  let html = mapStandingHtml(doc, "ca");
  assert.match(html, /^<button type="button" class="rk-standing" data-rank-tab="rating" data-rank-map="ca"/);
  assert.match(html, /<b>5th of 5<\/b> in World Rankings <span class="wv-nowrap">· score 3\.00<\/span>/);
  assert.match(html, /title="Canada: 5th of 5 among the maps in World Rankings, with a visitors&#39; score of 3\.00\. Open the Ratings tab\."/);
  html = mapStandingHtml(doc, "bretagne");
  assert.match(html, /<b>2nd of 5 \(tied\)<\/b>/);
  assert.match(mapStandingHtml(doc, "europe"), /<b>1st of 5<\/b>.*score 4\.86/);
  assert.equal(mapStandingHtml(doc, "jpciv"), ""); // no rating yet: its stars say so
  assert.equal(mapStandingHtml(doc, "deciv"), ""); // source code
  assert.equal(mapStandingHtml(doc, "mine"), ""); // a visitor's own link
  assert.equal(mapStandingHtml(doc, "nowhere"), "");
  assert.equal(mapStandingHtml(SMALL, "ca"), ""); // no Ratings tab here
  assert.equal(mapStandingHtml(null, "ca"), "");
});

test("Demographics stays the World Bank's table", () => {
  // The visitors' score is of maps, not of countries: with the tab or without it, the table has the World Bank's measures.
  const opts = { nameOf, flag: (iso) => `[${iso}]` };
  const plain = demographicsHtml(SMALL, "FR", opts);
  const withTab = demographicsHtml(rated(), "FR", opts);
  assert.equal(withTab, plain);
  assert.equal((plain.match(/<tr>/g) || []).length, 1 + SMALL.measures.length);
  assert.doesNotMatch(withTab, /Visitors|null|undefined/);
  assert.match(demographicsHtml(rated(), "PL", opts), /The World Bank publishes no figures for Poland\./);
});

test("the catalog: every map that can be rated is listed once, with a country whose card it can open", () => {
  const onMap = new Set(OUTLINES.map((c) => c.id));
  const can = CATALOG.filter(rateable);
  assert.ok(can.length >= 30, `${can.length} maps can be rated`);
  const everyone = tallyRatings(CATALOG, () => ({ n: 4, sum: 18 }), { day: 123 });
  assert.equal(everyone.rows.length, can.length);
  assert.equal(everyone.waiting.length, 0);
  assert.equal(everyone.unlisted, CATALOG.length - can.length);
  assert.equal(everyone.n, 4 * can.length);
  assert.equal(new Set(ids(everyone.rows)).size, can.length);
  for (const x of everyone.rows) {
    assert.deepEqual([x.average, x.score, x.rank, x.tied], [4.5, 3.86, 1, can.length > 1], x.port.id);
    assert.ok(x.port.countries.some((iso) => onMap.has(iso)), `${x.port.id} has no country on the world map`);
    assert.ok(typeof x.port.author === "string" && x.port.author.trim(), `${x.port.id} names no maker`);
  }
  for (const p of CATALOG) if (p.status === "repo") assert.equal(placeOf(everyone, p.id), null, `${p.id} is source code`);
  const nobody = tallyRatings(CATALOG, () => null, { day: 123 });
  assert.deepEqual([nobody.rows.length, nobody.waiting.length, nobody.n], [0, can.length, 0]);
  assert.deepEqual(ids(nobody.waiting), ids(everyone.rows)); // all tied, all as often rated: the same turns
  // With the real figures: the tab comes last, and the file's own measures and countries are untouched.
  const doc = withRatings(DOC, everyone);
  assert.equal(doc.groups.at(-1).key, RATINGS);
  assert.equal(doc.measures.length, DOC.measures.length + 1);
  assert.equal(doc.countries, DOC.countries);
  assert.equal(JSON.stringify(DOC).includes('"rating"'), false); // the file itself has no such measure
  const html = rankingsHtml(doc, ctx({ nameOf: (iso) => iso, countries: OUTLINES.map((c) => ({ id: c.id, name: c.name })) }));
  assert.equal(rowIds(html).length, can.length);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("a rating given on the page moves its map at once", async () => {
  // The page's ratings (ratings.js) against a pretend server that counts one rating per map from this visitor.
  const totals = { frciv: [1, 5], ca: [2, 6] };
  let mine = 0;
  const fetchFn = async (url, init = {}) => {
    if (init.method !== "POST") return { ok: true, status: 200, json: async () => ({ version: 1, open: true, scale: 5, ratings: totals }) };
    const { port, stars } = JSON.parse(init.body);
    const [n, sum] = totals[port] || [0, 0];
    totals[port] = [n + (stars ? 1 : 0) - (mine ? 1 : 0), sum + stars - mine];
    mine = stars;
    return { ok: true, status: 200, json: async () => ({ ok: true, port, stars, changed: true, rating: totals[port] }) };
  };
  const ratings = createRatings({ url: "https://earthciv.test/data/ratings.json", storage: null, fetchFn, framed: () => false });
  assert.equal(ratings.loaded, false);
  await ratings.load();
  assert.equal(ratings.loaded, true);
  const now = () => tallyRatings(PORTS, (id) => ratings.of(id));
  assert.deepEqual(ids(now().rows), ["frciv", "ca"]);
  assert.equal(placeOf(now(), "canciv"), null);

  const sent = ratings.choose("canciv", 5); // a map nobody had rated
  assert.deepEqual([placeOf(now(), "canciv").score, placeOf(now(), "canciv").rank, placeOf(now(), "canciv").tied], [3.5, 1, true]); // before the server answers
  assert.equal(placeOf(now(), "ca").rank, 3);
  await sent;
  assert.deepEqual(ids(now().rows), ["canciv", "frciv", "ca"]); // as high and as often rated as France's: the catalog's turn
  assert.match(mapStandingHtml(withRatings(SMALL, now()), "canciv"), /<b>1st of 3 \(tied\)<\/b>/);
  await ratings.choose("canciv", 5); // the same star takes the rating back
  assert.equal(placeOf(now(), "canciv"), null);
  assert.deepEqual(ids(now().waiting).includes("canciv"), true);
  await ratings.choose("ca", 5); // a third rating of the edition: (9 + 11) / 6
  assert.deepEqual([placeOf(now(), "ca").n, placeOf(now(), "ca").score, placeOf(now(), "ca").rank], [3, 3.33, 2]);
});

test("where the ratings could not be read, nothing is known and there is no tab", async () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const offline = createRatings({ url: "https://earthciv.test/data/ratings.json", storage: null, fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
    await offline.load();
    assert.equal(offline.loaded, false);
  } finally {
    console.warn = quiet;
  }
  // A host without the Function answers with the static file: read, not open, and no ratings.
  const plain = createRatings({ url: "https://earthciv.test/data/ratings.json", storage: null, fetchFn: async () => ({ ok: true, status: 200, json: async () => json("web/data/ratings.json") }) });
  await plain.load();
  assert.deepEqual([plain.loaded, plain.open, tallyRatings(CATALOG, (id) => plain.of(id)).n], [true, false, 0]);
});
