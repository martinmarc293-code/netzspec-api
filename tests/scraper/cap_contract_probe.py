"""Runs the HTML adapter's REAL cap on cells the TypeScript gate then has to accept.

Prints one JSON object on stdout: for each case the cell as the document holds it, the value the
adapter stored, whether it was cut, and the defects it recorded. `tests/capContract.test.ts` feeds
that to `cellMatches` -- the adapter's ceiling and the gate's comparison are ONE contract across two
languages, and a test that exercised either half alone would pass while the pair was broken.

A stand-in for the cap would test the logic I was thinking about rather than the code that runs
(D:/Project/CLAUDE.md: "copy the real function into the test, verbatim"), so this imports it.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "scraper"))

from adapters.cisco_specs_deep import cap_cell, MAX_CELL, LIST_CELL_CAP  # noqa: E402

BULLET = chr(9679)  # the glyph Cisco uses; written as a codepoint so no escape travels anywhere


def compliance_list(target: int) -> str:
    """A bulleted list of real-looking compliance entries, at least `target` characters long."""
    items = ["IEEE 802.1AB LLDP", "IEEE 802.1ae MACsec", "IEEE 802.1ak MVRP",
             "IEEE 802.1ax Link Aggregation", "EN 55032 Class A", "EN 61000-3-2",
             "CISPR 32 Class A", "KS C 9832 Class A", "AS/NZS CISPR 32 Class A",
             "CNS 13438 Class A", "IEC 60950-1 Second Edition", "UL 60950-1"]
    out = []
    i = 0
    while len(" ".join(out)) < target:
        out.append(BULLET + " " + items[i % len(items)])
        i += 1
    return " ".join(out)


cases = {}

# (b) the case the reviewer named: a 700-character compliance list must survive whole.
cell = compliance_list(700)
defects = []
stored, cut = cap_cell(cell, "t18:r3:c1", defects)
cases["list_700"] = {"cell": cell, "stored": stored, "cut": cut, "defects": defects}

# A list past the ceiling: cut, at a word boundary, and RECORDED.
cell = compliance_list(LIST_CELL_CAP + 500)
defects = []
stored, cut = cap_cell(cell, "t18:r4:c1", defects)
cases["list_over_ceiling"] = {"cell": cell, "stored": stored, "cut": cut, "defects": defects}

# A scalar keeps 160 with the same discipline. Two bullets would make it a list, so this has none.
cell = ("Stacking bandwidth 480 Gbps with a dedicated backplane connector on every member, "
        "supporting up to eight members in a single logical switch under one management plane")
defects = []
stored, cut = cap_cell(cell, "t6:r2:c3", defects)
cases["scalar_over_cap"] = {"cell": cell, "stored": stored, "cut": cut, "defects": defects}

# A scalar that fits is stored verbatim and flags nothing.
cell = "480 Gbps"
defects = []
stored, cut = cap_cell(cell, "t6:r2:c4", defects)
cases["scalar_fits"] = {"cell": cell, "stored": stored, "cut": cut, "defects": defects}

print(json.dumps({"caps": {"scalar": MAX_CELL, "list": LIST_CELL_CAP}, "cases": cases}))
