"""Guards for the editions work (docs/GLOBAL_PLAN.md, phases 1 and 2).

* The U.S. data files stay byte-identical to upstream's build: the engine work moves them, it never regenerates them.
* Uses of the two-country switch (`canada` in the browser code) may only go down, to 0 at the end of phase 2.
"""

import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "upstream_us_data.json"
# Lower this as uses are removed; never raise it.
MAX_COUNTRY_SWITCH_USES = 335


def us_data_dir() -> Path:
    moved = ROOT / "web" / "data" / "us"
    return moved if (moved / "world.json").exists() else ROOT / "web" / "data"


def country_switch_uses() -> int:
    pattern = re.compile(r"\bcanada\b")
    files = [*(ROOT / "web" / "js").rglob("*.js"), *(ROOT / "web" / "dev").rglob("*.js"), ROOT / "web" / "index.html"]
    return sum(len(pattern.findall(f.read_text(encoding="utf-8"))) for f in files if f.exists())


class UpstreamUsDataTest(unittest.TestCase):
    def test_us_data_is_byte_identical_to_upstream(self):
        expected = json.loads(FIXTURE.read_text())["files"]
        folder = us_data_dir()
        for name, sha in expected.items():
            with self.subTest(file=name):
                path = folder / name
                self.assertTrue(path.exists(), f"{path} is missing")
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), sha, f"{name} differs from upstream")


class CountrySwitchTest(unittest.TestCase):
    def test_country_switch_uses_only_go_down(self):
        n = country_switch_uses()
        self.assertLessEqual(n, MAX_COUNTRY_SWITCH_USES, f"`canada` is used {n} times; the limit is {MAX_COUNTRY_SWITCH_USES}")


if __name__ == "__main__":
    unittest.main()
