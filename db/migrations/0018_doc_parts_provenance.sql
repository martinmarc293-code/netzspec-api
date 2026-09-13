-- 0018 — link provenance on doc_parts: HOW a document was linked to a part, and WHETHER it is a spec sheet for it.
--
-- WHY (13 Sep 2026, operator ruling on the kind layer). `doc_parts` recorded that a document mentions a part and never
-- why. Every consumer that counts a part as HELD (the cup ledger, the completeness report, the printed-on-the-page cup
-- bar) treated any spec-bearing link as evidence — so an ordering sheet listing 38 voice bundles ("Secure Voice on Cisco
-- ISRs"), an EoL bulletin or a feature sheet made a part "held" while printing none of its rows, and every held % and
-- every printed share was computed over pages that could never fill a cup. Two fields, deliberately separate, so the
-- provenance stays honest:
--
--   link_basis     explicit | family | inferred       how the link was made (src/core/linkBasis.ts)
--   doc_relevance  spec_for_kind | mention            spec_for_kind when the document is spec-bearing AND prints >= 3
--                                                     distinct cups of the part's kind (src/core/printedCups.ts)
--   link_evidence  one line saying why
--   link_run_id    the recorded run that wrote them (a re-derivation after moves overwrites all four together)
--
-- NULL basis with a non-NULL link_run_id = the run could not read the evidence (no cached page, a PDF with no extract
-- records): counted as could-not-check, never folded into inferred.
--
-- held = >= 1 row with doc_relevance = 'spec_for_kind' AND link_basis IN ('explicit','family'). Ordering, EoL and feature
-- sheets stay linked; they stop counting as held. Filled by the recorded run `derive-link-provenance`; NULL on both means
-- not derived yet (other vendors on 13 Sep 2026). Additive: the previous release ignores the columns.
-- the CHECKs validate and the index builds under a lock every apply's doc_parts insert waits on: fail in 10 s rather than
-- queue the live API behind a running apply (migrate.ts wraps the file in one transaction, so LOCAL is scoped to it)
SET LOCAL lock_timeout = '10s';
ALTER TABLE doc_parts ADD COLUMN IF NOT EXISTS link_basis text;
ALTER TABLE doc_parts ADD COLUMN IF NOT EXISTS doc_relevance text;
ALTER TABLE doc_parts ADD COLUMN IF NOT EXISTS link_evidence text;
ALTER TABLE doc_parts ADD COLUMN IF NOT EXISTS link_run_id bigint REFERENCES runs(id);  -- the run that derived the three fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_parts_link_basis_ck') THEN
    ALTER TABLE doc_parts ADD CONSTRAINT doc_parts_link_basis_ck CHECK (link_basis IS NULL OR link_basis IN ('explicit', 'family', 'inferred'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_parts_doc_relevance_ck') THEN
    ALTER TABLE doc_parts ADD CONSTRAINT doc_parts_doc_relevance_ck CHECK (doc_relevance IS NULL OR doc_relevance IN ('spec_for_kind', 'mention'));
  END IF;
END $$;
-- the held predicate reads (part_id, relevance, basis); a partial index keeps it cheap
CREATE INDEX IF NOT EXISTS doc_parts_held_idx ON doc_parts (part_id) WHERE doc_relevance = 'spec_for_kind' AND link_basis IN ('explicit', 'family');
