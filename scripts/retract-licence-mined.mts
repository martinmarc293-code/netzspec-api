/**
 * Retract specifications that description_mining read out of a LICENCE's own name.
 *
 *     npx tsx scripts/retract-licence-mined.mts [--commit] [--vendor cisco]
 *
 * WHY. `description_mining` reads a spec out of a part's name, which is sound for a product and
 * wrong for a licence: a licence's name describes the DEVICE IT LICENSES, so the miner attributes
 * the device's specification to the entitlement. Three shapes of it, all live before this ran:
 *
 *   A9K-400G-OPT-LIC   "Advanced Optical license to activate G.709 and FEC per 400G modular
 *                       line card"                          -> switching_capacity 400
 *   LL-C3850-24S-S=    "Catalyst 3850 family 24 GE / SFP IOS IP Base sw relicense"
 *                                                            -> ports [{anzahl: 24, sfp}]
 *   CBR-SUP-100G-LIC   "100G WAN License (Sup 250G only)"    -> switching_capacity 100
 *
 * This is the family D:\Project\CLAUDE.md already records — "an upgrade kit reporting the 96 ports
 * of the chassis it upgrades, a licence reporting its licensed chassis" — surfacing again because
 * round 4 of the product-class table finally told the store which parts are licences. It could not
 * have been found before: while the part said `hardware`, a port count on it looked correct.
 *
 * THE PREDICATE IS THE PART'S CLASS, NOT A SKU LIST. A fact is retracted if and only if it is a
 * live, non-inherited, description_mining fact on a part whose product_class is `license`.
 * Nothing is matched by SKU shape, so the day a part is reclassified back to hardware this script
 * stops proposing its facts, and there is no list to keep in step. The corollary is that it must
 * be re-run after any reclassify: that is the point, not a caveat.
 *
 * THE SCOPE WIDENED ON 10 SEP 2026, AND ONLY BECAUSE THE CLASSES WERE FIXED FIRST. This started
 * as `product_class <> 'hardware'` and the dry run refused it: UCSW-SD960G0KA4-C "960GB 2.5 inch
 * SATA SSD" and UCSW-PCIE-Q2562 "Qlogic QLE2562 8Gb HBA" were classed `license`, so retracting
 * their mined specs would have deleted CORRECT data and propagated a class defect into the facts.
 * It was narrowed to `license` plus three device-capacity fields.
 *
 * Those 404 parts have since been corrected to `hardware` (three bad tokens in ucsKind's
 * os-license set, plus E-SSD- under the round-1 `E-` prefix), so the wider predicate is now safe
 * and it is the right one: a TRACER is no more capable of having a storage capacity than a licence
 * is. TR-EZ8-M16G-8 "16GB DDR4-2133-MHz RDIMM 8Pk Tracer" -> dram 16 is the same error as
 * ISR4321-DNA "Cisco ISR 4321 (2GE,2NIM,4G FLASH,4G DRAM)" -> dram 4.
 *
 * The ORDER matters and is the reusable part: fix what a part IS before retracting what it says.
 * Run the other way round, this script would have destroyed 34 correct facts.
 *
 * IT REFUSES ITS OWN OUTPUT. `retractFact` writes a superseding row with `raw = ''` and
 * `method = 'retracted:<rule>'`. A selector on "has a raw" would match that empty string back —
 * the `raw IS NOT NULL` trap this repo has already paid for — so the selector keys on
 * `method = 'description_mining'` exactly, which a retraction row can never carry. Proven below by
 * re-running the selector after the write and asserting it returns zero.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";

type Row = {
  id: string; sku: string; name: string | null; field_key: string;
  value: string; cat: string | null; pc: string;
};

const SELECT = `
  SELECT f.id::text, p.sku, p.name, f.field_key, left(f.value::text, 40) AS value,
         ct.slug AS cat, p.product_class::text AS pc
    FROM facts f
    JOIN parts p ON p.id = f.part_id
    JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN categories ct ON ct.id = p.category_id
   WHERE f.superseded_at IS NULL
     AND NOT f.inherited
     AND f.method = 'description_mining'
     AND p.product_class <> 'hardware'
     -- PHYSICAL AND CAPACITY FIELDS ONLY. (No backticks below: this SQL is a JS template literal,
     -- and a backtick in a comment ends the string. Same defect as src/api/queries/gaps.ts.)
     -- IDENTITY AND APPLICABILITY ARE DELIBERATELY ABSENT: a licence for an MDS 9100 legitimately
     -- has series "MDS 9100" (68 rows), a min_software_release (25) and a product_compatibility
     -- (2). Those are what a licence IS FOR, not measurements of it. What is listed below is the
     -- set where a non-product cannot have a value of its own, so the number in its name always
     -- belongs to the device it licenses or tracks.
     -- cable_length added 11 Sep 2026: three family placeholders (QSFP-H40G-CUxM "length x - 1m to 5m")
     -- held cable_length = 1, the FIRST number of the family's range, mined from a row that is not a cable.
     AND f.field_key IN ('switching_capacity', 'ports', 'module_slots', 'data_rate',
                         'storage_capacity', 'dram', 'flash', 'cpu', 'power_max', 'weight',
                         'dimensions', 'rack_units', 'form_factor', 'reach_max', 'wavelength',
                         'memory_speed_max', 'psu_rated_output', 'poe_standard', 'temp_operating',
                         'cable_length')
     AND p.retired_at IS NULL
     AND ($1::text IS NULL OR v.slug = $1)
   ORDER BY p.sku`;

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const vi = process.argv.indexOf("--vendor");
  const vendor = vi >= 0 ? process.argv[vi + 1] : null;
  const pool = getPool();

  const { rows } = await pool.query<Row>(SELECT, [vendor]);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — mined specs on non-hardware parts${vendor ? ` (${vendor})` : ""}`);
  console.log(`  candidates: ${rows.length}`);
  const byClass = new Map<string, number>();
  const byField = new Map<string, number>();
  for (const r of rows) {
    byClass.set(r.pc, (byClass.get(r.pc) ?? 0) + 1);
    byField.set(r.field_key, (byField.get(r.field_key) ?? 0) + 1);
  }
  console.log(`  by class: ${[...byClass].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  by field: ${[...byField].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  // EVERY row is printed, not a sample. The whole point of this pass is that a human can read the
  // name beside the value and see that the value belongs to a different product.
  for (const r of rows) {
    console.log(`   ${r.sku.padEnd(24)} ${r.field_key.padEnd(20)} = ${r.value.padEnd(30)} <- "${String(r.name ?? "").slice(0, 56)}"`);
  }

  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }
  if (rows.length === 0) { console.log("nothing to do"); await closePool(); return; }

  const out = await withRun("retract-licence-mined", { vendor, rule: "licence-mined-spec", candidates: rows.length },
    async (runId) => {
      let retracted = 0;
      for (const r of rows) { await retractFact(pool, Number(r.id), "licence-mined-spec", runId); retracted++; }
      return { stats: { retracted } };
    });

  // THE SELECTOR MUST REJECT ITS OWN OUTPUT, or a second run retracts its own retractions for ever.
  const after = await pool.query<Row>(SELECT, [vendor]);
  console.log(`\n  retracted: ${out.stats?.retracted}`);
  console.log(`  selector re-run (MUST be 0, or this pass would repeat itself): ${after.rows.length}`);
  if (after.rows.length !== 0) {
    console.error("  *** the selector still matches after the write — do not re-run this script ***");
    process.exitCode = 1;
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
