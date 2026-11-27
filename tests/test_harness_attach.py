"""Publishing pull request screenshots (harness/attach.py), against a local bare repository standing in for GitHub."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from harness import attach

PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(64))  # only the bytes matter here, not whether they decode


def git(cwd: Path, *args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True).stdout


@unittest.skipUnless(shutil.which("git"), "needs git")
class AttachTest(unittest.TestCase):
    """One contributor's checkout with work in progress, its remote, and one set of two screenshots published."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)
        cls.remote, cls.repo, cls.shots = cls.tmp / "remote.git", cls.tmp / "repo", cls.tmp / "shots"
        git(cls.tmp, "init", "--quiet", "--bare", str(cls.remote))
        git(cls.tmp, "init", "--quiet", str(cls.repo))
        git(cls.repo, "remote", "add", "origin", str(cls.remote))
        git(cls.repo, "config", "user.name", "A Contributor")
        git(cls.repo, "config", "user.email", "contributor@example.com")
        (cls.repo / "work.txt").write_text("in progress\n")
        git(cls.repo, "add", "work.txt")
        cls.status = git(cls.repo, "status", "--porcelain")
        cls.shots.mkdir()
        cls.published = cls.publish(cls.shot("home.png"), cls.shot("phone home.jpg", b"jpeg bytes"))
        cls.commit = cls.published[0][1].split("/")[-2]

    @classmethod
    def shot(cls, name: str, data: bytes = PNG) -> Path:
        path = cls.shots / name
        path.write_bytes(data)
        return path

    @classmethod
    def publish(cls, *paths: Path):
        return attach.attach(list(paths), repo_name="earthciv/earthciv", repo=cls.repo)

    def remote_refs(self) -> dict[str, str]:
        lines = git(self.remote, "for-each-ref", "--format=%(refname) %(objectname)").decode().splitlines()
        return dict(line.split() for line in lines)

    def test_images_land_on_a_ref_that_no_clone_fetches(self):
        refs = self.remote_refs()
        self.assertEqual(refs[f"refs/pr-screenshots/{self.commit}"], self.commit)
        self.assertFalse([r for r in refs if r.startswith(("refs/heads/", "refs/tags/"))])
        base = f"https://raw.githubusercontent.com/earthciv/earthciv/{self.commit}/"
        self.assertEqual(self.published, [("home.png", base + "home.png"), ("phone-home.jpg", base + "phone-home.jpg")])
        self.assertEqual(git(self.remote, "cat-file", "blob", f"{self.commit}:home.png"), PNG)
        self.assertEqual(git(self.remote, "cat-file", "blob", f"{self.commit}:phone-home.jpg"), b"jpeg bytes")
        self.assertEqual(git(self.remote, "rev-list", "--count", self.commit).strip(), b"1", "no history behind it")
        clone = self.tmp / "clone"  # --no-local: over the wire, as from GitHub, not a copy of the object folder
        git(self.tmp, "clone", "--quiet", "--no-local", str(self.remote), str(clone))
        absent = subprocess.run(["git", "cat-file", "-e", self.commit], cwd=clone, capture_output=True).returncode
        self.assertNotEqual(absent, 0, "a clone does not download the screenshots")

    def test_the_same_files_get_the_same_addresses(self):
        refs = self.remote_refs()
        self.assertEqual(self.publish(self.shots / "home.png", self.shots / "phone home.jpg"), self.published)
        self.assertEqual(self.remote_refs(), refs, "publishing them again changes nothing")
        home = {"home.png": self.shots / "home.png"}
        same, renamed = attach.commit_images(self.repo, home), attach.commit_images(self.repo, {"main.png": home["home.png"]})
        changed = attach.commit_images(self.repo, {"home.png": self.shot("retaken.png", PNG + b"!")})
        self.assertEqual(attach.commit_images(self.repo, home), same)
        self.assertEqual(len({self.commit, same, renamed, changed}), 4, "any other name or byte is another commit")

    def test_the_working_tree_and_index_are_left_alone(self):
        self.assertEqual(git(self.repo, "status", "--porcelain"), self.status)
        self.assertEqual(git(self.repo, "for-each-ref"), b"", "and no local ref is made")

    def test_the_commit_does_not_carry_the_committers_identity(self):
        who = git(self.remote, "log", "-1", "--format=%an <%ae> / %cn <%ce>", self.commit).decode().strip()
        self.assertEqual(who, "EarthCiv screenshots <screenshots@earthciv.invalid> / EarthCiv screenshots <screenshots@earthciv.invalid>")

    def test_only_images_are_published(self):
        refs = self.remote_refs()
        for bad, why in [(self.shot("notes.txt"), "not an image"), (self.shot(".png"), "not an image"),
                         (self.shots / "missing.png", "no such file"),
                         (self.shot("huge.png", b"\0" * (attach.MAX_BYTES + 1)), "over the 5 MB limit")]:
            with self.subTest(bad.name), self.assertRaisesRegex(attach.AttachError, why):
                self.publish(bad)
        with self.assertRaisesRegex(attach.AttachError, "already named a-b.png"):
            self.publish(self.shot("a b.png"), self.shot("a+b.png"))
        with self.assertRaisesRegex(attach.AttachError, "no images given"):
            self.publish()
        self.assertEqual(self.remote_refs(), refs, "a refused set publishes nothing")

    def test_a_remote_outside_github_needs_the_repository_named(self):
        with self.assertRaisesRegex(attach.AttachError, "--repo OWNER/NAME"):
            attach.attach([self.shots / "home.png"], repo=self.repo)
        with self.assertRaisesRegex(attach.AttachError, "is not OWNER/NAME"):
            attach.attach([self.shots / "home.png"], repo_name="https://github.com/earthciv/earthciv", repo=self.repo)
        with self.assertRaisesRegex(attach.AttachError, "git push failed"):
            attach.attach([self.shots / "home.png"], remote="nowhere", repo_name="earthciv/earthciv", repo=self.repo)


class AddressTest(unittest.TestCase):
    def test_github_remotes_in_every_form(self):
        for url in ["git@github.com:earthciv/earthciv.git", "https://github.com/earthciv/earthciv",
                    "https://github.com/earthciv/earthciv.git/", "ssh://git@github.com/earthciv/earthciv.git"]:
            self.assertEqual(attach.github_repo(url), "earthciv/earthciv", url)
        for url in ["/srv/git/earthciv.git", "git@gitlab.com:earthciv/earthciv.git", "https://github.com/earthciv"]:
            self.assertIsNone(attach.github_repo(url), url)

    def test_markdown_is_one_image_per_line(self):
        text = attach.markdown([("lens-income.png", "https://example.org/a/lens-income.png"),
                                ("phone_home.jpg", "https://example.org/a/phone_home.jpg")])
        self.assertEqual(text, "![lens income](https://example.org/a/lens-income.png)\n"
                               "![phone home](https://example.org/a/phone_home.jpg)")


if __name__ == "__main__":
    unittest.main()
