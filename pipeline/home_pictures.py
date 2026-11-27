"""The pictures on the world map's edition cards: a piece of each edition's own map.

  uv run --group harness python -m playwright install chromium-headless-shell  # once
  uv run --group harness python -m pipeline.home_pictures [edition ...]

Every edition in VIEWS gets two files in its folder: web/data/<id>/home.jpg (the wide card) and home-small.jpg (the
squarer card that phones and low windows show). `"home_pictures": true` in web/data/editions.json tells the world map
that an edition has them (docs/EDITIONS.md).

They are screenshots of the running map with its controls hidden, so a card shows what a visitor finds behind it.
Nothing rebuilds them automatically: run this when the art or the data changes, look at the result and commit it.
The lettering comes from the fonts of the machine it runs on.
"""

from __future__ import annotations

import io
import sys

from .core.paths import WEB

# The browser window the views are framed in (CSS px). A view's zoom is relative to the map's home fit, which
# depends on the window, so the crops below hold only for this size.
WINDOW = (1400, 800)
# Rendered at twice the size and scaled down, which keeps the small lettering on the banners clean.
DENSITY = 2
# name -> (width, height) of the file in px: twice the size the card shows it at, or three times for the small one,
# which mostly meets phone screens.
SIZES = {"home": (716, 208), "home-small": (519, 288)}
JPEG_QUALITY = 86

# edition -> where the map is ("at": x km, y km, zoom, as in the address bar's #at=) and, for each picture, the
# left and top of its crop in the window and the crop's width (CSS px). The height follows from the file's shape.
VIEWS = {
    # The California coast: San Francisco and San Jose, the Central Valley and the Sierra Nevada.
    "us": {"at": (520, 1500, 2.0), "home": (308, 210, 602), "home-small": (307, 125, 314)},
    # Vancouver Island to the Prairies: Vancouver, the Rockies, Calgary and Edmonton.
    "ca": {"at": (1100, 3720, 1.8), "home": (389, 274, 616), "home-small": (382, 280, 314)},
}

# Everything drawn over the map. Hidden rather than removed, so the map keeps the layout its home fit was made for.
HIDE = (
    "#topbar, #lens-area, #minimap-wrap, #btn-minimap, #btn-home, .map-ctrl, #tooltip, #toast, #city-panel"
    " { visibility: hidden !important; }"
)


def crop_box(name: str, left: int, top: int, width: int) -> dict:
    """The part of the window a picture shows, as Playwright's clip (CSS px)."""
    w, h = SIZES[name]
    return {"x": left, "y": top, "width": width, "height": round(width * h / w)}


def render(editions: list[str]) -> None:
    try:
        from PIL import Image
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError as error:
        if error.name not in ("PIL", "playwright"):
            raise
        raise SystemExit("This needs Playwright and Pillow. Run uv run --group harness python -m pipeline.home_pictures.") from error
    from harness.record import serve

    server, port = serve(WEB)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(
                viewport={"width": WINDOW[0], "height": WINDOW[1]}, device_scale_factor=DENSITY,
                locale="en-US", reduced_motion="reduce",
            )
            for edition in editions:
                view = VIEWS[edition]
                x, y, zoom = view["at"]
                page = context.new_page()
                page.goto(f"http://127.0.0.1:{port}/?country={edition}#at={x},{y},{zoom}", wait_until="networkidle")
                page.wait_for_selector("#loading", state="detached")
                page.add_style_tag(content=HIDE)
                page.wait_for_timeout(2000)  # the map draws in passes; let the last one land
                for name, size in SIZES.items():
                    png = page.screenshot(clip=crop_box(name, *view[name]), animations="disabled", caret="hide")
                    picture = Image.open(io.BytesIO(png)).convert("RGB").resize(size, Image.LANCZOS)
                    out = WEB / "data" / edition / f"{name}.jpg"
                    picture.save(out, quality=JPEG_QUALITY, optimize=True, progressive=True)
                    print(f"{out.relative_to(WEB.parent)}  {size[0]}x{size[1]}  {out.stat().st_size / 1000:.0f} kB")
                page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


def main(argv: list[str] | None = None) -> None:
    names = list(sys.argv[1:] if argv is None else argv)
    unknown = [n for n in names if n not in VIEWS]
    if unknown:
        sys.exit(f"no view for: {', '.join(unknown)}  (pipeline/home_pictures.py VIEWS has: {', '.join(VIEWS)})")
    render(names or list(VIEWS))


if __name__ == "__main__":
    main()
