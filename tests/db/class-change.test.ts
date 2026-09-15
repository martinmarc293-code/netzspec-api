// tests/db/class-change.test.ts — proof for scripts/class-change.mts, the class half of the kind layer's plans (layers round 3, re-audit
// decisions, 15 Sep 2026).
//
//   NETZSPEC_DB=test npx tsx tests/db/class-change.test.ts
//
// What is proved:
//   * THE DRY RUN WRITES NOTHING — not a part, not a fact, not a `runs` row — and reports the facts it would leave;
//   * the SELECTOR IS THE PLAN FILE: only pending class plans of --category and --to, by exact SKU;
//   * SABOTAGE — each refusal happens before any write, for its stated reason: a planned SKU that is not a live part of the category; a
//     planned part that is no longer hardware; --commit without --approved; a --to that is not a plan class; an unknown argument; a plan
//     list that matches zero;
//   * THE COMMIT changes exactly the planned parts in ONE run of kind `class-change` (succeeded, no gate — it writes no fact), sets a
//     reason the reclassify catch-up pass does not own, leaves every other part and every fact byte-identical, writes the run id into
//     exactly the plans it carried out, and verifies from a new connection;
//   * a second commit is refused (nothing pending) and opens no run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { ownedReason } from "../../src/pipeline/reclassify.js";

if (process.env.NETZSPEC_DB !== "test") { console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)"); process.exit(1); }
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`class-change.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "class-change.mts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let pass = 0, sabotages = 0;
const misses: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 600)}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "class-change-"));
const planPath = path.join(tmp, "plans.json");
const run = (...args: string[]) => { const r = spawnSync(TSX, [SCRIPT, "--plans-file", planPath, ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;

// fixture
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const catId = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
const PARTS: [string, string, string][] = [
  ["ZZ-LIC-1", "security", "hardware"], ["ZZ-LIC-2", "security", "hardware"],   // planned security -> license
  ["ZZ-HW-1", "security", "hardware"],                                          // no plan
  ["ZZ-NP-1", "security", "hardware"],                                          // planned security -> non_product (another --to)
  ["ZZ-LIC-W", "wireless", "hardware"],                                         // planned wireless -> license (another category)
];
for (const [sku, cat, klass] of PARTS)
  await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, $5::product_class, 'category-is_hardware=true')`,
    [cisco, sku, `cisco-${sku.toLowerCase()}`, await catId(cat), klass]);
const planned = [
  { sku: "ZZ-LIC-1", category: "security", action: "class", to: "license", run_id: null, reason: "licence PID filed as hardware" },
  { sku: "ZZ-LIC-2", category: "security", action: "class", to: "license", run_id: null, reason: "licence PID filed as hardware" },
  { sku: "ZZ-NP-1", category: "security", action: "class", to: "non_product", run_id: null, reason: "datasheet cell" },
  { sku: "ZZ-LIC-W", category: "wireless", action: "class", to: "license", run_id: null, reason: "licence PID filed as hardware" },
  { sku: "ZZ-HW-1", category: "security", action: "move", to: "routers", run_id: null, reason: "a move plan is not a class plan" },
];
fs.writeFileSync(planPath, JSON.stringify(planned, null, 1) + "\n");
type State = { sku: string; product_class: string; product_class_reason: string | null; updated_at: string };
const states = async () => new Map((await query<State>("SELECT sku, product_class::text AS product_class, product_class_reason, updated_at::text AS updated_at FROM parts")).rows.map((r) => [r.sku, r]));
const before = await states();

// the dry run
{
  const r = run("--plans", "--category", "security", "--to", "license");
  check("dry run: exits 0, says DRY RUN and lists the two planned parts (not the non_product, wireless or move plans)",
    r.status === 0 && /DRY RUN/.test(r.out) && /ZZ-LIC-1/.test(r.out) && /ZZ-LIC-2/.test(r.out) && !/ZZ-NP-1|ZZ-LIC-W|ZZ-HW-1/.test(r.out) && /2 part\(s\) -> license/.test(r.out), r.out.slice(-500));
  sabotages++;
  const after = await states();
  check("SABOTAGE dry run: not one part changed and no run row was opened",
    [...before].every(([s, b]) => JSON.stringify(b) === JSON.stringify(after.get(s))) && (await count("SELECT count(*)::int AS n FROM runs")) === 0);
}

// the refusals, each before any write
{
  const refusal = async (name: string, args: string[], why: RegExp, mutate?: () => void | Promise<void>, undo?: () => void | Promise<void>) => {
    if (mutate) await mutate();
    const r = run(...args);
    if (undo) await undo();
    sabotages++;
    check(`SABOTAGE ${name}: refused for the stated reason, nothing written`, r.status !== 0 && why.test(r.out) && (await count("SELECT count(*)::int AS n FROM runs")) === 0, r.out.slice(-300));
  };
  await refusal("--commit without --approved", ["--plans", "--category", "security", "--to", "license", "--commit"], /--commit needs --approved/);
  await refusal("a --to that no plan may set", ["--plans", "--category", "security", "--to", "hardware"], /not a class a plan may set/);
  await refusal("an unknown argument", ["--plans", "--category", "security", "--to", "license", "--sku", "ZZ-LIC-1"], /unexpected argument --sku/);
  await refusal("a plan list that matches zero", ["--plans", "--category", "routers", "--to", "license"], /no pending class plan routers -> license/);
  await refusal("a planned SKU that is not a live part of the category", ["--plans", "--category", "security", "--to", "license", "--commit", "--approved", "test"], /not a live part of security: ZZ-LIC-2/,
    () => query("UPDATE parts SET retired_at = now(), retired_reason = 'class-change test: a retired planned part' WHERE sku = 'ZZ-LIC-2'").then(() => undefined),
    () => query("UPDATE parts SET retired_at = NULL, retired_reason = NULL WHERE sku = 'ZZ-LIC-2'").then(() => undefined));
  await refusal("a planned part that is no longer hardware", ["--plans", "--category", "security", "--to", "license", "--commit", "--approved", "test"], /no longer hardware: ZZ-LIC-1 \(software\)/,
    () => query("UPDATE parts SET product_class = 'software' WHERE sku = 'ZZ-LIC-1'").then(() => undefined), () => query("UPDATE parts SET product_class = 'hardware' WHERE sku = 'ZZ-LIC-1'").then(() => undefined));
  const plansNow = JSON.parse(fs.readFileSync(planPath, "utf8"));
  check("the refusals left the plan file untouched", JSON.stringify(plansNow) === JSON.stringify(planned));
}

// the commit
const beforeCommit = await states();
{
  // (no spaces: the Windows shell spawn splits an unquoted argument, and the script then refuses the stray word — as it should)
  const r = run("--plans", "--category", "security", "--to", "license", "--commit", "--approved", "operator-test-yes");
  const after = await states();
  check("commit: exits 0, names the run and verifies from a new connection", r.status === 0 && /COMMITTED run \d+/.test(r.out) && /2 of 2 now license; still hardware \(must be 0\): 0; selector re-run \(must be 0\): 0/.test(r.out), r.out.slice(-600));
  const runs = (await query<{ id: number; kind: string; status: string; gate: unknown; stats: Record<string, unknown>; inputs: Record<string, unknown> }>("SELECT id, kind, status::text AS status, gate, stats, inputs FROM runs")).rows;
  check("commit: exactly one run, kind class-change, succeeded, no gate, the approval and the plan file's hash recorded",
    runs.length === 1 && runs[0].kind === "class-change" && runs[0].status === "succeeded" && runs[0].gate === null && runs[0].inputs.approved === "operator-test-yes" && typeof (runs[0].inputs.plans_file as { sha256?: string }).sha256 === "string", runs);
  check("commit: the planned parts are licences with a class-plan reason", ["ZZ-LIC-1", "ZZ-LIC-2"].every((s) => after.get(s)!.product_class === "license" && /^class-plan:license: licence PID filed as hardware$/.test(after.get(s)!.product_class_reason ?? "")));
  sabotages++;
  check("SABOTAGE commit: the unplanned part, the other --to and the other category are byte-identical", ["ZZ-HW-1", "ZZ-NP-1", "ZZ-LIC-W"].every((s) => JSON.stringify(after.get(s)) === JSON.stringify(beforeCommit.get(s))));
  sabotages++;
  check("SABOTAGE commit: the reason is not one the reclassify catch-up pass owns (it will not promote the row back)", !ownedReason(after.get("ZZ-LIC-1")!.product_class_reason));
  const plansNow = JSON.parse(fs.readFileSync(planPath, "utf8")) as { sku: string; run_id: unknown }[];
  check("commit: the run id is written into exactly the two plans it carried out", plansNow.filter((p) => p.run_id === runs[0].id).map((p) => p.sku).sort().join() === "ZZ-LIC-1,ZZ-LIC-2" && plansNow.filter((p) => p.run_id !== null).length === 2);
  check("commit: it writes no fact (the facts table is as empty as before)", (await count("SELECT count(*)::int AS n FROM facts")) === 0);
}

// idempotence
{
  const r = run("--plans", "--category", "security", "--to", "license", "--commit", "--approved", "again");
  sabotages++;
  check("SABOTAGE second commit: refused — no pending plan is left — and no second run opened", r.status !== 0 && /no pending class plan security -> license/.test(r.out) && (await count("SELECT count(*)::int AS n FROM runs")) === 1, r.out.slice(-300));
}

await query("TRUNCATE parts, runs CASCADE");
await closePool();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
