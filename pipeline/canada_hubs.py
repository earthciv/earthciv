"""Ports and airports for the Canadian edition's "Ports & airports" layer, the U.S. edition's USACE ports and FAA
airports counterparts.

Airports: passenger and cargo traffic by airport from Statistics Canada (tables 23-10-0253 and 23-10-0254, annual).
Boardings are "passengers enplaned" (FAA enplanements); hub classes follow the FAA's shares of national boardings (large
1%+, medium 0.25-1%, small 0.05-0.25%, nonhub below, from 10,000 boardings). Cargo is tonnes loaded and unloaded; an
airport with 10,000+ tonnes and fewer boardings is a cargo airport (the FAA's all-cargo table). Statistics Canada
suppresses some airports for confidentiality (Whitehorse, Iqaluit, Charlottetown, Kingston, Kitchener/Waterloo), so they
are missing. Each airport is placed by its ICAO code with OurAirports.

Ports: Canada Port Authorities by cargo tonnage, Transport Canada's table M17 (Transportation in Canada statistical
addendum), placed at Natural Earth's port points, or at the official place name of the town for the two it lacks.
"""

from __future__ import annotations

import csv
import html
import re
from html.parser import HTMLParser

from . import canada_census as census

PASSENGER_TABLE, CARGO_TABLE = "23100253", "23100254"
MIN_BOARDINGS = 10000  # the FAA's primary-airport threshold
MIN_CARGO_T = 10000
HUBS = {"L": "Large hub", "M": "Medium hub", "S": "Small hub", "N": "Nonhub airport"}
OURAIRPORTS = "ourairports-airports.csv"

# Statistics Canada's airport names (province in brackets where the name repeats) and their ICAO codes, checked by hand
# against OurAirports names and municipalities.
ICAO = {
    "Toronto/Lester B Pearson International": "CYYZ", "Vancouver International": "CYVR",
    "Montréal/Pierre Elliott Trudeau International": "CYUL", "Calgary International": "CYYC",
    "Edmonton International": "CYEG", "Ottawa/Macdonald-Cartier International": "CYOW",
    "Winnipeg/James Armstrong Richardson International": "CYWG", "Halifax/Robert L Stanfield International": "CYHZ",
    "Kelowna": "CYLW", "Victoria International": "CYYJ", "Québec/Jean Lesage International": "CYQB",
    "Saskatoon/John G Diefenbaker International": "CYXE", "St John's International": "CYYT",
    "Regina International": "CYQR", "Abbotsford": "CYXX", "Thunder Bay": "CYQT",
    "Moncton/Greater Moncton International": "CYQM", "Yellowknife": "CYZF", "Prince George": "CYXS", "Comox": "CYQQ",
    "Fredericton International": "CYFC", "Terrace": "CYXT", "Nanaimo": "CYCD", "Fort McMurray": "CYMM",
    "Hamilton": "CYHM", "London": "CYXU", "Kamloops": "CYKA", "Fort MacKay/Firebag": "CFG6", "Deer Lake": "CYDF",
    "Saint John": "CYSJ", "Timmins": "CYTS", "Rankin Inlet": "CYRT", "Sept-Îles": "CYZV", "Sudbury": "CYSB",
    "Sioux Lookout": "CYXL", "Windsor": "CYQG", "Gander International": "CYQX", "Sydney": "CYQY",
    "Montréal (St-Hubert)/Montréal Metropolitan": "CYHU", "Inuvik/Mike Zubko": "CYEV", "Îles-de-la-Madeleine": "CYGR",
    "Rouyn-Noranda": "CYUY", "Bagotville": "CYBG", "Val-d'Or": "CYVO", "Masset": "CZMT", "Mont-Joli": "CYYY",
    "Montréal/Mirabel International": "CYMX", "Goose Lake": "CGS2",
}

PORTS_FILE = "tc-m17-port-tonnage.html"
# Table M17's port names: the authority's name, its port type (the U.S. classes; the St. Lawrence ports take ocean
# ships, so they are coastal) and where it is placed: a Natural Earth port name, with its approximate latitude to tell
# namesakes apart (Natural Earth also has Vancouver, Washington), or ("geoname", file) for the two it lacks.
PORTS = {
    "Vancouver-Fraser": ("Vancouver Fraser Port Authority", "coastal", ("Vancouver", 49.3)),
    "Sept-Iles": ("Sept-Îles Port Authority", "coastal", ("Sept-Iles", 50.2)),
    "Montreal": ("Montréal Port Authority", "coastal", ("Montreal", 45.5)),
    "Saint John": ("Saint John Port Authority", "coastal", ("Saint-John", 45.3)),
    "Quebec": ("Québec Port Authority", "coastal", ("Quebec", 46.8)),
    "Prince Rupert": ("Prince Rupert Port Authority", "coastal", ("Prince Rupert", 54.3)),
    "Hamilton-Oshawa": ("Hamilton-Oshawa Port Authority", "great_lakes", ("Hamilton", 43.25)),
    "Thunder Bay": ("Thunder Bay Port Authority", "great_lakes", ("geoname", "geonames-thunder-bay.csv")),
    "Halifax": ("Halifax Port Authority", "coastal", ("Halifax", 44.65)),
    "Nanaimo": ("Nanaimo Port Authority", "coastal", ("Nanaimo", 49.17)),
    "Trois-Rivières": ("Trois-Rivières Port Authority", "coastal", ("Trois-Rivieres (Three Rivers)", 46.34)),
    "Windsor": ("Windsor Port Authority", "great_lakes", ("Windsor", 42.31)),
    "Toronto": ("Toronto Port Authority", "great_lakes", ("Toronto", 43.61)),
    "Belledune": ("Belledune Port Authority", "coastal", ("geoname", "geonames-belledune.csv")),
    "St. John's": ("St. John's Port Authority", "coastal", ("Saint-John's", 47.56)),
    "Saguenay": ("Saguenay Port Authority", "coastal", ("Chicoutimi", 48.43)),
    "Port Alberni": ("Port Alberni Port Authority", "coastal", ("Port Alberni", 49.23)),
}
GEONAME_PORTS = {"geonames-thunder-bay.csv": ("Thunder Bay", "CITY"), "geonames-belledune.csv": ("Belledune", "VILG")}


def hub_class(share):
    return "L" if share >= 0.01 else "M" if share >= 0.0025 else "S" if share >= 0.0005 else "N"


def _airports(meta):
    """{(airport name, province): member id} (the airport members sit under their province)."""
    members = meta["dimension"][0]["member"]
    provinces = {m["memberId"]: m["memberNameEn"] for m in members if m.get("parentMemberId") == members[0]["memberId"]}
    return {(m["memberNameEn"].removesuffix(f", {provinces[m['parentMemberId']]}"), provinces[m["parentMemberId"]]):
            m["memberId"] for m in members if m.get("parentMemberId") in provinces}


def traffic():
    """(year, [{"name", "province", "enplaned", "enplaned_prev", "cargo_t", "hub"}], national boardings): every airport
    with 10,000+ boardings or 10,000+ tonnes of cargo in the latest year, busiest first."""
    meta = census.metadata(PASSENGER_TABLE)
    enplaned = census.member(meta, 2, "Passengers enplaned")
    airports = _airports(meta)
    cell = lambda a: census.coordinate(a, enplaned)
    canada = meta["dimension"][0]["member"][0]["memberId"]
    values = census.history(PASSENGER_TABLE, [cell(a) for a in airports.values()] + [cell(canada)],
                            "passengers enplaned by airport", 2)
    year = max(int(y) for v in values.values() for y in v)
    y, py = str(year), str(year - 1)
    national = values.get(cell(canada), {}).get(y)
    meta_c = census.metadata(CARGO_TABLE)
    total_c = census.member(meta_c, 2, "Total, cargo loaded and unloaded")
    cargo_airports = _airports(meta_c)
    ccell = lambda a: census.coordinate(a, total_c)
    cargo = census.series(CARGO_TABLE, [ccell(a) for a in cargo_airports.values()], "cargo loaded and unloaded by airport",
                          period=True)
    out = []
    for key in sorted(set(airports) | set(cargo_airports)):
        v = values.get(cell(airports[key]), {}) if key in airports else {}
        c = cargo.get(ccell(cargo_airports[key])) if key in cargo_airports else None
        cargo_t = c[0] if c and c[0] is not None and c[1][:4] == y else None
        boardings = v.get(y)
        if (boardings or 0) >= MIN_BOARDINGS or (cargo_t or 0) >= MIN_CARGO_T:
            out.append(dict(name=key[0], province=key[1], enplaned=boardings, enplaned_prev=v.get(py), cargo_t=cargo_t,
                            hub=hub_class(boardings / national) if (boardings or 0) >= MIN_BOARDINGS else None))
    out.sort(key=lambda a: (-(a["enplaned"] or 0), -(a["cargo_t"] or 0)))
    return year, out, national


def airport_points(path):
    """{ICAO code: {"iata", "name", "municipality", "lon", "lat"}} for Canadian airports in OurAirports."""
    out = {}
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["iso_country"] == "CA" and row["type"] != "closed":
                out[row["ident"]] = dict(iata=row["iata_code"] or None, name=row["name"], municipality=row["municipality"],
                                         lon=float(row["longitude_deg"]), lat=float(row["latitude_deg"]))
    return out


class _Table(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(html.unescape(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data


def port_tonnage(path):
    """(year, preliminary, {M17 port name: tonnes}) from the latest year column of Transport Canada's table M17."""
    table = _Table()
    table.feed(path.read_text(encoding="utf-8"))
    header = next(r for r in table.rows if len(r) > 3 and r[1].isdigit())
    col = max((i for i, h in enumerate(header) if re.fullmatch(r"\d{4}P?", h)), key=lambda i: header[i][:4])
    year, preliminary = int(header[col][:4]), header[col].endswith("P")
    out = {}
    for r in table.rows:
        if len(r) == len(header) and r[0] and r[0] != "Total" and r is not header:
            name = re.sub(r"\d+$", "", r[0]).strip()  # "Hamilton-Oshawa1": a footnote mark
            out[name] = round(float(r[col]) * 1e6)
    if set(out) != set(PORTS):
        raise ValueError(f"table M17 ports changed: {sorted(set(out) ^ set(PORTS))}")
    return year, preliminary, out


def geoname_point(path, name, concise):
    """(lon, lat) of the official place name `name` of the given concise type in a geographical names CSV."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["name"] == name and row["concise.code"] == concise:
                return float(row["longitude"]), float(row["latitude"])
    raise ValueError(f"{name} ({concise}) is not in {path}")
