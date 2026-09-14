-- 0019_parts_whitespace_fold.sql — part identity folds whitespace as well as case (layers review round 2, A.5, 14 Sep 2026).
--
-- WHY. 0010 made identity case-insensitive per vendor. Ten Cisco pairs survived it because they differ by a SPACE, not a case:
-- `C9200L-48P- 4G` and `C9200L-48P-4G` (all ten are Catalyst 9200L, all created 2026-09-03, the spaced one with 12 facts and 34
-- relations, the other with 26-29 facts and the image). Measured across ALL vendors before writing this: cisco 10 groups / 20 rows,
-- every other vendor 0.
--
-- WHAT THIS MIGRATION DOES, and why it is two of the three steps:
--   1. part_aliases.kind accepts 'whitespace_variant' — the merged spaced spelling stays resolvable, like 0009's case_variant.
--   2. an expression index on the fold, NOT unique: `upsertPart` and `findPart` look parts up by exactly this expression, so the
--      lookup is indexed from the moment the code that uses it ships, and it can be created while the ten pairs are still live.
--   3. (0020, after `ingest hygiene whitespace-duplicates --commit`) the UNIQUE partial index on the same expression, guarded.
-- The fold uses the POSIX class [[:space:]] so no backslash escape sits in the SQL or the TypeScript that must match it.
--
-- NOT CONCURRENTLY: db/migrate.ts wraps each migration in a transaction (see 0010).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_aliases_kind_check') THEN
    ALTER TABLE part_aliases DROP CONSTRAINT part_aliases_kind_check;
  END IF;
  ALTER TABLE part_aliases ADD CONSTRAINT part_aliases_kind_check
    CHECK (kind IN ('gtin', 'upc', 'ean', 'legacy_sku', 'variant_sku', 'vendor_alias',
                    'distributor_sku', 'case_variant', 'hw_variant', 'whitespace_variant'));
END $$;

CREATE INDEX IF NOT EXISTS parts_sku_ws_fold_idx ON parts (vendor_id, lower(regexp_replace(sku, '[[:space:]]', '', 'g')));

COMMENT ON INDEX parts_sku_ws_fold_idx IS
  'the identity fold (case + whitespace) that upsertPart/findPart look parts up by; 0020 adds the unique partial index on it';
