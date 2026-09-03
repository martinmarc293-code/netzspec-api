// src/store/relations.ts — directed edges between parts (successor, compatible, module_of …).
//
// The target is recorded as the SKU the source document wrote (`to_sku`) whether or not we hold
// that part, and resolved to `to_part_id` only within the SAME vendor: a Cisco successor can
// only be a Cisco part, and a match on letters alone across vendors would be a fiction. The
// resolution is exact SKU first, then case-insensitive, like findPart. An edge whose target is
// not in the catalogue keeps its to_sku so the relation appears the day the target is imported
// (to_part_id is re-resolved on the next upsert of the same edge).
//
// On a repeated (from, to_sku, kind): the lower tier wins and brings its provenance; equal or
// higher tier fills NULL provenance only.
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type RelationKind =
  | "successor" | "predecessor" | "compatible" | "module_of" | "hosts_module"
  | "supports_transceiver" | "bundle_contains" | "license_for" | "accessory_for" | "equivalent";

export type RelationInput = {
  to_sku: string;
  kind: RelationKind;
  tier: number;
  doc_id?: string | null;
  source_url?: string | null;
  note?: string | null;
};

export type RelationRow = RelationInput & { id: number; from_part_id: number; to_part_id: number | null; run_id: number | null };

export async function resolveTargetPart(fromPartId: number, toSku: string, db: Queryable): Promise<number | null> {
  const r = await db.query<{ id: number }>(
    `SELECT p.id FROM parts p
      WHERE p.vendor_id = (SELECT vendor_id FROM parts WHERE id = $1)
        AND (p.sku = $2 OR p.sku_norm = upper($2))
      ORDER BY (p.sku = $2) DESC, p.sku
      LIMIT 1`,
    [fromPartId, toSku],
  );
  return r.rows[0]?.id ?? null;
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
