// tests/runStale.test.ts — proof for the reaper's per-run staleness budget (src/store/runs.ts).
//
//   npx tsx tests/runStale.test.ts
//
// WHY A BUDGET RATHER THAN A CLOCK. The reaper began with a flat six hours, set against the longest
// run anyone had measured. That was right for what it was set against and it is too blunt: at 21:20
// on 5 Sep 2026 run #104 had been `running` for TWO HOURS with `files: 1` and no process behind it,
// while run #117 legitimately spent 546 s on 494 files and Juniper's hand-drain 391 s on 25. One
// threshold cannot separate those. Set it low and it puts a false ending on a row still being
// written; set it high and an obviously-dead one-file run claims to be in flight all afternoon.
//
// The run row already carries the size of the work, so the expectation can be proportional to it.
// The cases below are the REAL runs from that evening, because a budget that is not checked against
// the runs it was derived from is a number somebody liked the look of.
//
// THE RATE IS THE WORST ONE OBSERVED, not the typical one: 15.6 s/file measured under two
// concurrent applies contending for one SSH tunnel, not the 4.6 s/file of an uncontended dry run.
// Being wrong in the fast direction ends a live run; being wrong in the slow direction only delays
// a cleanup.
import {
  staleBudgetSeconds, RUN_STALE_HOURS, RUN_STALE_FLOOR_MIN, WORST_SECONDS_PER_FILE, RUN_STALE_SLACK,
} from "../src/store/runs.js";

let pass = 0, miss = 0;
function check(id: string, what: string, ok: boolean, got: unknown = "") {
  if (ok) pass++; else miss++;
  console.log(`${ok ? "PASS" : "MISS"} | ${id.padEnd(5)} | ${what.slice(0, 84).padEnd(86)}${ok ? "" : ` | got ${String(got).slice(0, 120)}`}`);
}
const MIN = 60, HOUR = 3600;

// ---- the real runs of 5 Sep 2026 -------------------------------------------------------------
check("B1", "run #104 - ONE file, silent for two hours, process gone - is inside the floor, so it "
          + "is reaped in 30 minutes instead of sitting six hours claiming to be in flight",
  staleBudgetSeconds(1) === RUN_STALE_FLOOR_MIN * MIN, staleBudgetSeconds(1));
check("B2", "SABOTAGE Juniper's 25-file hand-drain took 391 s and must NOT be reaped - the floor "
          + "covers it with room, because a small run during a tunnel stall is not a dead run",
  staleBudgetSeconds(25) > 391, `${staleBudgetSeconds(25)}s vs 391s`);
check("B3", "SABOTAGE run #117 declared 494 files and ran 546 s legitimately - nowhere near reaped",
  staleBudgetSeconds(494) > 546);
check("B4", "a 60-file chunk (the shipped APPLY_CHUNK_FILES) gets a budget past its 1800 s step "
          + "bound, so a chunk that runs to its own timeout is not ALSO called abandoned",
  staleBudgetSeconds(60) > 1800, `${staleBudgetSeconds(60)}s`);

// ---- the shape of the rule --------------------------------------------------------------------
check("B5", "the budget rises with the declared work - that is the entire point",
  staleBudgetSeconds(500) > staleBudgetSeconds(100) && staleBudgetSeconds(100) > staleBudgetSeconds(60));
check("B6", `SABOTAGE nothing waits longer than the ${RUN_STALE_HOURS}h ceiling, however much it `
          + "declared - the old flat behaviour survives as the outer bound",
  staleBudgetSeconds(1_000_000) === RUN_STALE_HOURS * HOUR, staleBudgetSeconds(1_000_000));
check("B7", `SABOTAGE nothing is reaped sooner than the ${RUN_STALE_FLOOR_MIN}min floor - at `
          + `${WORST_SECONDS_PER_FILE}s/file a single file would otherwise get a 47-second budget, `
          + "and this tunnel drops sockets for longer than that",
  staleBudgetSeconds(1) === RUN_STALE_FLOOR_MIN * MIN && staleBudgetSeconds(2) === RUN_STALE_FLOOR_MIN * MIN);
check("B8", "SABOTAGE an UNKNOWN size falls back to the ceiling, not to the floor - not knowing how "
          + "big a run is must never be an excuse to guess that it is small",
  staleBudgetSeconds(null) === RUN_STALE_HOURS * HOUR
  && staleBudgetSeconds(undefined) === RUN_STALE_HOURS * HOUR
  && staleBudgetSeconds(0) === RUN_STALE_HOURS * HOUR
  && staleBudgetSeconds(NaN) === RUN_STALE_HOURS * HOUR
  && staleBudgetSeconds(-5) === RUN_STALE_HOURS * HOUR,
  [null, undefined, 0, NaN, -5].map((v) => staleBudgetSeconds(v as number)).join(","));
check("B9", "the rate used is the WORST measured under contention, not the uncontended one - being "
          + "wrong in the fast direction ends a live run",
  WORST_SECONDS_PER_FILE >= 15 && RUN_STALE_SLACK >= 2,
  `${WORST_SECONDS_PER_FILE}s/file x${RUN_STALE_SLACK}`);
check("B10", "SABOTAGE the budget is well clear of the observed rate, not merely above it: a run of "
           + "N files gets at least 3x what N files actually cost at the worst measured rate",
  [10, 60, 153].every((n) => staleBudgetSeconds(n) >= n * WORST_SECONDS_PER_FILE * 2.9),
  [10, 60, 153].map((n) => `${n}:${staleBudgetSeconds(n)}`).join(" "));

console.log(`\n${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);
