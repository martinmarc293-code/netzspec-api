// src/core/switchKind.ts — what KIND of thing a Cisco switch-category part is.
//
// THE DEFECT. `switches` asks 40.5 required fields of every one of its 8,985 hardware parts —
// 363,773 required-field slots, six times `security` and twenty-one times
// `servers-unified-computing`. A power cord is asked for switching capacity, a fan tray for a MAC
// table size. It is also the best-populated category in the catalogue (4,697 parts carry at least
// one required field, against 54 and 172), so there is real data here to protect.
//
// WHY NEITHER TOKEN POSITION WORKS, unlike UCS. Measured 10 Sep 2026:
//   FIRST segment  — 625 distinct, top 24 cover 57%, and impure: `WS` carries 600 switch-facts AND
//                    96 component-facts, because WS-C3750G is a switch, WS-X4448 a line card and
//                    WS-CAC-3000W a power supply. The family prefix is shared by a switch and
//                    everything that plugs into it.
//   SECOND segment — 1,178 distinct, top 20 cover 49%, and the biggest code (`C`, 2,089 parts) is
//                    impure. Worse, `C9300-48P` splits as model | PORT COUNT, so `24P` and `48P`
//                    show up as "kinds". Cisco has no consistent kind slot in a switch PID.
//
// SO THE RULE IS A MARKER IN ANY SEGMENT, DEFAULTING TO SWITCH. That is the opposite of the UCS
// design and it is the right way round here: the components are the nameable minority (PWR, FAN,
// CAB, blanks, brackets, line cards, supervisors) and everything else is the product. Defaulting
// to `switch` also fails in the safe direction — a component wrongly left as a switch carries
// gaps, where a switch wrongly called a component would have its real questions CLOSED.
//
// EVERY MARKER BELOW WAS MEASURED AGAINST THE PART NAME BEFORE IT WAS KEPT. The control is the
// name: does it say "line card"/"supervisor"/"fabric module" (a part) or "switch"/"chassis"/
// "fabric extender" (a device)? Counts over all 8,985 hardware parts, part-evidence / device-
// evidence:
//
//   WS-X####   56/0    N?K-M###  21/0    IEM-  25/0    -NM-  52/0    SUP  83/0    -LC-  5/0
//   -FM-/-FAB- 39/5 -> all five are "Nexus 7700 - 18 Slot Chassis Fabric 3 Module": the name says
//                     BOTH, and they are fabric modules. One genuine miss in 64 (N35-FM-48X, a
//                     multiplexer switch).
//
// THE THREE MARKERS THAT WERE DELETED, AND WHY — this is the part worth keeping. `X`, `M` and `F`
// as whole segments looked like the obvious line-card/supervisor/fabric letters. Measured:
//
//   seg X alone   77 parts    part-evidence 0   device-evidence 26   (Nexus 3064-X, C6840-X)
//   seg M alone   49 parts    part-evidence 0   device-evidence  1   (C9300-24S-M = modular uplink)
//   seg F alone   51 parts    part-evidence 0   device-evidence 17   (C4500X-F = front-to-back)
//
// ZERO part evidence between them, across the whole catalogue, and 44 switches they would have
// filed as components — the dangerous direction, where a real switch has its real questions
// closed. They are model suffixes, airflow codes and reach codes, not kinds. A single letter in a
// Cisco PID is almost never a kind.
//
// AND THERE IS NO DETECTABLE CHASSIS. `CHAS`/`CHASSIS` as a segment matches exactly ONE SKU in
// 8,985 and it is `OLD-CISCO-CHASSIS-MIB`, a MIB name. `FAB` is not a chassis either — all 25
// `N7X-...-FAB-n` parts are fabric MODULES that plug into one. A real chassis (`WS-C4507R-E`,
// "Cat4500 E-Series 7-Slot Chassis") carries no marker at all and correctly falls through to
// `switch`, which is what it is: a whole device that holds a switching specification.
//
// A NOTE ON THE PURITY TEST THAT NEARLY MISLED ME. `airflow` and `module_slots` were in my
// component-fact list, so 256 CHASSIS in the default bucket looked like missed components:
// WS-C4507R-E "Cat4500 E-Series 7-Slot Chassis, fan, no ps". A chassis legitimately has both. The
// test was wrong, not the axis.

export type SwitchKind =
  | "switch" | "module" | "power" | "fan" | "cable" | "accessory" | "software";

/** Kinds that are a whole networking device — the only ones a switching specification belongs to. */
export const SW_DEVICE: readonly SwitchKind[] = ["switch"];

/** Kinds that plug into one. Cisco publishes no switching capacity or MAC table for these. */
export const SW_PART: readonly SwitchKind[] =
  ["module", "power", "fan", "cable", "accessory", "software"];

// Ordered; the FIRST rule that matches wins. The order is not cosmetic:
//   fan before power   — `NXA-` is a Nexus ACCESSORY prefix covering both (27 fans, 74 supplies),
//                        so a power rule matching it swallowed `NXA-SFAN-30CFM-PI`. `NXA` is gone
//                        as a marker and the two are told apart by their own tokens instead.
//   cable/accessory before power — `CAB-SPWR-150CM` is a cord and `ME34X-PWR-BLANK` is a cover;
//                        both carry a power token and neither is a power supply.
//   module last        — its markers are the least specific, and a device must not fall into it.
const RULES: { kind: SwitchKind; re: RegExp }[] = [
  // N5KUK9-503N1.1, NXOS-703I7.6 — an operating-system image sold under a switch family PID.
  { kind: "software", re: /(?:^|-)(?:NXOS|SW|IOS)(?:-|$)|UK9(?:-|=|$)/ },
  // FAN, FAN1, FANTRAY, and Nexus's single-fan SFAN. 140 fan-evidence, 0 genuine device.
  { kind: "fan", re: /(?:^|-)S?FAN(?:TRAY)?\d*(?:-|=|$)/ },
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL)(?:-|=|$)|-STACK|-STK(?:-|=|$)/ },
  { kind: "accessory", re: /(?:^|-)(?:BLNK|BLANK|BRKT|RCKMNT|MNT|KIT|ACC|CVR|TRAY|RAIL|REC|COVER)(?:-|=|\d|$)/ },
  // PAC 66/83 psu, PHV 17/17, PDC 26/27, CAC 8/10, and a bare wattage token 111/135.
  { kind: "power", re: /(?:^|-)(?:PWR|PAC|PHV|PDC|PSU|CAC|DCPWR|ACPWR)(?:-|=|\d|$)|-\d+W(?:AC|DC)/ },
  // Line cards, supervisors, network/expansion/fabric modules. Every one measured above.
  //
  // THE SECOND HALF WAS ADDED 10 SEP 2026 after a review asked for the REVERSE name control:
  // parts filed `switch` whose NAME says line card / supervisor / fabric module / system
  // controller. That returned 137 — not the "at least 300" the review estimated, and some of the
  // 137 are false positives of the control itself (C9500-24X-E is a SWITCH whose name ends
  // "8 x 10GE Network Module"). Each pattern below was then measured on its own, part-evidence
  // against device-evidence, exactly as the six above were:
  //
  //   WS-F6K- / WS-F6700-   34 parts   9 part / 0 device   6500 PFC and DFC daughter cards
  //   N5[56]-M###           28 parts   8 / 0               Nexus 5500/5600 expansion modules
  //   N77-[MF]###           32 parts   8 / 1               7700 I/O line cards; the one "device"
  //                                                        is N77-F324-P2, a 2-pack BUNDLE of
  //                                                        them, whose name says "Chassis Config"
  //   C6800-*P10G           18 parts   6 / 0               6800 port cards
  //   VS-S720- / VS-S2T-    10 parts   8 / 0               Cat 6500 Sup720 / Sup2T — no "SUP"
  //                                                        token in the PID, which is why the
  //                                                        SUP rule above misses them
  //   7600-ES               4 parts    4 / 0               7600 Ethernet Services line cards
  //   C9400-SSD             4 parts    3 / 0               supervisor M.2 storage
  //   WS-S32                2 parts    2 / 0               Sup32
  //   C6880-X-LE-           3 parts    1 / 0               6880-X port cards
  //
  // TWO FAMILIES THE REVIEW NAMED HAVE ZERO PARTS IN THIS CATEGORY and are deliberately absent:
  // `N9K-X####` (Nexus 9500 line cards) and `N9K-SC-` (system controllers) both return 0 — they
  // live under `data-center-networking`. A rule for a population that does not exist is a rule
  // nobody has seen work, and productClass.test.ts's reachability check exists for that reason.
  {
    kind: "module",
    re: /-X\d|(?:^|-)N\d+K-[MF]\d|^IEM-|-LC(?:-|=|$)|-NM(?:-|=|$)|-(?:FM|FAB)(?:-|=|\d|$)|(?:^|-)SUP(?:-|=|\d|$)|^WS-F6(?:K|700)|^N5[56]-M\d|^N77-[MF]\d|^C6800-.*P10G|^VS-S(?:720|2T)|^7600-ES|^C9400-SSD|^WS-S\d|^C6880-X-LE-/,
  },
];

export function switchKind(sku: string): SwitchKind {
  const s = String(sku ?? "").toUpperCase();
  if (s === "") return "switch";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "switch";
}
