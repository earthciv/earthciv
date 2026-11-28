// Sharing a map (./index.js): a link to the map's own page, which asks people to rate it, and the ways to send it on.
// A map's maker can post one link that previews as their map and opens it here, with its stars (docs/RATINGS.md,
// "Asking for ratings").
//
//   * Every map that can be rated has a page of its own, /map/<id>/, made with the site (pipeline/share_pages.py).
//     Posted on X or in a chat, it previews as that map: its name, its maker and where it is on the world map, under
//     a call to rate it. Opened, it sends the visitor on to the map here, where its stars are pointed out once
//     (takeArrival).
//   * Where the site was built without those pages (a local server, a copy elsewhere: <html> lacks data-map-pages),
//     the link is the map's own address here instead: the world view with the map open, or the edition.
//   * The popover copies the link, opens X with a post that names the map and its maker's handle, or hands the link
//     to the system's share sheet where there is one. Under them, what the map's ratings are so far. On a phone,
//     where the map's bar has no room for stars, it holds the stars too.
//
// Everything above createMapShare() is plain functions, tested in tests/js/mapShare.test.mjs.

import { rateable } from "./ratings.js";
import { ordinal } from "./rankings.js";

/** Where a map's page notes, for this tab only, which map the visitor came for (app/open-share.js writes it). */
export const ARRIVAL_KEY = "earthciv.arrivedFor.v1";
const ARRIVAL_MS = 2 * 60_000; // a note older than this belongs to an earlier visit

/** A map with a page of its own, and so a Share button: one that can be rated (./ratings.js). */
export const sharable = (port) => rateable(port);

/**
 * The link to share for a map. `root` is the site's own address (where index.html is); `pages` says whether the
 * site was built with the maps' own pages. Without them an edition is linked at ?country=<id>, and a community map
 * as the world view with it open (#ports=<id>).
 */
export function mapLink(port, { root, pages = false }) {
  const base = new URL(root);
  base.search = "";
  base.hash = "";
  if (pages) return new URL(`map/${encodeURIComponent(port.id)}/`, base).href;
  if (port.status === "merged" && port.editionId) base.searchParams.set("country", port.editionId);
  else base.hash = new URLSearchParams({ ports: port.id }).toString();
  return base.href;
}

/** A link as it is read out: no "https://", no "www." (earthciv.org/map/deciv/). */
export const shortLink = (link) => String(link).replace(/^https?:\/\/(www\.)?/, "");

/** What a post about a map says: its name and its maker, by their X handle where the list of maps has one. */
export function postText(port, maker) {
  const by = maker ? ` by ${maker.twitter ? `@${maker.twitter}` : maker.name}` : "";
  return `Rate ${port.name}${by} on EarthCiv`;
}

/** X's page for writing a post, with the words and the link filled in. */
export function xPostUrl(text, link) {
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", text);
  url.searchParams.set("url", link);
  return url.href;
}

/**
 * The line under the ways to share: the map's ratings so far, and its place among the rated maps (World Rankings'
 * Ratings tab, ./rankingsRatings.js), or an empty line where ratings are neither open nor given.
 * @param {{n: number, sum: number}} rating  how many rated the map, and their stars added up
 * @param {{rank: number, of: number, tied: boolean}|null} place
 */
export function ratingSummary({ n = 0, sum = 0 } = {}, place = null, { open = true } = {}) {
  if (!(n > 0)) return open ? "No ratings yet. The link opens the map with its stars, so anyone can rate it." : "";
  const rated = `Rated ${(sum / n).toFixed(1)} out of 5 by ${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
  return place ? `${rated} · ${ordinal(place.rank)} of ${place.of}${place.tied ? " (tied)" : ""} in World Rankings` : rated;
}

/**
 * The map a visitor came for from its page, once: the note is read and removed. Null without a fresh note.
 * @param {Storage|null} storage  sessionStorage
 */
export function takeArrival(storage, now = Date.now()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ARRIVAL_KEY);
    if (raw == null) return null;
    storage.removeItem(ARRIVAL_KEY);
    const note = JSON.parse(raw);
    const age = now - Number(note?.at);
    if (typeof note?.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(note.id)) return null;
    return age >= 0 && age < ARRIVAL_MS ? note.id : null;
  } catch {
    return null; // unreadable, or storage is forbidden here
  }
}

// ---- the popover ---------------------------------------------------------------------------------------------------
const LINK_SVG = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/></svg>`;
// X's own mark (Simple Icons, CC0).
const X_SVG = `<svg class="icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
const SEND_SVG = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-2"/></svg>`;

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused: try the old way */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * The popover, made on first use and shared by every Share button.
 * @param {object} o
 * @param {(port) => string} o.linkOf            the link to share (mapLink)
 * @param {(port) => object|null} o.makerOf      the maker to name in a post (./makers.js makerOf), or null
 * @param {(port) => string} o.summaryOf         the line about its ratings (ratingSummary)
 * @param {(root: Element) => void} o.syncStars  fills the popover's rating slot (ratings.sync)
 * @param {() => void} [o.loadStars]             asks for the ratings, when the popover shows the stars
 * @param {(id: string, stars: number, say: (msg: string) => void) => Promise<object>} o.rate  gives a rating
 */
export function createMapShare({ linkOf, makerOf, summaryOf, syncStars, loadStars = () => {}, rate }) {
  let pop = null;
  let now = null; // {port, button, stars, link}

  function build() {
    pop = document.createElement("div");
    pop.id = "map-share-pop";
    pop.className = "panel share-pop ms-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-labelledby", "ms-title");
    pop.hidden = true;
    pop.innerHTML = `
      <div class="sp-title" id="ms-title"></div>
      <div class="ms-rate" hidden><div class="rt rt-pop" hidden></div></div>
      <p class="ms-sum"></p>
      <button type="button" class="sp-item" data-ms="copy">${LINK_SVG}<span class="ms-item-text">Copy link<small class="ms-link"></small></span></button>
      <a class="sp-item" data-ms="x" target="_blank" rel="noopener noreferrer">${X_SVG}<span>Post on X</span></a>
      <button type="button" class="sp-item" data-ms="send" hidden>${SEND_SVG}<span>More ways to share</span></button>
      <div class="sp-status" role="status" aria-live="polite"></div>
      <input class="sp-url" type="text" readonly hidden aria-label="Link to this map">`;
    document.body.appendChild(pop);
    pop.addEventListener("click", onClick);
    document.addEventListener("pointerdown", (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !now?.button.contains(e.target)) close(false);
    }, true);
    // Esc closes the popover before anything underneath sees it (an open map, the world view, an edition's panel).
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || pop.hidden) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }, true);
    window.addEventListener("resize", () => !pop.hidden && rebind() && place());
  }

  const status = (text) => {
    pop.querySelector(".sp-status").textContent = text;
  };

  // Under its button, or over it where there is no room below; on a phone across the screen (css/ports.css).
  function place() {
    const r = now.button.getBoundingClientRect();
    const w = pop.offsetWidth || 300;
    const h = pop.offsetHeight || 240;
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 && r.top - 8 - h >= 8 ? r.top - 8 - h : below;
    pop.style.setProperty("--ms-top", `${Math.round(Math.max(8, top))}px`);
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  }

  // A list drawn again (a card's order follows the ratings) replaces the button the popover was opened from: it
  // stays open under the new one, and closes if the map's button is gone.
  function rebind() {
    if (document.contains(now.button)) return true;
    const same = `[data-share-map="${CSS.escape(now.port.id)}"]${now.stars ? "[data-share-stars]" : ":not([data-share-stars])"}`;
    const next = [...document.querySelectorAll(same)].find((b) => b.getClientRects().length);
    if (!next) {
      close(false);
      return false;
    }
    now.button = next;
    next.setAttribute("aria-expanded", "true");
    return true;
  }

  /** Bring the stars and the line about the ratings up to date (when ratings arrive or change). */
  function sync() {
    if (!pop || pop.hidden || !now || !rebind()) return;
    place();
    syncStars(pop);
    const sum = summaryOf(now.port);
    const line = pop.querySelector(".ms-sum");
    line.textContent = sum;
    line.hidden = !sum;
  }

  /** Open it under `button` for `port`; `stars`: with the stars to rate it (where the bar beside it has none). */
  function open(button, port, { stars = false } = {}) {
    if (!pop) build();
    if (now && now.button !== button) now.button.setAttribute("aria-expanded", "false");
    const link = linkOf(port);
    now = { port, button, stars, link };
    pop.querySelector("#ms-title").textContent = `${stars ? "Rate and share" : "Share"} ${port.name}`;
    const slot = pop.querySelector(".rt-pop");
    slot.dataset.ratingOf = port.id;
    slot.replaceChildren(); // drawn afresh for this map
    pop.querySelector(".ms-rate").hidden = !stars;
    pop.querySelector(".ms-link").textContent = shortLink(link);
    pop.querySelector('[data-ms="x"]').href = xPostUrl(postText(port, makerOf(port)), link);
    pop.querySelector('[data-ms="send"]').hidden = typeof navigator.share !== "function";
    pop.querySelector(".sp-url").hidden = true;
    status("");
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    sync();
    place();
    if (stars) loadStars();
    pop.querySelector(stars ? ".rt-pop .rt-star, [data-ms]" : "[data-ms]")?.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    const button = now?.button;
    button?.setAttribute("aria-expanded", "false");
    now = null;
    if (restoreFocus && button && document.contains(button)) button.focus({ preventScroll: true });
  }

  /** The same button opens it and closes it again. */
  function toggle(button, port, options) {
    if (pop && !pop.hidden && now?.button === button) close();
    else open(button, port, options);
  }

  async function onClick(e) {
    const star = e.target.closest(".rt-star");
    if (star?.dataset.rate) {
      if (e.detail > 1) return; // the second click of a double-click would take the rating straight back
      let said = "";
      const res = await rate(star.dataset.rate, Number(star.dataset.stars), (message) => (said = message));
      // Said here rather than in a toast, which would cover the map: the ways to share it are right below.
      if (!pop.hidden && said) status(res?.ok && res.stars ? `${said}. Share it so others can rate it too.` : said);
      return;
    }
    const item = e.target.closest("[data-ms]");
    if (!item || !now) return;
    const { port, link } = now;
    if (item.dataset.ms === "copy") {
      const box = pop.querySelector(".sp-url");
      if (await copyText(link)) {
        box.hidden = true;
        status("Link copied. Paste it anywhere: it shows this map and asks for ratings.");
      } else {
        status("Copy this link:");
        box.hidden = false;
        box.value = link;
        box.focus();
        box.select();
      }
    } else if (item.dataset.ms === "x") {
      status("X opens in a new tab with the post written. Edit it as you like.");
    } else if (item.dataset.ms === "send") {
      try {
        await navigator.share({ title: `${port.name} on EarthCiv`, text: postText(port, makerOf(port)), url: link });
      } catch {
        /* the visitor closed the share sheet */
      }
    }
  }

  return {
    open,
    close,
    toggle,
    sync,
    /** The map the popover is open for, or null. */
    get openFor() {
      return pop && !pop.hidden ? now?.port.id || null : null;
    },
  };
}
