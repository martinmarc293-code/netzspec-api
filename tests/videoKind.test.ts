// tests/videoKind.test.ts — the `video` kind axis (src/core/videoKind.ts), 12 Sep 2026.
//
// Every SKU below is a real Cisco part in the `video` category, its kind read against its catalogue NAME
// (quoted). The REFUSALS outnumber the positives on purpose: each is a SKU whose token looks like another kind
// and is not — the traps the header records. Then one SABOTAGE per rule family: disable the family and its
// positives must go red, or the family has never been seen to work.
import { videoKind, VIDEO_KINDS, type VideoKind } from "../src/core/videoKind.js";
import { partKind } from "../src/core/partKind.js";

let passed = 0, failed = 0;
const out: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++; else { failed++; out.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};

// [sku, kind, the name that decides it]
const POSITIVE: [string, VideoKind, string][] = [
  ["SCBR8-UK9-173", "software", "Cisco CBR8 IOS XE UNIVERSAL"],
  ["G5A2AA101D1AXXXA3X", "node", "GS7000, 4x, TPs, Fb/Tr, 42/54, 8p, SA, Rx, ... ITU20"],
  ["G5A8AA101D1+XXXB3X", "node", "GS7000, 4x, TPs, ... A-DWDM, ITU56, 2PS, DOC (channel letter '+')"],
  ["GS7KS411L11XXXXXXX", "node", "GS7K 1.2GHz, 4, 1PS, LIRX, 1x4FCM, 4x1RCM, TPA, STDFBRTRY"],
  ["HB1XX1XXXXXXXXXXBA", "node", "GS7000 Opt Hub, Lg F/T, 17dBm BC/17dBmLG NC EDFA, No Sw, 2PS, LCM"],
  ["GS7KIH4XXXX", "node", "GS7K 1.2GHz iNode, 42/54, 1PS, No Rx"],
  ["P2HD-FAN-ASSY=", "fan", "P2 HD replacement fan assembly for P2-XD chassis"],
  ["HA-RPHY-FAN-TRAY", "fan", "Fan Tray for Remote PHY Shelf 7200"],
  ["CBR-LC-PACKAGING", "accessory", "Robust multi-use packaging for cBR-8 Line Card"],
  ["RFGW-SUP-COVER2", "accessory", "RFGW Supervisor Slot Cover v2"],
  ["GS7K-HSG-1.2G", "accessory", "GS7000 1.2 GHz Housing with OIB"],
  ["CAB-RFGW-SURGE", "cable", "Ten quad-shield RF cables in UCH-2, RFGW to HFC, Surge, 3m"],
  ["RFGW1-AC-CORD-A", "cable", "RFGW-1 ARGENTINA AC POWER CORD SPARE"],
  ["JMPR-SSB-1.6-S-SA-SA-001", "cable", "SCA-SCA Jumper Cable, bend-insensitive, 1 meter"],
  ["GS7K-PS", "power", "GS7000 POWER SUPPLY"],
  ["CBR-PEM-AC-6M", "power", "AC power input module (the facility connectivity part)"],
  ["HA-RPHY-AC-SHLF", "power", "AC Power Shelf for Remote PHY Shelf 7200"],
  ["CHAS-RFGW-1", "chassis", "RFGW-1 CHASSIS INCLUDING FPD, FAN AND IO MODULE"],
  ["P2-CH-F-F-28-F-AAS", "chassis", "(P2-CH-F-F-28-F-AAS) Chassis, Frt Acc"],
  ["CBR-8-CCAP-CHASS", "chassis", "Cisco cBR-8 Series CCAP Router Chassis"],
  ["RFGW1A6AAUF08BB000", "system", "RFGW-1, 6/QAM Cards, Data Octal, ..., 2/AC, US"],
  ["RPHYSHLF_3X6AC=", "system", "Smart PHY 300 Shelf pre-Configured System, 3 1x2 RPD, 2AC Supplies"],
  ["RPD-1X2=", "system", "Smart PHY 120 RPD with SCTE 55-1 OOB"],
  ["GS7K-FCM-1.2G-14", "plug-in", "GS7K 1.2 GHz FWD Config Mod, 1x4"],
  ["GS7K-1.2G-DC12-26=", "plug-in", "GS7000 12 dB Directional Coupler 2/6 1.2 GHz (QTY=10)"],
  ["GM-PAD-1.2G-10.0=", "plug-in", "GainMaker 1.2 GHz pad, 10 dB (bare in the catalogue)"],
  ["P2HD1.2G13TXP04=", "transmitter", "P2 HD 1310 nm Tx, Premium, 4 dBm, SC/APC"],
  ["P2-15TXM-08-EM-IWDM-SA-ITU21-1WD", "transmitter", "1550 iWDM multiwavelength Tx, ITU21"],
  ["GS7K-TXAH-1470SA", "transmitter", "GS7000 HI GAIN CWDM TX 1470SCA"],
  ["4022938.26", "transmitter", "GS7000 DWDM Tx, 1556.55nm, ITU26, SA — the suffix is the ITU channel"],
  ["4013900.1470", "transmitter", "'3 dBm, CWDM High Gain, 1470 nm' — Part Number on Module (c78-732306)"],
  ["4042869.17", "transmitter", "'EDR 1:1 TX OPM DWDM-17' — ordering table of the GS7000 HO node sheet"],
  ["10-1022072-01", "optic", "Part Number of OPM for 'EDR 1:1 Tx OPM CWDM-1270'"],
  ["RPHY-S10G-20K-200=", "optic", "Remote PHY 10G SFP+, 20 km"],
  ["GS7K-1.2G-LIRX", "receiver", "GS7000 1.2 GHz Low Input Optical Receiver, SCA"],
  ["P2-HD-RXR-SA", "receiver", "(P2-HD-RXR-SA) HD Dual Rev Rx, 5-42MHz, Std, SA"],
  ["P2-HD-EDFA-20-SA", "amplifier", "+20 dBm EDFA"],
  ["GS7K-GFEDFA-17H=", "amplifier", "GS7000 EDFA, 8+ Ch. Gain Flattened High Gain, 17dBm, SA"],
  ["GS7K-LA-4052", "rf-amplifier", "GS7000 LNCH AMP,1W,40/52"],
  ["GS7KI-LA-1.2-0458", "rf-amplifier", "GS7K iNode Launch Amp 1.2 GHz 204/258 MHz"],
  ["OPLGX-MD16-2162-LA", "passive", "16 CH-IWDM 21—62 DTP-LC/APC"],
  ["DCM-20-LL-SA", "passive", "(DCM-20-LL-SA) Low Insertion Loss DCF, 20km, SA"],
  ["CBR-LC-8D31-16U31", "line-card", "cBR CCAP line card includes 2 DS D3.1 modules as well as 1 US D3.1 Module"],
  ["RFGW-DS384", "line-card", "RFGW DS384 Universal Downstream EQAM Card; Base HW"],
  ["HA-RPHY-6X12-LC", "line-card", "RPD Line Card for Remote PHY Shelf 7200"],
];

// Each refusal is a real SKU whose token belongs to another kind's rule; the kind it must get instead.
const REFUSAL: [string, VideoKind, string][] = [
  ["4036796.1610", "unknown", "'Assy, Kit, DPON EU ONT, 1610' — an ONT; its wavelength suffix names no Tx family"],
  ["4036319.1610", "unknown", "'Assy, Kit, DPON NA ONT, 1610'"],
  ["4003219.00", "unknown", "'Node 2:1 bdr ... UPG Kit' — suffix 00 is no ITU channel and the base is not a Tx family"],
  ["GS7K-OIB-4RX-2TX", "plug-in", "'GS7000 OIB,4RX/2TX' — an interface board, not a transmitter"],
  ["GS7K-OIB-4RX-4TX", "plug-in", "'GS7000 OIB,4RX/4TX'"],
  ["CBR-CABLE-UCH8", "accessory", "'CBR coaxial cable Universal Cable Holder' — a holder, not a cable"],
  ["HA-RPHY-CBLMG-KIT", "accessory", "'Rear cable management kit' — not a cable"],
  ["CBR-PS-BLANK", "accessory", "'Power Supply Blanks' — not a supply"],
  ["CBR-PS-COVER=", "accessory", "'Bezel for the cBR8 Power Supply'"],
  ["HA-RPHY-PS-BLANK", "accessory", "'Blanks for the Power Supply Slots for HA shelf'"],
  ["GS7K-SHO-LID-PS=", "accessory", "'Housing Lid with SHO OIB and Power Supply' — a lid"],
  ["CBR-AC-PWR-TRAY", "accessory", "'Mechanical assembly - AC Power Supplies installed here' — a tray"],
  ["RPHYSHLF_6X12AC=", "system", "'Shelf pre-Configured System, 6 1x2 RPD, 2AC Supplies' — a shelf, not a supply"],
  ["GS7K-HSG-1.2G-4X4", "accessory", "'Housing with OIB, Dual RF Cables' — a housing, not a node or a cable"],
  ["GS7K-HSG-6P", "node", "'GS7000 NODE, ANALOG 6P' — the housing sold as a node"],
  ["CBR-CHASSI-HANDLE", "accessory", "'CBR handle ... lifts a chassis onto a rack' — not a chassis"],
  ["CBR-SUP-BLANK", "accessory", "'Blank for an empty Supervisor Slot' — not a supervisor"],
  ["CBR-LC-PIC-BLANK", "accessory", "'Blank for the cBR LC PIC slot' — not a line card"],
  ["RFGW-LC-COVER", "accessory", "'RFGW Line Card Cover' — not a line card"],
  ["P2-XDP-1RU-ACPS=", "power", "'Replaceable AC Power Supply for XFP 1RU Chassis' — a supply, not the chassis"],
  ["P2-HM-XFP=", "unknown", "'XD Host Module for XFP-RF Transmitter' — a host module, not a transmitter"],
  ["P2-HD-EDR-SA=", "unknown", "'Prisma II EDR Host Module with 2:1 Tx' — a host module"],
  ["GS7K-RCM-1.2G-42A", "plug-in", "'Reverse Config Mod, 4x2, TX 1, 2' — the name says TX, the part is a config module"],
  ["GS7K-SHO-LA204258", "rf-amplifier", "'SHO Launch Amp 1.2 GHz 204/258 MHz' — SHO- before LA"],
  ["GS7K-LCM=", "plug-in", "'GS7000 LCM, HUB NODE/OPT HUB' — a local control module, not a node"],
  ["GS7K-SD-1.2G-JMP", "plug-in", "'Signal Director Jumper' — a plug-in, not a cable"],
  ["JMPR-12S-3-P-MA-SA-F9-001", "cable", "'MPO to SC/APC Fan-out Jumper Cable' — 'Fan-out' is not a fan"],
  ["HA-RPHY-CHASSIS=", "chassis", "'Cisco Remote PHY Shelf 7200 Chassis, spare'"],
  ["CBR-4LC-BUN", "system", "'CBR System Bundle, 4 Line Cards, 2 Supervisors, Fan Assembly' — not a fan, not a card"],
  ["RFGW-10-108HA", "system", "'RFGW-10 System Bundle inc 2SUP, 2TCC, 2DCPEM, 10DS48' — not a chassis"],
  ["4008427", "unknown", "'(P2-HD-13TXF-10-SA) 1310HD Fwd Tx' — a Tx by NAME, but a bare singleton base: asked less"],
  ["1030007", "unknown", "'LGX-MXDX-4CH-iWDM ...' — a passive by name, bare number"],
  ["INODEMGR-STD-NOD", "unknown", "'Intelligent Node Mgr - Standard RTU SW License' — not a node (a licence)"],
  ["GS7000", "unknown", "'Cisco GS7000' — the family name, not a configured node"],
  ["DB-9", "unknown", "'Cisco DB-9'"],
  ["P2-OPSW-18X9-MPO=", "unknown", "'Prisma 2 18x9 Optical Switch' — no kind of its own"],
  ["CBR-8", "unknown", "'Container (Top Level) PID for configuring the cBR-8 System'"],
  ["HA-RPHY", "unknown", "'Container (Top Level) PID for configuring the RPHY HA shelf'"],
  ["", "unknown", "empty SKU"],
  ["ITU20", "unknown", "'Cisco ITU20' — a channel name, not a part"],
  ["E2000/APC", "unknown", "'Cisco E2000/APC' — a connector type name"],
  ["SWLIC-DS384", "unknown", "'QAM DS-384 License' — a licence, kept off every hardware kind"],
  ["RFGW-1-RMU", "unknown", "'RF Gateway 1 Remote Management Utility' — software"],
  ["DS384-10X64UPGRADE", "unknown", "'RFGW-10 DS384 Upgrade Bundle: 2SUP, 10DS384, 10x64 QAM License'"],
  ["BUNDLE1-3G60-DS384", "unknown", "'Bundle: qty6 3G60(2G24) and qty7 DS384 7x64 QAM plus Commons'"],
  ["1545-1548", "unknown", "'Cisco 1545-1548' — a wavelength span, no evidence of what it is"],
];

for (const [sku, kind, why] of POSITIVE) check(`${sku} is ${kind} (${why})`, videoKind(sku) === kind, `got ${videoKind(sku)}`);
for (const [sku, kind, why] of REFUSAL) check(`REFUSE ${sku || "(empty)"} -> ${kind} (${why})`, videoKind(sku) === kind, `got ${videoKind(sku)}`);
check("refusals outnumber positives", REFUSAL.length >= POSITIVE.length, `${REFUSAL.length} vs ${POSITIVE.length}`);

// Totality and the dispatch: every kind the function can return is one the ledger lists, and partKind routes here.
check("partKind('video', ...) dispatches to videoKind", partKind("video", "GS7K-TXAH-1470SA") === "transmitter");
check("partKind('video', ...) never falls through to the shared axis", partKind("video", "RFGW1-AC-CORD-A") === "cable");
for (const [sku] of [...POSITIVE, ...REFUSAL]) check(`${sku}: kind is a listed kind`, VIDEO_KINDS.includes(videoKind(sku)));

// SABOTAGE, one per rule family: with the family switched off, every one of its positive cases must go red.
const families = [...new Set(POSITIVE.map(([, k]) => k))];
for (const fam of families) {
  const off = new Set<VideoKind>([fam]);
  const own = POSITIVE.filter(([, k]) => k === fam);
  const stillRight = own.filter(([sku]) => videoKind(sku, off) === fam);
  check(`SABOTAGE ${fam}: disabling the family turns all ${own.length} of its cases red`, stillRight.length === 0,
    `still ${fam}: ${stillRight.map(([s]) => s).join(", ")}`);
}
// And the ORDER is load-bearing: with accessory off, the holder/blank refusals fall into the kinds they were
// protected from — if they did not, the refusal would be testing nothing.
const noAcc = new Set<VideoKind>(["accessory"]);
check("SABOTAGE order: without accessory, CBR-CABLE-UCH8 reads as a cable", videoKind("CBR-CABLE-UCH8", noAcc) === "cable");
check("SABOTAGE order: without accessory, CBR-PS-BLANK reads as power", videoKind("CBR-PS-BLANK", noAcc) === "power");
check("SABOTAGE order: without plug-in, GS7K-OIB-4RX-2TX is still NOT a transmitter", videoKind("GS7K-OIB-4RX-2TX", new Set(["plug-in"])) !== "transmitter");

out.unshift(`    video kind: ${passed} passed, ${failed} missed (${POSITIVE.length} positives, ${REFUSAL.length} refusals, ${families.length} sabotaged families)`);
console.log(out.join("\n"));
if (failed) process.exit(1);
