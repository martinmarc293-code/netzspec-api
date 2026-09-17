// src/api/queries/compare.ts — GET /v1/compare?skus=: 2..8 parts side by side over their
// rendered facts, one row per field, with `differs` decided per row.
//
// Rules this module enforces:
//   * a ref is `vendor:sku`; a list shorter than 2 or longer than 8 is a 400 before any lookup,
//     a malformed or duplicated ref is a 400 that names it, an unknown ref is a 404 that names
//     it — a comparison that silently dropped a part would answer a different question.
//   * a row exists only for a field at least one part RENDERS (verified / corroborated). Inside
//     a row, a part with a current row in another state (a held conflict, a confirmed gap) shows
//     `value: null, raw: null` and that state, so a consumer can print "held" rather than a
//     blank; a part with no row at all shows `state: null`.
//   * `differs` is true unless every part carries the same rendered value: a missing value on
//     one side is a difference, not a match.
//   * rows are in dictionary order (by key), the same order /v1/fields and the part page use.
import { query } from "../../store/db.js";
import { badRequest, notFound } from "../errors.js";
import type { PartSummaryT } from "../schemas.js";
import { RENDERED_STATES, SUMMARY_COLUMNS, SUMMARY_FROM, toSummary, type SummaryRow } from "./shared.js";

export const COMPARE_MIN_REFS = 2;
export const COMPARE_MAX_REFS = 8;

export type CompareRef = { ref: string; vendor: string; sku: string };
export type CompareCell = { ref: string; value: unknown; raw: string | null; state: string | null };
export type CompareRow = {
  key: string; label_en: string; label_de: string; type: string; unit: string | null; values: CompareCell[]; differs: boolean;
};
export type CompareResult = { parts: PartSummaryT[]; rows: CompareRow[] };

/** `cisco:C9200L-24P-4G,cisco:C9200L-48P-4G` → refs, or a 400 naming what is wrong. */
export function parseRefs(raw: string): CompareRef[] {
  const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length < COMPARE_MIN_REFS || tokens.length > COMPARE_MAX_REFS) {
    throw badRequest(`skus must list between ${COMPARE_MIN_REFS} and ${COMPARE_MAX_REFS} parts as vendor:sku (got ${tokens.length})`);
  }
  const refs: CompareRef[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const i = t.indexOf(":");
    if (i <= 0 || i === t.length - 1) throw badRequest(`ref "${t}" is not vendor:sku`);
    const ref: CompareRef = { ref: t, vendor: t.slice(0, i), sku: t.slice(i + 1) };
    const norm = `${ref.vendor}:${ref.sku.toUpperCase()}`;
    if (seen.has(norm)) throw badRequest(`ref "${t}" is listed twice`);
    seen.add(norm);
    refs.push(ref);
  }
  return refs;
}

type ResolvedRow = { id: number; vendor: string; sku_norm: string };
type FactRow = {
  part_id: number; field_key: string; label_en: string; label_de: string; type: string; unit: string | null;
  value: unknown; raw: string; state: string;
};

// Derived from shared.ts, not retyped. This was a third hand-written copy of the rendered states
// (with shared.ts's own and filter.ts's, the last derived in 3821302): identical today, and the day a
// state is added to what the API renders, a copy here would keep hiding it from /compare while every
// other endpoint showed it.
const RENDERED: ReadonlySet<string> = new Set(RENDERED_STATES);

/** Stable text for value equality: jsonb already canonicalises key order before it reaches us. */
function canon(v: unknown): string {
  return JSON.stringify(v);
}

export async function compareParts(refs: CompareRef[]): Promise<CompareResult> {
  // One lookup for every ref; an unknown ref is named in the 404.
  const resolved = await query<ResolvedRow>(`
    SELECT p.id, v.slug AS vendor, p.sku_norm
      FROM parts p JOIN vendors v ON v.id = p.vendor_id
     WHERE p.retired_at IS NULL   -- LIVE rows only (shared.ts LIVE_PART): a tombstone compares as
       -- an empty column beside its own survivor, which reads as a part with no specifications.
       AND (v.slug, p.sku_norm) IN (SELECT r.vendor, upper(r.sku) FROM unnest($1::text[], $2::text[]) AS r(vendor, sku))`,
    [refs.map((r) => r.vendor), refs.map((r) => r.sku)]);
  const idByRef = new Map<string, number>();
  for (const r of refs) {
    const hit = resolved.rows.find((x) => x.vendor === r.vendor && x.sku_norm === r.sku.toUpperCase());
    if (!hit) throw notFound(`part ${r.ref} not found`);
    idByRef.set(r.ref, hit.id);
  }
  const ids = refs.map((r) => idByRef.get(r.ref) as number);

  const [summaries, facts] = await Promise.all([
    query<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE p.id = ANY($1::bigint[])`, [ids]),
    query<FactRow>(`
      SELECT f.part_id, f.field_key, d.label_en, d.label_de, d.type, d.unit, f.value, f.raw, f.state::text AS state
        FROM facts f JOIN field_dictionary d ON d.key = f.field_key
       WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL
       ORDER BY f.field_key, f.part_id`, [ids]),
  ]);
  const summaryById = new Map(summaries.rows.map((r) => [r.id, toSummary(r)] as const));
  const parts = ids.map((id) => summaryById.get(id)).filter((s): s is PartSummaryT => s !== undefined);

  // Group current rows by key, then keep only the keys with at least one rendered value.
  const byKey = new Map<string, FactRow[]>();
  for (const f of facts.rows) {
    const list = byKey.get(f.field_key);
    if (list) list.push(f); else byKey.set(f.field_key, [f]);
  }
  const rows: CompareRow[] = [];
  for (const [key, list] of byKey) {
    if (!list.some((f) => RENDERED.has(f.state))) continue;
    const head = list[0];
    const byPart = new Map(list.map((f) => [f.part_id, f] as const));
    const values: CompareCell[] = refs.map((r) => {
      const f = byPart.get(idByRef.get(r.ref) as number);
      if (!f) return { ref: r.ref, value: null, raw: null, state: null };
      if (!RENDERED.has(f.state)) return { ref: r.ref, value: null, raw: null, state: f.state };
      return { ref: r.ref, value: f.value, raw: f.raw, state: f.state };
    });
    const rendered = values.filter((c) => c.state !== null && RENDERED.has(c.state));
    const differs = rendered.length !== values.length || new Set(rendered.map((c) => canon(c.value))).size > 1;
    rows.push({ key, label_en: head.label_en, label_de: head.label_de, type: head.type, unit: head.unit, values, differs });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { parts, rows };
}
