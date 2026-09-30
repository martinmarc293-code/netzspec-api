"""Build data/reference/single-model-weight-witnesses.json -- ruling Q24 (reviewer, 30 Sep 2026).

    python3.11 scripts/single-model-weight-witnesses.py [--check]

Ruling Q24: "per-SKU when every hardware subject on the sheet is one model, including its regional and licence-suffix
variants. A sheet about one model states that model's weight; Class B is for sheets covering a series. The 48 get it, with the
sheet as source."

A sheet QUALIFIES only when all of this holds, each measured rather than assumed:

  1. ABOUT ONE MODEL -- every live HARDWARE part the store links to the sheet shares one model (parts.family), and every
     hardware PID the extractor reads as a subject of the sheet is that model too. The PID list alone is not enough, and the
     first sizing learned it: a CRS line-card sheet whose card PID the extractor does not recognise reads as a sheet about the
     CFP optic it lists, and would have given the optic the line card's 7.8 kg.
  2. ONE WEIGHT STATEMENT -- the sheet's document-level weight cells (a mass in a cell whose own text, row label, column
     header or section says "weight", with no PID in its row or column) state exactly ONE distinct mass. Five antenna weights on
     one sheet, or an AC and a DC figure, are not one model's weight.
  3. A PLAIN MASS -- the statement is the whole cell under a weight label, or the "Weight: ..." segment of a bulleted cell,
     and it is ONE mass: a bound ("< 2Kg", "maximum", "up to"), a multiple ("2x 18.34 oz"), or two masses for two things
     ("Main Device: 29; Magnet Cover: 10g") is refused and listed.
  4. NO OTHER BUILD ORDERED -- no table on the sheet names, as a row or column subject, a live hardware part of another build
     of the model (same stem, same category, a different model). Condition 1 cannot see it, because the store links what it
     links: the RSP440 sheet orders "A9K-RSP440-TR and A9K-RSP440-SE" beside -LT (three builds, different DRAM) and the CRS LSP
     sheet orders CRS-LSP beside CRS-LSP400G, each linked to one of them. A BUNDLE is not another build: NC55-24X100G-SB is the
     -SE line card plus a right-to-use licence, and the sheet says so in its Subcomponent column, which is not a subject
     position. A model named only in prose, an accessory description, a footer or a "Chassis compatibility" cell does not trip
     it either (MX250 / MX450, the MT sensors, RFGW-10: read 30 Sep 2026).

Everything refused is listed with its reason. --check rebuilds and fails if the committed table differs.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import adapters.cisco_specs_deep as deep          # noqa: E402
from bs4 import BeautifulSoup                      # noqa: E402

OUT = ROOT / "data" / "reference" / "single-model-weight-witnesses.json"
CACHE = ROOT / "scraper" / "cache"
MASS = re.compile(r"(?<![0-9.])\d+(?:[.,]\d+)?\s*(?:kg|kgs|kilograms?|lbs?|pounds?|g|grams?|oz|ounces?)(?![a-z])", re.I)
WORD = re.compile(r"weight", re.I)
BOUND = re.compile(r"[<>≤≥~]|(?<![a-z])(?:max|maximum|min|minimum|up\s+to|approx|approximately|about|less\s+than|under)(?![a-z])", re.I)
MULTIPLE = re.compile(r"(?<![a-z0-9])\d+\s*x\s*\d", re.I)
SEGMENT = re.compile(r"weight\s*:\s*([^•●◦;]+)", re.I)
# READ BY HAND, 30 Sep 2026 (every qualifying sheet's title against its model). Each is a sheet whose SUBJECT is not the one model
# the store links to it -- a condition no store query can see, because the subject is not in the store. One reason per entry;
# a stale entry (a doc that no longer qualifies) fails the build, so the list cannot rot into a hole.
# (NC55-24X100G-SB was held here for an hour as "two builds" and is NOT: the sheet's ordering table makes -SB the BUNDLE of the
# -SE line card plus a right-to-use licence, the same shape as NC55-18H18F-BA -- one hardware model, a licence-suffix variant.)
HOLD = {
    "2f81e763d10ce625": "a CRS-3 100GE interface-module sheet; the store links only the CFP-100G-LR4 optic it takes",
    "ae8f54541c56e872": "a Nexus 7700 F3 48-port module sheet; the store links only the FET-10G it takes",
}


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def candidates() -> list[dict]:
    """Held HTML datasheets whose every linked live HARDWARE part shares one model (parts.family)."""
    import psycopg
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/single-model-witnesses") as c:
        rows = c.execute("""
          SELECT sd.doc_id, sd.url, sd.cache_path, min(p.family) AS model, count(DISTINCT p.family) AS models,
                 array_agg(DISTINCT p.sku) AS skus
            FROM source_docs sd JOIN doc_parts dp ON dp.doc_id = sd.doc_id JOIN parts p ON p.id = dp.part_id
            JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND sd.doc_type = 'vendor_datasheet_html'
             AND sd.cache_path IS NOT NULL
           GROUP BY 1, 2, 3 HAVING count(DISTINCT p.family) = 1 AND bool_and(p.family IS NOT NULL)""").fetchall()
        store = c.execute("""SELECT upper(p.sku), p.family, cat.slug FROM parts p JOIN vendors v ON v.id = p.vendor_id
                               JOIN categories cat ON cat.id = p.category_id
                              WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'""").fetchall()
    fam = {s: f for s, f, _ in store}
    cat = {s: k for s, _, k in store}
    return [{"doc_id": r[0], "url": r[1], "cache_path": r[2], "model": r[3], "skus": sorted(r[5]), "fam": fam, "cat": cat} for r in rows]


TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9./+=_-]*[A-Za-z0-9+=/]")


def build_stem(model: str) -> str:
    """What another BUILD of this model starts with: every segment but the last ("A9K-RSP440-LT" -> "A9K-RSP440-", "CRS-LSP400G"
    -> "CRS-"), or the letters of a one-segment model ("MX250" -> "MX")."""
    segs = model.upper().split("-")
    if len(segs) > 1:
        return "-".join(segs[:-1]) + "-"
    m = re.match(r"[A-Z]+", segs[0])
    return m.group(0) if m else segs[0]


def other_builds_listed(grids: list, d: dict) -> list[str]:
    """Live hardware SKUs of ANOTHER BUILD of the model (same stem, same category, a different model), named in a row subject
    (a first cell) or a column subject (a header cell) of any table: the positions the extractor reads subjects from, matched
    by TOKEN, so a cell naming two builds ("A9K-RSP440-TR and A9K-RSP440-SE", which is not itself a PID) is read, not skipped.
    A sheet that orders another build is about more than one model, whatever the store links to it (condition 4).
    Measured before it was narrowed: "any other model of the category" also fired on accessories and bare product names
    (the store's MT11 beside MT11-HW on four sensor sheets, RFGW-LC-COVER beside the line card it blanks) -- a cover is not
    a build, and those sheets are about one product each."""
    mine = {d["cat"].get(s.upper()) for s in d["skus"]}
    stem = build_stem(d["model"])
    found = set()
    for grid in grids:
        subjects = [row[0] for row in grid if row] + (list(grid[0][1:]) if grid else [])
        for cell in subjects:
            for t in TOKEN.findall(cell or ""):
                for u in (t.upper(), t.upper().rstrip("=.")):
                    if u in d["fam"] and d["fam"][u] != d["model"] and d["cat"].get(u) in mine and u.startswith(stem):
                        found.add(u)
    return sorted(found)


def statement(cell: str, label: str) -> tuple[str | None, str | None]:
    """(the one mass statement, None) or (None, why not)."""
    text = " ".join(cell.split())
    if WORD.search(label or "") and not WORD.search(text):
        stmt = text                                   # the whole cell under a weight label
    else:
        segs = SEGMENT.findall(text)
        if len(segs) != 1:
            return None, f"{len(segs)} 'Weight:' segments in the cell"
        stmt = segs[0].strip(" .,")
    if re.search(r"[;:]", stmt):
        # "Main Device: 29; Magnet Cover: 10g" -- sub-labels mean a list of things, even when only one of them has a unit
        return None, f"a sub-labelled list, not one weight: {stmt[:60]!r}"
    if BOUND.search(stmt):
        return None, f"a bound, not a value: {stmt[:60]!r}"
    if MULTIPLE.search(stmt):
        return None, f"a multiple, not one unit's weight: {stmt[:60]!r}"
    masses = MASS.findall(stmt)
    if not masses:
        return None, f"no mass: {stmt[:60]!r}"
    # one mass, or the same mass printed in two units ("9.5 lb (4.32 kg)", "1.4 kg / 3.08 lbs"): at most two figures, and
    # never two figures in the same unit family, which is two things
    units = [re.sub(r"[\d.,\s]", "", m).lower().rstrip("s") for m in masses]
    metric = sum(u in ("kg", "kilogram", "g", "gram") for u in units)
    if len(masses) > 2 or (len(masses) == 2 and metric != 1):
        return None, f"{len(masses)} masses, not one: {stmt[:60]!r}"
    return stmt, None


FACTOR = {"kg": 1.0, "kilogram": 1.0, "g": 0.001, "gram": 0.001, "lb": 0.45359237, "pound": 0.45359237, "oz": 0.028349523125, "ounce": 0.028349523125}


def expected_kg(stmt: str) -> float:
    """The kilograms the statement PRINTS: its metric figure when it has one (ruling: never a converted one), else its only
    figure converted. The writer must reproduce this through the dictionary's own normaliser, or it writes nothing."""
    figs = []
    for m in MASS.findall(stmt):
        num = float(re.match(r"\d+(?:[.,]\d+)?", m).group(0).replace(",", "."))
        unit = re.sub(r"[\d.,\s]", "", m).lower().rstrip("s")
        figs.append((num, unit))
    metric = [(n, u) for n, u in figs if u in ("kg", "kilogram", "g", "gram")]
    n, u = (metric or figs)[0]
    return round(n * FACTOR[u], 6)


def build() -> dict:
    rows, refused = [], []
    for d in candidates():
        path = CACHE / d["cache_path"]
        if not path.exists():
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": "not in this cache"}); continue
        html = path.read_text(encoding="utf-8", errors="replace")
        try:
            out = deep.extract_document(html, d["url"])
        except ValueError as e:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": f"refused by the extractor: {e}"}); continue
        subj = {d["fam"].get(p.upper()) for p in out["pids"] if d["fam"].get(p.upper())}
        if subj - {d["model"]}:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": f"the sheet's subject PIDs name other models: {sorted(subj - {d['model']})[:4]}"}); continue
        grids = [deep._rows(t) for t in BeautifulSoup(html, "lxml").find_all("table")]
        stmts, whys = {}, []
        for ti, grid in enumerate(grids):
            if len(grid) < 2:
                continue
            header = grid[0]
            for ri, cells in enumerate(grid):
                for ci, cell in enumerate(cells):
                    if not cell or not MASS.search(cell):
                        continue
                    label = cells[0] if cells and ci > 0 else ""
                    ctx = " | ".join([label, header[ci] if ci < len(header) else "", cell])
                    if not WORD.search(ctx):
                        continue
                    if any(j != ci and x and deep._is_pid(x.strip()) for j, x in enumerate(cells)) or \
                       (ri > 0 and ci < len(header) and header[ci] and deep._is_pid(header[ci].strip())):
                        continue                          # a model-attributed cell is the extractor's, not this rule's
                    s, why = statement(cell, label)
                    if s is None:
                        whys.append(why); continue
                    stmts.setdefault(" ".join(s.split()), f"t{ti}:r{ri}:c{ci}")
        if not stmts:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": "no plain weight statement: " + "; ".join(sorted(set(whys))[:3])}); continue
        if len(stmts) > 1:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": f"{len(stmts)} different weight statements: {list(stmts)[:3]}"}); continue
        (stmt, loc), = stmts.items()
        builds = other_builds_listed(grids, d)
        if builds:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": f"the sheet orders another build of the model as a table subject: {builds[:4]}"}); continue
        if d["doc_id"] in HOLD:
            refused.append({"doc_id": d["doc_id"], "model": d["model"], "why": f"HELD (read by hand): {HOLD[d['doc_id']]}"}); continue
        rows.append({"doc_id": d["doc_id"], "url": d["url"], "cache_path": d["cache_path"], "model": d["model"], "skus": d["skus"],
                     "locator": loc, "statement": stmt, "expected_kg": expected_kg(stmt)})
    stale = sorted(set(HOLD) - {r["doc_id"] for r in refused if r["why"].startswith("HELD")})
    if stale:
        raise SystemExit(f"HOLD entries that no longer qualify (remove them): {stale}")
    return {"ruling": "Q24 (reviewer, 30 Sep 2026): a document-level weight on a sheet whose every hardware subject is one model is a per-SKU source",
            "built_by": "scripts/single-model-weight-witnesses.py", "rows": sorted(rows, key=lambda r: r["doc_id"]),
            "refused": sorted(refused, key=lambda r: r["doc_id"])}


def main() -> int:
    table = build()
    text = json.dumps(table, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print(f"{'OK' if ok else 'DIFFERS'}: {len(table['rows'])} sheets, {len(table['refused'])} refused")
        return 0 if ok else 1
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(table['rows'])} qualifying sheets, {len(table['refused'])} refused")
    for r in table["rows"]:
        print(f"  {r['doc_id']} {r['model']:<22} {r['statement'][:50]!r:<54} {r['locator']}  parts: {', '.join(r['skus'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
