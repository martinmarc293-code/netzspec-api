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
import { ucsKind, ucsToken, UCS_MACHINE, UCS_COMPONENT, UCS_KINDS, PRE_RULES, RULES, MACHINE_REFINE } from "../src/core/ucsKind.js";

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

// --- REFUSALS: three tokens removed from the os-license set, 10 Sep 2026 ---------------------------
// Each was in that set and each is real hardware. `UCSW` was generalised from ONE part
// (UCSW-WT-SMMR54) to the whole Whiptail/Invicta line — 279 parts, 143 of them naming hardware and
// 12 carrying their own physical facts. If one of these goes red, a token was readmitted and
// hundreds of blades, SSDs and adapters are classed as operating systems again.
for (const [sku, why] of [
  ["UCS-EZ-ENSC-B200", "SmartPlay pack: 'UCS B200 M3 Blade Server w/ 2650, 8x16GB, Dual VIC'"],
  ["UCS-EZ-300GB-HDD", "'300GB 6Gb SAS 10K RPM SFF HDD'"],
  ["UCS-SL-HANA-7", "'HANA Solution with 8 B440 M2 Blades'"],
  ["UCS-SL-VDI-B200-L", "'UCS VDI EXP B200 w/LSI400,2xE5-2680v2,128G'"],
  ["UCSW-SD480G0KA4-C", "'480GB 2.5 inch SATA SSD'"],
  ["UCSW-PCIE-IX5204", "'Intel Quad Port 10 GbE X520 Server Adapter'"],
  ["UCSW-RACK31X", "'UCS Invicta Rack With Side Panels'"],
] as [string, string][]) {
  const got = ucsKind(sku);
  eq(`not an OS licence: ${sku} — ${why.slice(0, 44)}`, got === "os-license", false);
}
// And the six that genuinely ARE operating systems keep a home: they are caught by the `-OS5.`
// SKU marker in productClass.ts, not by a token here. ucsKind itself makes no claim about them.
eq("ucsKind makes no os-license claim about UCSW-A-OS5.X-K9", ucsKind("UCSW-A-OS5.X-K9") === "os-license", false);

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

// --- servers (12 Sep 2026): the extensions, their refusals and one sabotage per rule family ----------------
// Every SKU is a live catalogue row. More refusals than positives, on purpose: each refusal is a real part a
// widened rule would misfile, read out of the same families.
const POS12: [string, string][] = [
  ["N20-PAC5-2500W=", "psu"], ["N20-BBLKD=", "accessory"], ["N20-FW018", "software"], ["N10-MGT016", "software"],
  ["UCS-IOM-2408", "io-module"], ["UCSX-I-9108-100G", "io-module"], ["X9108-IFM-100G", "io-module"],
  ["HXAF220C-M5SX", "server"], ["HX-E-240-M6SX", "server"], ["HCIAF220C-M7SN1", "server"], ["CSP-5444", "server"],
  ["CSP-CPU-5120", "cpu"], ["E-SSD-SATA-4TB", "drive"], ["UCS-HY16T61X-EV", "drive"], ["UCS-MP-128GS-A0", "memory"],
  ["UCSC-M-V100-04", "nic"], ["HX-M-V5Q50G", "nic"], ["UCSX-V5-BRIDGE-D=", "accessory"], ["UCS-S3260-HD8TB", "drive"],
  ["RC460-SLDRAIL-S", "accessory"], ["UCSX-S9108-100G", "fabric-interconnect"], ["HX-E-TOPO1", "non-product"],
  ["DDR5-4800", "non-product"], ["UCS-EZ-HANA-XL2", "bundle"], ["HX-STD-05", "bundle"],
];
for (const [sku, kind] of POS12) eq(`12 Sep: ${sku}`, ucsKind(sku), kind);
const REF12: [string, string, string][] = [
  // [sku, the kind it must NOT be, why]
  ["N20-C6508", "bundle", "the 5108 chassis; its token C6508 is a bundle token"],
  ["N20-C6508", "software", "N20-FW\\d is anchored"],
  ["C890-M5-SIOM-B", "io-module", "a server's system I/O card — no dash before IOM"],
  ["HXAF220C-BZL-M5S", "server", "'HXAF220C M5 Security Bezel' — the node rule needs -M<gen> after the model"],
  ["HX-E-220C-BZL-M5", "server", "an Edge bezel, not the Edge node"],
  ["HX-E-TOPO1", "server", "a topology choice"],
  ["UCSX-C-M6-HS-R", "software", "'CPU Heat Sink' — UCSX-C-SW-LATEST is exact"],
  ["UCSW-SD480G0KA4-C", "software", "'480GB 2.5 inch SATA SSD' — only UCSW-DDUP- is software"],
  ["C880-6T-M4", "drive", "'C880 M4 Server for SAP HANA 6T' — 6 TB of memory, not a drive"],
  ["UCSC-C3X60-56HD8", "drive", "the C3160 chassis; 56HD8 is a drive COUNT in the model"],
  ["UCSC-C240-M5SX", "drive", "a server; M5SX is a model segment"],
  ["UCSB-B200-M6++=", "accessory", "a blade"],
  ["HCI-ADGPU-240M6", "server", "'C240M6 GPU Air Duct' — HCI- then a dash is not a node"],
  ["HXAF2X0C-M5S", "server", "'Cisco Hyperconverged System' — a system bundle, 2X0 is not a model number"],
  ["UCS-EN120E208B/K9", "bundle", "'Promo UCS E-Series NCE' — a real E-Series module"],
  ["CSP-PSU1-1050W", "server", "a CSP power supply, not the CSP platform"],
  ["UCS-DIMM-BLK", "memory", "a DIMM blank"],
  ["E-MEM-16G", "drive", "UCS-E memory; only E-SSD-/E-HDD- are drives"],
  ["UCSX-V5-BRIDGE-D", "nic", "a VIC bridge, not a VIC"],
  ["DDR5-5600MT/s", "memory", "a speed enumerated as a part"],
  ["E5-2699", "cpu", "a CPU family enumerated as a part"],
  ["UCS-IOM2208-16FET", "chassis", "an I/O module, no longer the chassis"],
  ["N10-L003", "accessory", "an FI licence; the N10 token no longer names accessories"],
  ["HX-M6-AAS", "nic", "'Cisco+ Hybrid Cloud - M6 HX Bundle' — only the bare M token is a mLOM"],
  ["UCSC-C22-M3L", "accessory", "a rack server whose name says 'w/ rail kit' — the SKU carries no RAIL segment"],
];
for (const [sku, not, why] of REF12) eq(`12 Sep REFUSAL ${sku} is not ${not} — ${why.slice(0, 50)}`, ucsKind(sku) === not, false);
// SABOTAGE: disable each rule family and its own positive must change kind.
for (let i = 0; i < PRE_RULES.length; i++) {
  const probe = { software: "N10-MGT016", "non-product": "HX-E-TOPO1", "io-module": "UCS-IOM-2408", chassis: "N20-C6508",
    server: "HXAF220C-M5SX", drive: "E-SSD-SATA-4TB", accessory: "UCSX-V5-BRIDGE-D=" }[PRE_RULES[i].kind as string];
  if (!probe) { eq(`a sabotage probe exists for PRE_RULES[${i}]`, false, true); continue; }
  const before = ucsKind(probe);
  const [rule] = PRE_RULES.splice(i, 1);
  const after = ucsKind(probe);
  PRE_RULES.splice(i, 0, rule);
  eq(`SABOTAGE PRE_RULES ${rule.kind} off: ${probe} stops being ${before}`, after !== before, true);
}
{
  const saved = MACHINE_REFINE.splice(0, MACHINE_REFINE.length);
  eq("SABOTAGE MACHINE_REFINE off: UCS-S3260-HD8TB falls back to the S3260 server", ucsKind("UCS-S3260-HD8TB"), "server");
  MACHINE_REFINE.push(...saved);
  const drive = RULES.find((r) => r.kind === "drive")!;
  const i = drive.prefix!.indexOf("HY");
  drive.prefix!.splice(i, 1);
  eq("SABOTAGE drive prefix HY off: UCS-HY16T61X-EV is no longer a drive", ucsKind("UCS-HY16T61X-EV") === "drive", false);
  drive.prefix!.splice(i, 0, "HY");
  eq("control: restored, UCS-HY16T61X-EV is a drive again", ucsKind("UCS-HY16T61X-EV"), "drive");
}
eq("UCS_KINDS lists every kind exactly once", new Set(UCS_KINDS).size === UCS_KINDS.length, true);

lines.unshift(`    ucs kind: ${passed} passed, ${failed} missed ` +
              `(${HYPERFLEX.length} HyperFlex regressions, ${POS12.length} positives and ${REF12.length} refusals of 12 Sep, ${PRE_RULES.length + 2} sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
