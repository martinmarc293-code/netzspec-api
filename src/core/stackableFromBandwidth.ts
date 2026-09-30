// src/core/stackableFromBandwidth.ts — reviewer ruling (B), 30 Sep 2026: "a stated stacking bandwidth > 0 derives stackable = yes
// for that sub-series, 'N/A' derives no -- registered derivation derived:stackable-from-bandwidth, witness the column header".
//
// WHERE THE STATEMENT LIVES. The Catalyst 9200 sheet prints a transposed comparison table: one ROW per sub-series, whose header
// names it by its SKU prefix -- "Fixed uplink Models (C9200L SKUs)" -- and one COLUMN per attribute, "Stacking Bandwidth Support":
// 80 Gbps for C9200L, 160 Gbps for C9200, "No" for C9200CX. The extractor reads the column header as the family scope and the row
// header as the label, so no alias rule can map the cell, and a scope naming a group is refused by apply-extract on purpose. This
// module reads exactly that shape: one header is a stacking-bandwidth header, the other names a sub-series "(<PREFIX> SKUs)", and
// the value is a bandwidth or an explicit no. A group the header QUALIFIES ("C9200 Enhanced VN SKUs") names no prefix and is
// refused: which C9200 SKUs are "Enhanced VN" is not something a prefix can say.
//
// The replay (src/core/derivedReplay.ts) is stackableFromBandwidth over the raw, whose last " | " segment is the stated cell.

/** "Stacking Bandwidth Support", "Stacking bandwidth", "Max Stacking Bandwidth" -- a header that states the bandwidth, nothing else */
export const STACK_HEADER = /^(?:max(?:imum)?\s+)?stack(?:ing)?\s+bandwidth(?:\s+support)?$/i;

const squash = (s: string) => s.replace(/[\s\u00a0]+/g, " ").trim();

/** The SKU prefix a sub-series header names: "Fixed uplink Models (C9200L SKUs)" -> "C9200L"; anything else (a qualified group,
 *  a group with no prefix, a prefix with no digit) -> null. */
export function groupPrefix(header: string): string | null {
  const m = /\(([A-Z][A-Z0-9]{2,11})\s+SKUs\)$/.exec(squash(header));
  return m && /\d/.test(m[1]) ? m[1] : null;
}

/** The derivation: a stated bandwidth above zero -> true; an explicit "No" / "N/A" / "None" / "Not supported" -> false; anything
 *  else -> null (a range, a capability, an "up to", a footnote: refused, never guessed). Reads the LAST " | " segment of a raw. */
export function stackableFromBandwidth(raw: string): boolean | null {
  const v = squash(raw.split(" | ").pop() ?? "");
  const g = /^(\d+(?:\.\d+)?)\s*Gbps$/i.exec(v);
  if (g) return Number(g[1]) > 0 ? true : null;
  if (/^(?:no|n\/a|none|not supported)$/i.test(v)) return false;
  return null;
}

/** One witness cell: which header is the sub-series and which the bandwidth, whatever way round the extractor filed them. */
export function readWitnessCell(label: string, scope: string | null | undefined, value: string):
  { ok: true; prefix: string; rowHeader: string; columnHeader: string; value: string; stackable: boolean }
  | { ok: false; why: string } | null {
  const l = squash(label), s = squash(scope ?? "");
  const [row, col] = STACK_HEADER.test(s) ? [l, s] : STACK_HEADER.test(l) ? [s, l] : [null, null];
  if (row === null || col === null) return null;                       // not a stacking-bandwidth cell at all
  if (!/\bSKUs\)$/.test(row)) return null;                              // a per-model or document-level cell: not this shape
  const prefix = groupPrefix(row);
  if (!prefix) return { ok: false, why: `the row header "${row}" names no SKU prefix (a qualified group)` };
  const st = stackableFromBandwidth(value);
  if (st === null) return { ok: false, why: `"${squash(value)}" is neither a bandwidth above zero nor an explicit no` };
  return { ok: true, prefix, rowHeader: row, columnHeader: col, value: squash(value), stackable: st };
}
