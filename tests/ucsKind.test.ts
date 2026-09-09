// tests/ucsKind.test.ts — what a UCS part IS, from its SKU, and the cases that must NOT be guessed.
//
// This category asked 13 required fields of all 12,541 hardware parts and six were present on
// ZERO of them. At most 613 are machines; the rest are CPUs, DIMMs, drives, rails and OS licences
// being asked for a rack height. `kind` is the gate that stops that, so a wrong kind puts a part
// behind the wrong profile — which is the defect, not the fix.
//
// THE CASE THAT INVERTED THE FIRST DESIGN. HyperFlex writes the system name first and the kind
// second: `HX-B-NVMEHW-I3200` is a DRIVE and `HCIX-CPU-A9554P` is a CPU. Taking the first token
// filed 328 components as servers, and the tell was that the `server` bucket carried 328 COMPONENT
// facts and zero physical ones — the wrong way round for a machine. Every HyperFlex form is pinned
// below so that regression cannot come back silently.
import { ucsKind, ucsToken, UCS_MACHINE, UCS_COMPONENT } from "../src/core/ucsKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

// --- real SKUs from the catalogue, one per kind --------------------------------------------------
const CASES: [string, string][] = [
  // machines
  ["UCSC-C22-M3L", "server"],
  ["UCSB-B420-M4-U", "server"],
  ["UCSC-C240-M5SX", "server"],
  ["UCSB-5108-DC", "chassis"],
  ["N20-C6508", "chassis"],
  ["UCSC-C3X60-56HD8", "chassis"],
  ["UCS-FI-6454++", "fabric-interconnect"],
  ["UCS-FI-6248UP", "fabric-interconnect"],
  // components
  ["UCS-CPU-I6430=", "cpu"],
  ["UCSX-CPU-I4309YC=", "cpu"],
  ["UCSX-MRX16G1RE3=", "memory"],
  ["UCS-MR-2X041RY-B=", "memory"],
  ["UCS-SD38TK1X-EV=", "drive"],
  ["UCSC-M2RR-240M8", "drive"],
  ["UCS-PSU-6248UP-AC", "psu"],
  ["UCSC-GPU-P100-16G=", "gpu"],
  ["UCS-RAID9286CV-8E", "storage-controller"],
  ["UCSC-PCIE-B3SFP=", "nic"],
  ["UCSX-RIS-B-440P", "accessory"],
  ["CAB-C13-C14-AC=", "accessory"],
  // licences and bundles
  ["VMW-VS5-ENTP-5A", "os-license"],
  ["SLES-SVR-4S-1G-3A", "os-license"],
  ["UCS-SP7-SR-B420-V", "bundle"],
  ["UCSC-DBUN-C220-108", "bundle"],
];
for (const [sku, kind] of CASES) eq(`${sku}`, ucsKind(sku), kind);

// --- HYPERFLEX: the kind is in the SECOND segment ------------------------------------------------
// Each of these was filed as `server` by the first version. If one goes red, ucsToken stopped
// stripping the system prefix and 328 components are behind a machine's profile again.
const HYPERFLEX: [string, string][] = [
  ["HX-B-NVMEHW-I3200", "drive"],
  ["HX-SD480GH1-EV=", "drive"],
  ["HCIX-CPU-A9554P", "cpu"],
  ["HXAF-SD960G61X-EV", "drive"],
];
for (const [sku, kind] of HYPERFLEX) eq(`HyperFlex ${sku}`, ucsKind(sku), kind);
// The invented case `HX-M4-SP-FI` was removed: it tokenises to `M4`, so it was testing my guess
// about the SKU form rather than the rule. Every SKU in this file now comes from the catalogue.

// --- the token function itself -------------------------------------------------------------------
eq("token strips UCSC-", ucsToken("UCSC-C220-M5SX"), "C220");
eq("token strips UCS-", ucsToken("UCS-MR-X32G1RW"), "MR");
eq("token strips the HyperFlex system AND its form letter", ucsToken("HX-B-NVMEHW-I3200"), "NVMEHW");
eq("a SKU with no dash yields itself", ucsToken("SAS3"), "SAS3");

// --- REFUSALS: never guess ------------------------------------------------------------------------
// `unknown` is a real answer. A part the rules do not name is asked nothing it might not have,
// which is the same default `security` uses for an unshaped series. Guessing is how a DIMM ends up
// behind a server's profile.
for (const sku of ["ZZ-NOSUCH-1", "QQQ", "", "UCS-XYZZY-9"]) {
  eq(`refuses to guess: ${sku || "(empty)"}`, ucsKind(sku), "unknown");
}

// --- the two sets are disjoint, and neither is empty -----------------------------------------------
eq("machine and component kinds do not overlap",
   UCS_MACHINE.filter((k) => (UCS_COMPONENT as readonly string[]).includes(k)).length, 0);
eq("there are machine kinds", UCS_MACHINE.length > 0, true);
eq("there are component kinds", UCS_COMPONENT.length > 0, true);

lines.unshift(`    ucs kind: ${passed} passed, ${failed} missed ` +
              `(${HYPERFLEX.length} HyperFlex regressions, 4 refusals)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
