"""probe_new_sources — one polite fetch per candidate source, so adapters are written against
what the site actually serves us, not against what we imagine it serves.

For each URL: verdict (ROBOTS / BLOCKED / BOT_CHALLENGE / HTTP_n / OK), title, how many tables
and label:value pairs a generic extractor finds, and whether the SKU we asked for appears in
the page. The HTML lands in scraper/cache/ so the adapter work that follows never re-fetches.

    python3.11 scraper/probe_new_sources.py [--headed] [--only slug,slug]
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "runs" / "probe-new-sources.json"

PROBES = [
    ("router-switch", "https://www.router-switch.com/c9200l-24p-4g.html", "C9200L-24P-4G"),
    ("router-switch", "https://www.router-switch.com/glc-te.html", "GLC-TE"),
    ("provantage", "https://www.provantage.com/scripts/search.dll?QUERY=C9200L-24P-4G", "C9200L-24P-4G"),
    ("itprice", "https://itprice.com/cisco-gpl/C9200L-24P-4G", "C9200L-24P-4G"),
    ("cdw", "https://www.cdw.com/search/?key=C9200L-24P-4G", "C9200L-24P-4G"),
    ("mikrotik", "https://mikrotik.com/product/crs326_24g_2s_rm", "CRS326-24G-2S+RM"),
    ("ubiquiti", "https://techspecs.ui.com/unifi/switching/usw-pro-24-poe", "USW-Pro-24-PoE"),
    ("meraki", "https://documentation.meraki.com/MS/MS_Overview_and_Specifications/MS130_Overview_and_Specifications", "MS130-8X"),
    ("arista", "https://www.arista.com/en/products/7050x3-series", "7050X3"),
    ("juniper", "https://www.juniper.net/us/en/products/switches/ex-series/ex4400-ethernet-switch-datasheet.html", "EX4400"),
    ("hpe", "https://www.hpe.com/us/en/aruba-cx-6300-switches.html", "6300"),
]

CHALLENGE = re.compile(r"Client Challenge|Just a moment|cf-browser-verification|Access Denied|Attention Required|are you a human|captcha", re.I)


def pairs_from(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """Generic label:value harvest — table rows with two cells, dt/dd lists, and
    'Label: value' list items. Enough to see the shape; adapters do it properly."""
    out: list[tuple[str, str]] = []
    for tr in soup.select("table tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
        if len(cells) == 2 and 1 < len(cells[0]) < 80 and cells[1]:
            out.append((cells[0], cells[1][:80]))
    for dt in soup.select("dt"):
        dd = dt.find_next_sibling("dd")
        if dd:
            out.append((dt.get_text(" ", strip=True), dd.get_text(" ", strip=True)[:80]))
    for li in soup.select("li"):
        t = li.get_text(" ", strip=True)
        m = re.match(r"^([A-Za-z][A-Za-z0-9 /()+\-]{2,60}):\s*(.{1,80})$", t)
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true", help="re-fetch even if cached")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    br = netzscrape.PoliteBrowser(headless=not args.headed)
    rows = []
    try:
        for slug, url, sku in PROBES:
            if only and slug not in only:
                continue
            row = {"source": slug, "url": url, "sku": sku}
            try:
                html = br.fetch(url, force=args.force)
            except netzscrape.PoliteBlocked as e:
                row.update(verdict="ROBOTS", detail=str(e)[:120]); rows.append(row); print(json.dumps(row)); continue
            except Exception as e:  # noqa
                msg = str(e).split("\n")[0]
                row.update(verdict="RESET" if "ECONNRESET" in msg else "ERROR", detail=msg[:140]); rows.append(row); print(json.dumps(row)); continue
            status = netzscrape.ledger_report()  # noqa: F841  (ledger has the status; we read the body instead)
            soup = BeautifulSoup(html, "lxml")
            title = (soup.title.get_text(strip=True) if soup.title else "")[:100]
            body_text = soup.get_text(" ", strip=True)
            challenged = bool(CHALLENGE.search(html[:6000])) and len(html) < 20000
            pairs = pairs_from(soup)
            row.update(
                verdict="BOT_CHALLENGE" if challenged else "OK",
                bytes=len(html), title=title,
                tables=len(soup.find_all("table")),
                pairs=len(pairs),
                sku_in_page=sku.lower() in body_text.lower(),
                sample_pairs=pairs[:14],
                links_with_sku=len([a for a in soup.find_all("a", href=True) if sku.lower().replace("+", "") in (a.get("href") or "").lower().replace("+", "")]),
            )
            rows.append(row)
            print(f"{slug:14} {row['verdict']:14} bytes={len(html):7} tables={row['tables']:3} pairs={row['pairs']:4} sku_in_page={row['sku_in_page']}  {title}")
            for k, v in pairs[:8]:
                print(f"      {k[:40]:40} | {v[:60]}")
    finally:
        br.close()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
