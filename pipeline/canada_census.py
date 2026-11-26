"""2021 Census figures for the Canadian edition: the census division lenses, and the economic profile of Canada, its
provinces and territories, CMAs and CAs (the fields the U.S. edition fills from the ACS: workers by industry,
employment, unemployment, median household income, rent and home value). Unemployment comes from the Labour Force
Survey's latest annual averages where the survey publishes one (labour_force()), and from the census elsewhere.
Population comes from Statistics Canada's annual July 1 estimates on 2021 boundaries (population_estimates()), as the
U.S. edition uses the Census Bureau's population estimates for growth.

Small tables are downloaded whole as CSV. From the large ones only the needed series are requested through Statistics
Canada's Web Data Service (WDS), its documented programmatic API, and each reply is cached under data/raw/canada/ and
logged in the download manifest like any other file.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

from .core import fetch
from .core.paths import RAW
from .core.store import atomic_write_text

SOURCE_DIR = RAW / "canada"
WDS = "https://www150.statcan.gc.ca/t1/wds/rest"
CSV_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/{}-eng.zip"
DIVISION_TABLES = ["98100057", "98100103", "98100022", "98100348", "98100387", "98100259", "98100354"]
AREA_TABLES = ["98100061"]
BATCH = 100  # WDS coordinates per request
FORCE = False  # refetch cached Web Data Service replies (set by `python -m pipeline.canada --force`)

# Census industries are NAICS 2017 sectors, the same sectors as the U.S. edition's industry keys (in its order).
SECTORS = {"11": "agriculture", "21": "mining", "23": "construction", "31-33": "manufacturing", "41": "wholesale",
           "44-45": "retail", "48-49": "transportation", "22": "utilities", "51": "information", "52": "finance",
           "53": "real_estate", "54": "professional", "55": "management", "56": "admin", "61": "education",
           "62": "health", "71": "arts", "72": "accommodation", "81": "other", "91": "public_admin"}
INDUSTRIES = {
    "agriculture": "Agriculture, forestry, fishing & hunting", "mining": "Mining, quarrying, oil & gas",
    "construction": "Construction", "manufacturing": "Manufacturing", "wholesale": "Wholesale trade",
    "retail": "Retail trade", "transportation": "Transportation & warehousing", "utilities": "Utilities",
    "information": "Information & cultural industries", "finance": "Finance & insurance",
    "real_estate": "Real estate, rental & leasing", "professional": "Professional, scientific & technical",
    "management": "Management of companies", "admin": "Administrative & waste services",
    "education": "Educational services", "health": "Health care & social assistance",
    "arts": "Arts, entertainment & recreation", "accommodation": "Accommodation & food services",
    "other": "Other services", "public_admin": "Public administration",
}
WHERE = "counted where they live (2021 Census, employed people aged 15+ by NAICS sector, table 98-10-0448)"
JOB_YIELDS = [  # the U.S. yields (pipeline/build/yields.py), from the Canadian census
    dict(key="food", icon="y-food", emoji="🌾", label="Food", color="#7fbf3f", unit="workers", industries=["agriculture"],
         description=f"Workers in agriculture, forestry, fishing & hunting, {WHERE}."),
    dict(key="production", icon="y-production", emoji="⚙️", label="Production", color="#d9823b", unit="workers",
         industries=["manufacturing", "construction", "mining"],
         description=f"Workers in manufacturing, construction and mining, {WHERE}."),
    dict(key="science", icon="y-science", emoji="🔬", label="Science", color="#4fa3e0", unit="workers",
         industries=["professional", "information"],
         description=f"Workers in professional, scientific & technical services and in information & cultural "
                     f"industries, {WHERE}."),
    dict(key="culture", icon="y-culture", emoji="🎭", label="Culture", color="#b07ce0", unit="workers",
         industries=["arts"], description=f"Workers in arts, entertainment & recreation, {WHERE}."),
]

# Largest religious tradition (self-identified, 2021 Census table 98-10-0354), in legend order.
FAITHS = [
    ("catholic", "Catholic", "#e3b23c", "Roman, Ukrainian and other Catholic."),
    ("christian", "Protestant & other Christian", "#4f7cc0",
     "Every other Christian group: United Church, Anglican, Baptist, Pentecostal, Orthodox, Christian not otherwise "
     "stated and more."),
    ("none", "No religion", "#8fa3b8", "No religion and secular perspectives."),
    ("muslim", "Muslim", "#2f9e95", "Muslim."),
    ("sikh", "Sikh", "#d9823b", "Sikh."),
    ("hindu", "Hindu", "#c8643b", "Hindu."),
    ("jewish", "Jewish", "#8a5bb5", "Jewish."),
    ("buddhist", "Buddhist", "#b07ce0", "Buddhist."),
    ("indigenous", "Indigenous spirituality", "#6aa84f", "Traditional (North American Indigenous) spirituality."),
    ("other", "Other religions", "#9a9aa8", "Other religions and spiritual traditions."),
]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rows(number):
    with zipfile.ZipFile(SOURCE_DIR / f"{number}.zip") as z:
        with io.TextIOWrapper(z.open(f"{number}.csv"), encoding="utf-8-sig") as f:
            yield from csv.DictReader(f)


def num(text):
    try:
        return float(text) if text not in (None, "", "..", "...", "x", "F") else None
    except ValueError:
        return None


def column(row, label):
    """The value column whose header contains `label` (StatCan headers carry a dimension prefix and a [n] suffix)."""
    for key, value in row.items():
        if key and label in key:
            return value
    raise KeyError(label)


# ---------------------------------------------------------------- WDS


def _post(path, body):
    request = urllib.request.Request(f"{WDS}/{path}", data=json.dumps(body).encode(), method="POST",
                                     headers={"User-Agent": fetch.USER_AGENT, "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            client_error = isinstance(exc, urllib.error.HTTPError) and exc.code < 500 and exc.code != 429
            if attempt == 4 or client_error:
                raise
            time.sleep(2 ** attempt)


def _cached(name, url, key, produce):
    """`produce()` once (a WDS reply), kept as data/raw/canada/<name> and logged in the download manifest. A cached
    reply is reused only if it answers the same request (`key`)."""
    path = SOURCE_DIR / name
    if path.exists() and not FORCE:
        doc = json.loads(path.read_text())
        if doc.get("request") == key:
            return doc["data"]
    if fetch.OFFLINE:
        raise fetch.OfflineError(f"--offline: canada/{name} is not cached ({url})")
    print(f"    ↓ {url}", flush=True)
    text = json.dumps(dict(request=key, data=produce()), ensure_ascii=False, separators=(",", ":"))
    atomic_write_text(path, text)
    manifest = fetch.read_manifest("canada")
    manifest[name] = dict(url=url, sha256=hashlib.sha256(text.encode()).hexdigest(), bytes=len(text.encode()),
                          retrieved=now())
    atomic_write_text(fetch.manifest_path("canada"), json.dumps(manifest, indent=2, sort_keys=True))
    return json.loads(text)["data"]


def metadata(pid):
    return _cached(f"{pid}-meta.json", f"{WDS}/getCubeMetadata (table {pid})", pid,
                   lambda: _post("getCubeMetadata", [{"productId": int(pid)}])[0]["object"])


def series(pid, coords, label, period=False, name=None):
    """{coordinate: value} for the given WDS coordinates (latest period), or {coordinate: [value, reference date]}
    with `period`. `name` is the cache file, for a second request to the same table (default <pid>.json)."""
    def produce():
        out = {}
        for i in range(0, len(coords), BATCH):
            batch = [{"productId": int(pid), "coordinate": c, "latestN": 1} for c in coords[i:i + BATCH]]
            for item in _post("getDataFromCubePidCoordAndLatestNPeriods", batch):
                obj = item.get("object") or {}
                points = obj.get("vectorDataPoint") or []
                if item.get("status") == "SUCCESS" and points:
                    value = points[0].get("value")
                    out[obj["coordinate"]] = [value, points[0].get("refPer")] if period else value
            time.sleep(0.25)
        return out

    key = hashlib.sha256((("period\n" if period else "") + "\n".join(coords)).encode()).hexdigest()
    return _cached(name or f"{pid}.json", f"{WDS}/getDataFromCubePidCoordAndLatestNPeriods (table {pid}: {label}, "
                   f"{len(coords)} series)", key, produce)


def history(pid, coords, label, periods):
    """{coordinate: {year: value}} for the given WDS coordinates over the latest `periods` reference periods."""
    def produce():
        out = {}
        for i in range(0, len(coords), BATCH):
            batch = [{"productId": int(pid), "coordinate": c, "latestN": periods} for c in coords[i:i + BATCH]]
            for item in _post("getDataFromCubePidCoordAndLatestNPeriods", batch):
                obj = item.get("object") or {}
                if item.get("status") == "SUCCESS":
                    out[obj["coordinate"]] = {p["refPer"][:4]: p.get("value") for p in obj.get("vectorDataPoint") or []}
            time.sleep(0.25)
        return out

    key = hashlib.sha256((f"history {periods}\n" + "\n".join(coords)).encode()).hexdigest()
    return _cached(f"{pid}.json", f"{WDS}/getDataFromCubePidCoordAndLatestNPeriods (table {pid}: {label}, "
                   f"{len(coords)} series, latest {periods} years)", key, produce)


def coordinate(*ids):
    return ".".join(str(i) for i in ids + (0,) * (10 - len(ids)))


LEVEL_PREFIX = {0: "2021A0000", 2: "2021A0002", 3: "2021A0003", 503: "2021S0503", 504: "2021S0504"}
CANADA = "2021A000011124"


def geographies(meta, levels):
    """[(member id, DGUID)] of the table's geography members at the given levels (0 Canada, 2 provinces and
    territories, 3 census divisions, 503 CMAs, 504 CAs). Canada's code varies by table (11124 or 1124)."""
    return [(m["memberId"], CANADA if m["geoLevel"] == 0 else LEVEL_PREFIX[m["geoLevel"]] + m["classificationCode"])
            for m in meta["dimension"][0]["member"] if m.get("geoLevel") in levels]


def member(meta, position, name):
    clean = lambda s: " ".join(s.replace("\xa0", " ").split())
    for m in meta["dimension"][position - 1]["member"]:
        if clean(m["memberNameEn"]) == name:
            return m["memberId"]
    raise KeyError(f"{name!r} not in dimension {position} of table {meta['productId']}")


# ---------------------------------------------------------------- downloads


def fetch_all(force=False):
    """Download the census CSV tables (cached unless `force`)."""
    for number in DIVISION_TABLES + AREA_TABLES:
        fetch.download("canada", CSV_URL.format(number), f"{number}.zip", force=force, timeout=300, expect_binary=True)


def files():
    """The Almanac file lists for the two census sources, the Labour Force Survey and the population estimates
    (names in data/raw/canada/)."""
    wds = lambda tables: [f"{n}{part}.json" for n in tables for part in ("-meta", "")]
    return ([f"{n}.zip" for n in DIVISION_TABLES] + ["98100458.json"],
            [f"{n}.zip" for n in AREA_TABLES] + ["98100448.json", "98100253.json", "98100256.json"],
            wds(LFS_TABLES), wds(ESTIMATE_TABLES))


# ---------------------------------------------------------------- census divisions (lenses)


def division_profile():
    """{DGUID: {lens key: value}} for census divisions (and the provinces and Canada, for reference)."""
    out = defaultdict(dict)
    for r in rows("98100057"):
        if r["Household size (7)"].startswith("Total") and r["Household type including census family structure  (11)"].startswith("Total"):
            out[r["DGUID"]]["income"] = num(column(r, "Median household total income (2020)"))
    for r in rows("98100103"):
        if r["Gender (3a)"] == "Total - Gender" and r["Year (2)"] == "2020" and r["Age (8)"] == "Total - Age":
            v = num(column(r, "Prevalence of low income (LIM-AT) (%)"))
            out[r["DGUID"]]["poverty"] = None if v is None else round(v / 100, 4)
    for r in rows("98100022"):
        if r["Census year (2)"] == "2021" and r["Age (in single years), average age and median age (128)"] == "Median age":
            out[r["DGUID"]]["age"] = num(column(r, "Total - Gender"))
    for r in rows("98100348"):
        if r["Age (15C)"] == "Total - Age" and r["Gender (3)"] == "Total - Gender" and r["Statistics (2)"] == "2021 Counts":
            total = num(column(r, "Total - Immigrant status and period of immigration"))
            born = [num(column(r, "Immigrants[")), num(column(r, "Non-permanent residents"))]
            out[r["DGUID"]]["foreign_born"] = round(sum(born) / total, 4) if total and None not in born else None
    degrees = defaultdict(lambda: [0.0, 0.0])
    for r in rows("98100387"):
        if r["Statistics (6B)"] == "Count" and r["Gender (3)"] == "Total - Gender" and r["Age (15A)"] in ("25 to 64 years", "65 years and over"):
            total, higher = num(column(r, "Total - Highest certificate, diploma or degree")), num(column(r, "Bachelor’s degree or higher"))
            if total is not None and higher is not None:
                degrees[r["DGUID"]][0] += higher
                degrees[r["DGUID"]][1] += total
    for dguid, (higher, total) in degrees.items():
        out[dguid]["bachelors"] = round(higher / total, 4) if total else None
    for r in rows("98100259"):
        if r["Census year (2)"] == "2021" and r["Housing indicators (9)"] == "Total - Housing indicators":
            total, owners = num(column(r, "Total - Tenure")), num(column(r, "Owner["))
            out[r["DGUID"]]["homeownership"] = round(owners / total, 4) if total and owners is not None else None
    labels = {"catholic": ["Catholic["], "christian_all": ["Christian["], "none": ["No religion and secular perspectives"],
              "muslim": ["Muslim["], "sikh": ["Sikh["], "hindu": ["Hindu["], "jewish": ["Jewish["], "buddhist": ["Buddhist["],
              "indigenous": ["Traditional (North American Indigenous) spirituality"],
              "other": ["Other religions and spiritual traditions"]}
    for r in rows("98100354"):
        if r["Age (15C)"] == "Total - Age" and r["Gender (3)"] == "Total - Gender" and r["Statistics (2)"] == "2021 Counts":
            total = num(column(r, "Total - Religion"))
            counts = {k: num(column(r, v[0])) for k, v in labels.items()}
            if not total or None in counts.values():
                continue
            counts["christian"] = counts.pop("christian_all") - counts["catholic"]
            out[r["DGUID"]]["faith"] = round(100 * (total - counts["none"]) / total, 1)
            out[r["DGUID"]]["faith_tradition"] = max(counts, key=counts.get)
    meta = metadata("98100458")
    geos = geographies(meta, {0, 2, 3})
    duration = member(meta, 7, "Average commuting duration (in minutes)")
    coords = {dguid: coordinate(gid, 1, 1, 1, 1, 1, duration) for gid, dguid in geos}
    values = series("98100458", list(coords.values()), "average commuting duration by census division")
    for dguid, c in coords.items():
        out[dguid]["commute"] = values.get(c)
    return out


# ---------------------------------------------------------------- Canada, provinces and territories, CMAs and CAs


def area_profile():
    """{DGUID: {employed, unemployment, jobs, median_income, median_rent, home_value, rent_burden}} for Canada, the
    provinces and territories, and every CMA and CA (the U.S. economic fields)."""
    out = defaultdict(dict)
    for r in rows("98100061"):
        if r["Household type including census family structure (11)"].startswith("Total") and r["Structural type of dwelling (9)"].startswith("Total"):
            out[r["DGUID"]]["median_income"] = num(column(r, "Median total income of households ($) (2020)"))

    meta = metadata("98100448")  # labour force status by industry (NAICS 2017), people aged 15+
    geos = geographies(meta, {0, 2, 503, 504})
    employed, unemployed = member(meta, 2, "Employed"), member(meta, 2, "Unemployed")
    sectors = {}
    for m in meta["dimension"][5]["member"]:
        code = re.match(r"(\d\d(?:-\d\d)?) ", m["memberNameEn"])
        if code and code[1] in SECTORS and m.get("parentMemberId") == member(meta, 6, "All industries"):
            sectors[SECTORS[code[1]]] = m["memberId"]
    if set(sectors) != set(SECTORS.values()):
        raise ValueError(f"98-10-0448 is missing NAICS sectors: {set(SECTORS.values()) - set(sectors)}")
    cell = lambda gid, status, industry: coordinate(gid, status, 1, 1, 1, industry, 1)  # totals: age, gender, count, class
    coords = [c for gid, _ in geos for c in [cell(gid, employed, 1), cell(gid, unemployed, 1)]
              + [cell(gid, employed, sectors[k]) for k in INDUSTRIES]]
    values = series("98100448", coords, "employed and unemployed people aged 15+, employed by NAICS sector")
    for gid, dguid in geos:
        emp, unemp = values.get(cell(gid, employed, 1)), values.get(cell(gid, unemployed, 1))
        jobs = {k: values.get(cell(gid, employed, sectors[k])) for k in INDUSTRIES}
        out[dguid].update(employed=emp, unemployment=round(unemp / (emp + unemp), 4) if emp and unemp is not None else None,
                          jobs={k: None if v is None else int(v) for k, v in jobs.items()})

    meta = metadata("98100253")  # renters' median monthly shelter cost: rent plus utilities (the U.S. gross rent)
    shelter, renter = member(meta, 6, "Median shelter cost"), member(meta, 7, "Renter")
    coords = {dguid: coordinate(gid, 1, 1, 1, 1, shelter, renter) for gid, dguid in geographies(meta, {0, 2, 503, 504})}
    values = series("98100253", list(coords.values()), "median monthly shelter cost of renter households")
    for dguid, c in coords.items():
        out[dguid]["median_rent"] = values.get(c)

    meta = metadata("98100256")  # owner-estimated dwelling value
    value = member(meta, 7, "Median value of dwelling $")
    coords = {dguid: coordinate(gid, 1, 1, 1, 1, 1, value, 1) for gid, dguid in geographies(meta, {0, 2, 503, 504})}
    values = series("98100256", list(coords.values()), "median value of owner-occupied dwellings")
    for dguid, c in coords.items():
        out[dguid]["home_value"] = values.get(c)

    for rec in out.values():
        rent, income = rec.get("median_rent"), rec.get("median_income")
        rec["rent_burden"] = round(rent * 12 / income, 4) if rent and income else None
    return out


# ---------------------------------------------------------------- population estimates

# July 1 population estimates on 2021 boundaries: Canada, provinces, territories and census divisions; CMAs and CAs.
ESTIMATE_TABLES = ("17100152", "17100148")
FIRST_YEAR = 2021  # growth runs from July 1, 2021, the U.S. edition's population-estimates window


def population_estimates():
    """(year, {DGUID: {year: population}}) from Statistics Canada's July 1 population estimates on 2021 boundaries:
    Canada, the provinces and territories and the census divisions (table 17-10-0152), and the CMAs and CAs
    (17-10-0148), from 2021 to the latest year both tables have. (Table 17-10-0005 publishes the provinces a year
    sooner, but cities and divisions follow in January; one year keeps every level consistent.)"""
    out, latest = {}, []
    for pid, levels in (("17100152", {0, 2, 3}), ("17100148", {503, 504})):
        meta = metadata(pid)
        end = int(meta["cubeEndDate"][:4])
        latest.append(end)
        total, ages = member(meta, 2, "Total - gender"), member(meta, 3, "All ages")
        coords = {dguid: coordinate(gid, total, ages) for gid, dguid in geographies(meta, levels)}
        values = history(pid, list(coords.values()), "population on July 1, all ages", end - FIRST_YEAR + 1)
        for dguid, c in coords.items():
            out[dguid] = {int(year): int(v) for year, v in values.get(c, {}).items() if v is not None}
    return min(latest), out


# ---------------------------------------------------------------- Labour Force Survey

LFS_TABLES = ("14100464", "14100461")  # annual averages: Canada, provinces and territories; CMAs
TERRITORY_REGIONS = {"6010": "60", "6110": "61", "6210": "62"}  # each territory is one LFS economic region


def labour_force():
    """{DGUID: (unemployment rate, year)} from the Labour Force Survey's latest annual averages for people aged 15+:
    Canada (the survey's national total covers the ten provinces), the provinces and the territories (table
    14-10-0464) and the census metropolitan areas (14-10-0461). The survey does not publish census agglomerations."""
    out = {}
    meta = metadata("14100464")
    rate = member(meta, 2, "Unemployment rate")
    geos = geographies(meta, {0, 2}) + [(m["memberId"], LEVEL_PREFIX[2] + TERRITORY_REGIONS[m["classificationCode"]])
                                       for m in meta["dimension"][0]["member"]
                                       if m.get("classificationCode") in TERRITORY_REGIONS]
    coords = {dguid: coordinate(gid, rate) for gid, dguid in geos}
    values = series("14100464", list(coords.values()), "unemployment rate, Canada, provinces and territories", period=True)
    meta = metadata("14100461")
    rate, total, adults = (member(meta, 2, "Unemployment rate"), member(meta, 3, "Total - Gender"),
                           member(meta, 4, "15 years and over"))
    metros = {dguid: coordinate(gid, rate, total, adults) for gid, dguid in geographies(meta, {503})}
    values.update(series("14100461", list(metros.values()), "unemployment rate by CMA", period=True))
    for dguid, c in {**coords, **metros}.items():
        value, when = values.get(c) or (None, None)
        if value is not None:
            out[dguid] = (round(value / 100, 4), int(when[:4]))
    return out


def job_yields(jobs):
    """The U.S. job-based yields from a {industry: workers} dict (None when any industry is missing)."""
    out = {}
    for y in JOB_YIELDS:
        vals = [(jobs or {}).get(k) for k in y["industries"]]
        out[y["key"]] = None if not jobs or any(v is None for v in vals) else sum(vals)
    return out


def faith_categories(profile, dguids):
    """The traditions that lead somewhere, in legend order, and each division's category index."""
    leading = Counter(profile[d].get("faith_tradition") for d in dguids if profile.get(d, {}).get("faith_tradition"))
    cats = [f for f in FAITHS if f[0] in leading]
    return cats, {f[0]: i for i, f in enumerate(cats)}


# ---------------------------------------------------------------- GDP by industry

GDP_INDUSTRY_TABLE = "36100711"  # GDP at basic prices, by industry, provinces and territories (annual)


def gdp_by_industry():
    """(year, {province or territory name: {industry key: current dollars}}, {name: all-industries total}) from table
    36-10-0711, the latest year with values, in the U.S. industry keys (NAICS sectors). Canada is the sum of the 13."""
    meta = metadata(GDP_INDUSTRY_TABLE)
    current = member(meta, 2, "Current dollars")
    total = member(meta, 3, "All industries")
    sectors = {SECTORS[m["classificationCode"]]: m["memberId"] for m in meta["dimension"][2]["member"]
               if m.get("classificationCode") in SECTORS}
    if set(sectors) != set(SECTORS.values()):
        raise ValueError(f"36-10-0711 is missing NAICS sectors: {set(SECTORS.values()) - set(sectors)}")
    geos = [(m["memberId"], m["memberNameEn"]) for m in meta["dimension"][0]["member"]]
    cell = lambda g, i: coordinate(g, current, i)
    coords = [cell(g, i) for g, _ in geos for i in [total, *sectors.values()]]
    # The table can list a year before its values are out ("..", e.g. 2025 in November 2026): take the latest year
    # every province, territory and industry has.
    values = history(GDP_INDUSTRY_TABLE, coords, "GDP at basic prices by NAICS sector, current dollars", 3)
    years = sorted({y for v in values.values() for y in v}, reverse=True)
    year = next((y for y in years if all(values.get(c, {}).get(y) is not None for c in coords)), None)
    if year is None:
        raise ValueError(f"36-10-0711: no year with every region and industry ({years})")
    millions = lambda v: None if v is None else round(v * 1e6)  # the table is in millions of dollars
    by_region, totals = {}, {}
    for g, name in geos:
        by_region[name] = {k: millions(values[cell(g, i)][year]) for k, i in sectors.items()}
        totals[name] = millions(values[cell(g, total)][year])
    return int(year), by_region, totals


# ---------------------------------------------------------------- universities

ENROLMENT_TABLE = "37100232"  # postsecondary enrolments by ISCED level and institution


def university_enrolments():
    """(academic year start, breaks, {institution name: {"province", "total", "doctoral"}}) from table 37-10-0232: all
    students and those in doctoral programs (ISCED 8), all registration statuses. The latest academic year is used
    unless an institution with 300+ doctoral students the year before reports fewer than half as many (a reporting
    break, e.g. the University of British Columbia in 2024/2025): then the year before, for every institution, so the
    ranking never mixes years. `breaks` names the institutions that triggered it."""
    meta = metadata(ENROLMENT_TABLE)
    members = meta["dimension"][0]["member"]
    provinces = {m["memberId"]: m["memberNameEn"] for m in members if m.get("parentMemberId") == members[0]["memberId"]}
    institutions = [(m["memberId"], m["memberNameEn"], provinces[m["parentMemberId"]]) for m in members
                    if m.get("parentMemberId") in provinces]
    total, doctoral = (member(meta, 2, "Total, International Standard Classification of Education (ISCED)"),
                       member(meta, 2, "Doctoral or equivalent"))
    cell = lambda inst, level: coordinate(inst, level, 1, 1, 1, 1, 1)  # totals: institution type, registration, program, status, gender
    coords = [cell(i, level) for i, _, _ in institutions for level in (total, doctoral)]
    values = history(ENROLMENT_TABLE, coords, "enrolments, all students and doctoral, by institution", 2)
    latest = max(int(y) for v in values.values() for y in v)
    prev = str(latest - 1)
    breaks = []
    for i, name, province in institutions:
        d = values.get(cell(i, doctoral), {})
        if (d.get(prev) or 0) >= 300 and (d.get(str(latest)) or 0) < 0.5 * d[prev]:
            breaks.append(name.removesuffix(f", {province}"))
    year = str(latest - 1 if breaks else latest)
    out = {}
    for i, name, province in institutions:
        t, d = values.get(cell(i, total), {}).get(year), values.get(cell(i, doctoral), {}).get(year)
        if t:
            out[name.removesuffix(f", {province}")] = dict(province=province, total=int(t), doctoral=int(d or 0))
    return int(year), breaks, out
