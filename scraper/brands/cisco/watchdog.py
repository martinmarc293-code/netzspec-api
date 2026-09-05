"""The Cisco brand watchdog.

    python3.11 scraper/brands/cisco/watchdog.py [--window 1440] [--json]

WHAT THIS ANSWERS THAT THE GLOBAL WATCHDOG DOES NOT. `scraper/tools/watchdog.py` asks "is each
LANE healthy" - yield per source, drift, blocks, stale runs. It is the right question for a
process and the wrong one for a catalogue: every lane can be green while a brand's coverage sits
still, because a lane that fetched two hundred pages nobody could extract from reported two
hundred successes. This watchdog asks "is the BRAND getting more complete, and if not, why not" -
and its central output is the split between the two failure modes that look identical in an
average:

    recall gap   parts holding a document that produced no facts  -> fix the extractor
    crawl gap    parts holding no document at all                 -> fetch something

Report-only. It never pauses a lane, never writes a fact and never touches a source row. The
global watchdog owns automatic action; this one owns judgement, and mixing the two is how a
coverage report ends up disabling a lane at three in the morning.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import load_brand                     # noqa: E402
from brands import base as B                      # noqa: E402


def load_env(path: Path | None = None) -> dict:
    env: dict[str, str] = {}
    p = path or (ROOT / ".env")
    for line in p.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, v = t.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def bar(pct: float, width: int = 28) -> str:
    filled = max(0, min(width, round(width * pct / 100.0)))
    return "#" * filled + "." * (width - filled)


def report(conn, brand, window_min: int) -> dict:
    cov = B.coverage(conn, brand)
    comp = B.completeness(conn, brand)
    fresh = B.document_freshness(conn, brand)
    blocks = B.blocked_sources(conn, brand, window_min)
    families = B.recall_gap_by_family(conn, brand)
    fields = B.required_field_gaps(conn, brand)

    stale_total = sum(f["stale"] or 0 for f in fresh)
    measured = {"covered_pct": cov["covered_pct"], "recall_gap": float(cov["recall_gap"]),
                "avg_pct": float(comp["avg_pct"] or 0), "stale_docs": float(stale_total)}

    verdicts, alarms = [], []
    for t in brand.targets:
        got = measured.get(t.metric)
        if got is None:
            # A declared target nothing measures is worse than no target: it reads as covered.
            # Refuse quietly nowhere - say it out loud.
            alarms.append(f"TARGET {t.metric} is declared in the manifest and NOTHING MEASURES IT")
            continue
        # "recall_gap" and "stale_docs" are budgets to stay under; the rest are floors to reach.
        lower_is_better = t.metric in ("recall_gap", "stale_docs")
        ok = (got <= t.target) if lower_is_better else (got >= t.target)
        verdicts.append({"metric": t.metric, "target": t.target, "actual": got, "ok": ok,
                         "direction": "max" if lower_is_better else "min", "why": t.why})
        if not ok:
            alarms.append(
                f"TARGET MISSED {t.metric}: {got:,.1f} against a "
                f"{'ceiling' if lower_is_better else 'floor'} of {t.target:,.1f}")

    # BLOCKED, in plain words. The global watchdog's threshold is five blocks in the window, which
    # on 5 Sep 2026 let a lane that was 3-for-3 challenged pass without a single line of output.
    # A brand's lane being blocked is a brand-level fact and is reported here at ANY block.
    for b in blocks:
        if (b["blocked"] or 0) > 0:
            share = 100.0 * b["blocked"] / max(1, (b["blocked"] or 0) + (b["done"] or 0))
            alarms.append(f"BLOCKED {b['slug']}: {b['blocked']} blocked answers in the window "
                          f"({share:.0f}% of its completed work) - this lane is not fetching")
    if all(not b["enabled"] for b in blocks):
        verdicts.append({"metric": "lanes_enabled", "target": 1, "actual": 0, "ok": False,
                         "direction": "min", "why": "every lane of this brand is disabled"})
        alarms.append(f"NO LANE RUNNING: all {len(blocks)} {brand.display} sources are disabled - "
                      "coverage cannot move and no daily update is being collected")

    return {"brand": brand.slug, "display": brand.display, "window_min": window_min,
            "generated_at": B.utcnow().isoformat(), "coverage": cov, "completeness": comp,
            "freshness": [{"key": f["class"].key, "label": f["class"].label,
                           "refresh_days": f["class"].refresh_days, "required": f["class"].required,
                           "held": f["held"], "stale": f["stale"],
                           "oldest": str(f["oldest"]), "newest": str(f["newest"])} for f in fresh],
            "sources": [dict(b) for b in blocks],
            "recall_gap_families": [dict(r) for r in families],
            "missing_fields": [dict(r) for r in fields],
            "verdicts": verdicts, "alarms": alarms}


def render(rep: dict) -> str:
    cov, comp = rep["coverage"], rep["completeness"]
    L = [f"# {rep['display']} brand watchdog - {rep['generated_at'][:16].replace('T', ' ')} UTC",
         "", "## coverage of hardware parts", ""]
    hw = cov["hardware"] or 1
    L += [f"  {cov['hardware']:>7,}  hardware parts",
          f"  {cov['covered']:>7,}  covered ({cov['covered_pct']}%)  {bar(cov['covered_pct'])}",
          f"  {cov.get('read_from_document', 0):>7,}  READ FROM A DOCUMENT ({cov.get('read_pct', 0)}%)  "
          f"{bar(cov.get('read_pct', 0))}",
          f"  {cov.get('seed_only', 0):>7,}     covered only by operator seed data - a value somebody "
          f"typed, not one we read",
          "",]
    L += [
          f"  {cov['doc_no_facts']:>7,}  RECALL GAP  - a document is held and produced no facts",
          f"  {cov['neither']:>7,}  CRAWL GAP   - no spec-bearing document at all",
          f"  {cov.get('only_nonspec_doc', 0):>7,}     ...of which hold ONLY a non-spec document "
          f"(an EoL notice lists PIDs, never specifications)",
          f"  {cov['facts_no_doc']:>7,}  facts without a document (tier-0 seed)",
          ""]
    # Which side of the split is bigger decides where the next hour goes, so the sentence is
    # COMPUTED. It was hardcoded as "the next hour belongs to the extractor" while the recall gap
    # was believed to be 33,863; correcting the document classes moved it to 1,587 and the crawl
    # gap to 39,119, and the hardcoded sentence went on saying the opposite of the numbers above
    # it. A conclusion printed next to the evidence must be derived from that evidence.
    recall, crawl = cov["doc_no_facts"], cov["neither"]
    if recall > crawl:
        L += [f"  RECALL is the larger gap ({recall:,} against {crawl:,}): the documents are already",
              "  held, so the next hour belongs to the EXTRACTOR."]
    elif crawl > recall:
        L += [f"  CRAWL is the larger gap ({crawl:,} against {recall:,}): most of these parts have",
              "  never had a spec-bearing document fetched, so the next hour belongs to the LANE.",
              f"  {cov.get('only_nonspec_doc', 0):,} of them hold only an end-of-life notice, which",
              "  reads as 'we have a datasheet' in any report that does not check the document class."]
    else:
        L += [f"  The two gaps are equal ({recall:,} each)."]
    L += [
          "", "## required-field completeness", "",
          f"  average {comp['avg_pct']}%   zero {comp['zero']:,}  under 40% {comp['low']:,}  "
          f"40-80% {comp['mid']:,}  over 80% {comp['high']:,}", ""]

    L += ["## targets", ""]
    for v in rep["verdicts"]:
        mark = "PASS" if v["ok"] else "MISS"
        L.append(f"  [{mark}] {v['metric']:<14} {v['actual']:>10,.1f}  "
                 f"({'max' if v['direction'] == 'max' else 'min'} {v['target']:,.1f})")
        if not v["ok"]:
            L.append(f"         {v['why']}")
    L += ["", "## document freshness (is the daily cycle actually running?)", ""]
    for f in rep["freshness"]:
        req = "required" if f["required"] else "optional"
        L.append(f"  {f['label']:<28} held {f['held']:>6,}  stale {f['stale']:>6,}  "
                 f"(refresh {f['refresh_days']}d, {req})")
        L.append(f"      oldest {f['oldest']}   newest {f['newest']}")
    L += ["", "## lanes", ""]
    for s in rep["sources"]:
        L.append(f"  {s['slug']:<22} enabled={str(s['enabled']):<5} {s['proxy']:<12} "
                 f"done {s['done']:>5}  blocked {s['blocked']:>4}  failed {s['failed']:>4}  "
                 f"runnable {s['runnable']:>6}")
    L += ["", "## the recall backlog, ranked by family", "",
          "  A family is usually one datasheet, so this is a work queue: the top row is the",
          "  single change that closes the most parts.", ""]
    for r in rep["recall_gap_families"]:
        L.append(f"  {str(r['family'])[:46]:<48} {r['parts_without_facts']:>6,} parts  "
                 f"{r['documents']:>4} docs")
    L += ["", "## most-missing required fields", ""]
    for r in rep["missing_fields"]:
        L.append(f"  {r['field_key']:<28} missing on {r['missing']:>7,} parts")
    L += ["", f"## alarms: {len(rep['alarms'])}", ""]
    L += [f"  - {a}" for a in rep["alarms"]] or ["  - none"]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Cisco brand coverage watchdog (report only)")
    ap.add_argument("--window", type=int, default=1440, help="lane activity window, minutes")
    ap.add_argument("--json", action="store_true", help="emit the machine report as well")
    ap.add_argument("--brand", default=Path(__file__).resolve().parent.name)
    a = ap.parse_args()

    brand = load_brand(a.brand)
    url = load_env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (.env at the repo root)")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as conn:
        rep = report(conn, brand, a.window)

    out = ROOT / "runs" / "brands" / brand.slug
    out.mkdir(parents=True, exist_ok=True)
    text = render(rep)
    (out / "watchdog.md").write_text(text, encoding="utf-8")
    (out / "watchdog.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    print(text)
    # exit 1 on an alarm so a scheduler can notice without parsing the report
    return 1 if rep["alarms"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
