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
// kind-layer (13 Sep 2026, spec II.5 / III.1, decision record 2026-09-13-kind-layer-cisco.md):
//   `psu` -> `power`  one kind name for a supply across every category (rule 3). Nothing else about the kind moved.
//   `cable`, `fan`    the III.0 item-6 read of the 539 `unknown` rows found 53 cables and 3 fans with no UCS kind
//                     to go to; the library has CABLE and FAN archetypes and every other hardware category names
//                     both. The SKU tokens that used to file them `accessory` (CBL, CAB, FAN ...) now name them.
//   `tpm`, `pdu`      were name-only kinds for these three categories (nameMarker UCS_NAME_ONLY_KINDS), so a
//                     placeholder-named TPM or PDU ("Cisco UCSXE-TPM-002D", "Cisco RP208-30-2P-U-2") could never
//                     reach them. The SKU axis names them now; LEDGER_KINDS de-duplicates the two lists.
export type UcsKind =
  | "server" | "chassis" | "fabric-interconnect"
  | "cpu" | "memory" | "drive" | "power" | "nic" | "gpu" | "storage-controller" | "io-module"
  | "cable" | "power-cord" | "fan" | "tpm" | "pdu"
  | "accessory" | "os-license" | "software" | "bundle" | "non-product" | "unknown"
  // layers round 3 (15 Sep 2026): the axis names `mechanical` from the SKU for the R42610 rack's bar, doors, hardware kit, locks and
  // side panel (PRE_RULES), as moduleKind does for the slot dividers. NOT added to UCS_KINDS: cupLedger's three UCS lists already
  // carry `mechanical` through NAME_ONLY_KINDS, and a second copy there would change the ledger's list, which is cup side.
  | "mechanical";

/** Kinds that are a whole machine — the only ones a physical specification belongs to. */
export const UCS_MACHINE: readonly UcsKind[] = ["server", "chassis", "fabric-interconnect"];

/** Kinds that are a part OF a machine. Cisco publishes no weight or operating temperature for
 *  these, so a physical requirement on them is a gap nothing can ever close. */
export const UCS_COMPONENT: readonly UcsKind[] =
  ["cpu", "memory", "drive", "power", "nic", "gpu", "storage-controller", "io-module", "cable", "power-cord", "fan", "tpm", "pdu", "accessory"];

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
  // kind-layer (13 Sep 2026): three SYSTEM prefixes that swallowed the kind token, each found by reading the
  // `unknown` and `server` rows of the III.0 item-4/6 reads rather than by their shape:
  //   UCSXE-  the Unified Edge line. `^UCS[CBXSE](?=[A-Z])` took "UCSX" and left the token "E", so 38 XE
  //           components (UCSXE-PSU-2400W, -GPU-L4, -M2-240G, -MRX16G1RE5, -NVE13T8K1V, -P-I8D25GF) were
  //           `unknown` behind one token. The XE machines are named by whole-SKU PRE_RULES before this runs.
  //   UCSAI-  the C880A AI server's parts: UCSAI-CPU-I6776P, -MRX96G2RF5, -NVES3T8M1V, -PSU-3200W, -P-NC3220.
  //           `UCSAI` was a SERVER prefix, so all 44 of them — CPUs, DIMMs, drives, NICs, supplies, a heat
  //           sink — were asked a server's cups. Not one of them is a server (the node is UCSC-880A-M8-*).
  //   CAI-    Cisco AI GPU cards: CAI-GPU-MI210 "AMD Instinct MI210: 300W, 64GB, 2-slot FHFL GPU".
  //   UCS + SD<digit>  UCSSD960GBM2NK9-D is "UCS-SD960GBM2NK9" written without its dash; the class `[CBXSE]`
  //           took the S of SD and left "D960GBM2NK9", a drive with no token.
  s = s.replace(/^(?:UCSXE|UCSAI|CAI)-/, "").replace(/^UCS(?=SD\d)/, "");
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
// kind-layer (13 Sep 2026): a rule may also carry `re`, tested against the TOKEN (never the whole SKU), for the one
// family a prefix list cannot express — a cable token that carries CBL anywhere (GPUCBL, 240CBLMR8, XDACBL3M).
export const RULES: { kind: UcsKind; exact?: Set<string>; prefix?: string[]; re?: RegExp }[] = [
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
    // kind-layer (13 Sep 2026): `UCSAI` REMOVED — it filed 44 C880A components as servers; UCSAI- is stripped as a
    // system prefix in ucsToken now, so the part's own token decides.
    prefix: ["C2", "C4", "C8", "B2", "B4", "S3", "210C", "410C", "215C", "440P",
             "RC4", "R2XX", "E1", "E100", "UCSXE", "885A", "HX2", "HX3", "HXAF2",
             // E-Series Network Compute Engines glue the variant onto the token
             // (UCS-EN120E208B -> EN120E); they are router service modules, i.e. servers.
             "EN1", "EN2", "EN12",
             // Cisco writes a rack-server configuration as <model><generation><variant>:
             // UCSC-240M8E3-32X2 -> 240M8E3. Digits then M then a generation digit.
             "220M", "240M", "225M", "245M", "480M", "880A"] },

  // kind-layer (13 Sep 2026): CABLES, ahead of every component rule, because a cable token names the component it
  // connects as readily as a component token does — GPUCBL was a `gpu`, SASCBLSHORT a `storage-controller`. Read from
  // the rows: CBL-E3SX4-2UM8-P1 / UCS-240CBLMR8 "C240 M4 (2) RAID controller cables", CAB-C13-C14-AC (power cords:
  // the UCS axis has no power-cord kind, and nameMarker already sends a cord to `cable` where there is none),
  // CB-LC-LC-MMF1M (fibre patch cables), UCSC-RC-1M-C260 "1.04m SAS RAID Cable", UCSC-300W-460AMD "300 Watt AMD Cable",
  // N20-BKVM "KVM local IO cable", XDACBL3M (direct-attach cables in hyperconverged-systems).
  // `CBL(?!K)`: CBLK is the C-series BLANK family (UCSC-CBLKP, CBLKI, CBLKB1 — "blanking panel"), not a cable.
  // NOT `RC` as a bare token: RC-460-TIM is "C460 Thermal Interface Pad". The two SAS RAID cables that carry it are
  // named by a whole-SKU PRE_RULE (UCSC-RC-1M-C260, UCSC-RC-P8M-C260).
  { kind: "cable", exact: new Set(["CB", "300W", "CAB"]), prefix: ["CABL", "BKVM"], re: /CBL(?!K)/ },
  // kind-layer (13 Sep 2026): FAN and TPM left the accessory prefix list for kinds of their own (see UcsKind).
  { kind: "fan", prefix: ["FAN"] },
  { kind: "tpm", prefix: ["TPM"] },
  // A01 IS A CPU, not a NIC. I put it in the nic set from two SKUs in a residue listing without
  // reading their names: all 24 A01-* parts are Xeons — "A01-X0109= 2.66GHz Xeon E5640 80W CPU/12M".
  // Found by the reviewer's power_max/TDP check, which is the only reason it surfaced: the wrong
  // kind was invisible until something asked what kind of part carries a processor wattage.
  { kind: "cpu", exact: new Set(["CPU"]), prefix: ["CPU", "A01"] },
  // servers (12 Sep 2026): MP = Optane persistent memory ("Intel Optane Persistent Memory, 128GB,
  // 2666MHz"), EM3 = UCS-E M3 DIMMs ("8 GB 1200MHz VLP RDIMM ... for UCS-E M3"), MKIT = "Mem kit
  // for UCS-ML-2X648RY-E".
  // kind-layer (13 Sep 2026): MCX = the CXL memory module (UCS-MCX32G2RE11, UCS-MCX64G2RE11 — same capacity/rank/
  // speed grammar as MRX: 32G 2R E11), spec-held and `unknown` until today.
  // RULING Q17 R2 (29 Sep 2026): MRAID and MLOM BEFORE memory. The memory rule's `MR` / `ML` prefixes read UCSB-MRAID12G "FlexStorage
  // 12G SAS RAID controller" and UCSB-MLOM-40G-01 "VIC 1240 modular LOM" as memory -- the storage-controller and nic rules below
  // already list MRAID and MLOM, and never saw them. 43 parts (the four_sets_sum veto found 18 of them: a RAID card asked no data rate).
  { kind: "storage-controller", prefix: ["MRAID"] },
  { kind: "nic", prefix: ["MLOM"] },
  { kind: "memory", exact: new Set(["MR", "ML", "MRX", "MLX", "MEM", "MP", "EM3", "MKIT"]), prefix: ["MR", "ML", "MEM", "MCX"] },
  // Drives are the most fragmented token family in the catalogue — NVMEG4, NVME4, NVMEHW,
  // NVB3T8O1V, SDB3T8OA1P, UCSXSD960GBKNK9. Prefixes, not a list, or every new capacity is an edit.
  // `F` is Fusion-io (UCSC-F-H19001), `C3K` the C3000 storage server's drives.
  // servers (12 Sep 2026): HY = the 3.5-inch "Enterprise Value/Performance SATA/SAS SSD" family
  // (UCS-HY16T61X-EV, 46 parts each holding storage_capacity), NVM = NVM2/NVMHG NVMe drives the
  // NVME prefix missed, USBFLSH/MSD = boot flash ("4GB Flash USB Drive", "32GB Micro SD Card").
  // kind-layer (13 Sep 2026): NVE = the E3.S / U.3 NVMe family (UCSX-NVE17T6K2V9, UCS-NVE112T8K1P, UCSXE-NVE13T8K1V,
  // UCSAI-NVES3T8M1V). III.0 item 6: 46 spec-held rows sat in `unknown` because NVME/NVM/NVB are listed and NVE is not.
  // Every live token starting NVE is one of these drives (read in full, 55 rows over the three categories).
  { kind: "drive", exact: new Set(["F", "C3K"]),
    prefix: ["HD", "SD", "NVME", "NVB", "SDB", "M2", "HYB", "SSD", "C3K", "HY", "NVM", "USBFLSH", "MSD", "NVE"] },
  // servers (12 Sep 2026): PAC/UAC are the 5108's supplies once the N20-/N01- prefix is stripped
  // (N20-PAC5-2500W "2500W AC power supply unit", N01-UAC1 "Single phase AC power module").
  // kind-layer (13 Sep 2026): kind renamed psu -> power (spec III.1).
  { kind: "power", prefix: ["PSU", "PSUV2", "PAC", "UAC"] },
  { kind: "gpu", prefix: ["GPU"] },
  // servers (12 Sep 2026): BRAID = N20-BRAID-K1 "RAID upgrade", 9400 = "9400-8I 12G SAS HBA",
  // X10C = "UCS X10c Compute RAID Controller" / "Pass Through Controller".
  // device-noun (13 Sep 2026): NYTRO = UCSC-NYTRO-200GB "Cisco Nytro MegaRAID 200GB Controller" (and its spare) —
  // an LSI MegaRAID card with on-board flash cache. The only two rows carrying the token.
  // kind-layer (13 Sep 2026): PSAS = UCSC-PSAS12GHBA "Cisco 12Gbps SAS Modular SAS HBA"; 9500 = UCSC-9500-8E-D, the
  // Broadcom 9500-8e HBA (the 9300/9400 siblings are already listed).
  { kind: "storage-controller", prefix: ["RAID", "SAS", "HBA", "9300", "MRAID", "BRAID", "9400", "X10C", "NYTRO", "PSAS", "9500"] },
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
  // kind-layer (13 Sep 2026): CB, CBL, RC, 300W, CAB, CB-, AUXCBL, M10CBL, V340CBL moved to `cable`, FAN to `fan`, TPM
  // to `tpm` (rules above). ADDED, each a mechanical noun in the SKU of an `unknown` placeholder row (III.0 item 6):
  // BEZ (UCSXE-BEZ-FLTR, UCSXE-BEZ-3), SHLFMT / WALL / R2T / RKMT / MNT (XE shelf, wall, rack-to-table and rack mount
  // brackets and kits), HPBKT (UCSC-HPBKT-24XM7 bracket), MPKIT (UCSC-MPKIT-240M8L), EARS (UCSC-EARS-C220M4 rack
  // ears), XRAIDR / R2R / RNVME (UCSC-XRAIDR-220M5, UCSC-R2R3-C220M6, UCSC-RNVME-240M5 risers), MPSTOM (a kit), ECMC
  // (UCSXE-ECMC-G1, the XE chassis management controller card), FBWC ("1GB flash backed write cache for LSI 2208R"),
  // SATA (UCSC-SATA-KIT-M5; the named UCSC-SATA-C125 "SATA Cable" still reaches `cable` through its name), DDR5
  // (UCS-DDR5-BLK, a DIMM blank, like UCS-DIMM-BLK).
  { kind: "accessory", exact: new Set(["ACC", "CP", "AD", "IP", "LP", "INT", "R1", "R2A", "R2B",
                                       "DIMM", "SCAP", "CAGE", "PKG", "DVD", "OCP3", "PCOL", "FTCX", "SATA", "DDR5"]),
    prefix: ["RIS", "HS", "RAIL", "CMA", "BZL", "KIT",
             "RACK", "BLKE", "BLK", "SCRW", "LBL",
             "BBLKD", "BAFF", "FBRS", "AIRBAF", "CPL", "ADGPU", "RS", "MSTOR", "LSTOR", "DBKP", "XPAND",
             "BRCKT", "RDBKT", "CRMK", "CBLK", "BHTS",
             "BEZ", "SHLFMT", "WALL", "R2T", "RKMT", "MNT", "HPBKT", "MPKIT", "EARS", "XRAIDR", "R2R", "RNVME", "MPSTOM",
             "ECMC", "FBWC"] },
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
  { kind: "power", exact: new Set(["PBD", "PWRM"]) },
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
/** kind-layer (13 Sep 2026): a Major Line Bundle of one server generation — see the `bundle` PRE_RULE below. Exported
 *  for bundleFamily.ts, which must keep these rows `bundle` rather than re-reading their names. */
export const MLB_GENERATION = /^(?:UCSX?E?|HCIX?|HX)-(?:M[678]|UCSCM\d|MGPUM\d)-(?:[A-Z]+-)?MLB(?:-BR)?$/;

/** A mains POWER CORD by its SKU (switchKind's cord rule: a CAB- SKU that names no data-cable family, plus a C13/C14/C19/C20 inlet
 *  token), ONE definition for ucsKind and sanKind (ruling Q17 R2, 29 Sep 2026: storage-networking filed its 62 CAB-1900W / CAB-9K10A
 *  cords as `cable`, and asked them nothing a cord has). */
export const POWER_CORD_SKU = /^CAB-(?!CON|USB|SFP|SM-|INF-|RPS|GUIDE|SPWR|XPS|MCP|04X|STK|STACK|CAT)|^PWR-CAB-|-DC-CAB(?:-|$)|(?:^|-)C(?:13|14|19|20)(?:-|$)/;
export const PRE_RULES: { kind: UcsKind; re: RegExp }[] = [
  // POWER CORDS (reviewer ruling, Batch B 29 Sep 2026: "hci's cables that are C19/C20 cords are power-cord kind, not cable").
  // switchKind's cord rule -- a CAB- SKU that names no data-cable family -- plus a C13/C14/C19/C20 inlet token for the
  // cords filed under another prefix (UCSB-CABL-C19-BRZ "NBR 14136 to C19 AC 14ft Power Cord, Brazil"). Measured over the
  // three UCS categories' `cable` rows: 63 cords by the SKU rule (hci 22 of 24, hcs 8, UCS 33), none of them a data cable.
  { kind: "power-cord", re: POWER_CORD_SKU },
  // RULING Q17 R2 (29 Sep 2026): UCSC-MRAID-SC "Supercap for Cisco 12G SAS Modular Raid controller" (and the UCSB / UCSX spares named
  // only by SKU) is the RAID cache's backup CAPACITOR, not the controller the MRAID rule now names. Not `accessory`: that is a
  // fallback kind, so partKind's name path reads "Supercap ... Raid controller" as `power` and asks a capacitor for a PSU's rated
  // output. `mechanical`, a part bought for what it fits, which the name path leaves alone.
  { kind: "mechanical", re: /^UCS[BCX]-MRAID-SC=?$/ },
  // ---- RULING Q17, THE READ TRIPLES (29 Sep 2026): THREE PLATFORM FAMILIES FILED WHOLE UNDER ONE MACHINE KIND ------------------
  // The veto named ten parts; reading their families found the same defect in every sibling. The machine token made every part of
  // the platform the platform: C880 DIMM kits, E7 CPUs, FC / 10G cards, fan modules, disks and the midplane were `server`; C3X60
  // SSDs, drive rows, the HBA and the fan module were `chassis`; the C3K server nodes were `drive`. Each rule is its family read in
  // full (every live Cisco row with the prefix, data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv), named by its own SKU token.
  // What stays: the C880 SAP-HANA systems (C880-2T-M4, C880-6T-HANA-J-M4, C880-3T-HANA-J-M5) are servers, C3X60-BASE the chassis.
  // C880 -- JBOD enclosures and spare chassis before the disk rule (C880-J-17-M4 "Attached JBOD" is not a disk).
  { kind: "chassis", re: /^C880-(?:M\d-CHASSIS|J-\d{2}-M\d|M4-J-\d{2}-|M4-JBOD-)/ },
  { kind: "memory", re: /^C880-(?:\d{2,3}(?:GB)?-\dX\d{2,3}|\d{2,3}GB-DDR\d|\dTBR?-\d{2}X\d{2,3}|M4-(?:V4-|\dS-)?\dTB-(?:\d{2}GB?|KIT))/ },
  { kind: "cpu", re: /^C880-E7\d{4}/ },
  { kind: "nic", re: /^C880-(?:10GBASE|16GFC-|40GCNA-|40GQSFP-|IO-1GBE)/ },
  { kind: "storage-controller", re: /^C880-(?:SASCONTR|SAS-C200|SAS-RC-)/ },
  { kind: "drive", re: /^C880-(?:J-\d+(?:\.\d+)?TB|J-900G|DISK-D\d)/ },
  { kind: "fan", re: /^C880-FAN/ },
  { kind: "power", re: /^C880-(?:J-)?PSU/ },
  // "Cisco C880 M4 SFP+ Module", "10G LAN SFP+ module": a pluggable the UCS axis has no kind for; `accessory` asks it nothing a
  // server is asked (it was `server`), and the name path may name it more closely
  { kind: "accessory", re: /^C880-(?:10G-)?SFPMOD/ },
  // boards, panels, mounts and the flash backup unit: parts bought for the machine they fit (the Q17 R2 supercap reasoning)
  { kind: "mechanical", re: /^C880-(?:FBU(?!-CBL)|FLASHBACKUP|FRDKT-|J-(?:PNL|BP|EXP)|MIDPLN|OPL|SBU-|MMB-|TFM|M4-(?:BOOT|4SBDS)|MEM-MEZZ)/ },
  // C3X60 -- drives, drive rows and expander trays WITH drives; the controllers; the fan module; blanking plates and the empty tray
  { kind: "drive", re: /^UCSC?-C3X60-(?:12G\d|G\dSD\d|12SSD|\d+TBRR|\d{2}HD\d|10TB|EX\d{2}T)/ },
  { kind: "storage-controller", re: /^UCSC-C3X60-(?:HBA|R\dGB)/ },
  { kind: "fan", re: /^UCSC-C3X60-FANM/ },
  { kind: "mechanical", re: /^UCSC-C3X60-(?:S?BLKP|EXPT)/ },
  // C3K -- the S3260 M4 server nodes, the node's I/O expander, and the expander's tool
  { kind: "server", re: /^UCSC-C3K-M\dS(?:RB|RI|VR)/ },
  { kind: "io-module", re: /^UCSC-C3K-M\dIO$/ },
  { kind: "mechanical", re: /^UCSC-C3K-M\dIOTOOL$/ },
  // "2.5in SFF PCIe/NVMe Storage" was a NIC by its PCI token; EM3-AF-480G-4T "480GB SSD + 4TB SSD Combo" was memory
  { kind: "drive", re: /^(?:UCS|HX)-PCI25-|^EM3-AF-/ },
  { kind: "software", re: /^N10-MGT\d|^(?:N20|UCSB)-FW\d|^CIMC-C\d|^UCSW-DDUP-|^UCSX-C-SW-LATEST$/ },
  // kind-layer (13 Sep 2026): `^(?:HX|UCS)-DCPMM-` — UCS-DCPMM-AD "Intel Optane DC Persistent Memory Operational Mode -
  // App Direct" and UCS-DCPMM-MM are the same operating-mode SETTING as HX-DCPMM-AD, and were `memory`.
  { kind: "non-product", re: /-TOPO\d+$|^DISK-MODE-|^UCSC-SW-C\d{3}M\d-[PE]\d|^UCSC-CCARD-|-(?:IS|IMM)-MANAGED(?:-M\d)?$|^(?:HX|UCS)-DCPMM-|^DDR\d-\d{4}|^E5-\d{4}$/ },
  { kind: "io-module", re: /(?:^|-)IOM-?\d{4}|(?:^|-)IFM(?:-|$)|(?:^|-)I-?9108-|^X9108-IFM/ },
  { kind: "chassis", re: /^N20-C65\d\d/ },
  // layers round 3 (15 Sep 2026): the R42610 rack parts RACK-BAR-001 / RACK-DOOR-001 / -002 / RACK-HW-001 / RACK-LOCK-001 / -002 /
  // RACK-SIDE-001 are `accessory` by the RACK token, so the NAME decides the fallback: the bases are named "DO NOT PUBLISH" and stay
  // accessory, the spares ("Rear cable access bar", "…door", "…side panel") read `cable` / `mechanical` — seven base / spare pairs
  // disagreed. A bar, a door, a hardware kit, a lock and a side panel are mechanical parts of the rack.
  { kind: "mechanical", re: /^RACK-(?:BAR|DOOR|HW|LOCK|SIDE)-\d/ },
  // layers round 3 (15 Sep 2026), the servers round's device check (a `server` / `fabric-interconnect` in a shared-parts series):
  //   R2XX-DMYMPWRCORD(=) "no power cord" is an ordering SETTING used across the C-Series — the `non-product` rule's own scope
  //     ("ordering-system settings … not things anyone ships") — and the R2XX token read it as a C200 server.
  //   UCS-S3348-HBAM5(=) "UCS S3348 Pass through Controller (IT) based on LSI" and UCS-S3X48-FAN(=) "UCS S3X48 Chassis Fan" took
  //     `server` from the S3 prefix; their sibling UCS-S3348-RAIDM5 already reads storage-controller. No series names the S3348
  //     platform, so they stay in UCS Server Components shared parts, where a server kind is a defect the check names.
  { kind: "non-product", re: /^R2XX-DMYMPWRCORD$/ },
  { kind: "storage-controller", re: /^UCS-S3348-HBA/ },
  { kind: "fan", re: /^UCS-S3X48-FAN$/ },
  // kind-layer (13 Sep 2026), III.0 item 4 §7b: CSP-5200= "5200 1RU NFV appliance chassis spare" and CSP-5400= "5400 2RU
  // NFV appliance chassis spare" are the empty chassis of the CSP 5000 platforms, which the server rule below took by
  // their `CSP-5\d{3}` shape. Exact, so CSP-5228 / CSP-5444 / CSP-5456 (the platforms) stay servers.
  { kind: "chassis", re: /^CSP-5[24]00$/ },
  // kind-layer (13 Sep 2026): the C before -M<gen> is OPTIONAL — HXAF225-M6S (a HyperFlex 225 M6 node, hyperconverged-
  // systems `unknown`) writes the model without it. The -M<gen> anchor still refuses HXAF220C-BZL-M5S (a bezel).
  { kind: "server", re: /^HX(?:AF)?\d{3}C?-M\d|^HX-E-\d{3}C?-?M\d|^HC[IO][A-Z]*\d{3}C(?:-|$)|^CSP-5\d{3}(?:-|$)/ },
  // round-7 addendum K and L (12 Sep 2026): the Catalyst Center appliance (DN3-HW-APL-XL "Catalyst Center
  // Appliance, 3rd Gen, XL", a UCS C-series box) and its PCIe/OCP NICs (DN3-P-* "PCIe NIC", APIC-P-* /
  // APIC-O-* "OCP3.0 NIC"), filed in software categories and landing in `unknown` here. THE CHECK THE OPERATOR
  // NAMED: one DN/APIC-prefixed part is already in servers-unified-computing and it is a DRIVE —
  // APIC-SD100G0KA2-E "100G SATA 2.5 inch Enterprise Performance SSD". `-[PO]-` needs the letter as a whole
  // segment, so `APIC-SD...` is not reached and stays a drive (asserted in tests/ucsKind.test.ts).
  // Q3 class correction (2 Oct 2026): the WHOLE appliance family by size suffix -- DN1/DN2/DN3/DN4, with or without -XL/-L/-M/-S,
  // and their spares -- moving in from cloud-systems-management (strayDevice.ts's own family form). The old `^DN3-HW-APL-` named
  // only the Gen-3 sized ones, so 15 of the 17 movers would have read `unknown`; the suffix list still refuses the -LIC and -U
  // PIDs (DN3-HW-APL-XL-LIC is a licence, DN2-HW-APL-U an upgrade), as strayDevice does.
  { kind: "server", re: /^DN\d-HW-APL(?:-(?:XL|L|M|S))?=?$/ },
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
  //
  // kind-layer (13 Sep 2026): `server` -> `bundle`. III.0 item 4 §7b read the six filed under foreign series and all
  // six are MAJOR LINE BUNDLES — "Cisco UCS X-Series M8 modular server and UCS X9508 Chassis" names two devices, and
  // "This MLB consists of the server node ..." says what an MLB is: the ordering umbrella a generation's servers,
  // chassis and options are configured under. A server kind asked it cpu_sockets_max and drive_bays for a thing that
  // has neither. As a bundle it owes `bundle_contents`, and bundleFamily.ts holds it there (MLB_GENERATION) instead of
  // letting the name-family residue call it a programme label.
  { kind: "bundle", re: MLB_GENERATION },
  // THE UCS XE (Unified Edge) LINE. `^UCS[CBXSE](?=[A-Z])` strips "UCSX" from "UCSXE-" and leaves the token
  // "E", so the whole line fell to `unknown`. Only the machines are named here — the XE130c/XE150c compute
  // nodes ("Cisco UCS XE130c M8 Compute Node with 20-core CPU ...", standalone -U forms included) and the
  // XE9305 chassis ("Cisco UCS XE9305 Chassis Spare", "Chassis Configured", and the Nutanix build
  // HCIXENX-9305-U "Cisco HCI XE9305 3RU Nutanix Chassis"). The 40 XE components (UCSXE-M2-240G, -GPU-L4,
  // -PSU-2400W, -RAIL ...) were not touched by this change; kind-layer (13 Sep 2026) names them through ucsToken,
  // which now strips UCSXE- as a system prefix.
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
  // kind-layer (13 Sep 2026): the HCIX-FS-9516 / HCIX-FS-X9516 / HCIX-FS-9516-U spellings of the same module
  // (hyperconverged-infrastructure `unknown`, III.0 item 6).
  { kind: "io-module", re: /^(?:UCSX|HCIX)-FS-X?9516(?:-U)?$/ },
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
  // ---- kind-layer (13 Sep 2026): the III.0 item-6 read of `unknown` and the item-4 §7b read of `server` -------------
  // Each entry is a family read row by row in D:\tmp\kindlayer-III0\C\raw\item6-unresolved-families.json /
  // item4-5-7.json; each has a witness and a refusal in tests/ucsKind.test.ts. Placeholder-named rows ("Cisco <sku>")
  // are named here only where the SKU itself says what the part is.
  //
  // THE M.2 BOOT RAID CONTROLLER. UCS-M2-HWRAID / UCSX-M2-HWRAID "Cisco Boot optimized M.2 Raid controller",
  // UCSX-M2-HWRD-FPS, UCSX-M2I-HWRD-FPS, HX-M2-HWRAID: the `M2` DRIVE prefix took all 21 as drives and asked them a
  // storage capacity. Before every drive rule. UCSXE-M2-240G (a real M.2 drive) carries no HWR segment.
  { kind: "storage-controller", re: /(?:^|-)M2I?-HWR(?:AI)?D/ },
  // The LSI cards of the first C200/C210/C250 generation: R250-PL003 "LSI SAS30813E-R - SAS/SATA RAID 0/1 PCIe Card",
  // R200-PL004 "LSI 6G MegaRAID 9260-4i card", R2X0-ML002 "LSI 1064E (4-port SAS 3.0G RAID 0, 1, 1E ) Mezz Card", and
  // R2XX-PL003-CBL= "LSI MegaRAID 9261-8i Card (... req. cable(s))" — a card, which the CBL segment had made a cable.
  // R210-MEZZCBL003= "LSI 1064E Mezzanine Card and 1 Long SAS Cable for UCS C210" is the card with its cable, and the
  // CBL in its token would otherwise make it a cable.
  { kind: "storage-controller", re: /^R2(?:\d0|X0|XX)-(?:PL|ML)\d{3}|^R210-MEZZCBL/ },
  // UCSC-RC-1M-C260 "1.04m SAS RAID Cable for C260", UCSC-RC-P8M-C260 ".79m SAS RAID Cable" (see the `cable` RULE).
  { kind: "cable", re: /^UCSC-RC-P?\d+M-/ },
  // CONFIGURED NODES whose model is IN the SKU (III.0 item 6 "PCIe node / configured servers"): UCS-STM-C240M4-L2,
  // UCS-EM-B200M4-1S "B200M4 w/1xE52660v4, 4x32GB, VIC1340", UCS-MA-C220M4-HA, UCS-SADV-C240M3S-1 "UCS C240 M3S
  // w/2xE52637v2", UCS-VDI-C240M4-K1 "UCS VDI C240 M4 SX w/ ... GPU K1", UCSSPENVPB200M3-RL "B200M3 w/ 2xE5-2665,
  // 128GB, 1240 VIC REFURBISHED", TG5500-C220M3S-K9, UCSV-EZ-C250-DOM-2 "UCS EZ DOM C250M2 w/ 2x2.93GHz X5670",
  // KIN-UCSM5-2RU-K9 "Kinetic UCS M5 2-RU", UCSC-BASE-C460-CH2 "Disti:C460,w/o CPU, HSnk, Mem, HD, PCIe, PSU, w/Rls,
  // Blnk" (a base server: read today, so the 13 Sep refusal "not read, not named" is withdrawn), and the HyperFlex
  // nodes HXAF-E-220M6S "HyperFlex All Flash Edge 220 M6 system", HX-DH-C240M5L-01, PLHC-VDIGPHXA-M51A "Cisco+
  // HyperFlex HX240c M5 All Flash Node VDI-HX", PLHC-VSIPCI-M51A "Cisco+ B200 M5 for VSI-CI-P".
  // A model token alone is NOT proof — CBL-SAS24-C240M7 and UCSC-HS-C240M7 carry one — so each shape is anchored on
  // the configured-system prefix that precedes the model.
  { kind: "server", re: /^UCS-(?:STM|EM|MA|SADV|VDI)-[BC]\d{2,3}M\d|^UCS(?:SP|EZ)EN[A-Z]{2,3}B\d{3}M\d-RL$|^TG5500-C\d{3}M\d|^UCSV-EZ-C\d{3}-|^KIN-UCSM5-[12]RU|^UCSC-BASE-C460-|^HXAF-E-\d{3}-?M\d|^HX-DH-C\d{3}M\d|^PLHC-(?:VSI|VDI|BM)G?PCI-M5\d|^PLHC-(?:VDI|VSI)GPHX[AC]-M5\d|^PLHC-EDGEPHXE-M5\d/ },
  // UCS-C3260-SA-D "UCSC C3260 for Video Surveillance Solutions": the C3260 chassis the PRE_RULE above names, configured.
  { kind: "chassis", re: /^UCS-C3260-SA-/ },
  // HX-DH-FI6332-16UP "HX SAP Datahub FI3232UP w/4x40G Lic/8xUP Lic": a fabric interconnect with its port licences.
  { kind: "fabric-interconnect", re: /^HX-DH-FI\d{4}/ },
  // A02-MEMKIT-008A "Bundle component for A02-M316GB1-2" — the memory kit component of the A02-M316GB DIMM packs.
  { kind: "memory", re: /^A02-MEMKIT-/ },
  // UCSXS960G6I1XEV-D: UCSX-S960G6I1XEV without its dash, a 960 GB drive (the same grammar as UCSX-SD960G...);
  // CS-EZ-3TB-HDD a 3 TB HDD in the EZ packs.
  { kind: "drive", re: /^UCSXS\d{3,4}G\d|^CS-EZ-\d+TB-HDD$/ },
  // Supplies the token cannot reach: R200-DISTIPSU-650W "C200/C210 650W PS w/ SB for Disti BOM Use Only",
  // PLHC-N01-UAC1 "Cisco+ Single phase AC power module for UCS 5108".
  { kind: "power", re: /-DISTIPSU-|^PLHC-N01-UAC\d/ },
  // RP208-30-2P-U-2 / RP230-32-1P-U-1 "Cisco RP230-32-U-1 Single Phase PDU 2x C13, 4x C19", RP208-30M1P-4-8 "24A Metered
  // Input 1-Phase 4x C19, 8x C13 - 1U Mount PDU" (which the name marker had called `mechanical` for its "Mount"),
  // C16-2PDU "AddOn-Bullion 2PDU".
  { kind: "pdu", re: /^RP\d{3}-\d{2}|^C16-2PDU$/ },
  // UCSW-WT-IM2P "UCSW Whiptal Niagara 32711-A Dual Port 10GbE", UCSW-WT-IM4P "Niagara 32714 ... Quad Port 10GbE" (was
  // `server`), N20-AI0102 "Cisco UCS CNA M61KR-I Intel Converged Network Adapter".
  { kind: "nic", re: /^UCSW-WT-IM\d|^N20-AI\d{4}$/ },
  // ACCESSORIES the SKU names: coin cells CR1632/CR2032/CR2450 and the Cius and AP1520 batteries (III.0 item 6 says
  // accessory; a NAMED battery still reaches `power` through nameMarker, which files batteries with supplies — see the
  // kind-layer report), CPU carriers UCS-M5-CPU-CAR / HX-M5-CPU-CAR, the S-Series CMC module UCS-SX348-CMC, the X580p
  // PCIe node (UCSX-580P, HCIX-X580P: a GPU expansion node with no CPU of its own, so not a server), heat sinks written
  // -HS-F / -HS-R (UCSX-M8A-HS-F, UCSX-C-M7-HS-R), the front mezzanine blank UCSX-M8A-FMEZZBLK, the SAS extender and
  // pass-through cards R210-SASXTDR / R210-SASXPAND, the interposer UCSC-IPSSD-240M4B, C16-CB16 "8 Module Connecting
  // Box", the VIC port expander PLHC-MLOM-PT-01, N20-CDIVV "Vertical divider for UCS 5108", UCS-T20-TORX "T20 Torx
  // screwdriver", UCSB-SLED2-M6S "B-Series M6 7mm SFF Sled", and the fibre patch panels and cassettes PP-2RU-CHAS /
  // PP-CAS-L-12LC-MMF / PP-144X100G-MMF (decision in the report: a passive panel is not a cable and has no cable_length;
  // the SKU axis cannot return the name-only `mechanical`, so the placeholder-named panels are accessories).
  // UCS-M4-V3-LBL "Cisco M4 - v3 CPU asset tab ID label (Auto-Expand)": the label family once the generation token hides LBL.
  { kind: "accessory", re: /^CR\d{4}$|-BATT(?:ERY)?(?:-|$)|^UCS-M\d-V\d-LBL$|-CPU-CAR$|^UCS-SX\d{3}-CMC$|^(?:UCSX|HCIX)-X?580P|-HS-[FR]$|-FMEZZBLK$|^R210-SASX|^UCSC-IPSSD-|^C16-CB16$|^PLHC-MLOM-PT-|^N20-CDIVV$|^UCS-T\d{2}-TORX$|-SLED\d?-M\d|^PP-(?:\d+RU-CHAS|CAS-|\d+X\d+G-)/ },
  // re-audit decisions (operator, 15 Sep 2026, Q-13): the Services Ready Engine follows the UCS E-Series into this category, "engines
  // kind server" — ISM-SRE-300-K9 / -K9++= / -RS-K9= and SM-SRE-700-K9 / SM-SRE-900-K9 (router service-module engines: a CPU, DRAM,
  // flash and disks), and ISM-SRE-300-BUN-K9 "Services Ready Engine (SRE) 300 ISM for VSEC-SRE bundle", the engine's bundle-component
  // PID, which the bundle rule below read as a programme label (non-product). Before that rule, so the engine reading wins.
  { kind: "server", re: /^(?:ISM|SM)-SRE-\d{3}(?:-|$)/ },
  // Same decisions: the rows planned INTO this category keep the kind they read where they sit today, rather than take `server` from
  // the E100 prefix — E100-FCPLT-BRKT(=) "Bracket Used To Attach Faceplate to E100 Series Module" (mechanical in routers),
  // E100S-CON-DGL(=) "KVM Dongle" (accessory), E100S-MEM-UDIMM8G(=) "8GB … UDIMM for SingleWide UCS-E" (memory), and
  // SM-DSK-SATA-500GB= "Spare 50-GB hard disk for SM-SRE-900-K9" (a drive; the name fallback read `mechanical`). Exact SKUs only: the
  // 36 E100 parts this category already holds as `server` (memory, SD cards, PCIe cards, SED drives) are the kind-axis backlog the
  // parked rebuild owns (Q-28), listed in the re-audit decisions record.
  { kind: "mechanical", re: /^E100-FCPLT-BRKT$/ },
  { kind: "accessory", re: /^E100S-CON-DGL$/ },
  { kind: "memory", re: /^E100S-MEM-UDIMM8G$/ },
  { kind: "drive", re: /^SM-DSK-SATA-/ },
  // Programme and bundle PIDs the token cannot reach (III.0 item 6 "bundles / MLB / multipacks / programme PIDs"):
  // N1K-VSG-UCS-BUN, OPEN-BLOCK-BNDL, START-BNDL-EXP, UCSB-M6-AAS,
  // UCSX-M6-AAS, UCSO-STARTER, AIPOD-POD1, UCSC-EPOD-C220E-S "UCS EZ EXPRESS POD BDL /w2x3048, 2xC220",
  // UCSC-10C220M4S-LI "MULTIPACK: 10-Pk C220 M4", UCSB-10-PK-B200M5, UCS-M6-MULTIPACK, UCS-MAH-B00R00-M6 "Microsoft
  // Azure Stack MX HCI Bundle", UCS-MAFI-6332, N20-Z0001 "Cisco Unified Computing System", HXM4-MCLOUD+APPD,
  // UCSX-COHESITY "UCS-X Cohesity Offer", UCS-VSAN-MLB, UCS-TEST-MLB, HX-EXPRESS-MLB, UCS-DGPUM8-MLB. As `bundle` they
  // go through bundleFamily.ts, whose family rules decide which are programme labels (non-product), configured
  // nodes or interconnects — the round-7 reading, not a new one.
  { kind: "bundle", re: /(?:^|-)(?:BUN|BNDL)(?:-|$)|-AAS$|^UCSO-STARTER|^AIPOD-POD\d$|^UCSC-EPOD-|^UCSC-10C\d{3}M\d|^UCSB-10-PK-|^UCS-M\d-MULTIPACK$|^UCS-MA(?:H|FI)-|^N20-Z\d{4}$|^HXM\d-MCLOUD|^UCSX-COHESITY$|^(?:UCS-(?:VSAN|TEST|DGPUM\d)|HX-EXPRESS)-MLB$/ },
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
  // kind-layer (13 Sep 2026): the token is read from the SKU WITHOUT its spare `=`. ucsToken(sku) kept it, so every
  // EXACT token failed on a spare whose kind token is the last segment: UCSX-9508= (the X9508 chassis) and
  // HCIX-9508= tokenised to "9508=" and were `unknown` while UCSX-9508 was a chassis.
  const t = ucsToken(whole);
  if (!t) return "unknown";
  for (const r of RULES) {
    const hit = r.exact?.has(t) || r.prefix?.some((p) => t.startsWith(p)) || r.re?.test(t);
    if (hit) return (r.kind === "server" || r.kind === "chassis") ? refineMachine(whole, r.kind) : r.kind;
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
  // RULING Q17 R2 (29 Sep 2026): the S3260 drive family's other spellings -- HD8TA / HD10TA / HD8TARR ("10TB 12G SAS 7.2K RPM LFF
  // HDD (4K) w Carrier- Rear Load"), HDW18T / HDW14TR, and the bare-capacity 10TARR -- missed `HD<n>T$` and stayed SERVERS under
  // the S3260 token (41 parts; HDS18T / HDT14T "UCS S3260 14TB Tosh NL-SAS ... HDD" too). A capacity with an S/T/W before it or a
  // TA letter after it is a drive; a bare <n>T (C880-6T, memory) still is not.
  { kind: "drive", re: /^(?:\d*K?S?SD\d|HDD?(?:\d+TB?)?$|SSD|HDD)|^HD[STW]?\d+T[A-Z]{0,3}$|^\d+TA[A-Z]{0,2}$/ },
  // RULING Q17 R2: UCSC-C3X60-SVRN1..8 "UCS C3X60 Server Node E5-2620 v2 CPU 128GB 1GB RAID cache" -- a SERVER filed under the
  // C3X60 chassis token (17 parts, a CPU and memory each; the veto found them holding `cpu` under a chassis).
  { kind: "server", re: /^SVRN(?:\d+|[A-Z])$/ },   // SVRNB= "Cisco UCS C3160 Server Node FRU" too
  // kind-layer (13 Sep 2026): a CBL/CABLE segment is a `cable` now (C880-J-SASCBL "C880 M4 JBOD SAS Cable",
  // C890-M5-CABLE-A), and five whole segments are accessories of the platform they are filed under:
  //   HS     UCSAI-880A-HS (the C880A heat sink)          SLD    UCSAI-880A-B3-SLD / -CC-SLD (tray sleds)
  //   DCSCM  UCSAI-880A-DCSCM (the DC-SCM module)          BAT    C880-BAT-CR2032 "C880 M4 Battery CR2032"
  //   CM     HX-C480-CM "UCS C480 M5 CPU Module w/o CPU, mem" (III.0 item 4 §7b: a module, not the C480)
  // `(?!ARM)`: RC460-CBLARM is "CABLE MANAGEMENT ARM FOR C460 M1", a mechanical part (accessory below).
  { kind: "cable", re: /CBL(?!ARM)|CABLE(?!-?ARM)/ },
  { kind: "accessory", re: /(?:RAIL|PKG|BZL|BEZEL|CBLARM)|^(?:HS|SLD|DCSCM|BAT|CM)$/ },
  { kind: "nic", re: /^(?:NET-)?ADPT$|^NIC$/ },
  { kind: "storage-controller", re: /^SASI$|^RAID/ },
];
function refineMachine(whole: string, kind: UcsKind): UcsKind {
  const segs = whole.split("-").slice(1);
  for (const r of MACHINE_REFINE) if (segs.some((s) => r.re.test(s))) return r.kind;
  return kind;
}
