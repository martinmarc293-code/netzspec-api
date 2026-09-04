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
import {
  mergeField, describesPart, notApplicable, tryTierFor,
  type MergeAction, type Prov, type SpecEntry, type FieldState,
} from "../core/specMerge.js";
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

/**
 * `facts_verified_needs_source`: CHECK (state NOT IN ('verified','corroborated') OR tier = 0 OR
 * doc_id IS NOT NULL). A rendered fact above tier 0 must name the document it was read from.
 *
 * Postgres enforces it on INSERT **and on UPDATE** — and the UPDATE is the one that bit. Run #20
 * (apply-specs over shard 0, 4 Sep 2026) died after 28 minutes on it, and the three facts it had
 * written all carried a doc_id, because the offending statement was not an insert at all: it was
 * `applyMerge`'s corroborate branch promoting an EXISTING row to `corroborated`. 1,125 current
 * rows sit at tier 2 with `doc_id IS NULL` and state `unverified` (migrated facts whose source
 * document was never recorded); `mergeField` sees an incoming tier-2 extraction that AGREES with
 * one, calls the two sources independent (undefined !== a real doc id) and both trusted, and
 * returns `corroborate` — whereupon the promotion breaks the check and the whole run dies for one
 * row. Nothing in the extract plan produces an entry with no doc_id (0 of 35,073 over shard 0);
 * the trap was entirely on the stored side.
 *
 * Returned as a NAMED reason rather than left to Postgres, so the caller can quarantine one entry
 * instead of losing the run to a `23514`.
 */
export function noSourceProblem(state: FieldState, tier: number, docId: string | null | undefined): string | null {
  if (state !== "verified" && state !== "corroborated") return null;
  if (tier === 0) return null;
  if (docId != null && String(docId).trim() !== "") return null;
  return `FACT_NO_DOCUMENT: a ${state} fact at tier ${tier} must name the document it was read from (facts_verified_needs_source); tier 0 is the only source-less tier`;
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
  // BEFORE any SQL: a refusal that has not touched the transaction can be caught and quarantined
  // by the caller. A 23514 from Postgres aborts the transaction and, in practice, the run.
  const problem = noSourceProblem(e.state, e.prov.tier, e.prov.doc_id);
  if (problem) throw new Error(`${problem} — field "${e.k}", raw ${JSON.stringify(String(e.raw).slice(0, 60))}`);
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

/**
 * `raws` is migration 0008 and it exists because of what `ingest remerge` could NOT do. A conflicts
 * row recorded both VALUES and both provenances but neither source STRING, so re-merging it under
 * a corrected rule could resolve an agreement (no value changes) and could retract an inheritance
 * (no value is written) but could never supersede or union — `facts.raw` is NOT NULL and inventing
 * it would break the one property the column exists for, that a normaliser bug is replayable from
 * `raw`. 7,185 of run #38's conflicts are exactly that case and had to be sent back through
 * apply-extract. Every conflict written from now on carries both strings so a later rule change can
 * be applied to it in place.
 */
async function insertConflict(
  client: Queryable, partId: number,
  c: { k: string; kept: unknown; rejected: unknown; reason: string; kept_prov: Prov; rejected_prov: Prov },
  runId: number, resolved?: { resolution: string; resolved_by: string },
  raws?: { kept_raw?: string | null; rejected_raw?: string | null },
): Promise<number> {
  try {
    const r = await client.query<{ id: number }>(
      `INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id, resolved_at, resolution, resolved_by, kept_raw, rejected_raw)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, ${resolved ? "now()" : "NULL"}, $9, $10, $11, $12) RETURNING id`,
      [partId, c.k, jsonParam(c.kept), jsonParam(c.rejected), c.reason, JSON.stringify(c.kept_prov), JSON.stringify(c.rejected_prov), runId,
        resolved?.resolution ?? null, resolved?.resolved_by ?? null, raws?.kept_raw ?? null, raws?.rejected_raw ?? null],
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
  /** set when the effect was REDUCED because performing it in full would break an invariant, with
   *  the reason. The evidence is still recorded; the state promotion is not. Counted, never silent. */
  withheld?: string;
  /** set when the entry was REFUSED outright, with the named rule that refused it */
  refused?: string;
  /** the merge rule that decided a non-conflict action (set_equal, same_doc_reextraction, …) */
  rule?: string;
};

/** What `describesPart` needs about the part, as the store reads it. */
type PartSubjectRow = { sku: string; product_class: string | null; category_slug: string | null; family: string | null };

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
 *   supersede        one document read again by a newer extractor/normaliser: the new value is a NEW
 *                    row, the old is superseded, and the conflicts row is written already resolved.
 *   list_union       an `ls` field the SAME document states twice: the union is a new row, no conflict.
 *   refused_inherit  a family-level value offered to a part the document only LISTS: refused, counted.
 *   agree_same_doc   the two agree and add no independent source: nothing to do.
 */
export async function applyMerge(client: Queryable, partId: number, incoming: SpecEntry, runId: number): Promise<ApplyResult> {
  const cur = await client.query<FactRow & PartSubjectRow>(
    `SELECT p.sku, p.product_class::text AS product_class, p.family, c.slug AS category_slug,
            f.id, f.part_id, f.field_key, f.value, f.unit, f.raw, f.state, f.tier, f.method, f.doc_id, f.locator,
            f.extracted_at::text AS extracted_at, f.norm_v, f.inherited, f.inherited_from, f.run_id, f.created_at, f.superseded_by, f.superseded_at
       FROM parts p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN facts f ON f.part_id = p.id AND f.field_key = $2 AND f.superseded_by IS NULL
      WHERE p.id = $1`,
    [partId, incoming.k],
  );
  if (!cur.rows[0]) throw new Error(`applyMerge: part ${partId} does not exist`);
  const row = cur.rows[0];
  const existing: FactRow | null = row.id == null ? null : row;

  // THE INHERITANCE GATE, and it lives here rather than in each pipeline on purpose. A family-level
  // fact may only reach a SKU the document DESCRIBES; being in the document's PID list is being
  // compatible with it (src/core/specMerge.ts § describesPart). apply-extract, apply-acquired and
  // remerge all pass through applyMerge, so one refusal covers all three and a new pipeline cannot
  // forget it. Refused BEFORE any SQL, so the caller can count and quarantine it like any other
  // refusal rather than losing a transaction.
  if (incoming.inherited === true) {
    const refusal = describesPart({
      sku: row.sku, productClass: row.product_class, categorySlug: row.category_slug,
      partFamily: row.family, docFamily: incoming.inherited_from ?? null,
    });
    if (refusal) return { action: "refused_inherit", refused: refusal.reason, rule: refusal.rule, factId: existing?.id };
  }

  // THE APPLICABILITY GATE, in the same place and for the same reason: a field the part cannot
  // have is refused however it arrived, inherited or read per-SKU, so no pipeline can write one
  // and no later remerge has to withdraw it. It fires only on a (category, field) pair an operator
  // has judged nonsensical — src/core/specMerge.ts § NONSENSICAL_PAIRS explains why the profile on
  // its own is not enough to justify deleting a value. Refused BEFORE any SQL, like the one above.
  const inapplicable = notApplicable({ sku: row.sku, categorySlug: row.category_slug, fieldKey: incoming.k });
  if (inapplicable) {
    return { action: "refused_not_applicable", refused: inapplicable.reason, rule: inapplicable.rule, factId: existing?.id };
  }

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
      if (dup.rowCount) return { action: "agree_same_doc", factId: existing.id, rule: result.rule };
      await insertEvidence(client, existing.id, incoming, runId);
      // The promotion is an UPDATE, and the CHECK fires on UPDATE. A stored row at tier > 0 with
      // no doc_id of its own cannot be called corroborated — the second source is real and is
      // recorded as evidence, but the row keeps the state it can justify. This is what killed
      // run #20 (see noSourceProblem).
      const withheld = noSourceProblem("corroborated", existing.tier, existing.doc_id);
      if (withheld) return { action: "corroborate", factId: existing.id, withheld, rule: result.rule };
      await client.query("UPDATE facts SET state = 'corroborated' WHERE id = $1", [existing.id]);
      return { action: "corroborate", factId: existing.id, rule: result.rule };
    }
    case "conflict": {
      await client.query("UPDATE facts SET state = 'conflict' WHERE id = $1", [existing.id]);
      const conflictId = await insertConflict(client, partId, result.conflict!, runId, undefined, { kept_raw: existing.raw, rejected_raw: incoming.raw });
      return { action: "conflict", factId: existing.id, conflictId };
    }
    case "protected": {
      const conflictId = await insertConflict(client, partId, result.conflict!, runId, undefined, { kept_raw: existing.raw, rejected_raw: incoming.raw });
      return { action: "protected", factId: existing.id, conflictId };
    }
    case "revision_change": {
      const newId = await supersedeFact(client, existing.id, result.entry, runId);
      const conflictId = await insertConflict(client, partId, result.conflict!, runId, { resolution: "revision_change", resolved_by: "merge" },
        { kept_raw: incoming.raw, rejected_raw: existing.raw });
      return { action: "revision_change", factId: newId, supersededId: existing.id, conflictId };
    }
    case "supersede": {
      // one document read again by a newer extractor or normaliser. The old row is history, not a
      // rejected claim, so the conflicts row is written ALREADY RESOLVED — /conflicts stays a list
      // of things a person has to decide, and this is not one.
      const newId = await supersedeFact(client, existing.id, result.entry, runId);
      const conflictId = await insertConflict(client, partId, result.conflict!, runId,
        { resolution: `rule:${result.rule ?? "same_doc_reextraction"}`, resolved_by: "merge" },
        { kept_raw: incoming.raw, rejected_raw: existing.raw });
      return { action: "supersede", factId: newId, supersededId: existing.id, conflictId, rule: result.rule };
    }
    case "list_union": {
      // the value CHANGES (it grows), so it is a new row: facts is append-only and a union is not a
      // state promotion. No conflicts row — the two cells never disagreed.
      const newId = await supersedeFact(client, existing.id, result.entry, runId);
      return { action: "list_union", factId: newId, supersededId: existing.id, rule: result.rule };
    }
    case "agree_same_doc":
      return { action: "agree_same_doc", factId: existing.id, rule: result.rule };
    case "insert":
    case "refused_inherit":
    case "refused_not_applicable":
      // mergeField never returns these: `insert` is handled above (no current row) and the two
      // refusals are the store's own. Named rather than left to fall off the switch.
      throw new Error(`applyMerge: mergeField returned an action the store does not expect here: ${result.action}`);
  }
}

/**
 * Withdraw a fact we should never have written, without deleting anything. Used by `ingest remerge`
 * for a family-level value that reached a part the document only LISTS (describesPart). The row is
 * superseded by a `gap_unattempted` row: not `gap_confirmed`, which would claim tier 1 and tier 2
 * were checked for this part and found nothing — nobody checked, the value came from another
 * product's datasheet. The retracted row, its value and its evidence stay in history, and `method`
 * names why it went, so /changes and the fact history both show the withdrawal as an event.
 *
 * `state` chooses WHICH withdrawal this is, and the two mean different things to every reader:
 *   gap_unattempted  (default) nobody has looked for this part's own value yet — the field is still
 *                    a gap worth filling, which is right for a wrongly inherited value.
 *   not_applicable   the field cannot apply to this part at all, so it is a CLOSED gap and the gap
 *                    ledger must stop asking for it. Only `notApplicable` may ask for this one.
 * Both supersede rather than delete: the row, its value and its evidence stay in history.
 */
export async function retractFact(
  client: Queryable, factId: number, rule: string, runId: number,
  opts: { state?: "gap_unattempted" | "not_applicable" } = {},
): Promise<{ newId: number; supersededId: number }> {
  const old = await client.query<{ part_id: number; field_key: string; inherited_from: string | null }>(
    "SELECT part_id, field_key, inherited_from FROM facts WHERE id = $1 AND superseded_by IS NULL", [factId]);
  if (!old.rows[0]) throw new Error(`retractFact: fact ${factId} is not a current row`);
  const { field_key, inherited_from } = old.rows[0];
  const entry: SpecEntry = {
    k: field_key, raw: "", state: opts.state ?? "gap_unattempted",
    inherited_from: inherited_from ?? undefined,
    prov: { tier: 2, method: `retracted:${rule}` },
  };
  const newId = await supersedeFact(client, factId, entry, runId);
  return { newId, supersededId: factId };
}

export type TierRestamp = { checked: number; facts_restamped: number; evidence_restamped: number; unknown_doc_type: number; by_change: Record<string, number> };

/**
 * Correct the TIER STAMP of facts whose tier disagrees with `tierFor(doc_type, method)`.
 *
 * This is an in-place UPDATE of `tier`, and that needs justifying against "never overwrite a fact".
 * A tier was never an observation: it is DERIVED from the document a fact was read from, and these
 * rows carry a mis-derivation — 45,096 facts read from `vendor_datasheet_html` by the Atlas
 * migration were stamped tier 1 while every other writer calls that document tier 2. The value, the
 * raw string, the document and the locator are untouched; superseding 45,096 rows to restate a
 * derived field would double the table, break every created_at, and record nothing that the run's
 * own before/after counts do not. It is the same class of in-place update as `state`.
 *
 * `fact_evidence` carries its own copy of the tier and is corrected in the same statement, or the
 * corroboration counts would keep reading the old one.
 *
 * Tier 0 is never touched by doc type: an operator review is a property of the review, not of the
 * document, and TIER_BY_METHOD says so for `hexcat_seed`.
 */
export async function restampTiers(client: Queryable, runId: number, opts: { commit: boolean; docType?: string }): Promise<TierRestamp> {
  const rows = await client.query<{ tier: number; method: string; doc_type: string | null; n: number }>(
    `SELECT f.tier, f.method, d.doc_type, count(*)::int AS n
       FROM facts f LEFT JOIN source_docs d ON d.doc_id = f.doc_id
      WHERE f.superseded_by IS NULL AND f.doc_id IS NOT NULL ${opts.docType ? "AND d.doc_type = $1" : ""}
      GROUP BY 1, 2, 3`, opts.docType ? [opts.docType] : []);

  const out: TierRestamp = { checked: 0, facts_restamped: 0, evidence_restamped: 0, unknown_doc_type: 0, by_change: {} };
  for (const r of rows.rows) {
    out.checked += r.n;
    const want = tryTierFor(r.doc_type, r.method);
    if (want === null) { out.unknown_doc_type += r.n; continue; }
    if (want === r.tier) continue;
    out.by_change[`${r.doc_type ?? "-"}/${r.method}: ${r.tier} -> ${want}`] = r.n;
    out.facts_restamped += r.n;
    if (!opts.commit) continue;
    const upd = await client.query(
      `UPDATE facts f SET tier = $3
         FROM source_docs d
        WHERE d.doc_id = f.doc_id AND f.superseded_by IS NULL AND f.tier = $1 AND f.method = $2 AND d.doc_type = $4`,
      [r.tier, r.method, want, r.doc_type]);
    const ev = await client.query(
      `UPDATE fact_evidence e SET tier = $3
         FROM facts f, source_docs d
        WHERE f.id = e.fact_id AND d.doc_id = e.doc_id AND f.superseded_by IS NULL
          AND e.tier = $1 AND e.method = $2 AND d.doc_type = $4`,
      [r.tier, r.method, want, r.doc_type]);
    out.evidence_restamped += ev.rowCount ?? 0;
    if ((upd.rowCount ?? 0) !== r.n) {
      throw new Error(`restampTiers: expected to update ${r.n} rows for ${r.doc_type}/${r.method} tier ${r.tier} -> ${want}, updated ${upd.rowCount}`);
    }
  }
  return out;
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
            -- a row above tier 0 with no document of its own can be neither: facts_verified_needs_source
            -- refuses it on UPDATE exactly as it does on INSERT, and a rollback that trips it would
            -- report ROLLBACK_FAILED for a run whose only sin was touching a source-less row
            WHEN f.tier <> 0 AND f.doc_id IS NULL THEN 'unverified'::fact_state
            WHEN (SELECT count(DISTINCT e.doc_id) FROM fact_evidence e WHERE e.fact_id = f.id) > 1 THEN 'corroborated'::fact_state
            ELSE 'verified'::fact_state END
         WHERE f.id = $1 AND f.state IS DISTINCT FROM (CASE
            WHEN EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL) THEN 'conflict'::fact_state
            -- a row above tier 0 with no document of its own can be neither: facts_verified_needs_source
            -- refuses it on UPDATE exactly as it does on INSERT, and a rollback that trips it would
            -- report ROLLBACK_FAILED for a run whose only sin was touching a source-less row
            WHEN f.tier <> 0 AND f.doc_id IS NULL THEN 'unverified'::fact_state
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
  if (existing.state === "gap_confirmed" || existing.state === "not_applicable") return { action: "agree_same_doc", factId: existing.id };
  if (existing.state === "gap_unattempted") {
    const newId = await supersedeFact(client, existing.id, entry, runId);
    return { action: "insert", factId: newId, supersededId: existing.id };
  }
  throw new Error(`writeGapConfirmed: ${fieldKey} on part ${partId} currently holds a ${existing.state} row (fact ${existing.id}); a gap cannot be confirmed over it`);
}
