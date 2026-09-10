// src/core/componentKind.ts — is this part a DEVICE, or something that plugs into one?
//
// THE SHARED HALF OF switchKind. Eleven Cisco categories have a profile in which no conditional
// has ever fired — `count(DISTINCT required_total) = 1`, every part asked an identical set:
//
//   routers 6,714 @ 13 · wireless 5,184 @ 8 · video 3,370 @ 10 · unified-comms 2,947 @ 10
//   collab-endpoints 2,902 @ 14 · optical-networking 2,095 @ 10 · hyperconverged-systems 1,673 @ 12
//   interfaces-modules 1,471 @ 7 · storage-networking 1,418 @ 8 · hyperconverged-infra 997 @ 14
//   meraki 283 @ 12
//
// So a power cord in `routers` is asked for a forwarding rate, and a rack rail in
// `collaboration-endpoints` for an audio codec. Measured across those eleven: 3,229 parts carry a
// component marker, worth ~36,950 required slots.
//
// WHY A SEPARATE MODULE FROM switchKind. switchKind also names MODULES (line cards, supervisors,
// fabric modules) and those markers are switch-family specific — `N77-[MF]###`, `VS-S720-`,
// `WS-F6K-`. What generalises is the half below: Cisco writes PWR/PAC/FAN/CAB/RCKMNT/BLNK the same
// way in every category. This module claims nothing about modules, and defaults to `device`, which
// fails in the safe direction: a component left as a device carries gaps, where a device called a
// component has its real questions CLOSED.
//
// ORDER DIFFERS FROM switchKind DELIBERATELY, and it is the one defect the cross-category
// measurement found. switchKind tests software FIRST, because in that category an image PID can
// carry any family prefix. Applied to the other eleven that ordering misfiled:
//
//   AIR-PWR-CORD-SW    "Cisco AIR-PWR-CORD-SW"           a SWITZERLAND power cord
//   CTS-5K-CBL-R1-SW   "CTS-IX5000 Cable kit, front row"  a cable
//
// — because `SW` there is a country code, not software, and it beat the PWR and CBL markers. Here
// software is tested LAST, so a part carrying any physical-component token is that component first.
//
// KNOWN COST, named rather than hidden. Three parts of 389 carrying a `KIT` segment are not
// accessories: CRS-FCC-DC-KIT ("CRS Fabric Chassis DC Power Kit" — a power kit, so still a
// component), NCS4KF-STRT-KIT and NCS4009-FC2-S-KIT ("NCS 4009 Fabric ... with Fan - kit"), which
// are fabric-card kits and will be asked nothing. And two parts of 399 carrying an `SW` segment are
// physical: HX-C480-INT-SW / HX-C480-INT-SW= "UCS C480 Safety Intrusion Switch". None of the five
// carries a fact today. They are listed so the next reader can find them rather than rediscover
// them, and vetoing them by SKU token would be enumerating the burns rather than stating a rule.

export type ComponentKind = "device" | "power" | "fan" | "cable" | "accessory" | "software";

/** The only kind a product specification belongs to. Everything else plugs into one. */
export const GENERIC_DEVICE: readonly ComponentKind[] = ["device"];

/** Kinds that plug into a device. A vendor publishes no product specification for these. */
export const GENERIC_COMPONENT: readonly ComponentKind[] =
  ["power", "fan", "cable", "accessory", "software"];

// Ordered; first match wins. Physical components before software — see the header.
const RULES: { kind: ComponentKind; re: RegExp }[] = [
  // PAC/PHV/PDC/CAC are Cisco's AC/HV/DC/AC-chassis supply tokens; the bare wattage form
  // (-500WAC, -930WDC) catches the ones that carry no letter token at all.
  { kind: "power", re: /(?:^|-)(?:PWR|PAC|PHV|PDC|PSU|CAC|DCPWR|ACPWR)(?:-|=|\d|$)|-\d+W(?:AC|DC)/ },
  { kind: "fan", re: /(?:^|-)S?FAN(?:TRAY)?\d*(?:-|=|$)/ },
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL)(?:-|=|$)|-STACK|-STK(?:-|=|$)/ },
  { kind: "accessory", re: /(?:^|-)(?:BLNK|BLANK|BRKT|RCKMNT|MNT|KIT|ACC|CVR|TRAY|RAIL|REC|COVER)(?:-|=|\d|$)/ },
  { kind: "software", re: /(?:^|-)(?:NXOS|SW|IOS)(?:-|$)|UK9(?:-|=|$)/ },
];

export function componentKind(sku: string): ComponentKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "device";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "device";
}
