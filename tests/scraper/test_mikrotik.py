"""tests/scraper/test_mikrotik.py — proof for scraper/sources/mikrotik.py.

Runs against the CACHED fixtures only (scraper/cache/<sha1(url)>.html, keyed by the requested
URL through netzscrape._key). Never fetches. Prints one PASS/MISS line per case and exits
non-zero on any miss.

    python3.11 tests/scraper/test_mikrotik.py
    python3.11 scripts/run_py_tests.py mikrotik

Fixtures: the switches group listing (fetched with a settle so the client-rendered cards are
present), the CRS326-24G-2S+RM product page, and the real 404 the site served for a guessed
slug (crs326_24g_2s_rm) — the reason discovery never builds a slug from a code.

Sabotage cases: a "Just a moment..." page is blocked; the cached 404 and a synthetic page with
the site's marker are not-found; a key on no part of the page is not_listed; an empty spec
list yields nothing WITHOUT claiming not_listed; a results table whose header does not add up
yields nothing rather than mis-labelled numbers; a section holding both a footnote list and a
table must still give up the table (the miss that shipped in the first draft: the list was
read and the table skipped).
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import mikrotik as M  # noqa: E402

LISTING_URL = "https://mikrotik.com/products/group/switches"
LISTING_KEY = "/products/group/switches"
PRODUCT_URL = "https://mikrotik.com/product/CRS326-24G-2SplusRM"
PRODUCT_KEY = "CRS326-24G-2S+RM"
NOTFOUND_URL = "https://mikrotik.com/product/crs326_24g_2s_rm"
BROCHURE = "https://cdn.mikrotik.com/web-assets/product_files/CRS326-24G-2SRM_211044.pdf"

CHROME_LEAF = re.compile(r"^(?:suggested price|price|availability|in stock|stock status|shipping|(?:limited )?warranty|ratings?|reviews?|cart|related|similar|cookies?|wish list|compare|navigation|menu|note|find retailer)$", re.I)
CHROME_SECTION = re.compile(r"^(?:reviews?|ratings?|shipping|warranty|cart|related|similar|see also|cookies?|note|download images)$", re.I)


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
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:72]:72}" + (f" | {detail[:160]}" if detail and not ok else ""))


def fixture(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}"); sys.exit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


# ---- resolve(): the documented URL for every task kind --------------------------------------
check("R1", "listing with the bare group slug", M.resolve({"task": "listing", "key": "switches"}) == LISTING_URL)
check("R2", "listing with the site path", M.resolve({"task": "listing", "key": LISTING_KEY}) == LISTING_URL)
check("R3", "listing with the absolute URL returns it", M.resolve({"task": "listing", "key": LISTING_URL}) == LISTING_URL)
check("R4", "listing with a non-group path -> None", M.resolve({"task": "listing", "key": "/products/compare"}) is None)
check("R5", "part-page with the url the listing gave returns it", M.resolve({"task": "part-page", "key": PRODUCT_KEY, "url": PRODUCT_URL}) == PRODUCT_URL)
check("R6", "part-page with a /product/<slug> key is absolutised",
      M.resolve({"task": "part-page", "key": "/product/CRS326-24G-2SplusRM"}) == PRODUCT_URL)
check("R7", "part-page with a bare product code -> None (slug is not derivable)",
      M.resolve({"task": "part-page", "key": PRODUCT_KEY}) is None)
check("R8", "datasheet with the CDN PDF URL returns it", M.resolve({"task": "datasheet", "key": BROCHURE}) == BROCHURE)
check("R9", "datasheet on a foreign host -> None", M.resolve({"task": "datasheet", "key": "https://example.com/x.pdf"}) is None)
check("R10", "search -> None", M.resolve({"task": "search", "key": PRODUCT_KEY}) is None)
check("R11", "empty key -> None", M.resolve({"task": "listing", "key": ""}) is None)
check("R12", "WAIT_FOR names the product anchor selector", "/product/" in getattr(M, "WAIT_FOR", ""))

# ---- extract() on the product fixture --------------------------------------------------------
html = fixture(PRODUCT_URL)
task = {"task": "part-page", "key": PRODUCT_KEY, "url": PRODUCT_URL}
r = M.extract(html, task)
facts = r["facts"]
by_label = {}
for f in facts:
    by_label.setdefault(f["label"], f["value"])

check("E1", "sku is the Product code the page states, '+' kept", r["sku"] == "CRS326-24G-2S+RM", r["sku"])
check("E2", "not_listed False for the page's own code", r["not_listed"] is False)
check("E3", f"at least 60 facts (got {len(facts)})", len(facts) >= 60)

EXACT = [
    ("Specifications > Product code", "CRS326-24G-2S+RM"),
    ("Specifications > CPU", "98DX3236"),
    ("Specifications > CPU core count", "2"),
    ("Specifications > Switch chip model", "98DX3236"),
    ("Specifications > Size of RAM", "512 MB"),
    ("Specifications > Dimensions", "443 x 144 x 44 mm"),
    ("Powering > Number of DC inputs", "2 (DC jack, PoE-IN)"),
    ("Ethernet > 10/100/1000 Ethernet ports", "24"),
    ("Fiber > SFP+ ports", "2"),
    ("Peripherals > Serial console port", "RJ45"),
    ("Included parts", "24V 1.2A power adapter, Rack ears, Screw set"),
    ("Switching results > Switching > Non blocking Layer 1 capacity > 64 byte Mbps", "88,000.0"),
    ("Ethernet test results > 98DX3236 all port test > Bridging > none (fast path) > 1518 byte kpps", "104,3"),
    ("Ethernet test results > 98DX3236 all port test > Routing > 25 ip filter rules > 64 byte Mbps", "33.7"),
]
for i, (label, value) in enumerate(EXACT, 1):
    check(f"X{i}", f"{label} = {value}", by_label.get(label) == value, f"got {by_label.get(label)!r}")

n_eth = sum(1 for f in facts if f["label"].startswith("Ethernet test results >"))
check("E4", f"the table that shares its section with a footnote list is read (30 cells, got {n_eth})", n_eth == 30)
n_sw = sum(1 for f in facts if f["label"].startswith("Switching results >"))
check("E5", f"Switching results table: 4 rows x 6 cells (got {n_sw})", n_sw == 24)
check("E6", "every fact has a non-empty label, value and locator",
      all(f.get("label") and f.get("value") and f.get("locator") for f in facts))
check("E7", "no value longer than 500 characters", all(len(f["value"]) <= 500 for f in facts),
      str([f["label"] for f in facts if len(f["value"]) > 500])[:120])
check("E8", "no fact label is site chrome (price, note, reviews, shipping, ...)",
      not any(is_chrome(f["label"]) for f in facts), str([f["label"] for f in facts if is_chrome(f["label"])])[:140])
check("E9", "the suggested price is in the price field, not a fact",
      (r["price"] or {}).get("raw") == "$209.00" and not any("209" in f["value"] for f in facts), str(r["price"]))
check("E10", "labels carry their section: no bare 'CPU' or 'Product code'",
      not any(f["label"] in ("CPU", "Product code", "Dimensions") for f in facts))
check("E11", "locators are unique", len({f["locator"] for f in facts}) == len(facts))
check("E12", "name is the one-line product title beside the h1",
      r["name"] == "24 Gigabit port switch with 2 x SFP+ cages in 1U rackmount case, Dual boot (RouterOS or SwitchOS)", str(r["name"]))
check("E13", "no fact from the licensing 'Note' prose", not any("free software updates" in f["value"] for f in facts))
check("E14", "others is empty: the page is about one product", r["others"] == [])

# ---- images ---------------------------------------------------------------------------------
imgs = r["images"]
check("I1", f"three product photos, no related-product or part images (got {len(imgs)})", len(imgs) == 3, str([i["url"] for i in imgs])[:150])
check("I2", "all image URLs absolute on cdn.mikrotik.com",
      all(i["url"].startswith("https://cdn.mikrotik.com/") for i in imgs))
check("I3", "the first is primary and is the large size of the og:image photo",
      bool(imgs) and imgs[0]["role"] == "primary" and imgs[0]["url"].endswith("/rb_images/1301_lg.webp"), str(imgs[:1]))
check("I4", "the rest are gallery, all large size, all distinct",
      all(i["role"] == "gallery" for i in imgs[1:]) and all("_lg." in i["url"] for i in imgs) and len({i["url"] for i in imgs}) == len(imgs))
check("I5", "no thumbnail, brochure page image, part photo or related-product image",
      not any(re.search(r"_ts\.|_tm\.|product_files|/part\d", i["url"]) for i in imgs))

# ---- not_listed: the three spellings of one code, and two that are not it -------------------
for cid, key, want in (("N1", "CRS326-24G-2S+RM", False), ("N2", "CRS326-24G-2SplusRM", False), ("N3", "crs326_24g_2s_rm", False),
                       ("N4", "ZZZ-NOT-ON-THIS-PAGE", True), ("N5", "CRS326-24G-2S+IN", True)):
    got = M.extract(html, {"task": "part-page", "key": key, "url": PRODUCT_URL})["not_listed"]
    check(cid, f"key {key!r} -> not_listed {want}", got is want, f"got {got}")

# ---- discover() on the product page: the brochure PDF only ---------------------------------
dp = M.discover(html, task)
check("D1", "product page discovers exactly one datasheet task", len(dp) == 1 and dp[0]["task"] == "datasheet", str(dp)[:160])
check("D2", "it is the brochure PDF on the CDN, with the URL as key", bool(dp) and dp[0]["url"] == BROCHURE and dp[0]["key"] == BROCHURE)
check("D3", "the Dimensions drawing and the DOC are not datasheets", not any(re.search(r"dimensions|_DOC_", t["url"]) for t in dp))
check("D4", "the datasheet task inherits the part", bool(dp) and dp[0].get("inherit_part") is True)
check("D5", "resolve() accepts the datasheet task it discovered", bool(dp) and M.resolve(dp[0]) == BROCHURE)

# ---- discover() on the listing ----------------------------------------------------------------
lhtml = fixture(LISTING_URL)
ltask = {"task": "listing", "key": LISTING_KEY, "url": LISTING_URL}
d = M.discover(lhtml, ltask)
parts = [t for t in d if t["task"] == "part-page"]
lists = [t for t in d if t["task"] == "listing"]
check("L1", f"at least 20 part-page tasks from the switches group (got {len(parts)})", len(parts) >= 20)
check("L2", f"at least 10 other group listings from the navigation (got {len(lists)})", len(lists) >= 10)
check("L3", "only task kinds resolve() handles", all(t["task"] in ("part-page", "listing") for t in d))
check("L4", "every task has an absolute https://mikrotik.com URL",
      all(t.get("url", "").startswith("https://mikrotik.com/") for t in d))
check("L5", "part-page URLs are /product/<slug>, listing URLs are /products/group/<slug>",
      all(re.match(r"^https://mikrotik\.com/product/[A-Za-z0-9_.+-]+$", t["url"]) for t in parts)
      and all(re.match(r"^https://mikrotik\.com/products/group/[a-z0-9-]+$", t["url"]) for t in lists))
check("L6", "URLs are unique", len({t["url"] for t in d}) == len(d))
check("L7", "the listing does not re-discover itself", not any(t["url"] == LISTING_URL for t in lists))
check("L8", "resolve() returns each discovered task's own URL", all(M.resolve(t) == t["url"] for t in d))
check("L9", "listing keys are site paths resolve() can rebuild without the url",
      all(M.resolve({"task": "listing", "key": t["key"]}) == t["url"] for t in lists))
want = {
    "https://mikrotik.com/product/CRS326-24G-2SplusRM": "CRS326-24G-2S+RM",   # code with '+', slug with 'plus'
    "https://mikrotik.com/product/crs304_4xg_in": "CRS304-4XG-IN",           # lower-case underscore slug
    "https://mikrotik.com/product/netpower_16p": "netPower 16P",             # marketing name as the code
    "https://mikrotik.com/product/crs318_1fi_15fr_2s_out": "netPower 15FR",  # slug unrelated to the code
    "https://mikrotik.com/product/crs354_48g_4splus2qplusrm": "CRS354-48G-4S+2Q+RM",
}
got = {t["url"]: t["key"] for t in parts}
for i, (url, code) in enumerate(want.items(), 1):
    check(f"K{i}", f"{url.rsplit('/', 1)[1]} -> key {code!r}", got.get(url) == code, f"got {got.get(url)!r}")
check("K6", "no part-page key is a slug when the card shows a code", not any("_" in t["key"] or t["key"].endswith("plusRM") for t in parts))
check("K7", "no product code carries an HTML-escaped '+'", not any("&#43;" in t["key"] or "%2B" in t["key"] for t in parts))
check("K8", "the listing page itself is not about a single part: extract gives no facts and does not claim not_listed",
      M.extract(lhtml, ltask)["facts"] == [] and M.extract(lhtml, {"task": "listing", "key": LISTING_KEY})["not_listed"] is False)

# ---- sabotage ---------------------------------------------------------------------------------
check("S1", "'Just a moment...' page is blocked", M.is_blocked("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>") is True)
check("S2", "the product fixture is not blocked", M.is_blocked(html) is False)
check("S3", "the listing fixture is not blocked", M.is_blocked(lhtml) is False)
nf = fixture(NOTFOUND_URL)
check("S4", "the cached 404 (a guessed slug) is not-found", M.is_not_found(nf) is True)
check("S5", "a synthetic page carrying the site marker is not-found",
      M.is_not_found("<html><head><title>Not Found</title></head><body><h1>404</h1><p>This is not\nthe place\nyou are\nlooking for.</p></body></html>") is True)
check("S6", "the product fixture is not not-found", M.is_not_found(html) is False)
check("S7", "the listing fixture is not not-found", M.is_not_found(lhtml) is False)
check("S8", "the not-found page is not mistaken for a block", M.is_blocked(nf) is False)

EMPTY = """<html><head><meta property="og:description" content="Empty test"></head><body><h1>CRS999-TEST</h1>
<div id="product_specification"><h3>Specification</h3><div><div>
<div class="uppercase">Specifications</div><ul></ul></div></div></div></body></html>"""
e = M.extract(EMPTY, {"task": "part-page", "key": "CRS999-TEST", "url": "https://mikrotik.com/product/crs999_test"})
check("S9", "an empty spec list yields zero facts", e["facts"] == [], str(e["facts"])[:100])
check("S10", "... and does not claim not_listed (the h1 names the key)", e["not_listed"] is False)
check("S11", "... sku falls back to the h1", e["sku"] == "CRS999-TEST", e["sku"])
check("S12", "a page with no spec block and no h1 naming the key is not_listed",
      M.extract("<html><body><h1>Other</h1></body></html>", {"task": "part-page", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)

BAD_TABLE = """<html><body><h1>CRS999-TEST</h1><div id="product_specification"><div><div>
<div><span class="uppercase">Switching results</span></div>
<table><thead><tr><th colspan="2">CRS999-TEST</th><th colspan="6"></th></tr>
<tr><th rowspan="2">Mode</th><th rowspan="2">Configuration</th><th colspan="2">1518 byte</th><th colspan="2">512 byte</th></tr>
<tr><th>kpps</th><th>Mbps</th><th>kpps</th><th>Mbps</th><th>kpps</th><th>Mbps</th></tr></thead>
<tbody><tr><td>Switching</td><td>L2</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr></tbody></table>
</div></div></div></body></html>"""
b = M.extract(BAD_TABLE, {"task": "part-page", "key": "CRS999-TEST"})
check("S13", "a results table whose header does not add up yields nothing, not mis-labelled numbers", b["facts"] == [], str(b["facts"])[:120])

BOTH = """<html><body><h1>CRS999-TEST</h1><div id="product_specification"><div><div>
<div><span class="uppercase">Ethernet test results</span></div>
<table><thead><tr><td colspan="2">CRS999-TEST</td><td colspan="4">chip all port test</td></tr>
<tr><td rowspan="2">Mode</td><td rowspan="2">Configuration</td><td colspan="2">1518 byte</td><td colspan="2">64 byte</td></tr>
<tr><td>kpps</td><td>Mbps</td><td>kpps</td><td>Mbps</td></tr></thead>
<tbody><tr><td>Bridging</td><td>none (fast path)</td><td>1,1</td><td>2.2</td><td>3,3</td><td>4.4</td></tr></tbody></table>
<ul><li><span>*</span><span>footnote</span></li></ul>
</div></div></div></body></html>"""
bt = M.extract(BOTH, {"task": "part-page", "key": "CRS999-TEST"})
labels = {f["label"]: f["value"] for f in bt["facts"]}
check("S14", "a section with a footnote list AND a table still yields the table's cells",
      labels.get("Ethernet test results > chip all port test > Bridging > none (fast path) > 64 byte Mbps") == "4.4", str(labels)[:160])
check("S15", "the comma-decimal cell is kept as the page writes it",
      labels.get("Ethernet test results > chip all port test > Bridging > none (fast path) > 1518 byte kpps") == "1,1")

print(f"\n{npass} passed, {nfail} missed")
sys.exit(1 if nfail else 0)
