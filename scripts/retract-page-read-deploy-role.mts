/**
 * scripts/retract-page-read-deploy-role.mts — withdraw every PAGE-READ fact under `deploy_role`.
 *
 *     npx tsx scripts/retract-page-read-deploy-role.mts [--commit]
 *
 * WHY THESE ROWS CANNOT BE RIGHT, whatever they say. `deploy_role` is layer 3 of the kind model: DERIVED by
 * src/core/deployRole.ts, registered in DERIVED_FILL_PATHS, listed in COLUMN_BACKED, and its dictionary entry
 * says "never read from a page". Nothing enforced that. Two header aliases pointed at it
 * (`^primary application$` on switches, `^deployment modes$` on transceiver) and a synonym table in
 * specNormalize mapped datasheet prose onto it, so a document cell could become a fact. Five did.
 *
 * The selector is therefore the CONDITION, not the two rows that were noticed: any current, non-retracted
 * fact under this key is by construction a second writer, because the derivation never writes facts — it is
 * read at request time. recompute-completeness already agrees in writing (`delete values.deploy_role`, "5
 * legacy html_table facts hold a deploy_role"), so these rows are inert in every score; what they are NOT
 * inert in is the API, which serves all five as facts contradicting the same record's derived role.
 *
 * Measured 26 Sep 2026 across ALL vendors before writing — 5 facts, every one Cisco, every one html_table
 * run 6, every one on a part the derivation gives NO ROLE AXIS:
 *     WS-X6516-GE-TX  linecard   "datacenter-tor"  raw "Data center and server farm"   German cell null
 *     WS-X6748-GE-TX  linecard   "datacenter-tor"  raw "Data center and server farm"   German cell null
 *     C9800-40-K9     wlc        "access"          raw "Centralized, Cisco FlexConnect, and Fabric
 *     C9800-CL-K9     unknown    "access"           Wireless (SD-Access)"              German cell "Access"
 *     SFP28           pluggable  "access"          (a TRANSCEIVER carrying a controller's sentence)
 * The three `access` rows came from the synonym table matching `access` MID-WORD inside "SD-Access", in a
 * list of three deployment modes a controller supports AT ONCE — a capability statement, not a role. They
 * are the dangerous ones: `access` is in the domain, so no reshape guard ever names them, and all three
 * render a clean German cell that would ship into a JTL attributes file.
 *
 * `gap_unattempted`, not `not_applicable`: only the notApplicable writer may close a gap, and this key is
 * COLUMN_BACKED so it is in nobody's required set either way.
 */
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { query, withTx, closePool } from "../src/store/db.js";
import { kindAndRole } from "../src/api/queries/shared.js";

const RULE = "page-read-value-for-a-derived-key";
const commit = process.argv.includes("--commit");

type Row = { id: string; part_id: string; sku: string; name: string | null; cat: string; vendor: string; value: string; raw: string | null; method: string; state: string; run_id: number };
const SELECT = `
  SELECT f.id::text, f.part_id::text, p.sku, p.name, c.slug cat, v.slug vendor,
         f.value::text value, f.raw, f.method, f.state::text state, f.run_id
    FROM facts f
    JOIN parts p ON p.id = f.part_id
    JOIN categories c ON c.id = p.category_id
    JOIN vendors v ON v.id = p.vendor_id
   WHERE f.field_key = 'deploy_role'
     AND f.superseded_by IS NULL
     AND f.method NOT LIKE 'retracted:%'
   ORDER BY v.slug, p.sku`;
// The method clause above is load-bearing: a retraction writes raw='', and '' is NOT NULL, so a selector
// written as `raw IS NOT NULL` would re-select this script's own output on every future run.

/** The verdict is a PURE function of the rows so the refusal below is reachable by a test. Its population is
 *  empty today (no stored value agrees with the derivation), and a guard whose population is empty has never
 *  fired — so `--selftest` feeds it a synthetic row through the REAL derivation instead of trusting silence. */
type Cand = Row & { kind: string | null; role: string | null; stored: string; agrees: boolean };
export function classify(rows: Row[]): Cand[] {
  return rows.map((r) => {
    const kr = kindAndRole(r.cat, r.sku, r.name);
    const stored = JSON.parse(r.value) as string;
    return { ...r, kind: kr.kind ?? null, role: kr.deploy_role, stored, agrees: kr.deploy_role !== null && kr.deploy_role === stored };
  });
}
/** A row the derivation AGREES with is not this script's business: withdrawing it would be a no-op on the
 *  served value but would hide a real page reading. Refuse the WHOLE run rather than write part of it. */
export function refusal(cands: Cand[]): string | null {
  const agree = cands.filter((c) => c.agrees);
  return agree.length
    ? `${agree.length} row(s) carry a value the derivation also produces (${agree.map((c) => `${c.sku}=${c.stored}`).join(", ")}). `
      + `This script withdraws page reads that CONTRADICT or have no axis; an agreeing row is a decision for a person.`
    : null;
}

if (process.argv.includes("--selftest")) {
  const syn = (sku: string, cat: string, value: string): Row => ({
    id: "0", part_id: "0", sku, name: null, cat, vendor: "cisco",
    value: JSON.stringify(value), raw: "synthetic", method: "html_table", state: "verified", run_id: 0,
  });
  // These run through the REAL kindAndRole, so the fixture cannot encode a relationship the code does not have.
  const agreeing = classify([syn("WS-C3750G-48TS-S", "switches", "access")]);      // derivation: switch -> access
  const noAxis = classify([syn("WS-X6516-GE-TX", "switches", "datacenter-tor")]);  // derivation: linecard -> null
  const disagreeing = classify([syn("WS-C3750G-48TS-S", "switches", "datacenter")]); // derivation says access
  const checks: [string, boolean][] = [
    [`CONTROL the derivation places the fixture part at all (got ${JSON.stringify(agreeing[0].role)})`, agreeing[0].role === "access"],
    ["an AGREEING row refuses the run", refusal(agreeing) !== null],
    ["a NO-AXIS row does not refuse", refusal(noAxis) === null],
    ["a DISAGREEING row does not refuse", refusal(disagreeing) === null],
    ["the refusal names the sku and the value", (refusal(agreeing) ?? "").includes("WS-C3750G-48TS-S=access")],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok  " : "MISS"} ${n}`);
  console.log(`  selftest: ${checks.length - bad.length}/${checks.length}`);
  await closePool();
  process.exit(bad.length ? 1 : 0);
}

const cands = classify((await query<Row>(SELECT)).rows);
console.log(`${commit ? "COMMIT" : "DRY RUN"} — page-read facts under the derived key deploy_role: ${cands.length}\n`);
for (const c of cands) {
  console.log(`  fact ${c.id.padStart(7)}  ${c.vendor}/${c.sku.padEnd(18)} ${c.cat}`);
  console.log(`      stored ${JSON.stringify(c.stored).padEnd(18)} method=${c.method} state=${c.state} run=${c.run_id}`);
  console.log(`      raw    ${JSON.stringify((c.raw ?? "").slice(0, 78))}`);
  console.log(`      derivation: kind=${JSON.stringify(c.kind)} deploy_role=${JSON.stringify(c.role)}`
    + `  -> ${c.agrees ? "*** AGREES — a human must look, not this script ***" : c.role === null ? "no role axis for this kind" : "DISAGREES"}`);
}
if (!cands.length) { console.log("nothing to do — the selector rejects its own output, which is the point"); await closePool(); process.exit(0); }

const why = refusal(cands);
if (why) { console.error(`\n*** REFUSED: ${why}`); await closePool(); process.exit(1); }
console.log(`\n  ${cands.filter((c) => c.role === null).length} of ${cands.length} are on a part with NO role axis; `
  + `${cands.filter((c) => c.agrees).length} agree with the derivation (must be 0).`);
const rows = cands;
if (!commit) { console.log("\nnothing written. re-run with --commit"); await closePool(); process.exit(0); }

const out = await withRun("retract-page-read-deploy-role",
  { rule: RULE, key: "deploy_role", candidates: rows.length, skus: rows.map((r) => `${r.vendor}/${r.sku}`) },
  async (runId) => {
    let retracted = 0;
    for (const r of rows) {
      await withTx(async (tx) => { await retractFact(tx, Number(r.id), RULE, runId); });
      retracted++;
    }
    return { stats: { retracted, key: "deploy_role" } };
  });

// The write is not believed from the write. Re-run the selector: it must now return nothing, which also
// proves the retraction rows do not match it (the `''` trap above).
const left = (await query<Row>(SELECT)).rows;
console.log(`\n  run ${out.runId}: retracted ${JSON.stringify(out.stats)}`);
console.log(`  selector re-run, page-read deploy_role facts left (MUST be 0): ${left.length}`);
if (left.length) { console.error("  *** the selector still returns rows after the write ***"); process.exitCode = 1; }
await closePool();
