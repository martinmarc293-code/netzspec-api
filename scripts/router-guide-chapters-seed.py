"""Queue the SPEC CHAPTERS of the router hardware installation guides -- step 1 of the installation-guide reader.
Operator order, 5 Oct 2026 ("... find all the datasheets, get all the data ..."); reviewer, 6 Oct 2026 ~17:20: "Installation-guide
reader meanwhile -- agreed", on the plan "queue the spec chapters from the cached landing pages, then attribute their per-model
tables to PIDs. I'll measure step 2 on a handful of fetched chapters before building it."
    python3 scripts/router-guide-chapters-seed.py [--only-urls FILE] [--out FILE]            # dry run
    python3 scripts/router-guide-chapters-seed.py --commit [--only-urls FILE] [--out FILE]   # one run (enqueue-router-guide-chapters)

WHY. The lane queued the hardware guides it found on router listings (cisco_datasheets.discover, HW_GUIDE) as DOCUMENTS. Measured
over the 84 cached router guides (6 Oct): 67 are a book's LANDING page -- ~5,400 characters of table of contents and no table --
linking 572 chapters, and not one chapter was ever fetched. The specifications sit in the chapters: "Technical Specifications"
(16 books), the "<platform> Overview" / "Product Overview" chapters (~39), "Product IDs" (4). discover() is deliberately silent on a
document page (the Meraki lesson: discovery from content pages queued a whole translated tree), so a landing page's chapters are
queued here, from the cached landing page, never by guessing a URL.

WHAT COUNTS. A chapter is a link under the landing page's OWN book directory (<book>.html -> <book>/<chapter>.html) whose link text
names a specification chapter -- SPEC_CHAPTER below, read off the 572 measured titles. Preface, safety warnings, LEDs, installation
and configuration chapters stay out. A landing page is a cached /td/docs/ page the lane's own HW_GUIDE accepts.

THE WRITE is router-acquire-seed.py's: INSERT ... ON CONFLICT DO UPDATE re-queues a finished row, RETURNING says inserted vs
reactivated; every URL passes the lane's enqueue refusal first; a queued, leased or skipped row is left as it is.
"""
from __future__ import annotations
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from sources.base import refused_url  # noqa: E402
from sources.cisco_datasheets import HW_GUIDE  # noqa: E402  -- the lane's own guide test, never a second copy

APPROVED = ("operator, 5 Oct 2026: \"complete the router category full ... find all the datasheets, get all the data and make this "
            "cisco router category ready ...\"; reviewer, 6 Oct 2026 ~17:20: \"Installation-guide reader meanwhile -- agreed\"")
PRIORITY = 100         # the datasheets' rung: a spec chapter is a document, as the guide that links it was
CACHE = Path(os.environ.get("NETZSPEC_CACHE_DIR", "/var/lib/netzspec-api/cache"))
# Read off the 572 chapter titles of the 67 landing pages (6 Oct 2026): Technical Specifications 16, "<platform> Overview" 18,
# Overview 14, Product Overview 7, Product IDs 4, Specifications 1. ROM Monitor / Installation Roadmap overviews are not hardware.
SPEC_CHAPTER = re.compile(r"(?i)technical specifications|^specifications$|product ids?(?![a-z])|(?:^|\s)overview(?:\s|$)")
NOT_SPEC = re.compile(r"(?i)rom ?mon|roadmap")


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def chapters_of(url: str) -> list[tuple[str, str]]:
    """(chapter url, link text) for the spec chapters a cached landing page links under its own book directory."""
    p = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    if not p.exists():
        return []
    s = re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", p.read_text(encoding="utf-8", errors="replace"))
    book = url.rsplit(".", 1)[0] + "/"
    out: list[tuple[str, str]] = []
    for m in re.finditer(r'<a[^>]+href="([^"#?]+\.html)"[^>]*>(.*?)</a>', s, re.I | re.S):
        h = m.group(1)
        full = h if h.startswith("http") else ("https://www.cisco.com" + h if h.startswith("/") else url.rsplit("/", 1)[0] + "/" + h)
        text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2)))).strip()
        if full.startswith(book) and SPEC_CHAPTER.search(text) and not NOT_SPEC.search(text) and full not in [o[0] for o in out]:
            out.append((full, text))
    return out


def main() -> int:
    import psycopg
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--only-urls", default="", help="queue only these chapter URLs (one per line); each must be a derived chapter")
    ap.add_argument("--out", default=str(ROOT / "data" / "acquire" / "router-guide-chapters.txt"))
    a = ap.parse_args()
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip() or None
    if not sha and (ROOT / "GIT_SHA").exists():
        sha = (ROOT / "GIT_SHA").read_text(encoding="utf-8").strip()
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/router-guide-chapters-seed") as c:
        src = c.execute("SELECT id FROM sources WHERE slug = 'cisco-datasheets'").fetchone()[0]
        guides = [r[0] for r in c.execute(
            "SELECT DISTINCT url FROM fetch_queue WHERE source_id = %s AND status::text = 'done' AND url LIKE '%%/td/docs/%%' ORDER BY 1",
            (src,)).fetchall() if HW_GUIDE.match(r[0])]
        derived: dict[str, tuple[str, str]] = {}
        landing = 0
        for g in guides:
            ch = chapters_of(g)
            landing += bool(ch)
            for u, t in ch:
                derived.setdefault(u, (g, t))
        if not guides:
            raise SystemExit("no done router guide in the queue -- a broken query, never 'nothing to seed'")
        want = list(derived)
        if a.only_urls:
            only = [x.strip() for x in Path(a.only_urls).read_text(encoding="utf-8").splitlines() if x.strip()]
            stray = [u for u in only if u not in derived]
            if stray:
                raise SystemExit(f"--only-urls names {len(stray)} URL(s) that are not derived chapters (refusing): {stray[:3]}")
            want = only
        refused = {u: refused_url(u) for u in want if refused_url(u)}
        want = [u for u in want if u not in refused]
        have = {r[0]: r[1] for r in c.execute(
            "SELECT key, status::text FROM fetch_queue WHERE source_id = %s AND task = 'datasheet' AND key = ANY(%s)", (src, want)).fetchall()}
        by: dict[str, int] = {}
        for u in want:
            by[have.get(u, "new")] = by.get(have.get(u, "new"), 0) + 1
        print(f"done router guides: {len(guides)}; landing pages with spec chapters: {landing}; spec chapters derived: {len(derived)}")
        print(f"to queue: {len(want)} (refused at enqueue {len(refused)}); existing rows by status {dict(sorted(by.items()))}")
        for u in want[:12]:
            print(f"  {derived[u][1][:44]:44} {u.split('/td/docs/')[1][:96]}")
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text("\n".join(want) + "\n", encoding="utf-8")
        if not a.commit:
            print("dry run: nothing written (--commit to queue them); URL list written to", a.out)
            return 0
        with c.transaction():
            run_id = c.execute(
                "INSERT INTO runs (kind, inputs, git_sha, notes) VALUES ('enqueue-router-guide-chapters', %s::jsonb, %s, %s) RETURNING id",
                (json.dumps({"approved": APPROVED, "chapters": len(want), "derived": len(derived), "landing_pages": landing,
                             "only_urls": a.only_urls or None, "refused": refused, "existing_by_status": by, "priority": PRIORITY}),
                 sha, "router hardware-guide spec chapters for the cisco-datasheets lane (installation-guide reader, step 1)")).fetchone()[0]
            res = c.execute(
                """INSERT INTO fetch_queue (source_id, task, key, url, priority)
                   SELECT %s, 'datasheet', u, u, %s FROM unnest(%s::text[]) AS u
                   ON CONFLICT (source_id, task, key) DO UPDATE
                     SET status = 'queued', next_at = now(), attempts = 0, last_error = NULL, leased_by = NULL,
                         priority = EXCLUDED.priority, updated_at = now()
                   WHERE fetch_queue.status::text IN ('done', 'failed', 'blocked')
                   RETURNING (xmax = 0) AS inserted""", (src, PRIORITY, want)).fetchall()
            ins = sum(1 for r in res if r[0])
            c.execute("UPDATE runs SET status = 'succeeded'::run_status, finished_at = now(), stats = %s::jsonb WHERE id = %s",
                      (json.dumps({"inserted": ins, "reactivated": len(res) - ins, "left_as_is": len(want) - len(res)}), run_id))
        now = c.execute("SELECT status::text, count(*) FROM fetch_queue WHERE source_id = %s AND task = 'datasheet' AND key = ANY(%s) "
                        "GROUP BY 1 ORDER BY 1", (src, want)).fetchall()
        print(f"run {run_id}: inserted {ins}, reactivated {len(res) - ins}, left as is {len(want) - len(res)}; re-read: {dict(now)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
