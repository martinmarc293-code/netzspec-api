"""label_inventory — every distinct raw label a source adapter emits over its cached fixtures,
with sample values and the fixture it came from. This is the input to the vocabulary loop
(alias proposals) and the sampleLabels the validator checks a proposed rule against.

    python3.11 scraper/tools/label_inventory.py <source-slug> [--out runs/vocab/<slug>/labels.json]

Fixture URLs are taken from the adapter's own test file (tests/scraper/test_<module>.py): every
https:// URL literal in it that is present in the cache. No network. A fixture that is not cached
is reported, not fetched.
"""
from __future__ import annotations
import argparse, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass

import netzscrape  # noqa: E402
from sources import load_source  # noqa: E402

URL_RX = re.compile(r"https?://[^\s\"'<>)\]]+")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    module = a.source.replace("-", "_")
    src = load_source(a.source)
    test_file = ROOT / "tests" / "scraper" / f"test_{module}.py"
    if not test_file.exists():
        print(f"no test file {test_file}"); return 1
    urls = sorted({u.rstrip(".,;") for u in URL_RX.findall(test_file.read_text(encoding="utf-8", errors="replace"))})
    labels: dict[str, dict] = defaultdict(lambda: {"count": 0, "samples": [], "fixtures": set(), "skus": set()})
    seen_fixtures, missing = [], []
    for url in urls:
        cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
        if not cf.exists():
            missing.append(url); continue
        html = cf.read_text(encoding="utf-8", errors="replace")
        if src.is_blocked(html) or src.is_not_found(html):
            continue
        seen_fixtures.append(url)
        for task_kind in ("part-page", "datasheet", "listing", "gpl", "search"):
            try:
                res = src.extract(html, {"task": task_kind, "key": "", "url": url, "part_id": None}) or {}
            except Exception:  # noqa — a kind the adapter does not serve
                continue
            entries = [res] + list(res.get("others") or [])
            got = False
            for e in entries:
                for f in e.get("facts") or []:
                    got = True
                    L = labels[f["label"]]
                    L["count"] += 1
                    if len(L["samples"]) < 5 and f["value"] not in L["samples"]:
                        L["samples"].append(str(f["value"])[:140])
                    L["fixtures"].add(url)
                    if e.get("sku"):
                        L["skus"].add(str(e["sku"])[:40])
            if got:
                break
    out = {
        "source": a.source,
        "fixtures": seen_fixtures,
        "fixtures_not_cached": missing,
        "labels": sorted(
            [{"label": k, "count": v["count"], "samples": v["samples"], "fixtures": len(v["fixtures"]), "skus": sorted(v["skus"])[:8]} for k, v in labels.items()],
            key=lambda x: (-x["count"], x["label"])),
    }
    path = Path(a.out) if a.out else ROOT / "runs" / "vocab" / a.source / "labels.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{a.source}: {len(out['labels'])} distinct labels from {len(seen_fixtures)} fixtures ({len(missing)} not cached) -> {path.relative_to(ROOT)}")
    for l in out["labels"][:12]:
        print(f"  {l['count']:4} {l['label'][:60]:60} | {(l['samples'][0] if l['samples'] else '')[:50]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
