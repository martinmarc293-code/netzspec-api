// src/api/queries/similar.ts — GET /v1/parts/{vendor}/{sku}/similar: the one-dimension-different
// siblings docs/legacy/PART_PAGE_SPEC.md § Comparison asks for ("comparators chosen because
// they differ in ONE dimension — reach, PoE, port count — so the table is decision-useful").
//
// Rules this module enforces:
//   * candidates are hardware parts of the same vendor AND family; only when the part has no
//     family, or its family holds no other hardware part, does the pool widen to the same
//     category. `basis` says which pool answered, so a consumer can label the section.
//   * the part itself and every non-hardware part (licences, service contracts, software) are
//     excluded: a licence shares no dimension with a switch, and a part is not its own sibling.
//   * ranking = the number of rendered fact values the two parts hold in common (same key, same
//     canonical value); ties break on sku. `differs` lists every key rendered on either side
//     whose values are not identical — an absence on one side is a difference.
//   * only rendered facts (verified / corroborated) take part, on both sides. A held conflict
//     neither matches nor differs; it is invisible here as everywhere else.
import { query } from "../../store/db.js";
import type { PartSummaryT } from "../schemas.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, toSummary, type PartIdentity, type SummaryRow } from "./shared.js";

export type SimilarBasis = "family" | "category";
export type DifferingField = {
  key: string; label_en: string; label_de: string; type: string; unit: string | null;
  /** the requested part's rendered value, null when it has none */
  value: unknown;
  /** the sibling's rendered value, null when it has none */
  other: unknown;
};
export type SimilarItem = PartSummaryT & { shared_facts: number; differs: DifferingField[] };
export type SimilarResult = { items: SimilarItem[]; basis: SimilarBasis; next_cursor: null };

type ScoredRow = { id: number; shared: number };
type FactRow = { part_id: number; field_key: string; label_en: string; label_de: string; type: string; unit: string | null; value: unknown };

// $1 the part, $2 the pool: 'family' (same vendor + family) or 'category' (same vendor + category).
// The part's own vendor, family and category are read inside the statement, so ranking costs
// one round trip; a part with no family yields no family candidates and the caller widens.
const RANK_SQL = `
  WITH me AS (SELECT vendor_id, family, category_id FROM parts WHERE id = $1),
  mine AS (
    SELECT field_key, value FROM facts
     WHERE part_id = $1 AND superseded_by IS NULL AND state IN ('verified', 'corroborated') AND value IS NOT NULL),
  cand AS (
    SELECT p.id, p.sku FROM parts p, me
     WHERE p.vendor_id = me.vendor_id AND p.product_class = 'hardware' AND p.id <> $1
       AND (($2::text = 'family' AND me.family IS NOT NULL AND p.family = me.family)
         OR ($2::text = 'category' AND p.category_id = me.category_id)))
  SELECT c.id,
         (SELECT count(*) FROM facts f JOIN mine m ON m.field_key = f.field_key AND m.value = f.value
           WHERE f.part_id = c.id AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated'))::int AS shared
    FROM cand c
   ORDER BY shared DESC, c.sku, c.id
   LIMIT $3`;

function canon(v: unknown): string {
  return JSON.stringify(v);
}

export async function similarParts(part: PartIdentity, limit: number): Promise<SimilarResult> {
  let basis: SimilarBasis = "family";
  let ranked = (await query<ScoredRow>(RANK_SQL, [part.id, "family", limit])).rows;
  if (ranked.length === 0) {
    basis = "category";
    ranked = (await query<ScoredRow>(RANK_SQL, [part.id, "category", limit])).rows;
  }
  if (ranked.length === 0) return { items: [], basis, next_cursor: null };

  const ids = ranked.map((r) => r.id);
  const [summaries, facts] = await Promise.all([
    query<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE p.id = ANY($1::bigint[])`, [ids]),
    query<FactRow>(`
      SELECT f.part_id, f.field_key, d.label_en, d.label_de, d.type, d.unit, f.value
        FROM facts f JOIN field_dictionary d ON d.key = f.field_key
       WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') AND f.value IS NOT NULL
       ORDER BY f.field_key`, [[part.id, ...ids]]),
  ]);
  const summaryById = new Map(summaries.rows.map((r) => [r.id, toSummary(r)] as const));
  const factsBy = new Map<number, Map<string, FactRow>>();
  for (const f of facts.rows) {
    const m = factsBy.get(f.part_id) ?? new Map<string, FactRow>();
    m.set(f.field_key, f);
    factsBy.set(f.part_id, m);
  }
  const mine = factsBy.get(part.id) ?? new Map<string, FactRow>();

  const items: SimilarItem[] = [];
  for (const r of ranked) {
    const summary = summaryById.get(r.id);
    if (!summary) continue;
    const theirs = factsBy.get(r.id) ?? new Map<string, FactRow>();
    const keys = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
    const differs: DifferingField[] = [];
    for (const key of keys) {
      const a = mine.get(key);
      const b = theirs.get(key);
      if (a && b && canon(a.value) === canon(b.value)) continue;
      const d = (a ?? b) as FactRow;
      differs.push({ key, label_en: d.label_en, label_de: d.label_de, type: d.type, unit: d.unit, value: a ? a.value : null, other: b ? b.value : null });
    }
    items.push({ ...summary, shared_facts: r.shared, differs });
  }
  return { items, basis, next_cursor: null };
}
