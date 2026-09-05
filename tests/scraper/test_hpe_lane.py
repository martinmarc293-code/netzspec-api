"""tests/scraper/test_hpe_lane.py — proof for the HPE lane contract in
scraper/sources/hpe_quickspecs.py.

    python3.11 tests/scraper/test_hpe_lane.py

No database and no network: every case runs against a document already in the cache, or against a
string. `test_hpe_quickspecs.py` proves the EXTRACTION shape (table reading, rowspans, SKU folds);
this file proves what the LANE promises the worker — that it loads, that it refuses the task kinds
HPE cannot serve, that it declares the waits the worker reads off it, that its idea of a
"document" is the same one the brand watchdog scans by, and that a capture with no document in it
is refused rather than returned as a tidy nothing.

The cases are chosen for the ways a lane goes wrong, not for the happy path. Half of them are
refusals, and each refusal must happen for the STATED reason:

  * HPE serves no per-SKU page, so a `part-page` task must be REFUSED and not guessed into a URL.
  * HPE's refusal carries no HTML at all — the TLS handshake completes and the server sends
    nothing — so an empty body is a block and a 400 KB QuickSpecs never is, whatever words are in
    it. `looks_blocked()` believes "Access Denied" on anything under 40 KB and would call the
    56 KB "404 Error | HPE" page a block; `challenge_fingerprint()` does not.
  * A psnow capture with no document body is HTTP 200, correctly titled, unblocked and empty.
    Before 5 Sep 2026 it extracted to zero facts and the queue marked it `done`.
  * `is_document_url` must refuse HPE's index pages and its library JSON. Without it the
    watchdog's unrendered scan reported six problems where there were two.
"""
from __future__ import annotations

import hashlib
import io
import json
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
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:220]}"))


# ---------------------------------------------------------------------------------------------
# R. registration — the lane must be loadable through the registry the worker uses
# ---------------------------------------------------------------------------------------------
from sources import load_source  # noqa: E402

try:
    MOD = load_source("hpe-quickspecs")
    check("R0", "load_source('hpe-quickspecs') resolves — a source row with no module behind it "
                "cannot run whatever `enabled` says", True)
except Exception as e:  # noqa
    check("R0", "load_source('hpe-quickspecs') resolves", False, f"{type(e).__name__}: {e}")
    print("\n0 passed, 1 missed")
    raise SystemExit(1)

check("R1", "the module declares the slug the database uses", MOD.SLUG == "hpe-quickspecs", MOD.SLUG)
for fn in ("resolve", "extract", "discover", "is_blocked", "is_not_found"):
    check(f"R2:{fn}", f"the source contract is complete: {fn}() exists", callable(getattr(MOD, fn, None)))
check("R3", "the brand pack claims this lane and no other",
      __import__("brands", fromlist=["load_brand"]).load_brand("hpe").sources == ("hpe-quickspecs",),
      __import__("brands", fromlist=["load_brand"]).load_brand("hpe").sources)

# ---------------------------------------------------------------------------------------------
# W. the attributes the WORKER reads off this module
# ---------------------------------------------------------------------------------------------
# worker.Loop.process passes settle_ms=getattr(src, "SETTLE_MS", 1500) and
# wait_for=getattr(src, "WAIT_FOR", None). Without them the lane captures the psnow shell: on
# 3 Sep 2026 eight documents were fetched at the 1,500 ms default and two came back empty.
check("W1", "WAIT_FOR is a selector string the worker can pass to wait_for_selector",
      isinstance(getattr(MOD, "WAIT_FOR", None), str) and MOD.WAIT_FOR.strip() != "", repr(getattr(MOD, "WAIT_FOR", None)))
check("W2", "SETTLE_MS is an int above the 1500 ms default the worker would otherwise use",
      isinstance(getattr(MOD, "SETTLE_MS", None), int) and MOD.SETTLE_MS > 1500, getattr(MOD, "SETTLE_MS", None))
check("W3", "WAIT_FOR waits for the SAME marker is_rendered() checks — a wait that proves one "
            "thing and a check that proves another is a lane waiting for the wrong element",
      any(m in MOD.WAIT_FOR for m in MOD.RENDER_MARKERS), f"{MOD.WAIT_FOR} vs {MOD.RENDER_MARKERS}")

# ---------------------------------------------------------------------------------------------
# S. resolve() — what the lane will and will not fetch
# ---------------------------------------------------------------------------------------------
DOC_ID = "a00073540enw"
DOC_URL = f"https://www.hpe.com/psnow/doc/{DOC_ID}"
check("S1", "a datasheet task resolves a bare document id to its psnow URL",
      MOD.resolve({"task": "datasheet", "key": DOC_ID}) == DOC_URL, MOD.resolve({"task": "datasheet", "key": DOC_ID}))
check("S2", "a full URL passes through unchanged", MOD.resolve({"task": "datasheet", "key": DOC_URL}) == DOC_URL)
check("S3", "a root-relative path becomes an absolute hpe.com URL",
      MOD.resolve({"task": "datasheet", "key": f"/psnow/doc/{DOC_ID}"}) == DOC_URL,
      MOD.resolve({"task": "datasheet", "key": f"/psnow/doc/{DOC_ID}"}))
check("S4", "a listing task resolves to the media-library JSON page",
      str(MOD.resolve({"task": "listing", "key": "3"})).endswith("&page=3"), MOD.resolve({"task": "listing", "key": "3"}))
# The refusals matter more than the successes. HPE publishes no per-SKU page — a SKU resolves to
# the QuickSpecs of its family — so a URL built from a SKU is a guess, and a guessed URL is a 404
# the queue retries five times before it gives up.
check("S5", "SABOTAGE a part-page task is REFUSED, not guessed into a URL",
      MOD.resolve({"task": "part-page", "key": "JL658A"}) is None, MOD.resolve({"task": "part-page", "key": "JL658A"}))
check("S6", "SABOTAGE a search task is refused too", MOD.resolve({"task": "search", "key": "JL658A"}) is None)
check("S7", "SABOTAGE a datasheet task whose key is a SKU is refused rather than joined to the host",
      MOD.resolve({"task": "datasheet", "key": "JL658A"}) is None, MOD.resolve({"task": "datasheet", "key": "JL658A"}))
check("S8", "SABOTAGE an empty task is refused", MOD.resolve({}) is None)
check("S9", "SABOTAGE a listing key that is not a page number is refused, never coerced to page 1",
      MOD.resolve({"task": "listing", "key": "switches"}) is None, MOD.resolve({"task": "listing", "key": "switches"}))

# ---------------------------------------------------------------------------------------------
# X. is_document_url() — the predicate the brand watchdog scans the cache by
# ---------------------------------------------------------------------------------------------
for cid, url, want in [
    ("X1", "https://www.hpe.com/psnow/doc/a00073540enw", True),
    ("X2", "https://www.hpe.com/psnow/doc/a00073540enw.pdf?ver=46", True),
    ("X3", "https://www.hpe.com/us/en/collaterals/collateral.a00073540enw.html", True),
    # THE 38% MISS. psnow serves three id forms and the first version of this pattern knew one.
    # c04111378 is the 59-part FlexFabric QuickSpecs and c04111585 the 57-part one — between them
    # the two widest documents in this brand, and both were invisible to the watchdog's scan and
    # unresolvable as a task key.
    ("X9", "https://www.hpe.com/psnow/doc/c04111378", True),
    ("X10", "https://www.hpe.com/psnow/doc/4aa5-9518enw", True),
    # the four pages the first version of the watchdog's scan called broken. Every one of them is
    # a healthy HPE page that legitimately carries no collateral body.
    ("X4", "https://www.hpe.com/us/en/networking/switches.html", False),
    ("X5", "https://h41370.www4.hpe.com/quickspecs/overview.html", False),
    ("X6", "https://www.hpe.com/us/en/resource-library.html/restype/quickspecs/status/active/sort/date", False),
    ("X7", "https://www.hpe.com/us/en/resource-library/_jcr_content/polaris-body-zone/medialibrary.model.json?restype=quickspecs", False),
    ("X8", "", False),
]:
    check(cid, f"is_document_url({url[:52] or '<empty>'}...) is {want}", MOD.is_document_url(url) is want)

# ---------------------------------------------------------------------------------------------
# G. the host guard — authority follows the SOURCE, so this lane may only fetch HPE's own hosts
# ---------------------------------------------------------------------------------------------
# Everything this lane fetches lands as `vendor_page:hpe-quickspecs` at TIER 1, the tier reserved
# for HPE speaking about its own product. resolve() passes a full URL through unchanged, so
# without a guard a task carrying a distributor URL would be fetched at HPE's politeness budget
# and stored with HPE's authority. Three provantage.com pages are already filed against HPE parts.
for cid, u in [("G1", "https://www.provantage.com/hpe-537963-b21~7CMPT2WT.htm"),
               ("G2", "https://andovercg.com/datasheets/hpe-5400zl-Switch-modules.pdf"),
               ("G3", "https://www.juniper.net/us/en/products/switches/ex-series/ex4400.html"),
               ("G4", "https://www.hpe.com.evil.example/psnow/doc/a00073540enw")]:
    check(cid, f"SABOTAGE a datasheet task off HPE's hosts is REFUSED ({u.split('/')[2][:34]})",
          MOD.resolve({"task": "datasheet", "key": u}) is None, MOD.resolve({"task": "datasheet", "key": u}))
check("G5", "SABOTAGE a listing task off HPE's hosts is refused by the same guard",
      MOD.resolve({"task": "listing", "key": "https://www.provantage.com/index.htm"}) is None)
for cid, u in [("G6", "https://support.hpe.com/hpesc/public/docDisplay?docId=emr_na-c02051709"),
               ("G7", "https://arubanetworking.hpe.com/techdocs/Switches/xcvrs/PDF/Guide.pdf"),
               ("G8", "https://www.hpe.com/h20195/v2/getdocument.aspx?docname=4AA3-0666ENW")]:
    check(cid, f"...and HPE's OWN other document hosts still resolve ({u.split('/')[2]})",
          MOD.resolve({"task": "datasheet", "key": u}) == u, MOD.resolve({"task": "datasheet", "key": u}))

# ---------------------------------------------------------------------------------------------
# F. doc_surface() — the brand pack's own answer to "what does HPE publish", 100% of the corpus
# ---------------------------------------------------------------------------------------------
# src/core/docClass.ts decides a class from CISCO's evidence (its cNN type code, its filename
# keywords) and HPE collateral has no filename at all, so classifyDocument() returns
# `unclassified` for 66 of the 67 documents reaching an HPE part — invisible, because callers use
# classifyDocType(url, fallback) and the fallback is the stored doc_type. This table is the brand
# pack's own answer, enumerated from all 83 HPE-host URLs the system has ever touched.
for cid, u, want in [
    ("F1", "https://www.hpe.com/psnow/doc/a00073540enw", "vendor_datasheet_html"),
    ("F2", "https://www.hpe.com/psnow/doc/c04111378", "vendor_datasheet_html"),
    ("F3", "https://www.hpe.com/psnow/doc/4aa6-7884enw", "vendor_datasheet_html"),
    # the SAME document at a higher tier — the PDF rule must be tried before the HTML one
    ("F4", "https://www.hpe.com/psnow/doc/a00073540enw.pdf?ver=46", "vendor_datasheet_pdf"),
    ("F5", "https://www.hpe.com/us/en/collaterals/collateral.a00073540enw.html", "vendor_datasheet_html"),
    ("F6", "https://www.hpe.com/h20195/v2/getdocument.aspx?docname=4AA3-0666ENW", "vendor_datasheet_html"),
    ("F7", "https://arubanetworking.hpe.com/techdocs/Switches/xcvrs/PDF/AOS-S%20Guide.pdf", "vendor_datasheet_pdf"),
    # a SUPPORT document is a guide, not a datasheet. Classing it as a datasheet would put guide
    # prose into a specification tier and count these nine documents as spec coverage.
    ("F8", "https://support.hpe.com/hpesc/public/docDisplay?docId=emr_na-c02051709", "vendor_guide"),
    ("F9", "https://support.hpe.com/hpsc/doc/public/display?docId=emr_na-c03801956", "vendor_guide"),
    # discovery surfaces carry no specifications; calling them datasheets is exactly what made
    # 18,977 Cisco parts read as an extraction failure when they were a crawl gap
    ("F10", "https://www.hpe.com/us/en/resource-library/_jcr_content/polaris-body-zone/medialibrary.model.json?restype=quickspecs", "vendor_page"),
    ("F11", "https://h41370.www4.hpe.com/quickspecs/overview.html", "vendor_page"),
    ("F12", "https://www.hpe.com/us/en/networking/switches.html", "vendor_page"),
]:
    got = MOD.doc_class_for(u)
    check(cid, f"doc_class_for -> {want} ({u.split('hpe.com')[-1][:44] or u[:44]})", got == want, got)
check("F13", "SABOTAGE a URL no rule claims returns None, never a plausible default — an "
             "unclaimed surface is one nobody has looked at, and saying so is the point",
      MOD.doc_class_for("https://www.hpe.com/psnow/documents") is None
      and MOD.doc_class_for("") is None,
      MOD.doc_class_for("https://www.hpe.com/psnow/documents"))
check("F14", "SABOTAGE a distributor page is not claimed by HPE's table either — who published a "
             "document is a property of the source, never inferred from its URL shape",
      MOD.doc_class_for("https://www.provantage.com/hpe-537963-b21~7CMPT2WT.htm") is None,
      MOD.doc_class_for("https://www.provantage.com/hpe-537963-b21~7CMPT2WT.htm"))
check("F15", "every surface rule names itself, so a wrong class is traceable to the rule that "
             "produced it rather than argued about",
      MOD.doc_surface("https://www.hpe.com/psnow/doc/c04111378")[0] == "psnow_html",
      MOD.doc_surface("https://www.hpe.com/psnow/doc/c04111378"))

# ---------------------------------------------------------------------------------------------
# B. blocking — HPE refuses with silence, so the HTML rules must be exactly right about the rest
# ---------------------------------------------------------------------------------------------
check("B1", "an empty body is a block, not an empty page — HPE's real refusal drops the "
            "connection after the TLS handshake and delivers no HTML at all",
      MOD.blocked_reason("") == "empty_body", MOD.blocked_reason(""))
check("B2", "a Cloudflare-style interstitial is blocked, by NAME",
      MOD.blocked_reason("<html><title>Just a moment...</title><body>cf-chl</body></html>") is not None)
BIG_PAGE_SAYING_ACCESS_DENIED = ("<html><title>HPE Aruba Networking CX QuickSpecs</title><body>"
                                 '<div class="collateral-content">'
                                 "<table><tr><td>Access control</td><td>Access Denied logging</td></tr></table>"
                                 + ("<p>specification text. </p>" * 900) + "</div></body></html>")
check("B3", "SABOTAGE a REAL QuickSpecs containing the words 'Access Denied' is NOT a block — "
            "the size guard on wordy markers is the whole rule",
      MOD.blocked_reason(BIG_PAGE_SAYING_ACCESS_DENIED) is None, f"len={len(BIG_PAGE_SAYING_ACCESS_DENIED)}")
check("B4", "is_blocked() agrees with blocked_reason() rather than keeping its own opinion",
      MOD.is_blocked("") is True and MOD.is_blocked(BIG_PAGE_SAYING_ACCESS_DENIED) is False)
# HPE's OTHER refusal, captured live on 5 Sep 2026 rather than invented. www.hpe.com refuses with
# silence, but arubanetworking.hpe.com is Akamai and refuses with exactly Cisco's shape: 413 bytes
# citing errors.edgesuite.net. Two hosts, two behaviours, and this is the one a fingerprint can
# see — so it must be named, and B3 above proves the naming does not spread to real documents.
ARUBA_403 = ("<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n \n"
             "You don't have permission to access "
             "&quot;http&#58;&#47;&#47;arubanetworking&#46;hpe&#46;com&#47;support&#47;end&#45;of&#45;life&#47;&quot;"
             " on this server.<P>\nReference&#32;&#35;18&#46;c4753617&#46;1788626057&#46;97b9a2e7\n"
             "<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;c4753617&#46;1788626057&#46;97b9a2e7</P>\n"
             "</BODY>\n</HTML>\n")
check("B5", "the real arubanetworking.hpe.com Akamai refusal is blocked and NAMED — a second host "
            "with a second refusal shape, captured live rather than invented",
      MOD.blocked_reason(ARUBA_403) == "akamai_access_denied", MOD.blocked_reason(ARUBA_403))
check("B6", "SABOTAGE the Akamai refusal is not read as a 404 — it is a refusal to answer, and "
            "the queue must retry it rather than mark the part not-listed",
      MOD.is_not_found(ARUBA_403) is False)

NOT_FOUND_URL = "https://www.hpe.com/psnow/doc/a00094280enw"
nf = CACHE / (hashlib.sha1(NOT_FOUND_URL.encode()).hexdigest() + ".html")
if not nf.exists():
    check("N0", f"the real 404 fixture is in the cache ({nf.name})", False, "missing")
else:
    nf_html = nf.read_text(encoding="utf-8", errors="replace")
    check("N1", "the real '404 Error | HPE' page reads as not-found", MOD.is_not_found(nf_html) is True)
    # 56 KB, so `looks_blocked`'s 40 KB guard would not save it, but its wordy markers would fire
    # on any short HPE error page. The distinction is: a 404 is an ANSWER, a block is a refusal,
    # and reading one as the other sends the queue down the wrong disposition.
    check("N2", "SABOTAGE the 404 page is NOT read as a block — it is an answer, and the queue "
                "must mark it done rather than retry it five times",
          MOD.blocked_reason(nf_html) is None, MOD.blocked_reason(nf_html))
    check("N3", "SABOTAGE a long real page is never not-found, whatever it mentions",
          MOD.is_not_found(BIG_PAGE_SAYING_ACCESS_DENIED) is False)

# ---------------------------------------------------------------------------------------------
# D. discover() — a listing finds work; a document finds none
# ---------------------------------------------------------------------------------------------
LIB = json.dumps({"items": [
    {"title": "HPE Aruba Networking CX 6300 Switch Series", "cta": {"link": "/us/en/collaterals/collateral.a00073540enw.html"}},
    {"title": "HPE ProLiant DL380 Gen11 Server", "cta": {"link": "/us/en/collaterals/collateral.a50004444enw.html"}},
]})
found = MOD.discover(LIB, {"task": "listing", "key": "1"})
keys = [f["key"] for f in found]
check("D1", "a listing discovers the networking QuickSpecs it lists", "a00073540enw" in keys, keys)
check("D2", "SABOTAGE a SERVER QuickSpecs is not queued — it is outside this catalogue and would "
            "spend a politeness slot on every page of it", "a50004444enw" not in keys, keys)
check("D3", "SABOTAGE a DATASHEET discovers nothing: a QuickSpecs links its family's other "
            "collateral, and the Meraki lane queued a whole translated-documents tree that way",
      MOD.discover(LIB, {"task": "datasheet", "key": DOC_URL}) == [],
      MOD.discover(LIB, {"task": "datasheet", "key": DOC_URL}))
check("D4", "SABOTAGE a non-JSON body discovers nothing rather than killing the lane",
      MOD.discover("<<<>>> not json", {"task": "listing", "key": "1"}) == [])
check("D5", "SABOTAGE a short page does not queue a next page — a lane that always queues page "
            "N+1 walks the library for ever",
      not any(t["task"] == "listing" for t in found), [t for t in found if t["task"] == "listing"])
check("D6", "every discovered task is a kind resolve() can actually serve",
      all(MOD.resolve({"task": t["task"], "key": t["key"], "url": t.get("url")}) for t in found), keys)

# A LISTING is a discovery surface, not a subject, and worker.process calls extract() on every
# task kind. Two separate ways to get this wrong, both real:
#   the 3 Sep 2026 run recorded not_listed=true for the library index of 2,894 documents — which
#   is not "nothing here" but "the site says it does not have this part", the claim that writes a
#   part_source_check and pauses a vendor lane at fifteen of them;
#   and the unrendered refusal, added the same day, would have failed EVERY listing task, because
#   the library JSON has no collateral body and never will.
# Caught, not allowed to propagate: without the listing branch this raises, and a suite that dies
# on a traceback reports "1 missed" nowhere. A refusal must be visible as a named MISS.
try:
    lst = MOD.extract(LIB, {"task": "listing", "key": "1"})
except Exception as exc:  # noqa
    lst = None
    check("L2", "REGRESSION extract() on a listing does not raise the unrendered refusal — the "
                "library JSON has no collateral body and never will",
          False, f"{type(exc).__name__}: {str(exc)[:120]}")
if lst is not None:
    check("L1", "REGRESSION extract() on a listing does not claim not_listed — a discovery surface "
                "never says the site is missing a part",
          lst.get("not_listed") is False, lst.get("not_listed"))
    check("L2", "REGRESSION extract() on a listing does not raise the unrendered refusal — the "
                "library JSON has no collateral body and never will",
          lst.get("scope") == "listing" and lst.get("facts") == [], lst)
    check("L3", "...and it claims no subject", lst.get("sku") is None and not lst.get("others"), lst)

# ---------------------------------------------------------------------------------------------
# E. extract() — over a REAL cached QuickSpecs, not an invented fixture
# ---------------------------------------------------------------------------------------------
cached = CACHE / (hashlib.sha1(DOC_URL.encode()).hexdigest() + ".html")
if not cached.exists():
    check("E0", f"the CX 6300 QuickSpecs is in the cache ({cached.name})", False, "missing")
else:
    html = cached.read_text(encoding="utf-8", errors="replace")
    res = MOD.extract(html, {"task": "datasheet", "key": DOC_URL})
    others = res.get("others") or []
    all_facts = list(res.get("facts") or []) + [f for o in others for f in o["facts"]]
    check("E1", "extract returns a RESULT whose `others` carry the document's model SKUs",
          len(others) > 50 and all(o.get("sku") and "facts" in o for o in others), f"{len(others)} others")
    check("E2", "every fact carries a label, a value and a locator — a fact that cannot name its "
                "cell cannot be argued with",
          all(f.get("label") and f.get("value") and f.get("locator") for f in all_facts), str(all_facts[:1]))
    check("E3", "the document yields the volume a QuickSpecs should: this one holds 231 SKUs and "
                "1,430 raw facts, and every one of them is still unread in production",
          len(all_facts) > 1000, len(all_facts))
    check("E4", "the family-scoped result is never merged into a model — 'never inherit a family "
                "value into a SKU the document does not list'",
          res.get("scope") == "family" and all(o.get("scope") == "model" for o in others),
          f"{res.get('scope')} / {sorted({o.get('scope') for o in others})}")
    check("E5", "the page title is kept as evidence", bool(res.get("name")), res.get("name"))
    skus = [o["sku"] for o in others]
    check("E6", "no SKU appears twice in `others` — a localised '#B2B' SKU folds into its base",
          len(set(skus)) == len(skus), f"{len(skus)} entries, {len(set(skus))} distinct")
    check("E7", "the lane's own document-url predicate accepts the document it just parsed",
          MOD.is_document_url(DOC_URL) is True)

# ---------------------------------------------------------------------------------------------
# U. the unrendered capture — the silent failure this lane exists to refuse
# ---------------------------------------------------------------------------------------------
# The real thing, from the cache: fetched 5 Sep 2026, HTTP 200, 264 KB, `og:title` correct, not
# blocked, not a 404 — and no document in it. Before this refusal existed it produced zero facts
# and `worker.process` recorded `no_facts`, which the queue marks `done`.
SHELL_URL = "https://www.hpe.com/psnow/doc/a00085162enw"
shell = CACHE / (hashlib.sha1(SHELL_URL.encode()).hexdigest() + ".html")
if not shell.exists():
    check("U0", f"the real unrendered capture is in the cache ({shell.name})", False, "missing")
else:
    shtml = shell.read_text(encoding="utf-8", errors="replace")
    check("U1", "the real unrendered capture is large, HTTP-200-shaped and correctly titled — "
                "nothing about it looks wrong except that the document is absent",
          len(shtml) > 200_000 and "og:title" in shtml, f"{len(shtml)} bytes")
    check("U2", "...it is not blocked", MOD.is_blocked(shtml) is False)
    check("U3", "...it is not a 404", MOD.is_not_found(shtml) is False)
    check("U4", "...and is_rendered() says the document body never arrived", MOD.is_rendered(shtml) is False)
    try:
        MOD.extract(shtml, {"task": "datasheet", "key": SHELL_URL})
        check("U5", "SABOTAGE the real unrendered capture is REFUSED, not returned as zero facts",
              False, "extract() returned a result instead of raising")
    except MOD.UnrenderedDocument as exc:
        msg = str(exc)
        check("U5", "SABOTAGE the real unrendered capture is REFUSED, not returned as zero facts", True)
        check("U6", "...the refusal names the document and the command that clears it",
              SHELL_URL in msg and "--force" in msg, msg[:140])
        # worker.classify_exception routes anything whose message says "timeout" to the timeout
        # branch, which reports a slow host instead of a missing document. The wording is
        # load-bearing and this case is what keeps it that way.
        check("U7", "...and never says 'timeout', which would file it as a slow host",
              "timeout" not in msg.lower() and "timed out" not in msg.lower(), msg[:140])
    except Exception as exc:  # noqa
        check("U5", "SABOTAGE the real unrendered capture is REFUSED, not returned as zero facts",
              False, f"{type(exc).__name__}: {exc}")

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
