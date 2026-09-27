-- 0027_parts_name_image_lifecycle_state.sql — three states a part's record must be able to tell.
--
-- WHY A STORED STATE AND NOT A QUERY. Each of these distinctions is INVISIBLE to the obvious check:
--
--   name_state      "Cisco C9200-24P" is not a name, it is the SKU with a word in front. 11,688 live
--                   parts carry one, and every check that asks "is name null" sees a name. The
--                   difference only exists if something records it.
--   image_state     showing the SERIES photograph is a legitimate answer and showing nothing is a
--                   legitimate answer; pretending they are the same is not. 2,751 live parts have an
--                   image of their own against 91,533 live parts.
--   lifecycle_state `unknown-unchecked` and `unknown-checked` are different facts ABOUT OUR OWN WORK,
--                   and only the second is a finding about the vendor. 18,044 parts have a lifecycle
--                   row; the other 73,489 are not "active", they are unasked.
--
-- Nullable and not backfilled here. A migration that also writes values is two changes wearing one
-- name: the schema is reversible by a drop and the values are not. The derivation runs separately,
-- under a recorded run, with a dry run first.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS name_state      text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS image_state     text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS lifecycle_state text;

-- CLOSED SETS, enforced by the database rather than by everyone remembering. A CHECK and not an enum
-- type for the reason 0026 gives: this repo has already been bitten by hand-written copies of enum
-- values drifting from the schema, and a CHECK keeps the canonical list in one place every reader can
-- query.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_name_state_check;
ALTER TABLE parts ADD CONSTRAINT parts_name_state_check
  CHECK (name_state IS NULL OR name_state IN ('real', 'sku-only'));

ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_image_state_check;
ALTER TABLE parts ADD CONSTRAINT parts_image_state_check
  CHECK (image_state IS NULL OR image_state IN ('own', 'series', 'none'));

-- FOUR, NOT THREE. The pair that matters is unknown-unchecked against unknown-checked: the first says
-- nobody has looked, the second says we looked and the vendor says nothing. Collapsing them turns a
-- gap in our own work into a fact about the vendor, which is this repo's most-repeated defect.
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_lifecycle_state_check;
ALTER TABLE parts ADD CONSTRAINT parts_lifecycle_state_check
  CHECK (lifecycle_state IS NULL OR lifecycle_state IN
    ('verified-active', 'eol-announced', 'unknown-unchecked', 'unknown-checked'));

CREATE INDEX IF NOT EXISTS parts_name_state_idx      ON parts (name_state)      WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS parts_lifecycle_state_idx ON parts (lifecycle_state) WHERE retired_at IS NULL;
