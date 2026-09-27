// src/core/noProfileReason.ts — WHY a part is not scored, decided in ONE place.
//
// `completeness.no_profile` is a single boolean that has been carrying three unrelated facts. The cost
// was measured on 27 Sep: 3,476 parts of twelve unarranged brands sat inside Cisco's denominators
// because "this brand has no mould" and "this is a licence" produced the identical row. This module
// names the reasons and decides between them once, so a second caller cannot invent a fourth spelling
// of the same idea — two scripts counting the same rows two ways is how the second one inherits the
// first one's bug.
//
// THE LIST IS A VALUE AND THE TYPE IS DERIVED FROM IT. A type alone cannot be iterated at runtime, so
// every consumer that needs the LIST hand-writes one, and hand-written lists of what exists are this
// repo's oldest named defect (two Sets of product_class values drifted from an eight-value enum and
// made 1,061 live parts unreachable by class filter). The domain also exists as a CHECK constraint in
// db/migrations/0024; tests/noProfileReason.test.ts reads that constraint out of pg_constraint and
// compares it to this array in BOTH directions, because comparing one hand-written list to another
// hand-written list is not a check.

import { deployRoleResult, roleAxisOf } from "./deployRole.js";

export const NO_PROFILE_REASONS = [
  /** The part's brand has no mould for this category — see src/core/brandMould.ts. */
  "brand_not_arranged",
  /** A licence, service or other non-subject: there is no specification to score, and never will be. */
  "non_hardware",
  /**
   * An ISSUE rule in the role table says this row is not the kind its category is scoring it as.
   * Today that is `sw.issue.ont`: 18 GPON/XGS-PON OLT and ONT rows sitting in `switches`, each asked
   * for the full Ethernet-switch set — stacking, PoE, fabric bandwidth, layer — that a PON ONT cannot
   * have. 648 required slots, every one at pct 0 and permanently unfillable. The refusal was computed
   * correctly on every run since the rule landed and consumed by nothing, which is the shape this repo
   * keeps paying for: a declared signal with no reader.
   */
  "kind_refused_by_role_table",
  /**
   * Arranged hardware whose CATEGORY has no cup profile at all, so there is nothing to score it
   * against. Decided downstream of `noProfileVerdict`, by `completenessV2` returning `no_profile`,
   * because only it knows whether PROFILES carries the category — which is why this value exists as a
   * constant rather than a branch here. It is in the list because without it a part would be marked
   * not-scored with a NULL reason, which is a row that says "not scored" and refuses to say why: the
   * precise defect this column was added to end, reintroduced one branch below it.
   */
  "category_has_no_profile",
] as const;

export type NoProfileReason = (typeof NO_PROFILE_REASONS)[number];

/** What is recorded on a part that IS scored. Kept explicit so "scored" is never a bare null by accident. */
export type NoProfileVerdict =
  | { scored: true; reason: null; rule: null }
  | { scored: false; reason: NoProfileReason; rule: string | null };

export const SCORED: NoProfileVerdict = { scored: true, reason: null, rule: null };

/**
 * Does the role table refuse this row as the wrong kind?
 *
 * Distinguished from every other null role ON PURPOSE, and the distinction is the whole finding. A role
 * is absent for three different reasons and only one of them is a refusal:
 *
 *   no role axis for this kind   an accessory, cpu, drive, tpm, speaker — correct, and its role-gated
 *                                cups are already settled by the `kind` clause. 10,703 parts, and
 *                                counting them was the wrong denominator.
 *   axis exists, no rule matches  could-not-derive. ZERO parts today: every role-bearing kind is placed
 *                                100% (router 1,288, sp-router 264, ap 2,767, phone 449).
 *   axis exists, an ISSUE rule    the table positively refuses the row. 18 parts, all `sw.issue.ont`.
 *
 * Only the third is a statement that the part is in the wrong place, so only the third stops the score.
 * A could-not-derive row must NOT reach here — it keeps its gaps open (pending) rather than leaving the
 * denominator, because "we could not work it out" and "it is not this thing" are opposite facts.
 */
export function roleTableRefusal(
  category: string, kind: string | null | undefined, sku: string, name?: string | null,
): { refused: boolean; rule: string | null; issue: string | null } {
  if (!roleAxisOf(category, kind)) return { refused: false, rule: null, issue: null };
  const r = deployRoleResult(category, kind, sku, name);
  if (!r.issue) return { refused: false, rule: null, issue: null };
  return { refused: true, rule: r.rule, issue: r.issue };
}

/**
 * The one decision. `arranged` and `isHardware` are passed in rather than computed here so this stays
 * pure and testable, and so the caller cannot accidentally ask a different question than the one it
 * then acts on.
 *
 * ORDER MATTERS, IT IS DELIBERATE, AND IT REPRODUCES THE EXISTING BRANCHES EXACTLY. Non-hardware
 * first: recompute's guard reads `product_class === "hardware" && !isArranged` and only then
 * `product_class !== "hardware"`, so a licence has always been counted as non-hardware whatever its
 * brand, and it should be — a licence has no specification to score under any mould, so that is the
 * more fundamental fact. Putting brand first here would silently move every non-hardware part of an
 * unarranged brand into a different bucket and change counts this change is not entitled to touch.
 * Then brand, because a part of an unarranged brand must report that rather than a kind refusal
 * derived from Cisco's role table, which was never written for it. The role refusal is last because it
 * is the only one that presumes the category's own mould applies to this part at all.
 */
export function noProfileVerdict(args: {
  arranged: boolean; isHardware: boolean;
  category: string; kind: string | null | undefined; sku: string; name?: string | null;
}): NoProfileVerdict {
  if (!args.isHardware) return { scored: false, reason: "non_hardware", rule: null };
  if (!args.arranged) return { scored: false, reason: "brand_not_arranged", rule: null };
  const refusal = roleTableRefusal(args.category, args.kind, args.sku, args.name);
  if (refusal.refused) return { scored: false, reason: "kind_refused_by_role_table", rule: refusal.rule };
  return SCORED;
}
