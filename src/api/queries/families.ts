// src/api/queries/families.ts — GET /v1/families and GET /v1/families/{vendor}/{family}: the
// series a consumer builds a family page from, with the facts the whole family shares.
//
// Rules this module enforces:
//   * a family is (vendor, family) exactly as the parts table spells it; parts with no family
//     belong to no family and are absent here, not lumped into a "(none)" bucket.
//   * `shared_facts` are the fields whose rendered value is IDENTICAL on at least 80 % of the
//     members that have any rendered fact. This is the only family-level truth the API states:
//     a value 2 of 3 members carry is not shared (66 %), and a family with no facts shares
//     nothing. Nothing here inherits a value into a member — that is the pipeline's rule
//     (doc_parts) and this endpoint only reports agreement that already exists row by row.
//   * `category` is the dominant category of the members (mode); a family that straddles two
//     categories is reported under the one most of its parts sit in.
//   * lifecycle buckets fold the three end-of-life statuses (eol_announced, end_of_sale,
//     end_of_support) into `eol_announced` — "a bulletin exists" — and count a part with no
//     lifecycle row as `unknown`, never as active.
//   * lists are keyset-paged by (parts DESC, vendor, family); the cursor carries the count and
//     the (vendor, family) pair, so a page can neither skip nor repeat a family while parts are
//     being loaded underneath it.
import { query } from "../../store/db.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { badRequest } from "../errors.js";
import type { PartSummaryT } from "../schemas.js";
import { SUMMARY_COLUMNS, SUMMARY_FROM, page, toSummary, type SummaryRow } from "./shared.js";

export type LifecycleBuckets = { active: number; eol_announced: number; unknown: number };
export type FamilyItem = {
  vendor: string; family: string; category: string; parts: number; hardware_parts: number; with_facts: number;
  lifecycle: LifecycleBuckets;
};
export type SharedFact = { key: string; label_en: string; label_de: string; value: unknown; unit: string | null; members: number; of: number };
export type FamilyRecord = FamilyItem & { shared_facts: SharedFact[]; members: PartSummaryT[]; next_cursor: string | null };

type FamilyRow = {
  vendor: string; family: string; category: string; parts: number; hardware_parts: number; with_facts: number;
  active: number; eol_announced: number; unknown: number;
};

/** The per-family aggregate; `$1` vendor slug or NULL, `$2` exact family or NULL. */
const FAMILY_AGG_SQL = `
  WITH pf AS (SELECT DISTINCT part_id FROM facts WHERE superseded_by IS NULL AND state IN ('verified', 'corroborated'))
  SELECT v.slug AS vendor, p.family,
         mode() WITHIN GROUP (ORDER BY c.slug) AS category,
         count(*)::int AS parts,
         count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts,
         count(pf.part_id)::int AS with_facts,
         count(*) FILTER (WHERE l.status = 'active')::int AS active,
         count(*) FILTER (WHERE l.status IN ('eol_announced', 'end_of_sale', 'end_of_support'))::int AS eol_announced,
         count(*) FILTER (WHERE l.status IS NULL OR l.status = 'unknown')::int AS unknown
    FROM parts p
    JOIN vendors v ON v.id = p.vendor_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN lifecycle l ON l.part_id = p.id
    LEFT JOIN pf ON pf.part_id = p.id
   -- LIVE rows only (shared.ts LIVE_PART).
   WHERE p.retired_at IS NULL AND p.family IS NOT NULL AND ($1::text IS NULL OR v.slug = $1) AND ($2::text IS NULL OR p.family = $2)
   GROUP BY v.slug, p.family`;

function toItem(r: FamilyRow): FamilyItem {
  return {
    vendor: r.vendor, family: r.family, category: r.category, parts: r.parts, hardware_parts: r.hardware_parts,
    with_facts: r.with_facts, lifecycle: { active: r.active, eol_announced: r.eol_announced, unknown: r.unknown },
  };
}

/** The list cursor carries the parts count as `id` and the (vendor, family) pair as JSON in `k`. */
function familyCursorKey(vendor: string, family: string): string {
  return JSON.stringify([vendor, family]);
}
function parseFamilyCursorKey(k: string): [string, string] {
  let parsed: unknown;
  try { parsed = JSON.parse(k); } catch { throw badRequest("invalid cursor"); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") throw badRequest("invalid cursor");
  return [parsed[0], parsed[1]];
}

export type FamiliesListParams = { vendor?: string; category?: string; limit: number; cursor?: string };

export async function listFamilies(params: FamiliesListParams): Promise<{ items: FamilyItem[]; next_cursor: string | null }> {
  const values: unknown[] = [params.vendor ?? null, null];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };
  const where: string[] = [];
  if (params.category !== undefined) where.push(`fam.category = ${bind(params.category)}`);
  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    const [cv, cf] = parseFamilyCursorKey(cursor.k);
    // ORDER BY parts DESC, vendor, family — the keyset condition mirrors that mixed direction.
    where.push(`(fam.parts < ${bind(cursor.id)} OR (fam.parts = ${bind(cursor.id)} AND (fam.vendor, fam.family) > (${bind(cv)}, ${bind(cf)})))`);
  }
  const limitParam = bind(params.limit + 1);
  const { rows } = await query<FamilyRow>(`
    WITH fam AS (${FAMILY_AGG_SQL})
    SELECT * FROM fam
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY fam.parts DESC, fam.vendor, fam.family
    LIMIT ${limitParam}`, values);
  const { items, more } = page(rows, params.limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toItem),
    next_cursor: more && last ? encodeCursor(familyCursorKey(last.vendor, last.family), last.parts) : null,
  };
}

// A field is shared when ONE value is carried by >= 80 % of the members with any rendered fact.
// Integer arithmetic (members * 5 >= of * 4) so 2 of 3 is refused without a rounding argument.
const SHARED_FACTS_SQL = `
  WITH mem AS (SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id
                WHERE p.retired_at IS NULL AND v.slug = $1 AND p.family = $2),   -- LIVE rows only
  cf AS (
    SELECT f.part_id, f.field_key, f.value, f.unit FROM facts f JOIN mem ON mem.id = f.part_id
     WHERE f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated') AND f.value IS NOT NULL),
  denom AS (SELECT count(DISTINCT part_id)::int AS n FROM cf),
  agg AS (SELECT field_key, value, min(unit) AS unit, count(DISTINCT part_id)::int AS members FROM cf GROUP BY field_key, value),
  best AS (SELECT DISTINCT ON (field_key) field_key, value, unit, members FROM agg ORDER BY field_key, members DESC, value::text)
  SELECT b.field_key AS key, d.label_en, d.label_de, b.value, b.unit, b.members, denom.n AS of
    FROM best b JOIN field_dictionary d ON d.key = b.field_key CROSS JOIN denom
   WHERE denom.n > 0 AND b.members * 5 >= denom.n * 4
   ORDER BY b.field_key`;

export type FamilyMembersParams = { limit: number; cursor?: string };

export async function getFamily(vendor: string, family: string, members: FamilyMembersParams): Promise<FamilyRecord | null> {
  const values: unknown[] = [vendor, family];
  const bind = (v: unknown): string => { values.push(v); return `$${values.length}`; };
  const where = ["v.slug = $1", "p.family = $2"];
  const cursor = decodeCursor(members.cursor);
  if (cursor) where.push(`(p.sku, p.id) > (${bind(cursor.k)}, ${bind(cursor.id)})`);
  const limitParam = bind(members.limit + 1);

  // One round trip for all three statements; an unknown family simply yields no head row.
  const [head, shared, memberRows] = await Promise.all([
    query<FamilyRow>(FAMILY_AGG_SQL, [vendor, family]),
    query<SharedFact>(SHARED_FACTS_SQL, [vendor, family]),
    query<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE ${where.join(" AND ")} ORDER BY p.sku, p.id LIMIT ${limitParam}`, values),
  ]);
  if (head.rows.length === 0) return null;
  const { items, more } = page(memberRows.rows, members.limit);
  const last = items[items.length - 1];
  return {
    ...toItem(head.rows[0]),
    shared_facts: shared.rows,
    members: items.map(toSummary),
    next_cursor: more && last ? encodeCursor(last.sku, last.id) : null,
  };
}
