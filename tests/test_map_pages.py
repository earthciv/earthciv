"""Tests for each map's own page (/map/<id>/, pipeline/share_pages.py) and the Share button that links to it
(web/js/ext/ports/mapShare.js, docs/RATINGS.md "Asking for ratings"). The button's rules are tested in
tests/js/mapShare.test.mjs, run through Node; this file runs them too."""

import json
import os
import re
import shutil
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.share_pages import _write_map_page, has_map_page, map_page_text

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js" / "mapShare.test.mjs"
NODE_NEEDED = 20  # node:test with ES modules
SITE = "https://earthciv.org/"
SCRIPTS = "js-0123456789abcdef"


def find_node():
    """A Node.js new enough for the JavaScript tests: `node` on PATH, else the newest one nvm installed."""
    candidates = [Path(p) for p in [shutil.which("node")] if p]
    nvm = Path(os.environ.get("NVM_DIR") or Path.home() / ".nvm") / "versions" / "node"
    if nvm.is_dir():
        numbered = lambda p: [int(n) for n in re.findall(r"\d+", p.parts[-3])]
        candidates += sorted(nvm.glob("v*/bin/node"), key=numbered, reverse=True)
    for node in candidates:
        try:
            out = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        m = re.match(r"v(\d+)\.", out.strip())
        if m and int(m.group(1)) >= NODE_NEEDED:
            return node
    return None


def read(*parts):
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


class _Page(HTMLParser):
    """The parts of a page a link preview and a browser read."""

    def __init__(self):
        super().__init__()
        self.meta, self.links, self.anchors, self.scripts, self.title = {}, {}, [], [], None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            if key:
                self.meta[key] = a.get("content")
        elif tag == "link":
            self.links[a.get("rel")] = a.get("href")
        elif tag == "a":
            self.anchors.append(a)
        elif tag == "script":
            self.scripts.append(a)
        elif tag == "title":
            self._in_title = True

    def handle_data(self, data):
        if self._in_title:
            self.title = (self.title or "") + data

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False


DECIV = {
    "id": "deciv", "name": "Deutschland (deciv)", "maker": "wdenk", "handle": "TheJol", "where": "Germany",
    "description": "Germany as a hex strategy map built from German and European public statistics.", "edition": None,
}
MALAYSIA = {
    "id": "my", "name": "Malaysia", "maker": "MyCiv", "handle": "peyter", "where": "Malaysia",
    "description": "Malaysia from DOSM open data", "edition": "my",
}


def write(card):
    temp = TemporaryDirectory()
    out = Path(temp.name)
    _write_map_page(out, SITE, SCRIPTS, card, b"\xff\xd8 a picture")
    page = _Page()
    folder = out / "map" / card["id"]
    page.feed((folder / "index.html").read_text(encoding="utf-8"))
    return temp, folder, page


class MapPageTextTest(unittest.TestCase):
    def test_a_page_names_the_map_and_its_maker_and_asks_for_a_rating(self):
        title, description, image_alt = map_page_text(DECIV)
        self.assertEqual(title, "Deutschland (deciv) by wdenk · EarthCiv")
        self.assertEqual(description, "Germany as a hex strategy map built from German and European public statistics. "
                                      "Open it on EarthCiv and rate it.")
        self.assertEqual(image_alt, "Deutschland (deciv) by wdenk: Germany on EarthCiv’s world map, beside five stars to rate it")

    def test_a_description_is_ended_and_a_missing_one_is_made(self):
        self.assertTrue(map_page_text(MALAYSIA)[1].startswith("Malaysia from DOSM open data. Open it"))
        bare = {**DECIV, "description": "  ", "maker": None}
        self.assertEqual(map_page_text(bare)[0], "Deutschland (deciv) · EarthCiv")
        self.assertEqual(map_page_text(bare)[1], "A map of Germany. Open it on EarthCiv and rate it.")


class MapPageFileTest(unittest.TestCase):
    def test_a_community_maps_page_previews_it_and_opens_it_in_the_world_view(self):
        temp, folder, page = write(DECIV)
        with temp:
            url = "https://earthciv.org/map/deciv/"
            self.assertEqual(page.title, "Deutschland (deciv) by wdenk · EarthCiv")
            self.assertEqual(page.links["canonical"], url)
            self.assertEqual(page.meta["og:url"], url)
            self.assertEqual(page.meta["og:image"], url + "preview.jpg")
            self.assertEqual(page.meta["twitter:card"], "summary_large_image")
            self.assertEqual(page.meta["twitter:image"], url + "preview.jpg")
            self.assertEqual((page.meta["og:image:width"], page.meta["og:image:height"]), ("1200", "630"))
            self.assertEqual((folder / "preview.jpg").read_bytes(), b"\xff\xd8 a picture")
            # The link that a script follows: the world view with the map open, and the map named for the note it
            # leaves (web/js/app/open-share.js).
            [link] = page.anchors
            self.assertEqual(link["id"], "open-map")
            self.assertEqual(link["href"], "../../#ports=deciv")
            self.assertEqual(link["data-map"], "deciv")
            self.assertEqual(page.scripts, [{"type": "module", "src": f"../../{SCRIPTS}/app/open-share.js"}])

    def test_an_editions_page_opens_the_edition(self):
        temp, _, page = write(MALAYSIA)
        with temp:
            self.assertEqual(page.anchors[0]["href"], "../../?country=my")
            self.assertEqual(page.meta["og:url"], "https://earthciv.org/map/my/")

    def test_names_are_written_as_text(self):
        card = {**DECIV, "name": 'A "quoted" <b>map</b> & co', "maker": "<script>alert(1)</script>"}
        temp, folder, page = write(card)
        with temp:
            html = (folder / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("<script>alert", html)
            self.assertNotIn("<b>map", html)
            self.assertEqual(page.title, 'A "quoted" <b>map</b> & co by <script>alert(1)</script> · EarthCiv')

    def test_an_id_that_is_not_a_folder_name_is_refused(self):
        for bad in ("../x", "De", "a/b", ""):
            with self.subTest(bad=bad), TemporaryDirectory() as temp, self.assertRaises(ValueError):
                _write_map_page(Path(temp), SITE, SCRIPTS, {**DECIV, "id": bad}, b"")


class WhichMapsTest(unittest.TestCase):
    def setUp(self):
        self.ports = json.loads(read("web", "data", "ports.json"))["ports"]

    def test_the_maps_that_can_be_rated_have_a_page(self):
        self.assertTrue(has_map_page({"status": "merged", "editionId": "us"}))
        self.assertTrue(has_map_page({"status": "live", "url": "https://x.example/", "embed": True}))
        self.assertFalse(has_map_page({"status": "live", "url": "https://x.example/", "embed": False}))
        self.assertFalse(has_map_page({"status": "live", "url": None, "embed": True}))
        self.assertFalse(has_map_page({"status": "repo", "repo": "a/b"}))
        self.assertFalse(has_map_page({"status": "custom", "url": "https://x.example/", "embed": True}))

    def test_the_build_makes_a_page_for_every_map_the_page_offers_to_share(self):
        # The same rule on both sides: pipeline/share_pages.py's has_map_page and mapShare.js's sharable.
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        script = ('import { sharable } from "./web/js/ext/ports/mapShare.js";'
                  'import { readFileSync } from "node:fs";'
                  'const ports = JSON.parse(readFileSync("web/data/ports.json", "utf8")).ports;'
                  'console.log(JSON.stringify(ports.filter(sharable).map((p) => p.id)));')
        run = subprocess.run([str(node), "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True,
                             timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), [p["id"] for p in self.ports if has_map_page(p)])

    def test_every_edition_has_a_page(self):
        editions = json.loads(read("web", "data", "editions.json"))["editions"]
        for edition in editions:
            with self.subTest(edition=edition["id"]):
                entry = next((p for p in self.ports if p.get("editionId") == edition["id"] or p["id"] == edition["id"]), None)
                self.assertIsNotNone(entry, "the edition has no entry in ports.json, so no page")
                self.assertTrue(has_map_page(entry))

    def test_every_page_id_is_a_folder_name(self):
        for port in self.ports:
            if has_map_page(port):
                self.assertRegex(port["id"], r"^[a-z0-9][a-z0-9_-]*$")


class WiringTest(unittest.TestCase):
    def test_the_packaged_page_says_it_has_the_maps_pages(self):
        self.assertIn('"<html data-share-pages data-map-pages "', read("pipeline", "package.py"))
        index = read("web", "js", "ext", "ports", "index.js")
        self.assertIn('document.documentElement.hasAttribute("data-map-pages")', index)
        self.assertIn("linkOf: (p) => mapLink(p, { root: SITE_ROOT, pages: MAP_PAGES }),", index)
        # the site's root, as seen from web/js/ext/ports/ (and from js-<hash>/ext/ports/ once packaged)
        self.assertIn('const SITE_ROOT = new URL("../../../", import.meta.url).href;', index)
        self.assertIn('const DATA_URL = new URL("../../../data/", import.meta.url);', index)

    def test_the_card_renderer_draws_the_maps_cards(self):
        cards = read("web", "dev", "social-cards.js")
        self.assertIn('query.has("maps") ? mapCards()', cards)
        self.assertIn('page.goto(f"{renderer}?maps")', read("pipeline", "share_pages.py"))
        self.assertIn("focusCountries(isos, { animate = true, fill = 0.55 } = {})", read("web", "js", "ext", "ports", "worldMap.js"))

    def test_share_buttons_where_a_map_is_shown(self):
        index = read("web", "js", "ext", "ports", "index.js")
        self.assertIn('import { createMapShare, mapLink, ratingSummary, sharable, takeArrival } from "./mapShare.js";', index)
        self.assertIn('actions += shareButtonHtml(p, "ports-btn ports-btn-ghost pc-share");', index)  # a map's card
        self.assertIn('const share = shareButtonHtml(p, "mk-map-share");', index)  # its line in Map makers
        self.assertEqual(index.count("${barButtonsHtml(port)}"), 1)  # the bar above a community map
        self.assertIn('editionActs.insertAdjacentHTML("beforeend", barButtonsHtml(editionPort));', index)  # an edition's
        self.assertIn("if (d.shareMap) return openShare(el);", index)
        # The popover is not part of what the world view makes inert behind it.
        self.assertIn('el.id === "map-share-pop"', index)

    def test_a_phone_has_the_star_button_instead_of_the_stars(self):
        css = read("web", "css", "ports.css")
        self.assertIn(".ms-bar-rate { display: none; }", css)
        phone = re.search(r"@media \(max-width: 700px\) \{\n  \.ms-bar-share \{ display: none; \}\n  \.ms-bar-rate \{", css)
        self.assertIsNotNone(phone, "css/ports.css shows the star button in place of Share map on a phone")
        # The phone's first row counts it when it makes room for the map's name and its maker (ui/mobile.js).
        self.assertIn("fixed += el.offsetWidth + inner;", read("web", "js", "ui", "mobile.js"))


class MapShareJavaScriptTest(unittest.TestCase):
    def test_share_rules(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        command = [str(node), "--test", str(JS_TESTS.relative_to(ROOT))]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout[-6000:] + run.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
