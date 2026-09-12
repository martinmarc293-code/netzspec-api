// tests/opticKind.test.ts — what a transceiver-category part IS, from its SKU (11 Sep 2026).
//
// `kind` is the gate that asks a BiDi optic for its receive wavelength, stops asking a tunable one for a
// single wavelength it does not have, and stops asking a mounting bracket for DDM and a fibre type. A wrong
// kind puts a part behind the wrong questions, so, as in switchKind.test.ts, THE HALF THAT MATTERS IS THE
// REFUSALS: `ZR` is a fixed 1550 nm reach code, not a tunable laser; `-C` is a GPON power class as often as
// C-band; `-BD` is duplex BiDi (two fibres), not single-fibre; `CVR328W` is a router, not a converter.
//
// Every SKU here comes from the catalogue, read by name in the 11 Sep census. None is invented.
import { opticKind, OPT_MODULE, OPT_FIXED_WAVELENGTH } from "../src/core/opticKind.js";

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
  // the default: pluggable optics and cables
  ["SFP-10G-SR", "pluggable"], ["GLC-TE", "pluggable"], ["QSFP-H40G-CU5M", "pluggable"], ["QSFP-100G-AOC", "pluggable"],
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
eq("SABOTAGE a straight QSFP DAC is not a breakout", opticKind("QSFP-H40G-CU3M"), "pluggable");
eq("SABOTAGE a straight SFP DAC is not a breakout", opticKind("SFP-H10GB-CU3M"), "pluggable");
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

lines.unshift(`    optic kind: ${passed} passed, ${failed} missed (${REFUSALS.length} refusals, 2 ordering cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
