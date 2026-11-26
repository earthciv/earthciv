import json
import unittest
from collections import Counter, defaultdict
from pathlib import Path


DATA = Path(__file__).resolve().parents[1] / "web" / "data" / "ca"


class CanadianEnergyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources = json.loads((DATA / "resources.json").read_text())
        cls.states = json.loads((DATA / "states.json").read_text())

    def test_every_plant_contributes_to_provincial_and_national_capacity(self):
        by_province = {s["abbr"]: Counter() for s in self.states}
        national = Counter()
        counts = Counter()
        plants = {t["id"] for t in self.resources["types"] if t["unit"] == "MW"}
        for r in self.resources["items"]:
            if r["type"] in plants:
                self.assertIn(r["state"], by_province, r["name"])
                by_province[r["state"]][r["type"]] += r["value"]
                national[r["type"]] += r["value"]
                counts[r["type"]] += 1
        for s in self.states:
            expected = by_province[s["abbr"]]
            self.assertEqual(set(s["energy"]["by_type"]), set(expected))
            for fuel, value in expected.items():
                self.assertAlmostEqual(s["energy"]["by_type"][fuel], value)
            self.assertAlmostEqual(s["energy"]["total"], sum(expected.values()))
        for fuel in plants:
            summary = self.resources["summary"]["national"][fuel]
            self.assertAlmostEqual(summary["value"], national[fuel])
            self.assertEqual(summary["count"], counts[fuel])

    def test_shoreline_plants(self):
        provinces = {r["name"]: r["state"] for r in self.resources["items"] if r["type"] == "nuclear"}
        for name in ("Bruce A", "Bruce B", "Darlington"):
            self.assertEqual(provinces[name], "ON")
        self.assertEqual(provinces["Point Lepreau"], "NB")

    def test_field_inventory_retains_mixed_products_and_bitumen(self):
        field_types = {"oil", "gas", "oil_gas", "bitumen"}
        records = defaultdict(list)
        for item in self.resources["items"]:
            if item["type"] in field_types:
                records[item["type"]].append(item)
        self.assertEqual(set(records), field_types)
        for kind, items in records.items():
            self.assertEqual(self.resources["summary"]["national"][kind]["count"], len(items))
            for item in items:
                # The product list, before any "; offshore, shown on the nearest coast hex" note.
                products = {p.strip().lower() for p in item["detail"].split(";")[0].split(",")}
                expected = {"oil": {"oil"}, "gas": {"gas"}, "oil_gas": {"oil", "gas"}, "bitumen": {"bitumen"}}
                self.assertEqual(products & {"oil", "gas", "bitumen"}, expected[kind], item["name"])
