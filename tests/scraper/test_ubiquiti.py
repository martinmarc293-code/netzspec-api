"""tests/scraper/test_ubiquiti.py — proof for scraper/sources/ubiquiti.py (techspecs.ui.com).

Reads only the cache (scraper/cache/<sha1(url)>.html); never fetches. One PASS/MISS line per
case, non-zero exit on any miss.

    python3.11 tests/scraper/test_ubiquiti.py

Half the cases are refusals: a challenge page must be blocked, a Next.js 404 must be not-found,
a foreign key must be not_listed, an empty spec list must yield nothing, a feature row with
neither value nor flag must never become an empty fact, a page without the JSON blob must yield
nothing rather than raise, and the same label under two groups must stay two facts.
"""
from __future__ import annotations
import io, json, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import load_source  # noqa: E402

U = load_source("ubiquiti")

BASE = "https://techspecs.ui.com"
URL_INDEX = BASE + "/"
URL_LISTING = BASE + "/unifi/switching"
URL_MAIN = BASE + "/unifi/switching/usw-pro-24-poe"

# labels that would mean chrome leaked into the facts (whole words via explicit lookarounds)
CHROME = re.compile(r"(?<![A-Za-z])(?:ratings?|reviews?|shipping|warranty|cart|related|cookies?|similar|"
                    r"prices?|delivery|in stock|add to|checkout|wishlist|navigation|sign in|recommended|consent|"
                    r"installation guide|datasheet|terms|privacy)(?![A-Za-z])", re.I)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:74]:76}" + ("" if ok else f" | got {got[:220]}"))


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


def leaf(label: str) -> str:
    return label.rsplit(" > ", 1)[-1]


def next_page(product: dict | None, page: str = "/[productLine]/[category]/[product]", title: str = "Tech Specs") -> str:
    """A synthetic Next.js page carrying the given product blob (None = no blob at all)."""
    data = {"props": {"pageProps": {"productLine": "Unifi", "category": "switching", "product": product}},
            "page": page, "query": {}, "buildId": "test"}
    script = "" if product is None and page == "NONE" else f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script>'
    return f"<html><head><title>{title}</title></head><body><h1>{title}</h1><p>Some body text.</p>{script}</body></html>"


def entry(label: str, value=None, flag=None, note=None, parent=None, fid=None, typename="SpecificationEntitySectionFeatureEntryText") -> dict:
    d = {"__typename": typename, "note": note, "feature": {"label": label, "parentId": parent, "id": fid or label.lower()}}
    if value is not None:
        d["value"] = value
    if flag is not None:
        d["flag"] = flag
    return d


def product_blob(sections: list, name: str = "USW-Test-8", slug: str = "usw-test-8") -> dict:
    return {"__typename": "StorefrontProduct", "slug": slug, "name": name, "title": "Switch Test 8",
            "variants": [{"sku": name}], "thumbnail": None, "gallery": {"items": []},
            "technicalSpecification": {"sections": sections}}


# =============================================================================================
# the chrome check itself must be alive
# =============================================================================================
check("T0.1", "chrome regex catches 'Customer Reviews' / 'Warranty' / 'Add to Cart' / 'Datasheet'",
      all(CHROME.search(x) for x in ("Customer Reviews", "Warranty", "Add to Cart", "Datasheet", "Cookie Consent")))
check("T0.2", "chrome regex leaves real labels alone",
      not any(CHROME.search(x) for x in ("Hardware > Weight", "Overview > Total PoE Availability", "Performance > Switching Capacity")))

# =============================================================================================
# the main fixture: USW-Pro-24-PoE
# =============================================================================================
main_html = load(URL_MAIN)
r = U.extract(main_html, {"task": "part-page", "key": "USW-Pro-24-PoE", "url": URL_MAIN})
labels = [f["label"] for f in r["facts"]]
leaves = {leaf(l) for l in labels}

check("F1", "sku is the JSON product name, exactly as the site writes it", r["sku"] == "USW-Pro-24-POE", r["sku"])
check("F2", "name is the site's product title", r["name"] == "Switch Pro 24 PoE", str(r["name"]))
check("F3", "not_listed False for the page's own SKU (case/PoE spelling differs from the key)", r["not_listed"] is False, str(r["not_listed"]))

# exact label/value pairs as they appear on the page (whitespace collapsed, nothing else)
PAIRS = {
    "Overview > Dimensions": '442 x 285 x 44 mm (17.4 x 11.2 x 1.7")',
    "Overview > Total PoE Availability": "400W",
    "Overview > Port Layout > 1 GbE RJ45": "24 (16 PoE+; 8 PoE++) (1G/100M/10M)",
    "Overview > Port Layout > 10G SFP+": "2 (10G/1G)",
    "Overview > Layer 3": "True",
    "Overview > Redundancy": "DC Power Backup (With UniFi RPS)",
    "Performance > Switching Capacity": "88 Gbps",
    "Performance > Forwarding Rate": "65 Mpps",
    "Performance > Access Lists > IPv4": "128",
    "Hardware > PoE Ports > PoE+": "16",
    "Hardware > Max. PoE Wattage per Port by PSE > PoE+": "30W",
    "Hardware > Weight": "Without mounting brackets: 4.3 kg (9.5 lb) With mounting brackets: 4.4 kg (9.7 lb)",
    "Hardware > Supported Voltage Range": "100–240V AC",
    "Software > Application Requirements > UniFi Network": "Version 5.10.5 and later",
}
for i, (lab, val) in enumerate(PAIRS.items(), 1):
    check(f"F4.{i}", f"{lab} == {val[:30]!r}", fact(r, lab) == val, repr(fact(r, lab)))

check("F5", f"at least 20 facts on the main fixture (got {len(r['facts'])})", len(r["facts"]) >= 20, str(len(r["facts"])))
REQUIRED = ("Total PoE Availability", "Switching Capacity", "Dimensions", "Weight")
check("F6", "required labels present exactly as written: " + ", ".join(REQUIRED),
      all(x in leaves for x in REQUIRED), str(sorted(leaves)[:30]))
check("F7", "every fact has non-empty label, value, locator; value <= 500 chars",
      all(f["label"] and f["value"] and f["locator"] and len(f["value"]) <= 500 for f in r["facts"]),
      str([f for f in r["facts"] if not (f["label"] and f["value"] and f["locator"] and len(f["value"]) <= 500)][:3]))
check("F8", "every locator is nextdata:<section>/<row>",
      all(re.fullmatch(r"nextdata:\d+/\d+", f["locator"]) for f in r["facts"]), str([f["locator"] for f in r["facts"]][:5]))
check("F9", "every label is 'Section > Label' (or 'Section > Group > Label')",
      all(2 <= len(l.split(" > ")) <= 3 and all(p.strip() for p in l.split(" > ")) for l in labels), str(labels[:5]))
check("F10", "no fact label is site chrome", not any(CHROME.search(l) for l in labels), str([l for l in labels if CHROME.search(l)]))
check("F11", "no label is emitted twice (PoE+ under PoE Ports and under Max. Wattage stay two facts)",
      len(labels) == len(set(labels)) and fact(r, "Hardware > PoE Ports > PoE+") != fact(r, "Hardware > Max. PoE Wattage per Port by PSE > PoE+"),
      str([l for l in labels if labels.count(l) > 1]))
check("F12", "a group heading row (Port Layout, PoE Ports) is never itself a fact",
      not any(leaf(l) in ("Port Layout", "PoE Ports", "Access Lists", "Application Requirements") for l in labels),
      str([l for l in labels if leaf(l) in ("Port Layout", "PoE Ports")]))
check("F13", "images: six photos, first primary, all absolute on cdn.ecomm.ui.com, the mp4 excluded",
      len(r["images"]) == 6 and r["images"][0]["role"] == "primary" and all(i["role"] == "gallery" for i in r["images"][1:])
      and all(i["url"].startswith("https://cdn.ecomm.ui.com/products/") for i in r["images"])
      and not any(i["url"].lower().endswith(".mp4") for i in r["images"]),
      str([(i["role"], i["url"][-40:]) for i in r["images"]]))
check("F14", "no price on the spec site; no others; no aliases invented", r["price"] is None and r["others"] == [] and r["aliases"] == [], str((r["price"], r["others"], r["aliases"])))
check("F15", "a slug-shaped key (usw-pro-24-poe) is still the page's own product",
      U.extract(main_html, {"task": "part-page", "key": "usw-pro-24-poe"})["not_listed"] is False)
check("F16", "a product page discovers nothing (compatible products are referenced by opaque id)",
      U.discover(main_html, {"task": "part-page", "key": "USW-Pro-24-PoE", "url": URL_MAIN}) == [])

# =============================================================================================
# discovery on the listing and the index
# =============================================================================================
listing_html = load(URL_LISTING)
d = U.discover(listing_html, {"task": "listing", "key": URL_LISTING, "url": URL_LISTING})
parts = [t for t in d if t["task"] == "part-page"]
lists = [t for t in d if t["task"] == "listing"]
check("D1", f"listing: at least 60 part-page tasks (got {len(parts)})", len(parts) >= 60, str(len(parts)))
check("D2", "every discovered task has an absolute URL on techspecs.ui.com",
      all(t.get("url", "").startswith(BASE + "/") for t in d), str([t for t in d if not t.get("url", "").startswith(BASE + "/")][:3]))
check("D3", "part-page URLs are canonical /unifi/<category>/<slug> with the ?subcategory query stripped",
      all(re.fullmatch(r"https://techspecs\.ui\.com/unifi/[a-z0-9-]+/[a-z0-9.-]+", t["url"]) for t in parts), str([t["url"] for t in parts][:3]))
check("D4", "part-page keys are the SKU the JSON shows for the link (USW-Pro-24-POE -> .../usw-pro-24-poe)",
      any(t["key"] == "USW-Pro-24-POE" and t["url"] == URL_MAIN for t in parts)
      and any(t["key"] == "USW-Flex-2.5G-8-PoE" and t["url"].endswith("/usw-flex-2-5g-8-poe") for t in parts),
      str([t for t in parts if "24-poe" in t["url"] or "2-5g-8-poe" in t["url"]]))
check("D5", "no product URL is discovered twice", len({t["url"] for t in parts}) == len(parts))
check("D6", "only task kinds resolve() handles are emitted (part-page, listing)", {t["task"] for t in d} <= {"part-page", "listing"}, str({t["task"] for t in d}))
cats = [t for t in lists if "?" not in t["url"]]
subs = [t for t in lists if "?subcategory=" in t["url"]]
check("D7", f"listing tasks for the 7 categories and the 7 switching sub-categories (got {len(cats)}/{len(subs)})",
      len(cats) >= 7 and len(subs) >= 7 and all(t["key"] == t["url"] for t in lists), str([t["url"] for t in lists]))
check("D8", "the 'All' sub-category view (same page as the category) is not a separate task",
      not any("subcategory=all-" in t["url"] for t in lists))
check("D9", "resolve() returns the discovered URL for every task", all(U.resolve(t) == t["url"] for t in d))
check("D10", "no listing task points at ui.com marketing, store or legal pages",
      all(re.fullmatch(r"https://techspecs\.ui\.com/unifi/[a-z0-9-]+(?:\?subcategory=[a-z0-9-]+)?", t["url"]) for t in lists), str([t["url"] for t in lists][-3:]))

index_html = load(URL_INDEX)
di = U.discover(index_html, {"task": "listing", "key": URL_INDEX, "url": URL_INDEX})
iparts = [t for t in di if t["task"] == "part-page"]
check("D11", f"index (cloud-gateways under /): at least 10 part-page tasks under /unifi/cloud-gateways/ (got {len(iparts)})",
      len(iparts) >= 10 and all("/unifi/cloud-gateways/" in t["url"] for t in iparts), str(iparts[:3]))
check("D12", "index: category listings for every product line are discovered",
      {t["url"] for t in di if t["task"] == "listing"} >= {BASE + "/unifi/switching", BASE + "/unifi/wifi", BASE + "/unifi/cloud-gateways"})

# =============================================================================================
# resolve() builds the documented URL per task kind
# =============================================================================================
check("R1", "listing: an absolute site URL is returned as is", U.resolve({"task": "listing", "key": URL_LISTING}) == URL_LISTING)
check("R2", "listing: a site path becomes https://techspecs.ui.com/<path>", U.resolve({"task": "listing", "key": "/unifi/wifi"}) == BASE + "/unifi/wifi")
check("R3", "listing: a bare category name becomes /<name>", U.resolve({"task": "listing", "key": "unifi/wifi"}) == BASE + "/unifi/wifi")
check("R4", "part-page: the attached url wins", U.resolve({"task": "part-page", "key": "USW-Pro-24-POE", "url": URL_MAIN}) == URL_MAIN)
check("R5", "part-page: a /unifi/<category>/<slug> key builds the page URL (query stripped)",
      U.resolve({"task": "part-page", "key": "/unifi/switching/usw-pro-24-poe?subcategory=all-switching"}) == URL_MAIN)
check("R6", "part-page: a bare SKU has no derivable URL -> None", U.resolve({"task": "part-page", "key": "USW-Pro-24-POE"}) is None)
check("R7", "a URL on another host is refused", U.resolve({"task": "listing", "key": "https://store.ui.com/us/en"}) is None)
check("R8", "an empty key -> None", U.resolve({"task": "listing", "key": ""}) is None)

# =============================================================================================
# sabotage
# =============================================================================================
CHALLENGE = "<html><head><title>Just a moment...</title></head><body><div id='cf-challenge'>Checking your browser</div></body></html>"
check("S1.1", "a short 'Just a moment...' page is_blocked", U.is_blocked(CHALLENGE) is True)
check("S1.2", "the real product/listing/index pages are not blocked",
      not U.is_blocked(main_html) and not U.is_blocked(listing_html) and not U.is_blocked(index_html))

NF_NEXT = next_page(None, page="/404", title="404: This page could not be found")
NF_TITLE = "<html><head><title>Page not found - Tech Specs</title></head><body>Nothing here</body></html>"
NF_PAGE_ONLY = next_page(None, page="/404", title="Tech Specs")
check("S2.1", "Next.js default 404 (title + page '/404') is_not_found", U.is_not_found(NF_NEXT) is True)
check("S2.2", "a 'Page not found' title alone is_not_found", U.is_not_found(NF_TITLE) is True)
check("S2.3", "__NEXT_DATA__ page '/404' alone is_not_found", U.is_not_found(NF_PAGE_ONLY) is True)
check("S2.4", "the real product, listing and index pages are not not-found",
      not U.is_not_found(main_html) and not U.is_not_found(listing_html) and not U.is_not_found(index_html))

zzz = U.extract(main_html, {"task": "part-page", "key": "ZZZ-NOT-ON-THIS-PAGE", "url": URL_MAIN})
check("S3", "a key the page is not about -> not_listed True, sku still the page's own",
      zzz["not_listed"] is True and zzz["sku"] == "USW-Pro-24-POE", str((zzz["not_listed"], zzz["sku"])))

empty = U.extract(next_page(product_blob([])), {"task": "part-page", "key": "USW-Test-8"})
check("S4.1", "an empty spec list yields zero facts and not_listed False",
      empty["facts"] == [] and empty["not_listed"] is False and empty["sku"] == "USW-Test-8", str((empty["facts"], empty["not_listed"], empty["sku"])))
empty2 = U.extract(next_page(product_blob([{"section": {"label": "Overview"}, "features": []}])), {"task": "part-page", "key": "USW-Test-8"})
check("S4.2", "a section with an empty feature list yields zero facts", empty2["facts"] == [] and empty2["not_listed"] is False, str(empty2["facts"]))

odd = U.extract(next_page(product_blob([{"section": {"label": "Overview"}, "features": [
    entry("Port Layout", typename="SpecificationEntitySectionFeatureGroup", fid="grp"),
    entry("1 GbE RJ45", value="8", parent="grp"),
    entry("Mystery", typename="SpecificationEntitySectionFeatureEntryFuture"),   # neither value nor flag
    entry("Blank", value="   "),                                                  # whitespace-only value
    entry("Fanless", flag="False"),
    entry("Weight", value="  1.2 kg \n (2.6 lb) "),
    {"feature": {"label": ""}, "value": "orphan"},                                # no label
    "not a dict",
]}, "not a section", {"section": {"label": ""}, "features": [entry("X", value="1")]}])), {"task": "part-page", "key": "USW-Test-8"})
check("S5.1", "a row with neither value nor flag, a blank value, a blank label, and a non-dict row are all skipped",
      [f["label"] for f in odd["facts"]] == ["Overview > Port Layout > 1 GbE RJ45", "Overview > Fanless", "Overview > Weight"], str(odd["facts"]))
check("S5.2", "a False flag is kept as the raw string 'False'; whitespace inside a value is collapsed",
      fact(odd, "Overview > Fanless") == "False" and fact(odd, "Overview > Weight") == "1.2 kg (2.6 lb)", str(odd["facts"]))
check("S5.3", "a section without a label is skipped rather than emitted as ' > X'", not any(l.startswith(" > ") or l.startswith(">") for l in [f["label"] for f in odd["facts"]]))
check("S5.4", "no fact ever has an empty value", all(f["value"] for f in odd["facts"]))

plain = "<html><head><title>Switch Pro 24 PoE - Tech Specs</title></head><body><h1>USW-Pro-24-POE</h1><table><tr><td>Weight</td><td>4 kg</td></tr></table></body></html>"
np_ = U.extract(plain, {"task": "part-page", "key": "USW-Pro-24-POE"})
np2 = U.extract(plain, {"task": "part-page", "key": "ZZZ-NOT-ON-THIS-PAGE"})
check("S6.1", "a page without __NEXT_DATA__ yields no facts (the HTML table is not read) and does not raise",
      np_["facts"] == [] and np_["not_listed"] is False and np_["sku"] == "USW-Pro-24-POE", str(np_))
check("S6.2", "... and a foreign key on such a page is not_listed by the text", np2["not_listed"] is True)
broken = '<html><body><script id="__NEXT_DATA__" type="application/json">{"props": {"pageProps": </script></body></html>'
check("S6.3", "a truncated JSON blob yields no facts and does not raise", U.extract(broken, {"task": "part-page", "key": "X"})["facts"] == [])

anchors = ('<html><body><a href="/unifi/switching/usw-lite-8-poe?subcategory=all-switching">Lite 8 PoE USW-Lite-8-PoE</a>'
           '<a href="/unifi/switching/usw-lite-8-poe">dup</a><a href="/unifi/wifi?subcategory=all-wifi">All</a>'
           '<a href="/unifi/wifi?subcategory=wifi-indoor">Indoor</a><a href="https://store.ui.com/us/en/products/usw-lite-8-poe">Store</a>'
           '<a href="https://ui.com/switching">Marketing</a><a href="/unifi/wifi">WiFi</a></body></html>')
da = U.discover(anchors, {"task": "listing", "key": URL_LISTING})
check("S7", "anchors only (no JSON): product by slug once with the query stripped; wifi + wifi-indoor listings; store/marketing/All ignored",
      da == [{"task": "part-page", "key": "usw-lite-8-poe", "url": BASE + "/unifi/switching/usw-lite-8-poe"},
             {"task": "listing", "key": BASE + "/unifi/wifi?subcategory=wifi-indoor", "url": BASE + "/unifi/wifi?subcategory=wifi-indoor"},
             {"task": "listing", "key": BASE + "/unifi/wifi", "url": BASE + "/unifi/wifi"}], str(da))

vid = product_blob([])
vid["gallery"] = {"items": [{"data": {"url": "https://cdn.ecomm.ui.com/products/x/a.mp4", "mimeType": "video/mp4"}},
                            {"data": {"url": "https://cdn.ecomm.ui.com/products/x/b.png", "mimeType": "image/png"}},
                            {"data": {"url": "/relative.png", "mimeType": "image/png"}}]}
vid["thumbnail"] = {"url": "https://cdn.ecomm.ui.com/products/x/t.png"}
vi = U.extract(next_page(vid), {"task": "part-page", "key": "USW-Test-8"})
check("S8", "images: thumbnail first as primary, video and non-absolute URLs dropped, gallery photo kept",
      [(i["url"], i["role"]) for i in vi["images"]] == [("https://cdn.ecomm.ui.com/products/x/t.png", "primary"), ("https://cdn.ecomm.ui.com/products/x/b.png", "gallery")],
      str(vi["images"]))

print(f"\n{npass} passed, {nfail} missed")
sys.exit(1 if nfail else 0)
