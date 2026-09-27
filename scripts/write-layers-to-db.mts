// scripts/write-layers-to-db.mts — put the built layers into the database, under a recorded run.
//
//   npx tsx scripts/write-layers-to-db.mts            # DRY RUN: counts and a sample, writes nothing
//   npx tsx scripts/write-layers-to-db.mts --commit   # the recorded run
//
// The layer model is built into data/layers/*.json and served to the site from there, while the API
// serves parts from the database. Two sources, nothing failing when they diverge, and SIX Phase A
// tests unable to judge anything because the columns do not hold the values.
//
// THE DRY RUN IS NOT A FORMALITY HERE. This writes a product line, family, family state, series and
// kind onto live catalogue rows; a wrong mapping is not a crash, it is 90,000 plausible wrong values
// that read exactly like right ones. So the default is to print what WOULD change, bucketed by what
// kind of change it is, with a sample of each — and `--commit` is the only path that writes.
//
// THE SENTINEL IS TRANSLATED, NOT COPIED. The build writes "(none)" where a line names no family,
// deliberately, because a review read NULL as "undecided". Copying that marker into a consumer-facing
// column is exactly the defect of 27 Sep — the literal string "(none)" on 3,993 switches and 3,975
// routers, where a shop tree prints it as the family name. Here it becomes NULL plus the state
// `no_family_named` plus a reason, so the distinction the review wanted survives and no consumer has
// to recognise a marker. The database refuses the sentinel outright (0026), so a mistake here is a
// failed write rather than a silent one.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { query, closePool } from "../src/store/db.js";

const COMMIT = process.argv.includes("--commit");
const DIR = path.join(REPO_ROOT, "data", "layers");

type Row = { sku: string; line: string | null; family: string | null; series: string | null; kind: string | null; bucket: string | null };

/** THE ROWS LIVE IN THE .rows.tsv, NOT IN THE .json. The first reader walked the JSON tree guessing at
 *  key names and produced 461 rows with ZERO layer values against 555 it could not read — which is what
 *  the dry run is for, and is the whole argument for never letting a writer's first run be a --commit.
 *  The TSV is the artefact the layering build emits for exactly this purpose and its header names the
 *  columns outright: sku, name, series_label, kind, bucket, product_line, product_family, series,
 *  placed_by, deploy_role, role_rule, role_issue, plan, belongs, label_evidence, family_carrier.
 *
 *  Columns are read BY NAME from the header rather than by position, because a column added in the
 *  middle would otherwise shift every value one place silently. */
function readLayerRows(file: string): { rows: Row[]; unreadable: number } {
  // NO REGEX AND NO BACKSLASH ESCAPES HERE, deliberately. The first version of this function was
  // written through a Python heredoc and arrived with a literal CR and LF INSIDE the regex literal --
  // "Unterminated regular expression" was the lucky outcome; the dangerous one is a pattern that
  // compiles and silently matches nothing. The separators are built from character codes instead, so
  // there is nothing for a shell or a heredoc to eat.
  const LF = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9);
  const text = fs.readFileSync(path.join(DIR, file), "utf8").split(CR + LF).join(LF);
  const lines = text.split(LF).filter((l) => l.length);
  if (!lines.length) return { rows: [], unreadable: 0 };
  const header = lines[0].split(TAB);
  const at = (name: string) => header.indexOf(name);
  const iSku = at("sku"), iKind = at("kind"), iLine = at("product_line"),
        iFamily = at("product_family"), iSeries = at("series"), iBucket = at("bucket");
  if (iSku < 0) return { rows: [], unreadable: lines.length - 1 };
  const rows: Row[] = [];
  let unreadable = 0;
  for (const line of lines.slice(1)) {
    const c = line.split(TAB);
    const sku = (c[iSku] ?? "").trim();
    if (!sku) { unreadable++; continue; }
    const cell = (i: number) => (i >= 0 && (c[i] ?? "").trim() ? c[i].trim() : null);
    rows.push({ sku, line: cell(iLine), family: cell(iFamily), series: cell(iSeries),
                kind: cell(iKind), bucket: cell(iBucket) });
  }
  return { rows, unreadable };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".rows.tsv")) : [];
if (!files.length) { console.error(`no .rows.tsv layer artefacts in ${path.relative(REPO_ROOT, DIR)} — nothing to write`); process.exit(1); }

const all: Row[] = [];
let unreadable = 0;
for (const f of files) {
  const r = readLayerRows(f);
  all.push(...r.rows);
  unreadable += r.unreadable;
}

// The sentinel translation, in ONE place so the dry run and the write cannot disagree about it.
const translate = (r: Row) => {
  const isSentinel = (r.family ?? "").startsWith("(");
  return {
    sku: r.sku,
    line: r.line,
    family: isSentinel ? null : r.family,
    family_state: r.family ? (isSentinel ? (r.family.includes("shared") ? "shared_across_line" : "no_family_named") : "named") : null,
    no_family_reason: isSentinel && !r.family!.includes("shared") ? "vendor-names-none" : null,
    series: r.series,
    kind: r.kind,
  };
};

const translated = all.map(translate);
const bySentinel = translated.filter((t) => t.family === null && t.family_state !== null).length;
const withKind = translated.filter((t) => t.kind).length;
const withSeries = translated.filter((t) => t.series).length;

console.log(`${files.length} layer artefacts -> ${all.length.toLocaleString()} rows` +
  (unreadable ? `, ${unreadable} unreadable (counted, not skipped silently)` : ""));
console.log(`  carry a product_line   : ${translated.filter((t) => t.line).length.toLocaleString()}`);
console.log(`  carry a family NAME    : ${translated.filter((t) => t.family).length.toLocaleString()}`);
console.log(`  family is a SENTINEL   : ${bySentinel.toLocaleString()} -> null + state + reason, never the marker itself`);
console.log(`  carry a series         : ${withSeries.toLocaleString()}`);
console.log(`  carry a kind           : ${withKind.toLocaleString()}`);
console.log(`\nsample of the translation:`);
for (const t of translated.slice(0, 3)) console.log(`  ${JSON.stringify(t)}`);

if (!COMMIT) {
  console.log(`\nDRY RUN — nothing written. Re-run with --commit to write these under a recorded run.`);
  await closePool();
  process.exit(0);
}

console.log(`\n--commit: writing under a recorded run…`);
// withRun is the repo's OWN wrapper and the reason to use it rather than a hand-rolled
// open/close is written into this project's rules: a write run whose process dies must be
// ROLLED BACK, never closed with its counts, and withRun is the path that has been tested.
// Six tunnel-killed runs were once closed "failed" with their stats, leaving 1,387 facts
// current under runs that never succeeded -- invisible, because completeness still held a
// row for every part.
const { withRun } = await import("../src/store/runs.js");
const out = await withRun("write-layers-to-db",
  { files: files.length, rows: all.length, contract: "layers .rows.tsv -> parts columns" },
  async () => {
    let updated = 0;
    const CHUNK = 500;
    for (let i = 0; i < translated.length; i += CHUNK) {
      const batch = translated.slice(i, i + CHUNK);
      const r = await query(
        "WITH u AS (SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])" +
        "   AS t(sku, line, family, family_state, no_family_reason, series, kind))" +
        " UPDATE parts p SET product_line = u.line, product_family = u.family," +
        "   product_family_state = u.family_state, no_family_reason = u.no_family_reason," +
        "   product_series = u.series, sku_kind = u.kind" +
        " FROM u WHERE p.sku = u.sku AND p.retired_at IS NULL" +
        " RETURNING 1",
        [batch.map((b) => b.sku), batch.map((b) => b.line), batch.map((b) => b.family),
         batch.map((b) => b.family_state), batch.map((b) => b.no_family_reason),
         batch.map((b) => b.series), batch.map((b) => b.kind)]);
      updated += r.rowCount ?? r.rows.length;
    }
    return { stats: { updated, rows_offered: translated.length } };
  });
console.log(`run ${out.runId}: ${(out.stats?.updated as number ?? 0).toLocaleString()} parts updated of ${translated.length.toLocaleString()} offered`);

// THE CONTROL, printed rather than assumed: what did NOT move. A row offered and not updated is a
// SKU the layers name and the catalogue does not hold, which is a real finding about the artefacts
// and must not read as a successful write.
const check = await query<{ n: string; sentinel: string; bucket: string }>(
  "SELECT count(*)::text AS n," +
  " count(*) FILTER (WHERE product_family LIKE '(%')::text AS sentinel," +
  " count(*) FILTER (WHERE product_series ILIKE '%shared parts')::text AS bucket" +
  " FROM parts WHERE retired_at IS NULL AND product_line IS NOT NULL");
const c = check.rows[0];
console.log(`control: ${Number(c.n).toLocaleString()} live parts now carry a product_line; ` +
  `${c.sentinel} carry a sentinel family (must be 0); ${c.bucket} carry a bucket as a series (must be 0)`);
await closePool();
