// scripts/record-title-provenance.mts — title_source = 'pdf-info-trailer' on the 68 PDF titles run 1289 wrote.
// Reviewer ruling 28 Sep 2026 (docs/decisions/2026-09-28-untitled-documents.md). Guarded on the title still being
// exactly what run 1289 wrote, and on the count: 68 or nothing.
//     npx tsx scripts/record-title-provenance.mts [--commit]
import fs from "node:fs";
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

const TSV = "data/dryrun/doc-titles-2026-09-28.tsv";
const rows = fs.readFileSync(TSV, "utf8").split("\n").slice(1).filter((l) => l.trim()).map((l) => l.split("\t"))
  .filter(([, , kind, outcome]) => kind === "pdf" && outcome === "recovered").map(([id, , , , title]) => ({ id, title }));
const db = getPool();
const match = await db.query<{ n: string }>(
  `SELECT count(*)::text n FROM source_docs sd JOIN unnest($1::text[], $2::text[]) AS m(id, t) ON sd.doc_id = m.id
    WHERE sd.title = m.t AND sd.title_source IS NULL`, [rows.map((r) => r.id), rows.map((r) => r.title)]);
console.log(`  ${rows.length} pdf-info-trailer titles in ${TSV}; ${match.rows[0].n} still carry exactly that title with no source`);
if (!process.argv.includes("--commit")) { console.log("  NOTHING WRITTEN. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("record-title-provenance", { tsv: TSV, rows: rows.length, ruling: "reviewer 28 Sep: title_source pdf-info-trailer" },
  async () => {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(
        `UPDATE source_docs sd SET title_source = 'pdf-info-trailer' FROM unnest($1::text[], $2::text[]) AS m(id, t)
          WHERE sd.doc_id = m.id AND sd.title = m.t AND sd.title_source IS NULL`, [rows.map((x) => x.id), rows.map((x) => x.title)]);
      if (r.rowCount !== rows.length) throw new Error(`would mark ${r.rowCount} of ${rows.length}; rolled back`);
      await c.query("COMMIT");
      return { stats: { marked: r.rowCount } };
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
    finally { c.release(); }
  });
console.log(`  run ${out.runId}: title_source recorded on ${rows.length}`);
await closePool();
