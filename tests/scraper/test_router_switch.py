"""tests/scraper/test_router_switch.py — proof for scraper/sources/router_switch.py.

Reads only the cache (scraper/cache/<sha1(url)>.html); never fetches. One PASS/MISS line per
case, non-zero exit on any miss.

    python3.11 tests/scraper/test_router_switch.py

Half the cases are refusals: a challenge page must be blocked, the 404 page must be not-found,
a foreign SKU must be not_listed, an empty comparison table must yield nothing, and a table
whose header is not "Model" must not be read as one. A suite of only the happy path would have
passed an adapter that filed a sibling's switching capacity under this SKU.
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import load_source  # noqa: E402

M = load_source("router-switch")

URL_SEARCH = "https://www.router-switch.com/catalogsearch/result/?q=C9200L-24P-4G"
URL_MAIN = "https://www.router-switch.com/c9200l-24p-4g-e.html"
URL_GLC = "https://www.router-switch.com/glc-te.html"
URL_404 = "https://www.router-switch.com/c9200l-24p-4g.html"

# labels that would mean chrome leaked into the facts. Whole words via explicit lookarounds:
# a bare "rating" matched "Operating Temperature" the first time this ran.
CHROME = re.compile(r"(?<![A-Za-z])(?:ratings?|reviews?|shipping|warranty|cart|related|cookies?|similar|"
                    r"prices?|delivery|in stock|add to|checkout|wishlist|compare list|subscribe)(?![A-Za-z])", re.I)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:70]:72}" + ("" if ok else f" | got {got[:160]}"))


def load(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}")
        raise SystemExit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


def fact(res: dict, label: str) -> str | None:
    for f in res["facts"]:
        if f["label"] == label:
            return f["value"]
    return None


# =============================================================================================
# the chrome check itself must be alive: it must fire on chrome and stay quiet on real labels
# =============================================================================================
check("T0.1", "chrome regex catches 'Customer Reviews' / 'Warranty' / 'Shipping Weight'",
      all(CHROME.search(x) for x in ("Customer Reviews", "Warranty", "Shipping Weight", "Rating", "List Price")))
check("T0.2", "chrome regex ignores 'Operating Temperature' / 'Noise Level' / 'Cartridge'",
      not any(CHROME.search(x) for x in ("Operating Temperature", "Noise Level (25°C ambient)", "Cartridge Slots")))

# =============================================================================================
# resolve()
# =============================================================================================
check("R1", "resolve search -> /search/<sku>",
      M.resolve({"task": "search", "key": "C9200L-24P-4G"}) == "https://www.router-switch.com/search/C9200L-24P-4G",
      str(M.resolve({"task": "search", "key": "C9200L-24P-4G"})))
check("R2", "resolve part-page -> /<sku lowercased>.html",
      M.resolve({"task": "part-page", "key": "C9200L-24P-4G-E"}) == "https://www.router-switch.com/c9200l-24p-4g-e.html",
      str(M.resolve({"task": "part-page", "key": "C9200L-24P-4G-E"})))
check("R3", "resolve part-page maps '/' the way the site does (C1-WS3850-24S/K9)",
      M.resolve({"task": "part-page", "key": "C1-WS3850-24S/K9"}) == "https://www.router-switch.com/c1-ws3850-24s-k9.html",
      str(M.resolve({"task": "part-page", "key": "C1-WS3850-24S/K9"})))
check("R4", "resolve returns a given url verbatim",
      M.resolve({"task": "part-page", "key": "X", "url": "https://www.router-switch.com/x.html"}) == "https://www.router-switch.com/x.html")
check("R5", "resolve refuses a task kind it does not handle (datasheet)",
      M.resolve({"task": "datasheet", "key": "https://x/y.pdf"}) is None)
check("R6", "resolve refuses an empty key", M.resolve({"task": "search", "key": ""}) is None)

# =============================================================================================
# main fixture: C9200L-24P-4G-E
# =============================================================================================
main_html = load(URL_MAIN)
main = M.extract(main_html, {"task": "part-page", "key": "C9200L-24P-4G-E"})
F = main["facts"]

check("M1", "sku is the page's own model as written", main["sku"] == "C9200L-24P-4G-E", main["sku"])
check("M2", "name is the h1", (main["name"] or "").startswith("C9200L-24P-4G-E, Cisco Catalyst 9200L Switch"), str(main["name"]))
check("M3", "not_listed False for the page's own SKU", main["not_listed"] is False, str(main["not_listed"]))
check("M4", f"at least 30 facts (got {len(F)})", len(F) >= 30, str(len(F)))

# exact label/value pairs as the page shows them
EXACT = [
    ("Product Features Comparison > Port Configuration", "24 × 10/100/1000BASE-T (RJ45) with PoE+; 4 × 1G SFP uplinks (included)"),
    ("Product Features Comparison > Switching Capacity", "96 Gbps"),
    ("Product Features Comparison > Forwarding Rate", "72 Mpps"),
    ("Product Features Comparison > PoE Budget", "370W total, supports 802.3af/at PoE+"),
    ("Product Features Comparison > Stacking Capability", "n/a"),
    ("Specification > Chassis Dimensions (H×W×D)", "Base: 1.73 × 17.5 × 11.3 in (4.4 × 44.5 × 28.8 cm); With FEP/Fan: 1.73 × 17.5 × 12.9 in (4.4 × 44.5 × 32.9 cm)"),
    ("Specification > Operating Temperature", "Standard: 32°F to 104°F (0°C to 40°C); Short-term: -5°C to 50°C (up to 96 hours/year)"),
    ("Specification > Noise Level (25°C ambient)", "LpA: 42 dB typical, 45 dB max; LwA: 5.3 B typical, 5.6 B max"),
    ("Specification > Compliance", "Safety: UL 60950-1, EN 62368-1; EMC: FCC Part 15 Class A, EN 55032; RoHS: Compliant"),
    ("Specification > Power Consumption with PoE (115V/230V AC)", "Idle: 38.95W / 38.57W; 50% Traffic: 44.08W / 43.69W; 100% Traffic: 49.00W / 48.62W"),
    ("Specification > Weight", "4.71 kg"),
    ("Specification > MTBF", "392,210 hours (~44.8 years)"),
]
for i, (label, value) in enumerate(EXACT, 1):
    got = fact(main, label)
    check(f"M5.{i}", f"exact: {label}", got == value, repr(got))

check("M6", "every fact has non-empty label, value and locator",
      all(f.get("label") and f.get("value") and f.get("locator") for f in F))
check("M7", "no value longer than 500 chars", all(len(f["value"]) <= 500 for f in F),
      str(max((len(f["value"]) for f in F), default=0)))
check("M8", "no chrome label (rating/review/shipping/warranty/cart/related/...)",
      not any(CHROME.search(f["label"]) for f in F), str([f["label"] for f in F if CHROME.search(f["label"])]))
check("M9", "no duplicated (label, value) pair", len({(f["label"], f["value"]) for f in F}) == len(F))
check("M10", "no label carries the page SKU as a section (per-product vocabulary)",
      not any("C9200L" in f["label"] for f in F), str([f["label"] for f in F if "C9200L" in f["label"]]))
check("M11", "every label is 'Section > Label'", all(" > " in f["label"] for f in F))
check("M12", "the same word in two sections stays two facts (Switching Capacity)",
      fact(main, "Specification > Switching Capacity") == "96 Gbps" and fact(main, "Product Features Comparison > Switching Capacity") == "96 Gbps")
check("M13", "list price is in price, not in facts",
      not any("4,136" in f["value"] or "1,169" in f["value"] for f in F))

# others: the sibling columns of the comparison table
osk = [o["sku"] for o in main["others"]]
check("O1", "others = the three sibling columns", osk == ["C1-WS3850-24S/K9", "C1-C2960X-24PD-L", "C1-WS3650-24PD/K9"], str(osk))
sib = {o["sku"]: o for o in main["others"]}
check("O2", "sibling column keeps its own value under the same label",
      fact(sib.get("C1-WS3850-24S/K9", {"facts": []}), "Product Features Comparison > Switching Capacity") == "92 Gbps")
check("O3", "sibling value never leaks into this SKU's facts",
      not any(f["value"] in ("92 Gbps", "216 Gbps (full-duplex)", "254 Gbps (Multigigabit model)") for f in F))
check("O4", "each other is a full RESULT with not_listed False",
      all(set(o) >= {"sku", "not_listed", "facts", "aliases", "images", "relations", "lifecycle", "name", "price", "others"} and o["not_listed"] is False for o in main["others"]))
check("O5", "every sibling fact has label/value/locator",
      all(f.get("label") and f.get("value") and f.get("locator") for o in main["others"] for f in o["facts"]))

# relations
rel = main["relations"]
check("A1", "three compatible accessories", [r["sku"] for r in rel] == ["PWR-C5-600WAC", "GLC-LH-SMD", "C9200L-STACK-KIT"], str([r["sku"] for r in rel]))
check("A2", "relation kind compatible with the documented note", all(r["kind"] == "compatible" and r["note"].startswith("listed as compatible accessory: ") for r in rel))
check("A3", "the header row 'Model Number' is not a relation", not any(r["sku"].lower().startswith("model") for r in rel))

# price / images
check("P1", "price.list_usd from 'List Price: $4,136.16'", (main["price"] or {}).get("list_usd") == 4136.16, str(main["price"]))
check("P2", "price.raw keeps the site's text", (main["price"] or {}).get("raw") == "List Price: $4,136.16", str(main["price"]))
check("I1", "one primary product photo from the site CDN",
      len(main["images"]) >= 1 and main["images"][0]["role"] == "primary"
      and main["images"][0]["url"] == "https://media.router-switch.com/media/catalog/product/cache/b90fceee6a5fa7acd36a04c7b968181c/c/i/cisco-c9200l-24p-4g-e.jpg",
      str(main["images"][:1]))
check("I2", "every image is absolute and on the catalog CDN, none a sibling / bundle / related product",
      all(i["url"].startswith("https://media.router-switch.com/media/catalog/product/") and "c9200l-24p-4g-e" in i["url"] for i in main["images"]),
      str([i["url"] for i in main["images"]]))

# =============================================================================================
# second product fixture: GLC-TE (transceiver; comparison models carry a 'Cisco ' prefix)
# =============================================================================================
glc_html = load(URL_GLC)
glc = M.extract(glc_html, {"task": "part-page", "key": "GLC-TE"})
check("G1", "sku GLC-TE", glc["sku"] == "GLC-TE", glc["sku"])
check("G2", "exact: Product Features Comparison > Max Distance = 100m", fact(glc, "Product Features Comparison > Max Distance") == "100m", str(fact(glc, "Product Features Comparison > Max Distance")))
check("G3", "exact: Specification > Operating Temperature = 23 °F - 185 °F", fact(glc, "Specification > Operating Temperature") == "23 °F - 185 °F", str(fact(glc, "Specification > Operating Temperature")))
check("G4", "exact: Specification > Interfaces", fact(glc, "Specification > Interfaces") == "1 x Ethernet 1000Base-T - RJ-45")
check("G5", "'Cisco ' stripped from sibling models", [o["sku"] for o in glc["others"]] == ["GLC-SX-MM", "GLC-LH-SM"], str([o["sku"] for o in glc["others"]]))
check("G6", "own column found although the cell says 'Cisco GLC-TE' (Cable Type = Copper, not MMF)", fact(glc, "Product Features Comparison > Cable Type") == "Copper", str(fact(glc, "Product Features Comparison > Cable Type")))
check("G7", "the blank trailing spec item is not a fact", all(f["label"] != "Specification > " and f["value"] for f in glc["facts"]))
check("G8", "at least 15 facts", len(glc["facts"]) >= 15, str(len(glc["facts"])))
check("G9", "price.list_usd 570.10", (glc["price"] or {}).get("list_usd") == 570.10, str(glc["price"]))
check("G10", "accessories GLC-H-PRO / GLC-T-RGD / CVR-X2-SFP", [r["sku"] for r in glc["relations"]] == ["GLC-H-PRO", "GLC-T-RGD", "CVR-X2-SFP"], str([r["sku"] for r in glc["relations"]]))
check("G11", "one primary image of glc-te", len(glc["images"]) >= 1 and "glc-te" in glc["images"][0]["url"] and glc["images"][0]["role"] == "primary", str(glc["images"]))

# =============================================================================================
# not_listed
# =============================================================================================
check("N1", "not_listed True for ZZZ-NOT-ON-THIS-PAGE", M.extract(main_html, {"key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)
check("N2", "base SKU C9200L-24P-4G is listed on the -E variant page", M.extract(main_html, {"key": "C9200L-24P-4G"})["not_listed"] is False)
check("N3", "key written with '=' and lowercase still matches", M.extract(main_html, {"key": "c9200l-24p-4g-e="})["not_listed"] is False)
check("N4", "a key that is one of the 'others' is not not_listed", M.extract(main_html, {"key": "C1-C2960X-24PD-L"})["not_listed"] is False)
check("N5", "GLC-T is NOT listed on the GLC-TE page (containment is not identity)", M.extract(glc_html, {"key": "GLC-T"})["not_listed"] is True)
check("N6", "an accessory SKU is a relation, not a listing", M.extract(main_html, {"key": "PWR-C5-600WAC"})["not_listed"] is True)

# =============================================================================================
# discover() on the search fixture
# =============================================================================================
search_html = load(URL_SEARCH)
found = M.discover(search_html, {"task": "search", "key": "C9200L-24P-4G"})
check("D1", f"discover returns at least 1 part-page task (got {len(found)})", len(found) >= 1, str(found))
check("D2", "only task kinds resolve() handles", all(t["task"] in ("part-page", "search") and M.resolve(t) for t in found), str(found))
check("D3", "absolute .html urls on router-switch.com", all(t.get("url", "").startswith("https://www.router-switch.com/") and t["url"].endswith(".html") for t in found), str(found))
check("D4", "canonical keys: upper-case SKU, no 'Cisco ' prefix, no whitespace", all(re.fullmatch(r"[A-Z0-9][A-Z0-9./+=-]*", t["key"]) for t in found), str([t["key"] for t in found]))
check("D5", "the -E variant of the key is discovered", any(t["key"] == "C9200L-24P-4G-E" and t["url"] == URL_MAIN for t in found), str(found))
check("D6", "C9200L-24P-4X-E (different uplink) is NOT a variant of C9200L-24P-4G", not any(t["key"] == "C9200L-24P-4X-E" for t in found), str(found))
check("D7", "a sibling model in the same family is not discovered", not any(t["key"].startswith("C9200L-48") for t in found), str(found))
found48 = M.discover(search_html, {"task": "search", "key": "C9200L-48T-4G"})
check("D8", "anchor text 'Cisco C9200L-48T-4G-E' loses its brand prefix", any(t["key"] == "C9200L-48T-4G-E" for t in found48), str(found48))
check("D9", "no duplicate urls", len({t["url"] for t in found48}) == len(found48))
check("D10", "discover with no key returns nothing", M.discover(search_html, {"task": "search", "key": ""}) == [])

# =============================================================================================
# sabotage
# =============================================================================================
CHALLENGE = "<html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing the site.</p></body></html>"
check("S1", "a short 'Just a moment...' page is blocked", M.is_blocked(CHALLENGE) is True)
check("S2", "the real product page is not blocked", M.is_blocked(main_html) is False)
check("S3", "the search page is not blocked", M.is_blocked(search_html) is False)
nf_html = load(URL_404)
check("S4", "the site 404 fixture is not-found (title '404 Page Not Found')", M.is_not_found(nf_html) is True)
check("S5", "a synthetic page carrying the marker is not-found",
      M.is_not_found("<html><head>\n<title>404 Page Not Found - Router-Switch.com</title></head><body></body></html>") is True)
check("S6", "the real product page is not not-found", M.is_not_found(main_html) is False)
check("S7", "the search page is not not-found", M.is_not_found(search_html) is False)

EMPTY = """<html><head><title>ABC-123 Price</title></head><body>
<h1>ABC-123, Cisco Something</h1>
<div class="product_compare"><h3>Product Features Comparison</h3><table></table></div>
<div class="prt_specification_wrap"><div class="product_table_list_wrap_v0"></div></div>
<div class="product_optional"><table><tr><td>Model Number</td><td>Description</td></tr></table></div>
</body></html>"""
e = M.extract(EMPTY, {"task": "part-page", "key": "ABC-123"})
check("S8", "empty spec table -> zero facts", e["facts"] == [], str(e["facts"]))
check("S9", "empty spec table -> not_listed False (the page is still about the key)", e["not_listed"] is False)
check("S10", "empty accessories table -> no relations, empty others", e["relations"] == [] and e["others"] == [])

SHIFTED = """<html><body><h1>ABC-123, Cisco Something</h1>
<div class="product_compare"><h3>Product Features Comparison</h3><table>
<tr><td>ABC-123</td><td>256 Gbps</td><td>190 Mpps</td></tr>
<tr><td>Model</td><td>Switching Capacity</td><td>Forwarding Rate</td></tr>
<tr><td>ABC-456</td><td>128 Gbps</td><td>95 Mpps</td></tr>
</table></div></body></html>"""
sh = M.extract(SHIFTED, {"task": "part-page", "key": "ABC-123"})
check("S11", "comparison table whose first row is not 'Model' yields no comparison facts", sh["facts"] == [] and sh["others"] == [], str(sh["facts"]))

SHORTROW = """<html><body><h1>ABC-123, Cisco Something</h1>
<div class="product_compare"><h3>Product Features Comparison</h3><table>
<tr><td>Model</td><td>ABC-123</td><td>ABC-456</td></tr>
<tr><td>Switching Capacity</td><td>256 Gbps</td><td>128 Gbps</td></tr>
<tr><td>Forwarding Rate</td><td>190 Mpps</td></tr>
</table></div></body></html>"""
sr = M.extract(SHORTROW, {"task": "part-page", "key": "ABC-123"})
check("S12", "a short row never shifts a value into the sibling column",
      fact(sr, "Product Features Comparison > Switching Capacity") == "256 Gbps"
      and fact(sr["others"][0], "Product Features Comparison > Forwarding Rate") is None
      and fact(sr["others"][0], "Product Features Comparison > Switching Capacity") == "128 Gbps", str((sr["facts"], sr["others"])))

# =============================================================================================
# documents: the datasheet PDFs the download tab links (the worker queues them as datasheet tasks)
# =============================================================================================
docs = main["documents"]
check("DOC1", "main fixture: exactly the Cisco Catalyst 9200 datasheet PDF, kind pdf, with its title",
      docs == [{"url": "https://www.router-switch.com/media/upload/product-pdf/cisco-catalyst-9200-switch-datasheet.pdf",
                "kind": "pdf", "title": "Cisco Catalyst 9200 Switch Datasheet", "role": "datasheet"}], str(docs))
check("DOC2", "the comparison / quick-check brochures in the same tab and the header's PDFs are not documents",
      not any(re.search(r"comparison|quick-check|products-catalog|dell-r740", d["url"]) for d in docs), str(docs))
check("DOC3", "GLC-TE fixture: no datasheet PDF in its download tab -> []", glc["documents"] == [], str(glc["documents"]))
check("DOC4", "the empty page carries the documents key (contract), empty", e["documents"] == [])
CISCO_PDF = """<html><body><nav><a href="https://www.cisco.com/c/dam/nav-brochure.pdf">Brochure</a></nav>
<h1>ABC-123, Cisco Something</h1><div class="tab-body"><p>See also
<a href="https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.pdf">Read more</a></p></div>
<section id="tab-download"><ul class="download-list">
<li><a href="/media/upload/product-pdf/quick-start-guide.pdf">Quick Start Guide</a></li>
<li><a href="/media/upload/product-pdf/abc-123-spec-sheet.pdf">Spec Sheet</a></li>
<li><a href="/media/upload/product-pdf/abc-123-spec-sheet.pdf">Spec Sheet (again)</a></li>
<li><a href="/media/upload/product-pdf/data-sheet.html">Datasheet page, not a PDF</a></li></ul></section>
<footer><a href="/media/upload/product-pdf/company-datasheet.pdf">Company datasheet</a></footer></body></html>"""
cd = M.extract(CISCO_PDF, {"task": "part-page", "key": "ABC-123"})["documents"]
check("DOC5", "a Cisco-hosted PDF in the body is a document even without the word datasheet; the spec sheet in the tab too; each once",
      [d["url"] for d in cd] == ["https://www.router-switch.com/media/upload/product-pdf/abc-123-spec-sheet.pdf",
                                 "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.pdf"], str(cd))
check("DOC6", "sabotage: a Cisco PDF inside <nav>, a footer 'datasheet', a quick-start guide and an .html 'datasheet' are not documents",
      not any(re.search(r"nav-brochure|company-datasheet|quick-start|\.html$", d["url"]) for d in cd), str(cd))
check("DOC7", "every document is an absolute .pdf url with kind pdf and a title", all(d["url"].startswith("https://") and d["url"].lower().endswith(".pdf") and d["kind"] == "pdf" and d["title"] for d in cd + docs))

# =============================================================================================
# discover: exact match first and ahead in priority; variants queued; junk keys never proposed
# =============================================================================================
SEARCH2 = """<html><body><ul>
<li><a href="/c9200l-24p-4g-e.html">C9200L-24P-4G-E</a></li>
<li><a href="/c9200l-24p-4g.html">Cisco C9200L-24P-4G</a></li>
<li><a href="/c9200l-24p-4g-a.html">C9200L-24P-4G-A</a></li>
<li><a href="/c9200l-48p-4g.html">C9200L-48P-4G</a></li></ul></body></html>"""
d2 = M.discover(SEARCH2, {"task": "search", "key": "C9200L-24P-4G", "priority": 100})
check("DX1", "the exact match comes first with priority 90 (ten ahead of the task's 100)",
      d2 and d2[0]["key"] == "C9200L-24P-4G" and d2[0]["priority"] == 90, str(d2))
check("DX2", "the variants follow, without a priority of their own (they inherit the task's)",
      [t["key"] for t in d2[1:]] == ["C9200L-24P-4G-E", "C9200L-24P-4G-A"] and not any("priority" in t for t in d2[1:]), str(d2))
check("DX3", "a sibling model is still not discovered", not any(t["key"] == "C9200L-48P-4G" for t in d2))
check("DX4", "priority never drops below 1", M.discover(SEARCH2, {"task": "search", "key": "C9200L-24P-4G", "priority": 5})[0]["priority"] == 1)
check("DX5", "the real search fixture (variants only) queues the -E variant with no priority bump",
      found and all("priority" not in t for t in found), str(found))
JUNK = """<html><body><a href="/0-75k.html">0.75K</a> <a href="/10-100-1000.html">10/100/1000</a> <a href="/01-may-2022.html">01-MAY-2022</a></body></html>"""
check("DX6", "sabotage: an anchor whose text is a quantity, a speed list or a date is never proposed, even as the task's own key",
      M.discover(JUNK, {"task": "search", "key": "0.75K"}) == [] and M.discover(JUNK, {"task": "search", "key": "10/100/1000"}) == []
      and M.discover(JUNK, {"task": "search", "key": "01-MAY-2022"}) == [])

print(f"\n{npass} passed, {nfail} missed")
# =============================================================================================
# the search lane, corrected from 194 real search pages captured 4 Sep 2026
# =============================================================================================
# All 194 were the site's rendered "no results" page and every one was recorded as a page that
# loaded and yielded nothing. The site says outright that it has no such part; saying so is a
# different fact from "the adapter read nothing", and only one of them is an adapter problem.
NORESULT_URL = "https://www.router-switch.com/search/10-1022038-01"
nr_html = load(NORESULT_URL)
check("SR1", "the real no-results search page is not-found", M.is_not_found(nr_html) is True)
check("SR2", "...and it is not blocked (a 1.3 MB rendered page, not a challenge)",
      M.is_blocked(nr_html) is False)
check("SR3", "...and it proposes no tasks", M.discover(nr_html, {"task": "search", "key": "10-1022038-01"}) == [])
check("SR4", "the marker is found beyond the first 20 kB (the block sits ~1.16 MB in)",
      M.is_not_found("x" * 900_000 + '<div id="product-search-not-found-header">Uh-Oh! No Results Found.</div>') is True)
# SABOTAGE: the marker must not fire on pages that DO have something, or every search and every
# product page is thrown away for the rest of the crawl.
check("SR5", "SABOTAGE the real product page is still not not-found", M.is_not_found(main_html) is False)
check("SR6", "SABOTAGE the header-only search fixture is still not not-found", M.is_not_found(search_html) is False)
check("SR7", "SABOTAGE prose containing 'results' does not trigger",
      M.is_not_found("<html><body><p>Showing 12 results for switches, no results were excluded</p></body></html>") is False)

# WAIT_FOR: the worker waits for one of these before it captures. It must be a CSS list that
# covers BOTH page shapes, or an empty search sits out the full timeout on every key.
check("SR8", "WAIT_FOR is a CSS list naming the search app and the product blocks",
      "#product-search" in M.WAIT_FOR and "prt_specification_wrap" in M.WAIT_FOR and "," in M.WAIT_FOR, M.WAIT_FOR)
for _sel, _doc, _name in ((["#product-search"], nr_html, "no-results page"),
                          (["div.prt_specification_wrap", "div.product_compare"], main_html, "product page")):
    _s = M.soup(_doc)
    check("SR9", f"WAIT_FOR matches the {_name}", any(_s.select(x) for x in _sel), str(_sel))

# The product-grid anchor form: "<SKU>, Cisco <description>" -- the site's own h1, used by every
# grid. The old rule asked whether the anchor's WHOLE text was the SKU, so a working results page
# would still have discovered nothing. Proved against the related-products carousel on the real
# product fixture, whose slugs are not derivable from the SKU.
check("SK1", "_anchor_sku reads the SKU from the site's product-title form",
      M._anchor_sku("C9200L-24P-4G-E, Cisco Catalyst 9200L Switch, 24xPoE+ Ports/4x1G Uplink") == "C9200L-24P-4G-E")
check("SK2", "_anchor_sku still accepts a bare SKU and strips a leading 'Cisco'",
      M._anchor_sku("Cisco C9200L-24P-4G") == "C9200L-24P-4G" and M._anchor_sku("GLC-TE") == "GLC-TE")
check("SK3", "_anchor_sku refuses a sentence with no comma (a title is not a part number)",
      M._anchor_sku("Cisco Catalyst 9200 Series Switches Data Sheet") == "",
      repr(M._anchor_sku("Cisco Catalyst 9200 Series Switches Data Sheet")))
check("SK3b", "a nav link's leading word ('Routers, Switches and Firewalls') is refused as bare_word",
      M._anchor_sku("Routers, Switches and Firewalls") == "Routers"
      and M.is_part_number("Routers")[1] == "bare_word")
check("SK4", "_anchor_sku refuses an empty or whitespace anchor", M._anchor_sku("") == "" and M._anchor_sku("   ") == "")
for _key, _slug_seen in (("GLC-LH-SMD", "glc-lh-smd-p-4960.html"), ("PWR-C5-600WAC/2", "pwr-c5-600wac-2.html"),
                         ("C9200L-48PXG-2Y-A", "c9200l-48pxg-2y-a.html"), ("C9200L-DNA-E-24-3Y", "c9200l-dna-e-24-3y.html")):
    _d = M.discover(main_html, {"task": "search", "key": _key})
    check("SK5", f"title-form anchor discovered for {_key} at its real slug",
          any(t["url"].endswith(_slug_seen) for t in _d), str([t["url"] for t in _d]))
# SABOTAGE: reading the leading token must not loosen the identity rule
_dbase = M.discover(main_html, {"task": "search", "key": "C9200L-24P-4G"})
check("SK6", "SABOTAGE a title-form anchor for a DIFFERENT part is not discovered",
      not any(t["key"].startswith("PWR-") or t["key"].startswith("GLC-") for t in _dbase),
      str([t["key"] for t in _dbase]))
GRID = ('<html><body><ol class="products">'
        '<li><a href="/c9200l-24p-4g-e.html">C9200L-24P-4G-E, Cisco Catalyst 9200L Switch, 24xPoE+</a></li>'
        '<li><a href="/c9200l-24p-4g-a.html">C9200L-24P-4G-A, Cisco Catalyst 9200L Switch, Network Advantage</a></li>'
        '<li><a href="/c9200-stack-kit.html">C9200-STACK-KIT, Cisco Stacking Kit for the C9200L-24P-4G</a></li>'
        '<li><a href="/0-75k.html">0.75K, Cisco Table Size</a></li></ol></body></html>')
_g = M.discover(GRID, {"task": "search", "key": "C9200L-24P-4G"})
check("SK7", "a results grid written in the title form yields both licence variants",
      sorted(t["key"] for t in _g) == ["C9200L-24P-4G-A", "C9200L-24P-4G-E"], str([t["key"] for t in _g]))
check("SK8", "SABOTAGE the stack kit named in a sibling's description is not discovered",
      not any(t["key"] == "C9200-STACK-KIT" for t in _g))
check("SK9", "SABOTAGE a junk leading token in the title form is refused by is_part_number",
      not any(t["key"] == "0.75K" for t in M.discover(GRID, {"task": "search", "key": "0.75K"})))

# =============================================================================================
# A SEARCH PAGE IS NOT A PART
# =============================================================================================
# 4 Sep 2026, apply-acquired run #30: entries 193, parts_matched 0, sku_unknown 193. 176 of those
# entries were SEARCH pages, and each one's "sku" was its own heading — "Search results for:
# '10-2003-01'". extract() ended in `sku = spec_sku or compare_sku or h1_sku`, and on a results
# grid the first two are empty, so the heading became the part number. A search page has no
# specification to give: its whole product is the tasks discover() proposes, and a search that
# matched nothing is the SITE's answer (not_listed), not an entry.
SEARCH_REAL_URL = "https://www.router-switch.com/search/10-2003-01"
sr_html = load(SEARCH_REAL_URL)
sr_task = {"task": "search", "key": "10-2003-01", "url": SEARCH_REAL_URL}
sr_soup = M.soup(sr_html)
_h1 = sr_soup.find("h1")
check("SP1", "the real cached search page really does head itself 'Search results for: ...' (the "
      "string that became 193 part numbers)",
      _h1 is not None and _h1.get_text(" ", strip=True).lower().startswith("search results for"),
      _h1.get_text(" ", strip=True) if _h1 else "no h1")
sr = M.extract(sr_html, sr_task)
check("SP2", "extract() on it yields NO sku, no facts, no others and no relations — the apply sees "
      "no entry at all", sr["sku"] is None and sr["facts"] == [] and sr["others"] == [] and sr["relations"] == [],
      repr({k: sr[k] for k in ("sku", "facts", "others")}))
check("SP3", "...and the page is not_listed, because no row on it matches the key",
      sr["not_listed"] is True)
check("SP4", "_is_search_page recognises it three ways: the task kind, the /search/ URL and the "
      "rendered app root",
      M._is_search_page(sr_soup, {"task": "search", "key": "x"})
      and M._is_search_page(sr_soup, {"task": "listing", "key": SEARCH_REAL_URL, "url": SEARCH_REAL_URL})
      and M._is_search_page(sr_soup, {"task": "listing", "key": "x", "url": "https://www.router-switch.com/other"}))
# SABOTAGE: the guard must not swallow a real product page, or the source yields nothing at all
check("SP5", "SABOTAGE the real PRODUCT page is not a search page and still yields its sku and facts",
      M._is_search_page(M.soup(main_html), {"task": "part-page", "key": "C9200L-24P-4G-E"}) is False
      and M.extract(main_html, {"task": "part-page", "key": "C9200L-24P-4G-E"})["sku"] == "C9200L-24P-4G-E"
      and len(M.extract(main_html, {"task": "part-page", "key": "C9200L-24P-4G-E"})["facts"]) > 10)
# SABOTAGE: a prose heading on a page that is NOT a search page must still not become a SKU
PROSE_H1 = ('<html><body><h1>Cisco Catalyst 9200 Series Switches Data Sheet</h1>'
            '<div class="prt_specification_wrap"><div class="item"><div class="item_name">Ports</div>'
            '<div>24</div></div></div></body></html>')
rp = M.extract(PROSE_H1, {"task": "part-page", "key": "10-2003-01"})
check("SP6", "SABOTAGE a prose heading never becomes the sku even on a page the search guard does "
      "NOT catch: it has spaces and fails the one part-number rule",
      rp["sku"] == "" and rp["not_listed"] is True, repr({k: rp[k] for k in ("sku", "not_listed")}))
SEARCH_H1 = PROSE_H1.replace("Cisco Catalyst 9200 Series Switches Data Sheet", "Search results for: '10-2003-01'")
rq = M.extract(SEARCH_H1, {"task": "part-page", "key": "10-2003-01"})
check("SP6b", "...and a results heading is caught by the search guard first, so even a page with a "
      "spec block yields no entry", rq["sku"] is None and rq["facts"] == [], repr({k: rq[k] for k in ("sku", "facts")}))
# a search that DID match hands its part_id down with the exact row
_ih = M.discover(GRID, {"task": "search", "key": "C9200L-24P-4G-E"})
check("SP7", "the discovered row that IS the searched part carries inherit_part; a variant does not",
      any(t["key"] == "C9200L-24P-4G-E" and t.get("inherit_part") for t in _ih)
      and not any(t["key"] != "C9200L-24P-4G-E" and t.get("inherit_part") for t in _ih), str(_ih))

raise SystemExit(1 if nfail else 0)
