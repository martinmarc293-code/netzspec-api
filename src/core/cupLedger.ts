// src/core/cupLedger.ts — the STRUCTURAL half of the cup ledger: what a part of each kind is asked when nothing
// is known about it, read from the live profile. Pure, so the drift test can re-derive it without a database.
//
// WHY A LEDGER (reviewer §5, 11 Sep 2026). Coverage is filled ÷ required slots. Without a frozen, versioned
// statement of what the required slots ARE — per kind, with the gate of every conditional field — every
// coverage number is a mean over an unknown base, and the base moves each time a profile is edited. The ledger
// is that base. scripts/build-cup-ledger.mts adds the counts (parts, slots) and the evidence (which sources
// can fill each field, which labels map to it); tests/cupLedger.test.ts fails when a committed ledger no
// longer matches its profile, because a frozen copy of a changing thing drifts silently in both directions.
import { createHash } from "node:crypto";
import { PROFILES, FIELD_DICTIONARY, requirementFor, gateFields, settledFalse, COLUMN_BACKED, type Requirement } from "./fieldSchema.js";
import { proposedNa } from "./kindArchetypes.js";
import { SW_BOX, SW_PART, SW_SET, SW_PON } from "./switchKind.js";
import type { OpticKind } from "./opticKind.js";
// wireless (12 Sep 2026)
import { WL_KINDS } from "./wirelessKind.js";
import { UCS_KINDS } from "./ucsKind.js";
import { VIDEO_KINDS } from "./videoKind.js"; // video (12 Sep 2026)
// collab (12 Sep 2026)
import { COLLAB_KINDS } from "./collabKind.js";
import { RT_KINDS } from "./routerKind.js"; // routers (12 Sep 2026)
// optical-storage (12 Sep 2026)
import { OPTICAL_KINDS } from "./opticalKind.js";
import { SAN_KINDS } from "./sanKind.js";
// end optical-storage
// security (12 Sep 2026)
import { SEC_BOX, SEC_COMPONENT } from "./securityKind.js";
// modules-misc (12 Sep 2026)
import { MOD_KINDS } from "./moduleKind.js";
import type { MerakiKind } from "./merakiKind.js";
// fallback-kinds (12 Sep 2026): the kinds no SKU axis returns, only a name. See nameMarker.ts for why
// they live in a shared list rather than inside eleven other agents' axis files, and partKind.ts for
// the dispatch that reaches them. `MECH` is appended to every kind-bearing category and `UCS_EXTRA` to
// the three UCS-profile ones, so LEDGER_KINDS stays the single place that says which kinds exist.
import { NAME_ONLY_KINDS as MECH, UCS_NAME_ONLY_KINDS as UCS_EXTRA } from "./nameMarker.js";

/** Every kind a category's axis can name — including kinds no part holds today, which still have a question set. */
export const LEDGER_KINDS: Readonly<Record<string, readonly string[]>> = {
  // kind-layer (13 Sep 2026): switchKind now RETURNS `mechanical` (and `chassis`), so the list is de-duplicated.
  // layers review A.4 (14 Sep 2026): `bundle` — packs and heterogeneous sets, switchKind.ts's head rules.
  switches: [...new Set([...SW_BOX, ...SW_PART, ...SW_SET, ...SW_PON, ...MECH])],
  // kind-layer (13 Sep 2026): `cable` — same-cage DAC / AOC / passive MPO cables, out of `pluggable` (spec II.2).
  transceiver: [...new Set([...(["pluggable", "bidi", "tunable", "adapter", "accessory", "breakout-cable", "cable"] satisfies OpticKind[]), ...MECH])],
  // wireless (12 Sep 2026). kind-layer (13 Sep 2026): wirelessKind now returns `mechanical` from the SKU too, so the
  // list is de-duplicated rather than naming the kind twice.
  wireless: [...new Set([...WL_KINDS, ...MECH])],
  // servers (12 Sep 2026): all three categories derive their kind with ucsKind (partKind.ts).
  // kind-layer (13 Sep 2026): DE-DUPLICATED. ucsKind names `tpm` and `pdu` itself now, and they are still in the
  // name-only list; a kind listed twice would be counted twice by every ledger loop (slots, parts).
  "servers-unified-computing": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  "hyperconverged-systems": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  "hyperconverged-infrastructure": [...new Set([...UCS_KINDS, ...MECH, ...UCS_EXTRA])],
  // video (12 Sep 2026)
  video: [...VIDEO_KINDS, ...MECH],
  // collab (12 Sep 2026): one axis, three categories (collabKind.ts)
  // kind-layer (13 Sep 2026): collabKind returns `mechanical` from the SKU too — de-duplicated.
  "unified-communications": [...new Set([...COLLAB_KINDS, ...MECH])],
  "collaboration-endpoints": [...new Set([...COLLAB_KINDS, ...MECH])],
  conferencing: [...new Set([...COLLAB_KINDS, ...MECH])],
  // routers (12 Sep 2026)
  routers: [...RT_KINDS, ...MECH],
  // optical-storage (12 Sep 2026) — derived from the axes' own exported kind lists, so a kind added there is listed here
  "optical-networking": [...OPTICAL_KINDS, ...MECH],
  "storage-networking": [...SAN_KINDS, ...MECH],
  // end optical-storage
  // security (12 Sep 2026). `non-hardware` is deliberately absent: securityKind returns it for a SKU
  // the class table already calls a licence, software or a service, and such a part is asked NOTHING
  // — it has no question set to freeze, and once a reclassify run moves it out of `hardware`,
  // recompute-completeness gives it no_profile before it looks up a profile at all.
  security: [...SEC_BOX, ...SEC_COMPONENT, ...MECH],
  // --- modules-misc (12 Sep 2026) -------------------------------------------------------------
  // modules-r8 (12 Sep 2026): `fabric` and `mux` added with the round-8 kind rules. Both take their
  // cup set from the category that already uses the name — `fabric` from storage-networking and
  // optical-networking, `mux` from optical-networking — so the one-cup-set-per-kind check below has
  // something to compare and needs no exception for either.
  // kind-layer (13 Sep 2026): read from moduleKind's own MOD_KINDS (default `module` -> `unknown`, `service` -> `module`,
  // `voice` folded into `interface` + `module`), so a kind added or renamed there is listed here without a second copy.
  "interfaces-modules": [...MOD_KINDS, ...MECH],
  // `appliance` LEFT THIS LIST 28 Sep 2026 with the MX and Z parts: an MX is a firewall (security) and a Z a
  // teleworker gateway (routers), so merakiKind has no rule producing `appliance` and the kind is gone from
  // its union. The list is `satisfies MerakiKind[]`, so the typecheck named this line the moment it went --
  // which is worth recording because the ten meraki PROFILE gates that read `inList: ["appliance"]` are plain
  // strings and it could not see any of them. A type catches its own shape and nothing else.
  meraki: [...(["unknown", "switch", "access-point", "security-camera", "environment-sensor", "cellular-gateway",
    "accessory"] satisfies MerakiKind[]), ...MECH],
  // data-center-networking reuses switchKind, so it reuses its kind list — every one gets a
  // question set even though only four of the fifteen have a part today (partKind.ts says which).
  // kind-layer (13 Sep 2026): de-duplicated like `switches` (switchKind returns `mechanical` now). After the merge into
  // switches this category holds no hardware; the list stays so its licence rows' profile keeps a question set per kind.
  "data-center-networking": [...new Set([...SW_BOX, ...SW_PART, ...MECH])],
};

export type KindQuestionSet = {
  /** asked of every part of this kind (excluding column-backed keys, which are never a gap) */
  required: string[];
  /** conditional fields that are OPEN at "nothing known yet": asked until their gate is answered */
  pending: { key: string; gate: string[] }[];
  /** NOT APPLICABLE to this kind, derived (29 Sep 2026): a dictionary key the profile never mentions, a conditional
   *  settled false for the kind, or an optional cup the kind's archetype cannot hold. See kindQuestionSet. */
  not_applicable_by_kind: string[];
  /** declared optional: accepted, never counted as a gap */
  optional: string[];
  /** answered from the parts row itself (vendor, series): required, never a slot */
  column_backed: string[];
};

/**
 * THE VETO QUEUE, RESOLVED THE "REAL VALUE" WAY (reviewer ruling, 29 Sep 2026): "a real value -> widen the kind set with that
 * witness; a pour -> retract". Each entry is a cup this kind's OWN facts hold real values for, so it is in the kind's DECLARED
 * OPTIONAL set -- never `na` -- with the SKU that proves it and the part count the veto measured. The pours of the same queue
 * are retraction runs, not entries here. Worked by size, top down; four_sets_sum names what is left.
 */
const HAND_DECLARED_OPTIONAL: Readonly<Record<string, Readonly<Record<string, readonly { cup: string; witness: string; held: number }[]>>>> = (() => {
  const ucsCpu = [{ cup: "cpu", witness: "UCS-CPU-A9334", held: 1186 }, { cup: "cpu_sockets_max", witness: "UCS-CPU-A9684X", held: 142 }];
  const ucsDrive = [{ cup: "data_rate", witness: "KIN-HD10T7KL4KN", held: 480 }];   // 12 / 6 Gb/s SAS/SATA; 3 rows read "100" (a capacity pour, left for the band)
  return {
    "servers-unified-computing": { cpu: ucsCpu, drive: ucsDrive },
    "hyperconverged-infrastructure": { cpu: ucsCpu, drive: ucsDrive },
    "hyperconverged-systems": { cpu: ucsCpu, drive: ucsDrive },
    video: { transmitter: [{ cup: "standard", witness: "4022938.19", held: 382 }],
             node: [{ cup: "standard", witness: "G2A2AA101A1PXXXBXX", held: 204 }, { cup: "wavelength", witness: "G2A2AA101A1PXXXBXX", held: 129 }] },
    "optical-networking": { mux: [{ cup: "wavelength", witness: "15216-AD1-2-39.7", held: 169 }],
                            transponder: [{ cup: "connector", witness: "CH23/L/U/SC/15200", held: 104 }],
                            // 29 Sep 2026: wire_gauge was a plain `opt` here until optical's pluggable took transceiver's question set by
                            // reference; the composed cond names only pluggable, so the complement closed it for cables -- which hold 5
                            // real AWG values from the page ("COAX 23 AWG", "24 AWG", "28 AWG" on the timing / alarm / USB cables).
                            cable: [{ cup: "wire_gauge", witness: "15454-M-120TMGCBL=", held: 5 }] },
  };
})();

/**
 * RULING Q17 R4 (29 Sep 2026): "R4 widenings with witnesses". Each row is a (category, kind, cup) the four_sets_sum veto named
 * where EVERY own fact was read off a vendor datasheet table (html_table / pdf_table, or an operator hexcat_seed whose evidence
 * is the datasheet): the vendor states the cup for this kind, so the kind's set was wrong, never the facts. Built by
 * scripts/veto-triage.mts (plan data/dryrun/veto-triage-cisco-2026-09-29T211617750Z.tsv) and the VALUE DISTRIBUTION of every
 * triple was read, not sampled: 116 widen (1,162 part-cups); 9 were REFUSED on what their values say (Q17_R4_REFUSED, below).
 * witness = the SKU with the most such facts (ties by SKU); held = the part-cups the veto measured.
 */
const Q17_R4: readonly (readonly [category: string, kind: string, cup: string, witness: string, held: number])[] = [
  ["hyperconverged-infrastructure", "cpu", "cpu_base_clock", "HCI-CPU-A9015", 28],
  ["hyperconverged-systems", "cpu", "cache_l3", "HX-CPU-A7232P", 31],
  ["hyperconverged-systems", "gpu", "certifications", "HX-GPU-7150X2", 1],
  ["hyperconverged-systems", "gpu", "emc_emissions", "HX-GPU-7150X2", 1],
  ["hyperconverged-systems", "gpu", "humidity_operating", "HX-GPU-7150X2", 1],
  ["hyperconverged-systems", "gpu", "humidity_storage", "HX-GPU-7150X2", 1],
  ["interfaces-modules", "interface", "dimensions", "C-NIM-1M", 15],
  ["interfaces-modules", "interface", "temp_operating", "C-NIM-1M", 14],
  ["interfaces-modules", "interface", "humidity_operating", "C-NIM-1M", 6],
  ["meraki", "cellular-gateway", "temp_storage", "MG41", 6],
  ["optical-networking", "mux", "weight", "15216-EF-40-EVEN=", 2],
  ["optical-networking", "transponder", "input_power_range", "CIM8-LE-K9", 1],
  ["optical-networking", "transponder", "tx_power", "CIM8-LE-K9", 1],
  ["routers", "appliance", "altitude_max", "C1100TG-1N24P32A", 4],
  ["routers", "appliance", "airflow", "C1100TG-1N24P32A", 3],
  ["routers", "appliance", "input_voltage", "C1100TG-1N24P32A", 3],
  ["routers", "appliance", "router_throughput", "C1100TG-1N24P32A", 3],
  ["routers", "appliance", "storage_capacity", "C8220TG-48A-O", 1],
  ["routers", "appliance", "temp_storage", "C8220TG-48A-O", 1],
  ["routers", "fabric", "dimensions", "8804-FC0", 7],
  ["routers", "fabric", "weight", "8804-FC0", 7],
  ["routers", "fan", "weight", "8804-FAN", 8],
  ["routers", "fan", "dimensions", "8804-FAN-V2", 2],
  ["routers", "linecard", "weight", "A9K-MOD200-SE", 4],
  ["routers", "module", "weight", "A9K-MPA-1X100GE", 11],
  ["routers", "processor", "dimensions", "8800-RP", 2],
  ["routers", "processor", "weight", "8800-RP", 2],
  ["routers", "router", "psu_config", "C841M-4X", 2],
  ["routers", "sp-router", "dram", "8011-32Y8L2H2FH", 3],
  ["routers", "sp-router", "mounting", "8011-32Y8L2H2FH", 3],
  ["routers", "sp-router", "storage_capacity", "8011-32Y8L2H2FH", 3],
  ["routers", "sp-router", "airflow", "8011-32Y8L2H2FH", 2],
  ["security", "analytics", "mounting", "CV-CNTR-M8N", 1],
  ["security", "firewall", "mounting", "MX105", 15],
  ["security", "firewall", "input_voltage", "1210CE", 7],
  ["security", "firewall", "threat_defense_throughput", "1210CE", 3],
  ["security", "security-module", "vpn_throughput", "SM-40", 3],
  ["servers-unified-computing", "cpu", "cpu_base_clock", "UCS-CPU-A9015", 35],
  ["servers-unified-computing", "server", "drive_interface", "UCSC-240M8E3-16X4", 4],
  ["storage-networking", "director", "cooling", "DS-C9706", 3],
  ["storage-networking", "director", "mgmt_class", "DS-C9706", 3],
  ["storage-networking", "director", "switching_capacity", "DS-C9706", 3],
  ["switches", "chassis", "cooling", "C6807-XL", 30],
  ["switches", "chassis", "psu_redundant", "C6807-XL", 29],
  ["switches", "chassis", "switching_capacity", "C6807-XL", 28],
  ["switches", "chassis", "mounting", "C9404R", 7],
  ["switches", "chassis", "mtbf", "C9404R", 7],
  ["switches", "fabric", "mtbf", "N9K-C9504-FM", 14],
  ["switches", "fabric", "power_typical", "N9K-C9504-FM", 14],
  ["switches", "fabric", "weight", "N9K-C9504-FM", 14],
  ["switches", "fabric", "airflow", "N9K-C9504-FM", 12],
  ["switches", "fan", "cooling", "N2K-C2148T-FAN=", 31],
  ["switches", "fan", "weight", "FAN-PI-V4", 10],
  ["switches", "fan", "mtbf", "C9500X-FAN-1U-F", 5],
  ["switches", "fan", "power_typical", "N9K-C9504-FAN", 5],
  ["switches", "fan", "dimensions", "N9K-C9400-FAN-PI", 1],
  ["switches", "fex", "forwarding_rate", "N2K-B22DELL-P", 16],
  ["switches", "fex", "poe_standard", "N2K-B22DELL-P", 16],
  ["switches", "fex", "stackable", "N2K-B22DELL-P", 16],
  ["switches", "fex", "switching_capacity", "N2K-B22DELL-P", 16],
  ["switches", "linecard", "mtbf", "C9400-LC-12QC", 60],
  ["switches", "linecard", "switching_capacity", "C6800-48P-SFP", 37],
  ["switches", "linecard", "packet_buffer", "WS-6148-GE-TX", 26],
  ["switches", "linecard", "power_typical", "N9K-C9400-SW-GX2A", 25],
  ["switches", "linecard", "weight", "N9K-C9400-SW-GX2A", 25],
  ["switches", "linecard", "jumbo_mtu", "WS-6148-GE-TX", 21],
  ["switches", "linecard", "airflow", "X9432PQ", 12],
  ["switches", "linecard", "dimensions", "N9K-C9400-SW-GX2A", 4],
  ["switches", "module", "mtbf", "C3850-NM-2-10G", 33],
  ["switches", "module", "mounting", "IEM-3300-14T2S=", 19],
  ["switches", "module", "weight", "IEM-3300-14T2S=", 19],
  ["switches", "olt", "dimensions", "CGP-OLT-16T", 2],
  ["switches", "olt", "flash", "CGP-OLT-16T", 2],
  ["switches", "olt", "forwarding_rate", "CGP-OLT-16T", 2],
  ["switches", "olt", "jumbo_mtu", "CGP-OLT-16T", 2],
  ["switches", "olt", "mac_table", "CGP-OLT-16T", 2],
  ["switches", "olt", "mtbf", "CGP-OLT-16T", 2],
  ["switches", "olt", "switching_capacity", "CGP-OLT-16T", 2],
  ["switches", "olt", "weight", "CGP-OLT-16T", 2],
  ["switches", "ont", "dimensions", "CGP-ONT-1P", 5],
  ["switches", "ont", "forwarding_rate", "CGP-ONT-1P", 5],
  ["switches", "ont", "jumbo_mtu", "CGP-ONT-1P", 5],
  ["switches", "ont", "mac_table", "CGP-ONT-1P", 5],
  ["switches", "ont", "mtbf", "CGP-ONT-1P", 5],
  ["switches", "ont", "switching_capacity", "CGP-ONT-1P", 5],
  ["switches", "ont", "weight", "CGP-ONT-1P", 5],
  ["switches", "ont", "flash", "CGP-ONT-4P", 4],
  ["switches", "ont", "connector", "ENC-10G-ONT-01PR", 3],
  ["switches", "ont", "humidity_operating", "ENC-10G-ONT-01PR", 3],
  ["switches", "ont", "power_max", "ENC-10G-ONT-01PR", 3],
  ["switches", "ont", "temp_operating", "ENC-10G-ONT-01PR", 3],
  ["switches", "power", "mtbf", "C3KX-PWR-1100WAC", 53],
  ["switches", "power", "weight", "PSU3KW-HVPI", 12],
  ["switches", "power", "dimensions", "PWR-IE170W-PC-AC=", 11],
  ["switches", "power", "ip_rating", "PWR-IE170W-PC-AC=", 9],
  ["switches", "power", "temp_operating", "PWR-IE170W-PC-AC=", 9],
  ["switches", "power", "temp_storage", "PWR-IE170W-PC-AC=", 9],
  ["switches", "power", "heat_dissipation", "N55-PAC-1100W", 4],
  ["switches", "power", "power_typical", "N55-PAC-1100W", 4],
  ["switches", "supervisor", "jumbo_mtu", "C6800-SUP6T", 6],
  ["switches", "supervisor", "power_typical", "N9K-C9400-SUP-A", 5],
  ["switches", "supervisor", "weight", "N9K-C9400-SUP-A", 5],
  ["switches", "supervisor", "airflow", "N9K-SUP-A", 4],
  ["switches", "supervisor", "mtbf", "N9K-SUP-A", 4],
  ["switches", "supervisor", "packet_buffer", "C9600-SUP-1", 4],
  ["switches", "supervisor", "storage_capacity", "C9600-SUP-1", 4],
  ["switches", "supervisor", "dimensions", "N9K-C9400-SUP-A", 1],
  ["switches", "switch", "storage_capacity", "IE-3100-8T4S-E", 5],
  ["transceiver", "breakout-cable", "ddm", "Q-4SFP25G-CU1.5M", 37],
  ["transceiver", "breakout-cable", "form_factor", "Q-4SFP25G-CU1.5M", 37],
  ["transceiver", "breakout-cable", "connector", "Q-4SFP25G-CU1.5M", 27],
  ["transceiver", "breakout-cable", "standard", "Q-4SFP25G-CU1.5M", 21],
  ["transceiver", "breakout-cable", "power_max", "QDD-2Q200-CU3M", 2],
  ["transceiver", "cable", "wavelength", "QDD-400-AOC10M", 11],
  ["transceiver", "tunable", "wavelength", "DP04QSDD-HE0", 1],
  ["wireless", "ap", "humidity_operating", "MR45", 2],
];

/** The R4 candidates whose VALUES say the triple is not a widening -- a list of what the rule deliberately excludes is a GUARD,
 *  not a comment: tests/cupLedger.test.ts fails if any of these is ever declared optional. They go to the to-read queue. */
export const Q17_R4_REFUSED: readonly { category: string; kind: string; cup: string; why: string }[] = [
  { category: "servers-unified-computing", kind: "power", cup: "modulation_format", why: "'AC' / 'DC' is the input type, mis-keyed as an optical modulation format" },
  { category: "meraki", kind: "security-camera", cup: "ieee_standards", why: "2 of 8 read ['No'], a yes/no cell poured into a list" },
  { category: "interfaces-modules", kind: "interface", cup: "certifications", why: "all 3 read ['No']" },
  { category: "routers", kind: "router", cup: "compatible_platform", why: "a prose bullet ('Cisco IOS XE based platforms, including ...'), a relation candidate, not a value" },
  { category: "routers", kind: "chassis", cup: "dram", why: "CRS-4/S '4': a 4-slot system's number read as memory" },
  { category: "optical-networking", kind: "mux", cup: "temp_operating", why: "{-5,-5}: only one end of the range was read" },
  { category: "optical-networking", kind: "mux", cup: "temp_storage", why: "{-40,-40}: only one end of the range was read" },
  { category: "optical-networking", kind: "mux", cup: "humidity_operating", why: "{95,95}: only the upper bound was read" },
  { category: "switches", kind: "power", cup: "humidity_operating", why: "6 of 9 read {95,95}: only the upper bound was read" },
];

/** The kind's declared optional sets: the hand-worked entries above plus the Q17 R4 widenings. A triple declared twice is a
 *  load-time error, never a silent overwrite. */
export const KIND_DECLARED_OPTIONAL: Readonly<Record<string, Readonly<Record<string, readonly { cup: string; witness: string; held: number }[]>>>> = (() => {
  const out: Record<string, Record<string, { cup: string; witness: string; held: number }[]>> = {};
  for (const [cat, kinds] of Object.entries(HAND_DECLARED_OPTIONAL)) for (const [kind, es] of Object.entries(kinds)) ((out[cat] ??= {})[kind] ??= []).push(...es);
  for (const [cat, kind, cup, witness, held] of Q17_R4) {
    const list = ((out[cat] ??= {})[kind] ??= []);
    if (list.some((e) => e.cup === cup)) throw new Error(`KIND_DECLARED_OPTIONAL: ${cat}/${kind} ${cup} declared twice`);
    list.push({ cup, witness, held });
  }
  return out;
})();
const declaredOptional = (category: string, kind: string, key: string): boolean =>
  !!KIND_DECLARED_OPTIONAL[category]?.[kind]?.some((e) => e.cup === key);

export function kindQuestionSet(category: string, kind: string, role?: string | null): KindQuestionSet {
  // `na` IS DERIVED PER (CATEGORY, KIND) AND THIS REFUSES A CALL WITHOUT BOTH (reviewer ruling, 29 Sep 2026). The 8 Sep
  // licence marks landed on hardware because the caller handed a rule a CATEGORY; a kind-less call here would derive a
  // set for nobody and be read as everybody's.
  if (!category || !kind) throw new Error(`kindQuestionSet("${category}", "${kind}"): na is derived per (category, kind) — both are required`);
  const profile = PROFILES[category] as Record<string, Requirement> | undefined;
  if (!profile) throw new Error(`no profile for category "${category}"`);
  const out: KindQuestionSet = { required: [], pending: [], not_applicable_by_kind: [], optional: [], column_backed: [] };
  const values = role ? { kind, deploy_role: role } : { kind };
  const cannotHold = new Set(proposedNa(kind));
  // THE COMPLEMENT (ruling of 28 Sep, "derive na as the complement"): the four sets cover the WHOLE DICTIONARY, not the
  // profile. `na` is every cup that is neither required, conditional nor in this kind's declared optional set:
  //   - a key the category's profile never mentions (requirementFor already answers "na" for it);
  //   - a conditional whose gate is SETTLED FALSE for this kind -- it names other kinds only, so nothing left unanswered
  //     about a part of this kind can ever make it fire (settledFalse, the resolver's own test);
  //   - for the nine physical kinds with an archetype (kindArchetypes.ts), a plainly optional cup the archetype says the
  //     object cannot hold.
  // Everything else a profile declares optional -- unconditionally, or behind a gate that could still fire -- stays in
  // the kind's optional set. The veto is not applied here: an OWN fact under a cup marked `na` fails four_sets_sum,
  // naming the kind and the cup, because then the kind's set is wrong, never the fact.
  const keys = [...new Set([...Object.keys(FIELD_DICTIONARY), ...Object.keys(profile)])].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const r = profile[key];
    // kind-layer (13 Sep 2026): the role is a discriminator like the kind. No role = the kind's core (unresolved role).
    const q = requirementFor(category, key, values);
    if (COLUMN_BACKED.has(key)) { if (q === "req") out.column_backed.push(key); continue; }
    if (q === "req") out.required.push(key);
    else if (q === "pending") out.pending.push({ key, gate: r?.kind === "cond" ? gateFields(r.when).filter((g) => g !== "kind" && g !== "deploy_role") : [] });
    // the kind's own witnessed values put the cup in its declared optional set, whatever the profile would close
    else if (declaredOptional(category, kind, key)) out.optional.push(key);
    else if (!r || q === "na") out.not_applicable_by_kind.push(key);
    // settled by the KIND ALONE: a role never closes a cup (rule 7 -- "a role addition is optional, never na, outside its
    // role"); a cond the role answers no to stays optional for the kind.
    else if (r.kind === "cond" && settledFalse(r.when, { kind })) out.not_applicable_by_kind.push(key);
    else if (r.kind === "opt" && cannotHold.has(key)) out.not_applicable_by_kind.push(key);
    else out.optional.push(key);
  }
  return out;
}

/** Slots one part of this kind opens when nothing is known: required + pending (completenessV2 counts both). */
export function slotsAtNothingKnown(qs: KindQuestionSet): number {
  return qs.required.length + qs.pending.length;
}

/** A stable hash of a category's profile, so a ledger can say which profile it describes. */
export function profileHash(category: string): string {
  const profile = PROFILES[category] ?? {};
  const canon = JSON.stringify(Object.keys(profile).sort().map((k) => [k, profile[k]]));
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}
