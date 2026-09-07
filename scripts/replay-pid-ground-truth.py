"""Corpus replay for the `_KNOWN_NORM` widening. READ ONLY - opens no write, changes nothing.

    python3.11 scripts/replay-pid-ground-truth.py [--limit 400]

WHY THIS EXISTS BEFORE THE FIX DOES. `_is_pid` consults `_KNOWN_NORM`, which
`extract_document` fills from a PER-URL sku map: `_load_sku_map().get(url, [])`. So the extractor
can only find PIDs on documents whose PIDs it already knows. Measured across the acquired corpus:

    URL IN the map      938 docs   18,130 pids   19.3 pids/doc
    URL NOT in the map  2,184 docs    248 pids    0.1 pids/doc

70% of fetched collateral has no ground truth and yields 193x fewer PIDs. The obvious repair is to
seed `_KNOWN_NORM` from the CATALOGUE instead, and on 40 documents that turned 0 pids into 112.

THAT IS THE YIELD. THIS SCRIPT IS ABOUT THE RISK, because `document_pids` feeds INHERITANCE SCOPE
and the last time scope was loose 6,954 of 11,420 facts became conflicts. `document_pids`'s own
docstring warns against widening to "every known SKU the document mentions", because a datasheet
also names the transceivers a switch accepts and the rack kits that fit it - and letting those
inherit the switch's dimensions states a specific falsehood on each of their pages.

THE WARNING IS ABOUT SCOPE AND THE CHANGE IS ABOUT DETECTION, which is why it is not simply
disqualifying: `document_pids` still takes only column 0 and the header row, so a transceiver
mentioned in a compatibility list mid-table is still not a subject. But that is an argument, and an
argument is not a measurement. What matters is whether widening the ground truth pulls
ACCESSORIES into column 0 of some table somewhere - so this counts, per document, how many newly
found PIDs `describesPart` would refuse as components, licences or accessories.

READ THE THREE NUMBERS TOGETHER. Newly-found PIDs are the prize; the accessory share is the price;
and documents where EVERY new PID is an accessory are the shape that would have produced run #38.
"""
from __future__ import annotations

import io
import json
import pathlib
import re
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import psycopg  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

import netzscrape  # noqa: E402
from adapters import cisco_specs_deep as D  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 400

#: The component shapes describesPart refuses a family-level fact. Copied from
#: src/core/specMerge.ts COMPONENT_SKU_SHAPES rather than re-invented - a stand-in tests the logic
#: you were thinking about, never the code that runs, and this project has paid for that twice.
COMPONENT_PREFIX = ("CAB-", "STACK-", "PWR-", "FAN-", "NXA-FAN", "GLC-", "CPAK-", "X2-", "FET-", "DWDM-")
COMPONENT_INFIX = ("-STACK-", "-PWR-", "-PAC-", "-PDC-", "-FAN-", "SFP", "XFP", "-SSD")


def is_component(sku: str) -> bool:
    s = sku.upper()
    return s.startswith(COMPONENT_PREFIX) or any(t in s for t in COMPONENT_INFIX)


url = ""
for line in open(ROOT / ".env", encoding="utf-8"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip().strip('"')
        break

with psycopg.connect(url, autocommit=True, application_name="netzspec/replay-pid-truth/cisco") as c:
    catalogue = {D._norm_pid(r[0]) for r in c.execute(
        "SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = 'cisco'").fetchall()}
    nonhw = {r[0].upper() for r in c.execute(
        """SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
            WHERE v.slug = 'cisco' AND p.product_class <> 'hardware'""").fetchall()}
print(f"catalogue ground truth : {len(catalogue)} cisco SKUs   ({len(nonhw)} of them non-hardware)")

sku_map = D._load_sku_map()
docs = []
for p in sorted(pathlib.Path("runs/acquired").glob("cisco-*/2026-09-0[67]/*.json")):
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        continue
    u, cp = str(d.get("url") or ""), d.get("cache_path")
    if "/collateral/" not in u or u in sku_map or not cp:
        continue
    f = pathlib.Path(netzscrape.CACHE) / cp
    if f.exists():
        docs.append((u, f))
print(f"unmapped documents with a cached page : {len(docs)}   (replaying {min(LIMIT, len(docs))})\n")

before = after = 0
docs_gained = docs_all_component = 0
component_new = 0
by_reason: Counter = Counter()
examples: list[str] = []

for u, f in docs[:LIMIT]:
    try:
        html = f.read_text(encoding="utf-8", errors="replace")
        rows_all = [D._rows(t) for t in BeautifulSoup(html, "lxml").find_all("table")]
    except Exception:
        continue
    D._KNOWN_NORM = set()
    old = set(D.document_pids(rows_all))
    D._KNOWN_NORM = catalogue
    new = set(D.document_pids(rows_all))
    before += len(old)
    after += len(new)
    gained = new - old
    if not gained:
        continue
    docs_gained += 1
    comps = {s for s in gained if is_component(s) or s.upper() in nonhw}
    component_new += len(comps)
    for s in comps:
        by_reason["non-hardware class" if s.upper() in nonhw else "component shape"] += 1
    if comps and len(comps) == len(gained):
        docs_all_component += 1
        if len(examples) < 6:
            examples.append(f"{u[-52:]}  ALL {len(gained)} new pids are accessories: "
                            + ", ".join(sorted(gained)[:3]))

print("THE PRIZE")
print(f"   pids found today (per-URL map)      : {before}")
print(f"   pids found with catalogue truth     : {after}")
print(f"   documents that gain any pid         : {docs_gained} of {min(LIMIT, len(docs))}")
print()
print("THE PRICE - newly found pids describesPart would refuse a family fact")
print(f"   accessory / component / non-hardware: {component_new} of {after - before} new "
      f"({100 * component_new / max(after - before, 1):.1f}%)")
for k, n in by_reason.most_common():
    print(f"      {n:>5}  {k}")
print()
print("THE SHAPE THAT WOULD REPRODUCE RUN #38 - documents where EVERY new pid is an accessory")
print(f"   {docs_all_component} of {docs_gained} documents that gained anything")
for e in examples:
    print(f"      {e}")
print()
print("Nothing was written. describesPart still refuses these at apply time; this measures how much")
print("of the widening's yield is real subjects rather than compatibility lists.")
