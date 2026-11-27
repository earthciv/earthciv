"""City View data for the Malaysia edition (M5): districts.json and citizens.json.

* districts.json: the industry districts of every city, by the U.S. rule (pipeline/build/districts.py) applied to the
  workers by industry that M2 already put on each city (cities.json `jobs`). Those are NOT district counts: DOSM
  publishes workers by industry for states only (Labour Force Survey), and M2 shares each state's workers over its
  districts by sector GDP (agriculture, mining, manufacturing, construction, services). Inside one state every city
  therefore has the state's service-sector mix, scaled by how big its services sector is. The rule text says so.
* citizens.json: the age mix of each city (DOSM population estimates, counted per district) and the education mix of
  its labour force (a state mix: DOSM publishes it by state only, applied to each district's labour force).

Not here, by design: ethnicity and religion. They feed no row, no persona and no figure of this file, and nothing in
this module reads them (rule 5 of PLAN.md "Race and religion"; tests/test_malaysia_edition.py checks both). The City
View's figures are unnamed, one skin tone, and drawn only for occupations, ages and schooling, so no names are needed.

Missing on purpose: occupation, how people get to work and where people were born (no DOSM table at district or state
level that we can read). Household size is published by district (Census 2020, Kawasanku) but the City View has no
slot for it, so it is not added. The text pack says so where the City View would have shown those rows.
"""

from __future__ import annotations

import csv
from collections import defaultdict

from .build.citizens import (
    FIGURES,
    MAX_HIGH,
    MAX_LOW,
    SPECIALIST_HIGH,
    SPECIALIST_LOW,
    largest_remainder,
    specialists,
)
from .build.citizens import MIN_SHARE as SPECIALIST_MIN_SHARE
from .build.districts import (
    BADGE_LQ,
    BADGE_SHARE,
    BY_ID,
    MAX_PER_CITY,
    MIN_JOBS,
    MIN_LQ,
    MIN_SHARE,
    TOP_INDUSTRIES,
    badge_district,
    excess,
    lq,
)

SOURCE = "dosm_city_view"
EDUCATION_FILE = "labour_force_education_state.csv"
EDUCATION_URL = ("https://archive.data.gov.my/data/dataset/a1bbe790-be4d-4f9f-9e42-6174e483b45d/resource/"
                 "d639bbd8-fcb2-4d67-8507-648640850bd4/download/"
                 "_202302090937530_1982-2021-labour-force-by-educational-attainment-and-state-dataset.csv")
EDUCATION_YEAR = 2021
VINTAGE = "DOSM LFS 2021 workers by state, apportioned by 2020 district GDP"
# DOSM's state names in the education table -> the boundary file's
EDUCATION_STATES = {
    "JOHOR": "Johor", "KEDAH": "Kedah", "KELANTAN": "Kelantan", "MELAKA": "Melaka", "N.SEMBILAN": "Negeri Sembilan",
    "P.PINANG": "Pulau Pinang", "PAHANG": "Pahang", "PERAK": "Perak", "PERLIS": "Perlis", "SABAH": "Sabah",
    "SARAWAK": "Sarawak", "SELANGOR": "Selangor", "TERENGGANU": "Terengganu", "W.P.KUALA LUMPUR": "W.P. Kuala Lumpur",
    "W.P.LABUAN": "W.P. Labuan", "W.P.PUTRAJAYA": "W.P. Putrajaya"}


def register_sources(source):
    """Add this module's input to pipeline.malaysia's source table (`source` is its `source()` function)."""
    source(SOURCE, "Labour force by educational attainment and state, 1982-2021", "Department of Statistics Malaysia (DOSM)",
           "https://archive.data.gov.my/data/dataset/labour-force-by-state-and-educational-attainment",
           "Creative Commons Attribution (archive.data.gov.my; version not stated)", f"{EDUCATION_YEAR}",
           ["Education row of the City View (a state mix)"],
           "Labour force (aged 15 and over, thousands) by highest education reached (no formal education, primary, "
           "secondary, tertiary) for each state and for Malaysia. The only education table DOSM publishes by state; "
           "none exists by district, so every district gets its state's mix.", {EDUCATION_FILE: EDUCATION_URL})


# ------------------------------------------------------------------------------------------------ districts
# Industries (cities.json `jobs` keys, M2's INDUSTRIES) in the engine's district catalog. Only districts the engine
# already draws, and only where an industry stands for them: no Harbor (transport & storage is ports, trucking and
# post alike), no Aerodrome, no Encampment (no defence or aviation split), and no farm district (the catalog has none).
DISTRICTS = {
    "campus": ["professional", "information", "education"],
    "commercial_hub": ["finance"],
    "industrial_zone": ["manufacturing", "mining"],
    "theater_square": ["arts"],
    "entertainment_complex": ["accommodation"],
    "government_plaza": ["public_admin"],
    "aqueduct": ["utilities"],
}
DESCRIPTIONS = {
    "campus": "Science and knowledge work: professional, scientific and technical services, information and "
              "communication, and education.",
    "commercial_hub": "Finance and insurance (including takaful).",
    "industrial_zone": "Manufacturing plus mining and quarrying.",
    "theater_square": "Arts, entertainment and recreation.",
    "entertainment_complex": "Accommodation and food service: hotels, restaurants and cafés.",
    "government_plaza": "Public administration and defence, and compulsory social security. Counted where people live.",
    "aqueduct": "Electricity, gas, steam, water supply, sewerage and waste.",
}


def catalog():
    out = []
    for id, industries in DISTRICTS.items():
        d = BY_ID[id]
        out.append({"id": id, "name": d["name"], "icon": d["icon"], "color": d["color"], "naics": industries, "sub": {},
                    "badge": {"id": d["badge"]["id"], "label": d["badge"]["label"], "labels": {}},
                    "description": DESCRIPTIONS[id], "caveat": None})
    return out


RULE_TEXT = (
    f"A district appears when the workers in its industries have a location quotient (the city's share of workers in "
    f"them divided by Malaysia's share) of at least {MIN_LQ:g} and number at least {MIN_JOBS:,} or {MIN_SHARE:.0%} of the "
    f"city's workers. Districts are ranked by how many workers they have above the national norm (workers minus workers "
    f"divided by the quotient); up to {MAX_PER_CITY} per city. The city type is named after the strongest district, or "
    f"after a listed district with a quotient of at least {BADGE_LQ:g} and at least {BADGE_SHARE:.0%} of the city's "
    f"workers when there is one; 'Capital city' goes only to Kuala Lumpur. These are the U.S. edition's rules, with "
    f"two differences: DOSM publishes no detailed industries, so a district is a whole industry section and no "
    f"speciality can qualify; and the worker counts are estimates, not counts. DOSM's Labour Force Survey gives workers by "
    f"industry for each state (2021) and M2 shares them over the state's districts by their 2020 GDP in the same "
    f"sector (agriculture, mining, manufacturing, construction, services), so every city in a state has that state's "
    f"mix of service industries and differs from its neighbours only in how large its services sector is. Read a "
    f"district as 'this state's industry, concentrated in this city', not as a count of the city's own workers. "
    f"Harbor, Aerodrome and Encampment districts are not drawn: DOSM publishes no ports, aviation or defence workers."
)


def districts_doc(places, nation_jobs, industries, state_note=None):
    """districts.json: the rule applied to every city's `jobs`. `industries` is {key: label} (nation.json)."""
    cat = catalog()
    total_nat = sum(nation_jobs.values())
    cities = {}
    for c in places:
        jobs, total = c.get("jobs"), c.get("employed")
        if not jobs or not total:
            cities[c["id"]] = None
            continue
        found = []
        for d in cat:
            emp = sum(jobs.get(k, 0) for k in d["naics"])
            nat = sum(nation_jobs.get(k, 0) for k in d["naics"])
            q = lq(emp, total, nat, total_nat)
            if q is None or q < MIN_LQ or not (emp >= MIN_JOBS or emp / total >= MIN_SHARE):
                continue
            found.append({"id": d["id"], "lq": round(q, 2), "emp": int(emp), "share": round(emp / total, 4),
                          "avg_pay": None, "sub": None, "sub_lq": None, "sub_emp": None, "sub_lower_bound": None,
                          "via": "broad", "strength": round(excess(emp, q)), "suppressed": 0, "lower_bound": False})
        found.sort(key=lambda r: -r["strength"])
        found = found[:MAX_PER_CITY]
        top = []
        for k, emp in jobs.items():
            q = lq(emp, total, nation_jobs.get(k), total_nat)
            if q is not None and emp >= MIN_JOBS:
                top.append({"naics": k, "emp": int(emp), "lq": round(q, 2), "avg_pay": None, "oty_pct": None,
                            "suppressed": 0, "lower_bound": False})
        top.sort(key=lambda r: -r["lq"])
        cities[c["id"]] = {"emp": int(total), "avg_pay": None, "counties": None, "top": top[:TOP_INDUSTRIES],
                           "districts": found, "badge": badge(badge_district(found), bool(c.get("capital")))}
    return {
        "version": 1, "vintage": VINTAGE, "year": 2021, "sources": ["dosm_employment", "dosm_gdp"],
        "rule": {"min_lq": MIN_LQ, "min_jobs": MIN_JOBS, "min_share": MIN_SHARE, "specialty_lq": None,
                 "max_per_city": MAX_PER_CITY, "harbor_needs_water": False, "badge_lq": BADGE_LQ,
                 "badge_share": BADGE_SHARE, "text": RULE_TEXT,
                 "county_note": "Districts (daerah) get no industry districts in the Malaysian edition.",
                 "military_encampments": False, "counts": "workers", "estimated": True},
        "catalog": cat,
        "industries": {k: {"title": label, "national_emp": nation_jobs.get(k)} for k, label in industries.items()},
        "national": {"emp": int(total_nat), "avg_pay": None},
        "cities": cities, "counties": {},
    }


def badge(best, capital):
    if not best:
        return None
    d = BY_ID[best["id"]]
    label = "Capital city" if capital and d["id"] == "government_plaza" else d["badge"]["label"]
    return {"id": d["badge"]["id"], "label": label, "district": d["id"],
            "text": f"{d['name']}: {best['lq']:.1f}× Malaysia's share of workers", "basis": "estimate"}


# ------------------------------------------------------------------------------------------------ citizens
AGE_BANDS = {
    "child": ["0-4", "5-9", "10-14"],
    "young": ["15-19", "20-24", "25-29", "30-34"],
    "midlife": ["35-39", "40-44", "45-49", "50-54", "55-59", "60-64"],
    "elder": ["65-69", "70-74", "75-79", "80-84", "85+"],
}
BAND_ORDER = [b for bands in AGE_BANDS.values() for b in bands]
EDUCATION_LEVELS = {  # DOSM's heading -> the City View key (colours and phrases come from the text pack)
    "less_than_hs": "No formal education", "high_school": "Primary", "some_college": "Secondary", "bachelors": "Tertiary"}


def _g(key, label, icon, lines):
    return {"key": key, "label": label, "icon": icon, "lines": lines}


GROUPS = {
    "age": [
        _g("child", "Children (0-14)", "c-child", "population_district: ages 0 to 14"),
        _g("young", "Young adults (15-34)", "c-young", "population_district: ages 15 to 34"),
        _g("midlife", "Middle-aged (35-64)", "c-midlife", "population_district: ages 35 to 64"),
        _g("elder", "Elders (65+)", "c-elder", "population_district: ages 65 and over"),
    ],
    "education": [
        _g("less_than_hs", "No formal education", "c-edu0", "Labour force by state: no formal education"),
        _g("high_school", "Primary education", "c-edu1", "Labour force by state: primary"),
        _g("some_college", "Secondary education", "c-edu2", "Labour force by state: secondary"),
        _g("bachelors", "Tertiary education (diploma, certificate or degree)", "c-edu3", "Labour force by state: tertiary"),
    ],
}
ROWS = {
    "age": "Residents by age (DOSM mid-year estimate)",
    "education": "Labour force aged 15+ by highest education: each state's mix, applied to the city's labour force",
}
ROW_LABELS = {  # what the City View prints in place of its own wording for these rows
    "education": {"sub": "labour force 15+, state mix", "noun": ["person in the labour force", "people in the labour force"]},
}


def read_ages(source_dir, new_districts):
    """({(state, district): {band: people}}, {(state, district): women}, year) on the 160 boundary districts, from the
    latest year of population_district.csv. Only the ethnicity "overall" rows are read."""
    both, women, year = defaultdict(lambda: defaultdict(float)), defaultdict(float), 0
    with (source_dir / "population_district.csv").open(encoding="utf8") as f:
        rows = [r for r in csv.DictReader(f) if r["ethnicity"] == "overall" and r["age"] != "overall"]
    year = max(int(r["date"][:4]) for r in rows)
    for r in rows:
        if int(r["date"][:4]) != year:
            continue
        key = (r["state"], r["district"])
        parents = new_districts.get(key, {key: 1})
        total = sum(parents.values())
        for parent, weight in parents.items():
            if r["sex"] == "both":
                both[parent][r["age"]] += float(r["population"]) * 1000 * weight / total
            elif r["sex"] == "female":
                women[parent] += float(r["population"]) * 1000 * weight / total
    return both, women, year


def median_age(bands):
    """Median age from five-year bands, interpolated inside the band that holds the middle person (85+ taken as 85-99)."""
    total = sum(bands.values())
    seen = 0.0
    for b in BAND_ORDER:
        n = bands.get(b, 0)
        if seen + n >= total / 2 and n:
            lo = int(b.split("-")[0].rstrip("+"))
            width = 5 if "-" in b else 15
            return round(lo + width * (total / 2 - seen) / n, 1)
        seen += n
    return None


def age_row(bands, women):
    counts = {k: round(sum(bands.get(b, 0) for b in names)) for k, names in AGE_BANDS.items()}
    total = sum(counts.values())
    row = {"total": total, "counts": counts, "shares": {k: round(v / total, 3) for k, v in counts.items()},
           "figures": largest_remainder(counts, FIGURES["age"]), "median": median_age(bands)}
    if women is not None:
        row["female"] = round(women / total, 3)
    return row


def read_education(source_dir):
    """{state name or 'Malaysia': {key: people}} for EDUCATION_YEAR (the labour force, aged 15+)."""
    by = defaultdict(dict)
    with (source_dir / EDUCATION_FILE).open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if int(r["Year"]) == EDUCATION_YEAR:
                by[r["State"]][r["Educational attainment"]] = float(r["Value in Thousands"].replace(",", "")) * 1000
    out = {}
    for state, levels in by.items():
        name = "Malaysia" if state == "MALAYSIA" else EDUCATION_STATES[state]
        out[name] = {key: levels[heading] for key, heading in EDUCATION_LEVELS.items()}
    return out


def education_row(mix):
    """A citizens row from {key: people in the labour force}; `bachelors_plus` is left out on purpose: tertiary is
    diplomas and certificates too, so it is not the share with a degree the City View's chip would say."""
    counts = {k: round(v) for k, v in mix.items()}
    total = sum(counts.values())
    return {"total": total, "counts": counts, "shares": {k: round(v / total, 3) for k, v in counts.items()},
            "figures": largest_remainder(counts, 10)}


def citizens_doc(places, props, econ, city_of, new_districts, source_dir):
    """citizens.json: age (counted per district) and education (state mix on each district's labour force)."""
    ages, women, year = read_ages(source_dir, new_districts)
    education = read_education(source_dir)
    members = defaultdict(list)  # city id -> boundary district keys
    for i, cid in city_of.items():
        members[cid].append((props[i]["state"], props[i]["district"]))
    districts = econ.districts()

    nat_bands = defaultdict(float)
    for bands in ages.values():
        for b, n in bands.items():
            nat_bands[b] += n
    national = {"age": age_row(nat_bands, sum(women.values())), "education": education_row(education["Malaysia"]),
                "specialists": []}

    def city_row(keys):
        bands = defaultdict(float)
        for k in keys:
            for b, n in ages[k].items():
                bands[b] += n
        mix = defaultdict(float)
        for k in keys:
            state = education[k[0]]
            total_state = sum(state.values())
            for level, n in state.items():
                mix[level] += districts[k]["lf"] * n / total_state
        parts = {"age": age_row(bands, sum(women[k] for k in keys)), "education": education_row(mix)}
        # Only the age row can stand out: education is the state's mix, so it would present a state statistic as this
        # city's trait (and give a whole state the same chevrons).
        parts["specialists"] = specialists({"age": parts["age"]}, national)
        parts["reliable"] = True
        return parts

    cities = {c["id"]: city_row(members[c["id"]]) if members.get(c["id"]) else None for c in places}
    return {
        "version": 1, "vintage": f"DOSM {year} population estimates; labour force by education {EDUCATION_YEAR}",
        "year": year, "sources": ["dosm_population", SOURCE], "figures": {"age": FIGURES["age"], "education": 10},
        "rows": dict(ROWS), "row_labels": ROW_LABELS, "groups": GROUPS,
        "rule": {
            "specialist_high": SPECIALIST_HIGH, "specialist_low": SPECIALIST_LOW, "min_share": SPECIALIST_MIN_SHARE,
            "max_high": MAX_HIGH, "max_low": MAX_LOW,
            "text": f"Figures are rounded with the largest-remainder method so each row adds up exactly. A specialist is "
                    f"a category whose share is at least {SPECIALIST_HIGH:g}× or at most {SPECIALIST_LOW:g}× Malaysia's "
                    f"share (categories under {SPECIALIST_MIN_SHARE:.0%} both here and nationally are skipped); only the age row is compared, because the education row is the state's mix. Age: DOSM's "
                    f"{year} mid-year estimate for the districts of the city, in five-year bands (so children are 0-14, not "
                    f"under 18); the median age is interpolated inside its band. Education: DOSM publishes it by state "
                    f"only, so each district takes its state's {EDUCATION_YEAR} mix of the labour force (people aged 15 and "
                    f"over in work or looking for it, not all adults) and the city adds its districts' labour forces "
                    f"(2024 Labour Force Survey): within a state every city has the same mix. Not shown, because DOSM "
                    f"publishes no table for districts or states we could read: occupation, how people get to work and "
                    f"where they were born."},
        "national": national, "cities": cities,
    }
