"""Editions (docs/EDITIONS.md): each one is complete and safe, and the engine never asks which one it is showing.

* web/data/editions.json lists every edition folder, and each manifest names data files that exist.
* Text packs hold strings (or lists and objects of strings). Where they carry HTML, it uses only the tags and attributes that
  app/text.js keeps, with safe links: a pack is data, and the sanitizer is a second line of defence, not the first.
* Every key the code reads has wording, either a neutral default in the code or the edition's own. Keys the code
  reads only behind hasText() are optional.
* No code under web/js compares the edition with a literal id such as "us" or "ca". What differs between editions
  comes from the manifest, the text pack or the shape of the data.
* An edition that declares pictures for its card on the world map ("home_pictures") has them, in the shape the card
  shows, and pipeline/home_pictures.py can make them again.
"""

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "data"
JS = ROOT / "web" / "js"
REQUIRED = ("contract", "id", "name", "title", "emblem", "map_label", "files", "text")
CONTRACT = 3
SAFE_HREF = re.compile(r"^(https://|http://|#|[a-z0-9_./-]+$)", re.I)
# The pictures on the world map's edition cards: file name -> (width, height) in px.
PICTURES = {"home.jpg": (716, 208), "home-small.jpg": (519, 288)}
# Both load on the home page before anything is clicked; the four files ship at 43 to 61 kB.
PICTURE_MAX_BYTES = 90_000


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def index() -> dict:
    return load(DATA / "editions.json")


def edition_dirs() -> list[Path]:
    return sorted(p.parent for p in DATA.glob("*/edition.json"))


def js_sources() -> dict[Path, str]:
    return {p: p.read_text(encoding="utf-8") for p in sorted(JS.rglob("*.js"))}


def jpeg_size(path: Path) -> tuple[int, int]:
    """Width and height from a JPEG's frame header, read by hand: the tests use only the standard library."""
    data = path.read_bytes()
    if data[:2] != b"\xff\xd8":
        raise AssertionError(f"{path.name} is not a JPEG")
    i = 2
    while i + 9 <= len(data) and data[i] == 0xFF:
        marker, length = data[i + 1], int.from_bytes(data[i + 2:i + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):  # the frame header: baseline, extended or progressive
            return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
        i += 2 + length
    raise AssertionError(f"{path.name} has no frame header")


def sanitizer_sets() -> tuple[set[str], set[str]]:
    """The tags and attributes app/text.js keeps, read from its source so the two stay in step."""
    src = (JS / "app" / "text.js").read_text(encoding="utf-8")

    def grab(name: str) -> set[str]:
        m = re.search(rf"const {name} = new Set\(\[(.*?)\]\)", src, re.S)
        if not m:
            raise AssertionError(f"app/text.js no longer defines {name}")
        return set(re.findall(r'"([\w-]+)"', m.group(1)))

    return grab("TAGS"), grab("ATTRS")


class _Tags(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found: list[tuple[str, list[tuple[str, str | None]]]] = []

    def handle_starttag(self, tag, attrs):
        self.found.append((tag, attrs))

    handle_startendtag = handle_starttag


def strings(value):
    """Every string in a pack value: a string, or lists and objects of them (citizens.phrases, say)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, (list, dict)) and value:
        for v in value.values() if isinstance(value, dict) else value:
            yield from strings(v)
    else:
        raise TypeError(f"not text: {value!r}")


class IndexTest(unittest.TestCase):
    def test_index_lists_every_edition_folder(self):
        idx = index()
        ids = [e["id"] for e in idx["editions"]]
        self.assertEqual(idx["contract"], CONTRACT)
        self.assertEqual(len(ids), len(set(ids)), "an edition is listed twice")
        self.assertIn(idx["default"], ids)
        self.assertEqual(sorted(ids), [p.name for p in edition_dirs()], "editions.json and the edition folders differ")

    def test_manifests_are_complete(self):
        listed = {e["id"]: e for e in index()["editions"]}
        for folder in edition_dirs():
            with self.subTest(edition=folder.name):
                m = load(folder / "edition.json")
                for key in REQUIRED:
                    self.assertIn(key, m)
                self.assertEqual(m["contract"], CONTRACT)
                self.assertEqual(m["id"], folder.name)
                self.assertEqual(m["name"], listed[m["id"]]["name"])
                self.assertEqual(m["emblem"], listed[m["id"]]["emblem"])
                for name in m["files"]:
                    self.assertTrue((folder / f"{name}.json").is_file(), f"{folder.name}: {name}.json is declared but missing")
                for name in ("world", "cities", "nation"):
                    self.assertIn(name, m["files"], f"{folder.name}: the map needs {name}.json")
                self.assertTrue((folder / m["text"]).is_file())
                if "description" in m:
                    self.assertIsInstance(m["description"], str)
                    self.assertTrue(m["description"].strip(), f"{folder.name}: the description is empty")


class HomePicturesTest(unittest.TestCase):
    """The pictures on the world map's edition cards (docs/EDITIONS.md, pipeline/home_pictures.py)."""

    def test_declared_pictures_exist_in_the_shape_the_cards_show(self):
        for e in index()["editions"]:
            self.assertIn(e.get("home_pictures", False), (True, False), f"{e['id']}: home_pictures is true or absent")
            for name, size in PICTURES.items():
                path = DATA / e["id"] / name
                with self.subTest(edition=e["id"], picture=name):
                    if not e.get("home_pictures"):
                        self.assertFalse(path.exists(), "a picture nothing shows: declare home_pictures in editions.json")
                        continue
                    self.assertTrue(path.is_file(), "declared in editions.json but missing")
                    self.assertEqual(jpeg_size(path), size)
                    self.assertLess(path.stat().st_size, PICTURE_MAX_BYTES)

    def test_the_script_can_make_every_declared_picture_again(self):
        from pipeline import home_pictures

        self.assertEqual({f"{name}.jpg": size for name, size in home_pictures.SIZES.items()}, PICTURES)
        declared = {e["id"] for e in index()["editions"] if e.get("home_pictures")}
        self.assertEqual(set(home_pictures.VIEWS), declared, "pipeline/home_pictures.py VIEWS and editions.json differ")
        width, height = home_pictures.WINDOW
        for edition, view in home_pictures.VIEWS.items():
            self.assertEqual(len(view["at"]), 3)
            for name in home_pictures.SIZES:
                with self.subTest(edition=edition, picture=name):
                    box = home_pictures.crop_box(name, *view[name])
                    self.assertGreaterEqual(min(box["x"], box["y"]), 0)
                    self.assertLessEqual(box["x"] + box["width"], width)
                    self.assertLessEqual(box["y"] + box["height"], height)
                    # Scaled down from the screenshot, never up.
                    self.assertGreaterEqual(box["width"] * home_pictures.DENSITY, home_pictures.SIZES[name][0])

    def test_the_world_map_shows_them_in_their_own_shapes(self):
        js = (JS / "ext" / "ports" / "index.js").read_text(encoding="utf-8")
        css = (ROOT / "web" / "css" / "ports.css").read_text(encoding="utf-8")
        self.assertIn("e.home_pictures === true", js)
        wide = re.search(r'<img src="\$\{pic\}\.jpg" [^>]*width="(\d+)" height="(\d+)"', js)
        small = re.search(r'<source media="([^"]+)" srcset="\$\{pic\}-small\.jpg" width="(\d+)" height="(\d+)">', js)
        self.assertIsNotNone(wide, "the card's <img> has changed: update this test with it")
        self.assertIsNotNone(small, "the card's <source> has changed: update this test with it")
        self.assertEqual((int(wide[1]), int(wide[2])), PICTURES["home.jpg"])
        self.assertEqual((int(small[2]), int(small[3])), PICTURES["home-small.jpg"])
        self.assertIn(f"aspect-ratio: {wide[1]} / {wide[2]};", css)
        # The squarer file and the squarer box are chosen on one media condition, in the markup and in the stylesheet.
        self.assertIn(f"@media {small[1]} {{\n  .wv-tile-pic img {{ aspect-ratio: {small[2]} / {small[3]}; }}", css)


class TextPackTest(unittest.TestCase):
    def test_packs_hold_only_safe_text(self):
        tags, attrs = sanitizer_sets()
        for folder in edition_dirs():
            pack = load(folder / load(folder / "edition.json")["text"])
            self.assertIsInstance(pack, dict)
            for key, value in pack.items():
                with self.subTest(edition=folder.name, key=key):
                    try:
                        texts = list(strings(value))
                    except TypeError as e:
                        self.fail(str(e))
                    for s in texts:
                        parser = _Tags()
                        parser.feed(s)
                        for tag, tag_attrs in parser.found:
                            self.assertIn(tag, tags, f"<{tag}> is not kept by app/text.js")
                            for name, val in tag_attrs:
                                self.assertIn(name, attrs, f"{name}= is not kept by app/text.js")
                                if name == "href":
                                    self.assertRegex(val or "", SAFE_HREF)
                                if name == "target":
                                    self.assertEqual(val, "_blank")

    def test_every_key_the_code_reads_has_wording(self):
        sources = js_sources()
        read: dict[str, set[str]] = {}
        optional: set[str] = set()
        defaults: set[str] = set()
        for path, src in sources.items():
            for m in re.finditer(r'\b(?:txt|rich|textList)\(\s*"([^"$`]+)"', src):
                read.setdefault(m.group(1), set()).add(path.relative_to(ROOT).as_posix())
            optional |= set(re.findall(r'\bhasText\(\s*"([^"$`]+)"', src))
            for block in re.findall(r"\bdefaults\(\{(.*?)\}\);", src, re.S):
                defaults |= set(re.findall(r'"([\w.]+)"\s*:', block))
        self.assertGreater(len(read), 50, "the key scan found too little; has the text API changed?")
        for folder in edition_dirs():
            pack = load(folder / load(folder / "edition.json")["text"])
            missing = sorted(k for k in read if k not in defaults and k not in optional and k not in pack)
            self.assertEqual(missing, [], f"{folder.name}: keys with no wording")


class OneRuleTest(unittest.TestCase):
    def test_engine_never_compares_with_an_edition_id(self):
        ids = "|".join(re.escape(e["id"]) for e in index()["editions"])
        q = r"""["'`]"""
        pattern = re.compile(rf"[!=]==?\s*{q}(?:{ids}){q}|{q}(?:{ids}){q}\s*[!=]==?|\bcase\s+{q}(?:{ids}){q}")
        found = []
        for path, src in js_sources().items():
            for m in pattern.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                found.append(f"{path.relative_to(ROOT).as_posix()}:{line}: {m.group(0)}")
        self.assertEqual(found, [], "compare with data, not with an edition id")


if __name__ == "__main__":
    unittest.main()
