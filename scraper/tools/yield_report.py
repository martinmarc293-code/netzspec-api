"""yield_report — pages fetched vs pages that yielded facts, per source, from runs/acquired/.
A source with many pages and no facts is a broken adapter (or a listing-only crawl); this is the
number to look at before believing a crawl did anything.

    python3.11 scraper/tools/yield_report.py [--date YYYY-MM-DD]
"""
from __future__ import annotations
import argparse, json, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    a = ap.parse_args()
    base = ROOT / "runs" / "acquired"
    pages, with_facts, facts, skus, listings = Counter(), Counter(), Counter(), Counter(), Counter()
    for f in base.glob("*/*/*.json"):
        src, day = f.parts[-3], f.parts[-2]
        if a.date and day != a.date:
            continue
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa
            continue
        r = j.get("result") or {}
        kind = (j.get("task") or {}).get("task", "")
        others = r.get("others") or []
        n = len(r.get("facts") or []) + sum(len(o.get("facts") or []) for o in others)
        pages[src] += 1
        if kind in ("listing", "search"):
            listings[src] += 1
        if n:
            with_facts[src] += 1
            facts[src] += n
            skus[src] += (1 if r.get("sku") else 0) + sum(1 for o in others if o.get("sku"))
    if not pages:
        print("no acquired pages" + (f" for {a.date}" if a.date else "")); return 0
    print(f"{'source':16} {'pages':>6} {'listings':>9} {'with_facts':>11} {'raw_facts':>10} {'sku_entries':>12}  note")
    for s in sorted(pages):
        content_pages = pages[s] - listings[s]
        note = "ZERO YIELD: check the adapter" if content_pages >= 5 and with_facts[s] == 0 else ""
        print(f"{s:16} {pages[s]:6} {listings[s]:9} {with_facts[s]:11} {facts[s]:10} {skus[s]:12}  {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
