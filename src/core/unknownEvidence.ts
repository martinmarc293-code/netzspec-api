// src/core/unknownEvidence.ts — unknown_zero's population split by EVIDENCE (reviewer ruling Q9 (3), 29 Sep 2026).
//
// A live hardware part in kind `unknown` is asked nothing, so it scores perfectly and leaves the denominator: the check is red
// on every one. Q9 split them in two, because they need different work:
//   EVIDENCED     a document links the part, or its name says something beyond its SKU -- someone can classify it NOW, from
//                 that evidence (Q9 (2): read row by row), so the check stays red until these reach 0;
//   NO EVIDENCE   the name is only the SKU AND no document links it: any kind given it is a guess. They are counted APART as
//                 their own term in the partition line and on the acquisition queue (they need a document before anyone can
//                 classify them), and their count is a RATCHET that may not grow (data/ratchets/unknown-no-evidence-cisco.json).
// One definition, shared by the check (scripts/mould-verify.mts unknown_zero), its self-test and the completeness report's
// acquisition queue (scripts/build-completeness.mts), so the three can never count two different populations.
import { nameIsJustTheSku } from "./nameMarker.js";

/** Live hardware parts of vendor $1 with no kind or kind unknown, each with whether ANY document links it. */
export const UNKNOWN_HARDWARE_SQL = `
  SELECT p.sku, p.name, c.slug AS category, EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.part_id = p.id) AS linked
    FROM parts p JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware' AND (p.sku_kind IS NULL OR p.sku_kind = 'unknown')
   ORDER BY c.slug, p.sku`;

export type UnknownRow = { sku: string; name: string | null; category: string; linked: boolean };

/** No evidence = the name says nothing beyond the SKU AND no document links the part. Everything else is evidenced. */
export function hasNoEvidence(r: UnknownRow): boolean {
  return !r.linked && nameIsJustTheSku(r.sku, r.name ?? "");
}

export function splitUnknown(rows: readonly UnknownRow[]): { evidenced: UnknownRow[]; noEvidence: UnknownRow[] } {
  const evidenced: UnknownRow[] = [], noEvidence: UnknownRow[] = [];
  for (const r of rows) (hasNoEvidence(r) ? noEvidence : evidenced).push(r);
  return { evidenced, noEvidence };
}

/** The ruling as a verdict: red while ANY evidenced unknown remains, while a kind is asked nothing, or when the no-evidence
 *  count has grown past its ceiling (a missing ceiling is red: a ratchet nobody recorded is not a ratchet). */
export function unknownZeroVerdict(o: { evidenced: number; noEvidence: number; ceiling: number | null; askedNothing: number }):
  { pass: boolean; fails: string[] } {
  const fails: string[] = [];
  if (o.evidenced > 0) fails.push(`${o.evidenced} EVIDENCED unknown hardware parts (a document or a real name says what they are)`);
  if (o.askedNothing > 0) fails.push(`${o.askedNothing} (category, kind) pairs asked nothing`);
  if (o.ceiling === null) fails.push("no readable no-evidence ceiling");
  else if (o.noEvidence > o.ceiling) fails.push(`the no-evidence count GREW: ${o.noEvidence} > ceiling ${o.ceiling}`);
  return { pass: fails.length === 0, fails };
}
