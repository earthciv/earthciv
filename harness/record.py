"""Record each view of each edition: a screenshot, the visible text, an outline of the page and what it loaded.

The page side is web/dev/snap.js (added to every page before the app's own scripts); this module serves a site
directory, opens one fresh page per view in headless Chromium and writes what the page side reports.
"""

from __future__ import annotations

import asyncio
import fnmatch
import functools
import http.server
import json
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SNAP_JS = ROOT / "web" / "dev" / "snap.js"
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "phone": {"width": 390, "height": 844}}
NET_QUIET_S = 0.5  # no request in flight for this long
VIEW_TIMEOUT_S = 90


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    # Windows' registry often maps .js to text/plain, which browsers refuse for module scripts.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,  # noqa: RUF012
                      ".js": "text/javascript", ".mjs": "text/javascript"}

    def log_message(self, *args):
        pass


def serve(directory: Path):
    """A static server for `directory` on a free local port, in a daemon thread."""
    handler = functools.partial(_QuietHandler, directory=str(directory))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def git_head() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "web"], cwd=ROOT, capture_output=True, text=True).stdout
        return out.stdout.strip() + ("+dirty" if dirty.strip() else "")
    except (OSError, subprocess.CalledProcessError):
        return None


async def _net_quiet(inflight: set, timeout: float = 30) -> bool:
    t0 = last_busy = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if inflight:
            last_busy = time.monotonic()
        elif time.monotonic() - last_busy >= NET_QUIET_S:
            return True
        await asyncio.sleep(0.05)
    return False


async def new_context(browser, viewport: str):
    """A fresh context per view: views recorded side by side must not share storage (the app remembers recent lenses
    and panel settings in localStorage)."""
    ctx = await browser.new_context(viewport=VIEWPORTS[viewport], device_scale_factor=1, locale="en-US",
                                    timezone_id="UTC", accept_downloads=True)
    await ctx.add_init_script(path=str(SNAP_JS))
    return ctx


async def record_view(browser, url: str, view: dict, dest: Path) -> dict:
    ctx = await new_context(browser, view["viewport"])
    page = await ctx.new_page()
    messages, requests, inflight = [], set(), set()
    origin = urlsplit(url)

    def on_request(r):
        inflight.add(r)
        u = urlsplit(r.url)
        if u.netloc == origin.netloc and "/data/" in u.path:
            requests.add(u.path)

    page.on("console", lambda m: messages.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: messages.append(f"pageerror: {e}"))
    page.on("request", on_request)
    page.on("requestfinished", lambda r: inflight.discard(r))
    page.on("requestfailed", lambda r: (inflight.discard(r), messages.append(f"requestfailed: {urlsplit(r.url).path}")))
    result = {"id": view["id"], "viewport": view["viewport"], "hash": view["hash"], "steps": view["steps"],
              "note": view.get("note")}
    try:
        await page.goto(url + view["hash"], wait_until="load")
        await page.evaluate("v => __snap.apply(window, v)", view)
        quiet = await _net_quiet(inflight)
        idle = await page.evaluate("() => __snap.settle(window)")
        if not (quiet and idle):
            result["unsettled"] = True
        await page.screenshot(path=str(dest / f"{view['id']}.png"), animations="disabled", caret="hide")
        cap = await page.evaluate("() => __snap.capture(window)")
        (dest / f"{view['id']}.txt").write_text(f"title: {cap['title']}\nhash: {cap['hash']}\n\n{cap['text']}\n")
        (dest / f"{view['id']}.outline.txt").write_text(cap["outline"] + "\n")
        if view["id"] == "share":
            async with page.expect_download() as dl:
                await page.click('#share-pop [data-act="image"]')
            await (await dl.value).save_as(dest / "share.image.png")
            await _net_quiet(inflight)
    except Exception as exc:  # a broken view is a result, not a crash of the whole run
        result["failed"] = f"{type(exc).__name__}: {exc}".splitlines()[0][:300]
    finally:
        await ctx.close()
    result["messages"] = messages
    result["requests"] = sorted(requests)
    return result


async def record(site: Path, editions: list[str], out: Path, workers: int = 3, only: str | None = None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    srv, port = serve(site)
    meta = {"site": str(site), "commit": git_head(), "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "viewports": VIEWPORTS, "editions": {}}
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            meta["browser"] = f"Chromium {browser.version}"
            for ed in editions:
                url = f"http://127.0.0.1:{port}/index.html?country={ed}"
                lister_ctx = await new_context(browser, "desktop")
                lister = await lister_ctx.new_page()
                await lister.goto(url, wait_until="load")
                views = await lister.evaluate("() => __snap.views(window)")
                await lister_ctx.close()
                if only:
                    views = [v for v in views if fnmatch.fnmatch(v["id"], only)]
                dest = out / ed
                dest.mkdir(parents=True, exist_ok=True)
                sem = asyncio.Semaphore(workers)

                async def one(v):
                    async with sem:
                        return await asyncio.wait_for(record_view(browser, url, v, dest), VIEW_TIMEOUT_S)

                t0 = time.monotonic()
                results = await asyncio.gather(*(one(v) for v in views), return_exceptions=True)
                rows = []
                for v, r in zip(views, results):
                    rows.append(r if isinstance(r, dict) else {"id": v["id"], "viewport": v["viewport"], "failed": repr(r)})
                meta["editions"][ed] = {"url": url, "seconds": round(time.monotonic() - t0, 1), "views": rows}
                bad = [r["id"] for r in rows if r.get("failed") or r.get("unsettled")]
                print(f"  {ed}: {len(rows)} views in {meta['editions'][ed]['seconds']} s"
                      + (f"; not clean: {', '.join(bad)}" if bad else ""))
            await browser.close()
    finally:
        srv.shutdown()
    (out / "run.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")
    return meta
