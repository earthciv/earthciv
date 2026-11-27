# Editions

An edition is one country on the map: a folder of data under `web/data/<id>/`. The engine in `web/js` is the same for
every edition. This page is the format a new country has to follow; the data files themselves are specified in
[DATA_CONTRACTS.md](DATA_CONTRACTS.md).

```
web/data/
  editions.json          the list of editions and the default one
  us/  ca/  …            one folder per edition, named by its id
    edition.json         the manifest: names, terms, currency, display hints, which files exist
    text.json            the text pack: every sentence that differs between editions
    world.json …         the data files the manifest lists
    home.jpg, home-small.jpg   optional: pictures of its map for its card on the world map
```

## The one rule

The engine never asks which edition it is showing. No code compares the edition with an id (`if (id === "ca")`).
A difference between two editions comes from one of three places:

1. **The manifest**: the country's name in the forms sentences need, its terms for regions and divisions, its
   currency, display hints for its map.
2. **The text pack**: wording, from a button label to a page of the Almanac.
3. **The shape of the data**: a field that is there or not, or a rule the data declares (see the table below). Code
   that reads `cities[i].unemployment_census` works for any country whose cities have it.

`tests/test_editions.py` checks this, along with the manifests and text packs.

## Choosing the edition

`?country=<id>` opens any edition in `editions.json`. The main page opens on the world map, and legacy links with
edition state in the hash (such as `/#city=35620`) open the default edition. Links from the main page always carry
`?country=<id>` for an edition. Pages without `data-home="world"` open on their default edition, determined by
`data-default-country`, then `default` in `editions.json`, then the first edition listed.

## editions.json

```json
{
  "contract": 3,
  "default": "us",
  "editions": [
    {"id": "us", "name": "United States", "emblem": "★", "home_pictures": true},
    {"id": "ca", "name": "Canada", "emblem": "🍁", "home_pictures": true}
  ]
}
```

The map menu at the top left lists the editions in this order, before the community maps. `id` is the folder name:
lower case, the country's ISO 3166-1 alpha-2 code where there is one. `name` and `emblem` repeat the manifest's, so
the menu can be built without loading every manifest.

`emblem` is drawn on the round badge of the edition's card on the world map and of its share images. Beside the
edition's name, in the menu and in lists, an emblem that is an emoji (🍁) is the edition's icon. One that is not, such
as the U.S. star, would read as no icon there, so the country's flag takes its place (`web/js/ui/mapPicker.js`).

`home_pictures` is optional. `true` says the edition's folder has two pictures of its own map, which the world map
shows on the edition's card: `home.jpg` (716 × 208 px) where the card is wide, and `home-small.jpg` (519 × 288 px)
where two cards sit side by side, on a phone or in a low window. Without it the card is a plain row, and the world
map asks for no picture. `pipeline/home_pictures.py` makes both files from the running map.

## edition.json

| Field | Required | What it is |
| --- | --- | --- |
| `contract` | yes | `3` |
| `id`, `name`, `emblem` | yes | As in `editions.json`. |
| `title` | yes | The page title: `"EarthCiv — Canada as a strategy game"`. Search engines list each edition as its own page, so it should differ from the world map's title and every other edition's. |
| `description` | no | The page's description for search results. Without it the edition shows the world map's. |
| `map_label` | yes | The map's accessible name: `"Hex map of Canada"`. |
| `files` | yes | The data files that exist, without `.json`. The app requests only these, so a missing optional file is not an error; a listed file that fails to load is. `world`, `cities` and `nation` are required. |
| `text` | yes | The text pack's file name, `"text.json"`. |
| `nation` | no | The country's name as sentences need it. Each form defaults to `name`. |
| `currency` | no | `code` (ISO 4217, `"CAD"`), `symbol` (`"CA$"`), `words` (`"Canadian dollars"`). Defaults to U.S. dollars. |
| `terms` | no | What the country calls its places; see below. |
| `label_years` | no | `true` when the edition's figures come from different years, so every figure is shown with its year. |
| `off_map` | no | Regions with data but no hexes (the U.S.: Alaska and Hawaii), listed in reports with a note. |
| `view` | no | Display hints for the map; see below. |
| `sources.roles` | no | Which entry of `sources.json` stands for each kind of figure (`areas`, `population`, `growth`, `gdp`, `metro_gdp`, `land`, `cover`, `power`, `unemployment`, `citizens`), so a panel can cite the right source without knowing the country. |

`nation` forms, with the U.S. and Canadian values:

| Form | Used as | U.S. | Canada |
| --- | --- | --- | --- |
| `code` | tight labels ("×US") | `US` | `CA` |
| `short` | "U.S. 6.8%" | `U.S.` | `Canada` |
| `vs` | "▲ US 5.0%" | `US` | `Canada` |
| `the` | "of the U.S." | `the U.S.` | `Canada` |
| `in` | "in the U.S." | `in the U.S.` | `in Canada` |
| `poss` | "U.S. GDP" | `U.S.` | `Canada's` |
| `the_poss` | "the U.S. share" | `the U.S.` | `Canada's` |
| `adj` | "the U.S. mix" | `U.S.` | `Canadian` |

`terms` has three groups, each with singular and plural forms and a few labels:

- `region`: the first-level division (`State`, `Province or territory`): `one`, `many`, `short`, `column`
  (a table header), `short_many`, and `extra` for a region that is not one in name (the U.S.: DC).
- `division`: the second level (`county`, `census division`): `one`, `many`, `One`, `Many`, `short_many`.
- `area`: what a city is (`metro`, `city`): `one`, `many`, `areas`, `metro`, `micro`, `metro_long`, `micro_long`,
  `ranked`, `both`.

`view` hints, all optional:

| Hint | What it does |
| --- | --- |
| `home_dock_band` | Pixels of the home view kept clear above the lens dock (a tall country fits better). |
| `banner_floor_scale` | Below this zoom, city banners shrink no further. |
| `resource_groups` | How the Energy advisor groups resource types (`id`, `label`, `types`). |
| `trade_arcs_one_side` | Draw every trade route bending the same way. |
| `emblem_color` | The emblem's colour on share images. |

## text.json

A flat object from keys to wording. Keys are dotted and grouped by the part of the app that reads them: `load.`,
`search.`, `panel.`, `report.`, `cv.` (the City View), `citizens.`, `fields.`, `advisor.<id>.`, `layers.`, `almanac.`,
`share.`. A value is a string, or a list or object of strings where the code reads one (`citizens.phrases`).

- `{name}` placeholders are filled by the code: `"cv.workforce_compare": "its {adj} share"`.
- Code reads plain text with `txt(key)` and escapes it like any other data. It reads HTML with `rich(key)`, which keeps
  only a few tags (`a abbr b br code em h3 h4 i kbd li ol p small span strong sub sup table tbody td th thead tr ul`)
  and attributes (`class title href target colspan rowspan`). Links must be `https://`, `http://`, `#…` or relative;
  placeholder values are escaped. A pack is data and is never run as code.
- Most keys have neutral wording in the code (registered with `defaults({...})`), so a pack only needs the keys
  where its country differs. Write the country's own agencies, tables and spellings in its pack, not in the code.
- A key the code reads only behind `hasText(key)` is optional: without it, that sentence or note is left out.

## Data that replaces country checks

Where editions differ in what their data means, the data says so, and the code follows it:

| Data | Meaning | Read by |
| --- | --- | --- |
| `districts.json` `rule.counts: "workers"` | district figures count residents who work, not jobs | `ext/cityView/districts.js`, `ext/advisors/core/data.js` |
| `districts.json` `rule.military_encampments: false` | no Encampment district from military jobs | `ext/cityView/screen.js` |
| `districts.json` `national.avg_pay` | pay columns are shown only when present | `ext/cityView/districts.js` |
| `wonders.json` `rules[].measure`, `among` | what a wonder ranking measures, and among which sites | `ext/layers/tips.js` |
| `nation.json` `income_year` | the year incomes refer to, when it is not the survey year | `ui/infoPanel.js`, `ext/cityView/screen.js` |
| `cities.json`, `states.json` `census_population`, `gdp_population` | the population a figure divides by, from the figure's own year | `ui/yieldReport.js`, `ui/infoPanel.js` |
| `cities.json`, `states.json` `unemployment_census` | unemployment from the census where the labour survey has none | `ui/cityPanel.js`, `ui/infoPanel.js` |
| `trade.json` `units` | the units of freight figures (tonnes or short tons) | `ext/advisors/views/commerce.js` |
| `infrastructure.json` ports' `domestic`, airports' `cargo_t` | ports split into domestic, imports and exports; air cargo in tonnes rather than pounds (`cargo_lbs`) | `ext/advisors/views/commerce.js`, `ext/layers/tips.js` |
| `military.json` `national.personnel` | personnel by base (U.S.); without it, census counts of the military (Canada) | `ext/advisors/index.js` |
| `disasters.json` `cdd` | a disaster database with its own shape (Canada's) | `ext/advisors/views/culture.js` |

## Adding an edition

1. Build the data files to [DATA_CONTRACTS.md](DATA_CONTRACTS.md) under `web/data/<id>/`, from a pipeline module
   (`pipeline/canada.py` is the worked example). Label every figure with its year.
2. Write `edition.json` and `text.json`. Canada's are the fuller example: start from them and change what differs.
3. Add the edition to `editions.json`.
4. Run the tests, then record the edition with the browser harness and look at every view
   ([HARNESS.md](HARNESS.md)):

```sh
uv run python -m unittest discover -s tests
uv run --group harness python -m harness record --edition <id>
```

5. Optionally, give its card on the world map its pictures. Add the edition to `VIEWS` in
   `pipeline/home_pictures.py` (where the map sits, and which part of the window each picture shows), make the two
   files, look at them, and set `"home_pictures": true` in `editions.json`:

```sh
uv run --group harness python -m pipeline.home_pictures <id>
```
