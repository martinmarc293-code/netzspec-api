// tests/db/apply-acquired.test.ts — proof for src/pipeline/apply-acquired.ts: acquired page results
// become facts inside a GATED run, and the gate can fail.
//
//   NETZSPEC_DB=test npx tsx tests/db/apply-acquired.test.ts
//
// Fixtures live in tests/fixtures/acquired/ and are shaped exactly as scraper/worker.py writes them
// (the suite reads worker.py's write_text call and scraper/sources/__init__.py's RESULT template and
// checks the fixture keys against BOTH, so a worker that changes shape fails here, not in
// production). The cached pages the gate re-reads are written under scraper/cache/<sha1(url)>.html
// — the netzscrape._key convention — for the duration of the run and removed at the end.
//
// What one committed run must prove: a distributor (tier 4) fact lands `unverified`, a vendor
// (tier 2) fact lands `verified`; an unmapped label is counted and reported with samples; a value
// the normaliser refuses is counted and never written; an unknown SKU goes to the unknown-SKU feed
// and nothing is written for it; a scope:family entry is skipped and counted; relations with an
// invalid kind are counted, valid ones written; non-vendor images are skipped, vendor images
// written; a dated end_of_sale_date makes a lifecycle row, a block of N/A does not;
// part_source_checks records facts_found with the mapped field keys; the run row has kind
// apply-acquired and a passing gate.
//
// SABOTAGE, each through the real CLI as a child process so the exit code is the thing asserted:
//   * a source with no adapter suite (cdw: there is no tests/scraper/test_cdw.py) -> recall 0, the
//     run is closed `failed` with gate NULL and the process exits 1;
//   * a fixture whose cached page does not contain the value it claims -> precision 0, same fate.
// Plus the gate function driven directly: a page that cannot be read scores 0, not 1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { docIdFor } from "../../src/store/docs.js";
import {
  main, parseArgs, mapEntryFacts, lifecycleFromEntry, computeGate, auditProvenance, runAdapterSuites, cachedText, normSku,
  CACHE_DIR, type Acquired, type WrittenFact,
} from "../../src/pipeline/apply-acquired.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
// Same rule as src/store/db.ts: netzspec_test, netzspec_test2 … one throwaway database per
// concurrent suite. An `endsWith("_test")` copy of this guard had drifted narrower and refused
// every numbered database the runner is allowed to use (D:\Project\CLAUDE.md §10, drifting copies).
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`apply-acquired.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "acquired");

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

// ---- the cached pages the gate re-reads ---------------------------------------------------------
// One page per fixture URL. The sabotage-provenance page deliberately says 740 W where its fixture
// claims 999 W. Names follow netzscrape._key: sha1(url) + ".html".
const PAGES: Record<string, string> = {
  "https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G":
    "<html><head><title>NZTEST C9200L-24P-4G</title><script>var x = '999 W';</script></head><body><table>"
    + "<tr><td>PoE budget</td><td>370&nbsp;W</td></tr><tr><td>Total Number of Network Ports</td><td>24</td></tr>"
    + "<tr><td>Switching capacity</td><td>n/a</td></tr></table></body></html>",
  "https://documentation.meraki.com/MS/nztest/MS120-24P":
    "<html><body><h1>MS120-24P</h1><table><tr><th>Switching capacity</th><td>56 Gbps</td></tr><tr><th>Weight</th><td>4.9 kg</td></tr></table></body></html>",
  "https://www.cdw.com/search/?key=NZTEST-C9200L-48P-4G":
    "<html><body><table><tr><td>PoE budget</td><td>740 W</td></tr></table></body></html>",
  "https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-BAD-PROVENANCE":
    "<html><body><table><tr><td>PoE budget</td><td>740 W</td></tr></table></body></html>",
};
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
  fs.writeFileSync(f, html, "utf8");
  cacheFiles.push(f);
}

// ---- fixture shape vs the worker and the RESULT template -----------------------------------------
function fixtureFiles(sub: string): string[] {
  return fs.readdirSync(path.join(FIXTURES, sub)).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(FIXTURES, sub, f));
}
{
  const worker = fs.readFileSync(path.join(ROOT, "scraper", "worker.py"), "utf8").replace(/\r\n/g, "\n");
  const block = /out\.write_text\(json\.dumps\(\{([\s\S]*?)\}, ensure_ascii/.exec(worker);
  const workerKeys = block ? [...block[1].matchAll(/"([a-z_]+)":/g)].map((m) => m[1]) : [];
  const taskSrc = block ? (/k in \(([^)]*)\)/.exec(block[1])?.[1] ?? "") : "";
  const taskKeys = [...taskSrc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check("worker.py write_text block located and its keys read",
    workerKeys.length >= 8 && workerKeys.includes("cache_path") && taskKeys.join(",") === "id,task,key,part_id", { workerKeys, taskKeys });
  const init = fs.readFileSync(path.join(ROOT, "scraper", "sources", "__init__.py"), "utf8").replace(/\r\n/g, "\n");
  const resultBlock = /RESULT = \{([\s\S]*?)\n\}/.exec(init);
  const resultKeys = new Set(resultBlock ? [...resultBlock[1].matchAll(/^\s*"([a-z_]+)":/gm)].map((m) => m[1]) : []);
  resultKeys.add("scope");   // arista.py and hpe_quickspecs.py emit it on family-level entries; the pipeline honours it
  check("RESULT template located in scraper/sources/__init__.py", resultKeys.has("others") && resultKeys.has("facts") && resultKeys.size >= 10, [...resultKeys]);
  for (const sub of ["good", "sabotage-no-suite", "sabotage-provenance"]) {
    for (const f of fixtureFiles(sub)) {
      const doc = JSON.parse(fs.readFileSync(f, "utf8")) as Acquired & { _about?: string };
      const top = Object.keys(doc).filter((k) => k !== "_about").sort();
      const rel = path.relative(ROOT, f);
      check(`${rel}: top-level keys are exactly the worker's`, top.join(",") === [...workerKeys].sort().join(","), { top, workerKeys });
      check(`${rel}: task keys are exactly the worker's`, Object.keys(doc.task).sort().join(",") === [...taskKeys].sort().join(","), Object.keys(doc.task));
      const entries = [doc.result, ...(doc.result.others ?? [])];
      check(`${rel}: every result entry uses only RESULT keys`, entries.every((e) => Object.keys(e).every((k) => resultKeys.has(k))),
        entries.map((e) => Object.keys(e).filter((k) => !resultKeys.has(k))));
      check(`${rel}: cache_path is sha1(url).html (netzscrape._key)`, doc.cache_path === `${sha1(doc.url)}.html`, doc.cache_path);
      check(`${rel}: its cached page was written`, cachedText(doc.cache_path) !== null);
    }
  }
}

// ---- database fixture -----------------------------------------------------------------------------
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget'),
  ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
  ON CONFLICT (key) DO NOTHING`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
const sources = new Map((await query<{ slug: string; id: number; tier: number; kind: string }>("SELECT slug, id, tier, kind FROM sources")).rows.map((r) => [r.slug, r]));
const part = async (sku: string): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, 'hardware', 'test') RETURNING id`,
  [cisco, sku, sku.toLowerCase(), switches])).rows[0].id;
const partA = await part("C9200L-24P-4G");   // the provantage page (anchored by task.part_id)
const partB = await part("C9200L-48P-4G");   // named only by a scope:family entry (and by the sabotage fixtures)
const partM = await part("MS120-24P");       // the meraki page (found by --vendor + SKU)
check("fixture sources: provantage is a tier-4 distributor, meraki a tier-2 vendor, cdw exists and has no suite",
  sources.get("provantage")?.tier === 4 && sources.get("provantage")?.kind === "distributor"
    && sources.get("meraki")?.tier === 2 && sources.get("meraki")?.kind === "vendor"
    && sources.has("cdw") && !fs.existsSync(path.join(ROOT, "tests", "scraper", "test_cdw.py")));

// =================================================================================================
// the pure pieces
// =================================================================================================
{
  const p = parseArgs(["runs/a", "--commit", "--vendor", "cisco", "--sample", "5", "runs/b"]);
  check("parseArgs: paths, --commit, --vendor, --sample", p.paths.join(",") === "runs/a,runs/b" && p.commit && p.vendor === "cisco" && p.sample === 5, p);
  const d = parseArgs(["runs/a"]);
  check("parseArgs defaults: dry run, no vendor, sample 60", !d.commit && d.vendor === null && d.sample === 60, d);
  check("normSku folds case, whitespace, '=' and '+'", normSku("c9200l-24p-4g=") === "C9200L-24P-4G" && normSku("C9200L-24P-4G ") === normSku("c9200l-24p-4g"));
}
{
  const ctx = { category: "switches", docType: "distributor_page", docId: "d0c", pageUrl: "u", sku: "S", fetchedDay: "2026-09-03" };
  const dist = mapEntryFacts([
    { label: "PoE budget", value: "370 W", locator: "t1:r1:c2" },
    { label: "Interfaces/Ports > Total Number of Network Ports", value: "24" },
    { label: "Switching capacity", value: "n/a" },
    { label: "Power supply", value: "Power supply" },
  ], { ...ctx, src: sources.get("provantage")! });
  check("mapEntryFacts (tier 4): one mapped as UNVERIFIED with tier 4 and method distributor_page:provantage",
    dist.mapped.length === 1 && dist.mapped[0].entry.k === "poe_budget" && dist.mapped[0].entry.state === "unverified"
      && dist.mapped[0].entry.value === 370 && dist.mapped[0].entry.unit === "W" && dist.mapped[0].entry.prov.tier === 4
      && dist.mapped[0].entry.prov.method === "distributor_page:provantage" && dist.mapped[0].entry.prov.locator === "t1:r1:c2"
      && dist.mapped[0].entry.prov.doc_id === "d0c" && dist.mapped[0].label === "PoE budget", dist.mapped);
  check("mapEntryFacts: the unmapped label is returned with its value, the refused value with its reason, the heading as a sentinel",
    dist.unmapped.length === 1 && dist.unmapped[0].label === "Interfaces/Ports > Total Number of Network Ports" && dist.unmapped[0].value === "24"
      && dist.rejected.length === 1 && dist.rejected[0].key === "switching_capacity" && dist.rejected[0].reason === "PARSE_FAIL"
      && dist.sentinel === 1, dist);
  const vend = mapEntryFacts([{ label: "Switching capacity", value: "56 Gbps" }], { ...ctx, src: sources.get("meraki")!, docType: "vendor_page" });
  check("mapEntryFacts (tier 2): a vendor fact is VERIFIED, tier 2, value in the canonical unit",
    vend.mapped.length === 1 && vend.mapped[0].entry.state === "verified" && vend.mapped[0].entry.prov.tier === 2 && vend.mapped[0].entry.value === 56
      && vend.mapped[0].entry.unit === "Gbit/s", vend.mapped);
}
{
  const ctx = { docId: "d0c", pageUrl: "u", fetchedDay: "2026-09-03", tier: 2 };
  check("lifecycleFromEntry: a block of N/A is no lifecycle", lifecycleFromEntry({ end_of_sale_date: "N/A", last_day_of_support: "N/A" }, ctx) === null);
  check("lifecycleFromEntry: null / undefined is no lifecycle", lifecycleFromEntry(null, ctx) === null && lifecycleFromEntry(undefined, ctx) === null);
  const eol = lifecycleFromEntry({ announce_date: "N/A", end_of_sale_date: "2027-01-31", last_day_of_support: "N/A", successor_sku: "MS130-24P" }, ctx);
  check("lifecycleFromEntry: a dated end_of_sale_date -> eol_announced, the N/A siblings NULL, successor kept",
    eol?.status === "eol_announced" && eol.end_of_sale_date === "2027-01-31" && eol.announce_date === null && eol.last_day_of_support === null
      && eol.successor_sku === "MS130-24P" && eol.tier === 2 && eol.verified_at === "2026-09-03" && eol.doc_id === "d0c", eol);
  const active = lifecycleFromEntry({ announce_date: "2026-01-01" }, ctx);
  check("lifecycleFromEntry: an announce date alone is `active`", active?.status === "active" && active.announce_date === "2026-01-01", active);
  check("lifecycleFromEntry: a date in the wrong shape is not a date", lifecycleFromEntry({ end_of_sale_date: "31/01/2027" }, ctx) === null);
}

// =================================================================================================
// the gate, driven directly
// =================================================================================================
{
  const provPage = `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G")}.html`;
  const badPage = `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-BAD-PROVENANCE")}.html`;
  const good: WrittenFact[] = [{ raw: "370 W", label: "PoE budget", cache: provPage }];
  const a = auditProvenance(good, 60);
  check("provenance audit: raw value + label both on the page -> hit (&nbsp; folded, <script> stripped)", a.precision === 1 && a.sampled === 1 && a.misses.length === 0, a);
  sabotages++;
  const b = auditProvenance([{ raw: "999 W", label: "PoE budget", cache: badPage }], 60);
  check("SABOTAGE provenance audit: the value is NOT on the page -> miss, named as label = raw", b.precision === 0 && b.sampled === 1 && b.misses[0] === "PoE budget = 999 W", b);
  sabotages++;
  const c = auditProvenance([{ raw: "740 W", label: "Total power", cache: badPage }], 60);
  check("SABOTAGE provenance audit: the value is on the page but under a different LABEL -> miss", c.precision === 0 && c.misses[0] === "Total power = 740 W", c);
  sabotages++;
  const d = auditProvenance([{ raw: "370 W", label: "PoE budget", cache: "0000000000000000000000000000000000000000.html" }], 60);
  check("SABOTAGE provenance audit: a page that cannot be read is 'could not check', and a run that wrote facts it could not check scores 0", d.precision === 0 && d.sampled === 0, d);
  sabotages++;
  const e = auditProvenance([{ raw: "370 W", label: "PoE budget", cache: null }], 60);
  check("SABOTAGE provenance audit: no cache_path at all -> 0 as well", e.precision === 0 && e.sampled === 0, e);
  const f = auditProvenance([], 60);
  check("provenance audit: a run that wrote nothing has nothing to fail on (precision 1, sampled 0)", f.precision === 1 && f.sampled === 0, f);
  const g = auditProvenance([good[0], good[0], good[0]], 2);
  check("provenance audit samples at most --sample facts", g.sampled === 2, g);

  const suites = runAdapterSuites(["provantage", "cdw"]);
  check("adapter suites: provantage's suite is green, cdw has none and counts as failed", suites.provantage === true && suites.cdw === false, suites);
  sabotages++;
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-no-suites-")); tmpDirs.push(emptyDir);
  check("SABOTAGE adapter suites: a source whose suite file is absent from the tests dir fails, whatever its slug",
    runAdapterSuites(["provantage"], { testsDir: emptyDir }).provantage === false);
  sabotages++;
  const redDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-red-suite-")); tmpDirs.push(redDir);
  fs.writeFileSync(path.join(redDir, "test_provantage.py"), "import sys\nprint('MISS | deliberately red')\nsys.exit(1)\n");
  check("SABOTAGE adapter suites: a suite that exits non-zero fails the source", runAdapterSuites(["provantage"], { testsDir: redDir }).provantage === false);

  const gate = computeGate(good, ["provantage"], 60);
  check("computeGate: green suite + audited facts -> passed, recall 1, precision 1", gate.passed && gate.recall === 1 && gate.precision === 1 && gate.sampled === 1, gate);
  sabotages++;
  const noSuite = computeGate([{ raw: "740 W", label: "PoE budget", cache: `${sha1("https://www.cdw.com/search/?key=NZTEST-C9200L-48P-4G")}.html` }], ["cdw"], 60);
  check("SABOTAGE computeGate: missing suite -> recall 0 -> NOT passed, although precision is 1", !noSuite.passed && noSuite.recall === 0 && noSuite.precision === 1 && noSuite.suites.cdw === false, noSuite);
  sabotages++;
  const noSources = computeGate([], [], 60);
  check("SABOTAGE computeGate: no source touched at all -> recall 0 -> NOT passed", !noSources.passed && noSources.recall === 0, noSources);
}

// =================================================================================================
// a committed run over the good fixtures
// =================================================================================================
// Copies of the fixtures with task.part_id filled for the provantage page (the anchored path);
// the meraki page keeps part_id null and is found by --vendor cisco + SKU.
const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-acquired-good-")); tmpDirs.push(goodDir);
for (const f of fixtureFiles("good")) {
  const doc = JSON.parse(fs.readFileSync(f, "utf8")) as Acquired;
  if (doc.source === "provantage") doc.task.part_id = partA;
  fs.writeFileSync(path.join(goodDir, path.basename(f)), JSON.stringify(doc, null, 1));
}
const runsBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n;
await main([goodDir, "--vendor", "cisco"]);
check("DRY RUN (no --commit) opens no run and writes no fact",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0].n === runsBefore
    && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === 0);

await main([goodDir, "--commit", "--vendor", "cisco"]);
check("the committed run set no failure exit code", process.exitCode === undefined || process.exitCode === 0, process.exitCode);
type RunRow = { id: number; kind: string; status: string; gate: Record<string, unknown> | null; stats: Record<string, number>; notes: string | null; inputs: Record<string, unknown> };
const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
check("the run row: kind apply-acquired, succeeded, notes name the sources", run?.kind === "apply-acquired" && run.status === "succeeded" && run.notes === "sources=provantage,meraki", run);
check("the run row carries a PASSING gate with both suites green and 3 facts audited",
  run?.gate?.passed === true && run.gate.recall === 1 && run.gate.precision === 1 && run.gate.sampled === 3
    && (run.gate.suites as Record<string, boolean>).provantage === true && (run.gate.suites as Record<string, boolean>).meraki === true, run?.gate);
check("the run row records its inputs with hashes and the commit flag",
  (run?.inputs.hashes as unknown[]).length === 2 && run.inputs.commit === true && run.inputs.files === 2, run?.inputs);
const st = run?.stats ?? {};
check("stats: 2 pages, 4 entries, 2 parts matched, 1 unknown SKU, 1 family-scoped skipped",
  st.pages === 2 && st.entries === 4 && st.parts_matched === 2 && st.sku_unknown === 1 && st.family_scoped_skipped === 1, st);
check("stats: 5 raw facts -> 3 ok, 1 unmapped, 1 rejected, 3 inserted",
  st.facts_raw === 5 && st.facts_ok === 3 && st.facts_unmapped === 1 && st.facts_rejected === 1 && st.insert === 3, st);
check("stats: 2 relations + 1 invalid kind, 1 image + 1 skipped non-vendor, 1 lifecycle, 1 alias, 1 price seen, 2 checks",
  st.relations === 2 && st.relations_invalid_kind === 1 && st.images === 1 && st.images_skipped_non_vendor === 1 && st.lifecycle === 1
    && st.aliases === 1 && st.prices_seen === 1 && st.checks === 2, st);

type FactRow = { field_key: string; value: unknown; unit: string; raw: string; state: string; tier: number; method: string; doc_id: string; locator: string; run_id: number; extracted_at: string; norm_v: string };
const factsOf = async (partId: number) => (await query<FactRow>(
  "SELECT field_key, value, unit, raw, state, tier, method, doc_id, locator, run_id, extracted_at::text AS extracted_at, norm_v FROM facts WHERE part_id = $1 AND superseded_by IS NULL ORDER BY field_key", [partId])).rows;
const provDoc = docIdFor("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G");
const merakiDoc = docIdFor("https://documentation.meraki.com/MS/nztest/MS120-24P");
{
  const fa = await factsOf(partA);
  check("distributor (tier 4) fact: poe_budget 370 W lands UNVERIFIED with its provenance and this run's id",
    fa.length === 1 && fa[0].field_key === "poe_budget" && fa[0].state === "unverified" && fa[0].tier === 4 && fa[0].value === 370 && fa[0].unit === "W"
      && fa[0].raw === "370 W" && fa[0].method === "distributor_page:provantage" && fa[0].doc_id === provDoc && fa[0].locator === "t1:r3:c2"
      && fa[0].run_id === run.id && fa[0].extracted_at === "2026-09-03" && typeof fa[0].norm_v === "string", fa);
  check("the refused value (switching_capacity = n/a) was never written", !fa.some((f) => f.field_key === "switching_capacity"));
  const fm = await factsOf(partM);
  check("vendor (tier 2) facts: switching_capacity 56 Gbit/s and weight 4.9 kg land VERIFIED with the vendor doc",
    fm.length === 2 && fm.every((f) => f.state === "verified" && f.tier === 2 && f.method === "vendor_page:meraki" && f.doc_id === merakiDoc)
      && fm[0].field_key === "switching_capacity" && fm[0].value === 56 && fm[0].unit === "Gbit/s" && fm[1].field_key === "weight" && fm[1].value === 4.9, fm);
  check("every written fact has an evidence row",
    (await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence")).rows[0].n === 3);
  check("the family-scoped entry wrote nothing for C9200L-48P-4G", (await factsOf(partB)).length === 0);
  check("nothing was written for the unknown SKU (no part, no fact, no check)",
    !(await query("SELECT 1 FROM parts WHERE sku = 'NZTEST-NOT-A-PART'")).rowCount
      && (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts")).rows[0].n === 3);
}
{
  const docs = (await query<{ doc_id: string; doc_type: string; cache_path: string; vendor_id: number; fetched_at: string }>(
    "SELECT doc_id, doc_type, cache_path, vendor_id, fetched_at::text AS fetched_at FROM source_docs ORDER BY doc_id")).rows;
  const p = docs.find((d) => d.doc_id === provDoc), m = docs.find((d) => d.doc_id === merakiDoc);
  check("source_docs: one distributor_page and one vendor_page, each with its cache path and fetch day",
    docs.length === 2 && p?.doc_type === "distributor_page" && p.cache_path === `${sha1("https://www.provantage.com/scripts/search.dll?QUERY=NZTEST-C9200L-24P-4G")}.html`
      && m?.doc_type === "vendor_page" && m.vendor_id === cisco && m.fetched_at === "2026-09-03", docs);
  const links = (await query<{ doc_id: string; part_id: number }>("SELECT doc_id, part_id FROM doc_parts ORDER BY 1, 2")).rows;
  check("doc_parts links each page to the part it describes and no other",
    links.length === 2 && links.some((l) => l.doc_id === provDoc && l.part_id === partA) && links.some((l) => l.doc_id === merakiDoc && l.part_id === partM), links);
}
{
  const rels = (await query<{ from_part_id: number; to_sku: string; kind: string; tier: number; doc_id: string; note: string }>(
    "SELECT from_part_id, to_sku, kind::text AS kind, tier, doc_id, note FROM relations ORDER BY from_part_id, to_sku")).rows;
  check("relations: the valid kinds are written with the source's tier; the invalid kind ('replaces') is not",
    rels.length === 2
      && rels.some((r) => r.from_part_id === partA && r.to_sku === "C9200-STACK-KIT" && r.kind === "compatible" && r.tier === 4 && r.doc_id === provDoc && r.note === "stacking kit")
      && rels.some((r) => r.from_part_id === partM && r.to_sku === "MS130-24P" && r.kind === "successor" && r.tier === 2)
      && !rels.some((r) => r.to_sku === "WS-C2960L-24PS-LL"), rels);
  const imgs = (await query<{ part_id: number; role: string; source_url: string; source_id: number; license_note: string; assignment_method: string }>(
    "SELECT part_id, role, source_url, source_id, license_note, assignment_method FROM images")).rows;
  check("images: the vendor page's image is written with its source; the distributor's is skipped",
    imgs.length === 1 && imgs[0].part_id === partM && imgs[0].role === "primary" && imgs[0].source_id === sources.get("meraki")!.id
      && imgs[0].source_url === "https://documentation.meraki.com/nztest/ms120-24p.png" && /meraki/.test(imgs[0].license_note) && imgs[0].assignment_method === "source-page", imgs);
  const lcs = (await query<{ part_id: number; status: string; end_of_sale_date: string | null; last_day_of_support: string | null; successor_sku: string; doc_id: string; verified_at: string; run_id: number }>(
    "SELECT part_id, status::text AS status, end_of_sale_date::text AS end_of_sale_date, last_day_of_support::text AS last_day_of_support, successor_sku, doc_id, verified_at::text AS verified_at, run_id FROM lifecycle")).rows;
  check("lifecycle: the dated end_of_sale_date makes ONE row (eol_announced, N/A siblings NULL); the all-N/A block makes none",
    lcs.length === 1 && lcs[0].part_id === partM && lcs[0].status === "eol_announced" && lcs[0].end_of_sale_date === "2027-01-31" && lcs[0].last_day_of_support === null
      && lcs[0].successor_sku === "MS130-24P" && lcs[0].doc_id === merakiDoc && lcs[0].verified_at === "2026-09-03" && lcs[0].run_id === run.id, lcs);
  const al = (await query<{ part_id: number; kind: string; value: string; tier: number }>("SELECT part_id, kind, value, tier FROM part_aliases")).rows;
  check("aliases: the UPC lands on the provantage part at tier 4", al.length === 1 && al[0].part_id === partA && al[0].kind === "upc" && al[0].value === "889728171533" && al[0].tier === 4, al);
  const checks = (await query<{ part_id: number; source_id: number; outcome: string; facts_found: number; fields_found: string[]; doc_id: string; run_id: number }>(
    "SELECT part_id, source_id, outcome, facts_found, fields_found, doc_id, run_id FROM part_source_checks ORDER BY part_id")).rows;
  const cA = checks.find((c) => c.part_id === partA), cM = checks.find((c) => c.part_id === partM);
  check("part_source_checks: facts_found with the MAPPED field keys (unmapped and rejected excluded), per source and doc",
    checks.length === 2
      && cA?.source_id === sources.get("provantage")!.id && cA.outcome === "facts_found" && cA.facts_found === 1 && cA.fields_found.join(",") === "poe_budget" && cA.doc_id === provDoc && cA.run_id === run.id
      && cM?.source_id === sources.get("meraki")!.id && cM.outcome === "facts_found" && cM.facts_found === 2 && [...cM.fields_found].sort().join(",") === "switching_capacity,weight", checks);
}
{
  const day = new Date().toISOString().slice(0, 10);
  const unmappedFile = path.join(ROOT, "runs", "reports", `unmapped-provantage+meraki-${day}.json`);
  const rep = fs.existsSync(unmappedFile) ? JSON.parse(fs.readFileSync(unmappedFile, "utf8")) as { sources: string[]; labels: { label: string; count: number; samples: string[]; categories: string[] }[] } : null;
  const lab = rep?.labels.find((l) => l.label === "Interfaces/Ports > Total Number of Network Ports");
  check("the unmapped report names the label with its count, a sample value and the category",
    rep?.sources.join(",") === "provantage,meraki" && rep.labels.length === 1 && lab?.count === 1 && lab.samples.join(",") === "24" && lab.categories.join(",") === "switches", rep);
  const unknownFile = path.join(ROOT, "runs", "reports", `unknown-skus-provantage+meraki-${day}.jsonl`);
  const lines = fs.existsSync(unknownFile) ? fs.readFileSync(unknownFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  check("the unknown-SKU feed carries the SKU the page named, with source, vendor, name, url and its fact count",
    lines.length === 1 && lines[0].sku === "NZTEST-NOT-A-PART" && lines[0].source === "provantage" && lines[0].vendor === "cisco"
      && lines[0].name === "Cisco something we do not hold" && lines[0].facts === 1 && typeof lines[0].url === "string", lines);
}

// =================================================================================================
// SABOTAGE: the gate fails, through the real CLI
// =================================================================================================
const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
function cli(dir: string): { status: number | null; out: string } {
  const r = spawnSync(tsx, [path.join("src", "pipeline", "apply-acquired.ts"), dir, "--commit", "--vendor", "cisco"],
    { cwd: ROOT, encoding: "utf8", env: process.env, shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const succeededBefore = (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE kind = 'apply-acquired' AND status = 'succeeded'")).rows[0].n;
{
  sabotages++;
  const r = cli(path.join(FIXTURES, "sabotage-no-suite"));
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE no adapter suite for the source: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-400) });
  check("SABOTAGE no adapter suite: the run is closed FAILED with gate NULL — nothing presented as gated",
    failed?.kind === "apply-acquired" && failed.status === "failed" && failed.gate === null && failed.id !== run.id, failed);
  check("SABOTAGE no adapter suite: the refusal names the reason — recall 0, cdw suite false — not precision",
    /did not pass/.test(failed?.notes ?? "") && /"recall":0/.test(failed?.notes ?? "") && /"cdw":false/.test(failed?.notes ?? "") && /"precision":1/.test(failed?.notes ?? ""), failed?.notes);
  const under = (await query<{ status: string }>("SELECT r.status::text AS status FROM facts f JOIN runs r ON r.id = f.run_id WHERE f.part_id = $1", [partB])).rows;
  check("SABOTAGE no adapter suite: what it wrote is traceable to a FAILED run, never to a gated one", under.length === 1 && under[0].status === "failed", under);
}
{
  sabotages++;
  await query("DELETE FROM facts WHERE part_id = $1", [partB]);
  const r = cli(path.join(FIXTURES, "sabotage-provenance"));
  const failed = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE provenance not on the cached page: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-400) });
  check("SABOTAGE provenance: the run is closed FAILED with gate NULL", failed?.status === "failed" && failed.gate === null, failed);
  check("SABOTAGE provenance: the refusal names precision 0 with the missed fact, while the provantage suite was green (recall 1)",
    /did not pass/.test(failed?.notes ?? "") && /"precision":0/.test(failed?.notes ?? "") && /"recall":1/.test(failed?.notes ?? "")
      && /PoE budget = 999 W/.test(failed?.notes ?? "") && /"provantage":true/.test(failed?.notes ?? ""), failed?.notes);
}
check("no sabotage run was ever recorded as succeeded",
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM runs WHERE kind = 'apply-acquired' AND status = 'succeeded'")).rows[0].n === succeededBefore);
{
  sabotages++;
  const r = cli(path.join(FIXTURES, "does-not-exist"));
  check("SABOTAGE a path that does not exist is refused, naming it, with exit 1", r.status === 1 && /no such path/.test(r.out), r.out.slice(-300));
}

// ---- cleanup ------------------------------------------------------------------------------------
// The reports the committed run wrote carry fixture SKUs (NZTEST-…); left in runs/reports they
// would read as a real enumeration feed, so they go too.
{
  const day = new Date().toISOString().slice(0, 10);
  for (const f of [`unmapped-provantage+meraki-${day}.json`, `unknown-skus-provantage+meraki-${day}.jsonl`]) {
    fs.rmSync(path.join(ROOT, "runs", "reports", f), { force: true });
  }
}
cleanup();
check("the cached pages written for this suite are gone again", cacheFiles.every((f) => !fs.existsSync(f)));
// The fixture parts have no completeness rows; left behind they would trip invariants.test.ts
// ("a hardware part with no completeness row") in a later suite of the same run.
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
