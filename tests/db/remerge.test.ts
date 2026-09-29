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
import { NONSENSICAL_PAIRS, type SpecEntry } from "../../src/core/specMerge.js";
import { PROFILES } from "../../src/core/fieldSchema.js";   // the same symbol applicabilityCensus reads, so the fixture cannot disagree with it
import {
  decide, gateRemerge, retypeMismatchedFacts, applicabilityCensus, retractInapplicableFacts,
  main as remergeMain, type ConflictRow, type Decision,
} from "../../src/pipeline/remerge.js";

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
  ('qos_features', 'ls', NULL, 'QoS features', 'QoS-Funktionen'),
  ('stack_max_members', 'n', NULL, 'Max stack members', 'Max. Switches je Stack'),
  ('ip_rating', 's', NULL, 'IP rating', 'IP-Schutzart'),
  ('weight', 'n', 'kg', 'Weight', 'Gewicht')
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
// its own part, for section 7b: that case needs a (part, field) carrying TWO conflicts and nothing else
const chassis2 = (await upsertPart({ vendor: "cisco", sku: "C9200L-48P-4X", category: "switches", family: "Cisco Catalyst 9200", product_class: "hardware" })).id;

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
  // The mirror, decided by facts.ts's GAP_STATES: the withdrawal row is a gap, so it gets no evidence of its own.
  check("and the gap row that withdrew it carries no evidence of its own",
    after !== null && ((await query("SELECT 1 FROM fact_evidence WHERE fact_id = $1", [after.id])).rowCount ?? 0) === 0);
}

// =================================================================================================
// 4. decide() — the three named cases, driven as rows
// =================================================================================================
const row = (o: Partial<ConflictRow>): ConflictRow => ({
  id: 1, run_id: 1, part_id: chassis, field_key: "altitude_max", kept: 3048, rejected: 3000, reason: "x",
  kept_evidence: { tier: 2, method: "html_table", doc_id: docA, norm_v: "1.0.0" },
  rejected_evidence: { tier: 2, method: "html_table", doc_id: docB, norm_v: "1.5.0" },
  kept_raw: null, rejected_raw: null,
  sku: "C9200L-24P-4G", product_class: "hardware", part_family: "Cisco Catalyst 9200", part_series: null, category: "switches",
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
    kept: ["Optional L3", "LAN"], fact_value: ["Optional L3", "LAN"], rejected: ["optional l3", "lan"],
  }));
  check("a set-equal list resolves", setEqual.kind === "agree" && setEqual.rule === "set_equal", JSON.stringify(setEqual));

  // THE 4 SEP 2026 DEFECT. `decide` compared the CURRENT fact with the rejected value, so once a
  // later apply had superseded the field to the conflict's LOSER, the loser agreed with itself and
  // the conflict closed as `rule:exact`. 4,164 conflicts went that way on production, every one of
  // them with kept <> rejected and the current fact byte-identical to rejected (weight 0.127006 kg
  // against 0.13 kg, packet_buffer 1.5 against 3). Agreement is a statement about the RECORDED pair.
  const drifted = decide(row({ kept: 0.127006, rejected: 0.13, fact_value: 0.13, fact_unit: "kg", field_key: "weight" }));
  check("SABOTAGE the current fact having drifted to the REJECTED value is not an agreement",
    drifted.kind === "open" && drifted.rule === "drift:current_fact_is_the_rejected_value", JSON.stringify(drifted));
  const driftedAway = decide(row({ kept: 287.02, rejected: 329, fact_value: 327.66, fact_unit: "mm" }));
  check("SABOTAGE the current fact having drifted within tolerance of the rejected value is not an agreement either",
    driftedAway.kind === "open" && driftedAway.rule === "drift:current_fact_is_the_rejected_value", JSON.stringify(driftedAway));
  const bothNull = decide(row({ kept: null, rejected: null, fact_value: null }));
  check("SABOTAGE two ABSENT values are not an agreement", bothNull.kind !== "agree", JSON.stringify(bothNull));
  const noRaws = decide(row({ kept: 4998.72, rejected: 3000, fact_value: 4998.72, kept_raw: null, rejected_raw: null }));
  check("SABOTAGE null raws with differing values stay OPEN", noRaws.kind === "open", JSON.stringify(noRaws));

  const real = decide(row({ fact_value: 3048, rejected: 1800 }));
  check("SABOTAGE a real two-document disagreement stays OPEN", real.kind === "open" && real.rule === "cross_doc_disagreement", JSON.stringify(real));

  const accessory = decide(row({
    part_id: optic, sku: "SFP-10G-LR=", inherited: true, inherited_from: "catalyst-9200-series-switches",
  }));
  check("an accessory's inherited chassis value is RETRACTED", accessory.kind === "retract" && accessory.rule === "component:SFP", JSON.stringify(accessory));

  const chassisOwn = decide(row({ inherited: true, inherited_from: "catalyst-9200-series-switches" }));
  check("SABOTAGE the chassis's own inherited value is NOT retracted", chassisOwn.kind !== "retract", JSON.stringify(chassisOwn));

  // A RE-EXTRACTION IS THE SAME CELL READ AGAIN, so the two raws must be the same string. The
  // provenance alone (same document, newer norm_v) said nothing about which cell, and 3,164 of the
  // store's 10,291 `same_doc_reextraction` closures were two DIFFERENT cells of one document being
  // resolved by write order.
  const sameCell = { rejected_evidence: { tier: 2, method: "html_table", doc_id: docA, norm_v: "1.5.0" }, rejected: 1800,
    fact_raw: "6,000 ft.", rejected_raw: "6,000 ft." };
  const withRaw = decide(row(sameCell));
  check("the same CELL read by a newer normaliser is a rewrite, and says so",
    withRaw.kind === "rewrite" && /same_doc_reextraction/.test(withRaw.rule), JSON.stringify(withRaw));
  const noRaw = decide(row({ ...sameCell, fact_raw: "6,000 ft.", rejected_raw: null }));
  check("SABOTAGE without the rejected source string it cannot be called a re-extraction: OPEN, never a fabricated raw",
    noRaw.kind === "open" && noRaw.rule === "same_doc_disagreement", JSON.stringify(noRaw));
  const otherCell = decide(row({ ...sameCell, rejected_raw: "1800 m" }));
  check("SABOTAGE a DIFFERENT cell of the same document is a same-document disagreement, held",
    otherCell.kind === "open" && otherCell.rule === "same_doc_disagreement", JSON.stringify(otherCell));

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

  const notReally = [row({ id: 3, kept: 5, fact_value: 5, rejected: 5 })];
  const g4 = gateRemerge(notReally, new Map([[3, { kind: "agree", rule: "exact" } as Decision]]), 200);
  check("SABOTAGE an 'agreement' between two IDENTICAL values means the conflict was never real",
    !g4.passed && g4.misses.some((m) => /AGREE_WAS_NEVER_A_CONFLICT/.test(m)), JSON.stringify(g4.misses));

  // the gate is the second half of the rule:exact fix: it re-derives an agreement from the RECORDED
  // pair, so a decision taken against the current fact cannot pass the sample the way 4,164 did.
  const driftRows = [row({ id: 4, kept: 0.127006, rejected: 0.13, fact_value: 0.13, fact_unit: "kg" })];
  const g5 = gateRemerge(driftRows, new Map([[4, { kind: "agree", rule: "exact" } as Decision]]), 200);
  check("SABOTAGE an 'agreement' the RECORDED pair does not support fails the gate",
    !g5.passed && g5.misses.some((m) => /AGREE_NOT_REPRODUCED/.test(m)), JSON.stringify(g5.misses));
  const g6 = gateRemerge([row({ id: 5, kept: 3048, rejected: 3000 })], new Map([[5, { kind: "agree", rule: "set_equal" } as Decision]]), 200);
  check("SABOTAGE an agreement filed under the WRONG rule fails the gate",
    !g6.passed && g6.misses.some((m) => /AGREE_RULE_CHANGED/.test(m)), JSON.stringify(g6.misses));
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

// =================================================================================================
// 7b. TWO conflicts on one (part, field) — the shape that left 51 production rows stuck (16 Sep 2026)
// =================================================================================================
//
// invariant 5 has been red with 51 rows: `snmp_mibs` on switches, from run #70 of 4 Sep, every conflict RESOLVED and the
// surviving fact still in state `conflict`. Each had exactly two conflicts — `prefix_truncated` (an agree) and
// `list_superset` (a rewrite) — and the unhold sat inside the `agree` branch. `unholdFact` refuses while any conflict on
// the pair is still open, correctly, so the agree unheld nothing and the rewrite never tried: the survivor kept
// `conflict` for ever. Since `conflict` is not a served state, those switches have served no MIB list since.
//
// The unhold now runs once per surviving fact AFTER the whole group. This is that case, and it fails on the old code.
{
  const run = await openRun("apply-specs", { inputs: { two_conflicts: true } });
  const e = entry({ k: "snmp_mibs", value: ["BRIDGE-MIB", "CISCO-SMI"] });
  e.raw = "BRIDGE-MIB ; CISCO-SMI";
  e.prov = { tier: 2, method: "html_table", doc_id: docA, locator: "t1:r1:c1", norm_v: "1.5.0" };
  const factId = await withTx((c) => insertFact(c, chassis2, e, run));
  await query("UPDATE facts SET state = 'conflict' WHERE id = $1", [factId]);
  const seedConflict = async (rejected: unknown, rejectedRaw: string, normV: string) =>
    query(`INSERT INTO conflicts (part_id, field_key, kept, rejected, reason, kept_raw, rejected_raw, kept_evidence, rejected_evidence, run_id)
      VALUES ($1, 'snmp_mibs', $2::jsonb, $3::jsonb, 'seeded', $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [chassis2, JSON.stringify(e.value), JSON.stringify(rejected), e.raw, rejectedRaw,
        JSON.stringify({ tier: 2, method: "html_table", doc_id: docA, norm_v: "1.5.0" }),
        JSON.stringify({ tier: 2, method: "html_table", doc_id: docA, norm_v: normV }), run]);
  // one AGREE (the same cell, truncated) and one REWRITE (the same cell re-read at a newer normaliser) — the production pair
  await seedConflict(["BRIDGE-MIB", "CISCO-SM"], "BRIDGE-MIB ; CISCO-SM", "1.5.0");
  await seedConflict(["BRIDGE-MIB"], "BRIDGE-MIB ; CISCO-SMI", "1.5.1");
  await closeRun(run, "succeeded", { two_conflicts: true }, { precision: 1, recall: 1, passed: true });

  await remergeMain(["--run", String(run), "--commit", "--no-retype"]);
  const open = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM conflicts WHERE part_id = $1 AND field_key = 'snmp_mibs' AND resolved_at IS NULL", [chassis2]);
  check("both conflicts on the pair are resolved", open.rows[0].n === 0, JSON.stringify(open.rows[0]));
  const f = await currentFact(chassis2, "snmp_mibs", getPool());
  check("THE REGRESSION: with every conflict resolved the survivor is no longer in `conflict` — it was for 51 production rows",
    f?.state !== "conflict", JSON.stringify({ state: f?.state, value: f?.value }));
  check("and the state it takes is one the store serves, or one it can justify",
    ["verified", "corroborated", "unverified"].includes(String(f?.state)), String(f?.state));
  const inv5 = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM facts f WHERE f.superseded_by IS NULL AND f.state = 'conflict'
       AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.part_id = f.part_id AND c.field_key = f.field_key AND c.resolved_at IS NULL)`);
  check("invariant 5 holds on this database afterwards: no conflict-state fact without an open conflict",
    inv5.rows[0].n === 0, JSON.stringify(inv5.rows[0]));
}

// =================================================================================================
// 8. APPLICABILITY — a field the part's category profile does not list
//
// The rule is opt-in per (category, field) pair and the table ships EMPTY, because on the real
// corpus the profile-outside population is 994 live facts that are almost all PROFILE GAPS
// (src/core/specMerge.ts § NONSENSICAL_PAIRS). These cases add one pair so every branch the empty
// table leaves unreachable is actually exercised, and take it away again in a `finally`.
// =================================================================================================
{
  const applyRun = await openRun("apply-specs", { inputs: { applicability: true } });
  // THE CATEGORY IS DERIVED, NOT NAMED (16 Sep 2026). This fixture needs a category with NO profile, and it used to say
  // `software` — which HAS one now (the arrangement work of 13–15 Sep took PROFILES to 26 categories). A negative fixture
  // whose premise has quietly become false asserts nothing and reds the suite for a reason that reads like a real defect;
  // this one did, and it is the same shape as the sabotage database named `netzspec_not_a_test` that ended in `_test`.
  // So the category is picked from PROFILES at run time, and the premise is CHECKED rather than assumed.
  // …and since EVERY seeded category now has one (all 26), the state has to be CONSTRUCTED. A fixture category row is
  // inserted here and removed in the finally below: `categories` is seeded by migration and is NOT in this suite's
  // TRUNCATE, so a stray row would follow every other suite that shares this database.
  const noProfileCat = "zz-no-profile-fixture";
  check(`the applicability fixture stands on a category with no profile ("${noProfileCat}")`, !PROFILES[noProfileCat],
    `PROFILES covers ${Object.keys(PROFILES).length} categories`);
  await query(`INSERT INTO categories (slug, name_en, name_de, is_hardware, sort_order)
    VALUES ($1, 'No-profile fixture', 'No-profile fixture', false, 999) ON CONFLICT (slug) DO NOTHING`, [noProfileCat]);
  await ensureCategory(noProfileCat);
  const softPart = (await upsertPart({ vendor: "cisco", sku: "S-C9200-DNA", category: noProfileCat, family: "DNA Essentials", product_class: "software" })).id;

  // a chassis-side field on the transceiver, and a legitimate one the profile simply does not list
  const stack = entry({ k: "stack_max_members", value: 8, unit: undefined });
  stack.prov = { tier: 2, method: "html_table", doc_id: docA, locator: "t7:r1:c1", norm_v: "1.5.0" };
  await withTx((c) => insertFact(c, realOptic, stack, applyRun));
  const ip = entry({ k: "ip_rating", value: "IP30", unit: undefined });
  ip.prov = { tier: 2, method: "html_table", doc_id: docA, locator: "t7:r2:c1", norm_v: "1.5.0" };
  await withTx((c) => insertFact(c, realOptic, ip, applyRun));
  const onSoftware = entry({ k: "stack_max_members", value: 8, unit: undefined });
  onSoftware.prov = { tier: 2, method: "html_table", doc_id: docA, locator: "t7:r3:c1", norm_v: "1.5.0" };
  await withTx((c) => insertFact(c, softPart, onSoftware, applyRun));

  const census0 = await applicabilityCensus(getPool());
  check("a field outside the profile is LISTED even when nothing will be done about it",
    census0.some((c) => c.category === "transceiver" && c.field_key === "ip_rating" && c.live === 1 && !c.nonsensical),
    JSON.stringify(census0));
  check("SABOTAGE a category with NO profile contributes nothing to the census — the rule has no opinion",
    !census0.some((c) => c.category === noProfileCat), JSON.stringify(census0.filter((c) => c.category === noProfileCat)));

  // THE GAP/LIVE SPLIT WAS UNTESTED (17 Sep 2026). The census counts every state NOT in its gap set as
  // `live`, and nothing here asserted a `gap` count — so emptying that set left this suite green, 72/72,
  // while every gap row would have been tallied as a live value. Plant a gap-state fact on the SAME pair
  // that already has one live fact (transceiver / ip_rating) and require it to land in `gap`, not `live`.
  // It goes on a SECOND transceiver: facts_current_uq allows one current row per (part, field), and
  // realOptic already holds a current ip_rating. Removed in the finally so no later case sees it.
  const gapOptic = (await upsertPart({ vendor: "cisco", sku: "QSFP-40G-NZGAP", category: "transceiver", family: "Cisco 40G QSFP+ Modules", product_class: "hardware" })).id;
  try {
    const gapIp = entry({ k: "ip_rating", value: null, state: "gap_confirmed", raw: "" });
    await withTx((c) => insertFact(c, gapOptic, gapIp, applyRun));
    const censusGap = await applicabilityCensus(getPool());
    const ipRow = censusGap.find((c) => c.category === "transceiver" && c.field_key === "ip_rating");
    check("a gap-state fact is counted as GAP, not live — the live count stays 1 and gap becomes 1",
      ipRow?.live === 1 && ipRow?.gap === 1, JSON.stringify(ipRow));
  } finally {
    await query("DELETE FROM facts WHERE part_id = $1", [gapOptic]);
    await query("DELETE FROM parts WHERE id = $1", [gapOptic]);
  }

  check("SABOTAGE a part whose category has NO profile and no curated pair loses nothing",
    (await currentFact(softPart, "stack_max_members", getPool()))?.value === 8);

  try {
    // `stack_max_members` is not in the shipped table, so this pair is the suite's own — it proves
    // the branches a shipped pair already covers, on a field nothing else in the run touches.
    NONSENSICAL_PAIRS.set("transceiver/stack_max_members", "a transceiver is not a stack member");

    const d = decide(row({ part_id: realOptic, sku: "QSFP-40G-SR4", category: "transceiver", field_key: "stack_max_members", inherited: false }));
    check("a chassis-side field on a transceiver is RETRACTED, named by category",
      d.kind === "retract" && d.rule === "not_applicable:transceiver" && d.state === "not_applicable", JSON.stringify(d));
    check("SABOTAGE the same field on a CHASSIS, whose profile lists it, is not retracted",
      decide(row({ field_key: "stack_max_members", category: "switches" })).kind !== "retract");

    const g = gateRemerge([row({ id: 7, part_id: realOptic, sku: "QSFP-40G-SR4", category: "transceiver", field_key: "stack_max_members" })],
      new Map([[7, d as Decision]]), 200);
    check("the gate accepts a not-applicable retraction that is NOT inherited", g.passed, JSON.stringify(g.misses));
    const gBad = gateRemerge([row({ id: 8, category: "switches", field_key: "stack_max_members" })],
      new Map([[8, { kind: "retract", rule: "not_applicable:switches", reason: "x", state: "not_applicable" } as Decision]]), 200);
    check("SABOTAGE a not-applicable retraction the predicate does not reproduce fails the gate",
      !gBad.passed && gBad.misses.some((m) => /RETRACT_STILL_APPLICABLE/.test(m)), JSON.stringify(gBad.misses));

    // the apply path refuses the incoming fact BY NAME, so no pipeline writes another one
    const incoming = entry({ k: "stack_max_members", value: 4, unit: undefined });
    const refused = await withTx((c) => applyMerge(c, realOptic, incoming, applyRun));
    check("the apply path refuses an inapplicable incoming fact, naming the rule",
      refused.action === "refused_not_applicable" && refused.rule === "not_applicable:transceiver", `${refused.action} ${refused.rule}`);
    check("and the refusal names the field and the part", /FIELD_NOT_APPLICABLE: stack_max_members/.test(refused.refused ?? ""), refused.refused);
    check("SABOTAGE the refusal wrote nothing: the stored value is untouched",
      (await currentFact(realOptic, "stack_max_members", getPool()))?.value === 8);
    const allowed = await withTx((c) => applyMerge(c, chassis, entry({ k: "stack_max_members", value: 8, unit: undefined }), applyRun));
    check("SABOTAGE the same field on the chassis is written as normal", allowed.action === "insert", allowed.action);

    const dry = await retractInapplicableFacts(getPool(), applyRun, { commit: false, examples: 2 });
    check("the dry sweep counts the transceiver's chassis-side field, and every retraction it plans is one",
      dry.retracted >= 1 && dry.by_rule["not_applicable:transceiver"] === dry.retracted, JSON.stringify(dry));
    check("SABOTAGE a dry sweep writes nothing", (await currentFact(realOptic, "stack_max_members", getPool()))?.state === "verified");
    await withTx((c) => retractInapplicableFacts(c, applyRun, { commit: true, examples: 2 }));
    const gone = await currentFact(realOptic, "stack_max_members", getPool());
    check("the swept fact is superseded into not_applicable, not gap_unattempted",
      gone?.state === "not_applicable" && gone?.value === null && /^retracted:not_applicable:transceiver$/.test(gone?.method ?? ""), JSON.stringify(gone));
    check("the withdrawn value is still in history",
      (await factHistory(realOptic, "stack_max_members", getPool())).some((h) => h.value === 8));
    check("SABOTAGE the legitimate profile-gap field on the same part is NOT touched",
      (await currentFact(realOptic, "ip_rating", getPool()))?.value === "IP30");
    check("SABOTAGE the sweep left the no-profile part alone",
      (await currentFact(softPart, "stack_max_members", getPool()))?.value === 8);
  } finally {
    NONSENSICAL_PAIRS.delete("transceiver/stack_max_members");
  }
  check("the suite's own pair is gone, leaving only the shipped table",
    !NONSENSICAL_PAIRS.has("transceiver/stack_max_members")
    && decide(row({ part_id: realOptic, sku: "QSFP-40G-SR4", category: "transceiver", field_key: "stack_max_members" })).kind !== "retract");
  await closeRun(applyRun, "succeeded", { applicability: true }, { precision: 1, recall: 1, passed: true });

  // the fixture category goes out again, and the check says so rather than trusting the DELETE: `categories` is seeded by
  // migration and is not truncated by this suite, so a row left here would be inherited by every other suite on this database
  await query("DELETE FROM parts WHERE category_id = (SELECT id FROM categories WHERE slug = $1)", [noProfileCat]);
  await query("DELETE FROM categories WHERE slug = $1", [noProfileCat]);
  const left = await query<{ n: number }>("SELECT count(*)::int AS n FROM categories WHERE slug = $1", [noProfileCat]);
  check("the fixture category is removed, so the shared test database is as it was found", left.rows[0].n === 0);
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
