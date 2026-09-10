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

export type UcsKind =
  | "server" | "chassis" | "fabric-interconnect"
  | "cpu" | "memory" | "drive" | "psu" | "nic" | "gpu" | "storage-controller"
  | "accessory" | "os-license" | "bundle" | "non-product" | "unknown";

/** Kinds that are a whole machine — the only ones a physical specification belongs to. */
export const UCS_MACHINE: readonly UcsKind[] = ["server", "chassis", "fabric-interconnect"];

/** Kinds that are a part OF a machine. Cisco publishes no weight or operating temperature for
 *  these, so a physical requirement on them is a gap nothing can ever close. */
export const UCS_COMPONENT: readonly UcsKind[] =
  ["cpu", "memory", "drive", "psu", "nic", "gpu", "storage-controller", "accessory"];

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
  s = s.replace(/^(?:HXAF|HCIX|HCI|HX)-/, "").replace(/^(?:HXAF|HX)(?=[A-Z]{2})/, "");
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
const RULES: { kind: UcsKind; exact?: Set<string>; prefix?: string[] }[] = [
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
  { kind: "os-license", exact: new Set(["VMW", "SLES", "RHEL", "MSWS", "CTX", "NV", "RH", "SL",
                                        "CVLT", "STORM", "VEM", "EZ", "BD",
                                        // read out of the residue 9 Sep 2026, not guessed:
                                        // UCSW-WT-SMMR54, C1-CWOM-750SVR-5Y, CUIC-NFV-1Y-PHYSVR,
                                        // C16S16-L64G-YR-SVA, DC-MGT-IS-SAAS-ES1, UCS-BDMREP-DH
                                        "UCSW", "C1", "CUIC", "DC", "BDMREP", "BMC"]),
    prefix: ["C16S", "C1-", "INTERSIGHT"] },

  { kind: "fabric-interconnect", exact: new Set(["FI"]), prefix: ["FI"] },
  { kind: "chassis", exact: new Set(["5108", "9508", "C4200", "C3X60", "N20"]),
    prefix: ["IOM", "IFM", "I-9108"] },
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

  { kind: "cpu", exact: new Set(["CPU"]), prefix: ["CPU"] },
  { kind: "memory", exact: new Set(["MR", "ML", "MRX", "MLX", "MEM"]), prefix: ["MR", "ML", "MEM"] },
  // Drives are the most fragmented token family in the catalogue — NVMEG4, NVME4, NVMEHW,
  // NVB3T8O1V, SDB3T8OA1P, UCSXSD960GBKNK9. Prefixes, not a list, or every new capacity is an edit.
  // `F` is Fusion-io (UCSC-F-H19001), `C3K` the C3000 storage server's drives.
  { kind: "drive", exact: new Set(["F", "C3K"]),
    prefix: ["HD", "SD", "NVME", "NVB", "SDB", "M2", "HYB", "SSD", "C3K"] },
  { kind: "psu", prefix: ["PSU", "PSUV2"] },
  { kind: "gpu", prefix: ["GPU"] },
  { kind: "storage-controller", prefix: ["RAID", "SAS", "HBA", "9300", "MRAID"] },
  // `P` is the X-Series PCIe node adapter (UCSC-P-NC3220); N2XX/N20 are the first-generation
  // mezzanine adapters.
  { kind: "nic", exact: new Set(["P", "N2XX", "A01"]), prefix: ["MLOM", "PCIE", "VIC", "P-", "PCI"] },
  { kind: "accessory", exact: new Set(["CB", "CBL", "N10"]),
    prefix: ["RIS", "FAN", "HS", "TPM", "CAB", "RAIL", "CMA", "BZL", "KIT",
             "RACK", "BLKE", "BLK", "SCRW", "LBL", "CBL", "CB-"] },
  // Solution packs and bundles: their facts belong to the base server they contain.
  { kind: "bundle", exact: new Set(["SP", "SPL", "SPR", "SPM", "SPB", "SP5", "DBUN", "SA", "SM"]),
    prefix: ["SP", "DBUN", "EZ7", "EZ8", "SM-"] },
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
 * The kind of a UCS part, or `unknown`.
 *
 * `unknown` is a real answer and is never guessed into a neighbouring kind: a wrong kind puts a
 * part behind the wrong profile, which is exactly the defect being fixed. The residue is reported
 * by the audit so it can be read rather than assumed away.
 */
export function ucsKind(sku: string): UcsKind {
  const t = ucsToken(sku);
  if (!t) return "unknown";
  for (const r of RULES) {
    if (r.exact?.has(t)) return r.kind;
    if (r.prefix?.some((p) => t.startsWith(p))) return r.kind;
  }
  return "unknown";
}
