# Deploying

The site is static. Packaging writes `dist/usaciv/` with the site, generated social preview pages and images,
and `usaciv-source.zip`, a copy of the project linked from the in-app help. Preview pages expose their city or
lens in the URL path so social crawlers can read the card from the original HTML.

One thing runs on the server: the Pages Function in `functions/`, which keeps the star ratings people give the maps
in the world view. It needs a database and a secret, set up once ([RATINGS.md](RATINGS.md)). Without them the site
deploys and works the same, and shows no stars.

Production is the Cloudflare Pages project `usaciv-canada`, created by direct upload. It answers at
https://usaciv-canada.pages.dev and at the custom domain https://earthciv.org. Its settings are in `wrangler.toml`.

## Before a deploy

```sh
uv run python -m unittest discover -s tests          # the rules in the builders
uv run python -m pipeline check                       # the U.S. data against docs/DATA_CONTRACTS.md
```

If the Canadian data should change, rebuild it first. The build uses the pinned `build` dependency group and the input
cache in `data/raw/canada` (archived with checksums outside git):

```sh
uv run --group build python -m pipeline.canada       # about 90 seconds; offline when the cache is complete
git status --short web/data/ca                        # empty unless the data was meant to change
```

## Deploy

```sh
uv run --group harness python -m playwright install chromium-headless-shell  # once
uv run --group harness python -m pipeline package
npx --yes wrangler@4.168.0 pages deploy dist/usaciv --project-name=usaciv-canada --branch=main
```

Wrangler 4.168 needs Node 22.12 or newer, and uses the login saved by `wrangler login`. Deploy committed work, so the
deployment records the commit.

Run them in the project's root folder. Wrangler reads `wrangler.toml` and compiles `functions/` from the
folder it is run in; from anywhere else the site would upload without its Function, and the ratings would turn off.

## Checks after a deploy

- https://earthciv.org/ opens on the world map. Clicking a country opens its card; the Play buttons open the United
  States (`?country=us`) and Canada (`?country=ca`), and the World button in each edition brings the world map back.
- The United States and Canada cards beside the world map each show a picture of their map.
- An old link without `?country=`, such as https://earthciv.org/#city=35620, still opens the United States.
- **Share → Copy link** on a city or a lens creates a `/share/` URL. Its HTML has the matching title and preview
  image, and opening it in a browser restores the map view.
- https://earthciv.org/usaciv-source.zip has the same SHA-256 as `dist/usaciv/usaciv-source.zip`.
- https://earthciv.org/data/ratings.json answers `"open": true` once the ratings are set up, and a map's card on the
  world map shows its stars. With `"open": false` its `"reason"` says what is missing: `"static"` (no database is
  bound, or the Function was not uploaded), `"no_secret"` or `"closed"` ([RATINGS.md](RATINGS.md)).
- The browser console shows no errors on either edition.
