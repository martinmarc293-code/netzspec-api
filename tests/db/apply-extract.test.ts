// tests/db/apply-extract.test.ts — proof for src/pipeline/apply-extract.ts and gate-extract.ts:
// Cisco datasheet extraction becomes facts inside a GATED apply-specs run, and the gate can fail
// for each of its four reasons.
//
//   NETZSPEC_DB=test npx tsx tests/db/apply-extract.test.ts
//
// Fixtures live in tests/fixtures/extract/ and are shaped exactly as scraper/run.py writes
// cisco-specs-deep (HTML) and cisco-specs-pdf (PDF) output. The cached documents the gate re-reads
// are written for the duration of the suite: HTML under scraper/cache/<sha1(url)>.html and a real
// three-page PDF (built here, ruled tables pdfplumber can extract) under <sha1(url)>.bin — the
// netzscrape._key convention — and removed at the end.
//
// What one committed run must prove: the category comes from the PART ROW (a server fact is not
// normalised as a switch); HTML facts land tier 2 / html_table, PDF facts tier 1 / pdf_table;
// a family-scoped class-A value is inherited into the parts the document lists and ONLY those
// (sabotage: a part of the same family the document does not list receives nothing); a scope
// naming one PID reaches that PID only; a class-B value is never inherited; a class-C value is
// refused where the same document states it per SKU; a group label ("48-port models") is refused;
// a tier-0 value is protected (held, conflicts row); a same-tier disagreement is HELD (state
// conflict, conflicts row); an unmapped label, a refused value, a section-heading sentinel and an
// unknown SKU are each counted and reported and never written.
//
// SABOTAGE on the gate, each refused for the STATED reason: a value that differs from the golden
// (WRONG), a matching value at the wrong locator (LOCATOR_MISMATCH), a golden fact the extract
// lacks (RECALL_MISS), a value not on the cached page (PROVENANCE_MISS), fewer facts per document
// than the previous run (REGRESSION, lifted only by --allow-regression with a reason that lands in
// runs.notes), no golden overlap at all (UNVERIFIED, not a pass). And through the real CLI: a
// --commit run behind a failing gate exits 1, leaves the run `failed` with gate NULL and the reason
// in its notes, and writes no fact.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { docIdFor } from "../../src/store/docs.js";
import { unpackLocator } from "../../src/store/facts.js";
import {
  main, parseArgs, sourceKind, loadExtractFile, resolveScope, familyLabel, planExtract, reportPaths, writeReports, loadParts, PID_IN_TEXT,
  expandFragments, fragmentsOf, unionListValues, LIST_FIELDS,
} from "../../src/pipeline/apply-extract.js";
import {
  gateExtract, loadGolden, parseLocator, previousFactsPerDoc, previousPerDoc, planSample, fisherYates,
  reReadSource, eq, cellMatches, CACHE_DIR, GOLDEN_DIR, type Defect,
} from "../../src/pipeline/gate-extract.js";
import type { RawFact } from "../../src/core/deepSpecMap.js";
import type { SpecEntry } from "../../src/core/specMerge.js";
import { applyMerge, withRun, withTx, rollbackRun, noSourceProblem } from "../../src/store/index.js";
import { factRunSucceeded } from "../../src/api/queries/shared.js";
import { getPool } from "../../src/store/db.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`apply-extract.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "extract");
const GOLDEN = path.join(FIXTURES, "golden");
const fx = (name: string) => path.join(FIXTURES, name);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 900)}`); }
}
async function refuses(name: string, fn: () => Promise<unknown> | unknown, reason: RegExp): Promise<void> {
  sabotages++;
  try { await fn(); check(`SABOTAGE ${name}`, false, "was NOT refused"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(`SABOTAGE ${name}`, reason.test(m), `refused for the WRONG reason: ${m}`); }
}
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const U1 = "https://www.cisco.com/c/en/us/products/collateral/switches/nztest-9300-series-switches/nztest-9300-datasheet.html";
const U1B = "https://www.cisco.com/c/en/us/products/collateral/switches/nztest-9300-series-switches/nztest-9300-datasheet-rev2.html";
const U2 = "https://www.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/nztest-c240-specsheet.pdf";
const U3 = "https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/nztest-800g-optics/nztest-800g-datasheet.html";
const D1 = docIdFor(U1), D2 = docIdFor(U2);

// ---- the cached documents the gate re-reads -------------------------------------------------------
const PAGES: Record<string, string> = {
  [U1]: `<html><head><title>NZTEST 9300 datasheet</title><script>var x = "999 Gbps";</script></head><body>
<h1>NZTEST 9300 Series Switches Data Sheet</h1>
<table><tr><th>Model</th><th>Switching capacity</th><th>Forwarding rate</th><th>Blinkenlights</th><th>MAC address table</th></tr>
<tr><td>NZT-9300-24P</td><td>208 Gbps</td><td>154.76 Mpps</td><td>Yes</td><td>32,000</td></tr>
<tr><td>NZT-9300-48P</td><td>256 Gbps</td><td>190.47 Mpps</td><td>Yes</td><td>lots</td></tr>
<tr><td>NZT-UNKNOWN-1</td><td>100 Gbps</td><td>74 Mpps</td><td>No</td><td>16,000</td></tr></table>
<table><tr><th>Specification</th><th>NZT-9300 Series</th><th>NZT-9300-48P</th></tr>
<tr><td>IEEE standards</td><td>IEEE 802.1Q, IEEE 802.3ad</td><td></td></tr>
<tr><td>Dimensions (H x W x D) inches</td><td>1.73 x 17.5 x 16.1</td><td></td></tr>
<tr><td>Operating temperature</td><td>-5 to 45°C</td><td>-5 to 50°C</td></tr></table>
<table><tr><th>Model</th><th>Power supply</th></tr><tr><td>NZT-9300-24P</td><td>Power supply</td></tr></table>
<table><tr><th>Model</th><th>Switching capacity</th><th>Forwarding rate</th></tr>
<tr><td>NZT-9300-48P</td><td>512 Gbps</td><td></td></tr>
<tr><td>NZT-9300-24P</td><td></td><td>154.76 Mpps</td></tr></table>
</body></html>`,
  [U1B]: `<html><body><h1>NZTEST 9300 Series Switches Data Sheet (rev 2)</h1>
<table><tr><th>Model</th><th>Switching capacity</th><th>Forwarding rate</th><th>MAC address table</th></tr>
<tr><td>NZT-9300-24P</td><td>218 Gbps</td><td>154.76 Mpps</td><td>32,000</td></tr></table></body></html>`,
  // Condition A (12 Sep 2026): row 1 states three values no domain holds; row 2 is the in-domain control.
  [U3]: `<html><body><h1>NZTEST 800G Optics Data Sheet</h1>
<table><tr><th>Model</th><th>Form factor</th><th>Connector type</th><th>Cable type</th></tr>
<tr><td>NZT-OSFP-XD-A</td><td>OSFP-XD</td><td>SN</td><td>AEC</td></tr>
<tr><td>NZT-QDD-400G-B</td><td>QSFP-DD</td><td>LC</td><td>SMF</td></tr></table></body></html>`,
};

/** A minimal PDF with ruled tables pdfplumber extracts: one table per page at (x0 50, y0 700), 24pt rows, 130pt columns (four of them still fit inside the 612pt MediaBox). */
function tablePdf(pages: { title: string; rows: string[][] }[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objs: string[] = []; const add = (s: string) => { objs.push(s); return objs.length; };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const pg of pages) {
    const x0 = 50, y0 = 700, cw = 130, rh = 24, nr = pg.rows.length, nc = Math.max(...pg.rows.map((r) => r.length));
    let c = "0.5 w\n";
    for (let i = 0; i <= nr; i++) c += `${x0} ${y0 - i * rh} m ${x0 + nc * cw} ${y0 - i * rh} l S\n`;
    for (let j = 0; j <= nc; j++) c += `${x0 + j * cw} ${y0} m ${x0 + j * cw} ${y0 - nr * rh} l S\n`;
    for (let i = 0; i < nr; i++) for (let j = 0; j < pg.rows[i].length; j++) c += `BT /F1 10 Tf ${x0 + j * cw + 4} ${y0 - (i + 1) * rh + 8} Td (${esc(pg.rows[i][j])}) Tj ET\n`;
    c += `BT /F1 10 Tf 50 740 Td (${esc(pg.title)}) Tj ET\n`;
    const cid = add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}endstream`);
    pageIds.push(objs.length + 1);
    add(`<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
  }
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  for (const i of pageIds) objs[i - 1] = objs[i - 1].replace("PAGES", `${pagesId} 0 R`);
  const catId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const PDF = tablePdf([
  { title: "OVERVIEW", rows: [["Ordering", "NZT-UCS-C240"]] },
  { title: "TECHNICAL SPECIFICATIONS", rows: [["Parameter", "Value"], ["Operating temperature", "10 to 35 C"], ["Weight", "35 kg"]] },
  { title: "TECHNICAL SPECIFICATIONS", rows: [["Model", "Height", "Operating temperature", "Weight (kg)"], ["NZT-UCS-C240", "3.42 in", "10 to 35 C", "35"]] },
]);

const cacheFiles: string[] = [];
const tmpDirs: string[] = [];
function cleanup(): void {
  for (const f of cacheFiles) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
}
process.on("exit", cleanup);
fs.mkdirSync(CACHE_DIR, { recursive: true });
for (const [url, html] of Object.entries(PAGES)) {
  const f = path.join(CACHE_DIR, `${sha1(url)}.html`);
  if (fs.existsSync(f)) { console.error(`MISS  refusing: ${f} already exists in the cache (a real page?)`); process.exit(1); }
  fs.writeFileSync(f, html, "utf8"); cacheFiles.push(f);
}
{
  const f = path.join(CACHE_DIR, `${sha1(U2)}.bin`);
  if (fs.existsSync(f)) { console.error(`MISS  refusing: ${f} already exists in the cache`); process.exit(1); }
  fs.writeFileSync(f, PDF); cacheFiles.push(f);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nz-extract-")); tmpDirs.push(tmp);
const deriveFrom = (base: string, name: string, edit: (records: Record<string, unknown>[]) => Record<string, unknown>[]): string => {
  const doc = JSON.parse(fs.readFileSync(fx(base), "utf8")) as { records: Record<string, unknown>[] };
  doc.records = edit(doc.records);
  const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(doc, null, 1)); return f;
};
const derive = (name: string, edit: (records: Record<string, unknown>[]) => Record<string, unknown>[]): string => deriveFrom("good-html.json", name, edit);

// ---- database fixture --------------------------------------------------------------------------------
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität'),
  ('forwarding_rate', 'n', 'Mpps', 'Forwarding rate', 'Weiterleitungsrate'),
  ('mac_table', 'n', 'Einträge', 'MAC address table', 'MAC-Adresstabelle'),
  ('ieee_standards', 'ls', NULL, 'IEEE standards', 'IEEE-Standards'),
  ('dimensions', 'struct', 'mm', 'Dimensions (H×W×D)', 'Abmessungen (H×B×T)'),
  ('temp_operating', 'nr', '°C', 'Operating temperature', 'Betriebstemperatur'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
  ON CONFLICT (key) DO NOTHING`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const cat = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
const switches = await cat("switches"), servers = await cat("servers-unified-computing");
const part = async (sku: string, category: number, family: string): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason) VALUES ($1, $2, $3, $4, $5, 'hardware', 'test') RETURNING id`,
  [cisco, sku, sku.toLowerCase(), category, family])).rows[0].id;
const p24 = await part("NZT-9300-24P", switches, "NZTEST 9300");
const p48 = await part("NZT-9300-48P", switches, "NZTEST 9300");
const pNot = await part("NZT-9300-NOTLISTED", switches, "NZTEST 9300");   // same family, NOT in the document's PID list
const pC240 = await part("NZT-UCS-C240", servers, "NZTEST UCS C-Series");
// an operator-reviewed (tier 0) value the extraction disagrees with: must be protected
await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method) VALUES ($1, 'switching_capacity', '999'::jsonb, 'Gbit/s', '999 Gbps', 'verified', 0, 'hexcat_seed')`, [p24]);
// a tier-2 value from ANOTHER document the extraction disagrees with: must be held
const otherUrl = "https://www.cisco.com/c/en/us/products/nztest/other-page.html";
await query(`INSERT INTO source_docs (doc_id, url, doc_type, vendor_id) VALUES ($1, $2, 'vendor_page', $3)`, [docIdFor(otherUrl), otherUrl, cisco]);
await query(`INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, locator) VALUES ($1, 'forwarding_rate', '100'::jsonb, 'Mpps', '100 Mpps', 'verified', 2, 'html_table', $2, 't0:r0:c0')`, [p48, docIdFor(otherUrl)]);

// =====================================================================================================
// the pure pieces
// =====================================================================================================
{
  const p = parseArgs(["a.json", "--commit", "--sample", "5", "--allow-regression", "parser fix dropped a bogus column", "--tag", "t", "b.json"]);
  check("parseArgs: paths, --commit, --sample, --allow-regression, --tag", p.paths.join(",") === "a.json,b.json" && p.commit && p.sample === 5 && p.allowRegression === "parser fix dropped a bogus column" && p.tag === "t" && p.vendor === "cisco", p);
  const d = parseArgs(["a.json"]);
  check("parseArgs defaults: dry run, sample 60, no regression allowance, tag cisco", !d.commit && d.sample === 60 && d.allowRegression === null && d.tag === "cisco", d);
  await refuses("parseArgs: --allow-regression without a reason", () => parseArgs(["a.json", "--allow-regression", " "]), /needs a reason/);
  check("sourceKind: cisco-specs-pdf is tier 1 pdf_table, cisco-specs-deep tier 2 html_table",
    sourceKind("cisco-specs-pdf").tier === 1 && sourceKind("cisco-specs-pdf").method === "pdf_table" && sourceKind("cisco-specs-pdf").doc_type === "vendor_datasheet_pdf"
      && sourceKind("cisco-specs-deep").tier === 2 && sourceKind("cisco-specs-deep").method === "html_table" && sourceKind("cisco-specs-deep").doc_type === "vendor_datasheet_html");
  await refuses("sourceKind: an unknown extractor source is refused, never given a tier", () => sourceKind("cisco-datasheet-specs"), /unknown extractor source "cisco-datasheet-specs"/);
  await refuses("loadExtractFile: a file that is not extractor output", () => loadExtractFile(fx("golden/nztest.golden.json")), /no "records" array/);
  await refuses("loadExtractFile: a missing file is named", () => loadExtractFile("tests/fixtures/extract/nope.json"), /no such file/);
  const g = loadExtractFile(fx("good-html.json"));
  check("loadExtractFile splits __doc__ records from facts and reads the source", g.source === "cisco-specs-deep" && g.docs.length === 1 && g.facts.length === 13 && g.kind.tier === 2, { docs: g.docs.length, facts: g.facts.length });
}
{
  const pids = ["NZT-9300-24P", "NZT-9300-48P", "C9300-24P"];
  check("resolveScope: __document__ is the whole document", resolveScope("__document__", pids).kind === "document");
  const one = resolveScope("NZT-9300-48P", pids);
  check("resolveScope: a label equal to one of the document's OWN listed PIDs resolves to it", one.kind === "pids" && one.pids.join() === "NZT-9300-48P", one);
  const named = resolveScope("Catalyst C9300-24P and C9300-48P models", pids);
  check("resolveScope: Catalyst part numbers inside a label are read out", named.kind === "pids" && named.pids.join() === "C9300-24P,C9300-48P", named);
  sabotages++;
  check("SABOTAGE resolveScope: a group label ('48-port models (1/10G uplinks)') is REFUSED, never inferred from a PID prefix",
    resolveScope("48-port models (1/10G uplinks)", pids).kind === "unresolved" && resolveScope("", pids).kind === "unresolved" && resolveScope(undefined, pids).kind === "unresolved");
  check("PID_IN_TEXT uses lookarounds, not word boundaries: a PID glued to a slash suffix is still one PID",
    [...("C9300-24P/A".matchAll(PID_IN_TEXT))].map((m) => m[1]).join() === "C9300-24P" && [...("xC9300-24P".matchAll(PID_IN_TEXT))].length === 0);
  check("familyLabel: the scope label, or the datasheet's directory for a document scope",
    familyLabel("Catalyst 9300L models", U1) === "Catalyst 9300L models" && familyLabel("__document__", U1) === "nztest-9300-series-switches" && familyLabel(undefined, U1) === "nztest-9300-series-switches");
  check("parseLocator: HTML t0:r1:c2, PDF grid p12:t0:r3:c1, PDF param p1:t0:r2 (column defaults to 1), garbage null",
    JSON.stringify(parseLocator("t0:r1:c2")) === JSON.stringify({ p: null, t: 0, r: 1, c: 2 }) && JSON.stringify(parseLocator("p12:t0:r3:c1")) === JSON.stringify({ p: 12, t: 0, r: 3, c: 1 })
      && JSON.stringify(parseLocator("p1:t0:r2")) === JSON.stringify({ p: 1, t: 0, r: 2, c: 1 }) && parseLocator("description:foo") === null && parseLocator(undefined) === null);
  check("eq: numbers to 1e-6, objects structurally, lists element-wise", eq(208, 208.0000001) && eq({ h: 1, w: 2 }, { w: 2, h: 1 }) && eq(["a", "b"], ["a", "b"]) && !eq(["a"], ["a", "b"]) && !eq(208, 218));
  check("cellMatches folds whitespace and the adapters' 160-char truncation", cellMatches("208\n Gbps", "208 Gbps") && cellMatches("x".repeat(200), "x".repeat(160)) && !cellMatches("256 Gbps", "208 Gbps"));
  await refuses("loadGolden: a missing directory is named", () => loadGolden(path.join(tmp, "nope")), /golden directory does not exist/);
  const golden = loadGolden(GOLDEN);
  check("loadGolden reads the fixture sample (5 expectations, each tagged with its file)", golden.length === 5 && golden.every((g) => g.from === "nztest.golden.json"));
}
{
  // the re-reader itself: HTML cell + text, PDF cell + page text, PDF param without a column, no cache
  const r = reReadSource([
    { url: U1, loc: parseLocator("t0:r1:c1"), label: "Switching capacity", value: "208 Gbps" },
    { url: U1, loc: parseLocator("t0:r2:c1"), label: "Switching capacity", value: "208 Gbps" },
    { url: U1, loc: parseLocator("t9:r0:c0"), label: "Switching capacity", value: "999 Gbps" },
    { url: U2, loc: parseLocator("p2:t0:r1:c2"), label: "Operating temperature", value: "10 to 35 C" },
    { url: U2, loc: parseLocator("p1:t0:r2"), label: "Weight", value: "35 kg" },
    { url: "https://www.cisco.com/nztest/not-cached.html", loc: parseLocator("t0:r0:c0"), label: "x", value: "y" },
    { url: U1, loc: parseLocator("t0:r1:c1"), label: "Model: Switching capacity [Gbps]", value: "208 Gbps" },
    { url: U1, loc: parseLocator("t0:r1:c1"), label: "Nonexistent section: Switching capacity", value: "208 Gbps" },
  ]);
  check("reReadSource HTML: the cell at the locator, label and value in the page text", r[0].status === "ok" && r[0].cell === "208 Gbps" && r[0].label_in_text === true && r[0].value_in_text === true, r[0]);
  check("reReadSource HTML: a locator pointing at another cell returns THAT cell (256 Gbps), value still in text", r[1].status === "ok" && r[1].cell === "256 Gbps" && r[1].value_in_text === true, r[1]);
  sabotages++;
  check("SABOTAGE reReadSource: a value that is only inside <script> is NOT 'in the page text', and a locator beyond the grid is out_of_range", r[2].status === "out_of_range" && r[2].value_in_text === false, r[2]);
  check("reReadSource PDF: the grid cell on page 2 and the page text", r[3].status === "ok" && r[3].cell === "10 to 35 C" && r[3].label_in_text === true && r[3].value_in_text === true, r[3]);
  check("reReadSource PDF: a param locator without a column reads column 1", r[4].status === "ok" && r[4].cell === "35 kg", r[4]);
  check("reReadSource: no cached document -> no_cache, never a pass", r[5].status === "no_cache", r[5]);
  check("reReadSource: a label the extractor synthesised from two cells ('section: row [unit]') counts as present when every part is on the page", r[6].label_in_text === true, r[6]);
  sabotages++;
  check("SABOTAGE reReadSource: a composite label with a part that is NOT on the page is not present", r[7].label_in_text === false, r[7]);
}

// =====================================================================================================
// the plan over the good fixtures (nothing written)
// =====================================================================================================
// main() closes the pool when it finishes; getPool() opens a fresh one, so never hold a pool across a main() call
const db = () => getPool();
const goodFiles = [loadExtractFile(fx("good-html.json")), loadExtractFile(fx("good-pdf.json"))];
const plan = await planExtract(goodFiles, { vendor: "cisco", db: db() });
{
  const s = plan.stats;
  check("plan: 2 documents, 18 raw facts = 12 SKU-scoped + 6 family-scoped, none without a document",
    s.docs === 2 && s.facts_raw === 18 && s.facts_sku_scoped === 12 && s.facts_family_scoped === 6 && s.facts_without_doc === 0, s);
  check("plan: 1 unmapped label, 1 sentinel, 2 refused values, 13 mapped", s.unmapped === 1 && s.sentinel === 1 && s.rejected === 2 && s.mapped_ok === 13, s);
  check("plan: the unknown SKU is counted once (in the PID list and as a fact), never mapped", s.sku_unknown === 1 && s.sku_unknown_facts === 1 && s.pid_list_unknown === 1 && plan.unknownSkus.get("NZT-UNKNOWN-1")?.where.size === 2, s);
  check("plan: inheritance — 3 applied, 2 class B refused (dimensions, weight), 1 group label unresolved, 1 scope violation, 1 class-C exception",
    s.inherit_ok === 3 && s.inherit_class_b === 2 && s.inherit_scope_unresolved === 1 && s.inherit_scope_violation === 1 && s.inherit_class_c_exception === 1 && s.duplicate_field === 0, s);
  check("plan: 3 parts offered; facts per document 13 (HTML) and 5 (PDF); produced (part, field) entries 8 and 2", s.parts_offered === 3 && plan.factsPerDoc[D1] === 13 && plan.factsPerDoc[D2] === 5
    && plan.producedPerDoc[D1] === 8 && plan.producedPerDoc[D2] === 2, { facts: plan.factsPerDoc, produced: plan.producedPerDoc });
  const doc1 = plan.docs.find((d) => d.doc_id === D1)!, doc2 = plan.docs.find((d) => d.doc_id === D2)!;
  check("plan: each document knows its listed parts and its majority category (from the PART ROWS)",
    doc1.parts.map((p) => p.sku).sort().join() === "NZT-9300-24P,NZT-9300-48P" && doc1.category === "switches" && doc2.parts.length === 1 && doc2.category === "servers-unified-computing" && doc2.kind.tier === 1, { d1: doc1.category, d2: doc2.category });
  const e24 = plan.incoming.get(p24) ?? [], e48 = plan.incoming.get(p48) ?? [], eC = plan.incoming.get(pC240) ?? [];
  const k = (es: typeof e24) => es.map((e) => `${e.k}${e.inherited ? "*" : ""}`).sort().join(",");
  check("plan: NZT-9300-24P gets switching_capacity, forwarding_rate, mac_table and inherited ieee_standards", k(e24) === "forwarding_rate,ieee_standards*,mac_table,switching_capacity", k(e24));
  check("plan: NZT-9300-48P gets its two values, inherited ieee_standards and the temperature scoped to it alone", k(e48) === "forwarding_rate,ieee_standards*,switching_capacity,temp_operating*", k(e48));
  sabotages++;
  check("SABOTAGE plan: NZT-9300-NOTLISTED (same family, not in the document's PID list) is offered NOTHING", !plan.incoming.has(pNot));
  check("plan: the PDF part gets its per-SKU temperature and weight (tier 1, pdf_table) and NOT the document-scoped temperature copy nor the document-scoped class-B weight",
    k(eC) === "temp_operating,weight" && eC[0].prov.tier === 1 && eC[0].prov.method === "pdf_table" && eC[0].prov.doc_id === D2 && eC[0].prov.locator === "p2:t0:r1:c2" && JSON.stringify(eC[0].value) === JSON.stringify({ min: 10, max: 35 }), eC);
  const wt = eC.find((e) => e.k === "weight");
  check("plan: the UNIT came from the label, so `raw` keeps the label — 'Weight (kg) | 35' replays through the normaliser, a bare '35' does not; the cell alone is what the gate re-reads",
    wt?.value === 35 && wt.unit === "kg" && wt.raw === "Weight (kg) | 35" && plan.produced.get("NZT-UCS-C240")?.get("weight")?.raw === "35", { entry: wt, produced: plan.produced.get("NZT-UCS-C240")?.get("weight") });
  check("plan: a label with no unit in it is stored as the bare cell (no ' | ' prefix on every fact)", plan.incoming.get(p24)?.find((e) => e.k === "mac_table")?.raw === "32,000");
  const mac = e24.find((e) => e.k === "mac_table");
  check("plan: English locale — '32,000' is thirty-two thousand; HTML provenance is tier 2 html_table with the doc and locator",
    mac?.value === 32000 && mac.prov.tier === 2 && mac.prov.method === "html_table" && mac.prov.doc_id === D1 && mac.prov.locator === "t0:r1:c4" && mac.state === "verified", mac);
  const ieee = e48.find((e) => e.k === "ieee_standards");
  check("plan: an inherited entry is labelled with its family and the document it came from", ieee?.inherited === true && ieee.inherited_from === "nztest-9300-series-switches" && JSON.stringify(ieee.value) === JSON.stringify(["IEEE 802.1Q", "IEEE 802.3ad"]), ieee);
  check("plan: the refused values are quarantined with key, reason and locator",
    plan.quarantine.length === 2 && plan.quarantine.some((q) => q.sku === "NZT-9300-48P" && q.key === "mac_table" && q.reason === "PARSE_FAIL" && q.locator === "t0:r2:c4")
      && plan.quarantine.some((q) => q.sku === "NZT-UCS-C240" && q.key === "dimensions" && q.reason === "STRUCT_UNPARSED"), plan.quarantine);
  check("plan: the unmapped label carries a sample value and the part's category", plan.unmapped.get("Blinkenlights")?.samples.join() === "Yes" && [...plan.unmapped.get("Blinkenlights")!.categories].join() === "switches");
  check("plan: produced (what the gate grades) mirrors incoming, keyed by SKU", plan.produced.get("NZT-9300-24P")?.get("switching_capacity")?.value === 208 && plan.produced.get("NZT-UCS-C240")?.get("temp_operating")?.locator === "p2:t0:r1:c2");
  const resolve = await loadParts("cisco", ["nzt-9300-24p", "NZT-9300-48P", "NOPE"], db());
  check("loadParts: exact SKU first, case-insensitive second, unknown null", resolve("NZT-9300-48P")?.id === p48 && resolve("nzt-9300-24p")?.id === p24 && resolve("NOPE") === null);
}

// =====================================================================================================
// the gate, driven directly
// =====================================================================================================
const golden = loadGolden(GOLDEN);
const gateOf = async (files: string[], opts: { previous?: Map<string, number>; previousProduced?: Map<string, number>; absentScope?: Set<string>; allow?: string | null; goldenDir?: string; sample?: number } = {}) => {
  const p = await planExtract(files.map((f) => loadExtractFile(f)), { vendor: "cisco", db: db() });
  return gateExtract({
    produced: p.produced, facts: p.allFacts, docs: p.docs, factsPerDoc: p.factsPerDoc, producedPerDoc: p.producedPerDoc,
    previous: opts.previous ?? new Map(), previousProduced: opts.previousProduced, absentScope: opts.absentScope,
    golden: loadGolden(opts.goldenDir ?? GOLDEN), sample: opts.sample ?? 100, allowRegression: opts.allow ?? null, isPart: (s) => p.resolvePart(s) !== null, random: () => 0.5,
  });
};
{
  const { gate, misses: m } = await gateOf([fx("good-html.json"), fx("good-pdf.json")]);
  check("gate PASSES on the good fixtures: precision 1, recall 1, 5 golden facts correct, every sampled fact re-read clean",
    gate.passed && gate.verdict === "pass" && gate.precision === 1 && gate.recall === 1 && gate.golden.correct === 5 && gate.golden.wrong === 0 && gate.golden.missing === 0 && gate.golden.unchecked === 0
      && gate.provenance.sampled === 18 && gate.provenance.checked === 18 && gate.provenance.ok === 18 && gate.provenance.mismatched === 0 && gate.sampled === 18 && m.length === 0, { gate, m });
}
{
  sabotages++;
  const { gate, misses: m } = await gateOf([fx("sabotage-wrong-value.json")]);
  check("SABOTAGE gate: a value that differs from the golden -> WRONG (the cell re-reads fine, the hand-verified value is what it is), not passed",
    !gate.passed && gate.verdict === "fail" && gate.golden.wrong === 1 && gate.golden.correct === 2 && gate.precision < 0.98 && m.some((x) => /^WRONG doc=\S+ NZT-9300-24P switching_capacity: got 218 Gbit\/s expected 208 Gbit\/s/.test(x)) && !m.some((x) => /LOCATOR_MISMATCH|RECALL_MISS/.test(x)), { gate, m });
}
{
  sabotages++;
  const { gate, misses: m } = await gateOf([fx("sabotage-locator.json")]);
  check("SABOTAGE gate: the right value at the WRONG locator -> LOCATOR_MISMATCH naming both cells, not passed",
    !gate.passed && gate.golden.wrong === 1 && m.some((x) => /^LOCATOR_MISMATCH doc=\S+ NZT-9300-24P switching_capacity: t0:r2:c1 holds "256 Gbps", the fact recorded "208 Gbps"/.test(x)), { gate, m });
}
{
  sabotages++;
  const { gate, misses: m } = await gateOf([fx("sabotage-recall.json")]);
  check("SABOTAGE gate: a golden fact the extract lacks -> RECALL_MISS by document, SKU and field; recall < 1; not passed",
    !gate.passed && gate.recall < 1 && gate.golden.missing === 1 && gate.golden.wrong === 0 && m.some((x) => x.startsWith(`RECALL_MISS doc=${D1} NZT-9300-24P forwarding_rate expected 154.76 Mpps`) && /not in the extract at all/.test(x)), { gate, m });
}
{
  sabotages++;
  const f = derive("sabotage-dropped.json", (rs) => rs.map((r) => (r.label === "Forwarding rate" && r.sku === "NZT-9300-24P" ? { ...r, label: "Forwarding rate (Mpps)", value: "n/a" } : r)));
  const { gate, misses: m } = await gateOf([f]);
  check("SABOTAGE gate: a golden fact whose SKU is in the file but was refused says so in the miss",
    !gate.passed && gate.golden.missing === 1 && m.some((x) => /RECALL_MISS .*NZT-9300-24P forwarding_rate.*not in the extract at all/.test(x)), m);
  const f2 = derive("sabotage-unmapped.json", (rs) => rs.map((r) => (r.label === "Forwarding rate" && r.sku === "NZT-9300-24P" ? { ...r, label: "Fwd perf" } : r)));
  const g2 = await gateOf([f2]);
  check("SABOTAGE gate: a golden raw value present in the file under an unmapped label names its locator and label",
    !g2.gate.passed && g2.misses.some((x) => /RECALL_MISS .*NZT-9300-24P forwarding_rate.*raw value is in the file at t0:r1:c2 under label "Fwd perf"/.test(x)), g2.misses);
}
{
  sabotages++;
  const f = derive("sabotage-provenance.json", (rs) => rs.map((r) => (r.label === "Blinkenlights" ? { ...r, value: "Maybe" } : r)));
  const { gate, misses: m } = await gateOf([f]);
  check("SABOTAGE gate: a sampled fact whose value is NOT on the cached page -> PROVENANCE_MISS, not passed (golden untouched: precision 1)",
    !gate.passed && gate.precision === 1 && gate.recall === 1 && gate.provenance.mismatched === 1 && m.some((x) => /^PROVENANCE_MISS NZT-9300-24P "Blinkenlights" = "Maybe" at t0:r1:c3 \(value not in page text\)/.test(x)), { gate, m });
}
{
  sabotages++;
  const prev = new Map([[D1, 14]]);
  const { gate, misses: m } = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { previous: prev });
  check("SABOTAGE gate: fewer facts for a document than the previous run -> REGRESSION, not passed",
    !gate.passed && gate.regression.regressed.length === 1 && gate.regression.regressed[0].doc_id === D1 && gate.regression.regressed[0].before === 14 && gate.regression.regressed[0].after === 13 && !gate.regression.allowed && m.some((x) => x.startsWith(`REGRESSION doc=${D1}: 14 raw facts in the previous run, 13 now`)), { gate, m });
  const allowed = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { previous: prev, allow: "parser fix dropped a bogus column" });
  check("gate: the same regression with --allow-regression passes and carries the reason", allowed.gate.passed && allowed.gate.regression.allowed && allowed.gate.regression.reason === "parser fix dropped a bogus column", allowed.gate.regression);
  const more = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { previous: new Map([[D1, 13], [D2, 2]]) });
  check("gate: equal or more facts than before is no regression", more.gate.passed && more.gate.regression.docs_compared === 2 && more.gate.regression.regressed.length === 0);
}
{
  sabotages++;
  const { gate, misses: m } = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { goldenDir: GOLDEN_DIR });
  check("SABOTAGE gate: no golden PID in the file (the real golden sample vs NZTEST parts) -> UNVERIFIED, not passed, and says it is overlap rather than wrong data",
    !gate.passed && gate.verdict === "unverified" && gate.golden.overlap_skus === 0 && m[0].startsWith("UNVERIFIED: none of the") && gate.golden.expectations > 5, { gate, m });
  const noCache = await (async () => {
    const p = await planExtract([loadExtractFile(fx("good-html.json"))], { vendor: "cisco", db: db() });
    return gateExtract({ produced: p.produced, facts: p.allFacts, docs: p.docs, factsPerDoc: p.factsPerDoc, previous: new Map(), golden, sample: 5, cacheDir: tmp, random: () => 0.5 });
  })();
  sabotages++;
  check("SABOTAGE gate: no cached page at all -> golden facts UNCHECKED and the sample re-read zero -> UNVERIFIED, never a pass",
    !noCache.gate.passed && noCache.gate.verdict === "unverified" && noCache.gate.golden.unchecked === 4 && noCache.gate.provenance.checked === 0 && noCache.gate.sampled === 0, noCache.gate);
  const empty = gateExtract({ produced: new Map(), facts: [], docs: [], factsPerDoc: {}, previous: new Map(), golden, sample: 10 });
  check("gate: an empty extract is unverified, not a pass", !empty.gate.passed && empty.gate.verdict === "unverified");
}

// =====================================================================================================
// a committed run over the good fixtures
// =====================================================================================================
const runsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n;
const factsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n;
await main([fx("good-html.json"), fx("good-pdf.json"), "--golden-dir", GOLDEN, "--tag", "nztest", "--sample", "100"]);
check("DRY RUN (no --commit) opens no run, writes no fact, no document",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n === runsBefore && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === factsBefore
    && (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_docs")).rows[0].n === 1 && (process.exitCode === undefined || process.exitCode === 0));

await main([fx("good-html.json"), fx("good-pdf.json"), "--commit", "--golden-dir", GOLDEN, "--tag", "nztest", "--sample", "100"]);
check("the committed run set no failure exit code", process.exitCode === undefined || process.exitCode === 0, process.exitCode);
type RunRow = { id: number; kind: string; status: string; gate: Record<string, unknown> | null; stats: Record<string, unknown>; notes: string | null; inputs: Record<string, unknown> };
const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
check("the run row: kind apply-specs, succeeded, notes name the files and sources", run?.kind === "apply-specs" && run.status === "succeeded" && run.notes === "files=good-html.json,good-pdf.json; sources=cisco-specs-deep,cisco-specs-pdf", run);
check("the run row carries a PASSING gate with precision 1, recall 1, 17 facts re-read and no miss",
  run?.gate?.passed === true && run.gate.precision === 1 && run.gate.recall === 1 && run.gate.sampled === 18 && run.gate.verdict === "pass" && (run.gate.misses as unknown[]).length === 0, run?.gate);
check("the run row records its inputs with hashes, sources and flags",
  (run?.inputs.files as { sha256: string; source: string }[]).length === 2 && (run?.inputs.files as { source: string }[])[1].source === "cisco-specs-pdf" && run.inputs.commit === true && run.inputs.sample === 100, run?.inputs);
const st = (run?.stats ?? {}) as Record<string, number> & { facts_per_doc: Record<string, number> };
check("stats: the plan counts plus the merge — 8 inserts, 1 protected, 1 conflict, 3 parts touched, 2 docs, 3 doc-part links",
  st.insert === 8 && st.protected === 1 && st.conflict === 1 && st.parts_touched === 3 && st.docs_written === 2 && st.doc_parts_linked === 3 && st.mapped_ok === 13 && st.sku_unknown === 1, st);
check("stats: facts per document AND produced (part, field) entries per document are recorded for the next run's regression check",
  st.facts_per_doc?.[D1] === 13 && st.facts_per_doc?.[D2] === 5 && (st as unknown as { produced_per_doc: Record<string, number> }).produced_per_doc?.[D1] === 8
    && (st as unknown as { produced_per_doc: Record<string, number> }).produced_per_doc?.[D2] === 2, { facts: st.facts_per_doc, produced: (st as unknown as { produced_per_doc: unknown }).produced_per_doc });

type FactRow = { field_key: string; value: unknown; unit: string | null; raw: string; state: string; tier: number; method: string; doc_id: string | null; locator: string | null; inherited: boolean; inherited_from: string | null; run_id: number | null; extracted_at: string | null; norm_v: string | null };
const factsOf = async (partId: number) => (await query<FactRow>(
  "SELECT field_key, value, unit, raw, state, tier, method, doc_id, locator, inherited, inherited_from, run_id, extracted_at::text AS extracted_at, norm_v FROM facts WHERE part_id = $1 AND superseded_by IS NULL ORDER BY field_key", [partId])).rows;
{
  const f24 = await factsOf(p24);
  const by = (rows: FactRow[], k: string) => rows.find((r) => r.field_key === k);
  check("NZT-9300-24P: forwarding_rate and mac_table land VERIFIED, tier 2, html_table, with doc, locator, run id, day and normaliser version",
    by(f24, "forwarding_rate")?.value === 154.76 && by(f24, "forwarding_rate")?.state === "verified" && by(f24, "forwarding_rate")?.tier === 2 && by(f24, "forwarding_rate")?.method === "html_table"
      && by(f24, "forwarding_rate")?.doc_id === D1 && unpackLocator(by(f24, "forwarding_rate")?.locator ?? null).locator === "t0:r1:c2" && by(f24, "forwarding_rate")?.run_id === run.id && by(f24, "forwarding_rate")?.extracted_at === "2026-09-03"
      && by(f24, "mac_table")?.value === 32000 && by(f24, "mac_table")?.raw === "32,000" && typeof by(f24, "mac_table")?.norm_v === "string", f24);
  check("… and every fact carries the document's FETCH STAMP as its revision label, so a later fetch of the same datasheet resolves as a revision change instead of a two-source disagreement",
    f24.filter((r) => r.run_id === run.id).length === 3 && f24.filter((r) => r.run_id === run.id).every((r) => { const rev = unpackLocator(r.locator).revision_label; return typeof rev === "string" && rev.length > 0 && !Number.isNaN(Date.parse(rev)); }), f24.map((r) => r.locator));
  sabotages++;
  check("SABOTAGE NZT-9300-24P: the tier-0 switching_capacity (999) is PROTECTED — untouched, still verified, no new row",
    by(f24, "switching_capacity")?.value === 999 && by(f24, "switching_capacity")?.tier === 0 && by(f24, "switching_capacity")?.state === "verified"
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE part_id = $1 AND field_key = 'switching_capacity'", [p24])).rows[0].n === 1, by(f24, "switching_capacity"));
  const prot = (await query<{ reason: string; kept: unknown; rejected: unknown; resolved_at: Date | null }>("SELECT reason, kept, rejected, resolved_at FROM conflicts WHERE part_id = $1 AND field_key = 'switching_capacity'", [p24])).rows;
  check("… and the disagreement is on record: a conflicts row naming the tier-0 protection, kept 999, rejected 208, open",
    prot.length === 1 && /tier 0/.test(prot[0].reason) && prot[0].kept === 999 && prot[0].rejected === 208 && prot[0].resolved_at === null, prot);
  check("NZT-9300-24P: ieee_standards is INHERITED (flagged, with its family), tier 2, from the datasheet",
    by(f24, "ieee_standards")?.inherited === true && by(f24, "ieee_standards")?.inherited_from === "nztest-9300-series-switches" && eq(by(f24, "ieee_standards")?.value, ["IEEE 802.1Q", "IEEE 802.3ad"]) && by(f24, "ieee_standards")?.doc_id === D1, by(f24, "ieee_standards"));
  check("NZT-9300-24P: the unmapped label and the sentinel wrote nothing (4 current facts)", f24.length === 4, f24.map((r) => r.field_key));

  const f48 = await factsOf(p48);
  check("NZT-9300-48P: switching_capacity inserted; temp_operating inherited from the scope that named it; ieee_standards inherited",
    by(f48, "switching_capacity")?.value === 256 && by(f48, "temp_operating")?.inherited === true && by(f48, "temp_operating")?.inherited_from === "NZT-9300-48P"
      && eq(by(f48, "temp_operating")?.value, { min: -5, max: 50 }) && unpackLocator(by(f48, "temp_operating")?.locator ?? null).locator === "t1:r3:c2" && by(f48, "ieee_standards")?.inherited === true, f48);
  sabotages++;
  check("SABOTAGE NZT-9300-48P: the same-tier disagreement on forwarding_rate (100 from another document vs 190.47) is HELD — state conflict, value unchanged",
    by(f48, "forwarding_rate")?.state === "conflict" && by(f48, "forwarding_rate")?.value === 100
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'forwarding_rate' AND resolved_at IS NULL AND reason LIKE '%same-tier%'", [p48])).rows[0].n === 1, by(f48, "forwarding_rate"));
  check("NZT-9300-48P: the refused mac_table ('lots') and the class-B dimensions were never written", !by(f48, "mac_table") && !by(f48, "dimensions") && f48.length === 4, f48.map((r) => r.field_key));
  sabotages++;
  check("SABOTAGE NZT-9300-NOTLISTED (same family, not listed by the document) has NO fact", (await factsOf(pNot)).length === 0);
  const fc = await factsOf(pC240);
  check("NZT-UCS-C240: the PDF temperature lands tier 1 / pdf_table, normalised as a SERVER (°C range), with its PDF locator; the document-scoped temperature copy did not",
    fc.length === 2 && fc[0].field_key === "temp_operating" && fc[0].tier === 1 && fc[0].method === "pdf_table" && fc[0].doc_id === D2 && unpackLocator(fc[0].locator).locator === "p2:t0:r1:c2" && fc[0].inherited === false && fc[0].unit === "°C", fc);
  check("NZT-UCS-C240: the per-SKU weight is written with the label-carried unit kept in `raw`, and the DOCUMENT-scoped weight (class B) was not inherited over it",
    fc[1]?.field_key === "weight" && fc[1].value === 35 && fc[1].unit === "kg" && fc[1].raw === "Weight (kg) | 35" && fc[1].inherited === false, fc[1]);
  check("nothing was written for the unknown SKU", !(await query("SELECT 1 FROM parts WHERE sku = 'NZT-UNKNOWN-1'")).rowCount);
  check("every written fact has an evidence row", (await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence WHERE run_id = $1", [run.id])).rows[0].n === 8);
}
{
  const docs = (await query<{ doc_id: string; doc_type: string; cache_path: string; vendor_id: number; tables: number; fetched_at: string }>("SELECT doc_id, doc_type, cache_path, vendor_id, tables, fetched_at::text AS fetched_at FROM source_docs WHERE doc_id IN ($1, $2) ORDER BY doc_id", [D1, D2])).rows;
  const h = docs.find((d) => d.doc_id === D1), p = docs.find((d) => d.doc_id === D2);
  check("source_docs: the HTML datasheet and the PDF spec sheet, typed, with cache path, table count and fetch day",
    h?.doc_type === "vendor_datasheet_html" && h.cache_path === `${sha1(U1)}.html` && h.tables === 3 && h.fetched_at === "2026-09-03" && h.vendor_id === cisco
      && p?.doc_type === "vendor_datasheet_pdf" && p.cache_path === `${sha1(U2)}.bin`, docs);
  const links = (await query<{ doc_id: string; part_id: number }>("SELECT doc_id, part_id FROM doc_parts ORDER BY 1, 2")).rows;
  check("doc_parts: the HTML document lists 24P and 48P (not the unknown SKU, not NOTLISTED), the PDF lists C240",
    links.length === 3 && links.filter((l) => l.doc_id === D1).map((l) => l.part_id).sort().join() === [p24, p48].sort().join() && links.some((l) => l.doc_id === D2 && l.part_id === pC240), links);
}
{
  const rp = reportPaths("nztest");
  const unm = JSON.parse(fs.readFileSync(rp.unmapped, "utf8")) as { labels: { label: string; count: number; samples: string[]; categories: string[] }[] };
  check("unmapped report: Blinkenlights with its count, sample and category", unm.labels.length === 1 && unm.labels[0].label === "Blinkenlights" && unm.labels[0].count === 1 && unm.labels[0].samples.join() === "Yes" && unm.labels[0].categories.join() === "switches", unm);
  const q = fs.readFileSync(rp.quarantine, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  check("quarantine report: one line per refused value with sku, key, reason, detail and locator", q.length === 2 && q.some((x) => x.sku === "NZT-9300-48P" && x.key === "mac_table" && x.reason === "PARSE_FAIL" && x.locator === "t0:r2:c4" && typeof x.detail === "string"), q);
  const u = fs.readFileSync(rp.unknown, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  check("unknown-SKU report: NZT-UNKNOWN-1 with the documents that name it", u.length === 1 && u[0].sku === "NZT-UNKNOWN-1" && (u[0].docs as string[]).join() === D1, u);
  const g = JSON.parse(fs.readFileSync(rp.gate, "utf8")) as { passed: boolean; misses: string[] };
  check("gate report: written with the full gate", g.passed === true && g.misses.length === 0);
}

// =====================================================================================================
// regression against the committed run, then allowed with a reason that lands in runs.notes
// =====================================================================================================
{
  const prev = await previousFactsPerDoc(db());
  check("previousFactsPerDoc reads the last succeeded apply-specs run", prev.get(D1) === 13 && prev.get(D2) === 5, [...prev]);
  sabotages++;
  const fewer = derive("regressed.json", (rs) => rs.filter((r) => r.label !== "Blinkenlights"));
  const g = await gateOf([fewer, fx("good-pdf.json")], { previous: prev });
  check("SABOTAGE gate: the HTML document with one fact fewer than the committed run -> REGRESSION 13 -> 12, not passed", !g.gate.passed && g.gate.regression.regressed.length === 1 && g.gate.regression.regressed[0].after === 12, g.gate.regression);
  await main([fewer, fx("good-pdf.json"), "--commit", "--golden-dir", GOLDEN, "--tag", "nztest", "--sample", "100", "--allow-regression", "parser fix dropped a bogus column"]);
  const r2 = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("--allow-regression: the run succeeds, the gate records the allowance and runs.notes carries the reason",
    r2?.id !== run.id && r2.status === "succeeded" && (r2.gate?.regression as { allowed: boolean }).allowed === true && /allow_regression=parser fix dropped a bogus column/.test(r2.notes ?? "") && r2.inputs.allow_regression === "parser fix dropped a bogus column", r2);
  check("re-applying the same values writes nothing new: skips, no second current row", (r2.stats as Record<string, number>).agree_same_doc >= 7 && (r2.stats as Record<string, number>).insert === 0
    && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE superseded_by IS NULL AND part_id = ANY($1::bigint[])", [[p24, p48, pC240]])).rows[0].n === 10, r2.stats);
}

// =====================================================================================================
// SABOTAGE: --commit behind a failing gate, through the real CLI
// =====================================================================================================
const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
function cli(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(tsx, [path.join("src", "pipeline", "cli.ts"), ...args], { cwd: ROOT, encoding: "utf8", env: process.env, shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
{
  sabotages++;
  const before = (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n;
  const docsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_docs")).rows[0].n;
  const r = cli(["apply-extract", fx("sabotage-recall.json"), "--commit", "--golden-dir", GOLDEN, "--tag", "nztest-sab", "--sample", "100"]);
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE --commit behind a failing gate: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-500) });
  check("SABOTAGE --commit behind a failing gate: the run is closed FAILED with gate NULL and the reason (RECALL_MISS) in its notes",
    failed?.kind === "apply-specs" && failed.status === "failed" && failed.gate === null && /gate did not pass \(fail\)/.test(failed.notes ?? "") && /RECALL_MISS/.test(failed.notes ?? ""), failed);
  check("SABOTAGE --commit behind a failing gate: NO fact and NO document was written",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === before && (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_docs")).rows[0].n === docsBefore
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE run_id = $1", [failed.id])).rows[0].n === 0);
  for (const f of Object.values(reportPaths("nztest-sab"))) fs.rmSync(f, { force: true });
}
{
  const r = cli(["gate-extract", fx("good-html.json"), fx("good-pdf.json"), "--golden-dir", GOLDEN, "--tag", "nztest", "--sample", "100"]);
  check("ingest gate-extract on the good fixtures exits 0 and prints PASS", r.status === 0 && /gate: PASS/.test(r.out), { status: r.status, tail: r.out.slice(-400) });
  sabotages++;
  const bad = cli(["gate-extract", fx("sabotage-locator.json"), "--golden-dir", GOLDEN, "--tag", "nztest", "--sample", "100"]);
  check("SABOTAGE ingest gate-extract on the locator sabotage exits 1 and names LOCATOR_MISMATCH", bad.status === 1 && /LOCATOR_MISMATCH/.test(bad.out), { status: bad.status, tail: bad.out.slice(-400) });
}
// =====================================================================================================
// SABOTAGE: the nine findings of the 4 Sep 2026 adversarial review. Every case here FAILS on the
// behaviour that shipped before it — that is the only reason a case is here.
// =====================================================================================================
const extraTags: string[] = [];
{
  // ---- 1. write-order resolution INSIDE one file ---------------------------------------------------
  // The old addIncoming kept the first entry per (part, field) and threw the second away behind a
  // counter: 16,081 DIFFERING values discarded in one real shard, with no record of what was lost.
  const collide = derive("collisions.json", (rs) => [
    ...rs,
    { sku: "NZT-9300-48P", label: "Switching capacity", value: "512 Gbps", shape: "A", locator: "t3:r1:c1", source_url: U1 },
    { sku: "NZT-9300-24P", label: "Forwarding rate", value: "154.76 Mpps", shape: "A", locator: "t3:r2:c2", source_url: U1 },
    { ...(rs.find((r) => r.label === "MAC address table" && r.sku === "NZT-9300-24P") as Record<string, unknown>) },
  ]);
  const cp = await planExtract([loadExtractFile(collide)], { vendor: "cisco", db: db() });
  const cs = cp.stats;
  const e48 = (cp.incoming.get(p48) ?? []).filter((e) => e.k === "switching_capacity");
  const e24 = (cp.incoming.get(p24) ?? []).filter((e) => e.k === "forwarding_rate");
  sabotages++;
  check("SABOTAGE collision: a SECOND, DIFFERING value for the same (part, field) is kept and handed to the merge, never dropped by write order",
    e48.length === 2 && e48[0].value === 256 && e48[1].value === 512 && e48[0].prov.locator === "t0:r2:c1" && e48[1].prov.locator === "t3:r1:c1", e48);
  check("collision: an AGREEING value from another cell is corroboration evidence, also kept",
    e24.length === 2 && e24[0].value === 154.76 && e24[1].value === 154.76 && e24[0].prov.locator !== e24[1].prov.locator, e24);
  check("collision: only an EXACT repeat of one cell (same value, same document, same locator) is dropped — one fact read twice is not a second source",
    cs.duplicate_field === 3 && cs.collision_differing === 1 && cs.collision_same_value === 2 && cs.collision_exact_repeat === 1
      && (cp.incoming.get(p24) ?? []).filter((e) => e.k === "mac_table").length === 1, cs);
  const diff = cp.collisions.find((c) => !c.same_value);
  check("collision report: every collision is written with BOTH locators and both values",
    cp.collisions.length === 3 && diff?.sku === "NZT-9300-48P" && diff.key === "switching_capacity" && diff.kept.value === 256 && diff.incoming.value === 512
      && diff.kept.locator === "t0:r2:c1" && diff.incoming.locator === "t3:r1:c1" && diff.dropped === false, cp.collisions);
  check("collision: the gate still grades the FIRST value produced for the field (one produced fact per (sku, field))",
    cp.produced.get("NZT-9300-48P")?.get("switching_capacity")?.value === 256);

  // …and what the merge then does with the pair: a held conflict carrying both provenances.
  const pCol = await part("NZT-9300-24T", switches, "NZTEST 9300");
  const openRunId = (await query<{ id: number }>("INSERT INTO runs (kind, status, inputs) VALUES ('apply-specs', 'running', '{}'::jsonb) RETURNING id")).rows[0].id;
  const actions: string[] = [];
  await withTx(async (client) => { for (const e of e48) actions.push((await applyMerge(client, pCol, e, openRunId)).action); });
  const colFact = (await query<{ value: unknown; state: string }>("SELECT value, state::text AS state FROM facts WHERE part_id = $1 AND field_key = 'switching_capacity' AND superseded_by IS NULL", [pCol])).rows[0];
  const colConf = (await query<{ kept: unknown; rejected: unknown; reason: string; kept_evidence: { locator?: string }; rejected_evidence: { locator?: string } }>(
    "SELECT kept, rejected, reason, kept_evidence, rejected_evidence FROM conflicts WHERE part_id = $1", [pCol])).rows;
  sabotages++;
  check("SABOTAGE collision through the merge: insert then CONFLICT — the field is held at the first value and the disagreement is on record with both locators",
    actions.join() === "insert,conflict" && colFact?.state === "conflict" && colFact.value === 256
      && colConf.length === 1 && colConf[0].kept === 256 && colConf[0].rejected === 512
      && colConf[0].kept_evidence.locator === "t0:r2:c1" && colConf[0].rejected_evidence.locator === "t3:r1:c1", { actions, colFact, colConf });

  // ---- 4b. THE LIST RULE: fragments of one list are not a disagreement -----------------------------
  // Shard 0 held 20,716 collisions, 14,433 of them differing — and 9,420 of those were three LIST
  // fields (ieee_standards, supported_protocols, certifications) whose datasheet states the list in
  // more than one cell. "Protocols" and "Encapsulations" both map to supported_protocols and neither
  // contradicts the other. Within one document at one tier they are UNIONED; across documents, and
  // for every scalar, the held conflict stands.
  {
    const lists = derive("list-union.json", (rs) => [
      ...rs,
      { sku: "NZT-9300-24P", label: "IEEE standards", value: "IEEE 802.1Q, IEEE 802.3ad", shape: "B", locator: "t4:r1:c1", source_url: U1 },
      { sku: "NZT-9300-24P", label: "IEEE standards", value: "IEEE 802.1w, IEEE 802.1Q", shape: "B", locator: "t4:r2:c1", source_url: U1 },
      // a SECOND document offering a different list: not this rule's business — still a conflict
      { sku: "NZT-9300-48P", label: "IEEE standards", value: "IEEE 802.1Q", shape: "B", locator: "t0:r1:c1", source_url: U1B },
      { sku: "NZT-9300-48P", label: "IEEE standards", value: "IEEE 802.3af", shape: "B", locator: "t0:r2:c1", source_url: U1 },
      { __doc__: true, source_url: U1B, pid_list: ["NZT-9300-48P"], tables: 1, defects: [] },
    ]);
    const lp = await planExtract([loadExtractFile(lists)], { vendor: "cisco", db: db() });
    const l24 = (lp.incoming.get(p24) ?? []).filter((e) => e.k === "ieee_standards");
    const l48 = (lp.incoming.get(p48) ?? []).filter((e) => e.k === "ieee_standards");
    const union = lp.collisions.find((c) => c.sku === "NZT-9300-24P" && c.key === "ieee_standards");
    check("list rule: `ls` is in LIST_FIELDS and unionListValues is order-preserving and case-insensitive",
      LIST_FIELDS.has("ieee_standards") && !LIST_FIELDS.has("switching_capacity")
        && JSON.stringify(unionListValues(["a", "b"], ["B", "c"])) === JSON.stringify(["a", "b", "c"]));
    check("list rule: two cells of ONE document offering one `ls` field become ONE entry holding the union, deduped",
      l24.length === 1 && JSON.stringify(l24[0].value) === JSON.stringify(["IEEE 802.1Q", "IEEE 802.3ad", "IEEE 802.1w"]), l24);
    check("list rule: the union keeps EVERY cell replayable — raw carries them all, the locator names them all",
      l24[0].raw === "IEEE 802.1Q, IEEE 802.3ad ; IEEE 802.1w, IEEE 802.1Q ; IEEE 802.1Q, IEEE 802.3ad"
        && l24[0].prov.locator === "t4:r1:c1+t4:r2:c1+t1:r1:c1", l24[0]);
    // the third cell is the fixture's own family-level "IEEE standards": a class-A list inherited
    // from the same document now JOINS the per-SKU list instead of contradicting it.
    check("list rule: an INHERITED class-A list from the same document joins the per-SKU list rather than conflicting with it",
      lp.collisions.filter((c) => c.key === "ieee_standards" && c.resolution === "list_union" && c.incoming.inherited).length === 2,
      lp.collisions.filter((c) => c.key === "ieee_standards").map((c) => [c.sku, c.resolution, c.incoming.inherited]));
    check("list rule: the collision is still REPORTED, marked list_union, and counted apart",
      union?.resolution === "list_union" && union.same_value === false && lp.stats.collision_list_union === 3, { union, n: lp.stats.collision_list_union });
    check("list rule: what the gate grades follows the union (produced value), but its raw and locator stay the FIRST cell",
      JSON.stringify(lp.produced.get("NZT-9300-24P")?.get("ieee_standards")?.value) === JSON.stringify(["IEEE 802.1Q", "IEEE 802.3ad", "IEEE 802.1w"])
        && lp.produced.get("NZT-9300-24P")?.get("ieee_standards")?.locator === "t4:r1:c1"
        && lp.produced.get("NZT-9300-24P")?.get("ieee_standards")?.raw === "IEEE 802.1Q, IEEE 802.3ad");
    sabotages++;
    check("SABOTAGE list rule: an `ls` disagreement between TWO DOCUMENTS is NOT unioned — it is still two entries for the merge to hold",
      l48.length === 2 && (l48[0].prov.doc_id !== l48[1].prov.doc_id)
        && lp.collisions.some((c) => c.sku === "NZT-9300-48P" && c.key === "ieee_standards" && c.resolution === "held"), l48);
    sabotages++;
    const sc48 = (lp.incoming.get(p48) ?? []).filter((e) => e.k === "switching_capacity");
    check("SABOTAGE list rule: a SCALAR field is never unioned — two switching capacities in one document stay two entries, held",
      sc48.length === 1 || lp.collisions.filter((c) => c.key === "switching_capacity").every((c) => c.resolution === "held"), sc48);
  }

  // ---- 4c. the extractor's own list rule, and how the gate still sees the CELLS ---------------------
  // cisco_specs_deep joins a list the document spreads over several cells of one table into ONE raw
  // fact (the C9350's two power supplies, the 2960-X's IEEE standards split across two columns) and
  // carries `fragments`: every contributing cell. A joined value is in no single cell, so grading it
  // against the cell it starts in would score correct data as a PROVENANCE_MISS — the gate is handed
  // the cells instead, and the raw-row metric counts cells, not records.
  {
    const joined = derive("list-fragments.json", (rs) => [
      ...rs,
      {
        sku: "NZT-9300-24P", label: "PSU options", value: "PWR-A; PWR-B", shape: "A", locator: "t6:r4:c1", source_url: U1,
        fragments: [{ locator: "t6:r4:c1", value: "PWR-A" }, { locator: "t6:r5:c1", value: "PWR-B" }],
      },
    ]);
    const jf = loadExtractFile(joined);
    const rec = jf.facts.find((f) => f.label === "PSU options")!;
    const expanded = expandFragments(jf.facts);
    const cells = expanded.filter((f) => f.label === "PSU options");
    check("extractor list rule: a joined fact declares every cell it was made of",
      fragmentsOf(rec)?.length === 2 && fragmentsOf({ ...rec, fragments: undefined } as RawFact) === null);
    check("extractor list rule: expandFragments hands the gate one fact PER CELL, each at its own locator with that cell's value",
      cells.length === 2 && cells[0].locator === "t6:r4:c1" && cells[0].value === "PWR-A"
        && cells[1].locator === "t6:r5:c1" && cells[1].value === "PWR-B"
        && expanded.length === jf.facts.length + 1, cells);
    const jp = await planExtract([jf], { vendor: "cisco", db: db() });
    const base = await planExtract([loadExtractFile(fx("good-html.json"))], { vendor: "cisco", db: db() });
    check("extractor list rule: facts_per_doc counts CELLS, so folding cells into facts is not a regression",
      jp.factsPerDoc[D1] === base.factsPerDoc[D1] + 2 && jp.stats.list_fragment_cells === 1,
      { after: jp.factsPerDoc[D1], before: base.factsPerDoc[D1], folded: jp.stats.list_fragment_cells });
  }

  // ---- 4d. a fact with no document is a QUARANTINE, not a crash ------------------------------------
  // Run #20 (apply-specs, shard 0, --commit) died after 28 minutes on facts_verified_needs_source:
  //   CHECK (state NOT IN ('verified','corroborated') OR tier = 0 OR doc_id IS NOT NULL)
  // The three facts it had written all carried a doc_id, because the offending statement was not an
  // INSERT: it was applyMerge's corroborate branch promoting an EXISTING row — 1,125 current rows
  // sit at tier 2 with doc_id NULL and state `unverified`, and an agreeing tier-2 extraction asks
  // for exactly that promotion. Postgres reports a CHECK failure on UPDATE with the same "new row
  // for relation" wording as an insert, which is why it read as an insert.
  {
    const pNoDoc = await part("NZT-9300-24W", switches, "NZTEST 9300");
    const noDocRun = (await query<{ id: number }>("INSERT INTO runs (kind, status, inputs) VALUES ('apply-specs', 'running', '{}'::jsonb) RETURNING id")).rows[0].id;
    const withDoc: SpecEntry = { k: "mac_table", raw: "32,000", value: 32000, unit: "Einträge", state: "verified",
      prov: { tier: 2, method: "html_table", doc_id: D1, locator: "t0:r1:c4", extracted_at: "2026-09-03", norm_v: "1.2.0" } };
    const noDoc: SpecEntry = { ...withDoc, prov: { ...withDoc.prov, doc_id: undefined } };

    sabotages++;
    await refuses("a verified tier-2 entry with NO doc_id is refused BY NAME before any SQL — the run must not die for one entry",
      () => withTx((client) => applyMerge(client, pNoDoc, noDoc, noDocRun)),
      /^FACT_NO_DOCUMENT: a verified fact at tier 2 must name the document it was read from \(facts_verified_needs_source\)/);
    check("… and the refusal wrote nothing", (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE part_id = $1", [pNoDoc])).rows[0].n === 0);
    check("noSourceProblem lets through exactly what the CHECK lets through: tier 0, and any non-rendered state",
      noSourceProblem("verified", 0, null) === null && noSourceProblem("unverified", 2, null) === null
        && noSourceProblem("gap_confirmed", 2, null) === null && noSourceProblem("corroborated", 2, "abc") === null
        && noSourceProblem("corroborated", 2, "  ") !== null && noSourceProblem("verified", 1, undefined) !== null);

    // the path that actually fired: an EXISTING source-less row that an agreeing source would promote
    await query(
      `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, doc_id, run_id)
       VALUES ($1, 'mac_table', '32000', 'Einträge', '32,000', 'unverified', 2, 'html_table', NULL, NULL)`, [pNoDoc]);
    const corr = await withTx((client) => applyMerge(client, pNoDoc, withDoc, noDocRun));
    const row = await query<{ state: string }>("SELECT state::text AS state FROM facts WHERE part_id = $1 AND superseded_by IS NULL", [pNoDoc]);
    const ev = await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence e JOIN facts f ON f.id = e.fact_id WHERE f.part_id = $1", [pNoDoc]);
    sabotages++;
    check("SABOTAGE corroborate: promoting a SOURCE-LESS tier-2 row to `corroborated` is WITHHELD with a reason, the evidence is still recorded, and the run survives — this is the statement that killed run #20",
      corr.action === "corroborate" && /^FACT_NO_DOCUMENT: a corroborated fact at tier 2/.test(String(corr.withheld))
        && row.rows[0].state === "unverified" && ev.rows[0].n === 1, { corr, state: row.rows[0]?.state, ev: ev.rows[0].n });

    // and the rollback's state recompute must not walk into the same trap
    await query("UPDATE facts SET state = 'conflict' WHERE part_id = $1 AND superseded_by IS NULL", [pNoDoc]);
    const back = await withTx((client) => rollbackRun(client, noDocRun));
    const after = await query<{ state: string }>("SELECT state::text AS state FROM facts WHERE part_id = $1 AND superseded_by IS NULL", [pNoDoc]);
    sabotages++;
    check("SABOTAGE rollback: recomputing the state of a SOURCE-LESS row gives `unverified`, never `verified` — the same CHECK fires on UPDATE, and a rollback that trips it reports ROLLBACK_FAILED for an innocent run",
      after.rows[0].state === "unverified" && back.states_recomputed === 1, { after: after.rows[0]?.state, back });
    await query("UPDATE runs SET status = 'aborted', finished_at = now() WHERE id = $1", [noDocRun]);
    await query("DELETE FROM facts WHERE part_id = $1", [pNoDoc]);
  }

  // ---- 5. revision change was dead code ------------------------------------------------------------
  // provFor never set revision_label, so re-applying an edited datasheet (same doc, same tier, a new
  // value) came back as "same-tier sources disagree" — one document blamed as two.
  const rev2 = deriveFrom("good-html.json", "revision-2.json", (rs) => rs.map((r) =>
    r.__doc__ ? { ...r, fetched_at: "2026-09-20" }
      : r.sku === "NZT-9300-48P" && r.label === "Switching capacity" ? { ...r, value: "300 Gbps" } : r));
  const rp = await planExtract([loadExtractFile(rev2)], { vendor: "cisco", db: db() });
  check("revision: the document's own fetched_at becomes both its fetch day and its revision label",
    rp.docs[0].fetched_at === "2026-09-20" && rp.docs[0].revision_label === "2026-09-20", rp.docs[0]);
  const pRev = await part("NZT-9300-24U", switches, "NZTEST 9300");
  const before256 = (cp.incoming.get(p48) ?? []).find((e) => e.k === "switching_capacity")!;
  const after300 = (rp.incoming.get(p48) ?? []).find((e) => e.k === "switching_capacity")!;
  const revActions: string[] = [];
  await withTx(async (client) => {
    revActions.push((await applyMerge(client, pRev, before256, openRunId)).action);
    revActions.push((await applyMerge(client, pRev, after300, openRunId)).action);
  });
  const revNow = (await query<{ value: unknown; state: string }>("SELECT value, state::text AS state FROM facts WHERE part_id = $1 AND superseded_by IS NULL", [pRev])).rows[0];
  const revOld = (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE part_id = $1 AND superseded_by IS NOT NULL", [pRev])).rows[0].n;
  const revConf = (await query<{ reason: string; resolution: string | null }>("SELECT reason, resolution FROM conflicts WHERE part_id = $1", [pRev])).rows;
  sabotages++;
  check("SABOTAGE revision: the SAME document re-fetched with a new value is a REVISION_CHANGE, not a two-source conflict — the new value wins, the old is superseded, the change is logged resolved",
    revActions.join() === "insert,revision_change" && revNow?.value === 300 && revNow.state === "verified" && revOld === 1
      && revConf.length === 1 && /^REVISION_CHANGE .* -> 2026-09-20$/.test(revConf[0].reason) && revConf[0].resolution === "revision_change", { revActions, revNow, revOld, revConf });

  // ---- 7. the class-C exception must follow the DOCUMENT, not the kept value -----------------------
  const cRej = deriveFrom("good-pdf.json", "class-c-rejected.json", (rs) => rs.map((r) =>
    r.sku === "NZT-UCS-C240" && r.label === "Operating temperature" ? { ...r, value: "see note 3" } : r));
  const cpl = await planExtract([loadExtractFile(cRej)], { vendor: "cisco", db: db() });
  sabotages++;
  check("SABOTAGE class C: the document STATES a per-SKU operating temperature and the normaliser REFUSED it — the family value must still not be inherited over it (a refused value is a gap to fix, not permission to guess)",
    cpl.stats.inherit_class_c_exception === 1 && cpl.stats.inherit_ok === 0
      && !(cpl.incoming.get(pC240) ?? []).some((e) => e.k === "temp_operating")
      && (cpl.incoming.get(pC240) ?? []).some((e) => e.k === "weight"), { stats: cpl.stats, entries: cpl.incoming.get(pC240) });

  // ---- 6. one "sentinel" number for five different meanings ----------------------------------------
  const sent = derive("sentinels.json", (rs) => [
    ...rs,
    { sku: "NZT-9300-24P", label: "Total switched virtual interfaces", value: "1000", shape: "A", locator: "t9:r1:c1", source_url: U1 },
    { sku: "NZT-9300-24P", label: "Product Description", value: "NZTEST 9300 switch", shape: "A", locator: "t9:r1:c2", source_url: U1 },
  ]);
  const sp = await planExtract([loadExtractFile(sent)], { vendor: "cisco", db: db() });
  sabotages++;
  check("SABOTAGE sentinels: counted APART — a section heading, a __backlog spec with no field key and __not_a_spec ordering noise are three different findings, not one number",
    sp.stats.sentinel === 3 && sp.stats.sentinel_section_heading === 1 && sp.stats.sentinel_backlog === 1 && sp.stats.sentinel_not_a_spec === 1, sp.stats);
  extraTags.push("nztest-sent");
  writeReports(sp, "nztest-sent");
  const sentReport = JSON.parse(fs.readFileSync(reportPaths("nztest-sent").unmapped, "utf8")) as { backlog: { label: string; count: number; samples: string[] }[] };
  check("… and every __backlog label is LISTED in the unmapped report: a named gap somebody can add to the dictionary",
    sentReport.backlog.length === 1 && sentReport.backlog[0].label === "Total switched virtual interfaces" && sentReport.backlog[0].samples.join() === "1000", sentReport.backlog);

  // ---- 2. the sample -------------------------------------------------------------------------------
  await refuses("parseArgs: --sample 0 (a sample of nothing that still prints a provenance line)", () => parseArgs(["a.json", "--sample", "0"]), /--sample must be a positive number/);
  // a seeded PRNG so the assertion is about the ALGORITHM, not about luck
  const seeded = (s: number) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bigPool: RawFact[] = [];
  for (let d = 0; d < 20; d++) for (let i = 0; i < 50; i++) bigPool.push({ label: `L${i}`, value: `V${d}-${i}`, shape: "A", locator: `t0:r${i}:c1`, source_url: `https://nztest.invalid/doc-${d}` });
  const picked = planSample(bigPool, 200, seeded(7));
  const decile = new Array(10).fill(0) as number[];
  for (const i of picked) decile[Math.min(9, Math.floor(i / 100))]++;
  const perDoc = new Map<string, number>();
  for (const i of picked) perDoc.set(bigPool[i].source_url, (perDoc.get(bigPool[i].source_url) ?? 0) + 1);
  sabotages++;
  check("SABOTAGE sample: Fisher-Yates over indices, spread across documents — 200 of 1,000 facts in 20 documents reach EVERY document and every decile of the file (sort(() => 0.5 - rnd()) left the last decile 22x under-sampled, so the tail of every file went unaudited)",
    picked.length === 200 && new Set(picked).size === 200 && perDoc.size === 20 && Math.min(...decile) >= 10 && Math.max(...decile) <= 30, { decile, docs: perDoc.size, min: Math.min(...decile), max: Math.max(...decile) });
  const one = planSample(bigPool, 20, seeded(11));
  check("sample: every document is reached before any document is sampled twice", new Set(one.map((i) => bigPool[i].source_url)).size === 20, one.length);
  // and the GATE must use it: the same 20-document pool through gateExtract itself, so a call site
  // that reaches for a flat shuffle again fails here and not only in the unit above
  const wide = gateExtract({
    produced: new Map(), facts: bigPool, factsPerDoc: {}, previous: new Map(), golden: [], sample: 200,
    docs: [...new Set(bigPool.map((f) => f.source_url))].map((url) => ({ doc_id: url.slice(-5), url, pid_list: [] })),
    random: seeded(5), cacheDir: tmp,
  });
  sabotages++;
  check("SABOTAGE sample: the GATE's own sample of 200 reaches all 20 documents (a flat shuffle of the concatenated file reaches the first few and calls it a sample)",
    wide.gate.coverage.docs_sampled === 20 && wide.gate.coverage.docs_in_file === 20 && wide.gate.coverage.facts_sampled === 200 && wide.gate.coverage.ok === true, wide.gate.coverage);
  check("fisherYates is a permutation, not a re-ordering of the same list", (() => {
    const p = fisherYates([...Array(50).keys()], seeded(3));
    return p.length === 50 && new Set(p).size === 50 && p.some((v, i) => v !== i);
  })());
  const thin = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { sample: 3 });
  sabotages++;
  check("SABOTAGE coverage: a sample too small to measure is UNVERIFIED, never a pass — the gate says how many documents and facts it actually looked at",
    !thin.gate.passed && thin.gate.verdict === "unverified" && thin.gate.coverage.ok === false && thin.gate.coverage.facts_sampled === 3 && thin.gate.coverage.min_facts === 18
      && /^UNVERIFIED: the provenance sample covers 2 of 2 documents \(minimum 1\) and 3 of 18 facts \(minimum 18\)/.test(thin.misses[0] ?? ""), { coverage: thin.gate.coverage, first: thin.misses[0] });

  // ---- 3. the regression metric --------------------------------------------------------------------
  const gp = await gateOf([fx("good-html.json"), fx("good-pdf.json")], { previousProduced: new Map([[D1, 9]]) });
  sabotages++;
  check("SABOTAGE regression: the RAW fact count is unchanged and the document still produces one fact fewer — a mapping regression the old metric could not see",
    !gp.gate.passed && gp.gate.regression.regressed.some((x) => x.doc_id === D1 && x.metric === "produced" && x.before === 9 && x.after === 8)
      && gp.misses.some((x) => x.startsWith(`REGRESSION doc=${D1}: 9 produced facts in the previous run, 8 now`)), gp.gate.regression);
  // Absence is judged against the SAME logical input only (absentScope = the last succeeded run
  // with this tag). Shard 1 was refused on 4 Sep 2026 because shard 0's documents were "absent".
  const ga = await gateOf([fx("good-html.json")], { previous: new Map([[D2, 5]]), absentScope: new Set([D2]) });
  sabotages++;
  check("SABOTAGE regression: a document the previous SAME-TAG run read and this file does not mention AT ALL is a regression, not an absence nothing compares",
    !ga.gate.passed && ga.gate.regression.regressed.some((x) => x.doc_id === D2 && x.metric === "absent" && x.before === 5 && x.after === 0)
      && ga.misses.some((x) => /the document is not in this file at all/.test(x)), ga.gate.regression);
  const gb = await gateOf([fx("good-html.json")], { previous: new Map([[D2, 5]]) });
  sabotages++;
  check("SABOTAGE regression: the same absence with NO same-tag scope (another shard's document) is not a regression",
    !gb.gate.regression.regressed.some((x) => x.doc_id === D2 && x.metric === "absent")
      && !gb.misses.some((x) => /the document is not in this file at all/.test(x)), gb.gate.regression);

  // ---- 9. an unparseable locator, and the extractor's own defects ----------------------------------
  const badLoc = derive("bad-locator.json", (rs) => rs.map((r) => (r.label === "Blinkenlights" ? { ...r, locator: "description:pattern-7" } : r)));
  const bl = await gateOf([badLoc], { sample: 100 });
  sabotages++;
  check("SABOTAGE locator: a locator that does not name a cell is a PROVENANCE MISS — it used to count as CLEAN, so every unparseable locator in the sample was scored as a pass",
    !bl.gate.passed && bl.gate.provenance.mismatched === 1
      && bl.misses.some((x) => /^PROVENANCE_MISS NZT-9300-24P "Blinkenlights" = "Yes": locator "description:pattern-7" does not name a cell/.test(x)), { prov: bl.gate.provenance, m: bl.misses });
  const defective = derive("defects.json", (rs) => rs.map((r) => (r.__doc__
    ? { ...r, defects: [{ code: "GRID_MISALIGNED", locator: "t2:r0", detail: "header row starts with a PID; header likely shifted" } as Defect] } : r)));
  const dg = await gateOf([defective], { sample: 1 });
  sabotages++;
  check("SABOTAGE defects: what the extractor itself flagged is counted by code, and the ONE fact in the misaligned table is what the sample of one looks at first (uniformly it would be picked one time in thirteen)",
    dg.gate.defects.total === 1 && dg.gate.defects.by_code.GRID_MISALIGNED === 1 && dg.gate.defects.facts_affected === 1 && dg.gate.defects.sampled === 1
      && dg.gate.verdict === "unverified", dg.gate.defects);

  // ---- 4. a partial commit ---------------------------------------------------------------------------
  const pPartial = await part("NZT-9300-24V", switches, "NZTEST 9300");
  const entry: SpecEntry = { k: "mac_table", raw: "16,000", value: 16000, unit: "Einträge", state: "verified",
    prov: { tier: 2, method: "html_table", doc_id: D1, locator: "t0:r9:c4", extracted_at: "2026-09-03", norm_v: "1.2.0" } };
  await refuses("withRun: a throw part-way through still fails the run", async () => {
    await withRun("apply-specs", { fixture: "partial" }, async (id) => {
      await withTx(async (client) => { await applyMerge(client, pPartial, entry, id); });
      throw new Error("simulated crash after 1 of 2 parts");
    }, { partial: () => ({ stats: { parts_touched: 1, insert: 1, partial: true }, progress: "1/2 parts merged, last NZT-9300-24V" }) });
  }, /simulated crash after 1 of 2 parts/);
  const failedRun = (await query<{ id: number; status: string; stats: Record<string, unknown>; notes: string }>(
    "SELECT id, status, stats, notes FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  sabotages++;
  check("SABOTAGE partial commit: the failed run carries the PARTIAL stats and a progress line naming how far it got — it used to close with stats {} and one error line, so nothing said which facts it had already written",
    failedRun.status === "failed" && failedRun.stats.parts_touched === 1 && failedRun.stats.partial === true
      && /progress=1\/2 parts merged, last NZT-9300-24V; simulated crash/.test(failedRun.notes), failedRun);
  const written = (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts f WHERE f.part_id = $1 AND f.superseded_by IS NULL", [pPartial])).rows[0].n;
  const readable = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM facts f WHERE f.part_id = $1 AND f.superseded_by IS NULL AND ${factRunSucceeded("f")}`, [pPartial])).rows[0].n;
  const evLeft = (await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence WHERE run_id = $1", [failedRun.id])).rows[0].n;
  sabotages++;
  // Until 4 Sep 2026 this case asserted the opposite: the fact stayed in the table and only the two
  // readers carrying factRunSucceeded() hid it, so a failed run could still move /stats, /facets,
  // /gaps and /export — and run #15's rows had to be deleted by hand. withRun now rolls the run back.
  check("SABOTAGE partial commit: a failed run leaves NOTHING behind — its committed facts and evidence are rolled back, and the rollback is on the run row",
    written === 0 && readable === 0 && evLeft === 0
      && (failedRun.stats.rolled_back as { facts_removed: number })?.facts_removed === 1
      && /^rolled_back=1 facts/.test(failedRun.notes), { written, readable, evLeft, notes: failedRun.notes });
  sabotages++;
  const orphan = (await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM facts f JOIN runs r ON r.id = f.run_id WHERE f.superseded_by IS NULL AND r.status = 'failed'`)).rows[0].n;
  check("SABOTAGE INVARIANT: no current fact in the whole database belongs to a FAILED run (a `running` one is still in flight)",
    orphan === 0, orphan);
  const seedReadable = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM facts f WHERE f.part_id = $1 AND f.superseded_by IS NULL AND ${factRunSucceeded("f")}`, [p24])).rows[0].n;
  check("… and the rule does not hide anything else: the committed run's facts and the run-less tier-0 seed are still readable", seedReadable === 4, seedReadable);
  await query("UPDATE runs SET status = 'aborted', finished_at = now() WHERE id = $1", [openRunId]);
}

check("no sabotage run was ever recorded as succeeded", (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE kind = 'apply-specs' AND status = 'succeeded'")).rows[0].n === 2);

// ---- (A) COMMA LISTS (reviewer, 6 Oct 2026 ~17:20: "(A) approved — the mapper is the only place that knows what a key is") ----
// The extractor keeps a comma-delimited cell WHOLE and hands over the head a scalar would have kept (comma_list / scalar_head).
// Through the real plan: a LIST key reads the whole cell; a SCALAR key reads the head, flagged truncated and counted; a record
// without comma_list (every extract written before (A)) is mapped exactly as given. Sabotage, run by hand on 6 Oct 2026: with
// mapCapped's scalar branch removed, the scalar case went red and the list and control cases stayed green.
{
  const routers = await cat("routers");
  await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
    ('supported_protocols', 'ls', NULL, 'Supported protocols', 'Unterstützte Protokolle'), ('timing_sync', 's', NULL, 'Timing', 'Taktung')
    ON CONFLICT (key) DO NOTHING`);
  const UCL = "https://www.cisco.com/c/en/us/products/collateral/routers/nztest-comma/nztest-comma-router-ds.html";
  const pCL = await part("NZT-CL-ROUTER-A", routers, "NZTEST CL");
  const pPRE = await part("NZT-CL-ROUTER-B", routers, "NZTEST CL");
  const PROTO = "IPv4, IPv6, static routes, Open Shortest Path First (OSPF), Enhanced IGRP (EIGRP), Border Gateway Protocol (BGP), "
    + "BGP Router Reflector, RSVP, CDP, ERSPAN, IPSLA, EEM, IKE, ACL, EVC, DHCP, DNS, LISP, HSRP, RADIUS, AAA, AVC, MPLS, "
    + "Bidirectional Forwarding Detection (BFD)";
  const TIMING = "Enhanced Synchronous Ethernet (eSyncE), Enhanced Ethernet Synchronization Message Channel (eESMC), Internal PRTC-B "
    + "GNSS receiver, IEEE 1588-2008 PTP T-GM, T-BC, T-TSC, A-PTS, G.8275.1, G.8275.2";
  const headOf = (v: string) => v.slice(0, v.lastIndexOf(" ", 160));
  const clFile = path.join(tmp, "comma-lists.json");
  fs.writeFileSync(clFile, JSON.stringify({ source: "cisco-specs-deep", generated_at: "2026-10-06T00:00:00Z", records: [
    { __doc__: true, source_url: UCL, pid_list: ["NZT-CL-ROUTER-A", "NZT-CL-ROUTER-B"], tables: 1, defects: [] },
    { sku: "NZT-CL-ROUTER-A", label: "Protocols", value: PROTO, shape: "A", locator: "t0:r1:c1", source_url: UCL, truncated: false, comma_list: true, scalar_head: headOf(PROTO) },
    { sku: "NZT-CL-ROUTER-A", label: "Timing", value: TIMING, shape: "A", locator: "t0:r2:c1", source_url: UCL, truncated: false, comma_list: true, scalar_head: headOf(TIMING) },
    { sku: "NZT-CL-ROUTER-B", label: "Timing", value: headOf(TIMING), shape: "A", locator: "t0:r2:c2", source_url: UCL, truncated: true },
  ] }, null, 1));
  const cp = await planExtract([loadExtractFile(clFile)], { vendor: "cisco", db: db() });
  const incA = cp.incoming.get(pCL) ?? [], incB = cp.incoming.get(pPRE) ?? [];
  const proto = incA.find((e) => e.k === "supported_protocols"), timing = incA.find((e) => e.k === "timing_sync"), pre = incB.find((e) => e.k === "timing_sync");
  check("(A) a comma cell under a LIST key is read WHOLE: its last member (past character 160) is in the list, and it is not flagged truncated",
    Array.isArray(proto?.value) && (proto!.value as string[]).includes("Bidirectional Forwarding Detection (BFD)") && proto?.truncated !== true,
    { value: proto?.value, truncated: proto?.truncated });
  sabotages++;
  check("(A) the same kind of cell under a SCALAR key is read from its 160-character HEAD, flagged truncated, and counted -- never the 6,000",
    timing?.raw === headOf(TIMING) && timing?.truncated === true && (cp.stats as Record<string, number>).comma_list_scalar_capped === 1,
    { raw: timing?.raw, truncated: timing?.truncated, capped: (cp.stats as Record<string, number>).comma_list_scalar_capped });
  check("(A) CONTROL a record without comma_list (every extract before (A)) is mapped as given, its adapter cut carried as truncated",
    pre?.raw === headOf(TIMING) && pre?.truncated === true, { raw: pre?.raw, truncated: pre?.truncated });
}

// ---- CONDITION A (reviewer verdict on 678606c, §3.3; 12 Sep 2026) ----------------------------------------
// A value the domain cannot express is REFUSED — ENUM_VIOLATION, one quarantine line per value naming key,
// document and locator — and NOTHING is written for it: above all nothing FOLDED to the nearest value the
// domain does hold. "SFP-DD stored as sfp" was a silent fold, and a fold passes every other check: the stored
// value is in the domain, in band, and its cell is on the page. Proven through the real pipeline (plan AND a
// committed run behind a passing gate), not through one normaliser call. The control row maps the same three
// labels to in-domain values, so a refusal here is about the VALUE, never an unmapped label.
// Sabotage, run by hand on 12 Sep 2026: with the enum branch of normalizeField made to accept any value, the
// quarantine cases and the no-write cases went red.
{
  const transceiver = await cat("transceiver");
  await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
    ('form_factor', 'e', NULL, 'Form factor', 'Formfaktor'), ('connector', 'e', NULL, 'Connector', 'Anschluss'), ('media', 'e', NULL, 'Media', 'Medium')
    ON CONFLICT (key) DO NOTHING`);
  const pXD = await part("NZT-OSFP-XD-A", transceiver, "NZTEST 800G");
  const pQDD = await part("NZT-QDD-400G-B", transceiver, "NZTEST 800G");
  const rec = (sku: string, label: string, value: string, locator: string) => ({ sku, label, value, shape: "A", locator, source_url: U3 });
  const condA = path.join(tmp, "condition-a.json");
  fs.writeFileSync(condA, JSON.stringify({ source: "cisco-specs-deep", generated_at: "2026-09-12T00:00:00Z", records: [
    { __doc__: true, source_url: U3, pid_list: ["NZT-OSFP-XD-A", "NZT-QDD-400G-B"], tables: 1, defects: [] },
    rec("NZT-OSFP-XD-A", "Form factor", "OSFP-XD", "t0:r1:c1"), rec("NZT-OSFP-XD-A", "Connector type", "SN", "t0:r1:c2"), rec("NZT-OSFP-XD-A", "Cable type", "AEC", "t0:r1:c3"),
    rec("NZT-QDD-400G-B", "Form factor", "QSFP-DD", "t0:r2:c1"), rec("NZT-QDD-400G-B", "Connector type", "LC", "t0:r2:c2"), rec("NZT-QDD-400G-B", "Cable type", "SMF", "t0:r2:c3"),
  ] }, null, 1));
  const D3 = docIdFor(U3);
  const KEYS = ["form_factor", "connector", "media"];

  const ap = await planExtract([loadExtractFile(condA)], { vendor: "cisco", db: db() });
  const qa = ap.quarantine.filter((q) => q.sku === "NZT-OSFP-XD-A");
  sabotages++;
  check("CONDITION A plan: OSFP-XD, SN and AEC are each ONE quarantine line with key, ENUM_VIOLATION, document and locator",
    qa.length === 3 && KEYS.every((k) => qa.filter((q) => q.key === k).length === 1)
      && qa.every((q) => q.reason === "ENUM_VIOLATION" && q.doc_id === D3 && /^t0:r1:c[123]$/.test(String(q.locator))), ap.quarantine);
  const xdIncoming = (ap.incoming.get(pXD) ?? []).filter((e) => KEYS.includes(e.k));
  sabotages++;
  check("CONDITION A plan: NOTHING is offered for the refused part under any of the three keys — no fold to osfp, lc-duplex, dac-copper or any neighbour",
    xdIncoming.length === 0, xdIncoming.map((e) => `${e.k}=${JSON.stringify(e.value)}`));
  const qddIncoming = new Map((ap.incoming.get(pQDD) ?? []).map((e) => [e.k, e.value]));
  check("CONDITION A control: the same three labels map for the in-domain row (qsfp-dd, lc-duplex, smf), so the refusals are about the values",
    qddIncoming.get("form_factor") === "qsfp-dd" && qddIncoming.get("connector") === "lc-duplex" && qddIncoming.get("media") === "smf", [...qddIncoming]);

  // The committed run, behind a gate that passes on the control row's golden expectations.
  const goldA = fs.mkdtempSync(path.join(os.tmpdir(), "nz-golden-a-")); tmpDirs.push(goldA);
  fs.writeFileSync(path.join(goldA, "condition-a.golden.json"), JSON.stringify({ expectations: [
    { sku: "NZT-QDD-400G-B", field: "form_factor", raw: "QSFP-DD", value: "qsfp-dd", unit: null },
    { sku: "NZT-QDD-400G-B", field: "connector", raw: "LC", value: "lc-duplex", unit: null },
    { sku: "NZT-QDD-400G-B", field: "media", raw: "SMF", value: "smf", unit: null },
  ] }));
  extraTags.push("nztest-conda");
  await main([condA, "--commit", "--golden-dir", goldA, "--tag", "nztest-conda", "--sample", "100"]);
  const runA = (await query<{ status: string }>("SELECT status FROM runs WHERE kind = 'apply-specs' ORDER BY id DESC LIMIT 1")).rows[0];
  const factsOf = async (pid: number) => (await query<{ field_key: string; value: unknown }>(
    "SELECT field_key, value FROM facts WHERE part_id = $1 AND superseded_by IS NULL AND field_key = ANY($2::text[])", [pid, KEYS])).rows;
  const xdFacts = await factsOf(pXD), qddFacts = await factsOf(pQDD);
  check("CONDITION A commit: the run succeeded behind its gate and wrote the control row's three facts", runA?.status === "succeeded" && qddFacts.length === 3, { runA, qddFacts });
  sabotages++;
  check("CONDITION A commit: NO fact exists for the refused part under form_factor, connector or media — not the raw value, not a folded neighbour",
    xdFacts.length === 0, xdFacts);
  const qlines = fs.readFileSync(reportPaths("nztest-conda").quarantine, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  sabotages++;
  check("CONDITION A report: the quarantine file carries the three lines with key, reason, document and locator",
    qlines.length === 3 && KEYS.every((k) => qlines.some((x) => x.sku === "NZT-OSFP-XD-A" && x.key === k && x.reason === "ENUM_VIOLATION" && x.doc_id === D3 && typeof x.locator === "string")), qlines);
}

// ---- cleanup ----------------------------------------------------------------------------------------------
for (const t of ["nztest", ...extraTags]) for (const f of Object.values(reportPaths(t))) fs.rmSync(f, { force: true });
cleanup();
check("the cached documents written for this suite are gone again", cacheFiles.every((f) => !fs.existsSync(f)));
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed, ${sabotages} sabotage cases`);
if (misses.length) { console.log("MISSES:\n  " + misses.join("\n  ")); process.exit(1); }
