// src/core/heldEvidence.ts — WHAT "HELD" MEANS, once, for the ledger builder, the completeness report and every test that
// judges them (operator ruling, 13 Sep 2026, on the link-provenance contract of migration 0018).
//
// Until this ruling a part was HELD when ANY document of a spec-bearing doc_type was linked to it through doc_parts. That
// counted an SRTP/CUBE voice-encryption sheet as the specification of 38 branch routers and an LTE module table as that
// of 28: pages that name a part and print none of its rows. The link now says why it exists:
//
//   doc_parts.link_basis     explicit | family | inferred        how the link was made (src/core/linkBasis.ts)
//   doc_parts.doc_relevance  spec_for_kind | mention             spec_for_kind = spec-bearing AND prints >= 3 distinct
//                                                                cups of the part's kind
//   doc_parts.link_evidence  one line saying why
//   NULL on both                                                 not derived yet
//
// HELD = the part has >= 1 doc_parts row with doc_relevance = 'spec_for_kind' AND link_basis IN ('explicit', 'family').
// Ordering guides, EoL bulletins and feature sheets stay linked and stop counting. The old doc-type count is kept beside
// it as `held_by_doc_type_legacy`, so every report prints held BEFORE and AFTER relevance.
//
// ONE RULE, TWO SPELLINGS, ONE SOURCE. The SQL predicate the builders run and the JS predicate the tests drive are both
// generated from the constants below, so they cannot drift apart without a code change here.

/** The doc types that carry a specification — the list the ledger has always used (it adds `vendor_page` to
 *  docClass.SPEC_BEARING, measured: Meraki's only source). Shared by both builders since 13 Sep 2026 (6b). */
export const SPEC_BEARING_DOC_TYPES: readonly string[] = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"];

export const LINK_BASES = ["explicit", "family", "inferred", "could_not_check"] as const;
export const DOC_RELEVANCES = ["spec_for_kind", "mention", "could_not_check"] as const;
/**
 * COULD-NOT-CHECK IS A VALUE, NOT A NULL (25 Sep 2026, migration 0023). A run that reached a link and could not read its
 * document writes this; NULL keeps meaning NOTHING HAS LOOKED YET, and `underivedRowSql` still refuses on that.
 *
 * Before this the two shared NULL, so the refusal below became unsatisfiable: `derive-link-provenance` had reached the
 * rows, decided "cannot read", written NULL — and re-running it could never clear them, because 45 of the datasheets are
 * genuinely absent from the cache. A guard nobody can clear is a guard people learn to ignore, which is the worse
 * outcome for a guard whose reasoning is right. A could-not-check row is never held, and it is COUNTED as its own
 * number rather than folded into "not held".
 */
export const COULD_NOT_CHECK = "could_not_check";
/** The link bases that may make a part held. `inferred` never does: it is a linking defect. */
export const HELD_LINK_BASES: readonly string[] = ["explicit", "family"];
export const HELD_RELEVANCE = "spec_for_kind";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The held rule for ONE doc_parts row, as SQL over the alias `dp`. */
export const heldRowSql = (dp = "dp"): string =>
  `(${dp}.doc_relevance = ${lit(HELD_RELEVANCE)} AND ${dp}.link_basis IN (${HELD_LINK_BASES.map(lit).join(", ")}))`;

/** A row NOTHING has looked at yet (either column NULL) — not the same as one a run looked at and could not judge. */
export const underivedRowSql = (dp = "dp"): string => `(${dp}.link_basis IS NULL OR ${dp}.doc_relevance IS NULL)`;

/** A row a run REACHED and could not judge: the document could not be read. Never held; counted and printed apart. */
export const couldNotCheckRowSql = (dp = "dp"): string =>
  `(${dp}.link_basis = ${lit(COULD_NOT_CHECK)} OR ${dp}.doc_relevance = ${lit(COULD_NOT_CHECK)})`;

/** The held rule for ONE row, as JS — the predicate the tests drive; generated from the same constants as the SQL. */
export function rowCountsAsHeld(linkBasis: string | null | undefined, docRelevance: string | null | undefined): boolean {
  return docRelevance === HELD_RELEVANCE && linkBasis !== null && linkBasis !== undefined && HELD_LINK_BASES.includes(linkBasis);
}

/**
 * The document state of one part: a partition, every part in exactly one.
 *   held                  >= 1 row passing the held rule
 *   spec_linked_not_held  a spec-bearing document IS linked, but no row passes (mention only, or inferred) — the parts the
 *                         ruling took out of held; before it they were counted held
 *   eol_only              documents linked, none spec-bearing
 *   no_document           nothing linked
 */
export type DocState = "held" | "spec_linked_not_held" | "eol_only" | "no_document";
export function docStateOf(p: { held_rows: number; spec_rows: number; any_rows: number }): DocState {
  if (p.held_rows > 0) return "held";
  if (p.spec_rows > 0) return "spec_linked_not_held";
  if (p.any_rows > 0) return "eol_only";
  return "no_document";
}

/** The legacy (doc-type) held: any spec-bearing document linked, whatever the link says. */
export const heldByDocTypeLegacy = (p: { spec_rows: number }): boolean => p.spec_rows > 0;

/**
 * THE REFUSAL. A spec-bearing row with either column NULL cannot be judged, and counting it as not-held would silently
 * shrink `held` for every part the derive run has not reached — the `sampled`-carrying-`checked` defect. So the builds
 * refuse, naming how many rows and how many parts.
 */
export function underivedRefusal(vendor: string, rows: number, parts: number): string | null {
  if (rows === 0) return null;
  return `REFUSED: ${rows} spec-bearing doc_parts row(s) on ${parts} live ${vendor} hardware part(s) have link_basis or doc_relevance NULL `
    + "— held cannot be computed for them. Run `derive-link-provenance` (migration 0018) for this vendor first.";
}

/** A missing column is its own refusal, not a SQL error mid-build. */
export function missingColumnsRefusal(present: readonly string[]): string | null {
  const missing = ["link_basis", "doc_relevance", "link_evidence"].filter((c) => !present.includes(c));
  return missing.length ? `REFUSED: doc_parts has no ${missing.join(", ")} column(s) — apply db/migrations/0018_doc_parts_provenance.sql first` : null;
}
