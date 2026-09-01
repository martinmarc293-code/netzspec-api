"""enumerate_meraki — every Meraki datasheet page on documentation.meraki.com.

WHY THIS DOMAIN AND NOT meraki.cisco.com: meraki.cisco.com's robots.txt disallows automated
clients, so the crawler does not touch it. documentation.meraki.com carries no such rule and is
Cisco's own product documentation for the same hardware. The operator may of course read the
marketing site in a browser - robots.txt binds crawlers, not people - and anything collected that
way goes through scripts/universe/ingest-manual.ts.

The site is a JavaScript wiki, so every fetch renders with wait_until=networkidle; the raw HTML
carries almost no links.

Structure is NOT uniform, which is why this is a crawl rather than a URL pattern:
    Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets
    Wireless/Product_Information/Overviews_and_Datasheets                  (no family segment)
    SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets        (MX moved under SASE)
    SASE_and_SD-WAN/Cellular/Product_Information/Overviews_and_Datasheets
    .../MT_-_Sensors/Product_Information/MT_Overviews_and_Datasheets       (FAMILY-PREFIXED hub)
    .../MV_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets   (FAMILY-PREFIXED hub)

The prefixed hubs matter: an earlier pass filtered on "/Overviews_and_Datasheets/" and silently
dropped every MV and MT page - 26 of them - because their segment reads "MV_Overviews_and_
Datasheets". Whole families vanished from a list that looked complete.

  python scraper/enumerate_meraki.py            crawl and write the URL list
  python scraper/enumerate_meraki.py --pids     also read each page and extract part numbers
"""
from __future__ import annotations
import argparse, json, re, sys, io
from pathlib import Path

if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "universe"
F_URLS = OUT / "meraki-datasheet-urls.json"
F_PIDS = OUT / "meraki-pids.json"

BASE = "https://documentation.meraki.com"
# Family landing pages. Each redirects into the real tree; we follow what they link to.
SEEDS = [f"{BASE}/{x}" for x in ["MS", "MX", "MR", "MV", "MG", "MT", "SM", "MI", "Z", "Z3", "Z4",
                                  "Wireless", "Switching", "SASE_and_SD-WAN"]] + [
    # Z-series is a SEVENTH path shape: its datasheet hangs directly off Product_Information with
    # no Overviews_and_Datasheets segment at all, so neither the hub regex nor the family
    # shortcuts reach it. Seeded explicitly.
    f"{BASE}/SASE_and_SD-WAN/Z-Series_Teleworker_Gateways/Product_Information",
    f"{BASE}/SASE_and_SD-WAN/Z-Series_Teleworker_Gateways",
]

# A hub lists datasheets; note the optional FAMILY PREFIX (MT_/MV_).
HUB = re.compile(r"/(?:[A-Z]{2}_)?Overviews_and_Datasheets/?$")
DOCISH = re.compile(r"Datasheet|Technical_Specifications|Overview_and_Specifications", re.I)
# Meraki order codes: MS120-8-HW, MX68-HW, CW9164I-MR, MG41-HW, MT10-HW, MA-INJ-6 ...
MERAKI_PID = re.compile(r"\b((?:M[SRXVGTAC]|CW|LIC|Z)[0-9A-Z][0-9A-Z]*(?:-[0-9A-Z]+)*(?:-HW|-WW)?)\b")


def links_of(html: str) -> set[str]:
    from bs4 import BeautifulSoup
    return {a["href"].split("?")[0].rstrip("/")
            for a in BeautifulSoup(html, "lxml").find_all("a", href=True)
            if "documentation.meraki.com" in a["href"]}


def crawl(br) -> list[str]:
    seen: set[str] = set()
    hubs: set[str] = set()
    pages: set[str] = set()
    frontier = list(SEEDS)
    # Two passes: landing pages -> Product_Information -> hubs -> datasheet pages.
    for depth in range(3):
        nxt: list[str] = []
        for u in frontier:
            if u in seen:
                continue
            seen.add(u)
            try:
                html = br.fetch(u, timeout=90000, wait_until="networkidle")
            except Exception as e:  # noqa
                print(f"   ! {u[-58:]}: {str(e)[:44]}", file=sys.stderr)
                continue
            for l in links_of(html):
                if HUB.search(l):
                    if l not in hubs:
                        hubs.add(l)
                        nxt.append(l)
                elif DOCISH.search(l):
                    pages.add(l)
                elif l.endswith("/Product_Information") and l not in seen:
                    nxt.append(l)
        print(f"[meraki] depth {depth}: {len(hubs)} hubs, {len(pages)} pages")
        frontier = nxt
        if not frontier:
            break
    return sorted(pages)


def extract_pids(br, urls: list[str]) -> dict:
    store = json.loads(F_PIDS.read_text(encoding="utf-8")) if F_PIDS.exists() else {}
    for i, u in enumerate(urls, 1):
        if u in store:
            continue
        try:
            html = br.fetch(u, timeout=90000, wait_until="networkidle")
        except Exception as e:  # noqa
            store[u] = {"error": str(e)[:70], "pids": []}
            continue
        from bs4 import BeautifulSoup
        txt = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
        # Require the -HW/-WW suffix or a clear model shape; Meraki order codes almost always
        # carry -HW. Bare "MS120" is a family, not something you can order.
        raw = {p for p in MERAKI_PID.findall(txt) if any(c.isdigit() for c in p)}
        ordered = sorted(p for p in raw if p.endswith(("-HW", "-WW")))
        models = sorted(p for p in raw if not p.endswith(("-HW", "-WW")))
        store[u] = {"pids": ordered + models, "order_codes": ordered, "models": models,
                    "note": "models are as DOCUMENTED; Meraki order codes append -HW, which this source does not print"}
        if i % 5 == 0 or i == len(urls):
            F_PIDS.write_text(json.dumps(store, indent=2), encoding="utf-8")
            tot = len({p for v in store.values() for p in v.get("pids", [])})
            print(f"   {i}/{len(urls)} pages · {tot} Meraki part numbers")
    F_PIDS.write_text(json.dumps(store, indent=2), encoding="utf-8")
    return store


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pids", action="store_true", help="also read each page for part numbers")
    a = ap.parse_args()
    br = netzscrape.PoliteBrowser(headless=True)
    try:
        urls = crawl(br)
        F_URLS.write_text(json.dumps(urls, indent=2), encoding="utf-8")
        print(f"\n[meraki] {len(urls)} datasheet pages -> {F_URLS.name}")
        fam: dict[str, int] = {}
        for u in urls:
            m = re.search(r"/((?:M[SRXVGT]|CW|Z)[0-9A-Z]*)", u.split("/")[-1])
            fam[m.group(1)[:2] if m else "other"] = fam.get(m.group(1)[:2] if m else "other", 0) + 1
        print("   by family: " + "  ".join(f"{k}:{v}" for k, v in sorted(fam.items(), key=lambda kv: -kv[1])))
        if a.pids:
            store = extract_pids(br, urls)
            tot = {p for v in store.values() for p in v.get("pids", [])}
            print(f"\n[meraki] {len(tot)} distinct part numbers -> {F_PIDS.name}")
    finally:
        br.close()
        netzscrape.print_ledger_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
