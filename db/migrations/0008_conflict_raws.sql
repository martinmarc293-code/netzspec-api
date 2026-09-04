-- 0008_conflict_raws.sql — a conflicts row keeps both SOURCE STRINGS, not just both values.
--
-- Why. `ingest remerge` re-evaluates open conflicts under corrected merge rules. Three of the four
-- outcomes need nothing but what 0001 already stores: an agreement changes no value, a retraction
-- writes no value, and a conflict that stays open is left alone. The fourth — the two values were
-- never a disagreement and the newer one should REPLACE the stored one (a re-extraction of the same
-- document, or a list one document states in two places) — has to write a fact, and `facts.raw` is
-- NOT NULL for a reason that is the whole point of the column: a normaliser bug is fixed by
-- re-running the normaliser over `raw`. A fact written with a fabricated `raw` is a fact that
-- cannot be replayed, and the next renormalise pass would quietly undo it.
--
-- So the first remerge could not touch 7,185 of run #38's 11,420 conflicts and had to send them
-- back through `apply-extract`, which still had the source file. The columns below mean that never
-- has to happen again: every conflict written from now on carries the exact cell text of both
-- sides, so a rule corrected in six months can be applied to a conflict logged today.
--
-- NULL means "logged before this migration". `remerge` counts those apart and names the file to
-- re-apply rather than guessing a raw — see src/pipeline/remerge.ts (reapply_needs_source).
--
-- No backfill. The strings are not recoverable from the database: they exist only in the extract
-- files under runs/extract/, and matching them back by (doc_id, locator) would re-derive `raw`
-- through a mapper that has itself changed since. Re-applying the file is the honest route and it
-- writes the real string.

ALTER TABLE conflicts
  ADD COLUMN kept_raw      text,
  ADD COLUMN rejected_raw  text;

COMMENT ON COLUMN conflicts.kept_raw IS
  'the source cell behind `kept`, verbatim; NULL for conflicts logged before migration 0008';
COMMENT ON COLUMN conflicts.rejected_raw IS
  'the source cell behind `rejected`, verbatim; NULL for conflicts logged before migration 0008';
