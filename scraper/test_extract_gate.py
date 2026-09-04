"""scraper/test_extract_gate.py — WP7, extraction layer.

The four sabotage cases whose defect can only occur inside the table parsers: a shifted header,
a table split across a page break, a colspan misalignment, and a page served in the wrong
language. Asserting these in the TypeScript suite would prove nothing about the code that can
actually fail, so they live here, driven against synthetic HTML.

Run: python scraper/test_extract_gate.py
"""
from __future__ import annotations
import sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters.cisco_specs_deep import parse_shape_a, assert_english, _rows  # noqa: E402

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("bs4 missing"); raise SystemExit(2)

results = []
npass = nfail = 0


def check(cid: str, defect: str, expected: str, got: str) -> None:
    global npass, nfail
    ok = got == expected
    if ok:
        npass += 1
    else:
        nfail += 1
    results.append(f"{'PASS' if ok else 'FAIL'} | {cid:4} | {defect[:48]:50} | expected {expected:24} | got {got}")


def rows_of(html: str):
    return _rows(BeautifulSoup(html, "lxml").find("table"))


def codes(defects, recs):
    if recs:
        return f"STORED_{len(recs)}_FIELDS"
    return defects[0]["code"] if defects else "SILENT_DROP"


# ---- S1 — header row shifted down one -------------------------------------------------------
# Row 0 should be "Model | Switching capacity | Forwarding rate" but a PID sits there instead.
# A stateless parser would treat "C9300-48P" as a column name and file every value under it.
S1_HTML = """<table>
<tr><td>C9300-48P</td><td>256 Gbps</td><td>190.47 Mpps</td></tr>
<tr><td>Model</td><td>Switching capacity</td><td>Forwarding rate</td></tr>
<tr><td>C9300-24P</td><td>128 Gbps</td><td>95.23 Mpps</td></tr>
</table>"""
d1: list = []
r1 = parse_shape_a(rows_of(S1_HTML), 0, "http://x", d1)
check("S1", "header row shifted down one", "SCHEMA_MATCH_LOW", codes(d1, r1))

# ---- S2 — table split across a page break, leaving a half row ---------------------------------
S2_HTML = """<table>
<tr><td>Model</td><td>Switching capacity</td><td>Forwarding rate</td><td>PoE budget</td></tr>
<tr><td>C9300-48P</td><td>256 Gbps</td><td>190.47 Mpps</td><td>822W</td></tr>
<tr><td>C9300-24P</td><td>128 Gbps</td></tr>
</table>"""
d2: list = []
r2 = parse_shape_a(rows_of(S2_HTML), 0, "http://x", d2)
half_row_rejected = any(x["code"] == "TABLE_SPLIT_DETECTED" for x in d2)
good_row_kept = any(x["sku"] == "C9300-48P" for x in r2)
check("S2", "half row from a table split across a page break",
      "SPLIT_REJECTED_REST_KEPT",
      "SPLIT_REJECTED_REST_KEPT" if (half_row_rejected and good_row_kept) else
      f"split={half_row_rejected}/kept={good_row_kept}")

# ---- S14 — colspan misalignment ----------------------------------------------------------------
# The extra cell shifts every value one column left; "190.47 Mpps" would be stored as the
# switching capacity. The row arity check catches it.
S14_HTML = """<table>
<tr><td>Model</td><td>Switching capacity</td><td>Forwarding rate</td></tr>
<tr><td>C9300-48P</td><td>extra merged cell</td><td>256 Gbps</td><td>190.47 Mpps</td></tr>
</table>"""
d14: list = []
r14 = parse_shape_a(rows_of(S14_HTML), 0, "http://x", d14)
check("S14", "colspan misalignment shifts values one column", "GRID_MISALIGNED", codes(d14, r14))

# ---- S15 — page served in German despite the forced en-US locale -----------------------------
DE = "<html><body><h1>Datenblatt</h1><h2>Technische Daten</h2><p>Produktübersicht</p></body></html>"
try:
    assert_english(DE)
    got = "ACCEPTED"
except ValueError as e:
    got = "LOCALE_MISMATCH" if "LOCALE_MISMATCH" in str(e) else "OTHER"
check("S15", "German page returned despite forced en-US", "LOCALE_MISMATCH", got)

# ---- control case: a well-formed table must still parse ----------------------------------------
OK_HTML = """<table>
<tr><td>Model</td><td>Switching capacity</td><td>Forwarding rate</td></tr>
<tr><td>C9300-48P</td><td>256 Gbps</td><td>190.47 Mpps</td></tr>
</table>"""
dc: list = []
rc = parse_shape_a(rows_of(OK_HTML), 0, "http://x", dc)
check("S19", "well-formed table (control case)", "STORED_2_FIELDS", codes(dc, rc))
# and the English guard must not fire on an English page
try:
    assert_english("<html><body><h1>Data Sheet</h1><p>Product Overview</p></body></html>")
    got = "ACCEPTED"
except ValueError:
    got = "FALSE_POSITIVE"
check("S20", "English page (control case)", "ACCEPTED", got)

# ---- S21 — the part-number test must accept real PIDs and reject prose --------------------------
# Every REJECT below was observed in a real Cisco ordering column, and every ACCEPT that is marked
# was at some point wrongly rejected: "CBS350-8T-E-2G-xx" by an upper-case-only shape rule (losing
# the entire Cisco Business SMB range) and "ACI-VPOD-MGMT=" by a rule demanding a digit.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("_ec", str(Path(__file__).resolve().parent / "enumerate_cisco.py"))
_ec = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_ec)

PID_CASES = [
    ("C9300-24P", True), ("WS-C3850-48P", True), ("SFP-10G-SR", True), ("GLC-TE", True),
    ("PWR-C1-715WAC-P", True), ("UCSC-C220-M5SX", True), ("ISR4331/K9", True),
    ("CBS350-8T-E-2G-xx", True),   # region placeholder is lower case
    ("ACI-VPOD-MGMT=", True),      # no digit anywhere
    ("802.11ac", False), ("Security", False), ("Gigabit Ethernet", False),
    ("Maximum clients", False), ("Trustworthy solutions", False), ("IEEE 802.3", False),
    ("N/A", False), ("2.5", False),
]
bad = [(t, e) for t, e in PID_CASES if _ec.is_pid(t) != e]
check("S21", "part-number test vs 17 real accepts/rejects",
      "17/17", f"{len(PID_CASES) - len(bad)}/{len(PID_CASES)}" + (f" (wrong: {bad[:3]})" if bad else ""))

# ---- the LIST RULE and COLUMN SELECTION, against real cached datasheets -----------------------
# Shard 0 produced 20,716 (part, field) collisions, 14,433 of them differing after normalisation.
# They are not 14,433 disagreements: the datasheet spreads ONE list over several cells, and the
# C9350's PSU table was read a column at a time with no idea which column belonged to the model.
# The two documents below are the ones the finding was written from, so they are the ones the rule
# is proved on. They are read from the cache; a missing cache is a FAILED case, never a skipped
# one — "could not check" is not "is correct" (D:\Project\CLAUDE.md §6).
import hashlib  # noqa: E402
from adapters.cisco_specs_deep import (  # noqa: E402
    parse_shape_a, parse_shape_b, parse_shape_c, join_list_fragments, shape_a_columns,
)
import adapters.cisco_specs_deep as _deep  # noqa: E402

CACHE = Path(__file__).resolve().parent / "cache"
# https://www.cisco.com/site/us/en/products/collateral/networking/switches/c9350-series-smart-switches-ds.html
C9350_DOC = "667a16f06f215262b19a454a16f8b5c9788566dd"
# .../switches/catalyst-2960-x-series-switches/datasheet-c78-728232.html
C2960X_DOC = "be25fa2199c092517cecbc1a693b53b44cf2d884"


def parse_cached(doc: str, table: int):
    """Every record the three shapes produce for ONE table of a cached datasheet, list rule applied."""
    p = CACHE / (doc + ".html")
    if not p.exists():
        return None, None
    soup = BeautifulSoup(p.read_text(encoding="utf-8", errors="replace"), "lxml")
    tables = soup.find_all("table")
    if table >= len(tables):
        return None, None
    rows = _deep._rows(tables[table])
    out, defects = [], []
    for fn in (parse_shape_a, parse_shape_b, parse_shape_c):
        recs = fn(rows, table, "u", defects) if fn is parse_shape_a else fn(rows, table, "u")
        out.extend(join_list_fragments(recs, defects))
    return out, defects


# ---- S22 — the C9350 PSU table: both power supplies are ONE list for the model -----------------
# t6 repeats C9350-24P on rows 4 and 5 because the rows are CONFIGURATIONS, not models. The apply
# kept PWR-C2-850WAC from t6:r4:c1 and logged PWR-C2-1600WAC from t6:r5:c1 as a conflict, then
# discarded it. Both are options of the same switch.
recs, defs22 = parse_cached(C9350_DOC, 6)
if recs is None:
    got = "NO_CACHED_DOCUMENT"
else:
    psu = [r for r in recs if r.get("sku") == "C9350-24P" and r["label"] == "Primary power supply"]
    got = "NO_RECORD" if len(psu) != 1 else psu[0]["value"]
check("S22", "C9350-24P: two PSU rows are one list, not two facts",
      "PWR-C2-850WAC; PWR-C2-1600WAC", got)
if recs is not None:
    span = [f["locator"] for f in psu[0].get("fragments", [])] if len(psu) == 1 else []
    check("S22b", "the joined fact keeps the first locator and a span",
          "t6:r4:c1 <- t6:r4:c1,t6:r5:c1",
          f"{psu[0]['locator']} <- {','.join(span)}" if span else "NO_SPAN")

# ---- S23 — the row-discriminator column must not become a fact --------------------------------
# "Default or upgrade" holds exactly "Default" and "Upgrade": it says which configuration the row
# is. It aliases to psu_options, so every C9350 row published `psu_options = Default`.
if recs is None:
    got = "NO_CACHED_DOCUMENT"
else:
    leaked = [r["value"] for r in recs if r["label"].startswith("Default or upgrade")]
    got = "REFUSED" if not leaked and any(d["code"] == "ROW_DISCRIMINATOR_COLUMN" for d in defs22) else f"LEAKED_{leaked[:2]}"
check("S23", 'the "Default or upgrade" discriminator column', "REFUSED", got)

# ---- S24 — a group header refined by a MAGNITUDE names a condition, not the attribute ---------
# t6 columns 4-9 are "Secondary PSU / 500W|850W|1600W": the cells hold available PoE ("720*W"),
# and filing them under the group header published `psu_options = 720*W`.
if recs is None:
    got = "NO_CACHED_DOCUMENT"
else:
    leaked = [r["label"] for r in recs if r["label"].startswith(("Secondary PSU", "Tertiary PSU"))]
    n = sum(1 for d in defs22 if d["code"] == "GROUP_HEADER_IS_CONDITION")
    got = f"REFUSED_{n}_COLUMNS" if not leaked else f"LEAKED_{leaked[:2]}"
check("S24", "Secondary/Tertiary PSU condition columns", "REFUSED_6_COLUMNS", got)

# ---- S24b — a two-row header must NOT be read as a data row, and must name its columns ---------
if recs is None:
    got = "NO_CACHED_DOCUMENT"
else:
    p = CACHE / (C9350_DOC + ".html")
    rows6 = _deep._rows(BeautifulSoup(p.read_text(encoding="utf-8", errors="replace"), "lxml").find_all("table")[6])
    labels, first_data = shape_a_columns(rows6, 6, [])
    got = f"{first_data}:{labels[1]}"
check("S24b", "continuation header row detected, data starts after it",
      "2:Primary power supply", got)

# ---- S25 — one bulleted list laid across two columns of one row --------------------------------
# 2960-X t18 is "Category | Specification | Specification": r3c1 holds half the IEEE standards and
# r3c2 the other half. Read as two facts they became 6,005 of shard 0's differing collisions.
recs25, _ = parse_cached(C2960X_DOC, 18)
if recs25 is None:
    got = "NO_CACHED_DOCUMENT"
else:
    std = [r for r in recs25 if r["label"] == "Standards"]
    got = "NO_RECORD" if len(std) != 1 else (
        f"ONE_FACT_{len(std[0].get('fragments', []))}_CELLS"
        if "802.1D" in std[0]["value"] and "802.3 10BASE-T" in std[0]["value"] else "HALF_THE_LIST")
check("S25", "IEEE standards split across two columns of one row", "ONE_FACT_2_CELLS", got)

# ---- S26 (SABOTAGE) — a repeated label that is NOT a list must NOT be joined -------------------
# Joining every repeated (subject, label) in a table would have folded 75 cells of a header row
# read as data into one `switching_capacity` value, measured over shard 0. Only a bulleted cell or
# a repeated model row is a list.
NOT_A_LIST = [
    {"family_scope": "__document__", "label": "Unit weight", "value": "Model", "shape": "B", "locator": "t1:r39:c1", "source_url": "u"},
    {"family_scope": "__document__", "label": "Unit weight", "value": "1.39 kg", "shape": "B", "locator": "t1:r39:c2", "source_url": "u"},
]
joined = join_list_fragments(list(NOT_A_LIST))
check("S26", "two plain cells under one label are NOT joined", "2_FACTS_KEPT",
      f"{len(joined)}_FACTS_KEPT" if len(joined) != 1 else f"WRONGLY_JOINED_{joined[0]['value']!r}")

# ---- S27 — control: two BULLETED cells under one label ARE joined, in document order -----------
A_LIST = [
    {"family_scope": "__document__", "label": "Standards", "value": "\u25cf IEEE 802.1D \u25cf IEEE 802.1p", "shape": "B", "locator": "t2:r1:c1", "source_url": "u"},
    {"family_scope": "__document__", "label": "Standards", "value": "\u25cf IEEE 802.3 \u25cf IEEE 802.3u", "shape": "B", "locator": "t2:r1:c2", "source_url": "u"},
]
j27 = join_list_fragments(list(A_LIST))
check("S27", "two bulleted cells under one label are one list (control)",
      "\u25cf IEEE 802.1D \u25cf IEEE 802.1p; \u25cf IEEE 802.3 \u25cf IEEE 802.3u",
      j27[0]["value"] if len(j27) == 1 else f"{len(j27)}_FACTS")

# ---- S28 (SABOTAGE) — a list belonging to a DIFFERENT subject must never be joined into it -----
TWO_SUBJECTS = [
    {"sku": "C9350-24P", "label": "Standards", "value": "\u25cf A \u25cf B", "shape": "A", "locator": "t2:r1:c1", "source_url": "u", "_repeated_model": True},
    {"sku": "C9350-48P", "label": "Standards", "value": "\u25cf C \u25cf D", "shape": "A", "locator": "t2:r2:c1", "source_url": "u", "_repeated_model": True},
]
j28 = join_list_fragments(list(TWO_SUBJECTS))
check("S28", "same label, DIFFERENT models: never one list", "2_FACTS",
      f"{len(j28)}_FACTS" if len(j28) != 1 else f"MERGED_ACROSS_MODELS_{j28[0]['value']!r}")

print("case | defect                                             | expected                 | got")
print("-" * 128)
for r in results:
    print(r)
print(f"\nextraction gate: {npass}/{npass + nfail} passed")
raise SystemExit(1 if nfail else 0)
