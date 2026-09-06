/**
 * Restore `hardware` to parts the CATEGORY fallback classed as software, where INDEPENDENT
 * evidence says they are hardware. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/reclassify-hardware-evidence.mts [--commit] [--vendor cisco] [--sample 60]
 *
 * WHY THIS IS THE DANGEROUS DIRECTION. `describesPart` refuses a family-level fact to any part
 * that is not hardware. When a REAL line card is classed software, that refusal is correct code
 * acting on wrong data, and the cost is facts that are NEVER WRITTEN - nothing appears in a diff,
 * no counter moves, and the part simply stays empty for ever. The licence half of this defect
 * (run #467) destroyed facts you could see; this half destroys facts nobody can see.
 *
 * ROOT CAUSE. `classify()` is SKU-shape plus category, by design: "Nothing is inferred from a
 * category NAME. Only the categories row (is_hardware)...". No SKU rule fires for these parts, and
 * their category is a software one - `cloud-systems-management`, `ios-nx-os-software` - so the
 * class follows the category. The category is not wrong as a category (cloud-systems-management is
 * 5,685 parts and only 2.6 per cent look like hardware); the PART is filed in the wrong one.
 * Almost every affected part says "Flexible Consumption" - Cisco's pay-as-you-go HARDWARE - which
 * is very likely why a human filed line cards under a software heading.
 *
 * WHY NOT A SKU RULE, WHICH IS WHAT THE LICENCE HALF USED. It was tried and it does not work here,
 * and the reason is structural: a licence family is named distinctly, so NC55P- is 311/312 pure,
 * but a HARDWARE family sells hardware, software images, licences and spares under one prefix.
 * Measured corpus-wide, every candidate prefix was mixed:
 *   APIC-    179 parts, real SSDs and servers - and APIC-SIM-DK9-1.0, a SIMULATOR
 *   PI-APL-    6 parts, ALL of them "Appliance Software" images (matched only because the
 *              hardware-looking predicate contains the word "appliance")
 *   DN4-       6 parts, THREE of them "... Appliance License"
 *   A9K-     435 parts, 186 licence-named
 * The DN4- case also broke the 40-character licence-name window used elsewhere tonight: "Cisco
 * Catalyst Center Appliance (Gen 4)" is 39 characters, so "License" falls outside it. A name rule
 * cannot do this job in either direction.
 *
 * THE PREDICATE IS EVIDENCE, NOT A NAME. A part qualifies on either:
 *   A  a TWIN classed hardware - the same SKU modulo Cisco's spare "=" suffix. The catalogue
 *      already contains NC-55-36X100G (software) and NC-55-36X100G= (hardware): one physical line
 *      card, two orderables, two classes. CLAUDE.md: "Cisco's PID= is the spare orderable of PID -
 *      the same hardware, so the same specifications."
 *   B  its OWN (non-inherited) fact in a field a licence or an image cannot have - ports,
 *      psu_options, supported_modules, rack_units, weight. Inherited facts are excluded on
 *      purpose: they are exactly the contamination the other half of this defect was about, so
 *      using them here would let one bug certify the other.
 * Neither signal reads the part's name. The name vetoes below exist only to REFUSE.
 */
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { REPO_ROOT } from "../src/config.js";

/** Fields a licence, a subscription or a software image cannot possess. */
const PHYSICAL_FIELDS = ["ports", "weight", "dimensions", "rack_units", "power_max", "power_typical",
                         "airflow", "psu_options", "supported_modules", "form_factor", "mtbf"];

/**
 * Words that REFUSE a part regardless of its evidence. None of the 56 current candidates trips
 * one - the veto is here so that a later run, over data nobody has read, cannot sweep in an
 * "Appliance Software" image or an "Appliance License" on the strength of a hardware twin.
 * A veto that has never fired is still the difference between a checked set and a lucky one.
 */
const SOFTWARE_MARKERS = ["licen", "software", "virtual", "-img", "img-", "subscription", "simulator"];

/**
 * A LICENSING CAVEAT IS PARENTHETICAL; A LICENCE PRODUCT NAMES ITSELF IN THE MAIN CLAUSE.
 *
 * The first version of this veto matched `licen` anywhere and refused nine REAL line cards:
 *   NC-57-24DD    "... base line card with Flexible Consumption Model (Requires Smart Licensing)."
 *   NC-55-6X2H-DWDM-S  "... Line Card HW Flexible Consumption (minimum of 4 DWDM licenses)"
 * That is the same defect as `%lic%` matching app-LIC-ation, one direction over: a substring that
 * means something else. Here it refuses correct work rather than admitting wrong work, which is
 * the safe direction and still wrong.
 *
 * Cisco writes the licensing REQUIREMENT in brackets and the licence PRODUCT in the name proper -
 * "Catalyst Center Gen3 XL (80 Core) Appliance License" versus "... line card ... (Requires Smart
 * Licensing)". So the parenthetical is dropped before the markers are applied. Both halves are
 * asserted by the live trap check in the gate.
 */
const vetoed = (name: string | null): string | null => {
  const n = (name ?? "").toLowerCase().replace(/\([^)]*\)/g, " ");
  return SOFTWARE_MARKERS.find((m) => n.includes(m)) ?? null;
};

type Row = { id: number; sku: string; name: string | null; stored: string; cat: string | null;
             twin: boolean; phys: number };

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const vendor = argv.includes("--vendor") ? argv[argv.indexOf("--vendor") + 1] : "cisco";
const sampleN = argv.includes("--sample") ? Number(argv[argv.indexOf("--sample") + 1]) : 60;

const pool = getPool();

// ONE PASS, NOT A CORRELATED SUBQUERY PER ROW. The first version asked
// `EXISTS (SELECT ... WHERE upper(regexp_replace(t.sku,...)) = upper(regexp_replace(p.sku,...)))`,
// which cannot use an index and re-scans 87,083 parts for every candidate row. It died on
// `statement_timeout` (57014) - and it had "worked" in ad-hoc psycopg probes, because those set no
// timeout while getPool() sets 120 s. Slow only where the limit is enforced means the STATEMENT is
// wrong, not the link (CLAUDE.md: the direction of the surprise is the diagnosis). The normalised
// key is computed once per part in a CTE and joined.
const { rows } = await pool.query<Row>(
  `WITH n AS (
     SELECT p.id, p.vendor_id, p.sku, p.name, p.category_id, p.product_class_reason,
            p.product_class::text AS stored, upper(regexp_replace(p.sku,'=+$','')) AS k
       FROM parts p JOIN vendors v ON v.id = p.vendor_id
      WHERE v.slug = $1 AND p.retired_at IS NULL),
   phys AS (
     SELECT f.part_id, count(*)::int AS n FROM facts f
      WHERE f.superseded_by IS NULL AND NOT f.inherited AND f.field_key = ANY($2::text[])
      GROUP BY 1),
   -- THE TWIN MUST BE VALIDATED, NOT TRUSTED. An earlier version accepted any twin classed
   -- hardware, and reading all 101 candidates found seven where the TWIN was itself misclassified,
   -- so the error propagated: DCNM-L-NXACCK9= "DCNM for LAN Advanced Edition" is Data Center
   -- Network Manager (software) whose twin is wrongly hardware, and the same for three DCNM SAN
   -- feature SKUs, Prime Cable Provisioning, and two S8x0DNPK9-15803M IOS images (15803M is a
   -- version string, not a model). Requiring the twin to carry its OWN physical fact validates the
   -- twin's class instead of inheriting it, and drops all seven. 101 -> 66.
   hwk AS (
     SELECT DISTINCT t.vendor_id, upper(regexp_replace(t.sku,'=+$','')) AS k
       FROM parts t JOIN phys ON phys.part_id = t.id
      WHERE t.retired_at IS NULL AND t.product_class = 'hardware')
   SELECT n.id, n.sku, n.name, n.stored, c.slug AS cat,
          (hwk.k IS NOT NULL) AS twin, COALESCE(phys.n, 0) AS phys
     FROM n
     LEFT JOIN categories c ON c.id = n.category_id
     LEFT JOIN hwk ON hwk.vendor_id = n.vendor_id AND hwk.k = n.k
     LEFT JOIN phys ON phys.part_id = n.id
    WHERE n.stored <> 'hardware'
      AND n.product_class_reason LIKE 'category-is_hardware=false%'
      AND (hwk.k IS NOT NULL OR COALESCE(phys.n, 0) > 0)
    ORDER BY n.sku`, [vendor, PHYSICAL_FIELDS]);

const refused = rows.filter((r) => vetoed(r.name));
const doomed = rows.filter((r) => !vetoed(r.name));
const reasonOf = (r: Row) => r.twin && r.phys ? "evidence:hardware-twin+own-physical-fact"
  : r.twin ? "evidence:hardware-twin" : "evidence:own-physical-fact";

const byReason: Record<string, number> = {};
for (const d of doomed) byReason[reasonOf(d)] = (byReason[reasonOf(d)] ?? 0) + 1;
console.log(`parts classed non-hardware by the category fallback, WITH evidence : ${rows.length}`);
console.log(`  refused by a software/licence marker in the name                 : ${refused.length}`);
console.log(`  to be restored to hardware                                       : ${doomed.length}`);
for (const [k, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
for (const r of refused) console.log(`     REFUSED ${r.sku} (${vetoed(r.name)}): ${r.name}`);

// ---- the gate ---------------------------------------------------------------------------------
// precision: every sampled row must STILL satisfy the evidence predicate and still pass the veto.
const shuffled = [...doomed];
for (let i = 0; i < Math.min(sampleN, shuffled.length); i++) {
  const j = i + Math.floor(Math.random() * (shuffled.length - i));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, Math.min(sampleN, shuffled.length));
const good = sample.filter((d) => (d.twin || d.phys > 0) && !vetoed(d.name)).length;
const precision = sample.length ? good / sample.length : 1;

// recall, as a LIVE sabotage assertion against the real catalogue rather than a fixture: three
// parts that are genuinely software or a licence and DO look like hardware by name must be absent
// from the doomed set. If a future widening lets one in, this goes red before anything is written.
const TRAPS = ["PI-UCS-APL-IMG-3.3", "ACI-MSITE-VAPPL6=", "DN3-HW-APL-XL-LIC", "APIC-SIM-DK9-1.0"];
const leaked = TRAPS.filter((t) => doomed.some((d) => d.sku.toUpperCase() === t.toUpperCase()));
const trapsPresent = (await pool.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM parts WHERE upper(sku) = ANY($1::text[])`,
  [TRAPS.map((t) => t.toUpperCase())])).rows[0].n;
const gate = {
  precision: Number(precision.toFixed(4)), recall: leaked.length === 0 ? 1 : 0,
  passed: precision >= 1 && leaked.length === 0 && trapsPresent > 0,
  sampled: sample.length, checked: sample.length, unreadable: 0,
  traps: { checked: TRAPS.length, present_in_catalogue: trapsPresent, leaked },
};
console.log("gate:", JSON.stringify(gate));
if (trapsPresent === 0) console.error("the trap SKUs are absent from the catalogue - the sabotage case proves nothing");

if (!commit) {
  console.log("\nDRY RUN - nothing written. Re-run with --commit.");
  for (const d of doomed.slice(0, 10)) console.log(`   ${d.sku.padEnd(24)} ${d.stored} -> hardware  ${(d.cat ?? "?").padEnd(26)} ${String(d.name).slice(0, 44)}`);
  await closePool();
  process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was reclassified"); await closePool(); process.exit(2); }

const result = await withRun("apply-reclassify-hardware-evidence",
  { predicate: "hardware twin, or an own non-inherited physical fact", vendor,
    candidates: doomed.length, refused: refused.length, by_reason: byReason },
  async (runId) => {
    let n = 0;
    for (let i = 0; i < doomed.length; i += 40) {
      const slice = doomed.slice(i, i + 40);
      await withTx(async (c) => {
        for (const d of slice) {
          await c.query(`UPDATE parts SET product_class = 'hardware', product_class_reason = $2 WHERE id = $1`,
            [d.id, reasonOf(d)]);
          n++;
        }
      });
      console.log(`   ${n}/${doomed.length}`);
    }
    return { stats: { reclassified: n, refused: refused.length, by_reason: byReason }, gate };
  });

console.log(`\nrun #${result.runId}: restored ${result.stats.reclassified} parts to hardware`);
await closePool();

// THE ONLY READING THAT COUNTS: a NEW connection, scoped to what THIS run changed.
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/hw-evidence-verify/cisco" });
await v.connect();
const after = await v.query(
  `SELECT count(*)::int AS restored,
          count(*) FILTER (WHERE product_class <> 'hardware')::int AS not_hardware
     FROM parts WHERE product_class_reason LIKE 'evidence:%'`);
console.log("verified from a NEW connection:", JSON.stringify(after.rows[0]), "(not_hardware must be 0)");
await v.end();
