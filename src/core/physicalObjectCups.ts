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
    // + power_max, product_compatibility, rack_units, temp_operating: ruling Q1 (29 Sep 2026), the chassis UNION in all six
    // categories -- the board's pair line showed one cup of six. routers holds 6 own rack_units facts (NCS4206-SA).
    chassis: ["dimensions", "form_factor", "module_slots", "psu_config", "weight", "power_max", "product_compatibility", "rack_units", "temp_operating"],
    linecard: ["data_rate", "power_max"],
    fabric: ["power_max"],
    // `module` +power_max was ruled (Batch B) and REVERTED the same day: routers.module then asks 4 cups at nothing known
    // (ports, power_max, product_compatibility + cellular_bands pending), and rule 6 bounds a component kind at 3 -- the
    // basis of its recorded granularity exception. A conflict between two rulings goes back to the reviewer, not into a threshold.
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
    // + the Q1 union (29 Sep 2026). switches holds 11 own temp_operating facts on chassis it was not asking (C9404R).
    chassis: ["certifications", "humidity_operating", "altitude_max", "power_max", "product_compatibility", "temp_operating", "temp_storage"],
    fabric: ["power_max"],
    supervisor: ["power_max"],
    // ruling Q3 (29 Sep 2026): the Batch B module power_max, which only routers is excused from (rule 6). 19 own facts
    // already sit on switch modules that were not asked it (IEM-3300-14T2S=).
    module: ["power_max"],
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
    // ruling (d), 29 Sep 2026: a bundle states what it works with wherever it is filed. Relation-backed, so a bundle with
    // no compatibility relation is counted not_held, never a gap nothing can close.
    bundle: ["product_compatibility"],
  },
  // wireless/cable was RF coax AND mains cords -- "20 ft. cable with RP-TNC connectors" beside "AC Power Cord, Type C5" --
  // so `connector` stayed out. RULING Q4 (29 Sep 2026): the 82 mains cords become their own `power-cord` kind (wirelessKind),
  // which leaves `cable` the 59 RF / console / Cat 6A cables that DO have a connector, in this category's RF domain.
  wireless: { bundle: ["product_compatibility"], cable: ["connector"] },
  "unified-communications": { server: ["altitude_max", "cpu", "emc_emissions", "humidity_storage"], bundle: ["product_compatibility"] },
  // CONFERENCING JOINS FOR AN INVARIANT, not for parts: it holds 0 live rows today. All three COLLAB_CATEGORIES
  // (unified-communications, collaboration-endpoints, conferencing) are served by one kind axis, and
  // tests/collabKind.test.ts asserts the other two ask exactly what collaboration-endpoints asks. Adding the
  // row to two of the three broke that invariant — a category diverging because a decision reached its
  // siblings and not it, which is the very defect this whole table exists to remove.
  conferencing: { server: ["altitude_max", "cpu", "emc_emissions", "humidity_storage"], bundle: ["product_compatibility"] },
  // chassis rack_units: ruling Q1 -- UNGATED on the chassis kind. The form_factor gate is for servers (rack or blade); a
  // chassis is rack-mounted by definition, so the widening ADDS kind chassis beside the gate rather than replacing it.
  "hyperconverged-infrastructure": { bundle: ["product_compatibility"], server: ["emc_emissions", "humidity_storage"], chassis: ["rack_units"] },   // server: PARITY_WIDENINGS
  // The server group is FIVE categories, not the pair the parity check printed: once collab asked what hyperconverged-systems asks,
  // servers-unified-computing and hci were the odd two out (cupLedger's cross-category set check). Same principle, same cups.
  "servers-unified-computing": { server: ["emc_emissions", "humidity_storage"], bundle: ["product_compatibility"], chassis: ["rack_units"] },   // PARITY_WIDENINGS
  "hyperconverged-systems": { bundle: ["product_compatibility"] },   // kind parity, Batch B (PARITY_WIDENINGS)
  // pluggable is NOT a row here any more (29 Sep 2026). The six-cup `pluggable` row that stood here claimed to "reference
  // transceiver's question set rather than keep a thinner copy", and was a thinner copy: seven cups still diverged
  // (cable_length, fiber_type, reach_max, rx_sensitivity, tx_power, wavelength, wire_gauge). Ruling (d): one profile,
  // transceiver's, referenced by optical -- KIND_QUESTION_SET_FROM below, derived at load from the real profile.
  "optical-networking": {
    chassis: ["altitude_max", "product_compatibility", "temp_storage"],   // kind parity, Batch B: THE REAL EDIT (PARITY_WIDENINGS)
    cable: ["product_compatibility"],   // ruling (d): the one category that did not ask it of a cable
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
  video: { amplifier: ["power_max", "product_compatibility"], chassis: ["altitude_max", "product_compatibility", "temp_storage"] },   // chassis: Q1 union
  // ruling (d): an MDS supervisor has a fabric bandwidth; its MAC table / uplinks are an exception (kindProfiles.ts).
  "storage-networking": { supervisor: ["fabric_bandwidth"] },
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
  // servers-unified-computing prints both on its own sheets: DN3-HW-APL-XL holds OWN facts for emc_emissions and humidity_storage.
  { category: "servers-unified-computing", kind: "server", cups: ["emc_emissions", "humidity_storage"], richer: "hyperconverged-systems", witness: "HX-B200-M5-U" },
  { category: "hyperconverged-infrastructure", kind: "server", cups: ["emc_emissions", "humidity_storage"], richer: "hyperconverged-systems", witness: "HX-B200-M5-U" },
  { category: "optical-networking", kind: "chassis", cups: ["altitude_max", "product_compatibility", "temp_storage"], richer: "hyperconverged-infrastructure", witness: "HCIX-9508-CH" },
  // ---- ruling (d) + Q1/Q3/Q4, 29 Sep 2026, on the full N-way view (docs/reviewer/2026-09-28/parity-full-view.md) ----
  // bundle: relation-backed; C1-N9KC93108FX-B24 carries 100 compatible relations.
  { category: "collaboration-endpoints", kind: "bundle", cups: ["product_compatibility"], richer: "switches", witness: "C1-N9KC93108FX-B24" },
  { category: "unified-communications", kind: "bundle", cups: ["product_compatibility"], richer: "switches", witness: "C1-N9KC93108FX-B24" },
  { category: "conferencing", kind: "bundle", cups: ["product_compatibility"], richer: "switches", witness: "C1-N9KC93108FX-B24" },
  { category: "wireless", kind: "bundle", cups: ["product_compatibility"], richer: "switches", witness: "C1-N9KC93108FX-B24" },
  { category: "servers-unified-computing", kind: "bundle", cups: ["product_compatibility"], richer: "switches", witness: "C1-N9KC93108FX-B24" },
  // cable: routers asks both of its RF cables, in the same RF connector domain wireless now carries.
  { category: "wireless", kind: "cable", cups: ["connector"], richer: "routers", witness: "3G-CAB-LMR240-25" },
  { category: "optical-networking", kind: "cable", cups: ["product_compatibility"], richer: "routers", witness: "3G-CAB-LMR240-25" },
  // chassis, Q1: optical-networking asks all six (rack_units ungated), so it is the richer side for every row.
  { category: "routers", kind: "chassis", cups: ["power_max", "product_compatibility", "rack_units", "temp_operating"], richer: "optical-networking", witness: "15454-M6-SA" },
  { category: "switches", kind: "chassis", cups: ["altitude_max", "power_max", "product_compatibility", "temp_operating", "temp_storage"], richer: "optical-networking", witness: "15454-M6-SA" },
  { category: "video", kind: "chassis", cups: ["altitude_max", "product_compatibility", "temp_storage"], richer: "optical-networking", witness: "15454-M6-SA" },
  { category: "servers-unified-computing", kind: "chassis", cups: ["rack_units"], richer: "optical-networking", witness: "15454-M6-SA" },
  { category: "hyperconverged-infrastructure", kind: "chassis", cups: ["rack_units"], richer: "optical-networking", witness: "15454-M6-SA" },
  // module power_max, Q3: security asks it of every module.
  { category: "switches", kind: "module", cups: ["power_max"], richer: "security", witness: "ASA-IC-6GE-CU-A" },
  // supervisor fabric_bandwidth, (d): VS-S2T-10G holds its own.
  { category: "storage-networking", kind: "supervisor", cups: ["fabric_bandwidth"], richer: "switches", witness: "VS-S2T-10G" },
];

/**
 * A KIND ASKED ANOTHER CATEGORY'S QUESTION SET, BY REFERENCE (29 Sep 2026). "A kind's cup set follows the physical
 * object" said once per (category, kind) instead of per cup: the target category asks this kind exactly what the
 * source category asks the same kind, derived at load from the REAL source profile, so a later edit to the source
 * reaches the target without anyone remembering to copy it -- a copy is how the pluggable row drifted seven cups.
 *
 *  - optical-networking / pluggable <- transceiver: ruling (d), "one profile (transceiver's), referenced by optical".
 *  - wireless component kinds <- servers-unified-computing: rulings Q3/Q4. wireless filed ~58 appliance internals
 *    (DIMMs, drives, CPUs, RAID, TPMs, NICs) and 9 fan trays under `module`, and 82 mains cords under `cable`; wirelessKind
 *    now names them, and a DIMM in a wireless appliance is asked what a DIMM in a UCS server is asked.
 */
export const KIND_QUESTION_SET_FROM: readonly { category: string; kind: string; from: string; ruling: string }[] = [
  { category: "optical-networking", kind: "pluggable", from: "transceiver", ruling: "(d) 29 Sep 2026" },
  ...(["memory", "drive", "cpu", "storage-controller", "tpm", "nic", "fan", "power-cord"] as const).map((kind) =>
    ({ category: "wireless", kind, from: "servers-unified-computing", ruling: "Q3/Q4 29 Sep 2026" })),
];

/**
 * The requirement `target` must carry so that `kind` resolves exactly as `source` resolves it, and every OTHER kind
 * exactly as `target` did. Returns `"unchanged"` when neither side asks anything of anyone the composition would change,
 * and `"na-reversal"` when the target category declared the cup `na` (inapplicable to all its kinds) and the source asks
 * it of this kind -- widening from `na` is a reversal of a category's decision and needs its own record, as in
 * alsoAskedOf.
 *
 * The composed condition is any([kind = K AND source-condition], [kind != K AND target-condition]). `elseOpt` keeps the
 * TARGET's meaning for other kinds (the part of the profile this must not move); for kind K it can only differ between
 * `opt` and `na`, never in what is required or pending -- the two buckets the parity check and the ledgers compare.
 */
export function askedAsIn(target: Requirement | undefined, source: Requirement | undefined, kind: string): Requirement | "unchanged" | "na-reversal" {
  const isK: Condition = { field: "kind", inList: [kind] };
  const notK: Condition = { field: "kind", notInList: [kind] };
  // What each side requires OF THIS KIND, with every kind test decided: true, false, or the non-kind remainder (a media
  // gate, a role gate). Comparing these -- not the raw conditions -- is what keeps the rewrite to the keys that differ;
  // composing blindly rewrote 535 rows, most of them into an equivalent condition nested eight levels deep.
  const forK = (r: Requirement | undefined): Condition | boolean =>
    !r ? false : r.kind === "req" ? true : r.kind === "cond" ? restrictKind(r.when, kind, true) : false;
  const sK = forK(source);
  if (target?.kind === "na") return sK === false ? "unchanged" : "na-reversal";
  if (JSON.stringify(sK) === JSON.stringify(forK(target))) return "unchanged";
  // Every OTHER kind keeps the target's answer: its condition with this kind removed from each kind test. When that
  // remainder could still fire for this kind through a non-kind test, it is fenced with kind != K.
  const tOthers = !target ? false : target.kind === "req" ? true : target.kind === "cond" ? restrictKind(target.when, kind, false) : false;
  const tPart: Condition | null = tOthers === false ? null : tOthers === true ? notK
    : restrictKind(tOthers, kind, true) === false ? tOthers : { all: [notK, tOthers] };
  const sPart: Condition | null = sK === false ? null : sK === true ? isK : { all: [isK, sK] };
  const targetElse = !target || target.kind === "opt" ? true : target.kind === "cond" ? !!target.elseOpt : null;
  const sourceElse = !source ? false : source.kind === "opt" ? true : source.kind === "cond" ? !!source.elseOpt : false;
  const elseOpt = targetElse ?? sourceElse;
  if (!tPart && !sPart) return { kind: elseOpt ? "opt" : "na" };
  const when: Condition = tPart && sPart ? { any: [tPart, sPart] } : (tPart ?? sPart)!;
  return { kind: "cond", when: flattenCondition(when), elseOpt };
}

/**
 * The same condition, legible: a nested any/all is spliced into its parent of the same operator, and the `kind in [...]`
 * tests directly under one `any` merge into ONE list. Widenings accumulate as any([any([any([...]), kind in [x]]), kind
 * in [y]]) -- wireless product_compatibility had reached 23 levels -- and the profile row is what a consumer of
 * /v1/fields reads. Pure: equivalence is by construction (splicing and list union preserve every branch).
 */
export function flattenCondition(c: Condition): Condition {
  if ("any" in c || "all" in c) {
    const op = "any" in c ? "any" : "all";
    const kids = ("any" in c ? c.any : (c as { all: Condition[] }).all).map(flattenCondition)
      .flatMap((k) => (op in k ? (k as Record<string, Condition[]>)[op] : [k]));
    let out = kids;
    if (op === "any") {
      const kinds: (string | number)[] = [];
      const rest: Condition[] = [];
      for (const k of kids) {
        if (!("any" in k) && !("all" in k) && k.field === "kind" && "inList" in k) for (const v of k.inList) { if (!kinds.includes(v)) kinds.push(v); }
        else rest.push(k);
      }
      out = kinds.length ? [{ field: "kind", inList: kinds }, ...rest] : rest;
    }
    return out.length === 1 ? out[0] : (op === "any" ? { any: out } : { all: out });
  }
  return c;
}

/**
 * A condition with every test on `kind` DECIDED for one side of a split: for `isK` the part's kind IS `kind` (so
 * `kind in [...]` becomes true or false); otherwise it is some OTHER kind (so `kind` is struck from each list, and an
 * emptied list decides). Non-kind tests are kept. any/all fold their decided children, so the result is `true`, `false`,
 * or the smallest condition that still needs the part's other values.
 */
export function restrictKind(c: Condition, kind: string, isK: boolean): Condition | boolean {
  if ("any" in c) {
    const kids = c.any.map((x) => restrictKind(x, kind, isK));
    if (kids.some((k) => k === true)) return true;
    const rest = kids.filter((k): k is Condition => k !== false);
    return rest.length === 0 ? false : rest.length === 1 ? rest[0] : { any: rest };
  }
  if ("all" in c) {
    const kids = c.all.map((x) => restrictKind(x, kind, isK));
    if (kids.some((k) => k === false)) return false;
    const rest = kids.filter((k): k is Condition => k !== true);
    return rest.length === 0 ? true : rest.length === 1 ? rest[0] : { all: rest };
  }
  if (c.field !== "kind") return c;
  if ("inList" in c) {
    if (isK) return c.inList.includes(kind);
    const l = c.inList.filter((x) => x !== kind);
    return l.length ? { field: "kind", inList: l } : false;
  }
  if ("notInList" in c) {
    if (isK) return !c.notInList.includes(kind);
    const l = c.notInList.filter((x) => x !== kind);
    return l.length ? { field: "kind", notInList: l } : true;
  }
  if ("eq" in c) return isK ? c.eq === kind : c.eq === kind ? false : c;
  if ("ne" in c) return isK ? c.ne !== kind : c.ne === kind ? true : c;
  return c;
}

export type QuestionSetReport = { rewritten: string[]; unchanged: number; naReversal: string[]; missingProfile: string[] };

/** Apply KIND_QUESTION_SET_FROM to a PROFILES object in place, over the UNION of both profiles' keys (column-backed keys
 *  excepted: they are columns every part carries, not questions), and report what it did and what it refused. */
export function applyKindQuestionSetFrom(
  profiles: Record<string, Record<string, Requirement>>,
  columnBacked: ReadonlySet<string>,
): QuestionSetReport {
  const out: QuestionSetReport = { rewritten: [], unchanged: 0, naReversal: [], missingProfile: [] };
  for (const { category, kind, from } of KIND_QUESTION_SET_FROM) {
    const target = profiles[category], source = profiles[from];
    if (!target || !source) { out.missingProfile.push(`${category}<-${from}`); continue; }
    for (const key of [...new Set([...Object.keys(source), ...Object.keys(target)])].sort()) {
      if (columnBacked.has(key)) continue;
      const r = askedAsIn(target[key], source[key], kind);
      if (r === "unchanged") { out.unchanged++; continue; }
      if (r === "na-reversal") { out.naReversal.push(`${category}|${kind}|${key}`); continue; }
      target[key] = r;
      out.rewritten.push(`${category}|${kind}|${key}`);
    }
  }
  return out;
}

/**
 * A CUP ASKED OF A KIND ONLY WHEN A GATE HOLDS, in every category the kind is filed under (ruling (d), 29 Sep 2026:
 * "module cellular_bands gated on `cellular` on both sides"). routers asked a cellular module its bands; interfaces-modules,
 * wireless, security and switches asked no module at all. The gate key is DECLARED for the kind too (as routers does), so
 * an unanswered gate pends instead of falling through to elseOpt -- `cellular` is a column (derive-cellular, 0 NULL), so
 * for real parts it is always answered and the cup is required exactly where a module is cellular.
 */
export const GATED_CUPS: readonly { categories: readonly string[]; kind: string; cup: string; gate: Condition; gateKey: string }[] = [
  { categories: ["interfaces-modules", "wireless", "security", "switches"], kind: "module", cup: "cellular_bands", gate: { field: "cellular", eq: true }, gateKey: "cellular" },
];

export function applyGatedCups(profiles: Record<string, Record<string, Requirement>>): ApplyReport {
  const out: ApplyReport = { widened: [], refusedNa: [], alreadyReq: [], unknownKey: [] };
  for (const { categories, kind, cup, gate, gateKey } of GATED_CUPS) for (const category of categories) {
    const profile = profiles[category];
    if (!profile) continue;
    const where = `${category}|${kind}|${cup}`;
    const before = profile[cup];
    if (before?.kind === "na" || profile[gateKey]?.kind === "na") { out.refusedNa.push(where); continue; }
    if (before?.kind === "req") { out.alreadyReq.push(where); continue; }
    profile[cup] = alsoAskedWhen(before, { all: [gate, { field: "kind", inList: [kind] }] });
    profile[gateKey] = alsoAskedOf(profile[gateKey], [kind]);
    out.widened.push(where);
  }
  return out;
}

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
  return alsoAskedWhen(existing, { field: "kind", inList: [...kinds] });
}

/** alsoAskedOf with any condition in place of "kind in kinds" -- the same five branches, so a GATED addition (GATED_CUPS)
 *  preserves what was there exactly as a kind addition does. */
export function alsoAskedWhen(existing: Requirement | undefined, when: Condition): Requirement {
  if (existing === undefined) return { kind: "cond", when, elseOpt: true };
  switch (existing.kind) {
    case "req": return existing;
    case "na": return existing;
    case "opt": return { kind: "cond", when, elseOpt: true };
    case "cond": return { kind: "cond", when: { any: [existing.when, when] }, elseOpt: existing.elseOpt };
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
