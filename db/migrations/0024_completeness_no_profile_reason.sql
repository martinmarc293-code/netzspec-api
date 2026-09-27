-- 0024: completeness.no_profile_reason / no_profile_rule — WHY a part is not scored.
--
-- `no_profile` is one boolean carrying three unrelated facts, and that is how 3,476 parts of twelve
-- unarranged brands sat inside Cisco's denominators unnoticed until 27 Sep. "Not scored because this
-- brand has no mould yet", "not scored because it is a licence" and "not scored because the role table
-- says this row is not the kind its category thinks it is" need three different pieces of work — a brand
-- to arrange, nothing at all, and a reclassification — and a single flag for all three makes the
-- question unaskable. NO_MOULD_REASON has been exported since the brand guard landed and written
-- nowhere, which is the reviewer's finding and the reason this column exists.
--
-- TWO COLUMNS, NOT ONE STRING. `no_profile_rule` carries the id of the rule that produced the refusal
-- (today only `sw.issue.ont`, the PON ONT/OLT rule in src/core/deployRole.ts). The reviewer's condition,
-- and it is the right one: when a rule is later renamed or deleted, the stored row still says what
-- happened, and the 18 refused parts can be traced to their rule without re-deriving anything.
--
-- THE VALUE DOMAIN IS CHECKED HERE; THE PAIRING IS NOT, DELIBERATELY. A constraint saying "reason is
-- present exactly when no_profile is true" is the invariant we want, and it cannot be validated today
-- because every existing no_profile row predates the column. Adding it NOT VALID would leave a
-- constraint nobody validates, which is a declared thing nothing enforces — the defect this column is
-- fixing. So the domain is constrained now (valid immediately, additive, no existing row changes) and
-- the pairing is asserted over live rows by tests/noProfileReason.test.ts, which fails in BOTH
-- directions: a no_profile row with no reason, and a scored row carrying one.
--
-- Additive and reversible: two nullable columns and one CHECK that no existing row can violate.
ALTER TABLE completeness ADD COLUMN IF NOT EXISTS no_profile_reason text;
ALTER TABLE completeness ADD COLUMN IF NOT EXISTS no_profile_rule   text;

-- The three reasons, and the list is duplicated in src/core/noProfileReason.ts on purpose: one copy is
-- the database's, one is the code's, and tests/noProfileReason.test.ts reads THIS constraint out of
-- pg_constraint and compares it to the code's list in both directions. A hand-written list compared
-- against another hand-written list is not a check; comparing code to the schema is.
ALTER TABLE completeness DROP CONSTRAINT IF EXISTS completeness_no_profile_reason_ck;
ALTER TABLE completeness ADD CONSTRAINT completeness_no_profile_reason_ck
  CHECK (no_profile_reason IS NULL OR no_profile_reason IN (
    'brand_not_arranged',        -- the part's brand has no mould for this category (src/core/brandMould.ts)
    'non_hardware',              -- a licence, service or other non-subject: no specification exists to score
    'kind_refused_by_role_table', -- an ISSUE rule says this row is not the kind its category scores it as
    'category_has_no_profile'     -- arranged hardware whose CATEGORY carries no cup profile yet
  ));

-- A rule id is only meaningful for a refusal, and a refusal without one cannot be traced.
ALTER TABLE completeness DROP CONSTRAINT IF EXISTS completeness_no_profile_rule_ck;
ALTER TABLE completeness ADD CONSTRAINT completeness_no_profile_rule_ck
  CHECK (no_profile_rule IS NULL OR no_profile_reason = 'kind_refused_by_role_table');
