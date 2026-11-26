// The world map as EarthCiv's home page (app/home.js decides when a page load opens on it; boot.js calls
// openWorldHome()). No edition is loaded: the world view (index.js) runs on a small stand-in for the `app` object that
// main.js builds for an edition, with the same modes, URL hash and events, and every edition it opens is a page load
// of ?country=<id>.
import { createEmitter, createHashState, createModes } from "../../app/api.js";
import { REQUESTED_PICK } from "../../app/home.js";
import { install } from "./index.js";

export async function openWorldHome() {
  // Tidy the address before anything reads it: ?country=fr (not a built-in edition) becomes #country=FR, and the old
  // atlas link's #ports=all is simply the home page.
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  let tidy = false;
  if (REQUESTED_PICK) {
    search.delete("country");
    hash.set("country", REQUESTED_PICK);
    tidy = true;
  }
  if (hash.get("ports") === "all") {
    hash.delete("ports");
    tidy = true;
  }
  if (tidy) {
    const query = search.toString();
    const frag = hash.toString();
    try {
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${frag ? `#${frag}` : ""}`);
    } catch {
      /* some sandboxes forbid history writes */
    }
  }

  const app = {};
  const events = createEmitter();
  const modes = createModes(app);
  const url = createHashState({ read: () => ({}), apply() {} });

  const toastEl = document.getElementById("toast");
  let toastTimer = 0;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
  };

  Object.assign(app, {
    worldHome: true, // no edition underneath: the world view is the page (an edition's app has a home() method)
    on: events.on,
    off: events.off,
    emit: events.emit,
    registerMode: modes.registerMode,
    setMode: modes.setMode,
    hasMode: modes.hasMode,
    hash: { register: url.register, update: url.schedule, soon: url.soon, flush: url.flush, value: url.value },
    ui: { toast, addTopButton: () => null },
    requestDraw() {},
    isMobile: () => matchMedia("(max-width: 700px)").matches,
  });
  Object.defineProperties(app, {
    mode: { get: () => modes.mode, enumerable: true },
    modeParams: { get: () => modes.modeParams, enumerable: true },
  });
  window.__app = app;

  document.body.classList.add("world-home");
  try {
    // install() registers the hash keys, which open a map or pick a country named in the URL once the world loads.
    await install(app);
    if (app.mode !== "ports") app.setMode("ports", {});
  } catch (err) {
    document.body.classList.remove("world-home");
    throw err;
  }

  // Esc steps back inside the world view (an open map, the search, the picked country); there is nothing to close
  // the world view onto.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) modes.escape();
  });
  document.getElementById("loading")?.remove();
}
