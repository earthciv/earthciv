// All Ports / World Atlas extension (web/js/ext/ports):
// View every built-in EarthCiv edition and unmerged community port from one interactive world atlas and directory,
// and launch live unmerged community ports (or any custom local/preview URL) right inside EarthCiv without leaving.
//
//   * Top-bar button: "Ports" (globe icon) + entry in the top-left country menu ("All ports & atlas…")
//   * App mode: "ports", URL hash: #ports=all or #ports=<port-id>
//   * Lazy-loads web/data/ports.json and web/data/world-outlines.json only when opened (0 startup overhead).

import { esc } from "../../format.js";
import { icon } from "../../ui/icon.js";
import { createWorldMap } from "./worldMap.js";

const MODE = "ports";
const DATA_URL = new URL("../../../data/", import.meta.url);
const CSS_HREF = new URL("../../../css/ports.css", import.meta.url).href;
const CUSTOM_KEY = "earthciv.customPorts.v1";
const CATALOG_PORT_COUNT = 43; // shown in the launch pill before ports.json is lazily loaded

// Read the active/default edition directly from the page & URL so this extension works both on the current main
// branch (country.js) and with the Phase 2 edition manifest loader (edition.js).
const HTML_EL = typeof document !== "undefined" ? document.documentElement : null;
const DEFAULT_EDITION = HTML_EL?.dataset?.defaultEdition || HTML_EL?.dataset?.defaultCountry || "us";
const REQUESTED_EDITION = typeof location !== "undefined" ? new URLSearchParams(location.search).get("country") : null;
const EDITION_ID = REQUESTED_EDITION || DEFAULT_EDITION;

const GLOBE_SVG = `<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19"/></svg>`;
const EXT_SVG = `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6M10 14 20 4M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>`;

function injectCss() {
  if (document.getElementById("ports-css")) return;
  const l = document.createElement("link");
  l.id = "ports-css";
  l.rel = "stylesheet";
  l.href = CSS_HREF;
  document.head.appendChild(l);
}

function editionHref(editionId) {
  const target = new URL(location.href);
  if (editionId === DEFAULT_EDITION) target.searchParams.delete("country");
  else target.searchParams.set("country", editionId);
  target.hash = "";
  return target.href;
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

function loadCustomPorts() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === "string" && parseSafeUrl(p.url))
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || p.url),
        emblem: "🌐",
        status: "custom",
        scope: "country",
        region: "Custom",
        countries: Array.isArray(p.countries) ? p.countries.filter((c) => /^[A-Z]{2}$/.test(c)) : [],
        center: Array.isArray(p.center) && p.center.length === 2 ? p.center : null,
        languages: [],
        license: null,
        repo: null,
        author: "Custom URL",
        url: parseSafeUrl(p.url).href,
        embed: true,
        description: "User-added unmerged port URL (saved locally in this browser).",
      }));
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

function statusMeta(p) {
  if (p.status === "merged") {
    return p.editionId === EDITION_ID
      ? { cls: "st-merged", label: "Merged · Active" }
      : { cls: "st-merged", label: "Merged" };
  }
  if (p.status === "custom") return { cls: "st-custom", label: "Custom URL" };
  if (p.status === "live") {
    return p.embed
      ? { cls: "st-live", label: "Unmerged · Live" }
      : { cls: "st-ext", label: "Unmerged · External" };
  }
  return { cls: "st-repo", label: "Unmerged · Repo" };
}

function scopeLabel(p, map) {
  if (p.status === "custom") {
    if (p.countries?.length) return p.countries.map((c) => map?.getCountryName(c) || c).join(", ");
    try { return new URL(p.url).host; } catch { return "Custom"; }
  }
  const n = (p.countries || []).length;
  if (n > 2) return `${n} countries`;
  if (n > 0) return p.countries.map((c) => map?.getCountryName(c) || c).join(" · ");
  return p.region || "";
}

export function install(app) {
  injectCss();

  let catalogP = null;
  let basePorts = [];
  let outlines = null;
  let customPorts = loadCustomPorts();
  let overlay = null;
  let map = null;
  let tipEl = null;

  // UI state inside the overlay
  const ui = {
    activePortId: null, // when set, opens the embedded viewer for that port
    selectedCountry: null, // ISO-2 filter from clicking the world map
    selectedCountryName: null,
    statusFilter: "all", // all | merged | live | repo | custom
    regionFilter: "all", // all | Americas | Europe | Asia | Middle East
    query: "",
    mobileTab: "map", // map | list
    addFormOpen: false,
    viewerNotice: "",
  };

  // --- prominent top-bar launch button & country-picker hook -----------------------------------------------------
  // Place a high-visibility "All Ports" button right beside the top-left country picker so it is immediately
  // discoverable at every screen width (desktop, laptop and phone) instead of collapsing to an unlabeled icon.
  let btn = null;
  const topbar = document.getElementById("topbar");
  const brand = topbar?.querySelector(".brand");
  const launchHtml = () => `${GLOBE_SVG}<span class="ports-launch-lbl">All Ports</span><span class="ports-launch-count">${basePorts.length ? allPorts().length : CATALOG_PORT_COUNT + customPorts.length}</span>`;
  if (topbar && brand) {
    document.getElementById("btn-ports")?.remove();
    btn = document.createElement("button");
    btn.id = "btn-ports";
    btn.type = "button";
    btn.className = "ports-launch";
    btn.title = "All Ports & World Atlas: browse and open merged & unmerged country ports inside EarthCiv";
    btn.setAttribute("aria-label", "All Ports: browse and open merged and unmerged country ports");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = launchHtml();
    btn.addEventListener("click", () => (app.mode === MODE ? app.setMode(null) : app.setMode(MODE, { id: null })));
    brand.after(btn);
  } else {
    btn = app.ui.addTopButton({
      id: "btn-ports",
      label: "All Ports",
      title: "All Ports & World Atlas: browse and open merged & unmerged country ports inside EarthCiv",
      onClick: () => (app.mode === MODE ? app.setMode(null) : app.setMode(MODE, { id: null })),
    });
    if (btn) {
      btn.classList.add("ports-launch");
      btn.innerHTML = launchHtml();
      btn.setAttribute("aria-pressed", "false");
    }
  }
  const syncLaunchCount = () => {
    const badge = btn?.querySelector(".ports-launch-count");
    if (!badge) return;
    badge.textContent = String(basePorts.length ? allPorts().length : CATALOG_PORT_COUNT + customPorts.length);
  };
  app.on("mode", ({ name }) => btn?.setAttribute("aria-pressed", String(name === MODE)));

  // Read the merged editions already populated in #country-picker before appending the atlas shortcut.
  const picker = document.getElementById("country-picker");
  const builtinEditions = picker
    ? [...picker.querySelectorAll("option")]
        .filter((o) => o.value && o.value !== "__ports__")
        .map((o) => ({ id: o.value, name: o.textContent.trim() || o.value }))
    : [];
  if (picker && !picker.querySelector('option[value="__ports__"]')) {
    const grp = document.createElement("optgroup");
    grp.label = "World Atlas";
    const opt = new Option("All ports (merged & unmerged)…", "__ports__");
    grp.appendChild(opt);
    picker.appendChild(grp);
    picker.addEventListener("change", (e) => {
      if (picker.value !== "__ports__") return;
      e.stopImmediatePropagation();
      picker.value = EDITION_ID;
      app.setMode(MODE, { id: null });
    }, true);
  }

  // --- lazy data load --------------------------------------------------------------------------------------------
  async function loadCatalog() {
    if (!catalogP) {
      const fetchJson = (url) => fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url.pathname}: HTTP ${r.status}`);
        return r.json();
      });
      catalogP = Promise.all([
        fetchJson(new URL("ports.json", DATA_URL)),
        fetchJson(new URL("world-outlines.json", DATA_URL)),
      ]).then(([portsDoc, outlinesDoc]) => {
        outlines = outlinesDoc;
        basePorts = syncWithEditions(portsDoc.ports || [], builtinEditions);
        return { ports: basePorts, outlines };
      });
    }
    return catalogP;
  }

  // Ensure every built-in edition offered in #country-picker is represented as status="merged".
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
          id: ed.id,
          name: ed.name,
          emblem: ed.emblem || "★",
          status: "merged",
          editionId: ed.id,
          scope: "country",
          region: "Other",
          countries: /^[a-z]{2}$/i.test(ed.id) ? [ed.id.toUpperCase()] : [],
          center: null,
          languages: ["en"],
          license: "MIT",
          repo: "earthciv/earthciv",
          author: "earthciv",
          url: null,
          embed: true,
          description: "Built-in EarthCiv edition.",
        });
      }
    }
    return copy;
  }

  function allPorts() {
    return [...basePorts, ...customPorts];
  }

  function filteredPorts() {
    const q = ui.query.trim().toLowerCase();
    return allPorts().filter((p) => {
      if (ui.selectedCountry && !(p.countries || []).includes(ui.selectedCountry)) return false;
      if (ui.statusFilter === "merged" && p.status !== "merged") return false;
      if (ui.statusFilter === "live" && p.status !== "live" && p.status !== "custom") return false;
      if (ui.statusFilter === "repo" && p.status !== "repo") return false;
      if (ui.statusFilter === "custom" && p.status !== "custom") return false;
      if (ui.regionFilter !== "all" && p.region !== ui.regionFilter) return false;
      if (q) {
        const countryNames = (p.countries || []).map((c) => `${c} ${map?.getCountryName(c) || ""}`).join(" ");
        const hay = `${p.name} ${p.author || ""} ${p.repo || ""} ${p.region || ""} ${p.description || ""} ${(p.languages || []).join(" ")} ${countryNames}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // --- overlay DOM -----------------------------------------------------------------------------------------------
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("section");
    overlay.id = "ports-overlay";
    overlay.className = "ports-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "All Ports & World Atlas");
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ports-atlas">
        <div class="ports-map-pane">
          <div class="ports-map-head">
            <div class="ports-title-block">
              <div class="ports-kicker">EarthCiv · World Atlas</div>
              <h2>All Ports &amp; Editions</h2>
            </div>
            <div class="ports-stats" id="ports-stats"></div>
            <div class="ports-head-actions">
              <div class="ports-mobile-tabs" role="tablist" aria-label="Atlas view">
                <button type="button" role="tab" data-mtab="map" aria-selected="true">World Map</button>
                <button type="button" role="tab" data-mtab="list" aria-selected="false">Directory</button>
              </div>
              <button type="button" class="icon-btn ports-close" data-act="close" aria-label="Close All Ports view (Esc)" title="Close (Esc)">${icon("close", "✕", { size: 12 })}</button>
            </div>
          </div>
          <div class="ports-canvas-wrap">
            <canvas id="ports-world-canvas" aria-label="Interactive world map of merged and unmerged ports"></canvas>
            <div class="ports-map-controls" aria-label="Map zoom controls">
              <button type="button" class="ports-ctrl" data-act="zoom-in" title="Zoom in">+</button>
              <button type="button" class="ports-ctrl" data-act="zoom-out" title="Zoom out">−</button>
              <button type="button" class="ports-ctrl" data-act="zoom-reset" title="Reset world view">↺</button>
            </div>
            <div class="ports-legend" aria-label="Map legend">
              <span><i class="dot dot-merged"></i>Merged in EarthCiv</span>
              <span><i class="dot dot-live"></i>Live unmerged (opens inside)</span>
              <span><i class="dot dot-ext"></i>Live (external tab)</span>
              <span><i class="dot dot-repo"></i>Source only (GitHub)</span>
              <span><i class="dot dot-none"></i>No port yet</span>
            </div>
            <div class="ports-tip" id="ports-tip" hidden></div>
          </div>
        </div>

        <aside class="ports-side" aria-label="Ports directory">
          <div class="ports-side-controls">
            <div class="ports-search-row">
              <input id="ports-search" type="search" placeholder="Search country, port, author, language…" autocomplete="off" spellcheck="false" aria-label="Filter ports">
              <button type="button" class="ports-add-toggle" data-act="toggle-add" aria-expanded="false" title="Preview any unmerged port URL inside EarthCiv">+ URL</button>
            </div>
            <form class="ports-add-form" id="ports-add-form" hidden>
              <div class="ports-add-title">Preview any unmerged or local port inside</div>
              <input type="url" name="url" placeholder="https://… or http://localhost:8000" required>
              <div class="ports-add-row">
                <input type="text" name="name" placeholder="Label (optional)">
                <input type="text" name="country" placeholder="ISO (e.g. UK, JP)" maxlength="2" style="width:92px;text-transform:uppercase">
              </div>
              <div class="ports-add-btns">
                <button type="submit" class="ports-btn ports-btn-primary" data-mode="open">Open inside</button>
                <button type="button" class="ports-btn" data-act="save-custom">Save to list</button>
                <button type="button" class="ports-btn ports-btn-ghost" data-act="cancel-add">Cancel</button>
              </div>
              <div class="ports-add-err" id="ports-add-err" hidden></div>
            </form>
            <div class="ports-pills" id="ports-status-pills" role="group" aria-label="Filter by status"></div>
            <div class="ports-pills ports-pills-sub" id="ports-region-pills" role="group" aria-label="Filter by region"></div>
            <div class="ports-country-bar" id="ports-country-bar" hidden></div>
          </div>
          <div class="ports-list" id="ports-list"></div>
        </aside>
      </div>

      <div class="ports-viewer" id="ports-viewer" hidden>
        <div class="ports-vbar">
          <button type="button" class="ports-btn" data-act="back-atlas" title="Back to World Atlas (Esc)">← All Ports</button>
          <div class="ports-vtitle" id="ports-vtitle"></div>
          <label class="ports-vswitch-wrap">
            <span class="sr-only">Switch port</span>
            <select id="ports-vswitch" aria-label="Switch between merged and live unmerged ports"></select>
          </label>
          <div class="ports-vactions" id="ports-vactions"></div>
        </div>
        <div class="ports-vstage">
          <div class="ports-vloading" id="ports-vloading" hidden>
            <div class="ports-spinner" aria-hidden="true"></div>
            <div class="ports-vloading-text" id="ports-vloading-text">Surveying port…</div>
            <a class="ports-btn" id="ports-vloading-ext" target="_blank" rel="noopener noreferrer">Open directly in new tab ${EXT_SVG}</a>
          </div>
          <div class="ports-vnotice" id="ports-vnotice" hidden></div>
          <iframe
            id="ports-iframe"
            class="ports-iframe"
            title="Live community port"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerpolicy="no-referrer"
          ></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    tipEl = overlay.querySelector("#ports-tip");
    bindOverlayEvents();
    return overlay;
  }

  function bindOverlayEvents() {
    const searchInput = overlay.querySelector("#ports-search");
    searchInput.addEventListener("input", () => {
      ui.query = searchInput.value;
      renderDirectory();
      map?.setPorts(allPorts(), filteredPorts());
    });

    const addForm = overlay.querySelector("#ports-add-form");
    const addErr = overlay.querySelector("#ports-add-err");
    const submitCustom = (openNow) => {
      addErr.hidden = true;
      const fd = new FormData(addForm);
      const rawUrl = String(fd.get("url") || "").trim();
      const parsed = parseSafeUrl(rawUrl);
      if (!parsed) {
        addErr.textContent = "Enter a valid http:// or https:// URL.";
        addErr.hidden = false;
        return;
      }
      const rawName = String(fd.get("name") || "").trim();
      const rawIso = String(fd.get("country") || "").trim().toUpperCase();
      const isoList = /^[A-Z]{2}$/.test(rawIso) ? [rawIso] : [];
      const fallbackName = parsed.hostname + (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "");
      const id = `custom-${Date.now().toString(36)}`;
      const entry = {
        id,
        name: rawName || fallbackName,
        emblem: "🌐",
        status: "custom",
        scope: "country",
        region: "Custom",
        countries: isoList,
        center: null,
        languages: [],
        license: null,
        repo: null,
        author: "Custom URL",
        url: parsed.href,
        embed: true,
        description: "User-added unmerged port URL (saved locally in this browser).",
      };
      customPorts = [entry, ...customPorts];
      saveCustomPorts(customPorts);
      addForm.reset();
      setAddFormOpen(false);
      renderAll();
      if (openNow) openPort(entry);
      else app.ui.toast?.(`Saved "${entry.name}" to All Ports`);
    };
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitCustom(true);
    });

    const vSwitch = overlay.querySelector("#ports-vswitch");
    vSwitch.addEventListener("change", () => {
      const port = allPorts().find((p) => p.id === vSwitch.value);
      if (!port) return;
      if (port.status === "merged" && port.editionId) {
        if (port.editionId === EDITION_ID) app.setMode(null);
        else location.assign(editionHref(port.editionId));
      } else {
        openPort(port);
      }
    });

    const iframe = overlay.querySelector("#ports-iframe");
    iframe.addEventListener("load", () => {
      const loading = overlay.querySelector("#ports-vloading");
      if (loading && iframe.src && iframe.src !== "about:blank") loading.hidden = true;
    });

    overlay.addEventListener("click", (e) => {
      const btnEl = e.target.closest("button");
      if (!btnEl) return;
      const act = btnEl.dataset.act;
      if (act === "close") return app.setMode(null);
      if (act === "back-atlas") return closeViewer();
      if (act === "zoom-in") return map?.zoomBy(1.45);
      if (act === "zoom-out") return map?.zoomBy(1 / 1.45);
      if (act === "zoom-reset") return map?.resetView();
      if (act === "clear-country") {
        ui.selectedCountry = null;
        ui.selectedCountryName = null;
        map?.setSelectedCountry(null);
        renderDirectory();
        return;
      }
      if (act === "toggle-add") return setAddFormOpen(!ui.addFormOpen);
      if (act === "cancel-add") return setAddFormOpen(false);
      if (act === "save-custom") return submitCustom(false);
      if (act === "reload-frame") {
        const frame = overlay.querySelector("#ports-iframe");
        const cur = allPorts().find((p) => p.id === ui.activePortId);
        if (frame && cur?.url) loadIframeForPort(cur);
        return;
      }
      if (act === "dismiss-notice") {
        overlay.querySelector("#ports-vnotice").hidden = true;
        return;
      }
      if (btnEl.dataset.mtab) {
        ui.mobileTab = btnEl.dataset.mtab;
        syncMobileTabs();
        return;
      }
      if (btnEl.dataset.status) {
        ui.statusFilter = btnEl.dataset.status;
        renderAll();
        return;
      }
      if (btnEl.dataset.region) {
        ui.regionFilter = btnEl.dataset.region;
        renderAll();
        return;
      }
      if (btnEl.dataset.openPort) {
        const p = allPorts().find((x) => x.id === btnEl.dataset.openPort);
        if (p) openPort(p);
        return;
      }
      if (btnEl.dataset.switchEdition) {
        const edId = btnEl.dataset.switchEdition;
        if (edId === EDITION_ID) app.setMode(null);
        else location.assign(editionHref(edId));
        return;
      }
      if (btnEl.dataset.removeCustom) {
        const id = btnEl.dataset.removeCustom;
        customPorts = customPorts.filter((x) => x.id !== id);
        saveCustomPorts(customPorts);
        if (ui.activePortId === id) closeViewer();
        renderAll();
        return;
      }
    });

    // Hovering a directory card highlights its country footprint & pin on the world map.
    const listEl = overlay.querySelector("#ports-list");
    listEl.addEventListener("pointerover", (e) => {
      const card = e.target.closest(".port-card");
      map?.setHighlightPort(card?.dataset.portId || null);
    });
    listEl.addEventListener("pointerleave", () => map?.setHighlightPort(null));

    // Keep map keyboard shortcuts from leaking to the background EarthCiv canvas while the atlas is open.
    window.addEventListener("keydown", (e) => {
      if (app.mode !== MODE || !overlay || overlay.hidden) return;
      if (e.key === "Escape") return; // handled by modes.escape() -> onEscape()
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (inField) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        if (!ui.activePortId) {
          e.preventDefault();
          e.stopImmediatePropagation();
          overlay.querySelector("#ports-search")?.focus();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === "/" && !ui.activePortId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        overlay.querySelector("#ports-search")?.focus();
      } else if ((k === "+" || k === "=") && !ui.activePortId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        map?.zoomBy(1.35);
      } else if ((k === "-" || k === "_") && !ui.activePortId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        map?.zoomBy(1 / 1.35);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "a", "s", "d", "l", "r"].includes(k)) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function setAddFormOpen(open) {
    ui.addFormOpen = !!open;
    const form = overlay.querySelector("#ports-add-form");
    const toggle = overlay.querySelector('[data-act="toggle-add"]');
    const err = overlay.querySelector("#ports-add-err");
    form.hidden = !ui.addFormOpen;
    if (err) err.hidden = true;
    toggle?.setAttribute("aria-expanded", String(ui.addFormOpen));
    if (ui.addFormOpen) form.querySelector('input[name="url"]')?.focus();
  }

  function syncMobileTabs() {
    overlay.dataset.mtab = ui.mobileTab;
    overlay.querySelectorAll("[data-mtab]").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.mtab === ui.mobileTab));
    });
    if (ui.mobileTab === "map") map?.resize();
  }

  // --- rendering -------------------------------------------------------------------------------------------------
  function renderStats() {
    const all = allPorts();
    const nMerged = all.filter((p) => p.status === "merged").length;
    const nLive = all.filter((p) => p.status === "live" || p.status === "custom").length;
    const nRepo = all.filter((p) => p.status === "repo").length;
    const nCountries = new Set(all.flatMap((p) => p.countries || [])).size;
    overlay.querySelector("#ports-stats").innerHTML = `
      <span class="ps-pill ps-merged"><b>${nMerged}</b> merged</span>
      <span class="ps-pill ps-live"><b>${nLive}</b> live unmerged</span>
      <span class="ps-pill ps-repo"><b>${nRepo}</b> source-only</span>
      <span class="ps-pill"><b>${nCountries}</b> countries</span>
    `;
  }

  function renderFilters() {
    const all = allPorts();
    const counts = {
      all: all.length,
      merged: all.filter((p) => p.status === "merged").length,
      live: all.filter((p) => p.status === "live" || p.status === "custom").length,
      repo: all.filter((p) => p.status === "repo").length,
      custom: customPorts.length,
    };
    const statusDefs = [
      ["all", `All (${counts.all})`],
      ["merged", `Merged (${counts.merged})`],
      ["live", `Live (${counts.live})`],
      ["repo", `Repo (${counts.repo})`],
      ...(counts.custom ? [["custom", `Custom (${counts.custom})`]] : []),
    ];
    overlay.querySelector("#ports-status-pills").innerHTML = statusDefs
      .map(([k, lbl]) => `<button type="button" class="ports-pill" data-status="${k}" aria-pressed="${ui.statusFilter === k}">${esc(lbl)}</button>`)
      .join("");

    const regions = ["all", "Americas", "Europe", "Asia", "Middle East"];
    overlay.querySelector("#ports-region-pills").innerHTML = regions
      .map((r) => `<button type="button" class="ports-pill" data-region="${esc(r)}" aria-pressed="${ui.regionFilter === r}">${esc(r === "all" ? "All regions" : r)}</button>`)
      .join("");
  }

  function renderCard(p) {
    const st = statusMeta(p);
    const scope = scopeLabel(p, map);
    const langs = (p.languages || []).length ? p.languages.join("/").toUpperCase() : "";
    const repoUrl = p.repo ? `https://github.com/${encodeURI(p.repo)}` : null;

    let actions = "";
    if (p.status === "merged" && p.editionId) {
      const current = p.editionId === EDITION_ID;
      actions = `<button type="button" class="ports-btn ${current ? "ports-btn-active" : "ports-btn-primary"}" data-switch-edition="${esc(p.editionId)}">${current ? "Return to map" : "Switch edition"}</button>`;
    } else if ((p.status === "live" || p.status === "custom") && p.url) {
      if (p.embed) {
        actions += `<button type="button" class="ports-btn ports-btn-primary" data-open-port="${esc(p.id)}">View inside</button>`;
        actions += `<a class="ports-btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Open in a new browser tab">New tab ${EXT_SVG}</a>`;
      } else {
        actions += `<a class="ports-btn ports-btn-primary" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open site ${EXT_SVG}</a>`;
      }
    }
    if (repoUrl && p.status !== "merged") {
      actions += `<a class="ports-btn ports-btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(p.repo)}">GitHub ${EXT_SVG}</a>`;
    }
    if (p.status === "custom") {
      actions += `<button type="button" class="ports-btn ports-btn-ghost ports-rm" data-remove-custom="${esc(p.id)}" title="Remove custom URL">✕</button>`;
    }

    return `
      <article class="port-card ${st.cls}" data-port-id="${esc(p.id)}">
        <div class="pc-top">
          <span class="pc-emblem" aria-hidden="true">${esc(p.emblem || "🌍")}</span>
          <div class="pc-head">
            <div class="pc-title-row">
              <h3>${esc(p.name)}</h3>
              <span class="pc-badge ${st.cls}">${esc(st.label)}</span>
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
      </article>
    `;
  }

  function renderDirectory() {
    const bar = overlay.querySelector("#ports-country-bar");
    if (ui.selectedCountry) {
      bar.hidden = false;
      const cname = ui.selectedCountryName || map?.getCountryName(ui.selectedCountry) || ui.selectedCountry;
      bar.innerHTML = `<span>Filtered to <b>${esc(cname)}</b></span><button type="button" class="ports-btn ports-btn-ghost" data-act="clear-country">Show all ×</button>`;
    } else {
      bar.hidden = true;
    }

    const list = filteredPorts();
    const host = overlay.querySelector("#ports-list");
    if (!list.length) {
      const msg = ui.selectedCountry
        ? `No ports catalogued for ${ui.selectedCountryName || ui.selectedCountry} yet.`
        : "No ports match the current filter.";
      host.innerHTML = `
        <div class="ports-empty">
          <p><b>${esc(msg)}</b></p>
          <p class="muted">Have a live community port or local build? Click <b>+ URL</b> above to preview any unmerged port directly inside EarthCiv.</p>
          ${ui.selectedCountry ? `<button type="button" class="ports-btn" data-act="clear-country">Show all ports</button>` : ""}
        </div>`;
      return;
    }

    // Group in clean order: Merged first, then Live (embeddable + external) + Custom, then Source-only repos.
    const order = { merged: 0, custom: 1, live: 2, repo: 3 };
    const sorted = list.slice().sort((a, b) => {
      const oa = order[a.status] ?? 9;
      const ob = order[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      if (a.status === "live" && b.status === "live" && a.embed !== b.embed) return a.embed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    host.innerHTML = sorted.map(renderCard).join("");
  }

  function renderAll() {
    syncLaunchCount();
    renderStats();
    renderFilters();
    renderDirectory();
    map?.setPorts(allPorts(), filteredPorts());
  }

  // --- map hover tooltip -----------------------------------------------------------------------------------------
  function showMapTip(info) {
    if (!tipEl) return;
    if (!info) {
      tipEl.hidden = true;
      return;
    }
    const lines = [];
    if (info.port) {
      const st = statusMeta(info.port);
      lines.push(`<div class="pt-head"><span>${esc(info.port.emblem || "🌍")}</span><b>${esc(info.port.name)}</b></div>`);
      lines.push(`<div class="pt-sub">${esc(st.label)}${info.port.author ? ` · ${esc(info.port.author)}` : ""}</div>`);
      if (info.country && info.ports.length > 1) {
        lines.push(`<div class="pt-more">${esc(info.country.name)} has ${info.ports.length} ports — click to view</div>`);
      } else {
        const hint = info.port.status === "merged"
          ? "Click to open edition"
          : info.port.status === "live" && info.port.embed
            ? "Click to view inside EarthCiv"
            : "Click for details";
        lines.push(`<div class="pt-more">${esc(hint)}</div>`);
      }
    } else if (info.country) {
      lines.push(`<div class="pt-head"><b>${esc(info.country.name)}</b></div>`);
      if (info.ports.length) {
        const preview = info.ports.slice(0, 4).map((p) => `${p.emblem || "•"} ${p.name}`).join(" · ");
        lines.push(`<div class="pt-sub">${info.ports.length} port${info.ports.length === 1 ? "" : "s"}: ${esc(preview)}${info.ports.length > 4 ? ` +${info.ports.length - 4}` : ""}</div>`);
        lines.push(`<div class="pt-more">Click to filter directory</div>`);
      } else {
        lines.push(`<div class="pt-sub">No port catalogued yet</div>`);
      }
    }
    tipEl.innerHTML = lines.join("");
    tipEl.hidden = false;
    const wrap = tipEl.parentElement.getBoundingClientRect();
    const tw = tipEl.offsetWidth || 200;
    const th = tipEl.offsetHeight || 54;
    let left = info.x - wrap.left + 14;
    let top = info.y - wrap.top + 14;
    if (left + tw > wrap.width - 8) left = Math.max(8, info.x - wrap.left - tw - 14);
    if (top + th > wrap.height - 8) top = Math.max(8, info.y - wrap.top - th - 14);
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  }

  // --- embedded viewer for unmerged live ports -------------------------------------------------------------------
  function populateViewerSwitcher(activeId) {
    const sel = overlay.querySelector("#ports-vswitch");
    const all = allPorts();
    const merged = all.filter((p) => p.status === "merged");
    const live = all.filter((p) => p.status === "live" && p.embed && p.url);
    const custom = all.filter((p) => p.status === "custom" && p.url);

    const groupHtml = (label, items) => {
      if (!items.length) return "";
      return `<optgroup label="${esc(label)}">${items.map((p) => `<option value="${esc(p.id)}"${p.id === activeId ? " selected" : ""}>${esc(p.emblem || "")} ${esc(p.name)}</option>`).join("")}</optgroup>`;
    };
    sel.innerHTML =
      groupHtml("Built-in EarthCiv Editions (Merged)", merged) +
      groupHtml("Live Community Ports (Unmerged)", live) +
      groupHtml("Custom Preview URLs", custom);
    sel.value = activeId;
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
      notice.innerHTML = `<span><b>${esc(port.name)}</b> uses plain HTTP and browsers block HTTP frames inside an HTTPS page.</span>
        <a class="ports-btn ports-btn-primary" href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Open in new tab ${EXT_SVG}</a>`;
      return;
    }

    loadingTxt.textContent = `Surveying ${port.name}…`;
    loadingExt.href = parsed.href;
    loading.hidden = false;
    notice.hidden = false;
    notice.innerHTML = `<span>Viewing external unmerged community port from <b>${esc(parsed.host)}</b> — not yet merged into EarthCiv.</span>
      <div class="ports-vnotice-actions">
        <a class="ports-btn" href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Open in new tab ${EXT_SVG}</a>
        <button type="button" class="ports-btn ports-btn-ghost" data-act="dismiss-notice" aria-label="Dismiss notice">✕</button>
      </div>`;
    iframe.title = `${port.name} (unmerged community port)`;
    iframe.src = parsed.href;
  }

  function openPort(port) {
    if (!port) return;
    if (port.status === "merged" && port.editionId) {
      if (port.editionId === EDITION_ID) app.setMode(null);
      else location.assign(editionHref(port.editionId));
      return;
    }
    if ((port.status === "live" || port.status === "custom") && port.url && port.embed) {
      ui.activePortId = port.id;
      const viewer = overlay.querySelector("#ports-viewer");
      const atlas = overlay.querySelector(".ports-atlas");
      const st = statusMeta(port);
      overlay.querySelector("#ports-vtitle").innerHTML = `
        <span class="pv-emblem" aria-hidden="true">${esc(port.emblem || "🌍")}</span>
        <span class="pv-name">${esc(port.name)}</span>
        <span class="pc-badge ${st.cls}">${esc(st.label)}</span>
      `;
      const repoUrl = port.repo ? `https://github.com/${encodeURI(port.repo)}` : null;
      overlay.querySelector("#ports-vactions").innerHTML = `
        <button type="button" class="ports-btn ports-btn-ghost" data-act="reload-frame" title="Reload frame">↻</button>
        ${repoUrl ? `<a class="ports-btn ports-btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${EXT_SVG}</a>` : ""}
        <a class="ports-btn" href="${esc(port.url)}" target="_blank" rel="noopener noreferrer" title="Open in a new browser tab">New tab ${EXT_SVG}</a>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close All Ports (Esc)" title="Close">${icon("close", "✕", { size: 12 })}</button>
      `;
      populateViewerSwitcher(port.id);
      atlas.hidden = true;
      viewer.hidden = false;
      loadIframeForPort(port);
      app.hash.soon();
      return;
    }
    if (port.url) {
      window.open(port.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (port.repo) {
      window.open(`https://github.com/${encodeURI(port.repo)}`, "_blank", "noopener,noreferrer");
    }
  }

  function closeViewer() {
    if (!overlay || !ui.activePortId) return false;
    ui.activePortId = null;
    const iframe = overlay.querySelector("#ports-iframe");
    if (iframe) iframe.src = "about:blank";
    overlay.querySelector("#ports-viewer").hidden = true;
    overlay.querySelector(".ports-atlas").hidden = false;
    map?.resize();
    app.hash.soon();
    return true;
  }

  // --- mode & URL hash -------------------------------------------------------------------------------------------
  let mountToken = 0;

  app.registerMode(MODE, {
    async enter(params = {}) {
      const tok = ++mountToken;
      ensureOverlay();
      overlay.hidden = false;
      overlay.querySelector(".ports-atlas").hidden = false;
      overlay.querySelector("#ports-viewer").hidden = true;
      syncMobileTabs();

      try {
        const data = await loadCatalog();
        if (tok !== mountToken || app.mode !== MODE) return;
        if (!map) {
          map = createWorldMap({
            canvas: overlay.querySelector("#ports-world-canvas"),
            outlines: data.outlines,
            onHover: showMapTip,
            onSelectCountry(country, matching) {
              if (!country) {
                ui.selectedCountry = null;
                ui.selectedCountryName = null;
                map.setSelectedCountry(null);
                renderDirectory();
                return;
              }
              ui.selectedCountry = country.id;
              ui.selectedCountryName = country.name;
              map.setSelectedCountry(country.id);
              renderDirectory();
              if (matchMedia("(max-width: 900px)").matches) {
                ui.mobileTab = "list";
                syncMobileTabs();
              } else if (matching.length) {
                overlay.querySelector("#ports-list")?.scrollTo({ top: 0, behavior: "smooth" });
              }
            },
            onSelectPort(port) {
              if (port.status === "live" && port.embed && port.url) {
                openPort(port);
              } else if (port.status === "merged" && port.editionId) {
                if (port.editionId === EDITION_ID) app.setMode(null);
                else location.assign(editionHref(port.editionId));
              } else if (port.countries?.length === 1) {
                ui.selectedCountry = port.countries[0];
                ui.selectedCountryName = map.getCountryName(port.countries[0]);
                map.setSelectedCountry(port.countries[0]);
                renderDirectory();
              } else {
                ui.query = port.name;
                overlay.querySelector("#ports-search").value = port.name;
                renderDirectory();
              }
            },
          });
        }
        renderAll();
        map.resize();
        if (params?.id && params.id !== "all") {
          const target = allPorts().find((p) => p.id === params.id);
          if (target && (target.status === "live" || target.status === "custom") && target.embed && target.url) {
            openPort(target);
          } else if (target) {
            ui.query = target.name;
            overlay.querySelector("#ports-search").value = target.name;
            renderAll();
          }
        }
      } catch (err) {
        console.error("ports atlas failed to load", err);
        overlay.querySelector("#ports-list").innerHTML = `<div class="ports-empty"><p><b>Could not load ports catalog.</b></p><p class="muted">${esc(err.message || String(err))}</p></div>`;
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
      overlay.hidden = true;
      showMapTip(null);
    },
    onEscape() {
      // First Esc returns from an embedded port back to the World Atlas; second Esc closes the overlay.
      if (ui.activePortId) {
        closeViewer();
        return true;
      }
      return false;
    },
  });

  app.hash.register("ports", {
    get() {
      if (app.mode !== MODE) return null;
      return ui.activePortId || "all";
    },
    set(v) {
      if (!v) {
        if (app.mode === MODE) app.setMode(null);
        return;
      }
      if (app.mode === MODE) {
        if (v === "all") closeViewer();
        else {
          const p = allPorts().find((x) => x.id === v);
          if (p) openPort(p);
        }
      } else {
        app.setMode(MODE, { id: v });
      }
    },
  });

  app.portsAtlas = {
    open: (id = null) => app.setMode(MODE, { id }),
    close: () => app.mode === MODE && app.setMode(null),
    loadCatalog,
  };
}
