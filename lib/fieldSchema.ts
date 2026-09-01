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
  rack_units: { key: "rack_units", de: "Höheneinheiten", en: "Rack units", type: "n", unit: "HE", band: [1, 30], etim: [], icecat: null },
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
  airflow: { key: "airflow", de: "Luftstromrichtung", en: "Airflow direction", type: "e", domain: ["front-to-back", "back-to-front", "side", "reversible"], etim: [], icecat: null },
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
  connector: { key: "connector", de: "Anschlusstyp", en: "Connector", type: "e", domain: ["lc-duplex", "lc-simplex", "sc", "mpo-12", "mpo-16", "rj45", "integrated"], etim: [], icecat: null },
  tx_power: { key: "tx_power", de: "Sendeleistung (TX)", en: "TX power", type: "nr", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  rx_sensitivity: { key: "rx_sensitivity", de: "Empfangsempfindlichkeit (RX)", en: "RX sensitivity", type: "nr", unit: "dBm", band: [-40, 20], etim: [], icecat: null },
  link_budget: { key: "link_budget", de: "Link-Budget", en: "Link budget", type: "n", unit: "dB", band: [0, 60], etim: [], icecat: null },
  laser_type: { key: "laser_type", de: "Lasertyp", en: "Laser type", type: "e", domain: ["vcsel", "fp", "dfb", "eml"], etim: [], icecat: null },
  mode: { key: "mode", de: "Übertragungsmodus", en: "Transmission mode", type: "e", domain: ["duplex", "simplex-bidi"], etim: [], icecat: null },
  bidi_wavelengths: { key: "bidi_wavelengths", de: "BiDi-Wellenlängen (TX/RX)", en: "BiDi wavelengths", type: "struct", unit: "nm", shape: "{ tx: n, rx: n }", etim: [], icecat: null },
  ddm: { key: "ddm", de: "DDM/DOM", en: "DDM/DOM", type: "b", etim: [], icecat: null },
  fec: { key: "fec", de: "FEC-Anforderung", en: "FEC requirement", type: "e", domain: ["none", "rs-fec", "fc-fec", "host-dependent"], etim: [], icecat: null },
  temp_class: { key: "temp_class", de: "Temperaturbereich", en: "Temperature class", type: "e", domain: ["commercial", "extended", "industrial"], etim: [], icecat: null },
  cable_length: { key: "cable_length", de: "Kabellänge", en: "Cable length", type: "n", unit: "m", band: [0.1, 100], etim: [], icecat: null },
  wire_gauge: { key: "wire_gauge", de: "Leiterquerschnitt", en: "Wire gauge", type: "n", unit: "AWG", band: [20, 34], etim: [], icecat: null },
  msa: { key: "msa", de: "MSA-Konformität", en: "MSA compliance", type: "ls", examples: ["sff-8472", "sff-8636", "qsfp-dd-msa"], etim: [], icecat: null },
};

// ---------------------------------------------------------------------------------------------
// Per-category profiles
// ---------------------------------------------------------------------------------------------

const req: Requirement = { kind: "req" };
const opt: Requirement = { kind: "opt" };
const cond = (when: Condition): Requirement => ({ kind: "cond", when });

export const PROFILES: Record<string, Record<string, Requirement>> = {
  switches: {
    vendor: req, series: req, mgmt_class: req, layer: req, form_factor: req,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    stackable: req, deploy_role: opt,
    ports: req, uplink_ports: req, uplink_modular: opt,
    module_slots: cond({ any: [{ field: "form_factor", eq: "modular-chassis" }, { field: "uplink_modular", eq: true }] }),
    mgmt_ports: req,
    poe_standard: req,
    poe_ports: cond({ field: "poe_standard", ne: "none" }),
    poe_budget: cond({ field: "poe_standard", ne: "none" }),
    poe_per_port_max: opt,
    switching_capacity: req, forwarding_rate: req,
    stacking_bandwidth: cond({ field: "stackable", eq: true }),
    stack_max_members: cond({ field: "stackable", eq: true }),
    packet_buffer: req, mac_table: req, vlan_max: req,
    ipv4_routes: cond({ field: "layer", ne: "l2" }),
    ipv6_routes: cond({ field: "layer", ne: "l2" }),
    multicast_groups: opt, acl_entries: opt,
    jumbo_mtu: req, latency: opt, cpu: opt, dram: req, flash: req,
    psu_config: req, psu_redundant: req, psu_options: opt, cooling: req,
    airflow: cond({ field: "deploy_role", inList: ["datacenter-tor", "aggregation", "core"] }),
    power_typical: req, power_max: req, input_voltage: req, input_freq: opt, heat_dissipation: req,
    temp_operating: req, temp_storage: req, humidity_operating: req, altitude_max: req,
    acoustic_noise: opt, mtbf: req,
    dimensions: req, weight: req, certifications: req, ieee_standards: req,
    ip_rating: cond({ any: [{ field: "form_factor", eq: "din-rail" }, { field: "deploy_role", eq: "industrial" }] }),
  },
  transceiver: {
    vendor: req, form_factor: req, standard: req, data_rate: req, media: req,
    fiber_type: cond({ field: "media", inList: ["mmf", "smf"] }),
    wavelength: cond({ field: "media", inList: ["mmf", "smf", "aoc"] }),
    reach_max: req, connector: req,
    tx_power: cond({ field: "media", inList: ["mmf", "smf"] }),
    rx_sensitivity: cond({ field: "media", inList: ["mmf", "smf"] }),
    link_budget: opt, laser_type: opt, mode: req,
    bidi_wavelengths: cond({ field: "mode", eq: "simplex-bidi" }),
    ddm: req,
    fec: cond({ field: "data_rate", gte: 25 }),
    power_max: req, temp_class: req,
    cable_length: cond({ field: "media", inList: ["dac-copper", "aoc"] }),
    wire_gauge: opt, msa: opt, dimensions: opt, weight: opt, certifications: opt, mtbf: opt,
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
    form_factor: ["gbic", "x2", "xenpak", "xfp", "sfp", "sfp-plus", "sfp28", "sfp56",
      "qsfp-plus", "qsfp28", "qsfp56", "qsfp-dd", "cfp", "cfp2"],
  },
};

export function unitFor(category: string, key: string): string | undefined {
  return UNIT_OVERRIDES[category]?.[key] ?? FIELD_DICTIONARY[key]?.unit;
}

export function domainFor(category: string, key: string): string[] | undefined {
  return DOMAIN_OVERRIDES[category]?.[key] ?? FIELD_DICTIONARY[key]?.domain;
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
  if ("ne" in c) return actual !== c.ne;
  if ("inList" in c) return actual !== undefined && c.inList.includes(actual as string | number);
  if ("gte" in c) return typeof actual === "number" && actual >= c.gte;
  if ("truthy" in c) return Boolean(actual);
  return false;
}

/** Resolve a field's requirement FOR THIS PART. An unmet conditional is not-applicable —
 *  a closed gap, not an open one. That distinction is the whole point of the profile. */
export function requirementFor(category: string, key: string, values: PartValues): "req" | "opt" | "na" {
  const r = PROFILES[category]?.[key];
  if (!r) return "na";
  if (r.kind === "cond") return evalCondition(r.when, values) ? "req" : "na";
  return r.kind;
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

export function completenessV2(category: string, values: PartValues): CompletenessV2 {
  const profile = PROFILES[category];
  if (!profile) {
    return { category, required_total: 0, required_present: 0, missing: [], optional_present: 0,
      na: 0, pct: 0, no_profile: true };
  }
  const missing: string[] = [];
  let requiredTotal = 0, requiredPresent = 0, optionalPresent = 0, na = 0;
  for (const key of Object.keys(profile)) {
    const kind = requirementFor(category, key, values);
    const present = values[key] !== undefined && values[key] !== null && values[key] !== "";
    if (kind === "req") {
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

export const CATEGORIES = Object.keys(PROFILES);
