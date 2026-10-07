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

// ---- --spares-from-base <category> (reviewer R2, 7 Oct 2026: "Run set-series for the 95 tonight as proposed: approval A, plan
// file with every row"). Every live Cisco spare of the category (a stored spare_of edge) whose series differs from its base's takes
// the BASE's series -- a spare is the same part. Per-row target, ONE run, the same undo record (rows: sku, from, to) and plan file,
// the same write-only-where-unchanged UPDATE and the same new-connection read-back as the list form.
const sparesCat = arg("--spares-from-base");
if (sparesCat) {
  if (!approved) { console.error("usage: --spares-from-base <category> (--approved <ruling> | --approved-file <file>) [--commit]"); process.exit(2); }
  const commitS = process.argv.includes("--commit");
  const dbS = getPool();
  const rowsS = (await dbS.query<{ sku: string; id: string; from: string | null; to: string | null; base: string }>(`
    SELECT s.sku, s.id::text, s.series AS "from", b.series AS "to", b.sku AS base
      FROM relations r JOIN parts s ON s.id = r.from_part_id JOIN parts b ON b.id = r.to_part_id
      JOIN categories c ON c.id = s.category_id JOIN vendors v ON v.id = s.vendor_id
     WHERE r.kind = 'spare_of' AND v.slug = 'cisco' AND c.slug = $1 AND s.retired_at IS NULL AND b.retired_at IS NULL
       AND s.series IS DISTINCT FROM b.series ORDER BY s.sku`, [sparesCat])).rows;
  const noBase = rowsS.filter((r) => r.to === null);
  if (noBase.length) { console.error(`REFUSED: ${noBase.length} spares whose base holds NO series (never write a null over a value): ${noBase.slice(0, 5).map((r) => r.sku).join(", ")}`); await closePool(); process.exit(2); }
  for (const r of rowsS.slice(0, 30)) console.log(`  ${r.sku}: series "${r.from ?? ""}" -> "${r.to}" (its base ${r.base})`);
  const outS = path.join("data", "dryrun", `set-series-spares-${sparesCat}-${new Date().toISOString().replace(/[:.]/g, "")}${commitS ? "" : "-dry"}.tsv`);
  fs.mkdirSync(path.dirname(outS), { recursive: true });
  fs.writeFileSync(outS, ["sku\tpart_id\tfrom\tto\tbase", ...rowsS.map((r) => [r.sku, r.id, r.from ?? "", r.to, r.base].join("\t"))].join("\n") + "\n");
  console.log(`  ${rowsS.length} spare(s) of ${sparesCat} differ from their base -> plan ${outS}`);
  if (!commitS) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
  if (!rowsS.length) { console.log("  nothing to do"); await closePool(); process.exit(0); }
  const resS = await withRun("set-series", { approved, mode: "spares-from-base", category: sparesCat, plan: outS, rows: rowsS.map(({ sku, from, to, base }) => ({ sku, from, to, base })) }, async () => {
    const u = await dbS.query(
      `UPDATE parts p SET series = w.to_s FROM unnest($1::bigint[], $2::text[], $3::text[]) AS w(id, was, to_s)
        WHERE p.id = w.id AND p.series IS NOT DISTINCT FROM w.was`,
      [rowsS.map((r) => r.id), rowsS.map((r) => r.from), rowsS.map((r) => r.to)]);
    if (u.rowCount !== rowsS.length) throw new Error(`wrote ${u.rowCount} rows, planned ${rowsS.length}: a column changed since it was read; rolled back`);
    return { stats: { updated: u.rowCount ?? 0 } };
  });
  await closePool();
  const dbS2 = getPool();
  const leftS = (await dbS2.query<{ n: string }>(`
    SELECT count(*)::text AS n FROM unnest($1::bigint[], $2::text[]) AS w(id, to_s) JOIN parts p ON p.id = w.id WHERE p.series IS DISTINCT FROM w.to_s`,
    [rowsS.map((r) => r.id), rowsS.map((r) => r.to)])).rows[0].n;
  console.log(`  run ${resS.runId}: ${rowsS.length} spares set to their base's series; not carrying it now (new connection): ${leftS}`);
  await closePool();
  process.exit(leftS === "0" ? 0 : 1);
}

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
