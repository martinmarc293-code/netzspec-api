/**
 * Re-run `classify()` over stored parts and correct the ones it no longer calls hardware,
 * retracting the family-level facts they should never have inherited. Dry run by default.
 *
 *     npx tsx scripts/reclassify-nonhardware.mts [--commit] [--sample 60] [--vendor cisco]
 *
 * WHY. `describesPart` refuses a family-level fact to any NON_PRODUCT_CLASSES part - licence,
 * software, service, accessory, bundle - and it is correct and tested. It never fired for 5,883
 * Cisco parts, because it tests `product_class` and `product_class` said hardware. A guard on the
 * wrong side of its own input: the same shape as ownership.py protecting a database used almost
 * entirely from TypeScript. The result was 2,878 SERVED inherited facts on licence SKUs -
 * certifications, temp_operating, altitude_max, qos_features, which is the exact list
 * specMerge's own docstring names as the symptom describesPart exists to stop. A licence with an
 * operating temperature range and an altitude ceiling is not a small error; it is confidently
 * wrong, and downstream it is indistinguishable from a right answer.
 *
 * THE PREDICATE IS THE CLASSIFIER ITSELF, which is what makes this safe to run again. A part is
 * corrected if and only if `classify()` TODAY disagrees with what is stored. Nothing is matched by
 * a hand-written SKU list, so adding a rule to productClass.ts is all that is needed to extend
 * this, and REMOVING a rule silently un-proposes its parts rather than leaving a list to drift.
 * That is deliberate: the round-2 notes record four rules rejected after a corpus replay, and a
 * hand-maintained list would have kept proposing them.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not read part NAMES. The names are what found this
 * (a licence says "NCS 5500 L2VPN Lic for NCS-5501-U" in its description and nothing in its SKU),
 * but a name rule was built, measured and abandoned - see the round-3 block in productClass.ts.
 * C9500-24Q-A= is "Catalyst 9500 24-port 40G, Adv. License, no PS", a real switch, and it is
 * structurally identical to a real licence. Five such parts are pinned as sabotage cases. The
 * safe predicate reaches about a fifth of the damage the unsafe one would have, and that is the
 * right trade: a wrong retraction destroys a real product's specifications.
 *
 * ONLY INHERITED FACTS ARE RETRACTED. A licence's own measured facts are a separate question (8
 * NC55P- parts carry one each, most likely a bandwidth figure read as a spec) and this command
 * does not touch them - it would be guessing about a different defect. They are counted and
 * reported so the number does not go missing.
 *
 * THE GATE, which is not decoration - `requiresGate()` fires on the `apply-` prefix:
 *   precision  a random sample of the parts about to be corrected is re-classified. Every one must
 *              still come back non-hardware. Correcting a part `classify()` calls hardware is the
 *              one way this can destroy a real product, and precision is the only thing that sees it.
 *   recall     tests/productClass.test.ts is run fresh AND its sabotage line must appear. The
 *              retraction is only as good as the rule justifying it, so an untested table must not
 *              be allowed to reclassify anything.
 */
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { classify } from "../src/core/productClass.js";
import { REPO_ROOT } from "../src/config.js";

type PartRow = {
  id: number; sku: string; vendor: string; stored: string;
  cat_slug: string | null; cat_is_hw: boolean | null;
  inherited_served: number; inherited_all: number; own: number;
};

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const vendor = argv.includes("--vendor") ? argv[argv.indexOf("--vendor") + 1] : null;
const sampleN = argv.includes("--sample") ? Number(argv[argv.indexOf("--sample") + 1]) : 60;
const CHUNK = 40;   // short transactions: the port retraction held row locks for minutes against a
                    // live apply in one go, which is the contention that produced 120 s timeouts.

const pool = getPool();
const { rows } = await pool.query<PartRow>(
  `SELECT p.id, p.sku, v.slug AS vendor, p.product_class::text AS stored,
          c.slug AS cat_slug, c.is_hardware AS cat_is_hw,
          (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL
             AND f.inherited AND f.state IN ('verified','corroborated')) AS inherited_served,
          (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL
             AND f.inherited) AS inherited_all,
          (SELECT count(*)::int FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL
             AND NOT f.inherited) AS own
     FROM parts p
     JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.retired_at IS NULL AND p.product_class = 'hardware'
      ${vendor ? "AND v.slug = $1" : ""}`,
  vendor ? [vendor] : []);

const doomed = rows
  .map((r) => ({ r, k: classify({ sku: r.sku, categorySlug: r.cat_slug, categoryIsHardware: r.cat_is_hw }) }))
  .filter((x) => x.k.klass !== "hardware" && x.k.klass !== "unknown")
  .map((x) => ({ ...x.r, klass: x.k.klass, reason: x.k.reason }));

const byRule: Record<string, number> = {};
const byClass: Record<string, number> = {};
for (const d of doomed) {
  byRule[d.reason] = (byRule[d.reason] ?? 0) + 1;
  byClass[d.klass] = (byClass[d.klass] ?? 0) + 1;
}
const factsServed = doomed.reduce((n, d) => n + d.inherited_served, 0);
const factsAll = doomed.reduce((n, d) => n + d.inherited_all, 0);
const ownFacts = doomed.reduce((n, d) => n + d.own, 0);

console.log(`hardware-classed parts examined : ${rows.length}`);
console.log(`classify() now disagrees        : ${doomed.length}`);
console.log(`  by class                      : ${JSON.stringify(byClass)}`);
console.log(`inherited facts to retract      : ${factsAll} (${factsServed} of them SERVED)`);
console.log(`their OWN facts, left untouched : ${ownFacts}   <- a separate defect, not this one`);
for (const [k, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`   ${String(n).padStart(4)}  ${k}`);
}

// ---- the gate ---------------------------------------------------------------------------------
// precision: re-classify a random sample. A part classify() calls hardware must NEVER be corrected.
const shuffled = [...doomed];
for (let i = 0; i < Math.min(sampleN, shuffled.length); i++) {
  const j = i + Math.floor(Math.random() * (shuffled.length - i));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, Math.min(sampleN, shuffled.length));
const stillNonHw = sample.filter((d) =>
  classify({ sku: d.sku, categorySlug: d.cat_slug, categoryIsHardware: d.cat_is_hw }).klass === d.klass).length;
const precision = sample.length ? stillNonHw / sample.length : 1;

// recall: the table that justifies this has to be tested, run fresh rather than assumed. The
// sabotage line is required BY NAME: a suite that passed without it would be a suite that had
// quietly lost the five counter-examples this whole change rests on.
const suite = spawnSync("npx", ["tsx", "tests/productClass.test.ts"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const out = suite.stdout ?? "";
const suiteOk = suite.status === 0 && /0 missed/.test(out);
const sabotageRan = /SABOTAGE the \d+ real products whose NAMES mention a licence stay hardware/.test(out);
const gate = {
  precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0,
  passed: precision >= 1 && suiteOk && sabotageRan,
  sampled: sample.length, checked: sample.length, unreadable: 0,
  suites: { productClass: suiteOk, name_rule_sabotage_present: sabotageRan },
};
console.log("gate:", JSON.stringify(gate));

if (!commit) {
  console.log("\nDRY RUN - nothing written. Re-run with --commit.");
  for (const d of doomed.slice(0, 8)) {
    console.log(`   ${d.sku.padEnd(24)} ${d.stored} -> ${d.klass.padEnd(9)} ${d.reason.padEnd(22)} inherited ${d.inherited_all}`);
  }
  await closePool();
  process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was reclassified"); await closePool(); process.exit(2); }

const result = await withRun("apply-reclassify-nonhardware",
  { predicate: "classify() disagrees with the stored product_class", candidates: doomed.length,
    by_rule: byRule, by_class: byClass, inherited_facts: factsAll, served: factsServed },
  async (runId) => {
    let retracted = 0, reclassified = 0;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const slice = doomed.slice(i, i + CHUNK);
      await withTx(async (c) => {
        for (const d of slice) {
          // The facts first: while the part is still hardware, so a crash between the two leaves
          // the SAFE half-state (facts gone, class still wrong) rather than the dangerous one
          // (class fixed, wrong facts still served and no longer selected by this predicate).
          const f = await c.query<{ id: number }>(
            `SELECT id FROM facts WHERE part_id = $1 AND superseded_by IS NULL AND inherited`, [d.id]);
          for (const row of f.rows) { await retractFact(c, row.id, "licence_not_hardware", runId); retracted++; }
          await c.query(
            `UPDATE parts SET product_class = $2::product_class, product_class_reason = $3 WHERE id = $1`,
            [d.id, d.klass, d.reason]);
          reclassified++;
        }
      });
      console.log(`   ${reclassified}/${doomed.length} parts, ${retracted} facts retracted`);
    }
    return { stats: { reclassified, retracted, by_class: byClass, by_rule: byRule, own_facts_left: ownFacts }, gate };
  });

console.log(`\nrun #${result.runId}: reclassified ${result.stats.reclassified}, retracted ${result.stats.retracted}`);
await closePool();

// THE ONLY READING THAT COUNTS: a NEW connection, after the pool that wrote is closed.
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/reclassify-verify/cisco" });
await v.connect();
const after = await v.query(
  `SELECT count(*) FILTER (WHERE p.product_class = 'license') AS now_license,
          count(*) FILTER (WHERE p.product_class = 'hardware') AS still_hardware
     FROM parts p WHERE p.retired_at IS NULL AND upper(regexp_replace(p.sku, '=+$', '')) LIKE 'NC55P-%'`);
// SCOPED TO THE PARTS THIS RUN TOUCHED, and the first version of this line was not.
// It asked for every non-hardware part in the table and printed "must be 0: 2748" - which is not a
// failed write but a wrong question: ~27k parts were ALREADY licences before this run and it never
// claimed to fix them. Naming an output field for the thing you wish it measured, in the script
// about a guard bypassed by its input. (Those 2,748 are a real and separate defect - 2,197 of them
// written by migrate-atlas run 6 - and they are in docs/SESSION-LOG.md, not silently folded in here.)
const touched = doomed.map((d) => d.reason);
const served = await v.query(
  `SELECT count(*)::int AS n FROM facts f JOIN parts p ON p.id = f.part_id
    WHERE f.superseded_by IS NULL AND f.inherited AND f.state IN ('verified','corroborated')
      AND p.retired_at IS NULL AND p.product_class_reason = ANY($1::text[])`, [[...new Set(touched)]]);
console.log("verified from a NEW connection - NC55P-:", JSON.stringify(after.rows[0]));
console.log("served inherited facts left ON THE PARTS THIS RUN RECLASSIFIED (must be 0):", served.rows[0].n);
await v.end();
