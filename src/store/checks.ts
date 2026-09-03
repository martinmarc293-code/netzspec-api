// src/store/checks.ts — every consultation of a source for a part, with its outcome.
//
// This is what turns "no value" into either "confirmed absent" or "nobody looked": the
// gap_ledger view counts these rows per (part, field) against the sources capable of the field.
// A check is upserted on (part, source, doc) — the unique index uses COALESCE(doc_id, '') so a
// check without a document is one row, not one per run — and a repeat overwrites the outcome
// with the newer consultation; the previous outcome is not history worth keeping, the newest
// consultation is what decides whether the gap is real.
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type CheckOutcome = "facts_found" | "no_facts" | "not_listed" | "fetch_failed" | "blocked";

export type SourceCheckInput = {
  doc_id?: string | null;
  fetch_id?: number | null;
  outcome: CheckOutcome;
  facts_found: number;
  fields_found: string[];
};

export type SourceCheckRow = SourceCheckInput & { id: number; part_id: number; source_id: number; checked_at: Date; run_id: number | null };

export async function recordSourceCheck(
  partId: number, sourceId: number, input: SourceCheckInput, runId: number, db: Queryable = getPool(),
): Promise<SourceCheckRow> {
  if (input.outcome === "facts_found" && input.facts_found <= 0) {
    throw new Error(`recordSourceCheck: outcome facts_found with facts_found=${input.facts_found} for part ${partId} source ${sourceId}`);
  }
  const r = await db.query<SourceCheckRow>(
    `INSERT INTO part_source_checks (part_id, source_id, doc_id, fetch_id, outcome, facts_found, fields_found, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
     ON CONFLICT (part_id, source_id, COALESCE(doc_id, '')) DO UPDATE SET
       fetch_id = COALESCE(EXCLUDED.fetch_id, part_source_checks.fetch_id), outcome = EXCLUDED.outcome,
       facts_found = EXCLUDED.facts_found, fields_found = EXCLUDED.fields_found, run_id = EXCLUDED.run_id, checked_at = now()
     RETURNING id, part_id, source_id, doc_id, fetch_id, outcome, facts_found, fields_found, checked_at, run_id`,
    [partId, sourceId, input.doc_id ?? null, input.fetch_id ?? null, input.outcome, input.facts_found, input.fields_found, runId],
  );
  return r.rows[0];
}

export async function sourceChecksFor(partId: number, db: Queryable = getPool()): Promise<SourceCheckRow[]> {
  const r = await db.query<SourceCheckRow>(
    "SELECT id, part_id, source_id, doc_id, fetch_id, outcome, facts_found, fields_found, checked_at, run_id FROM part_source_checks WHERE part_id = $1 ORDER BY source_id, doc_id",
    [partId]);
  return r.rows;
}
