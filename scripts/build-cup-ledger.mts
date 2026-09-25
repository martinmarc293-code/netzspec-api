/**
 * Build the frozen CUP LEDGER for a category: the denominator the filling phase will be measured against.
 *
 *     npx tsx scripts/build-cup-ledger.mts --category switches [--vendor cisco]
 *     -> data/ledger/<vendor>-<category>.json   (commit it; tests/cupLedger.test.ts guards it against drift)
 *
 * Reviewer §5 (11 Sep 2026): "for every category that passes the five checks, emit a frozen ledger". Per kind:
 * the parts, the required fields, the conditional fields with their gate, the optional fields, and the slots —
 * parts × fields resolved at "nothing known yet". Per required or conditional field: which sources can fill it
 * (copied from data/schema/source-fields.json, with the source's CLASS) and the labels that map to it.
 *
 * TWO NUMBERS THE GENERATED FILE CANNOT FAKE, recorded beside each field:
 *   `basis` per source — "seen" when the source was observed publishing the key, "profile-required-only" when
 *       source-fields lists it ONLY because a profile requires it. source-fields admits every required key for
 *       the Cisco datasheet sources by construction, so a field whose every source says "profile-required-only"
 *       has no observed source at all. (That circle hid `mode`: 0 labels, 0 facts, "fillable".)
 *   `label_occurrences` — how often a label in the cisco-datasheets inventory maps to the key under the CURRENT
 *       alias rules (the real mapLabel). Upper bound for a category-scoped rule: the inventory is not per category.
 *
 * Read-only: queries the store, writes one JSON file. No run row, because it writes no database row.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getPool, closePool } from "../src/store/index.js";
import { partKind, FALLBACK_KINDS } from "../src/core/partKind.js";
import { kindQuestionSet, slotsAtNothingKnown, profileHash, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { PROFILES } from "../src/core/fieldSchema.js";
import { NORM_VERSION } from "../src/core/specNormalize.js";
import { mapLabel } from "../src/core/deepSpecMap.js";
import { listSources } from "../src/api/queries/sources.js";
import { DERIVED_FILL_PATHS } from "../src/core/derivedFillPaths.js";
// kind-layer infra (13 Sep 2026): layer 3 per kind, and term 13 (the granularity test) per kind. See the `roles` and
// `term13` notes in the per-kind loop below.
import { deployRole, deployRoleRule, roleAxisOf, ROLE_DOMAINS } from "../src/core/deployRole.js";
import { loadGranularityReference, judgeTerm13, measuredFor, seriesGroupOf } from "../src/core/kindGranularity.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

/**
 * fallback-kinds (12 Sep 2026). A DEVICE NOUN IN THE NAME of a part sitting in a fallback kind: the
 * second half of the own-fact census, and the shape that hid the UNITY-PIMG media gateways — 14 real
 * PBX-IP gateways a licence rule was about to delete, found by asking which rows a class rule calls
 * non-hardware while the name says "gateway". A fact count cannot see them, because an undocumented
 * product holds no facts; its NAME is the only thing that says what it is.
 *
 * Recorded per kind in the ledger, so tests/cupLedger.test.ts can assert it over the live corpus
 * rather than over a profile. Deliberately narrower than nameMarker's own device list: only nouns
 * that name a whole box, because a component noun in a component's name is correct and not a finding.
 *
 * device-noun (13 Sep 2026, phase-1 close guide §5.5): the detector now lives in src/core/deviceNoun.ts so the
 * test runs the real function, it reads the part's OWN phrase (host clause and listed component compounds
 * removed), and the census is KIND-AWARE — a part in DEVICE_NOUN_EXEMPT_KINDS is counted in
 * `device_noun_exempt` beside the counted number, never silently dropped. The SKUs behind the counted union
 * are written out (`either.device_noun_skus`) so the test can hold a hard zero against a NAMED residue.
 */
import { deviceNounFinding, namesADeviceNoun, DEVICE_NOUN_EXEMPT_KINDS, DEVICE_NOUN_RULE_ABOUT } from "../src/core/deviceNoun.js";
// `FALLBACK_KINDS` (kinds that mean "this axis could not say") is IMPORTED from src/core/partKind.ts,
// not restated here. Until 16 Sep 2026 this file hand-wrote its own six-member copy whose comment said
// it "mirrors" the original — and it did not: the original has five members and the copy added the
// report sentinel `"(none)"`, which partKind never returns. The two happened to be equivalent, so
// nothing was wrong today; the hole was that a sixth member added to the real set would have reached
// build-completeness.mts (which imports it) and NOT this builder, and the freeze pins both artifacts
// as ONE unit. A comment claiming agreement with another module is a claim nothing checks.
// `"(none)"` is composed below exactly as build-completeness.mts:418 composes it.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

// Source slug -> the class of document it reads. "prose" (a part's own name) is description_mining, which no
// source-fields entry names; it is recorded per field from the facts, not from this table.
const SOURCE_CLASS: Record<string, string> = {
  "cisco-datasheets": "datasheet-html", "cisco-datasheet-pdf": "datasheet-pdf", "meraki": "vendor-page",
  "hpe-quickspecs": "vendor-spec-sheet", "arista": "vendor-page", "provantage": "reseller-spec-sheet",
  "router-switch": "reseller-spec-sheet", "itprice": "reseller-spec-sheet", "cdw": "reseller-spec-sheet", "hexcat": "operator",
};

// The four gap states the filling phase must use (reviewer §5, the cells defined on 10 Sep 2026), and the store
// state each one is computed from. Coverage = filled ÷ required slots, reported by kind and by state, never as a mean.
/**
 * WHICH DOCUMENT TYPES CARRY A SPECIFICATION — measured, not assumed, and the first version of this
 * list was wrong in a way that overstated the problem by a third.
 *
 * The obvious predicate is `doc_type LIKE '%datasheet%'`. It misses `vendor_page`, which is
 * MERAKI'S ONLY SOURCE, and it would have had this ledger report Meraki as acquisition-blocked
 * while its pages sit in the cache. The discriminator is not facts per DOCUMENT either, which is
 * the trap the repo already recorded as "a JOIN cardinality is not a yield": an EoL bulletin scores
 * 5.4 facts/doc, about the same as a vendor_page's 4.7, because a bulletin lists twenty SKUs in one
 * table and the count is per document.
 *
 * FACTS PER PART-LINK is the number that separates them, measured over the live store:
 *
 *     vendor_tool            5.9      vendor_guide           0.52
 *     vendor_datasheet_pdf   5.4      vendor_eol_bulletin    0.27
 *     vendor_datasheet_html  5.2
 *     vendor_page            3.6
 *
 * A bulletin binds a part and tells it nothing; a datasheet, a Meraki page or a config tool answers
 * it. `vendor_guide` (76 docs, 2,412 part-links, 0.52) sits with the bulletins and is excluded
 * despite a healthy 16.5 facts/doc — the same cardinality illusion one line up.
 *
 * KIND LAYER 6b (operator ruling, 13 Sep 2026): the list moved to src/core/heldEvidence.ts (both builders import it) and
 * no longer decides HELD on its own. Held = a doc_parts row with doc_relevance = spec_for_kind AND link_basis IN
 * (explicit, family); the doc-type count survives as `spec_bearing_by_doc_type_legacy` beside it.
 */
import { SPEC_BEARING_DOC_TYPES, heldRowSql, underivedRowSql, docStateOf, underivedRefusal, missingColumnsRefusal } from "../src/core/heldEvidence.js";
import { loadPlans, planStatusIndex, emptyBreakdown, addKindIssue, nullShareExcludingKindIssue, unresolvedDisplay,
  plansRanButStillInKind, type KindIssueBreakdown, type KindLayerPlan, type PlanStatus } from "../src/core/kindLayerPlans.js";

const GAP_STATES = {
  filled: "the part holds a current fact under the key (facts.superseded_by IS NULL, not retracted)",
  "not-parsed": "a spec-bearing document linked to the part (doc_parts) carries a label that maps to the key, and no fact was stored",
  "not-held": "no doc_parts row of the part passes the held rule (doc_relevance = spec_for_kind AND link_basis IN (explicit, family)) — an acquisition or linking gap, not a parsing one",
  "not-published": "a gap_confirmed fact: every capable source was checked and none states it",
};

async function main(): Promise<void> {
  const category = arg("--category"), vendor = arg("--vendor") ?? "cisco";
  if (!category || !LEDGER_KINDS[category]) throw new Error(`--category must be one of: ${Object.keys(LEDGER_KINDS).join(", ")}`);
  const pool = getPool();

  // ---- HELD BY RELEVANCE (6b): refuse before computing a single held number ----------------------------
  const provCols = (await pool.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'doc_parts' AND column_name = ANY($1::text[])`,
    [["link_basis", "doc_relevance", "link_evidence"]])).rows.map((r) => r.column_name);
  const noCols = missingColumnsRefusal(provCols);
  if (noCols) throw new Error(noCols);
  const underived = (await pool.query<{ rows: number; parts: number; in_category: number }>(`
    SELECT count(*)::int AS rows, count(DISTINCT dp.part_id)::int AS parts,
           count(DISTINCT dp.part_id) FILTER (WHERE ct.slug = $3)::int AS in_category
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND sd.doc_type = ANY($2::text[]) AND ${underivedRowSql("dp")}`, [vendor, SPEC_BEARING_DOC_TYPES, category])).rows[0];
  const refusal = underivedRefusal(vendor, underived.rows, underived.parts);
  if (refusal) throw new Error(`${refusal} (${underived.in_category} of those parts in ${category})`);
  // The move/class plans for kind-issue rows (operator ruling on roles_partition): a required file, [] allowed.
  const plans = loadPlans(ROOT);
  const planOf = planStatusIndex(plans.plans);

  // ---- parts per kind ---------------------------------------------------------------------------------
  // MERGED 12 Sep 2026 — two additions to this query landed in the same hour and BOTH are load-bearing:
  // the parent's document evidence (the `not-held` state) and the fallback-kinds agent's own-fact and
  // device-noun census. Dropping either half would leave a green suite asserting half a picture, so the
  // SELECT carries all five derived columns and the per-kind accumulator all five counters.
  //
  // `p.name` IS THE ONE THAT CHANGES BEHAVIOUR: partKind now takes an optional name and consults it only
  // where the category's own axis gave up. A builder that does not pass it measures a system nobody runs
  // — the three name-derived kinds would report zero parts — which is the structural gap the
  // asked-nothing survey identified (`recompute-completeness.ts` selected every column except p.name).
  const parts = (await pool.query<{ id: string; sku: string; name: string | null; series: string | null; rt: number | null;
    own: string; held_docs: number; spec_docs: number; any_docs: number }>(`
    SELECT p.id::text, p.sku, p.name, p.series, cp.required_total AS rt,
           (SELECT count(*) FROM facts f
             WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.inherited_from IS NULL
               AND f.method NOT LIKE 'retracted:%')::text AS own,
           (SELECT count(*) FROM doc_parts dp WHERE dp.part_id = p.id AND ${heldRowSql("dp")})::int AS held_docs,
           (SELECT count(*) FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
             WHERE dp.part_id = p.id AND sd.doc_type = ANY($3::text[]))::int AS spec_docs,
           (SELECT count(*) FROM doc_parts dp WHERE dp.part_id = p.id)::int AS any_docs
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
      LEFT JOIN completeness cp ON cp.part_id = p.id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.retired_at IS NULL AND p.product_class = 'hardware'`,
    [vendor, category, SPEC_BEARING_DOC_TYPES])).rows;
  // A MERGED-AWAY CATEGORY HAS NOTHING TO STATE, AND ITS LEDGER IS A LIE THE NEXT READER CANNOT SEE (25 Sep 2026).
  // `conferencing` -> collaboration-endpoints and `data-center-networking` -> switches ran on 25 Sep (runs 1204/1207/
  // 1212); their layer pages hold no row and the store holds no hardware there. The completeness build emits a block
  // only for a category that HAS parts, so a ledger left behind for one of these has no block to be checked against —
  // which is exactly how the two stale files sat here for a fortnight and made `hardware_parts` refuse the rebuild.
  // Refuse at the producer instead: rebuilding all of LEDGER_KINDS is the obvious thing to do, so it has to say why
  // two of them are not part of the arrangement any more rather than silently writing them back.
  if (parts.length === 0) {
    throw new Error(`REFUSED: ${vendor}/${category} holds no live hardware part, so a cup ledger for it would state nothing and the `
      + `completeness report would have no category block to check it against. A merged-away category is recorded in `
      + `data/reference/layers-cross-claims.json and tests/layersStanding.test.ts MERGE_CANDIDATES — if this category is `
      + `NOT merged away, the parts are missing and that is the bug.`);
  }
  // kind-layer infra (13 Sep 2026): per role, the same three document states and the stored slots, so a role block
  // carries exactly what its kind block carries and the kind's numbers are the SUM of its roles (checked below).
  // 6b: `spec` counts HELD by the relevance rule; `specNotHeld` the parts a spec-bearing document is linked to only as a
  // mention or by inference; `legacy` the old doc-type held. `issue` is the kind-issue breakdown by plan state.
  type DocAcc = { spec: number; specNotHeld: number; legacy: number; eolOnly: number; noDoc: number };
  type RoleAcc = DocAcc & { n: number; stored: number; issue: KindIssueBreakdown };
  const newRoleAcc = (): RoleAcc => ({ n: 0, stored: 0, spec: 0, specNotHeld: 0, legacy: 0, eolOnly: 0, noDoc: 0, issue: emptyBreakdown() });
  const countDoc = (a: DocAcc, p: { held_docs: number; spec_docs: number; any_docs: number }) => {
    const st = docStateOf({ held_rows: p.held_docs, spec_rows: p.spec_docs, any_rows: p.any_docs });
    if (st === "held") a.spec++; else if (st === "spec_linked_not_held") a.specNotHeld++; else if (st === "eol_only") a.eolOnly++; else a.noDoc++;
    if (p.spec_docs > 0) a.legacy++;
  };
  const kindIssueRows: { category: string; kind: string; sku: string; status: PlanStatus; plan: KindLayerPlan | null }[] = [];
  const byKind = new Map<string, DocAcc & { n: number; stored: number;
    facts3: number; noun: number; nounExempt: number; nounSkus: string[]; groups: Set<string>; roles: Map<string, RoleAcc> }>();
  for (const p of parts) {
    const k = partKind(category, p.sku, p.name ?? undefined) ?? "(none)";
    const b = byKind.get(k) ?? { n: 0, stored: 0, spec: 0, specNotHeld: 0, legacy: 0, eolOnly: 0, noDoc: 0, facts3: 0, noun: 0, nounExempt: 0, nounSkus: [] as string[],
      groups: new Set<string>(), roles: new Map<string, RoleAcc>() };
    b.n++; b.stored += p.rt ?? 0;
    // TERM 13 INPUT: the series group, III.0 item 2's grouping exactly (series, or the first name token after "Cisco").
    b.groups.add(seriesGroupOf(p.series, p.name, p.sku));
    // LAYER 3: the role, by the one call recompute-completeness, the API and the completeness report make. A null role is
    // `(unresolved)` — asked the kind's core, never folded into the biggest role. `issue` counts the rows the rule table
    // says are NOT this kind at all (a licence filed as a switch), kept apart from "no rule places it".
    const axis = roleAxisOf(category, k);
    const role = axis ? deployRole(category, k, p.sku, p.name) : null;
    if (axis) {
      if (role !== null && !ROLE_DOMAINS[axis].includes(role)) throw new Error(`deployRole gave ${p.sku} role "${role}", outside the ${axis} domain [${ROLE_DOMAINS[axis].join(", ")}]`);
      const rk = role ?? "(unresolved)";
      const ra = b.roles.get(rk) ?? newRoleAcc();
      ra.n++; ra.stored += p.rt ?? 0;
      countDoc(ra, p);
      if (role === null && deployRoleRule(axis, p.sku, p.name).issue !== null) {
        const { status, plan } = planOf(category, p.sku);
        addKindIssue(ra.issue, status);
        kindIssueRows.push({ category, kind: k, sku: p.sku, status, plan });
      }
      b.roles.set(rk, ra);
    }
    // THE OWN-FACT AND DEVICE-NOUN CENSUS (fallback-kinds agent): a part in a fallback kind holding
    // three or more of its own facts is the only detector for a real product swallowed by a fallback,
    // and the device noun is the detector for one that holds none — an undocumented product has no
    // facts, and its NAME is the only thing that says what it is. That is the shape that hid the
    // fourteen UNITY-PIMG media gateways a licence rule was about to delete.
    if (Number(p.own) >= 3) b.facts3++;
    // KIND-AWARE (13 Sep 2026): an exempt kind's noun is the host's by rule and is counted apart, not dropped.
    if (deviceNounFinding(k, p.name ?? "")) { b.noun++; b.nounSkus.push(p.sku); }
    else if (namesADeviceNoun(p.name ?? "")) b.nounExempt++;
    // THE `not-held` STATE, COMPUTED AT LAST — reviewer round 4 §9(2), 12 Sep 2026.
    //
    // GAP_STATES below has defined `not-held` ("no spec-bearing document is linked to the part at
    // all — an acquisition gap, not a parsing one") since the ledger was written, and NOTHING EVER
    // COMPUTED IT. A definition with no reader is the drift this repo keeps paying for, and here it
    // cost the argument rather than the data: 4,463 parts sit in a fallback kind with no datasheet
    // held, and without this split a readiness report says "not ready" and lets a reader conclude
    // "not ready — schema" about parts whose cups are arranged correctly and whose PAGES do not
    // exist in the cache. The reviewer made it the CONDITION for treating those parts as phase 2:
    // "the ledger must say so per family."
    //
    // Three states, per kind, because the kind is the family a reader acts on:
    //   spec_bearing  at least one datasheet-class document is linked — a gap here is parsing or
    //                 extraction, and it is ours to close now
    //   eol_only      documents are linked and NONE is spec-bearing (an end-of-life bulletin names
    //                 a SKU and carries no specification) — acquisition, and tractable: the
    //                 bulletin names the family and the archived collateral usually still exists
    //   no_document   nothing linked at all — acquisition, and the queue has to discover it first
    //
    // KIND LAYER 6b (operator ruling, 13 Sep 2026): `spec_bearing` is now HELD BY RELEVANCE (a spec_for_kind row made
    // explicitly or by family), and a fourth state sits beside it: spec_linked_not_held — a spec-bearing document is
    // linked only as a mention or by inference. The old doc-type count is kept as spec_bearing_by_doc_type_legacy.
    countDoc(b, p);
    byKind.set(k, b);
  }
  // ---- security (12 Sep 2026): the rows the class table has already judged non-hardware ----------------
  // `securityKind` returns "non-hardware" for a SKU productClass.ts calls a licence, software or a service
  // while the parts row still says `hardware` — 3,525 of security's 5,515 as of 11 Sep, because a reclassify
  // run has not moved them yet. They have no question set and belong in no kind, so they are taken OUT of
  // the per-kind map rather than added to LEDGER_KINDS as a pseudo-kind.
  //
  // AND THE COUNT IS WRITTEN DOWN, beside the kinds rather than folded into one of them. A part silently
  // dropped from a denominator is this repo's own `sampled`-carrying-`checked` defect: the ledger would
  // report 1,990 parts for a category whose parts table holds 5,515 `hardware` rows and nothing would say
  // where the other 3,525 went.
  const pendingReclass = byKind.get("non-hardware")?.n ?? 0;
  const pendingReclassStoredSlots = byKind.get("non-hardware")?.stored ?? 0;
  byKind.delete("non-hardware");
  // fallback-kinds (12 Sep 2026): the census totals, computed BEFORE the per-kind loop drops anything,
  // so the share has the category's own hardware count as its denominator and not the survivors'.
  //
  // TWO AXES, NOT ONE — round-6 reviewer §8.2, and they were conflated in every number this project
  // has published about the arrangement phase.
  //
  //   ASKED NOTHING     the kind's question set is empty: slots_per_part_at_nothing_known == 0.
  //                     THIS is the phase-1 number. It is a property of the PROFILE.
  //   UNRESOLVED KIND   the kind name means "the axis could not say" (FALLBACK_KINDS). A property
  //                     of the CLASSIFIER.
  //
  // They are independent, and reporting only the second understated the problem in one direction
  // and overstated it in the other. Measured at f806b65: 2,929 parts sat in an unresolved kind and
  // the project called that "asked ~nothing", but 1,426 of them ARE asked a cup (every `accessory`
  // kind except transceiver's asks `product_compatibility`; meraki's `unknown` asks seven), while
  // 1,568 parts asked literally nothing sat in kinds with PERFECTLY GOOD NAMES and so fell out of
  // the count entirely — `servers-unified-computing.bundle` 1,432 of them, 95 with a device noun in
  // the name, none of which the 158 could see. A SmartPlay bundle is a server; asking it nothing is
  // term 2, and the fact that `bundle` is a name rather than a shrug is not a defence.
  //
  // So both are emitted, both detectors are summed over the UNION, and tests/cupLedger.test.ts
  // asserts both. A named kind can no longer hide a real product from the phase number.
  const askedNothing = (k: string): boolean => {
    if (!LEDGER_KINDS[category].includes(k)) return false;   // "(none)" and any unlisted kind
    try { return slotsAtNothingKnown(kindQuestionSet(category, k)) === 0; } catch { return false; }
  };
  const census = (pred: (k: string) => boolean) => {
    const rows = [...byKind].filter(([k]) => pred(k));
    return {
      kinds: rows.map(([k]) => k).sort(),
      parts: rows.reduce((a, [, b]) => a + b.n, 0),
      facts3: rows.reduce((a, [, b]) => a + b.facts3, 0),
      device_noun: rows.reduce((a, [, b]) => a + b.noun, 0),
      // device-noun (13 Sep 2026): the parts an exempt kind excused, counted rather than dropped.
      device_noun_exempt: rows.reduce((a, [, b]) => a + b.nounExempt, 0),
    };
  };
  const isUnresolved = (k: string) => FALLBACK_KINDS.has(k) || k === "(none)";
  const inUnion = (k: string) => askedNothing(k) || isUnresolved(k);
  const fallbackCensus = {
    _about: "TWO AXES. `asked_nothing` = the kind's question set is empty (a profile property, and the phase-1 number). `unresolved_kind` = the kind name means the axis could not say (a classifier property). They are independent: a named kind can be asked nothing, and an unresolved kind can be asked a cup. `facts3` and `device_noun` are the two detectors for a real product swallowed by either: a part holding three or more facts of its own, and a part whose NAME names a whole box. tests/cupLedger.test.ts asserts both axes. " + DEVICE_NOUN_RULE_ABOUT,
    device_noun_exempt_kinds: [...DEVICE_NOUN_EXEMPT_KINDS],
    hardware_parts: parts.length,
    asked_nothing: census(askedNothing),
    unresolved_kind: {
      ...census(isUnresolved),
      asked_at_least_one_cup: [...byKind].filter(([k]) => isUnresolved(k) && !askedNothing(k)).reduce((a, [, b]) => a + b.n, 0),
    },
    // The union is what the two standing tests judge, so neither axis can shelter a part from them.
    either: {
      ...census(inUnion),
      // NAMED, so the hard zero in tests/cupLedger.test.ts can hold against an explicit residue list of SKUs
      // awaiting a parent write (a class or category change) rather than against a number.
      device_noun_skus: [...byKind].filter(([k]) => inUnion(k)).flatMap(([, b]) => b.nounSkus).sort(),
    },
    // KEPT at the old names and the old meaning (the unresolved axis) so the ratchet in
    // tests/cupLedger.test.ts compares like with like across this change rather than re-baselining
    // silently. The new axis is asserted beside it, not instead of it.
    kinds: census(isUnresolved).kinds,
    parts: census(isUnresolved).parts,
    facts3: census(isUnresolved).facts3,
    device_noun: census(isUnresolved).device_noun,
  };
  const unknownKinds = [...byKind.keys()].filter((k) => !LEDGER_KINDS[category].includes(k));
  if (unknownKinds.length) throw new Error(`parts carry kinds the ledger does not list: ${unknownKinds.join(", ")} — add them to LEDGER_KINDS`);

  // ---- evidence: sources (copied) and labels (mapped) --------------------------------------------------
  const sf = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/source-fields.json"), "utf8"));
  const sourcesFor = (key: string) => Object.entries(sf.sources as Record<string, Record<string, string[]>>)
    .filter(([, cats]) => (cats[category] ?? []).includes(key) || (cats["*"] ?? []).includes(key))
    .map(([slug, cats]) => {
      const added: string[] = sf.evidence?.sources?.[slug]?.any_category?.added_by_profile ?? [];
      const seen = (cats[category] ?? []).includes(key) || ((cats["*"] ?? []).includes(key) && !added.includes(key));
      return { source: slug, class: SOURCE_CLASS[slug] ?? "unknown", basis: seen ? "seen" : "profile-required-only" };
    });
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, "runs/vocab/cisco-datasheets/labels.json"), "utf8"));
  const labels: { label: string; count: number }[] = Object.values(inv).find(Array.isArray) as never;
  const labelsFor = new Map<string, Map<string, number>>();
  for (const l of labels) {
    const k = mapLabel(l.label, category);
    if (!k || k.startsWith("__")) continue;
    const m = labelsFor.get(k) ?? new Map(); m.set(l.label, (m.get(l.label) ?? 0) + l.count); labelsFor.set(k, m);
  }
  // parts holding each key today, by method — so a field filled ONLY by the operator seed is visible as such
  const byMethod = new Map<string, Record<string, number>>();
  for (const r of (await pool.query<{ k: string; m: string; n: string }>(`
    SELECT f.field_key k, f.method m, count(DISTINCT f.part_id)::text n FROM facts f JOIN parts p ON p.id = f.part_id
      JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.product_class = 'hardware' AND p.retired_at IS NULL
       AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' GROUP BY 1, 2`, [vendor, category])).rows) {
    byMethod.set(r.k, { ...(byMethod.get(r.k) ?? {}), [r.m]: Number(r.n) });
  }
  // ---- THE §8.2 "SEEN" RULE (round-6 reviewer, 12 Sep 2026) ---------------------------------------------
  // Two claims had one field between them. `observed_fill_path` said "a tap exists" — a source listed
  // as seen, a label that maps here, or the part's own name — and a reader took it to mean "the tap
  // has run". The reviewer found the gap from both ends: `cisco-datasheet-pdf` is DISABLED with
  // facts_current 0 and was cited `basis: seen`, and transceiver.reach_max had 147 label occurrences,
  // observed_fill_path TRUE, and ZERO holders. So:
  //
  //   basis "seen"         now also requires the source to be ENABLED with facts_current > 0. A source
  //                        that is off, or has never produced a fact, cannot have been seen doing
  //                        anything. It becomes "seen-but-inactive" and does not count as a tap.
  //   observed_filled      NEW, beside observed_fill_path rather than replacing it: at least one OWN,
  //                        NON-SEED fact under this key, on any hardware part of this vendor. Kept
  //                        separate on purpose — "never name an output field for the thing you wish it
  //                        measured", and redefining observed_fill_path would have silently changed
  //                        what every earlier read of these ledgers said.
  //
  // `enabled` and `facts_current` come from the API's own listSources() and not from a re-derivation:
  // its facts_current is a four-way union over methods, documents and evidence rows, and rebuilding it
  // here would be a second check that disagrees with the one /v1/sources publishes.
  const sourceState = new Map((await listSources()).map((s) => [s.slug, { enabled: s.enabled, facts_current: s.facts_current }]));
  // ---- A DERIVATION IS A FILL PATH, and the ledger must be able to see one (12 Sep 2026) -----------------
  // `observed_fill_path` knew three taps: an active source, a mapped label, the part's own name through
  // stored description_mining facts. A pure function that reads the answer out of data the part already
  // has is a fourth, and without this table the ledger reported "NO FILL PATH" for three breakout-cable
  // cups that are answered for 51 of 51 parts — which reads exactly like the round-6 B2 defect and is its
  // opposite. Each entry names the function, the population it was validated over, and its measured
  // coverage and precision, so the claim is checkable rather than asserted.
  //
  // COVERAGE DECIDES REQUIRED, and that is why `layer` is listed and still OPTIONAL: its derivation is
  // exact (precision 1.000 over the 1,054 seeds) but speaks for 10.1% of switches, and a cup required of
  // 4,931 parts on a path that reaches 500 is still mostly a gap nobody can close.
  // The registered derivations live in ONE module since 13 Sep 2026 (the ledger, the completeness report and the
  // phase-1 freeze all read them): src/core/derivedFillPaths.ts.
  const ownNonSeed = new Set((await pool.query<{ k: string }>(`
    SELECT DISTINCT f.field_key k FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.product_class = 'hardware' AND p.retired_at IS NULL
       AND f.superseded_by IS NULL AND f.inherited_from IS NULL
       AND f.method NOT LIKE 'retracted:%' AND f.method <> 'hexcat_seed'`, [vendor])).rows.map((r) => r.k));
  const evidence = (key: string) => {
    const lm = labelsFor.get(key) ?? new Map<string, number>();
    // §8.2: a "seen" source that is disabled or has never produced a fact is not a tap.
    const srcs = sourcesFor(key).map((s) => {
      const st = sourceState.get(s.source);
      const active = st !== undefined && st.enabled && st.facts_current > 0;
      return s.basis === "seen" && !active
        ? { ...s, basis: "seen-but-inactive", enabled: st?.enabled ?? false, facts_current: st?.facts_current ?? 0 }
        : { ...s, enabled: st?.enabled ?? false, facts_current: st?.facts_current ?? 0 };
    });
    const methods = byMethod.get(key) ?? {};
    const labelOcc = [...lm.values()].reduce((a, b) => a + b, 0);
    const prose = (methods["description_mining"] ?? 0) > 0;
    const activeSeen = srcs.some((s) => s.basis === "seen");
    const derived = DERIVED_FILL_PATHS[key];
    return {
      key,
      sources: srcs,
      label_occurrences: labelOcc,
      labels: [...lm].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n })),
      parts_holding_by_method: methods,
      ...(derived ? { derived_by: derived.by, derivation_validated: derived.validated } : {}),
      // A TAP EXISTS: an ACTIVE source seen publishing the key, a datasheet label that maps to it, the part's
      // own name (description_mining), or a validated derivation. The operator seed is a source, not one that grows.
      observed_fill_path: activeSeen || labelOcc > 0 || prose || derived !== undefined,
      // THE TAP HAS RUN: at least one own, non-seed fact under this key somewhere in this vendor's hardware.
      // A label with no holder is a path nobody has walked — transceiver.reach_max is the case that proves it.
      observed_filled: ownNonSeed.has(key),
      seed_only: !(activeSeen || labelOcc > 0 || prose || derived !== undefined) && (methods["hexcat_seed"] ?? 0) > 0,
    };
  };

  // ---- per kind ----------------------------------------------------------------------------------------
  const kinds: Record<string, unknown> = {};
  let slotsNothing = 0, slotsStored = 0, partsTotal = 0;
  const granularity = loadGranularityReference(ROOT);
  const blockedBy = (n: number, spec: number) => n === 0 ? "no parts" : spec >= n / 2 ? "schema-or-parsing" : "not-held (acquisition)";
  for (const kind of LEDGER_KINDS[category]) {
    const qs = kindQuestionSet(category, kind);
    const b = byKind.get(kind) ?? { n: 0, stored: 0, spec: 0, specNotHeld: 0, legacy: 0, eolOnly: 0, noDoc: 0, facts3: 0, noun: 0, nounExempt: 0, nounSkus: [],
      groups: new Set<string>(), roles: new Map<string, RoleAcc>() };
    const per = slotsAtNothingKnown(qs);
    // ---- LAYER 3 (kind-layer infra, 13 Sep 2026) ---------------------------------------------------------------------
    // A kind with a role axis gets one block per role of its domain plus `(unresolved)`, each with its OWN question set
    // (kindQuestionSet(category, kind, role); unresolved = no role = the kind's core) and its own slots. The kind's
    // `required` / `pending_until_gate_answered` / `optional` / `not_applicable_by_kind` stay the CORE (what an
    // unresolved part is asked), so every existing reader of those lists reads what it always read. The kind's SLOT
    // totals become the sum over its roles, because a role that asks fewer cups opens fewer slots — `parts × core`
    // would overstate an `smb` switch that is not asked `altitude_max`.
    const axis = roleAxisOf(category, kind);
    let roles: Record<string, unknown> | undefined;
    let kindSlotsNothing = b.n * per;
    if (axis) {
      const out: Record<string, unknown> = {};
      roles = out;
      kindSlotsNothing = 0;
      let roleParts = 0, roleStored = 0;
      for (const role of [...ROLE_DOMAINS[axis], "(unresolved)"]) {
        const rq = kindQuestionSet(category, kind, role === "(unresolved)" ? null : role);
        const rper = slotsAtNothingKnown(rq);
        const ra = b.roles.get(role) ?? newRoleAcc();
        kindSlotsNothing += ra.n * rper; roleParts += ra.n; roleStored += ra.stored;
        out[role] = {
          parts: ra.n,
          // (unresolved), operator ruling 13 Sep 2026: kind-issue rows printed and split by plan state, the III.4 bar
          // over what the role rules are responsible for, and "(unresolved) N — K pending move/class".
          ...(role === "(unresolved)" ? {
            kind_issue_parts: ra.issue.kind_issue_parts,
            kind_issue: { pending_plan: ra.issue.pending_plan, plan_ran: ra.issue.plan_ran, unplanned: ra.issue.unplanned },
            null_share_excluding_kind_issue: nullShareExcludingKindIssue(b.n, ra.n, ra.issue.kind_issue_parts),
            display: unresolvedDisplay(ra.n, ra.issue),
            _unresolved_note: "no rule of deployRole.ts places these parts (null role): asked the kind's core. `kind_issue_parts` of them hit an ISSUE rule — the row is not this kind at all and waits on a move/class plan (data/reference/kind-layer-plans-2026-09-13.json). The III.4 3% bar is applied to (unresolved - kind_issue_parts) / (kind parts - kind_issue_parts).",
          } : {}),
          slots_per_part_at_nothing_known: rper,
          required_slots_at_nothing_known: ra.n * rper,
          required_slots_stored: ra.stored,
          document_evidence: { spec_bearing: ra.spec, spec_linked_not_held: ra.specNotHeld, eol_only: ra.eolOnly, no_document: ra.noDoc,
            spec_bearing_by_doc_type_legacy: ra.legacy, blocked_by: blockedBy(ra.n, ra.spec) },
          required: rq.required.map(evidence),
          pending_until_gate_answered: rq.pending.map((p) => ({ ...evidence(p.key), gate: p.gate })),
          not_applicable_by_kind: rq.not_applicable_by_kind,
          optional: rq.optional,
          column_backed: rq.column_backed,
        };
      }
      const strays = [...b.roles.keys()].filter((r) => !(r in out));
      if (roleParts !== b.n || roleStored !== b.stored || strays.length) {
        throw new Error(`${category}.${kind}: role blocks do not sum to the kind (parts ${roleParts}/${b.n}, stored ${roleStored}/${b.stored}${strays.length ? `, roles outside the domain: ${strays.join(", ")}` : ""})`);
      }
    }
    // ---- TERM 13 (spec v2 §I.3) ----------------------------------------------------------------------------------------
    // The three inputs, measured here; the label-Jaccard and any exception copied from the reference file; the verdict
    // judged by the same function tests/cupLedger.test.ts calls. Denominator of the share: every hardware row this
    // ledger read for the category (fallback.hardware_parts), including rows held out for reclassification.
    const share = { num: b.n, den: parts.length, pct: parts.length === 0 ? null : Math.round((b.n / parts.length) * 1000) / 10 };
    const term13Input = { parts: b.n, share_of_category: share, series_count: b.groups.size, role_axis: (axis ? "deploy_role" : "none") as "none" | "deploy_role",
      slots_per_part_at_nothing_known: per, required: qs.required.map((key) => ({ key })), pending_until_gate_answered: qs.pending };
    const verdict = judgeTerm13(granularity, category, kind, term13Input);
    const exception = granularity.exceptions[`${category}.${kind}`];
    slotsNothing += kindSlotsNothing; slotsStored += b.stored; partsTotal += b.n;
    kinds[kind] = {
      parts: b.n,
      // fallback-kinds (12 Sep 2026): the own-fact and device-noun census, per kind.
      parts_with_3plus_own_facts: b.facts3,
      parts_with_a_device_noun_in_name: b.noun,
      // device-noun (13 Sep 2026): nouns this kind excuses by rule (DEVICE_NOUN_EXEMPT_KINDS); 0 for every other kind.
      parts_with_a_device_noun_exempt_by_kind: b.nounExempt,
      slots_per_part_at_nothing_known: per,
      // kind-layer infra (13 Sep 2026): Σ over the roles when the kind has a role axis (see `roles`), else parts × per.
      required_slots_at_nothing_known: kindSlotsNothing,
      required_slots_stored: b.stored,
      // TERM 13 inputs and verdict (spec v2 §I.3).
      series_count: b.groups.size,
      share_of_category: share,
      role_axis: axis ? "deploy_role" : "none",
      label_jaccard: measuredFor(granularity, category, kind)?.label_jaccard ?? null,
      granularity_exception: exception ? { basis: exception.basis, reason: exception.reason, status: exception.status } : null,
      term13: verdict,
      // WHY A REQUIRED CUP OF THIS KIND IS EMPTY — the difference between our problem and the
      // crawler's. `blocked_by` is the verdict a readiness report must print instead of a bare
      // "not ready": `schema-or-parsing` when most of the kind holds a datasheet, `not-held` when
      // most of it does not. The three counts are always emitted so the verdict can be re-derived
      // rather than trusted.
      document_evidence: {
        spec_bearing: b.spec, spec_linked_not_held: b.specNotHeld, eol_only: b.eolOnly, no_document: b.noDoc,
        spec_bearing_by_doc_type_legacy: b.legacy,
        blocked_by: b.n === 0 ? "no parts" : b.spec >= b.n / 2 ? "schema-or-parsing" : "not-held (acquisition)",
      },
      required: qs.required.map(evidence),
      pending_until_gate_answered: qs.pending.map((p) => ({ ...evidence(p.key), gate: p.gate })),
      not_applicable_by_kind: qs.not_applicable_by_kind,
      optional: qs.optional,
      column_backed: qs.column_backed,
      ...(roles ? { roles } : {}),
    };
  }

  let commit = "unknown";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
  const ledger = {
    _about: "GENERATED by scripts/build-cup-ledger.mts — do not edit by hand. The denominator of the filling phase: what every part of each kind is asked. tests/cupLedger.test.ts fails when the profile no longer matches. " +
      `DEVICE-NOUN EXEMPT KINDS: [${DEVICE_NOUN_EXEMPT_KINDS.join(", ")}] — named after their host by rule; see totals.fallback._about.`,
    vendor, category,
    profile_hash: profileHash(category),
    built_on_commit: commit,
    norm_version: NORM_VERSION,
    declared_fields: Object.keys(PROFILES[category]).length,
    gap_states: GAP_STATES,
    // kind layer 6b: which held rule and which plans file this ledger was built with.
    held_rule: `held = >= 1 doc_parts row with ${heldRowSql("dp")}; document_evidence.spec_bearing_by_doc_type_legacy = any linked doc of type ${SPEC_BEARING_DOC_TYPES.join("|")}`,
    kind_layer_plans: { file: plans.file, sha256: plans.sha256, plans: plans.plans.length, run: plans.plans.filter((p) => p.run_id !== null).length },
    totals: {
      parts: partsTotal,
      required_slots_at_nothing_known: slotsNothing,
      required_slots_stored: slotsStored,
      _slots_note: "at_nothing_known = parts × (required + pending) with only the kind known — and, for a kind with a role axis (role_axis: deploy_role), the SUM over its `roles` blocks of role parts × that role's (required + pending), because a role that asks fewer cups opens fewer slots; the kind's own `slots_per_part_at_nothing_known` and cup lists are its CORE (the `(unresolved)` role). stored = the live denominator (completeness.required_total), smaller wherever an answered gate has closed a pending question; per role it is the same sum split by role",
      by_kind: Object.fromEntries(LEDGER_KINDS[category].map((k) => [k, (kinds[k] as { parts: number }).parts])),
      // security (12 Sep 2026): rows the kind axis judged non-hardware from the class table while the parts
      // row still says `hardware`. Counted here, not inside a kind — see the note at byKind.delete().
      // `parts` above EXCLUDES them, so parts + pending_reclassification is the category's hardware count.
      pending_reclassification: pendingReclass,
      pending_reclassification_stored_slots: pendingReclassStoredSlots,
      // fallback-kinds (12 Sep 2026)
      fallback: fallbackCensus,
    },
    kinds,
  };
  // THE PLAN LEASE (operator ruling): a kind-issue row still inside its kind after its move/class plan ran means the plan
  // did not do what it said. Refuse to write a ledger that would count it as merely unresolved.
  const ranButHere = plansRanButStillInKind(kindIssueRows);
  if (ranButHere.length) throw new Error(`REFUSED: ${ranButHere.length} kind-issue row(s) still in their kind after the plan ran: ${ranButHere.slice(0, 10).join("; ")}`);
  const out = path.join(ROOT, "data/ledger", `${vendor}-${category}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, out)}: ${partsTotal} parts, ${slotsNothing} slots at nothing-known, ${slotsStored} stored`);
  for (const k of LEDGER_KINDS[category]) {
    type Ev = { key: string; observed_fill_path: boolean; seed_only: boolean };
    type RoleOut = { parts: number; slots_per_part_at_nothing_known: number; required: Ev[]; pending_until_gate_answered: Ev[] };
    const x = kinds[k] as RoleOut & { term13: { verdict: string; basis: string | null }; roles?: Record<string, RoleOut> };
    // Fill paths over the core AND every role's own cups: a role addition is a cup the core never asks.
    const all = [x, ...Object.values(x.roles ?? {})].flatMap((r) => [...r.required, ...r.pending_until_gate_answered]);
    const seed = [...new Set(all.filter((f) => f.seed_only).map((f) => f.key))];
    const blind = [...new Set(all.filter((f) => !f.observed_fill_path && !f.seed_only).map((f) => f.key))];
    const t13 = x.term13.verdict === "not-tripped" ? "" : `   term13 ${x.term13.verdict}${x.term13.basis ? ` (${x.term13.basis})` : ""}`;
    console.log(`  ${k.padEnd(12)} parts ${String(x.parts).padStart(5)}  asked ${String(x.slots_per_part_at_nothing_known).padStart(2)}${t13}` +
      `${seed.length ? `   SEED-ONLY: ${seed.join(", ")}` : ""}${blind.length ? `   NO FILL PATH: ${blind.join(", ")}` : ""}`);
    for (const [role, r] of Object.entries(x.roles ?? {}) as [string, RoleOut & { display?: string; null_share_excluding_kind_issue?: { pct: number | null; over_3pct: boolean } }][]) {
      const shown = role === "(unresolved)" && r.display
        ? `${r.display}; excluding them ${r.null_share_excluding_kind_issue?.pct ?? "—"}% of the kind${r.null_share_excluding_kind_issue?.over_3pct ? " (OVER the III.4 3% bar)" : ""}`
        : `role ${role}`;
      console.log(`      ${shown.padEnd(19)} parts ${String(r.parts).padStart(5)}  asked ${String(r.slots_per_part_at_nothing_known).padStart(2)}`);
    }
  }
  await closePool();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
