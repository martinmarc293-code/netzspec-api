// tests/db/remerge.test.ts — proof for the store half of the 4 Sep 2026 merge fixes and for
// `ingest remerge`, against the throwaway database.
//
//   NETZSPEC_DB=test npx tsx tests/db/remerge.test.ts
//
// The three cases the work was specified around are here by name, each with the sabotage twin that
// makes it mean something:
//
//   an accessory's inherited chassis value is RETRACTED   a chassis's own inherited value is not
//   a set-equal list RESOLVES                             a two-document disagreement stays OPEN
//   a fictional tier is restamped                         an operator's tier 0 is not
//
// plus the two refusals the gate exists for: a retraction standing on a fact that is not inherited
// is a hard failure (it would delete the only real value a part has), and a conflict that reached
// no decision fails recall rather than being skipped in silence.
import {
  query, closePool, getPool, resolveDatabaseUrl, databaseName, withTx, openRun, closeRun,
  ensureCategory, upsertPart, docIdFor, ensureSourceDoc, linkDocParts,
  applyMerge, currentFact, factHistory, restampTiers, retractFact, insertFact,
} from "../../src/store/index.js";
import type { SpecEntry } from "../../src/core/specMerge.js";
import { decide, gateRemerge, retypeMismatchedFacts, main as remergeMain, type ConflictRow, type Decision } from "../../src/pipeline/remerge.js";

if (process.env.NETZSPEC_DB !== "test") {
  console.error("refusing: run with NETZSPEC_DB=test (this suite truncates tables)");
  process.exit(1);
}
const dbName = databaseName(resolveDatabaseUrl());
if (!/_test\d*$/.test(dbName)) { console.error(`refusing: database "${dbName}" is not a _test database`); process.exit(1); }
console.log(`remerge.test: database ${dbName}`);

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}

await query(`TRUNCATE facts, fact_evidence, conflicts, lifecycle, relations, images, part_aliases,
  part_source_checks, completeness, doc_parts, parts, source_docs, runs CASCADE`);
await query(`INSERT INTO field_dictionary (key, type, unit, label_en, label_de) VALUES
  ('altitude_max', 'n', 'm', 'Maximum altitude', 'Maximale Hoehe'),
  ('ieee_standards', 'ls', NULL, 'IEEE standards', 'IEEE-Standards'),
  ('qos_features', 'ls', NULL, 'QoS features', 'QoS-Funktionen')
  ON CONFLICT (key) DO NOTHING`);
// the dictionary copy in the database can lag the code copy; the retype pass reads the CODE one
await query(`UPDATE field_dictionary SET type = 'ls' WHERE key = 'qos_features'`);

// both categories must already be seeded by migration; ensureCategory throws if not
await ensureCategory("switches");
await ensureCategory("transceiver");

const chassis = (await upsertPart({ vendor: "cisco", sku: "C9200L-24P-4G", category: "switches", family: "Cisco Catalyst 9200", product_class: "hardware" })).id;
// the optic carries a family and a category that BOTH look right — this is the real corpus shape:
// CWDM-SFP-1610= is category `switches` with the chassis's own family. Only the SKU shape is left.
const optic = (await upsertPart({ vendor: "cisco", sku: "SFP-10G-LR=", category: "switches", family: "Cisco Catalyst 9200", product_class: "hardware" })).id;
const licence = (await upsertPart({ vendor: "cisco", sku: "L-C9200-24-E-A", category: "switches", family: "Cisco Catalyst 9200", product_class: "license" })).id;
const realOptic = (await upsertPart({ vendor: "cisco", sku: "QSFP-40G-SR4", category: "transceiver", family: "Cisco 40G QSFP+ Modules", product_class: "hardware" })).id;

const urlA = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/dsA.html";
const urlB = "https://www.cisco.com/c/en/us/products/collateral/switches/nexus-7000-series-switches/dsB.html";
const urlP = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/dsA.pdf";
const docA = docIdFor(urlA), docB = docIdFor(urlB), docP = docIdFor(urlP);
await ensureSourceDoc({ url: urlA, doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });
await ensureSourceDoc({ url: urlB, doc_type: "vendor_datasheet_html", vendor: "cisco", fetched_at: "2026-09-01" });
await ensureSourceDoc({ url: urlP, doc_type: "vendor_datasheet_pdf", vendor: "cisco", fetched_at: "2026-09-01" });
await linkDocParts(docA, [chassis, optic, licence], getPool());

const seedRun = await openRun("apply-specs", { inputs: { seed: true } });
const entry = (o: Partial<SpecEntry> & { k: string; value: unknown }): SpecEntry => ({
  raw: String(o.value), state: "verified", unit: undefined,
  prov: { tier: 2, method: "html_table", doc_id: docA, locator: "t1:r1:c1", norm_v: "1.5.0" },
  ...o,
} as SpecEntry);

// =================================================================================================
// 1. the inheritance gate, in the STORE, so every pipeline passes through it
// =================================================================================================
{
  const inherited = entry({ k: "qos_features", value: ["802.1p"], unit: undefined, inherited: true, inherited_from: "catalyst-9200-series-switches" });
  const onChassis = await withTx((c) => applyMerge(c, chassis, inherited, seedRun));
  check("a chassis may inherit from its own series datasheet", onChassis.action === "insert", `got ${onChassis.action}`);

  const onOptic = await withTx((c) => applyMerge(c, optic, inherited, seedRun));
  check("SABOTAGE an optic listed in the chassis datasheet may NOT inherit its QoS features",
    onOptic.action === "refused_inherit" && onOptic.rule === "component:SFP", `got ${onOptic.action} ${onOptic.rule}`);
  check("and the refusal names the reason", /INHERIT_NOT_A_SUBJECT/.test(onOptic.refused ?? ""), onOptic.refused);
  check("nothing was written for the refused entry", (await currentFact(optic, "qos_features", getPool())) === null);

  const onLicence = await withTx((c) => applyMerge(c, licence, inherited, seedRun));
  check("SABOTAGE a licence may not inherit either", onLicence.action === "refused_inherit" && onLicence.rule === "class:license");

  const perSku = entry({ k: "qos_features", value: ["802.1p"], unit: undefined });
  const direct = await withTx((c) => applyMerge(c, optic, perSku, seedRun));
  check("the same value stated PER-SKU for the optic is written: only inheritance is refused",
    direct.action === "insert", `got ${direct.action}`);
}

// =================================================================================================
// 2. restampTiers — the fictional tier gap
// =================================================================================================
{
  // the Atlas shape: tier 1 on an HTML datasheet, which every other writer calls tier 2
  const stale = entry({ k: "altitude_max", value: 3048, unit: "m" });
  stale.prov = { tier: 1, method: "html_table", doc_id: docA, locator: "t2:r2:c1", norm_v: "1.0.0" };
  const id = await withTx((c) => insertFact(c, realOptic, stale, seedRun));
  const t0 = entry({ k: "altitude_max", value: 3048, unit: "m" });
  t0.prov = { tier: 0, method: "hexcat_seed", doc_id: docA };
  await withTx((c) => insertFact(c, licence, t0, seedRun));
  const pdf = entry({ k: "altitude_max", value: 3048, unit: "m" });
  pdf.prov = { tier: 1, method: "pdf_table", doc_id: docP, locator: "p3", norm_v: "1.5.0" };
  await withTx((c) => insertFact(c, chassis, pdf, seedRun));

  const dry = await restampTiers(getPool(), seedRun, { commit: false });
  check("the dry restamp counts the html_table tier-1 rows", dry.facts_restamped === 1, JSON.stringify(dry.by_change));
  const still = await query<{ tier: number }>("SELECT tier FROM facts WHERE id = $1", [id]);
  check("SABOTAGE a dry restamp writes nothing", still.rows[0].tier === 1);

  const wet = await withTx((c) => restampTiers(c, seedRun, { commit: true }));
  check("the restamp corrects the fact", wet.facts_restamped === 1
    && (await query<{ tier: number }>("SELECT tier FROM facts WHERE id = $1", [id])).rows[0].tier === 2);
  check("and its evidence row with it",
    (await query<{ tier: number }>("SELECT tier FROM fact_evidence WHERE fact_id = $1", [id])).rows[0].tier === 2);
  check("SABOTAGE the operator's tier 0 is not touched by the document type",
    (await currentFact(licence, "altitude_max", getPool()))?.tier === 0);
  check("SABOTAGE a PDF fact stays tier 1",
    (await currentFact(chassis, "altitude_max", getPool()))?.tier === 1);
  const again = await restampTiers(getPool(), seedRun, { commit: false });
  check("a second restamp has nothing to do", again.facts_restamped === 0);
}

// =================================================================================================
// 3. retractFact — withdrawn, never deleted
// =================================================================================================
{
  const before = await currentFact(chassis, "qos_features", getPool());
  const r = await withTx((c) => retractFact(c, before!.id, "component:SFP", seedRun));
  const after = await currentFact(chassis, "qos_features", getPool());
  check("a retracted fact leaves a gap row, not a value", after?.state === "gap_unattempted" && after?.value === null);
  check("the row names why it went", /^retracted:component:SFP$/.test(after?.method ?? ""));
  const hist = await factHistory(chassis, "qos_features", getPool());
  check("the withdrawn value is still in history with its evidence",
    hist.length === 2 && JSON.stringify(hist[0].value) === JSON.stringify(["802.1p"]) && hist[0].superseded_by === r.newId);
  check("and its evidence row was not deleted",
    ((await query("SELECT 1 FROM fact_evidence WHERE fact_id = $1", [hist[0].id])).rowCount ?? 0) === 1);
}

// =================================================================================================
// 4. decide() — the three named cases, driven as rows
// =================================================================================================
const row = (o: Partial<ConflictRow>): ConflictRow => ({
  id: 1, run_id: 1, part_id: chassis, field_key: "altitude_max", kept: 3048, rejected: 3000, reason: "x",
  kept_evidence: { tier: 2, method: "html_table", doc_id: docA, norm_v: "1.0.0" },
  rejected_evidence: { tier: 2, method: "html_table", doc_id: docB, norm_v: "1.5.0" },
  kept_raw: null, rejected_raw: null,
  sku: "C9200L-24P-4G", product_class: "hardware", part_family: "Cisco Catalyst 9200", category: "switches",
  fact_id: 99, fact_value: 3048, fact_unit: "m", fact_raw: "10,000 ft. (3000 meters)", fact_state: "conflict",
  fact_tier: 1, fact_method: "html_table", fact_doc: docA, fact_locator: "t2:r2:c1", fact_extracted_at: "2026-09-01",
  fact_norm_v: "1.0.0", inherited: false, inherited_from: null,
  fact_doctype: "vendor_datasheet_html", rejected_doctype: "vendor_datasheet_html",
  ...o,
});
{
  const d = decide(row({}));
  check("one measurement stated imperially and metrically is an agreement", d.kind === "agree" && d.rule === "numeric_tolerance", JSON.stringify(d));

  const setEqual = decide(row({
    field_key: "ieee_standards", fact_unit: null,
    fact_value: ["Optional L3", "LAN"], rejected: ["optional l3", "lan"],
  }));
  check("a set-equal list resolves", setEqual.kind === "agree" && setEqual.rule === "set_equal", JSON.stringify(setEqual));

  const real = decide(row({ fact_value: 3048, rejected: 1800 }));
  check("SABOTAGE a real two-document disagreement stays OPEN", real.kind === "open" && real.rule === "cross_doc_disagreement", JSON.stringify(real));

  const accessory = decide(row({
    part_id: optic, sku: "SFP-10G-LR=", inherited: true, inherited_from: "catalyst-9200-series-switches",
  }));
  check("an accessory's inherited chassis value is RETRACTED", accessory.kind === "retract" && accessory.rule === "component:SFP", JSON.stringify(accessory));

  const chassisOwn = decide(row({ inherited: true, inherited_from: "catalyst-9200-series-switches" }));
  check("SABOTAGE the chassis's own inherited value is NOT retracted", chassisOwn.kind !== "retract", JSON.stringify(chassisOwn));

  const sameDoc = decide(row({ rejected_evidence: { tier: 2, method: "html_table", doc_id: docA, norm_v: "1.5.0" }, rejected: 1800 }));
  check("the same document read by a newer normaliser would be superseded", /same_doc_reextraction/.test(sameDoc.rule), JSON.stringify(sameDoc));
  check("but without the source string it is REAPPLY, never a fabricated raw", sameDoc.kind === "reapply", JSON.stringify(sameDoc));
  const withRaw = decide(row({ rejected_evidence: { tier: 2, method: "html_table", doc_id: docA, norm_v: "1.5.0" }, rejected: 1800, rejected_raw: "1800 m" }));
  check("with the source string (migration 0008) it is a rewrite", withRaw.kind === "rewrite", JSON.stringify(withRaw));

  const gone = decide(row({ fact_id: null }));
  check("a conflict whose field no longer holds a fact is SKIPPED by name, not silently", gone.kind === "skip" && gone.rule === "no_current_fact");
}

// =================================================================================================
// 5. the gate must be able to fail
// =================================================================================================
{
  const rows = [row({ id: 1 }), row({ id: 2, fact_value: 3048, rejected: 1800 })];
  const good = new Map<number, Decision>([[1, { kind: "agree", rule: "numeric_tolerance" }], [2, { kind: "open", rule: "cross_doc_disagreement" }]]);
  check("the gate passes on sound decisions", gateRemerge(rows, good, 200).passed);

  const missing = new Map<number, Decision>([[1, { kind: "agree", rule: "numeric_tolerance" }]]);
  const g2 = gateRemerge(rows, missing, 200);
  check("SABOTAGE a conflict that reached no decision fails RECALL", !g2.passed && g2.recall === 0.5);

  const badRetract = new Map<number, Decision>([[1, { kind: "retract", rule: "component:SFP", reason: "x" }], [2, { kind: "open", rule: "y" }]]);
  const g3 = gateRemerge(rows, badRetract, 200);
  check("SABOTAGE retracting a fact that is not INHERITED fails the gate",
    !g3.passed && g3.misses.some((m) => /RETRACT_NOT_INHERITED/.test(m)), JSON.stringify(g3.misses));

  const notReally = [row({ id: 3, fact_value: 5, rejected: 5 })];
  const g4 = gateRemerge(notReally, new Map([[3, { kind: "agree", rule: "set_equal" } as Decision]]), 200);
  check("SABOTAGE an 'agreement' between two IDENTICAL values means the conflict was never real",
    !g4.passed && g4.misses.some((m) => /AGREE_WAS_NEVER_A_CONFLICT/.test(m)), JSON.stringify(g4.misses));
}

// =================================================================================================
// 6. the retype pass
// =================================================================================================
{
  const asString = entry({ k: "qos_features", value: "802.1p, 4 hardware queues" as unknown });
  asString.raw = "802.1p, 4 hardware queues";
  await withTx((c) => insertFact(c, realOptic, asString, seedRun));
  const dry = await retypeMismatchedFacts(getPool(), seedRun, { commit: false, examples: 2, keys: ["qos_features"] });
  check("a stored string under an `ls` field is found", dry.checked === 1 && dry.changed === 1, JSON.stringify(dry));
  check("SABOTAGE a dry retype writes nothing",
    typeof (await currentFact(realOptic, "qos_features", getPool()))?.value === "string");
  await withTx((c) => retypeMismatchedFacts(c, seedRun, { commit: true, examples: 2, keys: ["qos_features"] }));
  const after = await currentFact(realOptic, "qos_features", getPool());
  check("the value is re-read from raw as a list", JSON.stringify(after?.value) === JSON.stringify(["802.1p", "4 hardware queues"]), JSON.stringify(after?.value));
  check("and the provenance is kept", after?.doc_id === docA && after?.tier === 2);
  const other = await retypeMismatchedFacts(getPool(), seedRun, { commit: false, examples: 2, keys: [] });
  check("a field outside the scope is COUNTED, never rewritten", other.checked === 0 && other.skipped_other_fields >= 0);
}

await closeRun(seedRun, "succeeded", { seed: true }, { precision: 1, recall: 1, passed: true });

// =================================================================================================
// 7. end to end: `ingest remerge --commit`
// =================================================================================================
{
  const run = await openRun("apply-specs", { inputs: { e2e: true } });
  // an accessory holding an inherited chassis value, exactly as the Atlas migration left them
  const bad = entry({ k: "ieee_standards", value: ["802.1D"], inherited: true, inherited_from: "catalyst-9200-series-switches" });
  bad.prov = { tier: 1, method: "html_table", doc_id: docA, locator: "t9:r1:c1", norm_v: "1.0.0" };
  const badId = await withTx((c) => insertFact(c, optic, bad, run));
  await query("UPDATE facts SET state = 'conflict' WHERE id = $1", [badId]);
  await query(`INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id)
    VALUES ($1, 'ieee_standards', '["802.1D"]'::jsonb, '["802.1Q"]'::jsonb, 'seeded',
      $2::jsonb, $3::jsonb, $4)`,
    [optic, JSON.stringify({ tier: 1, method: "html_table", doc_id: docA, norm_v: "1.0.0" }),
      JSON.stringify({ tier: 2, method: "html_table", doc_id: docB, norm_v: "1.5.0" }), run]);
  // a real disagreement between two documents on a part that IS the document's subject
  const good = entry({ k: "ieee_standards", value: ["802.1D"] });
  good.prov = { tier: 2, method: "html_table", doc_id: docA, locator: "t9:r2:c1", norm_v: "1.5.0" };
  const goodId = await withTx((c) => insertFact(c, chassis, good, run));
  await query("UPDATE facts SET state = 'conflict' WHERE id = $1", [goodId]);
  await query(`INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_evidence, rejected_evidence, run_id)
    VALUES ($1, 'ieee_standards', '["802.1D"]'::jsonb, '["802.3ad"]'::jsonb, 'seeded',
      $2::jsonb, $3::jsonb, $4)`,
    [chassis, JSON.stringify({ tier: 2, method: "html_table", doc_id: docA, norm_v: "1.5.0" }),
      JSON.stringify({ tier: 2, method: "html_table", doc_id: docB, norm_v: "1.5.0" }), run]);
  await closeRun(run, "succeeded", { e2e: true }, { precision: 1, recall: 1, passed: true });

  await remergeMain(["--run", String(run), "--no-retype"]);
  const openAfterDry = await query("SELECT count(*)::int AS n FROM conflicts WHERE run_id = $1 AND resolved_at IS NULL", [run]);
  check("SABOTAGE a dry remerge resolves nothing", (openAfterDry.rows[0] as { n: number }).n === 2);

  await remergeMain(["--run", String(run), "--commit", "--no-retype"]);
  const optFact = await currentFact(optic, "ieee_standards", getPool());
  check("the accessory's inherited value is retracted", optFact?.state === "gap_unattempted" && /^retracted:component:SFP$/.test(optFact?.method ?? ""));
  const chFact = await currentFact(chassis, "ieee_standards", getPool());
  check("the chassis's disputed value is untouched and still held", chFact?.state === "conflict" && JSON.stringify(chFact?.value) === JSON.stringify(["802.1D"]));
  const res = await query<{ resolution: string | null; resolved_by: string | null; part_id: number }>(
    "SELECT resolution, resolved_by, part_id FROM conflicts WHERE run_id = $1 ORDER BY part_id", [run]);
  const opticRow = res.rows.find((r) => r.part_id === optic);
  const chassisRow = res.rows.find((r) => r.part_id === chassis);
  check("the retraction is recorded on the conflicts row",
    /^rule:inheritance_retracted:component:SFP$/.test(opticRow?.resolution ?? "") && opticRow?.resolved_by === "remerge", JSON.stringify(opticRow));
  check("SABOTAGE the real disagreement is still open", chassisRow?.resolution === null);
  const runs = await query<{ status: string; gate: unknown; stats: Record<string, unknown> }>(
    "SELECT status, gate, stats FROM runs WHERE kind = 'apply-remerge' ORDER BY id DESC LIMIT 1");
  check("the remerge ran as a gated apply run", runs.rows[0]?.status === "succeeded" && (runs.rows[0]?.gate as { passed: boolean })?.passed === true);
  check("and its stats record the retraction", Number(runs.rows[0]?.stats.facts_retracted) === 1, JSON.stringify(runs.rows[0]?.stats));
}

console.log(`\n${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} remerge case(s) wrong.`);
  await closePool();
  process.exit(1);
}
console.log("the store refuses an inheritance the document does not justify, and remerge retracts, resolves and holds exactly as stated");
await closePool();
