// scripts/set-series.mts — correct parts.series under ONE recorded run (a ruled correction). Dry run by default.
//     npx tsx scripts/set-series.mts --sku AIM-DES/BP --series "2600 Series" --approved "<the ruling>" [--commit]
//     npx tsx scripts/set-series.mts --skus-file <one SKU per line> --series "4000 ISR" --approved-file <verbatim.txt> [--commit]
// Refuses unless EVERY SKU names exactly one live cisco part (the whole list or nothing), and writes only where the column
// still holds what the dry run read (so a concurrent change is never overwritten).
//
// THE UNDO. A series correction overwrites a column in place and inserts no row, so the prior value exists only where this
// tool records it (29 Sep 2026: two undo plans were lost, one to a deploy swap, one to the dry run that confirmed it). Every
// row's prior value goes into the run's inputs (`rows: [{sku, from, to}]`, in the database) AND into a plan file named to the
// millisecond under data/dryrun/, which is tracked: commit it with the run.
// The list form exists because the 6 Oct ruling asked for ONE approval run over every ISR 4000 PID filed under the 3900 label.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const series = arg("--series"), skusFile = arg("--skus-file"), approvedFile = arg("--approved-file");
const approved = approvedFile ? fs.readFileSync(approvedFile, "utf8").trim() : arg("--approved");
const skus = skusFile
  ? [...new Set(fs.readFileSync(skusFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#")))]
  : arg("--sku") ? [arg("--sku")!] : [];
if (!skus.length || !series || !approved) {
  console.error("usage: (--sku <sku> | --skus-file <file>) --series <series> (--approved <ruling> | --approved-file <file>) [--commit]");
  process.exit(2);
}
const commit = process.argv.includes("--commit");
const db = getPool();
const found = (await db.query<{ sku: string; id: string; series: string | null }>(
  `SELECT p.sku, p.id::text, p.series FROM parts p JOIN vendors v ON v.id = p.vendor_id
    WHERE p.sku = ANY($1::text[]) AND v.slug = 'cisco' AND p.retired_at IS NULL ORDER BY p.sku`, [skus])).rows;
const bySku = new Map<string, { id: string; series: string | null }[]>();
for (const r of found) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), { id: r.id, series: r.series }]);
const refused = skus.filter((s) => (bySku.get(s) ?? []).length !== 1);
if (refused.length) {
  for (const s of refused) console.error(`refused: ${(bySku.get(s) ?? []).length} live cisco parts carry ${s} (need exactly 1)`);
  console.error(`REFUSED: ${refused.length} of ${skus.length} SKUs do not name exactly one live part; nothing written`);
  await closePool(); process.exit(2);
}
const rows = skus.map((sku) => ({ sku, id: bySku.get(sku)![0].id, from: bySku.get(sku)![0].series, to: series }));
const already = rows.filter((r) => r.from === series);
const plan = ["sku\tpart_id\tfrom\tto", ...rows.map((r) => [r.sku, r.id, r.from ?? "", r.to].join("\t"))];
for (const r of rows) console.log(`  ${r.sku}: series "${r.from ?? ""}" -> "${r.to}"${r.from === series ? "  (already)" : ""}`);
const out = path.join("data", "dryrun", `set-series-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, plan.join("\n") + "\n");
console.log(`  ${rows.length} part(s), ${already.length} already "${series}" -> plan ${out}`);
if (!commit) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
const todo = rows.filter((r) => r.from !== series);
const res = await withRun("set-series", { approved, series, plan: out, rows: rows.map(({ sku, from, to }) => ({ sku, from, to })) }, async () => {
  const u = await db.query(
    `UPDATE parts p SET series = $1 FROM unnest($2::bigint[], $3::text[]) AS w(id, was)
      WHERE p.id = w.id AND p.series IS NOT DISTINCT FROM w.was`,
    [series, todo.map((r) => r.id), todo.map((r) => r.from)]);
  if (u.rowCount !== todo.length) throw new Error(`wrote ${u.rowCount} rows, planned ${todo.length}: a column changed since it was read; rolled back`);
  return { stats: { updated: u.rowCount ?? 0, already: already.length } };
});
await closePool();
// verified from a NEW connection: every planned part now carries the series
const db2 = getPool();
const left = (await db2.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM parts WHERE id = ANY($1::bigint[]) AND series IS DISTINCT FROM $2", [rows.map((r) => r.id), series])).rows[0].n;
console.log(`  run ${res.runId}: ${todo.length} set to "${series}"; not carrying it now (new connection): ${left}`);
await closePool();
if (left !== "0") process.exitCode = 1;
