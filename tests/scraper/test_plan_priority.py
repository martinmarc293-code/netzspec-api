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
check("Q2", "document and listing work with no part behind it drains after that",
      PLAN.queue_priority(DOC) == 80, PLAN.queue_priority(DOC))
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

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
