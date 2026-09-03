// src/store/aliases.ts — identity facts that are not specs: GTIN/UPC/EAN and alternative part
// numbers, each with a tier and a source like any other fact.
//
// (part, kind, value) is the identity, so the same barcode from two sources is one row that
// keeps the better (lower) tier and the provenance that came with it. The allowed kinds are the
// schema's CHECK constraint; an unknown kind is rethrown naming it rather than as "23514".
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type AliasKind = "gtin" | "upc" | "ean" | "legacy_sku" | "variant_sku" | "vendor_alias" | "distributor_sku";

export type AliasInput = {
  kind: AliasKind;
  value: string;
  tier: number;
  doc_id?: string | null;
  source_url?: string | null;
};

export type AliasRow = AliasInput & { id: number; part_id: number; run_id: number | null };

export async function upsertAlias(partId: number, input: AliasInput, runId: number, db: Queryable = getPool()): Promise<AliasRow> {
  const value = input.value.trim();
  if (!value) throw new Error(`upsertAlias: empty ${input.kind} value for part ${partId}`);
  try {
    const r = await db.query<AliasRow>(
      `INSERT INTO part_aliases (part_id, kind, value, tier, doc_id, source_url, run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (part_id, kind, value) DO UPDATE SET
         doc_id     = CASE WHEN EXCLUDED.tier < part_aliases.tier THEN COALESCE(EXCLUDED.doc_id, part_aliases.doc_id)         ELSE COALESCE(part_aliases.doc_id, EXCLUDED.doc_id) END,
         source_url = CASE WHEN EXCLUDED.tier < part_aliases.tier THEN COALESCE(EXCLUDED.source_url, part_aliases.source_url) ELSE COALESCE(part_aliases.source_url, EXCLUDED.source_url) END,
         run_id     = CASE WHEN EXCLUDED.tier < part_aliases.tier THEN EXCLUDED.run_id ELSE part_aliases.run_id END,
         tier       = LEAST(part_aliases.tier, EXCLUDED.tier)
       RETURNING id, part_id, kind, value, tier, doc_id, source_url, run_id`,
      [partId, input.kind, value, input.tier, input.doc_id ?? null, input.source_url ?? null, runId],
    );
    return r.rows[0];
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === "23514" && /kind/.test(err.constraint ?? "")) throw new Error(`upsertAlias: unknown alias kind "${input.kind}"`);
    throw e;
  }
}

export async function aliasesFor(partId: number, db: Queryable = getPool()): Promise<AliasRow[]> {
  const r = await db.query<AliasRow>(
    "SELECT id, part_id, kind, value, tier, doc_id, source_url, run_id FROM part_aliases WHERE part_id = $1 ORDER BY kind, value", [partId]);
  return r.rows;
}
