// World view (web/js/ext/ports): a world map on which every country can be clicked, and the way into every EarthCiv
// edition and community map ("port") of a country.
//
//   * On a page with <html data-home="world"> the bare address opens straight onto it (app/home.js, ./home.js).
//     Inside an edition, the "World" button beside the map menu opens it over the map (app mode "ports").
//   * The map menu (ui/mapPicker.js) lists the world map, the EarthCiv editions and every community map that opens
//     inside EarthCiv. It is the same menu in an edition's top bar and in the bar above an open community map, so
//     any map is one pick away from any other.
//   * Click or tap any country, pick it in the list beside the map, or find it with the search box (/): its card
//     shows the country's World Bank figures, one big button that opens its best map (an EarthCiv edition, a
//     community map shown inside EarthCiv, or one on its own site) and every other map of it. A country nobody has
//     mapped yet says so and links to how EarthCiv is built.
//   * A map that can be opened also shows its star rating, and five stars to rate it with (./ratings.js).
//   * URL hash: #ports=all (over an edition) or #ports=<map id> (a map open inside), and #country=<ISO code>.
//   * Loads web/data/ports.json, world-outlines.json, world-figures.json and ratings.json only when first opened.

import { esc } from "../../app/escape.js";
import { icon } from "../../ui/icon.js";
import { editionIcon, fitMenu, flagEmoji, mapIcon, menuLabel } from "../../ui/mapPicker.js";
import { preventIosInputZoom } from "../../ui/mobile.js";
import { DEFAULT_EDITION, EDITIONS } from "../../app/edition-index.js";
import { editionUrl } from "../../app/home.js";
// The map script and the stylesheet are versioned (as ./home.js versions this file) so that a browser holding copies
// from before this rewrite fetches new ones; see ./home.js.
import { createWorldMap, portKind } from "./worldMap.js?v=20261126";
import { createRatings } from "./ratings.js";

const MODE = "ports";
const DATA_URL = new URL("../../../data/", import.meta.url);
const CSS_HREF = new URL("../../../css/ports.css?v=20261126", import.meta.url).href;
const CUSTOM_KEY = "earthciv.customPorts.v1";
const CATALOG_PORT_COUNT = 44; // maps in ports.json, shown on the World button before it loads (tests/test_ports.py)
const WORLD_VALUE = "__ports__"; // the map menu's entry for the world map (no map has this id)
// Editions with pictures of their own map for their card here: home.jpg and home-small.jpg in the edition's folder,
// declared by "home_pictures" in editions.json (docs/EDITIONS.md; pipeline/home_pictures.py makes them).
const PICTURED = new Set(EDITIONS.filter((e) => e.home_pictures === true).map((e) => e.id));
const REPO_URL = "https://github.com/earthciv/earthciv";
const ORIGINAL_URL = "https://karpathy.ai/usaciv";
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

function formatFigure(key, v) {
  if (key === "population") {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} billion`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} million`;
    return Math.round(v).toLocaleString("en-US");
  }
  if (key === "gdp_pc") return `US$${Math.round(v).toLocaleString("en-US")}`;
  if (key === "life") return `${Number(v).toFixed(1)} years`;
  return String(v);
}

export function install(app) {
  injectCss();
  preventIosInputZoom(); // the map menu's font is under 16 px; an edition has done this already, the home page has not
  const home = app.worldHome === true; // the world view is the page (no edition underneath); see ./home.js

  let catalogP = null;
  let portsP = null;
  let basePorts = [];
  let figures = null; // world-figures.json: {source, figures: [{key, label, unit}], countries: {ISO-2: {key: [year, value]}}}
  let customPorts = loadCustomPorts();
  let overlay = null;
  // The maps' star ratings. Every element with data-rating-of="<map id>" (a card, the viewer's bar) is a slot that
  // ratings.sync() fills and keeps up to date; a slot of a map that cannot be rated stays hidden.
  const ratings = createRatings({
    url: new URL("ratings.json", DATA_URL),
    onChange: () => ratings.sync(overlay, portById),
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
  const pending = { port: null, country: null };
  const savedTitle = document.title;

  const ui = {
    activePortId: null, // a map open in the viewer
    selected: null, // the picked country (ISO code)
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

    if (picker) {
      // The edition's menu gets the world map now and the community maps as soon as their list is here.
      syncMenus();
      picker.addEventListener("change", (e) => {
        if (EDITIONS.some((ed) => ed.id === picker.value)) return; // another edition is a page load: main.js opens it
        e.stopImmediatePropagation();
        onMenuPick(picker, EDITION_ID);
      }, true);
      loadPorts().catch((err) => console.error("could not load ports.json", err));
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
  // figures wait until the world view opens.
  function loadPorts() {
    if (!portsP) {
      portsP = fetchJson(new URL("ports.json", DATA_URL)).then((portsDoc) => {
        basePorts = syncWithEditions(portsDoc.ports || [], EDITIONS);
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
        // Headline figures per country (pipeline/build_world_figures.py). The world view works without them.
        fetchJson(new URL("world-figures.json", DATA_URL)).catch((err) => {
          console.error("could not load world-figures.json", err);
          return null;
        }),
      ]).then(([ports, outlinesDoc, figuresDoc]) => {
        figures = figuresDoc;
        return { ports, outlines: outlinesDoc };
      });
      catalogP.catch(() => (catalogP = null)); // a failed load is retried the next time
    }
    ratings.load(); // not waited for: the stars appear when they arrive, and the world view works without them
    return catalogP;
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
          license: "MIT", repo: "earthciv/earthciv", author: "earthciv", url: null, embed: true,
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

  // The maps shown, after the map key filter.
  function filteredPorts() {
    if (!ui.kind || ui.kind === "none") return allPorts();
    return allPorts().filter((p) => {
      const k = portKind(p);
      return ui.kind === "live" ? k === "live" || k === "custom" : k === ui.kind;
    });
  }

  // A country's maps, best first: EarthCiv editions, your links, maps that open inside, maps on their own site, code;
  // a map of the country alone before a map of a whole region.
  function portsFor(iso, list = allPorts()) {
    return list
      .filter((p) => (p.countries || []).includes(iso))
      .sort((a, b) => {
        const ka = KIND_ORDER[portKind(a)] ?? 9, kb = KIND_ORDER[portKind(b)] ?? 9;
        if (ka !== kb) return ka - kb;
        const sa = (a.countries || []).length === 1, sb = (b.countries || []).length === 1;
        if (sa !== sb) return sa ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
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
    const by = p.author ? ` by ${p.author}` : "";
    if (k === "merged") {
      if (!home && p.editionId === EDITION_ID) return { title: `Back to ${p.name}`, sub: "the EarthCiv map you came from" };
      return { title: `Play ${p.name}`, sub: "EarthCiv edition · opens here" };
    }
    if ((k === "live" || k === "custom") && p.embed && p.url) {
      return { title: `Open ${p.name}`, sub: `${k === "custom" ? "your link" : `community map${by}`} · opens here` };
    }
    if (p.url) return { title: `Open ${p.name}`, sub: `community map${by} · opens in a new tab`, href: p.url };
    if (p.repo) return { title: `${p.name}: source code`, sub: `on GitHub${by} · no live site yet`, href: `https://github.com/${encodeURI(p.repo)}` };
    return { title: p.name, sub: "" };
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
          <span class="wv-coverage" id="wv-coverage"></span>
          ${end}
        </div>
      </header>

      <div class="ports-atlas">
        <div class="ports-map-pane">
          <div class="ports-canvas-wrap">
            <canvas id="ports-world-canvas" role="img" aria-label="World map. Click any country to see its maps and figures; the list beside the map has every country too."></canvas>
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
          </div>
          <span class="pc-badge ports-vkind" id="ports-vkind"></span>
          <div class="ports-vactions" id="ports-vactions"></div>
        </div>
        <div class="ports-vstage">
          <div class="ports-vloading" id="ports-vloading" hidden>
            <div class="ports-spinner" aria-hidden="true"></div>
            <div class="ports-vloading-text" id="ports-vloading-text">Surveying…</div>
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

    // Hovering a row or a card highlights its country, or its map's countries, on the world map.
    sideEl.addEventListener("pointerover", (e) => {
      const row = e.target.closest("[data-hover]");
      map?.setListHover(row?.dataset.hover || null);
      const card = e.target.closest(".port-card");
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
      ? "<b>Tap</b> any country · <b>pinch</b> to zoom"
      : "<b>Click</b> any country · <b>scroll</b> to zoom · <b>drag</b> to move";
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
    const el = e.target.closest("button, a, [data-select], [data-open-port], .rt, .port-card");
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
    if (el.classList.contains("rt")) return; // a click that just misses a star must not open the card's map
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
      return map?.resetView();
    }
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
        // An edition's suggestion is its link, out of the tab order like every suggestion (the arrow keys pick one).
        const [tag, opens] = portKind(p) === "merged" && p.editionId
          ? ["a", `${editionLink(p.editionId)} tabindex="-1"`]
          : ["div", `data-open-port="${esc(p.id)}"`];
        return `<${tag} class="wv-opt" role="option" id="wv-opt-${i}" aria-selected="false" ${opens}>
          <span class="wv-flag" aria-hidden="true">${esc(iconOf(p) || "🗺️")}</span><span class="wv-opt-name">${esc(p.name)}</span>
          <span class="wv-opt-meta">${esc(KIND[portKind(p)].label)}${where ? ` · ${esc(where)}` : ""}</span></${tag}>`;
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
    if (!ui.selected) ui.listScroll = scroller.scrollTop;
    const same = ui.selected === iso && ui.pickedPortId === (port?.id || null);
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
    overlay.querySelector("#wv-side-scroll").scrollTop = ui.listScroll || 0;
    if (focusRow) overlay.querySelector(`.wv-row[data-select="${CSS.escape(prev)}"]`)?.focus({ preventScroll: true });
    syncTitle();
    if (write) app.hash.soon();
  }

  function openPrimary() {
    const list = portsFor(ui.selected);
    activatePort((ui.pickedPortId && list.find((x) => x.id === ui.pickedPortId)) || list[0]);
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
    overlay.querySelector("#wv-legend").innerHTML = kindsHtml();
    const mapped = new Set(allPorts().flatMap((p) => p.countries || []));
    overlay.querySelector("#wv-coverage").innerHTML = `<b>${mapped.size}</b> countries mapped · <b>${allPorts().length}</b> maps`;
    renderSide();
  }

  function kindsHtml() {
    return ["merged", "live", "external", "repo", "none"]
      .map((k) => `<button type="button" class="wv-key ${KIND[k].cls}" data-kind="${k}" aria-pressed="${ui.kind === k}"><i class="wv-dot ${KIND[k].cls}"></i>${esc(KIND[k].key)}</button>`)
      .join("") + (ui.kind ? `<button type="button" class="wv-key wv-key-clear" data-kind="">Show all ×</button>` : "");
  }

  function renderSide() {
    if (!map) return;
    sideEl.dataset.view = ui.selected ? "detail" : "list";
    sideEl.setAttribute("aria-label", ui.selected ? countryName(ui.selected) : "Countries");
    overlay.querySelector("#wv-side-content").innerHTML = ui.selected ? detailHtml(ui.selected) : listHtml();
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
      const row = `<span class="wv-tile-emblem" aria-hidden="true">${esc(p.emblem || "★")}</span>
        <span class="wv-tile-text"><b>${esc(p.name)}</b><small>${current ? "EarthCiv edition · you came from here" : "EarthCiv edition · hex map from public data"}</small></span>
        <span class="wv-play">${PLAY_SVG}<span>${current ? "Back" : "Play"}</span></span>`;
      const body = !pic ? row : `<span class="wv-tile-pic"><picture>
          <source media="(max-width: 600px), (min-width: 901px) and (max-height: 760px)" srcset="${pic}-small.jpg" width="519" height="288">
          <img src="${pic}.jpg" alt="" width="716" height="208" decoding="async"></picture></span>
        <span class="wv-tile-row">${row}</span>`;
      return `<a class="wv-tile${pic ? " wv-tile-pictured" : ""}" ${editionLink(p.editionId)} data-hover="${esc(iso)}" aria-label="${current ? "Back to" : "Play"} ${esc(p.name)}">
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
      <div class="wv-kinds" role="group" aria-label="Show only">${kindsHtml()}</div>
      ${mapped.length ? `<h3 class="wv-group">With a map <span>${mapped.length}</span></h3><ul class="wv-rows">${mapped.map(row).join("")}</ul>` : ""}
      ${unmapped.length ? `<h3 class="wv-group">No map yet <span>${unmapped.length}</span></h3><ul class="wv-rows wv-rows-none">${unmapped.map(row).join("")}</ul>` : ""}
      <div class="wv-foot">
        <p>Know a map that is missing? <button type="button" class="wv-linkbtn" data-act="toggle-add">Add its link</button></p>
        <p>EarthCiv is <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">open source</a> and grew out of
          Andrej Karpathy's <a href="${ORIGINAL_URL}" target="_blank" rel="noopener noreferrer">usaciv</a>.</p>
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
        <button type="button" class="wv-backlink" data-act="deselect">‹ All countries</button>
        <div class="wv-head">
          <span class="wv-flag wv-flag-lg" aria-hidden="true">${flagEmoji(iso)}</span>
          <div class="wv-head-text">
            <h2 class="wv-h" id="wv-detail-title" tabindex="-1">${esc(c.name)}</h2>
            <div class="wv-sub">${esc(sub)}</div>
          </div>
        </div>
        ${n ? primaryHtml(list[0]) : emptyHtml(c)}
        ${factsHtml(iso, c.name)}
        ${n ? `<h3 class="wv-group">${n === 1 ? "Its map" : `All ${n} maps of ${esc(c.name)}`}</h3>
          <div class="wv-cards">${list.map((p) => cardHtml(p, p.id === ui.pickedPortId)).join("")}</div>` : ""}
      </div>`;
  }

  function primaryHtml(p) {
    const a = actionOf(p);
    const k = portKind(p);
    const cls = KIND[k].cls;
    const inner = `<span class="wv-primary-ic" aria-hidden="true">${a.href ? EXT_SVG : PLAY_SVG}</span>
      <span class="wv-primary-text"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span>`;
    if (a.href) return `<a class="wv-primary ${cls}" href="${esc(a.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    if (k === "merged" && p.editionId) return `<a class="wv-primary ${cls}" ${editionLink(p.editionId)}>${inner}</a>`;
    return `<button type="button" class="wv-primary ${cls}" data-open-port="${esc(p.id)}">${inner}</button>`;
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

  // The country's headline figures from the World Bank, each labelled with its own year (each is the newest the World
  // Bank has for that country, so years can differ between figures and between countries).
  function factsHtml(iso, cname) {
    if (!figures) return "";
    const src = figures.source || {};
    const srcUrl = parseSafeUrl(src.url);
    const srcName = `${src.publisher || ""}, ${src.title || ""}`;
    const cite = `<p class="wv-src">${srcUrl ? `<a href="${esc(srcUrl.href)}" target="_blank" rel="noopener noreferrer">${esc(srcName)}</a>` : esc(srcName)}${src.license ? ` (${esc(src.license)})` : ""}${src.updated ? `, <span class="wv-nowrap">updated ${esc(src.updated)}</span>` : ""}</p>`;
    const row = figures.countries?.[iso];
    const items = (figures.figures || [])
      .filter((f) => Array.isArray(row?.[f.key]))
      .map((f) => {
        const [year, value] = row[f.key];
        const inner = `<span class="wv-fact-k">${esc(f.label)} <small>${esc(year)}</small></span><span class="wv-fact-v">${esc(formatFigure(f.key, value))}</span>`;
        // Each figure opens the World Bank's own chart of it for this country.
        const href = /^[A-Z0-9.]+$/i.test(f.indicator || "") && /^[A-Z]{2}$/.test(iso)
          ? `https://data.worldbank.org/indicator/${f.indicator}?locations=${iso}`
          : null;
        return href
          ? `<li><a class="wv-fact" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(`${f.label}, ${f.unit || ""}: the World Bank's chart for ${cname}`)}">${inner}</a></li>`
          : `<li><span class="wv-fact" title="${esc(f.unit || "")}">${inner}</span></li>`;
      });
    if (!items.length) return `<p class="wv-nofacts">The World Bank publishes no figures for ${esc(cname)}.</p>`;
    return `<ul class="wv-facts">${items.join("")}</ul>${cite}`;
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
    return `
      <article class="port-card ${KIND[k].cls}${picked ? " is-picked" : ""}" data-port-id="${esc(p.id)}" title="${esc(a.title)}">
        <div class="pc-top">
          <span class="pc-emblem" aria-hidden="true">${esc(iconOf(p) || "🌍")}</span>
          <div class="pc-head">
            <div class="pc-title-row">
              <h3>${esc(p.name)}</h3>
              <span class="pc-badge ${KIND[k].cls}">${esc(KIND[k].label)}</span>
            </div>
            <div class="pc-meta">
              ${scope ? `<span>${esc(scope)}</span>` : ""}
              ${p.author ? `<span>by ${esc(p.author)}</span>` : ""}
              ${p.license ? `<span>${esc(p.license)}</span>` : ""}
              ${langs ? `<span>${esc(langs)}</span>` : ""}
            </div>
          </div>
        </div>
        ${p.description ? `<p class="pc-desc">${esc(p.description)}</p>` : ""}
        <div class="pc-actions">${actions}</div>
        <div class="rt" data-rating-of="${esc(p.id)}" hidden></div>
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
      lines.push(`<div class="pt-sub">${esc(KIND[k].label)}${info.port.author ? ` · by ${esc(info.port.author)}` : ""}</div>`);
    } else {
      lines.push(`<div class="pt-head"><span>${flagEmoji(iso)}</span><b>${esc(info.country.name)}</b></div>`);
      const k = bestKind(list);
      const sub = k === "merged" ? "EarthCiv edition: play it here" : list.length ? plural(list.length, "map") : "No map yet · World Bank figures";
      lines.push(`<div class="pt-sub">${esc(sub)}</div>`);
    }
    lines.push(`<div class="pt-more">${iso === ui.selected ? "Its card is open" : "Click to open its card"}</div>`);
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
    loadingTxt.textContent = `Surveying ${port.name}…`;
    loadingExt.href = parsed.href;
    loading.hidden = false;
    notice.hidden = false;
    notice.innerHTML = `<span>A community map from <b>${esc(parsed.host)}</b>, shown inside EarthCiv. It is not part of EarthCiv.</span>
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
    const repoUrl = port.repo ? `https://github.com/${encodeURI(port.repo)}` : null;
    overlay.querySelector("#ports-vactions").innerHTML = `
      <div class="rt rt-bar" data-rating-of="${esc(port.id)}" hidden></div>
      <button type="button" class="ports-btn ports-btn-ghost" data-act="reload-frame" title="Reload" aria-label="Reload">↻</button>
      ${repoUrl ? `<a class="ports-btn ports-btn-ghost ports-vgh" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${EXT_SVG}</a>` : ""}
      <a class="ports-btn" href="${esc(port.url)}" target="_blank" rel="noopener noreferrer" title="Open in a new browser tab"><span class="ports-vlbl">New tab</span> ${EXT_SVG}</a>
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
    const name = port?.name || (ui.selected ? countryName(ui.selected) : null);
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
          });
          buildCountryIndex();
          overlay.querySelector("#wv-loading")?.remove();
          const hint = overlay.querySelector("#wv-hint");
          if (hint) hint.hidden = false;
          renderAll();
          syncInsets();
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

  app.portsAtlas = {
    open: (id = null) => app.setMode(MODE, { id }),
    close: () => !home && app.mode === MODE && app.setMode(null),
    selectCountry: (iso) => whenReady(() => selectCountry(String(iso).toUpperCase(), { fly: true })),
    loadCatalog,
    get map() {
      return map;
    },
    get selected() {
      return ui.selected;
    },
  };
}
