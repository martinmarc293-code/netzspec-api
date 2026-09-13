// src/core/linkBasis.ts — WHY a spec-bearing document is linked to a part (kind layer, operator ruling 2, 13 Sep 2026).
//
// `doc_parts` recorded THAT a document mentions a part, never WHY. The printed-on-the-page cup bar measured over every
// linked document therefore counted pages that are not about the part: an SRTP/CUBE voice-encryption sheet linked to 38
// branch routers, an LTE module table linked to 28. Those pages print none of the routers' rows and pulled every share
// down. The basis is materialised as `doc_parts.link_basis` by a recorded run; this module is the ONE definition both
// that run and every measurement use.
//
//   explicit  the part's normalised SKU, or its base PID, appears on the document (in the extractor's per-SKU records or
//             in the page text) as a whole token;
//   family    the document carries family-scope extraction records AND a model/series token of the part appears in the
//             document's title or a table header AND the document prints >= 3 labels that map into the part's kind cups;
//   inferred  everything else — out of the cup bar, out of `held`, reported as a linking defect.
//
// Normalisation (operator's wording, nothing more): case-insensitive, trailing "=" stripped, whitespace collapsed. The
// base PID additionally drops a "/K9" and a trailing option suffix ("+", "++"). No other stripping.

export type LinkBasis = "explicit" | "family" | "inferred";

export function normSku(sku: string): string {
  return sku.toUpperCase().replace(/\s+/g, " ").trim().replace(/=+$/, "");
}

/** Full SKU minus "/K9" and a trailing "+"/"++" option suffix. Returns null when nothing was removed. */
export function basePid(sku: string): string | null {
  const n = normSku(sku);
  const b = n.replace(/\/K9$/, "").replace(/\++$/, "");
  return b !== n && b.length >= 3 ? b : null;
}

const TOKEN_CHAR = /[A-Z0-9-]/; // a hyphen continues a SKU: C1111-8P must not match inside C1111-8P-E

/** True when `needle` occurs in `hay` (both upper-cased) with no letter or digit touching either end. */
export function containsToken(hay: string, needle: string): boolean {
  if (!needle) return false;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const before = i === 0 ? "" : hay[i - 1];
    const after = hay[i + needle.length] ?? "";
    if (!(before && TOKEN_CHAR.test(before)) && !(after && TOKEN_CHAR.test(after))) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

/**
 * Model/series tokens of a part: digit-bearing words of its series label ("4000 ISR" -> 4000) and the model token of
 * its SKU (the leading run of letters+digits before the first separator: "C8300-1N1S-4T2X" -> C8300 and 8300,
 * "ISR4331/K9" -> ISR4331 and 4331). A token without a digit is too generic ("ISR", "Catalyst") and is never used.
 */
export function modelTokens(sku: string, series: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const w of (series ?? "").toUpperCase().split(/[^A-Z0-9]+/)) if (/[0-9]/.test(w) && w.length >= 3) out.add(w);
  const head = normSku(sku).split(/[-/ ]/)[0] ?? "";
  if (/[0-9]/.test(head) && head.length >= 3) {
    out.add(head);
    const digits = head.replace(/^[A-Z]+/, "");
    if (/^[0-9]{3,}/.test(digits)) out.add(digits);
  }
  return [...out];
}

export type DocEvidence = {
  /** upper-cased visible text of the page (HTML) — empty for a document whose text is not held */
  text: string;
  /** SKUs the extractor emitted per-SKU records for */
  skuRecords: readonly string[];
  /** the extractor emitted family-scope records */
  familyRecords: boolean;
  title: string;
  headers: readonly string[];
  /** every label on the document (row labels and column headers) */
  labels: readonly string[];
};

export type LinkDecision = { basis: LinkBasis; evidence: string };

/**
 * Decide the basis of one (document, part) link. `mapsToKindCup(label)` answers whether a label maps (with today's
 * mapper, in the part's category) to one of the cups the part's kind is asked — the caller supplies it so this module
 * stays free of the mapper and the profiles.
 */
export function linkBasisFor(
  part: { sku: string; series?: string | null },
  doc: DocEvidence,
  mapsToKindCup: (label: string) => boolean,
): LinkDecision {
  const full = normSku(part.sku);
  const base = basePid(part.sku);
  const recs = doc.skuRecords.map(normSku);
  if (recs.includes(full)) return { basis: "explicit", evidence: `sku record ${full}` };
  if (base && recs.includes(base)) return { basis: "explicit", evidence: `sku record ${base} (base PID)` };
  const text = doc.text.toUpperCase().replace(/\s+/g, " ");
  if (containsToken(text, full)) return { basis: "explicit", evidence: `sku on page ${full}` };
  if (base && containsToken(text, base)) return { basis: "explicit", evidence: `sku on page ${base} (base PID)` };

  if (doc.familyRecords) {
    const where = [doc.title, ...doc.headers].join(" | ").toUpperCase();
    const tok = modelTokens(part.sku, part.series).find((t) => containsToken(where, t));
    if (tok) {
      const mapped = new Set(doc.labels.filter(mapsToKindCup));
      if (mapped.size >= 3) return { basis: "family", evidence: `family records; token ${tok} in title/header; ${mapped.size} kind-cup labels` };
      return { basis: "inferred", evidence: `family records and token ${tok}, but only ${mapped.size} kind-cup label(s)` };
    }
    return { basis: "inferred", evidence: "family records, no model/series token in title or table header" };
  }
  return { basis: "inferred", evidence: "no SKU on the page, no family-scope records" };
}
