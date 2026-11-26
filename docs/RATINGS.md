# Ratings

Visitors can give each map in the world view one to five stars. A map's card shows its average and how many people
rated it, with five stars beside them. Picking a star rates the map, picking another changes the rating, and picking
the same star again takes it back. A map opened inside EarthCiv has the same stars in the bar above it (not on
phones, where the bar has no room: there a map is rated on its card).

A map can be rated when it can be opened: an EarthCiv edition, or a community map with a site. A map that is source
code only cannot, and neither can a link a visitor added for themselves.

There is no sign-in. One network counts once per map.

## How it works

| File | What it does |
| --- | --- |
| `web/data/ratings.json` | A static file that says ratings are not open: `{"version": 1, "open": false, "scale": 5, "ratings": {}}`. |
| `functions/data/ratings.json.js` | A Cloudflare Pages Function that answers at the same address, `/data/ratings.json`, from a D1 database. |
| `web/js/ext/ports/ratings.js` | The world view's side: reads the ratings, draws the stars, sends a visitor's rating. |

On a host with no Function (any static host, `python -m pipeline serve`), the browser gets the static file, and the
world view shows no stars. The Function also hands a request to that file while it has no database. So a copy of
this project works without any of the setup below.

The Function answers two requests:

```
GET  /data/ratings.json
     → {"version": 1, "open": true, "scale": 5, "ratings": {"<map id>": [number of ratings, sum of their stars]}}

POST /data/ratings.json     {"port": "<map id>", "stars": 4}        ("stars": 0 takes the rating back)
     → {"ok": true, "port": "<map id>", "stars": 4, "rating": [number of ratings, sum of their stars]}
```

`"open"` says whether ratings can be given. The map ids are those of `web/data/ports.json`, which the Function reads
from the deployed site to decide what can be rated. A refused POST answers `{"ok": false, "error": "<reason>"}` with
status 400 (not a rating), 403 (sent from another site), 404 (not a map that can be rated), 413, 415, 429 (changed
too often today) or 503 (closed, or the database failed).

The database has two tables, which the Function creates the first time it finds them missing (`SCHEMA` in the
Function): `ratings`, one row per network and map, and `totals`, one row per map with its number of ratings and the
sum of their stars. Triggers in the database keep `totals` in step with `ratings`, so reading every map's average
touches one row per map, and a rating costs the same however many a map has.

## What is stored

- **In the database:** the map's id, a key that stands for the visitor's network, the stars, when the rating was
  first given and last changed, and how many times it changed that day. The key is an HMAC-SHA-256 of the visitor's
  IP address (for IPv6, its /64 prefix), keyed with the secret `RATINGS_SALT` and cut to 128 bits. The address
  itself is not stored and not logged, and the secret is not in the database.
- **In the visitor's browser:** the stars they picked (`localStorage`, key `earthciv.portRatings.v1`), only to show
  them again.

Two things follow from keying a rating by network:

- People who share a network (a household, an office, some phone carriers) share one rating per map. The last one
  given stands.
- If `RATINGS_SALT` changes, every rating already given stays counted but is cut loose from its network: nobody can
  change or take back theirs, and the same network can rate again. Keep the secret as it is.

## Limits

- A rating must come from the site's own pages (same origin, sent as JSON). A page on another site cannot make its
  visitors' browsers rate a map.
- One rating per map from each network, changed at most 10 times in one UTC day.
- Only maps in the catalog that can be opened. The request can be at most 512 bytes.

With no sign-in, these stop accidents and casual ballot-stuffing. They do not stop someone with many addresses. If
that happens, close ratings (below), remove what was stuffed, and put a Cloudflare rate-limiting rule or Turnstile
in front of the POST.

On Cloudflare's free plan the account has daily allowances (checked 2026-11-26): 100,000 Function requests, of
which each visit to the world map uses one and every other file of the site none, and for D1 5 million rows read and
100,000 rows written. A rating writes two rows. When an allowance runs out the stars disappear until midnight UTC
and the rest of the site carries on; the D1 allowance is shared with any other database in the account.

## Setting it up

Once per deployment. Wrangler needs Node 22.12 or newer and the login saved by `wrangler login`.

```sh
npx --yes wrangler@4.168.0 d1 create earthciv-ratings
```

It prints a `database_id`. Put it in `wrangler.toml`, in the block that is commented out there, and commit that:

```toml
[[d1_databases]]
binding = "RATINGS_DB"
database_name = "earthciv-ratings"
database_id = "<the id>"
```

Then set the secret and deploy as usual ([DEPLOY.md](DEPLOY.md)); a secret takes effect with the next deployment.

```sh
openssl rand -hex 32 | npx --yes wrangler@4.168.0 pages secret put RATINGS_SALT --project-name=usaciv-canada
```

`https://<site>/data/ratings.json` then answers `"open": true`, and the stars appear on the maps' cards.

## Running it locally

```sh
npx --yes wrangler@4.168.0 pages dev web --d1 RATINGS_DB --binding RATINGS_SALT=any-local-secret
```

That serves `web/` with the Function at http://localhost:8788 and keeps a local database under `.wrangler/`
(not in git). Nothing reaches the deployed site or its database.

## Looking after it

Every map's count and average:

```sh
npx --yes wrangler@4.168.0 d1 execute earthciv-ratings --remote \
  --command "SELECT port_id, n, ROUND(1.0 * sum / n, 2) AS average FROM totals WHERE n > 0 ORDER BY n DESC"
```

**Close ratings** while keeping the averages on show: add this to `wrangler.toml` and deploy. Remove it and deploy to
open them again.

```toml
[vars]
RATINGS_CLOSED = "1"
```

**Remove ratings**, for example one map's since a given time. The totals follow by themselves:

```sh
npx --yes wrangler@4.168.0 d1 execute earthciv-ratings --remote \
  --command "DELETE FROM ratings WHERE port_id = 'some-map' AND updated_at >= unixepoch('2026-12-01 00:00:00')"
```

If the totals are ever in doubt, count them again from the ratings:

```sql
DELETE FROM totals;
INSERT INTO totals (port_id, n, sum)
  SELECT port_id, COUNT(*), SUM(stars) FROM ratings WHERE stars > 0 GROUP BY port_id;
```

**Turn ratings off:** remove the `[[d1_databases]]` block and deploy. The static file answers again, and the stars
are gone. The database keeps what it has until it is deleted.

## Tests

`tests/test_ratings.py` checks the files and settings, and runs `tests/js/ratings.test.mjs` when it finds Node 22.13
or newer: the Function against a real SQLite database, and the page's rules against the Function.
