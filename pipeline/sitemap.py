"""robots.txt and sitemap.xml for the deployed site.

One index.html serves every page: the world map at the site's address and each edition at ?country=<id>
(web/js/app/home.js). The sitemap lists those addresses. They are built from index.html's og:url, the site's public
address, and from data/editions.json, so a new edition is listed without editing this file. The /share/ pages and
the maps' own /map/<id>/ pages stay out: they exist for link previews and send visitors on to the map.
"""

from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path
from urllib.parse import urlencode
from xml.sax.saxutils import escape

SITEMAP = "sitemap.xml"


def site_address(index_html: str) -> str:
    """The site's public address, from index.html's og:url, such as https://earthciv.org/."""
    tag = re.search(r'<meta property="og:url" content="([^"]+)">', index_html)
    if not tag:
        raise ValueError("index.html needs <meta property=\"og:url\"> with the site's address.")
    url = unescape(tag[1])
    if not re.fullmatch(r"https?://[^/?#]+(/[^?#]*)?/", url):
        raise ValueError(f"og:url should be the site's own address, ending in /, such as https://earthciv.org/: {url!r}")
    return url


def page_urls(web: Path) -> list[str]:
    """The world map's address, then each edition's (?country=<id>) in the order of editions.json."""
    site = site_address((web / "index.html").read_text(encoding="utf-8"))
    editions = json.loads((web / "data" / "editions.json").read_text(encoding="utf-8"))["editions"]
    return [site, *(f"{site}?{urlencode({'country': edition['id']})}" for edition in editions)]


def build_crawler_files(web: Path, out: Path) -> int:
    """Write robots.txt and sitemap.xml into the packaged site. Returns the number of pages listed."""
    urls = page_urls(web)
    (out / "robots.txt").write_text(
        "# Everything may be crawled: the map's scripts and data files are what draw it.\n"
        f"User-agent: *\nAllow: /\n\nSitemap: {urls[0]}{SITEMAP}\n",
        encoding="utf-8",
    )
    entries = "".join(f"  <url><loc>{escape(url)}</loc></url>\n" for url in urls)
    (out / SITEMAP).write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}</urlset>\n",
        encoding="utf-8",
    )
    return len(urls)
