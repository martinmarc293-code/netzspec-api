"""tests/scraper/test_seed_queue.py -- proof for scraper/seed_queue.py (the one write every enqueue seed makes), against the TEST
database only:

    python3.11 tests/scraper/test_seed_queue.py      (needs psycopg and DATABASE_URL_TEST in .env)

Refuses to run unless DATABASE_URL_TEST names a *_test<N> database. Plants its own rows under a URL prefix no real document has
(example.invalid, a reserved name) and deletes them, and the run rows it made, before it exits.

What it proves, each against a planted row in a known state: a NEW url is inserted; a DONE row is reactivated (queued again, its
attempts and error cleared); a QUEUED row and a SKIPPED row are left exactly as they are; the counts say which is which; and a list
naming a url twice is refused before anything is written.
"""
from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
from seed_queue import env, enqueue  # noqa: E402

PASS, MISS = [], []


def check(name: str, ok: bool, detail: object = "") -> None:
    (PASS if ok else MISS).append(name)
    print(f"{'PASS' if ok else 'MISS'}  {name}{'' if ok else f'  -> {detail}'}")


def main() -> int:
    import psycopg
    url = env(ROOT).get("DATABASE_URL_TEST", "")
    db = re.search(r"/([^/?]+)(?:\?|$)", url)
    if not db or not re.fullmatch(r".+_test[0-9]*", db.group(1)):
        print("REFUSED: DATABASE_URL_TEST is missing or does not name a *_test database -- could not check (not a pass)")
        return 2
    prefix = f"https://example.invalid/seed-queue-test/{uuid.uuid4().hex}/"
    new, done, queued, skipped = (prefix + n for n in ("new.pdf", "done.pdf", "queued.pdf", "skipped.pdf"))
    with psycopg.connect(url, autocommit=True, application_name="cisco/test-seed-queue") as c:
        row = c.execute("SELECT id FROM sources WHERE slug = 'cisco-datasheets'").fetchone()
        if not row:
            print("REFUSED: the test database has no cisco-datasheets source -- could not check (not a pass)")
            return 2
        src = row[0]
        runs: list[int] = []
        try:
            for u, st in ((done, "done"), (queued, "queued"), (skipped, "skipped")):
                c.execute("INSERT INTO fetch_queue (source_id, task, key, url, priority, status, attempts, last_error) "
                          "VALUES (%s, 'datasheet', %s, %s, 500, %s::fetch_status, 3, 'planted')", (src, u, u, st))
            planted = c.execute("SELECT count(*) FROM fetch_queue WHERE key LIKE %s", (prefix + "%",)).fetchone()[0]
            check("CONTROL the three planted rows exist before the write", planted == 3, planted)
            run_id, stats, now = enqueue(c, source_id=src, task="datasheet", urls=[new, done, queued, skipped], priority=100,
                                         kind="test-seed-queue", inputs={"test": True}, sha=None, notes="tests/scraper/test_seed_queue.py")
            runs.append(run_id)
            check("the counts tell inserted from reactivated from left: 1 / 1 / 2", stats == {"inserted": 1, "reactivated": 1, "left_as_is": 2}, stats)
            check("the re-read reports what the queue holds: 3 queued, 1 skipped", now == {"queued": 3, "skipped": 1}, now)
            st = dict(c.execute("SELECT key, status::text || '/' || attempts || '/' || coalesce(last_error, '-') || '/' || priority "
                                "FROM fetch_queue WHERE key LIKE %s", (prefix + "%",)).fetchall())
            check("a DONE row is reactivated: queued, attempts 0, error cleared, the seed's priority", st[done] == "queued/0/-/100", st[done])
            check("a QUEUED row is left exactly as it was (its attempts, error and priority untouched)", st[queued] == "queued/3/planted/500", st[queued])
            check("SABOTAGE a SKIPPED row is NOT reactivated -- a parked decision is not a seed's to reverse", st[skipped] == "skipped/3/planted/500", st[skipped])
            check("a NEW url is inserted at the seed's priority", st[new] == "queued/0/-/100", st[new])
            rs = c.execute("SELECT kind, status::text, stats FROM runs WHERE id = %s", (run_id,)).fetchone()
            check("the run row is closed succeeded with the same counts", rs[0] == "test-seed-queue" and rs[1] == "succeeded" and rs[2] == stats, rs)
            before = c.execute("SELECT count(*) FROM runs").fetchone()[0]
            try:
                enqueue(c, source_id=src, task="datasheet", urls=[new, new], priority=100, kind="test-seed-queue", inputs={}, sha=None, notes="x")
                check("SABOTAGE a list naming a url twice is refused", False, "no error")
            except ValueError as e:
                after = c.execute("SELECT count(*) FROM runs").fetchone()[0]
                check("SABOTAGE a list naming a url twice is refused before anything is written", "twice" in str(e) and after == before, (str(e), before, after))
        finally:
            c.execute("DELETE FROM fetch_queue WHERE key LIKE %s", (prefix + "%",))
            if runs:
                c.execute("DELETE FROM runs WHERE id = ANY(%s)", (runs,))
    print(f"\nseed_queue: {len(PASS)} passed, {len(MISS)} missed")
    return 1 if MISS else 0


if __name__ == "__main__":
    raise SystemExit(main())
