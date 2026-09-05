"""tests/scraper/test_cisco_eol_lane.py — proof for scraper/sources/cisco_eol.py.

    python3.11 tests/scraper/test_cisco_eol_lane.py

No database, no network: every case runs against a bulletin already in the cache, or a string.

WHY THIS LANE EXISTS AT ALL. The `cisco-eol` source row has existed since the schema was created
with no adapter behind it, so `load_source("cisco-eol")` raised and the lane could never run -
which is why the Cisco pack's DAILY schedule item ("eol-bulletins") had nothing to execute. It is
the pack's daily class because a bulletin APPEARING is news the same day: a part that went
end-of-sale this morning is a part somebody must stop quoting.

WHAT THE CASES ARE ABOUT. A bulletin publishes NO specifications - it is a milestone table and a
table of affected PIDs. So the interesting assertions are not "did it find facts" but "did it
refuse to invent any", "did every affected part become its own subject rather than the lifecycle
being pinned to whichever PID was first", and "does a notice with no milestone table report
not_listed instead of an error".
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


from sources import load_source  # noqa: E402

try:
    MOD = load_source("cisco-eol")
    check("R0", "load_source('cisco-eol') resolves — the row existed for the project's whole life "
                "with no adapter, so the pack's DAILY item had nothing to run", True)
except Exception as e:  # noqa
    check("R0", "load_source('cisco-eol') resolves", False, f"{type(e).__name__}: {e}")
    print("\n0 passed, 1 missed")
    raise SystemExit(1)

check("R1", "the module declares the slug the database uses", MOD.SLUG == "cisco-eol", MOD.SLUG)
for fn in ("resolve", "extract", "discover", "is_blocked", "is_not_found", "is_usable"):
    check(f"R2:{fn}", f"the source contract is complete: {fn}()", callable(getattr(MOD, fn, None)))

# ---- resolve -----------------------------------------------------------------------------------
B = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-2960-series-switches/eos-eol-notice-c51-738597.html"
check("S1", "a bulletin URL resolves", MOD.resolve({"task": "datasheet", "key": B}) == B)
check("S2", "a listing resolves the same way", MOD.resolve({"task": "listing", "key": B}) == B)
check("S3", "SABOTAGE a SKU-keyed task is refused — a PID does not resolve to a bulletin URL, it "
            "is FOUND in one, and a guess is a 404 the queue retries five times",
      MOD.resolve({"task": "part-page", "key": "WS-C2960-24TC-L"}) is None)
check("S4", "SABOTAGE a non-URL key is refused rather than joined to the host",
      MOD.resolve({"task": "datasheet", "key": "EOL13418"}) is None)

# ---- blocked / usable --------------------------------------------------------------------------
AKAMAI = ("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>"
          "You don't have permission to access this on this server. Reference #18.2f4c\n</BODY></HTML>")
check("B1", "the Akamai refusal is a block", MOD.is_blocked(AKAMAI) is True)
BIG = "<html><title>Cisco Secure Firewall</title><body><table><tr><td>Access Denied logging</td></tr></table>" \
      + ("<p>spec text.</p>" * 900) + "</body></html>"
check("B2", "SABOTAGE a REAL page containing the words 'Access Denied' is not a block",
      MOD.is_blocked(BIG) is False, f"len={len(BIG)}")
check("U1", "a rendered bulletin is usable — it always has a milestone table", MOD.is_usable(BIG) is True)
check("U2", "SABOTAGE a shell with the right title and no table is NOT usable, so it never reaches "
            "the cache to be served back on every retry",
      MOD.is_usable("<html><title>End-of-Sale and End-of-Life Announcement</title><body>"
                    + ("<span>x</span>" * 300) + "</body></html>") is False)
check("U3", "SABOTAGE an empty body is not usable", MOD.is_usable("") is False)

# ---- discover ----------------------------------------------------------------------------------
LISTING = ('<html><body>'
           '<a href="/c/en/us/products/collateral/switches/catalyst-2960-series-switches/eos-eol-notice-c51-738597.html">a</a>'
           '<a href="/c/en/us/products/collateral/switches/x/end_of_life_notice_c51-685441.html">b</a>'
           '<a href="/c/en/us/products/collateral/switches/x/nb-06-cat9200-ser-data-sheet-cte-en.html">datasheet</a>'
           '<a href="https://www.youtube.com/watch?v=1">video</a>'
           '</body></html>')
found = MOD.discover(LISTING, {"task": "listing", "key": "https://www.cisco.com/c/en/us/products/switches/eol.html"})
keys = [f["key"] for f in found]
check("D1", "a listing discovers the bulletins it links, in both spellings Cisco publishes",
      any("eos-eol-notice" in k for k in keys) and any("end_of_life_notice" in k for k in keys), keys)
check("D2", "SABOTAGE a DATASHEET link is not queued as a bulletin — this lane's class carries no "
            "specifications and the datasheet lane is what wants that URL",
      not any("data-sheet" in k for k in keys), keys)
check("D3", "SABOTAGE an off-site link is never queued", not any("youtube" in k for k in keys), keys)
check("D4", "SABOTAGE a BULLETIN discovers nothing: content pages link their family's collateral, "
            "and discovering from them queued a translated-documents tree on the Meraki lane",
      MOD.discover(LISTING, {"task": "datasheet", "key": B}) == [])

# ---- extract, over a REAL cached bulletin ------------------------------------------------------
cached = None
for name in os.listdir(CACHE) if CACHE.is_dir() else []:
    if not name.endswith(".html"):
        continue
    p = CACHE / name
    try:
        head = p.open("rb").read(200_000).decode("utf-8", "replace")
    except OSError:
        continue
    if "End-of-Sale" in head and "<table" in head.lower() and "EOL" in head:
        cached = (p, head)
        break

if cached is None:
    check("E0", "a real EoL bulletin is in the cache to test against", False, "none found")
else:
    path, html = cached
    res = MOD.extract(html, {"task": "datasheet", "key": B})
    if res.get("not_listed"):
        check("E1", "the cached bulletin parsed into affected parts", False,
              f"not_listed on {path.name}")
    else:
        subjects = [res] + (res.get("others") or [])
        check("E1", "every affected PID becomes its OWN subject, not just the first one",
              len(subjects) >= 2, f"{len(subjects)} subjects from {path.name}")
        check("E2", "NO facts are invented — a bulletin publishes no specification, and saying zero "
                    "is the point of this lane",
              all((s.get("facts") or []) == [] for s in subjects))
        check("E3", "every subject carries the bulletin's lifecycle, not only the first",
              all(s.get("lifecycle") for s in subjects), str(subjects[0].get("lifecycle"))[:100])
        check("E4", "the lifecycle names its bulletin and its source URL, so a date can be traced "
                    "back to the document that announced it",
              bool((res.get("lifecycle") or {}).get("source_url")), str(res.get("lifecycle"))[:120])
        succ = [s for s in subjects if s.get("relations")]
        check("E5", "a named replacement becomes a successor relation on THAT part",
              all(r["kind"] == "successor" and r.get("sku") for s in succ for r in s["relations"]),
              str(succ[0]["relations"] if succ else "no successors in this bulletin"))
        check("E6", "SABOTAGE a part is never its own successor",
              all(r.get("sku") != s["sku"] for s in succ for r in s["relations"]))
        check("E7", "the document's affected-PID list rides along for inheritance scope",
              isinstance(res.get("document_pids"), list) and len(res["document_pids"]) == len(subjects),
              f"{len(res.get('document_pids') or [])} vs {len(subjects)}")

# a notice that announces a notice: no milestone table, and that is not an error
check("E8", "SABOTAGE a bulletin with no milestone table reports not_listed, not an exception — "
            "Cisco publishes notices that announce a notice",
      MOD.extract("<html><body><p>An end-of-life announcement will follow.</p></body></html>",
                  {"task": "datasheet", "key": B}).get("not_listed") is True)

# and the counter that decides the outcome must see every subject
import worker as W  # noqa: E402
if cached is not None and not res.get("not_listed"):
    check("E9", "worker.total_facts sees every subject and still reports ZERO for a bulletin — the "
                "lane's yield is lifecycle, and a wrong non-zero would read as extracted specs",
          W.total_facts(res) == 0, str(W.total_facts(res)))

# ---------------------------------------------------------------------------------------------
# 7. a 404 is TERMINAL, however large the page it arrives on
# ---------------------------------------------------------------------------------------------
# Measured on this lane's first live run: six EoL notices that no longer exist came back at HTTP
# 404 with 353,012 bytes of Cisco navigation chrome and no table. is_not_found had a 60 KB size
# guard, which a third of a megabyte sails past, so they were recorded as retryable failures
# instead of gone.
BIG_404 = ("<html><head><title>Page Not Found</title></head><body>"
           + ("<nav><a href='/x'>Products</a></nav>" * 4000)
           + "<h1>We can't find the page you are looking for</h1></body></html>")
check("N1", "SABOTAGE Cisco's real 404 shape - a third of a megabyte, no table - is still "
            "recognised as not-found; ANY size guard hands it to the retry loop for ever",
      MOD.is_not_found(BIG_404) is True, f"len={len(BIG_404)}")
check("N2", "...and the usability veto refuses it too, so a 404 page never reaches the cache to be "
            "served back as if it were the document",
      MOD.is_usable(BIG_404) is False)
check("N3", "SABOTAGE a real bulletin is not called not-found merely for being large",
      MOD.is_not_found(BIG) is False)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
