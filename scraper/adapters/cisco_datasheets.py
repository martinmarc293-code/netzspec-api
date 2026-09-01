"""cisco_datasheets — enumeration adapter (Cycle 5 breadth). Reads a Cisco switch datasheet's
ordering/models tables and extracts every HARDWARE part number + its description, from the vendor's
own page (the legitimate "complete catalog" source — NOT a competitor copy). Facts only.

Each datasheet lists the family's models in a "Product ID / Models" table (col0 = PID, col1 =
"24 ports data"/"48 ports PoE+") and repeats the PIDs across spec tables. We union PID-bearing
rows, keep chassis PIDs (drop subscriptions -NY, services CON-, licenses DNA/LIC/NW, power PWR-,
pluggable modules), clean footnote markers, and attach the best textual description found.

Usage: python scraper/run.py cisco-datasheets --urls <datasheet_url1,url2,...>
       (empty --urls → the distinct Cisco datasheet URLs already stored as provenance in the DB is
        the caller's job; pass them in. See docs/breadth-sources.md.)
"""
from __future__ import annotations
import re, sys

# a Cisco switch chassis PID: C9300-24T, C9300L-24T-4G, WS-C3850-24T, C1000-48P-4G, C9200L-24P-4G …
HW_PID = re.compile(r"^(C1-)?(C\d{3,4}[A-Z]{0,2}|WS-C\d{3,4}[A-Z]?)-\d+[A-Z]")
# not hardware: subscription terms, services, licenses, power supplies, memory/SSD, pluggable modules
NOT_HW = re.compile(r"-\d+Y$|^CON-|DNA|LIC|^NW-|^PWR-|^MEM-|^SSD-|^S[AC]?-|^GLC-|^SFP|^QSFP|^C9300-NM|^C3850-NM|^C9K-", re.I)
DESC_RX = re.compile(r"\bport|PoE|uplink|Gigabit|Multigig|mGig|data\b", re.I)


def _clean(pid: str) -> str:
    return re.sub(r"\s+\d+$", "", pid.strip()).rstrip(".,;")  # strip trailing footnote markers


def _family_from_url(url: str) -> str:
    m = re.search(r"/switches/([a-z0-9-]+)/", url)
    slug = m.group(1) if m else "cisco"
    return "Cisco " + re.sub(r"-series-switches$|-switches$", "", slug).replace("-", " ").title()


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls datasheet_url1,url2,... (see docs/breadth-sources.md)", file=sys.stderr)
        return []
    from bs4 import BeautifulSoup
    records: dict[str, dict] = {}
    for url in urls:
        try:
            html = browser.fetch(url, timeout=45000)
        except Exception as e:  # noqa
            print(f"  ! {url}: {e}", file=sys.stderr); continue
        soup = BeautifulSoup(html, "lxml")
        family = _family_from_url(url)
        found = 0
        for tbl in soup.find_all("table"):
            for tr in tbl.find_all("tr"):
                cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
                if not cells:
                    continue
                pid = _clean(cells[0])
                if not HW_PID.match(pid) or NOT_HW.search(pid):
                    continue
                desc = cells[1] if len(cells) > 1 else ""
                rec = records.get(pid)
                # keep the most description-like col1 seen for this PID
                if not rec:
                    records[pid] = {"vendor": "cisco", "sku": pid, "type": "switch",
                                    "product_family": family, "description": desc if DESC_RX.search(desc) else "",
                                    "datasheet_url": url}
                    found += 1
                elif not rec["description"] and DESC_RX.search(desc):
                    rec["description"] = desc
        print(f"  [cisco-datasheets] {family}: {found} hardware PIDs from {url[-40:]}")
    return list(records.values())
