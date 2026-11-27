"""Command line for the browser harness (docs/HARNESS.md).

  uv run --group harness python -m harness record [--site web] [--edition us --edition ca] [--out out/harness/NAME]
                                                  [--workers 3] [--only GLOB]
  uv run --group harness python -m harness diff RUN_A RUN_B [--allow harness/allow/NAME.json] [--report FILE]
  uv run python -m harness attach IMAGE [IMAGE ...] [--remote origin] [--repo OWNER/NAME]

`record` exits 1 if a view failed or never settled. `diff` exits 1 unless every difference is allowed. `attach`
publishes screenshots for a pull request and prints the Markdown for its description; it exits 1 if a file is not an
image, the push is refused or GitHub does not serve the images afterwards.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="harness", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record", help="record every view of the given editions")
    r.add_argument("--site", type=Path, default=ROOT / "web", help="the static site to serve (default: web/)")
    r.add_argument("--edition", action="append", help="edition id, repeatable (default: us and ca)")
    r.add_argument("--out", type=Path, help="output directory (default: out/harness/<timestamp>)")
    r.add_argument("--workers", type=int, default=3, help="pages recorded at once")
    r.add_argument("--only", help="only views whose id matches this glob")
    d = sub.add_parser("diff", help="compare two recordings")
    d.add_argument("a", type=Path)
    d.add_argument("b", type=Path)
    d.add_argument("--allow", type=Path, help="allow-list of reviewed differences (JSON)")
    d.add_argument("--report", type=Path, help="also write the report to this file")
    t = sub.add_parser("attach", help="publish screenshots and print the Markdown for a pull request description")
    t.add_argument("images", type=Path, nargs="+", help="PNG, JPEG, GIF or WebP files")
    t.add_argument("--remote", default="origin", help="the remote to publish to (default: origin)")
    t.add_argument("--repo", help="OWNER/NAME for the addresses (default: read from the remote's URL)")
    a = p.parse_args(argv)

    if a.cmd == "attach":
        from . import attach

        try:
            published = attach.attach(a.images, a.remote, a.repo)
        except attach.AttachError as exc:
            print(f"attach: {exc}", file=sys.stderr)
            return 1
        print(attach.markdown(published))
        if not attach.served(published[0][1]):
            print(f"attach: pushed, but GitHub does not serve {published[0][1]}. Open it before relying on it.",
                  file=sys.stderr)
            return 1
        return 0

    if a.cmd == "record":
        from .record import record

        out = a.out or ROOT / "out" / "harness" / datetime.now().strftime("%Y%m%d-%H%M%S")
        print(f"recording {a.site} -> {out}")
        meta = asyncio.run(record(a.site, a.edition or ["us", "ca"], out, a.workers, a.only))
        bad = [f"{ed}/{v['id']}" for ed, e in meta["editions"].items() for v in e["views"] if v.get("failed") or v.get("unsettled")]
        for b in bad:
            print(f"  not clean: {b}")
        return 1 if bad else 0
    from .diff import report

    code, text = report(a.a, a.b, a.allow)
    if a.report:
        a.report.write_text(text)
    print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
