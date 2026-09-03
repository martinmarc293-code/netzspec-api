"""inspect_cached — look at a cached page the way an adapter will: links matching a pattern,
tables and their first rows, label:value pairs, JSON blobs embedded in scripts. Reads only the
cache; never fetches.

    python3.11 scraper/tools/inspect_cached.py <url> [--links PATTERN] [--json] [--pairs] [--text N]
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

# the Windows console is cp1252; product pages are not. Never let an encoding error end an inspection.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import netzscrape  # noqa: E402
from sources.base import soup, table_pairs, dl_pairs, colon_pairs, clean  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--links", default="", help="regex on href; prints matching links (href | text)")
    ap.add_argument("--json", action="store_true", help="list <script> JSON blobs with their top-level keys")
    ap.add_argument("--pairs", action="store_true", help="label:value pairs from tables/dl/li")
    ap.add_argument("--tables", action="store_true", help="every table: rows x cols and the first 3 rows")
    ap.add_argument("--text", type=int, default=0, help="print the first N chars of visible text")
    ap.add_argument("--grep", default="", help="print text lines matching this regex")
    a = ap.parse_args()

    cf = netzscrape.CACHE / f"{netzscrape._key(a.url)}.html"
    if not cf.exists():
        print(f"not cached: {a.url}"); return 1
    html = cf.read_text(encoding="utf-8", errors="replace")
    s = soup(html)
    print(f"{cf.name}  {len(html)} bytes  title={clean(s.title.get_text()) if s.title else ''!r}")

    if a.links:
        rx = re.compile(a.links, re.I)
        seen = set()
        for x in s.find_all("a", href=True):
            h = x["href"]
            if rx.search(h) and h not in seen:
                seen.add(h)
                print(f"  {h[:110]:110} | {clean(x.get_text())[:60]}")
        print(f"  ({len(seen)} links)")

    if a.tables:
        for i, t in enumerate(s.find_all("table")):
            rows = t.find_all("tr")
            if not rows:
                continue
            ncols = max(len(r.find_all(["td", "th"])) for r in rows)
            print(f"  table[{i}] {len(rows)}x{ncols}")
            for r in rows[:3]:
                print("     | " + " | ".join(clean(c.get_text())[:28] for c in r.find_all(["td", "th"])[:6]))

    if a.pairs:
        pairs = []
        for i, t in enumerate(s.find_all("table")):
            pairs += table_pairs(t, f"t{i}")
        pairs += dl_pairs(s, "dl") + colon_pairs(s, "li")
        for p in pairs[:80]:
            print(f"  {p['locator']:10} {p['label'][:48]:48} | {p['value'][:70]}")
        print(f"  ({len(pairs)} pairs)")

    if a.json:
        for i, sc in enumerate(s.find_all("script")):
            txt = sc.string or sc.get_text() or ""
            txt = txt.strip()
            if not txt or (not txt.startswith("{") and not txt.startswith("[")):
                m = re.search(r"=\s*(\{.{200,}\})\s*;?\s*$", txt, re.S)
                if not m:
                    continue
                txt = m.group(1)
            try:
                obj = json.loads(txt)
            except Exception:  # noqa
                continue
            keys = list(obj.keys())[:12] if isinstance(obj, dict) else f"array[{len(obj)}]"
            print(f"  script[{i}] id={sc.get('id')} type={sc.get('type')} {len(txt)} chars keys={keys}")

    if a.text:
        print(clean(s.get_text(" "))[: a.text])

    if a.grep:
        rx = re.compile(a.grep, re.I)
        for line in s.get_text("\n").splitlines():
            line = clean(line)
            if line and rx.search(line):
                print(f"  {line[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
