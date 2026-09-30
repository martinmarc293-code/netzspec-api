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
import { parseLayerRows, layerOf, layerIndexSize, hasLineFile, layerRowsPath, resetLayerIndexCache, familyLayer } from "../src/api/queries/layerIndex.js";
import { NO_FAMILY, SHARED_PARTS, SHARED_ACROSS_LINE } from "../src/core/productLine.js";

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
  // FORMAT CHANGE ddfe2f8 (27 Sep 2026): the "… shared parts" navigation construct split out of `series` into `nav_bucket` --
  // it must never enter a product column. So a shared row's SERIES is empty and its NAV_BUCKET carries the construct; both are
  // asserted, over every shared row, so the old shape (the construct back in series) fails too.
  const navOk = shared.filter((p) => p.nav_bucket === SHARED_PARTS(p.product_line) && p.series === "").length;
  check(`…and every such row carries its line's shared-parts bucket in nav_bucket, never in series (${navOk} of ${shared.length})`, shared.length > 0 && navOk === shared.length);
}

// ---- SABOTAGE: the refusals, each for its stated reason ---------------------------------------------------------
const GOOD = ["sku\tplacement\tproduct_line\tproduct_family\tseries",
  "C1\tlayered\tCatalyst\tCatalyst 9000\tCatalyst 9400"].join("\n");
check("CONTROL the fixture parses and places its one row", (() => {
  const i = parseLayerRows(GOOD); return i !== null && i.size === 1 && i.get("C1")?.product_line === "Catalyst"; })());

check("SABOTAGE a header missing product_family makes the whole file REFUSE (null), never read by position",
  parseLayerRows(["sku\tplacement\tproduct_line\tseries", "C1\tlayered\tCatalyst\tCatalyst 9400"].join("\n")) === null);
check("SABOTAGE a header missing product_line refuses too",
  parseLayerRows(["sku\tplacement\tproduct_family\tseries", "C1\tlayered\tCatalyst 9000\tCatalyst 9400"].join("\n")) === null);
check("SABOTAGE columns REORDERED are still read by NAME, not by offset", (() => {
  const i = parseLayerRows(["series\tproduct_family\tproduct_line\tplacement\tsku",
    "Catalyst 9400\tCatalyst 9000\tCatalyst\tlayered\tC1"].join("\n"));
  return i?.get("C1")?.product_line === "Catalyst" && i?.get("C1")?.series === "Catalyst 9400"; })());
check("SABOTAGE a row whose placement is not `layered` is NOT placed", (() => {
  const i = parseLayerRows(["sku\tplacement\tproduct_line\tproduct_family\tseries",
    "C1\tunplaced\tCatalyst\tCatalyst 9000\tCatalyst 9400"].join("\n"));
  return i !== null && i.size === 0; })());
check("SABOTAGE a layered row with an EMPTY product_line is not placed (a blank is not a line)", (() => {
  const i = parseLayerRows(["sku\tplacement\tproduct_line\tproduct_family\tseries", "C1\tlayered\t\t(none)\tX"].join("\n"));
  return i !== null && i.size === 0; })());
check("a CRLF file does not put a stray carriage return in the last column", (() => {
  const i = parseLayerRows(GOOD.replace(/\n/g, "\r\n"));
  return i?.get("C1")?.series === "Catalyst 9400"; })());
check("an EMPTY index and a REFUSAL are different answers (size 0 vs null)",
  parseLayerRows("sku\tplacement\tproduct_line\tproduct_family\tseries")?.size === 0
  && parseLayerRows("nothing\tuseful") === null);

// ---- LAYER 3 MUST NEVER REACH A CONSUMER AS A MARKER (27 Sep 2026) -----------------------------------------------
// The operator read a part record and said layer 2 was wrong and layer 3 was not there. Layer 2 was right; the
// record served `product_family: "(none)"` — the artifact's own sentinel — on 3,993 switches and 3,975 routers, so a
// shop tree or a JTL attribute would have printed "(none)" as the family name. null plus a STATE keeps the
// distinction the 17 Sep review asked for (null must not read as *undecided*) without exporting a sentinel.
const fl = (product_family: string) => familyLayer({ product_line: "Catalyst", product_family, series: "Catalyst 9300", nav_bucket: null });
check(`"${NO_FAMILY}" resolves to null with a state saying Cisco names no family`,
  fl(NO_FAMILY).product_family === null && fl(NO_FAMILY).product_family_state === "no_family_named", JSON.stringify(fl(NO_FAMILY)));
check(`"${SHARED_ACROSS_LINE}" resolves to null with its own state, NOT the same state as no-family`,
  fl(SHARED_ACROSS_LINE).product_family === null && fl(SHARED_ACROSS_LINE).product_family_state === "shared_across_line"
  && fl(SHARED_ACROSS_LINE).product_family_state !== fl(NO_FAMILY).product_family_state, JSON.stringify(fl(SHARED_ACROSS_LINE)));
check(`a real family passes through with state "named"`,
  fl("Catalyst 9000").product_family === "Catalyst 9000" && fl("Catalyst 9000").product_family_state === "named");
check(`no state ever returns a string starting with "(" — the shape that leaked`,
  [NO_FAMILY, SHARED_ACROSS_LINE, "Catalyst 9000"].every((v) => !/^\(/.test(fl(v).product_family ?? "")));
// CONTROL: the markers are the ARTIFACT'S, taken from productLine.ts and asserted against the real file, so these
// cases cannot pass by testing strings the build never writes.
{
  const txt = fs.readFileSync(layerRowsPath("cisco", "switches"), "utf8");
  check(`CONTROL the live switches artifact really does contain both markers`,
    txt.includes(`\t${NO_FAMILY}\t`) && txt.includes(`\t${SHARED_ACROSS_LINE}\t`));
  check(`CONTROL the exported markers equal productLine.ts's, not a second copy`,
    SHARED_PARTS("Catalyst") === "Catalyst shared parts" && SHARED_ACROSS_LINE !== SHARED_PARTS("Catalyst"));
}

console.log(misses.join("\n"));
console.log(`    layer index: ${pass} passed, ${misses.length} missed (6 sabotage cases, 3 controls, 6 layer-3 marker cases)`);
if (misses.length) process.exit(1);
