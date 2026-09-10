// tests/switchKind.test.ts — what a switch-category part IS, from its SKU.
//
// `switches` asked 40.5 required fields of all 8,985 hardware parts — 363,773 slots, six times
// `security`. `kind` is the gate that stops a power cord being asked for a MAC table, so a wrong
// kind puts a part behind the wrong profile, which is the defect rather than the fix.
//
// THE HALF OF THIS FILE THAT MATTERS IS THE REFUSALS. The first version of switchKind carried
// `X`, `M` and `F` as whole-segment module markers — they look exactly like Cisco's line-card,
// supervisor and fabric letters. Measured against 8,985 real parts they had ZERO part-evidence
// between them and 44 device-evidence: `C6840-X` is a Catalyst 6800-X switch, `C9300-24S-M` is a
// modular-uplink switch, `WS-C4500X-F-16SFP+` is a front-to-back 4500-X. Every one is pinned
// below as a switch. If one goes red, a single letter has been readmitted as a kind and 44
// switches have had their real questions closed.
//
// Every SKU here comes from the catalogue. None is invented — an invented SKU tests my guess
// about the PID form rather than the rule.
import { switchKind, SW_DEVICE, SW_PART } from "../src/core/switchKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

// --- one per kind, all from the catalogue ---------------------------------------------------------
const CASES: [string, string][] = [
  // switches — the default, and correctly so
  ["C1300-8P-E-2G", "switch"],
  ["WS-C3750G-24T-E", "switch"],
  ["IE-2000-8TC-G-L", "switch"],
  ["N5K-C56128P", "switch"],
  ["C9300-48UXM", "switch"],
  // a modular CHASSIS is a device and carries no marker — it must fall through to `switch`
  ["WS-C4507R-E", "switch"],
  ["WS-C6509-V-E", "switch"],
  ["N6K-C6004", "switch"],
  // modules: line cards, supervisors, network/expansion/fabric modules
  ["WS-X4748-RJ45-E", "module"],
  ["WS-X6748-SFP", "module"],
  ["N7K-M108X2-12", "module"],
  ["C9600-LC-48TX", "module"],
  ["C3850-NM-4-1G", "module"],
  ["IEM-3000-8FM=", "module"],
  ["WS-X45-SUP7-E", "module"],
  ["N77-C7718-FAB-3", "module"],
  // power
  ["NXA-PAC-500W", "power"],
  ["C9K-PWR-1500WAC/2", "power"],
  ["NXA-PHV-1100W", "power"],
  ["WS-CAC-6000W", "power"],
  ["N3K-PDC-350W-B", "power"],
  // fan — including Nexus's single-fan SFAN, which a power rule used to swallow
  ["C9350-FAN-I=", "fan"],
  ["NXA-SFAN-30CFM-PI", "fan"],
  ["C9K-T2-FANTRAY", "fan"],
  ["WS-C6K-9SLOT-FAN2", "fan"],
  // cable and stacking
  ["CAB-9K16A-AUS", "cable"],
  ["CAB-SPWR-150CM", "cable"],
  ["C2960X-STACK", "cable"],
  // accessory
  ["REC-KIT-T1=", "accessory"],
  ["RCKMNT-1RU-2KX", "accessory"],
  ["C6800-PS-CVR", "accessory"],
  ["ME34X-PWR-BLANK", "accessory"],
  // software images
  ["N5KUK9-503N1.1", "software"],
  ["N3KUK9-602A8.8", "software"],
];
for (const [sku, kind] of CASES) eq(sku, switchKind(sku), kind);

// --- REFUSALS: the three deleted single-letter markers ---------------------------------------------
// Zero part-evidence, 44 device-evidence. These are model suffixes, airflow codes and reach codes.
const SINGLE_LETTER: string[] = [
  "C6840-X-LE-40G",        // Catalyst 6800-X backbone switch
  "N3K-C3064-X-ZZ-BD",     // Nexus 3064-X
  "C1-N9K-C92160YC-X",     // Nexus 9K fixed
  "C9300-24S-M",           // Catalyst 9300, "M" = modular uplink
  "ME-3600X-24FS-M",       // ME 3600X switch
  "C3850-48XS-F-S++",      // Catalyst 3850 48-port fibre switch
  "WS-C4500X-F-16SFP+",    // Catalyst 4500-X, "F" = front-to-back airflow
  "N2K-B22DELL-F",         // B22 fabric extender — a device
];
for (const sku of SINGLE_LETTER) eq(`single letter is not a kind: ${sku}`, switchKind(sku), "switch");

// --- REFUSALS: FAB is a fabric MODULE, not a chassis -----------------------------------------------
// `CHAS`/`CHASSIS` as a segment matches exactly one SKU in 8,985 and it is a MIB name, so there is
// no detectable chassis kind at all. All 25 N7X-*-FAB-n parts plug INTO a chassis.
for (const sku of ["N7K-C7010-FAB-2", "N77-C7706-FAB-3=", "N7K-C7018-FAB-2"]) {
  eq(`FAB is a module, not a chassis: ${sku}`, switchKind(sku), "module");
}

// --- REFUSALS: the ordering that fan/cable/accessory must win --------------------------------------
// Each of these carries a POWER token and none is a power supply. If one returns "power", the rule
// order has been changed and 27 fans plus a shelf of covers are behind the wrong profile.
eq("a StackPower CABLE is not a power supply", switchKind("CAB-SPWR-150CM"), "cable");
eq("a power/fan slot COVER is not a power supply", switchKind("ME34X-PWR-BLANK"), "accessory");
eq("NXA- is an accessory prefix, not a power one", switchKind("NXA-FAN-35CFM-PE"), "fan");

// --- degenerate input defaults to the safe side ----------------------------------------------------
// `switch` asks the most, so an unrecognisable SKU carries gaps rather than having them closed.
for (const sku of ["", "QQQ", "ZZ-NOSUCH-1"]) {
  eq(`defaults to switch: ${sku || "(empty)"}`, switchKind(sku), "switch");
}

// --- the two sets are disjoint, neither empty, and together they are every kind ---------------------
eq("device and part kinds do not overlap",
   SW_DEVICE.filter((k) => (SW_PART as readonly string[]).includes(k)).length, 0);
eq("there are device kinds", SW_DEVICE.length > 0, true);
eq("there are part kinds", SW_PART.length > 0, true);
// Every kind the function can return must be in one set or the other, or a new kind added later is
// silently asked nothing at all — the failure direction that closes a real switch's questions.
const REACHABLE = new Set(CASES.map(([, k]) => k));
for (const k of REACHABLE) {
  eq(`kind "${k}" is classified as device or part`,
     (SW_DEVICE as readonly string[]).includes(k) || (SW_PART as readonly string[]).includes(k), true);
}

lines.unshift(`    switch kind: ${passed} passed, ${failed} missed ` +
              `(${SINGLE_LETTER.length} single-letter refusals, 3 FAB refusals, 3 ordering refusals)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
