// Tests for the map menu's entries (web/js/ui/mapPicker.js): the icon and the words each map is listed with.
//
// tests/test_map_menu.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/mapPicker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { editionIcon, flagEmoji, mapIcon, menuLabel } from "../../web/js/ui/mapPicker.js";

const ROOT = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
const EDITIONS = json("web/data/editions.json").editions;
const PORTS = json("web/data/ports.json").ports;

// An icon a visitor sees as one: an emoji, not a letter or a plain symbol such as ★.
const isEmoji = (text) => /\p{Emoji_Presentation}|️/u.test(text);

test("a flag is made from a country's code", () => {
  assert.equal(flagEmoji("US"), "🇺🇸");
  assert.equal(flagEmoji("CA"), "🇨🇦");
  assert.equal(flagEmoji("usa"), "🏳️");
  assert.equal(flagEmoji(null), "🏳️");
});

test("an emblem that is an emoji is the map's icon", () => {
  assert.equal(mapIcon("🌺", "MY"), "🌺");
  assert.equal(mapIcon("🇨🇦", "CA"), "🇨🇦");
  assert.equal(mapIcon("🇪🇺", "AT"), "🇪🇺");
  assert.equal(mapIcon("☀️", "US"), "☀️"); // made an emoji by its variation selector
});

test("an emblem that is not an emoji gives way to the country's flag", () => {
  assert.equal(mapIcon("★", "US"), "🇺🇸");
  assert.equal(mapIcon("", "DE"), "🇩🇪");
  assert.equal(mapIcon(undefined, "DE"), "🇩🇪");
  // With no country to take a flag from, the emblem is all there is.
  assert.equal(mapIcon("★", null), "★");
  assert.equal(mapIcon("", null), "");
});

test("every edition is listed with an icon", () => {
  assert.deepEqual(
    EDITIONS.map((e) => menuLabel(editionIcon(e), e.name)),
    ["🇺🇸 United States", "🇨🇦 Canada", "🌺 Malaysia"],
  );
  for (const e of EDITIONS) assert.ok(isEmoji(editionIcon(e)), `${e.id} has no icon in the menu`);
});

test("every map the menu lists has an icon", () => {
  // The menu lists the editions and the community maps that open inside EarthCiv (ext/ports menuHtml).
  const listed = PORTS.filter((p) => p.status === "merged" || (p.status === "live" && p.embed && p.url));
  assert.ok(listed.length >= 30);
  for (const p of listed) {
    const icon = mapIcon(p.emblem, (p.countries || [])[0]);
    assert.ok(isEmoji(icon), `${p.id} ("${p.name}") is listed without an icon: its emblem is "${p.emblem}"`);
  }
});

test("an entry says the icon, then the name", () => {
  assert.equal(menuLabel("🇨🇳", "九州 · Jiuzhou Civ (China)"), "🇨🇳 九州 · Jiuzhou Civ (China)");
  assert.equal(menuLabel("", "Somewhere"), "Somewhere");
});
