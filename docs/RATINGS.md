# Ratings

Visitors can give each map in the world view one to five stars. A map's card shows its average and how many people
rated it, with five stars beside them. Picking a star rates the map, picking another changes the rating, and picking
the same star again takes it back. A map that is open has the same stars in the bar above it: a community map
opened inside EarthCiv in its bar, an EarthCiv edition at the end of its top bar's first row. A phone's bar has no
room for them: there a map is rated on its card.

A map can be rated here when it opens here: an EarthCiv edition, or a community map shown inside EarthCiv. A map
that opens only in a new tab cannot, nor can a map that is source code only, nor a link a visitor added for
themselves. Every listed map is meant to open inside EarthCiv ([Add your map](../README.md#add-your-map)), and the
stars are part of that visit. A map that stops opening inside keeps its ratings in the database, but they are not
shown or counted anywhere on the site, and they come back if it opens inside again.

There is no sign-in. One network counts once per map, which is close to, but not the same as, one person
([What is stored](#what-is-stored)).

## How it works

| File | What it does |
| --- | --- |
| `web/data/ratings.json` | A static file that says ratings are not open: `{"version": 1, "open": false, "reason": "static", "scale": 5, "ratings": {}}`. |
| `functions/data/ratings.json.js` | A Cloudflare Pages Function that answers at the same address, `/data/ratings.json`, from a D1 database. |
| `web/js/ext/ports/ratings.js` | The world view's side: reads the ratings, draws the stars, sends a visitor's rating. |
| `web/js/ext/ports/rankingsRatings.js` | World Rankings' Ratings tab: the maps in order of their ratings ([below](#the-ratings-tab-of-world-rankings)). |

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
Function reads from the deployed site to decide what can be rated, and `"ratings"` lists only maps that can be.
`"changed"` is `false` when the request stored
nothing: the rating was already that, or there was no rating from this network to take back. A refused POST answers
`{"ok": false, "error": "<reason>"}` with status 400 (not a rating), 403 (sent from another site), 404 (not a map
that can be rated), 413, 415, 429 (changed too often today) or 503 (closed, or the database failed).

The database has two tables, which the Function creates the first time it finds them missing (`SCHEMA` in the
Function): `ratings`, one row per network and map, and `totals`, one row per map with its number of ratings and the
sum of their stars. Triggers in the database keep `totals` in step with `ratings`, so reading every map's average
touches one row per map, and a rating costs the same however many a map has.

## The Ratings tab of World Rankings

World Rankings on the world map has one tab that is not the World Bank's and does not rank countries: **Ratings**,
which ranks the maps themselves by their ratings, each beside its maker (`#rankings=ratings`). It is made in the
browser from the same totals as the stars, so it needs nothing more from the server, and it follows a rating as
soon as it is given.

- **Which maps are listed.** Every map that can be rated: an EarthCiv edition or a community map that opens inside
  EarthCiv, whether it is of one country, of a part of one, or of several. In the catalog of 2026-11-28 that is 60
  of the 75 maps: of the other 15, 12 are source code only and 3 open only in a new tab.
- **A map's score** starts in the middle of the scale, at 3 of 5, and its ratings pull it from there: with `n`
  ratings whose stars add up to `sum`, it is `(3 × 3 + sum) / (3 + n)`, rounded to two decimals. That is the average
  of the ratings, counted as if the map also had three ratings of 3 stars.

  | Ratings | Score |
  | --- | --- |
  | none | not ranked |
  | one of 5 stars | 3.50 |
  | ten of 5 stars | 4.54 |
  | a hundred of 5 stars | 4.94 |
  | one of 1 star | 2.50 |
  | any number that average 3 stars | 3.00 |

  So a map is ranked from its first rating, one rating does not outrank many, and a map's score depends on its own
  ratings alone: rating one map never moves another map's score, only its place.
- **Places.** Maps are ranked on the score as it is written. Equal scores share a place, as equal figures do in
  the other tabs: a map's place is one more than the number of maps with a higher score.
- **Where the score does not decide.** Among maps that share a place, the one with more ratings is listed first.
  After that, and among the maps nobody has rated yet, the maps take turns: the catalog's order, moved round by one
  place every day (UTC), as in the list of makers. So no map comes first for its name, or for the day it was added.
- **Not ranked.** A map that can be rated and has no rating yet is listed after the ranked ones. A map that cannot
  be rated is not listed.
- **The maker.** Each row names the map's maker as the map's card does: their picture, their name, and their X
  account where the catalog has one (`web/js/ext/ports/makers.js`).

A row opens the card of the map's country with that map first, as the map's pin does. For a map of several
countries that is the visitor's own country when the map covers it, and otherwise the country its pin stands in.
A rated map's card says where the map stands, under its stars. The world map keeps the maps' pins under this tab:
the other tabs colour the countries, and this one has no country to colour.

The tab is there when ratings can be given or some have been, as a map's stars are. On a host without the Function
the tab is missing and World Rankings has the World Bank's tabs alone. Where ratings are closed, the tab shows the
scores and does not ask for ratings.

[Limits](#limits) says what the ratings can and cannot withstand. The same holds for this ranking: it is a poll of
the people who chose to rate, and while a map has few ratings, a few more can move it a long way. Each row
therefore shows the number of ratings behind its score.

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
- Only maps in the catalog that open inside EarthCiv. The request can be at most 512 bytes.

With no sign-in, these stop accidents and casual ballot-stuffing. They do not stop someone who has many addresses,
and that takes little: a home IPv6 connection is often given hundreds of /64 networks, and a VPN or a phone hands
out fresh addresses. If ratings get stuffed, close them (below), remove what was stuffed, and put a Cloudflare
rate-limiting rule or Turnstile in front of the POST.

On Cloudflare's free plan the account has daily allowances (checked 2026-11-26): 100,000 Function requests, and for
D1 5 million rows read and 100,000 rows written. Each visit to the world map uses one Function request, and so does
each edition opened on a screen wider than a phone, where its top bar shows the stars. Every other file of the site
uses none. A rating writes two rows. When an allowance runs out the stars disappear until midnight UTC
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

**Preview deployments take no ratings.** A secret is set per environment: production by default, and
`--env preview` for the deployments of any other branch. Both environments use the database that `wrangler.toml`
names, so a preview deployment that took ratings would add real ones, under another secret than earthciv.org's: a
second way to rate the same map. On earthciv.org's project the preview environment therefore has `RATINGS_CLOSED`
set. Its deployments show the averages, take no ratings and answer `"open": false, "reason": "closed"`.

```sh
printf 1 | npx --yes wrangler@4.168.0 pages secret put RATINGS_CLOSED --project-name=usaciv-canada --env preview
```

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

That closes them wherever the file is deployed. To close one environment only, set `RATINGS_CLOSED` as a secret for
it instead, as the preview environment has it ([Setting it up](#setting-it-up)), and delete the secret to open it
again. Either way the change comes with that environment's next deployment: a deployment keeps the settings it was
made with, so one that should stop taking ratings at once has to be replaced or deleted.

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
`tests/test_world_rankings.py` runs `tests/js/rankingsRatings.test.mjs`, the Ratings tab's rules and its screen.
