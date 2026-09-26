// src/api/queries/layerIndex.ts — layers 2 and 3 of the hierarchy, served per part.
//
// AUDIT 6 (26 Sep 2026) measured what a consumer could see of the layer model the code states in one line
// (`productLine.layerModel`): "1 category -> 2 product line -> 3 family (only where Cisco names one) -> 4 series".
// `PartRecord` carried layer 1 and layer 4 and nothing between them — and the field named `family` holds the MODEL
// since the 8 Sep migration, which sits BELOW layer 4 and is the SKU verbatim on 56,887 of 86,934 live parts. So a
// consumer building a shop's category tree (line -> family -> series) had two of its four levels missing and one
// field wearing the name of a level it does not hold.
//
// IT READS THE BUILT ARTIFACT, NOT THE RULES. `data/layers/<vendor>-<category>.rows.tsv` is what
// scripts/build-layers.mts already committed, one row per part, carrying product_line / product_family / series /
// bucket. Resolving placement from the line FILES here would be a second implementation of `placeWithSpareRule` —
// the mistake this repo has paid for twice ("do not re-implement the thing you are auditing") — and the two copies
// would drift the first time a rule changed. Reading the artifact makes the API and the layer pages agree by
// construction, and a stale artifact shows up as a stale answer rather than as a disagreement.
//
// THE MARKERS ARE THE ARTIFACT'S, PASSED THROUGH UNCHANGED. `product_family` is "(none)" where the series' line
// names no family and "(shared across the line)" for a line's shared accessories — explicit strings, never null,
// because the review of 17 Sep 2026 read `product_family: null` as *undecided* (src/core/productLine.ts NO_FAMILY).
// null here means something different and narrower: THIS PART IS NOT IN THE LAYER ARTIFACT AT ALL.
import fs from "node:fs";
import { lineFilePath } from "../../core/productLine.js";
import path from "node:path";
import { REPO_ROOT } from "../../config.js";

export type LayerPlacement = {
  /** layer 2 — the product line, e.g. "Catalyst". */
  product_line: string;
  /** layer 3 — "(none)" where the line names no family, "(shared across the line)" for a line's shared parts. */
  product_family: string;
  /** layer 4 as the ARTIFACT recorded it; `parts.series` is the same value and is what the record already serves. */
  series: string;
};

const LAYER_DIR = path.join(REPO_ROOT, "data", "layers");
export const layerRowsPath = (vendor: string, category: string) => path.join(LAYER_DIR, `${vendor}-${category}.rows.tsv`);

/** null = the file does not exist for this (vendor, category) — a different fact from a part missing from it. */
type Index = Map<string, LayerPlacement> | null;
const cache = new Map<string, Index>();

/** Tests write fixtures; let them be seen. */
export function resetLayerIndexCache(): void { cache.clear(); }

/**
 * The whole decision, as a pure function of the file's text, so its refusals can be sabotaged without planting a
 * fixture in `data/layers/`. Returns null when the text is not an artifact this module can read — which is a
 * different answer from an empty index, and the caller must keep them apart.
 */
export function parseLayerRows(text: string): Map<string, LayerPlacement> | null {
  // LF the moment it is read: the repo is LF in git and CRLF in the working tree, and a trailing \r would end up
  // inside the last column of every row (and this file's last column is one a consumer would see).
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const head = (lines[0] ?? "").split("\t");
  const ci = { sku: head.indexOf("sku"), line: head.indexOf("product_line"), fam: head.indexOf("product_family"), ser: head.indexOf("series"), bucket: head.indexOf("bucket") };
  // A COLUMN THAT MOVED MUST NOT BE READ BY POSITION. If the header does not carry these names the artifact's
  // shape has changed, and answering from guessed offsets would serve a plausible wrong line for every part.
  if (ci.sku < 0 || ci.line < 0 || ci.fam < 0 || ci.ser < 0) return null;
  const idx = new Map<string, LayerPlacement>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split("\t");
    const sku = f[ci.sku];
    if (!sku) continue;
    // Only a LAYERED row states a line. Any other bucket is a row the layering did not place, and this module
    // must not invent one for it.
    if (ci.bucket >= 0 && f[ci.bucket] !== "layered") continue;
    const product_line = f[ci.line] ?? "", product_family = f[ci.fam] ?? "", series = f[ci.ser] ?? "";
    if (!product_line) continue;
    idx.set(sku.toUpperCase(), { product_line, product_family, series });
  }
  return idx;
}

function load(vendor: string, category: string): Index {
  const ck = `${vendor}/${category}`;
  if (cache.has(ck)) return cache.get(ck)!;
  const file = layerRowsPath(vendor, category);
  const idx: Index = fs.existsSync(file) ? parseLayerRows(fs.readFileSync(file, "utf8")) : null;
  cache.set(ck, idx);
  return idx;
}

/**
 * Layers 2 and 3 for one part, or null when the layering does not place it.
 *
 * null happens for two reasons a consumer cannot tell apart and does not need to: no line file exists for that
 * (vendor, category) — only cisco has them today — or the part is not a row in the artifact. The artifact holds
 * cisco's 41,067 live HARDWARE parts; a licence or a software row has no place in a hardware tree and gets null.
 */
export function layerOf(vendor: string, category: string, sku: string): LayerPlacement | null {
  const idx = load(vendor, category);
  return idx ? idx.get(sku.toUpperCase()) ?? null : null;
}

/** Does a line file exist for this (vendor, category)? Lets a caller say WHY a placement is absent. */
export function hasLineFile(vendor: string, category: string): boolean {
  return fs.existsSync(lineFilePath(vendor, category));
}

/** Rows the artifact places, per (vendor, category) — for the audit that asserts coverage rather than assuming it. */
export function layerIndexSize(vendor: string, category: string): number | null {
  const idx = load(vendor, category);
  return idx ? idx.size : null;
}
