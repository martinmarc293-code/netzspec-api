// tests/db/apply-enumeration.test.ts — proof for src/pipeline/apply-enumeration.ts and the
// part-number rule it refuses junk with (src/pipeline/partNumber.ts).
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test5 npx tsx tests/db/apply-enumeration.test.ts
//
// Three things are proved here.
//
// 1. LOCKSTEP. tests/fixtures/partnumbers.json (>= 60 cases) is run through BOTH the TypeScript
//    isPartNumber and the Python scraper/sources/base.py is_part_number (as a child process, so
//    the real module is what answers). Every case must match its expectation on both sides —
//    verdict AND reason — and every reason in the vocabulary must be produced at least once.
//    A rule changed on one side fails here.
// 2. THE DECISIONS, pure: both file shapes load; a duplicate PID is counted, not merged; a
//    category alias maps and an unknown category does not; decide() refuses junk with the stated
//    reason, refuses a foreign vendor, folds meraki, lists an unmapped category WITHOUT creating
//    the part, treats an exact and a case-variant SKU as existing, and classes by the product
//    class table; slugs never collide; the audit names a mismatching column; the cache check
//    answers true / false / null and never pretends a PDF was read; the gate scores a run that
//    created parts and could check none of them 0, not 1.
// 3. THE RUN, through the real CLI as a child process: a dry run writes nothing (no part, no run
//    row) but reports; a commit creates exactly the planned parts with the planned columns inside
//    a run of kind apply-enumeration with a passing gate, leaves the pre-existing (operator-
//    reviewed) part byte-identical, and is idempotent. SABOTAGE: a document whose cached page
//    does not name its PIDs drives precision under 0.98 — the run is closed FAILED with gate
//    NULL, the notes name the missed PID, the CLI exits 1. A file that is neither shape and a
//    path that does not exist are refused naming them.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { isPartNumber, PART_NUMBER_REASONS } from "../../src/pipeline/partNumber.js";
import {
  loadEnumeration, mapCategory, decide, planSlugs, auditSample, pidOnCachedPage, computeGate, parseArgs, CACHE_DIR,
  type CategoryRow, type NewPart, type StoredPart,
} from "../../src/pipeline/apply-enumeration.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`apply-enumeration.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "src", "pipeline", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const YEAR = new Date().toISOString().slice(0, 4);
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

// ---- scratch files: fixtures in a temp dir, cached pages in the real cache dir, removed at exit --
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nz-enum-"));
const cacheFiles: string[] = [];
const REPORT = path.join(ROOT, "runs", "reports", `apply-enumeration-${TODAY}.json`);
const reportBefore = fs.existsSync(REPORT) ? fs.readFileSync(REPORT) : null;
function cleanup(): void {
  for (const f of cacheFiles) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* gone */ }
  // the report of a real dry run made earlier today must not be replaced by fixture output
  if (reportBefore) fs.writeFileSync(REPORT, reportBefore); else fs.rmSync(REPORT, { force: true });
}
process.on("exit", cleanup);
function cachePage(url: string, html: string): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const f = path.join(CACHE_DIR, `${sha1(url)}.html`);
  if (fs.existsSync(f)) { console.error(`MISS  refusing: ${f} already exists in the cache (a real page?)`); process.exit(1); }
  fs.writeFileSync(f, html, "utf8");
  cacheFiles.push(f);
}

// =================================================================================================
// 1. lockstep with the Python rule over the shared fixture
// =================================================================================================
{
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "partnumbers.json"), "utf8")) as {
    cases: { token: string; accept?: boolean; reason?: string }[]; allow_short: { token: string; accept?: boolean; reason?: string }[];
  };
  const all = [...fx.cases.map((c) => ({ ...c, allow_short: false })), ...fx.allow_short.map((c) => ({ ...c, allow_short: true }))];
  check(`shared fixture holds >= 60 cases (${fx.cases.length} + ${fx.allow_short.length} short-name)`, fx.cases.length >= 60);
  const py = spawnSync("python3.11", ["-c",
    "import sys, json; sys.path.insert(0, 'scraper'); from sources.base import is_part_number\n"
    + "cases = json.load(sys.stdin)\n"
    + "print(json.dumps([list(is_part_number(c['token'], c['allow_short'])) for c in cases]))"],
    { cwd: ROOT, input: JSON.stringify(all), encoding: "utf8" });
  check("python3.11 scraper/sources/base.py is_part_number answered for every case", py.status === 0 && !!py.stdout.trim(), (py.stderr || "").slice(-400));
  const pyOut = py.status === 0 ? (JSON.parse(py.stdout.trim()) as [boolean, string | null][]) : [];
  const seen = new Set<string>();
  let agree = 0, tsOk = 0, pyOk = 0;
  const disagreements: string[] = [];
  all.forEach((c, i) => {
    const ts = isPartNumber(c.token, c.allow_short);
    const p = pyOut[i] ?? [null, "no-answer"];
    const wantOk = c.accept === true;
    const tsRight = ts.ok === wantOk && (wantOk ? ts.reason === null : ts.reason === c.reason);
    const pyRight = p[0] === wantOk && (wantOk ? p[1] === null : p[1] === c.reason);
    if (tsRight) tsOk++;
    if (pyRight) pyOk++;
    if (ts.ok === p[0] && ts.reason === p[1]) agree++;
    if (!tsRight || !pyRight) disagreements.push(`${JSON.stringify(c.token)}${c.allow_short ? " (short)" : ""}: want ${wantOk ? "accept" : c.reason}, ts ${ts.ok ? "accept" : ts.reason}, py ${p[0] ? "accept" : p[1]}`);
    if (ts.reason) seen.add(ts.reason);
  });
  check(`TypeScript matches the expectation on every case (${tsOk}/${all.length})`, tsOk === all.length, disagreements);
  check(`Python matches the expectation on every case (${pyOk}/${all.length})`, pyOk === all.length, disagreements);
  check(`TypeScript and Python agree on verdict AND reason on every case (${agree}/${all.length})`, agree === all.length, disagreements);
  const dead = PART_NUMBER_REASONS.filter((r) => !seen.has(r));
  check("every reason in the vocabulary is produced by at least one fixture case (no dead rule)", dead.length === 0, dead);
  sabotages++;
  check("SABOTAGE a reason outside the vocabulary never appears", [...seen].every((r) => (PART_NUMBER_REASONS as readonly string[]).includes(r)), [...seen]);
}

// =================================================================================================
// 2. the decisions
// =================================================================================================
const CATS = new Map<string, CategoryRow>([
  ["switches", { id: 1, slug: "switches", is_hardware: true }],
  ["routers", { id: 3, slug: "routers", is_hardware: true }],
  ["transceiver", { id: 2, slug: "transceiver", is_hardware: true }],
  ["software", { id: 22, slug: "software", is_hardware: false }],
  ["meraki", { id: 21, slug: "meraki", is_hardware: true }],
  ["wireless", { id: 7, slug: "wireless", is_hardware: true }],
]);
const U = (name: string) => `https://www.cisco.com/nztest/enum/${name}.html`;
const universeFile = path.join(tmp, "universe.json");
fs.writeFileSync(universeFile, JSON.stringify({
  generated: null,
  documents: {
    [U("good-ds")]: { category: "switches", series_slug: "nz-test", series_name: "NZ Test Catalyst",
      pids: ["NZE-C9200-24P", "NZE-C9200-48P", "C9200L-24P-4G", "c9200l-48p-4g", "0.125K", "24x10G", "L-NZE-C9200-DNA-E", "CON-SNT-NZEC9200"],
      evidence: { "NZE-C9200-24P": "Part Number" } },
    [U("dup-ds")]: { category: "routers", series_slug: "nz-isr", series_name: "NZ Test ISR", pids: ["NZE-C9200-24P", "NZE-ISR-1100"] },
    [U("soft-ds")]: { category: "software", series_slug: "nz-soft", series_name: "NZ Soft", pids: ["NZE-SOFT-IMG-1"] },
    [U("odd-ds")]: { category: "gizmos", series_slug: "gizmos", series_name: "Gizmos", pids: ["NZE-GIZMO-1"] },
    [U("nocat-ds")]: { pids: ["NZE-NOCAT-1"], error: "classification failed" },
    [U("alias-ds")]: { category: "transceivers", series_slug: "nz-optics", series_name: "NZ Optics", pids: ["NZE-SFP-10G-SR=", "NZE-SFP-10G-SR"] },
  },
}, null, 1));
const recordsFile = path.join(tmp, "records.json");
fs.writeFileSync(recordsFile, JSON.stringify({
  source: "cisco-enumeration", generated_at: "2026-09-01T21:31:28.045Z",
  records: [
    { sku: "NZE-REC-1", vendor: "cisco", category: "wireless", type: "access-point", product_family: "NZ AP", datasheet_url: U("rec-ds"), lifecycle_hint: "current" },
    { sku: "NZE-MERAKI-MS1", vendor: "meraki", category: "meraki", type: "meraki", product_family: "MS", datasheet_url: U("mer-ds"), lifecycle_hint: "current" },
    { sku: "NZE-HPE-1", vendor: "hpe", category: "switches", type: "switch", product_family: "Aruba", datasheet_url: U("hpe-ds"), lifecycle_hint: "current" },
    { sku: "NZE-REC-1", vendor: "cisco", category: "wireless", type: "access-point", product_family: "NZ AP", datasheet_url: U("rec-ds-2"), lifecycle_hint: "current" },
  ],
}, null, 1));
fs.writeFileSync(path.join(tmp, "neither.json"), JSON.stringify({ hello: "world" }));

{
  const u = loadEnumeration(universeFile);
  check("loadEnumeration: the PID universe loads per document, first document wins, the duplicate is counted",
    u.shape === "universe" && u.records.length === 14 && u.duplicate_in_file === 1 && u.generated === null
      && u.records.find((r) => r.sku === "NZE-C9200-24P")?.category === "switches"
      && u.records.find((r) => r.sku === "NZE-C9200-24P")?.family === "NZ Test Catalyst"
      && u.records.find((r) => r.sku === "NZE-ISR-1100")?.url === U("dup-ds")
      && u.records.find((r) => r.sku === "NZE-NOCAT-1")?.category === null, { n: u.records.length, dup: u.duplicate_in_file });
  const r = loadEnumeration(recordsFile);
  check("loadEnumeration: the full enumeration loads per record with vendor, family and generated_at",
    r.shape === "records" && r.records.length === 3 && r.duplicate_in_file === 1 && r.generated === "2026-09-01"
      && r.records[1].vendor === "meraki" && r.records[0].family === "NZ AP" && r.records[0].url === U("rec-ds"), r);
  sabotages++;
  let msg = "";
  try { loadEnumeration(path.join(tmp, "neither.json")); } catch (e) { msg = (e as Error).message; }
  check("SABOTAGE a file that is neither shape is refused, naming the file and both shapes", /neither.json/.test(msg) && /documents/.test(msg) && /records/.test(msg), msg);
}
{
  const known = new Set(CATS.keys());
  check("mapCategory: a table slug maps to itself, case-folded", mapCategory("Switches", known) === "switches");
  check("mapCategory: the legacy spelling 'transceivers' maps to 'transceiver'", mapCategory("transceivers", known) === "transceiver");
  sabotages++;
  check("SABOTAGE mapCategory: an unknown category is null, never a default", mapCategory("gizmos", known) === null && mapCategory(null, known) === null && mapCategory("", known) === null);
}
let plan: ReturnType<typeof decide>;
{
  const u = loadEnumeration(universeFile);
  plan = decide(u, { existingSkuExact: new Set(["C9200L-24P-4G", "C9200L-48P-4G"]), existingSkuNorm: new Set(["C9200L-24P-4G", "C9200L-48P-4G"]), categories: CATS });
  const by = Object.fromEntries(plan.toCreate.map((p) => [p.sku, p]));
  check("decide: 8 new, 2 existing (1 a case variant), 2 refused, 2 category-unmapped, 1 duplicate",
    plan.stats.new === 8 && plan.stats.existing === 2 && plan.stats.existing_case_variant === 1 && plan.stats.refused_total === 2
      && plan.stats.category_unmapped_total === 2 && plan.stats.duplicate_in_file === 1, plan.stats);
  sabotages++;
  check("SABOTAGE decide: junk PIDs are refused for the STATED reason and listed with examples",
    plan.refused.quantity?.count === 2 && plan.refused.quantity.examples.join(",") === "0.125K,24x10G" && Object.keys(plan.refused).length === 1, plan.refused);
  sabotages++;
  check("SABOTAGE decide: an unknown category is LISTED with its PID and the part is NOT planned",
    plan.category_unmapped.gizmos?.examples.join() === "NZE-GIZMO-1" && plan.category_unmapped["(none)"]?.examples.join() === "NZE-NOCAT-1"
      && !by["NZE-GIZMO-1"] && !by["NZE-NOCAT-1"], plan.category_unmapped);
  check("decide: the existing exact and case-variant SKUs are never planned", !by["C9200L-24P-4G"] && !by["c9200l-48p-4g"]);
  check("decide: product class by the table — hardware, licence (L-), service (CON-), software (is_hardware=false)",
    by["NZE-C9200-24P"]?.product_class === "hardware" && by["NZE-C9200-24P"].product_class_reason === "category-is_hardware=true:switches"
      && by["L-NZE-C9200-DNA-E"]?.product_class === "license" && by["L-NZE-C9200-DNA-E"].product_class_reason === "sku-prefix:L-"
      && by["CON-SNT-NZEC9200"]?.product_class === "service"
      && by["NZE-SOFT-IMG-1"]?.product_class === "software" && by["NZE-SOFT-IMG-1"].category === "software",
    Object.values(by).map((p) => [p.sku, p.product_class, p.product_class_reason]));
  check("decide: category, family and datasheet_url come from the naming document; the alias category maps",
    by["NZE-ISR-1100"]?.category === "routers" && by["NZE-ISR-1100"].family === "NZ Test ISR" && by["NZE-ISR-1100"].datasheet_url === U("dup-ds")
      && by["NZE-SFP-10G-SR="]?.category === "transceiver" && by["NZE-C9200-24P"].category === "switches", by["NZE-ISR-1100"]);
  const r = decide(loadEnumeration(recordsFile), { existingSkuExact: new Set(), existingSkuNorm: new Set(), categories: CATS });
  sabotages++;
  check("SABOTAGE decide: a foreign vendor is refused naming it; meraki is folded into cisco and counted",
    r.stats.new === 2 && r.stats.vendor_folded_meraki === 1 && r.refused["vendor:hpe"]?.examples.join() === "NZE-HPE-1"
      && r.toCreate.find((p) => p.sku === "NZE-MERAKI-MS1")?.category === "meraki", r.stats);
}
{
  planSlugs(plan.toCreate, new Set(["nze-isr-1100"]));
  const s = Object.fromEntries(plan.toCreate.map((p) => [p.sku, p.slug]));
  check("planSlugs: spare and non-spare twins get distinct slugs; a taken slug is stepped past",
    s["NZE-SFP-10G-SR="] === "nze-sfp-10g-sr" && s["NZE-SFP-10G-SR"] === "nze-sfp-10g-sr-2" && s["NZE-ISR-1100"] === "nze-isr-1100-2"
      && new Set(Object.values(s)).size === plan.toCreate.length, s);
}
{
  const planned: NewPart[] = [
    { sku: "A-1", category: "switches", category_id: 1, family: "F", product_class: "hardware", product_class_reason: "r", datasheet_url: "u" },
    { sku: "B-2", category: "routers", category_id: 3, family: null, product_class: "hardware", product_class_reason: "r", datasheet_url: null },
    { sku: "C-3", category: "routers", category_id: 3, family: null, product_class: "hardware", product_class_reason: "r", datasheet_url: null },
  ];
  const stored = new Map<string, StoredPart>([
    ["A-1", { sku: "A-1", category: "switches", family: "F", datasheet_url: "u", first_seen_source: "cisco-catalog-2026", product_class: "hardware" }],
    ["B-2", { sku: "B-2", category: "switches", family: null, datasheet_url: null, first_seen_source: "cisco-catalog-2026", product_class: "hardware" }],
  ]);
  const a = auditSample(planned, stored, "cisco-catalog-2026");
  sabotages++;
  check("SABOTAGE auditSample: a stored category that differs and a part never stored are misses, named",
    a.hits === 1 && a.checked === 3 && a.misses.length === 2 && /B-2: category switches != routers/.test(a.misses[0]) && /C-3: not stored/.test(a.misses[1]), a);
}
{
  const dir = fs.mkdtempSync(path.join(tmp, "cache-"));
  const url = "https://www.cisco.com/nztest/enum/pure-ds.html";
  fs.writeFileSync(path.join(dir, `${sha1(url)}.html`), "<html><body><table><tr><td>Part&nbsp;Number</td><td>NZE-PURE-1=</td></tr><script>NZE-SCRIPT-ONLY</script></table></body></html>");
  fs.writeFileSync(path.join(dir, `${sha1(url + ".pdf")}.bin`), "%PDF-1.4 NZE-PDF-1");
  check("pidOnCachedPage: the PID on the page (entity-folded) -> true; spare form matches its bare twin", pidOnCachedPage(url, "NZE-PURE-1=", dir) === true && pidOnCachedPage(url, "nze-pure-1", dir) === true);
  sabotages++;
  check("SABOTAGE pidOnCachedPage: a PID not on the page -> false; one only inside <script> -> false", pidOnCachedPage(url, "NZE-ABSENT-1", dir) === false && pidOnCachedPage(url, "NZE-SCRIPT-ONLY", dir) === false);
  check("pidOnCachedPage: no document, not cached, or a PDF -> null (not checkable, never pretended)",
    pidOnCachedPage(null, "X", dir) === null && pidOnCachedPage("https://www.cisco.com/nztest/enum/none.html", "X", dir) === null && pidOnCachedPage(url + ".pdf", "NZE-PDF-1", dir) === null);
}
{
  sabotages++;
  const g0 = computeGate({ hits: 0, checked: 0, misses: [] }, { hits: 0, checked: 0, unchecked: 5, misses: [] }, { expected: 5, found: 5 }, 5);
  check("SABOTAGE computeGate: parts created and NOTHING checkable scores precision 0, not 1, and fails", g0.precision === 0 && !g0.passed && g0.cache_unchecked === 5, g0);
  sabotages++;
  const g1 = computeGate({ hits: 5, checked: 5, misses: [] }, { hits: 3, checked: 3, unchecked: 2, misses: [] }, { expected: 5, found: 4 }, 5);
  check("SABOTAGE computeGate: one planned part missing after the write -> recall < 1 -> fails", g1.precision === 1 && g1.recall === 0.8 && !g1.passed, g1);
  const g2 = computeGate({ hits: 0, checked: 0, misses: [] }, { hits: 0, checked: 0, unchecked: 0, misses: [] }, { expected: 0, found: 0 }, 0);
  check("computeGate: nothing to create -> precision 1, recall 1, passed (an idempotent rerun)", g2.passed && g2.precision === 1 && g2.recall === 1);
  const g3 = computeGate({ hits: 8, checked: 8, misses: [] }, { hits: 4, checked: 4, unchecked: 4, misses: [] }, { expected: 8, found: 8 }, 8);
  check("computeGate: pooled precision over the DB re-read and the cache half", g3.precision === 1 && g3.passed && g3.db_checked === 8 && g3.cache_checked === 4);
  const p = parseArgs(["x.json", "--commit", "--sample", "7"]);
  check("parseArgs: file, --commit, --sample", p.file === "x.json" && p.commit && p.sample === 7);
  check("parseArgs defaults: dry run, sample 60", !parseArgs(["x.json"]).commit && parseArgs(["x.json"]).sample === 60);
}

// =================================================================================================
// 3. the run, through the CLI
// =================================================================================================
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, name, first_seen_source, review_tier)
  VALUES ($1, 'C9200L-24P-4G', 'c9200l-24p-4g', $2, 'Cisco Catalyst 9200', 'hardware', 'hexcat', 'Catalyst 9200L 24-port PoE+', 'hexcat', 0),
         ($1, 'C9200L-48P-4G', 'c9200l-48p-4g', $2, 'Cisco Catalyst 9200', 'hardware', 'hexcat', 'Catalyst 9200L 48-port PoE+', 'hexcat', 0)`, [cisco, switches]);
const rowOf = async (sku: string) => JSON.stringify((await query("SELECT * FROM parts WHERE sku = $1", [sku])).rows[0]);
const hexcatBefore = await rowOf("C9200L-24P-4G");

cachePage(U("good-ds"), "<html><body><h1>NZ Test Catalyst</h1><table><tr><th>Part Number</th></tr><tr><td>NZE-C9200-24P</td></tr><tr><td>NZE-C9200-48P</td></tr>"
  + "<tr><td>C9200L-24P-4G</td></tr><tr><td>L-NZE-C9200-DNA-E</td></tr><tr><td>CON-SNT-NZEC9200</td></tr></table></body></html>");

type RunRow = { id: number; kind: string; status: string; gate: Record<string, unknown> | null; stats: Record<string, unknown>; notes: string | null; inputs: Record<string, unknown> };
function cli(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(TSX, [CLI, "apply-enumeration", ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;

{
  const r = cli(universeFile);
  const parts = await count("SELECT count(*)::int AS n FROM parts");
  const runs = await count("SELECT count(*)::int AS n FROM runs");
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  check("dry run: exit 0, no part written, no run row, and the report says commit:false with the plan",
    r.status === 0 && parts === 2 && runs === 0 && report.commit === false && report.run_id === null && report.gate === null
      && report.stats.new === 8 && report.cache_audit.checked === 4 && report.cache_audit.hits === 4 && /DRY RUN/.test(r.out), { status: r.status, parts, runs, tail: r.out.slice(-300) });
}
{
  const r = cli(universeFile, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("commit: exit 0 and a run of kind apply-enumeration closed succeeded with a passing gate", r.status === 0 && run?.kind === "apply-enumeration" && run.status === "succeeded"
    && run.gate?.passed === true && run.gate.precision === 1 && run.gate.recall === 1 && run.gate.db_checked === 8 && run.gate.cache_checked === 4, { status: r.status, run, tail: r.out.slice(-400) });
  check("commit: the run records the file hash, the shape and the source tag", typeof (run?.inputs.file as Record<string, unknown>)?.sha256 === "string" && run?.inputs.shape === "universe" && run.inputs.first_seen_source === `cisco-catalog-${YEAR}`, run?.inputs);
  check("commit: stats — 8 inserted, 2 existing, 2 refused (quantity), 2 category-unmapped, 1 duplicate",
    run?.stats.inserted === 8 && run.stats.new === 8 && run.stats.existing === 2 && run.stats.existing_case_variant === 1
      && (run.stats.refused as Record<string, number>).quantity === 2 && (run.stats.category_unmapped as Record<string, number>).gizmos === 1
      && (run.stats.category_unmapped as Record<string, number>)["(none)"] === 1 && run.stats.duplicate_in_file === 1, run?.stats);
  const rows = (await query<{ sku: string; slug: string; category: string; family: string | null; product_class: string; product_class_reason: string; datasheet_url: string; first_seen_source: string; enumerated_at: string; name: string | null }>(
    `SELECT p.sku, p.slug, c.slug AS category, p.family, p.product_class::text AS product_class, p.product_class_reason, p.datasheet_url, p.first_seen_source,
            p.enumerated_at::text AS enumerated_at, p.name FROM parts p JOIN categories c ON c.id = p.category_id WHERE p.first_seen_source LIKE 'cisco-catalog-%' ORDER BY p.sku`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.sku, r]));
  check("commit: exactly the 8 planned parts exist, every one tagged cisco-catalog-<year> and dated today",
    rows.length === 8 && rows.every((r) => r.first_seen_source === `cisco-catalog-${YEAR}` && r.enumerated_at === TODAY && r.name === null), rows.map((r) => r.sku));
  check("commit: category, family, datasheet_url and class per part as planned",
    by["NZE-C9200-24P"]?.category === "switches" && by["NZE-C9200-24P"].family === "NZ Test Catalyst" && by["NZE-C9200-24P"].datasheet_url === U("good-ds") && by["NZE-C9200-24P"].product_class === "hardware"
      && by["NZE-ISR-1100"]?.category === "routers" && by["NZE-ISR-1100"].datasheet_url === U("dup-ds")
      && by["L-NZE-C9200-DNA-E"]?.product_class === "license" && by["CON-SNT-NZEC9200"]?.product_class === "service" && by["NZE-SOFT-IMG-1"]?.product_class === "software"
      && by["NZE-SFP-10G-SR="]?.category === "transceiver", rows);
  check("commit: the spare and its twin are two parts with distinct slugs", by["NZE-SFP-10G-SR="]?.slug === "nze-sfp-10g-sr" && by["NZE-SFP-10G-SR"]?.slug === "nze-sfp-10g-sr-2");
  sabotages++;
  check("SABOTAGE commit: the operator-reviewed part named by the file is byte-identical afterwards (never modified)", (await rowOf("C9200L-24P-4G")) === hexcatBefore);
  check("commit: the junk and the unmapped-category PIDs were NOT created", (await count("SELECT count(*)::int AS n FROM parts WHERE sku = ANY($1::text[])", [["0.125K", "24x10G", "NZE-GIZMO-1", "NZE-NOCAT-1"]])) === 0);
}
{
  const r = cli(universeFile, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("idempotent: a second commit creates nothing, counts 10 existing, and still closes succeeded (nothing to gate)",
    r.status === 0 && run?.status === "succeeded" && run.stats.inserted === 0 && run.stats.new === 0 && run.stats.existing === 10 && run.gate?.passed === true
      && (await count("SELECT count(*)::int AS n FROM parts")) === 10, { run: run?.stats, gate: run?.gate });
}
{
  const r = cli(recordsFile, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  const rec = (await query<{ sku: string; category: string; family: string | null; first_seen_source: string; enumerated_at: string }>(
    `SELECT p.sku, c.slug AS category, p.family, p.first_seen_source, p.enumerated_at::text AS enumerated_at FROM parts p JOIN categories c ON c.id = p.category_id
      WHERE p.sku IN ('NZE-REC-1', 'NZE-MERAKI-MS1', 'NZE-HPE-1') ORDER BY p.sku`)).rows;
  check("records shape: 2 created (meraki folded to cisco, in the meraki category), the hpe record refused, dated from generated_at",
    r.status === 0 && run?.status === "succeeded" && run.stats.inserted === 2 && run.stats.vendor_folded_meraki === 1 && (run.stats.refused as Record<string, number>)["vendor:hpe"] === 1
      && rec.length === 2 && rec[0].sku === "NZE-MERAKI-MS1" && rec[0].category === "meraki" && rec[1].category === "wireless" && rec[1].family === "NZ AP"
      && rec.every((x) => x.first_seen_source === "cisco-catalog-2026" && x.enumerated_at === "2026-09-01"), { stats: run?.stats, rec });
}
{
  sabotages++;
  const sab = path.join(tmp, "sabotage.json");
  fs.writeFileSync(sab, JSON.stringify({ documents: { [U("sabotage-ds")]: { category: "switches", series_name: "NZ Sab", pids: ["NZE-SAB-1", "NZE-SAB-2"] } } }));
  cachePage(U("sabotage-ds"), "<html><body><p>This page names no part number at all.</p></body></html>");
  const succeededBefore = await count("SELECT count(*)::int AS n FROM runs WHERE status = 'succeeded'");
  const r = cli(sab, "--commit");
  const run = (await query<RunRow>("SELECT id, kind, status, gate, stats, notes, inputs FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("SABOTAGE cached page without its PIDs: the CLI exits 1", r.status === 1, { status: r.status, tail: r.out.slice(-400) });
  check("SABOTAGE: the run is closed FAILED with gate NULL and the notes name precision 0.5 and the missed PID",
    run?.kind === "apply-enumeration" && run.status === "failed" && run.gate === null && /did not pass/.test(run.notes ?? "") && /"precision":0\.5/.test(run.notes ?? "")
      && /NZE-SAB-1: not in cached/.test(run.notes ?? ""), run);
  check("SABOTAGE: what it inserted is traceable to that failed run, never to a succeeded one",
    (await count("SELECT count(*)::int AS n FROM parts WHERE sku LIKE 'NZE-SAB-%'")) === 2
      && (await count("SELECT count(*)::int AS n FROM runs WHERE status = 'succeeded'")) === succeededBefore);
}
{
  sabotages++;
  const r = cli(path.join(tmp, "neither.json"), "--commit");
  check("SABOTAGE a file of neither shape is refused by the CLI naming it, exit 1, no run row",
    r.status === 1 && /neither\.json/.test(r.out) && (await count("SELECT count(*)::int AS n FROM runs WHERE notes LIKE '%neither%'")) === 0, r.out.slice(-300));
  const m = cli(path.join(tmp, "missing.json"));
  check("SABOTAGE a path that does not exist is refused naming it", m.status === 1 && /no such file/.test(m.out) && /missing\.json/.test(m.out), m.out.slice(-300));
}

// ---- cleanup ------------------------------------------------------------------------------------
cleanup();
check("the cached pages written for this suite are gone again", cacheFiles.every((f) => !fs.existsSync(f)));
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs, fetch_queue, fetches CASCADE`);
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
