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
 * triple was read, not sampled: 116 widened, 9 REFUSED on what their values say. REVIEWER AUDIT (29 Sep): an R4 widening needs
 * >= 1 html_table / pdf_table row -- 18 of the 116 were hexcat_seed only (N31: the seed's datasheet doc_id is borrowed) and are
 * reverted into Q17_R4_REFUSED pending a table read, so 98 stand (829 part-cups).
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
  ["switches", "linecard", "mtbf", "C9400-LC-12QC", 60],
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
  ["wireless", "ap", "humidity_operating", "MR45", 2],
];

/** The R4 candidates whose VALUES say the triple is not a widening -- a list of what the rule deliberately excludes is a GUARD,
 *  not a comment: tests/cupLedger.test.ts fails if any of these is ever declared optional. They go to the to-read queue. */
export const Q17_R4_REFUSED: readonly { category: string; kind: string; cup: string; why: string }[] = [
  { category: "servers-unified-computing", kind: "power", cup: "modulation_format", why: "'AC' / 'DC' is the input type, mis-keyed as an optical modulation format" },
  { category: "interfaces-modules", kind: "interface", cup: "certifications", why: "all 3 read ['No']" },
  { category: "routers", kind: "router", cup: "compatible_platform", why: "a prose bullet ('Cisco IOS XE based platforms, including ...'), a relation candidate, not a value" },
  { category: "routers", kind: "chassis", cup: "dram", why: "CRS-4/S '4': a 4-slot system's number read as memory" },
  { category: "storage-networking", kind: "director", cup: "cooling", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "storage-networking", kind: "director", cup: "mgmt_class", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "storage-networking", kind: "director", cup: "switching_capacity", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "chassis", cup: "cooling", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "chassis", cup: "psu_redundant", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "chassis", cup: "switching_capacity", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "fex", cup: "poe_standard", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "fex", cup: "stackable", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "fex", cup: "switching_capacity", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "switches", kind: "linecard", cup: "switching_capacity", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "breakout-cable", cup: "connector", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "breakout-cable", cup: "ddm", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "breakout-cable", cup: "form_factor", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "breakout-cable", cup: "power_max", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "breakout-cable", cup: "standard", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "cable", cup: "wavelength", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
  { category: "transceiver", kind: "tunable", cup: "wavelength", why: "SEED-ONLY: every row is a hexcat_seed whose datasheet doc_id is borrowed provenance (N31) -- reverted pending a table read (reviewer audit of R4, 29 Sep)" },
];

/**
 * THE READ TRIPLES (ruling Q17, 29 Sep 2026: "... -> the 90 read triples"). Every veto triple that was NOT all-datasheet was
 * read -- data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv gives each its remedy and why -- and these are the ones whose
 * values are the property of the kind: an AP's mounting, a transmitter's SC output, an interface card's ports. Two had pours
 * inside them (6 `{95,95}` humidities, 2 `["No"]` standards lists): those rows are retracted by exact value
 * (scripts/retract-read-pours.mts) and the triples widen on their real rows, which is why they left Q17_R4_REFUSED.
 * witness = the SKU with the most real rows (ties by SKU); held = the real part-cups measured.
 */
const Q17_READ: readonly (readonly [category: string, kind: string, cup: string, witness: string, held: number])[] = [
  ["interfaces-modules", "interface", "ports", "8FE-FX-SC-B", 46],
  ["interfaces-modules", "interface", "connector", "16OC3/POS-SM", 8],
  ["meraki", "security-camera", "ieee_standards", "MV12N", 6],
  ["optical-networking", "accessory", "connector", "MEC15201/SC/R=", 1],
  ["optical-networking", "accessory", "rack_units", "NCS2K-MF10-6RU=", 1],
  // RULING Q19 (29 Sep 2026): of the 18 seed-only triples, the one whose seeds ARE on their own pages widens with that page as the
  // witness -- 12 of 16 FEX forwarding rates verbatim ("131 Mpps" on the Nexus 2000 sheet). The other 17 stay in Q17_R4_REFUSED and
  // their 317 seed facts (German shop renderings typed in as values) are retracted, so the veto clears because the false evidence
  // is gone, not because the kind set moved (data/reference/q19-seed-retractions-cisco-2026-09-29.tsv).
  ["switches", "fex", "forwarding_rate", "N2K-C2148T", 16],
  // RULING Q20 (29 Sep 2026): the 15216-EF-40 muxes' one-end readings were retracted as pours (run 1420) and their ranges COMPOSED
  // from the two cells of one row, each re-read under a gate (run 1427: {-5,65} °C, {-40,85} °C, {5,95} %) -- real values now, so
  // the three triples leave Q17_R4_REFUSED and widen on them.
  ["optical-networking", "mux", "temp_operating", "15216-EF-40-ODD=", 2],
  ["optical-networking", "mux", "temp_storage", "15216-EF-40-ODD=", 2],
  ["optical-networking", "mux", "humidity_operating", "15216-EF-40-ODD=", 2],
  // the frame reclassified out of `mux` (NCS2K-MF-1RU= "Mechanical Frame - 4 slots - 1 RU") keeps its slot count
  ["optical-networking", "accessory", "module_slots", "NCS2K-MF-1RU=", 1],
  ["optical-networking", "amplifier", "connector", "15454-OPT-BST-E=", 3],
  ["optical-networking", "mechanical", "rack_units", "15454-PP-4-SMR=", 9],
  ["optical-networking", "mux", "connector", "15216-ATT-LC-10=", 11],
  ["optical-networking", "mux", "rack_units", "NCS2K-MF-1RU=", 2],
  ["optical-networking", "mux", "ports", "NCS2K-MF-8X10G-FO=", 1],
  ["optical-networking", "mux", "standard", "15216-FLC-CWDM-8=", 1],
  ["optical-networking", "transponder", "standard", "15454-10DME-C=", 10],
  ["routers", "antenna", "cable_length", "3G-AE010-R", 5],
  ["routers", "antenna", "mounting", "3G-ANTM-OUT-OM=", 5],
  ["routers", "appliance", "dram", "C8200-UCPE-1N8", 8],
  ["routers", "appliance", "module_slots", "C1100TG-1N24P32A", 4],
  ["routers", "bundle", "flash", "CRS-FD-16G-10PK=", 5],
  ["routers", "bundle", "dram", "ISR4320U-MEM-MSATA", 4],
  ["routers", "bundle", "ports", "NC6-20X100GE-L-C", 4],
  ["routers", "mechanical", "airflow", "8K-4RU-F2B-AIR", 15],
  ["routers", "mechanical", "rack_units", "8K-2RU-KIT-L", 5],
  ["routers", "module", "data_rate", "NCS4200-1T8S-10CS", 2],
  ["routers", "module", "cable_length", "IRM-NIM-RS232", 1],
  ["routers", "power", "ports", "800-IL-PM-2", 9],
  ["routers", "router", "ports", "C1111-8PLTEEAS", 26],
  ["routers", "router", "mounting", "C8130-G2", 12],
  ["routers", "router", "storage_capacity", "C8211-G2", 8],
  ["routers", "router", "input_voltage", "C8211-G2", 6],
  ["routers", "router", "rack_units", "C8355-G2", 3],
  ["routers", "sp-router", "rack_units", "NCS4201-SA", 2],
  ["servers-unified-computing", "server", "storage_capacity", "C885A-NVD15TK1V", 26],
  ["servers-unified-computing", "storage-controller", "data_rate", "PLHC-MRAID12G", 22],
  ["switches", "bundle", "ports", "C1-N5672UP4FEX10GT", 24],
  ["switches", "bundle", "poe_standard", "C4500E-3NR-7E-UPOE", 13],
  ["switches", "linecard", "connector", "WS-X4124-RJ45=", 15],
  ["switches", "mechanical", "airflow", "C9606-FB-23-KIT=", 1],
  ["switches", "mechanical", "input_voltage", "N9800-DC-TRAY", 1],
  ["switches", "olt", "uplink_ports", "CGP-OLT-16T", 2],
  ["switches", "ont", "cooling", "CGP-ONT-1P", 4],
  ["switches", "ont", "poe_standard", "CGP-ONT-4P", 3],
  ["switches", "power", "humidity_operating", "PWR-IE240W-PCAC-L=", 3],
  ["switches", "power", "certifications", "PWR-C2-1600WAC-I/2", 8],
  ["switches", "power", "poe_standard", "PWR-C2-1025WAC=", 4],
  ["switches", "switch", "airflow", "C1-C4500X-16SFP+", 45],
  ["video", "accessory", "input_voltage", "741982", 1],
  ["video", "accessory", "tx_power", "4003219.00", 1],
  ["video", "amplifier", "connector", "4005263", 3],
  ["video", "chassis", "input_voltage", "4011176.012.000.AA", 10],
  ["video", "node", "tx_power", "HAX1X1XXXXXXXXXXBA", 7],
  ["video", "passive", "connector", "1030007", 53],
  ["video", "passive", "wavelength", "4004874", 3],
  ["video", "transmitter", "connector", "P2HD1.2G13TXP04=", 70],
  ["video", "transmitter", "temp_operating", "4012980", 12],
  ["wireless", "accessory", "antenna_connector", "AIR-ACC1622", 6],
  ["wireless", "antenna", "mounting", "AIR-ANT2440NV-R=", 18],
  ["wireless", "antenna", "cable_length", "AIR-ANT2544V4M-R8=", 1],
  ["wireless", "ap", "mounting", "3-CBW140AC-A-CA", 101],
  ["wireless", "mechanical", "antenna_connector", "AIR-ACC15-N-CAP=", 3],
  ["wireless", "power", "cable_length", "AIR-PWR-ST-LT-R3P=", 1],
  ["wireless", "power-injector", "mounting", "AIR-PWRINJ-60-PMK=", 1],
];
/**
 * THE Q24 WEIGHT TRIPLES (30 Sep 2026). Ruling Q24 wrote 29 per-SKU weights from single-model sheets (run 1448, every
 * statement re-read, gate 26/26), and the first board after it vetoed 5 triples on 9 part-cups: an optical amplifier, an
 * OTDR / shelf-orchestrator controller, an MDS supervisor, RF-gateway and NCS line cards held a weight under a cup their kind
 * marked na. scripts/veto-triage.mts classified all 5 as R4 (every part-cup an html_table read off the vendor's datasheet),
 * so by the Q17 R4 rule the kind's set is what was wrong: a physical module has a weight. Optional, never required.
 * witness = the triage's (the SKU with the most such facts, ties by SKU); held = the part-cups measured.
 */
// ROUTERS (operator order 5 Oct 2026), the 6 Oct board's four_sets_sum VETO: the ISR 4000 sheet (c78-732542, run 1495) prints
// 'Airflow' and the memory maximum per model, so 16 live routers hold OWN facts under two cups the router kind's derivation
// marked na -- "the kind's set is wrong, never the fact". Both join the kind's declared OPTIONAL set (never required).
const ROUTERS_6OCT: readonly (readonly [category: string, kind: string, cup: string, witness: string, held: number])[] = [
  ["routers", "router", "airflow", "ISR4221/K9", 16],
  ["routers", "router", "memory_max", "ISR4221/K9", 16],
];
const Q24_R4: readonly (readonly [category: string, kind: string, cup: string, witness: string, held: number])[] = [
  ["optical-networking", "amplifier", "weight", "15454-OPT-AMP-C=", 2],
  ["optical-networking", "controller", "weight", "NCS1K-OTDR=", 2],
  ["optical-networking", "linecard", "weight", "NCS1K4-2-QDD-C-K9=", 1],
  ["storage-networking", "supervisor", "weight", "DS-X9530-SF2AK9", 2],
  ["video", "linecard", "weight", "RFGW-DS48-1G", 2],
];
/** The kind's declared optional sets: the hand-worked entries above plus the Q17 R4 widenings. A triple declared twice is a
 *  load-time error, never a silent overwrite. The Q17 read widenings join them (Q17_READ), and the Q24 weight triples (Q24_R4). */
export const KIND_DECLARED_OPTIONAL: Readonly<Record<string, Readonly<Record<string, readonly { cup: string; witness: string; held: number }[]>>>> = (() => {
  const out: Record<string, Record<string, { cup: string; witness: string; held: number }[]>> = {};
  for (const [cat, kinds] of Object.entries(HAND_DECLARED_OPTIONAL)) for (const [kind, es] of Object.entries(kinds)) ((out[cat] ??= {})[kind] ??= []).push(...es);
  for (const [cat, kind, cup, witness, held] of [...Q17_R4, ...Q17_READ, ...Q24_R4, ...ROUTERS_6OCT]) {
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
