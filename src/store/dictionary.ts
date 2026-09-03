// src/store/dictionary.ts — the vocabulary in code becomes the vocabulary in the database.
//
// facts.field_key is a foreign key to field_dictionary (docs/ARCHITECTURE.md rule 2): a key the
// database has never heard of cannot be stored. Keys are DEFINED in src/core/fieldSchema.ts
// (hand-written) and src/core/fieldSchema.generated.ts (derived from real labels); the database
// copy is derived from code, never edited by hand, and this module is its only writer.
//
// Rules it enforces:
//   * NEVER delete. A key that vanished from code may still be referenced by facts, conflicts,
//     source_fields and profiles; deleting it would either fail on the FK or, worse, cascade the
//     facts away. Such keys are returned as `orphaned`, printed, and left where they are.
//   * Idempotent. The upsert touches only rows whose stored definition differs (IS DISTINCT FROM
//     over the whole tuple), so a second run reports inserted 0 / updated 0 and bumps no
//     updated_at. A sync that rewrote every row every night would make updated_at meaningless.
//   * All or nothing, and refuse before the first write. Dictionary and profiles go in one
//     transaction; a category in code that the categories table lacks, a profile key the
//     dictionary lacks, or a field with no label aborts the sync naming the offender — a profile
//     silently skipped is exactly the `continue` the old pipeline had.
//   * Labels come from the FieldDef (the source). FIELD_LABELS is a generated copy covering only
//     the hand-written half; it is a fallback, and any disagreement is reported as label_drift,
//     not resolved here.
//
// Not representable in the table, so not synced: UNIT_OVERRIDES / DOMAIN_OVERRIDES (transceiver
// weight in grams, optic form factors). field_dictionary has one unit and one domain per key;
// the per-category override lives in fieldSchema.ts and consumers read it from there.
import { FIELD_DICTIONARY, PROFILES, type FieldDef, type Requirement } from "../core/fieldSchema.js";
import { GENERATED_FIELDS, GENERATED_PROFILES } from "../core/fieldSchema.generated.js";
import { FIELD_LABELS } from "../core/fieldLabels.generated.js";
import { withTx } from "./db.js";
import type { Queryable } from "./runs.js";

export type DictionaryRow = {
  key: string;
  type: string;
  unit: string | null;
  label_en: string;
  label_de: string;
  domain: string[] | null;
  band: [number, number] | null;
  shape: string | null;
  etim: string[] | null;
  generated: boolean;
};

export type ProfileRow = { category: string; field_key: string; requirement: Requirement };

export type DictionarySyncResult = {
  /** dictionary keys */
  inserted: number;
  updated: number;
  unchanged: number;
  /** (category, field) requirement rows in code, all of which are now in the database */
  profiles: number;
  profiles_inserted: number;
  profiles_updated: number;
  /** keys in the database that are no longer in code — kept, never deleted */
  orphaned: string[];
  /** "category/field" profile rows in the database that are no longer in code — kept */
  profiles_orphaned: string[];
  /** keys where FIELD_LABELS disagrees with the FieldDef */
  label_drift: string[];
};

function toRow(key: string, def: FieldDef): DictionaryRow {
  const lab = FIELD_LABELS[key];
  return {
    key,
    type: def.type,
    unit: def.unit ?? lab?.unit ?? null,
    label_en: def.en || lab?.en || "",
    label_de: def.de || lab?.de || "",
    domain: def.domain ?? null,
    band: def.band ?? null,
    shape: def.shape ?? null,
    etim: def.etim ?? null,
    generated: GENERATED_FIELDS[key] === def,
  };
}

/** Every field the code knows, as the row the database should hold. Pure; the tests use it too.
 *  GENERATED_FIELDS is merged into FIELD_DICTIONARY at import time with hand-written winning, so
 *  the second loop only matters if that merge ever stops — a generated key is never a second row. */
export function dictionaryRows(): DictionaryRow[] {
  const rows = new Map<string, DictionaryRow>();
  for (const [key, def] of Object.entries(FIELD_DICTIONARY)) rows.set(key, toRow(key, def));
  for (const [key, def] of Object.entries(GENERATED_FIELDS)) if (!rows.has(key)) rows.set(key, toRow(key, def));
  return [...rows.values()];
}

/** Every (category, field) requirement in code. Same merge logic: PROFILES already carries the
 *  generated profiles; GENERATED_PROFILES is walked for categories the merge might have missed. */
export function profileRows(): ProfileRow[] {
  const out = new Map<string, ProfileRow>();
  const add = (category: string, fields: Record<string, Requirement>) => {
    for (const [field_key, requirement] of Object.entries(fields)) {
      const id = `${category}/${field_key}`;
      if (!out.has(id)) out.set(id, { category, field_key, requirement });
    }
  };
  for (const [cat, fields] of Object.entries(PROFILES)) add(cat, fields);
  for (const [cat, fields] of Object.entries(GENERATED_PROFILES)) add(cat, fields);
  return [...out.values()];
}

/** Which keys FIELD_LABELS renders differently from the FieldDef. Reported, never resolved. */
export function labelDrift(): string[] {
  return Object.entries(FIELD_DICTIONARY)
    .filter(([key, def]) => FIELD_LABELS[key] && (FIELD_LABELS[key].en !== def.en || FIELD_LABELS[key].de !== def.de))
    .map(([key]) => key);
}

const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

const DICT_UPSERT = `
  INSERT INTO field_dictionary (key, type, unit, label_en, label_de, domain, band, shape, etim, generated, updated_at)
  SELECT u.key, u.type, u.unit, u.label_en, u.label_de, u.domain, u.band, u.shape, u.etim, u.generated, now()
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::jsonb[], $8::text[], $9::jsonb[], $10::boolean[])
      AS u(key, type, unit, label_en, label_de, domain, band, shape, etim, generated)
  ON CONFLICT (key) DO UPDATE SET
    type = EXCLUDED.type, unit = EXCLUDED.unit, label_en = EXCLUDED.label_en, label_de = EXCLUDED.label_de,
    domain = EXCLUDED.domain, band = EXCLUDED.band, shape = EXCLUDED.shape, etim = EXCLUDED.etim,
    generated = EXCLUDED.generated, updated_at = now()
  WHERE (field_dictionary.type, field_dictionary.unit, field_dictionary.label_en, field_dictionary.label_de,
         field_dictionary.domain, field_dictionary.band, field_dictionary.shape, field_dictionary.etim, field_dictionary.generated)
        IS DISTINCT FROM
        (EXCLUDED.type, EXCLUDED.unit, EXCLUDED.label_en, EXCLUDED.label_de,
         EXCLUDED.domain, EXCLUDED.band, EXCLUDED.shape, EXCLUDED.etim, EXCLUDED.generated)
  RETURNING key, (xmax = 0) AS inserted`;

const PROFILE_UPSERT = `
  INSERT INTO category_profiles (category_id, field_key, requirement)
  SELECT c.id, u.field_key, u.requirement
    FROM unnest($1::text[], $2::text[], $3::jsonb[]) AS u(slug, field_key, requirement)
    JOIN categories c ON c.slug = u.slug
  ON CONFLICT (category_id, field_key) DO UPDATE SET requirement = EXCLUDED.requirement
  WHERE category_profiles.requirement IS DISTINCT FROM EXCLUDED.requirement
  RETURNING field_key, (xmax = 0) AS inserted`;

/**
 * Sync on a caller-owned connection (a transaction, normally). Refuses — before writing anything —
 * when code is inconsistent with itself or with the categories table.
 */
export async function syncDictionaryOn(db: Queryable, opts: { quiet?: boolean } = {}): Promise<DictionarySyncResult> {
  const rows = dictionaryRows();
  const profs = profileRows();

  // ---- preflight: every refusal names its offender ----------------------------------------
  const unlabeled = rows.filter((r) => !r.label_en || !r.label_de).map((r) => r.key);
  if (unlabeled.length) {
    throw new Error(`dictionary sync: ${unlabeled.length} field(s) have no label in code (label_en/label_de are NOT NULL): ${unlabeled.slice(0, 5).join(", ")}`);
  }
  const keySet = new Set(rows.map((r) => r.key));
  const badProfile = profs.filter((p) => !keySet.has(p.field_key));
  if (badProfile.length) {
    throw new Error(`dictionary sync: ${badProfile.length} profile field(s) are not in the dictionary: ${badProfile.slice(0, 5).map((p) => `${p.category}/${p.field_key}`).join(", ")}`);
  }
  const cats = [...new Set(profs.map((p) => p.category))];
  const found = await db.query<{ slug: string }>("SELECT slug FROM categories WHERE slug = ANY($1::text[])", [cats]);
  const have = new Set(found.rows.map((r) => r.slug));
  const missing = cats.filter((c) => !have.has(c));
  if (missing.length) {
    throw new Error(`dictionary sync: category in code missing from the categories table: ${missing.join(", ")} — seed it (db/migrations) before syncing profiles`);
  }

  // ---- dictionary ----------------------------------------------------------------------------
  const d = await db.query<{ key: string; inserted: boolean }>(DICT_UPSERT, [
    rows.map((r) => r.key), rows.map((r) => r.type), rows.map((r) => r.unit),
    rows.map((r) => r.label_en), rows.map((r) => r.label_de),
    rows.map((r) => json(r.domain)), rows.map((r) => json(r.band)), rows.map((r) => r.shape),
    rows.map((r) => json(r.etim)), rows.map((r) => r.generated),
  ]);
  const inserted = d.rows.filter((r) => r.inserted).length;
  const updated = d.rows.length - inserted;

  // ---- profiles ------------------------------------------------------------------------------
  const p = await db.query<{ field_key: string; inserted: boolean }>(PROFILE_UPSERT, [
    profs.map((x) => x.category), profs.map((x) => x.field_key), profs.map((x) => JSON.stringify(x.requirement)),
  ]);
  const profiles_inserted = p.rows.filter((r) => r.inserted).length;
  const profiles_updated = p.rows.length - profiles_inserted;

  // ---- orphans: reported, kept ---------------------------------------------------------------
  const orphanKeys = await db.query<{ key: string }>(
    "SELECT key FROM field_dictionary WHERE NOT (key = ANY($1::text[])) ORDER BY key", [rows.map((r) => r.key)]);
  const orphanProfiles = await db.query<{ id: string }>(
    `SELECT c.slug || '/' || cp.field_key AS id FROM category_profiles cp JOIN categories c ON c.id = cp.category_id
      WHERE NOT ((c.slug || '/' || cp.field_key) = ANY($1::text[])) ORDER BY 1`,
    [profs.map((x) => `${x.category}/${x.field_key}`)]);

  const result: DictionarySyncResult = {
    inserted, updated, unchanged: rows.length - inserted - updated,
    profiles: profs.length, profiles_inserted, profiles_updated,
    orphaned: orphanKeys.rows.map((r) => r.key),
    profiles_orphaned: orphanProfiles.rows.map((r) => r.id),
    label_drift: labelDrift(),
  };
  if (!opts.quiet) {
    if (result.orphaned.length) console.warn(`dictionary sync: ${result.orphaned.length} orphaned key(s) in the database, kept (facts may reference them): ${result.orphaned.join(", ")}`);
    if (result.profiles_orphaned.length) console.warn(`dictionary sync: ${result.profiles_orphaned.length} orphaned profile row(s), kept: ${result.profiles_orphaned.slice(0, 20).join(", ")}${result.profiles_orphaned.length > 20 ? ", …" : ""}`);
    if (result.label_drift.length) console.warn(`dictionary sync: FIELD_LABELS disagrees with the FieldDef on ${result.label_drift.length} key(s): ${result.label_drift.slice(0, 10).join(", ")}`);
  }
  return result;
}

/** Sync in one transaction on the pool. Idempotent; never deletes. */
export async function syncDictionary(opts: { quiet?: boolean } = {}): Promise<DictionarySyncResult> {
  return withTx((client) => syncDictionaryOn(client, opts));
}
