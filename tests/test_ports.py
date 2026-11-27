"""Tests for the All Ports & World Atlas catalog (web/data/ports.json) and world outlines."""

import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PORTS_PATH = ROOT / "web" / "data" / "ports.json"
OUTLINES_PATH = ROOT / "web" / "data" / "world-outlines.json"
EDITIONS_PATH = ROOT / "web" / "data" / "editions.json"

VALID_STATUSES = {"merged", "live", "repo"}
VALID_SCOPES = {"country", "multi", "region"}
HTML_RE = re.compile(r"<[a-z/!][^>]*>", re.I)


class WorldOutlinesTest(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))

    def test_outlines_structure_and_size(self):
        self.assertEqual(self.data["version"], 1)
        countries = self.data["countries"]
        self.assertGreaterEqual(len(countries), 200)
        # Keep the lazy atlas payload compact (< 250 KB uncompressed).
        self.assertLess(OUTLINES_PATH.stat().st_size, 250_000)

        ids = set()
        for c in countries:
            cid = c["id"]
            self.assertNotIn(cid, ids, f"duplicate country id {cid}")
            ids.add(cid)
            self.assertTrue(c["name"])
            self.assertEqual(len(c["center"]), 2)
            self.assertTrue(c["rings"], f"{cid} has no rings")
            for ring in c["rings"]:
                self.assertGreaterEqual(len(ring), 6)
                self.assertEqual(len(ring) % 2, 0)

        for key_iso in ("US", "CA", "FR", "DE", "ES", "IT", "PL", "CN", "TW", "IN", "BR", "AR", "SG", "PH", "TH", "TR", "IR"):
            self.assertIn(key_iso, ids, f"missing country {key_iso}")


class PortsCatalogTest(unittest.TestCase):
    def setUp(self):
        self.ports_doc = json.loads(PORTS_PATH.read_text(encoding="utf-8"))
        self.outlines = json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))
        self.outline_ids = {c["id"] for c in self.outlines["countries"]}
        self.editions = (
            json.loads(EDITIONS_PATH.read_text(encoding="utf-8"))["editions"]
            if EDITIONS_PATH.exists()
            else [{"id": "ca"}, {"id": "us"}]
        )

    def test_all_merged_editions_present(self):
        by_ed = {p.get("editionId"): p for p in self.ports_doc["ports"] if p.get("status") == "merged"}
        for ed in self.editions:
            self.assertIn(ed["id"], by_ed, f"merged edition {ed['id']} missing from ports.json")

    def test_entries_valid_safe_and_mapped(self):
        ports = self.ports_doc["ports"]
        self.assertGreaterEqual(len(ports), 30)
        seen_ids = set()
        for p in ports:
            pid = p["id"]
            self.assertRegex(pid, r"^[a-z0-9-]+$")
            self.assertNotIn(pid, seen_ids, f"duplicate port id {pid}")
            seen_ids.add(pid)
            self.assertIn(p["status"], VALID_STATUSES)
            self.assertIn(p["scope"], VALID_SCOPES)
            self.assertTrue(p["name"])
            self.assertTrue(p["countries"], f"{pid} has no countries")
            for iso in p["countries"]:
                self.assertIn(iso, self.outline_ids, f"{pid} references unknown ISO {iso}")
            if p.get("center") is not None:
                lon, lat = p["center"]
                self.assertTrue(-180 <= lon <= 180 and -90 <= lat <= 90, f"bad center for {pid}")
            if p["status"] == "live":
                self.assertTrue(p.get("url"), f"live port {pid} must have a url")
                parsed = urlparse(p["url"])
                self.assertEqual(parsed.scheme, "https", f"catalog url for {pid} must use https")
                self.assertTrue(parsed.netloc)
            elif p["status"] == "repo":
                self.assertTrue(p.get("repo"), f"repo port {pid} must declare repo")
                self.assertIsNone(p.get("url"))
            # Plain text only — no embedded HTML tags in data.
            for field in ("name", "author", "description", "region"):
                val = p.get(field) or ""
                self.assertIsNone(HTML_RE.search(val), f"HTML found in {pid}.{field}")

    def test_launch_pill_count_matches_the_catalog(self):
        # The top-bar pill shows this count until ports.json loads, then the catalog's own length.
        js = (ROOT / "web" / "js" / "ext" / "ports" / "index.js").read_text(encoding="utf-8")
        m = re.search(r"const CATALOG_PORT_COUNT = (\d+);", js)
        self.assertIsNotNone(m, "CATALOG_PORT_COUNT not found in web/js/ext/ports/index.js")
        self.assertEqual(int(m.group(1)), len(self.ports_doc["ports"]))

    def test_world_map_links_to_the_form_that_lists_a_map(self):
        # "Add its link" saves a link in one browser only, so the world map sends a map's author to the form that
        # lists it for everyone: beside that note, and on the card of a country nobody has mapped.
        js = (ROOT / "web" / "js" / "ext" / "ports" / "index.js").read_text(encoding="utf-8")
        self.assertIn('const REPO_URL = "https://github.com/earthciv/earthciv";', js)
        m = re.search(r"const MAP_FORM_URL = `\$\{REPO_URL\}/issues/new\?template=([\w.-]+)`;", js)
        self.assertIsNotNone(m, "MAP_FORM_URL not found in web/js/ext/ports/index.js")
        form = ROOT / ".github" / "ISSUE_TEMPLATE" / m.group(1)
        self.assertTrue(form.is_file(), f"the world map links to a form that does not exist: {form.name}")
        self.assertGreaterEqual(js.count('href="${MAP_FORM_URL}"'), 2, "both places should link to the form")


class WorldHomeTest(unittest.TestCase):
    """The deployed page opens on the world map; the editions live at ?country=<id>."""

    def read(self, *parts):
        return (ROOT.joinpath("web", *parts)).read_text(encoding="utf-8")

    def test_index_opens_on_the_world_map(self):
        html = self.read("index.html")
        self.assertIn('data-home="world"', html)
        # The default edition stays declared: old links without ?country= (/#city=…) still open it.
        self.assertIn('data-default-country="us"', html)
        self.assertIn('<script type="module" src="js/boot.js"></script>', html)
        self.assertNotIn('src="js/main.js"', html)

    def test_boot_loads_either_the_world_map_or_an_edition(self):
        boot = self.read("js", "boot.js")
        self.assertRegex(boot, r'import \{ OPENS_ON_WORLD\b[^}]*\} from "\./app/home\.js"')
        self.assertRegex(boot, r'import\("\./ext/ports/home\.js(?:\?[^"]+)?"\)')
        self.assertRegex(boot, r'import\("\./main\.js(?:\?[^"]+)?"\)')
        # The world map must not pull in an edition's code: boot.js imports main.js only on the edition path.
        self.assertNotIn('from "./main.js"', boot)

    def test_only_the_world_views_own_hash_keys_keep_the_home_page(self):
        home = self.read("js", "app", "home.js")
        self.assertIn('export const WORLD_HASH_KEYS = ["ports", "country", "makers"];', home)
        ports = self.read("js", "ext", "ports", "index.js")
        for key in ("ports", "country", "makers"):
            self.assertIn(f'app.hash.register("{key}"', ports)

    def test_edition_links_always_name_their_edition(self):
        main = self.read("js", "main.js")
        self.assertIn("pinEditionInUrl(EDITION_ID)", main)
        self.assertIn("editionUrl(picker.value, DEFAULT_EDITION)", main)

    def test_the_world_map_links_to_each_edition(self):
        # Search engines follow links, not buttons, and only a link opens in a new tab: every control on the world map
        # that opens an edition is an <a> from editionLink(), whose href is editionUrl() relative to the page
        # (?country=<id>). The tiles, the country card's big button, the edition's own card and its search suggestion.
        ports = self.read("js", "ext", "ports", "index.js")
        m = re.search(r"const editionLink = \(id\) => \{\n(.*?)\n  \};", ports, re.S)
        self.assertIsNotNone(m, "editionLink not found in web/js/ext/ports/index.js")
        self.assertIn("new URL(editionUrl(id, DEFAULT_EDITION))", m.group(1))
        self.assertIn('href="${esc(url.search || url.pathname)}" data-play="${esc(id)}"', m.group(1))
        self.assertGreaterEqual(ports.count("${editionLink("), 4)
        self.assertNotRegex(ports, r"<button[^>]*\bdata-play=", "a control that opens an edition must be a link")


if __name__ == "__main__":
    unittest.main()
