"""What search engines get (pipeline/sitemap.py, declareCanonical in web/js/app/home.js).

* Packaging writes robots.txt, which names the sitemap, and sitemap.xml, which lists the world map and every edition.
* index.html has no canonical link of its own. One file serves every view, so the page declares each view's address.
* Each edition has its own title, and its description if it has one, different from the world map's.
"""

import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html import unescape
from pathlib import Path

from pipeline.sitemap import build_crawler_files, page_urls, site_address

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def index_html() -> str:
    return (WEB / "index.html").read_text(encoding="utf-8")


class CrawlerFilesTest(unittest.TestCase):
    def test_sitemap_lists_the_world_map_and_every_edition(self):
        site = site_address(index_html())
        editions = json.loads((WEB / "data" / "editions.json").read_text(encoding="utf-8"))["editions"]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(build_crawler_files(WEB, out), 1 + len(editions))
            root = ET.parse(out / "sitemap.xml").getroot()
            robots = (out / "robots.txt").read_text(encoding="utf-8")
        locs = [loc.text for loc in root.findall("s:url/s:loc", NS)]
        self.assertEqual(locs, [site, *(f"{site}?country={e['id']}" for e in editions)])
        self.assertEqual(locs, page_urls(WEB))
        self.assertIn(f"\nSitemap: {site}sitemap.xml\n", robots)
        self.assertRegex(robots, r"(?m)^User-agent: \*\nAllow: /$")
        self.assertNotRegex(robots, r"(?mi)^disallow:", "the map's scripts and data files must stay crawlable")

    def test_site_address_is_og_url(self):
        self.assertEqual(site_address(index_html()), "https://earthciv.org/")
        self.assertEqual(site_address('<meta property="og:url" content="https://example.org/maps/">'),
                         "https://example.org/maps/")
        for bad in ("", '<meta property="og:url" content="https://example.org">',
                    '<meta property="og:url" content="https://example.org/?country=us">'):
            with self.subTest(html=bad), self.assertRaises(ValueError):
                site_address(bad)


class PageHeadTest(unittest.TestCase):
    def test_the_page_declares_each_views_canonical_address(self):
        # A fixed canonical link in the one file would tell search engines that every edition is a copy of the world map.
        self.assertNotRegex(index_html(), r"<link[^>]*canonical", "declareCanonical() gives each view its own")
        for name in ("boot.js", "main.js"):
            self.assertIn("declareCanonical(", (WEB / "js" / name).read_text(encoding="utf-8"), name)

    def test_each_edition_has_its_own_title_and_description(self):
        page = index_html()
        world_title = unescape(re.search(r"<title>(.*?)</title>", page)[1])
        world_description = unescape(re.search(r'<meta name="description" content="([^"]*)">', page)[1])
        seen = {}
        for path in sorted((WEB / "data").glob("*/edition.json")):
            m = json.loads(path.read_text(encoding="utf-8"))
            with self.subTest(edition=m["id"]):
                self.assertNotEqual(m["title"], world_title, "the edition would share the world map's title")
                self.assertNotIn(m["title"], seen, f"{m['id']} has the title of {seen.get(m['title'])}")
                seen[m["title"]] = m["id"]
                if "description" in m:
                    self.assertNotEqual(m["description"], world_description)


if __name__ == "__main__":
    unittest.main()
