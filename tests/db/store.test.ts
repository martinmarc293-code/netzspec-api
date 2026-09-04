// tests/db/store.test.ts — proof for src/store/*: the write side, against the throwaway database.
//
//   NETZSPEC_DB=test npx tsx tests/db/store.test.ts
//
// Roughly a third of the cases are SABOTAGE: a deliberately wrong write that must be refused,
// and refused for the stated reason — a second current row, an unknown field key, a gated run
// closed without its gate, a gap confirmed over a value, a test pointed at a database whose name
// does not end in _test. A store whose refusals have never fired is a store whose rules are
// wishes (CLAUDE.md "Proof rules").
//
// The suite truncates the tables the store writes and never touches the seeded vocabulary
// tables (vendors, categories, sources, field_dictionary). The dictionary keys it needs are
// inserted with plain SQL if absent — src/store/dictionary.ts belongs to another agent.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..", "..");

// ---- child-process mode: the database-name guard ------------------------------------------------
// loadEnv() caches on first call, so the fake URL must be set before ANY store call in a fresh
// process. The parent spawns this file with --sabotage-db-url and asserts on exit code + output.
if (process.argv.includes("--sabotage-db-url")) {
  process.env.NETZSPEC_DB = "test";
  process.env.DATABASE_URL_TEST = "postgres://u:p@localhost:5433/netzspec";
  const { resolveDatabaseUrl } = await import("../../src/store/db.js");
  try {
    resolveDatabaseUrl();
    console.log("NO THROW");
    process.exit(2);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(m);
    process.exit(/must end in _test/.test(m) && /"netzspec"/.test(m) ? 0 : 3);
  }
}

import {
  query, withTx, closePool, resolveDatabaseUrl, databaseName, getPool,
  openRun, closeRun, withRun, hashFile, getRun,
  ensureCategory, upsertPart, findPart, slugify,
  docIdFor, ensureSourceDoc, getSourceDoc, linkDocParts,
  applyMerge, currentFacts, currentFact, factHistory, writeGapConfirmed, supersedeFact, packLocator, unpackLocator, rollbackRun,
  upsertLifecycle, mergeLifecycle,
  upsertRelation,
  upsertImage, setImageVariant, setMerchantReadiness,
  upsertAlias,
  recordSourceCheck,
} from "../../src/store/index.js";
import type { SpecEntry } from "../../src/core/specMerge.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("refusing: run with NETZSPEC_DB=test (this suite truncates tables)");
  process.exit(1);
}

let pass = 0;
let refusals = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}
/** A sabotage case: `fn` must throw, and the message must match `reason`. Wrong reason = miss. */
async function refuses(name: string, fn: () => Promise<unknown>, reason: RegExp): Promise<void> {
  refusals++;
  try {
    await fn();
    check(`SABOTAGE ${name}`, false, "was NOT refused");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(`SABOTAGE ${name}`, reason.test(m), `refused for the WRONG reason: ${m}`);
  }
}
const j = (v: unknown) => JSON.stringify(v);

const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`store.test: database ${dbName}`);
const pool = getPool();

// ---- reset ------------------------------------------------------------------------------------
// CASCADE reaches fetch_queue (-> parts) and fetches (-> source_docs), both scratch in the test
// database. It cannot reach vendors/categories/sources/field_dictionary: nothing here is
// referenced BY them.
await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, image_variants, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('switching_capacity', 'n', 'Gbit/s', 'Switching capacity', 'Switching-Kapazität'),
  ('poe_budget', 'n', 'W', 'PoE budget', 'PoE-Budget'),
  ('ieee_standards', 'ls', NULL, 'IEEE standards', 'IEEE-Standards'),
  ('stackable', 'b', NULL, 'Stackable', 'Stapelbar')
  ON CONFLICT (key) DO NOTHING`);

// =================================================================================================
// runs
// =================================================================================================
const input = hashFile(HERE);
check("hashFile records path, sha256 and bytes", input.sha256.length === 64 && input.bytes > 1000 && !input.path.includes("\\"));

const applyRun = await openRun("apply-specs", { inputs: { files: [input] }, gitSha: "deadbeef" });
check("openRun returns an id", Number.isInteger(applyRun) && applyRun > 0);
{
  const r = await getRun(applyRun);
  const files = (r?.inputs as { files: { sha256: string }[] }).files;
  check("run inputs carry the file hash", files[0]?.sha256 === input.sha256 && r?.status === "running");
}
await refuses("apply-specs run closed as succeeded with no gate", () => closeRun(applyRun, "succeeded", { n: 1 }), /without a passing gate/);
await refuses("apply-specs run closed as succeeded with a FAILING gate",
  () => closeRun(applyRun, "succeeded", { n: 1 }, { precision: 0.5, recall: 1, passed: false }), /did not pass/);
await refuses("apply-specs run closed with a gate that has no recall (malformed, not failing)",
  () => closeRun(applyRun, "succeeded", {}, { precision: 0.99, passed: true } as never), /malformed gate \(recall is missing/);
{
  const r = await getRun(applyRun);
  check("a refused close leaves the run running", r?.status === "running" && r?.gate === null);
}
{
  const enumRun = await openRun("enumeration", { inputs: {} });
  await closeRun(enumRun, "succeeded", { parts: 0 });
  const r = await getRun(enumRun);
  check("a non-apply run closes without a gate", r?.status === "succeeded");
}
{
  let thrown = "";
  let seenId = 0;
  try {
    await withRun("apply-lifecycle", {}, async (id) => { seenId = id; throw new Error("extractor exploded"); });
  } catch (e) { thrown = (e as Error).message; }
  const r = await getRun(seenId);
  check("withRun closes a throwing run as failed with the reason, and rethrows",
    thrown === "extractor exploded" && r?.status === "failed" && String(r?.notes).includes("extractor exploded"));
}
{
  let thrown = "";
  let seenId = 0;
  try { await withRun("apply-lifecycle", {}, async (id) => { seenId = id; return { stats: { rows: 3 } }; }); }
  catch (e) { thrown = (e as Error).message; }
  const r = await getRun(seenId);
  refusals++;
  check("SABOTAGE withRun on an apply-* kind that returns no gate ends failed, not succeeded",
    /without a passing gate/.test(thrown) && r?.status === "failed");
}
{
  const out = await withRun("apply-lifecycle", {}, async () => ({ stats: { rows: 3 }, gate: { precision: 1, recall: 1, passed: true } }));
  const r = await getRun(out.runId);
  check("withRun with a passing gate succeeds and stores stats + gate",
    r?.status === "succeeded" && (r?.stats as { rows: number }).rows === 3 && (r?.gate as { passed: boolean }).passed === true);
}

// =================================================================================================
// parts
// =================================================================================================
check("slugify lowercases and collapses runs", slugify("C9200L-24P-4G=") === "c9200l-24p-4g" && slugify("  WS/C 3850 ") === "ws-c-3850" && slugify("") === "part");
await refuses("ensureCategory on an unknown slug names it", () => ensureCategory("no-such-category"), /unknown category "no-such-category"/);

const p1 = await upsertPart({ vendor: "cisco", sku: "C9200L-24P-4G", category: "switches", name: "First name", product_class: "hardware" });
check("upsertPart creates with a slug from the SKU", p1.created && p1.slug === "c9200l-24p-4g");
const p1b = await upsertPart({ vendor: "cisco", sku: "C9200L-24P-4G", category: "switches", name: "Second name", family: "Cisco Catalyst 9200" });
{
  const row = await findPart("cisco", "C9200L-24P-4G");
  check("upsertPart fills NULL columns and keeps filled ones",
    !p1b.created && p1b.id === p1.id && row?.name === "First name" && row?.family === "Cisco Catalyst 9200" && row?.product_class === "hardware");
}
await upsertPart({ vendor: "cisco", sku: "C9200L-24P-4G", category: "switches", name: "Second name" }, { force: true });
{
  const row = await findPart("cisco", "C9200L-24P-4G");
  check("upsertPart {force} overwrites provided values and still never blanks", row?.name === "Second name" && row?.family === "Cisco Catalyst 9200");
}
const p1spare = await upsertPart({ vendor: "cisco", sku: "C9200L-24P-4G=", category: "switches" });
check("a second SKU with the same slug base gets -2", p1spare.created && p1spare.slug === "c9200l-24p-4g-2" && p1spare.id !== p1.id);
{
  const ci = await findPart("cisco", "c9200l-24p-4g");
  const exact = await findPart("cisco", "C9200L-24P-4G=");
  const none = await findPart("cisco", "NOPE-1");
  check("findPart is case-insensitive and returns the vendor's exact SKU", ci?.sku === "C9200L-24P-4G" && ci?.id === p1.id);
  check("findPart exact match wins over the case-insensitive neighbour", exact?.sku === "C9200L-24P-4G=" && exact?.id === p1spare.id);
  check("findPart returns null for an unknown SKU", none === null);
}
{
  await upsertPart({ vendor: "cisco", sku: "abc-1", category: "transceiver" });
  await upsertPart({ vendor: "cisco", sku: "ABC-1", category: "transceiver" });
  const lower = await findPart("cisco", "abc-1");
  const upper = await findPart("cisco", "ABC-1");
  check("two SKUs differing only in case are two parts, each found exactly", lower?.sku === "abc-1" && upper?.sku === "ABC-1" && lower?.id !== upper?.id);
}

// =================================================================================================
// docs
// =================================================================================================
{
  const url = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html";
  const want = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  check("docIdFor = sha1(url)[:16]", docIdFor(url) === want && docIdFor(url).length === 16);
  const legacy = fs.readFileSync(path.join(ROOT, "src", "pipeline", "legacy", "apply-specs-v2.ts"), "utf8");
  check("docIdFor matches the legacy extractor's formula byte for byte",
    legacy.includes('crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)'));
}
const D1 = await ensureSourceDoc({ url: "https://www.cisco.com/ds/cat9200.html", doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });
const D2 = await ensureSourceDoc({ url: "https://www.cisco.com/ds/cat9200-family.html", doc_type: "vendor_datasheet_html", vendor: "cisco" });
const D3 = await ensureSourceDoc({ url: "https://www.router-switch.com/c9200l-24p-4g.html", doc_type: "aggregator_page" });
const DPDF = await ensureSourceDoc({ url: "https://www.cisco.com/ds/eol-13773.pdf", doc_type: "vendor_datasheet_pdf", vendor: "cisco" });
{
  const again = await ensureSourceDoc({ url: "https://www.cisco.com/ds/cat9200.html", doc_type: "vendor_datasheet_pdf", title: "Catalyst 9200 data sheet", tables: 12 });
  const row = await getSourceDoc(D1);
  check("ensureSourceDoc is idempotent, fills NULL metadata and never overwrites doc_type",
    again === D1 && row?.doc_type === "vendor_datasheet_html" && row?.title === "Catalyst 9200 data sheet" && row?.tables === 12 && row?.fetched_at === "2026-09-01");
}
{
  const n1 = await linkDocParts(D1, [p1.id, p1spare.id]);
  const n2 = await linkDocParts(D1, [p1.id, p1spare.id]);
  check("linkDocParts links once and reports only new links", n1 === 2 && n2 === 0);
}

// =================================================================================================
// facts — the heart
// =================================================================================================
const day = "2026-09-03";
const entry = (k: string, value: unknown, raw: string, prov: SpecEntry["prov"], extra: Partial<SpecEntry> = {}): SpecEntry =>
  ({ k, raw, value, unit: k === "switching_capacity" ? "Gbit/s" : k === "poe_budget" ? "W" : undefined,
    state: prov.tier <= 2 ? "verified" : "unverified", prov: { extracted_at: day, norm_v: "1.0.0", ...prov }, ...extra });
const html = (doc_id: string, locator: string, revision_label?: string) => ({ tier: 2, method: "html_table", doc_id, locator, revision_label });

check("packLocator/unpackLocator round-trip a revision label",
  j(unpackLocator(packLocator({ tier: 2, method: "x", locator: "t3:r4:c2", revision_label: "r2" }))) === j({ locator: "t3:r4:c2", revision_label: "r2" })
  && packLocator({ tier: 2, method: "x", locator: "t3:r4:c2" }) === "t3:r4:c2" && j(unpackLocator("t3:r4:c2")) === j({ locator: "t3:r4:c2" }));

// insert
{
  const r = await withTx((c) => applyMerge(c, p1.id, entry("switching_capacity", 56, "56 Gbps", html(D1, "t3:r4:c2", "r1")), applyRun));
  const cur = await currentFacts(p1.id, pool);
  const f = cur.get("switching_capacity");
  const ev = await query("SELECT count(*)::int AS n FROM fact_evidence WHERE fact_id = $1", [f?.id]);
  check("insert: a new field becomes one verified current row with one evidence row",
    r.action === "insert" && f?.value === 56 && f?.state === "verified" && f?.unit === "Gbit/s" && f?.raw === "56 Gbps" && ev.rows[0].n === 1 && f?.locator === "t3:r4:c2|rev=r1");
}
// revision_change
{
  const before = await currentFact(p1.id, "switching_capacity", pool);
  const r = await withTx((c) => applyMerge(c, p1.id, entry("switching_capacity", 60, "60 Gbps", html(D1, "t3:r4:c2", "r2")), applyRun));
  const hist = await factHistory(p1.id, "switching_capacity", pool);
  const current = hist.filter((h) => h.superseded_by === null);
  const old = hist.find((h) => h.id === before?.id);
  const neu = hist.find((h) => h.id === r.factId);
  check("revision_change: the new value is a NEW row, exactly one current",
    r.action === "revision_change" && current.length === 1 && current[0].value === 60 && current[0].id === r.factId && hist.length === 2);
  check("revision_change: the old row is superseded by the new id, value untouched, superseded_at >= new created_at",
    old?.superseded_by === r.factId && old?.value === 56 && old?.superseded_at != null && neu != null && old.superseded_at.getTime() >= neu.created_at.getTime());
  const cf = await query("SELECT resolution, resolved_at, kept, rejected FROM conflicts WHERE id = $1", [r.conflictId]);
  check("revision_change: logged as an already-resolved conflicts row (not an open one)",
    cf.rows[0]?.resolution === "revision_change" && cf.rows[0]?.resolved_at !== null && cf.rows[0]?.kept === 60 && cf.rows[0]?.rejected === 56);
}
// corroborate
{
  const r = await withTx((c) => applyMerge(c, p1.id, entry("switching_capacity", 60, "60 Gbit/s", html(D2, "t1:r2:c3")), applyRun));
  const f = await currentFact(p1.id, "switching_capacity", pool);
  const ev = await query("SELECT doc_id FROM fact_evidence WHERE fact_id = $1 ORDER BY id", [f?.id]);
  check("corroborate: an independent trusted source adds evidence and flips state to corroborated, value unchanged",
    r.action === "corroborate" && f?.state === "corroborated" && f?.value === 60 && f?.doc_id === D1
    && ev.rows.map((x) => x.doc_id).join(",") === `${D1},${D2}`);
}
// skip
{
  const r1 = await withTx((c) => applyMerge(c, p1.id, entry("switching_capacity", 60, "60 Gbit/s", html(D2, "t1:r2:c3")), applyRun));
  const r2 = await withTx((c) => applyMerge(c, p1.id, entry("switching_capacity", 60, "60 Gbps", { tier: 3, method: "html_table", doc_id: D3, locator: "t1:r1:c1" }), applyRun));
  const ev = await query("SELECT count(*)::int AS n FROM fact_evidence fe JOIN facts f ON f.id = fe.fact_id WHERE f.part_id = $1 AND f.field_key = 'switching_capacity' AND f.superseded_by IS NULL", [p1.id]);
  check("skip_lower_tier: the same document again, or an aggregator agreeing, changes nothing",
    r1.action === "skip_lower_tier" && r2.action === "skip_lower_tier" && ev.rows[0].n === 2);
}
// conflict
{
  await withTx((c) => applyMerge(c, p1.id, entry("poe_budget", 370, "370 W", html(D1, "t3:r9:c2")), applyRun));
  const r = await withTx((c) => applyMerge(c, p1.id, entry("poe_budget", 740, "740W", html(D2, "t2:r9:c2")), applyRun));
  const f = await currentFact(p1.id, "poe_budget", pool);
  const cf = await query("SELECT * FROM conflicts WHERE id = $1", [r.conflictId]);
  const c = cf.rows[0];
  const open = await query("SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'poe_budget' AND resolved_at IS NULL", [p1.id]);
  check("conflict: same-tier disagreement HOLDS the field (state conflict, value untouched, one current row)",
    r.action === "conflict" && f?.state === "conflict" && f?.value === 370 && f?.id === r.factId);
  check("conflict: the conflicts row carries kept, rejected, reason and both provenances",
    c?.kept === 370 && c?.rejected === 740 && /disagree/.test(c?.reason) && c?.kept_evidence?.doc_id === D1 && c?.rejected_evidence?.doc_id === D2
    && c?.resolved_at === null && open.rows[0].n === 1);
}
// protected
{
  const seed = entry("stackable", true, "Yes", { tier: 0, method: "hexcat_seed" });
  const r0 = await withTx((c) => applyMerge(c, p1.id, seed, applyRun));
  const r = await withTx((c) => applyMerge(c, p1.id, entry("stackable", false, "No", html(D1, "t5:r1:c2")), applyRun));
  const f = await currentFact(p1.id, "stackable", pool);
  const cf = await query("SELECT reason, kept, rejected FROM conflicts WHERE id = $1", [r.conflictId]);
  const hist = await factHistory(p1.id, "stackable", pool);
  check("protected: a tier-0 value is untouched (state, value, row count) and a conflicts row exists",
    r0.action === "insert" && r.action === "protected" && f?.value === true && f?.state === "verified" && f?.tier === 0 && hist.length === 1
    && /protected/.test(cf.rows[0]?.reason) && cf.rows[0]?.kept === true && cf.rows[0]?.rejected === false);
}
// sabotage: the partial unique index
await refuses("a second CURRENT row for the same part+field (raw INSERT bypassing the store)",
  () => query(`INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id) VALUES ($1, 'switching_capacity', '99', '99', 'verified', 2, 'html_table', $2)`, [p1.id, D1])
    .catch((e) => { throw new Error(`${e.code} ${e.constraint}`); }),
  /23505 facts_current_uq/);
// sabotage: unknown key
await refuses("an unknown field_key is rejected and the error names the key",
  () => withTx((c) => applyMerge(c, p1.id, entry("no_such_field", 1, "1", html(D1, "t1:r1:c1")), applyRun)),
  /unknown field_key "no_such_field"/);
// sabotage: verified without a source
await refuses("a verified tier-2 fact with no doc_id trips facts_verified_needs_source",
  () => withTx((c) => applyMerge(c, p1.id, entry("ieee_standards", ["IEEE 802.1Q"], "802.1Q", { tier: 2, method: "html_table" }), applyRun))
    .catch((e) => { throw new Error(`${e.code} ${e.constraint}`); }),
  /23514 facts_verified_needs_source/);
{
  const cur = await currentFacts(p1.id, pool);
  check("the refused writes left no rows behind (transactions rolled back)", !cur.has("ieee_standards") && !cur.has("no_such_field") && cur.size === 3);
}
// gaps
const p2 = await upsertPart({ vendor: "cisco", sku: "C9200-48P", category: "switches", product_class: "hardware" });
{
  await query(`INSERT INTO facts (part_id, field_key, value, raw, state, tier, method) VALUES ($1, 'ieee_standards', NULL, '', 'gap_unattempted', 2, 'profile')`, [p2.id]);
  const r = await withTx((c) => writeGapConfirmed(c, p2.id, "ieee_standards", applyRun));
  const hist = await factHistory(p2.id, "ieee_standards", pool);
  const cur = hist.filter((h) => h.superseded_by === null);
  check("writeGapConfirmed supersedes a gap_unattempted row with a NULL-value gap_confirmed row",
    r.action === "insert" && r.supersededId === hist[0].id && cur.length === 1 && cur[0].state === "gap_confirmed" && cur[0].value === null && hist.length === 2);
  const r2 = await withTx((c) => writeGapConfirmed(c, p2.id, "ieee_standards", applyRun));
  check("writeGapConfirmed on an existing gap_confirmed row is a no-op", r2.action === "skip_lower_tier" && r2.factId === cur[0].id);
  const r3 = await withTx((c) => applyMerge(c, p2.id, entry("ieee_standards", ["IEEE 802.1Q", "IEEE 802.3ad"], "802.1Q, 802.3ad", html(D2, "t4:r2:c2")), applyRun));
  const after = await currentFact(p2.id, "ieee_standards", pool);
  const all = await factHistory(p2.id, "ieee_standards", pool);
  check("a real value supersedes a gap row (insert, not conflict), history kept",
    r3.action === "insert" && r3.supersededId === cur[0].id && j(after?.value) === j(["IEEE 802.1Q", "IEEE 802.3ad"]) && after?.state === "verified" && all.length === 3);
  const r4 = await withTx((c) => writeGapConfirmed(c, p2.id, "switching_capacity", applyRun));
  const g = await currentFact(p2.id, "switching_capacity", pool);
  check("writeGapConfirmed with no row inserts a gap_confirmed row", r4.action === "insert" && g?.state === "gap_confirmed" && g?.value === null);
}
await refuses("writeGapConfirmed over a current VALUE",
  () => withTx((c) => writeGapConfirmed(c, p2.id, "ieee_standards", applyRun)), /cannot be confirmed over it/);
await refuses("writeGapConfirmed over a HELD conflict",
  () => withTx((c) => writeGapConfirmed(c, p1.id, "poe_budget", applyRun)), /holds a conflict row/);
await refuses("supersedeFact on a row that is not current",
  async () => {
    const hist = await factHistory(p1.id, "switching_capacity", pool);
    const old = hist.find((h) => h.superseded_by !== null)!;
    return withTx((c) => supersedeFact(c, old.id, entry("switching_capacity", 1, "1", html(D1, "x")), applyRun));
  }, /not a current row/);
await refuses("supersedeFact with a replacement for a different field",
  async () => {
    const cur = await currentFact(p1.id, "switching_capacity", pool);
    return withTx((c) => supersedeFact(c, cur!.id, entry("poe_budget", 1, "1", html(D1, "x")), applyRun));
  }, /is switching_capacity, the replacement is poe_budget/);
await refuses("applyMerge on a part that does not exist", () => withTx((c) => applyMerge(c, 999999, entry("poe_budget", 1, "1", html(D1, "x")), applyRun)), /part 999999 does not exist/);
{
  // invariant 6 over everything written so far: superseded_at never precedes the newer row's created_at
  const bad = await query(`SELECT count(*)::int AS n FROM facts o JOIN facts n ON n.id = o.superseded_by WHERE o.superseded_at < n.created_at`);
  const self = await query(`SELECT count(*)::int AS n FROM facts WHERE superseded_by = id`);
  check("no superseded row points forward in time and no parked self-reference survived", bad.rows[0].n === 0 && self.rows[0].n === 0);
  // invariant 5: every conflict-state fact has an open conflicts row
  const orphan = await query(`SELECT count(*)::int AS n FROM facts f WHERE f.state = 'conflict' AND f.superseded_by IS NULL
    AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL)`);
  check("every held field has an open conflicts row", orphan.rows[0].n === 0);
}

// =================================================================================================
// lifecycle
// =================================================================================================
{
  const a = await upsertLifecycle(p1.id, { status: "active", end_of_sale_date: "2027-01-31", verified_at: "2026-01-01", doc_id: D1, source_url: "https://www.cisco.com/ds/cat9200.html" }, applyRun);
  check("lifecycle: first upsert inserts", a.winner === "incoming" && a.row.end_of_sale_date === "2027-01-31" && a.row.status === "active");
  const b = await upsertLifecycle(p1.id, { status: "eol_announced", end_of_sale_date: null, last_day_of_support: "2032-01-31", verified_at: "2026-02-01", doc_id: D2, bulletin_id: "EOL13773" }, applyRun);
  check("lifecycle: a newer verified_at wins the status, fills new dates, and NEVER blanks a filled date",
    b.winner === "incoming" && b.row.status === "eol_announced" && b.row.end_of_sale_date === "2027-01-31" && b.row.last_day_of_support === "2032-01-31"
    && b.row.bulletin_id === "EOL13773" && b.row.verified_at === "2026-02-01");
  const c = await upsertLifecycle(p1.id, { status: "unknown", end_of_sale_date: "2020-01-01", verified_at: "2025-06-01", doc_id: D3 }, applyRun);
  check("lifecycle: an OLDER verified_at loses on every stated column and only fills gaps",
    c.winner === "existing" && c.row.status === "eol_announced" && c.row.end_of_sale_date === "2027-01-31" && c.row.verified_at === "2026-02-01");
  const d = await upsertLifecycle(p1.id, { status: "end_of_sale", end_of_sale_date: "2027-02-28", verified_at: "2026-02-01", doc_id: DPDF }, applyRun);
  check("lifecycle: dated the same day, the lower-tier source (PDF bulletin, tier 1) wins over HTML (tier 2)",
    d.winner === "incoming" && d.row.status === "end_of_sale" && d.row.end_of_sale_date === "2027-02-28" && d.row.doc_id === DPDF);
  const e = await upsertLifecycle(p1.id, { status: "unknown", end_of_sale_date: "2028-01-01", verified_at: "2026-02-01", tier: 3 }, applyRun);
  check("lifecycle: dated the same day, a higher-tier source does not displace the stored row",
    e.winner === "existing" && e.row.status === "end_of_sale" && e.row.end_of_sale_date === "2027-02-28" && e.row.doc_id === DPDF);
  const f = await upsertLifecycle(p1.id, { status: "end_of_sale", verified_at: "2026-02-01", doc_id: DPDF }, applyRun);
  check("lifecycle: re-running the same input is a no-op (ties keep what is stored)",
    f.winner === "existing" && f.row.end_of_sale_date === "2027-02-28" && f.row.last_day_of_support === "2032-01-31");
}
{
  refusals++;
  const m = mergeLifecycle(
    { status: "active", end_of_sale_date: "2027-01-31", verified_at: "2026-01-01", tier: 2 },
    { status: "end_of_sale", end_of_sale_date: null, verified_at: "2030-01-01", tier: 2 });
  check("SABOTAGE mergeLifecycle: a newer row with a NULL date cannot blank the stored date",
    m.winner === "incoming" && m.merged.end_of_sale_date === "2027-01-31" && m.merged.status === "end_of_sale");
  const u = mergeLifecycle({ status: "active", verified_at: "2026-01-01", tier: 2 }, { status: "unknown", tier: 2 });
  check("mergeLifecycle: an undated row never displaces a dated one", u.winner === "existing" && u.merged.status === "active");
}

// =================================================================================================
// relations
// =================================================================================================
{
  const r = await upsertRelation(p1.id, { to_sku: "c9200l-24p-4g=", kind: "successor", tier: 2, doc_id: D1 }, applyRun);
  check("upsertRelation resolves to_part_id case-insensitively within the vendor and keeps to_sku as written",
    r.to_part_id === p1spare.id && r.to_sku === "c9200l-24p-4g=" && r.kind === "successor");
  const g = await upsertRelation(p1.id, { to_sku: "GLC-TE", kind: "compatible", tier: 2, source_url: "https://tmgmatrix.cisco.com/" }, applyRun);
  check("upsertRelation keeps to_sku with a NULL to_part_id when the target is not in the catalogue", g.to_part_id === null && g.to_sku === "GLC-TE");
  const glc = await upsertPart({ vendor: "cisco", sku: "GLC-TE", category: "transceiver" });
  const g2 = await upsertRelation(p1.id, { to_sku: "GLC-TE", kind: "compatible", tier: 1, doc_id: DPDF }, applyRun);
  check("upsertRelation re-resolves once the target exists, takes the lower tier and its provenance",
    g2.id === g.id && g2.to_part_id === glc.id && g2.tier === 1 && g2.doc_id === DPDF && g2.source_url === "https://tmgmatrix.cisco.com/");
  await upsertPart({ vendor: "hpe", sku: "J9773A", category: "switches" });
  const x = await upsertRelation(p1.id, { to_sku: "J9773A", kind: "equivalent", tier: 2 }, applyRun);
  refusals++;
  check("SABOTAGE upsertRelation never resolves across vendors (an HPE SKU is not a Cisco part)", x.to_part_id === null && x.to_sku === "J9773A");
}
await refuses("upsertRelation with an unknown kind", () => upsertRelation(p1.id, { to_sku: "X", kind: "friend" as never, tier: 2 }, applyRun), /invalid input value for enum relation_kind/);

// =================================================================================================
// images
// =================================================================================================
{
  const img = await upsertImage(p1.id, { role: "primary", source_url: "https://www.cisco.com/c/dam/c9200l.png", doc_id: D1, assignment_method: "caption-sku", confidence: 0.6 }, applyRun);
  const again = await upsertImage(p1.id, { role: "primary", source_url: "https://www.cisco.com/c/dam/c9200l.png", assignment_method: "product-figure", confidence: 0.9, license_note: "vendor product photo (Cisco CDN)" }, applyRun);
  const lower = await upsertImage(p1.id, { role: "primary", source_url: "https://www.cisco.com/c/dam/c9200l.png", assignment_method: "series", confidence: 0.3 }, applyRun);
  const row = await query("SELECT * FROM images WHERE id = $1", [img]);
  check("upsertImage is one row per (part, role, url); higher confidence brings its method, lower does not",
    again === img && lower === img && row.rows[0].confidence === 0.9 && row.rows[0].assignment_method === "product-figure" && row.rows[0].doc_id === D1
    && row.rows[0].license_note === "vendor product photo (Cisco CDN)");
  await setImageVariant(img, "original", { storage_path: "cisco/c9200l-24p-4g.png", width: 1600, height: 900, bytes: 120000, format: "png", sha256: "a".repeat(64) });
  await setImageVariant(img, "webp-800", { storage_path: "cisco/c9200l-24p-4g-800.webp", width: 800, height: 800, bytes: 30000, format: "webp", sha256: "b".repeat(64), background: "white" });
  await setImageVariant(img, "webp-800", { storage_path: "cisco/c9200l-24p-4g-800.webp", width: 800, height: 800, bytes: 29000, format: "webp", sha256: "c".repeat(64), background: "white" });
  const vars = await query("SELECT variant, bytes, sha256 FROM image_variants WHERE image_id = $1 ORDER BY variant", [img]);
  const mirrored = await query("SELECT storage_path, width, height, bytes, format FROM images WHERE id = $1", [img]);
  check("setImageVariant upserts per variant and the original mirrors onto the image row",
    vars.rows.length === 2 && vars.rows[1].bytes === 29000 && vars.rows[1].sha256 === "c".repeat(64)
    && mirrored.rows[0].storage_path === "cisco/c9200l-24p-4g.png" && mirrored.rows[0].width === 1600 && mirrored.rows[0].format === "png");
  await setMerchantReadiness(img, false, ["below-800px", "not-white-background"]);
  const mr = await query("SELECT merchant_ready, merchant_issues FROM images WHERE id = $1", [img]);
  check("setMerchantReadiness records the reasons", mr.rows[0].merchant_ready === false && j(mr.rows[0].merchant_issues) === j(["below-800px", "not-white-background"]));
  await refuses("setMerchantReadiness ready=true with issues", () => setMerchantReadiness(img, true, ["below-800px"]), /cannot be ready with issues/);
  await refuses("setMerchantReadiness on a missing image", () => setMerchantReadiness(999999, true, []), /does not exist/);
}

// =================================================================================================
// aliases
// =================================================================================================
{
  const a = await upsertAlias(p1.id, { kind: "gtin", value: "00882658684579", tier: 4, source_url: "https://www.provantage.com/x" }, applyRun);
  const b = await upsertAlias(p1.id, { kind: "gtin", value: " 00882658684579 ", tier: 3, doc_id: D3 }, applyRun);
  check("upsertAlias is one row per (part, kind, value), trims, keeps the lower tier with its provenance",
    a.id === b.id && b.tier === 3 && b.doc_id === D3 && b.source_url === "https://www.provantage.com/x" && b.value === "00882658684579");
  await refuses("upsertAlias with an unknown kind names it", () => upsertAlias(p1.id, { kind: "barcode" as never, value: "1", tier: 3 }, applyRun), /unknown alias kind "barcode"/);
  await refuses("upsertAlias with an empty value", () => upsertAlias(p1.id, { kind: "upc", value: "  ", tier: 3 }, applyRun), /empty upc value/);
}

// =================================================================================================
// source checks
// =================================================================================================
{
  const src = await query<{ id: number }>("SELECT id FROM sources WHERE slug = 'cisco-datasheets'");
  const sid = src.rows[0].id;
  const a = await recordSourceCheck(p1.id, sid, { doc_id: D1, outcome: "no_facts", facts_found: 0, fields_found: [] }, applyRun);
  const b = await recordSourceCheck(p1.id, sid, { doc_id: D1, outcome: "facts_found", facts_found: 2, fields_found: ["switching_capacity", "poe_budget"] }, applyRun);
  const c = await recordSourceCheck(p1.id, sid, { outcome: "not_listed", facts_found: 0, fields_found: [] }, applyRun);
  const c2 = await recordSourceCheck(p1.id, sid, { outcome: "fetch_failed", facts_found: 0, fields_found: [] }, applyRun);
  check("recordSourceCheck upserts on (part, source, doc) — with and without a document — and keeps the newest outcome",
    a.id === b.id && b.outcome === "facts_found" && j(b.fields_found) === j(["switching_capacity", "poe_budget"]) && c.id !== a.id && c2.id === c.id && c2.outcome === "fetch_failed");
  await refuses("recordSourceCheck outcome facts_found with facts_found=0", () => recordSourceCheck(p1.id, sid, { outcome: "facts_found", facts_found: 0, fields_found: [] }, applyRun), /facts_found=0/);
  await refuses("recordSourceCheck with an outcome outside the CHECK", () => recordSourceCheck(p1.id, sid, { outcome: "maybe" as never, facts_found: 0, fields_found: [] }, applyRun), /outcome_check|violates check constraint/);
}

// =================================================================================================
// close the gated run properly, and the change feed
// =================================================================================================
{
  await closeRun(applyRun, "succeeded", { inserted: 5 }, { precision: 0.99, recall: 1, passed: true });
  const r = await getRun(applyRun);
  check("the apply-specs run closes once it carries a passing gate", r?.status === "succeeded" && (r?.gate as { passed: boolean }).passed === true);
  const touched = await query("SELECT updated_at > created_at AS bumped FROM parts WHERE id = $1", [p1.id]);
  check("writing facts/lifecycle/relations/images bumped parts.updated_at (change feed)", touched.rows[0].bumped === true);
}

// =================================================================================================
// a failed run leaves NOTHING behind
//
// apply-* writes one transaction per part, so a throw part-way through leaves the parts already
// merged COMMITTED. Until 4 Sep 2026 those rows stayed, hidden from two readers by
// factRunSucceeded() and counted by every aggregate reader that had not been told — run #15's rows
// had to be deleted by hand. withRun now ROLLS THEM BACK, and the invariant is checked here:
// no CURRENT fact belongs to a run that is not succeeded.
// =================================================================================================
/** The invariant, as a query: every current fact either predates runs or belongs to a succeeded one. */
async function currentFactsOfUnsucceededRuns(): Promise<{ id: number; field_key: string; status: string }[]> {
  const r = await query<{ id: number; field_key: string; status: string }>(
    `SELECT f.id, f.field_key, r.status::text AS status
       FROM facts f JOIN runs r ON r.id = f.run_id
      WHERE f.superseded_by IS NULL AND r.status <> 'succeeded'`);
  return r.rows;
}
{
  const p3 = await upsertPart({ vendor: "cisco", sku: "C9300X-24Y", category: "switches", product_class: "hardware" });
  // a value and a confirmed gap from a run that SUCCEEDED: what the rollback has to give back
  const good = await withRun("apply-specs", {}, async (id) => {
    await withTx((c) => applyMerge(c, p3.id, entry("poe_budget", 400, "400 W", html(D1, "t1:r1:c1")), id));
    await withTx((c) => writeGapConfirmed(c, p3.id, "ieee_standards", id));
    return { stats: {}, gate: { precision: 1, recall: 1, passed: true } };
  });
  const keptId = (await currentFact(p3.id, "poe_budget", pool))?.id;
  const gapId = (await currentFact(p3.id, "ieee_standards", pool))?.id;

  let failedId = 0, threw = "", midFacts = 0;
  try {
    await withRun("apply-specs", {}, async (id) => {
      failedId = id;
      await withTx((c) => applyMerge(c, p3.id, entry("poe_budget", 900, "900 W", html(D2, "t2:r2:c2")), id));            // conflict: flips the kept row's state
      await withTx((c) => applyMerge(c, p3.id, entry("ieee_standards", ["IEEE 802.1Q"], "802.1Q", html(D2, "t2:r3:c1")), id)); // supersedes the gap row
      await withTx((c) => applyMerge(c, p3.id, entry("switching_capacity", 128, "128 Gbps", html(D2, "t2:r4:c1")), id));  // a brand-new fact
      midFacts = (await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE run_id = $1", [id])).rows[0].n;
      throw new Error("extractor exploded half way");
    }, { partial: () => ({ stats: { parts_touched: 1 }, progress: "1/2 parts merged, last C9300X-24Y" }) });
  } catch (e) { threw = (e as Error).message; }

  check("setup: the failing run really did commit facts before it threw", midFacts === 2 && threw === "extractor exploded half way");
  {
    const left = await query<{ n: number }>("SELECT count(*)::int AS n FROM facts WHERE run_id = $1", [failedId]);
    const ev = await query<{ n: number }>("SELECT count(*)::int AS n FROM fact_evidence WHERE run_id = $1", [failedId]);
    const cf = await query<{ n: number }>("SELECT count(*)::int AS n FROM conflicts WHERE run_id = $1", [failedId]);
    check("a failed run's facts, evidence and conflicts are all gone", left.rows[0].n === 0 && ev.rows[0].n === 0 && cf.rows[0].n === 0);
  }
  {
    const poe = await currentFact(p3.id, "poe_budget", pool);
    check("the row the failed run only flipped to `conflict` is verified again, same row, same value",
      poe?.id === keptId && poe?.value === 400 && poe?.state === "verified", `got ${j({ id: poe?.id, v: poe?.value, s: poe?.state })}`);
    const gap = await currentFact(p3.id, "ieee_standards", pool);
    check("the gap row the failed run superseded is CURRENT again (superseded_by/at cleared)",
      gap?.id === gapId && gap?.state === "gap_confirmed" && gap?.superseded_by === null && gap?.superseded_at === null);
    const sc = await currentFact(p3.id, "switching_capacity", pool);
    check("a fact the failed run created from nothing is gone entirely", sc === null);
  }
  {
    const r = await getRun(failedId);
    const back = (r?.stats as { rolled_back?: { facts_removed: number } })?.rolled_back;
    check("the run row keeps its partial stats and progress AND records the rollback",
      r?.status === "failed" && (r?.stats as { parts_touched?: number }).parts_touched === 1
      && back?.facts_removed === 2 && /progress=1\/2 parts merged/.test(String(r?.notes)) && /rolled_back=2 facts/.test(String(r?.notes)),
      `notes=${String(r?.notes).slice(0, 160)}`);
    const g = await getRun(good.runId);
    check("the succeeded run's own rows were not touched", g?.status === "succeeded");
  }
  check("INVARIANT no current fact belongs to a run that is not succeeded", (await currentFactsOfUnsucceededRuns()).length === 0);

  // ---- SABOTAGE: the invariant check must FAIL when a fact IS left under a failed run ----------
  // Written the way the old code left it: a raw INSERT under the failed run id. If the check
  // cannot see this, it is not a check.
  {
    refusals++;
    await query(
      `INSERT INTO facts (part_id, field_key, value, raw, state, tier, method, doc_id, run_id)
       VALUES ($1, 'switching_capacity', '999', '999 Gbps', 'verified', 2, 'html_table', $2, $3)`,
      [p3.id, D2, failedId]);
    const dirty = await currentFactsOfUnsucceededRuns();
    check("SABOTAGE a fact left under a failed run is CAUGHT by the invariant",
      dirty.length === 1 && dirty[0].field_key === "switching_capacity" && dirty[0].status === "failed",
      `the invariant saw ${dirty.length} rows — it would not have caught run #15`);
    const back = await withTx((c) => rollbackRun(c, failedId));
    const after = await currentFactsOfUnsucceededRuns();
    check("SABOTAGE and the rollback removes it", back.facts_removed === 1 && after.length === 0);
  }
}

// =================================================================================================
// sabotage: the database-name guard, in a fresh process (loadEnv caches per process)
// =================================================================================================
{
  refusals++;
  const tsx = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const r = spawnSync(tsx, [HERE, "--sabotage-db-url"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", env: { ...process.env } });
  const out = (r.stdout + r.stderr).trim();
  check("SABOTAGE resolveDatabaseUrl refuses a DATABASE_URL_TEST whose database is not *_test",
    r.status === 0 && /must end in _test/.test(out), `exit ${r.status}: ${out.split("\n").slice(-3).join(" | ")}`);
}

await closePool();

const total = pass + misses.length;
console.log(`\nstore: ${pass}/${total} cases (${refusals} of them sabotage)`);
if (refusals < 15) misses.push(`suite has only ${refusals} sabotage cases (expected >= 15)`);
if (misses.length) { console.log("\nMISSES:\n" + misses.map((m) => "  " + m).join("\n")); process.exit(1); }
console.log("every refusal was for the stated reason");
