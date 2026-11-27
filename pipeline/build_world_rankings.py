"""Build web/data/world-rankings.json: the World Rankings screen on the world map, which compares every country.

    uv run python -m pipeline.build_world_rankings             # downloads into data/raw/world/ on the first run
    uv run python -m pipeline.build_world_rankings --offline   # cached files only
    uv run python -m pipeline.build_world_rankings --refresh   # download the figures again

Ten measures from the World Bank's World Development Indicators API (CC BY 4.0), in five groups. The screen shows a
group as a tab, under the advisor of the same name (web/js/ext/advisors/core/roster.js), and its first measure on the
Overall tab.

Each measure is ranked on one year only: the newest year for which at least RANK_SHARE of the countries with any
figure since FIRST_YEAR have one. A country without a figure for that year keeps its newest figure from another year.
The screen lists it apart, labelled with that year, and never ranks it: figures from different years are never ranked
together. Values keep the World Bank's precision (rounded only where that cannot change an order), and the screen
rounds them for display.

The build stops rather than write a ranking that leaves out a G20 member, or one made from downloads that the World
Bank updated on different days (run it again with --refresh). Standard library only.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import date

from .core import fetch
from .core.fetch import download, read_manifest
from .core.paths import WEB
from .core.store import atomic_write_text

SOURCE_ID = "world"  # downloads land in data/raw/world/wdi/
OUTLINES = WEB / "data" / "world-outlines.json"  # the world map's countries: only they are ranked
OUT = WEB / "data" / "world-rankings.json"
API = "https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&per_page=20000&date={start}:{end}"
FIRST_YEAR = 2015  # an older figure is left out rather than shown
RANK_SHARE = 0.8  # a year is ranked when this share of the countries with any figure have one for it
# The G20's country members: a ranking year that leaves one of them out is too thin to show.
G20 = ("AR", "AU", "BR", "CA", "CN", "DE", "FR", "GB", "ID", "IN", "IT", "JP", "KR", "MX", "RU", "SA", "TR", "US", "ZA")

# Tabs, in the order the screen shows them: (key, label, measures). The key is the advisor whose medallion the tab
# shows, and the first measure is the one the Overall tab ranks.
GROUPS = (
    ("economy", "Economy", ("gdp", "gdp_pc")),
    ("people", "People", ("population", "life")),
    ("knowledge", "Knowledge", ("articles", "internet")),
    ("land", "Land", ("land", "cereals")),
    ("commerce", "Commerce", ("exports", "imports")),
)

# key -> (indicator, label, unit, format, scale, origin, about). `format` says how the screen writes a value, `scale`
# how it colours one (log for measures that span several orders of magnitude). `origin` is where the World Bank has
# the figure from; `about` is what it measures, in the World Bank's own definition, shortened.
MEASURES = {
    "gdp": (
        "NY.GDP.MKTP.CD", "GDP", "current US$", "usd", "log", "national accounts data (statistical offices, central banks, the OECD)",
        "The income earned by producing goods and services in the country during the year, in current U.S. dollars.",
    ),
    "gdp_pc": (
        "NY.GDP.PCAP.CD", "GDP per person", "current US$", "usd", "log", "national accounts data (statistical offices, central banks, the OECD)",
        "GDP divided by everyone living in the country, in current U.S. dollars.",
    ),
    "population": (
        "SP.POP.TOTL", "Population", "people", "people", "log", "the UN's World Population Prospects",
        "Everyone living in the country in the middle of the year, whatever their citizenship or legal status.",
    ),
    "life": (
        "SP.DYN.LE00.IN", "Life expectancy", "years", "years", "linear", "the UN's World Population Prospects",
        "How long a baby born that year would live if the death rates of that year stayed the same all its life.",
    ),
    "articles": (
        "IP.JRN.ARTC.SC", "Science articles", "articles", "articles", "log", "the U.S. National Science Foundation, from Scopus",
        "Articles in science and engineering journals and conference proceedings. An article written in several "
        "countries is shared between them, so a count can have a fraction.",
    ),
    "internet": (
        "IT.NET.USER.ZS", "Internet users", "% of people", "pct", "linear", "the International Telecommunication Union",
        "The share of people who used the Internet, anywhere and on any device, in the last three months.",
    ),
    "land": (
        "AG.LND.TOTL.K2", "Land area", "km²", "km2", "log", "the UN Food and Agriculture Organization",
        "The country's area without its lakes and major rivers, and without the sea it claims.",
    ),
    "cereals": (
        "AG.PRD.CREL.MT", "Cereal harvest", "tonnes", "tonnes", "log", "the UN Food and Agriculture Organization",
        "Wheat, rice, maize and the other cereals harvested for dry grain, in tonnes.",
    ),
    "exports": (
        "TX.VAL.MRCH.CD.WT", "Goods exports", "current US$", "usd", "log", "the World Trade Organization",
        "The goods the country sold abroad during the year, in current U.S. dollars (services are not counted).",
    ),
    "imports": (
        "TM.VAL.MRCH.CD.WT", "Goods imports", "current US$", "usd", "log", "the World Trade Organization",
        "The goods the country bought from abroad during the year, in current U.S. dollars (services are not counted).",
    ),
}


def fetch_inputs(refresh: bool = False) -> dict:
    """{measure key: path} of each measure's API answer, cached in data/raw/world/wdi/."""
    end = date.today().year
    return {
        key: download(
            SOURCE_ID, API.format(code=spec[0], start=FIRST_YEAR, end=end), f"wdi/{spec[0]}.json",
            force=refresh and not fetch.OFFLINE,
        )
        for key, spec in MEASURES.items()
    }


def series(path) -> tuple[dict[str, dict[int, float]], str | None]:
    """{ISO-2 code: {year: value}} of every non-empty figure in an API answer, and the database's update date."""
    doc = json.loads(path.read_text())
    if not isinstance(doc, list) or len(doc) != 2 or not isinstance(doc[1], list):
        raise SystemExit(f"{path}: not a World Bank API answer")
    meta, rows = doc
    if meta.get("pages", 1) != 1:
        raise SystemExit(f"{path}: the answer has {meta.get('pages')} pages; raise per_page")
    out: dict[str, dict[int, float]] = {}
    for r in rows:
        iso2, value = (r.get("country") or {}).get("id"), r.get("value")
        if not iso2 or value is None:
            continue
        out.setdefault(iso2, {})[int(r["date"])] = value
    return out, meta.get("lastupdated")


def ranking_year(by_country: dict[str, dict[int, float]], share: float = RANK_SHARE) -> int:
    """The newest year for which at least `share` of the countries that have any figure have one."""
    have = [years for years in by_country.values() if years]
    if not have:
        raise SystemExit("no figures at all")
    need = math.ceil(share * len(have))
    for year in sorted({y for years in have for y in years}, reverse=True):
        if sum(1 for years in have if year in years) >= need:
            return year
    raise SystemExit("no year has enough countries")  # unreachable: the oldest year of all counts every country once


def check_g20(key: str, year: int, by_country: dict[str, dict[int, float]]) -> None:
    missing = [iso for iso in G20 if year not in by_country.get(iso, {})]
    if missing:
        raise SystemExit(f"{key}: the {year} ranking would leave out {', '.join(missing)} (G20)")


def compact(value: float, keep: int = 4):
    """A value as the file stores it: whole numbers from 100,000 up, else `keep` decimals (whole when exact)."""
    v = round(value) if abs(value) >= 1e5 else round(value, keep)
    return int(v) if float(v).is_integer() else v


def rounded(values: dict[str, float]) -> dict[str, float]:
    """`values` rounded by compact(), unless rounding would make two different values equal (then 6 decimals)."""
    out = {iso: compact(v) for iso, v in values.items()}
    if len(set(out.values())) < len(set(values.values())):
        out = {iso: compact(v, 6) for iso, v in values.items()}
    if len(set(out.values())) < len(set(values.values())):
        out = dict(values)
    return out


def build(paths: dict) -> dict:
    outline_ids = {c["id"] for c in json.loads(OUTLINES.read_text())["countries"]}
    countries: dict[str, dict] = {}
    measures = []
    updated = set()
    for key, (code, label, unit, fmt, scale, origin, about) in MEASURES.items():
        raw, last = series(paths[key])
        updated.add(last)
        # Countries only: regional and income-group aggregates have no outline on the world map.
        by_country = {iso: years for iso, years in raw.items() if iso in outline_ids}
        year = ranking_year(by_country)
        check_g20(key, year, by_country)
        ranked = {iso: years[year] for iso, years in by_country.items() if year in years}
        stored = rounded(ranked)
        for iso, years in by_country.items():
            if iso in stored:
                countries.setdefault(iso, {})[key] = [year, stored[iso]]
            else:  # another year: the newest this country has, shown with its year and never ranked
                other = max(years)
                countries.setdefault(iso, {})[key] = [other, compact(years[other])]
        measures.append({
            "key": key, "label": label, "unit": unit, "format": fmt, "scale": scale, "indicator": code,
            "origin": origin, "about": about, "year": year, "ranked": len(ranked), "listed": len(by_country),
        })
    if len(updated) != 1 or None in updated:
        raise SystemExit(f"the downloads were updated on different days ({sorted(map(str, updated))}): run with --refresh")
    manifest = read_manifest(SOURCE_ID)  # {rel_path: {url, sha256, bytes, retrieved}}
    retrieved = min((manifest.get(f"wdi/{spec[0]}.json") or {}).get("retrieved", "")[:10] for spec in MEASURES.values())
    by_key = {m["key"]: m for m in measures}
    return {
        "version": 1,
        "source": {
            "title": "World Development Indicators", "publisher": "World Bank",
            "url": "https://datacatalog.worldbank.org/search/dataset/0037712", "license": "CC BY 4.0",
            "updated": updated.pop(), "retrieved": retrieved,
        },
        "first_year": FIRST_YEAR,
        "rank_share": RANK_SHARE,
        "groups": [{"key": key, "label": label, "lead": keys[0], "measures": list(keys)} for key, label, keys in GROUPS],
        "measures": [by_key[k] for _g, _l, keys in GROUPS for k in keys],
        "countries": {iso: {k: row[k] for k in MEASURES if k in row} for iso, row in sorted(countries.items())},
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
    print(f"{OUT.relative_to(WEB.parent)}: {len(doc['countries'])} countries, World Bank data updated "
          f"{doc['source']['updated']}, {OUT.stat().st_size / 1e3:.0f} kB")
    for m in doc["measures"]:
        print(f"  {m['key']:<10} {m['year']}  ranked {m['ranked']:>3}  other year {m['listed'] - m['ranked']:>2}")


if __name__ == "__main__":
    main()
