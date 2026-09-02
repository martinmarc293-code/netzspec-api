// scripts/universe/descriptionQuality.test.mjs
//
//   node scripts/universe/descriptionQuality.test.mjs
//
// Every case is a DELIBERATELY BROKEN description plus the reason it must be rejected for.
// A case rejected for the wrong reason counts as a miss -- passing by luck is not passing
// (CLAUDE.md section 3). The two real-world junk classes this validator exists for are cases
// 1 and 2: both were produced by the live extraction over the cache, 69 and 120 times.
//
// To confirm the validator is alive rather than vacuous: break a rule in
// lib/descriptionQuality.mjs and watch this go red.
import { describeQuality, isValidPid, isPlaceholderName } from "../../lib/descriptionQuality.mjs";

const CASES = [
  // [input, sku, expected reason]  -- rejections
  ["VOID", "SFP-10G-SR", "void_value"],
  ["SFP+ 10Gbps-RPHY; dist = ddK km; ITU nn.n", "SFP-10G-X", "placeholder:ddk"],
  ["Transceiver, reach nnn m", "X", "placeholder:nnn"],
  ["Module rated xx.x dBm", "X", "placeholder:xx.x"],
  ["TBD", "X", "void_value"],
  ["Description to be determined", "X", "placeholder:to be determined"],
  ["", "X", "empty"],
  ["   ", "X", "empty"],
  [null, "X", "missing"],
  ["abc", "X", "too_short"],
  ["N/A", "X", "void_value"],
  ["-", "X", "void_value"],
  ["WS-C3850-48P", "WS-C3850-48P", "same_as_sku"],
  ["C9300-48P=", "SOMETHING-ELSE", "pid_only"],
  ["Switch......", "X", "repeated_filler"],
  ["10/100/1000", "X", "not_prose"],
  ["x".repeat(401), "X", "too_long"],
  ["Placeholder text here", "X", "placeholder:placeholder"],

  // acceptances -- these must NOT be rejected
  ["Catalyst 2960-X 24 GigE PoE 110W, 2xSFP + 2x1GBT, LAN Base", "WS-C2960X-24PSQ-L", "ok"],
  ["MDS 9250i Accessory Kit for Cisco", "DS-9250I-KITCCO", "ok"],
  ["Cisco Catalyst 9300 48-port PoE+, Network Advantage", "C9300-48P", "ok"],
  ["10GBASE-SR SFP Module", "SFP-10G-SR", "ok"],
  ["Aruba 2530 48G PoE+ Switch", "J9772A", "ok"],
  // a legitimate description that CONTAINS a placeholder-looking substring inside a word
  ["Annnex A compliant VDSL module", "X", "ok"],
];

// Replacement part numbers. The prose cases are the real ones: Cisco writes instructions in
// the migration column, and the first pass stored "See Product Migration Options section for
// details." as AIR-AP2802E-CK910C's replacement PID, which would render as a link to a part
// that does not exist.
const PID_CASES = [
  ["See Product Migration Options section for details.", false],
  ["Contact your Cisco account team", false],
  ["", false],
  [null, false],
  ["-", false],
  ["N/A", false],
  ["Refer to the migration table.", false],
  ["SWITCH", false],                       // a word with no digit
  ["C9200CX-12P-2X2G-E", true],
  ["WS-C3850-48P", true],
  ["SFP-10G-SR=", true],
  ["J9772A", true],
  ["Z4", true],                            // Meraki short names must survive
  ["MV2", true],
];

// Generated placeholder names must read as absent, or nothing ever gets fixed.
const NAME_CASES = [
  ["Cisco 0.125K", "0.125K", true],
  ["Cisco WS-C3850-48P", "WS-C3850-48P", true],
  ["WS-C3850-48P", "WS-C3850-48P", true],
  ["", "X", true],
  ["Catalyst 2960-X 24 GigE PoE 110W", "WS-C2960X-24PSQ-L", false],
  ["C240 M7 2RU standard server with up to 28x SFF drive bays", "UCSC-C240-M7SX", false],
];

let pass = 0;
const misses = [];

for (const [input, want] of PID_CASES) {
  const got = isValidPid(input);
  if (got === want) pass++;
  else misses.push({ input: String(input).slice(0, 52), want: `pid=${want}`, got: `pid=${got}` });
}
for (const [name, sku, want] of NAME_CASES) {
  const got = isPlaceholderName(name, sku);
  if (got === want) pass++;
  else misses.push({ input: `${name} / ${sku}`.slice(0, 52), want: `placeholder=${want}`, got: `placeholder=${got}` });
}
for (const [input, sku, want] of CASES) {
  const got = describeQuality(input, sku);
  const gotReason = got.ok ? "ok" : got.reason;
  if (gotReason === want) {
    pass++;
  } else {
    misses.push({ input: String(input).slice(0, 52), want, got: gotReason });
  }
}

const TOTAL = CASES.length + PID_CASES.length + NAME_CASES.length;
console.log(`${pass}/${TOTAL} passed`);
if (misses.length) {
  console.log("\nMISSES (wrong reason counts as a miss):");
  for (const m of misses) console.log(`  ${JSON.stringify(m.input)}\n     want ${m.want}  got ${m.got}`);
  process.exit(1);
}
console.log("all cases rejected/accepted for the right reason");
