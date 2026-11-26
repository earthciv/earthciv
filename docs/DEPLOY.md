# Deploying

The site is static. `python -m pipeline package` writes it to `dist/usaciv/`: everything in `web/` except the dev
pages, plus `usaciv-source.zip`, a copy of this project that the in-app help links to.

Production is the Cloudflare Pages project `usaciv-canada`, created by direct upload. It answers at
https://usaciv-canada.pages.dev and at the custom domain https://earthciv.org.

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
uv run python -m pipeline package
npx --yes wrangler@4.168.0 pages deploy dist/usaciv --project-name=usaciv-canada --branch=main
```

Wrangler 4.168 needs Node 22.12 or newer, and uses the login saved by `wrangler login`. Deploy committed work, so the
deployment records the commit.

## Checks after a deploy

- https://earthciv.org/ opens on the world map. Clicking a country opens its card; the Play buttons open the United
  States (`?country=us`) and Canada (`?country=ca`), and the World button in each edition brings the world map back.
- An old link without `?country=`, such as https://earthciv.org/#city=35620, still opens the United States.
- https://earthciv.org/usaciv-source.zip has the same SHA-256 as `dist/usaciv/usaciv-source.zip`.
- The browser console shows no errors on either edition.
