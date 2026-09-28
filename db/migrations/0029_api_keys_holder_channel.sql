-- 0029_api_keys_holder_channel.sql — who holds a key, and how it is used.
--
-- `keys_hygiene` reports keys "active with no recorded holder". That is not a missing value: `api_keys` is
-- id, name, key_hash, scopes, created_at, last_used_at, revoked_at, and there is nowhere to put one. "Who"
-- has been carried by the NAME, which is free text, is duplicated (ids 1 and 3 are both `netzspec`, and only
-- 3 has been used since 3 Sep), and is what a rotation reads. This catalogue has already been bitten by
-- exactly that: a rotation revoked a row nobody held while the exposed key stayed live.
--
-- TWO COLUMNS, not one (reviewer, 28 Sep 2026): "who" and "how it is used" are the two things a rotation has
-- to read, and a holder alone does not say whether taking a key out stops a site, a deploy or a probe.
--
-- Nullable and not backfilled here, as 0026, 0027 and 0028 were. A migration that also writes values is two
-- changes wearing one name, and here blankness is load-bearing: ids 1 and 6 are meant to stay blank, because
-- BLANK IS THE FINDING — nobody can say who holds them, which is why they are the revoke candidates.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS holder  text;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS channel text;

COMMENT ON COLUMN api_keys.holder IS
  'Who holds this key, as a person or a system that can be asked. NULL means nobody has recorded it, which '
  'is a finding rather than a default — a key nobody can attribute cannot be safely rotated.';
COMMENT ON COLUMN api_keys.channel IS
  'How the key is used: site | deploy | reviewer | probe. A rotation has to know what taking it out stops.';

-- THE UNIQUE INDEX IS NOT HERE, AND THE REASON IS WORTH THE PARAGRAPH.
--
-- The ruling was `UNIQUE (name) WHERE revoked_at IS NULL`, "applied so it refuses today, naming ids 1 and 3,
-- and stays refusing until one of them is gone". A constraint that names an existing collision IS doing its
-- job — but Postgres will not CREATE a unique index over data that already violates it, so the statement
-- does not refuse a write, it refuses to exist. Putting it here makes THIS migration fail, and a failed
-- migration blocks every later one for everybody: the collision would stop a schema change in an unrelated
-- table, which is a bigger outage than the thing it names.
--
-- AND THE ASSERTION ALREADY EXISTS, which is the better answer than writing a second one. `keys_hygiene` in
-- scripts/mould-verify.mts reads PRODUCTION and already prints `2 active keys share the name "netzspec"
-- (ids 1, 3) — a rotation cannot tell them apart`. It is red today and stays red until one of them is gone,
-- which is exactly what the ruling asks of the index.
--
-- Putting the same assertion under `tests/db/` would have been worse than not writing it: that suite runs
-- against a TRUNCATED throwaway database, so it would have read an empty api_keys and passed vacuously —
-- the `inheritedFrom` defect recorded in CLAUDE.md, a ratchet over the production catalogue living where it
-- could never see the catalogue, reporting `0 of 0` while production held 34,824 rows.
--
-- The index itself is one line and belongs in the migration written the day the collision is gone, which is
-- also the only day it could be applied:
--
--     CREATE UNIQUE INDEX api_keys_active_name_uq ON api_keys (name) WHERE revoked_at IS NULL;
