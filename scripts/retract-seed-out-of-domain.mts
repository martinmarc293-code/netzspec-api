// scripts/retract-seed-out-of-domain.mts — retract hexcat_seed facts whose value is outside the cup's domain.
//
//     npx tsx scripts/retract-seed-out-of-domain.mts --field standard --vendor cisco [--commit]
//
// Reviewer ruling 29 Sep 2026 (Batch A): the `standard` seed retraction. A hexcat_seed value is one somebody typed for the
// shop ("DAC Kabel", "10GBASE-DWDM (ITU 100-GHz-Raster)"), not one the pipeline read, and these fail the cup's own domain,
// so they are served as a standard the dictionary does not know. The predicate is enum_values_in_domain's, verbatim:
// domainFor(category, key) or the dictionary's domain, and a value is inside only when EVERY member is a string in it.
//
// ONE VENDOR PER RUN, and --vendor is required: the check has no vendor filter, so its 1,775 seed facts span twelve
// vendors (cisco 555), and another lane's facts are that lane's to retract. The dry run writes every row it would retract
// to data/dryrun/, which is the plan a reviewer reads before --commit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, retractFact } from "../src/store/index.js";
import { FIELD_DICTIONARY, domainFor } from "../src/core/fieldSchema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const field = arg("--field"), vendor = arg("--vendor"), commit = process.argv.includes("--commit");
if (!field || !vendor) { console.error("usage: retract-seed-out-of-domain.mts --field <key> --vendor <slug> [--commit]"); process.exit(2); }

const db = getPool();
const rows = (await db.query<{ id: string; sku: string; category: string; value: unknown }>(
  `SELECT f.id::text AS id, p.sku, c.slug AS category, f.value
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    WHERE v.slug = $1 AND f.field_key = $2 AND f.method = 'hexcat_seed' AND f.superseded_by IS NULL
      AND p.retired_at IS NULL AND f.value IS NOT NULL
    ORDER BY c.slug, p.sku`, [vendor, field])).rows;
const outside = rows.filter((r) => {
  const dom = domainFor(r.category, field) ?? (FIELD_DICTIONARY[field] as { domain?: string[] }).domain ?? [];
  if (!dom.length) return false;                       // no domain: nothing to be outside of (the check skips it too)
  const vals = Array.isArray(r.value) ? r.value : [r.value];
  return !vals.every((x) => typeof x === "string" && dom.includes(x));
});
const plan = path.join(ROOT, "data", "dryrun", `retract-seed-${field}-${vendor}-${new Date().toISOString().slice(0, 10)}.tsv`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tsku\tcategory\tvalue", ...outside.map((r) => `${r.id}\t${r.sku}\t${r.category}\t${JSON.stringify(r.value)}`)].join("\n") + "\n");
const byValue = new Map<string, number>();
for (const r of outside) byValue.set(JSON.stringify(r.value), (byValue.get(JSON.stringify(r.value)) ?? 0) + 1);
console.log(`${vendor} ${field}: ${rows.length} current hexcat_seed facts, ${outside.length} outside the domain -> ${path.relative(ROOT, plan)}`);
console.log(`  ${byValue.size} distinct values; top: ${[...byValue].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => `${v.slice(0, 50)} x${n}`).join(" | ")}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }

const res = await withRun("retract-seed-out-of-domain", {
  field, vendor, retract: outside.length, plan: path.relative(ROOT, plan),
  approved: "reviewer ruling 29 Sep 2026 (Batch A): the standard seed retraction, one vendor per run",
}, async (runId) => withTx(async (client) => {
  for (const r of outside) await retractFact(client, Number(r.id), "seed-outside-domain", runId);
  return { stats: { retracted: outside.length, seed_facts: rows.length } };
}));
console.log(`run ${res.runId}: retracted ${outside.length} ${vendor} ${field} seed facts outside the domain`);
await closePool();
