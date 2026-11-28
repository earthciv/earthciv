// Ratings of the maps in the world view's catalog (web/data/ports.json): one to five stars each.
//
//   GET  /data/ratings.json                              every rated map's [number of ratings, sum of their stars],
//                                                        for the maps that can be rated (rateable below)
//   POST /data/ratings.json  {"port": "<id>", "stars": 1-5}   give or change a rating; "stars": 0 takes it back
//
// This is a Cloudflare Pages Function, and it answers at the address of the static file web/data/ratings.json. That
// file says "no ratings here" ("open": false, "reason": "static"): it is what any other host serves, and what this
// Function falls back to while its database is not set up. So a copy of the site without the database simply shows
// no stars. With a database the Function answers "open": true, or "open": false with the reason: "no_secret"
// (RATINGS_SALT is not set) or "closed" (RATINGS_CLOSED is).
//
// Ratings are anonymous and there is no sign-in. One network counts once per map: a rating is stored under an HMAC of
// the visitor's IP address (for IPv6, its /64), keyed with the secret RATINGS_SALT, which is not in the database. The
// database therefore holds no addresses, and its keys cannot be turned back into them without that secret.
//
// Bindings (wrangler.toml, docs/RATINGS.md): RATINGS_DB, a D1 database, which may start empty (SCHEMA below is
// applied the first time its tables are found missing); RATINGS_SALT, the secret; and optionally RATINGS_CLOSED,
// which, when set, keeps the averages on show but takes no new ratings.

const SCALE = 5;
// How often one network may change its rating of one map in a (UTC) day. With one row per network and map, this
// bounds what a single address can write: at most this many changes per map in the catalog.
const CHANGES_PER_DAY = 10;
const MAX_BODY_BYTES = 512;
const CATALOG_TTL_MS = 60_000;

const SCHEMA = [
  // One row per network and map. `voter` is the HMAC described above, never an address. `stars` 0 is a rating that
  // was taken back (the row stays, with that network's count of changes for the day). `day` and `changes` count that
  // network's changes to this rating in one UTC day.
  `CREATE TABLE IF NOT EXISTS ratings (
     port_id    TEXT    NOT NULL,
     voter      TEXT    NOT NULL,
     stars      INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 5),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     day        TEXT    NOT NULL,
     changes    INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (port_id, voter)
   ) WITHOUT ROWID`,
  // Each map's number of ratings and the sum of their stars, so that reading every map's average touches one row per
  // map instead of every rating.
  `CREATE TABLE IF NOT EXISTS totals (
     port_id TEXT    PRIMARY KEY,
     n       INTEGER NOT NULL,
     sum     INTEGER NOT NULL
   ) WITHOUT ROWID`,
  // The database itself keeps `totals` in step with `ratings`, whoever changes a rating (this Function, or someone
  // removing ratings by hand): each change adds its difference to the map's row.
  `CREATE TRIGGER IF NOT EXISTS ratings_added AFTER INSERT ON ratings BEGIN
     INSERT OR IGNORE INTO totals (port_id, n, sum) VALUES (NEW.port_id, 0, 0);
     UPDATE totals SET n = n + (NEW.stars > 0), sum = sum + NEW.stars WHERE port_id = NEW.port_id;
   END`,
  `CREATE TRIGGER IF NOT EXISTS ratings_changed AFTER UPDATE OF stars ON ratings BEGIN
     UPDATE totals SET n = n + (NEW.stars > 0) - (OLD.stars > 0), sum = sum + NEW.stars - OLD.stars WHERE port_id = NEW.port_id;
   END`,
  `CREATE TRIGGER IF NOT EXISTS ratings_removed AFTER DELETE ON ratings BEGIN
     UPDATE totals SET n = n - (OLD.stars > 0), sum = sum - OLD.stars WHERE port_id = OLD.port_id;
   END`,
];

const UPSERT = `
  INSERT INTO ratings (port_id, voter, stars, created_at, updated_at, day, changes)
  VALUES (?1, ?2, ?3, ?4, ?4, ?5, 1)
  ON CONFLICT (port_id, voter) DO UPDATE SET
    stars = excluded.stars,
    updated_at = excluded.updated_at,
    changes = CASE WHEN ratings.day = excluded.day THEN ratings.changes + 1 ELSE 1 END,
    day = excluded.day
  WHERE ratings.stars <> excluded.stars AND (ratings.day <> excluded.day OR ratings.changes < ?6)
  RETURNING stars`;

const encoder = new TextEncoder();

function json(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

const refuse = (status, error, headers) => json({ ok: false, error }, status, headers);

/** A map can be rated when it opens inside EarthCiv: an EarthCiv edition or a community map shown in its frame. A map
 *  that opens only in a new tab cannot, nor can source code alone. */
export function rateable(port) {
  return !!port && (port.status === "merged" || (port.status === "live" && !!port.url && port.embed === true));
}

// The ids that can be rated, from the catalog this deployment serves. Kept for a minute in this isolate.
let catalog = null;
async function rateableIds(env, requestUrl) {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.ids;
  try {
    const res = await env.ASSETS.fetch(new URL("ports.json", requestUrl));
    if (!res.ok) throw new Error(`ports.json: HTTP ${res.status}`);
    const doc = await res.json();
    catalog = { at: Date.now(), ids: new Set((doc.ports || []).filter(rateable).map((p) => p.id)) };
  } catch (err) {
    console.error("ratings: could not read the catalog", err);
  }
  return catalog ? catalog.ids : null;
}

/** The part of an address that stands for one network: an IPv4 address, or an IPv6 address's /64. */
export function networkOf(ip) {
  const addr = String(ip || "").trim().toLowerCase().split("%")[0];
  if (!addr) return "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return mapped[1];
  if (!addr.includes(":")) return addr;
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** The key a network's ratings are stored under: an HMAC of the network, cut to 128 bits. */
export async function voterKey(salt, ip) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(networkOf(ip))));
  return [...mac.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The request's body as text, or null when it is longer than a rating needs.
async function smallBody(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// RATINGS_CLOSED closes ratings when it is set to anything but an explicit "no".
const closed = (env) => !!env.RATINGS_CLOSED && !/^(0|false|no|off)$/i.test(String(env.RATINGS_CLOSED).trim());
// Why this Function, with its database, takes no ratings: null when it does.
const whyNot = (env) => (!env.RATINGS_SALT ? "no_secret" : closed(env) ? "closed" : null);
const accepting = (env) => !!env.RATINGS_DB && !whyNot(env);

// Run `work`; if the database has no tables yet, make them and run it again.
async function withSchema(db, work) {
  try {
    return await work();
  } catch (err) {
    if (!/no such table/i.test(String(err?.message || err))) throw err;
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    return work();
  }
}

async function totalsOf(db, port) {
  const row = await db.prepare("SELECT n, sum FROM totals WHERE port_id = ?1").bind(port).first();
  return [row?.n || 0, row?.sum || 0];
}

async function summary(context) {
  const { request, env } = context;
  const db = env.RATINGS_DB;
  // Without the database, or when it cannot be read, the static file answers: "open": false and no ratings.
  if (!db) return context.next();
  let rows;
  try {
    rows = (await withSchema(db, () => db.prepare("SELECT port_id, n, sum FROM totals WHERE n > 0 ORDER BY port_id").all())).results;
  } catch (err) {
    console.error("ratings: could not read the totals", err);
    return context.next();
  }
  // A map that can no longer be rated (it opens only in a new tab now, or left the catalog) keeps its ratings in the
  // database, but they are not reported, so nothing shows a rating it cannot take. They count again if it can be
  // rated again. Without the catalog every total is reported, and the page still offers stars only where they work.
  const ids = await rateableIds(env, request.url);
  const ratings = {};
  for (const r of rows) if (!ids || ids.has(r.port_id)) ratings[r.port_id] = [r.n, r.sum];
  const reason = whyNot(env);
  const body = { version: 1, open: !reason, ...(reason ? { reason } : {}), scale: SCALE, ratings };
  // The totals are public figures, so any page may read them.
  return json(request.method === "HEAD" ? null : body, 200, { "access-control-allow-origin": "*" });
}

async function rate({ request, env }) {
  if (!accepting(env)) return refuse(503, "closed");

  // A rating must come from this site's own pages. A page on another site cannot send JSON here without asking first
  // (a CORS preflight, which this Function does not grant), and what it could send without asking is refused.
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== "same-origin")) {
    return refuse(403, "cross_site");
  }
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") || "")) return refuse(415, "json_only");

  const text = await smallBody(request);
  if (text === null) return refuse(413, "too_long");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "bad_json");
  }
  const port = body?.port;
  const stars = body?.stars;
  if (typeof port !== "string" || !/^[a-z0-9-]{1,64}$/.test(port)) return refuse(400, "bad_port");
  if (!Number.isInteger(stars) || stars < 0 || stars > SCALE) return refuse(400, "bad_stars");

  const ids = await rateableIds(env, request.url);
  if (!ids) return refuse(503, "no_catalog");
  if (!ids.has(port)) return refuse(404, "unknown_port");

  const db = env.RATINGS_DB;
  try {
    const voter = await voterKey(env.RATINGS_SALT, request.headers.get("cf-connecting-ip"));
    const now = new Date();
    const day = now.toISOString().slice(0, 10);

    return await withSchema(db, async () => {
      const own = db.prepare("SELECT stars, day, changes FROM ratings WHERE port_id = ?1 AND voter = ?2").bind(port, voter);
      const prev = await own.first();
      // `changed` tells the page whether this request stored anything: taking back a rating that this network never
      // gave (it was given from another one) changes nothing.
      let changed = false;
      if (prev ? prev.stars !== stars : stars > 0) {
        if (prev && prev.day === day && prev.changes >= CHANGES_PER_DAY) return refuse(429, "too_many_changes");
        // The statement returns a row only when it stored the rating; the database's triggers bring the map's totals
        // along in the same step. Another request from this network may have got in since the read above, so it is
        // this answer, not that read, that says what happened.
        const stored = await db.prepare(UPSERT).bind(port, voter, stars, Math.floor(now.getTime() / 1000), day, CHANGES_PER_DAY).first();
        changed = !!stored;
        if (!changed && ((await own.first())?.stars ?? 0) !== stars) return refuse(429, "too_many_changes");
      }
      return json({ ok: true, port, stars, changed, rating: await totalsOf(db, port) });
    });
  } catch (err) {
    console.error("ratings: could not save", err);
    return refuse(503, "unavailable");
  }
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method === "GET" || method === "HEAD") return summary(context);
  if (method === "POST") return rate(context);
  return refuse(405, "method_not_allowed", { allow: "GET, HEAD, POST" });
}
