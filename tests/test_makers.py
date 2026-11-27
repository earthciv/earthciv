"""Tests for the maps' makers: who each map on the world map is credited to and the list of everyone who made one
(web/js/ext/ports/makers.js, shown by web/js/ext/ports/index.js). The rules are tested in tests/js/makers.test.mjs,
run through Node; the wiring, the catalog's fields and what the README says about the pictures are tested here."""

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = ROOT / "tests" / "js" / "makers.test.mjs"
MAKERS_PATH = ROOT / "web" / "js" / "ext" / "ports" / "makers.js"
PORTS_PATH = ROOT / "web" / "data" / "ports.json"
NODE_NEEDED = 20  # node:test with ES modules and Unicode property escapes

# A GitHub account name: letters, digits and single hyphens, at most 39 characters.
LOGIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")


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


class MakerFieldsTest(unittest.TestCase):
    """The fields of web/data/ports.json that say who made a map."""

    def setUp(self):
        self.ports = json.loads(PORTS_PATH.read_text(encoding="utf-8"))["ports"]

    def test_every_map_names_an_author(self):
        for p in self.ports:
            self.assertIsInstance(p.get("author"), str, f"{p['id']} has no author")
            self.assertTrue(p["author"].strip(), f"{p['id']} has an empty author")

    def test_optional_author_fields(self):
        for p in self.ports:
            if p.get("author_github") is not None:
                self.assertRegex(p["author_github"], LOGIN_RE, f"{p['id']}: author_github is a GitHub account name, or null")
                owner = (p.get("repo") or "").split("/")[0]
                self.assertNotEqual(p["author_github"], owner, f"{p['id']}: author_github repeats the repository's owner")
            if "author_url" in p:
                self.assertRegex(p["author_url"], r"^https://[^\s/]+", f"{p['id']}: author_url is an https address")
            if "original" in p:
                self.assertIs(p["original"], True, f"{p['id']}: \"original\" is true or left out")
            if "author_twitter" in p:
                self.assertRegex(p["author_twitter"], r"^[A-Za-z0-9_]{1,15}$", f"{p['id']}: author_twitter is a handle without @")
            if "author_twitter_source" in p:
                self.assertRegex(p["author_twitter_source"], r"^https://[^\s/]+", f"{p['id']}: author_twitter_source is an https address")
            if "github_stars" in p:
                self.assertIs(type(p["github_stars"]), int, f"{p['id']}: github_stars is a non-negative integer")
                self.assertGreaterEqual(p["github_stars"], 0, f"{p['id']}: github_stars is negative")
                self.assertRegex(p.get("github_stars_checked") or "", r"^\d{4}-\d{2}-\d{2}$", f"{p['id']}: github_stars_checked is YYYY-MM-DD")
            if "featured_creator" in p:
                self.assertIs(p["featured_creator"], True, f"{p['id']}: featured_creator is true or left out")

    def test_at_most_one_featured_creator(self):
        featured_makers = set()
        for p in self.ports:
            if p.get("featured_creator") is True:
                owner = p.get("author_github") if "author_github" in p else (p.get("repo") or "").split("/")[0]
                featured_makers.add((owner or p["author"]).lower())
        self.assertLessEqual(len(featured_makers), 1)

    def test_a_repository_owner_is_an_account_name(self):
        # The owner of "repo" is where a maker's picture and profile link come from.
        for p in self.ports:
            if p.get("repo"):
                self.assertRegex(p["repo"], r"^[^/\s]+/[^/\s]+$", f"{p['id']}: repo is owner/name")
                self.assertRegex(p["repo"].split("/")[0], LOGIN_RE, f"{p['id']}: repo owner")

    def test_one_map_is_the_original(self):
        self.assertEqual([p["id"] for p in self.ports if p.get("original") is True], ["usaciv-original"])

    def test_readme_describes_the_author_fields(self):
        readme = read("README.md")
        for field in ("`author_github`", "`author_url`", "`author_twitter`", "`github_stars`", "`featured_creator: true`"):
            self.assertIn(field, readme)


class MakersWiringTest(unittest.TestCase):
    def setUp(self):
        self.index = read("web", "js", "ext", "ports", "index.js")
        self.makers = MAKERS_PATH.read_text(encoding="utf-8")

    def test_rules_need_no_other_script(self):
        # tests/js imports the file outside a browser, so it must not import the app's modules or touch the page.
        self.assertNotRegex(self.makers, r"(?m)^\s*import\s")
        self.assertNotRegex(self.makers, r"\b(document|window|localStorage)\b")

    def test_world_view_names_the_maker_wherever_a_map_is_shown(self):
        self.assertRegex(self.index, r'import \{[^}]*\bmakerOf\b[^}]*\} from "\./makers\.js";')
        # On a map's card, in both map bars, on its loading screen and in the note under it.
        self.assertIn('<div class="pc-by">by ${makerNameHtml(maker)}</div>', self.index)
        self.assertIn("renderTopbarMaker(editionMaker,", self.index)
        self.assertIn('renderTopbarMaker(overlay.querySelector(".ports-vbar .map-maker"), port);', self.index)
        self.assertIn('id="ports-vloading-by"', self.index)
        self.assertIn('class="ports-vnotice-by"', self.index)
        # The big button names the maker before anything else.
        self.assertIn("const by = maker ? `by ${maker.name} · ` : \"\";", self.index)
        css = read("web", "css", "ports.css")
        for cls in (".mk-av", ".mk-pic", ".mk-name", ".pc-by", ".map-maker-chip", ".wv-makers", ".mk-row", ".mk-map"):
            self.assertIn(cls, css)

    def test_the_country_list_puts_the_makers_forward(self):
        # Under the editions: today's map, a different maker's each day, and the way to the list of makers.
        strip = re.search(r"\n  function makersStripHtml\(makers\) \{\n(.*?)\n  \}\n", self.index, re.S)
        self.assertIsNotNone(strip, "makersStripHtml not found in web/js/ext/ports/index.js")
        self.assertIn("todayHtml(featuredPort(basePorts, { day: dayNumber() }))", strip.group(1))
        self.assertIn('class="wv-makers" data-act="makers"', strip.group(1))
        self.assertIn("${makersStripHtml(rankedMakers())}", self.index)
        self.assertIn('if (act === "makers") return openMakers("all", { focus: true });', self.index)

    def test_the_list_of_makers_has_its_own_address(self):
        self.assertIn('app.hash.register("makers"', self.index)
        home = read("web", "js", "app", "home.js")
        self.assertRegex(home, r'export const WORLD_HASH_KEYS = \[[^\]]*"makers"[^\]]*\];')
        self.assertIn("https://earthciv.org/#makers=all", read("README.md"))

    def test_this_sites_account_is_the_repository_owner(self):
        # The editions credited to this site are those whose repository is this one.
        self.assertIn('const REPO_URL = "https://github.com/earthciv/earthciv";', self.index)
        self.assertIn('const HOUSE = new URL(REPO_URL).pathname.split("/")[1].toLowerCase();', self.index)
        ports = json.loads(PORTS_PATH.read_text(encoding="utf-8"))["ports"]
        house = [p["id"] for p in ports if (p.get("repo") or "").lower() == "earthciv/earthciv" and "author_github" not in p]
        self.assertEqual(house, ["ca", "my"])

    def test_pictures_are_asked_for_without_naming_the_page(self):
        # The only pictures from another site are the makers', from GitHub's picture host. The request carries no
        # referrer, and a picture is fetched only when it is about to be seen.
        self.assertIn('const AVATARS = "https://avatars.githubusercontent.com/";', self.makers)
        img = re.search(r'<img class="mk-pic"[^>]*>', self.index)
        self.assertIsNotNone(img, "the maker's picture not found in web/js/ext/ports/index.js")
        self.assertIn('referrerpolicy="no-referrer"', img.group(0))
        self.assertIn('loading="lazy"', img.group(0))
        self.assertIn('alt=""', img.group(0))
        self.assertEqual(len(re.findall(r"<img\b", self.index)), 2)  # that one, and an edition's picture of its map

    def test_readme_says_where_the_pictures_come_from(self):
        # README's Privacy section is the site's statement of what a visit reaches: it names the picture host.
        readme = read("README.md")
        privacy = readme[readme.index("## Privacy"):]
        privacy = privacy[: privacy.index("\n## ", 3)]
        self.assertIn("avatars.githubusercontent.com", privacy)


class MakersJavaScriptTest(unittest.TestCase):
    def test_who_made_each_map_and_the_order_of_the_list(self):
        node = find_node()
        if node is None:
            self.skipTest("needs Node.js %d or newer" % NODE_NEEDED)
        command = [str(node), "--test", str(JS_TESTS.relative_to(ROOT))]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
