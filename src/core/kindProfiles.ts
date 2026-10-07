// src/core/kindProfiles.ts — WHY a kind is asked different cups in two categories.
//
// A KIND IS ONE THING. `power-supply` asks the same questions whether it sits under `routers` or
// `switches`, so a cup that differs between two categories for the same kind is either a decision
// somebody made or — far more often — a profile edited in one place and not the other. Until this
// file existed nothing could tell those apart, and `kind_profile_parity` could only print a list.
//
// WHAT THIS FILE IS NOT. It is not a way to make that test green. Reading all 19 divergences in full
// (docs/reports/2026-09-27-the-nineteen-divergent-kinds-are-four-different-problems.md) showed they
// are FOUR causes, and an exception is the right record for exactly one of them:
//
//   A  not a kind                        `unknown` — the classifier's "cannot say". Excluded
//                                        structurally below; `unknown_zero` owns that population.
//   B  one kind name, two devices        amplifier, sensor, gateway, camera, pluggable. A cup
//                                        difference here is the RIGHT answer to the WRONG question:
//                                        `cellular_bands` and `fxo_ports` cannot both belong to one
//                                        kind. The fix is partKind.ts, and an exception would freeze
//                                        the misclassification in place.
//   C  same cups, different level        appliance: `security` holds them `pending` where `meraki`
//                                        holds them `req`. Seven apparent disagreements, ONE decision.
//   D  a profile edited in one place     twelve kinds. The fix is the profile, each an arrangement
//                                        decision; three genuine distinctions inside D are recorded
//                                        here and the rest are OPEN.
//
// So the file has two halves and both are load-bearing: the exceptions that are settled, and an OPEN
// register naming every divergence that is not, with its cause. A divergence in neither half fails the
// test — an unruled divergence must never read as an accepted one, which is the whole failure mode this
// file exists to prevent.

import { FIELD_DICTIONARY } from "./fieldSchema.js";

/** A settled ruling: these categories are asked different things for this kind ON PURPOSE. */
export type KindParityException = {
  kind: string;
  /** the cups this ruling covers. A divergence on a cup NOT listed here is still a failure. */
  cups: string[];
  /** the categories the difference is between. Every one must hold a live part of the kind. */
  categories: string[];
  reason: string;
  /** a real SKU, so the next reader can go and look instead of taking the reason on trust. */
  witness: string;
  /** A LEASE, NOT A STATE: the ruling lapses the moment this dictionary key exists, and the divergence comes back red.
   *  For an exception granted only until a signal lands (reviewer, 29 Sep 2026: "park with an expiry").
   *  `date` (YYYY-MM-DD) is the other expiry: a measurement that is DUE, not a signal that may never come. Past the
   *  date the lease lapses on its own, so "parked until someone measures" cannot quietly become "parked for ever". */
  until?: { dictionaryKey?: string; date?: string; note: string;
    /** WHO ACTS before the lease ends (reviewer, 7 Oct 2026, after the antenna lease lapsed unmeasured and stopped a night:
     *  "A lease should never lapse silently ... warn 7 days before any exception's until date, and name the owner"). */
    owner?: string };
};

/** An unsettled divergence: named, with its cause and who has to decide. Still counted as a failure. */
export type KindParityOpen = {
  kind: string;
  cause: "kind-split" | "strictness" | "profile-gap";
  note: string;
};

/**
 * NOT A KIND AT ALL. `unknown` is what partKind returns when it cannot classify, so comparing its cup
 * sets across ten categories asks whether two UNCLASSIFIED populations are asked the same questions.
 * That is not a question about a kind, and `unknown_zero` already judges the population (3,944 live
 * hardware parts) with the right fix: classification. Excluded here, in the open, rather than silently
 * filtered — an exclusion nobody can see is where the next real break hides.
 */
export const NOT_A_KIND: ReadonlySet<string> = new Set(["unknown"]);

/**
 * THE SETTLED RULINGS. Three, and every one is provable from its witness rather than from a preference.
 * A ruling needs a reason that says what the product IS, because "these differ on purpose" is not a
 * reason, it is the claim.
 */
export const KIND_PARITY_EXCEPTIONS: readonly KindParityException[] = [
  {
    kind: "cable",
    cups: ["data_rate", "ddm", "form_factor", "power_max", "standard", "temp_class", "wire_gauge"],
    categories: ["transceiver"],
    reason:
      "A `cable` filed under `transceiver` is an ACTIVE cable — a DAC or AOC — which is an optic with " +
      "its fibre already attached. It has a data rate, a form factor (the cage it plugs into), digital " +
      "diagnostics, a power draw, an ethernet standard and a temperature class. A passive patch lead in " +
      "any of the other twelve categories has none of those. The difference is the product, not the profile.",
    witness: "MA-CBL-100G-1M",
  },
  {
    kind: "linecard",
    cups: ["fabric_bandwidth", "poe_standard", "poe_ports"],
    categories: ["switches"],
    reason:
      "PoE and a fabric bandwidth are properties of a SWITCH line card. An optical, router or " +
      "storage-networking line card does not carry power over ethernet and has no switching fabric to " +
      "be measured against, so asking would create a gap nothing could ever close.",
    witness: "2D-X6816-10G-2T=",
  },
  {
    kind: "module",
    cups: ["poe_standard", "poe_ports"],
    categories: ["switches"],
    reason: "The same distinction one kind over: a PoE standard on a switch module is real, and on an " +
      "interface or router module there is no PoE to state.",
    witness: "ACE30-BASE-04-K9",
  },
  {
    kind: "module",
    cups: ["power_max"],
    categories: ["routers"],
    reason: "RULE 6 WINS (reviewer ruling, Batch B 29 Sep 2026): a component kind asks at most 3 cups at nothing known, the " +
      "basis of routers.module's granularity exception. power_max made it 4 (ports, power_max, product_compatibility, + " +
      "cellular_bands pending), so it stays optional in routers while interfaces-modules asks it.",
    witness: "3810-VCM3",
  },
  {
    kind: "cable",
    cups: ["media"],
    categories: ["collaboration-endpoints", "routers", "interfaces-modules", "wireless", "data-center-networking", "unified-communications"],
    reason: "`media` (mmf/smf/dac-copper/rj45-copper/aoc) belongs to a DATA cable, and nothing tells a data cable from an HDMI, USB " +
      "or power lead: 177 of collab's 308 cables are those. It is asked in 8 categories and not in these 6. Parked with an " +
      "expiry (reviewer ruling, 29 Sep 2026) until the data-cable signal lands.",
    witness: "CAB-GREY-2.9M",
    until: { dictionaryKey: "cable_construction", note: "Step 9 (the transceiver pilot) adds cable_construction; media is then gated on it everywhere",
      owner: "the cisco session (netzspec-api-cisco), with the transceiver pilot" },
  },
  // ---- ruling (d), 29 Sep 2026, on the full N-way view (docs/reviewer/2026-09-28/parity-full-view.md) ----
  {
    kind: "supervisor",
    cups: ["mac_table", "uplink_ports"],
    categories: ["storage-networking"],
    reason: "Fibre Channel supervisor - no Ethernet MAC table or uplinks (reviewer ruling, 29 Sep 2026). An MDS 9500/9700 " +
      "supervisor switches FC frames; asking it for an Ethernet MAC table or Ethernet uplinks would be a gap nothing can close. " +
      "fabric_bandwidth, which an MDS supervisor does have, is asked of it (PHYSICAL_OBJECT_CUPS).",
    witness: "DS-X97-SF4-K9",
  },
  {
    kind: "module",
    cups: ["data_rate"],
    categories: ["interfaces-modules"],
    reason: "interfaces-modules' `module` rows are 68 of 68 DSP / voice / crypto cards (PVDM 45, NM-HDV 6, SPA-IPSEC 5, " +
      "ISM-VPN 4, NME-RVPN 3, SM-EC 3, AIM 1, 3810-VCM3 1): a DSP farm or an encryption engine has channels and throughput, " +
      "not a line rate, so data_rate would be 68 permanent gaps (reviewer ruling Q2, 29 Sep 2026).",
    witness: "PVDM4-128",
  },
  {
    kind: "module",
    cups: ["data_rate"],
    categories: ["routers"],
    reason: "RULE 6 WINS, as for power_max (reviewer ruling Q2, 29 Sep 2026): routers.module already asks 3 cups at nothing " +
      "known (ports, product_compatibility, cellular_bands pending), the bound of its granularity exception; data_rate would be the 4th.",
    witness: "CGM-4G-LTE-EA-900",
  },
  // (the routers.antenna antenna_gain lease, until 2026-10-06, lapsed unmeasured and stopped the 7 Oct night; measured and
  // RULED (i) on 7 Oct ~05:20 -- the cup is asked of router antennas now, fieldSchema.ts routers.antenna_gain -- so it is
  // gone from this table rather than renewed: docs/decisions/2026-10-07-antenna-gain-cup-and-lease-warnings.md)
];

/**
 * WHY THE CABLE ENTRY IS STILL AN EXCEPTION AND NOT A GATE. The reviewer's ruling was that it belongs as
 * `data_rate`/`ddm`/`form_factor` pending on `cable_construction` in {active-dac, aoc, aec}, so a
 * MA-CBL-100G-1M filed under `switches` tomorrow is treated the same without a second exception. That
 * reasoning is better than an exception scoped to one category -- and a gate depends on a SIGNAL.
 *
 * Measured over the 176 live cisco transceiver/cable parts this covers: `cable_construction` is not a
 * dictionary key at all, and `dac_type` -- the nearest existing cup -- is filled on ZERO of them. A gate on
 * it would be vacuous for every row it was written for, exempting the whole population and turning
 * kind_profile_parity green because the guard could not fire. The name carries the signal on 115 of 176
 * (AOC 64, passive/DAC 46, active 5), so the gate is reachable in two steps -- the dictionary key with its
 * all-vendor measurement, then a registered derivation with its validation counts -- and not before.
 *
 * docs/decisions/2026-09-27-a-kinds-cup-set-follows-the-physical-object.md carries the table.
 */
export const GATE_NOT_YET_POSSIBLE = {
  kind: "cable", proposedGate: "cable_construction in {active-dac, aoc, aec}",
  blockedBy: "cable_construction is not a dictionary key; dac_type is filled on 0 of 176 rows",
} as const;

/**
 * THE OPEN REGISTER. Sixteen divergences that are NOT rulings, each with the cause the full read found
 * and therefore with the work it actually needs. The test counts these as failures — they are here so
 * the failure names its cause instead of repeating a list, not so it can be waved through.
 */
export const KIND_PARITY_OPEN: readonly KindParityOpen[] = [
  { kind: "amplifier", cause: "kind-split", note: "optical-networking 15216-EDFA1= is an erbium-doped FIBRE amplifier (power_max); video 4000770 is an RF amplifier (tx_power). Two devices, one kind name." },
  // RESOLVED 28 Sep 2026 and kept here as a record rather than deleted, because a register that only ever
  // grows tells you nothing about what was done. `sensor` was SPLIT into `wireless-sensor` (the Aironet 1800S
  // Wi-Fi monitoring sensor, 15 parts in wireless) and `environment-sensor` (the Meraki MT, 16 in meraki), on
  // the test the reviewer set: battery_life and ap_max_clients cannot belong to one kind. wireless-sensor is
  // the AP question set MINUS ap_max_clients, because a monitoring sensor serves no clients.
  //
  // The ruling first said "AIR-AP1800S is an access point filed as a sensor by a rule that matched the wrong
  // token; fix partKind so it lands in ap" and BOTH halves of that were checkable and false: the rule is an
  // explicit line written 13 Sep on purpose, and all 15 rows carry Cisco's own name "Aironet 1800S Series
  // Network Sensor". Holding it and putting the evidence back is what turned it into the split above.
  // RESOLVED 28 Sep 2026: SPLIT into `cellular-gateway` (meraki MG, 18 parts -- cellular_bands) and
  // `voice-gateway` (unified-communications VG / SPA8000 / UNITY-PIMG, 61 parts -- fxo_ports, fxs_ports,
  // audio_codecs). The sharpest of the four: cellular_bands and fxo_ports cannot belong to one kind, and the
  // names say so outright -- "Meraki MG41 Cellular Gateway" against "VG400 Analog Voice Gateway with 6 FXS
  // and 6 FXO".
  // RESOLVED 28 Sep 2026: SPLIT into `conference-camera` (collaboration-endpoints, 60 parts -- camera_zoom,
  // field_of_view) and `security-camera` (meraki MV, 35 -- image_sensor, storage_capacity,
  // video_quality_max). Spread-sampled names: "Cisco Desk Camera 4K", "PTZ 4K Camera", "Quad Camera",
  // "Precision 40 Camera with 8x zoom" against MV12 / MV23 / MV53X-HW / MV72.
  // RESOLVED 29 Sep 2026 (reviewer ruling (d)): `pluggable` is ONE profile, transceiver's, and optical-networking's
  // pluggable is asked it by reference (KIND_QUESTION_SET_FROM in physicalObjectCups.ts), derived at load rather than
  // copied. The thin six-cup copy that stood in PHYSICAL_OBJECT_CUPS left seven cups divergent, which is why a copy loses.
  { kind: "appliance", cause: "strictness", note: "THE SAME CUPS on both sides: security holds concurrent_sessions, firewall_throughput, ipsec_throughput, threat_throughput and the rest as `pending` where meraki holds them as `req`. Seven apparent disagreements, ONE question about strictness, answered by one line in one profile. `ports` falls out with it." },
  { kind: "power", cause: "profile-gap", note: "input_voltage asked by 12 categories, not interfaces-modules; airflow and psu_rated_output asked by 11, not interfaces-modules or routers. A power supply has an input voltage wherever it is filed." },
  { kind: "drive", cause: "profile-gap", note: "drive_interface asked by 6, not routers or switches. C9400-SSD-240GB has an interface." },
  { kind: "memory", cause: "profile-gap", note: "memory_speed_max asked by 7, not routers or switches — a DIMM has a speed. Note `flash`, asked ONLY by interfaces-modules, is the other direction: flash is not RAM and that may be a legitimate addition." },
  { kind: "cable", cause: "profile-gap", note: "SEPARATE from the transceiver ruling above: cable_length asked by 11, not interfaces-modules or routers; connector asked by 10, not collaboration-endpoints, routers or wireless. A cable has a length and a connector everywhere." },
  { kind: "chassis", cause: "profile-gap", note: "ONE profile missing a whole block: dimensions, form_factor, module_slots, psu_config and weight are asked by five categories and not by routers. A router chassis has all five. certifications and humidity_operating are asked by five and not by switches." },
  { kind: "linecard", cause: "profile-gap", note: "SEPARATE from the PoE ruling above: data_rate and power_max asked by 4, not routers." },
  { kind: "module", cause: "profile-gap", note: "SEPARATE from the PoE ruling above: ports asked by 4, not interfaces-modules; data_rate asked by 3, not interfaces-modules or routers; power_max asked by interfaces-modules and security only." },
  { kind: "fabric", cause: "profile-gap", note: "power_max asked by optical-networking and storage-networking, not routers or switches." },
  { kind: "supervisor", cause: "profile-gap", note: "power_max asked by storage-networking, not switches; fabric_bandwidth, mac_table and uplink_ports asked by switches, not storage-networking — the second half may be a real distinction, because an MDS supervisor has no MAC table." },
  { kind: "server", cause: "profile-gap", note: "altitude_max and cpu asked by 3, not collaboration-endpoints or unified-communications. BE6H-M4-K9= is a server and has a CPU. emc_emissions and humidity_storage asked by hyperconverged-systems alone, which is the other direction." },
  { kind: "antenna", cause: "profile-gap", note: "antenna_connector asked by wireless, not routers (antenna_gain is asked by both since ruling (i), 7 Oct 2026). 3G-ACC-OUT-LA is an antenna and has both." },
  { kind: "bundle", cause: "profile-gap", note: "product_compatibility asked by routers and switches, not by the other four." },
];

/**
 * Whether a (kind, cups) divergence is SETTLED. Deliberately strict on both sides:
 *  - every differing cup must be covered by one ruling, so a divergence that has grown a new cup since
 *    the ruling was written comes back as a failure rather than inheriting the old approval;
 *  - the ruling's categories must be among the ones that actually differ, so a ruling about
 *    `transceiver` cannot silently excuse a divergence between two other categories.
 */
/** How far ahead a dated lease warns (reviewer, 7 Oct 2026: "warn 7 days before any exception's until date"). */
export const LEASE_WARN_DAYS = 7;
/**
 * THE ALARM THE ANTENNA LEASE DID NOT HAVE. It lapsed at midnight on its date with nobody told, and the first anyone heard was a
 * stopped night. Every lease in the table is classified for the verifier and the nightly report:
 *   lapsed    -- past its date, or its dictionary key exists: the table holds a ruling that no longer excuses anything (FAIL);
 *   unowned   -- a dated lease that names nobody: a countdown nobody is watching (FAIL);
 *   due       -- a dated lease within LEASE_WARN_DAYS: warned, with its owner and its note, on every board and every report;
 *   event     -- a lease that ends on a SIGNAL (a dictionary key), not a date: listed with its condition, since it has no countdown.
 */
export function leaseWarnings(table: readonly KindParityException[] = KIND_PARITY_EXCEPTIONS,
  today: string = new Date().toISOString().slice(0, 10)): { lapsed: string[]; unowned: string[]; due: string[]; event: string[] } {
  const out = { lapsed: [] as string[], unowned: [] as string[], due: [] as string[], event: [] as string[] };
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  for (const e of table) {
    if (!e.until) continue;
    const who = e.until.owner ?? "NO OWNER NAMED";
    const what = `${e.kind}: ${e.cups.join("/")} in ${e.categories.join(", ")}`;
    if (leaseLapsed(e, today)) { out.lapsed.push(`${what} -- LAPSED (${e.until.date ?? `key ${e.until.dictionaryKey} exists`}); owner: ${who}; ${e.until.note}`); continue; }
    if (e.until.date) {
      if (!e.until.owner) out.unowned.push(`${what} -- until ${e.until.date} names no owner`);
      const left = day(e.until.date) - day(today);
      if (left <= LEASE_WARN_DAYS) out.due.push(`${what} -- DUE ${e.until.date} (in ${left} day${left === 1 ? "" : "s"}); owner: ${who}; ${e.until.note}`);
    } else if (e.until.dictionaryKey) out.event.push(`${what} -- until the dictionary has '${e.until.dictionaryKey}'; owner: ${who}; ${e.until.note}`);
  }
  return out;
}

/** An exception granted UNTIL a dictionary key exists has lapsed once it does: it no longer excuses anything. */
export function leaseLapsed(e: KindParityException, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!e.until) return false;
  if (e.until.dictionaryKey && Object.prototype.hasOwnProperty.call(FIELD_DICTIONARY, e.until.dictionaryKey)) return true;
  return !!e.until.date && today > e.until.date;
}

/**
 * A RULING COVERS ONLY THE CATEGORIES IT NAMES (reviewer ruling Q3, 29 Sep 2026). Until then a cup counted as covered
 * for the WHOLE kind the moment any ruling named it and any of its categories was present: the routers-only power_max
 * ruling (rule 6) was silently excusing wireless and switches, which did not ask power_max either and had no ruling.
 * Now, per cup: take every category a live ruling for that cup names; the categories it does NOT name must all give
 * the same answer (`asks`: req / pending / no), or carry their own ruling. Anything else is uncovered.
 *
 * `asks(category, cup)` is the caller's resolution for this kind — the verifier passes the four sets it already
 * resolved through the real requirementFor, so this function never re-implements the resolution it judges.
 */
export function parityRuled(kind: string, cups: readonly string[], categories: readonly string[],
  asks: (category: string, cup: string) => string):
  { ruled: boolean; by: KindParityException | null; uncovered: string[]; split: ParitySplit[] } {
  const rulings = KIND_PARITY_EXCEPTIONS.filter(
    (e) => e.kind === kind && e.categories.some((c) => categories.includes(c)) && !leaseLapsed(e));
  const uncovered: string[] = [], split: ParitySplit[] = [];
  for (const cup of cups) {
    const named = new Set(rulings.filter((e) => e.cups.includes(cup)).flatMap((e) => e.categories));
    const answers: Record<string, string[]> = {};
    for (const c of categories) if (!named.has(c)) (answers[asks(c, cup)] ??= []).push(c);
    if (named.size && Object.keys(answers).length <= 1) continue;
    uncovered.push(cup);
    split.push({ cup, ruled: categories.filter((c) => named.has(c)), answers });
  }
  return { ruled: uncovered.length === 0, by: rulings[0] ?? null, uncovered, split };
}

/** One uncovered cup, as the FULL grouping of the categories no ruling names (answer -> categories) beside the ones a
 *  ruling does. The board used to print `diffs[0]`, the first PAIR, and on 29 Sep that pair (interfaces-modules vs
 *  routers, module power_max) was the one pair already ruled (rule 6) while the real split -- wireless against
 *  interfaces-modules, security and switches -- was not on the line at all. A ruling is asked of a grouping, never a pair. */
export type ParitySplit = { cup: string; ruled: string[]; answers: Record<string, string[]> };

export function formatParitySplit(s: ParitySplit): string {
  return `${s.cup}: ${Object.entries(s.answers).map(([a, cs]) => `${a} {${cs.join(", ")}}`).join(" vs ")}` +
    (s.ruled.length ? ` (ruled: ${s.ruled.join(", ")})` : "");
}

/** The cause recorded for an unsettled divergence, or null when it is not in the register either —
 *  which is itself a finding: a divergence nobody has classified. */
export function parityCause(kind: string): KindParityOpen[] {
  return KIND_PARITY_OPEN.filter((o) => o.kind === kind);
}
