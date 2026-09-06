/**
 * Retract `ports` facts the corrected parser refuses. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/retract-port-misparse.mts [--commit] [--sample 60] [--vendor cisco]
 *
 * WHY A SCRIPT AND NOT A ONE-OFF. A corrected parser does not un-write what is already stored -
 * `facts` is append-only by design - so fixing `portParse.ts` left 357 wrong values live in the API
 * across eleven vendors. `QSFP-100G-SR4-S` was stored as 100 ports at 1G; it is a single-port 100G
 * optic, so the fact was wrong in both fields at once. A missing port count is a recorded gap; a
 * confident wrong one is worse than nothing, because downstream it is indistinguishable from a
 * right one and `ports` is the field a switch is bought on.
 *
 * THE PREDICATE IS THE PARSER ITSELF, which is what makes this safe to run again later: a fact is
 * retracted if and only if the CURRENT parser refuses its own raw string. Nothing is matched by SKU
 * shape, vendor or a hand-written list, so the day the parser learns to read one of these shapes
 * correctly, this script stops proposing it - no list to keep in step.
 *
 * THE GATE, and it is not decoration. `requiresGate()` fires on the `apply-` prefix, and this run
 * is named to be caught by it rather than to slip past it:
 *
 *   precision  a random sample of the rows about to be retracted is re-checked against the parser.
 *              It must be 1.0 - retracting a fact the parser would ACCEPT is the one way this
 *              command can destroy good data, and precision is the only thing that can see it.
 *   recall     tests/portParse.test.mjs is run fresh. The retraction is only as good as the rule
 *              that justifies it, so an untested rule must not be allowed to delete anything.
 *
 * Retraction goes through `retractFact`, which SUPERSEDES with `method = 'retracted:<rule>'` and
 * state `gap_unattempted`. The old row is kept and stays readable; the part's `ports` becomes a
 * recorded gap rather than a wrong answer.
 */
import { spawnSync } from "node:child_process";
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { retractFact } from "../src/store/facts.js";
import { parsePorts } from "../src/core/portParse.js";
import { REPO_ROOT } from "../src/config.js";

type Row = { id: number; sku: string; vendor: string; raw: string; val: string };

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const vendor = argv.includes("--vendor") ? argv[argv.indexOf("--vendor") + 1] : null;
const sampleN = argv.includes("--sample") ? Number(argv[argv.indexOf("--sample") + 1]) : 60;
const CHUNK = 40;                       // short transactions: 357 retractions in one holds row locks
                                        // for minutes against a live apply, which is the contention
                                        // that produced the 120 s statement timeouts.

/** The rule that refused it, as a short stable token for `method = 'retracted:<rule>'`. */
function ruleOf(detail: string): string {
  if (detail.startsWith("a transceiver")) return "port_parse_transceiver_has_no_ports";
  if (detail.startsWith("mutually exclusive")) return "port_parse_alternative_configs";
  return "port_parse_refused";
}

const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT f.id, p.sku, v.slug AS vendor, f.raw, f.value::text AS val
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
    WHERE f.field_key = 'ports' AND f.superseded_by IS NULL
      -- NOT ITS OWN OUTPUT. retractFact supersedes with raw = '' and method 'retracted:...', and
      -- an empty raw is REFUSED by the parser ("empty"), so a second run would retract its own
      -- retractions and a third would retract those - a queue whose predicate is the absence of the
      -- thing it removes, which is the exact loop the planner's gap section had. Found when the
      -- first --commit run died mid-way and the obvious move was to re-run it.
      -- (No backticks in this comment: it lives inside a JS template literal and they close it.)
      AND f.raw IS NOT NULL AND f.raw <> ''
      AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')
      ${vendor ? "AND v.slug = $1" : ""}`,
  vendor ? [vendor] : []);

const doomed = rows.map((r) => ({ r, res: parsePorts(r.raw) }))
  .filter((x) => !x.res.ok)
  .map((x) => ({ ...x.r, detail: (x.res as { detail: string }).detail }));

const byVendor: Record<string, number> = {};
const byRule: Record<string, number> = {};
for (const d of doomed) {
  byVendor[d.vendor] = (byVendor[d.vendor] ?? 0) + 1;
  byRule[ruleOf(d.detail)] = (byRule[ruleOf(d.detail)] ?? 0) + 1;
}
console.log(`live ports facts examined : ${rows.length}`);
console.log(`the parser now refuses    : ${doomed.length}`);
for (const [k, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log("by vendor:", Object.entries(byVendor).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));

// ---- the gate ---------------------------------------------------------------------------------
// precision: re-check a random sample against the parser. A fact the parser ACCEPTS must never be
// retracted, and this is the only check that can see that happening.
const shuffled = [...doomed];
for (let i = 0; i < Math.min(sampleN, shuffled.length); i++) {
  const j = i + Math.floor(Math.random() * (shuffled.length - i));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, Math.min(sampleN, shuffled.length));
const stillRefused = sample.filter((d) => !parsePorts(d.raw).ok).length;
const precision = sample.length ? stillRefused / sample.length : 1;

// recall: the rule that justifies the deletion has to be tested, run fresh rather than assumed.
const suite = spawnSync("npx", ["tsx", "tests/portParse.test.mjs"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
const suiteOk = suite.status === 0 && /every refusal was for the stated reason/.test(suite.stdout ?? "");
const gate = { precision: Number(precision.toFixed(4)), recall: suiteOk ? 1 : 0, passed: precision >= 1 && suiteOk,
               sampled: sample.length, checked: sample.length, suites: { portParse: suiteOk } };
console.log("gate:", JSON.stringify(gate));

if (!commit) {
  console.log("\nDRY RUN - nothing written. Re-run with --commit.");
  for (const d of doomed.slice(0, 5)) console.log(`   ${d.sku.padEnd(24)} ${d.val.slice(0, 60)}`);
  await closePool();
  process.exit(gate.passed ? 0 : 2);
}
if (!gate.passed) { console.error("the gate did not pass, so nothing was retracted"); await closePool(); process.exit(2); }

const out = await withRun("apply-retract-port-misparse",
  { predicate: "parsePorts refuses the stored raw", candidates: doomed.length, by_rule: byRule, by_vendor: byVendor },
  async (runId) => {
    let done = 0;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const slice = doomed.slice(i, i + CHUNK);
      await withTx(async (c) => {
        for (const d of slice) { await retractFact(c, d.id, ruleOf(d.detail), runId, { state: "gap_unattempted" }); done++; }
      });
      console.log(`   retracted ${done}/${doomed.length}`);
    }
    return { stats: { retracted: done, by_rule: byRule, by_vendor: byVendor }, gate };
  });

console.log(`\nrun #${out.runId}: retracted ${out.stats.retracted}`);
await closePool();

// THE ONLY READING THAT COUNTS: a NEW connection, after the pool that did the writing is closed.
const { Client } = await import("pg");
const fs = await import("node:fs");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/retract-verify/cisco" });
await v.connect();
const after = await v.query(
  `SELECT count(*) FILTER (WHERE f.superseded_by IS NULL) AS live,
          count(*) FILTER (WHERE f.method LIKE 'retracted:port_parse%') AS retracted
     FROM facts f WHERE f.field_key = 'ports'`);
console.log("verified from a NEW connection:", JSON.stringify(after.rows[0]));
await v.end();
