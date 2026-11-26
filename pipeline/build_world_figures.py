"""Build web/data/world-figures.json: a few headline figures for every country on the All Ports atlas.

    uv run python -m pipeline.build_world_figures             # downloads into data/raw/world/ on the first run
    uv run python -m pipeline.build_world_figures --offline   # cached files only
    uv run python -m pipeline.build_world_figures --refresh   # download the figures again

The figures come from the World Bank's World Development Indicators API (CC BY 4.0): population, GDP per person in
current US dollars, and life expectancy at birth. Each country keeps its newest year for each figure, and the year
travels with the value, so the atlas labels every figure with its own year. Nothing is divided or ranked here.

Countries are keyed by the ISO 3166-1 alpha-2 code the World Bank uses, which is also the id in world-outlines.json.
Regional and income-group aggregates have no outline, so they are left out. Standard library only.
"""

from __future__ import annotations

import argparse
import json
from datetime import date

from .core import fetch
from .core.fetch import download, read_manifest
from .core.paths import WEB
from .core.store import atomic_write_text

SOURCE_ID = "world"
OUTLINES = WEB / "data" / "world-outlines.json"
OUT = WEB / "data" / "world-figures.json"

API = "https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&per_page=20000&date={start}:{end}"
FIRST_YEAR = 2015  # an older figure is left out rather than shown
# key -> (indicator, label, unit, decimals kept)
FIGURES = {
    "population": ("SP.POP.TOTL", "Population", "people", 0),
    "gdp_pc": ("NY.GDP.PCAP.CD", "GDP per person", "current US$", 0),
    "life": ("SP.DYN.LE00.IN", "Life expectancy", "years", 1),
}


def fetch_inputs(refresh: bool = False) -> dict:
    end = date.today().year
    return {
        key: download(
            SOURCE_ID, API.format(code=code, start=FIRST_YEAR, end=end), f"wdi/{code}.json",
            force=refresh and not fetch.OFFLINE,
        )
        for key, (code, *_rest) in FIGURES.items()
    }


def newest(path) -> tuple[dict[str, tuple[int, float]], str | None]:
    """{ISO-2 code: (year, value)} with each country's newest non-empty year, and the database's update date."""
    doc = json.loads(path.read_text())
    if not isinstance(doc, list) or len(doc) != 2 or not isinstance(doc[1], list):
        raise SystemExit(f"{path}: not a World Bank API answer")
    meta, rows = doc
    if meta.get("pages", 1) != 1:
        raise SystemExit(f"{path}: the answer has {meta.get('pages')} pages; raise per_page")
    out: dict[str, tuple[int, float]] = {}
    for r in rows:
        iso2, value = (r.get("country") or {}).get("id"), r.get("value")
        if not iso2 or value is None:
            continue
        year = int(r["date"])
        if iso2 not in out or year > out[iso2][0]:
            out[iso2] = (year, value)
    return out, meta.get("lastupdated")


def build(paths: dict) -> dict:
    outline_ids = {c["id"] for c in json.loads(OUTLINES.read_text())["countries"]}
    countries: dict[str, dict] = {}
    updated = []
    for key, (_code, _label, _unit, decimals) in FIGURES.items():
        values, last = newest(paths[key])
        updated.append(last)
        for iso2, (year, value) in values.items():
            if iso2 in outline_ids:
                countries.setdefault(iso2, {})[key] = [year, round(value) if decimals == 0 else round(value, decimals)]
    manifest = read_manifest(SOURCE_ID)  # {rel_path: {url, sha256, bytes, retrieved}}
    retrieved = min((manifest.get(f"wdi/{code}.json") or {}).get("retrieved", "")[:10] for code, *_r in FIGURES.values())
    return {
        "version": 1,
        "source": {
            "title": "World Development Indicators", "publisher": "World Bank",
            "url": "https://datacatalog.worldbank.org/search/dataset/0037712", "license": "CC BY 4.0",
            "updated": max(u for u in updated if u), "retrieved": retrieved,
        },
        "figures": [
            {"key": key, "label": label, "unit": unit, "indicator": code} for key, (code, label, unit, _d) in FIGURES.items()
        ],
        "countries": dict(sorted(countries.items())),
    }


def write(doc: dict) -> None:
    """One country per line, so a refresh's diff shows which countries changed."""
    head = json.dumps({k: v for k, v in doc.items() if k != "countries"}, ensure_ascii=False, separators=(",", ":"))
    rows = [f'"{k}":{json.dumps(v, separators=(",", ":"))}' for k, v in doc["countries"].items()]
    text = head[:-1] + ',"countries":{\n' + ",\n".join(rows) + "\n}}\n"
    json.loads(text)  # the hand-made framing must still be valid JSON
    atomic_write_text(OUT, text)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--offline", action="store_true", help="use cached downloads only")
    ap.add_argument("--refresh", action="store_true", help="download the World Bank figures again")
    args = ap.parse_args(argv)
    fetch.OFFLINE = args.offline
    doc = build(fetch_inputs(refresh=args.refresh))
    write(doc)
    n = len(doc["countries"])
    print(f"{OUT.relative_to(WEB.parent)}: {n} countries, World Bank data updated {doc['source']['updated']}, "
          f"{OUT.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
