// tests/opticalKind.test.ts — what an optical-networking part IS, from its SKU (optical-storage, 12 Sep 2026).
//
// `kind` decides whether a part is asked a gain, a channel count, slots or a wavelength. A wrong kind puts it
// behind the wrong questions, so, as in switchKind.test.ts and opticKind.test.ts, THE HALF THAT MATTERS IS THE
// REFUSALS: a patch cord whose SC segment reads as a splitter, a muxponder whose PID starts like a software
// media kit, an interface module ending in -PS that is not a power supply, a shelf for passive modules that
// carries their BRK token. There are at least as many refusals as positives, and every rule family has a
// SABOTAGE case: the family is removed from the table and a case it decides must change answer.
//
// Every SKU comes from the catalogue (optical-networking hardware, read by name 12 Sep 2026). None is invented.
import { opticalKind, opticalKindWith, opticalKindRule, OPTICAL_KIND_RULES, OPTICAL_KINDS,
  OPN_PLUGGABLE, OPN_FIXED_WAVELENGTH, OPN_POWERED } from "../src/core/opticalKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, string][] = [
  ["15454-M6-SA", "chassis"], ["NCS4009-SA-DC", "chassis"], ["NCS1004=", "chassis"], ["NCS2015-SYS-AC", "chassis"],
  // kind-layer (13 Sep 2026): the transponder split — these four were `linecard`.
  ["15454-M-100G-LC-C", "transponder"], ["NCS2K-400G-XP=", "transponder"], ["NCS1K4-1.2T-L-K9=", "transponder"], ["NCS4200-48T1E1-CE=", "linecard"],
  ["CH29/M/U/SC/15200", "transponder"],
  ["15454-10E-L1-C=", "transponder"], ["15454-40E-MXP-C=", "transponder"], ["NCS1K4-QXP-K9=", "transponder"], ["CIM8-C-K9=", "transponder"],
  ["NCS2K-100G-CK-C", "transponder"], ["CO-40TDL40-X1001=", "transponder"], ["NCS4K-2H-W", "transponder"], ["NCS1K14-2.4T-K9=", "transponder"],
  ["15454-M-10X10G-LC=", "linecard"], ["NCS4K-20T-O-S", "linecard"],
  // kind-layer (13 Sep 2026): the 14 CWDM mux / OADM plug-ins III.0 item 6 found in transceiver.accessory must land on `mux`
  // if their row move runs; witnesses for the three SKU shapes (spaced, channel-glued, add/drop).
  ["CWDM-MUX-4-SF2=", "mux"], ["DS-CWDM-MUX8A=", "mux"], ["CWDM-MUX8A=", "mux"], ["CWDM-MUX-AD-1510=", "mux"],
  ["NCS2K-TNCS-K9", "controller"], ["NCS4K-RP=", "controller"], ["NCS1K-OTDR=", "controller"],
  ["NCS4009-FC-S", "fabric"], ["NCS4KF-FC2-C=", "fabric"],
  ["15454-OPT-EDFA-24=", "amplifier"], ["NCS2K-EDRA1-35C", "amplifier"], ["NCS1K-ILA-C=", "amplifier"],
  ["15454-40-SMR2-C=", "roadm"], ["15454-80-WXC-C=", "roadm"], ["15454-40-WSS-CE=", "roadm"],
  ["15216-MD-40-EVEN", "mux"], ["15216-AD2-2A-32.6=", "mux"], ["15216-OADM1-35", "mux"], ["NCS1K-BRK-16=", "mux"], ["NP/90/15252", "mux"],
  ["15216-DCU-L-1000=", "dcu"], ["15216-FBGDCU-992=", "dcu"], ["15454-TDC-CC=", "dcu"],
  ["ONS-SC+-10G-46.9=", "pluggable"], ["ONS-XC-10G-40.5=", "pluggable"], ["ONS-CC-100GE-LR4=", "pluggable"],
  ["ONS-CFP2-WDM=", "pluggable-tunable"], ["DP04CFP2-M25-K9=", "pluggable-tunable"],
  ["ONS-SE-100-BX10D=", "pluggable-bidi"],
  ["NCS2006-AC=", "power"], ["NCS4K-DC-PEM", "power"], ["NCS1K-2KW-AC", "power"],
  ["NCS2002-FTA=", "fan"], ["NCS1K-FAN", "fan"],
  ["15216-LC-LC-20", "cable"], ["ONS-16MPO-MPO-6=", "cable"], ["NCS4K-AC-CBL-IEC=", "cable"],
  ["NCS4009-DOOR=", "accessory"], ["15454-BLANK=", "accessory"], ["NCS4K-SSD-200G=", "accessory"],
  ["SF15454M-R1001K9", "software"], ["XR-NCS4K-612K9", "software"],
  ["15454W-2X100G-SK", "unknown"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, opticalKind(sku), want);

// --- REFUSALS: each one is what a slightly wider or differently ordered rule would get wrong ------------------
const REFUSALS: [string, string, string][] = [
  ["NCS4200-8T-PS", "linecard", "a bare -PS segment is not a supply: an NCS 4200 8-port 10GE interface module"],
  ["NCS4200-1T16G-PS", "linecard", "same, a combo interface module"],
  ["NCS2006-CAB-DEFL=", "accessory", "an air DEFLECTOR, not a cable, although it carries CAB"],
  ["15454-M6-PWRFLR=", "accessory", "'power filter FILLER card' — a filler, not a supply"],
  ["A900-PWR-BLANK", "accessory", "a power-supply blank cover"],
  ["NCS4216-PWR-FAN", "fan", "'F2B Power Supply Fan Tray' — fan before power"],
  ["NCS4009-FC2-S-KIT", "fabric", "a fabric card sold as a kit — fabric before accessory"],
  ["NCS2015-BRK-KIT=", "accessory", "a BRACKET kit, not the BRK passive breakout module"],
  ["NCS1K-BRK-SA=", "chassis", "'NCS 1000 shelf for 4 passive modules' carries the BRK token of what it holds"],
  ["15216-LC-SC-5=", "cable", "'Fiber patchcord - LC to SC': its SC segment must not read as a splitter"],
  ["ONS-CCC-100G-10=", "cable", "'CXP-CFP MPO cable', not the ONS-CC CFP optic"],
  ["ONS-CXP2-MPO-30=", "cable", "a patch cord FOR a CXP2, not the CXP2 optic"],
  ["ONS-CXP2-SR25=", "pluggable", "'CXP2 Transceiver module' — the optic the patch cord above serves"],
  ["NCS2K-MR-MXP-LIC=", "transponder", "'10/40/100G MR Muxponder' — NCS2K-MR is not the NCS2K-M-R media kit (kind-layer: a muxponder is a transponder)"],
  ["NCS2K-MF-UPG-4=", "mux", "'Mesh Interconnection MF Unit' — a passive unit, not the frame and not software"],
  ["NCS2K-MF10-6RU=", "accessory", "'Mechanical Frame for Passive Units' — the frame itself"],
  ["15216-DCU-SA=", "accessory", "'Mechanical shelf (housing 2 DCM)' — a shelf FOR DCUs, not a DCU"],
  ["15454-SMR1-LIC", "roadm", "'SM ROADM 1-PRE-AMP' — its name says pre-amp and it is a ROADM"],
  ["15454-32-DMX-L=", "mux", "'32-Channel Demultiplexer' — the 15454-<n>- card prefix must not take it"],
  ["15454-M-ACCBL2-L2=", "cable", "'AC2 power cable' — the 15454-M- card prefix must not take it"],
  ["15454-M-120TMGCBL=", "cable", "'BITS IN/OUT cable' — the CBL token glued to its purpose"],
  ["15454-M-RAMAN-CTP", "amplifier", "a counter-propagating Raman amplifier under the 15454-M- card prefix"],
  ["15454-M-TSCE-K9=", "controller", "'Transport Shelf Controller' under the 15454-M- card prefix"],
  ["NCS4K-DC-FA=", "accessory", "'AC Power front connection adapter' — carries DC and supplies nothing"],
  ["15454-M2-DC-E=", "power", "'chassis DC ETSI filter with memory' — the -E (ETSI) suffix"],
  ["ONS-CFP2D-400G-C=", "pluggable-tunable", "'400G CFP2 DCO ... C Band Tuneable' — opticKind's coherent family, reused"],
  ["ONS-SE-100-BX10U=", "pluggable-bidi", "opticKind's BX token, reused"],
  ["ONS-SE-4G-MM=", "pluggable", "a fixed 850 nm FC optic stays the default pluggable"],
  ["15454-GE-XPE++=", "transponder", "the TAA ++ and the spare = are packaging, not kind ('20 GBE ENHANCED CROSSPONDER')"],
  ["15216-FLAMP44.5-SK", "unknown", "'1ea 15216-FLA-8-44.5 and 15216-EDFA2-A' — a bundle of a mux AND an amplifier"],
  ["15454-OPTAMPC-LLP3", "unknown", "'BUNDLE 15454 OPT AMP C AND 3YRSNTNBD' — a service bundle, not an amplifier"],
  ["ONS-CFP2WDM-BUN4", "unknown", "'4 x ONS-CFP2-WDM Bundle' — an N-pack"],
  ["UAS-PM", "unknown", "a PM counter name read out of a datasheet table"],
  ["CP-16QAM", "unknown", "a modulation name read out of a datasheet table"],
  ["LC-LC", "unknown", "a connector-pair cell; the patch-cord rule needs a length"],
  // kind-layer (13 Sep 2026) refusals: the transponder rule must not take a client or CEM line card, a licence bundle, or a
  // shipping kit, and the pluggable family must not take a CFP2 bundle or licence.
  ["15454-M-CFP-LC=", "linecard", "'Cisco ONS 15454 2-Port CFP Line Card' — a client card: CFP-LC is not the 100G-LC trunk token"],
  ["NCS4K-2H-O-K=", "linecard", "'NCS 4000 2x 100G CPAK - OTN Line Card' — 2H-O is the OTN client card, 2H-W the WDM one"],
  ["NCS1K4-2-QDD-C-K9=", "linecard", "'Network Convergence System 1004 2x QSFP-DD C-Band Line Card' — no transponder token"],
  ["15454-M-WSE-K9=", "linecard", "'Full Feature Wire Speed Encryption Unit' — an encryption card, not a transponder"],
  ["NCS4200-2H-PK", "linecard", "'NCS 4200 2-Port 100GE QSFP28 Interface Module' — 2H-PK is not 2H-W"],
  ["15454-M-SHIPKIT=", "accessory", "'Shipkit, Cisco ONS 15454 M6 and M2' — the 15454-M- card prefix must not take it"],
  ["15454-10GEXPE-LLP3", "unknown", "'BUNDLE 15454 10GE XPE AND 3YRSNTNBD' — a service bundle carrying XPE, not the crossponder"],
  ["ONS-CFP2-ACO-BDL", "unknown", "'WDM CFP2 Pluggable Bundle - Licensed - No Feature' — a bundle, not a CFP2"],
  ["ONS-CFP2-WDM-LIC", "software", "'CFP2 WDM - C-band Tunable - Lic. For 100G HD-FEC' — the licence, not the CFP2"],
  ["15454-AR-XP-LIC=", "transponder", "'ONS15454 Any-Rate Xponder - SW License Upgradeable' — licence-UPGRADEABLE hardware stays the card"],
  ["DS-CWDM-MUX8A", "mux", "the glued channel count; before kind-layer it fell to unknown"],
  ["NCS2K-400G-BUN-SK", "unknown", "'400G XPonder + 1X CFP2-WDM - 1X LIC' — a starter kit OF a transponder is not the transponder"],
  ["15454W-5X40GMXP-SK", "unknown", "'5x 4x10G Coherent Muxponder w/SR XFPs Starter Kit' — MXP inside a kit"],
  ["NCS4K-24LR-O-S", "linecard", "'NCS 4000 24-port Low rate OTN LC - SFP' — a client OTN card"],
  ["15216-OSC-PTP=", "linecard", "the optical service channel module stays a card, not a transponder"],
  ["NCS1K14-SA-D=", "accessory", "'Shelf Assembly Divider' — not a shelf assembly"],
  ["NCS4200-1T8S-10CS=", "linecard", "10CS is a line-card suffix, not the CS splitter segment"],
  ["NCS4K-DC-PSU-V1", "power", "V1 is a version, not the V (VOA) segment"],
  ["NC55-OIP-02-FC", "linecard", "an MPA whose -FC is Fibre Channel, not an NCS 4000 fabric card"],
  ["DS-X9112", "linecard", "an MDS switching module filed here (a row move is proposed)"],
  ["15454-24MPO-MPO-2=", "cable", "'24-Fiber patchcord' — the 15454-<n>- card prefix must not take it"],
  ["15454-M-CBL2L-CHI=", "cable", "'AC2 power cable - China left exit' — CBL2 with an exit letter"],
  ["SF-NCS1K-R601K9", "software", "'NCS 1K - R6.0.1 SW' — asked nothing (the class rule is the security group's)"],
  ["15454-OPT-RAMPC++=", "amplifier", "'RAMAN AMPLIFIER, TAA' — the C glued onto RAMP"],
  ["NCS2K-9-SMR24FS=", "roadm", "'9-port Single Module ROADM' — SMR with its gain range glued on"],
  ["15454E-OPT-BST", "amplifier", "the ETSI 15454E prefix"],
  ["15252-N3/UPGRADE=", "accessory", "'Upgrade kit from MCU with Plenum to MCU FAN' — a kit, not a fan"],
  ["ONS15252", "chassis", "'Multi-Channel Unit, Mechanics, Covers' — the 15252 unit itself"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want} (${why})`, opticalKind(sku), want);
eq(`refusals (${REFUSALS.length}) are at least as many as positives (${CASES.length})`, REFUSALS.length >= CASES.length, true);

// --- SABOTAGE: remove each rule family in turn; a case it decides must change answer -----------------------------
// A rule no case depends on is a rule nobody has seen work; a rule whose removal changes nothing is dead.
const ALL = [...CASES, ...REFUSALS.map(([s, k]) => [s, k] as [string, string])];
OPTICAL_KIND_RULES.forEach((rule, i) => {
  const witnesses = ALL.filter(([sku]) => opticalKindRule(sku) === i);
  eq(`rule #${i} (${rule.kind}) is the deciding rule for at least one case`, witnesses.length > 0, true);
  const without = OPTICAL_KIND_RULES.filter((_, j) => j !== i);
  const changed = witnesses.filter(([sku, want]) => opticalKindWith(without, sku) !== want);
  eq(`SABOTAGE rule #${i} (${rule.kind}) disabled -> ${witnesses.length} witness(es) go red`, changed.length > 0, true);
});

// --- the kind sets say what the profile relies on --------------------------------------------------------------
eq("a tunable pluggable has no fixed wavelength", (OPN_FIXED_WAVELENGTH as readonly string[]).includes("pluggable-tunable"), false);
eq("every pluggable kind is a pluggable", OPN_FIXED_WAVELENGTH.every((k) => OPN_PLUGGABLE.includes(k)), true);
eq("a passive mux draws no power", (OPN_POWERED as readonly string[]).includes("mux"), false);
eq("a ROADM does", (OPN_POWERED as readonly string[]).includes("roadm"), true);
eq("the default asks less: `unknown` is in no powered or pluggable set", [...OPN_POWERED, ...OPN_PLUGGABLE].includes("unknown" as never), false);
eq("empty SKU fails safe to unknown", opticalKind(""), "unknown");
eq("kind-layer: the old fallback name `other` is gone from the axis", (OPTICAL_KINDS as readonly string[]).includes("other"), false);
for (const k of OPTICAL_KINDS) eq(`kind "${k}" is reached by a catalogue SKU`, ALL.some(([, w]) => w === k), true);

lines.unshift(`    optical kind: ${passed} passed, ${failed} missed (${CASES.length} positives, ${REFUSALS.length} refusals, ${OPTICAL_KIND_RULES.length} sabotaged families)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
