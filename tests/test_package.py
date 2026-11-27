import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.package import _version_scripts


class PackageScriptsTest(unittest.TestCase):
    def test_changing_a_dependency_changes_the_entry_point_directory(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            names = []
            for build, dependency in enumerate(("export const v = 1;", "export const v = 1;", "export const v = 2;")):
                stage = root / str(build)
                scripts = stage / "js"
                (scripts / "app").mkdir(parents=True)
                (scripts / "boot.js").write_text('import "./app/dependency.js";', encoding="utf-8")
                (scripts / "app/dependency.js").write_text(dependency, encoding="utf-8")
                name = _version_scripts(stage)
                names.append(name)
                self.assertTrue((stage / name / "boot.js").is_file())
                self.assertEqual((stage / name / "app/dependency.js").read_text(encoding="utf-8"), dependency)
                self.assertFalse(scripts.exists())
            self.assertEqual(names[0], names[1])
            self.assertNotEqual(names[1], names[2])
