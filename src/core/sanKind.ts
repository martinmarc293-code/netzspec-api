// src/core/sanKind.ts — what KIND of thing a Cisco storage-networking (MDS 9000) part is (optical-storage,
// 12 Sep 2026).
//
// THE DEFECT. `storage-networking` asked all 1,367 hardware parts one flat set behind the shared
// device/component axis: form factor, ports, power, temperature, dimensions, weight, certifications. So an
// MDS 9706 FABRIC MODULE (DS-X9706-FAB1) owed a port layout and a weight, a supervisor owed a rack height,
// and an MDS 9513 director CHASSIS owed a port configuration it does not have (its ports arrive on line
// cards). And 801 of the 1,367 are not hardware at all: NX-OS / SAN-OS images ("MDS 9200 Supervisor/Fabric-2,
// NX-OS Software Release 5.2(1)", M92S2K9-5.2.1) and feature / port-activation licences (M9148S-PL12
// "12-port On-Demand Activation license", M9100ENT1K9 "Enterprise Package"). Those are the class rules'
// business (productClass.ts, this group's block); here they are the `software` kind, asked nothing.
//
// MDS PIDs ARE REGULAR, which makes this the cleaner of the two axes: DS-C<model> is a switch or a director
// chassis, DS-X<model> a module, -SF<n> a supervisor, -FAB<n> a fabric module, DS-CAC / DS-CDC / DS-CHV a
// supply, -FAN a fan tray, -KIT an accessory kit, and every M9... PID is a licence or an image except the one
// real module in the family (M9XT-FC1632, "MDS 32G FC Port Expansion module").
//
// A DIRECTOR IS NOT A SWITCH HERE, unlike switchKind's chassis trade-off. The MDS 9500 / 9700 directors are
// sold as a chassis and are asked their slots; the fixed fabric switches (9100 / 9200 / 9300 / 9396) are asked
// their ports. The 9216 / 9222i "1-slot modular" switches have fixed ports AND an expansion slot: they are
// switches (their datasheet states the ports), and module_slots stays optional for them.
//
// THE DEFAULT IS `other`, AND IT ASKS NOTHING. Every family above is named; the residue is read in the
// session report (an "EXPAND OPT", a promotional package, an IBM-rebadged row with no name).
//
// ORDER (first match wins): software before everything (M9148S-SP-12P8G is a licence that ships SFPs);
// accessory before cable (DS-6SLOT-CAB= is "Rack Mount and Cable Mgmt Brackets"); fan before power.

export type SanKind =
  | "switch" | "director" | "linecard" | "supervisor" | "fabric"
  | "power" | "fan" | "cable" | "accessory" | "pluggable" | "software" | "other";

/** Every kind the axis can name, in ledger order. */
export const SAN_KINDS: readonly SanKind[] = [
  "switch", "director", "linecard", "supervisor", "fabric",
  "power", "fan", "cable", "accessory", "pluggable", "software", "other",
];
/** Whole boxes you rack and power — the only kinds asked a physical envelope. */
export const SAN_BOX: readonly SanKind[] = ["switch", "director"];
/** Modules that plug into a director slot and draw their own power. */
export const SAN_MODULE: readonly SanKind[] = ["linecard", "supervisor", "fabric"];
/** Everything bought for WHAT IT FITS. Cables are bought by length. */
export const SAN_FITS: readonly SanKind[] = ["linecard", "supervisor", "fabric", "power", "fan", "accessory"];

const RULES: { kind: SanKind; re: RegExp }[] = [
  // Licences and images still classed hardware: every M9... PID except the expansion module, SSI images,
  // Cisco ONE packages for MDS, the UCS-EP-MDS port-licence bundles, the 9222i free-software promotion.
  { kind: "software", re: /^M9(?!XT-)|^SSI-|^L\d-|^C1-ENT-M9|^UCS-EP-MDS|^MDS-\d+I?-FREE-SW/ },
  // A pluggable optic (DS-FC-SW-4PK= "1/2-Gbps Fibre Channel-Shortwave, SFP, LC, 4 pack"). A move to
  // `transceiver` is proposed; until then it is asked what an optic is asked.
  { kind: "pluggable", re: /^DS-(?:FC-|SFP|X2-|CWDM|QSFP)/ },
  // Accessories: accessory kits (DS-9148-KIT-HP, DS-9250I-KITCCO), rack-mount / bottom-support / cable-management
  // / front-door kits and filters, clock modules, smart cards and their reader, DIMMs and CompactFlash, the port
  // analyser adapter. DS-6SLOT-CAB= and DS-9SLOT-CAB= are BRACKETS whose PID ends in CAB.
  {
    kind: "accessory",
    re: /-KIT(?:-|=|$)|-KIT[A-Z]|^DS-\d+SLOT-CAB|(?:^|-)(?:RMK|BSK|CBTOP|FD|FDAFLT|CL)(?:-|=|$)|^DS-SCR?-|^DS-DIMM|^MEM-|^DS-PAA|-EXPAND$/,
  },
  // Cables: power cords (CAB-9K10A-SW, CAB-C15-CBN) and the X2 copper cables (DS-CAB-1M=).
  { kind: "cable", re: /^CAB-|^DS-CAB-\d/ },
  // Fan trays: DS-C48-FAN, DS-13SLT-FAN-R, DS-C32S-FAN-E, DS-9SL0T-FAN (the zero is Cisco's).
  { kind: "fan", re: /(?:^|-)FAN(?:-|=|$)/ },
  // Supplies: AC / DC / HVDC supplies, the fixed-switch 300 W supplies, power entry modules, the 9216 PS kit.
  { kind: "power", re: /^DS-C(?:AC|DC|HV)|^DS-PEM-|^DS-C\d+[A-Z]?-\d{3,4}AC|^DS-C9216-PS|^PWR-/ },
  // Supervisors: DS-X9530-SF2AK9 "Supervisor/Fabric-2A", DS-X97-SF1E-K9, DS-X97-SF4-K9.
  { kind: "supervisor", re: /-SF\d[A-Z]?(?:-|K9|=|$)/ },
  // Crossbar fabric modules: DS-X9706-FAB1, DS-X9718-FAB3, DS-13SLT-FAB2.
  { kind: "fabric", re: /-FAB\d/ },
  // Switching and services modules for a director slot, and the 9220i expansion module.
  { kind: "linecard", re: /^DS-X9|^M9XT-/ },
  // Director chassis and base configurations: MDS 9506 / 9509 / 9513 / 9706 / 9710 / 9718.
  { kind: "director", re: /^DS-C9[57]\d\d/ },
  // Fixed fabric switches (9120, 9124, 9132T, 9134, 9148/S/T/V, 9216/i, 9222i, 9220i, 9250i, 9396S/T/V), the HP
  // blade-system FC switch, and the IBM-rebadged SAN50C-R.
  { kind: "switch", re: /^DS-C9\d|^DS-9134G|^DS-HP-\d+GFC|^SAN\d+C-/ },
];

/** The ordered rule table, exported so tests/sanKind.test.ts can disable one family and watch it go red. */
export const SAN_KIND_RULES: readonly { kind: SanKind; re: RegExp }[] = RULES;

/** Index of the rule that decides this SKU (-1 = the `other` default). Pure; drives the sabotage cases. */
export function sanKindRule(sku: string, rules: readonly { kind: SanKind; re: RegExp }[] = RULES): number {
  const s = String(sku ?? "").trim().toUpperCase().replace(/[=+]+$/, "");
  if (s === "") return -1;
  return rules.findIndex((r) => r.re.test(s));
}

export function sanKindWith(rules: readonly { kind: SanKind; re: RegExp }[], sku: string): SanKind {
  const i = sanKindRule(sku, rules);
  return i < 0 ? "other" : rules[i].kind;
}

export function sanKind(sku: string): SanKind {
  return sanKindWith(RULES, sku);
}
