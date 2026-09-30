"""Build data/reference/temp-correction-witnesses.json -- the reviewer's temperature rulings of 30 Sep 2026.

    python3.11 scripts/temp-correction-witnesses.py [--check]

Rulings: "(1) Correction writer -- supersede the inherited value with the per-model read of the same cell"; "(2) Write the reads,
not the seeds: C1200 -> the per-model read supersedes the seed; C1300 -> the read with the intersection rule applied (0..50, the
range true including the cold-start condition), condition kept in raw; IE3400/3500 -> supersede the tier-0 seed with -40..60,
all enclosure conditions in raw."

Three kinds of row, each chosen by a RULE over the held corpus, never by a hand list:
  read          every shape-E 'Operating temperature' record the CURRENT extractor reads over the held Cisco HTML datasheets
                (a per-model value from an inline list, cisco_specs_deep.parse_inline_models);
  intersection  every inline cell shape E REFUSES because a numbered sentence after its last list conditions the values
                (today: the Catalyst 1300 cold-start minimum) -- the head is read per model by the same parser, and each
                model's raw is '<its value> … <the condition>', so the derivation sees every stated condition;
  statement     every OPEN temp_operating conflict whose rejected raw states two or more Celsius ranges (a document-level,
                condition-by-condition statement held against a part's value -- today the IE3x00 enclosure text); raw = that
                statement, located where the conflict says it was read.
The writer (scripts/correct-temps-by-sheet.mts) re-reads every row's cell on the cached page before it writes anything.
--check rebuilds and fails if the committed table differs.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import adapters.cisco_specs_deep as deep  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

OUT = ROOT / "data" / "reference" / "temp-correction-witnesses.json"
CACHE = ROOT / "scraper" / "cache"
CELSIUS_RANGE = re.compile(r"-?\d+(?:\.\d+)?\s*°?\s*C?\s*to\s*[+-]?\d+(?:\.\d+)?\s*°\s*C", re.I)
# READ BY HAND in the first dry run (30 Sep 2026), held with one reason each; a stale entry fails the build.
HOLD_DOCS = {
    "40ba250b2d5c1f6e": "IE2000: the same enclosure rule, but not in the ruled set -- its statement adds a fan-equipped case from "
                        "-34 °C, so the intersection would move the stored -40..60 to -34..60; asked, not written",
}
HOLD_SKUS = {
    "C130024MGP-4X": "the C1300 sheet's own typo of C1300-24MGP-4X, live as a part: a membership question (the typo-cable ruling), "
                     "no fact is written to it",
}


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def build() -> dict:
    import psycopg
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/temp-correction-witnesses") as c:
        docs = c.execute("""SELECT DISTINCT sd.doc_id, sd.url, sd.cache_path FROM source_docs sd JOIN doc_parts dp ON dp.doc_id = sd.doc_id
            JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
            WHERE v.slug = 'cisco' AND sd.doc_type = 'vendor_datasheet_html' AND sd.cache_path IS NOT NULL ORDER BY 1""").fetchall()
        held = c.execute("""SELECT p.sku, cf.id, cf.rejected_raw, cf.rejected_evidence->>'doc_id', cf.rejected_evidence->>'locator'
            FROM conflicts cf JOIN parts p ON p.id = cf.part_id JOIN vendors v ON v.id = p.vendor_id
            WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND cf.field_key = 'temp_operating' AND cf.resolved_at IS NULL
              AND cf.rejected_raw IS NOT NULL ORDER BY p.sku, cf.id""").fetchall()
        meta = dict((d, (u, cp)) for d, u, cp in c.execute("SELECT doc_id, url, cache_path FROM source_docs").fetchall())
    rows, missing = [], []
    for doc_id, url, cp in docs:
        f = CACHE / cp
        if not f.exists():
            missing.append(doc_id)
            continue
        html = f.read_text(encoding="utf-8", errors="replace")
        res = deep.extract_document(html, url)
        for x in res["facts"]:
            if x.get("shape") == "E" and x["label"] == "Operating temperature":
                rows.append({"kind": "read", "sku": x["sku"], "doc_id": doc_id, "url": url, "cache_path": cp, "locator": x["locator"],
                             "raw": x["value"]})
        for d in res["defects"]:
            if d["code"] != "INLINE_LIST_REFUSED" or "conditions the values" not in d["detail"]:
                continue
            m = re.match(r"^t(\d+):r(\d+)$", d["locator"])
            ti, ri = int(m.group(1)), int(m.group(2))
            grid = deep._rows(BeautifulSoup(html, "lxml").find_all("table")[ti])
            runs = deep._runs(grid[ri])
            text, c0 = runs[0][0], runs[0][1]
            if (grid[ri][0] or "").strip() != "Operating temperature":
                continue
            # the head (every list and its value) is read by the SAME parser; the tail after the last list is the condition
            toks = [t for t in deep.INLINE_TOKEN.finditer(text) if deep._is_pid(t.group(0).rstrip("="))]
            cut = toks[-1].end()
            head, tail = text[:cut], text[cut:].strip(" .")
            pairs, why, _skipped = deep.parse_inline_models(head, res["pids"])
            if pairs is None:
                continue
            for value, pids in pairs:
                for pid in pids:
                    rows.append({"kind": "intersection", "sku": pid, "doc_id": doc_id, "url": url, "cache_path": cp,
                                 "locator": f"t{ti}:r{ri}:c{c0}", "raw": f"{value} … {tail}", "fragments": [value, tail]})
    candidates: dict = {}
    for sku, cid, raw, rdoc, rloc in held:
        if len(CELSIUS_RANGE.findall(raw or "")) < 2 or not rdoc or not rloc or rdoc not in meta:
            continue
        # THE RULED SCOPE is ENCLOSURE-conditional statements that name NO model. Measured on the first build (30 Sep 2026): the
        # same "two or more ranges" rule also caught the C1200 per-model cell ('... for C1200-8T-D ... for other models' --
        # a LIST, whose intersection would give -5..50 models 0..50), the C9500X fan-conditional chassis range (a
        # configuration), and IE2000 / C9200 statements of other conditions. Those are listed as candidates, never written.
        names_model = any(deep._is_pid(t.group(0).rstrip("=")) or t.group(0)[0].isalpha() for t in deep.INLINE_TOKEN.finditer(raw))
        if names_model or not re.search(r"enclosure", raw, re.I):
            key = f"{rdoc} {raw[:70]}"
            candidates[key] = candidates.get(key, 0) + 1
            continue
        u, cp = meta[rdoc]
        rows.append({"kind": "statement", "sku": sku, "doc_id": rdoc, "url": u, "cache_path": cp, "locator": rloc, "raw": raw,
                     "conflict_id": cid})
    held = [{"sku": r["sku"], "doc_id": r["doc_id"], "why": HOLD_DOCS.get(r["doc_id"]) or HOLD_SKUS[r["sku"]]}
            for r in rows if r["doc_id"] in HOLD_DOCS or r["sku"] in HOLD_SKUS]
    stale = sorted((set(HOLD_DOCS) - {h["doc_id"] for h in held}) | (set(HOLD_SKUS) - {h["sku"] for h in held}))
    if stale:
        raise SystemExit(f"HOLD entries that no longer match any row (remove them): {stale}")
    rows = [r for r in rows if r["doc_id"] not in HOLD_DOCS and r["sku"] not in HOLD_SKUS]
    # one row per (sku, kind, doc, locator)
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda r: (r["sku"], r["kind"], r["doc_id"], r["locator"])):
        k = (r["sku"], r["kind"], r["doc_id"], r["locator"])
        if k not in seen:
            seen.add(k)
            uniq.append({k2: v for k2, v in r.items() if k2 != "conflict_id"})
    return {"ruling": "reviewer, 30 Sep 2026: supersede inherited values with the per-model read of the same cell; write the reads, not "
                      "the seeds (C1200 per-model read, C1300 read with the cold-start intersection, IE3x00 -40..60 intersection)",
            "built_by": "scripts/temp-correction-witnesses.py", "docs_not_cached_here": missing,
            "statement_candidates_not_ruled": dict(sorted(candidates.items())),
            "held": sorted({(h["sku"], h["doc_id"], h["why"]) for h in held}),
            "counts": {k: sum(1 for r in uniq if r["kind"] == k) for k in ("read", "intersection", "statement")}, "rows": uniq}


def main() -> int:
    table = build()
    text = json.dumps(table, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print(f"{'OK' if ok else 'DIFFERS'}: {table['counts']}")
        return 0 if ok else 1
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {table['counts']}; docs not cached here: {len(table['docs_not_cached_here'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
