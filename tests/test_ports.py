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


if __name__ == "__main__":
    unittest.main()
