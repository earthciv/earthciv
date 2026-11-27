// Tests for the maps' makers (web/js/ext/ports/makers.js): who a map is credited to, the list of everyone who made
// one, and the order that list is shown in.
//
// tests/test_makers.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/makers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MIN_RATINGS, avatarUrl, dayNumber, featuredPort, hueOf, initials, listMakers, makerOf, ownRepoStars, rankMakers } from "../../web/js/ext/ports/makers.js";

const ROOT = new URL("../../", import.meta.url);
const PORTS = JSON.parse(readFileSync(new URL("web/data/ports.json", ROOT), "utf8")).ports;

const live = (id, author, repo, more = {}) => ({ id, status: "live", url: `https://${id}.example/`, embed: true, author, repo, ...more });
const code = (id, author, repo) => ({ id, status: "repo", url: null, embed: false, author, repo });
const keys = (makers) => makers.map((m) => m.key);

test("a map is credited to its author, with the account its repository is in", () => {
  assert.deepEqual(makerOf(live("dkciv", "mutwil", "mutwil/dkciv")), {
    key: "mutwil", name: "mutwil", github: "mutwil", url: "https://github.com/mutwil",
  });
  // The name the catalog gives is what is shown; the account is what makes two maps the same maker's.
  const m = makerOf(live("europeciv", "Mathieu Astruc", "lmveprog/Europe-Civilization"));
  assert.equal(m.name, "Mathieu Astruc");
  assert.equal(m.key, "lmveprog");
  assert.equal(m.url, "https://github.com/lmveprog");
});

test("an entry can name the author's account and a page of their own", () => {
  // No repository: the account comes from "author_github".
  const noRepo = makerOf(live("franceciv", "Mathieu Astruc", null, { author_github: "lmveprog" }));
  assert.equal(noRepo.github, "lmveprog");
  assert.equal(noRepo.key, "lmveprog");
  // A repository in somebody else's account: "author_github" wins over its owner.
  const edition = makerOf({ id: "us", status: "merged", author: "Andrej Karpathy", repo: "earthciv/earthciv", author_github: "karpathy" });
  assert.equal(edition.github, "karpathy");
  // "author_url" is where the name links, in place of the GitHub profile.
  const own = makerOf(live("x", "Someone", "someone/x", { author_url: "https://someone.example/about" }));
  assert.equal(own.url, "https://someone.example/about");
  assert.equal(own.github, "someone");
});

test("no account: the maker is known by name alone, with no picture and no link", () => {
  const m = makerOf(live("x", "  Ada Lovelace ", null));
  assert.deepEqual(m, { key: "ada lovelace", name: "Ada Lovelace", github: null, url: null });
  assert.equal(avatarUrl(m.github), null);
});

test("an author can ask for their name alone: \"author_github\": null", () => {
  // The repository's owner is then not taken for the author's account: no picture and no profile link.
  const m = makerOf(live("x", "Ada Lovelace", "ada/x", { author_github: null }));
  assert.deepEqual(m, { key: "ada lovelace", name: "Ada Lovelace", github: null, url: null });
  // A page of their own can still be linked.
  const linked = makerOf(live("x", "Ada Lovelace", "ada/x", { author_github: null, author_url: "https://ada.example/" }));
  assert.deepEqual([linked.github, linked.url], [null, "https://ada.example/"]);
  // Their maps are still listed together, by name.
  const makers = listMakers([live("x", "Ada Lovelace", "ada/x", { author_github: null }), live("y", "ada lovelace", null)]);
  assert.equal(makers.length, 1);
  assert.deepEqual(makers[0].ports.map((p) => p.id), ["x", "y"]);
});

test("nobody is named for a visitor's own link, or for an entry without an author", () => {
  assert.equal(makerOf({ id: "custom-1", status: "custom", author: null, url: "https://x.example/" }), null);
  assert.equal(makerOf(live("x", "", "someone/x")), null);
  assert.equal(makerOf(live("x", null, "someone/x")), null);
  assert.equal(makerOf(null), null);
});

test("only a real account name or web address is put into a link", () => {
  for (const bad of ["a/b", "../x", "x y", "-lead", "trail-", "do--uble", "x".repeat(40), "<b>", 7, {}]) {
    assert.equal(makerOf(live("x", "Someone", null, { author_github: bad })).github, null, `${bad}`);
    assert.equal(avatarUrl(bad), null, `${bad}`);
  }
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//x.example", "not a url", 7]) {
    assert.equal(makerOf(live("x", "Someone", null, { author_url: bad })).url, null, `${bad}`);
  }
  // A repository's owner that is not an account name gives no account either.
  assert.equal(makerOf(live("x", "Someone", "bad owner/x")).github, null);
});

test("a picture comes from GitHub's picture host, at the size asked for", () => {
  assert.equal(avatarUrl("mutwil", 80), "https://avatars.githubusercontent.com/mutwil?s=80");
  assert.equal(avatarUrl("i-am-alvin", 40.4), "https://avatars.githubusercontent.com/i-am-alvin?s=40");
  assert.equal(avatarUrl(null), null);
});

test("initials stand in for a picture", () => {
  assert.equal(initials("Andrej Karpathy"), "AK");
  assert.equal(initials("mutwil"), "M");
  assert.equal(initials("radovansusic / Schule"), "RS");
  assert.equal(initials("0xAnto"), "0");
  assert.equal(initials("陆三金"), "陆");
  assert.equal(initials("i-am-alvin"), "IA");
  assert.equal(initials(""), "?");
  assert.equal(initials(null), "?");
});

test("a maker's colour is the same every time", () => {
  assert.equal(hueOf("mutwil"), hueOf("mutwil"));
  for (const key of ["mutwil", "lmveprog", "ada lovelace", ""]) {
    const hue = hueOf(key);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${key}: ${hue}`);
  }
});

test("maps with the same account are one maker's, in the catalog's order", () => {
  const makers = listMakers([
    live("europeciv", "Mathieu Astruc", "lmveprog/Europe-Civilization"),
    live("deciv", "wdenk", "wdenk/deciv"),
    live("franceciv", "Mathieu Astruc", null, { author_github: "LMVEprog" }),
    { id: "custom-1", status: "custom", author: null, url: "https://x.example/" },
  ]);
  assert.deepEqual(keys(makers), ["lmveprog", "wdenk"]);
  assert.deepEqual(makers[0].ports.map((p) => p.id), ["europeciv", "franceciv"]);
  assert.equal(makers[0].name, "Mathieu Astruc");
  assert.equal(makers[0].original, false);
  assert.equal(makers[0].house, false);
});

test("the original map's maker and this site's own editions are marked", () => {
  const makers = listMakers([
    { id: "us", status: "merged", author: "Andrej Karpathy", repo: "earthciv/earthciv", author_github: "karpathy" },
    { id: "ca", status: "merged", author: "EarthCiv", repo: "earthciv/earthciv" },
    live("usaciv", "Andrej Karpathy", null, { author_github: "karpathy", original: true }),
  ], { house: "EarthCiv" });
  assert.deepEqual(keys(makers), ["karpathy", "earthciv"]);
  assert.equal(makers[0].original, true);
  assert.equal(makers[0].house, false);
  assert.equal(makers[1].house, true);
  assert.equal(makers[1].original, false);
});

// --- the order of the list ---------------------------------------------------------------------------------------

const FIVE = [
  live("a", "a", "a/a"), live("b", "b", "b/b"), live("c", "c", "c/c"), live("d", "d", "d/d"), live("e", "e", "e/e"),
];
const ratingsFrom = (table) => (id) => {
  const [n, sum] = table[id] || [0, 0];
  return { n, sum };
};

test("the original comes first and this site's editions last, whatever the ratings say", () => {
  const makers = listMakers([
    { id: "ca", status: "merged", author: "EarthCiv", repo: "earthciv/earthciv" },
    live("a", "a", "a/a"),
    live("usaciv", "Andrej Karpathy", null, { author_github: "karpathy", original: true }),
    live("b", "b", "b/b"),
  ], { house: "earthciv" });
  const ratingOf = ratingsFrom({ ca: [50, 250], a: [20, 100], usaciv: [5, 5] });
  for (let day = 0; day < 8; day++) {
    const order = keys(rankMakers(makers, { ratingOf, day }));
    assert.equal(order[0], "karpathy", `day ${day}`);
    assert.equal(order.at(-1), "earthciv", `day ${day}`);
  }
});

test("with no ratings the makers take turns: the order moves one place every day", () => {
  const makers = listMakers(FIVE);
  assert.deepEqual(keys(rankMakers(makers, { day: 0 })), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(keys(rankMakers(makers, { day: 1 })), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(keys(rankMakers(makers, { day: 4 })), ["e", "a", "b", "c", "d"]);
  assert.deepEqual(keys(rankMakers(makers, { day: 5 })), ["a", "b", "c", "d", "e"]);
  // Over as many days as there are makers, each is first once.
  const firsts = new Set(Array.from({ length: 5 }, (_, day) => rankMakers(makers, { day })[0].key));
  assert.equal(firsts.size, 5);
  // The same on any day number, including the real one.
  const today = dayNumber();
  assert.ok(Number.isInteger(today) && today > 20000);
  assert.equal(rankMakers(makers, { day: today }).length, 5);
});

test("the day number changes at midnight UTC", () => {
  assert.equal(dayNumber(new Date("2026-11-27T00:00:00Z")) - dayNumber(new Date("2026-11-26T23:59:59Z")), 1);
  assert.equal(dayNumber(new Date("2026-11-27T23:59:59Z")), dayNumber(new Date("2026-11-27T00:00:00Z")));
});

test("a maker's rating places them once their maps have enough ratings", () => {
  assert.equal(MIN_RATINGS, 3);
  const makers = listMakers(FIVE);
  // One or two ratings place nobody: a single five-star rating must not carry a map to the top of the list.
  const few = ratingsFrom({ d: [2, 10], e: [1, 5] });
  assert.deepEqual(keys(rankMakers(makers, { ratingOf: few, day: 0 })), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(rankMakers(makers, { ratingOf: few, day: 0 }).map((m) => m.ranked), [false, false, false, false, false]);
  // With enough, the well rated come first and the poorly rated last; the unrated keep their turns in between.
  const enough = ratingsFrom({ d: [4, 20], b: [3, 3], e: [1, 5] });
  const ranked = rankMakers(makers, { ratingOf: enough, day: 0 });
  assert.deepEqual(keys(ranked), ["d", "a", "c", "e", "b"]);
  assert.deepEqual(keys(rankMakers(makers, { ratingOf: enough, day: 1 })), ["d", "c", "e", "a", "b"]);
  // The numbers the list shows come with them.
  const d = ranked[0];
  assert.deepEqual([d.n, d.sum, d.average, d.ranked], [4, 20, 5, true]);
  assert.equal(ranked.find((m) => m.key === "a").average, null);
});

test("many ratings count for more than a few", () => {
  const makers = listMakers(FIVE);
  // a: 3 ratings, all five stars. b: 40 ratings averaging 4.9. c: 30 ratings averaging 3.
  const ratingOf = ratingsFrom({ a: [3, 15], b: [40, 196], c: [30, 90] });
  const order = keys(rankMakers(makers, { ratingOf, day: 0 }));
  assert.deepEqual(order, ["b", "a", "d", "e", "c"]);
});

test("a maker with several maps is rated on all of them together", () => {
  const makers = listMakers([live("a1", "a", "a/one"), live("a2", "a", "a/two"), live("b", "b", "b/b")]);
  const ranked = rankMakers(makers, { ratingOf: ratingsFrom({ a1: [2, 10], a2: [1, 5] }), day: 0 });
  assert.deepEqual([ranked[0].key, ranked[0].n, ranked[0].sum, ranked[0].ranked], ["a", 3, 15, true]);
});

test("makers with a map that opens come before those with source code only", () => {
  const makers = listMakers([code("z", "z", "z/z"), live("a", "a", "a/a"), code("y", "y", "y/y"), live("b", "b", "b/b")]);
  assert.deepEqual(keys(rankMakers(makers, { day: 0 })), ["a", "b", "z", "y"]);
  assert.deepEqual(keys(rankMakers(makers, { day: 1 })), ["a", "b", "y", "z"]);
  assert.deepEqual(keys(rankMakers(makers, { day: 2 })), ["b", "a", "y", "z"]);
});

test("ranking leaves the list it was given as it was", () => {
  const makers = listMakers(FIVE);
  const before = JSON.stringify(makers);
  rankMakers(makers, { ratingOf: ratingsFrom({ d: [4, 20] }), day: 3 });
  assert.equal(JSON.stringify(makers), before);
  assert.deepEqual(rankMakers([], {}), []);
  assert.deepEqual(rankMakers(null), []);
});

// --- today's map --------------------------------------------------------------------------------------------------

test("today's map: every community map with a site takes a day in turn", () => {
  const ports = [
    { id: "us", status: "merged", author: "Andrej Karpathy", author_github: "karpathy", repo: "earthciv/earthciv" },
    live("usaciv", "Andrej Karpathy", null, { author_github: "karpathy", original: true }),
    live("a", "a", "a/a"),
    code("z", "z", "z/z"),
    live("b", "b", "b/b", { embed: false }), // a map that opens on its own site takes its turn too
    live("c", "c", "c/c"),
    live("nobody", "", "n/n"),
    { id: "custom-1", status: "custom", author: null, url: "https://x.example/" },
  ];
  assert.deepEqual([0, 1, 2, 3, 4].map((day) => featuredPort(ports, { day }).id), ["a", "b", "c", "a", "b"]);
  assert.equal(featuredPort(ports, { day: -1 }).id, "c");
  assert.equal(featuredPort(ports).id, "a");
  assert.equal(featuredPort([code("z", "z", "z/z")], { day: 3 }), null);
  assert.equal(featuredPort([], { day: 3 }), null);
  assert.equal(featuredPort(null), null);
});

test("today's map: in the catalog every map with a site has its day, and no other map does", () => {
  const turns = PORTS.filter((p) => p.status === "live" && p.url && p.original !== true).map((p) => p.id);
  assert.ok(turns.length >= 30);
  const today = dayNumber();
  const seen = Array.from({ length: turns.length }, (_, k) => featuredPort(PORTS, { day: today + k }).id);
  assert.deepEqual([...seen].sort(), [...turns].sort());
  assert.equal(new Set(seen).size, turns.length);
});

// --- the catalog itself -------------------------------------------------------------------------------------------

test("every map in the catalog names its maker", () => {
  for (const p of PORTS) {
    const maker = makerOf(p);
    assert.ok(maker, `${p.id} names no author`);
    assert.ok(maker.name.length >= 2, `${p.id}: author "${maker.name}"`);
  }
});

test("the catalog's optional author fields are an account name and a web address", () => {
  for (const p of PORTS) {
    if ("author_github" in p) assert.equal(makerOf(p).github, p.author_github, `${p.id}: author_github "${p.author_github}"`); // an account, or null
    if ("author_url" in p) assert.equal(makerOf(p).url, new URL(p.author_url).href, `${p.id}: author_url "${p.author_url}"`);
    if ("original" in p) assert.equal(p.original, true, `${p.id}: "original" is true or left out`);
  }
});

test("one map is the original, and its maker leads the list", () => {
  assert.deepEqual(PORTS.filter((p) => p.original === true).map((p) => p.id), ["usaciv-original"]);
  const makers = listMakers(PORTS, { house: "earthciv" });
  const ranked = rankMakers(makers, { day: dayNumber() });
  assert.equal(ranked[0].name, "Andrej Karpathy");
  assert.equal(ranked[0].github, "karpathy");
  // The U.S. edition is his map too, so it is credited to him and not to this site.
  assert.deepEqual(ranked[0].ports.map((p) => p.id), ["us", "usaciv-original"]);
  // The Canada edition is credited to manpreetsgarha, not the organization account.
  const canada = makers.find((m) => m.key === "manpreetsgarha");
  assert.ok(canada);
  assert.equal(canada.name, "manpreetsgarha");
  assert.equal(canada.github, "manpreetsgarha");
  assert.equal(canada.twitter, "manpreetsgarha");
  assert.equal(canada.url, "https://github.com/manpreetsgarha");
  assert.equal(canada.house, false);
  assert.deepEqual(canada.ports.map((p) => p.id), ["ca"]);
  assert.equal(ranked.filter((m) => m.house).length, 0);
});

test("the same person's maps are listed together", () => {
  const makers = listMakers(PORTS, { house: "earthciv" });
  const names = makers.map((m) => m.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "two makers share a name: give the entries the same author_github");
  const maps = makers.reduce((n, m) => n + m.ports.length, 0);
  assert.equal(maps, PORTS.length);
  const astruc = makers.find((m) => m.key === "lmveprog");
  assert.deepEqual(astruc.ports.map((p) => p.id), ["europeciv", "franceciv-astruc"]);
  assert.equal(astruc.name, "Mathieu Astruc");
});

test("Twitter handles stay separate from GitHub and survive grouping multiple maps", () => {
  const map = live("x", "Someone", "someone/x", { author_twitter: "their_x" });
  assert.equal(makerOf(map).twitter, "their_x");
  assert.equal(makerOf(map).url, "https://github.com/someone");
  for (const handle of ["https://x.com/person", "../person", "<script>", "a".repeat(16), null]) {
    assert.equal(makerOf({ ...map, author_twitter: handle }).twitter, undefined);
  }
  const makers = listMakers([live("y", "Someone", "someone/y"), map]);
  assert.equal(makers[0].twitter, "their_x");
});

test("repository stars rank unrated makers, count each repository once, and ignore third-party repos", () => {
  const first = live("a", "Ada", "ada/map", { github_stars: 12 });
  const duplicate = live("b", "Ada", "ADA/MAP", { github_stars: 12 });
  const thirdParty = live("x", "Ada", "other/mirror", { author_github: "ada", github_stars: 500 });
  const second = live("c", "Bea", "bea/map", { github_stars: 20 });
  assert.equal(ownRepoStars(first), 12);
  assert.equal(ownRepoStars(thirdParty), null);
  assert.equal(ownRepoStars(live("z", "Zed", "zed/z", { github_stars: 0 })), 0);
  assert.equal(ownRepoStars(live("bad", "Bad", "bad/map", { github_stars: -1 })), null);
  const makers = listMakers([first, duplicate, thirdParty, second]);
  const ranked = rankMakers(makers, { day: 0 });
  assert.deepEqual(keys(ranked), ["bea", "ada"]);
  assert.equal(ranked[1].githubStars, 12);
  assert.equal(ranked[0].n, 0);
  assert.equal(ranked[0].average, null);
  const rated = rankMakers(makers, { ratingOf: (id) => id === "a" ? { n: 3, sum: 15 } : id === "c" ? { n: 3, sum: 3 } : { n: 0, sum: 0 } });
  assert.deepEqual(keys(rated), ["ada", "bea"]);
  assert.equal(rated[0].average, 5);
});
