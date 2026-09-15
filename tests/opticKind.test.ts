// tests/opticKind.test.ts — what a transceiver-category part IS, from its SKU (11 Sep 2026).
//
// `kind` is the gate that asks a BiDi optic for its receive wavelength, stops asking a tunable one for a
// single wavelength it does not have, and stops asking a mounting bracket for DDM and a fibre type. A wrong
// kind puts a part behind the wrong questions, so, as in switchKind.test.ts, THE HALF THAT MATTERS IS THE
// REFUSALS: `ZR` is a fixed 1550 nm reach code, not a tunable laser; `-C` is a GPON power class as often as
// C-band; `-BD` is duplex BiDi (two fibres), not single-fibre; `CVR328W` is a router, not a converter.
//
// Every SKU here comes from the catalogue, read by name in the 11 Sep census. None is invented.
import { opticKind, OPT_MODULE, OPT_FIXED_WAVELENGTH, RULES, NAME_RULES } from "../src/core/opticKind.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js"; // kind-layer (13 Sep 2026)

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, string][] = [
  // single-fibre BiDi: every BX token shape, the 100G QSFP28 pairs, GPON OLT optics
  ["GLC-BX-D", "bidi"], ["GLC-BX-U=", "bidi"], ["GLC-BXD-I", "bidi"], ["GLC-BX40-DA-I", "bidi"],
  ["GLC-BX80-U-I", "bidi"], ["GLC-2BX-D", "bidi"], ["GLC-FE-100BX-D", "bidi"], ["GLC-FE-100BX-URGD", "bidi"],
  ["SFP-10G-BX40U-I", "bidi"], ["SFP-10/25G-BXD-I", "bidi"], ["SFP-25G-BX40D-I", "bidi"], ["SFP-50G-BXU-I", "bidi"],
  ["ONS-SC-GE-BXU", "bidi"], ["ONS-SC-2GE-BX-D", "bidi"], ["ONS-SI-100-BXD=", "bidi"],
  ["QSFP-100G-B20D4-I", "bidi"], ["QSFP-100G-B40U-I", "bidi"],
  ["SFP-GPON-C", "bidi"], ["SFP-GPON-B-I-16=", "bidi"], ["CGP-SFP-OC", "bidi"],
  // XGS-PON OLT, "Tx 1577 nm / Rx 1270 nm" — found only through its own facts, not its SKU or name
  ["SFP-10G-OLT20-X", "bidi"],
  // tunable and coherent DWDM
  ["DWDM-SFP10G-C", "tunable"], ["DWDM-SFP10G-C-S=", "tunable"], ["DWDM-SFP10G-E-I=", "tunable"], ["DWDM-XFP-C", "tunable"],
  ["ONS-SC+-10G-C", "tunable"], ["ONS-CFP2-WDM", "tunable"], ["ONS-CFP2D-400G-C", "tunable"],
  ["QDD-400G-ZR-S", "tunable"], ["QDD-400G-ZRP-S=", "tunable"], ["CFP2-WDM-D-1HL", "tunable"], ["CFP2-WDM-DETS-SK", "tunable"],
  ["DP01QS28-E20", "tunable"], ["DP04QSDD-HE0", "tunable"], ["DP04SFP8-E20", "tunable"], ["XFP-RF-T=", "tunable"],
  // converters and adapters
  ["CVR-QSFP-SFP10G", "adapter"], ["CVR-X2-SFP", "adapter"], ["CVR-X2-SFP10G=", "adapter"], ["CVR-CPAK-QSFP40", "adapter"],
  ["CVR-2QSFP28-8SFP", "adapter"], ["CVR-QSFP28-SFP25G", "adapter"],
  // brackets, trays, passive muxes
  ["CVR-BRKT-1", "accessory"], ["CVR-TRAY-8=", "accessory"], ["CWDM-MUX-4-SF1=", "accessory"],
  ["CWDM-MUX-AD-1470=", "accessory"], ["CWDM-MUX8A=", "accessory"], ["DS-CWDM-MUX8A=", "accessory"],
  // the default: pluggable optics (kind-layer 13 Sep 2026: QSFP-H40G-CU5M and QSFP-100G-AOC are `cable` now — below)
  ["SFP-10G-SR", "pluggable"], ["GLC-TE", "pluggable"], ["QSFP-H40G-CU5M", "cable"], ["QSFP-100G-AOC", "cable"],
  ["DWDM-SFP10G-30.33", "pluggable"], ["DWDM-GBIC-30.33", "pluggable"], ["CWDM-SFP-1490=", "pluggable"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, opticKind(sku), want);

// --- REFUSALS: each one is what a slightly wider rule would get wrong ------------------------------------
const REFUSALS: [string, string, string][] = [
  ["SFP-10G-ZR", "pluggable", "ZR is a fixed 1550 nm / 80 km reach code, not a tunable laser"],
  ["SFP-10G-ZR-S=", "pluggable", "ZR, spare"],
  ["X2-10GB-ZR", "pluggable", "ZR on an X2"],
  ["ONS-SC+-10G-ZR", "pluggable", "ZR on the ONS line whose -C sibling IS tunable"],
  ["MA-SFP-10GB-ZR", "pluggable", "Meraki ZR"],
  ["DS-X2-E10G-ZR", "pluggable", "MDS ZR X2"],
  ["QSFP-40G-SR-BD", "pluggable", "-BD is DUPLEX BiDi: two fibres, asked no Rx wavelength"],
  ["QDD-400G-BD", "pluggable", "400G duplex BiDi"],
  ["QSFP-40/100-SRBD", "pluggable", "40/100G duplex SR-BiDi"],
  ["CVR328W-K9-CN", "pluggable", "a 'Wireless-N 3G VPN Router' — the adapter rule needs the hyphen after CVR"],
  ["DWDM-XFP-60.61=", "pluggable", "a FIXED DWDM channel, not the tunable -C"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want} (${why})`, opticKind(sku), want);

// --- ORDER: rules overlap, and the order is part of the rule ---------------------------------------------
// DP04CFP2-D15 is coherent AND single-fibre ("400G BiDi CFP2 — kohärentes DWDM (DCO), Einzelfaser"); what it
// is asked is decided by having no fixed wavelength, so tunable must run before bidi.
eq("DP04CFP2-D15 is tunable although it is also single-fibre", opticKind("DP04CFP2-D15"), "tunable");
// CVR-BRKT-1 carries the adapter prefix and is a bracket for one; accessory must run before adapter.
eq("CVR-BRKT-1 is an accessory although it carries the CVR- prefix", opticKind("CVR-BRKT-1"), "accessory");

// --- the kind sets say what the profile relies on --------------------------------------------------------
eq("a tunable part has no fixed wavelength", (OPT_FIXED_WAVELENGTH as readonly string[]).includes("tunable"), false);
eq("a BiDi part does", (OPT_FIXED_WAVELENGTH as readonly string[]).includes("bidi"), true);
eq("an adapter is not a module", (OPT_MODULE as readonly string[]).includes("adapter"), false);
eq("an accessory is not a module", (OPT_MODULE as readonly string[]).includes("accessory"), false);
eq("empty SKU fails safe to pluggable", opticKind(""), "pluggable");

// --- breakout-cable (round-6 B4c, 12 Sep 2026) ----------------------------------------------------------
// A cable joining two DIFFERENT cages. Validated against every live Cisco transceiver part: 51 caught, and
// 0 missed of the 27 parts whose own form_factor fact names two cages. Every positive is a real SKU.
for (const sku of [
  "QSFP-4SFP25G-CU1.5M", "QSFP-4SFP10G-CU5M", "QSFP-4SFP25-CU1M", "QSFP-4X10G-AOC2M", "QSFP-4X10G-AC10M",
  "Q-4SFP25G-CU1.5M",
  // the QSFP-DD to 2xQSFP56 fan-out, which a 4SFP/4X-only rule missed
  "QDD-2Q200-CU3M", "QDD-2Q200-CI2M",
  // length-generic SKUs: the length is a literal x ("length x - 1m to 10m")
  "QSFP-4X10G-AOCxM", "QSFP-4X10G-ACxM",
  // the spare suffix must not hide it
  "QSFP-4SFP10G-CU4M=",
]) eq(`${sku} is a breakout cable`, opticKind(sku), "breakout-cable");
// THE REFUSALS ARE THE POINT. Each of these carries the fan-out marker and is a real multi-lane PLUGGABLE
// OPTIC, not a cable. A rule on the fan-out alone would take all of them and tell each one it has no form
// factor. What separates them is the second marker — no -CU/-AOC/-AC/-CI length suffix.
for (const sku of [
  "QSFP-4X10G-LR-S", "QSFP-4X10G-LR-S=", "QSFP-4X10G-LR=",
  "QDD-4X100G-FR-S", "QDD-4X100G-LR-S", "QDD-8X100G-FR", "QDD-2X400G-FR4",
]) eq(`${sku} is a multi-lane OPTIC, not a breakout cable`, opticKind(sku), "pluggable");
// SABOTAGE: a straight (non-breakout) DAC must not be taken either — it has a cable suffix and no fan-out.
// kind-layer (13 Sep 2026): it is a same-cage `cable` now, which is still "not a breakout".
eq("SABOTAGE a straight QSFP DAC is not a breakout", opticKind("QSFP-H40G-CU3M"), "cable");
eq("SABOTAGE a straight SFP DAC is not a breakout", opticKind("SFP-H10GB-CU3M"), "cable");
// SABOTAGE: the CVR- reverse adapters carry fan-out words and are adapters, which run first.
eq("SABOTAGE CVR-4SFP10G-QSFP stays an adapter", opticKind("CVR-4SFP10G-QSFP"), "adapter");
eq("a breakout cable is not a module (it is asked two ends, not one form factor)",
  (OPT_MODULE as readonly string[]).includes("breakout-cable"), false);
eq("a breakout cable has no fixed wavelength", (OPT_FIXED_WAVELENGTH as readonly string[]).includes("breakout-cable"), false);

// every kind the type names is reached by at least one catalogue SKU
for (const k of ["pluggable", "bidi", "tunable", "adapter", "accessory"]) {
  eq(`kind "${k}" is reached by a catalogue SKU`, CASES.some(([, w]) => w === k), true);
}
eq(`kind "breakout-cable" is reached by a catalogue SKU`, opticKind("QSFP-4SFP25G-CU1.5M"), "breakout-cable");

// ---- kind-layer (13 Sep 2026): the `cable` kind, the three breakout families item 4 found, the MDS CWDM passives --------
// Witnesses are real rows (III.0 item 4 §2 read all 191; the classifier agrees with that read on 191 of 191). The
// refusals are the rows a slightly wider token rule takes.
const CABLE13: [string, string, string?][] = [
  // [sku, kind, name?] — SKU-only unless a name is given
  ["SFP-H10GB-CU1M", "cable"], ["SFP-H10GB-CU1-5M=", "cable"], ["QSFP-H40G-CU0-5M", "cable"], ["QSFP-H40G-ACU10M=", "cable"],
  ["SFP-H10GB-ACU-7M", "cable"], ["QDD-400-CU2.5M", "cable"], ["QSFP-200-CU1M", "cable"], ["SFP-50G-CU0.5M", "cable"],
  ["QDD-400-AOC15M", "cable"], ["SFP-10G-AOC1M-10M", "cable"], ["QSFP-H40G-AOCXM=", "cable"], ["SFP-25G-AOCxM", "cable"],
  ["SFP-H10GB-CUxx=", "cable"], ["ONS-SC+-10G-CU3=", "cable"], ["MA-CBL-100G-50CM", "cable"], ["MA-CBL-TA-1M", "cable"],
  ["ONS-CCC-100G-10=", "cable"],
  // the name path, for a SKU with no Cisco token (Cisco-filed and other vendors)
  ["PQSF2PXA1MBL", "cable", "QSFP28 100G Direct Attach Copper Cable Assembly, 30 AWG, Black, 1m"],
  ["00YL634", "cable", "Lenovo 00YL634 10G AOC SFP+ auf SFP+ – aktives optisches Kabel (AOC), Länge 1 m"],
  ["J9281D", "cable", "HPE Aruba Networking J9281D 10G SFP+-zu-SFP+ DAC – fest konfektioniert, 1 m"],
  ["QFX-QSFP-DAC-1M", "cable", "QSFP+ Cable Assy, 1m, 30AWG, Passive, Programmable ID"],
  ["JNP-QSFP-AOCBO-10M", "breakout-cable", "40G active optical breakout cable for 10M"],
  // breakout families the round-6 rule missed
  ["QDD-4ZQ100-CU1M", "breakout-cable"], ["QDD4ZQ100-CU2M", "breakout-cable"], ["QDD-4ZQ100CU1M", "breakout-cable"],
  ["QSFP-4S50-CU3M", "breakout-cable"], ["QDD-4X100G-AOC-10M", "breakout-cable"],
  ["AOC-Q56DD-4Q28-100G-3M", "breakout-cable", "Dell AOC-Q56DD-4Q28-100G-3M 400G Breakout-AOC – QSFP-DD auf 4x QSFP28, Länge 3 m"],
  ["845420-B21", "breakout-cable", "HPE Aruba Networking 845420-B21 Breakout-AOC zu 4x SFP28 – 7 m"],
  // MDS CWDM passives, out of pluggable
  ["DS-CWDMOADM4A=", "accessory"], ["DS-CWDMCHASSIS=", "accessory"], ["DS-CWDM-MUX8A=", "accessory"],
];
for (const [sku, kind, name] of CABLE13) eq(`kind-layer: ${sku}${name ? " (by name)" : ""} is ${kind}`, opticKind(sku, name), kind);
const CABLE13_REFUSALS: [string, string, string, string?][] = [
  // [sku, must stay, why, name?]
  ["SFP-CU-RJ45=", "pluggable", "a copper SFP MODULE: a letter follows -CU-"],
  ["SFP-RFGW1-CU-RJ45=", "pluggable", "RF Gateway copper SFP module"],
  ["X2-10GB-CX4", "pluggable", "a CX4 module, 15 m twinax behind it but a module", "Cisco X2-10GB-CX4 10GBASE-CX4 X2 Modul — 15 m Twinax (CX4)"],
  ["XENPAK-10GB-CX4", "pluggable", "same, XENPAK", "Cisco XENPAK-10GB-CX4 10GBASE-CX4 XENPAK — CX4 (Kupfer), CX4-Twinax-Kupfer, 15 m"],
  ["DS-CWDM8G1610=", "pluggable", "an MDS CWDM SFP+ OPTIC, not the CWDM passive family", "1610 nm CWDM 2/4/8-Gbps Fibre Channel SFP+ , Spare"],
  ["AOC-E10GSFPSR", "pluggable", "Supermicro's AOC = Add-On Card: a 10GBASE-SR transceiver", "Supermicro AOC-E10GSFPSR 10 Gbit/s SFP+-Transceiver – 10GBASE-SR, 850 nm, Multimode (MMF), Duplex LC"],
  ["QSFP-4X10GE-LR-25", "pluggable", "a 4x10G LR optic whose name says breakout and carries no cable noun", "Juniper QSFP-4X10GE-LR-25 40 Gbit/s 4× 10GBASE-LR-Transceiver – Singlemode-Glasfaser (SMF), MPO-12 / breakout"],
  ["SFP-1G-T-C", "pluggable", "a copper RJ45 module whose name mentions a Cat 5 cable", "Small Form Factor Pluggable 1000Base-T Gigabit Ethernet Module (uses Cat 5 cable)"],
  ["MA-CBL-120G-1M", "cable", "3×40G stacking is a lane count, not a fan-out (the count rule takes 2/4/8)", "Cisco Meraki MA-CBL-120G-1M 120 Gbit/s (3×40G Stacking) Direktanschlusskabel 1 m"],
  ["QSFP-100G-AOCxM", "cable", "the Cisco datasheet heading says 'breakout' on a same-cage range row; only a COUNTED fan-out overrides a SKU", "QSFP active optical breakout cables (length x - 1m to 30m)"],
  ["QSFP-4X10G-LR-S", "pluggable", "a multi-lane optic with the fan-out token and no cable token"],
];
for (const [sku, want, why, name] of CABLE13_REFUSALS) eq(`kind-layer REFUSAL ${sku} stays ${want} — ${why}`, opticKind(sku, name), want);
// SABOTAGE, one per rule family: switch the rule off and its witness must change kind.
{
  const i = RULES.findIndex((r) => r.kind === "cable");
  const [rule] = RULES.splice(i, 1);
  eq("SABOTAGE cable RULE off: SFP-H10GB-CU1M is no longer a cable", opticKind("SFP-H10GB-CU1M") === "cable", false);
  RULES.splice(i, 0, rule);
  eq("control: cable RULE restored", opticKind("SFP-H10GB-CU1M"), "cable");
  const saved = { ...NAME_RULES };
  NAME_RULES.CABLE_NOUN = /$^/;
  eq("SABOTAGE CABLE_NOUN off: a Lenovo AOC named as one is no longer a cable", opticKind("00YL634", "Lenovo 00YL634 10G AOC SFP+ auf SFP+ – aktives optisches Kabel (AOC), Länge 1 m") === "cable", false);
  Object.assign(NAME_RULES, saved);
  NAME_RULES.COUNTED_FANOUT = /$^/;
  eq("SABOTAGE COUNTED_FANOUT off: a Dell 4x breakout AOC falls to a same-cage cable", opticKind("AOC-Q56DD-4Q28-100G-3M", "Dell AOC-Q56DD-4Q28-100G-3M 400G Breakout-AOC – QSFP-DD auf 4x QSFP28, Länge 3 m"), "cable");
  Object.assign(NAME_RULES, saved);
  NAME_RULES.BREAKOUT_WORD = /$^/;
  eq("SABOTAGE BREAKOUT_WORD off: Juniper's uncounted breakout AOC falls to a same-cage cable", opticKind("JNP-QSFP-AOCBO-10M", "40G active optical breakout cable for 10M"), "cable");
  Object.assign(NAME_RULES, saved);
  NAME_RULES.TRANSCEIVER_WORD = /$^/;
  eq("SABOTAGE TRANSCEIVER_WORD off: Supermicro's AOC- transceiver is taken as a cable", opticKind("AOC-E10GSFPSR", "Supermicro AOC-E10GSFPSR 10 Gbit/s SFP+-Transceiver – 10GBASE-SR, 850 nm"), "cable");
  Object.assign(NAME_RULES, saved);
  eq("control: name rules restored", opticKind("AOC-E10GSFPSR", "Supermicro AOC-E10GSFPSR 10 Gbit/s SFP+-Transceiver – 10GBASE-SR, 850 nm"), "pluggable");
  const b = RULES.findIndex((r) => r.kind === "breakout-cable");
  const saveRe = RULES[b].re;
  RULES[b] = { kind: "breakout-cable", re: /^(?=.*-(?:CU|AOC|ACU|AC|CI)(?:\d|X))(?:Q|QSFP|QDD|QSFP28)-(?:\d+(?:SFP|QSFP)|\d+X\d+G|\d+Q\d+)/ };
  eq("SABOTAGE breakout rule back to its round-6 form: QDD-4ZQ100-CU1M is no longer a breakout", opticKind("QDD-4ZQ100-CU1M") === "breakout-cable", false);
  RULES[b] = { kind: "breakout-cable", re: saveRe };
  const a = RULES.findIndex((r) => r.kind === "accessory");
  const saveA = RULES[a].re;
  RULES[a] = { kind: "accessory", re: /(?:^|-)(?:BRKT|BRACKET|TRAY|MUX|DEMUX|MUXDEMUX)(?:-|=|\d|$)/ };
  eq("SABOTAGE accessory rule without the MDS CWDM shapes: DS-CWDMOADM4A= is a pluggable again", opticKind("DS-CWDMOADM4A="), "pluggable");
  RULES[a] = { kind: "accessory", re: saveA };
}
// layers round 3 (14 Sep 2026): the 29 transceiver rows the layer read found in the wrong kind, each alternative with a witness, a
// refusal that states what the alternative must not take, and a sabotage that removes it and watches the witness fall back.
{
  const R3: [string, string][] = [
    ["SFP-H25GCU1M", "cable"], ["SFP-H25GCU2.5M", "cable"], ["SFP-25GAOC10M", "cable"], ["SFP-H10GBACU10M", "cable"],
    ["ONS-XC-10G-C=", "tunable"], ["ONS-XC-10G-96C=", "tunable"], ["ONS-C2-WDM-DE-1HL", "tunable"],
    ["S10G-BD-PM-D-I", "bidi"], ["S10G-BU-PM-D-I", "bidi"],
    ["CWDM-OADM1-1530=", "accessory"], ["CWDM-OADM4-1=", "accessory"],
    ["QSFP100GMX1-2-BUN", "tunable"], ["QSFP100GMX2-20-BUN", "tunable"],
  ];
  for (const [sku, want] of R3) eq(`round 3: ${sku} is ${want}`, opticKind(sku), want);
  const R3_REFUSALS: [string, string, string][] = [
    ["ZZ-GCU1M", "pluggable", "a G with no speed digits before it is not a speed suffix"],
    ["ONS-XC-10G-S1=", "pluggable", "an OC-192 short-reach XFP: the C-band token must stand alone"],
    ["ONS-XC-10G-1510=", "pluggable", "a fixed-wavelength CWDM XFP"],
    ["S10G-SR-PM-D-I", "pluggable", "the duplex SR sibling of the BiDi pair"],
    ["QSFP-40G-SR-BD", "pluggable", "a duplex BiDi: -BD alone is not single-fibre"],
    ["CWDM-SFP-1530", "pluggable", "a CWDM optic, not the OADM plug-in"],
    ["CWDM-GBIC-1530", "pluggable", "a CWDM GBIC optic"],
  ];
  for (const [sku, want, why] of R3_REFUSALS) eq(`round 3 REFUSAL ${sku} stays ${want} — ${why}`, opticKind(sku), want);
  const swap = (kind: string, re: RegExp, run: () => void) => { const i = RULES.findIndex((r) => r.kind === kind); const keep = RULES[i].re; RULES[i] = { kind: kind as never, re }; run(); RULES[i] = { kind: kind as never, re: keep }; };
  swap("cable", /(?:-|(?<=[0-9]))(?:A?CU|AOC)(?:\d|X|-\d|=|$)|^MA-CBL-|^ONS-CCC-|(?:^|-)(?:DAC|AOC)(?:\d|-|=|$)/, () =>
    eq("SABOTAGE cable rule without the speed-glued lookbehind: SFP-H25GCU1M is a pluggable again", opticKind("SFP-H25GCU1M"), "pluggable"));
  swap("tunable", /^DP0\d|^CFP2-WDM-|^ONS-CFP2|^QDD-400G-ZRP?-|^DWDM-(?:SFP10G|SFP|XFP|X2)-[CE](?:-|=|$)|^ONS-S[CI]\+?-10G-C(?:-|=|$)|^XFP-RF-T(?:-|=|$)/, () => {
    eq("SABOTAGE tunable rule without the XFP C-band spelling: ONS-XC-10G-C= is a pluggable again", opticKind("ONS-XC-10G-C="), "pluggable");
    eq("SABOTAGE tunable rule without the C2 spelling: ONS-C2-WDM-DE-1HL is a pluggable again", opticKind("ONS-C2-WDM-DE-1HL"), "pluggable");
    eq("SABOTAGE tunable rule without the MX bundles: QSFP100GMX1-2-BUN is a pluggable again", opticKind("QSFP100GMX1-2-BUN"), "pluggable");
  });
  eq("round 3 REFUSAL QSFP-100G-LR4-S stays pluggable — a fixed 100G QSFP28, not the MX DCO bundle prefix", opticKind("QSFP-100G-LR4-S"), "pluggable");
  swap("bidi", /(?:^|-)\d*BX(?:\d+)?[UD]?A?(?:-|=|$)|(?:^|-)B\d{2}[UD]\d?(?:-|=|$)|GPON|XGS-?PON|(?:^|-)OLT\d*(?:-|=|$)|^CGP-/, () =>
    eq("SABOTAGE bidi rule without the S10G pair: S10G-BD-PM-D-I is a pluggable again", opticKind("S10G-BD-PM-D-I"), "pluggable"));
  swap("accessory", /(?:^|-)(?:BRKT|BRACKET|TRAY|MUX|DEMUX|MUXDEMUX)(?:-|=|\d|$)|^DS-CWDM(?:OADM|CHASSIS)/, () =>
    eq("SABOTAGE accessory rule without the CWDM OADM plug-ins: CWDM-OADM4-1= is a pluggable again", opticKind("CWDM-OADM4-1="), "pluggable"));
  eq("control: round-3 rules restored", [opticKind("SFP-H25GCU1M"), opticKind("ONS-XC-10G-C="), opticKind("S10G-BD-PM-D-I"), opticKind("CWDM-OADM4-1=")].join(), "cable,tunable,bidi,accessory");
}
eq(`kind "cable" is not an optic module (it is asked a length, not a transmit power)`, (OPT_MODULE as readonly string[]).includes("cable"), false);
// kind-layer (13 Sep 2026): the question sets as kindQuestionSet resolves them (today's required set + the library's
// proposed required cups; the parent decides each on the printed measurement).
{
  const qs = (k: string) => { const q = kindQuestionSet("transceiver", k); return `${[...q.required].sort().join(",")} | ${q.pending.map((p) => p.key).sort().join(",")}`; };
  const MEDIA_PENDING = "cable_length,fiber_type,reach_max,rx_sensitivity,tx_power,wavelength,wire_gauge";
  eq("question set: pluggable (+ temp_operating)", qs("pluggable"), `connector,data_rate,ddm,form_factor,media,power_max,standard,temp_class,temp_operating | ${MEDIA_PENDING}`);
  eq("question set: bidi (+ temp_operating)", qs("bidi"), `connector,data_rate,ddm,form_factor,media,power_max,rx_wavelength,standard,temp_class,temp_operating | ${MEDIA_PENDING}`);
  eq("question set: tunable (+ temp_operating, tuning_range; no wavelength)", qs("tunable"), "connector,data_rate,ddm,form_factor,media,power_max,standard,temp_class,temp_operating,tuning_range | cable_length,fiber_type,reach_max,rx_sensitivity,tx_power,wire_gauge");
  eq("question set: cable (no optic rows; + cable_length, product_compatibility)", qs("cable"), "cable_length,connector,data_rate,ddm,form_factor,media,power_max,product_compatibility,standard,temp_class | wire_gauge");
  eq("question set: breakout-cable (+ product_compatibility)", qs("breakout-cable"), "breakout_count,cable_length,data_rate,form_factor_a,form_factor_b,media,product_compatibility | fiber_type,reach_max,rx_sensitivity,tx_power,wire_gauge");
  eq("question set: adapter (+ both ends, product_compatibility)", qs("adapter"), "data_rate,form_factor,form_factor_a,form_factor_b,product_compatibility | ");
  eq("question set: accessory (+ product_compatibility)", qs("accessory"), "product_compatibility | ");
  eq("LEDGER_KINDS names the transceiver `cable` kind", LEDGER_KINDS.transceiver.includes("cable"), true);
}

lines.unshift(`    optic kind: ${passed} passed, ${failed} missed (${REFUSALS.length} refusals, 2 ordering cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
