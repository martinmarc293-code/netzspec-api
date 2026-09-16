// tests/db/reclassify.test.ts — proof for src/pipeline/reclassify.ts, the catch-up pass that
// re-runs the product-class rule table over parts that already exist.
//
//   NETZSPEC_DB=test DATABASE_URL_TEST=postgres://…/netzspec_test3 npx tsx tests/db/reclassify.test.ts
//
// What is proved, and why each one is here rather than assumed:
//   * PURE: plan() splits the catalogue into changed / unchanged / reason-only, counts per rule and
//     keeps at most N examples per rule; updateGroups() folds the changes into one statement per
//     (class, reason) pair.
//   * DRY RUN WRITES NOTHING — not a part, not a `runs` row. A dry run that quietly opened a run
//     would break "never write outside a run" from the other side: a run row nobody closed.
//   * A COMMIT writes exactly the planned rows inside ONE run of kind `reclassify`, whose stats and
//     notes carry the per-rule counts, and is idempotent (a second commit changes nothing and opens
//     no run at all).
//   * SABOTAGE, the whole point of the command being conservative:
//       - a part whose class does NOT change is not written: its updated_at is byte-identical
//         afterwards, so the change feed does not see 89,000 phantom updates;
//       - a part whose class is right but whose REASON is stale is counted as reason_only and is
//         NOT written (the old reason survives) — a silent rewrite of provenance is worse than a
//         reported drift;
//       - the four rules rejected in round 2 are each represented by a real part that would have
//         been swallowed (Arista A-D800-D800-7M, 15454-AR-MXP-LIC, C1-N9K-C9508, 10-2834-01), and
//         every one must still be `hardware` after a commit;
//       - an unknown argument is refused NAMING it, and the refusal happens before any write.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { plan, updateGroups, ruleOf, ownedReason, parseArgs, statsOf, type PartRow } from "../../src/pipeline/reclassify.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`reclassify.test: database ${dbName}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "src", "pipeline", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}
function cli(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(TSX, [CLI, "reclassify", ...args], { cwd: ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const count = async (sql: string, params: unknown[] = []) => (await query<{ n: number }>(sql, params)).rows[0].n;

// =================================================================================================
// pure: the plan, with no database in sight
// =================================================================================================
{
  const rows: PartRow[] = [
    { id: 1, sku: "C9200-DNX-A-24-3Y", name: null, vendor: "cisco", category: "switches", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:switches" },
    { id: 2, sku: "C9200-DNX-A-48-3Y", name: null, vendor: "cisco", category: "switches", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:switches" },
    { id: 3, sku: "C9200L-24P-4G", name: null, vendor: "cisco", category: "switches", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:switches" },
    { id: 4, sku: "L-C9200-24-E-A", name: null, vendor: "cisco", category: "switches", is_hardware: true, product_class: "license", product_class_reason: "category:legacy-import" },
    { id: 5, sku: "SW-CCME-UL-ENH", name: null, vendor: "cisco", category: "unified-communications", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:unified-communications" },
    { id: 6, sku: "0.75K", name: null, vendor: "cisco", category: "switches", is_hardware: true, product_class: "unknown", product_class_reason: "catalogue-noise: fails is_part_number" },
    { id: 7, sku: "15.0.1M", name: null, vendor: "cisco", category: "routers", is_hardware: true, product_class: "unknown", product_class_reason: null },
  ];
  const p = plan(rows, 1);
  check("plan: 3 changes, 1 unchanged, 1 reason-only", p.changes.length === 3 && p.unchanged === 1 && p.reason_only === 1, statsOf(p, 0));
  check("plan: per-rule counts name the rule that fired and keep at most `examples` examples",
    p.by_rule["sku-contains:-DNX-"]?.count === 2 && p.by_rule["sku-contains:-DNX-"].examples.length === 1 && p.by_rule["sku-prefix:SW-"]?.count === 1, p.by_rule);
  check("plan: the transition is recorded both per rule and overall",
    p.by_transition["hardware->license"] === 2 && p.by_transition["hardware->software"] === 1
    && p.by_rule["sku-prefix:SW-"].transitions["hardware->software"] === 1, p.by_transition);
  check("plan: the reason-only part is listed with its new rule and is NOT in changes",
    p.reason_only_by_rule["sku-prefix:L-"]?.count === 1 && !p.changes.some((c) => c.sku === "L-C9200-24-E-A"), p.reason_only_by_rule);
  sabotages++;
  // `would_become` was `unknown->hardware` when this was written, and is `unknown->non_product` now (16 Sep 2026). Nothing about
  // the GUARD changed — both rows are still counted foreign and still left alone, which is what the case is for. What changed is
  // the hypothetical beside them: `classify` itself has since learned that a SKU failing `is_part_number` is not a product, so
  // the header's own story ("a blind recompute promoted every one of them back to `hardware` — 0.375K, 0.75K, 15.0.1M,
  // quantities and IOS releases") no longer describes what the classifier would do. The clause is kept rather than deleted
  // because it proves the planner COMPUTED the hypothetical instead of skipping the row — and a regression to `hardware` would
  // now fail here loudly, which is the alarm the original author wanted.
  check("SABOTAGE plan: a class this table did NOT decide is left alone — the 772 catalogue-noise parts are not promoted back to hardware",
    p.foreign_reason === 2 && !p.changes.some((c) => c.sku === "0.75K" || c.sku === "15.0.1M")
    && p.foreign_by_reason["catalogue-noise: fails is_part_number"]?.count === 1
    && p.foreign_by_reason["catalogue-noise: fails is_part_number"].would_become["unknown->non_product"] === 1
    && p.foreign_by_reason["(null)"]?.count === 1, p.foreign_by_reason);
  check("ownedReason: a reason this table emits is owned; a hygiene reason and NULL are not",
    ownedReason("sku-prefix:L-") && ownedReason("category-is_hardware=true:switches") && ownedReason("empty-sku")
    && !ownedReason("catalogue-noise: fails is_part_number") && !ownedReason(null) && !ownedReason("category:legacy-import"));
  const groups = updateGroups(p.changes);
  check("updateGroups: one group per (class, reason), ids folded into it",
    groups.length === 2 && groups.find((g) => g.reason === "sku-contains:-DNX-")?.ids.join() === "1,2", groups);
  check("ruleOf: a category reason groups under its rule, not its slug", ruleOf("category-is_hardware=true:switches") === "category-is_hardware=true" && ruleOf("sku-prefix:SW-") === "sku-prefix:SW-");
  sabotages++;
  let refused = "";
  try { parseArgs(["--nope"]); } catch (e) { refused = (e as Error).message; }
  check("SABOTAGE parseArgs: an unknown argument is refused NAMING it", /unexpected argument --nope/.test(refused), refused);
  check("parseArgs: the default is a dry run", parseArgs([]).commit === false && parseArgs(["--commit"]).commit === true);
}

// =================================================================================================
// fixture
// =================================================================================================
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);

const vendorId = async (slug: string) => (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = $1", [slug])).rows[0].id;
const catId = async (slug: string) => (await query<{ id: number }>("SELECT id FROM categories WHERE slug = $1", [slug])).rows[0].id;
const cisco = await vendorId("cisco");
const arista = await vendorId("arista");

/** [sku, vendor, category, the class the row holds TODAY, the reason it holds today] */
const FIXTURE: [string, number, string, string, string][] = [
  // must CHANGE: round-2 rules over parts created before those rules existed
  ["C9200-DNX-A-24-3Y", cisco, "switches", "hardware", "category-is_hardware=true:switches"],
  ["C9200-DNX-A-48-3Y", cisco, "switches", "hardware", "category-is_hardware=true:switches"],
  ["ISE-ADV-1YR-50K", cisco, "security", "hardware", "category-is_hardware=true:security"],
  ["A-FLEX-01-12.5-K9", cisco, "unified-communications", "hardware", "category-is_hardware=true:unified-communications"],
  ["SW-CCME-UL-ENH", cisco, "unified-communications", "hardware", "category-is_hardware=true:unified-communications"],
  ["SVS-CTIR-DUO-L", cisco, "servers-unified-computing", "hardware", "category-is_hardware=true:servers-unified-computing"],
  // must NOT change: real hardware, including the four anchors of the rejected round-2 rules
  ["C9200L-24P-4G", cisco, "switches", "hardware", "category-is_hardware=true:switches"],
  ["A-D800-D800-7M", arista, "transceiver", "hardware", "category-is_hardware=true:transceiver"],
  ["15454-AR-MXP-LIC", cisco, "optical-networking", "hardware", "category-is_hardware=true:optical-networking"],
  ["C1-N9K-C9508", cisco, "switches", "hardware", "category-is_hardware=true:switches"],
  ["10-2834-01", cisco, "optical-networking", "hardware", "category-is_hardware=true:optical-networking"],
  ["ISE-SNS-ACCYKIT", cisco, "security", "hardware", "category-is_hardware=true:security"],
  // class already right, reason stale: reason_only, never written
  ["L-C9200-24-E-A", cisco, "switches", "license", "category:legacy-import"],
  // decided by something OTHER than this rule table: the hygiene pass that classed 772 enumerated
  // quantities and IOS releases as `unknown`. A blind recompute promotes all of them to hardware.
  ["0.75K", cisco, "switches", "unknown", "catalogue-noise: fails is_part_number"],
  ["15.0.1M", cisco, "routers", "unknown", "catalogue-noise: fails is_part_number"],
];
for (const [sku, vendor, cat, klass, reason] of FIXTURE) {
  await query(
    `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason)
     VALUES ($1, $2, $3, $4, $5::product_class, $6)`,
    [vendor, sku, `${vendor}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, await catId(cat), klass, reason]);
}
const MUST_CHANGE = FIXTURE.slice(0, 6).map((f) => f[0]);
const MUST_NOT_CHANGE = FIXTURE.slice(6, 12).map((f) => f[0]);
const FOREIGN = ["0.75K", "15.0.1M"];

type PartState = { sku: string; product_class: string; product_class_reason: string | null; updated_at: string };
const states = async (): Promise<Map<string, PartState>> =>
  new Map((await query<PartState>("SELECT sku, product_class::text AS product_class, product_class_reason, updated_at::text AS updated_at FROM parts")).rows.map((r) => [r.sku, r]));
const before = await states();

// =================================================================================================
// the dry run writes nothing
// =================================================================================================
{
  const r = cli();
  const after = await states();
  check("dry run: exits 0 and says DRY RUN", r.status === 0 && /DRY RUN/.test(r.out), r.out.slice(-400));
  check(`dry run: reports the ${MUST_CHANGE.length} parts it would change and 1 reason-only`, /would change 6\b/.test(r.out) && /reason-only \(not written\) 1/.test(r.out), r.out.split("\n").slice(0, 6).join(" | "));
  sabotages++;
  check("SABOTAGE dry run: not one parts row moved (class, reason and updated_at all identical)",
    [...before].every(([sku, b]) => JSON.stringify(b) === JSON.stringify(after.get(sku))),
    [...before].filter(([sku, b]) => JSON.stringify(b) !== JSON.stringify(after.get(sku))).map(([s]) => s));
  sabotages++;
  check("SABOTAGE dry run: no `runs` row was opened either", (await count("SELECT count(*)::int AS n FROM runs")) === 0);
}

// =================================================================================================
// the commit
// =================================================================================================
{
  const r = cli("--commit");
  const after = await states();
  check("commit: exits 0 and names the run", r.status === 0 && /COMMITTED run \d+/.test(r.out), r.out.slice(-400));
  const run = (await query<{ id: number; kind: string; status: string; gate: unknown; stats: Record<string, unknown>; notes: string | null }>(
    "SELECT id, kind, status::text AS status, gate, stats, notes FROM runs ORDER BY id DESC LIMIT 1")).rows[0];
  check("commit: exactly one run, kind `reclassify`, closed succeeded", (await count("SELECT count(*)::int AS n FROM runs")) === 1 && run.kind === "reclassify" && run.status === "succeeded", run);
  check("commit: the run needs no gate (it writes no facts) and carries none", run.gate === null, run.gate);
  check("commit: stats carry the counts and the per-rule breakdown",
    run.stats.changed === 6 && run.stats.written === 6 && run.stats.reason_only === 1 && run.stats.scanned === FIXTURE.length
    && (run.stats.by_rule as Record<string, number>)["sku-contains:-DNX-"] === 2, run.stats);
  check("commit: the notes list every rule that fired with its examples",
    !!run.notes && /sku-contains:-DNX- -> license: 2/.test(run.notes) && /C9200-DNX-A-24-3Y/.test(run.notes) && /sku-prefix:SW- -> software: 1/.test(run.notes), (run.notes ?? "").slice(0, 400));

  check("commit: every part that had to change did, with the rule in its reason",
    MUST_CHANGE.every((sku) => after.get(sku)!.product_class !== before.get(sku)!.product_class && /^sku-/.test(after.get(sku)!.product_class_reason ?? "")),
    MUST_CHANGE.map((s) => [s, after.get(s)!.product_class, after.get(s)!.product_class_reason]));
  check("commit: the classes are the ones the table says (license / software / service)",
    after.get("C9200-DNX-A-24-3Y")!.product_class === "license" && after.get("SW-CCME-UL-ENH")!.product_class === "software"
    && after.get("SVS-CTIR-DUO-L")!.product_class === "service" && after.get("A-FLEX-01-12.5-K9")!.product_class === "license",
    MUST_CHANGE.map((s) => [s, after.get(s)!.product_class]));

  sabotages++;
  check("SABOTAGE commit: the six real-hardware anchors are untouched — same class, same reason, same updated_at",
    MUST_NOT_CHANGE.every((sku) => JSON.stringify(after.get(sku)) === JSON.stringify(before.get(sku))),
    MUST_NOT_CHANGE.filter((sku) => JSON.stringify(after.get(sku)) !== JSON.stringify(before.get(sku))).map((s) => [s, after.get(s)]));
  sabotages++;
  check("SABOTAGE commit: the reason-only part keeps its stale reason and its updated_at (counted, never written)",
    after.get("L-C9200-24-E-A")!.product_class_reason === "category:legacy-import"
    && after.get("L-C9200-24-E-A")!.updated_at === before.get("L-C9200-24-E-A")!.updated_at, after.get("L-C9200-24-E-A"));
  sabotages++;
  check("SABOTAGE commit: the parts a hygiene pass classed `unknown` are NOT promoted back to hardware, and the CLI says it left them alone",
    FOREIGN.every((sku) => after.get(sku)!.product_class === "unknown" && JSON.stringify(after.get(sku)) === JSON.stringify(before.get(sku)))
    && /LEFT ALONE {2}catalogue-noise: fails is_part_number: 2/.test(r.out) && run.stats.foreign_reason === 2,
    { after: FOREIGN.map((s) => after.get(s)), out: r.out.split("\n").filter((l) => /LEFT ALONE/.test(l)) });
  check("commit: it names recompute-completeness as the next step (a part that left hardware still holds its required list)",
    /recompute-completeness/.test(r.out));
}

// =================================================================================================
// idempotence
// =================================================================================================
{
  const stateBefore = await states();
  const r = cli("--commit");
  const after = await states();
  check("second commit: nothing left to change", r.status === 0 && /would change 0\b/.test(r.out), r.out.split("\n").slice(0, 4).join(" | "));
  check("second commit: opens NO run when there is nothing to write (still one run in the table)", (await count("SELECT count(*)::int AS n FROM runs")) === 1);
  sabotages++;
  check("SABOTAGE second commit: every row is byte-identical to before it ran",
    [...stateBefore].every(([sku, b]) => JSON.stringify(b) === JSON.stringify(after.get(sku))));
}

// =================================================================================================
// scoping
// =================================================================================================
{
  const r = cli("--vendor", "arista");
  check("--vendor scopes the scan to that vendor (1 Arista part, nothing to change)", r.status === 0 && /scanned 1,/.test(r.out), r.out.split("\n").slice(0, 3).join(" | "));
  sabotages++;
  const bad = cli("--vendor", "arista", "--examples", "0");
  check("SABOTAGE --examples 0 is refused naming it (a report with no examples proves nothing)", bad.status !== 0 && /--examples must be a positive number/.test(bad.out), bad.out.slice(-200));
}

await query(`TRUNCATE parts, runs CASCADE`);
await closePool();
console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
