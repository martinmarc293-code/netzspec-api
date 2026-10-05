"""tests/scraper/test_cisco_datasheets.py — proof for scraper/sources/cisco_datasheets.py.

    python3.11 tests/scraper/test_cisco_datasheets.py

THE FILENAME IS NOT DECORATIVE. apply-acquired's gate builds this path from the SOURCE SLUG
(`test_${slug.replace(/-/g,"_")}.py`) and treats a source with no suite as a FAILED suite. While this
file was called test_cisco_*_lane.py the gate looked for a name that did not exist, so both Cisco
lanes reported `passed: false` on every apply and NOTHING they fetched could ever reach the facts
table. The scraper ran, the queue drained, coverage never moved, and no error was printed anywhere.
Renaming it is the fix; do not rename it back.

No database and no network: every case runs against a document already in the cache, or against a
string. The lane exists because the four Cisco source rows had no adapter behind them for the
whole life of the project, so `load_source("cisco-datasheets")` raised and the worker could not
run the lane at all — case R0 is that regression, and it is the reason this file exists.

The cases are chosen for the ways a lane goes wrong rather than for the happy path: a task kind the
lane cannot serve must be REFUSED and not guessed at, an Akamai refusal must not read as a page, a
real page containing the words "access denied" must not read as a refusal, and discovery from a
content page must find nothing (the Meraki lane queued an entire translated-documents tree that
way and 84 of 91 fetches yielded nothing).
"""
from __future__ import annotations

import hashlib
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CACHE = Path(os.path.realpath(ROOT / "scraper" / "cache"))

npass = nfail = nskip = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:80]:82}" + ("" if ok else f" | got {str(got)[:200]}"))


# ---------------------------------------------------------------------------------------------
# R0. the registration regression: the lane must be loadable at all
# ---------------------------------------------------------------------------------------------
from sources import load_source  # noqa: E402

try:
    MOD = load_source("cisco-datasheets")
    check("R0", "load_source('cisco-datasheets') resolves — the four Cisco rows had NO adapter and "
                "the worker could not run them whatever `enabled` said", True)
except Exception as e:  # noqa
    check("R0", "load_source('cisco-datasheets') resolves", False, f"{type(e).__name__}: {e}")
    print("\n0 passed, 1 missed")
    raise SystemExit(1)

check("R1", "the module declares the slug the database uses", MOD.SLUG == "cisco-datasheets", MOD.SLUG)
for fn in ("resolve", "extract", "discover", "is_blocked", "is_not_found"):
    check(f"R2:{fn}", f"the source contract is complete: {fn}() exists", callable(getattr(MOD, fn, None)))

# ---------------------------------------------------------------------------------------------
# 1. resolve() — what the lane will and will not fetch
# ---------------------------------------------------------------------------------------------
DS = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html"
check("S1", "a datasheet task resolves to its document URL",
      MOD.resolve({"task": "datasheet", "key": DS}) == DS, MOD.resolve({"task": "datasheet", "key": DS}))
check("S2", "the task's own url wins over the key when both are present",
      MOD.resolve({"task": "datasheet", "key": "ignored", "url": DS}) == DS)
check("S3", "a listing task resolves the same way",
      MOD.resolve({"task": "listing", "key": DS}) == DS)
check("S4", "a root-relative key becomes an absolute cisco.com URL",
      MOD.resolve({"task": "listing", "key": "/c/en/us/products/index.html"})
      == "https://www.cisco.com/c/en/us/products/index.html",
      MOD.resolve({"task": "listing", "key": "/c/en/us/products/index.html"}))
# The refusals matter more than the successes: Cisco publishes no per-SKU page, so a URL built
# from a PID is a guess, and a guessed URL is a 404 the queue retries five times before it gives up.
check("S5", "SABOTAGE a part-page task is REFUSED, not guessed into a URL",
      MOD.resolve({"task": "part-page", "key": "C9200L-24P-4G"}) is None,
      MOD.resolve({"task": "part-page", "key": "C9200L-24P-4G"}))
check("S6", "SABOTAGE a search task is refused too",
      MOD.resolve({"task": "search", "key": "C9200L-24P-4G"}) is None)
check("S7", "SABOTAGE a datasheet task with a non-URL key is refused rather than joined to the host",
      MOD.resolve({"task": "datasheet", "key": "C9200L-24P-4G"}) is None,
      MOD.resolve({"task": "datasheet", "key": "C9200L-24P-4G"}))
check("S8", "SABOTAGE an empty task is refused", MOD.resolve({}) is None)

# ---------------------------------------------------------------------------------------------
# 2. is_blocked() — Akamai, not Cloudflare
# ---------------------------------------------------------------------------------------------
# Measured 5 Sep 2026: curl with a browser user-agent got HTTP 403 and 546 bytes of this; the
# lane's real Chrome got HTTP 200 and 1.4 MB of datasheet from the same URL.
AKAMAI_403 = ("<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n"
              "You don't have permission to access \"http://www.cisco.com/c/en/us/products/\" on this server.<P>\n"
              "Reference #18.2f4c1002.1757087· \n</BODY>\n</HTML>\n")
check("B1", "the Akamai refusal is a block", MOD.is_blocked(AKAMAI_403) is True)
check("B2", "an empty body is a block, not an empty page", MOD.is_blocked("") is True)
# The length guard is the whole rule. A Cisco security datasheet legitimately prints "Access
# Denied" in a feature table, and a rule without the guard would call every one of them blocked.
BIG_PAGE_SAYING_ACCESS_DENIED = ("<html><title>Cisco Secure Firewall Data Sheet</title><body>"
                                 + "<table><tr><td>Access control</td><td>Access Denied logging</td></tr></table>"
                                 + ("<p>specification text. </p>" * 900) + "</body></html>")
check("B3", "SABOTAGE a REAL datasheet containing the words 'Access Denied' is NOT a block "
            "(the length guard is the rule)",
      MOD.is_blocked(BIG_PAGE_SAYING_ACCESS_DENIED) is False,
      f"len={len(BIG_PAGE_SAYING_ACCESS_DENIED)}")
check("B4", "a Cloudflare-style challenge is still a block through the shared fingerprints",
      MOD.is_blocked("<html><title>Just a moment...</title><body>cf-chl</body></html>") is True)

check("N1", "Cisco's own 404 page reads as not-listed",
      MOD.is_not_found("<html><title>Page not found</title><body>We can't find the page you are looking for</body></html>") is True)
check("N2", "SABOTAGE a long real page is never not-listed, whatever it mentions",
      MOD.is_not_found(BIG_PAGE_SAYING_ACCESS_DENIED) is False)

# ---------------------------------------------------------------------------------------------
# 3. discover() — a listing finds work; a datasheet finds none
# ---------------------------------------------------------------------------------------------
LISTING = ("<html><body>"
           '<a href="/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html">DS</a>'
           '<a href="/c/en/us/products/collateral/switches/catalyst-9300-series-switches/eos-eol-notice-c51-744123.html">EoL</a>'
           '<a href="/c/en/us/support/index.html">Support</a>'
           '<a href="https://www.youtube.com/watch?v=1">Video</a>'
           '<a href="/c/en/us/products/collateral/switches/foo/guide.pdf">PDF guide</a>'
           "</body></html>")
found = MOD.discover(LISTING, {"task": "listing", "key": "https://www.cisco.com/c/en/us/products/switches/index.html"})
keys = [f["key"] for f in found]
check("D1", "a listing discovers the collateral documents it links",
      any("nb-06-cat9300-ser-data-sheet" in k for k in keys), keys)
check("D2", "...including the PDF", any(k.endswith("guide.pdf") for k in keys), keys)
check("D3", "SABOTAGE a support page outside /products/collateral/ is NOT queued",
      not any("/support/" in k for k in keys), keys)
check("D4", "SABOTAGE an off-site link is never queued",
      not any("youtube" in k for k in keys), keys)
eol = [f for f in found if "eos-eol" in f["key"]]
ds = [f for f in found if "data-sheet" in f["key"]]
check("D5", "an EoL notice is queued at a LOWER priority than a datasheet — it is real Cisco "
            "documentation and carries no specifications; 18,977 parts had one as their only "
            "'datasheet' because the two were fetched with equal enthusiasm",
      bool(eol) and bool(ds) and eol[0]["priority"] > ds[0]["priority"],
      f"eol={eol[0]['priority'] if eol else None} ds={ds[0]['priority'] if ds else None}")
check("D6", "SABOTAGE a DATASHEET discovers nothing: content pages link their whole family's "
            "collateral, and the Meraki lane queued an entire translated-documents tree that way",
      MOD.discover(LISTING, {"task": "datasheet", "key": "https://www.cisco.com/x.html"}) == [],
      MOD.discover(LISTING, {"task": "datasheet", "key": "https://www.cisco.com/x.html"}))
check("D7", "SABOTAGE unparseable HTML discovers nothing rather than killing the lane",
      MOD.discover("<<<>>> not html", {"task": "listing", "key": "https://www.cisco.com/i.html"}) == [])

# ---------------------------------------------------------------------------------------------
# 4. extract() — over a REAL cached datasheet, not an invented fixture
# ---------------------------------------------------------------------------------------------
sha = hashlib.sha1(DS.encode("utf-8")).hexdigest()
cached = CACHE / f"{sha}.html"
#: Cases below that only run with the cached fixture present. Counted so the summary line cannot
#: read as healthy while the suite runs at part strength.
FIXTURE_DEPENDENT = 8

if not cached.exists():
    # NAMES THE URL, NOT JUST THE HASH. `cached.name` is a sha1 an operator cannot act on; the URL
    # is the thing they can re-fetch. And it says how many cases went with it: the `else:` below
    # carries eight, so a missing fixture does not cost one case, it silently drops a seventh of the
    # suite while the summary reads "46 passed, 1 missed" — which looks like a minor failure rather
    # than a suite that did not fully check the adapter.
    #
    # The gate only stayed safe because exit 1 is exit 1. Had this been a warning — which "it is
    # only a fixture" reasoning invites — apply-acquired would have PASSED on a partly-run suite and
    # computed recall from it.
    nskip += FIXTURE_DEPENDENT
    check("E0", f"the Catalyst 9200 datasheet is in the cache; {FIXTURE_DEPENDENT} cases below "
                f"CANNOT RUN without it. Re-fetch {DS}", False,
          f"missing {cached.name} from {CACHE}")
else:
    html = cached.read_text(encoding="utf-8", errors="replace")
    res = MOD.extract(html, {"task": "datasheet", "key": DS})
    check("E1", "extract returns a RESULT with a subject and facts",
          isinstance(res, dict) and res.get("sku") and len(res.get("facts") or []) > 0,
          f"sku={res.get('sku')} facts={len(res.get('facts') or [])}")
    check("E2", "every fact carries a label, a value and a locator — a fact that cannot name its "
                "cell cannot be argued with",
          all(f.get("label") and f.get("value") and "locator" in f for f in res["facts"]),
          str(res["facts"][:1]))
    others = res.get("others") or []
    check("E3", "the datasheet's other models come back as `others`, each its own RESULT",
          len(others) > 0 and all("sku" in o and "facts" in o for o in others), f"{len(others)} others")
    fam = [o for o in others if o.get("scope") == "family"]
    check("E4", "series-level tables are a FAMILY-scoped result, never merged into a model — "
                "'never inherit a family value into a SKU the document does not list'",
          all(o.get("sku") for o in fam), f"{len(fam)} family-scoped")
    check("E5", "the document's own PID list rides along so inheritance scope can be enforced",
          isinstance(res.get("document_pids"), list) and len(res["document_pids"]) > 0,
          f"{len(res.get('document_pids') or [])} pids")
    check("E6", "the page title is kept as evidence", bool(res.get("name")), res.get("name"))
    subjects = {res["sku"]} | {o["sku"] for o in others}
    check("E7", "no subject appears twice across the primary and `others`",
          len(subjects) == 1 + len(others), f"{len(subjects)} subjects vs {1 + len(others)} results")

    # SABOTAGE: the extractor must refuse a non-English page rather than parse it with English
    # label rules, which produces confident nonsense.
    de = html.replace("<html", '<html lang="de"', 1)
    de = de.replace("Data Sheet", "Datenblatt").replace("Specifications", "Technische Daten")
    out = MOD.extract(de, {"task": "datasheet", "key": DS})
    check("E8", "SABOTAGE a German rendering is refused with a reason, not parsed by English rules",
          out.get("refused", "").startswith("non_english") or out.get("facts") == [],
          f"refused={out.get('refused')} facts={len(out.get('facts') or [])}")

# ---------------------------------------------------------------------------------------------
# 5. a LISTING has no subject, and must not claim the site said "we do not have this part"
# ---------------------------------------------------------------------------------------------
# Observed on the lane's first live run (5 Sep 2026): three Cisco index pages produced three
# `not_listed` outcomes, because a listing has no models and "no models found" fell through to the
# same answer as "the site says it does not stock this SKU". Those are different claims.
# not_listed writes a part_source_check and feeds the watchdog's not-listed-streak rule, which
# pauses a VENDOR lane at 15 in a row - so a lane doing discovery perfectly would pause itself.
_listing = MOD.extract(LISTING, {"task": "listing",
                                 "key": "https://www.cisco.com/c/en/us/products/switches/index.html"})
check("L1", "a listing result is NOT not_listed: a discovery page has no subject to be missing",
      _listing.get("not_listed") is False, str(_listing.get("not_listed")))
check("L2", "...and carries no subject and no facts, so nothing can be attributed to it",
      _listing.get("sku") is None and _listing.get("facts") == [] and _listing.get("others") == [],
      str({k: _listing.get(k) for k in ("sku", "facts", "others")})[:140])
check("L3", "...and is marked as a listing, so a reader can tell it from an empty datasheet",
      _listing.get("scope") == "listing", str(_listing.get("scope")))
_empty = MOD.extract("<html><body><p>nothing here</p></body></html>", {"task": "datasheet", "key": DS})
check("L4", "SABOTAGE a DATASHEET with no tables still reports not_listed - the discovery "
            "exemption must not swallow a genuinely empty product page",
      _empty.get("not_listed") is True, str(_empty)[:140])

# ---------------------------------------------------------------------------------------------
# 6. is_usable: the veto that stops a blank render poisoning the cache for ever
# ---------------------------------------------------------------------------------------------
# Browser.fetch asks the adapter before it WRITES. A client-rendered page whose script did not
# finish is HTTP 200 with the right title and no document body: it matches no challenge
# fingerprint, so it used to be cached and then served to every retry for ever. Two of ten cached
# HPE psnow documents are exactly that shape (HPE session, 5 Sep 2026). The veto prevents the
# write rather than evicting afterwards - an adapter that deleted what it disliked would
# eventually delete its own fixtures.
if cached.exists():
    check("U1", "a real cached datasheet is usable", MOD.is_usable(html) is True)
SHELL = ('<html><head><title>Cisco Catalyst 9300 Series Switches Data Sheet - Cisco</title>'
         '<meta property="og:title" content="Cisco Catalyst 9300 Data Sheet"></head>'
         '<body><div id="root"></div>' + ("<span>nav</span>" * 200) + "</body></html>")
check("U2", "SABOTAGE a 200-status shell with the CORRECT title and no table is NOT usable - the "
            "title is what made this look fine for as long as it did",
      MOD.is_usable(SHELL) is False, f"len={len(SHELL)} tables=0")
check("U3", "SABOTAGE an empty body is not usable", MOD.is_usable("") is False)
check("U4", "SABOTAGE a truncated capture is not usable", MOD.is_usable("<html><body>x</body></html>") is False)
check("U5", "a LISTING with no tables but plenty of links IS usable - its job is links, and "
            "vetoing it would refuse every discovery page",
      MOD.is_usable("<html><body>" + ('<a href="/c/en/us/products/collateral/x/y-ds.html">d</a>' * 30)
                    + ("padding " * 400) + "</body></html>") is True)

# ---------------------------------------------------------------------------------------------
# THE DISCOVERY LADDER — a listing yields the listings below it, bounded by path shape
# ---------------------------------------------------------------------------------------------
# On 5 Sep 2026 Cisco held exactly THREE listing tasks, hand-seeded once, against 61,270 hardware
# parts and a crawl gap of 39,119. Every cycle re-planned the same 80 rows, found them all done and
# logged "queue empty this cycle" — which reads identically whether the catalogue is finished or was
# never enumerated. `refresh` can only re-fetch documents already held, so nothing in the loop could
# ever discover a document it did not have. These cases pin the ladder AND its bound: the Meraki
# lane already proved that unbounded discovery queues a translated-documents tree and wastes 84 of
# 91 fetches, so "it finds more" is only half of what has to be true.
LADDER_BASE = "https://www.cisco.com/c/en/us/products/switches/index.html"
LADDER_HTML = ('<html><body>'
               '<a href="/c/en/us/products/switches/catalyst-9300-series-switches/index.html">series</a>'
               '<a href="/c/en/us/products/switches/catalyst-9200-series-switches/">series trailing slash</a>'
               '<a href="/c/en/us/products/routers/index.html">another category</a>'
               '<a href="/c/en/us/products/collateral/switches/x/data-sheet-c78-1.html">a datasheet</a>'
               '<a href="/c/en/us/products/switches/catalyst-9300-series-switches/models-comparison/deep/leaf.html">TOO DEEP</a>'
               '<a href="/c/en/us/support/switches/catalyst-9300-series-switches/tsd-products-support-series-home.html">support tree</a>'
               '<a href="/c/de_de/products/switches/index.html">a LOCALE mirror</a>'
               '<a href="https://blogs.cisco.com/tag/switches">off the product tree</a>'
               '<a href="/c/en/us/products/switches/index.html">itself</a>'
               '</body></html>')
_found = MOD.discover(LADDER_HTML, {"task": "listing", "key": LADDER_BASE, "url": LADDER_BASE})
_listings = [f["key"] for f in _found if f["task"] == "listing"]
_docs = [f["key"] for f in _found if f["task"] == "datasheet"]
check("LD1", "a listing yields the SERIES listings below it - without this the crawl cannot grow "
             "and three hand-seeded rows were the whole of Cisco's enumeration",
      any("catalyst-9300" in k for k in _listings) and any("catalyst-9200" in k for k in _listings),
      str(_listings))
check("LD2", "a sibling CATEGORY index is discovered too, so seeding one entry point reaches the rest",
      any(k.endswith("/products/routers/index.html") for k in _listings), str(_listings))
check("LD3", "SABOTAGE a link THREE segments deep is refused - that is a leaf with nothing to "
             "enumerate, and it is where the support and software trees begin",
      not any("models-comparison" in k for k in _listings), str(_listings))
check("LD4", "SABOTAGE the /support/ tree is never queued as a listing - the Meraki lane wasted 84 "
             "of 91 fetches on exactly this shape",
      not any("/support/" in k for k in _listings), str(_listings))
check("LD5", "SABOTAGE a LOCALE mirror (/c/de-de/) is refused - the same catalogue again in another "
             "language multiplies the crawl and adds no document",
      not any("de-de" in k or "de_de" in k for k in _listings), str(_listings))
check("LD6", "SABOTAGE an off-product-tree link (blogs.cisco.com) is refused",
      not any("blogs." in k for k in _listings), str(_listings))
check("LD7", "SABOTAGE the listing does not queue ITSELF - a self-link would re-fetch for ever",
      not any(k.rstrip("/") == LADDER_BASE.rstrip("/") for k in _listings), str(_listings))
check("LD8", "the datasheet on the same page is still queued as a DOCUMENT, not as a listing",
      any("data-sheet-c78-1" in k for k in _docs) and not any("collateral" in k for k in _listings),
      f"docs={_docs} listings={_listings}")
# THIS CASE USED TO ASSERT THE OPPOSITE, and it was asserting the defect. Its reasoning - "a
# datasheet yields facts and a listing only yields more work, so drain the facts first" - is sound
# in the abstract and produced a CLOSED LOOP, because the facts are never exhausted: `refresh`
# re-queues held documents for ever, so there is always document work outranking 800 and the next
# rung never runs. Measured 6 Sep 2026, the queue in lease order:
#
#     p70   listing     62     <- discovery
#     p80   datasheet  893     <- refresh; 893 of 893 were documents WE ALREADY HELD
#     p100  datasheet    4     <- newly discovered collateral
#     p800  listing      2     <- this rung, behind all of it
#
# 343 fetch tasks across three brands in one hour produced ZERO documents, and no new document
# entered the store between 4 and 6 Sep. A ladder whose next rung ranks below unlimited re-reading
# is a ladder with one rung. The test now asserts the ordering that can actually grow a corpus.
check("LD9", "a discovered listing OUTRANKS the documents it was found beside - it is an entry "
             "point the site named, and it is the only kind of task that can produce a URL we do "
             "not already hold",
      all(f["priority"] == 70 for f in _found if f["task"] == "listing")
      and all(f["priority"] >= 100 for f in _found if f["task"] == "datasheet"),
      str([(f["task"], f["priority"]) for f in _found]))
check("LD9b", "SABOTAGE ...and an EoL notice still drains after a real datasheet, so promoting "
              "discovery did not flatten the distinction that mattered",
      all(f["priority"] > 100 for f in _found if f["task"] == "datasheet" and "eol" in f["key"].lower()),
      str([(f["key"][-30:], f["priority"]) for f in _found if f["task"] == "datasheet"]))
check("LD10", "SABOTAGE a DATASHEET page still discovers nothing at all - the asymmetry the Meraki "
              "lane cost us is unchanged by the ladder",
      MOD.discover(LADDER_HTML, {"task": "datasheet", "key": LADDER_BASE, "url": LADDER_BASE}) == [])

# ---- THE HARDWARE INSTALLATION GUIDES (operator order 5 Oct 2026, routers only; reviewer ruling the same day) -------------
# The links are the REAL ones a cached router support page carries (4000 ISR and ASR 9000 series pages, read 5 Oct 2026),
# beside the shapes that must stay out: a configuration guide that mentions hardware, a safety booklet under /hardware/, a
# support tech note about an "installation guide", a syslog guide, and the support home page LD4 already refuses.
HG_BASE = "https://www.cisco.com/c/en/us/support/routers/4000-series-integrated-services-routers-isr/series.html"
HG_HTML = ('<html><body>'
           '<a href="/c/en/us/td/docs/routers/access/4400/hardware/installation/guide4400-4300/C4400_isr.html">HIG</a>'
           '<a href="/c/en/us/td/docs/routers/access/interfaces/NIM/hardware/installation/guide/4GLTENIM_HIG.html">NIM HIG</a>'
           '<a href="/c/en/us/td/docs/iosxr/asr9000/hardware-install/hig/b-asr9k-hardware-installation-guide.html">ASR9K HIG</a>'
           '<a href="/c/dam/en/us/td/docs/iosxr/asr9000/hardware-install/line-card-quick-reference-guide/asr9000_line_card_quick_reference.pdf">LC ref</a>'
           '<a href="/c/en/us/support/routers/4000-series-integrated-services-routers-isr/products-installation-and-configuration-guides-list.html">guides</a>'
           '<a href="/c/en/us/td/docs/routers/asr9000/software/26xx/interfaces/configuration/guide/b-interfaces-hardware-component-cg-asr9000-26xx.html">CONFIG</a>'
           '<a href="/c/dam/en/us/td/docs/routers/access/4400/hardware/Safety_Warnings/RCSI-0370-book.pdf">SAFETY</a>'
           '<a href="/c/en/us/support/docs/routers/4000-series-integrated-services-routers/213851-isr-waas-installation-guide-on-isr-4000.html">TECHNOTE</a>'
           '<a href="/c/en/us/td/docs/ios-xml/ios/17_xe/syslogs/17-10-x/b-system-message-guide-17-10-x.html">SYSLOG</a>'
           '<a href="/c/en/us/support/routers/4000-series-integrated-services-routers-isr/tsd-products-support-series-home.html">support home</a>'
           '</body></html>')
_hg = MOD.discover(HG_HTML, {"task": "listing", "key": HG_BASE, "url": HG_BASE})
_hg_docs = {f["key"]: f["priority"] for f in _hg if f["task"] == "datasheet"}
_hg_lists = {f["key"]: f["priority"] for f in _hg if f["task"] == "listing"}
check("HG1", "a ROUTER support page queues its hardware installation guides (routers/ and iosxr/ trees, HTML and /c/dam/ "
             "PDF) as DOCUMENTS at the datasheets' priority -- the only Cisco source of a component's weight",
      sum(1 for k in _hg_docs if "C4400_isr" in k or "4GLTENIM_HIG" in k or "b-asr9k-hardware-installation-guide" in k
          or "asr9000_line_card_quick_reference" in k) == 4 and set(_hg_docs.values()) == {100}, str(_hg_docs))
check("HG2", "the series' installation-guide index is queued as a LISTING at the ladder's 70, so the rest of its guides are found",
      any(k.endswith("products-installation-and-configuration-guides-list.html") and p == 70 for k, p in _hg_lists.items()),
      str(_hg_lists))
check("HG3", "SABOTAGE a CONFIGURATION guide that says 'hardware' is not queued -- hardware without install is not a hardware guide",
      not any("configuration/guide" in k for k in _hg_docs), str(_hg_docs))
check("HG4", "SABOTAGE a safety booklet under /hardware/ (RCSI), a support TECH NOTE about an installation guide and a "
             "syslog guide are not queued",
      not any(("RCSI" in k) or ("/support/docs/" in k) or ("syslogs" in k) for k in _hg_docs), str(_hg_docs))
check("HG5", "SABOTAGE the support home page is still never a listing (LD4's rule holds on a router page too)",
      not any("tsd-products-support-series-home" in k for k in _hg_lists), str(_hg_lists))
_hg_sw = MOD.discover(HG_HTML, {"task": "listing", "key": "https://www.cisco.com/c/en/us/support/switches/x/series.html",
                                "url": "https://www.cisco.com/c/en/us/support/switches/x/series.html"})
check("HG6", "SABOTAGE a NON-router listing queues no guide at all -- the order is routers only, every other category "
             "discovers exactly as before",
      not any(("td/docs" in f["key"]) or ("guides-list" in f["key"]) for f in _hg_sw), str([f["key"] for f in _hg_sw]))
check("HG7", "SABOTAGE a router DATASHEET page discovers nothing (the asymmetry LD10 pins, kept for guides too)",
      MOD.discover(HG_HTML, {"task": "datasheet", "key": HG_BASE, "url": HG_BASE}) == [])

# ---- model-column headers (reviewer ruling, 29 Sep 2026; docs/decisions/2026-09-29-pon-cups.md) ----------------------
# The fixtures keep the real pages' header text and first-cell shapes. The PON sheet's url is the REAL one: the known-SKU
# map that makes CGP-* PIDs is keyed by url, and a harness that passed a placeholder url once measured only the HW_PID
# fallback and reported CGP-* as unrecognised. That was the harness, not the extractor.
import tempfile                                     # noqa: E402
import adapters.cisco_specs_deep as DEEP            # noqa: E402

PON_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-pon-series/nb-06-cat-pon-datasheet-cte-en.html"
NO_MAP_URL = "https://www.cisco.com/c/en/us/products/collateral/switches/fixture-with-no-known-skus.html"


def _table(header, rows):
    head = "".join(f"<td><p>{h}</p></td>" for h in header)
    body = "".join("<tr>" + "".join(f"<td><p>{c}</p></td>" for c in r) + "</tr>" for r in rows)
    return f"<html><body><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></body></html>"


def _deep(html, url):
    r = DEEP.extract_document(html, url)
    return r["facts"], r["defects"]


_f, _d = _deep(_table(["Switch model", "Downlinks total PON ports", "Fans"],
                      [["CGP-OLT-8T", "8 GPON ports", "modular"], ["CGP-OLT-16T", "16 GPON ports", "fixed"]]), PON_URL)
_got = {(x.get("sku"), x["label"]): x["value"] for x in _f}
check("M1", "a 'Switch model' table over PIDs this datasheet attributes is a MODEL table: the OLT's PON port count is read "
            "per SKU (the Catalyst PON sheet states it nowhere else)",
      _got.get(("CGP-OLT-8T", "Downlinks total PON ports")) == "8 GPON ports"
      and _got.get(("CGP-OLT-16T", "Downlinks total PON ports")) == "16 GPON ports", sorted(_got.items())[:6])

_f, _d = _deep(_table(["Switch Model", "Maximum Number of PoE (IEEE 802.3af) Ports", "Available PoE Power"],
                      [["Cisco Catalyst 2960-Plus 48PST-L", "24 ports up to 15.4W 48 ports up to 7.7W", "370W"],
                       ["Cisco Catalyst 2960-Plus 24PC-L", "24 ports up to 15.4W", "370W"],
                       ["Cisco Catalyst 2960-Plus 24LC-L", "8 ports up to 15.4W", "123W"]]), NO_MAP_URL)
check("M2", "SABOTAGE a 'Switch Model' table over model NAMES (the 2960 PoE tables) is NOT a model table: it keeps the "
            "path it always had (shape B, family-scoped) and no row is recorded as an unattributable model row",
      not any(x.get("sku") for x in _f) and any(x.get("family_scope") for x in _f)
      and not any(y["code"] == "MODEL_ROW_UNATTRIBUTABLE" for y in _d), (len(_f), [y["code"] for y in _d]))

_f, _d = _deep(_table(["Switch model", "Uplink configuration PON port"],
                      [["CGP-ONT-1P", "1 GPON (SC/APC receptacle)"], ["CGP-ONT-4TVCW-x *", "1 GPON (SC/APC receptacle)"]]), PON_URL)
_un = [y for y in _d if y["code"] == "MODEL_ROW_UNATTRIBUTABLE"]
check("M3", "SABOTAGE a model table's row naming no attributable PID ('CGP-ONT-4TVCW-x *', footnote mark and all) is "
            "RECORDED, never dropped in silence, and none of its values is attributed to anything",
      len(_un) == 1 and _un[0]["locator"] == "t0:r2" and "CGP-ONT-4TVCW-x *" in _un[0]["detail"]
      and any(x.get("sku") == "CGP-ONT-1P" for x in _f) and not any("4TVCW" in str(x.get("sku") or "") for x in _f),
      (_un, [(x.get("sku"), x["label"]) for x in _f]))

_f, _d = _deep(_table(["Router model", "Fans"], [["C8200-1N-4T", "fixed"], ["C8200L-1N-4T", "fixed"]]), NO_MAP_URL)
check("M4", "SABOTAGE only the MEASURED qualifier is admitted: a 'Router model' table over real PIDs is not read as a model "
            "table (the widening was measured on the corpus for 'switch model' alone)",
      not any(x.get("shape") == "A" for x in _f), [(x.get("sku"), x.get("shape")) for x in _f])

_f, _d = _deep(_table(["Model", "Fans"], [["WS-C2960X-24PD-L", "fixed"]]), NO_MAP_URL)
check("M5", "an exact 'Model' header reads as it always has",
      any(x.get("sku") == "WS-C2960X-24PD-L" and x.get("shape") == "A" for x in _f), [(x.get("sku"), x.get("shape")) for x in _f])

_res = MOD.extract(_table(["Switch model", "Uplink configuration PON port"],
                          [["CGP-ONT-1P", "1 GPON (SC/APC receptacle)"], ["CGP-ONT-4TVCW-x *", "1 GPON (SC/APC receptacle)"]]),
                   {"task": "datasheet", "key": PON_URL, "url": PON_URL})
check("M7", "SABOTAGE the lane's RESULT carries the page's defects, so apply-acquired can count them per document (the "
            "list used to be built and discarded)",
      any(d.get("code") == "MODEL_ROW_UNATTRIBUTABLE" for d in (_res.get("defects") or [])), _res.get("defects"))

# ---- shape D: a NESTED per-model sub-table inside an attribute table (30 Sep 2026, the weight lane) ------------------
# The fixture keeps the real Catalyst 1300 / Business 220 geometry: a "Feature | Description" table whose label cell is
# rowspanned down a block and whose model and value cells are each colspanned over two columns.
def _nested(block_rows, head=("Model", "Unit weight"), label="Unit weight", extra="", rowspan=True):
    n = len(block_rows) + 1
    sub = f'<td colspan="2">{head[0]}</td>' + "".join(f'<td colspan="{4 // (len(head) - 1)}">{h}</td>' for h in head[1:])
    lead = "" if rowspan else "<td></td>"          # the SF350 sheets leave the label cell BLANK instead of spanning it
    body = "".join("<tr>" + lead + "".join(f'<td colspan="{span}">{c}</td>' for c, span in r) + "</tr>" for r in block_rows)
    return ("<html><body><table><tr><th>Feature</th><th colspan=\"6\">Description</th></tr>"
            f'<tr><td rowspan="{n if rowspan else 1}">{label}</td>{sub}</tr>{body}'
            '<tr><td>Power</td><td colspan="6">100-240V 50-60 Hz, internal, universal</td></tr>'
            f"{extra}</table></body></html>")


_W = [[("C1300-8T-E-2G", 2), ("1.39 kg (3.06 lb)", 4)], [("C1300-8P-E-2G", 2), ("1.72 kg (3.79 lb)", 4)],
      [("C1300-16T-2G", 2), ("2.18 kg (4.80 lb)", 4)]]
_r = DEEP.extract_document(_nested(_W), NO_MAP_URL)
_got = {(x.get("sku"), x["label"]): x for x in _r["facts"] if x.get("sku")}
check("SD1", "a nested 'label | Model | value' sub-table is read PER MODEL: each weight lands on its own row's PID, shape D, "
            "located at the value cell",
      _got.get(("C1300-8T-E-2G", "Unit weight"), {}).get("value") == "1.39 kg (3.06 lb)"
      and _got.get(("C1300-8P-E-2G", "Unit weight"), {}).get("value") == "1.72 kg (3.79 lb)"
      and _got.get(("C1300-16T-2G", "Unit weight"), {}).get("value") == "2.18 kg (4.80 lb)"
      and all(x["shape"] == "D" for x in _got.values()) and _got[("C1300-8T-E-2G", "Unit weight")]["locator"] == "t0:r2:c3",
      sorted((k, v["value"], v["locator"]) for k, v in _got.items()))
_noise = [x for x in _r["facts"] if not x.get("sku") and x["label"] == "Unit weight"]
check("SD2", "SABOTAGE shape B's reading of the SAME block (the PID and the weight as two document-level values of 'Unit "
            "weight', pairing lost) is withheld and counted, not emitted beside it; the row after the block is untouched",
      not _noise and _r["counts"].get("B_read_as_D", 0) > 0
      and any(x["label"] == "Power" and x.get("family_scope") for x in _r["facts"]),
      ([(x["label"], x["value"]) for x in _noise], _r["counts"]))

_r = DEEP.extract_document(_nested(_W, head=("Model", "Specification")), NO_MAP_URL)
check("SD3", "SABOTAGE a sub-table whose value column is a GENERIC word ('Specification') is NOT read per model: it names "
            "no measurement",
      not any(x.get("shape") == "D" for x in _r["facts"]), [(x.get("sku"), x["label"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested([[("C1300-8T-E-2G", 2), ("1.39 kg", 2), ("1.52 kg", 2)]], head=("Model", "AC PSU", "DC PSU")),
                           NO_MAP_URL)
check("SD4", "SABOTAGE two value columns (AC PSU | DC PSU) are CONFIGURATIONS and stay unread as a model's single value",
      not any(x.get("shape") == "D" for x in _r["facts"]), [(x.get("sku"), x["label"], x["value"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested([[("C1300-8T-E-2G", 2), ("1.39 kg", 2), ("", 2)]], head=("Model", "AC PSU", "DC PSU")),
                           NO_MAP_URL)
check("SD4b", "SABOTAGE a configuration table is refused by its HEADER, not by luck: with the DC cell blank the row prints "
             "one value, and it is still not read as the model's weight under 'AC PSU'",
      not any(x.get("shape") == "D" for x in _r["facts"]), [(x.get("sku"), x["label"], x["value"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested(_W, head=("Router", "Unit weight")), NO_MAP_URL)
check("SD8", "SABOTAGE only the measured model words head a sub-table's model column ('Model', 'Model name', ...): "
            "'Router' is not one of them, so the block keeps the path it always had",
      not any(x.get("shape") == "D" for x in _r["facts"]), [(x.get("sku"), x["label"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested(_W[:1], extra='<tr><td>Dimensions</td><td colspan="2">C1300-8P-E-2G</td>'
                                                 '<td colspan="4">268 x 170 x 44 mm</td></tr>'), NO_MAP_URL)
check("SD9", "SABOTAGE a new label ENDS the block: a later 'Dimensions | PID | value' row with the same spans is not read "
            "as that PID's weight",
      not any(x.get("sku") == "C1300-8P-E-2G" and x["label"] == "Unit weight" for x in _r["facts"])
      and any(x.get("sku") == "C1300-8T-E-2G" and x["label"] == "Unit weight" for x in _r["facts"]),
      [(x.get("sku"), x["label"], x["value"]) for x in _r["facts"] if x.get("sku")])

_r = DEEP.extract_document(_nested([_W[0], [("Cisco Catalyst 1300 8-port", 2), ("1.72 kg (3.79 lb)", 4)]]), NO_MAP_URL)
_un = [y for y in _r["defects"] if y["code"] == "MODEL_ROW_UNATTRIBUTABLE"]
check("SD5", "SABOTAGE a block row naming no attributable PID is RECORDED, its weight given to nobody, and the good row "
            "beside it still read",
      len(_un) == 1 and _un[0]["locator"] == "t0:r3" and not any(x.get("value") == "1.72 kg (3.79 lb)" and x.get("sku") for x in _r["facts"])
      and any(x.get("sku") == "C1300-8T-E-2G" and x.get("shape") == "D" for x in _r["facts"]), (_un, _r["counts"]))

_r = DEEP.extract_document(_nested([_W[0], [("C1300-8P-E-2G", 3), ("1.72 kg (3.79 lb)", 3)]]), NO_MAP_URL)
_mis = [y for y in _r["defects"] if y["code"] == "SUBTABLE_ROW_MISALIGNED"]
check("SD6", "SABOTAGE a block row whose cells break the sub-header's column spans is RECORDED as misaligned and not read "
            "as a model row (a shifted cell is how a weight lands on the wrong model)",
      len(_mis) == 1 and _mis[0]["locator"] == "t0:r3" and not any(x.get("sku") == "C1300-8P-E-2G" for x in _r["facts"]),
      (_mis, [(x.get("sku"), x["value"]) for x in _r["facts"] if x.get("sku")]))

_r = DEEP.extract_document(_nested([[("C1300-8T-E-2G", 2), ("32 W", 4)]], head=("Model", "Worst case"), label="Power consumption"),
                           NO_MAP_URL)
check("SD7", "a value header that differs from the label QUALIFIES it, the way shape A's two-row headers do",
      any(x.get("sku") == "C1300-8T-E-2G" and x["label"] == "Power consumption [Worst case]" and x["value"] == "32 W"
          for x in _r["facts"]), [(x.get("sku"), x["label"], x["value"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested(_W, rowspan=False), NO_MAP_URL)
_got = {x["sku"]: x["value"] for x in _r["facts"] if x.get("shape") == "D"}
check("SD10", "continuation rows whose label cell is BLANK (the SF350 / SF220 layout) belong to the block and are read "
             "per model, all three of them",
      _got == {"C1300-8T-E-2G": "1.39 kg (3.06 lb)", "C1300-8P-E-2G": "1.72 kg (3.79 lb)", "C1300-16T-2G": "2.18 kg (4.80 lb)"}, _got)

_r = DEEP.extract_document(_nested([[("C1300-8T-E-2G", 2), ("0.13 kVA", 4)]], head=("Model", "Power Rating"), label="Model"),
                           NO_MAP_URL)
check("SD11", "SABOTAGE a row whose own label is a MODEL WORD ('Model | Model | Power Rating', the 2960 sheets) is a model "
             "table's header, not an attribute's sub-table",
      not any(x.get("shape") == "D" for x in _r["facts"]) and not _r["counts"].get("B_read_as_D"), _r["counts"])

_r = DEEP.extract_document(_nested(_W, head=("Product Number", "Product Description"), label="Product Number and Description"),
                           NO_MAP_URL)
check("SD12", "SABOTAGE a value column headed 'Product Description' is a description, not a measurement, and is not read "
             "per model",
      not any(x.get("shape") == "D" for x in _r["facts"]), [(x.get("sku"), x["label"]) for x in _r["facts"]][:6])

_r = DEEP.extract_document(_nested(_W, head=("Model name", "Unit dimensions"), label="Unit dimensions (W x D x H)"), NO_MAP_URL)
check("SD13", "a value header that only RESTATES the label adds no qualifier: the label stays exactly as printed, so its "
             "axis order and its mapper rule still apply",
      any(x.get("sku") == "C1300-8T-E-2G" and x["label"] == "Unit dimensions (W x D x H)" for x in _r["facts"]),
      sorted({x["label"] for x in _r["facts"] if x.get("shape") == "D"}))

_r = DEEP.extract_document(_nested([_W[0], [("", 2), ("", 4)], _W[1]], rowspan=False), NO_MAP_URL)
check("SD14", "a wholly blank spacer row inside a block is skipped, not recorded as a misaligned model row, and the "
              "models on both sides of it are read",
      {x["sku"] for x in _r["facts"] if x.get("shape") == "D"} == {"C1300-8T-E-2G", "C1300-8P-E-2G"}
      and not any(y["code"] == "SUBTABLE_ROW_MISALIGNED" for y in _r["defects"]),
      ([x.get("sku") for x in _r["facts"] if x.get("shape") == "D"], [y["code"] for y in _r["defects"]]))


# ---- shape E: INLINE per-model value lists in ONE cell (30 Sep 2026, the attribute lane, ruling (A)) ----------------
# The real geometry: a "Feature | Description" table whose value cell is colspanned over the description columns, and
# holds the per-model difference INSIDE the cell. The three grammars are the Catalyst 1300 / 1200 and SG350X sheets'.
def _feature(rows, extra=""):
    body = "".join(f'<tr><td>{lab}</td><td colspan="6">{cell}</td></tr>' for lab, cell in rows)
    return (f'<html><body><table><tr><th>Feature</th><th colspan="6">Description</th></tr>{body}</table>{extra}'
            '</body></html>')


def _e(r, label=None):
    return {(x["sku"], x["value"]) for x in r["facts"] if x.get("shape") == "E" and (label is None or x["label"] == label)}


_ORDER = ('<table><tr><th>Model</th><th>Description</th></tr>' + "".join(
    f"<tr><td>{m}</td><td>switch</td></tr>" for m in ("C1200-8T-D", "C1200-16T-2G", "C1200-24T-4G", "C1300-8T-E-2G"))
    + "</table>")

_r = DEEP.extract_document(_feature([("Operating temperature", "23° to 122°F (-5° to 50°C) C1300-8T-E-2G, C1300-8P-E-2G, "
                                      "C1300-16T-2G. Fanless models are silent")]), NO_MAP_URL)
check("SE1", "value-first (the CBS350 / C1300 grammar): the range goes to EVERY listed model, shape E, at the value cell; a trailing "
             "sentence with no number is a note and is in no record",
      _e(_r) == {(m, "23° to 122°F (-5° to 50°C)") for m in ("C1300-8T-E-2G", "C1300-8P-E-2G", "C1300-16T-2G")}
      and all(x["locator"] == "t0:r1:c1" for x in _r["facts"] if x.get("shape") == "E"),
      sorted(_e(_r)))
check("SE2", "SABOTAGE shape B's document-level reading of the same row (the whole cell as one value, capped at 160) is "
             "withheld and counted",
      not any(x["label"] == "Operating temperature" and not x.get("sku") for x in _r["facts"])
      and _r["counts"].get("B_read_as_E", 0) > 0, _r["counts"])

_r = DEEP.extract_document(_feature([("Operating temperature", "32° to 122°F (0° to 50°C): C1300-8T-E-2G, C1300-16T-2G "
                                      "32° to 113°F (0° to 45°C): C1300-24T-4G")]), NO_MAP_URL)
check("SE3", "value-first with two groups (the SF/SG350 cell): each value pairs with the list AFTER it",
      _e(_r) == {("C1300-8T-E-2G", "32° to 122°F (0° to 50°C)"), ("C1300-16T-2G", "32° to 122°F (0° to 50°C)"),
                 ("C1300-24T-4G", "32° to 113°F (0° to 45°C)")}, sorted(_e(_r)))

_r = DEEP.extract_document(_feature([("Operating temperature", "C1300-8T-E-2G, C1300-16T-2G 32° to 122°F (0° to 50°C) "
                                      "C1300-24T-4G 32° to 113°F (0° to 45°C)")]), NO_MAP_URL)
check("SE4", "SABOTAGE list-first (the SG350X cell): each list pairs with the value AFTER it -- read the other way, the "
             "0-45 °C model would take the 0-50 °C range",
      _e(_r) == {("C1300-8T-E-2G", "32° to 122°F (0° to 50°C)"), ("C1300-16T-2G", "32° to 122°F (0° to 50°C)"),
                 ("C1300-24T-4G", "32° to 113°F (0° to 45°C)")}, sorted(_e(_r)))

_r = DEEP.extract_document(_feature([("Operating temperature", "32° to 122°F (0° to 50°C) for C1200-8T-D 23° to 122°F "
                                      "(-5° to 50°C) for other models")], extra=_ORDER), NO_MAP_URL)
check("SE5", "'for other models' (the Catalyst 1200 cell): the named model gets its range, the sheet's OTHER C1200 models "
             "get the default -- and a model of another series on the same sheet (C1300-8T-E-2G) gets nothing",
      _e(_r) == {("C1200-8T-D", "32° to 122°F (0° to 50°C)"), ("C1200-16T-2G", "23° to 122°F (-5° to 50°C)"),
                 ("C1200-24T-4G", "23° to 122°F (-5° to 50°C)")}, sorted(_e(_r)))

_r = DEEP.extract_document(_feature([("Power", "Supported on C1300-8T-E-2G and C1300-16T-2G only")]), NO_MAP_URL)
check("SE6", "SABOTAGE prose that names models is not a per-model value: refused with its reason, no E record, and shape B "
             "keeps the row it always had",
      not _e(_r) and any(d["code"] == "INLINE_LIST_REFUSED" and "no digit" in d["detail"] for d in _r["defects"])
      and any(x["label"] == "Power" and not x.get("sku") for x in _r["facts"]),
      ([d["detail"] for d in _r["defects"]], sorted(_e(_r))))

_r = DEEP.extract_document(_feature([("Operating temperature", "0 to 50°C for C1300-8T-E-2G")]), NO_MAP_URL)
check("SE7", "SABOTAGE ONE model and no 'other models' is not an inline list: no E record and no defect -- the cell keeps "
             "the path it always had",
      not _e(_r) and not any(d["code"].startswith("INLINE") for d in _r["defects"]), (sorted(_e(_r)), _r["defects"]))

_r = DEEP.extract_document(_feature([("Operating temperature", "0 to 50°C: C1300-8T-E-2G, C1300-16T-2G 0 to 45°C: "
                                      "C1300-16T-2G")]), NO_MAP_URL)
check("SE8", "SABOTAGE a model named twice with DIFFERENT values is refused whole, never resolved by position",
      not _e(_r) and any("named twice" in d["detail"] for d in _r["defects"]), [d["detail"] for d in _r["defects"]])

_r = DEEP.extract_document(_feature([("Operating temperature", "0 to 50°C for C1200-8T-D, C1300-8T-E-2G -5 to 50°C for "
                                      "other models")], extra=_ORDER), NO_MAP_URL)
check("SE9", "SABOTAGE 'other models' when the named models share no series prefix is refused: which series is 'other' "
             "is not on the page",
      not _e(_r) and any("series prefix" in d["detail"] for d in _r["defects"]), [d["detail"] for d in _r["defects"]])

_r = DEEP.extract_document(_feature([("Operating temperature", "-5 to 50°C: C1300-8T-E-2G, C130024MGP-4X, C1300-16T-2G")]),
                           NO_MAP_URL)
check("SE10", "SABOTAGE a model-shaped token the sheet does not attribute (the C1300 sheet's typo 'C130024MGP-4X') is "
              "skipped and REPORTED, never read as a value, and the list around it is read",
      _e(_r) == {("C1300-8T-E-2G", "-5 to 50°C"), ("C1300-16T-2G", "-5 to 50°C")}
      and any(d["code"] == "INLINE_TOKEN_UNATTRIBUTABLE" and "C130024MGP-4X" in d["detail"] for d in _r["defects"]),
      (sorted(_e(_r)), [d["detail"] for d in _r["defects"]]))

_r = DEEP.extract_document(_feature([("Power", "100-240V 50-60 Hz, internal, universal: C1300-16T-2G, C1300-24T-4G "
                                      "100-240V 50-60 Hz, external: C1300-8T-E-2G")]), NO_MAP_URL)
check("SE11", "SABOTAGE a number range right after a list ('... SG350-52MP 100-240V 50-60 Hz, external:', the real SF/SG350 "
              "cell) is the next VALUE, not a model: swallowing it left 'Hz, external' and refused the whole power cell",
      _e(_r) == {("C1300-16T-2G", "100-240V 50-60 Hz, internal, universal"), ("C1300-24T-4G", "100-240V 50-60 Hz, internal, universal"),
                 ("C1300-8T-E-2G", "100-240V 50-60 Hz, external")}, sorted(_e(_r)))

_r = DEEP.extract_document(_feature([("Operating temperature", "Secure boot and image signing are supported on "
                                      "C1300-8T-E-2G, C1300-16T-2G and all 350 models")]), NO_MAP_URL)
check("SE12", "SABOTAGE a list-first cell that OPENS WITH PROSE is refused (the SG350X 'Trustworthy systems' cell read as "
              "'and all SX350X models)' for three SKUs before this rule)",
      not _e(_r) and any("opens with prose" in d["detail"] for d in _r["defects"]), (sorted(_e(_r)), [d["detail"] for d in _r["defects"]]))

_r = DEEP.extract_document(_feature([("Specifications", "Table 3: C1300-8T-E-2G, C1300-16T-2G")]), NO_MAP_URL)
_r2 = DEEP.extract_document(_feature([("Operating temperature", "Table 3: C1300-8T-E-2G, C1300-16T-2G")]), NO_MAP_URL)
check("SE13", "SABOTAGE a caption ('Table 3') carries a digit but is not a value: refused",
      not _e(_r2) and any("caption" in d["detail"] for d in _r2["defects"]), [d["detail"] for d in _r2["defects"]])

_r = DEEP.extract_document(_feature([("Power", "C1300-8T-E-2G, C1300-16T-2G and all SX350X models")]), NO_MAP_URL)
check("SE14", "SABOTAGE the digits inside a series name are not a value: 'and all SX350X models' after a list carries no "
              "STANDALONE number, so it is refused instead of becoming two models' value",
      not _e(_r) and any("no digit" in d["detail"] for d in _r["defects"]), (sorted(_e(_r)), [d["detail"] for d in _r["defects"]]))


_r = DEEP.extract_document(_feature([("Operating temperature", "23° to 122°F (-5° to 50°C) C1300-8T-E-2G, C1300-8P-E-2G, "
                                      "C1300-16T-2G. Minimum ambient temperature for cold start is 32°F (0°C )")]), NO_MAP_URL)
check("SE21", "SABOTAGE a sentence WITH A NUMBER after the last list (the Catalyst 1300 cold-start minimum) conditions every "
              "value before it: refused, never read as a bare -5..50 °C with its condition dropped",
      not _e(_r) and any("conditions the values" in d["detail"] for d in _r["defects"]), (sorted(_e(_r)), [d["detail"] for d in _r["defects"]]))


_r = DEEP.extract_document(_feature([("Operating temperature", "32° to 122°F (0° to 50°C): C1300-8T-E-2G, C1300-16T-2G "
                                      "32° to 113°F (0° to 45°C): SG350-08PD")]), NO_MAP_URL)
check("SE22", "a trailing VALUE for a model the sheet does not attribute (the SF/SG350 cell's SG350-08PD) is an "
              "unattributable group -- skipped and reported -- not a condition: the listed models keep their value",
      _e(_r) == {("C1300-8T-E-2G", "32° to 122°F (0° to 50°C)"), ("C1300-16T-2G", "32° to 122°F (0° to 50°C)")}
      and any(d["code"] == "INLINE_TOKEN_UNATTRIBUTABLE" and "SG350-08PD" in d["detail"] for d in _r["defects"]),
      (sorted(_e(_r)), [d["detail"] for d in _r["defects"]]))


def _refused(r, why):
    return not _e(r) and any(d["code"] == "INLINE_LIST_REFUSED" and why in d["detail"] for d in r["defects"])


_r = DEEP.extract_document(_feature([("Operating temperature", "-5°C to +45°C when using the C1300-8T-E-2G, C1300-16T-2G "
                                      "-5°C to +35°C when using the C1300-24T-4G")]), NO_MAP_URL)
check("SE15", "SABOTAGE a CONDITIONAL value ('... when using the <fan>', the C9500X sheet gave the chassis range to its fans) "
              "is refused", _refused(_r, "conditional"), [d["detail"] for d in _r["defects"]])
_r = DEEP.extract_document(_feature([("Power", "● 100-240V internal: C1300-8T-E-2G, C1300-16T-2G ● 12V external: C1300-24T-4G")]),
                           NO_MAP_URL)
check("SE16", "SABOTAGE a bulleted notes cell is not a per-model list", _refused(_r, "bulleted"), [d["detail"] for d in _r["defects"]])
_r = DEEP.extract_document(_feature([("Operating temperature", "0 to 50°C (C1300-8T-E-2G, C1300-16T-2G) -5 to 50°C "
                                      "(C1300-24T-4G, C1300-8P-E-2G)")]), NO_MAP_URL)
check("SE17", "SABOTAGE a value cut at a parenthesised model list (unbalanced parentheses) is refused",
      _refused(_r, "unbalanced"), [d["detail"] for d in _r["defects"]])
_r = DEEP.extract_document(_feature([("Power", "NCS 1002-K9 100-240V: C1300-8T-E-2G, C1300-16T-2G")]), NO_MAP_URL)
check("SE18", "SABOTAGE a MODEL NAME inside a value ('NCS 1002-K9 ...', the NCS sheet gave its chassis weight to a PSU) means "
              "the lists are misaligned: refused", _refused(_r, "model name"), [d["detail"] for d in _r["defects"]])
_r = DEEP.extract_document(_feature([("Operating temperature", "-5 to 45°C: C1300-8T-E-2G -5 to 35°C: C1300-16T-2G")]), NO_MAP_URL)
check("SE19", "SABOTAGE a cell whose EVERY list names one model is a configuration table, not a model list: refused",
      _refused(_r, "single model"), [d["detail"] for d in _r["defects"]])
_r = DEEP.extract_document(_feature([("Weight", "1.39 kg: C1300-8T-E-2G, C1300-8P-E-2G 2.18 kg: C1300-16T-2G, C1300-24T-4G")]),
                           NO_MAP_URL)
check("SE20", "SABOTAGE a label shape E was NOT measured on ('Weight') keeps shape B's path even when its cell is a clean "
              "inline list: no E record and no defect",
      not _e(_r) and not any(d["code"].startswith("INLINE") for d in _r["defects"])
      and any(x["label"] == "Weight" and not x.get("sku") for x in _r["facts"]), (sorted(_e(_r)), _r["defects"]))

_cwd = os.getcwd()
try:
    os.chdir(tempfile.gettempdir())
    DEEP._SKU_MAP.clear()
    _map = DEEP._load_sku_map()
finally:
    os.chdir(_cwd)
check("M6", "SABOTAGE the known-SKU map loads from ANY working directory: resolved against the caller's cwd it went "
            "silently missing and every map-only PID (CGP-*, FPR-, UCSC-...) fell to the HW_PID fallback",
      len(_map) > 1000 and PON_URL in _map, len(_map))

summary = f"\n{npass} passed, {nfail} missed"
if nskip:
    # A suite that ran at PART STRENGTH says so in the line a human reads, or "46 passed, 1 missed"
    # reads as a minor failure rather than as a seventh of the cases never running.
    summary += (f", {nskip} NOT RUN because a fixture is missing from the cache — this suite did "
                f"not fully check the adapter")
print(summary)
raise SystemExit(1 if nfail else 0)
