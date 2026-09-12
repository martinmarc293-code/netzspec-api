// tests/bundleFamily.test.ts — the bundle plan's family rules reproduce the APPROVED reading, row for row.
//
//   npx tsx tests/bundleFamily.test.ts
//
// round-7 ruling C (12 Sep 2026). data/reference/cisco-bundle-rows-2026-09-12.json is the frozen reading the
// operator ruled on family by family. A family rule that drifts from it changes an approved decision while every
// count still looks plausible — which is how the analysis that produced it lost 48 and then 53 rows to two regex
// bugs. So the reference is compared exactly, the kind each family becomes is pinned by count, and each
// load-bearing rule gets a sabotage that must turn the comparison red.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { bundleFamily, ucsBundleKind, bundlePlanClass, BUNDLE_FAMILY_RULES, NAME_OMITS_MODEL, type BundleFamily } from "../src/core/bundleFamily.js";
import { partKind } from "../src/core/partKind.js";
import { classify } from "../src/core/productClass.js";
import { ownedReason, plan, scopePlan, type PartRow } from "../src/pipeline/reclassify.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else misses.push(`${name}\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
};

type Ref = { category: string; kind_before: string; sku: string; name: string; family: BundleFamily; own_keys: string[] };
const ref = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "cisco-bundle-rows-2026-09-12.json"), "utf8")) as { rows: number; parts: Ref[] };
check("the reference holds the 1,568 rows it says", [ref.rows, ref.parts.length], [1568, 1568]);

const familyOf = (r: Ref) => bundleFamily({ category: r.category, sku: r.sku, name: r.name, axisKind: r.kind_before });
const diffs = (rows: Ref[]) => rows.filter((r) => familyOf(r) !== r.family);

// ---- 1. every row's family, exactly ----------------------------------------------------------------------
{
  const d = diffs(ref.parts);
  check(`every one of the 1,568 rows reproduces its approved family (${d.length} differ: ${d.slice(0, 3).map((r) => `${r.sku} ${r.family}->${familyOf(r)}`).join("; ")})`, d.length, 0);
}

// ---- 2. the kind each family becomes, by count — the numbers the plan and the operator approved ---------------
{
  const tally = new Map<string, number>();
  for (const r of ref.parts) {
    const k = `${r.family}|${partKind(r.category, r.sku, r.name)}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const t = (fam: string, kind: string) => tally.get(`${fam}|${kind}`) ?? 0;
  check("group 1: 827 configured nodes are servers (835 less the 8 server+MDS bundles)", t("configured-node", "server"), 827);
  check("group 1 -> 4: the 8 UCS-SPM-MDS rows are bundles", t("configured-node", "bundle"), 8);
  check("group 2: 52 chassis and 44 fabric interconnects", [t("chassis-or-fabric-interconnect", "chassis"), t("chassis-or-fabric-interconnect", "fabric-interconnect")], [52, 44]);
  check("group 3: 95 drives and 15 memory", [t("drive-memory-flash-component", "drive"), t("drive-memory-flash-component", "memory")], [95, 15]);
  check("groups 4, 6, 13, 14 stay bundle (175, 37, 7, 101)", [t("multi-device-bundle", "bundle"), t("storage-config-pack", "bundle"), t("bare-server-multipack", "bundle"), t("no-description", "bundle")], [175, 37, 7, 101]);
  check("group 8: 4 memory, 3 drives, 2 mechanical, 2 pallets", [t("non-ucs-misfiled", "memory"), t("non-ucs-misfiled", "drive"), t("non-ucs-misfiled", "mechanical"), t("non-ucs-misfiled", "non-product")], [4, 3, 2, 2]);
  check("the 7 name-omits-model rows: 5 servers, 2 bundles", [t("solution-or-programme-label-only", "server"), t("solution-or-programme-label-only", "bundle") - 2], [5, 2]);
}

// ---- 3. named cases: the head-noun rule, the MDS pairs, the held seven -----------------------------------------
check("'2nd Mini AC2 Chassis w. I/O Mod, FI p.lic' is a chassis that ships an FI LICENCE",
  ucsBundleKind("UCS-SP-MINI-2-5108", "UCS SP Select 2nd Mini AC2 Chassis w. I/O Mod, FI p.lic,QSFP", "bundle", "servers-unified-computing"), "chassis");
check("'6324 In-Chassis FI' is an interconnect", ucsBundleKind("UCS-SP-FI-M-6324", "(Not sold Standalone)UCS SP 6324 In-Chassis FI", "bundle", "servers-unified-computing"), "fabric-interconnect");
check("UCS-SPM-MDS-01E is a bundle: a C220 AND an MDS 9148S", ucsBundleKind("UCS-SPM-MDS-01E", "UCS-SPM-MDS-01E C220M4S Std1 w/ 2xE52630v3, 4x16GB, VIC1227, 16Gb FC, MDS9148s", "bundle", "servers-unified-computing"), "bundle");
check("a configured node without MDS is a server", ucsBundleKind("UCS-SP-B200M4-BA1", "UCS SPSelect B200M4 Adv1 w/2xE52690 v4, 8x32GB, VIC1340", "bundle", "servers-unified-computing"), "server");
check("NAME_OMITS_MODEL holds exactly the seven", Object.keys(NAME_OMITS_MODEL).length, 7);
check("a Fusion ioMemory card is a drive, not memory", ucsBundleKind("UCS-SP-FIO-3", "(Not Sold Standalone) 1000GB Fusion ioMemory3 PX for Rack M4", "bundle", "servers-unified-computing"), "drive");
check("THE SCOPE: a row the SKU axis did not call bundle is never read by name",
  partKind("servers-unified-computing", "UCSC-C220-M5SX", "UCS SP Select 5108 AC2 Chassis"), "server");

// ---- 4. class: an explicit (category, sku) list, the operator's reason strings -------------------------------
{
  const leaving = ref.parts.filter((r) => bundlePlanClass(r.sku, r.category));
  const by = (reason: string) => leaving.filter((r) => bundlePlanClass(r.sku, r.category)!.reason === reason).length;
  check("118 rows leave hardware: 31 software, 71 programme labels, 7 unsellable, 7 expired, 2 pallets",
    [leaving.length, by("bundle-plan:software-subscription"), by("programme-or-solution-label"), by("not-sellable:self-declared"), by("expired-promotion"), by("packaging-not-a-product")],
    [118, 31, 71, 7, 7, 2]);
  check("group 9 by SKU list: 19 of the 31 software rows were kind BUNDLE (a kind-name selector moves 12)",
    leaving.filter((r) => bundlePlanClass(r.sku, r.category)!.klass === "software" && r.kind_before === "bundle").length, 19);
  check("the seven held rows do not leave hardware", Object.keys(NAME_OMITS_MODEL).map((s) => bundlePlanClass(s, ref.parts.find((r) => r.sku === s)!.category)), [null, null, null, null, null, null, null]);
  check("classify() carries the reason", classify({ sku: "UCSW-SA-PALET", categorySlug: "servers-unified-computing", categoryIsHardware: true }), { klass: "non_product", reason: "packaging-not-a-product" });
  check("EXACT CATEGORY: the same SKU in another category is not selected", bundlePlanClass("UCSW-SA-PALET", "switches"), null);
  check("every reason is one reclassify owns (else it could never correct these rows again)",
    ["bundle-plan:software-subscription", "programme-or-solution-label", "not-sellable:self-declared", "expired-promotion", "packaging-not-a-product"].every(ownedReason), true);
}

// ---- 5. SABOTAGE: disable a load-bearing rule and the reference must go red, for that family --------------------
{
  const rules = BUNDLE_FAMILY_RULES as [BundleFamily, string, unknown][];
  for (const fam of ["dead-or-internal-only", "drive-memory-flash-component", "multi-device-bundle", "chassis-or-fabric-interconnect"] as BundleFamily[]) {
    const i = rules.findIndex(([f]) => f === fam);
    const [rule] = rules.splice(i, 1);
    const d = diffs(ref.parts).filter((r) => r.family === fam).length;
    rules.splice(i, 0, rule);
    check(`SABOTAGE removing the ${fam} rule turns its own rows red (${d})`, d > 0, true);
  }
  check("...and restored, the reference is green again", diffs(ref.parts).length, 0);
}

// ---- 6. reclassify --only-rule: a commit writes only what the operator approved ------------------------------------
// The Cisco dry run proposed 707 class changes; 125 were the plan's. An unscoped --commit would have applied the other
// 582 (rules registered on earlier days) under an approval that named none of them.
{
  const rows: PartRow[] = [
    { id: 1, sku: "UCSW-SA-PALET", vendor: "cisco", category: "servers-unified-computing", name: "UCSW Invicta Unracked Packing Pallet", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:servers-unified-computing" },
    { id: 2, sku: "L-ASA5506-SEC-PL=", vendor: "cisco", category: "security", name: "Cisco L-ASA5506-SEC-PL=", is_hardware: true, product_class: "hardware", product_class_reason: "category-is_hardware=true:security" },
  ];
  const full = plan(rows);
  const scoped = scopePlan(full, ["packaging-not-a-product"]);
  check("control: unscoped, both rows would change", full.changes.length, 2);
  check("scoped: only the pallet is written, the other is HELD and counted", [scoped.changes.map((c) => c.sku), Object.values(scoped.held_by_rule).reduce((a, b) => a + b, 0)], [["UCSW-SA-PALET"], 1]);
  let threw = "";
  try { scopePlan(full, ["expired-promotion"]); } catch (e) { threw = String(e); }
  check("SABOTAGE a scope that matches ZERO changes is refused, for that reason", /matches ZERO changes/.test(threw), true);
}

const TOTAL = 1 + 1 + 7 + 7 + 6 + 5 + 3;
console.log(`    bundle family: ${pass} passed, ${misses.length} missed (of ${TOTAL})`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length || pass !== TOTAL) process.exit(1);
