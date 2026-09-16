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
  const cpus = rows.filter((r) => ucsKind(r.sku) === "cpu");
  const notCpu = rows.filter((r) => ucsKind(r.sku) !== "cpu");

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — power_max -> tdp on CPUs`);
  console.log(`  power_max facts in the category : ${rows.length}`);
  console.log(`  on kind=cpu (will be remapped)  : ${cpus.length}`);
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
        // superseded_by = id is the store's RETIRED-IN-PLACE idiom (src/store/facts.ts:188): this
        // power_max row is WITHDRAWN, not replaced by another power_max, and the tdp row is a
        // different field so it is not this row's successor. Setting superseded_at ALONE — which
        // this script did until 16 Sep 2026 — withdraws nothing, because every reader
        // (currentFacts, factRows, SUMMARY_FROM, 50 files) filters on superseded_by IS NULL and
        // never looks at superseded_at. Measured cost of the old form: 1,571 live parts served
        // BOTH power_max and tdp, 1,548 of them with the identical raw value — the successor
        // landed and the withdrawal silently did not.
        const sup = await pool.query(
          "UPDATE facts SET superseded_by = id, superseded_at = now() WHERE id = ANY($1::bigint[])",
          [b.map((x) => x.id)]);
        superseded += sup.rowCount ?? 0;
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
