// src/api/queries/completeness.ts — the ONE completeness report (phase-1 close guide §3), read from the committed
// file, plus the cross-check that the build script and the test suite both run.
//
// WHY A FILE AND NOT A QUERY. The report is a full pass over every live hardware part, every current fact under a
// required cup (replayed through the real normaliser) and every document link. Computing that per request would be a
// minute-long statement against the pool the pipeline writes through — the shape that has already taken the board
// down once. So it is built by scripts/build-completeness.mts on the same commit as the ledgers and served as
// committed, exactly like /v1/ledger and /v1/census (routes/start.ts).
//
// WHY THE CHECKER LIVES HERE. The build script refuses to write a report whose invariants fail, and
// tests/completeness.test.ts re-runs the same invariants on the committed file and drives each one with a sabotage
// copy. One implementation, two callers: a checker written twice is two checkers that drift apart.
//
// This module holds no SQL. The definitions every number here uses are in docs/completeness-model.md.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../config.js";
import { ROLE_DOMAINS, roleAxisOf } from "../../core/deployRole.js";

/** The role key for a part no deployRole rule places (spec v2 §III.2: "counted under role: unresolved"). */
export const UNRESOLVED_ROLE = "(unresolved)";

export const COMPLETENESS_DIR = path.join(REPO_ROOT, "data", "completeness");
/** A vendor report is `<vendor>.json`; the since-window sidecar is `<vendor>.since.json` and is not a vendor. */
const VENDOR_FILE = /^([a-z0-9][a-z0-9-]*)\.json$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// ---- shape --------------------------------------------------------------------------------------------------------

/** Every percentage in the file is this object: the numerator and denominator travel with it (guide §3.2). */
export type Pct = { num: number; den: number; pct: number | null };

export function pctOf(num: number, den: number): Pct {
  return { num, den, pct: den === 0 ? null : Math.round((num / den) * 1000) / 10 };
}

export type ArrangedBlock = { asked: number; asked_nothing_fallback: number } & Pct;
/**
 * HELD (operator ruling, 13 Sep 2026; src/core/heldEvidence.ts): a doc_parts row with doc_relevance = spec_for_kind AND
 * link_basis IN (explicit, family). `spec_bearing` keeps its name and now counts THAT held; `spec_linked_not_held` is the
 * parts a spec-bearing document is linked to only as a mention or by inference — held before the ruling, not after.
 * Partition: spec_bearing + spec_linked_not_held + eol_only + no_document = parts. `held_by_doc_type_legacy` is the old
 * rule (any spec-bearing doc type linked) as its own percentage over the same parts: held BEFORE relevance, printed beside.
 */
export type HeldBlock = { spec_bearing: number; spec_linked_not_held: number; eol_only: number; no_document: number;
  held_by_doc_type_legacy: Pct } & Pct;
export type FilledBlock = {
  /** den: required slots (completeness.required_fields) of HELD parts only */
  required_slots_held: number;
  filled: number; not_published: number; not_parsed: number;
  /** kind layer 6b: an unfilled slot of a held part whose cup the printed-bar measurement (data/reference/cup-evidence-
   *  <vendor>.json) marks `mapper-gap` — the datasheet prints it and the mapper does not map it. Counted INSTEAD of
   *  not_parsed; the fourth open state beside not_published, not_parsed and would_refuse. */
  mapper_gap: number;
  /** stored values the normaliser would refuse today, on held parts: neither filled nor empty (§3.3) */
  would_refuse: number;
  /** of `filled`, how many are in a state the API does not render (conflict, unverified) */
  filled_not_rendered: number;
  /** printed beside, never inside, the denominator */
  not_held_parts: number; not_held_slots: number;
  /** slots on NOT-held parts that already hold an accepted value — outside every denominator, shown so it is not hidden */
  not_held_filled: number;
} & Pct;
export type DefectsBlock = {
  would_refuse: number; would_refuse_not_held: number; could_not_replay: number; placeholders_stored: number;
};
export type InheritedBlock = { inherited: number; filled: number } & Pct;

export type Block = {
  hardware_parts: number;
  arranged: ArrangedBlock;
  held: HeldBlock;
  filled: FilledBlock;
  defects: DefectsBlock;
  inherited_share: InheritedBlock;
};

export type CupRow = {
  key: string;
  /** how the kind's ledger lists the cup at nothing-known, read across its roles (`cupRequirement`):
   *  required = every role asks it outright · pending = every role asks it, at least one behind a gate ·
   *  by_role  = some roles of this kind ask it and some do not (layer 3) · other = no role asks it, a defect */
  requirement: "required" | "pending" | "by_role" | "other";
  gate: string[];
  asked: number; held_asked: number;
  filled: number; not_published: number; not_parsed: number; mapper_gap: number; would_refuse: number;
  not_held: number; not_held_filled: number; not_held_would_refuse: number;
  could_not_replay: number; inherited: number; filled_not_rendered: number; placeholders_stored: number;
  filled_pct: Pct;
  fill_path: "seen" | "derived" | "seed-only" | "none";
  observed_filled: boolean;
  label_occurrences: number;
  sources_enabled: string[];
  taps: string[];
};

/**
 * LAYER 3 (kind-layer infra, 13 Sep 2026): one block per `deploy_role` of a kind that has a role axis, computed by the
 * build with the SAME accumulator and the SAME `block()` as the kind itself, so every definition of the kind block is
 * the role block's definition too: `held` (spec-bearing / eol-only / no-document), `filled` over the required slots of
 * held parts (with `not_parsed`, `would_refuse`, `not_held_*` inside it), `defects`, `inherited_share`. The key
 * `(unresolved)` holds the parts no deployRole rule places (asked the kind's core); `kind_issue_parts` of them hit a
 * rule saying the row is not this kind at all. Cross-check `roles_partition` asserts the roles sum to the kind exactly.
 */
export type RoleBlock = Block & {
  deploy_role: string; parts: number;
  /** (unresolved) only: rows an ISSUE rule says are not this kind at all (src/core/kindLayerPlans.ts) */
  kind_issue_parts?: number;
  /** (unresolved) only: kind_issue_parts split by plan state; pending_plan + plan_ran + unplanned = kind_issue_parts */
  kind_issue?: { pending_plan: number; plan_ran: number; unplanned: number };
  /** (unresolved) only: the III.4 bar over (unresolved − kind_issue_parts) / (kind parts − kind_issue_parts) */
  null_share_excluding_kind_issue?: { num: number; den: number; pct: number | null; over_3pct: boolean };
  /** (unresolved) only: "(unresolved) N — K pending move/class" */
  display?: string;
};

export type KindBlock = Block & {
  kind: string; parts: number; resolved: boolean; asked_nothing: boolean; cups: CupRow[];
  /** the rule axis of deployRole.ts (switch | ap | router | phone), or null: a kind with no role axis */
  role_axis?: string | null;
  /** present exactly when role_axis is non-null: every role of the domain, then `(unresolved)` */
  roles?: Record<string, RoleBlock>;
};
export type CategoryBlock = Block & {
  category: string; profile_hash: string | null; ledger_built_on_commit: string | null;
  unresolved_kind_parts: number; kinds: KindBlock[];
};
export type BrandBlock = Block & {
  weakest_category: string | null;
  unresolved_kind: { parts: number; kinds: string[]; device_noun_union: number; device_noun_unresolved: number };
};
export type CrossCheck = { name: string; passed: boolean; detail: string };

export type CompletenessReport = {
  _about: string;
  definitions: string;
  vendor: string;
  built_on_commit: string;
  generated_at: string;
  inputs: Record<string, unknown>;
  brand: BrandBlock;
  categories: CategoryBlock[];
  acquisition_queue: { _about: string; by_category: unknown[]; by_document_class_missing: unknown[] };
  residue: unknown[];
  model_disagreements: unknown[];
  cross_checks: CrossCheck[];
  [k: string]: unknown;
};

// ---- the checker (§3.4) -------------------------------------------------------------------------------------------

/** What the checker can compare the file against when the caller has it. Ledgers are committed files, so the test
 *  passes them; `live` needs the store, so only the build passes it. */
export type LedgerLike = {
  vendor: string; category: string;
  totals: { parts: number; required_slots_stored: number;
    fallback: { asked_nothing: { parts: number }; unresolved_kind: { parts: number; kinds: string[] } } };
  kinds: Record<string, {
    parts: number; required_slots_stored: number;
    document_evidence: { spec_bearing: number; spec_linked_not_held?: number; eol_only: number; no_document: number };
    required: { key: string }[]; pending_until_gate_answered: { key: string }[];
    /** LAYER 3 (13 Sep 2026): present exactly when the kind has a role axis. The kind's OWN lists above are its CORE —
     *  what a part whose role is unresolved is asked — so a cup only one role asks for is NOT in them. Read the band
     *  through `cupDemand`, never the core lists alone. */
    roles?: Record<string, { parts: number; required: { key: string }[]; pending_until_gate_answered: { key: string }[] }>;
  }>;
};

/**
 * WHAT THE LEDGER ASKS FOR ONE CUP ACROSS THE ROLES OF A KIND (25 Sep 2026).
 *
 * "Required of the kind" stopped meaning "asked of every part of the kind" the day layer 3 landed: a `branch` router
 * is asked `flash`, an `smb` router is asked `temp_operating`, and the kind's own lists are only the CORE — the set a
 * part whose role is unresolved is asked. Two cross-checks below read the core as if it covered every part, so every
 * role-gated cup looked like a defect and the report would not rebuild. Neither check was wrong about its arithmetic;
 * both were asking a question the file had stopped answering.
 *
 * The honest statement is a BAND over the role blocks, and it is exact where it matters:
 *   min   Σ parts of the roles that require the key OUTRIGHT   — it is asked at least this often
 *   max   Σ parts of the roles that require OR pend it         — it is asked at most this often
 *   of    Σ parts of every role block = the kind's parts        — what the band is taken over
 * A key every role requires has min = max = of, which is the pre-layer-3 check unchanged. A pending key's band opens
 * by the parts of the roles whose gate may already be answered — exactly what the file cannot know and must not claim.
 * A kind with no role axis has one block (its core), so nothing is widened for it.
 */
export function cupDemand(lk: LedgerLike["kinds"][string], key: string): { min: number; max: number; of: number; asked_by_any: boolean; roles: number } {
  const blocks = lk.roles
    ? Object.values(lk.roles)
    : [{ parts: lk.parts, required: lk.required, pending_until_gate_answered: lk.pending_until_gate_answered }];
  let min = 0, max = 0, of = 0, any = false;
  for (const b of blocks) {
    of += b.parts;
    if (b.required.some((x) => x.key === key)) { min += b.parts; max += b.parts; any = true; }
    else if (b.pending_until_gate_answered.some((x) => x.key === key)) { max += b.parts; any = true; }
  }
  return { min, max, of, asked_by_any: any, roles: lk.roles ? Object.keys(lk.roles).length : 0 };
}

/** The label the report prints for a cup, taken from the same band — so the label and the count cannot disagree.
 *  `by_role` is layer 3's own state: some roles of this kind ask the cup and some do not. `other` is a defect: a cup
 *  in a denominator that no role of the kind asks for at all. */
export function cupRequirement(lk: LedgerLike["kinds"][string], key: string): CupRow["requirement"] {
  const d = cupDemand(lk, key);
  if (!d.asked_by_any) return "other";
  if (d.max < d.of) return "by_role";
  return d.min === d.of ? "required" : "pending";
}

/** Every cup the ledger asks for anywhere in the kind: the core lists plus every role's. */
export function ledgerCupKeys(lk: LedgerLike["kinds"][string]): string[] {
  const out = new Set<string>();
  for (const b of [lk, ...Object.values(lk.roles ?? {})]) {
    for (const x of b.required) out.add(x.key);
    for (const x of b.pending_until_gate_answered) out.add(x.key);
  }
  return [...out];
}
export type CheckContext = {
  ledgers?: Record<string, LedgerLike>;
  live?: { hardware_parts: number; parts_nothing_required: number; required_total_held: number };
};

/** The invariant names. Stable: the test's sabotage cases assert on them. */
export const CHECKS = [
  "hardware_parts",
  "arranged_partition",
  "asked_nothing_matches",
  "held_partition",
  "held_matches_ledger",
  "filled_partition",
  "required_slots_held_live",
  "cup_asked_matches_ledger",
  "no_optional_cup_in_denominator",
  "denominators",
  "pct_arithmetic",
  "sort_order",
  "unresolved_kind",
  // kind-layer infra (13 Sep 2026): layer 3 in the report.
  "roles_present",
  "roles_partition",
  // kind layer 6b (13 Sep 2026): held by relevance, the (unresolved) kind-issue split, and the plans that must have emptied it.
  "held_within_legacy",
  "unresolved_kind_issue",
  "kind_issue_plans_ran",
] as const;
export type CheckName = (typeof CHECKS)[number];

export function checkReport(r: CompletenessReport, ctx: CheckContext = {}): CrossCheck[] {
  const fails = new Map<CheckName, string[]>(CHECKS.map((c) => [c, []]));
  const ran = new Set<CheckName>();
  const fail = (c: CheckName, msg: string) => { fails.get(c)!.push(msg); };
  const run = (c: CheckName) => ran.add(c);
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const cats = r.categories ?? [];
  type Scoped = { label: string; b: Block };
  const scopes: Scoped[] = [
    { label: "brand", b: r.brand },
    ...cats.flatMap((c) => [{ label: c.category, b: c as Block },
      ...(c.kinds ?? []).flatMap((k) => [{ label: `${c.category}.${k.kind}`, b: k as Block },
        // A role block is a scope like any other: every partition and denominator below holds inside it too.
        ...Object.entries(k.roles ?? {}).map(([role, rb]) => ({ label: `${c.category}.${k.kind}[${role}]`, b: rb as Block }))])]),
  ];

  // hardware_parts: brand == Σ categories == Σ kinds per category == ledgers == the live count
  run("hardware_parts");
  if (r.brand.hardware_parts !== sum(cats, (c) => c.hardware_parts)) {
    fail("hardware_parts", `brand ${r.brand.hardware_parts} != Σ categories ${sum(cats, (c) => c.hardware_parts)}`);
  }
  for (const c of cats) {
    const kp = sum(c.kinds, (k) => k.hardware_parts);
    if (kp !== c.hardware_parts) fail("hardware_parts", `${c.category}: ${c.hardware_parts} != Σ kinds ${kp}`);
    for (const k of c.kinds) if (k.parts !== k.hardware_parts) fail("hardware_parts", `${c.category}.${k.kind}: parts ${k.parts} != hardware_parts ${k.hardware_parts}`);
    const led = ctx.ledgers?.[c.category];
    if (ctx.ledgers && !led) fail("hardware_parts", `${c.category}: no committed ledger`);
    if (led && led.totals.parts !== c.hardware_parts) fail("hardware_parts", `${c.category}: report ${c.hardware_parts} != ledger totals.parts ${led.totals.parts}`);
  }
  if (ctx.ledgers) {
    const missing = Object.keys(ctx.ledgers).filter((k) => !cats.some((c) => c.category === k));
    if (missing.length) fail("hardware_parts", `ledgers with no category block: ${missing.join(", ")}`);
  }
  if (ctx.live && ctx.live.hardware_parts !== r.brand.hardware_parts) {
    fail("hardware_parts", `brand ${r.brand.hardware_parts} != live count ${ctx.live.hardware_parts}`);
  }

  // arranged_partition: asked + asked_nothing_fallback == hardware_parts at every level
  run("arranged_partition");
  for (const s of scopes) {
    const a = s.b.arranged;
    if (a.asked + a.asked_nothing_fallback !== s.b.hardware_parts) {
      fail("arranged_partition", `${s.label}: asked ${a.asked} + asked_nothing ${a.asked_nothing_fallback} != ${s.b.hardware_parts}`);
    }
  }
  // asked_nothing_matches: == the ledger's asked_nothing, == /v1/stats/gaps parts_nothing_required
  run("asked_nothing_matches");
  for (const c of cats) {
    const led = ctx.ledgers?.[c.category];
    if (led && led.totals.fallback.asked_nothing.parts !== c.arranged.asked_nothing_fallback) {
      fail("asked_nothing_matches", `${c.category}: report ${c.arranged.asked_nothing_fallback} != ledger ${led.totals.fallback.asked_nothing.parts}`);
    }
  }
  if (ctx.live && ctx.live.parts_nothing_required !== r.brand.arranged.asked_nothing_fallback) {
    fail("asked_nothing_matches", `brand asked_nothing ${r.brand.arranged.asked_nothing_fallback} != parts_nothing_required ${ctx.live.parts_nothing_required}`);
  }

  // held_partition: spec_bearing + eol_only + no_document == hardware_parts at every level
  // 6b: four states (held by relevance / spec-bearing linked but not held / eol-only / no document). A block without
  // `spec_linked_not_held` predates the ruling and fails by name rather than by NaN.
  run("held_partition");
  for (const s of scopes) {
    const h = s.b.held;
    if (typeof h.spec_linked_not_held !== "number") { fail("held_partition", `${s.label}: no held.spec_linked_not_held — the report predates the held-by-relevance ruling; rebuild it`); continue; }
    if (h.spec_bearing + h.spec_linked_not_held + h.eol_only + h.no_document !== s.b.hardware_parts) {
      fail("held_partition", `${s.label}: ${h.spec_bearing}+${h.spec_linked_not_held}+${h.eol_only}+${h.no_document} != ${s.b.hardware_parts}`);
    }
  }
  // held_within_legacy: held BEFORE relevance (any spec-bearing doc type linked) is exactly held-and-spec-typed plus
  // spec_linked_not_held. It fails when a part is held through a row whose document is NOT a spec-bearing doc type —
  // the derive run and this report would then be using two different spec-bearing lists.
  run("held_within_legacy");
  for (const s of scopes) {
    const h = s.b.held, lg = h.held_by_doc_type_legacy;
    if (!lg || typeof lg.num !== "number") { fail("held_within_legacy", `${s.label}: no held.held_by_doc_type_legacy — rebuild the report`); continue; }
    if (lg.den !== s.b.hardware_parts) fail("held_within_legacy", `${s.label}: held_by_doc_type_legacy den ${lg.den} != parts ${s.b.hardware_parts}`);
    if (lg.num !== h.spec_bearing + h.spec_linked_not_held) {
      fail("held_within_legacy", `${s.label}: legacy held ${lg.num} != held ${h.spec_bearing} + spec_linked_not_held ${h.spec_linked_not_held} — a part is held through a document that is not a spec-bearing doc type`);
    }
  }
  // held_matches_ledger: per kind, the four counts equal the ledger's document_evidence
  run("held_matches_ledger");
  for (const c of cats) {
    const led = ctx.ledgers?.[c.category];
    if (!led) continue;
    for (const [kind, lk] of Object.entries(led.kinds)) {
      const k = c.kinds.find((x) => x.kind === kind);
      const de = lk.document_evidence;
      if (!k) { if (lk.parts > 0) fail("held_matches_ledger", `${c.category}.${kind}: ledger has ${lk.parts} parts, report has no kind`); continue; }
      if (k.held.spec_bearing !== de.spec_bearing || k.held.spec_linked_not_held !== de.spec_linked_not_held || k.held.eol_only !== de.eol_only || k.held.no_document !== de.no_document) {
        fail("held_matches_ledger", `${c.category}.${kind}: report ${k.held.spec_bearing}/${k.held.spec_linked_not_held}/${k.held.eol_only}/${k.held.no_document} != ledger ${de.spec_bearing}/${de.spec_linked_not_held}/${de.eol_only}/${de.no_document} (held/spec-linked-not-held/eol-only/no-document)`);
      }
    }
  }

  // filled_partition: held slots = filled + not_published + not_parsed + mapper_gap + would_refuse, and Σ cups == kind at
  // every level (6b: mapper_gap is the fourth open state)
  run("filled_partition");
  for (const s of scopes) {
    const f = s.b.filled;
    if (typeof f.mapper_gap !== "number") { fail("filled_partition", `${s.label}: no filled.mapper_gap — the report predates the mapper-gap state; rebuild it`); continue; }
    const parts = f.filled + f.not_published + f.not_parsed + f.mapper_gap + f.would_refuse;
    if (parts !== f.required_slots_held) fail("filled_partition", `${s.label}: ${f.filled}+${f.not_published}+${f.not_parsed}+${f.mapper_gap}+${f.would_refuse} != required_slots_held ${f.required_slots_held}`);
    if (s.b.defects.would_refuse !== f.would_refuse) fail("filled_partition", `${s.label}: defects.would_refuse ${s.b.defects.would_refuse} != filled.would_refuse ${f.would_refuse}`);
  }
  const rollup = (label: string, parent: Block, children: Block[]) => {
    const fields: (keyof FilledBlock)[] = ["required_slots_held", "filled", "not_published", "not_parsed", "mapper_gap", "would_refuse", "not_held_slots", "not_held_filled"];
    for (const fld of fields) {
      const v = sum(children, (x) => x.filled[fld] as number);
      if (v !== parent.filled[fld]) fail("filled_partition", `${label}: filled.${fld} ${parent.filled[fld]} != Σ children ${v}`);
    }
  };
  rollup("brand", r.brand, cats);
  for (const c of cats) {
    rollup(c.category, c, c.kinds);
    for (const k of c.kinds) {
      const cupsum = (f: (x: CupRow) => number) => sum(k.cups, f);
      const pairs: [string, number, number][] = [
        ["required_slots_held", k.filled.required_slots_held, cupsum((x) => x.held_asked)],
        ["filled", k.filled.filled, cupsum((x) => x.filled)],
        ["not_published", k.filled.not_published, cupsum((x) => x.not_published)],
        ["not_parsed", k.filled.not_parsed, cupsum((x) => x.not_parsed)],
        ["mapper_gap", k.filled.mapper_gap, cupsum((x) => x.mapper_gap)],
        ["would_refuse", k.filled.would_refuse, cupsum((x) => x.would_refuse)],
        ["not_held_slots", k.filled.not_held_slots, cupsum((x) => x.not_held)],
      ];
      for (const [n, a, b] of pairs) if (a !== b) fail("filled_partition", `${c.category}.${k.kind}: filled.${n} ${a} != Σ cups ${b}`);
      for (const cup of k.cups) {
        const hp = cup.filled + cup.not_published + cup.not_parsed + cup.mapper_gap + cup.would_refuse;
        if (hp !== cup.held_asked) fail("filled_partition", `${c.category}.${k.kind}.${cup.key}: ${hp} != held_asked ${cup.held_asked}`);
        if (cup.held_asked + cup.not_held !== cup.asked) fail("filled_partition", `${c.category}.${k.kind}.${cup.key}: held_asked ${cup.held_asked} + not_held ${cup.not_held} != asked ${cup.asked}`);
      }
    }
  }

  // required_slots_held_live: == Σ over held parts of completeness.required_total, computed independently in SQL
  run("required_slots_held_live");
  if (ctx.live && ctx.live.required_total_held !== r.brand.filled.required_slots_held) {
    fail("required_slots_held_live", `brand required_slots_held ${r.brand.filled.required_slots_held} != Σ required_total over held parts ${ctx.live.required_total_held}`);
  }

  // cup_asked_matches_ledger: Σ cups.asked per kind == ledger required_slots_stored, and every cup's `asked` inside the
  // band its kind's ROLES open for it (`cupDemand`) — a cup every role requires still has to be asked of every part.
  run("cup_asked_matches_ledger");
  run("no_optional_cup_in_denominator");
  for (const c of cats) {
    const led = ctx.ledgers?.[c.category];
    for (const k of c.kinds) {
      const asked = sum(k.cups, (x) => x.asked);
      const lk = led?.kinds[k.kind];
      if (led && !lk) { fail("cup_asked_matches_ledger", `${c.category}.${k.kind}: kind not in the ledger`); continue; }
      if (lk) {
        if (lk.required_slots_stored !== asked) fail("cup_asked_matches_ledger", `${c.category}.${k.kind}: Σ cups.asked ${asked} != ledger required_slots_stored ${lk.required_slots_stored}`);
        // A kind with roles carries its CORE lists and an `(unresolved)` block built from the same call with the same
        // argument (no role), so they are the same lists or the file is not internally readable: every pre-layer-3
        // reader still reads the core, and a core that has drifted describes a population it no longer covers.
        const un = lk.roles?.[UNRESOLVED_ROLE];
        if (un) {
          const same = (a: { key: string }[], b: { key: string }[]) => a.map((x) => x.key).sort().join(",") === b.map((x) => x.key).sort().join(",");
          if (!same(lk.required, un.required) || !same(lk.pending_until_gate_answered, un.pending_until_gate_answered)) {
            fail("cup_asked_matches_ledger", `${c.category}.${k.kind}: the kind's core cup lists differ from its ${UNRESOLVED_ROLE} role block`);
          }
        }
        // The union, so a cup the ledger asks for and the report never asked fails as loudly as one the report invented.
        for (const key of new Set([...ledgerCupKeys(lk), ...k.cups.map((x) => x.key)])) {
          const d = cupDemand(lk, key);
          const n = k.cups.find((x) => x.key === key)?.asked ?? 0;
          if (!d.asked_by_any) {
            fail("no_optional_cup_in_denominator", `${c.category}.${k.kind}.${key}: asked of ${n} parts but no role of the ledger lists it as required or pending`);
          } else if (n < d.min || n > d.max) {
            fail("cup_asked_matches_ledger", d.min === d.max
              ? `${c.category}.${k.kind}.${key}: required of every part, asked of ${n} of ${d.min}`
              : `${c.category}.${k.kind}.${key}: asked of ${n}, outside the ${d.min}..${d.max} its ${d.roles} role(s) open over ${d.of} parts`);
          }
        }
      }
      for (const cup of k.cups) {
        if (cup.requirement === "other") fail("no_optional_cup_in_denominator", `${c.category}.${k.kind}.${cup.key}: requirement "other" (optional or not-applicable at nothing-known) in a denominator`);
      }
    }
  }

  // denominators: what every pct is taken over
  run("denominators");
  for (const s of scopes) {
    const b = s.b;
    const want: [string, Pct, number][] = [
      ["arranged", b.arranged, b.hardware_parts],
      ["held", b.held, b.hardware_parts],
      ["filled", b.filled, b.filled.required_slots_held],
      ["inherited_share", b.inherited_share, b.filled.filled],
    ];
    for (const [n, p, den] of want) if (p.den !== den) fail("denominators", `${s.label}.${n}: den ${p.den} != ${den}`);
    if (b.arranged.num !== b.arranged.asked) fail("denominators", `${s.label}.arranged: num ${b.arranged.num} != asked ${b.arranged.asked}`);
    if (b.held.num !== b.held.spec_bearing) fail("denominators", `${s.label}.held: num ${b.held.num} != spec_bearing ${b.held.spec_bearing}`);
    if (b.filled.num !== b.filled.filled + b.filled.not_published) fail("denominators", `${s.label}.filled: num ${b.filled.num} != filled + not_published`);
    if (b.inherited_share.num !== b.inherited_share.inherited || b.inherited_share.filled !== b.filled.filled) fail("denominators", `${s.label}.inherited_share: num/filled disagree with the filled block`);
    // the parts printed beside the filled denominator as not-held are exactly the not-held parts of the held block
    if (b.filled.not_held_parts !== b.held.spec_linked_not_held + b.held.eol_only + b.held.no_document) {
      fail("denominators", `${s.label}: not_held_parts ${b.filled.not_held_parts} != spec_linked_not_held + eol_only + no_document ${b.held.spec_linked_not_held + b.held.eol_only + b.held.no_document}`);
    }
  }
  // held + not-held slots is every stored slot, so the held denominator has taken out exactly the not-held ones
  for (const c of cats) {
    const led = ctx.ledgers?.[c.category];
    if (led && c.filled.required_slots_held + c.filled.not_held_slots !== led.totals.required_slots_stored) {
      fail("denominators", `${c.category}: held slots ${c.filled.required_slots_held} + not-held slots ${c.filled.not_held_slots} != ledger required_slots_stored ${led.totals.required_slots_stored}`);
    }
  }
  for (const c of cats) for (const k of c.kinds) for (const cup of k.cups) {
    if (cup.filled_pct.den !== cup.held_asked) fail("denominators", `${c.category}.${k.kind}.${cup.key}: filled_pct den ${cup.filled_pct.den} != held_asked ${cup.held_asked}`);
    if (cup.filled_pct.num !== cup.filled + cup.not_published) fail("denominators", `${c.category}.${k.kind}.${cup.key}: filled_pct num != filled + not_published`);
  }

  // pct_arithmetic: EVERY object in the file carrying `pct` carries num and den, and the arithmetic holds
  run("pct_arithmetic");
  const walk = (v: unknown, where: string) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if ("pct" in o) {
      if (typeof o.num !== "number" || typeof o.den !== "number") fail("pct_arithmetic", `${where}: pct without a numeric num and den`);
      else {
        const expect = pctOf(o.num, o.den).pct;
        if (o.pct !== expect) fail("pct_arithmetic", `${where}: pct ${String(o.pct)} != ${String(expect)} from ${o.num}/${o.den}`);
        if (o.num > o.den) fail("pct_arithmetic", `${where}: num ${o.num} > den ${o.den}`);
      }
    }
    for (const [k, x] of Object.entries(o)) if (k !== "cross_checks") walk(x, `${where}.${k}`);
  };
  walk(r, "$");

  // sort_order: categories by filled.pct ascending (no held slots last), kinds by parts descending, cups by not_parsed descending
  run("sort_order");
  const pctKey = (p: Pct) => (p.pct === null ? Number.POSITIVE_INFINITY : p.pct);
  for (let i = 1; i < cats.length; i++) {
    if (pctKey(cats[i - 1].filled) > pctKey(cats[i].filled)) fail("sort_order", `categories: ${cats[i - 1].category} (${cats[i - 1].filled.pct}) before ${cats[i].category} (${cats[i].filled.pct})`);
  }
  for (const c of cats) {
    for (let i = 1; i < c.kinds.length; i++) if (c.kinds[i - 1].parts < c.kinds[i].parts) fail("sort_order", `${c.category}: kind ${c.kinds[i - 1].kind} (${c.kinds[i - 1].parts}) before ${c.kinds[i].kind} (${c.kinds[i].parts})`);
    for (const k of c.kinds) for (let i = 1; i < k.cups.length; i++) {
      if (k.cups[i - 1].not_parsed < k.cups[i].not_parsed) fail("sort_order", `${c.category}.${k.kind}: cup ${k.cups[i - 1].key} (${k.cups[i - 1].not_parsed}) before ${k.cups[i].key} (${k.cups[i].not_parsed})`);
    }
  }
  const weakest = cats.find((c) => c.filled.pct !== null)?.category ?? null;
  if (r.brand.weakest_category !== weakest) fail("sort_order", `brand.weakest_category ${r.brand.weakest_category} != first category with held slots ${weakest}`);

  // unresolved_kind: brand count == Σ categories == Σ ledgers
  run("unresolved_kind");
  const unres = sum(cats, (c) => c.unresolved_kind_parts);
  if (unres !== r.brand.unresolved_kind.parts) fail("unresolved_kind", `brand ${r.brand.unresolved_kind.parts} != Σ categories ${unres}`);
  for (const c of cats) {
    const own = sum(c.kinds.filter((k) => !k.resolved), (k) => k.parts);
    if (own !== c.unresolved_kind_parts) fail("unresolved_kind", `${c.category}: unresolved_kind_parts ${c.unresolved_kind_parts} != Σ unresolved kinds ${own}`);
    const led = ctx.ledgers?.[c.category];
    if (led && led.totals.fallback.unresolved_kind.parts !== c.unresolved_kind_parts) fail("unresolved_kind", `${c.category}: report ${c.unresolved_kind_parts} != ledger ${led.totals.fallback.unresolved_kind.parts}`);
  }

  // roles_present: a kind carries a roles block EXACTLY when deployRole.ts gives it a role axis, with every role of the
  // domain and `(unresolved)`. A report built before layer 3 fails here by name: it cannot print per-role numbers, and
  // spec v2 §III.4 requires them for the role-bearing kinds — a missing block is the defect, never a pass.
  run("roles_present");
  for (const c of cats) for (const k of c.kinds) {
    const axis = roleAxisOf(c.category, k.kind);
    const label = `${c.category}.${k.kind}`;
    if (!axis) {
      if (k.roles !== undefined) fail("roles_present", `${label}: a roles block on a kind with no role axis`);
      if (k.role_axis !== undefined && k.role_axis !== null) fail("roles_present", `${label}: role_axis ${k.role_axis} on a kind with no role axis`);
      continue;
    }
    if (!k.roles) { fail("roles_present", `${label}: has the ${axis} role axis and no roles block — rebuild the report`); continue; }
    if (k.role_axis !== axis) fail("roles_present", `${label}: role_axis ${String(k.role_axis)} != ${axis}`);
    const want = [...ROLE_DOMAINS[axis], UNRESOLVED_ROLE];
    const have = Object.keys(k.roles);
    const missing = want.filter((r) => !have.includes(r)), extra = have.filter((r) => !want.includes(r));
    if (missing.length) fail("roles_present", `${label}: roles block lacks ${missing.join(", ")}`);
    if (extra.length) fail("roles_present", `${label}: roles outside the ${axis} domain: ${extra.join(", ")}`);
    for (const [role, rb] of Object.entries(k.roles)) if (rb.deploy_role !== role) fail("roles_present", `${label}[${role}]: block names deploy_role ${rb.deploy_role}`);
  }

  // roles_partition: the role blocks of a kind SUM to the kind block, counter by counter, so a part counted in no role or
  // in two cannot hide. Every counter the kind block carries is summed; the percentages follow from them (pct_arithmetic).
  run("roles_partition");
  const ROLE_COUNTERS: [string, (b: Block) => number][] = [
    ["hardware_parts", (b) => b.hardware_parts],
    ["arranged.asked", (b) => b.arranged.asked], ["arranged.asked_nothing_fallback", (b) => b.arranged.asked_nothing_fallback],
    ["held.spec_bearing", (b) => b.held.spec_bearing], ["held.eol_only", (b) => b.held.eol_only], ["held.no_document", (b) => b.held.no_document],
    // 6b
    ["held.spec_linked_not_held", (b) => b.held.spec_linked_not_held], ["held.held_by_doc_type_legacy.num", (b) => b.held.held_by_doc_type_legacy?.num ?? Number.NaN],
    ["filled.mapper_gap", (b) => b.filled.mapper_gap],
    ["filled.required_slots_held", (b) => b.filled.required_slots_held], ["filled.filled", (b) => b.filled.filled],
    ["filled.not_published", (b) => b.filled.not_published], ["filled.not_parsed", (b) => b.filled.not_parsed],
    ["filled.would_refuse", (b) => b.filled.would_refuse], ["filled.filled_not_rendered", (b) => b.filled.filled_not_rendered],
    ["filled.not_held_parts", (b) => b.filled.not_held_parts], ["filled.not_held_slots", (b) => b.filled.not_held_slots],
    ["filled.not_held_filled", (b) => b.filled.not_held_filled],
    ["defects.would_refuse_not_held", (b) => b.defects.would_refuse_not_held], ["defects.could_not_replay", (b) => b.defects.could_not_replay],
    ["defects.placeholders_stored", (b) => b.defects.placeholders_stored],
    ["inherited_share.inherited", (b) => b.inherited_share.inherited],
  ];
  for (const c of cats) for (const k of c.kinds) {
    if (!k.roles) continue;
    const rbs = Object.entries(k.roles);
    for (const [role, rb] of rbs) if (rb.parts !== rb.hardware_parts) fail("roles_partition", `${c.category}.${k.kind}[${role}]: parts ${rb.parts} != hardware_parts ${rb.hardware_parts}`);
    const parts = sum(rbs, ([, rb]) => rb.parts);
    if (parts !== k.parts) fail("roles_partition", `${c.category}.${k.kind}: Σ role parts ${parts} != kind parts ${k.parts}`);
    for (const [name, get] of ROLE_COUNTERS) {
      const v = sum(rbs, ([, rb]) => get(rb));
      if (v !== get(k)) fail("roles_partition", `${c.category}.${k.kind}: Σ roles ${name} ${v} != kind ${get(k)}`);
    }
  }

  // unresolved_kind_issue (operator ruling, 13 Sep 2026): the (unresolved) block of every role-bearing kind PRINTS
  // kind_issue_parts, splits it by plan state, applies the III.4 bar to what the role rules are responsible for, and says
  // "(unresolved) N — K pending move/class". No other role block carries those fields.
  run("unresolved_kind_issue");
  for (const c of cats) for (const k of c.kinds) {
    for (const [role, rb] of Object.entries(k.roles ?? {})) {
      const label = `${c.category}.${k.kind}[${role}]`;
      if (role !== UNRESOLVED_ROLE) {
        if (rb.kind_issue_parts !== undefined || rb.kind_issue !== undefined || rb.null_share_excluding_kind_issue !== undefined) {
          fail("unresolved_kind_issue", `${label}: kind-issue fields on a role that is not (unresolved)`);
        }
        continue;
      }
      const ki = rb.kind_issue_parts, split = rb.kind_issue, ns = rb.null_share_excluding_kind_issue;
      if (typeof ki !== "number" || !split || !ns || typeof rb.display !== "string") {
        fail("unresolved_kind_issue", `${label}: must print kind_issue_parts, kind_issue {pending_plan, plan_ran, unplanned}, null_share_excluding_kind_issue and display — rebuild the report`);
        continue;
      }
      if (ki < 0 || ki > rb.parts) fail("unresolved_kind_issue", `${label}: kind_issue_parts ${ki} outside 0..${rb.parts}`);
      if (split.pending_plan + split.plan_ran + split.unplanned !== ki) {
        fail("unresolved_kind_issue", `${label}: pending_plan ${split.pending_plan} + plan_ran ${split.plan_ran} + unplanned ${split.unplanned} != kind_issue_parts ${ki}`);
      }
      const wantNum = rb.parts - ki, wantDen = k.parts - ki;
      const wantPct = wantDen <= 0 ? null : Math.round((wantNum / wantDen) * 1000) / 10;
      if (ns.num !== wantNum || ns.den !== wantDen || ns.pct !== wantPct || ns.over_3pct !== (wantPct !== null && wantPct > 3)) {
        fail("unresolved_kind_issue", `${label}: null_share_excluding_kind_issue ${ns.num}/${ns.den} = ${ns.pct} (over ${ns.over_3pct}) != ${wantNum}/${wantDen} = ${wantPct}`);
      }
      if (!rb.display.startsWith(`(unresolved) ${rb.parts} — ${split.pending_plan} pending move/class`)) {
        fail("unresolved_kind_issue", `${label}: display "${rb.display}" does not say "(unresolved) ${rb.parts} — ${split.pending_plan} pending move/class"`);
      }
    }
  }

  // kind_issue_plans_ran: a kind-issue row still inside its kind AFTER its move/class plan ran (run_id recorded in
  // data/reference/kind-layer-plans-2026-09-13.json) is a plan that did not do what it said. Zero, everywhere.
  run("kind_issue_plans_ran");
  for (const c of cats) for (const k of c.kinds) {
    const u = k.roles?.[UNRESOLVED_ROLE];
    if (u?.kind_issue && u.kind_issue.plan_ran !== 0) {
      fail("kind_issue_plans_ran", `${c.category}.${k.kind}: ${u.kind_issue.plan_ran} kind-issue row(s) still in the kind after their plan ran`);
    }
  }

  return CHECKS.map((name) => {
    const f = fails.get(name)!;
    const skipped = !ran.has(name);
    return { name, passed: !skipped && f.length === 0,
      detail: skipped ? "not run" : f.length === 0 ? "ok" : `${f.length} failure(s): ${f.slice(0, 8).join("; ")}${f.length > 8 ? ` … and ${f.length - 8} more` : ""}` };
  });
}

// ---- reading the committed files ----------------------------------------------------------------------------------

export function completenessVendors(dir: string = COMPLETENESS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => VENDOR_FILE.exec(f)?.[1]).filter((v): v is string => Boolean(v)).sort();
}

export function readCompleteness(vendor: string, dir: string = COMPLETENESS_DIR): CompletenessReport | null {
  if (!SLUG.test(vendor)) return null;
  const file = path.join(dir, `${vendor}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as CompletenessReport;
}

export function readCompletenessSince(vendor: string, dir: string = COMPLETENESS_DIR): Record<string, unknown> | null {
  if (!SLUG.test(vendor)) return null;
  const file = path.join(dir, `${vendor}.since.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Two instants are the same window start when they parse to the same millisecond (so `Z` and `+00:00` agree). */
export function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}
