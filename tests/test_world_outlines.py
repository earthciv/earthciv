"""Tests for the world map's country outlines (web/data/world-outlines.json, built by
pipeline/build_world_outlines.py): every country's name is drawn on that country."""

import json
import unittest
from pathlib import Path

from pipeline import build_world_outlines as wo

ROOT = Path(__file__).resolve().parents[1]
OUTLINES_PATH = ROOT / "web" / "data" / "world-outlines.json"


def _area(flat: list[float]) -> float:
    return wo._ring_area(list(zip(flat[0::2], flat[1::2])))


class LabelPointTest(unittest.TestCase):
    def test_every_name_is_drawn_on_its_own_country(self):
        countries = json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))["countries"]
        off = [
            f"{c['id']} {c['name']} {c['center']}"
            for c in countries
            if any(_area(ring) > 0 for ring in c["rings"])
            and not any(wo._in_ring(c["center"][0], c["center"][1], ring) for ring in c["rings"])
        ]
        self.assertEqual(off, [], "these countries' names are drawn off the country")

    def test_a_box_centre_off_the_country_moves_inside_it(self):
        # A C-shaped country whose bounding-box centre, (5, 5), is in the gap of the C.
        ring = [0, 0, 10, 0, 10, 2, 2, 2, 2, 8, 10, 8, 10, 10, 0, 10]
        self.assertFalse(wo._in_ring(5, 5, ring))
        x, y = wo._label_point([5.0, 5.0], [ring])
        self.assertTrue(wo._in_ring(x, y, ring), (x, y))

    def test_a_box_centre_on_the_country_stays(self):
        square = [0, 0, 4, 0, 4, 4, 0, 4]
        self.assertEqual(wo._label_point([2.0, 2.0], [square]), [2.0, 2.0])


class CrimeaTest(unittest.TestCase):
    """Crimea, Sevastopol included, is drawn as part of Ukraine (pipeline/build_world_outlines.py's docstring)."""

    PLACES = {"Simferopol": (34.1, 44.95), "Sevastopol": (33.52, 44.6), "Kerch": (36.47, 45.36),
              "Yevpatoria": (33.37, 45.19)}

    def test_crimea_is_in_ukraines_outline_with_kyiv_and_not_in_russias(self):
        countries = {c["id"]: c for c in json.loads(OUTLINES_PATH.read_text(encoding="utf-8"))["countries"]}
        with_kyiv = [ring for ring in countries["UA"]["rings"] if wo._in_ring(30.52, 50.45, ring)]
        self.assertEqual(len(with_kyiv), 1)
        for name, (x, y) in self.PLACES.items():
            self.assertTrue(wo._in_ring(x, y, with_kyiv[0]), f"{name} is not in Ukraine's outline")
            self.assertFalse(any(wo._in_ring(x, y, ring) for ring in countries["RU"]["rings"]), f"{name} is in Russia's")

    def test_two_rings_sharing_a_border_join_into_one(self):
        left = [[0, 0], [0, 2], [1, 2], [1, 1], [1, 0], [0, 0]]
        right = [[1, 0], [1, 1], [1, 2], [2, 2], [2, 0], [1, 0]]  # shares the edge x = 1, wound the same way
        joined = wo._join_rings(left, right)
        self.assertEqual(joined[0], joined[-1])
        self.assertNotIn([1.0, 1.0], joined)  # the shared edge's inner point is gone
        flat = [v for p in joined[:-1] for v in p]
        self.assertEqual(_area(flat), 4.0)
        self.assertTrue(wo._in_ring(0.5, 1, flat) and wo._in_ring(1.5, 1, flat))
        # Wound the other way, the second ring joins the same.
        self.assertEqual(_area([v for p in wo._join_rings(left, right[::-1])[:-1] for v in p]), 4.0)

    def test_rings_with_no_border_in_common_are_not_joined(self):
        self.assertEqual(wo._join_rings([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
                                        [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]), [])


if __name__ == "__main__":
    unittest.main()
