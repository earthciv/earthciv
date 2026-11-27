"""Malaysia edition, milestone M2: the economy (GDP, workers, unemployment, household income) and its lenses.

pipeline/malaysia.py calls in here through a few hooks (see docs/MALAYSIA.md, "Economy"). This module never imports
pipeline.malaysia (it is run as `python -m pipeline.malaysia`, so that would load it twice); the parts of it that it
needs, the district list and the new-district crosswalk, are passed in.

Rules (all repeated in docs/MALAYSIA.md):
* Gold = GDP in constant 2015 ringgit. States and the nation: 2025 (DOSM state series). Districts and cities: 2020, the
  latest year of DOSM's district series. Each area's `gdp_year` says which. Offshore oil and gas ("Supra", ~RM 43 bn in
  2025) belongs to no state or district and is only in the national total.
* Food, Production, Science, Culture = workers by industry (2021 LFS, the latest state table; benchmarked to Census
  2020) by state. DOSM publishes no district split, so a district's figure is its state's workers in each industry
  shared out by the district's 2020 GDP in the matching sector (an estimate; the state totals are exact).
* Unemployment = Labour Force Survey 2024 (district counts; the four single-district areas use their state's).
* Income, poverty, Gini = HIES 2024. A district made of several survey districts (the parents of the 2025 districts)
  and every conurbation take the population-weighted mean of the means; the median is the same weighted mean of the
  member medians (an approximation); a Gini can not be combined, so it is left empty.
* Ethnicity and religion never enter anything in here.
"""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict

from .build.cities import PEERS
from .core.paths import RAW

SOURCE_DIR = RAW / "malaysia"
HIES_YEAR = 2024
LFS_YEAR = 2024
RAW_POPULATION_YEAR = 2025  # weights for survey districts that were split: the first year the new districts exist
GDP_UNIT = "RM, constant 2015 prices"
DOSM = "Department of Statistics Malaysia (DOSM)"
SECTORS = {"p1": "agriculture", "p2": "mining", "p3": "manufacturing", "p4": "construction", "p5": "services"}
GDP_INDUSTRIES = {
    "agriculture": "Agriculture", "mining": "Mining & quarrying (with offshore oil & gas)",
    "manufacturing": "Manufacturing", "construction": "Construction", "services": "Services",
}

# Survey districts whose name differs from the boundary file's (DOSM spells them several ways across tables and years).
ALIASES = {
    ("Perak", "Larut & Matang"): "Larut Dan Matang",
    ("Perak", "Manjung (Dinding)"): "Manjung",
    ("Pahang", "Cameron Highland"): "Cameron Highlands",
    ("Selangor", "Hulu Langat"): "Ulu Langat",
    ("Selangor", "Hulu Selangor"): "Ulu Selangor",
    ("Sarawak", "Tanjong Manis"): "Tanjung Manis",
    ("Sarawak", "Lubok antu"): "Lubok Antu",
    ("Terengganu", "Hulu"): "Hulu Terengganu",
    ("Pulau Pinang", "S.P. Selatan"): "Seberang Perai Selatan",
    ("Pulau Pinang", "S.P.Tengah"): "Seberang Perai Tengah",
    ("Pulau Pinang", "S.P.Utara"): "Seberang Perai Utara",
}
# Putrajaya's 2020 district GDP is inside Kuala Lumpur's (DOSM could not separate them).
GDP_FOLDS = {("W.P. Kuala Lumpur", "W.P. Kuala Lumpur"): [("W.P. Putrajaya", "W.P. Putrajaya")]}


def canonical(state, name):
    """(state, district) as the boundary file spells it."""
    name = " ".join(name.split())
    return state, ALIASES.get((state, name), name)


# ---------------------------------------------------------------------------------------------------- industries
# key (Canada's keys, so the industry icons resolve) -> (label, DOSM MSIC headings of the employment table)
INDUSTRIES = {
    "agriculture": ("Agriculture, forestry & fishing", ["Agriculture, forestry and fishing"]),
    "mining": ("Mining & quarrying", ["Mining and quarrying"]),
    "manufacturing": ("Manufacturing", ["Manufacturing"]),
    "utilities": ("Electricity, gas, water & waste",
                  ["Electricity, gas, steam and air conditioning supply",
                   "Water supply; sewerage, waste management and remediation activities"]),
    "construction": ("Construction", ["Construction"]),
    "retail": ("Wholesale & retail trade", ["Wholesale and retail trade, repair of motor vehicles and motorcycles"]),
    "transportation": ("Transportation & storage", ["Transportation and storage"]),
    "accommodation": ("Accommodation & food service", ["Accommodation and food service activities"]),
    "information": ("Information & communication", ["Information and communication"]),
    "finance": ("Finance & insurance", ["Financial and insurance/takaful activities"]),
    "real_estate": ("Real estate", ["Real estate activities"]),
    "professional": ("Professional, scientific & technical", ["Professional, scientific and technical activities"]),
    "admin": ("Administrative & support services", ["Administrative and support service activities"]),
    "public_admin": ("Public administration & defence", ["Public administration and defence; compulsory social security"]),
    "education": ("Education", ["Education"]),
    "health": ("Health & social work", ["Human health and social work activities"]),
    "arts": ("Arts, entertainment & recreation", ["Arts, entertainment and recreation"]),
    "other": ("Other services & households", ["Others service activities", "Activities of households as employers"]),
}
SECTOR_OF = {"agriculture": "agriculture", "mining": "mining", "manufacturing": "manufacturing",
             "construction": "construction"}  # every other industry is a service
YIELD_INDUSTRIES = {"food": ["agriculture"], "production": ["manufacturing", "construction", "mining"],
                    "science": ["professional", "information"], "culture": ["arts"]}
WORKERS_NOTE = ("Workers by industry from DOSM's Labour Force Survey (2021, the latest state table; Census 2020 is its "
                "benchmark), by state. DOSM publishes no district split, so a district's figure is its state's workers in "
                "each industry shared out by the district's 2020 GDP in the matching sector: an estimate. ")
YIELDS = [
    {"key": "food", "icon": "y-food", "emoji": "🌾", "label": "Food", "color": "#7fbf3f", "unit": "workers",
     "industries": YIELD_INDUSTRIES["food"],
     "description": "Workers in agriculture, forestry and fishing (oil palm, rubber, paddy, fisheries), counted where "
                    "they live. " + WORKERS_NOTE},
    {"key": "production", "icon": "y-production", "emoji": "⚙️", "label": "Production", "color": "#d9823b",
     "unit": "workers", "industries": YIELD_INDUSTRIES["production"],
     "description": "Workers in manufacturing, construction and mining & quarrying, counted where they live. "
                    + WORKERS_NOTE},
    {"key": "gold", "icon": "y-gold", "emoji": "💰", "label": "Gold", "color": "#f2c94c", "unit": "myr",
     "industries": [],
     "description": "GDP in constant 2015 ringgit (RM), so figures from different years compare. States and the nation: "
                    "2025. Districts and cities: 2020, the latest year DOSM publishes by district (Putrajaya's is inside "
                    "Kuala Lumpur's). Offshore oil and gas belongs to no state and is only in the national figure."},
    {"key": "science", "icon": "y-science", "emoji": "🔬", "label": "Science", "color": "#4fa3e0", "unit": "workers",
     "industries": YIELD_INDUSTRIES["science"],
     "description": "Workers in professional, scientific & technical activities and in information & communication, "
                    "counted where they live. " + WORKERS_NOTE},
    {"key": "culture", "icon": "y-culture", "emoji": "🎭", "label": "Culture", "color": "#b07ce0", "unit": "workers",
     "industries": YIELD_INDUSTRIES["culture"],
     "description": "Workers in arts, entertainment & recreation, counted where they live. " + WORKERS_NOTE},
]


# ---------------------------------------------------------------------------------------------------- sources
def register_sources(source):
    """Add this module's inputs to pipeline.malaysia's source table (`source` is its `source()` function)."""
    storage = "https://storage.dosm.gov.my"
    source("dosm_gdp", "Real GDP by district and by state; real GDP of Malaysia", DOSM,
           "https://data.gov.my/data-catalogue/gdp_district_real_supply", "CC BY 4.0", "District 2020; state and nation 2025",
           ["Gold (GDP) of districts, cities, states and Malaysia", "GDP by sector"],
           "Annual GDP at constant 2015 prices for five sectors (agriculture, mining, manufacturing, construction, "
           "services) and import duties: by district to 2020, by state and for Malaysia to 2025. The state table has "
           "offshore oil and gas as its own row.", {
               "gdp_district_real_supply.csv": f"{storage}/gdp/gdp_district_real_supply.csv",
               "gdp_state_real_supply.csv": f"{storage}/gdp/gdp_state_real_supply.csv",
               "gdp_annual_real_supply.csv": f"{storage}/gdp/gdp_annual_real_supply.csv"})
    source("dosm_employment", "Employed persons by industry and state, 1982-2021", DOSM,
           "https://archive.data.gov.my/data/dataset/employed-persons-by-industry-and-state", "Creative Commons Attribution (archive.data.gov.my; version not stated)",
           "2021", ["Food, Production, Science and Culture yields (workers by industry)", "Jobs by industry"],
           "Labour Force Survey estimates of employed persons by MSIC 2008 industry for each state, in thousands; the "
           "estimates from 2020 are benchmarked to the 2020 Census. The archive portal is the only place DOSM publishes "
           "this by state.", {
               "emp_state_industry.csv": "https://archive.data.gov.my/data/dataset/1fb468f2-0248-40bc-82d3-927497ade383/"
                                         "resource/24d35008-e7b0-4b73-869f-24a9d3cf543a/download/"
                                         "m-20210302115456_202303011017460_1982-2021-employed-persons-by-industry-and-state-dataset.csv"})
    source("dosm_lfs", "Labour Force Survey: district and state", DOSM,
           "https://data.gov.my/data-catalogue/lfs_district", "CC BY 4.0", f"{LFS_YEAR} annual",
           ["Unemployment"],
           "Annual labour force and unemployed persons (thousands) by district, and by state (used for the four areas "
           "that are one district: Perlis, Kuala Lumpur, Labuan and Putrajaya).", {
               "lfs_district.csv": f"{storage}/labour/lfs_district.csv",
               "lfs_state_sex.csv": f"{storage}/labour/lfs_state_sex.csv"})
    source("dosm_hies", "Household Income and Expenditure Survey: district, state and Malaysia", DOSM,
           "https://data.gov.my/data-catalogue/hies_district", "CC BY 4.0", f"HIES {HIES_YEAR}",
           ["Income, poverty, Gini and household spending"],
           "Mean and median gross monthly household income (RM), mean monthly household expenditure, the Gini "
           "coefficient and the absolute poverty rate (share of households below the poverty line income) by "
           "district and state, and the national median.", {
               "hies_district.csv": f"{storage}/hies/hies_district.csv",
               "hies_state.csv": f"{storage}/hies/hies_state.csv",
               "hh_income.csv": f"{storage}/hies/hh_income.csv"})


# ---------------------------------------------------------------------------------------------------- reading
def read_csv(name, encoding="utf8"):
    with (SOURCE_DIR / name).open(encoding=encoding, newline="") as f:
        return list(csv.DictReader(f))


def number(text):
    """A DOSM figure: '1,015.9' -> 1015.9; '', '-' and blanks -> None."""
    text = (text or "").strip().replace(",", "")
    return None if text in ("", "-") else float(text)


def read_gdp(name, level):
    """(year, {key: {"p0": ..., "p1": ...}} in RM million, supra) for the latest year of a DOSM real-GDP table. `level`
    is "district" (key = (state, district)) or "state" (key = state name). Offshore ("Supra") rows are returned apart."""
    rows = [r for r in read_csv(name) if r["series"] == "abs"]
    year = max(int(r["date"][:4]) for r in rows)
    out, supra = defaultdict(dict), {}
    for r in rows:
        if int(r["date"][:4]) != year:
            continue
        state, district = r["state"], r.get("district")
        if state == "Supra" or district == "Supra":
            if level == "state" and state == "Supra":
                supra[r["sector"]] = number(r["value"])
            continue
        out[(state, district) if level == "district" else state][r["sector"]] = number(r["value"])
    return year, dict(out), supra


def read_jobs():
    """(year, {state: {industry key: workers}}) from DOSM's employed-persons-by-industry-and-state table."""
    rows = read_csv("emp_state_industry.csv", "utf-8-sig")
    year = max(int(r["Year"]) for r in rows)
    heading = {h: key for key, (_, heads) in INDUSTRIES.items() for h in heads}
    jobs = defaultdict(lambda: defaultdict(float))
    for r in rows:
        if int(r["Year"]) != year or r["State"] == "MALAYSIA":
            continue
        key = heading.get(r["Industry"].strip())
        if key is None:
            raise ValueError(f"employment table: unknown industry {r['Industry']!r}")
        jobs[r["State"].title()][key] += (number(r["Employed person in Thousands"]) or 0) * 1000
    return year, {s: dict(v) for s, v in jobs.items()}


def raw_population():
    """{(state, district): people} for the 166 DOSM districts (the 160 plus the 2025 ones), `RAW_POPULATION_YEAR`."""
    out = {}
    for r in read_csv("population_district.csv"):
        if (r["sex"] == "both" and r["age"] == "overall" and r["ethnicity"] == "overall"
                and int(r["date"][:4]) == RAW_POPULATION_YEAR):
            out[(r["state"], r["district"])] = float(r["population"]) * 1000
    return out


def shares(key, new_districts):
    """{boundary district: share} a survey district's figures count towards (itself, or the district(s) it was cut from)."""
    parents = new_districts.get(key)
    if not parents:
        return {key: 1.0}
    total = sum(parents.values())
    return {p: w / total for p, w in parents.items()}


def fold_counts(rows, new_districts):
    """{boundary key: {field: count}}: counts of survey districts summed onto the boundary districts, a new district's
    counts split over its parents by the crosswalk shares. `rows` is {(state, name as published): {field: count}}."""
    out = defaultdict(lambda: defaultdict(float))
    for (state, name), values in rows.items():
        for parent, share in shares(canonical(state, name), new_districts).items():
            for field, v in values.items():
                out[parent][field] += v * share
    return {k: dict(v) for k, v in out.items()}


def fold_means(rows, weights, new_districts):
    """({boundary key: {field: mean}}, set of boundary keys made of several survey districts). Means are weighted by
    `weights` ({(state, district) as DOSM names it: residents}); a missing figure is skipped, not zero."""
    num, den, parts = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float)), defaultdict(set)
    for (state, name), values in rows.items():
        raw = canonical(state, name)
        for parent, share in shares(raw, new_districts).items():
            w = weights[raw] * share
            parts[parent].add(raw)
            for field, v in values.items():
                if v is not None:
                    num[parent][field] += v * w
                    den[parent][field] += w
    means = {k: {f: num[k][f] / den[k][f] for f in num[k] if den[k][f]} for k in num}
    return means, {k for k, v in parts.items() if len(v) > 1}


def apportion(total, weights):
    """Share `total` (a count) over keys in proportion to `weights` (None counts as 0); None when nothing to go on."""
    weights = {k: (w or 0) for k, w in weights.items()}
    whole = sum(weights.values())
    return {k: total * w / whole for k, w in weights.items()} if whole > 0 else None


# ---------------------------------------------------------------------------------------------------- the economy
def yields_of(jobs, gdp):
    return {"food": sum(jobs.get(k, 0) for k in YIELD_INDUSTRIES["food"]) if jobs else None,
            "production": sum(jobs.get(k, 0) for k in YIELD_INDUSTRIES["production"]) if jobs else None,
            "gold": gdp,
            "science": sum(jobs.get(k, 0) for k in YIELD_INDUSTRIES["science"]) if jobs else None,
            "culture": sum(jobs.get(k, 0) for k in YIELD_INDUSTRIES["culture"]) if jobs else None}


def whole(v):
    return None if v is None else round(v)


def rm(million):
    return None if million is None else round(million * 1e6)


def gdp_fields(sectors):
    """The GDP part of an area's figures from its DOSM sector values (RM million)."""
    if not sectors or sectors.get("p0") is None:
        return {"gdp": None, "gdp_by_industry": None, "gdp_basic": None}
    by = {GDP_INDUSTRIES_KEY: rm(sectors.get(p) or 0) for p, GDP_INDUSTRIES_KEY in SECTORS.items()}
    return {"gdp": rm(sectors["p0"]), "gdp_by_industry": by, "gdp_basic": sum(by.values())}


class Economy:
    """Everything M2 knows, on the 160 boundary districts, the 16 states and the nation."""

    def __init__(self, props, pop, new_districts):
        self.pop, self.new_districts = pop, new_districts
        self.keys = [(p["state"], p["district"]) for p in props]
        self.by_state = defaultdict(list)
        for k in self.keys:
            self.by_state[k[0]].append(k)
        self.gdp_year, district_gdp, _ = read_gdp("gdp_district_real_supply.csv", "district")
        self.state_gdp_year, state_gdp, self.supra = read_gdp("gdp_state_real_supply.csv", "state")
        self.jobs_year, state_jobs = read_jobs()
        self.state_jobs = state_jobs
        unknown = set(district_gdp) - set(self.keys)
        if unknown:
            raise ValueError(f"GDP rows with no boundary district: {sorted(unknown)}")
        self.state_gdp_raw = state_gdp
        self.district_gdp_raw = district_gdp
        self._labour()
        self._household()
        self._workers()
        self.nation_income = next(
            (number(r["income_median"]), number(r["income_mean"])) for r in read_csv("hh_income.csv")
            if int(r["date"][:4]) == HIES_YEAR)

    # --- labour force: counts, so folding and summing are exact
    def _labour(self):
        rows = {}
        for r in read_csv("lfs_district.csv"):
            if int(r["date"][:4]) == LFS_YEAR and number(r["lf"]) is not None:  # the 2025 districts have empty 2024 rows
                rows[(r["state"], r["district"])] = {"lf": number(r["lf"]) * 1000, "unemployed": number(r["lf_unemployed"]) * 1000}
        self.labour = fold_counts(rows, self.new_districts)
        self.state_labour = {}
        for r in read_csv("lfs_state_sex.csv"):
            if r["sex"] == "both" and int(r["date"][:4]) == LFS_YEAR:
                self.state_labour[r["state"]] = {"lf": number(r["lf"]) * 1000, "unemployed": number(r["lf_unemployed"]) * 1000}
        for state, members in self.by_state.items():
            if len(members) == 1:  # one-district areas have no district row: the state's survey is the district's
                self.labour[members[0]] = self.state_labour[state]
        missing = [k for k in self.keys if k not in self.labour]
        if missing:
            raise ValueError(f"no Labour Force Survey row for {missing}")

    # --- household income survey: means, folded with population weights
    def _household(self):
        fields = ("income_mean", "income_median", "expenditure_mean", "gini", "poverty")
        rows = {(r["state"], r["district"]): {f: number(r[f]) for f in fields}
                for r in read_csv("hies_district.csv") if int(r["date"][:4]) == HIES_YEAR}
        weights = raw_population()
        self.household, self.merged = fold_means(rows, weights, self.new_districts)
        for state, members in self.by_state.items():
            if len(members) == 1:
                row = next(r for r in read_csv("hies_state.csv") if r["state"] == state and int(r["date"][:4]) == HIES_YEAR)
                self.household[members[0]] = {f: number(row[f]) for f in fields}
        missing = [k for k in self.keys if k not in self.household]
        if missing:
            raise ValueError(f"no household income survey row for {missing}")
        self.state_household = {r["state"]: {f: number(r[f]) for f in fields} for r in read_csv("hies_state.csv")
                                if int(r["date"][:4]) == HIES_YEAR}

    # --- workers by industry: state totals are exact; districts share them out by sector GDP
    def _workers(self):
        self.district_jobs = {}
        for state, members in self.by_state.items():
            jobs = self.state_jobs[state]
            if len(members) == 1:
                self.district_jobs[members[0]] = dict(jobs)
                continue
            for industry, total in jobs.items():
                sector = next(p for p, name in SECTORS.items() if name == SECTOR_OF.get(industry, "services"))
                split = (apportion(total, {k: self.district_gdp_raw.get(k, {}).get(sector) for k in members})
                         or apportion(total, {k: self.district_gdp_raw.get(k, {}).get("p0") for k in members})
                         or apportion(total, {k: self.pop[k][max(self.pop[k])] for k in members}))
                for k, n in split.items():
                    self.district_jobs.setdefault(k, {})[industry] = n
        for state, jobs in self.state_jobs.items():  # the shares must give the state's workers back
            members = self.by_state[state]
            for industry, total in jobs.items():
                got = sum(self.district_jobs[k].get(industry, 0) for k in members)
                if abs(got - total) > 1e-6 * max(total, 1):
                    raise ValueError(f"{state} {industry}: districts hold {got}, state has {total}")

    # --- one district
    def district_gdp_population(self, key):
        """Residents of the GDP year the district's GDP covers (Kuala Lumpur's includes Putrajaya's)."""
        return sum(self.pop[k].get(self.gdp_year, 0) for k in [key, *GDP_FOLDS.get(key, [])])

    def district(self, key):
        gdp = self.district_gdp_raw.get(key)
        jobs = self.district_jobs[key]
        labour, house = self.labour[key], dict(self.household[key])
        if key in self.merged:
            house["gini"] = None
        fields = {
            **gdp_fields(gdp), "gdp_year": self.gdp_year if gdp else None,
            "gdp_population": self.district_gdp_population(key) if gdp else None,
            "gdp_industry_year": self.gdp_year if gdp else None,
            "jobs": {k: round(v) for k, v in jobs.items()}, "employed": round(sum(jobs.values())),
            "lf": labour["lf"], "unemployed": labour["unemployed"],
            "unemployment": round(labour["unemployed"] / labour["lf"], 4) if labour["lf"] else None,
            "unemployment_year": LFS_YEAR,
            "median_income": whole(house.get("income_median")), "income_mean": whole(house.get("income_mean")),
            "expenditure": whole(house.get("expenditure_mean")),
            "gini": None if house.get("gini") is None else round(house["gini"], 3),
            "poverty": None if house.get("poverty") is None else round(house["poverty"] / 100, 4),
        }
        fields["yields"] = yields_of(fields["jobs"], fields["gdp"])
        return fields

    def districts(self):
        if not hasattr(self, "_districts"):
            self._districts = {k: self.district(k) for k in self.keys}
        return self._districts

    # --- a group of districts (a conurbation, or a single-district city)
    def city_fields(self, keys):
        """The economic figures of a city made of the districts `keys`. Counts and GDP add up; the median income is
        the population-weighted mean of the member medians (an approximation: medians can not be summed)."""
        ds = [self.districts()[k] for k in keys]
        gdp_keys = [d for d in ds if d["gdp"] is not None]
        folded = {k for key in keys if self.districts()[key]["gdp"] is not None for k in [key, *GDP_FOLDS.get(key, [])]}
        jobs = defaultdict(float)
        for d in ds:
            for k, v in d["jobs"].items():
                jobs[k] += v
        by = defaultdict(float)
        for d in gdp_keys:
            for k, v in d["gdp_by_industry"].items():
                by[k] += v
        lf, unemployed = sum(d["lf"] for d in ds), sum(d["unemployed"] for d in ds)
        weights = [self.pop[k][HIES_YEAR] for k in keys]
        incomes = [(d["median_income"], w) for d, w in zip(ds, weights) if d["median_income"] is not None]
        fields = {
            "gdp": sum(d["gdp"] for d in gdp_keys) if gdp_keys else None,
            "gdp_year": self.gdp_year if gdp_keys else None,
            "gdp_population": sum(self.pop[k].get(self.gdp_year, 0) for k in folded) if gdp_keys else None,
            "gdp_by_industry": {k: round(v) for k, v in by.items()} if gdp_keys else None,
            "gdp_basic": round(sum(by.values())) if gdp_keys else None,
            "gdp_industry_year": self.gdp_year if gdp_keys else None,
            "jobs": {k: round(v) for k, v in jobs.items()}, "employed": round(sum(jobs.values())),
            "unemployment": round(unemployed / lf, 4) if lf else None, "unemployment_year": LFS_YEAR,
            "median_income": round(sum(v * w for v, w in incomes) / sum(w for _, w in incomes)) if incomes else None,
        }
        fields["yields"] = yields_of(fields["jobs"], fields["gdp"])
        return fields

    # --- a state
    def state_fields(self, name, population_in_gdp_year):
        sectors = self.state_gdp_raw.get(name)
        jobs = {k: round(v) for k, v in self.state_jobs[name].items()}
        labour, house = self.state_labour[name], self.state_household.get(name, {})
        fields = {
            **gdp_fields(sectors), "gdp_year": self.state_gdp_year, "gdp_population": population_in_gdp_year,
            "gdp_industry_year": self.state_gdp_year,
            "jobs": jobs, "employed": sum(jobs.values()),
            "unemployment": round(labour["unemployed"] / labour["lf"], 4), "unemployment_year": LFS_YEAR,
            "median_income": house.get("income_median"),
        }
        fields["yields"] = yields_of(jobs, fields["gdp"])
        return fields

    def nation_fields(self, states, population_in_gdp_year):
        """Malaysia: the sum of the states, plus offshore oil and gas in GDP."""
        gdp = sum(s["gdp"] for s in states) + (rm(self.supra.get("p0")) or 0)
        by = defaultdict(int)
        for s in states:
            for k, v in s["gdp_by_industry"].items():
                by[k] += v
        by["mining"] += rm(self.supra.get("p2")) or 0
        jobs = defaultdict(int)
        for s in states:
            for k, v in s["jobs"].items():
                jobs[k] += v
        lf = sum(v["lf"] for v in self.state_labour.values())
        unemployed = sum(v["unemployed"] for v in self.state_labour.values())
        fields = {
            "gdp": gdp, "gdp_year": self.state_gdp_year, "gdp_population": population_in_gdp_year,
            "gdp_offshore": rm(self.supra.get("p0")), "gdp_by_industry": dict(by), "gdp_basic": sum(by.values()),
            "gdp_industry_year": self.state_gdp_year, "jobs": dict(jobs), "employed": sum(jobs.values()),
            "unemployment": round(unemployed / lf, 4), "unemployment_year": LFS_YEAR,
            "median_income": self.nation_income[0],
        }
        fields["yields"] = yields_of(fields["jobs"], gdp)
        return fields

    def nation_meta(self):
        return {"gdp_vintage": f"DOSM real GDP at constant 2015 prices (states and Malaysia {self.state_gdp_year}, "
                               f"districts and cities {self.gdp_year})",
                "unemployment_vintage": f"Labour Force Survey, {LFS_YEAR} annual",
                "jobs_vintage": f"Labour Force Survey, {self.jobs_year} (by state)",
                "income_year": HIES_YEAR, "gdp_industries": GDP_INDUSTRIES,
                "industries": {k: label for k, (label, _) in INDUSTRIES.items()}}


def add_ranks(states, places):
    """States: rank of each yield (1 = most). Cities: ranks of population, GDP, GDP per person, growth and the yields,
    and the PEERS cities nearest in population (the shape canada_city_view.add_ranks writes)."""
    def rank(items, value):
        have = sorted((i for i in items if value(i) is not None), key=lambda i: -value(i))
        return {id(i): r for r, i in enumerate(have, 1)}

    def value(c, key):
        if key == "gdp_per_capita":
            return c["gdp"] / c["gdp_population"] if c.get("gdp") is not None and c.get("gdp_population") else None
        return c.get(key) if key in ("population", "gdp", "growth") else (c.get("yields") or {}).get(key)

    for s in states:
        s["ranks"] = {}
    for key in ("food", "production", "gold", "science", "culture"):
        ranked = rank(states, lambda s, key=key: s["yields"][key])
        for s in states:
            if id(s) in ranked:
                s["ranks"][key] = ranked[id(s)]
    for c in places:
        c["ranks"] = {}
    for key in ("population", "gdp", "gdp_per_capita", "growth", "food", "production", "gold", "science", "culture"):
        ranked = rank(places, lambda c, key=key: value(c, key))
        for c in places:
            c["ranks"][key] = ranked.get(id(c))
    for i, c in enumerate(places):
        near = sorted((abs(math.log(o["population"]) - math.log(c["population"])), j)
                      for j, o in enumerate(places) if j != i)
        c["peers"] = [places[j]["id"] for _, j in near[:PEERS]]


# ---------------------------------------------------------------------------------------------------- lenses
INCOME_RAMP = ["#3a1c0b", "#7a4413", "#b8781f", "#e3b23c", "#f6e27f", "#fffbe0"]
POVERTY_RAMP = ["#03051a", "#4c1d4b", "#a11a5b", "#e83f3f", "#f69c73", "#faebdd"]
GINI_RAMP = ["#0b1f2a", "#1d4f63", "#2f8a8a", "#8cc7a1", "#e6e29a", "#fff6d0"]
LAND_RAMPS = {
    "forest": ["#0b1f0f", "#14401c", "#1f6b2b", "#3a9443", "#7fc07a", "#d5efcd"],
    "crop": ["#141d05", "#2f4510", "#557019", "#84a02a", "#b8cf55", "#eef7b8"],
    "developed": ["#121218", "#2c2c3c", "#4b4b66", "#727294", "#a3a3c2", "#e2e2f0"],
}
EXTRA_GROUPS = [{"id": "prosperity", "name": "Prosperity"}, {"id": "land", "name": "Land"}]


def merge_groups(groups):
    """Lens groups in display order: People, Prosperity, then the rest as given, Land last."""
    out = []
    for g in groups:
        out.append(g)
        if g["id"] == "people":
            out.append(EXTRA_GROUPS[0])
    return out + [EXTRA_GROUPS[1]]


def lenses(econ, spread, pct, owners, year, domain):
    """The economic and land lenses. `spread` copies one value per district onto the hexes; `domain(values, log)` is the
    engine's percentile colour range; `pct` and `owners` are world.json's land-cover shares and hex owners."""
    ds = [econ.districts()[k] for k in econ.keys]
    note = " Colours span the 2nd–98th percentile of hexes; values beyond are drawn at the end colours."
    approx = (" Where a district is made of several survey districts (the parents of the districts created in 2025) the "
              "figure is the population-weighted mean of them.")

    def lens(id, name, icon, emoji, unit, fmt, higher, ramp, description, per_district, source="dosm_hies",
             group="prosperity", scale="linear"):
        values = spread(per_district)
        return {"id": id, "group": group, "name": name, "icon": icon, "emoji": emoji, "unit": unit, "format": fmt,
                "scale": scale, "higher_is": higher, "ramp": ramp, "source": source, "description": description + note,
                "domain": domain(values, scale == "log"), "values": values}

    gdp_pc = [d["gdp"] / d["gdp_population"] if d["gdp"] is not None else None for d in ds]
    out = [
        lens("income", "Income", "l-income", "💵", "median gross monthly household income, RM", "usd", "good", INCOME_RAMP,
             f"Median gross monthly household income in {HIES_YEAR} (DOSM Household Income and Expenditure Survey) in the "
             "district that covers most of the hex." + approx + " Where that happens the median is the weighted mean of "
             "the medians, an approximation.", [d["median_income"] for d in ds]),
        lens("poverty", "Poverty", "l-poverty", "🥣", "share of households in absolute poverty", "pct", "bad",
             POVERTY_RAMP,
             f"Share of households below the national poverty line income in {HIES_YEAR} (HIES, absolute poverty) in the "
             "district that covers most of the hex." + approx, [d["poverty"] for d in ds]),
        lens("gini", "Inequality", "l-poverty", "⚖️", "Gini coefficient of household income", "float", "bad", GINI_RAMP,
             f"Gini coefficient of household income in {HIES_YEAR} (HIES; 0 = everyone earns the same) in the district "
             "that covers most of the hex. A Gini can not be combined, so districts made of several survey districts "
             "have no value.", [d["gini"] for d in ds]),
        lens("unemployment", "Unemployment", "l-poverty", "📉", "unemployed ÷ labour force", "pct", "bad", POVERTY_RAMP,
             f"Unemployed persons ÷ labour force in {LFS_YEAR} (Labour Force Survey) in the district that covers most "
             "of the hex. Perlis, Kuala Lumpur, Labuan and Putrajaya show their state's rate.",
             [d["unemployment"] for d in ds], source="dosm_lfs"),
        lens("gdp_pc", "GDP per resident", "l-income", "🏭", f"{GDP_UNIT}, per resident", "usd", "good", INCOME_RAMP,
             f"District GDP in {econ.gdp_year} at constant 2015 prices ÷ its residents that year, for the district that "
             "covers most of the hex. Output is counted where it is produced, so districts with big industry or "
             "commuters read high. Offshore oil and gas is in no district; Putrajaya's output is in Kuala Lumpur's "
             "(Putrajaya shows no value).", gdp_pc, source="dosm_gdp", scale="log"),
    ]
    lands = [("forest", "forest", "Tree cover", "l-forest", "🌴",
              ("Share of the hex's land samples in trees (Sentinel-2 10 m land cover, 7 samples per hex). The map counts "
               "rubber and other tree crops as trees (oil palm is moved to cropland), so this is not natural forest.")),
             ("farmland", "crop", "Cropland", "l-farmland", "🚜",
              ("Share of the hex's land samples in cropland such as paddy and vegetables (Sentinel-2 10 m land cover, 7 "
               "samples per hex). Oil palm is counted here (Descals 2019 map); rubber estates are counted as trees.")),
             ("developed", "developed", "Built-up", "l-developed", "🏙️",
              "Share of the hex's land samples in built-up land (Sentinel-2 10 m land cover, 7 samples per hex).")]
    for id, key, name, icon, emoji, text in lands:
        values = [round(pct[key][i] / 100, 3) if owners[i] >= 0 else None for i in range(len(owners))]
        out.append({"id": id, "group": "land", "name": name, "icon": icon, "emoji": emoji, "unit": "share of land",
                    "format": "pct", "scale": "linear", "higher_is": "neutral", "ramp": LAND_RAMPS[key],
                    "source": "esri_cover", "description": text, "domain": [0, 1], "values": values})
    return out


# ---------------------------------------------------------------------------------------------------- counties.json
def counties_table(econ, props, pop, year, area_km2, county, cell_of, city_of, vintage):
    """counties.json for the 160 districts, in world.json `counties` order, column-oriented (DATA_CONTRACTS.md)."""
    ds = econ.districts()
    fields = [
        ("geoid", "District code", "text", None, "neutral", "dosm_districts", "State code + district code."),
        ("name", "District", "text", None, "neutral", "dosm_districts", "District name (DOSM)."),
        ("state", "State", "text", None, "neutral", "dosm_districts", "State or federal territory."),
        ("population", "Population", "int", "people", "neutral", "dosm_population", f"Residents, {year} (DOSM estimate)."),
        ("land_km2", "Area", "km2", "km²", "neutral", "dosm_districts", "Area of the district boundary."),
        ("density", "Density", "float", "people / km²", "neutral", "dosm_population", "Residents ÷ area."),
        ("gdp", "GDP", "usd", GDP_UNIT, "good", "dosm_gdp",
         f"District GDP in {econ.gdp_year}; Kuala Lumpur's includes Putrajaya's (which is empty)."),
        ("gdp_per_capita", "GDP per resident", "usd", GDP_UNIT, "good", "dosm_gdp", f"GDP ÷ residents of {econ.gdp_year}."),
        ("income", "Income", "usd", "median gross monthly household income, RM", "good", "dosm_hies",
         f"HIES {HIES_YEAR}; weighted mean of the survey districts where several were combined (approximation)."),
        ("income_mean", "Mean income", "usd", "mean gross monthly household income, RM", "good", "dosm_hies", f"HIES {HIES_YEAR}."),
        ("expenditure", "Spending", "usd", "mean monthly household expenditure, RM", "neutral", "dosm_hies", f"HIES {HIES_YEAR}."),
        ("poverty", "Poverty", "pct", "share of households in absolute poverty", "bad", "dosm_hies", f"HIES {HIES_YEAR}."),
        ("gini", "Gini", "float", "Gini coefficient", "bad", "dosm_hies", f"HIES {HIES_YEAR}; empty where districts were combined."),
        ("unemployment", "Unemployment", "pct", "unemployed ÷ labour force", "bad", "dosm_lfs", f"Labour Force Survey {LFS_YEAR}."),
        ("food", "Food workers", "int", "workers (estimate)", "neutral", "dosm_employment", WORKERS_NOTE.strip()),
        ("production", "Production workers", "int", "workers (estimate)", "neutral", "dosm_employment", WORKERS_NOTE.strip()),
        ("science", "Science workers", "int", "workers (estimate)", "neutral", "dosm_employment", WORKERS_NOTE.strip()),
        ("culture", "Culture workers", "int", "workers (estimate)", "neutral", "dosm_employment", WORKERS_NOTE.strip()),
        ("cbsa", "City", "text", None, "neutral", "dosm_population", "cities.json id of the city the district belongs to, if any."),
        ("cell", "Hex", "int", None, "neutral", "dosm_districts", "A land hex of the district, nearest its centre."),
    ]
    rows = []
    for i, (p, k) in enumerate(zip(props, econ.keys)):
        d, people = ds[k], pop[k][year]
        rows.append([f"{p['code_state']:02d}{p['code_district']:02d}", p["district"], p["state"], people,
                     round(area_km2[i], 2), round(people / area_km2[i], 1), d["gdp"],
                     round(d["gdp"] / d["gdp_population"]) if d["gdp"] is not None else None,
                     d["median_income"], d["income_mean"], d["expenditure"], d["poverty"], d["gini"], d["unemployment"],
                     round(d["yields"]["food"]), round(d["yields"]["production"]), round(d["yields"]["science"]),
                     round(d["yields"]["culture"]), city_of.get(i), cell_of.get(i)])
    return {"vintage": vintage,
            "fields": [{"key": k, "label": label, "format": fmt, "unit": unit, "higher_is": hi, "source": src,
                        "description": desc} for k, label, fmt, unit, hi, src, desc in fields],
            "columns": [f[0] for f in fields], "rows": rows}


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
