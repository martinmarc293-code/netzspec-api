// tests/db/retract-inherited.test.ts — proof for scripts/retract-inherited.mts, the fact half of a class plan, and for the guard it put
// into scripts/class-change.mts (layers round 3, operator, 15 Sep 2026: "retract-inherited → class-change → verify").
//
//   NETZSPEC_DB=test npx tsx tests/db/retract-inherited.test.ts
//
// What is proved:
//   * THE DRY RUN WRITES NOTHING — no fact, no conflict resolution, no `runs` row — and names what it would retract, what it leaves (the
//     own values, printed with their source; the gap rows an earlier retraction left and an inherited row holding no value, both counted
//     apart from the own values) and the conflicts it would resolve or leave open;
//   * SABOTAGE — each refusal happens before any write, for its stated reason: --commit without --approved, an unknown argument, a --to no
//     plan may set, a plan list that matches zero, a planned part that is a family carrier, a planned SKU that is not live, a planned part
//     no longer hardware, a fact-free group (nothing to retract: a commit opens no run), and the gate's suites replaced against a database
//     that is not a test database;
//   * SABOTAGE the gate: a class the store's inheritance rule does not refuse (non_product) scores precision 0; a red suite scores recall 0;
//     either way a commit is refused and nothing is written;
//   * THE COMMIT, in ONE run of kind apply-retract-inherited (succeeded, gate passed): exactly the inherited value facts are superseded by
//     gap_unattempted rows of the run (method retracted:class_plan_not_hardware, inherited false, inherited_from kept) and nothing is
//     deleted; the own value, the earlier gap row, the inherited gap row, the unplanned part and the other plans' parts are byte-identical;
//     the open conflict on a retracted field is resolved and the one on an own field stays open; the parts stay hardware; the plan file
//     is untouched;
//   * SABOTAGE feed-back: the command's own output is not selected again — a second commit finds nothing and opens no run;
//   * THE CLASS-CHANGE GUARD: before the retraction class-change refuses the commit (its dry run exits 2) naming the inherited facts; after
//     it the class change commits, names the retraction run in its inputs and verifies that no inherited fact is served;
//   * partitionFacts refuses a state it does not know, and SERVED_STATES equals the API's RENDERED_STATES (a duplicated constant, checked).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { SERVED_STATES, partitionFacts, type PartFact } from "../../src/store/classPlans.js";
import { RENDERED_STATES } from "../../src/api/queries/shared.js";

if (process.env.NETZSPEC_DB !== "test") { console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)"); process.exit(1); }
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`retract-inherited.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let pass = 0, sabotages = 0;
const misses: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 900)}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retract-inherited-"));
const planPath = path.join(tmp, "plans.json");
const carriersPath = path.join(tmp, "carriers.json");
const greenSuite = path.join(tmp, "green-suite.mts");
const redSuite = path.join(tmp, "red-suite.mts");
fs.writeFileSync(greenSuite, "console.log(\"1/1 passed\");\n");
fs.writeFileSync(redSuite, "console.log(\"0/1 passed\");\nprocess.exit(1);\n");
const suites = (file: string) => JSON.stringify([{ name: path.basename(file, ".mts"), file, ok: "1/1 passed" }]);
type Env = Record<string, string | undefined>;
const spawn = (script: string, args: string[], env: Env = process.env) => {
  const r = spawnSync(TSX, [path.join(ROOT, "scripts", script), "--plans-file", planPath, "--carriers-file", carriersPath, ...args], { cwd: ROOT, env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const retract = (...args: string[]) => spawn("retract-inherited.mts", args);
const retractWith = (env: Env, ...args: string[]) => spawn("retract-inherited.mts", args, { ...process.env, ...env });
const classChange = (...args: string[]) => spawn("class-change.mts", args);
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;
const runsOf = (kind: string) => count("SELECT count(*)::int AS n FROM runs WHERE kind = $1", [kind]);

// ---- fixture ----------------------------------------------------------------------------------------------------------------------------
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const catId = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
for (const [sku, cat] of [["ZZ-LIC-1", "routers"], ["ZZ-LIC-2", "routers"], ["ZZ-HW-1", "routers"], ["ZZ-SW-1", "routers"], ["ZZ-NP-1", "routers"], ["ZZ-SVC-1", "routers"], ["ZZ-CAR-1", "switches"]])
  await query(`INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason) VALUES ($1, $2, $3, $4, 'hardware', 'category-is_hardware=true')`,
    [cisco, sku, `cisco-${sku.toLowerCase()}`, await catId(cat)]);
for (const [id, url] of [["zzfixturefamily01", "https://example.test/family-datasheet"], ["zzfixtureown00002", "https://example.test/own-datasheet"]])
  await query("INSERT INTO source_docs (doc_id, url, doc_type, vendor_id, title) VALUES ($1, $2, 'vendor_datasheet_html', $3, $4)", [id, url, cisco, `fixture ${id}`]);
const fact = async (sku: string, key: string, o: { value?: unknown; state: string; inherited: boolean; method?: string; doc?: string }) =>
  (await query<{ id: string }>(
    `INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id, inherited, inherited_from)
     VALUES ((SELECT id FROM parts WHERE sku = $1), $2, $3::jsonb, $4, $5::fact_state, 2, $6, $7, $8, $9) RETURNING id::text AS id`,
    [sku, key, o.value === undefined ? null : JSON.stringify(o.value), o.value === undefined ? "" : JSON.stringify(o.value), o.state,
      o.method ?? "html_table", o.doc ?? null, o.inherited, o.inherited ? "zz-family-scope" : null])).rows[0].id;
const FAM = "zzfixturefamily01", OWN = "zzfixtureown00002";
const F = {
  weight1: await fact("ZZ-LIC-1", "weight", { value: 4.2, state: "verified", inherited: true, doc: FAM }),                    // retract (served)
  temp1: await fact("ZZ-LIC-1", "temp_operating", { value: { min: 0, max: 40 }, state: "corroborated", inherited: true, doc: FAM }), // retract (served)
  power1: await fact("ZZ-LIC-1", "power_max", { value: 250, state: "conflict", inherited: true, doc: FAM }),                  // retract (held)
  rack1: await fact("ZZ-LIC-1", "rack_units", { value: 1, state: "verified", inherited: false, doc: OWN }),                   // own value: stays
  alt1: await fact("ZZ-LIC-1", "altitude_max", { state: "gap_unattempted", inherited: false, method: "retracted:family:mismatch" }), // earlier gap: stays
  cert2: await fact("ZZ-LIC-2", "certifications", { value: ["CE"], state: "unverified", inherited: true }),                  // retract (not served)
  psu2: await fact("ZZ-LIC-2", "psu_count", { state: "gap_unattempted", inherited: true }),                                  // inherited, no value: stays
  weightHw: await fact("ZZ-HW-1", "weight", { value: 9, state: "verified", inherited: true, doc: FAM }),                     // no plan: stays
  weightSw: await fact("ZZ-SW-1", "weight", { value: 9, state: "verified", inherited: true, doc: FAM }),                     // software plan: stays
  weightNp: await fact("ZZ-NP-1", "weight", { value: 9, state: "verified", inherited: true, doc: FAM }),                     // non_product plan: stays
  weightCar: await fact("ZZ-CAR-1", "weight", { value: 9, state: "verified", inherited: true, doc: FAM }),                   // carrier: stays
};
const conflict = async (sku: string, key: string) => (await query<{ id: string }>(
  "INSERT INTO conflicts (part_id, field_key, kept, rejected, reason) VALUES ((SELECT id FROM parts WHERE sku = $1), $2, '1'::jsonb, '2'::jsonb, 'fixture disagreement') RETURNING id::text AS id",
  [sku, key])).rows[0].id;
const C = { onRetracted: await conflict("ZZ-LIC-1", "power_max"), onOwn: await conflict("ZZ-LIC-1", "rack_units") };
const plans = [
  { sku: "ZZ-LIC-1", category: "routers", action: "class", to: "license", run_id: null, reason: "licence PID filed as hardware" },
  { sku: "ZZ-LIC-2", category: "routers", action: "class", to: "license", run_id: null, reason: "licence PID filed as hardware" },
  { sku: "ZZ-SW-1", category: "routers", action: "class", to: "software", run_id: null, reason: "software PID filed as hardware" },
  { sku: "ZZ-NP-1", category: "routers", action: "class", to: "non_product", run_id: null, reason: "an ordering artefact" },
  { sku: "ZZ-SVC-1", category: "routers", action: "class", to: "service", run_id: null, reason: "a service PID with no facts" },
  { sku: "ZZ-CAR-1", category: "switches", action: "class", to: "license", run_id: null, reason: "a carrier the plan should never have named" },
  { sku: "ZZ-HW-1", category: "routers", action: "move", to: "switches", run_id: null, reason: "a move plan is not a class plan" },
];
fs.writeFileSync(planPath, JSON.stringify(plans, null, 1) + "\n");
fs.writeFileSync(carriersPath, JSON.stringify({ carriers: [{ sku: "ZZ-CAR-1" }] }, null, 1) + "\n");
type FactSnap = Record<string, string>;
const factSnap = async (): Promise<FactSnap> => Object.fromEntries((await query<{ id: string; row: string }>(
  "SELECT id::text AS id, row_to_json(f)::text AS row FROM (SELECT id, part_id, field_key, value, raw, state, tier, method, inherited, inherited_from, doc_id, run_id, superseded_by FROM facts) f")).rows.map((r) => [r.id, r.row]));
const conflictSnap = async () => JSON.stringify((await query("SELECT id, resolved_at, resolution, resolved_by FROM conflicts ORDER BY id")).rows);
const clean = { facts: await factSnap(), conflicts: await conflictSnap() };
const untouched = async () => JSON.stringify(await factSnap()) === JSON.stringify(clean.facts) && (await conflictSnap()) === clean.conflicts;

// ---- the shared partition and its drift check --------------------------------------------------------------------------------------------
check("SERVED_STATES in src/store/classPlans.ts equals the API's RENDERED_STATES", JSON.stringify([...SERVED_STATES]) === JSON.stringify([...RENDERED_STATES]));
{
  sabotages++;
  let threw = "";
  try { partitionFacts([{ id: "1", part_id: "1", sku: "X", field_key: "weight", value: 1, raw: "1", state: "mystery", tier: 2, method: "m", inherited: true, inherited_from: null, doc_id: null, doc_url: null, doc_title: null, doc_type: null, run_id: null } as PartFact]); }
  catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check("SABOTAGE partitionFacts refuses a state that is neither a value nor a gap state", /neither a value nor a gap state/.test(threw), threw);
}

// ---- the dry run ------------------------------------------------------------------------------------------------------------------------
{
  const r = retract("--plans", "--category", "routers", "--to", "license");
  check("dry run: exits 0 and names the 4 inherited value facts on 2 parts, 2 of them served",
    r.status === 0 && /DRY RUN/.test(r.out) && /inherited value facts to retract: 4 on 2 of 2 part\(s\) — served 2/.test(r.out), r.out.slice(-1500));
  check("dry run: the own value is printed with its source, and counted apart from the gap rows",
    /own values, NOT touched \(the operator reads these\): 1 \(served 1\)/.test(r.out) && /ZZ-LIC-1\s+rack_units\s+verified/.test(r.out) && /https:\/\/example\.test\/own-datasheet/.test(r.out)
      && /gap rows earlier retractions left, NOT touched \(no value, not served\): 1/.test(r.out) && /inherited rows holding no value, not selected: 1/.test(r.out), r.out.slice(-1500));
  check("dry run: one open conflict resolved with the retraction, one left open", /resolved with the retraction: 1/.test(r.out) && /left open: 1/.test(r.out), r.out.slice(-1500));
  check("dry run: the gate passed, with the real suites run fresh", /"passed":true/.test(r.out) && /"specMerge":\{"ok":true/.test(r.out) && /"layersStanding":\{"ok":true/.test(r.out), r.out.slice(-1500));
  check("dry run: the unplanned part and the other plans are not named", !/ZZ-HW-1|ZZ-SW-1|ZZ-NP-1|ZZ-CAR-1/.test(r.out));
  sabotages++;
  check("SABOTAGE dry run: not one fact or conflict changed and no run row was opened", (await untouched()) && (await count("SELECT count(*)::int AS n FROM runs")) === 0);
}

// ---- the refusals, each before any write ------------------------------------------------------------------------------------------------
{
  const refusal = async (name: string, r: () => { status: number | null; out: string }, why: RegExp, mutate?: () => Promise<unknown>, undo?: () => Promise<unknown>) => {
    if (mutate) await mutate();
    const res = r();
    if (undo) await undo();
    sabotages++;
    check(`SABOTAGE ${name}: refused for the stated reason, nothing written`, res.status !== 0 && why.test(res.out) && (await count("SELECT count(*)::int AS n FROM runs")) === 0 && (await untouched()), res.out.slice(-400));
  };
  const commitArgs = (cat: string, to: string) => ["--plans", "--category", cat, "--to", to, "--commit", "--approved", "operator-test-yes"];
  await refusal("--commit without --approved", () => retract("--plans", "--category", "routers", "--to", "license", "--commit"), /--commit needs --approved/);
  await refusal("an unknown argument", () => retract("--plans", "--category", "routers", "--to", "license", "--sku", "ZZ-LIC-1"), /unexpected argument --sku/);
  await refusal("a --to that no plan may set", () => retract("--plans", "--category", "routers", "--to", "hardware"), /not a class a plan may set/);
  await refusal("a plan list that matches zero", () => retract("--plans", "--category", "switches", "--to", "software"), /no pending class plan switches -> software/);
  await refusal("a planned part that is a family carrier", () => retract(...commitArgs("switches", "license")), /family carriers \(carriers\.json\): ZZ-CAR-1/);
  await refusal("a planned SKU that is not a live part of the category", () => retract(...commitArgs("routers", "license")), /not a live part of routers: ZZ-LIC-2/,
    () => query("UPDATE parts SET retired_at = now(), retired_reason = 'retract-inherited test: a retired planned part' WHERE sku = 'ZZ-LIC-2'"),
    () => query("UPDATE parts SET retired_at = NULL, retired_reason = NULL WHERE sku = 'ZZ-LIC-2'"));
  await refusal("a planned part that is no longer hardware", () => retract(...commitArgs("routers", "license")), /no longer hardware: ZZ-LIC-1 \(software\)/,
    () => query("UPDATE parts SET product_class = 'software' WHERE sku = 'ZZ-LIC-1'"), () => query("UPDATE parts SET product_class = 'hardware' WHERE sku = 'ZZ-LIC-1'"));
  await refusal("a fact-free group (nothing to retract) on --commit", () => retract(...commitArgs("routers", "service")), /nothing to retract — no current inherited value fact on the 1 planned part/);
  const dry = retract("--plans", "--category", "routers", "--to", "service");
  check("a fact-free group's dry run exits 0 and says class-change may run", dry.status === 0 && /Nothing to retract: class-change\.mts may run for routers -> service/.test(dry.out), dry.out.slice(-300));
  // an unreachable URL whose name is NOT a test name. (The first version said netzspec_not_a_test — which ends in _test, so the repo's
  // own rule calls it a test database, the guard let it through, and only the closed port stopped the script.)
  const notTest: Env = { ...process.env, DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/netzspec_production_probe", RETRACT_INHERITED_SUITES: suites(greenSuite) };
  delete notTest.NETZSPEC_DB;
  await refusal("the gate's suites replaced against a database that is not a test database", () => spawn("retract-inherited.mts", ["--plans", "--category", "routers", "--to", "license"], notTest), /may be replaced on a test database only/);
  const plansNow = JSON.parse(fs.readFileSync(planPath, "utf8"));
  check("the refusals left the plan file untouched", JSON.stringify(plansNow) === JSON.stringify(plans));
}

// ---- the gate, sabotaged ----------------------------------------------------------------------------------------------------------------
{
  const np = retractWith({ RETRACT_INHERITED_SUITES: suites(greenSuite) }, "--plans", "--category", "routers", "--to", "non_product");
  sabotages++;
  check("SABOTAGE gate: non_product is not refused by the store's inheritance rule, so precision is 0 and the dry run exits 2",
    np.status === 2 && /"precision":0,/.test(np.out) && /"not_refused_by_store_rule":1/.test(np.out) && /a commit would be refused/.test(np.out), np.out.slice(-900));
  const npCommit = retractWith({ RETRACT_INHERITED_SUITES: suites(greenSuite) }, "--plans", "--category", "routers", "--to", "non_product", "--commit", "--approved", "operator-test-yes");
  sabotages++;
  check("SABOTAGE gate: the non_product commit is refused and writes nothing", npCommit.status !== 0 && /the gate did not pass/.test(npCommit.out) && (await runsOf("apply-retract-inherited")) === 0 && (await untouched()), npCommit.out.slice(-600));
  const red = retractWith({ RETRACT_INHERITED_SUITES: suites(redSuite) }, "--plans", "--category", "routers", "--to", "software", "--commit", "--approved", "operator-test-yes");
  sabotages++;
  check("SABOTAGE gate: a red suite scores recall 0 and the commit is refused, nothing written",
    red.status !== 0 && /"recall":0,/.test(red.out) && /"red-suite":\{"ok":false/.test(red.out) && /the gate did not pass/.test(red.out) && (await runsOf("apply-retract-inherited")) === 0 && (await untouched()), red.out.slice(-900));
}

// ---- class-change before the retraction: refused ----------------------------------------------------------------------------------------
{
  const dry = classChange("--plans", "--category", "routers", "--to", "license");
  check("class-change dry run before the retraction exits 2 and names the inherited facts",
    dry.status === 2 && /a commit would be refused: 4 inherited value fact\(s\) \(served 2\) are still current/.test(dry.out) && /retract-inherited\.mts --plans --category routers --to license/.test(dry.out), dry.out.slice(-700));
  const c = classChange("--plans", "--category", "routers", "--to", "license", "--commit", "--approved", "operator-test-yes");
  sabotages++;
  check("SABOTAGE class-change commit before the retraction: refused, no run, the parts still hardware",
    c.status !== 0 && /REFUSED: 4 inherited value fact\(s\)/.test(c.out) && (await runsOf("class-change")) === 0
      && (await count("SELECT count(*)::int AS n FROM parts WHERE sku IN ('ZZ-LIC-1', 'ZZ-LIC-2') AND product_class = 'hardware'")) === 2, c.out.slice(-500));
}

// ---- the commit -------------------------------------------------------------------------------------------------------------------------
let runId = 0;
{
  const r = retract("--plans", "--category", "routers", "--to", "license", "--commit", "--approved", "operator-test-yes");
  check("commit: exits 0, names the run, and verifies from a new connection",
    r.status === 0 && /COMMITTED run \d+: retracted 4 inherited value fact\(s\) on 2 part\(s\) of routers -> license; conflicts resolved 1/.test(r.out)
      && /inherited value facts left \(must be 0\): 0; served inherited \(must be 0\): 0; retraction rows of run \d+: 4 of 4, superseding the listed facts: 4; own values the same rows: true \(1\); earlier gap rows the same rows: true \(2\); open conflicts on retracted fields \(must be 0\): 0, resolved by this run: 1 of 1; parts still hardware: 2 of 2; selector re-run \(must be 0\): 0/.test(r.out)
      && !/did not verify/.test(r.out), r.out.slice(-1500));
  const runs = (await query<{ id: number; kind: string; status: string; gate: Record<string, unknown> | null; inputs: Record<string, unknown>; stats: Record<string, unknown> }>("SELECT id, kind, status::text AS status, gate, inputs, stats FROM runs")).rows;
  runId = runs[0]?.id ?? 0;
  check("commit: exactly one run, apply-retract-inherited, succeeded, gate passed at precision 1 and recall 1, the approval and the plan file's hash recorded",
    runs.length === 1 && runs[0].kind === "apply-retract-inherited" && runs[0].status === "succeeded" && runs[0].gate?.passed === true && runs[0].gate?.precision === 1 && runs[0].gate?.recall === 1
      && runs[0].inputs.approved === "operator-test-yes" && typeof (runs[0].inputs.plans_file as { sha256?: string }).sha256 === "string" && (runs[0].inputs.fact_ids as string[]).length === 4, runs);
  const after = await factSnap();
  const retracted = [F.weight1, F.temp1, F.power1, F.cert2];
  type Row = { id: number; part_id: number; field_key: string; value: unknown; raw: string; state: string; method: string; inherited: boolean; inherited_from: string | null; run_id: number | null; superseded_by: number | null };
  const row = (id: string | number) => JSON.parse(after[String(id)]) as Row;
  check("commit: nothing deleted — every row of before is still there", Object.keys(clean.facts).every((id) => id in after) && Object.keys(after).length === Object.keys(clean.facts).length + 4);
  check("commit: each inherited value fact is superseded by a gap row of the run (gap_unattempted, retracted:class_plan_not_hardware, inherited false, inherited_from kept, no value)",
    retracted.every((id) => {
      const old = row(id), nw = old.superseded_by === null ? null : row(old.superseded_by);
      return nw !== null && nw.run_id === runId && nw.state === "gap_unattempted" && nw.method === "retracted:class_plan_not_hardware" && nw.inherited === false
        && nw.inherited_from === "zz-family-scope" && nw.value === null && nw.field_key === old.field_key && nw.part_id === old.part_id && nw.superseded_by === null;
    }), retracted.map((id) => after[id]));
  sabotages++;
  check("SABOTAGE commit: the own value, the earlier gap row, the inherited gap row, the unplanned part and the other plans' parts are byte-identical",
    [F.rack1, F.alt1, F.psu2, F.weightHw, F.weightSw, F.weightNp, F.weightCar].every((id) => after[id] === clean.facts[id]));
  const cs = (await query<{ id: string; resolved_at: string | null; resolution: string | null; resolved_by: string | null }>("SELECT id::text AS id, resolved_at::text AS resolved_at, resolution, resolved_by FROM conflicts")).rows;
  const onRetracted = cs.find((c) => c.id === C.onRetracted)!, onOwn = cs.find((c) => c.id === C.onOwn)!;
  check("commit: the open conflict on the retracted field is resolved as remerge resolves one under a retraction; the one on the own field stays open",
    onRetracted.resolved_at !== null && onRetracted.resolution === "rule:inheritance_retracted:class_plan_not_hardware" && onRetracted.resolved_by === `retract-inherited#${runId}`
      && onOwn.resolved_at === null && onOwn.resolution === null, cs);
  check("commit: the planned parts are still hardware (the class is class-change's half)", (await count("SELECT count(*)::int AS n FROM parts WHERE sku IN ('ZZ-LIC-1', 'ZZ-LIC-2') AND product_class = 'hardware'")) === 2);
  check("commit: the plan file is untouched (the retraction marks no plan)", JSON.stringify(JSON.parse(fs.readFileSync(planPath, "utf8"))) === JSON.stringify(plans));
}

// ---- its own output is never selected again ---------------------------------------------------------------------------------------------
{
  const r = retract("--plans", "--category", "routers", "--to", "license", "--commit", "--approved", "again");
  sabotages++;
  check("SABOTAGE feed-back: a second commit finds nothing to retract and opens no second run", r.status !== 0 && /nothing to retract/.test(r.out) && (await runsOf("apply-retract-inherited")) === 1, r.out.slice(-400));
}

// ---- class-change after the retraction: commits, names the retraction, serves no inherited fact ------------------------------------------
{
  const dry = classChange("--plans", "--category", "routers", "--to", "license");
  check("class-change dry run after the retraction exits 0 and names the retraction run", dry.status === 0 && new RegExp(`inherited facts retracted by run ${runId}`).test(dry.out), dry.out.slice(-500));
  const c = classChange("--plans", "--category", "routers", "--to", "license", "--commit", "--approved", "operator-test-yes");
  check("class-change commit after the retraction: verified, no inherited fact served, the own value still served and counted",
    c.status === 0 && /2 of 2 now license; still hardware \(must be 0\): 0; selector re-run \(must be 0\): 0; served inherited facts \(must be 0\): 0; own values still served \(the operator's list\): 1/.test(c.out), c.out.slice(-900));
  const run = (await query<{ inputs: Record<string, unknown> }>("SELECT inputs FROM runs WHERE kind = 'class-change'")).rows;
  check("class-change: one run, and its inputs name the retraction run", run.length === 1 && run[0].inputs.retraction_run === String(runId), run);
}

await query("TRUNCATE facts, fact_evidence, conflicts, parts, source_docs, runs CASCADE");
await closePool();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
