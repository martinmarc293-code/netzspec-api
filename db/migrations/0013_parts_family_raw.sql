-- 0013 — parts.family_raw, so the model level can take over `family` without losing anything.
--
-- `family` currently holds the TITLE of whichever datasheet mentioned the SKU, and a datasheet
-- title names a series, not a model. Measured over the 10,959 cisco parts that carry one:
--
--     4,520 of 10,959 values literally contain their own series string  ('Catalyst 9200' ->
--       'Catalyst 9200 Series Switches'), so the level restates the one above it
--     Catalyst 9300 has TWO families across 299 parts — not a model level by any reading
--     GLC-TE, an SFP module, carries 'Cisco 1000 Series Integrated Services Routers', and
--       SFP-10G-SR carries 'MDS 9000 Series Pluggable Transceivers' — the family of whichever
--       platform datasheet happened to list the optic
--
-- and 75,985 parts (87.4%) have no value at all, because family could only ever exist where a
-- document described the part.
--
-- `family` becomes the MODEL — the SKU minus its orderable suffix — which is derivable for every
-- part and is genuinely narrower than the series:
--
--     C9500-12Q  <-  C9500-12Q, -A, -A=, -E, -E=, -P, -P=
--
-- This migration only preserves the old value. It does not populate family_raw's replacement;
-- scripts/derive-family.ts does that, and keeping the two apart means the old grouping is still
-- readable if the model level turns out to be the wrong call.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS family_raw text;

-- Copy before anything overwrites `family`. Idempotent: only fills where family_raw is still null,
-- so re-running after the derivation cannot overwrite the preserved value with a model string.
UPDATE parts SET family_raw = family WHERE family IS NOT NULL AND family_raw IS NULL;

COMMENT ON COLUMN parts.family_raw IS
  'The document-title grouping family held before 8 Sep 2026. Series-level and sometimes the '
  'wrong series; kept so the model derivation in `family` is reversible and attributable.';
COMMENT ON COLUMN parts.family IS
  'The MODEL: the SKU minus its orderable suffix (= spare, ++ upgrade, -RF remanufactured, and '
  'the software/regulatory tier outside optics categories, where a trailing letter is a reach '
  'code instead). One row per physical product; its members are the orderable variants.';

CREATE INDEX IF NOT EXISTS parts_family_idx ON parts (family) WHERE family IS NOT NULL;
