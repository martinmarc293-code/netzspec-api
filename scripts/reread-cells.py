"""Re-read cells at stored locators from cached documents, with the CURRENT extractor. No database, no network.

    python3 scripts/reread-cells.py <in.json> <out.json>

in:   [{"doc_id": ..., "url": ..., "cache_path": ..., "locators": ["t21:r2:c1", ...]}, ...]
out:  {"cache_dir": ..., "docs": {doc_id: {"status": "ok" | "cache_miss" | "error:<Type>",
                                          "cells": {locator: [{"value": ..., "truncated": bool, "label": ...}]}}}}

Serves scripts/repair-truncated.mts (reviewer ruling 29 Sep 2026). It DECIDES NOTHING: the repair proves identity
itself (the stored raw must be a strict prefix of what is read here), so this only reports what the extractor reads at
each locator today. A merged record answers for its own locator and for every fragment it absorbed, because a fact
written before the merge may carry a later fragment's locator -- the prefix proof, not this index, says whether it is
the same cell.

The cache is ROOT/scraper/cache RESOLVED, which on the box is /var/lib/netzspec-api/cache (the real one). A default
path once pointed a re-derivation at a stale 763-file copy (CLAUDE.md, 25 Sep 2026), so the resolved directory and
its file count are written into the output for the caller to check against the documents it asked for.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.path.realpath(ROOT / "scraper" / "cache"))
sys.path.insert(0, str(ROOT / "scraper"))


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: reread-cells.py <in.json> <out.json>", file=sys.stderr)
        return 2
    from adapters.cisco_specs_deep import extract_document  # noqa: E402

    want = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    docs: dict = {}
    for d in want:
        locs = set(d["locators"])
        f = CACHE / d["cache_path"] if d.get("cache_path") else None
        if f is None or not f.is_file():
            docs[d["doc_id"]] = {"status": "cache_miss", "cells": {}}
            continue
        try:
            res = extract_document(f.read_text(encoding="utf-8", errors="replace"), d["url"])
        except Exception as e:  # noqa: BLE001 -- reported per document, never swallowed
            docs[d["doc_id"]] = {"status": f"error:{type(e).__name__}", "cells": {}}
            continue
        cells: dict = {}
        for r in res.get("facts") or []:
            at = {r.get("locator")} | {g.get("locator") for g in (r.get("fragments") or [])}
            for loc in at & locs:
                cells.setdefault(loc, []).append({"value": r.get("value"), "truncated": bool(r.get("truncated")), "label": r.get("label")})
        docs[d["doc_id"]] = {"status": "ok", "cells": cells}
    out = {"cache_dir": str(CACHE), "cache_files": sum(1 for p in CACHE.rglob("*") if p.is_file()), "docs": docs}
    Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"re-read {len(want)} document(s) from {CACHE} ({out['cache_files']} files): "
          f"{sum(1 for v in docs.values() if v['status'] == 'ok')} read, "
          f"{sum(1 for v in docs.values() if v['status'] == 'cache_miss')} cache miss, "
          f"{sum(1 for v in docs.values() if v['status'].startswith('error'))} raised")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
