# Ratings

Visitors can give each map in the world view one to five stars. A map's card shows its average and how many people
rated it, with five stars beside them. Picking a star rates the map, picking another changes the rating, and picking
the same star again takes it back. A map opened inside EarthCiv has the same stars in the bar above it (not on
phones, where the bar has no room: there a map is rated on its card).

A map can be rated when it can be opened: an EarthCiv edition, or a community map with a site. A map that is source
code only cannot, and neither can a link a visitor added for themselves.

There is no sign-in. One network counts once per map, which is close to, but not the same as, one person
([What is stored](#what-is-stored)).

## How it works

| File | What it does |
| --- | --- |
| `web/data/ratings.json` | A static file that says ratings are not open: `{"version": 1, "open": false, "reason": "static", "scale": 5, "ratings": {}}`. |
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
     → {"ok": true, "port": "<map id>", "stars": 4, "changed": true, "rating": [number of ratings, sum of their stars]}
```

`"open"` says whether ratings can be given; when it is `false`, `"reason"` says why
([Setting it up](#setting-it-up) lists the reasons). The map ids are those of `web/data/ports.json`, which the
Function reads from the deployed site to decide what can be rated. `"changed"` is `false` when the request stored
nothing: the rating was already that, or there was no rating from this network to take back. A refused POST answers
`{"ok": false, "error": "<reason>"}` with status 400 (not a rating), 403 (sent from another site), 404 (not a map
that can be rated), 413, 415, 429 (changed too often today) or 503 (closed, or the database failed).

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

Three things follow from keying a rating by network:

- People who share a network (a household, an office, some phone carriers) share one rating per map. The last one
  given stands.
- One person on two networks is two networks: at home and on phone data, or on a connection that reaches the site
  over IPv4 one day and IPv6 the next. A rating can be changed or taken back only from the network it was given
  from. Changing it from another network adds a second rating, and taking it back from another network removes
  nothing: the page then says there was no rating from this network to remove, instead of claiming it was removed.
- If `RATINGS_SALT` changes, every rating already given stays counted but is cut loose from its network: nobody can
  change or take back theirs, and the same network can rate again. Keep the secret as it is.

## Limits

- A rating must come from the site's own pages (same origin, sent as JSON), so a page on another site cannot send
  one from its visitors' browsers. Inside another site's frame the page offers no stars to click (the averages
  stay), so that site cannot cover the frame and steer clicks onto them.
- One rating per map from each network, changed at most 10 times in one UTC day. The answer to a change says
  whether it was stored, also when several arrive at once.
- Only maps in the catalog that can be opened. The request can be at most 512 bytes.

With no sign-in, these stop accidents and casual ballot-stuffing. They do not stop someone who has many addresses,
and that takes little: a home IPv6 connection is often given hundreds of /64 networks, and a VPN or a phone hands
out fresh addresses. If ratings get stuffed, close them (below), remove what was stuffed, and put a Cloudflare
rate-limiting rule or Turnstile in front of the POST.

On Cloudflare's free plan the account has daily allowances (checked 2026-11-26): 100,000 Function requests, of
which each visit to the world map uses one and every other file of the site none, and for D1 5 million rows read and
100,000 rows written. A rating writes two rows. When an allowance runs out the stars disappear until midnight UTC
and the rest of the site carries on; the D1 allowance is shared with any other database in the account. Nothing in
the Function limits reading, so one address that reads the ratings 100,000 times in a day uses up the Function
allowance for everyone. A rate-limiting rule for `/data/ratings.json` on the custom domain is the guard against
that.

## Setting it up

Once per deployment. earthciv.org's database exists: it is the one `wrangler.toml` names. A copy of this project
deployed elsewhere makes its own, or drops the `[[d1_databases]]` block and shows no stars. Wrangler needs Node 22.12
or newer and the login saved by `wrangler login`.

```sh
npx --yes wrangler@4.168.0 d1 create earthciv-ratings
```

It prints a `database_id`. Put it in `wrangler.toml` and commit that:

```toml
[[d1_databases]]
binding = "RATINGS_DB"
database_name = "earthciv-ratings"
database_id = "<the id>"
```

Then set the secret and deploy as usual ([DEPLOY.md](DEPLOY.md)); a secret takes effect with the next deployment.
The secret is set per environment: production by default, and `--env preview` for the deployments of any other
branch. Both environments use the database that `wrangler.toml` names, so ratings given on a preview deployment are
real ones.

```sh
openssl rand -hex 32 | npx --yes wrangler@4.168.0 pages secret put RATINGS_SALT --project-name=usaciv-canada
```

`https://<site>/data/ratings.json` then answers `"open": true`, and the stars appear on the maps' cards. If it
answers `"open": false`, its `"reason"` says what is missing:

| `"reason"` | What it means |
| --- | --- |
| `"static"` | The static file answered. No database is bound (the `[[d1_databases]]` block), or the Function was not uploaded (the deploy was not run in the project's root folder). |
| `"no_secret"` | The Function and its database are there, but `RATINGS_SALT` is not set, or was set after the last deployment. Set it and deploy again. |
| `"closed"` | `RATINGS_CLOSED` is set ([Looking after it](#looking-after-it)). |

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
  SELECT port_id, SUM(stars > 0), SUM(stars) FROM ratings GROUP BY port_id;
```

Every map with a row in `ratings` must keep its row in `totals`, also when all its ratings were taken back (they
stay as rows with 0 stars): the triggers add each change to that row.

**Turn ratings off:** remove the `[[d1_databases]]` block and deploy. The static file answers again, and the stars
are gone. The database keeps what it has until it is deleted.

## Tests

`tests/test_ratings.py` checks the files and settings, and runs `tests/js/ratings.test.mjs` when it finds Node 22.13
or newer: the Function against a real SQLite database, and the page's rules against the Function.
