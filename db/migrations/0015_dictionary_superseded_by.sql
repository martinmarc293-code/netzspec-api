-- 0015 — field_dictionary.superseded_by: where a retired key's quantity now lives.
--
-- WHY. src/core/fieldSchema.ts SUPERSEDED_KEYS retires a key that names the same quantity as another
-- (cd_tolerance -> chromatic_dispersion_tolerance, chassis_compatibility -> product_compatibility, ...).
-- The DICTIONARY row stays, because facts reference field_dictionary through a foreign key and history
-- must keep resolving. So /v1/fields went on listing the retired key beside its successor — requirement
-- "na", and nothing to say the two are one quantity. A consumer saw two names for one cup (reviewer §1.3,
-- 11 Sep 2026). The column says which key to read instead; NULL means "not retired".
--
-- A SELF-REFERENCE, so a pointer can only ever name a key that exists. Filled by `ingest sync-dictionary`
-- from SUPERSEDED_KEYS, never by hand, exactly like every other column of this table.
--
-- ADDITIVE AND SAFE UNDER THE PREVIOUS RELEASE (db/migrate.ts is forward-only): a nullable column that
-- the running code neither selects nor writes.

ALTER TABLE field_dictionary ADD COLUMN IF NOT EXISTS superseded_by text REFERENCES field_dictionary(key);
