// tests/db/queue.test.ts — proof for src/pipeline/queue.ts, the planner that feeds the scrapers.
//
//   NETZSPEC_DB=test npx tsx tests/db/queue.test.ts
//
// The planner is where "no silent gaps" becomes rows (docs/DATA_MODEL.md § No silent gaps), so the
// rules it states in its header comment are each proved here against a small fixture:
//   * enqueue by vendor/category inserts ONLY the matching parts, thinnest records first, never a
//     part a source checked in the last 90 days, never the same (source, task, key) twice;
//   * a single --key/--url task is one row, and one row only;
//   * queue-gaps queues only sources that have a LOOKUP_TASK, only for gaps whose field the
//     source_fields matrix says the source publishes (per category or any), and never at a source
//     that already checked the part;
//   * source-fields refuses an unknown source or category NAMING it, and reports an unknown field
//     key without inserting it while the known keys beside it still land.
// The sabotage cases (unknown source, disabled source, unknown category, unknown field key, a
// missing --source) assert the refusal AND its stated reason: a check that has never failed is
// not a check. The suite truncates the scratch tables and inserts one throwaway DISABLED source
// row, which it removes again at the end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, closePool, resolveDatabaseUrl, databaseName } from "../../src/store/db.js";
import { enqueue, queueGaps, loadSourceFields, applySourceFields, queueStatus, parseArgs, LOOKUP_TASK } from "../../src/pipeline/queue.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("MISS  refusing to run: NETZSPEC_DB=test is required (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
// Same rule as src/store/db.ts: netzspec_test, netzspec_test2 … one throwaway database per
// concurrent suite. An `endsWith("_test")` copy of this guard had drifted narrower and refused
// every numbered database the runner is allowed to use (D:\Project\CLAUDE.md §10, drifting copies).
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`queue.test: database ${dbName}`);

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}
/** A sabotage case: `fn` must throw, and the message must match `reason`. Wrong reason = miss. */
async function refuses(name: string, fn: () => Promise<unknown>, reason: RegExp): Promise<void> {
  sabotages++;
  try {
    await fn();
    check(`SABOTAGE ${name}`, false, "was NOT refused");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(`SABOTAGE ${name}`, reason.test(m), `refused for the WRONG reason: ${m}`);
  }
}

const DISABLED_SLUG = "zz-test-disabled";
type QueueRow = { key: string; part_id: number | null; priority: number; task: string; url: string | null; status: string };
async function queued(slug: string): Promise<QueueRow[]> {
  return (await query<QueueRow>(
    `SELECT q.key, q.part_id, q.priority, q.task, q.url, q.status::text AS status
       FROM fetch_queue q JOIN sources s ON s.id = q.source_id WHERE s.slug = $1 ORDER BY q.id`, [slug])).rows;
}
async function sourceId(slug: string): Promise<number> {
  return (await query<{ id: number }>("SELECT id FROM sources WHERE slug = $1", [slug])).rows[0].id;
}

// ---- fixture -------------------------------------------------------------------------------------
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);
await query("DELETE FROM sources WHERE slug = $1", [DISABLED_SLUG]);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget'),
  ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
  ON CONFLICT (key) DO NOTHING`);
const cisco = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0].id;
const hpe = (await query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'hpe'")).rows[0].id;
const switches = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'switches'")).rows[0].id;
const routers = (await query<{ id: number }>("SELECT id FROM categories WHERE slug = 'routers'")).rows[0].id;
await query(`INSERT INTO category_profiles (category_id, field_key, requirement) VALUES ($1, 'poe_budget', '{"kind":"req"}'::jsonb)
  ON CONFLICT (category_id, field_key) DO NOTHING`, [switches]);

const part = async (vendor: number, sku: string, cat: number, cls = "hardware"): Promise<number> => (await query<{ id: number }>(
  `INSERT INTO parts (vendor_id, sku, slug, category_id, product_class, product_class_reason)
   VALUES ($1, $2, $3, $4, $5::product_class, 'test') RETURNING id`, [vendor, sku, sku.toLowerCase(), cat, cls])).rows[0].id;
const fact = (partId: number, key: string, n: number) => query(
  `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method) VALUES ($1, $2, $3::jsonb, 'x', $4, 'unverified', 3, 'test')`,
  [partId, key, String(n), `${n} x`]);

// cisco switches: three hardware parts of different thickness, one licence
const fat = await part(cisco, "QT-FAT-24", switches);      // 3 current facts + 1 superseded (must not count)
const thin = await part(cisco, "QT-THIN-24", switches);    // 0 facts
const mid = await part(cisco, "QT-MID-24", switches);      // 1 fact
const lic = await part(cisco, "L-QT-LIC", switches, "license");
const router = await part(cisco, "QT-ROUTER-1", routers);
const hpeSwitch = await part(hpe, "QT-HPE-24", switches);
await fact(fat, "poe_budget", 370); await fact(fat, "switching_capacity", 56); await fact(fat, "weight", 4);
await fact(mid, "poe_budget", 125);
{
  // a superseded row on the THIN part: history must not make a record look thicker than it is
  const old = await query<{ id: number }>(
    `INSERT INTO facts (part_id, field_key, value, unit, raw, state, tier, method, superseded_at) VALUES ($1, 'weight', '9'::jsonb, 'kg', '9 kg', 'unverified', 3, 'test', now()) RETURNING id`, [thin]);
  await query("UPDATE facts SET superseded_by = id WHERE id = $1", [old.rows[0].id]);
}

// =================================================================================================
// parseArgs
// =================================================================================================
{
  const p = parseArgs(["queue", "--source", "provantage", "--task", "search", "--vendor", "cisco", "--limit", "5", "--force", "--class"]);
  check("parseArgs: command, --k v pairs, bare flags as true",
    p.cmd === "queue" && p.args.source === "provantage" && p.args.task === "search" && p.args.vendor === "cisco" && p.args.limit === "5"
      && p.args.force === true && p.args.class === true, p);
}

// =================================================================================================
// enqueue by vendor / category
// =================================================================================================
{
  const n = await enqueue({ source: "provantage", task: "search", vendor: "cisco", category: "switches" });
  const rows = await queued("provantage");
  const keys = rows.map((r) => r.key).sort();
  check("enqueue vendor+category inserts exactly the cisco switches (licence included, router and HPE excluded)",
    n === 4 && keys.join(",") === ["QT-FAT-24", "QT-MID-24", "QT-THIN-24", "L-QT-LIC"].sort().join(","), { n, keys });
  check("enqueue carries part_id, task and priority = 50 + tier*10 (provantage is tier 4 -> 90)",
    rows.every((r) => r.part_id !== null && r.task === "search" && r.priority === 90 && r.status === "queued"), rows);
  check("thinnest records first: the 0-fact part is queued before the 1-fact part before the 3-fact part",
    rows.findIndex((r) => r.key === "QT-THIN-24") < rows.findIndex((r) => r.key === "QT-MID-24")
      && rows.findIndex((r) => r.key === "QT-MID-24") < rows.findIndex((r) => r.key === "QT-FAT-24"), rows.map((r) => r.key));
  const again = await enqueue({ source: "provantage", task: "search", vendor: "cisco", category: "switches" });
  check("ON CONFLICT (source, task, key): the same enqueue again inserts 0 and leaves 4 rows",
    again === 0 && (await queued("provantage")).length === 4, again);
  const other = await enqueue({ source: "provantage", task: "part-page", vendor: "cisco", category: "switches", limit: "1" });
  check("a different TASK for the same key is a different row (the unique key is source+task+key)",
    other === 1 && (await queued("provantage")).filter((r) => r.task === "part-page").length === 1, other);
}
{
  await query("TRUNCATE fetch_queue");
  const n = await enqueue({ source: "provantage", task: "search", vendor: "cisco", category: "switches", class: "hardware" });
  const keys = (await queued("provantage")).map((r) => r.key);
  check("--class hardware drops the licence", n === 3 && !keys.includes("L-QT-LIC"), keys);
}
{
  await query("TRUNCATE fetch_queue");
  const n = await enqueue({ source: "provantage", task: "search", vendor: "cisco", category: "switches", class: "hardware", limit: "2" });
  const keys = (await queued("provantage")).map((r) => r.key);
  check("--limit 2 keeps the two THINNEST hardware parts (ordering is applied before the limit, not after)",
    n === 2 && keys.length === 2 && keys.includes("QT-THIN-24") && keys.includes("QT-MID-24"), keys);
}
{
  await query("TRUNCATE fetch_queue");
  const n = await enqueue({ source: "provantage", task: "search", vendor: "hpe", priority: "7" });
  const rows = await queued("provantage");
  check("vendor-only filter reaches the other vendor's part; --priority overrides the tier default",
    n === 1 && rows[0]?.key === "QT-HPE-24" && rows[0]?.priority === 7, rows);
}
{
  await query("TRUNCATE fetch_queue");
  const n = await enqueue({ source: "provantage", task: "search", category: "routers" });
  check("category-only filter reaches the router", n === 1 && (await queued("provantage"))[0]?.key === "QT-ROUTER-1", n);
}

// ---- the 90-day suppression --------------------------------------------------------------------
{
  await query("TRUNCATE fetch_queue");
  const prov = await sourceId("provantage");
  await query(`INSERT INTO part_source_checks (part_id, source_id, outcome, facts_found, checked_at) VALUES
    ($1, $3, 'no_facts', 0, now() - interval '1 day'),
    ($2, $3, 'no_facts', 0, now() - interval '100 days')`, [thin, mid, prov]);
  const n = await enqueue({ source: "provantage", task: "search", vendor: "cisco", category: "switches", class: "hardware" });
  const keys = (await queued("provantage")).map((r) => r.key);
  check("a part provantage checked 1 day ago is NOT re-queued; one checked 100 days ago IS",
    n === 2 && !keys.includes("QT-THIN-24") && keys.includes("QT-MID-24") && keys.includes("QT-FAT-24"), keys);
  await query("TRUNCATE fetch_queue");
  const m = await enqueue({ source: "router-switch", task: "search", vendor: "cisco", category: "switches", class: "hardware" });
  check("the suppression is PER SOURCE: router-switch never checked the part, so it queues all three",
    m === 3 && (await queued("router-switch")).length === 3, m);
  check("router-switch is tier 3 -> priority 80", (await queued("router-switch")).every((r) => r.priority === 80));
  await query("TRUNCATE part_source_checks");
}

// ---- single --key / --url tasks -----------------------------------------------------------------
{
  await query("TRUNCATE fetch_queue");
  const url = "https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets";
  const n = await enqueue({ source: "meraki", task: "listing", url });
  const rows = await queued("meraki");
  check("--url alone: one listing row keyed by the URL, url set, no part",
    n === 1 && rows.length === 1 && rows[0].key === url && rows[0].url === url && rows[0].part_id === null && rows[0].task === "listing", rows);
  const again = await enqueue({ source: "meraki", task: "listing", url });
  check("the same --url again is a no-op", again === 0 && (await queued("meraki")).length === 1, again);
  const k = await enqueue({ source: "itprice", task: "gpl", key: "C9200L-24P-4G" });
  const krows = await queued("itprice");
  check("--key alone: key set, url NULL, meraki tier 2 -> 70 / itprice tier 3 -> 80",
    k === 1 && krows[0]?.key === "C9200L-24P-4G" && krows[0]?.url === null && krows[0]?.priority === 80 && rows[0].priority === 70, krows);
}

// ---- refusals ---------------------------------------------------------------------------------
await refuses("enqueue at an unknown source names it", () => enqueue({ source: "nosuch-source", task: "search" }), /unknown source 'nosuch-source'/);
await query(`INSERT INTO sources (slug, name, host, kind, tier, politeness_ms, enabled, notes)
  VALUES ($1, 'Disabled test source', 'example.invalid', 'distributor', 4, 1000, false, 'inserted by tests/db/queue.test.ts; removed at the end')
  ON CONFLICT (slug) DO NOTHING`, [DISABLED_SLUG]);
await refuses("enqueue at a DISABLED source is refused as disabled (not as unknown)",
  () => enqueue({ source: DISABLED_SLUG, task: "search", vendor: "cisco" }), new RegExp(`source '${DISABLED_SLUG}' is disabled`));
check("the refused enqueue at the disabled source wrote nothing", (await queued(DISABLED_SLUG)).length === 0);
await refuses("enqueue without --task", () => enqueue({ source: "provantage" }), /--source and --task are required/);
await refuses("enqueue without --source", () => enqueue({ task: "search" }), /--source and --task are required/);

// =================================================================================================
// queueStatus
// =================================================================================================
{
  const rows = await queueStatus();
  const meraki = rows.find((r) => r.slug === "meraki");
  const itprice = rows.find((r) => r.slug === "itprice");
  check("queueStatus groups by source and status", meraki?.status === "queued" && meraki?.n === 1 && itprice?.n === 1, rows);
}

// =================================================================================================
// source-fields (the capability matrix)
// =================================================================================================
{
  const r = await applySourceFields({ sources: { provantage: { "*": ["poe_budget"], switches: ["switching_capacity"] } } });
  const rows = (await query<{ category_id: number | null; field_key: string }>(
    "SELECT sf.category_id, sf.field_key FROM source_fields sf JOIN sources s ON s.id = sf.source_id WHERE s.slug = 'provantage' ORDER BY 2")).rows;
  check("applySourceFields inserts one row per (source, category|any, field)",
    r.inserted === 2 && r.unknownFields.length === 0 && rows.length === 2
      && rows.some((x) => x.field_key === "poe_budget" && x.category_id === null)
      && rows.some((x) => x.field_key === "switching_capacity" && x.category_id === switches), { r, rows });
  const again = await applySourceFields({ sources: { provantage: { "*": ["poe_budget"], switches: ["switching_capacity"] } } });
  check("the same matrix again inserts 0 (ON CONFLICT on source + COALESCE(category, 0) + field)", again.inserted === 0, again);
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nz-source-fields-"));
  const file = path.join(tmp, "source-fields.json");
  fs.writeFileSync(file, JSON.stringify({ sources: { "router-switch": { switches: ["poe_budget"] } } }));
  const r = await loadSourceFields(file);
  check("loadSourceFields(file) reads a JSON matrix from disk", r.inserted === 1 && r.unknownFields.length === 0, r);
  fs.rmSync(tmp, { recursive: true, force: true });
  const repo = await loadSourceFields();
  check("loadSourceFields() with no argument reads the repo's data/schema/source-fields.json without throwing", Number.isInteger(repo.inserted));
  // …and then put the suite's OWN matrix back. That call loads the real capability matrix — 733
  // rows once the '*' lists landed — and everything below reasons about a hand-built matrix of
  // five entries. Left in place it silently redefines the fixture: router-switch gains poe_budget
  // for ANY category (so it queues the router it must not), sources_capable rises from 4/3 to 5/5,
  // and the failures read as planner bugs rather than as a fixture built on production data.
  await query("TRUNCATE source_fields");
  await applySourceFields({ sources: { provantage: { "*": ["poe_budget"], switches: ["switching_capacity"] }, "router-switch": { switches: ["poe_budget"] } } });
}
{
  const before = (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_fields")).rows[0].n;
  await refuses("source-fields with an unknown CATEGORY names the category and the source, before any write",
    () => applySourceFields({ sources: { itprice: { gizmos: ["poe_budget"], "*": ["poe_budget"] } } }), /unknown category 'gizmos' under 'itprice'/);
  const after = (await query<{ n: number }>("SELECT count(*)::int AS n FROM source_fields")).rows[0].n;
  check("the refused matrix inserted nothing", before === after, { before, after });
  await refuses("source-fields with an unknown SOURCE names it",
    () => applySourceFields({ sources: { "nosuch-source": { "*": ["poe_budget"] } } }), /unknown source 'nosuch-source'/);
}
{
  sabotages++;
  const r = await applySourceFields({ sources: { itprice: { "*": ["poe_bidget", "switching_capacity"] } } });
  const rows = (await query<{ field_key: string }>(
    "SELECT sf.field_key FROM source_fields sf JOIN sources s ON s.id = sf.source_id WHERE s.slug = 'itprice'")).rows.map((x) => x.field_key);
  check("SABOTAGE an unknown FIELD KEY is reported as source/category/key and NOT inserted; the known key beside it lands",
    r.unknownFields.join(",") === "itprice/*/poe_bidget" && r.inserted === 1 && rows.join(",") === "switching_capacity", { r, rows });
}

// =================================================================================================
// queue-gaps
// =================================================================================================
// Matrix now: provantage {*: poe_budget, switches: switching_capacity}, router-switch {switches: poe_budget},
// itprice {*: switching_capacity}. Add cdw {*: poe_budget} (will have already checked the switch) and
// meraki {*: poe_budget} (capable, enabled, but listing-driven: no LOOKUP_TASK).
await applySourceFields({ sources: { cdw: { "*": ["poe_budget"] }, meraki: { "*": ["poe_budget"] } } });
await query("TRUNCATE fetch_queue, part_source_checks, completeness");
// gaps: the thin switch and the router both miss poe_budget; a third part "misses" a field it already holds a value for
const held = await part(cisco, "QT-HELD-24", switches);
await fact(held, "poe_budget", 240);
const compl = (partId: number, missing: string[]) => query(
  `INSERT INTO completeness (part_id, required_total, required_present, pct, missing, required_fields)
   VALUES ($1, $2, 0, 0, $3::jsonb, $3::jsonb)`, [partId, missing.length, JSON.stringify(missing)]);
await compl(thin, ["poe_budget"]);
await compl(router, ["poe_budget"]);
await compl(held, ["poe_budget"]);
await query("INSERT INTO part_source_checks (part_id, source_id, outcome, facts_found) VALUES ($1, $2, 'no_facts', 0)", [thin, await sourceId("cdw")]);
{
  const g = (await query<{ part_id: number; state: string; sources_checked: number; sources_capable: number }>(
    "SELECT part_id, state, sources_checked, sources_capable FROM gap_ledger WHERE field_key = 'poe_budget' ORDER BY part_id")).rows;
  const gThin = g.find((x) => x.part_id === thin), gRouter = g.find((x) => x.part_id === router), gHeld = g.find((x) => x.part_id === held);
  check("gap_ledger fixture: the switch is gap_unattempted with 4 capable sources (1 checked), the router 3 capable, the held part is not a gap",
    gThin?.state === "gap_unattempted" && gThin?.sources_capable === 4 && gThin?.sources_checked === 1
      && gRouter?.state === "gap_unattempted" && gRouter?.sources_capable === 3 && gHeld?.state === "unverified", g);
}
{
  const r = await queueGaps({});
  const prov = (await queued("provantage")).map((x) => x.key).sort();
  const rs = (await queued("router-switch")).map((x) => x.key);
  const cdw = (await queued("cdw")).map((x) => x.key);
  const itp = await queued("itprice");
  const mer = await queued("meraki");
  check("queue-gaps: provantage (poe_budget for ANY category) gets the switch and the router",
    prov.join(",") === ["QT-ROUTER-1", "QT-THIN-24"].sort().join(","), prov);
  check("queue-gaps: router-switch (poe_budget for SWITCHES only) gets the switch, not the router", rs.join(",") === "QT-THIN-24", rs);
  check("queue-gaps: cdw already checked the switch -> only the router", cdw.join(",") === "QT-ROUTER-1", cdw);
  check("queue-gaps: itprice publishes switching_capacity, not the gap's field -> nothing", itp.length === 0, itp);
  check("queue-gaps: meraki is capable but has no LOOKUP_TASK -> nothing queued, reported as skipped",
    mer.length === 0 && r.skippedNoLookup.includes("meraki") && !r.skippedNoLookup.includes("provantage"), r.skippedNoLookup);
  check("queue-gaps: the part that already HOLDS a value for the 'missing' field is never queued",
    !(await query("SELECT 1 FROM fetch_queue WHERE part_id = $1", [held])).rowCount);
  check("queue-gaps: 4 rows total, each with the source's lookup task and tier priority",
    r.inserted === 4 && (await queued("provantage")).every((x) => x.task === LOOKUP_TASK.provantage && x.priority === 90)
      && (await queued("router-switch")).every((x) => x.task === "search" && x.priority === 80)
      && (await queued("cdw")).every((x) => x.task === "search" && x.priority === 90), r);
  const again = await queueGaps({});
  check("queue-gaps again inserts 0 (ON CONFLICT)", again.inserted === 0, again);
}
{
  await query("TRUNCATE fetch_queue");
  const r = await queueGaps({ limit: "1" });
  const total = (await query<{ n: number }>("SELECT count(*)::int AS n FROM fetch_queue")).rows[0].n;
  check("queue-gaps --limit 1 stops after one row across all sources", r.inserted === 1 && total === 1, { r, total });
}
{
  // the disabled source is capable of the field but disabled: never queued, never listed as skipped
  sabotages++;
  await applySourceFields({ sources: { [DISABLED_SLUG]: { "*": ["poe_budget"] } } });
  await query("TRUNCATE fetch_queue");
  const r = await queueGaps({});
  check("SABOTAGE a DISABLED source with a matching source_fields row gets no gap lookups",
    (await queued(DISABLED_SLUG)).length === 0 && !r.skippedNoLookup.includes(DISABLED_SLUG), r);
}

// ---- cleanup ------------------------------------------------------------------------------------
await query("DELETE FROM source_fields WHERE source_id = (SELECT id FROM sources WHERE slug = $1)", [DISABLED_SLUG]);
await query("DELETE FROM sources WHERE slug = $1", [DISABLED_SLUG]);
check("the throwaway disabled source row is gone", !(await query("SELECT 1 FROM sources WHERE slug = $1", [DISABLED_SLUG])).rowCount);
// Leave the scratch tables empty: fixture parts without completeness rows would otherwise trip
// invariants.test.ts in a later suite of the same run.
await query(`TRUNCATE fetch_queue, fetches, part_source_checks, source_fields, completeness, facts, fact_evidence, conflicts,
  lifecycle, relations, images, image_variants, part_aliases, doc_parts, parts, source_docs, runs CASCADE`);
await closePool();

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
