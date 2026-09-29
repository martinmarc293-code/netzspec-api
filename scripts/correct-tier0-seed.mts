// scripts/correct-tier0-seed.mts — correct tier-0 seed facts that sit outside their cup's domain.
//
//     npx tsx scripts/correct-tier0-seed.mts --field standard --vendor cisco [--commit]
//
// Reviewer ruling 29 Sep 2026 (Batch A): of Cisco's 555 out-of-domain `standard` seed facts the real normaliser maps 433
// INTO the domain ("1000BASE-BX10-D" -> "1000base-bx10-d") and refuses 122 ("DAC Kabel"); all 555 are TIER 0, the
// operator's own catalogue values, so a blanket retraction would have destroyed 433 correct ones. So: a value the
// normaliser maps inside the domain is superseded by its normalised form IN PLACE -- raw, tier 0, method hexcat_seed,
// state and provenance unchanged (normalising a typed value does not make it read); a value it refuses is retracted.
// The predicate is enum_values_in_domain's, verbatim. One vendor per run: another lane's seed is that lane's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, supersedeFact, retractFact } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";
import { FIELD_DICTIONARY, domainFor } from "../src/core/fieldSchema.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const field = arg("--field"), vendor = arg("--vendor"), commit = process.argv.includes("--commit");
if (!field || !vendor) { console.error("usage: correct-tier0-seed.mts --field <key> --vendor <slug> [--commit]"); process.exit(2); }

type Row = { id: string; sku: string; category: string; value: unknown; raw: string; state: string; tier: number; doc_id: string | null;
  locator: string | null; extracted_at: string | null; inherited: boolean; inherited_from: string | null };
const db = getPool();
const rows = (await db.query<Row>(
  `SELECT f.id::text AS id, p.sku, c.slug AS category, f.value, f.raw, f.state::text AS state, f.tier, f.doc_id, f.locator,
          f.extracted_at::text AS extracted_at, f.inherited, f.inherited_from
     FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    WHERE v.slug = $1 AND f.field_key = $2 AND f.method = 'hexcat_seed' AND f.tier = 0 AND f.superseded_by IS NULL
      AND p.retired_at IS NULL AND f.value IS NOT NULL
    ORDER BY c.slug, p.sku`, [vendor, field])).rows;
const domOf = (cat: string) => domainFor(cat, field) ?? (FIELD_DICTIONARY[field] as { domain?: string[] }).domain ?? [];
const inside = (cat: string, v: unknown) => { const d = domOf(cat); return d.length > 0 && (Array.isArray(v) ? v : [v]).every((x) => typeof x === "string" && d.includes(x)); };
const text = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

type Act = { row: Row; action: "normalise" | "retract"; value?: unknown; unit?: string; why?: string };
const acts: Act[] = [];
for (const r of rows) {
  if (!domOf(r.category).length || inside(r.category, r.value)) continue;     // no domain, or already inside: not ours
  const n = normalizeField(r.category, field, r.raw?.trim() || text(r.value), { locale: "en" });
  if (n.ok && inside(r.category, n.value)) acts.push({ row: r, action: "normalise", value: n.value, unit: n.unit });
  else acts.push({ row: r, action: "retract", why: n.ok ? `normalises to ${JSON.stringify(n.value)}, still outside` : `${n.reason}` });
}
const plan = planFile(ROOT, `correct-tier0-${field}-${vendor}`);   // one file per invocation: src/core/planFile.ts
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tsku\tcategory\taction\tstored\tnormalised_or_reason",
  ...acts.map((a) => `${a.row.id}\t${a.row.sku}\t${a.row.category}\t${a.action}\t${JSON.stringify(a.row.value)}\t${a.action === "normalise" ? JSON.stringify(a.value) : a.why}`)].join("\n") + "\n");
const nNorm = acts.filter((a) => a.action === "normalise").length, nRet = acts.length - nNorm;
console.log(`${vendor} ${field}: ${rows.length} tier-0 seed facts; outside the domain ${acts.length}: normalise in place ${nNorm}, retract ${nRet} -> ${path.relative(ROOT, plan)}`);
for (const a of acts.filter((x) => x.action === "retract").slice(0, 6)) console.log(`  retract ${JSON.stringify(a.row.value).slice(0, 60)} (${a.why})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }

const res = await withRun("correct-tier0", {
  field, vendor, normalise: nNorm, retract: nRet, plan: path.relative(ROOT, plan), norm_v: NORM_VERSION,
  approved: "reviewer ruling 29 Sep 2026 (Batch A): correct-tier0 run - normalise the in-domain seed values in place, retract the refused",
}, async (runId) => withTx(async (client) => {
  for (const a of acts) {
    const r = a.row;
    if (a.action === "retract") { await retractFact(client, Number(r.id), "seed-outside-domain-refused", runId); continue; }
    const entry: SpecEntry = { k: field, raw: r.raw, value: a.value, unit: a.unit, state: r.state as SpecEntry["state"],
      inherited: r.inherited, inherited_from: r.inherited_from ?? undefined,
      prov: { tier: 0, method: "hexcat_seed", doc_id: r.doc_id ?? undefined, locator: r.locator ?? undefined,
        extracted_at: r.extracted_at ?? undefined, norm_v: NORM_VERSION } };
    await supersedeFact(client, Number(r.id), entry, runId);
  }
  return { stats: { normalised: nNorm, retracted: nRet } };
}));
console.log(`run ${res.runId}: ${nNorm} normalised in place, ${nRet} retracted`);
await closePool();
