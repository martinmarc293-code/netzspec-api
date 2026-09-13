// tests/heldProvenance.test.ts — kind layer 6b (13 Sep 2026): the three rules the ledger and the completeness builds share
// and that only a build (with the store) runs, driven here without one.
//
//   npx tsx tests/heldProvenance.test.ts
//
//   1. HELD BY RELEVANCE (src/core/heldEvidence.ts): the SQL predicate both builders run and the JS predicate these cases
//      drive come from the same constants; the four-state partition; the refusal on underived spec-bearing rows.
//   2. MAPPER-GAP EVIDENCE (src/core/cupEvidence.ts): file validation, role-before-kind lookup, entries that match nothing.
//   3. KIND-ISSUE PLANS (src/core/kindLayerPlans.ts): plan status, the III.4 share excluding kind-issue rows, the display,
//      and the lease check — a kind-issue row still in its kind after its plan ran.
// Every rule gets a sabotage case that must fail FOR THAT REASON; each builder is scanned for the call, so a builder that
// quietly went back to the doc-type rule fails here too.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SPEC_BEARING_DOC_TYPES, HELD_LINK_BASES, HELD_RELEVANCE, LINK_BASES, DOC_RELEVANCES, heldRowSql, underivedRowSql, rowCountsAsHeld,
  docStateOf, heldByDocTypeLegacy, underivedRefusal, missingColumnsRefusal,
} from "../src/core/heldEvidence.js";
import { validateCupEvidence, loadCupEvidence, cupStateIndex, inertMapperGapEntries, type CupEvidenceEntry } from "../src/core/cupEvidence.js";
import {
  validatePlans, loadPlans, planStatusIndex, emptyBreakdown, addKindIssue, nullShareExcludingKindIssue, unresolvedDisplay,
  plansRanButStillInKind, KIND_LAYER_PLANS_FILE, type KindLayerPlan,
} from "../src/core/kindLayerPlans.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { ROLE_DOMAINS, roleAxisOf } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };
const throws = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return (e as Error).message; } };

// ==== 1. HELD BY RELEVANCE ============================================================================================
{
  // The truth table of the operator's rule over every (basis, relevance) pair the contract allows, plus NULLs.
  const bases = [...LINK_BASES, null], rels = [...DOC_RELEVANCES, null];
  const held: string[] = [];
  for (const b of bases) for (const r of rels) if (rowCountsAsHeld(b, r)) held.push(`${b}/${r}`);
  check("exactly explicit/spec_for_kind and family/spec_for_kind are held", held.sort().join(",") === "explicit/spec_for_kind,family/spec_for_kind", held.join(","));
  check("SABOTAGE an inferred link on a spec_for_kind document is NOT held", !rowCountsAsHeld("inferred", "spec_for_kind"));
  check("SABOTAGE an explicit link to a mere mention (ordering guide, EoL, feature sheet) is NOT held", !rowCountsAsHeld("explicit", "mention"));
  check("SABOTAGE an underived row (NULLs) is NOT held — and is refused upstream, never silently counted", !rowCountsAsHeld(null, null) && !rowCountsAsHeld("explicit", null));
  // ONE SOURCE: the SQL both builders run is generated from the same constants as the JS predicate.
  check("the held SQL names exactly the held relevance and the held bases",
    heldRowSql("dp") === `(dp.doc_relevance = '${HELD_RELEVANCE}' AND dp.link_basis IN (${HELD_LINK_BASES.map((b) => `'${b}'`).join(", ")}))`, heldRowSql("dp"));
  check("the held SQL does not admit inferred or mention", !heldRowSql().includes("'inferred'") && !heldRowSql().includes("'mention'"));
  check("the underived SQL tests both columns for NULL", underivedRowSql("x") === "(x.link_basis IS NULL OR x.doc_relevance IS NULL)");
  // The four-state partition.
  check("docState: a held row wins", docStateOf({ held_rows: 1, spec_rows: 3, any_rows: 5 }) === "held");
  check("docState: spec-bearing linked, no held row = spec_linked_not_held (held BEFORE the ruling)",
    docStateOf({ held_rows: 0, spec_rows: 2, any_rows: 2 }) === "spec_linked_not_held" && heldByDocTypeLegacy({ spec_rows: 2 }));
  check("docState: only non-spec documents = eol_only", docStateOf({ held_rows: 0, spec_rows: 0, any_rows: 1 }) === "eol_only");
  check("docState: nothing linked = no_document", docStateOf({ held_rows: 0, spec_rows: 0, any_rows: 0 }) === "no_document");
  // The refusal.
  check("CONTROL no underived rows = no refusal", underivedRefusal("cisco", 0, 0) === null);
  const ref = underivedRefusal("cisco", 12, 7);
  check("SABOTAGE 12 underived spec-bearing rows on 7 parts refuse the build, naming both counts", ref !== null && ref.includes("12 spec-bearing") && ref.includes("7 live cisco"), String(ref));
  check("SABOTAGE a doc_parts without the provenance columns refuses, naming them", missingColumnsRefusal(["link_basis"])?.includes("doc_relevance, link_evidence") === true);
  check("CONTROL all three columns present = no refusal", missingColumnsRefusal(["link_basis", "doc_relevance", "link_evidence"]) === null);
  check("the spec-bearing list is the ledger's (vendor_page included)", SPEC_BEARING_DOC_TYPES.includes("vendor_page") && SPEC_BEARING_DOC_TYPES.length === 4);
  // BOTH BUILDERS USE THE RULE — scanned, so a builder that went back to `doc_type = ANY(...)` for held fails here.
  for (const f of ["scripts/build-cup-ledger.mts", "scripts/build-completeness.mts"]) {
    const src = fs.readFileSync(path.resolve(f), "utf8");
    check(`${f} computes held with heldRowSql and refuses on underivedRowSql`, src.includes("heldRowSql(\"dp\")") && src.includes("underivedRowSql(\"dp\")") && src.includes("underivedRefusal("));
    check(`${f} partitions with docStateOf (four states)`, src.includes("docStateOf("));
    check(`${f} no longer declares its own spec-bearing list`, !/const (LEDGER_)?SPEC_BEARING(_DOC_TYPES)? = \[/.test(src));
  }
}

// ==== 2. MAPPER-GAP EVIDENCE ==========================================================================================
{
  const e = (o: Partial<CupEvidenceEntry>): CupEvidenceEntry => ({ category: "switches", kind: "switch", role: null, cup: "poe_standard", state: "mapper-gap",
    printed_pct: 66.6, mapped_pct: 0, held: 100, variants: [], ...o });
  check("CONTROL a well-formed file validates", validateCupEvidence([e({}), e({ role: "smb", state: "optional" })]).length === 0);
  check("CONTROL an empty array is a valid file (no measurement yet)", validateCupEvidence([]).length === 0);
  check("SABOTAGE a state outside the four is refused, naming it", validateCupEvidence([e({ state: "gap" as never })]).some((m) => m.includes('"gap"')));
  check("SABOTAGE the same (category, kind, role, cup) listed with two states is refused", validateCupEvidence([e({}), e({ state: "required" })]).some((m) => m.includes("twice")));
  check("SABOTAGE a non-array file is refused", validateCupEvidence({}).length === 1);
  check("SABOTAGE a missing role key (undefined, not null) is refused", validateCupEvidence([{ ...e({}), role: undefined }]).some((m) => m.includes("role")));
  // role before kind
  const idx = cupStateIndex([e({ state: "mapper-gap" }), e({ role: "smb", state: "optional" }), e({ cup: "stackable", role: "access", state: "mapper-gap" })]);
  check("kind-level mapper-gap applies to a role without its own entry", idx("switches", "switch", "datacenter", "poe_standard") === "mapper-gap");
  check("a ROLE entry wins over the kind entry (smb poe_standard is optional, not a mapper gap)", idx("switches", "switch", "smb", "poe_standard") === "optional");
  check("an unresolved part (role null) reads the kind level only", idx("switches", "switch", null, "poe_standard") === "mapper-gap" && idx("switches", "switch", null, "stackable") === undefined);
  check("SABOTAGE a role-level entry does not leak to another role", idx("switches", "switch", "smb", "stackable") === undefined);
  // entries that match nothing
  const askedOf = (category: string, kind: string, role: string | null) => {
    if (!LEDGER_KINDS[category]?.includes(kind)) return null;
    const axis = roleAxisOf(category, kind);
    if (role !== null && (!axis || !ROLE_DOMAINS[axis].includes(role))) return null;
    const q = kindQuestionSet(category, kind, role);
    return new Set([...q.required, ...q.pending.map((p) => p.key)]);
  };
  const realCup = kindQuestionSet("switches", "switch").required[0];
  check("CONTROL a mapper-gap entry on a cup the kind is asked applies", inertMapperGapEntries([e({ cup: realCup })], askedOf).length === 0, realCup);
  check("SABOTAGE a mapper-gap entry on a renamed/unknown kind is inert and named", inertMapperGapEntries([e({ kind: "enterprise-old" })], askedOf).some((m) => m.includes("no such kind")));
  check("SABOTAGE a mapper-gap entry on a role outside the domain is inert", inertMapperGapEntries([e({ cup: realCup, role: "tor" })], askedOf).length === 1);
  check("SABOTAGE a mapper-gap entry on a cup the kind is not asked is inert", inertMapperGapEntries([e({ cup: "wifi_generation" })], askedOf).some((m) => m.includes("not asked")));
  check("CONTROL an OPTIONAL entry is never judged inert (only mapper-gap entries move a slot)", inertMapperGapEntries([e({ cup: "wifi_generation", state: "optional" })], askedOf).length === 0);
  // the file loader
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cup-evidence-"));
  try {
    check("SABOTAGE a missing evidence file refuses the build (never mapper_gap 0 by absence)", (throws(() => loadCupEvidence(tmp, "cisco")) ?? "").includes("does not exist"));
    fs.mkdirSync(path.join(tmp, "data", "reference"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "data", "reference", "cup-evidence-cisco.json"), JSON.stringify([e({ state: "bogus" as never })]));
    check("SABOTAGE a malformed evidence file refuses the build", (throws(() => loadCupEvidence(tmp, "cisco")) ?? "").includes("malformed"));
    fs.writeFileSync(path.join(tmp, "data", "reference", "cup-evidence-cisco.json"), "[]");
    const ok = loadCupEvidence(tmp, "cisco");
    check("CONTROL [] loads with a sha", ok.entries.length === 0 && ok.sha256.length === 64);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ==== 3. KIND-ISSUE PLANS ============================================================================================
{
  const plans: KindLayerPlan[] = [
    { sku: "CP-8800-B-BEZEL", category: "collaboration-endpoints", action: "move", to: "collaboration-endpoints:mechanical", run_id: null },
    { sku: "N7K-SERVICES1K9", category: "switches", action: "class", to: "license", run_id: 1101 },
  ];
  check("CONTROL a well-formed plans file validates", validatePlans(plans).length === 0);
  check("SABOTAGE an action outside move/class is refused", validatePlans([{ ...plans[0], action: "delete" }]).some((m) => m.includes("delete")));
  check("SABOTAGE the same row planned twice is refused", validatePlans([plans[0], { ...plans[0], to: "x" }]).some((m) => m.includes("twice")));
  const status = planStatusIndex(plans);
  check("a plan with run_id null is pending", status("collaboration-endpoints", "cp-8800-b-bezel").status === "pending_plan");
  check("a plan with a run_id has run", status("switches", "N7K-SERVICES1K9").status === "plan_ran");
  check("a row nobody planned is unplanned", status("switches", "N7K-DP-CORE").status === "unplanned");
  check("SABOTAGE a spare (=) is its own row, not its base's plan", status("collaboration-endpoints", "CP-8800-B-BEZEL=").status === "unplanned");
  check("SABOTAGE a plan in another category does not apply", status("routers", "N7K-SERVICES1K9").status === "unplanned");
  // the breakdown, the share, the display
  const b = emptyBreakdown();
  for (let i = 0; i < 85; i++) addKindIssue(b, "pending_plan");
  check("85 pending kind-issue rows: kind_issue_parts 85, pending 85", b.kind_issue_parts === 85 && b.pending_plan === 85 && b.plan_ran === 0 && b.unplanned === 0);
  const share = nullShareExcludingKindIssue(513, 85, 85);
  check("collab phone (513 parts, 85 unresolved, all 85 kind-issue): 0 / 428 = 0%, under the bar", share.num === 0 && share.den === 428 && share.pct === 0 && !share.over_3pct, JSON.stringify(share));
  check("SABOTAGE the bar over ALL unresolved parts would read 16.6% and fail", nullShareExcludingKindIssue(513, 85, 0).pct === 16.6 && nullShareExcludingKindIssue(513, 85, 0).over_3pct);
  check("the display says \"(unresolved) N — K pending move/class\"", unresolvedDisplay(85, b) === "(unresolved) 85 — 85 pending move/class", unresolvedDisplay(85, b));
  const b2 = emptyBreakdown(); addKindIssue(b2, "pending_plan"); addKindIssue(b2, "unplanned"); addKindIssue(b2, "plan_ran");
  check("the display names unplanned rows and rows still here after their plan ran", unresolvedDisplay(9, b2).includes("1 kind-issue row(s) with no plan") && unresolvedDisplay(9, b2).includes("1 STILL HERE"));
  // the lease check
  const rows = [
    { category: "collaboration-endpoints", kind: "phone", sku: "CP-8800-B-BEZEL", ...status("collaboration-endpoints", "CP-8800-B-BEZEL") },
    { category: "switches", kind: "switch", sku: "N7K-SERVICES1K9", ...status("switches", "N7K-SERVICES1K9") },
  ];
  const ran = plansRanButStillInKind(rows);
  check("SABOTAGE a kind-issue row whose class plan ran (run 1101) and which is still a live switch fails the check, naming it and the run",
    ran.length === 1 && ran[0].includes("N7K-SERVICES1K9") && ran[0].includes("1101") && ran[0].includes("license"), ran.join("; "));
  check("CONTROL a pending plan is skipped (run_id null), not failed", plansRanButStillInKind(rows.slice(0, 1)).length === 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
  try {
    check("SABOTAGE a missing plans file refuses the build", (throws(() => loadPlans(tmp)) ?? "").includes("does not exist"));
    fs.mkdirSync(path.dirname(path.join(tmp, KIND_LAYER_PLANS_FILE)), { recursive: true });
    fs.writeFileSync(path.join(tmp, KIND_LAYER_PLANS_FILE), JSON.stringify([{ sku: "X", category: "switches", action: "move", to: "routers", run_id: "" }]));
    check("SABOTAGE an empty-string run_id is refused (null or a run id)", (throws(() => loadPlans(tmp)) ?? "").includes("run_id"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const f of ["scripts/build-cup-ledger.mts", "scripts/build-completeness.mts"]) {
    const src = fs.readFileSync(path.resolve(f), "utf8");
    check(`${f} runs the lease check (plansRanButStillInKind) and prints the display`, src.includes("plansRanButStillInKind(kindIssueRows)") && src.includes("unresolvedDisplay("));
  }
}

console.log(`    held provenance / mapper-gap / kind-issue plans: ${pass} passed, ${misses.length} missed`);
if (misses.length) { for (const m of misses) console.log(`    MISS ${m}`); process.exit(1); }
