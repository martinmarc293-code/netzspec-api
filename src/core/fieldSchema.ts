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

  // --- security / firewall (NGFW) -------------------------------------------------------------
  // Datasheet throughput is quoted in Gbps (large boxes) and Mbps (branch); the normaliser folds
  // both to Gbit/s so a comparison tool can rank them on one axis. Sessions run to billions.
  firewall_throughput: { key: "firewall_throughput", de: "Firewall-Durchsatz", en: "Firewall throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  threat_throughput: { key: "threat_throughput", de: "Threat-Inspection-Durchsatz", en: "Threat inspection throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  ips_throughput: { key: "ips_throughput", de: "IPS-Durchsatz", en: "IPS throughput", type: "n", unit: "Gbit/s", band: [0.02, 5000], etim: [], icecat: null },
  vpn_throughput: { key: "vpn_throughput", de: "IPsec-VPN-Durchsatz", en: "IPsec VPN throughput", type: "n", unit: "Gbit/s", band: [0.01, 5000], etim: [], icecat: null },
  concurrent_sessions: { key: "concurrent_sessions", de: "Gleichzeitige Sessions", en: "Concurrent sessions", type: "n", unit: "Sessions", band: [1000, 3000000000], etim: [], icecat: null },
  new_conn_per_sec: { key: "new_conn_per_sec", de: "Neue Verbindungen/s", en: "New connections per second", type: "n", unit: "1/s", band: [100, 30000000], etim: [], icecat: null },
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
  shock: { key: "shock", de: "Schockfestigkeit", en: "Shock resistance", type: "s", etim: [], icecat: null },
  slot_compatibility: { key: "slot_compatibility", de: "Slot-Kompatibilität", en: "Slot compatibility", type: "s", etim: [], icecat: null },
  supported_modules: { key: "supported_modules", de: "Unterstützte Module", en: "Supported modules", type: "ls", etim: [], icecat: null },
  supported_protocols: { key: "supported_protocols", de: "Unterstützte Protokolle", en: "Supported protocols", type: "ls", etim: [], icecat: null },
  supported_transceivers: { key: "supported_transceivers", de: "Unterstützte Transceiver-Module", en: "Supported transceiver modules", type: "ls", etim: [], icecat: null },
  usb_console: { key: "usb_console", de: "Integrierte USB-Konsole", en: "Integrated USB console", type: "b", etim: [], icecat: null },
};

// ---------------------------------------------------------------------------------------------
// Per-category profiles
// ---------------------------------------------------------------------------------------------

const req: Requirement = { kind: "req" };
const opt: Requirement = { kind: "opt" };
const cond = (when: Condition): Requirement => ({ kind: "cond", when });

export const PROFILES: Record<string, Record<string, Requirement>> = {
  switches: {
    rfc_compliance: opt, emc_immunity: opt, emc_emissions: opt, power_full_load: opt, // deep-spec fields 2026-09-02
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
    itu_channel: opt, jacket_material: opt, jacket_color: opt, rx_wavelength: opt, optical_pm: opt, input_power_range: opt, // deep-spec fields 2026-09-02
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
  security: {
    anyconnect_sessions: opt, expansion_io: opt, shock: opt, redundancy: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: req,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    firewall_throughput: req, threat_throughput: req, ips_throughput: opt, vpn_throughput: opt,
    concurrent_sessions: req, new_conn_per_sec: opt, vpn_peers: opt,
    max_interfaces: opt, storage_capacity: opt,
    psu_config: opt, psu_redundant: opt, power_max: opt, power_typical: opt,
    temp_operating: opt, humidity_operating: opt, altitude_max: opt,
    dimensions: req, weight: req, certifications: opt, mtbf: opt,
  },
  wireless: {
    supported_transceivers: opt, antenna_gain: opt, polarization: opt, antenna_connector: opt, beamwidth_elevation: opt, mounting: opt, recycled_content: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req,
    wifi_generation: req, spatial_streams: opt, radio_count: opt, radio_bands: opt,
    max_data_rate: opt, ap_max_clients: opt,
    wlc_ap_capacity: opt, wlc_client_capacity: opt,
    poe_standard: opt, power_max: opt,
    dimensions: opt, weight: opt, temp_operating: opt, certifications: opt, mtbf: opt,
  },
  routers: {
    supported_modules: opt, usb_console: opt, redundancy: opt, chassis_compatibility: opt, etsi_standards: opt, supported_protocols: opt, min_software_release: opt, emc_immunity: opt, emc_emissions: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: opt,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    router_throughput: req, forwarding_rate: opt, ipsec_throughput: opt, ipsec_tunnels: opt,
    dram: opt, flash: opt, mgmt_ports: opt, module_slots: opt,
    psu_config: opt, psu_redundant: opt, power_max: opt, power_typical: opt,
    temp_operating: opt, humidity_operating: opt, dimensions: opt, weight: opt, certifications: opt, mtbf: opt,
  },
  // MDS storage-networking switches are Fibre Channel switches — the switch dictionary fields apply.
  "storage-networking": {
    fabric_services: opt, serviceability: opt, supported_protocols: opt, programming_interfaces: opt, advanced_functions: opt, product_compatibility: opt, diagnostics: opt, redundancy: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: opt,
    rack_units: cond({ field: "form_factor", inList: ["rack-19", "modular-chassis"] }),
    ports: opt, switching_capacity: opt, forwarding_rate: opt, latency: opt, module_slots: opt,
    psu_config: opt, psu_redundant: opt, power_max: opt, cooling: opt, airflow: opt,
    temp_operating: opt, dimensions: opt, weight: opt, certifications: opt, mtbf: opt,
  },
  // Transponders / muxponders / DWDM systems — reuse the transceiver optical fields.
  "optical-networking": {
    optical_pm: opt, input_power_range: opt, coherent_interop_standards: opt, shelf_assembly: opt, min_software_release: opt, cross_connect: opt, slot_compatibility: opt, otn_pm: opt, attenuation_dead_zone: opt, reflective_dead_zone: opt, rx_wavelength: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: opt,
    data_rate: opt, wavelength: opt, reach_max: opt, connector: opt, fec: opt,
    power_max: opt, dimensions: opt, weight: opt, temp_operating: opt, certifications: opt, mtbf: opt,
  },
  // Line cards, network modules, interface cards.
  "interfaces-modules": {
    itu_channel: opt, jacket_material: opt, jacket_color: opt, rx_wavelength: opt, supported_transceivers: opt, supported_modules: opt, // deep-spec fields 2026-09-02
    vendor: req, series: req, form_factor: opt,
    ports: opt, uplink_ports: opt, poe_standard: opt, module_slots: opt,
    power_max: opt, dimensions: opt, weight: opt, temp_operating: opt, certifications: opt,
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
  if ("ne" in c) return actual !== undefined && actual !== c.ne;
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
    "mpo-16": { de: "MPO-16", en: "MPO-16" }, rj45: { de: "RJ45", en: "RJ45" },
    integrated: { de: "Fest konfektioniert", en: "Integrated" },
  },
  laser_type: {
    vcsel: { de: "VCSEL", en: "VCSEL" }, fp: { de: "Fabry-Pérot (FP)", en: "Fabry-Pérot (FP)" },
    dfb: { de: "DFB", en: "DFB" }, eml: { de: "EML", en: "EML" },
  },
  mode: {
    duplex: { de: "Duplex (Zweifaser)", en: "Duplex (two-fibre)" },
    "simplex-bidi": { de: "BiDi (Einzelfaser)", en: "BiDi (single-fibre)" },
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
