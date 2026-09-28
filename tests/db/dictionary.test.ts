// tests/db/dictionary.test.ts — proof for src/store/dictionary.ts against the throwaway database.
//
//   NETZSPEC_DB=test npx tsx tests/db/dictionary.test.ts
//
// What it proves:
//   * the FK is the enforcement: the SAME fact insert under a key that exists only in code is
//     REFUSED before the sync (23503, naming field_key) and ACCEPTED after it;
//   * idempotence: the second run inserts 0 and updates 0, dictionary and profiles alike;
//   * the `updated` counter is alive: a row edited behind the sync's back is repaired and counted;
//   * orphans are reported and never deleted;
//   * a category in code that the table lacks aborts the sync naming the slug, before any write;
//   * every profile row references a dictionary key, in code and in the database.
//
// Setup deliberately removes ONE generated key from the test database (with its dependants) so
// the "before" state exists whatever earlier suites left behind. That is the only destructive
// step, it is the test database, and the key comes straight back from the sync under test.
// Every sabotage runs inside a transaction that is rolled back.
import type pg from "pg";
import { getPool, query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { syncDictionary, syncDictionaryOn, dictionaryRows, profileRows, type DictionarySyncResult } from "../../src/store/dictionary.js";
import { FIELD_DICTIONARY, PROFILES, CATEGORIES } from "../../src/core/fieldSchema.js";
import { GENERATED_FIELDS } from "../../src/core/fieldSchema.generated.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("refusing: run with NETZSPEC_DB=test (this suite deletes and re-creates a dictionary key)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`dictionary.test: database ${dbName}`);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Run `fn` in a transaction that is ALWAYS rolled back, whatever it did. */
async function rolledBack<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    try { await c.query("ROLLBACK"); } catch { /* connection already gone */ }
    c.release();
  }
}

type Refusal = { ok: true } | { ok: false; code?: string; constraint?: string; message: string };

/** A part plus one fact under `key`, in a transaction that is rolled back. Only the verdict escapes. */
async function probeFactInsert(key: string): Promise<Refusal> {
  return rolledBack(async (c) => {
    try {
      const part = await c.query<{ id: number }>(
        `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class)
         SELECT v.id, 'DICT-PROBE-1', 'dict-probe-1', cat.id, 'hardware' FROM vendors v, categories cat
          WHERE v.slug = 'cisco' AND cat.slug = 'switches' RETURNING id`);
      if (!part.rows[0]) return { ok: false, message: "vendor cisco / category switches are not seeded" };
      await c.query(
        `INSERT INTO facts (part_id, field_key, value, raw, state, tier, method) VALUES ($1, $2, '"probe"'::jsonb, 'probe', 'unverified', 3, 'probe')`,
        [part.rows[0].id, key]);
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; constraint?: string; message?: string };
      return { ok: false, code: err.code, constraint: err.constraint, message: String(err.message ?? e) };
    }
  });
}

// ---- setup: make sure ONE generated key exists only in code -------------------------------------
const PROBE_KEY = Object.keys(GENERATED_FIELDS).find((k) => GENERATED_FIELDS[k] === FIELD_DICTIONARY[k]);
if (!PROBE_KEY) { console.error("no generated key is live in FIELD_DICTIONARY; nothing to probe with"); process.exit(1); }
{
  const removed: string[] = [];
  for (const [table, col] of [["source_fields", "field_key"], ["category_profiles", "field_key"], ["conflicts", "field_key"], ["facts", "field_key"], ["field_dictionary", "key"]]) {
    const r = await query(`DELETE FROM ${table} WHERE ${col} = $1`, [PROBE_KEY]);
    if (r.rowCount) removed.push(`${table}:${r.rowCount}`);
  }
  console.log(`setup: probe key "${PROBE_KEY}" removed from the test database${removed.length ? ` (${removed.join(", ")})` : " (was already absent)"}`);
}

// =================================================================================================
// before the sync: the key is refused
// =================================================================================================
{
  sabotages++;
  const r = await probeFactInsert(PROBE_KEY);
  check(`SABOTAGE a fact under "${PROBE_KEY}" is REFUSED before the sync, by the FK, naming field_key`,
    !r.ok && r.code === "23503" && /field_key/.test(`${r.constraint ?? ""} ${r.message}`),
    r.ok ? "was accepted" : `${r.code} ${r.constraint ?? ""} ${r.message}`);
}

// =================================================================================================
// first sync
// =================================================================================================
const codeRows = dictionaryRows();
const codeProfiles = profileRows();
const r1: DictionarySyncResult = await syncDictionary({ quiet: true });
console.log(`sync #1: inserted ${r1.inserted}, updated ${r1.updated}, unchanged ${r1.unchanged}; profiles ${r1.profiles} (inserted ${r1.profiles_inserted}, updated ${r1.profiles_updated}); orphaned ${r1.orphaned.length}, profile orphans ${r1.profiles_orphaned.length}, label drift ${r1.label_drift.length}`);
check("sync #1 inserted at least the probe key", r1.inserted >= 1);
check("sync #1 accounts for every key in code exactly once", r1.inserted + r1.updated + r1.unchanged === codeRows.length,
  `${r1.inserted}+${r1.updated}+${r1.unchanged} vs ${codeRows.length}`);
check("sync #1 reports every profile row in code", r1.profiles === codeProfiles.length);
{
  const n = await query<{ n: number }>("SELECT count(*)::int AS n FROM field_dictionary WHERE key = ANY($1::text[])", [codeRows.map((r) => r.key)]);
  check("every key in code is now in the database", n.rows[0].n === codeRows.length, `${n.rows[0].n} of ${codeRows.length}`);
  const p = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM category_profiles cp JOIN categories c ON c.id = cp.category_id
      WHERE (c.slug || '/' || cp.field_key) = ANY($1::text[])`, [codeProfiles.map((x) => `${x.category}/${x.field_key}`)]);
  check("every profile row in code is now in the database", p.rows[0].n === codeProfiles.length, `${p.rows[0].n} of ${codeProfiles.length}`);
}

// =================================================================================================
// after the sync: the same insert succeeds
// =================================================================================================
{
  const r = await probeFactInsert(PROBE_KEY);
  check(`the same fact insert under "${PROBE_KEY}" SUCCEEDS after the sync`, r.ok, r.ok ? "" : `${r.code} ${r.message}`);
}

// =================================================================================================
// second sync: idempotent
// =================================================================================================
const r2 = await syncDictionary({ quiet: true });
console.log(`sync #2: inserted ${r2.inserted}, updated ${r2.updated}, unchanged ${r2.unchanged}; profiles inserted ${r2.profiles_inserted}, updated ${r2.profiles_updated}`);
check("sync #2 inserts 0 dictionary keys", r2.inserted === 0, `${r2.inserted}`);
check("sync #2 updates 0 dictionary keys", r2.updated === 0, `${r2.updated}`);
check("sync #2 inserts 0 and updates 0 profile rows", r2.profiles_inserted === 0 && r2.profiles_updated === 0, `${r2.profiles_inserted}/${r2.profiles_updated}`);
check("sync #2 leaves every key unchanged", r2.unchanged === codeRows.length);
{
  const touched = await query<{ n: number }>("SELECT count(*)::int AS n FROM field_dictionary WHERE updated_at > now() - interval '2 seconds' AND key = ANY($1::text[])", [codeRows.map((r) => r.key)]);
  // sync #1 may have been within the window on a fast box; the point is sync #2 must not have bumped ALL of them
  check("sync #2 did not bump updated_at on every row", touched.rows[0].n < codeRows.length || r1.inserted + r1.updated === codeRows.length);
}

// =================================================================================================
// what was stored is what the code says
// =================================================================================================
{
  const rows = await query<{ key: string; type: string; unit: string | null; label_en: string; label_de: string; domain: string[] | null; band: number[] | null; shape: string | null; etim: string[] | null; generated: boolean }>(
    "SELECT key, type, unit, label_en, label_de, domain, band, shape, etim, generated FROM field_dictionary WHERE key = ANY($1::text[])",
    [["switching_capacity", "ports", "vendor", "poe_standard", PROBE_KEY]]);
  const by = new Map(rows.rows.map((r) => [r.key, r]));
  const sc = by.get("switching_capacity");
  check("switching_capacity stored as n / Gbit/s with its band and labels",
    sc?.type === "n" && sc?.unit === "Gbit/s" && JSON.stringify(sc?.band) === "[1,200000]" && sc?.label_de === "Switching-Kapazität" && sc?.label_en === "Switching capacity" && sc?.generated === false,
    JSON.stringify(sc));
  const ports = by.get("ports");
  check("ports stored as struct with its shape and ETIM codes", ports?.type === "struct" && !!ports?.shape && Array.isArray(ports?.etim) && (ports?.etim?.length ?? 0) > 5, JSON.stringify(ports));
  const vendor = by.get("vendor");
  check("vendor stored as e with the vendor domain", vendor?.type === "e" && JSON.stringify(vendor?.domain) === JSON.stringify(FIELD_DICTIONARY.vendor.domain), JSON.stringify(vendor?.domain));
  const poe = by.get("poe_standard");
  check("poe_standard domain round-trips as JSON", JSON.stringify(poe?.domain) === JSON.stringify(FIELD_DICTIONARY.poe_standard.domain));
  const probe = by.get(PROBE_KEY);
  check(`the probe key is flagged generated=true`, probe?.generated === true);
}
{
  // jsonb stores objects key-sorted, so equality is asked of Postgres, not of a string compare
  const r = await query<{ same: boolean; requirement: unknown }>(
    "SELECT cp.requirement = $1::jsonb AS same, cp.requirement FROM category_profiles cp JOIN categories c ON c.id = cp.category_id WHERE c.slug = 'switches' AND cp.field_key = 'poe_budget'",
    [JSON.stringify(PROFILES.switches.poe_budget)]);
  check("a conditional requirement round-trips as JSON", r.rows[0]?.same === true, JSON.stringify(r.rows[0]?.requirement));
  const n = await query<{ n: number }>("SELECT count(*)::int AS n FROM category_profiles cp JOIN categories c ON c.id = cp.category_id WHERE c.slug = 'switches'");
  check("the switches profile in the database is at least as large as in code", n.rows[0].n >= Object.keys(PROFILES.switches).length);
}

// =================================================================================================
// every profile field key exists in the dictionary — in code and in the database
// =================================================================================================
check("every profile key in code exists in FIELD_DICTIONARY",
  CATEGORIES.every((cat) => Object.keys(PROFILES[cat]).every((k) => !!FIELD_DICTIONARY[k])));
{
  const r = await query<{ n: number }>("SELECT count(*)::int AS n FROM category_profiles cp LEFT JOIN field_dictionary d ON d.key = cp.field_key WHERE d.key IS NULL");
  check("every profile row in the database references a dictionary key", r.rows[0].n === 0, `${r.rows[0].n} dangling`);
}
check("every category in code is present in the categories table (sync would have refused otherwise)", r1.profiles > 0);

// =================================================================================================
// sabotage: the counters and refusals are alive
// =================================================================================================
// updated: a row edited behind the sync's back is repaired and counted
await rolledBack(async (c) => {
  sabotages++;
  await c.query("UPDATE field_dictionary SET label_en = 'WRONG', updated_at = '2000-01-01' WHERE key = 'switching_capacity'");
  const r = await syncDictionaryOn(c, { quiet: true });
  const row = await c.query<{ label_en: string; updated_at: Date }>("SELECT label_en, updated_at FROM field_dictionary WHERE key = 'switching_capacity'");
  check("SABOTAGE a drifted label is repaired and counted as exactly one update",
    r.updated === 1 && r.inserted === 0 && row.rows[0].label_en === "Switching capacity" && row.rows[0].updated_at.getFullYear() > 2000,
    `updated ${r.updated}, inserted ${r.inserted}, label ${row.rows[0]?.label_en}`);
});
// orphaned: reported, never deleted
await rolledBack(async (c) => {
  sabotages++;
  await c.query("INSERT INTO field_dictionary (key, type, label_en, label_de) VALUES ('zz_orphan_probe', 's', 'Orphan', 'Waise')");
  const r = await syncDictionaryOn(c, { quiet: true });
  const still = await c.query("SELECT 1 FROM field_dictionary WHERE key = 'zz_orphan_probe'");
  check("SABOTAGE a key only the database knows is reported as orphaned and NOT deleted",
    r.orphaned.includes("zz_orphan_probe") && still.rowCount === 1, `orphaned=${JSON.stringify(r.orphaned)} still=${still.rowCount}`);
});
// orphaned profile row: reported, never deleted
await rolledBack(async (c) => {
  sabotages++;
  await c.query("INSERT INTO category_profiles (category_id, field_key, requirement) SELECT id, 'switching_capacity', '{\"kind\":\"opt\"}'::jsonb FROM categories WHERE slug = 'software'");
  const r = await syncDictionaryOn(c, { quiet: true });
  const still = await c.query("SELECT 1 FROM category_profiles cp JOIN categories c ON c.id = cp.category_id WHERE c.slug = 'software' AND cp.field_key = 'switching_capacity'");
  check("SABOTAGE a profile row only the database knows is reported as orphaned and NOT deleted",
    r.profiles_orphaned.includes("software/switching_capacity") && still.rowCount === 1, JSON.stringify(r.profiles_orphaned));
});
// missing category: refused naming the slug, before the first write
await rolledBack(async (c) => {
  sabotages++;
  const victim = CATEGORIES.includes("video") ? "video" : CATEGORIES[CATEGORIES.length - 1];
  // remove the probe key again (dependants first: the sync itself put its profile rows back); if the sync writes anything, it comes back
  for (const [table, col] of [["source_fields", "field_key"], ["category_profiles", "field_key"], ["conflicts", "field_key"], ["facts", "field_key"], ["field_dictionary", "key"]]) {
    await c.query(`DELETE FROM ${table} WHERE ${col} = $1`, [PROBE_KEY]);
  }
  await c.query("DELETE FROM source_fields WHERE category_id = (SELECT id FROM categories WHERE slug = $1)", [victim]);
  await c.query("DELETE FROM parts WHERE category_id = (SELECT id FROM categories WHERE slug = $1)", [victim]);
  await c.query("DELETE FROM category_profiles WHERE category_id = (SELECT id FROM categories WHERE slug = $1)", [victim]);
  await c.query("DELETE FROM categories WHERE slug = $1", [victim]);
  let msg = "";
  try { await syncDictionaryOn(c, { quiet: true }); msg = "NO THROW"; } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  const written = await c.query("SELECT 1 FROM field_dictionary WHERE key = $1", [PROBE_KEY]);
  check(`SABOTAGE a category in code missing from the table ("${victim}") is refused naming the slug`,
    /missing from the categories table/.test(msg) && msg.includes(victim), msg);
  check("SABOTAGE the refusal happened before the first write", written.rowCount === 0);
});

// reshape guard (29 Sep 2026): a raw whose unit lived in the LABEL is re-read from its stored value, not refused.
// Every sync from run 1250 on was refused over 2,063 tdp / clock_speed / cpu_cache facts whose raw is a bare "130".
/** One tdp fact on a fresh live part as the ONLY live tdp fact, the table's tdp row drifted by `drift`, then sync. */
async function reshapeProbe(raw: string, value: number, drift: string): Promise<{ msg: string; planted: number; x?: DictionarySyncResult["reshaped"][number] }> {
  return rolledBack(async (c) => {
    await c.query("UPDATE parts SET retired_at = now() WHERE retired_at IS NULL AND id IN (SELECT part_id FROM facts WHERE field_key = 'tdp')");
    const part = await c.query<{ id: number }>(
      `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class)
       SELECT v.id, 'DICT-RESHAPE-1', 'dict-reshape-1', cat.id, 'hardware' FROM vendors v, categories cat
        WHERE v.slug = 'cisco' AND cat.slug = 'switches' RETURNING id`);
    await c.query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method)
                   VALUES ($1, 'tdp', $2::jsonb, 'W', $3, 'unverified', 3, 'probe')`, [part.rows[0].id, JSON.stringify(value), raw]);
    await c.query(`UPDATE field_dictionary SET ${drift} WHERE key = 'tdp'`);
    const planted = (await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM facts f JOIN parts p ON p.id = f.part_id WHERE f.field_key = 'tdp' AND p.retired_at IS NULL AND f.superseded_by IS NULL")).rows[0].n;
    try {
      const r = await syncDictionaryOn(c, { quiet: true });
      return { msg: "NO THROW", planted, x: r.reshaped.find((e) => e.key === "tdp") };
    } catch (e) { return { msg: e instanceof Error ? e.message : String(e), planted }; }
  });
}
{
  const p = await reshapeProbe("130", 130, "band = NULL");
  check("reshape: a bare \"130\" whose unit lived in the label is re-read from its stored value and PASSES the new band",
    p.planted === 1 && p.msg === "NO THROW" && p.x?.facts === 1 && p.x.replayed_from_value === 1 && Object.keys(p.x.would_refuse_by_vendor).length === 0,
    `planted ${p.planted}, ${p.msg}, ${JSON.stringify(p.x)}`);
}
{
  sabotages++;
  const p = await reshapeProbe("3080", 3080, "band = NULL");
  check("SABOTAGE reshape: a stored value OUTSIDE the new band is still refused, re-read from the stored value",
    p.planted === 1 && /REFUSED/.test(p.msg) && p.msg.includes("tdp") && p.msg.includes("(re-read from the stored value): RANGE_VIOLATION"), `planted ${p.planted}, ${p.msg}`);
}
{
  sabotages++;
  const p = await reshapeProbe("130", 130, "band = NULL, unit = 'mW'");
  check("SABOTAGE reshape: when the UNIT moved the stored value is not in the new unit, so it is refused, never re-read",
    p.planted === 1 && /REFUSED/.test(p.msg) && p.msg.includes("UNIT_MISSING") && !p.msg.includes("re-read from the stored value"), `planted ${p.planted}, ${p.msg}`);
}
{
  sabotages++;
  const p = await reshapeProbe("3080 W", 3080, "band = NULL");
  check("SABOTAGE reshape: a raw that carries its own unit and falls outside the band is refused from the raw, as before",
    p.planted === 1 && /REFUSED/.test(p.msg) && p.msg.includes("RANGE_VIOLATION") && !p.msg.includes("re-read from the stored value"), `planted ${p.planted}, ${p.msg}`);
}

// ---- the shape of the suite itself ---------------------------------------------------------------
check("the suite carries at least 5 sabotage cases", sabotages >= 5, `${sabotages}`);

await closePool();
console.log(`\ndictionary.test: ${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { console.log("MISSES:\n  " + misses.join("\n  ")); process.exit(1); }
