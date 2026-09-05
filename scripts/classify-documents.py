"""Classify every held document, from the document itself, and report what cannot be classified.

    python3.11 scripts/classify-documents.py [--vendor cisco] [--limit N] [--out FILE]

WHY. `source_docs.doc_type` was stamped by whichever extractor read the file, so on 5 Sep 2026
2,495 of 5,811 Cisco "datasheets" (43%) were really end-of-life notices - documents that carry a
table of affected PIDs and no specifications at all. 18,977 hardware parts had no other
"datasheet" than one of those, which made a CRAWL gap look like an EXTRACTION failure and pointed
the coverage report at the wrong half of the problem.

The class of a document is a property of the document. This script decides it from three kinds of
evidence, in order, and records WHICH ONE decided:

  1. the URL          Cisco's own type code (c51 = EoL notice, c78 = data sheet) and the filename
                      markers, including the terminal abbreviations (-wp, -aag, -og, -specsheet)
  2. the HTML title   for pages with no marker in the URL at all
  3. the PDF title    metadata Title, then the first page's opening line

It is READ-ONLY by default and prints the counts plus every document it could not classify. It
writes nothing without --commit, and --commit is refused here on purpose: changing doc_type is a
write to the store and must go through a run with a gate, so this script produces the plan and
`ingest reclassify-docs` applies it. A document nobody can classify is REPORTED, never defaulted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.path.realpath(ROOT / "scraper" / "cache"))


def load_env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


# The authority families this script may touch. A document published by an aggregator or a
# distributor keeps its class whatever its title claims - see refineVendorDocClass in
# src/core/docClass.ts for the incident this rule comes from.
VENDOR_CLASSES = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_eol_bulletin",
                  "vendor_bulletin", "vendor_whitepaper", "vendor_qa", "vendor_guide",
                  "vendor_at_a_glance", "vendor_solution_overview", "vendor_brochure",
                  "vendor_page", "vendor_tool"]

TITLE_RE = re.compile(rb"<title[^>]*>([\s\S]{0,400}?)</title>", re.I)


def html_title(path: Path) -> str:
    """The <title>, read from the first 64 KB. Bytes, not text: the cache holds pages in several
    encodings and a decode error must not cost a classification."""
    try:
        head = path.open("rb").read(65536)
    except OSError:
        return ""
    m = TITLE_RE.search(head)
    if not m:
        return ""
    return re.sub(r"\s+", " ", m.group(1).decode("utf-8", "replace")).strip()


def pdf_title(path: Path) -> str:
    """PDF metadata Title, falling back to the first line of page 1.

    Cisco's spec sheets carry `Title: "Cisco UCS C220 M8 SFF Rack Server Spec Sheet"` and open with
    "Spec Sheet" - verified against the cached files on 5 Sep 2026. pdfplumber is imported lazily
    because it costs 300-900 MB per process and most documents never need it."""
    try:
        import pdfplumber  # noqa: PLC0415 - deliberately lazy, see docstring
    except ImportError:
        return ""
    try:
        with pdfplumber.open(path) as pdf:
            t = (pdf.metadata or {}).get("Title") or ""
            if t.strip():
                return re.sub(r"\s+", " ", str(t)).strip()
            if pdf.pages:
                first = (pdf.pages[0].extract_text() or "").strip().splitlines()
                return re.sub(r"\s+", " ", first[0]).strip() if first else ""
    except Exception:  # noqa - a corrupt or encrypted PDF is an unclassified document, not a crash
        return ""
    return ""


def cache_paths(url: str) -> list[Path]:
    sha = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return [p for p in (CACHE / f"{sha}{ext}" for ext in (".bin", ".pdf", ".html")) if p.exists()]


def classify_batch(rows: list[dict]) -> list[dict]:
    """Hand (url, title) pairs to the ONE classifier in src/core/docClass.ts.

    Shelling out to the TypeScript rather than reimplementing the rules in Python is the whole
    point: two copies of a classifier is two answers for one document, and this project has the
    scar (three sync scripts each grew their own config parser and every one of them was wrong).
    """
    payload = json.dumps([{"url": r["url"], "title": r.get("title") or ""} for r in rows])
    script = (
        'import{classifyDocument}from"file:///' + str(ROOT).replace("\\", "/") + '/src/core/docClass.ts";'
        'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{'
        'const inp=JSON.parse(d);'
        'process.stdout.write(JSON.stringify(inp.map(x=>classifyDocument(x.url,x.title))));});'
    )
    p = subprocess.run(["npx", "tsx", "--eval", script], input=payload, capture_output=True,
                       text=True, cwd=str(ROOT), shell=(os.name == "nt"), timeout=600)
    if p.returncode != 0:
        raise SystemExit(f"classifier failed: {p.stderr[-600:]}")
    return json.loads(p.stdout)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendor", default="cisco")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=str(ROOT / "runs" / "reports" / "doc-classification.json"))
    a = ap.parse_args()

    url = load_env()["DATABASE_URL"]
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as c:
        # Scoped by the VENDOR row and by the brand's own hosts. An earlier version matched
        # `url ILIKE '%cisco%'`, which swept in itprice.com/cisco-gpl/... - an aggregator that
        # republishes Cisco specifications under a page titled "... Data Sheet". The title rules
        # then proposed promoting 4,000 of them from aggregator_page (tier 3) to
        # vendor_datasheet_html (tier 2). What a document IS can be read from the document; WHO
        # PUBLISHED IT cannot, and must come from the source.
        q = """SELECT sd.doc_id, sd.url, sd.doc_type, sd.title
                 FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
                WHERE v.slug = %s AND sd.doc_type = ANY(%s)
                ORDER BY sd.url"""
        rows = c.execute(q + (f" LIMIT {a.limit}" if a.limit else ""),
                         (a.vendor, VENDOR_CLASSES)).fetchall()
    rows = [dict(r) for r in rows]
    print(f"{len(rows)} documents for vendor {a.vendor}", flush=True)

    # stage 1+2: URL, and the title we already hold in the database
    verdicts = classify_batch(rows)
    need_doc = [i for i, v in enumerate(verdicts) if v["cls"] == "unclassified"]
    print(f"  after URL + stored title: {len(rows) - len(need_doc)} classified, "
          f"{len(need_doc)} need the document read", flush=True)

    # stage 3: read the cached document for the residue only
    read_ok = 0
    for n, i in enumerate(need_doc, 1):
        if n % 100 == 0:
            print(f"    reading cached documents {n}/{len(need_doc)}", flush=True)
        paths = cache_paths(rows[i]["url"])
        if not paths:
            rows[i]["_note"] = "not in cache"
            continue
        p = paths[0]
        t = pdf_title(p) if p.suffix in (".bin", ".pdf") else html_title(p)
        if t:
            rows[i]["title"] = t
            read_ok += 1
        else:
            rows[i]["_note"] = f"no title in {p.suffix}"
    print(f"  titles recovered from the cache: {read_ok}", flush=True)

    if need_doc:
        redo = classify_batch([rows[i] for i in need_doc])
        for i, v in zip(need_doc, redo):
            verdicts[i] = v

    by_cls, by_via, changed = Counter(), Counter(), []
    unresolved = []
    for r, v in zip(rows, verdicts):
        by_cls[v["cls"]] += 1
        by_via[v["via"]] += 1
        if v["cls"] == "unclassified":
            unresolved.append({"url": r["url"], "note": r.get("_note", ""), "title": r.get("title") or ""})
        elif v["cls"] != r["doc_type"]:
            changed.append({"doc_id": r["doc_id"], "url": r["url"], "from": r["doc_type"],
                            "to": v["cls"], "via": v["via"], "title": (r.get("title") or "")[:120]})

    print("\nby class:")
    for k, n in by_cls.most_common():
        print(f"  {k:<26} {n:>5}")
    print("\nby evidence (top 12):")
    for k, n in by_via.most_common(12):
        print(f"  {k:<32} {n:>5}")
    pct = 100.0 * (len(rows) - len(unresolved)) / max(1, len(rows))
    print(f"\nCLASSIFIED: {len(rows) - len(unresolved)}/{len(rows)}  ({pct:.2f}%)")
    print(f"RECLASSIFICATIONS PROPOSED: {len(changed)}")
    for ch in changed[:10]:
        print(f"   {ch['from']:<22} -> {ch['to']:<22} {ch['via']:<22} {ch['url'][-58:]}")
    if unresolved:
        print(f"\nUNCLASSIFIED ({len(unresolved)}) - these need a rule or a look:")
        for u in unresolved[:25]:
            print(f"   {u['note'][:18]:<20} {u['title'][:40]:<42} {u['url'][-52:]}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"vendor": a.vendor, "documents": len(rows),
                               "classified": len(rows) - len(unresolved), "pct": round(pct, 2),
                               "by_class": dict(by_cls), "by_evidence": dict(by_via),
                               "changes": changed, "unclassified": unresolved}, indent=1),
                   encoding="utf-8")
    print(f"\nplan -> {out}")
    print("This script writes NOTHING. Applying the plan is a run with a gate: `ingest reclassify-docs`.")
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
