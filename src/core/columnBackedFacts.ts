// src/core/columnBackedFacts.ts — is a fact under a COLUMN-backed key a duplicate of its column?
//
// `column_backed_never_facts` reports 7,142 live facts under keys that are columns (`vendor` 3,866,
// `series` 3,276). The rule behind it is right — a cup means one thing and the column is the survivor —
// and a blanket retraction is not. Read against the columns rather than counted, the 7,142 are four
// different situations and only two of them are duplicates:
//
//   vendor-duplicate    3,866  every one `hexcat_seed`, every one EQUAL to parts.vendor, none inherited
//   series-duplicate    1,290  equal to parts.series once "Cisco" and a trailing Switches/Series are dropped
//   series-finer        1,258  the FACT is finer: "MDS 9300" against a column reading "MDS 9000 NX-OS and
//                              SAN-OS Software". That value is layer 4 (product_series), not the platform
//                              axis, so it is EXPORTED to the layer build rather than deleted.
//   series-only-source    728  BOTH parts.series and parts.product_series are null. The fact is the only
//                              series that part has, so retracting it deletes the information outright.
//
// THE COMPARISON HAS TO ASK BOTH COLUMNS OR IT MEANS NOTHING. `parts.series` is the PLATFORM axis and
// `product_series` is layer 4 (N59, reclassified) — two different concepts — so a `series` fact compared
// against only one of them is compared against the wrong thing half the time. Asked of both: 1,290 match
// parts.series normalised and ZERO match product_series, because product_series is null on every one of
// these parts. That zero is not a finding about the facts; it is layer 4 not having reached them.
//
// The classifier lives here, and not inside the retraction script, so the script's GATE can re-run the
// real predicate over a random sample and so the sabotage cases can reach it. A retraction whose rule is
// only expressible inside the thing doing the deleting has no rule anyone can test.

/** the two keys that are columns on `parts` and must never hold a fact */
export const COLUMN_BACKED_KEYS = ["vendor", "series"] as const;
export type ColumnBackedKey = (typeof COLUMN_BACKED_KEYS)[number];

/**
 * One stored value reduced to what two spellings of the same series share.
 *
 * "Cisco Catalyst 9200" and "Catalyst 9200" are one series written twice, and so are "Cisco 3750
 * Switches" and "3750". The vendor word and a trailing category noun are the two things the fact
 * carries and the column does not; nothing else is stripped, because every further rule is a chance to
 * call two DIFFERENT series equal, and this function decides what gets deleted.
 */
export const normaliseSeries = (s: string | null | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/^cisco\s+/, "")
    .replace(/\s+(switches|series)$/i, "")
    .replace(/\s+/g, " ")
    .trim();

export type ColumnBackedRow = {
  key: ColumnBackedKey;
  /** the fact's stored value */
  value: string | null;
  /** parts.vendor's slug */
  vendorSlug: string | null;
  /** parts.series — the PLATFORM axis */
  series: string | null;
  /** parts.product_series — layer 4 */
  productSeries: string | null;
};

export type ColumnBackedBucket =
  | "vendor-duplicate"      // retract: the column says the same thing
  | "vendor-differs"        // NOT retracted: a fact disagreeing with parts.vendor is a brand question
  | "series-duplicate"      // retract: a column says the same thing once normalised
  | "series-finer"          // NOT retracted: export to the layer build as a product_series hint
  | "series-only-source";   // NOT retracted: both columns are null, so this is the only copy

export type ColumnBackedVerdict = { bucket: ColumnBackedBucket; retract: boolean; why: string };

/**
 * Which of the four situations a row is in, and whether the fact may be retracted.
 *
 * ONLY A DUPLICATE IS RETRACTABLE. The other three each lose information: `series-only-source` deletes
 * the only series a part has, `series-finer` deletes a layer-4 value nothing else holds yet, and
 * `vendor-differs` would quietly resolve a brand disagreement by deleting one side of it — which is the
 * `CRS312-4C+8XG-RM` case, a MikroTik SKU whose fact says "MikroTik Switches" while its vendor column
 * says cisco. That is a brand leak to report, never a fact to delete.
 */
export function classifyColumnBacked(r: ColumnBackedRow): ColumnBackedVerdict {
  if (r.key === "vendor") {
    const same = normaliseSeries(r.value) === normaliseSeries(r.vendorSlug);
    return same
      ? { bucket: "vendor-duplicate", retract: true, why: "equal to parts.vendor" }
      : { bucket: "vendor-differs", retract: false, why: "disagrees with parts.vendor — a brand question, not a duplicate" };
  }
  const v = normaliseSeries(r.value);
  if (v.length > 0 && (v === normaliseSeries(r.series) || v === normaliseSeries(r.productSeries)))
    return { bucket: "series-duplicate", retract: true, why: "equal to parts.series or parts.product_series once normalised" };
  // The column is the same series with words appended ("MDS 9100" / "MDS 9100 Series Multilayer Fabric"): the fact adds
  // nothing the column lacks. A remainder starting with a digit is a FINER column ("Catalyst" / "Catalyst 9300"), not
  // the same series, and stays. Decision 2026-09-28-series-hints-decomposed: 95 + 7 of this shape.
  const prefixOf = (col: string | null | undefined) => {
    const c = normaliseSeries(col);
    return v.length > 0 && c.startsWith(v + " ") && !/^[0-9]/.test(c.slice(v.length + 1));
  };
  if (prefixOf(r.series) || prefixOf(r.productSeries))
    return { bucket: "series-prefix-duplicate", retract: true, why: "a word-prefix of parts.series or parts.product_series" };
  if (!r.series && !r.productSeries)
    return { bucket: "series-only-source", retract: false, why: "both series columns are null — this fact is the only copy" };
  return { bucket: "series-finer", retract: false, why: "differs from both columns — a product_series hint for the layer build" };
}
