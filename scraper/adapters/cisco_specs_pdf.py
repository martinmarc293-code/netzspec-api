"""cisco_specs_pdf — deep specs out of Cisco's PDF spec sheets.

WHY THIS EXISTS
cisco_specs_deep reads HTML tables. Cisco publishes its UCS, HyperFlex and several optical
spec sheets ONLY as PDF -- 332 of them in the corpus. That matters more than the count
suggests: servers-unified-computing is the LARGEST hardware category we hold (11,704
physical parts) and it sat at ZERO deep specs, because the HTML extractor cannot open a PDF
and the classifier scored those documents "empty" for exactly that reason.

These documents are not thin. A single C240 M7 spec sheet is 111 pages with a TECHNICAL
SPECIFICATIONS section carrying clean two-column tables:

    Parameter                                   | Value
    Height                                      | 3.42 in. (8.7 cm)
    Input Voltage Range (V rms)                 | 100 to 240
    Maximum Rated Output (W)                    | 1050

SCOPE DISCIPLINE -- the trap in these files
One spec sheet lists hundreds of PIDs, and most of them are NOT the machine the specs
describe: Windows Server licences (MSWS-19-*), RHEL and SUSE subscriptions, drives, spare
fans. The chassis weight belongs to the server, not to RHEL-2S2V-D1A=. So a "Parameter |
Value" table is emitted as __document__-scoped, never bound to a SKU, and the existing merge
step's scope check decides which parts may legitimately inherit it -- the same machinery that
already refuses 2,491 class-B and 616 out-of-scope inheritances on the HTML side. Binding
these to every PID in the file would put a rack server's dimensions on a software licence.

Output records are exactly the shape cisco_specs_deep emits, so map-deep-specs.ts, the
precision gate and apply-specs-v2 all work unchanged.

Usage: python scraper/run.py cisco-specs-pdf --urls-file <file of .pdf urls>
"""
from __future__ import annotations

import sys as _sys
from pathlib import Path as _P0
_sys.path.insert(0, str(_P0(__file__).resolve().parent.parent))
from netzscrape import is_attributable_pid

import json as _json
import re
import sys
from pathlib import Path as _Path

# Ground truth, shared with the HTML adapter: a row is a PID because it IS one of ours.
_SKU_MAP: dict[str, list[str]] = {}
_KNOWN_NORM: set[str] = set()


def _load_sku_map() -> dict[str, list[str]]:
    """Union of every ground-truth map, not the first one that happens to exist.

    The first version stopped at the first file it found. datasheet-skus-full.json is built by
    scanning the HTML cache and so contains no PDF at all, and it sorts first -- so merging the
    PDF ground truth into datasheet-skus.json changed nothing, every document still reported
    "0 PIDs, grid=0", and the failure looked identical to having no mapping at all. A loader
    that silently ignores a source is worse than one that errors.
    """
    global _SKU_MAP
    if not _SKU_MAP:
        merged: dict[str, list[str]] = {}
        for name in ("data/reference/datasheet-skus-full.json",
                     "data/reference/datasheet-skus.json",
                     "data/reference/datasheet-skus-pdf.json"):
            p = _Path(name)
            if not p.exists():
                continue
            for url, skus in _json.loads(p.read_text(encoding="utf-8")).items():
                if url in merged:
                    merged[url] = sorted(set(merged[url]) | set(skus))
                else:
                    merged[url] = list(skus)
        # Drop tokens that are in the map but cannot own a specification -- bare quantities
        # ("256GB", "512 GB") and protocol names ("H.323"). Left in, ground-truth matching binds
        # facts to them: "H.323" collected 84 meaningless cells from a router datasheet reading
        # "Cisco = 32", and "256GB" collected memory-guide rows like "DIMM Slot 2 (Black) = No".
        # The parts are NOT deleted, only barred from owning specs.
        dropped = 0
        for url in merged:
            keep = [s for s in merged[url] if is_attributable_pid(s)]
            dropped += len(merged[url]) - len(keep)
            merged[url] = keep
        _SKU_MAP = merged
        print(f"  [sku-map] {len(_SKU_MAP)} documents with ground truth "
              f"({dropped} non-attributable tokens dropped)", file=sys.stderr)
    return _SKU_MAP


def _norm_pid(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _is_pid(s: str) -> bool:
    if not s or not _KNOWN_NORM:
        return False
    t = s.strip()
    for c in (t, re.sub(r"\s+\d+$", "", t).rstrip(".,;"), t.rstrip("="), re.sub(r"^C1-", "", t)):
        if _norm_pid(c) in _KNOWN_NORM:
            return True
    return False


# A two-column "Parameter | Value" table header, the dominant shape in Cisco spec sheets.
PARAM_HDR = re.compile(r"^(parameter|specification|attribute|item|description|feature)s?$", re.I)
VALUE_HDR = re.compile(r"^(value|specification|spec|description|details?)s?$", re.I)

# Section headings that mean the following tables are real hardware specifications. Extracting
# only under these avoids pulling the ordering, licensing and spare-parts tables in as "specs".
SPEC_SECTION = re.compile(
    r"(technical specifications?|dimensions and weight|power specifications?|"
    r"environmental specifications?|physical specifications?|compliance requirements?|"
    r"acoustic|regulatory standards)", re.I)

# Labels that are prose or footnotes rather than an attribute name.
BAD_LABEL = re.compile(r"^(note|notes?:|see |for more|refer to|table \d|figure \d|\d+$|footnote)", re.I)

EMPTY_VAL = {"", "-", "--", "n/a", "na", "none", "tbd"}


def _clean(s) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


# A cell holding ONLY a unit, e.g. "(C)", "(GHz)", "(W)", "(MB)", "(MT/s)".
#
# Matched against a CLOSED LIST, not a shape. The first version tested
# ^\(?[A-Za-z]{1,6}\)?$ , which also matches "No", "Yes", "Min" and "Max" -- so an ordinary
# data row like ["C9500X-28C8D", "No", "No"] qualified as a unit row and would have been folded
# into the header, destroying the table. Found by running the same test over the HTML corpus,
# where 4 of the first 4 hits were data rows rather than units.
_UNITS_KNOWN = {
    "c", "s", "w", "kw", "mw", "va", "kva", "a", "ma", "v", "vac", "vdc", "hz", "khz", "mhz",
    "ghz", "mt/s", "gt/s", "b", "kb", "mb", "gb", "tb", "byte", "bytes", "mm", "cm", "m", "km",
    "nm", "in", "ft", "kg", "g", "lb", "lbs", "%", "db", "dba", "db(a)", "dbm", "btu", "btu/h",
    "ms", "us", "ns", "h", "hr", "hrs", "ru", "he", "rpm", "cfm", "mpps", "pps", "gbps", "mbps",
    "bps", "gbit/s", "mbit/s", "awg", "°c", "°f", "c)", "w)",
}


def _is_unit_cell(c: str) -> bool:
    t = (c or "").strip().strip("()").strip().lower()
    if not t or len(t) > 7:
        return False
    return t in _UNITS_KNOWN


def _merge_unit_header(rows: list[list[str]]) -> list[list[str]]:
    """Fold a units-only SECOND header row into the first.

    Cisco's spec sheets write the header across two lines:

        Product ID | Cores | Clock Freq | Power | Cache Size | Highest DDR5 DIMM Clock
        (PID)      | (C)   | (GHz)      | (W)   | (MB)       | (MT/s)

    Only the first line reached the mapper, so a cell arrived as "Cores" with the bare value
    "60" and "Cache Size" with "300.00" -- and the unit, printed one line below, was thrown
    away. 277 cache sizes, 276 CPU TDPs and 221 clock frequencies were rejected UNIT_MISSING
    with their unit sitting in plain sight in the document.

    A row qualifies only when its non-empty cells are ALL unit-shaped and at least two are,
    so an ordinary data row is never mistaken for a unit line and folded into the header.
    """
    if len(rows) < 3:
        return rows
    second = rows[1]
    filled = [c for c in second[1:] if c]
    if len(filled) < 2 or not all(_is_unit_cell(c) for c in filled):
        return rows
    merged = list(rows[0])
    for i in range(1, min(len(merged), len(second))):
        u = (second[i] or "").strip()
        if u and _is_unit_cell(u):
            if not u.startswith("("):
                u = f"({u})"
            merged[i] = f"{merged[i]} {u}".strip()
    return [merged] + rows[2:]


# How many RAW rows the merge consumed. Folding row 1 into row 0 renumbers every row after it,
# so a locator built from the merged list points one row short of the cell it came from. The
# provenance auditor re-reads the RAW table, and it caught this immediately: 1002 facts
# "recorded 60 but cell holds 64" -- every one of them reading its neighbour's row. Values that
# are wrong by exactly one row are the most dangerous kind, because they are all plausible.
MERGE_ROW_OFFSET = 1


# ==================================================================================================
# The page reader. Everything below is imported by the provenance auditor (src/pipeline/
# gate-extract.ts READ_SCRIPT) as well as used here, so the audit re-reads a page with exactly the
# parser that produced the locator. A second implementation would be a copy of the parser grading
# the original, which is how a wrong cell stays wrong in both.
# ==================================================================================================

# ---- footnote markers ----------------------------------------------------------------------------
# Cisco's spec sheets carry footnote references as a raised, smaller digit GLUED to the end of the
# token it annotates. pdfplumber returns them as ordinary characters, so they arrive inside the
# value, inside the label -- and, expensively, inside the PART NUMBER:
#
#     Cisco VIC 15427 4x 10/25/50G mLOM C-Series w/Secure Boot5   <- footnote 5
#     Card Size1 | UPI1 Links | Highest DDR4 DIMM Clock Support (MHz)2
#     UCSX-GPU-RTXP45003   is  UCSX-GPU-RTXP4500  with footnote 3
#
# In the 4 Sep 2026 corpus that fabricated 156 part numbers carrying 792 facts -- and the two
# PDF-derived ground-truth maps had learned the fabrications from the same text, so _is_pid
# confirmed them. Only data/reference/datasheet-skus-full.json, built from HTML, knows the truth.
#
# The test is PHYSICAL, never a regex on the text: a marker is smaller than, raised above and
# touching the character to its left. A digit that is part of the token -- QSFP56, 15427, 2Rx4,
# RTXP4500, DISK-MODE-RAID-10, HX-CPU-I5318S -- is the same size on the same baseline and is kept.
# No shape rule can separate those two (CLAUDE.md: \b is the wrong tool for product strings); the
# glyph geometry can, and it is in the file.
SUPERSCRIPT_SIZE_RATIO = 0.85     # at most 85% of the size of the character it follows ...
SUPERSCRIPT_RAISE_RATIO = 0.15    # ... its baseline at least 15% of that size above it ...
SUPERSCRIPT_GLUE_RATIO = 0.70     # ... and touching it, not standing apart as its own token.
LINE_TOLERANCE = 3.0              # characters within 3pt of `top` are one rendered line
SUPERSCRIPT_JOINERS = ",;-/"      # "Boot5,6": a separator counts only BETWEEN two markers


def _char_key(c) -> tuple:
    """Identity of a character on a page. page.filter() hands back the same dicts, but keying on
    geometry rather than id() survives any copy pdfplumber may make."""
    return (round(float(c["x0"]), 2), round(float(c["top"]), 2), c["text"])


def _rendered_lines(chars) -> list:
    """Characters grouped into the lines the page actually renders, left to right.

    Grouped on `top`, not `bottom`: a superscript's TOP is within a point of its line (368.75 vs
    369.41 in c240m7-sff p38) while its BOTTOM is a third of the font size above it, which is the
    signal we are looking for -- grouping on the signal would split every marker off its line.

    Each group is then re-sorted LEFT TO RIGHT. Grouping needs `top` order and the scan needs `x0`
    order, and using one for both is not a detail: a marker's top is fractionally ABOVE its line,
    so in top order it is visited BEFORE the character it annotates and there is nothing to
    measure it against. "w/Secure Boot5", "Card Size1" and "UPI1 Links" all survived that way
    while "UCSX-GPU-RTXP45003" happened to be caught, because the character it was measured
    against was a whole column to its right -- a rule passing four cases out of five for a reason
    unrelated to the rule.
    """
    out: list = []
    for c in sorted(chars, key=lambda c: (round(float(c["top"]), 1), float(c["x0"]))):
        if out and float(c["top"]) - out[-1][0] <= LINE_TOLERANCE:
            out[-1][1].append(c)
        else:
            out.append([float(c["top"]), [c]])
    return [sorted(line, key=lambda c: float(c["x0"])) for _top, line in out]


def footnote_marker_chars(page) -> set:
    """The keys of every superscript footnote marker on the page."""
    marks: set = set()
    for line in _rendered_lines(page.chars):
        flag = [False] * len(line)
        last_full = None      # the last character at full size: what a marker is measured against
        prev = None           # the character immediately to the left, marker or not: the glue test
        for i, c in enumerate(line):
            t = c["text"]
            if not t or t.isspace():
                prev = None
                continue
            if t.isdigit() and last_full is not None and prev is not None:
                small = float(c["size"]) <= float(last_full["size"]) * SUPERSCRIPT_SIZE_RATIO
                raised = (float(last_full["bottom"]) - float(c["bottom"])
                          >= float(last_full["size"]) * SUPERSCRIPT_RAISE_RATIO)
                # A gap far to the LEFT is not glue either: before the groups were sorted by x0,
                # a negative gap of a whole column width passed this test and stripped a digit
                # measured against text it does not touch.
                gap = float(c["x0"]) - float(prev["x1"])
                glued = (-0.3 * float(last_full["size"]) <= gap
                         <= float(last_full["size"]) * SUPERSCRIPT_GLUE_RATIO)
                flag[i] = small and raised and glued
            if not flag[i]:
                last_full = c
            prev = c
        # A separator BETWEEN two markers ("UCSX-GPU-H200-NVL1,2"). Cisco sets it at full size on
        # the normal baseline, so it is not a superscript by any measurement of its own and the
        # geometry pass cannot see it -- only its neighbours identify it. Stripping the digits and
        # leaving it behind produced the PID "UCSX-GPU-H200-NVL ,", which is neither the right
        # answer nor the old wrong one.
        for i in range(1, len(line) - 1):
            if flag[i] or line[i]["text"] not in SUPERSCRIPT_JOINERS:
                continue
            if flag[i - 1] and flag[i + 1] and _touching(line[i - 1], line[i]) and _touching(line[i], line[i + 1]):
                flag[i] = True
        for i, c in enumerate(line):
            if flag[i]:
                marks.add(_char_key(c))
    return marks


def _touching(a, b) -> bool:
    """b starts where a ends: one token, not two."""
    return abs(float(b["x0"]) - float(a["x1"])) <= 0.3 * max(float(a["size"]), float(b["size"]))


def strip_footnote_markers(page):
    """(page without its footnote markers, how many were removed)."""
    drop = footnote_marker_chars(page)
    if not drop:
        return page, 0
    kept = page.filter(lambda o: o.get("object_type") != "char" or _char_key(o) not in drop)
    return kept, len(drop)


def read_page(page) -> tuple:
    """(tables, text, markers_removed, bleed_per_table) for one page -- as this extractor sees it.

    Every part comes from the SAME filtered view: a table cell and the page text must agree about
    what is on the page, or the provenance re-read grades the extractor against a document
    neither of them read. `bleed_per_table[i]` is column_bleed() over table i's RAW rows, which
    only exist here -- _clean() destroys the line breaks it needs.
    """
    p, nmarks = strip_footnote_markers(page)
    raw = [t for t in (p.extract_tables() or [])]
    grid = [[[_clean(cell) for cell in row] for row in tbl] for tbl in raw]
    bleed = [column_bleed([r for r in tbl if r]) for tbl in raw]
    return grid, (p.extract_text() or ""), nmarks, bleed


def text_lines(text) -> list:
    """The page text as normalised, non-empty lines -- the unit a PDF actually wraps to."""
    return [" ".join(l.split()).lower() for l in str(text or "").split("\n") if l.strip()]


# ---- is this string on the page ------------------------------------------------------------------
# Each piece must be near the last, and the whole needle must sit in a bounded band of the page.
#
# 8 lines between pieces, because that is what a real header block measures: in
# 5108b200m5m6-compute-specsheet p47 eight columns each wrap independently and extract_text
# renders them interleaved, so the one header "Clock Freq (GHz)" arrives as "clock" on line 2,
# "freq" on line 4 and "(ghz)" on line 9.
MAX_WRAP_LINE_GAP = 8
# The BAND is what stops a value being assembled from scraps: a needle of N words cannot occupy
# more than N lines, whatever the column width. A fixed count of pieces was the wrong shape for
# it -- a cell that wraps often is a LONG cell, not a wrong one, and capping pieces at 8 refused
# the 25-word "EMC - Emissions" compliance list that ucs-c240-m8-lff p59 prints down nine lines
# of one cell. Those were the last 8 mismatches of 200 after the fix, all of them the same fact.
MAX_WRAP_BAND = MAX_WRAP_LINE_GAP     # ... plus one line per word of the needle


def text_contains(needle, lines) -> bool:
    """Is `needle` on the page, allowing for the way a PDF WRAPS a table cell?

    extract_text renders a page line by line ACROSS every column, so a cell that wraps is never a
    contiguous run of the page text -- the neighbouring columns sit between its halves:

        cell   "Cisco VIC 15427 4x 10/25/50G mLOM C-Series w/Secure Boot"
        line   "UCSC-M-V5Q50GV2-D Cisco VIC 15427 4x 10/25/50G mLOM C-Series w/Secure mLOM HHHL, SS"
        line   "Boot Riser 1 or 2 ..."

    12 of the 20 provenance misses of 4 Sep 2026 were that, and the other 8 were table HEADERS
    split the same way ("Cache" on one line, "Size (MB)" on the next). Every one of them held the
    RIGHT value at the RIGHT locator: the re-read, not the extractor, was wrong.

    So the needle is consumed left to right as WHOLE WORDS: each run of words must be a substring
    of one line, and the next run must begin on that line or one of the next few. Nothing is
    dropped and nothing is normalised away -- every character of the needle must be found, in
    order -- so a value with one digit changed ("QSFP57" for "QSFP56") still fails, which is the
    half of this check that has to stay alive.
    """
    n = " ".join(str(needle or "").split()).lower()
    if not n:
        return False
    for line in lines:
        if n in line:
            return True
    words = n.split(" ")
    # A SEARCH, not a greedy walk. The greedy version took the longest match and, on a tie, the
    # first line carrying it -- so "Cores (C)" matched the bullet "cores: up to 60" nine lines
    # above its own table and then looked for "(c)" beside the bullet. 26 of the 33 misses at
    # sample 200 were that: the right words on the page, found in the wrong place first. The
    # memo is on (words consumed, line, fragments used), so backtracking stays linear.
    seen: set = set()
    band = MAX_WRAP_BAND + len(words)

    def walk(i: int, at, first) -> bool:
        if i >= len(words):
            return True
        key = (i, at, first)
        if key in seen:
            return False
        seen.add(key)
        lo = 0 if at is None else at
        hi = len(lines) if at is None else min(len(lines), at + MAX_WRAP_LINE_GAP + 1)
        if first is not None:
            hi = min(hi, first + band + 1)
        for j in range(lo, hi):
            frag, k = words[i], i
            while k < len(words) and frag in lines[j]:
                k += 1
                if k < len(words):
                    frag = frag + " " + words[k]
            while k > i:                      # the longest fragment first, then shorter ones
                if walk(k, j, j if first is None else first):
                    return True
                k -= 1
        return False

    return walk(0, None, None)


# ---- the length cap ------------------------------------------------------------------------------
VALUE_CAP = 160
LABEL_CAP = 120


def cap_value(s, cap: int = VALUE_CAP) -> tuple:
    """(text, was_truncated). A cell longer than the cap ends at a WORD boundary.

    `val[:160]` cut 50 values of the 4 Sep 2026 corpus mid-word and said nothing about it:
    "... KS C 9832 Cla", "... for the Cisco Compute Hyperco", "... minimum config with 1x T4 GPU
    = 12.9 lb; Fully loaded ". A half word reaches the normaliser looking exactly like a whole
    one. Truncating a 400-character compliance list is fine; truncating it SILENTLY is not, so
    the caller records a VALUE_TRUNCATED defect and the gate samples those facts first.

    A single token longer than half the cap has no boundary to back off to -- it is cut hard and
    still flagged, which is the honest answer rather than a value that overruns the cap.
    """
    s = str(s or "")
    if len(s) <= cap:
        return s, False
    cut = s.rfind(" ", 0, cap + 1)
    if cut < cap // 2:
        return s[:cap], True
    return s[:cut].rstrip(), True


# ---- a word split across a column boundary --------------------------------------------------------
# hci-c225m8-sff p66 renders an "Images" column whose placeholder text is wider than its own
# column, so the ruling line cuts through the WORD: the header arrives as
# ['Product ID (PID)', 'PID Description Im', 'ages'] and every row's description ends "... 3 Im"
# with "age not available" in the next cell. The value is a fiction ("3 Im Wire, 8AWG") and the
# label is a fiction ("PID Description Im"), and NO amount of re-reading catches it -- the cell
# really does hold that, and "3 Im" really is on the page inside the word "Image". Only the
# relationship between two columns shows it. The facts are kept (never guess, never silently
# drop); the table is flagged so the gate samples it first and the operator can see the count.
BLEED_MAX_FRAGMENT = 3       # "Im", "ag", "s" -- a bled fragment is a few characters, not a word
BLEED_MIN_WORD = 4           # ... and the two halves must make a word worth splitting
BLEED_MIN_ROWS = 2           # ... in at least two data rows, so one odd cell is not a defect

_BLEED_TAIL = re.compile(r"(?:^|\s)([A-Za-z]{1,%d})$" % BLEED_MAX_FRAGMENT)
_BLEED_HEAD = re.compile(r"^([a-z]+)")


def column_bleed(raw_rows: list) -> list:
    """Column pairs of a RAW table (cells still carrying their line breaks) where a word is split
    across the boundary. Returns [(left_column_index, fragment, continuation, data_rows)].

    THE HEADER HAS TO SHOW IT TOO. The first version asked only whether some rows had a short
    letter fragment on the left of a lowercase start on the right, and over the 8 re-extracted
    documents that fired 17 times of which 12 were nonsense: a description cell ending "2933 MHz"
    beside a wrapped URL continuing "ral/servers-...", "SAS" beside "https", "SSD" beside "ral".
    Two columns whose line breaks happen to land level are not a split word, and a detector that
    fires on everything is no detector (CLAUDE.md § 3).

    The defect is a column BOUNDARY in the wrong place, so it cuts every row of that column
    including the header -- 'PID Description Im' | 'ages'. Requiring the header to carry the same
    fragment is what separates the real thing from a coincidence of wrapping, and it costs
    nothing: a boundary that is right for the header is right for the column.
    """
    if len(raw_rows) < 2:
        return []
    hdr = raw_rows[0]
    out: list = []
    for ci in range(len(hdr) - 1):
        left, right = hdr[ci], hdr[ci + 1]
        if not left or not right:
            continue
        tail = _BLEED_TAIL.search(str(left).split("\n")[-1].rstrip())
        head = _BLEED_HEAD.match(str(right).split("\n")[0].lstrip())
        if not tail or not head or len(tail.group(1)) + len(head.group(1)) < BLEED_MIN_WORD:
            continue
        frag = tail.group(1)
        rows = 0
        for row in raw_rows[1:]:
            if ci + 1 >= len(row) or not row[ci] or not row[ci + 1]:
                continue
            llines, rlines = str(row[ci]).split("\n"), str(row[ci + 1]).split("\n")
            for k in range(min(len(llines), len(rlines))):
                t2 = _BLEED_TAIL.search(llines[k].rstrip())
                if t2 and t2.group(1) == frag and _BLEED_HEAD.match(rlines[k].lstrip()):
                    rows += 1
                    break
        if rows >= BLEED_MIN_ROWS:
            out.append((ci, frag, head.group(1), rows))
    return out


def run(browser, urls: list[str]) -> list[dict]:
    if not urls:
        print("give --urls-file <file of pdf urls>", file=sys.stderr)
        return []
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber is required: pip install pdfplumber", file=sys.stderr)
        return []

    global _KNOWN_NORM
    out: list[dict] = []
    sku_map = _load_sku_map()

    for url in urls:
        if not url.lower().split("?")[0].endswith(".pdf"):
            continue
        try:
            body = browser.fetch_binary(url)
        except Exception as e:  # noqa
            print(f"  ! {url[-56:]}: {type(e).__name__} {str(e)[:80]}", file=sys.stderr)
            continue
        if not body or body[:5] != b"%PDF-":
            print(f"  ! {url[-56:]}: not a PDF ({len(body)}B)", file=sys.stderr)
            continue

        _KNOWN_NORM = {_norm_pid(k) for k in sku_map.get(url, [])}
        # TRANSITIONAL, and it must not become permanent. The two PDF-derived ground-truth maps
        # were mined from this same text BEFORE footnote markers were stripped (scraper/
        # pdf_sku_map.py, which now reads through strip_footnote_markers), so for a PDF url they
        # list UCSX-GPU-RTXP45003 and never UCSX-GPU-RTXP4500. Worse, the fabrications reached
        # the 89,090-part catalogue the map looks tokens up in, so they are "known" everywhere.
        # Without this, the very PIDs the footnote fix repairs stop matching their own document
        # and their facts are dropped in silence -- 15 PIDs on the first two documents tried.
        # Remove it once datasheet-skus-pdf.json has been rebuilt AND the catalogue cleaned.
        trimmed = {n[:-1] for n in _KNOWN_NORM if len(n) > 6 and n[-1].isdigit()} - _KNOWN_NORM
        _KNOWN_NORM |= trimmed
        pids_seen: set[str] = set()
        before = len(out)
        counts = {"param": 0, "grid": 0, "markers": 0, "truncated": 0}
        defects: list[dict] = []

        # pdfplumber needs a file-like; the cache already holds the bytes on disk, but going
        # through fetch_binary keeps the robots/throttle/ledger discipline identical to every
        # other adapter, so re-reads stay free and auditable.
        import io
        try:
            pdf = pdfplumber.open(io.BytesIO(body))
        except Exception as e:  # noqa
            print(f"  ! {url[-56:]}: cannot open ({str(e)[:70]})", file=sys.stderr)
            continue

        with pdf:
            in_spec_section = False
            for pi, page in enumerate(pdf.pages):
                # ONE filtered view of the page: the tables and the text must agree about what the
                # document says, and the auditor re-reads through this same function.
                grid, text, nmarks, bleed = read_page(page)
                counts["markers"] += nmarks
                head = text.split("\n")[0] if text else ""
                if SPEC_SECTION.search(head) or SPEC_SECTION.search(text[:200]):
                    in_spec_section = True
                elif re.match(r"^(SPARE PARTS|CONFIGURING|STEP \d|ORDERING|CONTENTS|OVERVIEW)", head, re.I):
                    in_spec_section = False

                for ti, tbl in enumerate(grid):
                    rows = [r for r in tbl if r]
                    if len(rows) < 2:
                        continue
                    for ci_b, frag, cont, nrows in bleed[ti]:
                        defects.append({"code": "COLUMN_BLEED", "locator": f"p{pi}:t{ti}:r0:c{ci_b}",
                                        "detail": f"column {ci_b} ends '{frag}' where column {ci_b + 1} "
                                                  f"begins '{cont}' in {nrows} rows: the boundary cuts a word"})
                    # fold a units-only second header row in before anything reads the header
                    merged_rows = _merge_unit_header(rows)
                    # Every locator below must name the RAW row, not the merged one.
                    roff = MERGE_ROW_OFFSET if len(merged_rows) != len(rows) else 0
                    rows = merged_rows
                    hdr = rows[0]
                    ncols = max(len(r) for r in rows)

                    # Shape "param": two-column Parameter/Value. Document-scoped -- see the
                    # scope note at the top of this file.
                    if (in_spec_section and len(hdr) >= 2
                            and PARAM_HDR.match(hdr[0] or "") and VALUE_HDR.match(hdr[1] or "")):
                        for ri, r in enumerate(rows[1:], start=1):
                            if len(r) < 2:
                                continue
                            label, val = r[0], r[1]
                            if not label or BAD_LABEL.match(label) or len(label) > LABEL_CAP:
                                continue
                            if (val or "").lower() in EMPTY_VAL:
                                continue
                            loc = f"p{pi}:t{ti}:r{ri + roff}"
                            v, cut = cap_value(val)
                            rec = {"family_scope": "__document__", "label": label[:LABEL_CAP],
                                   "value": v, "shape": "PARAM", "locator": loc, "source_url": url}
                            if cut:
                                counts["truncated"] += 1
                                rec["defects"] = [{"code": "VALUE_TRUNCATED", "locator": loc,
                                                   "detail": f"cell is {len(val)} characters, stored the "
                                                             f"first {len(v)} to the last word boundary"}]
                            out.append(rec)
                            counts["param"] += 1
                        continue

                    # Shape "grid": PID-per-row x attribute-per-column, bound to real SKUs.
                    if ncols >= 3:
                        for ri, r in enumerate(rows[1:], start=1):
                            if not r or not r[0]:
                                continue
                            pid = r[0]
                            if not _is_pid(pid):
                                continue
                            pids_seen.add(pid)
                            if len(r) != len(hdr):
                                defects.append({"code": "GRID_MISALIGNED",
                                                "locator": f"p{pi}:t{ti}:r{ri + roff}",
                                                "detail": f"{pid}: {len(r)} cells vs header {len(hdr)}"})
                                continue
                            for ci in range(1, len(r)):
                                label, val = (hdr[ci] or ""), r[ci]
                                if not label or BAD_LABEL.match(label) or len(label) > LABEL_CAP:
                                    continue
                                if (val or "").lower() in EMPTY_VAL:
                                    continue
                                loc = f"p{pi}:t{ti}:r{ri + roff}:c{ci}"
                                v, cut = cap_value(val)
                                rec = {"sku": pid, "label": label[:LABEL_CAP], "value": v,
                                       "shape": "GRID", "locator": loc, "source_url": url}
                                if cut:
                                    counts["truncated"] += 1
                                    rec["defects"] = [{"code": "VALUE_TRUNCATED", "locator": loc,
                                                       "detail": f"cell is {len(val)} characters, stored the "
                                                                 f"first {len(v)} to the last word boundary"}]
                                out.append(rec)
                                counts["grid"] += 1

            npages = len(pdf.pages)

        out.append({"__doc__": True, "source_url": url, "pid_list": sorted(pids_seen),
                    "tables": npages, "defects": defects})
        print(f"  [cisco-specs-pdf] {url[-46:]}: {len(out)-before-1} facts "
              f"(param={counts['param']} grid={counts['grid']}), {npages}p, "
              f"{len(pids_seen)} PIDs, defects={len(defects)}, "
              f"footnote markers stripped={counts['markers']}, truncated={counts['truncated']}", flush=True)

    return out
