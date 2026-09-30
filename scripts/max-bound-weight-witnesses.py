"""Build data/reference/max-bound-weight-witnesses.json -- the cells ruling Q25 accepts as a cable's weight (30 Sep 2026).

    python3.11 scripts/max-bound-weight-witnesses.py [--check]

Ruling Q25: "'Module weight (Max)' -- accept as the cable's weight, labelled derived:max-bound. For shipping, the maximum is the
safe side; it never reads as a measured spec because the method says what it is."

Two held transceiver-cable sheets print a "Module weight (Max)" block: the label cell rowspanned down the block, the SUBJECT in
the next printed cell (a PID of the sheet, or a class such as "Optical modules"), the stated maximum in the last. No sub-header
row names the model column, so the extractor's shape D (which requires one) does not read it, and shape B files every cell as a
document-level value. This reads the block from the CACHED page with the extractor's own grid reader (`_rows`), exactly:

  * the label must be exactly "Module weight (Max)";
  * the row must print exactly two cells after the label: a subject and a value;
  * the subject must be a PID this datasheet attributes (the extractor's known-SKU map for the URL) -- a class row such as
    "Optical modules" names no part and is REFUSED, listed, never spread over the optics it might mean;
  * the value must be a mass the dictionary's own normaliser reads.

--check rebuilds the table and fails if it differs from the committed file (the witnesses are data, and data this derivation
writes must be reproducible from the cache by anyone).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
import adapters.cisco_specs_deep as deep          # noqa: E402  the ONE extractor's grid reader and PID test
from bs4 import BeautifulSoup                      # noqa: E402

OUT = ROOT / "data" / "reference" / "max-bound-weight-witnesses.json"
CACHE = ROOT / "scraper" / "cache"
# The two held sheets that print the block, found by a scan of every held HTML datasheet (30 Sep 2026: 31 PID rows, 2 sheets).
SHEETS = [
    ("da3cfbb69aa6bc9f", "https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-743172.html"),
    ("2e6f3ad86d6f7c1e", None),
]
LABEL = re.compile(r"^module weight \(max\)$", re.I)
MASS = re.compile(r"^\d+(?:\.\d+)?\s*(?:g|kg)$", re.I)


def sheet_url(doc_id: str, fallback: str | None) -> tuple[str, str]:
    """(url, cache_path) of a held document, read from the store so the witness names what the store names."""
    import psycopg
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    with psycopg.connect(env["DATABASE_URL"], autocommit=True, application_name="cisco/max-bound-witnesses") as c:
        row = c.execute("SELECT url, cache_path FROM source_docs WHERE doc_id = %s", (doc_id,)).fetchone()
    if not row:
        raise SystemExit(f"{doc_id}: not a held document")
    return row[0], row[1]


def build() -> dict:
    rows, refused = [], []
    for doc_id, _ in SHEETS:
        url, cache_path = sheet_url(doc_id, None)
        html = (CACHE / cache_path).read_text(encoding="utf-8", errors="replace")
        deep.extract_document(html, url)                 # sets this sheet's known-SKU set for _is_pid
        for ti, t in enumerate(BeautifulSoup(html, "lxml").find_all("table")):
            for ri, cells in enumerate(deep._rows(t)):
                if not cells or not LABEL.match((cells[0] or "").strip()):
                    continue
                runs = deep._runs(cells)
                loc = f"t{ti}:r{ri}"
                if len(runs) != 2:
                    refused.append({"doc_id": doc_id, "locator": loc, "why": f"{len(runs)} printed cells after the label, not subject + value"})
                    continue
                (subject, _, _), (value, vc, _) = runs
                if not deep._is_pid(subject.strip()):
                    refused.append({"doc_id": doc_id, "locator": loc, "subject": subject, "value": value,
                                    "why": "the subject is not a PID of this sheet (a class names no part)"})
                    continue
                if not MASS.match(value.strip()):
                    refused.append({"doc_id": doc_id, "locator": loc, "subject": subject, "value": value, "why": "not a plain mass"})
                    continue
                rows.append({"sku": subject.strip(), "doc_id": doc_id, "url": url, "cache_path": cache_path,
                             "label": cells[0].strip(), "locator": f"{loc}:c{vc}", "raw": value.strip()})
    return {"ruling": "Q25 (reviewer, 30 Sep 2026): 'Module weight (Max)' accepted as the cable's weight, method derived:max-bound",
            "built_by": "scripts/max-bound-weight-witnesses.py", "rows": rows, "refused": refused}


def main() -> int:
    table = build()
    text = json.dumps(table, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print(f"{'OK' if ok else 'DIFFERS'}: {len(table['rows'])} witness rows, {len(table['refused'])} refused")
        return 0 if ok else 1
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(table['rows'])} witness rows, {len(table['refused'])} refused")
    for r in table["refused"]:
        print(f"  REFUSED {r['doc_id']} {r['locator']}: {r.get('subject', '')} {r.get('value', '')} -- {r['why']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
