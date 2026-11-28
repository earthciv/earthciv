// Tests for which cities get a banner where the plates crowd each other (web/js/render/banners.js), on the biggest
// Canadian cities at the screen points where Canada's opening view puts them in a 1280×800 window.
//
// tests/test_city_banners.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/banners.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// banners.js reads the edition's manifest while it loads (web/js/app/edition.js): open the Canada edition, and
// answer its requests from the files. icons.js draws its glyphs as paths.
globalThis.location = new URL("https://earthciv.org/?country=ca");
globalThis.fetch = async (url) => {
  const body = readFileSync(new URL(url), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
globalThis.Path2D ??= class {};
const { drawBanners } = await import("../../web/js/render/banners.js");

// A 2D context that measures text at 6.5 px a character and draws nothing.
function fakeContext() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text) => ({ width: 6.5 * String(text).length });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return noop;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

// [name, population, x, y]: the biggest census metropolitan areas and agglomerations, where Canada's opening view
// draws them in a 1280×800 window (hexes 3.5 px across, so the compact plates).
const CANADA = [
  ["Toronto", 7108874, 772, 709], ["Montréal", 4597837, 830, 662], ["Vancouver", 3088036, 320, 577],
  ["Calgary", 1836012, 411, 588], ["Ottawa", 1700014, 808, 667], ["Edmonton", 1692385, 426, 551],
  ["Winnipeg", 951758, 575, 630], ["Québec", 903607, 845, 635], ["Hamilton", 871143, 769, 714],
  ["Kitchener", 701568, 763, 714], ["London", 633002, 757, 725], ["Halifax", 544834, 936, 625],
  ["St. Catharines", 503670, 772, 719], ["Oshawa", 493441, 778, 698],
];

/** Cities as cities.json has them (biggest first), each on its own cell, `capital` naming the capital. */
function cities(rows, capital = "Ottawa") {
  return rows.map(([name, population, x, y], cell) => ({ id: `c${cell}`, name, population, capital: name === capital, cell, x, y }));
}

/** The banners drawn over `list`: [{name, x, y, w, h}] in screen px, in the order they were placed. */
function banners(list, { selected = null, bannerBounds = null } = {}) {
  const w = {
    grid: { R: 25, cx: (cell) => list[cell].x, cy: (cell) => list[cell].y },
    stateColor: [],
    raw: { owner: [] },
  };
  const cam = { w: 1280, h: 800, scale: 0.14, toScreen: (x, y) => [x, y] };
  const state = { cities: list, selectedCity: selected, hoverCell: -1, bannerBounds };
  return drawBanners(fakeContext(), cam, w, state, [], null).map((h) => ({ name: h.city.name, x: h.x, y: h.y, w: h.w, h: h.h }));
}

const names = (hits) => hits.map((h) => h.name);

test("the capital has a banner, though Montréal's would cover the spot above it", () => {
  const hits = banners(cities(CANADA));
  assert.ok(names(hits).includes("Ottawa"), names(hits).join(", "));
});

test("the capital's banner leaves every bigger city its own", () => {
  const shown = names(banners(cities(CANADA)));
  for (const name of ["Toronto", "Montréal", "Vancouver", "Calgary"]) assert.ok(shown.includes(name), `${name}: ${shown.join(", ")}`);
});

test("the capital's label stays visible just below the top bar", () => {
  const list = cities([["Ottawa", 1700014, 640, 87]]);
  for (const selected of [null, list[0]]) {
    const hits = banners(list, { selected, bannerBounds: { y0: 80, y1: 744 } });
    assert.equal(hits[0]?.name, "Ottawa");
    assert.ok(hits[0].y > 87, "the label fits below the city");
  }
});

test("only being the capital puts Ottawa's banner on that crowded spot", () => {
  assert.ok(!names(banners(cities(CANADA, null))).includes("Ottawa"));
});

test("a banner with no room above its city slides along its row, its pointer still on the city", () => {
  const hits = banners(cities(CANADA));
  const calgary = hits.find((h) => h.name === "Calgary");
  assert.ok(calgary, "Calgary has a banner beside Vancouver's");
  assert.notEqual(calgary.x, Math.round(411 - calgary.w / 2), "slid off centre");
  assert.ok(calgary.x + 9 <= 411 && 411 <= calgary.x + calgary.w - 9, "the pointer stays under the plate");
  assert.ok(names(hits).includes("Edmonton"));
});

test("banners never overlap", () => {
  for (const selected of [null, "Montréal", "Hamilton"]) {
    const list = cities(CANADA);
    const hits = banners(list, { selected: list.find((c) => c.name === selected) ?? null });
    for (const [i, a] of hits.entries()) {
      for (const b of hits.slice(i + 1)) {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${a.name} and ${b.name} overlap (selected: ${selected})`);
      }
    }
  }
});

test("a selected city goes first, and the capital still has its banner", () => {
  const list = cities(CANADA);
  const hits = banners(list, { selected: list.find((c) => c.name === "Toronto") });
  assert.equal(hits[0].name, "Toronto");
  assert.ok(names(hits).includes("Ottawa"));
});

test("a town under the population floor has a banner where no other banner is near, and not beside a big city", () => {
  // At this zoom a city needs 240,000 people for its banner. Whitehorse sits alone in the north; Guelph next to
  // Toronto, Hamilton and Kitchener.
  const list = cities([...CANADA, ["Guelph", 183134, 790, 705], ["Whitehorse", 39584, 240, 300]]);
  const shown = names(banners(list));
  assert.ok(shown.includes("Whitehorse"), shown.join(", "));
  assert.ok(!shown.includes("Guelph"), shown.join(", "));
});

test("the U.S. capital is found by its metro id when cities carry no capital flag", () => {
  // New York's banner would cover Washington's spot; Washington is CBSA 47900 (world.js isCapital).
  const list = [
    { id: "35620", name: "New York", population: 20112448, cell: 0, x: 300, y: 400 },
    { id: "47900", name: "Washington", population: 6465900, cell: 1, x: 290, y: 410 },
  ];
  assert.deepEqual(names(banners(list)).sort(), ["New York", "Washington"]);
});
