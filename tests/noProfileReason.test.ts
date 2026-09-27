// tests/noProfileReason.test.ts — WHY a part is not scored, and the one distinction that decides it.
//
// `completeness.no_profile` carried four unrelated facts behind one boolean. The cost was measured on
// 27 Sep: 3,476 parts of twelve unarranged brands sat inside Cisco's denominators, and 18 GPON/XGS-PON
// rows the role table explicitly REFUSES as "not an Ethernet switch" were scored against the full
// switch profile anyway — 648 required slots, every one at pct 0 and unfillable by construction.
//
// THE DISTINCTION THIS FILE EXISTS TO DEFEND, because getting it backwards is the expensive direction:
//
//   axis exists, an ISSUE rule refuses the row   -> NOT SCORED. The table is saying "this is not that
//                                                   thing". Scoring it asks a PON ONT for stacking.
//   axis exists, no rule matches                 -> SCORED, gaps held open (pending). "We could not
//                                                   work it out" is could-not-check, and could-not-check
//                                                   must never remove a part from a denominator.
//   no role axis for this kind at all            -> SCORED. An accessory or a CPU has no deployment
//                                                   role and never will; its role-gated cups are
//                                                   already settled by the `kind` clause.
//
// The middle case is ZERO parts today — every role-bearing kind is placed 100% — so it is exactly the
// branch that would rot unnoticed. It is asserted here with a fabricated SKU no rule can match, which
// is the only way to reach it.
import { NO_PROFILE_REASONS, noProfileVerdict, roleTableRefusal } from "../src/core/noProfileReason.js";
import { deployRoleResult, roleAxisOf } from "../src/core/deployRole.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};
const ok = (name: string, cond: boolean): void => {
  if (cond) passed++; else { failed++; lines.push(`    MISS ${name}`); }
};

// ── the reason list ───────────────────────────────────────────────────────────────────────────────
// Four, and no duplicates. The count is written down so a fifth reason added without a test fails here
// rather than arriving silently — an exact count fails in BOTH directions, a floor only in one.
eq("four reasons, exactly", NO_PROFILE_REASONS.length, 4);
eq("no duplicate reason", new Set(NO_PROFILE_REASONS).size, NO_PROFILE_REASONS.length);
for (const r of ["brand_not_arranged", "non_hardware", "kind_refused_by_role_table", "category_has_no_profile"])
  ok(`declared: ${r}`, (NO_PROFILE_REASONS as readonly string[]).includes(r));

// ── the refusal, on the real rows it was written for ──────────────────────────────────────────────
// CONTROL FIRST: the rule must actually fire on these SKUs, or every assertion below is about nothing.
// A guard tested against an input it cannot reach reports the answer you were hoping for.
{
  const pon = ["CGP-OLT", "CGP-ONT-4PV", "ENC-10G-ONT-10"];
  for (const sku of pon) {
    const r = deployRoleResult("switches", "switch", sku, null);
    ok(`control: the role table really does refuse ${sku}`, r.issue !== null && r.rule === "sw.issue.ont");
  }
  const refusal = roleTableRefusal("switches", "switch", "CGP-ONT-4PV", null);
  eq("a PON ONT in switches is refused", refusal.refused, true);
  eq("...and carries the rule id, so the row can be traced without re-deriving", refusal.rule, "sw.issue.ont");
  eq("the verdict names it", noProfileVerdict({ arranged: true, isHardware: true, category: "switches", kind: "switch", sku: "CGP-ONT-4PV", name: null }).reason,
     "kind_refused_by_role_table");
}

// ── and NOT on anything else ──────────────────────────────────────────────────────────────────────
{
  // A real Ethernet switch: scored, no reason.
  const v = noProfileVerdict({ arranged: true, isHardware: true, category: "switches", kind: "switch", sku: "C9300-24P", name: "Catalyst 9300 24-port PoE+" });
  eq("a real switch is scored", v.scored, true);
  eq("...with no reason", v.reason, null);

  // THE COULD-NOT-DERIVE BRANCH. Zero parts today, so it can only be reached with a SKU no rule
  // matches. It must be SCORED: an unplaceable role keeps its gaps open, it does not leave the
  // denominator. Getting this wrong would delete parts from a count for the crime of being unknown.
  const fabricated = "ZZQQ-NO-RULE-CAN-MATCH-THIS-0000";
  const raw = deployRoleResult("routers", "router", fabricated, null);
  ok("control: the fabricated SKU really does reach could-not-derive (axis yes, no rule, no issue)",
     roleAxisOf("routers", "router") !== null && raw.role === null && raw.issue === null);
  eq("a role that cannot be DERIVED is not a refusal", roleTableRefusal("routers", "router", fabricated, null).refused, false);
  eq("...so the part is still scored", noProfileVerdict({ arranged: true, isHardware: true, category: "routers", kind: "router", sku: fabricated, name: null }).scored, true);

  // A kind with no role axis: also not a refusal, for a different reason.
  ok("control: an accessory genuinely has no role axis", roleAxisOf("wireless", "accessory") === null);
  eq("a kind with no role axis is not a refusal", roleTableRefusal("wireless", "accessory", "AIR-ACC1623", null).refused, false);
}

// ── order of the reasons, which reproduces the branches this replaced ─────────────────────────────
{
  // Non-hardware wins over brand: recompute's old guard read `product_class === "hardware" && !arranged`
  // first, so a licence has always been non-hardware whatever its brand. Asserted so a reordering that
  // looks tidier cannot quietly move every non-hardware part of an unarranged brand into another bucket.
  eq("a licence of an unarranged brand is non_hardware, not brand_not_arranged",
     noProfileVerdict({ arranged: false, isHardware: false, category: "switches", kind: "switch", sku: "L-FOO-K9", name: null }).reason, "non_hardware");
  eq("unarranged hardware is brand_not_arranged",
     noProfileVerdict({ arranged: false, isHardware: true, category: "switches", kind: "switch", sku: "JL123A", name: null }).reason, "brand_not_arranged");
  // And an unarranged brand must NOT be judged by Cisco's role table, which was never written for it —
  // even when its SKU would trip one of Cisco's rules.
  eq("an unarranged brand's PON-shaped SKU still reads brand_not_arranged, not a Cisco rule refusal",
     noProfileVerdict({ arranged: false, isHardware: true, category: "switches", kind: "switch", sku: "CGP-ONT-4PV", name: null }).reason, "brand_not_arranged");
  // A refusal is the only reason that carries a rule id.
  eq("brand_not_arranged carries no rule id",
     noProfileVerdict({ arranged: false, isHardware: true, category: "switches", kind: "switch", sku: "JL123A", name: null }).rule, null);
}

lines.unshift(`    no-profile reason: ${passed} passed, ${failed} missed ` +
              `(${NO_PROFILE_REASONS.length} reasons; refusal vs could-not-derive vs no-axis)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
