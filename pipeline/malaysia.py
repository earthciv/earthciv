"""Build the Malaysia edition (web/data/my/) from public data.

Walking skeleton (PLAN.md, M1): the hex world (states, districts, relief, water, land cover, rivers) and population
figures for the nation, the states and federal territories, and the larger districts as cities. Economic fields
the later milestones fill are present and null ("no data"), never zero.

    uv run --group build python -m pipeline.malaysia [--radius KM] [--force]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from datetime import UTC, datetime

import numpy as np
import shapely
from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

from .build.world import (
    COAST,
    COAST_DEPTH_M,
    COVER,
    HILLS,
    LAKE,
    LAND,
    MOUNTAINS,
    OCEAN,
    RELIEF_TABLE,
    WATER_TABLE,
    classify_relief,
    clip_polyline,
    is_valley_floor,
)
from .core.fetch import download, manifest_path, read_manifest
from .core.hexgrid import HexGrid
from .core.paths import RAW, WEB
from .core.store import atomic_write_text

SOURCE_ID = "malaysia"
SOURCE_DIR = RAW / SOURCE_ID
OUT = WEB / "data" / "my"
RADIUS = 6  # km; see PLAN.md (Malaysia is ~4% of the lower 48's area, so 25 km hexes would leave ~500 land hexes)
MARGIN = 120  # km of sea or neighbouring land around the outermost district
BBOX = (98.2, -0.6, 120.7, 8.8)  # lon/lat window for relief and land cover: the whole hex grid, margin included
# Lambert azimuthal equal-area centred between the peninsula and Borneo.
TO_MAP = Transformer.from_crs(4326, "+proj=laea +lat_0=4 +lon_0=109.5 +datum=WGS84 +units=m", always_xy=True)
FROM_MAP = Transformer.from_crs("+proj=laea +lat_0=4 +lon_0=109.5 +datum=WGS84 +units=m", 4326, always_xy=True)
BOUNDARY_COMMIT = "a2378455ff907560c4f0f99fbfea4e6cd09fc658"  # last change to the district file (2023-06-24)
EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson"
DOSM = "Department of Statistics Malaysia (DOSM)"
GROWTH_START = 2021  # the U.S. and Canadian growth window starts in 2021
CITY_FLOOR = 150_000  # districts with at least this many residents get a banner (skeleton rule; M1 refines cities)
NEIGHBOURS = ("THA", "SGP", "BRN", "IDN", "PHL")

# DOSM state codes (1..16) are the ISO 3166-2:MY numbers. Abbreviations are the common three-letter forms.
STATES = {
    1: ("JHR", "Johor"), 2: ("KDH", "Kedah"), 3: ("KTN", "Kelantan"), 4: ("MLK", "Melaka"),
    5: ("NSN", "Negeri Sembilan"), 6: ("PHG", "Pahang"), 7: ("PNG", "Pulau Pinang"), 8: ("PRK", "Perak"),
    9: ("PLS", "Perlis"), 10: ("SGR", "Selangor"), 11: ("TRG", "Terengganu"), 12: ("SBH", "Sabah"),
    13: ("SWK", "Sarawak"), 14: ("KUL", "W.P. Kuala Lumpur"), 15: ("LBN", "W.P. Labuan"), 16: ("PJY", "W.P. Putrajaya"),
}
# Districts created after the boundary file (they appear in DOSM population tables from 2025), folded back into the
# district(s) they were carved from. Parents and shares come from the 2024 -> 2025 drop in each parent's population
# (PLAN.md, "New-district crosswalk"); Membakut took land from both Beaufort and Papar.
NEW_DISTRICTS = {
    ("Sabah", "Membakut"): {("Sabah", "Beaufort"): 20.8, ("Sabah", "Papar"): 33.7},
    ("Sarawak", "Gedong"): {("Sarawak", "Simunjan"): 1},
    ("Sarawak", "Sebuyau"): {("Sarawak", "Simunjan"): 1},
    ("Sarawak", "Lingga"): {("Sarawak", "Sri Aman"): 1},
    ("Sarawak", "Pantu"): {("Sarawak", "Sri Aman"): 1},
    ("Sarawak", "Siburan"): {("Sarawak", "Serian"): 1},
}
INPUTS = {}


def source(key, title, publisher, homepage, license, vintage, used_for, description, files):
    INPUTS[key] = ({"id": key, "title": title, "publisher": publisher, "homepage": homepage, "license": license,
                        "description": description, "used_for": used_for, "vintage": vintage}, files)


source("dosm_districts", "Administrative district boundaries", f"{DOSM}, via data.gov.my",
       "https://github.com/data-gov-my/datagovmy-front", "MIT", "2023 (160 districts)",
       ["State and district of every hex"],
       "The 160 administrative districts of the 13 states and 3 federal territories as drawn on data.gov.my.", {
           "district_map.ts": "https://raw.githubusercontent.com/data-gov-my/datagovmy-front/"
                              f"{BOUNDARY_COMMIT}/packages/datagovmy-ui/src/lib/geojson/district/_map.ts"})
source("dosm_population", "Population Table: Administrative Districts", DOSM,
       "https://data.gov.my/data-catalogue/population_district", "CC BY 4.0", "Latest year in the table",
       ["Population and growth of Malaysia, its states, federal territories, districts and cities"],
       "Mid-year population by district: the adjusted 2020 Census count, then intercensal estimates (cohort-component "
       "method). Districts created since 2025 are folded back into the districts they were carved from.", {
           "population_district.csv": "https://storage.dosm.gov.my/population/population_district.csv"})
source("etopo", "ETOPO1 Global Relief Model", "NOAA National Centers for Environmental Information (via ERDDAP)",
       "https://www.ncei.noaa.gov/products/etopo-global-relief-model", "Public domain", "ETOPO1, 1 arc-minute",
       ["Elevation, relief and water depth"], "Elevations and depths from ETOPO1 at every arc-minute.", {
           "relief.csv": "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv?altitude"
                         f"%5B({BBOX[1]}):1:({BBOX[3]})%5D%5B({BBOX[0]}):1:({BBOX[2]})%5D"})
source("esri_cover", "Sentinel-2 10m Land Use/Land Cover", "Impact Observatory, Microsoft and Esri",
       "https://livingatlas.arcgis.com/landcover/", "CC BY 4.0", "Latest annual map",
       ["Terrain colours and symbols", "Forest, farmland and built-up shares"],
       "The annual 10 m land-cover map, exported as one ~550 m image and grouped into the renderer's terrain classes. "
       "Oil palm and rubber estates are classed as trees by this map.", {
           "landcover.png": "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/"
                            f"exportImage?bbox={','.join(map(str, BBOX))}&bboxSR=4326&imageSR=4326&size=4000,1671"
                            "&format=png&f=image"})
source("natural_earth", "Natural Earth v5.1.2", "Natural Earth", "https://www.naturalearthdata.com/", "Public domain",
       "v5.1.2", ["Neighbouring land, lakes and rivers", "City banner positions"],
       "Neighbouring countries, lakes, rivers and settlement locations.", {
           f"{layer}.json": f"{EARTH}/ne_10m_{layer}.geojson"
           for layer in ("admin_0_countries", "lakes", "rivers_lake_centerlines", "populated_places")})

# Esri land-cover colours (from the service's legend) -> world.json cover ids. 12 marks water, 0 no data.
PALETTE = {
    (26, 91, 171): 12, (53, 130, 33): 2, (135, 209, 158): 8, (255, 219, 92): 7, (237, 2, 42): 9,
    (237, 233, 228): 10, (242, 250, 255): 11, (239, 207, 168): 5,
}


def ts_geojson(path):
    """The GeoJSON object literal inside data.gov.my's `export default {...};` TypeScript module."""
    text = path.read_text(encoding="utf8")
    body = text[text.index("{"):text.rindex("}") + 1]
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*):", r'\1"\2":', body)
    return json.loads(re.sub(r",(\s*[\]}])", r"\1", body))


def features(name):
    return json.loads((SOURCE_DIR / f"{name}.json").read_text(encoding="utf8"))["features"]


def write(name, data):
    atomic_write_text(OUT / f"{name}.json", json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


def classify_points(geometries, xs, ys):
    result = np.full(len(xs), -1)
    point, geom = shapely.STRtree(geometries).query(shapely.points(xs, ys), predicate="intersects")
    result[point[::-1]] = geom[::-1]
    return result


def plurality(values):
    return Counter(values).most_common(1)[0][0]


class MapProjection:
    """lon/lat -> map km (origin top-left, y down), as the other editions."""

    def __init__(self, west, north):
        self.west, self.north = west, north

    def __call__(self, lon, lat):
        x, y = TO_MAP.transform(lon, lat)
        return (np.asarray(x) - self.west) / 1000, (self.north - np.asarray(y)) / 1000

    def unshift(self, x, y):
        return self.west + np.asarray(x) * 1000, self.north - np.asarray(y) * 1000


def project(geometry):
    return shapely.transform(geometry, lambda c: np.column_stack(TO_MAP.transform(c[:, 0], c[:, 1])))


def sample_cover(lon, lat):
    with Image.open(SOURCE_DIR / "landcover.png") as image:
        pixels = np.asarray(image.convert("RGB"))
    encoded = np.zeros(pixels.shape[:2], dtype=np.int8)
    for rgb, cover in PALETTE.items():
        encoded[(pixels == rgb).all(axis=2)] = cover
    west, south, east, north = BBOX
    cols = np.floor((lon - west) * encoded.shape[1] / (east - west)).astype(int)
    rows = np.floor((north - lat) * encoded.shape[0] / (north - south)).astype(int)
    valid = (cols >= 0) & (cols < encoded.shape[1]) & (rows >= 0) & (rows < encoded.shape[0])
    samples = np.zeros(len(lon), dtype=np.int8)
    samples[valid] = encoded[rows[valid], cols[valid]]
    return samples


def sample_elevation(grid, xy):
    rows = np.loadtxt(SOURCE_DIR / "relief.csv", delimiter=",", skiprows=2)
    xs, ys = xy(rows[:, 1], rows[:, 0])
    samples = defaultdict(list)
    for x, y, alt in zip(xs, ys, rows[:, 2]):
        cell = grid.cell_at(x, y)
        if cell >= 0 and math.isfinite(alt):
            samples[cell].append(int(alt))
    return samples


def population():
    """{(state, district): {year: people}} on the 160 boundary districts, and the list of years."""
    raw = defaultdict(dict)
    with (SOURCE_DIR / "population_district.csv").open(encoding="utf8") as f:
        for r in csv.DictReader(f):
            if r["sex"] == "both" and r["age"] == "overall" and r["ethnicity"] == "overall":
                raw[(r["state"], r["district"])][int(r["date"][:4])] = float(r["population"]) * 1000
    pop = defaultdict(lambda: defaultdict(float))
    for key, series in raw.items():
        parents = NEW_DISTRICTS.get(key, {key: 1})
        total = sum(parents.values())
        for parent, weight in parents.items():
            for year, people in series.items():
                pop[parent][year] += people * weight / total
    years = sorted({y for s in pop.values() for y in s})
    return {k: {y: round(v[y]) for y in years if y in v} for k, v in pop.items()}, years


def figures(series, year):
    """The economic shape every area shares (DATA_CONTRACTS.md); only population and growth are known so far."""
    people = series.get(year)
    start = series.get(GROWTH_START)
    return {"population": people, "growth": round(people / start - 1, 4) if people and start else None,
            "growth_years": [GROWTH_START, year], "employed": None, "jobs": None, "median_income": None,
            "median_rent": None, "home_value": None, "unemployment": None, "unemployment_year": None,
            "rent_burden": None, "gdp": None, "gdp_year": None, "gdp_population": None,
            "yields": {k: None for k in ("food", "production", "gold", "science", "culture")}}


def build(radius):
    districts = ts_geojson(SOURCE_DIR / "district_map.ts")["features"]
    props = [f["properties"] for f in districts]
    shapes = [project(shape(f["geometry"]).buffer(0)) for f in districts]
    state_codes = sorted({p["code_state"] for p in props})
    state_shapes = [unary_union([s for s, p in zip(shapes, props) if p["code_state"] == c]) for c in state_codes]
    west, south, east, north = np.asarray(shapely.total_bounds(shapes)) / 1000
    xy = MapProjection((west - MARGIN) * 1000, (north + MARGIN) * 1000)
    width, height = east - west + 2 * MARGIN, north - south + 2 * MARGIN
    grid = HexGrid.covering(width, height, radius)
    cx, cy = np.asarray([grid.center(*grid.col_row(i)) for i in range(grid.size)]).T
    bearings = np.radians(np.arange(6) * 60 - 30)
    dx = np.r_[0, np.cos(bearings) * radius * 0.6]
    dy = np.r_[0, np.sin(bearings) * radius * 0.6]
    xs, ys = xy.unshift((cx[:, None] + dx).ravel(), (cy[:, None] + dy).ravel())
    lon, lat = FROM_MAP.transform(xs, ys)

    print(f"Sampling {grid.size} hexes at {radius} km…", flush=True)
    sampled_states = classify_points(state_shapes, xs, ys)
    sampled_districts = classify_points(shapes, xs, ys)
    neighbours = [project(shape(f["geometry"])) for f in features("admin_0_countries")
                  if f["properties"]["ADM0_A3"] in NEIGHBOURS]
    window = shapely.box(*BBOX)
    lakes = [project(shape(f["geometry"])) for f in features("lakes") if shape(f["geometry"]).intersects(window)]
    foreign = classify_points(neighbours, xs, ys) >= 0
    lake = classify_points(lakes, xs, ys) >= 0 if lakes else np.zeros(len(xs), bool)
    cover_samples = sample_cover(np.asarray(lon), np.asarray(lat))
    kinds = np.where(sampled_states >= 0, sampled_states, np.where(foreign, -2, -1))
    kinds[lake | ((cover_samples == 12) & (sampled_states >= 0))] = -3
    elevation = sample_elevation(grid, xy)
    metrics = defaultdict(list)
    owners, county = [], []
    pct = {k: [] for k in ("forest", "crop", "pasture", "grass", "shrub", "wetland", "developed")}
    district_state = [state_codes.index(p["code_state"]) for p in props]
    for i, points in enumerate(kinds.reshape(-1, 7)):
        votes = Counter(points.tolist())
        land = sum(n for k, n in votes.items() if k >= 0 or k == -2)
        owner = plurality([k for k in points if k >= 0 or k == -2]) if land >= 4 or points[0] >= 0 else -1
        owners.append(int(owner))
        dd = sampled_districts[i * 7:i * 7 + 7]
        valid = [int(j) for j in dd if j >= 0 and owner >= 0 and district_state[j] == owner]
        county.append(plurality(valid) if valid else -1)
        samples = elevation[i]
        if owner != -1:
            values = [v for v in samples if v >= -100]
            height_m = statistics.mean(values) if values else 0
            relief = classify_relief(max(height_m, 0), statistics.pstdev(values) if values else 0)
            if relief in (HILLS, MOUNTAINS) and is_valley_floor(values):
                relief -= 1
            metrics["elev"].append(round(height_m))
            metrics["elev_max"].append(max(0, max(values, default=0)))
            metrics["relief"].append(relief)
            metrics["water"].append(LAND)
        else:
            mean = statistics.mean(samples) if samples else None
            lakeish = votes[-3] > 0 and ((mean is not None and mean > 0) or votes[-3] > votes[-1]
                                         or (votes[-3] == votes[-1] and points[0] == -3))
            below = [v for v in samples if v < 0]
            metrics["elev"].append(-4000 if mean is None else round(statistics.mean(below)) if below and not lakeish
                                   else min(round(mean), 0))
            metrics["elev_max"].append(0)
            metrics["relief"].append(0)
            metrics["water"].append(LAKE if lakeish else OCEAN)
        sampled = cover_samples[i * 7:i * 7 + 7]
        cover = [int(v) for v in sampled if 0 < v < 12] if owner >= 0 else []
        group = Counter(cover)
        metrics["cover"].append(plurality(cover) if cover else 0)
        for key, amount in zip(pct, [group[2], group[7], 0, group[5], group[4], group[8], group[9]]):
            pct[key].append(round(100 * amount / len(cover)) if cover else 0)
    water = metrics["water"]
    for i in range(grid.size):
        if water[i] == OCEAN:
            near_land = any(water[j] == LAND for j in grid.neighbours(i))
            water[i] = COAST if near_land or metrics["elev"][i] > COAST_DEPTH_M else OCEAN

    rivers = []
    for f in features("rivers_lake_centerlines"):
        geom = f["geometry"]
        parts = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        for line in parts:
            if not any(BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] for x, y, *_ in line):
                continue
            px, py = xy(*zip(*(p[:2] for p in line)))
            for piece in clip_polyline(list(zip(px.tolist(), py.tolist())), width, height):
                rivers.append({"name": f["properties"].get("name"), "rank": f["properties"]["scalerank"],
                                   "pts": [round(v, 1) for point in piece for v in point]})

    pop, years = population()
    year = years[-1]
    states = [{"abbr": STATES[c][0], "name": STATES[c][1], "code": f"MY-{c:02d}"} for c in state_codes]
    counties = [{"geoid": f"{p['code_state']:02d}{p['code_district']:02d}", "name": p["district"], "state": p["state"]}
                for p in props]
    missing = [(p["state"], p["district"]) for p in props if (p["state"], p["district"]) not in pop]
    if missing:
        raise ValueError(f"no population for boundary districts {missing}")
    extra = sorted(set(pop) - {(p["state"], p["district"]) for p in props})
    if extra:
        raise ValueError(f"population rows with no boundary district: {extra}")
    state_series = [defaultdict(int) for _ in state_codes]
    for p in props:
        for y, v in pop[(p["state"], p["district"])].items():
            state_series[state_codes.index(p["code_state"])][y] += v
    national = defaultdict(int)
    for s in state_series:
        for y, v in s.items():
            national[y] += v
    cells_of = defaultdict(list)
    for cell, o in enumerate(owners):
        if o >= 0:
            cells_of[o].append(cell)
    state_data = [{**s, **figures(state_series[i], year), "ranks": {}} for i, s in enumerate(states)]

    places = city_sites(props, shapes, pop, year, grid, xy, owners, county)
    cover_table = [{"id": 0, "key": "none", "name": "No cover sample"}] + [
        {"id": i, "key": key, "name": name if i != 2 else "Tropical forest", "color": color,
             "rule": "Dominant among Sentinel-2 land-cover samples."}
        for i, key, name, color, _, _ in COVER if i not in (1, 3, 6)
    ]
    water_table = [dict(t, rule=rule) for t, rule in zip(WATER_TABLE, (
        "District boundaries or Natural Earth land sampled seven times per hex.",
        "Sea averaging more than 200 m deep and not beside land.",
        "Sea beside land, or averaging up to 200 m deep.",
        "Inland water from Natural Earth and the land-cover map; a lake hex's depth is shown as 0 m or below.",
    ))]
    write("world", dict(version=2, grid=grid.to_dict(), width=round(width, 1), height=round(height, 1), margin=MARGIN,
                        owner=owners, county=county, **metrics, pct=pct, states=states, counties=counties,
                        rivers=rivers, tables={"water": water_table, "relief": RELIEF_TABLE, "cover": cover_table}))
    write("states", state_data)
    write("cities", places)
    INPUTS["dosm_population"][0]["vintage"] = f"{year} (mid-year estimate)"
    write("nation", {
        "country": "Malaysia", "year": year, "vintage": f"DOSM {year} estimates",
        "population_vintage": f"DOSM mid-year population estimates, {year}",
        "nation": figures(national, year), "yields": YIELDS, "industries": {}})
    land = sum(len(v) for v in cells_of.values())
    empty = [states[o]["abbr"] for o in range(len(states)) if not cells_of[o]]
    print(f"Malaysia: {len(states)} states and FTs, {len(counties)} districts, {len(places)} cities, "
          f"{grid.size} hexes ({grid.cols}×{grid.rows}), {land} land hexes; regions without a hex: {empty or 'none'}")


YIELDS = [
    {"key": "food", "icon": "y-food", "emoji": "🌾", "label": "Food", "color": "#7fbf3f", "unit": "workers", "industries": [],
         "description": "Not yet built for Malaysia."},
    {"key": "production", "icon": "y-production", "emoji": "⚙️", "label": "Production", "color": "#d9823b", "unit": "workers",
         "industries": [], "description": "Not yet built for Malaysia."},
    {"key": "gold", "icon": "y-gold", "emoji": "💰", "label": "Gold", "color": "#f2c94c", "unit": "myr", "industries": [],
         "description": "Not yet built for Malaysia."},
    {"key": "science", "icon": "y-science", "emoji": "🔬", "label": "Science", "color": "#4fa3e0", "unit": "workers",
         "industries": [], "description": "Not yet built for Malaysia."},
    {"key": "culture", "icon": "y-culture", "emoji": "🎭", "label": "Culture", "color": "#b07ce0", "unit": "workers",
         "industries": [], "description": "Not yet built for Malaysia."},
]


def city_sites(props, shapes, pop, year, grid, xy, owners, county):
    """Skeleton cities: every district of CITY_FLOOR+ residents, named after its largest Natural Earth place."""
    places_ne = [(f["properties"], f["geometry"]["coordinates"]) for f in features("populated_places")
                 if f["properties"].get("ADM0_A3") == "MYS"]
    points = [project(shapely.Point(c)) for _, c in places_ne]
    out, taken = [], set()
    order = sorted(range(len(props)), key=lambda i: -pop[(props[i]["state"], props[i]["district"])][year])
    for i in order:
        p = props[i]
        series = pop[(p["state"], p["district"])]
        if series[year] < CITY_FLOOR:
            break
        inside = [(ne, pt) for (ne, _), pt in zip(places_ne, points) if shapes[i].covers(pt)]
        if inside:
            ne, pt = max(inside, key=lambda t: t[0].get("POP_MAX") or 0)
            name, (x, y) = ne["NAME"], xy(*FROM_MAP.transform(pt.x, pt.y))
        else:
            c = shapes[i].representative_point()
            name, (x, y) = p["district"], xy(*FROM_MAP.transform(c.x, c.y))
        x, y = float(x), float(y)
        cell = grid.cell_at(x, y)
        if cell < 0 or owners[cell] < 0 or cell in taken:
            mine = [c for c in range(grid.size) if county[c] == i and c not in taken]
            cell = min(mine, key=lambda c: math.dist(grid.center(*grid.col_row(c)), (x, y))) if mine else cell
        taken.add(cell)
        out.append(dict(id=f"my-{p['code_state']:02d}{p['code_district']:02d}", name=name,
                        full=f"{p['district']} district, {p['state']}", states=[STATES[p["code_state"]][0]],
                        metro=series[year] >= 500_000, capital=p["state"] == "W.P. Kuala Lumpur",
                        x=round(x, 1), y=round(y, 1), cell=int(cell),
                        footprint=sorted(c for c in range(grid.size) if county[c] == i) or [int(cell)],
                        **figures(series, year)))
    return out


def download_inputs(force):
    for _, files in INPUTS.values():
        for name, url in files.items():
            download(SOURCE_ID, url, name, force=force, timeout=600,
                     expect_binary=name.endswith((".png", ".json", ".csv", ".ts")))


def record_provenance():
    """The Almanac catalog (sources.json) from the download log, as pipeline/canada.py does."""
    catalog, manifest, changed = [], read_manifest(SOURCE_ID), False
    for info, files in INPUTS.values():
        provenance = []
        for name, url in files.items():
            entry = manifest.get(name)
            if not entry or entry.get("url") != url:
                path = SOURCE_DIR / name
                entry = manifest[name] = {
                    "url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size,
                    "retrieved": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(timespec="seconds")}
                changed = True
            provenance.append({"file": name, "url": entry["url"], "retrieved": entry["retrieved"], "sha256": entry["sha256"],
                                   "bytes": entry["bytes"]})
        catalog.append(dict(info, files=provenance))
    if changed:
        atomic_write_text(manifest_path(SOURCE_ID), json.dumps(manifest, indent=2, sort_keys=True))
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Refresh the cached publisher files")
    parser.add_argument("--radius", type=float, default=RADIUS, help="Hex radius in km")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    download_inputs(args.force)
    build(args.radius)
    write("sources", record_provenance())


if __name__ == "__main__":
    main()
