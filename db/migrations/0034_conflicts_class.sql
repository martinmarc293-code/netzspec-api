-- 0034 — conflicts.class: WHY two values disagree, so a conflict names the work it needs (reviewer ruling Q11, 29 Sep 2026;
-- conflicts_classified, plan A10). Four classes, decided from the two sides' evidence by src/core/conflictClass.ts:
--   source-disagreement   two documents (two URLs: source_docs.doc_id is sha1(url)), or a side naming no document (tier 0)
--   same-doc-multicolumn  one URL, two cells -- the multi-column reader paired a different column (the extractor's re-read plan)
--   normaliser-split      one URL, one cell, read two ways (a normaliser change, or a dual-unit cell read twice)
--   revision-drift        one URL, one cell whose TEXT changed between fetches (the vendor revised the figure)
-- NULL = not yet classified (the backfill run classifies every open row; the writer sets it on every new row). The CHECK
-- refuses anything else, so a fifth word cannot creep in through a script.
ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS class text
  CHECK (class IS NULL OR class IN ('source-disagreement', 'same-doc-multicolumn', 'normaliser-split', 'revision-drift'));
