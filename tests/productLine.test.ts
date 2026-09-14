// tests/productLine.test.ts — layers 2 (product line) and 3 (series), src/core/productLine.ts + data/reference/product-lines/.
//
//   npx tsx tests/productLine.test.ts
//
// Every committed mapping file must validate; each finished category carries witnesses read from the live rows, including
// the traps found while reading them (a SKU family token beats a wrong series label; a more specific series must be listed
// before the broader one that would also match). The sabotage cases break a file on purpose and must fail for the reason.
import fs from "node:fs";
import { LINE_DIR, placePart, validateLineFile, type LineFile } from "../src/core/productLine.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };

// ---- every committed file validates ----
const files = fs.readdirSync(LINE_DIR).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const file = JSON.parse(fs.readFileSync(`${LINE_DIR}/${f}`, "utf8")) as LineFile;
  const errs = validateLineFile(file);
  check(`${f} validates`, errs.length === 0, errs.slice(0, 3).join("; "));
}

type W = [sku: string, name: string, label: string, line: string, series: string];
const witness = (category: string, rows: W[]) => {
  for (const [sku, name, label, line, series] of rows) {
    const p = placePart("cisco", category, { sku, name, series: label });
    check(`${category}: ${sku} [${label}] -> ${line} / ${series}`, p !== null && p.line === line && p.series === series, `got ${p ? `${p.line} / ${p.series} (${p.rule})` : "unplaced"}`);
  }
};

// ---- switches (done 14 Sep 2026) ----
witness("switches", [
  ["N9K-C93180YC-FX", "Nexus 9300 with 48p 10/25G SFP+", "Nexus 9000", "Nexus", "Nexus 9300"],
  ["C1-N9KC93108-FX-B", "Cisco ONE Nexus 93108TC-FX bundle PID", "Nexus 7000", "Nexus", "Nexus 9300"],          // label says 7000
  ["N77-C7710-FAN", "Cisco Nexus 7700 Switches -10-Slot Fan Tray", "Nexus 7000", "Nexus", "Nexus 7700"],
  ["X9736C-FX", "Cisco X9736C-FX", "Nexus 9000", "Nexus", "Nexus 9500"],                                        // bare line card
  ["N2K-C2348TQ", "Cisco Nexus 2348TQ Fabric Extender", "Nexus 2000 Fabric Extenders", "Nexus", "Nexus 2000 Fabric Extenders"],
  ["IE-3400H-16T-E", "Catalyst IE3400 Heavy Duty", "IE3400H", "Industrial Ethernet", "IE 3400H"],               // H before the IE 3400 rule
  ["IEM-3300-8P", "Cisco IEM-3300-8P", "Catalyst IE3200 Rugged Series", "Industrial Ethernet", "IE 3300"],       // label says IE3200
  ["WS-C2960R+24PC-L", "Catalyst 2960Plus 24 10/100 PoE, Russia", "1000", "Catalyst", "Catalyst 2960-Plus"],      // label says 1000
  ["C4500X-16SFP+", "Catalyst 4500-X 16 Port 10G", "4500-X", "Catalyst", "Catalyst 4500-X"],                      // not 4500-E
  ["WS-C3750X-24T-S", "Catalyst 3750-X", "Catalyst 3750-X", "Catalyst", "Catalyst 3750-X"],                       // not 3750
  ["2D-C2960XR-24PD-I", "Cat 2960-XR w/2D barcode", "2960-XR", "Catalyst", "Catalyst 2960-X and 2960-XR"],        // 2D- prefix
  ["CAB-ACU", "AC Power Cord (UK)", "2960", "Catalyst", "Catalyst shared parts"],                                  // review item 5: a cord the SKU does not tie to a series
  ["CAB-TA-DN=", "AC power cord for Cisco Catalyst 2960-XR (Denmark)", "Catalyst 9300", "Catalyst", "Catalyst shared parts"], // named, but the SKU does not name the series
  ["BLNK-RPS2300=", "Spare bay insert for Cisco Redundant Power System 2300", "2960-Plus", "Catalyst", "Redundant Power System"], // item 4: the SKU names RPS 2300
  ["C4500E-7R-S9E-MGIG", "SUP9E and MGIG upgrade for 7 slot chassis bundle", "Catalyst 9400", "Catalyst", "Catalyst 4500-E"],   // item 1
  ["C6800IA-48FPD", "C6800IA Instant Access POE+ Switch", "6800", "Catalyst", "Catalyst 6800 Instant Access"],
  ["CBS350-24P-4G-EU", "CBS350 Managed 24-port GE, PoE", "Business 350", "Cisco Business", "Business 350 Managed (CBS350)"],
  ["SG350X-24MP-K9-CN", "SG350X-24MP Stackable", "350X Stackable Managed", "Small Business", "Small Business 350X Stackable (SG350X/SX350X)"], // item 6
  ["MS390-24", "Cisco MS390-24", "MS390", "Meraki MS", "MS390"],
  ["DS-C9148V-24EK9", "Cisco MDS 9148V 64G Fibre-Channel-Switch", "MDS V", "(not this category)", "storage-networking"],
  ["7600-ES+2TG3C", "Cisco 7600 Series ES+ Line Card", "Catalyst 6500", "(not this category)", "routers"],
]);

// ---- routers (done 14 Sep 2026) ----
witness("routers", [
  ["C819HG-4G-A-K9", "C819 Hardened 4G LTE M2M GW for ATT 700 MHz Band 17", "800", "ISR (Integrated Services Routers)", "ISR 819 Hardened (M2M)"], // not ISR 800
  ["MEM-C8300-8GB=", "Cisco Catalyst 8300 Edge 8GB memory", "Catalyst 8200", "Catalyst 8000 Edge", "Catalyst 8300"],       // label says 8200
  ["MEM-C8500-32GB", "Cisco C8500 32 GB memory", "Catalyst 8500L", "Catalyst 8000 Edge", "Catalyst 8500"],                  // label says 8500L
  ["PWR-CC1-1000WAC", "Cisco C8300 2RU AC 1KW Power supply", "Catalyst 8200", "Catalyst 8000 Edge", "Catalyst 8300"],       // the name decides over the label
  ["SSD-STAT-480GB", "480GB SATA Solid disk drive for Cisco uCPE 8200", "5000 Enterprise Network Compute", "Catalyst 8000 Edge", "Catalyst 8200 Edge uCPE"],
  ["C8355-G2", "Cisco 8300 Secure Router with 4x10GE, 4x5GE, 2x1GE, and 1xPIM", "8000", "Secure Routers", "8300 Secure Router"],
  ["C8300-1N1S-6T", "Cisco Catalyst 8300 Edge platform", "Catalyst 8300", "Catalyst 8000 Edge", "Catalyst 8300"],
  ["C-NIM-1X", "1-port 10Gbps SFP/SFP+ NIM with WAN MACSec", "Catalyst 8300", "Router Interface Modules", "NIM (Network Interface Modules)"],
  ["7206VXRG2/2+VPNK9", "Cisco 7206VXRG2/2+VPNK9", "2900 ISR", "Legacy Service Routers", "Cisco 7200"],                   // label says 2900
  ["CG522-E", "Cisco Catalyst Cellular Gateway, supporting 5G Sub6", "Catalyst Cellular Gateways", "Industrial and IoT Routers", "Catalyst Cellular Gateway CG418 and CG522"],
  ["IR8340-K9", "Cisco Catalyst IR8340 Rugged Router", "Catalyst IR8300 Rugged Series Router", "Industrial and IoT Routers", "IR 8300"], // IR8340, not IR8300
  ["NC-55-36X100G", "NC55-36X100G Base Line Card", "Network Convergence System 5500 Series", "NCS (Network Convergence System)", "NCS 5500"],
  ["N520-20G4Z-A=", "Cisco NCS 520 - 20xGE + 4x10GE, Commercial Temp", "Network Convergence System 500", "NCS (Network Convergence System)", "NCS 520, 540 and 560"],
  ["SI-ISR4331-IWAN/K9", "ISR 4331 SEED IT Program Offering", "1000", "ISR (Integrated Services Routers)", "ISR 4000"],   // label says 1000
  ["ACS-1941-RM-19=", "19 inch rack mount kit for Cisco 1941 &1941W ISR", "2900 ISR", "ISR (Integrated Services Routers)", "ISR 1900"], // the SKU names the series
  ["3G-CAB-ULL-20", "20-ft (6M) Ultra Low Loss LMR 400 Cable with TNC Connector", "800", "ISR (Integrated Services Routers)", "ISR (Integrated Services Routers) shared parts"],
  ["AIR-AP1815-K9-ME-8-5-110-0.tar", "Cisco 111X Models AP", "1000", "(not this category)", "wireless"],
  ["9800-40", "Cisco Catalyst 9800-40 Wireless Controller", "Catalyst Wireless Gateway", "(not this category)", "wireless"],
  // layers review (14 Sep 2026), routers items 1-5 and 8
  ["ASR-9010-AC", "ASR-9010 AC Chassis", "ASR 9000", "ASR (Aggregation Services Routers)", "ASR 9000"],            // item 1: was ASR 901 (no digit fence)
  ["15454-M-CBL-L-JPN", "AC power cable - Japan", "Network Convergence System 5500 Series", "(not this category)", "optical-networking"], // item 2
  ["A9XX-RSPB-BLANK=", "Cisco A9XX-RSPB-BLANK=", "Network Convergence System 500", "ASR (Aggregation Services Routers)", "ASR 900"], // item 3
  ["C1100TG-1N32A", "Terminal Services Gateway w/ 32 Async", "Terminal Services Gateways", "Console and Terminal Servers", "Terminal Services Gateways"], // item 4: not ISR 1100
  ["C8220TG-48A-O", "Cisco Secure Console Server", "Secure Console", "Console and Terminal Servers", "Secure Console"],
  ["C8000V-PF", "Catalyst 8000V Edge Software", "Catalyst 8000V Edge Software", "(not this category)", "software"],   // item 5
  ["CN-BNG-BASE-L", "Base PID for cnBNG Control Plane", "Cloud Native Broadband Network Gateway (BNG)", "(not this category)", "software"],
  ["RSP720-3C-10GE", "Cisco RSP720-3C-10GE", "", "Legacy Service Routers", "Cisco 7600"],                            // item 8: arriving from switches
  ["76-ES+XT-4TG3C", "Cisco 7600 Series ES Plus XT", "", "Legacy Service Routers", "Cisco 7600"],
  ["CISCO7301/2+VPNK9", "Cisco CISCO7301/2+VPNK9", "2900 ISR", "Legacy Service Routers", "Cisco 7300"],             // label says 2900
  ["FLS-A901-4S", "Cisco ASR 901 4 Port SFP GE Upgrade - Physical", "ASR 901", "ASR (Aggregation Services Routers)", "ASR 901"], // SKU, so the role engine sees it
  ["NC55A2-MOD-SE-H-S", "NCS 55A2 Fixed 24X10G + 16X25G and MPA Scale Chassis", "Network Convergence System 5500 Series", "NCS (Network Convergence System)", "NCS 5500"],
]);

// ---- servers-unified-computing (done 14 Sep 2026) ----
witness("servers-unified-computing", [
  ["UCSC-C220-M5SX", "Cisco UCSC-C220-M5SX", "Transceiver Modules", "UCS C-Series Rack Servers", "UCS C220"],
  ["CBL-FNVME-C240M7", "Cisco CBL-FNVME-C240M7", "UCS C-Series", "UCS C-Series Rack Servers", "UCS C240"],        // component, SKU names the model
  ["UCSB-B200-M6", "Cisco UCS B200 M6 Blade w/o CPU, memory", "Mini Series", "UCS B-Series Blade Servers", "UCS B200"], // label says Mini
  ["UCSX-210C-M6", "UCS X210c M6 Compute Node", "UCS X-Series", "UCS X-Series Modular System", "UCS X210c compute node"],
  ["UCS-FI-6454", "Configured model: UCS 6454 1RU FI", "5100 Blade Series", "UCS Fabric Interconnects", "UCS 6400 Fabric Interconnects"],
  ["UCS-S3260-3KSD8", "Cisco UCS S3620 Top Load 3X 800G SSD", "S-Series Storage", "UCS S-Series Storage Servers", "UCS S3260"],
  ["UCS-SP-B200M4-BA4", "UCS SPSelect B200M4 Adv4", "UCS B-Series", "UCS Solution Bundles", "Smart Play and SP Select bundles"], // bundle before B200
  ["UCSX-CPU-I6418H", "Intel 6418H", "UCS X-Series", "UCS X-Series Modular System", "UCS X-Series Modular System shared parts"], // family prefix only
  // number collisions the audit found: Xeon model numbers are FI and X-node numbers
  ["UCS-CPU-6140", "2.3 GHz 6140/140W 18C", "UCS C-Series", "UCS Server Components", "Processors"],                  // not a 6140 FI
  ["UCS-CPU-I6248R", "Intel 6248R", "UCS C-Series", "UCS Server Components", "Processors"],                           // not a 6248 FI
  ["UCS-CPU-I5215C=", "DISTI: Intel 5215", "UCS C-Series", "UCS Server Components", "Processors"],                     // not X215c
  ["UCS-SDB480OA1V", "Cisco UCS-SDB480OA1V", "UCS B-Series", "UCS Server Components", "Drives and storage"],           // not B480
  ["HX-SD800G12TX-EP", "800GB 2.5in Enterprise performance 12G SAS SSD", "UCS C-Series", "(not this category)", "hyperconverged-systems"],
  ["HCI-CPU-I8480+", "Intel 8480+", "UCS C-Series", "(not this category)", "hyperconverged-infrastructure"],
]);

// ---- wireless (done 14 Sep 2026) ----
witness("wireless", [
  ["AIR-AP3802I-B-K9C", "802.11ac W2 AP", "3800", "Aironet Access Points", "Aironet 3800"],
  ["AIRAP1852I-NBULKC", "BOM Level AP1852i Bulk PID", "Aironet 1850", "Aironet Access Points", "Aironet 1850"],          // glued AIRAP prefix
  ["PULS-AP2802I-R-K9", "Aironet 2800", "2800", "Aironet Access Points", "Aironet 2800"],                                // PULS- prefix
  ["AIR-CAP1552H-C-K9", "Outdoor Mesh AP, Haz. Loc.", "Aironet 1550", "Aironet Access Points", "Aironet 1550 hazardous-location (H / SA / SD / WU)"],
  ["AIR-CAP1552E-M-K9", "Outdoor Mesh AP", "Aironet 1550", "Aironet Access Points", "Aironet 1550"],
  ["C9130AXE-EWC-I", "C9130AX with EWC", "Catalyst Embedded Controller", "Catalyst 9100 Access Points", "Catalyst 9130AX"], // label is the controller
  ["C9124AXD-EWC-R", "Wi-Fi 6 Outdoor AP w/EWC", "Catalyst 9800 Series Wireless Controllers", "Catalyst 9100 Access Points", "Catalyst 9124AX (outdoor)"],
  ["5-CBW141ACM-E-UK", "Mesh Extender 5-pack", "Business 100", "Cisco Business Wireless", "Cisco Business 141 / 142 / 143 mesh extenders"],
  ["WAP571E-A-K9", "Dual Radio Outdoor AP", "Small Business 500", "Small Business Wireless (WAP)", "WAP571E (outdoor)"],
  ["EDU-CT5520-K9", "5520 Wireless Controller", "5500", "AireOS Wireless LAN Controllers", "5500 (5508 / 5520 / 5540)"],
  ["CW9800H2", "Cisco Catalyst CW9800H2 Wireless Controller", "Catalyst 9800 Series Wireless Controllers", "Catalyst 9800 Wireless Controllers", "Catalyst CW9800H1 / CW9800H2"],
  ["MR84", "Cisco MR84", "", "Meraki MR Access Points", "Meraki MR outdoor (MR58 / 66 / 70 / 72 / 74 / 76 / 78 / 84 / 86)"],
  ["CS-ROOM70P-FSK=", "Cisco Room 70 Panorama Floor Stand Kit", "Policy Suite for Mobile", "(not this category)", "collaboration-endpoints"],
  ["ASR5K-SMC-K9", "System Management Card", "ASR 5000 Series", "(not this category)", "routers"],
]);
{
  const { deployRoleResult } = await import("../src/core/deployRole.js");
  check("role table (wireless): the AP role comes from the series — 1552H industrial, 1552E outdoor, 3802I indoor",
    deployRoleResult("wireless", "ap", "AIR-CAP1552H-C-K9", "x").role === "industrial" && deployRoleResult("wireless", "ap", "AIR-CAP1552E-M-K9", "x").role === "outdoor"
      && deployRoleResult("wireless", "ap", "AIR-AP3802I-B-K9C", "x").rule === "series:Aironet 3800");
  check("role table (meraki reads the wireless table): MR84 outdoor, MR33 indoor", deployRoleResult("meraki", "access-point", "MR84", "Cisco MR84").role === "outdoor" && deployRoleResult("meraki", "access-point", "MR33", "Cisco MR33").role === "indoor");
}

// ---- video / cable access (done 14 Sep 2026) ----
witness("video", [
  ["4022938.26", "GS7000 DWDM Tx, 1556.55nm, ITU26", "GS7000 Nodes", "GS7000 Nodes and Optical Hubs", "GS7000 optical transmitters and receivers (numeric PIDs)"], // a number, not a datasheet cell
  ["4042880.39", "Cisco 4042880.39", "GS7000 Nodes", "GS7000 Nodes and Optical Hubs", "GS7000 optical transmitters and receivers (numeric PIDs)"],
  ["G7A2AA101E2XXXXAXX", "GS7000,4x(HO),TPs,42/54,8p,SA,Rx,2:1/EDR", "GS7000 Optical Hub and Hub-Node", "GS7000 Nodes and Optical Hubs", "GS7000 configured nodes"],
  ["4021915", "(P2-HD-13TXM-06-E2-D) HD M-W Fwd Tx, 1GHz", "Prisma II Products", "Prisma II Optical Transport", "Prisma II HD"],  // the name states the family
  ["737400", "(P2-15TXR-08-DM-SA-ITU13) 1550 Rev Tx", "Prisma II Products", "Prisma II Optical Transport", "Prisma II"],
  ["4034760", "GS7000 Optical Hub, 1x17EDFA, OPSW, LCM", "Prisma II Products", "GS7000 Nodes and Optical Hubs", "GS7000 Optical Hub"], // label says Prisma
  ["CBR-LC-8D30-16U30", "cBR CCAP line card", "CBR Series Converged Broadband", "cBR-8 Converged Broadband Router", "cBR-8"],
  ["RFGW-10-48HA-DS192", "RFGW-10 Bundle", "RF Gateway Series", "RF Gateway", "RFGW-10"],
  ["4040030", "RFGW-1 AC Power Supply Module Spare", "RF Gateway Series", "RF Gateway", "RFGW-1"],
  ["RPD-1X2=", "Smart PHY 120 RPD with SCTE 55-1 OOB", "CBR Series Converged Broadband", "Remote PHY", "Remote PHY devices (RPD / Smart PHY)"],
  ["4003563", "OADM,LGX-DWDM-ITU-36-SA", "Optical Passive Components", "Optical Passive Components", "Mux / demux, OADM and WDM filters"],
]);

// ---- collaboration-endpoints (done 14 Sep 2026) ----
witness("collaboration-endpoints", [
  ["CP-7925G-A-K9", "Unified Wireless IP Phone 7925G", "7900 - Unified IP Phone", "IP Phones", "Unified Wireless IP Phone 7920 / 7921 / 7925 / 7926"], // not the 7900 desk series
  ["CP-7942G", "Cisco UC Phone 7942", "7900 - Unified IP Phone", "IP Phones", "Unified IP Phone 7900"],
  ["CP-8832-K9=", "8832 base", "IP Phone 8800 Series", "IP Phones", "IP Conference Phone 8831 / 8832"],
  ["CP-6825-3PC-K9=", "Cisco IP DECT 6825", "IP DECT 6800 Series with Multiplatform Firmware", "IP Phones", "IP DECT 6823 / 6825 handsets"],
  ["CP-6851-3PW-UK-K9=", "Cisco IP Phone 6851", "6800 - IP Phone w/Multiplatform Firmware", "IP Phones", "IP Phone 6800 (6821 / 6841 / 6851 / 6861 / 6871)"],
  ["CP-HS-WL-MUSB-C", "Cisco Micro-USB to USB-C Spare Cable", "Headset 500 Series", "Headsets", "Headsets shared parts"],  // CP- but a headset part; the SKU names no series
  ["CP-DX80-K9=", "Cisco Webex DX80", "Desk Series", "Webex Desk Series", "DX70 / DX80"],                                  // CP- but a Desk device
  ["CS-ROOM55D-K9", "Cisco Webex Room 55D", "TelePresence MX Series", "Webex Room Series", "Room 55 / 55D"],               // label says MX
  ["CTS-SX20N-C-12X-K9", "SX20 Quick Set w/ 12X cam", "TelePresence Precision Cameras (P60)", "TelePresence (legacy)", "TelePresence SX (SX10 / SX20 / SX80)"],
  ["CS-BRDP75-K9++", "Cisco Board Pro 75 G2, TAA", "Spark Board", "Webex Board Series", "Board Pro G2 (55 / 75)"],
  ["CS-TOUCH10=", "Cisco Touch 10 for MX, SX, Board, and Room Series", "Touch", "Webex Room Series", "Room Navigator and Touch 10"],
]);
{
  const { deployRoleResult } = await import("../src/core/deployRole.js");
  check("role table (phones): 7925G wireless, 7942G desk, 8832 conference — from the series; SPA302D in unified-communications dect",
    deployRoleResult("collaboration-endpoints", "phone", "CP-7925G-A-K9", "x").role === "wireless" && deployRoleResult("collaboration-endpoints", "phone", "CP-7942G", "x").rule === "series:Unified IP Phone 7900"
      && deployRoleResult("collaboration-endpoints", "phone", "CP-8832-K9=", "x").role === "conference" && deployRoleResult("unified-communications", "phone", "SPA302D-G1", "x").role === "dect");
}

// ---- transceiver (done 14 Sep 2026) — the label names the HOST platform; the series is the optic's family ----
witness("transceiver", [
  ["SFP-10G-AOC7M", "SFP active optical cable", "Network Convergence System 5000 Series", "Direct-attach and active optical cables", "DAC and AOC cables (SFP+ / SFP28 / QSFP / QSFP-DD, incl. breakouts)"], // a cable, not an SFP+
  ["SFP-10G-SR", "10GBASE-SR SFP Module", "Catalyst 6500", "Ethernet transceivers", "10G SFP+"],
  ["QSFP-4X10G-AC7M", "QSFP to 4 SFP+ active copper breakout", "Cisco", "Direct-attach and active optical cables", "DAC and AOC cables (SFP+ / SFP28 / QSFP / QSFP-DD, incl. breakouts)"],
  ["QSFP-4X10G-LR-S=", "QSFP 4x10G transceiver module, SM", "Network Convergence System 2000 Series", "Ethernet transceivers", "40G QSFP+"],
  ["DWDM-SFP10G-38.19=", "10GBASE-DWDM 1538.19 nm SFP10G", "Network Convergence System 500", "WDM transceivers", "DWDM SFP / SFP+ / XFP / X2 / XENPAK / GBIC"],
  ["DWDM-GBIC-40.56", "1000BASE-DWDM GBIC", "Cisco", "WDM transceivers", "DWDM SFP / SFP+ / XFP / X2 / XENPAK / GBIC"],          // DWDM before GBIC
  ["DS-CWDM8G1470=", "CWDM 8G FC SFP", "MDS 9000 Series Multilayer", "Fibre Channel transceivers (MDS)", "MDS Fibre Channel SFP / X2 / CWDM"], // FC before CWDM
  ["ONS-SC-4G-31.9=", "SFP - 4G FC 1531.90", "MDS 9500 Series Multilayer Directors", "Optical networking pluggables (ONS / NCS 2000)", "ONS 15454 / NCS 2000 pluggables"],
  ["QDD-400G-ZR-S", "400G QSFP-DD ZR", "Transceiver Modules", "Coherent and digital-coherent pluggables", "400G / 800G ZR, ZR+ and CFP2 DCO"],
  ["QDD-400G-SR8", "", "Transceiver Modules", "Ethernet transceivers", "200G / 400G QSFP-DD, QSFP112 and QSFP56"],
  ["RPHY-S10G-20K-480=", "Cisco RPHY-S10G-20K-480=", "Transceiver Modules", "Cable access and PON optics", "Remote PHY SFP+ optics"],
  ["MA-SFP-10GB-ER", "Meraki MA-SFP-10GB-ER", "Meraki", "Meraki transceivers and cables", "Meraki MA-SFP / MA-QSFP / MA-CBL"],
  ["GLC-TE", "1000BASE-T SFP", "1G SFP Modules", "Ethernet transceivers", "1G and 100M SFP"],
]);

// ---- item 8: ONE series -> role table, read by the cup engine ----
{
  const { deployRole, deployRoleResult } = await import("../src/core/deployRole.js");
  check("role table: MS390-24 is core-agg through deployRole (the series table, reviewer C.6), not the old access rule", deployRole("switches", "switch", "MS390-24", "Cisco MS390-24") === "core-agg");
  check("role table: the rule that decided is the series", deployRoleResult("switches", "switch", "N9K-C93180YC-FX", "Nexus 9300").rule === "series:Nexus 9300");
  check("role table: a kind ISSUE still wins over the series role (DS-C9148V is not a switch)", deployRole("switches", "switch", "DS-C9148V-24EK9", "MDS 9148V") === null);
  check("role table: C6800IA Instant Access is access, the 6800 chassis series core-agg", deployRole("switches", "switch", "C6800IA-48FPD", "Instant Access") === "access" && deployRole("switches", "switch", "C6816-X-LE", "Catalyst 6816-X") === "core-agg");
  check("role table (routers): ISR 4331 branch, ASR 1001-X edge, C819 hardened industrial-iot, all from the series",
    deployRole("routers", "router", "ISR4331/K9", "Cisco ISR 4331") === "branch" && deployRole("routers", "router", "ASR1001-X", "Cisco ASR 1001-X") === "edge"
      && deployRoleResult("routers", "router", "C819HG-4G-A-K9", "C819 Hardened 4G LTE M2M GW").rule === "series:ISR 819 Hardened (M2M)"
      && deployRole("routers", "router", "C819HG-4G-A-K9", "C819 Hardened 4G LTE M2M GW") === "industrial-iot");
}

// ---- sabotage ----
{
  const bad: LineFile = { vendor: "cisco", category: "x", lines: [{ line: "L", series: [{ series: "S", sku: ["\\bC9300"] }] }] };
  check("SABOTAGE: a \\b pattern is refused", validateLineFile(bad).some((e) => e.includes("uses \\b")));
  const dupLabel: LineFile = { vendor: "cisco", category: "x", lines: [{ line: "L", series: [{ series: "A", labels: ["9300"] }, { series: "B", labels: ["9300"] }] }] };
  check("SABOTAGE: one label mapping to two series is refused", validateLineFile(dupLabel).some((e) => e.includes("maps to two series")));
  const empty: LineFile = { vendor: "cisco", category: "x", lines: [{ line: "L", series: [{ series: "A" }] }] };
  check("SABOTAGE: a series with no rule is refused", validateLineFile(empty).some((e) => e.includes("can place nothing")));
  // order matters: the broad 4500-E pattern listed BEFORE 4500-X swallows a 4500-X SKU
  const real = JSON.parse(fs.readFileSync(`${LINE_DIR}/cisco-switches.json`, "utf8")) as LineFile;
  const cat = real.lines.find((l) => l.line === "Catalyst")!;
  const ix = cat.series.findIndex((s) => s.series === "Catalyst 4500-X"), ie = cat.series.findIndex((s) => s.series === "Catalyst 4500-E");
  const swapped = structuredClone(real);
  const sc = swapped.lines.find((l) => l.line === "Catalyst")!;
  [sc.series[ix], sc.series[ie]] = [sc.series[ie], sc.series[ix]];
  // compile the swapped file through the same entry point
  const tmp = { file: swapped, compiled: undefined as never };
  const { loadLineFile } = await import("../src/core/productLine.js");
  void loadLineFile; void tmp;
  const placeWith = (f: LineFile) => {
    // re-implement nothing: write the file to a temp category and load it through the real loader
    const path = `${LINE_DIR}/cisco-zz-sabotage.json`;
    fs.writeFileSync(path, JSON.stringify({ ...f, category: "zz-sabotage" }));
    try { return placePart("cisco", "zz-sabotage", { sku: "C4500X-16SFP+", name: "", series: "" }); } finally { fs.unlinkSync(path); }
  };
  const got = placeWith(swapped);
  {
    const bad2 = structuredClone(real);
    bad2.lines.find((l) => l.line === "Nexus")!.series.find((x) => x.series === "Nexus 9300")!.role = "outdoor";
    const path2 = `${LINE_DIR}/cisco-switches.json`;
    const keep = fs.readFileSync(path2, "utf8");
    // the loader caches per category; a fresh process is the honest test — run it as a child
    const { execFileSync } = await import("node:child_process");
    fs.writeFileSync(path2, JSON.stringify(bad2));
    let refused = "";
    try { execFileSync(process.execPath, ["--import", "tsx", "-e", `import("./src/core/deployRole.ts").then(m=>{m.deployRole("switches","switch","N9K-C93180YC-FX","x")})`], { stdio: "pipe" }); }
    catch (e) { refused = String((e as { stderr?: Buffer }).stderr ?? e); }
    finally { fs.writeFileSync(path2, keep); }
    check("SABOTAGE: a series role outside the kind's domain is refused by the cup engine", refused.includes("outside the switch domain"), refused.slice(0, 200));
  }
  check("SABOTAGE: listing Catalyst 4500-E before 4500-X misplaces a 4500-X SKU (rule order is load-bearing)", got?.series === "Catalyst 4500-E", `got ${got?.series}`);
  {
    // layers review item 1: without the digit fence ASR 901's pattern takes the ASR-9010 chassis
    const rt = JSON.parse(fs.readFileSync(`${LINE_DIR}/cisco-routers.json`, "utf8")) as LineFile;
    const s901 = rt.lines.flatMap((l) => l.series).find((s) => s.series === "ASR 901")!;
    s901.sku = (s901.sku ?? []).map((p) => p.replace("(?![0-9])", ""));
    const path3 = `${LINE_DIR}/cisco-zz-sabotage2.json`;
    fs.writeFileSync(path3, JSON.stringify({ ...rt, category: "zz-sabotage2" }));
    let got2: ReturnType<typeof placePart> = null;
    try { got2 = placePart("cisco", "zz-sabotage2", { sku: "ASR-9010-AC", name: "ASR-9010 AC Chassis", series: "" }); } finally { fs.unlinkSync(path3); }
    check("SABOTAGE: removing the ASR 901 digit fence files the ASR-9010 chassis under ASR 901 again", got2?.series === "ASR 901", `got ${got2?.series}`);
  }
}

console.log(`    product lines: ${pass} passed, ${misses.length} missed (${files.length} mapping files)`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);
