"""Tests for World Rankings on the world map: its figures (web/data/world-rankings.json, built by
pipeline/build_world_rankings.py) and the screen's wiring (web/js/ext/ports/rankings.js, rankingsView.js, index.js).
The screen's rules are tested in tests/js/rankings.test.mjs, run through Node; this file runs it too."""

import json
import os
import re
import shutil
import subprocess
import unittest
from datetime import date
from pathlib import Path

from pipeline import build_world_rankings as wr

ROOT = Path(__file__).resolve().parents[1]
NODE_NEEDED = 20  # node:test with ES modules
RANKINGS_PATH = ROOT / "web" / "data" / "world-rankings.json"
FIGURES_PATH = ROOT / "web" / "data" / "world-figures.json"
OUTLINES_PATH = ROOT / "web" / "data" / "world-outlines.json"
JS = ROOT / "web" / "js"
JS_TESTS = ROOT / "tests" / "js" / "rankings.test.mjs"


def read(*parts):
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


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


class WorldRankingsFileTest(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(RANKINGS_PATH.read_text(encoding="utf-8"))
        self.outline_ids = {c["id"] for c in json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))["countries"]}
        self.measures = {m["key"]: m for m in self.doc["measures"]}

    def test_source_is_cited_with_its_licence(self):
        src = self.doc["source"]
        self.assertEqual(src["publisher"], "World Bank")
        self.assertEqual(src["license"], "CC BY 4.0")
        self.assertTrue(src["url"].startswith("https://"))
        self.assertRegex(src["updated"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(self.doc["first_year"], wr.FIRST_YEAR)
        self.assertEqual(self.doc["rank_share"], wr.RANK_SHARE)

    def test_tabs_and_measures_are_the_builders(self):
        self.assertEqual([g["key"] for g in self.doc["groups"]], [g[0] for g in wr.GROUPS])
        listed = [k for g in self.doc["groups"] for k in g["measures"]]
        self.assertEqual(listed, [m["key"] for m in self.doc["measures"]])
        self.assertEqual(sorted(listed), sorted(wr.MEASURES))
        for g in self.doc["groups"]:
            self.assertEqual(g["lead"], g["measures"][0], f"{g['key']}: the Overall tab ranks the first measure")
        # Each tab shows the medallion of the advisor with its key.
        roster = re.findall(r'\{ id: "([a-z]+)"', read("web", "js", "ext", "advisors", "core", "roster.js"))
        for g in self.doc["groups"]:
            self.assertIn(g["key"], roster)
        for m in self.doc["measures"]:
            self.assertEqual(m["indicator"], wr.MEASURES[m["key"]][0])
            self.assertIn(m["format"], {"usd", "people", "years", "articles", "pct", "km2", "tonnes"})
            self.assertIn(m["scale"], {"log", "linear"})
            for field in ("label", "unit", "origin", "about"):
                self.assertIsNone(re.search(r"[<>]", m[field]), f"markup in {m['key']}.{field}")

    def test_every_figure_carries_its_own_year(self):
        this_year = date.today().year
        for iso, row in self.doc["countries"].items():
            self.assertIn(iso, self.outline_ids, f"{iso} has no outline on the world map")
            self.assertTrue(set(row) <= set(self.measures), f"{iso}: unknown measure in {sorted(row)}")
            for key, pair in row.items():
                self.assertEqual(len(pair), 2, f"{iso}.{key} must be [year, value]")
                year, value = pair
                self.assertIsInstance(year, int)
                self.assertTrue(wr.FIRST_YEAR <= year <= this_year, f"{iso}.{key}: year {year}")
                self.assertIsInstance(value, (int, float))
                self.assertGreaterEqual(value, 0, f"{iso}.{key}")
        for agg in ("EU", "1W", "XD", "ZG", "WLD"):
            self.assertNotIn(agg, self.doc["countries"])

    def test_each_measure_is_ranked_on_one_year(self):
        countries = self.doc["countries"].values()
        for key, m in self.measures.items():
            cells = [row[key] for row in countries if key in row]
            ranked = [c for c in cells if c[0] == m["year"]]
            self.assertEqual(m["listed"], len(cells), key)
            self.assertEqual(m["ranked"], len(ranked), key)
            self.assertGreaterEqual(m["ranked"], wr.RANK_SHARE * m["listed"], f"{key}: too few countries in {m['year']}")
            # No year after the ranked one has enough countries to be ranked instead.
            later = {}
            for c in cells:
                if c[0] > m["year"]:
                    later[c[0]] = later.get(c[0], 0) + 1
            for year, n in later.items():
                self.assertLess(n, wr.RANK_SHARE * m["listed"], f"{key}: {year} would have been the ranked year")

    def test_the_g20_is_in_every_ranking(self):
        for key, m in self.measures.items():
            for iso in wr.G20:
                cell = self.doc["countries"].get(iso, {}).get(key)
                self.assertIsNotNone(cell, f"{iso} has no {key}")
                self.assertEqual(cell[0], m["year"], f"{iso}'s {key} is not from the ranked year")

    def test_the_world_maps_figures_agree(self):
        # The country card's three figures come from the same World Bank series.
        figures = json.loads(FIGURES_PATH.read_text(encoding="utf-8"))["countries"]
        tolerance = {"population": 0, "gdp_pc": 0.5, "life": 0.05}
        compared = 0
        for iso, row in figures.items():
            for key, tol in tolerance.items():
                fig, rank = row.get(key), self.doc["countries"].get(iso, {}).get(key)
                if not fig or not rank or fig[0] != rank[0]:
                    continue
                self.assertLessEqual(abs(fig[1] - rank[1]), tol, f"{iso}.{key}: {fig} and {rank}")
                compared += 1
        self.assertGreater(compared, 500)


class BuilderRulesTest(unittest.TestCase):
    """The builder's rules, on made-up answers."""

    def test_the_ranked_year_is_the_newest_with_enough_countries(self):
        by_country = {f"C{i}": {2024: 1.0} for i in range(10)}
        for i in range(7):
            by_country[f"C{i}"][2025] = 2.0
        self.assertEqual(wr.ranking_year(by_country), 2024)  # 7 of 10 have 2025
        by_country["C7"][2025] = 2.0
        self.assertEqual(wr.ranking_year(by_country), 2025)  # 8 of 10
        by_country["C9"] = {}  # a country without figures does not count
        self.assertEqual(wr.ranking_year(by_country), 2025)

    def test_a_ranking_without_a_g20_member_stops_the_build(self):
        by_country = {iso: {2025: 1.0} for iso in wr.G20 if iso != "IN"}
        by_country["IN"] = {2024: 1.0}
        with self.assertRaises(SystemExit) as stop:
            wr.check_g20("gdp", 2025, by_country)
        self.assertIn("IN", str(stop.exception))
        wr.check_g20("gdp", 2024, {iso: {2024: 1.0} for iso in wr.G20})

    def test_rounding_never_makes_two_figures_equal(self):
        self.assertEqual(wr.compact(30769700000000.42), 30769700000000)
        self.assertEqual(wr.compact(82.10834567), 82.1083)
        self.assertEqual(wr.compact(100.0), 100)
        self.assertEqual(wr.compact(0.13), 0.13)
        values = {"A": 1.00001, "B": 1.00002, "C": 5.0}
        out = wr.rounded(values)
        self.assertEqual(len(set(out.values())), 3)
        self.assertEqual(out["C"], 5)

    def test_empty_figures_are_skipped(self):
        rows = [
            {"country": {"id": "DE"}, "date": "2025", "value": None},
            {"country": {"id": "DE"}, "date": "2024", "value": 2.0},
            {"country": {"id": "FR"}, "date": "2025", "value": 0},
        ]
        tmp = ROOT / "tests" / f".wdi-rank-test-{id(self)}.json"
        try:
            tmp.write_text(json.dumps([{"page": 1, "pages": 1, "lastupdated": "2026-11-11"}, rows]))
            values, updated = wr.series(tmp)
        finally:
            tmp.unlink(missing_ok=True)
        self.assertEqual(values, {"DE": {2024: 2.0}, "FR": {2025: 0}})  # a zero is a figure
        self.assertEqual(updated, "2026-11-11")


STATIC_IMPORT = re.compile(r'^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^\s*import\s+"([^"]+)"', re.M)


def static_closure(start: Path) -> set:
    """Every module `start` loads through static imports (not import())."""
    seen, todo = set(), [start.resolve()]
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.add(path)
        for a, b in STATIC_IMPORT.findall(path.read_text(encoding="utf-8")):
            spec = a or b
            if spec.startswith("."):
                todo.append((path.parent / spec).resolve())
    return seen


class RankingsWiringTest(unittest.TestCase):
    def setUp(self):
        self.index = read("web", "js", "ext", "ports", "index.js")
        self.rules = read("web", "js", "ext", "ports", "rankings.js")
        self.view = read("web", "js", "ext", "ports", "rankingsView.js")

    def test_rules_need_no_other_script(self):
        # tests/js imports the file outside a browser, so it must not import the app's modules or touch the page.
        self.assertNotRegex(self.rules, r"(?m)^\s*import\s")
        self.assertNotRegex(self.rules, r"\b(document|window|localStorage)\b")
        self.assertNotRegex(self.view, r"\b(document|window|localStorage)\b")
        self.assertNotIn("<img", self.view)  # pictures from other sites are the makers' alone (README, Privacy)

    def test_the_world_map_loads_no_edition(self):
        # The medallions come from the advisors' folder; nothing on the way may load an edition's manifest or text.
        loaded = {p.relative_to(JS).as_posix() for p in static_closure(JS / "ext" / "ports" / "home.js")}
        self.assertIn("ext/ports/rankingsView.js", loaded)
        self.assertIn("ext/advisors/core/emblems.js", loaded)
        for edition_only in ("app/edition.js", "app/text.js", "format.js", "main.js"):
            self.assertNotIn(edition_only, loaded)

    def test_a_countrys_card_shows_its_demographics(self):
        self.assertIn("demographicsHtml(rankDoc, iso,", self.index)
        self.assertIn("${figuresHtml(iso)}", self.index)
        self.assertNotIn("world-figures.json", self.index)  # the card's three figures are among the ten now

    def test_rankings_have_their_own_address(self):
        self.assertIn('app.hash.register("rankings"', self.index)
        home = read("web", "js", "app", "home.js")
        self.assertRegex(home, r'export const WORLD_HASH_KEYS = \[[^\]]*"rankings"[^\]]*\];')
        self.assertIn('new URL("world-rankings.json", DATA_URL)', self.index)
        self.assertIn('data-act="rankings-toggle"', self.index)

    def test_the_visitors_own_country_stays_in_their_browser(self):
        self.assertIn('const MINE_KEY = "earthciv.myCountry.v1";', self.index)
        readme = read("README.md")
        privacy = readme[readme.index("## Privacy"):]
        privacy = privacy[: privacy.index("\n## ", 3)]
        self.assertIn("World Rankings", privacy)

    def test_readme_describes_the_rankings(self):
        readme = read("README.md")
        self.assertIn("https://earthciv.org/#rankings=overall", readme)
        self.assertIn("pipeline.build_world_rankings", readme)
        self.assertIn("web/data/world-rankings.json", readme)

    def test_styles_exist(self):
        css = read("web", "css", "ports.css")
        for cls in (".wv-rank-btn", ".wv-rankings", ".rk-tab", ".rk-card", ".rk-row", ".rk-mine", ".rk-bubble", ".rk-code",
                    ".dm-table", ".dm-k", ".dm-rank", ".dm-avg"):
            self.assertIn(cls, css)


class RankingsJavaScriptTest(unittest.TestCase):
    def test_ranks_ties_years_and_wording(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        command = [str(node), "--test", str(JS_TESTS.relative_to(ROOT))]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
