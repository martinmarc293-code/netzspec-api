/**
 * Complete the withdrawals that two scripts started and never made visible.
 *
 *     npx tsx scripts/restamp-orphan-withdrawals.mts [--commit] [--ceiling N]
 *
 * WHY. `scripts/remap-cpu-power-to-tdp.mts` and `scripts/retract-group-inherited.mts` withdrew facts
 * by writing `superseded_at = now()` ALONE. Every reader in this repo — `currentFacts`, `factRows`,
 * `SUMMARY_FROM`, ~50 files — filters on `superseded_by IS NULL` and no reader consults
 * `superseded_at`, so the withdrawals never took effect. Both scripts were fixed on 16 Sep 2026
 * (commit `dc303a3`); this repairs the rows they had already written. Measured that night:
 *
 *     superseded_at set, superseded_by NULL            3,790
 *     the reverse (a supersession with no timestamp)       0     <- the defect is one-directional
 *     rows with superseded_by = id anywhere in prod        0     <- the canonical path never used
 *     of the 3,790, passing every clause of factRows    3,186     <- served by the API today
 *     live parts serving BOTH power_max and tdp         1,571     (1,548 with the IDENTICAL raw)
 *
 * That last line is the user-visible damage: the remap created the `tdp` successor and its
 * withdrawal of `power_max` silently did nothing, so both are served with the same number.
 *
 * WHY `superseded_by = id` AND NOT A POINTER TO A SUCCESSOR. That is the store's RETIRED-IN-PLACE
 * idiom (`src/store/facts.ts:188`): a retraction withdraws with no replacement, so the row points at
 * itself, and the supersession-consistency checks exclude that case on purpose
 * (`invariants.test.ts:120`, `hygiene.test.ts:395`, both `o.superseded_by <> o.id`). It is the right
 * pointer here because it was MEASURED to be: of the 3,790, **0** have a live current fact on the
 * same (part_id, field_key). The `tdp` row is a different field, so it is not `power_max`'s
 * successor. The guard below re-checks that at run time rather than trusting this paragraph — if the
 * population has changed and some row now HAS a same-field successor, self-supersession would be the
 * wrong pointer and the script refuses instead of guessing.
 *
 * WHAT THIS DOES NOT DO. It does not decide whether the withdrawals were right. Both scripts ran
 * deliberately, under a run, with their reasons recorded; this only makes their effect visible to
 * readers. Running it REMOVES ~3,186 facts from what the API serves, which is a content change — so
 * it is dry-run by default and the `--commit` is the operator's.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

type Row = { id: string; sku: string; field_key: string; raw: string; method: string; day: string; served: boolean };

// The rows two scripts withdrew without telling any reader.
const SELECT = `
  SELECT f.id::text AS id, p.sku, f.field_key, left(COALESCE(f.raw,''),40) AS raw,
         COALESCE(f.method,'') AS method, to_char(f.superseded_at,'YYYY-MM-DD') AS day,
         (p.retired_at IS NULL AND f.state::text IN ('verified','corroborated')
          AND EXISTS (SELECT 1 FROM field_dictionary d WHERE d.key = f.field_key)
          AND (f.run_id IS NULL OR EXISTS (SELECT 1 FROM runs r WHERE r.id = f.run_id AND r.status = 'succeeded'))
         ) AS served
    FROM facts f JOIN parts p ON p.id = f.part_id
   WHERE f.superseded_by IS NULL AND f.superseded_at IS NOT NULL
   ORDER BY f.id`;

// A row that HAS a live same-field successor must not be self-superseded — its superseded_by should
// name that successor. Measured 0 on 16 Sep; if it is ever non-zero the population has changed and
// this script is the wrong tool, so it refuses rather than writing the easy answer.
const WITH_SUCCESSOR = `
  SELECT count(*)::text AS n FROM facts o
   WHERE o.superseded_by IS NULL AND o.superseded_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM facts n WHERE n.part_id = o.part_id AND n.field_key = o.field_key
                   AND n.id <> o.id AND n.superseded_by IS NULL AND n.superseded_at IS NULL)`;

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const ci = process.argv.indexOf("--ceiling");
  const ceiling = ci >= 0 ? Number(process.argv[ci + 1]) : 4000;
  const pool = getPool();

  const { rows } = await pool.query<Row>(SELECT);
  console.log(`${commit ? "COMMIT" : "DRY RUN"} — facts withdrawn with superseded_at but no superseded_by`);
  console.log(`  candidates: ${rows.length}   (measured 3,790 on 16 Sep 2026)`);
  if (rows.length === 0) { console.log("  nothing to do — every withdrawal is visible to readers"); await closePool(); return; }

  const served = rows.filter((r) => r.served).length;
  console.log(`  of those, SERVED by the API today: ${served}  <- this many facts stop being returned`);

  const by = (f: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(`  by withdrawal date: ${by((r) => r.day).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  by method:          ${by((r) => r.method).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  by field:           ${by((r) => r.field_key).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  // THE GUARD, checked live rather than quoted from the header.
  const successors = Number((await pool.query<{ n: string }>(WITH_SUCCESSOR)).rows[0].n);
  console.log(`  rows that HAVE a live same-field successor: ${successors} (must be 0)`);
  if (successors !== 0) {
    console.error("  *** some rows have a real successor, so superseded_by = id is the WRONG pointer for them.");
    console.error("      The population has changed since this was measured. Do not run this script.");
    process.exitCode = 1; await closePool(); return;
  }
  if (rows.length > ceiling) {
    console.error(`  *** ${rows.length} candidates exceeds the ceiling of ${ceiling}. Re-measure before raising it.`);
    process.exitCode = 1; await closePool(); return;
  }

  if (!commit) {
    console.log("\n  a sample spread through the population (not its head):");
    const step = Math.max(1, Math.floor(rows.length / 8));
    for (let i = 0; i < rows.length; i += step) {
      const r = rows[i];
      console.log(`   #${String(i).padStart(5)} ${r.sku.padEnd(24)} ${r.field_key.padEnd(20)} ${r.method.padEnd(18)} ${r.served ? "SERVED" : "hidden"}  raw=${JSON.stringify(r.raw)}`);
    }
    console.log("\nnothing written. re-run with --commit");
    await closePool(); return;
  }

  const out = await withRun("restamp-orphan-withdrawals",
    { rule: "superseded_at-without-superseded_by", candidates: rows.length, served_before: served,
      cause: "remap-cpu-power-to-tdp.mts and retract-group-inherited.mts wrote superseded_at alone (fixed dc303a3)" },
    async () => {
      const ids = rows.map((r) => Number(r.id));
      const r = await pool.query("UPDATE facts SET superseded_by = id WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [ids]);
      return { stats: { restamped: r.rowCount ?? 0 } };
    });

  // READ IT BACK FROM A FRESH QUERY. The count an UPDATE reports is what it believed it did.
  // And THE SELECTOR MUST REJECT ITS OWN OUTPUT: after this, superseded_by is set, so a second run
  // matches nothing. A repair whose output its own selector still matches runs for ever.
  const after = await pool.query<Row>(SELECT);
  console.log(`\n  restamped: ${out.stats?.restamped}`);
  console.log(`  selector re-run (MUST be 0, or this pass would repeat itself): ${after.rows.length}`);
  if (after.rows.length !== 0) {
    console.error("  *** the selector still matches after the write — do not re-run this script ***");
    process.exitCode = 1;
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
