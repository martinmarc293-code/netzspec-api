/**
 * Complete the withdrawals that two scripts started and never made visible.
 *
 *     npx tsx scripts/restamp-orphan-withdrawals.mts [--commit] [--ceiling N] [--limit N]
 *
 * RUN IT ON THE BOX, NOT THROUGH THE TUNNEL. `retractFact` costs ~4 round trips per row, so 3,790
 * rows is ~15,000 statements: about a second on the box (0.13 ms a query) and over an HOUR across
 * the ~300 ms dev tunnel. An hour-long write run is the exact shape CLAUDE.md warns about — a
 * process that dies mid-pass leaves facts current under a run that never closed, which is handoff
 * item 3's open problem. Use a `git archive` of a named commit, as the heavy passes do.
 *
 * `--limit N` exists for the same reason and is safe BY CONSTRUCTION: every row is independent and
 * the selector rejects its own output, so running it repeatedly in chunks converges on the same
 * end state as one pass. Prefer several short runs over one long one if the tunnel is the only
 * route available.
 *
 * WHY. `scripts/remap-cpu-power-to-tdp.mts` and `scripts/retract-group-inherited.mts` withdrew facts
 * by writing `superseded_at = now()` ALONE. Every reader in this repo — `currentFacts`, `factRows`,
 * `SUMMARY_FROM`, ~50 files — filters on `superseded_by IS NULL` and no reader consults
 * `superseded_at`, so the withdrawals never took effect. Measured 16 Sep 2026:
 *
 *     superseded_at set, superseded_by NULL            3,790
 *     the reverse (a supersession with no timestamp)       0     <- the defect is one-directional
 *     of the 3,790, passing every clause of factRows    3,186     <- served by the API today
 *     of the 3,790, holding a withdrawal row                0     <- never properly retracted
 *     live parts serving BOTH power_max and tdp         1,571     (1,548 with the IDENTICAL raw)
 *
 * That last line is the user-visible damage: the remap created the `tdp` successor and its
 * withdrawal of `power_max` silently did nothing, so both are served with the same number.
 *
 * IT CALLS `retractFact`, AND THE FIRST VERSION OF THIS SCRIPT DID NOT — WHICH WAS THE SAME MISTAKE
 * THE TWO SCRIPTS MADE. That version hand-wrote `superseded_by = id`, citing `facts.ts:188` as a
 * "retired in place" idiom. It is not: line 188 is the PARK step INSIDE `supersedeFact`, overwritten
 * seven lines later with the real successor id, which is why production holds 0 such rows at rest.
 * The canonical retraction writes a WITHDRAWAL ROW — `raw=''`, `state=gap_unattempted`,
 * `method=retracted:<rule>` — and points the old row at it. That path has been used **10,071 times**
 * in this store. Self-superseding would have hidden the fact while recording no gap, so completeness
 * would count the cup as never-asked rather than as withdrawn. Three copies of a helper is three
 * copies of the same bug; this is the copy, deleted.
 *
 * THE RULE NAMES THE ORIGINAL INTENT, not this repair, so the withdrawal rows read like the ones the
 * two scripts should have written: `rekeyed-to-tdp` for the remap's `power_max` rows (matching the
 * existing `retracted:rekeyed-to-psu_rated_output`), `group-inherited` for the rest. The split is
 * asserted to cover every candidate exactly once.
 *
 * WHAT THIS DOES NOT DO. It does not decide whether the withdrawals were right. Both scripts ran
 * deliberately, under a run, with their reasons recorded; this only completes them. Running it
 * REMOVES ~3,186 facts from what the API serves, which is a content change — so it is dry-run by
 * default and the `--commit` is the operator's.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";

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

// A row that HAS a live same-field successor was superseded, not withdrawn, and retracting it would
// write a gap over a value that was replaced. Measured 0 on 16 Sep; re-checked here rather than
// quoted, because a paragraph is not a guard.
const WITH_SUCCESSOR = `
  SELECT count(*)::text AS n FROM facts o
   WHERE o.superseded_by IS NULL AND o.superseded_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM facts n WHERE n.part_id = o.part_id AND n.field_key = o.field_key
                   AND n.id <> o.id AND n.superseded_by IS NULL AND n.superseded_at IS NULL)`;

/** Which script withdrew this row, and therefore which rule its withdrawal row should name. */
function ruleFor(r: Row): string {
  return r.field_key === "power_max" && r.method === "description_mining" ? "rekeyed-to-tdp" : "group-inherited";
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const ci = process.argv.indexOf("--ceiling");
  const ceiling = ci >= 0 ? Number(process.argv[ci + 1]) : 4000;
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? Number(process.argv[li + 1]) : Infinity;
  const pool = getPool();

  const all = await pool.query<Row>(SELECT);
  // The ceiling is checked against the WHOLE population, not the limited slice, or `--limit` would
  // silently disable it — a guard you can switch off with an unrelated flag is not a guard.
  const rows = Number.isFinite(limit) ? all.rows.slice(0, limit) : all.rows;
  if (Number.isFinite(limit)) console.log(`  --limit ${limit}: taking ${rows.length} of ${all.rows.length} candidates this pass`);
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
  console.log(`  withdrawal rule:    ${by(ruleFor).map(([k, v]) => `retracted:${k}=${v}`).join(" ")}`);

  // THE GUARDS, checked live rather than quoted from the header.
  const successors = Number((await pool.query<{ n: string }>(WITH_SUCCESSOR)).rows[0].n);
  console.log(`  rows that HAVE a live same-field successor: ${successors} (must be 0)`);
  if (successors !== 0) {
    console.error("  *** some rows were SUPERSEDED, not withdrawn. Retracting them would write a gap over a");
    console.error("      replaced value. The population has changed since this was measured; do not run this.");
    process.exitCode = 1; await closePool(); return;
  }
  const ruled = rows.filter((r) => ruleFor(r) === "rekeyed-to-tdp").length + rows.filter((r) => ruleFor(r) === "group-inherited").length;
  if (ruled !== rows.length) {
    console.error(`  *** the rule split covers ${ruled} of ${rows.length} rows — it must cover every one exactly once.`);
    process.exitCode = 1; await closePool(); return;
  }
  if (all.rows.length > ceiling) {
    console.error(`  *** ${all.rows.length} candidates exceeds the ceiling of ${ceiling}. Re-measure before raising it.`);
    process.exitCode = 1; await closePool(); return;
  }

  if (!commit) {
    console.log("\n  a sample spread through the population (not its head):");
    const step = Math.max(1, Math.floor(rows.length / 8));
    for (let i = 0; i < rows.length; i += step) {
      const r = rows[i];
      console.log(`   #${String(i).padStart(5)} ${r.sku.padEnd(24)} ${r.field_key.padEnd(20)} ${r.method.padEnd(18)} ${r.served ? "SERVED" : "hidden"}  -> retracted:${ruleFor(r)}`);
    }
    console.log("\nnothing written. re-run with --commit");
    await closePool(); return;
  }

  const out = await withRun("restamp-orphan-withdrawals",
    { rule: "superseded_at-without-superseded_by", candidates: rows.length, served_before: served,
      cause: "remap-cpu-power-to-tdp.mts and retract-group-inherited.mts wrote superseded_at alone (fixed dc303a3)" },
    async (runId) => {
      let retracted = 0;
      // retractFact writes the withdrawal row and points the old row at it — the same path the two
      // scripts should have called. One row at a time, because supersedeFact re-reads each row and
      // refuses one that is no longer current.
      for (const r of rows) { await retractFact(pool, Number(r.id), ruleFor(r), runId); retracted++; }
      return { stats: { retracted } };
    });

  // READ IT BACK FROM A FRESH QUERY. The count an UPDATE reports is what it believed it did.
  // And THE SELECTOR MUST REJECT ITS OWN OUTPUT: after this, superseded_by names the withdrawal row,
  // so a second run matches nothing. A repair whose output its own selector still matches runs for ever.
  const after = await pool.query<Row>(SELECT);
  console.log(`\n  retracted: ${out.stats?.retracted}`);
  // With --limit the remainder is EXPECTED to still match: that is the chunking working, not a
  // repeating pass. The assertion is that this pass removed exactly what it retracted.
  const expected = all.rows.length - rows.length;
  console.log(`  selector re-run: ${after.rows.length}  (expected ${expected}${expected ? " — the --limit remainder; re-run to continue" : ", i.e. none"})`);
  if (after.rows.length !== expected) {
    console.error(`  *** the selector matches ${after.rows.length} rows, expected ${expected}. Either the write did not`);
    console.error("      take, or this pass produces rows its own selector still matches. Do not re-run it.");
    process.exitCode = 1;
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
