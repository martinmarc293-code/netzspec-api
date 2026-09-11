-- 0017 — seed the three component categories that exist in PRODUCTION and in no migration.
--
-- WHY (12 Sep 2026). `power-supplies`, `power-cables` and `rack-mounting` were created directly in the live
-- database and never written down here, while src/core/fieldSchema.ts declares a profile for each. A database
-- built from migrations therefore does not have them, and `syncDictionaryOn` refuses outright — "category in
-- code missing from the categories table" — which took six database suites down with it. The suites had not
-- run since 5 Sep, so the divergence sat there for a week: a schema that exists in one database and no file is
-- a schema nobody can reproduce.
--
-- Values are copied from production (ids 24-26) rather than invented, so this is a no-op there and brings any
-- other database to the same state. Ids are NOT forced: the sequence assigns them, and nothing keys on them.
--
-- OPEN QUESTION, NOT DECIDED HERE (raised by the reviewer, 12 Sep 2026). All three hold ZERO parts. If power
-- supplies, cords and rack kits are meant to MOVE here, then the per-category kind axes built on 12 Sep
-- (switches `power`, servers `psu`, routers `power-cord`, and the same in five more categories) are the wrong
-- axis for them, and both cannot be true at once. Until the operator says otherwise the components stay in
-- their platform's category, where the kind axis asks each one what it is bought on, and these three stay
-- empty — declared, so the dictionary sync is reproducible, and unused.

INSERT INTO categories (slug, name_en, name_de, is_hardware, sort_order) VALUES
  ('power-supplies', 'Power supplies',       'Netzteile',            true, 24),
  ('power-cables',   'Power cords & cables', 'Netzkabel & Kabel',    true, 25),
  ('rack-mounting',  'Rack & mounting kits', 'Rack- & Montagesets',  true, 26)
ON CONFLICT (slug) DO NOTHING;
