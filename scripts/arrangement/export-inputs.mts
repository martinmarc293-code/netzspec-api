// scripts/arrangement/export-inputs.mts — the store-side inputs of the arrangement site, READ-ONLY.
//
//   npx tsx scripts/arrangement/export-inputs.mts --vendor cisco --out DIR [--links-dry FILE]
//
// Writes, for the site generator (scripts/build-arrangement-site.mts):
//   links.jsonl       one row per doc_parts link of a live hardware part of the vendor: doc, part, link_basis,
//                     doc_relevance, link_evidence, link_run_id, doc_type, title, url, and `source`:
//                     "store" when the recorded derive-link-provenance run wrote the row, "dry-run" when the columns are
//                     still NULL and --links-dry (derive-link-provenance --links-out) supplies the decision, "underived"
//                     when neither — the page then says so, never a blank.
//   dictionary.json   per key: superseded_by (field_dictionary), facts_current_by_vendor (current, not retracted, on live
//                     parts, every vendor — a dictionary change is measured across all vendors).
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../../src/store/db.js";

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const vendor = arg("--vendor"), out = arg("--out"), dry = arg("--links-dry");
if (!vendor || !out) throw new Error("--vendor and --out are required");
fs.mkdirSync(out, { recursive: true });

const client = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: "arrangement/export-inputs", statement_timeout: 600_000 });
await client.connect();
await client.query("SET default_transaction_read_only = on");
// ONE SNAPSHOT for everything this script reads (C.5): a repeatable-read transaction, so links and counts describe one state
await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

const t0 = Date.now();
const dryMap = new Map<string, { basis: string | null; relevance: string | null; evidence: string }>();
if (dry && fs.existsSync(dry)) {
  for (const line of fs.readFileSync(dry, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { doc_id: string; part_id: string; basis: string | null; relevance: string | null; evidence: string };
    dryMap.set(`${r.doc_id}|${r.part_id}`, r);
  }
}
const links = (await client.query(`
  SELECT dp.doc_id, dp.part_id::text AS part_id, dp.link_basis, dp.doc_relevance, dp.link_evidence, dp.link_run_id,
         sd.doc_type, sd.title, sd.url
    FROM doc_parts dp
    JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
    JOIN source_docs sd ON sd.doc_id = dp.doc_id
   WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
   ORDER BY dp.part_id, dp.doc_id`, [vendor])).rows;
let fromStore = 0, fromDry = 0, underived = 0;
const lines: string[] = [];
for (const l of links) {
  let row: Record<string, unknown>;
  if (l.link_run_id !== null) { fromStore++; row = { ...l, source: "store" }; }
  else {
    const d = dryMap.get(`${l.doc_id}|${l.part_id}`);
    if (d) { fromDry++; row = { ...l, link_basis: d.basis, doc_relevance: d.relevance, link_evidence: d.evidence, source: "dry-run" }; }
    else { underived++; row = { ...l, source: "underived" }; }
  }
  lines.push(JSON.stringify(row));
}
fs.writeFileSync(path.join(out, "links.jsonl"), lines.join("\n") + "\n");

const usage = (await client.query(`
  SELECT f.field_key AS key, v.slug AS vendor, count(*)::int AS n
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL
   GROUP BY 1, 2`)).rows as { key: string; vendor: string; n: number }[];
const sup = (await client.query(`SELECT key, superseded_by FROM field_dictionary`)).rows as { key: string; superseded_by: string | null }[];
const dict: Record<string, { superseded_by: string | null; facts_current_by_vendor: Record<string, number> }> = {};
for (const s of sup) dict[s.key] = { superseded_by: s.superseded_by, facts_current_by_vendor: {} };
for (const u of usage) (dict[u.key] ??= { superseded_by: null, facts_current_by_vendor: {} }).facts_current_by_vendor[u.vendor] = u.n;
const snapshotAt = (await client.query(`SELECT now() AS at`)).rows[0].at;
await client.query("COMMIT");
await client.end();
fs.writeFileSync(path.join(out, "dictionary.json"), JSON.stringify({ snapshot_at: snapshotAt, keys: dict }));
fs.writeFileSync(path.join(out, "export-meta.json"), JSON.stringify({ vendor, snapshot_at: snapshotAt, links: links.length, from_store: fromStore, from_dry_run: fromDry, underived, dictionary_keys: Object.keys(dict).length }, null, 1));
console.log(`export-inputs ${vendor}: ${links.length} links (store ${fromStore}, dry-run ${fromDry}, underived ${underived}), ${Object.keys(dict).length} dictionary keys, ${Math.round((Date.now() - t0) / 1000)}s`);
