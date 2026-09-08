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
import re  # noqa: E402
import adapters.cisco_specs_pdf as ADAPTER  # noqa: E402
from adapters.cisco_specs_pdf import (  # noqa: E402
    BLEED_MIN_ROWS, DEDUPE_TOLERANCE, LABEL_CAP, NOT_A_SPEC_LABEL, VALUE_CAP, cap_value,
    column_bleed, footnote_marker_chars, image_columns, read_page, text_contains, text_lines,
)

# ">=4 letters in a row, each one printed twice": the shape an overprinted bold run takes once
# pdfplumber has handed back both copies. "PPlluugg", "MMoolleexx", "CCoorrddsseett".
DOUBLED_RUN = re.compile(r"(?:([A-Za-z])\1){4,}")

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
S3260 = "https://www.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/ucs-s-series-storage-servers/s3260-specsheet.pdf"
C240M8LFF = "https://www.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/ucs-c240-m8-lff-rack-server.pdf"

NEEDED = (X580P, C240M7, HX220, S3260, C240M8LFF)
missing = [u for u in NEEDED if not cached(u).exists()]
if missing:
    # NOT a skip. A geometry rule proven only on a hand-built fixture is a rule proven on the
    # fixture, and "could not check" must never come back as a pass (CLAUDE.md § 6).
    nfail += 1
    print(f"  MISS the cached PDFs this suite reads are not in scraper/cache: "
          f"{len(missing)} of {len(NEEDED)} missing")
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



# ==================================================================================================
# 5. overprinted glyphs, and a column that cannot hold a specification
#
# ONE row of s3260-specsheet p43 carried both faults, and it is the row that failed the gate:
#   CAB-48VDC-40A-8AWG "Images" = "PPlluugg:: CCoorrddsseett rraattiinngg:: MMoolleexx 33CCKKTT ..."
# The page fakes bold by drawing every glyph twice, and the column is a column of PHOTOGRAPHS.
# Fixing either one alone leaves a defect: dedupe alone gives a clean sentence that is still a
# picture caption filed as a specification; the label refusal alone leaves every OTHER overprinted
# cell in the corpus doubled.
# ==================================================================================================
print("overprint dedupe + picture columns")
if missing:
    nfail += 1
    print("  MISS the cached PDFs this section reads are not in scraper/cache")
else:
    with pdfplumber.open(io.BytesIO(cached(S3260).read_bytes())) as _pdf:
        _page43 = _pdf.pages[43]
        st = {}
        grid43, text43, _n43, bleed43 = read_page(_page43, st)
        # The smallest gap between two ADJACENT identical characters that are genuinely two
        # glyphs, measured on this very page: the margin the tolerance has to live inside. The
        # doubled cell is set in 4 pt type, which is where that margin is tightest.
        _lines43: dict = {}
        for _c in _page43.chars:
            _lines43.setdefault(round(float(_c["doctop"]), 1), []).append(_c)
        legit_gap = min(
            float(b["x0"]) - float(a["x0"])
            for _cs in _lines43.values()
            for a, b in zip(sorted(_cs, key=lambda c: float(c["x0"])),
                            sorted(_cs, key=lambda c: float(c["x0"]))[1:])
            if a["text"] == b["text"] and float(b["x0"]) - float(a["x0"]) > 0.2)
        grid43_nostats = read_page(_page43)[0]

    cell = grid43[0][3][2]
    check("the overprinted cell reads as the page renders it (s3260 p43:t0:r3:c2)",
          cell.startswith("Plug: Cordset rating: Molex 3CKT"), repr(cell[:60]))
    check("SABOTAGE ... and not one doubled run survives anywhere in it",
          DOUBLED_RUN.search(cell) is None, repr(cell[:60]))
    check("SABOTAGE the old doubled text is gone, not merely shortened",
          "PPlluugg" not in cell and "MMoolleexx" not in cell)
    check("SABOTAGE a LEGITIMATE double letter inside the SAME overprinted run survives: "
          "'GGrreeeenn' is 'Green' with BOTH its e's, because the second e is a glyph-width away",
          " Green " in cell and "Gren" not in cell, repr(cell))
    check("... the whole cell is the caption, in order",
          cell == "Plug: Cordset rating: Molex 3CKT 428160312 -48 VDC, 40 A Green 2.0 m "
                  "580503 Black & red 3.5 m", repr(cell))
    check("the reader reports how many overprinted glyphs it removed", st.get("overprint_removed") == 81,
          repr(st))
    check("SABOTAGE the tolerance is far below the smallest REAL gap between two identical "
          "adjacent glyphs on this page, so a real double letter can never be inside it",
          DEDUPE_TOLERANCE < legit_gap / 10, f"tolerance={DEDUPE_TOLERANCE} real gap={legit_gap:.4f}")
    check("SABOTAGE ... and pdfplumber's OWN default of 1 pt is NOT: it is within 2x of that gap, "
          "which is why this reader does not use it", legit_gap < 2.0, f"{legit_gap:.4f}")
    check("the gate calls read_page(page) with no stats dict and gets the same tables",
          grid43_nostats == grid43)
    check("SABOTAGE the neighbouring real cells are untouched by the dedupe",
          grid43[0][3][1] == "C-Series -48VDC PSU Power Cord, 3.5M, 3 Wire, 8AWG, 40A",
          repr(grid43[0][3][1]))

    with pdfplumber.open(io.BytesIO(cached(C240M8LFF).read_bytes())) as _pdf:
        grid22 = read_page(_pdf.pages[22])[0]
    pids22 = [r[0] for r in grid22[0]]
    check("SABOTAGE a real PID whose doubled letter is real keeps it (UCS-HDL16TT1S74K, "
          "ucs-c240-m8-lff p22)", "UCS-HDL16TT1S74K" in pids22, repr(pids22[:6]))
    check("SABOTAGE ... and its neighbours in the same column are unchanged too",
          "UCS-HDL24TW1S74K" in pids22 and "UCS-HDL22TW1S74K" in pids22)

    # ---- the column that cannot hold a specification ---------------------------------------
    hdr43 = grid43[0][0]
    check("the picture column is found by its header (s3260 p43)",
          image_columns(grid43[0]) == [(2, "Images")], repr(image_columns(grid43[0])))
    check("... and it is NOT a COLUMN_BLEED: the boundary is right and the header is whole",
          bleed43[0] == [] and hdr43 == ["Product ID (PID)", "PID Description", "Images"],
          repr((bleed43[0], hdr43)))
    check("SABOTAGE a real attribute that merely CONTAINS the word is not refused "
          "(CLAUDE.md: anchor, never a substring)",
          image_columns([["PID", "Image Sensor Resolution", "Imaging Rate"]]) == [],
          repr(image_columns([["PID", "Image Sensor Resolution", "Imaging Rate"]])))
    check("SABOTAGE an ordinary table is not flagged — a detector that fires on everything is none",
          image_columns([["Product ID (PID)", "PID Description", "Location"]]) == [])
    check("column 0 is never reported: it is the PID column",
          image_columns([["Image", "Cores", "Watts"]]) == [])
    check("NOT_A_SPEC_LABEL matches the whole label only",
          bool(NOT_A_SPEC_LABEL.match("Images")) and bool(NOT_A_SPEC_LABEL.match("photo"))
          and not NOT_A_SPEC_LABEL.match("Image Type")
          and not NOT_A_SPEC_LABEL.match("Imaging"))

    # ---- END TO END: the real adapter over the real page, one page sliced out so it is fast ----
    import pypdf

    _w = pypdf.PdfWriter()
    _r = pypdf.PdfReader(io.BytesIO(cached(S3260).read_bytes()))
    _w.add_page(_r.pages[43])
    _buf = io.BytesIO()
    _w.write(_buf)
    _one = _buf.getvalue()

    # The ground truth must be loaded BEFORE the slice borrows the parent document's PID list:
    # written as one statement, Python evaluates the right-hand side first, _SKU_MAP is still
    # empty, and the slice gets [] -- no PIDs, no grid rows, and every assertion below passes
    # vacuously. That is how this section first ran green with nothing in it.
    FAKE = "memory://s3260-p43.pdf"
    _real_map = ADAPTER._load_sku_map()
    _real_map[FAKE] = _real_map.get(S3260, [])
    check("the sliced page carries the parent document's ground truth, or every END TO END "
          "assertion below is vacuous", len(_real_map[FAKE]) > 0, str(len(_real_map[FAKE])))

    class _Cached:
        def fetch_binary(self, _url):
            return _one

    recs = ADAPTER.run(_Cached(), [FAKE])
    facts = [x for x in recs if not x.get("__doc__")]
    docdef = [x for x in recs if x.get("__doc__")][0]["defects"]
    check("END TO END the picture cell that failed the gate is NOT emitted as a fact",
          not [f for f in facts if NOT_A_SPEC_LABEL.match(f.get("label") or "")], repr(facts))
    check("SABOTAGE ... and it is refused BY NAME, not lost in silence",
          [d for d in docdef if d["code"] == "IMAGE_COLUMN" and d["locator"] == "p0:t0:r0:c2"],
          repr(docdef))
    check("SABOTAGE ... for the RIGHT reason: the cell IS there and IS non-empty — it is the "
          "column that is refused, not the cell that is missing",
          grid43[0][3][2].startswith("Plug:"))
    check("SABOTAGE the real specification in the same row still lands",
          [f for f in facts if f.get("sku") == "CAB-48VDC-40A-8AWG"
           and f.get("label") == "PID Description"
           and f.get("value") == "C-Series -48VDC PSU Power Cord, 3.5M, 3 Wire, 8AWG, 40A"],
          repr(facts))
    check("SABOTAGE no fact on the page carries a doubled run any more",
          not [f for f in facts if DOUBLED_RUN.search(f.get("value") or "")
               or DOUBLED_RUN.search(f.get("label") or "")], repr(facts))


print("")
print("shape TEXTLINE — the specification line itself")
# WHY THIS SHAPE EXISTS. Cisco rules its spec tables around the HEADER ONLY, so pdfplumber returns
# [['Description', 'Specification']] with no data rows and every table shape yields nothing. The
# whole servers-unified-computing category sat at zero deep specs for that layout.
from adapters.cisco_specs_pdf import spec_pairs, text_lines, text_lines_cased   # noqa: E402

# --- the locator invariant, which is the one that silently corrupts provenance if it breaks ------
# `text_lines` MUST be `text_lines_cased` lower-cased, because the producer indexes an L locator
# against one and the gate's auditor re-reads the page through the other. Any divergence in
# filtering shifts every locator on the page by however many lines disagree, which points each
# fact at a neighbouring row and reads downstream exactly like fabrication.
_T = "Header line\n\n  Weight  35 lb (15.9 kg)  \n\nDepth 29.8 in.\n"
check("text_lines is exactly text_lines_cased lower-cased — producer and auditor cannot drift",
      text_lines(_T) == [x.lower() for x in text_lines_cased(_T)],
      repr((text_lines(_T), text_lines_cased(_T))))
check("blank lines are dropped by BOTH, so an L index means the same thing on each side",
      len(text_lines_cased(_T)) == 3 and text_lines_cased(_T)[1] == "Weight 35 lb (15.9 kg)",
      repr(text_lines_cased(_T)))
check("the line index a pair reports indexes text_lines_cased, not the raw split",
      [(lb, li) for lb, _v, li in spec_pairs(_T)] == [("Weight", 1), ("Depth", 2)],
      repr(spec_pairs(_T)))

# --- the split itself ----------------------------------------------------------------------------
_pairs = dict((lb, v) for lb, v, _li in spec_pairs(
    "Dimensions (H x W x D) 1.72 in. x 17.3 in. x 29.8 in.\n"
    "Cordset rating 10 A, 250 V\n"
    "Max. Cluster Size 32\n"))
check("a real spec line splits where the VALUE begins, not at a column that is not there",
      _pairs.get("Dimensions (H x W x D)") == "1.72 in. x 17.3 in. x 29.8 in.", repr(_pairs))
check("a measurement value splits clean", _pairs.get("Cordset rating") == "10 A, 250 V", repr(_pairs))
check("SABOTAGE a mixed-case trailing word is NOT moved into the value — 'Max. Cluster Size' + '32' "
      "must not become 'Max. Cluster' + 'Size 32'",
      _pairs.get("Max. Cluster Size") == "32", repr(_pairs))

# --- the trailing-standard move, and the trap in it ----------------------------------------------
# MEASURED, not reasoned about: the line reader leaves the standards body on the LABEL, because the
# value it introduces starts with a digit. "Input Connector IEC" + "320 C14" is a wrong pair.
_ic = dict((lb, v) for lb, v, _li in spec_pairs("Input Connector IEC 320 C14\n"))
check("a trailing ALL-CAPS standard moves into the value when a multi-word label survives",
      _ic == {"Input Connector": "IEC 320 C14"}, repr(_ic))
_sf = dict((lb, v) for lb, v, _li in spec_pairs("Safety UL 60950-1\n"))
check("SABOTAGE it does NOT move when a ONE-word label would be left: bare 'Safety' is in the "
      "mapper's section-heading refusal list, so moving it turns a good pair into a dropped one",
      _sf == {"Safety UL": "60950-1"}, repr(_sf))
_vac = dict((lb, v) for lb, v, _li in spec_pairs("Input Voltage Range VAC 100 to 240\n"))
check("SABOTAGE a trailing UNIT is not a standards body and stays on the label",
      "Input Voltage Range VAC" in _vac, repr(_vac))

# --- what it must refuse -------------------------------------------------------------------------
check("SABOTAGE a table-of-contents line is not a specification (dot leaders are the tell — this "
      "exact line once made a measurement report a page-3 'Weight')",
      spec_pairs("Dimensions and Weight . . . . . . . . . . 97\n") == [],
      repr(spec_pairs("Dimensions and Weight . . . . . . . . . . 97\n")))
check("SABOTAGE a model heading is not a field", spec_pairs("Cisco UCS C240 M7\n") == [],
      repr(spec_pairs("Cisco UCS C240 M7\n")))
check("SABOTAGE a table caption is not a field", spec_pairs("Table 12 Power specifications 1050\n") == [],
      repr(spec_pairs("Table 12 Power specifications 1050\n")))
check("SABOTAGE a bare value line has no room for a label and yields nothing",
      spec_pairs("32 nodes maximum\n") == [], repr(spec_pairs("32 nodes maximum\n")))
check("SABOTAGE a copyright footer is not a field",
      spec_pairs("2026 Cisco and/or its affiliates. All rights reserved. Page 12\n") == [],
      repr(spec_pairs("2026 Cisco and/or its affiliates. All rights reserved. Page 12\n")))


print("")
print("shape TEXTLINE — the junk the FIRST LIVE RUN produced")
# EVERY LINE BELOW IS VERBATIM FROM THE ADAPTER'S OWN OUTPUT over 14 cached spec sheets. The suite
# was green at 95 cases and roughly three quarters of the shape's real output was not a
# specification: the tests had only ever seen lines someone chose to write. This block is the
# corpus answering back, and it is the reason the guards exist in the shape they do.
_JUNK = [
    # a PART NUMBER split at a hyphen — this one alone produced TEN facts labelled "UCSC"
    "UCSC-885A-M8-H20 UCS C885A M8 Rack - H200 GPU, ht",
    "AMD9575F 96GB 6400DDR5",
    # a CONTENTS page with no dot leaders, which is what Cisco publishes now
    "Cisco UCS X580P PCIe Node 25",
    "Cisco UCS C880A M8 Rack Server 31",
    "Cisco UCS 6600 Series Fabric Interconnects 39",
    # a two-model comparison table bleeding its HEADER in as a label
    "Specification Cisco UCS 6664 FI Cisco UCS 6652 FI",
    "AC Power Supply Properties Cisco UCS 6664 FI Cisco UCS 6652 FI",
    # a table ROW: three or more bare numbers and not one unit between them
    "Sys FAN 59 5 295",
    "eCMC 20 2 40",
    # ... and this one survived the FIRST version of that rule, which required almost every token
    # to be bare. Three of six are bare here, so the threshold is half, not len-1.
    "Supply PSU 12V_Main 2400W 1300W 1 2400 1300",
    # MULTI-MODEL COMPARISON ROWS, from the 61-document extraction. A sheet comparing two or three
    # models prints every model's figure on one line; read as one document-scoped fact that is a
    # number belonging to no device. `Processors` is the dangerous one — `cpu` is a STRING field,
    # so nothing downstream would have refused it, and it was 14 facts.
    "Processors 155W+ 155W+ and 105W+ (4 or 6 Cores)",
    "Maximum Input at Nominal Input Voltage NA 1778 1758",
    "Minimum Rated Efficiency (%) NA NA 90 91",
    "Maximum Rated Output 1300/2500 2500 2500",
    # a split SENTENCE, and a split parenthetical
    "temperature must be less than 35 oC (95 oF).",
    "(with two power supplies and six fans 44 lb (20 kg) 25lbs (11.34 KG)",
]
for _line in _JUNK:
    _got = spec_pairs(_line + "\n")
    check(f"SABOTAGE (live output) refused: {_line[:44]}", _got == [], repr(_got))

# ... and the specifications from the SAME run must survive the guards. A filter that refuses the
# junk by refusing everything is not a filter, and this half is what would catch that.
_REAL = {
    "Temperature, operating 32 to 104°F (0 to 40°C)": ("Temperature, operating", "32 to 104°F (0 to 40°C)"),
    "Temperature, non-operating -40 to 158°F (-40 to 70°C)": ("Temperature, non-operating", "-40 to 158°F (-40 to 70°C)"),
    "Humidity (RH), non-condensing 5 to 95%": ("Humidity (RH), non-condensing", "5 to 95%"),
    "Altitude 0 to 10000 ft (0 to 3048 m)": ("Altitude", "0 to 10000 ft (0 to 3048 m)"),
    "Maximum voltage (AC) 100 to 240 VAC": ("Maximum voltage (AC)", "100 to 240 VAC"),
    "Frequency 50 to 60 Hz": ("Frequency", "50 to 60 Hz"),
    "Maximum AC input current 1100W": ("Maximum AC input current", "1100W"),
    "Cordset rating 10 A, 250 V": ("Cordset rating", "10 A, 250 V"),
    "Max. Cluster Size 32": ("Max. Cluster Size", "32"),
    "Rear Clearance 6 in. (152 mm)": ("Rear Clearance", "6 in. (152 mm)"),
    # ... and the real values from the same extraction that the multi-model rules must NOT eat.
    # Each has two or more numbers; each is ONE value, because the document joins them.
    "Maximum Allowable Input Voltage Range 90 to 264": ("Maximum Allowable Input Voltage Range", "90 to 264"),
    "Operating Altitude 0 m to 3050 m (10,000 ft)": ("Operating Altitude", "0 m to 3050 m (10,000 ft)"),
    "Maximum Allowable Frequency Range (Hz) 47 to 63": ("Maximum Allowable Frequency Range (Hz)", "47 to 63"),
    "Minimum Ride-Through Time (ms) 12": ("Minimum Ride-Through Time (ms)", "12"),
    "Maximum Rated Standby Output (W) 36": ("Maximum Rated Standby Output (W)", "36"),
}
for _line, _want in _REAL.items():
    _got = spec_pairs(_line + "\n")
    check(f"KEPT: {_line[:46]}", len(_got) == 1 and (_got[0][0], _got[0][1]) == _want, repr(_got))


print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
