"""Tests for the map menu: the one menu at the top left of an edition and of a community map shown inside EarthCiv
(web/js/ui/mapPicker.js, filled in by web/js/ext/ports/index.js). What each entry says is tested in
tests/js/mapPicker.test.mjs, run through Node."""

import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js" / "mapPicker.test.mjs"
NODE_NEEDED = 20  # node:test with ES modules and Unicode property escapes


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
    return ROOT.joinpath("web", *parts).read_text(encoding="utf-8")


class MapMenuTest(unittest.TestCase):
    def setUp(self):
        self.ports = read("js", "ext", "ports", "index.js")

    def test_an_editions_top_bar_and_a_community_maps_bar_carry_the_same_menu(self):
        # The same control in both places: a <select class="map-picker"> inside .country-switcher > .brand, followed
        # by the World button. css/style.css styles it by its class, so the two cannot drift apart.
        html = read("index.html")
        self.assertRegex(html, r'<div class="country-switcher"[^>]*>\s*<div class="brand">\s*<select id="country-picker" class="map-picker"')
        self.assertRegex(self.ports, r'<div class="country-switcher"[^>]*>\s*<div class="brand">\s*<select id="ports-vswitch" class="map-picker"')
        self.assertRegex(self.ports, r'<button type="button" class="ports-launch" data-act="back-atlas">\$\{LAUNCH_HTML\}</button>')
        self.assertIn("btn.innerHTML = LAUNCH_HTML;", self.ports)
        css = read("css", "style.css")
        self.assertRegex(css, r"(?m)^\.map-picker \{")
        self.assertNotIn("#country-picker", css)
        self.assertNotIn("#ports-vswitch", read("css", "ports.css"))

    def test_every_map_opens_under_the_same_first_row(self):
        # On a desktop an edition's top bar has two rows. The first holds what the bar above a community map holds:
        # the map menu, World, the map's maker and what kind of map it is. The edition's own bar is the second row,
        # where a community map shows its own, and the world view and the bar above a community map keep one row.
        css = read("css", "style.css")
        m = re.search(r"/\* -+ two rows on desktop -+ \*/.*?@media \(min-width: 701px\) \{\n(.*?)\n\}\n", css, re.S)
        self.assertIsNotNone(m, "the two-row block is missing from css/style.css")
        block = m.group(1)
        self.assertIn(":root { --topbar-h: 80px; }", block)
        self.assertIn(".ports-overlay { --topbar-h: 40px; }", block)
        self.assertIn("#topbar > .country-switcher { flex: 0 0 100%; height: 40px; }", block)
        self.assertIn("#topbar > .yields { flex: 1 1 0; }", block)  # the second row never wraps to a third
        self.assertNotRegex(css, r"top: (52|54)px")  # what sat under the one-row bar now follows --topbar-h
        self.assertIn("editionKind.textContent = KIND.merged.label;", self.ports)
        # then, at the row's end, the edition's stars and its Share button (tests/test_map_pages.py)
        self.assertIn("switcher.append(editionMaker, editionKind, editionActs);", self.ports)

    def test_both_menus_are_filled_from_one_list(self):
        # One function writes the entries of both, so a map in one is in the other, in the same order.
        self.assertEqual(len(re.findall(r"\bmenuHtml\(\)", self.ports)), 2)  # its definition, and its one use:
        self.assertRegex(self.ports, r"function fillMenu\(select, current\) \{\n\s+if \(!select\) return;\n\s+const html = menuHtml\(\);")
        self.assertIn("fillMenu(picker, EDITION_ID);", self.ports)
        self.assertIn('fillMenu(overlay?.querySelector("#ports-vswitch"), ui.activePortId);', self.ports)
        self.assertIn('fillMenu(overlay.querySelector("#ports-vswitch"), port.id);', self.ports)
        m = re.search(r"function menuHtml\(\) \{\n(.*?)\n  \}\n", self.ports, re.S)
        self.assertIsNotNone(m, "menuHtml not found in web/js/ext/ports/index.js")
        body = m.group(1)
        order = [body.index(s) for s in ('"🌍 World map"', '"EarthCiv editions"', '"Community maps"', '"Your links"')]
        self.assertEqual(order, sorted(order))
        # An edition is listed exactly as main.js lists it before the community maps arrive, so the menu that names
        # the edition keeps its width.
        label = "menuLabel(editionIcon(e), e.name)"
        self.assertIn(f"EDITIONS.map((e) => option(e.id, {label}))", body)
        self.assertIn(f"EDITIONS.map((e) => new Option({label}, e.id))", read("js", "main.js"))

    def test_an_edition_loads_the_list_of_maps_for_its_menu(self):
        # Inside an edition the community maps must be in the menu without the world map being opened first: the list
        # of maps loads as the edition starts, apart from the world's outlines and figures.
        m = re.search(r"\n  function loadPorts\(\) \{\n(.*?)\n  \}\n", self.ports, re.S)
        self.assertIsNotNone(m, "loadPorts not found in web/js/ext/ports/index.js")
        self.assertIn('new URL("ports.json", DATA_URL)', m.group(1))
        self.assertIn("syncMenus();", m.group(1))
        self.assertNotIn("world-outlines.json", m.group(1))
        install_time = self.ports[self.ports.index("if (!home) {"):self.ports.index("// --- data ---")]
        self.assertIn("loadPorts()", install_time)

    def test_the_bare_star_is_gone_from_the_page(self):
        # The U.S. edition's star stood beside the menu on a round badge. The menu's entry now carries the icon, and
        # ui/mapPicker.js gives the U.S. its flag there.
        self.assertNotIn("brand-emblem", read("index.html"))
        self.assertNotIn("brand-emblem", read("js", "main.js"))
        self.assertNotIn("brand-emblem", self.ports)


class MapMenuJavaScriptTest(unittest.TestCase):
    def test_what_each_entry_says(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        command = [str(node), "--test", str(JS_TESTS.relative_to(ROOT))]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
