-- 0021_parts_name_language.sql — the German shop title gets its own column (layers review round 2, B.6; operator decision 14 Sep 2026).
--
-- The tier-0 hexcat seed wrote German catalogue titles into parts.name (switches 613, transceiver 461 live Cisco hardware rows,
-- docs/reports/cisco-switches-german-names-2026-09-14.md). Decision: the German text is kept in name_de for EVERY such row and
-- never dropped; parts.name is English. Rows whose twin (X / X=) holds an English name take it, with name_source 'twin: <sku>';
-- rows with no English name anywhere keep the German name in parts.name, flagged name_lang = 'de', until phase 2 fills name from
-- the datasheet title or ordering table.
--
-- Additive only: three nullable columns and a CHECK. NULL name_lang means "not assessed", never "English".

ALTER TABLE parts ADD COLUMN IF NOT EXISTS name_de text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS name_lang text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS name_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parts_name_lang_check') THEN
    ALTER TABLE parts ADD CONSTRAINT parts_name_lang_check CHECK (name_lang IS NULL OR name_lang IN ('en', 'de'));
  END IF;
END $$;

COMMENT ON COLUMN parts.name_de IS 'the German shop title that was parts.name (tier-0 seed); kept, never dropped';
COMMENT ON COLUMN parts.name_lang IS 'language of parts.name where assessed: en | de (de = no English name found yet, a store-quality item)';
COMMENT ON COLUMN parts.name_source IS 'where parts.name came from when it was replaced, e.g. "twin: C9200L-48P-4G="';
