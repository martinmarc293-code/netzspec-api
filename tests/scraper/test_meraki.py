"""tests/scraper/test_meraki.py — proof for scraper/sources/meraki.py.

Reads only the cache (scraper/cache/<sha1(url)>.html); never fetches. One PASS/MISS line per
case, non-zero exit on any miss.

    python3.11 tests/scraper/test_meraki.py

Half the cases are refusals: a challenge page must be blocked, the site's "Page not found" must
be not-found, a foreign key must be not_listed, an empty spec table must yield nothing, a
Troubleshooting LED table must never be read as a spec, a bullet-list table must never become a
label, and a short comparison row must never shift a value into the next model's column.
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import load_source  # noqa: E402

M = load_source("meraki")

URL_INDEX = "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets"
URL_MAIN = URL_INDEX + "/MS130_Datasheet"
# the old-style URL the site answers with its "Page not found" article (ledger: status 404)
URL_404 = "https://documentation.meraki.com/MS/MS_Overview_and_Specifications/MS130_Overview_and_Specifications"

# labels that would mean chrome leaked into the facts. Whole words via explicit lookarounds:
# a bare "rating" would match "MTBF Rating", which is a real section on this page.
CHROME = re.compile(r"(?<![A-Za-z])(?:customer ratings?|reviews?|shipping|warranty|cart|related|cookies?|similar|"
                    r"prices?|delivery|in stock|add to|checkout|wishlist|navigation|sign in|recommended|consent|"
                    r"led status|meaning|function)(?![A-Za-z])", re.I)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:70]:72}" + ("" if ok else f" | got {got[:200]}"))


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


def by_sku(res: dict, sku: str) -> dict | None:
    if res["sku"] == sku:
        return res
    for o in res["others"]:
        if o["sku"] == sku:
            return o
    return None


def all_results(res: dict) -> list[dict]:
    return [res] + list(res["others"])


# =============================================================================================
# the chrome check itself must be alive
# =============================================================================================
check("T0.1", "chrome regex catches 'Customer Reviews' / 'Warranty' / 'LED Status'",
      all(CHROME.search(x) for x in ("Customer Reviews", "Warranty", "LED Status", "Recommended articles", "Consent Manager")))
check("T0.2", "chrome regex ignores 'MTBF Rating' / 'Operating Temperature' / 'Fan Operation'",
      not any(CHROME.search(x) for x in ("MTBF Rating > MTBF at 25°C (in hours)", "Models > Operating Temperature", "Models > Fan Operation")))

# =============================================================================================
# resolve()
# =============================================================================================
check("R1", "resolve datasheet: key is the page URL, returned as is",
      M.resolve({"task": "datasheet", "key": URL_MAIN}) == URL_MAIN, str(M.resolve({"task": "datasheet", "key": URL_MAIN})))
check("R2", "resolve listing: key is the index URL, returned as is",
      M.resolve({"task": "listing", "key": URL_INDEX}) == URL_INDEX, str(M.resolve({"task": "listing", "key": URL_INDEX})))
check("R3", "resolve completes a site-relative path",
      M.resolve({"task": "datasheet", "key": "/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS120_Datasheet"}) == URL_INDEX + "/MS120_Datasheet")
check("R4", "resolve returns a given url verbatim",
      M.resolve({"task": "datasheet", "key": "x", "url": URL_MAIN}) == URL_MAIN)
check("R5", "resolve refuses part-page / search (a SKU has no datasheet URL without its line)",
      M.resolve({"task": "part-page", "key": "MS130-8X"}) is None and M.resolve({"task": "search", "key": "MS130-8X"}) is None)
check("R6", "resolve refuses a bare SKU as a datasheet key rather than guessing a URL",
      M.resolve({"task": "datasheet", "key": "MS130-8X"}) is None)
check("R7", "resolve refuses a foreign host", M.resolve({"task": "datasheet", "key": "https://example.com/MS130_Datasheet"}) is None)
check("R8", "resolve refuses an empty key", M.resolve({"task": "listing", "key": ""}) is None)

# =============================================================================================
# main fixture: MS130 Datasheet
# =============================================================================================
main_html = load(URL_MAIN)
main = M.extract(main_html, {"task": "datasheet", "key": URL_MAIN})
F = main["facts"]
ALL = all_results(main)
TOTAL = sum(len(r["facts"]) for r in ALL)

check("M1", "top-level sku is the first model of the comparison table", main["sku"] == "MS130-8", main["sku"])
check("M2", "name is the h1", main["name"] == "MS130 Datasheet", str(main["name"]))
check("M3", "not_listed False for the page's own URL", main["not_listed"] is False, str(main["not_listed"]))
check("M4", f"at least 20 facts on the first model (got {len(F)})", len(F) >= 20, str(len(F)))
check("M5", f"at least 200 facts across all models (got {TOTAL})", TOTAL >= 200, str(TOTAL))

EXPECT_MODELS = ["MS130-8", "MS130-8P", "MS130-8P-I", "MS130-8X", "MS130-12X",
                 "MS130-24", "MS130-24P", "MS130-24X", "MS130-48", "MS130-48P", "MS130-48X"]
got_models = [r["sku"] for r in ALL if r.get("scope") != "family"]
check("M6", "every model of both comparison tables, in page order, none twice", got_models == EXPECT_MODELS, str(got_models))
fam = [r for r in ALL if r.get("scope") == "family"]
check("M7", "exactly one family-scoped entry, sku MS130, in others", len(fam) == 1 and fam[0]["sku"] == "MS130" and fam[0] is not main,
      str([r["sku"] for r in fam]))

# exact label/value pairs as the page shows them
EXACT = [
    ("MS130-8", "Models > 1Gbe RJ45", "8"),
    ("MS130-8", "Models > 1 Gbe SFP", "2"),
    ("MS130-8", "Models > Power Input", "12VDC, 2.5A"),
    ("MS130-8", "Models > Switching Capacity", "20 Gbps"),
    ("MS130-8", "Models > Dimensions (h x w x d)", "1.1 x 8.74 x 6in (2.8 x 22.2 x 15cm)"),
    ("MS130-8", "Models > Weight", "1.94 lb (0.88 kg)"),
    ("MS130-8", "MTBF Rating > MTBF at 25°C (in hours)", "1,927,507"),
    ("MS130-8X", "Models > mGbe RJ45 (100M/1G/2.5G)", "2 x 2.5G"),
    ("MS130-8X", "Models > 10GbE SFP+", "2"),
    ("MS130-8X", "Models > PoE Switch Budget", "120W"),
    ("MS130-48X", "Models > Switching Capacity", "200 Gbps"),
    ("MS130-48X", "Models > Dimensions", "1.73 x 17.32 x 13.4in (4.4 x 44 x 34cm)"),
    ("MS130-48P", "Models > Power Load (idle/max)", "49W/803W"),
    ("MS130-24", "Models > Dedicated Mgmt Interface", "1"),
    ("MS130-24", "MTBF Rating > MTBF at 25°C (in hours)", "789,842"),
    ("MS130", "Whats In the Box > MS130-8, 8P, 8X, 12X", "MS130 switch, AC Power Supply"),
    ("MS130", "Whats In the Box > MS130-8P-I, MS130-24, 24P. 24X, 48, 48P, 48X", "MS130 switch"),
]
for i, (sku, label, value) in enumerate(EXACT, 1):
    r = by_sku(main, sku)
    got = fact(r, label) if r else None
    check(f"E{i}", f"{sku}: {label} == {value[:28]}", got == value, str(got))

check("M8", "a sibling's value never lands on the first model (MS130-8 PoE Switch Budget is '-')",
      fact(main, "Models > PoE Switch Budget") == "-", str(fact(main, "Models > PoE Switch Budget")))
check("M9", "no fact on any model is a family-level fact (no 'Whats In the Box' on MS130-8)",
      not any(f["label"].startswith("Whats In the Box") for r in ALL if r.get("scope") != "family" for f in r["facts"]))

# every fact well-formed, no chrome, no fiction
bad = [f for r in ALL for f in r["facts"] if not (f.get("label") and f.get("value") and f.get("locator"))]
check("F1", "every fact has non-empty label, value and locator", not bad, str(bad[:2]))
long = [f["label"] for r in ALL for f in r["facts"] if len(f["value"]) > 500]
check("F2", "no value longer than 500 characters", not long, str(long[:2]))
chrome = sorted({f["label"] for r in ALL for f in r["facts"] if CHROME.search(f["label"])})
check("F3", "no chrome label (reviews, warranty, cart, related, cookies, LED table ...)", not chrome, str(chrome[:5]))
longlab = [f["label"] for r in ALL for f in r["facts"] if len(f["label"]) > 90]
check("F4", "the Features bullet-list table never became a label", not longlab, str(longlab[:1]))
check("F5", "labels carry the section without the family name (Models > ..., not MS130 Models > ...)",
      any(f["label"].startswith("Models > ") for f in F) and not any(f["label"].startswith("MS130 Models") for f in F))
check("F6", "a section never repeats a model name into the vocabulary (no label contains 'MS130-')",
      not any("MS130-" in f["label"] for r in ALL if r.get("scope") != "family" for f in r["facts"]))
check("F7", "price stays out of facts and is None on a vendor datasheet", main["price"] is None and not any("price" in f["label"].lower() for f in F))

# relations: accessories and modules attach to the models the page names, by exact token
ms8 = by_sku(main, "MS130-8")
ms8x = by_sku(main, "MS130-8X")
check("A1", "MS130-8 gets its 30 W adapter and not the 150 W adapter named for MS130-8X/8P",
      any(x["sku"] == "MA-PWR-30WAC" for x in ms8["relations"]) and not any(x["sku"] == "MA-PWR-150WAC-ADP" for x in ms8["relations"]),
      str([x["sku"] for x in ms8["relations"]]))
check("A2", "MS130-8X gets the 150 W adapter and the SFP+ modules", {"MA-PWR-150WAC-ADP", "MA-SFP-10GB-SR", "MA-CBL-TA-3M"} <= {x["sku"] for x in ms8x["relations"]},
      str([x["sku"] for x in ms8x["relations"]]))
check("A3", "MS130-8 (SFP only) never gets a 10G module", not any(x["sku"] == "MA-SFP-10GB-SR" for x in ms8["relations"]))
check("A4", "family entry carries every accessory relation with kind compatible",
      {"MA-PWR-150WAC-ADP", "MA-PWR-300WAC-ADP", "MA-PWR-30WAC", "MA-SFP-1GB-SX"} <= {x["sku"] for x in fam[0]["relations"] if x["kind"] == "compatible"})
check("A5", "licence part numbers are relations of kind license, not facts",
      any(x["kind"] == "license" and x["sku"] == "LIC-MS130-24-xY" for x in fam[0]["relations"]) and not any("LIC-" in f["value"] for r in ALL for f in r["facts"]))

# images
check("I1", "exactly the one product photo on @api/deki/files, absolute, role primary",
      len(main["images"]) == 1 and main["images"][0]["role"] == "primary" and main["images"][0]["url"].startswith("https://documentation.meraki.com/@api/deki/files/"),
      str(main["images"]))
check("I2", "no logo / cookie-banner image", not any(("logo" in i["url"].lower() or "cookielaw" in i["url"]) for i in main["images"]))
check("I3", "no -HW aliases invented on a page that prints none", not any(r["aliases"] for r in ALL))

# not_listed
check("N1", "key ZZZ-NOT-ON-THIS-PAGE -> not_listed True",
      M.extract(main_html, {"task": "datasheet", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)
check("N2", "key MS130-8X-HW (orderable part) -> not_listed False",
      M.extract(main_html, {"task": "datasheet", "key": "MS130-8X-HW"})["not_listed"] is False)
check("N3", "key MS130-8 -> listed (a model of the page)", M.extract(main_html, {"task": "datasheet", "key": "ms130-8"})["not_listed"] is False)
check("N4", "key = the MS130R datasheet URL -> not_listed True (containment would say listed)",
      M.extract(main_html, {"task": "datasheet", "key": URL_INDEX + "/MS130R_Datasheet"})["not_listed"] is True)
check("N5", "key MS130-8XX (not a model) -> not_listed True", M.extract(main_html, {"task": "datasheet", "key": "MS130-8XX"})["not_listed"] is True)

# =============================================================================================
# discover()
# =============================================================================================
index_html = load(URL_INDEX)
disc = M.discover(index_html, {"task": "listing", "key": URL_INDEX})
ds = [t for t in disc if t["task"] == "datasheet"]
ls = [t for t in disc if t["task"] == "listing"]
check("D1", f"listing fixture -> at least 15 datasheet tasks (got {len(ds)})", len(ds) >= 15, str(len(ds)))
check("D2", "every task carries an absolute https URL on the site host",
      all(t["url"].startswith("https://documentation.meraki.com/") and t["key"] == t["url"] for t in disc), str([t["url"] for t in disc if not t["url"].startswith("https://")][:2]))
check("D3", "keys are canonical: no fragment, no query, no trailing slash",
      all("#" not in t["key"] and "?" not in t["key"] and not t["key"].endswith("/") for t in disc))
check("D4", "every datasheet task lives under the index", all(t["key"].startswith(URL_INDEX + "/") for t in ds))
check("D5", "the MS130 datasheet is among them", any(t["key"] == URL_MAIN for t in ds))
check("D6", "only task kinds resolve() handles, and resolve() accepts each", all(M.resolve(t) == t["url"] for t in disc))
check("D7", "five listing tasks for the other lines (MR, MX, MG, MV, MT), each at priority 200",
      len(ls) == 5 and all(t.get("priority") == 200 for t in ls) and all(any(f"/{p}_-_" in t["key"] or f"/{p}/" in t["key"] for p in ("MR", "MX", "MG", "MV", "MT")) for t in ls),
      str([(t["key"], t.get("priority")) for t in ls]))
check("D8", "the other lines' index URLs end in the documented tail",
      all(t["key"].endswith("/Product_Information/Overviews_and_Datasheets") for t in ls))
check("D9", "no task points back at the listing itself, none twice",
      URL_INDEX not in {t["key"] for t in disc} and len({t["key"] for t in disc}) == len(disc))
check("D10", "no chrome link (Save as PDF, Sign in, breadcrumbs) became a task",
      not any("@api" in t["key"] or "@app" in t["key"] or t["key"].count("/") < 6 for t in disc), str([t["key"] for t in disc if "@" in t["key"]][:2]))
from_ds = M.discover(main_html, {"task": "datasheet", "key": URL_MAIN})
check("D11", "a datasheet page yields only sibling datasheet tasks under its own index, never itself",
      from_ds and all(t["task"] == "datasheet" and t["key"].startswith(URL_INDEX + "/") and t["key"] != URL_MAIN for t in from_ds),
      str([t["key"][-40:] for t in from_ds]))
check("D12", "discover with an empty key returns nothing", M.discover(index_html, {"task": "listing", "key": ""}) == [])

# =============================================================================================
# sabotage: refusals
# =============================================================================================
check("S1", "a short 'Just a moment...' page is blocked", M.is_blocked("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"))
check("S2", "the real datasheet is not blocked", not M.is_blocked(main_html))
nf_html = load(URL_404)
check("S3", "the site's 'Page not found' fixture is_not_found", M.is_not_found(nf_html))
check("S4", "the real datasheet and the index are not not-found", not M.is_not_found(main_html) and not M.is_not_found(index_html))
check("S5", "a page that merely mentions 'Page not found' in its body is not not-found",
      not M.is_not_found("<html><head><title>MS130 Datasheet - Cisco Meraki Documentation</title></head><body>Page not found - Cisco Meraki Documentation is what a bad link shows</body></html>"))

EMPTY = f"""<html><head><title>MS999 Datasheet - Cisco Meraki Documentation</title><link rel="canonical" href="{URL_INDEX}/MS999_Datasheet"></head>
<body><article id="elm-main-content"><h1>MS999 Datasheet</h1><div class="mt-section"><h4>MS999 Models</h4><table></table></div></article></body></html>"""
e = M.extract(EMPTY, {"task": "datasheet", "key": URL_INDEX + "/MS999_Datasheet"})
check("S6", "an empty spec table yields zero facts, not_listed False, family-scoped sku",
      e["facts"] == [] and e["others"] == [] and e["not_listed"] is False and e["sku"] == "MS999" and e.get("scope") == "family", str(e)[:200])

SHORT_ROW = f"""<html><head><title>MS999 Datasheet - Cisco Meraki Documentation</title></head><body><article id="elm-main-content"><h1>MS999 Datasheet</h1>
<div class="mt-section"><h4>MS999 Models</h4><table><tr><th></th><th>MS999-8</th><th>MS999-24</th></tr>
<tr><td>Weight</td><td>1 kg</td></tr><tr><td>Fan</td><td>Fanless</td><td>Internal</td></tr></table></div></article></body></html>"""
sr = M.extract(SHORT_ROW, {"task": "datasheet", "key": URL_INDEX + "/MS999_Datasheet"})
sr24 = by_sku(sr, "MS999-24")
check("S7", "a short comparison row never shifts a value into the next model's column",
      sr["sku"] == "MS999-8" and fact(sr, "Models > Weight") == "1 kg" and sr24 is not None and fact(sr24, "Models > Weight") is None and fact(sr24, "Models > Fan") == "Internal",
      str([(r["sku"], r["facts"]) for r in all_results(sr)]))

LED = f"""<html><head><title>MS999 Datasheet - Cisco Meraki Documentation</title></head><body><article id="elm-main-content"><h1>MS999 Datasheet</h1>
<div class="mt-section"><h2>Troubleshooting</h2><table><tr><th>Function</th><th>LED Status</th><th>Meaning</th></tr><tr><td>Power</td><td>Solid orange</td><td>No dashboard</td></tr></table>
<table><tr><td>Power LED</td><td>Solid orange</td></tr><tr><td>Port LED</td><td>Off</td></tr></table></div>
<div class="mt-section"><h2>Event Log</h2><table><tr><th>Model</th><th>Event</th></tr><tr><td>MS999-8</td><td>Port carrier change</td></tr></table></div>
<div class="mt-section"><h4>MS999 Models</h4><table><tr><th>Model</th><th>Function</th><th>Status</th></tr><tr><td>Weight</td><td>1 kg</td><td>2 kg</td></tr></table></div></article></body></html>"""
led = M.extract(LED, {"task": "datasheet", "key": URL_INDEX + "/MS999_Datasheet"})
# the two-column LED table is the live case: a three-column one is ignored for its shape alone,
# so a suite with only that would have stayed green with the section skip deleted (it did)
check("S8", "Troubleshooting/Event Log tables (2- and 3-col) and a non-model header yield no facts",
      not any(r["facts"] for r in all_results(led)) and led["sku"] == "MS999", str([(r["sku"], r["facts"]) for r in all_results(led)]))

HW = f"""<html><head><title>MS999 Datasheet - Cisco Meraki Documentation</title></head><body><article id="elm-main-content"><h1>MS999 Datasheet</h1>
<div class="mt-section"><h4>MS999 Models</h4><table><tr><th></th><th>MS999-8</th><th>MS999-24</th></tr><tr><td>Weight</td><td>1 kg</td><td>3 kg</td></tr></table></div>
<div class="mt-section"><h3>Ordering</h3><p>Order MS999-8-HW for the compact model. MS999-48-HW is not a model on this page.</p></div>
<img src="/@api/deki/files/1/a.png" alt="MS999"><img src="/@api/deki/files/2/b.png" alt="MS999 back"><img src="/logo.png"></article>
<div class="cookie"><img src="https://cdn.cookielaw.org/x.svg"><table><tr><td>Reviews</td><td>5 stars</td></tr></table></div></body></html>"""
hw = M.extract(HW, {"task": "datasheet", "key": "MS999-8-HW"})
check("S9", "-HW part numbers become variant_sku aliases on the model they extend, and only there",
      hw["aliases"] == [{"kind": "variant_sku", "value": "MS999-8-HW"}] and by_sku(hw, "MS999-24")["aliases"] == [] and hw["not_listed"] is False,
      str([(r["sku"], r["aliases"]) for r in all_results(hw)]))
check("S10", "images: deki files only, first primary then gallery, relative made absolute, logo skipped",
      [(i["url"], i["role"]) for i in hw["images"]] == [("https://documentation.meraki.com/@api/deki/files/1/a.png", "primary"), ("https://documentation.meraki.com/@api/deki/files/2/b.png", "gallery")],
      str(hw["images"]))
check("S11", "a table outside the article (cookie chrome) is never read",
      not any("Reviews" in f["label"] for r in all_results(hw) for f in r["facts"]))

print(f"\n{npass} passed, {nfail} missed")
sys.exit(1 if nfail else 0)
