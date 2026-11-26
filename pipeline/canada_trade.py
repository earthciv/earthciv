"""Freight "trade routes" for the Canadian edition, from the Canadian Freight Analysis Framework (Statistics Canada table
23-10-0142, origin and destination of transported commodities), the U.S. edition's FAF5 counterpart.

The table has no totals over modes or commodities, so a flow is the sum of its 3 modes (air, rail, for-hire truck) and
12 commodity groups. Its zones are 12 CMAs and the rest of each province, the territories, and two foreign areas. Only
values are requested for every pair; weights and tonne-kilometres only for the routes kept.
"""

from __future__ import annotations

from . import canada_census as census

TABLE = "23100142"
FOREIGN = ("United States and Mexico", "Other international")


def _zones(meta, position):
    """[(member id, zone name)] of an origin or destination dimension, names without the ", origin of shipments" tail."""
    out = []
    for m in meta["dimension"][position - 1]["member"]:
        name = m["memberNameEn"].rsplit(", ", 1)[0].strip()
        out.append((m["memberId"], name))
    return out


def flows(top=None):
    """(year, zones, {(origin, destination): {"value": {mode: {commodity: dollars}}}}, extra) over every pair of zones
    (domestic and foreign), plus, for the `top` (origin, destination) name pairs, weights and tonne-kilometres."""
    meta = census.metadata(TABLE)
    origins, dests = _zones(meta, 1), _zones(meta, 2)
    modes = [(m["memberId"], m["memberNameEn"]) for m in meta["dimension"][2]["member"]]
    goods = [(m["memberId"], m["memberNameEn"]) for m in meta["dimension"][3]["member"]]
    char = {m["memberNameEn"]: m["memberId"] for m in meta["dimension"][4]["member"]}
    year = int(meta["cubeEndDate"][:4])
    cell = lambda o, d, mo, g, ch: census.coordinate(o, d, mo, g, ch)
    pairs = [(o, on, d, dn) for o, on in origins for d, dn in dests if not (on in FOREIGN and dn in FOREIGN)]
    coords = [cell(o, d, mo, g, char["Value"]) for o, _, d, _ in pairs for mo, _ in modes for g, _ in goods]
    values = census.series(TABLE, coords, "freight value by origin, destination, mode and commodity", name=f"{TABLE}.json")
    out = {}
    for o, on, d, dn in pairs:
        out[(on, dn)] = {"value": {mn: {gn: values.get(cell(o, d, mo, g, char["Value"])) for g, gn in goods}
                                   for mo, mn in modes}}
    extra = {}
    if top:
        ids_o, ids_d = dict((n, i) for i, n in origins), dict((n, i) for i, n in dests)
        want = [(ids_o[a], ids_d[b], a, b) for a, b in top]
        more = [cell(o, d, mo, g, char[k]) for o, d, _, _ in want for mo, _ in modes for g, _ in goods
                for k in ("Weight", "Tonne-kilometres")]
        vals = census.series(TABLE, more, "freight weight and tonne-kilometres of the routes kept",
                             name=f"{TABLE}-routes.json")
        for o, d, a, b in want:
            extra[(a, b)] = {k: sum(v for mo, _ in modes for g, _ in goods
                                    if (v := vals.get(cell(o, d, mo, g, char[k]))) is not None)
                             for k in ("Weight", "Tonne-kilometres")}
    return year, [n for _, n in origins], out, extra, [n for _, n in modes], [n for _, n in goods]


# ------------------------------------------------------------------ trade.json (the U.S. builder's shape)

TOP_N = 40
MIN_KM = 250  # the U.S. rule
PARTNERS = 5
MODE_IDS = {"Air": "air", "Rail": "rail", "Truck (for-hire)": "truck"}


def _slug(name):
    import unicodedata
    return "-".join("".join(ch for ch in unicodedata.normalize("NFKD", name).lower() if ch.isalnum() or ch == " ").split())


def zones_doc(zone_names, states, places, grid, owner):
    """The 25 domestic zones as U.S.-shaped rows (`faf` holds the framework's zone name): a metro (CMA), or the rest
    of a province, which is the whole province or territory where it has no metro zone; each with its cities (largest
    first) and an anchor at its largest city (else the middle of its land)."""
    import math
    abbr = {s["name"]: s["abbr"] for s in states}
    index = {s["abbr"]: i for i, s in enumerate(states)}
    by_province = {}
    for c in sorted(places, key=lambda c: -(c.get("population") or 0)):
        by_province.setdefault(c["states"][0], []).append(c)
    zones, metro_city = [], {}
    for name in zone_names:
        if name in FOREIGN:
            continue
        if name.startswith("Rest of "):
            kind, province, short = "rest_of_state", abbr[name.removeprefix("Rest of ")], name
        elif name in abbr:  # a whole province or territory: the U.S. definition of the rest of a state (no metro zone)
            kind, province, short = "rest_of_state", abbr[name], name
        else:
            city, province_name = name.rsplit(", ", 1)
            kind, province, short = "metro", abbr[province_name], city
            match = [c for c in by_province.get(province, []) if c["name"] == city]
            if len(match) != 1:
                raise ValueError(f"no single city named {city} in {province} for freight zone {name}")
            metro_city[name] = match[0]["id"]
        zones.append(dict(id=_slug(name), faf=[name], name=name, short=short, kind=kind, states=[province], cities=[],
                          counties=None))
    taken = set(metro_city.values())
    for z in zones:
        province = z["states"][0]
        if z["kind"] == "metro":
            z["cities"] = [metro_city[z["name"]]]
        else:
            z["cities"] = [c["id"] for c in by_province.get(province, []) if c["id"] not in taken]
        lead = next((c for c in places if z["cities"] and c["id"] == z["cities"][0]), None)
        if lead:
            z["anchor"] = dict(cell=lead["cell"], x=lead["x"], y=lead["y"], city=lead["id"])
        else:  # Nunavut: no CMA or CA, so the middle of its land
            cells = [i for i, o in enumerate(owner) if o == index[province]]
            mx = sum(grid.center(*grid.col_row(i))[0] for i in cells) / len(cells)
            my = sum(grid.center(*grid.col_row(i))[1] for i in cells) / len(cells)
            cell = min(cells, key=lambda i: math.dist(grid.center(*grid.col_row(i)), (mx, my)))
            x, y = grid.center(*grid.col_row(cell))
            z["anchor"] = dict(cell=cell, x=round(x, 1), y=round(y, 1), city=None)
    return zones


def trade_doc(states, places, grid, owner, infra):
    """trade.json for the Canadian edition, the U.S. builder's shape and rules (top routes between zones in different
    provinces at least MIN_KM apart, both directions summed; each zone's partners and totals; road-graph paths)."""
    import math
    from collections import defaultdict
    from .build.trade import road_graph, shortest_path

    year, zone_names, pairs, _, modes, goods = flows()
    zones = zones_doc(zone_names, states, places, grid, owner)
    zid = {z["name"]: z["id"] for z in zones}
    by_id = {z["id"]: z for z in zones}
    mode_id = {m: MODE_IDS[m] for m in modes}
    goods_id = {g: str(i) for i, g in enumerate(goods, 1)}

    route = defaultdict(lambda: dict(modes=defaultdict(float), goods=defaultdict(float)))
    partner = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    within, imports, exports = defaultdict(float), defaultdict(float), defaultdict(float)
    for (o, d), cell in pairs.items():
        total = {m: sum(v for v in cell["value"][m].values() if v) for m in modes}
        value = sum(total.values())
        if not value:
            continue
        if o in FOREIGN:
            imports[zid[d]] += value
            continue
        if d in FOREIGN:
            exports[zid[o]] += value
            continue
        a, b = zid[o], zid[d]
        if a == b:
            within[a] += value
            continue
        for m, v in total.items():
            partner[a][b][mode_id[m]] += v
            partner[b][a][mode_id[m]] += v
        if by_id[a]["states"] == by_id[b]["states"]:
            continue  # within one province: not a trade route (the U.S. rule: no state in common)
        r = route[(a, b) if a < b else (b, a)]
        for m, v in total.items():
            r["modes"][mode_id[m]] += v
        for m in modes:
            for g, v in cell["value"][m].items():
                r["goods"][goods_id[g]] += v or 0

    cands = []
    for (a, b), r in route.items():
        za, zb = by_id[a]["anchor"], by_id[b]["anchor"]
        dist = math.dist((za["x"], za["y"]), (zb["x"], zb["y"]))
        value = sum(r["modes"].values())
        if dist >= MIN_KM and value > 0:
            cands.append((value, dist, a, b, r))
    cands.sort(key=lambda t: (-t[0], t[2], t[3]))
    top = cands[:TOP_N]
    name_of = {z["id"]: z["name"] for z in zones}
    directed = [(name_of[a], name_of[b]) for _, _, a, b, _ in top] + [(name_of[b], name_of[a]) for _, _, a, b, _ in top]
    *_, extra, _, _ = flows(top=directed)

    links = road_graph(infra)
    routes, used_goods = [], set()
    for rank, (value, dist, a, b, r) in enumerate(top, 1):
        shares = {m: round(r["modes"].get(m, 0) / value, 4) for m in MODE_IDS.values()}
        top_good = max(r["goods"].items(), key=lambda kv: kv[1])[0]
        used_goods.add(top_good)
        kg = sum(extra[(name_of[x], name_of[y])]["Weight"] for x, y in ((a, b), (b, a)))
        tkm = sum(extra[(name_of[x], name_of[y])]["Tonne-kilometres"] for x, y in ((a, b), (b, a)))
        routes.append(dict(a=a, b=b, rank=rank, value_musd=round(value / 1e6, 1), tons_k=round(kg / 1e6, 1),
                           tkm_m=round(tkm / 1e6, 1), modes=shares, top_mode=max(shares, key=shares.get),
                           top_commodity=top_good, dist_km=round(dist),
                           path=shortest_path(grid, owner, links, by_id[a]["anchor"]["cell"], by_id[b]["anchor"]["cell"])))
    for z in zones:
        ps = sorted(([other, round(sum(ms.values()) / 1e6, 1), max(ms, key=ms.get)] for other, ms in partner[z["id"]].items()
                     if sum(ms.values()) > 0), key=lambda p: (-p[1], p[0]))
        z["partners"] = ps[:PARTNERS]
        z["totals_musd"] = {"within": round(within[z["id"]] / 1e6, 1),
                            "other_zones": round(sum(sum(ms.values()) for ms in partner[z["id"]].values()) / 1e6, 1),
                            "import": round(imports[z["id"]] / 1e6, 1), "export": round(exports[z["id"]] / 1e6, 1)}
    domestic = sum(within.values()) + sum(sum(ms.values()) for ps in partner.values() for ms in ps.values()) / 2
    return dict(
        version=1, vintage=f"Canadian Freight Analysis Framework, {year}", year=year, sources=["statcan_freight"],
        rule=f"The {TOP_N} largest domestic freight flows by value between Canadian Freight Analysis Framework zones in "
             f"different provinces, between zones whose anchors are at least {MIN_KM} km apart (the U.S. rule). Both "
             f"directions are summed. Values are Statistics Canada's estimates for {year}, the framework's latest year, "
             "for air, rail and for-hire truck shipments only (water, pipeline and private trucking are not covered), "
             "in million current Canadian dollars and thousand tonnes.",
        path_note="The framework gives a shipment's start and end zones, not its route: the line drawn between the two "
                  "anchor cities follows mapped highways and railways as a drawing aid, not the way the goods travel.",
        units=dict(value_musd="million current Canadian dollars", tons_k="thousand tonnes", tkm_m="million tonne-kilometres"),
        modes=[dict(id=MODE_IDS[m], name=m) for m in modes],
        commodities={goods_id[g]: g for g in goods if goods_id[g] in used_goods},
        national_musd={"domestic": round(domestic / 1e6, 1), "import": round(sum(imports.values()) / 1e6, 1),
                       "export": round(sum(exports.values()) / 1e6, 1)},
        zones=zones, routes=routes)
