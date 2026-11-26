"""Military data for the Canadian edition, the U.S. edition's DoD MIRTA, DMDC and ACS counterparts:

- Bases: the Canadian Forces' main bases, wings and stations in the Treasury Board's Directory of Federal Real Property
  (custodian DND, primary use Military), with the land area of each property; and every DND military property of
  100 km² or more as restricted ground. DND publishes no boundaries, so ranges stand on the hexes of their parcel points.
- People: Canadian Armed Forces members and veterans by where they live, from the 2021 Census (Statistics Canada table
  98-10-0142, the first census to ask about military service), for Canada, the provinces and territories, CMAs and CAs.
"""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET

from . import canada_census as census

SERVICE_TABLE = "98100142"
LEVELS = {0, 2, 503, 504}
DFRP_FILE = "dfrp-rbif.zip"
COMPONENTS = [
    dict(id="army", name="Canadian Army"), dict(id="navy", name="Royal Canadian Navy"),
    dict(id="air_force", name="Royal Canadian Air Force"), dict(id="other", name="Joint and other DND"),
]
# The main bases, wings and stations: their property numbers (satellite properties of one base folded in), the name
# shown (the directory lists Halifax as "HMCS Scotian/Dockyard Site", Esquimalt as "HMCS Dockyard" and Bagotville as
# "Military Base"), the element, and whether the base is one of this project's flagships on small land.
BASES = [
    (("02919",), "CFB Halifax", "navy", True),
    (("17403", "17402", "17404", "17406"), "CFB Esquimalt", "navy", True),
    (("17432",), "CFAD Rocky Point", "navy", False),
    (("11347", "70304"), "CFB Petawawa", "army", False),
    (("05906",), "CFB Valcartier", "army", False),
    (("04089",), "CFB Gagetown", "army", False),
    (("15531", "58395", "69963"), "CFB Edmonton", "army", True),
    (("12448", "12439"), "CFB Shilo", "army", False),
    (("15305", "15304"), "CFB Wainwright", "army", False),
    (("14976",), "CFB Suffield", "army", False),
    (("14121",), "CFB Dundurn", "army", False),
    (("09406", "09407", "09405"), "CFB Kingston", "army", True),
    (("10992",), "Detachment Meaford", "army", False),
    (("07221",), "Montréal Garrison", "army", False),
    (("06679", "06680"), "Saint-Jean Garrison", "other", False),
    (("11022",), "CFB Borden", "other", True),
    (("58321", "69674"), "CFB Ottawa", "other", False),
    (("08531",), "CFS Leitrim", "other", False),
    (("19341",), "CFS Masset", "other", False),
    (("15684",), "CFB Cold Lake", "air_force", True),
    (("09540", "69634"), "CFB Trenton", "air_force", True),
    (("02717",), "CFB Greenwood", "air_force", False),
    (("07930",), "CFB Bagotville", "air_force", False),
    (("17970",), "CFB Comox", "air_force", False),
    (("12579", "12559"), "CFB Winnipeg", "air_force", True),
    (("13820",), "CFB Moose Jaw", "air_force", False),
    (("01822",), "CFB Goose Bay", "air_force", False),
    (("02863",), "CFB Shearwater", "air_force", False),
    (("11378", "11377"), "CFB North Bay", "air_force", False),
    (("20247",), "CFS Alert", "air_force", False),
]
RANGE_MIN_HA = 10000  # 100 km2
# Large DND properties that are not part of a base above: their element, and a name where the directory's is generic.
# The Cold Lake Air Weapons Range is two properties, one in each province.
RANGE_PARTS = {"15730": "14876"}
RANGE_INFO = {
    "14876": ("air_force", "Cold Lake Air Weapons Range"), "32766": ("air_force", "Tactical Air Weapons Range (Goose Bay)"),
    "18888": ("army", "Chilcotin Military Training Area"), "70288": ("navy", "Nanoose test range (CFMETR)"),
    "70324": ("air_force", None), "58328": ("air_force", None),
}


ENCAMPMENT = ("A city gets an Encampment when (a) a Canadian Forces base of tier 'major' or 'base' lies in it (within "
              "5 km of its boundary), and (b) residents serving in the Canadian Armed Forces (2021 Census, table "
              "98-10-0142, where they live) are at least 1% of residents 17 and over, or at least 2,000 and at least "
              "0.3%. Tier: 'fortress' at 3% or more, otherwise 'garrison'. 'naval' when its Navy bases outweigh its "
              "Army and Air Force ones, counting a 'major' base as 4 and a 'base' as 1 (the U.S. rule).")


def service_status():
    """{DGUID: {"population": people 17+, "serving": currently serving CAF members, "veterans": veterans}}."""
    meta = census.metadata(SERVICE_TABLE)
    geos = census.geographies(meta, LEVELS)
    count = census.member(meta, 6, "Count")
    status = {"population": census.member(meta, 8, "Total - Military service status"),
              "serving": census.member(meta, 8, "Currently serving member"),
              "veterans": census.member(meta, 8, "Veteran")}
    cell = lambda gid, s: census.coordinate(gid, 1, 1, 1, 1, count, 1, s)  # totals: religion, generation, age, gender, minority
    coords = [cell(gid, s) for gid, _ in geos for s in status.values()]
    values = census.series(SERVICE_TABLE, coords, "military service status: currently serving, veterans, all")
    out = {}
    for gid, dguid in geos:
        row = {k: values.get(cell(gid, s)) for k, s in status.items()}
        out[dguid] = {k: int(v) if v is not None else None for k, v in row.items()}
    return out


def dnd_properties(path):
    """{property number: {"name", "area_ha", "buildings", "points": [(lon, lat)], "hub": (lon, lat), "place"}} for
    DND's military properties (primary use code 41) in the Directory of Federal Real Property XML. `hub` is the point
    of the parcel with the most buildings (a base's cantonment, not its training area: Oromocto for Gagetown)."""
    out = {}
    with zipfile.ZipFile(path) as z:
        member = next(n for n in z.namelist() if n.lower().endswith(".xml"))
        with z.open(member) as f:
            for _, el in ET.iterparse(f, events=("end",)):
                if el.tag != "Property":
                    continue
                custodian, use = el.find("Custodian"), el.find("Primary_Use_E")
                if custodian is not None and custodian.get("code") == "DND" and use is not None and use.get("code") == "41":
                    area = buildings = 0.0
                    points, places, built = [], [], []
                    for parcel in el.iter("Parcel"):
                        area += float(parcel.findtext("Land_Area") or 0)
                        count = float(parcel.findtext("Building_Count") or 0)
                        buildings += count
                        loc = parcel.find("Location")
                        if loc is not None and loc.findtext("Latitude") and loc.findtext("Longitude"):
                            points.append((float(loc.findtext("Longitude")), float(loc.findtext("Latitude"))))
                            places.append(loc.findtext("Place_Name_EN") or loc.findtext("Municipality_E") or "")
                            built.append(count)
                    hub = points[max(range(len(points)), key=lambda i: (built[i], -i))] if points else None
                    out[el.findtext("Property_Number").strip()] = dict(
                        name=" ".join((el.findtext("Property_Name_E") or "").split()), area_ha=area,
                        buildings=int(buildings), points=points, hub=hub, place=next((p for p in places if p), None))
                el.clear()
    return out


def tier_of(area_km2, flagship):
    """The U.S. rule: 'major' = 100+ km² or a flagship on small land; 'base' = 1+ km²; 'site' = the rest."""
    return "major" if flagship or area_km2 >= 100 else "base" if area_km2 >= 1 else "site"


def military_doc(path, loc, states, places, to_map):
    """military.json for the Canadian edition (the U.S. shape; `states` holds census figures, not DMDC personnel)."""
    props = dnd_properties(path)
    owner = loc.owner
    installations, flagships = [], []
    in_base = {}
    for numbers, name, component, flagship in BASES:
        missing = [n for n in numbers if n not in props]
        if missing:
            raise ValueError(f"{name}: properties {missing} are not DND military properties in the directory")
        lead = props[numbers[0]]
        if not lead["hub"]:
            raise ValueError(f"{name}: property {numbers[0]} has no parcel coordinates")
        area = sum(props[n]["area_ha"] for n in numbers) / 100
        at = loc.place(*to_map.transform(*lead["hub"]), settle_point=False)
        if at is None:
            raise ValueError(f"{name} has no land hex within reach")
        slug = "-".join("".join(ch if ch.isalnum() else " " for ch in name.lower()).split())
        installations.append(dict(id=slug, name=name, component=component, joint=False, status="act",
                                  tier=tier_of(area, flagship), curated=flagship and area < 100,
                                  area_km2=round(area, 1), properties=list(numbers), cells=None, **at,
                                  state_filed=at["state"]))
        if flagship and area < 100:
            flagships.append(name)
        for n in numbers:
            in_base[n] = installations[-1]
    installations.sort(key=lambda b: ({"major": 0, "base": 1, "site": 2}[b["tier"]], -b["area_km2"]))

    # Ranges: every DND military property of 100+ km² (the Cold Lake range's two halves as one).
    groups = {}
    for n, p in props.items():
        lead = RANGE_PARTS.get(n, n)
        groups.setdefault(lead, []).append(n)
    ranges = []
    for lead, numbers in groups.items():
        area_ha = sum(props[n]["area_ha"] for n in numbers)
        if area_ha < RANGE_MIN_HA:
            continue
        base = in_base.get(lead)
        component, name = RANGE_INFO.get(lead, (base["component"] if base else "other", None))
        name = name or (base["name"] if base else f"{props[lead]['name']} ({props[lead]['place'] or 'unnamed place'})")
        cells, hex_states = [], []
        for n in numbers:
            for lon, lat in props[n]["points"]:
                at = loc.place(*to_map.transform(lon, lat), in_city=False, settle_point=False)
                if at and at["cell"] not in cells:
                    cells.append(at["cell"])
                    hex_states.append(at["state"])
        if not cells:
            continue
        ranges.append(dict(id="range-" + lead, name=name, component=component, area_km2=round(area_ha / 100),
                           cells=cells, state=hex_states[0], hex_state=hex_states[0],
                           installation=base["id"] if base else None))
    ranges.sort(key=lambda r: -r["area_km2"])

    # People: the 2021 Census.
    status = service_status()
    def figures(dguid):
        s = status.get(dguid) or {}
        pop, serving, veterans = s.get("population"), s.get("serving"), s.get("veterans")
        return dict(population_17=pop, serving=serving, veterans=veterans,
                    serving_share=round(serving / pop, 5) if pop and serving is not None else None,
                    veterans_share=round(veterans / pop, 5) if pop and veterans is not None else None)
    province = {s["abbr"]: dict(census=figures(s["dguid"])) for s in states}
    city_census = {c["id"]: figures(f"2021S{'0503' if c['metro'] else '0504'}{c['id'][3:]}") for c in places}
    national = dict(census=figures(census.CANADA), bases=len(installations), ranges=len(ranges))

    # Encampments, the U.S. rule on census figures: a qualifying base (tier major or base) in the city, and serving
    # members at least 1% of residents 17+, or at least 2,000 and 0.3%; 'fortress' at 3%; 'naval' when its Navy bases
    # outweigh its Army and Air Force ones (a major base counts 4, a base 1).
    cities = {}
    weight = {"major": 4, "base": 1}
    for c in places:
        dguid = f"2021S{'0503' if c['metro'] else '0504'}{c['id'][3:]}"
        f = figures(dguid)
        mine = [b for b in installations if b["cbsa"] == c["id"] and b["tier"] in weight]
        serving, share = f["serving"], f["serving_share"]
        if not mine or serving is None or share is None:
            continue
        if not (share >= 0.01 or (serving >= 2000 and share >= 0.003)):
            continue
        navy = sum(weight[b["tier"]] for b in mine if b["component"] == "navy")
        land_air = sum(weight[b["tier"]] for b in mine if b["component"] in ("army", "air_force"))
        cities[c["id"]] = dict(tier="fortress" if share >= 0.03 else "garrison", armed_forces=serving, share=share,
                               naval=navy > land_air, installations=[b["id"] for b in mine],
                               installation_count=len(mine))
    return dict(
        version=1,
        vintage=dict(installations="Directory of Federal Real Property, as retrieved", census="2021 Census"),
        sources=["tbs_dfrp", "statcan_military"],
        rule=ENCAMPMENT,
        rules=dict(
            tier="No per-base headcount is published, so size comes from land area, as in the U.S.: 'major' = a base of "
                 "at least 100 km² (its satellite properties folded in), or one of this project's flagships on small "
                 f"land ({', '.join(flagships)}: the fleet bases, division and air division headquarters, the main "
                 "training base, and the main fighter and air mobility wings; flagged curated); 'base' = at least "
                 "1 km²; 'site' = the rest. The bases are a hand-checked list of the Canadian Forces' main bases, wings "
                 "and stations, not every DND property.",
            ranges="Every DND military property of 100 km² or more (the Cold Lake Air Weapons Range's Alberta and "
                   "Saskatchewan halves as one). DND publishes no boundaries, so each is drawn on the hexes of its "
                   "parcel points, not its full extent.",
            encampment=ENCAMPMENT,
        ),
        flagships=flagships,
        caveats="Base points and land areas: Treasury Board's Directory of Federal Real Property (custodian DND, "
                "primary use Military), which lists properties, not units, and carries no boundaries or personnel. "
                "Serving members and veterans are 2021 Census counts of residents 17 and over by where they live "
                "(Regular Force and Primary Reserve members), not by where they serve. Canada publishes no defence "
                "spending by province or base, so the U.S. personnel and dollars by state are left out.",
        components=COMPONENTS, installations=installations, ranges=ranges, states=province, national=national,
        cities=cities, places={k: v for k, v in city_census.items() if v["population_17"]})
