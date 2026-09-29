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
import { ucsKind, ucsToken, UCS_MACHINE, UCS_COMPONENT, UCS_KINDS, PRE_RULES, RULES, MACHINE_REFINE, MLB_GENERATION } from "../src/core/ucsKind.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js"; // kind-layer (13 Sep 2026)

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
  ["UCSC-C3X60-BASE", "chassis"],
  ["UCS-FI-6454++", "fabric-interconnect"],
  ["UCS-FI-6248UP", "fabric-interconnect"],
  // components
  ["UCS-CPU-I6430=", "cpu"],
  ["UCSX-CPU-I4309YC=", "cpu"],
  ["UCSX-MRX16G1RE3=", "memory"],
  ["UCS-MR-2X041RY-B=", "memory"],
  ["UCS-SD38TK1X-EV=", "drive"],
  ["UCSC-M2RR-240M8", "drive"],
  ["UCS-PSU-6248UP-AC", "power"], // kind-layer (13 Sep 2026): psu -> power
  ["UCSC-GPU-P100-16G=", "gpu"],
  ["UCS-RAID9286CV-8E", "storage-controller"],
  ["UCSC-PCIE-B3SFP=", "nic"],
  ["UCSX-RIS-B-440P", "accessory"],
  ["CAB-C13-C14-AC=", "power-cord"], // Batch B (29 Sep 2026): a mains cord is a power-cord (was `cable`: the axis had no cord kind)
  ["UCSB-CABL-C19-BRZ", "power-cord"], // the C19 inlet token catches the cord a CAB- rule cannot ("NBR 14136 to C19 ... Power Cord, Brazil")
  ["CBL-GPU-C240M6", "cable"], // CONTROL: an internal GPU cable stays a cable (C240 is a server token, not an inlet)
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
  ["N20-PAC5-2500W=", "power"], ["N20-BBLKD=", "accessory"], ["N20-FW018", "software"], ["N10-MGT016", "software"],
  ["UCS-IOM-2408", "io-module"], ["UCSX-I-9108-100G", "io-module"], ["X9108-IFM-100G", "io-module"],
  ["HXAF220C-M5SX", "server"], ["HX-E-240-M6SX", "server"], ["HCIAF220C-M7SN1", "server"], ["CSP-5444", "server"],
  ["CSP-CPU-5120", "cpu"], ["E-SSD-SATA-4TB", "drive"], ["UCS-HY16T61X-EV", "drive"], ["UCS-MP-128GS-A0", "memory"],
  ["UCSC-M-V100-04", "nic"], ["HX-M-V5Q50G", "nic"], ["UCSX-V5-BRIDGE-D=", "accessory"], ["UCS-S3260-HD8TB", "drive"],
  ["RC460-SLDRAIL-S", "accessory"], ["UCSX-S9108-100G", "fabric-interconnect"], ["HX-E-TOPO1", "non-product"],
  ["DDR5-4800", "non-product"], ["UCS-EZ-HANA-XL2", "bundle"], ["HX-STD-05", "bundle"],
  // round-7 addendum K/L (12 Sep 2026)
  ["DN3-HW-APL-XL", "server"], ["DN3-HW-APL-XL=", "server"], ["DN3-P-I8D25GF", "nic"], ["APIC-P-ID10GC", "nic"], ["APIC-O-ID10GC", "nic"],
];
for (const [sku, kind] of POS12) eq(`12 Sep: ${sku}`, ucsKind(sku), kind);
const REF12: [string, string, string][] = [
  // [sku, the kind it must NOT be, why]
  // THE CHECK THE OPERATOR NAMED: the DN/APIC-prefixed part already in servers-unified-computing is a DRIVE.
  ["APIC-SD100G0KA2-E", "nic", "'100G SATA 2.5 inch Enterprise Performance SSD' — -[PO]- must be a whole segment"],
  ["APIC-SD100G0KA2-E", "server", "'100G SATA ... SSD' — only DN3-HW-APL- is a server"],
  ["N20-C6508", "bundle", "the 5108 chassis; its token C6508 is a bundle token"],
  ["N20-C6508", "software", "N20-FW\\d is anchored"],
  ["C890-M5-SIOM-B", "io-module", "a server's system I/O card — no dash before IOM"],
  ["HXAF220C-BZL-M5S", "server", "'HXAF220C M5 Security Bezel' — the node rule needs -M<gen> after the model"],
  ["HX-E-220C-BZL-M5", "server", "an Edge bezel, not the Edge node"],
  ["HX-E-TOPO1", "server", "a topology choice"],
  ["UCSX-C-M6-HS-R", "software", "'CPU Heat Sink' — UCSX-C-SW-LATEST is exact"],
  ["UCSW-SD480G0KA4-C", "software", "'480GB 2.5 inch SATA SSD' — only UCSW-DDUP- is software"],
  ["C880-6T-M4", "drive", "'C880 M4 Server for SAP HANA 6T' — 6 TB of memory, not a drive"],
  // RULING Q17, the read triples (29 Sep 2026): the 12 Sep refusal here -- "UCSC-C3X60-56HD8 is the C3160 chassis; 56HD8 is a
  // drive COUNT" -- read the SKU without its name. The name is "UCS C3X60 4 rows of 8TB NL-SAS 7200 RPM SAS-3 (56Total) 448TB": the
  // drive rows ordered INTO the chassis, whose own PID is UCSC-C3X60-BASE ("Cisco UCS C3160 Base Chassis"). Refusals now:
  ["UCSC-C3X60-BASE", "drive", "the C3160 base chassis stays the chassis"],
  ["UCSC-C3X60-SVRN1", "drive", "a C3X60 server node stays a server (Q17 R2)"],
  ["C880-2T-M4", "memory", "'C880 M4 Server for SAP HANA 2T Scale out' -- 2 TB of memory IN a server, not a DIMM kit"],
  ["C880-3T-HANA-J-M5", "memory", "'C880 M5 v5 8S 3TB 64GB DIMMs and Platinum 8176' -- a HANA system"],
  ["C880-FBU-CBL", "mechanical", "'C880 M4 FBU Cable' stays a cable"],
  ["C880-J-17-M4", "drive", "'Attached JBOD for SAP HANA 2T' is the enclosure (chassis), not a disk"],
  ["UCSC-C3K-NV16", "server", "'C3000 1.6TB NVMe SSD for M4 Server Node' stays a drive"],
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

// --- device-noun (13 Sep 2026): the machines and cards the device-noun census found asked nothing ------------
// Every positive is a row of the 158; every refusal is the NEAREST live row the new rule must not take, read out
// of the same family (the full kind diff over every live UCS-axis row is in the session report).
const POS13: [string, string][] = [
  // kind-layer (13 Sep 2026): the generation MLBs are `bundle` (III.0 item 4 §7b) — see the PRE_RULE note in ucsKind.ts
  ["UCSX-M7-MLB", "bundle"], ["UCS-M6-MLB", "bundle"], ["UCSXE-M8-MLB", "bundle"], ["UCS-MGPUM8-MLB", "bundle"],
  ["HX-UCSCM6-MLB", "bundle"], ["UCSX-M8-MLB", "bundle"],
  ["UCSXE-130C-M8-20", "server"], ["UCSXE-150C-M8-32-U", "server"],
  ["UCSXE-9305=", "chassis"], ["UCSXE-9305-U", "chassis"], ["HCIXENX-9305-U", "chassis"],
  ["UCSC-C3260", "chassis"], ["UCSC-C3160", "chassis"], ["UCSC-C3160-SIOC=", "io-module"], ["UCSC-C3260-SIOC", "io-module"],
  ["UCSX-FS-9516", "io-module"], ["UCSC-BASE-M2-C460", "server"], ["UCS-EPNM-C220M4S", "server"],
  ["PLHC-CI-5108-1A", "chassis"], ["PLHC-MLOM-40G-04", "nic"], ["PLHC-MRAID12G", "storage-controller"],
  ["UCSC-NYTRO-200GB=", "storage-controller"],
  // ruling Q17 R2 (29 Sep 2026): MRAID / MLOM before memory; the S3260 drive spellings; the C3X60 server nodes; the RAID supercaps
  ["UCSB-MRAID12G", "storage-controller"], ["HX-B-MRAID12G-HE", "storage-controller"], ["UCSB-MLOM-40G-01", "nic"], ["HCI-MLOM-M6", "nic"],
  ["UCS-S3260-HD8TA", "drive"], ["UCS-S3260-10TARR", "drive"], ["UCS-S3260-HDT14TR", "drive"], ["UCS-S3260-HDW18T=", "drive"],
  ["UCSC-C3X60-SVRN1", "server"], ["UCSC-C3X60-SVRNB=", "server"], ["UCSC-MRAID-SC", "mechanical"], ["UCSX-MRAID-SC=", "mechanical"],
];
for (const [sku, kind] of POS13) eq(`13 Sep: ${sku}`, ucsKind(sku), kind);
const REF13: [string, string, string][] = [
  ["UCS-C4200-MLB", "server", "'UCS 4200 MLB' — a chassis line; the MLB rule is anchored on a GENERATION token"],
  ["UCS-TEST-MLB", "server", "'UCS Test MLB' — no generation, a test PID"],
  ["UCS-DGPUM8-MLB", "server", "a bare name and no document: DGPU is not read into a kind"],
  ["HX-M6-AAS", "server", "'Cisco+ Hybrid Cloud - M6 HX Bundle' — M6 without -MLB"],
  ["UCSXE-PSU-2400W", "server", "an XE supply: only the XE130c/XE150c nodes are named"],
  ["UCSXE-GPU-L4", "chassis", "an XE GPU: only the bare XE9305 is the chassis"],
  ["UCSC-C3160-400SSD", "chassis", "'UCS C3160 400GB ... SSD' — a whole-SKU anchor, not the C3160 token"],
  ["UCSC-C3160-BEZEL", "chassis", "'Cisco UCS C3160 System Bezel'"],
  ["UCSC-C3160-BEZEL", "io-module", "a bezel is not the SIOC"],
  // kind-layer (13 Sep 2026): UCSC-BASE-C460-CH2 "Disti:C460,w/o CPU, HSnk, Mem, HD, PCIe, PSU, w/Rls, Blnk" was READ in the
  // III.0 item-6 family "PCIe node / configured servers" and is a base server — this refusal is withdrawn (positive below).
  ["PLHC-FI-D2-RES", "fabric-interconnect", "'Cisco+ Hybrid Cloud Reserve for HX Fabric Interconnect' — a reservation"],
  ["PLHC-MLOM-PT-01", "nic", "'Cisco+ UCS Port Expander Card (mezz) for VIC' — MLOM- then a digit only"],
  ["PLHC-HXN-GW-5Y-RES", "chassis", "a Cisco+ reservation licence"],
  ["UCSC-XPAND-C24", "storage-controller", "'SAS Expander' — NYTRO is its own token, SAS stays where it was"],
];
for (const [sku, not, why] of REF13) eq(`13 Sep REFUSAL ${sku} is not ${not} — ${why.slice(0, 50)}`, ucsKind(sku) === not, false);
// --- layers round 3 (15 Sep 2026): the R42610 rack's mechanical parts (seven base / spare pairs disagreed) and the rows the
// servers round's device check found in shared parts with a machine kind they are not. Every SKU is a live catalogue row.
const POS15: [string, string][] = [
  ["RACK-BAR-001", "mechanical"], ["RACK-BAR-001=", "mechanical"], ["RACK-DOOR-002=", "mechanical"], ["RACK-HW-001", "mechanical"],
  ["RACK-LOCK-001=", "mechanical"], ["R2XX-DMYMPWRCORD", "non-product"], ["R2XX-DMYMPWRCORD=", "non-product"],
  ["UCS-S3348-HBAM5", "storage-controller"], ["UCS-S3348-HBAM5=", "storage-controller"], ["UCS-S3X48-FAN", "fan"], ["UCS-S3X48-FAN=", "fan"],
];
for (const [sku, kind] of POS15) eq(`15 Sep: ${sku}`, ucsKind(sku), kind);
const REF15: [string, string, string][] = [
  ["RACK-FOOT-001=", "mechanical", "'Front caster, fixed' — the rule names the bar, doors, hardware kit, locks and side panel only"],
  ["RACK-BADGE-001=", "mechanical", "'Badge w/Cisco logo'"],
  ["R2XX-PL003", "non-product", "'LSI 6G MegaRAID 9261-8i card' — a real controller; only the no-power-cord setting is named"],
  ["R2XX-PSUBLKP", "non-product", "'Power supply unit blanking panel' — a real part"],
  ["UCS-S3348-RAIDM5", "fan", "'UCS S3348 Raid Controller' — stays a storage controller"],
  ["UCS-S3X48-SNM5-HS", "fan", "'UCS SX348 M5 Heatsink' — FAN is anchored to the whole SKU"],
];
for (const [sku, not, why] of REF15) eq(`15 Sep REFUSAL ${sku} is not ${not} — ${why.slice(0, 50)}`, ucsKind(sku) === not, false);
// SABOTAGE: disable each rule family and its own positive must change kind.
for (let i = 0; i < PRE_RULES.length; i++) {
  // round-7 addendum (12 Sep 2026): a probe per RULE, not per kind — two rules now return `server`, and the
  // kind-keyed map handed DN3-HW-APL- the HyperFlex probe, which that rule never matches.
  const PROBES = ["N10-MGT016", "HX-E-TOPO1", "UCS-IOM-2408", "N20-C6508", "HXAF220C-M5SX", "DN3-HW-APL-XL",
    "DN3-P-I8D25GF", "E-SSD-SATA-4TB", "UCSX-V5-BRIDGE-D=",
    // device-noun (13 Sep 2026): one probe per new rule
    "UCSX-M7-MLB", "UCSXE-130C-M8-20", "UCSXE-9305=", "UCSC-C3260", "UCSC-C3160-SIOC", "UCSX-FS-9516",
    "UCSC-BASE-M2-C460", "PLHC-CI-5108-1A", "PLHC-MLOM-40G-04", "PLHC-MRAID12G",
    // kind-layer (13 Sep 2026): one probe per new rule
    "CSP-5200=", "UCSX-M2-HWRAID", "R250-PL003", "UCSC-RC-1M-C260", "UCS-STM-C240M4-L2", "UCS-C3260-SA-D",
    "HX-DH-FI6332-16UP", "A02-MEMKIT-008A", "UCSXS960G6I1XEV-D", "R200-DISTIPSU-650W", "RP208-30-2P-U-2",
    "UCSW-WT-IM2P", "CR2032", "N1K-VSG-UCS-BUN",
    // layers round 3 (15 Sep 2026): one probe per new rule
    "RACK-BAR-001=", "R2XX-DMYMPWRCORD", "UCS-S3348-HBAM5", "UCS-S3X48-FAN=",
    // re-audit decisions (operator, 15 Sep 2026, Q-13): the SRE engine rule (off, the bundle component reads `bundle`), and the exact kinds of
    // the rows planned in (off, the E100 prefix reads `server` and the SRE spare disk falls to the token)
    "ISM-SRE-300-BUN-K9", "E100-FCPLT-BRKT=", "E100S-CON-DGL", "E100S-MEM-UDIMM8G=", "SM-DSK-SATA-500GB=",
    // Batch B (29 Sep 2026): the power-cord rule -- off, the cord falls to the CAB token and reads `cable` again
    "CAB-C13-C14-AC=",
    // Q17 R2 (29 Sep 2026): the RAID supercap rule -- off, UCSC-MRAID-SC falls to the MRAID token and reads storage-controller
    "UCSC-MRAID-SC",
    // Q17, the read triples (29 Sep 2026): one probe per family rule -- off, each falls to its machine token (C880 server,
    // C3X60 chassis, C3K drive) or to the PCI token (nic)
    "C880-J-17-M4", "C880-128-2X64-BW", "C880-E78890B", "C880-16GFC-L202", "C880-SASCONTR", "C880-J-1.2TB", "C880-FAN-UNIT",
    "C880-PSU", "C880-SFPMOD", "C880-MIDPLN", "UCSC-C3X60-56HD8", "UCSC-C3X60-HBA", "UCSC-C3X60-FANM=", "UCSC-C3X60-BLKP",
    "UCSC-C3K-M4SRB", "UCSC-C3K-M4IO=", "UCSC-C3K-M4IOTOOL=", "UCS-PCI25-8003"];
  const probe = PROBES.find((p) => PRE_RULES[i].re.test(p.toUpperCase().replace(/=+$/, "")));
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
  // device-noun (13 Sep 2026): the NYTRO token is load-bearing
  // the rule that CARRIES NYTRO, not the first storage-controller rule: Q17 R2 put an MRAID-only rule ahead of memory
  const sc = RULES.find((r) => r.kind === "storage-controller" && (r.prefix ?? []).includes("NYTRO"))!;
  const j = sc.prefix!.indexOf("NYTRO");
  sc.prefix!.splice(j, 1);
  eq("SABOTAGE storage-controller prefix NYTRO off: UCSC-NYTRO-200GB is no longer a controller", ucsKind("UCSC-NYTRO-200GB") === "storage-controller", false);
  sc.prefix!.splice(j, 0, "NYTRO");
  eq("control: restored, UCSC-NYTRO-200GB is a storage-controller again", ucsKind("UCSC-NYTRO-200GB"), "storage-controller");
  // Q17 R2: the MRAID / MLOM rules AHEAD of memory are load-bearing -- off, memory's MR / ML prefixes take the cards back
  for (const [tok, sku] of [["MRAID", "UCSB-MRAID12G"], ["MLOM", "UCSB-MLOM-40G-01"]] as const) {
    const k = RULES.findIndex((r) => r.prefix?.length === 1 && r.prefix[0] === tok);
    const before = ucsKind(sku); const [rule] = RULES.splice(k, 1); const after = ucsKind(sku); RULES.splice(k, 0, rule);
    eq(`SABOTAGE the ${tok}-before-memory rule off: ${sku} falls back to memory`, k >= 0 && before !== "memory" && after === "memory", true);
  }
}
eq("UCS_KINDS lists every kind exactly once", new Set(UCS_KINDS).size === UCS_KINDS.length, true);

// --- kind-layer (13 Sep 2026): the III.0 item-6 read of `unknown`, the item-4 §7b read of `server`, the rename -------------
// Every SKU is a live row of those reads (or of the rows the same rule family moved, listed in the kind-layer kind diff).
const POS_KL: [string, string][] = [
  // the rename, and the kinds the SKU axis names now
  ["UCSC-PSU1-770W", "power"], ["UCSXE-PSU-2400W", "power"], ["UCSAI-PSU-3200W", "power"], ["PLHC-N01-UAC1", "power"],
  ["R200-DISTIPSU-650W", "power"],
  ["CBL-SAS24-C240M7", "cable"], ["UCS-240CBLMR8=", "cable"], ["UCSC-GPUCBL-88S", "cable"], ["XDACBL3M", "cable"],
  ["CB-LC-LC-MMF1M=", "cable"], ["N20-BKVM-D", "cable"], ["UCSC-RC-P8M-C260=", "cable"], ["C880-J-SASCBL", "cable"],
  ["UCSX-C-DEBUGCBL=", "cable"], ["SASCBLSHORT-003", "cable"],
  ["UCSC-FAN-C240M6=", "fan"], ["N20-FAN5=", "fan"], ["UCSXE-TPM-002D", "tpm"], ["UCSX-TPM2-002D", "tpm"],
  ["RP208-30-2P-U-2", "pdu"], ["RP208-30M1P-4-8=", "pdu"], ["C16-2PDU", "pdu"],
  // NVE drives (46 spec-held rows were `unknown`) and the other drive shapes
  ["UCSX-NVE17T6K2V9", "drive"], ["UCS-NVE112T8K1P", "drive"], ["UCSXE-NVE13T8K1V", "drive"], ["UCSAI-NVES3T8M1V", "drive"],
  ["UCSXE-M2-240G", "drive"], ["UCSSD960GBM2NK9-D", "drive"], ["UCSXS960G6I1XEV-D", "drive"], ["CS-EZ-3TB-HDD", "drive"],
  // the M.2 boot RAID controller family (was `drive`) and the LSI cards
  ["UCSX-M2-HWRAID", "storage-controller"], ["UCS-M2-HWRAID-D=", "storage-controller"], ["UCSX-M2I-HWRD-FPS", "storage-controller"],
  ["UCSXE-M2-HWRD2", "storage-controller"], ["R250-PL003", "storage-controller"], ["R2XX-PL003-CBL=", "storage-controller"],
  ["R2X0-ML002=", "storage-controller"], ["R210-MEZZCBL003=", "storage-controller"], ["UCSC-PSAS12GHBA", "storage-controller"],
  ["UCSC-9500-8E-D", "storage-controller"],
  // components by their own token once the system prefix is stripped
  ["UCSXE-GPU-L4", "gpu"], ["CAI-GPU-MI210", "gpu"], ["UCSXE-MRX16G1RE5", "memory"], ["UCS-MCX32G2RE11", "memory"],
  ["A02-MEMKIT-016B", "memory"], ["UCSAI-CPU-I6776P", "cpu"], ["UCSXE-P-I8D25GF", "nic"], ["UCSAI-P-NC3220", "nic"],
  ["UCSW-WT-IM2P", "nic"], ["UCSW-WT-IM4P", "nic"], ["N20-AI0102=", "nic"],
  // machines the item-6 read placed, and the §7b corrections
  ["UCS-STM-C240M4-L2", "server"], ["UCS-EM-B200M4-1S", "server"], ["UCSSPENVPB200M3-RL", "server"], ["KIN-UCSM5-2RU-K9=", "server"],
  ["UCSC-BASE-C460-CH2", "server"], ["HXAF-E-220M6S", "server"], ["HXAF225-M6S", "server"], ["HX-DH-C240M5L-01", "server"],
  ["UCSX-9508=", "chassis"], ["HCIX-9508=", "chassis"], ["CSP-5200=", "chassis"], ["CSP-5400=", "chassis"], ["UCS-C3260-SA-D", "chassis"],
  ["HX-DH-FI6332-16UP", "fabric-interconnect"], ["HCIX-FS-9516-U", "io-module"],
  ["HX-C480-CM=", "accessory"], ["C880-BAT-CR2032=", "accessory"], ["UCSAI-880A-HS", "accessory"], ["C885A-M8-H2SX-SLD", "accessory"],
  ["CR2032", "accessory"], ["UCS-M5-CPU-CAR=", "accessory"], ["UCSX-580P-U", "accessory"], ["UCSX-M8A-HS-F", "accessory"],
  ["PP-2RU-CHAS", "accessory"], ["UCSXE-SHLFMT-BKT", "accessory"], ["UCS-DDR5-BLK=", "accessory"], ["RC460-CBLARM=", "accessory"],
  ["UCS-DCPMM-AD", "non-product"], ["N1K-VSG-UCS-BUN", "bundle"], ["UCSC-EPOD-C220E-S", "bundle"], ["UCS-DGPUM8-MLB", "bundle"],
];
for (const [sku, kind] of POS_KL) eq(`kind-layer: ${sku}`, ucsKind(sku), kind);
const REF_KL: [string, string, string][] = [
  // [sku, the kind it must NOT be, why]
  ["UCSC-CBLKP", "cable", "'blanking panel' — CBLK is the blank family, the cable token is CBL(?!K)"],
  ["RC-460-TIM=", "cable", "'C460 Thermal Interface Pad' — RC is not a cable token on its own"],
  ["RC460-CBLARM=", "cable", "'CABLE MANAGEMENT ARM FOR C460 M1'"],
  ["HX-RIS-CBL-M5SD", "cable", "a riser token first: RIS stays an accessory token"],
  ["UCSXE-M2-240G", "storage-controller", "a real M.2 drive — no HWR segment"],
  ["UCSAI-M2-960G", "storage-controller", "a real M.2 drive"],
  ["UCSC-C220-M5SX", "accessory", "a server whose model segments carry no HS/SLD/CM/BAT segment"],
  ["UCSC-880A-M8-B303", "accessory", "the C880A server itself (UCSAI- is its components, not the machine)"],
  ["CSP-5228", "chassis", "'1RU NFV Platform 2 CPU-28 cores' — only 5200/5400 are the empty chassis"],
  ["CBL-SAS24-C240M7", "server", "a C240M7 cable: a model token alone does not make a configured node"],
  ["UCSC-HS-C240M7", "server", "a heat sink carrying the model token"],
  ["UCS-MAH-B00R00-M6", "server", "'Microsoft Azure Stack MX HCI Bundle' — UCS-MA-<model> needs the dash"],
  ["UCS-C4200-MLB", "bundle", "'UCS 4200 MLB' — a chassis token; only generation MLBs are named"],
  ["UCSX-NVL2-H200", "gpu", "placeholder name: NVL2-H200 is the H200 NVL GPU or its 2-way NVLink bridge, and the SKU does not say"],
  ["UCSC-E3S1T-F", "drive", "placeholder name: an E3.S 1T drive or a filler — not guessed"],
  ["UCSC-LPC25-1485-D", "nic", "placeholder name: not guessed"],
  ["DDR5-5600MT/s", "accessory", "a speed enumerated as a part (non-product PRE_RULE), not the DDR5 blank"],
  ["CIUS-BATTERY=", "power", "an accessory by SKU (the name marker, not this axis, files named batteries with supplies)"],
];
for (const [sku, not, why] of REF_KL) eq(`kind-layer REFUSAL ${sku} is not ${not} — ${why.slice(0, 60)}`, ucsKind(sku) === not, false);
// SABOTAGE on the token-level changes: the system-prefix strip, the spare `=`, the NVE prefix and the cable regex
{
  const drive = RULES.find((r) => r.kind === "drive")!;
  const i = drive.prefix!.indexOf("NVE");
  drive.prefix!.splice(i, 1);
  eq("SABOTAGE drive prefix NVE off: UCSX-NVE17T6K2V9 is no longer a drive", ucsKind("UCSX-NVE17T6K2V9") === "drive", false);
  drive.prefix!.splice(i, 0, "NVE");
  const cable = RULES.find((r) => r.kind === "cable")!;
  const re = cable.re;
  cable.re = undefined;
  eq("SABOTAGE cable token regex off: UCS-240CBLMR8 is no longer a cable", ucsKind("UCS-240CBLMR8") === "cable", false);
  cable.re = re;
  eq("control: cable regex restored", ucsKind("UCS-240CBLMR8"), "cable");
}
eq("the system-prefix strip: UCSXE-PSU-2400W tokenises to PSU", ucsToken("UCSXE-PSU-2400W"), "PSU");
eq("the system-prefix strip: UCSAI-CPU-I6776P tokenises to CPU", ucsToken("UCSAI-CPU-I6776P"), "CPU");
eq("the SD glue: UCSSD960GBM2NK9-D tokenises to SD960GBM2NK9", ucsToken("UCSSD960GBM2NK9-D"), "SD960GBM2NK9");
eq("the kind is read without the spare `=`: UCSX-9508= is the chassis UCSX-9508 is", ucsKind("UCSX-9508="), ucsKind("UCSX-9508"));
eq("MLB_GENERATION is the regex the bundle PRE_RULE uses", PRE_RULES.some((r) => r.re === MLB_GENERATION && r.kind === "bundle"), true);
eq("UCS_KINDS names power, cable, fan, tpm and pdu, and no longer psu",
  ["power", "cable", "fan", "tpm", "pdu"].every((k) => (UCS_KINDS as readonly string[]).includes(k)) && !(UCS_KINDS as readonly string[]).includes("psu"), true);

// --- kind-layer (13 Sep 2026): the question sets, asserted where they are resolved (kindQuestionSet) ---------------------
// Today's required set stays, and the spec library's proposed required cups are added (operator instruction; the parent
// decides each on the printed measurement). One set per kind in all three UCS-axis categories, except the named
// hyperconverged-systems `server` exception (emc_emissions, humidity_storage).
{
  const req = (cat: string, kind: string) => [...kindQuestionSet(cat, kind).required].sort().join(",");
  const WANT: Record<string, string[]> = {
    // dimm_slots and pcie_slots DEMOTED to `opt` on 25 Sep 2026 (operator: "go with your recommendation"), measured
    // across all vendors: zero facts under either key anywhere, ever, and no enabled source publishes the label —
    // 1,982 servers + 208 HX + 57 HCI parts were carrying a cup nothing could fill, so they could never read complete.
    // docs/decisions/2026-09-25-required-cups-no-source-can-fill.md. Same shape as the `drive` line below.
    // emc_emissions + humidity_storage JOINED 29 Sep 2026 (kind parity, Batch B): the hyperconverged-systems exception became
    // the rule once collab asked it too -- the server group is five categories (PARITY_WIDENINGS).
    server: ["altitude_max", "certifications", "cpu", "cpu_sockets_max", "dimensions", "drive_bays", "emc_emissions", "form_factor", "humidity_operating", "humidity_storage", "memory_max", "memory_speed_max", "power_max", "temp_operating", "temp_storage", "weight"],
    power: ["airflow", "input_voltage", "product_compatibility", "psu_rated_output"],
    fan: ["airflow", "product_compatibility"],
    cable: ["cable_length", "connector", "media", "product_compatibility"],
    drive: ["drive_interface", "product_compatibility", "storage_capacity"], // reviewer C.3: drive_form_factor optional (0 labels)
    gpu: ["power_max", "product_compatibility", "tdp"], // reviewer C.3: gpu_memory optional (0 labels)
    nic: ["data_rate", "ports", "product_compatibility"],
    "storage-controller": ["drive_interface", "product_compatibility"],
    "io-module": ["data_rate", "ports", "product_compatibility"],
    // rack_units JOINED 29 Sep 2026 (ruling Q1, the chassis union): asked of the chassis kind UNGATED -- the form_factor gate
    // stays for servers (rack or blade); a chassis is rack-mounted by definition.
    chassis: ["altitude_max", "certifications", "dimensions", "form_factor", "humidity_operating", "module_slots", "power_max", "product_compatibility", "psu_config", "rack_units", "temp_operating", "temp_storage", "weight"],
    pdu: ["input_voltage", "mounting", "product_compatibility", "psu_rated_output"],
    // product_compatibility JOINED 29 Sep 2026 (ruling (d)): a bundle states what it works with in every category it is filed
    // under; relation-backed, so a bundle with no relation is not_held, never a gap. hci had it since Batch B (the pin was stale).
    unknown: [], bundle: ["bundle_contents", "product_compatibility"],
  };
  for (const [kind, want] of Object.entries(WANT)) {
    eq(`kind-layer question set: servers-unified-computing ${kind}`, req("servers-unified-computing", kind), want.join(","));
    eq(`kind-layer question set: hyperconverged-infrastructure ${kind} is the same set`, req("hyperconverged-infrastructure", kind), want.join(","));
  }
  eq("kind-layer: hyperconverged-systems asks its server the SAME set now (the exception became the rule, Batch B 29 Sep 2026)",
    req("hyperconverged-systems", "server"), WANT.server.join(","));
  eq("kind-layer: fabric-interconnect's switching rows are asked, uplink ports and PSU redundancy wait on their gates",
    kindQuestionSet("servers-unified-computing", "fabric-interconnect").pending.map((p) => p.key).sort().join(","),
    "module_slots,psu_redundant,rack_units,uplink_ports");
  eq("kind-layer: `psu` is no longer a kind of the UCS ledger", LEDGER_KINDS["servers-unified-computing"].includes("psu"), false);
  eq("kind-layer: LEDGER_KINDS lists no UCS kind twice (tpm/pdu are SKU kinds AND name-only kinds)",
    new Set(LEDGER_KINDS["servers-unified-computing"]).size === LEDGER_KINDS["servers-unified-computing"].length, true);
}

lines.unshift(`    ucs kind: ${passed} passed, ${failed} missed ` +
              `(${HYPERFLEX.length} HyperFlex regressions, ${POS12.length} positives and ${REF12.length} refusals of 12 Sep, ` +
              `${POS_KL.length} witnesses and ${REF_KL.length} refusals of the kind layer, ${PRE_RULES.length + 6} sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
