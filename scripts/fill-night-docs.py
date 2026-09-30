"""The documents the FILL night extracts: every cisco-datasheets datasheet task the lane FINISHED since the watermark.

    python3 scripts/fill-night-docs.py --since <ISO watermark> --out-dir <dir>

Writes <dir>/html.txt and <dir>/pdf.txt (one URL per line, for scraper/run.py --urls-file) and <dir>/docs.json (counts and
the new watermark), and prints one line. A task is FINISHED when the worker set it `done` (fetched, or served from the cache
-- a re-read, which the order allows); listing tasks are discovery pages and are not documents. The new watermark is the
database's now() at the moment of the query, so a task finished while this runs belongs to the next night, not to none.
A URL that is not held in the cache is left out and COUNTED (`not_cached`), never passed on: run.py --cache-only refuses a
miss, and one missing file must not stop a night's extraction of the others.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scraper" / "cache"


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True)
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    import psycopg
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/fill-night-docs") as c:
        now = c.execute("SELECT now()").fetchone()[0]
        rows = c.execute("""SELECT q.url FROM fetch_queue q JOIN sources s ON s.id = q.source_id
                             WHERE s.slug = 'cisco-datasheets' AND q.task = 'datasheet' AND q.status = 'done'
                               AND q.updated_at > %s::timestamptz AND q.updated_at <= %s AND q.url IS NOT NULL
                             ORDER BY q.url""", (a.since, now)).fetchall()
    html, pdf, missing = [], [], []
    for (url,) in rows:
        key = hashlib.sha1(url.encode("utf-8")).hexdigest()
        is_pdf = url.lower().split("?")[0].endswith(".pdf")
        if not (CACHE / f"{key}.{'bin' if is_pdf else 'html'}").exists():
            missing.append(url)
            continue
        (pdf if is_pdf else html).append(url)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "html.txt").write_text("".join(u + "\n" for u in html), encoding="utf-8")
    (out / "pdf.txt").write_text("".join(u + "\n" for u in pdf), encoding="utf-8")
    info = {"since": a.since, "watermark_next": now.isoformat(), "finished": len(rows), "html": len(html), "pdf": len(pdf),
            "not_cached": len(missing), "not_cached_examples": missing[:5]}
    (out / "docs.json").write_text(json.dumps(info, indent=1) + "\n", encoding="utf-8")
    print(f"documents finished since {a.since}: {len(rows)} (html {len(html)}, pdf {len(pdf)}, not cached {len(missing)}); "
          f"next watermark {info['watermark_next']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
