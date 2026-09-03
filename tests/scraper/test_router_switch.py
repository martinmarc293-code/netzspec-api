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
raise SystemExit(1 if nfail else 0)
