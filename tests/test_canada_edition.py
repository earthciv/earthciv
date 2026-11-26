"""The Canadian edition follows the U.S. edition's map rules (see pipeline/canada.py and docs/CANADA.md)."""

import json
import re
import unittest
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROVINCE_CODES = ("NL", "PE", "NS", "NB", "QC", "ON", "MB", "SK", "AB", "BC", "YT", "NT", "NU")
DATA = ROOT / "web" / "data" / "ca"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


class CanadianMapRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = load("world")
        cls.owner = cls.world["owner"]

    def test_resource_sites_sit_on_their_province_land(self):
        abbr = [s["abbr"] for s in self.world["states"]]
        for item in load("resources")["items"]:
            self.assertGreaterEqual(self.owner[item["cell"]], 0, item["name"])
        offshore = [i for i in load("resources")["items"] if "offshore" in (i["detail"] or "")]
        self.assertTrue(offshore)  # the Grand Banks fields, on the nearest coast hex of their province
        for item in offshore:
            self.assertEqual(abbr[self.owner[item["cell"]]], item["state"], item["name"])

    def test_wonders_sit_on_land_with_land_footprints(self):
        doc = load("wonders")
        for rule in doc["rules"]:
            ranks = [w["rank"] for w in doc["wonders"] if w["rule"] == rule["id"]]
            self.assertEqual(ranks, list(range(1, len(ranks) + 1)), rule["id"])
        for w in doc["wonders"]:
            self.assertGreaterEqual(self.owner[w["cell"]], 0, w["name"])
            self.assertTrue(w["cells"] is None or (w["cells"] and all(self.owner[c] >= 0 for c in w["cells"])), w["name"])
            self.assertIs(w["curated"], False)

    def test_parks_reported_together_count_once(self):
        wonders = {w["name"]: w for w in load("wonders")["wonders"]}
        merged = wonders["Mount Revelstoke and Glacier National Parks"]
        self.assertEqual(merged["metrics"]["visits"], 834939)  # fiscal 2025–26
        self.assertEqual(merged["rank"], 5)

    def test_wonders_follow_the_us_rules(self):
        doc = load("wonders")
        by_rule = defaultdict(list)
        for w in doc["wonders"]:
            by_rule[w["rule"]].append(w)
        self.assertEqual({r: len(v) for r, v in by_rule.items()},
                         {"national_park": 15, "park_unit": 5, "research_university": 20, "landmark": 12})
        for rule, key in (("national_park", "visits"), ("park_unit", "visits"), ("landmark", "visits"),
                          ("research_university", "doctoral")):
            values = [w["metrics"][key] for w in by_rule[rule]]
            self.assertEqual(values, sorted(values, reverse=True), rule)
        # the U.S. metro caps: 2 universities and 1 landmark per city
        for rule, cap in (("research_university", 2), ("landmark", 1)):
            per_city = Counter(w["cbsa"] for w in by_rule[rule] if w["cbsa"])
            self.assertLessEqual(max(per_city.values()), cap, rule)
        names = {w["short"]: w for w in doc["wonders"]}
        self.assertEqual(names["U of T"]["rank"], 1)
        self.assertNotIn("UQAM", names)  # Montréal's third university
        self.assertNotIn("Rogers Pass", names)  # inside Glacier National Park, a park wonder
        self.assertEqual((names["Rideau Canal"]["state"], names["Rideau Canal"]["cbsa"]), ("ON", "ca-505"))
        self.assertEqual(names["uOttawa"]["state"], "ON")  # the site's province, not its (Gatineau) hex's
        cities = {c["id"]: c for c in load("cities")}
        self.assertEqual(names["Fort George"]["cbsa"], "ca-539")  # on a lake/New York hex: St. Catharines', not Toronto's
        self.assertIn(names["Fort George"]["cell"], cities["ca-539"]["footprint"])
        self.assertEqual(names["UBC"]["cbsa"], "ca-933")
        self.assertEqual(by_rule["research_university"][0]["metrics"]["year"], "2023/2024")
        rule = next(r for r in doc["rules"] if r["id"] == "research_university")
        self.assertIn("University of British Columbia", rule["text"])  # the reporting break that sets the year

    def test_wonders_pass_the_us_wonder_checks(self):
        from pipeline.build import wonders

        fails = [msg for level, msg in wonders.check(DATA) if level == "FAIL"]
        self.assertEqual(fails, [])

    def test_ports_and_airports(self):
        from pipeline.build import infrastructure

        fails = [msg for level, msg in infrastructure.check(DATA) if level == "FAIL"]
        self.assertEqual(fails, [])
        doc = load("infrastructure")
        ports = doc["ports"]
        self.assertEqual([p["rank"] for p in ports], list(range(1, 18)))  # the 17 Canada Port Authorities
        self.assertEqual((ports[0]["name"], ports[0]["tons"], ports[0]["year"]),
                         ("Vancouver Fraser Port Authority", 158_400_000, 2024))
        airports = {a["id"]: a for a in doc["airports"]}
        self.assertEqual(doc["airports"][0]["id"], "YYZ")
        self.assertEqual({k: airports[k]["hub"] for k in ("YYZ", "YXE", "YFC", "YEV")},
                         {"YYZ": "L", "YXE": "M", "YFC": "S", "YEV": "N"})  # the FAA's shares of national boardings
        self.assertIsNone(airports["YMX"]["hub"])  # Mirabel: a cargo airport
        self.assertGreaterEqual(airports["YMX"]["cargo_t"], 10_000)
        self.assertEqual((airports["YOW"]["state"], airports["YOW"]["cbsa"]), ("ON", "ca-505"))
        self.assertNotIn("YXY", airports)  # Whitehorse: suppressed by Statistics Canada, and said so
        self.assertIn("Whitehorse", doc["rules"]["airports"])
        self.assertIn("Îles-de-la-Madeleine", doc["rules"]["airports"])  # no land hex: left out, as in the U.S.

    def test_disasters(self):
        cdd = load("disasters")["cdd"]
        self.assertEqual(cdd["years"], [1980, 2022])  # the database's last events are from December 2022
        nat = cdd["national"]
        self.assertEqual(sum(nat["by_type"].values()), nat["events"])
        self.assertEqual(sum(y["events"] for y in nat["by_year"]), nat["events"])
        self.assertTrue(nat["costliest"][0]["name"].startswith("Winter Storm: Ontario, Quebec and New Brunswick (January 1998)"))
        # provinces get equal shares of each event's cost, so the shares add up to the national cost
        shares = sum(sum(p["cost_cad"].values()) for p in cdd["provinces"].values())
        self.assertAlmostEqual(shares / nat["cost_cad"], 1, places=4)
        self.assertLessEqual(set(cdd["provinces"]), set(PROVINCE_CODES))  # events abroad ("IN") are left out

    def test_trade_routes(self):
        from pipeline.build import trade

        fails = [msg for level, msg in trade.check(DATA) if level == "FAIL"]
        self.assertEqual(fails, [])
        doc = load("trade")
        self.assertEqual(doc["year"], 2017)  # the Canadian Freight Analysis Framework's latest year
        zones = {z["id"]: z for z in doc["zones"]}
        self.assertEqual(len(zones), 25)
        self.assertEqual({doc["routes"][0]["a"], doc["routes"][0]["b"]}, {"montreal-quebec", "toronto-ontario"})
        for r in doc["routes"]:
            self.assertNotEqual(zones[r["a"]]["states"], zones[r["b"]]["states"])  # between provinces only
            self.assertGreaterEqual(r["dist_km"], 250)
            self.assertAlmostEqual(sum(r["modes"].values()), 1, places=2)
        values = [r["value_musd"] for r in doc["routes"]]
        self.assertEqual(values, sorted(values, reverse=True))

    def test_military(self):
        from pipeline.build import military

        fails = [msg for level, msg in military.check(DATA) if level == "FAIL"]
        self.assertEqual(fails, [])
        doc = load("military")
        bases = {b["name"]: b for b in doc["installations"]}
        self.assertEqual(len(bases), 30)
        self.assertEqual(bases["CFB Gagetown"]["cbsa"], "ca-320")  # placed at its cantonment (Oromocto), in Fredericton
        self.assertEqual((bases["CFB Halifax"]["tier"], bases["CFB Halifax"]["curated"]), ("major", True))  # flagship
        self.assertEqual(bases["CFB Suffield"]["tier"], "major")  # 100+ km2
        self.assertEqual(doc["national"]["census"]["serving"], 99025)  # 2021 Census, residents 17+
        names = {c["id"]: c["name"] for c in load("cities")}
        garrisons = {names[k]: v for k, v in doc["cities"].items()}
        self.assertEqual(garrisons["Petawawa"]["tier"], "fortress")
        self.assertTrue(garrisons["Halifax"]["naval"] and garrisons["Victoria"]["naval"])
        self.assertEqual(doc["ranges"][0]["name"], "Cold Lake Air Weapons Range")
        self.assertGreater(doc["ranges"][0]["area_km2"], 11000)  # its Alberta and Saskatchewan halves as one

    def test_one_city_per_hex_named_for_its_principal_city(self):
        cities = load("cities")
        cells = Counter(c["cell"] for c in cities)
        self.assertEqual([cell for cell, n in cells.items() if n > 1], [])
        for c in cities:
            self.assertGreaterEqual(self.owner[c["cell"]], 0, c["name"])
            self.assertNotRegex(c["name"], r" [–-] | / ", "banners show the first-named city")
        names = {c["name"]: c for c in cities}
        self.assertIn("Ottawa - Gatineau", names["Ottawa"]["full"])

    def test_water_depths_follow_the_us_rules(self):
        water = [i for i, o in enumerate(self.owner) if o == -1]
        self.assertTrue(all(self.world["elev"][i] <= 0 for i in water))
        self.assertTrue(all(v >= 0 for v in self.world["elev_max"]))

    def test_growth_beyond_the_us_cap_is_blank(self):
        lenses = {lens["id"]: lens for lens in load("lenses")["lenses"]}
        rows = load("cities") + load("states") + [load("nation")["nation"]]
        for v in lenses["growth"]["values"] + [r["growth"] for r in rows]:
            self.assertTrue(v is None or abs(v) <= 0.25, v)

    def test_icons_emoji_and_lens_ranges(self):
        icons = (ROOT / "web" / "js" / "icons.js").read_text()
        lenses = load("lenses")["lenses"]
        types = load("resources")["types"]
        for thing in lenses + types:
            self.assertTrue(thing.get("emoji"), thing["id"])
            self.assertRegex(icons, rf"['\"]?{re.escape(thing['icon'])}['\"]?\s*:", thing["id"])
        for lens in lenses:
            lo, hi = lens["domain"]
            self.assertLess(lo, hi, lens["id"])
            if lens["id"] not in ("faith", "faith_tradition"):  # fixed ranges, as in the U.S.
                self.assertIn("2nd–98th percentile", lens["description"])

    def test_sources_carry_the_us_provenance_fields(self):
        for s in load("sources"):
            self.assertTrue(s["vintage"] and s["used_for"], s["id"])
            for f in s["files"]:
                self.assertLessEqual({"file", "url", "retrieved", "sha256", "bytes"}, set(f), s["id"])

    def test_every_lens_and_resource_source_is_catalogued(self):
        ids = {s["id"] for s in load("sources")}
        for thing in load("lenses")["lenses"] + load("resources")["types"]:
            self.assertIn(thing["source"], ids, thing["id"])


class CanadianCensusEconomyTest(unittest.TestCase):
    """The U.S. economic fields, from the 2021 Census (pipeline/canada_census.py)."""

    FIELDS = ("employed", "jobs", "median_income", "median_rent", "home_value", "unemployment_census", "rent_burden")

    def test_every_area_has_the_us_economic_fields(self):
        nation = load("nation")
        for area in load("cities") + load("states") + [nation["nation"]]:
            for field in self.FIELDS:
                self.assertIsNotNone(area[field], f"{area.get('name', 'Canada')}: {field}")
            self.assertEqual(set(area["jobs"]), set(nation["industries"]))
            # A suppressed small count is null (allowed by the U.S. contract); the rest add up to the employed.
            published = sum(v for v in area["jobs"].values() if v is not None)
            self.assertLessEqual(published, area["employed"] * 1.001 + 25)
            self.assertGreaterEqual(published, area["employed"] * 0.97)

    def test_five_us_yields_from_jobs_and_gdp(self):
        nation = load("nation")
        self.assertEqual([y["key"] for y in nation["yields"]], ["food", "production", "gold", "science", "culture"])
        n = nation["nation"]
        self.assertEqual(n["yields"]["food"], n["jobs"]["agriculture"])
        self.assertEqual(n["yields"]["production"], n["jobs"]["manufacturing"] + n["jobs"]["construction"] + n["jobs"]["mining"])
        self.assertEqual(n["yields"]["gold"], n["gdp"])
        for s in load("states"):
            self.assertEqual(set(s["ranks"]), {"food", "production", "gold", "science", "culture"})

    def test_population_is_the_latest_july_1_estimate(self):
        doc = load("nation")
        n = doc["nation"]
        self.assertEqual(doc["year"], 2025)
        self.assertEqual(n["population"], 41651653)  # July 1, 2025 (table 17-10-0152)
        self.assertEqual(n["census_population"], 36991981)  # 2021 Census count
        self.assertEqual(n["growth_years"], [2021, 2025])
        self.assertAlmostEqual(n["growth"], 41651653 / 38239864 - 1, places=4)
        self.assertEqual(doc["census_year"], 2021)
        for row in load("cities") + load("states") + [n]:
            self.assertEqual(row["growth_years"], [2021, doc["year"]])
            self.assertGreater(row["population"], 0)
        self.assertEqual(sum(s["population"] for s in load("states")), n["population"])

    def test_gdp_is_the_latest_year_of_each_table(self):
        n = load("nation")["nation"]
        self.assertEqual((n["gdp_year"], n["gdp"]), (2025, 3247208000000))
        self.assertEqual(n["gdp_population"], n["population"])
        for s in load("states"):
            self.assertEqual(s["gdp_year"], 2025, s["abbr"])
        metros = [c for c in load("cities") if c["gdp"] is not None]
        self.assertTrue(metros)
        for c in metros:  # metro GDP ends in 2022; per-person GDP divides by the 2022 population
            self.assertEqual(c["gdp_year"], 2022, c["name"])
            self.assertTrue(0.7 * c["population"] < c["gdp_population"] <= 1.05 * c["population"], c["name"])
        for c in load("cities"):
            if c["gdp"] is None:
                self.assertIsNone(c["gdp_population"], c["name"])
        gold = next(y for y in load("nation")["yields"] if y["key"] == "gold")
        self.assertIn("2025", gold["description"])
        self.assertIn("2022", gold["description"])

    def test_power_plants_state_their_2016_17_date(self):
        sources = {s["id"]: s for s in load("sources")}
        self.assertIn("2016–17", sources["wri_plants"]["vintage"])
        for t in load("resources")["types"]:
            if t["source"] == "wri_plants":
                self.assertIn("2016–17", t["description"], t["id"])

    def test_published_national_figures(self):
        n = load("nation")["nation"]
        self.assertEqual(n["median_income"], 84000)  # 2020 median household total income
        self.assertEqual(n["median_rent"], 1070)  # renters' median monthly shelter cost
        self.assertEqual(n["home_value"], 472000)  # median owner-estimated dwelling value
        self.assertAlmostEqual(n["unemployment_census"], 0.103, places=3)  # census week, May 2021

    def test_unemployment_is_the_labour_force_survey_annual_average(self):
        doc = load("nation")
        n = doc["nation"]
        self.assertEqual(n["unemployment_year"], 2025)
        self.assertAlmostEqual(n["unemployment"], 0.068, places=3)  # the ten provinces, 2025 annual average
        self.assertEqual(doc["unemployment_vintage"], "Labour Force Survey, 2025 annual averages")
        for s in load("states"):  # every province and territory
            self.assertEqual(s["unemployment_year"], 2025, s["abbr"])
            self.assertTrue(0 < s["unemployment"] < 0.2, s["abbr"])
        for c in load("cities"):
            if c["metro"]:  # the survey publishes every CMA
                self.assertEqual(c["unemployment_year"], 2025, c["name"])
            else:  # not census agglomerations: their census rate stays apart, never ranked with the survey's
                self.assertIsNone(c["unemployment"], c["name"])
                self.assertIsNone(c["unemployment_year"], c["name"])
        sources = {s["id"]: s for s in load("sources")}
        self.assertEqual(sources["statcan_lfs"]["vintage"], doc["unemployment_vintage"])

    def test_census_lenses_cover_the_map(self):
        world = load("world")
        lenses = {lens["id"]: lens for lens in load("lenses")["lenses"]}
        self.assertLessEqual({"density", "growth", "income", "poverty", "age", "foreign_born", "bachelors", "commute",
                              "homeownership", "forest", "farmland", "developed", "faith", "faith_tradition"}, set(lenses))
        land = [i for i, o in enumerate(world["owner"]) if o >= 0]
        for lid in ("income", "poverty", "age", "foreign_born", "bachelors", "commute", "homeownership", "faith"):
            missing = sum(lenses[lid]["values"][i] is None for i in land)
            self.assertLess(missing, 0.01 * len(land), lid)
        cats = lenses["faith_tradition"]["categories"]
        self.assertEqual(lenses["faith_tradition"]["domain"], [0, len(cats) - 1])
        self.assertEqual(lenses["faith_tradition"]["ramp"], [c["color"] for c in cats])


class CanadianAdvisorDataTest(unittest.TestCase):
    """counties.json (census divisions), province land shares and the opening view."""

    def test_census_division_table(self):
        doc, world = load("counties"), load("world")
        self.assertEqual([f["key"] for f in doc["fields"]], doc["columns"])
        self.assertEqual(len(doc["rows"]), len(world["counties"]))
        col = {k: j for j, k in enumerate(doc["columns"])}
        abbrs = {s["abbr"] for s in world["states"]}
        faiths = {c["id"] for c in next(l for l in load("lenses")["lenses"] if l["id"] == "faith_tradition")["categories"]}
        for row in doc["rows"]:
            self.assertIn(row[col["state"]], abbrs)
            self.assertIsNone(row[col["cbsa"]])  # CMAs are built from municipalities, not divisions
            self.assertGreaterEqual(world["owner"][row[col["cell"]]], 0)
            self.assertIn(row[col["faith_tradition"]], faiths | {None})
        self.assertEqual(sum(r[col["population"]] for r in doc["rows"]), load("nation")["nation"]["population"])

    def test_province_land_shares(self):
        for s in load("states"):
            self.assertIsNone(s["land"]["pasture"])  # NRCan cropland includes pasture
            self.assertTrue(0 < s["land"]["forest"] + s["land"]["crop"] + s["land"]["developed"] <= 1, s["abbr"])

    def test_opens_like_the_us_edition(self):
        # No `home` frame, so main.js frames all the land, as the U.S. edition does; the quick lens row and the
        # top bar's "Turn" label read like the U.S. ones ("Population", a short source label).
        self.assertNotIn("home", load("world"))
        us_density = next(l for l in json.loads((ROOT / "web" / "data" / "us" / "lenses.json").read_text())["lenses"] if l["id"] == "density")
        ca_density = next(l for l in load("lenses")["lenses"] if l["id"] == "density")
        self.assertEqual(ca_density["name"], us_density["name"])
        nation = load("nation")
        self.assertEqual(nation["vintage"], "StatCan 2025 estimates, 2021 Census")
        self.assertLessEqual(len(nation["vintage"]), 40)


class CanadianCityViewTest(unittest.TestCase):
    """The City View files (districts.json, citizens.json) and the cities.json fields it reads, as in the U.S."""

    @classmethod
    def setUpClass(cls):
        cls.cities = load("cities")
        cls.by_name = {c["name"]: c for c in cls.cities}
        cls.districts = load("districts")
        cls.citizens = load("citizens")

    def test_districts_follow_the_us_catalog_and_rule(self):
        us = json.loads((ROOT / "web" / "data" / "us" / "districts.json").read_text())
        doc = self.districts
        self.assertEqual([d["id"] for d in doc["catalog"]], [d["id"] for d in us["catalog"]])
        self.assertEqual({k: doc["rule"][k] for k in ("min_lq", "min_jobs", "specialty_lq", "max_per_city", "badge_lq")},
                         {k: us["rule"][k] for k in ("min_lq", "min_jobs", "specialty_lq", "max_per_city", "badge_lq")})
        self.assertEqual(set(doc["cities"]), {c["id"] for c in self.cities})
        self.assertEqual(doc["sources"], ["statcan_census_city_view"])
        for cid, row in doc["cities"].items():
            self.assertIsNotNone(row, cid)  # the census publishes industry counts for every CMA and CA
            self.assertGreater(row["emp"], 0)
            self.assertLessEqual(len(row["districts"]), 5)
            strengths = [d["strength"] for d in row["districts"]]
            self.assertEqual(strengths, sorted(strengths, reverse=True))
            for d in row["districts"]:
                self.assertTrue(d["via"] == "specialty" or d["lq"] >= 1.25, (cid, d))
                self.assertGreaterEqual(d["emp"], 1000 if d["via"] == "specialty" else 0)
            if row["districts"]:
                self.assertIn(row["badge"]["district"], {d["id"] for d in row["districts"]}, cid)
            else:
                self.assertIsNone(row["badge"], cid)
            for t in row["top"]:
                self.assertIn(t["naics"], doc["industries"])
                self.assertGreaterEqual(t["emp"], 1000)

    def test_known_city_types(self):
        row = lambda name: self.districts["cities"][self.by_name[name]["id"]]
        ids = lambda name: {d["id"] for d in row(name)["districts"]}
        self.assertIn("commercial_hub", ids("Toronto"))  # finance
        self.assertIn("government_plaza", ids("Ottawa"))
        if row("Ottawa")["badge"]["district"] == "government_plaza":
            self.assertEqual(row("Ottawa")["badge"]["label"], "Capital city")
        self.assertIn("industrial_zone", ids("Calgary"))  # oil and gas

    def test_citizen_rows_add_up(self):
        doc, us = self.citizens, json.loads((ROOT / "web" / "data" / "us" / "citizens.json").read_text())
        self.assertEqual(doc["figures"], us["figures"])
        self.assertEqual(list(doc["groups"]), list(us["groups"]))
        self.assertEqual([g["key"] for g in doc["groups"]["workforce"]], [g["key"] for g in us["groups"]["workforce"]])
        self.assertEqual(set(doc["cities"]), {c["id"] for c in self.cities})
        nat = doc["national"]
        self.assertAlmostEqual(nat["age"]["median"], 41.6, delta=0.5)  # Canada, 2021 Census
        for cid, row in [("national", nat)] + list(doc["cities"].items()):
            self.assertIsNotNone(row, cid)
            for name, r in row.items():
                if name in ("specialists", "reliable") or r is None:
                    continue
                self.assertEqual(sum(r["counts"].values()), r["total"], (cid, name))
                self.assertAlmostEqual(sum(r["shares"].values()), 1, delta=0.01)
                if name in doc["figures"]:
                    self.assertEqual(sum(r["figures"].values()), doc["figures"][name], (cid, name))
        toronto = doc["cities"][self.by_name["Toronto"]["id"]]
        self.assertGreater(toronto["nativity"]["foreign_born"], 0.4)  # about half of Torontonians were born abroad
        self.assertGreater(toronto["commute"]["shares"]["home"], 0.2)  # May 2021: COVID-19 restrictions

    def test_cities_carry_ranks_peers_and_population_by_year(self):
        self.assertEqual(self.cities[0]["name"], "Toronto")
        self.assertEqual(self.cities[0]["ranks"]["population"], 1)
        gdp_ranked = [c for c in self.cities if c["ranks"]["gdp"] is not None]
        self.assertEqual(len(gdp_ranked), sum(1 for c in self.cities if c["gdp"] is not None))
        for c in self.cities:
            self.assertEqual(len(c["peers"]), 5)
            self.assertNotIn(c["id"], c["peers"])
            self.assertEqual(c["pop_series"][str(c["growth_years"][1])], c["population"], c["name"])
            self.assertEqual(sorted(c["pop_series"]), [str(y) for y in range(2021, c["growth_years"][1] + 1)])

    def test_resource_sites_on_city_hexes_belong_to_that_city(self):
        footprint = {c["id"]: set(c["footprint"]) for c in self.cities}
        tagged = [i for i in load("resources")["items"] if i["cbsa"]]
        self.assertTrue(tagged)
        for item in tagged:
            self.assertIn(item["cell"], footprint[item["cbsa"]], item["name"])


class DefaultEditionTest(unittest.TestCase):
    def test_the_deployed_page_opens_on_us_with_visible_country_switcher(self):
        html = (ROOT / "web" / "index.html").read_text()
        self.assertIn('data-default-country="us"', html)
        self.assertTrue((ROOT / "web" / "og-image.png").exists())
        self.assertTrue((ROOT / "web" / "og-image-ca.png").exists())
        self.assertIn('class="country-switcher"', html)
        self.assertLess(html.index('value="us"'), html.index('value="ca"'))
        css = (ROOT / "web" / "css" / "style.css").read_text()
        self.assertNotRegex(css, r"#country-picker\s*\{[^}]*opacity:\s*0")


if __name__ == "__main__":
    unittest.main()
