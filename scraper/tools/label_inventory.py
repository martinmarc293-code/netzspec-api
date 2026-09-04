"""label_inventory — every distinct raw label a source emits, with sample values, and what the
vocabulary currently does with it: MAPPED to a field, deliberately IGNORED, or an open gap.

Two modes, because the two questions are different:

    # what the adapter CAN emit, from the cached fixtures its test file names (no network)
    python3.11 scraper/tools/label_inventory.py <source-slug>

    # what the live crawl DID emit, from runs/acquired/<slug>/<day>/*.json
    python3.11 scraper/tools/label_inventory.py <source-slug> --acquired [--day 2026-09-04]

The fixture mode is the input to a rule's `sampleLabels` check; the acquired mode is the input to
the vocabulary round, because it is weighted by what the corpus actually contains. Both write
runs/vocab/<slug>/labels.json, whose `labels[].label` list is what
src/pipeline/apply-alias-proposals.ts re-validates every proposed rule against.

Fixture URLs are taken from the adapter's own test file (tests/scraper/test_<module>.py): every
https:// URL literal in it that is present in the cache. A fixture that is not cached is
reported, not fetched.

IGNORED is not UNMAPPED. An identity row like "Stock Details > Manuf Part#" is not a gap in the
vocabulary — the parts table owns it — and counting 4,000 of them as gaps made the headline
percentage useless for deciding where the next rule should go. data/schema/attribute-ignore.en.json
names them, with a reason each; scraper/tools/vocab.py is the one reader of both files.

--values writes runs/vocab/<slug>/values.json as well: every distinct value per label with its
count, which is what a normalisation acceptance check has to run over. Sample values lie about
acceptance rates because the samples are the first three seen, not a random three.
"""
from __future__ import annotations
import argparse, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass

import vocab  # noqa: E402

URL_RX = re.compile(r"https?://[^\s\"'<>)\]]+")
MAX_VALUES_PER_LABEL = 400   # enough for an acceptance rate; the tail repeats


def _blank():
    return {"count": 0, "samples": [], "fixtures": set(), "skus": set(), "values": defaultdict(int)}


def _record(labels: dict, fact: dict, origin: str, sku: str | None) -> None:
    label = (fact.get("label") or "").strip()
    if not label:
        return
    value = str(fact.get("value") if fact.get("value") is not None else "")[:200]
    L = labels[label]
    L["count"] += 1
    if len(L["samples"]) < 5 and value not in L["samples"]:
        L["samples"].append(value[:140])
    L["fixtures"].add(origin)
    if sku:
        L["skus"].add(str(sku)[:40])
    if value and len(L["values"]) < MAX_VALUES_PER_LABEL:
        L["values"][value] += 1
    elif value in L["values"]:
        L["values"][value] += 1


def from_fixtures(slug: str, urls: list[str]) -> tuple[dict, list, list]:
    import netzscrape
    from sources import load_source
    src = load_source(slug)
    labels: dict[str, dict] = defaultdict(_blank)
    seen, missing = [], []
    for url in urls:
        cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
        if not cf.exists():
            missing.append(url); continue
        html = cf.read_text(encoding="utf-8", errors="replace")
        if src.is_blocked(html) or src.is_not_found(html):
            continue
        seen.append(url)
        for task_kind in ("part-page", "datasheet", "listing", "gpl", "search"):
            try:
                res = src.extract(html, {"task": task_kind, "key": "", "url": url, "part_id": None}) or {}
            except Exception:  # noqa — a kind the adapter does not serve
                continue
            got = False
            for e in [res, *(res.get("others") or [])]:
                for f in e.get("facts") or []:
                    got = True
                    _record(labels, f, url, e.get("sku"))
            if got:
                break
    return labels, seen, missing


def from_acquired(slug: str, day: str | None) -> tuple[dict, list, list]:
    """The labels the live crawl actually produced. Reads the worker's own output, so this works
    whether or not the TypeScript apply step has run."""
    base = ROOT / "runs" / "acquired" / slug
    days = [base / day] if day else sorted(p for p in base.glob("*") if p.is_dir())
    labels: dict[str, dict] = defaultdict(_blank)
    seen, unreadable = [], []
    for d in days:
        if not d.is_dir():
            unreadable.append(str(d)); continue
        for f in sorted(d.glob("*.json")):
            try:
                j = json.loads(f.read_text(encoding="utf-8"))
            except Exception:  # noqa — one unreadable file is not a reason to report nothing
                unreadable.append(str(f.relative_to(ROOT))); continue
            seen.append(str(f.relative_to(ROOT)))
            res = j.get("result") or {}
            for e in [res, *(res.get("others") or [])]:
                for fact in e.get("facts") or []:
                    _record(labels, fact, j.get("url") or str(f.name), e.get("sku"))
    return labels, seen, unreadable


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--out", default="")
    ap.add_argument("--acquired", action="store_true", help="read runs/acquired/<slug>/**.json instead of the cached fixtures")
    ap.add_argument("--day", default="", help="with --acquired: one day only (YYYY-MM-DD); default every day present")
    ap.add_argument("--values", action="store_true", help="also write values.json: every distinct value per label, for a normalisation acceptance check")
    ap.add_argument("--url", action="append", default=[], help="fixture URL(s) to use instead of those found in the test file")
    a = ap.parse_args()

    if a.acquired:
        labels, seen, missing = from_acquired(a.source, a.day or None)
        origin_key, missing_key = "files", "files_unreadable"
    else:
        module = a.source.replace("-", "_")
        test_file = ROOT / "tests" / "scraper" / f"test_{module}.py"
        if a.url:
            urls = sorted(set(a.url))
        else:
            if not test_file.exists():
                print(f"no test file {test_file}"); return 1
            urls = sorted({u.rstrip(".,;") for u in URL_RX.findall(test_file.read_text(encoding="utf-8", errors="replace"))})
        labels, seen, missing = from_fixtures(a.source, urls)
        origin_key, missing_key = "fixtures", "fixtures_not_cached"

    # A vocabulary file that cannot be read is a different finding from "nothing is mapped", and
    # a tool that reports the second for the first is the failure this project keeps paying for.
    try:
        arules, irules = vocab.alias_rules(), vocab.ignore_rules()
    except Exception as e:  # noqa
        print(f"COULD NOT READ THE VOCABULARY: {type(e).__name__}: {e}")
        return 2

    rows, counts = [], {"mapped": 0, "ignored": 0, "unmapped": 0}
    distinct = {"mapped": 0, "ignored": 0, "unmapped": 0}
    for k, v in labels.items():
        state, detail = vocab.label_state(k, arules, irules)
        counts[state] += v["count"]
        distinct[state] += 1
        rows.append({"label": k, "count": v["count"], "state": state,
                     "field_key": detail if state == "mapped" else None,
                     "ignored_because": detail if state == "ignored" else None,
                     "samples": v["samples"], origin_key: len(v["fixtures"]),
                     "skus": sorted(v["skus"])[:8]})
    rows.sort(key=lambda x: (-x["count"], x["label"]))

    total = sum(counts.values())
    out = {
        "source": a.source,
        "mode": "acquired" if a.acquired else "fixtures",
        "day": a.day or None,
        origin_key: seen if not a.acquired else len(seen),
        missing_key: missing if not a.acquired else len(missing),
        "totals": {**counts, "total": total,
                   "distinct": {**distinct, "total": len(rows)},
                   # the number the watchdog reports: gaps as a share of what COULD be mapped.
                   "unmapped_pct_of_mappable": round(100.0 * counts["unmapped"] / (counts["mapped"] + counts["unmapped"]), 1)
                   if (counts["mapped"] + counts["unmapped"]) else None},
        "labels": rows,
    }
    path = Path(a.out) if a.out else ROOT / "runs" / "vocab" / a.source / "labels.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    if a.values:
        vals = {k: dict(sorted(v["values"].items(), key=lambda kv: -kv[1])) for k, v in labels.items()}
        vp = path.parent / "values.json"
        vp.write_text(json.dumps(vals, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"  values -> {vp.relative_to(ROOT)}")

    n_src = len(seen) if a.acquired else f"{len(seen)} fixtures ({len(missing)} not cached)"
    print(f"{a.source}: {len(rows)} distinct labels from {n_src}")
    print(f"  mapped   {counts['mapped']:6} ({distinct['mapped']} distinct)")
    print(f"  ignored  {counts['ignored']:6} ({distinct['ignored']} distinct)")
    print(f"  unmapped {counts['unmapped']:6} ({distinct['unmapped']} distinct)"
          f" = {out['totals']['unmapped_pct_of_mappable']}% of mappable -> {path.relative_to(ROOT)}")
    for l in [r for r in rows if r["state"] == "unmapped"][:12]:
        print(f"  {l['count']:5} {l['label'][:60]:60} | {(l['samples'][0] if l['samples'] else '')[:50]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
