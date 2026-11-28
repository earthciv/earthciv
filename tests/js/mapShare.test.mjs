// Tests for sharing a map (web/js/ext/ports/mapShare.js): which maps have a page and a Share button, the link a
// Share button gives, the post it writes on X, the line about the map's ratings, and the note a map's page leaves
// for the world view (web/js/app/open-share.js), on made-up maps and on web/data/ports.json itself.
//
// tests/test_map_pages.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/mapShare.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ARRIVAL_KEY, mapLink, postText, ratingSummary, sharable, shortLink, takeArrival, xPostUrl,
} from "../../web/js/ext/ports/mapShare.js";
import { makerOf } from "../../web/js/ext/ports/makers.js";
import { rateable } from "../../web/js/ext/ports/ratings.js";

const ROOT = new URL("../../", import.meta.url);
const CATALOG = JSON.parse(readFileSync(new URL("web/data/ports.json", ROOT), "utf8")).ports;

const live = { id: "deciv", name: "Deutschland (deciv)", status: "live", url: "https://wdenk.github.io/deciv/", embed: true, author: "wdenk", repo: "wdenk/deciv", author_twitter: "TheJol", countries: ["DE"] };
const edition = { id: "my", name: "Malaysia", status: "merged", editionId: "my", url: null, author: "MyCiv", author_github: "pengkodam", author_twitter: "peyter", countries: ["MY"] };

// A sessionStorage stand-in.
function store(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    get size() {
      return data.size;
    },
  };
}

test("a map has a page and a Share button exactly when it can be rated", () => {
  assert.equal(sharable(live), true);
  assert.equal(sharable(edition), true);
  assert.equal(sharable({ ...live, embed: false }), false, "a map that opens only in a new tab");
  assert.equal(sharable({ ...live, status: "repo", url: null }), false, "source code alone");
  assert.equal(sharable({ ...live, status: "custom" }), false, "a link a visitor saved for themselves");
  for (const port of CATALOG) assert.equal(sharable(port), rateable(port), port.id);
  assert.ok(CATALOG.filter(sharable).length >= 50, "most of the catalog's maps have a page");
});

test("every id a page is made for can be a folder of the site", () => {
  for (const port of CATALOG.filter(sharable)) assert.match(port.id, /^[a-z0-9][a-z0-9_-]*$/, port.id);
});

test("with the maps' own pages, the link is the map's page", () => {
  const root = "https://earthciv.org/";
  assert.equal(mapLink(live, { root, pages: true }), "https://earthciv.org/map/deciv/");
  assert.equal(mapLink(edition, { root, pages: true }), "https://earthciv.org/map/my/");
  // whatever the page that asks is showing
  assert.equal(mapLink(live, { root: "https://earthciv.org/?country=ca#ports=all", pages: true }), "https://earthciv.org/map/deciv/");
  assert.equal(mapLink(live, { root: "https://example.org/earthciv/", pages: true }), "https://example.org/earthciv/map/deciv/");
});

test("without them, the link opens the map here: the world view with it open, or the edition", () => {
  const root = "http://127.0.0.1:8765/";
  assert.equal(mapLink(live, { root }), "http://127.0.0.1:8765/#ports=deciv");
  assert.equal(mapLink(edition, { root }), "http://127.0.0.1:8765/?country=my");
});

test("a link is read out without its scheme", () => {
  assert.equal(shortLink("https://earthciv.org/map/deciv/"), "earthciv.org/map/deciv/");
  assert.equal(shortLink("https://www.example.org/x"), "example.org/x");
  assert.equal(shortLink("http://127.0.0.1:8765/#ports=deciv"), "127.0.0.1:8765/#ports=deciv");
});

test("a post names the map and its maker, by their X handle where the catalog has one", () => {
  assert.equal(postText(live, makerOf(live)), "Rate Deutschland (deciv) by @TheJol on EarthCiv");
  const noHandle = { ...live, author_twitter: undefined };
  assert.equal(postText(noHandle, makerOf(noHandle)), "Rate Deutschland (deciv) by wdenk on EarthCiv");
  assert.equal(postText(live, null), "Rate Deutschland (deciv) on EarthCiv");
  const url = new URL(xPostUrl(postText(live, makerOf(live)), "https://earthciv.org/map/deciv/"));
  assert.equal(url.origin + url.pathname, "https://x.com/intent/post");
  assert.equal(url.searchParams.get("text"), "Rate Deutschland (deciv) by @TheJol on EarthCiv");
  assert.equal(url.searchParams.get("url"), "https://earthciv.org/map/deciv/");
});

test("every map with a page has words for its post, and room left in it", () => {
  for (const port of CATALOG.filter(sharable)) {
    const text = postText(port, makerOf(port));
    assert.match(text, /^Rate .+ on EarthCiv$/, port.id);
    // X counts a link as 23 characters, and a space goes before it.
    assert.ok([...text].length + 24 <= 280, `${port.id}: ${text}`);
  }
});

test("the line about a map's ratings", () => {
  assert.equal(ratingSummary({ n: 0, sum: 0 }), "No ratings yet. The link opens the map with its stars, so anyone can rate it.");
  assert.equal(ratingSummary({ n: 0, sum: 0 }, null, { open: false }), "", "nothing to say where ratings are closed");
  assert.equal(ratingSummary({ n: 1, sum: 4 }), "Rated 4.0 out of 5 by 1 person");
  assert.equal(ratingSummary({ n: 12, sum: 54 }, { rank: 3, of: 40, tied: false }), "Rated 4.5 out of 5 by 12 people · 3rd of 40 in World Rankings");
  assert.equal(ratingSummary({ n: 2, sum: 7 }, { rank: 1, of: 5, tied: true }, { open: false }), "Rated 3.5 out of 5 by 2 people · 1st of 5 (tied) in World Rankings");
  assert.equal(ratingSummary({ n: 1200, sum: 6000 }), "Rated 5.0 out of 5 by 1,200 people");
});

test("the note a map's page leaves is read once", () => {
  const at = 1_800_000_000_000;
  const s = store({ [ARRIVAL_KEY]: JSON.stringify({ id: "deciv", at }) });
  assert.equal(takeArrival(s, at + 3000), "deciv");
  assert.equal(s.size, 0, "the note is removed");
  assert.equal(takeArrival(s, at + 3000), null);
});

test("an old, broken or strange note is no arrival", () => {
  const at = 1_800_000_000_000;
  const note = (value) => store({ [ARRIVAL_KEY]: typeof value === "string" ? value : JSON.stringify(value) });
  assert.equal(takeArrival(note({ id: "deciv", at }), at + 10 * 60_000), null, "from an earlier visit");
  assert.equal(takeArrival(note({ id: "deciv", at: at + 60_000 }), at), null, "from the future");
  assert.equal(takeArrival(note("{not json"), at), null);
  assert.equal(takeArrival(note({ id: "../x", at }), at), null);
  assert.equal(takeArrival(note({ id: 7, at }), at), null);
  assert.equal(takeArrival(store(), at), null);
  assert.equal(takeArrival(null, at), null);
  const throws = { getItem() { throw new Error("forbidden"); }, removeItem() {} };
  assert.equal(takeArrival(throws, at), null);
});

test("the page writes the note under the key the world view reads", () => {
  const opener = readFileSync(new URL("web/js/app/open-share.js", ROOT), "utf8");
  assert.ok(opener.includes(`sessionStorage.setItem("${ARRIVAL_KEY}"`), "web/js/app/open-share.js writes ARRIVAL_KEY");
  assert.match(opener, /JSON\.stringify\(\{ id: link\.dataset\.map, at: Date\.now\(\) \}\)/);
});
