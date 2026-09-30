"""Restrict re-extracted acquired files to ONE extractor shape's facts (optionally one label set), so an apply can land
only what that shape adds.

    python3.11 scripts/keep-shape-facts.py DIR --shape E [--labels "Operating temperature,Unit weight"]

WHY. A re-apply of a whole document re-offers every fact the extractor reads there, and applyMerge fills any GAP-state
row -- which is what a ruled retraction leaves behind -- so re-applying whole sheets could resurrect retracted values. A
new shape is the only thing its change adds, so it is the only thing its apply carries. (Run 1430 applied shape D this way
from a scratch copy of this script; shape E, the inline per-model lists of 30 Sep 2026, is the second use.)

For each <doc_id>.json in DIR (written by scripts/reextract-from-cache.py): run the SAME extractor over the SAME cached
bytes, collect the (sku, locator) of every record of --shape (and --labels, when given, matched EXACTLY), and keep in the
file only facts whose (entry sku, locator, label) is in that set. Family entries are dropped (apply-acquired skips them by
rule anyway). `document_pids` and `defects` are kept whole: they describe the page. A file left with nothing is removed.
REFUSES (exit 2) when a wanted record found no fact in the acquired file: the two reads disagree about the page.
"""
import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scraper"))
from adapters.cisco_specs_deep import extract_document  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--shape", required=True)
ap.add_argument("--labels", default="")
ap.add_argument("--cache", default=os.path.join(REPO, "scraper", "cache"))
a = ap.parse_args()
labels = {x.strip() for x in a.labels.split(",") if x.strip()}
held_by_label: dict[str, int] = {}
bad = tot_keep = tot_drop = 0
for f in sorted(os.listdir(a.dir)):
    if not f.endswith(".json"):
        continue
    p = os.path.join(a.dir, f)
    rec = json.load(open(p, encoding="utf-8"))
    html = open(os.path.join(a.cache, rec["cache_path"]), encoding="utf-8", errors="replace").read()
    ex = extract_document(html, rec["url"])
    shaped = [r for r in ex["facts"] if r.get("shape") == a.shape and r.get("sku")]
    for r in shaped:
        if labels and r["label"] not in labels:
            held_by_label[r["label"]] = held_by_label.get(r["label"], 0) + 1
    want = {(r["sku"], r["locator"], r["label"]) for r in shaped if not labels or r["label"] in labels}
    res = rec["result"]
    entries = ([res] if res.get("sku") or res.get("facts") else []) + list(res.get("others") or [])
    kept_entries, keep, drop, found = [], 0, 0, set()
    for e in entries:
        if e.get("scope") == "family":
            drop += len(e.get("facts") or [])
            continue
        facts = [x for x in (e.get("facts") or []) if (e.get("sku"), x.get("locator"), x.get("label")) in want]
        drop += len(e.get("facts") or []) - len(facts)
        if facts:
            found |= {(e.get("sku"), x.get("locator"), x.get("label")) for x in facts}
            kept_entries.append({**{k: v for k, v in e.items() if k not in ("others", "document_pids", "defects", "tables", "name")},
                                 "facts": facts})
            keep += len(facts)
    missing = want - found
    if missing:
        print(f"!! {f}: {len(missing)} shape-{a.shape} record(s) found no fact in the acquired file, e.g. {sorted(missing)[:3]}")
        bad += 1
    if not kept_entries:
        print(f"   {f}: no shape-{a.shape} fact -- file removed from the apply input")
        os.remove(p)
        continue
    primary = dict(kept_entries[0])
    primary["others"] = kept_entries[1:]
    for k in ("document_pids", "defects", "tables", "name"):
        if k in res:
            primary[k] = res[k]
    rec["result"] = primary
    tmp = p + ".tmp"
    json.dump(rec, open(tmp, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    os.replace(tmp, p)
    tot_keep += keep
    tot_drop += drop
    print(f"   {f}: kept {keep} shape-{a.shape} fact(s) over {len(kept_entries)} SKU entries, withheld {drop} other fact(s)")
print(f"TOTAL kept {tot_keep}, withheld {tot_drop}; {bad} file(s) with an unmatched shape-{a.shape} record")
print(f"shape-{a.shape} records held back by the label allowlist:", held_by_label)
sys.exit(2 if bad else 0)
