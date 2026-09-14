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
  ["CAB-ACU", "AC Power Cord (UK)", "2960", "Catalyst", "Catalyst 2960"],                                          // no family token: label
  ["CAB-TA-DN=", "AC power cord for Cisco Catalyst 2960-XR (Denmark)", "Catalyst 9300", "Catalyst", "Catalyst 2960-X and 2960-XR"], // name beats label
  ["CBS350-24P-4G-EU", "CBS350 Managed 24-port GE, PoE", "Business 350", "Cisco Business", "Business 350 Managed"],
  ["SG350X-24MP-K9-CN", "SG350X-24MP Stackable", "350X Stackable Managed", "Cisco Business", "Business 350X Stackable"],
  ["MS390-24", "Cisco MS390-24", "MS390", "Meraki MS", "MS390"],
  ["DS-C9148V-24EK9", "Cisco MDS 9148V 64G Fibre-Channel-Switch", "MDS V", "(not this category)", "storage-networking"],
  ["7600-ES+2TG3C", "Cisco 7600 Series ES+ Line Card", "Catalyst 6500", "(not this category)", "routers"],
]);

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
  check("SABOTAGE: listing Catalyst 4500-E before 4500-X misplaces a 4500-X SKU (rule order is load-bearing)", got?.series === "Catalyst 4500-E", `got ${got?.series}`);
}

console.log(`    product lines: ${pass} passed, ${misses.length} missed (${files.length} mapping files)`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);
