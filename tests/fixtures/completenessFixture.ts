// tests/fixtures/completenessFixture.ts — the consistent layer-3 + 6b sabotage base for the completeness report, shared by
// tests/completeness.test.ts and the /coverage board fixture (D:/tmp/kindlayer-impl/6-infra/board6b). ONE implementation:
// a fixture written twice is two fixtures that drift. Not a test file (the runner collects *.test.ts only).
import { pctOf, UNRESOLVED_ROLE, type Block, type CheckContext, type CompletenessReport, type KindBlock, type RoleBlock } from "../../src/api/queries/completeness.js";
import { ROLE_DOMAINS, roleAxisOf } from "../../src/core/deployRole.js";
import { emptyBreakdown, nullShareExcludingKindIssue, unresolvedDisplay, type KindIssueBreakdown } from "../../src/core/kindLayerPlans.js";

// ---- LAYER 3 + 6b FIXTURE (kind-layer infra, 13 Sep 2026) ---------------------------------------------------------------
// A report built before layer 3 has no roles blocks, and one built before 6b has no mapper_gap, no spec_linked_not_held,
// no held_by_doc_type_legacy and no kind-issue split — so those invariants can only be driven by a copy that has them.
// `fixture6b` makes such a copy CONSISTENT:
//   - every block without the 6b fields gets mapper_gap 0, spec_linked_not_held 0 and legacy = held (nothing moves);
//   - every role-axis kind lacking roles gets a split: the first role of the domain holds the kind minus one part,
//     `(unresolved)` holds that one part (held with no slots when the kind has a held part, else not held), every other
//     role is empty; every (unresolved) block gets kind_issue_parts 0, its split, the III.4 share and the display;
//   - ONE kind without roles has one eol-only part turned into spec_linked_not_held (legacy +1) through its category and
//     the brand, and the ledger context is shifted the same way, so the four-state held partition is exercised non-trivially.
// Consistent means every partition, denominator and percentage holds, so the untouched fixture must fail nothing, and each
// sabotage below breaks one thing.
export type Counters = { parts: number; asked: number; nothing: number; spec: number; specNotHeld: number; legacy: number; eol: number; none: number;
  slots: number; filled: number; notPub: number; notParsed: number; mapperGap: number; wr: number; notRendered: number; nhParts: number;
  nhSlots: number; nhFilled: number; wrNH: number; cnr: number; ph: number; inh: number };
export const countersOf = (b: Block): Counters => ({ parts: b.hardware_parts, asked: b.arranged.asked, nothing: b.arranged.asked_nothing_fallback,
  spec: b.held.spec_bearing, specNotHeld: b.held.spec_linked_not_held ?? 0,
  legacy: b.held.held_by_doc_type_legacy?.num ?? b.held.spec_bearing + (b.held.spec_linked_not_held ?? 0),
  eol: b.held.eol_only, none: b.held.no_document, slots: b.filled.required_slots_held, filled: b.filled.filled,
  notPub: b.filled.not_published, notParsed: b.filled.not_parsed, mapperGap: b.filled.mapper_gap ?? 0, wr: b.filled.would_refuse,
  notRendered: b.filled.filled_not_rendered, nhParts: b.filled.not_held_parts, nhSlots: b.filled.not_held_slots, nhFilled: b.filled.not_held_filled,
  wrNH: b.defects.would_refuse_not_held, cnr: b.defects.could_not_replay, ph: b.defects.placeholders_stored, inh: b.inherited_share.inherited });
export const blockOf = (c: Counters): Block => ({
  hardware_parts: c.parts,
  arranged: { asked: c.asked, asked_nothing_fallback: c.nothing, ...pctOf(c.asked, c.parts) },
  held: { spec_bearing: c.spec, spec_linked_not_held: c.specNotHeld, eol_only: c.eol, no_document: c.none,
    held_by_doc_type_legacy: pctOf(c.legacy, c.parts), ...pctOf(c.spec, c.parts) },
  filled: { required_slots_held: c.slots, filled: c.filled, not_published: c.notPub, not_parsed: c.notParsed, mapper_gap: c.mapperGap, would_refuse: c.wr,
    filled_not_rendered: c.notRendered, not_held_parts: c.nhParts, not_held_slots: c.nhSlots, not_held_filled: c.nhFilled, ...pctOf(c.filled + c.notPub, c.slots) },
  defects: { would_refuse: c.wr, would_refuse_not_held: c.wrNH, could_not_replay: c.cnr, placeholders_stored: c.ph },
  inherited_share: { inherited: c.inh, filled: c.filled, ...pctOf(c.inh, c.filled) },
});
export const ZERO: Counters = { parts: 0, asked: 0, nothing: 0, spec: 0, specNotHeld: 0, legacy: 0, eol: 0, none: 0, slots: 0, filled: 0, notPub: 0,
  notParsed: 0, mapperGap: 0, wr: 0, notRendered: 0, nhParts: 0, nhSlots: 0, nhFilled: 0, wrNH: 0, cnr: 0, ph: 0, inh: 0 };
export const roleBlockOf = (role: string, c: Counters, extra: Partial<RoleBlock> = {}): RoleBlock => ({ deploy_role: role, parts: c.parts, ...blockOf(c), ...extra });
/** The (unresolved) fields the ruling requires, from the real helpers the builds use. */
export const unresolvedFields = (kindParts: number, unresolvedParts: number, ki: KindIssueBreakdown = emptyBreakdown()): Partial<RoleBlock> => ({
  kind_issue_parts: ki.kind_issue_parts,
  kind_issue: { pending_plan: ki.pending_plan, plan_ran: ki.plan_ran, unplanned: ki.unplanned },
  null_share_excluding_kind_issue: nullShareExcludingKindIssue(kindParts, unresolvedParts, ki.kind_issue_parts),
  display: unresolvedDisplay(unresolvedParts, ki),
});
export const refresh = (b: Block, c: Counters) => { Object.assign(b, blockOf(c)); };
export function fixture6b(r: CompletenessReport): { report: CompletenessReport; synthesized: number; upgraded: number;
  shifted: { category: string; kind: string } | null; gapShifted: { category: string; kind: string; cup: string } | null } {
  const out = JSON.parse(JSON.stringify(r)) as CompletenessReport;
  let synthesized = 0, upgraded = 0;
  const upgrade = (b: Block) => { if (typeof b.held.spec_linked_not_held !== "number" || typeof b.filled.mapper_gap !== "number") { refresh(b, countersOf(b)); upgraded++; } };
  upgrade(out.brand);
  for (const c of out.categories) {
    upgrade(c);
    for (const k of c.kinds as KindBlock[]) {
      upgrade(k);
      for (const cup of k.cups) if (typeof cup.mapper_gap !== "number") cup.mapper_gap = 0;
      for (const [role, rb] of Object.entries(k.roles ?? {})) {
        upgrade(rb);
        if (role === UNRESOLVED_ROLE && rb.kind_issue === undefined) Object.assign(rb, unresolvedFields(k.parts, rb.parts));
      }
      const axis = roleAxisOf(c.category, k.kind);
      if (!axis || k.roles) continue;
      synthesized++;
      const kc = countersOf(k);
      const d: Counters = { ...ZERO };
      if (kc.parts >= 2) {
        d.parts = 1;
        if (kc.asked > 0) d.asked = 1; else d.nothing = 1;
        if (kc.spec > 0) { d.spec = 1; d.legacy = 1; } else { d.nhParts = 1; if (kc.eol > 0) d.eol = 1; else d.none = 1; }
      }
      const main = Object.fromEntries(Object.entries(kc).map(([f, v]) => [f, v - d[f as keyof Counters]])) as Counters;
      k.role_axis = axis;
      k.roles = Object.fromEntries([...ROLE_DOMAINS[axis], UNRESOLVED_ROLE].map((role, i) => [role,
        role === UNRESOLVED_ROLE ? roleBlockOf(role, d, unresolvedFields(k.parts, d.parts)) : roleBlockOf(role, i === 0 ? main : ZERO)]));
    }
  }
  // one eol-only part becomes spec_linked_not_held, in a kind without roles, its category and the brand
  let shifted: { category: string; kind: string } | null = null;
  for (const c of out.categories) {
    const k = (c.kinds as KindBlock[]).find((x) => !x.roles && x.held.eol_only > 0);
    if (!k) continue;
    for (const b of [k as Block, c as Block, out.brand as Block]) {
      const cc = countersOf(b); cc.eol--; cc.specNotHeld++; cc.legacy++; refresh(b, cc);
    }
    shifted = { category: c.category, kind: k.kind };
    break;
  }
  // one not-parsed slot becomes a mapper gap, in a cup of a kind without roles, the kind, its category and the brand —
  // chosen so the cup order (not_parsed descending) survives, so the untouched fixture exercises a NON-ZERO mapper_gap
  let gapShifted: { category: string; kind: string; cup: string } | null = null;
  for (const c of out.categories) {
    for (const k of c.kinds as KindBlock[]) {
      if (k.roles) continue;
      const i = k.cups.findIndex((cup, j) => cup.not_parsed > 0 && (j === k.cups.length - 1 || k.cups[j + 1].not_parsed <= cup.not_parsed - 1));
      if (i < 0) continue;
      const cup = k.cups[i];
      cup.not_parsed--; cup.mapper_gap++;
      for (const b of [k as Block, c as Block, out.brand as Block]) { const cc = countersOf(b); cc.notParsed--; cc.mapperGap++; refresh(b, cc); }
      gapShifted = { category: c.category, kind: k.kind, cup: cup.key };
      break;
    }
    if (gapShifted) break;
  }
  return { report: out, synthesized, upgraded, shifted, gapShifted };
}
/** The ledger context the fixture needs: spec_linked_not_held 0 where a pre-6b ledger has none, and the shifted kind. */
export function ctxFixture(ctx: CheckContext, shifted: { category: string; kind: string } | null): CheckContext {
  const cc = JSON.parse(JSON.stringify(ctx)) as CheckContext;
  for (const l of Object.values(cc.ledgers ?? {})) for (const lk of Object.values(l.kinds)) lk.document_evidence.spec_linked_not_held ??= 0;
  if (shifted) {
    const de = cc.ledgers?.[shifted.category]?.kinds[shifted.kind]?.document_evidence;
    if (de) { de.eol_only--; de.spec_linked_not_held = (de.spec_linked_not_held ?? 0) + 1; }
  }
  return cc;
}

