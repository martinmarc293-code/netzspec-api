"""tests/scraper/test_arista.py — proof for scraper/sources/arista.py.

Runs against the CACHED fixture only (scraper/cache/<sha1(url)>.html, keyed by the requested URL
through netzscrape._key). Never fetches. Prints one PASS/MISS line per case and exits non-zero
on any miss.

    python3.11 tests/scraper/test_arista.py
    python3.11 scripts/run_py_tests.py arista

Sabotage cases: a "Just a moment..." page and a padded "Client Challenge" page must be blocked,
a page carrying the not-found marker must be not-found, a key that is on no table must be
not_listed, an empty spec table must yield nothing WITHOUT claiming not_listed, a header cell
that is not a model code must not become a model, and the glued "32Sand7050" header form must
still split into two models. The one that would have shipped wrong without a test: a <br>
inside a Ports cell — without a separator "48 x 25G SFP" and "8 x 100G QSFP" read as "SFP8".
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import arista as A  # noqa: E402

SERIES_URL = "https://www.arista.com/en/products/7050x3-series"
SERIES_KEY = "/en/products/7050x3-series"
DOCS_URL = "https://www.arista.com/en/support/product-documentation"

CHROME_LEAF = re.compile(r"^(?:price|availability|in stock|stock status|shipping|(?:limited )?warranty|ratings?|reviews?|cart|related|similar|cookies?|wish list|compare|navigation|menu)$", re.I)
CHROME_SECTION = re.compile(r"^(?:reviews?|ratings?|shipping|warranty|cart|related|similar|see also|cookies?)$", re.I)


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
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:72]:72}" + (f" | {detail[:140]}" if detail and not ok else ""))


def fixture(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}"); sys.exit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


# ---- resolve(): the documented URL for every task kind --------------------------------------
check("R1", "listing with a site-relative series path", A.resolve({"task": "listing", "key": SERIES_KEY}) == SERIES_URL)
check("R2", "listing with the absolute series URL returns it", A.resolve({"task": "listing", "key": SERIES_URL}) == SERIES_URL)
check("R3", "listing '/products/x' (no /en) is canonicalised to /en/products/x",
      A.resolve({"task": "listing", "key": "/products/7280r3-series"}) == "https://www.arista.com/en/products/7280r3-series")
check("R4", "listing with a trailing slash / query is cleaned",
      A.resolve({"task": "listing", "key": "/en/products/7050x3-series/?x=1"}) == SERIES_URL)
PDF = "https://www.arista.com/assets/data/pdf/Datasheets/7050X3-Datasheet.pdf"
check("R5", "datasheet with an absolute PDF URL returns it", A.resolve({"task": "datasheet", "key": PDF}) == PDF)
check("R6", "datasheet with a site-relative PDF path is absolutised",
      A.resolve({"task": "datasheet", "key": "/assets/data/pdf/Datasheets/7050X3-Datasheet.pdf"}) == PDF)
check("R7", "part-page is not a task this source handles -> None", A.resolve({"task": "part-page", "key": "7050CX3-32S"}) is None)
check("R8", "search -> None", A.resolve({"task": "search", "key": "7050CX3-32S"}) is None)
check("R9", "empty key -> None", A.resolve({"task": "listing", "key": ""}) is None)
check("R10", "listing with a non-product path -> None", A.resolve({"task": "listing", "key": "/en/support/x"}) is None)

# ---- extract() on the series fixture ---------------------------------------------------------
html = fixture(SERIES_URL)
task = {"task": "listing", "key": SERIES_KEY, "url": SERIES_URL}
r = A.extract(html, task)
fam = r["facts"]
others = r["others"]
by_sku = {o["sku"]: o for o in others}
all_facts = fam + [f for o in others for f in o["facts"]]

check("E1", "sku is the series name as the family table writes it", r["sku"] == "7050X3 Series", repr(r["sku"]))
check("E2", "scope is family on the top-level result", r.get("scope") == "family", repr(r.get("scope")))
check("E3", "name is the page h1", r["name"] == "Arista 7050X3 Series", repr(r["name"]))
check("E4", "not_listed is False for the page's own series key", r["not_listed"] is False)
check("E5", f"at least 15 family-level facts (got {len(fam)})", len(fam) >= 15)
check("E6", f"at least 250 facts in total across family + models (got {len(all_facts)})", len(all_facts) >= 250)
check("E7", f"11 models in others (got {len(others)})", len(others) == 11, str(sorted(by_sku)))
check("E8", "'7050CX3-32S and 7050CX3-32C' header split into both models",
      "7050CX3-32S" in by_sku and "7050CX3-32C" in by_sku)
check("E9", "both halves of a shared column carry the same facts",
      [(f["label"], f["value"]) for f in by_sku.get("7050CX3-32S", {}).get("facts", [])]
      == [(f["label"], f["value"]) for f in by_sku.get("7050CX3-32C", {}).get("facts", [])])
check("E10", "every model carries 25 facts", all(len(o["facts"]) == 25 for o in others), str([(o["sku"], len(o["facts"])) for o in others]))
check("E11", "price is None (vendor page publishes none)", r["price"] is None)
check("E12", "aliases empty", r["aliases"] == [])


def val(sku: str | None, label: str) -> str | None:
    facts = fam if sku is None else by_sku.get(sku, {}).get("facts", [])
    return next((f["value"] for f in facts if f["label"] == label), None)


EXACT = [
    (None, "7050X3 Series > Description", "Arista 7050X3 Series fixed configuration leaf and spine switches"),
    (None, "7050X3 Series > Switching Throughput", "6.4 Terabits/sec"),
    (None, "7050X3 Series > Maximum Forwarding Rate", "2 Bpps"),
    (None, "7050X3 Series > 100G Typical Power", "7W per port"),
    (None, "Resources > MAC Table Size", "288K"),
    (None, "Resources > Maximum LAG Groups", "128 (In breakout mode)"),
    (None, "Resources > Ingress / Egress ACLs", "2K / 2K"),
    ("7050CX3-32S", "Switch Height", "1RU"),
    ("7050CX3-32S", "Ports", "32 x 100G QSFP 2 x 10G SFP"),
    ("7050CX3-32S", "Typical Power Draw", "192W"),
    ("7050SX3-48YC8", "Ports", "48 x 25G SFP 8 x 100G QSFP"),
    ("7050SX3-48YC8C", "Ports", "48 x 25G SFP 8 x 100G QSFP"),
    ("7050SX3-96YC8", "Switch Height", "2RU"),
    # column alignment on table 2: 398W is column 1 (7050CX3M-32S), 218W is column 2. A first
    # draft of this suite asserted 398W for the 96YC8 from a misread inspect dump — the adapter
    # was right and the test was wrong, so both columns are pinned here.
    ("7050SX3-96YC8", "Typical Power Draw", "218W"),
    ("7050CX3M-32S", "Typical Power Draw", "398W"),
    ("7050SX3-48YC12", "Typical Power Draw", "179W"),
    ("7050TX3-48C8", "Ports", "48 x 10G RJ45 8 x 100G QSFP"),
    ("7050SX3-24YC4C", "Ports", "24 x SFP25 4 x QSFP100"),
    ("7050CX3M-32S", "Latency", "800ns"),
    ("7050CX3M-32S", "Airflow", "F/R or R/F"),
    ("7050CX3-32C", "Smart System Upgrade *", "Yes"),
]
for i, (sku, label, value) in enumerate(EXACT, 1):
    check(f"X{i}", f"exact: [{sku or 'family'}] {label} = {value}", val(sku, label) == value, repr(val(sku, label)))

check("S1", "every fact has non-empty label, value and locator",
      all(f.get("label") and f.get("value") and f.get("locator") for f in all_facts))
check("S2", "no value longer than 500 characters", all(len(f["value"]) <= 500 for f in all_facts),
      str(max((len(f["value"]) for f in all_facts), default=0)))
check("S3", "family locators are tN:rM, model locators tN:rM:cK",
      all(re.fullmatch(r"t\d+:r\d+", f["locator"]) for f in fam)
      and all(re.fullmatch(r"t\d+:r\d+:c\d+", f["locator"]) for o in others for f in o["facts"]))
check("S4", "locators unique within the family and within each model",
      len({f["locator"] for f in fam}) == len(fam) and all(len({f["locator"] for f in o["facts"]}) == len(o["facts"]) for o in others))
chrome_hits = sorted({f["label"] for f in all_facts if is_chrome(f["label"])})
check("S5", "no chrome label among the facts", not chrome_hits, str(chrome_hits))
check("S6", "no currency amount among fact values", not any(re.search(r"[$€£]\s*\d", f["value"]) for f in all_facts))
check("S7", "every family label carries its section prefix", all(" > " in f["label"] for f in fam),
      str([f["label"] for f in fam if " > " not in f["label"]][:3]))
check("S8", "a <br> inside a cell becomes a space, never 'SFP8'",
      not any(re.search(r"SFP\d+ x", f["value"]) for f in all_facts), str([f["value"] for f in all_facts if re.search(r"SFP\d+ x", f["value"])][:2]))
check("S9", "every others entry is a full RESULT (all keys present)",
      all(set(o) >= {"sku", "not_listed", "facts", "aliases", "images", "relations", "lifecycle", "name", "price", "others"} for o in others))

imgs = r["images"]
check("I1", "family primary image is the series banner",
      any(i["role"] == "primary" and i["url"] == "https://www.arista.com/assets/images/banner/product/7050X3-product.png" for i in imgs), repr(imgs))
check("I2", "exactly one primary family image", sum(1 for i in imgs if i["role"] == "primary") == 1)
check("I3", "no logo / menu image among family images", not any(("logo" in i["url"].lower()) or ("menu" in i["url"].lower()) for i in imgs))
check("I4", "each model has exactly one primary photo, absolute URL",
      all(sum(1 for i in o["images"] if i["role"] == "primary") == 1 and all(i["url"].startswith("https://www.arista.com/") for i in o["images"]) for o in others))
check("I5", "the 7050CX3-32S photo is the column header image",
      by_sku.get("7050CX3-32S", {}).get("images", [{}])[0].get("url") == "https://www.arista.com/assets/images/product/7050CX3-32S-175x150.png")

# ---- discover() ---------------------------------------------------------------------------------
d = A.discover(html, task)
listings = [t for t in d if t["task"] == "listing"]
sheets = [t for t in d if t["task"] == "datasheet"]
check("D1", f"at least 40 listing tasks (got {len(listings)})", len(listings) >= 40)
check("D2", f"at least 40 datasheet tasks (got {len(sheets)})", len(sheets) >= 40)
check("D3", "only task kinds resolve() handles, and resolve() rebuilds each url",
      all(t["task"] in ("listing", "datasheet") and A.resolve(t) == t["url"] for t in d))
check("D4", "all urls absolute on www.arista.com", all(t["url"].startswith("https://www.arista.com/") for t in d))
check("D5", "listing keys canonical (/en/products/<slug>, no query, no trailing slash)",
      all(re.fullmatch(r"/en/products/[^?#]+[^/?#]", t["key"]) for t in listings), str([t["key"] for t in listings if not re.fullmatch(r"/en/products/[^?#]+[^/?#]", t["key"])][:3]))
check("D6", "datasheet keys are the absolute PDF URLs", all(t["key"] == t["url"] and t["key"].lower().endswith(".pdf") for t in sheets))
check("D7", "keys deduplicated", len({(t["task"], t["key"]) for t in d}) == len(d))
check("D8", "the page's own series is not re-enqueued", SERIES_KEY not in {t["key"] for t in listings})
check("D9", "'/products/7280r3-series/7280r3-modular' (no /en) canonicalised",
      "/en/products/7280r3-series/7280r3-modular" in {t["key"] for t in listings})
check("D10", "the 7050X3 datasheet PDF is discovered", PDF in {t["key"] for t in sheets})
check("D11", "no external host (onetrust) among tasks", not any("onetrust" in t["url"] for t in d))
d2 = A.discover(fixture(DOCS_URL), {"task": "listing", "key": DOCS_URL})
check("D12", "product-documentation page yields datasheet tasks too", sum(1 for t in d2 if t["task"] == "datasheet") >= 10)

# ---- SABOTAGE -------------------------------------------------------------------------------------
check("B1", "main fixture is not blocked", not A.is_blocked(html))
check("B2", "main fixture is not not-found", not A.is_not_found(html))
JAM = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"
check("B3", "'Just a moment...' short page is blocked", A.is_blocked(JAM))
CC = "<html><head><title>Client Challenge</title></head><body><div>" + ("x" * 3000) + "</div></body></html>"
check("B4", f"'Client Challenge' page of {len(CC)} bytes is blocked", A.is_blocked(CC))
check("B5", "the challenge page is not mistaken for not-found", not A.is_not_found(CC))
NF = "<html><head><title>404 - Page not found - Arista</title></head><body><h1>Page not found</h1><p>The page you are looking for cannot be found.</p></body></html>"
check("B6", "synthetic not-found page (site marker in title) is not-found", A.is_not_found(NF))
check("B7", "not-found page is not blocked", not A.is_blocked(NF))
rz = A.extract(html, {"task": "listing", "key": "ZZZ-NOT-ON-THIS-PAGE"})
check("B8", "key ZZZ-NOT-ON-THIS-PAGE -> not_listed True", rz["not_listed"] is True)
check("B9", "...and the facts are still extracted for audit", len(rz["facts"]) == len(fam))
rm = A.extract(html, {"task": "listing", "key": "7050SX3-96YC8"})
check("B10", "a model key found only in others -> not_listed False", rm["not_listed"] is False)
EMPTY = ('<html><head><title>Arista 7050X3 Series</title></head><body><h1>Arista 7050X3 Series</h1>'
         '<table class="data-table"><tr><th colspan="2">7050X3 Series</th></tr></table></body></html>')
re_ = A.extract(EMPTY, task)
check("B11", "empty spec table -> zero facts", re_["facts"] == [] and re_["others"] == [], str(re_["facts"][:2]))
check("B12", "empty spec table -> not_listed False (the page IS about the series)", re_["not_listed"] is False)
check("B13", "empty spec table -> sku from the h1", re_["sku"] == "7050X3 Series", repr(re_["sku"]))
GLUED = ('<html><body><h1>Arista 7050X3 Series</h1><table class="data-table">'
         '<tr><th></th><th>7050CX3-32Sand7050CX3-32C</th><th>Not A Model</th></tr>'
         '<tr><th>Switch Height</th><td>1RU</td><td>9RU</td></tr></table></body></html>')
rg = A.extract(GLUED, task)
gsk = sorted(o["sku"] for o in rg["others"])
check("B14", "glued '32Sand7050' header still splits into two models", gsk == ["7050CX3-32C", "7050CX3-32S"], str(gsk))
check("B15", "a header cell that is not a model code yields no entry and its column is dropped",
      "Not A Model" not in gsk and not any(f["value"] == "9RU" for o in rg["others"] for f in o["facts"]))
NOTABLE = "<html><body><h1>Arista 7050X3 Series</h1><p>Only prose: Ports: 32 x 100G</p></body></html>"
rn = A.extract(NOTABLE, task)
check("B16", "prose 'Label: value' outside a table is never a fact", rn["facts"] == [] and rn["others"] == [])
check("B17", "discover on a page without links returns []", A.discover(NOTABLE, task) == [])

print(f"\n{npass} passed, {nfail} missed")
sys.exit(1 if nfail else 0)
