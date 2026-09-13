// src/core/bundleFamily.ts — what a row the UCS/wireless axes call `bundle` (or a collab `software` row)
// actually is, read from its NAME. Round-7 ruling C, 12 Sep 2026.
//
// WHY THE NAME, HERE AND NOWHERE ELSE. The SKU axes (ucsKind, wirelessKind) stop at "bundle": an SP/EZ/SL
// programme number says HOW a thing was sold, not WHAT it is. 1,568 such rows were asked zero cups. All
// 1,568 were read in full (docs/reports/cisco-bundle-separation-plan-2026-09-12.md) and none holds a
// datasheet-class document, so the part's own name is the entire evidence base — and the name, read, is
// unambiguous for most of them: "UCS SP Select 5108 AC2 Chassis w/2208 IO" is a chassis.
//
// THESE RULES ARE ONLY EVER SHOWN A ROW THE AXIS ALREADY CALLED `bundle`. That scope is the safety.
// Measured over all 42,501 live Cisco hardware rows, the same name keywords outside the cohort are
// catastrophic: `bundle` in a name catches 1,134 rows outside it, a drive spec 1,323 (840 with own facts),
// a leading `^` 427 across eight categories. Inside it they reproduce the approved reading row for row,
// which tests/bundleFamily.test.ts asserts against the frozen reference
// data/reference/cisco-bundle-rows-2026-09-12.json.
//
// PORTED VERBATIM from the analysis that produced the approved table. Two regex bugs and two over-reaches
// were found there by reading output, not counts, and each fix is kept:
//   * no `\b` before a product token — "standaloneB200M4Hi-Freq2" has no word boundary before B200, and
//     "FI3232UP" none between FI and 3 (48 rows lost in v1);
//   * no `(?<![A-Z0-9])` on an /i pattern — under /i the class matches lowercase too, so the `e` of
//     "standalone" refused the match (53 rows lost in v2);
//   * a solution NAME ("SAP HANA", "SharePoint") is not evidence of more than one device; a COUNTED device is;
//   * "Le rankSP C220 M5SX w/2x4116..." is a configured node with a corrupted name, not a programme label.
// The `\b` that remain are between two word characters and a non-word one ("Pk", "SW 3", "SDRAM") and
// were read row by row; they are not on the product-token boundaries the CLAUDE.md rule is about.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MLB_GENERATION } from "./ucsKind.js"; // kind-layer (13 Sep 2026)

export type BundleFamily =
  | "no-description" | "dead-or-internal-only" | "expired-promo" | "software-subscription"
  | "wireless-controller-ap-kit" | "asr5000-packet-core" | "non-ucs-misfiled" | "storage-config-pack"
  | "drive-memory-flash-component" | "bare-server-multipack" | "multi-device-bundle"
  | "chassis-or-fabric-interconnect" | "configured-node" | "solution-or-programme-label-only";

export type BundleRow = { category: string; sku: string; name: string; axisKind: string };

const bare = (r: BundleRow): boolean =>
  !r.name.trim() || r.name.trim().toLowerCase() === ("cisco " + r.sku).toLowerCase();

// A server/node MODEL token. Digit-only lookarounds throughout — no \b, no case-dependent class.
export const NODE_MODEL = /(?<![0-9])(?:B2\d{2}|B4\d{2}|B2[0-9](?![0-9])|C2\d{2}|C3\d{3}|C4\d{2}|C2[024](?![0-9])|S3260|HX2\d0c|AF2\d0c|HXAF2\d0C|HX2X0C|HXAF2X0C|2[24]0M[3-7]|2[24]0c)/i;
// An infrastructure device: the 5108 blade chassis, the 61xx-64xx fabric interconnects, a chassis expansion.
export const INFRA = /(?<![0-9])(?:5108|6248|6296|6324|6332|6454|6100|FI\d{4})|(?<![a-z])(?:FI|fabric int|in-chassis fi)(?![a-z])|mini ac2 chassis|chassis exp/i;
// "N x <device>" — a count glued to a device token. The ONLY accepted evidence of more than one device.
const COUNTED_DEVICE =
  /\d+\s*x\s*(?:FI|CH|B2|B4|C2|C3|N5K|N5548|N3048|N2232|2232|5548|3048|5108|6248|6296|6324|6332|6454|HX\s?node|PPC|PSC|SMC)/i;

/** [family, the one sentence of evidence that groups them, predicate]. ORDER IS PART OF THE RULE. */
export const BUNDLE_FAMILY_RULES: readonly [BundleFamily, string, (r: BundleRow) => boolean][] = [
  ["no-description",
   'the name is only "Cisco <sku>" — the store placeholder for a part whose description was never acquired',
   bare],
  ["dead-or-internal-only",
   'the name itself says the SKU is not sellable: "INVALID SKU - NOT TO BE USED", "(Internal Only)", "for Test purposes"',
   (r) => /invalid sku|\(internal only\)|for test purposes/i.test(r.name)],
  ["expired-promo",
   'the name carries a promotional expiry date, long past ("WCS Demo Promo ends 8/1/10")',
   (r) => /promo ends|ends \d+\/\d+\/\d+/i.test(r.name)],
  ["software-subscription",
   "the name states a software subscription, licence, SW option or preload and no hardware at all",
   (r) => r.axisKind === "software" ||
     /(?:subscription|data platform sw|\bSW \d|software|preload|multisite option|not for resale)/i.test(r.name)],
  ["wireless-controller-ap-kit",
   'wireless: "Bundle WLC<n> w/ N AP Lic. and M AP-<model>", or a Mobility Express AP+controller kit',
   (r) => r.category === "wireless" && /bundle.*(?:wlc|ap-?\d|mobility express)/i.test(r.name)],
  ["asr5000-packet-core",
   "SKU is ASR5K-* — ASR 5000 mobile packet-core chassis and partner-lab bundles, not wireless-LAN hardware",
   (r) => /^ASR5K-/i.test(r.sku)],
  ["non-ucs-misfiled",
   "ISR Service-Ready-Engine module SDRAM and disks, a 19-inch rack, a packing pallet",
   (r) => /^SM-(?:MEM|HDD|HDDB|DSK)/i.test(r.sku) || /packing pallet|standard rack/i.test(r.name) || r.sku === "CX-7"],
  ["storage-config-pack",
   'a DRIVE SET for a node and nothing else — "HX Standard w/1x480GB SAS, ...", an HX Encrypt set, an NVMe Pak',
   (r) => /^(?:HX (?:standard|encrypt)|disk expansion pack|vsan disk expansion|\d+ pak hdd)/i.test(r.name)
     || /nvme pak/i.test(r.name)],
  ["drive-memory-flash-component",
   "a bare storage or memory part spec — capacity + interface + form factor, an ioMemory card, a DIMM — naming no machine",
   (r) => !NODE_MODEL.test(r.name) && !INFRA.test(r.name) &&
     (/\d+(?:\.\d+)?\s*(?:GB|TB)\b.*(?:HDD|SSD|SATA|SAS|NVMe|RDIMM|LRDIMM|DIMM|\bDR\b|hard disk)/i.test(r.name)
       || /fusion[- ]?io|iomemory|iodrive|warpdrive|\bSDRAM\b|\d+\s*(?:GB|TB).*MHz|MHz.*\d?PA?[Kk](?![a-z])/i.test(r.name))],
  ["bare-server-multipack",
   'MULTIPACK / 10-Pk of a server model, "w/o CPU, mem, HD" — a packaging SKU for ten empty machines',
   (r) => /multipack|10-?pk/i.test(r.name)],
  ["multi-device-bundle",
   "the name enumerates a COUNT of two or more physical devices — chassis plus blades, N fabric interconnects, N servers",
   (r) => COUNTED_DEVICE.test(r.name)
     || (/chassis|\bCH\b|\bCH-|\bCH,/i.test(r.name) && NODE_MODEL.test(r.name))],
  ["chassis-or-fabric-interconnect",
   "a 5108 blade chassis or a 61xx-64xx fabric interconnect, with its IOMs, licences or cables, and no compute node",
   (r) => INFRA.test(r.name) && !NODE_MODEL.test(r.name)],
  ["configured-node",
   "ONE server or HyperFlex node model with its CPU, memory and adapter configuration, under a programme SKU",
   (r) => NODE_MODEL.test(r.name)],
  ["solution-or-programme-label-only",
   "a solution, programme, region or tier LABEL with no device and no configuration stated",
   () => true],
];

/** The family of a cohort row. Only meaningful for a row whose axis already said bundle/software. */
export function bundleFamily(r: BundleRow): BundleFamily {
  for (const [family, , p] of BUNDLE_FAMILY_RULES) if (p(r)) return family;
  return "solution-or-programme-label-only";
}

/**
 * Round-7 ruling C, group 1: UCS-SPM-MDS-01E..08E name a C220/C240 AND an MDS 9148S/9396S fabric switch —
 * two devices, so they are a bundle (group 4), not a configured node. The eight `data_rate` facts on them
 * ("16", the MDS's Fibre Channel speed) are evidence of that switch in the bundle's contents and are NOT
 * retracted.
 */
const SERVER_PLUS_MDS = /^UCS-SPM-MDS-\d{2}E=?$/i;

/**
 * SEVEN ROWS THE NAME CANNOT PLACE, AND THE PLAN CONTRADICTED ITSELF ABOUT THEM (found implementing round 7,
 * 12 Sep 2026). The plan's table put them in group 10 (programme label -> non_product) because the family
 * rules found no model token in the name; the same plan's text said "they are inside group 1 by SKU prefix".
 * Both cannot hold, and only one of them avoids filing real hardware as not-a-product:
 *   UCS-SP-B200M4-BC1T/BC2T/BF1T/BF2T/BF3T  "(Not sold standalone) Hi-Core1w/2xE52683v4, 8x32GB, VIC1340" —
 *       a configured B200 M4 blade whose name lost its model; the non-T siblings are group 1 servers.
 *   HXAF2X0C-M5S, HXAF2X0C-M5S-BR  "Cisco Hyperconverged System" — the HyperFlex SYSTEM umbrella PID a cluster
 *       of nodes is ordered under (ucsKind already lists AF2X0C as a bundle token): a bundle, not a node.
 * Held in hardware by this explicit list, excluded from the class change, and reported to the operator.
 */
export const NAME_OMITS_MODEL: Readonly<Record<string, "server" | "bundle">> = {
  "UCS-SP-B200M4-BC1T": "server", "UCS-SP-B200M4-BC2T": "server", "UCS-SP-B200M4-BF1T": "server",
  "UCS-SP-B200M4-BF2T": "server", "UCS-SP-B200M4-BF3T": "server",
  "HXAF2X0C-M5S": "bundle", "HXAF2X0C-M5S-BR": "bundle",
};

/** A 5108 or any other chassis wins over an FI it CONTAINS ("5108 AC2 Chassis w/FI6324"); a bare FI
 *  ("6324 In-Chassis FI", "FI3232UP") is an interconnect. Read over all 96 rows of group 2. */
const CHASSIS_5108 = /(?<![0-9])5108(?![0-9])/;
const FI_TOKEN = /(?<![a-z])FI(?![a-z])|fabric int|interconnect|(?<![0-9])(?:61\d\d|62\d\d|63\d\d|64\d\d)(?![0-9])|FI\d{4}/i;
const MEMORY_NAME = /SDRAM|DIMM|(?<![0-9])\d{4}\s*-?\s*MHz/i;
const FLASH_CARD = /fusion|iomemory|iodrive|warpdrive/i;

/**
 * The UCS kind a cohort row resolves to. `bundle` stays `bundle` for groups 4, 5, 6, 13 and 14 — which
 * after this change ask `bundle_contents`. Groups 9-12 and the pallets leave `hardware` by CLASS
 * (productClass.ts, an explicit SKU list), so the kind named for them here reaches no ledger; it is the
 * honest name for the API all the same.
 */
export function ucsBundleKind(sku: string, name: string, axisKind: string, category: string): string {
  const held = NAME_OMITS_MODEL[String(sku ?? "").trim().toUpperCase()];
  if (held) return held;
  // kind-layer (13 Sep 2026): a Major Line Bundle of one server generation (UCSX-M8-MLB, UCS-M6-MLB, HCI-M7-MLB ...) IS
  // a bundle — III.0 item 4 §7b. Its name describes the family it is the umbrella for ("This MLB consists of the server
  // node ... with software"), so the family rules below would read it as a programme label or a software subscription.
  // The SKU shape is the evidence here, exactly as for NAME_OMITS_MODEL above; it is not one of the frozen cohort rows.
  if (MLB_GENERATION.test(String(sku ?? "").trim().toUpperCase().replace(/=+$/, ""))) return "bundle";
  const family = bundleFamily({ category, sku, name, axisKind });
  switch (family) {
    case "configured-node":
      return SERVER_PLUS_MDS.test(sku) ? "bundle" : "server";
    case "chassis-or-fabric-interconnect": {
      if (CHASSIS_5108.test(name)) return "chassis";
      // THE HEAD NOUN DECIDES, not the presence of a token. UCS-SP-MINI-2-5108 is "2nd Mini AC2 Chassis
      // w. I/O Mod, FI p.lic" — a chassis that ships an FI port LICENCE — and "any FI token means an
      // interconnect" filed it as one; the first version did exactly that. "6324 In-Chassis FI" is the
      // mirror case: the chassis word comes AFTER the FI it describes.
      const ch = name.search(/chassis|(?<![a-z])CHS(?![a-z])/i);
      const fi = name.search(FI_TOKEN);
      if (fi < 0) return "chassis";
      return ch >= 0 && ch < fi ? "chassis" : "fabric-interconnect";
    }
    case "drive-memory-flash-component":
      return MEMORY_NAME.test(name) && !FLASH_CARD.test(name) ? "memory" : "drive";
    case "non-ucs-misfiled":
      if (/packing pallet/i.test(name)) return "non-product";
      if (/^SM-MEM/i.test(sku)) return "memory";
      if (/^SM-HDD/i.test(sku)) return "drive";
      return "mechanical";   // SM-DSK-COVER (a face plate), UCS-EZ-INFRA-RACK (a 42U enclosure)
    case "software-subscription":
      return "software";
    case "dead-or-internal-only":
    case "solution-or-programme-label-only":
      return "non-product";
    default:
      return "bundle";
  }
}

// ---- CLASS: the rows that leave `hardware` (round-7 ruling C, groups 9-12 and the two pallets) ------------
//
// SELECTED BY AN EXPLICIT SKU LIST, NEVER BY A KIND NAME OR A NAME RULE. The operator's condition on group 9
// was exactly this, and the trap it guards is measured: "move the software rows" draws from two kinds and
// three category totals — 19 in hyperconverged-systems.BUNDLE and 12 in a .software kind — so a selector on
// the kind name moves 12 of 31. Groups 10-12 get the same treatment for a different reason: group 10 is the
// RESIDUE of the family rules (`() => true`), and a residue applied to rows written tomorrow would file any
// new bundle nobody has read as not-a-product. The list is the frozen reference, (sku, category) exact.

export type BundlePlanClass = { klass: "software" | "non_product"; reason: string };

/** The reason each leaving family carries — the operator's own strings (round 7, 12 Sep 2026). */
export const BUNDLE_PLAN_REASONS: Readonly<Partial<Record<BundleFamily, BundlePlanClass>>> = {
  "software-subscription": { klass: "software", reason: "bundle-plan:software-subscription" },
  "solution-or-programme-label-only": { klass: "non_product", reason: "programme-or-solution-label" },
  "dead-or-internal-only": { klass: "non_product", reason: "not-sellable:self-declared" },
  "expired-promo": { klass: "non_product", reason: "expired-promotion" },
};
const PALLETS = new Set(["UCSW-SA-PALET", "UCSW-SA-PALET="]);
const PALLET_CLASS: BundlePlanClass = { klass: "non_product", reason: "packaging-not-a-product" };

type RefRow = { category: string; sku: string; family: BundleFamily };
let planIndex: Map<string, BundlePlanClass> | null = null;
function index(): Map<string, BundlePlanClass> {
  if (planIndex) return planIndex;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ref = JSON.parse(fs.readFileSync(path.join(root, "data", "reference", "cisco-bundle-rows-2026-09-12.json"), "utf8")) as { parts: RefRow[] };
  const m = new Map<string, BundlePlanClass>();
  for (const r of ref.parts) {
    if (NAME_OMITS_MODEL[r.sku]) continue;   // held in hardware — see NAME_OMITS_MODEL
    const c = PALLETS.has(r.sku) ? PALLET_CLASS : BUNDLE_PLAN_REASONS[r.family];
    if (c) m.set(`${r.category}|${r.sku}`, c);
  }
  planIndex = m;
  return m;
}

/** The class a part leaves `hardware` for under the bundle plan, or null. Exact (category, sku) only. */
export function bundlePlanClass(sku: string, categorySlug: string | null | undefined): BundlePlanClass | null {
  if (!categorySlug) return null;
  return index().get(`${categorySlug}|${String(sku ?? "").trim()}`) ?? null;
}
