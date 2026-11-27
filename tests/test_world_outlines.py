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


if __name__ == "__main__":
    unittest.main()
