"""tests/scraper/test_cisco_specs_pdf.py — the PDF reader that cisco_specs_pdf AND the gate's
provenance auditor both read a page through.

    python3.11 tests/scraper/test_cisco_specs_pdf.py

WHAT WENT WRONG (4 Sep 2026). `ingest gate-extract runs/extract/cisco-pdf-2026-09-04.json
--sample 60 --tag pdf` reported precision 100%, recall 100%, golden 18/18 — and provenance
40/60 clean, 20 mismatched. Every one of the 20 held the RIGHT value at the RIGHT locator: the
cell re-read equal to the stored value in all twenty. Two separate faults, on opposite sides:

  the RE-READ (all 20 of the reported misses)
    A PDF wraps a table cell onto a second line, and extract_text renders the page line by line
    ACROSS every column — so the two halves of one cell are never adjacent in the page text, the
    neighbouring columns sit between them. `value in text` therefore fails on any cell that
    wrapped (12 of the 20) and `label in text` on any header that wrapped ("Cache" / "Size (MB)",
    "Maximum" / "Socket" — the other 8).

  the EXTRACTOR (found while diagnosing them, not reported by the gate at all)
    Cisco glues footnote references to the token they annotate as a raised, smaller digit.
    pdfplumber hands them back as ordinary characters, so they arrive inside the value
    ("w/Secure Boot5"), inside the label ("UPI1 Links", "Card Size1") and inside the PART
    NUMBER: UCSX-GPU-RTXP45003 is UCSX-GPU-RTXP4500 with footnote 3. 156 fabricated PIDs
    carrying 792 facts, and the PDF-derived ground-truth maps had learned them from the same
    text, so _is_pid confirmed every one.
    And `val[:160]` cut 50 values mid-word — "... KS C 9832 Cla", "... the Cisco Compute
    Hyperco" — with nothing recording that anything had been cut.

SABOTAGE (CLAUDE.md § Proof rules — a check that has never failed is not a check):
  * a raised, smaller digit is stripped; the SAME digit at full size on the same baseline is
    kept, so QSFP56, 15427, 2Rx4, RTXP4500 and DISK-MODE-RAID-10 survive;
  * a value one digit different from the page still FAILS the wrap-tolerant text test, and the
    test is shown failing on it BEFORE the wrap rule could have passed it;
  * a cell longer than the cap ends at a word boundary and is FLAGGED, and a cap that silently
    cut mid-word is rejected.
The geometry cases below are read from the real cached PDFs, so a rule that only works on a
hand-built fixture cannot pass (CLAUDE.md: run it over the real corpus and read the output).
"""
from __future__ import annotations
import hashlib
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
from adapters.cisco_specs_pdf import (  # noqa: E402
    BLEED_MIN_ROWS, LABEL_CAP, VALUE_CAP, cap_value, column_bleed, footnote_marker_chars,
    read_page, text_contains, text_lines,
)

npass = nfail = 0


def check(what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
        print(f"  MISS {what}" + (f" — got {got}" if got else ""))


# ==================================================================================================
# 1. cap_value — a cell longer than the cap ends at a word boundary AND says so
# ==================================================================================================
print("cap_value")
check("a value inside the cap is untouched and not flagged", cap_value("short value") == ("short value", False))
check("a value exactly at the cap is untouched", cap_value("x" * VALUE_CAP) == ("x" * VALUE_CAP, False))

long_real = ("47CFR Part 15 (CFR 47) Class A AS/NZS CISPR32 Class A CISPR32 Class A EN55032 Class A "
             "ICES003 Class A VCCI-CISPR32 Class A EN61000-3-2 EN61000-3-3 KS C 9832 Class A "
             "KS C 9835 CNS13438")
got, cut = cap_value(long_real)
check("SABOTAGE a real over-cap value is cut at a word boundary, never mid-word (it used to end 'KS C 9832 Cla')",
      cut and got.endswith("9832") and not long_real[len(got):].startswith(got[-1:] + "x"), repr(got[-24:]))
check("... the cut is a whole-word prefix of the cell", long_real.startswith(got) and long_real[len(got)] == " ")
check("... and it is FLAGGED, so nothing is cut in silence", cut is True)
check("... and it never exceeds the cap", len(got) <= VALUE_CAP)
check("SABOTAGE a hard slice at the cap would have cut mid-word — this asserts the old behaviour is gone",
      got != long_real[:VALUE_CAP], repr(long_real[VALUE_CAP - 6:VALUE_CAP]))

one_token = "https://example.invalid/" + "a" * 300
got2, cut2 = cap_value(one_token)
check("a single token longer than half the cap has no boundary to back off to: cut hard, still flagged",
      cut2 is True and len(got2) == VALUE_CAP)

check("the label cap is a separate, smaller number", LABEL_CAP < VALUE_CAP)
check("cap_value honours an explicit cap", cap_value("one two three four", 9) == ("one two", True))
check("SABOTAGE a cap that keeps a partial word is a miss", cap_value("one two three four", 9)[0] != "one two t")
check("None and empty are not a crash", cap_value(None) == ("", False))


# ==================================================================================================
# 2. text_contains — the page-text witness, wrap-tolerant but character-exact
# ==================================================================================================
print("text_contains")
# the real shapes from the 20 misses
wrapped_desc = ["ucsc-m-v5q50gv2-d cisco vic 15427 4x 10/25/50g mlom c-series w/secure mlom hhhl, ss",
                "boot riser 1 or 2 hhhl, ss"]
check("a value that WRAPPED onto the next line is found (c240m7 p38, miss 2 of 20)",
      text_contains("Cisco VIC 15427 4x 10/25/50G mLOM C-Series w/Secure Boot", wrapped_desc))
check("SABOTAGE one digit different and it still fails (15428 for 15427) — the check stays alive",
      not text_contains("Cisco VIC 15428 4x 10/25/50G mLOM C-Series w/Secure Boot", wrapped_desc))
check("SABOTAGE a word that is not on the page at all fails",
      not text_contains("Cisco VIC 15427 4x 10/25/50G mLOM D-Series w/Secure Boot", wrapped_desc))
check("SABOTAGE the words out of order fail — the walk is left to right, not a bag of tokens",
      not text_contains("Boot w/Secure Cisco VIC 15427", wrapped_desc))

split_header = ["table 5 available cpus", "highest ddr4", "clock",
                "cache upi1 links dimm clock", "product id (pid) freq power (w) cores",
                "size (mb) (gt/s) support (mhz)2", "(ghz)"]
check("a table HEADER split across lines is found (hx220-m6-edge p20, miss 5 of 20)",
      text_contains("Cache Size (MB)", split_header))
check("SABOTAGE the wrong unit in the same header fails", not text_contains("Cache Size (GB)", split_header))
check("a header split the other way round is found", text_contains("Clock Freq (GHz)", split_header))
check("SABOTAGE a label from a different table fails", not text_contains("Cache Latency (MB)", split_header))

check("a value that is entirely on one line is found by the plain substring path",
      text_contains("2.4", ["hx-cpu-i8351n 2.4 185 36 24 0 3200"]))
check("SABOTAGE a value on no line fails", not text_contains("2.5", ["hx-cpu-i8351n 2.4 185 36 24 0 3200"]))
check("a URL broken across lines inside the cell is found (b480m5 p78, miss 14 of 20)",
      text_contains("https://www.cisco.com/c/en/us/products/collate ral/servers-unified-computing/x.html",
                    ["ucs-cpu-6132 2.6 ghz https://www.cisco.com/c/en/us/products/collate",
                     "ral/servers-unified-computing/x.html"]))
far = ["alpha"] + ["x"] * 12 + ["omega"]
check("SABOTAGE a continuation further down the page than a wrap can reach is refused",
      not text_contains("alpha omega", far))
check("a continuation a couple of lines down IS a wrap", text_contains("alpha omega", ["alpha", "x", "omega"]))
check("a three-deep header block is still within reach (5108b200m5m6 p47: clock / freq / (ghz))",
      text_contains("Clock Freq (GHz)",
                    ["highest ddr4", "clock cache", "power upi links dimm clock",
                     "product id (pid) freq", "(w)", "size cores", "(gt/s) support", "workload",
                     "(ghz) (mb)", "(mhz)"]))
check("SABOTAGE the same block does not contain a unit it never printed",
      not text_contains("Clock Freq (kHz)",
                        ["highest ddr4", "clock cache", "power upi links dimm clock",
                         "product id (pid) freq", "(w)", "size cores", "(gt/s) support",
                         "workload", "(ghz) (mb)", "(mhz)"]))
long_val = ("47CFR Part 15 (CFR 47) Class A AS/NZS CISPR32 Class A CISPR32 Class A EN55032 Class A "
            "ICES003 Class A VCCI-CISPR32 Class A EN61000-3-2 EN61000-3-3 KS C 9832 Class A")
wrapped_long = ["emc - emissions 47cfr part 15 (cfr 47) class a", "as/nzs cispr32 class a",
                "cispr32 class a", "en55032 class a", "ices003 class a", "vcci-cispr32 class a",
                "en61000-3-2", "en61000-3-3", "ks c 9832 class a"]
check("a 28-word compliance list printed down nine lines of one cell is found (ucs-c240-m8-lff p59)",
      text_contains(long_val, wrapped_long))
check("SABOTAGE one standard changed in that list and it fails (EN55033 for EN55032)",
      not text_contains(long_val.replace("EN55032", "EN55033"), wrapped_long))
check("SABOTAGE the same words scattered far apart are not one wrapped cell",
      not text_contains(long_val, [wrapped_long[0]] + ["x"] * 40 + wrapped_long[1:]))
check("empty needle is never 'on the page'", not text_contains("", ["anything"]))
check("no lines at all is never a pass", not text_contains("alpha", []))
check("text_lines drops blank lines and lowercases", text_lines("A B\n\n  C  \n") == ["a b", "c"])


# ==================================================================================================
# 3. footnote markers — read from the real cached PDFs, because the rule is geometry
# ==================================================================================================
print("footnote markers (cached PDFs)")
CACHE = ROOT / "scraper" / "cache"


def cached(url: str):
    return CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".bin")


X580P = "https://www.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/ucs-x-series-modular-system/x580p-specsheet.pdf"
C240M7 = "https://www.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/c240m7-sff-specsheet.pdf"
HX220 = "https://www.cisco.com/c/dam/en/us/products/collateral/hyperconverged-infrastructure/hyperflex-hx-series/hyperflex-hx220-m6-edge-spec-sheet.pdf"

missing = [u for u in (X580P, C240M7, HX220) if not cached(u).exists()]
if missing:
    # NOT a skip. A geometry rule proven only on a hand-built fixture is a rule proven on the
    # fixture, and "could not check" must never come back as a pass (CLAUDE.md § 6).
    nfail += 1
    print(f"  MISS the cached PDFs this suite reads are not in scraper/cache: {len(missing)} of 3 missing")
else:
    import pdfplumber

    def page_of(url: str, pno: int):
        with pdfplumber.open(io.BytesIO(cached(url).read_bytes())) as pdf:
            return read_page(pdf.pages[pno])

    grid, _text, nmarks, _bleed = page_of(X580P, 8)
    row5 = grid[0][5]
    check("SABOTAGE a footnote digit glued to a PART NUMBER is stripped (UCSX-GPU-RTXP45003 -> ...4500)",
          row5[0] == "UCSX-GPU-RTXP4500", repr(row5[0]))
    check("... and the digits that are part of the model number are all kept",
          row5[1] == "Nvidia RTX Pro 4500 GPU 160W 32GB Gen5 FHFL 1-slot", repr(row5[1]))
    check("... the page reports how many markers it removed", nmarks > 0, str(nmarks))
    row3 = grid[0][3]
    check("a RUN of markers with its separator goes too (H200-NVL1,2)",
          row3[0] == "UCSX-GPU-H200-NVL", repr(row3[0]))
    kept_digits = [c for c in grid[0][4][0]]
    check("SABOTAGE a PID whose trailing digits are real is untouched (UCSX-GPU-RTXP6000)",
          "".join(kept_digits) == "UCSX-GPU-RTXP6000", repr(grid[0][4][0]))

    grid7, _t7, _n7, _b7 = page_of(C240M7, 38)
    check("a footnote digit glued to a VALUE is stripped (w/Secure Boot5 -> w/Secure Boot)",
          grid7[0][2][1] == "Cisco VIC 15427 4x 10/25/50G mLOM C-Series w/Secure Boot", repr(grid7[0][2][1]))
    check("SABOTAGE the model number in the same cell keeps every digit (15427, 10/25/50G)",
          "15427" in grid7[0][2][1] and "10/25/50G" in grid7[0][2][1])
    check("a footnote digit glued to a HEADER is stripped (Card Size1 -> Card Size)",
          grid7[0][0][3] == "Card Size", repr(grid7[0][0][3]))

    grid20, text20, _n20, _b20 = page_of(HX220, 20)
    hdr20 = grid20[0][0]
    check("a header footnote in the MIDDLE of a label is stripped (UPI1 Links -> UPI Links)",
          hdr20[5] == "UPI Links (GT/s)", repr(hdr20[5]))
    check("... and one at the very end too (Support (MHz)2 -> Support (MHz))",
          hdr20[6].endswith("Support (MHz)"), repr(hdr20[6]))
    check("SABOTAGE a CPU PID whose trailing letter+digit is real keeps them (HX-CPU-I6326)",
          grid20[0][1][0] == "HX-CPU-I6326", repr(grid20[0][1][0]))
    check("SABOTAGE the numeric cells of the same rows are untouched",
          grid20[0][1][1:] == ["2.9", "185", "24", "16", "3 at 11.2", "3200"], repr(grid20[0][1][1:]))
    check("a footnote glued to a CPU PID is stripped (HX-CPU-I6314U4 -> HX-CPU-I6314U)",
          grid20[0][2][0] == "HX-CPU-I6314U", repr(grid20[0][2][0]))

    # the two halves the gate reported, end to end through the shared reader
    lines20 = text_lines(text20)
    check("END TO END the split header now re-reads clean (miss 5 of 20)",
          text_contains(hdr20[3], lines20), repr(hdr20[3]))
    check("SABOTAGE ... and a header that is NOT on this page still fails",
          not text_contains("Cache Size (TB)", lines20))
    lines7 = text_lines(_t7)
    check("END TO END the wrapped description now re-reads clean (miss 2 of 20)",
          text_contains(grid7[0][2][1], lines7))
    check("SABOTAGE ... with one digit changed it does not",
          not text_contains(grid7[0][2][1].replace("15427", "15428"), lines7))

    with pdfplumber.open(io.BytesIO(cached(X580P).read_bytes())) as pdf:
        raw_marks = footnote_marker_chars(pdf.pages[8])
    check("footnote_marker_chars returns character keys, not text", all(len(k) == 3 for k in raw_marks))


# ==================================================================================================
# 4. column_bleed — a word split across a column boundary is flagged, never repaired
# ==================================================================================================
print("column_bleed")
bled = [["Product ID (PID)", "PID Description Im", "ages"],
        ["CAB-C13-C14-2M-JP", "Power Cord C13-C14, 2M/6.5ft Japan Im\nPSE mark", "age not available"],
        ["CAB-48DC-40A-INT", "C-Series -48VDC PSU PWR Cord, 3.5M, 3 Im\nWire, 8AWG, 40A (INT)", "age not available"]]
hits = column_bleed(bled)
check("SABOTAGE a column boundary cutting the word 'Images' is flagged (hci-c225m8-sff p66, miss 15 of 20)",
      len(hits) == 1 and hits[0][0] == 1 and hits[0][1] == "Im" and hits[0][2] == "ages", repr(hits))
check("... and it counts the data rows it saw it in", hits and hits[0][3] >= BLEED_MIN_ROWS, repr(hits))
no_header_split = [["Product ID (PID)", "Description", "EOL bulletin link"],
                   ["UCS-CPU-6132", "2.6 GHz 6132/140W 14C/19.25MB SAS", "https://x/collate\nral/y.html"],
                   ["UCS-CPU-6130", "2.1 GHz 6130/125W 16C/22MB SSD", "https://x/collate\nral/y.html"],
                   ["UCS-CPU-6128", "3.4 GHz 6128/115W 6C/19.25MB SSD", "https://x/collate\nral/y.html"]]
check("SABOTAGE two columns whose line breaks merely land level are NOT a bleed (b480m5 p71: 'SSD' beside 'ral')",
      column_bleed(no_header_split) == [], repr(column_bleed(no_header_split)))
clean_tbl = [["Product ID (PID)", "PID Description", "Location"],
             ["UCSC-M-V5Q50GV2-D", "Cisco VIC 15427 4x 10/25/50G mLOM", "mLOM"],
             ["UCSC-P-V5Q50G-D", "Cisco VIC 15425 4x 10/25/50G PCIe", "Riser 1 or 2"]]
check("SABOTAGE an ordinary table is NOT flagged — a detector that fires on everything is no detector",
      column_bleed(clean_tbl) == [], repr(column_bleed(clean_tbl)))
one_row = [["a", "x Im", "age not available"], ["b", "plain", "Something Else"]]
check("one row alone is not a defect", column_bleed(one_row) == [])
wrapped_ok = [["UCSC-240M8E3-32X2", "C240M8 E3.S 32 drives (x2\nlanes) with riser 1,2&3", "32"],
              ["UCSC-240M8E3-16X4", "C240M8 E3.S 16 drives (x4\nlanes, slots 9-24) with", "16"]]
check("SABOTAGE a table whose cells merely WRAP is not a bleed (ucs-c240-m8-edsff p22)",
      column_bleed(wrapped_ok) == [], repr(column_bleed(wrapped_ok)))


print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
