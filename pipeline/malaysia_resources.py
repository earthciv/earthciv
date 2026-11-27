"""Resources and land for the Malaysia edition: resources.json, and the `energy`, `land` and `forest_reserve` fields of
states.json. Called from pipeline/malaysia.py (`register_inputs` once, `resources_doc` and `state_fields` from build()).

Contracts: docs/DATA_CONTRACTS.md (resources.json, states.json `land` / `energy`); the worked example is
pipeline/canada.py `resource_sites`. Every site here comes from a file that carries its own position:

* power plants: WRI Global Power Plant Database v1.3.0 (same pinned file as Canada's), 25 MW and up;
* oil, gas and LNG sites: Wikidata items for Malaysia with coordinates (a cached SPARQL result);
* district crops: planted area by district (`crops_district_area`, DOSM with MAFS and the Department of Agriculture),
  one site per district.

Where a dataset has no positions (mines: state totals only; paddy and oil palm: state totals only; forest reserves:
state totals only) nothing is placed: docs/MALAYSIA.md says so, and so does the text pack.
"""

from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from urllib.parse import quote

import numpy as np

# Offshore fields are shown on the nearest coast hex of the nearest state, within this reach (Tapis lies ~175 km off
# Terengganu). Canada does the same in rings (OFFSHORE_RINGS); here it is a distance because the hexes are 6 km.
OFFSHORE_REACH_KM = 250
SHORE_KM = 18  # a site farther than this from every land hex is "offshore" and says so in its detail
MIN_PLANT_MW = 25  # as Canada's resources.json

WRI_URL = ("https://raw.githubusercontent.com/wri/global-power-plant-database/"
           "7a91cfbb2a4e272597acbc00506d61fc1ec73b3d/output_database/global_power_plant_database.csv")
CROPS_AREA_URL = "https://storage.data.gov.my/agriculture/crops_district_area.csv"
FOREST_RESERVE_URL = "https://storage.data.gov.my/environment/forest_reserve_state.csv"

# Wikidata: Malaysian items with coordinates whose class is an oil or gas field or an LNG terminal.
SPARQL = """SELECT DISTINCT ?f ?fLabel ?c ?tLabel WHERE {
 ?f wdt:P17 wd:Q833 ; wdt:P625 ?c ; wdt:P31 ?t .
 ?t rdfs:label ?tl . FILTER(LANG(?tl)="en" && REGEX(?tl,"oil field|oilfield|gas field|liquefaction terminal|regasification terminal","i"))
 SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }"""
WIKIDATA_URL = "https://query.wikidata.org/sparql?format=json&query=" + quote(SPARQL)
# Wikidata items that are not Malaysian operations in Malaysian waters (the file's own P17 says Malaysia).
WIKIDATA_SKIP = {
    "Ambalat",  # a maritime area claimed by Indonesia and Malaysia: not shown as either's field
    "Kilang Abok Berhad",  # a company's label (kilang = mill or refinery) typed as an oil field, at an onshore point
}
WIKIDATA_FILE = "wikidata_energy_sites.json"

FUELS = {  # WRI primary_fuel -> (type id, name, colour, icon, emoji)
    "Hydro": ("hydro", "Hydro power plant", "#3fa7d6", "r-hydro", "💧"),
    "Coal": ("coal_plant", "Coal power plant", "#92999d", "r-coal_plant", "🏭"),
    "Gas": ("gas_plant", "Gas power plant", "#e29e57", "r-gas_plant", "⚡"),
    "Oil": ("oil_plant", "Oil power plant", "#b58467", "r-gas_plant", "🛢️"),
    "Solar": ("solar", "Solar power plant", "#e1a64f", "r-solar", "☀️"),
    "Biomass": ("biomass", "Biomass power plant", "#8fab63", "r-gas_plant", "🌿"),
    "Wind": ("wind", "Wind power plant", "#72c5b2", "r-wind", "🌬️"),
}
PLANT_NOTE = ("Capacity of at least 25 MW as listed in WRI's Global Power Plant Database v1.3.0, which records no capacity year "
              "for Malaysian plants. Plants built or closed since are not reflected, and the database omits some large Sarawak hydro stations (Bakun, Murum).")

# Fields and sites from Wikidata: (type id, name, colour, icon, emoji, description)
SITE_TYPES = {
    "oil": ("Oil field", "#a8856a", "r-oil", "🛢️"),
    "gas": ("Gas field", "#b8a09c", "r-gas", "🔥"),
    "lng": ("LNG terminal", "#7fa7c9", "r-gas", "🚢"),
}
SITE_NOTE = ("Named sites that Wikidata places in Malaysia with coordinates. This is not an inventory of Malaysia's "
             "fields: most producing fields (Petronas and partners) have no open coordinates. A field at sea is shown "
             "on the nearest coast hex.")

# District crops: species -> (type id, name, colour, emoji, minimum planted ha for a district to carry a site)
CROPS = {
    "durian": ("durian", "Durian orchards", "#b8c04a", "🌳", 1000),
    "coconut": ("coconut", "Coconut groves", "#7bb26a", "🥥", 1500),
    "pineapple": ("pineapple", "Pineapple farms", "#e6b73e", "🍍", 800),
    "sago": ("sago", "Sago palms", "#c9b27a", "🌴", 1500),
}
CROP_NOTE = ("Planted area of the crop in the district in {year} (DOSM, with MAFS and the Department of "
             "Agriculture), in hectares; districts with at least {floor:,} ha. Oil palm, rubber and paddy are not in the "
             "district table: see the text pack.")


def register_inputs(source):
    """Add this module's raw files to pipeline/malaysia.py's INPUTS (called once at import)."""
    source("wri_plants", "Global Power Plant Database", "World Resources Institute",
           "https://datasets.wri.org/datasets/global-power-plant-database", "CC BY 4.0",
           "Database v1.3.0; WRI records no capacity year for Malaysian plants", ["Power plants"],
           "Malaysian generating stations of 25 MW or more as WRI listed them (v1.3.0, which records no capacity year for them; "
           "solar from Wiki-Solar). Plants built or closed since are not reflected, and some large Sarawak hydro "
           "stations are missing.", {"wri_plants.csv": WRI_URL})
    source("wikidata_energy", "Wikidata: oil fields, gas fields and LNG terminals in Malaysia", "Wikidata contributors",
           "https://www.wikidata.org/", "CC0", "Query result at build time", ["Oil, gas and LNG sites"],
           "Items with coordinates whose class is an oil field, gas field or LNG terminal and whose country is Malaysia.",
           {WIKIDATA_FILE: WIKIDATA_URL})
    source("dosm_crops", "Crops by district", "DOSM, with the Ministry of Agriculture and Food Security (MAFS) and the "
           "Department of Agriculture (DOA), via data.gov.my",
           "https://data.gov.my/data-catalogue/crops_district_area", "CC BY 4.0", "2024", ["Crop resources"],
           "Planted area (ha) of fruit, vegetable, spice, herb, cash and industrial crops by district (annual, 2017–2024). "
           "It has no oil palm, rubber or paddy.", {"crops_district_area.csv": CROPS_AREA_URL})
    source("dosm_forest_reserve", "Permanent reserved forest by state", "DOSM, from the Forestry Department (Perhutanan), via data.gov.my",
           "https://data.gov.my/data-catalogue/forest_reserve_state", "CC BY 4.0", "2024", ["Forest reserve area of states"],
           "Area (ha) of gazetted permanent reserved forest by state, annual.", {"forest_reserve_state.csv": FOREST_RESERVE_URL})


class Land:
    """Nearest land hex of a point, from the hexes' centres (km, map frame)."""

    def __init__(self, grid, owners, states):
        self.cells = np.array([i for i, o in enumerate(owners) if o >= 0])
        self.centres = np.array([grid.center(*grid.col_row(int(i))) for i in self.cells])
        self.grid, self.owners, self.states = grid, owners, states

    def nearest(self, x, y):
        d = np.hypot(self.centres[:, 0] - x, self.centres[:, 1] - y)
        k = int(d.argmin())
        return int(self.cells[k]), float(d[k])

    def place(self, x, y, name):
        """(cell, x, y, offshore) for a point; raises if it is out of reach of every land hex."""
        cell = self.grid.cell_at(x, y)
        if cell >= 0 and self.owners[cell] >= 0:
            return cell, round(x, 1), round(y, 1), False
        cell, dist = self.nearest(x, y)
        if dist > OFFSHORE_REACH_KM:
            raise ValueError(f"{name} lies {dist:.0f} km from the nearest land hex")
        return cell, *(round(v, 1) for v in self.grid.center(*self.grid.col_row(cell))), dist > SHORE_KM


def _read(path):
    return csv.DictReader(path.open(encoding="utf-8-sig"))


def plant_sites(source_dir):
    """WRI rows for Malaysia at or above MIN_PLANT_MW: (type, name, lon, lat, mw, detail)."""
    out = []
    for r in _read(source_dir / "wri_plants.csv"):
        mw = float(r["capacity_mw"] or 0)
        if r["country"] != "MYS" or mw < MIN_PLANT_MW:
            continue
        fuel = r["primary_fuel"]
        if fuel not in FUELS:
            raise ValueError(f"unknown fuel {fuel!r} for {r['name']}")
        owner = r["owner"] if r["owner"] and not r["owner"].startswith("Penisular") else ""  # WRI's mislabel
        year = f"{float(r['commissioning_year']):.0f}" if r["commissioning_year"] else ""
        out.append((FUELS[fuel][0], r["name"].strip(), float(r["longitude"]), float(r["latitude"]), mw,
                    " · ".join(filter(None, [fuel, owner, f"since {year}" if year else ""]))))
    return out


def wikidata_sites(source_dir):
    """Oil fields, gas fields and LNG terminals: (type, name, lon, lat, detail), deduplicated by name."""
    rows = json.loads((source_dir / WIKIDATA_FILE).read_text(encoding="utf8"))["results"]["bindings"]
    seen, out = set(), []
    for b in rows:
        name, kind = b["fLabel"]["value"], b["tLabel"]["value"].lower()
        if name in WIKIDATA_SKIP or re.fullmatch(r"Q\d+", name) or name in seen:
            continue  # no English label: nothing to show
        seen.add(name)
        lon, lat = map(float, re.findall(r"-?\d+\.?\d*", b["c"]["value"]))
        key = "lng" if "terminal" in kind else "gas" if "gas" in kind else "oil"
        out.append((key, name, lon, lat, kind.capitalize()))
    return out


def crop_district_area(source_dir):
    """{(state, district): {species: ha}} for the latest year in crops_district_area, and that year."""
    rows = list(_read(source_dir / "crops_district_area.csv"))
    year = max(r["date"][:4] for r in rows)
    area = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if r["date"][:4] == year and r["crop_species"] in CROPS:
            area[(r["state"], r["district"])][r["crop_species"]] += float(r["planted_area"] or 0)
    return area, int(year)


def forest_reserves(source_dir):
    """{state name: (ha, year)} of permanent reserved forest in the latest year."""
    rows = list(_read(source_dir / "forest_reserve_state.csv"))
    year = max(r["date"][:4] for r in rows)
    return {r["state"]: (float(r["area"]), int(year)) for r in rows if r["date"][:4] == year}


def summarize(items, types, note):
    """National and per-state {type: {count, value, unit}} over the mapped sites (the U.S. summary shape)."""
    def blank(t):
        return {"count": 0, "value": 0.0 if t["unit"] else None, "unit": t["unit"]}

    national = {key: blank(t) for key, t in types.items()}
    states = {}
    for it in items:
        t = types[it["type"]]
        for row in (national[it["type"]], states.setdefault(it["state"], {}).setdefault(it["type"], blank(t))):
            row["count"] += 1
            if row["value"] is not None and it["value"] is not None:
                row["value"] += it["value"]
    return {"note": note, "national": national, "states": dict(sorted(states.items()))}


def resources_doc(source_dir, grid, xy, owners, states, county, props, places):
    """resources.json. `states` are world.json's states (abbr), `county` the district index of each hex, `props` the
    boundary districts' properties, `places` the cities (for each site's `cbsa`)."""
    land = Land(grid, owners, states)
    types, items = {}, []
    offshore = []

    def add_type(key, name, colour, icon, emoji, description, source_id, category, unit=None):
        types.setdefault(key, {"id": key, "name": name, "category": category, "emoji": emoji, "icon": icon,
                               "color": colour, "unit": unit, "description": description, "source": source_id})

    def add(key, name, x, y, cell, value, detail, away=False):
        if away:
            detail = f"{detail}; offshore, shown on the nearest coast hex"
            offshore.append(name)
        items.append({"type": key, "name": name, "x": x, "y": y, "cell": cell, "value": value, "detail": detail,
                      "state": states[owners[cell]]["abbr"], "cbsa": None})

    for key, name, lon, lat, mw, detail in plant_sites(source_dir):
        fuel_key = next(k for k, v in FUELS.items() if v[0] == key)
        _, tname, colour, icon, emoji = FUELS[fuel_key]
        add_type(key, tname, colour, icon, emoji, PLANT_NOTE, "wri_plants", "energy", "MW")
        cell, x, y, away = land.place(*xy(lon, lat), name)
        add(key, name, x, y, cell, mw, detail, away)

    for key, name, lon, lat, detail in wikidata_sites(source_dir):
        tname, colour, icon, emoji = SITE_TYPES[key]
        add_type(key, tname, colour, icon, emoji, SITE_NOTE, "wikidata_energy", "energy")
        cell, x, y, away = land.place(*xy(lon, lat), name)
        add(key, name, x, y, cell, None, detail, away)

    area, year = crop_district_area(source_dir)
    district_cells = defaultdict(list)
    for cell, k in enumerate(county):
        if k >= 0 and owners[cell] >= 0:
            district_cells[k].append(cell)
    for k, p in enumerate(props):
        species = area.get((p["state"], p["district"]), {})
        cells = district_cells.get(k)
        if not cells:
            continue  # a district too small for its own hex (e.g. Putrajaya's neighbours)
        centre = np.array([sum(v) / len(cells) for v in zip(*(grid.center(*grid.col_row(c)) for c in cells))])
        cell = min(cells, key=lambda c: math.dist(grid.center(*grid.col_row(c)), centre))
        for crop, (key, name, colour, emoji, floor) in CROPS.items():
            if species.get(crop, 0) >= floor:
                add_type(key, name, colour, f"r-{key}", emoji, CROP_NOTE.format(year=year, floor=floor), "dosm_crops",
                         "agri", "ha")
                x, y = grid.center(*grid.col_row(cell))
                add(key, f"{p['district']} ({p['state']})", round(x, 1), round(y, 1), cell, round(species[crop]),
                    f"{crop.capitalize()}, {year}")

    owner_of = {}
    for c in places:  # biggest first
        for cell in c.get("footprint") or []:
            owner_of.setdefault(cell, c["id"])
    for it in items:
        it["cbsa"] = owner_of.get(it["cell"])

    rank = {"energy": 0, "agri": 1}  # legend order: energy types as met (plants, then fields), then crops
    ordered = dict(sorted(types.items(), key=lambda kv: rank[kv[1]["category"]]))
    print(f"    {len(items)} resource sites ({Counter(i['type'] for i in items)}); offshore: {offshore}")
    return {"types": list(ordered.values()), "items": items, "summary": summarize(
        items, ordered, "Power plants of 25 MW or more (WRI v1.3.0), named oil, gas and LNG sites (Wikidata) and district "
                        "crop areas (DOSM) as mapped; mines, oil palm, rubber and paddy have no positions in open data.")}


LAND_SHARES = ("forest", "crop", "pasture", "grass", "shrub", "wetland", "developed")


def state_fields(state_data, states, owners, pct, cover, resources, source_dir):
    """Add `energy`, `land` and `forest_reserve` to each state row (states.json), as the U.S. and Canadian builders."""
    capacity, sites = defaultdict(Counter), defaultdict(Counter)
    mw_types = [t["id"] for t in resources["types"] if t["unit"] == "MW"]
    for it in resources["items"]:
        if it["type"] in mw_types:
            capacity[it["state"]][it["type"]] += it["value"]
            sites[it["state"]][it["type"]] += 1
    reserves = forest_reserves(source_dir)
    cells = defaultdict(list)
    for cell, o in enumerate(owners):
        if o >= 0:
            cells[o].append(cell)
    for i, row in enumerate(state_data):
        by_type = {t: capacity[row["abbr"]][t] for t in mw_types}
        row["energy"] = {"unit": "MW", "total": sum(by_type.values()), "by_type": by_type,
                         "sites": {t: sites[row["abbr"]][t] for t in mw_types},
                         "note": "Only the mapped plants of 25 MW or more as WRI listed them, not the state's "
                                 "total generating capacity."}
        sampled = [c for c in cells[i] if cover[c]]
        row["land"] = ({k: None if k == "pasture" else round(sum(pct[k][c] for c in sampled) / len(sampled) / 100, 3)
                        for k in LAND_SHARES} if sampled else None)
        ha, year = reserves.get(states[i]["name"], (None, None))
        row["forest_reserve"] = {"ha": ha, "year": year, "source": "dosm_forest_reserve"} if ha is not None else None
