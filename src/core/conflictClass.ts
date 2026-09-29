// src/core/conflictClass.ts — the class of a conflict, from its two sides' evidence (reviewer ruling Q11, 29 Sep 2026).
//
// ONE function for the writer (store/facts.ts insertConflict), the backfill (scripts/classify-conflicts.mts) and the check's
// self-test (conflicts_classified), so a conflict is classed the same way whenever it is classed.
//
// THE PREMISE THAT HAD TO BE CORRECTED FIRST. The proposal behind the ruling read `doc_id` as a CONTENT hash ("same doc =
// same bytes") and called revision-drift a structural zero. It is sha1(URL) (db/migrations/0001_init.sql: `doc_id ...
// sha1(url)`, `url ... UNIQUE`; content is content_sha256), so one doc_id is one URL fetched at any number of revisions.
// Measured over the 15,983 open rows on 29 Sep: one URL + two cells 7,218 (1,322 from one fetch, 5,896 across fetches); one
// URL + one cell 835, of which 2 carry two different raw texts across fetches and 7 a different value from the SAME
// normaliser across fetches -- the cell's text changed, so 9 are revision-drift -- and 826 normaliser-split.
export const CONFLICT_CLASSES = ["source-disagreement", "same-doc-multicolumn", "normaliser-split", "revision-drift"] as const;
export type ConflictClass = (typeof CONFLICT_CLASSES)[number];

/** A side's evidence as conflicts.kept_evidence / rejected_evidence (and the writer's Prov) carry it. */
export type ConflictEvidence = { doc_id?: string | null; locator?: string | null; extracted_at?: string | null; norm_v?: string | null };

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** The class, or null when a side carries NO evidence object at all (the 53 Atlas-migrated rows): the caller must then read the
 *  facts' own provenance, never guess. */
export function conflictClass(kept: ConflictEvidence | null | undefined, rejected: ConflictEvidence | null | undefined,
  raws?: { kept_raw?: string | null; rejected_raw?: string | null }): ConflictClass | null {
  if (!kept || !rejected || typeof kept !== "object" || typeof rejected !== "object") return null;
  if (!kept.doc_id || !rejected.doc_id) return "source-disagreement";        // a side names no document (tier 0 / operator)
  if (kept.doc_id !== rejected.doc_id) return "source-disagreement";         // two URLs
  if (!same(kept.locator, rejected.locator)) return "same-doc-multicolumn";   // one URL, two cells
  // one URL, one cell: was the TEXT the same (read two ways) or did it change between fetches (revised)?
  const kr = raws?.kept_raw ?? null, rr = raws?.rejected_raw ?? null;
  const sameFetch = same(kept.extracted_at, rejected.extracted_at);
  if (kr !== null && rr !== null) return kr !== rr && !sameFetch ? "revision-drift" : "normaliser-split";
  // a raw missing (rows older than migration 0008): a different value from the SAME normaliser on a different fetch means the
  // text itself changed; any other one-cell pair is the normaliser (or a dual-unit cell) reading one text two ways
  return same(kept.norm_v, rejected.norm_v) && !sameFetch ? "revision-drift" : "normaliser-split";
}
