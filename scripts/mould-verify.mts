/**
 * scripts/mould-verify.mts — `npm run mould:verify`. STEP P.4 of the reviewer's brief, 27 Sep 2026.
 *
 *     npx tsx scripts/mould-verify.mts [--no-db]
 *
 * The brief declares 27 named tests, each tied to the findings it keeps fixed, and the rule that "a FIXED
 * without a test is not fixed". This is the harness plus its first implemented slice.
 *
 * THE ONE DESIGN RULE, and it is this repo's oldest lesson: a check that cannot run must never look like a
 * check that passed. Every one of the 27 is DECLARED here with its finding numbers. An unimplemented test
 * reports NOT IMPLEMENTED and is counted in its own number, never folded into passes. A test that needs the
 * database and cannot reach it reports UNAVAILABLE, also its own number. The summary line prints all four
 * counts — passed / FAILED / not implemented / unavailable / not exercised — so "green" can never mean "I only ran six".
 *
 * Exit: 1 if anything FAILED, 2 if nothing failed but something was UNAVAILABLE (could-not-check is not a
 * pass), 0 only when every implemented test passed. Unimplemented tests do not fail the run — they are a
 * known, printed debt — but the count is in the output of every single run so it cannot be forgotten.
 */
import { shapeIsDefinition, classifyMember, LIST_SHAPES, type MemberVerdict } from "../src/core/listShapes.js";
import { STRUCT_EXAMPLES } from "../src/core/structExamples.js";
import { normalizeField } from "../src/core/specNormalize.js";
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, RELATION_BACKED, domainFor, bandFor, FREE_TEXT_BY_DECISION, requirementFor, type Requirement } from "../src/core/fieldSchema.js";
import { uncoveredEnumValues } from "../src/core/renderContract.js";
import { JTL_PROFILES, jtlContractProblems, csvFile } from "../src/core/jtlExport.js";
import { mouldStatuses } from "../src/core/brandMould.js";
import { NO_PROFILE_REASONS } from "../src/core/noProfileReason.js";
import { NOT_A_KIND, parityRuled, parityCause, formatParitySplit, KIND_PARITY_EXCEPTIONS, KIND_PARITY_OPEN } from "../src/core/kindProfiles.js";
import { partKind } from "../src/core/partKind.js";
import { UNKNOWN_HARDWARE_SQL, splitUnknown, unknownZeroVerdict, type UnknownRow } from "../src/core/unknownEvidence.js";
import { deployRoleResult, roleAxisOf, roleAxisKinds } from "../src/core/deployRole.js";
import { query, closePool, getPool } from "../src/store/db.js";
import { fillState, fillHistogram, filledShare, sameHistogram, readFillStateHistory, FILL_STATES, FILL_STATE_POPULATION,
  FILL_STATE_HISTORY, FILL_STATE_SQL, type FillStateRecord } from "../src/core/fillState.js";
import { readCompleteness } from "../src/api/queries/completeness.js";
import { LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";
import { syncDictionaryOn, dictionaryRows, profileRows, type DictionarySyncResult } from "../src/store/dictionary.js";
import os from "node:os";
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Result = { state: "pass" | "fail" | "unavailable" | "not_exercised"; detail: string };
/**
 * A DECLARED TEST, and what `--self-test` demands of one (reviewer's plan R2, 27 Sep 2026).
 *
 * `selfTest` is how a check proves it can FAIL. It runs the check's own predicate over a deliberately
 * broken input and over a good twin, and returns both verdicts; the harness requires the first to be
 * false and the second true. A check that only ever sees the real corpus is a check nobody has watched
 * go red -- and this repo has shipped several of those, including four in one session that were
 * "checking nothing" because their population was empty by construction.
 *
 * It is NOT the same as the check returning `bad` today. A check can be red because the corpus is
 * broken while its predicate is still incapable of distinguishing anything; `--self-test` separates
 * "this found a defect" from "this can find a defect".
 */
type SelfTest = () => Promise<{ negative: boolean; positive: boolean; note: string }>;
type Test = { name: string; findings: string; needsDb?: boolean; run?: () => Promise<Result>; selfTest?: SelfTest };

/**
 * The value-level predicate behind `required_cup_defined`'s enum half, at module scope FOR ONE REASON:
 * the self-test has to call the code that runs, not a clean-room twin of it. A stand-in tests the logic
 * you were thinking about; this repo has already shipped a patch proven against one (`ws(decode(strip()))`
 * where the real function ends `+ scriptData(html)`) that would have taken a lane's gate to precision 0.06.
 */
const valueInDomain = (cat: string, key: string, value: string): boolean =>
  new Set(domainFor(cat, key) ?? []).has(value);

/** one stored `facts.value` as the list of scalars it holds — a list cup stores a JSON array, a scalar one a string. */
const storedValues = (raw: string): string[] => {
  try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]; }
  catch { return [raw]; }
};

const ok = (detail: string): Result => ({ state: "pass", detail });
const bad = (detail: string): Result => ({ state: "fail", detail });
const na = (detail: string): Result => ({ state: "unavailable", detail });
/**
 * THE FOURTH STATE: the check ran, and the condition it exists to detect HAS NO POPULATION to test
 * against (reviewer, 27 Sep 2026). Not a pass, not a failure, and not "could not reach the database" --
 * it is "there was nothing here to judge", and it needs its own word for the same reason could-not-check
 * does: a check with no material reports exactly like a check that found nothing wrong.
 *
 * The case that forced it: three sabotages in completeness.test could no longer be staged once the 18
 * refused rows left the score, because they were the only live parts with an underivable role. The same
 * happens to refusals_consumed the day the reclassification plan runs and the 18 leave for good -- at
 * which point a check watching for unconsumed refusals has nothing to consume and must SAY so rather
 * than turning green and being quietly retired by accident.
 */
const none = (detail: string): Result => ({ state: "not_exercised", detail });

// THE FILL-STATE CLASSIFIER lives in src/core/fillState.ts (imported above): ONE definition for fill_state_partition's run,
// its self-test (a self-test that re-implements the rule tests a copy) and the scorecard (2 Oct 2026: the scorecard printed a
// different "filled" from a different computation, and two numbers under one word drift apart).

// ---- the deployed API, asked WITH the verifier's key when the environment holds one (ruling (e), 29 Sep 2026) ----
// Key 17 `verifier-box` (read scope) lives only in /root/netzspec-verifier.env on the box. Until this helper, no test sent a
// key even when NETZSPEC_API_KEY was set, so every authenticated route could only ever read "locked": the environment held
// the credential and the request never carried it. The value is sent, never printed.
function apiHeaders(): Record<string, string> {
  const key = process.env.NETZSPEC_API_KEY;
  return { "user-agent": "netzspec-mould-verify/1.0", ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

/** endpoints_alive's classifier, ONE function for the check and its self-test (the self-test used to carry its own copy, which
 *  could only ever agree with itself). FIVE outcomes: a 400 is its own, because the first run with the key called three
 *  routes "genuinely DEAD" that had answered `querystring must have required property 'name'`, `unknown query parameter
 *  "limit"` and `ref "C9200-24P" is not vendor:sku` -- the route validated the request and refused MY malformed probe, which is
 *  proof it is alive and a defect of this file, never of the deployment. */
type RouteVerdict = "alive" | "locked" | "refused" | "dead" | "unreachable";
function routeVerdict(res: { status: number } | null): RouteVerdict {
  if (res === null) return "unreachable";
  if (res.status === 200) return "alive";
  if (res.status === 401 || res.status === 403) return "locked";
  if (res.status === 400 || res.status === 422) return "refused";
  return "dead";
}

/** one_build's contract half against the CODE: the artefacts' shared stamp must be the hash the code computes now. Null = same. */
function contractDrift(stamped: string | undefined, now: string): string | null {
  if (!stamped) return "the artefacts carry no contract hash to compare with the code's";
  return stamped === now ? null : `the artefacts carry contract ${stamped} and the code computes ${now}: stamped against a mould that is no longer the code's`;
}

/** Every internal href on a built site that resolves to nothing (link_integrity, and its self-test over a real directory). */
async function siteLinkReport(site: string): Promise<{ pages: number; checked: number; broken: string[] }> {
  const fs = await import("node:fs"), path = await import("node:path");
  const files = fs.readdirSync(site, { recursive: true, encoding: "utf8" }).filter((f) => typeof f === "string" && f.endsWith(".html"));
  const broken: string[] = [];
  let checked = 0;
  for (const f of files) {
    const html = fs.readFileSync(path.join(site, f), "utf8");
    for (const m of html.matchAll(/href="([^"#?]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|\/\/)/.test(href)) continue;   // external: a different question
      checked++;
      const target = path.resolve(path.dirname(path.join(site, f)), href);
      if (!fs.existsSync(target) && !fs.existsSync(target + ".html") && !fs.existsSync(path.join(target, "index.html"))) broken.push(`${f} -> ${href}`);
    }
  }
  return { pages: files.length, checked, broken };
}

/** THE SITE MUST BE THIS TREE'S SITE. data/site is gitignored (31 MB of generated pages), so mould-build writes it and the deploy
 *  carries it across the swap; a carried site from an OLDER build judged against newer artefacts would certify pages nobody
 *  built from them. So mould-build stamps data/site/BUILD.json with its GIT_SHA and this compares it with the completeness
 *  report's built_on_commit (the same build's own record). Null = the same build; otherwise the reason it is not. */
async function siteBuildProblem(site: string, reportFile: string): Promise<string | null> {
  const fs = await import("node:fs"), path = await import("node:path");
  const marker = path.join(site, "BUILD.json");
  if (!fs.existsSync(marker)) return `the site carries no BUILD.json, so nothing says which build it is from`;
  let sha: unknown, built: unknown;
  try { sha = (JSON.parse(fs.readFileSync(marker, "utf8")) as { git_sha?: unknown }).git_sha; } catch { return `the site's BUILD.json does not parse`; }
  try { built = (JSON.parse(fs.readFileSync(reportFile, "utf8")) as { built_on_commit?: unknown }).built_on_commit; } catch { return `the completeness report ${path.basename(reportFile)} cannot be read`; }
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return `the site's BUILD.json names no full commit (${JSON.stringify(sha)})`;
  if (typeof built !== "string" || built.length < 7) return `the completeness report names no build commit (${JSON.stringify(built)})`;
  return sha.startsWith(built) ? null : `the site is from build ${sha.slice(0, 7)} and the artefacts from ${built.slice(0, 7)} — a STALE site`;
}

/** Two ledgers are the same when their canonical forms are: object keys sorted at every level, array order kept (a ledger's
 *  arrays are ordered on purpose, so a reordering is a real difference). */
function sameLedger(a: unknown, b: unknown): boolean {
  const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// ---- helper for layer_parity_db_vs_artifact (ruling (e), 29 Sep 2026) ---------------------------
/** One part's layers as the database and the artefact each hold them. */
type LayerRow = { product_line: string | null; product_series: string | null };
/** Which layers differ. Empty and null are one value: the artefact writes "" where the database stores NULL. */
function layerRowDiff(db: LayerRow, art: LayerRow): ("product_line" | "product_series")[] {
  const v = (x: string | null) => x ?? "";
  return (["product_line", "product_series"] as const).filter((k) => v(db[k]) !== v(art[k]));
}

// ---- helper for plans_agree_with_rows (ruling (e), 29 Sep 2026) ---------------------------------
/** A plan of record (data/reference/kind-layer-plans-2026-09-13.json). */
type PlanOfRecord = { sku: string; category: string; action: "move" | "class"; to: string; run_id: number; expected_kind_after: string | null };
/** The verdict on ONE plan: did its WRITE hold? A move's write is the category, a class change's the product class. A row
 *  that no longer agrees is SUPERSEDED only when a later successful run names the part; otherwise it is a disagreement --
 *  the write did not happen, or something unrecorded undid it. The kind the plan expected is not judged here: the kind
 *  axes have been refined since 13 Sep ("unknown" became radio / interface / cellular), which is progress, not a miss. */
function planVerdict(p: PlanOfRecord, row: { cat: string; cls: string; retired: boolean } | undefined, laterRun: number | null):
  "agrees" | "superseded" | "retired" | "no-part" | "disagrees" {
  if (!row) return "no-part";
  if (row.retired) return "retired";
  const holds = p.action === "move" ? row.cat === p.to : row.cls === p.to;
  if (holds) return "agrees";
  return laterRun !== null && laterRun > p.run_id ? "superseded" : "disagrees";
}

// ---- helpers for kind_profile_parity (A1) -----------------------------------------------------

/** The four sets a KIND alone is asked in a category, resolved through the REAL requirementFor on a
 *  synthetic part carrying only that kind -- the same resolution the API performs for a part whose
 *  other values are unknown. Sorted, so a diff is about membership and never about iteration order. */
/** One (category, kind, cup) that live parts of the kind hold OWN facts for, and how many parts. */
type HeldCup = { cat: string; kind: string; key: string; parts: number };
/** THE VETO, pure (four_sets_sum): every held cup the derivation marks na for its (category, kind) -- most parts first --
 *  and, counted apart, the held cups on a (category, kind) the ledger lists no derivation for. Never folded together: a
 *  pair nobody derived is not a pair with no veto. */
function naVetoes(sets: ReadonlyMap<string, ReadonlySet<string>>, held: readonly HeldCup[]): { vetoes: HeldCup[]; underived: HeldCup[] } {
  const vetoes: HeldCup[] = [], underived: HeldCup[] = [];
  for (const h of held) {
    const na = sets.get(`${h.cat}|${h.kind}`);
    if (!na) underived.push(h);
    else if (na.has(h.key)) vetoes.push(h);
  }
  return { vetoes: vetoes.sort((a, b) => b.parts - a.parts), underived };
}

function resolveFourSets(category: string, kind: string): Record<string, string[]> {
  const out: Record<string, string[]> = { req: [], pending: [], opt: [], na: [] };
  const profile = PROFILES[category];
  if (!profile) return out;
  for (const key of Object.keys(profile)) {
    const r = requirementFor(category, key, { kind });
    (out[r] ??= []).push(key);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/** Which of the named columns `parts` actually has. The layer columns (sku_kind, product_line,
 *  product_family, product_family_state, product_series, bucket, no_family_reason) are B2 work: today
 *  the layers live in built artefacts and NOT in the database, so five of the Phase A tests cannot
 *  judge anything yet.
 *
 *  That is reported as NOT EXERCISED with the missing columns NAMED, never as a pass. A test that
 *  cannot reach its population must not read like one that looked and found nothing -- which is this
 *  repo's most-repeated defect and the reason the fourth state exists at all. */
async function partsColumns(): Promise<{ have: Set<string>; error?: string }> {
  try {
    const r = await query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'parts'");
    return { have: new Set(r.rows.map((x) => x.c)) };
  } catch (e) {
    return { have: new Set(), error: e instanceof Error ? e.message : String(e) };
  }
}

/** NOT EXERCISED for a layer test, with its producer named and the same sentence every time, so the
 *  five read as one blocked family rather than five unrelated silences. */
function needsLayerColumns(cols: { have: Set<string>; error?: string }, wanted: string[]): Result | null {
  if (cols.error) return none(`could not read the parts columns: ${cols.error}`);
  const missing = wanted.filter((c) => !cols.have.has(c));
  if (!missing.length) return null;
  return none(`the layers are not in the database yet — parts is missing ${missing.join(", ")} ` +
    `(producer: B2 "Layers into the DB"; they exist today only in the built artefacts, so this test ` +
    `has no population to judge and is NOT a pass)`);
}

/** The kinds a category's own profile mentions in a `kind` condition. Derived from the profile rather
 *  than from a hand-kept list, because a hand-kept list of what exists is this repo's oldest named
 *  defect -- it drifts the day a kind is added and nothing compares the two. */
function kindsDeclaredBy(category: string): string[] {
  const profile = PROFILES[category];
  if (!profile) return [];
  const found = new Set<string>();
  const walk = (c: unknown): void => {
    if (!c || typeof c !== "object") return;
    const o = c as Record<string, unknown>;
    if (o.field === "kind" && Array.isArray(o.inList)) for (const k of o.inList) if (typeof k === "string") found.add(k);
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  for (const rule of Object.values(profile as Record<string, unknown>)) walk(rule);
  return [...found].sort();
}

/** Every (category, kind) pair that actually holds a LIVE part. Asked of the database rather than of
 *  the profiles, because a kind nobody has is a kind whose parity nobody is paying for -- and the
 *  denominator of this test has to be the shape of the catalogue, not the shape of the config. */
async function kindPairsWithParts(): Promise<{ pairs: { category: string; kind: string }[]; note: string }> {
  const sql =
    "SELECT c.slug AS category, p.sku_kind AS kind, count(*)::text AS n" +
    " FROM parts p JOIN categories c ON c.id = p.category_id" +
    " WHERE p.retired_at IS NULL AND p.sku_kind IS NOT NULL AND p.product_class = 'hardware'" +
    " GROUP BY 1, 2 ORDER BY 1, 2";
  try {
    const r = await query<{ category: string; kind: string; n: string }>(sql);
    return { pairs: r.rows.map((x) => ({ category: x.category, kind: x.kind })), note: `query: ${sql}` };
  } catch (e) {
    // A column that does not exist yet is a fact about the schema, not about parity. Reported rather
    // than swallowed, and it lands as NOT EXERCISED with its producer named.
    return { pairs: [], note: `could not read (category, kind) pairs: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// What each run kind OWES under the three-class rule (runs_have_approval). Every kind present in `runs`
// on 28 Sep 2026 is here; a new kind fails the check until it is placed. Placed by what the command DOES,
// not by what its runs happen to carry -- a table built from the carriers would pass by construction.
const A = { approval: true, gate: false }, G = { approval: false, gate: true },
      AG = { approval: true, gate: true }, D = { approval: false, gate: false };
const RUN_KIND_CLASS: Record<string, { approval: boolean; gate: boolean }> = {
  // membership (category / class / part creation or retirement) or withdrawal of facts -> approval
  "move-category": A, "class-change": A, "reclassify": A, "reclassify-docs": A, "promote-unknown-skus": A,
  "create-categories": A, "hygiene-case-duplicates": A, "hygiene-foreign-pids": A, "hygiene-hw-variants": A,
  "hygiene-whitespace-duplicates": A, "retired-residue": A, "retract-group-inherited": A,
  "retract-licence-mined": A, "retract-page-read-deploy-role": A, "retract-refused-value": A,
  "retract-withdrawn-mapping": A, "revert-cross-vendor-layer-write": A, "drop-orphan-keys": A,
  "correct-tier0": A, "bundle-plan-facts": A,
  // apply-* that also change membership or withdraw -> both
  "apply-retract-inherited": AG, "apply-retract-column-backed": AG, "apply-retract-port-misparse": AG,
  "apply-promote-only-source-series": AG, "apply-reclassify-hardware-evidence": AG,
  "apply-reclassify-nonhardware": AG, "apply-enumeration": AG, "apply-repair-truncated": AG, "reconcile-conflict-states": A, "backfill-evidence-chain": A,
  // writes facts -> gate
  "apply-acquired": G, "apply-specs": G, "apply-renormalize": G, "apply-remerge": G, "apply-derive-cellular": G,
  "apply-key-holders": G, "remap-cpu-power-to-tdp": G, "reroute-per-slot-capacity": G, "rekey-psu-and-compat": G,
  "split-bidi-rx": G, "migrate-atlas": G,
  // derives from what is stored -> neither
  "recompute-completeness": D, "write-layers-to-db": D, "build-spare-of": D, "derive-link-provenance": D,
  "derive-part-states": D, "fill-family-from-hct-category": D, "sync-dictionary": D, "derive-pon-standard": D, "name-language": D,
  "name-spare-packaging": D, "name-spare-wording": D, "name-from-twin": D, "images": D, "probe-failure-reason": D,
  "reclassify-by-twin-siblings": A, "retire-psu-options": AG, "retract-capability-or": A, "restamp-orphan-withdrawals": A,
  "backfill-doc-titles": D, "record-title-provenance": D, "record-retroactive-approval": A, "retro-gate": A, "apply-series-hints": AG, "apply-product-compat": AG, "set-series": A,
  // Q7 (29 Sep): writes one ports fact per converted part (gate) and retracts its lan/wan facts (withdrawal -> approval)
  "convert-lan-wan-ports": AG,
  // a named rule proves a fact sits under the wrong cup and withdraws it (ruling Q8 onward) -> approval
  "retract-mis-keyed": A,
  // ruling Q11 (29 Sep 2026): a conflict's class is a derived LABEL (no fact moves); closing an orphan closes a disagreement -> approval
  "classify-conflicts": D, "resolve-orphan-conflicts": A,
  // rulings Q13 / Q14: closing a conflict as a superseded reading or as a dispute between values no fact holds -> approval
  "resolve-superseded-readings": A, "resolve-no-held-conflicts": A,
  // ruling Q15: a fragment of a real PID read off a page is retired (membership) -> approval
  "retire-fragments": A,
  // ruling Q17, the read triples: pours retracted by EXACT row from a read list -> approval
  "retract-read-pours": A,
  // ruling Q20: an orphan's recorded reading promoted (or a split range composed) as a new fact -> approval + gate
  "promote-orphan-readings": AG,
  // rulings of 30 Sep 2026 (the weight lane): a licence-tier variant takes its model row's weight (inherited; approval + a gate
  // that re-reads each model row), and a cable's stated 'Module weight (Max)' written as derived:max-bound (every row re-read)
  "inherit-tier-weight": AG, "derive-max-bound-weight": G,
  // ruling (B), 30 Sep 2026: stackable from a sub-series row's stated stacking bandwidth (every witness cell re-read)
  "derive-stackable-from-bandwidth": G,
  // FINAL FILL ORDER item 4 (30 Sep 2026): Versandgewicht for small components from the shipping-class table (derives from a table)
  "derive-shipping-class": D,
  // ruling Q23: Versandgewicht derived from the stored weight and the ruled band table -> derives from what is stored
  "derive-shipping-weight": D,
  // ruling Q24: a single-model sheet's document-level weight written per SKU (a read, gate re-reads every statement)
  "apply-single-model-weight": AG,
  // name lane (30 Sep 2026): a SKU-only name takes the description cell its sheet prints beside the PID (gate re-reads each)
  "name-from-description": AG,
  // reviewer temperature rulings (30 Sep 2026): per-model reads / intersections supersede inherited values and seeds, one run
  "correct-temps-by-sheet": AG,
  // FILL PIPELINE acquire (reviewer ruling 30 Sep 2026): the login-walled /products/se/ queue rows parked, never re-queued
  // (a queue decision, no fact moves; the ruling is the approval, recorded in inputs.approved)
  "park-login-walled": A,
  // component-shape round (reviewer rulings 30 Sep 2026): withdraws the inherited facts components held from their host's sheet
  // (approval) inside a gated run (re-read + the store's rule + an independent count)
  "apply-retract-component-inherited": AG,
  "apply-retract-doc-subject": AG,   // (b') 2 Oct 2026: the served out-of-subject document-scoped facts, approval + gate
  "apply-retract-nonhw-class": AG,   // Q2 2 Oct 2026: served document-scoped inherited facts on non-hardware parts, approval + gate
  "record-late-approval": A,         // 2 Oct 2026: a contemporaneous approval the run's tool could not carry (run 1473), marked late
  // ROUTERS (operator order 5 Oct 2026): every router family's datasheet listings queued for the lane -- a queue decision like
  // park-login-walled (no fact moves); the operator's order is the approval, recorded verbatim in inputs.approved
  "enqueue-router-listings": A,
};
// The vendor this lane has axes for; vendor_coverage owns every other vendor's hardware (unknown_zero counts them apart).
const OWN_VENDOR = "cisco";

// doc_category_by_relevance: a readable untitled document counts against the check unless its title_state records that
// the file carries no title (reviewer ruling 28 Sep 2026: title_state = none, nothing invented).
function untitledCounts(titleState: string | null): boolean {
  return titleState !== "none";
}

// dictionary_in_sync (reviewer, 29 Sep 2026): the verdict on a sync of the code's dictionary run into a transaction that is
// always rolled back. A refusal fails, and so does any pending change; only "would change nothing" passes.
type SyncOutcome = { refused: string }
  | { result: Pick<DictionarySyncResult, "inserted" | "updated" | "profiles_inserted" | "profiles_updated" | "reshaped"> };
function syncDriftVerdict(o: SyncOutcome): { inSync: boolean; detail: string } {
  if ("refused" in o) return { inSync: false, detail: `a sync now would be REFUSED: ${o.refused.slice(0, 400)}` };
  const r = o.result;
  if (r.inserted + r.updated + r.profiles_inserted + r.profiles_updated === 0) return { inSync: true, detail: "a sync now would change nothing" };
  return { inSync: false, detail: `the table is not the code's dictionary: a sync now would insert ${r.inserted} / update ${r.updated} keys ` +
    `and insert ${r.profiles_inserted} / update ${r.profiles_updated} profile rows` +
    (r.reshaped.length ? `; reshaped: ${r.reshaped.map((x) => x.key).join(", ")}` : "") };
}

// openapi_schemas: the shapes a consumer needs, and the route each LEVEL shape must be served at. A schema with no
// route is a name that routes nowhere (reviewer, 28 Sep 2026: `Model` was declared green while /v1/models 404'd).
const OPENAPI_WANTED = ["Part", "Fact", "Conflict", "Relation", "Ledger", "Completeness", "Line", "Family", "Model", "ExportRow"];
const OPENAPI_ROUTE_FOR: Record<string, string> = {
  Line: "/v1/lines/{vendor}/{line}", Family: "/v1/families/{vendor}/{family}", Model: "/v1/models/{vendor}/{model}",
};
function openapiMissing(schemas: string[], paths: string[]): string[] {
  const out: string[] = [];
  for (const w of OPENAPI_WANTED) {
    if (!schemas.includes(w)) out.push(`${w} (no schema)`);
    else if (OPENAPI_ROUTE_FOR[w] && !paths.includes(OPENAPI_ROUTE_FOR[w])) out.push(`${w} (no route ${OPENAPI_ROUTE_FOR[w]})`);
  }
  return out;
}
/** Why a run that owes something is a NAMED exception, or null. Run 69 cannot be gated retrospectively; any other run
 *  is excepted only by a recorded retro-gate verdict (reviewer, 28 Sep: "an exception is earned by the gate, not by age"). */
function runException(id: string, retro: Map<string, string>): string | null {
  if (id === "69") return "hand-run conflict reopen of 4 Sep, no gate possible";
  return retro.get(id) ?? null;
}
// Reviewer ruling 28 Sep 2026: the requirement starts at the first recorded approval. Earlier misses are NAMED as
// pre-convention in the output and never judged or folded into a pass.
const RUN_CONVENTION_START = "2026-09-11";
/** What one succeeded run is missing under the three-class rule; the check and its self-test both call THIS. */
function runOwes(kind: string, appr: boolean, gate: boolean, started: string):
    "unclassified" | { approval: boolean; gate: boolean; pre: boolean } {
  const o = RUN_KIND_CLASS[kind];
  if (!o) return "unclassified";
  return { approval: o.approval && !appr, gate: o.gate && !gate, pre: started < RUN_CONVENTION_START };
}

// ---- the 27, declared whether or not they are written ------------------------------------------------------------
const TESTS: Test[] = [
  {
    name: "german_domain_coverage",
    findings: "S7",
    // An EXACT ratchet, not a floor. It read 0 for a fortnight because the coverage check filtered `type
    // !== "e"` and could not see list-of-enum keys — 458 of 766 domain values with no German.
    run: async () => {
      const gaps = uncoveredEnumValues();
      const values = gaps.reduce((n, g) => n + (Number(/— (\d+) domain values/.exec(g.value)?.[1]) || 1), 0);
      const KEYS = 7, VALUES = 458;
      return gaps.length === KEYS && values === VALUES
        ? ok(`${KEYS} keys / ${VALUES} domain values still uncovered (the recorded debt, unchanged)`)
        : bad(`expected ${KEYS} keys / ${VALUES} values, got ${gaps.length} / ${values}: ${gaps.map((g) => g.key).join(", ")}`);
    },
  },
  {
    name: "required_cup_defined",
    // THE NEGATIVE FIXTURE FOR THE STRUCT CONDITION, added with it 28 Sep 2026. The condition's whole point
    // is that a shape STRING is not a definition, so the fixture has to be a real shape whose parser refuses a
    // real printed value — not a made-up key, which would test the lookup rather than the rule.
    //
    // `antenna_gain` is that pair: it declares `{ band24: n, band5: n }`, is required of 216 wireless antennas,
    // and the normaliser returns STRUCT_UNPARSED for the exact two-band form its own shape describes.
    // `dimensions` is the positive twin and is the one that proves the condition is not simply always-false —
    // it went red on its first run because I had pasted a DISPLAY-TRUNCATED raw into the example table, and the
    // full string parses. Both run through the REAL normalizeField, never a stand-in.
    selfTest: async () => {
      // MOVED 29 Sep 2026: antenna_gain gained its parser (Batch C), so it can no longer be the negative. bidi_wavelengths is
      // the next real one: a declared struct shape with NO parser behind it, and a real printed value -- "Tx 1490 nm / Rx 1310 nm"
      // is stored 9x under `wavelength` on BiDi optics, which is exactly the cell this cup exists to hold.
      const bad = { raw: "Tx 1490 nm / Rx 1310 nm" }, good = STRUCT_EXAMPLES.dimensions;
      const parses = (cat: string, key: string, raw: string) =>
        (normalizeField(cat, key, raw, { locale: "en" }) as { ok: boolean }).ok;
      const structNeg = parses("transceiver", "bidi_wavelengths", bad.raw);   // must be FALSE: no parser behind the shape
      const structPos = parses("switches", "dimensions", good.raw);      // must be TRUE: a shape with a parser
      // THE ENUM HALF'S FIXTURE AND ITS TWIN ARE THE SAME CATEGORY AND THE SAME CUP, differing only in the
      // VALUE — which is the whole claim being proven: the rule distinguishes what is stored, not which cup
      // it is stored in. A fixture on a different key would have passed just as well against a rule that
      // reads only the cup, and that is the shape this repo keeps paying for. Both strings are real stored
      // values of transceiver/standard, counted over the live store: "-40 bis 85 °C" is an OPERATING
      // TEMPERATURE sitting in the standard cup (x1), "10gbase-dwdm" is the cup's commonest value (x107).
      const enumNeg = valueInDomain("transceiver", "standard", "-40 bis 85 °C");  // must be FALSE
      const enumPos = valueInDomain("transceiver", "standard", "10gbase-dwdm");   // must be TRUE
      return {
        // ANDed and ORed so that neither half can carry the other: `negative` is false only when BOTH
        // broken inputs are rejected, `positive` true only when BOTH good twins are accepted. All four are
        // named in the note, because a single boolean cannot say which condition stopped distinguishing.
        negative: structNeg || enumNeg,
        positive: structPos && enumPos,
        note: `struct: bidi_wavelengths accepts a real printed BiDi pair = ${structNeg} (must be false), dimensions = ${structPos} (must be true); ` +
              `enum: transceiver/standard admits "-40 bis 85 °C" = ${enumNeg} (must be false), admits "10gbase-dwdm" = ${enumPos} (must be true)`,
      };
    },
    findings: "C1–C4, N13",
    // A required cup must be checkable: an enum needs a domain, a number needs a unit AND a band, a struct
    // needs a shape. A required FREE STRING can hold anything, so nothing can ever refuse a wrong value.
    needsDb: true,
    run: async () => {
      const badCups: string[] = [];
      const structUntested: string[] = [];   // a struct with no canonical example: its own number, never folded into either
      // SATISFIABLE HERE, NOT FACTS ANYWHERE (reviewer, 28 Sep 2026) — the rule that would have caught me a
      // day earlier. I added `connector` as a required cup to three cable kinds on the strength of it holding
      // 2,328 facts SOMEWHERE, when the question is whether a value for THESE parts can be in the domain:
      // connector's domain is optical + RJ45 and the parts are "LMR-240 with TNC Connector" and "HDMI to
      // DVID". Facts-anywhere and satisfiable-here are different questions and only the second licenses a
      // requirement. So: for every (category, kind) that requires an enum or list cup, every OWN fact stored
      // for that pair must be in that category's domain, or the pair is reported with the offending values.
      const enumRows = (await query<{ cat: string; kind: string | null; key: string; value: string; n: string }>(`
        SELECT c.slug AS cat, p.sku_kind AS kind, f.field_key AS key, f.value::text AS value, count(*)::text AS n
          FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id
          JOIN vendors v ON v.id = p.vendor_id
         WHERE f.superseded_by IS NULL AND f.value IS NOT NULL AND p.retired_at IS NULL
           AND f.inherited IS NOT TRUE AND f.method NOT LIKE 'retracted:%'
         GROUP BY 1, 2, 3, 4`)).rows;
      const byPair = new Map<string, { value: string; n: number }[]>();
      for (const r of enumRows) {
        if (!r.kind) continue;
        const k = `${r.cat}|${r.kind}|${r.key}`;
        byPair.set(k, [...(byPair.get(k) ?? []), { value: r.value, n: Number(r.n) }]);
      }
      /** the offending stored values for one (category, kind, enum cup), or [] when every one is in domain */
      const outOfDomain = (cat: string, kind: string, key: string): string[] => {
        if (!(domainFor(cat, key) ?? []).length) return [];   // no domain is the OTHER branch's finding, not this one
        const bad: string[] = [];
        for (const { value, n } of byPair.get(`${cat}|${kind}|${key}`) ?? []) {
          for (const v of storedValues(value)) if (!valueInDomain(cat, key, v)) bad.push(`${v} x${n}`);
        }
        return [...new Set(bad)];
      };
      const unsatisfiable: string[] = [];
      let enumAsked = 0;
      /** the kinds each category actually holds, from the store — never a list written by hand */
      const kindsIn = new Map<string, Set<string>>();
      for (const r of enumRows) if (r.kind) kindsIn.set(r.cat, (kindsIn.get(r.cat) ?? new Set()).add(r.kind));
      const byDecision: string[] = [];
      const byShape: string[] = [];
      const byRelation = new Set<string>();
      let seen = 0;
      for (const [cat, prof] of Object.entries(PROFILES)) {
        for (const [key, rule] of Object.entries(prof as Record<string, Requirement>)) {
          // `cond` TOO. This read `!== "req"` and therefore evaluated ZERO cups of the 652 that can be
          // required: only 45 cups are unconditional `req` and every one of them is `vendor` or `series`,
          // both COLUMN_BACKED and skipped below — so the population was empty by construction while the
          // test printed PASS. The 607 `cond` cups ARE required whenever their gate trips, and they are
          // the ones a wrong value actually reaches. Found by the reviewer reading the code, not by any run.
          const kind = (rule as { kind?: string }).kind;
          if (kind !== "req" && kind !== "cond") continue;
          const d = FIELD_DICTIONARY[key] as { type?: string; unit?: string | null; band?: unknown; shape?: unknown } | undefined;
          if (!d || COLUMN_BACKED.has(key)) continue;
          // A RELATION_BACKED cup is defined by the relation kinds that answer it (ruling 12a), not by a domain or shape:
          // counted as its own number, never skipped silently.
          if (RELATION_BACKED[key]) { byRelation.add(`${cat}/${key}`); continue; }
          seen++;
          const t = d.type;
          // A DOMAIN **OR** A SHAPE. A list cup is checkable when something can refuse a wrong value,
          // and for the four truncated vocabularies an enumerated domain is the wrong instrument: 37-69%
          // of their stored facts were cut at 160 characters, so a vocabulary derived from them is too
          // NARROW and would refuse real values the moment the re-extraction recovers them. A shape is
          // immune to that -- truncation changes which tokens survive, not the FORM of the survivors.
          //
          // shapeIsDefinition is not a declaration check: it refuses any shape with an empty refuse set
          // and re-runs the shape's own fixtures, so `.*` cannot register. Its reason is printed rather
          // than swallowed, because "no shape" and "a shape that does not work" are different findings.
          if (t === "e" || t === "ls") {
            if (!(domainFor(cat, key) ?? []).length) {
              const sh = shapeIsDefinition(key);
              if (!sh.ok) badCups.push(`${cat}/${key} list with no domain and ${sh.why}`);
              else byShape.push(`${cat}/${key}`);
            } else {
              // A DOMAIN EXISTING IS NOT A DOMAIN THAT FITS. Ask every kind in this category that the cup is
              // actually REQUIRED of whether its own stored values are in that category's domain. A kind with
              // no stored value yet is not judged — that is a gap, not an unsatisfiable requirement, and
              // conflating them would make every unfilled cup read as a defect.
              for (const kind of kindsIn.get(cat) ?? []) {
                if (requirementFor(cat, key, { kind }) !== "req") continue;
                enumAsked++;
                const bad = outOfDomain(cat, kind, key);
                if (bad.length) unsatisfiable.push(`${cat}/${kind}/${key}: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` +${bad.length - 3}` : ""}`);
              }
            }
          }
          // A COUNT'S DEFINITION IS ITS BAND, AND DEMANDING A UNIT WAS THE WRONG DEMAND (27 Sep 2026).
          // This asked every numeric for a unit AND a band. Tried on the five counts that had a band and
          // no unit -- module_slots, vlan_max, poe_ports, radio_count, breakout_count -- and the
          // normaliser suites went red immediately: a DECLARED unit is a token convert() then requires in
          // the cell, so "8 PoE+", "6 zl2-Modul-Steckplätze" and "2x 2.4 GHz and 2x 5 GHz" stopped
          // parsing. They are real datasheet strings that parsed correctly before. A count has no
          // dimension: the unit would be a label, the BAND is what can refuse a wrong value, and
          // inventing a noun to satisfy a checklist made the mould worse at reading its own sources.
          // So a numeric is defined when it has a band; a unit is required only alongside one, never
          // instead of one. The 29 unit-only pairs were never undefined -- the check was.
          // PER CATEGORY, like the enum branch one line up. This read only the GLOBAL d.band while
          // enums have always been asked category-aware via domainFor(cat, key) -- so a key whose band
          // is deliberately per-category was reported undefined while its band sat measured and
          // commented in CATEGORY_BANDS. rf_gain and insertion_loss_max are exactly that: both carry a
          // band for `video` with the stored figures written beside them, and both were being counted
          // as gaps. A definition the check cannot reach is indistinguishable from one that is missing,
          // and the asymmetry between the two branches is what hid it.
          else if (t === "n") { if (!Array.isArray(bandFor(cat, key) ?? d.band)) badCups.push(`${cat}/${key} numeric with no band`); }
          // A STRUCT'S SHAPE IS NOT ITS DEFINITION — A PARSER BEHIND IT IS (reviewer, 28 Sep 2026).
          // This asked one thing: does a `shape` STRING exist. A shape string is documentation, and
          // `antenna_gain` declares `{ band24: n, band5: n }`, is required of 216 wireless antennas, and
          // normalizeField returns STRUCT_UNPARSED for every value the vendor prints — including the exact
          // two-band form its own shape describes. It refuses everything it is handed, which is `.*` in
          // reverse, and the old condition could not see it because the string was there.
          //
          // So the shape's own canonical example must PARSE, through the real normaliser. Every example is
          // a real printed string (src/core/structExamples.ts names where each came from). A key with no
          // example is NOT counted defined and NOT counted broken: it is its own number, because "no parser"
          // and "nothing to test the parser with" are different findings.
          else if (t === "struct") {
            if (!d.shape) badCups.push(`${cat}/${key} struct with no shape`);
            else {
              const ex = STRUCT_EXAMPLES[key];
              if (!ex) structUntested.push(`${cat}/${key}`);
              else {
                const r = normalizeField(cat, key, ex.raw, { locale: "en" }) as { ok: boolean; reason?: string };
                if (!r.ok) badCups.push(`${cat}/${key} struct whose shape "${d.shape}" REFUSES its own canonical example ` +
                  `"${ex.raw.slice(0, 40)}" (${ex.from}): ${r.reason} — a shape with no parser behind it`);
              }
            }
          }
          // A REQUIRED FREE STRING IS A FINDING UNLESS IT IS A RECORDED DECISION -- and the repo already
          // has that third state, with a decision file behind it and a sabotage test holding it.
          // tests/freeStringCups.test.ts refuses any required free string whose key is not in
          // FREE_TEXT_BY_DECISION *and* named in docs/decisions/2026-09-13-free-string-cups.md. This
          // check never consulted it, so it counted cpu, display and image_sensor as gaps while the
          // decision file explains, with measurements, why each stays open -- display was amended by
          // the parent on exactly this point ("required, they would be two required cups with no tap,
          // and the phase-1 invariant no-required-cup-without-a-fill-path would fail").
          // Counted as its OWN number and named in the output, never folded into "defined": an
          // allowlist that disappears into a pass is the hole it was meant to close.
          else if (t === "s") {
            if (FREE_TEXT_BY_DECISION[key]) byDecision.push(`${cat}/${key}`);
            else badCups.push(`${cat}/${key} REQUIRED free string`);
          }
        }
      }
      // The denominator is in the message either way: a test that cannot say how much it looked at is one
      // nobody can tell apart from a test that looked at nothing.
      // THE FOURTH CONDITION, ENUM HALF. A domain existing is not a domain that FITS: `enum_values_in_domain`
      // asks the whole store, this asks the narrower and stricter question the reviewer set -- for every
      // (category, kind) the cup is REQUIRED of, are that pair's OWN stored values inside the domain the
      // pair resolves. A requirement is licensed by SATISFIABLE HERE, never by facts-anywhere: three D rows
      // added `connector` to kinds whose parts hold connectors the category domain cannot express, and the
      // fillability check that let them through asked "does this cup hold facts ANYWHERE" (2,328: yes).
      // Its own number, named with the offending values, because a pair with no stored value yet is a GAP
      // and folding the two together would make every unfilled cup read as a defect.
      const satLine = unsatisfiable.length
        ? `; ${unsatisfiable.length} required enum/list cup(s) are UNSATISFIABLE for the kind that must fill them -- the domain exists and their OWN stored values are outside it: ${unsatisfiable.slice(0, 6).join("; ")}${unsatisfiable.length > 6 ? ` +${unsatisfiable.length - 6} more` : ""}`
        : `; every required enum/list cup is SATISFIABLE by the kinds required to fill it (${enumAsked} category/kind/cup triples read against ${enumRows.length} stored value groups)`;
      return badCups.length === 0 && unsatisfiable.length === 0
        ? ok(`all ${seen} required/conditional cups carry a domain, a band, or a shape WHOSE PARSER ACCEPTS ITS OWN CANONICAL EXAMPLE` + (byRelation.size ? `; ${byRelation.size} relation-backed (defined by their relation kinds, ruling 12a)` : "") + (byShape.length ? `; ${byShape.length} defined by a registered shape (${[...new Set(byShape.map((c) => c.split("/")[1]))].join(", ")})` : "") + (byDecision.length ? `; ${byDecision.length} are free text by recorded decision (${[...new Set(byDecision.map((c) => c.split("/")[1]))].join(", ")})` : "") + satLine)
        : bad(`${badCups.length} of ${seen} required/conditional cups cannot be checked` + (structUntested.length ? `; ${structUntested.length} struct cup(s) have NO canonical example so their parser was NOT TESTED (${[...new Set(structUntested)].join(", ")}) — not counted defined and not counted broken` : ``) + (byShape.length ? `; ${byShape.length} are defined by a registered SHAPE (${[...new Set(byShape.map((c) => c.split("/")[1]))].join(", ")})` : "") + (byDecision.length ? `; a further ${byDecision.length} are free text by recorded decision (${[...new Set(byDecision.map((c) => c.split("/")[1]))].join(", ")}) and are NOT counted as gaps` : "") + `: ${badCups.slice(0, 10).join("; ")}${badCups.length > 10 ? ` … +${badCups.length - 10}` : ""}` + satLine);
    },
  },
  {
    name: "no_gate_on_optional",
    findings: "D1–D3",
    // A cup required only when a gate trips is unanswerable if the gate itself is optional and unfilled:
    // the requirement can never be decided, so the cup sits `pending` for ever.
    run: async () => {
      const offenders: string[] = [];
      const fields = (n: unknown, out: Set<string>): void => {
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (typeof o.field === "string") out.add(o.field);
        for (const v of Object.values(o)) Array.isArray(v) ? v.forEach((x) => fields(x, out)) : fields(v, out);
      };
      for (const [cat, prof] of Object.entries(PROFILES)) {
        const p = prof as Record<string, Requirement>;
        for (const [key, rule] of Object.entries(p)) {
          if ((rule as { kind?: string }).kind !== "cond") continue;
          const read = new Set<string>();
          fields(rule, read);
          for (const g of read) {
            // A DERIVED GATE IS EXEMPT ONLY WHERE THE DERIVATION CAN SPEAK (27 Sep 2026). This line used to
            // read `COLUMN_BACKED.has(g) || g === "kind" || g === "deploy_role" || g === "modular"`, which
            // exempted `deploy_role` unconditionally — so the check could not see a cup gated on it, which is
            // exactly the case it exists to catch. meraki gated NINE cups on a `deploy_role` its profile did
            // not declare, plus unified-communications and data-center-networking, and all of them resolved
            // `na` in silence while this test reported "no conditional cup is gated on an optional or
            // undeclared field". The reviewer read the miss as source-map-versus-merged; it is not — PROFILES
            // here IS the merged object, built at module load. The check was simply told to look away.
            //
            // `kind` is genuinely universal (partKind answers for every category that gates on it).
            // `deploy_role` is answerable only where AXIS gives the category a role-bearing kind, and
            // `modular` only in routers — so those exemptions are now conditional on the derivation having a
            // population at all. A gate nothing can ever answer is a dead gate wherever it lives.
            if (g === "kind") continue;
            if (g === "deploy_role" && roleAxisKinds(cat).length > 0) continue;
            if (g === "modular" && cat === "routers") continue;
            if (COLUMN_BACKED.has(g) && g !== "deploy_role" && g !== "modular") continue;
            // An UNDECLARED gate is as unanswerable as an optional one and used to pass in silence: p[g]
            // is undefined, the === "opt" test is false, and the cup sits pending for ever with nothing
            // saying why. Both are now reported, and named apart because the fix differs.
            const gk = (p[g] as { kind?: string } | undefined)?.kind;
            if (gk === "opt") offenders.push(`${cat}/${key} gated on OPTIONAL ${g}`);
            else if (gk === undefined) offenders.push(`${cat}/${key} gated on ${g}, undeclared in this profile`);
          }
        }
      }
      return offenders.length === 0
        ? ok(`no conditional cup is gated on an optional or undeclared field (${Object.keys(PROFILES).length} profiles)`)
        : bad(`${offenders.length}: ${offenders.slice(0, 8).join("; ")}${offenders.length > 8 ? ` … +${offenders.length - 8}` : ""}`);
    },
  },
  {
    name: "column_backed_never_facts",
    findings: "N34",
    needsDb: true,
    // A column-backed key is derived or stored on `parts`. A FACT under the same key is a second answer to
    // one question, and the record then serves both — which is how `product_line` could disagree with itself.
    run: async () => {
      const keys = [...COLUMN_BACKED];
      const rows = (await query<{ field_key: string; n: string }>(`
        SELECT f.field_key, count(*)::text n FROM facts f JOIN parts p ON p.id = f.part_id
         WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL
           AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL
         GROUP BY 1 ORDER BY 2 DESC`, [keys])).rows;
      const total = rows.reduce((n, r) => n + Number(r.n), 0);
      return total === 0
        ? ok(`0 facts under the ${keys.length} column-backed keys (${keys.join(", ")})`)
        : bad(`${total} facts under column-backed keys: ${rows.map((r) => `${r.field_key} ${r.n}`).join(", ")}`);
    },
  },
  {
    name: "enum_values_in_domain",
    findings: "N35",
    needsDb: true,
    // Covers `ls` as well as `e`. The scan that first measured this filtered `type === "e"` and undercounted,
    // which is the same predicate that blinded the German coverage check — one wrong filter, two instruments.
    // VENDOR SCOPE (reviewer ruling, 29 Sep 2026): the same two lines as vendor_coverage -- a CISCO line that judges and a
    // BRAND-WIDE line that is printed. Another lane's out-of-domain facts are that lane's to fix, so they cannot turn this
    // lane red, and they cannot vanish from the output either.
    run: async () => {
      const keys = Object.entries(FIELD_DICTIONARY)
        .filter(([, d]) => ["e", "ls"].includes((d as { type?: string }).type ?? "")).map(([k]) => k);
      const rows = (await query<{ vendor: string; cat: string; key: string; value: string; n: string }>(`
        SELECT v.slug vendor, c.slug cat, f.field_key key, f.value::text value, count(*)::text n
          FROM facts f JOIN parts p ON p.id=f.part_id JOIN categories c ON c.id=p.category_id JOIN vendors v ON v.id=p.vendor_id
         WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL
           AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL AND f.value IS NOT NULL
         GROUP BY 1,2,3,4`, [keys])).rows;
      type Side = { out: number; total: number; byKey: Map<string, number> };
      const own: Side = { out: 0, total: 0, byKey: new Map() }, all: Side = { out: 0, total: 0, byKey: new Map() };
      for (const r of rows) {
        const n = Number(r.n), sides = r.vendor === OWN_VENDOR ? [own, all] : [all];
        for (const s of sides) s.total += n;
        let v: unknown; try { v = JSON.parse(r.value); } catch { v = r.value; }
        const vals = Array.isArray(v) ? v : [v];
        const dom = domainFor(r.cat, r.key) ?? (FIELD_DICTIONARY[r.key] as { domain?: string[] }).domain ?? [];
        if (!dom.length) continue;
        if (vals.every((x) => typeof x === "string" && dom.includes(x))) continue;
        for (const s of sides) { s.out += n; s.byKey.set(r.key, (s.byKey.get(r.key) ?? 0) + n); }
      }
      const worst = (s: Side) => [...s.byKey].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ");
      // THE SHAPE-DEFINED LIST CUPS. certifications, ieee_standards, supported_protocols and emc_emissions have no domain --
      // a registered SHAPE (src/core/listShapes.ts) is their definition -- so the domain loop skips them. Their members are
      // classified by the shape's own grammar. Ruled 29 Sep 2026: a REFUSED member fails the Cisco line (the grammar says it
      // is junk); UNCLASSIFIED is a ratchet -- printed, may not grow past the committed ceiling, and the ceiling only ever
      // falls (--record-shape-ceiling writes min(ceiling, now), so recording cannot launder growth); FLAGGED (truncation,
      // bullet residue) is reported and never failed. A missing or unreadable ceiling file is red: could not check is not a pass.
      const shapeKeys = Object.keys(LIST_SHAPES);
      const blank = (): Record<MemberVerdict, number> => ({ accept: 0, refuse: 0, flagged: 0, unclassified: 0 });
      const shOwn = new Map<string, Record<MemberVerdict, number>>(), shAll = new Map<string, Record<MemberVerdict, number>>();
      for (const r of (await query<{ vendor: string; key: string; value: string; n: string }>(`
          SELECT v.slug vendor, f.field_key key, f.value::text value, count(*)::text n
            FROM facts f JOIN parts p ON p.id=f.part_id JOIN vendors v ON v.id=p.vendor_id
           WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
             AND p.retired_at IS NULL AND f.value IS NOT NULL GROUP BY 1,2,3`, [shapeKeys])).rows) {
        let v: unknown; try { v = JSON.parse(r.value); } catch { v = r.value; }
        const maps = r.vendor === OWN_VENDOR ? [shOwn, shAll] : [shAll];
        for (const m of Array.isArray(v) ? v : [v]) {
          const verdict = classifyMember(r.key, String(m));
          for (const mp of maps) { const t = mp.get(r.key) ?? blank(); t[verdict] += Number(r.n); mp.set(r.key, t); }
        }
      }
      const shapes = (mp: Map<string, Record<MemberVerdict, number>>) => shapeKeys.map((k) => { const t = mp.get(k);
        return t ? `${k} accept ${t.accept} / refuse ${t.refuse} / flagged ${t.flagged} / unclassified ${t.unclassified}` : `${k} holds no facts`; }).join("; ");
      // NOT data/completeness/: every *.json there IS a vendor to /v1/completeness and tests/completeness.test.ts (VENDOR_FILE),
      // so a ratchet file in that directory became a vendor called "shape-unclassified-ceiling" (build 63bae82, suite crashed).
      const CEIL = path.join(REPO, "data", "ratchets", "shape-unclassified-ceiling-cisco.json");
      const nowUnc: Record<string, number> = Object.fromEntries(shapeKeys.map((k) => [k, shOwn.get(k)?.unclassified ?? 0]));
      type Ceil = { vendor: string; unit: string; recorded_at: string; git_sha: string; ceiling: Record<string, number> };
      let ceil: Ceil | null = null, ceilErr = "";
      try { if (existsSync(CEIL)) ceil = JSON.parse(readFileSync(CEIL, "utf8")) as Ceil; else ceilErr = `no ceiling file at ${path.relative(REPO, CEIL)}`; }
      catch (e) { ceilErr = `the ceiling file is unreadable: ${e instanceof Error ? e.message : String(e)}`; }
      if (!ceilErr && (ceil?.vendor !== OWN_VENDOR || typeof ceil?.ceiling !== "object")) ceilErr = `the ceiling file is not a ${OWN_VENDOR} ceiling`;
      if (process.argv.includes("--record-shape-ceiling")) {
        const merged = Object.fromEntries(shapeKeys.map((k) => [k, Math.min(nowUnc[k], ceil?.ceiling?.[k] ?? Infinity)]));
        ceil = { vendor: OWN_VENDOR, unit: "unclassified MEMBERS (fact-weighted) of live facts on live parts", recorded_at: new Date().toISOString(),
          git_sha: process.env.GIT_SHA ?? "unknown", ceiling: merged };
        mkdirSync(path.dirname(CEIL), { recursive: true });
        writeFileSync(CEIL, JSON.stringify(ceil, null, 2) + "\n");
        ceilErr = "";
      }
      const grown = ceilErr ? [] : shapeKeys.filter((k) => nowUnc[k] > (ceil!.ceiling[k] ?? 0))
        .map((k) => `${k} ${nowUnc[k]} > ceiling ${ceil!.ceiling[k] ?? 0}`);
      const refused = shapeKeys.map((k) => [k, shOwn.get(k)?.refuse ?? 0] as const).filter(([, n]) => n > 0);
      const ratchet = ceilErr ? `unclassified ratchet: ${ceilErr}` : `unclassified ratchet (ceiling ${ceil!.git_sha.slice(0, 7)}): ` +
        shapeKeys.map((k) => `${k} ${nowUnc[k]}/${ceil!.ceiling[k] ?? 0}`).join(", ");
      const brand = `BRAND-WIDE (printed, not judged): ${all.out} of ${all.total} facts outside their domain${all.out ? ` — ${worst(all)}` : ""}; shape members: ${shapes(shAll)}`;
      const line = `${OWN_VENDOR.toUpperCase()}: ${own.out} of ${own.total} facts outside their domain${own.out ? ` — ${worst(own)}` : ""}; ` +
        `shape members: ${shapes(shOwn)}; ${ratchet} || ${brand}`;
      const fails = [own.out ? `${own.out} out-of-domain facts` : "", refused.length ? `refused shape members ${refused.map(([k, n]) => `${k} ${n}`).join(", ")}` : "",
        ceilErr ? "no readable unclassified ceiling" : "", grown.length ? `unclassified grew: ${grown.join(", ")}` : ""].filter(Boolean);
      return fails.length ? bad(`${fails.join("; ")} — ${line}`) : ok(line);
    },
  },
  {
    name: "layer_parity_db_vs_artifact",
    findings: "N59, N60, N1",
    needsDb: true,
    // Reports rather than asserts a threshold: the disagreement is real (91.1%) and the repair is disputed,
    // so a red here would be noise until that decision lands. It fails only if the COMPARISON breaks — a
    // zero-overlap result, which is the shape a broken join makes, not a shape the data can make.
    // RULING (e), 29 Sep 2026: compare LAYER TO LAYER. The first version compared `parts.series` -- the platform axis, N59 --
    // with the artefact's layer-4 `series`, measured 91.1% "disagreement" that was two different questions, and was parked
    // as UNAVAILABLE. The database carries the layers now (product_line, product_series, written by write-layers-to-db), so
    // each is compared with the artefact column of the same meaning, exactly as db_site_api_parity reads them.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const dir = path.join(REPO_ROOT, "data", "layers");
      let rows = 0, files = 0;
      const diffs: string[] = [];
      const byLayer = { product_line: 0, product_series: 0 };
      for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("cisco-") && x.endsWith(".rows.tsv"))) {
        const cat = f.slice("cisco-".length, -".rows.tsv".length);
        const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
        const h = L[0].split("\t"), ci = (n: string) => h.indexOf(n);
        if (ci("sku") < 0 || ci("series") < 0 || ci("product_line") < 0) continue;
        files++;
        const art = new Map<string, LayerRow>();
        for (const l of L.slice(1)) { const c = l.split("\t"); art.set(c[ci("sku")], { product_line: c[ci("product_line")], product_series: c[ci("series")] }); }
        const db = (await query<{ sku: string; product_line: string | null; product_series: string | null }>(`
          SELECT p.sku, p.product_line, p.product_series FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
           WHERE v.slug='cisco' AND c.slug=$1 AND p.retired_at IS NULL AND p.sku = ANY($2::text[])`, [cat, [...art.keys()]])).rows;
        for (const d of db) {
          rows++;
          const off = layerRowDiff({ product_line: d.product_line, product_series: d.product_series }, art.get(d.sku)!);
          for (const k of off) byLayer[k]++;
          if (off.length && diffs.length < 6) diffs.push(`${cat}/${d.sku} (${off.join(", ")})`);
        }
      }
      if (!rows) return na(`${files} layer files read and 0 parts matched — a broken join, not a finding`);
      const n = byLayer.product_line + byLayer.product_series;
      const scope = `${rows.toLocaleString()} placed parts across ${files} categories; product_line vs the artefact's product_line, `
        + `product_series vs its layer-4 series (empty and null read as one value)`;
      return n === 0
        ? ok(`the database's layers are the artefact's — ${scope}`)
        : bad(`${byLayer.product_line} product_line and ${byLayer.product_series} product_series values differ from the built artefact — ${scope}: ${diffs.join(", ")}`);
    },
    selfTest: async () => {
      const art = { product_line: "Catalyst", product_series: "Catalyst 9300" };
      return { negative: layerRowDiff({ product_line: "Catalyst", product_series: "Catalyst 9200" }, art).length === 0,
               positive: layerRowDiff({ product_line: "Catalyst", product_series: "Catalyst 9300" }, art).length === 0,
               note: "a part whose product_series is not its artefact's layer 4 must differ; an identical one must agree" };
    },
  },

  // ---- declared, NOT YET WRITTEN. Named so the output can never imply coverage it does not have. ------------------
  {
    name: "one_build",
    findings: "N19, N38, N45, N61",
    // THE ROOT CAUSE the reviewer names: the site is built from reference JSON, the API from the DB and
    // completeness from a third snapshot, and nothing fails when they diverge. A build commit is recorded
    // under THREE different field names across the artefact set, which is itself part of why nobody noticed:
    // a reader checking `built_on_commit` sees agreement and never looks at the file that says `commit`.
    // The contract hash half cannot pass yet — there is no mould-contract.json — and that is reported as
    // UNAVAILABLE rather than quietly scored on the commit half alone.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const FIELDS = ["built_on_commit", "built_on_parent_commit", "commit"];
      const DIRS = ["ledger", "census", "completeness", "freeze", "layers", "mapper", "schema"];
      const byCommit = new Map<string, string[]>();
      const noField: string[] = [];
      const legacyOnly: string[] = [];      // carries a commit but no contract hash: the migration's remainder
      const noHash: string[] = [];          // has a build object with no contract hash: a stamp that says less than it should
      const hashes = new Set<string>();
      for (const d of DIRS) {
        const dir = path.join(REPO_ROOT, "data", d);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
          const rel = `data/${d}/${name}`;
          let j: Record<string, unknown>;
          try { j = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
          if (typeof j !== "object" || j === null || Array.isArray(j)) continue;
          // THE `build` OBJECT WINS OVER EVERY LEGACY FIELD, and this is a STRENGTHENING rather than
          // a loosening: it carries a contract hash the legacy names never had, so a set of artefacts
          // that agree on a commit can now still fail for disagreeing about the MOULD. The legacy
          // fields stay readable because deleting them would break whatever still reads them, and the
          // migration is measured by scripts/mould-stamp.mts --check rather than assumed finished.
          const b = j.build as { data_commit?: string; contract_hash?: string } | undefined;
          if (b && typeof b.data_commit === "string") {
            const c = b.data_commit.slice(0, 7);
            byCommit.set(c, [...(byCommit.get(c) ?? []), rel]);
            if (typeof b.contract_hash === "string") hashes.add(b.contract_hash);
            else noHash.push(rel);
            continue;
          }
          const f = FIELDS.find((k) => typeof j[k] === "string");
          if (!f) { noField.push(rel); continue; }
          legacyOnly.push(rel);
          const c = String(j[f]).slice(0, 7);
          byCommit.set(c, [...(byCommit.get(c) ?? []), rel]);
        }
      }
      const commits = [...byCommit.keys()];
      const contract = fs.existsSync(path.join(REPO_ROOT, "src", "core", "mould-contract.json"));
      if (!commits.length) return na("no artefact records a build commit at all");
      const spread = commits.map((c) => `${c} (${byCommit.get(c)!.length} files)`).join(", ");
      if (commits.length > 1) {
        const odd = commits.sort((a, b) => byCommit.get(a)!.length - byCommit.get(b)!.length)[0];
        return bad(`${commits.length} DIFFERENT build commits across the artefacts: ${spread}`
          + ` — the smallest is ${odd}: ${byCommit.get(odd)!.slice(0, 4).join(", ")}`
          + `; ${noField.length} artefacts record no build field at all`
          + `; contract hash ${contract ? "present" : "NOT POSSIBLE — no src/core/mould-contract.json exists"}`);
      }
      if (!contract) {
        return na(`all artefacts agree on ${commits[0]}, but there is no mould-contract.json, so the ` +
          `contract-hash half of this test cannot run`);
      }
      // THE CONTRACT-HASH HALF, which the legacy fields could never answer. Two artefacts built from
      // one commit can still disagree about the MOULD -- edit a profile, rebuild one file, and the
      // commit matches while the meaning has moved. Until 27 Sep this half reported NOT POSSIBLE.
      if (hashes.size > 1) {
        return bad(`one build commit ${commits[0]}, but ${hashes.size} DIFFERENT contract hashes across ` +
          `the artefacts [${[...hashes].join(", ")}] — same code, different MOULD, which is the drift a ` +
          `commit cannot see`);
      }
      // THE MOULD THE CODE STATES NOW. Agreement among the artefacts is not agreement with the mould: the contract had drifted
      // since 28 Sep (608 -> 610 dictionary keys, the ports role, the Batch C profiles) while every artefact carried the stale
      // hash in unison, so this reported ONE build over a mould that no longer existed. Found by `mould:contract --check` on
      // 29 Sep, not by this board.
      const { mouldContract } = await import("../src/core/mouldContract.js");
      const drift = contractDrift([...hashes][0], mouldContract().contract_hash);
      if (drift) return bad(`${drift} — across ${byCommit.get(commits[0])!.length} artefacts (npm run mould:contract, rebuild, restamp)`);
      const remainder = legacyOnly.length + noHash.length;
      if (remainder > 0) {
        return bad(`one build commit ${commits[0]} and one contract hash ${[...hashes][0] ?? "(none)"}, but ` +
          `${legacyOnly.length} artefacts still carry only a LEGACY field and ${noHash.length} a build ` +
          `object with no contract hash — so ${remainder} of ${byCommit.get(commits[0])!.length} cannot be ` +
          `checked against the mould they were built from`);
      }
      return ok(`ONE build: commit ${commits[0]}, contract hash ${[...hashes][0]} (the one the code computes now), across ` +
        `${byCommit.get(commits[0])!.length} artefacts, every one carrying both`);
    },
    // Through the REAL mouldContract: the stale hash every artefact carried until 29 Sep must be refused against the code's, and
    // the code's hash computed twice must agree with itself (a nondeterministic hash would make every verdict here noise).
    selfTest: async () => {
      const { mouldContract } = await import("../src/core/mouldContract.js");
      const a = mouldContract().contract_hash, b = mouldContract().contract_hash;
      return { negative: contractDrift("bcfc4c1ee314d3c2", a) === null, positive: a === b && contractDrift(a, b) === null,
               note: "the 28 Sep contract hash must be refused against the code's; the code's own hash must agree with itself" };
    },
  },
  {
    name: "db_site_api_parity",
    findings: "N1, N59, N60",
    needsDb: true,
    // THE NEGATIVE FIXTURE FOR THE THIRD LEG. The other two legs compare files with the database and can be
    // sabotaged by editing a file; this one compares the API RECORD with the columns, and the way it fails in
    // real life is a field the record stops carrying — a serialiser dropping it, a schema not declaring it
    // (Fastify strips an undeclared key, which is how two layer fields reached nothing on the very day they were
    // "verified" by calling the builder), or a deployment behind the columns. So the break is staged AT THE
    // RECORD: one part's bucket is taken away and the comparison must name that part.
    //
    // The positive twin runs the same comparison untouched and must find nothing, so a fixture that fails for
    // its own reasons cannot pass as a caught sabotage.
    selfTest: async () => {
      const { partRecords } = await import("../src/api/queries/part.js");
      const { RENDERED_STATES } = await import("../src/api/queries/shared.js");
      const row = (await query<{ id: number; sku: string; product_line: string | null; product_series: string | null; bucket: string[] | null }>(`
        SELECT p.id, p.sku, p.product_line, p.product_series, p.bucket FROM parts p JOIN vendors v ON v.id=p.vendor_id
         WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.bucket IS NOT NULL LIMIT 1`)).rows[0];
      if (!row) return { negative: false, positive: false, note: "no part carries a bucket, so the break cannot be staged" };
      const recs = await partRecords([row.id], [...RENDERED_STATES], "x") as unknown as
        { sku: string; product_line: string | null; product_series: string | null; bucket: string[] | null }[];
      const compare = (r: typeof recs[0]) =>
        r.product_line !== row.product_line || r.product_series !== row.product_series ||
        (r.bucket ?? []).join("|") !== (row.bucket ?? []).join("|");
      // Both values answer ONE question in the harness's polarity: DID THIS INPUT AGREE? The broken one must not
      // (negative false), the untouched one must (positive true). Written the other way round the first time --
      // reporting "the break was caught" as `negative: true` -- and the harness correctly called it BROKEN, which
      // is the run that proves the harness is not decorative.
      const agrees = (r: typeof recs[0]) => !compare(r);
      const positive = agrees(recs[0]);                                // untouched: the record and the column agree
      const negative = agrees({ ...recs[0], bucket: null });           // the field taken away: must NOT agree
      return { negative, positive, note: `${row.sku}: with its bucket dropped the record still agrees = ${negative} (must be false); untouched agrees = ${positive}` };
    },
    // 500 SEEDED SKUs so two runs compare the same rows and a moved number means the DATA moved. The reviewer
    // asked for the per-category counts to be PRINTED by the test rather than estimated, because that number
    // is the dry-run count for the write plans — an estimate would become a plan nobody could check.
    //
    // WHAT THIS TEST CANNOT SEE, measured rather than assumed. The sample is drawn from the layer artifact's
    // own key set, so it can only ever check parts the layering already places. Asking "how many live cisco
    // hardware parts does the layering miss" returns 41,067 of 41,067 — EXACTLY zero, which is the shape of a
    // population compared with itself, and it is: the layer build's population IS live cisco hardware, so the
    // answer is a tautology and not a reassurance. The real blind spot is everything outside that class —
    // 10,547 live cisco `software` parts, and 3,476 live hardware parts across the other vendors — none of
    // which any layer test here can sample. `vendor_coverage` carries that half.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const { partRecords } = await import("../src/api/queries/part.js");
      const { RENDERED_STATES } = await import("../src/api/queries/shared.js");
      let seed = 20260927;                                    // seeded, not Math.random: comparable across runs
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const art = new Map<string, { cat: string; series: string; nav: string; line: string }>();
      const dir = path.join(REPO_ROOT, "data", "layers");
      let noNav = 0;
      for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("cisco-") && x.endsWith(".rows.tsv"))) {
        const cat = f.slice("cisco-".length, -".rows.tsv".length);
        const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
        const h = L[0].split("\t"), ci = (n: string) => h.indexOf(n);
        if (ci("sku") < 0 || ci("series") < 0 || ci("product_line") < 0) continue;
        // A PRE-27-SEP ARTEFACT IS COUNTED, NOT SKIPPED. Before the format change the navigation construct
        // lived in the `series` column, so a file without `nav_bucket` cannot be compared against the
        // database's split at all — and a silent skip would shrink the denominator, which is the defect this
        // whole board was built to catch.
        if (ci("nav_bucket") < 0) { noNav++; continue; }
        for (const l of L.slice(1)) {
          const c = l.split("\t");
          art.set(c[ci("sku")], { cat, series: c[ci("series")], nav: c[ci("nav_bucket")] ?? "", line: c[ci("product_line")] });
        }
      }
      if (noNav) return bad(`${noNav} layer artefact(s) have no nav_bucket column — a pre-27-Sep format that cannot be compared with the split columns; rebuild with scripts/build-layers.mts`);
      const all = [...art.keys()];
      if (all.length < 500) return na(`only ${all.length} placed parts — cannot draw a 500 sample`);
      const pick = new Set<string>();
      while (pick.size < 500) pick.add(all[Math.floor(rnd() * all.length)]);
      const skus = [...pick];
      const ids = (await query<{ id: number; sku: string; series: string | null; product_series: string | null;
                                 product_line: string | null; bucket: string[] | null }>(`
        SELECT p.id, p.sku, p.series, p.product_series, p.product_line, p.bucket FROM parts p JOIN vendors v ON v.id=p.vendor_id
         WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.sku = ANY($1::text[])`, [skus])).rows;
      const dbBySku = new Map(ids.map((r) => [r.sku, r]));
      if (!ids.length) return na(`0 of 500 sampled SKUs resolved in the DB — a broken join, not a finding`);
      const recs = await partRecords(ids.map((r) => r.id), [...RENDERED_STATES], "https://api.netzspec.com/v1") as unknown as
        { sku: string; product_line: string | null; product_series: string | null; series: string | null; bucket: string[] | null }[];
      // THE THIRD LEG, and until 27 Sep 2026 it was not measured at all. This test compared the DB column with the
      // layer page and called itself parity, while the record hexwaren actually consumes was built from the page
      // through layerOf() — so the API could disagree with the database and nothing here would notice. The reviewer
      // found it by reading the DEPLOYED API: HCI-CPU-I6454S and CAB-TA-UK served `product_series: "… shared parts"`,
      // the shape parts_series_not_bucket_check refuses, on a database that was right.
      //
      // This leg admits NO exclusion. The record now selects the columns, so any difference is a serialiser dropping
      // a field, a schema that does not declare one (Fastify strips an undeclared key — that is how two layer fields
      // reached nothing on the same day they were "verified" by calling the builder), or a stale deployment.
      const apiVsDb: string[] = [];
      for (const r of recs) {
        const d = dbBySku.get(r.sku); if (!d) continue;
        const b = (r.bucket ?? []).join("|"), db = (d.bucket ?? []).join("|");
        if (r.product_line !== d.product_line) apiVsDb.push(`${r.sku} line api=${r.product_line} db=${d.product_line}`);
        else if (r.product_series !== d.product_series) apiVsDb.push(`${r.sku} series api=${r.product_series} db=${d.product_series}`);
        else if (b !== db) apiVsDb.push(`${r.sku} bucket api=[${b}] db=[${db}]`);
      }
      if (apiVsDb.length) {
        return bad(`the API RECORD disagrees with the DB columns on ${apiVsDb.length} of ${recs.length} sampled parts — ` +
          `this leg has no exclusion, because the record now selects the columns: ${apiVsDb.slice(0, 5).join("; ")}`);
      }
      const byCat = new Map<string, { n: number; seriesDiff: number; legacyDiff: number; bucketDiff: number; navRows: number; lineMissing: number }>();
      for (const r of recs) {
        const a = art.get(r.sku); if (!a) continue;
        const e = byCat.get(a.cat) ?? { n: 0, seriesDiff: 0, legacyDiff: 0, bucketDiff: 0, navRows: 0, lineMissing: 0 };
        e.n++;
        // TWO COLUMNS, TWO QUESTIONS, AND ONLY ONE OF THEM IS THE LAYER. `product_series` is the
        // layer, written from these very artefacts, so a difference here means the WRITE did not
        // land -- a missed row, a bad join (the first run mis-joined 20 parts across vendors), or a
        // page built from a different artefact version. That is what this test is for.
        //
        // `p.series` is the legacy PLATFORM column and answers a different question: on a component
        // it names the platform the part belongs to while the artefact names a layering bucket. It
        // disagrees on ~78% and a dry run measured that repairing it from the artefact would be
        // right for 21% of rows and wrong for 79%. So its divergence is counted and REPORTED, never
        // judged -- folding it into the parity verdict would make this test permanently red for a
        // reason that is not a defect.
        const dbRow = dbBySku.get(r.sku);
        // THE EXCLUSION IS GONE, DELETED RATHER THAN BOUNDED (reviewer's ruling, 27 Sep 2026). It used to
        // sit here as a ceiling of 68: the artefact wrote a navigation construct ("HyperFlex shared parts")
        // into its `series` column for 5,806 rows while the database refused that shape and held null, so
        // the two disagreed BY CONSTRUCTION. No republish could ever have closed it — the artefact is
        // UPSTREAM of the columns, so a rebuild re-derived the same construct into the same column — which
        // is why the fix had to be a format change: the build now emits `nav_bucket` and leaves `series`
        // empty on those rows, exactly as `parts` has held them all along.
        //
        // So both are compared, strictly, with no exclusion anywhere: layer 4 against layer 4, and the
        // bucket against the bucket. A bounded exclusion is a debt; this is the commit that paid it.
        if ((dbRow?.product_series ?? "") !== (a.series ?? "")) e.seriesDiff++;         // layer 4 vs layer 4
        if ((dbRow?.bucket ?? []).join("|") !== (a.nav ?? "")) e.bucketDiff++;          // bucket vs bucket
        if (a.nav) e.navRows++;                                                         // reported, not excluded
        if ((dbRow?.series ?? "") !== (a.series ?? "")) e.legacyDiff++;   // the legacy platform column: reported only
        if (r.product_line !== a.line) e.lineMissing++;                                       // API record vs layer page
        byCat.set(a.cat, e);
      }
      const checked = [...byCat.values()].reduce((n, e) => n + e.n, 0);
      const sDiff = [...byCat.values()].reduce((n, e) => n + e.seriesDiff, 0);
      const lDiff = [...byCat.values()].reduce((n, e) => n + e.lineMissing, 0);
      const legacy = [...byCat.values()].reduce((n, e) => n + e.legacyDiff, 0);
      const bDiff = [...byCat.values()].reduce((n, e) => n + e.bucketDiff, 0);
      const navRows = [...byCat.values()].reduce((n, e) => n + e.navRows, 0);
      const perCat = [...byCat].sort((a, b) => b[1].seriesDiff - a[1].seriesDiff)
        .map(([c, e]) => `${c} ${e.seriesDiff}/${e.n}`).join(", ");
      if (sDiff === 0 && lDiff === 0 && bDiff === 0) return ok(`${checked} sampled SKUs, THREE LEGS AND NO EXCLUSION ANYWHERE: the API RECORD matches the DB columns on line, series and bucket for all ${recs.length} (that leg was unmeasured until 27 Sep — the record read the layer FILE, so the API could disagree with the database and nothing here would see it); and the layer PAGE matches the DB on layer 4 and on the bucket, including all ${navRows} sampled rows that sit in a navigation bucket rather than a series` +
        ` — the 68-row exclusion is DELETED, not bounded: the artefact used to write the construct into its series column and no republish could close that, because the build is upstream of the columns, so the fix was a format change (nav_bucket split out, bucket renamed placement) with the freeze regenerated on the same commit` +
        ` — separately, the legacy p.series platform column differs from the page on ${legacy} of ${checked}, which is a different question and not a defect (docs/decisions, 27 Sep: repairing it would be right for 21% and wrong for 79%)`);
      return bad(`${checked} sampled: series DB-vs-page differs on ${sDiff} (${(100 * sDiff / checked).toFixed(1)}%), bucket DB-vs-page on ${bDiff}, `
        + `product_line API-vs-page differs on ${lDiff}. PER-CATEGORY (the dry-run count for any series write): ${perCat}`);
    },
  },
  {
    name: "ledger_parity",
    findings: "N45",
    // Honestly unavailable rather than quietly absent: there is no /v1/ledger route at HEAD to compare against,
    // so this cannot be run here at all — and saying so is the point of the UNAVAILABLE state.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      // It tested for src/api/routes/ledger.ts, which has NEVER existed, and reported UNAVAILABLE for the
      // wrong reason - "no route" when the route is registered in start.ts and /v1/ledger answers 200. An
      // unavailable verdict with a false cause is worse than none: it sent the reviewer hunting a deleted
      // endpoint. Look for the REGISTRATION, not for a filename I assumed.
      const start = path.join(REPO_ROOT, "src", "api", "routes", "start.ts");
      const registered = fs.existsSync(start) && fs.readFileSync(start, "utf8").includes("/ledger/");
      if (!registered) return na("no /v1/ledger registration found in src/api/routes/start.ts");
      // RULING (e), 29 Sep 2026: CALL THE SERVICE. Every committed ledger is asked of the deployed API as
      // /v1/ledger/<vendor>/<category> and compared, canonically, with the file in this tree -- the served ledger must BE the
      // committed one. Could-not-check stays its own verdict: no key, or no answer, is NOT EXERCISED, never a pass.
      if (!process.env.NETZSPEC_API_KEY) return none("the ledgers need the deployed service and a key; NETZSPEC_API_KEY is not set here (key 17 lives in /root/netzspec-verifier.env on the box)");
      const BASE = process.env.NETZSPEC_API ?? "https://api.netzspec.com";
      const dir = path.join(REPO_ROOT, "data", "ledger");
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${OWN_VENDOR}-`) && f.endsWith(".json"));
      const differ: string[] = [], unread: string[] = [];
      for (const f of files) {
        const cat = f.slice(OWN_VENDOR.length + 1, -".json".length);
        let served: unknown = null;
        try {
          const res = await fetch(`${BASE}/v1/ledger/${OWN_VENDOR}/${cat}`, { headers: apiHeaders(), signal: AbortSignal.timeout(30_000) });
          if (res.status !== 200) { unread.push(`${cat} -> ${res.status}`); continue; }
          served = await res.json();
        } catch (e) { unread.push(`${cat}: ${e instanceof Error ? e.message : String(e)}`); continue; }
        if (!sameLedger(served, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) differ.push(cat);
      }
      const scope = `${files.length} committed ${OWN_VENDOR} ledgers asked of ${BASE}; ${files.length - differ.length - unread.length} identical, ${differ.length} differ, ${unread.length} unread`;
      if (differ.length) return bad(`the deployed service serves a DIFFERENT ledger than this tree commits for ${differ.join(", ")} — ${scope}`);
      if (unread.length) return none(`${unread.length} ledgers could not be read from the service — ${scope}: ${unread.slice(0, 4).join(", ")}`);
      return ok(`every served ledger is the committed one — ${scope}`);
    },
    selfTest: async () => {
      const a = { category: "switches", kinds: { chassis: { required: ["weight", "dimensions"] } } };
      return { negative: sameLedger(a, { category: "switches", kinds: { chassis: { required: ["weight"] } } }),
               positive: sameLedger(a, { kinds: { chassis: { required: ["weight", "dimensions"] } }, category: "switches" }),
               note: "a ledger missing one required cup must differ; the same ledger with its keys in another order must match" };
    },
  },
  {
    name: "kind_profile_parity",
    findings: "B1",
    needsDb: true,
    // A KIND IS ONE THING. `power-supply` asks the same questions whether it sits under `routers` or
    // `switches`; a cup that differs between two categories for the SAME kind is either a real
    // distinction somebody decided, or -- far more often -- a profile that was edited in one place
    // and not the other. Today nothing can tell those apart, because there is nowhere to record the
    // decision: `kindProfiles.ts` with its {cup, reason, witness} exceptions is B4 and does not exist.
    //
    // So this test is EXPECTED to be red, and its value is the list: it names every divergent kind
    // with the cups that differ, which is the input B4 needs. A red that names a real defect stays
    // red (R4) -- this one must not be made green by widening it.
    //
    // Resolution goes through requirementFor on a synthetic part carrying ONLY the kind, which is how
    // the API resolves a cup for a part whose other values are unknown. Anything a category adds on
    // top of kind (a series gate, a deploy role) is deliberately out of frame: the question is whether
    // the KIND alone is asked the same things.
    run: async () => {
      const { pairs, note } = await kindPairsWithParts();
      if (!pairs.length) return none(`no (category, kind) pair holds a live part — ${note}`);
      const byKind = new Map<string, { cat: string; sets: Record<string, string[]> }[]>();
      for (const { category, kind } of pairs) {
        const sets = resolveFourSets(category, kind);
        const list = byKind.get(kind) ?? [];
        list.push({ cat: category, sets });
        byKind.set(kind, list);
      }
      // THE EVIDENCE COLUMN (reviewer ruling, 29 Sep 2026): the documents behind each side, beside the diff, so "one of you is
      // wrong" (some side holds a spec sheet) and "neither of you can know yet" (no side does: an acquisition work order) are
      // different lines. Read from the completeness report -- the progress surface's own held.spec_bearing -- and when the
      // report cannot be read the column says so; it never decides the verdict, which stays "no unruled divergence".
      const rep = readCompleteness(OWN_VENDOR);
      const held = new Map<string, { parts: number; spec: number }>();
      for (const c of rep?.categories ?? []) for (const k of c.kinds ?? []) held.set(`${c.category}|${k.kind}`, { parts: k.hardware_parts, spec: k.held.spec_bearing });
      const evidence = (kind: string, cats: string[]) => cats.map((c) => { const h = held.get(`${c}|${kind}`); return h ? `${c} ${h.spec}/${h.parts} spec-bearing` : `${c} (no report row)`; }).join(", ");
      const wrong: string[] = [], cannotKnow: string[] = [];
      const divergent: string[] = [];
      const ruledOut: string[] = [];
      const byCause = new Map<string, string[]>();
      let compared = 0, singleCategory = 0, notAKind = 0, unclassified = 0;
      for (const [kind, rows] of byKind) {
        if (rows.length < 2) { singleCategory++; continue; }   // nothing to compare: not a pass either
        // NOT A KIND. `unknown` is what partKind returns when it cannot classify, so comparing its cup
        // sets across ten categories asks whether two UNCLASSIFIED populations are asked the same
        // things. `unknown_zero` owns that population and its fix is classification. Excluded IN THE
        // OUTPUT rather than silently filtered -- an exclusion nobody can see grow is where the next
        // real break hides, which is this file's own argument two tests over.
        if (NOT_A_KIND.has(kind)) { notAKind++; continue; }
        compared++;
        const first = rows[0];
        const diffs: string[] = [];
        /** EVERY cup that differs anywhere in this kind, not just the first pair's -- a ruling has to be
         *  checked against all of them, or a divergence that grew a cup keeps an old approval. */
        const diffCups = new Set<string>();
        for (const other of rows.slice(1)) {
          // ONLY THE BUCKETS THAT CREATE WORK, AND NEVER A COLUMN. Measured 27 Sep: the unrefined
          // comparison reported 34 divergent kinds; scoped to hardware it is 26, and excluding
          // COLUMN_BACKED keys it is 19. A column-backed key is not a cup a crawler fills -- it is a
          // column -- which is exactly why required_cup_defined skips them, and `fan` differing on
          // `series` and `vendor` between two categories is not a parity defect, it is two columns.
          //
          // The 19 that survive are substantive: a meraki `appliance` is asked concurrent_sessions,
          // firewall_throughput, ipsec_throughput, mounting, ports, psu_options and threat_throughput
          // that a security `appliance` is not. That is the exceptions table B4 needs, and it is worth
          // reading BECAUSE it is 19 and not 34.
          for (const bucket of ["req", "pending"]) {
            const a = new Set(first.sets[bucket].filter((k) => !COLUMN_BACKED.has(k)));
            const b = new Set(other.sets[bucket].filter((k) => !COLUMN_BACKED.has(k)));
            const onlyA = [...a].filter((k) => !b.has(k)), onlyB = [...b].filter((k) => !a.has(k));
            for (const k of [...onlyA, ...onlyB]) diffCups.add(k);
            if (onlyA.length || onlyB.length) {
              diffs.push(`${bucket}: ${first.cat} has ${onlyA.length ? onlyA.slice(0, 4).join("/") : "—"}` +
                         `, ${other.cat} has ${onlyB.length ? onlyB.slice(0, 4).join("/") : "—"}`);
            }
          }
        }
        if (diffs.length) {
          // A SETTLED RULING DROPS OUT; AN UNRULED DIVERGENCE DOES NOT, AND NEITHER DOES ONE THAT HAS
          // GROWN A NEW CUP SINCE ITS RULING. kindProfiles.parityRuled requires EVERY differing cup to
          // be covered and the ruling's categories to be among the ones that differ, so an approval
          // written for `transceiver` cannot excuse a divergence between two other categories.
          // A ruling covers ONLY the categories it names (Q3, 29 Sep 2026): the rest must give one answer, read from the sets
          // resolved above, so the ruling check and the diff it excuses can never use two different resolutions.
          const asks = (cat: string, cup: string): string => {
            const s = rows.find((x) => x.cat === cat)?.sets;
            return s?.req.includes(cup) ? "req" : s?.pending.includes(cup) ? "pending" : "no";
          };
          const r = parityRuled(kind, [...diffCups], rows.map((x) => x.cat), asks);
          if (r.ruled) { ruledOut.push(`${kind} (${r.by?.witness})`); continue; }
          // The CAUSE, from the register, so the failure says what work it needs instead of repeating a
          // list. A divergence in neither half is its own finding: nobody has classified it.
          const causes = parityCause(kind);
          const cause = causes.length ? causes.map((c) => c.cause).join("+") : "UNCLASSIFIED";
          if (!causes.length) unclassified++;
          byCause.set(cause, [...(byCause.get(cause) ?? []), kind]);
          // THE FULL GROUPING per uncovered cup, never `diffs[0]`: on 29 Sep the first pair printed here was the one pair
          // already ruled, and the unruled split was nowhere on the line (kindProfiles.formatParitySplit).
          const line = `${kind} [${cause}] ${r.split.slice(0, 6).map(formatParitySplit).join("; ")}` +
            (r.split.length > 6 ? ` … +${r.split.length - 6} cups` : "") +
            ` {evidence: ${evidence(kind, rows.map((x) => x.cat))}}`;
          divergent.push(line);
          (rows.some((x) => (held.get(`${x.cat}|${kind}`)?.spec ?? 0) > 0) ? wrong : cannotKnow).push(line);
        }
      }
      // The denominator and what could not be compared, both in the line: a kind that exists in ONE
      // category has no parity to check and must not be counted as agreeing.
      const scope = `${compared} HARDWARE kinds compared across ${pairs.length} (category, kind) pairs ` +
        `(non-hardware excluded — a licence has no kind to compare; column-backed keys excluded from the ` +
        `diff because they are COLUMNS and not cups a crawler fills, the same reason required_cup_defined ` +
        `skips them); ` +
        `${singleCategory} kinds live in a single category and have no parity to check; ` +
        `${notAKind} kind excluded as NOT A KIND (unknown — the classifier's "cannot say"; unknown_zero owns it); ` +
        `${ruledOut.length} settled by a ruling in kindProfiles.ts (${ruledOut.join(", ") || "none"}); ` +
        `BY CAUSE: ${[...byCause].map(([c, ks]) => `${c} ${ks.length} (${ks.join(",")})`).join("; ")}` +
        (unclassified ? ` — ${unclassified} in NEITHER half of kindProfiles.ts, which is its own finding` : "");
      return divergent.length === 0
        ? ok(`every kind is asked the same cups in every category it appears in — ${scope}`)
        : bad(`${divergent.length} kinds are asked DIFFERENT cups depending on the category — ${scope}` +
              (rep ? "" : " — EVIDENCE COLUMN UNAVAILABLE: the completeness report could not be read") +
              ` || ONE OF YOU IS WRONG (a side holds spec sheets) ${wrong.length}: ${wrong.join(" | ") || "none"}` +
              ` || NEITHER CAN KNOW YET (no side holds a spec sheet: acquisition) ${cannotKnow.length}: ${cannotKnow.join(" | ") || "none"}`);
    },
    // NEGATIVE FIXTURE AND POSITIVE TWIN, both resolved through the REAL requirementFor rather than a
    // stand-in, because a stand-in tests the logic I was thinking about and not the code that runs.
    // Negative: routers vs switches for `power-supply` -- the pair the plan names as divergent today.
    // Positive: a category compared against ITSELF, which must always agree; if that ever differs the
    // resolver is non-deterministic and every verdict this test gives is worthless.
    selfTest: async () => {
      const diff = (aCat: string, bCat: string, kind: string) => {
        const a = resolveFourSets(aCat, kind), b = resolveFourSets(bCat, kind);
        return (["req", "pending", "opt", "na"] as const).every(
          (k) => a[k].length === b[k].length && a[k].every((x, i) => x === b[k][i]));
      };
      const negative = diff("routers", "switches", "power-supply");   // must be FALSE: they diverge
      const positive = diff("switches", "switches", "power-supply");  // must be TRUE: self-comparison
      return { negative, positive, note: `routers vs switches on power-supply agrees=${negative}; switches vs itself agrees=${positive}` };
    },
  },
  {
    name: "four_sets_sum",
    findings: "B4",
    needsDb: true,
    // THE DERIVED na (reviewer rulings, 28 and 29 Sep 2026). `na` is the COMPLEMENT of a kind's cup set, derived per
    // (category, kind) by the one keyed function the ledger, the recompute and the API all call -- cupLedger.kindQuestionSet,
    // which refuses a call without both. Green when three things hold over every (category, kind) the ledger publishes:
    //   1. the four sets sum to the DICTIONARY (every non-column-backed key has exactly one answer for the kind);
    //   2. na > 0 on every pair (a kind claiming every cup could apply to it is an unbounded search);
    //   3. NO VETO: a live part of that kind holding an OWN fact (not inherited, not retracted) under a cup the derivation
    //      marks na. The veto FAILS this test, naming the kind and the cup -- the kind's set is wrong, never the fact.
    // Own facts only, and that is load-bearing (kindArchetypes.ts): an inherited fact proves the FAMILY has the property.
    run: async () => {
      const dict = Object.keys(FIELD_DICTIONARY).filter((k) => !COLUMN_BACKED.has(k)).length;
      const sets = new Map<string, ReadonlySet<string>>();
      const rows: { cat: string; kind: string; sum: number; na: number }[] = [];
      for (const [cat, kinds] of Object.entries(LEDGER_KINDS)) {
        if (!PROFILES[cat]) continue;
        for (const kind of kinds as string[]) {
          const q = kindQuestionSet(cat, kind);
          sets.set(`${cat}|${kind}`, new Set(q.not_applicable_by_kind));
          rows.push({ cat, kind, na: q.not_applicable_by_kind.length,
            sum: q.required.length + q.pending.length + q.optional.length + q.not_applicable_by_kind.length });
        }
      }
      if (!rows.length) return none("no (category, kind) pair in the ledger's kind lists");
      const held = (await query<HeldCup>(`
        SELECT c.slug AS cat, p.sku_kind AS kind, f.field_key AS key, count(DISTINCT p.id)::int AS parts
          FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
         WHERE v.slug = $1 AND p.retired_at IS NULL AND p.sku_kind IS NOT NULL AND f.superseded_by IS NULL AND NOT f.inherited
           AND f.method NOT LIKE 'retracted:%' AND f.value IS NOT NULL
         GROUP BY 1, 2, 3`, [OWN_VENDOR])).rows;
      const { vetoes, underived } = naVetoes(sets, held);
      const notSummed = rows.filter((r) => r.sum !== dict), noNa = rows.filter((r) => r.na === 0);
      const naSizes = rows.map((r) => r.na).sort((a, b) => a - b);
      const vetoParts = vetoes.reduce((n, v) => n + v.parts, 0);
      const scope = `${rows.length} (category, kind) pairs from the ledger's kind lists, over the ${dict} non-column-backed dictionary keys; ` +
        `na per pair min ${naSizes[0]} / median ${naSizes[Math.floor(naSizes.length / 2)]} / max ${naSizes[naSizes.length - 1]}; ` +
        `${held.length} (category, kind, cup) triples hold own facts on live ${OWN_VENDOR} parts` +
        (underived.length ? `; ${underived.length} of them on a (category, kind) the ledger does not list, so no derivation reaches them: ${underived.slice(0, 5).map((u) => `${u.cat}/${u.kind}`).join(", ")}` : "");
      const fails = [
        notSummed.length ? `${notSummed.length} pairs do not sum to the dictionary (${notSummed.slice(0, 4).map((r) => `${r.cat}/${r.kind} ${r.sum} of ${dict}`).join("; ")})` : "",
        noNa.length ? `${noNa.length} pairs mark nothing na (${noNa.slice(0, 6).map((r) => `${r.cat}/${r.kind}`).join(", ")})` : "",
        vetoes.length ? `VETO: ${vetoes.length} (category, kind, cup) triples on ${vetoParts} part-cups hold an OWN fact under a cup the derivation marks na — ` +
          `the kind's set is wrong, never the fact: ${vetoes.slice(0, 12).map((v) => `${v.cat}/${v.kind} ${v.key} (${v.parts})`).join(", ")}` +
          (vetoes.length > 12 ? ` … +${vetoes.length - 12}` : "") : "",
      ].filter(Boolean);
      return fails.length ? bad(`${fails.join(" || ")} — ${scope}`)
        : ok(`every pair sums to the dictionary, marks at least one cup na, and no own fact sits in an na cup — ${scope}`);
    },
    // Negative: a planted OWN fact under a cup the derivation marks na for a real pair must come back as a veto (the pass
    // predicate on it must be FALSE). Positive twin: the same pair holding a fact under a cup it REQUIRES is no veto. And the
    // keyed function must REFUSE a call without a kind -- a derivation for nobody read as everybody's is the 8 Sep defect.
    selfTest: async () => {
      const cat = "routers", kind = "power";
      const q = kindQuestionSet(cat, kind);
      const sets = new Map([[`${cat}|${kind}`, new Set(q.not_applicable_by_kind)]]);
      const naKey = q.not_applicable_by_kind[0], reqKey = q.required[0] ?? q.pending[0]?.key;
      const negative = naVetoes(sets, [{ cat, kind, key: naKey, parts: 1 }]).vetoes.length === 0;       // want FALSE
      let refused = false;
      try { kindQuestionSet(cat, ""); } catch { refused = true; }
      const positive = refused && naVetoes(sets, [{ cat, kind, key: reqKey, parts: 1 }]).vetoes.length === 0;
      return { negative, positive, note: `${cat}/${kind}: planted own fact under na cup "${naKey}" vetoed=${!negative}; under required "${reqKey}" vetoed=${!positive}; kind-less call refused=${refused}` };
    },
  },
  {
    name: "no_family_reason_present",
    findings: "B2, B3",
    needsDb: true,
    // A SENTINEL IS NOT A VALUE. The build writes "(none)" where a line names no family, deliberately,
    // because a review once read `null` as "undecided". Serving that marker to a consumer puts the
    // string "(none)" in a shop tree as a family NAME -- which is what happened to 3,993 switches and
    // 3,975 routers on 27 Sep. So: a state, always; a REASON whenever the state says no family; and
    // the sentinels never reaching the API record at all.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["product_family", "product_family_state", "no_family_reason"]);
      if (blocked) return blocked;
      const r = await query<{ n: string; nostate: string; noreason: string; sentinel: string }>(
        "SELECT count(*)::text AS n," +
        " count(*) FILTER (WHERE product_family_state IS NULL)::text AS nostate," +
        " count(*) FILTER (WHERE product_family_state = 'no_family_named' AND no_family_reason IS NULL)::text AS noreason," +
        " count(*) FILTER (WHERE product_family LIKE '(%')::text AS sentinel" +
        " FROM parts WHERE retired_at IS NULL AND product_line IS NOT NULL");
      const x = r.rows[0];
      const bad_ = Number(x.nostate) + Number(x.noreason) + Number(x.sentinel);
      const scope = `${Number(x.n).toLocaleString()} layered live parts`;
      return bad_ === 0
        ? ok(`every layered row carries a family state, a reason where it names no family, and no sentinel reaches the record — ${scope}`)
        : bad(`${x.nostate} rows have no family state, ${x.noreason} say no_family_named with no reason, ` +
              `${x.sentinel} serve a SENTINEL as the family value — ${scope}`);
    },
    // The predicate, exercised on synthetic rows so it is proven TODAY even though the columns it
    // reads are B2. Negative: a row claiming no_family_named with a null reason. Twin: the same row
    // with a reason. Both go through one function, so the fixture cannot pass by testing something
    // adjacent to the rule.
    selfTest: async () => {
      const okRow = (state: string | null, reason: string | null, family: string | null) =>
        state !== null && !(state === "no_family_named" && reason === null) && !(family ?? "").startsWith("(");
      return { negative: okRow("no_family_named", null, null), positive: okRow("no_family_named", "single-series", "Catalyst 9300"),
               note: "no_family_named with a null reason must fail; with a recorded reason must pass" };
    },
  },
  {
    name: "bucket_not_series",
    findings: "B3",
    needsDb: true,
    // "Catalyst 9300 shared parts" IS NOT A SERIES. It is a navigation bucket the layering build
    // invents to hold components whose host series cannot be decided, and it must never enter a
    // product column: a shop tree would print it as a product line, and a JTL Merkmalwert would carry
    // it as a value. A bucket row is legitimate only when it says which hosts it is shared BETWEEN,
    // or records why no single host can be named.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["product_series", "bucket"]);
      if (blocked) return blocked;
      const r = await query<{ n: string; shared: string; nohost: string }>(
        "SELECT count(*)::text AS n," +
        " count(*) FILTER (WHERE product_series ILIKE '%shared parts')::text AS shared," +
        " count(*) FILTER (WHERE bucket IS NOT NULL AND bucket = '{}')::text AS nohost" +
        " FROM parts WHERE retired_at IS NULL AND product_series IS NOT NULL");
      const x = r.rows[0];
      const scope = `${Number(x.n).toLocaleString()} live parts carrying a series`;
      return Number(x.shared) === 0 && Number(x.nohost) === 0
        ? ok(`no navigation bucket is serving as a series, and every bucket row names its hosts — ${scope}`)
        : bad(`${x.shared} rows serve a "… shared parts" BUCKET as their product_series and ${x.nohost} ` +
              `bucket rows name no host — ${scope}`);
    },
    selfTest: async () => {
      const isSeries = (s: string) => !/shared parts$/i.test(s.trim());
      return { negative: isSeries("Catalyst 9300 shared parts"), positive: isSeries("Catalyst 9300"),
               note: "a '… shared parts' bucket must be refused as a series; a real series must pass" };
    },
  },
  {
    name: "twin_parity",
    findings: "N7",
    needsDb: true,
    // `X=` IS THE SPARE ORDERABLE OF `X` -- the same hardware, so the same category, the same kind and
    // the same series. Where they disagree, one of the two was enumerated from a document that was
    // about something else: A99-12X100GE-FC sat in `ios-nx-os-software` because it was read off an IOS
    // XR datasheet that merely LISTS supported cards, while its spare sat correctly in `routers`.
    //
    // A missing base is NOT a failure. A spare whose base was never enumerated is a gap in the
    // catalogue, not a disagreement, and folding the two together would make this test unable to say
    // which it had found.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["sku_kind", "product_series"]);
      if (blocked) return blocked;
      const r = await query<{ pairs: string; differ: string; nonhw: string; onesided: string; nobase: string }>(
        "WITH s AS (SELECT p.*, left(p.sku, length(p.sku) - 1) AS base_sku FROM parts p" +
        " WHERE p.retired_at IS NULL AND p.sku LIKE '%=')" +
        " SELECT count(*)::text AS pairs," +
        // A NULL IS NOT A DISAGREEMENT, and the class decides whose disagreement this is. Measured
        // 27 Sep: the unrefined predicate flagged 160 pairs -- of which 20 were a one-sided GAP (one
        // side never layered, so it has no opinion) and 103 were LICENCES, 15 software, 15
        // non-product. Only 27 were HARDWARE, which is the defect this test was written for: an
        // ASR 9900 line card filed under ios-nx-os-software because it was read off a datasheet that
        // merely LISTS supported cards, while its spare sat correctly in routers.
        //
        // So the judgement is over hardware twins where BOTH sides hold a value, and the other three
        // populations are counted and named rather than folded in -- a licence pair disagreeing
        // about its category is a real question, but it is not this test's and it would drown the 27.
        " count(*) FILTER (WHERE b.id IS NOT NULL AND s.product_class = 'hardware' AND (" +
        "   b.category_id IS DISTINCT FROM s.category_id" +
        "   OR (b.sku_kind IS NOT NULL AND s.sku_kind IS NOT NULL AND b.sku_kind <> s.sku_kind)" +
        "   OR (b.product_series IS NOT NULL AND s.product_series IS NOT NULL AND b.product_series <> s.product_series)))::text AS differ," +
        " count(*) FILTER (WHERE b.id IS NOT NULL AND s.product_class IS DISTINCT FROM 'hardware' AND (" +
        "   b.category_id IS DISTINCT FROM s.category_id OR b.sku_kind IS DISTINCT FROM s.sku_kind" +
        "   OR b.product_series IS DISTINCT FROM s.product_series))::text AS nonhw," +
        " count(*) FILTER (WHERE b.id IS NOT NULL AND s.product_class = 'hardware' AND" +
        "   b.category_id IS NOT DISTINCT FROM s.category_id AND (" +
        "   (b.sku_kind IS NULL) <> (s.sku_kind IS NULL) OR (b.product_series IS NULL) <> (s.product_series IS NULL)))::text AS onesided," +
        " count(*) FILTER (WHERE b.id IS NULL)::text AS nobase" +
        " FROM s LEFT JOIN parts b ON b.sku = s.base_sku AND b.vendor_id = s.vendor_id AND b.retired_at IS NULL");
      const x = r.rows[0];
      // NAMED RESIDUE (reviewer ruling, Batch B 29 Sep 2026): a pair whose two REAL names say different things waits for a
      // sheet; no rule may choose between two wordings. Listed by its spare, excluded from the verdict, printed in the line,
      // and STALE -- red -- the day the pair stops disagreeing, so an exception can never outlive its reason.
      const TWIN_EXCEPTIONS: Record<string, string> = {
        "UCSW-MSX-PCBL=": "base 'UCS Invicta Scaling System Mellanox Switch Power Cable' vs spare '…Mellanox Jumper Cable': two real names that disagree",
      };
      const differing = (await query<{ sku: string }>(
        "SELECT s.sku FROM parts s JOIN parts b ON b.sku = left(s.sku, length(s.sku) - 1) AND b.vendor_id = s.vendor_id AND b.retired_at IS NULL" +
        " WHERE s.retired_at IS NULL AND s.sku LIKE '%=' AND s.product_class = 'hardware' AND (" +
        "   b.category_id IS DISTINCT FROM s.category_id" +
        "   OR (b.sku_kind IS NOT NULL AND s.sku_kind IS NOT NULL AND b.sku_kind <> s.sku_kind)" +
        "   OR (b.product_series IS NOT NULL AND s.product_series IS NOT NULL AND b.product_series <> s.product_series))")).rows.map((d) => d.sku);
      if (differing.length !== Number(x.differ)) return bad(`the pair list (${differing.length}) and the count (${x.differ}) disagree — one of the two predicates drifted`);
      const excused = differing.filter((s) => TWIN_EXCEPTIONS[s]);
      const staleEx = Object.keys(TWIN_EXCEPTIONS).filter((s) => !differing.includes(s));
      const open = differing.filter((s) => !TWIN_EXCEPTIONS[s]);
      const named = `${excused.length} named exception(s): ${excused.map((s) => `${s} (${TWIN_EXCEPTIONS[s]})`).join("; ") || "none"}`;
      if (staleEx.length) return bad(`STALE twin exception(s) — the pair no longer disagrees, remove the entry: ${staleEx.join(", ")}`);
      const scope = `${named}; ${Number(x.pairs).toLocaleString()} live spare SKUs ending "="; ` +
        `${x.nobase} have no base row (a catalogue gap, counted separately and NOT a failure); ` +
        `${x.nonhw} NON-HARDWARE pairs disagree (licences, software, non-product — a real question about ` +
        `category assignment, but not this test's, and they would drown the hardware count); ` +
        `${x.onesided} hardware pairs where one side is simply unlayered (a null has no opinion, so it is a GAP not a conflict)`;
      return open.length === 0
        ? ok(`every spare agrees with its base on category, kind and series, bar the named — ${scope}`)
        : bad(`${open.length} spares disagree with their base on category, kind or series: ${open.slice(0, 8).join(", ")} — ${scope}`);
    },
    selfTest: async () => {
      const agrees = (a: [string, string, string], b: [string, string, string]) => a.every((v, i) => v === b[i]);
      return { negative: agrees(["routers", "line-card", "ASR 9900"], ["ios-nx-os-software", "line-card", "ASR 9900"]),
               positive: agrees(["routers", "line-card", "ASR 9900"], ["routers", "line-card", "ASR 9900"]),
               note: "a spare in a different category from its base must fail; an identical pair must pass" };
    },
  },
  {
    name: "unknown_zero",
    findings: "B7",
    needsDb: true,
    // A PART IN KIND `unknown` IS ASKED NOTHING, AND THEREFORE SCORES PERFECTLY. That is the whole
    // hazard: an unclassified part does not appear as a gap, it disappears from the denominator, and
    // the completeness figure improves every time the classifier gives up. So `unknown` must be zero,
    // and a kind that is asked no cups at all is the same defect wearing a name.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["sku_kind"]);
      if (blocked) return blocked;
      // THE DENOMINATOR HAD TO BE FIXED BEFORE THIS NUMBER MEANT ANYTHING, and the first live run is
      // what showed it. Counting every part with no kind gave 50,934 -- "more than half the catalogue
      // is unclassified" -- and the split says otherwise: 32,329 LICENCES, 11,093 software, 1,966
      // non-product and 565 service, none of which can ever hold a hardware kind. A licence with no
      // sku_kind is not an unclassified part, it is a part that correctly has no kind.
      //
      // So the judgement is over HARDWARE, and the excluded population is counted and named in the
      // line rather than folded away -- this repo's own rule, and the reason it exists is that a
      // coverage number is only as honest as its denominator.
      // Reviewer ruling 28 Sep 2026: the other vendors' unkinded hardware is vendor_coverage's population, counted
      // APART and never in this check's number (one population, one red). This check's own number is OWN_VENDOR's.
      // RULING Q9 (3), 29 Sep 2026: the population splits by EVIDENCE (src/core/unknownEvidence.ts, shared with the
      // completeness report's acquisition queue). EVIDENCED unknowns keep this check red; NO-EVIDENCE ones (a SKU-only name
      // and no document) are their own term, on the acquisition queue, under a ratchet that may not grow.
      const rows = (await query<UnknownRow>(UNKNOWN_HARDWARE_SQL, [OWN_VENDOR])).rows;
      const { evidenced, noEvidence } = splitUnknown(rows);
      const byCat = (rs: UnknownRow[]) => [...rs.reduce((m, x) => m.set(x.category, (m.get(x.category) ?? 0) + 1), new Map<string, number>())]
        .sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ");
      const UCEIL = path.join(REPO, "data", "ratchets", "unknown-no-evidence-cisco.json");
      // `raises`: the RULED raises only (ruling Q15 moved four silent-document parts into the term), append-only, carried by every
      // record; recording itself can only lower the ceiling (min(ceiling, now)).
      type UCeil = { vendor: string; unit: string; recorded_at: string; git_sha: string; ceiling: number; raises?: { to: number; by: number; ruling: string; at: string }[] };
      let uceil: UCeil | null = null;
      try { if (existsSync(UCEIL)) uceil = JSON.parse(readFileSync(UCEIL, "utf8")) as UCeil; } catch { uceil = null; }
      if (uceil && (uceil.vendor !== OWN_VENDOR || typeof uceil.ceiling !== "number")) uceil = null;
      if (process.argv.includes("--record-unknown-ceiling")) {
        uceil = { vendor: OWN_VENDOR, unit: "live cisco HARDWARE parts in kind unknown with a SKU-only name and no linked document",
          recorded_at: new Date().toISOString(), git_sha: process.env.GIT_SHA ?? "unknown", ceiling: Math.min(noEvidence.length, uceil?.ceiling ?? Infinity),
          raises: uceil?.raises ?? [] };
        mkdirSync(path.dirname(UCEIL), { recursive: true });
        writeFileSync(UCEIL, JSON.stringify(uceil, null, 2) + "\n");
      }
      const r = { rows: [...rows.reduce((m, x) => m.set(x.category, (m.get(x.category) ?? 0) + 1), new Map<string, number>())]
        .sort((a, b) => b[1] - a[1]).map(([category, n]) => ({ category, n: String(n) })) };
      const apart = Number((await query<{ n: string }>(
        "SELECT count(*)::text AS n FROM parts p JOIN vendors v ON v.id = p.vendor_id" +
        " WHERE p.retired_at IS NULL AND (p.sku_kind IS NULL OR p.sku_kind = 'unknown')" +
        " AND p.product_class = 'hardware' AND v.slug <> $1", [OWN_VENDOR])).rows[0].n);
      const excluded = await query<{ cls: string; n: string }>(
        "SELECT coalesce(p.product_class::text, '(none)') AS cls, count(*)::text AS n FROM parts p" +
        " WHERE p.retired_at IS NULL AND (p.sku_kind IS NULL OR p.sku_kind = 'unknown')" +
        " AND (p.product_class IS DISTINCT FROM 'hardware') GROUP BY 1 ORDER BY count(*) DESC");
      const notHardware = excluded.rows.reduce((n, x) => n + Number(x.n), 0);
      const total = r.rows.reduce((n, x) => n + Number(x.n), 0);
      // A kind asked nothing is the same hazard by another route, so it is counted here too.
      const askedNothing = Object.entries(PROFILES).flatMap(([cat]) =>
        kindsDeclaredBy(cat).filter((k) => {
          const s = resolveFourSets(cat, k);
          return s.req.length + s.pending.length === 0;
        }).map((k) => `${cat}/${k}`));
      const partition = `${total.toLocaleString()} unknown = ${evidenced.length} EVIDENCED (judged: ${byCat(evidenced) || "none"}) + ` +
        `${noEvidence.length} NO EVIDENCE (apart, on the acquisition queue; ceiling ${uceil ? `${uceil.ceiling} @${uceil.git_sha.slice(0, 7)}${uceil.raises?.length ? `, ${uceil.raises.length} ruled raise(s)` : ""}` : "MISSING"}: ${byCat(noEvidence) || "none"})`;
      const scope = `${partition}; ${r.rows.length} ${OWN_VENDOR} categories hold an unclassified HARDWARE part; ` +
        `${apart.toLocaleString()} other-vendor hardware parts are vendor_coverage's, counted apart; ` +
        `${notHardware.toLocaleString()} further parts have no kind and correctly never will ` +
        `(${excluded.rows.slice(0, 4).map((x) => `${x.cls} ${Number(x.n).toLocaleString()}`).join(", ")}) — ` +
        `excluded from the judgement and counted here, never folded into it; ` +
        `${askedNothing.length} (category, kind) pairs are asked no required or pending cup at all` +
        (askedNothing.length ? ` (${askedNothing.slice(0, 6).join(", ")})` : "") +
        (evidenced.length ? `; evidenced: ${evidenced.slice(0, 12).map((x) => x.sku).join(" ")}${evidenced.length > 12 ? " …" : ""}` : "");
      const v = unknownZeroVerdict({ evidenced: evidenced.length, noEvidence: noEvidence.length, ceiling: uceil?.ceiling ?? null, askedNothing: askedNothing.length });
      return v.pass
        ? ok(`no EVIDENCED part is unclassified, every kind is asked something, and the no-evidence count is within its ratchet — ${scope}`)
        : bad(`${v.fails.join("; ")} — an unknown part is asked nothing and scores perfectly while leaving the denominator — ${scope}`);
    },
    // Through the check's OWN functions (unknownEvidence.ts): an unknown part a document links is EVIDENCED and must keep the
    // check red; a SKU-only, unlinked part is apart and passes within its ceiling; the same count one over the ceiling fails.
    selfTest: async () => {
      const fixture = (linked: boolean, name: string): UnknownRow => ({ sku: "4039503", name, category: "video", linked });
      const verdict = (rows: UnknownRow[], ceiling: number) => {
        const { evidenced, noEvidence } = splitUnknown(rows);
        return unknownZeroVerdict({ evidenced: evidenced.length, noEvidence: noEvidence.length, ceiling, askedNothing: 0 }).pass;
      };
      const negative = verdict([fixture(true, "Cisco 4039503")], 5) || verdict([fixture(false, "Cisco 4039503"), fixture(false, "4039503")], 1)
        || verdict([fixture(false, "Prisma II 1.2 GHz transmitter")], 5);
      const positive = verdict([fixture(false, "Cisco 4039503")], 1);
      return { negative, positive,
               note: "a document-linked unknown, a named unknown and a no-evidence count over its ceiling must each fail; one SKU-only unlinked part within its ceiling passes" };
    },
  },
  {
    name: "plans_agree_with_rows",
    findings: "N6",
    needsDb: true,
    // A PLAN THAT RAN AND A ROW THAT DISAGREES WITH IT MEANS THE WRITE DID NOT HAPPEN, or happened and
    // was overwritten, or the plan recorded an intention nobody executed. All three read identically
    // from the plan file alone -- which is why this compares the plan's OUTCOME against the live row
    // rather than against the plan's own success field.
    //
    // The second half is narrower and was measured: `expected_kind_after` must be a KIND, not a role
    // word. 152 plans expect things like "uplink" or "access", which are roles a port plays and not
    // kinds a part is, so those plans can never agree with any row however well the write went.
    // RULING (e), 29 Sep 2026: the plans are read from the COMMITTED ARTEFACT OF RECORD. The `kind_layer_plans` table this
    // test used to query never existed (it threw, and the test sat UNAVAILABLE); the 7,533 plans of 13 Sep live in
    // data/reference/kind-layer-plans-2026-09-13.json, each with the run that executed it.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const file = path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json");
      if (!fs.existsSync(file)) return na(`the plans artefact of record is not in this tree (${path.relative(REPO_ROOT, file)})`);
      const plans = JSON.parse(fs.readFileSync(file, "utf8")) as PlanOfRecord[];
      // A role word is not a kind (the second half of N6): a plan expecting one could never agree with any row.
      const ROLES = new Set(["uplink", "access", "lan", "wan", "mgmt", "downlink"]);
      const roleExpected = plans.filter((p) => p.expected_kind_after && ROLES.has(p.expected_kind_after)).length;
      const runIds = [...new Set(plans.map((p) => p.run_id))];
      const runs = new Map((await query<{ id: number; status: string }>("SELECT id, status FROM runs WHERE id = ANY($1::int[])", [runIds])).rows.map((r) => [Number(r.id), r.status]));
      const notRan = plans.filter((p) => runs.get(p.run_id) !== "succeeded");
      const skus = [...new Set(plans.map((p) => p.sku))];
      const live = new Map((await query<{ sku: string; cat: string; kind: string | null; cls: string; retired: boolean }>(`
        SELECT DISTINCT ON (p.sku) p.sku, c.slug AS cat, p.sku_kind AS kind, p.product_class::text AS cls, p.retired_at IS NOT NULL AS retired
          FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
         WHERE v.slug='cisco' AND p.sku = ANY($1::text[]) ORDER BY p.sku, (p.retired_at IS NULL) DESC`, [skus])).rows.map((r) => [r.sku, r]));
      // Superseded only on evidence: a LATER successful run whose recorded inputs or stats name the part, quoted as it is
      // in a JSON list, so "SPA-DSP" cannot claim a run that only named "SPA-DSP-2".
      const off = plans.filter((p) => { const r = live.get(p.sku); return r && !r.retired && (p.action === "move" ? r.cat !== p.to : r.cls !== p.to); });
      const later = new Map<string, number>();
      if (off.length) {
        const rows = (await query<{ sku: string; rid: number }>(`
          SELECT s.sku, max(r.id) AS rid FROM unnest($1::text[], $2::int[]) AS s(sku, after)
            JOIN runs r ON r.id > s.after AND r.status = 'succeeded'
                       AND (r.inputs::text LIKE '%"' || s.sku || '"%' OR r.stats::text LIKE '%"' || s.sku || '"%')
           GROUP BY s.sku`, [off.map((p) => p.sku), off.map((p) => p.run_id)])).rows;
        for (const r of rows) later.set(r.sku, Number(r.rid));
      }
      const tally: Record<string, number> = {};
      const disagree: string[] = [];
      let kindDrift = 0;
      for (const p of plans) {
        const row = live.get(p.sku);
        const v = planVerdict(p, row, later.get(p.sku) ?? null);
        tally[v] = (tally[v] ?? 0) + 1;
        if (v === "disagrees") disagree.push(`${p.sku} (plan run ${p.run_id}: ${p.action} -> ${p.to}; live ${p.action === "move" ? row!.cat : row!.cls})`);
        if (v === "agrees" && p.action === "move" && (row!.kind ?? "") !== (p.expected_kind_after ?? "")) kindDrift++;
      }
      const scope = `${plans.length.toLocaleString()} plans of record, ${runIds.length} runs; ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ")}; `
        + `${kindDrift} agreeing moves carry a kind the axis has refined since 13 Sep (printed, not judged); ${roleExpected} expect a role word`;
      if (notRan.length) return bad(`${notRan.length} plans name a run that did not succeed — ${scope}: ${notRan.slice(0, 5).map((p) => `${p.sku} (run ${p.run_id} ${runs.get(p.run_id) ?? "missing"})`).join(", ")}`);
      return disagree.length === 0 && roleExpected === 0
        ? ok(`every executed plan's write holds, or a later run superseded it — ${scope}`)
        : bad(`${disagree.length} plans disagree with their live row and no later run names the part — ${scope}: ${disagree.slice(0, 6).join("; ")}`);
    },
    selfTest: async () => {
      const p: PlanOfRecord = { sku: "X", category: "switches", action: "move", to: "routers", run_id: 100, expected_kind_after: "router" };
      const moved = planVerdict(p, { cat: "security", cls: "hardware", retired: false }, null);        // no later run: a real miss
      const held = planVerdict(p, { cat: "routers", cls: "hardware", retired: false }, null);
      const later = planVerdict(p, { cat: "security", cls: "hardware", retired: false }, 140);         // a later run moved it on
      const earlier = planVerdict(p, { cat: "security", cls: "hardware", retired: false }, 90);        // a run BEFORE the plan is no excuse
      return { negative: moved === "agrees" || moved === "superseded" || earlier !== "disagrees",
               positive: held === "agrees" && later === "superseded",
               note: `a moved row with no later run must disagree (${moved}), and one explained only by an EARLIER run too (${earlier}); a held row agrees (${held}), a later run supersedes (${later})` };
    },
  },
  {
    name: "runs_have_approval",
    findings: "B8, N5",
    needsDb: true,
    // B8 reads as a paperwork gap ("the published run record shows no approval") and it is structural: there
    // is no approval COLUMN and no run carries one in `inputs`, so the blanket sentence of 25 Sep is not
    // recorded anywhere a check could read. The test also prints the run count, because the brief says 7,533
    // runs and the table holds a different number — a figure the reviewer and I should reconcile before
    // anyone approves "12 groups" of something neither of us has counted the same way.
    // THE THREE-CLASS RULE (reviewer ruling, 28 Sep 2026; docs/decisions/2026-09-28-runs-have-approval.md).
    // A blanket "every run carries an approval" demanded a sentence nobody gave from 1,136 pipeline steps.
    // What each run owes depends on what it DOES:
    //   approval  changes row membership (category, class, part creation/retirement) or withdraws facts
    //   gate      writes facts (every apply-*, plus the non-apply kinds that rewrite facts)
    //   derived   recomputes from what is already stored -> owes neither
    // A kind can owe both (apply-retract-*). Only SUCCEEDED runs are judged: a failed or aborted run was
    // rolled back and changed nothing -- they are counted as their own number, never folded into a pass.
    //
    // THE TABLE IS EXHAUSTIVE ON PURPOSE and an unclassified kind FAILS, named. A default of "derived"
    // would let the next retraction script owe nothing by being new, which is the drift this repo keeps
    // paying for. Run 69 is the one named historical exception: the hand-run conflict reopen of 4 Sep,
    // which cannot be given a gate retrospectively.
    run: async () => {
      const rows = (await query<{ id: string; kind: string; status: string; appr: boolean; gate: boolean; retro: boolean; started: string }>(
        "SELECT id::text, kind, status::text, inputs ? 'approved' AS appr, gate IS NOT NULL AS gate," +
        " coalesce(inputs->>'approved' = 'reviewer_retroactive', false) AS retro," +
        " to_char(started_at, 'YYYY-MM-DD') AS started FROM runs")).rows;
      if (!rows.length) return none("the runs table is empty");
      const retro = new Map<string, string>();
      for (const x of (await query<{ v: Record<string, { passed: boolean; precision: number; retract: number }> | null }>(
        "SELECT stats->'verdicts' AS v FROM runs WHERE kind = 'retro-gate' AND status = 'succeeded' ORDER BY id")).rows)
        for (const [id, v] of Object.entries(x.v ?? {}))
          retro.set(id, v.passed ? `retro-gate passed, precision ${v.precision}` : `retro-gate failed, ${v.retract} facts retracted`);
      const named: string[] = [];
      const unclassified = new Set<string>();
      const pre = new Map<string, number>();       // misses before the convention: named, not judged
      const post = new Map<string, string[]>();    // misses the rule judges: "kind (owes)" -> run ids
      let judged = 0, notSucceeded = 0, excepted = 0, preRuns = 0, retroApproved = 0;
      // The first approval ever recorded -- computed, so "before the convention existed" is a fact about the
      // table and not a date typed here.
      const firstAppr = rows.filter((r) => r.appr).map((r) => r.started).sort()[0] ?? "9999";
      for (const r of rows) {
        const o = runOwes(r.kind, r.appr, r.gate, r.started);
        if (o === "unclassified") { unclassified.add(r.kind); continue; }
        if (r.status !== "succeeded") { notSucceeded++; continue; }
        const why = runException(r.id, retro);
        if (why) { excepted++; named.push(`${r.id} (${why})`); continue; }
        if (o.pre) preRuns++; else { judged++; if (r.retro) retroApproved++; }
        if (!o.approval && !o.gate) continue;
        const key = `${r.kind} (${o.approval && o.gate ? "approval+gate" : o.approval ? "approval" : "gate"})`;
        if (o.pre) pre.set(key, (pre.get(key) ?? 0) + 1);
        else post.set(key, [...(post.get(key) ?? []), r.id]);
      }
      const preN = [...pre.values()].reduce((a, b) => a + b, 0);
      const postN = [...post.values()].reduce((a, b) => a + b.length, 0);
      const preList = [...pre.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
      const postList = [...post.entries()].sort((a, b) => b[1].length - a[1].length)
        .map(([k, ids]) => `${k}: runs ${ids.join(" ")}`).join("; ");
      const scope = `${rows.length} runs: ${judged} succeeded since ${RUN_CONVENTION_START} judged, ${preRuns} before it ` +
        `NOT judged, ${notSucceeded} failed/aborted not judged, ${excepted} named exceptions [${named.join("; ")}]; ${retroApproved} judged runs ` +
        `carry the reviewer's retroactive line (counted apart, not as contemporaneous approvals); first recorded ` +
        `approval ${firstAppr}; pre-convention misses named: ${preN} (${preList || "-"})`;
      if (unclassified.size) return bad(`${unclassified.size} run kinds are in no class, so nobody has said what they owe: ` +
        `${[...unclassified].join(", ")} — ${scope}`);
      return postN === 0
        ? ok(`every judged run carries what its class owes — ${scope}`)
        : bad(`${postN} runs since ${RUN_CONVENTION_START} carry less than their class owes — ${postList} — ${scope}`);
    },
    selfTest: async () => {
      const owes = (kind: string, appr: boolean, gate: boolean, started = "2026-09-20") => {
        const o = runOwes(kind, appr, gate, started);
        return o !== "unclassified" && (o.pre || (!o.approval && !o.gate));
      };
      const gated = new Map([["942", "retro-gate failed, 57 facts retracted"]]);
      return { negative: owes("move-category", false, false) || owes("a-kind-nobody-classified", true, true)
                 || runException("942", new Map()) !== null
                 || owes("apply-acquired", false, false) || owes("reclassify", false, false, "2026-09-11"),
               positive: owes("move-category", true, false) && owes("apply-acquired", false, true)
                 && owes("recompute-completeness", false, false) && owes("reclassify", false, false, "2026-09-10")
                 && runException("942", gated) !== null && runException("69", new Map()) !== null,
               note: "a membership run without approval (on/after 09-11), an apply-* without gate and an unclassified kind " +
                 "must fail; each class carrying what it owes, a derived run, and the same miss on 09-10 must pass" };
    },
  },
  {
    name: "gaps_fresh",
    findings: "N2, N3, N46, N47",
    needsDb: true,
    // A COMPLETENESS ROW SCORED AGAINST A PROFILE THAT HAS SINCE CHANGED IS A NUMBER NOBODY CAN TRUST,
    // and it is invisible by construction: `completeness` still holds a row for every part -- the
    // invariant everyone checks -- and the rows are simply scored against yesterday's mould.
    //
    // `computed_at` CANNOT ANSWER THIS. It moves only when a row's tuple CHANGES, so an old timestamp
    // cannot distinguish "recomputed and identical" from "never recomputed", and a first staleness
    // check built on it called 82,691 rows stale when nearly all were fine -- which is the number that
    // teaches a reader to ignore the check.
    //
    // The sound test needs no timestamp at all: a stored `required_fields` entry can only have come
    // from a profile that marks that key req or cond, so an entry the CURRENT profile does not mention
    // is a PROOF of staleness rather than a guess. That is what this asks.
    run: async () => {
      let rows: { category: string; keys: string[]; n: number }[];
      try {
        const r = await query<{ category: string; keys: string[]; n: string }>(
          "SELECT c.slug AS category, cm.required_fields AS keys, count(*)::text AS n" +
          " FROM completeness cm JOIN parts p ON p.id = cm.part_id JOIN categories c ON c.id = p.category_id" +
          " WHERE p.retired_at IS NULL AND cm.required_fields IS NOT NULL" +
          " GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 400");
        rows = r.rows.map((x) => ({ category: x.category, keys: x.keys ?? [], n: Number(x.n) }));
      } catch (e) {
        return none(`could not read completeness.required_fields: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no completeness row carries a required_fields list to check against the profile");
      let stale = 0, checked = 0;
      const witnesses: string[] = [];
      for (const row of rows) {
        const profile = PROFILES[row.category];
        if (!profile) continue;                       // a category with no profile is A-other's problem
        checked += row.n;
        const orphan = row.keys.filter((k) => {
          const r = (profile as Record<string, { kind?: string }>)[k];
          return !r || (r.kind !== "req" && r.kind !== "cond");
        });
        if (orphan.length) {
          stale += row.n;
          if (witnesses.length < 4) witnesses.push(`${row.category}: ${orphan.slice(0, 3).join("/")} (${row.n} rows)`);
        }
      }
      const scope = `${checked.toLocaleString()} scored rows over ${rows.length} distinct required-field sets ` +
        `(top 400 sets; staleness proven by a stored key the CURRENT profile does not mark req or cond, not by a timestamp)`;
      return stale === 0
        ? ok(`every scored row was computed against a profile that still demands what it stored — ${scope}`)
        : bad(`${stale.toLocaleString()} rows are scored against a profile that has since changed — ${scope}: ${witnesses.join("; ")}`);
    },
    selfTest: async () => {
      const fresh = (stored: string[], profileKeys: string[]) => stored.every((k) => profileKeys.includes(k));
      return { negative: fresh(["ports", "a_cup_the_profile_dropped"], ["ports", "weight"]),
               positive: fresh(["ports"], ["ports", "weight"]),
               note: "a stored key the profile no longer demands proves staleness; a subset of the profile passes" };
    },
  },
  {
    name: "fill_state_partition",
    findings: "N8–N11, N30, N31, N50",
    needsDb: true,
    // `filled` IS A CLAIM WITH FOUR CONDITIONS, AND THE STORE CURRENTLY CHECKS ONE. A slot counts as
    // filled only when the value is the part's OWN (not inherited), read from a SPEC-BEARING document,
    // by a method that read the artefact (html_table, pdf_table, a registered derivation), and with no
    // open conflict. Anything else has a different name and a different next action.
    //
    // The two that matter most here, both measured: a `hexcat_seed` fact is a value somebody typed,
    // not one the pipeline read, so it is UNVERIFIED and not filled; and a value mined from an
    // End-of-Life notice is MINED, because an EoL bulletin lists SKUs and carries no specifications --
    // counting it as filled is how a coverage figure rises while page depth does not.
    run: async () => {
      let rows: { method: string; inherited: boolean; doc_type: string | null; n: number }[];
      try {
        const r = await query<{ method: string; inherited: boolean; doc_type: string | null; n: string }>(FILL_STATE_SQL);
        rows = r.rows.map((x) => ({ ...x, n: Number(x.n) }));
      } catch (e) {
        return none(`could not read the fact provenance: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no live fact exists to partition");
      // the histogram through fillHistogram, the scorecard's own call: one aggregation of one classifier
      const { total, states } = fillHistogram(rows);
      const hist = new Map<string, number>(Object.entries(states));
      const filled = hist.get("filled") ?? 0;
      const shown = [...hist.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ");
      const scope = `${total.toLocaleString()} live facts partitioned; ${hist.size} states occupied: ${shown}`;
      // Every fact must land in exactly one state -- that is the partition, and it is asserted rather
      // than assumed, because a histogram that does not sum is a histogram measuring nothing.
      const sums = [...hist.values()].reduce((a, b) => a + b, 0) === total;
      if (!sums) return bad(`the states do NOT partition the facts — ${scope}`);
      // THE RULED DEFINITION (reviewer, 29 Sep 2026): this check tests the PARTITION, not the fill. Green when every
      // served fact on a SCORED part (completeness.no_profile = false) sits in exactly one of the SIX states and they sum
      // to the total; the histogram is RECORDED per build (mould-build.sh runs --record-fill-state) and the live one IS
      // the last record; and against the previous record `filled` has not fallen and `unverified_seed` / `mined_from_eol`
      // have not risen -- a reversal is red unless a succeeded run between the two records stands behind it. Only
      // `filled` is filled: filled_inherited is printed beside it, never merged, and the share is PRINTED, not asserted.
      // SEVEN since ruling (ii), 30 Sep 2026: derived_operational (the shipping-class Versandgewicht) is shown apart. The
      // history's vector keeps one order (FILL_STATES); the new state is appended, and an older record reads 0.
      const SEVEN: readonly string[] = FILL_STATES;
      const stray = [...hist.keys()].filter((k) => !SEVEN.includes(k));
      if (stray.length) return bad(`${stray.map((k) => `${hist.get(k)} in ${k}`).join(", ")} — outside the seven states — ${scope}`);
      const HIST = path.join(REPO, FILL_STATE_HISTORY);
      const POP = FILL_STATE_POPULATION;
      const now: Record<string, number> = Object.fromEntries(SEVEN.map((k) => [k, hist.get(k) ?? 0]));
      if (process.argv.includes("--record-fill-state")) {
        mkdirSync(path.dirname(HIST), { recursive: true });
        appendFileSync(HIST, JSON.stringify({ at: new Date().toISOString(), git_sha: process.env.GIT_SHA ?? "unknown",
          population: POP, total, states: now }) + "\n");
      }
      let recs: FillStateRecord[];
      try {
        // A record of another population is another measurement: never compared, so the first record under this one
        // is a baseline rather than a "fall" of every state.
        recs = readFillStateHistory(HIST);
      } catch (e) {
        return bad(`the fill-state history is unreadable at ${HIST}: ${e instanceof Error ? e.message : String(e)} — could not check is not a pass`);
      }
      const last = recs[recs.length - 1], prev = recs[recs.length - 2];
      // the filled share EXCLUDES derived_operational (ruling (ii)): an operational value is not a spec slot, so it is neither
      // in the numerator nor in the denominator, and it is printed apart. filledShare is the scorecard's function too.
      const share = filledShare(now, total);
      const bar = `progress: filled ${filled.toLocaleString()} of ${share.spec_total.toLocaleString()} spec facts (${share.pct === null ? "n/a" : share.pct.toFixed(1)}%), ` +
        `filled_inherited ${now.filled_inherited.toLocaleString()} beside it; derived_operational ${now.derived_operational.toLocaleString()} apart (not in the share)`;
      if (!last) return bad(`no build has recorded this histogram (${POP}) — mould-build.sh must run --record-fill-state — ${scope}`);
      if (!sameHistogram(last.states, now))
        return bad(`the live histogram is not the last recorded build's (${last.git_sha.slice(0, 7)}, ${last.at.slice(0, 16)}) — ` +
          `a write since that build, or the build did not record — ${scope}`);
      if (!prev) return ok(`the seven states partition all ${total.toLocaleString()} ${POP}; recorded ${last.at.slice(0, 16)} ` +
        `(${last.git_sha.slice(0, 7)}), the first record under this population: the baseline; ${bar}`);
      const p = prev.states;
      const rev = [
        now.filled < (p.filled ?? 0) ? `filled ${p.filled} -> ${now.filled}` : "",
        now.unverified_seed > (p.unverified_seed ?? 0) ? `unverified_seed ${p.unverified_seed} -> ${now.unverified_seed}` : "",
        now.mined_from_eol > (p.mined_from_eol ?? 0) ? `mined_from_eol ${p.mined_from_eol} -> ${now.mined_from_eol}` : "",
      ].filter(Boolean);
      let why = "";
      if (rev.length) {
        const runs = (await query<{ id: string; kind: string }>(
          "SELECT id::text AS id, kind FROM runs WHERE status = 'succeeded' AND finished_at > $1 AND finished_at <= $2 ORDER BY id",
          [prev.at, last.at])).rows;
        if (!runs.length) return bad(`a reversal with no recorded run between ${prev.at.slice(0, 16)} and ${last.at.slice(0, 16)}: ${rev.join(", ")} — ${scope}`);
        why = `; reversal ${rev.join(", ")} stands on ${runs.length} run(s) between the records: ${runs.slice(0, 6).map((r) => `${r.kind} ${r.id}`).join(", ")}`;
      }
      return ok(`the seven states partition all ${total.toLocaleString()} ${POP}; recorded ${last.at.slice(0, 16)} ` +
        `(${last.git_sha.slice(0, 7)}); direction vs ${prev.at.slice(0, 16)} holds${why}; ${bar}`);
    },
    // The classifier is the thing under test, so the fixture drives IT and not a proxy. A seeded value
    // on a real datasheet must not be filled; a table-read value on a datasheet must be.
    selfTest: async () => {
      // the REAL classifier (fillState), never a copy of it: a seeded value on a real datasheet must not be filled, a
      // shipping-class value must be derived_operational (not mined_non_spec_doc, not filled), a table read must be filled
      const row = (method: string, inherited: boolean, doc_type: string | null) => ({ method, inherited, doc_type, n: 1 });
      return { negative: fillState(row("hexcat_seed", false, "vendor_datasheet_html")) === "filled"
                 || fillState(row("derived:shipping-class", false, "reference_table")) !== "derived_operational",
               positive: fillState(row("html_table", false, "vendor_datasheet_html")) === "filled",
               note: "a hexcat_seed value on a real datasheet must NOT count as filled, a shipping-class value is derived_operational; a table-read value is filled" };
    },
  },
  {
    name: "conflicts_classified",
    findings: "N33, N51–N53",
    needsDb: true,
    // A CONFLICT WITH NO CLASS IS A ROW NOBODY CAN ACT ON. "These two disagree" is not a job; "the
    // splitter produced two halves of one list" is. The four classes send a reader to four different
    // places -- two sources genuinely disagree, one document's multi-column reader mis-paired cells,
    // the normaliser split one value in two, or a later revision changed the figure -- and only the
    // first is a question about the world.
    //
    // ORPHANS ARE THE SHARPER HALF: a conflict whose part holds no live fact for that key is a
    // disagreement about nothing. ATA191-PWR carries 11 of them. Those inflate the conflict count and
    // can never be resolved, because there is no value to choose between.
    run: async () => {
      let total = 0, unclassed = 0, orphan = 0, classes: { c: string; n: string }[] = [];
      try {
        const t = await query<{ n: string }>("SELECT count(*)::text AS n FROM conflicts WHERE resolved_at IS NULL");
        total = Number(t.rows[0].n);
        // `conflict` IS A SERVED STATE FOR THIS QUESTION, and leaving it out was the defect (28 Sep 2026).
        // This predicate read `state IN ('verified','corroborated')` and reported 12,874 orphans with the
        // message "the part holds no live fact for that key, so they disagree about nothing and can never be
        // resolved". Split by what the part ACTUALLY holds:
        //
        //     live fact, state conflict         12,275   <- the state a fact is SUPPOSED to be in while a
        //                                                   conflict is open. rollbackRun recomputes exactly
        //                                                   this ("an open conflicts row -> conflict"), and
        //                                                   invariant 5 is its converse. Not orphans.
        //     live fact, state gap_unattempted     589   <- REAL: the value was retracted and the conflict
        //                                                   stayed open, so it disagrees about nothing
        //     live fact, state not_applicable       10   <- REAL, same shape
        //     no live fact at all                     0
        //
        // So the true orphan count is 599, and 12,275 healthy rows were being reported as unresolvable. The
        // number was found by running the check's OWN query rather than a reconstruction of it: my first
        // version dropped the state filter and returned ZERO orphans, which is how far apart the two
        // definitions are. This is not a narrowing to make the test pass -- it stays red on `unclassed`,
        // which is the finding it exists for.
        const o = await query<{ n: string }>(
          "SELECT count(*)::text AS n FROM conflicts k WHERE k.resolved_at IS NULL AND NOT EXISTS (" +
          " SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key" +
          " AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated','conflict'))");
        orphan = Number(o.rows[0].n);
      } catch (e) {
        return none(`could not read conflicts: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (total === 0) return none("no open conflict exists, so there is nothing to classify (producer: the merge)");
      try {
        const c = await query<{ c: string; n: string }>(
          "SELECT coalesce(class, '(none)') AS c, count(*)::text AS n FROM conflicts" +
          " WHERE resolved_at IS NULL GROUP BY 1 ORDER BY count(*) DESC");
        classes = c.rows;
        unclassed = Number(c.rows.find((x) => x.c === "(none)")?.n ?? 0);
      } catch {
        // No `class` column at all is the strongest form of the finding, not a reason to go quiet.
        unclassed = total;
        classes = [{ c: "(no class column exists)", n: String(total) }];
      }
      const scope = `${total.toLocaleString()} open conflicts; classes: ${classes.map((x) => `${x.c} ${x.n}`).join(", ")}`;
      // PLAN A10 IN FULL (ruling Q11, 29 Sep 2026): a class on every open row, no orphan, AND no open normaliser-split -- a split
      // is the normaliser disagreeing with itself over one cell, which is a defect to reconcile, never a standing disagreement.
      const split = Number(classes.find((x) => x.c === "normaliser-split")?.n ?? 0);
      const fails = [unclassed ? `${unclassed.toLocaleString()} open conflicts carry no class` : "",
        orphan ? `${orphan.toLocaleString()} are ORPHANS — the part holds no live fact for that key in any state a reader would serve or dispute, so they disagree about nothing and can never be resolved` : "",
        split ? `${split.toLocaleString()} are NORMALISER-SPLIT — one cell read two ways, to be reconciled` : ""].filter(Boolean);
      return fails.length === 0
        ? ok(`every open conflict carries a class, disagrees about a value that exists, and none is the normaliser against itself — ${scope}`)
        : bad(`${fails.join("; ")} — ${scope}`);
    },
    // Through the REAL classifier (src/core/conflictClass.ts, the writer's and the backfill's): two cells of one URL must NOT read
    // as a source disagreement, a cell whose raw text changed across fetches must be revision-drift and one text read twice a
    // split; two URLs are the only source-disagreement.
    selfTest: async () => {
      const { conflictClass } = await import("../src/core/conflictClass.js");
      const a = { doc_id: "d1", locator: "t1:r2:c3", extracted_at: "2026-09-03", norm_v: "1.5.0" };
      const negative = conflictClass(a, { ...a, locator: "t1:r2:c4" }) === "source-disagreement"
        || conflictClass(a, { ...a, extracted_at: "2026-09-20" }, { kept_raw: "0.28 lb", rejected_raw: "0.30 lb" }) !== "revision-drift"
        || conflictClass(null, a) !== null;
      const positive = conflictClass(a, { ...a, doc_id: "d2" }) === "source-disagreement"
        && conflictClass(a, { ...a, locator: "t1:r2:c4" }) === "same-doc-multicolumn"
        && conflictClass(a, { ...a, norm_v: "1.8.6" }, { kept_raw: "0.28 lb (0.13 kg)", rejected_raw: "0.28 lb (0.13 kg)" }) === "normaliser-split";
      return { negative, positive,
               note: "one URL two cells is multicolumn (never a source disagreement); a changed raw across fetches is revision-drift; no evidence object is null, never guessed; two URLs disagree; one text read twice is a split" };
    },
  },
  {
    name: "doc_category_by_relevance",
    findings: "N39, N48, N49, N64",
    needsDb: true,
    // A DOCUMENT'S CLASS DECIDES WHETHER ITS FACTS COUNT, so a class assigned by anything other than
    // what the document CONTAINS is a number with a guess inside it. Two things are asserted: that
    // "spec-bearing" is decided by whether the document actually holds specification tables, and that
    // every document is titled -- an untitled document cannot be reviewed by a person, and 105 of them
    // is 105 decisions nobody can check.
    //
    // The measured reason this matters: End-of-Life bulletins BIND many SKUs and carry no
    // specifications (4.9 facts/doc against 49.7 for an HTML datasheet), so filing them as spec-bearing
    // makes every coverage figure rise while page depth does not move.
    run: async () => {
      let rows: { doc_type: string | null; titled: number; untitled: number; n: number }[];
      try {
        const r = await query<{ doc_type: string | null; titled: string; untitled: string; n: string }>(
          "SELECT doc_type, count(*) FILTER (WHERE title IS NOT NULL AND title <> '')::text AS titled," +
          " count(*) FILTER (WHERE title IS NULL OR title = '')::text AS untitled, count(*)::text AS n" +
          " FROM source_docs GROUP BY 1 ORDER BY count(*) DESC");
        rows = r.rows.map((x) => ({ doc_type: x.doc_type, titled: Number(x.titled), untitled: Number(x.untitled), n: Number(x.n) }));
      } catch (e) {
        return none(`could not read source_docs: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no document exists to classify");
      const total = rows.reduce((n, r) => n + r.n, 0);
      const unclassed = rows.filter((r) => !r.doc_type).reduce((n, r) => n + r.n, 0);
      // SCOPED TO READABLE PAGES (reviewer ruling 28 Sep; decision 2026-09-28-untitled-documents). A title
      // can only come from a page someone can read: 942 of 1,029 cache_paths name a file on NEITHER machine
      // (40/40 control), so demanding a title of them demands the impossible. `cache_path IS NOT NULL` is an
      // INTENTION recorded at fetch time, so readability is checked on disk here, never assumed from the
      // column -- and the unreadable are printed as their own numbers, never dropped from the output.
      const CACHE = process.env.CACHE_DIR ?? path.join(REPO, "scraper", "cache");
      const unt = (await query<{ cache_path: string | null; title_state: string | null }>(
        "SELECT cache_path, title_state FROM source_docs WHERE title IS NULL OR title = ''")).rows;
      let readable = 0, gone = 0, never = 0, namedNone = 0;
      for (const u of unt) {
        if (!u.cache_path) never++;
        else if (!existsSync(path.join(CACHE, u.cache_path))) gone++;
        else if (untitledCounts(u.title_state)) readable++;
        else namedNone++;
      }
      // A cache dir that holds NONE of the titled documents' files is the wrong directory, not a wiped
      // corpus: the control is asked before any zero is believed.
      const ctl = (await query<{ cache_path: string }>(
        "SELECT cache_path FROM source_docs WHERE title <> '' AND cache_path IS NOT NULL ORDER BY doc_id LIMIT 40")).rows;
      const ctlHit = ctl.filter((c) => existsSync(path.join(CACHE, c.cache_path))).length;
      if (ctl.length && ctlHit === 0) return na(`cache control: 0 of ${ctl.length} titled documents' files are in ` +
        `${CACHE} — wrong CACHE_DIR, so readability cannot be judged`);
      // READABILITY IS A FACT ABOUT ONE MACHINE (reviewer, 29 Sep 2026): the laptop cache held 4 untitled files the box's
      // does not, so the laptop read red where the box read green. The line names the host it ran on, and a file absent
      // here is "not in this machine's cache", never "on no machine" -- this check never looked at any other machine.
      const scope = `${total.toLocaleString()} documents across ${rows.length} types; ${unt.length.toLocaleString()} ` +
        `untitled = ${readable} readable + ${namedNone} readable with title_state none (the file carries no title; ruled) + ` +
        `${gone} not in this machine's cache + ${never} never cached; ` +
        `ran on ${os.hostname()}, cache ${CACHE} (control ${ctlHit}/${ctl.length})`;
      return readable === 0 && unclassed === 0
        ? ok(`every readable document carries a title and every document a type — ${scope}`)
        : bad(`${readable.toLocaleString()} READABLE documents have no title and ${unclassed.toLocaleString()} ` +
              `carry no type — ${scope}`);
    },
    selfTest: async () => {
      // An EoL bulletin is not spec-bearing however many parts it names: it BINDS SKUs and carries no
      // specifications. That is the misclassification this test exists to prevent.
      const SPEC_BEARING = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"]);
      const specBearing = (t: string) => SPEC_BEARING.has(t);
      return { negative: specBearing("vendor_eol_bulletin") || !untitledCounts(null),
               positive: specBearing("vendor_datasheet_html") && !untitledCounts("none"),
               note: "an EoL bulletin must not be spec-bearing, and a readable untitled document with no recorded state must " +
                 "count; an HTML datasheet must be spec-bearing, and title_state none must not count" };
    },
  },
  {
    name: "dictionary_in_sync",
    findings: "reviewer 29 Sep (C)",
    needsDb: true,
    // THE TABLE /v1/fields SERVES MUST BE THE DICTIONARY THE CODE DECLARES. From run 1250 to run 1320 every sync was
    // REFUSED by its own reshape guard -- correctly worded, and read by nobody -- so the API served a dictionary older than
    // the profiles every artefact is built from. Asked by running the REAL syncDictionaryOn into a transaction that is
    // always rolled back, never by re-comparing the tables here: a hand comparison of the same rows reported 19 false
    // differences (jsonb reorders object keys). A lock it cannot take in 5 s is could-not-check, never a verdict.
    run: async () => {
      let outcome: SyncOutcome;
      let c: import("pg").PoolClient;
      try { c = await getPool().connect(); } catch (e) { return na(`could not connect: ${e instanceof Error ? e.message : String(e)}`); }
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL lock_timeout = '5s'");
        try {
          outcome = { result: await syncDictionaryOn(c, { quiet: true }) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/lock timeout/i.test(msg)) return na(`could not take the dictionary's row locks in 5 s: ${msg.slice(0, 160)}`);
          outcome = { refused: msg };
        }
      } catch (e) {
        return na(`could not open the rolled-back sync: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        try { await c.query("ROLLBACK"); } catch { /* the connection is already gone; nothing was committed */ }
        c.release();
      }
      const v = syncDriftVerdict(outcome);
      const scope = `${dictionaryRows().length} keys and ${profileRows().length} profile rows in code, asked by a rolled-back sync`;
      return v.inSync ? ok(`${v.detail} — ${scope}`) : bad(`${v.detail} — ${scope}`);
    },
    selfTest: async () => {
      const clean = { inserted: 0, updated: 0, profiles_inserted: 0, profiles_updated: 0, reshaped: [] };
      const reshapedNotSynced = { ...clean, updated: 1, reshaped: [{ key: "tdp", changed: ["band null->[5,400]"], facts: 1841,
        replayed_from_value: 1652, would_refuse_by_vendor: {}, sample: [] }] };
      return {
        negative: syncDriftVerdict({ result: reshapedNotSynced }).inSync
          || syncDriftVerdict({ refused: "dictionary sync: REFUSED — 1 reshaped key(s) would refuse values" }).inSync,
        positive: syncDriftVerdict({ result: clean }).inSync,
        note: "a reshaped key not yet synced, and a sync that would refuse, must fail; a sync that would change nothing must pass",
      };
    },
  },
  {
    name: "relations_for_components",
    findings: "N54",
    needsDb: true,
    // "WHAT DOES THIS FIT" IS A RELATION, NOT A STRING. `product_compatibility` is required of every
    // component and holds 77 facts across the whole catalogue -- and reading them shows why a string
    // was always the wrong instrument: "with no PSU", "All Flash", "includes 18x10/25-Gbps" sit beside
    // real references like NCS4200 and Cisco 1841. A cup that answers "what does this fit" by holding
    // prose cannot be filtered, compared or rendered, which is what the cup is for.
    //
    // So the question this asks is the one the answer should come from: does the component have a
    // sourced RELATION to the thing it fits? A relation has a from, a to, a kind and a document; a
    // string has none of those, and no amount of grammar makes one into the other.
    run: async () => {
      let facts = 0, relations = 0, kinds: { k: string; n: string }[] = [];
      try {
        const f = await query<{ n: string }>(
          "SELECT count(*)::text AS n FROM facts WHERE field_key = 'product_compatibility'" +
          " AND superseded_by IS NULL AND state IN ('verified','corroborated')");
        facts = Number(f.rows[0].n);
        const r = await query<{ k: string; n: string }>(
          "SELECT kind AS k, count(*)::text AS n FROM relations GROUP BY 1 ORDER BY count(*) DESC");
        kinds = r.rows;
        relations = r.rows.filter((x) => /compat|option_of|fits/i.test(x.k)).reduce((n, x) => n + Number(x.n), 0);
      } catch (e) {
        return none(`could not read relations or product_compatibility facts: ${e instanceof Error ? e.message : String(e)}`);
      }
      const scope = `${facts} product_compatibility FACTS; ${relations.toLocaleString()} compatibility RELATIONS; ` +
        `relation kinds present: ${kinds.slice(0, 6).map((x) => `${x.k} ${Number(x.n).toLocaleString()}`).join(", ")}`;
      return facts === 0 && relations > 0
        ? ok(`compatibility is expressed as relations and not as strings — ${scope}`)
        : bad(`compatibility is answered by ${facts} prose FACTS and ${relations} relations — a cup holding ` +
              `"with no PSU" and "All Flash" cannot be filtered, compared or rendered, which is what the ` +
              `cup is for — ${scope}`);
    },
    selfTest: async () => {
      // A relation is sourced and structured; a string is neither. The fixture asserts the shape,
      // because that is the whole claim.
      const isRelation = (x: { from?: string; to?: string; kind?: string; doc?: string } | string) =>
        typeof x !== "string" && Boolean(x.from && x.to && x.kind && x.doc);
      return { negative: isRelation("with no PSU"),
               positive: isRelation({ from: "2D-C2-1025WAC=", to: "NCS4200", kind: "option_of", doc: "abc123" }),
               note: "a prose string must not count as compatibility; a sourced from/to/kind/doc relation must" };
    },
  },
  {
    name: "name_image_lifecycle_state",
    findings: "N16, N56, N58",
    needsDb: true,
    // "Cisco C9200-24P" IS NOT A NAME, IT IS THE SKU WITH A WORD IN FRONT. A part whose name is its own
    // SKU has never had a name read for it, and the difference is invisible to every check that asks
    // "is name null" -- which is why the state has to be stored rather than inferred. Same for an
    // image: showing the SERIES photograph is a legitimate answer, showing nothing is a legitimate
    // answer, and pretending the two are the same is not.
    //
    // Lifecycle is the one with teeth: `unknown-unchecked` and `unknown-checked` are different facts
    // about our own work, and only the second is a finding about the vendor.
    run: async () => {
      let rows: { n: number; skuOnly: number; noName: number }[];
      try {
        const r = await query<{ n: string; sku_only: string; no_name: string }>(
          "SELECT count(*)::text AS n," +
          " count(*) FILTER (WHERE p.name IS NOT NULL AND upper(replace(p.name, ' ', '')) LIKE '%' || upper(replace(p.sku, ' ', '')) || '%'" +
          "   AND length(p.name) <= length(p.sku) + 8)::text AS sku_only," +
          " count(*) FILTER (WHERE p.name IS NULL OR p.name = '')::text AS no_name" +
          " FROM parts p WHERE p.retired_at IS NULL");
        rows = [{ n: Number(r.rows[0].n), skuOnly: Number(r.rows[0].sku_only), noName: Number(r.rows[0].no_name) }];
      } catch (e) {
        return none(`could not read part names: ${e instanceof Error ? e.message : String(e)}`);
      }
      const x = rows[0];
      const cols = await partsColumns();
      const stored = ["name_state", "image_state", "lifecycle_state"].filter((c) => cols.have.has(c));
      const scope = `${x.n.toLocaleString()} live parts; ${x.skuOnly.toLocaleString()} carry a name that is ` +
        `their own SKU with a word in front; ${x.noName.toLocaleString()} have no name at all; ` +
        `${stored.length} of 3 state columns exist (${stored.join(", ") || "none"})`;
      // THE TEST IS THAT THE DISTINCTION IS RECORDABLE, NOT THAT IT IS ZERO. The first version also
      // demanded skuOnly === 0, which no amount of work can satisfy: a part whose vendor never
      // published a name will be sku-only for ever, so the test could only be red for a reason
      // nobody can act on. That is the same defect as counting licences in unknown_zero's
      // denominator, and it was mine twice in one day.
      //
      // What IS checkable: the three columns exist, every live part carries all three, and no value
      // outside the closed sets can exist because the database refuses one. The COUNTS are then a
      // finding for the acquisition lane rather than a failure of the mould.
      const unset = await query<{ n: string }>(
        "SELECT count(*)::text AS n FROM parts WHERE retired_at IS NULL AND" +
        " (name_state IS NULL OR image_state IS NULL OR lifecycle_state IS NULL)").catch(() => ({ rows: [{ n: "-1" }] }));
      const missing = Number(unset.rows[0].n);
      if (stored.length !== 3) {
        return bad(`${3 - stored.length} of the three state columns do not exist, so "has a name" cannot ` +
          `be told from "has a REAL name" at all — ${scope}`);
      }
      if (missing !== 0) {
        return bad(`${missing.toLocaleString()} live parts carry no state, so the distinction exists in the ` +
          `schema and not in the data — ${scope}`);
      }
      return ok(`every live part records what its name, image and lifecycle actually are — ${scope}; ` +
        `${x.skuOnly.toLocaleString()} are sku-only, which is now RECORDED rather than invisible and is ` +
        `work for the name lane, not a defect in the mould`);
    },
    selfTest: async () => {
      const realName = (sku: string, name: string) =>
        name.replace(/\s+/g, "").toUpperCase() !== `CISCO${sku.replace(/\s+/g, "").toUpperCase()}`;
      return { negative: realName("C9200-24P", "Cisco C9200-24P"),
               positive: realName("C9200-24P", "Cisco Catalyst 9200 24-port PoE+ Switch"),
               note: "a name that is just the SKU with a word in front must not count as a name; a real one must" };
    },
  },
  {
    name: "export_profiles_roundtrip",
    findings: "S1–S9, STEP 9; rulings Q12 + Q18",
    // THIS IS THE TEST THE WHOLE MOULD IS FOR. The catalogue exists so a JTL shop can be loaded from it. Ruling Q12: "the check
    // asserts the CONTRACT, not a 200" -- FOUR profiles (Q18: Main 18 ';', Attributes 4, Condition 3, FAQ 3 force-quoted), UTF-8
    // BOM + CRLF, the exact Wawi groups 'Switch' (20) and 'Transceivers & SFP Modul' (14), German decimals, a sanitized URL path,
    // no condition prose, and ONE Artikelnummer set across the four files. Asked of the DEPLOYED API (R3), with the key.
    //
    // Two scopes, because they answer different questions. EVERY page of the vendor's shop_ready set checks the ROW contract on
    // real rows -- an empty file proves only the header, so a vendor with no ready part is could-not-check, never a pass. The
    // ACCEPTANCE SKUs are asked through jtl-readiness and printed with their reasons: a not-ready acceptance SKU is the fill
    // lane's number (standing order 3-4), not a contract defect, and is never folded into the verdict.
    run: async () => {
      const BASE = process.env.NETZSPEC_API ?? "https://api.netzspec.com";
      const ACCEPTANCE = ["C9200-24P", "C9200-48P-E", "C9300-48P", "SFP-10G-SR", "QSFP-100G-CU3M", "QDD-400G-DR4"];
      try {
        const c = await fetch(`${BASE}/health`, { headers: { "user-agent": "netzspec-mould-verify/1.0" }, signal: AbortSignal.timeout(20_000) });
        if (c.status !== 200) return none(`the control /health answered ${c.status} at ${BASE} — a fact about the network from here, not about the export`);
      } catch (e) { return none(`the control /health could not be reached at ${BASE}: ${e instanceof Error ? e.message : String(e)}`); }
      const fails: string[] = [], sets = new Map<string, Set<string>>();
      let rowsChecked = 0, locked = 0;
      // EVERY page of every profile, walked by X-Next-Cursor: the shop_ready set is the vendor's, and a first page alone may hold
      // no ready part at all (SKU order puts them anywhere). Capped, and a cap reached is named, never read as the end.
      let pages = 0, capped = false;
      for (const p of JTL_PROFILES) {
        const set = new Set<string>();
        let cursor: string | null = null, n = 0;
        do {
          let res: Response;
          try {
            res = await fetch(`${BASE}/v1/export?profile=${p}&vendor=${OWN_VENDOR}&limit=2000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
              { headers: apiHeaders(), signal: AbortSignal.timeout(120_000) });
          } catch (e) { fails.push(`${p} unreachable: ${e instanceof Error ? e.message : String(e)}`); break; }
          if (res.status === 401 || res.status === 403) { locked++; break; }
          if (res.status !== 200) { fails.push(`${p} -> ${res.status}`); break; }
          // RAW BYTES, then a decoder told to KEEP the BOM: fetch's res.text() decodes through a TextDecoder that strips it, so the
          // first deployed run read every page as 'no UTF-8 BOM' about files that carry one (29 Sep 2026). The instrument hid the thing.
          const bytes = new Uint8Array(await res.arrayBuffer());
          const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
          const r = jtlContractProblems(p, body, res.headers.get("content-type"));
          if (r.problems.length) fails.push(`${p} page ${n + 1}: ${r.problems.slice(0, 3).join("; ")}${r.problems.length > 3 ? ` … +${r.problems.length - 3}` : ""}`);
          rowsChecked += r.rows.length;
          for (const row of r.rows) set.add(row[0]);
          cursor = res.headers.get("x-next-cursor"); n++; pages++;
          if (n >= 60 && cursor) { capped = true; fails.push(`${p}: stopped at the 60-page cap with pages left — the set below is not the vendor's`); break; }
        } while (cursor);
        sets.set(p, set);
      }
      void capped;
      if (locked) return none(`${locked} of ${JTL_PROFILES.length} profiles need an API key this environment does not hold — the FILES were not validated, could-not-check, not a pass`);
      const main = [...(sets.get("jtl-main") ?? [])].sort().join("|");
      const mismatch = [...sets].filter(([, s]) => [...s].sort().join("|") !== main).map(([p]) => p);
      if (mismatch.length) fails.push(`the Artikelnummer set differs from jtl-main in ${mismatch.join(", ")} (the importer's one-set rule)`);
      let accept = "readiness not read";
      try {
        const rr = await fetch(`${BASE}/v1/export?profile=jtl-readiness&vendor=${OWN_VENDOR}&skus=${ACCEPTANCE.join(",")}`, { headers: apiHeaders(), signal: AbortSignal.timeout(60_000) });
        if (rr.status === 200) {
          const j = (await rr.json()) as { skus?: { sku: string; ready: boolean; reasons: string[] }[] };
          accept = (j.skus ?? []).map((s) => (s.ready ? `${s.sku} READY` : `${s.sku} not ready (${s.reasons.slice(0, 3).join(", ")})`)).join("; ");
          const found = new Set((j.skus ?? []).map((s) => s.sku));
          const absent = ACCEPTANCE.filter((s) => !found.has(s));
          if (absent.length) accept += `; not live hardware: ${absent.join(", ")}`;
        } else accept = `jtl-readiness answered ${rr.status}`;
      } catch (e) { accept = `jtl-readiness unreachable: ${e instanceof Error ? e.message : String(e)}`; }
      const scope = `${JTL_PROFILES.length} profiles walked page by page (${pages} pages of ≤ 2000 ${OWN_VENDOR} hardware parts) asked of ${BASE}; ` +
        `${rowsChecked} data rows checked, ${sets.get("jtl-main")?.size ?? 0} shop_ready parts; acceptance: ${accept}`;
      if (fails.length) return bad(`the served files break the JTL contract — ${fails.join(" || ")} — ${scope}`);
      if (!(sets.get("jtl-main")?.size)) return none(`every file matches the contract but holds NO data row (no shop_ready part in the vendor), so the ROW contract was not exercised — could-not-check, not a pass — ${scope}`);
      return ok(`the four JTL files match the recorded contract on real rows — ${scope}`);
    },
    // THE CONTRACT CHECKER, without the network: a planted broken file must be refused for its reason, and the twin that the
    // real writer produces must pass (tests/jtlExport.test.ts carries the full sabotage set).
    selfTest: async () => {
      const body = csvFile("jtl-condition", [["X-1", "condition", "new"]]);
      const negative = jtlContractProblems("jtl-condition", body.slice(1), "text/csv").problems.length === 0;   // no BOM: must be refused
      const positive = jtlContractProblems("jtl-condition", body, "text/csv; charset=utf-8").problems.length === 0;
      return { negative, positive, note: "a Condition file without its BOM must be refused; the writer's own file must pass the contract" };
    },
  },
  {
    name: "openapi_schemas",
    findings: "N63",
    // A PUBLISHED SCHEMA IS A CONSUMER. This repo learned that the hard way on 27 Sep: two new fields
    // were verified by calling the record builder directly and were present -- and absent from every
    // HTTP response, because Fastify strips any key the response schema does not declare. "I called
    // the function and saw the field" is a producer-level check; the schema is what a client gets.
    //
    // So this asks the DEPLOYED /openapi.json whether the shapes a consumer needs are declared at all.
    // Unreachable is not empty: the control is asked first and its failure is reported as mine.
    run: async () => {
      const BASE = process.env.NETZSPEC_API ?? "https://api.netzspec.com";
      let doc: { components?: { schemas?: Record<string, unknown> }; paths?: Record<string, unknown> };
      try {
        const res = await fetch(`${BASE}/openapi.json`, {
          headers: { "user-agent": "netzspec-mould-verify/1.0" }, signal: AbortSignal.timeout(20_000),
        });
        if (res.status !== 200) return none(`/openapi.json answered ${res.status} on ${BASE} — the document ` +
          `could not be read, which is not the same as it declaring nothing`);
        doc = (await res.json()) as typeof doc;
      } catch (e) {
        return none(`/openapi.json could not be reached at ${BASE}: ${e instanceof Error ? e.message : String(e)}`);
      }
      // `Model` routes at /v1/models/{vendor}/{model} (reviewer ruling 28 Sep; a schema with no route is not green).
      const have = Object.keys(doc.components?.schemas ?? {});
      const paths = Object.keys(doc.paths ?? {});
      const missing = openapiMissing(have, paths);
      const scope = `${have.length} schemas declared on the deployment, ${paths.length} paths; ` +
        `${OPENAPI_WANTED.length} wanted, ${Object.keys(OPENAPI_ROUTE_FOR).length} of them held to a route`;
      return missing.length === 0
        ? ok(`every shape a consumer needs is declared, and every level shape routes — ${scope}`)
        : bad(`${missing.length} consumer shapes are NOT served — ${scope}: ${missing.join(", ")}`);
    },
    selfTest: async () => {
      const all = OPENAPI_WANTED;
      const routes = Object.values(OPENAPI_ROUTE_FOR);
      return { negative: openapiMissing(all, routes.filter((r) => !r.startsWith("/v1/models"))).length === 0,
               positive: openapiMissing(all, routes).length === 0,
               note: "Model declared with no /v1/models route must fail (reviewer, 28 Sep); every shape declared and routed must pass" };
    },
  },
  {
    name: "endpoints_alive",
    findings: "N43, N44, N69",
    // R3: GREEN IS CLAIMED ONLY AGAINST THE DEPLOYED API. This is the test that makes that literal --
    // it asks the public URL, not a laptop, so a route that works locally and 404s in production
    // cannot read as alive. Every route the reviewer re-checks from /v1 is here.
    //
    // A network failure is NOT a failing route. If the control cannot be reached the whole run is
    // NOT EXERCISED, because "the API is broken" and "I could not get there" are different findings
    // and this repo has paid for confusing them more than once.
    run: async () => {
      const BASE = process.env.NETZSPEC_API ?? "https://api.netzspec.com";
      const get = async (path: string): Promise<{ status: number; body: string } | null> => {
        try {
          const res = await fetch(BASE + path, {
            headers: apiHeaders(),
            signal: AbortSignal.timeout(20_000),
          });
          return { status: res.status, body: (await res.text()).slice(0, 2000) };
        } catch { return null; }
      };
      const control = await get("/health");
      if (!control) return none(`the control /health could not be reached at ${BASE} — this is a fact about the ` +
        `network from here, NOT about the routes (producer: run again with reachability, or set NETZSPEC_API)`);
      // /v1/report takes the name the route itself lists (reportNames, the route's own function): a hand-typed file name
      // would go stale the day a report is renamed and read exactly like an outage.
      const { reportNames } = await import("../src/api/routes/start.js");
      const firstReport = reportNames()[0];
      if (!firstReport) return none(`no committed report to ask /v1/report for (docs/reports holds none) — a probe I cannot form is MY defect`);
      const ROUTES = [
        "/openapi.json", "/v1/fields?category=switches", "/v1/parts?vendor=cisco&limit=1",
        // /v1/stats/gaps, NOT /v1/gaps. The first run of this test reported the latter as a dead
        // route on the deployment; the route was never called that. A path I typed from memory is
        // a fact about my memory, and it reads EXACTLY like an outage -- the second time today
        // this test manufactured a finding about the API out of its own input.
        // AND THE THIRD TIME, 29 Sep, with the key: `/v1/report` without its required `name`, `limit` on a route that accepts
        // only vendor/category, and bare SKUs where /v1/compare wants vendor:sku -- three 400s reported as dead routes.
        `/v1/report?name=${encodeURIComponent(firstReport)}`, "/v1/search?q=C9200-24P", "/v1/stats/gaps?vendor=cisco",
        "/v1/completeness/cisco", "/v1/compare?skus=cisco:C9200-24P,cisco:C9200-48P",
      ];
      // THREE OUTCOMES, AND 401 IS NOT ONE OF THE BAD ONES. A 401 proves the route EXISTS and is
      // protected -- strictly more than a 404 tells you. Counting it as dead would have reported
      // "7 of 8 routes do not answer" about an API that was working perfectly, which is this repo's
      // most expensive recurring mistake in a new place.
      // EVERY PATH IS CHECKED AGAINST THE SOURCE BEFORE IT IS ASKED. A 404 from a path nobody ever
      // registered is a typo wearing an outage's clothes, and this test produced exactly that on
      // its first run. A path with no matching app.get in src/api/routes is reported as MY defect,
      // separately, and never counted as a dead route.
      const fsm = await import("node:fs"), pathm = await import("node:path");
      const { REPO_ROOT: RR } = await import("../src/config.js");
      const routeSrc = fsm.readdirSync(pathm.join(RR, "src", "api", "routes"))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => fsm.readFileSync(pathm.join(RR, "src", "api", "routes", f), "utf8")).join(String.fromCharCode(10));
      // PARAMETERISED ROUTES, which the first version of this guard could not see: it matched the
      // asked path as a literal string, so `/v1/completeness/cisco` was reported unregistered while
      // `/completeness/:vendor` sat in the source. A guard that only knows one spelling cries wolf on
      // correct code -- so every declared path is turned into a pattern and the asked path matched
      // against it, `:param` standing for one segment.
      // EVERY PATH-SHAPED STRING LITERAL in the routes directory, not `app.get(...)` specifically.
      // The first version anchored on `app.get<?[^>]*>?\(` and silently missed every GENERIC route --
      // `app.get<{ Querystring: Static<typeof Query> }>("/stats/gaps", …)` contains a `>` inside the
      // type argument, so the character class stopped early and the path was never collected. It then
      // reported six correctly-registered routes as unregistered, which is a guard crying wolf on
      // clean code. Over-collecting is the safe direction here: a path nobody ever wrote still appears
      // nowhere, which is the only case this guard exists to catch.
      const declared = [...routeSrc.matchAll(/["'`](\/[A-Za-z0-9/:._-]*)["'`]/g)].map((m) => m[1]);
      const matches = (asked: string) => declared.some((d) => {
        const rx = new RegExp("^" + d.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "$");
        return rx.test(asked);
      });
      const unregistered = ROUTES.filter((r) => {
        const bare = r.split("?")[0].replace(/^\/v1/, "");
        return bare !== "/openapi.json" && !matches(bare);
      });
      const dead: string[] = [];        // 404 / 5xx: the route's fault
      const locked: string[] = [];      // 401 / 403: alive, and I have no key — could-not-check
      const refused: string[] = [];     // 400 / 422: alive, and MY request was malformed — could-not-check, and my defect
      const unreachable: string[] = []; // no answer at all: mine, not theirs
      for (const r of ROUTES) {
        const res = await get(r);
        const v = routeVerdict(res);
        if (v === "unreachable") unreachable.push(r);
        else if (v === "locked") locked.push(`${r} -> ${res!.status}`);
        else if (v === "refused") refused.push(`${r} -> ${res!.status} ${res!.body.slice(0, 140)}`);
        else if (v === "dead") dead.push(`${r} -> ${res!.status}`);
      }
      const hasKey = Boolean(process.env.NETZSPEC_API_KEY);
      const scope = `${ROUTES.length} routes asked of ${BASE} (control /health ${control.status}); ` +
        `${dead.length} dead, ${refused.length} refused my request, ${locked.length} alive-but-authenticated, ${unreachable.length} unreachable`;
      if (unregistered.length) return none(`${unregistered.length} of the paths this test asks for are registered nowhere in src/api/routes — that is MY defect, not the deployment's, and a 404 from such a path would read exactly like an outage: ${unregistered.join(", ")}`);
      if (dead.length) return bad(`${dead.length} routes are genuinely DEAD on the deployment — ${scope}: ${dead.join(", ")}`);
      if (refused.length) return none(`${refused.length} probes were REFUSED as malformed — the route answered, so it is alive, and the request is MY defect, not the deployment's — ${scope}: ${refused.join(" | ")}`);
      if (unreachable.length) return none(`${unreachable.length} routes could not be reached while the control answered — ${scope}`);
      if (locked.length) {
        return none(`no route is dead, but ${locked.length} of ${ROUTES.length} need an API key this ` +
          `environment does not hold${hasKey ? " (NETZSPEC_API_KEY is set but was refused)" : " (NETZSPEC_API_KEY is not set)"} — ` +
          `a 401 proves the route EXISTS and is protected, which is more than a 404 would, so this is ` +
          `COULD-NOT-CHECK and not a pass — ${scope}`);
      }
      return ok(`every declared route answers 200 on the deployment — ${scope}`);
    },
    // The predicate is "200 and reachable", and its two failure modes must stay apart: a 404 is the
    // route's fault, an unreachable host is mine. The fixture proves the test can tell them apart
    // without going near the network.
    // The three verdicts must stay apart, so the fixture asserts the CLASSIFIER and not just "200".
    // 404 is dead, 401 is alive-and-locked, no answer is mine — and the first live run proved why
    // this matters: it called seven authenticated routes dead before this branch existed.
    selfTest: async () => {
      // the check's OWN classifier (routeVerdict), not a copy of it: the copy that lived here could only agree with itself
      const negative = routeVerdict({ status: 404 }) !== "dead" || routeVerdict({ status: 500 }) !== "dead";   // want FALSE
      const positive = routeVerdict({ status: 401 }) === "locked" && routeVerdict({ status: 200 }) === "alive"
        && routeVerdict(null) === "unreachable" && routeVerdict({ status: 400 }) === "refused";
      return { negative, positive,
               note: "404/500 must classify as dead; 401 as alive-but-locked, 400 as refused (my malformed probe), 200 as alive, no answer as unreachable — never folded together" };
    },
  },
  {
    name: "link_integrity",
    findings: "H",
    // WRITTEN WHILE IT IS GREEN, ON PURPOSE. The plan says so and it is the right instinct: a property
    // nothing asserts is a property that holds until the day it does not, and nobody finds out. Every
    // href on the arrangement site must resolve, and every category page must link its layers page and
    // back, because a one-way link is how a reader reaches a leaf and cannot get out.
    //
    // NOT EXERCISED when the site is not built here -- an absent artefact is not zero broken links -- and when the site here is
    // from another build than the artefacts (siteBuildProblem): the first site mould-build produced had no layer pages at all
    // (build-layers ran without --site), 16 links into layers/ resolved to nothing, and only this check said so.
    run: async () => {
      const { REPO_ROOT } = await import("../src/config.js");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const SITE = path.join(REPO_ROOT, "data", "site");
      if (!fs.existsSync(SITE)) {
        return none(`the arrangement site is not built in this tree (${path.relative(REPO_ROOT, SITE)} does not ` +
          `exist) — an absent artefact is NOT zero broken links (producer: mould:build, B1)`);
      }
      const stale = await siteBuildProblem(SITE, path.join(REPO_ROOT, "data", "completeness", `${OWN_VENDOR}.json`));
      if (stale) return none(`the site here is not this build's: ${stale} — its links prove nothing about these artefacts (producer: mould:build)`);
      const { pages, checked, broken } = await siteLinkReport(SITE);
      if (!pages) return none(`the site directory holds no HTML page (producer: mould:build, B1)`);
      const scope = `${checked.toLocaleString()} internal hrefs across ${pages} pages`;
      return broken.length === 0
        ? ok(`every internal link on the arrangement site resolves — ${scope}`)
        : bad(`${broken.length} internal links do not resolve — ${scope}: ${broken.slice(0, 5).join(", ")}`);
    },
    // Over REAL directories, through the check's own two functions: a site with one dangling href, and a site whose links all
    // resolve but whose BUILD.json names another build than its report -- each must be refused, and the clean twin accepted.
    selfTest: async () => {
      const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "link-integrity-"));
      const SHA = "d2bd6200e8dd4d8edad10c12d44a1b813194dead";
      const make = (name: string, pages: Record<string, string>, sha: string) => {
        const site = path.join(root, name, "site"), report = path.join(root, name, "report.json");
        for (const [f, html] of Object.entries(pages)) { fs.mkdirSync(path.dirname(path.join(site, f)), { recursive: true }); fs.writeFileSync(path.join(site, f), html); }
        fs.writeFileSync(path.join(site, "BUILD.json"), JSON.stringify({ git_sha: sha }));
        fs.writeFileSync(report, JSON.stringify({ built_on_commit: SHA.slice(0, 7) }));
        return { site, report };
      };
      const accepts = async (s: { site: string; report: string }) =>
        (await siteBuildProblem(s.site, s.report)) === null && (await siteLinkReport(s.site)).broken.length === 0;
      const good = { "index.html": `<a href="layers/index.html">l</a>`, "layers/index.html": `<a href="../index.html">back</a>` };
      try {
        const dangling = make("dangling", { ...good, "index.html": `<a href="layers/index.html">l</a><a href="layers/switches.html">s</a>` }, SHA);
        const stale = make("stale", good, "129f847cf897" + SHA.slice(12));
        const clean = make("clean", good, SHA);
        return { negative: (await accepts(dangling)) || (await accepts(stale)), positive: await accepts(clean),
                 note: "a dangling href must fail, and so must a clean site from ANOTHER build (stale BUILD.json); the clean same-build twin passes" };
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: "keys_hygiene",
    findings: "N70 (reclassified) — the reviewer's control, added 27 Sep",
    needsDb: true,
    // WHY THIS EXISTS. I rotated the reviewer's API key by revoking the id I remembered — 15,
    // "claude-web-url". The reviewer never had it. The token it had been using all day hashed to a row
    // called "owner" (id 2), minted 9 Sep, which had appeared VERBATIM in an audit prompt on 12 Sep and was
    // therefore in chat transcripts for three weeks. So the rotation revoked a key nobody held and left the
    // exposed one live, and both of us believed it was done: I said "the old one is revoked", the reviewer
    // said "revocation is not enforced", and neither was true — we were talking about different rows.
    //
    // The missing control is not "enforce revocation" (auth.ts:133 already does). It is that a key must
    // name its HOLDER and its CHANNEL, and a rotation must revoke by the hash of the token being replaced
    // rather than by an id from memory. Two active keys here are both called "netzspec"; one was last used
    // three weeks ago and one is in use today, and nothing on the row says which belongs to what.
    run: async () => {
      // Hand-written, and deliberately so: a list of what is EXCLUDED stays short, every line needs a
      // reason, and a key minted tomorrow is NOT admitted silently — which is the whole point here.
      const KNOWN: Record<number, string> = {
        3: "in daily use — presumed the netzspec.com site; holder unconfirmed, see below",
        16: "the reviewer, minted 27 Sep 2026, read scope",
        17: "the verifier on the box (mould-verify), minted 29 Sep 2026, read scope; token only in /root/netzspec-verifier.env (mode 600)",
      };
      const rows = (await query<{ id: number; name: string; last: string | null; scopes: string[] }>(`
        SELECT id, name, last_used_at::text last, scopes FROM api_keys WHERE revoked_at IS NULL ORDER BY id`)).rows;
      const problems: string[] = [];
      const unknown = rows.filter((r) => !(r.id in KNOWN));
      for (const r of unknown) problems.push(`id ${r.id} "${r.name}" active with no recorded holder (last used ${r.last ?? "never"})`);
      const byName = new Map<string, number[]>();
      for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r.id]);
      for (const [n, ids] of byName) if (ids.length > 1) problems.push(`${ids.length} active keys share the name "${n}" (ids ${ids.join(", ")}) — a rotation cannot tell them apart`);
      const write = rows.filter((r) => !r.scopes.every((sc) => sc === "read"));
      for (const r of write) problems.push(`id ${r.id} "${r.name}" is not read-only (${r.scopes.join(",")})`);
      return problems.length === 0
        ? ok(`${rows.length} active keys, each with a recorded holder and a unique name`)
        : bad(`${problems.length} of ${rows.length} active keys: ${problems.join("; ")}`);
    },
  },
  {
    name: "brand_isolation",
    findings: "operator 27 Sep — NOT one of the brief's 27, added because the brief has no test for it",
    needsDb: true,
    // vendor_coverage asks "which brands have no mould". This asks the sharper question the operator put:
    // is a brand WITHOUT a mould being measured by another brand's? Profiles are keyed by category, never by
    // vendor, so the answer was yes and silently: every non-cisco part in `switches` is asked for the cups
    // that were designed by reading cisco switches. Until this is zero, no statement about "cisco's mould is
    // complete" can be trusted, because cisco's denominators contain other brands' parts.
    run: async () => {
      const vendors = (await query<{ slug: string }>(`SELECT slug FROM vendors`)).rows.map((r) => r.slug);
      const arranged = new Set(mouldStatuses(vendors).filter((s) => s.arranged).map((s) => s.vendor));
      if (!arranged.size) return na("no brand has a mould at all — nothing to isolate");
      const rows = (await query<{ vendor: string; parts: string; req: string }>(`
        SELECT v.slug vendor, count(*)::text parts, coalesce(sum(cp.required_total),0)::text req
          FROM completeness cp JOIN parts p ON p.id=cp.part_id JOIN vendors v ON v.id=p.vendor_id
         WHERE p.retired_at IS NULL AND cp.no_profile = false AND NOT (v.slug = ANY($1::text[]))
         GROUP BY 1 ORDER BY 3 DESC`, [[...arranged]])).rows;
      if (!rows.length) return ok(`only arranged brands (${[...arranged].join(", ")}) carry a score`);
      const parts = rows.reduce((n, r) => n + Number(r.parts), 0);
      const slots = rows.reduce((n, r) => n + Number(r.req), 0);
      return bad(`${parts} parts of ${rows.length} UNARRANGED brands are scored against a mould built for `
        + `${[...arranged].join(", ")} — ${slots.toLocaleString()} required slots demanded of them: `
        + rows.slice(0, 5).map((r) => `${r.vendor} ${r.parts}p/${Number(r.req).toLocaleString()}s`).join(", "));
    },
  },
  {
    name: "no_profile_reason_recorded",
    findings: "reviewer 27 Sep — NO_MOULD_REASON exported and never written",
    needsDb: true,
    // `completeness.no_profile` was ONE boolean carrying FOUR unrelated facts: this brand has no mould, this
    // is a licence, the role table says this row is not the kind its category scores it as, and this category
    // has no profile at all. Each needs different work — arrange a brand, nothing, reclassify a part, build a
    // profile — so a single flag made the question unaskable, which is how 3,476 parts of twelve unarranged
    // brands sat inside Cisco's denominators unnoticed. Migration 0024 gives the row a reason and a rule id.
    //
    // TWO THINGS ARE CHECKED AND THEY FAIL FOR DIFFERENT REASONS.
    //
    // 1. The code's list against the SCHEMA's, in both directions. Nothing in this repo had ever compared a
    //    TypeScript list to the constraint that governs it, so every agreement check was comparing one
    //    hand-written list with another hand-written list. That is not a check; a value added to the code and
    //    not to the constraint fails on the first write, and one added to the constraint and not the code is a
    //    value no writer can ever produce.
    // 2. The pairing invariant over LIVE rows, in both directions: an unscored row must say why, and a scored
    //    row must not claim a reason. The first direction is the one that matters — a row marked not-scored
    //    with a NULL reason is precisely the state this column exists to end — and it is also the state every
    //    row was in before the backfill, so this check is what proves the backfill actually ran.
    run: async () => {
      const def = (await query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname = 'completeness_no_profile_reason_ck'`)).rows;
      if (!def.length) return bad("the CHECK constraint completeness_no_profile_reason_ck is missing — migration 0024 has not run here");
      const inSchema = new Set([...def[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]));
      const inCode = new Set<string>(NO_PROFILE_REASONS);
      const codeOnly = [...inCode].filter((r) => !inSchema.has(r));
      const schemaOnly = [...inSchema].filter((r) => !inCode.has(r));
      if (codeOnly.length || schemaOnly.length) {
        return bad(`the reason list disagrees with the schema: ${codeOnly.length ? "in code only " + codeOnly.join(", ") : ""}`
          + `${codeOnly.length && schemaOnly.length ? "; " : ""}${schemaOnly.length ? "in the constraint only " + schemaOnly.join(", ") : ""}`);
      }
      const inv = (await query<{ missing: string; spurious: string; rule_wrong: string }>(`
        SELECT count(*) FILTER (WHERE no_profile = true  AND no_profile_reason IS NULL)     missing,
               count(*) FILTER (WHERE no_profile = false AND no_profile_reason IS NOT NULL) spurious,
               count(*) FILTER (WHERE no_profile_rule IS NOT NULL
                                  AND no_profile_reason IS DISTINCT FROM 'kind_refused_by_role_table') rule_wrong
          FROM completeness cm JOIN parts p ON p.id = cm.part_id WHERE p.retired_at IS NULL`)).rows[0];
      const missing = Number(inv.missing), spurious = Number(inv.spurious), ruleWrong = Number(inv.rule_wrong);
      const by = (await query<{ r: string; n: string }>(`
        SELECT coalesce(no_profile_reason, '(null)') r, count(*) n
          FROM completeness cm JOIN parts p ON p.id = cm.part_id
         WHERE p.retired_at IS NULL AND cm.no_profile = true GROUP BY 1 ORDER BY count(*) DESC`)).rows;
      const breakdown = by.map((x) => `${x.r} ${Number(x.n).toLocaleString()}`).join(", ");
      if (missing || spurious || ruleWrong) {
        return bad(`${missing.toLocaleString()} unscored row(s) do not say WHY, ${spurious} scored row(s) claim a reason, `
          + `${ruleWrong} rule id(s) on a non-refusal — recompute has not backfilled every category. Breakdown: ${breakdown}`);
      }
      return ok(`${inCode.size} reasons, code and constraint agree both ways; every unscored row names one: ${breakdown}`);
    },
  },
  {
    name: "derived_gate_nulls",
    findings: "reviewer item 3 / D1 — a derived gate that derives to nothing",
    needsDb: true,
    // `deploy_role` is DERIVED from the SKU, not extracted, so "no value" cannot mean "nobody has scraped it
    // yet" — it means the rule table could not place the part, and no amount of scraping will change that.
    // This counts the nulls per (category, kind) and splits them by WHY, because the three reasons need
    // opposite handling and only one of them is a defect:
    //
    //   an ISSUE rule refuses the row   the table says it is not this kind. 18 PON rows; they leave the
    //                                   score entirely (completeness.no_profile_reason).
    //   axis exists, no rule matches    COULD-NOT-DERIVE. This is the one that must be zero: the part is
    //                                   scored, its role-gated cups go `pending`, and nothing can ever
    //                                   answer them. A number here is work, not noise.
    //   no role axis for the kind       not counted at all — a CPU has no deployment role.
    //
    // THE DENOMINATOR IS ASSERTED, NOT JUST THE NULLS (the reviewer's condition, and it is the sharp part).
    // A check that only counts nulls gets GREENER when a kind loses its axis by accident: the parts stop
    // being asked, the nulls go to zero, and nothing says the population vanished. So every pair AXIS
    // declares must still hold parts, and the total is printed on every run.
    //
    // FLOORS, NOT EXACT EQUALITY, and the reason is stated rather than assumed: this catalogue grows, so an
    // exact 9,010 would go red on the next import of real switches and teach everyone to ignore the colour.
    // A floor still fails in the direction that matters — a pair emptying, or the population shrinking —
    // which is the accident the reviewer named.
    run: async () => {
      const FLOOR: Record<string, number> = {  // measured 27 Sep 2026, cisco live hardware
        // switches|switch 4242 -> 4224 (28 Sep 2026): ruling 12b re-kinded the 18 PON rows ont / olt with their own cups -- an
        // explained shrink, re-recorded here rather than widened; the 18 are no longer asked for a switch role at all.
        "switches|switch": 4224, "routers|router": 1288, "routers|sp-router": 264,
        "wireless|ap": 2767, "collaboration-endpoints|phone": 442, "unified-communications|phone": 7,
      };
      const rows = (await query<{ sku: string; name: string | null; cat: string; product_class: string }>(`
        SELECT p.sku, p.name, c.slug cat, p.product_class::text AS product_class FROM parts p
          JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
         WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`)).rows;
      const seen = new Map<string, number>();
      let axisParts = 0, refused = 0, couldNotDerive = 0;
      const cnd: string[] = [];
      for (const r of rows) {
        const kind = partKind(r.cat, r.sku, r.name ?? undefined, r.product_class);
        if (!roleAxisOf(r.cat, kind)) continue;              // no axis: not this check's population
        axisParts++;
        seen.set(`${r.cat}|${kind}`, (seen.get(`${r.cat}|${kind}`) ?? 0) + 1);
        const res = deployRoleResult(r.cat, kind, r.sku, r.name);
        if (res.role !== null) continue;
        if (res.issue) { refused++; continue; }
        couldNotDerive++;
        if (cnd.length < 6) cnd.push(`${r.sku} (${r.cat}/${kind})`);
      }
      // NO POPULATION IS ITS OWN VERDICT, not a pass. Run this against a brand with no role-bearing kind
      // and every count below is 0 and every floor comparison is vacuous -- which reads exactly like
      // "all roles derived cleanly". It says so instead. This is also what makes `none()` a state with a
      // producer rather than a word in the vocabulary that nothing ever emits.
      if (axisParts === 0) {
        return none(`no part of any role-bearing (category, kind) pair exists here, so there is no role `
          + `derivation to judge -- this is not "all roles derived", it is nothing to derive`);
      }
      const shrunk = Object.entries(FLOOR).filter(([k, n]) => (seen.get(k) ?? 0) < n)
        .map(([k, n]) => `${k} ${seen.get(k) ?? 0} < ${n}`);
      const total = axisParts.toLocaleString();
      if (shrunk.length) {
        return bad(`a role-bearing population SHRANK, so fewer parts are being asked for a role than when this was `
          + `measured — a kind that loses its axis makes a null count greener, which is why this is here: ${shrunk.join(", ")}`);
      }
      if (couldNotDerive > 0) {
        return bad(`${couldNotDerive} part(s) of a role-bearing kind have a role that CANNOT BE DERIVED — their role-gated `
          + `cups are pending on a field nothing can ever answer: ${cnd.join(", ")}`);
      }
      return ok(`${total} parts of ${seen.size} role-bearing (category, kind) pairs, every floor held; `
        + `roles derived on all but ${refused} the table REFUSES as the wrong kind (they leave the score with a reason)`);
    },
  },
  {
    name: "vendor_coverage",
    findings: "N62",
    needsDb: true,
    // The mould is Cisco-only and the shop imports every vendor. N62 named five; the query counts them. Its HPE
    // figure and mine disagree, which is printed rather than reconciled silently — a coverage number nobody
    // can reproduce is the thing this whole exercise exists to stop.
    run: async () => {
      const rows = (await query<{ vendor: string; n: string }>(`
        SELECT v.slug vendor, count(*)::text n FROM parts p JOIN vendors v ON v.id=p.vendor_id
         WHERE v.slug <> $1 AND p.retired_at IS NULL AND p.product_class='hardware'
         GROUP BY 1 ORDER BY 2 DESC`, [OWN_VENDOR])).rows;
      const total = rows.reduce((n, r) => n + Number(r.n), 0);
      if (!rows.length) return ok("cisco is the only vendor with live hardware parts");
      const list = rows.map((r) => `${r.vendor} ${r.n}`).join(", ");
      // WHAT CLOSING THIS WILL DO, said now so it is not read as a regression then (reviewer, 27 Sep 2026).
      // The 22-row cup decision of 2026-09-27-a-kinds-cup-set-follows-the-physical-object.md measured ZERO
      // non-cisco parts reached — and that zero is STRUCTURAL, not safety: a query on `sku_kind` cannot reach a
      // part that has none. Across the eight categories that decision touches these vendors hold 1,369 live
      // hardware parts (hpe 857, aruba 354, juniper 119, mikrotik 39) and not one carries a kind. The day this
      // test goes green, all 22 rows land on those parts at once, as gaps. That is correct — a kind's cup set
      // follows the physical object, and an HPE power supply has an input voltage for the same reason a Cisco
      // one does — and someone reading the completeness report that morning should expect the drop.
      return bad(`${rows.length} vendors hold ${total} live hardware parts with NO layering, ledger or kinds: ${list}`
        + ` — N62 named five of these ${rows.length}. WHEN THIS CLOSES: 1,369 of them sit in the eight categories`
        + ` the 22-row cup decision touches, so those rows land on them in one step, as gaps. Expected, not a regression`);
    },
  },
];

// ---- run ----------------------------------------------------------------------------------------------------------
const noDb = process.argv.includes("--no-db");
// `--only a,b` runs just the named checks while one is being worked on. Every summary line then says FILTERED, because a
// filtered run is not the board and must never be read or recorded as one; an unknown name is refused, not skipped.
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : null; })();
if (ONLY) {
  const unknown = ONLY.filter((n) => !TESTS.some((t) => t.name === n));
  if (unknown.length || !ONLY.length) { console.error(`--only names no declared check: ${unknown.join(", ") || "(empty)"}`); process.exit(2); }
}
const RUN = ONLY ? TESTS.filter((t) => ONLY.includes(t.name)) : TESTS;
const FILTERED = ONLY ? `   FILTERED by --only: ${RUN.length} of ${TESTS.length} declared, this is NOT the board` : "";

// ---- `--self-test`: prove each check CAN fail, before believing what it says about the corpus ----
//
// R2 of the plan to all green: "a test is written when ... `--self-test` proves the negative fixture
// fails it". A check that is red today is not thereby a check that WORKS -- it can be red because the
// corpus is broken while its predicate cannot actually distinguish anything, which is how four checks
// in one session came to be "checking nothing" with their populations empty by construction.
//
// A test WITHOUT a selfTest is reported as UNPROVEN and counted separately. That is deliberate: an
// unproven check must not read as a proven one, and folding the two together is the same defect as
// could-not-check passing as checked.
if (process.argv.includes("--self-test")) {
  let proven = 0, broken = 0, unproven = 0;
  const bad: string[] = [];
  console.log(`mould:verify --self-test — can each of the ${TESTS.length} declared tests actually fail?${FILTERED}\n`);
  for (const t of RUN) {
    if (!t.selfTest) {
      unproven++;
      console.log(`  ....  ${t.name.padEnd(30)} UNPROVEN          no negative fixture declared`);
      continue;
    }
    try {
      const r = await t.selfTest();
      if (r.negative === false && r.positive === true) {
        proven++;
        console.log(`  PASS  ${t.name.padEnd(30)} refuses the broken input, accepts the twin — ${r.note}`);
      } else {
        broken++; bad.push(t.name);
        console.log(`  FAIL  ${t.name.padEnd(30)} negative=${r.negative} positive=${r.positive} (want false/true) — ${r.note}`);
      }
    } catch (e) {
      broken++; bad.push(t.name);
      console.log(`  FAIL  ${t.name.padEnd(30)} self-test threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n  proven ${proven}   BROKEN ${broken}   unproven ${unproven}   (of ${TESTS.length} declared)${FILTERED}`);
  if (bad.length) console.log(`  broken: ${bad.join(", ")}`);
  console.log(`  A check with no negative fixture has never been watched go red. UNPROVEN is not a pass.`);
  process.exit(broken ? 1 : 0);
}

let pass = 0, fail = 0, notImpl = 0, unavail = 0, notExercised = 0;
const failed: string[] = [];

console.log(`mould:verify — ${TESTS.length} tests declared${FILTERED}\n`);
for (const t of RUN) {
  if (!t.run) { notImpl++; console.log(`  ....  ${t.name.padEnd(30)} NOT IMPLEMENTED   (${t.findings})`); continue; }
  if (t.needsDb && noDb) { unavail++; console.log(`  ????  ${t.name.padEnd(30)} UNAVAILABLE       --no-db`); continue; }
  let r: Result;
  try { r = await t.run(); }
  catch (e) { r = na(`threw: ${e instanceof Error ? e.message : String(e)}`); }
  if (r.state === "pass") { pass++; console.log(`  PASS  ${t.name.padEnd(30)} ${r.detail}`); }
  else if (r.state === "fail") { fail++; failed.push(t.name); console.log(`  FAIL  ${t.name.padEnd(30)} ${r.detail}   (${t.findings})`); }
  else if (r.state === "not_exercised") { notExercised++; console.log(`  ----  ${t.name.padEnd(30)} NOT EXERCISED  ${r.detail}`); }
  else { unavail++; console.log(`  ????  ${t.name.padEnd(30)} UNAVAILABLE  ${r.detail}`); }
}

console.log(`\n  passed ${pass}   FAILED ${fail}   not implemented ${notImpl}   unavailable ${unavail}   not exercised ${notExercised}`
  + `   (of ${TESTS.length} declared)${FILTERED}`);
if (fail) console.log(`  failing: ${failed.join(", ")}`);
if (notExercised) console.log(`  ${notExercised} test(s) had NO POPULATION to judge - they neither passed nor failed; what they watch for has no members today.`);
if (notImpl) console.log(`  ${notImpl} declared tests are not written yet — this run does NOT certify their findings.`);
await closePool().catch(() => {});
process.exit(fail ? 1 : unavail ? 2 : 0);
