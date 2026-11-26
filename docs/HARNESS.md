# Browser harness

The harness records what each edition shows across a fixed list of views, so a change to the browser code can be
checked against a recording made before it. It is a development tool: the site never needs it.

```sh
uv run --group harness python -m playwright install chromium-headless-shell   # once
uv run --group harness python -m harness record --out out/harness/before
# ... change the code ...
uv run --group harness python -m harness record --out out/harness/after
uv run --group harness python -m harness diff out/harness/before out/harness/after --allow harness/allow/NAME.json
```

`record` serves `web/` (or `--site DIR`), opens a fresh headless Chromium page for every view of every edition
(`--edition us --edition ca` by default) and writes, per view, to `out/harness/<run>/<edition>/`:

- `<view>.png`: the window as rendered (1280×800, or 390×844 for `phone-` views);
- `<view>.txt`: the page title, the URL hash and the visible text;
- `<view>.outline.txt`: one line per rendered element with its classes, the attributes a visitor reads (`title`,
  `aria-label`, `alt`, ...) and its own text; SVG drawings are reduced to a fingerprint;
- `share.image.png`: the 1600×900 share image, for the `share` view;
- `run.json`: the views and, for each, its console errors and warnings and the data files it loaded.

`--only GLOB` records a subset (`--only 'lens-*'`). `record` exits 1 when a view failed or never settled.

`diff` compares two recordings view by view: visible text, outline, pixels, console messages and data files loaded.
It exits 1 unless every difference matches a rule in the allow-list, a JSON list of reviewed exceptions:

```json
[{"views": "ca/report-*", "kinds": ["text", "outline"], "reason": "Canadian wording now comes from text.json"},
 {"views": "us/*", "kinds": ["pixels"], "within": [[177, 13, 189, 27]], "reason": "known flake: the menu's arrow"}]
```

A rule with `within` allows a pixel difference only when every differing pixel lies inside its boxes
(`[x0, y0, x1, y1]`, pooled across the rules that match the view), so a flake that stays in one place does not
excuse the rest of the screenshot.

## The views

The page side, `web/dev/snap.js`, chooses the views from the edition's own data, so the list follows the data:

| Views | What |
| --- | --- |
| `home` | The opening view |
| `zoom-1..3-<z>` | The largest, 10th and 50th city at three zooms (`#at=x,y,z`) |
| `lens-<id>` | Every lens |
| `city-<which>` | City panels: the largest, the median, the first without a survey unemployment rate, the first in two regions |
| `region-<which>` | Region panels: the most populous, the median and the least populous |
| `report-<key>-<tab>` | Every top-bar report, on both tabs |
| `cityview-<which>` | The City View of the same cities, and every section of the largest |
| `advisor-<id>` | The council and every advisor |
| `almanac-<n>` | Every Almanac page |
| `help`, `search`, `share` | Help, a search, the share menu and the share image |
| `phone-*` | The main views at phone size |

`web/dev/snap.html` runs one view by hand in any browser (serve `web/` and open `/dev/snap.html`).

## Keeping it deterministic

Every view starts from a fresh page in its own browser context, so views recorded side by side share no storage (the
app remembers recent lenses and panel settings in `localStorage`). The page side (added before the app's own
scripts) counts what is still outstanding: animation frames, fetches, scrolls, timers of up to 5 s and idle
callbacks. It also makes scrolling instant. The runner counts requests in flight. A view is captured once both have
been quiet for half a second, after one more frame: the app is asked to draw again and the harness waits for quiet
once more. Animations that read the clock (the selected region's border pulses for about 4 s) stop on a frame that
depends on timing, and sprites painted in idle time reach the screen only with the next draw; the extra frame draws
the resting state with everything in. Screenshots disable CSS animations and hide the caret. Recordings in a row
must be identical apart from the known flakes below; record on the same machine and browser build when comparing.

A few views still differ in their pixels between two recordings of the same site. These are bugs in the app, not
the harness, and `harness/allow/editions.json` lists them as known flakes, each confined to its box where it stays in
one place: the country menu's arrow (an SVG background, a few pixels), the City View dock's Map button (sometimes
12 px wider), one map badge in `ca/city-median`, and faint differences across the map in `ca/city-no-unemployment`
(at most 32 levels; text and outline are still compared).

`harness/allow/editions.json` is the allow-list for the move to editions: comparing the site before it with the site
after, the only differences are the data's new paths and two reviewed corrections to the Canadian edition.
