// src/store/facts.ts — the database effect of a merge decision. The DECISION is made by the pure
// engine in src/core/specMerge.ts (mergeField); this module only performs what it returns, so
// the sabotage suite can drive the rules without a database and this file stays about SQL.
//
// The rules this module enforces (docs/ARCHITECTURE.md 2, 3, 4):
//   * facts is APPEND-ONLY. A value is never UPDATEd in place; a new value is a new row and the
//     old one gets superseded_by/superseded_at. The only in-place UPDATEs here change `state`
//     (verified -> corroborated, verified -> conflict) and `superseded_*` — never `value`.
//   * an unknown field_key cannot be stored: the FK to field_dictionary fails, and we rethrow
//     naming the key so the pipeline log says which vocabulary is missing, not "23503".
//   * exactly one current row per (part, field): facts_current_uq. Superseding is done in three
//     statements (old row parked with a self-reference, new row inserted, old row re-pointed at
//     the new id with superseded_at = the new row's created_at) so the index holds at every step
//     and invariant 6 (superseded_at >= created_at of the newer row) holds by construction.
//     Callers MUST wrap applyMerge/supersedeFact in withTx; a crash between the statements would
//     otherwise leave a self-superseded orphan.
//
// revision_label: specMerge distinguishes "same document, newer revision" from a conflict by the
// document's revision label, and the facts table has no column for it. It is persisted as a
// `|rev=<label>` suffix on `locator` — defensible because a locator is "enough to re-find the
// cell", and in a document with revisions that includes which revision. packLocator/unpackLocator
// are the only two places that know this; a migration adding facts.revision_label would replace
// them and nothing else.
import { mergeField, type MergeAction, type Prov, type SpecEntry, type FieldState } from "../core/specMerge.js";
import type { Queryable } from "./runs.js";

export type FactRow = {
  id: number;
  part_id: number;
  field_key: string;
  value: unknown;
  unit: string | null;
  raw: string;
  state: FieldState;
  tier: number;
  method: string;
  doc_id: string | null;
  locator: string | null;
  extracted_at: string | null;
  norm_v: string | null;
  inherited: boolean;
  inherited_from: string | null;
  run_id: number | null;
  created_at: Date;
  superseded_by: number | null;
  superseded_at: Date | null;
};

const FACT_COLUMNS = `id, part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator,
  extracted_at::text AS extracted_at, norm_v, inherited, inherited_from, run_id, created_at, superseded_by, superseded_at`;

const GAP_STATES: ReadonlySet<FieldState> = new Set(["gap_confirmed", "gap_unattempted", "not_applicable"]);

export function packLocator(prov: Prov): string | null {
  const base = prov.locator ?? "";
  if (prov.revision_label) return `${base}|rev=${prov.revision_label}`;
  return prov.locator ?? null;
}

export function unpackLocator(locator: string | null): { locator?: string; revision_label?: string } {
  if (locator == null) return {};
  const i = locator.lastIndexOf("|rev=");
  if (i < 0) return { locator };
  const base = locator.slice(0, i);
  return { ...(base ? { locator: base } : {}), revision_label: locator.slice(i + 5) };
}

/** The SpecEntry a stored row corresponds to, so mergeField can compare it with an incoming one. */
export function rowToEntry(row: FactRow): SpecEntry {
  const loc = unpackLocator(row.locator);
  const prov: Prov = { tier: row.tier, method: row.method };
  if (row.doc_id) prov.doc_id = row.doc_id;
  if (loc.locator) prov.locator = loc.locator;
  if (loc.revision_label) prov.revision_label = loc.revision_label;
  if (row.extracted_at) prov.extracted_at = row.extracted_at;
  if (row.norm_v) prov.norm_v = row.norm_v;
  return {
    k: row.field_key, raw: row.raw, value: row.value ?? undefined, unit: row.unit ?? undefined,
    state: row.state, inherited: row.inherited, inherited_from: row.inherited_from ?? undefined, prov,
  };
}

/** pg would send a bare string as text (not JSON) and an array as a Postgres array; always JSON. */
function jsonParam(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

function rethrowNamingKey(e: unknown, key: string): never {
  const err = e as { code?: string; constraint?: string; detail?: string; message?: string };
  if (err && err.code === "23503" && /field_key/.test(`${err.constraint ?? ""} ${err.detail ?? ""}`)) {
    throw new Error(`unknown field_key "${key}": not in field_dictionary — add it there (type, unit, labels) before storing facts under it`);
  }
  throw e;
}

export async function currentFacts(partId: number, db: Queryable): Promise<Map<string, FactRow>> {
  const r = await db.query<FactRow>(`SELECT ${FACT_COLUMNS} FROM facts WHERE part_id = $1 AND superseded_by IS NULL`, [partId]);
  return new Map(r.rows.map((row) => [row.field_key, row]));
}

export async function currentFact(partId: number, fieldKey: string, db: Queryable): Promise<FactRow | null> {
  const r = await db.query<FactRow>(
    `SELECT ${FACT_COLUMNS} FROM facts WHERE part_id = $1 AND field_key = $2 AND superseded_by IS NULL`, [partId, fieldKey]);
  return r.rows[0] ?? null;
}

export async function factHistory(partId: number, fieldKey: string, db: Queryable): Promise<FactRow[]> {
  const r = await db.query<FactRow>(
    `SELECT ${FACT_COLUMNS} FROM facts WHERE part_id = $1 AND field_key = $2 ORDER BY created_at, id`, [partId, fieldKey]);
  return r.rows;
}

async function insertFactRow(client: Queryable, partId: number, e: SpecEntry, runId: number): Promise<{ id: number; created_at: Date }> {
  try {
    const r = await client.query<{ id: number; created_at: Date }>(
      `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator, extracted_at, norm_v,
                          inherited, inherited_from, run_id)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::fact_state, $7, $8, $9, $10, $11::date, $12, $13, $14, $15)
       RETURNING id, created_at`,
      [partId, e.k, jsonParam(e.value), e.unit ?? null, e.raw, e.state, e.prov.tier, e.prov.method, e.prov.doc_id ?? null,
        packLocator(e.prov), e.prov.extracted_at ?? null, e.prov.norm_v ?? null, e.inherited === true, e.inherited_from ?? null, runId],
    );
    return r.rows[0];
  } catch (err) {
    rethrowNamingKey(err, e.k);
  }
}

export async function insertEvidence(client: Queryable, factId: number, e: SpecEntry, runId: number): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO fact_evidence (fact_id, doc_id, locator, tier, method, raw, extracted_at, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING id`,
    [factId, e.prov.doc_id ?? null, e.prov.locator ?? null, e.prov.tier, e.prov.method, e.raw, e.prov.extracted_at ?? null, runId],
  );
  return r.rows[0].id;
}

/** A value row plus its first evidence row. Gap rows carry no evidence. */
export async function insertFact(client: Queryable, partId: number, e: SpecEntry, runId: number): Promise<number> {
  const { id } = await insertFactRow(client, partId, e, runId);
  if (!GAP_STATES.has(e.state)) await insertEvidence(client, id, e, runId);
  return id;
}

/**
 * Replace the current row `oldId` with `newEntry` without ever touching the old value. Returns
 * the new row's id. Must run inside a transaction (see the module comment).
 */
export async function supersedeFact(client: Queryable, oldId: number, newEntry: SpecEntry, runId: number): Promise<number> {
  const old = await client.query<{ part_id: number; field_key: string }>(
    "SELECT part_id, field_key FROM facts WHERE id = $1 AND superseded_by IS NULL", [oldId]);
  if (!old.rows[0]) throw new Error(`supersedeFact: fact ${oldId} is not a current row`);
  const { part_id, field_key } = old.rows[0];
  if (field_key !== newEntry.k) throw new Error(`supersedeFact: fact ${oldId} is ${field_key}, the replacement is ${newEntry.k}`);
  // park: the old row stops being current (self-reference keeps the FK and the unique index happy)
  await client.query("UPDATE facts SET superseded_by = id, superseded_at = now() WHERE id = $1", [oldId]);
  const { id: newId } = await insertFactRow(client, part_id, newEntry, runId);
  if (!GAP_STATES.has(newEntry.state)) await insertEvidence(client, newId, newEntry, runId);
  // superseded_at is copied from the new row INSIDE SQL: round-tripping a timestamptz through a
  // JS Date drops the microseconds and put superseded_at up to 999 µs BEFORE created_at, which
  // the invariant-6 query caught on the first run of the suite.
  await client.query(
    "UPDATE facts SET superseded_by = $2, superseded_at = (SELECT created_at FROM facts WHERE id = $2) WHERE id = $1",
    [oldId, newId]);
  return newId;
}

async function insertConflict(
  client: Queryable, partId: number, c: { k: string; kept: unknown; rejected: unknown; reason: string; kept_prov: Prov; rejected_prov: Prov },
  runId: number, resolved?: { resolution: string; resolved_by: string },
): Promise<number> {
  try {
    const r = await client.query<{ id: number }>(
      `INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id, resolved_at, resolution, resolved_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, ${resolved ? "now()" : "NULL"}, $9, $10) RETURNING id`,
      [partId, c.k, jsonParam(c.kept), jsonParam(c.rejected), c.reason, JSON.stringify(c.kept_prov), JSON.stringify(c.rejected_prov), runId,
        resolved?.resolution ?? null, resolved?.resolved_by ?? null],
    );
    return r.rows[0].id;
  } catch (err) {
    rethrowNamingKey(err, c.k);
  }
}

export type ApplyResult = {
  action: MergeAction;
  /** the row that is current for this field after the call (undefined for protected/skip when nothing changed it) */
  factId?: number;
  conflictId?: number;
  supersededId?: number;
};

/**
 * Merge `incoming` into the part's current fact for the same field and perform the effect:
 *   insert           no current row (or only a gap row): INSERT facts + fact_evidence; a gap row is superseded
 *   corroborate      an independent trusted source agrees: add its evidence row, state -> corroborated.
 *                    The VALUE is unchanged, so this in-place UPDATE of `state` is not an overwrite.
 *   conflict         sources disagree: state -> conflict in place (the field is held), and a conflicts
 *                    row records kept, rejected, reason and both provenances. Resolution is a
 *                    human's job; nothing here picks a side by write order.
 *   protected        the current value is tier 0: untouched; a conflicts row records the disagreement.
 *   revision_change  same document, newer revision: the new value is a NEW row, the old is superseded.
 *                    Logged as an already-resolved conflicts row so /conflicts stays a list of open ones.
 *   skip_lower_tier  nothing to do.
 */
export async function applyMerge(client: Queryable, partId: number, incoming: SpecEntry, runId: number): Promise<ApplyResult> {
  const cur = await client.query<FactRow & { sku: string }>(
    `SELECT p.sku, f.id, f.part_id, f.field_key, f.value, f.unit, f.raw, f.state, f.tier, f.method, f.doc_id, f.locator,
            f.extracted_at::text AS extracted_at, f.norm_v, f.inherited, f.inherited_from, f.run_id, f.created_at, f.superseded_by, f.superseded_at
       FROM parts p
       LEFT JOIN facts f ON f.part_id = p.id AND f.field_key = $2 AND f.superseded_by IS NULL
      WHERE p.id = $1`,
    [partId, incoming.k],
  );
  if (!cur.rows[0]) throw new Error(`applyMerge: part ${partId} does not exist`);
  const row = cur.rows[0];
  const existing: FactRow | null = row.id == null ? null : row;

  // a gap row records that nobody found a value; a real value replaces it, it does not "conflict" with it
  if (!existing || GAP_STATES.has(existing.state)) {
    if (existing) {
      const newId = await supersedeFact(client, existing.id, incoming, runId);
      return { action: "insert", factId: newId, supersededId: existing.id };
    }
    const id = await insertFact(client, partId, incoming, runId);
    return { action: "insert", factId: id };
  }

  const result = mergeField(row.sku, rowToEntry(existing), incoming);
  switch (result.action) {
    case "insert": {
      const id = await insertFact(client, partId, result.entry, runId);
      return { action: "insert", factId: id };
    }
    case "corroborate": {
      // mergeField only sees the current row's own doc_id, not the evidence already attached to
      // it, so a corroborating document applied twice would come back as "corroborate" twice and
      // duplicate its evidence row. The store owns the evidence list, so it makes the re-run idempotent.
      const dup = await client.query(
        "SELECT 1 FROM fact_evidence WHERE fact_id = $1 AND doc_id IS NOT DISTINCT FROM $2 LIMIT 1", [existing.id, incoming.prov.doc_id ?? null]);
      if (dup.rowCount) return { action: "skip_lower_tier", factId: existing.id };
      await insertEvidence(client, existing.id, incoming, runId);
      await client.query("UPDATE facts SET state = 'corroborated' WHERE id = $1", [existing.id]);
      return { action: "corroborate", factId: existing.id };
    }
    case "conflict": {
      await client.query("UPDATE facts SET state = 'conflict' WHERE id = $1", [existing.id]);
      const conflictId = await insertConflict(client, partId, result.conflict!, runId);
      return { action: "conflict", factId: existing.id, conflictId };
    }
    case "protected": {
      const conflictId = await insertConflict(client, partId, result.conflict!, runId);
      return { action: "protected", factId: existing.id, conflictId };
    }
    case "revision_change": {
      const newId = await supersedeFact(client, existing.id, result.entry, runId);
      const conflictId = await insertConflict(client, partId, result.conflict!, runId, { resolution: "revision_change", resolved_by: "merge" });
      return { action: "revision_change", factId: newId, supersededId: existing.id, conflictId };
    }
    case "skip_lower_tier":
      return { action: "skip_lower_tier", factId: existing.id };
  }
}

export type RunRollback = { facts_removed: number; facts_restored: number; evidence_removed: number; conflicts_removed: number; states_recomputed: number };

/**
 * Undo everything a run wrote to the fact graph. Called by `withRun` when a run closes `failed`
 * (src/store/runs.ts), inside ONE transaction.
 *
 * An `apply-*` command writes in one transaction per part, so a throw part-way through used to
 * leave the parts already merged COMMITTED under a run that is then closed `failed`. The read side
 * hid them behind `factRunSucceeded()`, but the aggregate readers (stats, facets, gaps, compare,
 * changes, export) did not take that predicate — so a failed run could move a total without moving
 * a page, and the operator lever was to delete the rows by hand, as was done for run #15. Hiding is
 * not the invariant we want. The invariant is: **no current fact belongs to a run that is not
 * succeeded**, and it is held by removing the rows rather than by every reader remembering to skip
 * them.
 *
 * What is undone, in order (the order matters — the unique index on (part_id, field_key) WHERE
 * superseded_by IS NULL must hold at every step):
 *
 *   1. rows this run SUPERSEDED are un-parked (superseded_by/superseded_at back to NULL). Only
 *      rows that are NOT this run's: a fact of this run superseded by a later fact of the same run
 *      is deleted outright, so restoring it would put two current rows on one (part, field).
 *   2. this run's `conflicts` rows and every `fact_evidence` row it wrote go.
 *   3. this run's `facts` rows go, with any evidence a LATER run attached to them.
 *   4. the STATE of facts this run only touched in place is recomputed. `applyMerge` sets
 *      `state = 'conflict'` and `state = 'corroborated'` on rows belonging to OTHER runs; leaving a
 *      `conflict` state behind after deleting the conflicts row breaks invariant 5 ("no part has a
 *      conflict-state fact without an open conflicts row"), and leaving `corroborated` behind after
 *      deleting the second document's evidence claims corroboration from one source. Recomputed
 *      from what SURVIVES: an open conflicts row -> conflict, evidence from two documents ->
 *      corroborated, otherwise verified. Only rows currently in those two states are touched; a
 *      gap, `unverified` or `not_applicable` row is none of this function's business.
 *
 * `source_docs` and `doc_parts` are deliberately left: they record what was READ, they are
 * idempotent upserts, and no fact depends on the run that wrote them.
 */
export async function rollbackRun(client: Queryable, runId: number): Promise<RunRollback> {
  // the facts whose state this run changed in place — captured BEFORE the deletes remove the trail
  const touched = await client.query<{ id: number }>(
    `SELECT DISTINCT f.id
       FROM facts f
      WHERE f.superseded_by IS NULL AND f.state IN ('conflict', 'corroborated')
        AND (f.run_id IS DISTINCT FROM $1)
        AND (EXISTS (SELECT 1 FROM fact_evidence e WHERE e.fact_id = f.id AND e.run_id = $1)
          OR EXISTS (SELECT 1 FROM conflicts c WHERE c.run_id = $1 AND c.part_id = f.part_id AND c.field_key = f.field_key))`,
    [runId]);

  // PARK first, restore last. Clearing superseded_by while this run's replacement row is still
  // current puts TWO current rows on one (part, field) and facts_current_uq refuses the whole
  // transaction — which is how the first version of this function turned a failed run into a
  // failed rollback. The self-reference keeps the FK satisfied and keeps the row out of the
  // partial index until its superseder is gone (the same three-step dance as supersedeFact).
  const parked = await client.query<{ id: number }>(
    `UPDATE facts SET superseded_by = id, superseded_at = now()
      WHERE run_id IS DISTINCT FROM $1
        AND superseded_by IN (SELECT id FROM facts WHERE run_id = $1)
      RETURNING id`, [runId]);
  const conflicts = await client.query("DELETE FROM conflicts WHERE run_id = $1", [runId]);
  const evidence = await client.query(
    "DELETE FROM fact_evidence WHERE run_id = $1 OR fact_id IN (SELECT id FROM facts WHERE run_id = $1)", [runId]);
  const facts = await client.query("DELETE FROM facts WHERE run_id = $1", [runId]);
  const restored = parked.rowCount
    ? await client.query("UPDATE facts SET superseded_by = NULL, superseded_at = NULL WHERE id = ANY($1::bigint[])",
        [parked.rows.map((r) => r.id)])
    : { rowCount: 0 };

  let states = 0;
  for (const { id } of touched.rows) {
    const r = await client.query(
      `UPDATE facts f SET state = CASE
            WHEN EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) THEN 'conflict'::fact_state
            WHEN (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) > 1 THEN 'corroborated'::fact_state
            ELSE 'verified'::fact_state END
         WHERE f.id = $1 AND f.state IS DISTINCT FROM (CASE
            WHEN EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) THEN 'conflict'::fact_state
            WHEN (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) > 1 THEN 'corroborated'::fact_state
            ELSE 'verified'::fact_state END)`, [id]);
    states += r.rowCount ?? 0;
  }
  return {
    facts_removed: facts.rowCount ?? 0, facts_restored: restored.rowCount ?? 0,
    evidence_removed: evidence.rowCount ?? 0, conflicts_removed: conflicts.rowCount ?? 0,
    states_recomputed: states,
  };
}

/**
 * "We looked everywhere and it is not published": a NULL-value row in state gap_confirmed.
 * Supersedes a gap_unattempted row; a no-op on an existing gap_confirmed / not_applicable row;
 * REFUSES over a value or a held conflict, because a gap over a value would hide the value.
 */
export async function writeGapConfirmed(client: Queryable, partId: number, fieldKey: string, runId: number): Promise<ApplyResult> {
  const entry: SpecEntry = { k: fieldKey, raw: "", state: "gap_confirmed", prov: { tier: 2, method: "gap_check" } };
  const existing = await currentFact(partId, fieldKey, client);
  if (!existing) return { action: "insert", factId: await insertFact(client, partId, entry, runId) };
  if (existing.state === "gap_confirmed" || existing.state === "not_applicable") return { action: "skip_lower_tier", factId: existing.id };
  if (existing.state === "gap_unattempted") {
    const newId = await supersedeFact(client, existing.id, entry, runId);
    return { action: "insert", factId: newId, supersededId: existing.id };
  }
  throw new Error(`writeGapConfirmed: ${fieldKey} on part ${partId} currently holds a ${existing.state} row (fact ${existing.id}); a gap cannot be confirmed over it`);
}
