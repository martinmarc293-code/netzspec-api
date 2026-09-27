// src/core/physicalObjectCups.ts — "a kind's cup set follows the PHYSICAL OBJECT, applied in every category
// it is filed under."
//
// ONE DECISION, TWENTY-TWO ROWS, recorded in
// docs/decisions/2026-09-27-a-kinds-cup-set-follows-the-physical-object.md. `kind_profile_parity` found 19
// hardware kinds asked different cups depending on their category; reading all of them split those into four
// causes, and this is the largest: a profile edited in one place and not the other. A power supply has an
// input voltage wherever it is filed; a router chassis has dimensions and a weight.
//
// WHY A TABLE AND A WIDENING FUNCTION RATHER THAN 38 SCATTERED EDITS. Two reasons, and the second is the one
// that decided it:
//
//  1. The decision is one sentence. Twelve or twenty-two separate edits are that many chances to re-argue it,
//     and no reader could tell afterwards which lines belonged to it.
//  2. AN OBJECT SPREAD WOULD SILENTLY DESTROY THE EXISTING REQUIREMENT. `form_factor` in `routers` is
//     `cond(kind in [appliance])`; overwriting it with `cond(kind in [chassis])` does not ADD chassis, it
//     REMOVES appliance — a profile losing a cup for a kind that had it, with nothing to say so. So the
//     table declares which kinds to ADD and the widening below is required to preserve whatever was there.
//
// The applier runs once at module load, over the real PROFILES, so there is exactly one description of the
// decision and no hand-written copy to drift from it.
import type { Condition, Requirement } from "./fieldSchema.js";

/** category -> kind -> the cups that kind must be asked here and is not. */
export const PHYSICAL_OBJECT_CUPS: Record<string, Record<string, readonly string[]>> = {
  routers: {
    power: ["airflow", "psu_rated_output"],
    drive: ["drive_interface"],
    memory: ["memory_speed_max"],
    cable: ["cable_length", "connector"],
    chassis: ["dimensions", "form_factor", "module_slots", "psu_config", "weight"],
    linecard: ["data_rate", "power_max"],
    fabric: ["power_max"],
    // `antenna_gain` is DELIBERATELY ABSENT. Measured 27 Sep 2026: it holds 0 facts in the entire catalogue,
    // across every vendor, so requiring it of 88 router antennas would create 88 gaps nothing can close --
    // "a required field that nothing can ever fill is a permanent gap, not a recorded one". Its exclusion
    // surfaced a live defect the decision record carries: it is ALREADY required on `antenna` in wireless
    // (216 parts) and has never been filled once, which is a finding for that profile.
    antenna: ["antenna_connector"],
  },
  switches: {
    drive: ["drive_interface"],
    memory: ["memory_speed_max"],
    chassis: ["certifications", "humidity_operating"],
    fabric: ["power_max"],
    supervisor: ["power_max"],
  },
  "interfaces-modules": {
    power: ["input_voltage", "airflow", "psu_rated_output"],
    cable: ["cable_length"],
    module: ["ports"],
  },
  "collaboration-endpoints": {
    cable: ["connector"],
    server: ["altitude_max", "cpu"],
  },
  wireless: { cable: ["connector"] },
  "unified-communications": { server: ["altitude_max", "cpu"] },
  "hyperconverged-infrastructure": { bundle: ["product_compatibility"] },
  // pluggable joined the list on the reviewer's ruling rather than being a kind split: an ONS/NCS DWDM optic
  // and a Catalyst SFP are the same physical object, and the DWDM-specific cups (wavelength, reach_max,
  // tunability) are already gated on media/standard, so this references transceiver's question set rather
  // than keeping a thinner copy of it.
  "optical-networking": {
    pluggable: ["ddm", "form_factor", "media", "standard", "temp_class", "temp_operating"],
    // AMPLIFIER JOINED THIS TABLE ON 27 Sep 2026, and it was ruled a kind SPLIT until the rows were read.
    // The premise was that video's `amplifier` rows are RF amplifiers; 88 of 88 of their names read OPTICAL
    // and 0 read RF -- EDFAs and optical post-amps, every one stating its output in dBm -- and video ALREADY
    // carries a separate `rf-amplifier` kind with 51 real RF rows. So it is one physical object in two
    // categories, which is this table's principle rather than a split.
    // docs/reports/2026-09-27-amplifier-is-not-a-split-video-already-has-the-rf-kind.md
    amplifier: ["tx_power"],
  },
  // The other half of the same row. An optical amplifier has an output power, a power draw and a
  // compatibility list whichever category it is filed under; the applier widens each side independently.
  video: { amplifier: ["power_max", "product_compatibility"] },
};

/** Every (category, kind, cup) the table names, flattened — the denominator for any count over it. */
export function physicalObjectRows(): { category: string; kind: string; cups: readonly string[] }[] {
  return Object.entries(PHYSICAL_OBJECT_CUPS).flatMap(([category, byKind]) =>
    Object.entries(byKind).map(([kind, cups]) => ({ category, kind, cups })));
}

/**
 * The requirement a cup should carry once `kinds` are ALSO asked it — never instead of what it had.
 *
 * Each branch is the answer to "what did this category already say about this cup", and getting any of them
 * wrong loses data rather than erroring:
 *
 *   absent  the category never mentioned it -> ask the named kinds, `opt` for everything else. NOT `na` for
 *           the rest: a category that never declared a cup has not decided it is inapplicable, and saying so
 *           would put a false statement on every other kind (the reason `elseOpt` exists at all).
 *   opt     nice-to-have everywhere -> required of these kinds, still `opt` for the rest.
 *   req     already required of everything, including these kinds. Nothing to widen; returned unchanged.
 *   na      the category has decided the cup cannot apply. That decision is NOT overridden here: widening
 *           from `na` is a reversal, not an addition, and it needs its own record. Returned unchanged and
 *           COUNTED by the applier so it cannot happen silently.
 *   cond    the interesting one: `any([existing, kind in kinds])`, keeping `elseOpt` exactly as it was, so
 *           every kind the condition already required keeps its requirement and the new kinds join it.
 */
export function alsoAskedOf(existing: Requirement | undefined, kinds: readonly string[]): Requirement {
  const forKinds: Condition = { field: "kind", inList: [...kinds] };
  if (existing === undefined) return { kind: "cond", when: forKinds, elseOpt: true };
  switch (existing.kind) {
    case "req": return existing;
    case "na": return existing;
    case "opt": return { kind: "cond", when: forKinds, elseOpt: true };
    case "cond": return { kind: "cond", when: { any: [existing.when, forKinds] }, elseOpt: existing.elseOpt };
  }
}

export type ApplyReport = {
  /** cups widened, as `category|kind|cup` */
  widened: string[];
  /** cups left alone because the category had declared them `na` — a reversal needs its own decision */
  refusedNa: string[];
  /** cups already `req` for everything, so the row was a no-op */
  alreadyReq: string[];
  /** a cup the dictionary does not know: the table names a key that does not exist */
  unknownKey: string[];
};

/**
 * Apply the table to a PROFILES object, in place, and REPORT what it did — including what it declined to do.
 *
 * The report is not decoration. A silent applier would make a `na` refusal and a successful widening look the
 * same from outside, and "22 rows landed" would be unfalsifiable; tests/physicalObjectCups.test.ts asserts the
 * exact counts, so a row that stops landing shows up as a number rather than as a quiet absence.
 */
export function applyPhysicalObjectCups(
  profiles: Record<string, Record<string, Requirement>>,
  dictionaryHas: (key: string) => boolean,
): ApplyReport {
  const out: ApplyReport = { widened: [], refusedNa: [], alreadyReq: [], unknownKey: [] };
  for (const { category, kind, cups } of physicalObjectRows()) {
    const profile = profiles[category];
    if (!profile) continue;                       // a category with no profile is not this decision's business
    for (const cup of cups) {
      const where = `${category}|${kind}|${cup}`;
      if (!dictionaryHas(cup)) { out.unknownKey.push(where); continue; }
      const before = profile[cup];
      if (before?.kind === "na") { out.refusedNa.push(where); continue; }
      if (before?.kind === "req") { out.alreadyReq.push(where); continue; }
      profile[cup] = alsoAskedOf(before, [kind]);
      out.widened.push(where);
    }
  }
  return out;
}
