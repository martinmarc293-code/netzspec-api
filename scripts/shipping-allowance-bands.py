"""Build data/reference/shipping-allowance-bands.json -- ruling Q23 (reviewer, 30 Sep 2026).

    python3.11 scripts/shipping-allowance-bands.py [--check] [--witness PATH]

Ruling Q23: "a ruled allowance, not blank. JTL needs Versandgewicht for shipping. Allowance by weight band = the median packaging
delta per band from the recorded switch file, stored as derived:shipping-allowance with the file as witness; the band table lives
in one place and is revisited when real shipping weights exist."

The witness is the recorded Hexwaren Cisco switch Main file (the operator's own shop export): for every row carrying both an
Artikelgewicht and a Versandgewicht, the packaging delta is Versandgewicht - Artikelgewicht. Measured 30 Sep 2026, the delta is
NOT a function of the weight (within one band it runs +0,6 to +2,5 kg), which is why the ruling takes the MEDIAN per band rather
than deriving a formula. The band edges are fixed here, in one place; each band records its n, median, and quartiles, so a
reader can see how wide the spread behind each median is.

The witness lives outside this repository (the hexcat project). The table records its path, size and sha256; --check rebuilds
from the file and fails if either the file or the table has moved.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "reference" / "shipping-allowance-bands.json"
DEFAULT_WITNESS = Path(r"D:\Project\hexcat\output\Cisco_Switches_LATEST_2d21e32\Hexwaren_Cisco_Switches_Main.csv")
# [lo, hi) in kg -- fixed here; a change is a change to the ruled table and moves its sha
EDGES = [0, 1, 2, 3, 5, 8, 12, 20, None]


def de(s: str) -> float | None:
    s = (s or "").strip()
    return float(s.replace(",", ".")) if s else None


def build(witness: Path) -> dict:
    raw = witness.read_bytes()
    text = raw.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    head = rows[0]
    gi, vi = head.index("Artikelgewicht"), head.index("Versandgewicht")
    pts = []
    for r in rows[1:]:
        g, v = de(r[gi]), de(r[vi])
        if g is not None and v is not None and g > 0 and v >= g:
            pts.append((g, round(v - g, 3)))
    bands = []
    for lo, hi in zip(EDGES[:-1], EDGES[1:]):
        ds = sorted(d for g, d in pts if g >= lo and (hi is None or g < hi))
        if not ds:
            raise SystemExit(f"band [{lo}, {hi}) holds no witness row -- the table cannot be ruled from this file")
        q = statistics.quantiles(ds, n=4) if len(ds) >= 2 else [ds[0], ds[0], ds[0]]
        bands.append({"from_kg": lo, "below_kg": hi, "n": len(ds), "allowance_kg": round(statistics.median(ds), 3),
                      "q1_kg": round(q[0], 3), "q3_kg": round(q[2], 3), "min_kg": ds[0], "max_kg": ds[-1]})
    return {"ruling": "Q23 (reviewer, 30 Sep 2026): Versandgewicht = Artikelgewicht + the median packaging delta of its weight band, "
                      "stored as derived:shipping-allowance with the recorded switch file as witness",
            "built_by": "scripts/shipping-allowance-bands.py",
            "witness": {"path": str(witness), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "rows_used": len(pts),
                        "rows_total": len(rows) - 1},
            "bands": bands}


def main() -> int:
    witness = Path(sys.argv[sys.argv.index("--witness") + 1]) if "--witness" in sys.argv else DEFAULT_WITNESS
    table = build(witness)
    text = json.dumps(table, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print(f"{'OK' if ok else 'DIFFERS'}: {len(table['bands'])} bands from {table['witness']['rows_used']} witness rows")
        return 0 if ok else 1
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {table['witness']['rows_used']} of {table['witness']['rows_total']} rows used")
    for b in table["bands"]:
        print(f"  [{b['from_kg']}, {b['below_kg']}) kg  n={b['n']:4d}  allowance {b['allowance_kg']} kg  (q1 {b['q1_kg']}, q3 {b['q3_kg']}, range {b['min_kg']}..{b['max_kg']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
