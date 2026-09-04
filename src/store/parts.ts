// src/store/parts.ts — part identity: vendor, SKU exactly as the vendor writes it, category,
// family, product class, the vendor's own name and description. Nothing else lives here
// (docs/ARCHITECTURE.md "What a part is"); everything known ABOUT a part is a fact row.
//
// Rules this module enforces:
//   * A SKU is stored exactly as written ("C9200L-24P-4G=" and "C9200L-24P-4G" are two parts);
//     LOOKUPS are case-insensitive via sku_norm, but the exact SKU is tried first so an
//     exact-case hit always wins over a same-letters neighbour.
//   * upsertPart never blanks and, by default, never overwrites: an existing non-NULL column is
//     kept and only NULL columns are filled, so an enumeration that knows less than a datasheet
//     cannot erase what the datasheet said. {force: true} lets provided values win — but an
//     absent (undefined/null) input still never blanks a filled column.
//   * A category slug must already exist. Refusing rather than auto-creating is the rule: 23
//     categories are seeded and every one has a profile decision; an unknown slug is a bug in
//     the caller, surfaced with the slug in the message.
//   * Slugs are unique per vendor by construction (-2, -3 … suffixes), so "ABC" and "ABC=" do
//     not fight over "abc".
import { getPool } from "./db.js";
import type { Queryable } from "./runs.js";

export type ProductClass = "hardware" | "license" | "service" | "software" | "accessory" | "bundle" | "unknown";

export type PartRow = {
  id: number;
  vendor_id: number;
  sku: string;
  sku_norm: string;
  slug: string;
  category_id: number;
  family: string | null;
  product_class: ProductClass;
  product_class_reason: string | null;
  name: string | null;
  description: string | null;
  name_doc_id: string | null;
  datasheet_url: string | null;
  first_seen_source: string | null;
  enumerated_at: string | null;
  review_tier: number | null;
  created_at: Date;
  updated_at: Date;
};

const PART_COLUMNS = `id, vendor_id, sku, sku_norm, slug, category_id, family, product_class, product_class_reason,
  name, description, name_doc_id, datasheet_url, first_seen_source, enumerated_at::text AS enumerated_at,
  review_tier, created_at, updated_at`;

export function slugify(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "part";
}

export async function ensureVendor(slug: string, name?: string, db: Queryable = getPool()): Promise<number> {
  const found = await db.query<{ id: number }>("SELECT id FROM vendors WHERE slug = $1", [slug]);
  if (found.rows[0]) return found.rows[0].id;
  const ins = await db.query<{ id: number }>(
    "INSERT INTO vendors (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id",
    [slug, name ?? slug],
  );
  return ins.rows[0].id;
}

/** Category ids for known slugs. Throws, naming the slug, for anything else. */
export async function ensureCategory(slug: string, db: Queryable = getPool()): Promise<number> {
  const r = await db.query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug]);
  if (!r.rows[0]) throw new Error(`unknown category "${slug}": categories are seeded by migration, add it there before importing parts into it`);
  return r.rows[0].id;
}

/** Exact SKU first, then case-insensitive via sku_norm. Returns the row (with the vendor's exact SKU) or null. */
export async function findPart(vendorSlug: string, sku: string, db: Queryable = getPool()): Promise<PartRow | null> {
  const exact = await db.query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND sku = $2`,
    [vendorSlug, sku],
  );
  if (exact.rows[0]) return exact.rows[0];
  const ci = await db.query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND sku_norm = upper($2)
      ORDER BY sku LIMIT 1`,
    [vendorSlug, sku],
  );
  return ci.rows[0] ?? null;
}

// The same column list under the `p` alias for the joined lookups below. DERIVED, not retyped:
// a second hand-maintained copy would drift the first time a column is added (CLAUDE.md §10).
const PART_COLUMNS_P = PART_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ");

/** A candidate part with the vendor slug the caller needs to NAME it in a refusal. */
export type PartCandidate = PartRow & { vendor_slug: string };
export type AliasCandidate = PartCandidate & { alias_kind: string; alias_value: string };

/**
 * EVERY part whose SKU folds to `sku`, not the first one. `findPart` above has to return a part,
 * so its case-insensitive arm ends in `ORDER BY sku LIMIT 1` — with 127 same-vendor pairs in
 * production differing only by case (`A9K-DDOS-10U20G=` / `A9k-DDoS-10U20G=`), that arm silently
 * picks one of two real rows. A caller that must REFUSE an ambiguous SKU rather than pick needs
 * the whole candidate set, which is what this returns; findPart is untouched.
 *
 * `vendorSlug` null searches the whole catalogue. That is not a loosening: a SKU carried by
 * exactly one part is unambiguous, and a SKU carried by two vendors (Arista and Cisco both sell
 * SFP-10G-ER) comes back as two rows for the caller to refuse — never as a tie to break.
 */
export async function partsBySkuNorm(sku: string, vendorSlug: string | null, db: Queryable = getPool()): Promise<PartCandidate[]> {
  const r = await db.query<PartCandidate>(
    `SELECT ${PART_COLUMNS_P}, v.slug AS vendor_slug
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.sku_norm = upper($1) AND ($2::text IS NULL OR v.slug = $2)
      ORDER BY p.sku, v.slug`,
    [sku, vendorSlug],
  );
  return r.rows;
}

/**
 * Every part that carries `value` as a part_aliases row (case-insensitively), one row per part
 * with the alias kind that reached it. The lowest tier wins when a part holds the same value
 * under several kinds — an alias from a vendor page outranks one a distributor printed.
 */
export async function partsByAliasValue(value: string, vendorSlug: string | null, db: Queryable = getPool()): Promise<AliasCandidate[]> {
  const r = await db.query<AliasCandidate>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id) ${PART_COLUMNS_P}, v.slug AS vendor_slug, a.kind AS alias_kind, a.value AS alias_value
         FROM part_aliases a
         JOIN parts p   ON p.id = a.part_id
         JOIN vendors v ON v.id = p.vendor_id
        WHERE upper(a.value) = upper($1) AND ($2::text IS NULL OR v.slug = $2)
        ORDER BY p.id, a.tier, a.id
     ) t ORDER BY t.sku, t.vendor_slug`,
    [value, vendorSlug],
  );
  return r.rows;
}

export async function getPart(id: number, db: Queryable = getPool()): Promise<PartRow | null> {
  const r = await db.query<PartRow>(`SELECT ${PART_COLUMNS} FROM parts WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export type PartInput = {
  vendor: string;                 // vendor slug; created with ensureVendor if absent
  sku: string;
  slug?: string;                  // defaults to slugify(sku), made unique per vendor
  category: string;               // category slug; must exist
  family?: string | null;
  product_class?: ProductClass | null;
  product_class_reason?: string | null;
  name?: string | null;
  description?: string | null;
  name_doc_id?: string | null;
  datasheet_url?: string | null;
  first_seen_source?: string | null;
  enumerated_at?: string | null;  // YYYY-MM-DD
  review_tier?: number | null;
};

async function uniqueSlug(vendorId: number, base: string, db: Queryable): Promise<string> {
  const taken = await db.query<{ slug: string }>(
    "SELECT slug FROM parts WHERE vendor_id = $1 AND (slug = $2 OR slug LIKE $2 || '-%')",
    [vendorId, base],
  );
  const set = new Set(taken.rows.map((r) => r.slug));
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`;
    if (!set.has(cand)) return cand;
  }
}

/**
 * Insert or fill a part. Default mode fills NULL columns only; {force: true} lets every
 * provided (non-null) value overwrite. product_class 'unknown' is the default, not knowledge,
 * so the default mode treats it as fillable. category_id is NOT NULL and therefore only moves
 * under force. The slug of an existing part is never changed unless force provides one.
 */
export async function upsertPart(
  input: PartInput,
  opts: { force?: boolean; db?: Queryable } = {},
): Promise<{ id: number; created: boolean; sku: string; slug: string }> {
  const db = opts.db ?? getPool();
  const force = opts.force === true;
  const vendorId = await ensureVendor(input.vendor, undefined, db);
  const categoryId = await ensureCategory(input.category, db);

  const existing = await db.query<{ id: number; slug: string }>(
    "SELECT id, slug FROM parts WHERE vendor_id = $1 AND sku = $2", [vendorId, input.sku]);
  const slug = existing.rows[0]
    ? (force && input.slug ? input.slug : existing.rows[0].slug)
    : await uniqueSlug(vendorId, input.slug ? slugify(input.slug) : slugify(input.sku), db);

  // fill = keep what is there, take the new value only where nothing is stored
  // force = take the new value when one was given, keep what is there otherwise (never blank)
  const col = (c: string) => force ? `COALESCE(EXCLUDED.${c}, parts.${c})` : `COALESCE(parts.${c}, EXCLUDED.${c})`;
  const classExpr = force
    ? "COALESCE(EXCLUDED.product_class, parts.product_class)"
    : "CASE WHEN parts.product_class = 'unknown' THEN EXCLUDED.product_class ELSE parts.product_class END";

  const r = await db.query<{ id: number; created: boolean; sku: string; slug: string }>(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name, description,
                        name_doc_id, datasheet_url, first_seen_source, enumerated_at, review_tier)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::product_class, 'unknown'), $7, $8, $9, $10, $11, $12, $13::date, $14)
     ON CONFLICT (vendor_id, sku) DO UPDATE SET
       slug                 = ${force ? "EXCLUDED.slug" : "parts.slug"},
       category_id          = ${force ? "EXCLUDED.category_id" : "parts.category_id"},
       family               = ${col("family")},
       product_class        = ${classExpr},
       product_class_reason = ${col("product_class_reason")},
       name                 = ${col("name")},
       description          = ${col("description")},
       name_doc_id          = ${col("name_doc_id")},
       datasheet_url        = ${col("datasheet_url")},
       first_seen_source    = ${col("first_seen_source")},
       enumerated_at        = ${col("enumerated_at")},
       review_tier          = ${col("review_tier")}
     RETURNING id, (xmax = 0) AS created, sku, slug`,
    [vendorId, input.sku, slug, categoryId, input.family ?? null, input.product_class ?? null,
      input.product_class_reason ?? null, input.name ?? null, input.description ?? null, input.name_doc_id ?? null,
      input.datasheet_url ?? null, input.first_seen_source ?? null, input.enumerated_at ?? null, input.review_tier ?? null],
  );
  return r.rows[0];
}
