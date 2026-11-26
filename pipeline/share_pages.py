"""Pre-render social cards and the static pages that carry them."""

from __future__ import annotations

import base64
import json
import re
from html import escape, unescape
from pathlib import Path
from urllib.parse import urlencode, urljoin


def _route_key(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value):
        raise ValueError(f"Invalid share page ID: {value!r}")
    return value


def _write_page(out: Path, canonical: str, edition: str, country: str, card: dict, jpeg: bytes) -> None:
    kind, name = card["kind"], card["name"]
    route = Path("share", edition)
    app = "?" + urlencode({"country": edition})
    if kind:
        id_ = _route_key(card["id"])
        route /= Path(kind, id_)
        app += "#" + urlencode({kind: id_})

    if kind == "city":
        place = ", ".join([name, *card["regions"]])
        title = f"{place} · EarthCiv"
        description = f"Explore {place}, {country} on EarthCiv’s strategy-game map, with real-world terrain and city data."
        image_alt = f"Hex terrain map centered on {place}"
    elif kind == "lens":
        title = f"{name} map of {country} · EarthCiv"
        description = f"Explore the {name} lens for {country} on EarthCiv’s interactive strategy map."
        image_alt = f"Map of {country} colored by the {name} lens"
    else:
        title = f"{country} · EarthCiv"
        description = f"Explore the cities, terrain, and economy of {country} on EarthCiv’s interactive strategy map."
        image_alt = f"Hex terrain map of {country}"

    url = urljoin(canonical, route.as_posix() + "/")
    image = url + "preview.jpg"
    og = {
        "type": "website", "site_name": "EarthCiv", "title": title, "description": description,
        "url": url, "image": image, "image:width": "1200", "image:height": "630", "image:alt": image_alt,
    }
    twitter = {
        "card": "summary_large_image", "title": title, "description": description, "image": image, "image:alt": image_alt,
    }
    tags = "\n".join([
        *(f'  <meta property="og:{key}" content="{escape(value)}">' for key, value in og.items()),
        *(f'  <meta name="twitter:{key}" content="{escape(value)}">' for key, value in twitter.items()),
    ])
    site_root = "../" * len(route.parts)
    folder = out / route
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "preview.jpg").write_bytes(jpeg)
    (folder / "index.html").write_text(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <meta name="description" content="{escape(description)}">
  <link rel="canonical" href="{escape(url)}">
{tags}
</head>
<body>
  <main>
    <h1>{escape(title)}</h1>
    <p>{escape(description)}</p>
    <a id="open-map" href="{escape(site_root + app)}">Open map on EarthCiv</a>
  </main>
  <script type="module" src="{site_root}js/app/open-share.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )


def build_share_pages(web: Path, out: Path) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:
        if error.name != "playwright":
            raise
        raise SystemExit("Packaging needs Playwright. Run uv run --group harness python -m pipeline package.") from error
    from harness.record import serve

    index = (web / "index.html").read_text(encoding="utf-8")
    canonical_tag = re.search(r'<link rel="canonical" href="([^"]+)">', index)
    if not canonical_tag:
        raise ValueError("The site index needs its canonical link to generate absolute social preview URLs.")
    canonical = unescape(canonical_tag[1])
    editions = json.loads((web / "data/editions.json").read_text(encoding="utf-8"))["editions"]
    count = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1240, "height": 650})
        server, port = serve(web)
        renderer = f"http://127.0.0.1:{port}/dev/social-cards.html"
        try:
            page.goto(renderer)
            world_jpeg = page.evaluate("() => window.socialCards.then(({render}) => render())")
            (out / "og-world.jpg").write_bytes(base64.b64decode(world_jpeg))
            for edition in editions:
                id_ = _route_key(edition["id"])
                page.goto(f"{renderer}?country={id_}")
                cards = page.evaluate("() => window.socialCards.then(({cards}) => cards)")
                for card in cards:
                    jpeg = page.evaluate("(card) => window.socialCards.then(({render}) => render(card))", card)
                    _write_page(out, canonical, id_, edition["name"], card, base64.b64decode(jpeg))
                count += len(cards)
        finally:
            server.shutdown()
            server.server_close()
    return count
