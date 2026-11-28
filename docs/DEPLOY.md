# Deploying

The site is static. Packaging writes `dist/usaciv/` with the site, generated social preview pages and images,
`robots.txt` and `sitemap.xml`, and `usaciv-source.zip`, a copy of the project linked from the in-app help. Preview
pages expose their city or lens in the URL path so social crawlers can read the card from the original HTML. The
sitemap lists the world map and each edition (`?country=<id>`), on the address in `web/index.html`'s `og:url`.
Packaging gives the JavaScript directory a name derived from its contents. The app and share pages use that
directory so the browser loads all modules from the same build after a deploy.

One thing runs on the server: the Pages Function in `functions/`, which keeps the star ratings people give the maps
in the world view. It needs a database and a secret, set up once ([RATINGS.md](RATINGS.md)). Without them the site
deploys and works the same, and shows no stars.

Production is the Cloudflare Pages project `usaciv-canada`, created by direct upload. It answers at
https://usaciv-canada.pages.dev and at the custom domain https://earthciv.org. Its settings are in `wrangler.toml`.

One setting is not in that file: Web Analytics, which counts the site's visits
([what it counts](../README.md#privacy)). It is switched on in the Cloudflare dashboard, under Workers & Pages →
`usaciv-canada` → Metrics. From the next deployment on, Cloudflare adds its script to the end of every page it
serves. The script is not in `dist/usaciv/`, and a copy of this project deployed elsewhere does not get it.

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
- Beside the world map, under "EarthCiv editions", every edition has the same row, with its maker's picture and
  X handle. A row opens its edition.
- An old link without `?country=`, such as https://earthciv.org/#city=35620, still opens the United States.
- **Share → Copy link** on a city or a lens creates a `/share/` URL. Its HTML has the matching title and preview
  image, and opening it in a browser restores the map view.
- https://earthciv.org/usaciv-source.zip has the same SHA-256 as `dist/usaciv/usaciv-source.zip`.
- https://earthciv.org/data/ratings.json answers `"open": true` once the ratings are set up, and a map's card on the
  world map shows its stars. With `"open": false` its `"reason"` says what is missing: `"static"` (no database is
  bound, or the Function was not uploaded), `"no_secret"` or `"closed"` ([RATINGS.md](RATINGS.md)).
- https://earthciv.org/robots.txt names the sitemap, https://earthciv.org/sitemap.xml lists the world map and every
  edition, and an unknown address such as https://earthciv.org/no-such-page answers 404.
- In the browser, each view's `link[rel=canonical]` is its own address: `https://earthciv.org/` on the world map,
  `https://earthciv.org/?country=ca` on Canada. The page sets it; the HTML file has none.
- While Web Analytics is switched on, the page loads Cloudflare's script:
  `curl -s https://earthciv.org/ | grep -c cloudflareinsights` prints `1`. It prints `0` when the deployment was
  made before the switch, or the switch is off.
- The browser console shows no errors on either edition.
