"""Pre-render social cards and the static pages that carry them.

Two kinds of page, each a static document for link previews that sends the visitor on to the map:

* /share/<edition>/…: a view of an edition, its city or its lens (the edition's Share button links to them).
* /map/<id>/: each map that can be rated, an EarthCiv edition or a community map that opens inside EarthCiv. Its
  card shows the map's name, its maker and where it is on the world map, under a call to rate it. The world view's
  Share button on a map links here (web/js/ext/ports/mapShare.js), so a map's maker can post one link that previews
  as their map and asks for ratings (docs/RATINGS.md).
"""

from __future__ import annotations

import base64
import json
import re
from html import escape
from pathlib import Path
from urllib.parse import urlencode, urljoin

from .sitemap import site_address


def _route_key(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value):
        raise ValueError(f"Invalid share page ID: {value!r}")
    return value


def _write(out: Path, route: Path, site: str, scripts: str, title: str, description: str, image_alt: str, app: str,
           jpeg: bytes, *, link_text: str = "Open map on EarthCiv", link_attrs: str = "") -> None:
    """The page at `route` and its picture: the tags a link preview reads, and a link to `app` that a script follows."""
    url = urljoin(site, route.as_posix() + "/")
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
    <a id="open-map" href="{escape(site_root + app)}"{link_attrs}>{escape(link_text)}</a>
  </main>
  <script type="module" src="{site_root}{scripts}/app/open-share.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )


def _write_page(out: Path, site: str, scripts: str, edition: str, country: str, card: dict, jpeg: bytes) -> None:
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
    _write(out, route, site, scripts, title, description, image_alt, app, jpeg)


def has_map_page(port: dict) -> bool:
    """A map with a page of its own (/map/<id>/): one that can be rated, an EarthCiv edition or a community map that
    opens inside EarthCiv. The same rule as rateable() in web/js/ext/ports/ratings.js and the ratings Function."""
    status = port.get("status")
    return status == "merged" or (status == "live" and bool(port.get("url")) and port.get("embed") is True)


def _sentence(text: str) -> str:
    text = " ".join(str(text or "").split())
    return text if not text or text[-1] in ".!?。！？" else text + "."


def map_page_text(card: dict) -> tuple[str, str, str]:
    """The title, description and picture description of a map's page, from what the card renderer says of the map
    (web/dev/social-cards.js): its name, its maker's name, where it is and its own description from ports.json."""
    name, maker, where = card["name"], card.get("maker"), card.get("where") or ""
    by = f" by {maker}" if maker else ""
    title = f"{name}{by} · EarthCiv"
    lead = _sentence(card.get("description")) or _sentence(f"A map of {where}{by}" if where else f"{name}{by}")
    description = f"{lead} Open it on EarthCiv and rate it."
    image_alt = f"{name}{by}: {where or 'its place'} on EarthCiv’s world map, beside five stars to rate it"
    return title, description, image_alt


def _write_map_page(out: Path, site: str, scripts: str, card: dict, jpeg: bytes) -> None:
    id_ = _route_key(card["id"])
    edition = card.get("edition")
    # An edition opens at its own address; a community map opens inside EarthCiv's world view.
    app = "?" + urlencode({"country": _route_key(edition)}) if edition else "#" + urlencode({"ports": id_})
    title, description, image_alt = map_page_text(card)
    _write(out, Path("map", id_), site, scripts, title, description, image_alt, app, jpeg,
           link_text=f"Open {card['name']} on EarthCiv", link_attrs=f' data-map="{escape(id_)}"')


def build_share_pages(web: Path, out: Path, scripts: str) -> tuple[int, int]:
    """Write every share page and every map's page into the packaged site. Returns how many of each."""
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:
        if error.name != "playwright":
            raise
        raise SystemExit("Packaging needs Playwright. Run uv run --group harness python -m pipeline package.") from error
    from harness.record import serve

    # Preview URLs are absolute, so they are built on the site's address.
    site = site_address((web / "index.html").read_text(encoding="utf-8"))
    editions = json.loads((web / "data/editions.json").read_text(encoding="utf-8"))["editions"]
    ports = json.loads((web / "data/ports.json").read_text(encoding="utf-8"))["ports"]
    count = maps = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1240, "height": 650})
        server, port = serve(web)
        renderer = f"http://127.0.0.1:{port}/dev/social-cards.html"
        try:
            page.goto(renderer)
            page.wait_for_function("() => window.socialCards")
            world_jpeg = page.evaluate("() => window.socialCards.then(({render}) => render())")
            (out / "og-world.jpg").write_bytes(base64.b64decode(world_jpeg))
            for edition in editions:
                id_ = _route_key(edition["id"])
                page.goto(f"{renderer}?country={id_}")
                page.wait_for_function("() => window.socialCards")
                cards = page.evaluate("() => window.socialCards.then(({cards}) => cards)")
                for card in cards:
                    jpeg = page.evaluate("(card) => window.socialCards.then(({render}) => render(card))", card)
                    _write_page(out, site, scripts, id_, edition["name"], card, base64.b64decode(jpeg))
                count += len(cards)
            page.goto(f"{renderer}?maps")
            page.wait_for_function("() => window.socialCards")
            for entry in ports:
                if not has_map_page(entry):
                    continue
                card = page.evaluate("(id) => window.socialCards.then(({render}) => render(id))", _route_key(entry["id"]))
                _write_map_page(out, site, scripts, card, base64.b64decode(card.pop("jpeg")))
                maps += 1
        finally:
            server.shutdown()
            server.server_close()
    return count, maps
