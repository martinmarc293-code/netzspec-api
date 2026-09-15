-- 0022_parts_family_carrier.sql — the family-carrier flag on the row itself (operator, 15 Sep 2026, Q-10 vs Q-23:
-- "Add a row flag `family_carrier: true` (a column, not a cup) on every kept carrier … so the shop feed can never list a carrier as
-- orderable").
--
-- WHY A COLUMN AND NOT A PAGE FIELD. The layers pages already flag every carrier, and that is enough for a reader of the pages — but the
-- shop feed does not read the pages. netzspec.com syncs from /v1/export (scripts/sync-from-api.mjs), so a flag that lives only on a page
-- cannot reach it: a carrier would keep arriving in the feed as an ordinary orderable row. The flag has to be on the part.
--
-- WHAT A CARRIER IS. A row that carries its family's facts or its document — a bare model row (Q-23) or a regional / length stand-in
-- (Q-10 vs Q-23, where Q-23 governs) — and is therefore the family's MODEL row, not something anyone can order. It keeps its row, its
-- device kind and its facts; phase 2 inherits those facts to the orderable variants. data/reference/family-carriers.json is the list, and
-- scripts/family-carrier.mts sets the column from it inside a recorded run.
--
-- ADDITIVE AND FALSE BY DEFAULT, so every existing reader keeps its meaning: a row is not a carrier until a run says so. The reason column
-- carries the decision that made it one, the same way product_class_reason carries the rule that set a class.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS family_carrier boolean NOT NULL DEFAULT false;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS family_carrier_reason text;

-- the flag is read as a filter by the feed and by /v1/parts, and carriers are a tiny share of the table
CREATE INDEX IF NOT EXISTS parts_family_carrier_idx ON parts (family_carrier) WHERE family_carrier;

COMMENT ON COLUMN parts.family_carrier IS 'true = the family model row that carries its family''s facts or document (Q-23); it is not orderable and a shop feed must not list it';
COMMENT ON COLUMN parts.family_carrier_reason IS 'the decision that set the flag, e.g. "family-carrier:Q-10 vs Q-23: regional placeholder carrying its family''s facts"';
