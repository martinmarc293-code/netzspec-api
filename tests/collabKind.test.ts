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
  ["CTS-5K-HOSTCPU", "server-component"], ["CTS-5K-LC-SWITCH", "unknown"], ["SP-ATLAS-IPDC=", "unknown"],
  ["SP-ATLAS-FST-DC=", "accessory"], ["CTS-5K-LEGS-BACK", "accessory"], ["CS-BOARD55-WMK", "accessory"],
  ["CTS-MX800-D-LGR=", "accessory"], ["WP-9821-DCHGR+PWR", "accessory"], ["BRKT-P40-MONITR", "accessory"],
  ["PWRCLIP-UK=", "accessory"], ["ACC-MX200-42-KIT", "accessory"],
  ["CP-PWR-CUBE-5", "power-supply"], ["POE-WW", "power-supply"], ["EXP-PSU1-1200W", "power-supply"],
  ["BE7K-CPU", "server-component"], ["CIT2-MR-1X161RV-A", "server-component"],
  ["BE7H-M6-K9", "server"], ["CTI-CMS-1000-K9", "server"], ["EXPWY-1200-K9", "server"],
  ["CP-BEKEM", "expansion-module"], ["SPA500S", "expansion-module"],
  ["CS-ROOM55D-MON-R", "display"], ["CS-T10-TS-G-K9", "touch-panel"], ["CS-MIC-TABLE-E", "microphone"],
  ["CS-CAM-PTZ4K-IND", "camera"], ["CTS-PHD1080P12XS2", "camera"], ["CTS-MX700800-SPKR-", "speaker"],
  ["HS-WL-730-P", "headset"], ["CP-HS-W-532-USBA=", "headset"],
  ["CS-BOARD70S-K9++", "video-device"], ["CTS-IX5200", "video-device"], ["CS-CODEC-PRO-NR--", "video-codec"],
  ["CTS-SX80-K9", "video-codec"], ["DBS-110-3PC-UK-K9=", "dect-base"], ["CP-8841-3PW-NA-K9", "phone"],
  ["SPA525G2", "phone"], ["VG350-144FXS/K9", "gateway"], ["ATA191-K9", "ata"], ["PVDM3-64=", "voice-module"],
  ["NIM-4FXSP=", "voice-module"],
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
  ["CS-CPRO-ADPT=", "power-supply", "accessory", "a Euroblock connector pack; ADPT without a wattage is not a power adapter"],
  ["CP-7910+SW", "software", "phone", "+SW is the 7910 phone WITH A SWITCH port"],
  ["CP-6851-3PW-AU-K9=", "power-supply", "phone", "3PW = shipped with a power adapter; the phone is the product"],
  ["CP-8861-3PW-NA-MK9", "power-supply", "phone", "a phone under a device subscription"],
  ["CS-ROOM55-K9", "accessory", "video-device", "'Room 55 with Navigator and Mount' — the name mentions a mount"],
  ["CS-MIC-CLGP-CBK=", "microphone", "accessory", "the Ceiling Mic Pro BRACKET kit"],
  ["CS-CAM-RVPTZ-WBKC", "camera", "accessory", "a wall-only mount for the PTZ camera"],
  ["CS-BARPRO-CAMCOV", "video-codec", "accessory", "a privacy camera cover for the Room Bar Pro"],
  ["CTS-MX700-D-CAMCV=", "video-device", "accessory", "a top rear cover for the MX700"],
  ["CS-BRD55P-WUK", "video-device", "accessory", "a wheel upgrade kit for the Board Pro floor stand"],
  ["CTS-MX200-42FSKL", "video-device", "accessory", "a floor-stand LID; the marker is glued to the screen size"],
  ["CTS-QSC20-WMK=", "video-codec", "accessory", "a wall-mount kit for QuickSet C20"],
  ["CS-DESKPRO-MG-C=", "video-device", "accessory", "'Metal speaker grille' — MG plus a colour letter"],
  ["CS-ROOM55-RC=", "video-device", "accessory", "'Webex Room 55, Spare Rear Cover'"],
  ["CP-840-DUAL-DCHR=", "phone", "accessory", "a desktop charger for the 840"],
  ["CP-BATT-8821=", "phone", "accessory", "the 8821 battery"],
  ["CP-PWR-DC8821-BZ=", "phone", "power-supply", "the 8821 desktop charger power supply"],
  ["CP-8831-3PD-EU-K9=", "phone", "accessory", "the 8831 daisy-chain KIT"],
  ["WP-9821-SWIVELCLP=", "phone", "accessory", "a swivel clip for the 9821"],
  ["CP-HS-WL-5ACA=", "headset", "accessory", "an AC adapter spare for the 560 headset base"],
  ["CP-HS-W-USBC", "headset", "cable", "a USB-C headset adapter cable, no model number"],
  ["HS-WL-700-CBLKITC=", "headset", "cable", "the 700-series cable kit"],
  ["HS-WL-720-DSKCH-A=", "headset", "accessory", "the 720 desk charger"],
  ["DP-9800-KEM-WMK=", "expansion-module", "accessory", "a wall-mount kit FOR a key expansion module"],
  ["CS-MON82-REMOTE=", "display", "accessory", "a Samsung remote control, not a monitor"],
  ["CTS-5K-CBL-DISP=", "display", "cable", "an HDMI-DVI display CABLE"],
  ["VG420-RM-23-2R", "gateway", "accessory", "the VG420 rack-mount kit"],
  ["VG350-FANASSY=", "gateway", "accessory", "the VG350 fan assembly"],
  ["VG350-SPE150/K9", "gateway", "server-component", "the VG350 motherboard"],
  ["SM-DW-BLANK", "voice-module", "accessory", "a double-wide service-module blank cover"],
  ["PWR-COVER-4430", "power-supply", "accessory", "a cover for an empty PSU slot"],
  ["CS-PWR-STRIP4=", "power-supply", "accessory", "a power strip"],
  ["SP-ATLAS-SST-I8S=", "speaker", "accessory", "a surface-mount enclosure for an Atlas speaker"],
  ["CS-PANO-SWITCH2+", "accessory", "unknown", "a Catalyst C1000 switch sold inside Room Panorama"],
  ["EXPWY-VE-C-K9", "server", "unknown", "Expressway-C VIRTUAL edition"],
  ["CMS1K-SW-2X", "server", "software", "Meeting Server 1000 software preload"],
  ["BE7K-PSU", "server-component", "power-supply", "a server PSU is asked a rated output"],
  ["CP-PWR-CORD-XX=", "power-supply", "power-cord", "a phone power cord (a family placeholder, held for the operator)"],
  ["CP-DX-HS=", "video-device", "accessory", "a spare HANDSET, not a DX video phone"],
  ["UNITYCN8-MAXP-HCS", "phone", "unknown", "a licence still classed hardware asks nothing"],
  ["CS-EQX-FAN=", "video-device", "accessory", "the Room Kit EQX fan pack"],
  ["SP-ATLAS-IPS-ZCFP=", "speaker", "accessory", "a rack-mount kit for the Atlas zone controller"],
  ["CTS-5K-UI-SWITCH", "accessory", "unknown", "a Catalyst 2960C switch inside the IX5000"],
  ["CS-MIC-ARY-CAB11=", "microphone", "cable", "an 11 m replacement cable for Table Mic Pro"],
  ["WP-9821-CAB-MAG=", "phone", "cable", "a magnetic charging cable for the 9821"],
  ["CTS-MX700800-WSBK=", "video-device", "accessory", "a wall-mount security bracket kit"],
  ["CS-DESK-STYLUSKIT=", "video-device", "accessory", "a stylus kit"],
  ["CS-EQX-FRAME=", "video-device", "accessory", "a front frame module"],
  ["DP-9811-FS=", "phone", "accessory", "a replacement footstand"],
  ["CS-CODEC-EQ-RCK", "video-codec", "accessory", "rack ears for Codec EQ"],
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

console.log(`\ncollabKind: ${pass} passed, ${misses.length} missed`);
if (misses.length) process.exit(1);
