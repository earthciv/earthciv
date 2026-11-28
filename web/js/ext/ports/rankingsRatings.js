// World Rankings' Ratings tab: the maps themselves, in order of what this site's visitors think of them, from the
// star ratings they give (./ratings.js). The other tabs rank the countries on the World Bank's figures
// (./rankings.js); this one ranks the maps, each beside its maker. The screen is ./rankingsView.js.
//
//   * Every map that can be rated is listed (an EarthCiv edition, or a community map with a site), whether it is of
//     one country, of a part of one, or of several.
//   * A map's score starts in the middle of the scale, at 3 of 5, and its ratings pull it from there: it is their
//     average, counted as if the map also had three ratings of 3 stars (scoreOf). One five-star rating makes 3.50,
//     ten make 4.54 and a hundred 4.94. So a map is ranked from its first rating, a single rating does not outrank
//     many, and a map's score depends on its own ratings alone.
//   * A score is rounded to two decimals, as it is written, before it is ranked: the scores a visitor reads as equal
//     share a place. A map's place is one more than the number of maps with a higher score.
//   * A map nobody has rated yet is listed after the ranked ones, unranked.
//   * Maps that share a place are listed with the most rated first. Where that settles nothing, and among the maps
//     without a rating, the maps take turns: the catalog's order, moved round by one place every day, as in the list
//     of makers (./makers.js). So no map comes first for its name, or for the day it was added.
//
// withRatings() adds the tab to the rankings file as one more group with one measure. The measure has no year
// ("live") and no country has a figure for it: what the tab lists is in the file's `tally`.
//
// Apart from ./ratings.js, which says what can be rated, this module imports nothing and never touches the page, so
// tests/js/rankingsRatings.test.mjs runs it in Node.

import { SCALE, rateable } from "./ratings.js";

/** The tab: a group of the rankings file, as "economy" is. */
export const RATINGS = "ratings";
/** Its one measure: the visitors' score. */
export const RATING = "rating";

/** Where every map's score starts: the middle of the scale. */
export const START = (1 + SCALE) / 2;
/** How many ratings of START a map's own ratings are counted with. */
export const START_RATINGS = 3;

const GROUP = { key: RATINGS, label: "Ratings", lead: RATING, measures: [RATING] };
const MEASURE = {
  key: RATING,
  label: "Visitors' score",
  unit: `out of ${SCALE}`,
  top: SCALE, // a full bar
  live: true,
  year: null,
  about: `What this site's visitors think of each map, from the stars they give it. A map starts in the middle of the scale, at ${START} of ${SCALE}, `
    + "and every rating moves it: the more ratings, the closer its score is to their average.",
};

/** True when a value of the address's #rankings= names this tab (it exists only where ratings are kept). */
export function namesRatings(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === RATINGS || v === RATING;
}

/** A map's score from `n` ratings whose stars add up to `sum`, to two decimals; null without a rating. */
export function scoreOf(n, sum) {
  if (!(n > 0)) return null;
  return Math.round(((START_RATINGS * START + sum) / (START_RATINGS + n)) * 100) / 100;
}

/** A score as the screen writes it: always with its two decimals ("4.50"). */
export function formatScore(score) {
  return Number.isFinite(score) ? score.toFixed(2) : "–";
}

/**
 * The maps in the tab's order, with the visitors' ratings behind each.
 * @param {object[]} ports  the catalog's maps (web/data/ports.json)
 * @param {(id: string) => {n: number, sum: number}} ratingOf  a map's number of ratings and the sum of their stars
 * @param {{day?: number}} [options]  day: the day the turns go by (./makers.js dayNumber())
 * @returns {{n: number, sum: number, rows: object[], waiting: object[], unlisted: number}} `rows`: the rated maps,
 *   best first, each {port, n, sum, average, score, rank, tied}; `waiting`: the maps that can be rated and have no
 *   rating, in the same shape (average, score and rank are null); `n` and `sum`: every rating counted and the sum of
 *   their stars; `unlisted`: how many of the catalog's maps cannot be rated
 */
export function tallyRatings(ports, ratingOf = () => null, { day = 0 } = {}) {
  const listed = (ports || []).filter(rateable);
  const count = listed.length || 1;
  const shift = (((Math.floor(Number(day)) || 0) % count) + count) % count;
  const all = listed.map((port, index) => {
    const r = ratingOf(port.id) || {};
    const n = Number.isFinite(r.n) && r.n > 0 ? Math.floor(r.n) : 0;
    // A sum that no n ratings of one to five stars could add up to is brought back within them.
    const sum = n ? Math.min(n * SCALE, Math.max(n, Number(r.sum) || 0)) : 0;
    return { port, n, sum, average: n ? sum / n : null, score: scoreOf(n, sum), rank: null, tied: false, turn: (index - shift + count) % count };
  });
  const byTurn = (a, b) => a.turn - b.turn;
  const rated = all.filter((x) => x.n).sort((a, b) => b.score - a.score || b.n - a.n || byTurn(a, b));
  const sharing = new Map(); // place → how many maps have it
  rated.forEach((x, i) => {
    x.rank = i > 0 && x.score === rated[i - 1].score ? rated[i - 1].rank : i + 1;
    sharing.set(x.rank, (sharing.get(x.rank) || 0) + 1);
  });
  for (const x of rated) x.tied = sharing.get(x.rank) > 1;
  const row = ({ turn, ...x }) => x;
  return {
    n: rated.reduce((t, x) => t + x.n, 0),
    sum: rated.reduce((t, x) => t + x.sum, 0),
    rows: rated.map(row),
    waiting: all.filter((x) => !x.n).sort(byTurn).map(row),
    unlisted: (ports || []).length - listed.length,
  };
}

/** A rated map's row with `of`, how many maps are ranked; null for a map without a rating, or one that is not listed. */
export function placeOf(tally, id) {
  const row = tally?.rows.find((x) => x.port.id === id);
  return row ? { ...row, of: tally.rows.length } : null;
}

/** The listed maps that cover a country, in the tab's order: its best placed first, those without a rating last. */
export function mapsOf(tally, iso) {
  if (!tally || !iso) return [];
  const covers = (x) => (x.port.countries || []).includes(iso);
  return [...tally.rows.filter(covers), ...tally.waiting.filter(covers)];
}

/** What a tally would be drawn from: equal for two tallies that draw the same. */
export function tallySignature(tally) {
  if (!tally) return "";
  return `${tally.rows.map((x) => `${x.port.id}:${x.n}:${x.sum}`).join("|")}/${tally.waiting.map((x) => x.port.id).join("|")}/${tally.unlisted}`;
}

/**
 * The rankings file with the Ratings tab: one more group, its measure, and the tally itself (`tally`). The file is
 * not changed: this returns a new one. Without a file or a tally, what was given comes back.
 */
export function withRatings(doc, tally) {
  if (!doc || !tally) return doc;
  return {
    ...doc,
    groups: [...(doc.groups || []).filter((g) => g.key !== RATINGS), GROUP],
    measures: [...(doc.measures || []).filter((m) => m.key !== RATING), MEASURE],
    tally,
  };
}
