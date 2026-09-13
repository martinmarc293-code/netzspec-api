// tests/bundleContents.test.ts — the bundle_contents fill path: real names, their refusals, and sabotage.
//
//   npx tsx tests/bundleContents.test.ts
//
// round-7 ruling C (12 Sep 2026). Every case is a live Cisco name from the plan's 277 rows. More refusals than a
// clean suite would carry, on purpose: each refusal is a shape that produced a WRONG list in a draft of the parser —
// FIs dropped from "BNDL2FIx1xChassis", a C3260 counted twice, a pack "for C240M4" read as containing one, and 55
// "Cisco <sku>" placeholders read as a server each.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { bundleContents } from "../src/core/bundleContents.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else misses.push(`${name}\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
};
const items = (name: string, sku?: string) => { const b = bundleContents(name, sku); return b.ok ? b.items : `REFUSED: ${b.reason}`; };

const POSITIVE: [string, string[]][] = [
  ["UCS SP7 B200 PERF 2x6296, 1xCH, 4xB200w/2x2680v2, 256G", ["2x fabric interconnect 6296", "1x chassis", "4x B200"]],
  ["^UCS YES BNDL2FIx1xChassis,4xB200,2x5640,48GB,2x146GHD,1xEMez", ["2x fabric interconnect", "1x chassis", "4x B200"]],
  ["^UCS SP3 BNDL 1xChas-4x(B230,2x2830,128G,2x100G,1xVIC)", ["1x chassis", "4x B230"]],
  ["UCS SharePoint Large w/2xCH,10xB200M3,2xFI96", ["2x chassis", "10x B200 M3", "2x fabric interconnect 6296"]],
  ["UCS Multicloud bundle w/1x5108Chassis,4xB200 M5,2xFI6248", ["1x 5108 chassis", "4x B200 M5", "2x fabric interconnect 6248"]],
  ["UCS SP FLEXPOD MED SOLUTION PAK 2xFI, 2N5K, 2xCH, 8xB200", ["2x fabric interconnect", "2x Nexus 5000", "2x chassis", "8x B200"]],
  ["UCSC PR PRMO 2xN5548, 2xN2232, 4xC220w/2x2650, 64GB, 1xP81E", ["2x Nexus 5548", "2x Nexus 2232 fabric extender", "4x C220"]],
  ["UCS 5108 AC Chassis, 8x B200M4 blades", ["1x 5108 chassis", "8x B200 M4"]],
  ["HX Sprint (EMEAR Only) w/8 HX nodes,2xFI,optional CWOM", ["8x HX node", "2x fabric interconnect"]],
  ["SP7 B200 PERF 2x6248, 1xCH, 2xB200w/2x2680v2, 256G+Invicta6T A", ["2x fabric interconnect 6248", "1x chassis", "2x B200", "1x Invicta 6T appliance"]],
  ["UCS-SPM-MDS-01E C220M4S Std1 w/ 2xE52630v3, 4x16GB, VIC1227, 16Gb FC, MDS9148s", ["1x C220 M4S", "1x MDS 9148S"]],
  ["UCS SP8 C220M4S ENTRY 2x6248,4xC220 w/E52609 v3, 64GB", ["2x fabric interconnect 6248", "4x C220"]],   // the series label is not a fifth C220
  ["Cisco UCS C3260 Base Chassis w/4x PSU, SSD, Railkit", ["1x C3260"]],                                  // one device, not a C3260 and a chassis
  ["MULTIPACK: 10-PkC220 M4 LFF w/o CPU, mem, HD, PCI, PSU, railkit", ["10x C220 M4"]],
  ["HX Standard w/1x480GB SAS, 1x240GB SATA, 6x1.2TB SAS", ["1x 480GB SAS", "1x 240GB SATA", "6x 1.2TB SAS"]],
  ["HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe", ["1x 375GB Optane", "1x 1TB NVMe", "6x 8TB NVMe"]],
  ["8 Pak HDD", ["8x HDD"]],
  ["Bundle WLC2504 w/ 10 AP Lic. and 5 AP-1602i A Reg Domain", ["1x WLC2504", "10x AP licence", "5x AP1602I"]],
  ["Bundle 2 AP1700I and WLC2504 with 25 licenses", ["2x AP1700I", "1x WLC2504", "25x AP licence"]],
  ["Kaiser Bundle of WLC3504 and 10-pack AP3802I", ["1x WLC3504", "10x AP3802I"]],
  // kind-layer operator ruling (13 Sep 2026): the routers bundles. CRS line-card bundles state a card and the port
  // complement of the interface module it ships with; the ASR 5000 complements count their cards.
  ["Cisco CRS Series 40x10GE MSC Bundle", ["1x CRS MSC line card", "1x 40x10GE interface module"]],
  ["Cisco CRS Series 4x100GE FP Bundle", ["1x CRS FP line card", "1x 4x100GE interface module"]],
  ["Cisco CRS Series 14x10GE Ethernet MSE Bundle", ["1x CRS MSE line card", "1x 14x10GE interface module"]],
  ["ASR5000 Bundle, incl 2xSMC/3xPSC 16GB/2xRCC/2xSPIO Str3 3PN", ["2x SMC", "3x PSC 16GB", "2x RCC", "2x SPIO Str3 3PN"]],
  ["ASR5000 Bundle, incl 2xSMC/3xPSC2 32GB/2xRCC/2xSPIOStr3 BNC", ["2x SMC", "3x PSC2 32GB", "2x RCC", "2x SPIO Str3 BNC"]],   // glued variant
];
for (const [name, want] of POSITIVE) check(`parses ${JSON.stringify(name.slice(0, 60))}`, items(name), want);

const REFUSED: [string, string, string?][] = [
  ["UCS SP HX240c Capacity + Addnl 2xFI reqd", "names items that are required, not included"],
  ["HX Sprint (EMEAR Only) w/4 to 32 HX nodes,2xFI,optional CWOM", "a count stated as a range"],
  ["UCS VDI PROMO 2x6296,2xB200 MGMNT,4xB200 WLOAD,4x100VIEW", 'unrecognised counted item "4x100VIEW"'],
  ["HX Encrypt w/1x800GB SAS, 1x240GB SATA, 11x960 SATA", 'a drive line with no unit: "11x960 SATA"'],
  ["Disk Expansion Pack for C240M4 & StorMagic Solution. Usable", "the name states no contents"],   // FOR a C240, not containing one
  ["HX Standard Option 10", "the name states no contents"],
  ["Cisco UCS-SP-C220M5C-B", "the name is only the SKU", "UCS-SP-C220M5C-B"],
  ["", "no name"],
  // kind-layer operator ruling (13 Sep 2026): the CRS and ASR 5000 refusals — a guess would read a capacity as ports
  ["Cisco CRS Series 100GE MSC Bundle", "a CRS line-card bundle whose port count is not stated"],
  ["Cisco CRS 100GE FP Bundle", "a CRS line-card bundle whose port count is not stated"],
  ["CRS-3 Upgrade Bundle", "a CRS bundle name outside the '<n>x<rate>GE <card> Bundle' shape"],   // the non_product programme PID
  ["CRS-3 Multipack Bundle", "a CRS bundle name outside the '<n>x<rate>GE <card> Bundle' shape"],
  ["ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIO 3PN/4xGLC2", 'unrecognised counted item "4xGLC2"'],   // an unknown card still refuses
];
for (const [name, reason, sku] of REFUSED) check(`refuses ${JSON.stringify(name.slice(0, 50))}`, items(name, sku), `REFUSED: ${reason}`);

// THE PLACEHOLDER GUARD NEEDS THE SKU: without it the same placeholder is read as a server. Proves the guard is
// what refuses, not an accident of the name.
check("SABOTAGE without the SKU the placeholder IS misread — the guard is load-bearing", items("Cisco UCS-SP-C220M5C-B"), ["1x C220 M5"]);

// ---- the whole population, against the counts registered in the ledger's DERIVED_FILL_PATHS ----------------------
{
  type Ref = { sku: string; name: string; family: string };
  const ref = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "cisco-bundle-rows-2026-09-12.json"), "utf8")) as { parts: Ref[] };
  const plan = ref.parts.filter((r) => ["multi-device-bundle", "wireless-controller-ap-kit", "storage-config-pack", "bare-server-multipack"].includes(r.family));
  const parsed = plan.filter((r) => bundleContents(r.name, r.sku).ok).length;
  check("the plan's 277 rows: 250 parsed, 27 refused (the figures DERIVED_FILL_PATHS states)", [plan.length, parsed, plan.length - parsed], [277, 250, 27]);
  const bare = ref.parts.filter((r) => r.family === "no-description");
  check("group 14: all 101 placeholder names refused", bare.filter((r) => !bundleContents(r.name, r.sku).ok).length, 101);
  // DERIVED_FILL_PATHS moved out of the ledger builder into one module (13 Sep 2026); the builder imports it.
  const registry = fs.readFileSync(path.join(REPO_ROOT, "src", "core", "derivedFillPaths.ts"), "utf8");
  check("DERIVED_FILL_PATHS registers bundle_contents as a derived fill path with those counts", /bundle_contents:\s*\{\s*by:[^}]*parsed 250, refused 27/.test(registry), true);
  const builder = fs.readFileSync(path.join(REPO_ROOT, "scripts", "build-cup-ledger.mts"), "utf8");
  check("the ledger builder reads that registry rather than a copy of its own", /from\s+["'][./]*src\/core\/derivedFillPaths\.js["']/.test(builder), true);
}

// SABOTAGE the CRS branch: without the strict shape, the general parser reads "40x10GE" as an unrecognised counted item —
// so the branch, not the general path, is what produces the list. Evaluated by handing the name without its CRS word.
check("SABOTAGE without the CRS branch the same name refuses (the branch is load-bearing)",
  items("Cisco Series 40x10GE MSC Bundle"), 'REFUSED: unrecognised counted item "40x10GE"');
// the routers population, against the counts DERIVED_FILL_PATHS registers for it
{
  const registry = fs.readFileSync(path.join(REPO_ROOT, "src", "core", "derivedFillPaths.ts"), "utf8");
  check("DERIVED_FILL_PATHS registers the routers bundles (19 rows: parsed 17, refused 2, SKU control agree 16, disagree 1)",
    /routers `bundle` 19 rows: parsed 17, refused 2 .*agree 16, DISAGREE 1/.test(registry), true);
}

const TOTAL = POSITIVE.length + REFUSED.length + 1 + 4 + 2;
console.log(`    bundle contents: ${pass} passed, ${misses.length} missed (of ${TOTAL})`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length || pass !== TOTAL) process.exit(1);
