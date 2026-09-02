"""Fetch datasheet documents (HTML or PDF) through the PoliteBrowser into the cache.

    python scraper/fetch_docs.py --urls-file data/universe/new-datasheet-urls.txt

Routes by extension: .pdf goes through fetch_binary (the context request API -- page.goto on
a PDF renders a viewer instead of handing over the file), everything else through fetch().
Both are robots-checked, throttled, cached and ledgered, so a re-run costs nothing and the
extractors downstream read from scraper/cache exactly as they do for the original corpus.

Written for the corpus-completion pass: the enumeration only ever held the datasheets that
happened to be linked from the pages it crawled, which left most retired Cisco hardware with
no spec source at all. Crawling Cisco's per-family datasheet-listing pages surfaced 1,185
documents we had never downloaded.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from netzscrape import PoliteBrowser, PoliteBlocked  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls-file", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    urls, seen = [], set()
    for line in Path(args.urls_file).read_text(encoding="utf-8").splitlines():
        u = line.strip().split("\t")[-1]
        if u.startswith("http") and u not in seen:
            seen.add(u)
            urls.append(u)
    if args.limit:
        urls = urls[: args.limit]
    print(f"documents to fetch: {len(urls)}", flush=True)

    br = PoliteBrowser(headless=True)
    ok = cached = failed = 0
    try:
        for i, u in enumerate(urls, 1):
            try:
                before = br.stats.get("cache_hits", 0)
                if u.lower().split("?")[0].endswith(".pdf"):
                    body = br.fetch_binary(u)
                    got = len(body) > 0
                else:
                    html = br.fetch(u)
                    got = len(html) > 0
                if br.stats.get("cache_hits", 0) > before:
                    cached += 1
                elif got:
                    ok += 1
                else:
                    failed += 1
            except PoliteBlocked as e:
                print(f"  robots: {str(e)[:110]}", file=sys.stderr)
                failed += 1
            except Exception as e:  # noqa
                print(f"  ! {type(e).__name__} {u[-64:]}: {str(e)[:90]}", file=sys.stderr)
                failed += 1
            if i % 50 == 0:
                print(f"  {i}/{len(urls)}  fetched={ok} from-cache={cached} failed={failed}", flush=True)
    finally:
        br.close()

    print(f"done: fetched={ok} from-cache={cached} failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
