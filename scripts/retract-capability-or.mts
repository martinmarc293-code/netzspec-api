// scripts/retract-capability-or.mts — retract stored CAPABILITY STATEMENTS ("A or B") under named fields, per the standing rule:
// "Never store a capability statement (A or B), or a value conditional on a configuration. Refuse alternatives outright."
//
//     npx tsx scripts/retract-capability-or.mts --vendor cisco --field lan_interfaces,wan_interfaces [--commit --approved "..."]
//
// Reviewer ruling, Batch C 29 Sep 2026: "lan/wan: 'or' capability prose retracted per the existing rule, the rest into ports
// with role". A fact qualifies only when a value member carries the WORD `or` (never inside another word: "port", "for",
// "supported"); everything else under the fields is left for the ports conversion. Plan file per invocation; approval recorded.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, retractFact } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), fields = (arg("--field") ?? "").split(",").filter(Boolean);
const commit = process.argv.includes("--commit"), approved = arg("--approved");
if (!vendor || !fields.length) { console.error("usage: retract-capability-or.mts --vendor <slug> --field a,b [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

const OR_WORD = /(?<![A-Za-z])or(?![A-Za-z])/i;
const db = getPool();
const rows = (await db.query<{ id: string; sku: string; key: string; value: unknown }>(`
  SELECT f.id::text AS id, p.sku, f.field_key AS key, f.value FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.field_key = ANY($2::text[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
     AND f.value IS NOT NULL AND p.retired_at IS NULL ORDER BY f.field_key, p.sku`, [vendor, fields])).rows;
const members = (v: unknown) => (Array.isArray(v) ? v : [v]).map((x) => String(x ?? ""));
const hit = rows.filter((r) => members(r.value).some((m) => OR_WORD.test(m)));
const plan = planFile(ROOT, `retract-capability-or-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tsku\tfield\taction\tvalue", ...rows.map((r) => `${r.id}\t${r.sku}\t${r.key}\t${hit.includes(r) ? "retract" : "keep (ports conversion)"}\t${JSON.stringify(r.value)}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
console.log(`${vendor} ${fields.join(",")}: ${rows.length} current facts; capability statements to retract ${hit.length}; kept for the ports conversion ${rows.length - hit.length}`);
for (const r of hit) console.log(`  retract ${r.sku} ${r.key}: ${JSON.stringify(r.value).slice(0, 100)}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
const res = await withRun("retract-capability-or", { vendor, fields, retract: hit.length, plan: path.relative(ROOT, plan), plan_sha256: planSha, approved },
  async (runId) => withTx(async (client) => {
    for (const r of hit) await retractFact(client, Number(r.id), "capability-statement-or", runId);
    return { stats: { retracted: hit.length } };
  }));
console.log(`run ${res.runId}: retracted ${hit.length}`);
await closePool();
