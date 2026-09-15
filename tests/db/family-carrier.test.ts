// tests/db/family-carrier.test.ts — proof for scripts/family-carrier.mts and migration 0022 (the operator's Q-10 vs Q-23 flag:
// "a column, not a cup … so the shop feed can never list a carrier as orderable").
//
//   NETZSPEC_DB=test npx tsx tests/db/family-carrier.test.ts
//
// What is proved:
//   * THE DRY RUN WRITES NOTHING — no flag, no reason, no `runs` row — and reports what it would flag and what it would clear;
//   * SABOTAGE — each refusal before any write, for its stated reason: --commit without --approved, an unknown argument, a listed SKU that
//     is not a live part of the category the list names, a list with no carriers;
//   * THE COMMIT flags exactly the listed rows with a reason naming the decision, in one run of kind `family-carrier` (succeeded, no gate —
//     it writes no fact), and verifies from a new connection;
//   * THE FILE IS THE WHOLE TRUTH: a row that leaves the list loses its flag on the next run, and a flag nobody listed is cleared — so a
//     wrong entry is cheap to undo (a set-only writer would leave it flagged for ever);
//   * THE FLAG REACHES THE FEED: the part record's schema carries family_carrier, because netzspec.com syncs from /v1/export and a flag that
//     lived only on the layers page could never reach it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { PartRecord } from "../../src/api/schemas.js";

if (process.env.NETZSPEC_DB !== "test") { console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)"); process.exit(1); }
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`family-carrier.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "family-carrier.mts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let pass = 0, sabotages = 0;
const misses: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 600)}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "family-carrier-"));
const listPath = path.join(tmp, "carriers.json");
const run = (...args: string[]) => { const r = spawnSync(TSX, [SCRIPT, "--carriers-file", listPath, ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;
const flags = async () => new Map((await query<{ sku: string; flag: boolean; reason: string | null }>("SELECT sku, family_carrier AS flag, family_carrier_reason AS reason FROM parts ORDER BY sku")).rows.map((r) => [r.sku, r]));
const writeList = (skus: { sku: string; category: string; decision?: string; note?: string }[]) =>
  fs.writeFileSync(listPath, JSON.stringify({ _about: "test", carriers: skus.map((s) => ({ decision: "Q-23", facts: 1, docs: 1, note: "a test carrier", ...s })) }, null, 1) + "\n");

// fixture
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const catId = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
for (const [sku, cat] of [["ZZ-CARRIER-1", "wireless"], ["ZZ-CARRIER-2", "switches"], ["ZZ-PLAIN-1", "wireless"], ["ZZ-STRAY-1", "wireless"]])
  await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, 'hardware', 'category-is_hardware=true')`,
    [cisco, sku, `cisco-${sku.toLowerCase()}`, await catId(cat)]);
// a row already carrying the flag that nobody lists — the run must clear it
await query("UPDATE parts SET family_carrier = true, family_carrier_reason = 'set by hand before the run' WHERE sku = 'ZZ-STRAY-1'");
writeList([{ sku: "ZZ-CARRIER-1", category: "wireless" }, { sku: "ZZ-CARRIER-2", category: "switches", decision: "Q-10 vs Q-23" }]);
const before = await flags();

check("the export contract carries the flag: PartRecord has family_carrier and family_carrier_reason",
  "family_carrier" in (PartRecord as { properties: Record<string, unknown> }).properties && "family_carrier_reason" in (PartRecord as { properties: Record<string, unknown> }).properties);

// the dry run
{
  const r = run();
  check("dry run: exits 0, names the two listed carriers and the one flagged row it would clear",
    r.status === 0 && /DRY RUN/.test(r.out) && /2 listed/.test(r.out) && /live parts matched: 2 of 2/.test(r.out) && /would be cleared\): 1/.test(r.out), r.out.slice(-400));
  sabotages++;
  const after = await flags();
  check("SABOTAGE dry run: no flag, no reason and no run row changed", JSON.stringify([...after]) === JSON.stringify([...before]) && (await count("SELECT count(*)::int AS n FROM runs")) === 0);
}

// the refusals
{
  const refusal = async (name: string, args: string[], why: RegExp, mutate?: () => void | Promise<void>, undo?: () => void | Promise<void>) => {
    if (mutate) await mutate();
    const r = run(...args);
    if (undo) await undo();
    sabotages++;
    check(`SABOTAGE ${name}: refused for the stated reason, nothing written`, r.status !== 0 && why.test(r.out) && (await count("SELECT count(*)::int AS n FROM runs")) === 0
      && JSON.stringify([...(await flags())]) === JSON.stringify([...before]), r.out.slice(-300));
  };
  await refusal("--commit without --approved", ["--commit"], /--commit needs --approved/);
  await refusal("an unknown argument", ["--sku", "ZZ-CARRIER-1"], /unexpected argument --sku/);
  await refusal("a listed SKU that is not a live part of the category the list names", ["--commit", "--approved", "operator-test-yes"], /not a live part of the category the list names: ZZ-CARRIER-2@collaboration-endpoints/,
    () => writeList([{ sku: "ZZ-CARRIER-1", category: "wireless" }, { sku: "ZZ-CARRIER-2", category: "collaboration-endpoints" }]),
    () => writeList([{ sku: "ZZ-CARRIER-1", category: "wireless" }, { sku: "ZZ-CARRIER-2", category: "switches", decision: "Q-10 vs Q-23" }]));
  await refusal("a list with no carriers", ["--commit", "--approved", "operator-test-yes"], /holds no carriers list/,
    () => fs.writeFileSync(listPath, JSON.stringify({ carriers: [] }, null, 1) + "\n"),
    () => writeList([{ sku: "ZZ-CARRIER-1", category: "wireless" }, { sku: "ZZ-CARRIER-2", category: "switches", decision: "Q-10 vs Q-23" }]));
}

// the commit
{
  const r = run("--commit", "--approved", "operator-test-yes");
  check("commit: exits 0, names the run and verifies from a new connection",
    r.status === 0 && /COMMITTED run \d+: flagged 2, cleared 1/.test(r.out) && /flagged 2 \(must be 2\); with a reason 2; flagged outside the list \(must be 0\): 0/.test(r.out) && !/did not verify/.test(r.out), r.out.slice(-500));
  const runs = (await query<{ id: number; kind: string; status: string; gate: unknown; inputs: Record<string, unknown>; stats: Record<string, unknown> }>("SELECT id, kind, status::text AS status, gate, inputs, stats FROM runs")).rows;
  check("commit: exactly one run, kind family-carrier, succeeded, no gate (it writes no fact), the approval and the list's hash recorded",
    runs.length === 1 && runs[0].kind === "family-carrier" && runs[0].status === "succeeded" && runs[0].gate === null
    && runs[0].inputs.approved === "operator-test-yes" && typeof (runs[0].inputs.carriers_file as { sha256?: string }).sha256 === "string", runs);
  const after = await flags();
  check("commit: the two listed rows carry the flag and a reason naming the decision",
    after.get("ZZ-CARRIER-1")?.flag === true && /^family-carrier:Q-23: /.test(after.get("ZZ-CARRIER-1")?.reason ?? "")
    && after.get("ZZ-CARRIER-2")?.flag === true && /^family-carrier:Q-10 vs Q-23: /.test(after.get("ZZ-CARRIER-2")?.reason ?? ""), [...after]);
  sabotages++;
  check("SABOTAGE commit: the row nobody listed lost its flag and its reason (the file is the whole truth)",
    after.get("ZZ-STRAY-1")?.flag === false && after.get("ZZ-STRAY-1")?.reason === null, after.get("ZZ-STRAY-1"));
  sabotages++;
  check("SABOTAGE commit: the unlisted plain row was never touched", JSON.stringify(after.get("ZZ-PLAIN-1")) === JSON.stringify(before.get("ZZ-PLAIN-1")));
}

// removing a SKU from the list clears its flag on the next run — the half that makes a wrong entry cheap to undo
{
  writeList([{ sku: "ZZ-CARRIER-1", category: "wireless" }]);
  const r = run("--commit", "--approved", "operator-test-yes-2");
  const after = await flags();
  sabotages++;
  check("SABOTAGE a SKU removed from the list loses its flag on the next run",
    r.status === 0 && /flagged 1, cleared 1/.test(r.out) && after.get("ZZ-CARRIER-2")?.flag === false && after.get("ZZ-CARRIER-2")?.reason === null && after.get("ZZ-CARRIER-1")?.flag === true, r.out.slice(-300));
}

await query("TRUNCATE parts, runs CASCADE");
await closePool();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
