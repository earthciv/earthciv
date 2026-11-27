"""The Malaysia edition's data (web/data/my/), built by pipeline/malaysia.py.

Ethnicity and religion are shown with care (PLAN.md, "Race and religion"): shares only, one neutral colour scale on a
fixed 0–100% domain for every group, no "largest group" lens, a stated denominator, and nothing else in the edition
reading them.
"""

import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "web" / "data" / "my"
SENSITIVE = ("ethnicity", "religion")


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


class MalaysiaWorldTest(unittest.TestCase):
    def test_every_state_and_territory_has_land(self):
        world = load("world")
        self.assertEqual(len(world["states"]), 16)
        owned = {o for o in world["owner"] if o >= 0}
        self.assertEqual(owned, set(range(16)), "a state or federal territory has no hex")

    def test_population_adds_up(self):
        nation, states = load("nation"), load("states")
        self.assertEqual(sum(s["population"] for s in states), nation["nation"]["population"])


class EthnicityAndReligionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lenses = load("lenses")
        cls.groups = {g["id"] for g in lenses["groups"]}
        cls.all = lenses["lenses"]
        cls.by_group = {g: [lens for lens in cls.all if lens["group"] == g] for g in SENSITIVE}
        cls.world = load("world")

    def test_both_groups_are_built(self):
        self.assertLessEqual(set(SENSITIVE), self.groups)
        self.assertEqual([lens["id"] for lens in self.by_group["ethnicity"]],
                         ["ethnic_malay", "ethnic_other_bumiputera", "ethnic_chinese", "ethnic_indian", "ethnic_other"])
        self.assertEqual([lens["id"] for lens in self.by_group["religion"]],
                         ["religion_islam", "religion_christianity", "religion_buddhism", "religion_hinduism",
                          "religion_other", "religion_none"])

    def test_shares_only_on_one_scale(self):
        lenses = self.by_group["ethnicity"] + self.by_group["religion"] + [
            lens for lens in self.all if lens["id"] == "noncitizen"]
        ramps = {tuple(lens["ramp"]) for lens in lenses}
        self.assertEqual(len(ramps), 1, "every group must share one colour scale")
        for lens in lenses:
            with self.subTest(lens=lens["id"]):
                self.assertEqual(lens["format"], "pct")
                self.assertEqual(lens["domain"], [0, 1], "fixed 0–100%, never stretched per group")
                self.assertEqual(lens["higher_is"], "neutral")
                self.assertIn("share of", lens["unit"])
                self.assertIn("not a head count", lens["note"])
                values = [v for v in lens["values"] if v is not None]
                self.assertTrue(values)
                self.assertTrue(all(0 <= v <= 1 for v in values), "shares are fractions, not counts")

    def test_denominators_are_stated(self):
        for lens in self.by_group["ethnicity"]:
            self.assertEqual(lens["unit"], "share of citizens")
        for lens in self.by_group["religion"]:
            self.assertEqual(lens["unit"], "share of residents")
            self.assertIn("2020", lens["note"])

    def test_no_largest_group_lens(self):
        for lens in self.all:
            self.assertNotEqual(lens["format"], "category", f"{lens['id']}: no dominant-group map")
        self.assertNotIn("faith_tradition", {lens["id"] for lens in self.all})

    def test_each_district_adds_to_one(self):
        land = [i for i, o in enumerate(self.world["owner"]) if o >= 0]
        for group in SENSITIVE:
            lenses = self.by_group[group]
            for i in land:
                with self.subTest(group=group, cell=i):
                    self.assertAlmostEqual(sum(lens["values"][i] for lens in lenses), 1, delta=0.001)

    def test_nothing_else_reads_them(self):
        # Informational only: no yield, score, city or state field is built from ethnicity or religion.
        for name in ("cities", "states", "nation"):
            text = json.dumps(load(name)).lower()
            for word in ("ethnic", "religio", "bumiputera", "muslim", "islam"):
                self.assertNotIn(word, text, f"{name}.json mentions {word}")


if __name__ == "__main__":
    unittest.main()


# Published 2020 populations of the conurbations (Wikipedia's articles on each, from DOSM Census 2020 counts by local
# authority). A whole-district group should land near them; a big gap means a district is wrongly in or out.
PUBLISHED_2020 = {"my-gtn": 2_843_344, "my-jb": 2_487_601, "my-kk": 731_406, "my-kch": 788_946}


class ConurbationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cities = load("cities")
        cls.world = load("world")
        cls.by_id = {c["id"]: c for c in cls.cities}

    def test_no_district_in_two_cities(self):
        seen = {}
        for c in self.cities:
            for d in {self.world["county"][cell] for cell in c["footprint"]}:
                self.assertNotIn(d, seen, f"district {d} is in {seen.get(d)} and {c['id']}")
                seen[d] = c["id"]

    def test_footprints_are_the_member_districts(self):
        from pipeline.malaysia import CONURBATIONS

        counties = self.world["counties"]
        for g in CONURBATIONS:
            members = {(counties[i]["state"], counties[i]["name"]) for i in
                       {self.world["county"][cell] for cell in self.by_id[g["id"]]["footprint"]}}
            # A small member (Putatan) may own no hex at 6 km; its people still count, but no foreign hex may join.
            self.assertLessEqual(members, set(g["districts"]), g["id"])
            self.assertIn(g["districts"][0], members, g["id"])

    def test_kuala_lumpur_spans_both_territories(self):
        kl = self.by_id["my-kl"]
        self.assertEqual(set(kl["states"]), {"KUL", "PJY", "SGR"})
        self.assertEqual([c["id"] for c in self.cities if c["capital"]], ["my-kl"])

    def test_banners_sit_in_the_principal_district(self):
        from pipeline.malaysia import CONURBATIONS

        counties = self.world["counties"]
        for g in CONURBATIONS:
            d = counties[self.world["county"][self.by_id[g["id"]]["cell"]]]
            self.assertEqual((d["state"], d["name"]), g["districts"][0], g["id"])

    def test_close_to_published_totals(self):
        from pipeline import malaysia

        if not (malaysia.SOURCE_DIR / "population_district.csv").exists():
            self.skipTest("raw DOSM population not downloaded")
        pop, _ = malaysia.population()
        for g in malaysia.CONURBATIONS:
            total = sum(pop[d][2020] for d in g["districts"])
            if g["id"] in PUBLISHED_2020:
                self.assertAlmostEqual(total / PUBLISHED_2020[g["id"]], 1, delta=0.1, msg=g["id"])
            self.assertGreaterEqual(total, 500_000, g["id"])


class EconomyFunctionsTest(unittest.TestCase):
    """pipeline/malaysia_economy.py's pure helpers, on small made-up tables."""

    def test_aliases_resolve_to_boundary_names(self):
        from pipeline.malaysia_economy import canonical

        self.assertEqual(canonical("Perak", "Larut & Matang"), ("Perak", "Larut Dan Matang"))
        self.assertEqual(canonical("Pulau Pinang", "S.P.Tengah"), ("Pulau Pinang", "Seberang Perai Tengah"))
        self.assertEqual(canonical("Sarawak", "Lubok  antu"), ("Sarawak", "Lubok Antu"), "stray spaces and case")
        self.assertEqual(canonical("Johor", "Batu Pahat"), ("Johor", "Batu Pahat"), "unlisted names pass through")

    def test_counts_of_a_new_district_split_over_its_parents(self):
        from pipeline.malaysia_economy import fold_counts

        new = {("S", "Child"): {("S", "A"): 1, ("S", "B"): 3}}
        out = fold_counts({("S", "A"): {"lf": 100}, ("S", "B"): {"lf": 200}, ("S", "Child"): {"lf": 40}}, new)
        self.assertEqual(out[("S", "A")]["lf"], 110)
        self.assertEqual(out[("S", "B")]["lf"], 230)
        self.assertAlmostEqual(sum(v["lf"] for v in out.values()), 340)

    def test_means_are_population_weighted_and_gini_is_flagged(self):
        from pipeline.malaysia_economy import fold_means

        new = {("S", "Child"): {("S", "A"): 1}}
        rows = {("S", "A"): {"income": 100.0, "gini": 0.3}, ("S", "Child"): {"income": 200.0, "gini": None},
                ("S", "Other"): {"income": 50.0, "gini": 0.4}}
        weights = {("S", "A"): 300, ("S", "Child"): 100, ("S", "Other"): 10}
        means, merged = fold_means(rows, weights, new)
        self.assertAlmostEqual(means[("S", "A")]["income"], 125)
        self.assertAlmostEqual(means[("S", "A")]["gini"], 0.3, msg="a missing figure is skipped, not zero")
        self.assertEqual(means[("S", "Other")]["income"], 50)
        self.assertEqual(merged, {("S", "A")})

    def test_apportion_keeps_the_total_and_treats_missing_as_zero(self):
        from pipeline.malaysia_economy import apportion

        out = apportion(100, {"a": 3, "b": None, "c": 1})
        self.assertEqual(out, {"a": 75, "b": 0, "c": 25})
        self.assertIsNone(apportion(100, {"a": None, "b": 0}))


class EconomySourcesTest(unittest.TestCase):
    """Every name in every year of the raw DOSM tables must reach a boundary district (or be deliberately dropped)."""

    def test_every_survey_name_maps_to_a_district(self):
        from pipeline import malaysia
        from pipeline.malaysia_economy import SOURCE_DIR, canonical, read_csv

        if not (SOURCE_DIR / "lfs_district.csv").exists():
            self.skipTest("raw DOSM tables not downloaded")
        known = {(c["state"], c["name"]) for c in load("world")["counties"]} | set(malaysia.NEW_DISTRICTS)
        for table in ("lfs_district.csv", "hies_district.csv", "gdp_district_real_supply.csv"):
            for r in read_csv(table):
                if r.get("district") == "Supra":  # offshore oil and gas: in no district
                    continue
                with self.subTest(table=table, row=(r["state"], r["district"], r["date"][:4])):
                    self.assertIn(canonical(r["state"], r["district"]), known)


class EconomyDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nation, cls.states, cls.cities = load("nation"), load("states"), load("cities")
        cls.counties = load("counties")
        cls.lenses = {lens["id"]: lens for lens in load("lenses")["lenses"]}
        cls.rows = [dict(zip(cls.counties["columns"], row)) for row in cls.counties["rows"]]

    def test_gold_adds_up_to_the_nation_with_offshore_oil_and_gas(self):
        n = self.nation["nation"]
        self.assertEqual(sum(s["gdp"] for s in self.states) + n["gdp_offshore"], n["gdp"])
        self.assertEqual(sum(n["gdp_by_industry"].values()), n["gdp_basic"])
        self.assertIn("constant 2015", next(y for y in self.nation["yields"] if y["key"] == "gold")["description"])

    def test_states_keep_the_published_workers(self):
        for s in self.states:
            self.assertEqual(sum(s["jobs"].values()), s["employed"], s["abbr"])
        n = self.nation["nation"]
        self.assertEqual(n["yields"]["food"], sum(s["yields"]["food"] for s in self.states))
        self.assertTrue(set(n["jobs"]) <= set(self.nation["industries"]))

    def test_counties_table_shape(self):
        c = self.counties
        self.assertEqual(c["columns"], [f["key"] for f in c["fields"]])
        self.assertEqual(len(c["rows"]), len(load("world")["counties"]))
        self.assertTrue(all(len(r) == len(c["columns"]) for r in c["rows"]))

    def test_cities_add_up_their_districts(self):
        for city in self.cities:
            members = [r for r in self.rows if r["cbsa"] == city["id"]]
            if not members:
                continue
            with self.subTest(city=city["id"]):
                self.assertEqual(city["gdp"], sum(r["gdp"] or 0 for r in members) or None)
                for key in ("food", "production", "science", "culture"):
                    self.assertAlmostEqual(city["yields"][key], sum(r[key] for r in members), delta=len(members))

    def test_merged_districts_have_no_gini(self):
        by_name = {(r["state"], r["name"]): r for r in self.rows}
        for key in (("Sabah", "Beaufort"), ("Sabah", "Papar"), ("Sarawak", "Simunjan"), ("Sarawak", "Sri Aman"),
                    ("Sarawak", "Serian")):
            self.assertIsNone(by_name[key]["gini"], key)
            self.assertIsNotNone(by_name[key]["income"], key)
        self.assertIsNotNone(by_name[("Johor", "Batu Pahat")]["gini"])

    def test_putrajaya_gdp_is_inside_kuala_lumpur(self):
        by_name = {(r["state"], r["name"]): r for r in self.rows}
        self.assertIsNone(by_name[("W.P. Putrajaya", "W.P. Putrajaya")]["gdp"])
        kl = next(c for c in self.cities if c["id"] == "my-kl")
        self.assertGreater(kl["gdp_population"], by_name[("W.P. Kuala Lumpur", "W.P. Kuala Lumpur")]["population"])

    def test_economic_lenses_use_fractions_and_land_lenses_are_built(self):
        for lens_id in ("income", "poverty", "gini", "unemployment", "gdp_pc", "forest", "farmland", "developed"):
            self.assertIn(lens_id, self.lenses)
        for lens_id in ("poverty", "unemployment"):
            values = [v for v in self.lenses[lens_id]["values"] if v is not None]
            self.assertTrue(all(0 <= v <= 1 for v in values), lens_id)
        self.assertIn("RM", self.lenses["income"]["unit"])
        self.assertIn("monthly", self.lenses["income"]["unit"])

    def test_economy_never_reads_ethnicity_or_religion(self):
        from pipeline import malaysia_economy

        code = Path(malaysia_economy.__file__).read_text(encoding="utf-8").split('"""', 2)[2].lower()
        # (it reads only the "overall" row of the population table's ethnicity column, the total)
        for word in ("religio", "bumi", "muslim", "kawasanku", "chinese", "indian", "other_citizen", "noncitizen"):
            self.assertNotIn(word, code)


class ResourcesTest(unittest.TestCase):
    """resources.json and the states' `energy`, `land`, `forest_reserve` (pipeline/malaysia_resources.py)."""

    @classmethod
    def setUpClass(cls):
        cls.res = load("resources")
        cls.world = load("world")
        cls.states = load("states")
        cls.types = {t["id"]: t for t in cls.res["types"]}

    def test_every_site_is_on_a_land_hex_of_its_state(self):
        abbrs = [s["abbr"] for s in self.world["states"]]
        for it in self.res["items"]:
            self.assertIn(it["type"], self.types)
            owner = self.world["owner"][it["cell"]]
            self.assertGreaterEqual(owner, 0, it["name"])
            self.assertEqual(abbrs[owner], it["state"], it["name"])

    def test_fields_at_sea_say_so(self):
        offshore = [i for i in self.res["items"] if i["type"] in ("oil", "gas")]
        self.assertTrue(offshore)
        tapis = next(i for i in offshore if "Tapis" in i["name"])
        self.assertEqual(tapis["state"], "TRG")
        self.assertIn("offshore", tapis["detail"])
        self.assertFalse({"Ambalat", "Kilang Abok Berhad"} & {i["name"] for i in self.res["items"]})

    def test_plants_are_25_mw_or_more_and_energy_adds_up(self):
        plants = [i for i in self.res["items"] if self.types[i["type"]]["unit"] == "MW"]
        self.assertTrue(all(i["value"] >= 25 for i in plants))
        total = sum(s["energy"]["total"] for s in self.states)
        self.assertAlmostEqual(total, sum(i["value"] for i in plants))
        mw = {t for t, v in self.types.items() if v["unit"] == "MW"}
        for s in self.states:
            self.assertEqual(set(s["energy"]["by_type"]), mw)

    def test_only_positioned_data_is_mapped(self):
        # Mines (state totals only), oil palm, rubber and paddy have no positions in open data: none is invented.
        self.assertFalse({"tin", "bauxite", "gold", "oil_palm", "rubber", "paddy"} & set(self.types))
        self.assertTrue({t["category"] for t in self.types.values()} <= {"energy", "agri"})

    def test_district_crop_sites_carry_hectares(self):
        for it in self.res["items"]:
            if self.types[it["type"]]["category"] == "agri":
                self.assertGreater(it["value"], 0)
                self.assertEqual(self.types[it["type"]]["unit"], "ha")

    def test_summary_matches_items(self):
        for key, row in self.res["summary"]["national"].items():
            self.assertEqual(row["count"], sum(1 for i in self.res["items"] if i["type"] == key), key)

    def test_state_land_shares_are_fractions(self):
        for s in self.states:
            self.assertIsNotNone(s["land"], s["abbr"])
            self.assertLessEqual(sum(v for v in s["land"].values() if v is not None), 1.01, s["abbr"])

    def test_manifest_lists_resources(self):
        # The app requests only the files edition.json lists: without "resources" the map shows no resource layer.
        self.assertIn("resources", load("edition")["files"])

    def test_text_pack_states_the_gaps(self):
        text = load("text")
        self.assertIn("Not on the map", text["almanac.resources_intro"])
        self.assertTrue(any("Mines are not mapped" in c for c in text["advisor.energy.caveats"]))
        self.assertTrue(any("oil palm" in c.lower() for c in text["advisor.land.caveats"]))


class LayersTest(unittest.TestCase):
    """infrastructure.json, wonders.json and disasters.json (pipeline/malaysia_layers.py); trade and military are left out."""

    @classmethod
    def setUpClass(cls):
        cls.world = load("world")
        cls.abbrs = [s["abbr"] for s in cls.world["states"]]
        cls.edition = load("edition")
        cls.infra, cls.wonders, cls.dis = load("infrastructure"), load("wonders"), load("disasters")

    def test_manifest_lists_the_layers_and_not_the_ones_left_out(self):
        files = self.edition["files"]
        for name in ("infrastructure", "wonders", "disasters"):
            self.assertIn(name, files)
        for name in ("trade", "military"):  # no open inter-state freight or base list: the docs say why
            self.assertNotIn(name, files)
            self.assertFalse((DATA / f"{name}.json").exists())
        text = load("text")
        self.assertTrue(any("freight" in c and "Military" in c for c in text["advisor.commerce.caveats"]))

    def test_road_and_rail_links_join_neighbouring_land_hexes(self):
        from pipeline.core.hexgrid import HexGrid

        grid = HexGrid(**{k: self.world["grid"][k] for k in ("radius", "cols", "rows")})
        owner = self.world["owner"]
        for layer, tiers in (("roads", self.infra["road_classes"]), ("rail", self.infra["rail_tiers"])):
            seen = set()
            self.assertGreater(len(self.infra[layer]), 50, layer)
            for a, b, tier in self.infra[layer]:
                self.assertLess(a, b)
                self.assertIn(b, grid.neighbours(a))
                self.assertGreaterEqual(owner[a], 0)
                self.assertGreaterEqual(owner[b], 0)
                self.assertLess(tier, len(tiers))
                self.assertNotIn((a, b), seen)
                seen.add((a, b))

    def test_ports_are_left_out_and_say_why(self):
        self.assertEqual(self.infra["ports"], [])
        self.assertIn("no open cargo statistics", self.infra["rules"]["ports"])

    def test_airports_are_one_year_on_land_with_hub_classes_by_passengers(self):
        airports = self.infra["airports"]
        self.assertTrue(airports)
        floor = {h: None for h in self.infra["hubs"]}
        for a in airports:
            self.assertEqual(a["year"], 2019)
            self.assertGreaterEqual(a["passengers"], 900_000)
            self.assertEqual(a["enplanements"], round(a["passengers"] / 2))  # boardings are half the passengers
            self.assertGreaterEqual(self.world["owner"][a["cell"]], 0)
            self.assertEqual(self.abbrs[self.world["owner"][a["cell"]]], a["state"])
            self.assertIn(a["hub"], floor)
        by_hub = {h: [a["passengers"] for a in airports if a["hub"] == h] for h in "LMS"}
        self.assertGreater(min(by_hub["L"]), max(by_hub["M"]))
        self.assertGreater(min(by_hub["M"]), max(by_hub["S"]))
        self.assertEqual([a["passengers"] for a in airports], sorted((a["passengers"] for a in airports), reverse=True))
        self.assertIn("estimate", self.infra["rules"]["airports"])

    def test_wonders_stand_on_land_in_their_state_under_published_rules(self):
        rules = {r["id"]: r for r in self.wonders["rules"]}
        self.assertEqual(set(rules), {"world_heritage", "national_park", "research_university", "landmark"})
        for w in self.wonders["wonders"]:
            self.assertIn(w["rule"], rules)
            self.assertIn(w["kind"], rules[w["rule"]]["kinds"] if "kinds" in rules[w["rule"]] else [rules[w["rule"]]["kind"]])
            owner = self.world["owner"][w["cell"]]
            self.assertGreaterEqual(owner, 0, w["name"])
            self.assertEqual(self.abbrs[owner], w["state"], w["name"])
        self.assertEqual(len([w for w in self.wonders["wonders"] if w["rule"] == "world_heritage"]), 7)  # 6 properties, Melaka and George Town drawn twice

    def test_no_wonder_is_chosen_by_faith_or_community(self):
        words = ("mosque", "masjid", "temple", "kuil", "church", "gereja", "wat ", "shrine", "cathedral", "surau")
        for w in self.wonders["wonders"]:
            self.assertFalse(any(x in w["name"].lower() for x in words), w["name"])
        for r in self.wonders["rules"]:
            self.assertFalse(any(x in r["text"].lower() for x in ("muslim", "buddhist", "hindu", "christian", "malay ", "chinese ")), r["id"])

    def test_universities_are_ranked_by_lecturers_with_a_city_cap(self):
        unis = [w for w in self.wonders["wonders"] if w["rule"] == "research_university"]
        staff = [w["metrics"]["lecturers"] for w in unis]
        self.assertEqual(staff, sorted(staff, reverse=True))
        self.assertEqual([w["rank"] for w in unis], list(range(1, len(unis) + 1)))
        cities = [w["cbsa"] for w in unis if w["cbsa"]]
        self.assertLessEqual(max(cities.count(c) for c in set(cities)), 2)
        rule = next(r for r in self.wonders["rules"] if r["id"] == "research_university")
        self.assertEqual(rule["measure"], "lecturers")

    def test_curated_landmarks_never_share_a_hex_or_city_with_another_wonder(self):
        landmarks = [w for w in self.wonders["wonders"] if w["rule"] == "landmark"]
        cities = [w["cbsa"] for w in landmarks if w["cbsa"]]
        self.assertEqual(len(cities), len(set(cities)))
        others = {w["cell"] for w in self.wonders["wonders"] if w["rule"] in ("world_heritage", "national_park")}
        self.assertFalse(others & {w["cell"] for w in landmarks})

    def test_floods_use_null_for_missing_figures_and_zero_for_unaffected(self):
        floods = self.dis["floods"]
        years = floods["years"]
        self.assertEqual(years, [2021, 2022, 2023, 2024, 2025])
        self.assertEqual(len(floods["national"]["loss_k"]), len(years))
        states = floods["states"]
        self.assertEqual(set(states), set(self.abbrs))
        self.assertIsNone(states["LBN"]["loss_k"][0])  # DOSM published no 2021 figure for Labuan: not zero
        self.assertEqual(states["PNG"]["loss_k"][0], 0)  # "-": not affected
        self.assertGreater(states["SGR"]["loss_k"][0], 3e6)  # the December 2021 floods, RM thousand
        # 2021: DOSM gave agriculture and infrastructure for the nation only, so the states fall short; from 2022 they add up
        self.assertEqual(floods["states_complete"], [False, True, True, True, True])
        self.assertIn("nation only", floods["states_note"])
        for i, complete in enumerate(floods["states_complete"]):
            total = sum(s["loss_k"][i] or 0 for s in states.values())
            ratio = total / floods["national"]["loss_k"][i]
            if complete:
                self.assertAlmostEqual(ratio, 1, delta=0.001)
            else:
                self.assertLess(ratio, 0.8)

    def test_flood_districts_follow_the_world_and_are_not_state_totals(self):
        counties = self.dis["floods"]["counties"]
        self.assertEqual([r[0] for r in counties["rows"]], [c["geoid"] for c in self.world["counties"]])
        self.assertTrue(all(len(r) == 6 for r in counties["rows"]))
        self.assertIn("by state only", counties["note"])
        self.assertLess(sum(r[2] or 0 for r in counties["rows"]), self.dis["floods"]["national"]["loss_k"][1])

    def test_text_pack_states_the_gaps(self):
        text = load("text")
        self.assertTrue(any("Natural Earth" in c and "Port Klang" in c for c in text["advisor.commerce.caveats"]))
        self.assertTrue(any("only floods are shown" in c for c in text["advisor.culture.caveats"]))
        self.assertEqual(text["advisor.culture.disaster_sources"], ["dosm_floods"])


class LayerReaderTest(unittest.TestCase):
    """The small file readers of pipeline/malaysia_layers.py."""

    def test_flood_cells_keep_missing_apart_from_zero(self):
        from pipeline import malaysia_layers as layers

        self.assertEqual(layers._value("-"), 0.0)
        self.assertIsNone(layers._value("n.a"))
        self.assertIsNone(layers._value("#REF!"))
        self.assertIsNone(layers._value(None))
        self.assertEqual(layers._value("12.5"), 12.5)

    def test_spreadsheet_columns_count_like_letters(self):
        from pipeline import malaysia_layers as layers

        self.assertEqual([layers.column(c) for c in ("A", "Z", "AA", "AB")], [1, 26, 27, 28])
