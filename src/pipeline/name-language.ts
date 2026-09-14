// src/pipeline/name-language.ts — `ingest name-language [--vendor cisco] [--commit]` (layers review round 2, B.6, 14 Sep 2026).
//
// Applies the operator's decision on German shop titles in parts.name (src/core/germanName.ts):
//   every German-named live hardware row  -> name_de = the German title (kept, never dropped)
//   its twin (X / X=) holds an English name -> name = that name, name_lang 'en', name_source 'twin: <sku>'
//   no English name anywhere               -> name unchanged, name_lang 'de' (a store-quality item until phase 2)
// Dry by default: prints the plan and its counts. --commit writes it as ONE run with the prediction in its inputs and the actual
// counts in its stats, reads the result back from a new query and fails the run if they differ.
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../store/index.js";
import { assertDetector, planGermanNames, isGermanName, planSpareWording, planPackagingNotes, SPARE_LEFT, SPARE_REMOVED, FIXED_UNIT_SKU, PACKAGING_NOTE, type NameRow } from "../core/germanName.js";
import { REPO_ROOT } from "../config.js";

export async function main(argv: string[]): Promise<void> {
  const commit = argv.includes("--commit");
  const vendor = argv.includes("--vendor") ? argv[argv.indexOf("--vendor") + 1] : "cisco";
  if (argv.includes("--strip-packaging")) return stripPackaging(vendor, commit);
  if (argv.includes("--strip-spare")) return stripSpare(vendor, commit);
  assertDetector();
  const pool = getPool();
  const read = async () => (await pool.query<NameRow & { category: string }>(
    `SELECT p.id, p.sku, p.name, p.name_de, p.name_lang, c.slug AS category
       FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
      WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'`, [vendor])).rows;
  const rows = await read();
  const { plans, skipped_done } = planGermanNames(rows);
  const cat = new Map(rows.map((r) => [r.id, r.category]));
  const byCat: Record<string, { english_from_twin: number; flag_german: number }> = {};
  for (const p of plans) { const c = (byCat[cat.get(p.id)!] ??= { english_from_twin: 0, flag_german: 0 }); c[p.action]++; }
  const predicted = { german_rows: plans.length, english_from_twin: plans.filter((p) => p.action === "english_from_twin").length, flag_german: plans.filter((p) => p.action === "flag_german").length, skipped_done, by_category: byCat };
  console.log(`name-language ${vendor}: ${rows.length} live hardware rows scanned`);
  console.log(`predicted: ${JSON.stringify(predicted)}`);
  for (const p of plans.filter((x) => x.action === "english_from_twin").slice(0, 8)) if (p.action === "english_from_twin") console.log(`  ${p.sku}: "${p.name_de.slice(0, 60)}" -> "${p.name.slice(0, 60)}" (${p.source})`);
  if (!commit) { console.log("DRY RUN — nothing written. Add --commit."); await closePool(); return; }
  if (!plans.length) { console.log("nothing to do"); await closePool(); return; }

  let gitSha: string | undefined;
  try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { gitSha = undefined; }
  const out = await withRun("name-language", { vendor, decision: "layers review round 2 B.6 (operator 14 Sep 2026)", predicted }, async () => {
    await withTx(async (client) => {
      const en = plans.filter((p) => p.action === "english_from_twin") as Extract<typeof plans[number], { action: "english_from_twin" }>[];
      const de = plans.filter((p) => p.action === "flag_german");
      // guarded on the name still being the German title that was planned: a row changed since the read is not touched
      const a = await client.query(
        `UPDATE parts p SET name_de = u.name_de, name = u.name, name_lang = 'en', name_source = u.source, updated_at = now()
           FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS u(id, name_de, name, source)
          WHERE p.id = u.id AND p.name = u.name_de AND p.name_lang IS NULL`,
        [en.map((p) => p.id), en.map((p) => p.name_de), en.map((p) => p.name), en.map((p) => p.source)]);
      const b = await client.query(
        `UPDATE parts p SET name_de = u.name_de, name_lang = 'de', updated_at = now()
           FROM unnest($1::bigint[], $2::text[]) AS u(id, name_de)
          WHERE p.id = u.id AND p.name = u.name_de AND p.name_lang IS NULL`,
        [de.map((p) => p.id), de.map((p) => p.name_de)]);
      if (a.rowCount !== en.length || b.rowCount !== de.length)
        throw new Error(`name-language: wrote ${a.rowCount}/${en.length} English and ${b.rowCount}/${de.length} flagged rows — a row changed between plan and write; nothing committed`);
    });
    // actual, from a new read: no German row may remain unhandled, and every handled row keeps its German title
    const after = await read();
    const german_unhandled = after.filter((r) => isGermanName(r.name) && !r.name_lang).length;
    const english = after.filter((r) => r.name_lang === "en" && r.name_de).length;
    const flagged = after.filter((r) => r.name_lang === "de" && r.name_de).length;
    const lost_german = after.filter((r) => r.name_lang && !r.name_de).length;
    const actual = { english_from_twin: english, flag_german: flagged, german_unhandled, lost_german };
    if (german_unhandled || lost_german || english < predicted.english_from_twin || flagged < predicted.flag_german)
      throw new Error(`name-language: actual ${JSON.stringify(actual)} does not match predicted ${JSON.stringify(predicted)}`);
    return { stats: { ...actual, predicted_english: predicted.english_from_twin, predicted_flagged: predicted.flag_german }, notes: `German titles kept in name_de: ${english + flagged}; English from a twin: ${english}; flagged de: ${flagged}` };
  }, { gitSha });
  console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}`);
  await closePool();
}

// `ingest name-language --strip-packaging [--commit]` (closing items at aa1143f, item 3; operator 14 Sep 2026): a FIXED unit's base
// that borrowed its spare's name drops the spare's "no PS / no fans / For Service Only" note (planPackagingNotes); modular chassis keep
// it and are listed in the run record; spares are untouched. Asserts after: no borrowed fixed-unit base name carries the note, "spare"
// or "="; every spare name is unchanged; the 21 chassis names are unchanged.
async function stripPackaging(vendor: string, commit: boolean): Promise<void> {
  const pool = getPool();
  const read = async () => (await pool.query<{ id: number; sku: string; name: string; name_source: string | null }>(
    `SELECT p.id, p.sku, p.name, p.name_source FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = $1`, [vendor])).rows;
  const all = await read();
  const borrowed = all.filter((r) => (r.name_source ?? "").startsWith("twin:")) as { id: number; sku: string; name: string; name_source: string }[];
  const { plans, kept_chassis, refused } = planPackagingNotes(borrowed);
  const predicted = { borrowed_names: borrowed.length, to_strip: plans.length, kept_chassis: kept_chassis.length, refused: refused.length };
  console.log(`name-language --strip-packaging ${vendor}: predicted ${JSON.stringify(predicted)}`);
  for (const p of plans) console.log(`  ${p.sku}: "${p.name}" -> "${p.stripped}"  [${p.source}]`);
  for (const k of kept_chassis) console.log(`  KEPT ${k.sku}: "${k.name}" (${k.reason})`);
  if (refused.length) { for (const x of refused) console.log(`  REFUSED ${x.sku}: "${x.name}" — ${x.why}`); await closePool(); throw new Error(`strip-packaging: ${refused.length} row(s) need a hand check first`); }
  if (!commit) { console.log("DRY RUN — nothing written. Add --commit."); await closePool(); return; }
  if (!plans.length) { console.log("nothing to do"); await closePool(); return; }

  const spareBefore = new Map(all.filter((r) => r.sku.trim().endsWith("=")).map((r) => [r.id, r.name]));
  const chassisBefore = new Map(kept_chassis.map((k) => [k.sku, k.name]));
  let gitSha: string | undefined;
  try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { gitSha = undefined; }
  const out = await withRun("name-spare-packaging", { vendor, decision: "closing items at aa1143f item 3, operator 14 Sep 2026: strip on all fixed units, keep on modular chassis and spares", predicted,
    kept_chassis, planned: plans.map((p) => ({ sku: p.sku, before: p.name, after: p.stripped, removed: p.removed })) }, async () => {
    await withTx(async (client) => {
      const a = await client.query(
        `UPDATE parts p SET name = u.stripped, name_source = u.source, updated_at = now()
           FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[]) AS u(id, old, old_source, stripped, source)
          WHERE p.id = u.id AND p.name = u.old AND p.name_source = u.old_source`,
        [plans.map((p) => p.id), plans.map((p) => p.name), plans.map((p) => p.name_source), plans.map((p) => p.stripped), plans.map((p) => p.source)]);
      if (a.rowCount !== plans.length) throw new Error(`strip-packaging: wrote ${a.rowCount}/${plans.length} — a row changed between plan and write; nothing committed`);
    });
    const after = await read();
    const fixedLeft = after.filter((r) => (r.name_source ?? "").startsWith("twin:") && !r.sku.trim().endsWith("=") && FIXED_UNIT_SKU.test(r.sku.trim().toUpperCase())
      && (PACKAGING_NOTE.test(r.name) || SPARE_LEFT.test(r.name)));
    const sparesChanged = after.filter((r) => spareBefore.has(r.id) && spareBefore.get(r.id) !== r.name).length;
    const chassisChanged = after.filter((r) => chassisBefore.has(r.sku) && chassisBefore.get(r.sku) !== r.name).length;
    const marked = after.filter((r) => plans.some((p) => p.id === r.id) && r.name_source === plans.find((p) => p.id === r.id)!.source).length;
    const actual = { stripped: marked, fixed_base_names_still_carrying: fixedLeft.length, spares_changed: sparesChanged, chassis_changed: chassisChanged };
    if (fixedLeft.length || sparesChanged || chassisChanged || marked !== plans.length) throw new Error(`strip-packaging: actual ${JSON.stringify(actual)} does not match predicted ${JSON.stringify(predicted)}`);
    return { stats: { ...actual, kept_chassis: kept_chassis.length, predicted_to_strip: plans.length }, notes: `packaging note removed from ${plans.length} fixed-unit base names; ${kept_chassis.length} modular chassis kept (base ships without power supplies); spares unchanged` };
  }, { gitSha });
  console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}`);
  await closePool();
}

// `ingest name-language --strip-spare [--commit]` (layers re-audit at 2f3d17a, 14 Sep 2026; operator yes): a name a base borrowed
// from its spare drops the spare's wording (stripSpareWording). name_source becomes "twin: <sku>, spare wording removed". Refuses
// when any borrowed name would still carry "spare" or "=" — those are hand-checked, never guessed.
async function stripSpare(vendor: string, commit: boolean): Promise<void> {
  const pool = getPool();
  const read = async () => (await pool.query<{ id: number; sku: string; name: string; name_source: string; category: string }>(
    `SELECT p.id, p.sku, p.name, p.name_source, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id
       JOIN categories c ON c.id = p.category_id WHERE v.slug = $1 AND p.name_source LIKE 'twin:%'`, [vendor])).rows;
  const rows = await read();
  const { plans, refused } = planSpareWording(rows);
  const cat = new Map(rows.map((r) => [r.id, r.category]));
  const byCat: Record<string, number> = {};
  for (const p of plans) byCat[cat.get(p.id)!] = (byCat[cat.get(p.id)!] ?? 0) + 1;
  const predicted = { borrowed_names: rows.length, to_strip: plans.length, refused: refused.length, by_category: byCat };
  console.log(`name-language --strip-spare ${vendor}: predicted ${JSON.stringify(predicted)}`);
  for (const p of plans) console.log(`  ${p.sku}: "${p.name}" -> "${p.stripped}"`);
  if (refused.length) { for (const p of refused) console.log(`  REFUSED ${p.sku}: "${p.name}" -> "${p.stripped}"`); await closePool(); throw new Error(`strip-spare: ${refused.length} borrowed name(s) still carry "spare" or "=" after the strip — hand-check them first`); }
  if (!commit) { console.log("DRY RUN — nothing written. Add --commit."); await closePool(); return; }
  if (!plans.length) { console.log("nothing to do"); await closePool(); return; }

  let gitSha: string | undefined;
  try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { gitSha = undefined; }
  const out = await withRun("name-spare-wording", { vendor, decision: "layers re-audit at 2f3d17a item 3(d), operator yes 14 Sep 2026", predicted }, async () => {
    await withTx(async (client) => {
      // guarded on the name and its source still being what was planned
      const a = await client.query(
        `UPDATE parts p SET name = u.stripped, name_source = u.source, updated_at = now()
           FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[]) AS u(id, old, old_source, stripped, source)
          WHERE p.id = u.id AND p.name = u.old AND p.name_source = u.old_source`,
        [plans.map((p) => p.id), plans.map((p) => p.name), plans.map((p) => p.name_source), plans.map((p) => p.stripped), plans.map((p) => p.source)]);
      if (a.rowCount !== plans.length) throw new Error(`strip-spare: wrote ${a.rowCount}/${plans.length} — a row changed between plan and write; nothing committed`);
    });
    // actual, from a new read: no borrowed name carries the spare's marks, and every planned row now says so in its source
    const after = await read();
    const still = after.filter((r) => SPARE_LEFT.test(r.name)).length;
    const marked = after.filter((r) => r.name_source.endsWith(SPARE_REMOVED)).length;
    const actual = { borrowed_names: after.length, still_carrying_spare: still, marked_spare_removed: marked };
    if (still || marked < plans.length || after.length !== rows.length) throw new Error(`strip-spare: actual ${JSON.stringify(actual)} does not match predicted ${JSON.stringify(predicted)}`);
    return { stats: { ...actual, predicted_to_strip: plans.length }, notes: `spare wording removed from ${plans.length} borrowed names; 0 still carry "spare" or "="` };
  }, { gitSha });
  console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}`);
  await closePool();
}
