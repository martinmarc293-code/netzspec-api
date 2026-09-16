// scripts/retract-group-inherited.mts — retract physical facts a GROUP default sprayed onto parts.
//
// THE DEFECT. `facts.inherited_from` is supposed to name the part a value was inherited FROM. In
// servers-unified-computing it names a GROUP every single time — `ucs-x-series-modular-system`,
// `ucs-c-series-rack-servers` — and there is no part-to-part inheritance anywhere in the category:
//
//     inherited facts whose source is a real part sku :     0
//     inherited facts whose source is a group         : 3,110   (878 of them physical)
//
// So a CPU carries the chassis's operating temperature, and a DIMM carries its humidity range. It
// is not merely wrong per part: `temp_operating` has TWO distinct values across 277 parts and
// `certifications` has ONE across 38, which is what a machine-level table row looks like after it
// has been copied down a parts list.
//
// WHY ONLY THE PHYSICAL ONES. A component genuinely has no weight, dimensions, rack height, form
// factor, operating temperature, humidity range or power draw of its own that a machine's document
// could state — those belong to the enclosure. The other 2,232 group-sourced facts are NOT
// obviously copies: a CPU's core count read from a machine's "CPU options" table IS the CPU's own
// specification, quoted in the machine's document. Those are left alone deliberately and need the
// per-part-value test before anyone touches them.
//
// SUPERSEDE, NEVER DELETE OR OVERWRITE. `facts` is append-only by design (CLAUDE.md hard rule) and
// there is no `invalid` state in the fact_state enum, so the retraction is a supersession: the row
// stays, `superseded_at` is set, and every read path already filters on it. The provenance survives,
// which is what lets a legitimate relation re-derive any of these later.
//
// Usage:  npx tsx scripts/retract-group-inherited.mts            (dry run)
//         npx tsx scripts/retract-group-inherited.mts --commit
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

/** Fields that belong to an enclosure and cannot be a property of a part inside it. */
const PHYSICAL = [
  "weight", "dimensions", "rack_units", "form_factor",
  "temp_operating", "temp_storage", "humidity_operating", "humidity_storage",
  "altitude_max", "altitude_storage", "power_max", "acoustic_noise",
];

const CATEGORY = "servers-unified-computing";

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();

  // The predicate: inherited, in this category, a physical field, on a part that is NOT a machine,
  // and whose `inherited_from` is not a real part sku. The last clause is the structural one — it
  // is what the FK the reviewer proposes would enforce, expressed as a filter until it exists.
  const where = `
      f.superseded_at IS NULL
      AND f.inherited
      AND ct.slug = $1
      AND v.slug = 'cisco'
      AND f.field_key = ANY($2)
      AND f.inherited_from = ANY($3)`;

  // THE GROUP LIST IS RESOLVED ONCE, NOT PER ROW. The first version tested
  // `NOT EXISTS (SELECT 1 FROM parts WHERE lower(sku) = lower(f.inherited_from))` inline and hit
  // the statement timeout: that is a correlated scan of 87,083 parts with no index on lower(sku),
  // for every candidate fact. There are only a handful of distinct sources, so they are listed,
  // checked against `parts` in ONE query, and the confirmed groups passed as an array. Same
  // predicate, and the check is now visible in the output instead of buried in a plan.
  const { rows: srcRows } = await pool.query<{ inherited_from: string; n: string }>(
    `SELECT f.inherited_from, count(*) n FROM facts f
       JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       JOIN categories ct ON ct.id = p.category_id
      WHERE f.superseded_at IS NULL AND f.inherited AND ct.slug = $1 AND v.slug = 'cisco'
        AND f.field_key = ANY($2)
      GROUP BY 1`, [CATEGORY, PHYSICAL]);
  const names = srcRows.map((r) => r.inherited_from);
  const { rows: realParts } = await pool.query<{ sku: string }>(
    `SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = 'cisco' AND lower(p.sku) = ANY($1)`,
    [names.map((n) => (n ?? "").toLowerCase())]);
  const isPart = new Set(realParts.map((r) => r.sku.toLowerCase()));
  const groups = names.filter((n) => !isPart.has((n ?? "").toLowerCase()));
  console.log(`  inherited_from values seen: ${names.length}`);
  console.log(`    resolve to a real part : ${names.length - groups.length}  (left alone)`);
  console.log(`    are GROUPS             : ${groups.length}  -> ${groups.slice(0, 4).join(", ")}`);
  if (groups.length === 0) { console.log("nothing to retract"); await closePool(); return; }

  const { rows: preview } = await pool.query<{
    field_key: string; inherited_from: string; n: string; dv: string;
  }>(`SELECT f.field_key, f.inherited_from, count(*) n, count(DISTINCT f.value::text) dv
        FROM facts f
        JOIN parts p ON p.id = f.part_id
        JOIN vendors v ON v.id = p.vendor_id
        JOIN categories ct ON ct.id = p.category_id
       WHERE ${where}
       GROUP BY 1, 2 ORDER BY count(*) DESC`, [CATEGORY, PHYSICAL, groups]);

  const total = preview.reduce((a, r) => a + Number(r.n), 0);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — retract group-inherited physical facts in ${CATEGORY}`);
  console.log(`  ${"field".padEnd(22)}${"source (a GROUP, not a part)".padEnd(32)}${"facts".padStart(7)}${"values".padStart(8)}`);
  for (const r of preview.slice(0, 16)) {
    console.log(`  ${r.field_key.padEnd(22)}${r.inherited_from.slice(0, 31).padEnd(32)}` +
                `${String(r.n).padStart(7)}${String(r.dv).padStart(8)}`);
  }
  console.log(`  ${"".padEnd(54)}${"-".repeat(7)}`);
  console.log(`  ${"TOTAL".padEnd(54)}${String(total).padStart(7)}`);

  if (!commit) {
    console.log("\nnothing written. re-run with --commit");
    await closePool();
    return;
  }

  const out = await withRun("retract-group-inherited",
    { category: CATEGORY, fields: PHYSICAL, reason: "inherited_from names a group, not a part" },
    async (runId) => {
      // superseded_by = f.id is the store's RETIRED-IN-PLACE idiom (src/store/facts.ts:188). A
      // retraction withdraws with no successor, so superseded_by points at the row itself; the
      // supersession-consistency checks exclude that case on purpose (invariants.test.ts:120,
      // hygiene.test.ts:395, both `o.superseded_by <> o.id`). Setting superseded_at ALONE — which
      // this script did until 16 Sep 2026 — withdraws nothing: every reader filters on
      // superseded_by IS NULL and no reader consults superseded_at.
      const { rowCount } = await pool.query(
        `UPDATE facts f SET superseded_by = f.id, superseded_at = now()
           FROM parts p, vendors v, categories ct
          WHERE p.id = f.part_id AND v.id = p.vendor_id AND ct.id = p.category_id
            AND ${where}`, [CATEGORY, PHYSICAL, groups]);
      return { stats: { retracted: rowCount ?? 0, run: runId } };
    });

  // READ IT BACK FROM A FRESH QUERY. The count the UPDATE reports is what it believed it did.
  const { rows: after } = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM facts f
       JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       JOIN categories ct ON ct.id = p.category_id
      WHERE ${where}`, [CATEGORY, PHYSICAL, groups]);
  console.log(`\n  retracted : ${out.stats?.retracted}`);
  console.log(`  remaining matching the predicate: ${after[0].n}   (must be 0)`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
