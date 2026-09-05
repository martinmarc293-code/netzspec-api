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
//   * IDENTITY IS CASE-INSENSITIVE PER VENDOR (migration 0010). Storage keeps the vendor's exact
//     spelling; two rows whose SKUs differ only by case are ONE part and the second one is
//     refused. Before that index existed, `upsertPart` looked up `WHERE sku = $2` — the exact
//     string — so an enumeration that spelled a PID `A9k-DDoS-10U20G=` inserted a SECOND row next
//     to the catalogue's `A9K-DDOS-10U20G=`, 127 times, silently. Every lookup here now folds
//     case, and `upsertPart` FILLS the row that already exists instead of creating its twin.
//   * A RETIRED row is not an identity any more (migration 0009). It keeps its SKU, its facts and
//     its history — a page really did print that string — but it never comes back from a SKU or
//     alias lookup, and a lookup that lands on one follows `retired_into` to the survivor.
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
  /** set when this row stopped being an identity (migration 0009); the row itself is never deleted */
  retired_at: Date | null;
  /** the part that absorbed it, NULL when nothing did (a foreign part number has no survivor) */
  retired_into: number | null;
  retired_reason: string | null;
};

const PART_COLUMNS = `id, vendor_id, sku, sku_norm, slug, category_id, family, product_class, product_class_reason,
  name, description, name_doc_id, datasheet_url, first_seen_source, enumerated_at::text AS enumerated_at,
  review_tier, created_at, updated_at, retired_at, retired_into, retired_reason`;

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

/**
 * Exact SKU first, then case-insensitive via sku_norm. Returns the row (with the vendor's exact
 * SKU) or null.
 *
 * A RETIRED row is never the answer. Landing on one is not a miss — the caller asked with a real
 * string that a real page printed — so the lookup follows `retired_into` and returns the survivor;
 * a retired row with no survivor (a foreign part number) returns null, which is the truthful
 * answer to "which part is this". Both arms exclude retired rows before ordering, so the
 * `ORDER BY sku LIMIT 1` in the second arm no longer has 127 case pairs to pick between.
 */
export async function findPart(vendorSlug: string, sku: string, db: Queryable = getPool()): Promise<PartRow | null> {
  const exact = await db.query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND sku = $2`,
    [vendorSlug, sku],
  );
  if (exact.rows[0]) return exact.rows[0].retired_at ? await survivorOf(exact.rows[0], db) : exact.rows[0];
  const ci = await db.query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND sku_norm = upper($2)
        AND retired_at IS NULL
      ORDER BY sku LIMIT 1`,
    [vendorSlug, sku],
  );
  if (ci.rows[0]) return ci.rows[0];
  // nothing live folds to it: the only rows left are retired ones, and one of them may point home
  const dead = await db.query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND sku_norm = upper($2)
        AND retired_into IS NOT NULL
      ORDER BY sku LIMIT 1`,
    [vendorSlug, sku],
  );
  return dead.rows[0] ? await survivorOf(dead.rows[0], db) : null;
}

/**
 * The live part a retired row points at, or null. One hop only: `retired_into` may never chain,
 * because a merge always targets a LIVE survivor and retiring a survivor afterwards would leave
 * the rows it absorbed pointing at a dead end. The single hop is therefore the whole answer, and
 * a second retired row on the other side is a bug worth returning null for rather than looping.
 */
async function survivorOf(row: PartRow, db: Queryable): Promise<PartRow | null> {
  if (row.retired_into == null) return null;
  const r = await db.query<PartRow>(`SELECT ${PART_COLUMNS} FROM parts WHERE id = $1 AND retired_at IS NULL`, [row.retired_into]);
  return r.rows[0] ?? null;
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
 *
 * RETIRED ROWS ARE EXCLUDED, and that is the point of them being retired: the 127 same-vendor case
 * pairs were the largest source of "ambiguous, refused" in this function, and a merge that left
 * the loser visible here would have fixed nothing. The loser's exact spelling reaches the survivor
 * through its `case_variant` alias instead (partsByAliasValue below).
 */
export async function partsBySkuNorm(sku: string, vendorSlug: string | null, db: Queryable = getPool()): Promise<PartCandidate[]> {
  const r = await db.query<PartCandidate>(
    `SELECT ${PART_COLUMNS_P}, v.slug AS vendor_slug
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.sku_norm = upper($1) AND p.retired_at IS NULL AND ($2::text IS NULL OR v.slug = $2)
      ORDER BY p.sku, v.slug`,
    [sku, vendorSlug],
  );
  return r.rows;
}

/**
 * Every part that carries `value` as a part_aliases row (case-insensitively), one row per part
 * with the alias kind that reached it. The lowest tier wins when a part holds the same value
 * under several kinds — an alias from a vendor page outranks one a distributor printed.
 *
 * Retired parts are excluded here for the same reason as in partsBySkuNorm: a retired row's own
 * aliases would re-introduce the ambiguity the retirement removed. A merge moves the loser's
 * aliases onto the survivor, so nothing an alias could reach is lost by the exclusion.
 */
export async function partsByAliasValue(value: string, vendorSlug: string | null, db: Queryable = getPool()): Promise<AliasCandidate[]> {
  const r = await db.query<AliasCandidate>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id) ${PART_COLUMNS_P}, v.slug AS vendor_slug, a.kind AS alias_kind, a.value AS alias_value
         FROM part_aliases a
         JOIN parts p   ON p.id = a.part_id
         JOIN vendors v ON v.id = p.vendor_id
        WHERE upper(a.value) = upper($1) AND p.retired_at IS NULL AND ($2::text IS NULL OR v.slug = $2)
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

export type UpsertPartResult = {
  id: number;
  created: boolean;
  sku: string;
  slug: string;
  /** the input's spelling differed in case from the row it filled; the stored SKU did not change */
  case_folded?: boolean;
  /** the SKU resolves only to a retired row with no survivor: NOTHING was written */
  retired?: { reason: string };
};

/**
 * Insert or fill a part. Default mode fills NULL columns only; {force: true} lets every
 * provided (non-null) value overwrite. product_class 'unknown' is the default, not knowledge,
 * so the default mode treats it as fillable. category_id is NOT NULL and therefore only moves
 * under force. The slug of an existing part is never changed unless force provides one.
 *
 * IDENTITY IS RESOLVED CASE-INSENSITIVELY FIRST, and that is the fix for how 127 duplicate rows
 * got in. The old lookup was `WHERE sku = $2`, so `A9k-DDoS-10U20G=` missed the catalogue's
 * `A9K-DDOS-10U20G=` and the INSERT created its twin. Now the row is resolved by case fold, and
 * the write is aimed at THAT ROW'S EXACT SKU — the one statement below is unchanged, it simply
 * conflicts on the row that already exists. The stored spelling is never rewritten: the vendor's
 * own string is the identity, and a differently-cased mention is evidence about it, not a
 * correction of it (`ingest hygiene case-duplicates` records the other spelling as a
 * `case_variant` alias).
 *
 * A retired row is never filled. When the SKU resolves only to one, the survivor it merged into
 * is filled instead; when there is no survivor (a foreign part number, retired as
 * `not_a_cisco_part`) NOTHING is written and the result says `retired` with the reason — a
 * scraper naming it again must not resurrect it, and must not do so silently either.
 */
export async function upsertPart(
  input: PartInput,
  opts: { force?: boolean; db?: Queryable } = {},
): Promise<UpsertPartResult> {
  const db = opts.db ?? getPool();
  const force = opts.force === true;
  const vendorId = await ensureVendor(input.vendor, undefined, db);
  const categoryId = await ensureCategory(input.category, db);

  type Resolved = { id: number; sku: string; slug: string; retired_at: Date | null; retired_into: number | null; retired_reason: string | null };
  // live before retired, the exact spelling before a case neighbour, then `sku` so the choice is
  // deterministic while duplicates still exist (they do, until the hygiene merge has run)
  const found = await db.query<Resolved>(
    `SELECT id, sku, slug, retired_at, retired_into, retired_reason FROM parts
      WHERE vendor_id = $1 AND (sku = $2 OR sku_norm = upper($2))
      ORDER BY (retired_at IS NOT NULL), (sku <> $2), sku LIMIT 1`,
    [vendorId, input.sku]);
  let existing: Resolved | null = found.rows[0] ?? null;
  if (existing?.retired_at) {
    if (existing.retired_into == null) {
      return { id: existing.id, created: false, sku: existing.sku, slug: existing.slug, retired: { reason: existing.retired_reason ?? "unknown" } };
    }
    const s = await db.query<Resolved>(
      "SELECT id, sku, slug, retired_at, retired_into, retired_reason FROM parts WHERE id = $1 AND retired_at IS NULL",
      [existing.retired_into]);
    if (!s.rows[0]) throw new Error(`upsertPart: "${input.sku}" is retired into part ${existing.retired_into}, which is not a live part`);
    existing = s.rows[0];
  }
  const caseFolded = existing != null && existing.sku !== input.sku;
  // aim the write at the row that already exists: the ON CONFLICT (vendor_id, sku) below then
  // fires on it instead of inserting a case twin
  const sku = existing ? existing.sku : input.sku;
  const slug = existing
    ? (force && input.slug ? input.slug : existing.slug)
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
    [vendorId, sku, slug, categoryId, input.family ?? null, input.product_class ?? null,
      input.product_class_reason ?? null, input.name ?? null, input.description ?? null, input.name_doc_id ?? null,
      input.datasheet_url ?? null, input.first_seen_source ?? null, input.enumerated_at ?? null, input.review_tier ?? null],
  ).catch((e: unknown) => {
    // the case-fold resolution above should make this unreachable; a concurrent writer can still
    // lose the race, and "duplicate key value violates unique constraint" names no SKU
    const err = e as { code?: string; constraint?: string };
    if (err.code === "23505" && err.constraint === "parts_vendor_sku_ci_uq") {
      throw new Error(`upsertPart: "${input.sku}" collides case-insensitively with a live part of vendor "${input.vendor}" (parts_vendor_sku_ci_uq); resolve it with \`ingest hygiene case-duplicates\``);
    }
    throw e;
  });
  return caseFolded ? { ...r.rows[0], case_folded: true } : r.rows[0];
}

// -------------------------------------------------------------------------------------------------
// hygiene: retirement and the identity aliases that survive it
// -------------------------------------------------------------------------------------------------

/**
 * The alias kinds `ingest hygiene` writes. They are identity, not specs, which is why they live
 * next to `parts` rather than in the fact graph:
 *   case_variant  the exact spelling of a merged case duplicate (`A9k-DDoS-10U20G=`), so a page
 *                 that printed it still resolves to the survivor after the merge.
 *   hw_variant    the Meraki base/`-HW` pair (`MR44` / `MR44-HW`), linked BOTH WAYS. These are two
 *                 orderable PIDs and are never merged; the link is what lets apply-acquired reach
 *                 either from either — 179 meraki entries matched 0 parts because the pages say
 *                 `MR44` and the catalogue holds `MR44-HW`.
 * The DB CHECK on part_aliases.kind (migration 0009) is the enforcement; this list is the code's
 * copy of it and tests/db/hygiene.test.ts compares the two so they cannot drift.
 */
export const HYGIENE_ALIAS_KINDS = ["case_variant", "hw_variant"] as const;
export type HygieneAliasKind = (typeof HYGIENE_ALIAS_KINDS)[number];

/**
 * Record `value` as another spelling of `partId`. Returns what it did, never a bare boolean:
 *   "created"  the row is new
 *   "kind"     the part already carries this value under ANOTHER kind (14 of the 126 `-HW` pairs
 *              already had a `variant_sku` row). Resolution matches on the VALUE and ignores the
 *              kind, so a second row would add no reach and only split the provenance — skipped.
 *   "exists"   the same (part, kind, value) row is already there; re-running is a no-op.
 *
 * tier 2 with no document: the value is the vendor's own spelling, read out of the vendor's own
 * catalogue rows — the same tier the 14 pre-existing `variant_sku` rows carry — and the run id is
 * the provenance. It is deliberately not tier 0: no operator looked at it.
 */
export async function linkSkuVariant(
  partId: number, kind: HygieneAliasKind, value: string, runId: number, db: Queryable = getPool(),
): Promise<"created" | "kind" | "exists"> {
  const v = value.trim();
  if (!v) throw new Error(`linkSkuVariant: empty ${kind} value for part ${partId}`);
  const other = await db.query<{ kind: string }>(
    "SELECT kind FROM part_aliases WHERE part_id = $1 AND upper(value) = upper($2)", [partId, v]);
  if (other.rows.some((r) => r.kind === kind)) return "exists";
  if (other.rows.length) return "kind";
  const r = await db.query(
    `INSERT INTO part_aliases (part_id, kind, value, tier, run_id) VALUES ($1, $2, $3, 2, $4)
     ON CONFLICT (part_id, kind, value) DO NOTHING`, [partId, kind, v, runId]);
  return r.rowCount ? "created" : "exists";
}

/**
 * Retire a part: it stops being an identity, it is not deleted. `into` is the part that absorbed
 * it, or null when nothing did. Refuses rather than writing a row that cannot be explained —
 * a retirement with no reason is the silent skip this repo keeps paying for — and refuses to
 * retire a part into itself or into a part that is itself retired, which would leave every row
 * that followed the pointer at a dead end.
 */
export async function retirePart(
  partId: number, opts: { into: number | null; reason: string; runId: number }, db: Queryable = getPool(),
): Promise<void> {
  if (!opts.reason.trim()) throw new Error(`retirePart: part ${partId} needs a reason`);
  if (opts.into === partId) throw new Error(`retirePart: part ${partId} cannot be retired into itself`);
  if (opts.into != null) {
    const s = await db.query("SELECT 1 FROM parts WHERE id = $1 AND retired_at IS NULL", [opts.into]);
    if (!s.rowCount) throw new Error(`retirePart: part ${partId} cannot be retired into ${opts.into}, which is not a live part`);
  }
  const r = await db.query(
    `UPDATE parts SET retired_at = now(), retired_into = $2, retired_reason = $3, retired_run_id = $4
      WHERE id = $1 AND retired_at IS NULL`,
    [partId, opts.into, opts.reason, opts.runId]);
  if (!r.rowCount) throw new Error(`retirePart: part ${partId} does not exist or is already retired`);
}
