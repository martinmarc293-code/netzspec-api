/**
 * Build THE COMPLETENESS REPORT for a brand (phase-1 close guide §3): the one artifact that answers "which cups are
 * still empty, and why?" and "is this category 100% complete, against what denominator?".
 *
 *     npx tsx scripts/build-completeness.mts --vendor cisco
 *         -> data/completeness/cisco.json         (served at /v1/completeness/cisco and /v1/completeness/cisco/<category>)
 *     npx tsx scripts/build-completeness.mts --vendor cisco --since 2026-09-12T00:00:00Z
 *         -> also data/completeness/cisco.since.json   (the three day-one numbers, §3.5; /v1/completeness/cisco?since=…)
 *
 * The definitions are docs/completeness-model.md, and every number here uses them verbatim.
 *
 * SOURCES OF TRUTH (guide Appendix C), and what each is used for:
 *   data/ledger/<vendor>-*.json   the arrangement: which kinds exist, what each kind is asked (required / pending with its
 *                                 gate), document_evidence, per-cup fill paths and sources. The report is CHECKED against
 *                                 them, never silently re-derived from them.
 *   data/census/<vendor>-*.json   would_refuse / could_not_replay per category. The census counts per CATEGORY over every
 *                                 live part and every key; the report needs them per PART and per required cup, so the
 *                                 census's own replay is copied here VERBATIM and proven equal to the committed census
 *                                 totals (check `census_replay_parity`) before a single per-part defect is believed.
 *   the store (read-only)          parts, completeness.required_fields, current facts, document links.
 *
 * KIND IS NOT A COLUMN. It is partKind(category, sku, name), imported — the ledger builder's exact call, with the name.
 *
 * READ-ONLY, BY CONSTRUCTION: one client, application_name `agent/completeness`, `default_transaction_read_only = on`
 * asserted before the first query, 300 s statement timeout, and no correlated per-part subquery anywhere (every
 * per-part number is a GROUP BY or is computed here). It writes files and no database row, so it opens no run.
 *
 * THE BUILD REFUSES TO WRITE A REPORT WHOSE CROSS-CHECKS FAIL (§3.4). The checker is checkReport() in
 * src/api/queries/completeness.ts, the same function tests/completeness.test.ts drives with sabotage copies. On a
 * failure the draft goes to the OS temp directory for reading and the process exits 1 naming every failed check.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";
import { resolveDatabaseUrl } from "../src/store/db.js";
import { partKind, FALLBACK_KINDS } from "../src/core/partKind.js";
import { LEDGER_KINDS, kindQuestionSet, slotsAtNothingKnown } from "../src/core/cupLedger.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import { SPEC_BEARING } from "../src/core/docClass.js";
import {
  checkReport, cupRequirement, ledgerCupKeys, pctOf, UNRESOLVED_ROLE, type Block, type CategoryBlock, type CheckContext, type CompletenessReport, type CrossCheck,
  type CupRow, type KindBlock, type LedgerLike, type RoleBlock,
} from "../src/api/queries/completeness.js";
// kind-layer infra (13 Sep 2026): layer 3. The role of a part is the one call recompute-completeness, the ledger builder
// and the API make (deployRole with the derived kind and the name); a null role is `(unresolved)`, never the biggest role.
import { deployRole, deployRoleRule, roleAxisOf, ROLE_DOMAINS } from "../src/core/deployRole.js";
// kind layer 6b (13 Sep 2026): held by relevance, the mapper-gap state, the kind-issue plans.
import { modularPlatform } from "../src/core/modularPlatform.js";
import { UNKNOWN_HARDWARE_SQL, splitUnknown, type UnknownRow } from "../src/core/unknownEvidence.js";
import { SPEC_BEARING_DOC_TYPES, heldRowSql, underivedRowSql, docStateOf, underivedRefusal, missingColumnsRefusal } from "../src/core/heldEvidence.js";
import { loadCupEvidence, cupStateIndex, inertMapperGapEntries } from "../src/core/cupEvidence.js";
import { loadPlans, planStatusIndex, emptyBreakdown, addKindIssue, nullShareExcludingKindIssue, unresolvedDisplay,
  plansRanButStillInKind, type KindIssueBreakdown, type KindLayerPlan, type PlanStatus } from "../src/core/kindLayerPlans.js";

const t0 = Date.now();
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

/** The freeze this report's numbers are measured against: the hash in the committed data/freeze/<vendor>.json. */
function readFreezeHash(vendor: string): { freeze_hash: string | null; freeze_hash_reason?: string } {
  const file = path.join(ROOT, "data", "freeze", `${vendor}.json`);
  if (!fs.existsSync(file)) return { freeze_hash: null, freeze_hash_reason: `no committed freeze file (data/freeze/${vendor}.json)` };
  const h = (JSON.parse(fs.readFileSync(file, "utf8")) as { freeze_hash?: unknown }).freeze_hash;
  if (typeof h !== "string" || !h) throw new Error(`data/freeze/${vendor}.json carries no freeze_hash`);
  return { freeze_hash: h };
}

/**
 * THE SPEC-BEARING LIST THE LEDGERS ARE BUILT WITH — imported since kind layer 6b (src/core/heldEvidence.ts), where both
 * builders read it; it used to be restated here. It is NOT docClass.SPEC_BEARING, which omits `vendor_page` — the
 * difference is measured and printed in `model_disagreements`, not resolved here. Since the held-by-relevance ruling it
 * decides only the LEGACY held (`held_by_doc_type_legacy`), `spec_linked_not_held`, and which rows must be derived.
 */
const LEDGER_SPEC_BEARING = SPEC_BEARING_DOC_TYPES;
const GAP_STATES = new Set(["gap_confirmed", "gap_unattempted", "not_applicable"]);
const RENDERED = new Set(["verified", "corroborated"]);
/** §5.1's token list, exactly. The guard does not exist yet; this only COUNTS stored rows whose raw is one of them. */
const PLACEHOLDER_TOKENS = new Set(["NA", "N/A", "n/a", "-", "–", "—", "✓", "✓ *", "x", "X", "none", "TBD", "n.a.", ""]);
const LONE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const isPlaceholder = (raw: string): boolean => { const t = raw.trim(); return PLACEHOLDER_TOKENS.has(t) || LONE_PUNCTUATION.test(t); };

// ---- THE CENSUS REPLAY, COPIED VERBATIM from scripts/build-value-census.mts (replayRefusal, BARE_MAGNITUDE,
// couldNotReplay). Copied rather than re-written because a stand-in tests the logic you were thinking about, never
// the code that runs (D:\Project\CLAUDE.md §17); `census_replay_parity` proves the copy reproduces the committed census.
type FactRow = {
  part_id: string; category: string; product_class: string; field_key: string; raw: string; unit: string | null;
  method: string; state: string; vnull: boolean; inherited: boolean; created_at: string; doc_id: string | null;
};
function replayRefusal(category: string, key: string, r: Pick<FactRow, "raw" | "unit" | "method">): { reason: string; detail: string } | null {
  if (r.method.startsWith("derived:")) return replayDerived(r.method, r.raw);  // its raw is the derivation's input
  const locale = r.method === "hexcat_seed" ? "de" : "en";
  const bare = normalizeField(category, key, r.raw, { locale });
  if (bare.ok) return null;
  const hinted = normalizeField(category, key, r.raw, { locale, unitHint: r.unit ?? undefined });
  if (hinted.ok) return null;
  return { reason: bare.reason, detail: bare.detail };
}
const BARE_MAGNITUDE = /^[\s(]*[-+−]?[\d.,]+[\s)]*$/;
function couldNotReplay(key: string, r: Pick<FactRow, "raw">): boolean {
  return Boolean(FIELD_DICTIONARY[key]?.unit) && BARE_MAGNITUDE.test(r.raw);
}
// ---- end of the verbatim copy -------------------------------------------------------------------------------------

type LedgerCup = {
  key: string; gate?: string[]; sources?: { source: string; basis: string; enabled: boolean; facts_current: number }[];
  label_occurrences?: number; observed_fill_path?: boolean; observed_filled?: boolean; seed_only?: boolean; derived_by?: string;
};
/** A block of cups with their evidence: the kind's core, or one of its roles — the ledger builds both with `evidence()`. */
type LedgerBlock = { required: LedgerCup[]; pending_until_gate_answered: LedgerCup[] };
type LedgerKind = Omit<LedgerLike["kinds"][string], "required" | "pending_until_gate_answered" | "roles">
  & LedgerBlock & { roles?: Record<string, LedgerBlock & { parts: number }> };
type Ledger = Omit<LedgerLike, "kinds" | "totals"> & {
  profile_hash: string; built_on_commit: string;
  totals: LedgerLike["totals"] & { fallback: LedgerLike["totals"]["fallback"] & {
    either: { device_noun: number }; unresolved_kind: { device_noun: number } } };
  kinds: Record<string, LedgerKind>;
};
type Census = { category: string; built_on_commit: string; norm_version: string; facts: number; would_refuse_total: number;
  could_not_replay_total: number; cups: { key: string; would_refuse: { n: number } }[] };

/** One slot's verdict. `held` decides which half of the report it lands in. */
type SlotState = "filled" | "not_published" | "not_parsed" | "mapper_gap" | "would_refuse";

type Acc = {
  parts: number; askedNothing: number; spec: number; specNotHeld: number; legacy: number; eol: number; none: number;
  heldSlots: number; filled: number; notPub: number; notParsed: number; mapperGap: number; wr: number; notRendered: number;
  notHeldParts: number; notHeldSlots: number; notHeldFilled: number; wrNotHeld: number;
  cnr: number; placeholders: number; inherited: number;
};
const newAcc = (): Acc => ({ parts: 0, askedNothing: 0, spec: 0, specNotHeld: 0, legacy: 0, eol: 0, none: 0, heldSlots: 0, filled: 0, notPub: 0,
  notParsed: 0, mapperGap: 0, wr: 0, notRendered: 0, notHeldParts: 0, notHeldSlots: 0, notHeldFilled: 0, wrNotHeld: 0, cnr: 0, placeholders: 0, inherited: 0 });
type CupAcc = { asked: number; heldAsked: number; filled: number; notPub: number; notParsed: number; mapperGap: number; wr: number;
  notHeld: number; notHeldFilled: number; notHeldWr: number; cnr: number; inherited: number; notRendered: number; placeholders: number };
const newCup = (): CupAcc => ({ asked: 0, heldAsked: 0, filled: 0, notPub: 0, notParsed: 0, mapperGap: 0, wr: 0, notHeld: 0, notHeldFilled: 0,
  notHeldWr: 0, cnr: 0, inherited: 0, notRendered: 0, placeholders: 0 });

function block(a: Acc): Block {
  const asked = a.parts - a.askedNothing;
  return {
    hardware_parts: a.parts,
    arranged: { asked, asked_nothing_fallback: a.askedNothing, ...pctOf(asked, a.parts) },
    held: { spec_bearing: a.spec, spec_linked_not_held: a.specNotHeld, eol_only: a.eol, no_document: a.none,
      held_by_doc_type_legacy: pctOf(a.legacy, a.parts), ...pctOf(a.spec, a.parts) },
    filled: {
      required_slots_held: a.heldSlots, filled: a.filled, not_published: a.notPub, not_parsed: a.notParsed, mapper_gap: a.mapperGap,
      would_refuse: a.wr, filled_not_rendered: a.notRendered,
      not_held_parts: a.notHeldParts, not_held_slots: a.notHeldSlots, not_held_filled: a.notHeldFilled,
      ...pctOf(a.filled + a.notPub, a.heldSlots),
    },
    defects: { would_refuse: a.wr, would_refuse_not_held: a.wrNotHeld, could_not_replay: a.cnr, placeholders_stored: a.placeholders },
    inherited_share: { inherited: a.inherited, filled: a.filled, ...pctOf(a.inherited, a.filled) },
  };
}

async function main(): Promise<void> {
  const vendor = arg("--vendor");
  if (!vendor || !/^[a-z0-9][a-z0-9-]*$/.test(vendor)) throw new Error("--vendor <slug> is required");
  const since = arg("--since");
  if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error(`--since must be an ISO timestamp, got ${since}`);

  // ---- committed inputs -------------------------------------------------------------------------------------------
  const ledgers: Record<string, Ledger> = {};
  for (const f of fs.readdirSync(path.join(ROOT, "data/ledger")).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ledger", f), "utf8")) as Ledger;
    if (j.vendor === vendor) ledgers[j.category] = j;
  }
  if (Object.keys(ledgers).length === 0) throw new Error(`no committed ledger for vendor ${vendor} in data/ledger`);
  const censuses: Record<string, Census> = {};
  for (const f of fs.readdirSync(path.join(ROOT, "data/census")).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data/census", f), "utf8")) as Census & { vendor: string };
    if (j.vendor === vendor) censuses[j.category] = j;
  }
  // kind layer 6b: the printed-bar measurement (mapper-gap) and the move/class plans. Both REQUIRED files — a missing one
  // throws, because "no measurement" and "no plans" must be written down ([] is valid), never inferred from absence.
  const cupEvidence = loadCupEvidence(ROOT, vendor);
  const cupStateOf = cupStateIndex(cupEvidence.entries);
  const plans = loadPlans(ROOT);
  const planOf = planStatusIndex(plans.plans);
  // A mapper-gap entry that matches no (kind, role, asked cup) would move nothing while reading as applied: refuse.
  const inertEvidence = inertMapperGapEntries(cupEvidence.entries, (category, kind, role) => {
    if (!LEDGER_KINDS[category]?.includes(kind)) return null;
    const axis = roleAxisOf(category, kind);
    if (role !== null && (!axis || !ROLE_DOMAINS[axis].includes(role))) return null;
    const qs = kindQuestionSet(category, kind, role);
    return new Set([...qs.required, ...qs.pending.map((p) => p.key)]);
  });

  // ---- the store, read-only ---------------------------------------------------------------------------------------
  const client = new pg.Client({ connectionString: resolveDatabaseUrl(), application_name: "agent/completeness", statement_timeout: 300_000 });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const ro = (await client.query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only;
  if (ro !== "on") throw new Error(`refusing to run: default_transaction_read_only is ${ro}`);
  const q = async <T extends pg.QueryResultRow>(label: string, sql: string, params: unknown[] = []): Promise<T[]> => {
    const s = Date.now();
    const r = await client.query<T>(sql, params);
    console.log(`  query ${label}: ${r.rowCount} rows in ${Date.now() - s} ms`);
    return r.rows;
  };

  // ---- HELD BY RELEVANCE: the contract must be in place before a single held number is computed ------------------
  const provCols = (await q<{ column_name: string }>("doc_parts provenance columns", `
    SELECT column_name FROM information_schema.columns WHERE table_name = 'doc_parts' AND column_name = ANY($1::text[])`,
    [["link_basis", "doc_relevance", "link_evidence"]])).map((r) => r.column_name);
  const noCols = missingColumnsRefusal(provCols);
  if (noCols) throw new Error(noCols);
  const underived = (await q<{ rows: number; parts: number }>("underived spec-bearing links", `
    SELECT count(*)::int AS rows, count(DISTINCT dp.part_id)::int AS parts
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND sd.doc_type = ANY($2::text[]) AND ${underivedRowSql("dp")}`, [vendor, LEDGER_SPEC_BEARING]))[0];
  const refusal = underivedRefusal(vendor, underived.rows, underived.parts);
  if (refusal) throw new Error(refusal);

  const partRows = await q<{ id: string; sku: string; name: string | null; category: string; series: string | null; family: string | null;
    required_total: number | null; required_fields: string[] | null; required_present: number | null;
    relation_cups: Record<string, string> | null }>("parts", `
    SELECT p.id::text, p.sku, p.name, ct.slug AS category, p.series, p.family,
           cp.required_total, cp.required_fields, cp.required_present, cp.relation_cups
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
      LEFT JOIN completeness cp ON cp.part_id = p.id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       -- A PART THE ROLE TABLE REFUSES IS NOT IN THE POPULATION THIS REPORT DESCRIBES (27 Sep 2026).
       -- recompute-completeness stopped scoring these (no_profile_reason = kind_refused_by_role_table:
       -- 18 GPON/XGS-PON rows in switches that rule sw.issue.ont says are not Ethernet switches), and
       -- the cup ledger excludes them from its kind populations for the same reason. If this query did
       -- not, the report would describe 7,224 switches parts against the ledger's 7,206 and every
       -- cross-check between the two artifacts would be measuring that gap instead of the mould --
       -- which is exactly what cup_asked_matches_ledger and hardware_parts caught.
       --
       -- READ FROM THE STORED ROW, NOT RE-DERIVED. recompute wrote the reason; re-deriving the refusal
       -- here would be a second implementation of the rule that can drift from the one that scored.
       AND coalesce(cp.no_profile_reason, '') <> 'kind_refused_by_role_table'`, [vendor]);

  // `held` = a row passing the operator's rule (heldRowSql); `spec` = any spec-bearing doc type (the LEGACY held).
  const docRows = await q<{ part_id: string; held: boolean; spec: boolean; spec_docclass: boolean; types: string[] }>("documents per part", `
    SELECT dp.part_id::text,
           bool_or(${heldRowSql("dp")}) AS held,
           bool_or(sd.doc_type = ANY($2::text[])) AS spec,
           bool_or(sd.doc_type = ANY($3::text[])) AS spec_docclass,
           array_agg(DISTINCT sd.doc_type) AS types
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
     GROUP BY dp.part_id`, [vendor, LEDGER_SPEC_BEARING, [...SPEC_BEARING]]);
  const docs = new Map(docRows.map((d) => [d.part_id, d]));

  // Every current, non-retracted fact of every LIVE part of the vendor (all classes: the census parity needs them).
  const factRows = await q<FactRow>("current facts", `
    SELECT f.part_id::text, ct.slug AS category, p.product_class::text AS product_class, f.field_key, f.raw, f.unit,
           f.method, f.state::text AS state, (f.value IS NULL) AS vnull, (f.inherited_from IS NOT NULL) AS inherited,
           f.created_at::text, f.doc_id
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`, [vendor]);

  // Independent aggregates for the cross-checks — computed in SQL, not from the arrays above.
  const live = (await q<{ hardware_parts: number; refused_by_role_table: number; live_parts: number; scored_parts: number;
    r_brand_not_arranged: number; r_non_hardware: number; r_refused: number; r_no_category_profile: number; r_no_completeness_row: number;
    parts_nothing_required: number; required_total_held: number; required_present_held: number }>("live aggregates", `
    WITH held AS (SELECT DISTINCT dp.part_id FROM doc_parts dp WHERE ${heldRowSql("dp")})
    SELECT count(*) FILTER (WHERE p.product_class = 'hardware')::int AS hardware_parts,
           -- COUNTED, NOT FILTERED OUT (27 Sep 2026). The report describes the SCORED population and so
           -- excludes parts the role table refuses, but the live catalogue count must stay the live
           -- catalogue count or the difference becomes invisible. Carried here so hardware_parts can
           -- assert the IDENTITY -- live = scored + refused -- instead of one number quietly shrinking.
           count(*) FILTER (WHERE p.product_class = 'hardware'
                              AND cp.no_profile_reason = 'kind_refused_by_role_table')::int AS refused_by_role_table,
           -- THE WHOLE PARTITION OF THE LIVE CATALOGUE, every term named (reviewer, 27 Sep 2026). The
           -- hardware identity above proved one exclusion; this proves there are no OTHERS. Printed on the
           -- brand page with every term, so no exclusion added later can shrink a denominator without
           -- appearing here as a number somebody has to explain.
           count(*)::int AS live_parts,
           count(*) FILTER (WHERE cp.no_profile = false)::int AS scored_parts,
           count(*) FILTER (WHERE cp.no_profile_reason = 'brand_not_arranged')::int AS r_brand_not_arranged,
           count(*) FILTER (WHERE cp.no_profile_reason = 'non_hardware')::int AS r_non_hardware,
           count(*) FILTER (WHERE cp.no_profile_reason = 'kind_refused_by_role_table')::int AS r_refused,
           count(*) FILTER (WHERE cp.no_profile_reason = 'category_has_no_profile')::int AS r_no_category_profile,
           -- THE TERM NOBODY ASKS FOR AND THE ONE THAT MAKES THE SUM HONEST: a live part with NO completeness
           -- row is in neither the scored set nor any excluded set. Without a term of its own the partition
           -- either fails to sum for a reason nobody can name, or gets quietly balanced by folding it into
           -- one of the others. It is 0 today and it is printed anyway.
           count(*) FILTER (WHERE cp.part_id IS NULL)::int AS r_no_completeness_row,
           -- exactly /v1/stats/gaps parts_nothing_required (src/api/queries/gaps.ts), summed over the vendor
           -- a part owing a RELATION_BACKED cup it cannot yet answer (not_held, ruling 12a) is asked something
           count(*) FILTER (WHERE NOT cp.no_profile AND cp.required_total = 0 AND cp.relation_cups IS NULL)::int AS parts_nothing_required,
           COALESCE(sum(cp.required_total) FILTER (WHERE p.product_class = 'hardware' AND h.part_id IS NOT NULL), 0)::int AS required_total_held,
           COALESCE(sum(cp.required_present) FILTER (WHERE p.product_class = 'hardware' AND h.part_id IS NOT NULL), 0)::int AS required_present_held
      FROM parts p JOIN vendors v ON v.id = p.vendor_id
      LEFT JOIN completeness cp ON cp.part_id = p.id
      LEFT JOIN held h ON h.part_id = p.id
     WHERE v.slug = $1 AND p.retired_at IS NULL`, [vendor]))[0];

  // THE LINE THE OWNER READS FIRST. Every exclusion named, and the sum asserted by `live_partition`, so
  // "how much of this brand is even being measured" is answerable without trusting any single number.
  const partition = { scored: live.scored_parts, non_hardware: live.r_non_hardware, brand_not_arranged: live.r_brand_not_arranged,
    kind_refused_by_role_table: live.r_refused, category_has_no_profile: live.r_no_category_profile,
    no_completeness_row: live.r_no_completeness_row };
  const partSum = Object.values(partition).reduce((a, b) => a + b, 0);
  console.log(`  live catalogue ${live.live_parts.toLocaleString()} = `
    + Object.entries(partition).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(" + ")
    + (partSum === live.live_parts ? "" : `   <<< DOES NOT SUM (${partSum.toLocaleString()})`));
  const classRows = await q<{ product_class: string; n: number }>("product classes", `
    SELECT p.product_class::text, count(*)::int AS n FROM parts p JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL GROUP BY 1 ORDER BY 2 DESC`, [vendor]);

  // ---- facts by part and key ---------------------------------------------------------------------------------------
  const factsByPart = new Map<string, Map<string, FactRow>>();
  for (const f of factRows) {
    const m = factsByPart.get(f.part_id) ?? new Map<string, FactRow>();
    m.set(f.field_key, f);                       // facts_current_uq: at most one current row per (part, key)
    factsByPart.set(f.part_id, m);
  }

  // ---- census_replay_parity: the copied replay must reproduce every committed census total ------------------------
  const parity: string[] = [];
  const parityRows: Record<string, unknown>[] = [];
  for (const [category, cen] of Object.entries(censuses)) {
    let facts = 0, refused = 0, unreplayable = 0;
    for (const f of factRows) {
      if (f.category !== category || f.vnull) continue;
      facts++;
      if (!FIELD_DICTIONARY[f.field_key]) continue;
      if (couldNotReplay(f.field_key, f)) { unreplayable++; continue; }
      if (replayRefusal(category, f.field_key, f)) refused++;
    }
    parityRows.push({ category, facts, census_facts: cen.facts, would_refuse: refused, census_would_refuse: cen.would_refuse_total,
      could_not_replay: unreplayable, census_could_not_replay: cen.could_not_replay_total });
    if (facts !== cen.facts || refused !== cen.would_refuse_total || unreplayable !== cen.could_not_replay_total) {
      parity.push(`${category}: facts ${facts}/${cen.facts}, would_refuse ${refused}/${cen.would_refuse_total}, could_not_replay ${unreplayable}/${cen.could_not_replay_total} (replay/census)`);
    }
  }
  for (const category of Object.keys(ledgers)) if (!censuses[category]) parity.push(`${category}: no committed census`);

  // ---- per part ----------------------------------------------------------------------------------------------------
  const brandAcc = newAcc();
  const catAcc = new Map<string, Acc>();
  const kindAcc = new Map<string, Acc>();               // `${category}|${kind}`
  const roleAcc = new Map<string, Acc>();               // `${category}|${kind}|${role or (unresolved)}` — kinds with a role axis only
  // same key: parts whose rule says the row is not this kind, split by the state of their move/class plan (6b)
  const roleIssue = new Map<string, KindIssueBreakdown>();
  const kindIssueRows: { category: string; kind: string; sku: string; status: PlanStatus; plan: KindLayerPlan | null }[] = [];
  const relAcc = new Map<string, { filled: number; not_held: number }>();   // `${category}|${kind}|${key}` (ruling 12a)
  const cupAcc = new Map<string, CupAcc>();             // `${category}|${kind}|${key}`
  const pendingReclass = new Map<string, number>();
  const notHeldByClass = new Map<string, number>();
  const noCompleteness: string[] = [];
  let pendingUnresolved = 0, pendingResolved = 0, heldUnderDocClassOnly = 0, heldUnderLedgerOnly = 0;
  let pdfLinkedHeld = 0;
  const askedNothingCache = new Map<string, boolean>();
  const askedNothing = (category: string, kind: string): boolean => {
    const k = `${category}|${kind}`;
    if (!askedNothingCache.has(k)) {
      let v = false;
      if (LEDGER_KINDS[category]?.includes(kind)) { try { v = slotsAtNothingKnown(kindQuestionSet(category, kind)) === 0; } catch { v = false; } }
      askedNothingCache.set(k, v);
    }
    return askedNothingCache.get(k)!;
  };
  const kindOf = new Map<string, { category: string; kind: string; held: boolean }>();
  const partsOutFile = arg("--parts-out");
  const partsOut: { id: string; sku: string; name: string | null; series: string | null; category: string; kind: string; role: string | null;
    doc_state: string; legacy_held: boolean; asked_nothing: boolean; states: Record<string, string> }[] | null = partsOutFile ? [] : null;

  for (const p of partRows) {
    const kind = partKind(p.category, p.sku, p.name ?? undefined) ?? "(none)";
    // The ledger's own rule (build-cup-ledger.mts): a `non-hardware` kind is counted beside the kinds, never in one.
    if (kind === "non-hardware") { pendingReclass.set(p.category, (pendingReclass.get(p.category) ?? 0) + 1); continue; }
    const d = docs.get(p.id);
    // HELD BY RELEVANCE (6b): the operator's rule; the doc-type test survives only as the legacy count beside it.
    const docState = docStateOf({ held_rows: d?.held ? 1 : 0, spec_rows: d?.spec ? 1 : 0, any_rows: d ? 1 : 0 });
    const held = docState === "held";
    const legacyHeld = Boolean(d?.spec);
    if (d && d.spec !== d.spec_docclass) { if (d.spec) heldUnderLedgerOnly++; else heldUnderDocClassOnly++; }
    if (held && d!.types.includes("vendor_datasheet_pdf")) pdfLinkedHeld++;
    kindOf.set(p.id, { category: p.category, kind, held });
    const accs = [brandAcc, catAcc.get(p.category) ?? newAcc(), kindAcc.get(`${p.category}|${kind}`) ?? newAcc()];
    catAcc.set(p.category, accs[1]); kindAcc.set(`${p.category}|${kind}`, accs[2]);
    // LAYER 3: the role accumulator joins `accs`, so every counter below lands in it by the very statement that lands it
    // in the kind — the same definitions by construction, not by a second implementation.
    const axis = roleAxisOf(p.category, kind);
    const role = axis ? deployRole(p.category, kind, p.sku, p.name) : null;
    if (axis) {
      if (role !== null && !ROLE_DOMAINS[axis].includes(role)) throw new Error(`deployRole gave ${p.sku} role "${role}", outside the ${axis} domain`);
      const rk = `${p.category}|${kind}|${role ?? UNRESOLVED_ROLE}`;
      const ra = roleAcc.get(rk) ?? newAcc();
      roleAcc.set(rk, ra);
      accs.push(ra);
      if (role === null && deployRoleRule(axis, p.sku, p.name).issue !== null) {
        const { status, plan } = planOf(p.category, p.sku);
        const b = roleIssue.get(rk) ?? emptyBreakdown();
        addKindIssue(b, status);
        roleIssue.set(rk, b);
        kindIssueRows.push({ category: p.category, kind, sku: p.sku, status, plan });
      }
    }
    const nothing = askedNothing(p.category, kind);
    if (p.required_fields === null) noCompleteness.push(p.sku);
    const required = p.required_fields ?? [];
    // --parts-out (arrangement site, 13 Sep 2026): the per-part verdicts THIS loop reaches, written as they are reached —
    // the site shows them and never re-derives a slot state (a reconstructed check is a different check).
    const partOut = partsOut ? { id: p.id, sku: p.sku, name: p.name, series: p.series, category: p.category, kind, role,
      doc_state: docState, legacy_held: legacyHeld, asked_nothing: nothing, states: {} as Record<string, string> } : null;
    if (partOut && partsOut) partsOut.push(partOut);
    for (const a of accs) {
      a.parts++;
      if (nothing) a.askedNothing++;
      if (docState === "held") a.spec++; else if (docState === "spec_linked_not_held") a.specNotHeld++; else if (docState === "eol_only") a.eol++; else a.none++;
      if (legacyHeld) a.legacy++;
      if (!held) { a.notHeldParts++; a.notHeldSlots += required.length; } else a.heldSlots += required.length;
    }
    if (!held) {
      if (d) for (const t of d.types) notHeldByClass.set(t, (notHeldByClass.get(t) ?? 0) + 1);
      else notHeldByClass.set("(no document linked)", (notHeldByClass.get("(no document linked)") ?? 0) + 1);
    }
    const pf = factsByPart.get(p.id);
    // RELATION-BACKED CUPS (ruling 12a): counted per kind as filled / not_held, so the owner sees how many components
    // still owe their host. A not_held one is not in required_fields (out of the denominator), so it appears only here.
    const rc = p.relation_cups ?? {};
    for (const [key, st] of Object.entries(rc)) {
      const rk = `${p.category}|${kind}|${key}`;
      const e = relAcc.get(rk) ?? { filled: 0, not_held: 0 };
      if (st === "filled") e.filled++; else e.not_held++;
      relAcc.set(rk, e);
    }
    // THE GATE, AS RECOMPUTE SEES IT: a gate is answered by a verified or corroborated fact, or by a column
    // (vendor, series/family) or by the derived kind (recompute-completeness.ts builds `values` exactly so).
    const gateAnswered = (g: string): boolean => g === "vendor" || g === "kind" || (g === "series" && Boolean(p.series || p.family))
      || (g === "modular" && p.category === "routers" && modularPlatform(p.sku) !== null)
      || (pf?.get(g) !== undefined && RENDERED.has(pf.get(g)!.state));
    const lk = ledgers[p.category]?.kinds[kind];
    const pendingGate = new Map((lk?.pending_until_gate_answered ?? []).map((c) => [c.key, c.gate ?? []]));
    for (const key of required) {
      const cupKey = `${p.category}|${kind}|${key}`;
      const cup = cupAcc.get(cupKey) ?? newCup();
      cupAcc.set(cupKey, cup);
      cup.asked++;
      if (pendingGate.has(key)) { if (pendingGate.get(key)!.some(gateAnswered)) pendingResolved++; else pendingUnresolved++; }
      const f = pf?.get(key);
      let state: SlotState = "not_parsed";
      let cnr = false, inh = false, notRendered = false, placeholder = false;
      if (rc[key] === "filled") state = "filled";   // answered by a sourced relation, not by a fact (ruling 12a)
      else if (f && f.state === "gap_confirmed") state = "not_published";
      else if (f && !f.vnull && !GAP_STATES.has(f.state)) {
        placeholder = isPlaceholder(f.raw);
        if (FIELD_DICTIONARY[key] && couldNotReplay(key, f)) { cnr = true; state = "filled"; }
        else if (FIELD_DICTIONARY[key] && replayRefusal(p.category, key, f)) state = "would_refuse";
        else state = "filled";
        inh = f.inherited;
        notRendered = !RENDERED.has(f.state);
      }
      if (cnr) { cup.cnr++; for (const a of accs) a.cnr++; }
      if (placeholder) { cup.placeholders++; for (const a of accs) a.placeholders++; }
      if (held) {
        cup.heldAsked++;
        if (state === "filled") {
          cup.filled++; if (inh) cup.inherited++; if (notRendered) cup.notRendered++;
          for (const a of accs) { a.filled++; if (inh) a.inherited++; if (notRendered) a.notRendered++; }
        } else if (state === "not_published") { cup.notPub++; for (const a of accs) a.notPub++; }
        else if (state === "would_refuse") { cup.wr++; for (const a of accs) a.wr++; }
        // MAPPER-GAP (6b): the printed-bar measurement says the held datasheets print this cup and the mapper does not
        // map it — for this part's role when measured per role, else for its kind. Counted INSTEAD of not_parsed.
        else if (cupStateOf(p.category, kind, role, key) === "mapper-gap") { cup.mapperGap++; for (const a of accs) a.mapperGap++; if (partOut) partOut.states[key] = "mapper_gap"; }
        else { cup.notParsed++; for (const a of accs) a.notParsed++; }
        if (partOut && !partOut.states[key]) partOut.states[key] = state + (state === "filled" && inh ? ":inherited" : "");
      } else {
        if (partOut) partOut.states[key] = state === "filled" ? "not_held:value_stored" : state === "would_refuse" ? "not_held:would_refuse" : "not_held";
        cup.notHeld++;
        if (state === "filled") { cup.notHeldFilled++; for (const a of accs) a.notHeldFilled++; }
        if (state === "would_refuse") { cup.notHeldWr++; for (const a of accs) a.wrNotHeld++; }
      }
    }
  }

  // ---- assemble ----------------------------------------------------------------------------------------------------
  const isUnresolved = (k: string) => FALLBACK_KINDS.has(k) || k === "(none)";
  const fillPath = (c: LedgerCup | undefined): CupRow["fill_path"] =>
    !c ? "none" : c.derived_by ? "derived" : c.seed_only ? "seed-only" : c.observed_fill_path ? "seen" : "none";
  const categories: CategoryBlock[] = [];
  const askedNothingNamed: string[] = [];
  for (const [category, ca] of catAcc) {
    const led = ledgers[category];
    const kinds: KindBlock[] = [];
    for (const [ck, ka] of kindAcc) {
      const [cat, kind] = ck.split("|");
      if (cat !== category) continue;
      const lk = led?.kinds[kind];
      // LAYER 3 (25 Sep 2026): a kind with a role axis states its cups PER ROLE, and its own lists are only the core —
      // what a part of unresolved role is asked. Read the label and the evidence across every block, or a cup only
      // `branch` routers are asked reads as `other` (an optional cup in a denominator) and carries no gate, no source
      // and no fill path. `cupRequirement` and the cross-check share one band, so the label cannot contradict the count.
      const blocks: LedgerBlock[] = lk ? [lk, ...Object.values(lk.roles ?? {})] : [];
      const keys = new Set<string>(lk ? ledgerCupKeys(lk) : []);
      for (const k of cupAcc.keys()) { const [c2, k2, key] = k.split("|"); if (c2 === category && k2 === kind) keys.add(key); }
      const cups: CupRow[] = [...keys].map((key) => {
        const a = cupAcc.get(`${category}|${kind}|${key}`) ?? newCup();
        let lc: LedgerCup | undefined;
        for (const b of blocks) { lc = b.required.find((c) => c.key === key) ?? b.pending_until_gate_answered.find((c) => c.key === key); if (lc) break; }
        const requirement: CupRow["requirement"] = lk ? cupRequirement(lk, key) : "other";
        return {
          key, requirement, gate: lc?.gate ?? [],
          asked: a.asked, held_asked: a.heldAsked,
          filled: a.filled, not_published: a.notPub, not_parsed: a.notParsed, mapper_gap: a.mapperGap, would_refuse: a.wr,
          not_held: a.notHeld, not_held_filled: a.notHeldFilled, not_held_would_refuse: a.notHeldWr,
          could_not_replay: a.cnr, inherited: a.inherited, filled_not_rendered: a.notRendered, placeholders_stored: a.placeholders,
          filled_pct: pctOf(a.filled + a.notPub, a.heldAsked),
          fill_path: fillPath(lc), observed_filled: lc?.observed_filled ?? false, label_occurrences: lc?.label_occurrences ?? 0,
          sources_enabled: (lc?.sources ?? []).filter((s) => s.enabled).map((s) => `${s.source}=${s.basis}`),
          taps: (lc?.sources ?? []).filter((s) => s.enabled && s.facts_current > 0 && s.basis === "seen").map((s) => s.source)
            .concat(lc?.derived_by ? [`derived: ${lc.derived_by}`] : []),
        };
      }).sort((x, y) => y.not_parsed - x.not_parsed || y.asked - x.asked || x.key.localeCompare(y.key));
      const nothing = askedNothing(category, kind);
      if (nothing && !isUnresolved(kind)) askedNothingNamed.push(`${category}.${kind} (${ka.parts})`);
      const axis = roleAxisOf(category, kind);
      const roles: Record<string, RoleBlock> | undefined = axis ? Object.fromEntries([...ROLE_DOMAINS[axis], UNRESOLVED_ROLE].map((role) => {
        const ra = roleAcc.get(`${category}|${kind}|${role}`) ?? newAcc();
        if (role !== UNRESOLVED_ROLE) return [role, { deploy_role: role, parts: ra.parts, ...block(ra) }];
        // (unresolved), operator ruling 13 Sep 2026: kind-issue rows printed and split by plan state; the III.4 bar over
        // what the role rules are responsible for; "(unresolved) N — K pending move/class".
        const ki = roleIssue.get(`${category}|${kind}|${role}`) ?? emptyBreakdown();
        return [role, { deploy_role: role, parts: ra.parts, kind_issue_parts: ki.kind_issue_parts,
          kind_issue: { pending_plan: ki.pending_plan, plan_ran: ki.plan_ran, unplanned: ki.unplanned },
          null_share_excluding_kind_issue: nullShareExcludingKindIssue(ka.parts, ra.parts, ki.kind_issue_parts),
          display: unresolvedDisplay(ra.parts, ki), ...block(ra) }];
      })) : undefined;
      const relationBacked: Record<string, { filled: number; not_held: number }> = {};
      for (const [rk, e] of relAcc) { const [c3, k3, key] = rk.split("|"); if (c3 === category && k3 === kind) relationBacked[key] = e; }
      kinds.push({ kind, parts: ka.parts, resolved: !isUnresolved(kind), asked_nothing: nothing, ...block(ka), cups,
        role_axis: axis, ...(roles ? { roles } : {}),
        ...(Object.keys(relationBacked).length ? { relation_backed: relationBacked } : {}) });
    }
    kinds.sort((x, y) => y.parts - x.parts || x.kind.localeCompare(y.kind));
    categories.push({
      category, profile_hash: led?.profile_hash ?? null, ledger_built_on_commit: led?.built_on_commit ?? null,
      unresolved_kind_parts: kinds.filter((k) => !k.resolved).reduce((s, k) => s + k.parts, 0),
      ...block(ca), kinds,
    });
  }
  const catSortKey = (c: CategoryBlock) => (c.filled.pct === null ? Number.POSITIVE_INFINITY : c.filled.pct);
  categories.sort((x, y) => catSortKey(x) - catSortKey(y) || y.hardware_parts - x.hardware_parts || x.category.localeCompare(y.category));
  const ledList = Object.values(ledgers);
  const brand = {
    ...block(brandAcc),
    weakest_category: categories.find((c) => c.filled.pct !== null)?.category ?? null,
    unresolved_kind: {
      parts: categories.reduce((s, c) => s + c.unresolved_kind_parts, 0),
      kinds: categories.flatMap((c) => c.kinds.filter((k) => !k.resolved).map((k) => `${c.category}.${k.kind}`)),
      device_noun_union: ledList.reduce((s, l) => s + (l.totals.fallback.either?.device_noun ?? 0), 0),
      device_noun_unresolved: ledList.reduce((s, l) => s + (l.totals.fallback.unresolved_kind?.device_noun ?? 0), 0),
    },
  };

  // RULING Q9 (3), 29 Sep 2026: unknown-kind hardware with NO evidence -- a SKU-only name and no linked document -- is
  // acquisition work (a document is needed before anyone can classify it), so it is ON the queue, by the same definition
  // unknown_zero judges with (src/core/unknownEvidence.ts). The evidenced unknowns are counted beside it, never folded in.
  const unknownSplit = splitUnknown(await q<UnknownRow>("acquisition: unknown hardware by evidence", UNKNOWN_HARDWARE_SQL, [vendor]));
  // ---- acquisition queue (outside every denominator) ----------------------------------------------------------------
  const acquisition_queue = {
    _about: "The NOT-HELD parts: no doc_parts row passes the held rule (spec_for_kind AND explicit|family), so they are "
      + "acquisition or linking work and in no filled denominator. `spec_linked_not_held` = a spec-bearing document IS linked "
      + "but only as a mention or by inference (held before the relevance ruling: `held_by_doc_type_legacy`). "
      + "`by_document_class_missing` says what a not-held part holds instead (a part holding two such classes counts under "
      + "both); `(no document linked)` is the no_document state.",
    spec_bearing_classes: LEDGER_SPEC_BEARING,
    by_category: categories.map((c) => ({ category: c.category, not_held_parts: c.filled.not_held_parts, spec_linked_not_held: c.held.spec_linked_not_held,
      eol_only: c.held.eol_only, no_document: c.held.no_document, not_held_slots: c.filled.not_held_slots, not_held_filled: c.filled.not_held_filled,
      held: pctOf(c.held.spec_bearing, c.hardware_parts), held_by_doc_type_legacy: c.held.held_by_doc_type_legacy }))
      .sort((x, y) => y.not_held_parts - x.not_held_parts),
    by_document_class_missing: [...notHeldByClass].map(([holds_instead, parts]) => ({ holds_instead, parts })).sort((x, y) => y.parts - x.parts),
    unclassifiable_no_evidence: {
      _about: "Live hardware in kind unknown whose name says nothing beyond its SKU and which no document links: a document is "
        + "needed before anyone can classify it (ruling Q9 (3)). Its count is a ratchet that may not grow "
        + "(data/ratchets/unknown-no-evidence-cisco.json); the EVIDENCED unknowns are unknown_zero's red, counted beside it.",
      parts: unknownSplit.noEvidence.length, evidenced_unknown_parts: unknownSplit.evidenced.length,
      by_category: [...unknownSplit.noEvidence.reduce((m, r) => m.set(r.category, (m.get(r.category) ?? 0) + 1), new Map<string, number>())]
        .map(([category, parts]) => ({ category, parts })).sort((x, y) => y.parts - x.parts),
      skus: unknownSplit.noEvidence.map((r) => r.sku),
    },
  };

  // ---- residue (§6), measured where the store can measure it --------------------------------------------------------
  const residueKeys = ["rx_max_input_power", "input_power_range", "tx_wavelength", "tx_max_output_power", "psu_output_power",
    "psu_output_rating", "safety_standards", "height", "width", "depth", "filter_passband",
    ...Object.keys(FIELD_DICTIONARY).filter((k) => k.includes("queues_per_port") || k.includes("holdup") || k.includes("insertion_loss"))];
  const byVendorKey = await q<{ vendor: string; field_key: string; n: number }>("residue: facts by vendor and key", `
    SELECT v.slug AS vendor, f.field_key, count(*)::int AS n
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL AND f.value IS NOT NULL
       AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL
     GROUP BY 1, 2 ORDER BY 2, 1`, [[...new Set(residueKeys)]]);
  const vk = (key: string) => Object.fromEntries(byVendorKey.filter((r) => r.field_key === key).map((r) => [r.vendor, r.n]));
  const skuRows = await q<{ sku: string; name: string | null; category: string; product_class: string }>("residue: named SKUs", `
    SELECT p.sku, p.name, ct.slug AS category, p.product_class::text
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL
       AND (p.sku_norm LIKE 'ASR5K-%' OR p.sku_norm = 'UCS-SP-SD-1P6T-2'
            OR p.sku LIKE '%CUxM' OR p.sku LIKE '%AOCxM' OR p.sku LIKE '%ACxM')`, [vendor]);
  const pdfSource = (await q<{ enabled: boolean }>("residue: pdf source", "SELECT enabled FROM sources WHERE slug = $1", [`${vendor}-datasheet-pdf`]))[0];
  const asr = skuRows.filter((r) => r.sku.toUpperCase().startsWith("ASR5K-") && r.product_class === "hardware" && r.category === "wireless");
  const asrKinds = asr.reduce<Record<string, number>>((m, r) => { const k = partKind("wireless", r.sku, r.name ?? undefined) ?? "(none)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const lengthGeneric = skuRows.filter((r) => /(CU|AOC|AC)xM$/.test(r.sku));
  const currentWithValue = factRows.filter((f) => !f.vnull);
  const seedFacts = currentWithValue.filter((f) => f.method === "hexcat_seed").length;
  const inheritedAll = currentWithValue.filter((f) => f.inherited).length;
  const wirelessSpatial = censuses.wireless?.cups.find((c) => c.key === "spatial_streams")?.would_refuse.n ?? null;
  const censusRefuseTotal = Object.values(censuses).reduce((s, c) => s + c.would_refuse_total, 0);
  const catParts = (c: string) => catAcc.get(c)?.parts ?? 0;
  // LINKING DEFECTS (6b): per document, the links the held rule does not count — rows made by inference, and rows on a
  // spec-bearing document that is only a mention for the part's kind. Live hardware parts of this vendor only.
  const defectRows = await q<{ doc_id: string; url: string; title: string | null; doc_type: string; inferred_rows: number; spec_mention_rows: number; parts: number }>("residue: linking defects per document", `
    SELECT sd.doc_id, sd.url, sd.title, sd.doc_type,
           count(*) FILTER (WHERE dp.link_basis = 'inferred')::int AS inferred_rows,
           count(*) FILTER (WHERE sd.doc_type = ANY($2::text[]) AND dp.doc_relevance = 'mention')::int AS spec_mention_rows,
           count(DISTINCT dp.part_id)::int AS parts
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND (dp.link_basis = 'inferred' OR (sd.doc_type = ANY($2::text[]) AND dp.doc_relevance = 'mention'))
     GROUP BY sd.doc_id, sd.url, sd.title, sd.doc_type`, [vendor, LEDGER_SPEC_BEARING]);
  const defectParts = (await q<{ n: number }>("residue: parts with a linking defect", `
    SELECT count(DISTINCT dp.part_id)::int AS n
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND (dp.link_basis = 'inferred' OR (sd.doc_type = ANY($2::text[]) AND dp.doc_relevance = 'mention'))`, [vendor, LEDGER_SPEC_BEARING]))[0].n;
  const linkingTotals = {
    inferred_rows: defectRows.reduce((s, r) => s + r.inferred_rows, 0),
    spec_mention_rows: defectRows.reduce((s, r) => s + r.spec_mention_rows, 0),
    documents: defectRows.length,
    parts: defectParts,
  };
  const linking_defects = {
    item: "linking defects (doc_parts rows the held rule does not count)",
    count: linkingTotals.inferred_rows + linkingTotals.spec_mention_rows,
    count_basis: "doc_parts rows on live hardware parts of this vendor with link_basis = 'inferred', plus rows on a spec-bearing document with doc_relevance = 'mention' (a row that is both counts once in each column, so `count` can exceed the distinct rows)",
    brand_totals: linkingTotals,
    by_document: defectRows.map((r) => ({ doc_id: r.doc_id, url: r.url, title: r.title, doc_type: r.doc_type,
      inferred_rows: r.inferred_rows, spec_mention_rows: r.spec_mention_rows, parts: r.parts }))
      .sort((x, y) => (y.inferred_rows + y.spec_mention_rows) - (x.inferred_rows + x.spec_mention_rows) || x.url.localeCompare(y.url)),
    why_parked: "the documents stay linked (the relation is true); they stop counting as held — a defect of the link, not of the part",
    trigger: "re-derive after an extractor emits per-SKU records for the document, or retire an inferred link with a recorded run",
  };
  const residue = [
    linking_defects,
    { item: "would-refuse dispositions (MOVE / RETRACT / KEEP-REFUSING / RESHAPE)", count: censusRefuseTotal,
      count_basis: "Σ census would_refuse_total over the committed censuses (every live part and key, not only required cups); the guide quotes 352, the committed censuses sum to this. The per-group split lives in the round-8 dispositions, not in the store.",
      why_parked: "cleanup; visible as `defects`; none changes which cups exist", trigger: "day one of filling, on the pilot first; group by group as approved in round 8" },
    { item: "held class changes (six old reclassify rules)", count: null,
      count_reason: "the 582 candidate rows are a plan outside the store and outside any committed artifact this script reads; not measurable here",
      why_parked: "class axis; moving them changes denominators by about 1%", trigger: "a per-rule plan with three witnesses, approved rule by rule" },
    { item: "ASR5K population in wireless", count: asr.length, by_kind: asrKinds,
      count_basis: "live hardware SKUs starting ASR5K- in wireless, kind from partKind", why_parked: "category axis", trigger: "^ASR5K- kind rule + a move plan under the 651 guards" },
    { item: "cross-vendor merges: rx_max_input_power / tx_wavelength / tx_max_output_power", count: null,
      count_reason: "a count per vendor, not one number", facts_current_by_vendor: { rx_max_input_power: vk("rx_max_input_power"), input_power_range: vk("input_power_range"), tx_wavelength: vk("tx_wavelength"), tx_max_output_power: vk("tx_max_output_power") },
      why_parked: "one dictionary, many lanes", trigger: "the Juniper lane takes the decision; Cisco moves its facts in the same run" },
    { item: "term-6 duplicates holding facts", count: ["psu_output_power", "psu_output_rating", "safety_standards", "height", "width", "depth",
        ...residueKeys.filter((k) => k.includes("queues_per_port") || k.includes("holdup") || k.includes("insertion_loss"))]
        .reduce((s, k) => s + Object.values(vk(k)).reduce((a, b) => a + b, 0), 0),
      count_basis: "current facts, all vendors, under the named keys (insertion_loss* includes the surviving key as well as its duplicate)",
      facts_current_by_vendor: Object.fromEntries(["psu_output_power", "psu_output_rating", "safety_standards", "height", "width", "depth",
        ...residueKeys.filter((k) => k.includes("queues_per_port") || k.includes("holdup") || k.includes("insertion_loss"))].map((k) => [k, vk(k)])),
      why_parked: "none is a required cup", trigger: "a move-then-supersede plan per pair, measured across all vendors" },
    { item: "unresolved kinds", count: brand.unresolved_kind.parts, count_basis: "live hardware parts whose partKind is a fallback kind",
      why_parked: "a classifier property; printed separately", trigger: "after the device-noun rows are at zero: servers.unknown and video.unknown by family" },
    { item: "tri-radio APs (spatial_streams cannot express three radios)", count: wirelessSpatial,
      count_basis: "census wireless spatial_streams would_refuse.n (refused values); the tri-radio POPULATION is not measured", why_parked: "term 2 reshape", trigger: "count the tri-radio population first" },
    { item: "UCS-SP-SD-1P6T-2 pack quantity", count: skuRows.filter((r) => r.sku.toUpperCase() === "UCS-SP-SD-1P6T-2").length,
      count_basis: "live rows with that SKU", why_parked: "the name is cut off", trigger: "a description arrives" },
    { item: "length-generic SKUs (…CUxM, …AOCxM, …ACxM)", count: lengthGeneric.filter((r) => r.product_class === "hardware").length,
      skus: lengthGeneric.map((r) => `${r.sku} (${r.product_class})`),
      count_basis: "live SKUs ending CUxM / AOCxM / ACxM with a literal lower-case x that are STILL hardware (the non_product ones are listed, already moved, and not counted); the guide quotes 4",
      why_parked: "class rule length-placeholder -> non_product", trigger: "with the class-change plan" },
    { item: "conferencing and data-center-networking as categories", count: catParts("conferencing") + catParts("data-center-networking"),
      count_basis: "live hardware parts in the two categories", why_parked: "buckets, harmless to the numbers", trigger: "operator decision" },
    { item: `${vendor}-datasheet-pdf disabled; hexcat seed; inherited share of stock`, count: null,
      count_reason: "four numbers, not one",
      pdf_source_enabled: pdfSource?.enabled ?? null, held_parts_with_a_pdf_link: pdfLinkedHeld, hexcat_seed_facts_current: seedFacts,
      inherited_share_of_stock: pctOf(inheritedAll, currentWithValue.length),
      why_parked: "not arrangement; but a PDF-linked held part cannot fill from the PDF until the tap opens", trigger: "phase 2 day one: decide the PDF tap on the pilot" },
    { item: "filter_passband (s, nm) pending moves", count: null, count_reason: "the 15 pending moves are a plan, not a store state",
      facts_current_by_vendor: vk("filter_passband"), why_parked: "free string on an optional cup", trigger: "close with the §5.4 batch if cheap" },
  ];

  // ---- where the code and the guide disagree (measured; nothing here is resolved) ------------------------------------
  const census = Object.values(censuses);
  const model_disagreements = [
    { topic: "required_total includes still-pending slots",
      guide: "§2.2: required + pending-resolved-to-required per live part is completeness.required_total",
      code: "recompute-completeness requiredFieldsFor / completenessV2 count `pending` (gate unanswered) AS required, so required_total = required + pending-resolved-to-required + pending-still-unanswered",
      measured: { pending_slots_gate_unanswered: pendingUnresolved, pending_slots_gate_answered: pendingResolved,
        basis: "slots of a cup the kind's ledger lists as pending; answered = a verified/corroborated fact under a gate key, or a column (vendor, series/family) or the derived kind, which is how recompute builds `values`" } },
    { topic: "spec-bearing document classes",
      guide: "§2.3: spec-bearing is /v1/docs/classes.spec_bearing (docClass.SPEC_BEARING)",
      code: "docClass.SPEC_BEARING = " + JSON.stringify([...SPEC_BEARING]) + "; both builders use heldEvidence.SPEC_BEARING_DOC_TYPES " + JSON.stringify(LEDGER_SPEC_BEARING) + " (adds vendor_page). Since the held-by-relevance ruling (13 Sep 2026) the list decides only the LEGACY held and which rows must be derived; held itself is doc_relevance = spec_for_kind AND link_basis IN (explicit, family).",
      measured: { parts_held_only_under_ledger_list: heldUnderLedgerOnly, parts_held_only_under_docclass_list: heldUnderDocClassOnly } },
    { topic: "what counts as filled",
      guide: "§2.3: a current fact (superseded_by IS NULL, not retracted) that the normaliser accepts",
      code: "recompute-completeness counts only verified/corroborated facts as present (required_present); the ledger's gap_states.filled has no normaliser clause; this report counts any current non-gap state with a value and excludes would_refuse, per the build brief",
      measured: { report_filled_held: brand.filled.filled, of_which_conflict_or_unverified: brand.filled.filled_not_rendered,
        report_would_refuse_held: brand.filled.would_refuse, completeness_required_present_held: live.required_present_held } },
    { topic: "not-parsed",
      guide: "§2.3: a spec-bearing document is linked and no fact is stored",
      code: "ledger gap_states.not-parsed also requires that the document 'carries a label that maps to the key' — the label inventory is not per part, so neither the ledger nor this report can test that clause; the report uses the guide's wording",
      measured: null },
    { topic: "not-published",
      guide: "§2.3: a gap_confirmed fact — every capable, ENABLED source was checked",
      code: "the schema comment says 'tier-1 and tier-2 were checked'; gap_ledger compares against enabled capable sources",
      measured: { gap_confirmed_facts_on_required_held_slots: brand.filled.not_published } },
    { topic: "asked-nothing is all fallback",
      guide: "§2.4 / Appendix B: asked-nothing is today only unresolved kinds",
      code: "a profile property (slotsAtNothingKnown == 0), independent of the kind name",
      measured: { resolved_kinds_asked_nothing: askedNothingNamed } },
    { topic: "product classes",
      guide: "§2.1: product_class ∈ {hardware, software, non_product, unknown}",
      code: "the enum also carries license, service, accessory, bundle (migration 0001) and non_product (0014)",
      measured: Object.fromEntries(classRows.map((r) => [r.product_class, r.n])) },
    { topic: "defect scope",
      guide: "§3.2 brand.defects.would_refuse 352 (census)",
      code: "the census replays EVERY live part (any class) and EVERY key in a category; the report's defects are required cups of hardware parts only",
      measured: { census_would_refuse_total: censusRefuseTotal, census_could_not_replay_total: census.reduce((s, c) => s + c.could_not_replay_total, 0),
        report_would_refuse_required_held: brand.defects.would_refuse, report_would_refuse_required_not_held: brand.defects.would_refuse_not_held,
        report_could_not_replay_required: brand.defects.could_not_replay } },
    { topic: "inherited share",
      guide: "§2.3: 43% of the stock is inherited",
      code: "the report's inherited_share is over FILLED REQUIRED slots of held parts in scope; the stock share is in residue",
      measured: { report: brand.inherited_share, stock: pctOf(inheritedAll, currentWithValue.length) } },
  ];

  // ---- cross-checks ------------------------------------------------------------------------------------------------
  // GIT_SHA FIRST, as build-value-census and build-mapper-trace already do: the box builds from a git archive with no .git,
  // where rev-parse fails, so every box-built report said built_on_commit "unknown" (62ecef1, 7944270, c2d05f7).
  let commit = process.env.GIT_SHA?.slice(0, 7) ?? "unknown", dirty = 0;
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().split("\n").filter((l) => l.trim()).length;
  } catch { /* not a checkout */ }
  const report: CompletenessReport = {
    _about: "GENERATED by scripts/build-completeness.mts — do not edit by hand. Definitions: docs/completeness-model.md. "
      + "Scope is LIVE (retired_at IS NULL) HARDWARE parts; kind = partKind(category, sku, name). A part is HELD when a "
      + `spec-bearing document (${LEDGER_SPEC_BEARING.join(", ")}) is linked to it. For a held part each required slot `
      + "(completeness.required_fields — required plus pending) is exactly one of: filled (a current, non-retracted fact "
      + "with a value that the census replay does not refuse), not_published (a gap_confirmed fact), not_parsed (no such "
      + "fact and the cup is not a measured mapper gap), mapper_gap (no such fact, and data/reference/cup-evidence-<vendor>.json "
      + "says the held datasheets print the cup and the mapper does not map it), or would_refuse (a defect: stored but refused "
      + "by today's normaliser — neither filled nor empty). "
      + "Arranged = parts asked >= 1 cup / parts; Held = parts with a doc_parts row whose doc_relevance = spec_for_kind AND "
      + "link_basis IN (explicit, family) / parts (operator ruling, 13 Sep 2026; held_by_doc_type_legacy beside it is the old "
      + "any-spec-bearing-doc-type rule); Filled = (filled + "
      + "not_published) / required slots of HELD parts. Not-held parts, optional cups and non-hardware classes are in no "
      + "denominator; not-held counts, would-refuse counts and the inherited share are printed beside every filled %. "
      + `"100% complete" = Filled over held parts. Built on ${commit}${dirty ? ` with ${dirty} uncommitted path(s)` : ""}.`,
    definitions: "docs/completeness-model.md",
    vendor,
    built_on_commit: commit,
    generated_at: new Date().toISOString(),
    inputs: {
      ledgers_built_on: [...new Set(ledList.map((l) => l.built_on_commit))],
      censuses_built_on: [...new Set(census.map((c) => c.built_on_commit))],
      census_norm_versions: [...new Set(census.map((c) => c.norm_version))],
      norm_version_now: NORM_VERSION,
      spec_bearing_doc_types: LEDGER_SPEC_BEARING,
      // kind layer 6b
      held_rule: `a part is held when >= 1 doc_parts row satisfies ${heldRowSql("dp")}; held_by_doc_type_legacy = any linked document of a spec-bearing doc type`,
      held_underived_spec_rows: underived,
      cup_evidence: { file: cupEvidence.file, sha256: cupEvidence.sha256, entries: cupEvidence.entries.length,
        mapper_gap_entries: cupEvidence.entries.filter((e) => e.state === "mapper-gap").length },
      kind_layer_plans: { file: plans.file, sha256: plans.sha256, plans: plans.plans.length,
        run: plans.plans.filter((p) => p.run_id !== null).length, pending: plans.plans.filter((p) => p.run_id === null).length },
      // Read from the committed freeze file, never computed here: the report states WHICH frozen table its numbers are
      // over, and tests/completeness.test.ts fails when the two files name different hashes. A missing file is said.
      ...readFreezeHash(vendor),
      worktree_dirty_paths: dirty,
      live_at_build: { hardware_parts: live.hardware_parts, refused_by_role_table: live.refused_by_role_table,
        live_parts: live.live_parts, partition, parts_nothing_required: live.parts_nothing_required, required_total_held: live.required_total_held },
      census_replay_parity: parityRows,
      pending_reclassification: Object.fromEntries(pendingReclass),
      defects_basis: "would_refuse and could_not_replay are computed PER PART by the census replay copied verbatim (not taken from the census's per-category totals, which carry no part), after `census_replay_parity` proved the copy reproduces every committed census total",
    },
    brand,
    categories,
    acquisition_queue,
    residue,
    model_disagreements,
    cross_checks: [],
  };
  const ctx: CheckContext = { ledgers, live: { hardware_parts: live.hardware_parts, refused_by_role_table: live.refused_by_role_table,
    live_parts: live.live_parts, partition, parts_nothing_required: live.parts_nothing_required, required_total_held: live.required_total_held } };
  const checks: CrossCheck[] = [
    ...checkReport(report, ctx),
    { name: "census_replay_parity", passed: parity.length === 0, detail: parity.length ? parity.join("; ") : `ok over ${parityRows.length} censuses` },
    { name: "completeness_row_per_part", passed: noCompleteness.length === 0,
      detail: noCompleteness.length ? `${noCompleteness.length} live hardware part(s) without a completeness row, e.g. ${noCompleteness.slice(0, 5).join(", ")}` : "ok" },
    // kind layer 6b, build only (they need per-part rows the file does not carry): the SKUs behind kind_issue_plans_ran,
    // and mapper-gap entries that would move nothing.
    (() => {
      const ran = plansRanButStillInKind(kindIssueRows);
      return { name: "kind_issue_rows_after_plan_ran", passed: ran.length === 0,
        detail: ran.length ? `${ran.length} row(s): ${ran.slice(0, 8).join("; ")}` : `ok over ${kindIssueRows.length} kind-issue rows (${kindIssueRows.filter((r) => r.status === "pending_plan").length} pending plan, ${kindIssueRows.filter((r) => r.status === "unplanned").length} unplanned; plans with run_id: ${plans.plans.filter((p) => p.run_id !== null).length})` };
    })(),
    { name: "cup_evidence_applies", passed: inertEvidence.length === 0,
      detail: inertEvidence.length ? `${inertEvidence.length} mapper-gap entr(ies) match nothing: ${inertEvidence.slice(0, 8).join("; ")}` : `ok over ${cupEvidence.entries.filter((e) => e.state === "mapper-gap").length} mapper-gap entries` },
  ];
  report.cross_checks = checks;

  let sinceOut: Record<string, unknown> | null = null;
  if (since) sinceOut = await sinceWindow(q, vendor, since, kindOf, partRows, commit);
  await client.end();

  // ---- write ---------------------------------------------------------------------------------------------------------
  const outDir = path.join(ROOT, "data", "completeness");
  fs.mkdirSync(outDir, { recursive: true });
  if (sinceOut) {
    const sf = path.join(outDir, `${vendor}.since.json`);
    fs.writeFileSync(sf, JSON.stringify(sinceOut, null, 1) + "\n");
    console.log(`wrote ${path.relative(ROOT, sf)}`);
  }
  if (partsOut && partsOutFile) {
    // written BEFORE the report's own refusal can stop the build: the rows behind a refused draft are what a reviewer reads
    fs.writeFileSync(partsOutFile, partsOut.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`  parts-out: ${partsOut.length} part verdicts -> ${partsOutFile}`);
  }
  const failed = checks.filter((c) => !c.passed);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\ncross-checks:");
  for (const c of checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name.padEnd(32)} ${c.detail.slice(0, 400)}`);
  const b = report.brand;
  console.log(`\n${vendor}: ${b.hardware_parts} hardware parts | arranged ${b.arranged.num}/${b.arranged.den} = ${b.arranged.pct}% | held ${b.held.num}/${b.held.den} = ${b.held.pct}% `
    + `| filled ${b.filled.num}/${b.filled.den} = ${b.filled.pct}% (not-held ${b.filled.not_held_parts} parts, ${b.filled.not_held_slots} slots) `
    + `| would_refuse ${b.defects.would_refuse} | inherited ${b.inherited_share.num}/${b.inherited_share.den} = ${b.inherited_share.pct}% | weakest ${b.weakest_category}`);
  if (failed.length) {
    const draft = path.join(os.tmpdir(), `completeness-${vendor}-FAILED.json`);
    fs.writeFileSync(draft, JSON.stringify(report, null, 1) + "\n");
    console.error(`\nBUILD REFUSED: ${failed.length} cross-check(s) failed: ${failed.map((c) => c.name).join(", ")}. Draft (not the report): ${draft}  [${secs}s]`);
    process.exit(1);
  }
  const out = path.join(outDir, `${vendor}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, out)} — all ${checks.length} cross-checks passed  [${secs}s]`);
}

/**
 * THE THREE DAY-ONE NUMBERS over a window (§3.5). Each says what the store could and could not supply, because the
 * store records arrivals in full, records held-ness only through document timestamps, and records refusals before
 * storage only as per-run totals.
 */
async function sinceWindow(
  q: <T extends pg.QueryResultRow>(label: string, sql: string, params?: unknown[]) => Promise<T[]>,
  vendor: string, since: string,
  kindOf: Map<string, { category: string; kind: string; held: boolean }>,
  partRows: { id: string; required_fields: string[] | null }[], commit: string,
): Promise<Record<string, unknown>> {
  const sinceIso = new Date(Date.parse(since)).toISOString();
  console.log(`since window: ${sinceIso} ..now`);
  const requiredOf = new Map(partRows.map((p) => [p.id, new Set(p.required_fields ?? [])]));

  // 1. ARRIVALS into required cups, by source, own vs inherited.
  const arrivals = await q<FactRow>("since: arrivals", `
    SELECT f.part_id::text, ct.slug AS category, p.product_class::text AS product_class, f.field_key, f.raw, f.unit,
           f.method, f.state::text AS state, (f.value IS NULL) AS vnull, (f.inherited_from IS NOT NULL) AS inherited,
           f.created_at::text, f.doc_id
      FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND f.created_at >= $2::timestamptz AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`, [vendor, sinceIso]);
  const slugs = (await q<{ slug: string }>("since: sources", "SELECT slug FROM sources")).map((r) => r.slug);
  const docIds = [...new Set(arrivals.map((a) => a.doc_id).filter((d): d is string => Boolean(d)))];
  const docSrc = new Map<string, Set<string>>();
  if (docIds.length) {
    for (const r of await q<{ slug: string; doc_id: string }>("since: document sources", `
      SELECT DISTINCT s.slug, x.doc_id
        FROM (SELECT source_id, doc_id FROM fetches WHERE doc_id = ANY($1::text[])
              UNION SELECT source_id, doc_id FROM part_source_checks WHERE doc_id = ANY($1::text[])) x
        JOIN sources s ON s.id = x.source_id`, [docIds])) {
      const s = docSrc.get(r.doc_id) ?? new Set<string>(); s.add(r.slug); docSrc.set(r.doc_id, s);
    }
  }
  // The attribution rule of /v1/sources (src/api/queries/sources.ts): the method names the slug as a segment, or the
  // document was fetched/checked by the source. No source is inferred from a URL host or a doc_type.
  const sourcesOf = (f: FactRow): string[] => {
    const seg = `:${f.method.replace(/_/g, ":")}:`;
    const s = new Set(slugs.filter((slug) => seg.includes(`:${slug}:`)));
    for (const x of (f.doc_id ? docSrc.get(f.doc_id) : undefined) ?? []) s.add(x);
    return s.size ? [...s].sort() : [`(unattributed: method ${f.method})`];
  };
  const bySource = new Map<string, { facts: number; required: number; required_held_own: number; required_held_inherited: number; required_not_held: number }>();
  let reqTotal = 0, reqHeld = 0, reqHeldInherited = 0;
  const intoRequired: FactRow[] = [];
  for (const f of arrivals) {
    const isReq = requiredOf.get(f.part_id)?.has(f.field_key) ?? false;
    const held = kindOf.get(f.part_id)?.held ?? false;
    if (isReq && !f.vnull) { intoRequired.push(f); reqTotal++; if (held) { reqHeld++; if (f.inherited) reqHeldInherited++; } }
    for (const s of sourcesOf(f)) {
      const e = bySource.get(s) ?? { facts: 0, required: 0, required_held_own: 0, required_held_inherited: 0, required_not_held: 0 };
      e.facts++;
      if (isReq && !f.vnull) { e.required++; if (!held) e.required_not_held++; else if (f.inherited) e.required_held_inherited++; else e.required_held_own++; }
      bySource.set(s, e);
    }
  }

  // 2. REFUSAL AT ARRIVAL. (a) stored arrivals replayed; (b) refusals before storage as far as anything records them.
  const byCup = new Map<string, { arrived: number; would_refuse: number; could_not_replay: number; reasons: Record<string, number> }>();
  for (const f of intoRequired) {
    const cat = kindOf.get(f.part_id)?.category ?? f.category;
    const e = byCup.get(f.field_key) ?? { arrived: 0, would_refuse: 0, could_not_replay: 0, reasons: {} };
    e.arrived++;
    if (FIELD_DICTIONARY[f.field_key]) {
      if (couldNotReplay(f.field_key, f)) e.could_not_replay++;
      else { const r = replayRefusal(cat, f.field_key, f); if (r) { e.would_refuse++; e.reasons[r.reason] = (e.reasons[r.reason] ?? 0) + 1; } }
    }
    byCup.set(f.field_key, e);
  }
  const cnrTotal = [...byCup.values()].reduce((s, e) => s + e.could_not_replay, 0);
  const runRows = await q<{ id: string; kind: string; status: string; started_at: string; facts_rejected: string | null; rejected: string | null; facts_sentinel: string | null; vendor: string | null }>("since: runs with refusal counters", `
    SELECT id::text, kind, status::text, started_at::text, stats->>'facts_rejected' AS facts_rejected, stats->>'rejected' AS rejected,
           stats->>'facts_sentinel' AS facts_sentinel, inputs->>'vendor' AS vendor
      FROM runs WHERE started_at >= $1::timestamptz AND (stats ? 'facts_rejected' OR stats ? 'rejected') ORDER BY id`, [sinceIso]);
  const qDir = path.join(ROOT, "runs", "reports");
  const qFiles: string[] = [];
  const qByCup = new Map<string, number>();
  const sinceDay = sinceIso.slice(0, 10);
  if (fs.existsSync(qDir)) {
    for (const f of fs.readdirSync(qDir)) {
      const m = /^quarantine-.*-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (!m || m[1] < sinceDay) continue;
      qFiles.push(f);
      for (const line of fs.readFileSync(path.join(qDir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { const j = JSON.parse(line) as { key?: string; reason?: string }; const k = `${j.key ?? "?"}|${j.reason ?? "?"}`; qByCup.set(k, (qByCup.get(k) ?? 0) + 1); } catch { qByCup.set("(unparseable line)|-", (qByCup.get("(unparseable line)|-") ?? 0) + 1); }
      }
    }
  }

  // 3. HELD DELTA — parts whose earliest linked spec-bearing document was created in the window.
  const heldRows = await q<{ part_id: string; category: string; types_in_window: string[] }>("since: held delta", `
    SELECT dp.part_id::text, ct.slug AS category,
           array_agg(DISTINCT sd.doc_type) FILTER (WHERE sd.created_at >= $2::timestamptz) AS types_in_window
      FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id AND sd.doc_type = ANY($3::text[])
      JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND ${heldRowSql("dp")}   -- 6b: only rows that make a part held count toward the held delta
     GROUP BY dp.part_id, ct.slug
    HAVING min(sd.created_at) >= $2::timestamptz`, [vendor, sinceIso, LEDGER_SPEC_BEARING]);
  const heldByClass: Record<string, number> = {}, heldByCat: Record<string, number> = {};
  for (const r of heldRows) {
    for (const t of r.types_in_window ?? []) heldByClass[t] = (heldByClass[t] ?? 0) + 1;
    heldByCat[r.category] = (heldByCat[r.category] ?? 0) + 1;
  }

  return {
    _about: "GENERATED by scripts/build-completeness.mts --since. The three day-one numbers of guide §3.5 over facts with "
      + "created_at >= since and superseded_by IS NULL (retracted excluded), on live hardware parts. Definitions: docs/completeness-model.md.",
    vendor, since: sinceIso, until: new Date().toISOString(), built_on_commit: commit,
    arrivals: {
      _about: "Arrivals attributed to sources by the /v1/sources rule (method segment or a fetch/check record of the document). A fact with two sources counts under both, so per-source rows can sum past the totals.",
      facts: arrivals.length,
      into_required_cups: reqTotal,
      into_required_cups_on_held_parts: reqHeld,
      inherited_share_on_held: pctOf(reqHeldInherited, reqHeld),
      majority_inherited: reqHeld > 0 && reqHeldInherited * 2 > reqHeld,
      by_source: [...bySource].map(([source, e]) => ({ source, ...e })).sort((x, y) => y.required - x.required || y.facts - x.facts),
    },
    refusal_at_arrival: {
      stored_arrivals_replayed: {
        _about: "Arrivals into required cups replayed through the census replay (verbatim copy). A value that was STORED and that today's normaliser refuses. `halt` is the §7 rule: above 5% of a cup's arrivals.",
        could_not_replay: { value: cnrTotal, required: 0, passed: cnrTotal === 0 },
        by_cup: [...byCup].map(([key, e]) => ({ key, arrived: e.arrived, would_refuse: e.would_refuse, could_not_replay: e.could_not_replay,
          reasons: e.reasons, refused: pctOf(e.would_refuse, e.arrived), halt: e.arrived > 0 && e.would_refuse / e.arrived > 0.05 }))
          .sort((x, y) => y.would_refuse - x.would_refuse || y.arrived - x.arrived),
      },
      refused_before_storage: {
        from_runs: (() => {
          // Runs of this vendor (or naming none) that carry a refusal counter; the zero rows are summed, not listed.
          const mine = runRows.filter((r) => r.vendor === null || r.vendor === vendor).map((r) => ({ run: r.id, kind: r.kind, status: r.status,
            started_at: r.started_at, vendor: r.vendor, rejected: Number(r.facts_rejected ?? r.rejected ?? 0),
            counter: r.facts_rejected !== null ? "facts_rejected" : "rejected", facts_sentinel: r.facts_sentinel === null ? null : Number(r.facts_sentinel) }));
          const byKind: Record<string, { runs: number; rejected: number }> = {};
          for (const r of mine) { const e = byKind[r.kind] ?? { runs: 0, rejected: 0 }; e.runs++; e.rejected += r.rejected; byKind[r.kind] = e; }
          return { runs_with_a_counter: mine.length, runs_of_other_vendors_excluded: runRows.length - mine.length, by_kind: byKind,
            runs_with_refusals: mine.filter((r) => r.rejected > 0) };
        })(),
        from_local_quarantine_files: { directory: "runs/reports", files: qFiles,
          by_cup_and_reason: [...qByCup].map(([k, n]) => { const [key, reason] = k.split("|"); return { key, reason, n }; }).sort((x, y) => y.n - x.n) },
        missing: "The store has NO refusal table. A value the normaliser refuses before storage is recorded (a) in runs.stats only as a per-run TOTAL "
          + "(`facts_rejected` for apply-acquired, `rejected` for apply-specs) with no cup, reason, part or vendor, and (b) by apply-extract in a "
          + "gitignored runs/reports/quarantine-<tag>-<date>.jsonl on the machine that ran it, which carries key and reason but no vendor and no "
          + "source, is day-granular, and is absent for every apply run on the box. So refusal-at-arrival BY CUP AND REASON cannot be computed for "
          + "refused values; only for stored ones (above). Closing it needs a refusal row per value (run_id, part, key, reason, source) written by the apply.",
      },
    },
    held_delta: {
      _about: "Parts whose EARLIEST linked spec-bearing document has source_docs.created_at in the window. doc_parts carries no timestamp, so a "
        + "link added in the window to a document created BEFORE it is invisible here, and a document re-linked is not counted: this is a lower bound.",
      parts: heldRows.length, by_document_class: heldByClass, by_category: heldByCat,
    },
  };
}

main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
