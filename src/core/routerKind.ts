// src/core/routerKind.ts — what KIND of thing a Cisco `routers`-category part is (12 Sep 2026, reviewer §6.2).
//
// THE DEFECT. `routers` was shaped by the shared componentKind axis, which names power, fan, cable, accessory and
// software and calls everything else `device`. Measured over the 6,460 Cisco hardware parts: device 5,571 — and
// 2,600 of those are line cards, interface modules, route processors, fabric cards, DIMMs, SSDs, antennas and
// optics, every one asked a router's questions (a forwarding throughput of a DIMM, a rack height of an antenna).
//
// WHY A MARKER IN ANY SEGMENT, DEFAULTING TO `router` — switchKind's design, for switchKind's reason, re-measured
// here (evidence/routers-kind-survey.md). The device prefixes do not separate routers from components: every
// device family carries its own parts. ISR4xxx 74 parts 21 part-evidence / 0 device (the 21 are config strings
// and upgrade bundles); C8xxx 123 parts 66/46 (C8300-FAN-2R-R=, C8200-RM-23, C8500-FILTER-ASSY); ASR100x 165
// parts 73/35 (ASR1001-X-PWR-DC, ASR1002HX-FAN=). So there is NO device rule. Components are the nameable
// minority and are named; everything else is `router`. A component left as a router carries gaps; a router
// called a component would have its real questions CLOSED — so the default fails in the safe direction.
//
// EVERY RULE WAS MEASURED BY NAME before it was kept: part-evidence (module/card/adapter/processor/power supply/
// fan/memory/cable/kit/bracket/blank/cover...) against device-evidence (router/chassis/platform/system/gateway).
// The device-only hits of each rule were all read; they are false alarms of the device test ("Fabric Chassis
// ... Cosmetic Kit", "NCS 5500 fabric-chassis PCM", "Service Edge Optimized LC"). Counts in tests/routerKind.test.ts.
//
// NO CHASSIS KIND. "Chassis" in a name does not separate a modular chassis from a fixed box: C8200-1N-4T=
// "Catalyst Edge C8200-1N-4T Chassis Spare" and NCS-55A1-24H "NCS55A1 Fixed 24x100G chassis" are fixed; `-SYS`
// also ends the fixed N540-12Z20G-SYS; `LCC` is CRS-only. With no SKU marker, a chassis stays `router` and is
// asked the system figures Cisco prints for it ("Max throughput (with 800G LC)") — the switches trade-off.
//
// NOT A KIND QUESTION, recorded so nobody solves it here: datasheet cells enumerated as parts (MCS0-MCS31,
// CAT3..CAT18, G.711, V.35, RS-232) and Catalyst 6500 switch bundles filed in routers are ROW-MEMBERSHIP
// questions — listed in runs/reports/schema-routers-2026-09-12.md as proposals, never rules.
//
// TOKEN EDGES are explicit lookarounds over the upper-cased SKU — (?<![A-Z0-9]) before, (?![A-Z0-9]) or (?![A-Z])
// after. No word-boundary escape: Cisco tokens are not word-shaped (A9K-4T16GE, 1X100GE, 2XSFP).

export type RouterKind =
  | "router" | "linecard" | "module" | "processor" | "fabric" | "power" | "fan" | "memory" | "flash" | "drive"
  | "power-cord" | "cable" | "antenna" | "transceiver" | "accessory";

/** The whole device — the only kind a routing specification belongs to. */
export const RT_DEVICE: readonly RouterKind[] = ["router"];
/** Kinds that carry their own ports: a line card in a chassis slot, an interface module or port adapter. */
export const RT_PORTED: readonly RouterKind[] = ["linecard", "module"];
/** Kinds that plug into or attach to a router — every one is bought for WHAT IT FITS (product_compatibility). */
export const RT_COMPONENT: readonly RouterKind[] =
  ["linecard", "module", "processor", "fabric", "power", "fan", "memory", "flash", "drive", "power-cord", "cable",
   "antenna", "transceiver", "accessory"];
/** Kinds that are a length of cable — asked their length. */
export const RT_CABLE: readonly RouterKind[] = ["power-cord", "cable"];
/** Every kind the axis can name, in the order the ledger lists them. */
export const RT_KINDS: readonly RouterKind[] = [...RT_DEVICE, ...RT_COMPONENT];

// Ordered; the FIRST rule that matches wins. The order is load-bearing:
//   cable-management accessory first — CRS-B2B-BCK-CM and 8404-CBLMGMT carry a CAB/CBL token and are not cables.
//   power-cord before cable      — every cord is a cable token; a cord is asked its plug too (optional).
//   fan before power             — N560-4-PWR-FAN= "NCS 560-4 Power High Speed Fan Tray" is a fan.
//   accessory before power, processor, linecard, drive — C8300-PS-BLANK1R "PSU Blank", CRS-16-RP-BLANK,
//                                  A9K-LC-FILR "Line Card Slot Filler", ENCS-DISK-COVER are covers.
//   linecard after power, fan, accessory, processor — `^NC5[57]-` means "whatever NC55/NC57 is left".
//   module last                  — its markers are the least specific; NIM-SSD is a drive first, WIM-BLANK= a cover.
export const RULES: { id: string; kind: RouterKind; re: RegExp }[] = [
  { id: "accessory-cable-mgmt", kind: "accessory",
    re: /CAB-MGMT|CBLMGMT|CBLMFMT|CABLETRAY|(?<![A-Z0-9])(?:FRONT|FRNT|REAR|BCK)-CM(?![A-Z0-9])|-CM-RETRO|-LCC-FRNT-E|^CAB-GUIDE|(?:CAB|CBL)-(?:BRKT|BRACKET|GUIDE)/ },
  // AC and DC power cords by plug or country. RE-RUN 12 Sep 2026 (the survey computed this correction by
  // subtraction): `^CAB-L\d` was dropped — CAB-L240-15-Q-N "Low Loss LMR 240 Cable with QMA - N Connectors" is an
  // antenna coax — and `US` is fenced so CAB-USB-UB (a USB cable) is not a cord. Reading the re-run `cable`
  // bucket found nine more cords by name, added as their plug / supply shapes: CAB-C7-ACB "AC Power Cord (Brazil),
  // C7", CAB-3P-JPN "3 Prong Plug", CAB-48DC-40A-8AWG "-48VDC PSU Power Cord", CAB-SERVICE-3P, A920-PC-CAB-DC-3M
  // "Power Cord - DC", PWR-2KW-DC-CBL "2000W DC Power Cable", 15454-M-CBL-L-JPN "AC power cable - Japan".
  { id: "power-cord", kind: "power-cord",
    re: /^CAB-(?:AC|IND|250V|C1[3-9]|C2\d|C7|3P|48DC|SERVICE-3P|TA-|9K|7K|3K|6K|US(?![A-Z])|UK|EU|JP|CN|KOR|SJ|AUS|ARG|BRAZ|ITA|SWI|DC|PWR|N5K|CE)|-AC-CAB-|-CAB-DC-|-DC-CBL(?:=|$)|^15454-M-CBL-[LR]-|(?<![A-Z0-9])AC(?:Y|-DEL|-WYE)-CAB|^PWR-CAB-|POWER-CORD|PWR-?CORD/ },
  { id: "cable", kind: "cable", re: /(?<![A-Z0-9])(?:CAB|CBL|CABLE)(?![A-Z])|^CABLE|^LCC\/[MD]-FC-FBR|(?<![A-Z0-9])FBR(?![A-Z])/ },
  // 2911-FANFLTR-NEBS "Fan Filter for NEBS environment" is a filter, an accessory. What refuses it is the trailing
  // token edge (?![A-Z0-9]) — NOT a (?!FLTR) lookahead, which the survey's draft carried and file-level sabotage
  // proved dead: deleting it changed no kind anywhere (12 Sep 2026). Removed rather than kept as decoration.
  { id: "fan", kind: "fan",
    re: /(?<![A-Z0-9])S?FAN(?:TRAY|ASSY|BLWR)?\d*(?![A-Z0-9])|FANTRAY|FANASSY|FANBLWR|(?<![A-Z0-9])(?:FNTR|FN)(?![A-Z0-9])|(?<![A-Z0-9])F-CT(?![A-Z0-9])|(?<![A-Z0-9])BLWR(?![A-Z0-9])|^8608-FS(?![A-Z0-9])/ },
  // + ANTENNASBF3O (the token runs on), LTE-ADPT-SM-TF "Cisco LTE SMA Antenna", LTE-AE-MAG-SMA "Magnetic Antenna
  // Extension Base" — all three found by the reverse control on the default bucket (12 Sep 2026).
  { id: "antenna", kind: "antenna", re: /^ANT-|(?<![A-Z0-9])(?:ANT|ANTM|ANTENNA)(?![A-Z])|^ANTENNA|(?<![A-Z0-9])ACC-OUT-LA|^[34]G-AE0\d\d|^CGR-LA-|^LTE-(?:ADPT|AE)-/ },
  // Optics filed in routers (ONS-SE-Z1 "1000BASE-LX ... transceiver"). Their category is the defect — a proposal
  // in the report; the kind only stops them being asked a router's questions meanwhile.
  { id: "transceiver", kind: "transceiver", re: /^(?:ONS-(?:SE|SI|SC|XC)|SFP-|GLC-|XFP-|QSFP-|CFP-|CPAK-|DWDM-|CWDM-|SFP\d)/ },
  // (?<!AC|DC)KIT: CRS-16-ACKIT-M "CRS Modular AC Power Kit" is a power kit, not an accessory kit.
  // -ACS only at the END: LS-RV-ACS-25-1YR= "RV Router Anyconnect Server" is a licence, not an accessory.
  { id: "accessory", kind: "accessory",
    re: /(?<![A-Z0-9])(?:BLANK\d*R?|BLNK|BLXANK\w*|COVER|CVR|FILR|FILLER|IMPEDANCE|HANDLE|HNDL|DCAP|DOORS?|DRS|DR-(?:FRNT|REAR)|DRKT|GRILLE?|GRL|LIFT|RAILS?|FILTER|FLTR|FANFLTR|FTF|\dXFILTER|AFLT|PLNMFLTR|PLENUM|SCREEN|AIRDEF(?:-\w+)?|TROUGH|DRILLTEMP|FLOORTEMP|PANEL|PNL|LABELS?|BRKT|BRACKET|RMBRKT|RCKMNT|RCKMT|RMT|RMK|RM|WM|WALLMT|MNT|PMK\d*|DINRAIL|ACC|ACSR|ACCKIT\d*R?|INSTKT|INSTKIT|INSTALL|RFID|IP67GLAND|GLAND|PILLBLK|PKG|WWA|4PT\d*R?|CRFT|LOAD)(?![A-Z0-9])|^ACS-|-ACS(?:=|$)|^NAL-|^RCKMT-|^CRS-INT-IM|(?<!AC|DC)KIT\d*(?![A-Z0-9])|-TRAY(?![A-Z0-9])|-BR-CM|^A1K-\dRU-REAR|-BCK-BF|^CRS-\d+-(?:\d+G|B)-UPG(?![A-Z0-9-])|^CRS-[A-Z0-9-]*(?:CONV|CVN)|^CRS-\d+-ALARM-|^CRS-FCC-LED/ },
  // ^ the four CRS shapes at the end came from the reverse control: "16 Slot Upgrade Kit 140G" (7), "Conversion Kit
  // for Multichassis-140G" (6), "Modular Power Alarm" / "Alarm Board" (4), "Fabric Card Chassis Fiber Module LED".
  // NOT the upgrade BUNDLES (CRS-3-UPGRADE-BUN, CRS-4-CH-UPG-BUN "4 slots to 8 slot chassis upgrade bundle"): a
  // bundle can ship a chassis, and a chassis must not have its questions closed.
  // PM only as a whole segment: ISR4321-PM20 "ISR4321 Promitional Bundle" is a router (PM20 is a promotion).
  // A wattage needs a lookbehind: RV160W "Cisco RV160W" is wireless. -AC/-DC alone is NOT power: ASR-9006-AC=
  // "ASR-9006 AC Chassis" and ASR-920-12SZ-A are routers.
  { id: "power", kind: "power",
    re: /(?<![A-Z0-9])(?:PWR|PSU|PEM|PAC|PDC|PHV|PSH|PWRSH|PWRTRAY|PDU|ACKIT|DCKIT|PCM|PWRINJ|PWRJCK)\d*(?![A-Z])|(?<![A-Z0-9])POE-(?:\d|SPL)(?![A-Z0-9])|\dVPWR|(?<![A-Z0-9])PM(?![A-Z0-9])|^PS-SWITCH|^RPS-ADPTR|(?<![A-Z0-9])\d+W-?(?:AC|DC|HV)|(?<![A-Z0-9.])\d{3,4}W(?![A-Z0-9])|\d(?:\.\d)?KW|-(?:AC|DC)-PEM/ },
  // FLASH MEDIA ARE NOT DIMMs (12 Sep 2026). The memory bucket held both: 68 parts carry a `dram` fact and 19 a
  // `flash` fact, so one capacity cup would be the wrong cup for one of them. The SKU separates them cleanly — 36
  // parts: MEM-CF- (CompactFlash), MEM-FLASH- / MEM-FLSH- (bootflash upgrades), MEM-SD- (SD cards, incl. the
  // IOS-preloaded MEM-SD-CGR-IOS=), and the VG224/IAD2430 suffix F against D: MEM-243-1X128F "128MB Flash Memory"
  // beside MEM-243-1X128D-U, a DIMM. A flash part is asked `flash`, a DIMM `dram`, a drive `storage_capacity`.
  { id: "flash", kind: "flash", re: /^MEM-(?:CF|FLASH|FLSH|SD)-|^MEM-\d+-\d+X\d+F(?![A-Z0-9])/ },
  // (?!USB) on MEM-: MEM-USB is a drive-class stick. (?!CISCO\d): the one device-only hit of this rule, CISCO892-
  // DRAM-K9 "Router Bundle - C892, WAASX Feature License, Max Mem", is a ROUTER configured with maximum memory — a
  // CISCO<model> PID names the router itself, and Cisco sells memory as MEM-* / M-*. The fence sits on this rule
  // only: CISCO5940-RTM "Rear Transition Module" is correctly a module.
  { id: "memory", kind: "memory",
    re: /^(?!CISCO\d)(?:MEM-(?!USB)|.*(?<![A-Z0-9])(?:MEM|DIMM|MEMORY|DRAM)(?![A-Z])|M-ASR\w*-(?:RP\d*-)?\d+GB?(?![A-Z0-9])|.*(?<![A-Z0-9])\d+U\d+(?:GB|MB|D)(?![A-Z0-9])|(?:XRV|UCS)-MR-)/ },
  // Bare HD / DISK are refused: NC55-900W-DCFW-HD is a power supply, DISK-MODE-RAID-5 a configuration option.
  { id: "drive", kind: "drive",
    re: /^SSD-|^HDD-|^M2USB-|^MEMUSB|EUSB|(?<![A-Z0-9])(?:SSD|HDD|HRDDSK|FLASHDISK|FDISK)\d*(?![A-Z])|(?<![A-Z0-9])(?:HD|FD|M2|SATA|MSATA|DISK|SAS|SED)-\d+[GT]|(?<![A-Z0-9])SD\d+G|-\d+GB-M2(?![A-Z0-9])/ },
  // Route processors, route-switch processors, forwarding engines (ESP), ISR G2 performance engines (SPE),
  // NCS 5500 system controllers, CPU boards.
  { id: "processor", kind: "processor",
    re: /(?<![A-Z0-9])\d?(?:RP|RSP|ESP|SPE|PRP|DRP)(?:\d+[A-Z]?)?(?![A-Z])|^NC55-SC(?![A-Z0-9])|^CRS-FCC-SC-|^NCS-F-SCSW|(?<![A-Z0-9])CPU(?![A-Z])/ },
  // Fabric and switch cards. Bare FC is refused: ASR-9901-FC is a "Flexible Consumption" chassis, 8010-FC-SW a
  // software ATO, A99-32HG-FC a flexible-consumption LINE CARD; CRS-FC24 / CRS-FCC are fabric CHASSIS.
  { id: "fabric", kind: "fabric", re: /(?<![A-Z0-9])SFC\d*(?![A-Z])|^CRS-\d+-FC\d*(?![A-Z0-9])|^NC6-FC|^NCS-F-FC|^88\d{2}-FC\d*(?![A-Z0-9])|^8608-SC\d/ },
  // Line cards that take a chassis slot: ASR 9000, NCS 5500/5700/6000, CRS MSC/FP/LSP, 8000-series LCs, ASR 1000
  // SIP/MIP carriers and the port-expansion cards (A9903-20HG-PEC).
  { id: "linecard", kind: "linecard",
    re: /^A9[K9]-(?:\d|MOD\d|SIP-|ISM-|VSM-)|^NC5[57]-(?!MPA)|^NC-5[57]-|^NC6-\d|^CRS-(?:X-)?(?:MSC|FP|LSP|CGSE)|(?<![A-Z0-9])SIP-\d|^CGSE-|^CRS-100GE-|^\d+X\d+G-LSP|^100GE-(?:DWDM|FP)|^ASR1000-(?:SIP|MIP)\d*|^ASR1000-\d+(?:X|T)|^88-LC|^8800-LC|(?<![A-Z0-9])PEC(?![A-Z])/ },
  // Interface modules and port adapters for a fixed router or a carrier: NIM, SM-X, ISM, HWIC/EHWIC/VWIC, PVDM,
  // SPA/EPA, MPA, PLIM, A900 IMs, UCS-E, pluggable LTE/5G, and CRS digit-led PLIMs (1-100GE-DWDM/C, 14X10GBE-PK).
  // Single letters are refused: ASR-920-24SZ-M "Modular PSU", ASR-920-24SZ-IM "Modular PSU and IM" are routers.
  { id: "module", kind: "module",
    re: /^(?:NIM|SM-X|SM|ISM|HWIC|EHWIC|VWIC\d?|VIC\d?|WIC|WIM|GRWIC|CGM|IRM|IRMH|WP|EPA|SPA|NM|EVM|NME|EM\d?|AIM|PIM|C-NIM|C-NM|C-SM|IRM-NIM)-|^A9\d\d-(?:IMA|CM-)|^N5[46]0-IMA|^NCS4200-\d|^UCS-E\d|^PVDM\d?(?:-|=|$)|(?<![A-Z0-9])(?:MPA|PLIM|OIM|RTM|IPSECHW|MRAID)(?![A-Z])|^P-(?:LTE|5G)|^\d+X\d+G(?:B?E)|^\d+OC\d+|^\d+-\d+G(?:B?E)(?![A-Z0-9])/ },
];

export function routerKind(sku: string): RouterKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "router";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "router";
}

/** Which rule decided — for the distribution census and the tests. */
export function routerKindRule(sku: string): string {
  const s = String(sku ?? "").trim().toUpperCase();
  for (const r of RULES) if (r.re.test(s)) return r.id;
  return "default";
}
