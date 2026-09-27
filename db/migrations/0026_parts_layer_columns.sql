-- 0026_parts_layer_columns.sql — the layers, in the database.
--
-- WHY THIS EXISTS. The layer model (category -> product_line -> product_family -> series) is built
-- today into data/layers/*.json and served to the site from there, while the API serves parts from
-- the database. Two sources, and nothing fails when they diverge. Six Phase A tests cannot judge
-- ANYTHING because of it — kind_profile_parity, no_family_reason_present, bucket_not_series,
-- twin_parity, unknown_zero and plans_agree_with_rows all report NOT EXERCISED naming these exact
-- columns as their producer.
--
-- EVERY COLUMN IS NULLABLE AND NOTHING IS BACKFILLED HERE. A migration that also writes values is two
-- changes wearing one name: the schema is reversible by a drop, the values are not, and they need a
-- recorded run with a dry run read first. So this adds the shape and nothing else, and every test
-- above stays NOT EXERCISED until the writing run lands — which is the honest state, not a regression.
--
-- product_family_state IS NOT DECORATION. The layering build writes "(none)" where a line names no
-- family, because a review once read NULL as "undecided". Passing that sentinel to a consumer put the
-- literal string "(none)" on 3,993 switches and 3,975 routers as a family NAME, where a shop tree or a
-- JTL Merkmalwert would print it. The fix is null PLUS a state, so the distinction the review wanted
-- survives without any consumer having to recognise a marker.
--
-- no_family_reason exists for the same reason one layer down: "this line names no family" and "nobody
-- has looked yet" are different facts, and a single NULL cannot carry both.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS sku_kind              text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS product_line          text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS product_family        text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS product_family_state  text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS no_family_reason      text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS product_series        text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS bucket                text[];

-- The states are closed sets, so the database refuses a value no consumer knows how to read. A CHECK
-- rather than an enum type: an enum needs a migration to extend and this repo has already been bitten
-- by hand-written copies of enum values drifting from the schema (relation_kind held eleven values
-- against ten in each of three TypeScript lists). A CHECK keeps the canonical list in ONE place that
-- every reader can query.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_product_family_state_check;
ALTER TABLE parts ADD CONSTRAINT parts_product_family_state_check
  CHECK (product_family_state IS NULL
         OR product_family_state IN ('named', 'no_family_named', 'shared_across_line'));

ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_no_family_reason_check;
ALTER TABLE parts ADD CONSTRAINT parts_no_family_reason_check
  CHECK (no_family_reason IS NULL
         OR no_family_reason IN ('vendor-names-none', 'single-series', 'not-reviewed'));

-- A SENTINEL MUST NEVER REACH A CONSUMER AGAIN, and a comment asking people to remember that is the
-- version that failed. The database refuses it.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_family_not_sentinel_check;
ALTER TABLE parts ADD CONSTRAINT parts_family_not_sentinel_check
  CHECK (product_family IS NULL OR product_family NOT LIKE '(%');

-- A navigation bucket is not a series. Same reasoning: "Catalyst 9300 shared parts" is a construct the
-- layering build invents to hold components whose host cannot be decided, and a shop tree would print
-- it as a product line.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_series_not_bucket_check;
ALTER TABLE parts ADD CONSTRAINT parts_series_not_bucket_check
  CHECK (product_series IS NULL OR product_series NOT ILIKE '%shared parts');

-- The reason a state says "no family" is only meaningful WITH that state, and a reason recorded beside
-- a named family is a contradiction nobody would notice by reading rows.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_reason_needs_state_check;
ALTER TABLE parts ADD CONSTRAINT parts_reason_needs_state_check
  CHECK (no_family_reason IS NULL OR product_family_state = 'no_family_named');

CREATE INDEX IF NOT EXISTS parts_sku_kind_idx       ON parts (sku_kind)       WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS parts_product_line_idx   ON parts (product_line)   WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS parts_product_series_idx ON parts (product_series) WHERE retired_at IS NULL;
