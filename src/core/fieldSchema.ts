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
import { UCS_MACHINE } from "./ucsKind.js";
import { SW_DEVICE } from "./switchKind.js";
import { GENERIC_DEVICE } from "./componentKind.js";

export type Requirement =
  | { kind: "req" }
  | { kind: "opt" }
  | { kind: "na" }
  | { kind: "cond"; when: Condition };

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
  wifi_generation: { key: "wifi_generation", de: "WLAN-Generation", en: "Wi-Fi generation", type: "s", examples: ["Wi-Fi 6", "Wi-Fi 6E", "Wi-Fi 7", "802.11ax"], etim: [], icecat: null },
  spatial_streams: { key: "spatial_streams", de: "Spatial Streams", en: "Spatial streams", type: "s", examples: ["4x4:4", "2x2:2", "8x8:8"], etim: [], icecat: null },
  radio_count: { key: "radio_count", de: "Anzahl Funkmodule", en: "Radio count", type: "n", band: [1, 8], etim: [], icecat: null },
  max_data_rate: { key: "max_data_rate", de: "Max. Datenrate", en: "Maximum data rate", type: "n", unit: "Gbit/s", band: [0.05, 100], etim: [], icecat: null },
  ap_max_clients: { key: "ap_max_clients", de: "Max. Clients je AP", en: "Max clients per AP", type: "n", band: [1, 10000], etim: [], icecat: null },
  wlc_ap_capacity: { key: "wlc_ap_capacity", de: "Max. Access Points (Controller)", en: "Max access points (controller)", type: "n", band: [1, 200000], etim: [], icecat: null },
  wlc_client_capacity: { key: "wlc_client_capacity", de: "Max. Clients (Controller)", en: "Max clients (controller)", type: "n", band: [1, 2000000], etim: [], icecat: null },
  radio_bands: { key: "radio_bands", de: "Frequenzbänder", en: "Frequency bands", type: "s", examples: ["2.4 GHz", "5 GHz", "6 GHz"], etim: [], icecat: null },

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
  antenna_connector: { key: "antenna_connector", de: "Antennenanschluss", en: "Antenna connector", type: "s", etim: [], icecat: null },
  antenna_gain: { key: "antenna_gain", de: "Antennengewinn", en: "Antenna gain", type: "struct", unit: "dBi", shape: "{ band24: n, band5: n }", etim: [], icecat: null },
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
const cond = (when: Condition): Requirement => ({ kind: "cond", when });

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
export const DEVICE_GATED_CATEGORIES = [
  "routers", "wireless", "video", "unified-communications", "collaboration-endpoints",
  "optical-networking", "hyperconverged-systems", "interfaces-modules", "storage-networking",
  "hyperconverged-infrastructure", "meraki",
] as const;

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
    // machines only
    dimensions: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    weight: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    form_factor: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    power_max: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    temp_operating: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    humidity_operating: cond({ field: "kind", inList: [...UCS_MACHINE] }),
    certifications: cond({ field: "kind", inList: [...UCS_MACHINE] }),
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
    cpu: cond({ field: "kind", inList: ["server"] }),
    // component properties, required of the component that HAS them and nothing else
    psu_rated_output: cond({ field: "kind", inList: ["psu"] }),
    memory_speed_max: cond({ field: "kind", inList: ["memory", "server"] }),
    storage_raw_capacity: cond({ field: "kind", inList: ["drive"] }),
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, oversubscription_ratio: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  video: deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, video_codecs: req, max_resolution: req,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    laser_type: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
  }),

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "unified-communications": deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, display: req, ports: req, poe_standard: req,
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    fxs_ports: opt, fxo_ports: opt, qos_features: opt, module_slots: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
  }),

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "hyperconverged-systems": deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, memory_speed_max: req, storage_raw_capacity: req,
    cpu_sockets: opt,  // unreachable — see the note in servers-unified-computing
    // STRUCTURE 8 Sep 2026: 3 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, cpu_cores: opt, hypervisor: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  }),

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "hyperconverged-infrastructure": deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, memory_speed_max: req, storage_raw_capacity: req,
    cpu_sockets: opt,  // unreachable — see the note in servers-unified-computing
    // STRUCTURE 8 Sep 2026: 7 field(s) its documents already produce and no profile declared — invisible to completeness until now
    humidity_storage: opt, cpu_cores: opt, altitude_storage: opt, management_mode: opt, deploy_role: opt, max_wlans: opt, operating_system: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, bmc_management: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, expansion_slot_type: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, onboard_nics: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, psu_count: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, rear_panel_ports: opt, riser_options: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, system_memory: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  }),

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "collaboration-endpoints": deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, display: req, video_codecs: req, audio_codecs: req, ports: req,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
  }),

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  "data-center-networking": {
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, ports: req, switching_capacity: req,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_cord_rating: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, network_technology: opt, oversubscription_ratio: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  },

  // STRUCTURE, added 8 Sep 2026: this category lives in GENERATED_PROFILES,
  // which declares its fields but marks none required. A curated entry states what a
  // product of this kind is BOUGHT ON, and merges over the generated one.
  meraki: deviceOnly({
    dimensions: req, weight: req, form_factor: req, power_max: req, temp_operating: req, humidity_operating: req, certifications: req, ports: req, poe_standard: req,
    // STRUCTURE 8 Sep 2026: 30 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_load_idle_max: opt, copper_ethernet_ports: opt, dedicated_mgmt_interface: opt, sfp_plus_ports: opt, stack_ports: opt, sfp_ports: opt, fan_hot_swap: opt, field_of_view: opt, video_quality_max: opt, image_sensor: opt, mgig_rj45_ports: opt, poe_per_port_max: opt, qsfp_plus_ports: opt, ir_illumination: opt, lens_aperture: opt, upoe_support: opt, focal_length: opt, shutter_speed: opt, battery_count: opt, external_power: opt, battery_life: opt, lens_adjustment_range: opt, min_illumination: opt, optical_zoom: opt, box_contents: opt, poe_budget_redundant: opt, antenna_type: opt, lan_interfaces: opt, wan_interfaces: opt, tdp: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    color: opt, color_options: opt, country_of_origin: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
  }),

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
  conferencing: {
    vendor: req, series: req,
    license_type: opt, license_for: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    aes_audio_encryption: opt, bluetooth_profiles: opt, bluetooth_version: opt, camera_aperture: opt, camera_focus_distance: opt, camera_pan_tilt_range: opt, camera_zoom: opt, color: opt, color_options: opt, country_of_origin: opt, mic_frequency_response: opt, mic_pickup_range: opt, mic_type: opt, packaging_dimensions: opt, phantom_power: opt, product_line: opt, rear_panel_ports: opt, series_release_date: opt, speaker_frequency_response: opt, speaker_impedance: opt, speaker_size: opt, supported_pc_resolutions: opt, video_interfaces: opt,
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
    layer: cond({ field: "kind", inList: [...SW_DEVICE] }),
    form_factor: cond({ field: "kind", inList: [...SW_DEVICE] }),
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    stackable: cond({ field: "kind", inList: ["switch"] }), deploy_role: opt,
    ports: cond({ field: "kind", inList: [...SW_DEVICE, "module"] }),
    uplink_ports: cond({ field: "kind", inList: [...SW_DEVICE] }), uplink_modular: opt,
    module_slots: cond({ any: [{ field: "form_factor", eq: "modular-chassis" }, { field: "uplink_modular", eq: true }] }),
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
    poe_standard: cond({ field: "kind", inList: ["switch", "module"] }),
    poe_ports: cond({ all: [{ field: "kind", inList: ["switch", "module"] }, { field: "poe_standard", ne: "none" }] }),
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
    fabric_bandwidth: cond({ field: "kind", inList: ["supervisor", "fabric"] }),
    stacking_bandwidth: cond({ field: "stackable", eq: true }),
    // stack_max_members is OPTIONAL, not conditional, and the measurement is the reason:
    // ZERO facts hold it — across every category and every vendor in the catalogue — and ZERO
    // labels in any source inventory carry a stack MEMBER COUNT. The one candidate,
    // "Max stack bandwidth", is a bandwidth and already maps to stacking_bandwidth (6 parts here,
    // 33 in meraki, so that one is thin but real). Required, this was a gap no extraction could
    // ever close, on the 1,334 switches that do answer `stackable`. It stays DECLARED so a value
    // is accepted the day a source publishes one. Measured 10 Sep 2026.
    stack_max_members: opt,
    packet_buffer: cond({ field: "kind", inList: [...SW_DEVICE] }),
    mac_table: cond({ field: "kind", inList: [...SW_DEVICE] }),
    vlan_max: cond({ field: "kind", inList: [...SW_DEVICE] }),
    ipv4_routes: cond({ field: "layer", ne: "l2" }),
    ipv6_routes: cond({ field: "layer", ne: "l2" }),
    multicast_groups: opt, acl_entries: opt,
    jumbo_mtu: cond({ field: "kind", inList: [...SW_DEVICE] }), latency: opt, cpu: opt,
    dram: cond({ field: "kind", inList: [...SW_DEVICE] }),
    flash: cond({ field: "kind", inList: [...SW_DEVICE] }),
    psu_config: cond({ field: "kind", inList: [...SW_DEVICE] }),
    psu_redundant: cond({ field: "kind", inList: [...SW_DEVICE] }), psu_options: opt,
    cooling: cond({ field: "kind", inList: [...SW_DEVICE] }),
    airflow: cond({ field: "deploy_role", inList: ["datacenter-tor", "aggregation", "core"] }),
    // --- physical: the device, and the parts that have their own -----------------------------
    power_typical: cond({ field: "kind", inList: [...SW_DEVICE] }),
    power_max: cond({ field: "kind", inList: [...SW_DEVICE, "power"] }),
    input_voltage: cond({ field: "kind", inList: [...SW_DEVICE, "power"] }), input_freq: opt,
    heat_dissipation: cond({ field: "kind", inList: [...SW_DEVICE] }),
    temp_operating: cond({ field: "kind", inList: [...SW_DEVICE] }),
    temp_storage: cond({ field: "kind", inList: [...SW_DEVICE] }),
    humidity_operating: cond({ field: "kind", inList: [...SW_DEVICE] }),
    altitude_max: cond({ field: "kind", inList: [...SW_DEVICE] }),
    acoustic_noise: opt, mtbf: cond({ field: "kind", inList: [...SW_DEVICE] }),
    dimensions: cond({ field: "kind", inList: [...SW_DEVICE] }),
    weight: cond({ field: "kind", inList: [...SW_DEVICE] }),
    certifications: cond({ field: "kind", inList: [...SW_DEVICE] }),
    ieee_standards: cond({ field: "kind", inList: [...SW_DEVICE] }),
    ip_rating: cond({ any: [{ field: "form_factor", eq: "din-rail" }, { field: "deploy_role", eq: "industrial" }] }),
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    psu_efficiency: opt, power_cord_rating: opt, box_contents: opt, qos_queues: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, layer2_features: opt, layer3_features: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, module_width_slots: opt, multicast_features: opt, network_technology: opt, oversubscription_ratio: opt, packaging_dimensions: opt, poe_budget_redundant_psu: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  },
  transceiver: {
    itu_channel: opt, jacket_material: opt, jacket_color: opt, rx_wavelength: opt, optical_pm: opt, input_power_range: opt, // deep-spec fields 2026-09-02
    vendor: req, form_factor: req, standard: req, data_rate: req, media: req,
    fiber_type: cond({ field: "media", inList: ["mmf", "smf"] }),
    wavelength: cond({ field: "media", inList: ["mmf", "smf", "aoc"] }),
    // SHAPED 11 Sep 2026 (reviewer §2.2, measured). A DAC or AOC is a fixed-length CABLE: its reach
    // IS its cable_length (135 of 143 hold one; 0 hold a reach_max), so asking both asked one
    // question twice. Transmission mode (duplex vs BiDi) is a property of a fibre optic: 0 of 143
    // DAC/AOC hold one and no source states it for a cable. rj45-copper keeps reach (30 m over Cat6a).
    reach_max: cond({ field: "media", inList: ["mmf", "smf", "rj45-copper"] }), connector: req,
    tx_power: cond({ field: "media", inList: ["mmf", "smf"] }),
    rx_sensitivity: cond({ field: "media", inList: ["mmf", "smf"] }),
    // OPTIONAL, not conditional-required, and the distinction is deliberate. The guaranteed minimum
    // launch power (tx_power) is what a link budget needs and every optical datasheet states it;
    // the compliance CEILING is published by some vendors and not others — Juniper's HCT gives it,
    // most Cisco datasheets do not. Marking it required would report a gap on thousands of Cisco
    // transceivers for a number their vendor never published, which is the "required field nothing
    // can ever fill" shape this project has paid for before.
    tx_max_output_power: opt,
    link_budget: opt, laser_type: opt, mode: cond({ field: "media", inList: ["mmf", "smf"] }),
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' mgmt_ports and stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 1,760 slots in `transceiver`.
    bidi_wavelengths: opt,
    ddm: req,
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' mgmt_ports and stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 1,390 slots in `transceiver`.
    fec: opt,
    power_max: req, temp_class: req,
    cable_length: cond({ field: "media", inList: ["dac-copper", "aoc"] }),
    // wire_gauge REQUIRED OF A DAC, 11 Sep 2026: a passive copper cable's gauge (Cisco prints 30/26 AWG)
    // decides its reach. Fillable — "Gauge" occurs 30 times in the cisco-datasheets inventory and the
    // alias already writes wire_gauge — though 0 of the 94 Cisco DACs hold it yet: a coverage gap.
    wire_gauge: cond({ field: "media", inList: ["dac-copper"] }),
    msa: opt, dimensions: opt, weight: opt, certifications: opt, mtbf: opt,
    breakout: opt, tunable: opt, dac_type: opt,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    series: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    breakout_point_length: opt, channel_bandwidth: opt, color: opt, color_options: opt, country_of_origin: opt, input_wavelength: opt, modulation_type: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
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

    // UNIVERSAL — true of any physical security appliance, whatever it does.
    vendor: req, series: req, form_factor: req,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    power_max: req, temp_operating: req, humidity_operating: req,
    dimensions: req, weight: req, certifications: req,
    psu_config: opt, psu_redundant: opt, power_typical: opt, altitude_max: opt, mtbf: opt,

    // BY SHAPE — see the SEC_* lists above. Each of these was `req` for all 6,689 hardware parts
    // until 8 Sep 2026; they are now asked only of the products that have them.
    firewall_throughput: cond({ field: "series", inList: SEC_FIREWALL }),
    threat_throughput: cond({ field: "series", inList: SEC_INLINE }),
    // FIREWALLS ONLY. ISE was in this list and the two measurements are not the same thing:
    // a firewall's concurrent sessions are TCP/UDP connections and run to millions, while ISE's
    // are authenticated ENDPOINTS and run to tens of thousands. One key holding both makes the
    // band useless and any comparison between an ISE node and a firewall meaningless. ISE keeps
    // its own question below.
    concurrent_sessions: cond({ field: "series", inList: SEC_FIREWALL }),
    ips_throughput: cond({ field: "series", inList: SEC_IPS }),
    recommended_users: cond({ field: "series", inList: [...SEC_EMAIL, ...SEC_WEB] }),
    storage_capacity: cond({ field: "series", inList: [...SEC_EMAIL, ...SEC_WEB, ...SEC_MGMT, ...SEC_ANALYTICS] }),

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
    // taste — there is none yet, because every document the corpus holds for `security` is an
    // end-of-life bulletin or an ordering guide. Not one datasheet, which is why the category
    // yields almost no facts. That is an ACQUISITION gap and it is not fixed by the schema.
    vpn_throughput: opt, ipsec_throughput: opt, tls_throughput: opt, threat_defense_throughput: opt,
    new_conn_per_sec: opt, vpn_peers: opt, nat_sessions: opt, ipsec_tunnels: opt,
    ssl_connections_per_sec: opt, attack_concurrent_sessions: opt, uc_proxy_sessions: opt,
    ddos_blocking_throughput: opt, ddos_prevention_rate: opt,
    max_interfaces: opt, storage_raw_capacity: opt, managed_by_fdm: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, cluster_size_max: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, gre_tunnels: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, simultaneous_connections: opt, temp_operating_extended: opt, thermal_shock: opt,
  },
  wireless: deviceOnly({
    supported_transceivers: opt, antenna_gain: opt, polarization: opt, antenna_connector: opt, beamwidth_elevation: opt, mounting: opt, recycled_content: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    wifi_generation: req, spatial_streams: opt, radio_count: opt, radio_bands: opt,
    max_data_rate: opt, ap_max_clients: opt,
    wlc_ap_capacity: opt, wlc_client_capacity: opt,
    poe_standard: req, power_max: req,
    dimensions: req, weight: req, temp_operating: req, certifications: req, mtbf: opt,
    // STRUCTURE 8 Sep 2026: 1 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_cord_rating: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt,
  }),
  routers: deviceOnly({
    supported_modules: opt, usb_console: opt, redundancy: opt, chassis_compatibility: opt, etsi_standards: opt, supported_protocols: opt, min_software_release: opt, emc_immunity: opt, emc_emissions: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: req,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    router_throughput: req, forwarding_rate: req, ipsec_throughput: opt, ipsec_tunnels: opt,
    dram: req, flash: req, module_slots: opt,
    // UNREACHABLE BY CONSTRUCTION, measured 10 Sep 2026 and demoted for the same reason as
    // switches' stack_max_members: ZERO facts hold it across every vendor and
    // every state (not merely zero live ones), ZERO sources publish it in any per-category
    // seen-list, and ZERO labels in any source inventory could be aliased to it. Required, it
    // printed a gap on every part that no crawler could ever close. It stays DECLARED, so a
    // value is accepted the day a source publishes one.
    // 5,758 slots in `routers`.
    mgmt_ports: opt,
    psu_config: opt, psu_redundant: opt, power_max: req, power_typical: opt,
    temp_operating: req, humidity_operating: req, dimensions: req, weight: req, certifications: req, mtbf: opt,
    // STRUCTURE 8 Sep 2026: 3 field(s) its documents already produce and no profile declared — invisible to completeness until now
    power_cord_rating: opt, compatible_platform: opt, chromatic_dispersion_tolerance: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, ethernet_technology: opt, gre_tunnels: opt, layer2_features: opt, layer3_features: opt, manageable: opt, management_interfaces: opt, max_ports_100g: opt, max_ports_10g: opt, max_ports_1g: opt, max_ports_25g: opt, max_ports_40g: opt, max_ports_50g: opt, media_type_supported: opt, module_width_slots: opt, multicast_features: opt, network_technology: opt, packaging_dimensions: opt, power_load_range: opt, product_line: opt, qsfp28_ports: opt, rear_clearance: opt, rear_panel_ports: opt, security_features: opt, series_release_date: opt, simultaneous_connections: opt, temp_operating_extended: opt, thermal_shock: opt, voq_buffer: opt,
  }),
  // MDS storage-networking switches are Fibre Channel switches — the switch dictionary fields apply.
  "storage-networking": deviceOnly({
    fabric_services: opt, serviceability: opt, supported_protocols: opt, programming_interfaces: opt, advanced_functions: opt, product_compatibility: opt, diagnostics: opt, redundancy: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: req,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    ports: req, switching_capacity: opt, forwarding_rate: opt, latency: opt, module_slots: opt,
    psu_config: opt, psu_redundant: opt, power_max: req, cooling: opt, airflow: opt,
    temp_operating: req, dimensions: req, weight: req, certifications: req, mtbf: opt,
    // STRUCTURE 8 Sep 2026: 7 field(s) its documents already produce and no profile declared — invisible to completeness until now
    temp_class: opt, segment_routing_features: opt, qos_features: opt, modulation_format: opt, safety_standards: opt, queues_per_port: opt, status_leds: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    automation_features: opt, color: opt, color_options: opt, connectivity_options: opt, country_of_origin: opt, drive_options: opt, manageable: opt, management_interfaces: opt, media_type_supported: opt, packaging_dimensions: opt, product_line: opt, random_read_iops_4k: opt, random_write_iops_4k: opt, read_latency: opt, rear_clearance: opt, security_features: opt, sequential_write_throughput: opt, series_release_date: opt, temp_operating_extended: opt, thermal_shock: opt, write_latency: opt,
  }),
  // Transponders / muxponders / DWDM systems — reuse the transceiver optical fields.
  "optical-networking": deviceOnly({
    optical_pm: opt, input_power_range: opt, coherent_interop_standards: opt, shelf_assembly: opt, min_software_release: opt, cross_connect: opt, slot_compatibility: opt, otn_pm: opt, attenuation_dead_zone: opt, reflective_dead_zone: opt, rx_wavelength: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: req,
    data_rate: req, wavelength: req, reach_max: req, connector: req, fec: opt,
    power_max: req, dimensions: req, weight: req, temp_operating: req, certifications: req, mtbf: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    // cd_tolerance REMOVED 11 Sep 2026: a duplicate of chromatic_dispersion_tolerance (same label, same
    // unit, zero facts), which this category already declares. See the note under `transceiver`.
    breakout_point_length: opt, channel_bandwidth: opt, cin: opt, color: opt, color_options: opt, country_of_origin: opt, gain: opt, gain_flatness: opt, input_wavelength: opt, modulation_type: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, pdl: opt, pmd: opt, product_line: opt, rear_clearance: opt, restore_threshold: opt, rf_attenuation_range: opt, rf_bandwidth: opt, rf_input_return_loss: opt, rf_output_return_loss: opt, rf_response_flatness: opt, rf_test_point: opt, rf_tilt: opt, series_release_date: opt, switching_threshold: opt, temp_operating_extended: opt, thermal_shock: opt,
  }),
  // Line cards, network modules, interface cards.
  "interfaces-modules": deviceOnly({
    itu_channel: opt, jacket_material: opt, jacket_color: opt, rx_wavelength: opt, supported_transceivers: opt, supported_modules: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: req,
    ports: req, uplink_ports: opt, poe_standard: opt, module_slots: opt,
    power_max: req, dimensions: req, weight: req, temp_operating: req, certifications: req,
    // STRUCTURE 8 Sep 2026: 4 field(s) its documents already produce and no profile declared — invisible to completeness until now
    layer: opt, module_type: opt, compatible_platform: opt, installation_type: opt,
    // STRUCTURE 8 Sep 2026: dictionary key(s) that NO category declared — defined, labelled, and unreachable by any product until now
    // cd_tolerance -> chromatic_dispersion_tolerance, 11 Sep 2026: one key per quantity (see `transceiver`).
    breakout_point_length: opt, chromatic_dispersion_tolerance: opt, channel_bandwidth: opt, color: opt, color_options: opt, country_of_origin: opt, input_wavelength: opt, modulation_type: opt, module_width_slots: opt, noise_equivalent_power: opt, optical_agc_range: opt, output_power_stability: opt, packaging_dimensions: opt, product_line: opt, series_release_date: opt,
  }),
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
    // their form factor could take. SFP-DD and CFP8 were checked the same way and have zero parts.
    form_factor: ["gbic", "x2", "xenpak", "xfp", "sfp", "sfp-plus", "sfp28", "sfp56",
      "qsfp-plus", "qsfp28", "qsfp56", "qsfp-dd", "cfp", "cfp2", "cpak", "osfp"],
  },
};

// And for plausibility BANDS — 11 Sep 2026, raised by the reviewer and confirmed by replay. The
// band lived only on the dictionary entry, and power_max's is a switch's: [1, 30000] W. On an optic
// that is wrong at both ends: the real normaliser refuses "0.8 W" (RANGE_VIOLATION) and not one of
// the 520 stored transceiver power facts is below 1 W, while the same band would store a 3 kW SFP.
// Measured distribution: 376 of 520 under 5 W, the largest real value in the 20s (coherent QSFP-DD);
// the one value above 40 W is a German-comma misread ("2,475 W (typisch)" stored as 2475) on a
// tier-0 seed row, listed for the operator rather than silently changed. Like the unit and domain
// overrides, a per-category band is not representable in field_dictionary and is not synced.
export const BAND_OVERRIDES: Record<string, Record<string, [number, number]>> = {
  transceiver: { power_max: [0.1, 40] },
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
  if (evalCondition(r.when, values)) return "req";
  // Settled false by what IS answered: nothing left unanswered can make it true (see settledFalse).
  if (settledFalse(r.when, values)) return "na";
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
  if (seen.has(key)) return "na";
  const next = new Set(seen).add(key);
  const unanswered = gateFields(r.when).some((f) => {
    if (values[f] !== undefined) return false;
    const gate = requirementFor(category, f, values, next);
    return gate === "req" || gate === "pending";
  });
  return unanswered ? "pending" : "na";
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
};
for (const p of Object.values(PROFILES)) {
  for (const [dup, canon] of Object.entries(SUPERSEDED_KEYS)) {
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
    cfp: { de: "CFP", en: "CFP" }, cfp2: { de: "CFP2", en: "CFP2" },
    cpak: { de: "CPAK", en: "CPAK" }, osfp: { de: "OSFP", en: "OSFP" },
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
