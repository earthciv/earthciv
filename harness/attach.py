"""Publish screenshots for a pull request's description (AGENTS.md, docs/HARNESS.md).

GitHub has no API for the images people drag into a pull request, and screenshots committed to the branch would stay
in `main`'s history. So each set of screenshots becomes one commit that no branch contains, pushed to
`refs/pr-screenshots/<commit>` on the remote. GitHub serves a commit's files by its id, and a clone or fetch never
downloads a ref outside `refs/heads` and `refs/tags`. The commit is made from the files' names and bytes alone (fixed
author and date), so attaching the same files again gives the same addresses, and nothing published is ever replaced.

Standard library only: it needs git and push access to the remote, not the harness dependency group.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF_PREFIX = "refs/pr-screenshots/"
IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
MAX_BYTES = 5 * 1024 * 1024
# The commit says nothing about who made it: a fixed author and date keep the committer's own name and email out of
# a public repository, and make the commit depend on the images alone.
IDENTITY = {
    "GIT_AUTHOR_NAME": "EarthCiv screenshots",
    "GIT_AUTHOR_EMAIL": "screenshots@earthciv.invalid",
    "GIT_AUTHOR_DATE": "2000-01-01T00:00:00+0000",
    "GIT_COMMITTER_NAME": "EarthCiv screenshots",
    "GIT_COMMITTER_EMAIL": "screenshots@earthciv.invalid",
    "GIT_COMMITTER_DATE": "2000-01-01T00:00:00+0000",
}


class AttachError(Exception):
    """Something the caller can fix: a file that is not an image, a remote that is not on GitHub, a refused push."""


def _git(repo: Path, *args: str, stdin: str | None = None) -> str:
    try:
        r = subprocess.run(["git", *args], cwd=repo, input=stdin, capture_output=True, text=True,
                           env={**os.environ, **IDENTITY})
    except OSError as exc:
        raise AttachError(f"could not run git: {exc}") from exc
    if r.returncode:
        raise AttachError(f"git {args[0]} failed: {(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def github_repo(url: str) -> str | None:
    """`owner/name` from a github.com remote URL (https, ssh or scp form), or None for any other remote."""
    m = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", url.strip())
    return f"{m.group(1)}/{m.group(2)}" if m else None


def image_name(path: Path) -> str:
    """The file's name as it appears in its address: letters, digits, dashes and underscores, then its type."""
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", path.stem).strip("-")
    suffix = path.suffix.lower()
    if suffix not in IMAGE_TYPES or not stem:
        raise AttachError(f"{path}: not an image file ({', '.join(IMAGE_TYPES)})")
    return stem + suffix


def commit_images(repo: Path, images: dict[str, Path]) -> str:
    """One parentless commit holding `images` (name -> file). The same names and bytes always give the same commit.

    Built from git's plumbing, so neither the working tree nor the index of `repo` is touched."""
    entries = "".join(f"100644 blob {_git(repo, 'hash-object', '-w', '--no-filters', '--', str(path))}\t{name}\n"
                      for name, path in sorted(images.items()))
    tree = _git(repo, "mktree", stdin=entries)
    return _git(repo, "commit-tree", tree, "-m", "Pull request screenshots")


def attach(paths: list[Path], remote: str = "origin", repo_name: str | None = None, repo: Path = ROOT) -> list[tuple[str, str]]:
    """Publish the images to `remote` and return (name, address) pairs in the order given."""
    images: dict[str, Path] = {}
    for path in paths:
        path = Path(path).resolve()
        if not path.is_file():
            raise AttachError(f"{path}: no such file")
        size = path.stat().st_size
        if size > MAX_BYTES:
            raise AttachError(f"{path}: {size / 1e6:.1f} MB is over the {MAX_BYTES // 2**20} MB limit. "
                              "Crop it, capture at a lower scale or save it as JPEG.")
        name = image_name(path)
        if name in images:
            raise AttachError(f"{path}: another image is already named {name}")
        images[name] = path
    if not images:
        raise AttachError("no images given")
    if repo_name is None:
        repo_name = github_repo(_git(repo, "remote", "get-url", "--push", remote))
        if not repo_name:
            raise AttachError(f"the remote {remote!r} is not a github.com repository: pass --repo OWNER/NAME")
    elif not re.fullmatch(r"[\w.-]+/[\w.-]+", repo_name):
        raise AttachError(f"--repo {repo_name!r} is not OWNER/NAME")
    commit = commit_images(repo, images)
    _git(repo, "push", "--quiet", remote, f"{commit}:{REF_PREFIX}{commit}")
    return [(name, f"https://raw.githubusercontent.com/{repo_name}/{commit}/{name}") for name in images]


def markdown(published: list[tuple[str, str]]) -> str:
    """One Markdown image per line, ready for a pull request description."""
    return "\n".join(f"![{Path(name).stem.replace('-', ' ').replace('_', ' ')}]({url})" for name, url in published)


def served(url: str, tries: int = 5, wait_s: float = 2.0) -> bool:
    """True once GitHub serves the address. It can lag the push by a moment, hence the retries."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=10) as response:
                if response.status == 200:
                    return True
        except OSError:  # URLError and HTTPError are OSErrors: not there yet, or no network
            pass
        if attempt + 1 < tries:
            time.sleep(wait_s)
    return False
