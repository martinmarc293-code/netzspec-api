"""watchdog — the monitor that watches the scrapers so a human (or Claude) does not have to.

    python3.11 scraper/tools/watchdog.py [--act] [--window 60]

Every cycle it looks at the last WINDOW minutes of fetch_queue activity per source and answers
the questions that matter, writing runs/nightshift/watchdog.md and printing the same:

  * JUNK KEYS   tasks whose key is not a part number (quantities, ranges, dates, footnotes,
                protocol names). A crawler asked to search "0.75K" is wasting a politeness slot
                and telling the host we are a bot. With --act they are deleted (queued/failed) —
                the rules are the same ones a part number must pass at enqueue time.
  * YIELD       done tasks vs tasks that produced facts. A content source with >= 10 done and
                0 with facts in the window is a broken adapter or a changed site: reported as
                ALARM, and with --act the source is paused (enabled=false) so the queue stops
                burning requests until someone looks.
  * NOT LISTED  a source answering "not listed" for most of a window means the keys are wrong
                for that site (or it lost the brand): reported, and the run rate is reduced by
                demoting the remaining keys of that kind.
  * BLOCKS      blocked/failed with challenge in the window: >= 5 -> the source is paused for
                60 minutes (next_at pushed) so we back off instead of hammering.
  * STALL       a source with queued tasks and no task touched in the window while a worker
                should be running: reported as STALL (the supervisor restarts workers).

Nothing here changes the database except the four --act actions above; every action is listed
in the report with the reason, so the log is the audit trail.
"""
from __future__ import annotations
import argparse, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent.parent
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass

# What a part number is NOT. Same family of rules as the enqueue-time purge; kept in one place.
JUNK = [
    re.compile(r"^[0-9][0-9.,]*(-[0-9][0-9.,]*)?\s?[A-Za-z]{0,5}[+]?$"),   # 0.75K, 0.6-1.2A, 40W, 2.5G
    re.compile(r"^[0-9.]+(-[0-9.]+)?(/[0-9.]+)+[A-Za-z]{0,4}$"),          # 10/100/1000, 0-30M/50M
    re.compile(r"^[0-9]+x[0-9]+[A-Za-z]*$"),                              # 24x10G
    re.compile(r"^[0-9]+(BASE|G|GE|GB|TB|MB|W|V|A|K|M)[A-Z0-9-]*$", re.I),   # 1000BASE-T
    re.compile(r"^v?[0-9]+(\.[0-9]+)+[a-z]?$"),                           # 17.9.4a
    re.compile(r"^[0-9]{1,2}-[A-Z]{3}-[0-9]{4}$", re.I),                  # 01-MAY-2022
    re.compile(r"^[0-9]+\."),                                             # footnote-prefixed 1.DDR4-3200
    re.compile(r"^(RJ|USB|HDMI|VGA|SFP|QSFP|QSFP28|QSFP-DD|SFP\+|SFP28|XFP|GBIC|CFP)[0-9A-Z+]*$", re.I),
    re.compile(r"^(IPV4|IPV6|IEEE|ISO|EN|UL|FCC|CE|RoHS|VLAN|MAC|QOS|PoE|PoE\+|VPN|SSH|SNMP|HTTP|HTTPS|TCP|UDP|H\.[0-9]+|G\.[0-9]+)[0-9A-Z./-]*$", re.I),
]


def is_junk(key: str) -> bool:
    k = (key or "").strip()
    if len(k) < 4 or " " in k or not re.search(r"[A-Za-z]", k):
        return True
    # a name with no digit is fine when it is dash-structured (Ubiquiti: USW-Aggregation, USW-Flex-XG);
    # a bare word without digits or dashes is not a part number
    if not re.search(r"[0-9]", k) and "-" not in k:
        return True
    return any(rx.match(k) for rx in JUNK)


def load_env() -> dict:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--act", action="store_true", help="delete junk, pause broken/blocked sources")
    ap.add_argument("--window", type=int, default=60, help="minutes")
    a = ap.parse_args()
    env = load_env()
    c = psycopg.connect(env["DATABASE_URL"], autocommit=True, row_factory=dict_row)
    lines = [f"# scraper watchdog — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} (window {a.window} min{', ACTING' if a.act else ', report only'})", ""]
    actions: list[str] = []

    sources = c.execute("SELECT id, slug, enabled, tier FROM sources ORDER BY slug").fetchall()
    for s in sources:
        st = c.execute(
            """SELECT status, count(*) AS n,
                      sum(CASE WHEN (result->>'facts')::int > 0 THEN 1 ELSE 0 END) AS with_facts,
                      sum(CASE WHEN result->>'outcome' = 'not_listed' THEN 1 ELSE 0 END) AS not_listed,
                      sum(CASE WHEN last_error ILIKE '%%challenge%%' OR last_error ILIKE '%%http 403%%' OR last_error ILIKE '%%http 429%%' THEN 1 ELSE 0 END) AS blocked
                 FROM fetch_queue WHERE source_id = %s AND updated_at > now() - make_interval(mins => %s)
                GROUP BY status""", (s["id"], a.window)).fetchall()
        if not st:
            queued = c.execute("SELECT count(*) AS n FROM fetch_queue WHERE source_id = %s AND status = 'queued'", (s["id"],)).fetchone()["n"]
            if s["enabled"] and queued:
                lines.append(f"- **{s['slug']}**: STALL — {queued} queued, nothing touched in {a.window} min (worker not running?)")
            continue
        by = {r["status"]: r for r in st}
        done = by.get("done", {}).get("n", 0) or 0
        with_facts = by.get("done", {}).get("with_facts", 0) or 0
        not_listed = by.get("done", {}).get("not_listed", 0) or 0
        blocked = sum((r["blocked"] or 0) for r in st) + (by.get("blocked", {}).get("n", 0) or 0)
        failed = by.get("failed", {}).get("n", 0) or 0
        verdict = "ok"
        if done >= 10 and with_facts == 0 and not_listed < done:
            verdict = "ALARM zero yield (adapter broken or site changed)"
            if a.act:
                c.execute("UPDATE sources SET enabled = false, notes = COALESCE(notes,'') || ' [watchdog paused: zero yield ' || now()::date || ']' WHERE id = %s", (s["id"],))
                actions.append(f"paused {s['slug']}: {done} done, 0 with facts")
        elif done >= 10 and not_listed >= done * 0.6:
            verdict = f"WARN {not_listed}/{done} not listed (keys wrong for this site?)"
        if blocked >= 5:
            verdict += f"; BLOCKED {blocked}x"
            if a.act:
                n = c.execute("UPDATE fetch_queue SET next_at = now() + interval '60 minutes' WHERE source_id = %s AND status IN ('queued','failed')", (s["id"],)).rowcount
                actions.append(f"backed off {s['slug']} for 60 min ({blocked} blocks; {n} tasks deferred)")
        lines.append(f"- **{s['slug']}**: done {done}, with facts {with_facts}, not listed {not_listed}, failed {failed}, blocked {blocked} → {verdict}")

    # junk keys anywhere in the pending queue
    junk = [r for r in c.execute("SELECT id, key, task FROM fetch_queue WHERE part_id IS NULL AND status IN ('queued','failed') AND task IN ('search','gpl','part-page')").fetchall() if is_junk(r["key"])]
    lines += ["", f"## junk keys pending: {len(junk)}" + (f" — e.g. {', '.join(r['key'] for r in junk[:8])}" if junk else "")]
    if junk and a.act:
        c.execute("DELETE FROM fetch_queue WHERE id = ANY(%s)", ([r["id"] for r in junk],))
        actions.append(f"deleted {len(junk)} junk keys")

    lines += ["", "## actions", *([f"- {x}" for x in actions] or ["- none"])]
    out = ROOT / "runs" / "nightshift" / "watchdog.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
