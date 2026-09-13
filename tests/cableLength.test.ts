// tests/cableLength.test.ts — the length a transceiver cable's SKU states (src/core/cableLength.ts), kind-layer 13 Sep 2026.
//
// A derivation is a tap only when it is registered WITH its validation (DERIVED_FILL_PATHS), and a derivation that
// has never refused anything is not one anybody should trust. So the refusals here outnumber nothing: every range row
// and every implausible length the validation run met is pinned, and each rule family has a sabotage case.
// Every SKU is a live row (III.0 item 4 §2 read, or the item-5 dump of the other vendors).
import { cableLengthFromSku, CABLE_LENGTH_GUARDS } from "../src/core/cableLength.js";
import { DERIVED_FILL_PATHS } from "../src/core/derivedFillPaths.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};
const len = (sku: string) => { const r = cableLengthFromSku(sku); return r.ok ? r.metres : `REFUSED:${r.reason}`; };

// --- witnesses: [sku, metres, what the row's own name or stored fact says] -------------------------------------------------
const WITNESSES: [string, number, string][] = [
  ["SFP-H10GB-CU3M", 3, "stored fact 3"], ["SFP-H10GB-CU1-5M", 1.5, "'passiv, 30 AWG, 1,5 m'"], ["SFP-H10GB-CU2.5M", 2.5, "'1.5m'-style name, 2.5m"],
  ["QSFP-H40G-CU0-5M", 0.5, "'passive, 0,5 m'"], ["QSFP-H40G-ACU10M=", 10, "active copper 10 m"], ["SFP-H10GB-ACU-7M", 7, "dash before the length"],
  ["QDD-400-CU2.5M", 2.5, "'Direktanschlusskabel 2,5 m'"], ["QSFP-100G-AOC30M", 30, "'Active Optical Cable (AOC) — 30 m'"],
  ["SFP-H10GB-CU1M1", 1, "'1-m 10G SFP+ Twinax cable assembly' — the trailing 1 is a version"],
  ["MA-CBL-100G-50CM", 0.5, "'Direktanschlusskabel 0,5 m'"], ["MA-CBL-40G-3M", 3, "'Direktanschlusskabel 3 m'"],
  ["ONS-SC+-10G-CU7=", 7, "'10GBASE-CU SFP+ Cable 7 Meter'"], ["ONS-CCC-100G-20=", 20, "'CXP-CFP MPO cable, 20m long'"],
  // breakout cables share the grammar
  ["QSFP-4SFP25G-CU1.5M", 1.5, "breakout"], ["QDD-4ZQ100CU1M", 1, "the dash-less token after a digit"], ["QSFP-4X10G-AC10M", 10, "active copper breakout"],
  // other vendors, where the SKU happens to carry it
  ["QDD-400G-DAC-2P5M", 2.5, "Juniper 'QSFP56-DD 400G DAC 2.5m' — P is the decimal point"], ["QFX-SFP-DAC-3MA", 3, "Juniper, A = active"],
  ["JNP-10G-AOC-3M", 3, "Juniper '10G SFP+ AOC, 3 Meters'"],
];
for (const [sku, m, why] of WITNESSES) eq(`${sku} is ${m} m (${why})`, len(sku), m);

// --- refusals --------------------------------------------------------------------------------------------------------------
const REFUSALS: [string, string, string][] = [
  ["SFP-H10GB-CUxx=", "range-or-family-row", "a placeholder length"],
  ["QSFP-100G-AOCxM", "range-or-family-row", "'length x - 1m to 30m'"],
  ["QSFP-H40G-AOCXM=", "range-or-family-row", "upper-case X"],
  ["SFP-H25G-CU1M/1.5M/2M", "range-or-family-row", "three lengths in one PID"],
  ["SFP-10G-AOC1M-10M", "range-or-family-row", "'1 Meter – 10 Meter'"],
  ["SFP-H10GB-CU", "range-or-family-row", "the family row with no length at all"],
  ["QSFP-100G-AOC", "range-or-family-row", "the family row"],
  ["SFP-H10GB-CU15M", "implausible-for-medium", "passive 10G twinax is not 15 m (beside the real CU1-5M)"],
  ["SFP-H10GB-CU25M", "implausible-for-medium", "passive 10G twinax is not 25 m (beside the real CU2-5M)"],
  ["QSFP-4SFP10G-CU10M", "implausible-for-medium", "a passive 10 m breakout — the 7 and 10 m ones are ACU"],
  ["PQSF2PXA1MBL", "no-length-token", "not Cisco grammar; its name says 1m, and the name is not this function's evidence"],
  ["SFP-10G-SR", "no-length-token", "an optic"],
  ["SFP-CU-RJ45=", "no-length-token", "a copper MODULE: a letter follows -CU-"],
  ["", "no-length-token", "empty"],
];
for (const [sku, reason, why] of REFUSALS) eq(`REFUSAL ${sku || "(empty)"}: ${why}`, len(sku), `REFUSED:${reason}`);

// --- registration: the cup is registered with its validation, and the validation names its disagreements -----------------
eq("cable_length is registered in DERIVED_FILL_PATHS", !!DERIVED_FILL_PATHS.cable_length, true);
eq("its validation sentence carries the disagreement count", /0 disagree/.test(DERIVED_FILL_PATHS.cable_length?.validated ?? ""), true);

// --- SABOTAGE: each guard of the REAL function, switched off, lets its refusal through --------------------------------------
{
  const saved = { RANGE: CABLE_LENGTH_GUARDS.RANGE, MAX: { ...CABLE_LENGTH_GUARDS.MAX } };
  CABLE_LENGTH_GUARDS.RANGE = /$^/;
  eq("SABOTAGE range guard off: SFP-H25G-CU1M/1.5M/2M reads as ONE 1 m cable", len("SFP-H25G-CU1M/1.5M/2M"), 1);
  CABLE_LENGTH_GUARDS.RANGE = saved.RANGE;
  CABLE_LENGTH_GUARDS.MAX = { ...saved.MAX, "passive-copper": 100 };
  eq("SABOTAGE medium bound off: SFP-H10GB-CU15M reads as a 15 m passive cable", len("SFP-H10GB-CU15M"), 15);
  CABLE_LENGTH_GUARDS.MAX = saved.MAX;
  eq("control: both guards restored", [len("SFP-H25G-CU1M/1.5M/2M"), len("SFP-H10GB-CU15M")],
    ["REFUSED:range-or-family-row", "REFUSED:implausible-for-medium"]);
}

lines.unshift(`    cable length: ${passed} passed, ${failed} missed (${WITNESSES.length} witnesses, ${REFUSALS.length} refusals, 3 sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
