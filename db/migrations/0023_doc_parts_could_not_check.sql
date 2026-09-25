-- 0023_doc_parts_could_not_check.sql — "not computed yet" and "computed: the document could not be read" stop sharing NULL.
--
-- WHY (25 Sep 2026). Migration 0018 let `link_basis` and `doc_relevance` be NULL, and `derive-link-provenance` writes
-- NULL for a link whose document it cannot read. `src/core/heldEvidence.ts` then REFUSES every build that would read
-- those rows, with the right reasoning — counting an unjudged row as not-held silently shrinks `held`, which is the
-- `sampled`-carrying-`checked` defect this repo keeps paying for.
--
-- The two states were indistinguishable, so the refusal became unsatisfiable: the derive run HAS reached those rows and
-- decided "I cannot read this document", and re-running it can never clear them, because 45 of the cached datasheets are
-- genuinely absent from the cache. A guard nobody can clear is a guard people learn to ignore.
--
-- So could-not-check gets its own value, as this repo's oldest rule says it must: NULL keeps meaning NOTHING HAS LOOKED
-- AT THIS ROW (and keeps refusing the build), while 'could_not_check' means a run looked and could not judge. A
-- could-not-check row is never held — `held` still requires spec_for_kind with an explicit or family basis — but it is
-- COUNTED AND PRINTED as its own number beside held, never folded into "not held".
--
-- Additive: the constraints only gain a permitted value, no existing row changes, and the held index is untouched
-- because 'could_not_check' can never satisfy it.
ALTER TABLE doc_parts DROP CONSTRAINT IF EXISTS doc_parts_link_basis_ck;
ALTER TABLE doc_parts ADD CONSTRAINT doc_parts_link_basis_ck
  CHECK (link_basis IS NULL OR link_basis IN ('explicit', 'family', 'inferred', 'could_not_check'));
ALTER TABLE doc_parts DROP CONSTRAINT IF EXISTS doc_parts_doc_relevance_ck;
ALTER TABLE doc_parts ADD CONSTRAINT doc_parts_doc_relevance_ck
  CHECK (doc_relevance IS NULL OR doc_relevance IN ('spec_for_kind', 'mention', 'could_not_check'));
