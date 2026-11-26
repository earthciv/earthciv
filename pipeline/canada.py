"""Build the Canadian edition. See docs/CANADA.md for the rebuild command.

The rules follow the U.S. builders wherever the data allows: sites on water snap to land (build/resources.py), every city
gets its own banner hex (build/cities.py), wonders and their footprints sit on land (build/wonders.py), water depth and
coast classes come from the U.S. world builder (build/world.py), and lens colour ranges use the same percentile rule
(build/lenses.py).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import statistics
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from urllib.parse import urlencode

import numpy as np
import shapely
from PIL import Image
from pyproj import Transformer
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from . import canada_census as census
from . import canada_city_view as city_view
from . import canada_disasters as disasters
from . import canada_hubs as hubs
from . import canada_military as military
from . import canada_trade as trade
from .build.cities import free_cell, nearest_land
from .build.growth import MAX_GROWTH
from .build.lenses import COUNTY_LENSES, DOMAIN_NOTE, GROUPS, LAND_LENSES, percentile_domain
from .build.world import (
    COAST, COAST_DEPTH_M, COVER, HILLS, LAKE, LAND, MOUNTAINS, OCEAN, RELIEF_TABLE, WATER_TABLE, classify_relief,
    clip_polyline, is_valley_floor,
)
from .core.fetch import download, manifest_path, read_manifest
from .core.hexgrid import HexGrid
from .core.paths import RAW, WEB
from .core.store import atomic_write_text

SOURCE_DIR = RAW / "canada"
OUT = WEB / "data" / "ca"
CENSUS = "2021 Census of Population"
CENSUS_YEAR = 2021
RADIUS = 25
MARGIN = 400
COVER_BBOX = (-3100000, -1000000, 3500000, 4000000)
# A site on water or across a border snaps to the nearest hex of its own province, up to this many rings away
# (the U.S. builders snap within 1 ring, and offshore wind within 3).
SNAP_RINGS = 3
OFFSHORE_RINGS = 12  # offshore oil fields (the Grand Banks lie about 350 km out) go to their province's nearest coast hex
# A named settlement this close to a census boundary counts as inside it: simplified shorelines clip waterfronts.
NEAR_M = 5000
PROVINCES = dict(zip(
    ("10", "11", "12", "13", "24", "35", "46", "47", "48", "59", "60", "61", "62"),
    ("NL", "PE", "NS", "NB", "QC", "ON", "MB", "SK", "AB", "BC", "YT", "NT", "NU"),
))
TO_MAP = Transformer.from_crs(4326, 3978, always_xy=True)
FROM_CENSUS = Transformer.from_crs(3347, 3978, always_xy=True)

BOUNDARY = "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer"
DIGITAL_PROVINCES = "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/0"
MINES = "https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/900A_and_top_100_en/MapServer"
EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson"
STATCAN = "Statistics Canada"
NRCAN = "Natural Resources Canada"
OGL = "Open Government Licence – Canada"
INPUTS = {}


ATTENDANCE, ATTENDANCE_YEAR = "attendance-2025_26.csv", "2025–26"
# Attendance-file names that the Canadian Geographical Names Database records under another name: the Klondike group
# (Parks Canada's Dawson City sites) by its Dawson Historical Complex entry, and two sites by their designated names.
GEONAME_ALIASES = {
    "Klondike National Historic Sites": "Dawson Historical Complex National Historic Site of Canada",
    "Fort Rodd Hill/Fisgard Lighthouse National Historic Sites": "Fort Rodd Hill National Historic Site of Canada",
    "Cape Spear Lighthouse National Historic Site": "Cape Spear National Historic Site of Canada",
}
CANAL = re.compile(r"\bCanal\b|\bWaterway\b")
# Institution names (table 37-10-0232) that the Open Database of Educational Facilities lists differently.
ODEF_ALIASES = {
    "University of Toronto": "University of Toronto (Admission And Awards)",  # 172 St. George Street, on the main campus
    "University of Ottawa-Université d'Ottawa": "University of Ottawa",
}
# Wikidata items for the universities ODEF cannot place: UBC is not listed; Memorial's row has no coordinates.
WIKIDATA_CAMPUSES = {"University of British Columbia": "Q391028", "Memorial University of Newfoundland": "Q1895354"}
UNIVERSITY_SHORT = {
    "University of Toronto": "U of T", "Université de Montréal": "UdeM", "University of British Columbia": "UBC",
    "McGill University": "McGill", "Université Laval": "Laval", "University of Alberta": "U of A",
    "University of Ottawa-Université d'Ottawa": "uOttawa", "Western University": "Western",
    "University of Waterloo": "Waterloo", "University of Calgary": "UCalgary", "York University": "York",
    "Université de Sherbrooke": "Sherbrooke", "McMaster University": "McMaster", "Queen's University": "Queen's",
    "Simon Fraser University": "SFU", "Carleton University": "Carleton", "University of Manitoba": "UManitoba",
    "Memorial University of Newfoundland": "Memorial", "University of Guelph": "Guelph",
    "University of Saskatchewan": "USask", "Université du Québec à Montréal": "UQAM", "Concordia University": "Concordia",
    "University of Victoria": "UVic", "Dalhousie University": "Dalhousie",
}
PER_CITY = {"research_university": 2, "landmark": 1}  # the U.S. rules' metro caps


def source(key, title, publisher, homepage, license, vintage, used_for, description, files):
    INPUTS[key] = (dict(id=key, title=title, publisher=publisher, homepage=homepage, license=license,
                        description=description, used_for=used_for, vintage=vintage), files)


source("statcan_boundaries", "2021 Census cartographic boundaries", STATCAN,
       "https://www150.statcan.gc.ca/n1/pub/92-160-g/92-160-g2021002-eng.htm", OGL, "2021 Census",
       ["Province, territory and census division of every hex", "City areas, and the population centre each banner marks"],
       "Provinces and territories, census divisions, census metropolitan areas and agglomerations, and population centres.",
       {f"{name}.json": f"{BOUNDARY}/{layer}/query?where=1%3D1&outFields={fields}&outSR=3347&maxAllowableOffset={offset}&f=json"
        for name, layer, fields, offset in (("pr", 0, "PRUID,PRNAME,DGUID", 5000),
            ("cd", 4, "CDUID,CDNAME,PRUID,DGUID", 5000), ("cma", 6, "*", 2500),
            ("pc", 7, "PCUID,PCPUID,PCNAME,PCCLASS,LANDAREA,PRUID", 200))})
source("statcan_province_digital", "2021 Census digital province and territory boundaries", STATCAN,
       DIGITAL_PROVINCES, OGL, "2021 Census", ["Province or territory of each power plant"],
       "Province and territory boundaries including water, used to locate power plants.", {
           "pr-digital.json": f"{DIGITAL_PROVINCES}/query?where=1%3D1&outFields=PRUID&outSR=3347&maxAllowableOffset=100&geometryPrecision=1&f=json"
       })
# The GDP vintages and descriptions name the latest year in each table; build() fills them in.
for key, table, title, vintage, used_for, description in [
    ("statcan_population", "98100005", "Population and dwelling counts for metropolitan areas", "2021 Census",
     ["Land area (for density) and official names of Canada, provinces, territories and cities"],
     "2021 Census land area and geographic names of Canada, the provinces and territories, CMAs and CAs."),
    ("statcan_divisions", "98100002", "Population and dwelling counts for census divisions", "2021 Census",
     ["Land area of census divisions (for density)"], "2021 Census land area of census divisions."),
    ("statcan_metro_gdp", "36100468", "Metropolitan GDP at basic prices", "Latest year in the table",
     ["Gold yield (GDP) of census metropolitan areas"], ""),
    ("statcan_gdp", "36100222", "GDP, expenditure-based", "Latest year in the table",
     ["Gold yield (GDP) of Canada, provinces and territories"], ""),
]:
    source(key, title, STATCAN, f"https://doi.org/10.25318/{table}01-eng", "Statistics Canada Open Licence", vintage,
           used_for, description, {f"{table}.zip": f"https://www150.statcan.gc.ca/n1/tbl/csv/{table}-eng.zip"})

source("statcan_gdp_industry", "GDP at basic prices, by industry, provinces and territories", STATCAN,
       "https://doi.org/10.25318/3610071101-eng", "Statistics Canada Open Licence", "Latest year in the table",
       ["GDP by industry for Canada, the provinces and the territories (Gold report, Economy advisor, worker reports)"],
       "", {f"{census.GDP_INDUSTRY_TABLE}{part}.json": None for part in ("-meta", "")})

CENSUS_HOME = "https://www12.statcan.gc.ca/census-recensement/index-eng.cfm"
# Files with no URL are Web Data Service replies, logged in the download manifest by pipeline/canada_census.py.
division_files, area_files, lfs_files, estimate_files = census.files()
source("statcan_census_divisions", "2021 Census tables for census divisions", STATCAN, CENSUS_HOME,
       "Statistics Canada Open Licence", "2021 Census (incomes for 2020)",
       ["Income, low income, median age, born abroad, degrees, commute, homeowners and faith lenses"],
       "Census division figures from tables 98-10-0057 (household income), 98-10-0103 (low income), 98-10-0022 (age), "
       "98-10-0348 (immigrant status), 98-10-0387 (education), 98-10-0259 (tenure) and 98-10-0354 (religion), and the "
       "average commute from 98-10-0458, requested through the Web Data Service.",
       {name: census.CSV_URL.format(name[:-4]) if name.endswith(".zip") else None
        for name in division_files + ["98100458-meta.json"]})
source("statcan_census_areas", "2021 Census tables for Canada, provinces, CMAs and CAs", STATCAN, CENSUS_HOME,
       "Statistics Canada Open Licence", "2021 Census (incomes for 2020)",
       ["Food, Production, Science and Culture yields (workers by industry)",
        "Employment, household income, rent and home value in panels and reports",
        "Unemployment of census agglomerations, which the Labour Force Survey does not publish (shown as 2021 figures)"],
       "Household income from table 98-10-0061, and workers by NAICS industry with labour force status (98-10-0448), "
       "renters' monthly shelter cost (98-10-0253) and owner-estimated dwelling value (98-10-0256), requested through "
       "the Web Data Service. The census week, in May 2021, fell during COVID-19 restrictions, which raised unemployment.",
       {name: census.CSV_URL.format(name[:-4]) if name.endswith(".zip") else None
        for name in area_files + ["98100448-meta.json", "98100253-meta.json", "98100256-meta.json"]})
source(city_view.SOURCE, "2021 Census tables for the City View", STATCAN, CENSUS_HOME,
       "Statistics Canada Open Licence", "2021 Census",
       ["City View districts and city types (industries concentrated among a city's workers)",
        "City View citizens: occupation, age, commute, education and generation status"],
       "Employed people by detailed NAICS 2017 industry (table 98-10-0448), by NOC 2021 occupation (98-10-0449), by "
       "main mode of commuting (98-10-0457) and those who worked at home (98-10-0455); population by age "
       "(98-10-0020) and by generation status (98-10-0324); and adults by highest certificate, diploma or degree "
       "(98-10-0384), for Canada, CMAs and CAs, requested through the Web Data Service. Workers are counted where "
       "they live. The census week, in May 2021, fell during COVID-19 restrictions.",
       {name: None for name in city_view.files()})
source("statcan_estimates", "Annual population estimates (2021 boundaries)", STATCAN,
       "https://doi.org/10.25318/1710015201-eng", "Statistics Canada Open Licence", "Latest July 1 estimates",
       ["Population and growth since 2021 of Canada, provinces, territories, cities and census divisions",
        "Population density and population change lenses"],
       "Annual July 1 population estimates on 2021 Census boundaries, from tables 17-10-0152 (Canada, provinces, "
       "territories and census divisions) and 17-10-0148 (CMAs and CAs), requested through the Web Data Service.",
       {name: None for name in estimate_files})
source("statcan_lfs", "Labour Force Survey, annual averages", STATCAN, "https://doi.org/10.25318/1410046401-eng",
       "Statistics Canada Open Licence", "Labour Force Survey, latest annual averages",
       ["Unemployment rate of Canada, provinces, territories and census metropolitan areas"],
       "Unemployment rate of people aged 15 and over, annual average, from tables 14-10-0464 (Canada, provinces and "
       "territories) and 14-10-0461 (census metropolitan areas), requested through the Web Data Service. The survey's "
       "national total covers the ten provinces; the territories are surveyed separately. Census agglomerations are not "
       "published, so they keep the 2021 Census rate.",
       {name: None for name in lfs_files})

source("etopo", "ETOPO1 global relief", "NOAA", "https://www.ncei.noaa.gov/products/etopo-global-relief-model",
       "Public domain", "ETOPO1, 1 arc-minute, sampled every 10 arc minutes", ["Elevation, relief and water depth"],
       "Elevations and depths from ETOPO1, sampled every 10 arc minutes.", {
           "relief.csv": "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv?altitude%5B(38):10:(85)%5D%5B(-169):10:(-48)%5D"
       })
source("nrcan_cover", "2020 Land Cover of Canada", NRCAN,
       "https://open.canada.ca/data/en/dataset/ee1580ab-a23d-4f86-a09b-79763677eb47", OGL, "2020",
       ["Terrain colours and symbols", "Forest, farmland and built-up lenses"],
       "The 2020 land-cover map, sampled from a 5 km WMS image and grouped into the renderer's terrain classes.", {
           "landcover.png": "https://datacube.services.geo.ca/ows/landcover?" + urlencode({
               "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": "landcover-2020",
               "STYLES": "", "CRS": "EPSG:3978", "BBOX": ",".join(map(str, COVER_BBOX)),
               "WIDTH": 1320, "HEIGHT": 1000, "FORMAT": "image/png", "TRANSPARENT": "TRUE",
           })
       })
source("natural_earth", "Natural Earth v5.1.2", "Natural Earth", "https://www.naturalearthdata.com/",
       "Public domain", "v5.1.2", ["Neighbouring land, lakes and rivers", "City banner positions", "Roads and railways",
                                   "Positions of 15 of the 17 Canada Port Authorities"],
       "Neighbouring land, major lakes and rivers, settlement locations, highways, rail lines and ports.", {
           f"{layer}.json": f"{EARTH}/ne_{scale}m_{layer}.geojson"
           for layer, scale in (("admin_0_countries", 50), ("lakes", 50), ("rivers_lake_centerlines", 50),
                                ("populated_places", 10), ("roads", 10), ("railroads", 10), ("ports", 10))
       })
source("nrcan_mines", "Principal Mineral Areas, Producing Mines, and Oil and Gas Fields (900A)", NRCAN,
       "https://open.canada.ca/data/en/dataset/000183ed-8864-42f0-ae43-c4313a860720", OGL,
       "Map 900A web service, as retrieved", ["Mines, oil sands operations, and oil and gas fields"],
       "Named metal and nonmetal mines, coal mines, oil sands operations, and oil and gas fields.", {
           f"mines-{layer}.json": f"{MINES}/{layer}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
           for layer in (3, 4, 5, 6, 13)
       })
source("wri_plants", "Global Power Plant Database", "World Resources Institute",
       "https://datasets.wri.org/datasets/global-power-plant-database", "CC BY 4.0",
       "Canadian plants as listed in 2016–17; database v1.3.0", ["Power plants"],
       "Canadian generating stations with at least 25 MW of capacity, as listed in 2016–17: WRI took them from Natural "
       "Resources Canada's August 2017 North American inventory (capacity years mostly 2016 and 2017). Plants built or "
       "closed since then are not reflected.", {
           "plants.csv": "https://raw.githubusercontent.com/wri/global-power-plant-database/7a91cfbb2a4e272597acbc00506d61fc1ec73b3d/output_database/global_power_plant_database.csv"
       })


source("parks_boundaries", "Places administered by Parks Canada", "Parks Canada",
       "https://open.canada.ca/data/en/dataset/e1f0c975-f40c-4313-9be2-beb951e35f4e", OGL, "As retrieved",
       ["Wonder markers and park footprints", "Locations of the marine parks among the wonders"],
       "Administrative footprints of national parks and national park reserves, and of national marine conservation "
       "areas and the historic canals Parks Canada maps as areas.", {
           "park-areas.json": "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/"
           "vw_Places_Public_lieux_public_APCA/FeatureServer/0/query?where=PLACE_TYPE_E%20IN%20"
           "(%27National%20Park%27,%27National%20Park%20Reserve%27)&outFields=BAID,DESC_EN,PLACE_TYPE_E"
           "&outSR=3978&geometryPrecision=-3&maxAllowableOffset=3000&returnCentroid=true&f=json",
           "place-areas.json": "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/"
           "vw_Places_Public_lieux_public_APCA/FeatureServer/0/query?where=PLACE_TYPE_E%20IN%20"
           "(%27National%20Historic%20Site%27,%27National%20Marine%20Conservation%20Area%27,"
           "%27National%20Marine%20Conservation%20Area%20Reserve%27)&outFields=BAID,DESC_EN,PLACE_TYPE_E"
           "&outSR=3978&geometryPrecision=-3&maxAllowableOffset=3000&returnCentroid=true&f=json",
       })
source("parks_attendance", "Parks Canada attendance 2025–26", "Parks Canada",
       "https://open.canada.ca/data/en/dataset/1e2bd6b2-d6c7-415b-8c95-f5f6b2459759", OGL, "Fiscal 2025–26",
       ["Wonder rankings: national parks, other park units (marine parks and historic canals) and landmarks (national "
        "historic sites)", "Park visits in the Culture advisor"],
       "Visits to each national park, marine park and national historic site in fiscal 2025–26 (April 2025 to March "
       "2026). Places Parks Canada could not report, or that were closed, have no count.", {
           ATTENDANCE: "https://open.canada.ca/data/dataset/1e2bd6b2-d6c7-415b-8c95-f5f6b2459759/resource/"
           "73609a87-77f6-4a69-bd96-b8e3f3451aa7/download/parks-canada-attendance-2025_26.csv"
       })
source("nrcan_geonames", "Canadian Geographical Names Database", NRCAN,
       "https://open.canada.ca/data/en/dataset/e27c6eba-3c5d-4051-9db2-082dc6411c2c", OGL, "As retrieved",
       ["Locations of the national historic sites (landmarks) and historic canals among the wonders",
        "Positions of the Thunder Bay and Belledune port authorities, which Natural Earth lacks"],
       "Official names and locations of national historic sites (generic code 538) and historic canals (4325), and "
       "of the city of Thunder Bay and the village of Belledune, from the geographical names web service.", {
           **{f"geonames-{code}.csv": f"https://geogratis.gc.ca/services/geoname/en/geonames.csv?generic={code}&num=1000"
              for code in (538, 4325)},
           **{file: f"https://geogratis.gc.ca/services/geoname/en/geonames.csv?q={name.replace(' ', '%20')}&concise={kind}"
              for file, (name, kind) in hubs.GEONAME_PORTS.items()},
       })
source("statcan_enrolment", "Postsecondary enrolments by institution", STATCAN,
       "https://doi.org/10.25318/3710023201-eng", "Statistics Canada Open Licence", "Latest academic year in the table",
       ["Research-university wonders (doctoral students and all students by institution)"],
       "Students in doctoral programs (ISCED 8) and all students, by institution, from the Postsecondary Student "
       "Information System (table 37-10-0232), requested through the Web Data Service.",
       {f"{census.ENROLMENT_TABLE}{part}.json": None for part in ("-meta", "")})
source("statcan_odef", "Open Database of Educational Facilities, version 2.1", STATCAN,
       "https://open.canada.ca/data/en/dataset/4dd64c98-b12a-49c7-be29-21c77d22b675", OGL, "Version 2.1 (2022)",
       ["Campus locations of the research universities among the wonders"],
       "Locations of educational facilities; universities are the rows of facility type University or Université. "
       "The database is archived (collected 2019 to 2022).", {
           "ODEF_v2.1.zip": "https://www150.statcan.gc.ca/n1/pub/37-26-0001/2022001/ODEF_v2.1.zip"
       })
source("wikidata_campuses", "Wikidata campus coordinates", "Wikidata", "https://www.wikidata.org/", "CC0 1.0",
       "As retrieved", ["Locations of the two research universities ODEF cannot place"],
       "The coordinate location (P625) of the University of British Columbia, which ODEF does not list, and of "
       "Memorial University of Newfoundland, whose ODEF row has no coordinates.", {
           f"wikidata-{item}.json": f"https://www.wikidata.org/w/api.php?action=wbgetclaims&entity={item}"
           "&property=P625&format=json" for item in WIKIDATA_CAMPUSES.values()
       })
source("statcan_airports", "Air passenger and cargo traffic at Canadian airports, annual", STATCAN,
       "https://doi.org/10.25318/2310025301-eng", "Statistics Canada Open Licence", "Latest year in the tables",
       ["Airports on the Ports & airports layer: boardings, the year before, hub class and cargo"],
       "Passengers enplaned by airport (table 23-10-0253) and cargo loaded and unloaded by airport in tonnes "
       "(23-10-0254), requested through the Web Data Service. Statistics Canada suppresses some airports for "
       "confidentiality (among them Whitehorse, Iqaluit, Charlottetown, Kingston and Kitchener/Waterloo).",
       {f"{table}{part}.json": None for table in (hubs.PASSENGER_TABLE, hubs.CARGO_TABLE) for part in ("-meta", "")})
source("ourairports", "OurAirports airport data", "OurAirports", "https://ourairports.com/data/", "Public domain",
       "As retrieved", ["Positions of the airports, by ICAO code"],
       "Airport identifiers, names, municipalities and coordinates (the nightly airports.csv).", {
           hubs.OURAIRPORTS: "https://davidmegginson.github.io/ourairports-data/airports.csv"
       })
source("statcan_freight", "Canadian Freight Analysis Framework: origin and destination of transported commodities",
       STATCAN, "https://doi.org/10.25318/2310014201-eng", "Statistics Canada Open Licence", "2017, the latest year",
       ["Trade routes on the map and in the Commerce advisor: freight between zones, partners and totals"],
       "Value of freight shipped between 25 domestic zones (12 CMAs, the rest of each province, and whole provinces and "
       "territories) and to and from the United States and Mexico and other countries, by mode (air, rail, for-hire "
       "truck) and commodity group (table 23-10-0142), and the weight and tonne-kilometres of the routes kept, "
       "requested through the Web Data Service. Water, pipeline and private trucking are not covered.",
       {f"{trade.TABLE}{part}.json": None for part in ("-meta", "", "-routes")})
source("tbs_dfrp", "Directory of Federal Real Property", "Treasury Board of Canada Secretariat",
       "https://open.canada.ca/data/en/dataset/08013e71-101a-457c-af76-c7b13a08ff64", OGL, "As retrieved (rebuilt daily)",
       ["Canadian Forces bases on the Military layer and in the Military advisor", "Restricted ground: the largest DND lands"],
       "Federal properties with their custodian, primary use, parcels, land area, buildings and coordinates; the "
       "Department of National Defence's military properties (primary use 41) give the bases and ranges.", {
           military.DFRP_FILE: "https://map-carte.tbs-sct.gc.ca/dfrp-rbif/oddo/dfrp-rbif.zip"
       })
source("statcan_military", "Military service status, 2021 Census", STATCAN, "https://doi.org/10.25318/9810014201-eng",
       "Statistics Canada Open Licence", "2021 Census",
       ["Serving members and veterans by province and city in the Military advisor", "Encampment cities"],
       "Residents 17 and over by military service status (currently serving in the Regular Force or Primary Reserve, "
       "veteran, never served) for Canada, the provinces and territories, CMAs and CAs (table 98-10-0142), requested "
       "through the Web Data Service.",
       {f"{military.SERVICE_TABLE}{part}.json": None for part in ("-meta", "")})
source("ps_cdd", "Canadian Disaster Database", "Public Safety Canada",
       "https://open.canada.ca/data/en/dataset/1c3d15f9-9cfa-4010-8462-0d67e493d9b9", OGL,
       "As published (events to December 2022)",
       ["Disasters in the Culture advisor: natural disasters since 1980 by type, province, year and cost"],
       "Significant disasters affecting Canadians since 1900, with their type, dates, provinces affected, deaths, "
       "evacuations and costs (in the dollars of the event year). The English extract, one spreadsheet.", {
           disasters.CDD_FILE: "https://open.canada.ca/data/dataset/1c3d15f9-9cfa-4010-8462-0d67e493d9b9/resource/"
           "c701e05e-4554-4c96-b7c9-0ec4a845fe91/download/cdd-extract-1.xlsx"
       })
source("statcan_cpi", "Consumer Price Index, annual average", STATCAN, "https://doi.org/10.25318/1810000501-eng",
       "Statistics Canada Open Licence", "Latest year in the table",
       ["Disaster costs in the latest year's dollars"],
       "All-items CPI for Canada, annual average (table 18-10-0005-01), requested through the Web Data Service.",
       {f"{disasters.CPI_TABLE}{part}.json": None for part in ("-meta", "")})
source("tc_ports", "Cargo tonnage handled by Canada Port Authorities (table M17)", "Transport Canada",
       "https://tdih-cdit.tc.canada.ca/en/addendum-tables/2024/table-m17-cargo-tonnage-handled-canada-port-authorities-2015-2024-0",
       "No licence stated (Government of Canada publication, reproduced with attribution)",
       "Transportation in Canada 2024, Statistical Addendum (2024 preliminary)",
       ["Ports on the Ports & airports layer: tonnage of the 17 Canada Port Authorities"],
       "Millions of tonnes handled by each Canada Port Authority, 2015 to 2024 (2024 preliminary). Private and "
       "provincial ports are not included.", {
           hubs.PORTS_FILE: "https://tdih-cdit.tc.canada.ca/en/addendum-tables/2024/"
           "table-m17-cargo-tonnage-handled-canada-port-authorities-2015-2024-0"
       })


def features(name):
    data = json.loads((SOURCE_DIR / f"{name}.json").read_text())
    if data.get("exceededTransferLimit") or not data.get("features"):
        raise ValueError(f"Incomplete feature collection: {name}")
    return data["features"]


def esri_geometry(feature, tolerance):
    # Esri rings are clockwise for shells, counterclockwise for holes.
    rings = feature["geometry"]["rings"]
    shells = [r for r in rings if len(r) >= 4 and not shapely.LinearRing(r).is_ccw]
    holes = [r for r in rings if len(r) >= 4 and shapely.LinearRing(r).is_ccw]
    polygons = [Polygon(r) for r in shells]
    tree = shapely.STRtree(polygons)
    interiors = defaultdict(list)
    for ring in holes:
        point = shapely.Point(ring[0])
        containers = tree.query(point, predicate="covered_by")
        if len(containers):
            i = min(containers, key=lambda j: polygons[j].area)
            interiors[i].append(ring)
    simplified = [Polygon(r, interiors[i]).buffer(0).simplify(tolerance) for i, r in enumerate(shells)]
    return unary_union(simplified)


def census_geometry(feature, tolerance=1500):
    return shapely.transform(esri_geometry(feature, tolerance), FROM_CENSUS.transform, interleaved=False)


def table(number):
    with zipfile.ZipFile(SOURCE_DIR / f"{number}.zip") as z:
        with io.TextIOWrapper(z.open(f"{number}.csv"), encoding="utf-8-sig") as f:
            yield from csv.DictReader(f)


def counts(number, estimates, year):
    """{DGUID: {geo_name, population, growth, land_km2, density}} for the areas of 2021 Census table `number`: the
    July 1 population estimate for `year` and its change since July 1, 2021 (both on 2021 boundaries, like the U.S.
    edition's population estimates), with the census land area and names. Density is that population per km² of
    2021 land. census_population, the 2021 Census count, is the base for shares of other census counts (the employed,
    workers by industry), so those ratios never divide one year by another."""
    result = {}
    for row in table(number):
        raw = row["Population and dwelling counts (13): Land area in square kilometres, 2021 [10]"]
        land = float(raw) if raw else None
        raw = row["Population and dwelling counts (13): Population, 2021 [1]"]
        counted = int(float(raw)) if raw else None
        series = estimates.get(row["DGUID"], {})
        population, base = series.get(year), series.get(census.FIRST_YEAR)
        growth = round(population / base - 1, 4) if population and base else None
        if growth is not None and abs(growth) > MAX_GROWTH:
            growth = None  # the U.S. sanity cap (pipeline/build/growth.py)
        result[row["DGUID"]] = dict(geo_name=row["GEO"], population=population, growth=growth, land_km2=land,
                                    density=round(population / land, 1) if population and land else None,
                                    census_population=counted)
    return result


def gdp_tables(names):
    """GDP in current dollars for the latest year in each table: Canada, the provinces and territories at market
    prices (table 36-10-0222; the latest year every one of `names` has) and CMAs at basic prices (36-10-0468, which
    ends earlier). Returns (year, {name: GDP}), (year, {CMA code: GDP})."""
    by_year = defaultdict(dict)
    for r in table("36100222"):
        if r["Prices"] == "Current prices" and r["Estimates"] == "Gross domestic product at market prices" and r["VALUE"]:
            by_year[int(r["REF_DATE"])][r["GEO"]] = int(r["VALUE"]) * 1_000_000
    year = max(y for y, geos in by_year.items() if set(names) <= set(geos))
    rows = list(table("36100468"))
    metro_year = max(int(row["REF_DATE"]) for row in rows if row["VALUE"])
    metros = {}
    parts = defaultdict(list)
    for row in rows:
        if int(row["REF_DATE"]) != metro_year:
            continue
        dguid = row["DGUID"]
        value = int(row["VALUE"]) * 1_000_000 if row["VALUE"] else None
        if dguid[4:9] == "S0503" and value is not None:
            metros[dguid[-3:]] = value
        elif dguid[4:9] == "S0505":
            parts[dguid[-3:]].append(value)
    for uid, values in parts.items():
        if uid not in metros and len(values) > 1 and None not in values:
            metros[uid] = sum(values)
    return (year, by_year[year]), (metro_year, metros)


def economy(pop, year, gdp, gdp_year, area=None, lfs=None, series=None):
    """The U.S. economic shape (build/yields.py economy()) for an area: the July 1 population estimate for `year`
    and its growth since 2021, the 2021 Census economy, and GDP for `gdp_year` with `gdp_population`, the estimate
    for that same year, so per-person GDP never divides numbers from different years (`series`: {year: people}).
    Unemployment is the Labour Force Survey's latest annual average (`lfs`: rate, year) where the survey publishes
    the area, else null; the 2021 Census rate is kept apart as unemployment_census, never mixed in."""
    area = area or {}
    jobs = census.job_yields(area.get("jobs"))
    rate, lfs_year = lfs or (None, None)
    has_gdp = gdp is not None
    return {**{key: val for key, val in pop.items() if key != "geo_name"},
            "growth_years": [census.FIRST_YEAR, year], "employed": area.get("employed"), "jobs": area.get("jobs"),
            "median_income": area.get("median_income"), "median_rent": area.get("median_rent"),
            "home_value": area.get("home_value"), "unemployment": rate, "unemployment_year": lfs_year,
            "unemployment_census": area.get("unemployment"),
            "rent_burden": area.get("rent_burden"), "gdp": gdp, "gdp_year": gdp_year if has_gdp else None,
            "gdp_population": (series or {}).get(gdp_year) if has_gdp else None,
            "yields": {"food": jobs["food"], "production": jobs["production"], "gold": gdp,
                       "science": jobs["science"], "culture": jobs["culture"]}}


def write(name, data):
    atomic_write_text(OUT / f"{name}.json", json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


def classify_points(geometries, xs, ys):
    result = np.full(len(xs), -1)
    tree = shapely.STRtree(geometries)
    point, geom = tree.query(shapely.points(xs, ys), predicate="intersects")
    # Stable ordering even when a centre lands on a shared boundary.
    result[point[::-1]] = geom[::-1]
    return result


def plurality(values):
    return Counter(values).most_common(1)[0][0]


def settle(grid, x, y, cell):
    """Rounded x/y, moved to the cell centre when the point is not inside its cell (snapped sites), as in the U.S."""
    x, y = round(x, 1), round(y, 1)
    if grid.cell_at(x, y) != cell:
        x, y = (round(v, 1) for v in grid.center(*grid.col_row(cell)))
    return x, y


def name_key(name):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", name).lower())


# Palette of the NRCan WMS. 12 is water, 0 is no sample.
PALETTE = {
    (0, 60, 0): 2, (147, 155, 111): 2, (19, 139, 4): 1, (91, 116, 42): 3,
    (178, 157, 50): 4, (224, 206, 137): 5, (155, 116, 83): 4, (185, 211, 142): 5,
    (63, 137, 111): 10, (106, 162, 137): 8, (240, 184, 108): 7, (167, 170, 173): 10,
    (219, 32, 37): 9, (75, 111, 162): 12, (254, 249, 254): 11,
}


def sample_cover(xs, ys):
    with Image.open(SOURCE_DIR / "landcover.png") as image:
        pixels = np.asarray(image.convert("RGBA"))
    encoded = np.zeros(pixels.shape[:2], dtype=np.int8)
    for rgb, cover in PALETTE.items():
        encoded[(pixels[:, :, :3] == rgb).all(axis=2) & (pixels[:, :, 3] == 255)] = cover
    west, south, east, north = COVER_BBOX
    cols = np.floor((xs - west) * encoded.shape[1] / (east - west)).astype(int)
    rows = np.floor((north - ys) * encoded.shape[0] / (north - south)).astype(int)
    valid = (cols >= 0) & (cols < encoded.shape[1]) & (rows >= 0) & (rows < encoded.shape[0])
    samples = np.zeros(len(xs), dtype=np.int8)
    samples[valid] = encoded[rows[valid], cols[valid]]
    return samples


def sample_elevation(grid, xy):
    with (SOURCE_DIR / "relief.csv").open() as f:
        rows = np.loadtxt(f, delimiter=",", skiprows=2)
    xs, ys = xy(rows[:, 1], rows[:, 0])
    samples = defaultdict(list)
    for x, y, alt in zip(xs, ys, rows[:, 2]):
        cell = grid.cell_at(x, y)
        if cell >= 0 and math.isfinite(alt):
            samples[cell].append(int(alt))
    return samples


def lines(geometry):
    if geometry["type"] == "LineString":
        yield geometry["coordinates"]
    elif geometry["type"] == "MultiLineString":
        yield from geometry["coordinates"]


def projected(line, xy):
    lon, lat = zip(*(point[:2] for point in line))
    return list(zip(*xy(lon, lat)))


def population_cores():
    """2021 population centres, the urban cores Statistics Canada builds each CMA and CA around: one shape per centre,
    with its size class (3 = large urban, 2 = medium, 1 = small) and land area."""
    shapes, info = defaultdict(list), {}
    for f in features("pc"):
        a = f["attributes"]
        shapes[a["PCUID"]].append(census_geometry(f, 100))
        name, cls, land = info.get(a["PCUID"], (a["PCNAME"], int(a["PCCLASS"] or 0), 0.0))
        info[a["PCUID"]] = (name, cls, land + (a["LANDAREA"] or 0))
    cores = [dict(name=info[uid][0], cls=info[uid][1], land=info[uid][2], shape=unary_union(parts))
             for uid, parts in shapes.items()]
    return cores, shapely.STRtree([c["shape"] for c in cores])


def core_point(cores, tree, area, parts):
    """A point in the CMA or CA's core population centre: the one named in its title, else the largest. Only
    centres lying mostly inside the area count (a neighbouring city's centre can touch a simplified boundary)."""
    overlaps = []
    for i in tree.query(area, predicate="intersects"):
        inside = cores[i]["shape"].intersection(area)
        if cores[i]["shape"].area > 0 and not inside.is_empty:
            overlaps.append((inside.area / cores[i]["shape"].area, cores[i], inside))
    hits = [(c, inside) for share, c, inside in overlaps if share >= 0.5]
    if not hits and overlaps:  # a small area whose simplified outline clips its own core: the most-covered centre
        share, c, inside = max(overlaps, key=lambda o: o[0])
        hits = [(c, inside)]
    if not hits:
        return None
    keys = {name_key(p) for p in parts}
    named = [h for h in hits if keys & {name_key(n) for n in re.split(r" [–-] | / ", h[0]["name"])}]
    core, inside = max(named or hits, key=lambda h: (h[0]["cls"], h[0]["land"]))
    return inside.representative_point()


def city_sites(boundaries, pop, year, metro_gdp, gdp_year, estimates, xy, grid, owner, states, areas, lfs,
               centre_x, centre_y):
    places = defaultdict(list)
    for f in features("populated_places"):
        p = f["properties"]
        if p.get("ADM0_A3") != "CAN":
            continue
        for name in {p["NAME"], p["NAMEASCII"]} - {None}:
            places[name_key(name)].append(xy(*f["geometry"]["coordinates"][:2]))
    cores, core_tree = population_cores()

    groups = defaultdict(list)
    for f in boundaries:
        groups[f["attributes"]["CMAUID"]].append(f)
    cities, anchored, fallback = [], Counter(), []
    for uid, group in groups.items():
        key = next((f"2021S{kind}{uid}" for kind in ("0503", "0504") if f"2021S{kind}{uid}" in pop), None)
        if not key or pop[key]["population"] is None:
            continue
        area = unary_union([census_geometry(f) for f in group])
        official = pop[key]["geo_name"]
        parts = [p.strip() for p in re.split(r" [–-] | / ", official)]
        # The position: a Natural Earth settlement named in the title, else the core population centre, else a point
        # inside the boundary. (The U.S. edition places each metro at its principal city.)
        candidates = [point for part in parts for point in places[name_key(part)]]
        anchor = next((pt for pt in candidates if area.distance(shapely.Point(*xy.unshift(*pt))) <= NEAR_M), None)
        how = "settlement"
        if anchor is None:
            point = core_point(cores, core_tree, area, parts)
            if point is not None:
                anchor, how = xy.shift(*point.coords[0]), "population centre"
        if anchor is None:
            part = max(shapely.get_parts(area), key=lambda item: item.area)
            anchor, how = xy.shift(*part.representative_point().coords[0]), "boundary"
        # Footprint (the U.S. cities.json field): the area's land hexes whose centre lies inside its boundary.
        footprint = [int(c) for c in np.flatnonzero(shapely.intersects_xy(area, centre_x, centre_y)) if owner[c] >= 0]
        anchored[how] += 1
        if how == "boundary":
            fallback.append(official)
        x, y = anchor
        abbrs = sorted({PROVINCES[f["attributes"]["PRUID"]] for f in group})
        metro = key.startswith("2021S0503")
        # Banners show the principal (first-named) city, as in the U.S.; the full census name stays in `full`.
        cities.append(dict(id="ca-" + uid, name=parts[0],
                           full=f"{official} · {'Census metropolitan area' if metro else 'Census agglomeration'}",
                           states=abbrs, metro=metro, capital=uid == "505", x=round(x, 1), y=round(y, 1),
                           cell=grid.cell_at(x, y), footprint=footprint,
                           **economy(pop[key], year, metro_gdp.get(uid) if metro else None, gdp_year, areas.get(key),
                                     lfs.get(key), estimates.get(key))))
    cities.sort(key=lambda c: (-c["population"], c["id"]))

    # Banner cells, as in the U.S. edition: on the city's own land, one city per cell where possible (bigger cities
    # choose first, up to 2 rings away). The city keeps its true position (x, y).
    index = {s["abbr"]: i for i, s in enumerate(states)}
    taken, snapped, moved, shared = set(), [], [], []
    for c in cities:
        own = {index[a] for a in c["states"]}
        cell = c["cell"]
        state = owner[cell] if cell >= 0 and owner[cell] in own else index[c["states"][0]]
        if cell < 0 or owner[cell] < 0:
            cell = nearest_land(grid, owner, max(cell, 0), c["x"], c["y"], state)
            snapped.append(c["name"])
        elif owner[cell] not in own:
            alt = free_cell(grid, owner, taken, cell, c["x"], c["y"], state)
            if alt is not None and owner[alt] == state:
                cell = alt
        if cell in taken:
            alt = free_cell(grid, owner, taken, cell, c["x"], c["y"], state)
            if alt is None:
                shared.append(c["name"])
            else:
                cell = alt
                moved.append(c["name"])
        taken.add(cell)
        c["cell"] = cell
        c["footprint"] = sorted(set(c["footprint"]) | {cell})  # always holds the banner hex, as in the U.S.
    print(f"    cities placed at a {dict(anchored)} (boundary: {fallback}); {len(snapped)} snapped to land, {len(moved)} nudged to a free hex, "
          f"{len(shared)} share a hex {shared}")
    return cities


class MapProjection:
    def __init__(self, west, north):
        self.west = west
        self.north = north

    def __call__(self, lon, lat):
        x, y = TO_MAP.transform(lon, lat)
        return self.shift(x, y)

    def shift(self, x, y):
        return (x - self.west) / 1000, (self.north - y) / 1000

    def unshift(self, x, y):
        return self.west + x * 1000, self.north - y * 1000


ROAD_CLASSES = [{"id": "national", "name": "National highway"}, {"id": "major", "name": "Major highway"}]
INFRA_RULES = {
    "roads": "Natural Earth 1:10m roads in Canada at scale rank 8 or less, sampled every 4 km and snapped to hex-centre "
             "links. Class 0: scale rank 5 or less (the Trans-Canada, Yellowhead and other national routes and the main "
             "freeways); class 1: scale rank 6 to 8. Natural Earth's Interstate tag is not used: it marks Quebec's "
             "autoroutes but not Ontario's 400-series highways.",
    "rail": "Natural Earth 1:10m railroads, sampled every 4 km and snapped to hex-centre links; tier 0 (main line) is "
            "scale rank 5 or less, as in the U.S. edition. Lower-ranked lines stay as secondary lines (the U.S. edition "
            "drops ranks above 7) because Canada's sparse network depends on remote lines.",
}


def infrastructure(grid, xy, owner, loc):
    from .build.infrastructure import RAIL_MAIN_SCALERANK, RAIL_TIERS, SITE_RINGS, links_of, sample_cells

    def keep(x, y):
        cell = grid.cell_at(x, y)
        return cell >= 0 and owner[cell] >= 0

    output = {}
    for layer, filename in (("roads", "roads"), ("rail", "railroads")):
        edges = {}
        for f in features(filename):
            p = f["properties"]
            rank = p.get("scalerank") or 0
            if layer == "roads" and (p.get("sov_a3") != "CAN" or rank > 8):
                continue
            tier = int(rank > (5 if layer == "roads" else RAIL_MAIN_SCALERANK))
            for line in lines(f["geometry"]):
                if not line or not any(-142 <= x <= -50 and 41 <= y <= 84 for x, y, *_ in line):
                    continue
                for run in sample_cells(grid, projected(line, xy), keep):
                    for a, b in links_of(grid, run):
                        if owner[a] >= 0 and owner[b] >= 0:
                            edges[(a, b)] = min(edges.get((a, b), tier), tier)
        output[layer] = [[a, b, tier] for (a, b), tier in sorted(edges.items())]
    ports, port_year, preliminary = port_sites(loc, SITE_RINGS)
    airports, air_year, off_map = airport_sites(loc, SITE_RINGS)
    vintage = dict(roads="Natural Earth v5.1.2 (1:10m)", rail="Natural Earth v5.1.2 (1:10m)",
                   ports=f"Transport Canada, Canada Port Authorities, {port_year}{' (preliminary)' if preliminary else ''}",
                   airports=f"Statistics Canada, {air_year} passengers enplaned and cargo")
    rules = dict(INFRA_RULES,
                 ports=f"The 17 Canada Port Authorities by cargo tonnage in {port_year}"
                       f"{' (preliminary)' if preliminary else ''}, in tonnes (Transport Canada table M17). Each stands at "
                       "Natural Earth's port point (Thunder Bay and Belledune at their official place names). Private "
                       "and provincial ports are not included.",
                 airports=f"Every airport with {hubs.MIN_BOARDINGS:,}+ passengers enplaned in {air_year}, and every airport "
                          f"handling {hubs.MIN_CARGO_T:,}+ tonnes of cargo (Statistics Canada tables 23-10-0253 and "
                          "23-10-0254), placed by ICAO code with OurAirports. Hub classes apply the FAA's shares of "
                          "national boardings (large 1%+, medium 0.25%+, small 0.05%+). Statistics Canada suppresses "
                          "some airports for confidentiality, among them Whitehorse, Iqaluit, Charlottetown, Kingston and "
                          "Kitchener/Waterloo, so they are not shown."
                          + (f" Left out with no land hex within {SITE_RINGS} rings, as in the U.S.: {', '.join(off_map)}."
                             if off_map else ""))
    return dict(version=1, vintage=vintage, sources=["natural_earth", "tc_ports", "statcan_airports", "ourairports"],
                road_classes=ROAD_CLASSES, rail_tiers=RAIL_TIERS, rules=rules, hubs=hubs.HUBS, ports=ports,
                airports=airports, **output)


def port_sites(loc, rings):
    """The Canada Port Authorities as U.S.-shaped port rows (`tons` holds tonnes), biggest first."""
    year, preliminary, tonnage = hubs.port_tonnage(SOURCE_DIR / hubs.PORTS_FILE)
    earth = defaultdict(list)
    for f in features("ports"):
        earth[f["properties"]["name"]].append(f["geometry"]["coordinates"][:2])
    out = []
    for rank, (key, tonnes) in enumerate(sorted(tonnage.items(), key=lambda kv: -kv[1]), 1):
        name, kind, (where, lat) = hubs.PORTS[key]
        if where == "geoname":
            lon, lat = hubs.geoname_point(SOURCE_DIR / lat, *hubs.GEONAME_PORTS[lat])
        else:
            lon, lat2 = min(earth[where], key=lambda p: abs(p[1] - lat))
            if abs(lat2 - lat) > 0.2:
                raise ValueError(f"Natural Earth has no {where} port near latitude {lat}")
            lat = lat2
        at = loc.place(*TO_MAP.transform(lon, lat), settle_point=False, rings=rings)
        if at is None:
            raise ValueError(f"{name} has no land hex within reach")
        out.append(dict(id=re.sub(r"[^a-z]+", "-", unicodedata.normalize("NFKD", key).encode("ascii", "ignore").decode().lower()).strip("-"),
                        name=name, type=kind, rank=rank, tons=tonnes, year=year, preliminary=preliminary,
                        placed_at="place name" if where == "geoname" else "port point", **at))
    return out, year, preliminary


def airport_sites(loc, rings):
    """Airports as U.S.-shaped rows (`cargo_t`: tonnes loaded and unloaded, in place of the FAA's landed pounds)."""
    year, traffic, national = hubs.traffic()
    points = hubs.airport_points(SOURCE_DIR / hubs.OURAIRPORTS)
    out, off_map = [], []
    for a in traffic:
        code = hubs.ICAO.get(a["name"])
        p = points.get(code)
        if p is None:
            raise ValueError(f"no OurAirports position for {a['name']} ({a['province']}, ICAO {code})")
        at = loc.place(*TO_MAP.transform(p["lon"], p["lat"]), settle_point=False, rings=rings)
        if at is None:  # islands too small for the hexes (the U.S. builder skips these too)
            off_map.append(a["name"])
            continue
        out.append(dict(id=p["iata"] or code, name=a["name"], city=p["municipality"] or None, hub=a["hub"],
                        enplanements=round(a["enplaned"]) if a["enplaned"] is not None else None,
                        enplanements_prev=round(a["enplaned_prev"]) if a["enplaned_prev"] is not None else None,
                        cargo_t=round(a["cargo_t"]) if a["cargo_t"] is not None else None, year=year, **at))
    print(f"    {len(out)} airports ({year}; off the map: {off_map})")
    return out, year, off_map


def resource_sites(xy, grid, states, owner):
    boundaries = features("pr-digital")
    province_codes = [PROVINCES[f["attributes"]["PRUID"]] for f in boundaries]
    if set(province_codes) != set(PROVINCES.values()):
        raise ValueError("Incomplete digital province and territory boundaries")
    province_tree = shapely.STRtree([esri_geometry(f, 0) for f in boundaries])
    to_boundary = Transformer.from_crs(4326, 3347, always_xy=True)
    index = {s["abbr"]: i for i, s in enumerate(states)}
    types = {}
    items = []
    snapped, offshore = [], []

    def resource_type(key, name, color, icon, emoji, description, source_id, unit=None, category="energy"):
        types[key] = dict(id=key, name=name, color=color, icon=icon, emoji=emoji, description=description,
                          source=source_id, category=category, unit=unit)

    def add(key, name, lon, lat, detail, state, value=None):
        x, y = xy(lon, lat)
        cell = grid.cell_at(x, y)
        if cell < 0:
            raise ValueError(f"Resource outside the map grid: {name} ({lon}, {lat})")
        if owner[cell] < 0:  # on water or across a border: the nearest hex of the site's own province
            near = nearest_land(grid, owner, cell, x, y, index[state], max_rings=SNAP_RINGS)
            if near < 0:  # an offshore field (the Grand Banks): its nearest coast hex, as the U.S. shows offshore wind
                near = nearest_land(grid, owner, cell, x, y, index[state], max_rings=OFFSHORE_RINGS)
                detail = f"{detail}; offshore, shown on the nearest coast hex"
                offshore.append(name)
            if near < 0:
                raise ValueError(f"No land hex within {OFFSHORE_RINGS} rings of {name} ({lon}, {lat})")
            cell = near
            snapped.append(name)
        x, y = settle(grid, x, y, cell)
        items.append(dict(type=key, name=name, x=x, y=y, cell=cell,
                          value=value, detail=detail, state=state, cbsa=None))

    fuels = {
        "Hydro": ("hydro", "#3fa7d6", "💧"), "Nuclear": ("nuclear", "#e8d44d", "☢️"),
        "Gas": ("gas_plant", "#e29e57", "⚡"), "Coal": ("coal_plant", "#92999d", "🏭"),
        "Wind": ("wind", "#72c5b2", "🌬️"), "Solar": ("solar", "#e1a64f", "☀️"),
        "Oil": ("oil_plant", "#b58467", "🛢️"), "Biomass": ("biomass", "#8fab63", "🌿"),
    }
    with (SOURCE_DIR / "plants.csv").open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["country"] != "CAN" or float(r["capacity_mw"] or 0) < 25:
                continue
            fuel = r["primary_fuel"]
            key, color, emoji = fuels.get(fuel, ("other_power", "#bfb6a1", "⚡"))
            resource_type(key, f"{fuel} power plant" if key != "other_power" else "Other power plant",
                          color, "r-" + (key if key not in ("oil_plant", "biomass", "other_power") else "gas_plant"), emoji,
                          "Capacity of at least 25 MW as listed in 2016–17 (Natural Resources Canada's August 2017 "
                          "inventory, via WRI). Plants built or closed since then are not reflected.",
                          "wri_plants", "MW")
            lon, lat = float(r["longitude"]), float(r["latitude"])
            point = shapely.Point(*to_boundary.transform(lon, lat))
            matches = province_tree.query(point, predicate="covered_by")
            if len(matches) != 1:
                raise ValueError(f"Expected one province or territory for plant {r['name']} at {lon}, {lat}")
            add(key, r["name"], lon, lat, " · ".join(filter(None, [fuel, r["owner"]])),
                province_codes[matches[0]], float(r["capacity_mw"]))

    layers = {
        5: ("coal_mine", "Coal mine", "#4a4038", "r-coal_mine", "⛏️"),
        6: ("oil_sands", "Oil sands operation", "#ae7952", "r-oil", "🛢️"),
    }
    field_types = {
        "Oil": ("oil", "Oil field", "#a8856a", "r-oil", "🛢️"),
        "Gas": ("gas", "Gas field", "#b8a09c", "r-gas", "🔥"),
        "Oil and Gas": ("oil_gas", "Oil and gas field", "#aa897f", "r-oil", "🛢️"),
        "Bitumen": ("bitumen", "Bitumen field", "#8e7363", "r-oil", "🛢️"),
    }
    province_by_name = {s["name"]: s["abbr"] for s in states}
    for layer in (3, 4, *layers, 13):
        for f in features(f"mines-{layer}"):
            p = f["properties"]
            if layer == 13:
                key, label, color, icon, emoji = field_types[p["type_en"]]
                name, detail = p["operation_en"], p["product_en"]
                text = "Named field in Natural Resources Canada's 900A inventory."
            else:
                name = p["operation_name_en"]
                detail = " · ".join(filter(None, (p.get("product_en_spelt"), p.get("operator_owners_en"))))
                if layer in (3, 4):  # metal and nonmetal mines: a type per primary commodity, as the U.S. edition
                    key = mineral_type(layer, p.get("product_en_spelt") or "")
                    label, color, icon, emoji, what = MINERALS[key]
                    text = (f"Producing mines in Natural Resources Canada's Map 900A inventory whose primary commodity is "
                            f"{what}. The inventory has no size measure, so every listed mine is shown.")
                else:
                    key, label, color, icon, emoji = layers[layer]
                    text = "Named site in Natural Resources Canada's 900A inventory."
            resource_type(key, label, color, icon, emoji, text, "nrcan_mines",
                          category="mineral" if layer in (3, 4, 5) else "energy")
            add(key, name, *f["geometry"]["coordinates"][:2], detail, province_by_name[p["province_en"]])
    # Legend and per-hex order: energy types as met, then minerals strategic first and quarries last.
    order = {key: k for k, key in enumerate(MINERALS)} | {"coal_mine": 11.5}
    types = dict(sorted(types.items(), key=lambda kv: (kv[1]["category"] == "mineral", order.get(kv[0], 0))))
    print(f"    {len(snapped)} of {len(items)} resource sites were on water or across a border and snapped to land, "
          f"{len(offshore)} of them offshore {offshore}")
    return dict(types=list(types.values()), items=items, summary=summarize(items, types,
                note="Power plants of 25 MW or more as listed in 2016–17 (NRCan via WRI), and sites in the NRCan 900A "
                     "inventory."))


# Mine types by primary commodity: (name, colour, icon, emoji, what it covers). The U.S. edition's types (and their
# colours and icons) where it has them; nickel, potash, diamonds, salt and industrial minerals reuse its icons.
MINERALS = {
    "uranium": ("Uranium mine/mill", "#6fcf3f", "r-uranium", "⚛️", "uranium"),
    "gold": ("Gold mine", "#d4af37", "r-gold", "🥇", "gold"),
    "copper": ("Copper mine", "#b87333", "r-copper", "🥉", "copper"),
    "nickel": ("Nickel mine", "#8fa89a", "r-silver", "🪙", "nickel"),
    "iron": ("Iron mine", "#8a4b2a", "r-iron", "⛓️", "iron ore"),
    "silver": ("Silver mine", "#b8c0c8", "r-silver", "🥈", "silver"),
    "platinum": ("Platinum-group mine", "#9fb4c7", "r-platinum", "💍", "platinum-group metals"),
    "lead_zinc": ("Lead-zinc mine", "#7d8a99", "r-lead_zinc", "🪨", "zinc or lead"),
    "molybdenum": ("Molybdenum mine", "#6f7f8f", "r-molybdenum", "🔩", "molybdenum"),
    "critical": ("Critical-minerals mine", "#b05fc7", "r-rare_earths", "🧲",
                 "a critical mineral (lithium, niobium, cesium, titanium, graphite or rare earths)"),
    "potash": ("Potash mine", "#d4806e", "r-lead_zinc", "🧪", "potash"),
    "diamonds": ("Diamond mine", "#9fd3e6", "r-platinum", "💎", "diamonds"),
    "salt": ("Salt mine", "#e8e4dc", "r-lead_zinc", "🧂", "salt or sodium salts"),
    "industrial": ("Industrial-minerals quarry", "#c7c0a9", "r-lead_zinc", "🪨",
                   "an industrial mineral (limestone, gypsum, dolomite, talc and the like)"),
}
METALS = {"gold": "gold", "copper": "copper", "iron": "iron", "nickel": "nickel", "silver": "silver",
          "uranium": "uranium", "zinc": "lead_zinc", "lead": "lead_zinc", "platinum group metals": "platinum",
          "molybdenum": "molybdenum"}


def mineral_type(layer, product):
    """The mine type for a 900A metal (layer 3) or nonmetal (layer 4) mine, from its first-listed commodity."""
    first = product.split(",")[0].strip().lower()
    if layer == 3:
        return METALS.get(first, "critical")
    if first.startswith("potash"):
        return "potash"
    if first == "diamonds":
        return "diamonds"
    if first.startswith(("salt", "sodium")):
        return "salt"
    if first in ("graphite", "lithium", "rare earth elements"):
        return "critical"
    return "industrial"


def summarize(items, types, note):
    """National and per-province {type: {count, value, unit}} over the mapped sites (the U.S. summary shape)."""
    def blank(t):
        return dict(count=0, value=0.0 if t["unit"] == "MW" else None, unit=t["unit"])

    national = {key: blank(t) for key, t in types.items()}
    states = {}
    for it in items:
        t = types[it["type"]]
        rows = [national[it["type"]], states.setdefault(it["state"], {}).setdefault(it["type"], blank(t))]
        for row in rows:
            row["count"] += 1
            if row["value"] is not None and it["value"] is not None:
                row["value"] += it["value"]
    return dict(note=note, national=national, states=dict(sorted(states.items())))


class SiteLocator:
    """Where a point site (wonder, port, airport) sits: its city (the CMA or CA holding it, else the nearest within
    NEAR_M: the generalized boundaries cut the shore, and with it waterfront sites such as Old Québec, UBC and Fort
    George), its province (the precise digital boundaries; the site's own, which can differ from its hex's: Ottawa's
    banner hex is mostly Gatineau) and its hex."""

    def __init__(self, grid, xy, owner, states, county, counties, cma_features, places):
        self.grid, self.xy, self.owner, self.states, self.county, self.counties = grid, xy, owner, states, county, counties
        self.footprint = {c["id"]: c["footprint"] for c in places}
        areas = defaultdict(list)
        for f in cma_features:
            areas[f"ca-{f['attributes']['CMAUID']}"].append(census_geometry(f))
        self.city_areas = {k: unary_union(v) for k, v in areas.items() if k in self.footprint}
        digital = features("pr-digital")  # precise, water included (the cartographic shapes move the Ottawa River)
        self.codes = [PROVINCES[f["attributes"]["PRUID"]] for f in digital]
        self.shapes = [esri_geometry(f, 0) for f in digital]
        self.tree = shapely.STRtree(self.shapes)
        self.to_digital = Transformer.from_crs(3978, 3347, always_xy=True)

    def city(self, mx, my):
        point = shapely.Point(mx, my)
        best = min(((area.distance(point), k) for k, area in self.city_areas.items()), default=(math.inf, None))
        return best[1] if best[0] <= NEAR_M else None

    def province(self, mx, my, cell):
        point = shapely.Point(*self.to_digital.transform(mx, my))
        hit = self.tree.query(point, predicate="covered_by")
        if len(hit):
            return self.codes[hit[0]]
        i = self.tree.nearest(point)
        return self.codes[i] if self.shapes[i].distance(point) <= NEAR_M else self.states[self.owner[cell]]["abbr"]

    def place(self, mx, my, in_city=True, settle_point=True, rings=SNAP_RINGS):
        """{x, y, cell, county, cbsa, state} for a site at (mx, my) in EPSG:3978 metres, or None with no land in reach.
        A site on a water or foreign hex moves to its city's nearest hex when it has one, else to the nearest land hex
        as in the U.S. (Fort George's hex is lake and New York; the nearest Ontario hex centre is Toronto's). Wonders
        stand in their hex (`settle_point`); ports and airports keep their true point, as in the U.S."""
        grid, owner = self.grid, self.owner
        x, y = self.xy.shift(mx, my)
        city = self.city(mx, my) if in_city else None
        cell = grid.cell_at(x, y)
        if cell >= 0 and owner[cell] < 0:
            if city:
                cell = min(self.footprint[city], key=lambda c: math.dist(grid.center(*grid.col_row(c)), (x, y)))
            else:
                cell = nearest_land(grid, owner, cell, x, y, -1, max_rings=rings)
        if cell < 0:
            return None
        x, y = settle(grid, x, y, cell) if settle_point else (round(x, 1), round(y, 1))
        return dict(x=x, y=y, cell=cell, county=self.counties[self.county[cell]]["geoid"] if self.county[cell] >= 0 else None,
                    cbsa=city, state=self.province(mx, my, cell))


def attendance():
    """{place: visits} from Parks Canada's fiscal 2025–26 attendance (places it could not report are left out)."""
    raw = (SOURCE_DIR / ATTENDANCE).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")  # the 2025–26 file is Windows-1252
    column = f"{ATTENDANCE_YEAR.replace('–', '-')} FY Attendance"
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        value = (row.get(column) or "").replace(",", "").strip()
        if value.isdigit() and (row.get("Place") or "").strip():
            out[row["Place"].strip()] = int(value)
    if len(out) < 100:
        raise ValueError(f"{ATTENDANCE}: expected the {column!r} column for about 120 places")
    return out


def geonames():
    """{name key: (id, lon, lat)} for national historic sites (generic code 538) and historic canals (4325)."""
    out = {}
    for code in (538, 4325):
        with (SOURCE_DIR / f"geonames-{code}.csv").open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if row["latitude"] and row["longitude"]:
                    out.setdefault(name_key(row["name"]), (row["id"], float(row["longitude"]), float(row["latitude"])))
    return out


def geoname_of(place, names):
    official = GEONAME_ALIASES.get(place) or re.sub(r"National Historic Sites?$", "National Historic Site of Canada", place)
    return names.get(name_key(official))


def campuses():
    """{name key: (lon, lat)} of universities in ODEF v2.1 (the first row with coordinates for each name), plus the
    Wikidata campus points of the universities it cannot place."""
    out = {}
    with zipfile.ZipFile(SOURCE_DIR / "ODEF_v2.1.zip") as z:
        member = next(n for n in z.namelist() if n.lower().endswith("odef_v2_1.csv"))
        text = z.read(member).decode("cp1252")
    for row in csv.DictReader(io.StringIO(text)):
        if row["Facility_Type"] in ("University", "Université") and row["Latitude"] not in ("", ".."):
            out.setdefault(name_key(row["Facility_Name"]), (float(row["Longitude"]), float(row["Latitude"])))
    for name, item in WIKIDATA_CAMPUSES.items():
        claim = json.loads((SOURCE_DIR / f"wikidata-{item}.json").read_text())["claims"]["P625"][0]
        value = claim["mainsnak"]["datavalue"]["value"]
        out[name_key(name)] = (value["longitude"], value["latitude"])
    return out


def wonders(loc, centre_x, centre_y):
    """wonders.json with the U.S. edition's four rules: the 15 most-visited national parks, the 5 most-visited other
    park units (here marine parks and historic canals), the 20 research universities with the most doctoral students
    (at most 2 per city), and 12 landmarks: the most-visited national historic sites (at most 1 per city)."""
    visits = attendance()
    names = geonames()
    owner, city_of = loc.owner, loc.city

    def wonder(rule, rank, kind, id, name, short, metrics, mx, my, area=None, in_city=True):
        """A wonders.json row for a site at (mx, my) in EPSG:3978 metres, or None when it has no land within reach."""
        at = loc.place(mx, my, in_city=in_city)
        if at is None:
            return None
        inside = np.flatnonzero(shapely.intersects_xy(area, centre_x, centre_y)).tolist() if area is not None else []
        return dict(id=id, name=name, short=short, kind=kind, rule=rule, rank=rank, metrics=metrics, **at,
                    cells=[c for c in inside if owner[c] >= 0] or None, curated=False)

    # National parks: one count for two parks is one wonder (the U.S. edition merges the National Mall's memorials).
    def join_name(name):
        return name.strip().casefold().replace(" of canada", "").replace("and national historic site", "and historic site")

    single, combined = {}, []
    for place, value in visits.items():
        pair = re.fullmatch(r"(.+) & (.+) National Parks", place)
        if pair:
            combined.append((value, [join_name(f"{p} National Park") for p in pair.groups()]))
        else:
            single[join_name(place)] = value
    park_visits = sum(v for n, v in single.items() if "national park" in n) + sum(v for v, _ in combined)
    by_name = {join_name(f["attributes"]["DESC_EN"]): f for f in features("park-areas")}
    candidates = [(single[n], [f]) for n, f in by_name.items() if n in single]
    candidates += [(v, [by_name[n] for n in group]) for v, group in combined if all(n in by_name for n in group)]
    if len(candidates) < 15:
        raise ValueError("Fewer than 15 parks matched the attendance and boundary files")
    parks, park_areas = [], []
    for value, members in sorted(candidates, key=lambda c: (-c[0], str(c[1][0]["attributes"]["BAID"]))):
        area = unary_union([esri_geometry(f, 1500) for f in members])
        if area.is_empty:
            continue
        full = [m["attributes"]["DESC_EN"].strip().removesuffix(" of Canada") for m in members]
        shorts = [re.sub(r" National Park.*$", "", n) for n in full]
        metrics = dict(visits=value, year=ATTENDANCE_YEAR, unit_type=members[0]["attributes"]["PLACE_TYPE_E"])
        if len(members) > 1:
            metrics.update(members=full, note="Parks Canada reports one attendance figure for these parks together.")
        row = wonder("national_park", len(parks) + 1, "natural",
                     "parks-ca-" + "-".join(str(m["attributes"]["BAID"]) for m in members),
                     full[0] if len(members) == 1 else f"{' and '.join(shorts)} National Parks", " & ".join(shorts),
                     metrics, *area.representative_point().coords[0], area=area, in_city=False)
        if row:
            parks.append(row)
            park_areas.append(area)
        if len(parks) == 15:
            break

    # Other park units: marine parks (their Parks Canada footprints) and historic canals (their official place names).
    marine = {join_name(f["attributes"]["DESC_EN"]): f for f in features("place-areas")
              if "Marine" in f["attributes"]["PLACE_TYPE_E"]}
    footprints = {join_name(f["attributes"]["DESC_EN"]): f for f in features("place-areas")}
    units = []
    for place, value in sorted(visits.items(), key=lambda kv: (-kv[1], kv[0])):
        key = join_name(place)
        if key in marine:
            f = marine[key]
            area = esri_geometry(f, 1500)
            point, kind, unit_type = area.representative_point().coords[0], "coastal", "Marine park"
            id = f"parks-ca-{f['attributes']['BAID']}"
        elif CANAL.search(place) and "National Historic Site" in place:
            site = geoname_of(place, names)
            if site is None:
                raise ValueError(f"no official place name with a location for {place!r}")
            area = esri_geometry(footprints[key], 1500) if key in footprints else None
            point, kind, unit_type, id = TO_MAP.transform(site[1], site[2]), "recreation", "Historic canal", f"nhs-{site[0]}"
        else:
            continue
        name = place.removesuffix(" National Historic Site")
        row = wonder("park_unit", len(units) + 1, kind, id, name, name.removesuffix(" National Marine Park"),
                     dict(visits=value, year=ATTENDANCE_YEAR, unit_type=unit_type), *point, area=area)
        if row:
            units.append(row)
        if len(units) == 5:
            break

    # Landmarks: the most-visited national historic sites, leaving out canals (park units) and sites inside a park
    # wonder (Rogers Pass, Cave and Basin), at most one per city.
    landmarks, per_city, inside_parks = [], Counter(), []
    for place, value in sorted(visits.items(), key=lambda kv: (-kv[1], kv[0])):
        if not re.search(r"National Historic Sites?$", place) or CANAL.search(place):
            continue
        site = geoname_of(place, names)
        if site is None:
            raise ValueError(f"no official place name with a location for {place!r}")
        mx, my = TO_MAP.transform(site[1], site[2])
        if any(area.covers(shapely.Point(mx, my)) for area in park_areas):
            inside_parks.append(place)
            continue
        city = city_of(mx, my)
        if city and per_city[city] >= PER_CITY["landmark"]:
            continue
        short = re.sub(r" National Historic Sites?$", "", place)
        row = wonder("landmark", len(landmarks) + 1, "landmark", f"nhs-{site[0]}", short, short,
                     dict(visits=value, year=ATTENDANCE_YEAR, unit_type="National Historic Site"), mx, my)
        if row:
            per_city[city] += 1
            landmarks.append(row)
        if len(landmarks) == 12:
            break

    # Research universities: doctoral students (Statistics Canada publishes no research spending by institution).
    year, breaks, enrolled = census.university_enrolments()
    places = campuses()
    universities, per_city = [], Counter()
    for name, row in sorted(enrolled.items(), key=lambda kv: (-kv[1]["doctoral"], kv[0])):
        lonlat = places.get(name_key(ODEF_ALIASES.get(name, name)))
        if lonlat is None:
            raise ValueError(f"no campus location for {name!r}")
        mx, my = TO_MAP.transform(*lonlat)
        city = city_of(mx, my)
        if city and per_city[city] >= PER_CITY["research_university"]:
            continue
        short = UNIVERSITY_SHORT.get(name) or re.sub(r"^(University of |Université de |Université )| University$", "", name)
        item = wonder("research_university", len(universities) + 1, "university",
                      "univ-ca-" + re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()).strip("-"),
                      name, short, dict(doctoral=row["doctoral"], enrollment=row["total"], year=f"{year}/{year + 1}"), mx, my)
        if item:
            per_city[city] += 1
            universities.append(item)
        if len(universities) == 20:
            break

    academic = f"{year}/{year + 1}"
    note = (f" {', '.join(breaks)} reported far fewer doctoral students in {year + 1}/{year + 2} (a reporting change), so "
            f"every university is ranked on {academic}." if breaks else "")
    print(f"    wonders: {len(parks)} parks, {len(units)} park units, {len(landmarks)} landmarks (inside parks: "
          f"{inside_parks[:4]}), {len(universities)} universities ({academic})")
    return dict(
        version=1,
        vintage=dict(parks=f"Parks Canada attendance, fiscal {ATTENDANCE_YEAR}",
                     boundaries="Parks Canada administrative areas, as retrieved",
                     universities=f"Statistics Canada postsecondary enrolments {academic}; ODEF v2.1 campus points",
                     landmarks="Canadian Geographical Names Database (national historic sites)"),
        sources=["parks_boundaries", "parks_attendance", "nrcan_geonames", "statcan_enrolment", "statcan_odef",
                 "wikidata_campuses"],
        national=dict(park_visits=park_visits, park_visits_year=ATTENDANCE_YEAR),
        rules=[
            dict(id="national_park", kind="natural", kinds=["natural"], year=ATTENDANCE_YEAR,
                 text=f"The 15 national parks and national park reserves with the most visits in fiscal {ATTENDANCE_YEAR} "
                      "(Parks Canada attendance), among those with a published boundary. Parks Canada reports Mount "
                      "Revelstoke and Glacier together, so they count as one."),
            dict(id="park_unit", kind="natural", kinds=["recreation", "coastal"], year=ATTENDANCE_YEAR,
                 text=f"The 5 most-visited marine parks and historic canals in fiscal {ATTENDANCE_YEAR} (Parks Canada "
                      "attendance): the park units that are neither national parks nor historic buildings and grounds. "
                      "Canals stand at their official place-name point, marine parks inside their boundary."),
            dict(id="research_university", kind="university", year=f"{year}/{year + 1}",
                 text=f"The 20 universities with the most doctoral students in {academic} (Statistics Canada, table "
                      "37-10-0232), at most 2 per city. Canada publishes no research spending by university, so doctoral "
                      f"enrolment stands in for the U.S. edition's R&D ranking.{note}"),
            dict(id="landmark", kind="landmark", year=ATTENDANCE_YEAR,
                 text=f"The 12 most-visited national historic sites in fiscal {ATTENDANCE_YEAR} (Parks Canada attendance), "
                      "at most one per city, ranked by data rather than hand-picked. Canals are park units, and sites "
                      "inside a national park wonder are left out so no place counts twice."),
        ],
        wonders=parks + units + universities + landmarks)


def build():
    provinces = features("pr")
    divisions = features("cd")
    print("Projecting Canadian boundaries…", flush=True)
    province_shapes = [census_geometry(f) for f in provinces]
    division_shapes = [census_geometry(f) for f in divisions]
    west, south, east, north = shapely.total_bounds(province_shapes) / 1000
    xy = MapProjection((west - MARGIN) * 1000, (north + MARGIN) * 1000)
    width, height = east - west + 2 * MARGIN, north - south + 2 * MARGIN
    grid = HexGrid.covering(width, height, RADIUS)
    centres_x, centres_y = np.asarray([grid.center(*grid.col_row(i)) for i in range(grid.size)]).T
    bearings = np.radians(np.arange(6) * 60 - 30)
    dx = np.r_[0, np.cos(bearings) * RADIUS * 0.6]
    dy = np.r_[0, np.sin(bearings) * RADIUS * 0.6]
    xs, ys = xy.unshift((centres_x[:, None] + dx).ravel(), (centres_y[:, None] + dy).ravel())

    print("Sampling the hex grid…", flush=True)
    sampled_provinces = classify_points(province_shapes, xs, ys)
    sampled_divisions = classify_points(division_shapes, xs, ys)
    neighbours = [shapely.transform(shape(f["geometry"]), TO_MAP.transform, interleaved=False)
                  for f in features("admin_0_countries") if f["properties"]["ADM0_A3"] in ("USA", "GRL", "SPM")]
    window = shapely.box(-150, 39, -48, 85)
    lake_shapes = [shape(f["geometry"]) for f in features("lakes")]
    lakes = [shapely.transform(lake, TO_MAP.transform, interleaved=False) for lake in lake_shapes if lake.intersects(window)]
    foreign = classify_points(neighbours, xs, ys) >= 0
    lake = classify_points(lakes, xs, ys) >= 0
    cover_samples = sample_cover(xs, ys)
    kinds = np.where(sampled_provinces >= 0, sampled_provinces, np.where(foreign, -2, -1))
    kinds[lake | ((cover_samples == 12) & (sampled_provinces >= 0))] = -3
    elevation = sample_elevation(grid, xy)
    metrics = defaultdict(list)
    owners = []
    county = []
    pct = {k: [] for k in ("forest", "crop", "pasture", "grass", "shrub", "wetland", "developed")}
    province_ids = [f["attributes"]["PRUID"] for f in provinces]
    division_province_ids = [f["attributes"]["PRUID"] for f in divisions]
    for i, points in enumerate(kinds.reshape(-1, 7)):
        votes = Counter(points.tolist())
        land = sum(n for k, n in votes.items() if k >= 0 or k == -2)
        # Keep tiny provinces represented where the centre is on their land.
        owner = plurality([k for k in points if k >= 0 or k == -2]) if land >= 4 or points[0] >= 0 else -1
        owners.append(int(owner))
        dd = sampled_divisions[i * 7:i * 7 + 7]
        valid = [int(j) for j in dd if j >= 0 and owner >= 0 and division_province_ids[j] == province_ids[owner]]
        county.append(plurality(valid) if valid else -1)
        samples = elevation[i]
        if owner != -1:  # land, Canadian or neighbouring: the mean of the samples above the shallows
            values = [v for v in samples if v >= -100]
            height_m = statistics.mean(values) if values else 0
            relief = classify_relief(max(height_m, 0), statistics.pstdev(values) if values else 0)
            if relief in (HILLS, MOUNTAINS) and is_valley_floor(values):
                relief -= 1  # mostly flat lowland with a range at one edge (the U.S. rule)
            metrics["elev"].append(round(height_m))
            metrics["elev_max"].append(max(0, max(values, default=0)))
            metrics["relief"].append(relief)
            metrics["water"].append(LAND)
        else:  # water, by the U.S. rules: a lake hex is at most 0 m; a sea hex takes the mean depth below sea level
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
        forest = sum(group[k] for k in (1, 2, 3))
        metrics["cover"].append(plurality(cover) if cover else 0)
        for key, amount in zip(pct, [forest, group[7], 0, group[5], group[4], group[8], group[9]]):
            pct[key].append(round(100 * amount / len(cover)) if cover else 0)
    water = metrics["water"]
    for i in range(grid.size):  # sea hexes beside land, or shallower than 200 m, are coast (the U.S. rule)
        if water[i] == OCEAN:
            near_land = any(water[j] == LAND for j in grid.neighbours(i))
            water[i] = COAST if near_land or metrics["elev"][i] > COAST_DEPTH_M else OCEAN

    rivers = []
    for f in features("rivers_lake_centerlines"):
        p = f["properties"]
        for line in lines(f["geometry"]):
            if not any(-149 <= x <= -49 and 40 <= y <= 85 for x, y, *_ in line):
                continue
            for piece in clip_polyline(projected(line, xy), width, height):
                rivers.append(dict(name=p.get("name"), rank=p["scalerank"],
                                   pts=[round(v, 1) for point in piece for v in point]))

    print("Joining census data and map layers…", flush=True)
    year, estimates = census.population_estimates()
    pop = counts("98100005", estimates, year)
    division_pop = counts("98100002", estimates, year)
    states = [dict(abbr=PROVINCES[p["PRUID"]], name=p["PRNAME"].split(" / ")[0], dguid=p["DGUID"])
              for p in (f["attributes"] for f in provinces)]
    (gdp_year, gdp), (metro_gdp_year, metro_gdp) = gdp_tables(["Canada"] + [s["name"] for s in states])
    INPUTS["statcan_estimates"][0]["vintage"] = f"July 1, {year}"
    INPUTS["statcan_gdp"][0].update(vintage=str(gdp_year), description=f"{gdp_year} Canada, province and territory GDP "
                                    "at market prices, in current Canadian dollars (the latest year in the table).")
    INPUTS["statcan_metro_gdp"][0].update(vintage=str(metro_gdp_year), description=(
        f"{metro_gdp_year} CMA GDP in current Canadian dollars, the latest year in the table. Coverage follows the "
        "metro definitions in the publisher table."))
    areas = census.area_profile()
    lfs = census.labour_force()
    lfs_years = sorted({year for _, year in lfs.values()})
    if len(lfs_years) != 1:
        raise ValueError(f"Labour Force Survey annual averages from several years: {lfs_years}")
    INPUTS["statcan_lfs"][0]["vintage"] = f"Labour Force Survey, {lfs_years[0]} annual averages"
    division_census = census.division_profile()
    state_data = [{**s, **economy(pop[s["dguid"]], year, gdp.get(s["name"]), gdp_year, areas.get(s["dguid"]),
                                  lfs.get(s["dguid"]), estimates.get(s["dguid"]))} for s in states]
    for s in state_data:
        s["ranks"] = {}
    for key in ("food", "production", "gold", "science", "culture"):  # rank among provinces and territories (U.S.)
        ranked = sorted((s for s in state_data if s["yields"][key] is not None), key=lambda s: -s["yields"][key])
        for i, s in enumerate(ranked, 1):
            s["ranks"][key] = i
    # GDP by industry (the U.S. gdp_by_industry): basic prices, so shares divide by gdp_basic, the all-industries total
    # at basic prices, not by the market-price GDP of the Gold yield. Canada is the sum of the 13.
    industry_year, by_industry, basic = census.gdp_by_industry()
    INPUTS["statcan_gdp_industry"][0].update(vintage=str(industry_year), description=(
        f"{industry_year} GDP at basic prices by NAICS sector, current dollars, for each province and territory (the "
        "latest year in the table); Canada is their sum. Basic prices leave out taxes less subsidies on products, so "
        "the industries add up to less than GDP at market prices."))
    for s in state_data:
        s["gdp_by_industry"], s["gdp_basic"], s["gdp_industry_year"] = by_industry[s["name"]], basic[s["name"]], industry_year
    national_industry = {k: sum(s["gdp_by_industry"][k] for s in state_data) for k in census.INDUSTRIES}
    national_basic = sum(s["gdp_basic"] for s in state_data)
    counties = [dict(geoid=p["CDUID"], name=" ".join(p["CDNAME"].split()), dguid=p["DGUID"])
                for p in (f["attributes"] for f in divisions)]
    places = city_sites(features("cma"), pop, year, metro_gdp, metro_gdp_year, estimates, xy, grid, owners, states,
                        areas, lfs, xs[::7], ys[::7])
    missing = [c["name"] for c in places if c["metro"] and c["unemployment"] is None]
    missing += [s["abbr"] for s in state_data if s["unemployment"] is None]
    if missing:
        raise ValueError(f"no Labour Force Survey unemployment for {missing}")
    # The City View's cities.json fields: ranks and peers, and the population by year (DGUID of each CMA or CA).
    dguid_of = {c["id"]: f"2021S{'0503' if c['metro'] else '0504'}{c['id'][3:]}" for c in places}
    city_view.add_ranks(places)
    city_view.add_pop_series(places, estimates, dguid_of)
    citizens = city_view.citizens_doc(places, dguid_of)
    for c in places:  # each city's own degree share (adults 25+, the census-division lens's measure), for the advisors
        education = (citizens["cities"].get(c["id"]) or {}).get("education")
        c["bachelors"] = education["bachelors_plus"] if education else None
    cover_table = [dict(id=0, key="none", name="No cover sample")] + [
        dict(id=i, key=key, name=name if i != 10 else "Barren & lichen", color=color,
             rule="Dominant among NRCan 2020 land-cover samples.")
        for i, key, name, color, _, _ in COVER if i != 6
    ]
    water_table = [dict(t, rule=rule) for t, rule in zip(WATER_TABLE, (
        "Canadian cartographic boundaries or Natural Earth land sampled seven times per hex.",
        "Sea averaging more than 200 m deep and not beside land.",
        "Sea beside land, or averaging up to 200 m deep.",
        "Inland water from Natural Earth and NRCan land cover; a lake hex's depth is shown as 0 m or below.",
    ))]
    resources = resource_sites(xy, grid, states, owners)
    city_view.tag_resources(resources["items"], places)
    capacity = defaultdict(Counter)
    for item in resources["items"]:
        if item["state"] and item["value"] is not None:
            capacity[item["state"]][item["type"]] += item["value"]
    for state in state_data:
        by_type = capacity[state["abbr"]]
        state["energy"] = dict(by_type=by_type, total=sum(by_type.values()))
    province_cells = defaultdict(list)
    for cell, o in enumerate(owners):
        if o >= 0:
            province_cells[o].append(cell)
    for i, state in enumerate(state_data):  # land-cover shares, as the U.S. states.json `land`
        state["land"] = land_shares(province_cells[i], pct, metrics["cover"])
    # No `home` frame: as in the U.S. edition, the map opens on all the land (here the whole country, Arctic included).
    write("world", dict(version=2, grid=grid.to_dict(), width=round(width, 1), height=round(height, 1), margin=MARGIN,
                        owner=owners, county=county, **metrics, pct=pct, states=states, counties=counties, rivers=rivers,
                        tables=dict(water=water_table, relief=RELIEF_TABLE, cover=cover_table)))
    write("cities", places)
    write("states", state_data)
    gold = dict(key="gold", label="Gold", icon="y-gold", emoji="💰", unit="cad", color="#f2c94c", industries=[],
                description=f"GDP in current Canadian dollars. Canada, the provinces and the territories: {gdp_year}, at "
                            f"market prices. CMAs: {metro_gdp_year}, the latest year Statistics Canada publishes, at basic "
                            "prices on the GDP table's boundaries; published provincial parts are combined when both are "
                            "reported.")
    food, production, science, culture = census.JOB_YIELDS
    canada = census.CANADA
    # `vintage` is the short label after "Turn" in the top bar (the U.S. edition's reads "ACS 2025 1-year").
    write("nation", dict(country="Canada", year=year, vintage=f"StatCan {year} estimates, {CENSUS_YEAR} Census",
                         population_vintage=f"Statistics Canada population estimates, July 1, {year} (2021 boundaries)",
                         census_vintage=CENSUS, census_year=CENSUS_YEAR,
                         gdp_vintage=f"Statistics Canada, {gdp_year} GDP (CAD; CMAs {metro_gdp_year})",
                         unemployment_vintage=INPUTS["statcan_lfs"][0]["vintage"],
                         nation={**economy(pop[canada], year, gdp["Canada"], gdp_year, areas.get(canada), lfs[canada],
                                           estimates[canada]),
                                 "gdp_by_industry": national_industry, "gdp_basic": national_basic,
                                 "gdp_industry_year": industry_year},
                         gdp_industries=dict(census.INDUSTRIES),
                         yields=[food, production, gold, science, culture], industries=census.INDUSTRIES))
    write("resources", resources)
    write("districts", city_view.districts_doc(places, dguid_of, grid, water, rivers))
    write("citizens", citizens)
    loc = SiteLocator(grid, xy, owners, states, county, counties, features("cma"), places)
    infra = infrastructure(grid, xy, owners, loc)
    write("infrastructure", infra)
    write("trade", trade.trade_doc(states, places, grid, owners, infra))
    write("wonders", wonders(loc, xs[::7], ys[::7]))
    write("disasters", disasters.disasters_doc(SOURCE_DIR / disasters.CDD_FILE, set(PROVINCES.values())))
    write("military", military.military_doc(SOURCE_DIR / military.DFRP_FILE, loc, states, places, TO_MAP))
    build_lenses(county, counties, division_pop, division_census, pct, metrics["cover"], owners, year)
    build_counties(counties, division_shapes, county, owners, grid, xy, division_pop, division_census, pct, metrics["cover"],
                   year)
    print(f"Canada: {len(states)} provinces and territories, {len(counties)} census divisions, {len(places)} urban areas, {grid.size} hexes.")


COUNTY_FIELDS = [  # the U.S. counties.json columns (docs/DATA_CONTRACTS.md) that Canadian data supports
    ("geoid", "CD code", "text", None, "neutral", "statcan_boundaries", "4-digit census division code (province + division)."),
    ("name", "Census division", "text", None, "neutral", "statcan_boundaries", "Census division name."),
    ("state", "Province", "text", None, "neutral", "statcan_boundaries", "Province or territory abbreviation."),
    ("population", "Population", "int", "people", "neutral", "statcan_estimates",
     "Population on July 1, {year} (Statistics Canada estimate, 2021 boundaries)."),
    ("land_km2", "Land area", "km2", "km²", "neutral", "statcan_divisions", "Land area (2021 Census)."),
    ("density", "Density", "float", "people / km²", "neutral", "statcan_estimates",
     "Residents on July 1, {year} per km² of land (2021 Census land area)."),
    ("income", "Income", "usd", "median household income, CA$", "good", "statcan_census_divisions",
     "Median total income of households in 2020 (2021 Census, table 98-10-0057)."),
    ("poverty", "Low income", "pct", "share of people in low income (LIM-AT)", "bad", "statcan_census_divisions",
     "Share of people in private households below the low-income measure after tax in 2020 (table 98-10-0103)."),
    ("median_age", "Median age", "years", "years", "neutral", "statcan_census_divisions", "Median age in 2021 (table 98-10-0022)."),
    ("foreign_born", "Born abroad", "pct", "share of residents who are immigrants or non-permanent residents", "neutral",
     "statcan_census_divisions", "Immigrants and non-permanent residents ÷ residents of private households (table 98-10-0348)."),
    ("bachelors", "Degrees", "pct", "adults 25+ with a bachelor's degree or higher", "good", "statcan_census_divisions",
     "Share of adults aged 25 and over whose highest degree is a bachelor's or higher (table 98-10-0387)."),
    ("commute", "Commute", "minutes", "average minutes to work, one way", "bad", "statcan_census_divisions",
     "Average one-way commuting time of workers who commute (table 98-10-0458; May 2021, during COVID-19 restrictions)."),
    ("homeownership", "Homeowners", "pct", "households that own their home", "neutral", "statcan_census_divisions",
     "Owner households ÷ all private households (table 98-10-0259)."),
    ("forest", "Forest", "pct", "share of land", "neutral", "nrcan_cover",
     "Share of the division's land samples in forest (NRCan 2020 land cover), averaged over its hexes."),
    ("crop", "Cropland", "pct", "share of land", "neutral", "nrcan_cover",
     "Share of the division's land samples in cropland, which includes hay and pasture (NRCan 2020 land cover)."),
    ("developed", "Built-up", "pct", "share of land", "neutral", "nrcan_cover",
     "Share of the division's land samples in urban and built-up land (NRCan 2020 land cover)."),
    ("cbsa", "Metro area", "text", None, "neutral", "statcan_boundaries",
     "Always null: CMAs and CAs are built from municipalities, not census divisions, so no division belongs to one."),
    ("cell", "Map hex", "int", None, "neutral", "statcan_boundaries",
     "A representative land hex: the one at the division's interior point, or the nearest land hex to it."),
    ("faith", "Faith", "float", "residents reporting a religion, per 100", "neutral", "statcan_census_divisions",
     "Residents who report a religion, per 100 residents of private households (table 98-10-0354)."),
    ("faith_tradition", "Largest tradition", "text", None, "neutral", "statcan_census_divisions",
     "The religious tradition most residents report, Catholic and other Christian counted apart (table 98-10-0354)."),
]
LAND_SHARES = ("forest", "crop", "pasture", "grass", "shrub", "wetland", "developed")


def land_shares(cells, pct, cover):
    """Mean land-cover shares over hexes with cover samples (the U.S. states.json `land`); NRCan has no pasture."""
    sampled = [c for c in cells if cover[c]]
    if not sampled:
        return {k: None for k in LAND_SHARES}
    return {k: None if k == "pasture" else round(sum(pct[k][c] for c in sampled) / len(sampled) / 100, 3)
            for k in LAND_SHARES}


def build_counties(divisions, division_shapes, county, owner, grid, xy, population, profile, pct, cover, year):
    """counties.json for the advisors: one row per census division, the U.S. columns Canadian data supports."""
    cells_of = defaultdict(list)
    for cell, k in enumerate(county):
        if k >= 0 and owner[cell] >= 0:
            cells_of[k].append(cell)
    rows = []
    for k, cd in enumerate(divisions):
        x, y = xy.shift(*division_shapes[k].representative_point().coords[0])
        cell = grid.cell_at(x, y)
        if cell < 0 or owner[cell] < 0:
            cell = nearest_land(grid, owner, max(cell, 0), x, y, -1)
        counts, census_row = population.get(cd["dguid"], {}), profile.get(cd["dguid"], {})
        land = land_shares(cells_of.get(k, []), pct, cover)
        values = dict(geoid=cd["geoid"], name=cd["name"], state=PROVINCES[cd["geoid"][:2]],
                      population=counts.get("population"), land_km2=counts.get("land_km2"), density=counts.get("density"),
                      median_age=census_row.get("age"), cbsa=None, cell=cell,
                      **{key: census_row.get(key) for key in ("income", "poverty", "foreign_born", "bachelors", "commute",
                                                              "homeownership", "faith", "faith_tradition")},
                      **{key: land[key] for key in ("forest", "crop", "developed")})
        rows.append([values[f[0]] for f in COUNTY_FIELDS])
    fields = [dict(key=key, label=label, format=fmt, unit=unit, higher_is=higher, source=src,
                   description=text.replace("{year}", str(year))) for key, label, fmt, unit, higher, src, text in COUNTY_FIELDS]
    write("counties", dict(vintage=f"{CENSUS}; population July 1, {year} estimates", fields=fields,
                           columns=[f["key"] for f in fields], rows=rows))


# NRCan's land cover has no pasture class: its cropland includes hay and pasture.
LAND_TEXT = {
    "forest": "Share of the hex's land samples in needleleaf, broadleaf or mixed forest (NRCan 2020 land cover, 7 samples per hex).",
    "farmland": "Share of the hex's land samples in cropland, which in NRCan's 2020 land cover includes hay and pasture (7 samples per hex).",
    "developed": "Share of the hex's land samples in urban and built-up land (NRCan 2020 land cover, 7 samples per hex).",
}


CENSUS_LENS_TEXT = {  # the U.S. county lenses (build/lenses.py COUNTY_LENSES), from 2021 Census division tables
    "income": ("median household income, CA$", "Median total income of households in 2020 in the census division "
               "that covers most of the hex (2021 Census, table 98-10-0057)."),
    "poverty": ("share of people in low income (LIM-AT)", "Share of people in private households below the low-income "
                "measure after tax in 2020 (2021 Census, table 98-10-0103). Canada's census has no single poverty line; "
                "LIM-AT is its standard low-income measure."),
    "age": ("years", "Median age of the census division's residents in 2021 (table 98-10-0022)."),
    "foreign_born": ("share of residents who are immigrants or non-permanent residents",
                     "Immigrants and non-permanent residents ÷ residents of private households, in the census division "
                     "that covers most of the hex (2021 Census, table 98-10-0348)."),
    "bachelors": ("adults 25+ with a bachelor's degree or higher",
                  "Share of adults aged 25 and over whose highest degree is a bachelor's or higher (2021 Census, table "
                  "98-10-0387, ages 25–64 plus 65 and over)."),
    "commute": ("average minutes to work, one way",
                "Average one-way commuting time of workers who commute (2021 Census, table 98-10-0458). The census week, "
                "in May 2021, fell during COVID-19 restrictions, when many people worked from home."),
    "homeownership": ("households that own their home", "Owner households ÷ all private households (2021 Census, "
                      "table 98-10-0259)."),
}


def build_lenses(cells, divisions, population, profile, pct, cover, owner, year):
    def division_lens(key, id, name, description, unit, format, scale, ramp, icon, emoji):
        values = [population.get(divisions[i]["dguid"], {}).get(key) if i >= 0 else None for i in cells]
        return dict(id=id, group="people", name=name, description=description, unit=unit, format=format, scale=scale,
                    ramp=ramp, icon=icon, emoji=emoji, higher_is="neutral", source="statcan_estimates", values=values)

    def census_values(key):
        return [profile.get(divisions[i]["dguid"], {}).get(key) if i >= 0 else None for i in cells]

    def census_lens(key):
        unit, text = CENSUS_LENS_TEXT[key]
        meta = {**COUNTY_LENSES[key][1], "unit": unit, "description": text}
        if key == "poverty":
            meta["name"] = "Low income"
        return dict(id=key, **meta, source="statcan_census_divisions", values=census_values(key))

    faith_cats, faith_index = census.faith_categories(profile, [d["dguid"] for d in divisions])
    faith_common = dict(group="faith", source="statcan_census_divisions", higher_is="neutral", scale="linear",
                        note="Self-identified religion of residents in private households (2021 Census), not congregation "
                             "membership as in the U.S. edition.")
    faith = [
        dict(id="faith", name="Faith", icon="l-faith", emoji="🕍", **faith_common, unit="residents reporting a religion, per 100",
             format="float", domain=[0, 100], ramp=["#1a1033", "#3d2466", "#6b3d8f", "#a5649c", "#d99a8f", "#f7dca0"],
             description="Residents who report a religion, per 100 residents of private households, in the census "
                         "division that covers most of the hex (2021 Census, table 98-10-0354). Religion is "
                         "self-identified; the U.S. edition counts congregations' adherents instead.",
             values=census_values("faith")),
        dict(id="faith_tradition", name="Largest tradition", icon="l-faith-tradition", emoji="⛪", **faith_common,
             unit="largest religious tradition by people", format="category",
             categories=[dict(id=i, name=n, color=c, description=d) for i, n, c, d in faith_cats],
             ramp=[c for _, _, c, _ in faith_cats], domain=[0, len(faith_cats) - 1],
             description="The religious tradition most people in the census division report, Catholic and other "
                         "Christian counted apart (2021 Census, table 98-10-0354).",
             values=[faith_index.get(v) for v in census_values("faith_tradition")]),
    ]

    lenses = [
        division_lens("density", "density", "Population",
                      f"Residents on July 1, {year} (Statistics Canada estimate) per km² of land in the census division "
                      "that covers most of the hex (2021 Census land area).",
                      "people / km²", "int", "log", ["#1b1035", "#4b2377", "#9a3b8a", "#e0645e", "#f9b24a", "#fff3a8"],
                      "l-people", "👥"),
        division_lens("growth", "growth", "Population change",
                      f"Population change from July 1, {census.FIRST_YEAR} to July 1, {year} (Statistics Canada "
                      "estimates on 2021 boundaries) in the census division that covers most of the hex. A change "
                      "beyond ±25% would be left blank, as in the U.S. edition.",
                      "%", "pct", "linear", ["#23548b", "#508db3", "#efe1ae", "#c56d38", "#a92d2a"], "l-growth", "📈"),
    ]
    lenses += [census_lens(k) for k in ("income", "poverty", "age", "foreign_born", "bachelors", "commute", "homeownership")]
    for lid, (keys, meta) in LAND_LENSES.items():  # the U.S. land lenses, from the NRCan land-cover samples
        values = [round(sum(pct[k][i] for k in keys) / 100, 2) if owner[i] >= 0 and cover[i] else None
                  for i in range(len(owner))]
        lenses.append(dict(id=lid, group="land", **{**meta, "description": LAND_TEXT[lid]}, unit="share of land",
                           format="pct", scale="linear", higher_is="neutral", source="nrcan_cover", values=values))
    lenses += faith
    for lens in lenses:  # colour range: the U.S. rule (faith keeps its fixed 0–100, the category lens its indexes)
        if "domain" in lens:
            continue
        lens["domain"] = percentile_domain(lens["values"], lens["scale"] == "log")
        lens["description"] += DOMAIN_NOTE
    groups = [g for g in GROUPS if any(lens["group"] == g["id"] for lens in lenses)]
    write("lenses", dict(vintage=CENSUS, groups=groups, lenses=lenses))


def download_inputs(force):
    """Download every file input (cached unless --force); Web Data Service replies are fetched while building."""
    for info, files in INPUTS.values():
        for name, url in files.items():
            if url:  # an .html input is a published table page (Transport Canada's M17), parsed and checked later
                download("canada", url, name, force=force, timeout=300, expect_binary=not name.endswith(".html"))


def record_provenance():
    """The Almanac catalog with the U.S. file fields, from the download log (data/raw/canada/manifest.json: URL,
    SHA-256, size and retrieval time of each file). A file cached before the log existed is entered once, dated by
    the file's own timestamp."""
    catalog = []
    manifest = read_manifest("canada")
    changed = False
    for info, files in INPUTS.values():
        provenance = []
        for name, url in files.items():
            entry = manifest.get(name)
            if url is None and not entry:
                raise ValueError(f"{name} is not in the download log")
            if url and (not entry or entry.get("url") != url):
                path = SOURCE_DIR / name
                entry = manifest[name] = dict(
                    url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size,
                    retrieved=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"))
                changed = True
            provenance.append(dict(file=name, url=entry["url"], retrieved=entry["retrieved"], sha256=entry["sha256"],
                                   bytes=entry["bytes"]))
        catalog.append(dict(info, files=provenance))
    if changed:
        atomic_write_text(manifest_path("canada"), json.dumps(manifest, indent=2, sort_keys=True))
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Refresh the cached publisher files")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    census.FORCE = args.force
    download_inputs(args.force)
    build()
    write("sources", record_provenance())


if __name__ == "__main__":
    main()
