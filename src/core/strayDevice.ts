// src/core/strayDevice.ts — real devices filed in a SOFTWARE category, and what each one is.
//
// fallback-kinds (12 Sep 2026), reviewer §8.
//
// WHAT THESE 51 ROWS ARE. Reclassify run 973 had a rule that wanted to move them `hardware ->
// software`, and its evidence guards refused: 33 for an own physical fact, 16 for a vendor
// consumption-model phrase, 1 for a hardware twin, 1 for both
// (runs/reports/reclassify-2026-09-12-run973.json, `foreign_by_reason`). The rule was not a SKU-token
// rule and there is nothing wrong with it: it is the CATEGORY fallback, `category-is_hardware=false`,
// and these rows sit in `ios-nx-os-software` (28), `cloud-systems-management` (12),
// `data-center-analytics` (7) and `software` (4) — categories whose members really are software.
//
// THE REVIEWER'S POINT, and it is exactly right: *a device that a software-token rule can reach is a
// device whose kind marker is missing.* Here the missing marker is a whole axis — those four
// categories gate on nothing, so `partKind` returns undefined and every one of the 51 is a Cisco
// 8000, an NCS 5500, a Catalyst 2960-X, a Nexus 9300 or a Catalyst 9166 access point with no kind at
// all. The guard is the belt; this file is the braces, and it is load-bearing rather than
// documentation: `classify()` consults it, so the class rule is REFUSED in code and not only inside
// one pipeline's sampling guard. The precedent is the same file's own: the 14 UNITY-PIMG / UNITY-TIMG
// media gateways are "vetoed here and given kind `gateway` in collabKind instead".
//
// THE REAL FIX IS A CATEGORY MOVE and it is a database write, so it is a PROPOSAL in
// docs/reports/schema-fallback-kinds-2026-09-12.md and not done here. A `router` filed under
// `ios-nx-os-software` still has no profile to be scored against; naming its kind stops it being
// deleted while that proposal waits.
//
// EVERY RULE IS AN EXPLICIT FAMILY, never a token shape, and all 51 rows were read one at a time.
// That is deliberate: a `-SYS` suffix rule would be a claim about a token, and `SYS` appears across
// the catalogue. Each entry names the product it protects, so a future reader can check the claim
// against the vendor rather than against this comment.

export type StrayKind = "switch" | "router" | "linecard" | "module" | "nic" | "ap" | "server";

export type StrayDevice = { kind: StrayKind; why: string };

const RULES: { re: RegExp; kind: StrayKind; why: string }[] = [
  // --- ios-nx-os-software (28 rows) -------------------------------------------------------------
  // Cisco 8000 Series fixed routers. "Cisco 8201 1RU System w/ 24x400GE QSFP56-DD&12x100G QSFP28".
  { re: /^820[12]-SYS$/, kind: "router", why: "Cisco 8000 Series fixed router, sold as a system under the flexible-consumption model" },
  // NCS 540 / 560 / 5500 / 5700 routers ordered as "Base System HW for Flexible Consumption": the
  // phrase the run's own guard refused on, because it is the vendor's LICENSING model and not a
  // statement that the part is software. "NCS-5516 Base System HW for Flexible Consumption Model".
  { re: /^N540X?-[A-Z0-9]+-SYS(?:-[A-Z])?$/, kind: "router", why: "NCS 540 fixed router (NCS540 24x1/10G SFP+, 8x1/10/25G SFP+/SFP28)" },
  { re: /^N560-\d+-SYS(?:-[A-Z])?$/, kind: "router", why: "NCS 560 modular router ATO (7RU System, 800G)" },
  { re: /^NCS-55(?:0\d|A\d|\d+)[A-Z0-9-]*-SYS$/, kind: "router", why: "NCS 5500 router chassis or fixed system, flexible consumption" },
  // `[A-Z0-9-]`, not `[A-Z0-9]`: the one miss the 51-row round-trip found. "NCS-57C1-48Q6-SYS" has
  // two hyphenated groups before the suffix, and a character class without the hyphen cannot cross
  // them — the rule silently covered 50 of 51 and the list is what said so.
  { re: /^NCS-57[A-Z0-9-]+-SYS$/, kind: "router", why: "NCS 5700 fixed router chassis (NCS 57C1 Base Chassis)" },
  // Modular port adapters for the NCS 5500: a card that goes in an MPA bay.
  { re: /^NC5[57]-MPA-/, kind: "module", why: "NCS 5500/5700 modular port adapter (12X10G MPA, 4X100G QSFP28 MPA)" },
  // "ASR 9000 4T Flexible Consumption Line Card - 5x100GE/20x10GE".
  { re: /^A99-\d+T-FC$/, kind: "linecard", why: "ASR 9900 line card sold under the flexible-consumption model" },
  // --- cloud-systems-management (12 rows) -------------------------------------------------------
  // Catalyst 2960-X / 2960-XR. These two rows are SERIES-level and hold five own facts each; whether
  // a series row should exist at all is a separate question (it is in the report's proposals), but it
  // is a switch and not a management application.
  { re: /^2960-XR?$/, kind: "switch", why: "Catalyst 2960-X / 2960-XR series row, five own facts, filed under a management category" },
  // "Cisco 1100 Terminal Services Gateway w/ 32 Async Ports": an ISR-family console-server router.
  { re: /^C1100TGX?-/, kind: "router", why: "Cisco 1100 Terminal Services Gateway, 10 own physical facts" },
  // Catalyst Wireless 9162/9166 access points, Wi-Fi 6E.
  { re: /^CW91\d{2}[A-Z]\d?$/, kind: "ap", why: "Catalyst Wireless 9162/9166 Wi-Fi 6E access point" },
  // "Cisco Catalyst Center Appliance (Gen 3) - 80 Core" and its spare: a UCS-based appliance.
  // THE SIZE SUFFIX AND NOTHING ELSE. The catalogue-wide control refused the first draft `^DN\d-HW-APL`:
  // it also claimed DN3-HW-APL-XL-LIC "Catalyst Center Gen3 XL (80 Core) Appliance License" and four
  // more `-LIC` rows, plus DN1-HW-APL-U / DN2-HW-APL-U "Appliance -- Upgrade". Their SKU rules class
  // them correctly already, so no class would have changed — but `partKind` would have called a
  // licence a server, which is the same defect one column over.
  { re: /^DN\d-HW-APL(?:-(?:XL|L|M|S))?=?$/, kind: "server", why: "Catalyst Center (DNA Center) hardware appliance, by size suffix; its licence and upgrade PIDs are refused" },
  // --- data-center-analytics (7 rows) -----------------------------------------------------------
  // The network cards ordered with an APIC or a Catalyst Center appliance. "Cisco-Intel E810XXVDA2
  // 2x25/10 GbE SFP28 PCIe NIC", "APIC Intel X710T2LOCPV3G1L 2x10GbE RJ45 OCP3.0".
  { re: /^(?:DN\d|APIC)-[PO]-I/, kind: "nic", why: "Cisco-Intel PCIe or OCP network card for an APIC / Catalyst Center appliance" },
  // "Nexus 9300 with 48p 10/25G SFP+, 6p 100G QSFP" — a Nexus 9300 sold with the Workload/Tetration
  // agent, so the ORDER is an analytics one and the part is a switch.
  { re: /^TA-C9\d/, kind: "switch", why: "Nexus 9300 switch ordered with Secure Workload (Tetration) analytics" },
  // --- software (4 rows) ------------------------------------------------------------------------
  // "Nexus 3550-F 16-port SFP line card" / "4-port QSFP line card", and their spares.
  { re: /^N35-F-X(?:16P|4Q)=?$/, kind: "linecard", why: "Nexus 3550-F line card (16-port SFP, 4-port QSFP)" },
];

/**
 * The device a SKU names, where its category says software. Undefined for everything else — which is
 * every other part in the catalogue, because each rule is an explicit family.
 */
export function strayDevice(sku: string): StrayDevice | undefined {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return undefined;
  for (const r of RULES) if (r.re.test(s)) return { kind: r.kind, why: r.why };
  return undefined;
}

/**
 * The 51 SKUs the guards refused in run 973, listed so the test can assert the rules cover exactly
 * them — in BOTH directions. A hand-maintained list of things that exist drifts silently both ways,
 * so this one is checked against `strayDevice` itself rather than trusted: the test fails if a SKU
 * here derives no kind, and the catalogue-wide control fails if a rule claims anything else.
 */
export const GUARD_REFUSED_2026_09_12: readonly string[] = [
  // ios-nx-os-software (28)
  "8201-SYS", "8202-SYS", "A99-4T-FC",
  "N540-24Q8L2DD-SYS", "N540-24Z8Q2C-SYS", "N540-ACC-SYS", "N540X-6Z18G-SYS-A", "N540X-ACC-SYS",
  "N560-7-SYS", "N560-7-SYS-E",
  "NC55-MPA-12T-S-FC", "NC55-MPA-1TH2H-FC", "NC55-MPA-2TH-S-FC", "NC55-MPA-4H-HD-FC", "NC55-MPA-4H-S-FC",
  "NCS-5501-SE-SYS", "NCS-5501-SYS", "NCS-5504-SYS", "NCS-5508-SYS", "NCS-5516-SYS",
  "NCS-55A1-24H-SYS", "NCS-55A1-24Q6-SYS", "NCS-55A1-24QX-SYS", "NCS-55A1-36H-SYS", "NCS-55A1-36HS-SYS",
  "NCS-55A2-MOD-SYS", "NCS-55A2-MODS-SYS", "NCS-57C1-48Q6-SYS",
  // cloud-systems-management (12)
  "2960-X", "2960-XR", "C1100TG-1N24P32A", "C1100TG-1N32A", "C1100TGX-1N24P32A",
  "CW9162I", "CW9166D1", "CW9166I", "DN3-HW-APL-XL", "DN3-HW-APL-XL=", "DN3-P-I8D25GF", "DN3-P-I8Q25GF",
  // data-center-analytics (7)
  "APIC-O-ID10GC", "APIC-P-I8D25GF", "APIC-P-ID10GC",
  "TA-C93180YC-FX", "TA-C93180YC-FX-NR", "TA-C93180YC-FX=", "TA-C93180YC-FX3",
  // software (4)
  "N35-F-X16P", "N35-F-X16P=", "N35-F-X4Q", "N35-F-X4Q=",
];
