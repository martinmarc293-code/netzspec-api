"""tests/scraper/test_reextract.py - proof for the cache-only re-extract.

    python3.11 tests/scraper/test_reextract.py

No database and no network: both properties under test are pure.

WHY THESE TWO. The script's whole value is telling "this corpus has nothing to give" apart from
"the extractor regressed", and exactly two things can make it lie about that.

`total_facts` is the count the answer rests on. Counting only the top-level subject is a mistake
this project has already paid for once: a datasheet describes a family AND its models, the RESULT
shape puts one subject on top and the rest in `others`, and which lands on top is an accident of
the adapter's grouping. A document that produced 1,430 facts reported `no_facts` that way (HPE
psnow a00073540enw, 5 Sep 2026) - so an undercount here would read as "nothing to recover" about a
corpus that was full.

The source refusal is the other half. Which adapter produced a document is not recoverable after
the fact - only 58 of Cisco's 1,781 spec documents still have a `fetches` row matching their URL -
so an adapter that declares no DOC_CLASSES or no host must stop the run rather than fall back to
selecting everything. Selecting the wrong documents would re-extract one lane's pages with another
lane's parser and report the emptiness as a fact about the corpus.
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_rx", str(ROOT / "scripts" / "reextract-from-cache.py"))
RX = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RX)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:84]:86}" + ("" if ok else f" | got {str(got)[:150]}"))


check("R1", "the top-level subject's facts are counted",
      RX.total_facts({"facts": [1, 2, 3]}) == 3, RX.total_facts({"facts": [1, 2, 3]}))
check("R2", "SABOTAGE facts in `others` are counted TOO - a series datasheet keeps its models "
            "there, and counting only the top level reported no_facts for a document that produced "
            "1,430",
      RX.total_facts({"facts": [1], "others": [{"facts": [1, 2]}, {"facts": [3]}]}) == 4,
      RX.total_facts({"facts": [1], "others": [{"facts": [1, 2]}, {"facts": [3]}]}))
check("R3", "a document with facts ONLY in others is not reported as empty - the primary subject "
            "being the family is the normal shape, not an edge case",
      RX.total_facts({"facts": [], "others": [{"facts": [1, 2]}]}) == 2)
check("R4", "SABOTAGE a genuinely empty result is 0, so the count cannot manufacture work",
      RX.total_facts({}) == 0 and RX.total_facts({"facts": [], "others": []}) == 0)
check("R5", "SABOTAGE a None in `others` does not crash the count - an adapter that emits a hole "
            "must not take the diagnostic down with it",
      RX.total_facts({"facts": [1], "others": [None, {"facts": [2]}]}) == 2)
check("R6", "SABOTAGE a missing `facts` key inside an `others` entry counts as none, not as an "
            "exception", RX.total_facts({"others": [{"sku": "X"}]}) == 0)

SRC = (ROOT / "scripts" / "reextract-from-cache.py").read_text(encoding="utf-8")
check("R7", "an adapter that declares no DOC_CLASSES or no host REFUSES the run rather than "
            "selecting every document in the store",
      "Refusing to guess" in SRC and "if not classes or not hosts:" in SRC)
check("R8", "...and selection is scoped by the adapter's OWN declared classes and hosts, never by "
            "a URL substring - `url ILIKE '%cisco%'` once swept in an aggregator republishing "
            "Cisco specs under a Data Sheet title",
      "doc_type::text = ANY(%s)" in SRC and "urlsplit(r[\"url\"]).hostname not in hosts" in SRC)
check("R9", "a document whose bytes are GONE is left to RECOVER rather than silently counted as "
            "empty here - the two are different repairs",
      'is_file()' in SRC and "that is RECOVER's job" in SRC)
check("R10", "SABOTAGE the default output is NOT the directory the supervisor applies from, so a "
             "diagnostic run cannot become a production write by accident",
      'ap.add_argument("--into-today"' in SRC
      and SRC.index('"reextract"') > 0
      and "THIS LEADS TO A PRODUCTION WRITE" in SRC)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
