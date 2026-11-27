// Tests for the maps' star ratings: the Pages Function (functions/data/ratings.json.js) against a real SQLite
// database, and the world view's rating rules (web/js/ext/ports/ratings.js).
//
// tests/test_ratings.py runs this file as part of the usual test command. To run it alone:
//   node --test tests/js/ratings.test.mjs          (Node 22.13 or newer, for node:sqlite)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { networkOf, onRequest, rateable as serverRateable, voterKey } from "../../functions/data/ratings.json.js";
import { createRatings, rateable as clientRateable, withVote } from "../../web/js/ext/ports/ratings.js";

const ROOT = new URL("../../", import.meta.url);
const STATIC_FILE = readFileSync(new URL("web/data/ratings.json", ROOT), "utf8");
const SITE = "https://earthciv.test";
const ENDPOINT = `${SITE}/data/ratings.json`;

const CATALOG = {
  ports: [
    { id: "us", status: "merged", editionId: "us", url: null },
    { id: "deciv", status: "live", url: "https://deciv.example/", embed: true },
    { id: "frciv", status: "live", url: "https://frciv.example/", embed: false },
    { id: "jpciv", status: "repo", url: null, repo: "someone/jpciv" },
  ],
};

// A stand-in for a D1 database over node:sqlite: the same SQL engine, and the part of D1's API the Function uses.
// Like D1, every call is a trip to the database: it gives way to whatever else is waiting before it runs, so two
// requests at once take turns between their statements (which is where a read-then-write race shows).
// `before(sql)`, when given, may return a promise that holds a statement back until the test lets it go.
function fakeD1({ before = null } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const trip = async (sql) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (before) await before(sql);
  };
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => (await trip(sql), sqlite.prepare(sql).get(...args) ?? null),
    all: async () => (await trip(sql), { results: sqlite.prepare(sql).all(...args) }),
    run: async () => (await trip(sql), { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    now: () => sqlite.prepare(sql).run(...args),
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction: nothing else gets in between its statements.
    async batch(statements) {
      await trip("");
      sqlite.exec("BEGIN");
      try {
        const out = statements.map((s) => ({ meta: { changes: Number(s.now().changes) } }));
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

const ASSETS = {
  fetch: async (url) => (new URL(url).pathname === "/data/ports.json" ? Response.json(CATALOG) : new Response("not found", { status: 404 })),
};

function site({ salt = "test-salt", closed = false, db = fakeD1() } = {}) {
  const env = { ASSETS };
  if (db) env.RATINGS_DB = db;
  if (salt) env.RATINGS_SALT = salt;
  if (closed) env.RATINGS_CLOSED = closed === true ? "1" : closed;

  async function send(method, { body, headers = {}, ip = "203.0.113.7" } = {}) {
    const h = new Headers({ "cf-connecting-ip": ip, ...headers });
    const init = { method, headers: h };
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!h.has("content-type")) h.set("content-type", "application/json");
      if (!h.has("origin")) h.set("origin", SITE);
    }
    const res = await onRequest({
      request: new Request(ENDPOINT, init),
      env,
      next: async () => new Response(STATIC_FILE, { headers: { "content-type": "application/json", "x-static": "1" } }),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  }

  return {
    db,
    get: () => send("GET"),
    send,
    rate: (port, stars, ip) => send("POST", { body: { port, stars }, ip }),
  };
}

test("the static file says ratings are not open, and is what answers without a database", async () => {
  assert.deepEqual(JSON.parse(STATIC_FILE), { version: 1, open: false, reason: "static", scale: 5, ratings: {} });
  const res = await site({ db: null }).get();
  assert.equal(res.headers.get("x-static"), "1");
  assert.equal(res.json.open, false);
  assert.equal(res.json.reason, "static");
  const post = await site({ db: null }).rate("deciv", 4);
  assert.equal(post.status, 503);
});

test("an empty database gets its tables on first use", async () => {
  const s = site();
  const res = await s.get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { version: 1, open: true, scale: 5, ratings: {} });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const made = (type) => s.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type).map((r) => r.name);
  assert.deepEqual(made("table"), ["ratings", "totals"]);
  assert.deepEqual(made("trigger"), ["ratings_added", "ratings_changed", "ratings_removed"]);

  // ...also when the first request is a rating.
  const fresh = site();
  assert.deepEqual((await fresh.rate("deciv", 5)).json, { ok: true, port: "deciv", stars: 5, changed: true, rating: [1, 5] });
});

test("give, change, repeat and take back a rating", async () => {
  const s = site();
  assert.deepEqual((await s.rate("deciv", 4)).json, { ok: true, port: "deciv", stars: 4, changed: true, rating: [1, 4] });
  assert.deepEqual((await s.rate("deciv", 2)).json.rating, [1, 2]); // changed, not added
  assert.deepEqual((await s.rate("deciv", 2)).json, { ok: true, port: "deciv", stars: 2, changed: false, rating: [1, 2] }); // the same again
  assert.deepEqual((await s.rate("deciv", 5, "198.51.100.9")).json.rating, [2, 7]); // another network adds one
  assert.deepEqual((await s.rate("us", 3)).json.rating, [1, 3]);
  assert.deepEqual((await s.get()).json.ratings, { deciv: [2, 7], us: [1, 3] });

  assert.deepEqual((await s.rate("deciv", 0)).json, { ok: true, port: "deciv", stars: 0, changed: true, rating: [1, 5] });
  // Nothing left to take back: the answer says nothing changed, so the page does not claim a removal.
  assert.deepEqual((await s.rate("deciv", 0)).json, { ok: true, port: "deciv", stars: 0, changed: false, rating: [1, 5] });
  assert.deepEqual((await s.rate("deciv", 0, "192.0.2.200")).json.changed, false); // nor from a network that never rated it
  assert.deepEqual((await s.rate("frciv", 0)).json.rating, [0, 0]); // never rated: no row is made
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS c FROM ratings WHERE port_id = 'frciv'").get().c, 0);
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, 5], us: [1, 3] }); // a map with no ratings left is not listed
});

test("one network counts once per map", async () => {
  const s = site();
  await s.rate("deciv", 1, "2001:db8:aa:1::10");
  await s.rate("deciv", 5, "2001:db8:aa:1:ffff::20"); // the same /64: replaces
  await s.rate("deciv", 5, "2001:db8:aa:2::10"); // another /64: adds
  assert.deepEqual((await s.get()).json.ratings, { deciv: [2, 10] });
});

test("only maps that can be opened can be rated", async () => {
  const s = site();
  assert.equal((await s.rate("jpciv", 4)).status, 404); // source code only
  assert.equal((await s.rate("nosuchmap", 4)).status, 404);
  assert.equal((await s.rate("us", 4)).status, 200);
  assert.equal((await s.rate("frciv", 4)).status, 200);
  assert.deepEqual(Object.keys((await s.get()).json.ratings).sort(), ["frciv", "us"]);
});

test("a rating that is not a rating is refused", async () => {
  const s = site();
  for (const stars of [6, -1, 2.5, "4", null, true]) {
    const res = await s.rate("deciv", stars);
    assert.equal(res.status, 400, `stars ${JSON.stringify(stars)}`);
    assert.equal(res.json.error, "bad_stars");
  }
  for (const port of ["", "De Civ", "a".repeat(65), 7, null, "../ports"]) {
    assert.equal((await s.rate(port, 3)).json.error, "bad_port", `port ${JSON.stringify(port)}`);
  }
  assert.equal((await s.send("POST", { body: "{not json" })).json.error, "bad_json");
  assert.equal((await s.send("POST", { body: "[]" })).json.error, "bad_port");
  assert.equal((await s.send("POST", { body: { port: "deciv", stars: 3, pad: "x".repeat(600) } })).status, 413);
  assert.equal((await s.send("PUT", { body: { port: "deciv", stars: 3 } })).status, 405);
  assert.equal((await s.send("DELETE")).status, 405);
  assert.deepEqual((await s.get()).json.ratings, {});
});

test("a rating must come from the site's own pages, as JSON", async () => {
  const s = site();
  const body = { port: "deciv", stars: 1 };
  assert.equal((await s.send("POST", { body, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await s.send("POST", { body, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await s.send("POST", { body, headers: { "sec-fetch-site": "same-site" } })).status, 403);
  // What another site's page can send without the browser asking first: a form or plain text.
  assert.equal((await s.send("POST", { body: JSON.stringify(body), headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await s.send("POST", { body: "port=deciv&stars=1", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.deepEqual((await s.get()).json.ratings, {});
  assert.equal((await s.send("POST", { body, headers: { "sec-fetch-site": "same-origin", "content-type": "application/json; charset=utf-8" } })).status, 200);
});

test("one network may change a rating only so often in a day", async () => {
  const s = site();
  const outcomes = [];
  for (let i = 0; i < 12; i++) outcomes.push((await s.rate("deciv", (i % 5) + 1)).status);
  assert.deepEqual(outcomes, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, 5] }); // the tenth change (i = 9: 5 stars) stands
  assert.equal((await s.rate("deciv", 0)).status, 429); // taking it back is a change too
  assert.equal((await s.rate("deciv", 5)).status, 200); // repeating the standing rating is not
  assert.equal((await s.rate("us", 2)).status, 200); // another map is not affected
  assert.equal((await s.rate("deciv", 2, "198.51.100.9")).status, 200); // nor another network

  // The next day it can be changed again.
  s.db.sqlite.exec("UPDATE ratings SET day = '2000-01-01'");
  assert.deepEqual((await s.rate("deciv", 1)).json.rating, [2, 3]);
  assert.equal(s.db.sqlite.prepare("SELECT MAX(changes) AS c FROM ratings WHERE port_id = 'deciv'").get().c, 1);
});

test("two requests at once are not both told their rating was stored", async () => {
  // Both requests read the rating before either writes: each read is held back until the other has arrived.
  let racing = false;
  const held = [];
  const db = fakeD1({
    before: (sql) => (racing && /^SELECT stars, day, changes FROM ratings/.test(sql)
      ? new Promise((go) => {
          held.push(go);
          if (held.length === 2) {
            racing = false;
            for (const release of held) release();
          }
        })
      : null),
  });
  const s = site({ db });
  for (let i = 0; i < 9; i++) await s.rate("deciv", (i % 2) + 1); // nine changes today: one more is allowed
  racing = true;
  const answers = await Promise.all([s.rate("deciv", 4), s.rate("deciv", 5)]);
  assert.equal(held.length, 2);
  const stored = answers.filter((a) => a.status === 200);
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 429]);
  const row = { ...s.db.sqlite.prepare("SELECT stars, changes FROM ratings WHERE port_id = 'deciv'").get() };
  assert.equal(row.changes, 10);
  assert.equal(stored[0].json.stars, row.stars); // the one told "ok" is the one that stands
  assert.equal(stored[0].json.changed, true);
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, row.stars] });
});

test("in a burst every answer is true: ten changes stored, the rest refused or already so", async () => {
  const s = site();
  const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => s.rate("deciv", (i % 5) + 1)));
  const row = { ...s.db.sqlite.prepare("SELECT stars, changes FROM ratings WHERE port_id = 'deciv'").get() };
  assert.equal(row.changes, 10);
  assert.equal(answers.filter((a) => a.status === 200 && a.json.changed).length, 10);
  assert.ok(answers.every((a) => a.status === 200 || a.status === 429));
  assert.ok(answers.some((a) => a.status === 429));
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS c FROM ratings").get().c, 1);
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, row.stars] });

  // Two hundred identical requests at once store one rating.
  const same = await Promise.all(Array.from({ length: 200 }, () => s.rate("us", 3, "198.51.100.77")));
  assert.ok(same.every((a) => a.status === 200));
  assert.equal(same.filter((a) => a.json.changed).length, 1);
  assert.deepEqual((await s.get()).json.ratings.us, [1, 3]);
});

test("the totals always equal a recount of the ratings", async () => {
  const s = site();
  const ips = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "2001:db8::1", "2001:db8:0:1::1"];
  let k = 0;
  for (const port of ["us", "deciv", "frciv"]) {
    for (const ip of ips) await s.rate(port, (k++ % 5) + 1, ip);
    await s.rate(port, 0, ips[1]);
    await s.rate(port, 5, ips[2]);
  }
  const recount = s.db.sqlite.prepare("SELECT port_id, COUNT(*) AS n, SUM(stars) AS sum FROM ratings WHERE stars > 0 GROUP BY port_id ORDER BY port_id").all();
  const totals = s.db.sqlite.prepare("SELECT port_id, n, sum FROM totals ORDER BY port_id").all();
  assert.deepEqual(totals.map((r) => ({ ...r })), recount.map((r) => ({ ...r })));
  assert.equal(recount.length, 3);
});

test("ratings removed by hand leave the totals right", async () => {
  // docs/RATINGS.md, "Looking after it": someone deletes stuffed ratings straight from the database.
  const s = site();
  for (const [ip, stars] of [["203.0.113.1", 5], ["203.0.113.2", 1], ["203.0.113.3", 1], ["203.0.113.4", 4]]) await s.rate("deciv", stars, ip);
  await s.rate("deciv", 0, "203.0.113.4"); // a rating taken back, still a row
  await s.rate("us", 3, "203.0.113.1");
  assert.deepEqual((await s.get()).json.ratings, { deciv: [3, 7], us: [1, 3] });
  s.db.sqlite.exec("DELETE FROM ratings WHERE port_id = 'deciv' AND stars = 1");
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, 5], us: [1, 3] });
  s.db.sqlite.exec("DELETE FROM ratings WHERE port_id = 'deciv'");
  assert.deepEqual((await s.get()).json.ratings, { us: [1, 3] });
  assert.deepEqual((await s.rate("deciv", 2, "203.0.113.1")).json.rating, [1, 2]); // and it can be rated afresh
});

test("the recount in docs/RATINGS.md leaves the totals right, and counting right afterwards", async () => {
  const doc = readFileSync(new URL("docs/RATINGS.md", ROOT), "utf8");
  const recount = /count them again from the ratings:\s+```sql\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(recount && /DELETE FROM totals/.test(recount) && /INSERT INTO totals/.test(recount), "the recount is not where the test looks for it");

  const s = site();
  await s.rate("deciv", 4, "203.0.113.1");
  await s.rate("deciv", 0, "203.0.113.1"); // every rating of this map taken back: a row with no stars
  await s.rate("us", 5, "203.0.113.1");
  await s.rate("us", 2, "203.0.113.2");
  s.db.sqlite.exec("UPDATE totals SET n = 99, sum = 0"); // the totals have gone wrong
  s.db.sqlite.exec(recount);
  assert.deepEqual((await s.get()).json.ratings, { us: [2, 7] });

  // Afterwards the triggers still find a row for every map, also the one whose ratings were all taken back.
  assert.deepEqual((await s.rate("deciv", 4, "203.0.113.1")).json.rating, [1, 4]);
  assert.deepEqual((await s.rate("deciv", 2, "203.0.113.2")).json.rating, [2, 6]);
  assert.deepEqual((await s.rate("deciv", 0, "203.0.113.1")).json.rating, [1, 2]);
  const truth = s.db.sqlite.prepare("SELECT port_id, COUNT(*) AS n, SUM(stars) AS sum FROM ratings WHERE stars > 0 GROUP BY port_id ORDER BY port_id").all();
  const kept = s.db.sqlite.prepare("SELECT port_id, n, sum FROM totals WHERE n > 0 ORDER BY port_id").all();
  assert.deepEqual(kept.map((r) => ({ ...r })), truth.map((r) => ({ ...r })));
});

test("the database holds no addresses", async () => {
  const s = site();
  await s.rate("deciv", 4, "203.0.113.77");
  await s.rate("deciv", 4, "2001:db8:1234:5678::9");
  const rows = s.db.sqlite.prepare("SELECT * FROM ratings").all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.voter, /^[0-9a-f]{32}$/);
    // Whole address fragments only: a timestamp or a key may well contain "1234".
    assert.doesNotMatch(JSON.stringify(row), /203\.0\.113|2001:db8|1234:5678|113\.77/);
  }
  // The key depends on the secret, so it cannot be recomputed from an address without it.
  assert.notEqual(await voterKey("one secret", "203.0.113.77"), await voterKey("another secret", "203.0.113.77"));
  assert.equal(await voterKey("one secret", "203.0.113.77"), await voterKey("one secret", " 203.0.113.77 "));
});

test("closing ratings keeps the averages on show", async () => {
  const db = fakeD1();
  await site({ db }).rate("deciv", 4);
  for (const [closedSite, reason] of [[site({ db, closed: true }), "closed"], [site({ db, salt: null }), "no_secret"]]) {
    const res = await closedSite.get();
    assert.equal(res.json.open, false);
    assert.equal(res.json.reason, reason); // the answer says which, unlike the static file's "static"
    assert.equal(res.headers.get("x-static"), null);
    assert.deepEqual(res.json.ratings, { deciv: [1, 4] });
    const post = await closedSite.rate("deciv", 1);
    assert.equal(post.status, 503);
    assert.equal(post.json.error, "closed");
  }
  const openAgain = (await site({ db }).get()).json;
  assert.deepEqual(openAgain, { version: 1, open: true, scale: 5, ratings: { deciv: [1, 4] } }); // no reason when open

  // The switch closes ratings when set to anything but an explicit "no".
  for (const value of ["1", "true", "yes", "closed"]) assert.equal((await site({ db, closed: value }).get()).json.open, false, value);
  for (const value of ["0", "false", "no", "off", " Off "]) assert.equal((await site({ db, closed: value }).get()).json.open, true, value);
});

test("a database that fails reads as the static file and refuses ratings without an error page", async () => {
  const broken = { prepare: () => ({ bind() { return this; }, all: async () => { throw new Error("D1_ERROR: database is unreachable"); }, first: async () => { throw new Error("D1_ERROR: database is unreachable"); } }), batch: async () => { throw new Error("D1_ERROR"); } };
  const quiet = console.error;
  console.error = () => {};
  try {
    const s = site({ db: broken });
    assert.equal((await s.get()).headers.get("x-static"), "1");
    const post = await s.rate("deciv", 4);
    assert.equal(post.status, 503);
    assert.equal(post.json.error, "unavailable");
  } finally {
    console.error = quiet;
  }
});

test("networkOf: an IPv4 address, or an IPv6 address's /64", () => {
  assert.equal(networkOf("203.0.113.7"), "203.0.113.7");
  assert.equal(networkOf("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(networkOf("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(networkOf("2001:0DB8:0001:0002::1"), "2001:db8:1:2::/64");
  assert.equal(networkOf("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(networkOf("2001:db8:1::"), "2001:db8:1:0::/64");
  assert.equal(networkOf("::1"), "0:0:0:0::/64");
  assert.equal(networkOf("fe80::1%en0"), "fe80:0:0:0::/64");
  assert.equal(networkOf(""), "unknown");
  assert.equal(networkOf(null), "unknown");
});

// ---- the world view's side (web/js/ext/ports/ratings.js) -----------------------------------------------------------

test("the page and the server agree on which maps can be rated", () => {
  const real = JSON.parse(readFileSync(new URL("web/data/ports.json", ROOT), "utf8")).ports;
  const custom = { id: "custom-abc", status: "custom", url: "https://my.example/", embed: true };
  const cases = [...real, ...CATALOG.ports, custom, { id: "x", status: "live", url: null }, { id: "y", status: "live", url: "" }, null, undefined];
  for (const port of cases) assert.equal(clientRateable(port), serverRateable(port), JSON.stringify(port?.id));
  assert.equal(clientRateable(custom), false);
  const open = real.filter(clientRateable);
  assert.ok(open.length >= 30);
  assert.ok(open.every((p) => p.status !== "repo"));
  assert.ok(open.some((p) => p.status === "merged"));
});

test("withVote: a map's totals after one visitor's change", () => {
  assert.deepEqual(withVote(null, 0, 4), [1, 4]);
  assert.deepEqual(withVote([8, 36], 0, 5), [9, 41]);
  assert.deepEqual(withVote([8, 36], 4, 2), [8, 34]);
  assert.deepEqual(withVote([8, 36], 4, 0), [7, 32]);
  assert.deepEqual(withVote([0, 0], 3, 0), [0, 0]); // never below nothing, even with a stale remembered rating
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), data };
}

// The world view's ratings talking to the real Function through a pretend network.
function pageOn(s, { storage = memoryStorage(), ip = "192.0.2.50" } = {}) {
  let changes = 0;
  const ratings = createRatings({
    url: ENDPOINT,
    storage,
    onChange: () => changes++,
    fetchFn: async (url, init = {}) => {
      const res = await s.send(init.method || "GET", { body: init.body, headers: init.headers, ip });
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.json };
    },
  });
  return { ratings, storage, changes: () => changes };
}

test("the page shows a rating at once and settles on the server's totals", async () => {
  const s = site();
  await s.rate("deciv", 5, "203.0.113.1");
  await s.rate("deciv", 4, "203.0.113.2");
  const { ratings, storage, changes } = pageOn(s);
  assert.equal(ratings.open, false);
  assert.deepEqual(await ratings.choose("deciv", 3), { ok: false, error: "ignored" }); // not before the totals arrive
  await ratings.load();
  assert.equal(ratings.open, true);
  assert.deepEqual(ratings.of("deciv"), { n: 2, sum: 9, average: 4.5, mine: 0, busy: false });
  assert.deepEqual(ratings.of("us"), { n: 0, sum: 0, average: null, mine: 0, busy: false });

  const before = changes();
  const pending = ratings.choose("deciv", 3);
  assert.deepEqual(ratings.of("deciv"), { n: 3, sum: 12, average: 4, mine: 3, busy: true }); // at once
  assert.deepEqual(await ratings.choose("deciv", 1), { ok: false, error: "ignored" }); // one at a time per map
  assert.deepEqual(await pending, { ok: true, stars: 3, changed: true });
  assert.deepEqual(ratings.of("deciv"), { n: 3, sum: 12, average: 4, mine: 3, busy: false });
  assert.equal(changes() - before, 2);
  assert.equal(storage.data.get("earthciv.portRatings.v1"), '{"deciv":3}');

  assert.deepEqual(await ratings.choose("deciv", 5), { ok: true, stars: 5, changed: true }); // another star changes it
  assert.equal(ratings.of("deciv").sum, 14);
  assert.deepEqual(await ratings.choose("deciv", 5), { ok: true, stars: 0, changed: true }); // the same star takes it back
  assert.deepEqual(ratings.of("deciv"), { n: 2, sum: 9, average: 4.5, mine: 0, busy: false });
  assert.equal(storage.data.get("earthciv.portRatings.v1"), "{}");
  for (const bad of [0, 6, 2.5, "3"]) assert.equal((await ratings.choose("deciv", bad)).error, "ignored");
});

test("the page remembers the visitor's stars and corrects a stale memory from the server", async () => {
  const s = site();
  await s.rate("deciv", 5, "203.0.113.1");
  // This browser remembers 4 stars, but the server has no rating from its network (it moved to another one).
  const storage = memoryStorage({ "earthciv.portRatings.v1": JSON.stringify({ deciv: 4, us: 9, frciv: "5", junk: null }) });
  const { ratings } = pageOn(s, { storage });
  await ratings.load();
  assert.equal(ratings.of("deciv").mine, 4);
  assert.equal(ratings.of("us").mine, 0); // not a rating: ignored
  assert.equal(ratings.of("frciv").mine, 0);
  assert.deepEqual(await ratings.choose("deciv", 2), { ok: true, stars: 2, changed: true });
  assert.deepEqual(ratings.of("deciv"), { n: 2, sum: 7, average: 3.5, mine: 2, busy: false }); // the server's count, not a guess
});

test("taking back a rating given from another network is not reported as a removal", async () => {
  const s = site();
  await s.rate("deciv", 4, "2001:db8:1:1::7"); // given at home
  const storage = memoryStorage({ "earthciv.portRatings.v1": JSON.stringify({ deciv: 4 }) });
  const { ratings } = pageOn(s, { storage, ip: "198.51.100.20" }); // the same browser, now on another network
  await ratings.load();
  assert.equal(ratings.of("deciv").mine, 4);
  assert.deepEqual(await ratings.choose("deciv", 4), { ok: true, stars: 0, changed: false }); // nothing here to remove
  assert.deepEqual(ratings.of("deciv"), { n: 1, sum: 4, average: 4, mine: 0, busy: false }); // it is still counted
});

test("two tabs keep each other's remembered ratings", async () => {
  const s = site();
  const storage = memoryStorage();
  const a = pageOn(s, { storage }).ratings;
  const b = pageOn(s, { storage }).ratings; // opened before either rates
  await a.load();
  await b.load();
  await a.choose("deciv", 3);
  await b.choose("us", 5);
  assert.deepEqual(JSON.parse(storage.data.get("earthciv.portRatings.v1")), { deciv: 3, us: 5 });
  await a.choose("frciv", 1);
  assert.deepEqual(JSON.parse(storage.data.get("earthciv.portRatings.v1")), { deciv: 3, us: 5, frciv: 1 });
  assert.equal(pageOn(s, { storage }).ratings.of("deciv").mine, 3); // after a reload
});

test("inside another site's frame the page shows averages but offers no stars", async () => {
  const s = site();
  await s.rate("deciv", 5, "203.0.113.1");
  const fetchFn = async (url, init = {}) => {
    const res = await s.send(init.method || "GET", { body: init.body, headers: init.headers });
    return { ok: res.status < 300, status: res.status, json: async () => res.json };
  };
  const framed = createRatings({ url: ENDPOINT, storage: null, fetchFn, framed: () => true });
  await framed.load();
  assert.equal(framed.open, false);
  assert.equal(framed.of("deciv").average, 5);
  assert.deepEqual(await framed.choose("deciv", 1), { ok: false, error: "ignored" });
  assert.deepEqual((await s.get()).json.ratings, { deciv: [1, 5] });
  const own = createRatings({ url: ENDPOINT, storage: null, fetchFn, framed: () => false });
  await own.load();
  assert.equal(own.open, true);
});

test("a refused rating goes back to what it was", async () => {
  const s = site();
  await s.rate("deciv", 5, "203.0.113.1");
  const { ratings, storage } = pageOn(s);
  await ratings.load();
  assert.deepEqual(await ratings.choose("jpciv", 4), { ok: false, error: "unknown_port" });
  assert.deepEqual(ratings.of("jpciv"), { n: 0, sum: 0, average: null, mine: 0, busy: false });
  assert.equal(storage.data.get("earthciv.portRatings.v1"), "{}");

  for (let i = 0; i < 10; i++) assert.equal((await ratings.choose("deciv", (i % 2) + 1)).ok, true);
  assert.deepEqual(await ratings.choose("deciv", 5), { ok: false, error: "too_many_changes" });
  assert.deepEqual(ratings.of("deciv"), { n: 2, sum: 7, average: 3.5, mine: 2, busy: false });
  assert.equal(ratings.open, true);
});

test("the page shows no stars where ratings are not open, and stops offering them once they close", async () => {
  // A host without the Function serves the static file.
  const plain = createRatings({ url: ENDPOINT, storage: null, fetchFn: async () => ({ ok: true, status: 200, json: async () => JSON.parse(STATIC_FILE) }) });
  await plain.load();
  assert.equal(plain.open, false);
  assert.deepEqual(await plain.choose("deciv", 4), { ok: false, error: "ignored" });

  // A host with nothing at that address: no stars, no exception, and the next load tries again.
  const quiet = console.warn;
  console.warn = () => {};
  try {
    let calls = 0;
    const missing = createRatings({ url: ENDPOINT, storage: null, fetchFn: async () => (calls++, { ok: false, status: 404, json: async () => ({}) }) });
    await missing.load();
    await missing.load();
    assert.equal(calls, 2);
    assert.equal(missing.open, false);
    const offline = createRatings({ url: ENDPOINT, storage: null, fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
    await offline.load();
    assert.equal(offline.open, false);
  } finally {
    console.warn = quiet;
  }

  // Ratings close while the page is open: the refusal puts the stars back and stops offering them.
  const db = fakeD1();
  let server = site({ db });
  await server.rate("deciv", 5, "203.0.113.1");
  const page = createRatings({
    url: ENDPOINT,
    storage: null,
    fetchFn: async (url, init = {}) => {
      const res = await server.send(init.method || "GET", { body: init.body, headers: init.headers });
      return { ok: res.status < 300, status: res.status, json: async () => res.json };
    },
  });
  await page.load();
  assert.equal(page.open, true);
  server = site({ db, closed: true });
  assert.deepEqual(await page.choose("deciv", 1), { ok: false, error: "closed" });
  assert.equal(page.open, false);
  assert.deepEqual(page.of("deciv"), { n: 1, sum: 5, average: 5, mine: 0, busy: false });
  assert.deepEqual(await page.choose("deciv", 1), { ok: false, error: "ignored" });
});
