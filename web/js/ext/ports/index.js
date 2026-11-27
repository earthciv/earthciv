// World view (web/js/ext/ports): a world map on which every country can be clicked, and the way into every EarthCiv
// edition and community map ("port") of a country.
//
//   * On a page with <html data-home="world"> the bare address opens straight onto it (app/home.js, ./home.js).
//     Inside an edition, the "World" button beside the map menu opens it over the map (app mode "ports").
//   * The map menu (ui/mapPicker.js) lists the world map, the EarthCiv editions and every community map that opens
//     inside EarthCiv. It is the same menu in an edition's top bar and in the bar above an open community map, so
//     any map is one pick away from any other.
//   * Click or tap any country, pick it in the list beside the map, or find it with the search box (/): its card
//     has one big button that opens its best map (an EarthCiv edition, a community map shown inside EarthCiv, or one
//     on its own site), its Demographics (where it stands on World Rankings' measures) and every other map of it. A
//     country nobody has mapped yet says so and links to how EarthCiv is built.
//   * A map that can be opened also shows its star rating, and five stars to rate it with (./ratings.js): on its
//     card, in the bar above a community map open here, and in an edition's own top bar.
//   * Every map names its maker, with their picture, wherever it is shown: on its card, on the button that opens it,
//     and in the bar and the note of a community map that is open here. "Map makers" lists everyone who made one
//     (./makers.js).
//   * World Rankings compares every country on the World Bank's figures, a tab per group of measures, with the
//     visitor's own country marked (./rankingsView.js, ./rankings.js). It takes the country list's place, as Map
//     makers does; a row opens that country's card, whose back link returns to the same tab. While a tab is open the
//     map is its lens: every country in the tab's colours, its key in the map key's place, the maps' pins aside.
//   * URL hash: #ports=all (over an edition) or #ports=<map id> (a map open inside), #country=<ISO code>,
//     #makers=all (the list of makers; a maker's key in place of "all" brings that maker into view) and
//     #rankings=overall (World Rankings; a measure's key, such as #rankings=gdp, opens its tab).
//   * Loads web/data/world-outlines.json and world-rankings.json only when first opened. An edition reads ports.json
//     as it starts, for its map menu, and ratings.json where its top bar has room for the stars.

import { esc } from "../../app/escape.js";
import { icon } from "../../ui/icon.js";
import { drawsFlags, editionIcon, fitMenu, flagEmoji, mapIcon, menuLabel } from "../../ui/mapPicker.js";
import { preventIosInputZoom } from "../../ui/mobile.js";
import { DEFAULT_EDITION, EDITIONS } from "../../app/edition-index.js";
import { editionUrl } from "../../app/home.js";
// The map script and the stylesheet are versioned (as ./home.js versions this file) so that a browser holding copies
// from before this rewrite fetches new ones; see ./home.js.
import { createWorldMap, portKind } from "./worldMap.js";
import { createRatings } from "./ratings.js";
import { MIN_RATINGS, avatarUrl, dayNumber, featuredPort, hueOf, initials, listMakers, makerOf, ownRepoStars, rankCountryPorts, rankMakers } from "./makers.js";
import { NO_DATA, OVERALL, measureOf, tabOf } from "./rankings.js";
import { RANKINGS_ADVISOR, demographicsHtml, lensFills, lensLegendHtml, lensTip, rankingsHtml } from "./rankingsView.js";
// The advisors' medallions, which the World Rankings' tabs share (no edition is loaded with them).
import { emblem } from "../advisors/core/emblems.js";

const MODE = "ports";
const DATA_URL = new URL("../../../data/", import.meta.url);
const CSS_HREF = new URL("../../../css/ports.css?v=20261127g", import.meta.url).href;
const CUSTOM_KEY = "earthciv.customPorts.v1";
const MINE_KEY = "earthciv.myCountry.v1"; // the country a visitor picked as theirs in World Rankings ("none": none)
const CATALOG_PORT_COUNT = 66; // maps in ports.json, shown on the World button before it loads (tests/test_ports.py)
const WORLD_VALUE = "__ports__"; // the map menu's entry for the world map (no map has this id)
const RATING_BAR = "(min-width: 701px)"; // where a map's bar has room for its stars (css/ports.css hides .rt-bar below)
// Editions with pictures of their own map for their card here: home.jpg and home-small.jpg in the edition's folder,
// declared by "home_pictures" in editions.json (docs/EDITIONS.md; pipeline/home_pictures.py makes them).
const PICTURED = new Set(EDITIONS.filter((e) => e.home_pictures === true).map((e) => e.id));
const REPO_URL = "https://github.com/earthciv/earthciv";
const ORIGINAL_URL = "https://karpathy.ai/usaciv";
// The account this site's own editions are credited to (the catalog's "repo" of an EarthCiv edition).
const HOUSE = new URL(REPO_URL).pathname.split("/")[1].toLowerCase();
const AVATAR_PX = 80; // the makers' pictures are asked for at one size, twice the largest they are drawn at
const FACES = 7; // how many makers' faces the country list shows on the way to the list of makers
// The form a map's author fills in to have it listed here for everyone (.github/ISSUE_TEMPLATE/add-your-map.yml).
// "Add its link" below only saves a link in the visitor's own browser.
const MAP_FORM_URL = `${REPO_URL}/issues/new?template=add-your-map.yml`;

const GLOBE_SVG = `<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19"/></svg>`;
const EXT_SVG = `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6M10 14 20 4M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>`;
const PLAY_SVG = `<svg class="icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 4.6v14.8a1 1 0 0 0 1.52.86l12.2-7.4a1 1 0 0 0 0-1.72L8.52 3.74A1 1 0 0 0 7 4.6z"/></svg>`;
const SEARCH_SVG = `<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`;

// How the world view names each kind of map (worldMap.portKind), in cards, the map key and tooltips.
const KIND = {
  merged: { cls: "k-merged", label: "EarthCiv edition", key: "EarthCiv edition" },
  live: { cls: "k-live", label: "Community map", key: "Community map" },
  external: { cls: "k-ext", label: "Community map · own site", key: "Map on its own site" },
  custom: { cls: "k-custom", label: "Your link", key: "Your link" },
  repo: { cls: "k-repo", label: "Source code only", key: "Source code only" },
  none: { cls: "k-none", label: "No map yet", key: "No map yet" },
};
const KIND_ORDER = { merged: 0, custom: 1, live: 2, external: 3, repo: 4 };

// Other names people search for, as whole phrases (Natural Earth's own names and the browser's English names are
// matched too, with and without accents). An exact match ranks first, so "uk" finds the United Kingdom before Ukraine.
const ALIASES = {
  US: "usa, us, america, united states", GB: "uk, britain, great britain, england, scotland, wales, northern ireland",
  NL: "holland", CZ: "czech republic", CI: "ivory coast", MM: "burma", KR: "korea, south korea", KP: "north korea",
  AE: "uae, emirates", CD: "drc, congo kinshasa", CG: "congo brazzaville", TR: "turkiye", SZ: "swaziland",
  MK: "macedonia", TL: "east timor", CV: "cape verde", RU: "russian federation", IR: "persia", VA: "vatican, holy see",
  BA: "bosnia, herzegovina", CF: "central african republic", DO: "dominican republic", GQ: "equatorial guinea",
  SS: "south sudan", PS: "palestine", TW: "republic of china", CN: "prc", NZ: "aotearoa", DE: "deutschland",
};

function injectCss() {
  if (document.getElementById("ports-css")) return;
  const l = document.createElement("link");
  l.id = "ports-css";
  l.rel = "stylesheet";
  l.href = CSS_HREF;
  document.head.appendChild(l);
}

function parseSafeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u;
}

function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

function customEntry({ id, name, url, countries }) {
  return {
    id,
    name,
    emblem: "🌐",
    status: "custom",
    scope: "country",
    region: "Custom",
    countries: Array.isArray(countries) ? countries.filter((c) => /^[A-Z]{2}$/.test(c)) : [],
    center: null,
    languages: [],
    license: null,
    repo: null,
    author: null,
    url,
    embed: true,
    description: "A map link you added (kept in this browser only).",
  };
}

function loadCustomPorts() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === "string" && parseSafeUrl(p.url))
      .map((p) => customEntry({ id: String(p.id), name: String(p.name || p.url), url: parseSafeUrl(p.url).href, countries: p.countries }));
  } catch {
    return [];
  }
}

function saveCustomPorts(list) {
  try {
    const clean = list.map((p) => ({ id: p.id, name: p.name, url: p.url, countries: p.countries || [] }));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
  } catch {
    /* ignore storage quota or sandbox errors */
  }
}

// The visitor's own country in World Rankings: a code, "" when they chose none, null when they never chose. Kept in
// this browser only, never in the address.
function loadMine() {
  try {
    const v = localStorage.getItem(MINE_KEY);
    if (v === "none") return "";
    return /^[A-Z]{2,3}$/.test(v || "") ? v : null;
  } catch {
    return null;
  }
}

function saveMine(iso) {
  try {
    localStorage.setItem(MINE_KEY, iso || "none");
  } catch {
    /* ignore storage quota or sandbox errors */
  }
}

/** A map's icon beside its name: its emblem, or its country's flag where the emblem is not an emoji (the U.S. star). */
const iconOf = (p) => mapIcon(p.emblem, (p.countries || [])[0]);

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function regionLabel(continent) {
  if (!continent) return "";
  if (/seven seas/i.test(continent)) return "Ocean islands";
  return continent;
}

// The longitude a phone's map opens on: the viewer's own, from the device's time zone (nothing leaves the browser).
function homeLongitude() {
  try {
    return Math.max(-165, Math.min(165, -new Date().getTimezoneOffset() / 4));
  } catch {
    return 0;
  }
}

export function install(app) {
  injectCss();
  preventIosInputZoom(); // the map menu's font is under 16 px; an edition has done this already, the home page has not
  const home = app.worldHome === true; // the world view is the page (no edition underneath); see ./home.js

  let catalogP = null;
  let portsP = null;
  let basePorts = [];
  let rankDoc = null; // world-rankings.json (pipeline/build_world_rankings.py): every country on ten measures
  let rankP = null;
  let rankFailed = false;
  let mine = loadMine();
  let customPorts = loadCustomPorts();
  let overlay = null;
  // The maps' star ratings. Every element with data-rating-of="<map id>" (a card, the viewer's bar, an edition's top
  // bar) is a slot that ratings.sync() fills and keeps up to date; a slot of a map that cannot be rated stays hidden.
  const ratings = createRatings({
    url: new URL("ratings.json", DATA_URL),
    onChange: () => {
      ratings.sync(overlay, portById);
      ratings.sync(editionRating?.parentElement, portById);
      syncMakers(); // the makers' order follows the ratings
    },
  });
  let map = null;
  let worldUnseen = false; // the world map was built while a community map covered it (see closeViewer)
  let tipEl = null;
  let searchInput = null;
  let resultsEl = null;
  let sideEl = null;
  let countryIndex = []; // [{id, name, continent, folded, words, aliases}], A–Z
  const ready = []; // callbacks waiting for the catalog and the map
  // A map or a country the URL named before the world loaded: kept in the URL meanwhile.
  const pending = { port: null, country: null, makers: null, rankings: null };
  const savedTitle = document.title;

  const ui = {
    activePortId: null, // a map open in the viewer
    selected: null, // the picked country (ISO code)
    makers: null, // the list of makers is showing: "all", or the key of the one maker to bring into view
    rankings: null, // World Rankings is showing (under a picked country's card, if one is open): "overall" or a measure
    rankScroll: 0, // where World Rankings was scrolled to when a country's card covered it
    rankDetails: false, // each row also shows the tab's other measure
    rankAbout: true, // the advisor's note at the top of a tab is open
    pickedPortId: null, // the map whose pin was clicked: first in the country's card
    kind: null, // map key filter: merged | live | external | repo | none (null = everything)
    sheet: "peek", // phones: mini | peek | full
    addFormOpen: false,
    listScroll: 0,
    results: [],
    activeResult: -1,
  };

  // --- the edition underneath (when not home) and the way to the world from it -------------------------------------
  const picker = home ? null : document.getElementById("country-picker");
  let editionMaker = null;
  let editionKind = null;
  let editionRating = null;
  const EDITION_ID = home ? null : picker?.value || DEFAULT_EDITION;
  const editionUnder = EDITIONS.find((e) => e.id === EDITION_ID);
  const editionName = editionUnder?.name || "the map";
  const editionEmblem = editionUnder?.emblem || "★";

  // The World button, beside the map menu in an edition's top bar and above an open community map. Its badge says how
  // many maps the world view lists (the catalog's own count once it has loaded).
  const LAUNCH_HTML = `${GLOBE_SVG}<span class="ports-launch-lbl">World</span><span class="ports-launch-count" aria-hidden="true"></span>`;
  function syncLaunchCount() {
    const n = basePorts.length ? allPorts().length : CATALOG_PORT_COUNT + customPorts.length;
    for (const btn of document.querySelectorAll(".ports-launch")) {
      const badge = btn.querySelector(".ports-launch-count");
      if (badge) badge.textContent = String(n);
      btn.title = `World map: pick any country (${n} maps)`;
      btn.setAttribute("aria-label", `World map: pick any country, ${n} maps`);
    }
  }

  // --- the map menu ------------------------------------------------------------------------------------------------
  // One list for both of its places (an edition's top bar, the bar above an open community map): the world map, the
  // editions, the community maps that open inside EarthCiv, and the links saved in this browser. An edition is listed
  // exactly as main.js lists it, so the menu's width does not change when the community maps arrive.
  function menuHtml() {
    const all = allPorts();
    const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
    const group = (label, options) => (options.length ? `<optgroup label="${esc(label)}">${options.join("")}</optgroup>` : "");
    const mapOption = (p) => option(p.id, menuLabel(iconOf(p), p.name));
    return option(WORLD_VALUE, "🌍 World map")
      + group("EarthCiv editions", EDITIONS.map((e) => option(e.id, menuLabel(editionIcon(e), e.name))))
      + group("Community maps", all.filter((p) => p.status === "live" && p.embed && p.url).map(mapOption))
      + group("Your links", all.filter((p) => p.status === "custom" && p.url).map(mapOption));
  }

  // Entries are rewritten only when they change, so a menu that is open keeps its list while the world loads.
  const menuWritten = new WeakMap();
  function fillMenu(select, current) {
    if (!select) return;
    const html = menuHtml();
    if (menuWritten.get(select) !== html) {
      select.innerHTML = html;
      menuWritten.set(select, html);
    }
    if (select.value !== (current || "")) select.value = current || "";
  }

  // Both menus name the map on screen: the edition underneath, and the community map open above it.
  function syncMenus() {
    fillMenu(picker, EDITION_ID);
    if (ui.activePortId) fillMenu(overlay?.querySelector("#ports-vswitch"), ui.activePortId);
  }

  // A pick from either menu. The menu itself goes back to naming the map on screen: the pick may open in a new tab
  // or be a page load that the visitor comes back from.
  function onMenuPick(select, current) {
    const value = select.value;
    select.value = current || "";
    if (value === WORLD_VALUE) {
      if (ui.activePortId) closeViewer();
      else app.setMode(MODE, { id: null });
      return;
    }
    const port = portById(value);
    if (EDITIONS.some((e) => e.id === value)) openEdition(value);
    else if (!port) return;
    else if (app.mode === MODE) activatePort(port);
    else app.setMode(MODE, { id: port.id });
    // The keyboard's focus follows the pick to the menu that now names the map on screen: the other bar's, when the
    // pick changed bars. Not on a touch screen, where focusing a menu can open it.
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const menu = app.mode !== MODE ? picker : ui.activePortId ? overlay?.querySelector("#ports-vswitch") : null;
    if (menu && menu !== select) menu.focus({ preventScroll: true });
  }

  if (!home) {
    // A prominent "World" button right beside the top-left map menu, at every screen width.
    const topbar = document.getElementById("topbar");
    const switcher = topbar?.querySelector(".country-switcher");
    const brand = topbar?.querySelector(".brand");
    const toggle = () => (app.mode === MODE ? app.setMode(null) : app.setMode(MODE, { id: null }));
    document.getElementById("btn-ports")?.remove();
    let btn = null;
    if (switcher || brand) {
      btn = document.createElement("button");
      btn.id = "btn-ports";
      btn.type = "button";
      btn.className = "ports-launch";
      btn.addEventListener("click", toggle);
      if (switcher) switcher.appendChild(btn);
      else brand.after(btn);
    } else {
      btn = app.ui.addTopButton({ id: "btn-ports", label: "World", onClick: toggle });
      btn?.classList.add("ports-launch");
    }
    if (btn) {
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = LAUNCH_HTML;
      syncLaunchCount();
      app.on("mode", ({ name }) => btn.setAttribute("aria-pressed", String(name === MODE)));
    }
    if (switcher) {
      // After World, as in the bar above a community map: the edition's maker, then what kind of map it is. Both
      // show once the list of maps is here, so neither moves the other.
      editionMaker = document.createElement("span");
      editionMaker.className = "map-maker";
      editionMaker.hidden = true;
      editionMaker.addEventListener("error", removeBrokenMakerPicture, true);
      editionKind = document.createElement("span");
      editionKind.className = `pc-badge ports-vkind ${KIND.merged.cls}`;
      editionKind.textContent = KIND.merged.label;
      editionKind.hidden = true;
      // At the row's far end, the edition's rating, as the bar above a community map has that map's: the average,
      // and five stars to give a rating with. It is named for the edition's entry once the list of maps is here.
      editionRating = document.createElement("div");
      editionRating.className = "rt rt-bar";
      editionRating.hidden = true;
      editionRating.addEventListener("click", (e) => {
        const star = e.target.closest(".rt-star");
        // The second click of a double-click is not a second choice (it would take the rating straight back).
        if (star?.dataset.rate && e.detail <= 1) ratePort(star.dataset.rate, Number(star.dataset.stars));
      });
      switcher.append(editionMaker, editionKind, editionRating);
    }

    if (picker) {
      // The edition's menu gets the world map now and the community maps as soon as their list is here.
      syncMenus();
      picker.addEventListener("change", (e) => {
        if (EDITIONS.some((ed) => ed.id === picker.value)) return; // another edition is a page load: main.js opens it
        e.stopImmediatePropagation();
        onMenuPick(picker, EDITION_ID);
      }, true);
      loadPorts().catch((err) => console.error("could not load ports.json", err));
      if (editionRating) {
        // The stars need the ratings. A phone's first row has no room for them (css/ports.css), so a phone reads
        // the ratings when the world view opens, as before.
        const roomForStars = matchMedia(RATING_BAR);
        const loadRatings = () => roomForStars.matches && ratings.load();
        loadRatings();
        roomForStars.addEventListener?.("change", loadRatings);
      }
    }
  }

  // --- data ----------------------------------------------------------------------------------------------------------
  function fetchJson(url) {
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url.pathname}: HTTP ${r.status}`);
      return r.json();
    });
  }

  // The list of maps alone (24 KB). An edition loads it as it starts, for its map menu; the world's outlines and
  // figures (World Rankings) wait until the world view opens.
  function loadPorts() {
    if (!portsP) {
      portsP = fetchJson(new URL("ports.json", DATA_URL)).then((portsDoc) => {
        basePorts = syncWithEditions(portsDoc.ports || [], EDITIONS);
        const editionPort = basePorts.find((port) => port.editionId === EDITION_ID);
        renderTopbarMaker(editionMaker, editionPort);
        if (editionKind) editionKind.hidden = false;
        if (editionRating && editionPort) {
          editionRating.dataset.ratingOf = editionPort.id;
          ratings.sync(editionRating.parentElement, portById);
        }
        syncLaunchCount();
        syncMenus();
        return basePorts;
      });
      portsP.catch(() => (portsP = null)); // a failed load is retried the next time
    }
    return portsP;
  }

  async function loadCatalog() {
    if (!catalogP) {
      catalogP = Promise.all([
        loadPorts(),
        fetchJson(new URL("world-outlines.json", DATA_URL)),
      ]).then(([ports, outlinesDoc]) => ({ ports, outlines: outlinesDoc }));
      catalogP.catch(() => (catalogP = null)); // a failed load is retried the next time
    }
    ratings.load(); // not waited for: the stars appear when they arrive, and the world view works without them
    return catalogP;
  }

  // World Rankings' figures (58 kB), which a country's card shows too (its Demographics). Asked for when the world
  // view opens, not waited for; a failed load is retried the next time World Rankings opens.
  function loadRankings() {
    if (!rankP) {
      rankFailed = false;
      rankP = fetchJson(new URL("world-rankings.json", DATA_URL)).then((doc) => {
        rankDoc = doc;
        return doc;
      });
      rankP.catch((err) => {
        console.error("could not load world-rankings.json", err);
        rankP = null;
        rankFailed = true;
      });
    }
    return rankP;
  }

  // Load the figures, then show them wherever World Rankings is waiting for them. A tab the address named before they
  // arrived is checked now (a group's key is its first measure; anything else is Overall). The address itself is left
  // as typed: rewriting it would add a step to the browser's Back.
  function whenRankings() {
    const done = () => {
      if (!map) return;
      if (ui.rankings) ui.rankings = tabOf(rankDoc, ui.rankings);
      if (ui.selected) rerenderCard(); // its Demographics
      else if (ui.rankings) rerenderRankings();
      syncLens();
      syncTitle();
    };
    loadRankings().then(done, done);
  }

  // Every edition in the index is represented as status "merged".
  function syncWithEditions(list, editions = []) {
    const copy = list.map((p) => ({ ...p }));
    const byEd = new Map(copy.filter((p) => p.editionId).map((p) => [p.editionId, p]));
    const byId = new Map(copy.map((p) => [p.id, p]));
    for (const ed of editions) {
      const existing = byEd.get(ed.id) || byId.get(ed.id);
      if (existing) {
        existing.status = "merged";
        existing.editionId = ed.id;
        existing.embed = true;
      } else {
        copy.unshift({
          id: ed.id, name: ed.name, emblem: ed.emblem, status: "merged", editionId: ed.id, scope: "country", region: "Other",
          countries: /^[a-z]{2}$/i.test(ed.id) ? [ed.id.toUpperCase()] : [], center: null, languages: ["en"],
          license: "MIT", repo: "earthciv/earthciv", author: "EarthCiv", url: null, embed: true,
          description: "Built-in EarthCiv edition.",
        });
      }
    }
    return copy;
  }

  // Function declarations: the map menu above is filled while install() is still running.
  function allPorts() {
    return [...basePorts, ...customPorts];
  }
  function portById(id) {
    return allPorts().find((p) => p.id === id) || null;
  }
  const countryName = (iso) => map?.getCountryName(iso) || iso;
  // A country's flag in a list. Where this system draws no flags (Windows) its code stands in, rather than the two
  // letters drawn as plain text by the flag itself.
  const flagHtml = (iso) => (drawsFlags() || !/^[A-Z]{2}$/.test(iso || "") ? flagEmoji(iso) : `<span class="rk-code">${esc(iso)}</span>`);

  // --- the makers ------------------------------------------------------------------------------------------------
  // Who made each map (./makers.js). A map names its maker wherever it is shown. This site's own editions are
  // credited to EarthCiv in words only: they keep their emblem where another map shows its maker's picture.
  const isHouse = (maker) => maker.key === HOUSE;
  /** The maker to name beside a map: null for a visitor's own link, and for this site's own editions. */
  const creditOf = (p) => {
    const maker = makerOf(p);
    return maker && !isHouse(maker) ? maker : null;
  };

  /** Everyone who made a map, in the order the list of makers shows them, with their ratings. */
  function rankedMakers() {
    return rankMakers(listMakers(basePorts, { house: HOUSE }), { ratingOf: (id) => ratings.of(id), day: dayNumber() });
  }

  // A maker's picture: the one on their GitHub account, drawn over their initials, which stay where there is no
  // account or the picture does not load. The browser asks GitHub for it without naming this
  // page (referrerpolicy), and only once the picture is about to be seen (loading="lazy").
  function avatarHtml(maker, cls = "") {
    const more = cls ? ` ${cls}` : "";
    if (isHouse(maker)) return `<span class="mk-av mk-av-house${more}" aria-hidden="true">${GLOBE_SVG}</span>`;
    const src = avatarUrl(maker.github, AVATAR_PX);
    return `<span class="mk-av${more}" style="--mk-hue:${hueOf(maker.key)}" aria-hidden="true"><span class="mk-ini">${esc(initials(maker.name))}</span>${
      src ? `<img class="mk-pic" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
  }

  // A failed image leaves the initials underneath it. Capture the event because image errors do not bubble.
  function removeBrokenMakerPicture(e) {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains("mk-pic")) e.target.remove();
  }

  // Both map bars highlight the current map's maker, including the account behind an EarthCiv edition.
  function renderTopbarMaker(slot, port) {
    if (!slot) return;
    const maker = makerOf(port);
    slot.hidden = !maker;
    if (!maker) {
      slot.replaceChildren();
      return;
    }
    const label = maker.twitter ? `@${maker.twitter}` : maker.name;
    const href = maker.twitter ? `https://x.com/${maker.twitter}` : maker.url;
    const title = `Map maker: ${label}`;
    const content = `${avatarHtml(maker)}<span class="map-maker-label">${esc(label)}</span>`;
    slot.innerHTML = href
      ? `<a class="map-maker-chip" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}" aria-label="${esc(title)}">${content}</a>`
      : `<span class="map-maker-chip" title="${esc(title)}">${content}</span>`;
  }

  // A maker's name: a link to their GitHub profile, or to the page of theirs that the catalog names.
  function makerTwitterHtml(maker) {
    return maker.twitter ? `<a class="mk-twitter" href="https://x.com/${esc(maker.twitter)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(maker.name)} on Twitter / X">@${esc(maker.twitter)} <span>on X</span></a>` : "";
  }

  function makerNameHtml(maker) {
    if (!maker.url) return `<span class="mk-name">${esc(maker.name)}</span> ${makerTwitterHtml(maker)}`;
    const onGitHub = !!maker.github && maker.url === `https://github.com/${maker.github}`;
    const title = onGitHub ? `${maker.name} on GitHub` : `${maker.name}'s own page`;
    return `<a class="mk-name" href="${esc(maker.url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${esc(maker.name)}</a> ${makerTwitterHtml(maker)}`;
  }

  function repoStarsHtml(port) {
    const stars = ownRepoStars(port);
    if (!stars) return "";
    const count = stars.toLocaleString("en-US");
    const checked = port.github_stars_checked ? ` · checked ${port.github_stars_checked}` : "";
    return `<a class="repo-stars" href="https://github.com/${esc(port.repo)}/stargazers" target="_blank" rel="noopener noreferrer"
      title="${esc(`${port.repo} · ${count} GitHub ${stars === 1 ? "star" : "stars"}${checked}`)}">☆ ${count} GitHub ${stars === 1 ? "star" : "stars"}</a>`;
  }

  function makerMapLineHtml(p) {
    const k = portKind(p);
    const a = actionOf(p);
    const r = ratings.of(p.id);
    const rated = ratingWords(r.n, r.sum);
    const iso = (p.countries || []).length === 1 ? p.countries[0] : "";
    const note = rated ? `<span class="mk-map-note mk-stars" title="${esc(rated.title)}">${rated.average}/5</span>`
      : k === "repo" ? `<span class="mk-map-note">source code</span>`
        : k === "merged" ? `<span class="mk-map-note">EarthCiv edition</span>` : "";
    const inner = `<span class="wv-flag" aria-hidden="true">${esc(iconOf(p) || "🗺️")}</span>
        <span class="mk-map-name">${esc(p.name)}</span>${note}
        <span class="mk-map-go ${KIND[k].cls}" aria-hidden="true">${a.href ? EXT_SVG : PLAY_SVG}</span>`;
    const stars = repoStarsHtml(p);
    return `<li>${openerHtml(p, "mk-map", inner, `data-port-id="${esc(p.id)}"${iso ? ` data-hover="${esc(iso)}"` : ""} title="${esc(a.title)}"`)}${stars ? `<div class="mk-map-stars">${stars}</div>` : ""}</li>`;
  }

  function featuredCreatorHtml(makers) {
    const maker = makers.find((entry) => entry.ports.some((port) => port.featured_creator === true))
      || makers.find((entry) => !entry.original && !entry.house && entry.ports.some((port) => port.status === "live" && port.url));
    if (!maker) return "";
    return `<section class="featured-creator" aria-label="Featured creator">
      <div class="featured-creator-heading">${avatarHtml(maker, "mk-av-lg")}<div>
        <span class="featured-creator-label">Featured creator</span>
        <div class="mk-line">${makerNameHtml(maker)}</div>
      </div></div>
      <ul class="featured-creator-maps">${maker.ports.map(makerMapLineHtml).join("")}</ul>
    </section>`;
  }

  function sourceCreditHtml(port) {
    const source = basePorts.find((entry) => entry.id === port.based_on);
    const maker = makerOf(source);
    return maker ? `<div class="pc-by">Built on ${esc(source.name)} by ${makerNameHtml(maker)}</div>` : "";
  }

  /** "4.6" and "Rated 4.6 out of 5 by 12 people" for a number of ratings and the sum of their stars; null unrated. */
  function ratingWords(n, sum) {
    if (!n) return null;
    const average = (sum / n).toFixed(1);
    return { average, title: `Rated ${average} out of 5 by ${plural(n, "person", "people")}` };
  }

  // The maps shown, after the map key filter.
  function filteredPorts() {
    if (!ui.kind || ui.kind === "none") return allPorts();
    return allPorts().filter((p) => {
      const k = portKind(p);
      return ui.kind === "live" ? k === "live" || k === "custom" : k === ui.kind;
    });
  }

  function globalRatingMean() {
    let n = 0;
    let sum = 0;
    for (const p of basePorts) {
      const r = ratings.of(p.id);
      n += r.n || 0;
      sum += r.sum || 0;
    }
    return n ? sum / n : 0;
  }

  // A country's maps, best and most popular first: EarthCiv editions, your links, maps that open inside, maps on their
  // own site, code; dedicated country maps before multi-country or regional maps, then ratings, GitHub stars and order.
  function portsFor(iso, list = allPorts()) {
    return rankCountryPorts(
      list.filter((p) => (p.countries || []).includes(iso)),
      { ratingOf: (id) => ratings.of(id), globalMean: globalRatingMean(), catalogOrder: allPorts() },
    );
  }

  function bestKind(list) {
    if (!list.length) return "none";
    const k = portKind(list[0]);
    return k === "custom" ? "live" : k;
  }

  function buildCountryIndex() {
    let names = null;
    try {
      names = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      names = null;
    }
    countryIndex = map.listCountries().map((c) => {
      const folded = fold(c.name);
      let display = "";
      try {
        display = names && /^[A-Z]{2}$/.test(c.id) ? names.of(c.id) || "" : "";
      } catch {
        display = "";
      }
      const aliases = [...(ALIASES[c.id] || "").split(","), display, c.short]
        .map((a) => fold(a).replace(/[’']/g, "'").trim())
        .filter((a) => a && a !== folded);
      return { ...c, folded, words: folded.split(/[\s.,'’()-]+/).filter(Boolean), aliases };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- what a click does -----------------------------------------------------------------------------------------
  function openEdition(id) {
    if (!home && id === EDITION_ID) app.setMode(null);
    else location.assign(editionUrl(id, DEFAULT_EDITION));
  }

  // Every control here that opens an edition is a link to its address, so that search engines follow it and a visitor
  // can open it in a new tab. The href is editionUrl() relative to this page: only the query differs (?country=us),
  // or, for the default edition without WORLD_HOME, the page's own path. data-play names the edition: a plain click on
  // the link to the edition underneath goes back to it without a reload, as openEdition() does (onOverlayClick).
  const editionLink = (id) => {
    const url = new URL(editionUrl(id, DEFAULT_EDITION));
    return `href="${esc(url.search || url.pathname)}" data-play="${esc(id)}"`;
  };

  // A click that follows a link in this tab: not one that asks for a new tab or window (Ctrl, Cmd, Shift) or a
  // download (Alt).
  const followsHere = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

  /** True for a map that opens inside EarthCiv, in the viewer: a community map that allows it, or a saved link. */
  function opensInside(p) {
    const k = portKind(p);
    return (k === "live" || k === "custom") && !!p.url && !!p.embed;
  }

  /** Open a map: an edition (a page load, or back to the one underneath), inside the viewer, or in a new tab. */
  function activatePort(p) {
    if (!p) return;
    const k = portKind(p);
    if (k === "merged" && p.editionId) return openEdition(p.editionId);
    if (opensInside(p)) return openPort(p);
    const href = p.url || (p.repo ? `https://github.com/${encodeURI(p.repo)}` : null);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }

  // What the big button says for a map, and where it goes when that is another site.
  function actionOf(p) {
    const k = portKind(p);
    const maker = creditOf(p);
    const by = maker ? `by ${maker.name} · ` : "";
    if (k === "merged") {
      if (!home && p.editionId === EDITION_ID) return { title: `Back to ${p.name}`, sub: "the EarthCiv map you came from" };
      return { title: `Play ${p.name}`, sub: `${by}EarthCiv edition · opens here` };
    }
    if ((k === "live" || k === "custom") && p.embed && p.url) {
      return { title: `Open ${p.name}`, sub: `${k === "custom" ? "your link" : `${by}community map`} · opens here` };
    }
    if (p.url) return { title: `Open ${p.name}`, sub: `${by}community map · opens in a new tab`, href: p.url };
    if (p.repo) return { title: `${p.name}: source code`, sub: `${by}on GitHub · no live site yet`, href: `https://github.com/${encodeURI(p.repo)}` };
    return { title: p.name, sub: "" };
  }

  // The control that opens a map, around `inner`: a link to an edition or to a map's own site, so that it can be
  // opened in a new tab, and a button for a map that opens here.
  function openerHtml(p, cls, inner, attrs = "") {
    const a = actionOf(p);
    const more = attrs ? ` ${attrs}` : "";
    if (a.href) return `<a class="${cls}" href="${esc(a.href)}" target="_blank" rel="noopener noreferrer"${more}>${inner}</a>`;
    if (portKind(p) === "merged" && p.editionId) return `<a class="${cls}" ${editionLink(p.editionId)}${more}>${inner}</a>`;
    return `<button type="button" class="${cls}" data-open-port="${esc(p.id)}"${more}>${inner}</button>`;
  }

  // --- overlay DOM -------------------------------------------------------------------------------------------------
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("section");
    overlay.id = "ports-overlay";
    overlay.className = "ports-overlay";
    overlay.setAttribute("aria-label", "World map");
    overlay.hidden = true;
    const end = home
      ? `<a class="wv-gh" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="EarthCiv is open source">GitHub ${EXT_SVG}</a>`
      : `<button type="button" class="wv-back" data-act="close" title="Back to ${esc(editionName)} (Esc)">
           <span class="wv-back-emblem" aria-hidden="true">${esc(editionEmblem)}</span><span class="wv-back-lbl">Back to ${esc(editionName)}</span>
           ${icon("close", "✕", { size: 11 })}
         </button>`;
    overlay.innerHTML = `
      <header class="wv-bar">
        <button type="button" class="wv-brand" data-act="world" title="Show the whole world" aria-label="EarthCiv: show the whole world">
          <span class="wv-emblem" aria-hidden="true">${GLOBE_SVG}</span><span class="wv-name">EarthCiv</span>
        </button>
        <div class="wv-search" role="search">
          <span class="wv-search-ic" aria-hidden="true">${SEARCH_SVG}</span>
          <input id="wv-search" type="search" placeholder="Find a country or map" autocomplete="off" spellcheck="false"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wv-results" aria-label="Find a country or map (/)">
          <kbd class="wv-kbd" aria-hidden="true">/</kbd>
          <div id="wv-results" class="wv-results" role="listbox" aria-label="Countries and maps" hidden></div>
        </div>
        <div class="wv-bar-end">
          <button type="button" class="wv-rank-btn" data-act="rankings-toggle" aria-pressed="false" title="World Rankings: every country compared">
            ${emblem(RANKINGS_ADVISOR, 24)}<span class="wv-rank-lbl">World Rankings</span>
          </button>
          <span class="wv-coverage" id="wv-coverage"></span>
          ${end}
        </div>
      </header>

      <div class="ports-atlas">
        <div class="ports-map-pane">
          <div class="ports-canvas-wrap">
            <canvas id="ports-world-canvas" role="img" aria-label="World map. Click any country to see its maps and figures, or double-click to open its top map; the list beside the map has every country too."></canvas>
            <div class="wv-loading" id="wv-loading">Loading the world…</div>
            <div class="wv-hint" id="wv-hint" hidden></div>
            <div class="ports-map-controls" role="group" aria-label="Zoom">
              <button type="button" class="ports-ctrl" data-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
              <button type="button" class="ports-ctrl" data-act="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
              <button type="button" class="ports-ctrl" data-act="zoom-reset" aria-label="Show the whole world" title="Whole world (0)">⟲</button>
            </div>
            <div class="ports-legend" id="wv-legend" role="group" aria-label="Map key: click one to show only those countries"></div>
            <div class="ports-tip" id="ports-tip" hidden></div>
          </div>
        </div>

        <aside class="ports-side" id="wv-side" aria-label="Countries" data-sheet="peek" data-view="list">
          <button type="button" class="wv-grip" data-act="sheet" aria-label="Show more of the list" aria-expanded="false"><span></span></button>
          <div class="wv-side-scroll" id="wv-side-scroll">
            <form class="ports-add-form" id="ports-add-form" hidden>
              <div class="ports-add-title">Add a map's link</div>
              <p class="ports-add-note">Any EarthCiv-style map on the web, or one running on your own computer. It is kept in this browser only.
                Built it yourself? <a class="wv-linkbtn" href="${MAP_FORM_URL}" target="_blank" rel="noopener noreferrer" title="The map form, on GitHub">List it for everyone</a></p>
              <input type="url" name="url" placeholder="https://… or http://localhost:8000" required aria-label="Link to the map">
              <div class="ports-add-row">
                <input type="text" name="name" placeholder="Name (optional)" aria-label="Name (optional)">
                <input type="text" name="country" placeholder="Country code" maxlength="2" aria-label="Two-letter country code, for example JP" class="ports-add-iso">
              </div>
              <div class="ports-add-btns">
                <button type="submit" class="ports-btn ports-btn-primary">Open it</button>
                <button type="button" class="ports-btn" data-act="save-custom">Save to the list</button>
                <button type="button" class="ports-btn ports-btn-ghost" data-act="cancel-add">Cancel</button>
              </div>
              <div class="ports-add-err" id="ports-add-err" hidden></div>
            </form>
            <div id="wv-side-content"><div class="wv-pad muted">Loading the world…</div></div>
          </div>
        </aside>
      </div>

      <div class="ports-viewer" id="ports-viewer" hidden>
        <div class="ports-vbar">
          <div class="country-switcher" role="group" aria-label="Map switcher">
            <div class="brand">
              <select id="ports-vswitch" class="map-picker" aria-label="Switch map" title="Switch map"></select>
            </div>
            <button type="button" class="ports-launch" data-act="back-atlas">${LAUNCH_HTML}</button>
            <span class="map-maker" hidden></span>
          </div>
          <span class="pc-badge ports-vkind" id="ports-vkind"></span>
          <div class="ports-vactions" id="ports-vactions"></div>
        </div>
        <div class="ports-vstage">
          <div class="ports-vloading" id="ports-vloading" hidden>
            <div class="ports-spinner" aria-hidden="true"></div>
            <div class="ports-vloading-text" id="ports-vloading-text">Surveying…</div>
            <div class="ports-vloading-by" id="ports-vloading-by" hidden></div>
            <a class="ports-btn" id="ports-vloading-ext" target="_blank" rel="noopener noreferrer">Open it in a new tab ${EXT_SVG}</a>
          </div>
          <div class="ports-vnotice" id="ports-vnotice" hidden></div>
          <iframe
            id="ports-iframe"
            class="ports-iframe"
            title="Community map"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerpolicy="no-referrer"
          ></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    tipEl = overlay.querySelector("#ports-tip");
    searchInput = overlay.querySelector("#wv-search");
    resultsEl = overlay.querySelector("#wv-results");
    sideEl = overlay.querySelector("#wv-side");
    syncLaunchCount();
    bindOverlayEvents();
    return overlay;
  }

  // --- events ------------------------------------------------------------------------------------------------------
  function submitCustom(openNow) {
    const form = overlay.querySelector("#ports-add-form");
    const err = overlay.querySelector("#ports-add-err");
    err.hidden = true;
    const fd = new FormData(form);
    const parsed = parseSafeUrl(String(fd.get("url") || ""));
    if (!parsed) {
      err.textContent = "Enter a link that starts with http:// or https://.";
      err.hidden = false;
      return;
    }
    const rawName = String(fd.get("name") || "").trim();
    const rawIso = String(fd.get("country") || "").trim().toUpperCase();
    const fallbackName = parsed.hostname + (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "");
    const entry = customEntry({
      id: `custom-${Date.now().toString(36)}`,
      name: rawName || fallbackName,
      url: parsed.href,
      countries: /^[A-Z]{2}$/.test(rawIso) ? [rawIso] : [],
    });
    customPorts = [entry, ...customPorts];
    saveCustomPorts(customPorts);
    form.reset();
    setAddFormOpen(false);
    renderAll();
    if (openNow) openPort(entry);
    else app.ui.toast?.(`Saved "${entry.name}"`);
  }

  function bindOverlayEvents() {
    overlay.querySelector("#ports-add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitCustom(true);
    });

    const vSwitch = overlay.querySelector("#ports-vswitch");
    vSwitch.addEventListener("change", () => onMenuPick(vSwitch, ui.activePortId));
    // The bar is fitted again when its width changes, and when the stars arrive in its other half.
    if (typeof ResizeObserver === "function") {
      const refit = new ResizeObserver(() => fitViewerBar());
      refit.observe(overlay.querySelector(".ports-vbar"));
      refit.observe(overlay.querySelector("#ports-vactions"));
    }
    document.fonts?.ready?.then(() => fitViewerBar());

    const iframe = overlay.querySelector("#ports-iframe");
    iframe.addEventListener("load", () => {
      const loading = overlay.querySelector("#ports-vloading");
      if (loading && iframe.src && iframe.src !== "about:blank") loading.hidden = true;
    });

    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("error", removeBrokenMakerPicture, true);
    // World Rankings: "Show details" and the visitor's own country.
    sideEl.addEventListener("change", (e) => {
      const t = e.target;
      if (t.classList?.contains("rk-details")) {
        ui.rankDetails = t.checked;
        rerenderRankings(".rk-details");
      } else if (t.classList?.contains("rk-mine-select")) {
        setMine(t.value);
      }
    });

    // Hovering a row or a card highlights its country, or its map's countries, on the world map.
    sideEl.addEventListener("pointerover", (e) => {
      const row = e.target.closest("[data-hover]");
      map?.setListHover(row?.dataset.hover || null);
      const card = e.target.closest("[data-port-id]"); // a map's card, or its line in the list of makers
      map?.setHighlightPort(card?.dataset.portId || ui.pickedPortId || null);
    });
    sideEl.addEventListener("pointerleave", () => {
      map?.setListHover(null);
      map?.setHighlightPort(ui.pickedPortId || null);
    });
    // The same for keyboard focus, so tabbing down the list shows where each country is.
    sideEl.addEventListener("focusin", (e) => map?.setListHover(e.target.closest("[data-hover]")?.dataset.hover || null));
    sideEl.addEventListener("focusout", () => map?.setListHover(null));
    resultsEl.addEventListener("pointerover", (e) => {
      map?.setListHover(e.target.closest("[data-hover]")?.dataset.hover || null);
    });
    resultsEl.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the focus in the search box

    searchInput.addEventListener("input", () => updateResults());
    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) updateResults();
    });
    searchInput.addEventListener("blur", () => setTimeout(() => closeResults(), 120));

    // A first-visit hint on the map, gone at the first click, drag or zoom.
    const hint = overlay.querySelector("#wv-hint");
    const canvas = overlay.querySelector("#ports-world-canvas");
    const touch = matchMedia("(pointer: coarse)").matches;
    hint.innerHTML = touch
      ? "<b>Tap</b> a country · <b>double-tap</b> to open"
      : "<b>Click</b> a country · <b>double-click</b> to open its map · <b>scroll</b> to zoom";
    const dropHint = () => {
      hint.classList.add("gone");
      setTimeout(() => hint.remove(), 450);
      canvas.removeEventListener("pointerdown", dropHint);
      canvas.removeEventListener("wheel", dropHint);
    };
    canvas.addEventListener("pointerdown", dropHint);
    canvas.addEventListener("wheel", dropHint, { passive: true });

    // Phones: drag the sheet's grip up or down (a tap cycles, in onOverlayClick).
    const grip = overlay.querySelector(".wv-grip");
    let gripY = null;
    grip.addEventListener("pointerdown", (e) => {
      gripY = e.clientY;
      grip.setPointerCapture?.(e.pointerId);
    });
    grip.addEventListener("pointerup", (e) => {
      if (gripY == null) return;
      const dy = e.clientY - gripY;
      gripY = null;
      if (Math.abs(dy) < 24) return;
      grip.dataset.dragged = "1";
      if (dy < 0) setSheet(ui.sheet === "mini" ? "peek" : "full");
      else setSheet(ui.sheet === "full" ? "peek" : "mini");
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(syncInsets).observe(sideEl);
    addEventListener("resize", syncInsets);

    // Keys while the world view is open. Capture phase, so they do not also reach an edition's map underneath.
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", (e) => {
      if (resultsEl && !resultsEl.hidden && !e.target.closest?.(".wv-search")) closeResults();
    });
  }

  function onOverlayClick(e) {
    const el = e.target.closest("button, a, [data-select], [data-open-port], .rt, .pc-repo-stars, .port-card");
    if (!el || !overlay.contains(el)) return;
    const d = el.dataset;
    if (el.tagName === "A") {
      // Links open themselves (and a link on a card does not also open the card), except a plain click on the link to
      // the edition underneath: that goes back to it, without a reload.
      if (d.play && !home && d.play === EDITION_ID && followsHere(e)) {
        e.preventDefault();
        openEdition(d.play);
      }
      return;
    }
    if (el.classList.contains("rt") || el.classList.contains("pc-repo-stars")) return; // a click beside stars must not open the card's map
    // A star: the second click of a double-click is not a second choice (it would take the rating straight back).
    if (d.rate) return e.detail > 1 ? undefined : ratePort(d.rate, Number(d.stars));
    const act = d.act;
    if (act === "close") return app.setMode(null);
    if (act === "back-atlas") return closeViewer();
    if (act === "zoom-in") return map?.zoomBy(1.6);
    if (act === "zoom-out") return map?.zoomBy(1 / 1.6);
    if (act === "zoom-reset") return map?.resetView();
    if (act === "world") {
      // The brand, like a site's logo, goes back to the start: the whole world and the list of every country.
      closeResults(true);
      deselect();
      closeMakers();
      closeRankings();
      return map?.resetView();
    }
    if (act === "rankings") return whenReady(() => openRankings(OVERALL, { focus: "title" }));
    if (act === "rankings-toggle") return whenReady(toggleRankings);
    if (act === "rankings-close") return closeRankings({ focus: true });
    if (act === "rankings-retry") return whenRankings();
    if (act === "rankings-about") return toggleRankAbout(el);
    if (act === "rankings-find") return findMine();
    if (d.rankTab && el.classList.contains("dm-k")) return openRankings(d.rankTab, { reveal: ui.selected }); // from a card's Demographics
    if (d.rankTab) return openRankings(d.rankTab, { focus: el.classList.contains("rk-tab") ? "tab" : el.classList.contains("rk-card") ? "title" : "seg" });
    if (act === "makers") return openMakers("all", { focus: true });
    if (act === "makers-close") return closeMakers({ focus: true });
    if (act === "retry") return app.setMode(MODE, { id: null });
    if (act === "deselect") return deselect({ focusRow: true });
    if (act === "toggle-add") return setAddFormOpen(!ui.addFormOpen, d.iso || ui.selected);
    if (act === "cancel-add") return setAddFormOpen(false);
    if (act === "save-custom") return submitCustom(false);
    if (act === "sheet") {
      if (d.dragged) {
        delete el.dataset.dragged;
        return;
      }
      return setSheet(ui.sheet === "peek" ? "full" : "peek");
    }
    if (act === "reload-frame") {
      const cur = portById(ui.activePortId);
      if (cur?.url) loadIframeForPort(cur);
      return;
    }
    if (act === "dismiss-notice") {
      overlay.querySelector("#ports-vnotice").hidden = true;
      return;
    }
    if (d.kind !== undefined) return setKind(!d.kind || d.kind === ui.kind ? null : d.kind);
    if (d.removeCustom) {
      customPorts = customPorts.filter((x) => x.id !== d.removeCustom);
      saveCustomPorts(customPorts);
      if (ui.activePortId === d.removeCustom) closeViewer();
      renderAll();
      return;
    }
    if (d.openPort) {
      closeResults(true);
      return activatePort(portById(d.openPort));
    }
    if (d.select) {
      closeResults(true);
      return selectCountry(d.select, { fly: true, focus: true });
    }
    // Anywhere else on a map's card opens that map, as its main button would.
    if (el.classList.contains("port-card")) activatePort(portById(d.portId));
  }

  const PAN = { ArrowLeft: [-90, 0], a: [-90, 0], ArrowRight: [90, 0], d: [90, 0], ArrowUp: [0, -90], w: [0, -90], ArrowDown: [0, 90], s: [0, 90] };

  function onKeyDown(e) {
    if (app.mode !== MODE || !overlay || overlay.hidden) return;
    const t = e.target;
    if (t === searchInput) return onSearchKey(e);
    if (e.key === "Escape") return; // the app's Esc → modes.escape() → onEscape() below
    const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (inField) return;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      if (!ui.activePortId) {
        stop();
        searchInput.focus();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || ui.activePortId) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "/") {
      stop();
      searchInput.focus();
    } else if (k === "+" || k === "=") {
      stop();
      map?.zoomBy(1.5);
    } else if (k === "-" || k === "_") {
      stop();
      map?.zoomBy(1 / 1.5);
    } else if (k === "0") {
      stop();
      map?.resetView();
    } else if (PAN[k]) {
      stop();
      map?.panBy(...PAN[k]);
    } else if (k === "Enter" && ui.selected && (t === document.body || t === overlay)) {
      stop();
      openPrimary();
    } else if (k === "?" || k === "l" || k === "r") {
      e.stopImmediatePropagation(); // an edition's shortcuts do not apply to the world map
    }
  }

  // --- search ------------------------------------------------------------------------------------------------------
  function searchMatches(q) {
    const f = fold(q.trim());
    if (!f) return [];
    const out = [];
    for (const c of countryIndex) {
      let rank = -1;
      if (c.aliases.includes(f) || (f.length <= 3 && fold(c.id) === f)) rank = 0;
      else if (c.folded.startsWith(f)) rank = 1;
      else if (c.words.some((w) => w.startsWith(f))) rank = 2;
      else if (c.aliases.some((a) => a.startsWith(f) || a.includes(` ${f}`))) rank = 2.5;
      else if (f.length >= 3 && c.folded.includes(f)) rank = 4;
      if (rank < 0) continue;
      const list = portsFor(c.id);
      out.push({ type: "country", id: c.id, rank: rank - (list.length ? 0.5 : 0), name: c.name, list });
    }
    if (f.length >= 2) {
      for (const p of allPorts()) {
        const hay = fold(`${p.name} ${p.author || ""} ${p.repo || ""}`);
        if (!hay.includes(f)) continue;
        out.push({ type: "port", id: p.id, rank: fold(p.name).startsWith(f) ? 3.2 : 5, name: p.name, port: p });
      }
    }
    out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return out.slice(0, 8);
  }

  function updateResults() {
    const q = searchInput.value;
    if (!q.trim()) return closeResults();
    ui.results = searchMatches(q);
    ui.activeResult = ui.results.length ? 0 : -1;
    if (!ui.results.length) {
      resultsEl.innerHTML = `<div class="wv-noresult">No country or map matches “${esc(q.trim())}”.</div>`;
    } else {
      resultsEl.innerHTML = ui.results.map((r, i) => {
        if (r.type === "country") {
          const n = r.list.length;
          const kind = bestKind(r.list);
          const meta = kind === "merged" ? `${PLAY_SVG} Play` : n ? plural(n, "map") : "No map yet";
          return `<div class="wv-opt" role="option" id="wv-opt-${i}" aria-selected="false" data-select="${esc(r.id)}" data-hover="${esc(r.id)}">
            <span class="wv-flag" aria-hidden="true">${flagEmoji(r.id)}</span><span class="wv-opt-name">${esc(r.name)}</span>
            <span class="wv-opt-meta ${KIND[kind].cls}">${meta}</span></div>`;
        }
        const p = r.port;
        const n = (p.countries || []).length;
        const where = n > 2 ? plural(n, "country", "countries") : (p.countries || []).map(countryName).join(" · ");
        const k = portKind(p);
        const maker = creditOf(p);
        // Its maker first; then what the name beside it does not already say.
        const meta = maker
          ? `by ${maker.name} · ${k === "merged" ? KIND[k].label : k === "repo" ? "source code" : where}`
          : `${KIND[k].label}${where ? ` · ${where}` : ""}`;
        // An edition's suggestion is its link, out of the tab order like every suggestion (the arrow keys pick one).
        const [tag, opens] = portKind(p) === "merged" && p.editionId
          ? ["a", `${editionLink(p.editionId)} tabindex="-1"`]
          : ["div", `data-open-port="${esc(p.id)}"`];
        return `<${tag} class="wv-opt" role="option" id="wv-opt-${i}" aria-selected="false" ${opens}>
          <span class="wv-flag" aria-hidden="true">${esc(iconOf(p) || "🗺️")}</span><span class="wv-opt-name">${esc(p.name)}</span>
          <span class="wv-opt-meta">${esc(meta)}</span></${tag}>`;
      }).join("");
    }
    resultsEl.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
    syncActiveResult();
  }

  function syncActiveResult() {
    const opts = [...resultsEl.querySelectorAll(".wv-opt")];
    opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === ui.activeResult)));
    const cur = opts[ui.activeResult];
    if (cur) {
      searchInput.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    } else {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function closeResults(clear = false) {
    if (!resultsEl) return;
    resultsEl.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
    map?.setListHover(null);
    if (clear) searchInput.value = "";
  }

  function onSearchKey(e) {
    const open = !resultsEl.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!open) updateResults();
      const n = ui.results.length;
      if (n) ui.activeResult = (ui.activeResult + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      syncActiveResult();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!open) updateResults();
      const r = ui.results[ui.activeResult];
      if (!r) return;
      closeResults(true);
      if (matchMedia("(pointer: coarse)").matches) searchInput.blur();
      if (r.type === "country") selectCountry(r.id, { fly: true, focus: true });
      else activatePort(r.port);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (open || searchInput.value) closeResults(true);
      else searchInput.blur();
    } else {
      e.stopImmediatePropagation(); // typing must not reach an edition's shortcuts
    }
  }

  // --- selection ---------------------------------------------------------------------------------------------------
  function selectCountry(iso, { fly = false, focus = false, port = null, write = true } = {}) {
    if (!map || !map.getCountry(iso)) return;
    const scroller = overlay.querySelector("#wv-side-scroll");
    if (!ui.selected) {
      // World Rankings stays under the card, and its back link returns to the same place in it.
      if (ui.rankings) ui.rankScroll = scroller.scrollTop;
      else if (!ui.makers) ui.listScroll = scroller.scrollTop;
    }
    const same = ui.selected === iso && ui.pickedPortId === (port?.id || null);
    ui.makers = null;
    ui.selected = iso;
    ui.pickedPortId = port?.id || null;
    map.setSelectedCountry(iso);
    map.setHighlightPort(ui.pickedPortId);
    if (!same) {
      renderSide();
      scroller.scrollTop = 0;
    }
    if (isSheetLayout() && ui.sheet !== "full") setSheet("peek");
    if (fly) map.focusCountry(iso);
    else map.revealCountry(iso);
    const n = portsFor(iso).length;
    announce(`${countryName(iso)}: ${n ? plural(n, "map") : "no map yet"}`);
    syncTitle();
    if (write && !same) app.hash.soon();
    if (focus) (overlay.querySelector(".wv-primary") || overlay.querySelector("#wv-detail-title"))?.focus({ preventScroll: true });
  }

  function deselect({ focusRow = false, write = true } = {}) {
    const prev = ui.selected;
    if (!prev) return;
    ui.selected = null;
    ui.pickedPortId = null;
    map?.setSelectedCountry(null);
    map?.setHighlightPort(null);
    renderSide();
    overlay.querySelector("#wv-side-scroll").scrollTop = (ui.rankings ? ui.rankScroll : ui.listScroll) || 0;
    if (focusRow) {
      const row = CSS.escape(prev);
      (overlay.querySelector(`.wv-row[data-select="${row}"], .rk-row[data-select="${row}"]`)
        || (ui.rankings ? overlay.querySelector("#wv-rankings-title") : null))?.focus({ preventScroll: true });
    }
    syncTitle();
    if (write) app.hash.soon();
  }

  function openPrimary() {
    const list = portsFor(ui.selected);
    activatePort((ui.pickedPortId && list.find((x) => x.id === ui.pickedPortId)) || list[0]);
  }

  // --- the list of makers ------------------------------------------------------------------------------------------
  // It takes the country list's place in the panel. `key` is "all", or one maker's key: that maker's entry is marked
  // and brought into view (#makers=<key>, a link a maker can share).
  function openMakers(key = "all", { write = true, focus = false } = {}) {
    if (!map) return;
    const wanted = String(key || "all").toLowerCase();
    if (ui.makers === wanted && !ui.selected) return; // already showing (Back from a map opened here): stay in place
    const scroller = overlay.querySelector("#wv-side-scroll");
    if (!ui.selected && !ui.makers && !ui.rankings) ui.listScroll = scroller.scrollTop;
    ui.makers = wanted;
    ui.rankings = null;
    syncRankingsButton();
    syncLens();
    ui.selected = null;
    ui.pickedPortId = null;
    map.setSelectedCountry(null);
    map.setHighlightPort(null);
    renderSide();
    scroller.scrollTop = 0;
    if (isSheetLayout()) setSheet("full"); // a phone's half-open sheet would show the heading and little else
    overlay.querySelector(".mk-row.is-focus")?.scrollIntoView({ block: "start" });
    announce(`Map makers: ${plural(overlay.querySelectorAll(".mk-row").length, "maker")}`);
    syncTitle();
    if (write) app.hash.soon();
    if (focus) overlay.querySelector("#wv-makers-title")?.focus({ preventScroll: true });
  }

  function closeMakers({ write = true, focus = false } = {}) {
    if (!ui.makers) return;
    ui.makers = null;
    renderSide();
    overlay.querySelector("#wv-side-scroll").scrollTop = ui.listScroll || 0;
    if (isSheetLayout() && ui.sheet === "full") setSheet("peek");
    syncTitle();
    if (write) app.hash.soon();
    if (focus) overlay.querySelector(".wv-makers")?.focus({ preventScroll: true });
  }

  // --- World Rankings -----------------------------------------------------------------------------------------------
  // It takes the country list's place in the panel, as the list of makers does. `tab` is "overall" or a measure's key
  // (a group's key opens its first measure). A country picked while it is open shows its card over it; the card's
  // back link, Esc and the browser's Back return to it. `keepCountry` (an address naming both) leaves that card open.
  function openRankings(tab = OVERALL, { write = true, focus = null, keepCountry = false, reveal = null } = {}) {
    if (!map) return;
    const wanted = tabOf(rankDoc, tab);
    const scroller = overlay.querySelector("#wv-side-scroll");
    if (ui.rankings === wanted && (keepCountry || !ui.selected)) {
      focusRankings(focus); // already showing (Back from a card or a map opened here): stay in place
      return;
    }
    if (!ui.selected && !ui.makers && !ui.rankings) ui.listScroll = scroller.scrollTop;
    if (ui.addFormOpen) setAddFormOpen(false);
    ui.makers = null;
    if (!keepCountry && ui.selected) {
      ui.selected = null;
      ui.pickedPortId = null;
      map.setSelectedCountry(null);
      map.setHighlightPort(null);
    }
    ui.rankings = wanted;
    ui.rankScroll = 0;
    renderSide();
    if (!ui.selected) scroller.scrollTop = 0;
    if (isSheetLayout()) setSheet("full"); // a phone's half-open sheet would show the tabs and little else
    const m = measureOf(rankDoc, wanted);
    announce(`World Rankings: ${m ? `${m.label}, ${m.year}` : "Overall"}`);
    syncTitle();
    syncRankingsButton();
    syncLens();
    if (write) app.hash.soon();
    if (reveal) findRow(reveal); // the country whose card asked for this tab
    else focusRankings(focus);
    if (!rankDoc) whenRankings();
  }

  function closeRankings({ write = true, focus = false } = {}) {
    if (!ui.rankings) return;
    ui.rankings = null;
    renderSide();
    if (!ui.selected) {
      overlay.querySelector("#wv-side-scroll").scrollTop = ui.listScroll || 0;
      if (isSheetLayout() && ui.sheet === "full") setSheet("peek");
    }
    syncTitle();
    syncRankingsButton();
    syncLens();
    if (write) app.hash.soon();
    if (focus) overlay.querySelector(".wv-rank-btn")?.focus({ preventScroll: true });
  }

  // The top bar's button: opens World Rankings, comes back to it from a card, or closes it.
  function toggleRankings() {
    if (!ui.rankings) return openRankings(OVERALL, { focus: "title" });
    if (ui.selected) return deselect({ focusRow: true });
    closeRankings({ focus: true });
  }

  function syncRankingsButton() {
    overlay?.querySelector(".wv-rank-btn")?.setAttribute("aria-pressed", String(!!ui.rankings));
  }

  // Focus after a change: the heading on opening, the pressed tab or measure after picking one.
  function focusRankings(which) {
    const target = which === "tab" ? ".rk-tab[aria-pressed=\"true\"]" : which === "seg" ? ".rk-seg [aria-pressed=\"true\"]" : which ? "#wv-rankings-title" : null;
    if (target) overlay.querySelector(target)?.focus({ preventScroll: true });
  }

  // Drawn again in place (the same scroll position), with the focus back on the control that changed it.
  function rerenderRankings(focusSel = null) {
    if (!map || !ui.rankings || ui.selected) return;
    const scroller = overlay.querySelector("#wv-side-scroll");
    const at = scroller.scrollTop;
    const active = document.activeElement;
    if (!focusSel && sideEl.contains(active)) {
      if (active.id === "wv-rankings-title") focusSel = "#wv-rankings-title";
      else if (active.classList.contains("rk-close")) focusSel = ".rk-close";
      else if (active.dataset.act === "rankings-retry") focusSel = '[data-act="rankings-retry"]';
    }
    renderSide();
    scroller.scrollTop = at;
    if (focusSel) {
      (overlay.querySelector(focusSel) || overlay.querySelector("#wv-rankings-title"))?.focus({ preventScroll: true });
    }
  }

  // The open card, drawn again where it is (its figures arrived), with the focus where it was.
  function rerenderCard() {
    const scroller = overlay.querySelector("#wv-side-scroll");
    const at = scroller.scrollTop;
    const a = document.activeElement;
    let keep = null;
    if (sideEl.contains(a)) {
      if (a.id) keep = `#${CSS.escape(a.id)}`;
      else if (a.classList.contains("wv-primary")) keep = ".wv-primary";
      else if (a.classList.contains("wv-backlink")) keep = ".wv-backlink";
      else if (a.dataset.act === "rankings-retry") keep = '[data-act="rankings-retry"]';
    }
    renderSide();
    scroller.scrollTop = at;
    if (keep) {
      (overlay.querySelector(keep) || overlay.querySelector(".wv-backlink"))?.focus({ preventScroll: true });
    }
  }

  function rankingsViewHtml() {
    return rankingsHtml(rankDoc, {
      tab: ui.rankings, mine: myCountry(), details: ui.rankDetails, about: ui.rankAbout, failed: rankFailed && !rankDoc,
      nameOf: countryName, flag: flagHtml, countries: countryIndex,
    });
  }

  // The visitor's own country: the one they picked, or over an edition, the edition's country until they pick.
  function myCountry() {
    if (mine !== null) return mine || null;
    const edition = basePorts.find((p) => p.editionId && p.editionId === EDITION_ID);
    return edition?.countries?.length === 1 ? edition.countries[0] : null;
  }

  function setMine(iso) {
    mine = /^[A-Z]{2,3}$/.test(iso || "") ? iso : "";
    saveMine(mine);
    rerenderRankings(".rk-mine-select");
    announce(mine ? `Your civilization: ${countryName(mine)}` : "No country picked as yours");
  }

  // "Show": the visitor's own row, brought into view and focused.
  function findMine() {
    findRow(null);
  }

  // A country's row (the visitor's own without one), brought into view, focused and lit up for a moment.
  function findRow(iso) {
    const row = iso ? overlay.querySelector(`.rk-row[data-select="${CSS.escape(iso)}"]`) : overlay.querySelector(".rk-row.is-me");
    if (!row) return focusRankings("title");
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    row.focus({ preventScroll: true });
    row.classList.remove("is-found");
    void row.offsetWidth; // restart the highlight
    row.classList.add("is-found");
  }

  function toggleRankAbout(btn) {
    ui.rankAbout = !ui.rankAbout;
    const note = overlay.querySelector("#rk-about");
    if (note) note.hidden = !ui.rankAbout;
    btn.setAttribute("aria-expanded", String(ui.rankAbout));
    btn.title = btn.title.replace(/^(Hide|Show)/, ui.rankAbout ? "Hide" : "Show");
  }

  // The makers' order and numbers follow the ratings. When those arrive or change, the faces on the country list and
  // the list of makers are drawn again, but only if they would come out differently.
  let makersDrawn = "";
  const makersSignature = (makers) => makers.map((m) => `${m.key}:${m.n}:${m.sum}:${m.ports.map((p) => { const r = ratings.of(p.id); return `${r.n}/${r.sum}`; }).join(",")}`).join("|");
  function syncMakers() {
    if (!map || !sideEl || ui.selected) return;
    const makers = rankedMakers();
    if (makersSignature(makers) === makersDrawn) return;
    if (ui.makers) {
      const scroller = overlay.querySelector("#wv-side-scroll");
      const at = scroller.scrollTop;
      renderSide();
      scroller.scrollTop = at;
    } else {
      const strip = overlay.querySelector(".wv-credit");
      if (strip) strip.outerHTML = makersStripHtml(makers);
    }
  }

  // A click on one of a map's five stars gives that rating, or takes it back when it already is the visitor's.
  async function ratePort(id, picked) {
    const port = portById(id);
    if (!port) return;
    const res = await ratings.choose(id, picked);
    if (res.ok) {
      app.ui.toast?.(
        res.stars ? `You rated ${port.name} ${plural(res.stars, "star")}`
          : res.changed ? `Your rating of ${port.name} was removed`
            // Ratings count per network: one given from another network cannot be taken back from this one.
            : `No rating of ${port.name} from this network to remove`,
      );
    } else if (res.error !== "ignored") {
      app.ui.toast?.(
        res.error === "too_many_changes" ? "That rating was changed too often today. Try again tomorrow."
          : res.error === "closed" ? "Ratings are closed at the moment."
            : "Your rating could not be saved. Please try again.",
      );
    }
  }

  function setKind(kind) {
    ui.kind = kind;
    renderAll();
  }

  // --- phones and narrow windows: the panel is a sheet over the bottom of the map -----------------------------------
  const isSheetLayout = () => matchMedia("(max-width: 900px)").matches;

  function setSheet(state) {
    ui.sheet = state;
    if (!sideEl) return;
    sideEl.dataset.sheet = state;
    const grip = sideEl.querySelector(".wv-grip");
    grip?.setAttribute("aria-expanded", String(state === "full"));
    grip?.setAttribute("aria-label", state === "full" ? "Show less of the list" : "Show more of the list");
  }

  function syncInsets() {
    if (!map || !sideEl) return;
    map.setInsets({ bottom: isSheetLayout() && !overlay.hidden ? sideEl.getBoundingClientRect().height : 0 });
  }

  // --- rendering -----------------------------------------------------------------------------------------------------
  function renderAll() {
    syncLaunchCount();
    syncMenus(); // a link added or removed is in both menus too
    if (!map) return;
    map.setPorts(allPorts(), filteredPorts());
    syncLens(); // the map key, or the open tab's colours
    const mapped = new Set(allPorts().flatMap((p) => p.countries || []));
    const nMakers = listMakers(basePorts).length;
    overlay.querySelector("#wv-coverage").innerHTML = `<b>${mapped.size}</b> countries mapped · <b>${allPorts().length}</b> maps`
      + (nMakers ? ` by <button type="button" class="wv-coverage-makers" data-act="makers" title="Everyone who made a map"><b>${nMakers}</b> makers</button>` : "");
    renderSide();
  }

  // While a tab of World Rankings is open the map is its lens: the tab's colours replace the maps' own (and their
  // pins), and its key takes the map key's place. Overall, and every other view, show the maps.
  let lensKey = null;
  function syncLens() {
    if (!map || !overlay) return;
    const key = ui.rankings && ui.rankings !== OVERALL && measureOf(rankDoc, ui.rankings) ? ui.rankings : null;
    if (key !== lensKey) {
      lensKey = key;
      map.setLens(key ? { fills: lensFills(rankDoc, key), noData: NO_DATA } : null);
      showMapTip(null);
    }
    const legend = overlay.querySelector("#wv-legend");
    legend.classList.toggle("is-lens", !!key);
    overlay.querySelector(".ports-atlas").classList.toggle("has-lens", !!key);
    legend.setAttribute("aria-label", key ? "Map key: the open tab's colours" : "Map key: click one to show only those countries");
    legend.innerHTML = key ? lensLegendHtml(rankDoc, key) : kindsHtml();
  }

  function kindsHtml() {
    return ["merged", "live", "external", "repo", "none"]
      .map((k) => `<button type="button" class="wv-key ${KIND[k].cls}" data-kind="${k}" aria-pressed="${ui.kind === k}"><i class="wv-dot ${KIND[k].cls}"></i>${esc(KIND[k].key)}</button>`)
      .join("") + (ui.kind ? `<button type="button" class="wv-key wv-key-clear" data-kind="">Show all ×</button>` : "");
  }

  function renderSide() {
    if (!map) return;
    const view = ui.selected ? "detail" : ui.rankings ? "rankings" : ui.makers ? "makers" : "list";
    sideEl.dataset.view = view;
    sideEl.setAttribute("aria-label", ui.selected ? countryName(ui.selected) : ui.rankings ? "World Rankings" : ui.makers ? "Map makers" : "Countries");
    overlay.querySelector("#wv-side-content").innerHTML = view === "detail" ? detailHtml(ui.selected)
      : view === "rankings" ? rankingsViewHtml() : view === "makers" ? makersHtml() : listHtml();
    ratings.sync(sideEl, portById);
  }

  function listHtml() {
    const visible = filteredPorts();
    const rows = countryIndex.map((c) => {
      const list = portsFor(c.id, visible);
      return { ...c, list, kind: bestKind(list) };
    });
    let mapped = rows.filter((r) => r.list.length);
    let unmapped = rows.filter((r) => !r.list.length);
    if (ui.kind === "none") mapped = [];
    else if (ui.kind) unmapped = [];
    const editions = allPorts().filter((p) => p.status === "merged" && p.editionId);
    const nMapped = new Set(allPorts().flatMap((p) => p.countries || [])).size;

    // An edition's card is one link to it (editionLink). Where the edition has pictures (PICTURED) it shows a piece of
    // its own map above the row that names it: the wide picture, or the squarer one where the cards are narrow.
    // ports.css sizes the picture on the same media condition as the <source> here; the link's label names the card.
    const tile = (p) => {
      const iso = (p.countries || [])[0] || "";
      const current = !home && p.editionId === EDITION_ID;
      const pic = PICTURED.has(p.editionId) ? esc(new URL(`${p.editionId}/home`, DATA_URL).href) : "";
      // An edition that began as somebody's own map says whose: on its picture, or in its line where it has none.
      // (The card is one link to the edition, so the name here is not a link of its own.)
      const maker = creditOf(p);
      const what = current ? "you came from here" : maker && !pic ? `by ${maker.name}` : "hex map from public data";
      const row = `<span class="wv-tile-emblem" aria-hidden="true">${esc(p.emblem || "★")}</span>
        <span class="wv-tile-text"><b>${esc(p.name)}</b><small>EarthCiv edition · ${esc(what)}</small></span>
        <span class="wv-play">${PLAY_SVG}<span>${current ? "Back" : "Play"}</span></span>`;
      const body = !pic ? row : `<span class="wv-tile-pic"><picture>
          <source media="(max-width: 600px), (min-width: 901px) and (max-height: 760px)" srcset="${pic}-small.jpg" width="519" height="288">
          <img src="${pic}.jpg" alt="" width="716" height="208" decoding="async"></picture>
          ${maker ? `<span class="wv-tile-by">${avatarHtml(maker)}<span>by ${esc(maker.name)}</span></span>` : ""}</span>
        <span class="wv-tile-row">${row}</span>`;
      return `<a class="wv-tile${pic ? " wv-tile-pictured" : ""}" ${editionLink(p.editionId)} data-hover="${esc(iso)}" aria-label="${current ? "Back to" : "Play"} ${esc(p.name)}${maker ? `, by ${esc(maker.name)}` : ""}">
        ${body}
      </a>`;
    };
    const row = (r) => {
      const n = r.list.length;
      const meta = r.kind === "merged" ? "Play" : r.kind === "repo" && n === 1 ? "Source code" : n ? plural(n, "map") : "";
      return `<li><button type="button" class="wv-row ${KIND[r.kind].cls}" data-select="${esc(r.id)}" data-hover="${esc(r.id)}">
        <span class="wv-flag" aria-hidden="true">${flagEmoji(r.id)}</span><span class="wv-row-name">${esc(r.name)}</span>
        ${meta ? `<span class="wv-row-meta"><i class="wv-dot ${KIND[r.kind].cls}"></i>${meta}</span>` : ""}
        <span class="wv-chev" aria-hidden="true">›</span></button></li>`;
    };

    return `
      <div class="wv-intro">
        <h2 class="wv-h">The real world, mapped like a strategy game</h2>
        <p class="wv-lede"><span class="wv-lede-what">Real countries as strategy-game maps, built from public data.</span>
          ${nMapped} mapped so far: pick one on the map, or start here.</p>
      </div>
      ${editions.length ? `<div class="wv-tiles${editions.some((p) => PICTURED.has(p.editionId)) ? " wv-tiles-pictured" : ""}">${editions.map(tile).join("")}</div>` : ""}
      ${makersStripHtml(rankedMakers())}
      <button type="button" class="wv-rankings" data-act="rankings">
        <span class="wv-rankings-medal" aria-hidden="true">${emblem(RANKINGS_ADVISOR, 40)}</span>
        <span class="wv-rankings-text"><b>World Rankings</b><small>Every country compared: wealth, people, science, land and trade</small></span>
        <span class="wv-chev" aria-hidden="true">›</span>
      </button>
      <div class="wv-kinds" role="group" aria-label="Show only">${kindsHtml()}</div>
      ${mapped.length ? `<h3 class="wv-group">With a map <span>${mapped.length}</span></h3><ul class="wv-rows">${mapped.map(row).join("")}</ul>` : ""}
      ${unmapped.length ? `<h3 class="wv-group">No map yet <span>${unmapped.length}</span></h3><ul class="wv-rows wv-rows-none">${unmapped.map(row).join("")}</ul>` : ""}
      <div class="wv-foot">
        <p>Know a map that is missing? <button type="button" class="wv-linkbtn" data-act="toggle-add">Add its link</button></p>
        <p>EarthCiv is <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">open source</a> and grew out of
          Andrej Karpathy's <a href="${ORIGINAL_URL}" target="_blank" rel="noopener noreferrer">usaciv</a>.</p>
      </div>`;
  }

  // The makers' place on the country list, under the editions: today's map, which is a different maker's every day
  // (./makers.js featuredPort), and the way to the list of makers, with the first few makers' faces and how many
  // there are.
  function makersStripHtml(makers) {
    makersDrawn = makersSignature(makers);
    if (!makers.length) return "";
    const faces = makers.filter((m) => !m.house).slice(0, FACES);
    return `<div class="wv-credit">
        ${featuredCreatorHtml(makers)}
        ${todayHtml(featuredPort(basePorts, { day: dayNumber() }))}
        <button type="button" class="wv-makers" data-act="makers" aria-label="Map makers: the ${makers.length} makers of these maps">
          <span class="wv-makers-faces">${faces.map((m) => avatarHtml(m)).join("")}</span>
          <span class="wv-makers-text"><b>${plural(makers.length, "maker")}</b><small>built these maps · meet them</small></span>
          <span class="wv-chev" aria-hidden="true">›</span>
        </button>
      </div>`;
  }

  // Today's map: its maker's picture, its name and whose it is. All of it opens the map, as its card's button would
  // (so the maker's name here is not a link of its own).
  function todayHtml(p) {
    const maker = p ? creditOf(p) : null;
    if (!maker) return "";
    const k = portKind(p);
    const a = actionOf(p);
    const n = (p.countries || []).length;
    const where = n > 2 ? plural(n, "country", "countries") : (p.countries || []).map(countryName).join(" · ");
    const inner = `${avatarHtml(maker, "mk-av-lg")}
        <span class="wv-today-text"><small class="wv-today-lbl">Today's map</small><b>${esc(p.name)}</b>
          <small>by ${esc(maker.name)}${where ? ` · ${esc(where)}` : ""}</small></span>
        <span class="mk-map-go ${KIND[k].cls}" aria-hidden="true">${a.href ? EXT_SVG : PLAY_SVG}</span>`;
    return `<div>${openerHtml(p, "wv-today", inner, `data-port-id="${esc(p.id)}"${n === 1 ? ` data-hover="${esc(p.countries[0])}"` : ""} title="${esc(a.title)}"`)}
      <div class="wv-today-connect">${makerNameHtml(maker)} ${repoStarsHtml(p)}</div></div>`;
  }

  // Everyone who made a map, each with their maps. A map's line opens it, as its card's button would.
  function makersHtml() {
    const makers = rankedMakers();
    makersDrawn = makersSignature(makers);
    const row = (m) => {
      const rated = ratingWords(m.n, m.sum);
      const tag = m.original ? "Where it began" : m.house ? "This site" : "";
      // Under the name: what the original map is to the others, and for someone with several maps how many, with
      // their rating taken together. (One map's rating is on its line.)
      const sub = [
        m.original ? "usaciv inspired EarthCiv and the community maps it showcases" : "",
        m.ports.length > 1 ? plural(m.ports.length, "map") : "",
        m.ports.length > 1 && rated ? `<span class="mk-stars" title="${esc(rated.title)}">${rated.average}/5</span> <small>(${m.n})</small>` : "",
      ].filter(Boolean);
      // The account's name, where the maker is credited under another one.
      const handle = m.github && m.github.toLowerCase() !== m.name.toLowerCase() && !m.house ? `<span class="mk-handle">${esc(m.github)}</span>` : "";
      return `<li class="mk-row${m.key === ui.makers ? " is-focus" : ""}${m.original ? " is-original" : ""}" data-maker="${esc(m.key)}">
          ${avatarHtml(m, "mk-av-lg")}
          <div class="mk-id">
            <div class="mk-line">${makerNameHtml(m)}${handle}${tag ? `<span class="mk-tag">${tag}</span>` : ""}</div>
            ${sub.length ? `<div class="mk-sub">${sub.join(" · ")}</div>` : ""}
          </div>
          <ul class="mk-maps">${m.ports.map(makerMapLineHtml).join("")}</ul>
        </li>`;
    };
    return `
      <div class="wv-detail wv-makers-view">
        <button type="button" class="wv-backlink" data-act="makers-close">‹ All countries</button>
        <h2 class="wv-h" id="wv-makers-title" tabindex="-1">Map makers</h2>
        <p class="wv-lede">${plural(basePorts.length, "map")} by ${plural(makers.length, "maker")}. Each map is its maker's own work, and most of them
          live on their maker's own site. EarthCiv lists them and links to them.</p>
        <ol class="mk-list">${makers.map(row).join("")}</ol>
        <div class="wv-foot">
          <p>Makers with ${MIN_RATINGS} or more visitor ratings are ordered by their weighted rating. GitHub stars help order makers with equal scores, including those awaiting enough ratings. Remaining ties rotate daily.</p>
          <p>Make one of these maps? <a href="${MAP_FORM_URL}&amp;request=Correct%20my%20map%27s%20listing" target="_blank" rel="noopener noreferrer">Add or update your Twitter / X</a></p>
          <p>Built a map in this style? <a href="${MAP_FORM_URL}" target="_blank" rel="noopener noreferrer" title="The map form, on GitHub">Add it to the list</a></p>
        </div>
      </div>`;
  }

  function detailHtml(iso) {
    const c = map.getCountry(iso) || { id: iso, name: iso };
    const list = portsFor(iso);
    if (ui.pickedPortId) {
      const k = list.findIndex((p) => p.id === ui.pickedPortId);
      if (k > 0) list.unshift(...list.splice(k, 1));
    }
    const n = list.length;
    const sub = [regionLabel(c.continent), n ? plural(n, "map") : "no map yet"].filter(Boolean).join(" · ");
    return `
      <div class="wv-detail">
        <button type="button" class="wv-backlink" data-act="deselect">‹ ${ui.rankings ? "World Rankings" : "All countries"}</button>
        <div class="wv-head">
          <span class="wv-flag wv-flag-lg" aria-hidden="true">${flagEmoji(iso)}</span>
          <div class="wv-head-text">
            <h2 class="wv-h" id="wv-detail-title" tabindex="-1">${esc(c.name)}</h2>
            <div class="wv-sub">${esc(sub)}</div>
          </div>
        </div>
        ${n ? primaryHtml(list[0]) : emptyHtml(c)}
        ${figuresHtml(iso)}
        ${n ? `<h3 class="wv-group">${n === 1 ? "Its map" : `All ${n} maps of ${esc(c.name)}`}</h3>
          <div class="wv-cards">${list.map((p) => cardHtml(p, p.id === ui.pickedPortId)).join("")}</div>` : ""}
      </div>`;
  }

  function primaryHtml(p) {
    const a = actionOf(p);
    const cls = KIND[portKind(p)].cls;
    const inner = `<span class="wv-primary-ic" aria-hidden="true">${a.href ? EXT_SVG : PLAY_SVG}</span>
      <span class="wv-primary-text"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span>`;
    return openerHtml(p, `wv-primary ${cls}`, inner);
  }

  function emptyHtml(c) {
    return `<div class="wv-empty">
        <p>Nobody has mapped ${esc(c.name)} yet. EarthCiv is open source, so a map of any country can be added.</p>
        <a class="wv-primary k-build" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">
          <span class="wv-primary-ic" aria-hidden="true">${EXT_SVG}</span>
          <span class="wv-primary-text"><b>See how EarthCiv is built</b><small>the code and the data pipeline, on GitHub</small></span></a>
        <button type="button" class="wv-linkbtn" data-act="toggle-add" data-iso="${esc(c.id)}">Know of a map of ${esc(c.name)}? Add its link</button>
        <a class="wv-linkbtn" href="${MAP_FORM_URL}" target="_blank" rel="noopener noreferrer" title="The map form, on GitHub">Built a map of ${esc(c.name)}? List it for everyone</a>
      </div>`;
  }

  // The country's figures: its Demographics, where it stands on World Rankings' measures, each with its year. Nothing
  // until they have loaded (the card is drawn again then); a note if they could not.
  function figuresHtml(iso) {
    if (rankDoc) return demographicsHtml(rankDoc, iso, { nameOf: countryName, flag: flagHtml });
    if (!rankFailed) return "";
    return `<p class="wv-nofacts">The World Bank's figures could not load. <button type="button" class="wv-linkbtn" data-act="rankings-retry">Try again</button></p>`;
  }

  function cardHtml(p, picked = false) {
    const k = portKind(p);
    const a = actionOf(p);
    const n = (p.countries || []).length;
    let scope = "";
    if (p.status === "custom") {
      try {
        scope = new URL(p.url).host;
      } catch {
        scope = "";
      }
    } else {
      scope = n > 2 ? plural(n, "country", "countries") : (p.countries || []).map(countryName).join(" · ");
    }
    const langs = (p.languages || []).length ? p.languages.join("/").toUpperCase() : "";
    const repoUrl = p.repo ? `https://github.com/${encodeURI(p.repo)}` : null;
    // The maker's picture takes the emblem's place (in a country's card every map has the same flag), and their name
    // has a line of its own under the map's.
    const maker = makerOf(p);
    const face = maker && !isHouse(maker) ? avatarHtml(maker, "pc-face") : `<span class="pc-emblem" aria-hidden="true">${esc(iconOf(p) || "🌍")}</span>`;

    let actions = "";
    if (k === "merged") {
      const label = `${PLAY_SVG} ${!home && p.editionId === EDITION_ID ? "Back to it" : "Play"}`;
      actions = p.editionId
        ? `<a class="ports-btn ports-btn-primary" ${editionLink(p.editionId)}>${label}</a>`
        : `<button type="button" class="ports-btn ports-btn-primary" data-open-port="${esc(p.id)}">${label}</button>`;
    } else if ((k === "live" || k === "custom") && p.url && p.embed) {
      actions = `<button type="button" class="ports-btn ports-btn-primary" data-open-port="${esc(p.id)}">${PLAY_SVG} Open here</button>
        <a class="ports-btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Open in a new browser tab">New tab ${EXT_SVG}</a>`;
    } else if (p.url) {
      actions = `<a class="ports-btn ports-btn-primary" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open its site ${EXT_SVG}</a>`;
    }
    if (repoUrl && k !== "merged") {
      actions += `<a class="ports-btn ports-btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(p.repo)}">${k === "repo" ? "Source code" : "GitHub"} ${EXT_SVG}</a>`;
    }
    if (k === "custom") {
      actions += `<button type="button" class="ports-btn ports-btn-ghost ports-rm" data-remove-custom="${esc(p.id)}" title="Remove this link" aria-label="Remove ${esc(p.name)}">✕</button>`;
    }
    const stars = repoStarsHtml(p);
    return `
      <article class="port-card ${KIND[k].cls}${picked ? " is-picked" : ""}" data-port-id="${esc(p.id)}" title="${esc(a.title)}">
        <div class="pc-top">
          ${face}
          <div class="pc-head">
            <div class="pc-title-row">
              <h3>${esc(p.name)}</h3>
              <span class="pc-badge ${KIND[k].cls}">${esc(KIND[k].label)}</span>
            </div>
            ${maker ? `<div class="pc-by">by ${makerNameHtml(maker)}</div>` : ""}
            ${sourceCreditHtml(p)}
            <div class="pc-meta">
              ${scope ? `<span>${esc(scope)}</span>` : ""}
              ${p.license ? `<span>${esc(p.license)}</span>` : ""}
              ${langs ? `<span>${esc(langs)}</span>` : ""}
            </div>
          </div>
        </div>
        ${p.description ? `<p class="pc-desc">${esc(p.description)}</p>` : ""}
        <div class="pc-actions">${actions}</div>
        <div class="rt" data-rating-of="${esc(p.id)}" hidden></div>
        ${stars ? `<div class="pc-repo-stars">${stars}</div>` : ""}
      </article>`;
  }

  // --- map hover tooltip (mouse only) ------------------------------------------------------------------------------
  function showMapTip(info) {
    if (!tipEl) return;
    if (!info) {
      tipEl.hidden = true;
      return;
    }
    const iso = info.country.id;
    const list = portsFor(iso, filteredPorts());
    const lines = [];
    if (info.port) {
      const k = portKind(info.port);
      lines.push(`<div class="pt-head"><span>${esc(iconOf(info.port) || "🌍")}</span><b>${esc(info.port.name)}</b></div>`);
      const maker = creditOf(info.port);
      lines.push(`<div class="pt-sub">${esc(KIND[k].label)}${maker ? ` · by ${esc(maker.name)}` : ""}</div>`);
    } else if (lensKey) {
      // Under World Rankings' lens: the country's figure on the open tab, its year and its rank.
      const t = lensTip(rankDoc, lensKey, iso);
      lines.push(`<div class="pt-head"><span>${flagEmoji(iso)}</span><b>${esc(info.country.name)}</b></div>`);
      lines.push(`<div class="pt-sub">${esc(t?.value || "")}</div>`);
      if (t?.rank) lines.push(`<div class="pt-rank">${esc(t.rank)}</div>`);
    } else {
      lines.push(`<div class="pt-head"><span>${flagEmoji(iso)}</span><b>${esc(info.country.name)}</b></div>`);
      const k = bestKind(list);
      const sub = k === "merged" ? "EarthCiv edition: play it here" : list.length ? plural(list.length, "map") : "No map yet · World Bank figures";
      lines.push(`<div class="pt-sub">${esc(sub)}</div>`);
    }
    const target = info.port || list[0] || null;
    if (target && !lensKey) {
      const clickHint = iso === ui.selected ? "Card open" : "Click for card";
      const openHint = info.port ? "Double-click to open" : `Double-click to open ${esc(target.name)}`;
      lines.push(`<div class="pt-more">${clickHint} · ${openHint}</div>`);
    } else {
      lines.push(`<div class="pt-more">${iso === ui.selected ? "Its card is open" : "Click to open its card"}</div>`);
    }
    tipEl.innerHTML = lines.join("");
    tipEl.hidden = false;
    const wrap = tipEl.parentElement.getBoundingClientRect();
    const tw = tipEl.offsetWidth || 200;
    const th = tipEl.offsetHeight || 54;
    let left = info.x - wrap.left + 14;
    let top = info.y - wrap.top + 16;
    if (left + tw > wrap.width - 8) left = Math.max(8, info.x - wrap.left - tw - 14);
    if (top + th > wrap.height - 8) top = Math.max(8, info.y - wrap.top - th - 14);
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  }

  // --- the viewer: a community map open inside EarthCiv ------------------------------------------------------------
  // It brings its own top bar, so the viewer's bar is the only EarthCiv bar above it. That bar starts as an edition's
  // top bar does: the map menu, which names the open map, then World.

  // The menu is as wide as the open map's name. Where the bar is too narrow for that (a long name on a phone), it
  // makes room a step at a time before the name is cut short (css/ports.css, data-tight): World drops its word, then
  // its count, then the menu gives up some padding and its letter spacing. Every call starts again from the full
  // bar, so the result depends on the bar's width and the name alone.
  function fitViewerBar() {
    const bar = overlay?.querySelector(".ports-vbar");
    const menu = overlay?.querySelector("#ports-vswitch");
    if (!bar || !ui.activePortId || overlay.hidden) return;
    delete bar.dataset.tight;
    for (let step = 1; step <= 3; step++) {
      const wanted = fitMenu(menu);
      if (menu.getBoundingClientRect().width >= wanted - 0.5) return;
      bar.dataset.tight = String(step);
    }
    fitMenu(menu); // the last step changed what the name needs
  }

  function loadIframeForPort(port) {
    const iframe = overlay.querySelector("#ports-iframe");
    const loading = overlay.querySelector("#ports-vloading");
    const loadingTxt = overlay.querySelector("#ports-vloading-text");
    const loadingExt = overlay.querySelector("#ports-vloading-ext");
    const notice = overlay.querySelector("#ports-vnotice");
    const parsed = parseSafeUrl(port.url);
    if (!parsed) return;

    const mixedContent = location.protocol === "https:" && parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname);
    if (mixedContent) {
      iframe.src = "about:blank";
      loading.hidden = true;
      notice.hidden = false;
      notice.innerHTML = `<span><b>${esc(port.name)}</b> uses plain HTTP, which browsers do not show inside an HTTPS page.</span>
        <a class="ports-btn ports-btn-primary" href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Open it in a new tab ${EXT_SVG}</a>`;
      return;
    }
    const maker = creditOf(port);
    loadingTxt.textContent = `Surveying ${port.name}…`;
    const loadingBy = overlay.querySelector("#ports-vloading-by");
    loadingBy.hidden = !maker;
    loadingBy.innerHTML = maker ? `${avatarHtml(maker)}<span>a map by <b>${esc(maker.name)}</b></span>` : "";
    loadingExt.href = parsed.href;
    loading.hidden = false;
    notice.hidden = false;
    notice.innerHTML = `${maker
      ? `<span class="ports-vnotice-by">${avatarHtml(maker)}<span><b>${esc(port.name)}</b> is a map by ${makerNameHtml(maker)}, shown here from <b>${esc(parsed.host)}</b>. It is their work, not EarthCiv's.</span></span>`
      : `<span>A map from <b>${esc(parsed.host)}</b>, shown inside EarthCiv. It is not part of EarthCiv.</span>`}
      <div class="ports-vnotice-actions">
        <a class="ports-btn" href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Open it in a new tab ${EXT_SVG}</a>
        <button type="button" class="ports-btn ports-btn-ghost" data-act="dismiss-notice" aria-label="Dismiss notice">✕</button>
      </div>`;
    iframe.title = `${port.name} (community map)`;
    iframe.src = parsed.href;
  }

  function openPort(port) {
    if (!port) return;
    if (port.status === "merged" && port.editionId) return openEdition(port.editionId);
    if (!((port.status === "live" || port.status === "custom") && port.url && port.embed)) return activatePort(port);
    ui.activePortId = port.id;
    showMapTip(null);
    closeResults(true);
    const k = portKind(port);
    const kind = overlay.querySelector("#ports-vkind");
    kind.className = `pc-badge ports-vkind ${KIND[k].cls}`;
    kind.textContent = KIND[k].label;
    renderTopbarMaker(overlay.querySelector(".ports-vbar .map-maker"), port);
    const repoUrl = port.repo ? `https://github.com/${encodeURI(port.repo)}` : null;
    overlay.querySelector("#ports-vactions").innerHTML = `
      <div class="rt rt-bar" data-rating-of="${esc(port.id)}" hidden></div>
      <button type="button" class="ports-btn ports-btn-ghost" data-act="reload-frame" title="Reload" aria-label="Reload">↻</button>
      ${repoUrl ? `<a class="ports-btn ports-btn-ghost ports-vgh" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${EXT_SVG}</a>` : ""}
      <a class="ports-btn" href="${esc(port.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(port.name)} in a new tab" title="Open ${esc(port.name)} in a new tab"><span class="ports-vlbl">New tab</span> ${EXT_SVG}</a>
      ${home ? "" : `<button type="button" class="icon-btn" data-act="close" aria-label="Back to ${esc(editionName)}" title="Back to ${esc(editionName)}">${icon("close", "✕", { size: 12 })}</button>`}`;
    ratings.sync(overlay.querySelector("#ports-viewer"), portById);
    fillMenu(overlay.querySelector("#ports-vswitch"), port.id);
    overlay.querySelector(".ports-atlas").hidden = true;
    overlay.querySelector(".wv-bar").hidden = true;
    overlay.querySelector("#ports-viewer").hidden = false;
    fitViewerBar(); // once the bar is on screen: a hidden menu cannot be measured
    loadIframeForPort(port);
    syncTitle();
    app.hash.soon();
  }

  function closeViewer() {
    if (!overlay || !ui.activePortId) return false;
    ui.activePortId = null;
    const iframe = overlay.querySelector("#ports-iframe");
    if (iframe) iframe.src = "about:blank";
    overlay.querySelector("#ports-viewer").hidden = true;
    overlay.querySelector(".wv-bar").hidden = false;
    overlay.querySelector(".ports-atlas").hidden = false;
    if (map) {
      syncInsets(); // the panel was hidden with the world map: on a phone its height is known again
      map.resize();
      frameUnseenWorld();
    }
    syncTitle();
    app.hash.soon();
    return true;
  }

  // A world map built behind an open community map had no size to frame its opening view in. It frames it the first
  // time it is on screen: the picked country, or the whole world.
  function frameUnseenWorld() {
    if (!worldUnseen || !map) return;
    worldUnseen = false;
    if (ui.selected) map.focusCountry(ui.selected, { animate: false });
    else map.resetView({ animate: false });
  }

  function setAddFormOpen(open, iso = null) {
    ui.addFormOpen = !!open;
    const form = overlay.querySelector("#ports-add-form");
    const err = overlay.querySelector("#ports-add-err");
    form.hidden = !ui.addFormOpen;
    if (err) err.hidden = true;
    overlay.querySelectorAll('[data-act="toggle-add"]').forEach((b) => b.setAttribute("aria-expanded", String(ui.addFormOpen)));
    if (ui.addFormOpen) {
      if (iso && /^[A-Z]{2}$/.test(iso)) form.querySelector('input[name="country"]').value = iso;
      if (isSheetLayout()) setSheet("full");
      overlay.querySelector("#wv-side-scroll").scrollTop = 0;
      form.querySelector('input[name="url"]')?.focus();
    }
  }

  function announce(text) {
    const el = document.getElementById("announce");
    if (el) el.textContent = text;
  }

  function syncTitle() {
    if (app.mode !== MODE) return;
    const port = ui.activePortId ? portById(ui.activePortId) : null;
    const maker = port ? creditOf(port) : null;
    const name = (port ? `${port.name}${maker ? ` by ${maker.name}` : ""}` : null)
      || (ui.selected ? countryName(ui.selected) : ui.rankings ? "World Rankings" : ui.makers ? "Map makers" : null);
    // The home page keeps the site's own title until something is picked.
    document.title = name ? `${name} · EarthCiv world map` : home ? savedTitle : "EarthCiv — world map";
  }

  // While the world view is open, what it covers (an edition's map and panels, or the bare page) is inert: out of the
  // tab order and hidden from screen readers. The toast and the live region stay usable.
  const madeInert = new Set();
  function setBackgroundInert(on) {
    if (!on) {
      for (const el of madeInert) el.inert = false;
      madeInert.clear();
      return;
    }
    for (const el of document.body.children) {
      if (el === overlay || el.inert || el.id === "toast" || el.id === "announce" || el.tagName === "SCRIPT") continue;
      el.inert = true;
      madeInert.add(el);
    }
  }

  // Run once the catalog and the map exist (a country or a map named in the URL can arrive before that).
  function whenReady(fn) {
    if (map) fn();
    else ready.push(fn);
  }

  // --- mode & URL hash -----------------------------------------------------------------------------------------
  let mountToken = 0;

  app.registerMode(MODE, {
    async enter(params = {}) {
      const tok = ++mountToken;
      const wanted = params?.id && params.id !== "all" ? params.id : null;
      if (wanted && !map) pending.port = wanted;
      ensureOverlay();
      overlay.hidden = false;
      document.body.classList.add("ports-open");
      setBackgroundInert(true);
      overlay.querySelector(".ports-atlas").hidden = false;
      overlay.querySelector(".wv-bar").hidden = false;
      overlay.querySelector("#ports-viewer").hidden = true;
      setSheet(ui.sheet);
      syncTitle();
      // A map picked in an edition's menu opens at once, with no world map on the way to it: the list of maps is
      // already here, and the world loads behind the open map.
      const direct = wanted ? portById(wanted) : null;
      const openedDirect = !!direct && opensInside(direct);
      if (openedDirect) {
        pending.port = null;
        openPort(direct);
      }
      try {
        const data = await loadCatalog();
        if (tok !== mountToken || app.mode !== MODE) return;
        if (!map) {
          map = createWorldMap({
            canvas: overlay.querySelector("#ports-world-canvas"),
            outlines: data.outlines,
            homeLon: homeLongitude(),
            insets: { bottom: isSheetLayout() ? sideEl.getBoundingClientRect().height : 0 },
            onHover: showMapTip,
            onSelectCountry(country, { port } = {}) {
              if (!country) return deselect();
              selectCountry(country.id, { port });
            },
            onOpenCountry(country, { port } = {}) {
              if (!country) return false;
              const target = port || portsFor(country.id, filteredPorts())[0] || null;
              if (!target) return false;
              showMapTip(null);
              activatePort(target);
              return true;
            },
          });
          buildCountryIndex();
          overlay.querySelector("#wv-loading")?.remove();
          const hint = overlay.querySelector("#wv-hint");
          if (hint) hint.hidden = false;
          renderAll();
          syncInsets();
          whenRankings(); // not waited for: World Rankings shows its figures when they arrive
          // The opening view frames the part of the map that the filled-in panel leaves uncovered (phones).
          map.resetView({ animate: false });
          worldUnseen = !!ui.activePortId; // built behind an open map: it frames its view when it first shows
        } else {
          renderAll();
          syncInsets();
        }
        map.resize();
        if (!ui.activePortId) frameUnseenWorld();
        syncTitle();
        while (ready.length) ready.shift()();
        if (wanted && !openedDirect) openPortById(wanted);
      } catch (err) {
        console.error("world map failed to load", err);
        overlay.querySelector("#wv-side-content").innerHTML = `<div class="wv-pad"><p><b>Could not load the world map.</b></p>
          <p class="muted">${esc(err.message || String(err))}</p><p><button type="button" class="ports-btn" data-act="retry">Try again</button></p></div>`;
        const loading = overlay.querySelector("#wv-loading");
        if (loading) loading.textContent = "Could not load the world map.";
      }
    },
    exit() {
      mountToken++;
      if (!overlay) return;
      ui.activePortId = null;
      const iframe = overlay.querySelector("#ports-iframe");
      if (iframe) iframe.src = "about:blank";
      overlay.querySelector("#ports-viewer").hidden = true;
      overlay.querySelector(".ports-atlas").hidden = false;
      overlay.querySelector(".wv-bar").hidden = false;
      overlay.hidden = true;
      document.body.classList.remove("ports-open");
      setBackgroundInert(false);
      closeResults(true);
      showMapTip(null);
      document.title = savedTitle;
    },
    onEscape() {
      // Esc steps back one level: an open map → the world map; the add form; the picked country → the list. Over an
      // edition one more Esc returns to it; on the home page there is nothing further back.
      if (ui.activePortId) {
        closeViewer();
        return true;
      }
      if (ui.addFormOpen) {
        setAddFormOpen(false);
        return true;
      }
      if (ui.selected) {
        deselect({ focusRow: true });
        return true;
      }
      if (ui.rankings) {
        closeRankings({ focus: true });
        return true;
      }
      if (ui.makers) {
        closeMakers({ focus: true });
        return true;
      }
      return home;
    },
  });

  function openPortById(id) {
    if (!map) pending.port = id;
    whenReady(() => {
      pending.port = null;
      const target = portById(id);
      if (!target) return;
      const k = portKind(target);
      if ((k === "live" || k === "custom") && target.embed && target.url) openPort(target);
      else if (target.countries?.length) selectCountry(target.countries[0], { fly: true, port: target, write: false });
    });
  }

  app.hash.register("ports", {
    get() {
      if (app.mode !== MODE) return null;
      if (ui.activePortId) return ui.activePortId;
      if (!map && pending.port) return pending.port;
      return home ? null : "all";
    },
    set(v) {
      if (home) {
        if (!v || v === "all") closeViewer();
        else openPortById(v);
        return;
      }
      if (!v) {
        if (app.mode === MODE) app.setMode(null);
        return;
      }
      if (app.mode !== MODE) app.setMode(MODE, { id: v });
      else if (v === "all") closeViewer();
      else openPortById(v);
    },
  });

  app.hash.register("country", {
    get() {
      if (app.mode !== MODE) return null;
      return ui.selected || (!map && pending.country) || null;
    },
    set(v) {
      if (!home && app.mode !== MODE) return;
      const iso = v && /^[A-Za-z]{2,3}$/.test(v) ? v.toUpperCase() : null;
      if (!map) pending.country = iso;
      whenReady(() => {
        pending.country = null;
        if (iso) selectCountry(iso, { fly: true, write: false });
        else deselect({ write: false });
      });
    },
  });

  // The list of makers: #makers=all, or #makers=<a maker's key> to bring that maker into view.
  app.hash.register("makers", {
    get() {
      if (app.mode !== MODE) return null;
      return ui.makers || (!map && pending.makers) || null;
    },
    set(v) {
      if (!home && app.mode !== MODE) return;
      const key = v ? String(v).slice(0, 80) : null;
      if (!map) pending.makers = key;
      whenReady(() => {
        pending.makers = null;
        if (key) openMakers(key, { write: false });
        else closeMakers({ write: false });
      });
    },
  });

  // World Rankings: #rankings=overall, or a measure's key for its tab (#rankings=gdp). An address that also names a
  // country (#country=FR) opens that country's card over it, with the back link to the tab.
  app.hash.register("rankings", {
    get() {
      if (app.mode !== MODE) return null;
      return ui.rankings || (!map && pending.rankings) || null;
    },
    set(v) {
      if (!home && app.mode !== MODE) return;
      const tab = v ? tabOf(rankDoc, v) : null;
      if (!map) pending.rankings = tab;
      whenReady(() => {
        pending.rankings = null;
        if (tab) openRankings(tab, { write: false, keepCountry: true });
        else closeRankings({ write: false });
      });
    },
  });

  app.portsAtlas = {
    open: (id = null) => app.setMode(MODE, { id }),
    close: () => !home && app.mode === MODE && app.setMode(null),
    selectCountry: (iso) => whenReady(() => selectCountry(String(iso).toUpperCase(), { fly: true })),
    showMakers: (key = "all") => whenReady(() => openMakers(key)),
    showRankings: (tab = OVERALL) => whenReady(() => openRankings(tab)),
    loadCatalog,
    get map() {
      return map;
    },
    get selected() {
      return ui.selected;
    },
    get rankings() {
      return ui.rankings;
    },
  };
}
