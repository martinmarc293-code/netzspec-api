"""cisco_datasheet_specs — per-PID SPEC extraction from Cisco switch datasheets (Cycle 5 depth).
Turns bare enumerated stubs into spec'd parts, from the vendor's own datasheet. Facts only.

A datasheet holds several per-PID tables (col0 = Model/SKU): T1 ports/uplinks/power, T3/T4 PoE,
T10 switching-capacity/forwarding-rate, plus dimensions/weight. We scan every table whose data
rows start with a PID, read the HEADER row for each column, map recognised headers to German
attribute names (HexCat's vocabulary), and collect {name, value} per PID. Values (numbers/units)
are language-neutral; only the names are translated.

Usage: python scraper/run.py cisco-datasheet-specs --urls <datasheet_url1,url2,...>
Then:  node scripts/universe/apply-specs.mjs data/universe/cisco-datasheet-specs_<date>.json --commit
"""
from __future__ import annotations
import re, sys

HW_PID = re.compile(r"^(C1-)?(C\d{3,4}[A-Z]{0,2}|WS-C\d{3,4}[A-Z]?)-\d+[A-Z]")
NOT_HW = re.compile(r"-\d+Y$|^CON-|DNA|LIC|^NW-|^PWR-|^MEM-|^SSD-", re.I)

# english header substring (lowercased) -> German attribute name (HexCat vocabulary). First match wins.
HEADER_MAP = [
    ("total 10/100/1000", "Ports (Kupfer)"), ("total mgig", "Multigigabit-Ports"), ("total ports", "Portanzahl"),
    ("downlink", "Downlink-Ports"), ("uplink", "Uplink-Optionen"),
    ("available poe", "PoE-Budget"), ("poe power", "PoE-Budget"), ("perpetual poe", "Perpetual PoE"),
    ("switching capacity", "Switching-Kapazität"), ("forwarding rate", "Durchsatz (Forwarding Rate)"),
    ("default ac power", "Netzteil (Standard)"), ("primary power supply", "Netzteil"), ("power supply", "Netzteil"),
    ("dram", "DRAM"), ("flash", "Flash-Speicher"), ("weight", "Gewicht"), ("dimensions", "Abmessungen"),
    ("stack", "Stacking"), ("vlan", "VLANs"),
]


def _german(header: str) -> str | None:
    h = header.lower()
    for sub, name in HEADER_MAP:
        if sub in h:
            return name
    return None


def _clean(s: str) -> str:
    return re.sub(r"\s+\d+$", "", s.strip()).rstrip(".,;")


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls datasheet_url1,url2,...", file=sys.stderr)
        return []
    from bs4 import BeautifulSoup
    specs: dict[str, dict] = {}  # pid -> {name -> value}
    dsheet: dict[str, str] = {}
    for url in urls:
        try:
            html = browser.fetch(url, timeout=45000)
        except Exception as e:  # noqa
            print(f"  ! {url}: {e}", file=sys.stderr); continue
        soup = BeautifulSoup(html, "lxml")
        for tbl in soup.find_all("table"):
            rows = tbl.find_all("tr")
            if len(rows) < 2:
                continue
            header = [c.get_text(" ", strip=True) for c in rows[0].find_all(["td", "th"])]
            colName = [_german(h) for h in header]
            if not any(colName):
                continue  # no recognised spec columns
            for tr in rows[1:]:
                cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
                if not cells:
                    continue
                pid = _clean(cells[0])
                if not HW_PID.match(pid) or NOT_HW.search(pid):
                    continue
                bag = specs.setdefault(pid, {})
                dsheet.setdefault(pid, url)
                for j, val in enumerate(cells[1:], start=1):
                    name = colName[j] if j < len(colName) else None
                    if name and val and val not in ("-", "N/A", "") and name not in bag:
                        bag[name] = val[:80]
        got = sum(1 for p in specs if dsheet.get(p) == url)
        print(f"  [cisco-datasheet-specs] {url[-42:]}: PIDs with specs so far {len(specs)}")
    return [{"vendor": "cisco", "sku": pid, "datasheet_url": dsheet.get(pid),
             "specs": [{"name": n, "value": v} for n, v in bag.items()]} for pid, bag in specs.items()]
