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
    // `connector` REMOVED 28 Sep 2026, and a test had the decision written down before I made it.
    // tests/wirelessKind.test.ts asserts "cable keeps today's two (connector / media NOT added: optical and
    // RJ45 domains, RF coax cables)" -- and it is right: connector's domain is
    // [lc-duplex, lc-simplex, sc, mpo-12, mpo-16, mpo-24, rj45, integrated]. A router cable is
    // "25-ft Low Loss LMR-240 Cable with TNC Connector" or "20-ft LMR 400 with N Connectors"; neither TNC nor
    // N-type is a domain value, so the cup would be required and unsatisfiable -- the antenna_gain defect,
    // in my own change. MY FILLABILITY CHECK ASKED THE WRONG QUESTION: "does this cup hold facts ANYWHERE"
    // (2,328, yes) instead of "can a value for THESE parts be IN THE DOMAIN". Widening the domain is a
    // dictionary change with its own all-vendor measurement, and note `antenna_connector` already carries the
    // RF domain (rp-tnc, n-type), so an RF cable's connector may belong there rather than here.
    cable: ["cable_length"],
    chassis: ["dimensions", "form_factor", "module_slots", "psu_config", "weight"],
    linecard: ["data_rate", "power_max"],
    fabric: ["power_max"],
    module: ["power_max"],   // kind parity, Batch B 29 Sep 2026 (PARITY_WIDENINGS)
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
    // `connector` out for the same reason: these are "Adaptor HDMI to DVID cable", "RJ.5 Microphone Cable",
    // "USB-C 3.2 Gen 2X2 Active Cable". HDMI, DVI-D, RJ.5 and USB-C are none of them domain values.
    server: ["altitude_max", "cpu", "emc_emissions", "humidity_storage"],   // +2: kind parity, Batch B (PARITY_WIDENINGS)
  },
  // wireless/cable is RF coax and power cords -- "20 ft. cable with RP-TNC connectors" -- so `connector` is
  // out for the reason above. Nothing remains for this category, and the row is kept as a comment rather than
  // deleted so the next reader sees it was considered and why.
  // wireless: { cable: ["connector"] },
  "unified-communications": { server: ["altitude_max", "cpu", "emc_emissions", "humidity_storage"] },
  // CONFERENCING JOINS FOR AN INVARIANT, not for parts: it holds 0 live rows today. All three COLLAB_CATEGORIES
  // (unified-communications, collaboration-endpoints, conferencing) are served by one kind axis, and
  // tests/collabKind.test.ts asserts the other two ask exactly what collaboration-endpoints asks. Adding the
  // row to two of the three broke that invariant — a category diverging because a decision reached its
  // siblings and not it, which is the very defect this whole table exists to remove.
  conferencing: { server: ["altitude_max", "cpu", "emc_emissions", "humidity_storage"] },
  "hyperconverged-infrastructure": { bundle: ["product_compatibility"] },
  "hyperconverged-systems": { bundle: ["product_compatibility"] },   // kind parity, Batch B (PARITY_WIDENINGS)
  // pluggable joined the list on the reviewer's ruling rather than being a kind split: an ONS/NCS DWDM optic
  // and a Catalyst SFP are the same physical object, and the DWDM-specific cups (wavelength, reach_max,
  // tunability) are already gated on media/standard, so this references transceiver's question set rather
  // than keeping a thinner copy of it.
  "optical-networking": {
    pluggable: ["ddm", "form_factor", "media", "standard", "temp_class", "temp_operating"],
    chassis: ["altitude_max", "product_compatibility", "temp_storage"],   // kind parity, Batch B: THE REAL EDIT (PARITY_WIDENINGS)
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

/**
 * KIND PARITY, BATCH B (reviewer ruling, 29 Sep 2026): "chassis edit + five widenings with the evidence column". Each row the
 * ruling added above, with the RICHER side's witness -- the category/kind that already asks the cup, and a real SKU there. The
 * ruling's argument is that the object publishes the cup, so the poorer side's absence becomes a counted not-held rather than
 * an invisible one. MEASURED 29 Sep: neither side holds one OWN fact for any of these cups; the witness is the requirement the
 * richer side already makes, which is why the poorer side's parts are mostly not-held (collab servers 0 of 30 spec-bearing).
 * TWO of the ruled five were REFUSED on measurement and are NOT rows: collab cable `media` (177 of 308 are HDMI/USB/AV/power
 * leads, outside media's domain -- the connector trap -- and the richer hci side is C19/C20 power cords) and collab memory
 * `flash` (4 DDR4 RDIMMs; the richer interfaces-modules side is 2 route-memory DIMMs, so flash fits neither side).
 * tests/physicalObjectCups.test.ts holds this list and the table rows to each other, both directions.
 */
export const PARITY_WIDENINGS: readonly { category: string; kind: string; cups: readonly string[]; richer: string; witness: string }[] = [
  { category: "collaboration-endpoints", kind: "server", cups: ["emc_emissions", "humidity_storage"], richer: "hyperconverged-systems", witness: "HX-B200-M5-U" },
  { category: "unified-communications", kind: "server", cups: ["emc_emissions", "humidity_storage"], richer: "hyperconverged-systems", witness: "HX-B200-M5-U" },
  { category: "conferencing", kind: "server", cups: ["emc_emissions", "humidity_storage"], richer: "hyperconverged-systems", witness: "HX-B200-M5-U" },
  { category: "hyperconverged-systems", kind: "bundle", cups: ["product_compatibility"], richer: "hyperconverged-infrastructure", witness: "HCI-M6-MLB" },
  { category: "routers", kind: "module", cups: ["power_max"], richer: "interfaces-modules", witness: "3810-VCM3" },
  { category: "optical-networking", kind: "chassis", cups: ["altitude_max", "product_compatibility", "temp_storage"], richer: "hyperconverged-infrastructure", witness: "HCIX-9508-CH" },
];

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
