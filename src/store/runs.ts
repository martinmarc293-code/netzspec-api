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

export async function openRun(
  kind: string,
  opts: { inputs: Record<string, unknown>; gitSha?: string; notes?: string },
  db: Queryable = getPool(),
): Promise<number> {
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
    try {
      const p = opts.partial?.();
      if (p?.stats) stats = p.stats;
      if (p?.progress) notes = `progress=${p.progress}; ${msg}`;
    } catch { /* a broken partial() must not replace the real error */ }
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
