/**
 * Give a single-fibre BiDi its RECEIVE wavelength from the raw it already holds (11 Sep 2026, reviewer §2.1).
 *
 *     npx tsx scripts/split-bidi-rx.mts [--commit] [--vendor cisco]
 *
 * WHY. A BiDi transmits on one wavelength and receives on another, and every BiDi wavelength raw states both:
 * "Tx 1490 nm / Rx 1310 nm". `wavelength` kept the Tx number and the Rx number had no cup. The cup is
 * `rx_wavelength` (now required of kind `bidi`); this pass fills it from the SAME raw — no fetch, no guess.
 *
 * A SPLIT, NOT A MOVE. The `wavelength` fact stays: its value IS the Tx side. For every candidate the Tx side
 * is re-derived by the real normaliser and must equal the stored `wavelength` value — if the raw does not
 * read the way the store already holds it, the row is refused rather than trusted. The Rx side is derived by
 * the same normaliser under `rx_wavelength` (its Tx/Rx pair rule, specNormalize.ts). The new fact carries the
 * wavelength fact's raw, tier, method, document and locator: the value was stated by that same source.
 *
 * IT REFUSES ITS OWN OUTPUT: a part that already holds a current rx_wavelength is not a candidate, so a second
 * run proposes nothing. Asserted after the write.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { insertFact } from "../src/store/facts.js";
import { normalizeField, NORM_VERSION, type Locale } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

type Row = { id: string; part_id: string; sku: string; cat: string; raw: string; value: unknown; state: string;
  tier: number; method: string; doc_id: string | null; locator: string | null; extracted_at: string | null };

const SELECT = `
  SELECT f.id::text, f.part_id::text, p.sku, ct.slug AS cat, f.raw, f.value, f.state::text AS state, f.tier, f.method,
         f.doc_id, f.locator, f.extracted_at::text AS extracted_at
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
   WHERE v.slug = $1 AND ct.slug = 'transceiver' AND p.retired_at IS NULL AND p.product_class = 'hardware'
     AND f.field_key = 'wavelength' AND f.superseded_by IS NULL AND NOT f.inherited AND f.method NOT LIKE 'retracted:%'
     AND f.raw ~* '(tx|rx)'
     AND NOT EXISTS (SELECT 1 FROM facts g WHERE g.part_id = f.part_id AND g.field_key = 'rx_wavelength'
                     AND g.superseded_by IS NULL AND g.method NOT LIKE 'retracted:%')
   ORDER BY p.sku`;

const localeOf = (method: string): Locale => (method === "hexcat_seed" ? "de" : "en");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const vi = process.argv.indexOf("--vendor");
  const vendor = vi >= 0 ? process.argv[vi + 1] : "cisco";
  const pool = getPool();
  const rows = (await pool.query<Row>(SELECT, [vendor])).rows;
  type Plan = { r: Row; rx?: unknown; why?: string };
  const plans: Plan[] = rows.map((r) => {
    const loc = localeOf(r.method);
    const tx = normalizeField(r.cat, "wavelength", r.raw, { locale: loc });
    if (!tx.ok || !same(tx.value, r.value)) return { r, why: `Tx side re-derives to ${tx.ok ? JSON.stringify(tx.value) : tx.reason}, stored ${JSON.stringify(r.value)}` };
    const rx = normalizeField(r.cat, "rx_wavelength", r.raw, { locale: loc });
    if (!rx.ok) return { r, why: `Rx side: ${rx.reason} ${rx.detail}` };
    // a raw that names no Rx side re-derives rx_wavelength to the SAME number as the Tx: not a pair
    if (same((rx.value as { min: number }).min, r.value)) return { r, why: "no separate Rx side in this raw" };
    return { r, rx: rx.value };
  });
  const ok = plans.filter((p) => p.rx !== undefined), bad = plans.filter((p) => p.rx === undefined);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — rx_wavelength from BiDi Tx/Rx raws (${vendor})`);
  console.log(`  candidates ${rows.length} · to write ${ok.length} · refused ${bad.length}`);
  for (const p of ok) console.log(`   write   ${p.r.sku.padEnd(22)} raw="${p.r.raw}"  Tx ${JSON.stringify(p.r.value)}  Rx ${JSON.stringify(p.rx)}  (${p.r.method}, t${p.r.tier})`);
  for (const p of bad) console.log(`   REFUSED ${p.r.sku.padEnd(22)} raw="${p.r.raw}"  ${p.why}`);
  if (!commit || !ok.length) { console.log(commit ? "nothing to do" : "\nnothing written. re-run with --commit"); await closePool(); return; }

  const out = await withRun("split-bidi-rx", { vendor, candidates: ok.length, norm_v: NORM_VERSION }, async (runId) => {
    let written = 0;
    for (const p of ok) {
      const e: SpecEntry = {
        k: "rx_wavelength", raw: p.r.raw, value: p.rx, unit: "nm", state: p.r.state as SpecEntry["state"],
        prov: { tier: p.r.tier, method: p.r.method, norm_v: NORM_VERSION,
          ...(p.r.doc_id ? { doc_id: p.r.doc_id } : {}), ...(p.r.locator ? { locator: p.r.locator } : {}),
          ...(p.r.extracted_at ? { extracted_at: p.r.extracted_at } : {}) },
      };
      await withTx(async (tx) => { await insertFact(tx, Number(p.r.part_id), e, runId); });
      written++;
    }
    return { stats: { written } };
  });
  const again = (await pool.query<Row>(SELECT, [vendor])).rows.length;
  console.log(`\n  written: ${out.stats?.written}`);
  console.log(`  selector re-run (MUST be ${bad.length}, the refused rows only): ${again}`);
  if (again !== bad.length) { console.error("  *** the selector still proposes rows it wrote ***"); process.exitCode = 1; }
  await closePool();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
