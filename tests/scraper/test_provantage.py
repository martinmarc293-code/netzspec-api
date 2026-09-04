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

# ---- identity: the SKU row is recorded ONCE, as the SKU ---------------------------------------
# Both label spellings held the value already in result["sku"], on 594 and 759 of the 759 product
# pages acquired 3/4 Sep 2026, and neither is mapped by any alias rule: 1,353 duplicate facts.
check("D1", "manufacturer part number is the sku", r["sku"] == "C9200L-24P-4G-1A", repr(r["sku"]))
check("D2", "...and is NOT also a fact under 'Manufacturer Part Number'",
      "General Information > Manufacturer Part Number" not in by_label)
check("D3", "...nor under the Stock Details spelling 'Manuf Part#'",
      "Stock Details > Manuf Part#" not in by_label, str([l for l in by_label if "Part#" in l]))
STOCK_ONLY = ('<html><body><td id="MAIN"><table><tr><td class="HT" colspan="2">Stock Details</td></tr>'
              '<tr><td id="Gmanuf" class="AT1">Manufacturer</td><td class="DT1">Cisco Systems</td></tr>'
              '<tr><td id="Gmpn" class="AT2">Manuf Part#</td><td class="DT2">N7K-C7004-S2</td></tr>'
              '<tr><td id="Gprice" class="AT1">Price</td><td class="DT1">$33578.08</td></tr></table></td></body></html>')
rs = P.extract(STOCK_ONLY, {"task": "part-page", "key": "N7K-C7004-S2"})
check("D4", "a page with only the Stock Details block still yields the sku from Manuf Part#",
      rs["sku"] == "N7K-C7004-S2", repr(rs["sku"]))
check("D5", "...and the Manufacturer row survives as a fact (it is the only brand statement)",
      any(f["label"].endswith("Manufacturer") for f in rs["facts"]), str([f["label"] for f in rs["facts"]]))
# SABOTAGE: the identity rule must not swallow a real spec whose label merely contains the words
check("D6", "SABOTAGE 'Number of Manufacturer Part Numbers Supported' is a fact, not identity",
      any(f["label"].endswith("Number of Manufacturer Part Numbers Supported")
          for f in P.extract('<html><body><td id="MAIN"><table><tr><td class="HT" colspan="2">General Information</td></tr>'
                             '<tr><td class="AT1">Number of Manufacturer Part Numbers Supported</td><td class="DT1">4</td></tr>'
                             '</table></td></body></html>', {"task": "part-page", "key": "X"})["facts"]))

# ---- aliases: UPC and the distributor code from the identity block ----------------------------
# 532 of 728 product pages print <p id="Gupc">, all 728 print <p id="Gsku">, and the adapter
# captured neither: it only looked for a "UPC" ROW inside the spec table, which this site has not.
check("A1", "aliases: this fixture has no UPC, so only the Provantage code",
      r["aliases"] == [{"kind": "distributor_sku", "value": "CSC71M1"}], repr(r["aliases"]))
ID_HTML = ('<html><body><td id="MAIN"><p id="Gupc">UPC&nbsp;Code: 882658454257</p>'
           '<p id="Gsku">Provantage&nbsp;Code:&nbsp; CSC9P77</p><p id="Gcond">Condition: Factory New</p>'
           '<table><tr><td class="HT" colspan="2">General Information</td></tr>'
           '<tr><td class="AT1">Manufacturer Part Number</td><td class="DT1">VS-C6503E-SUP2T</td></tr>'
           '<tr><td class="AT2">Height</td><td class="DT2">7"</td></tr></table></td></body></html>')
ri = P.extract(ID_HTML, {"task": "part-page", "key": "VS-C6503E-SUP2T"})
check("A2", "identity block: a 12-digit UPC becomes {kind: upc}",
      {"kind": "upc", "value": "882658454257"} in ri["aliases"], repr(ri["aliases"]))
check("A3", "identity block: the Provantage code becomes {kind: distributor_sku}",
      {"kind": "distributor_sku", "value": "CSC9P77"} in ri["aliases"], repr(ri["aliases"]))
check("A4", "identity block: neither becomes a fact",
      not any("UPC" in f["label"] or "Provantage" in f["label"] for f in ri["facts"]))
# SABOTAGE: the UPC row also carries "N/A" and, on a few pages, the SKU typed into it. A barcode
# that is not a barcode length joins two unrelated parts to each other and cannot be undone.
for bad in ("N/A", "Not Available", "VS-C6503E-SUP2T", "12345"):
    rb = P.extract(ID_HTML.replace("882658454257", bad), {"task": "part-page", "key": "VS-C6503E-SUP2T"})
    check("A5", f"SABOTAGE UPC {bad!r} is refused, not stored as a barcode",
          not any(a["kind"] in ("upc", "gtin") for a in rb["aliases"]), repr(rb["aliases"]))
check("A6", "a 14-digit GTIN is recorded as gtin, not upc",
      P.extract(ID_HTML.replace("882658454257", "00882658684579"), {"task": "part-page", "key": "VS-C6503E-SUP2T"})["aliases"][0]
      == {"kind": "gtin", "value": "00882658684579"})
UPC_ROW = ('<html><body><td id="MAIN"><table><tr><td class="HT" colspan="2">General Information</td></tr>'
           '<tr><td class="AT1">Manufacturer Part Number</td><td class="DT1">C9200L-24P-4G-1A</td></tr>'
           '<tr><td class="AT2">UPC Code</td><td class="DT2">00882658684579</td></tr>'
           '<tr><td class="AT1">Height</td><td class="DT1">1.7"</td></tr></table></td></body></html>')
ru = P.extract(UPC_ROW, task)
check("A7", "a UPC ROW inside the spec table still becomes {kind: upc} and not a fact",
      ru["aliases"] == [{"kind": "upc", "value": "00882658684579"}] and not any("UPC" in f["label"] for f in ru["facts"]),
      repr(ru["aliases"]))
rdup = P.extract(ID_HTML.replace('<p id="Gcond">',
                                 '<span itemprop="upc" content="882658454257"></span><p id="Gcond">'),
                 {"task": "part-page", "key": "VS-C6503E-SUP2T"})
check("A8", "the same barcode from the identity block and the microdata is recorded once",
      rdup["aliases"] == [{"kind": "upc", "value": "882658454257"},
                          {"kind": "distributor_sku", "value": "CSC9P77"}], repr(rdup["aliases"]))

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
# The task carries the vendor whose part is being looked up (worker.py reads it off the task's
# part row). Without it discover() cannot tell Cisco's own listing from AddOn's copy of the same
# PID, and 4 Sep 2026 is what that costs: see the MANUFACTURER block further down.
stask = {"task": "search", "key": "C9200L-24P-4G", "vendor": "cisco"}
sd = P.discover(shtml, stask)
PRODUCT_URL_RX = re.compile(r"^https://www\.provantage\.com/(?:[a-z0-9-]+)?~7[A-Z0-9]+\.htm$")
sp = [t for t in sd if t["task"] == "part-page"]
sl = [t for t in sd if t["task"] == "listing"]
check("D1", f"search discover returns at least 8 part-page tasks (got {len(sp)})", len(sp) >= 8)
check("D2", "search discover returns part-page tasks and listing tasks for the further result pages only",
      all(t["task"] in ("part-page", "listing") for t in sd) and sl, str(sd))
check("D3", "every part-page task has an absolute product URL", all(PRODUCT_URL_RX.match(t["url"]) for t in sp),
      str([t["url"] for t in sp if not PRODUCT_URL_RX.match(t["url"])][:3]))
check("D4", "every part-page key is a canonical SKU token (no spaces, no markup)",
      all(re.fullmatch(r"[A-Z0-9][A-Z0-9.+=/_-]*", t["key"]) for t in sp), str([t["key"] for t in sp][:12]))
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
# ---- the site's OWN empty-search page ----------------------------------------------------------
# 275 of the 427 search pages acquired 3/4 Sep 2026 are this page, and none of the 152 pages that
# DO have results carries the panel. Before this rule they were extracted, discovered from and
# recorded as "page loaded, nothing found" - and 71 of them were not even not_listed, because the
# "Did you mean 075 681" suggestion re-prints the key with a space in it and the fallback test
# strips spaces before it looks.
EMPTY_SEARCH = ('<html><head><title>Search Results for 075681</title></head><body><td id="MAIN">'
                '<p>Did you mean <b>075 681</b> ?</p><h2>Some Tips on Searching</h2>'
                '<ul><li>Check your spelling</li></ul></td></body></html>')
check("N1", "the empty-search page is_not_found", P.is_not_found(EMPTY_SEARCH) is True)
rns = P.extract(EMPTY_SEARCH, {"task": "search", "key": "075681"})
check("N2", "...and extract says not_listed even though 'Did you mean 075 681' contains the key",
      rns["not_listed"] is True and rns["facts"] == [], repr(rns))
check("N3", "...and it proposes no tasks", P.discover(EMPTY_SEARCH, {"task": "search", "key": "075681"}) == [])
# SABOTAGE: the marker must not fire on a page that HAS results, or every search is thrown away
check("N4", "SABOTAGE a search page WITH results is not not-found", P.is_not_found(shtml) is False)
check("N5", "SABOTAGE a product page is not not-found", P.is_not_found(html) is False)

check("D12", "instant-savings sidebar products are not search results",
      not any(t["url"].endswith(("~7EPW9AJ3.htm", "~7TRPA5HV.htm")) for t in sd))
check("D13", "every part-page key is the searched SKU or a dash-suffixed variant of it (no stack kit, no power supply)",
      all(P._key_or_variant(t["key"], "C9200L-24P-4G") for t in sp) and not any(t["key"].startswith(("C9200-", "PWR-", "CAB-", "C9K-")) for t in sp),
      str([t["key"] for t in sp]))

# ---- search pagination: P2..P4 carry the key as QUERY= and are followed as listing tasks ----------
PAGES = [f"https://www.provantage.com/service/searchsvcs/Q/P{n}?QUERY=C9200L-24P-4G" for n in (2, 3, 4)]
check("PG1", "the three further result pages are listing tasks, each once, key = url",
      sorted(t["url"] for t in sl) == PAGES and all(t["key"] == t["url"] for t in sl), str(sl))
check("PG2", "page 1 (the page itself) is not re-queued", not any("/P1?" in t["url"] or t["url"] == SEARCH_URL for t in sl))
check("PG3", "every listing task resolves to its URL", all(P.resolve(t) == t["url"] for t in sl))
P2_URL = PAGES[0]
# The manufacturer link is part of every real result block (see MANUFACTURER below); a synthetic
# page without one is not the page this site serves, and the gate under test reads it.
def _blk(code: str, brand: str, href: str, title: str, part: str) -> str:
    return (f'<div class="BOX5B"><a class="BOX5PRODUCT" href="{href}"></a><p>{title}</p>'
            f'<p class="BOX5TEXT"><b><a href="/~880{code}.htm">{brand}</a></b> Part# {part}</p></div>')


P2_HTML = ('<html><body><td id="MAIN">'
           + _blk("CSCO", "Cisco Systems", "/~7AAAA001.htm", "Catalyst 9200L 24-Port PoE+", "C9200L</span>-<span>24P-4G-E=")
           + _blk("CSCO", "Cisco Systems", "/~7AAAA002.htm", "Power Supply for the C9200L-24P-4G", "PWR-C5-715WDC=")
           + _blk("CSCO", "Cisco Systems", "/~7AAAA003.htm", "Base", "C9200L-24P-4G")
           + _blk("CSCO", "Cisco Systems", "/~7AAAA004.htm", "Table size", "0.75K")
           + _blk("CSCO", "Cisco Systems", "/~7AAAA005.htm", "Different uplink", "C9200L-24P-4X-E")
           + _blk("ACPM", "AddOn", "/~7AAAA006.htm", "AddOn Cisco C9200L-24P-4G Compatible", "C9200L-24P-4G-AO")
           + '<a class="PAGE" href="/service/searchsvcs/Q/P1?QUERY=C9200L-24P-4G">1</a>'
             '<a class="PAGE" href="/service/searchsvcs/Q/P2?QUERY=C9200L-24P-4G">2</a>'
             '<a class="NEXT" href="/service/searchsvcs/Q/P3?QUERY=C9200L-24P-4G">NEXT</a>'
             '<a class="NEXT" href="/service/searchsvcs/Q/P2?QUERY=C9300-24P">NEXT</a>'
             '</td></body></html>')
p2 = P.discover(P2_HTML, {"task": "listing", "key": P2_URL, "url": P2_URL, "vendor": "cisco"})
check("PG4", "a paginated search page fetched as a listing keeps the key's variants and the exact match, reassembled across spans",
      [t["key"] for t in p2 if t["task"] == "part-page"] == ["C9200L-24P-4G-E=", "C9200L-24P-4G"], str(p2))
check("PG4b", "SABOTAGE the AddOn row whose Part# is the key plus a house suffix is not queued for a cisco lookup",
      not any(t["key"] == "C9200L-24P-4G-AO" for t in p2), str([t["key"] for t in p2]))
check("PG5", "sabotage: the power supply whose description mentions the key, the quantity '0.75K' and the -4X uplink model are not queued",
      not any(t["key"] in ("PWR-C5-715WDC=", "0.75K", "C9200L-24P-4X-E") for t in p2), str(p2))
check("PG6", "pagination from page 2: page 1 and page 3 are listing tasks, page 2 itself and another query's NEXT are not",
      sorted(t["url"] for t in p2 if t["task"] == "listing") == [PAGES[0].replace("P2", "P1"), PAGES[1]], str([t for t in p2 if t["task"] == "listing"]))
check("PG6b", "SABOTAGE the manufacturer index every result row links is NOT a listing task on a search "
      "page: following AddOn's /~880ACPM.htm would crawl its whole catalogue from a Cisco lookup",
      not any("~880" in t["url"] for t in p2), str([t["url"] for t in p2 if t["task"] == "listing"]))
check("PG7", "a search page's pagination for a different QUERY than the task key is not followed",
      P.discover(shtml, {"task": "search", "key": "C9300-24P"}) == [], str(P.discover(shtml, {"task": "search", "key": "C9300-24P"})[:2]))
check("PG8", "the key-or-variant rule: exact, dash variants (also with '=' and '++'), never a longer model or containment",
      P._key_or_variant("C9200L-24P-4G-1A", "C9200L-24P-4G") and P._key_or_variant("c9200l-24p-4g-e=", "C9200L-24P-4G")
      and P._key_or_variant("C9200L-24P-4G-A++", "C9200L-24P-4G") and P._key_or_variant("C9200L-24P-4G", "C9200L-24P-4G")
      and not P._key_or_variant("C9200L-24P-4GX-E", "C9200L-24P-4G") and not P._key_or_variant("C9200-STACK-KIT", "C9200L-24P-4G")
      and not P._key_or_variant("", "C9200L-24P-4G") and not P._key_or_variant("C9200L-24P-4G", ""))

# =================================================================================================
# MANUFACTURER — the gate that was missing, proved on the REAL pages that broke without it
# =================================================================================================
# 4 Sep 2026: provantage fetched 992 pages, the adapter read facts off 208 part pages, and
# apply-acquired run #29 wrote nothing at all (`entries 208, parts_matched 0, sku_unknown 208`).
# Every one of the 208 was somebody else's product. A distributor sells the vendor's part AND
# three or four "compatible" copies of it, and a compatible's part number IS the original PID
# with a house suffix (-AO AddOn, -AX Axiom, -ENC ENET, -ST StarTech, -VEL Veloso), so no rule
# about the NUMBER can tell them apart. The row states its manufacturer; the adapter now reads it.
#
# Replayed over all 639 search pages cached that day: 411 part-page tasks before, 211 after, and
# every one of the 200 refused rows is a third-party brand (AddOn 58, Axiom 45, ENET 34,
# Veloso 32, Legrand 22, UNC 6, StarTech 2, Meraki 1). No Cisco row is lost: 152 before, 152 after.
def search_fixture(k: str) -> tuple[str, str]:
    u = f"https://www.provantage.com/scripts/search.dll?QUERY={k}"
    return u, fixture(u)


M_URL, M_HTML = search_fixture("10053H")
m_rows = P._result_rows(P.soup(M_HTML))
check("M1", "the real 10053H search page has the Extreme part and three compatible copies of it",
      [(r["part"], r["code"]) for r in m_rows]
      == [("10053H", "ETNT"), ("10053H-AO", "ACPM"), ("10053H-AX", "AXIO"), ("10053H-ENC", "ENET")],
      str([(r["part"], r["brand"], r["code"]) for r in m_rows]))
m_cisco = {"task": "search", "key": "10053H", "url": M_URL, "vendor": "cisco"}
check("M2", "SABOTAGE a CISCO lookup on that page proposes NOTHING (the old rule proposed all four)",
      [t for t in P.discover(M_HTML, m_cisco) if t["task"] == "part-page"] == [],
      str(P.discover(M_HTML, m_cisco)))
check("M3", "...and extract() calls it not_listed, although the AddOn titles repeat '10053H' verbatim",
      P.extract(M_HTML, m_cisco)["not_listed"] is True)
m_ext = {"task": "search", "key": "10053H", "url": M_URL, "vendor": "extreme"}
md = [t for t in P.discover(M_HTML, m_ext) if t["task"] == "part-page"]
check("M4", "the EXTREME lookup — the vendor this part really belongs to — keeps the one genuine row",
      len(md) == 1 and md[0]["key"] == "10053H" and md[0]["url"].endswith("~7ETNT0LQ.htm"), str(md))
check("M5", "...and that row carries inherit_part, so the page it opens reaches the apply with a part_id",
      md and md[0].get("inherit_part") is True, str(md))
check("M6", "...and the page is not not_listed for its own vendor", P.extract(M_HTML, m_ext)["not_listed"] is False)

X_URL, X_HTML = search_fixture("14X10GBE-WL-XFP")
xd = [t for t in P.discover(X_HTML, {"task": "search", "key": "14X10GBE-WL-XFP", "url": X_URL, "vendor": "cisco"}) if t["task"] == "part-page"]
check("M7", "a genuine Cisco hit still yields its page, with the '=' and '-RF' spellings of the same part",
      sorted(t["key"] for t in xd) == ["14X10GBE-WL-XFP", "14X10GBE-WL-XFP-RF", "14X10GBE-WL-XFP="], str([t["key"] for t in xd]))
check("M8", "...all three are the SAME part, so all three inherit the task's part_id",
      len(xd) == 3 and all(t.get("inherit_part") for t in xd), str(xd))

L_URL, L_HTML = search_fixture("00AY765")
check("M9", "SABOTAGE the Lenovo PID 00AY765: provantage lists only AddOn/Axiom/ENET/Veloso copies, so a "
      "lenovo lookup proposes nothing and the page is not_listed",
      [t for t in P.discover(L_HTML, {"task": "search", "key": "00AY765", "url": L_URL, "vendor": "lenovo"}) if t["task"] == "part-page"] == []
      and P.extract(L_HTML, {"task": "search", "key": "00AY765", "url": L_URL, "vendor": "lenovo"})["not_listed"] is True)

# the brand name is compared on letters and digits only, because the site's search highlighter
# splits it: searching "1-100GE-DWDM/C" renders Cisco as "C isco Systems" on the real page.
check("M10", "brand match: 'Cisco Systems' and the highlighter's 'C isco Systems' are both cisco",
      P._brand_is_vendor("Cisco Systems", "cisco") and P._brand_is_vendor("C isco Systems", "cisco"))
check("M11", "SABOTAGE 'HP' does not satisfy a lookup for 'hpe' (a prefix needs four characters)",
      P._brand_is_vendor("HP", "hpe") is False and P._brand_is_vendor("HPE", "hpe") is True)
check("M12", "Meraki is Cisco's brand on this site and every meraki-category part is vendor cisco",
      P._brand_is_vendor("Meraki", "cisco") is True)
for b in ("AddOn", "Axiom", "ENET", "StarTech.com", "Veloso", "Extreme Networks Inc."):
    check("M13", f"SABOTAGE '{b}' is not cisco", P._brand_is_vendor(b, "cisco") is False)
check("M14", "a vendor whose slug is longer than the printed name still matches (Dell / dell-emc)",
      P._brand_is_vendor("Dell", "dell-emc") is True)
check("M15", "no vendor and no brand is never a match", P._brand_is_vendor("", "cisco") is False and P._brand_is_vendor("Cisco", "") is False)

# with NO vendor on the task the adapter refuses to guess: the exact part only, and never from a
# house whose whole business is other vendors' PIDs with a suffix
nv = {"task": "search", "key": "10053H", "url": M_URL}
nvd = [t for t in P.discover(M_HTML, nv) if t["task"] == "part-page"]
check("M16", "no vendor on the task: only the exact Part#, and no compatible brand",
      [t["key"] for t in nvd] == ["10053H"], str(nvd))
check("M17", "SABOTAGE no vendor, and the only rows are compatibles -> nothing",
      [t for t in P.discover(L_HTML, {"task": "search", "key": "00AY765", "url": L_URL}) if t["task"] == "part-page"] == [])

check("M18", "same-part rule: the key, '=' and -RF/-WS are the same part; a licence variant is not",
      P._same_part("SFP-10G-SR", "SFP-10G-SR") and P._same_part("SFP-10G-SR=", "SFP-10G-SR")
      and P._same_part("SFP-10G-SR-RF", "SFP-10G-SR") and P._same_part("SFP-10G-SR-WS", "SFP-10G-SR")
      and not P._same_part("SFP-10G-SR-AO", "SFP-10G-SR") and not P._same_part("SFP-10G-SR2", "SFP-10G-SR")
      and not P._same_part("", "SFP-10G-SR") and not P._same_part("SFP-10G-SR", ""))

# ---- aliases: a UPC is a barcode or it is nothing --------------------------------------------------
UPC_BAD = UPC_ROW.replace("00882658684579", "N/A")
rb_ = P.extract(UPC_BAD, task)
check("A9", "sabotage: a UPC row saying N/A is neither an alias nor a fact", rb_["aliases"] == [] and not any("UPC" in f["label"] for f in rb_["facts"]), repr(rb_["aliases"]))
ru2 = P.extract(UPC_ROW.replace("00882658684579", "882 658 684 579"), task)
check("A10", "a UPC written with spaces is one 12-digit alias", ru2["aliases"] == [{"kind": "upc", "value": "882658684579"}], repr(ru2["aliases"]))
ITEMPROP = ('<html><body><td id="MAIN"><span itemprop="gtin13" content="0882658684579"></span><span itemprop="upc">TBD</span>'
            '<table><tr><td class="AT1">Manufacturer Part Number</td><td class="DT1">C9200L-24P-4G-1A</td></tr></table></td></body></html>')
ri_ = P.extract(ITEMPROP, task)
check("A11", "itemprop gtin13 becomes a gtin alias; an itemprop upc saying TBD does not", ri_["aliases"] == [{"kind": "gtin", "value": "0882658684579"}], repr(ri_["aliases"]))

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
