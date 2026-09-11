/**
 * Correct ONE operator-seeded (tier-0) fact, on the operator's decision.
 *
 *     npx tsx scripts/correct-tier0.mts --sku SFP-10G-OLT20-X --field power_max --locale de \
 *         --approved "operator, 11 Sep 2026: 2475 -> 2.475 W, a decimal-point defect" [--commit]
 *
 * WHY THIS EXISTS. renormalize.ts protects tier 0 on purpose (protectTier0): a seed row is the operator's
 * own word, and a parser overruling it inside a bulk run is how 21,724 rows would have changed unseen. It
 * hands such rows to the operator instead (runs/reports/renormalize-tier0-<date>.jsonl). This is the other
 * half of that hand-off: once the operator has decided about a SPECIFIC row, apply exactly that decision.
 *
 * THE VALUE IS NEVER TYPED. It is re-derived from the fact's own raw by the real normaliser under the
 * locale the seed was written in, and the command refuses unless that re-derivation succeeds and differs
 * from what is stored. The old row is SUPERSEDED (facts are append-only): raw, provenance and tier stay;
 * only the value and norm_v change, and the approval text is recorded in the run.
 *
 * IT REFUSES ITS OWN OUTPUT: after the write the current value equals the re-derivation, so a second run
 * finds nothing to correct. Asserted.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { supersedeFact } from "../src/store/facts.js";
import { normalizeField, NORM_VERSION, type Locale } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

type Row = { id: string; part_id: string; cat: string; raw: string; value: unknown; unit: string | null; state: string;
  tier: number; method: string; doc_id: string | null; locator: string | null; extracted_at: string | null };

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const sku = arg("--sku"), field = arg("--field"), approved = arg("--approved");
  const locale = (arg("--locale") ?? "de") as Locale;
  const vendor = arg("--vendor") ?? "cisco";
  if (!sku || !field) throw new Error("usage: --sku SKU --field KEY [--locale de|en] --approved \"...\" [--commit]");
  if (commit && !approved) throw new Error("--commit needs --approved \"<the operator's decision, verbatim>\": tier 0 is the operator's own word");
  const pool = getPool();
  const SELECT = `
    SELECT f.id::text, f.part_id::text, ct.slug AS cat, f.raw, f.value, f.unit, f.state::text AS state, f.tier, f.method,
           f.doc_id, f.locator, f.extracted_at::text AS extracted_at
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.sku = $2 AND f.field_key = $3 AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`;
  const rows = (await pool.query<Row>(SELECT, [vendor, sku, field])).rows;
  if (rows.length !== 1) throw new Error(`expected exactly ONE current ${field} fact on ${vendor}/${sku}, found ${rows.length} — refusing`);
  const r = rows[0];
  if (r.tier !== 0) throw new Error(`${sku}/${field} is tier ${r.tier}, not an operator seed row — renormalize handles it, not this script`);
  const n = normalizeField(r.cat, field, r.raw, { locale });
  if (!n.ok) throw new Error(`the raw "${r.raw}" does not re-derive under locale ${locale}: ${n.reason} ${n.detail} — refusing`);
  const same = JSON.stringify(n.value) === JSON.stringify(r.value);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — tier-0 correction ${vendor}/${sku} ${field}`);
  console.log(`  raw "${r.raw}" (${r.method}, tier ${r.tier})`);
  console.log(`  stored     ${JSON.stringify(r.value)} ${r.unit ?? ""}`);
  console.log(`  re-derived ${JSON.stringify(n.value)} ${n.unit ?? r.unit ?? ""} under locale ${locale}`);
  if (same) { console.log("  already correct — nothing to do"); await closePool(); return; }
  if (!commit) { console.log("\nnothing written. re-run with --commit --approved \"...\""); await closePool(); return; }

  const entry: SpecEntry = {
    k: field, raw: r.raw, value: n.value, ...((n.unit ?? r.unit) ? { unit: (n.unit ?? r.unit) as string } : {}),
    state: r.state as SpecEntry["state"],
    prov: { tier: r.tier, method: r.method, norm_v: NORM_VERSION,
      ...(r.doc_id ? { doc_id: r.doc_id } : {}), ...(r.locator ? { locator: r.locator } : {}), ...(r.extracted_at ? { extracted_at: r.extracted_at } : {}) },
  };
  await withRun("correct-tier0", { vendor, sku, field, locale, approved, from: r.value, to: n.value }, async (runId) => {
    await withTx(async (tx) => { await supersedeFact(tx, Number(r.id), entry, runId); });
    return { stats: { corrected: 1, sku, field, from: r.value, to: n.value } };
  });
  const after = (await pool.query<Row>(SELECT, [vendor, sku, field])).rows;
  const ok = after.length === 1 && JSON.stringify(after[0].value) === JSON.stringify(n.value);
  console.log(`\n  now ${JSON.stringify(after[0]?.value)} — selector re-run finds nothing to correct: ${ok}`);
  if (!ok) { console.error("  *** the stored value does not equal the re-derivation after the write ***"); process.exitCode = 1; }
  await closePool();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
