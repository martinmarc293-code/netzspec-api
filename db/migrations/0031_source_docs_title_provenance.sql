-- 0031 — where a document's title came from, and a named state for a document that has none.
-- Reviewer rulings 28 Sep 2026 (docs/decisions/2026-09-28-untitled-documents.md):
--   title_source = 'pdf-info-trailer' for the 68 PDF titles of run 1289, so a PDF Info-dictionary title is never
--     confused with the raw-byte first-/Title read that produced the header.eps-class junk; 'html-title' for <title>.
--   title_state = 'none' for a readable document whose file carries no title anywhere — nothing invented.
-- NULL in either column means "not recorded", which is every title set before this migration.
ALTER TABLE source_docs ADD COLUMN IF NOT EXISTS title_source text
  CHECK (title_source IN ('html-title', 'pdf-info-trailer'));
ALTER TABLE source_docs ADD COLUMN IF NOT EXISTS title_state text
  CHECK (title_state IN ('none'));
-- A document cannot be both titled and recorded as having no title.
ALTER TABLE source_docs ADD CONSTRAINT source_docs_title_state_untitled
  CHECK (title_state IS NULL OR title IS NULL OR title = '');
