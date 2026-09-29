// tests/securityKind.test.ts — proof for src/core/securityKind.ts.
//
//   npx tsx tests/securityKind.test.ts
//
// EVERY SKU BELOW IS FROM THE LIVE CATALOGUE (the 11 Sep 2026 snapshot of 91,543 parts); none was
// invented to fit a rule, and the name in each comment is the catalogue's own, because a refusal
// tested against a tidier name than the part carries is a stand-in for the part, not the part.
//
// WHAT THIS FILE HAS TO PROVE, in the order the reviewer audits it:
//   * the axis is TOTAL — every SKU gets an answer, and the fallback asks LESS rather than more;
//   * every rule family fires on a real SKU (a rule no case reaches is a rule nobody has seen work);
//   * ORDER, which is part of the rule: 14 of the 23 rules are reachable only because an earlier one
//     did not claim the SKU first, so each ordering case is the SABOTAGE for one family — delete that
//     rule, or move it after the one it precedes, and the case goes red naming the product;
//   * REFUSALS outnumber positives. Each is a real product a slightly wider rule would have
//     mis-shaped, and mis-shaping is not a cosmetic error: a component called a box carries gaps
//     nothing can close, and a box called a component has its real questions CLOSED.
import { securityKind, securityKindRule, SEC_RULE_IDS, SEC_BOX, SEC_COMPONENT, SEC_KINDS, type SecurityKind } from "../src/core/securityKind.js";
import { partKind } from "../src/core/partKind.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};
const seen = new Set<string>();
const kindIs = (sku: string, want: SecurityKind, why: string): void => {
  seen.add(securityKindRule(sku));
  eq(`${sku} is ${want} (${why})`, securityKind(sku), want);
};

// =================================================================================================
// POSITIVES — one per rule family, on a real SKU
// =================================================================================================
const POSITIVES: [string, SecurityKind, string][] = [
  // --- the class table runs first: a SKU productClass already calls non-hardware is asked NOTHING
  ["CSMPR50-4.8-K9", "non-hardware", "'Cisco Security Manager 4.8 Professional - 50 Device License'"],
  ["SF-F9KFXOS2.3.2-K9", "non-hardware", "'Cisco FXOS v2.3.2 for FPR9300' — a software image"],
  ["FLSASR1-LI=", "non-hardware", "'Lawful Intercept Paper PAK for ASR1000 Series' — a foreign paper licence"],
  // --- components
  ["ASA-PWR-BLANK", "accessory", "'ASA 5545-X/5555-X Power Slot Blank Cover' — blank first, before `power`"],
  ["FPR4K-SSD-BBLKD", "accessory", "'Firepower 4000 Series SSD Slot Carrier' — a carrier, not a drive"],
  ["ASA-BRACKETS=", "accessory", "'brackets for rack mounting'"],
  ["CCS-RAIL=", "accessory", "'Cisco Content Security Spare Rail Kit' — RAIL with no hyphen before it"],
  ["UCSC-RAILB-M4=", "accessory", "'Ball Bearing Rail Kit for C220 and C240 M4 and M5 rack servers'"],
  ["ESA-X1070-FPLT=", "accessory", "'ESA Locking Faceplate for X1070'"],
  ["FP-8000-BEZEL=", "accessory", "'Cisco FirePOWER Bezel for 8000 Series'"],
  ["FP8200-STACK", "accessory", "'FirePOWER Stacking Kit for 8200, 1U, 2 Stacking Modules'"],
  ["ST-M6-AD-245", "accessory", "'C245M6 PCIe Air Duct for PCIe Cards'"],
  // kind-layer operator ruling (13 Sep 2026): the Duo key fob pack moving in from servers-unified-computing
  ["DUO-TOKEN-10PACK", "accessory", "'A hardware token used with a Cisco Duo subscription (10 pack)' — was the appliance default"],
  ["AMPPC-DM-2X-R", "accessory", "'Secure Endpoint Cloud Rear Drive Module - 2 Slot' — a cage, not a drive"],
  ["ASA5512-FP-UPG", "accessory", "'Upgrade Kit: ASA5512-X FW, IPS, CX to ASA5512-X FirePower'"],
  ["FP-NMSB-CABLE", "cable", "'Cisco FirePOWER Stacking Module Cables'"],
  ["N20-BKVM=", "cable", "'KVM local IO cable for UCS servers console port'"],
  ["ASA5585-PWR-AC", "power", "'ASA 5585-X AC Power Supply'"],
  ["TG-PWR-DC-930W", "power", "'Cisco Threat Grid 930W DC Power Supply'"],
  ["ASA5585-FAN", "fan", "'ASA 5585-X Fan Module'"],
  ["FPR2K-FAN", "fan", "'Firepower 2000 Series Fan Tray'"],
  ["ASA5585-HD-600GB", "drive", "'ASA 5585-X 600 GB Hard Drive For ASA CX'"],
  ["FPR9K-SM-SSD1.6TB-", "drive", "'Firepower 9000 Series 1.6TB SSD for Security Module'"],
  ["ASA5500X-SSD120INC", "drive", "'ASA 5512-X through 5555-X 120GB MLC SED SSD (Incl.)' — SSD with a trailing token"],
  ["ST-M6-240GB-SATA", "drive", "'Cisco SNA 240GB SATA M.2'"],
  ["TG-M7-SDB3T8SA1VD", "drive", "a 3.8 TB SATA drive; the catalogue gives it no name of its own"],
  ["TG-MEM-32GB-M4", "memory", "'32GB DDR4-2400-MHz RDIMM'"],
  // kind-layer (13 Sep 2026): `compute` split into the library component kinds (spec II.8 said SERVER; 0 of 131 are).
  ["CV-TPM2-002B-C", "tpm", "'Trusted Platform Module2.0 UCS servers' — kind-layer: was compute"],
  ["SNS-TPM-002C", "tpm", "'TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers'"],
  ["SNS-CPU-4116", "cpu", "'2.1 GHz 4116/85W 12C/16.50MB Cache/DDR4 2400MHz'"],
  ["ST-M6-CPU-A7443", "cpu", "'Cisco SNA AMD 2.85GHz 7443 200W 24C/128MB Cache DDR4 3200Mhz'"],
  ["FS2K-RAID-9271", "storage-controller", "'Cisco FireSIGHT MegaRaid PCIe SAS Controller with Supercap'"],
  ["ST-MRAID12G-4GB", "storage-controller", "'Cisco Stealthwatch 12Gbps SAS 4GB FBWC Cache module' — the controller's cache option"],
  ["FMC-M6-HWRAID", "storage-controller", "'Cisco FMC M6 Boot optimized M.2 Raid controller'"],
  ["CCS-BAT-RAID-710=", "storage-controller", "'Content Security Raid Battery for x70 Model'"],
  ["SNS-PCIE-IQ10GF", "nic", "'Intel X710 quad-port 10G SFP+ NIC' — kind-layer: was compute"],
  ["ST-M6-D100GF", "nic", "'Cisco SNA MELLANOX CX-5 MCX516A-CDAT 2x100GbE QSFP PCIe NIC' — Q17 read: the drive rule's -D<3 digits>G shape took D100G for a capacity"],
  ["CCS-M6-PCIE-IRJ45", "nic", "'Cisco Content Security Intel i350 Quad Port 1Gb Adapter'"],
  ["SNS-N2XX-ABPCI01", "nic", "'Broadcom 5709 Dual Port 10/100/1Gb NIC w/TOE iSCSI'"],
  ["FMC-M5-MSTOR-SD", "compute", "'Cisco FMC Mini Storage Carrier Card for SD (holds up to 2)' — residual compute: a carrier, no library noun"],
  ["CCS-RIS1A-240M6", "compute", "'CCS C240 M6 Riser1A' — residual compute: a riser"],
  ["SNS-4GBSR-1X041RY", "memory", "'4GB 1600 Mhz Memory Module'"],
  ["SNS-UCS-SSL-CATD", "compute", "'Cavium Card' — an SSL offload card"],
  ["ST-M6-M2EXT-240", "compute", "'C240 2U M6 M.2 Extended Board'"],
  // security-r6 (12 Sep 2026): these three were `compute` and are `nic` — the kind that holds the
  // six `ports` facts the old single kind was carrying without being asked for them.
  ["TG-M7-PCIEID10GF-D", "nic", "a PCIe 10G fibre NIC; the catalogue gives it no name of its own"],
  ["CCS-1GE-CU", "nic", "'Cisco Content Sec 1-Port 10/100/1000 Interface Card, RJ-45'"],
  ["ST-M5-10G-4FI", "nic", "'Cisco Stealthwatch Accelerated 4x10G SFP+ NIC' — and it holds a ports fact"],
  ["CCS-P-IQ10GC", "nic", "'Intel X710T4LG 4x10 GbE RJ45 PCIe NIC' — holds ports"],
  ["FMC-M6-O-ID10GC", "nic", "'Intel X710T2LOCPV3G1L 2x10GbE RJ45 OCP3.0 NIC' — holds ports"],
  ["CCS-MLOM-I-RJ45", "nic", "'Cisco Content Sec i350 MLOM NIC' — an MLOM is a NIC"],
  // ...and the memory kind, which holds 33 of the cohort's 39 facts, all of them `dram`.
  ["SNS-MR-X32G2RT-H", "memory", "'32GB DDR4-2933-MHz RDIMM/2Rx4/1.2v' — the MR- spelling"],
  ["CV-MRX16G1RE5", "memory", "the MRX spelling, whose name the catalogue does not carry"],
  ["FPR9K-X32G2RW=", "memory", "'Firepower9300 32GB RDIMM DRx4 3200' — no MEM or MR token at all"],
  ["SNS-4GBSR-1X041RY", "memory", "'4GB 1600 Mhz Memory Module' — the GBSR spelling"],
  ["MEM-71XX-1024S", "memory", "'Cisco 7160 1024 MB SDRAM System Memory' — a bare MEM- prefix"],
  // --- the service modules: the blade IS the engine
  ["ASA-SSP-IPS60-K9", "ips-module", "'ASA 5585-X IPS Security Services Processor-60 with 6GE, 4SFP+'"],
  ["ASA-IPS-10-INC-K9", "ips-module", "'ASA 5585-X IPS Security Services Processor-10 with 8GE' — no SSP token in the PID"],
  ["IPS-4510-SSP-K9", "ips-module", "'IPS 4510 w SW ... CARD ONLY'"],
  ["FPR9K-SM-36", "security-module", "'Firepower 9000 Series High Performance Security Module'"],
  ["ASA5585-SSP-10", "security-module", "'ASA 5585-X Security Services Processor-10 with 8GE'"],
  ["ASA-CX20-INC-K8", "security-module", "'ASA 5585-X CX SSP-20 with 8GE, DES' — no SSP token either"],
  ["ASA-SSE-AIP-65", "security-module", "'ASA 5500 Security Services Engine-65 w 8GE,2SFP+'"],
  ["SM-48", "security-module", "the datasheet MODEL row that holds the per-blade figures"],
  ["ASA5585-NM-8-10GE", "module", "'ASA 5585-X Half Width Network Module with 8 SFP+ ports'"],
  ["FPR9K-NM-4X40G-F", "module", "'Firepower Network Module 4x40GE'"],
  ["ASA-IC-6GE-SFP-A", "module", "'ASA Interface Card with 6 SFP Gigabit Ethernet data ports'"],
  ["FPR9K-SUP=", "module", "'Firepower 9000 Series Supervisor Spare'"],
  ["AIM-DES/BP", "module", "'DES Crypto AIM for Cisco 2600 - Base Performance'"],
  // --- appliance shapes the SKU names
  ["FPR-2130", "firewall", "'Firepower 2130 Appliance,1RU, 12GE, 4 xSFP+, 1MGMT, 1NM Slot'"],
  ["ASA5505-SSL25-K9", "firewall", "'ASA 5505 VPN Edition w/ 25 SSL Users' — a real box in a software series"],
  ["FPR9KT-SM36-HA-BUN", "firewall", "'FPR9300 SM-36 Threat Defense Chassis, Subs HA Bundle'"],
  ["F4120-ASA-NGFW-BUN", "firewall", "'Firepower 4120 ASA + NGFW Bundle'"],
  ["ISA-3000-2C2F-K9", "firewall", "the industrial security appliance"],
  ["5545-X", "firewall", "'Cisco 5545-X' — an ASA 5500-X datasheet model row"],
  ["FP8370-BUN", "ips", "'Cisco FirePOWER 8370 Chassis and Subscription Bundle'"],
  ["IPS-4345-DC-K9", "ips", "'IPS 4345 with SW, 8 GE data + 1 GE mgmt, DC Power'"],
  ["AMP7150-K9", "ips", "'Cisco FirePOWER AMP7150, 1U, 4 Port Copper and 8 SFP Ports'"],
  ["ESA-C670-K9", "email-gateway", "'ESA C670 Email Security Appliance with Software'"],
  ["WSA-S690X-K9", "web-gateway", "'WSA S690 Web Security Appliance with Extended HDD capacity'"],
  ["S696", "web-gateway", "'Cisco S696' — a Secure Web Appliance datasheet model row"],
  ["SMA-M690-K9", "management", "'SMA M690 Security Management Appliance with Software'"],
  ["FMC2700-K9", "management", "'Cisco Secure Firewall Management Center 2700 Chassis'"],
  ["FMC-M6-BUN", "management", "'Secure Firewall Management Center M6 Bundle'"],
  ["PRSM-APPSW2-100-K9", "management", "'PRSM Software Bundled With Physical Appliance'"],
  ["CSM4-UCS2-150-HW", "management", "'CSM UCS bundle to manage 150 devices'"],
  ["LC-SMC-2K-K9", "analytics", "'StealthWatch Management Console 2000 appliance'"],
  ["ST-FS4240-K9", "analytics", "'Cisco Stealthwatch Flow Sensor 4240'"],
  ["ST-DS6200-K9", "analytics", "'Cisco Stealthwatch Data Store 6200'"],
  ["CV-CNTR-M8N", "analytics", "'Cyber Vision Center hardware appliance ( Cisco UCS C225 M8 Rack Server )'"],
  ["SNS-3415-K9", "identity", "'Small Secure Network Server for ISE, NAC, & ACS Applications'"],
  // --- kind-layer (13 Sep 2026): the 30 `appliance` rows dissolved (III.0 item 4 §7k) — appliance = 0 in the catalogue
  ["TG5504-K9", "analytics", "'Cisco Threat Grid 5504 Model Hardware' — a Secure Malware Analytics sandbox (decision: analytics)"],
  ["TG-M6-K9", "analytics", "'Cisco Secure Malware Analytics M6 Model Hardware'"],
  ["TG5000-CHAS-AC", "analytics", "'Cisco Threat Grid 5000/5500 Chasis with AC' — the appliance body, not a power part"],
  ["TG5500-BUN", "analytics", "'Cisco Threat Grid 5500 Model and Subscription Bundle'"],
  // D2, 28 Sep 2026 — the four rows that had fallen through to `appliance`, where the default fails safe and
  // still asks a card for firewall throughput. Each carries its REFUSAL beside it, because the pattern that
  // reaches it must not reach the prefix's licences and accessories.
  ["TG5500-C220M3S-K9", "analytics", "the ThreatGrid 5500 NAMING THE UCS SERVER it is built on between the model and -K9, which `^TG\d{4}-(?:K9|BUN|CHAS)` could not reach"],
  ["NAM2420-K9", "management", "a standalone 1RU Network Analysis Module APPLIANCE — it monitors and reports, so no throughput cup is asked"],
  ["NAM2440-K9", "management", "its larger sibling"],
  ["ASA-SSC-AIP-5-K9=", "module", "the ASA 5500 'Advanced Inspection and Prevention Security Services CARD' — a slot-in card, filed with the SSMs"],
  ["TA-CL-8U-M6-K9", "analytics", "'Cisco Secure Workload Gen3 8RU Cluster'"],
  ["AMPPC3000-K9", "management", "'Cisco Secure Endpoint Private Cloud Appliance - 3000 Model' (decision: management)"],
  ["SEPC4000-K9", "management", "'Cisco Secure Endpoint Private Cloud Appliance - 4000 Model'"],
  ["1210CE", "firewall", "the Secure Firewall 1210CE model row, which holds 20 of the category's facts"],
  ["1220CX", "firewall", "the Secure Firewall 1220CX model row"],
  ["ASA-VPN-15K-BUN", "firewall", "'Cisco Recommended ASA VPN Bundle for 15K users' — an ASA VPN-edition hardware bundle"],
  ["CSACS-3415-K9", "non-hardware", "'ACS application & BASE license for SNS-3415-K9 appliance' — class change pending"],
  ["TB-ESS-100GB", "non-hardware", "Telemetry Broker essentials volume licence — class change pending"],
  ["ISA-FP-541213-K9", "non-hardware", "'IDS / IPS for Industrial Security Appliances K9 level' — class change pending"],
  // --- the fallback, which asks LESS: a box of no SKU-known shape. After kind-layer NO catalogue row reaches it; the
  //     default must still work for the next unknown SKU, so it is exercised with one that does not exist.
  ["XYZ-9000-BOX", "appliance", "no rule names its shape — the fail-safe box default (not a catalogue SKU: none reaches it now)"],
];
for (const [sku, want, why] of POSITIVES) kindIs(sku, want, why);

// =================================================================================================
// REFUSALS — the real product each slightly wider rule would have mis-shaped
// =================================================================================================
const REFUSALS: [string, SecurityKind, string][] = [
  // THE FOUR GHOSTS THE MERAKI-MX RULE MUST NOT REACH (28 Sep 2026). `^MX\d` matched 22 parts in meraki and
  // four of them — MX16, MX18, MX26, MX650 — carry no kind, no fact and no document between them, names that
  // are literally "Cisco <SKU>", and correspond to no Meraki model that exists. `MX` is also TelePresence's
  // line and Juniper's router family (MX960, MX2000). So the rule enumerates the 18 shipping models, and these
  // cases are what stops the next reader "simplifying" it back to a prefix: they must stay on the fallback.
  ["MX16", "appliance", "no such Meraki model — a datasheet cell read as a part, 0 facts and 0 documents"],
  ["MX650", "appliance", "likewise, and the shape that would break a lazy ^MX\\d{2,3} too"],
  ["MX960-PSM-5K-A", "appliance", "a JUNIPER MX960 power supply — the prefix is not even Cisco's alone"],
  // D2, 28 Sep 2026 — the three real neighbours the widened patterns must NOT reach. Every one is a live PID
  // from the catalogue, found by listing what shares each prefix rather than by imagining what might.
  ["ASA-SSC-BLANK=", "accessory", "'ASA 5505 SSC Blank Slot Cover' — `SS[MC]-` now reaches SSC, and a slot COVER is not a card: the blank rule runs first and must keep winning"],
  ["NAM-VX10-6.0-K9", "non-hardware", "'Cisco Prime Virtual NAM VX10 Software 6.0' — the NAM prefix is shared with software, which is why the rule is anchored `^NAM\d{4}-K9$` and not `^NAM`"],
  ["TG5500-SW-K9", "non-hardware", "'Threat Grid Software for 5500 Model' — `C\d{3}M\d` must reach the platform segment of an appliance and nothing else under the same model number"],
  // kind-layer operator ruling (13 Sep 2026): the duo-hardware-token rule is the whole token, not the DUO- family
  ["DUO-TOKEN-10PACKX", "appliance", "duo-hardware-token unanchored at the end — a shape, not a live PID: the rule must stop at the pack count"],
  // --- the drive marker against the APPLIANCE ORDERED WITH ITS SSD (survey §e, the pinned refusal)
  ["ASA5512-SSD120-K9", "firewall", "'NGFW ASA 5512-X w/ SW,6GE Data,1GE Mgmt,AC,3DES/AES,SSD 120G' — the BOX, not a drive"],
  ["ASA5512-SSD120-K8", "firewall", "the DES twin of the same box"],
  ["ASA5515-SSD120-K8", "firewall", "and the 5515-X"],
  ["ASA5515-SSD120-K9", "firewall", "and its 3DES twin"],
  ["ASA5525-SSD120-K8", "firewall", "'Cisco ASA 5525-X Firewall Edition; includes firewall services, 750 IPs'"],
  ["ASA5525-SSD120-K9", "firewall", "and its 3DES twin — five appliances the drive marker would have taken"],
  // --- tokens that look like a component and are not
  ["ESA-C680-LKFP-K9", "email-gateway", "'ESA C680 Email Security Appliance with Locking Faceplate' — LKFP is anchored to ^CCS-LKFP for exactly this"],
  ["ESA-C680-10G-FP-K9", "email-gateway", "'ESA C680 FIPS Compliant Email appliance 10G and locking FP'"],
  ["ESA-C680-KEY=", "email-gateway", "'Replacement Key for ESA C680 locking faceplate appliance' — KEY is not a component token"],
  ["FPR9K-SUP-BLANK", "accessory", "'Firepower 9000 Series Supervisor Blank Slot Cover' — the blank rule must beat the new supervisor rule"],
  ["FPR3K-PSU-BLANK", "accessory", "'Firepower 3000 Power Supply Blank Slot Cover' — a blank, not a power supply"],
  ["FPR3K-NM-BLANK", "accessory", "a netmod blank, not a netmod"],
  ["FPR4K-SSD-BBLKD", "accessory", "an SSD carrier, not an SSD"],
  ["FPR3K-CBL-MGMT", "accessory", "'cable management' is not a cable"],
  ["ASA-IC-B-BLANK", "accessory", "'ASA 5525-X Interface Card Blank Slot Cover' — the blank rule beats ^ASA-IC-"],
  // --- the netmod rule against the interface card the compute rule would have taken
  ["ASA-IC-6GE-CU-A", "module", "'ASA Interface Card with 6 copper Gigabit Ethernet data ports' — the -nGE-CU compute token is anchored to CCS-/WSA- so this stays a netmod with ports"],
  ["ASA-IC-6GE-CU-B", "module", "the 5525-X card, same reason"],
  ["ASA-IC-6GE-CU-C", "module", "the 5545-X/5555-X card, same reason"],
  // --- the firewall shapes against their own licences and subscriptions (the class table catches these)
  ["FPR2120-P", "non-hardware", "'Cloud Management for FPR 2120' — the firewall rule would take FPR2120"],
  ["CSF1240T-TM", "non-hardware", "'CSF 1240 Threat Defense IPS & Malware Defense License' — the firewall rule would take CSF1240"],
  ["ASA5506-SEC-PL", "non-hardware", "'ASA 5506-X Sec Plus License' — the firewall rule would take ASA5506"],
  ["ASA5555-BOT-1YR", "non-hardware", "'ASA 5555-X Botnet Traffic Filter License for 1 Year'"],
  ["FPR9K-TD-BASE", "non-hardware", "'Threat Defense base licence for the 9300'"],
  ["FTDV10", "non-hardware", "'Cisco FTDv10' — a virtual tier, not a box"],
  ["ESA-MFE-3Y-S2", "non-hardware", "'Email McAfee Anti-Virus 3Y Lic Key' — the email rule would take ESA-"],
  ["WSA-WSS-1Y-S3", "non-hardware", "'Premier(REP+UC+AMAL) CTA,AMP,TG-200/Day 1Y,500-999 Usrs' — a Secure Web subscription; the web rule needs WSA-S###"],
  ["SF-WSA-12.0.1-K9", "non-hardware", "'WSA Async OS 12.0.1' — a software image in the same family"],
  ["CSM4-UCS2-50-SW", "non-hardware", "the -SW half of the CSM UCS bundle is a licence; only -HW / -K9 is a server"],
  ["CV-CNTR-M6N-SW", "non-hardware", "'Cyber Vision Center M6N Software' — the analytics rule would take CV-CNTR-"],
  ["LC-FPS-1K-RED", "non-hardware", "'Redundant StealthWatch Collection License, 1K' — the analytics rule would take LC-"],
  ["S-ISE-APX-1YR-100", "non-hardware", "an ISE subscription — the identity rule needs SNS-3###"],
  // --- and the products whose own SKU could be read as a shape it is not
  ["FPR9K-FAN", "fan", "'Firepower 9000 Series Fan' — the firewall rule's ^FPR-?\\d{4} cannot reach FPR9K, and the fan rule runs first anyway"],
  ["FPR4200-PWR-AC", "power", "'Secure Firewall 4200 Series AC Power Supply' — the power rule beats the firewall rule on FPR4200"],
  ["FPR4200-FAN", "fan", "and its fan"],
  ["FPR3K-SLIDE-RAILS=", "accessory", "'Secure Firewall 3100 Series Slide Rail Kit' — an accessory, although FPR3K reads like a firewall"],
  ["CSF6100-FAN", "fan", "'Cisco Secure Firewall 6100 Series Fan' — the fan rule beats ^CSF\\d{3,4}"],
  ["CSF6100-SLD-RAILS", "accessory", "and its rail kit"],
  ["ASA5585-BLANK-HD", "accessory", "'ASA 5585-X Hard Drive Blank Slot Cover' — not a drive and not a firewall"],
  ["ASA5505-MEM-512=", "memory", "'512 MB Memory Upgrade for Cisco ASA 5505' — memory, although ASA5505 reads like a firewall"],
  ["ASA-RAILS", "accessory", "'ASA 5512-X - ASA 5555-X Rail Kit'"],
  ["SNS-3755-K9-CHAS", "identity", "'Medium Secure Network Server Chassis for ISE Applications' — a CHASSIS is the box itself, so it is NOT an accessory"],
  ["FMC2500-CHAS-K9=", "management", "'Cisco FMC2500 Chassis Spare w/o PSU' — likewise"],
  ["ST-DN6400-CHAS-K9", "analytics", "likewise for a Data Node chassis"],
  ["FPR2130-ASA-K9-CAP", "firewall", "'Firepower 2130 ASA Appl, 1U, 1 NetMod, 5Y SNT Support' — the word NetMod is in the NAME, not the SKU"],
  // --- an APPLIANCE PREFIX against the components filed under it. Each of these matches an appliance
  //     rule as well, and is saved only by a component rule running first.
  ["LC-FC-PWR-AC-1200W", "power", "'1200W / 800W V2 AC Power Supply for 2U C-Series Servers' — the analytics rule's LC-FC matches it"],
  ["LC-FC-HDD-1.2TB", "drive", "the same Lancope FlowCollector's disk"],
  ["ST-M5-PWR-AC-1050=", "power", "a Stealthwatch M5 supply; ST- is an analytics prefix"],
  ["FS750-RAILS=", "accessory", "'FIreSIGHT 750 Rail Kit (Spare)' — the management rule's ^FS\\d{3,4}- matches FS750-"],
  ["IPS-4300-RAILS", "accessory", "'IPS 4345 and 4360 tool-less sliding rail kit' — the ips rule's ^IPS-4\\d{3} matches IPS-4300"],
  ["AMP8300-STK40G-K9", "accessory", "'Cisco 40G Stacking Kit for AMP 8300 Series' — the ips rule's ^AMP[78]\\d{3} matches AMP8300"],
  ["FP8000-STACK-MOD", "accessory", "'Cisco FirePOWER Stacking Module for 8000 Sensor Chassis' — a stack kit, not a netmod"],
  ["FPR9K-SM-S800GS1", "drive", "'Firepower 9000 Series 800GB SSD' — the fw-blade rule's ^FPR9K-SM matches it and the drive rule runs first"],
  ["ASA5585-RACK-KIT=", "accessory", "'ASA 5585-X Front Rack and Rear Rack Kit'"],
  ["CCS-X90RAIL=", "accessory", "'Cisco Content Sec Rail Kit for x90 Appliance'"],
  ["TG-RAILF-M4", "accessory", "'Thread Grid Friction Rail Kit for C220 M4 rack servers' (sic)"],
  ["CCS-HS-1U", "accessory", "a heat sink for 1U — the HS-\\d token"],
  ["SMA-STD-FPLT", "accessory", "'Standard Mechanical Faceplate for M1070' — the management rule needs ^SMA-?M\\d{3}"],
  ["WSA-4GE-CU", "nic", "'WSA 4-Port 10/100/1000 Interface Card, RJ-45' — the web rule needs ^WSA-?S\\d{3}"],
  ["ISE-SNS-ACCYKIT", "accessory", "'ISE SNS Accessory Kit' — the identity rule needs ^SNS-3\\d{3}"],
  // --- and three rows the CLASS table deliberately leaves hardware, so a kind rule has to answer
  ["FPR1010T-SBE", "firewall", "'Cisco Secure Firewall FPR1010 Small Business Edition' — bundle or licence is an open question, so it keeps a box's questions rather than being guessed away"],
  ["C1-TETRATION", "analytics", "'Secure Workload bundle part number that includes the hardware and software subscription license' — the bare C1- class prefix is refused, and kind-layer names the Secure Workload shape"],
  // kind-layer (13 Sep 2026) refusals: the new appliance rules must not take the appliances' own components, and the
  // licence rule must not take an appliance accessory.
  ["CSACS-ACCYKIT", "accessory", "'Accessory Kit for Access Control System SW on 3415-appliance' — not the ACS licence"],
  ["TG-M6-TPM-2.0", "tpm", "'Cisco Secure Malware Analytics TPM 2.0, for M6 servers' — not the TG appliance"],
  ["TG-M5-RAID-12G", "storage-controller", "'Threat Grid 12G Modular RAID controller' — not the TG appliance"],
  ["TG-PWR-AC-770W", "power", "a Threat Grid supply — not the appliance"],
  ["AMPPC-CPU-6126", "cpu", "'Secure Endpoint Cloud 2.6 GHz 6126' — not the AMP private-cloud appliance"],
  ["SEPC-RAID-12G", "storage-controller", "a Secure Endpoint Private Cloud RAID controller — not the appliance"],
  ["AMPPC-PCIE", "compute", "'Cisco Secure Endpoint Cloud PCIe Card' — a PCIE segment with no NIC code is not a NIC"],
  ["ST-M6-RAID-12G-SD", "storage-controller", "'SNA M6 12G SAS RAID Controller-4GB FBWC(28 Drives)' — the -SD tail is not a drive"],
  // ...and every other component family of the three appliance lines the new ^TG / ^SEPC / ^AMPPC rules name, each kept
  // off the appliance kind by the component rules that run first.
  ["TG-M5-HDD-2.4TB", "drive", "'Cisco Secure Malware Analytics 2.4TB 12G SAS 10K RPM SFF HDD'"],
  ["TG-M6-MEM-A-32GB", "memory", "'Cisco Secure Malware Analytics 32GB DDR4-3200-MHz RDIMM'"],
  ["TG-M5-10G-NIC", "nic", "'Cisco Threat Grid X710 quad-port 10G SFP+ NIC'"],
  ["TG-RAILF-M4", "accessory", "'Thread Grid Friction Rail Kit for C220 M4 rack servers'"],
  ["TG-M7-PSU1-1200W-D", "power", "a Threat Grid M7 supply"],
  ["TG-M6-CPU-I6330N", "cpu", "'Cisco Secure Malware Analytics I6330N 2.2GHz'"],
  ["AMPPC-SSD-800GB", "drive", "'Cisco Secure Endpoint Cloud 800GB SSD'"],
  ["AMPPC-HDD-1.2TB", "drive", "'Cisco Secure Endpoint Cloud 1.2TB Hard Drive'"],
  ["AMPPC-MEM-A-64GB", "memory", "'Cisco Secure Endpoint 64GB DDR4 RAM (3200Mhz/PC4-19200/1.2v)'"],
  ["AMPPC-10G-NIC", "nic", "'Cisco Secure Endpoint Cloud X710 quad-port 10G SFP+ NIC'"],
  ["AMPPC-TPM-2.0", "tpm", "'Cisco Secure Endpoint Cloud Trusted Platform Module 2.0'"],
  ["SEPC-10G-NIC", "nic", "a Secure Endpoint Private Cloud NIC"],
  ["SEPC-AC-1050", "power", "a Secure Endpoint Private Cloud supply"],
  ["SEPC-SD76TBM1X-EV", "drive", "a Secure Endpoint Private Cloud 7.6 TB SSD"],
  ["SEPC-MEM-A-64GB", "memory", "a Secure Endpoint Private Cloud DIMM"],
  ["SEPC-RIS1A-240M6", "compute", "a Secure Endpoint Private Cloud riser — residual compute, not the appliance"],
  ["FS1500-BASE-K9", "management", "'FireSIGHT Defense Center 1500, no FireSIGHT license' — a chassis whose name says it has NO licence"],
  // --- and one refusal per APPLIANCE PREFIX, so no box rule is left with an untested component.
  //     The firewall rule alone (^ASA-?55\d\d, ^FPR-?\d{4}, ^CSF\d{3,4}) would take all ten of these.
  ["ASA5516-BRACKET=", "accessory", "'ASA 5516-X Bracket Spare'"],
  ["ASA5585-REAR-RACK", "accessory", "'ASA 5585 Rear Rack Mount'"],
  ["ASA5585-BLANK-H", "accessory", "'ASA 5585-X Half Width Blank Slot Cover'"],
  ["ASA-IC-C-BLANK", "accessory", "'ASA 5545-X/5555-X Interface Card Blank Slot Cover'"],
  ["ASA5506H-PWR-AC", "power", "'ASA 5506H-X Power Adaptor'"],
  ["FPR4200-SLD-RAILS", "accessory", "'Secure Firewall 4200 Series Slide Rail Kit'"],
  ["FPR2K-RAIL-BRKT", "accessory", "'Firepower 2000 Slide Rail Brackets'"],
  ["FPR2K-RMK", "accessory", "'Firepower 2000 Series Rack Mount Kit'"],
  ["CCS-RAILS-170=", "accessory", "'Content Sec Platform Rails for x170,4 Post Racks, Square Hole'"],
  ["UCSC-RAIL-M6=", "accessory", "'Ball Bearing Rail Kit for C220 & C240 M6 rack servers', filed in security"],
  ["FP8140-STACK", "accessory", "'FirePOWER Stacking Kit for 8140' — the ips rule's ^FP[78]\\d{3} matches FP8140"],
  ["FP8200-STACK-K9", "accessory", "'Cisco FirePOWER Stacking Kit for 8200'"],
  ["AMPPC-AC-1050", "power", "'Secure Endpoint Cloud 1050W AC Power Supply'"],
  ["AMPPC-MEM-X-64GB", "memory", "'Secure Endpoint 64GB DDR4 RAM'"],
  ["TG-SSD-120GB", "drive", "'Thread Grid 120 GB 2.5 inch Enterprise Value 6G SATA SSD' (sic)"],
  ["FMC-M5-SSD-800G", "drive", "'Cisco 800GB 2.5in Enterprise Value 6G SATA SSD' for an FMC — the management rule is ^FMC-?\\d{3,4}, so FMC-M5 is not a console"],
  ["CV-CPU-A7443P", "cpu", "'AMD 2.85GHz 7443P 200W 24C' — the analytics rule is anchored to ^CV-CNTR-, so a Cyber Vision CPU is not a Center (kind-layer: cpu, was compute)"],
  ["FPR4200-FAN=", "fan", "the 4200's fan, spare"],
];
for (const [sku, want, why] of REFUSALS) kindIs(sku, want, why);

// =================================================================================================
// ORDER IS PART OF THE RULE — the sabotage, one case per family that depends on running early
// =================================================================================================
// Each pair below is a SKU that matches TWO rules. Move the first after the second (or delete it)
// and the case goes red naming the product that would be mis-shaped. That is what makes these the
// sabotage cases rather than more positives: they fail on a REORDERING, which a list of
// independent positives cannot detect.
const ORDER: [string, SecurityKind, string, string][] = [
  ["FPR3K-PSU-BLANK", "accessory", "blank-carrier", "power — 'Power Supply Blank Slot Cover' carries PSU"],
  ["FPR4K-SSD-BBLKD", "accessory", "blank-carrier", "drive — it carries SSD"],
  ["FPR3K-NM-BLANK", "accessory", "blank-carrier", "netmod — it carries NM"],
  ["FPR3K-CBL-MGMT", "accessory", "blank-carrier", "cable — it carries CBL"],
  ["FPR9K-SUP-BLANK", "accessory", "blank-carrier", "netmod — the new ^FPR\\dK-SUP rule"],
  ["ASA5585-BLANK-HD", "accessory", "blank-carrier", "drive — it carries HD-"],
  ["ASA-IC-B-BLANK", "accessory", "blank-carrier", "netmod — it carries ^ASA-IC-"],
  ["ESA-X1070-FPLT=", "accessory", "mount-kit", "email — ^ESA-?[CX]\\d{2,4} matches ESA-X1070"],
  ["FP8200-STACK", "accessory", "stack-kit", "ips — ^FP[78]\\d{3} matches FP8200"],
  ["FPR4200-PWR-AC", "power", "power", "firewall — ^FPR-?\\d{4} matches FPR4200"],
  ["CSF6100-FAN", "fan", "fan", "firewall — ^CSF\\d{3,4} matches CSF6100"],
  ["ASA5512-SSD120-K9", "firewall", "refuse:asa-with-ssd", "drive — it carries SSD120"],
  ["ASA5505-MEM-512=", "memory", "memory", "firewall — ^ASA-?55\\d\\d matches ASA5505"],
  ["ASA5585-HD-600GB", "drive", "drive", "firewall — ^ASA-?55\\d\\d matches ASA5585"],
  ["ASA-SSP-IPS60-K9", "ips-module", "ips-processor", "fw-blade — ^ASA-SSP- matches it too, and an IPS processor is not a firewall blade"],
  ["ASA5585-SSP-10", "security-module", "fw-blade", "firewall — ^ASA-?55\\d\\d matches ASA5585"],
  ["ASA5585-NM-8-10GE", "module", "netmod", "firewall — the same prefix"],
  ["ST-M5-10G-4FI", "nic", "nic", "analytics — ^ST- is not an analytics prefix, but the -10G-4FI token must be read before anything else claims it"],
  // security-r6 (12 Sep 2026): the three ORDERING cases the corpus diff produced, each one a part
  // the new rules would take if they ran a line earlier. They are the whole reason the memory and
  // nic rules sit AFTER the accessory / drive rules rather than at the top of the component block.
  ["CCS-MLOM-BLNK", "accessory", "blank-carrier", "nic — 'MLOM Blanking Panel' carries the MLOM token and is a panel"],
  ["FS750-MEM-KIT=", "accessory", "mount-kit", "memory — 'Memory Kit' carries MEM- and states no capacity"],
  ["MEM-7100-CFL128M", "drive", "compact-flash", "memory — a MEM- prefix over 'Compact Flash Disk, 128 MB', which is storage"],
  ["ST-M6-240GB-SATA", "drive", "drive", "analytics"],
  ["TG-M7-SDB3T8SA1VD", "drive", "drive", "the fallback, which would have made it a box"],
  // kind-layer (13 Sep 2026): the `compute` split is an ORDERING change — each library kind sits before the old
  // catch-all, which still matches every one of these. Delete a rule, or move it after `compute`, and its case goes red.
  ["SNS-CPU-4116", "cpu", "cpu", "compute — the catch-all's CPU token"],
  ["FMC-MRAID12G", "storage-controller", "storage-controller", "compute — the catch-all's MRAID\\d* token"],
  ["SNS-UCS-TPM", "tpm", "tpm", "compute — the catch-all's TPM token"],
  ["CCS-PCIE-IQ10GF", "nic", "nic", "compute — the catch-all's PCIE token"],
  ["TG-M6-TPM-2.0", "tpm", "tpm", "analytics-sandbox-and-workload would not take it, but the fallback name path would file a TPM as security-module"],
  ["CSACS-3495-UP-K9", "non-hardware", "licence-pending-class", "the (default) appliance fallback"],
  ["1210CP", "firewall", "firewall-1200-model-and-asa-vpn-bundle", "the (default) appliance fallback"],
  ["TA-CL-39U-M6-K9", "analytics", "analytics-sandbox-and-workload", "the (default) appliance fallback"],
  ["AMPPC-3000-K9", "management", "management-endpoint-private-cloud", "the (default) appliance fallback"],
  // MERAKI MX (reviewer's ruling, 28 Sep 2026) — 18 models moved here from `meraki`. What each of these beats
  // is the APPLIANCE FALLBACK, and that is the whole point: without the rule an MX lands as a generic
  // appliance and is asked a security appliance's questions instead of a firewall's ips_throughput,
  // tls_throughput and vpn_peers. One per shape the rule has to read, not one per model.
  ["MX64", "firewall", "meraki-mx", "the (default) appliance fallback — the bare small-branch model"],
  ["MX64W", "firewall", "meraki-mx", "the same, with the Wi-Fi suffix"],
  ["MX67C", "firewall", "meraki-mx", "the CELLULAR model — a C does not make it a gateway"],
  ["MX68CW", "firewall", "meraki-mx", "cellular AND Wi-Fi together"],
  ["MX450", "firewall", "meraki-mx", "the three-digit campus model, where MX450 must not read as MX45 + 0"],
  ["MX68CW-HW-WW", "firewall", "meraki-mx", "the -HW -WW ordering suffixes, which no part carries today"],
];
for (const [sku, want, ruleId, beats] of ORDER) {
  seen.add(securityKindRule(sku));
  eq(`ORDER ${sku}: ${ruleId} wins over ${beats}`, `${securityKind(sku)}/${securityKindRule(sku)}`, `${want}/${ruleId}`);
}

// =================================================================================================
// TOTALITY, the kind sets, and every rule exercised
// =================================================================================================
eq("the empty SKU fails safe to the fallback", securityKind(""), "appliance");
eq("whitespace only fails safe too", securityKind("   "), "appliance");
eq("a spare suffix does not change the kind", securityKind("ASA5585-FAN="), securityKind("ASA5585-FAN"));
eq("lower case input is upper-cased first", securityKind("fpr-2130"), "firewall");
eq("a SKU matching nothing gets the fallback, which asks LESS",
  securityKind("SOME-PART-NOBODY-HAS-SEEN"), "appliance");
eq("the fallback is a BOX kind, so it keeps the physical envelope and nothing shape-specific",
  (SEC_BOX as readonly string[]).includes("appliance"), true);
eq("a blade is a COMPONENT, not a box", (SEC_COMPONENT as readonly string[]).includes("security-module"), true);
eq("and it is not in SEC_BOX", (SEC_BOX as readonly string[]).includes("security-module" as never), false);
eq("SEC_KINDS covers the box kinds, the components and non-hardware, with no duplicates",
  SEC_KINDS.length, new Set(SEC_KINDS).size);
eq("SEC_KINDS is exactly SEC_BOX + SEC_COMPONENT + non-hardware",
  SEC_KINDS.length, SEC_BOX.length + SEC_COMPONENT.length + 1);

// kind-layer (13 Sep 2026): THE NAME PATH, end to end. partKind reads the name only when the axis returns a fallback
// kind, and in `security` the tpm marker would reach `security-module`, the riser marker `module`, a FBWC cache name
// `drive`. The split kinds are NAMED so that path never opens — asserted on the catalogue names, and the sabotage is
// what those names do when the axis says `accessory` (a fallback) instead.
eq("name path: SNS-TPM-002C 'TPM 2.0, TCG, …' stays tpm", partKind("security", "SNS-TPM-002C", "TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers"), "tpm");
eq("name path: ST-MRAID12G-4GB '…FBWC Cache module' stays storage-controller", partKind("security", "ST-MRAID12G-4GB", "Cisco Stealthwatch 12Gbps SAS 4GB FBWC Cache module"), "storage-controller");
eq("name path: ST-M6-R2R3-C220 '…Riser 2 and Riser 3 Kit' stays compute", partKind("security", "ST-M6-R2R3-C220", "Cisco SNA C220 Riser 2 and Riser 3 Kit"), "compute");
// SABOTAGE: the same names behind a FALLBACK axis answer (an `-ACC-` SKU the mount-kit rule calls accessory). A riser
// name becomes `module` (a netmod, asked ports) and a FBWC cache name becomes `drive` — which is exactly why the residual
// risers stay the named `compute` and the cache modules are `storage-controller`. (A TPM name now reaches `tpm` even from a
// fallback, because `tpm` is declared for security — the marker's first target — so that half of the trap is closed twice.)
eq("SABOTAGE name path: a riser name behind a fallback kind is filed `module`", partKind("security", "X-ACC-RIS", "Right PCIe Riser Board (Riser 1) (3 x8) for 6 PCI slots"), "module");
eq("SABOTAGE name path: a FBWC cache name behind a fallback kind is filed `drive`", partKind("security", "X-ACC-FBWC", "Cisco Stealthwatch 12Gbps SAS 4GB FBWC Cache module"), "drive");
eq("name path: a TPM name behind a fallback kind reaches `tpm`, not security-module", partKind("security", "X-ACC-TPM", "Cisco FMC Trusted Platform Module 2.0"), "tpm");

// Every kind the type names is reached by a real catalogue SKU in this file.
for (const k of SEC_KINDS) {
  eq(`kind "${k}" is reached by a catalogue SKU here`,
    [...POSITIVES, ...REFUSALS].some(([, w]) => w === k), true);
}
// And every RULE is exercised — the check that caught 107 untested rules in productClass.test.ts.
const unexercised = SEC_RULE_IDS.filter((id) => !seen.has(id));
eq(`every rule family fires on a real SKU (${SEC_RULE_IDS.length} rules)`,
  unexercised.length === 0 ? "none" : unexercised.join(", "), "none");

lines.unshift(`    security kind: ${passed} passed, ${failed} missed ` +
  `(${POSITIVES.length} positives, ${REFUSALS.length} refusals, ${ORDER.length} ordering/sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
