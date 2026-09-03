"""tests/scraper/test_itprice.py — proof for scraper/sources/itprice.py.

Reads only the cache (scraper/cache/<sha1(url)>.html, keyed through netzscrape._key); never
fetches. One PASS/MISS line per case, non-zero exit on any miss.

    python3.11 tests/scraper/test_itprice.py
    python3.11 scripts/run_py_tests.py itprice

Half the cases are refusals. The ones with teeth here: the GPL fixture for C9200L-24P-4G lists
nine VARIANTS and not the base SKU, so an adapter that tested containment instead of equality
would file the -A variant's list price under the base part; a part page links ~125 service
contracts, which must become relations and never part-page tasks; the price cell carries a
"Price Alert" button that must not end up inside the amount; "N/A" is not an end-of-sale date.
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import load_source  # noqa: E402

M = load_source("itprice")

URL_GPL = "https://itprice.com/cisco-gpl/C9200L-24P-4G"
URL_PART = "https://itprice.com/cisco/c9200l-24p-4g-a.html"
URL_INDEX = "https://itprice.com/cisco-gpl/"
URL_HP = "https://itprice.com/hp-price-list"

# Labels that would mean site chrome leaked into the facts. "price" is here on purpose: the
# part-page table has a "Global Price in USD" row and the GPL table a "List Price" column, and
# both must land in the price field, never in facts. "get discount" is the button text, spelled
# out because a bare "discount" would also match "Category Base Discount Name", which is a real
# Cisco GPL field (its value is the discount category, e.g. CORE) and not chrome.
CHROME = re.compile(r"rating|review|shipping|warranty|cart|related|cookie|similar|price|delivery|"
                    r"in stock|add to|checkout|wishlist|compare|subscribe|alert|buy now|quote|get discount|"
                    r"navigation|menu", re.I)
PART_URL_RX = re.compile(r"^https://itprice\.com/(?:cisco|[a-z0-9]+-price-list)/[^/]+\.html$")
KEY_RX = re.compile(r"^[A-Z0-9][A-Z0-9.+=/_-]*$")

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:72]:74}" + ("" if ok else f" | got {got[:160]}"))


def load(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}")
        raise SystemExit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


def shape_ok(res: dict) -> tuple[bool, str]:
    for f in res["facts"]:
        if not (f.get("label") and f.get("value") and f.get("locator")):
            return False, repr(f)
        if len(f["value"]) > 500:
            return False, f"{f['label']} value {len(f['value'])} chars"
    return True, ""


# ---- resolve(): the documented URL for every task kind ----------------------------------------
check("R1", "gpl builds /cisco-gpl/<sku> as written", M.resolve({"task": "gpl", "key": "C9200L-24P-4G"}) == URL_GPL,
      str(M.resolve({"task": "gpl", "key": "C9200L-24P-4G"})))
check("R2", "part-page builds /cisco/<sku lowercased>.html",
      M.resolve({"task": "part-page", "key": "C9200L-24P-4G-A"}) == URL_PART, str(M.resolve({"task": "part-page", "key": "C9200L-24P-4G-A"})))
check("R3", "part-page keeps '+' literal, as the site links C9200L-24P-4G-A++ itself",
      M.resolve({"task": "part-page", "key": "C9200L-24P-4G-A++"}) == "https://itprice.com/cisco/c9200l-24p-4g-a++.html")
check("R4", "part-page with a url uses the url (brand price-list pages)",
      M.resolve({"task": "part-page", "key": "P00930-B21", "url": "https://itprice.com/hp-price-list/p00930-b21.html"}) == "https://itprice.com/hp-price-list/p00930-b21.html")
check("R5", "listing with an absolute URL returns it unchanged", M.resolve({"task": "listing", "key": URL_HP}) == URL_HP)
check("R6", "listing with a site-relative key is absolutised", M.resolve({"task": "listing", "key": "/hp-price-list"}) == URL_HP)
check("R7", "unknown task kind -> None", M.resolve({"task": "search", "key": "X"}) is None)
check("R8", "empty key -> None", M.resolve({"task": "gpl", "key": ""}) is None)

# ---- extract() on the part page (main fixture for facts) ----------------------------------------
part_html = load(URL_PART)
part_task = {"task": "part-page", "key": "C9200L-24P-4G-A", "url": URL_PART}
r = M.extract(part_html, part_task)
facts = r["facts"]
by_label = {f["label"]: f["value"] for f in facts}

check("E1", "sku is the Product cell", r["sku"] == "C9200L-24P-4G-A", repr(r["sku"]))
check("E2", "not_listed False for the page's own SKU", r["not_listed"] is False)
check("E3", "name is the h1", r["name"] == "Cisco C9200L-24P-4G-A", repr(r["name"]))
check("E4", f"at least 10 facts (got {len(facts)})", len(facts) >= 10)

EXACT = [
    ("Product", "C9200L-24P-4G-A"),
    ("Product Description", "Catalyst 9200L 24-port PoE+, 4 x 1G, Network Advantage"),
    ("Service Category", "C"),
    ("Orderability", "ICW-ONLY"),
    ("Item Identifier", "Product"),
    ("Category Base Discount Name", "CORE"),
    ("Quantity Min", "N/A"),
    ("End Of Sale Date", "N/A"),
]
for i, (label, value) in enumerate(EXACT, 1):
    check(f"X{i}", f"exact: {label} = {value}", by_label.get(label) == value, repr(by_label.get(label)))

ok, why = shape_ok(r)
check("S1", "every fact has non-empty label, value, locator; no value over 500 chars", ok, why)
check("S2", "locators are unique", len({f["locator"] for f in facts}) == len(facts))
chrome_hits = [f["label"] for f in facts if CHROME.search(f["label"])]
check("S3", "no chrome label among the facts", not chrome_hits, str(chrome_hits))
check("S4", "no dollar amount among fact values", not any("$" in f["value"] for f in facts), str([f for f in facts if "$" in f["value"]][:2]))
check("S5", "the Smartnet rows are not facts", not any("smartnet" in f["label"].lower() for f in facts), str([f["label"] for f in facts]))
check("S6", "no fact value mentions the alert sign-up ('Price Alert', 'Alert Type')",
      not any(re.search(r"alert", f["value"], re.I) for f in facts), str([f for f in facts if re.search(r"alert", f["value"], re.I)][:2]))

check("P1", "price: Global Price in USD -> list_usd 4136.16 without the 'Price Alert' button text",
      (r["price"] or {}).get("list_usd") == "4136.16", repr(r["price"]))
check("P2", "price: currency USD, published_by Cisco GPL",
      (r["price"] or {}).get("currency") == "USD" and (r["price"] or {}).get("published_by") == "Cisco GPL", repr(r["price"]))
check("P3", "the shop's 'US$ 606.00 85% OFF' is recorded nowhere",
      "606" not in str(r["price"]) and not any("606" in f["value"] for f in facts), repr(r["price"]))

check("L1", "lifecycle None when End Of Sale Date is N/A", r["lifecycle"] is None, repr(r["lifecycle"]))
rels = r["relations"]
check("C1", f"relations: at least 100 service contracts (got {len(rels)})", len(rels) >= 100)
check("C2", "relations: every entry is kind compatible with a CON-... sku and a 'service contract' note",
      all(x["kind"] == "compatible" and re.fullmatch(r"CON-[A-Z0-9]+-[A-Z0-9]+", x["sku"]) and x["note"].startswith("service contract") for x in rels),
      str([x for x in rels if not x["note"].startswith("service contract")][:2]))
check("C3", "relations: the Hotsale entry keeps its term (CON-SNT-C920L2GA -> 1 Year 8X5XNBD)",
      any(x["sku"] == "CON-SNT-C920L2GA" and "1 Year 8X5XNBD" in x["note"] for x in rels))
check("C4", "relations: a code listed in both Smartnet cells appears once", len({x["sku"] for x in rels}) == len(rels))
check("C5", "relations: a Finder-only code is present (CON-3OSP-C920L2GA)", any(x["sku"] == "CON-3OSP-C920L2GA" for x in rels))
check("I1", "images: the page has no product photo -> [] (logo and form tick are not photos)", r["images"] == [], repr(r["images"]))
check("A1", "aliases [] and others [] on a part page", r["aliases"] == [] and r["others"] == [])

# ---- not_listed on the part page ---------------------------------------------------------------------
check("N1", "task key ZZZ-NOT-ON-THIS-PAGE -> not_listed True",
      M.extract(part_html, {"task": "part-page", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)
check("N2", "key differing only by case/'+'/'=' -> not_listed False",
      M.extract(part_html, {"task": "part-page", "key": "c9200l-24p-4g-a+="})["not_listed"] is False)
check("N3", "the base SKU is not the -A variant -> not_listed True",
      M.extract(part_html, {"task": "part-page", "key": "C9200L-24P-4G"})["not_listed"] is True)

# ---- extract() on the GPL page ---------------------------------------------------------------------------
gpl_html = load(URL_GPL)
g = M.extract(gpl_html, {"task": "gpl", "key": "C9200L-24P-4G-A"})
check("G1", "gpl: the row whose Product equals the key is the result", g["sku"] == "C9200L-24P-4G-A" and g["not_listed"] is False, repr((g["sku"], g["not_listed"])))
check("G2", "gpl: exact Description fact with the row's trailing period kept",
      g["facts"] == [{"label": "Description", "value": "Catalyst 9200L 24-port PoE+, 4 x 1G, Network Advantage.", "locator": "gpl:r1"}], repr(g["facts"]))
check("G3", "gpl: price list_usd 4136.16 published_by Cisco GPL",
      (g["price"] or {}).get("list_usd") == "4136.16" and (g["price"] or {}).get("published_by") == "Cisco GPL", repr(g["price"]))
check("G4", "gpl: released = 'April 8, 2025'", (g["price"] or {}).get("released") == "April 8, 2025", repr(g["price"]))
check("G5", f"gpl: the other 8 rows are in others (got {len(g['others'])})", len(g["others"]) == 8)
check("G6", "gpl: every other carries a sku, a Description fact and a list price",
      all(o["sku"] and o["facts"] and o["facts"][0]["label"] == "Description" and (o["price"] or {}).get("list_usd") for o in g["others"]),
      str([o["sku"] for o in g["others"] if not o["facts"]]))
check("G7", "gpl: others hold the variants (-E, -A-RF, -1E present)",
      {"C9200L-24P-4G-E", "C9200L-24P-4G-A-RF", "C9200L-24P-4G-1E"} <= {o["sku"] for o in g["others"]}, str([o["sku"] for o in g["others"]]))
check("G8", "gpl: 'Our Price' / 'Buy Now' / 'Get Discount' appear nowhere in the result",
      not re.search(r"606\.00|Buy Now|Get Discount|OFF", str(g)), "")
ok, why = shape_ok(g)
check("G9", "gpl: fact shape holds for the result and every other", ok and all(shape_ok(o)[0] for o in g["others"]), why)
gb = M.extract(gpl_html, {"task": "gpl", "key": "C9200L-24P-4G"})
check("G10", "gpl: the base SKU has no row of its own -> not_listed True, sku None, 9 others",
      gb["not_listed"] is True and gb["sku"] is None and gb["facts"] == [] and len(gb["others"]) == 9, repr((gb["not_listed"], gb["sku"], len(gb["others"]))))
check("G11", "gpl: key ZZZ-NOT-ON-THIS-PAGE -> not_listed True",
      M.extract(gpl_html, {"task": "gpl", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)

# ---- discover() -----------------------------------------------------------------------------------------------
gd = M.discover(gpl_html, {"task": "gpl", "key": "C9200L-24P-4G"})
check("D1", f"gpl discover: 9 part-page tasks, one per row (got {len(gd)})", len(gd) == 9)
check("D2", "gpl discover: only part-page tasks with absolute /cisco/<sku>.html URLs",
      all(t["task"] == "part-page" and PART_URL_RX.match(t["url"]) for t in gd), str(gd[:2]))
check("D3", "gpl discover: keys are canonical SKU tokens", all(KEY_RX.match(t["key"]) for t in gd), str([t["key"] for t in gd]))
check("D4", "gpl discover: first row is C9200L-24P-4G-A -> /cisco/c9200l-24p-4g-a.html",
      bool(gd) and gd[0]["key"] == "C9200L-24P-4G-A" and gd[0]["url"] == URL_PART, repr(gd[:1]))
check("D5", "gpl discover: every task resolves to its URL and to the same URL without it",
      all(M.resolve(t) == t["url"] and M.resolve({"task": t["task"], "key": t["key"]}) == t["url"] for t in gd),
      str([t for t in gd if M.resolve({"task": t["task"], "key": t["key"]}) != t["url"]][:2]))
check("D6", "gpl discover: the single-page list yields no next-page task ('»' points at page 1)",
      not any(t["task"] == "listing" for t in gd))
check("D7", "gpl discover: no language-switch, shop or discount links",
      not any(re.search(r"/es/|/fr/|router-switch|get-discount", t["url"]) for t in gd))

hp_html = load(URL_HP)
hd = M.discover(hp_html, {"task": "listing", "key": URL_HP, "url": URL_HP})
hp_parts = [t for t in hd if t["task"] == "part-page"]
check("D8", f"listing discover: at least 7 part-page tasks (got {len(hp_parts)})", len(hp_parts) >= 7)
check("D8b", "listing discover: the year page /hp-price-list/2022.html is not a task ('2022' is not a part number)",
      not any(t["key"] == "2022" or t["url"].endswith("/2022.html") for t in hd), str([t["key"] for t in hd]))
check("D9", "listing discover: only part-page/listing kinds", all(t["task"] in ("part-page", "listing") for t in hd))
check("D10", "listing discover: absolute /hp-price-list/<sku>.html URLs, canonical keys",
      all(PART_URL_RX.match(t["url"]) and KEY_RX.match(t["key"]) for t in hp_parts), str(hp_parts[:2]))
check("D11", "listing discover: 455883-B21 -> /hp-price-list/455883-b21.html",
      any(t["key"] == "455883-B21" and t["url"] == "https://itprice.com/hp-price-list/455883-b21.html" for t in hp_parts))
check("D12", "listing discover: category pages (hp-server-1 ...) and tools are not tasks",
      not any(re.search(r"hp-server-1|hp-switch-1|-tool/|sn-check|top-searches", t["url"]) for t in hd), str(hd))
check("D13", "listing discover: no pagination on the fixture -> no listing task", not any(t["task"] == "listing" for t in hd))
check("D14", "listing discover: every task resolves to its URL", all(M.resolve(t) == t["url"] for t in hd))
check("D15", "listing discover: unique URLs", len({t["url"] for t in hd}) == len(hd))

pd = M.discover(part_html, part_task)
check("D16", "sabotage: a part page's ~125 CON-... anchors are relations, not part-page tasks", pd == [], str(pd[:3]))
check("D17", "index page: no product rows -> discover []", M.discover(load(URL_INDEX), {"task": "listing", "key": URL_INDEX, "url": URL_INDEX}) == [])
ri = M.extract(load(URL_INDEX), {"task": "listing", "key": URL_INDEX})
check("D18", "index page: extract yields no facts and does not claim not_listed", ri["facts"] == [] and ri["not_listed"] is False)

PAG_HTML = ('<html><body><section class="hot-search"><ul><li><a href="https://itprice.com/hp-price-list/p00930-b21.html">P00930-B21</a></li></ul></section>'
            '<ul class="pagination"><li><a href="https://itprice.com/hp-price-list?p=1">«</a></li><li class="active"><a href="javascript:void(0);">2</a></li>'
            '<li><a href="https://itprice.com/hp-price-list?p=3">»</a></li></ul></body></html>')
pt = M.discover(PAG_HTML, {"task": "listing", "key": URL_HP, "url": URL_HP})
check("D19", "pagination: a '»' to a higher page number becomes one listing task with that URL",
      [t for t in pt if t["task"] == "listing"] == [{"task": "listing", "key": "https://itprice.com/hp-price-list?p=3", "url": "https://itprice.com/hp-price-list?p=3"}], str(pt))
LAST_HTML = PAG_HTML.replace("?p=3", "?p=2")
check("D20", "pagination: on the last page ('»' -> the active page) no listing task",
      not any(t["task"] == "listing" for t in M.discover(LAST_HTML, {"task": "listing", "key": URL_HP, "url": URL_HP})))

# ---- sabotage: blocked / not found / empty table / lifecycle / price ---------------------------------------------
check("B1", "'Just a moment...' page is_blocked",
      M.is_blocked("<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing itprice.com</body></html>") is True)
check("B2", "none of the four fixtures is blocked", not any(M.is_blocked(load(u)) for u in (URL_GPL, URL_PART, URL_INDEX, URL_HP)))
NF_HTML = "<html><head><title>404 Not Found - IT Price</title></head><body><h1>Page Not Found</h1></body></html>"
check("B3", "synthetic page with the site's 404 title is_not_found", M.is_not_found(NF_HTML) is True)
check("B4", "none of the four fixtures is not-found", not any(M.is_not_found(load(u)) for u in (URL_GPL, URL_PART, URL_INDEX, URL_HP)))
check("B5", "'not found' in body prose only does not trigger",
      M.is_not_found("<html><head><title>C9200L Price</title></head><body><p>discount not found for this item</p></body></html>") is False)

EMPTY_HTML = ('<html><body><h1>Cisco C9200L-24P-4G-A</h1><table class="table-striped-product"><tbody>'
              '<tr><td>Product</td><td></td></tr><tr><td></td><td></td></tr></tbody></table></body></html>')
re_ = M.extract(EMPTY_HTML, part_task)
check("B6", "empty spec table -> zero facts", re_["facts"] == [], repr(re_["facts"]))
check("B7", "empty spec table -> not_listed False (the h1 names the SKU)", re_["not_listed"] is False)
check("B8", "empty spec table -> price None, relations [], lifecycle None", re_["price"] is None and re_["relations"] == [] and re_["lifecycle"] is None)

EOS_HTML = ('<html><body><h1>Cisco C9200L-24P-4G-A</h1><table class="table-striped-product"><tbody>'
            '<tr><td>Product</td><td>C9200L-24P-4G-A</td></tr><tr><td>End Of Sale Date</td><td>2024-10-31</td></tr>'
            '<tr><td>Global Price in USD</td><td>$1,234.50<button>Price Alert</button></td></tr></tbody></table></body></html>')
rl = M.extract(EOS_HTML, part_task)
rl_labels = {f["label"]: f["value"] for f in rl["facts"]}
check("B9", "a real End Of Sale Date lands in lifecycle", rl["lifecycle"] == {"end_of_sale_date": "2024-10-31"}, repr(rl["lifecycle"]))
check("B10", "End Of Sale Date also stays a raw fact with the page's text", rl_labels.get("End Of Sale Date") == "2024-10-31", repr(rl_labels))
check("B11", "price: a thousands separator is dropped, the button text is not part of the amount",
      (rl["price"] or {}).get("list_usd") == "1234.50", repr(rl["price"]))
for bad in ("N/A", "TBD", "Not announced", "2024"):
    rb = M.extract(EOS_HTML.replace("2024-10-31", bad), part_task)
    check("B12", f"sabotage: End Of Sale Date {bad!r} is not a date -> lifecycle None", rb["lifecycle"] is None, repr(rb["lifecycle"]))

for good in ("31 Oct 2024", "31-Oct-2024", "10/31/2024", "October 31, 2024", "01-MAY-2022"):
    rg = M.extract(EOS_HTML.replace("2024-10-31", good), part_task)
    check("B12b", f"a real End Of Sale Date in the shape {good!r} lands in lifecycle", rg["lifecycle"] == {"end_of_sale_date": good}, repr(rg["lifecycle"]))
for bad in ("Oct 2024", "2024-10", "31/10/24", "Q4 2024", "End of 2024"):
    rb = M.extract(EOS_HTML.replace("2024-10-31", bad), part_task)
    check("B12c", f"sabotage: End Of Sale Date {bad!r} is not a date -> lifecycle None", rb["lifecycle"] is None, repr(rb["lifecycle"]))

GPL_JUNK = ('<html><body><h1>CISCO GPL 2026</h1><table id="choice_product"><thead><tr><th>#No</th><th>Product</th><th>Description</th>'
            '<th>List Price (USD)</th></tr></thead><tbody>'
            '<tr><td>1</td><td><a href="https://itprice.com/cisco/c9200l-24p-4g-a.html">C9200L-24P-4G-A</a></td><td>the switch</td><td>$4,136.16</td></tr>'
            '<tr><td>2</td><td><a href="https://itprice.com/cisco/0.75k.html">0.75K</a></td><td>a table size that leaked into the list</td><td>$1</td></tr>'
            '<tr><td>3</td><td><a href="https://itprice.com/cisco/1.ddr4-3200.html">1.DDR4-3200</a></td><td>a footnoted token</td><td>$1</td></tr>'
            '<tr><td>4</td><td><a href="https://itprice.com/cisco/01-may-2022.html">01-MAY-2022</a></td><td>a date</td><td>$1</td></tr>'
            '<tr><td>5</td><td><a href="https://itprice.com/cisco/15216-att-lc-12=.html">15216-ATT-LC-12=</a></td><td>a digit-first PID</td><td>$1</td></tr>'
            '</tbody></table></body></html>')
gj = M.discover(GPL_JUNK, {"task": "gpl", "key": "C9200L-24P-4G"})
check("D21", "gpl discover: every row SKU that is a part number becomes a part-page task, including a digit-first Cisco PID",
      [t["key"] for t in gj] == ["C9200L-24P-4G-A", "15216-ATT-LC-12="], str(gj))
check("D22", "sabotage: a quantity, a footnoted token and a date in the Product column are never tasks",
      not any(t["key"] in ("0.75K", "1.DDR4-3200", "01-MAY-2022") for t in gj), str(gj))

GPL_EMPTY = ('<html><body><h1>CISCO GPL 2026</h1><table id="choice_product"><thead><tr><th>#No</th><th>Product</th><th>Description</th>'
             '<th>List Price (USD)</th><th>Our Price</th></tr></thead><tbody></tbody></table></body></html>')
ge = M.extract(GPL_EMPTY, {"task": "gpl", "key": "C9200L-24P-4G"})
check("B13", "gpl with no rows -> zero facts, no others, not_listed True (the list has nothing for the key)",
      ge["facts"] == [] and ge["others"] == [] and ge["not_listed"] is True, repr(ge))
GPL_SHIFTED = GPL_EMPTY.replace("<th>Product</th><th>Description</th>", "<th>Model</th><th>Notes</th>").replace(
    "<tbody></tbody>", "<tbody><tr><td>1</td><td><a href=\"https://itprice.com/cisco/c9200l-24p-4g-a.html\">C9200L-24P-4G-A</a></td><td>desc</td><td>$1</td><td></td></tr></tbody>")
gs = M.extract(GPL_SHIFTED, {"task": "gpl", "key": "C9200L-24P-4G-A"})
check("B14", "sabotage: a GPL-looking table without Product/Description headers is not read",
      gs["facts"] == [] and gs["others"] == [] and gs["sku"] is None, repr(gs))

# ---- report ------------------------------------------------------------------------------------------------------------
labels = sorted({f["label"] for f in facts} | {f["label"] for f in g["facts"]})
print(f"\nmain fixture (part page): {len(facts)} facts, {len(rels)} relations; gpl fixture: {len(g['facts'])} fact + {len(g['others'])} others; "
      f"discover: gpl {len(gd)}, hp {len(hd)}")
print("labels: " + " || ".join(labels[:25]))
print(f"\n{npass} passed, {nfail} failed")
sys.exit(1 if nfail else 0)
