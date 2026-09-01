#!/usr/bin/env python
"""netzspec scraper CLI. Runs an adapter with a real browser, writes facts to
data/universe/{source}_{date}.json. The Node upsert (scripts/universe/apply-lifecycle.mjs)
then writes them to Mongo. Both you and Claude can run this.

Examples:
  python scraper/run.py cisco-eol --series catalyst-2960-x-series-switches,catalyst-3850-series-switches
  python scraper/run.py hpe-aruba-eol                         # HPE/Aruba end-of-life listings
  python scraper/run.py cisco-tmg --platforms C9200,C9300     # TMG compat for named platforms
  python scraper/run.py cisco-eol --series ... --headed        # visible browser (watch / pass a challenge)
Then:
  node scripts/universe/apply-lifecycle.mjs data/universe/<source>_<date>.json --commit
"""
import argparse, sys, importlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

# adapter key -> (module, source-name)
ADAPTERS = {
    "cisco-eol": ("adapters.cisco_eol", "cisco-eol"),
    "hpe-aruba-eol": ("adapters.hpe_aruba_eol", "hpe-aruba-eol"),
    "cisco-tmg": ("adapters.cisco_tmg", "cisco-tmg"),
    "cisco-tmg-platform": ("adapters.cisco_tmg_platform", "cisco-tmg-platform"),
    "cisco-datasheets": ("adapters.cisco_datasheets", "cisco-datasheets"),
    "cisco-datasheet-specs": ("adapters.cisco_datasheet_specs", "cisco-datasheet-specs"),
    "cisco-specs-deep": ("adapters.cisco_specs_deep", "cisco-specs-deep"),
}

def main() -> int:
    ap = argparse.ArgumentParser(description="netzspec data-completion scraper")
    ap.add_argument("adapter", choices=list(ADAPTERS))
    ap.add_argument("--series", default="", help="comma-separated series slugs (cisco-eol)")
    ap.add_argument("--platforms", default="", help="comma-separated platform PIDs (cisco-tmg)")
    ap.add_argument("--urls", default="", help="comma-separated datasheet URLs (cisco-datasheets)")
    ap.add_argument("--urls-file", default="", help="file of datasheet URLs, one per line (batch)")
    ap.add_argument("--headed", action="store_true", help="visible browser (watch / pass a challenge)")
    args = ap.parse_args()

    modname, source = ADAPTERS[args.adapter]
    mod = importlib.import_module(modname)

    br = netzscrape.PoliteBrowser(headless=not args.headed)
    records = []
    try:
        if args.adapter == "cisco-eol":
            series = [s.strip() for s in args.series.split(",") if s.strip()]
            if not series:
                print("give --series slug1,slug2,...", file=sys.stderr); return 2
            records = mod.run(br, series)
        elif args.adapter in ("cisco-tmg", "cisco-tmg-platform"):
            platforms = [s.strip() for s in args.platforms.split(",") if s.strip()]
            records = mod.run(br, platforms)
        elif args.adapter in ("cisco-datasheets", "cisco-datasheet-specs", "cisco-specs-deep"):
            if args.urls_file:
                urls = [ln.strip() for ln in Path(args.urls_file).read_text(encoding="utf-8").splitlines() if ln.strip()]
            else:
                urls = [s.strip() for s in args.urls.split(",") if s.strip()]
            records = mod.run(br, urls)
        else:  # hpe-aruba-eol and future no-arg adapters
            records = mod.run(br)
    finally:
        br.close()
        print(f"\nbrowser stats: {br.stats}  (cache hit-rate: "
              f"{br.stats['cache_hits'] / max(1, br.stats['cache_hits'] + br.stats['fetches']):.0%})")
        netzscrape.print_ledger_report()

    if not records:
        print("\nno records produced."); return 1
    out = netzscrape.write_output(source, records)
    print(f"\nwrote {len(records)} record(s) -> {out}")
    print(f"next: node scripts/universe/apply-lifecycle.mjs {out.as_posix()} --commit")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
