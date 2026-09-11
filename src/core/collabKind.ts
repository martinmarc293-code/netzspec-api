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

export type CollabKind =
  | "phone" | "dect-base" | "video-device" | "video-codec" | "camera" | "microphone" | "speaker" | "headset"
  | "touch-panel" | "display" | "expansion-module" | "gateway" | "ata" | "voice-module" | "server"
  | "server-component" | "power-supply" | "power-cord" | "cable" | "accessory" | "transceiver" | "software"
  | "unknown";

/** Every kind the axis can name — the ledger lists all of them, including kinds no part holds today. */
export const COLLAB_KINDS: readonly CollabKind[] = [
  "phone", "dect-base", "video-device", "video-codec", "camera", "microphone", "speaker", "headset",
  "touch-panel", "display", "expansion-module", "gateway", "ata", "voice-module", "server",
  "server-component", "power-supply", "power-cord", "cable", "accessory", "transceiver", "software", "unknown",
];

/** A whole product with its own specification sheet: it has a body, an environment and certifications. */
export const COLLAB_ENDPOINT: readonly CollabKind[] = [
  "phone", "dect-base", "video-device", "video-codec", "camera", "microphone", "speaker", "headset",
  "touch-panel", "display", "expansion-module", "gateway", "ata", "server",
];
/** Endpoints that run call software and register to a call-control platform. */
export const COLLAB_CALLING: readonly CollabKind[] = ["phone", "video-device", "video-codec", "ata", "gateway"];
/** Video endpoints: an integrated screen (video-device) or a codec, kit or bar that drives external ones. */
export const COLLAB_VIDEO: readonly CollabKind[] = ["video-device", "video-codec"];
/** Things with a screen of their own — asked `display`. A codec, a bar and a kit are not. */
export const COLLAB_SCREEN: readonly CollabKind[] = ["phone", "video-device", "touch-panel", "display"];
/** Parts bought for what they fit: a DSP or voice card, a server CPU or drive, a PSU, an expansion module. */
export const COLLAB_FITS: readonly CollabKind[] = ["voice-module", "server-component", "power-supply", "expansion-module"];
/** A length of cable — asked its length. */
export const COLLAB_CABLE: readonly CollabKind[] = ["power-cord", "cable"];

// Accessory markers: a hyphen-delimited token anywhere after the family. Read by name, every one.
const ACC_TOKEN = "WMK|FSK|FSKL|FSKB|\\d+FSK[LB]?|TSK|SGK|WSA|WSK|WS|FS|FT\\d?|BRKT|BKT|WM-BR|MOUNT|MNT|CLNGMNT|VESA|STAND|SKI|SK|CFBB|MB|FMK|SMK|DMK|WHK|CBK[LC]?|WBK[LC]?|RCK|CVR|COVER|COV|CAMCOV|CAMCV|LGR|TGR|GRL|GRILL\\d?|GRK|FG|PENKIT|PENKITSOFT|PEN\\dX|ACTSTYL|STYL|STYLUSKIT|WUK|WSBK|FRAME|CASE[A-Z]*|HOLSTER|CLIP|SWIVELCLP|LANYARD|LOCK|STRAP|SHOULDER|RACKEARS?|RACK|RM|BLANK|SCRW|FRM|SPRING|BATT|BAT|DSKCH|MCHGR|CHGR|DCHGR|DCHR|CHARGER|CORD|HANDSET|REMOTE|RMT|TRAY|STRUCT\\d?|RUG|EARBUD|MISC|BZL|SECBZL|FANASSY|FAN|FANKIT|STRIP\\d?|NAL|LABEL|CBLMGMT|GAS|CFGPR|WALL\\d*|OC|PRES|LCKNGWALLMOUNT|ANT";
// `+` ends a token too: WP-9821-DCHGR+PWR is a desktop charger bundled with its power supply.
const ACC_MARKER = new RegExp(`(?:^|-)(?:${ACC_TOKEN})(?:-|\\d|\\+|$)|-MG-[CGL]$`);

// Ordered; the FIRST rule that matches wins. Components before devices — see the header.
const RULES: { kind: CollabKind; re: RegExp }[] = [
  // Pluggable optics filed in unified-communications: CE-1GSFP-T, EXP-10GSFP-SR-MP. A category-move proposal.
  { kind: "transceiver", re: /(?:^|-)\d+GSFP(?:-|$)/ },
  // Software images, media kits and clients still classed hardware. The class is the real fix (productClass).
  { kind: "software", re: /^(?:R-)?JAB|^JABBER|^AVIZ-.*-SW(?:-|$)|^AVIZ-TAC-SW|^S5\d{4}-TE|^BE\d[A-Z]-SW-|(?:^|-)SW-\d|-SW-K9|^UCM-\d/ },
  // Mains and DC cords: PWR-CORD-EUR-D, CAB-PWR-C7-BRA-A, CAB-AC2UK, CAB-2DC-BRL-0.30M, PWR-CAB-INT-1.85M.
  { kind: "power-cord", re: /^(?:CP-)?PWR-CORD|^PWR-CAB-|^CAB-(?:PWR|AC\d?[A-Z]*$|AC-|2DC|DC-|TA-)/ },
  // Signal cables, and the cable KITS of the IX5000 (CTS-5K-CBL-R1-MIC). CP-HS-W-USBA / -RJ / -YQD are headset
  // cables and adapters, not headsets; CP-8831-DC-CBL a daisy-chain cable; CS-MIC-ARY-CAB11 a mic cable.
  { kind: "cable", re: /^CAB-|(?:^|-)CAB-MAG$|^CD-CBL-|^CTS-CABL|^CP-CAB-|^CS-CAB-|^CP-HS-WL?-(?:MUSB|USB|RJ|YQD)|-CBLKIT|-CBL$|(?:^|-)CAB\d+$|^CTS-5K-(?:CBL|EP-CBL|R\d-\d+M)/ },
  // IX5000 and Panorama sub-assemblies: the named ones first, the rest of each family is furniture.
  { kind: "camera", re: /-CAM-CLSTR/ },
  { kind: "microphone", re: /^CTS-5K-MIC/ },
  { kind: "speaker", re: /^CTS-5K-(?:SUBWOOFER|AMP-)|^CS-PANO-(?:BASS|SPKR)/ },
  { kind: "display", re: /^CTS-5K-(?:70-G\d|DISP\d+$)/ },
  { kind: "video-codec", re: /^CTS-5K-ENCODER/ },
  { kind: "touch-panel", re: /^CTS-5K-CTRL-DV/ },
  { kind: "server-component", re: /^CTS-5K-HOSTCPU|^MCS-EXT-/ },
  // A Catalyst switch sold inside a room system (CTS-5K-LC-SWITCH, CS-PANO-SWITCH2) — not ours to shape.
  { kind: "unknown", re: /-(?:LC-)?SWITCH\d?$/ },
  // Atlas IP clocks and enclosures sit in "Paging Server" beside the speakers; a clock is not a speaker.
  { kind: "unknown", re: /^SP-ATLAS-(?:IPDC|DSSE|IPDSC)/ },
  { kind: "accessory", re: /^SP-ATLAS-(?:FST|SST|IPS-ZCFP)/ },
  { kind: "accessory", re: /^CTS-5K-|^CS-PANO-(?!MON)|^CS-1CONNECT|^CS-DESK[A-Z]*-MG$|^CS-ROOM\d+[A-Z]*-RC$|^CP-DX-(?:W-)?HS|^AVIZ-(?:CA\d|MXCART)|^KEY-[A-Z]+-ADMIN|^CP-8831-3PD|^CS-CPRO-ADPT|^CP-HS-WL-\dACA/ },
  { kind: "accessory", re: ACC_MARKER },
  // Families with no marker: ACC-MX200-42-KIT, MB100 wall brackets, PWRCLIP-UK plug clips, DOC-CCM-3.3 manuals.
  // (BRKT-, CTS-NAL- and SPBOARD- stood here and were shadowed by the marker rule above — the sabotage test found it.)
  { kind: "accessory", re: /^ACC-|^MB\d|^PWRCLIP|^DOC-/ },
  // Power supplies, cubes, injectors and adapters: CP-PWR-CUBE-4, PSU-12VDC-120W, CS-PWR-INJ-30W, POE-WW,
  // PA100-EU, PWR18W-ETH-NA, PWR-VG410-250WAC, and the server PSUs (BE7K-PSU, EXP-PSU1-1200W, CIT2-PSU2-1400W).
  { kind: "power-supply", re: /(?:^|-)(?:PWR|PSU|PSU\d|PSUT|PWRINJ\d*|INJ|INJ\d|ADPT\d+W|CUBE)(?:-|\d|$)|^PSU-|^PA\d{3}-|^POE-|^PWR\d+W|-PWR$|^CP-\d+X?-PWR|-\d+W(?:AC|DC)$/ },
  // Server parts for the collaboration appliances: CPUs, DIMMs, drives, RAID, NICs, TPMs, risers, blades.
  { kind: "server-component", re: /^CIT\d?-|^BE\d[A-Z]-(?:CPU|RAM|DISK|NIC|RAID|RAIDCTRLR|PCIE|PCIERISER|TPM)|^EXP-(?:CPU|MR|HD|M2|RAID|MRAID|TPM|PCIE|SD|MSTOR|UCSX|UCSCRAID)|^CE-(?:CPU|MR|HDD|RAID|UCSX|UCSCRAID|N2XX)|^MEM-\d|-SPE\d+/ },
  // Collaboration appliances: Business Edition 6000/7000 (and the ISR-based BE6000S), Expressway and VCS
  // appliances, Meeting Server 1000/2000 and TelePresence Management Server, the AI POD, legacy MCS servers.
  { kind: "server", re: /^BE\d[A-Z]?-(?:M\d|K9|ST|XU)|^BE\d[A-Z]-M\d|^BE6S-|^EXPWY-(?:\d{4}|CE\d|[CE]-BDL)|^CTI-CE\d|^VCS-[CE]-BDL|^CMS-[MS]-M\d|^CMS\dK-(?!SW)|^CTI-(?:CMS-?\dK?|CMS\dKM|TMS-APL|ATP-TMS-APL)|^AIPOD-|^UCSC-C\d|^MCS-?\d/ },
  // Key expansion modules and attendant consoles: CP-BEKEM, CP-68KEM-3PCC, DP-9800-KEM, SPA500S, SPA500DS.
  { kind: "expansion-module", re: /KEM(?:-|\d|$)|^SPA500D?S$/ },
  // Spare monitors: CS-ROOM55D-MON-R, CTS-MX700-MONLS, CS-PANO-MON82, CTS-MON-42-WW.
  { kind: "display", re: /-MON(?:\d|[LRS]|-|$)|^CTS-MON-|^CTS-LAPT-DISP/ },
  { kind: "touch-panel", re: /^CS-T10(?:-|$)|^CS-TOUCH\d|^CTS-CTRL-DV/ },
  { kind: "microphone", re: /^CS-MIC-|^CTS-MIC-|^CTS-ST-ARR|^CP-MIC-/ },
  { kind: "camera", re: /^CS-CAM-|QUADCAM|^CTS-CAM-|^CTS-PHD|^PHD-KIT|^CD-DSKCAM|^CTS-MXCAM|^CTS-SPKER-TRACK/ },
  { kind: "speaker", re: /-SPKR$|^SP-ATLAS-/ },
  // Headsets: HS-W-321, HS-WL-730, CP-HS-W-532-USBA. A model number follows the family; an adapter does not.
  { kind: "headset", re: /^HS-WL?-\d|^HS-WL?-\d{3}|^CP-HS-WL?-\d{3}/ },
  // Video endpoints WITH a screen: boards, desk devices, Room 55/70/Panorama/EQX, MX, DX, IX.
  { kind: "video-device", re: /^CS-(?:BOARD|BRD|DESK|DSKPRO|DX|ROOM|R\d|MX|EQX)|^SPARK-BOARD|^CP-DX\d|^CTS-(?:MX\d|IX\d|1700|VX)/ },
  // Video endpoints WITHOUT one: codecs, room kits, room bars, SX / QuickSet / C-series codecs.
  { kind: "video-codec", re: /^CS-(?:CODEC|RCOD|CPRO|CODPL|KIT|KPRO|BAR|SX)|^CTS-(?:SX\d|QSC|C\d+CODEC|MXCODEC|CC-SX|INTP|ATP-C\d)/ },
  { kind: "dect-base", re: /^DBS-\d|^RPT-\d/ },
  // IP phones: desk, conference, wireless and DECT handsets. CP-8831-3PCC-K9, DP-9851, WP-9821, SPA525G2.
  { kind: "phone", re: /^CP-\d{3,4}|^CP-ROOM-|^DP-98\d\d|^WP-98\d\d|^SPA\d{3}G|^SPA30\d|^SPA302D/ },
  // Voice gateways: VG202..VG450, the SPA8000/8800 8-port gateways, the Euro-ISDN VG-2BRI, C3945-112FXS.
  { kind: "gateway", re: /^VG\d|^VG-\d?BRI|^SPA8\d{3}|^C3945-\d+FXS/ },
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
