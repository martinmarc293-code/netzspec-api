"""Build the datasheet -> SKU ground-truth map for CACHED PDFs.

    python scraper/pdf_sku_map.py --out data/universe/datasheet-skus-pdf.json

WHY
build-datasheet-skus.mjs scans scraper/cache/*.html and therefore knows nothing about the 332
PDF datasheets. cisco_specs_pdf takes its ground truth from that map, so on a PDF it starts
with an EMPTY known-SKU set, _is_pid returns false for every row, and the document reports
"0 PIDs, grid=0" -- only document-scoped Parameter/Value facts, with no pid_list. Without a
pid_list the merge step cannot scope-check anything, so those facts are refused too and the
whole PDF pass yields nothing bindable. A 141-page UCS spec sheet produced 79 facts and not
one of them could reach a part.

Same technique as the HTML map and for the same reason: no PID pattern is invented. We already
know 89,090 part numbers, so extract the PDF's text, tokenise it, and look each token up in
that set. A hit is exact by construction.

Text extraction only -- no table parsing, no layout analysis -- so this stays fast over 332
documents of up to 200 pages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

CACHE = Path("scraper/cache")
# Deliberately permissive: this only produces CANDIDATES and the known-SKU set decides. It must
# stay permissive because Cisco Meraki ships real devices called Z4, MV2 and MR4 and a
# minimum-length rule deleted six of them once.
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9./+-]{1,39}=?")


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def variants(tok: str):
    t = tok.upper().rstrip(".,;:)]")
    out = {t}
    out.add(t[:-1] if t.endswith("=") else t + "=")
    if t.startswith("C1-"):
        out.add(t[3:])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls-file", default="data/universe/pdf-datasheet-urls.txt")
    ap.add_argument("--out", default="data/universe/datasheet-skus-pdf.json")
    ap.add_argument("--skus", default="data/universe/sku-category.json")
    ap.add_argument("--restart", action="store_true", help="ignore any existing output and start over")
    args = ap.parse_args()

    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber required", file=sys.stderr)
        return 1

    known_raw = json.loads(Path(args.skus).read_text(encoding="utf-8"))
    known = {}
    for sku in known_raw:
        known[norm(sku)] = sku
    print(f"known SKUs: {len(known)}", flush=True)

    urls = [u.strip() for u in Path(args.urls_file).read_text(encoding="utf-8").splitlines() if u.strip()]

    # Resume: anything already recorded in the output file is skipped, so a restart costs
    # nothing. Combined with the checkpoint below this makes the run interruptible, which
    # matters when it takes hours and shares a machine with everything else.
    out: dict[str, list[str]] = {}
    outp = Path(args.out)
    if outp.exists() and not args.restart:
        try:
            out = json.loads(outp.read_text(encoding="utf-8"))
            print(f"resuming: {len(out)} documents already mapped", flush=True)
        except Exception:  # noqa
            out = {}
    scanned = miss = 0

    for i, url in enumerate(urls, 1):
        if url in out:
            continue
        f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".bin")
        if not f.exists():
            miss += 1
            continue
        body = f.read_bytes()
        if body[:5] != b"%PDF-":
            miss += 1
            continue
        scanned += 1
        hits: set[str] = set()
        try:
            import io
            with pdfplumber.open(io.BytesIO(body)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    if not text:
                        continue
                    for m in TOKEN.finditer(text):
                        tok = m.group(0)
                        if not any(ch.isdigit() for ch in tok) and len(tok) > 6:
                            continue
                        for v in variants(tok):
                            sku = known.get(norm(v))
                            if sku:
                                hits.add(sku)
                                break
        except Exception as e:  # noqa
            print(f"  ! {url[-50:]}: {type(e).__name__} {str(e)[:70]}", file=sys.stderr)
            continue
        # Record the empty result too. A PDF with no known SKUs is still a PDF we have READ,
        # and leaving it out of the map means a resume re-extracts its text — the single most
        # expensive thing this script does — to learn the same nothing again. Downstream sees
        # no difference: get(url, []) returns the same empty list either way.
        out[url] = sorted(hits)
        if i % 25 == 0:
            # CHECKPOINT. The first version wrote only at the end, so pausing the run at 50 of
            # 332 documents threw away every one of them -- an hour of PDF text extraction for
            # nothing. Anything that takes hours must be resumable, and resumable means writing
            # as it goes, not promising to write later.
            Path(args.out).write_text(json.dumps(out), encoding="utf-8")
            print(f"  {i}/{len(urls)}  docs-with-skus={len(out)}  (checkpointed)", flush=True)

    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    total_pairs = sum(len(v) for v in out.values())
    distinct = len({s for v in out.values() for s in v})
    print(f"\nscanned {scanned} PDFs ({miss} not cached / not a PDF)")
    print(f"PDFs carrying at least one known SKU: {len(out)}")
    print(f"doc->SKU pairs: {total_pairs} | distinct SKUs reachable via PDF: {distinct}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
