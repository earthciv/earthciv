"""Tests for the maps' star ratings (docs/RATINGS.md): the static file, the wiring in the world view and the deploy
settings here; the Pages Function and the page's rating rules in tests/js/ratings.test.mjs, run through Node."""

import json
import os
import re
import shutil
import subprocess
import tomllib
import unittest
from pathlib import Path

from pipeline import package

ROOT = Path(__file__).resolve().parents[1]
STATIC_PATH = ROOT / "web" / "data" / "ratings.json"
FUNCTION_PATH = ROOT / "functions" / "data" / "ratings.json.js"
PAGE_PATH = ROOT / "web" / "js" / "ext" / "ports" / "ratings.js"
JS_TESTS = ROOT / "tests" / "js" / "ratings.test.mjs"
NODE_NEEDED = (22, 13)  # node:sqlite without a flag


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
        m = re.match(r"v(\d+)\.(\d+)", out.strip())
        if m and (int(m.group(1)), int(m.group(2))) >= NODE_NEEDED:
            return node
    return None


class RatingsFilesTest(unittest.TestCase):
    def test_static_file_says_ratings_are_not_open(self):
        # What a host without the Function serves, and what the Function falls back to: no stars anywhere.
        doc = json.loads(STATIC_PATH.read_text(encoding="utf-8"))
        self.assertEqual(doc, {"version": 1, "open": False, "reason": "static", "scale": 5, "ratings": {}})

    def test_function_answers_at_the_static_files_address(self):
        # Pages routes functions/<path>.js to /<path>: the Function must sit where the static file is served.
        served = STATIC_PATH.relative_to(ROOT / "web")
        self.assertEqual(FUNCTION_PATH.relative_to(ROOT / "functions"), served.with_name(served.name + ".js"))
        self.assertTrue(FUNCTION_PATH.is_file())
        self.assertEqual([p.name for p in (ROOT / "functions").rglob("*") if p.is_file()], ["ratings.json.js"])

    def test_world_view_reads_and_shows_ratings(self):
        index = (ROOT / "web" / "js" / "ext" / "ports" / "index.js").read_text(encoding="utf-8")
        self.assertIn('import { createRatings } from "./ratings.js";', index)
        self.assertIn('new URL("ratings.json", DATA_URL)', index)
        # Every map's card and the bar above an open map carry a slot for its rating.
        self.assertEqual(index.count('data-rating-of="${esc('), 2)
        css = (ROOT / "web" / "css" / "ports.css").read_text(encoding="utf-8")
        for cls in (".rt-avg", ".rt-give", ".rt-star", ".rt-bar"):
            self.assertIn(cls, css)

    def test_page_script_needs_no_other_script(self):
        # tests/js imports it outside a browser, so it must not import the app's modules.
        self.assertNotRegex(PAGE_PATH.read_text(encoding="utf-8"), r"(?m)^\s*import\s")

    def test_one_scale_everywhere(self):
        function = FUNCTION_PATH.read_text(encoding="utf-8")
        page = PAGE_PATH.read_text(encoding="utf-8")
        self.assertIn("const SCALE = 5;", function)
        self.assertIn("export const SCALE = 5;", page)
        self.assertIn("CHECK (stars BETWEEN 0 AND 5)", function)

    def test_function_never_stores_or_logs_an_address(self):
        function = FUNCTION_PATH.read_text(encoding="utf-8")
        # The visitor's address is read in one place and goes straight into the keyed hash.
        self.assertEqual(function.count("cf-connecting-ip"), 1)
        self.assertIn('voterKey(env.RATINGS_SALT, request.headers.get("cf-connecting-ip"))', function)


class DeploySettingsTest(unittest.TestCase):
    def setUp(self):
        self.config = tomllib.loads((ROOT / "wrangler.toml").read_text(encoding="utf-8"))

    def test_wrangler_file_deploys_the_packaged_site(self):
        self.assertEqual(ROOT / self.config["pages_build_output_dir"], package.SITE)
        self.assertRegex(self.config["compatibility_date"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertRegex(self.config["name"], r"^[a-z0-9-]+$")

    def test_database_binding_is_the_one_the_function_reads(self):
        # No database is the normal state of a copy of this project: the site then shows no stars.
        databases = self.config.get("d1_databases", [])
        self.assertLessEqual(len(databases), 1)
        for db in databases:
            self.assertEqual(db["binding"], "RATINGS_DB")
            self.assertRegex(db["database_id"], r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
        self.assertIn("env.RATINGS_DB", FUNCTION_PATH.read_text(encoding="utf-8"))
        # The secret is set with `wrangler pages secret put`, never written in the file.
        self.assertNotIn("RATINGS_SALT", json.dumps(self.config))

    def test_source_zip_carries_the_function_and_its_settings(self):
        for item in ("functions", "wrangler.toml"):
            self.assertIn(item, package.SOURCE_ITEMS)
            self.assertTrue((ROOT / item).exists())


class RatingsJavaScriptTest(unittest.TestCase):
    def test_function_and_page_rules(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d.%d or newer (for node:sqlite)" % NODE_NEEDED)
        command = [str(node), "--no-warnings", "--test", "--test-reporter=tap", str(JS_TESTS)]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout[-6000:] + run.stderr[-2000:])
        self.assertRegex(run.stdout, r"(?m)^# fail 0$")
        self.assertNotRegex(run.stdout, r"(?m)^# pass 0$")


if __name__ == "__main__":
    unittest.main()
