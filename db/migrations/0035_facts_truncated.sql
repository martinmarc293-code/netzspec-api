-- 0035 — facts.truncated: the stored value is the HEAD of a longer cell (reviewer ruling, 6 Oct 2026 ~18:30, verbatim:
-- "(1) Column — append-only supersede for the 137, as you propose. (2) (b) — render the list without its cut tail member,
-- truncated: true on the API. ... The drop is at render time only — the stored fact keeps its raw.").
--
-- A list cell the extractor capped at 160 characters ends in a severed member -- "Border Gateway", "Multilink", "IEC 609" --
-- that the list grammar may even accept, and nothing in the row said so: the API served the stump as a complete member.
-- Measured 6 Oct over the router corpus: 137 current facts end at such a cut, 92 of them with a tail the grammar accepts.
-- false on every existing row; set by the supersede run for the measured cut facts (append-only, never an UPDATE of a fact)
-- and by apply-extract when it caps a value. Metadata-only on PostgreSQL 11+ (a constant default rewrites no rows); the lock
-- timeout keeps the ACCESS EXCLUSIVE lock from queueing every reader behind a long transaction -- a refused migration is
-- retried, a blocked API is an outage.
SET LOCAL lock_timeout = '10s';
ALTER TABLE facts ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;
