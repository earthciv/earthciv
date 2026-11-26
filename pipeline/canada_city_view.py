"""City View data for the Canadian edition, from the 2021 Census through Statistics Canada's Web Data Service:

* districts.json: industry districts per CMA and CA, by the U.S. rule (pipeline/build/districts.py) with census counts
  in place of BLS QCEW. The census counts workers where they live (employed people aged 15+, table 98-10-0448,
  NAICS 2017), not where the jobs are, and it includes members of the Canadian Armed Forces.
* citizens.json: the citizen mix per CMA and CA, in the U.S. rows (pipeline/build/citizens.py): occupation (NOC 2021,
  98-10-0449), age (98-10-0020), how people get to work (98-10-0457, with those who worked at home from 98-10-0455),
  education of adults 25+ (98-10-0384) and generation status (98-10-0324).
* the cities.json fields the City View reads (ranks, peers, pop_series) and the resource sites on each city's hexes.

Every reply is cached under data/raw/canada/ and logged in the download manifest (canada_census._cached).
"""

from __future__ import annotations

import math
from collections import defaultdict

from . import canada_census as census
from .build.cities import PEERS
from .build.citizens import FIGURES, MAX_HIGH, MAX_LOW, MIN_SHARE as SPECIALIST_MIN_SHARE, SPECIALIST_HIGH, \
    SPECIALIST_LOW, largest_remainder, specialists
from .build.districts import BADGE_LQ, BADGE_SHARE, MAX_PER_CITY, MIN_JOBS, MIN_LQ, MIN_SHARE, SPECIALTY_JOBS, \
    SPECIALTY_LQ, SPECIALTY_SHARE, TOP_INDUSTRIES, badge_district, excess, lq, wet_cities

LEVELS = {0, 503, 504}  # Canada, CMAs, CAs
SOURCE = "statcan_census_city_view"
INDUSTRY_TABLE = "98100448"
CITIZEN_TABLES = ("98100449", "98100020", "98100457", "98100455", "98100384", "98100324")

# ------------------------------------------------------------------------------------------------ districts

ALL = [1, 2, 3, 5]  # (U.S. ownership codes: not used, the census has no ownership split)


def _d(id, name, color, naics, sub, badge, labels, description, caveat=None):
    return {"id": id, "name": name, "icon": "d-" + id.replace("_", "-"), "color": color, "naics": naics,
            "sub": sub, "badge": {"id": badge[0], "label": badge[1], "labels": labels},
            "description": description, "caveat": caveat}


# The U.S. catalog (same ids, names, colours and nicknames) in NAICS 2017 Canada codes. Differences: software
# publishers are 5112 (5132 in NAICS 2022); broadcasting is 515; the Industrial zone adds all of mining (21) and
# Canada's metal mining, potash, sawmill and pulp towns, and splits primary metals (331) into steel, aluminium and
# smelting, so a smelter town is not named after the whole subsector; public administration is split by level of government in
# Canada (911 federal, 912 provincial), so no ownership filter is needed, and 9111 Defence services (with Canadian Armed
# Forces members) is the Encampment.
CATALOG = [
    _d("campus", "Campus", "#4a7bd0", ["5417", "6113", "5415", "5112", "5182"],
       {"5417": "Research labs", "6113": "Universities", "5112": "Software", "5415": "Computer services",
        "5182": "Data centres & hosting"},
       ("scientific", "Knowledge city"),
       {"5417": "Research city", "6113": "College town", "5112": "Tech city", "5415": "Tech city", "5182": "Tech city"},
       "Science and technology: research labs, universities, software publishers, computer services and data hosting."),
    _d("commercial_hub", "Commercial hub", "#d0a23a", ["52"],
       {"5231": "Securities & brokerage", "524": "Insurance"},
       ("commercial", "Finance city"), {"5231": "Finance capital", "524": "Insurance city"},
       "Finance and insurance: banks, securities and commodity trading, insurers."),
    _d("industrial_zone", "Industrial zone", "#c2643a", ["31-33", "21"],
       {"3361": "Motor vehicles", "3344": "Semiconductors", "3254": "Pharmaceuticals", "3241": "Oil refining",
        "3311": "Iron & steel", "3313": "Aluminium", "3314": "Metal smelting", "211": "Oil & gas", "2121": "Coal mining",
        "2122": "Metal mining", "2123": "Potash & other minerals", "3211": "Sawmills", "3221": "Pulp & paper"},
       ("industrial", "Factory town"),
       {"3361": "Motor city", "3344": "Silicon city", "3254": "Pharma city", "3241": "Refinery town",
        "3311": "Steel town", "3313": "Aluminium town", "3314": "Smelter town", "211": "Oil town", "2121": "Coal town",
        "2122": "Mining town", "2123": "Mining town", "3211": "Mill town", "3221": "Paper town"},
       "Manufacturing plus mining, quarrying and oil and gas extraction."),
    _d("harbor", "Harbor", "#2f8fb0", ["483", "4883"],
       {"483": "Shipping lines", "4883": "Port services"},
       ("maritime", "Port city"), {"483": "Port city", "4883": "Port city"},
       "Water transport: shipping lines, ferries, and port and harbour services.",
       "Only for cities with a hex on or next to water or a mapped river."),
    _d("theater_square", "Theater square", "#a15bc4", ["711", "512", "515"],
       {"711": "Performing arts & sports", "512": "Film & recording", "515": "Broadcasting"},
       ("cultural", "Arts city"), {"711": "Arts city", "512": "Film capital", "515": "Media city"},
       "Culture and media: theatres, orchestras, spectator sports, film and music studios, broadcasters."),
    _d("entertainment_complex", "Entertainment complex", "#d0508a", ["713", "721"],
       {"7132": "Casinos", "713": "Amusement & recreation", "721": "Hotels & resorts"},
       ("entertainment", "Resort city"), {"7132": "Casino city", "713": "Resort city", "721": "Resort city"},
       "Leisure: amusement parks, casinos, golf, ski and fitness, plus hotels, resorts and camps."),
    _d("aerodrome", "Aerodrome", "#6a8fb8", ["481", "4881", "3364"],
       {"481": "Airlines", "4881": "Airport services", "3364": "Aerospace"},
       ("aviation", "Air hub"), {"481": "Air hub", "4881": "Air hub", "3364": "Aerospace city"},
       "Aviation: airlines, airport services and aerospace manufacturing."),
    _d("government_plaza", "Government plaza", "#8a9a5b", ["9112-9119", "912"],
       {"9112-9119": "Federal government", "912": "Provincial government"},
       ("governmental", "Government town"), {"9112-9119": "Government town", "912": "Government town"},
       "Federal (except defence) and provincial or territorial public administration. Local and Indigenous "
       "governments are in every region and are left out.",
       "Public universities, colleges and hospitals are not public administration (they count in Campus)."),
    _d("encampment", "Encampment", "#8a4a3a", ["9111"],
       {"9111": "Defence services"},
       ("militaristic", "Military town"), {"9111": "Military town"},
       "Defence services: members of the Canadian Armed Forces and civilian defence staff.",
       "Counted where they live, and only those in private households (the census long form leaves out barracks)."),
    _d("aqueduct", "Aqueduct & dam", "#3aa0a0", ["22"],
       {"2211": "Power utilities", "2213": "Water & sewer"},
       ("utility", "Utility town"), {"2211": "Power town", "2213": "Waterworks town"},
       "Utilities: electric power generation and distribution, water, sewage and gas."),
]
BY_ID = {d["id"]: d for d in CATALOG}
CODES = list(dict.fromkeys(c for d in CATALOG for c in [*d["naics"], *d["sub"]]))
BROAD = {"52", "31-33", "21", "22"}  # sector totals: summed for districts, left out of the "most specialised" list

# Provincial and territorial capitals (the principal city of their CMA or CA); Iqaluit is not a census agglomeration.
PROVINCIAL_CAPITALS = {("Victoria", "BC"), ("Edmonton", "AB"), ("Regina", "SK"), ("Winnipeg", "MB"), ("Toronto", "ON"),
                       ("Québec", "QC"), ("Fredericton", "NB"), ("Halifax", "NS"), ("Charlottetown", "PE"),
                       ("St. John's", "NL"), ("Whitehorse", "YT"), ("Yellowknife", "NT")}

RULE_TEXT = (
    f"A district appears when the workers in its industries have a location quotient (the city's share of workers in "
    f"them divided by Canada's share) of at least {MIN_LQ:g} and number at least {MIN_JOBS:,} or {MIN_SHARE:.0%} of the "
    f"city's workers, or when one of its listed specialities has a location quotient of at least {SPECIALTY_LQ:g} with "
    f"at least {SPECIALTY_JOBS:,} workers or {SPECIALTY_SHARE:.1%} of the city's workers (and never fewer than "
    f"{MIN_JOBS:,}). Districts are ranked by how many workers they have above the national norm (workers minus workers "
    f"divided by the quotient); up to {MAX_PER_CITY} per city. A Harbor also needs a hex on or next to water or a mapped "
    f"river. The city type is named after the strongest district, or after a listed district with a quotient of at "
    f"least {BADGE_LQ:g} and at least {BADGE_SHARE:.0%} of the city's workers when there is one, and labelled by its "
    f"speciality when one passes; 'Capital city' goes only to Ottawa – Gatineau and 'Seat of government' only to a "
    f"provincial or territorial capital. These are the U.S. edition's rules, applied to 2021 Census counts of employed "
    f"residents (table 98-10-0448) in place of jobs counted at employers."
)


def _code_members(meta, position):
    """{code: (member id, title)} for a classification dimension whose member names start with their code."""
    out = {}
    for m in meta["dimension"][position - 1]["member"]:
        code, _, title = " ".join(m["memberNameEn"].split()).partition(" ")
        out.setdefault(code, (m["memberId"], title))
    return out


def industry_detail():
    """({DGUID: {code: employed, 'all': employed}}, {code: title}) for Canada, CMAs and CAs from 98-10-0448."""
    meta = census.metadata(INDUSTRY_TABLE)
    geos = census.geographies(meta, LEVELS)
    employed = census.member(meta, 2, "Employed")
    members = _code_members(meta, 6)
    missing = [c for c in CODES if c not in members]
    if missing:
        raise ValueError(f"98-10-0448 has no industry members {missing}")
    total = census.member(meta, 6, "All industries")
    cell = lambda gid, industry: census.coordinate(gid, employed, 1, 1, 1, industry, 1)  # totals: age, gender, count, class
    coords = [cell(gid, ind) for gid, _ in geos for ind in [total] + [members[c][0] for c in CODES]]
    values = census.series(INDUSTRY_TABLE, coords, "employed people aged 15+ by detailed NAICS industry",
                           name=f"{INDUSTRY_TABLE}-detail.json")
    out = {}
    for gid, dguid in geos:
        row = {c: values.get(cell(gid, members[c][0])) for c in CODES}
        row["all"] = values.get(cell(gid, total))
        out[dguid] = row
    return out, {c: members[c][1] for c in CODES}


def _sum(row, codes):
    vals = [row.get(c) for c in codes]
    return None if any(v is None for v in vals) else sum(vals)


def evaluate(row, nat, wet):
    """Every district that passes the rule for one city's counts, strongest first (at most MAX_PER_CITY)."""
    total, nat_total = row.get("all"), nat["all"]
    out = []
    if not total:
        return out
    for d in CATALOG:
        if d["id"] == "harbor" and not wet:
            continue
        emp = _sum(row, d["naics"])
        if emp is None:
            continue
        dlq = lq(emp, total, _sum(nat, d["naics"]), nat_total)
        share = emp / total
        broad = dlq is not None and dlq >= MIN_LQ and (emp >= MIN_JOBS or share >= MIN_SHARE)
        subs = []
        for code in d["sub"]:
            s = row.get(code)
            if s is None or s < MIN_JOBS:
                continue
            slq = lq(s, total, nat.get(code), nat_total)
            if slq is not None and slq > 1:
                subs.append((code, slq, s, excess(s, slq)))
        special = [x for x in subs if x[1] >= SPECIALTY_LQ and (x[2] >= SPECIALTY_JOBS or x[2] >= SPECIALTY_SHARE * total)]
        best = max(special or subs, key=lambda x: x[3], default=None)
        if not (broad or special):
            continue
        strength = max(excess(emp, dlq) if broad else 0, best[3] if special else 0)
        out.append({
            "id": d["id"], "lq": round(dlq, 2) if dlq is not None else None, "emp": int(emp), "share": round(share, 4),
            "avg_pay": None, "sub": best[0] if best else None, "sub_lq": round(best[1], 2) if best else None,
            "sub_emp": int(best[2]) if best else None, "sub_lower_bound": False if best else None,
            "via": "broad" if broad else "specialty", "strength": round(strength), "suppressed": 0, "lower_bound": False,
        })
    out.sort(key=lambda r: -r["strength"])
    return out[:MAX_PER_CITY]


def badge_for(best, capital, provincial_capital):
    if not best:
        return None
    d = BY_ID[best["id"]]
    sub = best["sub"]
    use_sub = sub is not None and best["sub_lq"] is not None and best["sub_lq"] >= SPECIALTY_LQ
    label = d["badge"]["labels"].get(sub, d["badge"]["label"]) if use_sub else d["badge"]["label"]
    if capital and d["id"] == "government_plaza":
        label = "Capital city"
    elif d["id"] == "government_plaza" and use_sub and sub == "912" and provincial_capital:
        label = "Seat of government"
    if use_sub:
        text = f"{d['sub'][sub]}: {best['sub_lq']:.1f}× Canada's share of workers"
    else:
        text = f"{d['name']}: {best['lq']:.1f}× Canada's share of workers"
    return {"id": d["badge"]["id"], "label": label, "district": d["id"], "text": text, "basis": "census"}


def districts_doc(places, dguid_of, grid, water, rivers):
    detail, titles = industry_detail()
    nat = detail[census.CANADA]
    wet = wet_cities(places, {"grid": grid.to_dict(), "water": water}, {"rivers": rivers})
    cities = {}
    for c in places:
        row = detail.get(dguid_of[c["id"]])
        if not row or not row.get("all"):
            cities[c["id"]] = None
            continue
        total = row["all"]
        top = []
        for code in CODES:
            emp = row.get(code)
            if code in BROAD or emp is None or emp < MIN_JOBS:
                continue
            q = lq(emp, total, nat.get(code), nat["all"])
            if q is not None:
                top.append({"naics": code, "emp": int(emp), "lq": round(q, 2), "avg_pay": None, "oty_pct": None,
                            "suppressed": 0, "lower_bound": False})
        top.sort(key=lambda r: -r["lq"])
        dists = evaluate(row, nat, c["id"] in wet)
        provincial = (c["name"], c["states"][0]) in PROVINCIAL_CAPITALS
        cities[c["id"]] = {"emp": int(total), "avg_pay": None, "counties": None, "top": top[:TOP_INDUSTRIES],
                           "districts": dists, "badge": badge_for(badge_district(dists), c.get("capital"), provincial)}
    return {
        "version": 1, "vintage": "2021 Census of Population", "year": 2021, "sources": [SOURCE],
        "rule": {"min_lq": MIN_LQ, "min_jobs": MIN_JOBS, "min_share": MIN_SHARE, "specialty_lq": SPECIALTY_LQ,
                 "specialty_jobs": SPECIALTY_JOBS, "specialty_share": SPECIALTY_SHARE, "max_per_city": MAX_PER_CITY,
                 "harbor_needs_water": True, "badge_lq": BADGE_LQ, "badge_share": BADGE_SHARE, "text": RULE_TEXT,
                 "county_note": "Census divisions get no districts in the Canadian edition.",
                 # The Encampment is the census's Defence services (catalog), so the City View adds none from military.json.
                 "military_encampments": False,
                 # What `emp` counts: employed residents, where they live (the U.S. file counts jobs at the employer).
                 "counts": "workers"},
        "catalog": CATALOG,
        "industries": {c: {"title": titles[c], "national_emp": nat.get(c)} for c in CODES},
        "national": {"emp": int(nat["all"]), "avg_pay": None},
        "cities": cities,
        "counties": {},
    }


# ------------------------------------------------------------------------------------------------ citizens

# NOC 2021 groups in the U.S. citizen categories (major groups, split by sub-major group where the U.S. categories cut
# across them). Every employed person with an occupation lands in exactly one category.
OCCUPATIONS = {
    "executive": ["00", "10", "11", "20", "30", "40", "50", "60", "70", "80", "90"],
    "engineer": ["21", "22"],
    "scholar": ["41", "422", "431", "51", "52", "53", "54", "55"],
    "healer": ["31", "32", "33"],
    "service": ["421", "432", "441", "442", "451", "622", "632", "642", "643", "652", "653"],
    "clerk": ["12", "13", "14", "620", "621", "631", "641", "644", "651"],
    "farmer": ["82", "83", "84", "85"],
    "builder": ["720", "721", "722", "723", "724", "725", "729", "731", "732", "734"],
    "maker": ["726", "733", "741", "742", "751", "752", "92", "93", "94", "95"],
}
AGES = {
    "child": ["0 to 14 years", "15", "16", "17"],
    "young": ["18", "19", "20 to 24 years", "25 to 29 years", "30 to 34 years"],
    "midlife": ["35 to 39 years", "40 to 44 years", "45 to 49 years", "50 to 54 years", "55 to 59 years", "60 to 64 years"],
    "elder": ["65 years and over"],
}
MODES = {
    "drove_alone": ["Driver (only worker in vehicle)"],
    "carpool": ["Driver with 1 passenger", "Driver with 2 or more passengers", "Car, truck or van - as a passenger"],
    "transit": ["Public transit"],
    "walk": ["Walked"],
    "other": ["Bicycle", "Motorcycle, scooter or moped", "Other method"],
}
EDUCATION = {
    "less_than_hs": ["No certificate, diploma or degree"],
    "high_school": ["High (secondary) school diploma or equivalency certificate"],
    "some_college": ["Apprenticeship or trades certificate or diploma",
                     "College, CEGEP or other non-university certificate or diploma",
                     "University certificate or diploma below bachelor level"],
    "bachelors": ["Bachelor's degree"],
    "graduate": ["University certificate or diploma above bachelor level",
                 "Degree in medicine, dentistry, veterinary medicine or optometry", "Master's degree", "Earned doctorate"],
}
GENERATIONS = {"third_plus": "Third generation or more", "second": "Second generation", "first": "First generation"}


def _g(key, label, icon, lines):
    return {"key": key, "label": label, "icon": icon, "lines": lines}


GROUPS = {
    "workforce": [
        _g("executive", "Managers and business & finance professionals", "c-executive", "NOC 00, 10, 11 and every x0 management group"),
        _g("engineer", "Engineers, coders & scientists", "c-engineer", "NOC 21, 22"),
        _g("scholar", "Teachers, lawyers, artists & media", "c-scholar", "NOC 41, 422, 431, 51-55"),
        _g("healer", "Health workers", "c-healer", "NOC 31, 32, 33"),
        _g("service", "Service workers (food, cleaning, care, protection)", "c-service",
           "NOC 421, 432, 441, 442, 451, 622, 632, 642, 643, 652, 653"),
        _g("clerk", "Sales & office workers", "c-clerk", "NOC 12, 13, 14, 620, 621, 631, 641, 644, 651"),
        _g("farmer", "Farm & natural-resource workers (incl. mining)", "c-farmer", "NOC 82, 83, 84, 85"),
        _g("builder", "Trades: builders & repairers", "c-builder", "NOC 720-725, 729, 731, 732, 734"),
        _g("maker", "Factory, transport & warehouse workers", "c-maker", "NOC 726, 733, 741, 742, 751, 752, 92-95"),
    ],
    "age": [
        _g("child", "Children (under 18)", "c-child", "98-10-0020: 0 to 17"),
        _g("young", "Young adults (18-34)", "c-young", "98-10-0020: 18 to 34"),
        _g("midlife", "Middle-aged (35-64)", "c-midlife", "98-10-0020: 35 to 64"),
        _g("elder", "Elders (65+)", "c-elder", "98-10-0020: 65 and over"),
    ],
    "commute": [
        _g("drove_alone", "Drive alone", "c-car", "98-10-0457: driver, only worker in vehicle"),
        _g("carpool", "Carpool", "c-carpool", "98-10-0457: driver with passengers, and passengers"),
        _g("transit", "Public transit", "c-transit", "98-10-0457: public transit"),
        _g("walk", "Walk", "c-walk", "98-10-0457: walked"),
        _g("other", "Bike, motorcycle & other", "c-bike", "98-10-0457: bicycle, motorcycle, scooter or moped, other"),
        _g("home", "Work from home", "c-home", "98-10-0455: worked at home"),
    ],
    "education": [
        _g("less_than_hs", "No certificate, diploma or degree", "c-edu0", "98-10-0384"),
        _g("high_school", "High school diploma", "c-edu1", "98-10-0384"),
        _g("some_college", "Trades, college or CEGEP (below a bachelor's)", "c-edu2", "98-10-0384"),
        _g("bachelors", "Bachelor's degree", "c-edu3", "98-10-0384"),
        _g("graduate", "Master's, doctorate, medicine or other above a bachelor's", "c-edu4", "98-10-0384"),
    ],
    "nativity": [
        _g("third_plus", "Born in Canada to parents born in Canada", "c-local", "98-10-0324: third generation or more"),
        _g("second", "Born in Canada, with a parent born abroad", "c-abroad", "98-10-0324: second generation"),
        _g("first", "Born outside Canada", "c-immigrant", "98-10-0324: first generation"),
    ],
}
ROWS = {
    "workforce": "Employed people 15+ by occupation (NOC 2021)",
    "age": "Residents by age",
    "commute": "Employed people 15+ by how they got to work, and those who worked at home",
    "education": "Adults 25+ by highest certificate, diploma or degree",
    "nativity": "Residents by generation status (where they and their parents were born)",
}


def _fetch(pid, cells, label, name=None):
    """{(DGUID, key): (sum of the published cells or None, how many cells were suppressed)} for {key: [WDS
    coordinate builder(gid)]} over Canada, CMAs and CAs. Statistics Canada suppresses small cells for confidentiality."""
    meta = census.metadata(pid)
    geos = census.geographies(meta, LEVELS)
    plan = {(dguid, key): [build(gid) for build in builders] for gid, dguid in geos for key, builders in cells(meta).items()}
    coords = list(dict.fromkeys(c for cs in plan.values() for c in cs))
    values = census.series(pid, coords, label, name=name)
    out = {}
    for k, cs in plan.items():
        known = [values[c] for c in cs if values.get(c) is not None]
        out[k] = (sum(known) if known else None, len(cs) - len(known))
    return out


def citizen_counts():
    """({DGUID: {row: {key: (count, suppressed cells), '_total': (table total, …)}}}, {DGUID: median age}) for Canada,
    CMAs and CAs. Each row's published total comes in a second, small request (its own cache file)."""
    rows = defaultdict(dict)

    def occupations(meta):
        occ, employed = _code_members(meta, 5), census.member(meta, 6, "Employed")
        return {k: [lambda gid, o=occ[c][0]: census.coordinate(gid, 1, 1, 1, o, employed) for c in codes]
                for k, codes in OCCUPATIONS.items()}

    def occupations_total(meta):
        total, employed = census.member(meta, 5, "All occupations"), census.member(meta, 6, "Employed")
        return {"_total": [lambda gid: census.coordinate(gid, 1, 1, 1, total, employed)]}

    def ages(meta):
        y, a = census.member(meta, 2, "2021"), lambda name: census.member(meta, 3, name)
        cells = {k: [lambda gid, m=a(n): census.coordinate(gid, y, m, 1) for n in names] for k, names in AGES.items()}
        cells["median"] = [lambda gid, m=a("Median age"): census.coordinate(gid, y, m, 1)]
        return cells

    def ages_total(meta):
        y, total = census.member(meta, 2, "2021"), census.member(meta, 3, "Total - Age")
        return {"_total": [lambda gid: census.coordinate(gid, y, total, 1)]}

    def modes(meta):
        count, mode = census.member(meta, 5, "Count"), lambda name: census.member(meta, 6, name)
        return {k: [lambda gid, m=mode(n): census.coordinate(gid, 1, 1, 1, count, m, 1) for n in names]
                for k, names in MODES.items()}

    def modes_total(meta):
        count, total = census.member(meta, 5, "Count"), census.member(meta, 6, "Total - Main mode of commuting")
        return {"_commuters": [lambda gid: census.coordinate(gid, 1, 1, 1, count, total, 1)]}

    def home(meta):
        count, at_home = census.member(meta, 5, "Count"), census.member(meta, 7, "Worked at home")
        return {"home": [lambda gid: census.coordinate(gid, 1, 1, 1, count, 1, at_home)]}

    def _adults(meta):
        return census.member(meta, 2, "Count"), census.member(meta, 6, "2021"), [
            census.member(meta, 3, "25 to 64 years"), census.member(meta, 3, "65 years and over")]

    def education(meta):
        count, y, adults = _adults(meta)
        cert = lambda name: census.member(meta, 5, name)
        return {k: [lambda gid, a=a, m=cert(n): census.coordinate(gid, count, a, 1, m, y) for n in names for a in adults]
                for k, names in EDUCATION.items()}

    def education_total(meta):
        count, y, adults = _adults(meta)
        total = census.member(meta, 5, "Total - Highest certificate, diploma or degree")
        return {"_total": [lambda gid, a=a: census.coordinate(gid, count, a, 1, total, y) for a in adults]}

    def generations(meta):
        count = census.member(meta, 4, "Count")
        return {k: [lambda gid, g=census.member(meta, 2, name): census.coordinate(gid, g, 1, count, 1, 1)]
                for k, name in GENERATIONS.items()}

    def generations_total(meta):
        count, total = census.member(meta, 4, "Count"), census.member(meta, 2, "Total - Generation status")
        return {"_total": [lambda gid: census.coordinate(gid, total, 1, count, 1, 1)]}

    medians = {}
    for pid, row, cells, label, name in (
            ("98100449", "workforce", occupations, "employed people aged 15+ by NOC 2021 occupation group", None),
            ("98100449", "workforce", occupations_total, "employed people aged 15+, all occupations", "98100449-totals.json"),
            ("98100020", "age", ages, "population by age, and median age", None),
            ("98100020", "age", ages_total, "population, all ages", "98100020-totals.json"),
            ("98100457", "commute", modes, "employed people aged 15+ by main mode of commuting", None),
            ("98100457", "commute", modes_total, "commuters, all modes", "98100457-totals.json"),
            ("98100455", "commute", home, "employed people aged 15+ who worked at home", None),
            ("98100384", "education", education, "people aged 25 and over by highest certificate, diploma or degree", None),
            ("98100384", "education", education_total, "people aged 25 and over", "98100384-totals.json"),
            ("98100324", "nativity", generations, "population by generation status", None),
            ("98100324", "nativity", generations_total, "population, all generation statuses", "98100324-totals.json")):
        for (dguid, key), v in _fetch(pid, cells, label, name).items():
            if key == "median":
                medians[dguid] = v[0]
            else:
                rows[dguid].setdefault(row, {})[key] = v
    for counts in rows.values():  # the commute total: commuters by every mode, plus those who worked at home
        c = counts.get("commute", {})
        commuters, home_ = c.pop("_commuters", (None, 0)), c.get("home", (None, 0))
        c["_total"] = (commuters[0] + home_[0] if commuters[0] is not None and home_[0] is not None else None, 0)
    return rows, medians


SUPPRESSED_MAX = 0.03  # suppressed cells may add up to at most this share of a row's published total


def citizen_row(counts, name, median=None):
    """One citizens.json row (the U.S. shape) from {key: (count, suppressed cells)}. Cells Statistics Canada suppressed
    for confidentiality (small counts) count as 0, but the row is left out (None) when the published total exceeds
    the sum of the published cells by more than SUPPRESSED_MAX, or when that total is missing."""
    keys = [g["key"] for g in GROUPS[name]]
    if not counts or any(k not in counts for k in keys):
        return None
    vals = {k: round(counts[k][0] or 0) for k in keys}
    suppressed = sum(counts[k][1] for k in keys)
    total = sum(vals.values())
    published = (counts.get("_total") or (None, 0))[0]
    if total <= 0 or (suppressed and (not published or published - total > SUPPRESSED_MAX * published)):
        return None
    out = {"total": total, "counts": vals, "shares": {k: round(v / total, 3) for k, v in vals.items()}}
    if suppressed:
        out["suppressed"] = suppressed
    if name in FIGURES:
        out["figures"] = largest_remainder(vals, FIGURES[name])
    if name == "age":
        out["median"] = round(median, 1) if median is not None else None
    if name == "education":
        out["bachelors_plus"] = round((vals["bachelors"] + vals["graduate"]) / total, 4)
    if name == "nativity":
        out["foreign_born"] = out["shares"]["first"]
    return out


def full_row(counts, median, national):
    parts = {name: citizen_row(counts.get(name), name, median) for name in GROUPS}
    if all(v is None for v in parts.values()):
        return None
    parts["specialists"] = specialists(parts, national) if national is not None else []
    parts["reliable"] = True  # the 2021 long-form census reached a quarter of households in every area
    return parts


def citizens_doc(places, dguid_of):
    counts, medians = citizen_counts()
    national = full_row(counts[census.CANADA], medians.get(census.CANADA), None)
    if national is None:
        raise ValueError("the citizen tables have no row for Canada")
    national.pop("reliable", None)
    national["specialists"] = []
    cities = {c["id"]: full_row(counts.get(dguid_of[c["id"]], {}), medians.get(dguid_of[c["id"]]), national)
              for c in places}
    return {
        "version": 1, "vintage": "2021 Census of Population", "year": 2021, "sources": [SOURCE],
        "figures": dict(FIGURES), "rows": dict(ROWS), "groups": GROUPS,
        "rule": {
            "specialist_high": SPECIALIST_HIGH, "specialist_low": SPECIALIST_LOW, "min_share": SPECIALIST_MIN_SHARE,
            "max_high": MAX_HIGH, "max_low": MAX_LOW,
            "text": f"Figures are rounded with the largest-remainder method so each row adds up exactly. A specialist is "
                    f"a category whose share is at least {SPECIALIST_HIGH:g}× or at most {SPECIALIST_LOW:g}× Canada's "
                    f"share (categories under {SPECIALIST_MIN_SHARE:.0%} both here and nationally are skipped); up to "
                    f"{MAX_HIGH} over- and {MAX_LOW} under-represented are listed. Small cells Statistics Canada suppresses for "
                    f"confidentiality count as 0; a row is left out when they could add up to more than "
                    f"{SUPPRESSED_MAX:.0%} of its published total. The census week, in May 2021, fell "
                    f"during COVID-19 restrictions, so many more people worked from home than usual. Commute shares are "
                    f"of workers, not of all residents.",
        },
        "national": national,
        "cities": cities,
    }


# ------------------------------------------------------------------------------------------------ cities.json fields

RANK_KEYS = ["population", "gdp", "gdp_per_capita", "growth", "food", "production", "gold", "science", "culture"]


def add_ranks(places):
    """ranks (1 = highest, null where the value is null) and peers (the PEERS cities closest in population), as the
    U.S. build/cities.py add_ranks. GDP per person divides by the population of the GDP year."""
    def value(c, key):
        if key == "gdp_per_capita":
            return c["gdp"] / c["gdp_population"] if c.get("gdp") is not None and c.get("gdp_population") else None
        if key in ("population", "gdp", "growth"):
            return c.get(key)
        return (c.get("yields") or {}).get(key)

    for c in places:
        c["ranks"] = {}
    for key in RANK_KEYS:
        have = sorted((c for c in places if value(c, key) is not None), key=lambda c: -value(c, key))
        for r, c in enumerate(have, 1):
            c["ranks"][key] = r
        for c in places:
            c["ranks"].setdefault(key, None)
    for i, c in enumerate(places):
        lp = math.log(c["population"])
        near = sorted((abs(math.log(o["population"]) - lp), j) for j, o in enumerate(places) if j != i)
        c["peers"] = [places[j]["id"] for _, j in near[:PEERS]]


def add_pop_series(places, estimates, dguid_of):
    """pop_series: {year: July 1 estimate} from 2021 to the latest year (the U.S. Census population estimates)."""
    for c in places:
        series = estimates.get(dguid_of[c["id"]]) or {}
        c["pop_series"] = {str(y): series[y] for y in sorted(series)} or None


def tag_resources(items, places):
    """A resource site's `cbsa` is the city whose hexes hold it (the bigger city where two cities' hexes overlap)."""
    owner = {}
    for c in places:  # biggest first
        for cell in c.get("footprint") or []:
            owner.setdefault(cell, c["id"])
    for item in items:
        item["cbsa"] = owner.get(item.get("cell"))


def files():
    """The source's files in data/raw/canada/ (Web Data Service replies, logged in the download manifest)."""
    return [f"{INDUSTRY_TABLE}-meta.json", f"{INDUSTRY_TABLE}-detail.json"] + [
        f"{pid}{part}.json" for pid in CITIZEN_TABLES for part in ("-meta", "")] + [
        f"{pid}-totals.json" for pid in CITIZEN_TABLES if pid != "98100455"]
