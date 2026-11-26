"""Generate compact Natural Earth world country outlines for the All Ports atlas view.

Reads the archived Natural Earth 1:50m admin-0 GeoJSON in data/raw/canada/admin_0_countries.json
and writes a lightweight web/data/world-outlines.json (standard library only, deterministic output).

Usage:
    uv run python -m pipeline.build_world_outlines
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from .core.paths import ROOT, WEB

SRC = ROOT / "data" / "raw" / "canada" / "admin_0_countries.json"
OUT = WEB / "data" / "world-outlines.json"

# Simplification tolerance in degrees (~0.22° ≈ 24 km at equator) and minimum ring area (deg²).
EPS_DEG = 0.22
MIN_RING_AREA = 0.04
MIN_LAT = -60.0  # omit Antarctica for a balanced world atlas framing
MAX_LAT = 84.0


def _perp_dist(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) <= 3:
        return pts
    stack = [(0, len(pts) - 1)]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    while stack:
        a, b = stack.pop()
        x1, y1 = pts[a]
        x2, y2 = pts[b]
        best_i, best_d = -1, -1.0
        for i in range(a + 1, b):
            d = _perp_dist(pts[i][0], pts[i][1], x1, y1, x2, y2)
            if d > best_d:
                best_d = d
                best_i = i
        if best_d > eps and best_i >= 0:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [p for p, k in zip(pts, keep) if k]


def _ring_area(pts: list[tuple[float, float]]) -> float:
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def _ring_bbox_center(pts: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def _country_code(props: dict) -> str:
    for key in ("ISO_A2_EH", "ISO_A2", "WB_A2", "ADM0_A3"):
        val = str(props.get(key) or "").strip()
        if val and val != "-99":
            return val
    return str(props.get("NAME") or "XX")


def _extract_polygons(geom: dict) -> list[list[tuple[float, float]]]:
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    rings: list[list[tuple[float, float]]] = []
    if gtype == "Polygon" and coords:
        rings.append([(float(x), float(y)) for x, y in coords[0]])
    elif gtype == "MultiPolygon":
        for poly in coords:
            if poly and poly[0]:
                rings.append([(float(x), float(y)) for x, y in poly[0]])
    return rings


def _clean_ring(pts: list[tuple[float, float]]) -> list[float]:
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return []
    # Clamp latitudes to the atlas frame and simplify.
    clamped = [(max(-180.0, min(180.0, x)), max(MIN_LAT, min(MAX_LAT, y))) for x, y in pts]
    simp = _rdp(clamped, EPS_DEG)
    if len(simp) < 3:
        simp = clamped[:3]
    flat: list[float] = []
    last_x = last_y = None
    for x, y in simp:
        rx, ry = round(x, 1), round(y, 1)
        if rx == last_x and ry == last_y:
            continue
        flat.extend((rx, ry))
        last_x, last_y = rx, ry
    return flat if len(flat) >= 6 else []


def build(src: Path = SRC, out: Path = OUT) -> dict:
    raw = json.loads(src.read_text(encoding="utf-8"))
    by_code: dict[str, dict] = {}
    for feat in raw.get("features", []):
        props = feat.get("properties") or {}
        code = _country_code(props)
        if code == "AQ":
            continue
        geom = feat.get("geometry") or {}
        rings_raw = _extract_polygons(geom)
        if not rings_raw:
            continue
        scored = [(_ring_area(r), r) for r in rings_raw]
        scored.sort(key=lambda item: item[0], reverse=True)
        # Keep the largest polygon even for tiny states (Singapore, Malta, Luxembourg, etc.)
        kept_rings: list[list[float]] = []
        best_area = scored[0][0]
        best_ring = scored[0][1]
        for idx, (area, ring) in enumerate(scored):
            if idx > 0 and area < MIN_RING_AREA:
                continue
            flat = _clean_ring(ring)
            if flat:
                kept_rings.append(flat)
        if not kept_rings:
            # Tiny island nation collapsed under simplification: keep a minimal diamond around its center
            cx, cy = _ring_bbox_center(best_ring)
            d = 0.2
            kept_rings.append([round(cx - d, 1), round(cy, 1), round(cx, 1), round(cy + d, 1),
                               round(cx + d, 1), round(cy, 1), round(cx, 1), round(cy - d, 1)])
        cx, cy = _ring_bbox_center(best_ring)
        entry = by_code.get(code)
        if entry is None:
            by_code[code] = {
                "id": code,
                "name": str(props.get("NAME") or props.get("ADMIN") or code),
                "continent": str(props.get("CONTINENT") or ""),
                "center": [round(cx, 1), round(cy, 1)],
                "rings": kept_rings,
                "_area": best_area,
            }
        else:
            entry["rings"].extend(kept_rings)
            if best_area > entry["_area"]:
                entry["_area"] = best_area
                entry["center"] = [round(cx, 1), round(cy, 1)]

    countries = []
    for code in sorted(by_code):
        item = by_code[code]
        item.pop("_area", None)
        countries.append(item)

    payload = {
        "version": 1,
        "source": "Natural Earth 1:50m Admin 0 Countries (public domain)",
        "bounds": [-180, MIN_LAT, 180, MAX_LAT],
        "countries": countries,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main() -> None:
    payload = build()
    size_kb = OUT.stat().st_size / 1024.0
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(payload['countries'])} countries, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
