// Browser harness, page side (docs/HARNESS.md): lists the views to record for an edition, opens one, waits until
// the page is still, and reads what a visitor sees.
//
// A classic script with no imports, so it can run in any page: the Python runner (python -m harness) adds it to every
// page before the app's own scripts, and dev/snap.html uses it on an iframe for a run by hand. Every function takes
// the app's window. It relies only on window.__app, the URL hash and the DOM, so it also runs against the unmodified
// upstream site.
(function () {
  "use strict";
  const S = (window.__snap = window.__snap || {});
  const EAGER = ["infrastructure", "military", "wonders", "trade"];
  const ZOOMS = [1, 2, 3.5]; // log2(scale / home scale): about mid, near and close detail on a 25 km grid
  const PHONE_VIEWS = ["home", "lens-first", "city-largest", "advisor-economy", "cityview-largest"];

  // --- quiet detection: animation frames and fetches still outstanding -----------------------------------------
  // Installed before the app's scripts run (the runner adds this file as an init script), so the app's own
  // requestAnimationFrame and fetch calls are counted.
  S.instrument = function (win) {
    if (win.__snapActivity) return win.__snapActivity;
    const st = (win.__snapActivity = { frames: new Set(), fetching: 0, last: win.performance.now() });
    const touch = () => { st.last = win.performance.now(); };
    const raf = win.requestAnimationFrame.bind(win), caf = win.cancelAnimationFrame.bind(win);
    win.requestAnimationFrame = (cb) => {
      const id = raf((t) => { st.frames.delete(id); touch(); cb(t); });
      st.frames.add(id);
      touch();
      return id;
    };
    win.cancelAnimationFrame = (id) => { st.frames.delete(id); caf(id); };
    const fetch0 = win.fetch.bind(win);
    win.fetch = (...args) => {
      st.fetching++;
      touch();
      return fetch0(...args).finally(() => { st.fetching--; touch(); });
    };
    // Scrolling is instant while recording: a smooth scroll ends in the same place, but a capture taken during it
    // would depend on timing (the City View marks the section in view as the dock scrolls).
    const instant = (args) => (args[0] && typeof args[0] === "object" ? [{ ...args[0], behavior: "instant" }, ...args.slice(1)] : args);
    for (const target of [win.Element.prototype, win]) {
      for (const m of ["scrollTo", "scrollBy", "scrollIntoView"]) {
        const f = target[m];
        if (typeof f === "function") target[m] = function (...args) { return f.apply(this, instant(args)); };
      }
    }
    const noSmooth = () => {
      const s = win.document.createElement("style");
      s.textContent = "*, *::before, *::after { scroll-behavior: auto !important; }";
      win.document.head.appendChild(s);
    };
    if (win.document.head) noSmooth();
    else win.document.addEventListener("DOMContentLoaded", noSmooth, { once: true });
    win.addEventListener("scroll", touch, true);
    return st;
  };
  S.instrument(window);

  const sleep = (win, ms) => new Promise((r) => win.setTimeout(r, ms));

  /** Resolves with window.__app once the map, the extensions and the eager map-layer files are in. */
  S.ready = async function (win, timeoutMs = 45000) {
    const t0 = win.performance.now();
    for (;;) {
      const doc = win.document, app = win.__app;
      const err = doc.querySelector("#loading.error");
      if (err) throw new Error(err.textContent);
      if (app && app.extensions && !doc.getElementById("loading") && EAGER.every((n) => app.data[n] !== undefined)) return app;
      if (win.performance.now() - t0 > timeoutMs) throw new Error("the app did not become ready");
      await sleep(win, 50);
    }
  };

  /** Resolves true once nothing has moved, drawn or loaded for `quietMs` (false after `timeoutMs`). */
  S.idle = async function (win, { quietMs = 500, timeoutMs = 30000 } = {}) {
    const t0 = win.performance.now();
    if (win.document.fonts) await win.document.fonts.ready;
    for (;;) {
      const st = win.__snapActivity, app = win.__app, now = win.performance.now();
      const images = [...win.document.images].every((im) => im.complete);
      const busy = !images || (app && app.cam && app.cam.moving) ||
        (st ? st.frames.size > 0 || st.fetching > 0 || now - st.last < quietMs : now - t0 < 1500);
      if (!busy) return true;
      if (now - t0 > timeoutMs) return false;
      await sleep(win, 50);
    }
  };

  // --- the views ------------------------------------------------------------------------------------------------
  /** The views to record for the edition open in `win`, chosen from its data so the list follows the data. */
  S.views = async function (win) {
    const app = await S.ready(win);
    const doc = win.document, d = app.data;
    const cities = d.cities || [], states = Array.isArray(d.states) ? d.states : [];
    const views = [];
    const add = (id, o = {}) => views.push({ id, hash: "", viewport: "desktop", steps: [], ...o });

    add("home");
    const places = [cities[0], cities[Math.min(9, cities.length - 1)], cities[Math.min(49, cities.length - 1)]];
    places.forEach((c, k) => {
      if (!c) return;
      for (const z of ZOOMS) add(`zoom-${k + 1}-${z}`, { hash: `#at=${Math.round(c.x)},${Math.round(c.y)},${z}`, note: c.name });
    });
    const lenses = (d.lenses && d.lenses.lenses) || [];
    for (const l of lenses) add(`lens-${l.id}`, { hash: `#lens=${encodeURIComponent(l.id)}` });

    // Cities: the largest, the median, the first without a survey unemployment rate, the first in two regions.
    const picked = new Map();
    const pick = (key, c) => { if (c && ![...picked.values()].includes(c)) picked.set(key, c); };
    pick("largest", cities[0]);
    pick("median", cities[Math.floor(cities.length / 2)]);
    pick("no-unemployment", cities.find((c) => c.unemployment == null));
    pick("two-regions", cities.find((c) => (c.states || []).length > 1 && ![...picked.values()].includes(c)));
    for (const [key, c] of picked) add(`city-${key}`, { hash: `#city=${encodeURIComponent(c.id)}`, note: c.name });

    // Regions: the most populous, the median and the least populous.
    const byPop = states.map((s, i) => ({ s, i })).filter((x) => Number.isFinite(x.s.population)).sort((a, b) => b.s.population - a.s.population);
    const regionRef = (s) => s.abbr || s.fips || s.name;
    [["largest", byPop[0]], ["median", byPop[Math.floor(byPop.length / 2)]], ["smallest", byPop[byPop.length - 1]]]
      .forEach(([key, x]) => { if (x) add(`region-${key}`, { hash: `#state=${encodeURIComponent(regionRef(x.s))}`, note: x.s.name }); });

    // Top-bar reports, each on both tabs.
    for (const b of doc.querySelectorAll("#yields [data-report]")) {
      const key = b.getAttribute("data-report");
      for (const tab of ["states", "metros"]) add(`report-${key}-${tab}`, { steps: [{ do: "report", key, tab }] });
    }

    // City View: four cities, and every section of the largest.
    const open = (c) => ({ do: "cityview", id: c.id });
    for (const [key, c] of picked) add(`cityview-${key}`, { hash: `#city=${encodeURIComponent(c.id)}&view=city`, steps: [open(c)], note: c.name });
    for (const tab of ["citizens", "districts", "economy", "workforce", "resources", "compare"]) {
      add(`cityview-largest-${tab}`, { hash: `#city=${encodeURIComponent(cities[0].id)}&view=city`,
        steps: [open(cities[0]), { do: "click", sel: `.cv-tabs [data-tab="${tab}"]`, optional: true }] });
    }

    // Advisors: the council and each advisor this edition offers.
    add("advisor-council", { hash: "#advisor=council" });
    for (const a of (app.advisors && app.advisors.list) || []) add(`advisor-${a.id}`, { hash: `#advisor=${a.id}` });

    // Almanac pages, help, search and share.
    if (app.pedia) {
      app.pedia.open();
      const pages = [...doc.querySelectorAll("#pedia-nav button")].map((b) => b.textContent.trim()).filter(Boolean);
      app.pedia.close();
      pages.forEach((p, k) => add(`almanac-${k + 1}`, { steps: [{ do: "pedia", page: p }], note: p }));
    }
    add("help", { steps: [{ do: "help" }] });
    if (cities[0]) add("search", { steps: [{ do: "search", q: cities[0].name.slice(0, 3) }] });
    add("share", { steps: [{ do: "share" }] });

    // A phone-sized window for the main views.
    const firstLens = lenses[0];
    for (const id of PHONE_VIEWS) {
      const base = id === "lens-first" ? (firstLens && views.find((v) => v.id === `lens-${firstLens.id}`)) : views.find((v) => v.id === id);
      if (base) views.push({ ...base, id: `phone-${id}`, viewport: "phone" });
    }
    return views;
  };

  /** Performs a view's steps on a freshly loaded page whose URL already carries the view's hash. */
  S.apply = async function (win, view) {
    const app = await S.ready(win);
    await S.idle(win);
    const doc = win.document;
    for (const s of view.steps || []) {
      if (s.do === "report") {
        const b = doc.querySelector(`#yields [data-report="${s.key}"]`);
        if (!b) throw new Error(`no report button ${s.key}`);
        b.click();
        await S.idle(win);
        const t = doc.getElementById(`yr-tab-${s.tab}`);
        if (t && !t.disabled && t.getAttribute("aria-selected") !== "true") t.click();
      } else if (s.do === "pedia") {
        app.pedia.open(s.page);
      } else if (s.do === "help") {
        app.help.open();
      } else if (s.do === "search") {
        const input = doc.getElementById("search-input");
        input.focus();
        input.value = s.q;
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
      } else if (s.do === "share") {
        doc.getElementById("btn-share").click();
      } else if (s.do === "cityview") {
        // A #city=…&view=city link does not always open the City View (the extension can register its hash key
        // before the link's city is selected), so open it directly; the URL still carries the link.
        if (app.mode !== "city") {
          app.selectCity(s.id, { fly: false });
          app.setMode("city", { id: s.id });
        }
      } else if (s.do === "click") {
        const el = doc.querySelector(s.sel);
        if (!el && !s.optional) throw new Error(`nothing matches ${s.sel}`);
        if (el) el.click();
      } else {
        throw new Error(`unknown step ${s.do}`);
      }
      await S.idle(win);
    }
    return true;
  };

  // --- what a visitor sees ----------------------------------------------------------------------------------------
  const ATTRS = ["role", "aria-label", "aria-selected", "aria-pressed", "aria-checked", "aria-expanded", "title", "alt",
    "placeholder", "href", "disabled", "hidden"];

  function hash(str) { // FNV-1a, enough to tell two SVG drawings apart
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  /** One line per rendered element: tag, id, classes, the attributes a visitor reads, and its own text. */
  function outline(win, root) {
    const lines = [];
    const walk = (el, depth) => {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag)) return;
      const cs = win.getComputedStyle(el);
      if (cs.display === "none") return;
      let line = "  ".repeat(depth) + tag + (el.id ? `#${el.id}` : "");
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      if (cls.length) line += "." + cls.join(".");
      if (cs.visibility === "hidden") line += " [invisible]";
      for (const a of ATTRS) if (el.hasAttribute(a)) line += ` ${a}=${JSON.stringify(el.getAttribute(a))}`;
      if (tag === "svg") {
        lines.push(`${line} drawing=${hash(el.outerHTML)} text=${JSON.stringify(el.textContent.replace(/\s+/g, " ").trim())}`);
        return;
      }
      if (tag === "canvas") {
        lines.push(`${line} size=${el.width}x${el.height}`);
        return;
      }
      if (tag === "input" || tag === "select" || tag === "textarea") line += ` value=${JSON.stringify(el.value)}`;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
      if (own) line += " " + JSON.stringify(own);
      lines.push(line);
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(root, 0);
    return lines.join("\n");
  }

  /** What the page shows now: title, URL hash, visible text and the element outline. */
  S.capture = function (win) {
    const doc = win.document;
    return { title: doc.title, hash: win.location.hash, text: doc.body.innerText, outline: outline(win, doc.body) };
  };
})();
