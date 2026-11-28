"""Build the deploy package: one file, usaciv.zip in the project root. It unzips to a usaciv/ folder holding the static
site, ready to upload as /usaciv/. (dist/usaciv/ is the same folder unzipped, kept for local testing.)

The site gets a copy of the source code as usaciv-source.zip, linked from the in-app help, so anyone can download,
run and remix it. Archive entries are sorted and given fixed timestamps. Social cards are rendered with headless Chromium,
for the share pages and for each map's own page (/map/<id>/, pipeline/share_pages.py).
robots.txt and sitemap.xml are written from the site's address (index.html's og:url) and the edition index.
"""

from __future__ import annotations

import shutil
import zipfile
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

from .core.paths import ROOT, WEB
from .share_pages import build_share_pages
from .sitemap import build_crawler_files

NAME = "usaciv"
DIST = ROOT / "dist"
SITE = DIST / NAME
SOURCE_ZIP = f"{NAME}-source.zip"

# What goes into the source zip (relative to ROOT). Downloads, caches and build output are left out: anyone can
# recreate them with `uv run python -m pipeline all`.
SOURCE_ITEMS = [
    "README.md", "LICENSE", "pyproject.toml", "uv.lock", ".gitignore", "wrangler.toml",
    "docs", "functions", "harness", "pipeline", "tests", "web",
]
SKIP_NAMES = {"__pycache__", ".DS_Store"}
SKIP_SUFFIXES = {".pyc", ".part"}
# Dev-only pages (art gallery, trailer maker) ship in the source zip but not on the public site.
SITE_SKIP_DIRS = {"dev"}

ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def _files(base: Path, rel_items):
    for item in rel_items:
        p = base / item
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not (SKIP_NAMES & set(f.relative_to(base).parts)) and f.suffix not in SKIP_SUFFIXES:
                    yield f


def _zip(path: Path, files, base: Path, prefix: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(set(files), key=lambda f: f.relative_to(base).as_posix()):
            info = zipfile.ZipInfo(f"{prefix}/{f.relative_to(base).as_posix()}", ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, f.read_bytes(), compresslevel=9)
    tmp.replace(path)
    return path.stat().st_size


def _version_scripts(stage: Path) -> str:
    """Give the entire module graph a fresh URL when any of its files change."""
    scripts = stage / "js"
    digest = sha256()
    for path in _files(scripts, ["."]):
        digest.update(path.relative_to(scripts).as_posix().encode("utf-8") + b"\0")
        digest.update(sha256(path.read_bytes()).digest())
    # Keep the directory at the same depth so relative imports and URLs to data, CSS and share pages still resolve.
    name = f"js-{digest.hexdigest()[:16]}"
    scripts.rename(stage / name)
    return name


def cmd_package() -> None:
    missing = [p for p in ("data/us/cities.json", "data/us/world.json", "index.html") if not (WEB / p).exists()]
    if missing:
        raise SystemExit(f"web/ is incomplete ({', '.join(missing)} missing): run `uv run python -m pipeline all` first")
    DIST.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=DIST) as temp:
        stage = Path(temp) / NAME
        stage.mkdir()
        # 1. The site: web/ without the dev pages, plus generated social previews, robots.txt and sitemap.xml.
        for f in _files(WEB, ["."]):
            rel = f.relative_to(WEB)
            if rel.parts[0] in SITE_SKIP_DIRS:
                continue
            dst = stage / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
        scripts = _version_scripts(stage)
        index = stage / "index.html"
        # The share pages and every map's own page (/map/<id>/) are built below: the page links to them from now on.
        page = index.read_text(encoding="utf-8").replace("<html ", "<html data-share-pages data-map-pages ", 1)
        page = page.replace('src="js/boot.js"', f'src="{scripts}/boot.js"', 1)
        index.write_text(page, encoding="utf-8")
        share_count, map_count = build_share_pages(WEB, stage, scripts)
        page_count = build_crawler_files(WEB, stage)
        n_site = sum(1 for _ in _files(stage, ["."]))

        # 2. The source code, served next to the site.
        src_files = list(_files(ROOT, SOURCE_ITEMS))
        src_size = _zip(stage / SOURCE_ZIP, src_files, ROOT, NAME)

        # 3. The whole site as one zip, for uploading.
        bundle = ROOT / f"{NAME}.zip"
        site_size = _zip(bundle, _files(stage, ["."]), stage, NAME)
        if SITE.exists():
            shutil.rmtree(SITE)
        stage.rename(SITE)
    (DIST / f"{NAME}-site.zip").unlink(missing_ok=True)  # older layout

    mb = lambda b: f"{b / 1e6:.1f} MB"
    print(f"{bundle.name}  ({mb(site_size)})  ← upload this: it unzips to {NAME}/ ({n_site} site files + {SOURCE_ZIP})")
    print(f"  {share_count} share pages and {map_count} maps' own pages, with preview images")
    print(f"  robots.txt and sitemap.xml ({page_count} pages)")
    print(f"  {SOURCE_ZIP}: {len(src_files)} files, {mb(src_size)}")
