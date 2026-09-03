"""Discover the FULL Cisco datasheet corpus from per-family datasheet-listing pages.

    python scraper/crawl_datasheet_listings.py --urls-file data/reference/family-listing-urls.txt \
        --out data/reference/discovered-datasheets.json

WHY
Our corpus is 3,272 datasheet URLs, and only ~1,271 of them are non-EoL documents. That is
not what Cisco publishes -- it is what happened to be linked from the pages the enumeration
crawled. Sampling 60 hardware SKUs whose only known source was an EoL bulletin, just 6
appeared anywhere else in the corpus: the datasheets for most retired Cisco hardware are
simply not downloaded yet.

Cisco keeps a datasheet index per product family at

    /c/en/us/products/<category>/<family>/datasheet-listing.html

(The per-CATEGORY variant 404s -- only the family level exists.) One such page for the UCS
C-series rack servers lists 82 datasheets, HTML and PDF, current and retired. 553 family
pages are derivable from the collateral URLs we already hold, so this closes the gap
deterministically rather than by guessing at URL shapes.

Output is a JSON of every datasheet URL discovered, with the family it came from, ready to
diff against the corpus and feed to the fetcher.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from netzscrape import PoliteBrowser, PoliteBlocked  # noqa: E402

# Cisco names collateral in several eras: data_sheet_c78-*, datasheet-c78-*, *-ds.html,
# *_specsheet.pdf, product_data_sheet09*. Match the shapes, not one convention.
LINK_RE = re.compile(
    r'href="([^"#]+?(?:data[-_ ]?sheet|datasheet|spec[-_]?sheet|[-_]ds|quickspec)[^"#]*?\.(?:html|pdf))"',
    re.I,
)


def absolutise(href: str) -> str | None:
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("http://"):
        return "https://" + href[len("http://"):]
    if href.startswith("https://"):
        return href
    if href.startswith("/"):
        return "https://www.cisco.com" + href
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    listings = [l.strip() for l in Path(args.urls_file).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        listings = listings[: args.limit]
    print(f"family listing pages: {len(listings)}", flush=True)

    br = PoliteBrowser(headless=True)
    found: dict[str, dict] = {}
    ok = missing = errors = 0
    try:
        for i, u in enumerate(listings, 1):
            try:
                html = br.fetch(u)
            except PoliteBlocked as e:
                print(f"  robots: {e}", file=sys.stderr)
                errors += 1
                continue
            except Exception as e:  # noqa
                print(f"  ! {type(e).__name__} on {u[-60:]}: {str(e)[:90]}", file=sys.stderr)
                errors += 1
                continue
            # A 404 comes back as a real page, so judge by content not status.
            if len(html) < 40000 and "datasheet-listing" not in html:
                missing += 1
            hrefs = {absolutise(h) for h in LINK_RE.findall(html)}
            hrefs.discard(None)
            n_new = 0
            for h in hrefs:
                if "cisco.com" not in h:
                    continue
                if h not in found:
                    found[h] = {"url": h, "from": u, "pdf": h.lower().endswith(".pdf")}
                    n_new += 1
            if n_new:
                ok += 1
            if i % 25 == 0:
                print(f"  {i}/{len(listings)}  pages-with-links={ok}  datasheets={len(found)}", flush=True)
    finally:
        br.close()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "generated_at": "2026-09-02",
        "listing_pages": len(listings),
        "pages_with_links": ok,
        "errors": errors,
        "datasheets": sorted(found.values(), key=lambda r: r["url"]),
    }, indent=1), encoding="utf-8")

    pdfs = sum(1 for r in found.values() if r["pdf"])
    print(f"\ndiscovered {len(found)} datasheet URLs ({pdfs} PDF, {len(found)-pdfs} HTML)")
    print(f"listing pages that yielded nothing: {len(listings)-ok}  errors: {errors}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
