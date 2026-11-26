"""Tests for the atlas's country figures (web/data/world-figures.json, built by pipeline/build_world_figures.py)."""

import json
import re
import unittest
from datetime import date
from pathlib import Path

from pipeline import build_world_figures as wf

ROOT = Path(__file__).resolve().parents[1]
FIGURES_PATH = ROOT / "web" / "data" / "world-figures.json"
OUTLINES_PATH = ROOT / "web" / "data" / "world-outlines.json"


class WorldFiguresFileTest(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(FIGURES_PATH.read_text(encoding="utf-8"))
        self.outline_ids = {c["id"] for c in json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))["countries"]}

    def test_source_is_cited_with_its_licence(self):
        src = self.doc["source"]
        self.assertEqual(src["publisher"], "World Bank")
        self.assertEqual(src["license"], "CC BY 4.0")
        self.assertTrue(src["url"].startswith("https://"))
        self.assertRegex(src["updated"], r"^\d{4}-\d{2}-\d{2}$")

    def test_every_figure_carries_its_own_year(self):
        keys = [f["key"] for f in self.doc["figures"]]
        self.assertEqual(keys, list(wf.FIGURES))
        this_year = date.today().year
        for iso2, row in self.doc["countries"].items():
            self.assertIn(iso2, self.outline_ids, f"{iso2} has no outline on the atlas")
            self.assertTrue(set(row) <= set(keys), f"{iso2}: unknown figure in {sorted(row)}")
            for key, pair in row.items():
                self.assertEqual(len(pair), 2, f"{iso2}.{key} must be [year, value]")
                year, value = pair
                self.assertIsInstance(year, int)
                self.assertTrue(wf.FIRST_YEAR <= year <= this_year, f"{iso2}.{key}: year {year}")
                self.assertGreater(value, 0, f"{iso2}.{key}")
            if "population" in row:
                self.assertIsInstance(row["population"][1], int)
            if "life" in row:
                self.assertTrue(20 < row["life"][1] < 100, f"{iso2}: life expectancy {row['life'][1]}")

    def test_coverage(self):
        countries = self.doc["countries"]
        self.assertGreaterEqual(sum(1 for r in countries.values() if "population" in r), 200)
        for iso2 in ("US", "CA", "DE", "FR", "CN", "IN", "BR", "XK"):
            self.assertIn("population", countries.get(iso2, {}), f"{iso2} has no population")
        # Aggregates (regions, income groups, the world) have no outline and must not appear.
        for agg in ("EU", "1W", "XD", "ZG"):
            self.assertNotIn(agg, countries)


class NewestYearTest(unittest.TestCase):
    """The builder keeps each country's newest non-empty year and never fills a gap from another country."""

    def test_newest_non_empty_year_wins(self):
        rows = [
            {"country": {"id": "DE"}, "countryiso3code": "DEU", "date": "2025", "value": None},
            {"country": {"id": "DE"}, "countryiso3code": "DEU", "date": "2024", "value": 2.0},
            {"country": {"id": "DE"}, "countryiso3code": "DEU", "date": "2023", "value": 1.0},
            {"country": {"id": "FR"}, "countryiso3code": "FRA", "date": "2025", "value": 3.0},
        ]
        tmp = ROOT / "tests" / f".wdi-test-{id(self)}.json"
        try:
            tmp.write_text(json.dumps([{"page": 1, "pages": 1, "lastupdated": "2026-11-11"}, rows]))
            values, updated = wf.newest(tmp)
        finally:
            tmp.unlink(missing_ok=True)
        self.assertEqual(values, {"DE": (2024, 2.0), "FR": (2025, 3.0)})
        self.assertEqual(updated, "2026-11-11")

    def test_html_never_in_labels(self):
        doc = json.loads(FIGURES_PATH.read_text(encoding="utf-8"))
        for f in doc["figures"]:
            for field in ("label", "unit"):
                self.assertIsNone(re.search(r"[<>]", f[field]), f"markup in {f['key']}.{field}")


if __name__ == "__main__":
    unittest.main()
