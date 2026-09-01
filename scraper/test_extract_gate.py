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

print("case | defect                                             | expected                 | got")
print("-" * 128)
for r in results:
    print(r)
print(f"\nextraction gate: {npass}/{npass + nfail} passed")
raise SystemExit(1 if nfail else 0)
