// lib/fieldSchema.ts — WP1. THE DENOMINATOR.
//
// Before this file, "no gaps" was unmeasurable: spec attributes were free-text German strings
// produced by two independent code paths, so completeness could only count how many strings
// happened to exist. There was no target list, therefore nothing a part could fail against.
// This registry is the target list. Completeness becomes required_present / required_total,
// and every gap is a NAMED field with an expected source.
//
// Shape (settled in the 2026-09-01 prompt, Q7): ONE global field dictionary + per-category
// PROFILES. Nine independent lists would define "Betriebstemperatur" nine times and drift;
// one flat global list cannot express not-applicable. So: dictionary owns the meaning of a
// field (label, type, unit, enum domain, plausibility band, ETIM/Icecat mapping), the profile
// owns whether that field is required FOR THIS CATEGORY.
//
// The denominator is PER PART, not global. `rack_units` is required for a rack switch and
// not-applicable for a DIN-rail one; `poe_budget` is required only once poe_standard != none.
// So conditionals are evaluated against the part's own values — a global "40 required fields"
// would be wrong for most parts in both directions.
//
// Standing rule this file exists to serve: a check that has never failed is not a check you
// have. fieldSchema.test.ts and scripts/schema/validate-schema.ts must both be able to fail.

export type FieldType = "n" | "nr" | "b" | "e" | "s" | "ls" | "struct";

/** Conditional grammar, as DATA rather than prose, so the profile is machine-evaluable. */
export type Condition =
  | { field: string; eq: string | number | boolean }
  | { field: string; ne: string | number | boolean }
  | { field: string; inList: (string | number)[] }
  | { field: string; gte: number }
  | { field: string; truthy: true }
  | { any: Condition[] }
  | { all: Condition[] };

/** req = always required · opt = nice to have · cond = required only when the condition holds
 *  (not-applicable otherwise) · na = never applicable to this category. */
import { UCS_MACHINE, UCS_COMPONENT } from "./ucsKind.js";
import { SW_DEVICE, SW_BOX, SW_COMPONENT, SW_CABLE } from "./switchKind.js";
import { OPT_MODULE, OPT_FIXED_WAVELENGTH } from "./opticKind.js";
// security (12 Sep 2026)
import {
  SEC_BOX, SEC_COMPONENT, SEC_FIREWALL_KIND, SEC_INLINE_KIND, SEC_IPS_KIND,
  SEC_USER_SIZED_KIND, SEC_STORE_KIND, SEC_POWERED_KIND, type SecurityKind,
} from "./securityKind.js";
import { GENERIC_DEVICE } from "./componentKind.js";
// wireless (12 Sep 2026)
import { WL_AP, WL_BOX, WL_PORTED } from "./wirelessKind.js";
import { VIDEO_BOX, VIDEO_EMITTER, type VideoKind } from "./videoKind.js"; // video (12 Sep 2026)
// collab (12 Sep 2026)
import { COLLAB_ENDPOINT, COLLAB_CALLING, COLLAB_VIDEO, COLLAB_SCREEN, COLLAB_FITS, COLLAB_CABLE } from "./collabKind.js";
import { RT_DEVICE, RT_DEVICE_PORTED, RT_BRANCH, RT_PORTED, RT_COMPONENT, RT_CABLE } from "./routerKind.js"; // routers (12 Sep 2026)
// optical-storage (12 Sep 2026)
import { OPN_SHELF, OPN_PLUGGABLE, OPN_FIXED_WAVELENGTH, OPN_POWERED, OPN_WAVELENGTH_ROUTING, OPN_FITS } from "./opticalKind.js";
import { SAN_BOX, SAN_MODULE, SAN_FITS } from "./sanKind.js";
// end optical-storage
// modules-misc (12 Sep 2026)
// modules-r8 (12 Sep 2026): MOD_SLOTTED came off this import with the constant. It was imported and
// never used — a kind list this file consulted for nothing — and MOD_PHYSICAL beside it was never
// imported at all. Both are deleted in moduleKind.ts; the note there says why.
import { MOD_COMPONENT, MOD_PORTED } from "./moduleKind.js";
import { MK_BOX, MK_PORTED, MK_POWERED } from "./merakiKind.js";

export type Requirement =
  | { kind: "req" }
  | { kind: "opt" }
  | { kind: "na" }
  /**
   * fallback-kinds (12 Sep 2026): `elseOpt` says what an UNMET conditional means — `na` (the default,
   * "this part can never have one") or `opt` ("not asked of this kind, still accepted").
   *
   * WHY IT HAD TO EXIST TO ADD ONE KIND. A new kind can only be asked a cup by making that cup
   * `cond({field:"kind", inList:[…]})`, and a plain cond marks the cup `na` for every kind NOT in the
   * list. `mounting` is `opt` in sixteen of the seventeen kind-bearing profiles, so requiring it of
   * the new `mechanical` kind would have told every switch, access point and router that it has no
   * mounting — measured against the store, a false statement backed by 420 live `mounting` facts on
   * NAMED kinds (switches/switch 173, wireless/ap 100, meraki/switch 58, switches/module 19,
   * wireless/antenna 17, meraki/appliance 17, routers/enterprise 15, and seven more). The `collab`
   * profile declares `mounting: opt` by hand with its reason written beside it, so overriding it
   * would also have reversed another category's deliberate decision.
   *
   * The alternative was to widen the cond to every kind that holds the fact, which ADDS a required
   * cup to seven finished categories' box kinds — thousands of new gaps in work already signed off.
   * Neither was mine to do. `elseOpt` asks the new kind and leaves every other kind's answer exactly
   * as it is: no existing conditional carries the flag, so nothing changes for anything not edited.
   *
   * THE INVARIANT, in one sentence, because that is what tests/fieldSchema.test.ts pins: a cond
   * declared `elseOpt` never resolves to `na` — it is `req` when the condition holds, `pending` while
   * a required gate is unanswered, and `opt` otherwise.
   */
  | { kind: "cond"; when: Condition; elseOpt?: boolean };

export type FieldDef = {
  key: string;
  de: string;
  en: string;
  type: FieldType;
  /** canonical unit — every stored value is normalised to this (WP4) */
  unit?: string;
  /** closed enum domain; absent means open list */
  domain?: string[];
  /** open list of common values (documentation only, never enforced) */
  examples?: string[];
  /** order-of-magnitude sanity band for numerics. [T] until the WP3 golden sample confirms;
   *  a value outside the band is a RANGE_VIOLATION and is quarantined, never stored. */
  band?: [number, number];
  /** verified ETIM EF-codes. EC000734 only — see data/schema/etim-map.json. An empty array
   *  means "no ETIM feature exists for this field", which is a CLOSED mapping gap, not an
   *  open one. No code enters here without its viewer URL recorded alongside it. */
  etim?: string[];
  /** Icecat feature-ID. Deliberately null everywhere: populated in WP8 from Icecat reference
   *  files only, never from memory. A guessed feature-ID would silently mis-join every record. */
  icecat?: null;
  /** structural note for `struct` fields */
  shape?: string;
};

// ---------------------------------------------------------------------------------------------
// Global field dictionary
// ---------------------------------------------------------------------------------------------

const VENDORS = ["cisco", "hpe", "aruba", "juniper", "arista", "dell-emc", "lenovo", "extreme",
  "fortinet", "nvidia", "mikrotik", "ubiquiti", "supermicro"];

const PORT_SHAPE = "list{ port_typ: e(rj45|sfp|sfp-plus|sfp28|sfp56|qsfp-plus|qsfp28|qsfp-dd|combo|other), speed: ls, anzahl: n }";

export const FIELD_DICTIONARY: Record<string, FieldDef> = {
  // --- identity -------------------------------------------------------------------------------
  vendor: { key: "vendor", de: "Hersteller", en: "Manufacturer", type: "e", domain: VENDORS, etim: [], icecat: null },
  series: { key: "series", de: "Produktserie", en: "Product series", type: "s", etim: [], icecat: null },
  mgmt_class: { key: "mgmt_class", de: "Verwaltung", en: "Management class", type: "e", domain: ["managed", "smart-managed", "unmanaged"], etim: ["EF004912"], icecat: null },
  layer: { key: "layer", de: "Switching-Ebene", en: "Switching layer", type: "e", domain: ["l2", "l2plus", "l3"], etim: ["EF004883", "EF004884"], icecat: null },
  form_factor: { key: "form_factor", de: "Bauform", en: "Form factor", type: "e", domain: ["rack-19", "desktop", "din-rail", "modular-chassis"], etim: ["EF000003"], icecat: null },
  // BAND [1, 44] — read off the catalogue, not chosen. Cisco writes a chassis height into the part
  // NAME, so the corpus states its own answer: 445 live parts carry "<n> RU" (re-read 5 Sep 2026),
  // and the whole distribution is
  //   1×221 · 2×150 · 3×12 · 4×15 · 5×5 · 6×4 · 7×6 · 8×4 · 10×4 · 11×1 · 14×7 · 19×1 · 21×2 ·
  //   30×1 (ASR-9912) · 39×7 · 42×2 · 44×1
  // and then nothing until 81 and 162, which are not heights at all — CIT-MR-1X081RU-A and
  // CIT-MR-1X162RU-A carry "081RU" inside the PID. 44 is ASR-9922, "20 Line Card Slot Chassis,
  // 44 RU": the tallest real device the catalogue describes.
  //
  // WHAT [1, 30] ACTUALLY REFUSED, corrected 5 Sep 2026 — this comment used to say "30 was one rack
  // unit short of the ASR 9912", and that was FALSE in a way worth naming: the band test is
  // INCLUSIVE, the ASR-9912 is 30 RU exactly ("10 Line Card Slot Chassis, 30 RU"), and it passed
  // the old band every time. The old ceiling refused ten parts and no others: the 44-RU ASR-9922,
  // the seven 39-RU parts (three Secure Workload / Tetration rack clusters and four cable kits
  // named after the cluster they ship with), and two 42-RU RACKS — a bare "42RU" part and the
  // Panduit FlexFusion cabinet. A wrong reason attached to a right number is how the next person
  // widens a band by one for a part that never needed it.
  //
  // NO MARGIN above 44, deliberately, and this is the half worth reading before widening it again.
  // The next value up is 48, and 48U is a RACK, not a device: the two populations are separated by
  // a gap with nothing real in it (no part in the corpus states a height between 45 and 80). The
  // ceiling sits in that gap for the same reason NUMERIC_TOLERANCE sits in its own measured gap.
  // A cabinet IS a product this catalogue holds, but the ones it holds are 42RU, inside the band
  // already, so admitting 48 would buy no real part and would start accepting the rack a device
  // MOUNTS IN as the device's own height.
  // CONSEQUENCE, recorded rather than hidden: 42U now passes the band, so a rack's height can no
  // longer be refused by the band at all — it has to be refused by its LABEL. That is why
  // "Compatible Rack Unit" (the rack a part FITS, not the part's own height) no longer maps to this
  // field: it is __compat in data/schema/attribute-aliases.en.json, with its own case in
  // tests/aliasRules.test.ts. "Rack Height" stays mapped, because that IS the part's own height,
  // and its "48U" rows are still refused RANGE_VIOLATION.
  // 0 stays refused: a 0U PDU is mounted beside the rails and has no rack height.
  rack_units: { key: "rack_units", de: "Höheneinheiten", en: "Rack units", type: "n", unit: "HE", band: [1, 44], etim: [], icecat: null },
  stackable: { key: "stackable", de: "Stapelbar", en: "Stackable", type: "b", etim: [], icecat: null },
  deploy_role: { key: "deploy_role", de: "Einsatzbereich", en: "Deployment role", type: "e", domain: ["access", "aggregation", "core", "datacenter-tor", "industrial"], etim: [], icecat: null },

  // --- ports ----------------------------------------------------------------------------------
  ports: {
    key: "ports", de: "Port-Bestückung", en: "Port configuration", type: "struct", shape: PORT_SHAPE,
    etim: ["EF003549", "EF004316", "EF000902", "EF012063", "EF008850", "EF008849", "EF004321",
      "EF012061", "EF012062", "EF004849", "EF004318", "EF007643"], icecat: null,
  },
  uplink_ports: { key: "uplink_ports", de: "Uplink-Ports", en: "Uplink ports", type: "struct", shape: PORT_SHAPE, etim: [], icecat: null },
  uplink_modular: { key: "uplink_modular", de: "Modulare Uplinks", en: "Modular uplinks", type: "b", etim: [], icecat: null },
  module_slots: { key: "module_slots", de: "Modulslots", en: "Module slots", type: "n", band: [1, 32], etim: ["EF003597"], icecat: null },
  mgmt_ports: { key: "mgmt_ports", de: "Management-Ports", en: "Management ports", type: "ls", domain: ["console-rj45", "console-usb", "oob-ethernet", "usb-a", "usb-c", "bluetooth"], etim: [], icecat: null },

  // --- PoE ------------------------------------------------------------------------------------
  poe_standard: { key: "poe_standard", de: "PoE-Standard", en: "PoE standard", type: "e", domain: ["none", "802.3af", "802.3at", "802.3bt-t3", "802.3bt-t4", "upoe", "upoe-plus"], etim: ["EF009714"], icecat: null },
  poe_ports: { key: "poe_ports", de: "Anzahl PoE-Ports", en: "PoE port count", type: "n", band: [1, 576], etim: ["EF009715"], icecat: null },
  poe_budget: { key: "poe_budget", de: "PoE-Budget", en: "PoE budget", type: "n", unit: "W", band: [15, 20000], etim: ["EF009716"], icecat: null },
  poe_per_port_max: { key: "poe_per_port_max", de: "Max. PoE je Port", en: "Max PoE per port", type: "n", unit: "W", band: [4, 100], etim: [], icecat: null },

  // --- performance ----------------------------------------------------------------------------
  switching_capacity: { key: "switching_capacity", de: "Switching-Kapazität", en: "Switching capacity", type: "n", unit: "Gbit/s", band: [1, 200000], etim: [], icecat: null },
  forwarding_rate: { key: "forwarding_rate", de: "Weiterleitungsrate", en: "Forwarding rate", type: "n", unit: "Mpps", band: [0.1, 100000], etim: [], icecat: null },
  stacking_bandwidth: { key: "stacking_bandwidth", de: "Stacking-Bandbreite", en: "Stacking bandwidth", type: "n", unit: "Gbit/s", band: [1, 5000], etim: [], icecat: null },
  stack_max_members: { key: "stack_max_members", de: "Max. Switches je Stack", en: "Max stack members", type: "n", band: [2, 16], etim: ["EF003598"], icecat: null },
  packet_buffer: { key: "packet_buffer", de: "Paketpuffer", en: "Packet buffer", type: "n", unit: "MB", band: [0.1, 64000], etim: [], icecat: null },
  mac_table: { key: "mac_table", de: "MAC-Adresstabelle", en: "MAC address table", type: "n", unit: "Einträge", band: [1000, 10000000], etim: [], icecat: null },
  vlan_max: { key: "vlan_max", de: "VLANs (aktiv)", en: "Active VLANs", type: "n", band: [1, 16000], etim: [], icecat: null },
  ipv4_routes: { key: "ipv4_routes", de: "IPv4-Routen", en: "IPv4 routes", type: "n", band: [10, 10000000], etim: [], icecat: null },
  ipv6_routes: { key: "ipv6_routes", de: "IPv6-Routen", en: "IPv6 routes", type: "n", band: [10, 10000000], etim: [], icecat: null },
  multicast_groups: { key: "multicast_groups", de: "Multicast-Gruppen", en: "Multicast groups", type: "n", band: [10, 1000000], etim: [], icecat: null },
  acl_entries: { key: "acl_entries", de: "ACL-Einträge", en: "ACL entries", type: "n", band: [10, 1000000], etim: [], icecat: null },
  jumbo_mtu: { key: "jumbo_mtu", de: "Jumbo-Frames (max. MTU)", en: "Jumbo frame max MTU", type: "n", unit: "Byte", band: [1500, 20000], etim: [], icecat: null },
  latency: { key: "latency", de: "Latenz", en: "Latency", type: "n", unit: "µs", band: [0.01, 100], etim: [], icecat: null },

  // --- compute --------------------------------------------------------------------------------
  cpu: { key: "cpu", de: "CPU", en: "CPU", type: "s", etim: [], icecat: null },
  dram: { key: "dram", de: "Arbeitsspeicher", en: "DRAM", type: "n", unit: "GB", band: [0.06, 512], etim: [], icecat: null },
  flash: { key: "flash", de: "Flash-Speicher", en: "Flash memory", type: "n", unit: "GB", band: [0.03, 1024], etim: [], icecat: null },

  // --- power / cooling ------------------------------------------------------------------------
  psu_config: { key: "psu_config", de: "Netzteil-Konfiguration", en: "PSU configuration", type: "e", domain: ["fixed-internal", "modular-single", "modular-redundant", "external"], etim: [], icecat: null },
  psu_redundant: { key: "psu_redundant", de: "Redundante Stromversorgung", en: "Redundant PSU", type: "b", etim: ["EF012482"], icecat: null },
  psu_options: { key: "psu_options", de: "Netzteil-Optionen", en: "PSU options", type: "ls", etim: [], icecat: null },
  cooling: { key: "cooling", de: "Kühlung", en: "Cooling", type: "e", domain: ["fanless", "fixed-fans", "redundant-replaceable"], etim: [], icecat: null },
  // port-side-intake / port-side-exhaust ADDED 11 Sep 2026. They are Cisco's own unambiguous terms —
  // "front" means the port side on some platforms and the fan side on others, so Cisco says
  // "port-side" instead — and the domain had no value for them: the enum rule for "side" matched the
  // word inside "port SIDE intake", and 239 Cisco facts were stored as SIDE-TO-SIDE airflow, a
  // different thing (185 of them from datasheet tables on switches).
  airflow: { key: "airflow", de: "Luftstromrichtung", en: "Airflow direction", type: "e", domain: ["front-to-back", "back-to-front", "side", "reversible", "port-side-intake", "port-side-exhaust"], etim: [], icecat: null },
  power_typical: { key: "power_typical", de: "Leistungsaufnahme (typisch)", en: "Typical power draw", type: "n", unit: "W", band: [1, 20000], etim: [], icecat: null },
  power_max: { key: "power_max", de: "Leistungsaufnahme (max.)", en: "Max power draw", type: "n", unit: "W", band: [1, 30000], etim: ["EF001003"], icecat: null },
  input_voltage: { key: "input_voltage", de: "Eingangsspannung", en: "Input voltage", type: "nr", unit: "V", band: [-72, 600], etim: [], icecat: null },
  input_freq: { key: "input_freq", de: "Netzfrequenz", en: "Input frequency", type: "nr", unit: "Hz", band: [40, 70], etim: [], icecat: null },
  heat_dissipation: { key: "heat_dissipation", de: "Wärmeabgabe", en: "Heat dissipation", type: "n", unit: "BTU/h", band: [1, 100000], etim: [], icecat: null },

  // --- environment ----------------------------------------------------------------------------
  temp_operating: { key: "temp_operating", de: "Betriebstemperatur", en: "Operating temperature", type: "nr", unit: "°C", band: [-60, 90], etim: [], icecat: null },
  temp_storage: { key: "temp_storage", de: "Lagertemperatur", en: "Storage temperature", type: "nr", unit: "°C", band: [-60, 150], etim: [], icecat: null },
  humidity_operating: { key: "humidity_operating", de: "Rel. Luftfeuchtigkeit (Betrieb)", en: "Operating humidity", type: "nr", unit: "%", band: [0, 100], etim: [], icecat: null },
  altitude_max: { key: "altitude_max", de: "Max. Betriebshöhe", en: "Max operating altitude", type: "n", unit: "m", band: [0, 10000], etim: [], icecat: null },
  acoustic_noise: { key: "acoustic_noise", de: "Geräuschpegel", en: "Acoustic noise", type: "n", unit: "dB(A)", band: [0, 120], etim: [], icecat: null },
  mtbf: { key: "mtbf", de: "MTBF", en: "MTBF", type: "n", unit: "h", band: [1000, 10000000], etim: [], icecat: null },
  ip_rating: { key: "ip_rating", de: "Schutzart (IP)", en: "IP rating", type: "s", examples: ["IP30", "IP54", "IP67"], etim: ["EF005474"], icecat: null },

  // --- LICENSING AND SOFTWARE, added 8 Sep 2026 -------------------------------------------------
  // WHY THESE EXIST. Four categories held 3,704 parts and NO field definitions at all
  // (contact-center, software, customer-collaboration, data-center-analytics), and a further seven
  // declared under a quarter of the dictionary. The reason was not neglect: the dictionary is
  // hardware-shaped, and there was nothing to declare. Its 29 "software" keys are hardware SUPPORT
  // flags — poe_at_support, bluetooth_version, hypervisor_support — not the things a licence is
  // actually bought on. So a licence SKU could be given no honest profile, and the shop had no
  // column to put its term or its seat count in.
  //
  // A licence is a product this catalogue sells: 26,022 cisco rows are licences or software. Their
  // buyer needs term, seats and what the thing licences, exactly as a switch buyer needs ports.
  license_type: { key: "license_type", de: "Lizenztyp", en: "Licence type", type: "e", domain: ["perpetual", "subscription", "term", "trial", "embedded"], etim: [], icecat: null },
  license_term: { key: "license_term", de: "Laufzeit", en: "Licence term", type: "n", unit: "months", band: [1, 120], etim: [], icecat: null },
  license_seats: { key: "license_seats", de: "Lizenzumfang (Nutzer/Endpunkte)", en: "Licensed seats or endpoints", type: "n", unit: "seats", band: [1, 1000000], etim: [], icecat: null },
  license_for: { key: "license_for", de: "Lizenziert für", en: "Licensed product", type: "s", examples: ["Catalyst 9300", "Firepower 2110", "Unified CM"], etim: [], icecat: null },
  delivery_method: { key: "delivery_method", de: "Lieferform", en: "Delivery method", type: "e", domain: ["electronic", "physical"], etim: [], icecat: null },
  support_level: { key: "support_level", de: "Supportstufe", en: "Support level", type: "s", examples: ["SNTC 8x5xNBD", "SNTC 24x7x4", "Software Support Service"], etim: [], icecat: null },

  // --- MEASURED FROM CISCO'S OWN SPEC SHEETS, 7 Sep 2026 ---------------------------------------
  // Every field below was counted in the vendor's documents before being added: the share is the
  // proportion of 20 UCS/HyperFlex spec sheets, read line by line, that print it. None was
  // invented. They are here because they had NO key at all, which meant the label mapped to
  // nothing, the fact was never written, and the specification was invisible to every query in
  // the pipeline - including `promote-required`, which can only see what already landed.
  //
  // TWO CANDIDATES WERE WITHDRAWN ON 7 SEP AFTER READING THEIR VALUES, and they are recorded here
  // so nobody adds them back. Both were my own reading of a LABEL; the values disagreed.
  //
  //   `safety_certifications`  measured label "Safety UL", which looked like a list field at 60%.
  //                            Its values are `60950-1`, `62368-1`, `60950-1 Second Edition` - so
  //                            the label is "Safety" and the value is "UL 60950-1". A standards
  //                            body plus its number is a VALUE of `certifications`, which 33
  //                            existing alias rules already say. A field per standards body is
  //                            exactly what judge-by-values.py calls value_of_another_field.
  //   `sound_pressure`         `attribute-aliases.en.json` already routes "^sound pressure level$"
  //                            to `acoustic_noise` with a note saying the dBA figure IS that
  //                            field. The measured values (`40`, `2RU: 43dB`, `83 dBA`) carry no
  //                            distinction from it. A second key would have split one quantity
  //                            across two columns depending on which rule matched first.
  //   `input_connector`        the registry already had `power_input_connector` ("Netzeingangsstecker"),
  //                            owned by the anchored rule `^input connector$`. The measurement missed
  //                            it because the label it saw was "Input Connector IEC", which matched
  //                            nothing - only once the splitter moved the trailing standard into the
  //                            value did the repo's own rule start winning. Two keys here would have
  //                            split one column in two on whether the acronym happened to be moved.
  //   `cordset_rating`         a FIFTH instance of the same mistake, and the first one found by a
  //                            SCAN rather than by accident: `power_cord_rating` already existed
  //                            in GENERATED_FIELDS with the identical German label
  //                            ("Netzkabel-Nennwert"), owned by `^power[ -]cord rating$`. Its
  //                            evidence was also wrong - 48 occurrences on the page and 0 in a
  //                            specification section, every one under "STEP 13 SELECT INPUT
  //                            POWER CORD(s)", an ordering table of sixteen cords. The rule now
  //                            points at the existing key. scripts/audit-field-registry.ts is
  //                            what found it; four earlier instances were each found by hand.
  temp_operating_extended: { key: "temp_operating_extended", de: "Erweiterte Betriebstemperatur", en: "Extended operating temperature", type: "nr", unit: "°C", band: [-40, 80], etim: [], icecat: null },                                       // 40%
  rear_clearance: { key: "rear_clearance", de: "Freiraum hinten", en: "Rear clearance", type: "n", unit: "mm", band: [0, 2000], etim: [], icecat: null },                                                                                       // 35%
  cluster_size_max: { key: "cluster_size_max", de: "Maximale Clustergröße", en: "Maximum cluster size", type: "n", unit: "nodes", band: [1, 1000], etim: [], icecat: null },                                                                    // 30%

  // --- physical / compliance ------------------------------------------------------------------
  dimensions: { key: "dimensions", de: "Abmessungen (H×B×T)", en: "Dimensions (H×W×D)", type: "struct", unit: "mm", shape: "{ h: n, w: n, d: n }", etim: ["EF000040", "EF000008", "EF000049"], icecat: null },
  weight: { key: "weight", de: "Gewicht", en: "Weight", type: "n", unit: "kg", band: [0.01, 500], etim: [], icecat: null },
  certifications: { key: "certifications", de: "Zertifizierungen", en: "Certifications", type: "ls", examples: ["ce", "ul", "fcc-a", "rohs", "reach", "vcci", "kc", "bsmi", "eac"], etim: [], icecat: null },
  ieee_standards: { key: "ieee_standards", de: "IEEE-Standards", en: "IEEE standards", type: "ls", examples: ["802.3ab", "802.1q", "802.3az", "802.1x"], etim: [], icecat: null },

  // --- transceiver-only -----------------------------------------------------------------------
  standard: { key: "standard", de: "Übertragungsstandard", en: "Transmission standard", type: "s", examples: ["1000base-sx", "10gbase-lr", "40gbase-sr4"], etim: [], icecat: null },
  data_rate: { key: "data_rate", de: "Datenrate", en: "Data rate", type: "n", unit: "Gbit/s", band: [0.1, 1600], etim: [], icecat: null },
  media: { key: "media", de: "Übertragungsmedium", en: "Media", type: "e", domain: ["mmf", "smf", "dac-copper", "rj45-copper", "aoc"], etim: [], icecat: null },
  fiber_type: { key: "fiber_type", de: "Fasertyp", en: "Fiber type", type: "e", domain: ["om1", "om2", "om3", "om4", "om5", "os1", "os2"], etim: [], icecat: null },
  wavelength: { key: "wavelength", de: "Wellenlänge", en: "Wavelength", type: "n", unit: "nm", band: [600, 2000], etim: [], icecat: null },
  reach_max: { key: "reach_max", de: "Max. Reichweite", en: "Max reach", type: "struct", unit: "m", shape: "list{ medium: s, distanz: n(m) }", etim: [], icecat: null },
  // mpo-24 ADDED 11 Sep 2026: CFP-100G-SR10 and the CPAK SR10 / 10x10G parts (10 in the catalogue)
  // use a 24-fibre MPO, which no value could hold. SN and CS were proposed too; ZERO catalogue parts
  // name either, so they are not added — a value no product can take is a value nobody has seen work.
  connector: { key: "connector", de: "Anschlusstyp", en: "Connector", type: "e", domain: ["lc-duplex", "lc-simplex", "sc", "mpo-12", "mpo-16", "mpo-24", "rj45", "integrated"], etim: [], icecat: null },
  tx_power: { key: "tx_power", de: "Sendeleistung (TX)", en: "TX power", type: "nr", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  rx_sensitivity: { key: "rx_sensitivity", de: "Empfangsempfindlichkeit (RX)", en: "RX sensitivity", type: "nr", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  // THE TRANSMIT TWIN OF rx_max_input_power, added 6 Sep 2026 because the receive side already had
  // both ends and the transmit side had only one.
  //
  // Raised by the Juniper session rather than worked around by it, which was the right call: their
  // HCT pages publish launch power as two separate ROWS, "(minimum)" and "(maximum)". Mapping both
  // to tx_power put 85 facts into state `conflict` — two values for one field is a disagreement,
  // and this pipeline HOLDS a disagreement rather than resolving it by write order, so the API
  // correctly served none of them. Their interim fix maps only the minimum and records the loss;
  // this closes it.
  //
  // WHY A SEPARATE FIELD RATHER THAN A RANGE, given tx_power is already type "nr". Because the two
  // numbers are not the two ends of one measurement. The minimum is the GUARANTEED launch power —
  // the figure a link budget is computed from — and the maximum is a COMPLIANCE CEILING, the most
  // the transmitter may emit. A reader asking "will this optic drive 40 km" wants the first and
  // would be misled by the second. rx_sensitivity and rx_max_input_power are split for exactly the
  // same reason (sensitivity versus the saturation point), and this makes the four symmetric.
  //
  // Banded like tx_power. Note what the band does NOT catch, recorded so nobody trusts it further
  // than it goes: the EN DASH minus in HCT's "-4.3 dBm" is folded by the extractor, and if that fold
  // ever breaks the value stores as POSITIVE 4.3 — which is inside [-40, 20] and passes. The band
  // catches a wrong magnitude, never a wrong sign.
  tx_max_output_power: { key: "tx_max_output_power", de: "Maximale Sendeleistung (TX)", en: "Maximum transmitter output power", type: "n", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  // THE FOURTH OF THE FOUR, CURATED 12 Sep 2026 (reviewer round 3, §4 item 2). It is the receive
  // twin the comment above names, and it was the only one of the four living in the GENERATED half
  // — so it had no band, and a generated definition with no band is the one nothing can refuse a
  // value to. Two further keys asked the SAME question and are retired into it (SUPERSEDED_KEYS):
  // `max_optical_input_power` ("Maximum input power" 11 · "Receiver damage threshold" 10) and
  // `rx_overload` ("Overload" 5, and type "s", so it could not even hold a number). All three held
  // ZERO facts, so nothing moves; what moves is the 30 label occurrences, which now arrive here.
  //
  // Banded like its three siblings. The band is also the guard that keeps the unanchored
  // "Maximum input power" rule honest: on a POWER table that label is watts, and 1,100 W is outside
  // [-40, 20] dBm, so it is refused rather than stored as a receiver threshold.
  rx_max_input_power: { key: "rx_max_input_power", de: "Maximale Empfängereingangsleistung (Sättigung)", en: "Maximum receiver input power (saturation)", type: "n", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  link_budget: { key: "link_budget", de: "Link-Budget", en: "Link budget", type: "n", unit: "dB", band: [0, 60], etim: [], icecat: null },
  laser_type: { key: "laser_type", de: "Lasertyp", en: "Laser type", type: "e", domain: ["vcsel", "fp", "dfb", "eml"], etim: [], icecat: null },
  // duplex-bidi ADDED 11 Sep 2026: QSFP-40G-SR-BD (5 parts) runs BiDi over a DUPLEX LC pair — neither
  // two plain fibres (duplex) nor one fibre (simplex-bidi), and the old rule filed any "BiDi" as simplex.
  mode: { key: "mode", de: "Übertragungsmodus", en: "Transmission mode", type: "e", domain: ["duplex", "simplex-bidi", "duplex-bidi"], etim: [], icecat: null },
  bidi_wavelengths: { key: "bidi_wavelengths", de: "BiDi-Wellenlängen (TX/RX)", en: "BiDi wavelengths", type: "struct", unit: "nm", shape: "{ tx: n, rx: n }", etim: [], icecat: null },
  ddm: { key: "ddm", de: "DDM/DOM", en: "DDM/DOM", type: "b", etim: [], icecat: null },
  fec: { key: "fec", de: "FEC-Anforderung", en: "FEC requirement", type: "e", domain: ["none", "rs-fec", "fc-fec", "host-dependent"], etim: [], icecat: null },
  temp_class: { key: "temp_class", de: "Temperaturbereich", en: "Temperature class", type: "e", domain: ["commercial", "extended", "industrial"], etim: [], icecat: null },
  cable_length: { key: "cable_length", de: "Kabellänge", en: "Cable length", type: "n", unit: "m", band: [0.1, 100], etim: [], icecat: null },
  wire_gauge: { key: "wire_gauge", de: "Leiterquerschnitt", en: "Wire gauge", type: "n", unit: "AWG", band: [20, 34], etim: [], icecat: null },
  msa: { key: "msa", de: "MSA-Konformität", en: "MSA compliance", type: "ls", examples: ["sff-8472", "sff-8636", "qsfp-dd-msa"], etim: [], icecat: null },

  // --- security / firewall (NGFW) -------------------------------------------------------------
  // Datasheet throughput is quoted in Gbps (large boxes) and Mbps (branch); the normaliser folds
  // both to Gbit/s so a comparison tool can rank them on one axis. Sessions run to billions.
  firewall_throughput: { key: "firewall_throughput", de: "Firewall-Durchsatz", en: "Firewall throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  threat_throughput: { key: "threat_throughput", de: "Threat-Inspection-Durchsatz", en: "Threat inspection throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  ips_throughput: { key: "ips_throughput", de: "IPS-Durchsatz", en: "IPS throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  vpn_throughput: { key: "vpn_throughput", de: "IPsec-VPN-Durchsatz", en: "IPsec VPN throughput", type: "n", unit: "Gbit/s", band: [0.01, 5000], etim: [], icecat: null },
  // security-r6 (12 Sep 2026) -------------------------------------------------------------------
  // CURATED OVERRIDE of the generated entry, which has a unit and NO BAND. It is required of the
  // firewall shapes from today, and a required numeric with no plausibility range cannot refuse an
  // implausible value — the shape that once stored 100 ports on a single-port transceiver. Checked
  // against everything that exists: stored facts min 1.0 max 1.5 Gbit/s (1210CE, 1210CP, 1220CX,
  // from the Secure Firewall 1200 datasheet), and the label values in the 23,651-label inventory
  // run 16.99 Mbps ("Performance: SSL throughput", an ACE figure) to 50 Gbps ("SSL bulk encryption
  // throughput (Gbps)", Firepower 9300). Floor 0.01 sits under the smallest of those; ceiling 5000
  // is the one its four sibling throughput cups use, so the whole family ranks on one scale.
  tls_throughput: { key: "tls_throughput", de: "TLS-/SSL-Durchsatz", en: "TLS/SSL decryption throughput", type: "n", unit: "Gbit/s", band: [0.01, 5000], etim: [], icecat: null },
  // end security-r6 (12 Sep 2026) ---------------------------------------------------------------
  // round-6 B4b (12 Sep 2026) -------------------------------------------------------------------
  // CURATED OVERRIDE of the generated entry, which is type "s" with no domain. Required of every
  // `drive` kind -- 2,435 parts across servers, hci-infrastructure and hci-systems -- and as a free
  // string it was holding three different quantities at once. Measured over its 284 stored facts:
  //
  //     the interface      NVMe 68, SAS 63, SATA 62, U.3 20, "U.3 NVMe" 8, SAS-3 5, U.2 2
  //     a LANE COUNT       "3X" 12, "1X" 11                      <- how many lanes, not what bus
  //     an ENDURANCE       "1DWPD" 4                             <- drive writes per day
  //     a PCIe lane spec   "PCIe Gen5 x4" 3, "PCIe Gen5 x2" 1    <- bus AND width in one cell
  //
  // Closed to the interfaces. The lane counts and the DWPD now REFUSE, which is the point: 27 facts
  // for a retraction run to rekey, and until now indistinguishable from a correct answer. The
  // ENUM_RULES in specNormalize fold "PCIe Gen5 x4" to `pcie` (the interface IS PCIe; the width
  // belongs in a cup nobody has asked for) and "U.3 NVMe" to `u.3` (a U.3 bay is NVMe by
  // definition). `m.2` is in the domain for the drives the corpus will acquire, not the ones it has.
  drive_interface: { key: "drive_interface", de: "Laufwerksanbindung", en: "Per-Drive Interface", type: "e",
    domain: ["sas", "sas-3", "sata", "nvme", "pcie", "u.2", "u.3", "m.2"], etim: [], icecat: null },
  // end round-6 B4b -----------------------------------------------------------------------------
  // round-6 B6 (12 Sep 2026) -- THE SERVER SIZING CUPS ------------------------------------------
  // The reviewer's finding: a buyer choosing between two UCS rack servers chooses on memory
  // capacity, DIMM slots, PCIe slots and socket count, and the dictionary held none of the first
  // three. Their decision was to add all three and require them plus cpu_sockets of every `server`
  // kind. THE LABEL EVIDENCE WAS COLLECTED FIRST, as they asked, and it changes three of the four
  // -- measured over the 23,651-label cisco-datasheets inventory:
  //
  //   memory_max    84 occurrences over 15 labels. The strongest of the four, and it reveals a
  //                 WRONG POUR: "Memory Capacity" (x14) and "Memory capacity" (x7) currently map
  //                 to `dram`, and their sample values are "32 DIMMs; up to 512 GB" and "12 GB
  //                 (6 per GPU)" -- a MAXIMUM in the cup for INSTALLED memory. Two quantities.
  //   dimm_slots     4 occurrences. "DIMM slots" x4 and nothing else: the other 15 labels the
  //                 probe caught are USB flash-memory slots and a compact-flash slot COVER.
  //                 REQUIRED, this would be 1,555 gaps against four label occurrences -- the
  //                 "required field nothing can ever fill" shape. Declared `opt` with the count.
  //   pcie_slots    18 unmapped occurrences ("PCIe slots" x16, "PCIe Slots" x2), and the sample is
  //                 PROSE: "10 PCIe 2.0 slots available (total of 11 slots)". It also overlaps the
  //                 existing `expansion_io` (struct), which already takes "Expansion slots" x16 and
  //                 "PCIe expansion" x13 -- a count beside a layout is defensible (`sfp_ports`
  //                 beside `ports`) but it is term 6 territory, so this one is `opt` until the
  //                 prose parses. Recorded rather than quietly required.
  //   cpu_sockets   ~25 occurrences, all unmapped ("Processor Sockets" x14, "Number of CPUs" x4).
  //                 See the supersession note below: the direction the reviewer chose is backwards.
  //
  // Bands are checked against what exists: a UCS X210c takes 8 TB, an S3260 32 DIMMs, a C240 M7
  // 8 PCIe slots. The floors are 1 (a one-DIMM appliance is real); the ceilings leave room for one
  // more generation and no more.
  memory_max: { key: "memory_max", de: "Maximaler Arbeitsspeicher", en: "Maximum memory", type: "n", unit: "GB", band: [1, 32768], etim: [], icecat: null },
  dimm_slots: { key: "dimm_slots", de: "DIMM-Steckplätze", en: "DIMM slots", type: "n", band: [1, 128], etim: [], icecat: null },
  pcie_slots: { key: "pcie_slots", de: "PCIe-Steckplätze", en: "PCIe slots", type: "n", band: [1, 64], etim: [], icecat: null },
  // end round-6 B6 ------------------------------------------------------------------------------
  // round-6 B4c (12 Sep 2026) -- BREAKOUT CABLES ---------------------------------------------------
  // A QSFP28-to-4xSFP28 cable has two cages, and `form_factor` holds one. The normaliser already
  // refuses such a value by name, and the reviewer's decision was a `breakout-cable` kind asked both
  // ends and the fan-out instead. Both ends take the optic cage domain unchanged: a breakout cable is
  // described by which two CAGES it joins, and inventing cable-type members for form_factor would have
  // made that one cup a cage for 545 parts and a cable type for 37 (term 6).
  form_factor_a: { key: "form_factor_a", de: "Bauform Seite A", en: "Form factor, end A (host side)", type: "e",
    domain: ["gbic", "x2", "xenpak", "xfp", "sfp", "sfp-plus", "sfp28", "sfp56", "sfp-dd", "dsfp",
      "qsfp-plus", "qsfp28", "qsfp56", "qsfp112", "qsfp-dd", "cfp", "cfp2", "cpak", "osfp"], etim: [], icecat: null },
  form_factor_b: { key: "form_factor_b", de: "Bauform Seite B", en: "Form factor, end B (fan-out side)", type: "e",
    domain: ["gbic", "x2", "xenpak", "xfp", "sfp", "sfp-plus", "sfp28", "sfp56", "sfp-dd", "dsfp",
      "qsfp-plus", "qsfp28", "qsfp56", "qsfp112", "qsfp-dd", "cfp", "cfp2", "cpak", "osfp"], etim: [], icecat: null },
  // The fan-out count. 2 (QSFP-DD to 2xQSFP56) and 4 (QSFP28 to 4xSFP28) are what exists; 8 is an
  // 800G OSFP to 8xSFP56 that will. A 1 is not a breakout, so the floor is 2.
  breakout_count: { key: "breakout_count", de: "Anzahl Abzweige", en: "Breakout count", type: "n", band: [2, 16], etim: [], icecat: null },
  // end round-6 B4c -----------------------------------------------------------------------------
  // round-6 B5 (12 Sep 2026) -- WAVELENGTHS THAT ARE NOT ONE NUMBER ---------------------------------
  // `wavelength` is a scalar (738 facts: 1310, 850, 1550 ...). `tx_wavelength` was the transmit RANGE
  // under a free-string type -- its own alias note says "values are Tx-only windows (1530-1565)" -- and
  // the reviewer's first proposal, superseding it into `wavelength`, would have coerced a span into a
  // single number or refused it. Measured over its 17 facts (13 in optical-networking, 4 elsewhere):
  //   15 are a RANGE      "1530-1565" x7, "840-860" x4, "1260-1355 (1310 typical)" x2, "1260-1335", "1260-1360"
  //    2 are PER LANE     "1271 ±6.5 (lane 1) 1291 ±6.5 (lane 2) 1311 ±6.5 (lane 3) 1331 ±6.5 (lane 4)" (a
  //                       CWDM4 LR4) and "1547.5 ±17.5 (lane 1)"
  // So two cups, typed for what they hold. The band is the optical window Cisco sells into: 780 nm is
  // the shortest multimode source in the catalogue and 1650 nm the top of the L-band.
  wavelength_range: { key: "wavelength_range", de: "Wellenlängenbereich", en: "Wavelength range", type: "nr", unit: "nm", band: [780, 1650], etim: [], icecat: null },
  lane_wavelengths: { key: "lane_wavelengths", de: "Wellenlängen je Lane", en: "Wavelength per lane", type: "ls", unit: "nm", etim: [], icecat: null },
  // end round-6 B5 ------------------------------------------------------------------------------
  // TWO SYNONYM PAIRS, RECORDED RATHER THAN MERGED (9 Sep 2026). Each curated key above has a
  // GENERATED twin that different datasheets spell differently, so one measurement lands under
  // two keys depending on which page it came from:
  //
  //     threat_throughput  "Threat inspection throughput"   17 live facts / 17 parts
  //     threat_defense_throughput  "Threat Defense throughput"  3 / 3
  //     vpn_throughput     "IPsec VPN throughput"            3 / 3
  //     ipsec_throughput   "IPsec throughput"                6 / 6
  //
  // NOT MERGED, and the reason is the measurement: ZERO parts carry both members of either pair.
  // They are splitting a small population, not disagreeing about one — so there is no conflict to
  // resolve and nothing is currently wrong on any part page. Merging means superseding live facts
  // and rewriting their key, which is a data migration with a run row and a gate, not a schema
  // edit. Whoever does it should check the pairs are genuinely the same measurement first: Cisco
  // quotes "Threat Defense throughput" and "threat inspection throughput" from different product
  // lines and they are not obviously the same test.
  concurrent_sessions: { key: "concurrent_sessions", de: "Gleichzeitige Sessions", en: "Concurrent sessions", type: "n", unit: "Sessions", band: [1000, 3000000000], etim: [], icecat: null },
  new_conn_per_sec: { key: "new_conn_per_sec", de: "Neue Verbindungen/s", en: "New connections per second", type: "n", unit: "1/s", band: [100, 30000000], etim: [], icecat: null },
  // The primary sizing figure for a management or logging appliance — a Firepower Management
  // Center and a Security Analytics deployment are chosen on the event rate they can take, and
  // nothing in the dictionary covered it. Added 8 Sep 2026 with the security shapes; `1/s` is the
  // unit new_conn_per_sec already uses, so no new unit had to be admitted to UNITS and CANON.
  events_per_second: { key: "events_per_second", de: "Ereignisse pro Sekunde", en: "Event rate (events per second)", type: "n", unit: "1/s", band: [1, 10000000], etim: [], icecat: null },
  // CURATED OVERRIDE of the generated entry, which has no band. It is now REQUIRED of the email
  // and web gateways, and a required numeric with no plausibility range cannot refuse an
  // implausible value — the shape that once stored 100 ports on a single-port transceiver. The
  // range is the same one license_seats uses: an ESA sheet sizes from tens of users to a quarter
  // of a million, and a figure outside 1..1,000,000 is a mis-parse rather than a large customer.
  recommended_users: { key: "recommended_users", de: "Empfohlene Nutzerzahl", en: "Recommended number of users", type: "n", band: [1, 1000000], etim: [], icecat: null },
  // CURATED OVERRIDE, 8 Sep 2026. The generated entry is type "s" with no unit, so a flow rate was
  // stored as prose and could not be compared, filtered or ranged — and Cisco licenses Secure
  // Network Analytics BY flows per second, which makes it the sizing figure for that whole shape.
  // `1/s` is the unit new_conn_per_sec already declares, so nothing new had to enter UNITS/CANON.
  // Band from the published Flow Collector range, widened at both ends: a virtual collector starts
  // in the thousands and the largest Data Store deployments are quoted in the low millions.
  flows_per_second: { key: "flows_per_second", de: "Flows pro Sekunde", en: "Flows per second", type: "n", unit: "1/s", band: [100, 10000000], etim: [], icecat: null },
  vpn_peers: { key: "vpn_peers", de: "IPsec-VPN-Peers", en: "IPsec VPN peers", type: "n", unit: "Peers", band: [1, 200000], etim: [], icecat: null },
  max_interfaces: { key: "max_interfaces", de: "Max. Schnittstellen", en: "Maximum interfaces", type: "n", band: [1, 400], etim: [], icecat: null },
  storage_capacity: { key: "storage_capacity", de: "Onboard-Speicher", en: "Onboard storage", type: "n", unit: "GB", band: [1, 200000], etim: [], icecat: null },

  // --- wireless (access points / WLAN controllers) --------------------------------------------
  // TYPE "s" -> "e" WITH A CLOSED DOMAIN, 12 Sep 2026 (reviewer round 3, §4 item 3 and item 7).
  //
  // `examples` is documentation and enforces nothing, so this cup accepted every string a Wi-Fi
  // row ever carried. Read off the 188 stored facts:
  //
  //   126 REAL, in six spellings   "Wi-Fi 6" 57 · "WiFI6" 35 · "Wi-Fi 6E" 13 · "WiFi6" 11 ·
  //                                "Wi-Fi 7" 8 · "WIFI6" 1 · "WiFi 6" 1
  //    62 NOT A GENERATION AT ALL  "2X2 MIMO" 18 · "NA" 14 · "No" 11 · "Yes" 3 · "–" 4 · "4" 2 ·
  //                                "DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**" 8 ·
  //                                "Yes, 4 Stream MU-MIMO" 1 · "Yes, 8 Stream MU-MIMO" 1
  //
  // The 62 come from a FEATURE-MATRIX row: the ISR 1100 and Meraki sheets label a column
  // "802.11ac Wave 2" or "Wi-Fi 6 and Wi-Fi 6E (802.11ax)" and fill the cell with yes/no, the MIMO
  // configuration, or a list of 802.11ax features. The label names the generation; the cell does
  // not state it. No label rule can separate those two, because the label is identical — only the
  // VALUE can, which is what a domain is for. "2X2 MIMO" has a cup already (`spatial_streams`) and
  // is not silently moved there: a normaliser that re-routes by value shape is classifying, not
  // normalising, so it becomes an ENUM_VIOLATION and a recorded gap.
  //
  // The domain is the Wi-Fi Alliance generation names, which is the ONE axis every spelling in the
  // corpus reduces to; ENUM_RULES.wifi_generation in specNormalize folds the six spellings and the
  // 802.11 letters onto them. No "wi-fi 8": the catalogue holds no part that claims it, and a value
  // no product has taken is a value nobody has seen work (the same argument as connector's SN/CS).
  wifi_generation: {
    key: "wifi_generation", de: "WLAN-Generation", en: "Wi-Fi generation", type: "e",
    domain: ["wi-fi 4", "wi-fi 5", "wi-fi 6", "wi-fi 6e", "wi-fi 7"], etim: [], icecat: null,
  },
  // wireless-r7 (12 Sep 2026) ---------------------------------------------------------------------
  // SPATIAL STREAMS BECAME AN ENUM, and the domain is the catalogue's own eight configurations.
  // `spatial_streams` is declared by ONE category (wireless: 506 facts, 13 distinct values; no other
  // Cisco category holds a single fact under it — checked across all 17 censuses), so retyping it
  // costs no other category anything, which is the whole reason it can be closed and `radio_bands`
  // cannot (see DOMAIN_OVERRIDES for that argument).
  //
  // The eight members cover 501 of the 506 stored facts:
  //   4x4:3 234 · 4x4:4 83 · 2x2 57 · 3x4:3 51 · 4x4 27 · 2x2:2 26 · 3x3:2 21 · 8x8:8 2
  // "4x4" is NOT folded into "4x4:4" and "2x2" not into "2x2:2": an array size with no stream count
  // is what the source said, and inventing the third number is how "4x4:3" would become a lie.
  //
  // THE OTHER FIVE ARE REFUSED, and each is refused for a reason the value states:
  //   CW9174E "10 or 8 (2x2+4x4+4x4 or 4x4+4x4)"   — ALTERNATIVES: a capability statement, not a spec
  //   MR46E   "8 (4x4 + 4x4)"                      — a stream TOTAL across two radios
  //   MR44/MR56 "2.4GHz: 2 x 2 … 5GHz: 4 x 4 …"    — two radios in one cell; picking one is classifying
  //   MR46    "4 x 4 … (MIMO) with four spatial streams" — a single radio in PROSE. Foldable in
  //           principle; left refused because a rule written for one row is a rule that fits one row,
  //           and the fix belongs in the Meraki extractor (report, proposal M1).
  spatial_streams: {
    key: "spatial_streams", de: "Spatial Streams", en: "Spatial streams", type: "e",
    domain: ["2x2", "2x2:2", "3x3:2", "3x4:3", "4x4", "4x4:3", "4x4:4", "8x8:8"], etim: [], icecat: null,
  },
  // REGULATORY DOMAIN — a NEW cup (reviewer round 3 item 7). A Cisco access point is ORDERED per
  // regulatory domain: AIR-AP1832I-B-K9 is the same hardware as -E with a different channel set, and
  // a buyer who takes the wrong one cannot deploy it. 311 part NAMES state it in words ("Reg Domain
  // A", "B Reg Domain (for US)", "-A Regulatory Domain", "P Domain") and 1,443 of the 2,756 AP SKUs
  // carry the token; the datasheet does NOT state it — its "Regulatory domains" row (20 occurrences)
  // holds a note pointing at Cisco's compliance lookup, which is why the fill path is the four
  // `wl-reg-domain-*` description patterns and not an alias (see the report).
  //
  // AN ENUM, NOT A FREE STRING, AND THAT IS THE POINT. "NA" is North America here; under type "s" the
  // placeholder guard below `PLACEHOLDER_VALUE` in specNormalize reads "NA" as "not applicable" and
  // deletes the answer. The guard's own comment names this field as the reason it is scoped to s/ls.
  // tests/specNormalize.refusals asserts both halves: "NA" is ACCEPTED here and refused as a
  // placeholder under a type-"s" key.
  //
  // THE DOMAIN IS TWO NOTATIONS BECAUSE THE VENDOR USES TWO, measured over the 6,269 Cisco wireless
  // parts (replay in the report):
  //   20 letters  a b c d e f g h i j k l m n p q r s t z — Aironet/Catalyst/CBW/WAP APs. 19 have
  //               direct NAME evidence (305 parts, and the letter AGREES with the SKU token in 305 of
  //               305, 0 disagreements); `j` is evidenced by the SKU alone (AIR-AP3802H-J-K9,
  //               WAP125-J-K9-JP, 7 parts). o/u/v/w/x/y are absent from the catalogue and absent here.
  //   universal   38 parts, "Bulk PID for Universal Domain" / "3x3:2SS; Int Ant; Universal Domain"
  //   row         3 parts, C9124AXE-EWC-ROW "ROW Regulatory Domain"
  //   na          Fluidmesh FLMESH-HW-*-1NA / -2NA (7 parts) — the North-America variant
  //   nam-lam     the same 7 parts' NAMES: "FM3200B-HW, NAM/LAM Version", "NAM, LAM, CANADA Version"
  //               — ONE orderable variant approved for two regions, so it is one member and not a
  //               refusal; folding it to `na` would drop what the vendor actually shipped.
  // NOT in the domain, deliberately: "etsi" and "fcc". Every part whose name says ETSI or FCC
  // (AIR-CAP1552E-E-K9 "ETSI config", AIR-CT100-1140A30 "FCC Cfg") ALSO carries the domain letter in
  // its SKU, so the region word is a second notation for a value that is already better sourced; and
  // AIR-AMERICAS / AIR-EMEA ("Regulatory Domain Configuration for Americas (FCC)") are ordering
  // options, not products. Mapping a letter onto a region (-A -> Americas) needs Cisco's own
  // regulatory-domain table, which the corpus does not carry: an operator question, not a guess.
  regulatory_domain: {
    key: "regulatory_domain", de: "Regulierungsbereich", en: "Regulatory domain", type: "e",
    domain: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "p", "q", "r", "s",
      "t", "z", "na", "nam-lam", "row", "universal"],
    etim: [], icecat: null,
  },
  // end wireless-r7 ---------------------------------------------------------------------------------
  radio_count: { key: "radio_count", de: "Anzahl Funkmodule", en: "Radio count", type: "n", band: [1, 8], etim: [], icecat: null },
  max_data_rate: { key: "max_data_rate", de: "Max. Datenrate", en: "Maximum data rate", type: "n", unit: "Gbit/s", band: [0.05, 100], etim: [], icecat: null },
  ap_max_clients: { key: "ap_max_clients", de: "Max. Clients je AP", en: "Max clients per AP", type: "n", band: [1, 10000], etim: [], icecat: null },
  wlc_ap_capacity: { key: "wlc_ap_capacity", de: "Max. Access Points (Controller)", en: "Max access points (controller)", type: "n", band: [1, 200000], etim: [], icecat: null },
  wlc_client_capacity: { key: "wlc_client_capacity", de: "Max. Clients (Controller)", en: "Max clients (controller)", type: "n", band: [1, 2000000], etim: [], icecat: null },
  // CURATED 12 Sep 2026 (round-6 reviewer B4a). Required of `ap` (2,750), `antenna` (191) and
  // `backhaul` (41) in wireless and of `antenna` in routers, and a free string whose `examples`
  // enforce nothing -- the shape wifi_generation was in. Its wireless population is ONE AXIS IN
  // TWELVE SPELLINGS: "2.4 GHz" 56, "5 GHz" 30, "Dual-band" 15, "2.4GHz" 13, "Dual Band" 10,
  // "5GHz" 6, "2.4/5 GHz" 4, "5Ghz" 3, "Tri-band" 3, "tri-band" 3, "2.4 and 5 GHz" 1, "2.4 Ghz" 1.
  //
  // A LIST, not an enum, because the quantity is a SET: a dual-band radio answers 2.4 AND 5, and
  // "Dual-band" is a count of the set rather than a member of it. `ls` with a closed domain folds
  // all twelve into the bands they name (ENUM_RULES in specNormalize).
  //
  // AND IT CARRIES A SECOND QUANTITY IN ROUTERS, which is why closing the type matters beyond
  // tidiness: routers.radio_bands holds 27 facts of CELLULAR band text ("700MHz",
  // "850/900/1900/2100 MHz", and four rows of LTE/5G band lists running past 300 characters) while
  // `cellular_bands` sits in the same profile with 47 facts of exactly that. Those 27 are a wrong
  // pour (term 7); they will now refuse rather than serve, which puts them on the retraction list
  // instead of leaving them indistinguishable from a Wi-Fi answer.
  radio_bands: { key: "radio_bands", de: "Frequenzbänder", en: "Frequency bands", type: "ls",
    domain: ["2.4ghz", "5ghz", "6ghz", "60ghz"], etim: [], icecat: null },

  // --- routing (ISR / ASR / Catalyst 8000) ----------------------------------------------------
  router_throughput: { key: "router_throughput", de: "System-Durchsatz", en: "System throughput", type: "n", unit: "Gbit/s", band: [0.005, 10000], etim: [], icecat: null },
  ipsec_throughput: { key: "ipsec_throughput", de: "IPsec-Durchsatz", en: "IPsec throughput", type: "n", unit: "Gbit/s", band: [0.005, 5000], etim: [], icecat: null },
  ipsec_tunnels: { key: "ipsec_tunnels", de: "IPsec-Tunnel", en: "IPsec tunnels", type: "n", band: [1, 2000000], etim: [], icecat: null },

  // --- deep-spec fields across optical / transceiver / wireless / security / SAN --------------
  // Authored by the per-category alias workflow (2026-09-02), then curated: Webex/collab marketing
  // and cable-TV-RF fields dropped (out of hexwaren's scope), duplicates consolidated, enums with
  // no safe domain kept as strings, sensible bands on numerics. These map the ~7.3k per-SKU facts
  // the switch-shaped dictionary could not name.
  advanced_functions: { key: "advanced_functions", de: "Erweiterte Funktionen", en: "Advanced functions", type: "ls", etim: [], icecat: null },
  // wireless-r7 (12 Sep 2026) — CLOSED. `antenna_connector` is declared by one category (wireless,
  // 99 facts, two spellings: "RP-TNC" 85, "N-type" 14) so the type change reaches nobody else. The
  // domain is five members because the LABEL values name five connectors, not two: "Antenna
  // Connector" (3 occurrences) holds "QMA, female" and "RF Mesh N connector (female)", "Coaxial
  // connectors" (3) holds "2x Cu-Sn-Zn-plated QMA", and AIR-ANT3351's own name states MMCX; SMA
  // appears on Fluidmesh coax (FM-QMA2SMA, FM-LMR240-RPSMA2N). A bare "TNC" is NOT a member — reverse
  // polarity is a different connector and no antenna in the catalogue states one.
  // A CELL NAMING TWO DIFFERENT CONNECTORS IS REFUSED rather than resolved by rule order: "RF Mesh
  // QMA (female), GPS: SMA (female)" is a radio connector and a GPS connector in one cell, and
  // first-match-wins would silently pick whichever rule came first (the two-ended-cable defect in
  // form_factor, one cup over). ENUM_RULES.antenna_connector maps it to `multiple-connectors`, which
  // is not in the domain, so it quarantines naming what it is.
  antenna_connector: {
    key: "antenna_connector", de: "Antennenanschluss", en: "Antenna connector", type: "e",
    domain: ["rp-tnc", "n-type", "qma", "sma", "mmcx"], etim: [], icecat: null,
  },
  antenna_gain: { key: "antenna_gain", de: "Antennengewinn", en: "Antenna gain", type: "struct", unit: "dBi", shape: "{ band24: n, band5: n }", etim: [], icecat: null },
  // CURATED OVERRIDE of the generated `antenna_type` (type "s", no domain) — reviewer round 4 §6.
  // The question is INTERNAL OR EXTERNAL, and it is closed: the three stored facts are the AP1572
  // datasheet's own SKU legend, "E: External antennas" and "I: Internal antennas"; the label
  // "Internal antennas" (8 occurrences) holds "Internal fixed PiFA antenna"; and 594 of the 2,756 AP
  // names state it in words (internal 337, external 257, ZERO naming both), which is the second fill
  // path. `antenna_type` is declared by three categories and holds 5 facts in total, so closing it
  // reaches almost nothing: the two meraki facts ("4x Omni-directional antennas (5.4 dBi gain at 2.4
  // GHz…)") are refused, and they are a wrong pour — a pattern and a gain in an internal/external cup.
  //
  // THE PATTERN IS A DIFFERENT QUANTITY and does not belong here: "Dipole (On-Board)", "Sector 2x2
  // MIMO", "Omnidirectional" describe the radiation pattern of an antenna, not whether an AP's
  // antenna is built in. Those values are why `modulation_format` holds 14 antenna patterns in this
  // category (retraction P1 in schema-dictionary-2026-09-12.md), and they are refused here too.
  antenna_type: {
    key: "antenna_type", de: "Antennentyp", en: "Antenna type", type: "e",
    domain: ["internal", "external"], etim: [], icecat: null,
  },
  // end wireless-r7
  anyconnect_sessions: { key: "anyconnect_sessions", de: "AnyConnect-/Clientless-VPN-Benutzersitzungen", en: "AnyConnect/clientless VPN user sessions", type: "n", unit: "Sitzungen", band: [1, 5000000], etim: [], icecat: null },
  attenuation_dead_zone: { key: "attenuation_dead_zone", de: "Dämpfungstotzone", en: "Attenuation dead zone", type: "n", unit: "m", band: [0, 5000], etim: [], icecat: null },
  // Unit "°" -> "deg" (4 Sep 2026). This field and beamwidth_azimuth are the two halves of ONE
  // antenna measurement and declared two different spellings of the same unit; four further angle
  // fields (field_of_view, beamwidth_3db, camera_pan_tilt_range, lens_adjustment_range) already
  // said "deg", so "deg" is the canonical spelling for the angle dimension everywhere. Only the
  // CANONICAL unit is pinned: "40°", "40 deg" and "40 degrees" are all still read as 40.
  beamwidth_elevation: { key: "beamwidth_elevation", de: "Vertikaler Öffnungswinkel (3 dB)", en: "Elevation 3-dB beamwidth", type: "n", unit: "deg", band: [1, 360], etim: [], icecat: null },
  chassis_compatibility: { key: "chassis_compatibility", de: "Chassis-Kompatibilität", en: "Chassis compatibility", type: "ls", etim: [], icecat: null },
  coherent_interop_standards: { key: "coherent_interop_standards", de: "Kohärente Interop-Standards", en: "Coherent interoperability standards", type: "ls", etim: [], icecat: null },
  cross_connect: { key: "cross_connect", de: "Cross-Connect", en: "Cross-connect", type: "s", etim: [], icecat: null },
  diagnostics: { key: "diagnostics", de: "Diagnose und Fehlerbehebung", en: "Diagnostics and troubleshooting tools", type: "ls", etim: [], icecat: null },
  emc_emissions: { key: "emc_emissions", de: "EMV-Störaussendung", en: "EMC emissions", type: "ls", etim: [], icecat: null },
  emc_immunity: { key: "emc_immunity", de: "EMV-Störfestigkeit", en: "EMC immunity", type: "ls", etim: [], icecat: null },
  etsi_standards: { key: "etsi_standards", de: "ETSI-Normen", en: "ETSI standards", type: "ls", etim: [], icecat: null },
  expansion_io: { key: "expansion_io", de: "Erweiterungs-I/O", en: "Expansion I/O", type: "struct", etim: [], icecat: null },
  fabric_services: { key: "fabric_services", de: "Fabric-Dienste", en: "Fabric services", type: "ls", etim: [], icecat: null },
  input_power_range: { key: "input_power_range", de: "Eingangsleistungsbereich (optisch)", en: "Optical input power range", type: "nr", unit: "dBm", band: [-60, 30], etim: [], icecat: null },
  itu_channel: { key: "itu_channel", de: "ITU-Kanal", en: "ITU channel", type: "s", etim: [], icecat: null },
  jacket_color: { key: "jacket_color", de: "Mantelfarbe", en: "Cable jacket color", type: "s", etim: [], icecat: null },
  jacket_material: { key: "jacket_material", de: "Mantelmaterial", en: "Cable jacket material", type: "s", etim: [], icecat: null },
  min_software_release: { key: "min_software_release", de: "Mindest-Systemsoftware", en: "Minimum system software release", type: "s", etim: [], icecat: null },
  mounting: { key: "mounting", de: "Montage", en: "Mounting", type: "s", etim: [], icecat: null },
  optical_pm: { key: "optical_pm", de: "Optische Leistungsüberwachung (Trunk)", en: "Trunk optical performance monitoring", type: "ls", etim: [], icecat: null },
  otn_pm: { key: "otn_pm", de: "OTN-Leistungsüberwachung", en: "OTN performance monitoring", type: "ls", etim: [], icecat: null },
  polarization: { key: "polarization", de: "Polarisation", en: "Polarization", type: "s", etim: [], icecat: null },
  power_full_load: { key: "power_full_load", de: "Leistungsaufnahme bei 100% Durchsatz", en: "Power consumption at 100% throughput", type: "n", unit: "W", band: [1, 30000], etim: [], icecat: null },
  product_compatibility: { key: "product_compatibility", de: "Produktkompatibilität", en: "Product compatibility", type: "ls", etim: [], icecat: null },
  programming_interfaces: { key: "programming_interfaces", de: "Programmierschnittstellen", en: "Programming interfaces", type: "ls", etim: [], icecat: null },
  recycled_content: { key: "recycled_content", de: "Rezyklatanteil", en: "Recycled content", type: "s", etim: [], icecat: null },
  redundancy: { key: "redundancy", de: "Redundanz", en: "Redundancy", type: "ls", etim: [], icecat: null },
  reflective_dead_zone: { key: "reflective_dead_zone", de: "Reflexionstotzone", en: "Reflective dead zone", type: "n", unit: "m", band: [0, 5000], etim: [], icecat: null },
  rfc_compliance: { key: "rfc_compliance", de: "RFC-Konformität", en: "RFC compliance", type: "ls", etim: [], icecat: null },
  rx_wavelength: { key: "rx_wavelength", de: "Empfangswellenlänge (Eingang)", en: "Receiver input wavelength", type: "nr", unit: "nm", band: [600, 2000], etim: [], icecat: null },
  serviceability: { key: "serviceability", de: "Wartungsfunktionen", en: "Serviceability", type: "ls", etim: [], icecat: null },
  shelf_assembly: { key: "shelf_assembly", de: "Baugruppenträger / Shelf-Assembly", en: "Shelf assembly", type: "s", etim: [], icecat: null },
  // `ls` since 4 Sep 2026: the datasheets state several shock figures (operating, non-operating,
  // per axis) and a string field held only the first clause of the cell.
  shock: { key: "shock", de: "Schockfestigkeit", en: "Shock resistance", type: "ls", etim: [], icecat: null },
  slot_compatibility: { key: "slot_compatibility", de: "Slot-Kompatibilität", en: "Slot compatibility", type: "s", etim: [], icecat: null },
  supported_modules: { key: "supported_modules", de: "Unterstützte Module", en: "Supported modules", type: "ls", etim: [], icecat: null },
  supported_protocols: { key: "supported_protocols", de: "Unterstützte Protokolle", en: "Supported protocols", type: "ls", etim: [], icecat: null },
  supported_transceivers: { key: "supported_transceivers", de: "Unterstützte Transceiver-Module", en: "Supported transceiver modules", type: "ls", etim: [], icecat: null },
  usb_console: { key: "usb_console", de: "Integrierte USB-Konsole", en: "Integrated USB console", type: "b", etim: [], icecat: null },

  // --- four German labels that survived the 8 Sep umlaut pass, corrected HERE and not in the
  // generated file. `fieldSchema.generated.ts` is rewritten by sync-dictionary, so a fix applied
  // there lasts until the next regeneration and then silently reverts; the merge at the foot of
  // this file only fills keys the curated dictionary does NOT hold
  // (`if (!FIELD_DICTIONARY[key]) ...`), so a curated entry wins permanently. type, unit and the
  // English label are copied verbatim from the generated definitions — this changes the German
  // spelling and nothing else, which is what makes it safe to land without re-running extraction.
  fan_hot_swap: { key: "fan_hot_swap", de: "Hot-Swap-Lüfter", en: "Hot-swappable fans", type: "s", etim: [], icecat: null },
  ride_through_time: { key: "ride_through_time", de: "Minimale Überbrückungszeit", en: "Minimum ride-through time", type: "n", unit: "ms", etim: [], icecat: null },
  supported_os: { key: "supported_os", de: "Unterstützte Betriebssysteme", en: "Supported operating systems", type: "s", etim: [], icecat: null },
  insertion_loss_max: { key: "insertion_loss_max", de: "Maximale Einfügedämpfung", en: "Maximum insertion loss", type: "n", unit: "dB", etim: [], icecat: null },

  // fabric_bandwidth, RETYPED to a number on 11 Sep 2026. The generated definition already said the
  // right thing — "per-slot fabric attachment of a line card, chassis-dependent; not the system
  // switching capacity" — but typed it a STRING, so "40 Gbps (80 Gbps full duplex)" would have been
  // served as text nobody can compare or filter. It held ZERO facts when retyped, so nothing
  // re-parses. It is the cup for every PER-SLOT figure that was being poured into
  // switching_capacity: 86 switches facts held both a line card's "48 Gbit/s je Steckplatz" and a
  // supervisor's "6 Tbit/s Crossbar-Fabric" under one key, and WS-X45-SUP7-E said 48 where its own
  // source says "(848 Gbit/s System)". A second key for the same quantity would have been its own
  // defect, so this one is used rather than inventing `slot_bandwidth`. Band: Cisco publishes from
  // 622 Mbit/s (an optical SPA slot) to 6.4 Tbit/s (C9600, "Per-slot Switching Capacity").
  fabric_bandwidth: { key: "fabric_bandwidth", de: "Bandbreite der Switch-Fabric-Anbindung", en: "Switch fabric connection bandwidth", type: "n", unit: "Gbit/s", band: [0.1, 20000], etim: [], icecat: null },

  // THREE TRANSCEIVER CUPS, 11 Sep 2026, each declared OPTIONAL: the catalogue names them (85 parts say
  // "breakout", 27 "passive" and 9 "active copper", the coherent ZR/DCO line is tunable) but no label
  // in any source inventory maps to them yet, and a required field nothing can fill is a permanent gap.
  breakout: { key: "breakout", de: "Breakout-Konfiguration", en: "Breakout configuration", type: "s", examples: ["1x4", "1x2", "1x8"], etim: [], icecat: null },
  tunable: { key: "tunable", de: "Wellenlänge durchstimmbar", en: "Tunable wavelength", type: "b", etim: [], icecat: null },
  dac_type: { key: "dac_type", de: "DAC-Typ (passiv/aktiv)", en: "DAC type (passive/active)", type: "e", domain: ["passive", "active"], etim: [], icecat: null },
  // routers-r5 (12 Sep 2026) — nat_sessions RETYPED from `s` to a COUNT, reviewer §6 item 4.
  // A NAT translation scale is a number, and the generated entry made it a free string, so the nine
  // stored values are the text "100K", "2M", "12M", "16M", "32M" — a quantity nobody can compare,
  // filter or band. It is also the shape that lets a placeholder in: nothing could have refused
  // "NA" here, because only a number's band or an enum's domain can.
  //
  // THE RETYPE IS GLOBAL AND THAT WAS CHECKED, not assumed. `security` declares the key too, so the
  // house rule is to use a per-category override rather than change a shared type — but an override
  // exists for unit, domain and band and NOT for type. Measured across all 17 categories on 12 Sep
  // 2026: nat_sessions holds 9 facts in the whole catalogue and every one is in `routers`, and the
  // sibling `nat_entries` holds 0. So no other category's stored values move, and `security`'s own
  // declaration is `opt` with nothing under it. Recorded in the report as a global change.
  //
  // BAND read off the catalogue's own values, which is the reviewer's instruction: stored 100,000
  // (C1101-4P, C1111X-8P, C1121-4P) to 32,000,000 (C8500-20X6C), with 600K/1.2M/2M/12M/16M between.
  // The floor of 1,000 refuses nothing real — Cisco's smallest published figure is 100K — and
  // catches the shapes this file has paid for before: a bare "2024" read out of a date, and a count
  // whose magnitude suffix was dropped ("100K" stored as 100).
  nat_sessions: { key: "nat_sessions", de: "NAT-Sitzungen", en: "NAT sessions", type: "n", band: [1000, 100000000], etim: [], icecat: null },
  // A power cord's plug (CEE 7/7, NEMA 5-15P, SEV 1011). Declared OPTIONAL: no source label names it.
  plug_type: { key: "plug_type", de: "Steckertyp", en: "Plug type", type: "s", examples: ["CEE 7/7", "NEMA 5-15P", "SEV 1011"], etim: [], icecat: null },
  // psu_rated_output had no band. It becomes a REQUIRED field of every switches PSU on 11 Sep 2026,
  // and a required number with no plausibility range is the shape that once stored 100 ports on a
  // one-port optic. Measured on the 277 PSU wattages it inherits: 240 W to 6,000 W.
  psu_rated_output: { key: "psu_rated_output", de: "Nennausgangsleistung", en: "Rated power output", type: "n", unit: "W", band: [5, 20000], etim: [], icecat: null },

  // THE SPAN A TUNABLE OPTIC COVERS, 11 Sep 2026 (reviewer §2.2). A tunable or coherent module has no single
  // wavelength — DP04QSDD-HE0 stored "C-Band (1550 nm, volltunbar)" as 1550 — so it is asked for the range
  // it tunes over instead. NOT `optical_frequency`: that key holds 10 facts that are CHANNEL LISTS on mux
  // modules ("192.7; 192.6; 192.5; 192.4"), and a range type would keep the first channel and drop three.
  // A fixed device's channel set and a laser's tuning span are different quantities. Cisco prints the span
  // as "Frequency range: 191.25 to 196.10 THz (1528.77 to 1566.72 nm)" — a label the alias table sent to the
  // AC mains `input_freq` until today. Band: the ITU C+L grid, 184.5-196.2 THz, with margin.
  tuning_range: { key: "tuning_range", de: "Abstimmbereich (Frequenz)", en: "Tuning range (frequency)", type: "nr", unit: "THz", band: [180, 200], etim: [], icecat: null },
  // A TOLERANCE IS A RANGE (reviewer §2.3 asked for `n`; measured, `nr` is the shape). The generated entry was
  // a free STRING, so "+/-2,500 ps/nm" and "0 ps/nm to 1400 ps/nm" were stored as text nothing could compare.
  // "±X" is the window -X..+X; "0 to 1400" is asymmetric; "±2.4 ns/nm" is ±2400 ps/nm. Band: the widest real
  // value is CIM8-LE-K9 ">±350,000 ps/nm", a coherent line card; ±500,000 leaves margin and refuses a typo.
  chromatic_dispersion_tolerance: { key: "chromatic_dispersion_tolerance", de: "Chromatische Dispersionstoleranz", en: "Chromatic dispersion tolerance", type: "nr", unit: "ps/nm", band: [-500000, 500000], etim: [], icecat: null },
  // WHICH STACK A SWITCH JOINS, 11 Sep 2026 (reviewer §1.1). `stacking_bandwidth` does not imply it:
  // StackWise Virtual and VSS join two chassis with no member bandwidth at all, and StackWise-160 and
  // FlexStack-Plus are both 80 Gbit/s families that do not stack with each other. The name is already in
  // our own data — 300+ `stackable` raws read "Ja – StackWise-160 (optional, bis 9 Einheiten, 160 Gbit/s)",
  // "Ja – Cisco StackWise Plus (bis 9 Einheiten, 64 Gbit/s Stack-Ring)", "FlexStack-Plus". No `none`:
  // a switch that does not stack says so in `stackable` (423 "Nein"), and a second cup for it would split
  // one answer across two keys. vPC is not here either — it keeps two control planes; it is not a stack.
  // A CLOSED LIST, not a single enum: Cisco's own "Stacking" row reads "FlexStack-Plus, FlexStack-Extended"
  // on a 2960-X, and a single-value type would keep the first and drop the second without a word.
  stacking_technology: { key: "stacking_technology", de: "Stacking-Technologie", en: "Stacking technology", type: "ls",
    domain: ["stackwise", "stackwise-plus", "stackwise-80", "stackwise-160", "stackwise-480", "stackwise-1t",
             "stackwise-virtual", "flexstack", "flexstack-plus", "flexstack-extended", "vss"], etim: [], icecat: null },
  // --- video (12 Sep 2026) ---------------------------------------------------------------------------------
  // THE RF DRIVE AN HFC TRANSMITTER NEEDS. Prisma II 1550 sheets print "Total composite RF input | 38.25 dBmV
  // (nominal channel loading)" and "36.5 dBmV"; no key could hold it (rf_output_level is the other end, and a
  // string). A range type, because the XFP-RF sheet states a window ("+1.5 ± 5.0"). dBm values are REFUSED, not
  // converted: dBm→dBmV depends on the impedance (50 vs 75 Ω) and the one dBm-stated sheet is 50 Ω differential.
  // Band: the widest real value is 38.25 dBmV; -20..70 leaves margin both ways and refuses a W or mV figure.
  // OPTIONAL in video: 4 label occurrences in the whole acquired corpus, all Prisma 1550 sheets.
  rf_input_level: { key: "rf_input_level", de: "HF-Gesamteingangspegel", en: "Total composite RF input level", type: "nr", unit: "dBmV", band: [-20, 70], etim: [], icecat: null },
  // --- end video (12 Sep 2026) -----------------------------------------------------------------------------

  // optical-storage (12 Sep 2026) -------------------------------------------------------------------------------
  // AN AMPLIFIER IS BOUGHT ON ITS GAIN, and `gain` was a generated free STRING with no band, declared by one
  // category (optical-networking, opt) and holding ZERO facts anywhere — so retyping it moves nothing and changes
  // no other category. `nr`, because Cisco prints both "Up to 24 dB" (a degenerate range) and a variable-gain
  // span ("Gain range 5 to 20 dB"); `gain_range` (0 facts) is the same quantity and is retired into it
  // (SUPERSEDED_KEYS). Band: the catalogue's own names go from 17 dB (15454-OPT-AMP-17-C) to a 35 dB span
  // (NCS2K-EDRA1-35C); a Raman pump adds ~10-15 dB. [0, 45] leaves margin and refuses a dBm or a channel count.
  gain: { key: "gain", de: "Nennverstärkung", en: "Nominal gain", type: "nr", unit: "dB", band: [0, 45], etim: [], icecat: null },
  // A MUX IS BOUGHT ON ITS CHANNEL COUNT, and no key held one: "40-Channel Mux/DeMux" (15216-MD-40-EVEN), "96
  // channel" (15454-OPT-EDFA-24), "16x16 Blue multiplexer". No unit (a count, like module_slots). Band: 1 (a
  // one-channel OADM, 15216-OADM1-35) to 96 (C-band at 50 GHz) with margin for flex-grid plans. DECLARED OPT:
  // zero datasheet labels map to it (the name is the only source, and no name-mining rule exists yet).
  channel_count: { key: "channel_count", de: "Kanalanzahl", en: "Channel count", type: "n", band: [1, 200], etim: [], icecat: null },
  // A DISPERSION COMPENSATION UNIT IS BOUGHT ON ITS COMPENSATION: 15216-DCU-100= "DCF of -100 ps/nm",
  // 15216-DCU-L-1000= "... 1000ps/nm". Not `chromatic_dispersion_tolerance`, which is what a RECEIVER tolerates.
  // `ps/nm` is the unit chromatic_dispersion_tolerance already declares. Band: the catalogue spans 100 to 1983
  // ps/nm (15216-FBGDCU-1983=), written with either sign. DECLARED OPT: no label maps to it and no fact holds it.
  dispersion_compensation: { key: "dispersion_compensation", de: "Dispersionskompensation", en: "Dispersion compensation", type: "n", unit: "ps/nm", band: [-3000, 3000], etim: [], icecat: null },
  // end optical-storage
};

// ---------------------------------------------------------------------------------------------
// Per-category profiles
// ---------------------------------------------------------------------------------------------

const req: Requirement = { kind: "req" };
const opt: Requirement = { kind: "opt" };
// `na` says a field is NEVER applicable to this category, which closes a gap permanently instead
// of leaving a crawler to hunt for it for ever. The kind has always been in the Requirement type
// and is handled end to end (requirementFor, api/queries/fields, api/tools).
//
// IT HAS NO USERS RIGHT NOW, AND THE REASON IS WORTH KEEPING. It was used 48 times on 8 Sep 2026
// to mark hardware questions not-applicable in four licence categories, and all 48 were removed
// the same day: recompute-completeness never consults a profile for a non-hardware part, so those
// marks only ever reached the HARDWARE sitting in those categories — telling 11 real devices they
// have no weight and no operating temperature. See the note above PROFILES.
//
// So `na` is correct for a field that is impossible for a HARDWARE part of a kind (rack units on a
// transceiver), and wrong as a way to describe a category that mostly holds licences. Before using
// it, check which parts the scorer actually hands to the profile — that is what caught it here.
const na: Requirement = { kind: "na" };
void na; // kept for the case above; referenced so an unused-symbol check cannot silently drop it
/**
 * `cond(when)` — required when the condition holds; `na` when it does not.
 * `cond(when, { elseOpt: true })` — required when it holds, OPTIONAL when it does not.
 *
 * The second form is how a gate stops closing a cup in silence. `na` is permanent, so an unmet
 * condition that resolves to `na` ends the question; with `elseOpt` the answer is "not required of
 * you, but say so if you know", which is the only honest shape when the discriminator is real and
 * nothing answerable expresses it (switches `airflow`, `ip_rating`, `module_slots` — R1, 12 Sep
 * 2026). It is also what makes an optional gate permissible under R1 at all: see
 * tests/gateR1.test.ts, which refuses any other cond whose gate is not required.
 */
const cond = (when: Condition, opts?: { elseOpt?: boolean }): Requirement =>
  opts?.elseOpt ? { kind: "cond", when, elseOpt: true } : { kind: "cond", when };

// Declared here rather than beside completenessV2 because `deviceOnly` below runs at module
// initialisation and must see it. Its documentation stays with the scorer that reads it.
export const COLUMN_BACKED: ReadonlySet<string> = new Set(["vendor", "series"]);

/**
 * Ask a flat block of requirements only of a DEVICE — never of a power supply, fan, cable, rack
 * kit or software image. Applied to a whole profile object: every UNCONDITIONAL `req` becomes
 * `cond({ field: "kind", inList: GENERIC_DEVICE })`, and `opt`, `na` and existing conditionals
 * pass through untouched.
 *
 * WHY A WRAPPER RATHER THAN EDITING EACH LINE. Eleven categories share this problem and between
 * them declare ~120 required fields. Rewriting each by hand is 120 chances to miss one silently,
 * and a missed one is invisible: the field simply stays required of cables. Wrapping the object
 * cannot miss a field, and the diff per category is one line.
 *
 * COLUMN_BACKED KEYS ARE LEFT ALONE. `vendor` and `series` come from the part row rather than from
 * facts and are excluded from scoring anyway; gating them would only make a validation rule
 * conditional on a value the validator does not have.
 *
 * A CONDITIONAL THAT GATES ON A NOW-GATED FIELD STILL RESOLVES CORRECTLY. `rack_units` gates on
 * `form_factor`, which this makes device-only; for a cable `form_factor` is `na`, so
 * `requirementFor` finds no required gate and `rack_units` is `na` too — not `pending`. That
 * cascade is what tests/pendingRequirement.test.ts pins.
 *
 * THE CALLER MUST FILL `kind`. A profile that gates on it while `values.kind` is absent marks every
 * requirement `na` in silence — see src/core/partKind.ts. tests/partKind.test.ts derives the
 * gating categories out of PROFILES and fails if one of them is not filled.
 */
/**
 * The categories whose profiles are gated on the GENERIC device/component axis. Kept here beside
 * `deviceOnly` because the two must name the same set: the wrapper handles the hand-written half
 * at declaration time and the loop after the merge handles the generated half. Neither alone is
 * enough — see the note at the merge.
 *
 * `switches` and `servers-unified-computing` are deliberately absent: they gate on their own axes,
 * which name module and machine kinds this one makes no claim about.
 */
// EMPTIED CATEGORY BY CATEGORY ON 12 Sep 2026. Each of these gained its OWN kind axis, whose kinds do not
// include the generic `device`, so this loop would have re-gated every `req` onto a kind no part of that
// category has — closing the question for all of them, in silence: wireless (wirelessKind), video (videoKind),
// unified-communications / collaboration-endpoints / conferencing (collabKind), servers and the two
// hyperconverged categories (ucsKind), routers (routerKind).
// optical-storage (12 Sep 2026): optical-networking and storage-networking left too, for opticalKind.ts and
// sanKind.ts. What remains is the categories that still have no axis of their own.
export const DEVICE_GATED_CATEGORIES = [
  // EMPTY as of 12 Sep 2026, and that is the end state, not an oversight: every category that was in this list
  // now gates on an axis of its own, and each left for the same reason — kept here, the post-merge loop would
  // re-gate its `req` keys onto a `device` kind that its axis never names, closing every one of them in silence.
  // The last two out were interfaces-modules and meraki. AXIS_GATED_CATEGORIES below is the safety net they all
  // still need: it catches a `req` that lives only in the GENERATED half, which is what this loop was for.
  // (The merge re-added nine of them from one agent's copy of the list; a list is the one conflict shape where
  // "keep both sides" is wrong, and this is why the resolution is read rather than trusted.)
  // modules-misc (12 Sep 2026): `interfaces-modules` and `meraki` LEFT this list. Each now gates on
  // an axis of its own (moduleKind, merakiKind) which names module and product-line kinds the
  // generic device/component axis makes no claim about — the same reason `switches` and
  // `servers-unified-computing` were never in it. AXIS_GATED_CATEGORIES below carries the
  // post-merge safety net they still need.
] as const;

/**
 * Categories gated on a CATEGORY-SPECIFIC axis, with the kinds that are the whole product.
 * modules-misc (12 Sep 2026).
 *
 * WHY THIS EXISTS AND IS NOT A COMMENT. A category that leaves DEVICE_GATED_CATEGORIES loses the
 * post-merge re-gate at the foot of this file, and that re-gate is the thing that catches a `req`
 * living only in the GENERATED half — which a hand edit cannot see and the next regeneration puts
 * back. Measured before the loop below was written: `meraki` had six generated `req` fields
 * (humidity_operating, mounting, psu_options, switching_capacity, temp_operating, weight) and
 * `data-center-networking` one (certifications). All seven ARE declared conditional in the curated
 * blocks above, and the curated half wins the merge — but a field that arrives in a FUTURE
 * regeneration would be required of every camera, sensor and rack kit with nothing to notice it.
 * The loop closes both halves at once, exactly as the generic one does.
 */
export const AXIS_GATED_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  // modules-r8 (12 Sep 2026): `fabric` JOINS the list — an MDS crossbar fabric module is a card in a
  // chassis slot, as much "the whole product" as an interface card, so a `req` that arrives in a
  // future regeneration should reach it. `mux` DELIBERATELY DOES NOT, for the same reason `optic`,
  // `cable` and `accessory` do not: a passive OADM has no electrical behaviour that a generated
  // switch-or-router field would describe, and its real profile is `optical-networking`'s.
  "interfaces-modules": ["interface", "fabric", "voice", "cellular", "radio", "service", "device"],
  meraki: ["unknown", "switch", "access-point", "appliance", "camera", "sensor", "gateway"],
  "data-center-networking": ["switch", "fex"],
};

const deviceOnly = <T extends Record<string, Requirement>>(block: T): T => {
  const out: Record<string, Requirement> = {};
  for (const [key, r] of Object.entries(block)) {
    out[key] = r.kind === "req" && !COLUMN_BACKED.has(key)
      ? cond({ field: "kind", inList: [...GENERIC_DEVICE] })
      : r;
  }
  return out as T;
};

// --- SECURITY PRODUCT SHAPES, 8 Sep 2026 -------------------------------------------------------
// `security` is not one kind of product. Its 6,689 hardware parts span 47 series — firewalls,
// intrusion-prevention appliances, email and web gateways, management consoles, flow-analytics
// boxes and identity servers — and the profile asked every one of them for `firewall_throughput`,
// `threat_throughput` and `concurrent_sessions`. An email gateway has no firewall throughput and
// never will, so for roughly 3,100 hardware parts three of the twelve required fields were
// unfillable by construction. Same defect as the licence profiles, one category over.
//
// The requirement is scoped by SERIES, which every part carries, so a cond can ask each shape only
// what it is bought on. The lists are verified against the live data by
// netzspec-parent/security-shapes.py, in BOTH directions: a series in no shape is reported, and a
// shape naming a series no part has is reported too — a cond whose list matches nothing fires for
// nobody and reads exactly like a rule nothing satisfies.
//
// A SERIES IN NO SHAPE IS THE DELIBERATE DEFAULT, not an oversight. The 13 unshaped series (531
// hardware parts — Secure Client, Fireamp Endpoints, Umbrella, XDR) are endpoint and cloud
// products with no appliance specification at all; they keep the universal fields every physical
// box has and are asked for nothing they cannot have. A new series appears the same way.
// SIX SERIES REMOVED 9 Sep 2026, each because it holds NO HARDWARE OF THAT SHAPE. Checked by
// listing the parts rather than by reasoning about the series name, after the licence
// reclassification had taken 762 rows out of `hardware`:
//
//   IOS SSL VPN                  10 "hardware", every one a FL-SSLVPN* FEATURE LICENCE
//                                ("Cisco SSLVPN Feature license - 100 users"). No firewall.
//   Secure DDoS Protection        2, both RD-CCX-*-LIC licences.
//   Security Cloud Control      164, every one a CDO-*-LIC ("SCC Firewall Device license").
//   Security Analytics + Logging 40, EA allocations and SAL-CL-* volume licences.
//   Secure Cloud Analytics       19, AWS/SELA cloud allocations.
//   ISE Passive Identity Conn.    1, "ISE PIC 3000 sessions and VM Common LICENSE".
//   Secure Access                15, SaaS.
//
// They are still classed `hardware` — the four safe name rules in productClass.ts do not reach
// them, because the patterns that would (\blicense\b, \blic\b) were measured against a
// fact-rich population and each caught real products. So removing them from the SHAPE lists is
// the change that is safe today; reclassifying them needs a signal nobody has yet.
//
// `ASA` IS KEPT, against the reviewer's recommendation. Its four hardware members are SSP-10,
// SSP-20, SSP-40 and SSP-60 — ASA 5585-X Security Services Processors, which are precisely the
// module a firewall throughput figure is quoted for. The value-shaped rows that made this series
// look wrong (200K/300K/500K/700K) are product_class=unknown and are not scored at all.
const SEC_FIREWALL = [
  "Firepower NGFW", "5500-X ASA with Firepower", "ASA 5500 Series Next Generation",
  "4100 Firepower", "Firepower 9300 Series", "Secure Firewall 1200 Series",
  "Firepower 1000 Series", "Secure Firewall 6100 Series", "2100 Firepower", "ASA",
  "200 Secure", "3000 Series Industrial Security Appliances (ISA)",
];
const SEC_IPS = ["FirePOWER 8000 Appliances", "FirePOWER 7000 Appliances", "NGIPS Virtual Appliance"];
const SEC_EMAIL = ["Email Security Appliance"];
const SEC_WEB = ["Secure Web Appliance", "Web Appliance Virtual"];
const SEC_MGMT = ["Security Manager", "Defense Center", "Firesight Management Center",
  "Secure Email and Web Manager"];
const SEC_ANALYTICS = ["Secure Network Analytics", "UDP Director", "Flow Sensor", "Cyber Vision"];
// ISE only. Its 112 hardware parts are real: SNS-3815/3855/3895/3715/3755/3795-K9, "Secure
// Network Server for ISE applications", carrying 7-8 facts each — the best-documented appliances
// in the category.
const SEC_IDENTITY = ["Identity Services Engine"];
/** Anything that terminates or inspects traffic in line. */
const SEC_INLINE = [...SEC_FIREWALL, ...SEC_IPS];
// "Secure Firewall 200 Series" joins "200 Secure" 12 Sep 2026. There is no such series in the live
// data — the two CSF220 appliances carry the mangled "200 Secure" — and the survey's repair proposal
// (evidence/security-servers-series-survey.md §b) is to relabel them to match their "1200" and "6100"
// siblings. That relabel is a database write and a PROPOSAL, not this; listing BOTH spellings means
// the requirement keeps firing whichever side of the rename the data is on. A series a shape names
// and no part carries is reported by netzspec-parent/security-shapes.py, so it cannot rot silently.
SEC_FIREWALL.push("Secure Firewall 200 Series");

// --- SECURITY BY KIND, 12 Sep 2026 (reviewer verdict on 678606c §4a-b) -------------------------
// The shape lists above are SERIES lists, and series is the wrong axis on its own: FPR3K-PSU-BLANK
// and FPR3105-NGFW-K9 both carry "4100 Firepower", so a blank slot cover was asked a firewall
// throughput and a session table. `securityKind` derives the shape from the SKU instead.
//
// THE TWO ARE COMBINED RATHER THAN SWAPPED. A SKU that names its shape wins, because series labels
// in this category are wrong often enough to matter (FMC1700-K9 sits in "4100 Firepower",
// FPR3105-NGFW-K9 in "Firepower 9300 Series", and 17 of the 83 hardware rows in "Email Security
// Appliance" are WSA or SMA boxes). Where the SKU names NO shape the kind is the deliberate
// `appliance` fallback, and only then does the series list decide — which is how the 30 remaining
// fallback rows (Threat Grid models, Secure Endpoint Private Cloud, Secure Workload clusters and
// the 1210CE/1210CP/1220CX datasheet MODEL rows that hold 61 of the category's facts) keep the
// requirements their series earns them.
//
// R1: both gates are answered by construction. `kind` is derived from the SKU for every part
// (partKind.ts) and `series` is a required, column-backed field.
const secShape = (kinds: readonly SecurityKind[], series: readonly string[]): Requirement =>
  cond({ any: [
    { field: "kind", inList: [...kinds] },
    { all: [{ field: "kind", inList: ["appliance"] }, { field: "series", inList: [...series] }] },
  ] });

// servers (12 Sep 2026) ------------------------------------------------------------------------------
// ONE QUESTION SET PER UCS KIND, shared by servers-unified-computing, hyperconverged-systems and
// hyperconverged-infrastructure (all three derive `kind` with ucsKind, see partKind.ts). Every gate is
// the derived kind or a REQUIRED field (R1): `rack_units` waits on `form_factor`, which every machine
// is asked. Evidence per cup (labels, facts, fill path) is in runs/reports/schema-servers-2026-09-12.md
// and data/ledger/cisco-<category>.json.
//
//   machine (server, chassis, fabric-interconnect) — the physical envelope and environment. temp_storage
//     and altitude_max ADDED: every UCS datasheet states them ("Nonoperating temperature", "Altitude"),
//     431 and 335 label occurrences, and 285 / 277 series-level facts already sit on these parts.
//   server — processor, max DIMM speed, drive bays (33 own facts, "Drive bays" rows in spec sheets).
//   fabric-interconnect — its ports and switching capacity ("Throughput"), like any switch.
//   io-module — an IOM/IFM is a card: its ports and which chassis takes it.
//   cpu — TDP (1,823 facts), base clock, cores, last-level cache, max DIMM speed: the five columns of
//     every Cisco processor table. NOT power_max: on 1,571 CPUs power_max holds the same number as
//     tdp (both mined from "…/105W 14C/…"), one quantity in two cups — see PROPOSALS.
//   memory — capacity (`dram`, 152 facts) and speed (memory_speed_max).
//   drive — capacity (storage_capacity, 987 facts; NOT storage_raw_capacity, which was asked of drives
//     until today while holding 0 drive facts — it is a storage SERVER's aggregate, 29 facts, all on
//     S-Series servers) and interface (drive_interface).
//   psu — rated output and input voltage, exactly the switches PSU set.
//   gpu — board power (power_max: a GPU draws it, "AMD Instinct MI210: 300W").
//   every component — what it fits (product_compatibility), the switches rule (§1.1).
//   bundle / os-license / software / non-product / unknown — asked nothing (R3 and the fallback).
const UCS_BOX_K = [...UCS_MACHINE] as string[];
const UCS_PART_K = [...UCS_COMPONENT] as string[];
const ucsK = (...kinds: string[]): Requirement => cond({ field: "kind", inList: kinds });
const ucsCups = (): Record<string, Requirement> => ({
  form_factor: ucsK(...UCS_BOX_K),
  rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
  dimensions: ucsK(...UCS_BOX_K), weight: ucsK(...UCS_BOX_K),
  power_max: ucsK(...UCS_BOX_K, "gpu"),
  temp_operating: ucsK(...UCS_BOX_K), temp_storage: ucsK(...UCS_BOX_K),
  humidity_operating: ucsK(...UCS_BOX_K), altitude_max: ucsK(...UCS_BOX_K),
  certifications: ucsK(...UCS_BOX_K),
  cpu: ucsK("server"), drive_bays: ucsK("server"),
  // round-6 B6: the two sizing cups a server is actually bought on, required of `server` in all
  // three UCS categories (and of collab/conferencing `server` through their own profiles).
  // `memory_max` has the evidence (84 label occurrences); `cpu_sockets_max` has the DATA (246 own
  // facts). `dimm_slots` and `pcie_slots` are declared and optional, with their counts in the
  // dictionary comment -- four label occurrences and eighteen prose ones are not a basis for
  // 1,555 required gaps.
  memory_max: ucsK("server"), cpu_sockets_max: ucsK("server"),
  dimm_slots: opt, pcie_slots: opt,
  memory_speed_max: ucsK("server", "cpu", "memory"),
  ports: ucsK("fabric-interconnect", "io-module", "nic"),
  switching_capacity: ucsK("fabric-interconnect"),
  tdp: ucsK("cpu"), clock_speed: ucsK("cpu"), cpu_cores: ucsK("cpu"), cpu_cache: ucsK("cpu"),
  dram: ucsK("memory"),
  storage_capacity: ucsK("drive"), drive_interface: ucsK("drive"),
  psu_rated_output: ucsK("psu"), input_voltage: ucsK("psu"),
  product_compatibility: ucsK(...UCS_PART_K),
  // Declared, never required. cpu_sockets: 0 facts anywhere, 0 labels (demoted 10 Sep 2026, unchanged).
  // storage_raw_capacity: a storage server's aggregate (S3260 "784 TB"), 29 facts, kind-unscoped.
  // cpu_sockets is now SUPERSEDED into cpu_sockets_max (see SUPERSEDED_KEYS) and must not be
  // declared by a profile -- tests/oneCupPerQuantity.test.ts refuses that.
  storage_raw_capacity: opt, cpu_boost_clock: opt,
  dimm_ranks: opt, dimm_voltage: opt, data_rate: opt, gpu_max: opt, pcie_card_size: opt,
  slot_compatibility: opt, psu_options: opt, psu_efficiency: opt, heat_dissipation: opt,
  humidity_storage: opt, altitude_storage: opt, hypervisor: opt, management_mode: opt,
  module_slots: opt, cpu_interconnect_links: opt, workload_segment: opt,
  // DEMOTED in the two hyperconverged categories, where the generated profile made them `req` (and the
  // device loop gated them to `device`, i.e. every CPU and DIMM). Optional here as in switches, the READY
  // profile: 0 own facts in all three categories (every value is inherited from a series document), and
  // the Safety/EMC/EMI rows they come from are already read into `certifications` (751 label occurrences).
  emc_emissions: opt, emc_immunity: opt,
});
/** R2 inside these three categories: second cups for a quantity that already has one. Removed from the
 *  three profiles after the generated merge (below); the global SUPERSEDED_KEYS entry is a PROPOSAL
 *  because it would also rewrite the switches profile (both are optional there) and its frozen ledger. */
const UCS_R2_DUPLICATES: Readonly<Record<string, string>> = {
  cache_l3: "cpu_cache",            // "L3 Cache" MB vs "CPU cache" MB — 31 facts vs 333 in these categories
  cpu_base_clock: "clock_speed",    // "CPU Base Clock Frequency" GHz vs "Base Clock Frequency" GHz — 63 vs 298
};
export const UCS_PROFILE_CATEGORIES = ["servers-unified-computing", "hyperconverged-systems", "hyperconverged-infrastructure"] as const;
// end servers (12 Sep 2026) --------------------------------------------------------------------------

// collab (12 Sep 2026) ---------------------------------------------------------------------------------------
// ONE KIND-GATED BLOCK FOR THE THREE COLLABORATION CATEGORIES (src/core/collabKind.ts). The axis is shared, so
// the block is too: a phone filed in unified-communications is asked exactly what a phone in
// collaboration-endpoints is asked. Every gate is on `kind` — derived from the SKU, always answered — never on
// an optional fact (R1). Before this, every "device" in both categories was asked one flat set: a headset owed a
// display, video codecs and a PoE standard; a microphone owed a display; a phone owed video codecs.
//
// FILLABILITY DECIDED EVERY `req` (check 5). Evidence per cup, measured 12 Sep 2026 over the 23,651-label
// cisco-datasheets inventory (mapLabel, current rules; an upper bound — the inventory is not per category) and
// the store (Cisco hardware in the three categories, live facts): see runs/reports/schema-collab-2026-09-12.md.
// A cup with no label and no fact is declared OPTIONAL with its counts beside it, never required.
const cK = (kinds: readonly string[]): Requirement => cond({ field: "kind", inList: [...kinds] });
const collabBlock = (): Record<string, Requirement> => ({
  vendor: req, series: req,
  // --- the envelope of anything with its own specification sheet ----------------------------------------
  // dimensions / weight: 0 facts in the three categories, but Cisco prints both on every phone, headset, camera
  // and room-device sheet, and "Dimensions"/"Weight" map in the inventory (the ledger records the counts).
  dimensions: cK(COLLAB_ENDPOINT), weight: cK(COLLAB_ENDPOINT),
  // environment: 332 / 378 / 318 phones and headsets hold temp_operating / humidity_operating / temp_storage.
  temp_operating: cK(COLLAB_ENDPOINT), humidity_operating: cK(COLLAB_ENDPOINT), temp_storage: cK(COLLAB_ENDPOINT),
  certifications: cK(COLLAB_ENDPOINT),
  // Mains-powered boxes only. A phone, a DECT base and a touch panel are powered over Ethernet and are asked
  // their PoE standard instead; a headset, a microphone and a camera draw from the device they plug into.
  // Every endpoint that draws its own power ("Power consumption" 170 mapped). NOT a headset, a microphone or a
  // key expansion module: they draw from the host they plug into, and their draw is part of the host's figure.
  power_max: cK(["phone", "dect-base", "video-device", "video-codec", "camera", "speaker", "touch-panel", "display", "gateway", "ata", "server"]),
  // PoE-powered endpoints ("PoE Support" 13 aliased today; 9 mapped). A speaker is NOT gated in: the IX5000 and
  // MX speakers are amplifier-fed while the Atlas IP speakers are PoE+, so the kind cannot answer it (report).
  poe_standard: cK(["phone", "dect-base", "touch-panel"]),
  // Racked boxes only; a phone has no form factor in this domain (rack-19 / desktop / din-rail / chassis).
  form_factor: cK(["gateway", "server"]),
  rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
  // round-6 B6, all five categories as the reviewer decided (12 Sep 2026). A UC or Meeting Server
  // application server is a UCS C-series box, and the two sizing cups it is bought on are the same
  // two a UCS server now owes. The named exceptions in tests/cupLedger.test.ts called whether these
  // servers "should owe the UCS cups" an open question; this closes that question for these two cups
  // and leaves the exception in place for the rest (cpu, drive_bays, memory_speed_max still differ).
  // Document evidence, measured: unified-communications 77 servers with 6 spec-bearing, conferencing
  // 22 with 4 — thin, and no thinner than servers-unified-computing itself (9.8%), where the same two
  // cups are required. A gap that can be named beats a question nobody asks.
  memory_max: cK(["server"]), cpu_sockets_max: cK(["server"]),
  // --- calling ------------------------------------------------------------------------------------------
  // supported_protocols: 347 facts (SIP, H.323 ... on phones). ui_languages: 323 facts (phone firmware).
  supported_protocols: cK([...COLLAB_CALLING, "dect-base"]),
  ui_languages: cK(["phone", ...COLLAB_VIDEO]),
  // audio codecs: 80 facts; "Audio codec support" 10 mapped, and "Codecs"/"Codec support" (13) aliased today.
  audio_codecs: cK([...COLLAB_CALLING]),
  // the network ports a phone, a room device or a gateway carries (LAN + PC port, codec Ethernet)
  ports: cK(["phone", "dect-base", ...COLLAB_VIDEO, "gateway", "ata"]),
  // --- screens ------------------------------------------------------------------------------------------
  // "Display" 39 + "Graphical display" 19 + "Hardware Features: Graphical display" 7 map; the samples are phone,
  // Room Navigator and Touch 10 sheets. A codec, a bar and a kit drive external screens and have none.
  display: cK(COLLAB_SCREEN),
  // lines a phone registers — 6 facts, "Voice Lines" 6 mapped. Band in BAND_OVERRIDES.
  voice_lines: cK(["phone"]),
  // --- video --------------------------------------------------------------------------------------------
  // "Video standards" 27 mapped (CE software sheets), "Video standards supported" 6 aliased today.
  video_codecs: cK(COLLAB_VIDEO),
  // "Resolution" 5 mapped (Room Navigator / Touch 10), "Video resolution" 12 aliased today (collab-scoped).
  max_resolution: cK([...COLLAB_VIDEO, "camera", "touch-panel"]),
  // --- cameras --------------------------------------------------------------------------------------------
  // A camera is bought on resolution, zoom and field of view: "Field of view" 16 mapped, "Zoom" 8 aliased today.
  camera_zoom: cK(["camera"]), field_of_view: cK(["camera"]),
  camera_pan_tilt_range: opt,            // 0 labels, 0 facts — a PTZ-only figure; declared, not required
  // --- audio ----------------------------------------------------------------------------------------------
  // mic_type: "Microphone type" 6, aliased today; the samples are headset sheets (950 earbuds), so it is asked
  // of a headset. A table or ceiling microphone's type is not in the inventory at all:
  // Gated on microphones too: a cond that excludes a kind makes the cup `na` for it, and a microphone's type is
  // never not-applicable. The label evidence is headset sheets only (Table / Ceiling Mic Pro sheets not held).
  mic_type: cK(["headset", "microphone"]),
  mic_pickup_range: opt,                 // 0 labels, 0 facts (Table Mic Pro / Ceiling Mic Pro sheets not held)
  mic_frequency_response: opt,           // "Microphone frequency response" 6, headset sheets — aliased, optional
  speaker_frequency_response: opt,       // "Speaker bandwidth" 5, headset sheets — aliased, optional
  speaker_impedance: opt, speaker_size: opt, // "Speaker impedance" 6 / "Speaker size" 6 — aliased, optional
  // --- voice gateways and adapters ----------------------------------------------------------------------
  // FXS is what an analog gateway or ATA is bought on: 10 facts (VG 2..144). FXO is NOT universal (VG350 is
  // FXS-only; 6 facts, one stores 0) and a gate on it would be a gate on an optional fact — it stays optional.
  fxs_ports: cK(["gateway", "ata"]), fxo_ports: opt,
  // --- what a part fits --------------------------------------------------------------------------------
  // A voice card, a server CPU, a PSU, a key expansion module: bought for its host. "Product compatibility" 92,
  // "Chassis compatibility" 36, "Chassis support" 23 map (switch and optical sheets — an upper bound here).
  // 12 Sep 2026 (reviewer §2.3): the ACCESSORY and the misfiled transceiver join COLLAB_FITS here. Both were asked
  // nothing — 642 accessories in collaboration-endpoints, 42 in UC, 1 in conferencing, 8 optics — which scores
  // every one of them complete. What a mount, a bracket, a stand or a cable fits is the one thing it is bought on.
  product_compatibility: cK([...COLLAB_FITS, "accessory", "transceiver", ...COLLAB_CABLE]),
  psu_rated_output: cK(["power-supply"]),
  cable_length: cK(COLLAB_CABLE), plug_type: opt,
  // declared, not required — no label, or only another category's
  video_inputs: opt, video_outputs: opt, keys_buttons: opt, headset_support: opt, handset: opt, touchscreen: opt,
  bluetooth_version: opt, call_control: opt, cucm_versions: opt, mounting: opt, altitude_max: opt,
  input_voltage: opt, cpu: opt, storage_raw_capacity: opt, psu_config: opt, content_share_resolution: opt,
  license_type: opt, license_for: opt,
});
// end collab --------------------------------------------------------------------------------------------------

export const PROFILES: Record<string, Record<string, Requirement>> = {
  // --- SOFTWARE AND LICENCE CATEGORIES, added 8 Sep 2026 ---------------------------------------
  // These four held 3,704 parts and were ABSENT from PROFILES entirely, so every one of their
  // parts was `no_profile` and counted in the dashboard's "cannot be judged" headline — 30,898
  // parts, of which the great majority were licences nobody could ever specify.
  //
  // Measured product_class for each, which is what settles that these are not hardware:
  //   contact-center           2,204 parts   0 hardware   (1,792 software + 412 licence)
  //   software                   819 parts   4 hardware   (451 licence + 364 software)
  //   customer-collaboration     469 parts   0 hardware   (453 software)
  //   data-center-analytics      212 parts   7 hardware   (205 software)
  //
  // So the profile says what a licence IS bought on, and marks the hardware questions `na` rather
  // than optional. `na` is the difference between "we have not found the operating temperature of
  // this subscription yet" and "a subscription does not have one" — the first sends a crawler
  // after it for ever, the second closes the gap.
  //
  // CORRECTED THE SAME DAY, AND THE CORRECTION IS THE INTERESTING PART. The paragraph above is
  // right about licences and wrong about who reads it. `recompute-completeness` gives every
  // non-hardware part `no_profile = true` and ZERO required fields BEFORE it ever looks up a
  // profile — so not one of the 13,056 licences these four blocks were written for is scored
  // against them. The only parts that reach them are the hardware sitting in the same category:
  //
  //     conferencing 343 · ios-nx-os-software 80 · cloud-systems-management 12
  //     data-center-analytics 7 · software 4                       = 446 hardware parts
  //
  // Every declaration was therefore backwards in effect. Those 446 were required to state a
  // `license_type`, and told — by the 48 `na` marks — that a real endpoint has no operating
  // temperature, no weight and no dimensions. `na` closes a gap permanently, so it was closing
  // the gaps of the only parts that could still have filled them.
  //
  // The fix keeps the licence fields DECLARED (a licence page renders them) and demotes them to
  // `opt`, and returns the hardware questions to `opt` for the same reason. Requirements here are
  // earned by promote-required from the hardware's own evidence, like everywhere else. `vendor`
  // and `series` stay `req`: they are true of every part in the catalogue.
  //
  // The lesson is the file's own: a profile is not read by the parts you wrote it for, it is read
  // by whatever the scorer hands it. Check which parts actually reach a rule before tuning it.
  "contact-center": {
    vendor: req, series: req,
    // DECLARED, NOT REQUIRED. The schema says these fields APPLY to a licence; it does not
    // assert we can source them. Marking them  created twelve gaps no enabled source
    // can close — the exact "required field nothing can fill" defect, and the suite refused
    // it. They become  through promote-required when the corpus earns it, like every
    // other required field in this file.
    license_type: opt, license_for: opt, license_term: opt,
    license_seats: opt, delivery_method: opt, support_level: opt,
    supported_os: opt, languages_supported: opt, regions_supported: opt,
    // a licence has no body: these are closed gaps, not open ones
    // The hardware questions, back to `opt`: the parts that reach this profile ARE
    // hardware, so they have a weight and an operating temperature.
    ports: opt, uplink_ports: opt, dimensions: opt, weight: opt, rack_units: opt,
    temp_operating: opt, temp_storage: opt, humidity_operating: opt, power_max: opt,
    poe_standard: opt, form_factor: opt, certifications: opt,
  },
  software: {
    vendor: req, series: req,
    // DECLARED, NOT REQUIRED. The schema says these fields APPLY to a licence; it does not
    // assert we can source them. Marking them  created twelve gaps no enabled source
    // can close — the exact "required field nothing can fill" defect, and the suite refused
    // it. They become  through promote-required when the corpus earns it, like every
    // other required field in this file.
    license_type: opt, license_for: opt, license_term: opt,
    license_seats: opt, delivery_method: opt, support_level: opt,
    supported_os: opt, hypervisor_support: opt, languages_supported: opt,
    // The hardware questions, back to `opt`: the parts that reach this profile ARE
    // hardware, so they have a weight and an operating temperature.
    ports: opt, uplink_ports: opt, dimensions: opt, weight: opt, rack_units: opt,
    temp_operating: opt, temp_storage: opt, humidity_operating: opt, power_max: opt,
    poe_standard: opt, form_factor: opt, certifications: opt,
  },
  "customer-collaboration": {
    vendor: req, series: req,
    // DECLARED, NOT REQUIRED. The schema says these fields APPLY to a licence; it does not
    // assert we can source them. Marking them  created twelve gaps no enabled source
    // can close — the exact "required field nothing can fill" defect, and the suite refused
    // it. They become  through promote-required when the corpus earns it, like every
    // other required field in this file.
    license_type: opt, license_for: opt, license_term: opt,
    license_seats: opt, delivery_method: opt, support_level: opt,
    supported_os: opt, languages_supported: opt, regions_supported: opt,
    // The hardware questions, back to `opt`: the parts that reach this profile ARE
    // hardware, so they have a weight and an operating temperature.
    ports: opt, uplink_ports: opt, dimensions: opt, weight: opt, rack_units: opt,
    temp_operating: opt, temp_storage: opt, humidity_operating: opt, power_max: opt,
    poe_standard: opt, form_factor: opt, certifications: opt,
  },
  "data-center-analytics": {
    vendor: req, series: req,
    // DECLARED, NOT REQUIRED. The schema says these fields APPLY to a licence; it does not
    // assert we can source them. Marking them  created twelve gaps no enabled source
    // can close — the exact "required field nothing can fill" defect, and the suite refused
    // it. They become  through promote-required when the corpus earns it, like every
    // other required field in this file.
    license_type: opt, license_for: opt, license_term: opt,
    license_seats: opt, delivery_method: opt, support_level: opt,
    supported_os: opt, hypervisor_support: opt,
    // The hardware questions, back to `opt`: the parts that reach this profile ARE
    // hardware, so they have a weight and an operating temperature.
    ports: opt, uplink_ports: opt, dimensions: opt, weight: opt, rack_units: opt,
    temp_operating: opt, temp_storage: opt, humidity_operating: opt, power_max: opt,
    poe_standard: opt, form_factor: opt, certifications: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // SHAPES 9 Sep 2026 — gated on KIND, derived from the SKU, not on series.
  //
  // This category asked 13 required fields of all 12,541 hardware parts, and SIX of them were
  // present on ZERO parts: dimensions, weight, form_factor, rack_units, psu_rated_output,
  // cpu_sockets. At most 613 of the 12,541 are machines; the rest are CPUs, DIMMs, drives, risers,
  // rails, cables and OS licences, every one asked for a rack height.
  //
  // SERIES IS THE WRONG GATE HERE, unlike `security`. 19 series over 12,541 parts and "UCS
  // C-Series" alone holds 6,516, so a series names a product LINE: gating on it asks a C-Series
  // DIMM exactly what it asks a C-Series rack server. The kind comes from the SKU token instead
  // (src/core/ucsKind.ts) — measured clean, zero tokens carrying both physical and component facts
  // once inherited facts are excluded.
  //
  // THE PHYSICAL FIELDS ARE REQUIRED OF MACHINES AND `na` FOR COMPONENTS. Cisco publishes no weight
  // or operating temperature for a DIMM, so requiring one is a gap nothing can close. It publishes
  // them for every server: 80 spec-bearing documents (44 HTML, 36 PDF) are in the corpus for this
  // category, so the six all-zero fields are an EXTRACTION gap, not an acquisition one, and an open
  // gap on a machine points at real work rather than at nobody.
  //
  // `unknown` kind — 21.6% of the category, the residue the SKU rules do not name — is asked
  // NOTHING it might not have, the same default `security` uses for an unshaped series. A rule that
  // guesses is how a component ends up behind a machine's profile, which is the defect being fixed.
  "servers-unified-computing": {
    // servers (12 Sep 2026): the per-kind question set is ucsCups() — see the note above PROFILES.
    // The lines below this spread are the 9-10 Sep history, kept for its reasoning; every key they
    // name is overridden by the spread that follows them.
    ...ucsCups(),
    // rack units only where the form factor says it is racked — and `pending` while form_factor
    // is unanswered, so it stays an open gap rather than being closed on a value nobody has read.
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    // a server is bought on its socket count; a CPU is not
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' mgmt_ports and stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 1,265 slots here, 1,599 in hyperconverged-systems, 960 in hyperconverged-infrastructure.
    cpu_sockets: opt,
    // `cpu` came from the GENERATED profile as a bare `req` and the curated block did not name it,
    // so it survived the merge and was required of 8,794 parts — cables, GPUs and rails among
    // them. A generated requirement is only invisible until something counts it.
    // (cpu, psu_rated_output, memory_speed_max and the drive's capacity come from ucsCups() above.
    // servers 12 Sep 2026: the drive line that stood here asked `storage_raw_capacity` — 0 drive facts —
    // while 987 drive capacities sat in `storage_capacity`; the cup with the data was not on the table.)
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, oversubscription_ratio: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  },

  // --- video (12 Sep 2026) ---------------------------------------------------------------------------------
  // SHAPED BY KIND (src/core/videoKind.ts). `video` is cable-access plant, not conferencing: until today every
  // "device" here owed `video_codecs` and `max_resolution` — a question no GS7000 node, Prisma optic, cBR-8 or
  // RF Gateway can answer — plus `form_factor`, whose domain (rack-19 / desktop / din-rail / modular-chassis)
  // has no value for a strand-mounted node, and `standard`, which in this category holds the WDM GRID
  // (DWDM / CWDM / iWDM, 690 description-mined facts) and was asked of every box. All four are now opt, except
  // `standard` for the one kind it describes: a passive is bought on its grid.
  //
  // PER KIND, what Cisco's own sheets state and a source can fill (evidence per cup in the 12 Sep report):
  //   node         rf_gain ("Operational gain (minimum)", 6 labels), power_max, temp_operating,
  //                humidity_operating, dimensions ("Housing Dimensions"), weight — GS7000 node sheets
  //   chassis,     power_max, temp_operating, humidity_operating, dimensions, weight, certifications — the RF
  //   system       Gateway sheets fill temperature/humidity/certifications today (71 / 69 / 27 facts)
  //   transmitter, wavelength (318 facts, "Nominal optical output wavelength"), tx_power (400 facts,
  //   optic        "Optical output power")
  //   receiver     input_power_range ("Optical input range", 5 labels)
  //   amplifier    tx_power ("Output Power (maximum)"), input_power_range ("Input Power"),
  //                rx_wavelength ("Input Wavelength") — the EDFA sheet
  //   rf-amplifier rf_gain
  //   passive      standard (the grid), insertion_loss_max ("Insertion loss (maximum) ...", aliased today)
  //   power        input_voltage (20 facts, description-mined)
  //   line-card, plug-in, fan, cable, accessory, software, unknown: nothing required (see the report —
  //   no video sheet states a per-card or per-plug-in figure a source maps; `unknown` asks less by design).
  //
  // DECLARED OPTIONAL, WITH THE REASON, so nobody promotes them without it:
  //   passband, rf_output_level, gain, noise_figure — typed STRING by the generated dictionary (a range like
  //       "105-1002" MHz), with no band. Retyping is a global change to keys twelve generated profiles
  //       declare; proposed in the report, not done here. Until then a required string quantity with no band
  //       fails check 4.
  //   connector — the domain has no FC and no polish: SC/APC and SC/UPC both store "sc", and FC/APC is
  //       refused, while APC/UPC/FC is exactly what separates GS7K-TXAH-1470SA from -SU and -FC. Required, the
  //       FC variants would own slots the normaliser refuses. Proposal in the report.
  //   itu_channel — the grid LABEL of `wavelength` on a transmitter (ITU 26 = 1556.55 nm); asked once, as
  //       the wavelength. On a passive it is the channel LIST, which no numeric key can hold.
  //   module_slots, rack_units — 0 labels in the 88 video documents and 0 facts.
  //   cable_length, product_compatibility — 0 video labels, 0 video facts; the switches evidence is switch SKUs.
  video: {
    vendor: req, series: req,
    rf_gain: cond({ field: "kind", inList: ["node", "rf-amplifier"] satisfies VideoKind[] }),
    power_max: cond({ field: "kind", inList: [...VIDEO_BOX] }),
    temp_operating: cond({ field: "kind", inList: [...VIDEO_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...VIDEO_BOX] }),
    dimensions: cond({ field: "kind", inList: [...VIDEO_BOX] }),
    weight: cond({ field: "kind", inList: [...VIDEO_BOX] }),
    certifications: cond({ field: "kind", inList: ["chassis", "system"] satisfies VideoKind[] }),
    wavelength: cond({ field: "kind", inList: [...VIDEO_EMITTER] }),
    tx_power: cond({ field: "kind", inList: [...VIDEO_EMITTER, "amplifier"] }),
    input_power_range: cond({ field: "kind", inList: ["receiver", "amplifier"] satisfies VideoKind[] }),
    rx_wavelength: cond({ field: "kind", inList: ["amplifier"] satisfies VideoKind[] }),
    standard: cond({ field: "kind", inList: ["passive"] satisfies VideoKind[] }),
    insertion_loss_max: cond({ field: "kind", inList: ["passive"] satisfies VideoKind[] }),
    input_voltage: cond({ field: "kind", inList: ["power"] satisfies VideoKind[] }),
    // the conferencing and switch-shaped questions this category was asked, now optional (see above)
    video_codecs: opt, max_resolution: opt, form_factor: opt,
    passband: opt, rf_output_level: opt, gain: opt, noise_figure: opt, connector: opt, itu_channel: opt,
    rf_input_level: opt, modulation_type: opt, laser_type: opt, tuning_range: opt, total_output_power: opt,
    // 12 Sep 2026 (reviewer §2.3, and the asked-nothing census): a line card (95), a plug-in (177), a fan (10),
    // a cable (56) and an accessory (85) were asked NOTHING, so all 423 scored complete. What each one fits is
    // the question a cable-plant part is bought on — a GS7000 plug-in is ordered for a housing, a line card for
    // a shelf — and a cable also owes its length. The values a plug-in and a line card carry (pad attenuation,
    // equaliser value) have no cup yet and no label: that is in the report as an open question, not invented here.
    product_compatibility: cond({ field: "kind", inList: ["line-card", "plug-in", "fan", "cable", "accessory", "power"] }),
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    module_slots: opt, rack_units: opt,
    // 12 Sep 2026: a video power supply owes what it delivers, like every other category power kind.
    psu_rated_output: cond({ field: "kind", inList: ["power"] satisfies VideoKind[] }),
    airflow: cond({ field: "kind", inList: ["power", "fan"] satisfies VideoKind[] }),
    temp_storage: opt, frequency_response: opt, test_point_level: opt, internal_tilt: opt, channel_spacing: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
  },
  // --- end video (12 Sep 2026) -----------------------------------------------------------------------------

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // collab (12 Sep 2026): kind-gated by collabBlock() — was deviceOnly(), which asked a headset a display.
  "unified-communications": {
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    qos_features: opt, module_slots: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
    // LAST, so the kind gates win over the 8 Sep `opt` lists above (camera_zoom and mic_type are in both).
    ...collabBlock(),
    // The GENERATED profile's one `req` ("promoted 2026-09-04", 32 of 44 parts), named so this block governs it.
    certifications: cK(COLLAB_ENDPOINT),
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // servers (12 Sep 2026): gated on the UCS kind (partKind -> ucsKind), no longer deviceOnly. The flat
  // block that stood here asked all 1,599 "device" parts — CPUs, DIMMs, SSDs, VICs — for a weight, a rack
  // height and a raw storage capacity; memory_speed_max and storage_raw_capacity were `req` of a fan.
  "hyperconverged-systems": {
    ...ucsCups(),
    cpu_sockets: opt,  // unreachable — see the note in servers-unified-computing
    // STRUCTURE 8 Sep 2026: 3 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, hypervisor: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // servers (12 Sep 2026): gated on the UCS kind, like hyperconverged-systems above.
  "hyperconverged-infrastructure": {
    ...ucsCups(),
    cpu_sockets: opt,  // unreachable — see the note in servers-unified-computing
    // STRUCTURE 8 Sep 2026: 7 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, altitude_storage: opt, management_mode: opt, deploy_role: opt, max_wlans: opt, operating_system: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // collab (12 Sep 2026): kind-gated by collabBlock() — was deviceOnly(), which asked a headset a display, video
  // codecs and a PoE standard, and a microphone the same set as a Board Pro.
  "collaboration-endpoints": {
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
    // LAST, so the kind gates win over the `opt` list above.
    ...collabBlock(),
    // The GENERATED profile's five `req`, NAMED here so the curated block governs them (tests/profileMerge): the
    // same kind gates collabBlock() gives them — restated, not changed.
    temp_operating: cK(COLLAB_ENDPOINT), humidity_operating: cK(COLLAB_ENDPOINT), temp_storage: cK(COLLAB_ENDPOINT),
    supported_protocols: cK([...COLLAB_CALLING, "dect-base"]), ui_languages: cK(["phone", ...COLLAB_VIDEO]),
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // --- modules-misc (12 Sep 2026): SHAPED BY `switchKind`, REUSED RATHER THAN RE-DERIVED --------
  // 33 Cisco hardware parts: 20 Nexus Hyperfabric switches (HF6100-32D / -60L4D / -64ED and their
  // -D/-S hardware-only variants) and 13 of their supplies, fans and rack kits. It was a FLAT
  // profile — no `deviceOnly` wrapper at all, so every one of the 33 was asked all nine fields,
  // and a `PWR-C6-BLANK` power-supply blank cover was asked a switching capacity.
  //
  // WHY NO NEW AXIS. Every one of switchKind's markers lands correctly on all 33, checked part by
  // part (the list is in partKind.ts, including the `PSU1.4KW` token the investigation pass asked
  // about). Writing a second classifier for 33 parts would be a second place for the same rules to
  // drift; the kinds it produces are switch 20, accessory 5, power 5, fan 3.
  //
  // THE ONE CUP THAT DID NOT SURVIVE THE CHECK IS NOT DEMOTED BUT NAMED: `certifications` is a
  // generated `req` here and holds 0 facts of 33. It stays required of SW_BOX — a switch in a data
  // centre has safety certifications and Cisco prints them; 55 parts in `interfaces-modules` and
  // hundreds in `switches` hold the key — so this is coverage, not shape.
  "data-center-networking": {
    // true of every part in the catalogue (modules-misc, 12 Sep 2026)
    vendor: req, series: req,
    // SW_BOX = switch + fabric extender: the box you rack and power.
    dimensions: cond({ field: "kind", inList: [...SW_BOX] }),
    weight: cond({ field: "kind", inList: [...SW_BOX] }),
    form_factor: cond({ field: "kind", inList: [...SW_BOX] }),
    temp_operating: cond({ field: "kind", inList: [...SW_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...SW_BOX] }),
    certifications: cond({ field: "kind", inList: [...SW_BOX] }),
    // + linecard, as in `switches`: a card in a chassis slot draws its own power. A PSU DELIVERS.
    power_max: cond({ field: "kind", inList: [...SW_BOX, "linecard"] }),
    ports: cond({ field: "kind", inList: [...SW_DEVICE, "fex", "linecard", "module"] }),
    switching_capacity: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    // WHAT IT FITS — asked of the five rack kits, the five supplies and the three fans, and of
    // nothing until today. HF-ACC-RM2-4P19L is a 19" 4-post kit and its only real question is
    // which chassis it takes.
    product_compatibility: cond({ field: "kind", inList: [...SW_COMPONENT] }),
    // 1450 W and 1500 W and 3000 W, each stated in the supply's own name; `psu_output_rating`
    // ("Main output: 12V 125A Standby output: 3.3V 4A") is a different quantity and stays optional.
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    input_voltage: cond({ field: "kind", inList: [...SW_BOX, "power"] }),
    psu_output_rating: opt, input_current: opt, holdup_time: opt, power_input_connector: opt,
    // Airflow is how a fan and a data-centre supply are sold, and this category is the clearest
    // case in the catalogue: C9500X-FAN-1U-F and -R are the same fan in opposite directions, and
    // PSU1.4KW-ACPE / -ACPI the same supply. 137 label occurrences.
    airflow: cond({ field: "kind", inList: ["fan", "power", "fex"] }),
    cable_length: cond({ field: "kind", inList: [...SW_CABLE] }),
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_cord_rating: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, network_technology: opt, oversubscription_ratio: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // --- modules-misc (12 Sep 2026): SHAPED BY `merakiKind` --------------------------------------
  // It was `deviceOnly`, so all 283 hardware parts were asked the same nine fields: an MT11
  // temperature probe a port count and a PoE standard, an MV camera a PoE standard, an MGKIT-1
  // mounting kit all nine. The SKU letter is a clean and total axis and it partitions the
  // QUESTIONS, not merely the SKUs — see merakiKind.ts for the per-line fact table.
  //
  // WHAT EACH KIND IS ASKED (facts held / parts):
  //   switch       109  ports · switching_capacity 58 · poe_standard 9 -> poe_budget 37 · form_factor
  //   camera        52  field_of_view 11 · video_quality_max 9 · image_sensor 9 · storage_capacity 10
  //   gateway       38  cellular_bands · ports
  //   access-point  36  wifi_generation 3 · ports
  //   appliance     26  firewall_throughput 8 · ports
  //   sensor        16  battery_life 6 — and NO ports, NO PoE, NO power figure
  //   unknown        5  MCS1-MCS6: the envelope only (dimensions, weight, temps, mounting)
  //   accessory      1  product_compatibility only
  //
  // THREE CUPS CHANGED SHAPE, WITH THEIR COUNTS:
  //   certifications  DEMOTED to opt. 0 of 283, and the Meraki source does not publish it: its
  //                   label inventory carries `safety_standards` and `emc_emissions` instead (both
  //                   declared below). Required, it was 283 gaps no enabled source can close.
  //   form_factor     required of `switch` ONLY. The enum domain is rack-19 / desktop / din-rail /
  //                   modular-chassis; an MR access point, an MV camera and an MT sensor are none
  //                   of those, and 0 of 283 hold a value. `mounting` is the cup that fits them —
  //                   80 facts ("Desktop Integrated Wall mount"), and it IS one of the seven keys
  //                   the Meraki inventory publishes — so it is required of every box instead.
  //   ports           kept required of the four ported kinds although 0 of 283 hold it, because
  //                   the Meraki source publishes the BREAKDOWN rather than the total:
  //                   copper_ethernet_ports 48, sfp_plus_ports 33, sfp_ports 28, mgig_rj45_ports 9,
  //                   qsfp_plus_ports 7. The report proposes the sum as a derivation; the per-media
  //                   keys stay declared-optional because two of them are absent from
  //                   data/schema/source-fields.json and requiring them would turn that check red
  //                   until the parent regenerates it.
  meraki: {
    // true of every part in the catalogue, so requiring them is not an invention (modules-misc, 12 Sep 2026)
    vendor: req, series: req,
    dimensions: cond({ field: "kind", inList: [...MK_BOX] }),
    weight: cond({ field: "kind", inList: [...MK_BOX] }),
    temp_operating: cond({ field: "kind", inList: [...MK_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...MK_BOX] }),
    // 80 facts, and published by the Meraki source's own inventory — the cup form_factor cannot be.
    mounting: cond({ field: "kind", inList: [...MK_BOX] }),
    // "External RPS (optional)" / "External" — how the box is powered. 71 facts across every line.
    psu_options: cond({ field: "kind", inList: [...MK_BOX] }),
    form_factor: cond({ field: "kind", inList: ["switch"] }),
    certifications: opt, safety_standards: opt, emc_emissions: opt,
    power_max: cond({ field: "kind", inList: [...MK_POWERED] }),
    ports: cond({ field: "kind", inList: [...MK_PORTED] }),
    // A PoE STANDARD and a PoE BUDGET are the SUPPLIER's questions. An MR access point and an MV
    // camera are PoE-powered rather than PoE-supplying, and 0 of the 88 hold either; all 9
    // poe_standard and all 37 poe_budget facts sit on MS switches. Same `all`-clause shape as
    // switches, so a switch whose poe_standard is "none" is not asked a budget.
    poe_standard: cond({ field: "kind", inList: ["switch"] }),
    poe_budget: cond({ all: [{ field: "kind", inList: ["switch"] }, { field: "poe_standard", ne: "none" }] }),
    switching_capacity: cond({ field: "kind", inList: ["switch"] }),
    // The camera questions: what it sees, at what quality, through what sensor. 11 / 9 / 9 of 52.
    field_of_view: cond({ field: "kind", inList: ["camera"] }),
    video_quality_max: cond({ field: "kind", inList: ["camera"] }),
    image_sensor: cond({ field: "kind", inList: ["camera"] }),
    storage_capacity: cond({ field: "kind", inList: ["camera"] }),
    // An MX/Z appliance is a firewall: 8 of 26 hold a throughput figure and it is what one is bought on.
    firewall_throughput: cond({ field: "kind", inList: ["appliance"] }),
    // An MR/CW access point is bought on its Wi-Fi generation. 3 facts, and `wifi_generation` is
    // one of the seven keys the Meraki inventory publishes.
    wifi_generation: cond({ field: "kind", inList: ["access-point"] }),
    // An MT sensor runs on batteries: all 16 hold battery_count, battery_life and external_power,
    // and none holds a power draw. 6 hold a life figure.
    battery_life: cond({ field: "kind", inList: ["sensor"] }),
    battery_count: opt,
    // A cellular gateway is bought on its bands. 0 of 38 hold one — a coverage gap, not a wrong
    // cup: "Bands supported" / "Bands" occur 56 times in the Cisco datasheet vocabulary.
    cellular_bands: cond({ field: "kind", inList: ["gateway"] }),
    cellular_category: opt, cellular_max_speed: opt,
    // A mounting kit is bought for what it fits, and that is all it is asked.
    product_compatibility: cond({ field: "kind", inList: ["accessory"] }),
    // STRUCTURE 8 Sep 2026: 30 field(s) its documents already produce and no profile declared — invisible to completeness until now.
    // field_of_view, video_quality_max, image_sensor, battery_count and battery_life were REMOVED
    // from this line on 12 Sep 2026: they are declared conditional above, and a later `opt` in the
    // same object literal silently wins (the last key in a JS object). That is the shape the
    // profileMerge test exists for, one level down — inside a single literal nothing checks it.
    power_load_idle_max: opt, copper_ethernet_ports: opt, dedicated_mgmt_interface: opt, sfp_plus_ports: opt, stack_ports: opt, sfp_ports: opt, fan_hot_swap: opt, mgig_rj45_ports: opt, poe_per_port_max: opt, qsfp_plus_ports: opt, ir_illumination: opt, lens_aperture: opt, upoe_support: opt, focal_length: opt, shutter_speed: opt, external_power: opt, lens_adjustment_range: opt, min_illumination: opt, optical_zoom: opt, box_contents: opt, poe_budget_redundant: opt, antenna_type: opt, lan_interfaces: opt, wan_interfaces: opt, tdp: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    color: opt, color_options: opt, country_of_origin: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "cloud-systems-management": {
    vendor: req, series: req,
    license_type: opt, license_for: opt,
    // STRUCTURE 8 Sep 2026: 14 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, host_os_support: opt, altitude_storage: opt, cellular_bands: opt, qos_features: opt, acoustic_sound_power: opt, inrush_current: opt, module_slots: opt, oir_support: opt, shipping_dimensions: opt, shipping_weight: opt, wall_mount: opt, poe_budget: opt, cellular_max_speed: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  // collab (12 Sep 2026): the 299 "hardware" parts here are Meeting Server / TMS appliances, their blades and
  // server parts, and a residue of Webex subscriptions still classed hardware — so the same kind-gated block.
  conferencing: {
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
    ...collabBlock(),
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "ios-nx-os-software": {
    vendor: req, series: req,
    license_type: opt, license_for: opt,
    // STRUCTURE 8 Sep 2026: 6 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, segment_routing_features: opt, qos_features: opt, compute_subsystem: opt, surge_rating: opt, timing_sync: opt,
  },


  // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now.
  "power-cables": {
    // vendor and series are true of every part in the catalogue, so requiring them is not
    // an invention. Everything else here stays `opt` until promote-required earns it from
    // real evidence — and there is none yet, because no cisco part sits in this category.
    vendor: req, series: req,
    circuit_breakers: opt, color: opt, color_options: opt, country_of_origin: opt, input_plug: opt, packaging_dimensions: opt, product_line: opt, receptacles: opt, series_release_date: opt },
  // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now.
  "power-supplies": {
    // vendor and series are true of every part in the catalogue, so requiring them is not
    // an invention. Everything else here stays `opt` until promote-required earns it from
    // real evidence — and there is none yet, because no cisco part sits in this category.
    vendor: req, series: req,
    circuit_breakers: opt, color: opt, color_options: opt, country_of_origin: opt, input_plug: opt, packaging_dimensions: opt, product_line: opt, receptacles: opt, series_release_date: opt },
  // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now.
  "rack-mounting": {
    // vendor and series are true of every part in the catalogue, so requiring them is not
    // an invention. Everything else here stays `opt` until promote-required earns it from
    // real evidence — and there is none yet, because no cisco part sits in this category.
    vendor: req, series: req,
    color: opt, color_options: opt, country_of_origin: opt, dynamic_load_capacity: opt, module_width_slots: opt, packaging_dimensions: opt, product_line: opt, seismic_rating: opt, series_release_date: opt, side_panels_included: opt, static_load_capacity: opt },
  // SHAPES 10 Sep 2026 — every device question gated on KIND (src/core/switchKind.ts).
  //
  // This profile was already the most carefully conditioned in the catalogue: rack_units on
  // form_factor, poe_ports on poe_standard, stacking on stackable, routes on layer. It was still
  // asking 40.5 required fields of all 8,985 hardware parts — 363,773 slots, six times `security`
  // and twenty-one times `servers-unified-computing` — because every one of those gates sits UNDER
  // an unconditional `req`, so a power cord was asked for switching capacity before any gate ran.
  //
  // WHY THE GATE IS A MARKER-ANYWHERE RULE AND NOT A TOKEN POSITION. Measured: the FIRST segment
  // gives 625 codes covering 57% and is impure (`WS` = WS-C3750G a switch, WS-X4448 a line card,
  // WS-CAC-3000W a power supply); the SECOND gives 1,178 covering 49%, and `C9300-48P` splits as
  // model | PORT COUNT so `24P` appears as a "kind". Cisco has no consistent kind slot in a switch
  // PID, so switchKind names the COMPONENTS — the nameable minority — and everything else defaults
  // to `switch`. That default fails safe: a component left as a switch carries gaps, where a switch
  // called a component would have its real questions closed.
  //
  // Port-bearing modules (line cards, network and expansion modules, port adapters) KEEP `ports`
  // and `poe_standard`: C9600-LC-48TX is a 48-port module. Since 11 Sep 2026 they are no longer
  // asked `switching_capacity` or `forwarding_rate` — a line card's figure is PER SLOT and lives in
  // `fabric_bandwidth` (see the split below), and 0 of 619 answered a forwarding rate. Supervisors,
  // fabric modules and daughter cards are their own kinds now. None of them gets a MAC table, a
  // VLAN maximum, stacking or a physical envelope — those belong to the chassis they sit in.
  switches: {
    rfc_compliance: opt, emc_immunity: opt, emc_emissions: opt, power_full_load: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    // --- the device itself -----------------------------------------------------------------
    mgmt_class: cond({ field: "kind", inList: [...SW_DEVICE] }),
    // THE CHASSIS TRADE-OFF, recorded 11 Sep 2026 (reviewer §1.4). A modular chassis stays kind `switch`: no
    // SKU marker separates WS-C4507R-E from a fixed switch (switchKind.ts: `CHAS` matches one SKU of 8,985,
    // and it is a MIB name). Its ports, uplink ports and PoE are already gated off by form_factor below.
    // What it is still asked that, in a modular system, belongs to the SUPERVISOR it ships with:
    // switching_capacity, forwarding_rate, mac_table, vlan_max, ipv4/ipv6_routes, dram, flash,
    // packet_buffer, jumbo_mtu, stackable and layer. Kept on purpose: Cisco's chassis datasheets state these
    // as system figures ("up to 2 Tbps with Supervisor 2T"), so they can be filled, and gating them off a
    // chassis would close questions a buyer asks of the whole system. Measured: 18 parts hold
    // form_factor = modular-chassis; 19 whose NAME says chassis carry `layer`, every one their OWN value
    // (tier-0 seed, "L3"), none inherited — 0 of the category's 1,054 `layer` facts are inherited.
    // OPTIONAL, 12 Sep 2026 (round-6 B2, and the reviewer's decision after two negative results).
    // It was REQUIRED of 4,931 switches with observed_fill_path FALSE -- the only required-or-pending
    // cup in the whole catalogue with no fill path, filled by 1,054 operator seeds and nothing else,
    // and the gate for two more cups. Cisco does not print "Layer 2/3" as a labelled row.
    //
    // WHY NOT DERIVED, measured twice against those 1,054 seeds because both routes look obvious:
    //   from `series`   6 series disagree with THEMSELVES (Catalyst 3850 l3 x52 / l2 x9, 3650
    //                   l3 x73 / l2 x21, 2960-X l2 x13 / l3 x10) because those lines ship in LAN Base
    //                   AND IP Base/IP Services -- a FEATURE SET, which is not the series -- and 78
    //                   series covering 3,227 parts (65% of the kind) hold no seed at all.
    //   from the SKU    precision 0.913, coverage 20%, and all 46 disagreements on the IE and 2960
    //   suffix          lines, where those letters are not a tier. See layerFromSku below, which is
    //                   the SCOPED version of this rule and is exact.
    //   from            circular: ipv4_routes was gated on layer.
    //   ipv4_routes
    //
    // So the cup is declared and accepted and required of nobody. The 1,054 seeds stay.
    layer: opt,
    // SW_BOX = switch + fex (11 Sep 2026): a fabric extender is a box you rack and power, so it keeps
    // the physical envelope below; it is not asked what only a SWITCHING device has.
    form_factor: cond({ field: "kind", inList: [...SW_BOX] }),
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    stackable: cond({ field: "kind", inList: ["switch"] }), deploy_role: opt,
    // PORTS ARE NOT ASKED OF A MODULAR CHASSIS (11 Sep 2026, reviewer §1.8, reshaped by measurement).
    // The reviewer proposed "uplink_ports only for access families — Nexus, 4500-X and 9500 have
    // none". Measured, that is false for fixed switches: Cisco's own datasheets call the 6x100G on a
    // Nexus 93180YC-FX and the 4x100G on a C9500-48Y4C "uplink ports". What has neither is a bare
    // CHASSIS (WS-C4507R-E, N9K-C9508): its ports arrive on line cards. So both fields are asked of
    // a switch until its form factor says modular-chassis, and of the kinds that carry ports themselves.
    ports: cond({ any: [
      { field: "kind", inList: ["module", "linecard", "fex"] },
      { all: [{ field: "kind", inList: ["switch"] }, { field: "form_factor", ne: "modular-chassis" }] },
    ] }),
    uplink_ports: cond({ any: [
      { field: "kind", inList: ["fex", "supervisor"] },
      { all: [{ field: "kind", inList: ["switch"] }, { field: "form_factor", ne: "modular-chassis" }] },
    ] }),
    uplink_modular: opt,
    // R1: `uplink_modular` is `opt`, holds ZERO facts and NO label in the 23,651-label inventory
    // maps to it — a boolean nothing can ever answer, so the branch could only ever contribute a
    // silent `na`. Gated on `form_factor` alone (required, 145 occurrences) with elseOpt, so a
    // FIXED switch with a network-module slot can still hold the 234 facts this cup already has
    // ("NIM slots" x8, "Expansion Slot" x7) instead of being told the question does not apply.
    module_slots: cond({ field: "form_factor", eq: "modular-chassis" }, { elseOpt: true }),
    // mgmt_ports holds ZERO facts across every Cisco category, not merely across this one —
    // measured 10 Sep 2026, and the four mentions in data/schema/source-fields.json are
    // added_by_profile entries (a field a profile CAN require), never evidence that anything
    // published one. Required, it was 8,985 gaps nothing could ever close. It stays DECLARED so a
    // value is accepted the day one is extracted, and is required of nobody.
    mgmt_ports: opt,
    // MODULES TOO, added 10 Sep 2026 on a reviewer's point that held up: Cisco prints the PoE
    // standard per LINE CARD, and 28 of this category's modules carry a PoE token in their PID
    // (WS-X4748-RJ45V+E "Catalyst 4500E 48-Port PoE 802.3at", C9400-LC-48U-B, WS-X6148-RJ45V).
    // Exactly one of the 28 holds a poe_standard fact today, so this opens 27 real questions.
    //
    // CORRECTED 11 Sep 2026. This comment used to say poe_budget stays device-only "which is what
    // their gate on poe_standard already achieves for a module whose poe_standard is unanswered".
    // Measured, it achieved the opposite: an unanswered REQUIRED gate makes its dependents PENDING,
    // so all 619 port-bearing modules were counted as owing a PoE budget, and 0 of them hold one —
    // the budget is the chassis PSU's, not the card's. The kind is now a clause of its own, and
    // requirementFor settles an `all` as soon as one answered clause is false (settledFalse).
    // A PoE line card still owes its PoE PORT count ("48-Port PoE 802.3at"); only switches owe a budget.
    poe_standard: cond({ field: "kind", inList: ["switch", "module", "linecard"] }),
    poe_ports: cond({ all: [{ field: "kind", inList: ["switch", "module", "linecard"] }, { field: "poe_standard", ne: "none" }] }),
    poe_budget: cond({ all: [{ field: "kind", inList: ["switch"] }, { field: "poe_standard", ne: "none" }] }),
    poe_per_port_max: opt,
    // SPLIT 11 Sep 2026. Until today modules kept these two on the note that Cisco publishes "a
    // per-SLOT bandwidth" for a line card "as well as a system figure for the switch" — true, and
    // exactly the defect: those are two DIFFERENT QUANTITIES, and they were both being poured into
    // switching_capacity. 86 module facts held "48 Gbit/s je Steckplatz" (a line card, per slot)
    // beside "6 Tbit/s Crossbar-Fabric" (a supervisor, the whole system), and WS-X45-SUP7-E said 48
    // where its own source says "(848 Gbit/s System)". Now:
    //   switching_capacity  the SYSTEM figure — a switch, or the supervisor that provides it
    //   forwarding_rate     likewise: 8 of 120 supervisors answer it, 0 of 619 port-bearing modules
    //   fabric_bandwidth    the PER-SLOT figure — what a supervisor gives each slot, what a fabric
    //                       module adds to each slot. Cisco labels it "Per-slot switching capacity",
    //                       "Capacity (per slot)", "Switch fabric connection" (~50 occurrences in the
    //                       datasheet inventory) and the seed "je Steckplatz".
    // The `module` kind itself was split for the same reason (switchKind.ts): a fabric module was
    // being asked for ports and a PoE standard, which no fabric module has.
    switching_capacity: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    forwarding_rate: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    // + linecard (11 Sep 2026, reviewer §1.5): a card in a chassis slot has a fabric connection — the
    // 31 per-slot figures moved on 11 Sep all sit on line cards (WS-X47xx, WS-X68xx, C6800 port cards).
    fabric_bandwidth: cond({ field: "kind", inList: ["supervisor", "fabric", "linecard"] }),
    stacking_bandwidth: cond({ field: "stackable", eq: true }),
    // Which stack it joins — OPTIONAL (reviewer §1.1). Asked of nothing yet: the "Stacking" row that names it
    // occurs 6 times in the inventory; the other 300+ values sit inside `stackable` raws and are coverage work.
    stacking_technology: opt,
    // stack_max_members is OPTIONAL, not conditional, and the measurement is the reason:
    // ZERO facts hold it — across every category and every vendor in the catalogue — and ZERO
    // labels in any source inventory carry a stack MEMBER COUNT. The one candidate,
    // "Max stack bandwidth", is a bandwidth and already maps to stacking_bandwidth (6 parts here,
    // 33 in meraki, so that one is thin but real). Required, this was a gap no extraction could
    // ever close, on the 1,334 switches that do answer `stackable`. It stays DECLARED so a value
    // is accepted the day a source publishes one. Measured 10 Sep 2026.
    stack_max_members: opt,
    packet_buffer: cond({ field: "kind", inList: [...SW_DEVICE] }),
    // A SUPERVISOR sets the chassis' table sizes and memory (11 Sep 2026, reviewer §1.6): Sup2T 128K
    // MAC entries, C9400-SUP-1XL 16 GB. 10 supervisors already hold a mac_table, 7 an ipv4_routes.
    mac_table: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    vlan_max: cond({ field: "kind", inList: [...SW_DEVICE] }),
    // UNGATED, 12 Sep 2026. Both were gated on `layer != l2`, and `layer` is now optional, so under
    // the three-way rule in tests/pendingRequirement.test.ts an unanswered optional gate resolves to
    // `na` -- these two would have closed in silence for every switch without a seed, which is
    // precisely the dead-gate shape R1 forbids and tests/gateR1.test.ts now refuses. A route table is
    // an L3 property and nothing answerable in this corpus says which switches are L3, so the honest
    // answer is optional rather than a requirement gated on a question nobody can answer.
    // Their 24 stored facts are also 24 REFUSALS: "In hardware Up to 780 Mpps" is a forwarding rate
    // in a route-table cup (a MOVE in the refusal dispositions), so the cup holds nothing real today.
    ipv4_routes: opt,
    ipv6_routes: opt,
    multicast_groups: opt, acl_entries: opt,
    jumbo_mtu: cond({ field: "kind", inList: [...SW_DEVICE] }), latency: opt, cpu: opt,
    dram: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    flash: cond({ field: "kind", inList: [...SW_DEVICE, "supervisor"] }),
    psu_config: cond({ field: "kind", inList: [...SW_BOX] }),
    // Redundancy is a question only where a PSU is MODULAR (11 Sep 2026, reviewer §1.8): a switch with
    // a fixed internal supply has nothing to be redundant, and no source prints "not redundant".
    psu_redundant: cond({ field: "psu_config", inList: ["modular-single", "modular-redundant"] }), psu_options: opt,
    cooling: cond({ field: "kind", inList: [...SW_BOX] }),
    // AIRFLOW IS HOW A FAN OR A PSU IS SOLD (11 Sep 2026, reviewer §1.3): NXA-PAC-1100W-PE2 and -PI2 are
    // the same supply with the air going opposite ways, and FEX packs come as "Standard" or "Reversed
    // airflow pack". Fillable — "Airflow" / "Airflow direction" / "Air flow" occur 185 times in the
    // datasheet inventory, and 145 fans and PSUs already hold a value. Switches keep the role gate.
    // R1 (12 Sep 2026, round-6 reviewer B7 and one instance the reviewer could not see): THE
    // `deploy_role` BRANCH WAS A SILENT CLOSURE. `deploy_role` is `opt` in this profile, and
    // tests/pendingRequirement.test.ts records the deliberate decision that an unanswered OPTIONAL
    // gate resolves to `na` rather than `pending` — correct, because nobody is obliged to answer it.
    // The consequence here was that `airflow` was NOT APPLICABLE to all 4,931 parts of kind
    // `switch`: a cup with 187 label occurrences in the inventory ("Airflow" x119, "Airflow
    // direction" x50, "Air flow" x16) and 225 stored facts, closed for the category's largest kind
    // without anyone deciding to close it. It is invisible to a dead-gate scan over the ledger,
    // which can only see cups still in `pending_until_gate_answered` — this one had already gone.
    //
    // `deploy_role` cannot be the discriminator: 2 facts catalogue-wide and NO label maps to it, so
    // it will never be answered. A ToR switch does publish airflow and an access switch does not,
    // and no answerable cup separates them — so the honest shape is the one the routers profile
    // already chose for the same reason: REQUIRED of the kinds that are sold by it, OPTIONAL (never
    // `na`) of everything else, so a value is accepted the day one is extracted.
    airflow: cond({ field: "kind", inList: ["fan", "power", "fex"] }, { elseOpt: true }),
    // --- physical: the box, and the parts that have their own -----------------------------------
    power_typical: cond({ field: "kind", inList: [...SW_BOX] }),
    // A PSU's wattage is what it DELIVERS (psu_rated_output), not what it draws (power_max): all 277
    // power_max facts on power-kind parts read "<n>W" off the supply's own name — "Cisco N9000 1400W AC
    // power supply" — and are moved to psu_rated_output by scripts/rekey-psu-and-compat.mts. A line
    // card DRAWS power of its own, and Cisco prints it (48 line cards hold one today).
    power_max: cond({ field: "kind", inList: [...SW_BOX, "linecard"] }),
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    input_voltage: cond({ field: "kind", inList: [...SW_BOX, "power"] }), input_freq: opt,
    heat_dissipation: cond({ field: "kind", inList: [...SW_BOX] }),
    temp_operating: cond({ field: "kind", inList: [...SW_BOX] }),
    temp_storage: cond({ field: "kind", inList: [...SW_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...SW_BOX] }),
    altitude_max: cond({ field: "kind", inList: [...SW_BOX] }),
    acoustic_noise: opt, mtbf: cond({ field: "kind", inList: [...SW_BOX] }),
    dimensions: cond({ field: "kind", inList: [...SW_BOX] }),
    weight: cond({ field: "kind", inList: [...SW_BOX] }),
    certifications: cond({ field: "kind", inList: [...SW_BOX] }),
    ieee_standards: cond({ field: "kind", inList: [...SW_BOX] }),
    // WHAT IT FITS (11 Sep 2026, reviewer §1.1): the first question asked of a line card, a PSU or a
    // fan, and asked of NONE of them until today. Fillable — "Product compatibility" (92),
    // "Chassis compatibility" (36) and "Chassis support" (23) occur in the datasheet inventory; only 5
    // components hold a value yet, which is coverage, not schema. chassis_compatibility, the same
    // quantity under a second key, is retired into this one (SUPERSEDED_KEYS).
    product_compatibility: cond({ field: "kind", inList: [...SW_COMPONENT] }),
    // A cable is bought by its length ("3M Type 2 Stacking Cable", "Power Cord ... 2.5m"); "Length"
    // occurs 58 times in the inventory and already maps to cable_length. The plug of a power cord is
    // declared OPTIONAL: no label in any source inventory names it yet.
    // power cords, stack cables and other cables have a length; a stack MODULE or KIT does not (§1.2)
    cable_length: cond({ field: "kind", inList: [...SW_CABLE] }),
    plug_type: opt,
    // R1: the `deploy_role` branch is dropped for the reason above — it is `opt`, unfillable (2
    // facts, no label), and its presence made this cup`s only live branch an unanswerable one.
    // `form_factor` IS required of a switch and has 145 label occurrences, and Cisco's industrial
    // sheets give the IE/IR line a din-rail form factor, so the surviving branch is the fillable
    // one. elseOpt: a switch whose form factor is rack-19 may still state an IP rating (9 facts,
    // 21 labels) and is no longer told it cannot have one.
    ip_rating: cond({ field: "form_factor", eq: "din-rail" }, { elseOpt: true }),
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    psu_efficiency: opt, power_cord_rating: opt, box_contents: opt, qos_queues: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, layer2_features: opt, layer3_features: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, module_width_slots: opt, multicast_features: opt, network_technology: opt, oversubscription_ratio: opt, packaging_dimensions: opt, poe_budget_redundant_psu: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  },
  transceiver: {
    itu_channel: opt, jacket_material: opt, jacket_color: opt, optical_pm: opt, input_power_range: opt, // deep-spec fields 2026-09-02
    // SHAPED BY KIND, 11 Sep 2026 (reviewer §2.1/§2.2; see opticKind.ts). Until today every part here was
    // asked the module questions — a mounting bracket (CVR-BRKT-1) and a passive mux (CWDM-MUX-4-SF1=) owed a
    // DDM answer, a fibre type and a power draw, and a QSA adapter owed a connector and an IEEE standard. An
    // ADAPTER is asked what it converts to and at what rate; an ACCESSORY is asked nothing but what the
    // parts row already knows. `kind` is derived from the SKU, so it is always answered: gating on it can
    // never collapse a question into `na` the way a condition on an unanswered optional fact does.
    vendor: req,
    form_factor: cond({ field: "kind", inList: [...OPT_MODULE, "adapter"] }),
    // breakout-cable (round-6 B4c) is asked data_rate and media like a module, and NOT form_factor --
    // form_factor above stays OPT_MODULE + adapter, so a breakout cable resolves it to na. It is asked
    // the two ends and the fan-out instead, below.
    data_rate: cond({ field: "kind", inList: [...OPT_MODULE, "adapter", "breakout-cable"] }),
    standard: cond({ field: "kind", inList: [...OPT_MODULE] }),
    media: cond({ field: "kind", inList: [...OPT_MODULE, "breakout-cable"] }),
    form_factor_a: cond({ field: "kind", inList: ["breakout-cable"] }),
    form_factor_b: cond({ field: "kind", inList: ["breakout-cable"] }),
    breakout_count: cond({ field: "kind", inList: ["breakout-cable"] }),
    fiber_type: cond({ field: "media", inList: ["mmf", "smf"] }),
    // `wavelength` IS THE TRANSMIT WAVELENGTH — for a duplex optic the one it emits and receives on, for a
    // single-fibre BiDi the Tx side. Every one of the 23 BiDi parts holding one already stores the Tx number
    // ("Tx 1490 nm / Rx 1310 nm" -> 1490), so the reviewer's `wavelength_tx` would have been a second cup
    // for the value this one holds. A TUNABLE part has no fixed wavelength and is asked `tuning_range`.
    wavelength: cond({ all: [{ field: "media", inList: ["mmf", "smf", "aoc"] }, { field: "kind", inList: [...OPT_FIXED_WAVELENGTH] }] }),
    // The receive side of a single-fibre BiDi — the cup that did not exist. REQUIRED of `bidi`: the pair is
    // what a BiDi is bought on (a U and a D must be matched), and it is fillable — 23 of 23 BiDi wavelength
    // raws carry it, and "Receiver optical input wavelength" occurs 22 times in the cisco-datasheets
    // inventory. `rx_wavelength` already existed (type nr, "Receiver input wavelength") and two alias rules
    // write it; `bidi_wavelengths` ({tx, rx}, 0 facts) and `input_wavelength` (0 facts) are the same
    // quantity under other names and are retired into it (SUPERSEDED_KEYS).
    rx_wavelength: cond({ field: "kind", inList: ["bidi"] }),
    // The span a tunable or coherent module covers. OPTIONAL, deliberately: every tunable optic has one,
    // but the "Frequency range ... THz" rows in the Cisco inventory come from video transmitter sheets, not
    // from transceiver datasheets, so fillability for this kind is unmeasured — and a required field
    // nothing can fill is a permanent gap. Promote it when a transceiver source is seen to publish it.
    tuning_range: opt,
    // SHAPED 11 Sep 2026 (reviewer §2.2, measured). A DAC or AOC is a fixed-length CABLE: its reach
    // IS its cable_length (135 of 143 hold one; 0 hold a reach_max), so asking both asked one
    // question twice. Transmission mode (duplex vs BiDi) is a property of a fibre optic: 0 of 143
    // DAC/AOC hold one and no source states it for a cable. rj45-copper keeps reach (30 m over Cat6a).
    reach_max: cond({ field: "media", inList: ["mmf", "smf", "rj45-copper"] }),
    connector: cond({ field: "kind", inList: [...OPT_MODULE] }),
    tx_power: cond({ field: "media", inList: ["mmf", "smf"] }),
    rx_sensitivity: cond({ field: "media", inList: ["mmf", "smf"] }),
    // OPTIONAL, not conditional-required, and the distinction is deliberate. The guaranteed minimum
    // launch power (tx_power) is what a link budget needs and every optical datasheet states it;
    // the compliance CEILING is published by some vendors and not others — Juniper's HCT gives it,
    // most Cisco datasheets do not. Marking it required would report a gap on thousands of Cisco
    // transceivers for a number their vendor never published, which is the "required field nothing
    // can ever fill" shape this project has paid for before.
    tx_max_output_power: opt,
    // `mode` DEMOTED TO OPTIONAL, 11 Sep 2026 — check 5 run WITHOUT the circle. source-fields.json admits every
    // required key for the Cisco datasheet sources by construction, so its test could not fail here. Asked
    // directly: ZERO label occurrences in the 23,651-label cisco-datasheets inventory map to `mode` (its one
    // alias, "Operating mode", carries "Electrical, 1310 nm, 1550 nm, DWDM" — not duplex or BiDi), and 0 of the
    // category's Cisco optics hold it; catalogue-wide it has 3 facts, one vendor's seed. Required, it opened a
    // slot on 1,369 Cisco optics that nothing could close. The question it asked — one fibre or two? — is now
    // carried by the derived `kind` (bidi = single-fibre) and by `connector` ("Duplex LC" vs "Single LC").
    link_budget: opt, laser_type: opt, mode: opt,
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' mgmt_ports and stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 1,760 slots in `transceiver`. (`bidi_wavelengths` stood here, declared optional with zero facts; it is
    // `wavelength` + `rx_wavelength` under a third name and is retired into the latter, 11 Sep 2026.)
    ddm: cond({ field: "kind", inList: [...OPT_MODULE] }),
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' mgmt_ports and stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 1,390 slots in `transceiver`.
    fec: opt,
    power_max: cond({ field: "kind", inList: [...OPT_MODULE] }), temp_class: cond({ field: "kind", inList: [...OPT_MODULE] }),
    // A breakout cable is ALWAYS a cable, so it is asked its length by kind rather than waiting on
    // `media` -- gating a cup a part certainly owes on a second question is the long way round to the
    // same answer, and it leaves the cup pending until media is extracted.
    cable_length: cond({ any: [{ field: "media", inList: ["dac-copper", "aoc"] }, { field: "kind", inList: ["breakout-cable"] }] }),
    // wire_gauge REQUIRED OF A DAC, 11 Sep 2026: a passive copper cable's gauge (Cisco prints 30/26 AWG)
    // decides its reach. Fillable — "Gauge" occurs 30 times in the cisco-datasheets inventory and the
    // alias already writes wire_gauge — though 0 of the 94 Cisco DACs hold it yet: a coverage gap.
    wire_gauge: cond({ field: "media", inList: ["dac-copper"] }),
    msa: opt, dimensions: opt, weight: opt, certifications: opt, mtbf: opt,
    breakout: opt, tunable: opt, dac_type: opt,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    series: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    breakout_point_length: opt, channel_bandwidth: opt, color: opt, color_options: opt, country_of_origin: opt, modulation_type: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
    // ONE CUP, NOT TWO — 11 Sep 2026. The 8 Sep pass above declared `cd_tolerance` here because no
    // category declared it. It had no facts and no alias, and it is the SAME QUANTITY as
    // `chromatic_dispersion_tolerance` — same English label, same unit (ps/nm) — which holds this
    // category's 21 real facts ("100G QPSK: 0.5 |CD|<= 2400 ps/nm", juniper's "+/- 40,000 ps/nm")
    // and carries the alias, but was never declared here: the cup with the data was missing from the
    // table while an empty duplicate sat on it. OPTIONAL: only coherent and DWDM optics state one.
    // `cd_tolerance` stays defined in the generated dictionary, declared by no profile; do not
    // re-add it — a second key for one quantity splits every value between two cups.
    chromatic_dispersion_tolerance: opt,
  },
  security: {
    anyconnect_sessions: opt, expansion_io: opt, shock: opt, redundancy: opt, // deep-spec fields 2026-09-02

    // UNIVERSAL FOR A BOX — true of any physical security appliance, whatever it does, and asked of
    // NOTHING ELSE since 12 Sep 2026. Until then these seven were unconditional `req`, so each of the
    // 1,068 component parts (fans, rails, blank slot covers, SSDs, DIMMs, PSUs) was asked a weight, a
    // rack height, an operating temperature, a power draw and a certification list. Not one of them
    // held a single own physical fact, and the gaps were unclosable by construction: Cisco does not
    // print an operating humidity for a slot cover.
    vendor: req, series: req,
    form_factor: cond({ field: "kind", inList: [...SEC_BOX] }),
    // The gate stays `form_factor` alone, which is correct in BOTH directions and is why it is not
    // also gated on kind: for a component form_factor resolves `na`, so requirementFor finds no
    // required gate and rack_units is `na` too rather than `pending`; for a box with no extracted
    // form_factor the gate is `req` and unanswered, so rack_units stays `pending` — an open gap that
    // names the field which would settle it. tests/securityShapes pins both halves.
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    // A BLADE AND A NETMOD DRAW POWER OF THEIR OWN and Cisco prints it, the same trade switches made
    // for line cards. A PSU's wattage is what it DELIVERS and belongs in psu_rated_output, below.
    power_max: cond({ field: "kind", inList: [...SEC_POWERED_KIND] }),
    temp_operating: cond({ field: "kind", inList: [...SEC_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...SEC_BOX] }),
    dimensions: cond({ field: "kind", inList: [...SEC_BOX] }),
    weight: cond({ field: "kind", inList: [...SEC_BOX] }),
    certifications: cond({ field: "kind", inList: [...SEC_BOX] }),
    psu_config: opt, psu_redundant: opt, power_typical: opt, altitude_max: opt, mtbf: opt,

    // BY SHAPE — `secShape` above: the kind the SKU names, or the series where it names none. Each of
    // these was `req` for all 6,689 hardware parts until 8 Sep 2026 and series-gated until 12 Sep.
    firewall_throughput: secShape(SEC_FIREWALL_KIND, SEC_FIREWALL),
    threat_throughput: secShape(SEC_INLINE_KIND, SEC_INLINE),
    // FIREWALLS ONLY. ISE was in this list and the two measurements are not the same thing:
    // a firewall's concurrent sessions are TCP/UDP connections and run to millions, while ISE's
    // are authenticated ENDPOINTS and run to tens of thousands. One key holding both makes the
    // band useless and any comparison between an ISE node and a firewall meaningless. ISE keeps
    // its own question below.
    concurrent_sessions: secShape(SEC_FIREWALL_KIND, SEC_FIREWALL),
    // --- security-r6 (12 Sep 2026): THE FIVE CUPS A FIREWALL IS BOUGHT ON AND WAS NOT ASKED ----
    // A Cisco NGFW performance table has one row per model and one COLUMN per figure, and the
    // columns are: firewall throughput · threat/NGFW throughput · IPS throughput · IPsec VPN
    // throughput · TLS throughput · new connections per second · concurrent sessions · VPN peers.
    // Three of those eight were required; five were `opt`, so a firewall could hold every physical
    // fact and still say nothing about what it does. Each cup below is promoted on the same three
    // pieces of evidence the demotion standard uses in reverse (facts ever stored · a per-category
    // seen-list in data/schema/source-fields.json · candidate labels in a runs/vocab inventory),
    // and the one of the six that fails them stays `opt` with its numbers written down.
    //
    // IPS THROUGHPUT IS A FIREWALL FIGURE TOO, and scoping it to the dedicated-IPS shapes was the
    // narrower half of a true statement. All 24 of its facts are in `security` and only THREE sit
    // on an `ips`-kind part: the other 21 are firewalls — FPR-1010/1120/1140/1150, FPR-2110..2140,
    // FPR-4112..4145, ASA-5506..5555, 1210CE/1210CP/1220CX — plus SM-40/48/56, the 9300 blades.
    // So the cup was required of the 74 parts that hold 3 facts and optional on the 450 that hold
    // 21. Labels: "IPS Throughput [4]" 7, "NGIPS" 6, "Throughput: NGIPS (1024B)" 5, "IPS
    // Throughput" 4 — every one of them a row on an NGFW sheet.
    ips_throughput: secShape([...SEC_IPS_KIND, ...SEC_FIREWALL_KIND], [...SEC_IPS, ...SEC_FIREWALL]),
    // IPsec VPN throughput. 74 label occurrences in 14 spellings, of which 26 are the firewall
    // ones, and each was checked against its own sample SKUs rather than its count: "IPSec VPN
    // Throughput (1024B TCP w/Fastpath)" 10 (VM.Standard.A1 / VM.Standard3 — FTDv), "3DES/AES VPN
    // Throughput [6]" 7 (Cisco ASA 5520 / 5525-X / 5540 / 5545-X / 5550 / 5555-X), "IPSec VPN
    // throughput (1024B TCP /Fastpath)" 4 (SM-40 / SM-48 / SM-56), "IPsec VPN throughput (450B UDP
    // L2L test)" 4, "IPsec VPN throughput (1024B TCP with Fastpath)" 1; the other 48 are the
    // SD-WAN rows of the C8000 sheets and belong to `routers`, which declares the same cup. Four alias rules already
    // cover all five firewall spellings, so nothing had to be written. FACTS: 6 live (all routers)
    // plus the 3 on SM-40/48/56 that still sit under `vpn_throughput`, retired into this key on
    // 12 Sep — until the rekey run moves them those three read "missing" while holding the value.
    ipsec_throughput: secShape(SEC_FIREWALL_KIND, SEC_FIREWALL),
    // VPN PEERS — the best-evidenced firewall cup in the category and it was optional. 73 facts
    // catalogue-wide, 64 of them here, on ASA5540/5520/5585/5545/5505 bundles and on SM-40/48/56;
    // `cisco-datasheets` carries it in its per-category `security` seen-list, not only in '*'.
    // Labels: "Maximum VPN peers" 9 (Performance / VM.Standard.A1 / VM.Standard3), "IPsec VPN
    // Peers" 7 (Cisco ASA 5520 … 5555-X), "Maximum VPN Peers" 4 (SM-40 / SM-48 / SM-56) — every
    // one a Cisco firewall row, all covered by the two existing alias rules, nothing to write.
    // Band [1, 200000] against stored 10..20,000 and labelled 25..60,000.
    vpn_peers: secShape(SEC_FIREWALL_KIND, SEC_FIREWALL),
    // TLS/SSL DECRYPTION THROUGHPUT. 3 facts (1210CE 1.0, 1210CP 1.0, 1220CX 1.5 Gbit/s, from the
    // Secure Firewall 1200 datasheet's own column, t0:r1..r3:c5), and `cisco-datasheets` carries
    // the key in its per-category `security` seen-list. The ONE alias rule reached only spellings
    // starting with "TLS", so the 4200-series column "TLS (Hardware Decryption) 2" — 4
    // occurrences, "10 Gbps" | "11 Gbps" | "12 Gbps", sample SKUs SM-40 / SM-48 / SM-56 — reached
    // nothing. Aliased now, scoped `only: ["security"]`, together with the bare "SSL throughput".
    //
    // AND THE SAMPLE SKUS HALVED THE RULE I FIRST WROTE, which is worth recording because the raw
    // counts said the opposite. "SSL bulk encryption throughput (Gbps)" has 12 occurrences — three
    // times any other — and its sample SKUs are Alteon D-5424SL / D-9800S: RADWARE, in a
    // comparison table. "SSL Throughput" (4) names "Cisco ACE Application Control Engine", a load
    // balancer, and the two "Performance:" forms are section paths over the same ACE figure. So of
    // the 27 occurrences that looked like evidence, 20 belong to other vendors' or other
    // categories' products and only 4 to a Cisco security part. Counts without their sample SKUs
    // would have promoted this cup on a competitor's datasheet row.
    //
    // The curated band arrived with the cup (see the dictionary block): the generated entry had
    // none, and a required numeric with no band refuses nothing.
    tls_throughput: secShape(SEC_FIREWALL_KIND, SEC_FIREWALL),
    // --- end security-r6 (12 Sep 2026) ---------------------------------------------------------
    recommended_users: secShape(SEC_USER_SIZED_KIND, [...SEC_EMAIL, ...SEC_WEB]),
    // A DRIVE IS ASKED ITS CAPACITY, and that is where every one of this category's 45
    // storage_capacity facts already sits — AMPPC-SSD-800GB, FMC-M5-HDD-600G, SNS-SD960GM2NK9. Until
    // today the key was asked only of gateway and console BOXES (their mail spool / event store),
    // which is also right and stays: the cup is the same quantity, bytes of storage, exactly as
    // servers-unified-computing uses it for both a server and its disk.
    storage_capacity: cond({ any: [
      { field: "kind", inList: ["drive", ...SEC_STORE_KIND] },
      { all: [{ field: "kind", inList: ["appliance"] }, { field: "series", inList: [...SEC_EMAIL, ...SEC_WEB, ...SEC_MGMT, ...SEC_ANALYTICS] }] },
    ] }),
    // 12 Sep 2026, the cross-category test: servers and hyperconverged ask a drive its INTERFACE beside its
    // capacity, and a firewall's spare SSD is bought the same way. The same cup, the same meaning, everywhere.
    drive_interface: cond({ field: "kind", inList: ["drive"] }),

    // --- WHAT A COMPONENT IS BOUGHT ON (12 Sep 2026, reviewer §4b) --------------------------------
    // WHAT IT FITS is the first question asked of a power supply, a fan, a blade or a rail kit, and
    // it was asked of none of them. Fillable: "Product compatibility" (74 occurrences in the
    // 23,651-label datasheet inventory), "Chassis compatibility" (36), "Chassis support" (23); 9
    // security components already hold a value and 79 parts hold one catalogue-wide.
    // chassis_compatibility, the same quantity under a second key, is retired into this one
    // (SUPERSEDED_KEYS), so R2 holds.
    product_compatibility: cond({ field: "kind", inList: [...SEC_COMPONENT] }),
    // A supply is bought on what it DELIVERS. 274 facts catalogue-wide (272 of them on switches
    // PSUs) prove the cup is fillable; security holds none yet, which is coverage, not schema.
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    // Input voltage is asked of the SUPPLY, not of the box. It is a real appliance spec too — "AC
    // input voltage" occurs 53 times in the inventory — so a box's value is still accepted and
    // served; it is simply not scored against the box, because an appliance is not chosen on it and
    // requiring it would open 922 gaps for no gain. Same reasoning as switches' airflow gate.
    input_voltage: cond({ field: "kind", inList: ["power"] }),
    // AIRFLOW IS HOW A FAN OR A PSU IS SOLD: the same supply ships with the air going either way, so
    // the direction is the ordering decision. 187 label occurrences, 368 facts catalogue-wide.
    airflow: cond({ field: "kind", inList: ["power", "fan"] }),
    // A cable is bought by its length ("Length" 58 occurrences, 1,142 facts catalogue-wide).
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    // security-r6 (12 Sep 2026): THE TWO CUPS THE `compute` COHORT WAS ALREADY CARRYING.
    // `compute` held 224 parts asked exactly one cup, and 39 of them held a fact. The 39 are not
    // spread across the kind — 33 are `dram` on memory modules and 6 are `ports` on network cards,
    // and the other 132 members (CPUs, RAID controllers, TPMs, risers) hold nothing at all. So
    // both cups were being filled by parts nobody was asking, which is the state that lets an
    // extraction look like coverage and score as a gap. securityKind now returns `memory` (61) and
    // `nic` (31) for those shapes and `compute` (131) for the rest; the split is by SKU token and
    // was validated by diffing the kind of all 1,990 hardware parts, which is how the ASA-IC-6GE-CU
    // collision was caught. `dram` band [0.06, 512] GB against stored 4..64 on these very parts;
    // `ports` is the same struct cup and the same switches parser as everywhere else.
    // `memory_speed_max` JOINS IT, and the reason it does is a check rather than a judgement. I
    // left it out first — zero facts in `security`, zero labels in the 23,651-label inventory — and
    // tests/cupLedger refused it: "kind `memory` owes a different set in security than in the other
    // 4 — missing: memory_speed_max". That check is right and the omission was the mistake. One
    // kind name must mean one question set, and the cup is demonstrably fillable: 364 facts in
    // servers-unified-computing and the two hyperconverged categories, 2400..6400 MHz, on the same
    // UCS DIMMs under a different prefix (SNS-MR-X16G1RT-H here is UCS-MR-X16G1RT-H there), and
    // every one of these 61 names states it — "32GB DDR4-2933-MHz RDIMM/2Rx4/1.2v". Security holds
    // none yet, which is coverage, not schema — the psu_rated_output argument three cups above.
    dram: cond({ field: "kind", inList: ["memory"] }),
    memory_speed_max: cond({ field: "kind", inList: ["memory"] }),
    // A network module is bought on its ports and nothing else — FPR-NM-8X10G, ASA-IC-6GE-CU-A,
    // FPR4K-XNM-2X400G. 80 of the category's ports facts already sit on module-kind parts and the
    // struct parser is the switches one. NOT asked of the service blades: an FPR9K-SM-36 has no front
    // ports at all while an ASA5585-SSP-10 has eight, and a cup asked of a kind only half of which
    // can have it is the "capability statement" mistake in schema form.
    //
    // security-r6 (12 Sep 2026): AND A FIREWALL IS BOUGHT ON ITS PORTS BEFORE ANYTHING ELSE. The
    // cup reached the cards and not the boxes they go in — so an FPR-NM-8X10G was asked its ports
    // and an FPR-2140 was not, on a sheet whose first table is "Interfaces". 1,213 label
    // occurrences ("Ports" 487, "Ethernet interfaces" 38 — "6 port 1G Base-T copper network
    // interface (NICs), RJ-45", "Physical Interfaces" 27, "Integrated I/O" 17), and three firewall
    // shapes already hold the fact: 1210CE / 1210CP / 1220CX, "8x 1000BASE-T", t4:r1:c1-c3 of the
    // Secure Firewall 1200 datasheet. The struct parser is the switches one, unchanged.
    //
    // STILL NOT THE BLADES, for the reason above, and not `ips` / the gateways / the consoles
    // either: their SKUs are a separate question this round did not measure, and a cup added to a
    // kind on a guess is the thing the shape axis exists to stop. `analytics` is the one to be
    // careful about — LC-UDP-2010-C-U-K9 holds a ports value of 10 mined out of "Dir Upg from 10XX
    // to 2010", which is a model number read as a port count (retraction PROPOSAL in the report).
    ports: cond({ any: [
      // `nic` joins `module` (security-r6): a CCS-P-IQ10GC is "4x10 GbE RJ45 PCIe NIC" and six of
      // the 31 already hold the struct. Same cup, same parser, a card is a card.
      { field: "kind", inList: ["module", "nic", "firewall"] },
      { all: [{ field: "kind", inList: ["appliance"] }, { field: "series", inList: [...SEC_FIREWALL] }] },
    ] }),

    // DECLARED FOR THEIR SHAPE, NOT REQUIRED OF IT — and the reason is a check, not a judgement.
    // These four were written as conds too, and tests/source-fields refused the commit: no
    // ENABLED source publishes a label that maps to them, so requiring them would have created
    // four permanent gaps nothing could ever close. Reading the 23,651-label inventory says
    // exactly why, per field:
    //   max_endpoints              'Endpoints' (25) and 'Included ISE endpoint licenses' (11) —
    //                              present but ambiguous; a rule on 'Endpoints' would swallow
    //                              wireless and video labels too
    //   managed_devices_max        two labels, neither a spec ('Includes first 10 TMS managed
    //                              devices/servers plus Exchange/O365')
    //   flows_per_second           zero labels
    //   ddos_mitigation_throughput 'Max Programmable Mitigation Throughput' (6) is plausible, but
    //                              'Concurrent Threat Mitigation Throughput (Firewall + IPS
    //                              Services)' (3) is a firewall figure wearing the same words
    // Each becomes a cond the day a source publishes it unambiguously — promote-required earns
    // requirements from evidence here as everywhere else.
    // max_endpoints IS ISE's real question and it stays OPTIONAL, which is the half of the
    // reviewer's proposal that could not land. Promoting it to cond({series: SEC_IDENTITY}) was
    // tried and refused by two independent guards: securityShapes ("labels exist but are
    // ambiguous") and source-fields ("required by the profile and no enabled source publishes
    // it"). Requiring it would open a gap on 112 real appliances that nothing can close — this
    // file's own rule about a required field nothing can ever fill. Declared, so a value is
    // accepted the moment one is extracted; not required, until a source publishes it.
    //
    // security-r6 (12 Sep 2026): AND A SOURCE NOW CAN. The paragraph above read two labels —
    // 'Endpoints' (25, ambiguous) and 'Included ISE endpoint licenses' (11, not a spec) — and
    // concluded the figure was not published. Four more labels were sitting unmapped in the same
    // inventory, 12 occurrences, and their sample SKUs are the appliances themselves: "Concurrent
    // active endpoints supported by a dedicated PSN (Cisco ISE node only has PSN persona[.])",
    // values 50,000 and 100,000, on "Cisco Secure Network Server 3815 / 3855 / 3895" and "3715 /
    // 3755 / 3795". Both SNS datasheets are LINKED to these parts and 63 facts have already been
    // extracted from them, so the value lands on the next apply at zero network cost. The rule is
    // in attribute-aliases.en.json, scoped to security, and it REFUSES the shared-PSN twin (same
    // appliances, 25,000/50,000) — two measurements in one cup is the defect that took ISE out of
    // concurrent_sessions. STILL `opt`: no enabled source has been SEEN to publish the key (zero
    // facts anywhere, and it is absent from both datasheet '*' lists), so promoting it today would
    // fail tests/source-fields for the right reason. It is now an EARNED promotion waiting on one
    // fact, not an unfillable field — which is a different report line, and the difference matters.
    //
    // THE OTHER TWO SHAPES WERE RE-MEASURED THE SAME WAY AND THE EARLIER VERDICT HOLDS.
    //   analytics / Secure Network Analytics — `flows_per_second`: the only mapped label is
    //     "Number of flow events that can be processed per second", ZERO occurrences in the
    //     inventory. The nearest candidates are feature-matrix rows: "NetFlow" 4, whose two samples
    //     are "250,000 flows/sec" AND a paragraph about DDoS detection, so the label does not
    //     determine the cell; "NetFlow entries" 12 and "NetFlow cache" 4 are a switch's flow-table
    //     size, a different quantity. Nothing to alias. Stays `opt`.
    //   management / FMC, Security Manager, SMA — `managed_devices_max`: two labels, still neither
    //     a spec ("Includes first 10 TMS managed devices/servers plus Exchange/O365 integration" 4,
    //     "Maximum number of devices across networks", the cloud-systems-management rule). Stays
    //     `opt`. `events_per_second` unchanged for the reason recorded above it.
    // So management, analytics and identity keep the eight / eight / seven universal box cups they
    // already had, and NONE of them is asked a firewall cup: every throughput and session cup is
    // gated by `secShape`, whose kind list holds only firewall shapes and whose series fallback
    // fires only for kind `appliance`. tests/securityShapes pins that in both directions.
    // THE FIVE LICENCE FIELDS, declared for security 9 Sep 2026. 7,268 of this category's 13,273
    // parts are licences — more than half — and every one of them was reading `na` on the only
    // questions a licence is actually bought on, because a key the profile does not mention
    // resolves to not-applicable. That is the API telling a consumer "a Cisco security licence has
    // no term and no seat count", which is false.
    //
    // `opt`, NOT required, and the distance between the two is not a hedge — it is the whole of
    // the open half of this defect. `recompute-completeness` gives every non-hardware part
    // `no_profile = true` and ZERO required fields BEFORE it looks up a profile, so nothing
    // declared here is scored for a licence today whatever kind it carries. Declaring them makes
    // /fields honest about what the category asks; SCORING them needs that pre-profile drop to
    // change, which puts 7,491 non-hardware parts into a coverage average that has never included
    // them and is the operator's call, not a schema edit. The reviewer that raised this said the
    // same: report, do not apply.
    license_type: opt, license_term: opt, license_seats: opt,
    license_for: opt, delivery_method: opt,
    max_endpoints: opt, managed_devices_max: opt, flows_per_second: opt,
    ddos_mitigation_throughput: opt,
    // events_per_second JOINS THEM, 8 Sep 2026, and the correction is worth recording because it
    // was the same mistake in a different direction. I gated it on management + analytics because
    // an event rate is what sizes a log collector — true of the world, and NOT what the evidence
    // said. The single supporting label in the 23,651-label inventory is "Sustained Firewall
    // Events per Second (eps)", 9 occurrences, and it is a FIREWALL row. So the field was required
    // of eleven series on the strength of a label belonging to a twelfth kind of product.
    // Declared for the shapes it plausibly describes, required of none until a management or
    // analytics datasheet publishes it under its own name.
    events_per_second: opt,

    // The rest of the inline-security vocabulary stays optional: a firewall datasheet states some
    // of these and not others, and promote-required earns a requirement from evidence rather than
    // taste.
    //
    // security-r6 (12 Sep 2026) CORRECTS THE SENTENCE THAT USED TO STAND HERE. It said "every
    // document the corpus holds for `security` is an end-of-life bulletin or an ordering guide.
    // Not one datasheet." Re-measured against doc_parts today: 366 EoL bulletins (11,654 parts),
    // 6 guides (951), 1 Q&A (13) — AND 29 `vendor_datasheet_html` plus 1 `vendor_datasheet_pdf`,
    // linked to 332 and 6 parts. They are the Firepower 1000/2100/4100/9300, Secure Firewall
    // 220/1200/6100, ASA 5500, ISA3000, NGIPS, FMC x800 and Previous Models, Secure Network
    // Analytics, Secure Network Server 3700/3800, Cyber Vision, Content Security Management,
    // Secure Workload and AMP Private Cloud sheets, and 460 of this category's 725 facts came out
    // of 16 of them by `html_table`. The category's yield problem is real and it is NARROWER than
    // that sentence: the datasheets exist and are linked; what is thin is how many parts each one
    // reaches (332 of 1,990 hardware parts have any spec-bearing document at all).
    //
    // NEW CONNECTIONS PER SECOND IS THE ONE OF THE SIX THIS ROUND COULD NOT PROMOTE, and the
    // reason is not acquisition — it is this cup's own UNIT. 28 label occurrences in four
    // spellings, all four already covered by three alias rules, samples "2700", "380K", "450K",
    // "490K", "1.1M", "12,000", "20,000", "1.6 million", "300,000"; the biggest label's sample
    // SKUs are SM-40 / SM-48 / SM-56, which hold 15 facts each from a linked datasheet. And ZERO
    // facts exist under the key in any category, because `unit: "1/s"` is a real unit and not in
    // specNormalize's COUNT_LIKE set, so the normaliser demands a unit token in the cell:
    //
    //     new_conn_per_sec  "2700"    -> UNIT_MISSING        concurrent_sessions "20K"  -> 20000
    //     new_conn_per_sec  "380K"    -> UNIT_UNKNOWN        concurrent_sessions "32M"  -> 32000000
    //     new_conn_per_sec  "1.1M"    -> UNIT_UNKNOWN        vpn_peers           "25"   -> 25
    //
    // Ten of ten real values refused; the same values parse under `Sessions` and `Peers`, which
    // ARE count-like. Four cups declare `1/s` — new_conn_per_sec, events_per_second,
    // flows_per_second, ssl_connections_per_sec — and all four hold zero facts everywhere. The fix
    // is one token in COUNT_LIKE, which changes what the normaliser accepts and therefore needs a
    // NORM_VERSION bump, so it is the parent's: PROPOSAL in the report, not done here. Requiring
    // the cup before that lands would create 450 gaps nothing could close.
    new_conn_per_sec: opt,
    vpn_throughput: opt, threat_defense_throughput: opt,
    nat_sessions: opt, ipsec_tunnels: opt,
    ssl_connections_per_sec: opt, attack_concurrent_sessions: opt, uc_proxy_sessions: opt,
    ddos_blocking_throughput: opt, ddos_prevention_rate: opt,
    max_interfaces: opt, storage_raw_capacity: opt, managed_by_fdm: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, gre_tunnels: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, simultaneous_connections: opt, temp_operating_extended: opt, thermal_shock: opt,
  },
  // wireless (12 Sep 2026) — SHAPED BY KIND (src/core/wirelessKind.ts). Until today every non-component was a
  // generic `device` asked wifi_generation, poe_standard, power, dimensions and a temperature: a ceiling
  // antenna owed a Wi-Fi generation, a controller a PoE standard, a CMX server's DIMM an operating
  // temperature. Each kind now owes what it is bought on; the fallback kind `other` owes nothing.
  // Evidence per cup (label occurrences in the 23,651-label cisco-datasheets inventory, facts in the store)
  // is in data/ledger/cisco-wireless.json and runs/reports/schema-wireless-2026-09-12.md.
  wireless: {
    supported_transceivers: opt, polarization: opt, beamwidth_elevation: opt, mounting: opt, recycled_content: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    // --- access points: radio, clients, power class, ports -----------------------------------------
    // wifi_generation is THE cup for the 802.11 generation here. `standard` holds the same quantity in this
    // category (775 mined "802.11ac"/"802.11n" values, pattern wl-ieee-80211) and cannot be retired globally —
    // it is the transceiver's transmission standard. It is declared optional below and the rekey is a proposal.
    wifi_generation: cond({ field: "kind", inList: [...WL_AP] }),
    spatial_streams: cond({ field: "kind", inList: [...WL_AP] }),
    ap_max_clients: cond({ field: "kind", inList: [...WL_AP] }),
    // Band coverage is what an AP, a backhaul radio AND an antenna are matched on ("2.4 GHz 4dBi/5 GHz 7dBi").
    radio_bands: cond({ field: "kind", inList: [...WL_AP, "antenna", "backhaul"] }),
    radio_count: opt, max_data_rate: opt, tx_power: opt, rx_sensitivity: opt, max_ssids: opt,
    // The PoE class an AP DRAWS. Required of APs, and of an injector (the class it SUPPLIES).
    poe_standard: cond({ field: "kind", inList: [...WL_AP, "power-injector"] }),
    ports: cond({ field: "kind", inList: [...WL_PORTED] }),
    // --- controllers --------------------------------------------------------------------------------
    wlc_ap_capacity: cond({ field: "kind", inList: ["wlc"] }),
    wlc_client_capacity: cond({ field: "kind", inList: ["wlc"] }),
    // wireless-r7 (12 Sep 2026): A CONTROLLER'S THROUGHPUT, and it reuses the cup that already holds
    // that quantity rather than opening a second one. `router_throughput` is "System-Durchsatz /
    // System throughput" in Gbit/s — the aggregate data-plane figure of a box — and the label that
    // states it, "Maximum throughput", ALREADY maps here in this category (alias rule 181 is
    // unscoped; mapLabel("Maximum throughput", "wireless") returns router_throughput today). A new
    // `wlc_throughput` key would be the reviewer's own "duplicate cup" — one quantity, two cups —
    // and would make that label contested between them.
    //
    // SCOPED BY SERIES, because only one controller family publishes it. Read out of the cached
    // datasheets: 9800-40 "Up to 40 Gbps", 9800-80 "Up to 80 Gbps", CW9800H "Up to 100 Gbps",
    // CW9800M "Up to 50 Gbps", CW9800L "Up to 10 Gbps", 9800-L "5 Gbps, 10 Gbps (with Performance
    // license)". The AireOS controllers (2500/3500/5500/8500 — 108 of the 132 `wlc` parts) publish
    // AP and client counts and NO throughput figure at all, so asking them would be 108 gaps nothing
    // can ever close. R1 holds: `kind` is derived for every part and `series` is required and
    // column-backed, so both gates are answered; at nothing-known the cup is `pending`, which is how
    // the security appliance shapes read too.
    router_throughput: cond({ all: [
      { field: "kind", inList: ["wlc"] },
      { field: "series", inList: ["Catalyst 9800 Series Wireless Controllers"] },
    ] }),
    // end wireless-r7
    // --- antennas: gain, band (radio_bands above), connector; the pattern is declared, see the ledger --------
    antenna_gain: cond({ field: "kind", inList: ["antenna"] }),
    antenna_connector: cond({ field: "kind", inList: ["antenna"] }),
    // wireless-r7 (12 Sep 2026) ------------------------------------------------------------------
    // INTERNAL OR EXTERNAL is an AP question, not an antenna one: it says whether the access point
    // has its antennas built in or takes separate ones, which decides what else must be ordered. It
    // was `opt` here because "no derivation rule exists" (report of 12 Sep); there is one now, and
    // it is measured — 594 of the 2,756 AP names state it (internal 337, external 257, none
    // ambiguous), "Internal antennas" and "Antenna Type(s)" are mapped labels with 11 occurrences
    // between them, and cisco-datasheets is listed as a seen source for the key in this category.
    // Required of APs only: an ANTENNA's own type is its radiation pattern, a different cup.
    antenna_type: cond({ field: "kind", inList: [...WL_AP] }),
    // DECLARED, NOT YET ASKED. The cup, its domain and its fill path are settled above; it stays
    // `opt` for one measurable reason: `requiredKeysByCategory` in build-source-fields counts `cond`
    // as required, and data/schema/source-fields.json — a GENERATED file — has no entry for a key
    // that did not exist when it was generated, so a `cond` here makes
    // `requiredFieldCoverageProblems` report "wireless/regulatory_domain: no enabled source
    // publishes it" and tests/source-fields.test.ts red. Promoting it is two steps the parent owns:
    // regenerate source-fields (the generator admits every required key to the cisco-datasheets "*"
    // list by construction) and run the description patterns once so the ledger sees a fill path.
    // Measured today: 409 parts match the four `wl-reg-domain-*` patterns (ap 349, bundle 53,
    // backhaul 7) and the captured letter agrees with the SKU token 305 times out of 305.
    regulatory_domain: opt,
    // end wireless-r7 ----------------------------------------------------------------------------
    beamwidth_azimuth: opt,
    // --- power: what a supply or injector DELIVERS (a PSU's wattage is not its draw — switches precedent) ---
    psu_rated_output: cond({ field: "kind", inList: ["power", "power-injector"] }),
    input_voltage: cond({ field: "kind", inList: ["power"] }),
    // 12 Sep 2026, the cross-category power contract (reviewer round 3, item 1): the same supply ships with the
    // air going either way, so the direction is part of what is ordered — asked of `power` in every category.
    airflow: cond({ field: "kind", inList: ["power"] }),
    // --- cables ---------------------------------------------------------------------------------------
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    // --- the physical envelope of every box ----------------------------------------------------------
    power_max: cond({ field: "kind", inList: [...WL_BOX] }),
    dimensions: cond({ field: "kind", inList: [...WL_BOX] }),
    weight: cond({ field: "kind", inList: [...WL_BOX] }),
    temp_operating: cond({ field: "kind", inList: [...WL_BOX] }),
    certifications: cond({ field: "kind", inList: [...WL_BOX] }),
    // WHAT A COMPONENT FITS (12 Sep 2026, reviewer §2.3). This was demoted to `opt` here on R3 grounds — a
    // partner is a relation, not a field — and four other categories require it of every component kind, so R3
    // was being applied in one place and not the rest. The reviewer's answer, adopted: the datasheet ROW
    // ("Compatible with: Catalyst 9800-40") is a fact about the part and is the fill path the relation is later
    // derived FROM; R3 forbids asking for a partner PID as a SPEC, not storing the compatibility row. Without it
    // the module (144), accessory (180) and power (70) kinds were asked NOTHING, which scores every one of them
    // complete — the asked-nothing census in tests/cupLedger.test.ts is what found it.
    product_compatibility: cond({ field: "kind", inList: ["module", "accessory", "power", "power-injector", "cable", "antenna"] }),
    mtbf: opt, humidity_operating: opt, ip_rating: opt,
    // ONE CUP PER QUANTITY: the generated profile made `standard` REQUIRED here on 8 Sep (775 mined values);
    // those values are the 802.11 generation, which `wifi_generation` asks. Optional, so it is not a second
    // required cup; the 775 facts are listed as a rekey proposal in the report.
    standard: opt,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_cord_rating: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt,
  },
  // routers (12 Sep 2026) — SHAPED BY KIND (reviewer §6.3; kinds in src/core/routerKind.ts). Until today the whole
  // category was one flat device set behind componentKind: 5,571 parts were `device`, and 2,600 of them were line
  // cards, interface modules, processors, fabric cards, DIMMs, SSDs, antennas and optics, each asked a router's
  // thirteen questions. Now every gate is the derived `kind` (always answered) or a REQUIRED field (form_factor,
  // psu_config) — R1: no requirement hangs on an optional fact. The cups and their evidence are in the report and the
  // ledger (data/ledger/cisco-routers.json).
  routers: {
    supported_modules: opt, usb_console: opt, redundancy: opt, etsi_standards: opt, supported_protocols: opt, min_software_release: opt, emc_immunity: opt, emc_emissions: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    // --- the router itself (fixed or modular: no SKU marker separates a chassis, see routerKind.ts) ---------------
    form_factor: cond({ field: "kind", inList: [...RT_DEVICE] }),
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    // The aggregate forwarding figure Cisco prints per model ("Aggregate Throughput", "Forwarding (512B)", "IPv4
    // Forwarding Throughput (1400 bytes)"), in Gbit/s. `forwarding_rate` (Mpps) was ALSO required here and held 0
    // facts: the router "Throughput" column is Gbps and the normaliser refused every value as not a packet rate. One
    // question, one cup — forwarding_rate stays declared, optional, for the rare "720 mpps" prose.
    router_throughput: cond({ field: "kind", inList: [...RT_DEVICE] }), forwarding_rate: opt,
    // --- routers-r5 (12 Sep 2026): THE BRANCH CUPS -----------------------------------------------
    // These five moved from every device to `enterprise` alone, and the measurement is the whole
    // argument. Over the live store, the device parts holding each of them:
    //   ipsec_throughput 6  ipsec_tunnels 9  nat_sessions 9  acl_entries 9  vlan_max 15
    // and every single one is a C1100 / C8200 / C8500L / C8xxx-G2 / RV — a branch or SD-WAN box.
    // From the label side the same: the sample SKUs behind "IPsec (512B)" (29), "IPsec tunnels"
    // (25), "Number of NAT sessions" (12), "Number of IPv4 ACEs per system" (22) are C8130-G2,
    // C8200-1N-4T, C8300, C1101-4P, Cisco 4331. NOT ONE is an ASR 9000, NCS, CRS or 8000: a
    // service-provider datasheet does not publish a VPN, NAT or ACL figure at all, so asking a
    // carrier router for one was 2,000-odd slots nothing could ever close.
    ipsec_throughput: cond({ field: "kind", inList: [...RT_BRANCH] }),
    ipsec_tunnels: cond({ field: "kind", inList: [...RT_BRANCH] }),
    // WAN and LAN ports as the datasheet's own cell ("2x 1/10 GE SFP+, 2x 2.5 GE mGig RJ-45"), type s. Retyping both
    // to the `ports` struct is an open question in the report: other categories hold the keys. Branch-only for the
    // same reason — all 24 stored values are C88x/C89x/C92x, and "WAN Ports" lists C8130-G2 … C8231-G2.
    wan_interfaces: cond({ field: "kind", inList: [...RT_BRANCH] }),
    lan_interfaces: cond({ field: "kind", inList: [...RT_BRANCH] }),
    // DECLARED HERE FOR THE FIRST TIME (check 1, missing field): the store already holds 9
    // `acl_entries` (C1101 10,000 … C8500-20X6C 380,000), 9 `ipv6_routes` (C1101 260K …
    // C8500-20X6C 7M) and 15 `vlan_max` (RV130 5, RV132W/RV134W 6) facts in this category under
    // keys no routers profile declared, so completeness could not see one of them. All three are
    // listed for `cisco-datasheets:routers` in data/schema/source-fields.json.
    // vlan_max is branch-only (a carrier router's VLAN scale is not published); the routing tables
    // are asked of sp-core too, where "Route scale" (5 occurrences, NCS-55A1/NCS-57B1 samples)
    // fills them.
    acl_entries: cond({ field: "kind", inList: [...RT_BRANCH] }),
    vlan_max: cond({ field: "kind", inList: [...RT_BRANCH] }),
    // MODULE SLOTS ARE A CHASSIS'S WHOLE POINT, and until today this cup was required of nothing.
    // All 64 device `module_slots` facts sit on the modular-chassis cohort and every one is right —
    // 8808-SYS 8, 8812-SYS 12, 8818-SYS 18, NCS-5516 16, CRS-16/S 16, ASR-9904 2. (The other 173
    // stored values are on fan trays, blanks, PSUs and kits, mined from the CHASSIS SIZE in their
    // own names: a retraction proposal, and now also a `na` by kind.)
    // The second gate keeps the modular ISRs open rather than closing them: `form_factor` is
    // required of every device and has 0 facts today, so an enterprise router resolves `pending`,
    // not `na`, and the "NIM slots" label (8 occurrences, Cisco 4221(X)…4451) still has somewhere
    // to land. R1-clean: form_factor is required, never optional.
    module_slots: cond({ any: [{ field: "kind", inList: ["chassis"] }, { field: "form_factor", eq: "modular-chassis" }] }),
    // A processor carries the memory of a modular system (ASR1000-RP2 "8 GB DRAM", 8800-RP2 "64 GB DRAM").
    // A CHASSIS DOES NOT: it is sold empty and its RP holds the memory, which is why `chassis` is
    // absent from both lists (0 of 153 chassis parts hold either fact). Nor does a `forwarding`
    // engine — see the ESP note below.
    dram: cond({ field: "kind", inList: [...RT_DEVICE_PORTED, "processor", "memory"] }),
    flash: cond({ field: "kind", inList: [...RT_DEVICE_PORTED, "processor", "flash"] }),
    ipv4_routes: cond({ field: "kind", inList: [...RT_DEVICE_PORTED] }),
    ipv6_routes: cond({ field: "kind", inList: [...RT_DEVICE_PORTED] }),
    // nat_sessions is now a COUNT with a band (routers-r5). It was type `s` holding "100K"/"32M",
    // which is a number that cannot be compared or refused; the retype is global and safe because
    // all 9 facts under the key anywhere in the catalogue are in this category (measured 12 Sep
    // 2026 across all 17). Two of the nine are capability statements — "1.2M w/ default 8GB, up to
    // 2M w/ 32GB" — and the count parser silently takes the first number, so which figure is stored
    // depends on the order the sheet wrote them in. Refused by the guard in specNormalize, recorded
    // as a gap: a coin flip is not a specification.
    // poe_standard: a PoE router (C1111-8P) has no SKU marker a kind could carry, and a cond on an optional fact
    // would be R1's silent-na defect.
    nat_sessions: cond({ field: "kind", inList: [...RT_BRANCH] }), poe_standard: opt,
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026: ZERO facts across every vendor and state, ZERO sources,
    // ZERO labels. 5,758 slots in `routers` when it was required. Declared so a value is accepted.
    mgmt_ports: opt,
    // DEMOTED to opt, with the counts (check 5): psu_config has 2 label occurrences in the 23,651-label inventory
    // (both "Power Entry Module (PEM)"), 0 facts in routers and no source SEEN publishing it — required, it was 2,948
    // slots nothing could close. psu_redundant goes with it: gated on an OPTIONAL psu_config it would resolve na in
    // silence (R1). It has 26 labels and 7 mined facts, and "Redundancy" (56, "AC: N+N redundancy") maps elsewhere.
    psu_config: opt, psu_redundant: opt,
    // A PSU's wattage is what it DELIVERS (psu_rated_output), not what it draws — the switches rule. A line card
    // draws power of its own and Cisco prints it.
    power_max: cond({ field: "kind", inList: [...RT_DEVICE, "linecard"] }),
    power_typical: cond({ field: "kind", inList: [...RT_DEVICE] }),
    input_voltage: cond({ field: "kind", inList: [...RT_DEVICE, "power"] }),
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    // Airflow is how a fan or PSU is SOLD (port-side intake vs exhaust twins). Of a router it is optional: the
    // reviewer's "data-centre deploy_role" gate would hang on an optional fact (R1).
    airflow: cond({ field: "kind", inList: ["fan", "power"] }),
    temp_operating: cond({ field: "kind", inList: [...RT_DEVICE] }),
    temp_storage: cond({ field: "kind", inList: [...RT_DEVICE] }),
    humidity_operating: cond({ field: "kind", inList: [...RT_DEVICE] }),
    altitude_max: cond({ field: "kind", inList: [...RT_DEVICE] }),
    dimensions: cond({ field: "kind", inList: [...RT_DEVICE] }),
    weight: cond({ field: "kind", inList: [...RT_DEVICE] }),
    certifications: cond({ field: "kind", inList: [...RT_DEVICE] }),
    // OPTIONAL, with the counts: mtbf has 600 label occurrences in the inventory and 0 whose stored sample SKU is a
    // router part, and 3 facts (CG418-E, CG522-E and an optic). ip_rating: 0 router facts, "IP rating" 17 labels
    // (IR1800 "IP54 with IP54-KIT") — industrial routers have no SKU marker a kind could carry.
    mtbf: opt, ip_rating: opt, cooling: opt,
    // --- what plugs in ------------------------------------------------------------------------------------------
    // ROUTERS GET A PORT CUP (routers-r5, 12 Sep 2026, reviewer §6 item 1). `ports` was `na` for
    // every device kind while the store already held 48 `ports` facts on device parts — a cup being
    // filled behind a profile that said the question did not apply. They come by both paths
    // (43 description_mining, 5 html_table) and they read correctly: 8101-32FH-O 32x qsfp-dd 400G,
    // N540-6Z18G-SYS-A 18x sfp 1G + 6x sfp-plus 10G, C8300-1N1S-4T2X 2x sfp-plus 10G + 4x rj45 1G.
    // `cisco-datasheets` is listed for `ports` under `routers` in source-fields.json, so check 5 is
    // satisfied by a SEEN source and not by a hope.
    //
    // A MODULAR CHASSIS IS EXCLUDED, and that is the measured half: 0 of the 153 chassis parts hold
    // a ports fact, because a chassis is sold empty and its ports arrive on the line cards it takes.
    // Requiring it there would have created 153 permanent gaps on the one cup this change exists to
    // open.
    //
    // The strict parser is src/core/portParse.ts and this branch fixed three defects in it that the
    // corpus showed and no tidy case could — a `\b` that could not see QSFP-DD800, a missing "&"
    // separator that merged two port groups into a device that exists in no configuration, and a
    // gigaBYTE read as a speed. Every refusal is tested as hard as every success there.
    ports: cond({ field: "kind", inList: [...RT_DEVICE_PORTED, ...RT_PORTED] }),
    // Per-slot bandwidth of a line card / capacity a fabric card adds (A9K-MOD400 "400G", 8800-LC-48H 4.8 Tbit/s).
    // 40 line cards hold that figure under switching_capacity today (description mining) — a rekey proposal.
    fabric_bandwidth: cond({ field: "kind", inList: ["linecard", "fabric"] }),
    product_compatibility: cond({ field: "kind", inList: [...RT_COMPONENT] }),
    storage_capacity: cond({ field: "kind", inList: ["drive"] }),
    // 12 Sep 2026, the cross-category test: a drive is bought on capacity AND interface everywhere else
    // (servers, hyperconverged, security); routers asked only capacity. An LTE/SSD module's interface is the
    // thing that decides whether it fits.
    drive_interface: cond({ field: "kind", inList: ["drive"] }),
    memory_speed_max: cond({ field: "kind", inList: ["memory"] }),
    // An antenna is bought on gain, band and connector — the wireless set, which routers' 91 antennas were not
    // asked (reviewer round 3 §2.4 and the audit's §3.1). Same three cups, same category-independent meaning.
    antenna_gain: cond({ field: "kind", inList: ["antenna"] }),
    antenna_connector: cond({ field: "kind", inList: ["antenna"] }),
    radio_bands: cond({ field: "kind", inList: ["antenna"] }),
    cable_length: cond({ field: "kind", inList: [...RT_CABLE] }),
    plug_type: opt,
    // STRUCTURE 8 Sep 2026: 3 field(s) its documents already produce and no profile declared — invisible to completeness until now
    // (compatible_platform retired into product_compatibility, 12 Sep 2026)
    power_cord_rating: opt, chromatic_dispersion_tolerance: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, gre_tunnels: opt, layer2_features: opt, layer3_features: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, module_width_slots: opt, multicast_features: opt, network_technology: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, simultaneous_connections: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  },
  // end routers (12 Sep 2026)
  // optical-storage (12 Sep 2026) -------------------------------------------------------------------------------
  // SHAPED BY KIND (src/core/sanKind.ts). Until today every MDS part was asked one flat set behind the shared
  // device/component axis — a fabric module owed a port layout, a director chassis owed the ports its line cards
  // carry, a supervisor owed a rack height. Now:
  //   switch     a fixed fabric switch: its envelope, ports, FC rate, airflow (sold port-side intake/exhaust)
  //   director   a modular chassis: its envelope and SLOTS — never ports, which arrive on line cards
  //   linecard   ports, rate, power draw, what it fits
  //   supervisor / fabric   power draw and what it fits; a fabric module also its per-slot bandwidth
  //   power      rated output (what it DELIVERS, not power_max), input voltage, airflow, what it fits
  //   fan        airflow, what it fits · cable  length · accessory  what it fits
  //   pluggable  the optic questions (one part, DS-FC-SW-4PK=; a move to `transceiver` is proposed)
  //   software / other   nothing: licences and images (the class rules take them) and the unnamed residue
  // form_factor is no longer required: the kind already says rack switch or modular chassis. It is NOT asked of the
  // pluggable either — the normaliser picks its form-factor reader BY CATEGORY (optic words only for
  // `transceiver`, specNormalize.ts), so "SFP+" here is refused ENUM_VIOLATION: a cup nothing can fill. The
  // pluggable's fill path is its move to `transceiver` (report, PROPOSALS).
  "storage-networking": {
    fabric_services: opt, serviceability: opt, supported_protocols: opt, programming_interfaces: opt, advanced_functions: opt, diagnostics: opt, redundancy: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    form_factor: opt,
    rack_units: cond({ field: "kind", inList: [...SAN_BOX] }),
    module_slots: cond({ field: "kind", inList: ["director"] }),
    ports: cond({ field: "kind", inList: ["switch", "linecard"] }),
    data_rate: cond({ field: "kind", inList: ["switch", "linecard", "pluggable"] }),
    // OPTIONAL: an MDS datasheet quotes "aggregate bandwidth" per switch, but no label maps it here yet and 0 of
    // the category's parts hold one; forwarding_rate and latency likewise. Declared, so a value is accepted.
    switching_capacity: opt, forwarding_rate: opt, latency: opt,
    fabric_bandwidth: cond({ field: "kind", inList: ["fabric"] }),
    psu_config: opt, psu_redundant: opt, cooling: opt,
    power_max: cond({ field: "kind", inList: [...SAN_BOX, ...SAN_MODULE] }),
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    input_voltage: cond({ field: "kind", inList: ["power"] }),
    airflow: cond({ field: "kind", inList: ["switch", "power", "fan"] }),
    temp_operating: cond({ field: "kind", inList: [...SAN_BOX] }),
    humidity_operating: cond({ field: "kind", inList: [...SAN_BOX] }),
    dimensions: cond({ field: "kind", inList: [...SAN_BOX] }),
    weight: cond({ field: "kind", inList: [...SAN_BOX] }),
    certifications: cond({ field: "kind", inList: [...SAN_BOX] }),
    product_compatibility: cond({ field: "kind", inList: [...SAN_FITS] }),
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    connector: cond({ field: "kind", inList: ["pluggable"] }),
    wavelength: cond({ field: "kind", inList: ["pluggable"] }),
    reach_max: cond({ field: "kind", inList: ["pluggable"] }),
    mtbf: opt, altitude_max: opt, temp_storage: opt, power_typical: opt, dram: opt, flash: opt, power_cord_rating: opt, plug_type: opt,
    // STRUCTURE 8 Sep 2026: 7 field(s) its documents already produce and no profile declared — invisible to completeness until now
    temp_class: opt, segment_routing_features: opt, qos_features: opt, modulation_format: opt, safety_standards: opt, queues_per_port: opt, status_leds: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, product_line: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  },
  // SHAPED BY KIND (src/core/opticalKind.ts). This profile was "transponders / muxponders / DWDM systems — reuse
  // the transceiver optical fields", and it asked those fields of all 2,094 parts: a 40-channel passive mux owed
  // a data rate and a reach, an EDFA a connector and a wavelength (and never its gain), a shelf a wavelength,
  // a DCU a data rate. Now each kind is asked what it is bought on:
  //   chassis     slots, rack units, power draw and the physical envelope
  //   linecard    ports, rate, power draw, what it fits
  //   amplifier   gain, operating band (the input wavelength window, rx_wavelength), power draw, what it fits
  //   roadm       power draw, insertion loss, what it fits (an SMR / WSS / WXC routes wavelengths AND is powered)
  //   mux / dcu   insertion loss and what it fits (passive: no power draw)
  //   controller / fabric   power draw and what it fits; a fabric card also its per-slot bandwidth
  //   pluggable-* the optic questions, split exactly as `transceiver` splits them (a tunable has no fixed
  //               wavelength, a single-fibre BiDi has an Rx side); a move to `transceiver` is proposed for each
  //   power / fan / cable / accessory   rated output + input voltage / airflow / length / what it fits
  //   software / other   nothing
  // Declared OPTIONAL with the reason, per the fillability rule (a required cup nothing can fill is a permanent
  // gap): channel_count (0 labels map to it; only part NAMES state it), channel_spacing (a generated free string
  // shared by 12 categories — a numeric retype is the operator's call, see the report), total_output_power (same:
  // a string, 12 categories), dispersion_compensation (0 labels, 0 facts), tuning_range (as in `transceiver`).
  "optical-networking": {
    optical_pm: opt, input_power_range: opt, coherent_interop_standards: opt, shelf_assembly: opt, min_software_release: opt, cross_connect: opt, slot_compatibility: opt, otn_pm: opt, attenuation_dead_zone: opt, reflective_dead_zone: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    // --- the shelf --------------------------------------------------------------------------------------------
    module_slots: cond({ field: "kind", inList: [...OPN_SHELF] }),
    rack_units: cond({ field: "kind", inList: [...OPN_SHELF] }),
    dimensions: cond({ field: "kind", inList: [...OPN_SHELF] }),
    weight: cond({ field: "kind", inList: [...OPN_SHELF] }),
    temp_operating: cond({ field: "kind", inList: [...OPN_SHELF] }),
    humidity_operating: cond({ field: "kind", inList: [...OPN_SHELF] }),
    certifications: cond({ field: "kind", inList: [...OPN_SHELF] }),
    power_max: cond({ field: "kind", inList: [...OPN_POWERED] }),
    // --- cards ------------------------------------------------------------------------------------------------
    ports: cond({ field: "kind", inList: ["linecard"] }),
    data_rate: cond({ field: "kind", inList: ["linecard", ...OPN_PLUGGABLE] }),
    fabric_bandwidth: cond({ field: "kind", inList: ["fabric"] }),
    // --- amplifiers -------------------------------------------------------------------------------------------
    gain: cond({ field: "kind", inList: ["amplifier"] }),
    // The operating BAND of an amplifier is the wavelength window it accepts ("Input Wavelength 1530 - 1565 nm")
    // — rx_wavelength, into which the retired input_wavelength already folds. For a BiDi pluggable it is the
    // receive wavelength, exactly as in `transceiver`.
    rx_wavelength: cond({ field: "kind", inList: ["amplifier", "pluggable-bidi"] }),
    total_output_power: opt, noise_figure: opt, gain_flatness: opt,
    // --- wavelength routing and passives ------------------------------------------------------------------------
    insertion_loss_max: cond({ field: "kind", inList: [...OPN_WAVELENGTH_ROUTING, "dcu"] }),
    channel_count: opt, channel_spacing: opt, dispersion_compensation: opt,
    // --- pluggables (the transceiver questions) ---------------------------------------------------------------
    // form_factor OPTIONAL: the normaliser reads optic form factors only in `transceiver` (by category), so
    // "SFP+" here is refused ENUM_VIOLATION — measured with the real normaliser, 12 Sep 2026. The fill path is
    // the proposed move of these 459 parts to `transceiver`, where the question is already asked.
    form_factor: opt,
    wavelength: cond({ field: "kind", inList: [...OPN_FIXED_WAVELENGTH] }),
    reach_max: cond({ field: "kind", inList: [...OPN_PLUGGABLE] }),
    connector: cond({ field: "kind", inList: [...OPN_PLUGGABLE] }),
    tuning_range: opt, fec: opt, temp_class: opt, tx_power: opt, rx_sensitivity: opt, chromatic_dispersion_tolerance: opt,
    // --- components -------------------------------------------------------------------------------------------
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    input_voltage: cond({ field: "kind", inList: ["power"] }),
    // 12 Sep 2026, cross-category rule (reviewer round 3 item 1): a POWER SUPPLY owes the same four cups in
    // every category — what it delivers, what it takes, which way it blows, and what it fits. `airflow` was missing
    // here and in three other categories, which is the shape the new ledger test exists to catch: the same kind name
    // owing a different set because eight agents wrote eight profiles in parallel.
    airflow: cond({ field: "kind", inList: ["fan", "power"] }),
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    product_compatibility: cond({ field: "kind", inList: [...OPN_FITS] }),
    mtbf: opt, altitude_max: opt, temp_storage: opt, humidity_storage: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    // cd_tolerance REMOVED 11 Sep 2026: a duplicate of chromatic_dispersion_tolerance (same label, same
    // unit, zero facts), which this category already declares. See the note under `transceiver`.
    breakout_point_length: opt, channel_bandwidth: opt, cin: opt, color: opt, color_options: opt, country_of_origin: opt, modulation_type: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, pmd: opt, product_line: opt, rear_clearance: opt, restore_threshold: opt, rf_attenuation_range: opt, rf_bandwidth: opt, rf_input_return_loss: opt, rf_output_return_loss: opt, rf_response_flatness: opt, rf_test_point: opt, rf_tilt: opt, series_release_date: opt, switching_threshold: opt, temp_operating_extended: opt, thermal_shock: opt,
  },
  // end optical-storage
  // Line cards, network modules, interface cards.
  //
  // --- modules-misc (12 Sep 2026): SHAPED BY `moduleKind` --------------------------------------
  // It was `deviceOnly`, so all 1,364 hardware parts were `device` on the generic axis (which
  // names only power/fan/cable/accessory/software and defaults to device) and every one was asked
  // the same seven fields. A Panduit patch panel was asked a port count, a blank faceplate an
  // operating temperature, a DSP card a form factor from the CHASSIS enum. See moduleKind.ts for
  // the axis and the marker measurements; the per-cup evidence is in
  // docs/reports/schema-modules-misc-2026-09-12.md.
  //
  // WHAT EACH KIND IS ASKED, and the facts that decided it (parts holding the key / parts). Counts
  // RE-READ 12 Sep 2026 (round 8) over the 1,192 Cisco hardware rows the reclassify run left — the
  // 1,364 the block above quotes was the pre-run denominator — and the distribution sums to 1,192:
  //   interface 476  ports 43 · power_max 10 · poe_standard 9 · weight 8
  //   device     99  the envelope: a whole router or chassis filed here (a MOVE proposal)
  //   accessory  98  product_compatibility only
  //   cable      96  cable_length
  //   optic      94  a transceiver filed here (a MOVE proposal) — form_factor, data_rate, connector
  //   power      69  psu_rated_output, input_voltage, airflow
  //   radio      52  ieee_standards 16
  //   cellular   51  cellular_bands (14 today, 51 after the `im-radio-bands-mhz` rekey of this date)
  //   voice      51  ports (its names state them; see MOD_PORTED)
  //   service    42  power_max
  //   module     22  the DEFAULT — product_compatibility only, the one question every component answers
  //   mux        17  insertion_loss_max (NEW) — a passive OADM filed here (a MOVE proposal)
  //   memory     13  dram, flash, memory_speed_max
  //   fabric      8  fabric_bandwidth (NEW) — three of the eight were `interface`, asked a port count
  //   fan         4  airflow
  //
  // TWO CUPS WERE DEMOTED, EACH WITH ITS COUNT — see the report for the full argument:
  //   form_factor   0 facts of 1,364, and it COULD NOT HAVE ONE: the enum domain is a chassis
  //                 domain (rack-19 / desktop / din-rail / modular-chassis) and specNormalize maps
  //                 a form-factor string through FORM_FACTOR_SWITCH for every category but
  //                 `transceiver`, so "Single Wide HWIC form factor" — 42 of the key's 145 label
  //                 occurrences, and the sample Cisco's own inventory carries for it — can only
  //                 come back ENUM_VIOLATION. It stays required of `device` and `optic`, whose
  //                 values the domain does fit, and is OPTIONAL for the eleven module kinds. The
  //                 missing cup is `module_type` (the slot type: "Shared Port Adapter Interface
  //                 Processor (SIP)", 5 facts) — an OPEN ITEM in the report, because requiring it
  //                 needs data/schema/source-fields.json regenerated and that is the parent's run.
  //   poe_standard  9 facts on the 476 interface parts, and a PoE standard is a property of the
  //                 minority of port-bearing modules that SUPPLY power. No derived signal separates
  //                 them from a POS/ATM line card, which has none and never will, so requiring it of
  //                 all 476 would open 467 gaps nothing can close.
  //                 THE NINE WERE READ 12 Sep 2026 (round 8) and the list that stood here was wrong:
  //                 it named "the SM-ES2/ES3 EtherSwitch modules, ILPM-4/8", and NONE of those holds
  //                 one. All nine are WS-X4xxx Catalyst 4500 PoE line cards — WS-X4548-GB-RJ45V,
  //                 WS-X4506-GB-T, WS-X4248-RJ45V(=), WS-X4248-RJ21V=, WS-X4524-GB-RJ45V(=),
  //                 WS-X4224-RJ45V=, WS-X4548-RJ45V+ — every one "802.3af" and own, not inherited.
  //                 The 22 EtherSwitch rows the round-8 kind rule moved off `power` hold zero between
  //                 them. The demotion is unchanged; the example list is now the one in the store.
  "interfaces-modules": {
    itu_channel: opt, jacket_material: opt, jacket_color: opt, rx_wavelength: opt, supported_transceivers: opt, supported_modules: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    // WHAT IT FITS — the first question asked of anything that plugs in, and asked of nothing in
    // this category until today. Fillable: "Product compatibility" (74), "Supervisor engines
    // supported" (25), "Product Compatibility" (18), "Compatibility" (12) and nineteen more labels
    // = 270 occurrences in the Cisco datasheet vocabulary; 9 parts hold a value already.
    product_compatibility: cond({ field: "kind", inList: [...MOD_COMPONENT] }),
    // The chassis enum fits a whole device and an optic's cage, not a module — see the header.
    form_factor: cond({ field: "kind", inList: ["device", "optic"] }),
    ports: cond({ field: "kind", inList: [...MOD_PORTED, "device"] }),
    uplink_ports: opt, poe_standard: opt, module_slots: opt,
    // A CARD DRAWS POWER AND CISCO PRINTS IT: 10 of the 13 power_max facts here sit on interface
    // modules, [5 .. 80] W (WS-X4548-GB-RJ45 60 W, WS-X4506-GB-T 30 W). A service module runs a
    // workload and draws its own too. A PSU DELIVERS rather than draws — psu_rated_output below,
    // the same split switches made on 11 Sep 2026.
    power_max: cond({ field: "kind", inList: ["interface", "service", "device", "fabric"] }),
    // A FABRIC CARD HAS NO PORTS AND IS BOUGHT ON PER-SLOT BANDWIDTH (12 Sep 2026, round 8). Three of
    // the eight MDS crossbar fabric modules here were reaching the `^DS-X\d` line-card marker and
    // being asked a port count. `fabric` is the kind name `optical-networking` (10 parts) and
    // `storage-networking` (24) already use for the same card, so the cup set is theirs verbatim —
    // fabric_bandwidth, power_max, product_compatibility — which is what keeps the one-cup-set-per-kind
    // test green.
    // FILLABILITY, STATED RATHER THAN ASSUMED: 13 occurrences of "Switch fabric connection" map to this
    // key here ("40 Gbps (80 Gbps full duplex)", "160 Gbps in 6807-XL chassis" — exactly the quantity),
    // and 0 of these 8 rows holds a value, because no MDS fabric datasheet has been acquired. NO alias
    // rule is added: the other five spellings that carry the figure ("Per-slot switching capacity" 11,
    // "Capacity (per slot)" 7, "Per-slot Switching Capacity" 5, "Per Slot Switching Capacity" 4,
    // "Per-slot switching Capacity" 4 = 31 occurrences) are deliberately SCOPED to `switches` — and
    // rightly, because every sample SKU under them is a Catalyst supervisor or an N9K fabric module.
    // Checked with the live mapLabel in all three categories rather than with labels.json's own `state`
    // column, which was written on 8 Sep and still calls all five "unmapped".
    fabric_bandwidth: cond({ field: "kind", inList: ["fabric"] }),
    // A PASSIVE MUX IS BOUGHT ON ITS INSERTION LOSS (12 Sep 2026, round 8). 17 passive WDM mux,
    // demux, OADM and splitter cards were in the default, asked only what they fit. Same argument as
    // `fabric`: `mux` is `optical-networking`'s own kind name for the same card (275 parts) and this
    // is its cup set there — insertion_loss_max, product_compatibility — so the sets match by
    // construction. Fillable: "Insertion loss" (27) / "Insertion Loss" (10) / "Insertion Loss (see
    // note)" (9) = 46 usable occurrences, all three MAPPED to this key. The ledger reports 55 because a
    // fourth rule sends "Multi fiber Connector" (9) here as well, and THAT NINE IS NOT EVIDENCE: its
    // values are "Insertion Loss" and "Single Mode" — a transposed column whose own author noted the
    // routing and kept it — so a numeric cup can never take one. 0 of these 17 rows holds a value,
    // because their documents have not been acquired. That is a coverage gap in a cup that should
    // exist, not a cup that should not — the distinction the `cellular_category` note below turns the
    // other way.
    insertion_loss_max: cond({ field: "kind", inList: ["mux"] }),
    // THE ENVELOPE BELONGS TO THE BOX (12 Sep 2026, after the reviewer's round 3 asked why this category alone
    // required it of components). The block that stood here asked certifications, dimensions, temperature,
    // humidity and weight of interface, voice, cellular, radio, service, power and fan, on measured evidence —
    // "certifications interface 55 / power 34 · temp_operating power 41 · humidity_operating power 50". Every one
    // of those numbers is an INHERITED fact. Counting own facts only: interface certifications 3 of 55, power
    // humidity 0 of 50, power temperature 0 of 41, power certifications 0 of 34, cellular certifications 0 of 17.
    // The group-inheritance writer had copied each machine's environmental rows onto its components, and the
    // profile was then built on the copies as though a NIM published a humidity range. Catalogue-wide the same
    // holds: across 18,246 component-kind parts in fourteen categories, 134 (0.7 %) hold an own weight fact and
    // the other four cups are rarer still — which is also why the reviewer's "every component owes weight" is not
    // adopted. So the envelope is asked of `device` only, the one kind here that IS a whole box, and the eight
    // other categories that never asked it were right.
    dimensions: cond({ field: "kind", inList: ["device"] }),
    temp_operating: cond({ field: "kind", inList: ["device"] }),
    humidity_operating: cond({ field: "kind", inList: ["device"] }),
    certifications: cond({ field: "kind", inList: ["device"] }),
    weight: opt,
    // A cellular module is bought on its bands: "Bands supported" (33) and "Bands" (23) = 56
    // occurrences, 14 parts hold one.
    // 12 Sep 2026 (round 8) — THE R2 NOTE THAT STOOD HERE WAS WRONG, and reading the rows is what
    // showed it. It said `radio_bands`' 51 facts here "all sit on cellular ROUTER bundles". They do
    // not: 38 of the 51 sit on the cellular MODULES themselves (EHWIC-4G-LTE-A "700 MHz",
    // EHWIC-3G-EVDO-V "800/1900MHz"), 13 on the router bundles, and EHWIC-4G-LTE-A holds BOTH
    // `radio_bands` "700 MHz" and `cellular_bands` "LTE band 17 (700 MHz) & band 4" — one quantity in
    // two cups on one part, which is exactly R2. The producer is `im-radio-bands-mhz` in
    // data/schema/description-patterns.json, a rule scoped to THIS category, and it is rekeyed to
    // `cellular_bands` today: all 48 of its live matches here are cellular band lists, checked one by
    // one. `radio_bands` is NOT retired globally, because catalogue-wide it holds three different
    // quantities — Wi-Fi bands in `wireless` (145 facts, "2.4 GHz"), cellular bands here, and an AC
    // MAINS FREQUENCY on 19 `switches` parts and 7 HPE parts in this category ("50Hz/60Hz",
    // "47 to 63 Hz"), which is `input_frequency` wearing the wrong cup. Both of those are proposals
    // in the report for the categories that own them.
    cellular_bands: cond({ field: "kind", inList: ["cellular"] }),
    // `cellular_category` STAYS OPTIONAL, WITH THE COUNTS, and round 8 asked for it to be required of
    // the cellular kinds. Measured before writing it: of the 51 cellular rows, TWO state a category
    // (NIM-LTEA-EA= and NIM-LTEA-LA=, "CAT6 LTE Advanced NIM …") and 49 do not — an EHWIC-3G-EVDO has
    // no LTE category at all, and the 3G/4G-EHWIC generation this category holds pre-dates the
    // categories entirely. One label maps to the key, "Cellular" (38 occurrences), and EVERY sample
    // SKU under it is a `routers` C1109/C1111/C8151 — none is in this category. The three labels that
    // do name a category on a module put it in the LABEL and not the value ("WAN [LTE (CAT 6)]" 23 and
    // "WAN [LTE (CAT4)]" 10 both hold "Yes"/"No"; "Theoretical Category 4 download/upload speeds" 3
    // holds a speed), so nothing here can read one. Requiring it would open 49 gaps no source can
    // close — the fillability rule's own case for a demotion.
    // AND ITS DEFINITION IS THE SHAPE THAT CANNOT REFUSE A WRONG VALUE: a GENERATED free string with no
    // domain. All 31 live facts are in `routers` — 17 "CAT6", 11 "CAT4", and THREE prose capability
    // statements ("Optional Pluggable Module – LTE or 5G", "Embedded 5G 3GPP Release 17 module with
    // dual nano SIM slots") which are a capability statement and not a specification. Retyping it to an
    // `e` over the domain the catalogue's own values give — [cat-4|cat-6|cat-12|cat-18|5g-nr] — would
    // refuse those three and canonicalise the other 28, and it is a GLOBAL change to a key another
    // agent's category owns every fact of. So it is a costed proposal in the report with the exact
    // patch and the three affected SKUs, not a line here.
    cellular_category: opt, cellular_max_speed: opt, radio_bands: opt, antenna_gain: opt, antenna_type: opt,
    // An 802.11 radio module is bought on the standards it speaks: 16 of the 46 already hold it
    // ("802.11 B,G" on HWIC-AP-G-A).
    ieee_standards: cond({ field: "kind", inList: ["radio"] }),
    // A PSU's wattage is what it DELIVERS. 0 facts here and only 2 label occurrences, but the same
    // key holds 277 in `switches` after the 11 Sep rekey, and the figure is stated in the NAME of
    // 34 of these 77 ("Cisco Small Business Power over Ethernet Injector-30W", "Cisco ASR1000-X
    // 1100W AC Power Supply") — a description_mining derivation, which is the third form of
    // evidence the fillability rule accepts.
    psu_rated_output: cond({ field: "kind", inList: ["power"] }),
    // 12 Sep 2026: `input_voltage` was optional here while seven other categories require it of a power supply —
    // the cross-category contract (psu_rated_output, input_voltage, airflow, product_compatibility).
    input_voltage: cond({ field: "kind", inList: ["power"] }),
    psu_options: opt, mounting: opt,
    // Airflow direction is how a FAN is sold ("Airflow" 119 / "Air flow" 16 / "Air Flow" 2 = 137
    // occurrences). Deliberately NOT asked of `power`: the 77 here are branch-router bricks and
    // PoE injectors with no airflow spec, unlike a data-centre supply.
    // 12 Sep 2026, cross-category rule (reviewer round 3 item 1): a POWER SUPPLY owes the same four cups in
    // every category — what it delivers, what it takes, which way it blows, and what it fits. `airflow` was missing
    // here and in three other categories, which is the shape the new ledger test exists to catch: the same kind name
    // owing a different set because eight agents wrote eight profiles in parallel.
    airflow: cond({ field: "kind", inList: ["fan", "power"] }),
    // A cable is bought by its length; "Length" (58) + "Cord length" (3) = 61 occurrences, 3 facts.
    cable_length: cond({ field: "kind", inList: ["cable"] }),
    // A memory or storage card is bought on capacity: 418 label occurrences, and the value is in
    // the SKU of 9 of the 11 (SD-X45-2GB-E, USB-X45-4GB-E, MEM-2951-512U2.5GB).
    // 12 Sep 2026 (reviewer round 3 §3.1, and the new cross-category test): the cup was
    // `storage_capacity`, which is a DRIVE's, while routers and servers ask a memory kind for `dram` and a flash
    // card for `flash`. The same eleven parts, the right cup: DRAM modules answer `dram`, SD/USB/CF cards answer
    // `flash`. storage_capacity stays declared for the drive kinds this category does not have.
    dram: cond({ field: "kind", inList: ["memory"] }),
    flash: cond({ field: "kind", inList: ["memory"] }),
    memory_speed_max: cond({ field: "kind", inList: ["memory"] }),
    // `fxs_ports` AND `fxo_ports` STAY OPTIONAL BECAUSE THIS CATEGORY HAS NO ANALOG VOICE MODULE AT
    // ALL (12 Sep 2026, round 8, which asked for them to be required of `voice`). Measured first:
    // ZERO of the 51 `voice` rows here states an FXS or an FXO count in its SKU or its name, and the
    // named examples the request cited are all filed elsewhere — VIC3-4FXS/DID, NIM-4FXSP, VIC2-2FXS
    // and EM-HDA-8FXS in `routers` (50 such rows), SM-D-72FXS and EM-HDA-6FXO in
    // `unified-communications` (34), one in `switches`. What IS here is 51 DIGITAL modules: T1/E1/J1
    // multiflex trunks, high-density voice NMs and DSP farms ("Dual-Port 48 Channel T1 Voice/Fax
    // Network Module", "36 Port DSP Farm Bundle"). An E1 trunk card has no FXS port, so requiring one
    // of it would be 102 slots that are not merely unfillable but not applicable — and `na` is worse
    // than `opt` here, because it would close the question for the first real FXS card to land.
    // The cup these 51 rows actually lack is a VOICE CHANNEL COUNT, which every one of them states in
    // its own name and which no dictionary key holds (`voice_channels` and `dsp_channels` do not
    // exist; `voice_lines` is a phone's line count, 6 facts, all in `collaboration-endpoints`).
    // Adding a key needs the dictionary and source-fields regenerated, which is the parent's run, so
    // it is a proposal in the report with the label evidence beside it.
    // They are BANDED anyway (BAND_OVERRIDES below): both are generated definitions with no band, so
    // until today nothing could have refused "1905 FXS ports" if description mining had ever written
    // one — the same shape as the 100-port transceiver.
    storage_capacity: opt, voice_lines: opt, fxs_ports: opt, fxo_ports: opt,
    // The optical questions this profile can express, asked of the 94 transceivers filed here so
    // that their MOVE to `transceiver` (where opticKind asks the full set) is visible rather than
    // silent: 14 hold a data_rate, 6 a wavelength, 1 a connector.
    data_rate: cond({ field: "kind", inList: ["optic"] }),
    connector: cond({ field: "kind", inList: ["optic"] }),
    wavelength: opt, standard: opt, media: opt, reach_max: opt,
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    layer: opt, module_type: opt, compatible_platform: opt, installation_type: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    // cd_tolerance -> chromatic_dispersion_tolerance, 11 Sep 2026: one key per quantity (see `transceiver`).
    breakout_point_length: opt, chromatic_dispersion_tolerance: opt, channel_bandwidth: opt, color: opt, color_options: opt, country_of_origin: opt, input_wavelength: opt, modulation_type: opt, module_width_slots: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
  },
};

// The transceiver profile overrides two dictionary entries whose canonical unit differs from the
// switch context. Weight on an optic is grams, not kilograms; a shared dictionary entry with a
// per-category unit override keeps one definition of "Gewicht" without forcing 0.008 kg values.
export const UNIT_OVERRIDES: Record<string, Record<string, string>> = {
  transceiver: { weight: "g" },
};

// Same reasoning for enum domains. "Bauform" on a switch means rack-19/desktop/DIN-rail;
// "Formfaktor" on an optic means SFP/QSFP28/... Both are legitimately form_factor — one concept,
// two domains. Without this override the alias map would either need a second key (drift) or
// every optic would fail ENUM_VIOLATION against the switch domain.
export const DOMAIN_OVERRIDES: Record<string, Record<string, string[]>> = {
  transceiver: {
    // cpak and osfp ADDED 11 Sep 2026: 21 CPAK and 7 OSFP transceivers in the catalogue had no value
    // their form factor could take.
    // sfp-dd ADDED the same night, CORRECTING the line that stood here ("SFP-DD ... zero parts"): that
    // count was CISCO-ONLY. Catalogue-wide 26 SFP-DD transceivers exist (Arista 9, Dell EMC 3, Extreme 3,
    // Juniper 11), and every one had been STORED as "sfp" — the catch-all /sfp/ read the double-density
    // module as a single-lane one. The domain is shared by every vendor in the category, so the count that
    // decides it must be too. OSFP-XD still has no part and is refused by name (specNormalize.ts).
    // qsfp112 and dsfp ADDED 12 Sep 2026, the same fold found by listing every cage token against its stored
    // value: 12 QSFP112 parts (Cisco QSFP-400G-VR4 among them) were stored as "qsfp-plus", a 112G-lane cage
    // filed as a 40G one, and 9 DSFP parts (Arista) as "sfp". Both exist, so both are in the domain; SFP112
    // has no part yet and is refused by name.
    form_factor: ["gbic", "x2", "xenpak", "xfp", "sfp", "sfp-plus", "sfp28", "sfp56", "sfp-dd", "dsfp",
      "qsfp-plus", "qsfp28", "qsfp56", "qsfp112", "qsfp-dd", "cfp", "cfp2", "cpak", "osfp"],
  },
  // servers (12 Sep 2026) — reviewer §4 servers b). The shared domain could not express a blade or a
  // node, so a UCS B200 ("half-width blade"), a B460 ("full-width"), an X210c ("compute node") or a UCS-E
  // module ("ISR service module") had no value its form factor could take, and the enum is what refuses a
  // wrong one when extraction writes it. rack-19 / desktop / din-rail / modular-chassis are kept. Scoped to
  // the three UCS categories: the shared dictionary domain is not changed.
  ...Object.fromEntries(UCS_PROFILE_CATEGORIES.map((c) => [c, {
    form_factor: ["rack-19", "desktop", "din-rail", "modular-chassis", "blade-half", "blade-full", "compute-node", "router-module"],
  }])),
};

// And for plausibility BANDS — 11 Sep 2026, raised by the reviewer and confirmed by replay. The
// band lived only on the dictionary entry, and power_max's is a switch's: [1, 30000] W. On an optic
// that is wrong at both ends: the real normaliser refuses "0.8 W" (RANGE_VIOLATION) and not one of
// the 520 stored transceiver power facts is below 1 W, while the same band would store a 3 kW SFP.
// Measured distribution: 376 of 520 under 5 W, the largest real value in the 20s (coherent QSFP-DD);
// the one value above 40 W is a German-comma misread ("2,475 W (typisch)" stored as 2475) on a
// tier-0 seed row, listed for the operator rather than silently changed. Like the unit and domain
// overrides, a per-category band is not representable in field_dictionary and is not synced.
// collab (12 Sep 2026): three generated counts that become REQUIRED in the collaboration categories carried no
// band, and a required number with no range cannot refuse "100 ports on a one-port optic". Per category, not on
// the shared dictionary entry (routers declares fxs_ports too). Checked against the stored values:
//   voice_lines  6 facts, 1..12 (SPA509G "12 Line IP Phone"); a phone plus KEMs tops out in the tens.
//   fxs_ports   10 facts, 2..144 (VG350-144FXS); the densest Cisco gateway is VG350-160FXS.
//   fxo_ports    6 facts, 0..6 — optional, banded because 0 is a real answer ("0 FXO") and must not be refused.
const COLLAB_BANDS: Record<string, [number, number]> = { voice_lines: [1, 128], fxs_ports: [1, 512], fxo_ports: [0, 512] };
// end collab
export const BAND_OVERRIDES: Record<string, Record<string, [number, number]>> = {
  transceiver: { power_max: [0.1, 40] },
  // wireless (12 Sep 2026): power_max is now asked of APs (a few W to ~60 W on UPOE), controllers (9800-80
  // 1100 W PSUs) and UCS-based appliances; the switch band [1, 30000] would store a 3 kW access point. The 38
  // stored values (30..950 W) are PSU RATINGS mined from supply names, filed under the wrong key (proposal).
  // wireless-r7 (12 Sep 2026): router_throughput is a ROUTER's band globally ([0.005, 10000] Gbit/s)
  // and routers override it to a million. A wireless controller's published figures run 5 to 100
  // Gbit/s (9800-L 5, CW9800L 10, 9800-40 40, CW9800M 50, 9800-80 80, CW9800H 100), and the band is
  // asked to do real work here: the figure sits in the SAME datasheet table as "Maximum WLANs 4096",
  // "Maximum VLANs 4096" and "Maximum site tags 6000", so a neighbouring row read into this cup is
  // the accident that actually happens. [1, 200] refuses all three and admits twice the largest real
  // controller.
  wireless: { power_max: [1, 2500], router_throughput: [1, 200] },
  // servers (12 Sep 2026). Bands for the required numeric cups whose dictionary entry has none (generated
  // keys), checked against the stored own values in the three categories on 12 Sep 2026:
  //   tdp               stored 40..400 W (1,823)       band 5..1000     (a 500 W Xeon 6 / MI300-class part fits)
  //   clock_speed       stored 1.8..4.0 GHz (301)      band 0.5..6
  //   cpu_cache         stored 12..1152 MB (333)       band 1..2048     (1152 = AMD 9684X 3D V-Cache, real)
  //   memory_speed_max  stored 2400..6400 MT/s (364)   band 400..12800  (DDR2-400 through MRDIMM-8800 and margin)
  //   drive_bays        stored 4..56 (33)              band 1..120
  // Shared keys with an existing band (cpu_cores 1..512, dram 0.06..512, storage_capacity 1..200000 GB,
  // psu_rated_output 5..20000, weight, temperatures) were checked against the same stored values and kept.
  ...Object.fromEntries(UCS_PROFILE_CATEGORIES.map((c) => [c, {
    tdp: [5, 1000] as [number, number], clock_speed: [0.5, 6] as [number, number], cpu_cache: [1, 2048] as [number, number],
    memory_speed_max: [400, 12800] as [number, number], drive_bays: [1, 120] as [number, number],
  }])),
  // video (12 Sep 2026). Checked against the stored values and the 466 dBm figures in video part names:
  //   tx_power  global [-40, 20] is an optic's. An EDFA's output is the same quantity (optical output power,
  //             dBm) and reaches 24 dBm per port (P2-EDFA-MOD-1X24-SA) and 26.5 dBm total (4005262 "FTTH Post
  //             Amp, 26.5dBm"); stored video values run 0..20. [-10, 30] refuses a mW or W figure read as dBm.
  //   rf_gain   no global band. Label values 32 (forward) and -2 (reverse) dB on the GS7000 node sheet; a launch
  //             amplifier's gain is ~30-40 dB. [-10, 60]. 0 stored facts anywhere.
  //   insertion_loss_max  no global band. Passive sheet values "<0.8" to "4.5" dB; a DCM's loss is higher.
  //             [0, 20]. 0 stored facts anywhere.
  video: { tx_power: [-10, 30], rf_gain: [-10, 60], insertion_loss_max: [0, 20] },
  // collab (12 Sep 2026)
  "unified-communications": COLLAB_BANDS, "collaboration-endpoints": COLLAB_BANDS, conferencing: COLLAB_BANDS,
  // routers (12 Sep 2026, reviewer §6.4) — a router band is never the switch band by inheritance. Each checked against
  // the stored routers values AND the label values in the cisco-datasheets inventory (report, band table):
  routers: {
    // 0.1 ("100 Mbps", ISR 4331 default) .. 518,400 ("518.4T", Cisco 8818 with 800G LCs). The dictionary's 1e4 and the
    // reviewer's 2e5 both refuse the 8812/8818 system figures. 0 stored routers facts to refuse.
    router_throughput: [0.001, 1000000],
    // stored 0.46 ("Up to 460Mbps", C8200L) .. 100 (C8500-20X6C); largest label "Up to 400Gbps".
    ipsec_throughput: [0.001, 10000],
    // stored 0.125 (MEM-243-1X128D, a 128 MB DIMM) .. 64 (8800-RP2). The reviewer's 0.25 floor refuses 2 real DIMMs.
    dram: [0.125, 512],
    // stored 280K (C1101-4P) .. 7M/16M (C8500-20X6C). The 1,000 floor refuses the 18 stored "June, 2024" dates read
    // as 2024 routes — which the dictionary's [10, 1e7] admits — and nothing real.
    ipv4_routes: [1000, 100000000],
    // stored 700 .. 4,000; largest label "10,000".
    ipsec_tunnels: [1, 100000],
    // 8818 "33.4KW" typical with 800G LCs, 8812 "22KW": the dictionary's 30 kW refuses the first. Stored max 3,000.
    power_max: [1, 60000],
    power_typical: [1, 50000],
    // stored min 4.2 m on 18 parts is "13.800 ft" misread; a 100 m floor refuses it and no real ceiling.
    altitude_max: [100, 10000],
  },
  // optical-storage (12 Sep 2026). Checked against the category's stored values (report, BANDS):
  //   power_max           39 facts, 1 to 19 W — every one on a PLUGGABLE (ONS-SE-4G-MM "1W", ONS-CC-40G-LR4 19),
  //                       which this category now asks; the global floor of 1 W would refuse a 0.8 W SFP. The
  //                       ceiling stays the global 30 kW (an NCS 4016 shelf draws several kW).
  //   data_rate           294 facts, 10 to 400 Gbit/s; the floor comes down to 1 Mbit/s because a CEM line card
  //                       carries T1/E1 (NCS4200-48T1E1-CE, 1.544 Mbit/s), which the global 0.1 Gbit/s refuses.
  //   insertion_loss_max  0 facts; the inventory's own values run 0.25 dB to 13.5 dB ("Insertion loss COM-RX ->
  //                       EXP-TX"); the curated entry had NO band, and it is required of a mux, a ROADM and a DCU.
  "optical-networking": { power_max: [0.1, 30000], data_rate: [0.001, 1600], insertion_loss_max: [0, 30] },
  // end optical-storage
  // --- modules-r8 (12 Sep 2026) ----------------------------------------------------------------
  // Three numeric cups this category names whose DICTIONARY entry carries no band, which is the
  // definition nothing can refuse a wrong value with. Each band is read off the catalogue, not chosen:
  //   insertion_loss_max  BECOMES REQUIRED of `mux` today, and the curated dictionary entry has no
  //                       band at all. The inventory's own values for this label run 0.25 dB
  //                       ("I.L. 0.25 dB(max)") to 13.5 dB ("Insertion loss COM-RX -> EXP-TX"), and
  //                       a DCM's is higher; [0, 30] is `optical-networking`'s band for the same cup
  //                       on the same cards, kept identical on purpose — a band that differs between
  //                       two categories asking one kind the same question is a second definition.
  //   fxs_ports           OPTIONAL here (see the note in the profile: zero of the 51 voice rows state
  //                       one), banded so a mining rule could never write "1905 FXS ports". Stored
  //                       catalogue-wide: 10 facts in `unified-communications`, 2..144 (SM-D-72FXS,
  //                       VG350-144FXS) and 4 in `routers`, 8..72. The densest Cisco gateway is
  //                       VG350-160FXS, so 512 leaves room for a chassis nobody has shipped yet.
  //   fxo_ports           6 facts, 0..6. The FLOOR IS ZERO AND MUST STAY ZERO: "0 FXO" is a real
  //                       answer a datasheet prints, and a floor of 1 would refuse it.
  // The three values are the same as the collab categories' COLLAB_BANDS for the two voice keys,
  // which is deliberate: one band per key unless the product really differs.
  "interfaces-modules": { insertion_loss_max: [0, 30], fxs_ports: [1, 512], fxo_ports: [0, 512] },
  // end modules-r8
};

export function unitFor(category: string, key: string): string | undefined {
  return UNIT_OVERRIDES[category]?.[key] ?? FIELD_DICTIONARY[key]?.unit;
}

export function bandFor(category: string, key: string): [number, number] | undefined {
  return BAND_OVERRIDES[category]?.[key] ?? FIELD_DICTIONARY[key]?.band;
}

export function domainFor(category: string, key: string): string[] | undefined {
  return DOMAIN_OVERRIDES[category]?.[key] ?? FIELD_DICTIONARY[key]?.domain;
}

// ---------------------------------------------------------------------------------------------
// Struct shapes: the declaration, enforced
// ---------------------------------------------------------------------------------------------
//
// Seven dictionary entries carry a `shape` string — `dimensions` is "{ h: n, w: n, d: n }",
// `reach_max` is "list{ medium: s, distanz: n(m) }". Until 10 Sep 2026 NOTHING read those strings.
// They were documentation, and this repo's recurring lesson is that a declared constant nothing
// reads will drift: measured, ALL 471 live `reach_max` facts are stored as
// `{ m: 550, values_m: [220, 275, 500, 500, 550, 550] }` — a different shape that carries no
// `medium` at all. Six reach figures for six different fibre types, collapsed to one number with
// no record of which medium any of them belongs to.
//
// So a shape is now checkable, and scripts/audit-field-registry.ts --cost runs it over the store.

/** The keys a declared shape promises, and whether it promises a LIST of them. */
export function parseShape(shape?: string): { list: boolean; keys: string[] } | null {
  if (!shape || !shape.trim()) return null;
  const list = /^list\s*\{/.test(shape.trim());
  const body = shape.trim().replace(/^list\s*/, "");
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  // Keys are the identifiers that appear before a colon at the TOP level of the braces. The value
  // side can itself contain colons and parentheses — "port_typ: e(rj45|sfp|...)" — so the scan
  // tracks depth and only takes an identifier when nothing is open.
  const inner = body.slice(1, -1);
  const keys: string[] = [];
  let depth = 0, token = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "{" || ch === "[") { depth++; token = ""; continue; }
    if (ch === ")" || ch === "}" || ch === "]") { depth--; token = ""; continue; }
    if (depth > 0) continue;
    if (ch === ":") { const m = /([A-Za-z_][\w]*)\s*$/.exec(token); if (m) keys.push(m[1]); token = ""; continue; }
    if (ch === ",") { token = ""; continue; }
    token += ch;
  }
  return { list, keys };
}

/**
 * Why a stored value does not match its field's declared shape, or null when it does (or when the
 * field declares no shape, which is a different finding and not this function's business).
 *
 * DELIBERATELY NOT A FULL TYPE CHECK. It asserts the STRUCTURE — list versus object, and the key
 * set — because that is what a consumer indexes on and what silently broke here. Checking the
 * value types too would refuse a legitimate integer where a float was declared and turn a useful
 * check into noise.
 */
export function structShapeProblem(key: string, value: unknown): string | null {
  const parsed = parseShape(FIELD_DICTIONARY[key]?.shape);
  if (!parsed || parsed.keys.length === 0) return null;
  const { list, keys } = parsed;
  if (list && !Array.isArray(value)) return `declared a list of { ${keys.join(", ")} } and stored a ${Array.isArray(value) ? "list" : typeof value}`;
  if (!list && (Array.isArray(value) || value === null || typeof value !== "object")) {
    return `declared { ${keys.join(", ")} } and stored a ${Array.isArray(value) ? "list" : value === null ? "null" : typeof value}`;
  }
  const items = list ? (value as unknown[]) : [value];
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return `an item is ${Array.isArray(item) ? "a list" : item === null ? "null" : typeof item}, not an object`;
    }
    const have = Object.keys(item as Record<string, unknown>);
    const extra = have.filter((k) => !keys.includes(k));
    if (extra.length) return `undeclared key(s) ${extra.join(", ")} — the shape promises ${keys.join(", ")}`;
    if (!have.some((k) => keys.includes(k))) return `none of the declared keys (${keys.join(", ")}) is present; it has ${have.join(", ") || "nothing"}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/** A part's own field values, keyed by field_key (normalised values, not raw strings). */
export type PartValues = Record<string, unknown>;

export function evalCondition(c: Condition, v: PartValues): boolean {
  if ("any" in c) return c.any.some((x) => evalCondition(x, v));
  if ("all" in c) return c.all.every((x) => evalCondition(x, v));
  const actual = v[c.field];
  if ("eq" in c) return actual === c.eq;
  if ("ne" in c) return actual !== undefined && actual !== c.ne;
  if ("inList" in c) return actual !== undefined && c.inList.includes(actual as string | number);
  if ("gte" in c) return typeof actual === "number" && actual >= c.gte;
  if ("truthy" in c) return Boolean(actual);
  return false;
}

/**
 * True when the ANSWERED fields alone already make the condition false, so that no answer to the
 * unanswered ones could ever make it true. This is what separates `na` from `pending`.
 *
 * Added 11 Sep 2026. requirementFor used to call a false condition `pending` whenever ANY of its
 * gate fields was unanswered and required — right for a single field and for `any`, wrong for
 * `all`: in `{ all: [kind is switch, poe_standard is not none] }` a LINE CARD fails the first clause
 * for good, yet its unanswered poe_standard kept the whole condition pending, so the card was
 * counted as owing a PoE budget for ever. For a single field and for `any` this returns exactly
 * what the old path concluded, so only `all` changes.
 */
export function settledFalse(c: Condition, v: PartValues): boolean {
  if ("any" in c) return c.any.every((x) => settledFalse(x, v));
  if ("all" in c) return c.all.some((x) => settledFalse(x, v));
  return v[c.field] !== undefined && !evalCondition(c, v);
}

/** Every field name a condition reads, including through `any` / `all`. */
export function gateFields(c: Condition): string[] {
  if ("any" in c) return c.any.flatMap(gateFields);
  if ("all" in c) return c.all.flatMap(gateFields);
  return [c.field];
}

/**
 * Resolve a field's requirement FOR THIS PART.
 *
 * An unmet conditional is not-applicable — a closed gap, not an open one. That distinction is the
 * whole point of the profile.
 *
 * EXCEPT WHEN THE GATE ITSELF IS UNANSWERED, which is a third state and used to be silently folded
 * into the second. `evalCondition` returns false both when the gate field is present and does not
 * match, and when the gate field is ABSENT — and this function mapped both to `na`. Where the gate
 * field is itself REQUIRED by the same profile, its absence is an open gap, so the honest answer
 * about anything conditioned on it is "cannot say yet", not "does not apply".
 *
 * Measured on `security`: `form_factor` is req and carried by 4 of 6,544 hardware parts, and
 * `rack_units` is `cond({field:"form_factor", …})`. So 6,540 parts were being told they have no
 * rack units, permanently, on the strength of a value nobody has extracted yet. `na` closes a gap;
 * `pending` leaves it open and points at the field that would settle it.
 *
 * The change is general to all seven of security's conditionals and the EFFECT is one field: the
 * other six gate on `series`, which is populated on 6,544 of 6,544, so they never reach this
 * branch. A gate field that is `opt` still yields `na` — if nobody is obliged to answer it, its
 * absence is not evidence of anything.
 */
export function requirementFor(
  category: string, key: string, values: PartValues, seen: ReadonlySet<string> = new Set(),
): "req" | "opt" | "na" | "pending" {
  const profile = PROFILES[category];
  const r = profile?.[key];
  if (!r) return "na";
  if (r.kind !== "cond") return r.kind;
  // fallback-kinds (12 Sep 2026): what an unmet conditional MEANS — see the `elseOpt` note on
  // Requirement. Default `na`, so every conditional written before today behaves exactly as it did.
  const unmet = r.elseOpt ? "opt" : "na";
  if (evalCondition(r.when, values)) return "req";
  // Settled false by what IS answered: nothing left unanswered can make it true (see settledFalse).
  if (settledFalse(r.when, values)) return unmet;
  // False — but is it false because the gate says no, or because nobody has answered the gate?
  //
  // THE GATE'S REQUIREMENT MUST BE RESOLVED, NOT READ OFF THE PROFILE. This line used to test
  // `profile[f].kind === "req"`, the RAW entry, and that quietly broke `pending` for a whole
  // category on 10 Sep 2026: gating `switches` on the part kind turned `stackable`,
  // `poe_standard`, `layer` and `form_factor` from `req` into `cond`, so the test found no
  // required gate and every dependent — stacking_bandwidth, poe_ports, poe_budget, ipv4_routes,
  // ipv6_routes, rack_units, module_slots — resolved to `na` instead of staying open. The gaps did
  // not narrow, they CLOSED, and the denominator got smaller in a way that looks like progress.
  // Measured after the change: a Catalyst 9300 answering nothing had req=33 pending=0, where the
  // whole point of `pending` is that an unanswered gate keeps its dependents' gaps open.
  //
  // `seen` is a cycle guard: two conditionals gating on each other would otherwise recurse for
  // ever, and "na" is the safe answer for a cycle — it asks less rather than more.
  if (seen.has(key)) return unmet;
  const next = new Set(seen).add(key);
  const unanswered = gateFields(r.when).some((f) => {
    if (values[f] !== undefined) return false;
    const gate = requirementFor(category, f, values, next);
    return gate === "req" || gate === "pending";
  });
  return unanswered ? "pending" : unmet;
}

export type CompletenessV2 = {
  category: string;
  required_total: number;
  required_present: number;
  missing: string[];
  optional_present: number;
  na: number;
  pct: number;
  /** true when the category has no profile — such a part is EXCLUDED from reporting rather
   *  than scored 0/0 = 100%. Sabotage case S16. */
  no_profile: boolean;
};

/**
 * Profile keys that are answered by a COLUMN on `parts`, not by an extracted fact.
 *
 * They are required — a part with no series is a validation failure — and they are excluded from
 * the completeness score, because a field that is present for every row measures nothing. Keeping
 * them in the denominator put a floor under every part in the catalogue and made a part with no
 * specifications at all look 15% documented.
 *
 * Anything added here must actually be filled from a column in recompute-completeness, or it turns
 * into a required field nobody scores and nobody notices is missing.
 */

export function completenessV2(category: string, values: PartValues): CompletenessV2 {
  const profile = PROFILES[category];
  if (!profile) {
    return { category, required_total: 0, required_present: 0, missing: [], optional_present: 0,
      na: 0, pct: 0, no_profile: true };
  }
  const missing: string[] = [];
  let requiredTotal = 0, requiredPresent = 0, optionalPresent = 0, na = 0;
  for (const key of Object.keys(profile)) {
    // A KEY BACKED BY A COLUMN IS NOT A SPECIFICATION AND IS NOT SCORED. `vendor` and `series` sit
    // on the parts row, so they are present for every part that exists and contribute a constant
    // to both halves of every score. Measured 9 Sep 2026: a security hardware part with ZERO facts
    // scored 2/13 = 15.4% rather than 0/11 = 0%, and the category's mean of 18.4% was mostly that
    // floor — `present: ["rack_units","vendor","series"]` on CSF1210CE-TD-K9 is two thirds
    // bookkeeping. They stay REQUIRED in the profile, because requiring them is what makes a part
    // without a series a validation failure; they are simply not a coverage question.
    if (COLUMN_BACKED.has(key)) continue;
    const kind = requirementFor(category, key, values);
    const present = values[key] !== undefined && values[key] !== null && values[key] !== "";
    // `pending` COUNTS AS REQUIRED, exactly as it does in requiredFieldsFor. It fell into the
    // `else` here when the third outcome was added, so the stored row treated it as not-applicable
    // while the required_fields list treated it as required — the two disagreed on any part whose
    // gate field was unanswered, which is 6,540 of security's 5,782 hardware parts for rack_units.
    if (kind === "req" || kind === "pending") {
      requiredTotal++;
      if (present) requiredPresent++;
      else missing.push(key);
    } else if (kind === "opt") {
      if (present) optionalPresent++;
    } else {
      na++;
    }
  }
  return {
    category, required_total: requiredTotal, required_present: requiredPresent, missing,
    optional_present: optionalPresent, na,
    pct: requiredTotal === 0 ? 0 : Math.round((requiredPresent / requiredTotal) * 1000) / 10,
    no_profile: false,
  };
}

/** Static counts per category — reported by validate-schema.ts. `base_req` counts only the
 *  UNCONDITIONALLY required fields; `max_req` adds every conditional, i.e. the ceiling for a
 *  part that trips all of them. The real denominator for any given part sits between the two,
 *  which is why completenessV2 computes it per part rather than quoting a single number. */
export function profileCounts(category: string) {
  const p = PROFILES[category] || {};
  const keys = Object.keys(p);
  return {
    total: keys.length,
    base_req: keys.filter((k) => p[k].kind === "req").length,
    conditional: keys.filter((k) => p[k].kind === "cond").length,
    optional: keys.filter((k) => p[k].kind === "opt").length,
    max_req: keys.filter((k) => p[k].kind === "req" || p[k].kind === "cond").length,
  };
}

// ---------------------------------------------------------------------------------------------
// Generated vocabulary — merged in BEFORE CATEGORIES is computed, or the 15 categories that
// only exist in the generated profiles would be missing from it.
//
// Why this exists: the hand-written dictionary above covers 8 categories. apply-specs-v2 drops
// any fact whose category has no profile, and any field absent from its category's profile,
// with no error either way — so servers-unified-computing (11,704 parts), video,
// collaboration-endpoints, unified-communications, meraki and ten others discarded every spec
// they produced. The generated half closes that, derived from the labels those categories
// actually publish rather than guessed at.
//
// Merge order is deliberate: hand-written definitions WIN. A generated field never overwrites a
// curated one, and a generated profile only adds fields to an existing category's profile.
// eslint-disable-next-line import/first
import { GENERATED_FIELDS, GENERATED_PROFILES } from "./fieldSchema.generated.js";

for (const [key, def] of Object.entries(GENERATED_FIELDS)) {
  if (!FIELD_DICTIONARY[key]) FIELD_DICTIONARY[key] = def;
}
for (const [cat, fields] of Object.entries(GENERATED_PROFILES)) {
  PROFILES[cat] = { ...fields, ...(PROFILES[cat] || {}) };
}

// ONE CUP PER QUANTITY — 11 Sep 2026.
//
// A dictionary-wide scan for keys sharing a label found nine pairs that are the SAME QUANTITY
// under two keys: `cd_tolerance` beside `chromatic_dispersion_tolerance` (same label, same ps/nm),
// `indicator_leds` beside `status_leds`, and seven more. Each pair splits one question across two
// cups: a value lands in whichever key an alias happens to route to, and completeness asks the
// other. In `transceiver` the cup WITH the data (21 facts) was not even on the table while its empty
// twin was. The map says which key survives — always the one that holds facts or that an alias
// routes to, never the tidier-looking name: `random_read_iops_4k` reads as canonical and is the
// dead one, because both alias rules write `iops_random_read_4k`.
//
// It is applied AFTER the merge because four of the nine duplicates are declared by GENERATED
// profiles, which a hand edit cannot remove — the next regeneration would put them back. Every
// duplicate held zero facts when this was written, so no value moves. tests/oneCupPerQuantity
// fails if a profile declares a superseded key, if an alias writes one, or if a new label-sharing
// pair appears that this map does not resolve.
export const SUPERSEDED_KEYS: Readonly<Record<string, string>> = {
  cd_tolerance: "chromatic_dispersion_tolerance",       // 0 facts vs 22; the alias writes the latter
  optical_input_range: "input_power_range",             // 0 vs 1; eleven alias rules write the latter
  pdl: "polarization_dependent_loss",                   // both 0; the latter is numeric and aliased
  random_read_iops_4k: "iops_random_read_4k",           // both 0; the alias writes the latter
  random_write_iops_4k: "iops_random_write_4k",         // both 0; the alias writes the latter
  ride_through_time: "holdup_time",                     // 0 vs 36; one alias covers both spellings
  indicator_leds: "status_leds",                        // 0 vs 36; "^indicator leds$" already writes status_leds
  poe_budget_redundant_psu: "poe_budget_redundant",     // 0 vs 7; the latter is numeric, in W
  enclosure_material: "housing_material",               // both 0; the enclosure alias is redirected
  // A SYNONYM the label scan could not see (different labels, same quantity): which chassis or products
  // a part fits. 9 facts, moved by scripts/rekey-psu-and-compat.mts; its two aliases are redirected.
  // The first retirement that moves VALUES — every one before it held zero facts. 11 Sep 2026.
  chassis_compatibility: "product_compatibility",       // 9 vs 70; "Chassis compatibility" / "Chassis support"
  // THE RECEIVE WAVELENGTH UNDER TWO MORE NAMES, found by the transceiver BiDi census (11 Sep 2026). Both hold
  // zero facts in every category. `bidi_wavelengths` is a {tx, rx} pair: its Tx half is `wavelength`, which
  // every BiDi raw already feeds, and its Rx half is this key. `input_wavelength` ("Input wavelength range")
  // is an amplifier's or receiver's accepted window — exactly what `rx_wavelength` ("Receiver input
  // wavelength", a range) holds; the unmapped "Input Wavelength" label (8 rows, EDFA sheets) now writes it.
  bidi_wavelengths: "rx_wavelength",                     // 0 facts anywhere; Tx half = `wavelength`
  input_wavelength: "rx_wavelength",                     // 0 facts anywhere; same window, same unit
  // video (12 Sep 2026): three HFC quantities the generated sweep named twice, under DIFFERENT labels, so the
  // label scan could not pair them. Each twin holds 0 facts in every category and no alias rule writes it; the
  // survivor is the key the video sheets' labels already route to. No value moves.
  rf_bandwidth: "passband",                              // "RF passband" vs "Pass band" — the node/Tx RF band
  rf_response_flatness: "frequency_response",            // "RF frequency response flatness" vs "Frequency response"
  rf_test_point: "test_point_level",                     // "RF test point level" vs "Test points (±0.5 dB)"
  // end video (12 Sep 2026)
  // routers (12 Sep 2026) — duplicates found by the routers fields survey; values that move are a PROPOSAL in
  // runs/reports/schema-routers-2026-09-12.md, never moved here. Every alias that wrote the left key now writes the right.
  system_memory: "dram",                                 // 0 facts, 0 labels, 0 aliases: "System memory" already maps to dram
  vpn_throughput: "ipsec_throughput",                    // 3 facts (security SM-56/SM-40) vs 6 routers; two aliases redirected
  compatible_platform: "product_compatibility",          // 7 facts (2 routers + 5 interfaces-modules), s -> ls; one alias redirected
  dc_input_voltage: "input_voltage",                     // 0 facts anywhere; input_voltage (nr) already stores "DC: -40 to -72V"
  // end routers (12 Sep 2026)
  // optical-storage (12 Sep 2026). Both hold ZERO facts in every category, so no value moves; both became visible
  // only once a mux and an amplifier were asked their loss and their gain. `insertion_loss` (a free string) and
  // `insertion_loss_max` (a number, dB) are one quantity — Cisco's "Insertion loss" rows are maxima ("IL 0.35dB
  // (max)"); `gain_range` (a string) is the span of the `gain` cup, now a range. The alias rules that wrote the
  // retired keys ("^insertion loss$", "^Gain\s+range$", "^Standard\s+gain\s+range$") are redirected.
  insertion_loss: "insertion_loss_max",                  // 0 facts vs 0; the numeric key survives
  gain_range: "gain",                                    // 0 facts vs 0; gain is nr since 12 Sep 2026
  // end optical-storage
  // ---- security (12 Sep 2026) ------------------------------------------------------------------
  // THE SAME THROUGHPUT UNDER TWO KEYS, and the label scan could not see it because the labels
  // differ ("Threat Defense throughput" against "NGFW"). Both are the Gbit/s a box does with threat
  // inspection on, both are Cisco's own figure from the same table, and the two alias rules
  // OVERLAPPED: "^ngfw throughput$" wrote threat_defense_throughput while "^ngfw.*throughput" wrote
  // threat_throughput, so which cup a value landed in depended on the order of the rules file.
  // Survivor chosen by facts and by band, not by the tidier name: threat_throughput holds 17 facts
  // and a curated band [0.02, 5000] Gbit/s, threat_defense_throughput holds 3 and its generated
  // dictionary entry has NO band, so nothing could refuse an implausible value written to it.
  // The alias rule is redirected in data/schema/attribute-aliases.en.json.
  // 3 FACTS MOVE — CSF1210CE 6, CSF1210CP 6, CSF1220CX 9 Gbit/s, every one inside the survivor's
  // band and every one a datasheet MODEL row. Moving them is a database write: it is a PROPOSAL in
  // docs/reports/schema-security-2026-09-12.md, not done here. Until it runs, those three rows read
  // "missing threat_throughput" while holding the value under the retired key.
  threat_defense_throughput: "threat_throughput",        // 3 facts vs 17; the survivor has the band
  // ---- reviewer round 3, §4 item 2 (12 Sep 2026) -----------------------------------------------
  // Four retirements the reviewer named after reading the dictionary rather than the labels, so each
  // was measured against the live corpus before being taken. Three are clean and the fifth they
  // asked for is REFUSED below, with its measurement.
  //
  //   modulation_type          0 facts, 0 labels, 0 alias rules, 4 profiles
  //   modulation_format       41 facts, 3 labels, 4 alias rules, 13 profiles   <- survivor
  // Same quantity ("Modulationsart" / "Modulationsformat"), and the dead one is the one with the
  // tidier name — the `random_read_iops_4k` shape again. Nothing moves.
  modulation_type: "modulation_format",
  // REVERTED 12 Sep 2026, and the reason belongs here where the next reader of this map will look.
  // `tx_max_output_power: "tx_power"` was committed in 6c3bff2 with the comment "holds ZERO facts
  // anywhere", and sync-dictionary run #986 applied it. It held ZERO CISCO facts. Measured across every
  // vendor it holds 231 JUNIPER facts — so the supersession stranded another lane's data under a retired
  // key, and the sync deleted its profile rows in every category, taking the cup off Juniper's
  // transceivers. The census that said "no values" is per vendor by construction; a SUPERSESSION is
  // global by construction. Those two facts sat one query apart.
  //
  // THE RULE THIS COST: a dictionary change is measured across ALL vendors before it is made, because
  // this worktree only owns Cisco's rows and the dictionary belongs to every lane. The same check caught
  // two more before they shipped: `tx_wavelength` (261 Juniper facts) and `rx_max_input_power` (240).
  // Whether tx_max_output_power and tx_power are one quantity is still a fair question — it is now a
  // question for the Juniper lane, whose facts it would move, and not one this lane can settle alone.
  // round-6 B6, 12 Sep 2026, AND THE DIRECTION IS THE REVIEWER'S REVERSED. They asked for
  // `cpu_sockets_max` -> `cpu_sockets`, which reads as the tidier name surviving. Measured:
  // `cpu_sockets_max` holds 246 own facts (154 in servers-unified-computing, 92 in
  // hyperconverged-infrastructure) and `cpu_sockets` holds ZERO, anywhere. This file's own rule for
  // the nine pairs of 11 Sep is "always the one that holds facts or that an alias routes to, never
  // the tidier-looking name", and `random_read_iops_4k` is the recorded example of getting it
  // wrong. Merging the other way would move 246 facts to gain a shorter key.
  cpu_sockets: "cpu_sockets_max",
  //   rx_max_input_power        0 facts, "Saturation optical power" 4 + "Maximum receiver input
  //                             power" · type n dBm · now carries a curated band   <- survivor
  //   max_optical_input_power   0 facts, "Maximum input power" 11 + "Receiver damage threshold" 10
  //   rx_overload               0 facts, "Overload" 5 · type "s", so it cannot hold a number
  // One quantity under three names: the receiver's saturation / damage threshold in dBm. The
  // survivor is the one the curated block above documents as the fourth of the symmetric four
  // (tx_power / tx_max_output_power / rx_sensitivity / rx_max_input_power) — chosen by that
  // symmetry and by type, not by label count, because all three hold zero facts and the widest
  // label set belongs to a key whose own name says "optical" while its labels say "receiver".
  // RECEIVER WINDOW — the round-6 decision (supersede rx_max_input_power into input_power_range) is NOT
  // applied, and was caught one step before its sync. The premise was "all three held ZERO facts"; the
  // reviewer read that off the Cisco census and so did I. Across every vendor, rx_max_input_power holds
  // 240 JUNIPER facts, and superseding it would have repeated the tx_max_output_power damage above. So
  // the two zero-fact keys keep pointing at rx_max_input_power as they did, and the merge into
  // input_power_range is a cross-lane question. (Note for whoever takes it: a direct supersession would
  // also create a CHAIN, which tests/oneCupPerQuantity.test.ts refuses — all three must point at the
  // survivor in one change.)
  max_optical_input_power: "rx_max_input_power",
  rx_overload: "rx_max_input_power",
  //   installation_type   5 facts (all interfaces-modules, all from the router-switch reseller
  //                       page), 0 datasheet labels
  //   mounting          934 facts (591 own), 13 labels, 164 occurrences, 19 profiles   <- survivor
  // "Installation type" and "Mounting" are one question: how the part is installed. THE FIVE VALUES
  // DO NOT ALL MOVE — three are real ("Hot-swappable, front-insertion line card for Cisco 10000
  // chassis") and two are the literal string "n/a", which is not a value under any key. The rekey
  // of the three and the retraction of the two are a database write, so they are a PROPOSAL in
  // docs/reports/schema-dictionary-2026-09-12.md, not done here.
  installation_type: "mounting",
  // REFUSED, and this is the one worth reading: `filter_passband` -> `passband` was also asked for.
  //   filter_passband   type s, unit nm, 1 label: "Minimum transmit filter passband (at 0.5 dB
  //                     resolution bandwidth)" 6 occurrences, optical filter/mux modules, values
  //                     like "±0.18 nm" — a WAVELENGTH window.
  //   passband          type s, unit MHz, 3 labels: "Pass band" 33 · "Pass Band" 13 · video-scoped
  //                     "Bandwidth" 32 — the HFC/RF band of a video node ("52-1218 MHz").
  // Two different quantities in two different units, and one has already absorbed `rf_bandwidth`.
  // Merging them would put a nanometre window into a megahertz cup, which is the shape that stores
  // a weight of 0.075 kg as 75. Both keys stay; the pair is listed in the report so the next reader
  // does not have to re-derive the refusal.
};
for (const p of Object.values(PROFILES)) {
  for (const [dup, canon] of Object.entries(SUPERSEDED_KEYS)) {
    if (!(dup in p)) continue;
    if (!(canon in p)) p[canon] = p[dup];
    delete p[dup];
  }
}
// servers (12 Sep 2026): R2 inside the three UCS categories (UCS_R2_DUPLICATES) — the generated merge puts
// cache_l3 and cpu_base_clock back as optional second cups for cpu_cache and clock_speed, which these
// profiles REQUIRE of every CPU. Scoped here; the global SUPERSEDED_KEYS entry is a proposal (see the report).
for (const cat of UCS_PROFILE_CATEGORIES) {
  const p = PROFILES[cat];
  if (!p) continue;
  for (const [dup, canon] of Object.entries(UCS_R2_DUPLICATES)) {
    if (!(dup in p)) continue;
    if (!(canon in p)) p[canon] = p[dup];
    delete p[dup];
  }
}

/**
 * Label groups that still hold MORE THAN ONE live key — the check behind SUPERSEDED_KEYS. A group is
 * keys whose English (or German) label is identical once case and punctuation are dropped; a key in
 * `superseded` does not count. Pure, so the test can hand it a sabotaged dictionary.
 */
export function unsupersededDuplicates(
  dict: Record<string, { en?: string; de?: string }>, superseded: Readonly<Record<string, string>>,
): { lang: "en" | "de"; label: string; keys: string[] }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();
  const out: { lang: "en" | "de"; label: string; keys: string[] }[] = [];
  for (const lang of ["en", "de"] as const) {
    const groups = new Map<string, string[]>();
    for (const [k, d] of Object.entries(dict)) {
      const l = d[lang];
      if (!l || k in superseded) continue;
      const g = norm(l);
      groups.set(g, [...(groups.get(g) ?? []), k]);
    }
    for (const [label, keys] of groups) if (keys.length > 1) out.push({ lang, label, keys });
  }
  return out;
}

// THE DEVICE GATE HAS TO BE APPLIED AFTER THE MERGE, NOT TO THE LITERAL.
//
// `deviceOnly()` wraps a hand-written block, and the merge above puts GENERATED_PROFILES UNDER it —
// so a `req` that lives only in the generated half never passes through the wrapper and stays
// unconditional. Measured 10 Sep 2026, straight after wrapping the eleven flat categories:
// `wireless` still asked a POWER CORD for `standard`, and video and the rest each kept one such
// field, because `standard` is a generated entry and nothing hand-written names it. Every other
// requirement in those categories had been gated correctly, which is what makes this the dangerous
// shape — the category looks done and one field per category is still asked of every cable.
//
// This is the same leak `tests/profileMerge.test.ts` was written for when `cpu` arrived from the
// generated half and was required of 8,794 cables and rails. Re-gating the MERGED profile closes
// both halves at once and cannot be defeated by where a key happens to be declared.
for (const cat of DEVICE_GATED_CATEGORIES) {
  const p = PROFILES[cat];
  if (!p) continue;
  for (const [key, r] of Object.entries(p)) {
    if (r.kind === "req" && !COLUMN_BACKED.has(key)) {
      p[key] = cond({ field: "kind", inList: [...GENERIC_DEVICE] });
    }
  }
}
// ---- security (12 Sep 2026) --------------------------------------------------------------------
// The same leak, on security's OWN axis. `security` is not in DEVICE_GATED_CATEGORIES — its kinds
// name module, blade and appliance shapes the generic axis makes no claim about — so the loop above
// does not reach it, and a `req` arriving from GENERATED_PROFILES would stay unconditional and be
// asked of every fan, rail and blank slot cover, which is the whole defect the kind axis just fixed.
//
// TODAY THE GENERATED HALF DECLARES security ENTIRELY `opt`, so this loop changes nothing — which is
// exactly why it is here rather than in a comment. The generated file is regenerated from the labels
// the sources publish; the day a regeneration promotes one key, the gate is already in place. It is
// the cheapest possible insurance against a defect this file has already paid for twice (`standard`
// on a power cord in wireless, `cpu` required of 8,794 cables).
//
// Gated to SEC_BOX, not to the component kinds: an unreviewed requirement belongs on the box, which
// is the kind that has a physical envelope at all. tests/fieldSchema asserts the loop fires by
// feeding it a sabotaged profile.
export function gateSecurityGeneratedReq(p: Record<string, Requirement> | undefined): number {
  if (!p) return 0;
  let gated = 0;
  for (const [key, r] of Object.entries(p)) {
    if (r.kind === "req" && !COLUMN_BACKED.has(key)) {
      p[key] = cond({ field: "kind", inList: [...SEC_BOX] });
      gated++;
    }
  }
  return gated;
}
gateSecurityGeneratedReq(PROFILES.security);

// modules-misc (12 Sep 2026): the same re-gate for the three categories that use an axis of their
// own — see AXIS_GATED_CATEGORIES for why a comment would not have done. An unconditional `req`
// that reached the merged profile from the generated half is gated on the kinds that ARE the whole
// product, which is the conservative direction: it can only narrow who is asked.
for (const [cat, productKinds] of Object.entries(AXIS_GATED_CATEGORIES)) {
  const p = PROFILES[cat];
  if (!p) continue;
  for (const [key, r] of Object.entries(p)) {
    if (r.kind === "req" && !COLUMN_BACKED.has(key)) {
      p[key] = cond({ field: "kind", inList: [...productKinds] });
    }
  }
}

// --- fallback-kinds (12 Sep 2026) ---------------------------------------------------------------
// THE CUPS FOR THE THREE KINDS NO SKU AXIS NAMES: `mechanical` (the survey's P-1, 2,509 parts),
// `pdu` (P-4, 38) and `tpm` (P-4, 46). See src/core/nameMarker.ts for what they are and why they are
// derived from the NAME, and docs/reports/schema-fallback-kinds-2026-09-12.md for the evidence.
//
// APPLIED AFTER THE MERGE, AS A LOOP, for exactly the reason the two loops above give and one more.
// `mounting` is declared by the GENERATED half in sixteen of the seventeen kind-bearing profiles, so
// a hand-written line per profile would have been sixteen chances to miss one in silence — and a
// missed one is invisible: the cup simply stays `opt` and the new kind is asked nothing. The loop
// cannot miss a category, and it derives that list from the profiles themselves (a profile that
// gates on `kind`) rather than from a second copy of KIND_CATEGORIES, which would drift.
//
// WHAT EACH KIND IS ASKED, and every one of the three is chosen from what the corpus can fill:
//
//   mechanical   product_compatibility   what it fits — the ONE question a rack kit, a bracket, a
//                                        blanking panel or a cover is bought on. 122 label
//                                        occurrences; the sample SKUs for the label "Compatibility"
//                                        are CAB-CONSOLE-RJ45 and RCKMNT-19-CMPCT=, i.e. this family.
//                mounting                170 of the 2,509 already hold it and 735 labels map to it.
//   pdu          the same two            input_voltage / ac_current / power_input_connector are what
//                                        a PDU is really bought on and are NOT required: 38 parts
//                                        hold ONE fact between them (a mounting), and no source
//                                        publishes the labels. Their derivation IS available in the
//                                        names ("10A Metered Input 1-Phase 8x C13, 2x C19 - 0U PDU")
//                                        and is a PROPOSAL in the report, not a cup nothing fills.
//   tpm          product_compatibility   a TPM's whole specification is which servers take it
//                                        ("TPM 2.0 … for M5 servers"). 46 parts, 0 facts.
//
// NOT ADDED, and each refusal is measured rather than reasoned: `weight` and `dimensions` (460 and
// 353 parts hold them and ZERO on any fallback kind across all 45,356, so requiring them would open
// 2,509 gaps nothing has ever filled), `color` (46 label occurrences, 15 of them "BSS coloring", a
// Wi-Fi feature) and `material` (1,134 occurrences, 811 of which map to `__not_a_spec`).
const MECHANICAL_FITS_KINDS: readonly string[] = ["mechanical", "tpm", "pdu"];
const MECHANICAL_MOUNTING_KINDS: readonly string[] = ["mechanical", "pdu"];

/**
 * Ask `key` of these kinds TOO, leaving every other kind's answer exactly as it is.
 *
 * Four shapes arrive here and each is handled rather than assumed:
 *   `req`          already asked of everything, mine included — untouched.
 *   `cond` on kind the common case: the kind list is widened, and the existing `elseOpt` is kept.
 *   `cond` on else its condition is OR-ed with mine, so a part meeting either is asked.
 *   `opt` / `na`   becomes a cond, with `elseOpt` set to whichever the key was — so an `opt` key
 *                  stays `opt` for every kind but mine, and an `na` key stays `na`. This is the
 *                  whole reason `elseOpt` exists; see its note on `Requirement`.
 */
function askAlsoOf(existing: Requirement | undefined, kinds: readonly string[]): Requirement {
  const mine: Condition = { field: "kind", inList: [...kinds] };
  if (existing?.kind === "req") return existing;
  if (existing?.kind === "cond") {
    const keep = existing.elseOpt ? { elseOpt: true } : {};
    const when = existing.when as { field?: string; inList?: (string | number)[] };
    if (when.field === "kind" && Array.isArray(when.inList)) {
      const merged = [...new Set([...when.inList.map(String), ...kinds])];
      return { kind: "cond", when: { field: "kind", inList: merged }, ...keep };
    }
    return { kind: "cond", when: { any: [existing.when, mine] }, ...keep };
  }
  return { kind: "cond", when: mine, ...(existing?.kind === "opt" ? { elseOpt: true } : {}) };
}

for (const cat of Object.keys(PROFILES)) {
  const p = PROFILES[cat];
  // The gating categories, derived from the profiles rather than remembered — the same derivation
  // tests/partKind.test.ts uses to check KIND_CATEGORIES in both directions.
  if (!Object.values(p).some((r) => r.kind === "cond" && gateFields(r.when).includes("kind"))) continue;
  // `pdu` and `tpm` are listed ONLY where a part of that kind can exist (nameMarker.ts sends a PDU
  // elsewhere to the category's own supply kind). A cond naming a kind no part can have fires for
  // nobody and reads exactly like a rule nothing satisfies, which is the defect this avoids.
  const ucs = (UCS_PROFILE_CATEGORIES as readonly string[]).includes(cat);
  const fits = ucs ? MECHANICAL_FITS_KINDS : ["mechanical"];
  const mount = ucs ? MECHANICAL_MOUNTING_KINDS : ["mechanical"];
  p.product_compatibility = askAlsoOf(p.product_compatibility, fits);
  p.mounting = askAlsoOf(p.mounting, mount);
}
// end fallback-kinds ------------------------------------------------------------------------------

export const CATEGORIES = Object.keys(PROFILES);

// ---------------------------------------------------------------------------------------------
// Display labels for enum SLUGS
// ---------------------------------------------------------------------------------------------
// Enum values are stored as machine slugs so they are comparable and filterable ("l3", "rack-19",
// "802.3at"). A page must never show the slug: „Switching-Ebene: l3" is worse than the prose it
// replaced. These are the human strings, emitted into lib/fieldLabels.generated.ts for the
// content session's reader.
//
// form_factor carries both the switch and the optic domain. Their slugs do not collide, so one
// flat map per field key is unambiguous.
export const ENUM_LABELS: Record<string, Record<string, { de: string; en: string }>> = {
  vendor: {
    cisco: { de: "Cisco", en: "Cisco" }, hpe: { de: "HPE", en: "HPE" },
    aruba: { de: "Aruba", en: "Aruba" }, juniper: { de: "Juniper", en: "Juniper" },
    arista: { de: "Arista", en: "Arista" }, "dell-emc": { de: "Dell EMC", en: "Dell EMC" },
    lenovo: { de: "Lenovo", en: "Lenovo" }, extreme: { de: "Extreme Networks", en: "Extreme Networks" },
    fortinet: { de: "Fortinet", en: "Fortinet" }, nvidia: { de: "NVIDIA", en: "NVIDIA" },
    mikrotik: { de: "MikroTik", en: "MikroTik" }, ubiquiti: { de: "Ubiquiti", en: "Ubiquiti" },
    supermicro: { de: "Supermicro", en: "Supermicro" },
  },
  mgmt_class: {
    managed: { de: "Managed", en: "Managed" },
    "smart-managed": { de: "Smart Managed", en: "Smart managed" },
    unmanaged: { de: "Unmanaged", en: "Unmanaged" },
  },
  layer: {
    l2: { de: "Layer 2", en: "Layer 2" }, l2plus: { de: "Layer 2+", en: "Layer 2+" },
    l3: { de: "Layer 3", en: "Layer 3" },
  },
  form_factor: {
    "rack-19": { de: "19-Zoll-Rackmontage", en: "19-inch rack" },
    desktop: { de: "Desktop", en: "Desktop" },
    "din-rail": { de: "DIN-Schienenmontage", en: "DIN rail" },
    "modular-chassis": { de: "Modulares Chassis", en: "Modular chassis" },
    gbic: { de: "GBIC", en: "GBIC" }, x2: { de: "X2", en: "X2" },
    xenpak: { de: "XENPAK", en: "XENPAK" }, xfp: { de: "XFP", en: "XFP" },
    sfp: { de: "SFP", en: "SFP" }, "sfp-plus": { de: "SFP+", en: "SFP+" },
    sfp28: { de: "SFP28", en: "SFP28" }, sfp56: { de: "SFP56", en: "SFP56" },
    "qsfp-plus": { de: "QSFP+", en: "QSFP+" }, qsfp28: { de: "QSFP28", en: "QSFP28" },
    qsfp56: { de: "QSFP56", en: "QSFP56" }, "qsfp-dd": { de: "QSFP-DD", en: "QSFP-DD" },
    qsfp112: { de: "QSFP112", en: "QSFP112" }, dsfp: { de: "DSFP", en: "DSFP" },
    cfp: { de: "CFP", en: "CFP" }, cfp2: { de: "CFP2", en: "CFP2" },
    cpak: { de: "CPAK", en: "CPAK" }, osfp: { de: "OSFP", en: "OSFP" }, "sfp-dd": { de: "SFP-DD", en: "SFP-DD" },
  },
  deploy_role: {
    access: { de: "Access", en: "Access" }, aggregation: { de: "Aggregation", en: "Aggregation" },
    core: { de: "Core", en: "Core" },
    "datacenter-tor": { de: "Rechenzentrum (Top-of-Rack)", en: "Data centre (top-of-rack)" },
    industrial: { de: "Industrie", en: "Industrial" },
  },
  poe_standard: {
    none: { de: "Kein PoE", en: "No PoE" },
    "802.3af": { de: "PoE (IEEE 802.3af)", en: "PoE (IEEE 802.3af)" },
    "802.3at": { de: "PoE+ (IEEE 802.3at)", en: "PoE+ (IEEE 802.3at)" },
    "802.3bt-t3": { de: "PoE++ (IEEE 802.3bt Typ 3)", en: "PoE++ (IEEE 802.3bt Type 3)" },
    "802.3bt-t4": { de: "PoE++ (IEEE 802.3bt Typ 4)", en: "PoE++ (IEEE 802.3bt Type 4)" },
    upoe: { de: "Cisco UPOE", en: "Cisco UPOE" }, "upoe-plus": { de: "Cisco UPOE+", en: "Cisco UPOE+" },
  },
  psu_config: {
    "fixed-internal": { de: "Fest eingebautes Netzteil", en: "Fixed internal PSU" },
    "modular-single": { de: "Modulares Netzteil (einzeln)", en: "Modular PSU (single)" },
    "modular-redundant": { de: "Modulare Netzteile, redundant", en: "Modular PSUs, redundant" },
    external: { de: "Externes Netzteil", en: "External PSU" },
  },
  cooling: {
    fanless: { de: "Lüfterlos", en: "Fanless" },
    "fixed-fans": { de: "Fest verbaute Lüfter", en: "Fixed fans" },
    "redundant-replaceable": { de: "Redundante, austauschbare Lüfter", en: "Redundant, field-replaceable fans" },
  },
  airflow: {
    "front-to-back": { de: "Vorne nach hinten", en: "Front to back" },
    "back-to-front": { de: "Hinten nach vorne", en: "Back to front" },
    side: { de: "Seitlich", en: "Side" }, reversible: { de: "Umkehrbar", en: "Reversible" },
    "port-side-intake": { de: "Ansaugung portseitig", en: "Port-side intake" },
    "port-side-exhaust": { de: "Ausblasung portseitig", en: "Port-side exhaust" },
  },
  mgmt_ports: {
    "console-rj45": { de: "Konsole (RJ45)", en: "Console (RJ45)" },
    "console-usb": { de: "Konsole (USB)", en: "Console (USB)" },
    "oob-ethernet": { de: "Out-of-Band-Ethernet", en: "Out-of-band Ethernet" },
    "usb-a": { de: "USB-A", en: "USB-A" }, "usb-c": { de: "USB-C", en: "USB-C" },
    bluetooth: { de: "Bluetooth", en: "Bluetooth" },
  },
  media: {
    mmf: { de: "Multimode-Faser (MMF)", en: "Multimode fibre (MMF)" },
    smf: { de: "Singlemode-Faser (SMF)", en: "Single-mode fibre (SMF)" },
    "dac-copper": { de: "DAC-Kupferkabel", en: "DAC copper" },
    "rj45-copper": { de: "RJ45-Kupfer", en: "RJ45 copper" },
    aoc: { de: "AOC (aktives optisches Kabel)", en: "AOC (active optical cable)" },
  },
  fiber_type: {
    om1: { de: "OM1", en: "OM1" }, om2: { de: "OM2", en: "OM2" }, om3: { de: "OM3", en: "OM3" },
    om4: { de: "OM4", en: "OM4" }, om5: { de: "OM5", en: "OM5" },
    os1: { de: "OS1", en: "OS1" }, os2: { de: "OS2", en: "OS2" },
  },
  connector: {
    "lc-duplex": { de: "LC Duplex", en: "LC duplex" }, "lc-simplex": { de: "LC Simplex", en: "LC simplex" },
    sc: { de: "SC", en: "SC" }, "mpo-12": { de: "MPO-12", en: "MPO-12" },
    "mpo-16": { de: "MPO-16", en: "MPO-16" }, "mpo-24": { de: "MPO-24", en: "MPO-24" }, rj45: { de: "RJ45", en: "RJ45" },
    integrated: { de: "Fest konfektioniert", en: "Integrated" },
  },
  laser_type: {
    vcsel: { de: "VCSEL", en: "VCSEL" }, fp: { de: "Fabry-Pérot (FP)", en: "Fabry-Pérot (FP)" },
    dfb: { de: "DFB", en: "DFB" }, eml: { de: "EML", en: "EML" },
  },
  mode: {
    duplex: { de: "Duplex (Zweifaser)", en: "Duplex (two-fibre)" },
    "simplex-bidi": { de: "BiDi (Einzelfaser)", en: "BiDi (single-fibre)" },
    "duplex-bidi": { de: "BiDi über Duplex-Faserpaar", en: "BiDi over a duplex fibre pair" },
  },
  dac_type: {
    passive: { de: "Passiv", en: "Passive" }, active: { de: "Aktiv", en: "Active" },
  },
  fec: {
    none: { de: "Nicht erforderlich", en: "Not required" },
    "rs-fec": { de: "RS-FEC", en: "RS-FEC" }, "fc-fec": { de: "FC-FEC", en: "FC-FEC" },
    "host-dependent": { de: "Host-abhängig", en: "Host dependent" },
  },
  temp_class: {
    commercial: { de: "Kommerziell", en: "Commercial" },
    extended: { de: "Erweitert", en: "Extended" },
    industrial: { de: "Industrie", en: "Industrial" },
  },
};
