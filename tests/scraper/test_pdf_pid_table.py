"""cisco_specs_pdf.pid_table_pids: the document's PID list from its two-column ordering tables (reviewer ruling, 30 Sep 2026:
a PID enters the list only if it matches the SKU grammar AND exists in the catalogue; the hit rate shows a misread column).
The header and row shapes are the real c220m7-sff-specsheet.pdf page 17 table, as pdfplumber returns it.

    python3.11 tests/scraper/test_pdf_pid_table.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scraper"))
from adapters.cisco_specs_pdf import _norm_pid, pid_table_pids  # noqa: E402

CAT = {_norm_pid(s) for s in ("UCS-M7-MLB", "UCSC-C220-M7S", "UCSC-C220-M7N")}
REAL = [["Product ID (PID)", "Description"],
        ["UCS-M7-MLB", "UCS M7 RACK, BLADE MLB\nThis major line bundle (MLB) consists of the Rack Server (UCSC-C220-M7S or"],
        ["UCSC-C220-M7S\nUCSC-C220-M7N", "Rack server, small / NVMe front"],
        ["UCSC-C220-M7S1", "a footnote digit glued to a real PID"],
        ["Note", "a heading row inside the table"]]


def run(rows, cat=CAT):
    got = pid_table_pids(rows, cat)
    return None if got is None else (sorted(got[0]), sorted(got[1]))


CASES = [
    ("the real ordering table: every grammar-valid token is read", run(REAL)[0],
     ["UCS-M7-MLB", "UCSC-C220-M7N", "UCSC-C220-M7S", "UCSC-C220-M7S1"]),
    ("...and only the catalogue's enter the list (the footnote variant does not)", run(REAL)[1],
     ["UCS-M7-MLB", "UCSC-C220-M7N", "UCSC-C220-M7S"]),
    ("no catalogue: nothing is listed, the read count still shows", run(REAL, set())[1], []),
    ("case and dashes do not separate a PID from its catalogue entry", run([["PID", "Description"], ["ucsc-c220-m7s", "x"]])[1],
     ["ucsc-c220-m7s"]),
    ("a three-column table is not an ordering table (the grid shape's job)",
     run([["Product ID", "Description", "Qty"], ["UCS-M7-MLB", "x", "1"]]), None),
    ("a Parameter | Value table is not an ordering table", run([["Parameter", "Value"], ["Weight", "10 kg"]]), None),
    ("a Description | Value table is not an ordering table", run([["Description", "Value"], ["UCS-M7-MLB", "x"]]), None),
    ("a header row alone is not a table", run([["Product ID (PID)", "Description"]]), None),
]


def main() -> int:
    miss = 0
    for name, got, want in CASES:
        if got != want:
            miss += 1
            print(f"MISS | {name}: got {got!r}, want {want!r}")
    print(f"pdf pid table: {len(CASES) - miss} passed, {miss} missed")
    return 1 if miss else 0


if __name__ == "__main__":
    raise SystemExit(main())
