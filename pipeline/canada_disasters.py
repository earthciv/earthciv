"""Disasters for the Canadian edition's Culture advisor: the Canadian Disaster Database (Public Safety Canada), the
U.S. edition's FEMA declarations and NOAA billion-dollar events counterpart.

Natural disasters that began from 1980 (NOAA's first year) to the database's last event: meteorological, hydrological
and geological events in Canada. Epidemics are left out, as FEMA leaves out COVID-19, and so are events abroad. A cost is
the database's estimated total cost, or where it gives none, the sum of the payments it records (a lower bound), moved to
the latest year's dollars with Statistics Canada's annual CPI (as NOAA adjusts its costs). A province's cost is its equal
share of each event that touched it, NOAA's rule, so provinces must not be summed.
"""

from __future__ import annotations

import datetime
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

from . import canada_census as census

CDD_FILE = "cdd-extract.xlsx"
CPI_TABLE = "18100005"
FIRST_YEAR = 1980
# The U.S. edition's disaster groups (FEMA incident types) over the database's event types.
TYPES = [
    ("hurricane", "Hurricanes & tropical storms", ("HU",)),
    ("flood", "Floods, storm surges & landslides", ("FL", "SS", "LS")),
    ("fire", "Wildfires", ("WF",)),
    ("severe_storm", "Severe storms & tornadoes", ("ST", "TO", "SO")),
    ("winter", "Winter storms, cold & avalanches", ("SW", "CE", "AV")),
    ("other", "Drought, heat, earthquakes & other", ("DR", "HE", "EQ", "TS", "GS", "VO")),
]
GROUP = {code: key for key, _, codes in TYPES for code in codes}
PAYMENTS = ("OGD_COSTS", "MUNICIPAL_COSTS", "FED_DFAA_PAYMENTS", "PROV_DFAA_PAYMENTS", "PROV_DEPT_PAYMENTS",
            "INSURANCE_PAYMENTS", "NGO_PAYMENTS")
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_xlsx(path):
    """The first sheet of an .xlsx as a list of {header: text} rows (shared and inline strings, numbers as text)."""
    with zipfile.ZipFile(path) as z:
        shared = [] if "xl/sharedStrings.xml" not in z.namelist() else [
            "".join(t.text or "" for t in si.iter(f"{MAIN}t"))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{MAIN}si")]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(f"{MAIN}row"):
        cells = {}
        for c in row.findall(f"{MAIN}c"):
            column = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                column = column * 26 + ord(ch) - 64
            v, kind = c.find(f"{MAIN}v"), c.get("t")
            if kind == "s":
                cells[column - 1] = shared[int(v.text)] if v is not None else None
            elif kind == "inlineStr":
                cells[column - 1] = "".join(t.text or "" for t in c.iter(f"{MAIN}t"))
            else:
                cells[column - 1] = v.text if v is not None else None
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:] if any(r)]


def number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None  # "NULL" and blanks


def excel_date(text):
    days = number(text)
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=days) if days is not None else None


def cpi():
    """{year: annual average CPI, all items, Canada} from table 18-10-0005-01."""
    meta = census.metadata(CPI_TABLE)
    cell = census.coordinate(census.member(meta, 1, "Canada"), census.member(meta, 2, "All-items"))
    years = int(meta["cubeEndDate"][:4]) - int(meta["cubeStartDate"][:4]) + 1
    values = census.history(CPI_TABLE, [cell], "consumer price index, all items, Canada", years)[cell]
    return {int(y): v for y, v in values.items() if v is not None}


def disasters_doc(path, provinces):
    """disasters.json for the Canadian edition: {"version", "vintage", "sources", "cdd": {...}}."""
    rows = read_xlsx(path)
    prices = cpi()
    base = max(prices)
    province_column = next(k for k in rows[0] if k.startswith("PROVINCES_AFFECTED"))
    events = []
    for r in rows:
        if r.get("EVENT_GROUP_NAME") != "Natural" or r.get("EVENT_TYPE") not in GROUP:
            continue  # technology and conflict incidents, and epidemics (biological)
        start = excel_date(r["EVENT_START_DATE"])
        where = [p for p in (r.get(province_column) or "").split() if p in provinces]
        if start is None or start.year < FIRST_YEAR or not where:
            continue  # before the window, or abroad only ("IN")
        total = number(r["TOTAL_COST"])
        paid = [v for k in PAYMENTS if (v := number(r.get(k))) is not None]
        cost = total if total is not None else sum(paid) if paid else None
        events.append(dict(
            id=int(r["EVENT_ID"]), type=GROUP[r["EVENT_TYPE"]], kind=r["EVENT_TYPE_DESCRIPTION"], date=start.isoformat(),
            place=" ".join((r.get("PLACE") or "").split()), provinces=where, deaths=number(r["DEAD"]),
            evacuated=number(r["EVACUATED"]), cost=round(cost * prices[base] / prices[start.year]) if cost else None,
            cost_estimated=total is not None))
    last = max(e["date"] for e in events)
    years = [FIRST_YEAR, int(last[:4])]
    by_province = defaultdict(lambda: dict(events=0, deaths=0, count=Counter(), cost_cad=Counter()))
    for e in events:
        for p in e["provinces"]:
            row = by_province[p]
            row["events"] += 1
            row["count"][e["type"]] += 1
            if e["cost"]:
                row["cost_cad"][e["type"]] += e["cost"] / len(e["provinces"])
    by_year = defaultdict(lambda: dict(events=0, cost_cad=0))
    for e in events:
        y = by_year[int(e["date"][:4])]
        y["events"] += 1
        y["cost_cad"] += e["cost"] or 0
    keys = [key for key, _, _ in TYPES]

    def named(e):
        month = datetime.date.fromisoformat(e["date"]).strftime("%B %Y")
        return f"{e['kind']}: {e['place']} ({month})"

    costliest = sorted((e for e in events if e["cost"]), key=lambda e: -e["cost"])[:10]
    return dict(
        version=1,
        vintage=dict(cdd=f"Canadian Disaster Database, events to {last}",
                     cpi=f"Statistics Canada CPI, {base} dollars"),
        sources=["ps_cdd", "statcan_cpi"],
        cdd=dict(
            years=years, last_event=last, unit=f"{base} dollars, CPI-adjusted",
            rule=f"Natural disasters in the Canadian Disaster Database that began {years[0]}–{years[1]} in Canada: "
                 "meteorological, hydrological and geological events (epidemics and events abroad are left out). Public "
                 "Safety Canada records the events that meet its criteria (deaths, people affected or evacuated, calls "
                 "for help, historical significance or major damage). A cost is the database's estimated total, or the "
                 f"sum of the payments it records where it gives none (a lower bound), in {base} dollars (Statistics "
                 "Canada CPI). A province's cost is its share of the events that touched it; events span provinces, "
                 "so never sum provinces.",
            types=[dict(id=key, name=name, event_types=list(codes)) for key, name, codes in TYPES],
            provinces={p: dict(events=v["events"], count={k: v["count"][k] for k in keys},
                               cost_cad={k: round(v["cost_cad"][k]) for k in keys})
                       for p, v in sorted(by_province.items())},
            national=dict(
                events=len(events), cost_cad=round(sum(e["cost"] or 0 for e in events)),
                deaths=round(sum(e["deaths"] or 0 for e in events)),
                by_type={k: sum(1 for e in events if e["type"] == k) for k in keys},
                by_year=[dict(year=y, **by_year[y]) for y in range(years[0], years[1] + 1)],
                costliest=[dict(name=named(e), type=e["type"], begin=e["date"], cost_cad=e["cost"],
                                deaths=round(e["deaths"]) if e["deaths"] is not None else None,
                                provinces=e["provinces"], estimated=e["cost_estimated"]) for e in costliest],
            ),
            recent=[dict(id=e["id"], date=e["date"], type=e["type"], kind=e["kind"], title=e["place"],
                         provinces=e["provinces"], deaths=round(e["deaths"]) if e["deaths"] is not None else None,
                         evacuated=round(e["evacuated"]) if e["evacuated"] is not None else None)
                    for e in sorted(events, key=lambda e: e["date"])[-15:]],
        ))
