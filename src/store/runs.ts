// src/store/runs.ts — every write happens inside a run, and a run that writes facts carries a
// passing gate. This module is where those two hard rules (CLAUDE.md) become mechanical.
//
//   openRun   creates the `runs` row first, so a crash mid-way leaves a `running` row that
//             names its inputs (with sha256), not a pile of facts nobody can trace to a file.
//   closeRun  REFUSES to close a run whose kind starts with "apply-" as `succeeded` unless it
//             carries {precision, recall, passed: true}. The old pipeline reported "All checks
//             passed" from suites that tested nothing; here a missing gate is an error at the one
//             place every apply-* command must pass through.
//   withRun   the shape every pipeline command should take: open, do, close — and on a throw the
//             run is closed `failed` with the reason, so no run is left `running` forever.
//   hashFile  inputs are recorded as {path, sha256, bytes}: enough to reproduce or to prove which
//             file a fact came from.
import crypto from "node:crypto";
import fs from "node:fs";
import type pg from "pg";
import { getPool, withTx } from "./db.js";
import { rollbackRun } from "./facts.js";

/** A pool or a client inside a transaction: anything with pg's `query`. */
export type Queryable = pg.Pool | pg.PoolClient;

export type RunStatus = "running" | "succeeded" | "failed" | "aborted";

export type RunGate = {
  precision: number;   // 0..1 against the golden samples
  recall: number;      // 0..1: every golden fact present
  passed: boolean;
  [extra: string]: unknown;
};

export type RunInputFile = { path: string; sha256: string; bytes: number };

export type RunStats = Record<string, unknown>;

/** Runs of this kind insert facts and must therefore carry a passing gate to succeed. */
export function requiresGate(kind: string): boolean {
  return kind.startsWith("apply-");
}

/** Why a gate object is not a well-formed gate, or null when it is. Shape only — not whether it passed. */
export function gateShapeProblem(gate: unknown): string | null {
  if (!gate || typeof gate !== "object") return "gate is not an object";
  const g = gate as Record<string, unknown>;
  if (typeof g.precision !== "number") return "precision is missing or not a number";
  if (typeof g.recall !== "number") return "recall is missing or not a number";
  if (typeof g.passed !== "boolean") return "passed is missing or not a boolean";
  return null;
}

export function isPassingGate(gate: unknown): gate is RunGate {
  return gateShapeProblem(gate) === null && (gate as RunGate).passed === true;
}

export function hashFile(filePath: string): RunInputFile {
  const buf = fs.readFileSync(filePath);
  return { path: filePath.replace(/\\/g, "/"), sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

/**
 * How long a run may stay `running` before it is treated as abandoned.
 *
 * Set against the longest run actually observed, not a round number: the Juniper session measured
 * an apply of 224 relation-heavy documents at 35+ minutes over the SSH tunnel, and a Cisco apply of
 * 22 documents at 52 seconds. Six hours is an order of magnitude above the worst of those, so a
 * legitimately slow run is never reaped — which matters, because reaping a LIVE run would put a
 * false ending on a row whose process is still writing.
 */
export const RUN_STALE_HOURS = 6;

/**
 * A stale run is judged against THE WORK IT DECLARED, not a flat clock.
 *
 * The flat six hours was right for what it was set against, and it is too blunt. Measured 5 Sep
 * 2026 at 21:20: run #104 had been `running` for TWO HOURS with `files: 1`, its process long gone —
 * and a one-file apply is a minute of work. Meanwhile run #117 legitimately spent 546 s on 494
 * files and Juniper's hand-drain took 391 s over 25. A single threshold cannot separate those: set
 * it low and it reaps a real 494-file run mid-write, set it high and an obviously-dead one-file run
 * sits for six hours claiming to be in flight.
 *
 * The run row already carries the answer. `inputs.files` is the size of the work, written when the
 * run opened, so the expectation can be proportional to it:
 *
 *   budget = files x WORST_SECONDS_PER_FILE x SLACK, clamped to [FLOOR, RUN_STALE_HOURS]
 *
 * WORST_SECONDS_PER_FILE is 15.6 — the slowest rate anyone measured tonight, under two concurrent
 * applies contending for one tunnel, NOT the 4.6 s/file of an uncontended dry run. Using the worst
 * observed rate rather than the typical one is the whole point: the cost of being wrong here is
 * putting a false ending on a row whose process is still writing.
 *
 * The FLOOR exists because a small run during a tunnel stall is not a dead run — at 15.6 s/file a
 * single file would otherwise get a 47-second budget, and this tunnel drops sockets for longer than
 * that. The CEILING keeps the old behaviour as the outer bound: nothing waits longer than six hours
 * however much it declared.
 *
 * A run with no `files` in its inputs falls back to RUN_STALE_HOURS, unchanged — an unknown size is
 * not an excuse to guess a small one.
 */
export const WORST_SECONDS_PER_FILE = 15.6;
export const RUN_STALE_SLACK = 3;
export const RUN_STALE_FLOOR_MIN = 30;

/** Seconds a run of this declared size may stay `running` before it is treated as abandoned. */
export function staleBudgetSeconds(files: number | null | undefined): number {
  const ceiling = RUN_STALE_HOURS * 3600;
  if (!files || !Number.isFinite(files) || files <= 0) return ceiling;
  const budget = files * WORST_SECONDS_PER_FILE * RUN_STALE_SLACK;
  return Math.min(ceiling, Math.max(RUN_STALE_FLOOR_MIN * 60, budget));
}

/**
 * Close out runs that never finished, so "is one in flight?" stops being a lie.
 *
 * WHY. A run row is opened before the work and closed after it. Nothing closes it when the process
 * is killed, crashes, or is stopped from another session — and on 5 Sep 2026 the table held rows
 * that had been `running` for 36 HOURS. Any check keying on "an apply is in flight" was being
 * answered by a process that had not existed since the day before, and it gets worse every time a
 * run is interrupted, which under three concurrent sessions is often.
 *
 * `aborted`, NOT `failed`, and the distinction is the whole point. `failed` claims the work was
 * attempted and did not succeed. What is actually known here is only that the row was never closed:
 * the process may have been killed, may have crashed, may have written everything it meant to and
 * died on the last line. The runs table has no pid and no host, so liveness cannot be tested —
 * silence is the only evidence there is, and `aborted` with a note saying so is the honest reading
 * of it. Anything more specific would be inventing a cause.
 *
 * NO BACKTICKS IN THE SQL BELOW. It is a JS template literal, so a backtick around a
 * word ENDS the query mid-string and the error surfaces as a TS1005 twenty lines away.
 * Third time in one day across this codebase - see src/api/queries/vendors.ts and the
 * hook that executed the `git commit` in its own error message.
 *
 * Deliberately NOT touching the gate or stats: whatever the run recorded before it stopped is
 * evidence, and a reaper that blanked it would destroy the only trace of what happened.
 */
export async function reapStaleRuns(
  db: Queryable = getPool(),
  hours: number = RUN_STALE_HOURS,
): Promise<{ reaped: number; ids: number[] }> {
  // The budget is computed per row from the size the run DECLARED, so a one-file run that has been
  // silent for two hours is reaped while a 494-file run still writing is not. The arithmetic is
  // staleBudgetSeconds() above, expressed here in SQL so it is one statement rather than a read,
  // a loop and N writes over a 333 ms round trip.
  const r = await db.query<{ id: number; age: number; budget: number }>(
    `WITH judged AS (
       SELECT id,
              extract(epoch FROM (now() - started_at)) AS age,
              LEAST($1::float * 3600,
                    GREATEST($2::float * 60,
                             COALESCE(NULLIF((inputs->>'files'), '')::float, 1e9)
                             * $3::float * $4::float)) AS budget
         FROM runs WHERE status = 'running'
     )
     UPDATE runs r
        SET status = 'aborted',
            finished_at = now(),
            notes = COALESCE(r.notes || ' | ', '') ||
                    'reaped: still running after ' || round(j.age)::text || 's, past the ' ||
                    round(j.budget)::text || 's budget for the ' ||
                    COALESCE(r.inputs->>'files', 'unknown number of') || ' file(s) it declared. ' ||
                    'The process was never observed - only its silence - so this says the row was ' ||
                    'not closed, NOT that the work failed.'
       FROM judged j
      WHERE r.id = j.id AND j.age > j.budget
      RETURNING r.id, j.age, j.budget`,
    [hours, RUN_STALE_FLOOR_MIN, WORST_SECONDS_PER_FILE, RUN_STALE_SLACK],
  );
  return { reaped: r.rowCount ?? 0, ids: r.rows.map((x) => x.id) };
}

export async function openRun(
  kind: string,
  opts: { inputs: Record<string, unknown>; gitSha?: string; notes?: string },
  db: Queryable = getPool(),
): Promise<number> {
  // Self-healing at the one moment that is always reached and costs nothing extra: a run is about
  // to be opened, so the table is about to be read by somebody. One UPDATE against an indexed
  // status, and the stale rows are closed out before the new row joins them. Putting it here rather
  // than in a command nobody remembers to run is the difference between a reaper and a good idea.
  try {
    await reapStaleRuns(db);
  } catch {
    // A reaper that cannot run must never stop the work it was tidying up after.
  }
  const r = await db.query<{ id: number }>(
    "INSERT INTO runs (kind, inputs, git_sha, notes) VALUES ($1, $2::jsonb, $3, $4) RETURNING id",
    [kind, JSON.stringify(opts.inputs ?? {}), opts.gitSha ?? null, opts.notes ?? null],
  );
  return r.rows[0].id;
}

/**
 * Close a run. Throws — and leaves the row untouched — when an apply-* run is being closed as
 * `succeeded` without a passing gate, or when any run is closed as `succeeded` with a gate that
 * did not pass. A failed or aborted run may carry any gate or none: the point of the rule is
 * that facts written under this run id are never presented as gated when they were not.
 */
export async function closeRun(
  id: number,
  status: Exclude<RunStatus, "running">,
  stats: RunStats,
  gate?: RunGate | null,
  opts: { notes?: string; db?: Queryable } = {},
): Promise<void> {
  const db = opts.db ?? getPool();
  const cur = await db.query<{ kind: string; status: RunStatus }>("SELECT kind, status FROM runs WHERE id = $1", [id]);
  if (cur.rowCount === 0) throw new Error(`closeRun: run ${id} does not exist`);
  const { kind } = cur.rows[0];
  if (status === "succeeded") {
    const shape = gate == null ? null : gateShapeProblem(gate);
    if (shape) {
      throw new Error(`closeRun: run ${id} (${kind}) has a malformed gate (${shape}): ${JSON.stringify(gate)}`);
    }
    if (gate != null && !isPassingGate(gate)) {
      throw new Error(`closeRun: run ${id} (${kind}) cannot succeed with a gate that did not pass: ${JSON.stringify(gate)}`);
    }
    if (requiresGate(kind) && !isPassingGate(gate)) {
      throw new Error(`closeRun: run ${id} (${kind}) writes facts and cannot be closed as succeeded without a passing gate {precision, recall, passed: true}`);
    }
  }
  await db.query(
    `UPDATE runs SET status = $2::run_status, finished_at = now(), stats = $3::jsonb, gate = $4::jsonb,
            notes = COALESCE($5, notes)
      WHERE id = $1`,
    [id, status, JSON.stringify(stats ?? {}), gate == null ? null : JSON.stringify(gate), opts.notes ?? null],
  );
}

export type RunOutcome = { stats: RunStats; gate?: RunGate; notes?: string };

/**
 * Open a run, hand its id to `fn`, close it from what `fn` returns. Any throw — including the
 * gate refusal inside closeRun — closes the run as `failed` with the message in `notes` and is
 * rethrown, so the caller sees the failure and the table never holds a phantom `running` row.
 *
 * `opts.partial` is what the failure path had been missing. A command that writes in more than
 * one transaction has already committed something when it throws, and closing that run with
 * `stats {}` and one error line said nothing about how far it got — the counters were sitting in
 * the caller's memory and were thrown away. `partial()` is called ONLY on the failure path and
 * returns the caller's stats so far plus a `progress` line (parts done of total, the last one
 * touched) that is appended to `notes`. It must not throw and must not query: it runs while an
 * error is already in flight, so a second failure there would hide the first.
 *
 * **A FAILED RUN LEAVES NOTHING BEHIND.** Before the run is closed `failed`, everything it wrote
 * to the fact graph is ROLLED BACK in one transaction (`rollbackRun`): its facts are deleted, the
 * rows they superseded are restored, its evidence and conflicts go, and the states it changed in
 * place are recomputed from what survives. The run ROW stays, with its partial stats and progress
 * line and a `rolled_back=` count in its notes — the record of the attempt is the point; the
 * half-written facts are not. The read side's `factRunSucceeded()` predicate stays as
 * belt-and-braces, but the invariant no longer depends on every reader remembering it
 * (docs/DATA_MODEL.md § Facts of a run that did not succeed).
 *
 * A rollback that itself fails must not hide the error that caused it: it is reported in `notes`
 * and the ORIGINAL error is the one rethrown.
 */
export async function withRun<T extends RunOutcome>(
  kind: string,
  inputs: Record<string, unknown>,
  fn: (runId: number) => Promise<T>,
  opts: { gitSha?: string; db?: Queryable; partial?: () => { stats?: RunStats; progress?: string } } = {},
): Promise<T & { runId: number }> {
  const db = opts.db ?? getPool();
  const runId = await openRun(kind, { inputs, gitSha: opts.gitSha }, db);
  let out: T;
  try {
    out = await fn(runId);
    await closeRun(runId, "succeeded", out.stats, out.gate ?? null, { notes: out.notes, db });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let stats: RunStats = {};
    let notes = msg;
    let progress: string | undefined;
    try {
      const p = opts.partial?.();
      if (p?.stats) stats = p.stats;
      if (p?.progress) { progress = p.progress; notes = `progress=${p.progress}; ${msg}`; }
    } catch { /* a broken partial() must not replace the real error */ }
    // THE CAUSE, AS A STRUCTURED FIELD AND NOT ONLY AS PROSE.
    //
    // It was already in `notes` — run #111 reads "rolled_back=0 facts (...); progress=2 of 478
    // files, 1 parts touched; canceling statement due to statement timeout" — so nothing was lost.
    // But it sat a hundred characters into a sentence, and `stats ? 'error'` answered false, so two
    // sessions independently looked at the same failed row, saw no cause in the structured fields,
    // and each invented a different one: one concluded the apply step was colliding with itself,
    // the other that the file backlog had outgrown statement_timeout. Both were wrong — the real
    // cause was a manual apply holding row locks — and neither could have been right from the row
    // as it read.
    //
    // Recorded, not deduced. This is the mirror of the reaper's rule: there, the cause is UNKNOWN
    // and naming one would be invention, so a reaped run says only that it was never closed. Here
    // the cause is known exactly, and burying it in prose is the same disservice from the other
    // direction — a reader who checks a field and finds nothing concludes nothing is there.
    stats = { ...stats, error: msg, error_type: e instanceof Error ? e.name : typeof e,
              ...(progress ? { progress } : {}) };
    try {
      const back = await withTx((client) => rollbackRun(client, runId));
      stats = { ...stats, rolled_back: back };
      notes = `rolled_back=${back.facts_removed} facts (${back.facts_restored} restored, ${back.evidence_removed} evidence, ${back.conflicts_removed} conflicts, ${back.states_recomputed} states); ${notes}`;
    } catch (re) {
      // "could not roll back" is not "nothing to roll back": say so loudly, in the run row.
      notes = `ROLLBACK_FAILED (${re instanceof Error ? re.message : String(re)}) — facts of this run may still be present; ${notes}`;
    }
    try {
      await closeRun(runId, "failed", stats, null, { notes, db });
    } catch { /* the original error is the one to report */ }
    throw e;
  }
  return { ...out, runId };
}

export async function getRun(id: number, db: Queryable = getPool()): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM runs WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}
