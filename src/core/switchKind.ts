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
  | "switch" | "fex" | "linecard" | "module" | "supervisor" | "fabric" | "daughter"
  | "power" | "fan" | "power-cord" | "stack-cable" | "stack-module" | "cable" | "accessory" | "software";

/** Kinds that are a whole networking device — the only ones a switching specification belongs to. */
export const SW_DEVICE: readonly SwitchKind[] = ["switch"];

/**
 * Kinds that are a whole BOX you rack and power — they carry a physical envelope (dimensions, weight,
 * temperatures, power, PSU, cooling, certifications) whether or not they switch. A fabric extender is
 * the one box that does not switch: it forwards everything to its parent, so it is asked the envelope
 * and its ports, never a MAC table, VLANs, a layer, stacking, DRAM or flash (11 Sep 2026).
 */
export const SW_BOX: readonly SwitchKind[] = ["switch", "fex"];

/**
 * Kinds that plug into one.
 *
 * `module` WAS FOUR THINGS until 11 Sep 2026, and the profile asked all four the same questions.
 * Measured over the 852 parts it held, against what each actually answers today:
 *
 *   port-bearing  619   ports 175  poe 42  switching_capacity 63  forwarding_rate  0
 *   supervisor    120   ports   0  poe  0  switching_capacity 13  forwarding_rate  8
 *   fabric         63   ports   0  poe  0  switching_capacity 10  forwarding_rate  0
 *   daughter       50   ports   0  poe  2  switching_capacity  0  forwarding_rate  0
 *
 * A fabric module was asked for ports and a PoE standard; a supervisor for a PoE standard. And the
 * switching_capacity column held two quantities: a line card's PER-SLOT bandwidth ("48 Gbit/s je
 * Steckplatz") and a supervisor's SYSTEM fabric ("6 Tbit/s Crossbar-Fabric"). So the three named
 * sub-kinds are split out, each by its own markers, and `module` keeps the port-bearing majority.
 * Name evidence: 110 of 120 supervisors, 58 of 63 fabric modules and 42 of 50 daughter cards say
 * so in their name; every remaining one was read (C9400X-SUP-2, N9K-C9508-FM-G, "Dist Fwd Card").
 */
export const SW_PART: readonly SwitchKind[] =
  ["linecard", "module", "supervisor", "fabric", "daughter", "power", "fan",
   "power-cord", "stack-cable", "stack-module", "cable", "accessory", "software"];

/** Kinds that plug into or attach to a switch — every one is bought for WHAT IT FITS (11 Sep 2026). */
export const SW_COMPONENT: readonly SwitchKind[] =
  ["linecard", "module", "supervisor", "fabric", "daughter", "power", "fan",
   "power-cord", "stack-cable", "stack-module", "cable", "accessory"];

/**
 * Kinds that are a length of cable — asked its length. `cable` WAS FOUR THINGS until 11 Sep 2026 (reviewer
 * §1.2), all asked the same two questions. Read by name, all 342: 187 power cords (AC and DC), 65 stack
 * cables, 28 stack MODULES and KITS (C3650-STACK-KIT "Cisco Catalyst 3650 Stack Module", C2960X-FIBER-STK
 * "FlexStack-Extended Fiber") that have no length at all, and 16 cable-MANAGEMENT kits and blanks
 * (N7K-C7009-CAB-TOP "Front Top Section and Cable Mgmt Kit", STACK-T2-BLANK) that are accessories. The other
 * 46 — console, fibre, CX4, RPS and StackPower cables — stay `cable`.
 */
export const SW_CABLE: readonly SwitchKind[] = ["power-cord", "stack-cable", "cable"];

// Ordered; the FIRST rule that matches wins. The order is not cosmetic:
//   fan before power   — `NXA-` is a Nexus ACCESSORY prefix covering both (27 fans, 74 supplies),
//                        so a power rule matching it swallowed `NXA-SFAN-30CFM-PI`. `NXA` is gone
//                        as a marker and the two are told apart by their own tokens instead.
//   cable/accessory before power — `CAB-SPWR-150CM` is a cord and `ME34X-PWR-BLANK` is a cover;
//                        both carry a power token and neither is a power supply.
//   module last        — its markers are the least specific, and a device must not fall into it.
// THE SECOND WIDENING, 11 Sep 2026 — the default bucket, audited from the other side. Parts filed
// `switch` whose NAME says they are something else and never calls itself a switch: 256, carrying
// 9,386 open required slots, because `switch` is the kind asked everything. Stacking cables asked for
// a MAC table, SD cards for a PoE budget. Every marker added below was gated the way the header
// demands — over all 7,480 switches hardware parts, part-evidence against DEVICE-evidence by name —
// and all 331 parts that change kind were read by name. Every device-evidence hit was a false alarm
// of the device test itself: a rack kit that names its chassis ("Rack Mount Kit for N9508 and N9516
// chassis"), a port adapter that names its ports ("2-Port Gigabit Ethernet Shared Port Adapter").
// No part that moves is a switch.
//
//   cable      ^STACK-            37   STACK-T2-3M — the old rule needed a hyphen BEFORE "STACK"
//   accessory  MEM / SSD / SD /    ~110 memory, SSDs, SD cards, compact flash and USB flash; MEM-X45 was
//              CF / CPF / USB          a `module` through -X\d and C9400-SSD a module by name — storage
//                                      has no ports and no switching capacity, which a module is asked
//              RMK RMB RM ACK RACK  34  rack-mount and accessory kits; glued KIT (IP30KIT, ACCKIT) 4
//              CBLE PCM CPU CLK     22  cable guards, power-cable management, CPU and clock FRUs
//              BMP DINCLP RPNL XBLNK 5  IE3000 bumper/clip/panel, Nexus blank module
//              FILTER / AFLT        17  air filters; WS-X4507-FILTER= was a `module` through -X\d
//   power      -nnnnW-AC/DC          8  C6840-X-1100W-DC — the old rule needed the letters glued on
//              n.nKW               35  N7K-AC-6.0KW, NXK-HV6.3KW20A-A, 2KWAC
//              PUV, -nnnnW, ^RPS#  11  N9K-PUV-1200W, WS-CDC-2500W, RPS2300-750BDL
//   fan        NXASFAN, BLWR        8  the old rule needed a hyphen before the S of SFAN
//   module     ^SPA- / SIP-#        26  shared port adapters and the SPA interface processor
//              ^VS-F6K / -DFC#     14  the VS- twins of the WS-F6K PFC/MSFC cards; DFC 4-packs
//              ^WS-SVC-             8  Catalyst 6500 service modules
//
// NOT FIXED HERE: 30-odd CSP-* parts (CPUs, SSDs, Intel NICs "for UCS Servers") are SERVER components
// filed in `switches`. The CPU and SD markers give some of them a truer kind, but the defect is their
// category, which is a row-membership decision held for the operator.
const RULES: { kind: SwitchKind; re: RegExp }[] = [
  // THE CABLE SPLIT, 11 Sep 2026 (reviewer §1.2; see SW_CABLE). These run first of all, for the reason the
  // cable rule below always has: a Swiss cord ends in "-SW" and must not reach the software rule.
  //   Cable-MANAGEMENT kits and stack blanks carry a CAB/STACK token and are not cables.
  { kind: "accessory", re: /-CAB-TOP(?:-|=|$)|^N77-C77\d{2}-CAB(?:-|=|$)|^CAB-GUIDE|^STACK-T\d+A?-BLANK/ },
  //   Stack cables: STACK-T1-3M, STACK-CAB-50CM, CAB-STACK-1M-NH, CAB-STK-E-0.5M ("FlexStack stacking cable").
  { kind: "stack-cable", re: /^(?:CAB-)?STACK-|^CAB-STK-/ },
  //   Stack modules and kits: C2960X-STACK, C3650-STACK-KIT, C9300L-STACK-A, C2960X-HYBRID-STK.
  { kind: "stack-module", re: /-STACK(?:-|=|$)|-STK(?:-|=|$)/ },
  //   Power cords, AC and DC: every CAB- that is not a console, fibre, CX4, RPS, StackPower/XPS, InfiniBand
  //   or category cable — read by name, including the 17 whose name never says "power" (CAB-7KACE=,
  //   CAB-C2316-C19-IT "CEI 23-16 to IEC-C19 14ft, Italy") — plus PWR-CAB- and the Nexus 7000 DC cables.
  //   USB is excluded after the census read CAB-USBA-USBB "Console Cable 7ft with USBA and USBB" as a cord.
  { kind: "power-cord", re: /^CAB-(?!CON|USB|SFP|SM-|INF-|RPS|GUIDE|SPWR|XPS|MCP|04X|STK|STACK|CAT)|^PWR-CAB-|-DC-CAB(?:-|=|$)/ },
  // CABLE FIRST since 11 Sep 2026 (reviewer §0.6): four Swiss power cords — CAB-TA-SW, CAB-9K16A-SW,
  // CAB-3KX-AC-SW, CAB-AC-16A-SG-SW — end in "-SW", the COUNTRY, and the software rule below read it as
  // software. CB-LC-LC-SMF (a patch cord) and CSS5-CABSX-LC= (a fibre cable) were `module` until the
  // same day: their "-LC" reads as the line-card marker. The stack alternatives moved to the rules above.
  { kind: "cable", re: /(?:^|-)(?:CAB|CBL)(?:-|=|$)|^CB-|(?:^|-)CAB[A-Z]{1,3}-|^CAT(?:5E|6A?)$/ },
  // N5KUK9-503N1.1, NXOS-703I7.6 — an operating-system image sold under a switch family PID.
  // N9K-C9400-SW-GX2A is excluded: "Cisco N9400 switch card", a line card whose "-SW-" is not software.
  { kind: "software", re: /^(?!N9K-C9400-SW-)(?:.*?(?:^|-)(?:NXOS|SW|IOS)(?:-|$)|.*UK9(?:-|=|$))/ },
  // FAN, FAN1, FANTRAY, and Nexus's single-fan SFAN. 140 fan-evidence, 0 genuine device. NXASFAN
  // glues the NXA accessory prefix onto SFAN with no hyphen; BLWR is the RPS 2300's blower.
  { kind: "fan", re: /(?:^|-)(?:NXA)?S?FAN(?:TRAY)?\d*(?:-|=|$)|(?:^|-)BLWR(?:-|=|$)/ },
  // + 11 Sep 2026: N2K-QSFP-* / N2K-F10G-* are "N2K Uplink option" SETS OF TRANSCEIVERS for a fabric
  // extender, not extenders; CSP-MR-* are server DIMMs; SD-X45-2GB-E= is an SD card the SD marker missed.
  {
    kind: "accessory",
    re: /(?:^|-)(?:BLNK|BLANK|BRKT|RCKMNT|MNT|KIT|ACC|CVR|TRAY|RAIL|REC|COVER)(?:-|=|\d|$)|(?:^|-)(?:MEM|SSD|CF|CPF|USB|RMK|RMB|RM|ACK|RACK|RACKMNT|DINRAIL|CBLE|PCM|CPU|CLK|BMP|DINCLP|RPNL|XBLNK|AFLT|BKT)(?:-|=|$)|[A-Z0-9]KIT(?:-|=|$)|FILTER(?:-|=|$)|(?:^|-)M?SD-(?:IE-|X\d+-)?\d+G|^FQ(?:9N|MAP)|BLNKCVR(?:-|=|$)|^N2K-(?:QSFP|F\d)|^CSP-MR-/,
  },
  // PAC 66/83 psu, PHV 17/17, PDC 26/27, CAC 8/10, and a bare wattage token 111/135. Widened: the
  // AC/DC letters may follow a hyphen, kilowatts, the PUV universal supply, a trailing wattage, RPS.
  { kind: "power", re: /(?:^|-)(?:PWR|PAC|PHV|PDC|PSU|CAC|DCPWR|ACPWR|PUV)(?:-|=|\d|$)|-\d+W-?(?:AC|DC)|\d(?:\.\d)?KW|-\d{3,4}W(?:-|=|$)|^RPS\d|^XPS-\d/ },
  // FABRIC EXTENDERS — 11 Sep 2026, reviewer §1.4, measured: 166 N2K-* / N2### parts sat in `switch`
  // and were asked a MAC table, a VLAN maximum, a layer, stacking, DRAM and flash — none of which a FEX
  // has: it switches nothing, its parent does. Every one of the 166 was read; all are extenders or
  // extender packs ("Reversed airflow pack: N2K-C2232PP-10GE, 2AC PS, 1Fan") except the uplink-option
  // transceiver sets, which the accessory rule above already took. After fan and power, so a FEX's own
  // PSU (N2K-PAC-400W) and fan stay what they are. N5548UPM-4FEX ("Nexus 5548UP ... 4 x FEX") is a
  // bundle led by a 5548 SWITCH and does not start with N2, so it stays `switch`.
  { kind: "fex", re: /^N2K-(?:C2|B22|UCS22)|^N2\d{3}[A-Z]*(?:-|=|$)/ },
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
  //   C9400-SSD             4 parts    3 / 0               supervisor M.2 storage — REMOVED 11 Sep
  //                                                        2026: storage is an accessory; a module is
  //                                                        asked ports and switching capacity
  //   WS-S32                2 parts    2 / 0               Sup32
  //   C6880-X-LE-           3 parts    1 / 0               6880-X port cards
  //
  // TWO FAMILIES THE REVIEW NAMED HAVE ZERO PARTS IN THIS CATEGORY and are deliberately absent:
  // `N9K-X####` (Nexus 9500 line cards) and `N9K-SC-` (system controllers) both return 0 — they
  // live under `data-center-networking`. A rule for a population that does not exist is a rule
  // nobody has seen work, and productClass.test.ts's reachability check exists for that reason.
  //
  // SPLIT 11 Sep 2026 into four kinds (see SW_PART). The three named ones run FIRST, because the
  // port-bearing markers are broader: WS-X45-SUP7-E carries both "-X4" (a line-card marker) and
  // "SUP7" (a supervisor), and it is a supervisor.
  // Supervisors: the SUP token, and the three families whose PID has none.
  { kind: "supervisor", re: /(?:^|-)SUP(?:-|=|\d|$)|^VS-S(?:720|2T)|^WS-S\d/ },
  // Fabric modules. N35- is excluded: N35-FM-48X is "Nexus 3550-F Programmable Multiplexer Switch",
  // the one genuine miss the header has recorded since 10 Sep — as a fabric module it would be
  // asked for a per-slot bandwidth, and it is a whole switch. It falls through to `switch`.
  { kind: "fabric", re: /^(?!N35-).*-(?:FM|FAB)(?:-|=|\d|$)/ },
  // Daughter cards: 6500 PFC / DFC / CFC / MSFC boards, and the DFC 4-packs.
  { kind: "daughter", re: /^(?:WS|VS)-F6(?:K|700)|(?:^|-)DFC\d/ },
  // LINE CARDS — split from `module` on 11 Sep 2026 (reviewer §1.5). A card that takes a CHASSIS SLOT
  // has a fabric connection and its own power draw; an uplink or expansion module for a fixed switch
  // (C9300-NM-8X, N9K-M6PQ "Uplink Module for Nexus 9300") and a port adapter have neither. N7K/N77 M
  // and F cards, WS-X / N9K-X / ME-X / NXM-X cards, -LC- cards, 6800/6880 port cards, 7600 ES cards,
  // WS-SVC service modules, SPA interface processors, and the N9400 switch card.
  {
    kind: "linecard",
    re: /^N9K-C9400-SW-|^N7K-[MF]\d|^N77-[MF]\d|-X\d|-LC(?:-|=|$)|^C6800-.*P10G|^7600-ES|^C6880-X-LE-|^WS-SVC-|(?:^|-)SIP-\d/,
  },
  // Everything left that plugs in and carries PORTS without a chassis slot of its own: uplink and
  // network modules for fixed switches, Nexus 5500/5600 expansion modules, IE expansion modules,
  // shared port adapters.
  {
    kind: "module",
    re: /(?:^|-)N\d+K-[MF]\d|^IEM-|-NM(?:-|=|$)|^N5[56]-M\d|^SPA-/,
  },
];

export function switchKind(sku: string): SwitchKind {
  const s = String(sku ?? "").toUpperCase();
  if (s === "") return "switch";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "switch";
}
