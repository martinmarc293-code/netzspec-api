-- 0033 — source_docs.extract_defects: what the extractor could NOT read on each document, counted by defect code
-- (reviewer ruling, 29 Sep 2026). A model row naming no attributable PID used to be dropped with a bare `continue` --
-- 4,755 rows on 430 Cisco pages, measured 29 Sep -- and the lane's RESULT discarded the extractor's defect list, so the
-- fill dashboard's "not parsed: which document" state had no document to name. {"counts": {CODE: n}, "total": n,
-- "run_id": n}, REPLACED by every apply of the document (the latest extraction is the one that stands).
-- NULL = never measured (an adapter that reports no defects, or a document not re-applied since); {"counts": {}, "total": 0}
-- = measured, and nothing on the page was unreadable. The two must never be read as the same thing.
ALTER TABLE source_docs ADD COLUMN IF NOT EXISTS extract_defects jsonb;
