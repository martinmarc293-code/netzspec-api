-- 0009_parts_retired.sql — a part row can be RETIRED, and two identity aliases get a kind.
--
-- WHY A PART IS RETIRED AND NEVER DELETED. Three measured classes of row in the 89,099-part
-- catalogue are not parts, or not SEPARATE parts (docs/ARCHITECTURE.md § Catalogue hygiene):
--   * 127 same-vendor CASE duplicates (`A9K-DDOS-10U20G=` and `A9k-DDoS-10U20G=`). Cisco PIDs are
--     upper case; the mixed-case twin came from an enumeration/EoL source and `upsertPart` matched
--     on the exact string, so it inserted a second row.
--   * PIDs FABRICATED by the old PDF extractor, a superscript footnote digit glued to a real PID
--     (`UCSX-GPU-RTXP45003` is `UCSX-GPU-RTXP4500` + footnote 3).
--   * FOREIGN part numbers filed under the cisco vendor (`01FT562` is an IBM number).
-- Deleting them would take their facts, their evidence and their run trail with them — the one
-- thing this store exists to keep. A retired row keeps every column it had, stops being a
-- candidate for a SKU lookup, and says in `retired_reason` which rule retired it and in
-- `retired_into` which part absorbed it (NULL when nothing did: a foreign PID has no survivor).
--
-- `retired_reason` and `retired_run_id` are not decoration. A retirement with no recorded reason
-- is the silent skip this repo keeps paying for (CLAUDE.md § 11: never let a skip be silent), and
-- a row that left the catalogue outside a run would break the first hard rule. The CHECK below
-- makes both mechanical: retired_at cannot be set without a reason, and retired_into cannot be
-- set without retired_at.
--
-- THE UNIQUE INDEX IS NOT HERE. `(vendor_id, lower(sku)) WHERE retired_at IS NULL` is migration
-- 0010, because it cannot be created while the 127 duplicates are still live: the index must go on
-- AFTER `ingest hygiene case-duplicates --commit` has retired the losers. Splitting them is what
-- makes the deploy orderable — 0009 can be applied to production the moment the code lands.
--
-- Idempotent: every statement is IF NOT EXISTS or guarded, so re-running changes nothing.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS retired_at     timestamptz;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS retired_into   bigint REFERENCES parts(id);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS retired_reason text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS retired_run_id bigint REFERENCES runs(id);

COMMENT ON COLUMN parts.retired_at IS
  'set when this row left the catalogue as an identity; the row, its facts and its evidence stay';
COMMENT ON COLUMN parts.retired_into IS
  'the part that absorbed this one, NULL when nothing did (a foreign part number has no survivor)';
COMMENT ON COLUMN parts.retired_reason IS
  'the rule that retired it, e.g. case_duplicate / fabricated_pdf_pid / not_a_cisco_part';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parts_retired_needs_reason') THEN
    ALTER TABLE parts ADD CONSTRAINT parts_retired_needs_reason
      CHECK ((retired_at IS NULL AND retired_into IS NULL AND retired_reason IS NULL)
          OR (retired_at IS NOT NULL AND retired_reason IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parts_retired_into_not_self') THEN
    ALTER TABLE parts ADD CONSTRAINT parts_retired_into_not_self CHECK (retired_into IS DISTINCT FROM id);
  END IF;
END $$;

-- "which rows did this survivor absorb" is a report query and a merge's own read-back
CREATE INDEX IF NOT EXISTS parts_retired_into_idx ON parts (retired_into) WHERE retired_into IS NOT NULL;
-- every live-part scan filters on this; a partial index keeps the retired rows out of it
CREATE INDEX IF NOT EXISTS parts_retired_at_idx ON parts (retired_at) WHERE retired_at IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- two alias kinds the hygiene pass writes
-- ---------------------------------------------------------------------------------------------
-- case_variant  the loser's exact spelling of a merged case duplicate, so a page that printed
--               `A9k-DDoS-10U20G=` still resolves after the merge.
-- hw_variant    the Meraki base/`-HW` pair (`MR44` and `MR44-HW`). These are NOT merged: both are
--               orderable PIDs. They are linked BOTH WAYS so apply-acquired's alias step reaches
--               either from either — the run that found 179 meraki entries and matched 0 was
--               looking up `MR44` against a catalogue that held `MR44-HW`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_aliases_kind_check') THEN
    ALTER TABLE part_aliases DROP CONSTRAINT part_aliases_kind_check;
  END IF;
  ALTER TABLE part_aliases ADD CONSTRAINT part_aliases_kind_check
    CHECK (kind IN ('gtin', 'upc', 'ean', 'legacy_sku', 'variant_sku', 'vendor_alias',
                    'distributor_sku', 'case_variant', 'hw_variant'));
END $$;
