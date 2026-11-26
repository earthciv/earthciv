"""Editions (docs/EDITIONS.md): each one is complete and safe, and the engine never asks which one it is showing.

* web/data/editions.json lists every edition folder, and each manifest names data files that exist.
* Text packs hold strings (or lists and objects of strings). Where they carry HTML, it uses only the tags and attributes that
  app/text.js keeps, with safe links: a pack is data, and the sanitizer is a second line of defence, not the first.
* Every key the code reads has wording, either a neutral default in the code or the edition's own. Keys the code
  reads only behind hasText() are optional.
* No code under web/js compares the edition with a literal id such as "us" or "ca". What differs between editions
  comes from the manifest, the text pack or the shape of the data.
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


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def index() -> dict:
    return load(DATA / "editions.json")


def edition_dirs() -> list[Path]:
    return sorted(p.parent for p in DATA.glob("*/edition.json"))


def js_sources() -> dict[Path, str]:
    return {p: p.read_text(encoding="utf-8") for p in sorted(JS.rglob("*.js"))}


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
