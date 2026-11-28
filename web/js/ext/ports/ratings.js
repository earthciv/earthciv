// Star ratings of the maps in the world view (./index.js): each map's average out of five and how many people rated
// it, and five stars with which a visitor gives, changes or takes back their own rating.
//
//   * The ratings are read from data/ratings.json. On EarthCiv's own site a Cloudflare Pages Function answers at
//     that address (functions/data/ratings.json.js, docs/RATINGS.md). Anywhere else it is a static file that says
//     ratings are not open, and the world view then shows no stars at all.
//   * The server counts one rating per map from each network and never sees a name or an account. Which stars this
//     visitor picked is remembered in this browser (localStorage), only to show them again.
//   * A map can be rated here when it opens here: an EarthCiv edition, or a community map shown inside EarthCiv. A
//     map that opens only in a new tab cannot, nor can source code alone or a link a visitor added for themselves.
//   * Shown inside another site's frame, the page offers no stars to click (the averages stay): that site could cover
//     the frame and steer its visitors' clicks onto a star.
//
// This file imports nothing and touches the page only inside sync(), so its rules can be tested outside a browser.

const STORE_KEY = "earthciv.portRatings.v1";
export const SCALE = 5;

const STAR_PATH = "M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z";
const STAR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A map can be rated when it opens inside EarthCiv (the same rule as functions/data/ratings.json.js). */
export function rateable(port) {
  return !!port && (port.status === "merged" || (port.status === "live" && !!port.url && port.embed === true));
}

/** A map's [number of ratings, sum of stars] after one visitor's rating goes from `was` to `now` stars (0: none). */
export function withVote(total, was, now) {
  const [n, sum] = total || [0, 0];
  return [Math.max(0, n - (was ? 1 : 0) + (now ? 1 : 0)), Math.max(0, sum - was + now)];
}

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // some sandboxes forbid storage
  }
}

// The visitor's own ratings as this browser remembers them, or null when there is no storage to read.
function readStored(storage) {
  if (!storage) return null;
  try {
    const saved = JSON.parse(storage.getItem(STORE_KEY) || "{}");
    const mine = {};
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [id, stars] of Object.entries(saved)) {
        if (Number.isInteger(stars) && stars >= 1 && stars <= SCALE) mine[id] = stars;
      }
    }
    return mine;
  } catch {
    return null; // unreadable or forbidden
  }
}

// True when this page is shown in a frame of another site (a frame of this site's own pages does not count).
function inAnotherSitesFrame() {
  const w = globalThis.window;
  if (!w || w.top === w.self) return false;
  try {
    return w.top.location.origin !== w.location.origin;
  } catch {
    return true; // the top page's address cannot be read: it is another site's
  }
}

/**
 * @param {object} options
 * @param {URL|string} options.url       where the ratings are read and sent (data/ratings.json)
 * @param {() => void} [options.onChange] called whenever a total, the visitor's rating or the open state changes
 * @param {typeof fetch} [options.fetchFn]
 * @param {Storage|null} [options.storage]
 * @param {() => boolean} [options.framed] whether the page is inside another site's frame
 */
export function createRatings({ url, onChange = () => {}, fetchFn = null, storage = undefined, framed = inAnotherSitesFrame } = {}) {
  const request = fetchFn || ((...args) => fetch(...args));
  const store = storage === undefined ? browserStorage() : storage;
  const totals = new Map(); // map id → [number of ratings, sum of stars]
  let mine = readStored(store) || {}; // map id → this visitor's stars
  const busy = new Set(); // map ids with a rating on its way to the server
  let open = false; // whether ratings can be given here
  let loaded = false; // whether the totals have been read: until then nothing is known of any map's rating
  let loading = null;

  function setMine(id, stars) {
    // Another tab may have rated other maps since this one last read the list, so change this map's entry in the
    // list as it is stored now.
    mine = readStored(store) || mine;
    if (stars) mine[id] = stars;
    else delete mine[id];
    try {
      store?.setItem(STORE_KEY, JSON.stringify(mine));
    } catch {
      /* storage full or forbidden: the rating still counts, it is just not remembered here */
    }
  }

  // A rating given in another tab shows here too.
  if (store && typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("storage", (e) => {
      if (e.key !== STORE_KEY && e.key !== null) return;
      mine = readStored(store) || {};
      onChange();
    });
  }

  /** Read every map's totals. Never rejects: without them the world view shows no stars. A failed read is retried
   *  the next time this is called. */
  function load() {
    if (!loading) {
      loading = Promise.resolve()
        .then(() => request(url, { headers: { accept: "application/json" } }))
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((doc) => {
          open = doc?.open === true && !framed();
          loaded = true;
          totals.clear();
          for (const [id, total] of Object.entries(doc?.ratings || {})) {
            if (Array.isArray(total) && total[0] > 0) totals.set(id, [Number(total[0]) || 0, Number(total[1]) || 0]);
          }
          onChange();
        })
        .catch((err) => {
          console.warn("could not load the maps' ratings", err);
          loading = null;
        });
    }
    return loading;
  }

  /** What is known about one map: {n, sum, average (null when unrated), mine (0 when unrated), busy}. */
  function of(id) {
    const [n, sum] = totals.get(id) || [0, 0];
    return { n, sum, average: n ? sum / n : null, mine: mine[id] || 0, busy: busy.has(id) };
  }

  /**
   * The visitor picks star `picked` (1 to 5) of a map. That becomes their rating; picking the star that already is
   * their rating takes it back. The stars change at once and then settle on what the server answers, or go back to
   * what they were when it refuses.
   * @returns {Promise<{ok: boolean, stars?: number, changed?: boolean, error?: string}>} stars: their rating now
   *   (0: taken back); changed: false when the server had nothing to change, which for a rating taken back means it
   *   was given from another network and is still counted
   */
  async function choose(id, picked) {
    if (!open || busy.has(id) || !Number.isInteger(picked) || picked < 1 || picked > SCALE) return { ok: false, error: "ignored" };
    const was = mine[id] || 0;
    const now = was === picked ? 0 : picked;
    const before = totals.get(id) || null;
    setMine(id, now);
    totals.set(id, withVote(before, was, now));
    busy.add(id);
    onChange();

    let result;
    try {
      const res = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ port: id, stars: now }),
      });
      const doc = await res.json().catch(() => null);
      if (res.ok && doc?.ok === true && Array.isArray(doc.rating)) {
        totals.set(id, [Number(doc.rating[0]) || 0, Number(doc.rating[1]) || 0]);
        result = { ok: true, stars: now, changed: doc.changed !== false };
      } else {
        result = { ok: false, error: doc?.error || `http_${res.status}` };
      }
    } catch {
      result = { ok: false, error: "network" };
    }
    if (!result.ok) {
      setMine(id, was);
      if (before) totals.set(id, before);
      else totals.delete(id);
      if (result.error === "closed") open = false;
    }
    busy.delete(id);
    onChange();
    return result;
  }

  // ---- the page: every element with data-rating-of="<map id>" is a slot that shows that map's rating ----------------
  function build(el) {
    const stars = Array.from({ length: SCALE }, (_, i) => `<button type="button" class="rt-star" data-stars="${i + 1}">${STAR_SVG}</button>`).join("");
    el.innerHTML = `<span class="rt-avg" role="img"><span class="rt-icon"></span><b class="rt-num"></b><span class="rt-count"></span></span>
      <span class="rt-give" role="group"><span class="rt-lbl"></span><span class="rt-stars">${stars}</span></span>`;
    el.title = ""; // not the card's tooltip
  }

  function paint(el, port) {
    const r = rateable(port) ? of(port.id) : null;
    // Where ratings are not open, a map still shows the average it has.
    const show = !!r && (open || r.n > 0);
    el.hidden = !show;
    if (!show) return;
    if (!el.firstElementChild) build(el);
    el.classList.toggle("is-busy", r.busy);
    el.classList.toggle("is-rated", r.n > 0);

    const avg = el.querySelector(".rt-avg");
    const shown = r.n ? r.average.toFixed(1) : "";
    const summary = r.n ? `Rated ${shown} out of ${SCALE} by ${plural(r.n, "person", "people")}` : "No ratings yet";
    avg.setAttribute("aria-label", summary);
    avg.title = summary;
    avg.querySelector(".rt-num").textContent = shown;
    avg.querySelector(".rt-count").textContent = r.n ? `(${r.n.toLocaleString("en-US")})` : "No ratings yet";

    const give = el.querySelector(".rt-give");
    give.hidden = !open;
    if (!open) return;
    give.setAttribute("aria-label", r.mine ? `Your rating of ${port.name}: ${r.mine} out of ${SCALE}` : `Rate ${port.name}`);
    give.querySelector(".rt-lbl").textContent = r.mine ? "Your rating" : "Rate it";
    for (const btn of give.querySelectorAll(".rt-star")) {
      const k = Number(btn.dataset.stars);
      const isMine = k === r.mine;
      btn.dataset.rate = port.id;
      btn.classList.toggle("on", k <= r.mine);
      btn.setAttribute("aria-pressed", String(isMine));
      btn.setAttribute("aria-label", isMine ? `${plural(k, "star")}, your rating: press to remove it` : plural(k, "star"));
      btn.title = isMine ? `Your rating: ${plural(k, "star")}. Click again to remove it.` : `Rate it ${plural(k, "star")}`;
    }
  }

  /** Fill, or bring up to date, every rating slot inside `root`. `portOf(id)` returns the catalog entry of a map. */
  function sync(root, portOf) {
    if (!root) return;
    for (const el of root.querySelectorAll("[data-rating-of]")) paint(el, portOf(el.dataset.ratingOf));
  }

  return {
    load,
    of,
    choose,
    sync,
    get open() {
      return open;
    },
    /** True once every map's totals have been read (World Rankings' Ratings tab is made from them). */
    get loaded() {
      return loaded;
    },
  };
}
