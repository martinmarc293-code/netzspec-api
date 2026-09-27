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
  { kind: "gateway", cause: "kind-split", note: "meraki MG21 is a CELLULAR gateway (cellular_bands); unified-communications SPA8000-BR is an ANALOGUE VOICE gateway (fxo_ports, fxs_ports, audio_codecs). The sharpest of the five." },
  { kind: "camera", cause: "kind-split", note: "collaboration-endpoints CD-DSKCAM-C-US is a conferencing camera (camera_zoom); meraki MV12 is a surveillance camera (image_sensor, storage_capacity, video_quality_max)." },
  { kind: "pluggable", cause: "kind-split", note: "optical-networking 15454-ML1000-2 is asked reach_max/wavelength; transceiver 15216-GBIC-1510 is asked ddm/form_factor/media/standard/temp_class. A DWDM line-card pluggable against a datacom optic — needs the operator, because unlike the other four the two cup sets are both plausible for one kind." },
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
  { kind: "antenna", cause: "profile-gap", note: "antenna_connector and antenna_gain asked by wireless, not routers. 3G-ACC-OUT-LA is an antenna and has both." },
  { kind: "bundle", cause: "profile-gap", note: "product_compatibility asked by routers and switches, not by the other four." },
];

/**
 * Whether a (kind, cups) divergence is SETTLED. Deliberately strict on both sides:
 *  - every differing cup must be covered by one ruling, so a divergence that has grown a new cup since
 *    the ruling was written comes back as a failure rather than inheriting the old approval;
 *  - the ruling's categories must be among the ones that actually differ, so a ruling about
 *    `transceiver` cannot silently excuse a divergence between two other categories.
 */
export function parityRuled(kind: string, cups: readonly string[], categories: readonly string[]):
  { ruled: boolean; by: KindParityException | null; uncovered: string[] } {
  const rulings = KIND_PARITY_EXCEPTIONS.filter(
    (e) => e.kind === kind && e.categories.some((c) => categories.includes(c)));
  if (!rulings.length) return { ruled: false, by: null, uncovered: [...cups] };
  const covered = new Set(rulings.flatMap((e) => e.cups));
  const uncovered = cups.filter((c) => !covered.has(c));
  return { ruled: uncovered.length === 0, by: rulings[0], uncovered };
}

/** The cause recorded for an unsettled divergence, or null when it is not in the register either —
 *  which is itself a finding: a divergence nobody has classified. */
export function parityCause(kind: string): KindParityOpen[] {
  return KIND_PARITY_OPEN.filter((o) => o.kind === kind);
}
