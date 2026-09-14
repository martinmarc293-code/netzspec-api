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
import { assertDetector, planGermanNames, isGermanName, type NameRow } from "../core/germanName.js";
import { REPO_ROOT } from "../config.js";

export async function main(argv: string[]): Promise<void> {
  const commit = argv.includes("--commit");
  const vendor = argv.includes("--vendor") ? argv[argv.indexOf("--vendor") + 1] : "cisco";
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
