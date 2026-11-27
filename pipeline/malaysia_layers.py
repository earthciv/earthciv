"""Map layers for the Malaysia edition (M4): infrastructure.json, wonders.json and disasters.json (floods).
Called from pipeline/malaysia.py (`register_inputs` once, `write_layers` from build()).

Contracts: docs/DATA_CONTRACTS.md; the worked example is pipeline/canada.py (`infrastructure`, `wonders`) and
pipeline/canada_disasters.py. Left out for lack of open data, and said so in docs/MALAYSIA.md and the text pack:

* trade.json: no open inter-state freight flows (DOSM's trade tables are national external trade);
* military.json: the Ministry of Defence publishes no list of properties with land areas to check a base against;
* ports in infrastructure.json: no open port-by-port cargo statistics, and Natural Earth lacks Port Klang and
  Tanjung Pelepas. `ports` is an empty list rather than an unranked guess.

Rule 4 of "Race and religion" (docs/MALAYSIA.md): no wonder is chosen by a community or a faith. The wonders are
UNESCO's inscribed properties, a short hand-picked list of parks and landmarks that are not places of worship, and the
designated research universities by their number of lecturers.
"""

from __future__ import annotations

import csv
import json
import math
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from urllib.parse import quote

import numpy as np

from . import malaysia_economy as economy

EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2"
OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
LECTURERS_URL = "https://storage.data.gov.my/education/lecturers_uni.csv"
FLOOD_URLS = {  # release year -> workbook (DOSM, Impact of Floods); each carries that year and the one before
    2022: "https://storage.dosm.gov.my/special/flood_impact_2022.xlsx",
    2023: "https://storage.dosm.gov.my/special/flood_impact_2023.xlsx",
    2024: "https://storage.dosm.gov.my/floods/flood_impact_2024.xlsx",
    2025: "https://storage.dosm.gov.my/floods/flood_impact_2025.xlsx",
}
AIRPORT_SPARQL = """SELECT ?iata ?pax ?year WHERE {
 ?a wdt:P31/wdt:P279* wd:Q1248784 ; wdt:P17 wd:Q833 ; wdt:P238 ?iata ; p:P3872 ?s .
 ?s ps:P3872 ?pax ; pq:P585 ?year . }"""
AIRPORT_PAX_URL = "https://query.wikidata.org/sparql?format=json&query=" + quote(AIRPORT_SPARQL)
AIRPORT_PAX_FILE = "wikidata_airport_passengers.json"

SITE_RINGS = 2  # a port or airport keeps its true point; its hex is the nearest land hex within this many rings
PAX_YEAR = 2019  # the last year before the pandemic: Wikidata has it for most airports
MIN_PAX = 900_000
HUB_PAX = {"L": 5_000_000, "M": 2_000_000, "S": MIN_PAX}
HUBS = {"L": "Large hub", "M": "Medium hub", "S": "Small hub", "N": "Nonhub airport"}

ROAD_CLASSES = [{"id": "main", "name": "Main highway"}, {"id": "major", "name": "Major road"}]
RAIL_TIERS = [{"id": "main", "name": "Main line"}, {"id": "secondary", "name": "Secondary line"}]
RAIL_MAIN_SCALERANK = 5
INFRA_RULES = {
    "roads": "Natural Earth 1:10m roads at scale rank 8 or less, sampled every 4 km and snapped to hex-centre links. "
             "Class 0 (main highways): scale rank 5 or less, which holds the North-South Expressway and the other "
             "expressways and trunk roads; class 1: scale rank 6 to 8. Natural Earth is map art, not a survey: "
             "roads it omits (many Sabah and Sarawak trunk roads) are missing here.",
    "rail": "Natural Earth 1:10m railroads, sampled every 4 km and snapped to hex-centre links; tier 0 (main line) is "
            "scale rank 5 or less, as in the U.S. edition. Lower-ranked lines stay as secondary lines. Natural Earth's "
            "coverage of Malaysian rail is partial.",
    "ports": "Not shown: Malaysia publishes no open cargo statistics by port, and Natural Earth's port points leave out "
             "Port Klang and Tanjung Pelepas, the two largest. A list without a measure would be an arbitrary one.",
}

# ------------------------------------------------------------------------------------------------- wonders
# Coordinates were checked against the project geocoder (OpenStreetMap, geocode.datasains.info) and Wikidata on
# 2026-11-27 (Kinabalu is the summit, Melaka the Stadthuys, UTM its Iskandar Puteri campus; Taman Negara and the
# other parks are the geocoder's centre points); a 6 km hex hides errors of a kilometre or two. (id, name, short, kind, lon, lat, metrics, state note)
UNESCO_URL = "https://whc.unesco.org/en/statesparties/my"
WORLD_HERITAGE = [
    ("unesco-mulu", "Gunung Mulu National Park", "Gunung Mulu", "natural", 114.8125, 4.0425, 2000),
    ("unesco-kinabalu", "Kinabalu Park", "Kinabalu", "natural", 116.558, 6.075, 2000),
    ("unesco-melaka", "Melaka, Historic City of the Straits of Malacca", "Melaka", "landmark", 102.2486, 2.1944, 2008),
    ("unesco-george-town", "George Town, Historic City of the Straits of Malacca", "George Town", "landmark",
     100.3287, 5.4142, 2008),
    ("unesco-lenggong", "Archaeological Heritage of the Lenggong Valley", "Lenggong Valley", "landmark", 100.972, 5.0679, 2012),
    ("unesco-frim", "Forest Research Institute Malaysia (FRIM) Selangor Forest Park", "FRIM Forest Park", "natural", 101.6333,
     3.2333, 2025),
    ("unesco-niah", "Archaeological Heritage of Niah National Park's Caves Complex", "Niah Caves", "landmark",
     113.7814, 3.8139, 2024),
]
PARKS = [  # hand-picked national and state parks that are not UNESCO sites: (id, name, short, lon, lat)
    ("park-taman-negara", "Taman Negara", "Taman Negara", 102.26, 4.525),
    ("park-bako", "Bako National Park", "Bako", 110.4784, 1.7207),
    ("park-endau-rompin", "Endau-Rompin National Park", "Endau-Rompin", 103.2735, 2.4797),
    ("park-tunku-abdul-rahman", "Tunku Abdul Rahman Park", "Tunku Abdul Rahman", 116.0, 5.9667),
    ("park-royal-belum", "Royal Belum State Park", "Royal Belum", 101.5452, 5.7514),
]
LANDMARKS = [  # hand-picked, none a place of worship: (id, name, short, lon, lat)
    ("landmark-petronas-towers", "Petronas Twin Towers", "Petronas Towers", 101.7112, 3.1580),
    ("landmark-langkawi-sky-bridge", "Langkawi Sky Bridge", "Sky Bridge", 99.6620, 6.3866),
    ("landmark-bakun-dam", "Bakun Dam", "Bakun Dam", 114.0550, 2.7622),
    ("landmark-kellies-castle", "Kellie's Castle", "Kellie's Castle", 101.0878, 4.4744),
]
# The five universities the Ministry of Higher Education designated Research Universities (2006, UTM 2010), with the
# name `lecturers_uni` uses and the campus the published point stands on (project geocoder).
RESEARCH_UNIVERSITIES = [
    ("Universiti Malaya (UM)", "Universiti Malaya", "Malaya", 101.6559, 3.1258),
    ("Universiti Kebangsaan Malaysia (UKM)", "Universiti Kebangsaan Malaysia", "Kebangsaan", 101.7812, 2.9241),
    ("Universiti Sains Malaysia (USM)", "Universiti Sains Malaysia", "Sains Malaysia", 100.3036, 5.3574),
    ("Universiti Putra Malaysia (UPM)", "Universiti Putra Malaysia", "Putra", 101.7046, 3.0015),
    ("Universiti Teknologi Malaysia (UTM)", "Universiti Teknologi Malaysia", "Teknologi Malaysia", 103.6399, 1.5585),
]
PER_CITY = {"research_university": 2, "landmark": 1}  # as pipeline/canada.py


def register_inputs(source):
    """Add this module's raw files to pipeline/malaysia.py's INPUTS (called once at import)."""
    source("natural_earth_transport", "Natural Earth v5.1.2 roads and railroads", "Natural Earth", "https://www.naturalearthdata.com/",
           "Public domain", "v5.1.2 (1:10m)", ["Roads and rail on the map"],
           "Roads and railroads at 1:10m as map art, read from the shapefiles of the pinned release.", {
               f"ne_{layer}.{ext}": f"{EARTH}/10m_cultural/ne_10m_{layer}.{ext}"
               for layer in ("roads", "railroads") for ext in ("shp", "dbf")})
    source("ourairports", "OurAirports", "OurAirports (David Megginson)", "https://ourairports.com/data/", "Public domain",
           "As retrieved", ["Airport positions by IATA code"],
           "Airport reference points; passenger figures are not in it.", {"ourairports.csv": OURAIRPORTS_URL})
    source("wikidata_airport_passengers", "Wikidata: annual passengers of Malaysian airports", "Wikidata contributors",
           "https://www.wikidata.org/", "CC0", f"Passengers in {PAX_YEAR}, as retrieved",
           ["Airports and their hub classes"],
           "Total annual passengers (arrivals plus departures) of airports whose country is Malaysia, with the year, as "
           "Wikidata records them (originally from Malaysia Airports and the Department of Civil Aviation).",
           {AIRPORT_PAX_FILE: AIRPORT_PAX_URL})
    source("mohe_lecturers", "Lecturers in public universities", "Ministry of Higher Education (MOHE), via data.gov.my",
           "https://data.gov.my/data-catalogue/lecturers_uni", "CC BY 4.0", "2025", ["Research-university wonders"],
           "Lecturers by public university, citizenship and sex, annual: the measure the research-university wonders "
           "are ranked by.", {"lecturers_uni.csv": LECTURERS_URL})
    source("unesco_whc", "UNESCO World Heritage List: Malaysia", "UNESCO World Heritage Centre", UNESCO_URL, "Public listing",
           "Inscriptions to 2025", ["World Heritage wonders"],
           "Malaysia's six inscribed properties (Gunung Mulu, Kinabalu, Melaka and George Town, Lenggong Valley, Niah "
           "Caves, FRIM Selangor Forest Park). Positions are hand-checked points from OpenStreetMap and Wikidata; there is no download.", {})
    source("dosm_floods", "Impact of Floods", "DOSM", "https://open.dosm.gov.my/publications/flood_impact_2025", "No licence stated (© DOSM publication)",
           "2021–2025", ["Flood losses by state and district"],
           "Value of flood losses (RM thousand) to living quarters, vehicles, business premises, manufacturing, "
           "agriculture and infrastructure, by state and district, from DOSM's yearly Impact of Floods workbooks. Each "
           "year is taken from the latest release that carries it.",
           {f"floods_{y}.xlsx": url for y, url in FLOOD_URLS.items()})


# ------------------------------------------------------------------------------------------- file readers
def dbf_rows(path):
    """Rows of a dBase file as {field: text}."""
    b = path.read_bytes()
    n, header, record = struct.unpack("<IHH", b[4:12])
    fields, o = [], 32
    while b[o] != 0x0D:
        fields.append((b[o:o + 11].split(b"\0")[0].decode(), b[o + 16]))
        o += 32
    for i in range(n):
        r, p, row = b[header + i * record:header + (i + 1) * record], 1, {}
        for name, length in fields:
            row[name] = r[p:p + length].decode("latin1").strip()
            p += length
        yield row


def shp_lines(path):
    """Polyline shapes of a shapefile: for each record, its bounding box (lon0, lat0, lon1, lat1) and parts, each a
    list of (lon, lat); None for a null shape."""
    b, o = path.read_bytes(), 100
    while o < len(b):
        length = struct.unpack(">i", b[o + 4:o + 8])[0]
        o += 8
        if struct.unpack("<i", b[o:o + 4])[0] == 0:
            yield None
        else:
            box = struct.unpack("<4d", b[o + 4:o + 36])
            n_parts, n_points = struct.unpack("<ii", b[o + 36:o + 44])
            parts = [*struct.unpack(f"<{n_parts}i", b[o + 44:o + 44 + 4 * n_parts]), n_points]
            q = o + 44 + 4 * n_parts
            pts = struct.unpack(f"<{2 * n_points}d", b[q:q + 16 * n_points])
            yield box, [[(pts[2 * i], pts[2 * i + 1]) for i in range(parts[k], parts[k + 1])] for k in range(n_parts)]
        o += length * 2


def read_xlsx(path):
    """{sheet name: [{column letters: text}]} of a workbook (shared strings and plain cells are enough here)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    z = zipfile.ZipFile(path)
    strings = ["".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t"))
               for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)]
    names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", ns)]
    out = {}
    for i, name in enumerate(names, 1):
        rows = []
        for r in ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml")).iter(f"{{{ns['m']}}}row"):
            row = {}
            for c in r.findall("m:c", ns):
                v = c.find("m:v", ns)
                if v is not None:
                    row[re.match("[A-Z]+", c.get("r")).group()] = strings[int(v.text)] if c.get("t") == "s" else v.text
            rows.append(row)
        out[name.strip()] = rows
    return out


def column(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


# ----------------------------------------------------------------------------------------------- placing
class Places:
    """Where a site stands: its true point, the land hex it belongs to, and that hex's district, city and state."""

    def __init__(self, grid, xy, owners, states, county, counties, places):
        self.grid, self.xy, self.owners, self.states, self.county, self.counties = grid, xy, owners, states, county, counties
        land = [i for i, o in enumerate(owners) if o >= 0]
        self.land = np.array(land)
        self.centres = np.array([grid.center(*grid.col_row(i)) for i in land])
        self.city_of = {}
        for c in places:  # biggest first
            for cell in c.get("footprint") or []:
                self.city_of.setdefault(cell, c["id"])

    def place(self, lon, lat, rings=SITE_RINGS, settle=True):
        """{x, y, cell, county, cbsa, state} or None when no land hex lies within `rings` hexes of the point. A site
        on a land hex stays where it is; one at sea or on foreign land moves to the nearest land hex."""
        x, y = (float(v) for v in self.xy(lon, lat))
        cell = self.grid.cell_at(x, y)
        if cell < 0 or self.owners[cell] < 0:
            d = np.hypot(self.centres[:, 0] - x, self.centres[:, 1] - y)
            k = int(d.argmin())
            if d[k] > rings * math.sqrt(3) * self.grid.radius:
                return None
            cell = int(self.land[k])
            if settle:
                x, y = self.centres[k]
        k = self.county[cell]
        return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "county": self.counties[k]["geoid"] if k >= 0 else None,
                    "cbsa": self.city_of.get(cell), "state": self.states[self.owners[cell]]["abbr"]}


# -------------------------------------------------------------------------------------- infrastructure.json
def road_rail_links(source_dir, grid, xy, owners):
    from .build.infrastructure import links_of, sample_cells

    def keep(x, y):
        cell = grid.cell_at(x, y)
        return cell >= 0 and owners[cell] >= 0

    out = {}
    for layer, filename, main, last in (("roads", "roads", 5, 8), ("rail", "railroads", RAIL_MAIN_SCALERANK, 99)):
        rows = dbf_rows(source_dir / f"ne_{filename}.dbf")
        edges = {}
        for row, shape in zip(rows, shp_lines(source_dir / f"ne_{filename}.shp")):
            rank = int(row["scalerank"] or 0)
            if shape is None or rank > last:
                continue
            (x0, y0, x1, y1) = shape[0]
            if x1 < 98.2 or x0 > 120.7 or y1 < -0.6 or y0 > 8.8:
                continue
            tier = int(rank > main)
            for line in shape[1]:
                lon, lat = zip(*line)
                px, py = xy(np.array(lon), np.array(lat))
                for run in sample_cells(grid, list(zip(px.tolist(), py.tolist())), keep):
                    for a, b in links_of(grid, run):
                        if owners[a] >= 0 and owners[b] >= 0:
                            edges[(a, b)] = min(edges.get((a, b), tier), tier)
        out[layer] = [[a, b, tier] for (a, b), tier in sorted(edges.items())]
    return out


def airport_rows(source_dir, where):
    """Airports with at least MIN_PAX passengers in PAX_YEAR (Wikidata), placed by IATA code (OurAirports)."""
    points = {}
    with (source_dir / "ourairports.csv").open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["iso_country"] == "MY" and r["iata_code"]:
                points[r["iata_code"]] = r
    pax = defaultdict(int)
    for b in json.loads((source_dir / AIRPORT_PAX_FILE).read_text(encoding="utf8"))["results"]["bindings"]:
        if b["year"]["value"][:4] == str(PAX_YEAR):
            pax[b["iata"]["value"]] = max(pax[b["iata"]["value"]], int(float(b["pax"]["value"])))
    rows, off_map = [], []
    for iata, total in sorted(pax.items(), key=lambda kv: -kv[1]):
        if total < MIN_PAX:
            continue
        p = points.get(iata)
        if p is None:
            raise ValueError(f"no OurAirports position for {iata}")
        at = where.place(float(p["longitude_deg"]), float(p["latitude_deg"]), settle=False)
        if at is None:
            off_map.append(p["name"])
            continue
        hub = next((h for h in "LMS" if total >= HUB_PAX[h]), "N")
        rows.append(dict(id=iata, name=p["name"], city=p["municipality"] or None, hub=hub, enplanements=round(total / 2),
                         enplanements_prev=None, cargo_t=None, passengers=total, year=PAX_YEAR, **at))
    return rows, off_map


def infrastructure_doc(source_dir, grid, xy, owners, where):
    links = road_rail_links(source_dir, grid, xy, owners)
    airports, off_map = airport_rows(source_dir, where)
    print(f"    infrastructure: {len(links['roads'])} road links, {len(links['rail'])} rail links, {len(airports)} airports "
          f"(off the map: {off_map})")
    rules = dict(INFRA_RULES, airports=(
        f"Every airport with {MIN_PAX:,}+ passengers in {PAX_YEAR}, the last year before the pandemic (Wikidata's "
        "statements, from Malaysia Airports and the Department of Civil Aviation), placed by IATA code with "
        "OurAirports. The figures are total passengers, arrivals plus departures; boardings are shown as half of "
        f"them, an estimate. Hub classes: large {HUB_PAX['L']:,}+ passengers, medium {HUB_PAX['M']:,}+, small "
        f"{HUB_PAX['S']:,}+. Airports with no figure for {PAX_YEAR} (Ipoh, Kuantan, Labuan and others) are not shown."
        + (f" Left out with no land hex within {SITE_RINGS} rings: {', '.join(off_map)}." if off_map else "")))
    return dict(version=1, vintage={"roads": "Natural Earth v5.1.2 (1:10m)", "rail": "Natural Earth v5.1.2 (1:10m)",
                                        "ports": "Not shown (no open port statistics)",
                                        "airports": f"Passengers {PAX_YEAR} (Wikidata); boardings estimated as half"},
                sources=["natural_earth_transport", "ourairports", "wikidata_airport_passengers"],
                road_classes=ROAD_CLASSES, rail_tiers=RAIL_TIERS, rules=rules, hubs=HUBS, ports=[], airports=airports,
                **links)


# ------------------------------------------------------------------------------------------- wonders.json
def lecturers(source_dir):
    """{university: lecturers (all citizenships, both sexes)} in the latest year, and that year."""
    with (source_dir / "lecturers_uni.csv").open(encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["citizenship"] == "all" and r["sex"] == "both"]
    year = max(r["date"][:4] for r in rows)
    return {r["university"]: int(r["staff"]) for r in rows if r["date"][:4] == year}, int(year)


def wonders_doc(source_dir, where):
    staff, year = lecturers(source_dir)
    per_city = Counter()
    out = []

    def add(rule, rank, id, name, short, kind, lon, lat, metrics, curated):
        at = where.place(lon, lat)
        if at is None:
            raise ValueError(f"{name} has no land hex within reach")
        out.append(dict(id=id, name=name, short=short, kind=kind, rule=rule, rank=rank, metrics=metrics, **at,
                        cells=None, curated=curated))
        return at

    for k, (id, name, short, kind, lon, lat, inscribed) in enumerate(sorted(WORLD_HERITAGE, key=lambda w: w[1]), 1):
        add("world_heritage", k, id, name, short, kind, lon, lat, {"inscribed": inscribed}, False)
    taken = {w["cell"] for w in out}
    for k, (id, name, short, lon, lat) in enumerate(sorted(PARKS, key=lambda p: p[1]), 1):
        at = add("national_park", k, id, name, short, "natural", lon, lat, {}, True)
        taken.add(at["cell"])
    ranked, dropped = [], []
    for full, campus, short, lon, lat in sorted(RESEARCH_UNIVERSITIES, key=lambda u: -staff[u[0]]):
        at = where.place(lon, lat)
        city = at and at["cbsa"]
        if city and per_city[city] >= PER_CITY["research_university"]:
            dropped.append(campus)
            continue
        per_city[city] += 1
        ranked.append(add("research_university", len(ranked) + 1, "univ-my-" + re.sub(r"[^a-z]+", "-", campus.lower()).strip("-"),
                          campus, short, "university", lon, lat, {"lecturers": staff[full], "year": year}, False))
    per_city = Counter()
    for k, (id, name, short, lon, lat) in enumerate(sorted(LANDMARKS, key=lambda p: p[1]), 1):
        at = where.place(lon, lat)
        if at["cell"] in taken or (at["cbsa"] and per_city[at["cbsa"]] >= PER_CITY["landmark"]):
            raise ValueError(f"{name} duplicates a wonder's hex or city; pick another landmark")
        per_city[at["cbsa"]] += 1
        add("landmark", k, id, name, short, "landmark", lon, lat, {}, True)
    print(f"    wonders: {len(out)} ({Counter(w['rule'] for w in out)}); universities dropped by the city cap: {dropped}")
    note = (f" {', '.join(dropped)} {'stands' if len(dropped) == 1 else 'stand'} in a city that already holds "
            f"{PER_CITY['research_university']} and {'is' if len(dropped) == 1 else 'are'} left out."
            if dropped else "")
    rank = {r: i for i, r in enumerate(("world_heritage", "national_park", "research_university", "landmark"))}
    return {
        "version": 1,
        "vintage": {"world_heritage": "UNESCO World Heritage List, inscriptions to 2025", "parks": "Hand-picked",
                     "universities": f"MOHE lecturers in public universities, {year}", "landmarks": "Hand-picked"},
        "sources": ["unesco_whc", "mohe_lecturers"], "national": {},
        "rules": [
            {"id": "world_heritage", "kind": "landmark", "kinds": ["natural", "landmark"], "year": 2025, "listed": "UNESCO World Heritage Site",
                 "text": "Every Malaysian property on UNESCO's World Heritage List (six properties; Melaka and George Town "
                      "are one property, drawn at both cities). Ordered by name, not ranked."},
            {"id": "national_park", "kind": "natural", "kinds": ["natural"], "curated": True,
                 "text": "National and state parks hand-picked by this project, not UNESCO sites. Malaysia publishes no "
                      "open visitor counts by park to rank them by."},
            {"id": "research_university", "kind": "university", "year": year, "measure": "lecturers", "measure_name": "lecturers",
                 "text": f"The five public universities the Ministry of Higher Education designated Research Universities "
                      f"(UM, UKM, UPM and USM in 2006, UTM in 2010), ranked by lecturers in {year} (MOHE, via data.gov.my), at most "
                      f"{PER_CITY['research_university']} per city. Malaysia publishes no research spending or doctoral "
                      f"enrolment by university.{note}"},
            {"id": "landmark", "kind": "landmark", "curated": True,
                 "text": "Hand-picked by this project: structures and sites that are not places of worship, at most one per "
                      "city. Not ranked; ordered by name."},
        ],
        "wonders": sorted(out, key=lambda w: (rank[w["rule"]], w["rank"]))}


# ----------------------------------------------------------------------------------------- disasters.json
FLOOD_CATEGORIES = [  # DOSM table headings (English line) -> id
    ("Living Quarters", "living_quarters"), ("Vehicles", "vehicles"), ("Business Premises", "business"),
    ("Manufacturing", "manufacturing"), ("Agriculture", "agriculture"), ("Infrastructure", "infrastructure"),
]
FLOOD_STATE_ALIASES = {"W.P. Kuala Lumpur": "W.P. Kuala Lumpur", "WP Kuala Lumpur": "W.P. Kuala Lumpur",
                       "W.P. Putrajaya": "W.P. Putrajaya", "WP Putrajaya": "W.P. Putrajaya",
                       "W.P. Labuan": "W.P. Labuan", "WP Labuan": "W.P. Labuan", "Pulau Pinang": "Pulau Pinang",
                       "Penang": "Pulau Pinang", "Wilayah Persekutuan Kuala Lumpur": "W.P. Kuala Lumpur"}


def _value(text):
    """A figure in RM thousand; 0 for DOSM's '-' (not affected by the flood); None for 'n.a', a broken reference or a
    blank (never 0)."""
    if (text or "").strip() == "-":
        return 0.0
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _year_columns(header, upper):
    """{(category index or None, year): column letters} under the year row `header`; `upper` is the row of headings."""
    heads = sorted(((column(c), t) for c, t in upper.items() if t.strip()), key=lambda ct: ct[0])
    out = {}
    for c, t in header.items():
        if re.fullmatch(r"\d{4}", t.strip()):
            above = [h for i, h in heads if i <= column(c)]
            out[(above[-1] if above else "", int(t))] = c
    return out


def flood_table(path, sheet):
    """Rows of one DOSM flood sheet: [(name, {(heading, year): value})] in file order, from the first year row on."""
    rows = read_xlsx(path)[sheet]
    start = next(i for i, r in enumerate(rows) if sum(bool(re.fullmatch(r"\d{4}", t.strip())) for t in r.values()) >= 2)
    upper = {c: t for r in rows[max(0, start - 3):start] for c, t in r.items()}  # headings; a lower row wins a column
    columns = _year_columns(rows[start], upper)
    out = []
    for r in rows[start + 1:]:
        name = " ".join(next((t for c, t in sorted(r.items(), key=lambda ct: column(ct[0])) if column(c) <= 3 and t.strip()), "").split())
        cells = {k: _value(r.get(c)) for k, c in columns.items()}
        if name and any(r.get(c, "").strip() in ("-", "n.a") or _value(r.get(c)) is not None for c in columns.values()):
            out.append((re.sub(r"(?<=[A-Za-z)])\d+$", "", name), cells))  # a trailing footnote mark ("Beaufort3")
    return out


def disasters_doc(source_dir, states, counties, new_districts):
    by_year_state, by_year_district, by_category = defaultdict(dict), defaultdict(dict), defaultdict(dict)
    state_total = defaultdict(dict)
    national = {}
    state_names = {s["name"]: s["abbr"] for s in states}
    for year in sorted({y for y in range(2021, 2026)}):
        release = next(r for r in sorted(FLOOD_URLS, reverse=True) if r in (year, year + 1))
        path = source_dir / f"floods_{release}.xlsx"
        sheets = read_xlsx(path)
        table1 = next(n for n in sheets if n.endswith("1") and n.startswith("Jadual"))
        table2 = next(n for n in sheets if n.endswith("2") and n.startswith("Jadual"))
        # State totals and the six categories (table 1): categories are the headings one row above the year row.
        for name, cells in flood_table(path, table1):
            abbr = state_names.get(FLOOD_STATE_ALIASES.get(name, name))
            total = next((v for (h, y), v in cells.items() if y == year and "Total" in h), None)
            if name.startswith("Malaysia"):
                national[year] = total
            elif abbr:
                by_year_state[abbr][year] = total
                for label, cid in FLOOD_CATEGORIES:
                    v = next((v for (h, y), v in cells.items() if y == year and label in h), None)
                    by_category[abbr].setdefault(cid, {})[year] = v
        # Districts (table 2): a state row opens its block; its districts follow.
        state = None
        for name, cells in flood_table(path, table2):
            total = next((v for (h, y), v in cells.items() if y == year and "Total" in h), None)
            if FLOOD_STATE_ALIASES.get(name, name) in state_names:
                state = FLOOD_STATE_ALIASES.get(name, name)
                state_total[state][year] = total
                continue
            if state and not name.startswith("Malaysia"):
                by_year_district[(state, name)][year] = total
    # Districts by the boundary file's names (the M2 alias table), new districts folded into their parents.
    wanted = {(c["state"], c["name"]): c["geoid"] for c in counties}
    values, unmatched = defaultdict(dict), []
    per_state = Counter(c["state"] for c in counties)
    for state, years in state_total.items():  # a one-district state (Perlis, the federal territories): the state's row
        if per_state[state] == 1:
            values[wanted[(state, next(n for s, n in wanted if s == state))]] = dict(years)
    for (state, name), years in by_year_district.items():
        if per_state[state] == 1:
            continue
        key = economy.canonical(state, name)
        if key in new_districts:
            parents = new_districts[key]
            weight = sum(parents.values())
            for parent, w in parents.items():
                for y, v in years.items():
                    if v is not None:
                        values[wanted[parent]][y] = (values[wanted[parent]].get(y) or 0) + v * w / weight
        elif key in wanted:
            for y, v in years.items():
                if v is not None or y not in values[wanted[key]]:
                    values[wanted[key]][y] = v if v is None else (values[wanted[key]].get(y) or 0) + v
        else:
            unmatched.append(key)
    if unmatched:
        raise ValueError(f"flood rows with no boundary district: {unmatched}")
    years = list(range(2021, 2026))
    rows = [[c["geoid"], *[None if values[c["geoid"]].get(y) is None else round(values[c["geoid"]][y], 1) for y in years]]
            for c in counties]
    state_rows = {}
    for s in states:
        a = s["abbr"]
        state_rows[a] = {"loss_k": [None if by_year_state[a].get(y) is None else round(by_year_state[a][y], 1) for y in years],
                             "by_category": {cid: [None if v.get(y) is None else round(v[y], 1) for y in years]
                                          for cid, v in by_category[a].items()}}
    complete = [bool(national.get(y)) and abs(sum(state_rows[a]["loss_k"][i] or 0 for a in state_rows) / national[y] - 1) < 0.001
                for i, y in enumerate(years)]
    print(f"    floods: national RM thousand {national}; {sum(1 for r in rows if any(v for v in r[1:]))} districts with losses")
    return {
        "version": 1, "sources": ["dosm_floods"],
        "vintage": {"floods": "DOSM Impact of Floods, 2021–2025 (each year from the latest release that carries it)"},
        "floods": {
            "years": years, "unit": "RM thousand, as DOSM publishes them (current prices)",
            "rule": ("The value of losses caused by floods to living quarters, vehicles, business premises, manufacturing, "
                  "agriculture and infrastructure, as DOSM's Impact of Floods reports estimate them from agency and "
                  "survey records. A year's figure is the one in the latest release that carries it, so 2021 comes from "
                  "the 2022 report and 2022 from the 2023 report. These are losses in a year, not a count of events; DOSM "
                  "gives no flood events, dates or deaths. A blank means DOSM published no figure ('n.a'), not zero."),
            "categories": [{"id": cid, "name": label} for label, cid in FLOOD_CATEGORIES],
            "states": state_rows, "states_complete": complete, "states_note": (
                "In 2021 DOSM published agriculture and infrastructure losses for the nation only (RM 90.6 million and RM 2.0 "
                "billion), so that year's state rows cover living quarters, vehicles, business premises and manufacturing, "
                "and add up to less than the national figure. From 2022 the states add up to the nation."),
            "national": {"loss_k": [None if national.get(y) is None else round(national[y], 1) for y in years]},
            "counties": {
                "columns": ["geoid", *[f"loss_district_{y}" for y in years]], "rows": rows,
                "note": ("DOSM allocates to districts only the losses to living quarters, vehicles, business premises and "
                         "manufacturing (RM thousand). Agriculture and infrastructure losses are published by state only, "
                         "so district figures do not add up to the state's or the national total.")}}}


# --------------------------------------------------------------------------------------------- build hook
def write_layers(write, source_dir, grid, xy, owners, states, county, counties, places, new_districts):
    """Build and write infrastructure.json, wonders.json and disasters.json; returns the names written."""
    where = Places(grid, xy, owners, states, county, counties, places)
    write("infrastructure", infrastructure_doc(source_dir, grid, xy, owners, where))
    write("wonders", wonders_doc(source_dir, where))
    write("disasters", disasters_doc(source_dir, states, counties, new_districts))
