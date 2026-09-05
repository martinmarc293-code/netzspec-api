"""tests/scraper/test_juniper_lane.py - proof for scraper/sources/juniper.py.

    python3.11 tests/scraper/test_juniper_lane.py

No database and no network: every case runs against a document already in the cache, or against a
string. Copied from `test_cisco_lane.py` and then rewritten for a lane whose failure modes are
almost the inverse of Cisco's - so the sabotage cases are not the same sabotage cases, and that is
the point of copying the file rather than the assertions.

The four ways THIS lane goes wrong, each with a case that has to fail if the guard is removed:

  1. IT POINTS AT THE WRONG HOST. www.juniper.net answers its product URLs with a 404 page under a
     403 status and a megabyte of body (measured 5 Sep 2026). A lane there reports a nightly wall
     of blocks for a host that is not blocking anything. Cases H1-H3.
  2. IT TREATS A NOT-FOUND PAGE AS A PAGE. HCT answers HTTP 200 for a model number it does not
     know; the not-found page is 32.1 KB against a real page's 37.7 KB, so neither the status nor
     a length guard can decide it. 65 of our 168 SKUs are absent from HCT, so the lane meets this
     page constantly. Cases N1-N5.
  3. IT STORES AN EM DASH AS A SPECIFICATION. HCT writes "not published" as a bare U+2014.
     Cases P1-P3.
  4. IT LOSES A MINUS SIGN. HCT writes minus as U+2013 EN DASH and separates number from unit with
     U+00A0. "-25.0 dBm" read naively is a receiver sensitivity of POSITIVE 25 dBm: absurd in
     physics, in band for any range check, and indistinguishable from a real figure afterwards.
     Cases S1-S4 - the most important cases in this file.
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


def cached(url: str) -> str | None:
    p = CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}.html"
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else None


# ---------------------------------------------------------------------------------------------
# R0. the registration regression: the lane must be loadable at all
# ---------------------------------------------------------------------------------------------
from sources import load_source  # noqa: E402

try:
    MOD = load_source("juniper")
    check("R0", "load_source('juniper') resolves - the row existed with NO adapter and the worker "
                "could not run it whatever `enabled` said, so nothing was ever read from Juniper", True)
except Exception as e:  # noqa
    check("R0", "load_source('juniper') resolves", False, f"{type(e).__name__}: {e}")
    print("\n0 passed, 1 missed")
    raise SystemExit(1)

check("R1", "the module declares the slug the database uses", MOD.SLUG == "juniper", MOD.SLUG)
for fn in ("resolve", "extract", "discover", "is_blocked", "is_not_found"):
    check(f"R2:{fn}", f"the source contract is complete: {fn}() exists", callable(getattr(MOD, fn, None)))

from brands import load_brand  # noqa: E402

BRAND = load_brand("juniper")
check("R3", "the brand pack loads and owns this lane", BRAND.sources == ("juniper",), BRAND.sources)
check("R4", "every doc class the pack declares can actually be fetched - no PDF class, because "
            "HCT's PDF export is behind /hct/auth/login and a class that can never be filled is a "
            "permanent false gap in every report",
      [d.key for d in BRAND.doc_classes] == ["vendor_tool"], [d.key for d in BRAND.doc_classes])
check("R5", "SABOTAGE the pack declares NO covered_pct or recall_gap target: all 168 parts carry "
            "tier-0 seed facts, so both read PASS for ever on a brand nothing has been read from",
      not {t.metric for t in BRAND.targets} & {"covered_pct", "recall_gap"},
      [t.metric for t in BRAND.targets])

# ---------------------------------------------------------------------------------------------
# 1. HOST - the lane must point at apps.juniper.net and never at www.juniper.net
# ---------------------------------------------------------------------------------------------
MODEL = "https://apps.juniper.net/hct/model/CFP-GEN2-100GBASE-LR4"
check("H1", "a part-page task resolves to the HCT model page - Juniper DOES publish per SKU, "
            "which is the opposite of the Cisco lane",
      MOD.resolve({"task": "part-page", "key": "CFP-GEN2-100GBASE-LR4"}) == MODEL,
      MOD.resolve({"task": "part-page", "key": "CFP-GEN2-100GBASE-LR4"}))
check("H2", "SABOTAGE nothing this lane builds ever points at www.juniper.net, which answers a "
            "404 page under a 403 status and would be reported as a nightly wall of blocks",
      all("www.juniper.net" not in (MOD.resolve(t) or "") for t in (
          {"task": "part-page", "key": "SFP-1GE-LX"},
          {"task": "listing", "key": "100001"},
          {"task": "listing", "key": "/hct/category/100001"},
          {"task": "datasheet", "key": "https://www.juniper.net/documentation/us/en/hardware/"})),
      [MOD.resolve({"task": "listing", "key": "100001"})])
check("H3", "the pack's host list is apps.juniper.net, so a block report is scoped to the host "
            "the lane actually touches", BRAND.hosts == ("apps.juniper.net",), BRAND.hosts)

# ---------------------------------------------------------------------------------------------
# 2. resolve() - what the lane will and will not fetch
# ---------------------------------------------------------------------------------------------
check("S1", "a bare category id resolves to its listing URL",
      MOD.resolve({"task": "listing", "key": "100001"})
      == "https://apps.juniper.net/hct/category/100001",
      MOD.resolve({"task": "listing", "key": "100001"}))
check("S2", "a root-relative listing key becomes an absolute apps.juniper.net URL",
      MOD.resolve({"task": "listing", "key": "/hct/category/100002"})
      == "https://apps.juniper.net/hct/category/100002")
check("S3", "SABOTAGE a datasheet task is REFUSED - HCT's PDF export is behind "
            "/hct/auth/login and a login wall is a 401 the queue retries five times",
      MOD.resolve({"task": "datasheet", "key": "https://apps.juniper.net/hct/download?type=model"}) is None,
      MOD.resolve({"task": "datasheet", "key": "https://apps.juniper.net/hct/download?type=model"}))
check("S4", "SABOTAGE a search task is refused - the model URL is derivable from the SKU, so a "
            "search is a slower route to a page part-page already reaches",
      MOD.resolve({"task": "search", "key": "SFP-1GE-LX"}) is None)
check("S5", "SABOTAGE a gpl task is refused - HCT publishes no prices",
      MOD.resolve({"task": "gpl", "key": "SFP-1GE-LX"}) is None)
check("S6", "SABOTAGE an empty task is refused", MOD.resolve({}) is None)
check("S7", "SABOTAGE a part-page task whose key is a URL is refused rather than pasted into the "
            "model path - the planner built something this lane never asked for",
      MOD.resolve({"task": "part-page", "key": "https://example.com/x"}) is None,
      MOD.resolve({"task": "part-page", "key": "https://example.com/x"}))
check("S8", "SABOTAGE a listing task pointing off-host is refused: the key comes from the queue, "
            "which is written by discover(), which is written by a page",
      MOD.resolve({"task": "listing", "key": "https://evil.example/hct/category/1"}) is None,
      MOD.resolve({"task": "listing", "key": "https://evil.example/hct/category/1"}))
check("S9", "SABOTAGE a one-character part-page key is refused, not turned into a URL",
      MOD.resolve({"task": "part-page", "key": "X"}) is None)
check("S10", "a model number with a slash is escaped into ONE path segment rather than changing "
             "the path shape",
      MOD.resolve({"task": "part-page", "key": "A/B-1G"}) == "https://apps.juniper.net/hct/model/A%2FB-1G",
      MOD.resolve({"task": "part-page", "key": "A/B-1G"}))

# ---------------------------------------------------------------------------------------------
# 3. is_blocked() - apps.juniper.net has never refused, so the fingerprint must still be named
# ---------------------------------------------------------------------------------------------
check("B1", "a Cloudflare challenge is a block through the shared structural fingerprints",
      MOD.is_blocked("<html><title>Just a moment...</title><body>cf-chl</body></html>") is True)
check("B2", "an empty body is a block, not an empty page", MOD.is_blocked("") is True)
check("B3", "the block reason is NAMED, not a bare boolean - 'blocked:turnstile_verify_human' is "
            "a fact somebody can act on and 'no_facts' is not",
      MOD.blocked_reason("<html>performing security verification</html>") is not None,
      MOD.blocked_reason("<html>performing security verification</html>"))

# ---------------------------------------------------------------------------------------------
# 4. is_not_found() - HTTP 200, 32 KB, and no status to read
# ---------------------------------------------------------------------------------------------
BOGUS = cached("https://apps.juniper.net/hct/model/NOT-A-REAL-SKU-XYZ")
REAL = cached(MODEL)
XENPAK = cached("https://apps.juniper.net/hct/model/XENPAK-1XGE-ZR")
LISTING = cached("https://apps.juniper.net/hct/category/100001")
MISSING = cached("https://apps.juniper.net/hct/model/QFX-QSFP-40G-LR4")

if not all((BOGUS, REAL, XENPAK, LISTING, MISSING)):
    check("E0", "the five HCT documents this file needs are in the cache", False,
          "missing: " + ", ".join(n for n, v in (("bogus", BOGUS), ("real", REAL), ("xenpak", XENPAK),
                                                 ("listing", LISTING), ("missing-sku", MISSING)) if not v))
else:
    check("N1", "HCT's not-found page reads as not-listed even though it answered HTTP 200",
          MOD.is_not_found(BOGUS) is True)
    check("N2", "SABOTAGE a REAL model page is never not-listed - and a length guard could not "
                "have told them apart: the real page is %d KB against the not-found page's %d KB"
          % (len(REAL) // 1024, len(BOGUS) // 1024),
          MOD.is_not_found(REAL) is False, f"real={len(REAL)} bogus={len(BOGUS)}")
    check("N3", "SABOTAGE a CATEGORY page is never not-listed - it has no `component` record "
                "either, so a rule written only against `component` would mark every listing "
                "not_listed, discovery would never run, and the lane would report success",
          MOD.is_not_found(LISTING) is False)
    check("N4", "a SKU we hold that HCT genuinely does not list reads as not-listed - 65 of our "
                "168 do, so this is the common case, not the edge one",
          MOD.is_not_found(MISSING) is True)
    check("N5", "SABOTAGE a page that is not an HCT page at all is NOT not-listed: this function "
                "answers 'did the site say no', and a page with no payload has said nothing",
          MOD.is_not_found("<html><body>hello</body></html>") is False)

    # -----------------------------------------------------------------------------------------
    # 5. extract() over the REAL cached documents
    # -----------------------------------------------------------------------------------------
    res = MOD.extract(REAL, {"task": "part-page", "key": "CFP-GEN2-100GBASE-LR4"})
    check("E1", "extract returns a RESULT whose subject is the model the page is about",
          res.get("sku") == "CFP-GEN2-100GBASE-LR4" and len(res.get("facts") or []) > 10,
          f"sku={res.get('sku')} facts={len(res.get('facts') or [])}")
    check("E2", "every fact carries a label, a value and a locator - a fact that cannot name its "
                "cell cannot be argued with",
          all(f.get("label") and f.get("value") and f.get("locator") for f in res["facts"]),
          str(res["facts"][:1]))
    check("E3", "the locator names the standard and the row, so a value can be traced back to the "
                "table it was printed in",
          any("standardParams[100GBASE-LR4]" in f["locator"] for f in res["facts"]),
          [f["locator"] for f in res["facts"][:3]])
    check("E4", "HCT's `Part Number` is an ALIAS, never a fact: 740-... is Juniper's orderable "
                "number for the model, and an identifier recorded as a specification is noise the "
                "gate would have to learn to reject",
          any(a["kind"] == "vendor_part_number" and a["value"].startswith("740-")
              for a in res["aliases"])
          and not any("part number" in f["label"].lower() for f in res["facts"]),
          f"aliases={res['aliases']}")
    check("E5", "supported platforms and line cards come back as `compatible` RELATIONS - a "
                "router's name in a transceiver's specification field is not a specification",
          len(res["relations"]) > 0 and all(r["kind"] == "compatible" for r in res["relations"]),
          f"{len(res['relations'])} relations")
    check("E6", "the model's own description is kept as evidence", bool(res.get("name")), res.get("name"))
    check("E7", "SABOTAGE a model page produces NO `others` - HCT documents one model per page, "
                "so there is nothing to inherit and no scope to decide",
          res.get("others") == [], res.get("others"))
    check("E8", "a not-found page extracts to not_listed with a REASON, never to an empty success",
          MOD.extract(BOGUS, {"task": "part-page", "key": "NOT-A-REAL-SKU-XYZ"})["not_listed"] is True
          and bool(MOD.extract(BOGUS, {"task": "part-page", "key": "X"}).get("refused")),
          MOD.extract(BOGUS, {"task": "part-page", "key": "X"}).get("refused"))

    # -----------------------------------------------------------------------------------------
    # 6. THE PLACEHOLDER TRAP - HCT writes "not published" as a bare em dash
    # -----------------------------------------------------------------------------------------
    xen = MOD.extract(XENPAK, {"task": "part-page", "key": "XENPAK-1XGE-ZR"})
    labels = {f["label"] for f in xen["facts"]}
    check("P1", "SABOTAGE `Operating Temperature (range)` is U+2014 on this page and is REFUSED, "
                "not stored - a parser that cannot parse returns a reason and stores nothing",
          "Operating Temperature (range)" not in labels,
          [f for f in xen["facts"] if "Temperature" in f["label"]])
    check("P2", "SABOTAGE `Storage temperature` is the same em dash and is refused too",
          "Storage temperature" not in labels)
    check("P3", "no stored value is a dash, a placeholder or empty - checked over every fact on "
                "the page rather than over the two known cells",
          all(f["value"].strip(" -‐‑‒–—―−")
              and f["value"].strip().lower() not in ("n/a", "tbd", "none", "?")
              for f in xen["facts"]),
          [f for f in xen["facts"] if len(f["value"].strip()) < 3])
    check("P4", "the page's real values still come through - refusing placeholders must not "
                "refuse the page", len(xen["facts"]) >= 12, len(xen["facts"]))

    # -----------------------------------------------------------------------------------------
    # 7. THE SIGN TRAP - HCT writes minus as an EN DASH and U+00A0 between number and unit
    # -----------------------------------------------------------------------------------------
    by_label = {f["label"]: f["value"] for f in xen["facts"]}
    rx_min = by_label.get("Receiver input power, each lane (minimum)")
    check("S-1", "SABOTAGE receiver sensitivity keeps its MINUS SIGN. HCT writes it as U+2013 EN "
                 "DASH; read naively this optic reports POSITIVE 25 dBm receiver sensitivity - "
                 "absurd in physics, in band for any range check, unrecoverable once written",
          rx_min is not None and rx_min.startswith("-25"), rx_min)
    # The NBSP is written below as an ESCAPE and never as itself: an invisible character in a
    # test file reads as an ordinary space and the assertion stops being reviewable. This case
    # carried a literal one at first, which is how it went unnoticed that the explicit fold it
    # was aimed at had already been made redundant by _clean's Unicode-aware whitespace
    # collapse - the sabotage run found it, a reading of the file could not have.
    check("S-2", "the NO-BREAK SPACE HCT puts between number and unit is folded to a real "
                 "space, so the unit is a separate token a tokeniser cannot glue or drop",
          rx_min is not None and "\u00a0" not in rx_min and rx_min.split() == ["-25.0", "dBm"],
          repr(rx_min))
    check("S-3", "a POSITIVE figure on the same page is not given a sign it does not have",
          by_label.get("Transmitter output power, each lane (maximum)") == "4 dBm",
          by_label.get("Transmitter output power, each lane (maximum)"))
    lr4 = {f["label"]: f["value"] for f in res["facts"]}
    check("S-4", "a RANGE keeps its own minus: storage temperature is '-40 C to 85 C', so the "
                 "fold must handle a leading sign inside a range as well as a bare value",
          (lr4.get("Storage temperature") or "").startswith("-40"), lr4.get("Storage temperature"))
    check("S-5", "SABOTAGE no fact still contains a raw en dash, em dash or minus sign next to a "
                 "digit - one survivor is one silently wrong sign",
          not [f for f in (res["facts"] + xen["facts"])
               if any(c in f["value"] for c in "–—−")],
          [f["value"] for f in (res["facts"] + xen["facts"])
           if any(c in f["value"] for c in "–—−")][:3])

    # -----------------------------------------------------------------------------------------
    # 8. discover() - a listing finds work; a model page finds none
    # -----------------------------------------------------------------------------------------
    found = MOD.discover(LISTING, {"task": "listing", "key": "100001"})
    keys = [f["key"] for f in found]
    check("D1", "the transceiver listing discovers a part-page task per model - 488 of them",
          len(found) > 400 and all(f["task"] == "part-page" for f in found), len(found))
    check("D2", "each discovered task carries the model URL it resolves to",
          all(f["url"].startswith("https://apps.juniper.net/hct/model/") for f in found),
          found[0] if found else None)
    check("D3", "no model number is discovered twice", len(keys) == len(set(keys)),
          f"{len(keys)} keys, {len(set(keys))} unique")
    check("D4", "SABOTAGE a MODEL PAGE discovers nothing: it names every platform and line card "
                "the optic works with, and queueing those walks the whole HCT graph out of the "
                "transceiver category into hardware no part row exists for",
          MOD.discover(REAL, {"task": "part-page", "key": "CFP-GEN2-100GBASE-LR4"}) == [],
          MOD.discover(REAL, {"task": "part-page", "key": "CFP-GEN2-100GBASE-LR4"}))
    check("D5", "SABOTAGE supported PLATFORM names are never queued as models - MX960 is a "
                "relation, and a relation is not a work item",
          not any(k.startswith(("MX", "PTX", "ACX", "SRX", "EX9")) and "-" not in k for k in keys),
          [k for k in keys if k.startswith(("MX", "PTX")) and "-" not in k][:5])
    check("D6", "SABOTAGE unparseable HTML discovers nothing rather than killing the lane",
          MOD.discover("<<<>>> not html", {"task": "listing", "key": "100001"}) == [])
    check("D7", "a listing produces no FACTS of its own: it publishes fewer fields than the model "
                "page, so writing the thin version first would create a fact the fuller page has "
                "to supersede for every model on every crawl",
          MOD.extract(LISTING, {"task": "listing", "key": "100001"})["facts"] == [])

    # -----------------------------------------------------------------------------------------
    # 9. the overlap this whole pack is built on, re-measured from the cached listing
    # -----------------------------------------------------------------------------------------
    check("C1", "the listing carries the 488 models the coverage target was computed from - if "
                "this number moves, brand.py's target of 103 needs recomputing, not explaining",
          480 <= len(found) <= 500, len(found))

# ---------------------------------------------------------------------------------------------
# 10. the watchdog's provenance rule - the defect it found in its own first output
# ---------------------------------------------------------------------------------------------
# On 5 Sep 2026 the metric was written as "a fact with a doc_id", which is the obvious reading and
# is wrong: 1,144 of Juniper's 1,312 tier-0 seed facts are stamped with the doc_id of a
# documentation landing page nobody ever extracted from, so the first report announced that 100%
# of Juniper had been read from a document when the true figure was 0%. The rule now lives in a
# pure function precisely so these four lines can exist - a rule expressed only as a WHERE clause
# is a rule nothing can assert.
sys.path.insert(0, str(ROOT / "scraper" / "brands" / "juniper"))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "juniper_watchdog", ROOT / "scraper" / "brands" / "juniper" / "watchdog.py")
_wd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_wd)

check("W1", "a part whose only facts are seed is SEED ONLY, whatever doc_id those facts carry - "
            "the provenance of a fact is its METHOD, and a doc_id is a pointer that can be wrong",
      _wd.bucket(has_doc_nonseed=False, has_nonseed=False, has_any=True) == "seed_only",
      _wd.bucket(False, False, True))
check("W2", "a part with a real extraction against a document is FROM_DOCUMENT",
      _wd.bucket(True, True, True) == "from_document")
check("W3", "a non-seed fact with no document is its own bucket, never counted as read - "
            "product_name_mining reads the product name we already stored, which is the catalogue "
            "talking to itself",
      _wd.bucket(False, True, True) == "other_non_seed")
check("W4", "a part with no facts is not silently a seed part", _wd.bucket(False, False, False) == "no_facts")
check("W5", "SABOTAGE the seed method is named in SEED_METHODS - if it is ever dropped from that "
            "list the report claims 100% read for a brand nothing was read from",
      "hexcat_seed" in _wd.SEED_METHODS, _wd.SEED_METHODS)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
