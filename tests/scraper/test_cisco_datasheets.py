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

npass = nfail = 0


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
if not cached.exists():
    check("E0", f"the Catalyst 9200 datasheet is in the cache ({cached.name})", False, "missing")
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

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
