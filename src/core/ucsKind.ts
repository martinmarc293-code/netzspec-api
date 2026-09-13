// src/core/ucsKind.ts — what KIND of thing a UCS part is, from its SKU.
//
// WHY NOT SERIES. `servers-unified-computing` has 19 series over 12,541 hardware parts and "UCS
// C-Series" alone holds 6,516 of them. A series names a product LINE, so gating a requirement on
// it asks a C-Series DIMM the same questions as a C-Series rack server. That is the defect the
// whole category has: 13 required fields asked of everything, and six of them present on ZERO of
// 12,541 parts.
//
// WHY NOT THE NAME. Name-bucketing left 7,310 of 12,541 (58%) unclassified.
//
// WHY THE SKU, AND WHY GROUPS RATHER THAN THE RAW TOKEN. Cisco encodes the kind in the token after
// `UCS[CBXSE]-`, and measured on 9 Sep 2026 that axis is CLEAN: zero tokens carry both physical
// facts and component facts once inherited facts are excluded. But it is far too sparse to use
// directly — 1,550 distinct tokens, 510 needed to cover 90% of parts, 1,322 holding fewer than
// five. So the token is NORMALISED into a kind by the ordered rules below, and the rules are
// prefix- and set-based so a new model number lands in the right kind without an edit.
//
// THE INHERITED-FACT TRAP, recorded because it inverted the first answer. Purity was measured over
// all facts and reported the biggest token (CPU, 1,672 parts) as impure — carrying weight and
// operating temperature. All 40 sampled were `inherited = true` from
// `ucs-x-series-modular-system`: a CPU wearing the chassis's operating temperature. An inherited
// fact is evidence about the PARENT and never about the kind of the child. Any future rule that
// reads facts as evidence of what a part IS must exclude them.

// servers (12 Sep 2026) — `io-module` and `software` added. An IOM/IFM (UCS 2408 "8 External 25Gb
// Ports") was filed `chassis` and asked for a rack height, a weight and a form factor; it is a card
// in the chassis and is bought on its ports and on which chassis takes it. `software` names the
// firmware packages and management images that sit in `hardware` (N20-FW018 "UCS 5108 Blade Chassis
// FW Package 4.2" was kind `chassis` and asked 8 chassis fields) — a kind that asks nothing, so a
// row still classed hardware until the class rules S1/S2/S5 are applied is not scored as a box.
export type UcsKind =
  | "server" | "chassis" | "fabric-interconnect"
  | "cpu" | "memory" | "drive" | "psu" | "nic" | "gpu" | "storage-controller" | "io-module"
  | "accessory" | "os-license" | "software" | "bundle" | "non-product" | "unknown";

/** Kinds that are a whole machine — the only ones a physical specification belongs to. */
export const UCS_MACHINE: readonly UcsKind[] = ["server", "chassis", "fabric-interconnect"];

/** Kinds that are a part OF a machine. Cisco publishes no weight or operating temperature for
 *  these, so a physical requirement on them is a gap nothing can ever close. */
export const UCS_COMPONENT: readonly UcsKind[] =
  ["cpu", "memory", "drive", "psu", "nic", "gpu", "storage-controller", "io-module", "accessory"];

/** Kinds asked NOTHING: not a product of a kind we can specify (a bundle's contents are a relation,
 *  R3), not hardware at all, or not yet determined — the fallback that asks less, never more. */
export const UCS_UNASKED: readonly UcsKind[] = ["bundle", "os-license", "software", "non-product", "unknown"];

/** Every kind ucsKind can return, in ledger order. */
export const UCS_KINDS: readonly UcsKind[] = [...UCS_MACHINE, ...UCS_COMPONENT, ...UCS_UNASKED];

/**
 * The kind-bearing token: `UCSC-C220-M5SX` -> `C220`, `UCS-MR-X32G1RW` -> `MR`.
 *
 * HYPERFLEX PUTS THE KIND ONE SEGMENT LATER, and taking the first token filed 328 components as
 * servers. `HX-B-NVMEHW-I3200` is a drive and `HCIX-CPU-A9554P` is a CPU, but both begin with the
 * SYSTEM name — so the `HX`/`HCI`/`HCIX` prefix is stripped like `UCS` is, and `HX-B-` drops the
 * bare form-factor letter (B = blade, C = rack) that sits between the system and the kind. The tell
 * was the measurement: the `server` bucket carried 328 COMPONENT facts and zero physical ones,
 * which is the wrong way round for a machine.
 */
export function ucsToken(sku: string): string {
  let s = sku.toUpperCase();
  // THE HYPHEN IS OPTIONAL. Cisco writes X-Series and HyperFlex SKUs both ways —
  // `UCSX-MRX16G1RE3` and `UCSXSD960GM1XEV-D`. Requiring the dash left the second form in the
  // residue with the whole SKU as its token, which is why 1,449 parts were unnamed and the
  // largest single unnamed token was a 960 GB SSD.
  s = s.replace(/^UCS[CBXSE]?-/, "").replace(/^UCS[CBXSE](?=[A-Z])/, "");
  // servers (12 Sep 2026): HXE-/HCIXE- are the Edge/E-series spellings of the same system prefix
  // (HXE-CPU-A7763, HCIXE-MRX64G2RE5) and were whole-SKU tokens in the residue.
  s = s.replace(/^(?:HXAF|HCIXE|HCIX|HCI|HXE|HX)-/, "").replace(/^(?:HXAF|HX)(?=[A-Z]{2})/, "");
  // servers (12 Sep 2026): three more SYSTEM prefixes that put the kind in the second segment.
  //   UCSW-  Whiptail/Invicta: UCSW-SD480G0KA4-C "480GB 2.5 inch SATA SSD", UCSW-PCIE-IX5204 a NIC
  //   CSP-   Cloud Services Platform 5000: CSP-CPU-5120, CSP-PSU1-1050W, CSP-TPM2-002 (the platform
  //          itself, CSP-5444 "2RU NFV Platform", is named by PRE_RULES before this runs)
  //   N20- / N10- / N01-  first-generation UCS: N20-PAC5-2500W a PSU, N20-BBLKD a blank, N20-CRMK2 a
  //          rack kit. The bare `N20` token used to be exact `chassis`, which filed every one of the
  //          69 N20-* parts — fans, blanks, heat sinks, firmware — as a 5108 chassis.
  s = s.replace(/^(?:UCSW|CSP|N20|N10|N01)-/, "");
  // KIN- is the Kinetic system prefix and behaves exactly like HX-: the kind is the NEXT token.
  // Found by the machine-hunt — the only two residue rows carrying an own physical fact were
  // KIN-CPU-4114 and KIN-CPU-I4214, i.e. CPUs, and the "physical fact" was power_max holding the
  // processor's 85 W TDP. Not machines; a field-mapping defect wearing a machine's signal.
  s = s.replace(/^KIN-/, "");
  s = s.replace(/^[BC]-(?=[A-Z])/, "");
  s = s.replace(/^UCS[CBXSE]?-/, "");
  return s.split("-")[0] ?? s;
}

// Ordered. First match wins. Each entry is (kind, exact tokens, token prefixes) and the ORDER
// encodes precedence: an OS licence beats everything (VMW-* is a licence whatever else it says),
// then machines, then components, then accessories.
export const RULES: { kind: UcsKind; exact?: Set<string>; prefix?: string[] }[] = [
  // NOT PRODUCTS AT ALL — ordering-system artefacts, first because they outrank every other
  // reading of the same token. Read from the names, not guessed:
  //   TR-*   400 parts, every one a "Tracer" SKU — Cisco's ordering artefact for tracking a
  //          bundle component. "TR-EZ8-M32G-8  UCS SP8 32GB DDR4 LRDIMM 8Pk Tracer". I had these
  //          classed os-license, which was wrong: a tracer is not a licence, it is not a thing.
  //   SID-*   23 parts, solution IDs — "UCS-SID-ENV-HV  Virtualized with Hyper-v" is a tag on an
  //          order line describing the workload, not something anyone ships.
  // They keep their rows (a part-number lookup should answer "that is an ordering artefact"
  // rather than 404) and leave every population count.
  { kind: "non-product", exact: new Set(["SID", "TR"]), prefix: ["SID", "TR-"] },
  // 1,243 parts, 9.9% of the category — operating systems and hypervisors sold as UCS SKUs and
  // classed `hardware`. They are not a kind of hardware; they are a product_class defect, and
  // naming them here is what makes them findable rather than sitting in `unknown`.
  // THREE TOKENS WERE REMOVED FROM THIS SET ON 10 SEP 2026, and they were mine. The note below
  // says "read out of the residue, not guessed" — and for `UCSW` what I actually read was ONE
  // part, UCSW-WT-SMMR54, from which I took the whole token. Audited by reading every family in
  // full, scoped to the only category this function is consulted for:
  //
  //   EZ     85 parts   ZERO name an operating system.   UCS-EZ-ENSC-B200 "UCS B200 M3 Blade
  //                     Server w/ 2650, 8x16GB, Dual VIC", UCS-EZ-300GB-HDD "300GB 6Gb SAS 10K
  //                     RPM SFF HDD". SmartPlay/EZ PACKS of real servers and drives; 13 carry
  //                     their own physical facts.
  //   SL     46 parts   ZERO. UCS-SL-HANA-7 "HANA Solution with 8 B440 M2 Blades",
  //                     UCS-SL-VDI-B200-L "UCS VDI EXP B200 w/LSI400,2xE5-2680v2,128G".
  //   UCSW  279 parts   SIX name an operating system, and 143 name hardware. This is the
  //                     Whiptail/Invicta storage line: UCSW-SD480G0KA4-C "480GB 2.5 inch SATA
  //                     SSD", UCSW-PCIE-IX5204 "Intel Quad Port 10 GbE X520 Server Adapter",
  //                     UCSW-RACK31X "Invicta Rack With Side Panels". 12 carry physical facts.
  //
  // 410 parts, every one classed `license`, most of them real hardware. The six genuine Invicta
  // operating systems are caught instead by an exact SKU marker in productClass.ts (`-OS5.`,
  // which matches those six and nothing else in 91,543 parts).
  //
  // THE OTHER TOKENS WERE RE-READ IN THE SAME PASS AND ALL SURVIVED, because a name-based screen
  // scored them badly and reading them corrected it: `BD` is MapR/Cloudera licensing, `BDMREP`
  // MapR ("MapR-XD Ent-Prem. HDD. Per TB" — a storage TIER, not a drive), `VEM` is Veeam, `BMC`
  // BladeLogic, `CUIC` and `C1` UCS Director and Cisco ONE ("Per Server" is a licensing UNIT),
  // `NV` NVIDIA GRID, `RH` Red Hat, `CVLT` CommVault, `DC` Data Center Management SaaS. The screen
  // matched "Server", "HDD" and "Cores" inside software product names — the same failure that a
  // name gate has produced in every round of this work.
  { kind: "os-license", exact: new Set(["VMW", "SLES", "RHEL", "MSWS", "CTX", "NV", "RH",
                                        "CVLT", "STORM", "VEM", "BD",
                                        // read out of the residue 9 Sep 2026, not guessed:
                                        // C1-CWOM-750SVR-5Y, CUIC-NFV-1Y-PHYSVR,
                                        // C16S16-L64G-YR-SVA, DC-MGT-IS-SAAS-ES1, UCS-BDMREP-DH
                                        "C1", "CUIC", "DC", "BDMREP", "BMC"]),
    prefix: ["C16S", "C1-", "INTERSIGHT"] },

  // servers (12 Sep 2026): S9108 is "Cisco UCS Fabric Interconnects 9108 100G" (UCSX-S9108-100G).
  { kind: "fabric-interconnect", exact: new Set(["FI", "S9108"]), prefix: ["FI"] },
  // `N20` removed (it is stripped as a system prefix now) and IOM/IFM moved to PRE_RULES' io-module.
  { kind: "chassis", exact: new Set(["5108", "9508", "C4200", "C3X60"]) },
  // Server model numbers: a letter class plus digits (C220, B200, X210C, C480, S3260, C880).
  // Read out of the residue machine-hunt, 10 Sep 2026 — each from its NAME, not its shape:
  //   C125  "UCS C125 Base Compute Node Tray"      a server node
  //   6296  "6296 FI Chassis"                       a fabric interconnect
  //   VCE   "VCE UCS 5108 Blade Svr AC Chassis"     a chassis
  // PLHC is deliberately NOT here: PLHC-CI-5108-1A is a chassis and PLHC-MLOM-40G-04 is a NIC, so
  // the token is impure and assigning it would put a NIC behind a machine's profile.
  { kind: "fabric-interconnect", exact: new Set(["6296", "6248", "6332", "6454"]) },
  { kind: "chassis", exact: new Set(["VCE"]) },
  // The machine-hunt's spec-doc arm surfaced three real server tokens among 160 rows that were
  // otherwise all components — a datasheet lists what goes IN it, so its NICs, drives and blanks
  // inherit a spec-bearing document. Same conclusion as security's finding H: "has a spec-bearing
  // doc" is a poor machine test. These three are machines by NAME:
  //   880A     "2x Intel Xeon 6776P 2.3 GHz CPUs, 8x ..."  a C880 M8 configuration
  //   240M8E3  "UCSC-240M8E3-32X2"                          a C240 M8 configuration
  //   M8       "UCS X-Series M8 modular server"
  { kind: "server", exact: new Set(["885A", "EX", "S", "C125", "880A", "M8"]),
    prefix: ["C2", "C4", "C8", "B2", "B4", "S3", "210C", "410C", "215C", "440P",
             "RC4", "R2XX", "E1", "E100", "UCSAI", "UCSXE", "885A", "HX2", "HX3", "HXAF2",
             // E-Series Network Compute Engines glue the variant onto the token
             // (UCS-EN120E208B -> EN120E); they are router service modules, i.e. servers.
             "EN1", "EN2", "EN12",
             // Cisco writes a rack-server configuration as <model><generation><variant>:
             // UCSC-240M8E3-32X2 -> 240M8E3. Digits then M then a generation digit.
             "220M", "240M", "225M", "245M", "480M", "880A"] },

  // A01 IS A CPU, not a NIC. I put it in the nic set from two SKUs in a residue listing without
  // reading their names: all 24 A01-* parts are Xeons — "A01-X0109= 2.66GHz Xeon E5640 80W CPU/12M".
  // Found by the reviewer's power_max/TDP check, which is the only reason it surfaced: the wrong
  // kind was invisible until something asked what kind of part carries a processor wattage.
  { kind: "cpu", exact: new Set(["CPU"]), prefix: ["CPU", "A01"] },
  // servers (12 Sep 2026): MP = Optane persistent memory ("Intel Optane Persistent Memory, 128GB,
  // 2666MHz"), EM3 = UCS-E M3 DIMMs ("8 GB 1200MHz VLP RDIMM ... for UCS-E M3"), MKIT = "Mem kit
  // for UCS-ML-2X648RY-E".
  { kind: "memory", exact: new Set(["MR", "ML", "MRX", "MLX", "MEM", "MP", "EM3", "MKIT"]), prefix: ["MR", "ML", "MEM"] },
  // Drives are the most fragmented token family in the catalogue — NVMEG4, NVME4, NVMEHW,
  // NVB3T8O1V, SDB3T8OA1P, UCSXSD960GBKNK9. Prefixes, not a list, or every new capacity is an edit.
  // `F` is Fusion-io (UCSC-F-H19001), `C3K` the C3000 storage server's drives.
  // servers (12 Sep 2026): HY = the 3.5-inch "Enterprise Value/Performance SATA/SAS SSD" family
  // (UCS-HY16T61X-EV, 46 parts each holding storage_capacity), NVM = NVM2/NVMHG NVMe drives the
  // NVME prefix missed, USBFLSH/MSD = boot flash ("4GB Flash USB Drive", "32GB Micro SD Card").
  { kind: "drive", exact: new Set(["F", "C3K"]),
    prefix: ["HD", "SD", "NVME", "NVB", "SDB", "M2", "HYB", "SSD", "C3K", "HY", "NVM", "USBFLSH", "MSD"] },
  // servers (12 Sep 2026): PAC/UAC are the 5108's supplies once the N20-/N01- prefix is stripped
  // (N20-PAC5-2500W "2500W AC power supply unit", N01-UAC1 "Single phase AC power module").
  { kind: "psu", prefix: ["PSU", "PSUV2", "PAC", "UAC"] },
  { kind: "gpu", prefix: ["GPU"] },
  // servers (12 Sep 2026): BRAID = N20-BRAID-K1 "RAID upgrade", 9400 = "9400-8I 12G SAS HBA",
  // X10C = "UCS X10c Compute RAID Controller" / "Pass Through Controller".
  // device-noun (13 Sep 2026): NYTRO = UCSC-NYTRO-200GB "Cisco Nytro MegaRAID 200GB Controller" (and its spare) —
  // an LSI MegaRAID card with on-board flash cache. The only two rows carrying the token.
  { kind: "storage-controller", prefix: ["RAID", "SAS", "HBA", "9300", "MRAID", "BRAID", "9400", "X10C", "NYTRO"] },
  // `P` is the X-Series PCIe node adapter (UCSC-P-NC3220); N2XX/N20 are the first-generation
  // mezzanine adapters.
  // servers (12 Sep 2026): M = mLOM VIC (UCSC-M-V100-04 "VIC 1477 dual port 40/100G QSFP28 mLOM"),
  // O = OCP NIC (UCSC-O-ID25GF "Intel XXV710DA2OCP1 2x25/10GbE OCP 2.0 NIC"), MEZ/ME/V4/V5 = VIC
  // mezzanines (UCSX-V4-Q25GME "UCS VIC 14825 4x25G mezz"). VIC bridges are refused to accessory
  // by PRE_RULES first.
  { kind: "nic", exact: new Set(["P", "N2XX", "M", "O", "MEZ", "ME", "V4", "V5"]), prefix: ["MLOM", "PCIE", "VIC", "P-", "PCI"] },
  // `N10` removed from the exact set: N10- is stripped as a system prefix now, and the token covered
  // UCS Manager images (software) and FI port licences, not accessories.
  // servers (12 Sep 2026) additions, each read from names in the residue: blanks (BBLKD, CBLK, DIMM
  // "UCS-DIMM-BLK", FBRS "Riser Filler Blank"), air ducts and baffles (AD, ADGPU, BAFF, AIRBAF),
  // control panels (CP, CPL), risers (RS, R1, R2A, R2B), storage carriers and backplanes (MSTOR,
  // LSTOR, DBKP, XPAND), brackets and cages (BRCKT, RDBKT, CAGE, PCOL), cables (RC "SAS RAID Cable",
  // AUXCBL, M10CBL, V340CBL, 300W "300 Watt Cable"), interposers (IP, OCP3), supercap (SCAP), heat
  // sink (BHTS), rack kits (CRMK), the chassis intrusion switch (INT "Chassis Intrusion Switch"),
  // an optical media drive (DVD), packaging (PKG), accessory kits (ACC), LP, FTCX.
  { kind: "accessory", exact: new Set(["CB", "CBL", "ACC", "CP", "AD", "IP", "RC", "LP", "INT", "R1", "R2A", "R2B",
                                       "DIMM", "SCAP", "CAGE", "PKG", "300W", "DVD", "OCP3", "PCOL", "FTCX"]),
    prefix: ["RIS", "FAN", "HS", "TPM", "CAB", "RAIL", "CMA", "BZL", "KIT",
             "RACK", "BLKE", "BLK", "SCRW", "LBL", "CBL", "CB-",
             "BBLKD", "BAFF", "FBRS", "AIRBAF", "CPL", "ADGPU", "RS", "MSTOR", "LSTOR", "DBKP", "XPAND",
             "BRCKT", "AUXCBL", "M10CBL", "V340CBL", "RDBKT", "CRMK", "CBLK", "BHTS"] },
  // Solution packs and bundles: their facts belong to the base server they contain.
  { kind: "bundle", exact: new Set(["SP", "SPL", "SPR", "SPM", "SPB", "SP5", "DBUN", "SA", "SM"]),
    prefix: ["SP", "DBUN", "EZ7", "EZ8", "SM-"] },
  // servers (12 Sep 2026): configured systems and packs, each read from its name — EZ/SL SmartPlay
  // and solution packs ("UCS HANA XL Bundle w/B440 M2"), SR/CX "(Not sold Standalone)B200M3 w/ ...",
  // WMS/YES/SB/UCUCS/OPS/SEED/MINI/BR/MAN configured servers ("Brazil- UCS C240M4X 24HD w/2xE52680v4",
  // "MSFT AzureStack FixedNode C240M4L"), 10PK "MULTIPACK: 10PK B200 M6", VSPEX/FPEX/VXI/CDV/SF/CESIUM
  // solution stacks, and the HyperFlex system/config SKUs STD/ENCR ("HX Standard w/1x400GB SAS ..."),
  // UC ("UC on HX TRC"), HXC/HXM5/M5S/AF2X0C ("Cisco HXAF2X0C M5 Hyperflex System"). R3: what a
  // bundle CONTAINS is a relation, so the kind asks nothing.
  { kind: "bundle", exact: new Set(["EZ", "SL", "SR", "WMS", "CX", "BR", "YES", "SB", "VSPEX", "UCUCS", "10PK",
                                    "FPEX", "VXI", "SEED", "OPS", "MAN", "HXC", "SF", "CESIUM", "CDV", "MINI",
                                    "STD", "ENCR", "UC", "HXM5", "M5S", "AF2X0C"]) },
  // Solution bundles the machine-hunt surfaced: each names the machines it CONTAINS, which is what
  // made them look like machines. "UCS Mini FastTrack w/ 1x5108 Mini Chassis, 4xB200M".
  { kind: "bundle", exact: new Set(["FT", "NFVI", "SHRPT", "COPC", "FPOD", "ASR57", "FSA1", "C6508"]) },
  // Power distribution boards and input modules are PSU-side, not machines.
  { kind: "psu", exact: new Set(["PBD", "PWRM"]) },
  // A BARE HX/HCI token is the converged node itself — a server. Anything after the system
  // prefix has already been re-tokenised above, so `HX-B-NVMEHW-...` reaches the drive rule
  // rather than this one.
  { kind: "server", exact: new Set(["HX", "HCI", "HCIX", "HXAF"]) },
];

/**
 * servers (12 Sep 2026). Rules on the WHOLE SKU (upper-cased, spare `=` removed), tried before the
 * token rules, for the shapes a single token cannot carry. Ordered; first match wins. Every entry was
 * read from names in the residue and each has refusal cases in tests/ucsKind.test.ts.
 *
 *   software      N10-MGT016 "UCS Manager v4.0", N20-FW018 "UCS 5108 Blade Chassis FW Package 4.2",
 *                 UCSB-FW014-D "UCS B200 M4 server node FW", CIMC-C220M4-209E "C-Series Software
 *                 2.0(9e)", UCSW-DDUP-24T "Invicta dedup" images, UCSX-C-SW-LATEST. Anchored so the
 *                 real N20-C6508 chassis and UCSX-C-M6-HS-R heat sink are not reached.
 *   non-product   ordering-system SETTINGS and datasheet cells, not things anyone ships:
 *                 HX-E-TOPO1 "10GbE Single or Dual Switch (2, 3, or 4 node)" (a topology choice),
 *                 DISK-MODE-RAID-10, UCSC-SW-C220M4-P01 "Performance Optimized setting",
 *                 UCSC-CCARD-01 "Card Mode BIOS setting", HCI-IS-MANAGED "Deployment mode for
 *                 Standalone Server Managed by Intersight", HX-DCPMM-AD "Optane ... Operational Mode",
 *                 DDR5-5600MT/s and E5-2699 (a speed and a CPU family enumerated as parts).
 *   io-module     IOM/IFM cards: UCS-IOM-2408 "I/O Module (8 external 25G ports ...)",
 *                 UCSX-I-9108-100G / UCSX-I9108-100G, X9108-IFM-100G. `(?:^|-)` so C890-M5-SIOM-B
 *                 (a server's system I/O card, not a chassis IOM) is refused.
 *   chassis       N20-C6508 "UCS 5108 Blade Svr AC Chassis" — its token C6508 is also a bundle token.
 *   server        converged NODES whose model is glued to the system prefix: HXAF220C-M5SX,
 *                 HX240C-M6SX, HX-E-240-M6SX "HyperFlex Hybrid Edge 240", HCIAF220C-M7SN "Compute
 *                 Hyperconverged ... All Flash Node", HCONX240C-M8L "Compute-Only C240 M8",
 *                 HCIXNX215C-M8SN, and the CSP 5000 NFV platforms (CSP-5444 "2RU NFV Platform").
 *                 The `-M<gen>` / `C(?:-|$)` anchors refuse HXAF220C-BZL-M5S (a bezel) and
 *                 HX-E-220C-BZL-M5.
 *   drive         E-SSD-SATA-4TB "SATA SSD drive for UCS-E M6", A03-D1TBSATA "1TB 6Gb SATA ... HDD".
 *   accessory     VIC bridges (UCSX-V5-BRIDGE-D) before the V5 token reads them as a NIC.
 */
export const PRE_RULES: { kind: UcsKind; re: RegExp }[] = [
  { kind: "software", re: /^N10-MGT\d|^(?:N20|UCSB)-FW\d|^CIMC-C\d|^UCSW-DDUP-|^UCSX-C-SW-LATEST$/ },
  { kind: "non-product", re: /-TOPO\d+$|^DISK-MODE-|^UCSC-SW-C\d{3}M\d-P\d|^UCSC-CCARD-|-(?:IS|IMM)-MANAGED(?:-M\d)?$|^HX-DCPMM-|^DDR\d-\d{4}|^E5-\d{4}$/ },
  { kind: "io-module", re: /(?:^|-)IOM-?\d{4}|(?:^|-)IFM(?:-|$)|(?:^|-)I-?9108-|^X9108-IFM/ },
  { kind: "chassis", re: /^N20-C65\d\d/ },
  { kind: "server", re: /^HX(?:AF)?\d{3}C-M\d|^HX-E-\d{3}C?-?M\d|^HC[IO][A-Z]*\d{3}C(?:-|$)|^CSP-5\d{3}(?:-|$)/ },
  // round-7 addendum K and L (12 Sep 2026): the Catalyst Center appliance (DN3-HW-APL-XL "Catalyst Center
  // Appliance, 3rd Gen, XL", a UCS C-series box) and its PCIe/OCP NICs (DN3-P-* "PCIe NIC", APIC-P-* /
  // APIC-O-* "OCP3.0 NIC"), filed in software categories and landing in `unknown` here. THE CHECK THE OPERATOR
  // NAMED: one DN/APIC-prefixed part is already in servers-unified-computing and it is a DRIVE —
  // APIC-SD100G0KA2-E "100G SATA 2.5 inch Enterprise Performance SSD". `-[PO]-` needs the letter as a whole
  // segment, so `APIC-SD...` is not reached and stays a drive (asserted in tests/ucsKind.test.ts).
  { kind: "server", re: /^DN3-HW-APL-/ },
  { kind: "nic", re: /^(?:DN3|APIC)-[PO]-/ },
  { kind: "drive", re: /^E-(?:SSD|HDD)-|^A03-D\d/ },
  { kind: "accessory", re: /-BRIDGE/ },
  // ---- device-noun (13 Sep 2026): real machines and cards the device-noun census found asked NOTHING ------
  // Every entry is a family read in full (all live Cisco rows carrying the shape), and each has a refusal in
  // tests/ucsKind.test.ts. The kind diff over every live UCS-axis row is in the session report.
  //
  // MAJOR LINE BUNDLES OF ONE SERVER GENERATION. The M8 rows are ALREADY `server` through the `M8` token
  // (UCSX-M8-MLB "Cisco UCS X-Series M8 modular server and UCS X9508 Chassis", UCS-M8-MLB "... This MLB
  // consists of the server node (UCSC-C245-M8SX...)"); the M6 and M7 spellings of the same PID were `unknown`
  // and asked nothing: UCSX-M7-MLB "UCSX M7 Modular Server and CHASSIS MLB", UCS-M6-MLB "UCS M6 rack, blade,
  // chassis Major Line Bundle ... consists of the server node (UCSC-C245-M6SX6)", UCSXE-M8-MLB "Cisco UCS
  // XE9305 M8 Modular Server and Chassis MLB", UCS-MGPUM8-MLB "Cisco UCS-845A M8 Rack Server chassis Major
  // Line Bundle", HX-UCSCM6-MLB "Cisco Hyperflex HX Compute M6 Blade and Rack server MLB". Anchored on the
  // GENERATION token, so UCS-C4200-MLB (a chassis), UCS-TEST-MLB "UCS Test MLB", UCS-VSAN-MLB, HX-EXPRESS-MLB
  // and UCS-DGPUM8-MLB (a bare name, no document) are not reached.
  { kind: "server", re: /^(?:UCSX?E?|HCIX?|HX)-(?:M[678]|UCSCM\d|MGPUM\d)-(?:[A-Z]+-)?MLB(?:-BR)?$/ },
  // THE UCS XE (Unified Edge) LINE. `^UCS[CBXSE](?=[A-Z])` strips "UCSX" from "UCSXE-" and leaves the token
  // "E", so the whole line fell to `unknown`. Only the machines are named here — the XE130c/XE150c compute
  // nodes ("Cisco UCS XE130c M8 Compute Node with 20-core CPU ...", standalone -U forms included) and the
  // XE9305 chassis ("Cisco UCS XE9305 Chassis Spare", "Chassis Configured", and the Nutanix build
  // HCIXENX-9305-U "Cisco HCI XE9305 3RU Nutanix Chassis"). The 40 XE components (UCSXE-M2-240G, -GPU-L4,
  // -PSU-2400W, -RAIL ...) are not touched by this change.
  { kind: "server", re: /^UCSXE-1[35]0C-M\d/ },
  { kind: "chassis", re: /^(?:UCSXE|HCIXENX)-9305(?:-U)?$/ },
  // THE C3160 / C3260 STORAGE-SERVER CHASSIS and their System I/O Controllers. Whole-SKU anchors, because the
  // `C3160` token also carries the platform's own drives and bezel (UCSC-C3160-400SSD, UCSC-C3160-BEZEL) and a
  // token rule would file those as chassis. UCSC-C3X60 is already `chassis` in RULES; this is its older name.
  //   UCSC-C3260 "Cisco UCS C3260 Base Chassis w/4x PSU, SSD, Railkit"
  //   UCSC-C3160-SIOC "Cisco UCS C3160 System IO Controller with mLOM mez adapter" — the card the chassis's
  //   network ports live on, the same job as an IOM (`io-module`: ports + which chassis takes it)
  { kind: "chassis", re: /^UCSC-C3[12]60$/ },
  { kind: "io-module", re: /^UCSC-C3[12]60-SIOC$/ },
  // UCSX-FS-9516 "UCS X9516 X-Fabric PCIe Gen5 switch module for 9508 chassis" — the X-Fabric module is the
  // PCIe counterpart of the X9108 IFM already named above. UCSX-FS-X9516 is the same PID spelled with its X.
  { kind: "io-module", re: /^UCSX-FS-X?9516$/ },
  // UCSC-BASE-M2-C460 "UCS C460 M2 Rack Server with DVD-RW and 1 PSU", and its spare "UCS C460 M2 Rack SVR
  // w/o CPU, Mem HDD, PCIe": a base server. UCS-EPNM-C220M4S "UCS EPNM Server - C220M4S": the EPN Manager
  // appliance, a C220 M4 (the DN3-HW-APL- rule above is the precedent). Every other EPNM row is a licence.
  { kind: "server", re: /^UCSC-BASE-M2-C460$|^UCS-EPNM-C\d{3}M\d/ },
  // CISCO+ (PLHC-) HARDWARE. The comment in RULES records why PLHC is not a token: the family is impure, so
  // only whole-SKU shapes are named, one per row read, and PLHC-FI-D2-RES "Cisco+ Hybrid Cloud Reserve for HX
  // Fabric Interconnect" (a reservation) is refused by construction.
  //   PLHC-CI-5108-1A "Cisco+ UCS 5108 Blade Server AC2 Chassis"
  //   PLHC-MLOM-40G-04 "Cisco+ UCS VIC 1440 modular LOM for Blade Servers" (PLHC-MLOM-PT-01, a port expander, is not reached)
  //   PLHC-MRAID12G "Cisco+ FlexStorage 12G SAS RAID controller w/Drive bays"
  { kind: "chassis", re: /^PLHC-CI-5108-/ },
  { kind: "nic", re: /^PLHC-MLOM-\d/ },
  { kind: "storage-controller", re: /^PLHC-MRAID\d/ },
];

/**
 * The kind of a UCS part, or `unknown`.
 *
 * `unknown` is a real answer and is never guessed into a neighbouring kind: a wrong kind puts a
 * part behind the wrong profile, which is exactly the defect being fixed. The residue is reported
 * by the audit so it can be read rather than assumed away.
 */
export function ucsKind(sku: string): UcsKind {
  const whole = String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
  for (const r of PRE_RULES) if (r.re.test(whole)) return r.kind;
  const t = ucsToken(sku);
  if (!t) return "unknown";
  for (const r of RULES) {
    if (r.exact?.has(t)) return (r.kind === "server" || r.kind === "chassis") ? refineMachine(whole, r.kind) : r.kind;
    if (r.prefix?.some((p) => t.startsWith(p))) return (r.kind === "server" || r.kind === "chassis") ? refineMachine(whole, r.kind) : r.kind;
  }
  return "unknown";
}

/**
 * servers (12 Sep 2026). A MACHINE token names the platform a part belongs to, and Cisco also files the
 * platform's own spares under it: UCS-S3260-HD8TB "UCS S3260 8TB NL-SAS 7.2K HDD", C890-M5-64T-SSD
 * "UCS C890 M5 6.4T SSD Drive", RC460-SLDRAIL-S "Short Slide Rail Kit for C460", C880-J-SASCBL "C880 M4
 * JBOD SAS Cable", C890-M5-NET-ADPT "Dual NIC", C880-SASI-RC-HW "SAS Internal RAID Controller". Read out
 * of the server bucket sorted by component words in the name. A later SEGMENT carrying a component marker
 * makes the part that component; the model segments themselves (C240, M5SX, M6N) never carry one.
 * Exported for the sabotage case.
 */
export const MACHINE_REFINE: { kind: UcsKind; re: RegExp }[] = [
  // NOT a bare `<n>T` segment: C880-6T-M4 is "C880 M4 Server for SAP HANA 6T Scale out" — 6 TB of MEMORY.
  { kind: "drive", re: /^(?:\d*K?S?SD\d|HDD?(?:\d+TB?)?$|SSD|HDD)/ },
  { kind: "accessory", re: /(?:RAIL|CBL|CABLE|PKG|BZL|BEZEL)/ },
  { kind: "nic", re: /^(?:NET-)?ADPT$|^NIC$/ },
  { kind: "storage-controller", re: /^SASI$|^RAID/ },
];
function refineMachine(whole: string, kind: UcsKind): UcsKind {
  const segs = whole.split("-").slice(1);
  for (const r of MACHINE_REFINE) if (segs.some((s) => r.re.test(s))) return r.kind;
  return kind;
}
