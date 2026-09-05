-- 0010_parts_case_unique.sql — part identity is case-insensitive per vendor, enforced.
--
-- WHY IT IS A SEPARATE MIGRATION. 0001 made identity `UNIQUE (vendor_id, sku)` — the exact string
-- the vendor writes. That is right for storage (`C9200L-24P-4G=` and `C9200L-24P-4G` really are
-- two parts) and wrong for IDENTITY: `A9K-DDOS-10U20G=` and `A9k-DDoS-10U20G=` are one part, and
-- 127 pairs of them reached production because `upsertPart` looked the SKU up with `=` and the
-- enumeration source spelled it differently from the catalogue. The generated `sku_norm` column
-- and `parts_sku_norm_idx` already existed; what did not exist was anything REFUSING the second
-- row, so the duplicate arrived silently and `findPart`'s case-insensitive arm picked one of the
-- two with `ORDER BY sku LIMIT 1`.
--
-- This index cannot be created while those 127 pairs are live, which is the whole reason it is not
-- in 0009: the order is `npm run migrate` (0009) -> `ingest hygiene case-duplicates --commit` ->
-- `npm run migrate` (0010). Applying it against a catalogue that still holds duplicates must not
-- fail with a bare "could not create unique index", so the guard below counts them first and
-- raises a message that names the command to run and up to five offending SKUs.
--
-- WHY lower(sku) AND NOT THE EXISTING sku_norm. `sku_norm` is `upper(sku)`, generated and STORED,
-- so an index on it would work equally well — but a UNIQUE index on a stored generated column and
-- a UNIQUE index on an expression behave differently on ALTER: dropping or redefining the
-- generated column would silently take the constraint with it. The expression index depends on
-- `sku` alone, which is the column identity actually lives in. Both spellings fold the same set
-- (upper and lower are inverse folds over the ASCII the SKU charset allows), so the two can never
-- disagree about what a duplicate is.
--
-- PARTIAL ON retired_at IS NULL: a retired duplicate keeps its exact SKU forever (that string is
-- the evidence a page printed it), so it must be allowed to sit next to the survivor it merged
-- into. Only LIVE rows compete for an identity.
--
-- NOT CONCURRENTLY: db/migrate.ts wraps each migration in a transaction, which CREATE INDEX
-- CONCURRENTLY cannot run inside. parts is ~89k rows, so the write lock is short (0006 § same).

DO $$
DECLARE
  n int;
  eg text;
BEGIN
  SELECT count(*), string_agg(sample, ', ')
    INTO n, eg
    FROM (SELECT (array_agg(sku ORDER BY sku))[1] || ' / ' || (array_agg(sku ORDER BY sku))[2] AS sample
            FROM parts WHERE retired_at IS NULL
           GROUP BY vendor_id, lower(sku) HAVING count(*) > 1
           ORDER BY 1 LIMIT 5) s;
  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('%s live case-duplicate group(s) still in parts, e.g. %s', n, eg),
      HINT = 'run `npm run ingest -- hygiene case-duplicates --commit` first; this index is the guard that stops them coming back, not the tool that removes them';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS parts_vendor_sku_ci_uq ON parts (vendor_id, lower(sku)) WHERE retired_at IS NULL;

COMMENT ON INDEX parts_vendor_sku_ci_uq IS
  'part identity is case-insensitive per vendor; retired rows keep their exact SKU and are excluded';
