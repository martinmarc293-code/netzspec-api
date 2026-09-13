// src/core/securityKind.ts — what KIND of thing a Cisco `security`-category part is.
//
// THE DEFECT (reviewer verdict on 678606c, §0 and §4). `security` had no kind axis at all: every one of
// its 5,515 hardware parts was asked the same appliance questions, shaped only by SERIES. A fan tray, a
// rack rail, a blank slot cover and an SSD were each asked for dimensions, a weight, an operating
// temperature, a power draw and certifications — and, when their series was a firewall series, for a
// firewall throughput and a session table. The survey of 11 Sep 2026 (evidence/security-servers-series-
// survey.md §e) counted 1,077 component parts carrying 10,621 slots, not one holding an own physical fact.
// Series could not fix it: FPR3K-PSU-BLANK and FPR3105-NGFW-K9 share "4100 Firepower", a series label
// that is wrong for both.
//
// THE DESIGN — the switches pattern, plus the one thing security has that switches do not.
//   1. A SKU the class table (productClass.ts) already calls non-hardware is `non-hardware` and is asked
//      NOTHING. Such a part is still stored `hardware` until a reclassify run moves it; until then it
//      would otherwise be asked a box's questions. Derived from the SKU rules only (no name), so it is
//      the same answer reclassify will write.
//   2. COMPONENT markers in any segment — accessory, cable, power, fan, drive, compute, module — the
//      survey's markers, each counted part-evidence against device-evidence by name.
//   3. SERVICE MODULES: the processing blades that ARE a firewall's engine (Firepower 9300 SM-xx, ASA
//      5585-X SSP-xx) and the IPS processors of the same chassis. A datasheet quotes throughput PER BLADE
//      ("SM-40 ... 55 Gbps"), so they keep the figures they are bought on and drop the box envelope.
//   4. APPLIANCE SHAPES where the SKU names one: firewall, ips, email-gateway, web-gateway, management,
//      analytics, identity. Series is a column and still shapes the rest (fieldSchema.ts), but series
//      labels are wrong often enough in this category (FMC1700-K9 in "4100 Firepower", FPR3105-NGFW-K9 in
//      "Firepower 9300 Series") that a SKU which names its shape must win.
//   5. Everything else is `appliance`: a box of no SKU-known shape. It is asked the universal box fields
//      and whatever its SERIES shape asks — never more than it was asked before this axis existed.
//
// DEFAULT `appliance` FAILS SAFE, as `switch` does: a component left as an appliance carries gaps; an
// appliance called a component would have its real questions closed.
//
// THE REFUSAL THAT MATTERS (survey §e). ASA5512-SSD120-K9 / ASA5525-SSD120-K8 are the APPLIANCE shipped
// with a 120 GB SSD ("NGFW ASA 5512-X w/ SW,6GE Data,...,SSD 120G"), not a drive. The drive marker would
// file all five as drives, so the appliance pattern for them runs before it.
import { classify } from "./productClass.js";

export type SecurityKind =
  | "non-hardware"
  | "firewall" | "ips" | "email-gateway" | "web-gateway" | "management" | "analytics" | "identity" | "appliance"
  | "security-module" | "ips-module"
  | "module" | "power" | "fan" | "drive" | "compute" | "memory" | "nic" | "cable" | "accessory"
  // kind-layer (13 Sep 2026): three library component kinds split out of `compute` — see the rules below.
  | "cpu" | "storage-controller" | "tpm";

/** Every kind that is a whole box you rack and power — asked the physical envelope. */
export const SEC_BOX: readonly SecurityKind[] =
  ["firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity", "appliance"];

/** Kinds that plug into or attach to a box — every one is bought for WHAT IT FITS. */
export const SEC_COMPONENT: readonly SecurityKind[] =
  ["security-module", "ips-module", "module", "power", "fan", "drive", "compute", "memory", "nic", "cable", "accessory",
    "cpu", "storage-controller", "tpm"];

/**
 * The SHAPE a SKU names, for the profile. A box whose SKU names no shape falls back to its SERIES
 * (fieldSchema.ts), which is why these lists hold only the kinds and `appliance` is absent.
 *
 * `security-module` is in SEC_FIREWALL_KIND on purpose: a Firepower 9300 SM-40 is quoted its OWN
 * firewall throughput, threat throughput and session table ("SM-40 … 55 Gbps"), which is what the
 * blade is bought on, and 3 of the 88 already hold those facts. The chassis it plugs into is a
 * different product with different numbers.
 */
export const SEC_FIREWALL_KIND: readonly SecurityKind[] = ["firewall", "security-module"];
/** Anything that inspects traffic in line — a firewall, a dedicated IPS, or a firewall blade. */
export const SEC_INLINE_KIND: readonly SecurityKind[] = ["firewall", "ips", "security-module"];
/** Bought on INSPECTED throughput: the dedicated IPS appliances and the 5585-X IPS processors. */
export const SEC_IPS_KIND: readonly SecurityKind[] = ["ips", "ips-module"];
/** Sized by the number of mailboxes or users behind it. */
export const SEC_USER_SIZED_KIND: readonly SecurityKind[] = ["email-gateway", "web-gateway"];
/** Boxes sized by the store they keep (a mail spool, an event or flow store). */
export const SEC_STORE_KIND: readonly SecurityKind[] = ["email-gateway", "web-gateway", "management", "analytics"];
/** Every kind that DRAWS power of its own and has a figure printed for it. */
export const SEC_POWERED_KIND: readonly SecurityKind[] = [...SEC_BOX, "module", "security-module", "ips-module"];

/** Everything securityKind can return, in the order the ledger lists it. */
export const SEC_KINDS: readonly SecurityKind[] = [...SEC_BOX, ...SEC_COMPONENT, "non-hardware"];

// Ordered; the FIRST rule that matches wins.
const RULES: { kind: SecurityKind; id: string; re: RegExp }[] = [
  // ---- kind-layer (13 Sep 2026): LICENCES STILL CLASSED HARDWARE, read out of `appliance` -----------
  // III.0 item 4 §7k read all 30 `appliance` rows. Six are software on an appliance, not the appliance:
  // CSACS-3415-K9 / CSACS-3495-K9 "ACS application & BASE license for SNS-3415-K9 appliance", the two
  // CSACS-34x5-UP-K9 "Upgrade to ACS application on SNS-3495-K9", TB-ESS-100GB (Telemetry Broker
  // essentials, a volume licence) and ISA-FP-541213-K9 "IDS / IPS for Industrial Security Appliances K9
  // level". The class change is a run (D:\tmp\kindlayer-impl\5-security-video-optical\class-changes.json);
  // until it lands they are asked NOTHING, exactly what the class table's `non-hardware` answer does.
  // NOT CSACS-ACCYKIT (an accessory kit, taken by the mount-kit rule) and NOT a bare CSACS appliance:
  // the pattern names the application/upgrade PIDs only.
  { kind: "non-hardware", id: "licence-pending-class", re: /^CSACS-\d{4}(?:-UP)?-K9$|^TB-ESS-\d|^ISA-FP-\d{6}-K9$/ },
  // ---- components (survey §e markers) --------------------------------------------------------------
  // Blanks, SSD carriers and cable management FIRST: FPR3K-PSU-BLANK, FPR4K-SSD-BBLKD, FPR3K-NM-BLANK and
  // FPR3K-CBL-MGMT carry a power / drive / module / cable token and are none of those.
  { kind: "accessory", id: "blank-carrier", re: /(?:^|-)(?:BLANK|BLNK|BBLKD|BLKD|BLK|DIV|FBRS\d)(?:-|=|$)|-SSD-BLANK|CBL-MGMT|CABLE-?MGMT|CABLEARM/ },
  // + BRACKETS (ASA-BRACKETS= "brackets for rack mounting"), LKFP (Content Security locking faceplate) and HS-n
  // (CCS-HS-1U "heat sink for 1U") — found in the default bucket, 12 Sep 2026.
  // RAIL is matched with anything in front of it, not only at a segment start: CCS-RAIL=, CCS-X90RAIL=,
  // UCSC-RAILB-M4= and TG-RAILF-M4 are all rail kits and only the first is `-RAIL`-shaped. 98 catalogue
  // parts carry the token and not one holds an own physical fact. BEZEL / FPLT / FACEPLATE join for the
  // same reason (FP-8000-BEZEL=, SMA-STD-FPLT "Standard Mechanical Faceplate for M1070").
  { kind: "accessory", id: "mount-kit", re: /(?:^|-)(?:BRKT|BRACKETS?|SLIDE|SLD|RSLIDE|RMK|RM|RACK|RCKMNT|MNT|ACC|ACY|ACK|CVR|COVER|BEZEL|FPLT|FACEPLATE|FILTER|BBU|OCP3|ADPT)(?:-|=|\d|$)|(?:^|-)[A-Z0-9]*RAILS?[BF]?(?:-|=|\d|$)|(?:^|-)[A-Z]*KIT\d*(?:-|=|$)|(?:^|-)HS-\d|^CCS-LKFP/ },
  // (LKFP is anchored to CCS-: ESA-C680-LKFP-K9 is "ESA C680 Email Security Appliance with Locking Faceplate".)
  { kind: "accessory", id: "stack-kit", re: /-STACK(?:-|=|$)|-STK\d+G/ },
  // Two one-part shapes read out of the default bucket, 12 Sep 2026. Both are mechanical: ST-M6-AD-245
  // "C245M6 PCIe Air Duct for PCIe Cards" and AMPPC-DM-2X-R "Secure Endpoint Cloud Rear Drive Module -
  // 2 Slot", a drive CAGE rather than a drive. Each token matches exactly one part in the whole catalogue.
  { kind: "accessory", id: "chassis-mech", re: /(?:^|-)AD-\d{3}(?:-|=|$)|(?:^|-)DM-\d+X/ },
  // AN UPGRADE KIT IS NOT THE THING IT UPGRADES. ASA5512-FP-UPG / ASA5515-FP-UPG are "Upgrade Kit:
  // ASA5512-X FW, IPS, CX to ASA5512-X FirePower" — a part you fit to an appliance you already own, and
  // the only two rows the reverse name control flagged as a BOX kind whose name says component
  // (12 Sep 2026). The firewall rule below would take them on `^ASA-?55\d\d` and ask each one the
  // throughput and session table of the chassis it upgrades, which is this repo's port-parser mistake
  // in another field.
  { kind: "accessory", id: "upgrade-kit", re: /-FP-UPG(?:-|=|$)/ },
  { kind: "cable", id: "cable", re: /(?:^|-)(?:CAB|CBL|CABLE|BKVM)(?:-|=|$)/ },
  { kind: "power", id: "power", re: /(?:^|-)(?:PWR|PSU\d?|PS)(?:-|=|$)|-\d{3,4}W(?:-|=|$)|^[A-Z0-9]+-AC-\d{3,4}W?(?:-|=|$)|-PS-AC/ },
  { kind: "fan", id: "fan", re: /(?:^|-)S?FAN(?:TRAY)?\d*(?:-|=|$)/ },
  // REFUSAL, pinned: the ASA 5500-X appliance ordered with its SSD (see the header).
  { kind: "firewall", id: "refuse:asa-with-ssd", re: /^ASA55\d\d-SSD\d+-K\d/ },
  // + NVME / NVB (CV-NVME4-1600 "1.6TB 2.5in U.2 ... P5620", CV-NVB1T6M2P), 12 Sep 2026.
  // + the M.2 and SATA shapes the default bucket showed, 12 Sep 2026: ST-M6-240GB-SATAM2 ("Cisco SNA 240GB
  // SATA M.2") and TG-M7-SDB3T8SA1VD (a 3.8 TB SATA drive).
  { kind: "drive", id: "drive", re: /(?:^|-)(?:SSD|HDD|SAS|FLASH)\d*(?:\.\d)?(?:[GT]B?)?(?:-|=|$)|(?:^|-)(?:SSD|HDD|HD|SD)-?\d{2,4}(?:\.\d)?[GT]|-S\d{3,4}G[A-Z]|-D\d{3}G[A-Z]|-CF-\d+MB|-D\d+TBSATA|-DVD-|(?:^|-)NVME|(?:^|-)NVB\d|-\d{2,4}GB?-SATA|(?:^|-)SDB\d+T\d|(?:^|-)(?:SSD|HDD)\d{2,4}[A-Z]{2,}/ },
  // ---- security-r6 (12 Sep 2026): TWO SHAPES OUT OF `compute`, BECAUSE THEY HOLD ALL ITS FACTS --
  // `compute` was ONE kind of 224 parts asked ONE cup (product_compatibility), and 39 of those
  // parts hold a fact. Read by SKU token, the 39 facts are not spread across the kind: 33 are
  // `dram` on memory modules and 6 are `ports` on network cards. Every other member — 132 CPUs,
  // RAID controllers, TPMs, risers and storage carriers — holds nothing. So the cup a DIMM is
  // bought on and the cup a NIC is bought on were both being carried by parts nobody asked, while
  // a TPM would have been asked a DRAM capacity had the cup been added to `compute` as a whole:
  // the "capability statement" mistake in schema form, which is why this is two kinds and not one
  // wider cup set. 132 parts stay `compute` and stay asked only what they fit.
  //
  // ORDER: both rules sit HERE, after the blank / mount-kit / cable / power / fan / drive rules and
  // before `compute`, and the placement is load-bearing in two measured cases. CCS-MLOM-BLNK is a
  // "MLOM Blanking Panel" and the MLOM token would take it; FS750-MEM-KIT= and FS3500-MEM-KIT= are
  // "Memory Kit" rows with no capacity; all three are taken by the earlier accessory rules and must
  // stay there. tests/securityKind.test.ts pins all three as ordering cases.
  //
  // A `MEM-` PREFIX OVER A STORAGE PART, and it is refused by naming it rather than by a negative
  // lookahead: MEM-7100-CFL128M is "Cisco 7160 Compact Flash Disk, 128 MB". Its siblings
  // ASA5500-CF-256MB= and FS2K-FLASH-16GB are already `drive`; this one is spelled CFL and the
  // drive rule's `-CF-\d+MB` does not reach it, so the memory rule would have taken it and asked a
  // flash disk for a DRAM capacity — the wrong cup holding a plausible number, the hardest error
  // to find later. It is the ONLY `CFL` part in the catalogue, which is why the rule is this tight.
  { kind: "drive", id: "compact-flash", re: /(?:^|-)CFL\d{2,4}[MG]/ },
  { kind: "memory", id: "memory",
    re: /(?:^|-)(?:MEM|MR|DIMM)(?:-|=|\d|$)|(?:^|-)MRX\d|(?:^|-)X\d{1,3}G\dR[WS]|(?:^|-)\d+GBSR-/ },
  // `-\d{1,2}GE-CU` IS STILL ANCHORED TO CCS-/WSA-, for the reason the compute rule below records:
  // the unanchored form takes ASA-IC-6GE-CU-A, an ASA Interface Card, which is a netmod with six
  // data ports and three stored facts of its own. The first draft of this rule dropped the anchor
  // and the corpus diff showed all six ASA-IC-6GE-CU-* moving out of `module` — the rule's own
  // documented refusal, re-broken and caught by reading the diff rather than by the suite.
  // kind-layer (13 Sep 2026): + the two NIC spellings the `compute` read found (III.0 item 4 / spec II.8 check):
  // SNS-PCIE-IQ10GF "Intel X710 quad-port 10G SFP+ NIC", CCS-M6-PCIE-IRJ45 "Intel i350 Quad Port 1Gb Adapter",
  // CCS-M6-PCIE-ID10GF "X710-DA2 dual-port 10G SFP+ NIC" (a PCIE segment then the Intel code), and the UCS
  // N2XX part numbers SNS-N2XX-ABPCI01 "Broadcom 5709 Dual Port 10/100/1Gb NIC" / LC-FC-N2XX-AIPCI01
  // "Intel X520 Dual Port 10Gb SFP+ Adapter". Eight rows, every one a network card by its own name.
  { kind: "nic", id: "nic",
    re: /(?:^|-)(?:NIC|MLOM)(?:-|=|$)|-\d{1,2}G-NIC|-\d{1,2}GE-FI|^(?:CCS|WSA)-\d{1,2}GE-CU|-[OP]-I\d?[A-Z0-9]*G[CF]|(?:^|-)PCIEI?D?\d|-\d{1,2}G-\dFI|(?:^|-)PCIE-I(?:[DQ]\d{1,3}G[FC]|RJ45)(?:-|=|$)|(?:^|-)N2XX-A[A-Z]PCI\d/ },
  // ---- end security-r6 (12 Sep 2026) --------------------------------------------------------------
  // ---- kind-layer (13 Sep 2026): `compute` IS NOT A SERVER, AND IT IS NOT ONE NOUN -----------------------
  // Spec v2 II.8 says `compute` 131 = "UCS-based security servers" and proposes the SERVER archetype. All
  // 131 rows were read (D:\tmp\kindlayer-impl\5-security-video-optical\REPORT.md): ZERO are servers. They
  // are the internal parts of the UCS boxes FMC / SNS / Stealthwatch / Threat Grid / CCS run on — CPUs
  // ("CCS Intel 6326 2.9GHz/185W 16C/24MB DDR4 3200MHz"), RAID controllers and their FBWC cache modules,
  // TPMs, PCIe risers — so the SERVER cups (sockets, DIMM slots, drive bays) would be unfillable by
  // construction. They take the LIBRARY component names UCS already uses for the same parts, so one kind
  // name means one cup set (rule 3): a UCS-CPU-I6326 and a CCS-CPU-I6326 are the same processor.
  //
  // THE NAMES MUST NOT FALL TO A FALLBACK KIND, and that is measured, not feared: nameMarker read over these
  // 131 names returns `tpm` for 13 ("Trusted Platform Module 2.0"), `riser` for 5, `drive` for 3 FBWC cache
  // modules ("12Gbps SAS 1GB FBWC Cache module") and `power` for 3 RAID parts with a battery. partKind reads
  // the name only when the axis returns a fallback kind, and in `security` the tpm marker's second target is
  // `security-module` and the riser marker's third is `module` — so a TPM filed as `accessory` would be asked a
  // firewall throughput. Every shape below is therefore a NAMED kind, and the 17 residual internal boards
  // (risers, the M.2 / SD carriers, the Cavium SSL card) stay the named `compute`, which asks what they fit.
  { kind: "cpu", id: "cpu", re: /(?:^|-)CPU(?:-|=|$)/ },
  // RAID controllers, their FBWC cache modules and battery, the embedded SW RAID: MRAID12G, RAID-9271, HWRAID,
  // RAID9271CV-8I, BAT-RAID-710, RAID-ROM5. A drive CARRIER is not one (FMC-M5-MSTOR-SD stays `compute`).
  { kind: "storage-controller", id: "storage-controller", re: /(?:^|-)(?:HW|M)?RAID(?:\d|-|=|$)/ },
  { kind: "tpm", id: "tpm", re: /(?:^|-)TPM(?:\d|-|=|\.|$)/ },
  // CPUs, RAID controllers, TPMs and risers of the UCS-based appliances (FMC, SNS, TG, AMPPC, CCS, CV,
  // CSM, Stealthwatch). + four token shapes the default bucket showed: FPR9K-X32G2RW= / CV-MRX16G1RE5 (DIMMs),
  // FMC-M6-O-ID10GC (an OCP NIC), PRSM-RAID9271CV-8I (MegaRAID), CCS-10GE-FI (a fibre NIC).
  // + four more shapes from the default bucket, 12 Sep 2026: SNS-4GBSR-1X041RY ("4GB 1600 Mhz Memory
  // Module"), SNS-UCS-SSL-CATD ("Cavium Card"), ST-M6-M2EXT-240 ("C240 2U M6 M.2 Extended Board") and
  // TG-M7-PCIEID10GF-D (a PCIe NIC).
  // `-\d{1,2}GE-CU` IS ANCHORED TO CCS-/WSA-: the unanchored form would take ASA-IC-6GE-CU-A, which is an
  // ASA Interface Card — a netmod with six data ports and a fact of its own — and this rule runs BEFORE
  // the netmod rule, so it would win. The -FI twin needs no anchor: no ASA-IC- part is -FI shaped.
  { kind: "compute", id: "compute", re: /(?:^|-)(?:CPU|MEM|MR|ML|RAID\d*|MRAID\d*G?|HWRAID|NIC|PCIE|PCI|MLOM|TPM2?|RIS\d[ABH]?|R2R3|MSTOR|N2XX)(?:-|=|$)|-\d{1,2}G-NIC|-TPM|-RIS\d|-X\d+G\dR[WS]|(?:^|-)MRX\d|-[OP]-I\d?[A-Z0-9]*G[CF]|-RAID\d{4}|-\d{1,2}GE-FI|^(?:CCS|WSA)-\d{1,2}GE-CU|(?:^|-)PCIEI?D?\d|-SSL-CAT|(?:^|-)\d+GBSR-|(?:^|-)M\dEXT-|-\d{1,2}G-\dFI/ },
  // ---- service modules: the blade IS the engine ----------------------------------------------------
  // IPS processors first: ASA-SSP-IPS60-K9 "ASA 5585-X IPS Security Services Processor-60", IPS-4510-SSP-K9
  // "IPS 4510 w SW ... CARD ONLY". They are bought on inspected throughput, never on a firewall figure.
  // + ASA-IPS-10-INC-K9 "ASA 5585-X IPS Security Services Processor-10", whose PID carries no SSP token.
  { kind: "ips-module", id: "ips-processor", re: /-SSP-IPS\d|^IPS-\d{4}-SSP|^ASA-IPS-\d+-/ },
  // Firewall blades: FPR9K-SM-36 "Firepower 9000 Series High Performance Security Module", FPR9K-SM44-FTD-BUN,
  // ASA5585-SSP-10 "ASA 5585-X Security Services Processor-10 with 8GE", ASA-SSP-CX20-K8 (the CX SSP), and
  // the datasheet MODEL rows SM-48 / SSP-20 that hold the per-blade figures (open question 4).
  // + ASA-CX20-INC-K8 "ASA 5585-X CX SSP-20 with 8GE", whose PID carries no SSP token either.
  // + ASA-SSE-AIP-65 "ASA 5500 Security Services Engine-65 w 8GE,2SFP+" — the SSE is the same kind of
  // engine under Cisco's other name for it, and it is quoted its own throughput (12 Sep 2026).
  { kind: "security-module", id: "fw-blade", re: /^FPR9K-SM(?:-|\d)|^ASA5585-SSP-|^ASA-SSP-|^ASA-SSE-|^ASA-CX\d+-|^SSP-\d+$|^SM-\d+$/ },
  // Network modules and interface cards: FPR-NM-8X10G, FPR4K-NM-4X40G, FPR3K-XNM-6X25SRF, ASA-IC-6GE-CU-A,
  // ASA5585-NM-4-10GE, FP-NMSB-10G, SSM-4GE (a 4-port ASA module — ports, not a service).
  // + FPR9K-SUP= "Firepower 9000 Series Supervisor Spare": the 9300's supervisor is a slot-in module, and
  // FPR9K-SUP-BLANK (its slot cover) is taken by the blank rule above, which runs first (12 Sep 2026).
  { kind: "module", id: "netmod", re: /(?:^|-)X?NM(?:-|=|$)|DNM|^FPNM-|^FP-NMSB-|(?:^|-)SSM-|^ASA-IC-|-IC-\d|^ASA5585-NM-|^SM-EC-|^FPR\dK-SUP|^AIM-/ },
  // ---- appliance shapes named by the SKU -----------------------------------------------------------
  // Firewalls: Firepower 1000-9300, Secure Firewall 200-6100 (CSF), ASA 5500/5500-X, ISA 3000 industrial.
  // + the 9300 chassis (FPR-CH-9300-AC "Firepower 9300 Chassis for AC Power Supply, 2 PSU/4 fans") and the
  // hardware bundles named without a model digit run (FPR9K-FTD-BUN "FPR9300 Threat Defense Bundle for Security
  // Modules", FPR9KT-HA-BUN, FPR4K-ASA-NGFW-BUN "Firepower 4110 ASA + NGFW Bundle", F4150-ASA-NGFW-BUN).
  // + F4110/F4120/F4140/F4150-ASA-NGFW-BUN (the 4100 bundles are spelled F4nnn, not just F4150) and
  // FPR9KT-SM36-HA-BUN, whose HA token sits after the module size (12 Sep 2026).
  { kind: "firewall", id: "firewall", re: /^FPR-?\d{4}|^FPR-C?9300|^FPR-CH-9300|^FPR9KT?-(?:FTD|HA|SM\d+-HA)|^FPR\dK-ASA-(?:VPN|NGFW)-BUN|^F4\d{3}-|^CSF\d{3,4}|^ASA-?55\d\d|^55\d\d-X$|^ISA-?3000/ },
  // kind-layer (13 Sep 2026), out of `appliance` (III.0 item 4 §7k): the Secure Firewall 1200 datasheet MODEL rows
  // 1210CE / 1210CP / 1220CX — the three parts that hold 61 of the category's facts, firewall_throughput and
  // ips_throughput among them — and ASA-VPN-15K-BUN "Cisco Recommended ASA VPN Bundle for 15K users", an ASA
  // VPN-edition hardware bundle like the 18 "Secure Client" rows the firewall rule already takes (§7c).
  { kind: "firewall", id: "firewall-1200-model-and-asa-vpn-bundle", re: /^12[1-5]0C[EPX]$|^ASA-VPN-\d+K?-BUN$/ },
  // Dedicated IPS: FirePOWER 7000/8000 (FP7010-K9, FP8250-BASE-K9), IPS 4300/4500 (IPS-4345-K9), AMP 7150/8150.
  { kind: "ips", id: "ips", re: /^FP[78]\d{3}(?:-|$)|^IPS-4\d{3}(?:-|$)|^AMP[78]\d{3}(?:-|$)/ },
  // Secure Email (ESA-C390-K9, ESA-X1070-K9) and Secure Web (WSA-S390-K9) appliances. The licences in the
  // same families (ESA-MFE-3Y-S2, WSA-WSS-1Y-S1) never reach here: step 1 took them.
  { kind: "email-gateway", id: "email", re: /^ESA-?[CX]\d{2,4}/ },
  // `^S\d{3}$` is the DATASHEET MODEL ROW for a Secure Web Appliance (S170, S380, S680, S696) — six of
  // them, every one in `security` and in the "Secure Web Appliance" series. A bare three-digit S row
  // exists nowhere else in this category; outside it the shape is S132, a hyperconverged node, which
  // securityKind never sees. (12 Sep 2026; the ASA model rows 55nn-X are handled by the firewall rule.)
  { kind: "web-gateway", id: "web", re: /^WSA-?S\d{3}|^S\d{3}$/ },
  // Management: Secure Email and Web Manager (SMA-M690-K9), Firepower Management Center (FMC1600-K9,
  // FMC4700-K9) and its FireSIGHT predecessors (FS750-K9, FS4000-BASE-K9), Prime Security Manager hardware.
  // + the CSM UCS server bundles (CSM4-UCS2-150-HW "CSM UCS bundle to manage 150 devices"; the -SW halves are
  // licences, see productClass) and PRSM-APPLSW2-25-K9 "PRSM Software Bundled With Physical Appliance".
  // + FMC-M6-BUN ("Secure Firewall Management Center M6 Bundle") and PRSM-APPSW2-100-K9, the second
  // spelling of "PRSM Software Bundled With Physical Appliance" — `^PRSM-APPL` reached only the first.
  { kind: "management", id: "management", re: /^SMA-?M\d{3}|^FMC-?\d{3,4}(?:-|$)|^FMC-M\d-BUN|^FS\d{3,4}-|^PRSM-HW|^PRSM-APP|^CSM4-UCS2-\d+-(?:HW|K9)/ },
  // Secure Network Analytics (Stealthwatch) Flow Collector, Flow Sensor, UDP Director, Management Console — the
  // ST- generation and the Lancope LC- generation before it (LC-SMC-2K-K9 "StealthWatch Management Console 2000
  // appliance", LC-FCNF4010, LC-SENS-3000-F "FlowSensor 3000 appliance", LC-REP-1000 "FlowReplicator 1000") —
  // and the Cyber Vision Center appliance (CV-CNTR-M8N "Cyber Vision Center hardware appliance"). The LC-
  // components (LC-FC-HDD-1.2TB, LC-FC-PWR-AC-1200W) and licences never reach here.
  // + the Data Store and Data Node generation: ST-DS6200-K9 "Stealthwatch Data Store 6200", ST-DN6300-K9
  // "Secure Network Analytics Data Node 6300", ST-TB2400-K9 — 14 boxes that sat in the default bucket.
  { kind: "analytics", id: "analytics", re: /^ST-(?:FC|FS|UDP|SMC|FD|DS|DN|TB)\d{4}|^LC-(?:SMC|FCSF|FCNF|FC|FS|UDP|UD|REP|FR|SENS|COLLECT|CONSOLE|ID)[-\d]|^CV-CNTR-/ },
  // kind-layer (13 Sep 2026), out of `appliance` (III.0 item 4 §7k). Two appliance families the library has no
  // noun of their own for, filed as ANALYTICS rather than given a kind each (decision recorded in the report):
  //   Secure Malware Analytics / Threat Grid — the sandbox appliance that detonates and ANALYSES samples:
  //     TG5000-K9 "Threat Grid 5000 Model with software", TG5504-K9, TG-M5-K9 / TG-M6-K9 / TG-M7-K9 "Secure
  //     Malware Analytics M6 Model Hardware", TG-AFA-K9, the hardware+subscription bundles TG5000-BUN /
  //     TG5500-BUN, and the spare chassis TG5004-CHAS / TG5000-CHAS-AC "Threat Grid 5000/5500 Chasis".
  //   Secure Workload (Tetration) clusters — TA-CL-8U-M6-K9 "Secure Workload Gen3 8RU Cluster", TA-CL-39U-M6-K9,
  //     C1-TETRATION(-M) "bundle part number that includes the hardware" — a flow-telemetry analytics platform.
  // ANALYTICS = APPLIANCE + flows_per_second (optional: zero labels anywhere), so filing a sandbox here asks it
  // exactly the appliance envelope and nothing it cannot have. Their components (TG-PWR-*, TG-M5-HDD-*,
  // TG-RAID-*, TG-M6-TPM-2.0) are taken by the component rules above, which run first.
  { kind: "analytics", id: "analytics-sandbox-and-workload", re: /^TG\d{4}-(?:K9|BUN|CHAS)|^TG-(?:M\d|AFA)-K9$|^TA-CL-\d+U-|^C1-TETRATION(?:-M)?$/ },
  // Secure Endpoint (AMP) Private Cloud appliances — SEPC4000-K9, AMPPC3000-K9, AMPPC-3000-K9 "AMP Private Cloud
  // Appliance - 3000 Model" — the on-premises console and store that MANAGES endpoint connectors: `management`.
  { kind: "management", id: "management-endpoint-private-cloud", re: /^SEPC\d{4}-K9$|^AMPPC-?\d{4}-K9$/ },
  // Identity: the Secure Network Server appliances ISE runs on (SNS-3655-K9, SNS-3495-M-ISE-K9 "Migration
  // Server: Loaded with ISE Software"). NOT CSACS-3415-K9 "ACS application & BASE license for SNS-3415-K9
  // appliance": licence or appliance SKU is undecided (class-residue §C), so it keeps the fallback.
  { kind: "identity", id: "identity", re: /^SNS-3\d{3}(?:-|$)/ },
];

/**
 * Every rule id, in table order, plus the two ids that are not rules (`class-table` and the
 * fallback). Exported so tests/securityKind.test.ts can assert each family is EXERCISED by a real
 * catalogue SKU — a rule no case reaches is a rule nobody has seen work.
 */
export const SEC_RULE_IDS: readonly string[] = ["class-table", ...RULES.map((r) => r.id), "(default)"];

function ruleFor(sku: string): { kind: SecurityKind; id: string } {
  const s = String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
  if (s === "") return { kind: "appliance", id: "(default)" };
  if (classify({ sku: s, categorySlug: "security", categoryIsHardware: true }).klass !== "hardware") {
    return { kind: "non-hardware", id: "class-table" };
  }
  for (const r of RULES) if (r.re.test(s)) return { kind: r.kind, id: r.id };
  return { kind: "appliance", id: "(default)" };
}

export function securityKind(sku: string): SecurityKind {
  return ruleFor(sku).kind;
}

/** Which rule decided — for the distribution report and the refusal tests, never for a profile. */
export function securityKindRule(sku: string): string {
  return ruleFor(sku).id;
}
