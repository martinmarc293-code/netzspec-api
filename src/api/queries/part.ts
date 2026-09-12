// src/api/queries/part.ts — the full part record and its three sub-resources (facts with
// evidence, history, open conflicts).
//
// Rules this module enforces:
//   * facts default to the RENDERED states; `states=all` is an explicit opt-in to see what is
//     held, unverified or confirmed absent. A consumer never renders a conflict by accident.
//   * every fact carries its source inline, and `sources` lists every document the record
//     draws on — facts, their evidence, lifecycle, relations, images, the name itself — so the
//     record can be audited without a second request.
//   * image URLs are absolute: PUBLIC_BASE_URL + /img/ + storage_path. An image that has not
//     been downloaded (storage_path NULL) has no URL and is not listed.
//   * ONE assembly path. `partRecords(ids)` builds the records for a whole page of parts with
//     one query per table — never one per part — and `partRecord(part)` is that function called
//     with a single id. GET /v1/parts/{vendor}/{sku} and GET /v1/export therefore cannot drift:
//     the shape equality the export contract promises holds by construction (and is tested).
import { SPEC_BEARING, type DocClass } from "../../core/docClass.js";
import { query } from "../../store/db.js";
import { partKind } from "../../core/partKind.js";
import { badRequest } from "../errors.js";
import { ALL_STATES, RENDERED_STATES, factRunSucceeded, isoOf, type FactState, type PartIdentity } from "./shared.js";

export function parseStates(raw: string | undefined): FactState[] {
  if (raw === undefined || raw === "") return [...RENDERED_STATES];
  if (raw === "all") return [...ALL_STATES];
  const out: FactState[] = [];
  for (const s of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (!(ALL_STATES as readonly string[]).includes(s)) throw badRequest(`unknown fact state "${s}" (expected all, or a comma list of ${ALL_STATES.join(", ")})`);
    out.push(s as FactState);
  }
  if (out.length === 0) throw badRequest("states must name at least one state");
  return out;
}

export type FactSource = { doc_id: string; url: string | null; locator: string | null; extracted_at: string | null };

export type FactItem = {
  key: string; label_en: string; label_de: string; type: string; value: unknown; unit: string | null;
  raw: string; state: string; tier: number; method: string; inherited: boolean; inherited_from: string | null;
  source: FactSource | null; evidence_count: number;
};

type FactRow = {
  id: number; part_id: number; field_key: string; label_en: string; label_de: string; type: string; value: unknown; unit: string | null;
  raw: string; state: string; tier: number; method: string; inherited: boolean; inherited_from: string | null;
  doc_id: string | null; doc_url: string | null; locator: string | null; extracted_at: string | null; evidence_count: number;
};

/** Current facts in `states` for every part in `partIds`, ordered by (part, key). One statement. */
async function factRows(partIds: number[], states: FactState[]): Promise<FactRow[]> {
  if (partIds.length === 0) return [];
  const { rows } = await query<FactRow>(`
    SELECT f.id, f.part_id, f.field_key, d.label_en, d.label_de, d.type, f.value, f.unit, f.raw, f.state::text AS state, f.tier, f.method,
           f.inherited, f.inherited_from, f.doc_id, sd.url AS doc_url, f.locator, f.extracted_at::text AS extracted_at,
           (SELECT count(*)::int FROM fact_evidence e WHERE e.fact_id = f.id) AS evidence_count
      FROM facts f
      JOIN field_dictionary d ON d.key = f.field_key
      LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.state::text = ANY($2::text[])
       AND ${factRunSucceeded("f")}
     ORDER BY f.part_id, f.field_key`, [partIds, states]);
  return rows;
}

function toFact(r: FactRow): FactItem {
  return {
    key: r.field_key, label_en: r.label_en, label_de: r.label_de, type: r.type, value: r.value, unit: r.unit,
    raw: r.raw, state: r.state, tier: r.tier, method: r.method, inherited: r.inherited, inherited_from: r.inherited_from,
    source: r.doc_id ? { doc_id: r.doc_id, url: r.doc_url, locator: r.locator, extracted_at: r.extracted_at } : null,
    evidence_count: r.evidence_count,
  };
}

export type RelationItem = { kind: string; sku: string; in_catalog: boolean; tier: number; source_url: string | null; note: string | null };
export type ImageVariant = { variant: string; url: string; width: number; height: number; bytes: number; format: string };
export type ImageItem = {
  role: string; url: string; width: number | null; height: number | null; alt_en: string | null; alt_de: string | null;
  variants: ImageVariant[];
};
/** `spec_bearing` says whether this document's CLASS can carry a specification at all. Without it
 *  a consumer looking at a part's sources cannot tell a datasheet from an end-of-life notice, and
 *  that is the exact confusion that made 18,977 hardware parts look like they had a datasheet when
 *  they had only an EoL notice (5 Sep 2026). `title` is the evidence the class was decided from. */
export type SourceItem = { doc_id: string; url: string; doc_type: string; title: string | null;
                           spec_bearing: boolean; fetched_at: string | null };
export type Completeness = { required_total: number; required_present: number; pct: number; missing: string[]; no_profile: boolean };
export type LifecycleFull = {
  status: string; announce_date: string | null; end_of_sale_date: string | null; last_ship_date: string | null;
  end_of_sw_maint: string | null; end_of_vuln_support: string | null; last_day_of_support: string | null;
  bulletin_id: string | null; successor_sku: string | null; successor_note: string | null; source_url: string | null;
  note: string | null; verified_at: string | null;
};

export type PartRecord = {
  vendor: string; sku: string; slug: string;
  category: { slug: string; name_en: string; name_de: string };
  series: string | null; family: string | null; product_class: string; name: string | null; description: string | null; datasheet_url: string | null;
  /** round-7 ask F (12 Sep 2026): the derived kind the category's profile gates on (partKind); null where the category derives none. */
  kind: string | null;
  lifecycle: LifecycleFull | null;
  facts: FactItem[]; relations: RelationItem[]; images: ImageItem[];
  completeness: Completeness | null; sources: SourceItem[];
  updated_at: string;
};

export const LIFECYCLE_COLUMNS = `
  l.status::text AS status, l.announce_date::text AS announce_date, l.end_of_sale_date::text AS end_of_sale_date,
  l.last_ship_date::text AS last_ship_date, l.end_of_sw_maint::text AS end_of_sw_maint,
  l.end_of_vuln_support::text AS end_of_vuln_support, l.last_day_of_support::text AS last_day_of_support,
  l.bulletin_id, l.successor_sku, l.successor_note, l.source_url, l.note, l.verified_at::text AS verified_at`;

export function imageUrl(publicBaseUrl: string, storagePath: string): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/img/${storagePath.replace(/^\/+/, "")}`;
}

// Every document a record draws on, for a whole page of parts: facts in the requested states,
// their evidence rows, lifecycle, relations, images and the document the name came from.
// (part_id, doc_id) pairs are UNIONed (deduplicated) and then joined to source_docs, which also
// drops the NULL doc_ids a tier-0 or unverified row may carry.
const SOURCES_SQL = `
  WITH refs AS (
    SELECT f.part_id, f.doc_id FROM facts f
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.state::text = ANY($2::text[])
       AND ${factRunSucceeded("f")}
    UNION SELECT f.part_id, e.doc_id FROM fact_evidence e JOIN facts f ON f.id = e.fact_id
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.state::text = ANY($2::text[])
       AND ${factRunSucceeded("f")}
    UNION SELECT l.part_id, l.doc_id FROM lifecycle l WHERE l.part_id = ANY($1::bigint[])
    UNION SELECT r.from_part_id, r.doc_id FROM relations r WHERE r.from_part_id = ANY($1::bigint[])
    UNION SELECT i.part_id, i.doc_id FROM images i WHERE i.part_id = ANY($1::bigint[])
    UNION SELECT p.id, p.name_doc_id FROM parts p WHERE p.id = ANY($1::bigint[]))
  SELECT refs.part_id, sd.doc_id, sd.url, sd.doc_type, sd.title, sd.fetched_at::text AS fetched_at
    FROM refs JOIN source_docs sd ON sd.doc_id = refs.doc_id
   ORDER BY refs.part_id, sd.doc_id`;

function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

type HeadRow = {
  id: number; vendor: string; sku: string; slug: string; cat_slug: string; name_en: string; name_de: string; series: string | null; family: string | null;
  product_class: string; name: string | null; description: string | null; datasheet_url: string | null; updated_at: Date;
} & { [K in keyof LifecycleFull]: LifecycleFull[K] | null };
type RelationRow = RelationItem & { part_id: number };
type ImageRow = { id: number; part_id: number; role: string; storage_path: string; width: number | null; height: number | null; alt_en: string | null; alt_de: string | null };
type VariantRow = { image_id: number; variant: string; storage_path: string; width: number; height: number; bytes: number; format: string };
type CompletenessRow = Completeness & { part_id: number };
type SourceRow = SourceItem & { part_id: number };

/**
 * Full records for `ids`, in the order given (an id that no longer exists is simply absent).
 * Seven statements for the whole page, whatever its size: no per-part round trip anywhere.
 */
export async function partRecords(ids: number[], states: FactState[], publicBaseUrl: string): Promise<PartRecord[]> {
  if (ids.length === 0) return [];
  // LIVE_PART EXEMPT: this loads parts BY ID, and the only route to an id is resolvePart, which
  // already prefers the live row and follows `retired_into`. A row that is still retired when
  // fetched by its own id is a real historical row and is served rather than 404'd; hiding it
  // here would make a direct id lookup lie in the other direction (tests/apiLiveParts.test.ts).
  const [heads, facts, relations, images, variants, completeness, sources] = await Promise.all([
    query<HeadRow>(`
      SELECT p.id, v.slug AS vendor, p.sku, p.slug, c.slug AS cat_slug, c.name_en, c.name_de, p.series, p.family, p.product_class::text AS product_class,
             p.name, p.description, p.datasheet_url, p.updated_at, ${LIFECYCLE_COLUMNS}
        FROM parts p
        JOIN vendors v ON v.id = p.vendor_id
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN lifecycle l ON l.part_id = p.id
       WHERE p.id = ANY($1::bigint[])`, [ids]),
    factRows(ids, states),
    query<RelationRow>(`
      SELECT r.from_part_id AS part_id, r.kind::text AS kind, r.to_sku AS sku, (r.to_part_id IS NOT NULL) AS in_catalog, r.tier, r.source_url, r.note
        FROM relations r WHERE r.from_part_id = ANY($1::bigint[]) ORDER BY r.from_part_id, r.kind, r.to_sku`, [ids]),
    query<ImageRow>(`
      SELECT i.id, i.part_id, i.role, i.storage_path, i.width, i.height, i.alt_en, i.alt_de
        FROM images i WHERE i.part_id = ANY($1::bigint[]) AND i.storage_path IS NOT NULL
       ORDER BY i.part_id, (i.role = 'primary') DESC, i.role, i.id`, [ids]),
    query<VariantRow>(`
      SELECT iv.image_id, iv.variant, iv.storage_path, iv.width, iv.height, iv.bytes, iv.format
        FROM image_variants iv JOIN images i ON i.id = iv.image_id
       WHERE i.part_id = ANY($1::bigint[]) ORDER BY iv.width DESC, iv.id`, [ids]),
    query<CompletenessRow>(`
      SELECT part_id, required_total, required_present, pct, missing, no_profile FROM completeness WHERE part_id = ANY($1::bigint[])`, [ids]),
    query<SourceRow>(SOURCES_SQL, [ids, states]),
  ]);

  const factsBy = groupBy(facts, (r) => r.part_id);
  const relationsBy = groupBy(relations.rows, (r) => r.part_id);
  const imagesBy = groupBy(images.rows, (r) => r.part_id);
  const variantsBy = groupBy(variants.rows, (r) => r.image_id);
  const sourcesBy = groupBy(sources.rows, (r) => r.part_id);
  const completenessBy = new Map(completeness.rows.map((r) => [r.part_id, r] as const));
  const headsBy = new Map(heads.rows.map((h) => [h.id, h] as const));

  const out: PartRecord[] = [];
  for (const id of ids) {
    const h = headsBy.get(id);
    if (!h) continue;
    const lifecycle: LifecycleFull | null = h.status === null ? null : {
      status: h.status, announce_date: h.announce_date, end_of_sale_date: h.end_of_sale_date, last_ship_date: h.last_ship_date,
      end_of_sw_maint: h.end_of_sw_maint, end_of_vuln_support: h.end_of_vuln_support, last_day_of_support: h.last_day_of_support,
      bulletin_id: h.bulletin_id, successor_sku: h.successor_sku, successor_note: h.successor_note, source_url: h.source_url,
      note: h.note, verified_at: h.verified_at,
    };
    const cp = completenessBy.get(id);
    out.push({
      vendor: h.vendor, sku: h.sku, slug: h.slug,
      category: { slug: h.cat_slug, name_en: h.name_en, name_de: h.name_de },
      series: h.series, family: h.family, product_class: h.product_class, name: h.name, description: h.description, datasheet_url: h.datasheet_url,
      // The same call /v1/parts items and the ledger builder make, WITH the name: a UCS programme SKU's kind is read
      // from its name (bundleFamily.ts), so a caller that dropped it would report a different kind here.
      kind: partKind(h.cat_slug, h.sku, h.name ?? undefined) ?? null,
      lifecycle,
      facts: (factsBy.get(id) ?? []).map(toFact),
      relations: (relationsBy.get(id) ?? []).map((r) => ({ kind: r.kind, sku: r.sku, in_catalog: r.in_catalog, tier: r.tier, source_url: r.source_url, note: r.note })),
      images: (imagesBy.get(id) ?? []).map((i) => ({
        role: i.role, url: imageUrl(publicBaseUrl, i.storage_path), width: i.width, height: i.height, alt_en: i.alt_en, alt_de: i.alt_de,
        variants: (variantsBy.get(i.id) ?? []).map((v) => ({
          variant: v.variant, url: imageUrl(publicBaseUrl, v.storage_path), width: v.width, height: v.height, bytes: v.bytes, format: v.format,
        })),
      })),
      completeness: cp ? { required_total: cp.required_total, required_present: cp.required_present, pct: cp.pct, missing: cp.missing, no_profile: cp.no_profile } : null,
      sources: (sourcesBy.get(id) ?? []).map((s) => ({
        doc_id: s.doc_id, url: s.url, doc_type: s.doc_type, title: s.title,
        spec_bearing: SPEC_BEARING.has(s.doc_type as DocClass), fetched_at: s.fetched_at,
      })),
      updated_at: isoOf(h.updated_at) as string,
    });
  }
  return out;
}

export async function partRecord(part: PartIdentity, states: FactState[], publicBaseUrl: string): Promise<PartRecord> {
  const [record] = await partRecords([part.id], states, publicBaseUrl);
  if (!record) throw new Error(`part ${part.id} vanished between lookup and load`);
  return record;
}

// ---- /facts -------------------------------------------------------------------------------------

export type Evidence = { doc_id: string | null; url: string | null; locator: string | null; tier: number; method: string; extracted_at: string | null };
export type FactWithEvidence = FactItem & { evidence: Evidence[] };

export async function partFacts(part: PartIdentity, states: FactState[]): Promise<FactWithEvidence[]> {
  const rows = await factRows([part.id], states);
  if (rows.length === 0) return [];
  const ev = await query<Evidence & { fact_id: number }>(`
    SELECT e.fact_id, e.doc_id, sd.url, e.locator, e.tier, e.method, e.extracted_at::text AS extracted_at
      FROM fact_evidence e LEFT JOIN source_docs sd ON sd.doc_id = e.doc_id
     WHERE e.fact_id = ANY($1::bigint[]) ORDER BY e.tier, e.id`, [rows.map((r) => r.id)]);
  const byFact = new Map<number, Evidence[]>();
  for (const e of ev.rows) {
    const list = byFact.get(e.fact_id) ?? [];
    list.push({ doc_id: e.doc_id, url: e.url, locator: e.locator, tier: e.tier, method: e.method, extracted_at: e.extracted_at });
    byFact.set(e.fact_id, list);
  }
  return rows.map((r) => ({ ...toFact(r), evidence: byFact.get(r.id) ?? [] }));
}

// ---- /history -----------------------------------------------------------------------------------

export type HistoryItem = { key: string; value: unknown; unit: string | null; state: string; superseded_at: string | null; superseded_by_value: unknown };

export async function partHistory(part: PartIdentity): Promise<HistoryItem[]> {
  const { rows } = await query<{ key: string; value: unknown; unit: string | null; state: string; superseded_at: Date | null; superseded_by_value: unknown }>(`
    SELECT f.field_key AS key, f.value, f.unit, f.state::text AS state, f.superseded_at, n.value AS superseded_by_value
      FROM facts f LEFT JOIN facts n ON n.id = f.superseded_by
     WHERE f.part_id = $1 AND f.superseded_by IS NOT NULL
     ORDER BY f.superseded_at DESC NULLS LAST, f.id DESC`, [part.id]);
  return rows.map((r) => ({ ...r, superseded_at: isoOf(r.superseded_at) }));
}

// ---- /conflicts ---------------------------------------------------------------------------------

export type ConflictItem = { key: string; kept: unknown; rejected: unknown; reason: string; kept_evidence: unknown; rejected_evidence: unknown; logged_at: string };

export async function partConflicts(part: PartIdentity): Promise<ConflictItem[]> {
  const { rows } = await query<Omit<ConflictItem, "logged_at"> & { logged_at: Date }>(`
    SELECT c.field_key AS key, c.kept, c.rejected, c.reason, c.kept_evidence, c.rejected_evidence, c.logged_at
      FROM conflicts c WHERE c.part_id = $1 AND c.resolved_at IS NULL
     ORDER BY c.logged_at DESC, c.id DESC`, [part.id]);
  return rows.map((r) => ({ ...r, logged_at: isoOf(r.logged_at) as string }));
}
