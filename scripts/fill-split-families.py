"""Split a FILL night's extract by DOCUMENT FAMILY into what commits tonight and what is staged (reviewer ruling B, 30 Sep 2026).

    python3 scripts/fill-split-families.py --extract <extract.json>... --out-dir <night dir> --demoted <demoted.json>
                                           [--golden-dir data/reference/golden] [--min-golden 5] [--defect-budget 0.05]

The ruling: "A doc family seen for the first time is staged only (extract + dry gate). The day adds >= 5 golden rows for it
from its own sheet, then it commits ... A family with golden rows already commits nightly." The risk it answers: a new
table shape can map a label to the wrong cup and still re-read 100% clean, because provenance proves the value came from
the cell, not that it belongs in that cup -- only a hand-checked golden row proves the second.

FAMILY = the document's directory: the two path segments after `collateral/` (or `products/`), e.g.
`.../products/collateral/switches/catalyst-9300-series-switches/`. A series' HTML and its PDFs under /c/dam/ are TWO
families on purpose: different extractors read different table shapes, and a checked HTML shape says nothing about a PDF.
COMMITS when the family's documents list SKUs with at least --min-golden golden rows (data/reference/golden, the gate's own
set: a row is one (sku, field) expectation) AND its extractor defects stay within --defect-budget of its fact records.
Everything else is STAGED: its records go to staged-<name>.json for the day, with the reason.
A family whose documents list NONE of our live parts is recorded `no_listed_parts` and its directory is appended to
--demoted, which scripts/fill-night-target.mts reads to put that directory LAST in the next night's target (the ruling:
"the lane learns which shapes waste a night"). The part match here is upper-case with a trailing "=" dropped on both
sides -- an approximation used only to ORDER the next target, never to decide a write (apply-extract resolves SKUs itself).

Writes commit-<name>.json / staged-<name>.json (only when non-empty; same {source, generated_at, records} shape as the input,
__doc__ records kept with their facts) and families.json; prints one line.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def family_of(url: str) -> str:
    p = urlparse(url or "")
    segs = [s for s in p.path.split("/") if s]
    anchor = "collateral" if "collateral" in segs else ("products" if "products" in segs else None)
    if anchor:
        i = segs.index(anchor)
        fam = segs[: min(i + 3, max(len(segs) - 1, 0))]
    else:
        fam = segs[:-1]
    return f"{p.scheme}://{p.netloc}/" + "".join(s + "/" for s in fam)


def decide(docs: int, docs_listing_ours: int, facts: int, defects: int, golden_rows: int,
           min_golden: int = 5, defect_budget: float = 0.05, docs_with_pids: int | None = None) -> tuple[str, str]:
    """(status, why) for one family: 'commit' only with golden rows in scope and defects inside the budget.

    AN EMPTY PID LIST IS COULD-NOT-TELL, NOT "NONE OF OURS". Dry run 5 (30 Sep 2026) read 27 UCS / HyperFlex spec sheets whose
    PDF extraction produced facts (up to 96 a sheet) and a pid_list of 0 on every one -- the extractor did not read their
    PID tables -- and this rule, then keyed on "no document lists a part of ours", demoted exactly the families the target
    ranks first. `no_listed_parts` (which demotes) now needs documents that DID list PIDs, none of them ours; a family whose
    documents listed no PID at all is `no_pid_list`: staged, reported as an extractor gap, never demoted."""
    share = defects / max(facts, 1)
    with_pids = docs if docs_with_pids is None else docs_with_pids
    if docs and not with_pids:
        return "staged", "no_pid_list: the extractor read no PID list from this family's documents (an extractor gap, not demoted)"
    if docs and not docs_listing_ours:
        return "staged", "no_listed_parts: its documents list PIDs, none of them a part we hold"
    if golden_rows < min_golden:
        return "staged", f"golden rows owed: {golden_rows} in scope, {min_golden} needed"
    if share > defect_budget:
        return "staged", f"defect budget: {defects} defects on {facts} facts ({share:.1%} > {defect_budget:.0%})"
    return "commit", f"{golden_rows} golden rows in scope; defects {share:.1%}"


def norm(pid: str) -> str:
    return (pid or "").strip().upper().rstrip("=")


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extract", nargs="+", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--demoted", required=True)
    ap.add_argument("--golden-dir", default=str(ROOT / "data" / "reference" / "golden"))
    ap.add_argument("--min-golden", type=int, default=5)
    ap.add_argument("--defect-budget", type=float, default=0.05)
    a = ap.parse_args()

    golden_by_sku: dict[str, int] = defaultdict(int)
    for f in sorted(Path(a.golden_dir).glob("*.golden.json")):
        for e in json.loads(f.read_text(encoding="utf-8")).get("expectations", []):
            golden_by_sku[norm(e["sku"])] += 1
    import psycopg
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/fill-split-families") as c:
        ours = {norm(r[0]) for r in c.execute("""SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
                                                 WHERE v.slug = 'cisco' AND p.retired_at IS NULL""").fetchall()}

    inputs = [(Path(x), json.loads(Path(x).read_text(encoding="utf-8"))) for x in a.extract]
    fam = defaultdict(lambda: {"docs": 0, "docs_with_pids": 0, "docs_listing_ours": 0, "pids": set(), "facts": 0, "defects": 0})
    for _, data in inputs:
        for r in data.get("records", []):
            f = fam[family_of(r.get("source_url") or "")]
            if r.get("__doc__"):
                f["docs"] += 1
                pids = {norm(p) for p in (r.get("pid_list") or [])}
                f["pids"] |= pids
                f["docs_with_pids"] += bool(pids)
                f["docs_listing_ours"] += bool(pids & ours)
                f["defects"] += len(r.get("defects") or [])
            else:
                f["facts"] += 1
    decided = {}
    for key, f in fam.items():
        grows = sum(golden_by_sku.get(p, 0) for p in f["pids"])
        status, why = decide(f["docs"], f["docs_listing_ours"], f["facts"], f["defects"], grows, a.min_golden, a.defect_budget,
                             docs_with_pids=f["docs_with_pids"])
        decided[key] = {"status": status, "why": why, "docs": f["docs"], "docs_with_pids": f["docs_with_pids"],
                        "docs_listing_ours": f["docs_listing_ours"],
                        "facts": f["facts"], "defects": f["defects"], "golden_rows": grows}

    out = Path(a.out_dir)
    written = []
    for path, data in inputs:
        for status in ("commit", "staged"):
            recs = [r for r in data.get("records", []) if decided[family_of(r.get("source_url") or "")]["status"] == status]
            if not recs:
                continue
            dst = out / f"{status}-{path.stem}.json"
            dst.write_text(json.dumps({**{k: v for k, v in data.items() if k != "records"}, "records": recs}) + "\n", encoding="utf-8")
            written.append(dst.name)
    (out / "families.json").write_text(json.dumps(dict(sorted(decided.items(), key=lambda kv: (kv[1]["status"], -kv[1]["docs"]))),
                                                  indent=1) + "\n", encoding="utf-8")
    # demotion: a directory whose documents listed none of our parts goes last in the next target (ordering, never exclusion)
    dp = Path(a.demoted)
    dem = json.loads(dp.read_text(encoding="utf-8")) if dp.exists() else {"prefixes": {}}
    today = datetime.now(timezone.utc).date().isoformat()
    for key, d in decided.items():
        if d["why"].startswith("no_listed_parts"):
            e = dem["prefixes"].setdefault(key, {"docs": 0, "first_seen": today})
            e["docs"] += d["docs"]
            e["last_seen"] = today
    dp.write_text(json.dumps(dem, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    n = {s: sum(1 for d in decided.values() if d["status"] == s) for s in ("commit", "staged")}
    owed = sum(1 for d in decided.values() if d["why"].startswith("golden rows owed"))
    nolist = sum(1 for d in decided.values() if d["why"].startswith("no_listed_parts"))
    nopid = sum(1 for d in decided.values() if d["why"].startswith("no_pid_list"))
    print(f"families: {len(decided)} -- commit {n['commit']}, staged {n['staged']} (golden owed {owed}, no listed parts {nolist} "
          f"[demoted], no PID list read {nopid}, defect budget {n['staged'] - owed - nolist - nopid}); files: {len(written)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
