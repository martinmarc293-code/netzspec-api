"""Queue the PDF TWIN of every router HTML datasheet we hold -- the link taken from the datasheet page itself, never guessed.
Reviewer, 6 Oct 2026 ~18:40 (verbatim): "PDF twins: ISR 4000 twin first and read the 4461 rows off the PDF itself; then the
10-twin sample against their HTML; then the rest under a recorded enqueue run, links taken from each page. Where PDF and HTML of
the same sheet disagree on a value, it's a conflict, and the newer revision wins with the reason recorded; where the PDF only adds
rows, it fills."
    python3 scripts/router-pdf-twins-seed.py [--only-urls FILE] [--out FILE]            # dry run
    python3 scripts/router-pdf-twins-seed.py --commit [--only-urls FILE] [--out FILE]   # one run (enqueue-router-pdf-twins)

WHY. Measured 6 Oct over the 371 router HTML datasheets: 323 link their own PDF (315 distinct), and the store held 6. Nothing
queues them -- discover() is silent on a datasheet page by design, and no listing links them -- yet a twin can carry what its
HTML does not: the cached HTML of c78-732542 (rev 2026-09-01) prints the ISR 4461's weight cells EMPTY.
WHAT COUNTS AS A TWIN: a .pdf link on the page whose URL carries the page's own document number (c78-732542) or its file stem
(8100-series-secure-routers-ds). Any other PDF the page links is somebody else's document and is not queued here.
THE POPULATION: vendor_datasheet_html documents linked to a live router part, read from the box's page cache.
THE WRITE: scraper/seed_queue.enqueue -- the one write every seed makes (reactivation counted apart, the lane's refusal first).
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from sources.base import refused_url  # noqa: E402
from seed_queue import env, enqueue  # noqa: E402

APPROVED = ("reviewer, 6 Oct 2026 ~18:40: \"PDF twins: ISR 4000 twin first and read the 4461 rows off the PDF itself; then the "
            "10-twin sample against their HTML; then the rest under a recorded enqueue run, links taken from each page.\"; operator, "
            "5 Oct 2026: \"... find all the datasheets, get all the data ...\"")
PRIORITY = 100
CACHE = Path(os.environ.get("NETZSPEC_CACHE_DIR", "/var/lib/netzspec-api/cache"))
DOC_NO = re.compile(r"(c\d{2}-\d{5,7})", re.I)


def twin_of(url: str, cache_path: str) -> str | None:
    p = CACHE / cache_path
    if not p.exists():
        return None
    s = p.read_text(encoding="utf-8", errors="replace")
    num = DOC_NO.search(url)
    stem = url.rsplit("/", 1)[1].rsplit(".", 1)[0]
    for m in re.finditer(r'href="([^"]+\.pdf)"', s, re.I):
        h = m.group(1)
        full = h if h.startswith("http") else "https://www.cisco.com" + (h if h.startswith("/") else "/" + h)
        if (num and num.group(1).lower() in full.lower()) or stem.lower() in full.lower():
            return full
    return None


def main() -> int:
    import psycopg
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--only-urls", default="", help="queue only these twin URLs (one per line); each must be a derived twin")
    ap.add_argument("--out", default=str(ROOT / "data" / "acquire" / "router-pdf-twins.txt"))
    a = ap.parse_args()
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip() or None
    if not sha and (ROOT / "GIT_SHA").exists():
        sha = (ROOT / "GIT_SHA").read_text(encoding="utf-8").strip()
    with psycopg.connect(env(ROOT)["DATABASE_URL"], autocommit=True, application_name="cisco/router-pdf-twins-seed") as c:
        src = c.execute("SELECT id FROM sources WHERE slug = 'cisco-datasheets'").fetchone()[0]
        pages = c.execute(
            """SELECT DISTINCT d.url, d.cache_path FROM source_docs d JOIN doc_parts dp ON dp.doc_id = d.doc_id
                 JOIN parts p ON p.id = dp.part_id JOIN categories k ON k.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
                WHERE v.slug = 'cisco' AND k.slug = 'routers' AND p.retired_at IS NULL AND d.doc_type::text = 'vendor_datasheet_html'
                  AND d.cache_path IS NOT NULL ORDER BY 1""").fetchall()
        if not pages:
            raise SystemExit("no router HTML datasheet found -- a broken query, never 'nothing to seed'")
        twins: dict[str, str] = {}
        for url, cp in pages:
            t = twin_of(url, cp)
            if t:
                twins.setdefault(t, url)
        held = {r[0] for r in c.execute("SELECT url FROM source_docs WHERE url = ANY(%s)", (list(twins),)).fetchall()}
        want = [t for t in twins if t not in held]
        if a.only_urls:
            only = [x.strip() for x in Path(a.only_urls).read_text(encoding="utf-8").splitlines() if x.strip()]
            stray = [u for u in only if u not in twins]
            if stray:
                raise SystemExit(f"--only-urls names {len(stray)} URL(s) that are not derived twins (refusing): {stray[:3]}")
            want = [u for u in only if u not in held]
        refused = {u: refused_url(u) for u in want if refused_url(u)}
        want = [u for u in want if u not in refused]
        have = dict(c.execute("SELECT key, status::text FROM fetch_queue WHERE source_id = %s AND task = 'datasheet' AND key = ANY(%s)",
                              (src, want)).fetchall())
        by: dict[str, int] = {}
        for u in want:
            by[have.get(u, "new")] = by.get(have.get(u, "new"), 0) + 1
        print(f"router HTML datasheets: {len(pages)}; PDF twins linked: {len(twins)} distinct; already held: {len(held)}")
        print(f"to queue: {len(want)} (refused at enqueue {len(refused)}); existing rows by status {dict(sorted(by.items()))}")
        for u in want[:8]:
            print(f"  {u.split('/collateral/')[-1][:100]}  <- {twins[u].rsplit('/', 1)[1][:60]}")
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text("".join(u + "\n" for u in want), encoding="utf-8")
        if not a.commit:
            print("dry run: nothing written (--commit to queue them); URL list written to", a.out)
            return 0
        run_id, stats, now = enqueue(c, source_id=src, task="datasheet", urls=want, priority=PRIORITY, kind="enqueue-router-pdf-twins",
                                     inputs={"approved": APPROVED, "twins": len(want), "derived": len(twins), "held": len(held),
                                             "only_urls": a.only_urls or None, "refused": refused, "existing_by_status": by,
                                             "priority": PRIORITY, "from_pages": {u: twins[u] for u in want}},
                                     sha=sha, notes="PDF twins of router HTML datasheets, each linked from its own page")
        print(f"run {run_id}: {stats}; re-read: {now}")
        return 0 if sum(n for s, n in now.items() if s in ("queued", "leased", "skipped")) == len(want) else 1


if __name__ == "__main__":
    raise SystemExit(main())
