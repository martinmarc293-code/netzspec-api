// tests/layerIndex.test.ts — layers 2 and 3, served per part.
//
// AUDIT 6 (26 Sep 2026): `PartRecord` carried layer 1 (category) and layer 4 (series) and nothing between, while the
// field named `family` holds the MODEL — below layer 4, and the SKU verbatim on 56,887 of 86,934 live parts. A shop's
// category tree is line → family → series, so two of its four levels were unreachable.
//
// WHAT THIS DEFENDS, and why each case is here rather than being a snapshot:
//   * the markers PASS THROUGH. "(none)" and "(shared across the line)" are deliberate explicit strings, because the
//     review of 17 Sep 2026 read `product_family: null` as *undecided* (productLine.NO_FAMILY). Converting either to
//     null would re-create that exact misreading, so a case pins each one.
//   * a header whose columns MOVED must make the module refuse, not read by position. That is the sabotage: a
//     plausible wrong product line on every part is worse than no product line, and nothing downstream could tell.
//   * a row that is not `layered` is not placed. The layering's own bucket decides; this module may not invent one.
//   * null has two causes a consumer cannot tell apart (no line file for that vendor; not a row in the artifact) and
//     the CONTROL is what stops that null being read as "the index is broken" — cisco resolves, hpe does not.
import fs from "node:fs";
import { parseLayerRows, layerOf, layerIndexSize, hasLineFile, layerRowsPath, resetLayerIndexCache } from "../src/api/queries/layerIndex.js";
import { NO_FAMILY, SHARED_PARTS } from "../src/core/productLine.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) pass++; else misses.push(`    MISS ${name}${detail === "" ? "" : " — " + JSON.stringify(detail)}`);
};
resetLayerIndexCache();

// ---- the real committed artifact, at the consumer's level -------------------------------------------------------
check("the cisco/switches artifact exists and is non-empty (CONTROL: every null below is meaningful only if so)",
  (layerIndexSize("cisco", "switches") ?? 0) > 5000, layerIndexSize("cisco", "switches"));
const c9404 = layerOf("cisco", "switches", "C9404R");
check("a part under a NAMED layer-3 family resolves all three levels",
  c9404?.product_line === "Catalyst" && c9404?.product_family === "Catalyst 9000" && c9404?.series === "Catalyst 9400", c9404);
check("the SKU lookup is case-insensitive (a caller may hold either casing)",
  JSON.stringify(layerOf("cisco", "switches", "c9404r")) === JSON.stringify(c9404), layerOf("cisco", "switches", "c9404r"));
const glc = layerOf("cisco", "transceiver", "GLC-TE");
check(`a series whose line names no family keeps the explicit marker ${JSON.stringify(NO_FAMILY)}, never null`,
  glc?.product_family === NO_FAMILY && !!glc?.product_line, glc);
check("a part that is not in the artifact is null, not an invented placement",
  layerOf("cisco", "switches", "NO-SUCH-SKU-XYZ") === null);
check("CONTROL a vendor with no line file resolves to null and reports no index",
  layerOf("hpe", "switches", "JL256A") === null && layerIndexSize("hpe", "switches") === null && hasLineFile("hpe", "switches") === false);
check("CONTROL cisco/switches HAS a line file (so the two nulls above are about hpe, not about the reader)",
  hasLineFile("cisco", "switches") === true);

// The shared-parts marker must survive too — it is a real value for a line's generic accessories.
{
  const text = fs.readFileSync(layerRowsPath("cisco", "switches"), "utf8");
  const idx = parseLayerRows(text)!;
  const shared = [...idx.values()].filter((p) => p.product_family === "(shared across the line)");
  check(`the shared-parts marker passes through unchanged (${shared.length} rows in cisco/switches)`, shared.length > 0);
  const anySharedSeries = [...idx.values()].some((p) => p.series === SHARED_PARTS(p.product_line));
  check("…and such a row's series is its line's shared-parts series", anySharedSeries);
}

// ---- SABOTAGE: the refusals, each for its stated reason ---------------------------------------------------------
const GOOD = ["sku\tbucket\tproduct_line\tproduct_family\tseries",
  "C1\tlayered\tCatalyst\tCatalyst 9000\tCatalyst 9400"].join("\n");
check("CONTROL the fixture parses and places its one row", (() => {
  const i = parseLayerRows(GOOD); return i !== null && i.size === 1 && i.get("C1")?.product_line === "Catalyst"; })());

check("SABOTAGE a header missing product_family makes the whole file REFUSE (null), never read by position",
  parseLayerRows(["sku\tbucket\tproduct_line\tseries", "C1\tlayered\tCatalyst\tCatalyst 9400"].join("\n")) === null);
check("SABOTAGE a header missing product_line refuses too",
  parseLayerRows(["sku\tbucket\tproduct_family\tseries", "C1\tlayered\tCatalyst 9000\tCatalyst 9400"].join("\n")) === null);
check("SABOTAGE columns REORDERED are still read by NAME, not by offset", (() => {
  const i = parseLayerRows(["series\tproduct_family\tproduct_line\tbucket\tsku",
    "Catalyst 9400\tCatalyst 9000\tCatalyst\tlayered\tC1"].join("\n"));
  return i?.get("C1")?.product_line === "Catalyst" && i?.get("C1")?.series === "Catalyst 9400"; })());
check("SABOTAGE a row whose bucket is not `layered` is NOT placed", (() => {
  const i = parseLayerRows(["sku\tbucket\tproduct_line\tproduct_family\tseries",
    "C1\tunplaced\tCatalyst\tCatalyst 9000\tCatalyst 9400"].join("\n"));
  return i !== null && i.size === 0; })());
check("SABOTAGE a layered row with an EMPTY product_line is not placed (a blank is not a line)", (() => {
  const i = parseLayerRows(["sku\tbucket\tproduct_line\tproduct_family\tseries", "C1\tlayered\t\t(none)\tX"].join("\n"));
  return i !== null && i.size === 0; })());
check("a CRLF file does not put a stray carriage return in the last column", (() => {
  const i = parseLayerRows(GOOD.replace(/\n/g, "\r\n"));
  return i?.get("C1")?.series === "Catalyst 9400"; })());
check("an EMPTY index and a REFUSAL are different answers (size 0 vs null)",
  parseLayerRows("sku\tbucket\tproduct_line\tproduct_family\tseries")?.size === 0
  && parseLayerRows("nothing\tuseful") === null);

console.log(misses.join("\n"));
console.log(`    layer index: ${pass} passed, ${misses.length} missed (6 sabotage cases, 3 controls)`);
if (misses.length) process.exit(1);
