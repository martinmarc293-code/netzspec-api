// tests/componentKind.test.ts — the shared device/component axis for the eleven flat profiles.
//
// Eleven Cisco categories had a profile in which no conditional had ever fired: every part asked an
// identical set, so a power cord in `routers` was asked for a forwarding rate and a rack rail in
// `collaboration-endpoints` for an audio codec. This axis names what PLUGS INTO a device and
// defaults everything else to `device`, which fails safe — a component left as a device carries
// gaps, where a device called a component has its real questions CLOSED.
//
// THE REFUSALS ARE THE POINT, as in tests/switchKind.test.ts. Two orderings and two families were
// settled by measurement across 30,582 hardware parts, and each is pinned below.
//
// Every SKU here comes from the catalogue.
import { componentKind, GENERIC_DEVICE, GENERIC_COMPONENT } from "../src/core/componentKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, string][] = [
  // power
  ["PWR-GE-POE-4400", "power"],
  ["SB-PWR-48V-EU", "power"],
  ["PWR-IE3000-AC=", "power"],
  // fan
  ["P2HD-FAN-ASSY=", "fan"],
  ["CRS-16-FAN-CT++=", "fan"],
  // cable
  ["CAB-9K16A-AUS", "cable"],
  ["CAB-AC15A-90L-USA", "cable"],
  // accessory
  ["NC55-A1-ACC-KIT", "accessory"],
  ["8200-1RU-KIT", "accessory"],
  ["NCS-2RU-ACC-KIT", "accessory"],
  ["GS7K-STRND-KIT=", "accessory"],
  ["NCS-LIFT-BRKT", "accessory"],
  // software
  ["ASR5K-SW-R2119-K9", "software"],
  ["AIR-CT3504-SW-8.5", "software"],
  ["BE6K-9X-SW-K9=", "software"],
  ["ASR55-00-SW-UDPC18", "software"],
  // devices — the default, and correctly so
  ["ISR4331/K9", "device"],
  ["AIR-AP2802I-B-K9", "device"],
  ["N9K-C93180YC-EX", "device"],
  ["CP-8845-K9=", "device"],
  ["ASR5K-SMC-K9", "device"],
  // A KNOWN MISS, kept as a case so it is a recorded decision rather than an oversight:
  // ASR5K-PFU "ASR5000 Power Filter Unit" IS a power component and `PFU` is not a marker.
  // Exactly two parts in the catalogue carry that segment, which is below the bar every
  // other rule here meets (the smallest adopted family is 16), and the miss errs towards
  // asking MORE. If a third appears, this is the line to revisit.
  ["ASR5K-PFU", "device"],
];
for (const [sku, kind] of CASES) eq(sku, componentKind(sku), kind);

// --- REFUSAL: SOFTWARE IS TESTED LAST, and this is why -------------------------------------------
// switchKind tests software FIRST, because in that category an image PID can carry any family
// prefix. Applied to the other eleven that ordering misfiled these two: `SW` is a COUNTRY CODE in
// the first and part of a cable kit's PID in the second. If either goes red, the order was changed
// back and a Switzerland power cord is being called an operating system.
eq("a Switzerland power cord is POWER, not software", componentKind("AIR-PWR-CORD-SW"), "power");
eq("a cable kit is CABLE, not software", componentKind("CTS-5K-CBL-R1-SW"), "cable");

// --- REFUSAL: this axis claims NOTHING about modules ----------------------------------------------
// switchKind names line cards, supervisors and fabric modules; those markers are switch-family
// specific (N77-[MF]###, VS-S720-, WS-F6K-) and do not generalise. A module here must fall through
// to `device` — asking a line card too much is a recorded gap; asking it nothing closes real
// questions.
for (const sku of ["A9K-MOD400-SE", "NIM-2GE-CU-SFP", "SM-X-6X12G", "N9K-X9736C-FX"]) {
  eq(`makes no module claim: ${sku}`, componentKind(sku), "device");
}

// --- degenerate input defaults to the safe side ---------------------------------------------------
for (const sku of ["", "QQQ", "ZZ-NOSUCH-1"]) {
  eq(`defaults to device: ${sku || "(empty)"}`, componentKind(sku), "device");
}

// --- the two sets partition every kind the function can return -------------------------------------
eq("device and component kinds do not overlap",
   GENERIC_DEVICE.filter((k) => (GENERIC_COMPONENT as readonly string[]).includes(k)).length, 0);
const REACHABLE = new Set(CASES.map(([, k]) => k));
for (const k of REACHABLE) {
  eq(`kind "${k}" is classified as device or component`,
     (GENERIC_DEVICE as readonly string[]).includes(k) || (GENERIC_COMPONENT as readonly string[]).includes(k), true);
}

lines.unshift(`    component kind: ${passed} passed, ${failed} missed ` +
              `(2 ordering refusals, 4 module refusals, 3 degenerate)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
