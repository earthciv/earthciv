// World Rankings on the world map: the screen that compares every country, after the World Rankings of a turn-based
// strategy game. It takes the place of the country list in the panel beside the map (./index.js opens and closes it).
//
//   * A banner, a strip of tabs (Overall, then one per group of measures, each under its advisor's medallion) and the
//     visitor's own country ("your civilization"), chosen once and kept in their browser.
//   * Overall: one card per tab on its first measure: who leads, where the visitor's country stands, and the first
//     flags in order.
//   * A tab: the advisor's note on the measure, every country ranked on the measure's year, then the countries whose
//     figure is from another year (with that year, never ranked), then the places with no figure at all.
//
// This module only writes HTML: the data rules are ./rankings.js, and ./index.js wires the clicks. A row is a button
// with data-select (its country's card opens) and data-hover (the map outlines the country).

import { esc } from "../../app/escape.js";
import { emblem } from "../advisors/core/emblems.js";
import { ROSTER } from "../advisors/core/roster.js";
import { OVERALL, cellOf, formatValue, groupOf, listWords, measureOf, ordinal, rankOf, ranking, tabOf } from "./rankings.js";

/** The medallion of the Overall tab and of the screen itself. */
export const RANKINGS_ADVISOR = { id: "rankings", name: "World Rankings", role: "Every tab at once", color: "#c9a45c", dark: "#3a2f15" };
const ADVISOR = new Map(ROSTER.map((a) => [a.id, a]));
const advisorOf = (key) => ADVISOR.get(key) || RANKINGS_ADVISOR;
const SHOWN = 7; // flags on an Overall card (one line in the panel)
const CHEVRON = `<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const advStyle = (adv) => `--adv:${adv.color};--adv-dark:${adv.dark}`;

/** The whole screen. `ctx`: {tab, mine, details, about, failed, nameOf(iso), flag(iso) → HTML, countries: [{id, name}]}. */
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
  return `<div class="rk" data-tab="${esc(tab)}">${head}${tabsHtml(doc, tab)}${mineHtml(doc, tab, ctx)}${
    tab === OVERALL ? overallHtml(doc, ctx) : measureHtml(doc, tab, ctx)}</div>`;
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
  if (tab !== OVERALL && mine) {
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
  return `<p class="rk-lede">Where every country stands on the World Bank's newest figures. Each card is one tab's first
      measure; open it for every country in order.</p>
    <ul class="rk-cards">${doc.groups.map((g) => cardHtml(doc, g, ctx)).join("")}</ul>
    ${sourceHtml(doc, null)}`;
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
      <div class="rk-adv">
        ${emblem(adv, 52)}
        <div class="rk-adv-text"><small>${esc(adv.role)}</small><h3>${esc(g.label)}</h3></div>
        <button type="button" class="rk-fold" data-act="rankings-about" aria-expanded="${about}" aria-controls="rk-about"
          title="${about ? "Hide" : "Show"} the ${esc(adv.role.toLowerCase())}'s note">${CHEVRON}</button>
      </div>
      <p class="rk-bubble" id="rk-about"${about ? "" : " hidden"}>${note}</p>
      <div class="rk-tools">${seg}${check}</div>
      <div class="rk-cols" aria-hidden="true"><span>Civilization</span><span title="Each bar is the figure as a share of the highest">${esc(m.label)} · ${m.year}</span></div>
      <ul class="rk-rows">${r.rows.map(row).join("")}</ul>
      ${nOther ? `<h4 class="wv-group rk-group">No ${m.year} figure <span>${nOther} · not ranked</span></h4>
        <ul class="rk-rows rk-others">${r.others.map(row).join("")}</ul>` : ""}
      ${missing.length ? `<p class="rk-missing"><b>No figure since ${esc(doc.first_year ?? "")}:</b> ${esc(missing.join(", "))}.</p>` : ""}
      ${sourceHtml(doc, m)}
    </section>`;
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

function sourceHtml(doc, m) {
  const src = doc.source || {};
  const wdi = /^https:\/\//.test(src.url || "") ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title || "World Development Indicators")}</a>` : esc(src.title || "");
  const what = m && /^[A-Z0-9.]+$/i.test(m.indicator || "")
    ? `<a href="https://data.worldbank.org/indicator/${esc(m.indicator)}" target="_blank" rel="noopener noreferrer">${esc(m.label)}</a>, from ${esc(m.origin)}. `
    : "";
  return `<p class="wv-src rk-src">${what}${esc(src.publisher || "World Bank")}, ${wdi}${src.license ? ` (${esc(src.license)})` : ""}${src.updated ? `, <span class="wv-nowrap">updated ${esc(src.updated)}</span>` : ""}.</p>`;
}
