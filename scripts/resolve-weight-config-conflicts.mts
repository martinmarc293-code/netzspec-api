// scripts/resolve-weight-config-conflicts.mts -- close the router weight conflicts the weight ruling settles (5 Oct 2026 ~23:10).
//
// The ruling (docs/decisions/2026-10-05-router-weight-configuration.md): "... Close the held conflicts as superseded readings in
// one approval run". Run 1495 held a conflict wherever a sheet printed one weight per configuration (the ISR 4000 sheet: five
// rows per model, under two URLs). Each conflict row names both cells (kept_evidence / rejected_evidence: doc_id + locator); the
// row LABEL is read back from the extract the apply used, and src/core/weightConfig.ts decides -- the SAME function apply-extract
// now applies, never a second copy of the rule.
//
//   npx tsx scripts/resolve-weight-config-conflicts.mts --extract <extract.json> --approved-file <verbatim.txt> [--commit]
//
// RESOLVED only when BOTH hold: the REJECTED cell's row is refused for this part (loaded / add-on / another variant's row / a
// base row on a variant PID) AND the KEPT cell's row is the ruled one (or no configuration row at all). Anything else is HELD
// and printed with why (a label not found in the extract, a kept row the ruling refuses -- that one would need a supersede, not
// a close). Resolution "rule:weight_config_superseded_reading". The facts' states are NOT touched here: reconcile-conflict-
// states.mts returns a `conflict` fact with no open conflict to its merge verdict, which is its ruled job (29 Sep 2026).
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withRun } from "../src/store/index.js";
import { weightRowDecision } from "../src/core/weightConfig.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const extract = arg("--extract"), approvedFile = arg("--approved-file"), commit = process.argv.includes("--commit");
if (!extract) { console.error("usage: --extract <extract.json> --approved-file <verbatim.txt> [--commit]"); process.exit(2); }
const approved = approvedFile ? fs.readFileSync(approvedFile, "utf8").trim() : "";
if (commit && !approved) { console.error("REFUSED: --commit needs --approved-file (the verdict, verbatim)"); process.exit(2); }

const recs = (JSON.parse(fs.readFileSync(extract, "utf8")).records as any[]).filter((r) => !r.__doc__);
const labelAt = new Map<string, string>();
for (const r of recs) labelAt.set(`${r.source_url}|${String(r.locator).split("|")[0]}`, r.label);
const db = getPool();
const urlOf = new Map((await db.query<{ doc_id: string; url: string }>("SELECT doc_id, url FROM source_docs WHERE url IS NOT NULL")).rows.map((r) => [r.doc_id, r.url]));
const rows = (await db.query<{ id: string; sku: string; kept: string; rejected: string; ke: any; re: any }>(`
  SELECT c.id::text AS id, p.sku, c.kept::text AS kept, c.rejected::text AS rejected, c.kept_evidence AS ke, c.rejected_evidence AS re
    FROM conflicts c JOIN parts p ON p.id = c.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories k ON k.id = p.category_id
   WHERE v.slug = 'cisco' AND k.slug = 'routers' AND p.retired_at IS NULL AND p.product_class = 'hardware'
     AND c.field_key = 'weight' AND c.resolved_at IS NULL ORDER BY p.sku, c.id`)).rows;
const label = (ev: any) => labelAt.get(`${urlOf.get(ev?.doc_id) ?? "?"}|${String(ev?.locator ?? "").split("|")[0]}`) ?? null;
const resolve: string[] = [], held: string[] = [], plan: string[] = ["conflict_id\tsku\tkept\tkept_row\trejected\trejected_row\tverdict\twhy"];
for (const r of rows) {
  const kl = label(r.ke), rl = label(r.re);
  const dk = kl ? weightRowDecision(kl, r.sku) : null, dr = rl ? weightRowDecision(rl, r.sku) : null;
  let verdict = "held", why = "";
  if (!kl || !rl) why = `a cell's label is not in the extract (${!kl ? "kept" : "rejected"})`;
  else if (!dr || dr.use) why = `the rejected row ("${rl}") is not refused for ${r.sku}`;
  else if (dk && !dk.use) why = `the KEPT row ("${kl}") is itself refused for ${r.sku}: needs a supersede, not a close`;
  else { verdict = "resolve"; why = dr.why; }
  (verdict === "resolve" ? resolve : held).push(r.id);
  plan.push([r.id, r.sku, r.kept, kl ?? "?", r.rejected, rl ?? "?", verdict, why].join("\t"));
}
const out = path.join("data", "dryrun", `resolve-weight-config-conflicts-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, plan.join("\n") + "\n");
console.log(`open router weight conflicts: ${rows.length}; resolve ${resolve.length}; held ${held.length} -> ${out}`);
for (const l of plan.filter((l) => l.includes("\theld\t")).slice(0, 8)) console.log(`  HELD ${l.split("\t").slice(1).join(" | ").slice(0, 200)}`);
if (!commit) { console.log("DRY RUN: nothing written (--commit --approved-file <verdict> to close them)"); await closePool(); process.exit(0); }
const res = await withRun("resolve-weight-config-conflicts", { approved, resolved: resolve.length, held: held.length, plan: out }, async (runId) => {
  const u = await db.query(`UPDATE conflicts SET resolved_at = now(), resolution = 'rule:weight_config_superseded_reading', resolved_by = $2
                             WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL`, [resolve, runId]);
  if (u.rowCount !== resolve.length) throw new Error(`would close ${u.rowCount} rows, planned ${resolve.length}; rolled back`);
  return { stats: { resolved: u.rowCount ?? 0, held: held.length } };
});
await closePool();
// verified from a NEW connection
const db2 = getPool();
const left = (await db2.query<{ n: string }>("SELECT count(*)::text AS n FROM conflicts WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL", [resolve])).rows[0].n;
console.log(`run ${res.runId}: resolved ${resolve.length}; still open among them (new connection): ${left}`);
await closePool();
if (left !== "0") process.exitCode = 1;
