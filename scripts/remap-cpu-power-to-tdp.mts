// scripts/remap-cpu-power-to-tdp.mts — a processor's wattage is its TDP, not the machine's draw.
//
// `power_max` is "Max power draw" — what a device pulls from the wall, banded 1..30000 W. A CPU
// does not draw from the wall; its wattage is Thermal Design Power, the heat the cooling system
// must remove. Both are watts, which is why nothing refused the value, and the two mean different
// things to anyone comparing servers.
//
// MEASURED BEFORE WRITING. Every power_max fact in servers-unified-computing — 1,571 of 1,571 —
// sits on kind=cpu, and 1,553 of them carry an explicit wattage in the part's OWN name
// ("Intel Xeon X5690 3.46GHz /6c/130W/12MB cache"). There is no ambiguous subset to argue about.
//
// HOW THIS SURFACED, because it is the useful part. The reviewer's residue machine-hunt asked
// which parts carry an OWN PHYSICAL fact, expecting to find hidden servers. It found two CPUs
// instead — and the wrong field was invisible until something asked what KIND of part carries a
// processor wattage. It also exposed a mistake of mine: `A01-*` was classed `nic`, added from two
// SKUs in a residue listing without reading their names. All 24 are Xeons.
//
// APPEND-ONLY. The power_max row is SUPERSEDED and a tdp row inserted carrying the same value,
// unit, raw, document, locator and tier — not an UPDATE of field_key, because `facts` is
// append-only by design and the old claim is part of the record of how this was fixed.
//
// Usage:  npx tsx scripts/remap-cpu-power-to-tdp.mts            (dry run)
//         npx tsx scripts/remap-cpu-power-to-tdp.mts --commit
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { ucsKind } from "../src/core/ucsKind.js";

type F = {
  id: string; part_id: string; sku: string; name: string | null; value: unknown;
  unit: string | null; raw: string; state: string; tier: number; method: string;
  doc_id: string | null; locator: string | null; extracted_at: string | null; norm_v: number | null;
};

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const pool = getPool();

  const { rows } = await pool.query<F>(`
    SELECT f.id, f.part_id, p.sku, p.name, f.value, f.unit, f.raw, f.state::text AS state,
           f.tier, f.method::text AS method, f.doc_id, f.locator,
           f.extracted_at::text AS extracted_at, f.norm_v
      FROM facts f
      JOIN parts p ON p.id = f.part_id
      JOIN vendors v ON v.id = p.vendor_id
      JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = 'cisco' AND ct.slug = 'servers-unified-computing'
       AND f.superseded_at IS NULL AND NOT f.inherited AND f.field_key = 'power_max'`);

  // The kind is recomputed HERE rather than trusted from the query: the whole point is that this
  // set is CPUs, and a row that is not one must be left alone rather than re-keyed on faith.
  const cpuRows = rows.filter((r) => ucsKind(r.sku) === "cpu");
  const notCpu = rows.filter((r) => ucsKind(r.sku) !== "cpu");

  // IDEMPOTENCE, guarded on the CONDITION rather than on the predicate above (16 Sep 2026). This script
  // INSERTs a tdp row per CPU and nothing stopped it inserting a SECOND one. It is safe to re-run today
  // only by accident: its selection uses `superseded_at IS NULL`, which happens to exclude the 1,571
  // CPU power_max rows its first run orphaned. The tempting "consistency" fix — `superseded_by IS NULL`,
  // the store's own current-fact predicate — would select all 1,571 again and insert 1,571 duplicate tdp
  // facts. So the guard is on what must never happen, whatever selects the rows: a part that already
  // holds a current tdp is never given another.
  const { rows: hasTdp } = await pool.query<{ part_id: string }>(
    `SELECT DISTINCT part_id::text AS part_id FROM facts
      WHERE field_key = 'tdp' AND superseded_by IS NULL AND part_id = ANY($1::bigint[])`,
    [cpuRows.map((r) => r.part_id)]);
  const alreadyTdp = new Set(hasTdp.map((r) => r.part_id));
  const cpus = cpuRows.filter((r) => !alreadyTdp.has(String(r.part_id)));
  const skippedHasTdp = cpuRows.length - cpus.length;

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — power_max -> tdp on CPUs`);
  console.log(`  power_max facts in the category : ${rows.length}`);
  console.log(`  on kind=cpu                     : ${cpuRows.length}`);
  console.log(`    already holding a current tdp  : ${skippedHasTdp}  (skipped — never given a second)`);
  console.log(`    will be remapped               : ${cpus.length}`);
  console.log(`  on any other kind (LEFT ALONE)  : ${notCpu.length}`);
  for (const r of notCpu.slice(0, 5)) {
    console.log(`      left: ${r.sku} (${ucsKind(r.sku)}) ${String(r.name ?? "").slice(0, 44)}`);
  }
  console.log(`  sample: ${cpus.slice(0, 3).map((r) => `${r.sku}=${String(r.value)}W`).join(" · ")}`);

  if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); return; }
  if (cpus.length === 0) { console.log("nothing to do"); await closePool(); return; }

  const out = await withRun("remap-cpu-power-to-tdp",
    { category: "servers-unified-computing", from: "power_max", to: "tdp", kind: "cpu" },
    async (runId) => {
      let inserted = 0, superseded = 0;
      for (let i = 0; i < cpus.length; i += 400) {
        const b = cpus.slice(i, i + 400);
        const ins = await pool.query(
          `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method,
                              doc_id, locator, extracted_at, norm_v, inherited, run_id)
           SELECT part_id, 'tdp', value, unit, raw, state::fact_state, tier, method,
                  doc_id, locator, extracted_at::date, norm_v, false, $12
             FROM unnest($1::bigint[], $2::jsonb[], $3::text[], $4::text[], $5::text[],
                         $6::smallint[], $7::text[], $8::text[], $9::text[], $10::text[],
                         $11::int[])
                  AS u(part_id, value, unit, raw, state, tier, method, doc_id, locator,
                       extracted_at, norm_v)
           ON CONFLICT DO NOTHING`,
          [b.map((x) => x.part_id), b.map((x) => JSON.stringify(x.value)), b.map((x) => x.unit),
           b.map((x) => x.raw), b.map((x) => x.state), b.map((x) => x.tier), b.map((x) => x.method),
           b.map((x) => x.doc_id), b.map((x) => x.locator), b.map((x) => x.extracted_at),
           b.map((x) => x.norm_v), runId]);
        inserted += ins.rowCount ?? 0;
        // CALL THE STORE, do not hand-write the withdrawal. Until 16 Sep 2026 this wrote
        // `SET superseded_at = now()` alone, which withdraws NOTHING: every reader (currentFacts,
        // factRows, SUMMARY_FROM, ~50 files) filters on `superseded_by IS NULL` and no reader
        // consults superseded_at. Measured cost: 1,571 live parts served BOTH power_max and tdp,
        // 1,548 with the identical raw value — the successor landed and the withdrawal did not.
        //
        // The first repair of this line was ALSO hand-written (`superseded_by = id`, citing
        // facts.ts:188 as a "retired in place" idiom). That was wrong twice over: line 188 is the
        // PARK inside supersedeFact, overwritten seven lines later, which is why production holds 0
        // such rows at rest; and it would have hidden the fact while recording no gap, so the cup
        // would read never-asked rather than withdrawn. `retractFact` writes the withdrawal row
        // (`raw=''`, `gap_unattempted`, `method=retracted:<rule>`) and points this row at it — the
        // path 10,071 rows in this store already took.
        for (const x of b) { await retractFact(pool, Number(x.id), "rekeyed-to-tdp", runId); superseded++; }
      }
      return { stats: { tdp_inserted: inserted, power_max_superseded: superseded } };
    });

  const { rows: after } = await pool.query<{ pm: string; tdp: string }>(`
    SELECT count(*) FILTER (WHERE f.field_key = 'power_max') pm,
           count(*) FILTER (WHERE f.field_key = 'tdp') tdp
      FROM facts f JOIN parts p ON p.id = f.part_id
      JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = 'cisco' AND ct.slug = 'servers-unified-computing'
       AND f.superseded_at IS NULL AND NOT f.inherited`);
  console.log(`\n  inserted tdp      : ${out.stats?.tdp_inserted}`);
  console.log(`  superseded power_max: ${out.stats?.power_max_superseded}`);
  console.log(`  live now — power_max ${after[0].pm}, tdp ${after[0].tdp}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
