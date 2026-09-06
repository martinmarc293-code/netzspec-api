"""tests/scraper/test_plan_priority.py — proof that the planner's drain order is the one it claims.

    python3.11 tests/scraper/test_plan_priority.py

No database and no network: queue_priority is a pure function over one dict.

WHY THIS FILE EXISTS. The recover section attached `"priority": 500` to every item it produced, and
the INSERT hardcoded `60 if part_id else 80`. `item["priority"]` was read NOWHERE — one occurrence
of the string in the whole file, the line that set it. So 6,851 recovery rows went into the queue at
80: rank-equal with new acquisition instead of yielding to it, and AHEAD of the 60-priority gap work
the catalogue exists to fill.

The commit that introduced it explained the intended ordering at length. That is WORSE than not
explaining it, because a reader believes the ordering exists — the reasoning is right there and it
describes something the code does not do. Same shape as `worktree` being declared and never read,
as `minAuthorityLinks` sitting in a gate's rule block and never being evaluated, and as a docstring
promising a test file that did not exist. Fourth instance in one day.

worker.py leases with `ORDER BY priority, next_at, id`, so LOWER DRAINS FIRST and the numbers below
are an ordering rather than a ranking.
"""
from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_spec = importlib.util.spec_from_file_location("_plan", str(ROOT / "scraper" / "brands" / "plan.py"))
PLAN = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PLAN)

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:5} | {what[:82]:84}" + ("" if ok else f" | got {str(got)[:150]}"))


GAP = {"source": "s", "task": "part-page", "key": "k", "url": "u", "part_id": 7}
DOC = {"source": "s", "task": "datasheet", "key": "k", "url": "u"}
RECOVER = {"source": "s", "task": "datasheet", "key": "k", "url": "u", "priority": 500}

check("Q1", "a part-anchored gap task drains FIRST - it is the work the catalogue exists to do",
      PLAN.queue_priority(GAP) == 60, PLAN.queue_priority(GAP))
check("Q2", "document work with no part behind it drains after that",
      PLAN.queue_priority(DOC) == 80, PLAN.queue_priority(DOC))
check("Q2b", "a LISTING outranks document work - it is the discovery ladder and the only route to a "
             "URL we do not already hold. The `entry` section calls itself 'the top of the ladder' "
             "and then gave every listing 80, the same rank as the re-reads it is meant to lead: a "
             "stated ordering the code did not implement, exactly like the `priority: 500` bug",
      PLAN.queue_priority({"task": "listing", "key": "k", "url": "u"}) == 70,
      PLAN.queue_priority({"task": "listing", "key": "k", "url": "u"}))
check("Q2c", "SABOTAGE ...and it still drains AFTER part-anchored gap work, so discovery cannot "
             "starve the work the catalogue exists to do",
      PLAN.queue_priority(GAP) < PLAN.queue_priority({"task": "listing", "key": "k"}) < PLAN.queue_priority(DOC))
check("Q2d", "SABOTAGE a part-anchored LISTING is still 60 - the part anchor is the stronger claim "
             "and the listing rule must not override it",
      PLAN.queue_priority({"task": "listing", "key": "k", "part_id": 7}) == 60,
      PLAN.queue_priority({"task": "listing", "key": "k", "part_id": 7}))
check("Q3", "A CALLER'S OWN PRIORITY IS HONOURED - this is the whole bug: `priority: 500` was set "
            "on 6,851 recover items and the INSERT hardcoded 80, so it was silently discarded",
      PLAN.queue_priority(RECOVER) == 500, PLAN.queue_priority(RECOVER))
check("Q4", "SABOTAGE recovery drains AFTER new acquisition, not rank-equal with it - recovering a "
            "page we once held matters less than acquiring one we never had",
      PLAN.queue_priority(RECOVER) > PLAN.queue_priority(DOC) > PLAN.queue_priority(GAP),
      f"recover={PLAN.queue_priority(RECOVER)} doc={PLAN.queue_priority(DOC)} gap={PLAN.queue_priority(GAP)}")
check("Q5", "SABOTAGE an explicit priority of 0 is honoured rather than treated as absent - `or` "
            "instead of `is not None` would silently promote it to 80",
      PLAN.queue_priority({"priority": 0}) == 0, PLAN.queue_priority({"priority": 0}))
check("Q6", "a part-anchored item may still override, so an urgent re-read of one part is possible",
      PLAN.queue_priority({"part_id": 7, "priority": 10}) == 10)

# THE CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL BUG, and it is not about the function: it is about
# whether the INSERT calls it. The defect was never in the arithmetic - it was that the arithmetic
# sat beside the INSERT rather than inside it.
SRC = (ROOT / "scraper" / "brands" / "plan.py").read_text(encoding="utf-8")
check("Q7", "the INSERT actually CALLS queue_priority - the bug was a correct value computed next "
            "to a statement that ignored it",
      "queue_priority(item)" in SRC, "the INSERT does not call it")
check("Q8", "SABOTAGE no hardcoded priority expression survives beside the INSERT",
      "item.get(\"part_id\"), 60 if item.get(\"part_id\") else 80)" not in SRC,
      "the hardcoded 60/80 is still in the INSERT")

# ---- the INSERT's conflict behaviour, read off the source ------------------------------------
# `ON CONFLICT ... DO NOTHING` turns a REPAIR into a silent no-op. Every section of this planner
# targets work that needs doing now, and a repair by definition aims at rows that already exist, so
# DO NOTHING left a `done` row exactly as it was - never leased again, the work dropped, and counted
# as "already_queued", which reads like "nothing needed doing". Measured 6 Sep 2026: 414 of Cisco's
# 2,406 existing rows were `done` and therefore dropped; on Juniper's lane it was 494 of 494, a
# total no-op. The same statement, two different stories, and either framing alone sends someone to
# the wrong place.
INS = SRC.split("INSERT INTO fetch_queue")[1][:900]

check("C1", "the INSERT REACTIVATES a conflicting row rather than dropping the repair",
      "DO UPDATE" in INS and "DO NOTHING" not in INS, "the INSERT still says DO NOTHING")
check("C2", "reactivation resets the fields that make a row leasable again - status, next_at and "
            "attempts together, because a `done` row with a stale next_at is still not work",
      all(x in INS for x in ("status = 'queued'", "next_at = now()", "attempts = 0", "last_error = NULL")))
check("C3", "SABOTAGE ONLY a `done` row is reactivated - reviving a `blocked` or `skipped` row would "
            "override a DELIBERATE stop (the operator parking 888 unreachable URLs, or the host "
            "guard refusing a foreign lane) on every single cycle",
      "WHERE fetch_queue.status = 'done'" in INS, "the DO UPDATE has no status guard")
check("C4", "SABOTAGE a `leased` row is NOT reset - a worker owns it, and zeroing next_at and "
            "attempts under it throws away its back-off state",
      "WHERE fetch_queue.status = 'done'" in INS and "'leased'" not in INS.split("WHERE fetch_queue.status")[1][:80])
check("C5", "the INSERT distinguishes INSERTED from REACTIVATED - '0 inserted' read identically to "
            "'nothing needed doing', which is the same defect as a gate reporting `sampled` while "
            "carrying `checked`",
      "(xmax = 0) AS inserted" in INS, "no xmax discriminator")
check("C6", "SABOTAGE the three outcomes are reported SEPARATELY, so a dropped repair cannot hide "
            "inside one number",
      all(k in SRC for k in ('out["reactivated"]', 'out["left_alone"]', 'out["inserted"]')))
check("C7", "SABOTAGE the human-readable render prints them - a counter nothing displays is a "
            "counter nobody reads, and the OLD conflated field is gone rather than renamed in place",
      "reactivated {p.get('reactivated', 0):,}" in SRC and "p.get('already_queued'" not in SRC,
      "the render still reads the conflated already_queued field")

# ---- rediscovery has to actually RE-FETCH -----------------------------------------------------
# The listing ladder is the only route to a URL we do not already hold: 97% of Cisco's coverage hole
# is a crawl gap, and `gaps` cannot express document-shaped work. Re-queuing a listing reset
# status/next_at/attempts and nothing else, so the worker served it FROM CACHE, re-parsed identical
# bytes and produced identical URLs. Measured 6 Sep 2026 - a whole cycle of
# `browser={'fetches': 0, 'cache_hits': 60}` with `new_tasks=0` on every listing, while no new
# document had entered the store since 4 Sep. The mechanism ran, reported success, and could not do
# the one thing it exists for.
RD = SRC.split('out["rediscover"]:')[1][:700]
check("D1", "re-queuing a listing FORCES a fresh fetch - without this, rediscovery re-reads the "
            "cached page and discovers exactly what it discovered last time",
      '"force": true' in RD, "the rediscover UPDATE does not set result.force")
check("D2", "the flag is the one worker.py already reads, not a new one invented here",
      'force=bool((task.get("result") or {}).get("force"))'
      in (ROOT / "scraper" / "worker.py").read_text(encoding="utf-8"))
check("D3", "SABOTAGE force is MERGED into the existing result rather than replacing it - a listing "
            "carrying other state must not lose it to a re-queue",
      "coalesce(result, '{}'::jsonb) ||" in RD, RD[:120])
check("D4", "the re-queue still resets what makes a row leasable, so forcing did not replace the "
            "rest of the job", all(x in RD for x in ("status = 'queued'", "next_at = now()", "attempts = 0")))

# ---- recovery must not chase documents the vendor has DELETED ---------------------------------
# Recovery re-queues a document because its bytes are missing from disk. A 404 says they are missing
# from the internet too, so the fetch cannot restore them and the row is still byte-less next cycle:
# a loop. `DO NOTHING` used to stop it by accident (it dropped the repair, which is the bug fixed
# above); DO UPDATE removes that accident, so the exclusion has to be explicit.
#
# Measured 6 Sep 2026 on cisco-eol: 8 fetches, 0 http200, every one a 404 on a transceiver-module
# bulletin we once held - and Cisco's 404 is a full branded page, so each cost 659-1,269 KB of
# RESIDENTIAL bandwidth. ~8 MB a cycle to re-learn the same thing against a 300 MB daily budget.
# the WHOLE function, not a fixed slice: its docstring is long enough that a character count
# stopped short of the SQL and the cases failed for that reason instead of the real one.
REC = SRC.split("def documents_missing_bytes")[1].split("\ndef ")[0]
check("R1", "the recover query EXCLUDES documents whose URL has recently 404ed - a fetch cannot "
            "restore bytes the vendor has deleted, so re-queuing them is a loop",
      "f.http_status = 404" in REC, "documents_missing_bytes does not exclude 404s")
check("R2", "the exclusion is time-bounded rather than permanent - a URL can come back, and "
            "retiring a document for good is a decision this planner has no business taking",
      "interval '30 days'" in REC, REC[:100])
check("R3", "SABOTAGE it is scoped to the DOCUMENT'S OWN url, not to the host or the source - one "
            "dead bulletin must not stop recovery of every other page on cisco.com",
      "f.url = sd.url" in REC, "the 404 exclusion is not scoped to the url")
check("R4", "SABOTAGE only 404 excludes. A 403 or a 5xx is a refusal or an outage, not a deletion, "
            "and must stay recoverable",
      "http_status = 404" in REC and "403" not in REC.split("f.http_status")[1][:120])

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
