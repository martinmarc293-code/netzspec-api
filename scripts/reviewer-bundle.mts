/**
 * scripts/reviewer-bundle.mts — the read-only bundle a BROWSER-BASED reviewer can actually use. READS ONLY.
 *
 *     npx tsx scripts/reviewer-bundle.mts [--out <dir>]
 *
 * Why a bundle and not a token: a fine-grained GitHub PAT cannot be used by a web chat — it cannot clone and
 * cannot set an auth header — so the brief's STEP A.1 route reaches a human or a Claude Code session and
 * nobody else. This produces what a web reviewer can read: every table it needs as CSV, with the query that
 * produced each one recorded beside it, so no number in the review rests on anybody's description of the data.
 *
 * Batched by primary key rather than LIMIT/OFFSET: an OFFSET walk over 130,000 rows re-sorts the whole table
 * on every page and, worse, can skip or repeat a row if anything writes while it runs — and three scraper
 * lanes write to this store. Keyset pagination cannot.
 *
 * NOT included, and said so in the manifest rather than left for the reviewer to notice: `.env` (never
 * tracked), the cached documents (12,231 files, ~GB, on the box), and the fact HISTORY — only current rows,
 * because 32,832 superseded rows answer a different question than the one this review is asking.
 */
import fs from "node:fs";
import path from "node:path";
import { query, closePool } from "../src/store/db.js";

const outArg = process.argv.indexOf("--out");
const OUT = outArg >= 0 ? String(process.argv[outArg + 1]) : path.join("docs", "reviewer", "2026-09-27", "bundle");
fs.mkdirSync(OUT, { recursive: true });

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One table to one CSV, keyset-paginated on `keys` — a LIST, because `doc_parts`' primary key is the pair
 * (doc_id, part_id) and there is no id column. A single-column keyset over a composite key either skips or
 * repeats rows at every batch boundary, which is the defect that would be least visible in the output: the
 * file would look complete and be short. The row-value comparison `(a, b) > ($1, $2)` cannot do that.
 */
async function dump(name: string, cols: string[], from: string, keys: string[], where = "true"): Promise<{ rows: number; bytes: number }> {
  const file = path.join(OUT, `${name}.csv`);
  const header = cols.map((c) => c.split(/ AS | as /).pop()!.trim());
  if (!process.argv.includes("--force") && fs.existsSync(file) && fs.statSync(file).size > 200) {
    const bytes = fs.statSync(file).size, rows = fs.readFileSync(file, "utf8").split("\n").length - 2;
    console.log(`  ${name.padEnd(16)} ${String(rows).padStart(7)} rows  ${(bytes / 1048576).toFixed(1)} MB  (kept — pass --force to rewrite)`);
    return { rows, bytes };
  }
  const fd = fs.openSync(file, "w");
  fs.writeSync(fd, header.join(",") + "\r\n");
  const kAlias = keys.map((_, i) => `__k${i}`);
  let after: (string | number)[] = keys.map(() => ""), rows = 0, first = true;
  for (;;) {
    const cmp = first ? "true" : `(${keys.join(", ")}) > (${keys.map((_, i) => `$${i + 1}`).join(", ")})`;
    const sql = `SELECT ${cols.join(", ")}, ${keys.map((k, i) => `${k} AS ${kAlias[i]}`).join(", ")}
                   FROM ${from} WHERE ${where} AND ${cmp} ORDER BY ${keys.join(", ")} LIMIT 5000`;
    const batch = (await query<Record<string, unknown>>(sql, first ? [] : after)).rows;
    first = false;
    if (!batch.length) break;
    let buf = "";
    for (const r of batch) buf += header.map((h) => csvCell(r[h])).join(",") + "\r\n";
    fs.writeSync(fd, buf);
    rows += batch.length;
    after = kAlias.map((a) => batch[batch.length - 1][a] as string | number);
  }
  fs.closeSync(fd);
  const bytes = fs.statSync(file).size;
  console.log(`  ${name.padEnd(16)} ${String(rows).padStart(7)} rows  ${(bytes / 1048576).toFixed(1)} MB`);
  return { rows, bytes };
}

console.log(`writing CSVs to ${OUT}`);
const manifest: { file: string; rows: number; mb: string; query: string }[] = [];
const add = (file: string, r: { rows: number; bytes: number }, q: string) =>
  manifest.push({ file, rows: r.rows, mb: (r.bytes / 1048576).toFixed(1), query: q });

add("parts.csv", await dump("parts",
  ["p.id", "v.slug AS vendor", "p.sku", "p.slug", "c.slug AS category", "p.series", "p.family", "p.family_raw",
   "p.product_class::text AS product_class", "p.product_class_reason", "p.name", "p.name_doc_id",
   "p.datasheet_url", "p.retired_at", "p.created_at", "p.updated_at"],
  "parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id", ["p.id"]),
  "every part, live and retired, with the columns the layering and the profiles read");

add("facts_current.csv", await dump("facts_current",
  ["f.id", "v.slug AS vendor", "p.sku", "c.slug AS category", "f.field_key", "f.value::text AS value", "f.unit",
   "f.raw", "f.state::text AS state", "f.tier", "f.method", "f.inherited", "f.inherited_from", "f.doc_id",
   "f.locator", "f.extracted_at", "f.run_id", "f.created_at"],
  "facts f JOIN parts p ON p.id=f.part_id JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id",
  ["f.id"], "f.superseded_by IS NULL"),
  "CURRENT facts only (superseded_by IS NULL) — includes retraction rows, which carry no value");

add("doc_parts.csv", await dump("doc_parts",
  ["dp.doc_id", "dp.part_id", "p.sku", "v.slug AS vendor", "dp.link_basis", "dp.doc_relevance",
   "sd.doc_type", "sd.doc_class", "sd.url", "sd.title", "sd.fetched_at"],
  "doc_parts dp JOIN parts p ON p.id=dp.part_id JOIN vendors v ON v.id=p.vendor_id JOIN source_docs sd ON sd.doc_id=dp.doc_id",
  ["dp.doc_id", "dp.part_id"]),
  "every document-to-part link with its basis and relevance — the held rule reads these");

add("conflicts.csv", await dump("conflicts",
  ["cf.id", "p.sku", "cf.field_key", "cf.kept::text AS kept", "cf.rejected::text AS rejected",
   "cf.kept_raw", "cf.rejected_raw", "cf.reason", "cf.resolution", "cf.resolved_by", "cf.run_id",
   "cf.logged_at", "cf.resolved_at"],
  "conflicts cf JOIN parts p ON p.id=cf.part_id", ["cf.id"]),
  "open and resolved conflicts as logged");

add("relations.csv", await dump("relations",
  ["r.id", "p.sku AS from_sku", "r.to_sku", "r.kind::text AS kind", "r.tier", "r.doc_id"],
  "relations r JOIN parts p ON p.id=r.from_part_id", ["r.id"]),
  "successor / compatible / spare_of relations");

add("completeness.csv", await dump("completeness",
  ["cp.part_id", "p.sku", "c.slug AS category", "cp.required_total", "cp.required_present", "cp.pct",
   "cp.no_profile", "cp.missing::text AS missing", "cp.required_fields::text AS required_fields", "cp.computed_at"],
  "completeness cp JOIN parts p ON p.id=cp.part_id JOIN categories c ON c.id=p.category_id", ["cp.part_id"]),
  "the per-part score as stored, so the reviewer can re-derive any percentage");

add("source_docs.csv", await dump("source_docs",
  ["sd.doc_id", "sd.url", "sd.doc_type", "sd.doc_class", "v.slug AS vendor", "sd.title",
   "sd.fetched_at", "sd.content_sha256", "sd.cache_path", "sd.tables"],
  "source_docs sd LEFT JOIN vendors v ON v.id=sd.vendor_id", ["sd.doc_id"]),
  "every document known, with its classification");

add("runs.csv", await dump("runs",
  ["r.id", "r.kind", "r.status::text AS status", "r.git_sha", "r.started_at", "r.finished_at", "r.disk_free_bytes",
   "r.inputs::text AS inputs", "r.stats::text AS stats", "r.gate::text AS gate", "r.notes"],
  "runs r", ["r.id"]),
  "every recorded run — inputs, stats and gate, so a claim can be traced to the run that made it");

fs.writeFileSync(path.join(OUT, "QUERIES.md"),
  `# What produced each CSV\n\nBundle written ${new Date().toISOString()} from commit `
  + `${(await query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0] ? "" : ""}`
  + `\`${process.env.GIT_SHA ?? "see MANIFEST.md"}\`.\n\n`
  + manifest.map((m) => `## ${m.file}\n\n${m.rows.toLocaleString()} rows, ${m.mb} MB. ${m.query}\n`).join("\n"),
  "utf8");
console.log(`\n  total ${manifest.reduce((n, m) => n + m.rows, 0).toLocaleString()} rows, `
  + `${manifest.reduce((n, m) => n + Number(m.mb), 0).toFixed(1)} MB across ${manifest.length} files`);
await closePool();
