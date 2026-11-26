"""Compare two recordings view by view, and fail unless every difference is on a reviewed allow-list.

A difference has a kind: `missing` (the view is in one run only), `failed` (the view broke in one run), `text`
(visible text), `outline` (elements and their attributes), `pixels` (the screenshot or share image), `messages`
(console errors and warnings) or `requests` (data files loaded).

An allow-list is a JSON list of rules: {"views": "ca/lens-*", "kinds": ["text"], "reason": "..."}. `views` is a glob
on "<edition>/<view id>"; `kinds` defaults to every kind. A difference is allowed when some rule matches it.
"""

from __future__ import annotations

import difflib
import fnmatch
import json
from pathlib import Path

from PIL import Image, ImageChops

MAX_DIFF_LINES = 40


def _load(run: Path) -> dict:
    meta = json.loads((run / "run.json").read_text())
    return {ed: {v["id"]: v for v in e["views"]} for ed, e in meta["editions"].items()}


def _read(path: Path) -> str | None:
    return path.read_text() if path.exists() else None


def _text_diff(a: str, b: str, name: str) -> list[str]:
    lines = list(difflib.unified_diff(a.splitlines(), b.splitlines(), f"a/{name}", f"b/{name}", n=1, lineterm=""))
    if len(lines) > MAX_DIFF_LINES:
        lines = lines[:MAX_DIFF_LINES] + [f"... ({len(lines) - MAX_DIFF_LINES} more diff lines)"]
    return lines


def pixel_difference(a: Path, b: Path) -> str | None:
    """None when the images are identical pixel for pixel, else a short description."""
    if not a.exists() or not b.exists():
        return "image missing in one run"
    if a.read_bytes() == b.read_bytes():
        return None
    ia, ib = Image.open(a).convert("RGBA"), Image.open(b).convert("RGBA")
    if ia.size != ib.size:
        return f"size {ia.size} -> {ib.size}"
    mask = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v else 0)
    n = mask.histogram()[255]
    if not n:
        return None
    return f"{n} px differ ({100 * n / (ia.size[0] * ia.size[1]):.2f}%), within {mask.getbbox()}"


def compare(a: Path, b: Path) -> list[dict]:
    ra, rb = _load(a), _load(b)
    out = []
    for ed in sorted(set(ra) | set(rb)):
        va, vb = ra.get(ed, {}), rb.get(ed, {})
        for vid in sorted(set(va) | set(vb)):
            key = f"{ed}/{vid}"
            if vid not in va or vid not in vb:
                out.append({"view": key, "kind": "missing", "detail": [f"only in {'b' if vid in vb else 'a'}"]})
                continue
            x, y = va[vid], vb[vid]
            if x.get("failed") or y.get("failed"):
                if x.get("failed") != y.get("failed"):
                    out.append({"view": key, "kind": "failed", "detail": [f"a: {x.get('failed')}", f"b: {y.get('failed')}"]})
                continue
            for suffix, kind in ((".txt", "text"), (".outline.txt", "outline")):
                ta, tb = _read(a / ed / f"{vid}{suffix}"), _read(b / ed / f"{vid}{suffix}")
                if ta != tb:
                    out.append({"view": key, "kind": kind, "detail": _text_diff(ta or "", tb or "", f"{vid}{suffix}")})
            images = [f"{vid}.png"] + (["share.image.png"] if vid == "share" else [])
            for img in images:
                d = pixel_difference(a / ed / img, b / ed / img)
                if d:
                    out.append({"view": key, "kind": "pixels", "detail": [f"{img}: {d}"]})
            for field, kind in (("messages", "messages"), ("requests", "requests")):
                if x.get(field, []) != y.get(field, []):
                    gone = sorted(set(x.get(field, [])) - set(y.get(field, [])))
                    new = sorted(set(y.get(field, [])) - set(x.get(field, [])))
                    out.append({"view": key, "kind": kind, "detail": [f"- {m}" for m in gone] + [f"+ {m}" for m in new]})
    return out


def allowed(diff: dict, rules: list[dict]) -> str | None:
    for r in rules:
        if fnmatch.fnmatch(diff["view"], r["views"]) and diff["kind"] in r.get("kinds", [diff["kind"]]):
            return r.get("reason", "allowed")
    return None


def report(a: Path, b: Path, allow: Path | None = None) -> tuple[int, str]:
    rules = json.loads(allow.read_text()) if allow else []
    diffs = compare(a, b)
    lines = [f"# Harness diff: {a.name} -> {b.name}", ""]
    bad = 0
    for d in diffs:
        reason = allowed(d, rules)
        bad += reason is None
        lines.append(f"## {d['view']} · {d['kind']} · {'allowed: ' + reason if reason else 'NOT ALLOWED'}")
        lines += ["```", *d["detail"], "```", ""]
    views = sum(len(v) for v in _load(b).values())
    lines.insert(1, f"{views} views; {len(diffs)} differences, {len(diffs) - bad} allowed, {bad} not allowed.")
    return (1 if bad else 0), "\n".join(lines) + "\n"
