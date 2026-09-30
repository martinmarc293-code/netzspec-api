"""Park every fetch_queue row whose URL is a login-walled shape (reviewer ruling 30 Sep 2026: "/products/se/ excluded as
a login-walled shape, the 527 rows marked so they never re-queue"). Evidence: docs/reviewer/2026-09-28/acquire-probe.md.

    python3.11 scripts/park-login-walled.py            # dry run: counts by status, nothing written
    python3.11 scripts/park-login-walled.py --commit   # one run (kind park-login-walled), rows -> skipped with the reason

A parked row is `skipped`, which no lease picks and no planner repair reactivates (plan.py re-queues `done` rows only), and
the shape is refused at enqueue by sources.base.refused_url, so it cannot come back as a new row either. Nothing is
deleted: the row, its URL and its history stay, and the reason names the ruling, so the decision is reversible.
The rule's own SQL is derived from sources.base.LOGIN_WALLED_URLS so the park and the refusal cannot drift apart.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))
from sources.base import LOGIN_WALLED_URLS, refused_url  # noqa: E402

REASON = ("login-walled shape: /c/<lang>/<cc>/products/se/ redirects every client to 'Log In to Cisco' (acquire probe "
          "30 Sep 2026, docs/reviewer/2026-09-28/acquire-probe.md); parked by reviewer ruling, never re-queued")
APPROVED = "reviewer ruling 30 Sep 2026: /products/se/ excluded as a login-walled shape, rows marked so they never re-queue"


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> int:
    import psycopg
    commit = "--commit" in sys.argv
    # Postgres' ~* takes the same pattern text; the Python flag re.I is the ~* itself
    patterns = [rx.pattern for rx in LOGIN_WALLED_URLS]
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    with psycopg.connect(env()["DATABASE_URL"], autocommit=True, application_name="cisco/park-login-walled") as c:
        rows = c.execute("SELECT id, url, status FROM fetch_queue WHERE url ~* ANY(%s)", (patterns,)).fetchall()
        # the SQL and the Python rule must agree row by row, or the park and the enqueue refusal have drifted
        disagree = [u for _, u, _ in rows if refused_url(u) != "login-walled"]
        if disagree:
            raise SystemExit(f"the SQL pattern and refused_url disagree on {len(disagree)} rows, e.g. {disagree[:2]}; nothing written")
        by = {}
        for _, _, s in rows:
            by[s] = by.get(s, 0) + 1
        todo = [i for i, _, s in rows if s != "skipped"]
        print(f"login-walled rows: {len(rows)} by status {dict(sorted(by.items()))}; to park {len(todo)}")
        if not commit:
            print("dry run: nothing written (--commit to park)")
            return 0
        with c.transaction():
            run_id = c.execute("INSERT INTO runs (kind, inputs, git_sha, notes) VALUES ('park-login-walled', %s::jsonb, %s, %s) RETURNING id",
                               (json.dumps({"approved": APPROVED, "patterns": patterns, "rows_matched": len(rows), "by_status": by}),
                                sha, REASON)).fetchone()[0]
            n = c.execute("""UPDATE fetch_queue SET status = 'skipped', last_error = %s, leased_by = NULL, updated_at = now()
                              WHERE id = ANY(%s) AND status <> 'skipped' AND status <> 'leased' RETURNING id""",
                          (REASON, todo)).fetchall()
            leased = c.execute("SELECT count(*) FROM fetch_queue WHERE id = ANY(%s) AND status = 'leased'", (todo,)).fetchone()[0]
            c.execute("UPDATE runs SET status = 'succeeded'::run_status, finished_at = now(), stats = %s::jsonb WHERE id = %s",
                      (json.dumps({"parked": len(n), "left_leased": leased}), run_id))
        # re-read from the same autocommit connection after the transaction closed
        left = c.execute("SELECT count(*) FROM fetch_queue WHERE url ~* ANY(%s) AND status <> 'skipped'", (patterns,)).fetchone()[0]
        print(f"run {run_id}: parked {len(n)}, left leased {leased}; login-walled rows not skipped now: {left}")
        return 0 if left == leased else 1


if __name__ == "__main__":
    raise SystemExit(main())
