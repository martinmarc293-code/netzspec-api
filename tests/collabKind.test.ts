// tests/collabKind.test.ts — proof for src/core/collabKind.ts (collab group, 12 Sep 2026).
//
//   npx tsx tests/collabKind.test.ts
//
// Every SKU is a real Cisco part from unified-communications, collaboration-endpoints or conferencing, with the
// kind its NAME supports (the census in runs/reports/schema-collab-2026-09-12.md). Three halves:
//   POSITIVES  one or more per rule, so every rule is seen firing;
//   REFUSALS   more of them than positives — a SKU that sits next to a rule's token and must NOT take that kind,
//              each carrying the reason it once did or plausibly would;
//   SABOTAGE   every rule is removed in turn and at least one of the positives it decides must change kind.
//              A rule whose removal changes nothing is shadowed or dead, and the suite fails.
import { collabKind, COLLAB_RULES, COLLAB_KINDS, COLLAB_ENDPOINT, type CollabKind } from "../src/core/collabKind.js";
import { partKind, KIND_CATEGORIES, COLLAB_CATEGORIES } from "../src/core/partKind.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { PROFILES, requirementFor, type Requirement } from "../src/core/fieldSchema.js";
import { deployRole } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); } else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
};

const POSITIVE: [string, CollabKind][] = [
  ["CE-1GSFP-T", "transceiver"], ["EXP-10GSFP-SR-MP=", "transceiver"],
  ["JABBER-DESKTOP", "software"], ["BE7K-SW-9X10X", "software"],
  ["PWR-CORD-EUR-D", "power-cord"], ["CAB-PWR-C7-BRA-A", "power-cord"], ["CAB-AC2UK=", "power-cord"],
  ["CAB-2HDMI-8K-2M+", "cable"], ["CP-HS-W-USBA=", "cable"], ["CTS-5K-CBL-R1-MIC", "cable"], ["CP-8831-DC-CBL", "cable"],
  ["CTS-5K-CAM-CLSTR", "camera"], ["CTS-5K-MIC=", "microphone"], ["CTS-5K-SUBWOOFER", "speaker"],
  ["CTS-5K-DISP42", "display"], ["CTS-5K-ENCODER", "video-codec"], ["CTS-5K-CTRL-DVX-10", "touch-panel"],
  ["CTS-5K-HOSTCPU", "accessory"], ["CTS-5K-LC-SWITCH", "unknown"], ["SP-ATLAS-IPDC=", "unknown"],
  // kind-layer (13 Sep 2026): the fixing / covering markers are MECHANICAL; the rest stay accessories
  ["SP-ATLAS-FST-DC=", "mechanical"], ["CTS-5K-LEGS-BACK", "mechanical"], ["CS-BOARD55-WMK", "mechanical"],
  ["CTS-MX800-D-LGR=", "mechanical"], ["WP-9821-DCHGR+PWR", "accessory"], ["BRKT-P40-MONITR", "mechanical"],
  ["PWRCLIP-UK=", "accessory"], ["ACC-MX200-42-KIT", "accessory"], ["MB100", "mechanical"],
  ["CP-PWR-CUBE-5", "power"], ["POE-WW", "power"], ["EXP-PSU1-1200W", "power"], ["CIT3-UAC1", "power"],
  ["BE7K-CPU", "cpu"], ["CIT2-MR-1X161RV-A", "memory"],
  // kind-layer (13 Sep 2026): the server parts, III.0 item 4 §7f/§7g, one or more per rule
  ["BE7K-TPM-M6", "tpm"], ["CE-UCSX-TPM1-001", "tpm"], ["EXP-TPM2-002", "tpm"],
  ["BE6K-RAIDCTRLR-M6", "storage-controller"], ["CIT2-MRAID12G-1GB", "storage-controller"], ["MCS-EXT-SCSI=", "storage-controller"],
  ["BE6K-CPU-M6", "cpu"], ["CIT3-CPU-I6240=", "cpu"], ["UC-CPU-E5-2609", "cpu"],
  ["BE7K-RAM", "memory"], ["CIT-8-16-MEM-UPG", "memory"], ["MEM-4460-8G=", "memory"], ["EXP-MR-X16G1RW", "memory"],
  ["BE6K-DISK-M6", "drive"], ["CE-HDD1TI2F212", "drive"], ["CIT3-SD960G6SB-EV", "drive"], ["EXP-M2-240G", "drive"], ["EXP-SD-32G-S", "drive"], ["MCS-EXT-DAT=", "drive"], ["CIT-A03-D300GA2", "drive"],
  ["BE7K-NIC-M6", "nic"], ["EXP-PCIE-ID10GF", "nic"], ["CE-N2XX-AIPCI01", "nic"], ["CIT3-MLOM-40G-04", "nic"],
  ["CIT-PVDM3-32", "voice-module"], ["EM-HDA-6FXO", "voice-module"], ["CIT3-B200-M5", "server"],
  ["CIT3-5108-PKG-HW", "mechanical"], ["CIT3-LSTOR-BK", "mechanical"], ["BE7K-PCIERISER", "accessory"],
  ["BE7H-M6-K9", "server"], ["CTI-CMS-1000-K9", "server"], ["EXPWY-1200-K9", "server"],
  ["CP-BEKEM", "expansion-module"], ["SPA500S", "expansion-module"],
  ["CS-ROOM55D-MON-R", "display"], ["CS-T10-TS-G-K9", "touch-panel"], ["CS-MIC-TABLE-E", "microphone"],
  ["CS-CAM-PTZ4K-IND", "camera"], ["CTS-PHD1080P12XS2", "camera"], ["CTS-MX700800-SPKR-", "speaker"],
  ["HS-WL-730-P", "headset"], ["CP-HS-W-532-USBA=", "headset"],
  ["CS-BOARD70S-K9++", "video-device"], ["CTS-IX5200", "video-device"], ["CS-CODEC-PRO-NR--", "video-codec"],
  ["CTS-SX80-K9", "video-codec"], ["DBS-110-3PC-UK-K9=", "dect-base"], ["CP-8841-3PW-NA-K9", "phone"],
  ["SPA525G2", "phone"], ["VG350-144FXS/K9", "gateway"], ["ATA191-K9", "ata"], ["PVDM3-64=", "voice-module"],
  ["NIM-4FXSP=", "voice-module"],
  // collab-class (12 Sep 2026) — the one real hardware family the fallback residue held.
  ["UNITY-PIMG-MITEL", "gateway"], ["UNITY-PIMG-ANALOG=", "gateway"], ["UNITY-TIMG-1=", "gateway"],
  // end collab-class
];

// [sku, the kind it must NOT take, the kind it must take, why]
const REFUSAL: [string, CollabKind, CollabKind, string][] = [
  ["SPA8000-BR", "accessory", "gateway", "-BR is the BRAZIL region, not a bracket"],
  ["SPA122-BR", "accessory", "ata", "-BR is the BRAZIL region, not a bracket"],
  ["SPA112-RC", "accessory", "ata", "-RC is Remote Configuration, not a rear cover"],
  ["CS-KIT-MINI-NR-K7", "accessory", "video-codec", "KIT is the Room Kit, not a kit of parts"],
  ["CTS-CAM-P60-KIT", "accessory", "camera", "'Precision 60 Camera Kit' is a camera"],
  ["CS-KIT-MINI-MG-K9", "accessory", "video-codec", "MG with no colour letter is the Metal Grille VARIANT of a Room Kit Mini"],
  ["CS-T10-TS-G-K9", "accessory", "touch-panel", "TS is the Room Navigator's table-stand VERSION"],
  ["CS-T10-WM-L-K9", "accessory", "touch-panel", "WM is the Room Navigator's wall-mount VERSION"],
  ["CS-CPRO-ADPT=", "power", "accessory", "a Euroblock connector pack; ADPT without a wattage is not a power adapter"],
  ["CP-7910+SW", "software", "phone", "+SW is the 7910 phone WITH A SWITCH port"],
  ["CP-6851-3PW-AU-K9=", "power", "phone", "3PW = shipped with a power adapter; the phone is the product"],
  // kind-layer (13 Sep 2026): MK9 is an MLB SUBSCRIPTION (item 3 ph.issue.subscription), not a phone — class change planned
  ["CP-8861-3PW-NA-MK9", "phone", "software", "'MLB Subscription - Phone 8861': a device subscription, asked nothing"],
  ["CS-ROOM55-K9", "mechanical", "video-device", "'Room 55 with Navigator and Mount' — the name mentions a mount"],
  ["CS-MIC-CLGP-CBK=", "microphone", "mechanical", "the Ceiling Mic Pro BRACKET kit"],
  ["CS-CAM-RVPTZ-WBKC", "camera", "mechanical", "a wall-only mount for the PTZ camera"],
  ["CS-BARPRO-CAMCOV", "video-codec", "mechanical", "a privacy camera cover for the Room Bar Pro"],
  ["CTS-MX700-D-CAMCV=", "video-device", "mechanical", "a top rear cover for the MX700"],
  ["CS-BRD55P-WUK", "video-device", "mechanical", "a wheel upgrade kit for the Board Pro floor stand"],
  ["CTS-MX200-42FSKL", "video-device", "mechanical", "a floor-stand LID; the marker is glued to the screen size"],
  ["CTS-QSC20-WMK=", "video-codec", "mechanical", "a wall-mount kit for QuickSet C20"],
  ["CS-DESKPRO-MG-C=", "video-device", "mechanical", "'Metal speaker grille' — MG plus a colour letter"],
  ["CS-ROOM55-RC=", "video-device", "mechanical", "'Webex Room 55, Spare Rear Cover'"],
  ["CP-840-DUAL-DCHR=", "phone", "accessory", "a desktop charger for the 840"],
  ["CP-BATT-8821=", "phone", "accessory", "the 8821 battery"],
  ["CP-PWR-DC8821-BZ=", "phone", "power", "the 8821 desktop charger power supply"],
  ["CP-8831-3PD-EU-K9=", "phone", "accessory", "the 8831 daisy-chain KIT"],
  ["WP-9821-SWIVELCLP=", "phone", "mechanical", "a swivel clip for the 9821"],
  ["CP-HS-WL-5ACA=", "headset", "accessory", "an AC adapter spare for the 560 headset base"],
  ["CP-HS-W-USBC", "headset", "cable", "a USB-C headset adapter cable, no model number"],
  ["HS-WL-700-CBLKITC=", "headset", "cable", "the 700-series cable kit"],
  ["HS-WL-720-DSKCH-A=", "headset", "accessory", "the 720 desk charger"],
  ["DP-9800-KEM-WMK=", "expansion-module", "mechanical", "a wall-mount kit FOR a key expansion module"],
  ["CS-MON82-REMOTE=", "display", "accessory", "a Samsung remote control, not a monitor"],
  ["CTS-5K-CBL-DISP=", "display", "cable", "an HDMI-DVI display CABLE"],
  ["VG420-RM-23-2R", "gateway", "accessory", "the VG420 rack-mount kit (RM stays an accessory token; the name path calls it mechanical)"],
  ["VG350-FANASSY=", "gateway", "accessory", "the VG350 fan assembly"],
  ["VG350-SPE150/K9", "gateway", "accessory", "the VG350 motherboard — no UCS component kind, a gateway spare"],
  ["SM-DW-BLANK", "voice-module", "mechanical", "a double-wide service-module blank cover"],
  ["PWR-COVER-4430", "power", "mechanical", "a cover for an empty PSU slot"],
  ["CS-PWR-STRIP4=", "power", "accessory", "a power strip"],
  ["SP-ATLAS-SST-I8S=", "speaker", "mechanical", "a surface-mount enclosure for an Atlas speaker"],
  ["CS-PANO-SWITCH2+", "accessory", "unknown", "a Catalyst C1000 switch sold inside Room Panorama"],
  ["EXPWY-VE-C-K9", "server", "unknown", "Expressway-C VIRTUAL edition"],
  ["CMS1K-SW-2X", "server", "software", "Meeting Server 1000 software preload"],
  ["BE7K-PSU", "cpu", "power", "a server PSU is a supply, not a server part"],
  ["CP-PWR-CORD-XX=", "power", "power-cord", "a phone power cord (a family placeholder, held for the operator)"],
  ["CP-DX-HS=", "video-device", "accessory", "a spare HANDSET, not a DX video phone"],
  ["UNITYCN8-MAXP-HCS", "phone", "unknown", "a licence still classed hardware asks nothing"],
  ["CS-EQX-FAN=", "video-device", "accessory", "the Room Kit EQX fan pack"],
  ["SP-ATLAS-IPS-ZCFP=", "speaker", "mechanical", "a rack-mount kit for the Atlas zone controller"],
  ["CTS-5K-UI-SWITCH", "accessory", "unknown", "a Catalyst 2960C switch inside the IX5000"],
  ["CS-MIC-ARY-CAB11=", "microphone", "cable", "an 11 m replacement cable for Table Mic Pro"],
  ["WP-9821-CAB-MAG=", "phone", "cable", "a magnetic charging cable for the 9821"],
  ["CTS-MX700800-WSBK=", "video-device", "mechanical", "a wall-mount security bracket kit"],
  ["CS-DESK-STYLUSKIT=", "video-device", "accessory", "a stylus kit"],
  ["CS-EQX-FRAME=", "video-device", "mechanical", "a front frame module"],
  ["DP-9811-FS=", "phone", "mechanical", "a replacement footstand"],
  ["CS-CODEC-EQ-RCK", "video-codec", "mechanical", "rack ears for Codec EQ"],
  // kind-layer (13 Sep 2026) — rows III.0 found in the wrong kind (item 3 phone issues, item 6 unknown families)
  ["CTS-LAPCONN-JP", "unknown", "accessory", "'TelePresence Laptop Connectivity - Japan' — a cable kit, was asked nothing"],
  ["SPK-SHARE-K9", "video-device", "accessory", "'Webex Share wireless screen-sharing adapter' — a dongle, not a room device"],
  ["HS-WL-ADPT-USBA=", "headset", "accessory", "'Headset Wireless Bluetooth USB-A HD Adapter', not a headset"],
  ["SPVAC-H450-W-EU=", "phone", "accessory", "'Jabra Handset 450 for Cisco' — a handset, not a phone"],
  ["SP-ATLAS-SEA-I8S=", "speaker", "mechanical", "'Atlas SEA-I8S Angled indoor enclosure'"],
  ["SP-ATLAS-180-2=", "speaker", "mechanical", "'Rail PR for Ceiling Mounting of FEST-I8S'"],
  ["AVIZ-CA750-1-K9", "accessory", "mechanical", "'Avizia ClinicalCart CA750' — a cart"],
  ["CS-WALL-STRUCT+", "accessory", "mechanical", "'Room Panorama Wall Structure'"],
  ["CTS-ST-INT-PLATE=", "unknown", "mechanical", "'Interface plate CAM-P60 to Speaker Track 60'"],
  ["CP-8800-B-BEZEL=", "phone", "mechanical", "'Spare Black Bezel for Cisco IP Phone 8800 Series' (item 3)"],
  ["CP-7800-HS-HOOK=", "accessory", "mechanical", "'Spare Handset Hook ... 20 Pieces' — a hook, not a handset"],
  ["CP-840S-HANDLE=", "phone", "mechanical", "'Cisco 840S Scanner Handle' (item 3)"],
  ["CP-8832-MIC-WLS=", "phone", "microphone", "'8832 Wireless Microphone Kit' (item 3)"],
  ["CP-3905-HS=", "phone", "accessory", "'Spare Handset for Cisco Unified SIP Phone 3905' (item 3)"],
  ["CP-8831-BASE-S-JP", "phone", "accessory", "'Spare Cisco 8831 Base for Japan' (item 3)"],
  ["CP-8832-POE=", "power", "accessory", "'8832 PoE Adapter Spare' — an adapter kit for the phone, not a supply"],
  ["CP-8832-USB-CAB=", "phone", "cable", "'8832 USB-C Cable Spare' (item 3)"],
  ["CTS-5K-SPKR=", "accessory", "speaker", "'CTS-IX5000 Spare Main Speaker' — a speaker, not furniture"],
  ["CP-7914=", "phone", "expansion-module", "'14-button key expansion module' (item 3)"],
  ["SLINK-8744-NA=", "unknown", "phone", "the SpectraLink 8744 wireless handset (7900 series)"],
  ["CP-8865-3PW-NA-MK9", "phone", "software", "'MLB Subscription - Phone 8865' (item 3 subscription)"],
  ["CS-KIT-SUB-K9", "video-codec", "software", "'MLB for Subscription Room Kit' — a subscription, not a codec"],
  ["DOC-MX700-DDC-FSK", "mechanical", "accessory", "'Installation sheet for MX700 dual camera, floor stand kit'"],
  ["CIT3-FI-M-6324", "server", "unknown", "'UCS 6324 In-Chassis FI' — no fabric-interconnect kind on this axis (open decision)"],
  // kind-layer (13 Sep 2026) — the neighbours of the new rules, each what a wider or reordered rule gets wrong
  ["EXP-M2-HWRAID", "drive", "storage-controller", "'Boot optimized M.2 Raid controller' — RAID before the M.2 drive token"],
  ["UC-RAID-9266", "power", "storage-controller", "'MegaRAID 9266-8i + Battery Backup' — was a power supply by its battery"],
  ["EXP-MSTOR-SD", "drive", "accessory", "'Mini Storage Carrier for SD' — a carrier (ucsKind: MSTOR is an accessory), not a drive"],
  ["CIT-PSU-BLKP", "power", "mechanical", "'Power Supply Blanking Panel/Filler'"],
  ["BE6K-START-UWL35", "cpu", "unknown", "START is not a part token either"],
  ["EXP-BZL-C220M5", "server", "mechanical", "a C220 M5 security bezel — BZL, not a server part"],
  ["CIT3-FAN5", "memory", "accessory", "'Fan module for UCS 5108' — FAN, no component kind in collab"],
  ["CE-UCSC-PSU-650W", "cpu", "power", "a VCS appliance PSU: CE- is a part family, PSU is not a part token"],
  ["CIT2-PCI-1B-240M4", "nic", "accessory", "'Right PCIe Riser Board' — PCI then a digit is a riser, PCIE-I is a NIC"],
  ["CIT-E160D-M2BUN/K9", "server", "unknown", "'UCS-E160D-M2/K9 bundled with ISR-G2' — collab has no bundle kind (open decision)"],
  ["CTS-LAPCONN-SK", "mechanical", "accessory", "SK is SLOVAKIA here, not a safety kit"],
  ["CS-BRDP55-SK-AUS=", "mechanical", "accessory", "SK stays an accessory token; the name path reads 'Safety Kit ... Floor Stand'"],
  ["IPT-RM-1S250P", "mechanical", "accessory", "'UC Remote Mgmt Svc' — RM is not a rack mount here (class change planned: service)"],
  ["DOC-MX800-DDC-WMK", "mechanical", "accessory", "an installation SHEET for a wall mount kit, not the kit (class change planned)"],
  ["AVIZ-CA750-ACC-RNC", "mechanical", "accessory", "'Retractable Network Cord' — only the CARTS are mechanical"],
  ["CTS-5K-TBL-PDU", "mechanical", "accessory", "'Power Distribution Unit for Table' — TBL-PDU is not a table top"],
  ["CS-ROOM70-MON-SCV=", "display", "mechanical", "'Sidecover for Room 70 monitor' — the MON token is the host"],
  ["CS-ROOM70D-MON-L=", "mechanical", "display", "'Left Monitor for Room 70 Dual' — a monitor, no SCV"],
  ["SP-ATLAS-IPSEA-SD=", "mechanical", "speaker", "placeholder-named IP twin of an enclosure: only NAMED families moved"],
  ["SP-ATLAS-I8S=", "mechanical", "speaker", "'I8S Indoor IP Speaker' — I8S-TB is the tile bridge, the bare I8S is the speaker"],
  ["CP-8831-MIC-BATT=", "microphone", "accessory", "'Spare Batteries for Wireless Satellite Microphones' — a battery"],
  ["CP-8831-K9", "accessory", "phone", "the 8831 conference phone itself: only -BASE / -DCU / -DC- / -3PB- are its spare parts"],
  ["CP-8865-3PW-NA-K9", "software", "phone", "the phone, beside its -MK9 subscription"],
  ["WP-9821-BATTDOOR=", "accessory", "mechanical", "a battery DOOR, not a battery"],
  ["CP-7916-CN=", "phone", "expansion-module", "'7916 UC phone grayscale extension module'"],
  ["CP-6901-MHS-CG=", "phone", "accessory", "'Charcoal Grey Standard Handset for 6901' — a handset, not the phone"],
  ["CP-8832-ETH=", "phone", "accessory", "'8832 non-PoE Ethernet Adapter Spare'"],
  ["CIT3-B200-M6-CON", "unknown", "server", "'Meeting Server 2000 M6 Control Blade' — a server blade"],
  // collab-class (12 Sep 2026) — the PIMG rule must reach the media gateways and nothing else in
  // a family of 223 SKUs that is otherwise entirely Unity / Unity Connection licences.
  ["UNITY-50-CPL", "gateway", "unknown", "'Unity 5.0 Single User License' — only the PIMG/TIMG media gateways are hardware"],
  ["UNITY-D-70-UWLA", "gateway", "unknown", "'Unity 7.0 for Domino for CUWL Add-on only' — a licence, and PIMG is not a prefix rule"],
  ["UNITYCN7-BUNDLE", "gateway", "unknown", "'Unity Connection 7.x SW plus HW Bundle' ships a server; PIMG needs the hyphen"],
  // Two tokens that were BARE and matched the wrong thing, found by cross-checking product_class
  // against kind rather than by a test: `ST` matched the START of START, and `CUBE` matched the
  // Unified Border ELEMENT. Both anchored; these are the rows that prove the anchors.
  ["BE6K-START-UWL35", "server", "unknown", "'BE6000 Starter Bundle with 35 UWL Standard Licenses' — START is not the ST- server token"],
  ["BE6K-START-UCL200", "server", "unknown", "'BE 6000 - UCL Starter Bundle with 200 Enh + 200 VM Licenses'"],
  ["BE6K-ST-BDL-K9=", "unknown", "server", "'Business Edition 6000M Svr (M3)' — the form that IS the server keeps its kind"],
  ["UPG-CUBE-TS-12TO14", "power", "unknown", "CUBE is the Unified Border Element here, not a power cube"],
  ["MIG-CUBE14-C1-STD", "power", "unknown", "the same — 'Unified Border Element Migrate C1 Std Trunk RTU to V14 Smart'"],
  // end collab-class
];

for (const [sku, want] of POSITIVE) check(`${sku} -> ${want}`, collabKind(sku) === want, collabKind(sku));
for (const [sku, not, want, why] of REFUSAL) {
  const got = collabKind(sku);
  check(`REFUSE ${sku} as ${not} (${why})`, got !== not && got === want, got);
}
check(`at least as many refusals (${REFUSAL.length}) as positives (${POSITIVE.length})`, REFUSAL.length >= POSITIVE.length);

// Totality and the deliberate fallback: an empty or unrecognised SKU is `unknown`, which asks nothing.
check("empty SKU -> unknown", collabKind("") === "unknown");
check("unrecognised SKU -> unknown (the fallback asks LESS)", collabKind("ZZZ-NOT-A-PART") === "unknown");
check("unknown is not an endpoint kind", !COLLAB_ENDPOINT.includes("unknown"));
check("every kind a rule can return is listed in COLLAB_KINDS", COLLAB_RULES.every((r) => COLLAB_KINDS.includes(r.kind)));
check("spare / TAA / customised tails do not change the kind", collabKind("CS-CODEC-PRO-NR--") === collabKind("CS-CODEC-PRO-NR") && collabKind("CS-BOARD70S-K9++") === collabKind("CS-BOARD70S-K9"));
check("lower-case input", collabKind("cp-8841-3pw-na-k9") === "phone");

// SABOTAGE: remove each rule in turn; at least one positive it decides must change kind.
const decidedBy = (sku: string) => COLLAB_RULES.findIndex((r) => r.re.test(sku.trim().toUpperCase().replace(/[=+]+$/, "").replace(/-+$/, "")));
COLLAB_RULES.forEach((rule, i) => {
  const mine = [...POSITIVE, ...REFUSAL.map(([s, , w]) => [s, w] as [string, CollabKind])].filter(([sku]) => decidedBy(sku) === i);
  const without = COLLAB_RULES.filter((_, j) => j !== i);
  const flipped = mine.filter(([sku, want]) => collabKind(sku, without) !== want);
  check(`SABOTAGE rule #${i} (${rule.kind}) removed: ${flipped.length} of ${mine.length} of its cases go red`, mine.length > 0 && flipped.length > 0,
    mine.length ? mine.map(([s]) => s).slice(0, 3) : "no case exercises this rule");
});

// Registration: the three categories dispatch to this axis, and partKind no longer hands two of them componentKind.
for (const c of COLLAB_CATEGORIES) {
  check(`${c} is a KIND_CATEGORY`, KIND_CATEGORIES.includes(c));
  check(`partKind(${c}) uses collabKind`, partKind(c, "CP-8841-3PW-NA-K9") === "phone" && partKind(c, "CAB-PWR-C7-BRA-A") === "power-cord");
}
// 12 Sep 2026: this asserted "routers still uses componentKind (untouched)" and was written the same day routers
// gained routerKind, where that cord IS a power-cord. What it was really guarding is that this axis does not leak
// into a category it does not own — asserted against a phone SKU no other axis would call a phone.
check("the collaboration axis does not reach routers", partKind("routers", "CP-8841-3PW-NA-K9") !== "phone");

// ---- kind-layer (13 Sep 2026): the cup sets, per kind and per PHONE ROLE (the spec v2 proposal) -------------------------
// Operator, 13 Sep: the parent measures "printed on the page" centrally and demotes after merge. So nothing required today
// is demoted, each kind's spec I.4 archetype cups are added, and the phone's wireless role gets wifi_generation. These
// assertions pin that shape so the parent's measured demotions show up as a diff.
{
  const req = (cat: string, kind: string, role?: string) => kindQuestionSet(cat, kind, role).required.join(",");
  const CE = "collaboration-endpoints";
  const PHONE_CORE = "audio_codecs,certifications,dimensions,display,humidity_operating,poe_standard,ports,power_max,supported_protocols,temp_operating,temp_storage,ui_languages,voice_lines,weight";
  check("phone core (unresolved role) keeps today's fourteen", req(CE, "phone") === PHONE_CORE, req(CE, "phone"));
  for (const role of ["desk", "dect", "conference"]) check(`phone role ${role} adds nothing (no spec delta)`, req(CE, "phone", role) === PHONE_CORE, req(CE, "phone", role));
  check("wireless phone: + wifi_generation (spec I.4 PHONE gate)", req(CE, "phone", "wireless") === `${PHONE_CORE},wifi_generation`, req(CE, "phone", "wireless"));
  check("desk phone: wifi_generation is OPTIONAL, never n/a (rule 7)", kindQuestionSet(CE, "phone", "desk").optional.includes("wifi_generation"));
  check("the role witnesses derive their roles", deployRole(CE, "phone", "CP-7841-K9", "Cisco IP Phone 7841") === "desk" && deployRole(CE, "phone", "CP-8821-K9", "8821") === "wireless" && deployRole(CE, "phone", "CP-8832-K9", "IP Conference Phone 8832") === "conference");
  const WANT: Record<string, string> = {
    power: "airflow,input_voltage,product_compatibility,psu_rated_output",
    cpu: "clock_speed,cpu_cache,cpu_cores,memory_speed_max,product_compatibility,tdp",
    memory: "dram,memory_speed_max,product_compatibility",
    drive: "drive_form_factor,drive_interface,product_compatibility,storage_capacity",
    nic: "data_rate,ports,product_compatibility",
    "storage-controller": "drive_interface,product_compatibility",
    tpm: "product_compatibility",
    "power-cord": "cable_length,product_compatibility",
    cable: "cable_length,product_compatibility",
    mechanical: "mounting,product_compatibility",
    headset: "certifications,dimensions,humidity_operating,mic_type,temp_operating,temp_storage,weight",
    "expansion-module": "certifications,dimensions,humidity_operating,product_compatibility,temp_operating,temp_storage,weight",
    microphone: "certifications,dimensions,humidity_operating,mic_type,product_compatibility,temp_operating,temp_storage,weight",
    speaker: "certifications,dimensions,humidity_operating,power_max,product_compatibility,temp_operating,temp_storage,weight",
    display: "certifications,dimensions,display,humidity_operating,max_resolution,mounting,power_max,temp_operating,temp_storage,weight",
    "touch-panel": "certifications,dimensions,display,humidity_operating,max_resolution,poe_standard,power_max,product_compatibility,temp_operating,temp_storage,weight",
    "dect-base": "certifications,dimensions,humidity_operating,poe_standard,ports,power_max,product_compatibility,supported_protocols,temp_operating,temp_storage,weight",
    server: "certifications,cpu_sockets_max,dimensions,dimm_slots,drive_bays,form_factor,humidity_operating,memory_max,memory_speed_max,pcie_slots,power_max,temp_operating,temp_storage,weight",
  };
  for (const [k, want] of Object.entries(WANT)) check(`collab \`${k}\` asks the spec archetype set`, req(CE, k) === want, req(CE, k));
  for (const k of ["cpu", "memory", "drive", "nic"]) {
    const ucs = new Set(kindQuestionSet("servers-unified-computing", k).required);
    check(`collab \`${k}\` asks at least what a UCS \`${k}\` asks (rule 3)`, [...ucs].every((key) => kindQuestionSet(CE, k).required.includes(key)), [...ucs].filter((key) => !kindQuestionSet(CE, k).required.includes(key)));
  }
  for (const cat of ["unified-communications", "conferencing"]) {
    const differs = [...new Set([...LEDGER_KINDS[CE], ...LEDGER_KINDS[cat]])].filter((k) => req(CE, k) !== req(cat, k) || req(CE, k, "wireless") !== req(cat, k, "wireless"));
    check(`${cat} asks every kind (and phone role) exactly what ${CE} asks`, differs.length === 0, differs);
  }
  check("no collab kind is named power-supply or server-component any more", !LEDGER_KINDS[CE].some((k) => k === "power-supply" || k === "server-component"));
  // SABOTAGE on the role gate: patch the live profile, re-ask, restore.
  const patched = (key: string, r: Requirement, fn: () => void) => {
    const p = PROFILES[CE] as Record<string, Requirement>;
    const was = p[key]; p[key] = r;
    try { fn(); } finally { p[key] = was; }
  };
  patched("wifi_generation", { kind: "cond", when: { field: "kind", inList: ["phone"] }, elseOpt: true }, () => {
    check("SABOTAGE wifi_generation without its role clause: a desk phone is asked it (caught)", req(CE, "phone", "desk") !== PHONE_CORE);
  });
  patched("wifi_generation", { kind: "cond", when: { all: [{ field: "kind", inList: ["phone"] }, { field: "deploy_role", inList: ["dect"] }] }, elseOpt: true }, () => {
    check("SABOTAGE wifi_generation gated on the wrong role: the wireless phone loses it (caught)", req(CE, "phone", "wireless") === PHONE_CORE);
  });
  patched("psu_rated_output", { kind: "cond", when: { field: "kind", inList: ["power-supply"] } }, () => {
    check("SABOTAGE a profile still naming `power-supply`: the renamed `power` loses its rated output (caught)", !req(CE, "power").includes("psu_rated_output"));
  });
  check("control: the restored profile asks a wireless phone for wifi_generation", requirementFor(CE, "wifi_generation", { kind: "phone", deploy_role: "wireless" }) === "req");
}

console.log(`\ncollabKind: ${pass} passed, ${misses.length} missed`);
if (misses.length) process.exit(1);
