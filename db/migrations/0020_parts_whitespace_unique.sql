-- 0020_parts_whitespace_unique.sql — the guard that stops whitespace twins coming back (layers review round 2, A.5, 14 Sep 2026).
--
-- Order, as 0010 was: 0019 (alias kind + the non-unique fold index) -> `npm run ingest -- hygiene whitespace-duplicates --commit`
-- (run #1064: 10 Cisco pairs merged, spaced rows retired with a whitespace_variant alias, 0 groups left) -> this migration.
--
-- EXTENDS 0010's identity rule to whitespace. `parts_vendor_sku_ci_uq` (case only) is KEPT beside it: every pair it refuses this
-- one refuses too, so it adds no restriction, but tests/db/hygiene.test.ts replays 0010 by that name on the shared test databases
-- and upsertPart maps its error — dropping it is a separate change with its own test, not a side effect of this one. Retired rows
-- keep their exact SKU and stay outside the index, as in 0010.
--
-- The guard counts live groups first and names up to five, so applying this against a catalogue that still holds a twin fails
-- with the command to run instead of a bare "could not create unique index".

DO $$
DECLARE
  n int;
  eg text;
BEGIN
  SELECT count(*), string_agg(sample, ', ')
    INTO n, eg
    FROM (SELECT string_agg(sku, ' / ' ORDER BY sku) AS sample
            FROM parts WHERE retired_at IS NULL
           GROUP BY vendor_id, lower(regexp_replace(sku, '[[:space:]]', '', 'g')) HAVING count(*) > 1
           ORDER BY 1 LIMIT 5) s;
  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('%s live whitespace/case-duplicate group(s) still in parts, e.g. %s', n, eg),
      HINT = 'run `npm run ingest -- hygiene whitespace-duplicates --commit` (and case-duplicates) first; this index is the guard, not the tool';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS parts_vendor_sku_ws_uq
  ON parts (vendor_id, lower(regexp_replace(sku, '[[:space:]]', '', 'g'))) WHERE retired_at IS NULL;

COMMENT ON INDEX parts_vendor_sku_ws_uq IS
  'part identity is case- and whitespace-insensitive per vendor (extends parts_vendor_sku_ci_uq); retired rows keep their exact SKU and are excluded';
