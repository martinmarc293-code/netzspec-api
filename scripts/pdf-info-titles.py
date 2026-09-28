"""The /Title of each PDF's document information dictionary, via pdfplumber (pdfminer resolves the trailer's /Info
even inside a compressed object stream). Reads a JSON list of paths on stdin, prints one JSON object per path.
Used by scripts/backfill-doc-titles.ts; decision docs/decisions/2026-09-28-untitled-documents.md."""
import json
import sys

import pdfplumber

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

for path in json.load(sys.stdin):
    out = {"path": path, "title": None, "error": None}
    try:
        with pdfplumber.open(path) as pdf:
            title = (pdf.metadata or {}).get("Title")
        if isinstance(title, bytes):
            out["error"] = "title is undecodable bytes"
        elif isinstance(title, str):
            out["title"] = title
    except Exception as e:  # one unreadable PDF is recorded, never allowed to stop the batch
        out["error"] = f"{type(e).__name__}: {str(e)[:120]}"
    print(json.dumps(out, ensure_ascii=False))
