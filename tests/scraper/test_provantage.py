"""tests/scraper/test_provantage.py — proof for scraper/sources/provantage.py.

Runs against the CACHED fixtures only (scraper/cache/<sha1(url)>.html, keyed by the requested
URL through netzscrape._key). Never fetches. Prints one PASS/MISS line per case and exits
non-zero on any miss.

    python3.11 tests/scraper/test_provantage.py
    python3.11 scripts/run_py_tests.py provantage

Half the cases are sabotage: a challenge page must be blocked, a not-found page must be
not-found, a page about a different SKU must be not_listed, an empty spec table must yield
nothing without claiming not_listed, a price row must never become a fact. A suite made only of
the happy path would have passed with the price parser reading "$4,146.89" as 4146.
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import provantage as P  # noqa: E402
from sources.base import sku_in  # noqa: E402

SEARCH_URL = "https://www.provantage.com/scripts/search.dll?QUERY=C9200L-24P-4G"
PRODUCT_URL = "https://www.provantage.com/~7CSC71M1.htm"
BRAND_URL = "https://www.provantage.com/~880CSCO.htm"
COMPANY_URL = "https://www.provantage.com/company-index~xcomp.htm"
DEPT_URL = "https://www.provantage.com/networking~xnetwork.htm"

# Labels that are site chrome and must never be emitted as facts. The list is the one every
# adapter is held to; the provantage spec table itself carries three of them (Price,
# Availability, Limited Warranty), which is why this check has teeth here.
CHROME_LEAF = re.compile(r"^(?:price|availability|in stock|stock status|shipping|(?:limited )?warranty|ratings?|reviews?|cart|related|similar|cookies?|wish list|compare)$", re.I)
# A section that is chrome in its entirety. "Stock Details" is NOT here on purpose: it carries
# "Manufacturer" and "Manuf Part#", which are identity facts; its Price/Availability rows are
# caught by CHROME_LEAF. The vocabulary work may still choose to alias those two labels.
CHROME_SECTION = re.compile(r"^(?:reviews?|ratings?|shipping|warranty|cart|related|similar|see also)$", re.I)


def is_chrome(label: str) -> bool:
    parts = label.split(" > ")
    return bool(CHROME_LEAF.search(parts[-1].strip()) or (len(parts) > 1 and CHROME_SECTION.search(parts[0].strip())))

npass = nfail = 0


def check(cid: str, what: str, ok: bool, detail: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:70]:70}" + (f" | {detail[:120]}" if detail and not ok else ""))


def fixture(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}"); sys.exit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


# ---- resolve(): the documented URL for every task kind --------------------------------------
check("R1", "search builds scripts/search.dll?QUERY=<sku>",
      P.resolve({"task": "search", "key": "C9200L-24P-4G"}) == SEARCH_URL, str(P.resolve({"task": "search", "key": "C9200L-24P-4G"})))
check("R2", "search encodes '+' in a SKU",
      P.resolve({"task": "search", "key": "CRS326-24G-2S+RM"}) == "https://www.provantage.com/scripts/search.dll?QUERY=CRS326-24G-2S%2BRM")
check("R3", "listing with an absolute index URL returns it unchanged",
      P.resolve({"task": "listing", "key": BRAND_URL}) == BRAND_URL)
check("R4", "listing with a site-relative key is absolutised",
      P.resolve({"task": "listing", "key": "/~880CSCO.htm"}) == BRAND_URL)
check("R5", "listing with a bare index code builds /~CODE.htm",
      P.resolve({"task": "listing", "key": "880CSCO"}) == BRAND_URL)
check("R6", "part-page with a url uses the url",
      P.resolve({"task": "part-page", "key": "C9200L-24P-4G-1A", "url": PRODUCT_URL}) == PRODUCT_URL)
check("R7", "part-page without a url cannot be built (None)",
      P.resolve({"task": "part-page", "key": "C9200L-24P-4G-1A"}) is None)
check("R8", "unknown task kind -> None", P.resolve({"task": "gpl", "key": "X"}) is None)
check("R9", "empty key -> None", P.resolve({"task": "search", "key": ""}) is None)

# ---- extract() on the main product fixture -----------------------------------------------------
html = fixture(PRODUCT_URL)
task = {"task": "part-page", "key": "C9200L-24P-4G-1A", "url": PRODUCT_URL}
r = P.extract(html, task)
facts = r["facts"]
by_label = {f["label"]: f["value"] for f in facts}

check("E1", "sku is the Manufacturer Part Number", r["sku"] == "C9200L-24P-4G-1A", repr(r["sku"]))
check("E2", "not_listed is False for the page's own SKU", r["not_listed"] is False)
check("E3", "name is the product title",
      r["name"] == "Cisco Systems C9200L 24-Port PoE+, 4X1G Network Advant", repr(r["name"]))
check("E4", f"at least 30 facts (got {len(facts)})", len(facts) >= 30)

EXACT = [
    ("General Information > Manufacturer Part Number", "C9200L-24P-4G-1A"),
    ("General Information > Product Type", "Ethernet Switch"),
    ("General Information > Product Model", "C9200L-24P-4G"),
    ("Interfaces/Ports > Total Number of Network Ports", "24"),
    ("Interfaces/Ports > Port / Expansion Slot Details", "24 x Gigabit Ethernet PoE+ 4 x Gigabit Ethernet Uplink"),
    ("I/O Expansions > Expansion Slot Type", "SFP (mini-GBIC)"),
    ("Media & Performance > Network Technology", "10/100/1000Base-T 1000Base-X"),
    ("Network & Communication > Layer Supported", "3"),
    ("Power Description > Power Consumption", "600 W"),
    ("Physical Characteristics > Height", '1.7"'),
    ("Stock Details > Manufacturer", "Cisco Systems"),
]
for i, (label, value) in enumerate(EXACT, 1):
    check(f"X{i}", f"exact: {label} = {value}", by_label.get(label) == value, repr(by_label.get(label)))

shape_ok = all(f.get("label") and f.get("value") and f.get("locator") for f in facts)
check("S1", "every fact has non-empty label, value and locator", shape_ok)
check("S2", "no value longer than 500 characters", all(len(f["value"]) <= 500 for f in facts),
      str(max((len(f["value"]) for f in facts), default=0)))
check("S3", "locator is table index + row (tN:rM)", all(re.fullmatch(r"t\d+:r\d+", f["locator"]) for f in facts),
      str([f["locator"] for f in facts if not re.fullmatch(r"t\d+:r\d+", f["locator"])][:3]))
check("S4", "locators are unique", len({f["locator"] for f in facts}) == len(facts))
chrome_hits = [f["label"] for f in facts if is_chrome(f["label"])]
check("S5", "no chrome label among the facts", not chrome_hits, str(chrome_hits))
check("S6", "no dollar amount among fact values", not any("$" in f["value"] for f in facts),
      str([f for f in facts if "$" in f["value"]][:2]))
check("S7", "every label carries its section prefix ('Section > Label')",
      all(" > " in f["label"] for f in facts), str([f["label"] for f in facts if " > " not in f["label"]][:3]))
sections = {f["label"].split(" > ")[0] for f in facts}
for sec in ("General Information", "Interfaces/Ports", "I/O Expansions", "Media & Performance",
            "Network & Communication", "Power Description", "Management & Protocols", "Physical Characteristics"):
    check("S8", f"section present: {sec}", sec in sections)

check("P1", "price recorded: sale price 2606.73", (r["price"] or {}).get("price") == "2606.73", repr(r["price"]))
check("P2", "price recorded: list price 4146.89", (r["price"] or {}).get("list") == "4146.89", repr(r["price"]))
check("P3", "price currency USD", (r["price"] or {}).get("currency") == "USD")

check("A1", "aliases: no UPC/EAN/GTIN on this fixture -> []", r["aliases"] == [], repr(r["aliases"]))
UPC_HTML = ('<html><body><td id="MAIN"><table><tr><td class="HT" colspan="2">General Information</td></tr>'
            '<tr><td class="AT1">Manufacturer Part Number</td><td class="DT1">C9200L-24P-4G-1A</td></tr>'
            '<tr><td class="AT2">UPC Code</td><td class="DT2">00882658684579</td></tr>'
            '<tr><td class="AT1">Height</td><td class="DT1">1.7"</td></tr></table></td></body></html>')
ru = P.extract(UPC_HTML, task)
check("A2", "aliases: a UPC row becomes {kind: upc} and not a fact",
      ru["aliases"] == [{"kind": "upc", "value": "00882658684579"}] and not any("UPC" in f["label"] for f in ru["facts"]),
      repr(ru["aliases"]))

imgs = r["images"]
check("I1", "at least one product image", len(imgs) >= 1)
check("I2", "exactly one primary image", sum(1 for i in imgs if i["role"] == "primary") == 1)
check("I3", "primary is the full-size product photo",
      any(i["role"] == "primary" and i["url"] == "https://www.provantage.com/fullsize/CSC71M1.JPG" for i in imgs), repr(imgs[:2]))
check("I4", "all image URLs absolute", all(i["url"].startswith("https://www.provantage.com/") for i in imgs))
check("I5", "no chrome image (gif/logo/spacer/banner/instant-savings thumbs)",
      not any(re.search(r"\.gif$|logo|spacer|adv_|BAN-|/90-|/10\d{6,}\.JPG", i["url"], re.I) for i in imgs), str(imgs))
check("I6", "image alt carries the SKU", all(i["alt"] for i in imgs))
check("I7", "the same photo in two spellings is one image", len({i["url"].lower().strip() for i in imgs}) == len(imgs))

check("C1", "relations/others/lifecycle present with contract types",
      r["relations"] == [] and r["others"] == [] and r["lifecycle"] is None)

# ---- not_listed --------------------------------------------------------------------------------
check("N1", "task key ZZZ-NOT-ON-THIS-PAGE -> not_listed True",
      P.extract(html, {"task": "part-page", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)
check("N2", "key differing only by case/'+'/'=' -> not_listed False",
      P.extract(html, {"task": "part-page", "key": "c9200l-24p-4g-1a+="})["not_listed"] is False)
check("N3", "base SKU without licence suffix is a different part -> not_listed True",
      P.extract(html, {"task": "part-page", "key": "C9200L-24P-4G"})["not_listed"] is True)

# ---- sabotage: blocked / not found / empty table / chrome rows ----------------------------------
check("B1", "'Just a moment...' page is_blocked", P.is_blocked("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>") is True)
check("B2", "product fixture is not blocked", P.is_blocked(html) is False)
NF_HTML = "<html><head><title>PROVANTAGE: Page Not Found</title></head><body><h1>Page Not Found</h1><p>The page you requested could not be found.</p></body></html>"
check("B3", "synthetic not-found page (site marker) is_not_found", P.is_not_found(NF_HTML) is True)
check("B4", "product fixture is not not-found", P.is_not_found(html) is False)
check("B5", "not-found marker in body prose only does not trigger",
      P.is_not_found("<html><head><title>PROVANTAGE: Widget</title></head><body><p>this item is no longer available in blue</p></body></html>") is False)

EMPTY_HTML = ('<html><body><td id="MAIN"><h1 class="VARIANT">Cisco Systems C9200L-24P-4G-1A</h1>'
              '<table><tr><td class="HT" colspan="2">General Information</td></tr>'
              '<tr><td class="AT1"></td><td class="DT1"></td></tr></table></td></body></html>')
re_ = P.extract(EMPTY_HTML, task)
check("B6", "empty spec table -> zero facts", re_["facts"] == [], repr(re_["facts"]))
check("B7", "empty spec table -> not_listed False (page names the SKU)", re_["not_listed"] is False)
check("B8", "empty spec table -> sku None", re_["sku"] is None)
NO_TABLE = '<html><body><td id="MAIN"><h1>Cisco Systems C9200L-24P-4G-1A</h1><p>Overview</p></td></body></html>'
rn = P.extract(NO_TABLE, task)
check("B9", "no spec table at all -> zero facts, not_listed False", rn["facts"] == [] and rn["not_listed"] is False)

CHROME_HTML = ('<html><body><td id="MAIN"><table><tr><td class="HT" colspan="2">Physical Characteristics</td></tr>'
               '<tr><td class="AT1">Height</td><td class="DT1">1.7"</td></tr>'
               '<tr><td class="HT" colspan="2">Warranty</td></tr>'
               '<tr><td class="AT1">Limited Warranty</td><td class="DT1">Lifetime</td></tr>'
               '<tr><td class="HT" colspan="2">Stock Details</td></tr>'
               '<tr><td class="AT1">Price</td><td class="DT1">$2606.73</td></tr>'
               '<tr><td class="AT2">Availability</td><td class="DT2">Special Order</td></tr></table></td></body></html>')
rc = P.extract(CHROME_HTML, task)
check("B10", "sabotage: Price/Availability/Warranty rows are dropped, Height kept",
      [f["label"] for f in rc["facts"]] == ["Physical Characteristics > Height"], str([f["label"] for f in rc["facts"]]))
check("B11", "sabotage: the dropped Price row still lands in the price field",
      (rc["price"] or {}).get("price") == "2606.73", repr(rc["price"]))

# ---- discover() on the search fixture ------------------------------------------------------------
shtml = fixture(SEARCH_URL)
stask = {"task": "search", "key": "C9200L-24P-4G"}
sd = P.discover(shtml, stask)
PRODUCT_URL_RX = re.compile(r"^https://www\.provantage\.com/(?:[a-z0-9-]+)?~7[A-Z0-9]+\.htm$")
check("D1", f"search discover returns at least 8 tasks (got {len(sd)})", len(sd) >= 8)
check("D2", "search discover returns only part-page tasks", all(t["task"] == "part-page" for t in sd))
check("D3", "every search task has an absolute product URL", all(PRODUCT_URL_RX.match(t["url"]) for t in sd),
      str([t["url"] for t in sd if not PRODUCT_URL_RX.match(t["url"])][:3]))
check("D4", "every key is a canonical SKU token (no spaces, no markup)",
      all(re.fullmatch(r"[A-Z0-9][A-Z0-9.+=/_-]*", t["key"]) for t in sd), str([t["key"] for t in sd][:12]))
check("D5", "every key mentions the searched SKU", all(sku_in(t["key"], "C9200L-24P-4G") for t in sd))
check("D6", "the exact part is first: C9200L-24P-4G-1A -> /~7CSC71M1.htm",
      bool(sd) and sd[0]["key"] == "C9200L-24P-4G-1A" and sd[0]["url"] == PRODUCT_URL, repr(sd[:1]))
check("D7", "top matches and all matches are deduplicated (unique URLs)", len({t["url"] for t in sd}) == len(sd))
check("D8", "SKU split across highlight spans is reassembled ('C9200L-24P-4G-1E' present)",
      any(t["key"] == "C9200L-24P-4G-1E" for t in sd))
check("D9", "every discovered task resolves to its URL", all(P.resolve(t) == t["url"] for t in sd))
check("D10", "sabotage: search discover for a SKU no result mentions -> []",
      P.discover(shtml, {"task": "search", "key": "ZZZ-NOT-ON-THIS-PAGE"}) == [])
check("D11", "search fixture is neither blocked nor not-found", not P.is_blocked(shtml) and not P.is_not_found(shtml))
check("D12", "instant-savings sidebar products are not search results",
      not any(t["url"].endswith(("~7EPW9AJ3.htm", "~7TRPA5HV.htm")) for t in sd))

# ---- discover() on listing fixtures ------------------------------------------------------------------
def listing(url: str):
    d = P.discover(fixture(url), {"task": "listing", "key": url, "url": url})
    return d, [t for t in d if t["task"] == "part-page"], [t for t in d if t["task"] == "listing"]

bd, bp, bl = listing(BRAND_URL)
check("L1", f"brand index: >=10 part-page tasks (got {len(bp)})", len(bp) >= 10)
check("L2", f"brand index: >=40 listing tasks (got {len(bl)})", len(bl) >= 40)
check("L3", "brand index: only part-page/listing kinds", all(t["task"] in ("part-page", "listing") for t in bd))
check("L4", "brand index: part-page URLs absolute, keys canonical",
      all(PRODUCT_URL_RX.match(t["url"]) and re.fullmatch(r"[A-Z0-9][A-Z0-9.+=/_-]*", t["key"]) for t in bp), str(bp[:2]))
check("L5", "brand index: SKU read from the '#SKU' summary (C1300-48FP-4X)",
      any(t["key"] == "C1300-48FP-4X" and t["url"].endswith("~7CSCOA6Q.htm") for t in bp))
check("L6", "brand index: 'See All' page is a listing task", any(t["url"] == "https://www.provantage.com/~880CSCO1.htm" for t in bl))
check("L7", "brand index: a division page is a listing task",
      any(t["url"].endswith("cisco-routing-switching-devices~50NRSWT_CSCO.htm") for t in bl))
check("L8", "brand index: listing keys are absolute URLs", all(t["key"] == t["url"] and t["url"].startswith("https://www.provantage.com/") for t in bl))
check("L9", "brand index: does not re-enqueue its own URL", not any(t["url"] == BRAND_URL for t in bd))
check("L10", "brand index: sidebar instant-savings products are not tasks",
      not any(t["url"].endswith(("~7TRPM01U.htm", "~7TRPL1K5.htm", "~7CSC71M1.htm")) for t in bd))
check("L11", "brand index: sidebar chrome links are not listing tasks",
      not any(re.search(r"~xins\.htm|~xadvant\.htm|~xprivacy\.htm", t["url"]) for t in bl))
check("L12", "brand index: every task resolves", all(P.resolve(t) == t["url"] for t in bd))

dd, dp, dl = listing(DEPT_URL)
check("L13", f"department: >=10 part-page tasks (got {len(dp)})", len(dp) >= 10)
check("L14", f"department: >=4 listing tasks (got {len(dl)})", len(dl) >= 4)
check("L15", "department: sub-category is a listing task", any(t["url"].endswith("modems~560NMODM.htm") for t in dl))
check("L16", "department: SKU from summary (NFI-U04-SPE)", any(t["key"] == "NFI-U04-SPE" for t in dp))
check("L17", "department: sidebar product is not a task", not any(t["url"].endswith("~7CSC71M1.htm") for t in dd))

cd, cp, cl = listing(COMPANY_URL)
check("L18", f"manufacturer index: >=50 listing tasks (got {len(cl)})", len(cl) >= 50)
check("L19", "manufacturer index: no part-page tasks (there are no product blocks)", cp == [])
check("L20", "manufacturer index: letter pages and brand pages are listing tasks",
      any(t["url"].endswith("company-index~xcompC.htm") for t in cl) and any(t["url"].endswith("~880CSCO.htm") for t in cl))

# ---- report -----------------------------------------------------------------------------------------
labels = sorted({f["label"] for f in facts})
print(f"\nmain fixture: {len(facts)} facts, {len(labels)} distinct labels, {len(imgs)} images, {len(sd)} search tasks")
print("labels: " + " || ".join(labels[:25]))
print(f"\n{npass} passed, {nfail} failed")
sys.exit(1 if nfail else 0)
