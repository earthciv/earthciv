"""The harness's allow rules (harness/diff.py). Runs only where Pillow is installed (`uv run --group harness`)."""

import unittest

try:
    from PIL import Image

    from harness.diff import _covered, allowed
except ImportError:  # the default environment is standard library only
    Image = None


@unittest.skipUnless(Image, "needs the harness dependency group")
class AllowRuleTest(unittest.TestCase):
    def mask(self, *points):
        m = Image.new("L", (100, 50), 0)
        for xy in points:
            m.putpixel(xy, 255)
        return m

    def test_boxes_cover_only_what_they_name(self):
        m = self.mask((10, 10), (80, 40))
        self.assertTrue(_covered(m, [[5, 5, 15, 15], [75, 35, 90, 45]]))
        self.assertFalse(_covered(m, [[5, 5, 15, 15]]))
        self.assertFalse(_covered(m, [[5, 5, 10, 10], [75, 35, 90, 45]]), "x1 and y1 are exclusive")

    def test_matching_rules_pool_their_boxes(self):
        diff = {"view": "us/cityview-largest", "kind": "pixels", "mask": self.mask((10, 10), (80, 40))}
        caret = {"views": "us/*", "kinds": ["pixels"], "within": [[5, 5, 15, 15]], "reason": "caret"}
        dock = {"views": "*/cityview-*", "kinds": ["pixels"], "within": [[75, 35, 90, 45]], "reason": "dock"}
        self.assertIsNone(allowed(diff, [caret]))
        self.assertEqual(allowed(diff, [caret, dock]), "caret; dock")
        self.assertIsNone(allowed({**diff, "view": "ca/cityview-largest"}, [caret, dock]))

    def test_a_rule_without_boxes_allows_the_whole_difference(self):
        diff = {"view": "ca/help", "kind": "pixels", "mask": self.mask((1, 1))}
        self.assertEqual(allowed(diff, [{"views": "ca/help", "kinds": ["pixels"], "reason": "fix"}]), "fix")
        self.assertIsNone(allowed({**diff, "mask": None}, [{"views": "*", "kinds": ["pixels"], "within": [[0, 0, 9, 9]]}]))


if __name__ == "__main__":
    unittest.main()
