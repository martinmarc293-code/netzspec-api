#!/usr/bin/env python
"""netzspec scraper CLI. Runs an adapter with a real browser, writes facts to
data/universe/{source}_{date}.json. The Node upsert (scripts/universe/apply-lifecycle.mjs)
then writes them to Mongo. Both you and Claude can run this.

Examples:
  python scraper/run.py cisco-eol --series catalyst-2960-x-series-switches,catalyst-3850-series-switches,catalyst-3650-series-switches
  python scraper/run.py cisco-eol --series catalyst-9300-series-switches --headed   # watch it / pass a challenge
Then:
  node scripts/universe/apply-lifecycle.mjs data/universe/cisco-eol_<date>.json --commit
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

ADAPTERS = {"cisco-eol": ("adapters.cisco_eol", "cisco-eol")}

def main() -> int:
    ap = argparse.ArgumentParser(description="netzspec data-completion scraper")
    ap.add_argument("adapter", choices=list(ADAPTERS))
    ap.add_argument("--series", default="", help="comma-separated Cisco series slugs (for cisco-eol)")
    ap.add_argument("--headed", action="store_true", help="run a visible browser (to watch or pass a challenge)")
    args = ap.parse_args()

    modname, source = ADAPTERS[args.adapter]
    import importlib
    mod = importlib.import_module(modname)

    br = netzscrape.PoliteBrowser(headless=not args.headed)
    try:
        if args.adapter == "cisco-eol":
            series = [s.strip() for s in args.series.split(",") if s.strip()]
            if not series:
                print("give --series slug1,slug2,...", file=sys.stderr); return 2
            records = mod.run(br, series)
        else:
            records = []
    finally:
        br.close()

    if not records:
        print("no records produced."); return 1
    out = netzscrape.write_output(source, records)
    print(f"\nwrote {len(records)} record(s) -> {out}")
    print(f"next: node scripts/universe/apply-lifecycle.mjs {out.as_posix()} --commit")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
