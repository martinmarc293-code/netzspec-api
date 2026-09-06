"""Re-run a lane's extractor over documents we ALREADY HOLD, and rebuild their acquired JSON.

    python3.11 scripts/reextract-from-cache.py --source cisco-datasheets [--limit N]
                                               [--out DIR] [--into-today] [--all]

NO FETCHING. Every document it reads is already on this disk, so this is the "cache-only
extraction and applies" that stays allowed while scraping is stopped.

WHAT IT WAS BUILT TO TEST, AND WHAT IT ACTUALLY FOUND. On 6 Sep 2026, 938 of Cisco's 1,781
spec-bearing documents had their bytes on disk and ZERO facts in the store - over half the corpus -
and 1,252 by this script's wider count. Run the adapter over them by hand and they yield 104, 139,
245, 367 facts apiece, so the obvious reading was that the facts had been extracted and lost: the
apply consumes `runs/acquired/<slug>/<day>/`, and that intermediate artifact was destroyed in the
22:05 wipe on 5 Sep along with the cache. The cache came back from the box; the acquired JSON did
not, and only 2026-09-05 survives.

THAT READING WAS WRONG, and this script is what disproved it. Rebuilt over a 200-document sample:
9,507 facts extracted, 767 entries, and **zero facts land**. 529 of the 767 entries are
`family_scoped` and refused on purpose - the standing rule that a family value is never inherited
into a SKU the document does not list. Of the 376 facts that do reach a matched SKU (238 matched,
all exact, none unknown or ambiguous), 190 are section headings the mapper correctly calls
sentinels, 89 are rejected by a field rule, and the 97 "unmapped" labels turn out to be bundle
catalogue tables - "Platform: 2800 Series Router" whose value is "2851 Voice Security Bundle w/
CME, CUE, and Phone licenses". None of that is a specification.

So the zero is CORRECT. These are series and bundle datasheets whose per-SKU content is headings
and catalogue rows, and no amount of re-extraction will make facts out of them. The Cisco coverage
hole is a CRAWL gap, which the split says outright: of 65,724 Cisco parts with no
document-derived fact, 54,502 are linked only to non-spec documents and 9,190 to nothing at all -
97% - against 2,032 linked to a spec-bearing document.

KEEP IT ANYWAY, because "do we hold documents whose facts never landed?" is a question that recurs
per brand and per wipe, and answering it by hand costs an evening. It is also the only cheap way to
tell a genuine extractor regression from a corpus that simply has nothing to give: run it, dry-apply
the output, and read facts_ok.

WHAT IT DOES NOT DO. It does not write to the database and it does not decide anything. It
rebuilds the acquired JSON into a scratch directory, and `ingest apply-acquired` (without
--commit) will tell you what would land. `--into-today` puts the files where the running
supervisor's apply will pick them up, which IS a production write and is therefore opt-in.

RE-APPLYING DOES NOT DISTURB THE DOCUMENT CLASSIFICATION. `ensureSourceDoc`'s ON CONFLICT clause
does not list `doc_type` at all, so the class a document was given survives a re-apply untouched.
That was worth checking before proposing this: apply-acquired computes a `docType` of `vendor_page`
for every vendor source, and if that had been written back it would have flattened all 7,449
classifications in one run.

The source must be named. Which adapter produced a document is not recoverable after the fact -
only 58 of Cisco's spec documents still have a `fetches` row matching their URL - so this refuses
to guess and instead selects only documents the NAMED adapter declares it serves, by its own
`DOC_CLASSES` and host.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.path.realpath(ROOT / "scraper" / "cache"))
sys.path.insert(0, str(ROOT / "scraper"))


def load_env() -> dict:
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def total_facts(ext: dict) -> int:
    """Every subject's facts, not just the top-level one's.

    The same understatement the worker had to fix: a datasheet describes a family and its models,
    the RESULT shape puts one subject on top and the rest in `others`, and which lands on top is an
    accident of the adapter's grouping. Counting only the top level made a document that produced
    1,430 facts report `no_facts`.
    """
    n = len(ext.get("facts") or [])
    for o in ext.get("others") or []:
        n += len((o or {}).get("facts") or [])
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="adapter slug, e.g. cisco-datasheets")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--all", action="store_true", help="every eligible document, not --limit")
    ap.add_argument("--out", help="where to write the acquired JSON (default: a scratch dir)")
    ap.add_argument("--into-today", action="store_true",
                    help="write into runs/acquired/<slug>/<today>/ where the supervisor's apply "
                         "will consume it. THIS LEADS TO A PRODUCTION WRITE.")
    a = ap.parse_args()

    from sources import load_source                                    # noqa: E402
    src = load_source(a.source)
    classes = list(getattr(src, "DOC_CLASSES", ()) or ())
    host = getattr(src, "HOST", None)
    hosts = list(getattr(src, "HOSTS", ()) or ([host] if host else []))
    if not classes or not hosts:
        print(f"{a.source} declares no DOC_CLASSES/HOST, so there is no safe way to say which "
              f"documents are its own. Refusing to guess.", file=sys.stderr)
        return 2

    dsn = load_env().get("DATABASE_URL")
    if not dsn:
        print("no DATABASE_URL in .env", file=sys.stderr)
        return 2
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as c:
        rows = c.execute(
            """SELECT sd.doc_id, sd.url, sd.cache_path, sd.doc_type::text AS doc_type,
                      v.slug AS vendor,
                      (SELECT count(*) FROM facts f WHERE f.doc_id = sd.doc_id) AS facts,
                      (SELECT count(*) FROM doc_parts dp WHERE dp.doc_id = sd.doc_id) AS parts
                 FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
                WHERE sd.cache_path IS NOT NULL AND sd.doc_type::text = ANY(%s)
                ORDER BY sd.doc_id""", (classes,)).fetchall()

    eligible = []
    for r in rows:
        if urlsplit(r["url"]).hostname not in hosts:
            continue
        if r["facts"]:                       # it has already produced something; leave it alone
            continue
        if not (CACHE / (r["cache_path"] or "x")).is_file():
            continue                          # bytes gone: that is RECOVER's job, not this one
        eligible.append(dict(r))
    print(f"{len(rows)} documents in {a.source}'s classes; {len(eligible)} hold bytes and have "
          f"NO facts in the store")

    if a.into_today:
        out = ROOT / "runs" / "acquired" / a.source / datetime.now(timezone.utc).strftime("%Y-%m-%d")
    else:
        out = Path(a.out) if a.out else ROOT / "runs" / "reextract" / a.source
    out.mkdir(parents=True, exist_ok=True)

    todo = eligible if a.all else eligible[: a.limit]
    wrote = withfacts = nothing = failed = 0
    facts_total = 0
    reasons: dict[str, int] = {}
    for r in todo:
        html = (CACHE / r["cache_path"]).read_text(encoding="utf-8", errors="replace")
        task = {"id": r["doc_id"], "task": "datasheet", "key": r["url"],
                "part_id": None, "vendor": r["vendor"]}
        try:
            ext = src.extract(html, task) or {}
        except Exception as e:                                        # noqa: BLE001
            failed += 1
            reasons[type(e).__name__] = reasons.get(type(e).__name__, 0) + 1
            continue
        n = total_facts(ext)
        facts_total += n
        if n:
            withfacts += 1
        else:
            nothing += 1
        # The worker's shape exactly - apply-acquired reads source, result, task.part_id/key/vendor,
        # url, final_url, fetched_at and cache_path, and nothing else.
        (out / f"{r['doc_id']}.json").write_text(json.dumps({
            "source": a.source, "task": task, "url": r["url"], "final_url": r["url"],
            "fetched_at": datetime.now(timezone.utc).isoformat(), "fetch_id": None,
            "cached": True, "cache_path": r["cache_path"], "result": ext,
        }, ensure_ascii=False, indent=1, default=str), encoding="utf-8", newline="\n")
        wrote += 1

    print(f"\nread {len(todo)} documents from the cache, wrote {wrote} acquired files to {out}")
    print(f"   {withfacts} produced facts ({facts_total} in total), {nothing} produced none, "
          f"{failed} raised")
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"      {v} x {k}")
    if a.into_today:
        print("\nThese are in TODAY'S directory: the supervisor's next apply will consume them and "
              "that is a production write.")
    else:
        print(f"\nNothing has been written to the database. To see what WOULD land:\n"
              f"   npx tsx src/cli.ts ingest apply-acquired {out}   (add --commit to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
