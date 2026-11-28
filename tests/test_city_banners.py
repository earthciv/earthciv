"""Tests for the city banners' de-cluttering (web/js/render/banners.js): the national capital always has a banner,
cities bigger than it keep theirs, and a banner with no room above its city slides sideways or sits below it. The
rules are tested in tests/js/banners.test.mjs, run through Node; this file runs it as part of the usual test
command."""

import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js" / "banners.test.mjs"
NODE_NEEDED = 20  # node:test with ES modules and top-level await


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


class CityBannersJavaScriptTest(unittest.TestCase):
    def test_which_cities_get_a_banner(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        command = [str(node), "--test", str(JS_TESTS.relative_to(ROOT))]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
