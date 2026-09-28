// src/core/collabKind.ts — what KIND of thing a Cisco collaboration part is.
//
// ONE AXIS FOR THREE CATEGORIES (12 Sep 2026, collab group). `unified-communications`,
// `collaboration-endpoints` and `conferencing` were shaped by componentKind's device/component split (UC and
// CE) or not at all (conferencing), so every "device" was asked one flat set: a headset was asked a display,
// video codecs and a PoE standard; a ceiling microphone the same as a Board Pro; a Meeting Server appliance
// nothing at all. The three categories share their product families — the same CP-, CS-, CTS-, CAB-, PWR-
// and server-component PIDs appear in more than one of them — so ONE axis is used for all three, and the
// same SKU gets the same kind whichever of the three it is filed in. That is also what makes the misfiling
// census possible: a `phone` in `unified-communications` is visible as one.
//
// WHY A SKU AXIS AND NOT THE SERIES. The series names a product LINE, not a kind: "Room Series" (604 parts)
// holds codecs, room kits, cameras, microphones, 71 power cords and 42 HDMI cables; "7900 - Unified IP Phone"
// holds phones, chargers, batteries, holsters and leather cases. Gating on series would ask a holster for a
// display. The kind comes from the SKU, which is always answered, so a gate on it can never collapse a
// question into `na` the way a condition on an unanswered optional fact does (R1).
//
// THE DEFAULT IS `unknown`, AND IT ASKS NOTHING. Unlike switchKind there is no device majority to default
// to: collaboration-endpoints is roughly one third phones, one third video systems and their parts, one
// third cords, cables and power. A SKU no rule names is more likely a licence still classed hardware (2,145
// of unified-communications' 2,928 "hardware" parts are UCM/Unity/HCS/CUWL entitlements, see the report)
// than a device, so a miss must ask LESS: an unrecognised phone loses its questions, never gains a wrong set.
//
// ORDER IS THE WHOLE DESIGN. Cisco puts the family FIRST and the accessory marker LATER (CS-BOARD55-WMK is a
// wall-mount kit for a Board 55, CTS-MX800-D-LGR a lower grill for an MX800, CS-CAM-RVPTZ-CBKC a ceiling
// bracket for a PTZ camera), so the component rules — cords, cables, accessory markers, power — run BEFORE
// the device families, and a device family only claims what no component marker has. Every marker was read
// against the part NAME before it was kept; the census and its refusals are in
// runs/reports/schema-collab-2026-09-12.md. The refusals worth keeping here:
//   `BR`  is NOT a bracket: SPA8000-BR and SPA122-BR are the BRAZIL gateway and ATA. Only `WM-BR` is.
//   `KIT` is NOT an accessory: CS-KIT-MINI is a Room Kit (a video codec), CTS-CAM-P60-KIT a camera.
//   `MG`  is a Room Kit Mini METAL GRILLE VARIANT (CS-KIT-MINI-MG-K9, a device) unless a colour letter
//         follows it (CS-DESKPRO-MG-C, "Metal speaker grille" — an accessory).
//   `TS`/`WM` on CS-T10 are the Room Navigator's TABLE-STAND and WALL-MOUNT VERSIONS — the device itself.
//   `ADPT` alone is a Euroblock connector pack (CS-CPRO-ADPT); a power adapter says a wattage or PWR.
//   `SW` is not software here: CP-7910+SW is a 7910 phone WITH A SWITCH port.

// kind-layer (13 Sep 2026, spec v2 §II.10/§II.13/§II.16, III.1). Three renames and one split, measured on the III.0
// row reads before they were written:
//   `power-supply` -> `power`   one noun, one cup set across categories (III.1). The rule is unchanged.
//   `server-component` -> the UCS component kinds. It was one bucket for everything inside a Business Edition,
//        Expressway, VCS or Meeting Server box — 158 rows across the three categories, every one asked only what it
//        fits. III.0 item 4 §7f/§7g read all of them: drives 30 (incl. 5 tape drives), memory 25 (+6 ISR 4460
//        DIMMs), RAID controllers 25, CPUs 20, NICs 12, TPMs 9, voice cards 4, risers 3, a motherboard, blades 9,
//        a PSU module, a blanking panel. So `cpu`, `memory`, `drive`, `nic`, `storage-controller` and `tpm` join
//        this axis with the UCS cup sets (rule 3), and the family-prefix rules below name them.
//   `mechanical` becomes a SKU kind here too. The accessory markers were one list holding two nouns: wall-mount
//        kits, floor stands, grilles, bezels, covers and brackets (MECHANICAL: what fixes or covers a device) and
//        chargers, batteries, handsets, pens and remotes (ACCESSORY). The name path already moved 403 of the first
//        kind; the SKU split names the rest whose NAME says only the SKU or names the host device.
export type CollabKind =
  | "phone" | "dect-base" | "video-device" | "video-codec" | "conference-camera" | "microphone" | "speaker" | "headset"
  | "touch-panel" | "display" | "expansion-module" | "voice-gateway" | "ata" | "voice-module" | "server"
  | "cpu" | "memory" | "drive" | "nic" | "storage-controller" | "tpm" | "flash"
  | "power" | "power-cord" | "cable" | "mechanical" | "accessory" | "transceiver" | "software"
  | "bundle"   // ruling 12a (28 Sep 2026): solution carts, promo bundles and demo kits; bundle_contents is relation-backed
  | "unknown";

/** Every kind the axis can name — the ledger lists all of them, including kinds no part holds today. */
/**
 * The three collaboration categories share ONE axis (this module): the same SKU, the same kind, wherever filed.
 *
 * IT LIVES HERE AND NOT IN partKind.ts, where it was until 28 Sep 2026, for a reason a typecheck cannot see:
 * fieldSchema needs it to give all three the same `connector` domain, and importing partKind from fieldSchema is a
 * CYCLE. `npx tsc --noEmit` passed on that import and the first suite to load it died with
 * "Cannot access 'COLLAB_CATEGORIES' before initialization" — a temporal dead zone, at import time, in every
 * consumer at once. This module imports nothing, so everyone can have it. partKind re-exports it, so there is
 * still exactly one list and no consumer had to change.
 */
export const COLLAB_CATEGORIES: readonly string[] = ["unified-communications", "collaboration-endpoints", "conferencing"];

export const COLLAB_KINDS: readonly CollabKind[] = [
  "phone", "dect-base", "video-device", "video-codec", "conference-camera", "microphone", "speaker", "headset",
  "touch-panel", "display", "expansion-module", "voice-gateway", "ata", "voice-module", "server",
  "cpu", "memory", "drive", "nic", "storage-controller", "tpm", "flash",
  "power", "power-cord", "cable", "mechanical", "accessory", "transceiver", "software", "bundle", "unknown",
];

/** The server parts inside a collaboration appliance, named with the UCS component kinds (one cup set per name, rule 3). */
export const COLLAB_SERVER_PART: readonly CollabKind[] = ["cpu", "memory", "drive", "nic", "storage-controller", "tpm"];

/** A whole product with its own specification sheet: it has a body, an environment and certifications. */
export const COLLAB_ENDPOINT: readonly CollabKind[] = [
  "phone", "dect-base", "video-device", "video-codec", "conference-camera", "microphone", "speaker", "headset",
  "touch-panel", "display", "expansion-module", "voice-gateway", "ata", "server",
];
/** Endpoints that run call software and register to a call-control platform. */
export const COLLAB_CALLING: readonly CollabKind[] = ["phone", "video-device", "video-codec", "ata", "voice-gateway"];
/** Video endpoints: an integrated screen (video-device) or a codec, kit or bar that drives external ones. */
export const COLLAB_VIDEO: readonly CollabKind[] = ["video-device", "video-codec"];
/** Things with a screen of their own — asked `display`. A codec, a bar and a kit are not. */
export const COLLAB_SCREEN: readonly CollabKind[] = ["phone", "video-device", "touch-panel", "display"];
/** Parts bought for what they fit: a DSP or voice card, a server CPU or drive, a PSU, an expansion module. */
export const COLLAB_FITS: readonly CollabKind[] = ["voice-module", ...COLLAB_SERVER_PART, "flash", "power", "expansion-module"];
/** A length of cable — asked its length. */
export const COLLAB_CABLE: readonly CollabKind[] = ["power-cord", "cable"];

// Accessory markers: a hyphen-delimited token anywhere after the family. Read by name, every one.
// kind-layer (13 Sep 2026): SPLIT IN TWO. The tokens that name what FIXES, STANDS, COVERS or FRAMES a device are
// MECHANICAL (spec I.4: rack kits, bezels, covers, brackets, blanks); the rest stay ACCESSORY. Read off the 219
// accessory rows and the 403 the name path had already called mechanical — CS-BOARD55-WMK "Wall Mount Kit",
// DP-9800-FS= "Replacement Footstand", CTS-MX800-D-LGR= "Lower Grill", CP-CASE-7925G= "Leather Carry Case",
// WP-9821-SWIVELCLP= (a clip), CS-GAS-SPRING= "Display Cavity Springs", CS-WALL-STRUCT+ "Wall Structure".
// `SK` STAYS AN ACCESSORY TOKEN: it is a Safety Kit on CS-BRDP55-SK-AUS and SLOVAKIA on CTS-LAPCONN-SK.
const MECH_TOKEN = "WMK|FSK|FSKL|FSKB|\\d+FSK[LB]?|TSK|SGK|WSA|WSK|WS|FS|FT\\d?|BRKT|BKT|WM-BR|MOUNT|MNT|CLNGMNT|VESA|STAND|SKI|CFBB|MB|FMK|SMK|DMK|WHK|CBK[LC]?|WBK[LC]?|RCK|CVR|COVER|COV|CAMCOV|CAMCV|LGR|TGR|GRL|GRILL\\d?|GRK|FG|WUK|WSBK|FRAME|CASE[A-Z]*|HOLSTER|CLIP|SWIVELCLP|LANYARD|LOCK|STRAP|SHOULDER|RACKEARS?|RACK|BLANK|SCRW|FRM|SPRING|TRAY|STRUCT\\d?|RUG|BZL|SECBZL|CBLMGMT|GAS|WALL\\d*|LCKNGWALLMOUNT";
// `RM` STAYS AN ACCESSORY TOKEN: it is IPT-RM-1S250P "UC Remote Mgmt Svc", a service, not a rack mount. The rack kits
// that carry it (VG420-RM-19-2R "Rack mount kit") say so in their name, and the name path calls them mechanical.
const ACC_TOKEN = "SK|RM|PENKIT|PENKITSOFT|PEN\\dX|ACTSTYL|STYL|STYLUSKIT|BATT|BAT|DSKCH|MCHGR|CHGR|DCHGR|DCHR|CHARGER|CORD|HANDSET|REMOTE|RMT|EARBUD|MISC|FANASSY|FAN|FANKIT|STRIP\\d?|NAL|LABEL|CFGPR|OC|PRES|ANT";
// `+` ends a token too: WP-9821-DCHGR+PWR is a desktop charger bundled with its power supply.
const MECH_MARKER = new RegExp(`(?:^|-)(?:${MECH_TOKEN})(?:-|\\d|\\+|$)|-MG-[CGL]$`);
const ACC_MARKER = new RegExp(`(?:^|-)(?:${ACC_TOKEN})(?:-|\\d|\\+|$)`);
/** The collaboration appliances' server-part families: Business Edition, Expressway, VCS (CE-), the CIT/CIT2/CIT3
 *  Meeting Server and BE options, and the older UC- options. The kind token follows the family. */
const PART_FAM = "(?:CIT\\d?|BE\\d[A-Z]|EXP|CE|UC)-";

// Ordered; the FIRST rule that matches wins. Components before devices — see the header.
const RULES: { kind: CollabKind; re: RegExp }[] = [
  // Pluggable optics filed in unified-communications: CE-1GSFP-T, EXP-10GSFP-SR-MP. A category-move proposal.
  { kind: "transceiver", re: /(?:^|-)\d+GSFP(?:-|$)/ },
  // Software images, media kits and clients still classed hardware. The class is the real fix (productClass).
  // kind-layer (13 Sep 2026): `-MK9` / `-SUB-K9` — "MLB Subscription - Phone 8861" (CP-8861-3PW-NA-MK9), "MLB for
  // Subscription Room Kit" (CS-KIT-SUB-K9): a device SUBSCRIPTION, a licence, filed with class hardware. Listed in the
  // class-change plan; until it runs, the kind asks nothing rather than a phone's questions.
  { kind: "software", re: /^(?:R-)?JAB|^JABBER|^AVIZ-.*-SW(?:-|$)|^AVIZ-TAC-SW|^S5\d{4}-TE|^BE\d[A-Z]-SW-|(?:^|-)SW-\d|-SW-K9|^UCM-\d|^(?:CP|DBS|CS)-[A-Z0-9-]*-(?:MK9|SUB-K9)$/ },
  // Mains and DC cords: PWR-CORD-EUR-D, CAB-PWR-C7-BRA-A, CAB-AC2UK, CAB-2DC-BRL-0.30M, PWR-CAB-INT-1.85M.
  { kind: "power-cord", re: /^(?:CP-)?PWR-CORD|^PWR-CAB-|^CAB-(?:PWR|AC\d?[A-Z]*$|AC-|2DC|DC-|TA-)/ },
  // Signal cables, and the cable KITS of the IX5000 (CTS-5K-CBL-R1-MIC). CP-HS-W-USBA / -RJ / -YQD are headset
  // cables and adapters, not headsets; CP-8831-DC-CBL a daisy-chain cable; CS-MIC-ARY-CAB11 a mic cable.
  // kind-layer (13 Sep 2026): `-USB-CAB` — CP-8832-USB-CAB= "USB-C Cable Spare ... to connect 8832 phone base and PoE
  // adapter", the one conference-phone part that is a cable (item 3 had it as a phone issue).
  { kind: "cable", re: /^CAB-|(?:^|-)CAB-MAG$|^CD-CBL-|^CTS-CABL|^CP-CAB-|^CS-CAB-|^CP-HS-WL?-(?:MUSB|USB|RJ|YQD)|-CBLKIT|-CBL$|(?:^|-)CAB\d+$|^CTS-5K-(?:CBL|EP-CBL|R\d-\d+M)|-USB-CAB$/ },
  // IX5000 and Panorama sub-assemblies: the named ones first, the rest of each family is furniture.
  { kind: "conference-camera", re: /-CAM-CLSTR/ },
  { kind: "microphone", re: /^CTS-5K-MIC/ },
  // kind-layer (13 Sep 2026): CTS-5K-SPKR "CTS-IX5000 Main Speakers, 1 Qty" — a speaker, was an accessory by family.
  { kind: "speaker", re: /^CTS-5K-(?:SUBWOOFER|AMP-|SPKR$)|^CS-PANO-(?:BASS|SPKR)/ },
  { kind: "display", re: /^CTS-5K-(?:70-G\d|DISP\d+$)/ },
  { kind: "video-codec", re: /^CTS-5K-ENCODER/ },
  { kind: "touch-panel", re: /^CTS-5K-CTRL-DV/ },
  // kind-layer (13 Sep 2026): the server parts inside the collaboration appliances, by family prefix + kind token.
  // Every row was read in III.0 item 4 §7f/§7g; the UCS axis names the same parts the same way (ucsKind.ts).
  //   tpm                 BE7K-TPM-M6 "TPM 2.0 ... for M6 servers", CE-UCSX-TPM1-001, EXP-TPM2-002, CIT3-TPM-002C
  //   storage-controller  BE6K-RAIDCTRLR-M6, CIT2-MRAID12G-1GB "12Gbps SAS 1GB FBWC Cache module", EXP-M2-HWRAID
  //                       "Boot optimized M.2 Raid controller", UC-RAID-9271 "MegaRAID 9271-8i", MCS-EXT-SCSI "SCSI card"
  //                       (RAID before drive: EXP-M2-HWRAID carries the M.2 drive token too)
  //   cpu                 BE6K-CPU-M6 "Intel 4310T 2.3GHz/105W 10C", CIT3-CPU-I6240, CE-CPU-E5-2643, UC-CPU-E5-2609
  //   memory              BE7K-RAM, CIT2-MR-1X161RV-A "16GB DDR4-2400 RDIMM", CIT-8-16-MEM-UPG "Upgrades E140/160 First
  //                       memory dimm", MEM-4460-8G "8G DRAM (1 DIMM) for Cisco ISR 4460" (VG450 options, UC-filed)
  //   drive               BE6K-DISK-M6 "600GB 12G SAS", CE-HDD1TI2F212, CIT3-SD960G6SB-EV "960GB ... SSD", CIT-A03-D300GA2,
  //                       EXP-M2-240G "240GB SATA M.2", EXP-SD-32G-S "32GB SD Card", MCS-EXT-DAT "External DAT tape drive"
  //   nic                 BE7K-NIC-M6, EXP-PCIE-ID10GF "Intel X710-DA2 dual-port 10G SFP+ NIC", CE-N2XX-AIPCI01,
  //                       CIT3-MLOM-40G-04 "UCS VIC 1440 modular LOM", CIT3-MLOM-PT-01 "Port Expander Card (mezz) for VIC"
  // REFUSALS: EXP-MSTOR-SD "Mini Storage Carrier for SD" is a carrier (ucsKind: MSTOR -> accessory); BE7K-PCIERISER
  // and CIT2-PCI-1B-240M4 are risers (accessory); VG350-SPE150/K9 is the VG350 motherboard (accessory);
  // CIT3-FI-M-6324 "UCS 6324 In-Chassis FI" is a fabric interconnect this axis has no kind for (unknown, open decision).
  // CTS-5K-HOSTCPU "CTS-IX5000 Host CPU" is the IX5000's compute sub-assembly, not a UCS CPU: it falls to the IX5000
  // family rule below (accessory — what it fits), the reading item 4 §7g left as a decision (video-codec or server).
  { kind: "voice-module", re: /^CIT\d?-(?:PVDM|VWIC|VIC)|^EM-HDA-/ },
  { kind: "server", re: /^CIT\d-B\d{3}-M\d/ },
  // (CIT3-FI-M-6324 needs no rule: with the old `^CIT\d?-` catch-all gone it falls to `unknown` by default — an explicit
  // unknown rule for it was dead by construction, and the sabotage test said so.)
  { kind: "mechanical", re: /^CIT\d?-(?:\d{4}-PKG|LSTOR-BK|PSU-BLKP)/ },
  { kind: "accessory", re: /PCIERISER|^CIT\d?-PCI-\d|^VG\d{3}-SPE\d|^EXP-MSTOR-/ },
  { kind: "tpm", re: new RegExp(`^${PART_FAM}(?:UCSX-)?TPM`) },
  { kind: "storage-controller", re: new RegExp(`^${PART_FAM}[A-Z0-9-]*RAID|^MCS-EXT-SCSI`) },
  { kind: "cpu", re: new RegExp(`^${PART_FAM}CPU(?:-|$)`) },
  // The VG224 / IAD2430 gateway memory, planned in from routers — a component follows its host (closing items at aa1143f, item 4).
  // Typed by what each NAME says (operator, 14 Sep 2026), which the size suffix mirrors on all 7 rows: "…D" = "128MB DRAM Memory
  // for VG224" -> memory; "…F" = "64MB Flash Memory for IAD2430 series" -> flash (a new collaboration kind; its cup is `flash`).
  { kind: "flash", re: /^MEM-2(?:24|43)-\d+X\d+F(?:-U)?$/ },
  { kind: "memory", re: /^MEM-2(?:24|43)-\d+X\d+D(?:-U)?$/ },
  { kind: "memory", re: new RegExp(`^${PART_FAM}(?:RAM|MR-|MEM-)|^CIT\\d?-\\d+-\\d+-MEM-UPG|^MEM-\\d{4}-`) },
  { kind: "drive", re: new RegExp(`^${PART_FAM}(?:DISK|HDD?|SDB?\\d|SDC\\d|SD-|A03-D|M2-\\d)|^MCS-EXT-(?:DAT|SDLT)`) },
  { kind: "nic", re: new RegExp(`^${PART_FAM}(?:NIC|PCIE-I|N2XX-A|MLOM-)`) },
  // A Catalyst switch sold inside a room system (CTS-5K-LC-SWITCH, CS-PANO-SWITCH2) — not ours to shape.
  { kind: "unknown", re: /-(?:LC-)?SWITCH\d?$/ },
  // Atlas IP clocks and enclosures sit in "Paging Server" beside the speakers; a clock is not a speaker.
  { kind: "unknown", re: /^SP-ATLAS-(?:IPDC|DSSE|IPDSC)/ },
  // kind-layer (13 Sep 2026): the Atlas ENCLOSURES and mounts are mechanical — SP-ATLAS-SST-I8S= "Surface Mount Straight
  // Enclosure", SEA-I8S "Angled indoor enclosure", SEST-IH "Straight outdoor enclosure", I8S-TB "Tile Bridge",
  // 180-2 "Rail PR for Ceiling Mounting", IPS-ZCFP "Rack Mount Kit for Zone Controller". Only the NAMED families: the
  // placeholder-named IP- twins (SP-ATLAS-IPSEA-SD= "Cisco SP-ATLAS-IPSEA-SD=") stay where they were.
  { kind: "mechanical", re: /^SP-ATLAS-(?:FST|SST|SEA-|SEST-|I8S-TBE?$|180-|IPS-ZCFP)/ },
  // kind-layer (13 Sep 2026): the IX5000 laptop-connectivity kits (28 rows, "TelePresence Laptop Connectivity - Japan")
  // BEFORE the marker rules — CTS-LAPCONN-SK is Slovakia, not a safety kit. The Webex Share dongle, the headset
  // Bluetooth adapters (HS-WL-ADPT-USBA) and the Jabra 450 handset (SPVAC-H450-W-EU) are accessories too.
  { kind: "accessory", re: /^CTS-LAPCONN-|^SPK-SHARE-|^HS-WL?-ADPT|^SPVAC-H450-/ },
  // kind-layer (13 Sep 2026): the MECHANICAL members of the named families — a Desk metal grille, a Room 55 rear cover,
  // the Avizia carts, the IX5000 table legs / tops / fascia / frames / panels / sheet metal / tools, the Panorama wall
  // structure, cavity and grill, the Room 70 monitor side cover (CS-ROOM70-MON-SCV, which the display rule's MON token
  // would otherwise take) and the SpeakerTrack interface plate.
  // The CARTS only (AVIZ-CA750-1-K9 "Avizia ClinicalCart CA750", AVIZ-MXCART): AVIZ-CA750-ACC-RNC "Retractable Network
  // Cord" is a cord, and a table's PDU (CTS-5K-TBL-PDU "Power Distribution Unit for Table") is power, not a table top.
  // Installation sheets (DOC-MX700-DDC-FSK) are claimed first by the DOC- rule, before the floor-stand token reaches them.
  { kind: "accessory", re: /^DOC-|^AVIZ-CA\d{3}-ACC-/ },
  { kind: "mechanical", re: /^CS-DESK[A-Z]*-MG$|^CS-ROOM\d+[A-Z]*-RC$|^AVIZ-CA\d{3}-[A-Z0-9]-K9$|^AVIZ-MXCART|^CTS-5K-(?:LEGS|TBL(?!-PDU)|\d+-SEAT|FASCIA|MECH|BZL|CAM-HS|CAM-TOOL|WHTBD-TOOL|FAB-PNL|HW-|MTL-|SHTML|THERM|SEISMIC|DISP\d+-KIT|LPS-MECH)|^CS-PANO-(?:WALL|\d+-CAV|240-CSTM|PRES-TOP|GRILL|VESA)|^CS-(?:WALL\d*-STRUCT|GAS-SPRING)|-MON-SCV$|^CTS-ST-INT-PLATE/ },
  // kind-layer (13 Sep 2026): the phone SPARE PARTS item 3 found filed as phones (85 rows) — bezels, handset hooks, the
  // 9821 battery door and the 840S scanner handle are mechanical; the conference-phone microphone kits are microphones;
  // handsets, the 8831 speaker base / display control unit, daisy-chain kits, 8832 PoE / Ethernet adapters and the
  // multi-chargers are accessories. The rules sit before the family catch-alls and before `^CP-\d{3,4}` (phone).
  { kind: "mechanical", re: /^CP-\d{4}-(?:[A-Z]-)?(?:VID-)?BEZEL$|^CP-\d{4}-HS-HOOK$|^WP-\d{4}-BATTDOOR$|^CP-\d{3}S?-HANDLE$/ },
  // (CP-8831-MIC-BATT= "Spare Batteries for Wireless Satellite Microphones" is a battery — the BATT marker takes it.)
  { kind: "microphone", re: /^CP-88(?:31|32)-MIC-(?!BATT)/ },
  { kind: "accessory", re: /^CP-\d{4}-HS$|^CP-\d{4}-HS-|^CP-6900-[LM]HS-|^CP-6901-MHS-|^DP-9800-HS(?:-|$)|^CP-8831-(?:BASE|3PB-|DCU-|DC-)|^CP-8832-(?:DC|ETH|POE)(?:-|$)|^CP-800-USBCH$|^CP-8[46]0-(?:PH-|BAT-)?MCHR/ },
  { kind: "accessory", re: /^CTS-5K-|^CS-PANO-(?!MON)|^CS-1CONNECT|^CP-DX-(?:W-)?HS|^KEY-[A-Z]+-ADMIN|^CP-8831-3PD|^CS-CPRO-ADPT|^CP-HS-WL-\dACA/ },
  { kind: "mechanical", re: MECH_MARKER },
  { kind: "accessory", re: ACC_MARKER },
  // Families with no marker: ACC-MX200-42-KIT, MB100 wall brackets, PWRCLIP-UK plug clips, DOC-CCM-3.3 manuals.
  // (BRKT-, CTS-NAL- and SPBOARD- stood here and were shadowed by the marker rule above — the sabotage test found it.)
  // kind-layer (13 Sep 2026): `^MB\d` left this rule — MB100 "Wall-mount brackets for SPA 300 ..." is MECHANICAL, and the
  // MB token of the mechanical marker above already takes it (a separate `^MB\d` rule was shadowed; the sabotage found it).
  { kind: "accessory", re: /^ACC-|^PWRCLIP/ },
  // Power supplies, cubes, injectors and adapters: CP-PWR-CUBE-4, PSU-12VDC-120W, CS-PWR-INJ-30W, POE-WW,
  // PA100-EU, PWR18W-ETH-NA, PWR-VG410-250WAC, and the server PSUs (BE7K-PSU, EXP-PSU1-1200W, CIT2-PSU2-1400W).
  // collab-class (12 Sep 2026): `CUBE` was a bare token here and it is REDUNDANT AND WRONG. Every
  // real power cube is `CP-PWR-CUBE-N` ("IP Phone power transformer for the 7900 phone series"),
  // which the PWR token already matches; the only thing `CUBE` added was CUBE = Cisco Unified
  // BORDER ELEMENT, so 15 session licences (UPG-CUBE-TS-12TO14, MIG-CUBE14-C1-STD) were being
  // called power supplies. Found by the class-against-kind control, not by a test.
  // kind-layer (13 Sep 2026): renamed `power-supply` -> `power` (III.1); CIT3-UAC1 "Single phase AC power module for UCS
  // 5108" joins it.
  { kind: "power", re: /(?:^|-)(?:PWR|PSU|PSU\d|PSUT|PWRINJ\d*|INJ|INJ\d|ADPT\d+W)(?:-|\d|$)|^PSU-|^PA\d{3}-|^POE-|^PWR\d+W|-PWR$|^CP-\d+X?-PWR|-\d+W(?:AC|DC)$|^CIT\d-UAC\d/ },
  // Collaboration appliances: Business Edition 6000/7000 (and the ISR-based BE6000S), Expressway and VCS
  // appliances, Meeting Server 1000/2000 and TelePresence Management Server, the AI POD, legacy MCS servers.
  // collab-class (12 Sep 2026): `ST` was a BARE token here and it matched the START of `START`, so
  // the nine `BE6K-START-*` licence packs ("BE6000 User License Starter Bundle with 35 UWL Pro
  // Licenses") were called servers. The two forms that ARE servers spell it `ST-BDL` and `STBDL`,
  // so the token is anchored to those; `START` no longer reaches it.
  { kind: "server", re: /^BE\d[A-Z]?-(?:M\d|K9|ST-|STBDL|XU)|^BE\d[A-Z]-M\d|^BE6S-|^EXPWY-(?:\d{4}|CE\d|[CE]-BDL)|^CTI-CE\d|^VCS-[CE]-BDL|^CMS-[MS]-M\d|^CMS\dK-(?!SW)|^CTI-(?:CMS-?\dK?|CMS\dKM|TMS-APL|ATP-TMS-APL)|^AIPOD-|^UCSC-C\d|^MCS-?\d/ },
  // Key expansion modules and attendant consoles: CP-BEKEM, CP-68KEM-3PCC, DP-9800-KEM, SPA500S, SPA500DS.
  // kind-layer (13 Sep 2026): CP-7914 "14-button key expansion module", CP-7915 "Grayscale Expansion Module", CP-7916
  // "Color Expansion Module" — the pre-KEM naming, filed as phones until item 3 read them.
  { kind: "expansion-module", re: /KEM(?:-|\d|$)|^SPA500D?S$|^CP-791[456](?:-|$)/ },
  // Spare monitors: CS-ROOM55D-MON-R, CTS-MX700-MONLS, CS-PANO-MON82, CTS-MON-42-WW.
  { kind: "display", re: /-MON(?:\d|[LRS]|-|$)|^CTS-MON-|^CTS-LAPT-DISP/ },
  { kind: "touch-panel", re: /^CS-T10(?:-|$)|^CS-TOUCH\d|^CTS-CTRL-DV/ },
  { kind: "microphone", re: /^CS-MIC-|^CTS-MIC-|^CTS-ST-ARR|^CP-MIC-/ },
  { kind: "conference-camera", re: /^CS-CAM-|QUADCAM|^CTS-CAM-|^CTS-PHD|^PHD-KIT|^CD-DSKCAM|^CTS-MXCAM|^CTS-SPKER-TRACK/ },
  { kind: "speaker", re: /-SPKR$|^SP-ATLAS-/ },
  // Headsets: HS-W-321, HS-WL-730, CP-HS-W-532-USBA. A model number follows the family; an adapter does not.
  { kind: "headset", re: /^HS-WL?-\d|^HS-WL?-\d{3}|^CP-HS-WL?-\d{3}/ },
  // Video endpoints WITH a screen: boards, desk devices, Room 55/70/Panorama/EQX, MX, DX, IX.
  { kind: "video-device", re: /^CS-(?:BOARD|BRD|DESK|DSKPRO|DX|ROOM|R\d|MX|EQX)|^SPARK-BOARD|^CP-DX\d|^CTS-(?:MX\d|IX\d|1700|VX)/ },
  // Video endpoints WITHOUT one: codecs, room kits, room bars, SX / QuickSet / C-series codecs.
  { kind: "video-codec", re: /^CS-(?:CODEC|RCOD|CPRO|CODPL|KIT|KPRO|BAR|SX)|^CTS-(?:SX\d|QSC|C\d+CODEC|MXCODEC|CC-SX|INTP|ATP-C\d)/ },
  { kind: "dect-base", re: /^DBS-\d|^RPT-\d/ },
  // IP phones: desk, conference, wireless and DECT handsets. CP-8831-3PCC-K9, DP-9851, WP-9821, SPA525G2.
  // kind-layer (13 Sep 2026): SLINK-8744-NA= — the SpectraLink 8744 wireless handset sold under the 7900 series
  // (placeholder names; the model number is the evidence, 3 rows, no document).
  { kind: "phone", re: /^CP-\d{3,4}|^CP-ROOM-|^DP-98\d\d|^WP-98\d\d|^SPA\d{3}G|^SPA30\d|^SPA302D|^SLINK-\d{4}-/ },
  // Voice gateways: VG202..VG450, the SPA8000/8800 8-port gateways, the Euro-ISDN VG-2BRI, C3945-112FXS.
  { kind: "voice-gateway", re: /^VG\d|^VG-\d?BRI|^SPA8\d{3}|^C3945-\d+FXS/ },
  // collab-class (12 Sep 2026) — THE ONE REAL HARDWARE FAMILY IN THE FALLBACK RESIDUE.
  // The reverse NAME control over unified-communications' 1,456 `unknown` rows was run to find
  // licences wearing a hardware class; it found 1,430 of those and exactly one family going the
  // other way. UNITY-PIMG-MITEL is "PBX-IP Media Gateway for Mitel SX200 and SX2000 PBXs",
  // UNITY-PIMG-LEGEND the same for "Avaya Merlin Legend systems", UNITY-TIMG-1 a "T1 IP-Media
  // Gateway": physical boxes that sit between a legacy PBX and Unity Connection. 14 parts.
  // They are ALSO the `except` list on productClass's UNITY licence prefix — a rule and a veto for
  // the same 14 parts, in the two files that each have to get them right.
  { kind: "voice-gateway", re: /^UNITY-[PT]IMG(?:-|\d|$)/ },
  // end collab-class
  // Analog telephone adapters, including the ATA-with-router SKUs (SPA122, SPA2102, WRP400, ATA192).
  { kind: "ata", re: /^ATA\d|^SPA1\d\d|^SPA2\d{3}|^SPA232D|^WRP\d/ },
  // Voice cards and DSP modules: PVDM3-64, VIC3-4FXS/DID, VWIC3-2MFT-T1/E1, NIM-4FXSP, SM-D-72FXS.
  { kind: "voice-module", re: /^PVDM\d|^VIC\d?-|^VWIC\d?-|^EVM-|^NIM-\d*FX|^SM-D?-?\d*FX|^SM-X-\d+FX|^EHWIC-\d*FX|^HWIC-\d*FX|^NM-HDV/ },
];

/** The rule table, exported read-only so the test can disable one rule family and watch it go red. */
export const COLLAB_RULES: readonly { kind: CollabKind; re: RegExp }[] = RULES;

/** Normalise as the rules see it: upper case, and the spare / TAA / customised tails (=, +, trailing -) off. */
export function collabSku(sku: string): string {
  return String(sku ?? "").trim().toUpperCase().replace(/[=+]+$/, "").replace(/-+$/, "").replace(/[=+]+$/, "");
}

export function collabKind(sku: string, rules: readonly { kind: CollabKind; re: RegExp }[] = RULES): CollabKind {
  const s = collabSku(sku);
  if (s === "") return "unknown";
  for (const r of rules) if (r.re.test(s)) return r.kind;
  return "unknown";
}
