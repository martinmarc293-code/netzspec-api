// src/store/relations.ts — directed edges between parts (successor, compatible, module_of …).
//
// The target is recorded as the SKU the source document wrote (`to_sku`) whether or not we hold
// that part, and resolved to `to_part_id` only within the SAME vendor: a Cisco successor can
// only be a Cisco part, and a match on letters alone across vendors would be a fiction. The
// resolution IS findPart — not a second copy of it that says "like findPart" and then drifts,
// which is what this file did until 16 Sep 2026 (see resolveTargetPart). An edge whose target is
// not in the catalogue keeps its to_sku so the relation appears the day the target is imported
// (to_part_id is re-resolved on the next upsert of the same edge).
//
// On a repeated (from, to_sku, kind): the lower tier wins and brings its provenance; equal or
// higher tier fills NULL provenance only.
import { getPool } from "./db.js";
import { findPart } from "./parts.js";
import type { Queryable } from "./runs.js";

/**
 * THE relation kinds the column may hold, as a value so consumers can iterate them; the type is
 * derived from it (the `ALL_STATES`/`FactState` idiom). Mirrors the `relation_kind` enum.
 *
 * `spare_of` was missing from here, from `api/tools.ts` and from `apply-acquired.ts` until 16 Sep
 * 2026 — three hand-written copies of one enum, all ten long, while the database had eleven and
 * **11,320 rows** used the eleventh: the third-largest kind in the table. `scripts/build-spare-of.mts`
 * writes them with raw SQL precisely because this type would not admit the value, so the bypass was
 * the symptom rather than the cause. Nothing compared any of the three to the schema; a typecheck
 * cannot, because two of them are Sets of strings.
 *
 * NOT every consumer should hold all eleven — see `apply-acquired.ts`, which excludes `spare_of` on
 * purpose now that the exclusion is stated: that edge is DERIVED from Cisco's `=` convention and is
 * never asserted by a document, so an acquired file proposing one is proposing something it cannot
 * know. `tests/db/store.test.ts` asserts THIS list equals the enum.
 */
export const RELATION_KINDS = [
  "successor", "predecessor", "compatible", "module_of", "hosts_module",
  "supports_transceiver", "bundle_contains", "license_for", "accessory_for", "equivalent",
  "spare_of",
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

export type RelationInput = {
  to_sku: string;
  kind: RelationKind;
  tier: number;
  doc_id?: string | null;
  source_url?: string | null;
  note?: string | null;
};

export type RelationRow = RelationInput & { id: number; from_part_id: number; to_part_id: number | null; run_id: number | null };

/**
 * The target part within the SAME vendor, under the store's ONE identity rule.
 *
 * This carried a second copy of that rule until 16 Sep 2026 — `p.sku = $2 OR p.sku_norm = upper($2)`,
 * ordered exact-first — written while `parts.sku` was still case-sensitive. Migration 0010 ended
 * that: identity folds case (0020 extended it to whitespace), the 127 live case pairs were merged by
 * `ingest hygiene case-duplicates`, and the losing spelling is RETIRED, keeping its exact string for
 * ever because a page printed it. The copy here learned none of it and excluded no retired row, so
 * `ORDER BY (p.sku = $2) DESC` actively PREFERRED the retired twin whenever a document wrote the
 * retired spelling — the one lookup that gets worse the more faithfully a source quotes the vendor.
 * Nor did it reach the survivor by any other route: aliases carry all 137 retired spellings, but
 * that is `partsByAliasValue`, which this never called.
 *
 * `findPart` already implements the whole rule (exact → survivor when retired; live case/whitespace
 * fold; a retired row that points home → survivor), so this delegates instead of keeping a copy to
 * drift. Measured over production before the change: of the 598 relations where the two rules CAN
 * disagree, 0 verdicts move — no document has yet written a retired spelling into `to_sku`, so the
 * hole was latent rather than live and closing it moves no stored edge.
 */
export async function resolveTargetPart(fromPartId: number, toSku: string, db: Queryable): Promise<number | null> {
  const v = await db.query<{ slug: string }>(
    "SELECT v.slug FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = $1",
    [fromPartId],
  );
  const slug = v.rows[0]?.slug;
  return slug ? ((await findPart(slug, toSku, db))?.id ?? null) : null;
}

export async function upsertRelation(
  fromPartId: number, input: RelationInput, runId: number, db: Queryable = getPool(),
): Promise<RelationRow> {
  const toPartId = await resolveTargetPart(fromPartId, input.to_sku, db);
  const r = await db.query<RelationRow>(
    `INSERT INTO relations (from_part_id, to_part_id, to_sku, kind, tier, doc_id, source_url, note, run_id)
     VALUES ($1, $2, $3, $4::relation_kind, $5, $6, $7, $8, $9)
     ON CONFLICT (from_part_id, to_sku, kind) DO UPDATE SET
       to_part_id = COALESCE(EXCLUDED.to_part_id, relations.to_part_id),
       doc_id     = CASE WHEN EXCLUDED.tier < relations.tier THEN COALESCE(EXCLUDED.doc_id, relations.doc_id)     ELSE COALESCE(relations.doc_id, EXCLUDED.doc_id) END,
       source_url = CASE WHEN EXCLUDED.tier < relations.tier THEN COALESCE(EXCLUDED.source_url, relations.source_url) ELSE COALESCE(relations.source_url, EXCLUDED.source_url) END,
       note       = CASE WHEN EXCLUDED.tier < relations.tier THEN COALESCE(EXCLUDED.note, relations.note)         ELSE COALESCE(relations.note, EXCLUDED.note) END,
       run_id     = CASE WHEN EXCLUDED.tier < relations.tier THEN EXCLUDED.run_id ELSE relations.run_id END,
       tier       = LEAST(relations.tier, EXCLUDED.tier)
     RETURNING id, from_part_id, to_part_id, to_sku, kind, tier, doc_id, source_url, note, run_id`,
    [fromPartId, toPartId, input.to_sku, input.kind, input.tier, input.doc_id ?? null, input.source_url ?? null, input.note ?? null, runId],
  );
  return r.rows[0];
}

export async function relationsFrom(fromPartId: number, db: Queryable = getPool()): Promise<RelationRow[]> {
  const r = await db.query<RelationRow>(
    "SELECT id, from_part_id, to_part_id, to_sku, kind, tier, doc_id, source_url, note, run_id FROM relations WHERE from_part_id = $1 ORDER BY kind, to_sku",
    [fromPartId]);
  return r.rows;
}
