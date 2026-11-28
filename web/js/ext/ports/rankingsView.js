// World Rankings on the world map: the screen that compares every country, after the World Rankings of a turn-based
// strategy game. It takes the place of the country list in the panel beside the map (./index.js opens and closes it).
//
//   * A banner, a strip of tabs (Overall, then one per group of measures, each under its advisor's medallion) and the
//     visitor's own country ("your civilization"), chosen once and kept in their browser.
//   * Overall: one card per tab on its first measure: who leads, where the visitor's country stands, and the first
//     flags in order.
//   * A tab: the advisor's note on the measure, every country ranked on the measure's year, then the countries whose
//     figure is from another year (with that year, never ranked), then the places with no figure at all.
//   * The Ratings tab, where the maps' star ratings are kept (./rankingsRatings.js): not the countries but the maps
//     themselves, in order of their visitors' score, each with the ratings behind it and its maker; then the maps
//     nobody has rated yet, unranked. A rated map's card says where the map stands (mapStandingHtml).
//   * Demographics, on a country's card: where it stands on every measure, beside the highest, the average and the
//     lowest, after a strategy game's demographics screen (demographicsHtml).
//   * The map as a lens while a tab is open: each ranked country in the tab's colours (lensFills), with its key
//     (lensLegendHtml) and a line for the hover tip (lensTip).
//
// This module only writes HTML: the data rules are ./rankings.js, and ./index.js wires the clicks. A row is a button
// with data-select (its country's card opens) and data-hover (the map outlines the country). A map's row also names
// its map (data-map): the card opens with that map first.

import { esc } from "../../app/escape.js";
import { emblem } from "../advisors/core/emblems.js";
import { ROSTER } from "../advisors/core/roster.js";
import { NO_DATA, OVERALL, RAMPS, cellOf, formatValue, groupOf, lensScale, listWords, measureOf, ordinal, rampColor, rankOf, ranking, standing, summary, tabOf } from "./rankings.js";
import { RATING, RATINGS, formatScore, mapsOf, placeOf } from "./rankingsRatings.js";

/** The medallion of the Overall tab and of the screen itself. */
export const RANKINGS_ADVISOR = { id: "rankings", name: "World Rankings", role: "Every tab at once", color: "#c9a45c", dark: "#3a2f15" };
/** The Ratings tab's: it speaks for the visitors, as the other tabs' advisors speak for their figures. */
export const RATINGS_ADVISOR = { id: RATINGS, name: "Ratings", role: "Tribune of the People", color: "#a784e0", dark: "#22143f" };
const ADVISOR = new Map([...ROSTER, RATINGS_ADVISOR].map((a) => [a.id, a]));
const advisorOf = (key) => ADVISOR.get(key) || RANKINGS_ADVISOR;
const SHOWN = 7; // flags on an Overall card (one line in the panel)
const NAMED = 3; // how many maps that share the lead the Ratings tab's card names before it counts them
const CHEVRON = `<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const advStyle = (adv) => `--adv:${adv.color};--adv-dark:${adv.dark}`;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The whole screen. `ctx`: {tab, mine, details, about, failed, nameOf(iso), flag(iso) → HTML, countries: [{id, name}]}.
 * For the Ratings tab, whose rows are maps (the catalog's entries), also: {canRate: whether ratings can be given here,
 * ratingsUrl: where they are explained, icon(map) → HTML of its emblem, makerName(map) → who made it, maker(map) →
 * HTML of that maker's picture, name and links, home(map) → the country whose card the map's row opens}.
 */
export function rankingsHtml(doc, ctx) {
  const head = `<div class="rk-banner">
      <h2 class="rk-title" id="wv-rankings-title" tabindex="-1">World Rankings</h2>
      <button type="button" class="rk-close" data-act="rankings-close" aria-label="Close World Rankings" title="Back to every country (Esc)">✕</button>
    </div>`;
  if (!doc) {
    const body = ctx.failed
      ? `<div class="wv-pad"><p><b>The rankings could not load.</b></p>
          <p><button type="button" class="ports-btn" data-act="rankings-retry">Try again</button></p></div>`
      : `<div class="wv-pad muted">Gathering the figures…</div>`;
    return `<div class="rk">${head}${body}</div>`;
  }
  const tab = tabOf(doc, ctx.tab);
  const body = tab === OVERALL ? overallHtml(doc, ctx) : measureOf(doc, tab).live ? ratingsHtml(doc, tab, ctx) : measureHtml(doc, tab, ctx);
  return `<div class="rk" data-tab="${esc(tab)}">${head}${tabsHtml(doc, tab)}${mineHtml(doc, tab, ctx)}${body}</div>`;
}

function tabsHtml(doc, tab) {
  const current = tab === OVERALL ? OVERALL : groupOf(doc, tab)?.key;
  const tabs = [{ key: OVERALL, label: "Overall", target: OVERALL, adv: RANKINGS_ADVISOR }]
    .concat(doc.groups.map((g) => ({ key: g.key, label: g.label, target: g.lead, adv: advisorOf(g.key) })));
  return `<div class="rk-tabs" role="group" aria-label="Tabs">${tabs.map((t) => `
    <button type="button" class="rk-tab" data-rank-tab="${esc(t.target)}" aria-pressed="${t.key === current}" style="${advStyle(t.adv)}"
      title="${esc(t.key === OVERALL ? "Overall: every tab at once" : `${t.label}: ${t.adv.role}`)}">${emblem(t.adv, 34)}<span class="rk-tab-lbl">${esc(t.label)}</span></button>`).join("")}
  </div>`;
}

// The visitor's own country: a menu of every place on the map, and on a tab where it stands.
function mineHtml(doc, tab, { mine, countries, nameOf, flag }) {
  const options = countries.map((c) => `<option value="${esc(c.id)}"${c.id === mine ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  let at = "";
  if (tab !== OVERALL && mine && measureOf(doc, tab).live) {
    // The Ratings tab lists maps: here, where the best placed of the country's maps stands.
    const best = mapsOf(doc.tally, mine)[0];
    const where = !best ? "No map to rate" : best.rank == null ? "No ratings yet"
      : `Top map <b>${ordinal(best.rank)}</b> of ${doc.tally.rows.length}${best.tied ? " (tied)" : ""}`;
    at = `<span class="rk-mine-at">${where}</span>${best ? `<button type="button" class="rk-find" data-act="rankings-find">Show</button>` : ""}`;
  } else if (tab !== OVERALL && mine) {
    const m = measureOf(doc, tab);
    const cell = cellOf(doc, tab, mine);
    const r = cell?.ranked ? rankOf(doc, tab, mine) : null;
    const where = r ? `<b>${ordinal(r.rank)}</b> of ${r.of}${r.tied ? " (tied)" : ""}`
      : cell ? `Not ranked: no ${m.year} figure` : "No figure";
    at = `<span class="rk-mine-at">${where}</span>${cell ? `<button type="button" class="rk-find" data-act="rankings-find">Show</button>` : ""}`;
  }
  return `<div class="rk-mine">
      <span class="rk-em rk-em-me" aria-hidden="true">${mine ? flag(mine) : "?"}</span>
      <label class="rk-mine-pick"><span class="rk-mine-k">Your civilization</span>
        <select class="rk-mine-select" aria-label="Your civilization: your own country"><option value="">${mine ? "None" : "Pick your country…"}</option>${options}</select></label>
      ${at}
    </div>`;
}

// --- Overall -------------------------------------------------------------------------------------------------------------
function overallHtml(doc, ctx) {
  const isRatings = (g) => !!measureOf(doc, g.lead)?.live;
  const rated = doc.groups.some(isRatings);
  const lede = rated
    ? "Where every country stands on the World Bank's newest figures, and how this site's visitors rate the maps. Each card is one tab's first measure; open it for the whole list in order."
    : `Where every country stands on the World Bank's newest figures. Each card is one tab's first
      measure; open it for every country in order.`;
  return `<p class="rk-lede">${lede}</p>
    <ul class="rk-cards">${doc.groups.map((g) => (isRatings(g) ? ratingsCardHtml(doc, g, ctx) : cardHtml(doc, g, ctx))).join("")}</ul>
    ${sourceHtml(doc, null, rated ? " Ratings: this site's visitors." : "")}`;
}

function cardHtml(doc, g, { mine, nameOf, flag }) {
  const m = measureOf(doc, g.lead);
  const r = ranking(doc, g.lead, nameOf);
  const adv = advisorOf(g.key);
  const leaders = r.rows.filter((x) => x.rank === 1);
  const me = mine ? r.rows.find((x) => x.iso === mine) : null;
  const leaderNames = leaders.map((x) => nameOf(x.iso));
  let lead;
  if (me?.rank === 1) lead = leaders.length > 1 ? "<b>You</b> share the lead" : "<b>You</b> are leading";
  else if (leaders.length > 1) lead = `<b>${esc(listWords(leaderNames))}</b> share the lead`;
  else lead = `<b>${esc(leaderNames[0] || "Nobody")}</b> leading`;
  let sub;
  const cell = mine ? cellOf(doc, g.lead, mine) : null;
  if (me?.rank === 1) {
    const next = r.rows.find((x) => x.rank > 1);
    sub = next ? `${esc(nameOf(next.iso))} is ${ordinal(next.rank)} of ${r.rows.length}` : `First of ${r.rows.length}`;
  } else if (me) sub = `You are in ${ordinal(me.rank)} place of ${r.rows.length}${me.tied ? " (tied)" : ""}`;
  else if (cell) sub = `${esc(nameOf(mine))} has no ${m.year} figure, so it is not ranked`;
  else if (mine) sub = `The World Bank has no figure for ${esc(nameOf(mine))}`;
  else sub = `${r.rows.length} countries and territories ranked`;

  const at = me ? r.rows.indexOf(me) : -1;
  const chip = (x, i) => `<span class="rk-em${i === 0 ? " is-lead" : ""}${x.iso === mine ? " is-me" : ""}" title="${esc(`${ordinal(x.rank)}: ${nameOf(x.iso)}`)}">${flag(x.iso)}</span>`;
  let flags;
  if (at >= SHOWN) {
    flags = r.rows.slice(0, SHOWN - 1).map(chip).join("") + `<span class="rk-more">… ${ordinal(me.rank)}</span>${chip(me, at)}`;
  } else {
    const shown = r.rows.slice(0, SHOWN);
    flags = shown.map(chip).join("") + (r.rows.length > shown.length ? `<span class="rk-more">+${r.rows.length - shown.length}</span>` : "");
  }
  const label = `${g.label}, ${m.label} ${m.year}: ${strip(lead)}. ${strip(sub)}. Open the ${g.label} tab.`;
  return `<li><button type="button" class="rk-card" data-rank-tab="${esc(g.lead)}" style="${advStyle(adv)}" aria-label="${esc(label)}">
      <span class="rk-banner-flag" aria-hidden="true">${emblem(adv, 30)}</span>
      <span class="rk-card-body" aria-hidden="true">
        <span class="rk-card-title">${esc(g.label)} <small>${esc(m.label)} · ${m.year}</small></span>
        <span class="rk-card-lead">${lead}</span>
        <span class="rk-card-sub">${sub}</span>
        <span class="rk-flags">${flags}</span>
      </span>
    </button></li>`;
}

const strip = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// --- a tab -----------------------------------------------------------------------------------------------------------
function measureHtml(doc, key, ctx) {
  const { mine, details, about, nameOf, flag, countries } = ctx;
  const g = groupOf(doc, key);
  const m = measureOf(doc, key);
  const adv = advisorOf(g.key);
  const r = ranking(doc, key, nameOf);
  const top = r.rows[0]?.value;
  const other = measureOf(doc, g.measures.find((k) => k !== key));
  const nOther = r.others.length;
  const note = `${esc(m.about)} ${nOther
    ? `<b>${r.rows.length}</b> countries and territories have a ${m.year} figure and are ranked on it. <b>${nOther}</b> have a figure from another year only: they follow, with its year, and are not ranked.`
    : `All <b>${r.rows.length}</b> countries and territories with a figure have one for ${m.year}.`}`;
  const seg = g.measures.length > 1
    ? `<div class="rk-seg" role="group" aria-label="${esc(g.label)}: which measure">${g.measures.map((k) => `<button type="button" data-rank-tab="${esc(k)}" aria-pressed="${k === key}">${esc(measureOf(doc, k).label)}</button>`).join("")}</div>`
    : "<span></span>";
  const check = other
    ? `<label class="rk-check" title="${esc(`Show each country's ${other.label.toLowerCase()} too`)}"><input type="checkbox" class="rk-details"${details ? " checked" : ""}><span>Show details</span></label>`
    : "";
  const row = (x) => rowHtml(doc, x, { m, other, details, top, mine, nameOf, flag });
  const listed = new Set([...r.rows, ...r.others].map((x) => x.iso));
  const missing = countries.filter((c) => !listed.has(c.id)).map((c) => c.name);
  return `<section class="rk-body" style="${advStyle(adv)}" aria-label="${esc(`${g.label}: ${m.label}`)}">
      ${advisorHtml(adv, g, about, note)}
      <div class="rk-tools">${seg}${check}</div>
      <div class="rk-cols" aria-hidden="true"><span>Civilization</span><span title="Each bar is the figure as a share of the highest">${esc(m.label)} · ${m.year}</span></div>
      <ul class="rk-rows">${r.rows.map(row).join("")}</ul>
      ${nOther ? `<h4 class="wv-group rk-group">No ${m.year} figure <span>${nOther} · not ranked</span></h4>
        <ul class="rk-rows rk-others">${r.others.map(row).join("")}</ul>` : ""}
      ${missing.length ? `<p class="rk-missing"><b>No figure since ${esc(doc.first_year ?? "")}:</b> ${esc(missing.join(", "))}.</p>` : ""}
      ${sourceHtml(doc, m)}
    </section>`;
}

// The top of a tab: its advisor, the tab's name and the advisor's note, which folds away.
function advisorHtml(adv, g, about, note) {
  return `<div class="rk-adv">
        ${emblem(adv, 52)}
        <div class="rk-adv-text"><small>${esc(adv.role)}</small><h3>${esc(g.label)}</h3></div>
        <button type="button" class="rk-fold" data-act="rankings-about" aria-expanded="${about}" aria-controls="rk-about"
          title="${about ? "Hide" : "Show"} the ${esc(adv.role.toLowerCase())}'s note">${CHEVRON}</button>
      </div>
      <p class="rk-bubble" id="rk-about"${about ? "" : " hidden"}>${note}</p>`;
}

function rowHtml(doc, x, { m, other, details, top, mine, nameOf, flag }) {
  const me = x.iso === mine;
  const ranked = x.rank != null;
  const name = nameOf(x.iso);
  // The bar: the figure as a share of the highest, as in the editions' leaderboards (ranked rows only).
  const t = ranked && top > 0 ? Math.max(0, Math.min(1, x.value / top)) : null;
  let more = "";
  if (details && other) {
    const c = cellOf(doc, other.key, x.iso);
    const at = c?.ranked ? rankOf(doc, other.key, x.iso) : null;
    more = `<span class="rk-detail">${esc(other.label)} ${c ? `${c.year}: <b>${esc(formatValue(other, c.value))}</b>${at ? ` · ${ordinal(at.rank)}` : " · not ranked"}` : ": no figure"}</span>`;
  }
  const rank = ranked ? `<span class="rk-rank${x.rank <= 3 ? " is-top" : ""}"${x.tied ? ` title="Tied for ${ordinal(x.rank)}"` : ""}>${x.rank}</span>`
    : `<span class="rk-rank is-none" title="Not ranked">–</span>`;
  return `<li><button type="button" class="rk-row${me ? " is-me" : ""}" data-select="${esc(x.iso)}" data-hover="${esc(x.iso)}" title="${esc(`${name}: open its card`)}">
      ${rank}<span class="rk-em" aria-hidden="true">${flag(x.iso)}</span>
      <span class="rk-name">${esc(name)}</span>${me ? `<span class="rk-you">You</span>` : ""}
      <span class="rk-val">${esc(formatValue(m, x.value))}${ranked ? "" : `<small>${x.year}</small>`}</span>
      ${t == null ? "" : `<i class="rk-bar" style="--t:${t.toFixed(3)}" aria-hidden="true"></i>`}${more}
    </button></li>`;
}

// `after` follows the World Bank's line: on Overall, where the Ratings tab's card is from.
function sourceHtml(doc, m, after = "") {
  const src = doc.source || {};
  const wdi = /^https:\/\//.test(src.url || "") ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title || "World Development Indicators")}</a>` : esc(src.title || "");
  const what = m && /^[A-Z0-9.]+$/i.test(m.indicator || "")
    ? `<a href="https://data.worldbank.org/indicator/${esc(m.indicator)}" target="_blank" rel="noopener noreferrer">${esc(m.label)}</a>, from ${esc(m.origin)}. `
    : "";
  return `<p class="wv-src rk-src">${what}${esc(src.publisher || "World Bank")}, ${wdi}${src.license ? ` (${esc(src.license)})` : ""}${src.updated ? `, <span class="wv-nowrap">updated ${esc(src.updated)}</span>` : ""}.${after}</p>`;
}

// --- the Ratings tab: the maps, by what visitors think of them -----------------------------------------------------------
// Its card on Overall: the map that leads and who made it, how many maps are ranked, and the first maps' emblems in
// order. With a country picked as the visitor's own, where the best placed of that country's maps stands.
function ratingsCardHtml(doc, g, { mine, nameOf, icon, makerName }) {
  const m = measureOf(doc, g.lead);
  const adv = advisorOf(g.key);
  const { rows, waiting, n } = doc.tally;
  const leaders = rows.filter((x) => x.rank === 1);
  let lead;
  if (!rows.length) lead = "<b>No ratings yet</b>";
  else if (leaders.length > NAMED) lead = `<b>${leaders.length} maps</b> share the lead`;
  else if (leaders.length > 1) lead = `<b>${esc(listWords(leaders.map((x) => x.port.name)))}</b> share the lead`;
  else {
    const by = makerName(leaders[0].port);
    lead = `<b>${esc(leaders[0].port.name)}</b>${by ? ` by ${esc(by)}` : ""} leading`;
  }
  const own = mine ? mapsOf(doc.tally, mine) : [];
  let sub;
  if (own[0]?.rank != null) sub = `The best-placed map of ${esc(nameOf(mine))} is ${ordinal(own[0].rank)} of ${rows.length}${own[0].tied ? " (tied)" : ""}`;
  else if (own.length) sub = `Nobody has rated a map of ${esc(nameOf(mine))} yet`;
  else if (mine) sub = `No map of ${esc(nameOf(mine))} can be rated yet`;
  else if (rows.length) sub = `${plural(rows.length, "map")} ranked on ${plural(n, "rating")}`;
  else sub = waiting.length ? "Rate a map to put it on the board" : "No map can be rated yet";

  const covers = (x) => !!mine && (x.port.countries || []).includes(mine);
  const shown = rows.slice(0, SHOWN);
  const chips = shown.map((x) => `<span class="rk-em${leaders.length === 1 && x.rank === 1 ? " is-lead" : ""}${covers(x) ? " is-me" : ""}" title="${esc(`${ordinal(x.rank)}: ${x.port.name}`)}">${icon(x.port)}</span>`).join("")
    + (rows.length > shown.length ? `<span class="rk-more">+${rows.length - shown.length}</span>` : "");
  const label = `${g.label}, ${m.label} now: ${strip(lead)}. ${strip(sub)}. Open the ${g.label} tab.`;
  return `<li><button type="button" class="rk-card" data-rank-tab="${esc(g.lead)}" style="${advStyle(adv)}" aria-label="${esc(label)}">
      <span class="rk-banner-flag" aria-hidden="true">${emblem(adv, 30)}</span>
      <span class="rk-card-body" aria-hidden="true">
        <span class="rk-card-title">${esc(g.label)} <small>${esc(m.label)} · now</small></span>
        <span class="rk-card-lead">${lead}</span>
        <span class="rk-card-sub">${sub}</span>
        ${chips ? `<span class="rk-flags">${chips}</span>` : ""}
      </span>
    </button></li>`;
}

// The tab itself. Every rated map in order of its visitors' score; then the maps nobody has rated yet, unranked;
// then how many maps cannot be rated at all (./rankingsRatings.js has the rules).
function ratingsHtml(doc, key, ctx) {
  const { about, canRate = false, ratingsUrl = null } = ctx;
  const g = groupOf(doc, key);
  const m = measureOf(doc, key);
  const adv = advisorOf(g.key);
  const { rows, waiting, n, unlisted } = doc.tally;
  const counted = rows.length
    ? `<b>${rows.length}</b> ${rows.length === 1 ? "map is" : "maps are"} ranked on <b>${n.toLocaleString("en-US")}</b> ${n === 1 ? "rating" : "ratings"}.`
    : "Nobody has rated a map yet, so none is ranked.";
  const turns = waiting.length > 1 ? ", a different one first each day" : "";
  const wait = !waiting.length ? ""
    : rows.length ? ` <b>${waiting.length}</b> more ${waiting.length === 1 ? "has no rating yet: it follows" : "have no rating yet: they follow"}, unranked${turns}.`
      : ` <b>${waiting.length}</b> ${waiting.length === 1 ? "map can be rated: it follows" : "maps can be rated: they follow"}${turns}.`;
  const note = `${esc(m.about)} ${counted}${wait}${canRate ? " Open a map's card to rate it." : ""}`;
  const row = (x) => mapRowHtml(x, m, ctx);
  const how = /^https:\/\//.test(ratingsUrl || "")
    ? ` <a href="${esc(ratingsUrl)}" target="_blank" rel="noopener noreferrer">How ratings are kept</a>.` : "";
  return `<section class="rk-body" style="${advStyle(adv)}" aria-label="${esc(`${g.label}: ${m.label}`)}">
      ${advisorHtml(adv, g, about, note)}
      <div class="rk-cols" aria-hidden="true"><span>Map and maker</span><span title="${esc(`Each bar is the score as a share of ${m.top}`)}">${esc(m.label)} · now</span></div>
      ${rows.length ? `<ul class="rk-rows">${rows.map(row).join("")}</ul>` : `<p class="rk-none">No map is ranked yet.${canRate ? " Be the first to rate one." : ""}</p>`}
      ${waiting.length ? `<h4 class="wv-group rk-group">No ratings yet <span>${waiting.length} · not ranked</span></h4>
        <ul class="rk-rows rk-others">${waiting.map(row).join("")}</ul>` : ""}
      ${unlisted > 0 ? `<p class="rk-missing"><b>Not listed:</b> ${unlisted === 1 ? "1 map that is" : `${unlisted} maps that are`} source code only.
        A map can be rated once it can be opened.</p>` : ""}
      <p class="wv-src rk-src">Star ratings by this site's visitors: anonymous, one for each map from each network.${how}</p>
    </section>`;
}

// A map's entry: a button that opens its card (its place, its emblem, its name, its score and the ratings behind
// it), then its maker, whose name and account are links of their own, then the score as a bar. The whole entry
// carries the map's id, so the world map shows where the map is while the pointer is over it.
function mapRowHtml(x, m, { mine, canRate = false, icon, maker, home }) {
  const p = x.port;
  const ranked = x.rank != null;
  const countries = p.countries || [];
  const me = !!mine && countries.includes(mine);
  const iso = home(p);
  // Its card is its country's; a map with no country on the world map opens itself.
  const opens = iso ? `data-select="${esc(iso)}" data-map="${esc(p.id)}"` : `data-open-port="${esc(p.id)}" data-map="${esc(p.id)}"`;
  const title = !iso ? `Open ${p.name}` : `${p.name}: open its card${!canRate ? "" : ranked ? ", with its stars" : " to rate it"}`;
  const rank = ranked ? `<span class="rk-rank${x.rank <= 3 ? " is-top" : ""}"${x.tied ? ` title="Tied for ${ordinal(x.rank)}"` : ""}>${x.rank}</span>`
    : `<span class="rk-rank is-none" title="Not ranked">–</span>`;
  const by = maker(p);
  return `<li class="rk-map${me ? " is-me" : ""}" data-port-id="${esc(p.id)}"${countries.length === 1 && iso ? ` data-hover="${esc(iso)}"` : ""}>
      <button type="button" class="rk-row" ${opens} title="${esc(title)}">
        ${rank}<span class="rk-em" aria-hidden="true">${icon(p)}</span>
        <span class="rk-name">${esc(p.name)}</span>
        ${ranked ? `<span class="rk-val">${formatScore(x.score)}</span><span class="rk-detail">${ratedHtml(x)}</span>` : ""}
      </button>
      ${by ? `<div class="rk-by">${by}</div>` : ""}
      ${ranked ? `<i class="rk-bar" style="--t:${Math.max(0, Math.min(1, x.score / m.top)).toFixed(3)}" aria-hidden="true"></i>` : ""}
    </li>`;
}

// The ratings behind a score: their plain average, as a map's card writes its own, and how many there are.
function ratedHtml(x) {
  return `<span class="wv-nowrap"><span class="rk-star" aria-hidden="true">★</span> <b>${x.average.toFixed(1)}</b> from ${plural(x.n, "rating")}</span>`;
}

/**
 * Where a rated map stands in the Ratings tab, for its card: its place and its score. It is a button that opens the
 * tab (data-rank-tab) with the map's row in view (data-rank-map). "" for a map without a rating, and where there is
 * no Ratings tab.
 */
export function mapStandingHtml(doc, id) {
  const m = measureOf(doc, RATING);
  const at = m?.live ? placeOf(doc.tally, id) : null;
  if (!at) return "";
  const adv = advisorOf(RATINGS);
  const place = `${ordinal(at.rank)} of ${at.of}${at.tied ? " (tied)" : ""}`;
  const score = formatScore(at.score);
  return `<button type="button" class="rk-standing" data-rank-tab="${RATING}" data-rank-map="${esc(id)}" style="${advStyle(adv)}"
      title="${esc(`${at.port.name}: ${place} among the maps in World Rankings, with a ${m.label.toLowerCase()} of ${score}. Open the Ratings tab.`)}">
      ${emblem(adv, 22)}
      <span class="rk-standing-text"><b>${place}</b> in World Rankings <span class="wv-nowrap">· score ${score}</span></span>
      <span class="wv-chev" aria-hidden="true">›</span>
    </button>`;
}

// --- Demographics, on a country's card ---------------------------------------------------------------------------------
// The unit under a measure's name in the table (its figures are written short there).
const UNIT = { usd: "US$", years: "years", pct: "% of people", km2: "km²", tonnes: "tonnes" };

/**
 * Where a country stands on every measure of the World Bank's: its rank and figure, and the highest, the average and
 * the lowest of the countries ranked on the same year. A figure from another year shows that year and no rank. A
 * measure's name opens its tab in World Rankings; a figure opens the World Bank's own chart of it for this country.
 * (The Ratings tab's measure is of maps, not of countries, so it has no row here.)
 */
export function demographicsHtml(doc, iso, { nameOf, flag }) {
  const name = nameOf(iso);
  const rows = standing(doc, iso).filter((r) => !r.measure.live);
  if (!rows.some((r) => r.cell)) return `<p class="wv-nofacts">The World Bank publishes no figures for ${esc(name)}.</p>`;
  return `<section class="dm" aria-labelledby="wv-dm-title">
      <h3 class="wv-group dm-head" id="wv-dm-title">Demographics <span>where ${esc(name)} stands</span></h3>
      <table class="dm-table">
        <thead><tr>
          <th scope="col">Demographic</th><th scope="col" class="dm-rank-h">Rank</th><th scope="col">Value</th>
          <th scope="col" title="The highest of the countries ranked on that year">Highest</th>
          <th scope="col" class="dm-avg" title="The average of the countries ranked on that year, each counted once">Average</th>
          <th scope="col" title="The lowest of the countries ranked on that year">Lowest</th>
        </tr></thead>
        <tbody>${rows.map((r) => demographicRowHtml(doc, iso, r, { name, nameOf, flag })).join("")}</tbody>
      </table>
      ${sourceHtml(doc, null)}
    </section>`;
}

function demographicRowHtml(doc, iso, r, { name, nameOf, flag }) {
  const m = r.measure;
  const s = summary(doc, m.key);
  const short = (v) => esc(formatValue(m, v, { short: true }));
  const unit = UNIT[m.format];
  let value = "–";
  if (r.cell) {
    const long = formatValue(m, r.cell.value);
    const chart = /^[A-Z0-9.]+$/i.test(m.indicator || "") && /^[A-Z]{2}$/.test(iso)
      ? `https://data.worldbank.org/indicator/${m.indicator}?locations=${iso}` : null;
    const text = chart
      ? `<a href="${esc(chart)}" target="_blank" rel="noopener noreferrer" title="${esc(`${name}: ${long} in ${r.cell.year}. The World Bank's chart`)}">${short(r.cell.value)}</a>`
      : `<span title="${esc(`${long} in ${r.cell.year}`)}">${short(r.cell.value)}</span>`;
    value = r.cell.ranked ? text : `${text}<small>${r.cell.year}</small>`;
  }
  const rank = r.rank != null
    ? `<td class="dm-rank"${r.tied ? ` title="Tied for ${ordinal(r.rank)}"` : ""}>${r.rank}</td>`
    : `<td class="dm-rank is-none" title="${esc(r.cell ? `Not ranked: no ${m.year} figure` : "No figure")}">–</td>`;
  const extreme = (e) => {
    const isos = [...e.isos].sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)))); // a tie, A–Z
    return `<span class="dm-flag" title="${esc(listWords(isos.map(nameOf)))}">${flag(isos[0])}${isos.length > 1 ? `<i>+${isos.length - 1}</i>` : ""}</span>${short(e.value)}`;
  };
  return `<tr>
      <th scope="row"><button type="button" class="dm-k" data-rank-tab="${esc(m.key)}" title="${esc(`${m.label}: every country, in World Rankings`)}">${esc(m.label)}</button><small>${m.year}${unit ? ` · ${esc(unit)}` : ""}</small></th>
      ${rank}<td class="dm-v">${value}</td>
      <td class="dm-x">${s ? extreme(s.highest) : "–"}</td>
      <td class="dm-avg">${s ? short(s.average) : "–"}</td>
      <td class="dm-x">${s ? extreme(s.lowest) : "–"}</td>
    </tr>`;
}

// --- the map as a lens --------------------------------------------------------------------------------------------------
/** The open tab's colour for every country ranked on it (Map iso → #rrggbb). Any other country is NO_DATA. */
export function lensFills(doc, key) {
  const scale = lensScale(doc, key);
  const stops = RAMPS[groupOf(doc, key)?.key] || RAMPS.economy;
  const fills = new Map();
  if (scale) for (const x of ranking(doc, key).rows) fills.set(x.iso, rampColor(stops, scale.t(x.value)));
  return fills;
}

/** The lens's key, where the map key is: the measure, its year and unit, the colours from low to high, no figure. */
export function lensLegendHtml(doc, key) {
  const m = measureOf(doc, key);
  const g = groupOf(doc, key);
  const scale = lensScale(doc, key);
  if (!m || !scale) return "";
  const adv = advisorOf(g.key);
  const stops = RAMPS[g.key] || RAMPS.economy;
  const ticks = scale.ticks.map((v, i) => `<span>${i === 0 ? "≤ " : i === scale.ticks.length - 1 ? "≥ " : ""}${esc(formatValue(m, v, { short: true }))}</span>`).join("");
  return `<div class="lg-rk" style="${advStyle(adv)}">
      <div class="lg-rk-head">${emblem(adv, 22)}<b>${esc(m.label)}</b><small>${m.year} · ${esc(m.unit)}${scale.log ? " · log scale" : ""}</small></div>
      <div class="lg-rk-ramp" style="background:linear-gradient(90deg,${stops.join(",")})"></div>
      <div class="lg-rk-ticks">${ticks}</div>
      <div class="lg-rk-nd"><i style="background:${NO_DATA}"></i>No ${m.year} figure, so not ranked</div>
    </div>`;
}

/** What the map's hover tip says of a country under the lens: {value, rank} as plain text. */
export function lensTip(doc, key, iso) {
  const m = measureOf(doc, key);
  const c = cellOf(doc, key, iso);
  if (!m) return null;
  if (!c) return { value: `${m.label}: no figure`, rank: "" };
  const at = c.ranked ? rankOf(doc, key, iso) : null;
  return {
    value: `${m.label} ${c.year}: ${formatValue(m, c.value)}`,
    rank: at ? `${ordinal(at.rank)} of ${at.of}${at.tied ? " (tied)" : ""}` : `Not ranked: no ${m.year} figure`,
  };
}
