"""enumerate_cisco — every Cisco part number we can reach, arranged by category and series.

Three phases, each resumable, each writing incrementally so a long crawl never loses work:

  1. SERIES   the A-to-Z product index (/c/en/us/products/a-to-z-series-index.html) lists every
              product series Cisco publishes - 367 of them across 19 categories. The category
              comes from the URL itself (/products/<category>/<series>/index.html), so the
              arrangement is Cisco's own, not something we invent.
  2. DOCS     each series index page links to its datasheets under /collateral/.
  3. PIDS     each datasheet's ordering tables list the part numbers.

Why the ordering tables rather than a regex over the whole page: a PID-shaped regex run over prose
picks up software versions, RFC numbers and marketing strings. A table cell sitting under a header
that says "Product Number" is a part number because Cisco says so. The regex is only a shape check
on top of that signal.

  python scraper/enumerate_cisco.py --phase series
  python scraper/enumerate_cisco.py --phase docs   [--limit N]
  python scraper/enumerate_cisco.py --phase pids   [--limit N]
  python scraper/enumerate_cisco.py --phase all
  python scraper/enumerate_cisco.py --report
"""
from __future__ import annotations
import argparse, json, re, sys, io
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import netzscrape  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "universe"
OUT.mkdir(parents=True, exist_ok=True)
F_SERIES = OUT / "cisco-series.json"
F_DOCS = OUT / "cisco-datasheet-urls.json"
F_PIDS = OUT / "cisco-pid-universe.json"

AZ_INDEX = "https://www.cisco.com/c/en/us/products/a-to-z-series-index.html"
BASE = "https://www.cisco.com"

# A column header that means "this column holds part numbers".
PID_HEADER = re.compile(
    r"(part\s*(number|no)|product\s*(number|id|code)|\bpid\b|order(ing)?\s*(information|number|code)?"
    r"|^sku$|^model(\s*number)?$|^models?$)", re.I)

# Shape check only - the column header is what makes it a PID. Cisco PIDs are upper-case
# alphanumeric with hyphens, may carry a /K9 suffix, a trailing '=' (spare) or '++'.
PID_SHAPE = re.compile(r"^[A-Z0-9][A-Z0-9./+=-]{3,44}$")
HAS_DIGIT = re.compile(r"\d")
# things that pass the shape check but are not part numbers
NOT_PID = re.compile(
    r"^(N/?A|TBD|NONE|YES|NO|X|-+)$"
    r"|^\d{1,4}(\.\d+)*$"                     # bare numbers / version strings
    r"|^\d{1,2}/\d{1,2}(/\d{2,4})?$"          # dates
    r"|^(IEEE|RFC|ISO|IEC|EN|UL|CSA|IETF)[-\s]?\d"
    r"|^\d+(GBASE|BASE|G|M|W|MM|CM|IN|KG|LB|MHZ|GHZ|MBPS|GBPS)$", re.I)


def load(p: Path, default):
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa
            return default
    return default


def save(p: Path, data):
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------------------------
# phase 1 — series
# ---------------------------------------------------------------------------------------------
def phase_series(br) -> list[dict]:
    from bs4 import BeautifulSoup
    html = br.fetch(AZ_INDEX, timeout=90000)
    soup = BeautifulSoup(html, "lxml")
    seen, out = set(), []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.search(r"/c/en/us/products/([a-z0-9-]+)/([a-z0-9-]+)/index\.html", href)
        if not m:
            continue
        category, slug = m.group(1), m.group(2)
        if slug == "index":
            continue
        url = urljoin(BASE, href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"category": category, "series_slug": slug,
                    "series_name": a.get_text(" ", strip=True) or slug, "url": url})
    save(F_SERIES, out)
    cats: dict[str, int] = {}
    for s in out:
        cats[s["category"]] = cats.get(s["category"], 0) + 1
    print(f"[series] {len(out)} series across {len(cats)} categories -> {F_SERIES.name}")
    for c, n in sorted(cats.items(), key=lambda kv: -kv[1]):
        print(f"   {n:4}  {c}")
    return out


# ---------------------------------------------------------------------------------------------
# phase 2 — datasheet URLs per series
# ---------------------------------------------------------------------------------------------
DS_HINT = re.compile(r"data[-_]?sheet|datasheet|\bds\b|product-data", re.I)


def phase_docs(br, limit: int = 0) -> dict:
    from bs4 import BeautifulSoup
    series = load(F_SERIES, [])
    if not series:
        print("run --phase series first", file=sys.stderr)
        return {}
    docs = load(F_DOCS, {})
    todo = [s for s in series if s["url"] not in docs]
    if limit:
        todo = todo[:limit]
    print(f"[docs] {len(todo)} series to visit ({len(docs)} already done)")
    for i, s in enumerate(todo, 1):
        try:
            html = br.fetch(s["url"], timeout=60000)
        except netzscrape.PoliteBlocked:
            docs[s["url"]] = {"error": "robots", "datasheets": []}
            continue
        except Exception as e:  # noqa
            docs[s["url"]] = {"error": str(e)[:90], "datasheets": []}
            continue
        soup = BeautifulSoup(html, "lxml")
        found = []
        for a in soup.find_all("a", href=True):
            h = a["href"]
            # Match on the PATH only. Matching the whole href pulled in
            # /content/cdc/login.html?referer=/site/us/en/products/collateral/... — a login page
            # whose QUERY STRING happened to contain "collateral" and "datasheet". robots.txt
            # correctly disallows those, so they surfaced as five "robots blocked" rows that were
            # really a bad filter, not a restriction.
            path = urlparse(urljoin(BASE, h)).path
            if "/collateral/" not in path or not path.endswith(".html"):
                continue
            if "/login" in path or "/cdc/" in path:
                continue
            if not (DS_HINT.search(path) or DS_HINT.search(a.get_text(" ", strip=True))):
                continue
            found.append(urljoin(BASE, urlparse(urljoin(BASE, h)).path))
        found = list(dict.fromkeys(found))
        docs[s["url"]] = {"category": s["category"], "series_slug": s["series_slug"],
                          "series_name": s["series_name"], "datasheets": found}
        if i % 10 == 0 or i == len(todo):
            save(F_DOCS, docs)
            total = sum(len(v.get("datasheets", [])) for v in docs.values())
            print(f"   {i}/{len(todo)} series · {total} datasheet URLs so far")
    save(F_DOCS, docs)
    total = sum(len(v.get("datasheets", [])) for v in docs.values())
    print(f"[docs] {len(docs)} series visited, {total} datasheet URLs -> {F_DOCS.name}")
    return docs


# ---------------------------------------------------------------------------------------------
# phase 3 — PIDs per datasheet
# ---------------------------------------------------------------------------------------------
def pids_from_html(html: str) -> list[tuple[str, str]]:
    """Return (pid, evidence_header) pairs found in ordering-style tables."""
    from bs4 import BeautifulSoup
    from adapters.cisco_specs_deep import _rows
    soup = BeautifulSoup(html, "lxml")
    found: dict[str, str] = {}
    for table in soup.find_all("table"):
        rows = _rows(table)
        if len(rows) < 2:
            continue
        header = rows[0]
        pid_cols = [i for i, h in enumerate(header) if PID_HEADER.search(h or "")]
        if not pid_cols:
            continue
        for r in rows[1:]:
            for ci in pid_cols:
                if ci >= len(r):
                    continue
                cell = (r[ci] or "").strip()
                # a cell can hold several PIDs separated by commas or slashes
                for tok in re.split(r"[,;]|\s{2,}|\n", cell):
                    tok = tok.strip().rstrip(".,;")
                    if not tok or len(tok) < 4:
                        continue
                    if " " in tok:
                        continue
                    if not PID_SHAPE.match(tok) or not HAS_DIGIT.search(tok) or NOT_PID.search(tok):
                        continue
                    found.setdefault(tok, header[ci] or "")
    return list(found.items())


def phase_pids(br, limit: int = 0) -> dict:
    docs = load(F_DOCS, {})
    if not docs:
        print("run --phase docs first", file=sys.stderr)
        return {}
    store = load(F_PIDS, {"documents": {}, "generated": None})
    done = store["documents"]
    jobs = []
    for series_url, d in docs.items():
        for ds in d.get("datasheets", []):
            if ds in done:
                continue
            jobs.append((ds, d.get("category", "?"), d.get("series_slug", "?"), d.get("series_name", "?")))
    if limit:
        jobs = jobs[:limit]
    print(f"[pids] {len(jobs)} datasheets to read ({len(done)} already done)")
    for i, (url, cat, slug, name) in enumerate(jobs, 1):
        try:
            html = br.fetch(url, timeout=60000)
        except netzscrape.PoliteBlocked:
            done[url] = {"error": "robots", "pids": []}
            continue
        except Exception as e:  # noqa
            done[url] = {"error": str(e)[:90], "pids": []}
            continue
        try:
            pairs = pids_from_html(html)
        except Exception as e:  # noqa
            done[url] = {"error": "parse:" + str(e)[:70], "pids": []}
            continue
        done[url] = {"category": cat, "series_slug": slug, "series_name": name,
                     "pids": [p for p, _ in pairs],
                     "evidence": {p: h[:40] for p, h in pairs[:5]}}
        if i % 10 == 0 or i == len(jobs):
            save(F_PIDS, store)
            tot = len({p for v in done.values() for p in v.get("pids", [])})
            print(f"   {i}/{len(jobs)} docs · {tot} distinct PIDs so far")
    save(F_PIDS, store)
    return store


def report():
    store = load(F_PIDS, {"documents": {}})
    docs = store["documents"]
    by_cat: dict[str, set] = {}
    by_series: dict[tuple, set] = {}
    allp: set[str] = set()
    errors = 0
    for url, d in docs.items():
        if d.get("error"):
            errors += 1
            continue
        cat, name = d.get("category", "?"), d.get("series_name", "?")
        for p in d.get("pids", []):
            allp.add(p)
            by_cat.setdefault(cat, set()).add(p)
            by_series.setdefault((cat, name), set()).add(p)
    print(f"\n=== CISCO PART-NUMBER UNIVERSE ===")
    print(f"documents read: {len(docs)} ({errors} errored)")
    print(f"DISTINCT PART NUMBERS: {len(allp)}")
    print(f"\nby category:")
    for c, s in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(s):6}  {c}")
    print(f"\ntop series:")
    for (c, n), s in sorted(by_series.items(), key=lambda kv: -len(kv[1]))[:25]:
        print(f"  {len(s):6}  {c} / {n[:56]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["series", "docs", "pids", "all"], default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    if a.report and not a.phase:
        report()
        return 0
    br = netzscrape.PoliteBrowser(headless=not a.headed)
    try:
        if a.phase in ("series", "all"):
            phase_series(br)
        if a.phase in ("docs", "all"):
            phase_docs(br, a.limit)
        if a.phase in ("pids", "all"):
            phase_pids(br, a.limit)
    finally:
        br.close()
        netzscrape.print_ledger_report()
    report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
