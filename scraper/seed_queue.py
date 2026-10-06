"""THE ONE WRITE every enqueue seed makes (scripts/router-acquire-seed.py, router-guide-chapters-seed.py, router-pdf-twins-seed.py).

A run row; INSERT ... ON CONFLICT DO UPDATE that re-queues a FINISHED row (done / failed / blocked) and leaves a queued, leased
or skipped row exactly as it is (a parked decision is not a seed's to reverse); RETURNING (xmax = 0), so an INSERTED row and a
REACTIVATED one are counted apart -- "0 inserted" must never read as "nothing needed doing" (D:\\Project\\CLAUDE.md, the
ON CONFLICT DO NOTHING lesson); the run closed with those counts; all in ONE transaction. Then the rows are re-read after the
transaction closed, so the caller reports what the queue holds, not what it meant to write.

Three scripts carried their own copy of this until 6 Oct 2026. Three copies of one write is three copies of its next bug.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

WRITE = """INSERT INTO fetch_queue (source_id, task, key, url, priority)
           SELECT %s, %s, u, u, %s FROM unnest(%s::text[]) AS u
           ON CONFLICT (source_id, task, key) DO UPDATE
             SET status = 'queued', next_at = now(), attempts = 0, last_error = NULL, leased_by = NULL,
                 priority = EXCLUDED.priority, updated_at = now()
           WHERE fetch_queue.status::text IN ('done', 'failed', 'blocked')
           RETURNING (xmax = 0) AS inserted"""


def env(root: Path) -> dict:
    """KEY=value pairs of <root>/.env -- read, never printed (CLAUDE.md: a connection string never reaches the screen)."""
    out = {}
    for line in (root / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def enqueue(c, *, source_id: int, task: str, urls: list[str], priority: int, kind: str, inputs: dict, sha: str | None,
            notes: str) -> tuple[int, dict, dict]:
    """Queue `urls` as `task` rows under one run of `kind`. Returns (run id, {inserted, reactivated, left_as_is}, the rows'
    statuses re-read after the transaction closed). `c` is a psycopg connection opened with autocommit=True."""
    if len(set(urls)) != len(urls):
        raise ValueError("enqueue: the URL list names a URL twice")
    with c.transaction():
        run_id = c.execute("INSERT INTO runs (kind, inputs, git_sha, notes) VALUES (%s, %s::jsonb, %s, %s) RETURNING id",
                           (kind, json.dumps(inputs), sha, notes)).fetchone()[0]
        res = c.execute(WRITE, (source_id, task, priority, urls)).fetchall()
        ins = sum(1 for r in res if r[0])
        stats = {"inserted": ins, "reactivated": len(res) - ins, "left_as_is": len(urls) - len(res)}
        c.execute("UPDATE runs SET status = 'succeeded'::run_status, finished_at = now(), stats = %s::jsonb WHERE id = %s",
                  (json.dumps(stats), run_id))
    now = dict(c.execute("SELECT status::text, count(*) FROM fetch_queue WHERE source_id = %s AND task = %s AND key = ANY(%s) "
                         "GROUP BY 1 ORDER BY 1", (source_id, task, urls)).fetchall())
    return run_id, stats, now
