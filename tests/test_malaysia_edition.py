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
