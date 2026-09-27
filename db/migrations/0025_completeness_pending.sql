-- 0025: completeness.pending / pending_gates — make the THIRD outcome visible.
--
-- `requirementFor` has three outcomes that matter to a gap: `req` (asked outright), `pending` (asked
-- because the gate that would settle it is itself unanswered) and `opt` (never a gap). `required_total`
-- counts req AND pending, deliberately and correctly — a pending cup is an open gap, and closing it by
-- fiat would be asserting something nobody has measured. But the stored row kept only the SUM, so
-- `/gaps` could say "34 required" and could not say that six of them are waiting on `form_factor`.
--
-- That difference is the whole of the operator's question. "Which data do we still have to add" has two
-- very different answers: a cup nobody has extracted yet (go and read a datasheet) and a cup nobody can
-- even be ASKED for until some other field is known (go and answer the gate first). Presented as one
-- number they are indistinguishable, and a person filling the mould cannot tell which work is in front
-- of them.
--
-- `pending_gates` names the blocker per cup — [{cup, gate}] — so the answer is not just "six are
-- waiting" but "these six, on this field". The denominator does not move: `required_total` keeps
-- counting pending exactly as it did, so no percentage in any artifact changes on this migration. What
-- changes is that the composition of that number is now readable.
--
-- Additive and reversible: one NOT NULL column with a default that every existing row satisfies, and
-- one nullable jsonb. No existing value is rewritten by the DDL; the values are filled by a recorded
-- `recompute-completeness` run, never by an UPDATE here, so the run row is the audit trail for when and
-- over what scope they were computed.
ALTER TABLE completeness ADD COLUMN IF NOT EXISTS pending       int NOT NULL DEFAULT 0;
ALTER TABLE completeness ADD COLUMN IF NOT EXISTS pending_gates jsonb;

-- pending can never exceed the number it is a part of. A row claiming more pending cups than required
-- ones is arithmetically impossible and means the writer has drifted from `requiredFieldsFor`, which is
-- the one thing that would make every "how full is this?" figure built on top of it wrong.
ALTER TABLE completeness DROP CONSTRAINT IF EXISTS completeness_pending_within_required_ck;
ALTER TABLE completeness ADD CONSTRAINT completeness_pending_within_required_ck
  CHECK (pending >= 0 AND pending <= required_total);
