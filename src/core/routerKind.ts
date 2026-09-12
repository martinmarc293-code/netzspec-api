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
  | "enterprise" | "sp-core" | "chassis"
  | "linecard" | "module" | "processor" | "forwarding" | "fabric" | "power" | "fan" | "memory" | "flash" | "drive"
  | "power-cord" | "cable" | "antenna" | "transceiver" | "accessory";

/** Every whole device: the kinds a routing specification belongs to. */
export const RT_DEVICE: readonly RouterKind[] = ["enterprise", "sp-core", "chassis"];
/** The devices that carry FIXED PORTS OF THEIR OWN. A modular chassis is sold empty — its ports
 *  arrive on the line cards — so it is out, and the store agrees: 0 of the 150 chassis parts hold
 *  a `ports` fact, against 48 on the other two. Same reasoning for the CPU-side cups below. */
export const RT_DEVICE_PORTED: readonly RouterKind[] = ["enterprise", "sp-core"];
/** THE BRANCH-ROUTER CUPS. Measured 12 Sep 2026 and this is the whole basis of the split: every
 *  single stored `ipsec_throughput` (6), `ipsec_tunnels` (9), `nat_sessions` (9) and `acl_entries`
 *  (9) fact on a device part is a C1100 / C8200 / C8500L / C8xxx-G2, and every sample SKU behind
 *  the labels that fill them is a C1xxx, C8xxx or ISR 4xxx. Not one is an ASR 9000, NCS, CRS or
 *  8000-series box: a service-provider sheet does not publish a VPN or NAT figure at all. */
export const RT_BRANCH: readonly RouterKind[] = ["enterprise"];
/** Kinds that carry their own ports: a line card in a chassis slot, an interface module or port adapter. */
export const RT_PORTED: readonly RouterKind[] = ["linecard", "module"];
/** Kinds that plug into or attach to a router — every one is bought for WHAT IT FITS (product_compatibility). */
export const RT_COMPONENT: readonly RouterKind[] =
  ["linecard", "module", "processor", "forwarding", "fabric", "power", "fan", "memory", "flash", "drive",
   "power-cord", "cable", "antenna", "transceiver", "accessory"];
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
  // round-7 addendum D (12 Sep 2026) — AN NCS 540 `-SYS` IS A WHOLE ROUTER, AHEAD OF EVERY COMPONENT TOKEN.
  // N540-ACC-SYS and N540X-ACC-SYS ("NCS540 24x1/10G SFP+, 8x1/10/25G SFP+/SFP28, 2x100G QSFP28") are full
  // access routers. Their `ACC` segment hit the accessory rule, and `accessory` is a fallback kind, so the NAME
  // marker then read the cage tokens and filed both as transceivers asked one cup. First, so no component token
  // can reach an N540 system.
  // SCOPED TO N540, NOT TO `-SYS`. The operator's wording was "-SYS -> sp-core ahead of cage tokens"; measured,
  // routers holds 29 live `-SYS` rows and 7 of them are line-card CHASSIS (8608/8804/8808/8812/8818-SYS,
  // ASR-9006/9010-SYS) that a bare `-SYS` rule would turn into sp-core. Scoped, it changes 0 of the 27 N540 parts
  // already in routers (all sp-core by `sp-ncs`) and 0 rows anywhere else in the category.
  { id: "sp-n540-system", kind: "sp-core", re: /^N540X?-(?:[A-Z0-9]+-)*SYS(?:-[A-Z])?=?$/ },
  { id: "accessory-cable-mgmt", kind: "accessory",
    re: /CAB-MGMT|CBLMGMT|CBLMFMT|CABLETRAY|(?<![A-Z0-9])(?:FRONT|FRNT|REAR|BCK)-CM(?![A-Z0-9])|-CM-RETRO|-LCC-FRNT-E|^CAB-GUIDE|(?:CAB|CBL)-(?:BRKT|BRACKET|GUIDE)/ },
  // routers-r5 (12 Sep 2026) — SEVEN MISSES FOUND BY READING THE 423 PARTS THE DEVICE SUB-KIND
  // RULES CLAIMED. Every one is a real Cisco part whose NAME says accessory and whose SKU carries a
  // token the accessory rule spells differently; each would otherwise have been asked a whole
  // router's or a chassis's question set. Listed with the name that decided it, and pinned as
  // positives in tests/routerKind.test.ts:
  //   FLT       NCS-5002-FLT-BK / NCS-5011-FLT-FR ...   "Air Filter" — the rule had FILTER and
  //             FLTR but not FLT (10 parts)
  //   BKT       CRS-8-LCC-FR-BKT=                       "Front Door Brkt" — the rule had BRKT (1)
  //   BDGPNL    CRS-16-FUJBDGPNL= / CRS-8- / CRS-FCC-   "Fujitsu Bezel Panel" — PNL is inside a
  //             longer token, so the whole-segment PNL rule could not see it (3)
  //   BEZEL     ENCS54-BEZEL=                           "ENCS 5400 Series Front Bezel" (1)
  //   KP-REAR   CRS-16-KP-REAR(=)                       "CRS 16 Rear Kick-Panel" (2)
  //   F2B-AIR   N560-4-F2B-AIR-U / -V (=)               "Front to Back Airflow Plenum" (4)
  //   NCS-PP-   NCS-PP-100X10-LR / -SR (=)              "Break-out Panel" / "Patch Panel" (4)
  //   BAFFL     ASR1013-ESP-BAFFL(=)                    "ESP Expansion Slot Filler Plate" — it
  //             carries an ESP token and was a `processor` (2)
  { id: "accessory-panel-filter", kind: "accessory",
    // BDGPNL carries NO leading lookbehind, and that is measured rather than sloppy: the SKU is
    // `CRS-16-FUJBDGPNL=` — the vendor prefix runs straight into the token, which is exactly why
    // the whole-segment `PNL` rule could not see it. A trailing edge is enough to keep it tight.
    re: /(?<![A-Z0-9])(?:FLT|BKT|BEZEL|BAFFL)(?![A-Z0-9])|BDGPNL(?![A-Z0-9])|(?<![A-Z0-9])KP-REAR|(?<![A-Z0-9])F2B-AIR|^NCS-PP-/ },
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
  // THE ESP SPLIT (routers-r5, 12 Sep 2026, reviewer §6 item 3). `ESP` used to sit in the processor
  // token list, so the 23 ASR 1000 Embedded Services Processors were asked a route processor's cups:
  // `dram`, `flash` and `product_compatibility`. An ESP is the FORWARDING engine — the RP holds the
  // control plane and its memory — and the store says so exactly: 27 `dram` and 4 `flash` facts sit
  // on RP / RSP / SPE parts and **ZERO of any kind sit on any ESP**, so 46 required slots existed
  // that nothing could ever close. The one figure an ESP is bought on is its forwarding throughput,
  // and Cisco states it in the part's own name ("Embedded Services Processor, 100 Gb").
  //
  // SCOPED TO THE FAMILY-GENERIC PREFIX, which is the CISCO892-DRAM-K9 fence again: `ASR1000-` names
  // the ASR 1000 FAMILY and the part is the processor, while `ASR1002-ESP5` names a chassis MODEL
  // and the part is "ASR1002 w/ ESP-5G, no IOS" — a router configured with an ESP, which must keep
  // a router's questions. Removing ESP from the processor rule is what lets it fall through to the
  // device rules and be read as the enterprise router it is; both directions are pinned.
  { id: "forwarding", kind: "forwarding", re: /^ASR1000-ESP\d/ },
  // Route processors, route-switch processors, ISR G2 performance engines (SPE), NCS 5500 and NCS
  // fabric-chassis system/shelf controllers, CPU boards.
  { id: "processor", kind: "processor",
    re: /(?<![A-Z0-9])\d?(?:RP|RSP|SPE|PRP|DRP)(?:\d+[A-Z]?)?(?![A-Z])|^NC55-SC(?![A-Z0-9])|^CRS-FCC-SC-|^NCS-F-SC|(?<![A-Z0-9])CPU(?![A-Z])/ },
  // Fabric and switch cards. Bare FC is refused: ASR-9901-FC is a "Flexible Consumption" chassis, 8010-FC-SW a
  // software ATO, A99-32HG-FC a flexible-consumption LINE CARD; CRS-FC24 / CRS-FCC are fabric CHASSIS.
  { id: "fabric", kind: "fabric", re: /(?<![A-Z0-9])SFC\d*(?![A-Z])|^CRS-\d+-FC\d*(?![A-Z0-9])|^NC6-FC|^NCS-F-FC|^88\d{2}-FC\d*(?![A-Z0-9])|^8608-SC\d/ },
  // Line cards that take a chassis slot: ASR 9000, NCS 5500/5700/6000, CRS MSC/FP/LSP, 8000-series LCs, ASR 1000
  // SIP/MIP carriers and the port-expansion cards (A9903-20HG-PEC).
  { id: "linecard", kind: "linecard",
    re: /^A9[K9]-(?:\d|MOD\d|SIP-|ISM-|VSM-)|^NC5[57]-(?!MPA)|^NC-5[57]-|^NC6-\d|^CRS-(?:X-)?(?:MSC|FP|LSP|CGSE)|(?<![A-Z0-9])SIP-\d|^CRS-SIP(?:=|$)|^CGSE-|^CRS-100GE-|^\d+X\d+G-LSP|^100GE-(?:DWDM|FP)|^ASR1000-(?:SIP|MIP)\d*|^ASR1000-\d+(?:X|T)|^88-LC|^8800-LC|(?<![A-Z0-9])PEC(?![A-Z])/ },
  // ^ routers-r5 added `^CRS-SIP(?:=|$)`: the existing `SIP-\d` needs a digit after the dash, and
  // `CRS-SIP` / `CRS-SIP=` ("Carrier Routing System SPA Interface Processor Card") have none, so
  // two line cards were reaching the device rules and being read as carrier ROUTERS.
  // Interface modules and port adapters for a fixed router or a carrier: NIM, SM-X, ISM, HWIC/EHWIC/VWIC, PVDM,
  // SPA/EPA, MPA, PLIM, A900 IMs, UCS-E, pluggable LTE/5G, and CRS digit-led PLIMs (1-100GE-DWDM/C, 14X10GBE-PK).
  // Single letters are refused: ASR-920-24SZ-M "Modular PSU", ASR-920-24SZ-IM "Modular PSU and IM" are routers.
  { id: "module", kind: "module",
    re: /^(?:NIM|SM-X|SM|ISM|HWIC|EHWIC|VWIC\d?|VIC\d?|WIC|WIM|GRWIC|CGM|IRM|IRMH|WP|EPA|SPA|NM|EVM|NME|EM\d?|AIM|PIM|C-NIM|C-NM|C-SM|IRM-NIM)-|^A9\d\d-(?:IMA|CM-)|^N5[46]0-IMA|^NCS4200-\d|^UCS-E\d|^PVDM\d?(?:-|=|$)|(?<![A-Z0-9])(?:MPA|PLIM|OIM|RTM|IPSECHW|MRAID)(?![A-Z])|^P-(?:LTE|5G)|^\d+X\d+G(?:B?E)|^\d+OC\d+|^\d+-\d+G(?:B?E)(?![A-Z0-9])/ },
];

// -------------------------------------------------------------------------------------------------
// routers-r5 (12 Sep 2026) — THE DEVICE SUB-KINDS. Reviewer §6 item 2: split the one `router` kind
// into enterprise / sp-core / chassis.
//
// These are consulted ONLY after every component rule above has declined, so they replace the old
// `return "router"` default and change no component's kind. The component axis, its 15 rules and its
// sabotage cases are untouched.
//
// WHY THE SPLIT IS REAL AND NOT A TAXONOMY. Three cup sets came apart under measurement:
//   branch      every stored ipsec_throughput / ipsec_tunnels / nat_sessions / acl_entries fact on a
//               device is a C1100, C8200, C8500L or C8xxx-G2, and every label that fills them lists
//               C1xxx / C8xxx / ISR4xxx sample SKUs. An SP sheet publishes none of them.
//   ports       48 of 48 device `ports` facts are on a fixed box; the 150 modular chassis hold zero,
//               because a chassis is sold empty and its ports arrive on line cards.
//   slots       all 64 device `module_slots` facts are on the chassis cohort (8808-SYS 8, 8818-SYS
//               18, NCS-5516 16, CRS-16/S 16) plus one uCPE. That cup is a chassis's whole point.
//
// WHY THE DEFAULT IS `enterprise`, THE KIND THAT ASKS THE MOST. Same argument as the component
// default above, one level in: an SP box wrongly left as enterprise carries gaps on two or three
// cups its sheet does not publish, where an enterprise router wrongly called sp-core has its NAT,
// VPN and WAN/LAN questions CLOSED. So every CLOSURE has to be earned by a named family, and the
// unnamed case fails towards asking.
//
// THE REVERSE CONTROL ON THE DEFAULT BUCKET, which is what licenses that choice: all 1,528 parts it
// keeps were probed for carrier wording, modular-chassis wording and component wording. Carrier: 6
// hits, of which 5 are licences (S-NC6-*, SPAOA-WAE-I) and the sixth is "Multi Carrier North
// America" — a cellular carrier, not a carrier-class router. Modular chassis: ZERO. Component: 6,
// five of them routers whose names merely mention a power supply or an EtherSwitch module, and one
// real miss (ENCS54-BEZEL=) which the accessory rule above now takes. No SP router and no chassis
// is hiding in the default.
//
// NO NAME TEST, AND "CHASSIS" IN THE NAME IS WORTHLESS — the round-2 finding, re-measured and
// confirmed: 188 of the 1,951 device names contain "chassis" and they include NCS-55A1-24H "Fixed
// 24x100G chassis", 8101-32FH-O "1 RU Chassis", ASR-9901 "Compact Chassis" and C8200-1N-4T=
// "Chassis Spare", every one a FIXED box. Cisco calls a sheet-metal box a chassis whether or not it
// takes line cards. So the chassis kind is an ENUMERATION of the modular families, each read
// against its own catalogue name, with the fixed lookalike of every family pinned as a refusal.
export const DEVICE_RULES: { id: string; kind: RouterKind; re: RegExp }[] = [
  // CRS: the line-card chassis (4/8/16-slot, single- dual- and multi-shelf) and the 24-slot fabric
  // chassis. `CRS-16-140G-UPG` and `CRS-8-LCC-FR-BKT=` are accessories and never reach here.
  { id: "chassis-crs", kind: "chassis",
    re: /^CRS3?-(?:4|8|16)(?:\/|-LCC|LCC|-MC|-B2B|-CH-)|^CRS3?-(?:FC24|FCC|EXPAND)|^CRS3-MC-FC24/ },
  // NCS 5500 / 6000 / 560 modular shelves and the NCS fabric chassis. The FIXED NCS boxes —
  // NCS-5501, NCS-5502, NCS-55A1-*, NCS-57*, N540-*-SYS — are deliberately NOT here.
  { id: "chassis-ncs", kind: "chassis",
    re: /^NCS-5(?:504|508|516)(?![0-9])|^NCS-6(?:008|20\d-SYS)|^NCS-F-(?:CHASS|SYS)|^NCS560-\d|^N560-4-SYS/ },
  // 8000-series centralized chassis: 8404 4-slot, 8608 8-slot, 8804/8808/8812/8818. The fixed 8000s
  // (8011, 810x, 820x, 8212, 8223, 871x) are not, and `-SYS` alone is no marker — N540-12Z20G-SYS
  // is a fixed router.
  { id: "chassis-8000", kind: "chassis", re: /^8(?:404|608|804|808|812|818)(?:-SYS|=|$)/ },
  // ASR 9000 modular: the 9904/9906/9910/9912/9922 line-card chassis and the 9006/9010. The compact
  // fixed 9901/9902/9903 and the 9001 are refused by the digit fences.
  { id: "chassis-asr9k", kind: "chassis", re: /^ASR-99(?:04|06|10|12|22)(?![0-9])|^ASR-90(?:06|10)(?![0-9])/ },
  // ASR 1000 modular: 1004/1006/1009/1013 take an RP, an ESP and SIP carriers. ASR1001 / ASR1002
  // are fixed and integrate their ESP — pinned refusals.
  { id: "chassis-asr1k", kind: "chassis", re: /^ASR1(?:004|006|009|013)(?![0-9])/ },
  // ASR 900 modular aggregation shelves (RSP + interface modules): ASR-902/903/907/914.
  { id: "chassis-asr900", kind: "chassis", re: /^ASR-9(?:02|03|07|14)(?![0-9])/ },
  // ISR G2 modular chassis sold without their performance engine.
  { id: "chassis-isrg2", kind: "chassis", re: /^CISCO39[24]5-CHASSIS/ },
  // ---- fixed service-provider / carrier routers -------------------------------------------------
  { id: "sp-crs", kind: "sp-core", re: /^CRS/ },
  { id: "sp-asr9k", kind: "sp-core", re: /^(?:ASR-9|A9K|A99|A9KV)/ },
  // `^ASR-9\d\d` was drafted here and DELETED: sp-asr9k's `^ASR-9` already subsumes it, and the
  // sabotage proved it — disabling sp-asr9k left ASR-9901 and ASR-920-12SZ-A unchanged, i.e. two
  // rules were deciding the same parts and neither could be seen to work. What is left is the
  // shapes that carry no dash after ASR9 and the A901 / A920 aggregation PIDs.
  { id: "sp-asr900", kind: "sp-core", re: /^(?:ASR9\d\d|A90\d-|A92\d-|FLS-A90)/ },
  { id: "sp-ncs", kind: "sp-core", re: /^(?:NCS|NC5|NC6|N5[2456]0)/ },
  // The 8000 series. Bounded at 8[0-7]\d\d so it cannot reach the C8xxx enterprise PIDs (they lead
  // with a C) or a four-plus-digit token, and the modular 8000s are already taken above.
  { id: "sp-8000", kind: "sp-core", re: /^8[0-7]\d\d(?![0-9])/ },
  { id: "sp-legacy", kind: "sp-core", re: /^(?:MWR-|CISCO7[36]|12[0-9]{3})/ },
];

/** The kind the axis falls back to. Named rather than repeated, because which kind is the fallback
 *  is the load-bearing decision above and it must be greppable. */
export const RT_FALLBACK: RouterKind = "enterprise";

export function routerKind(sku: string): RouterKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return RT_FALLBACK;
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  for (const r of DEVICE_RULES) if (r.re.test(s)) return r.kind;
  return RT_FALLBACK;
}

/** Which rule decided — for the distribution census and the tests. */
export function routerKindRule(sku: string): string {
  const s = String(sku ?? "").trim().toUpperCase();
  for (const r of RULES) if (r.re.test(s)) return r.id;
  for (const r of DEVICE_RULES) if (r.re.test(s)) return r.id;
  return "default";
}
