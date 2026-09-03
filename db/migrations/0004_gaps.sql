-- 0004_gaps.sql — "no gaps" as a property of the process, not a promise.
--
-- We cannot invent a fact a vendor never published. What we CAN guarantee is that no gap is
-- ever silent or unattempted: for every hardware part and every field its profile requires,
-- the system knows whether the value is sourced, held in conflict, awaiting corroboration,
-- confirmed absent after every capable source was consulted, or simply not yet attempted —
-- and the last state is a queue entry, not a shrug.
--
--   source_fields        which fields a source is known to publish (per category or any)
--   part_source_checks   every consultation of a source for a part, with its outcome
--   completeness.required_fields  the engine's per-part required list (conditions evaluated)
--   gap_ledger           the view that names every open gap and how many sources are left

CREATE TABLE source_fields (
  id           serial PRIMARY KEY,
  source_id    smallint NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id  smallint REFERENCES categories(id),     -- NULL = any category
  field_key    text NOT NULL REFERENCES field_dictionary(key),
  note         text
);
CREATE UNIQUE INDEX source_fields_uq ON source_fields (source_id, COALESCE(category_id, 0), field_key);
CREATE INDEX source_fields_field_idx ON source_fields (field_key);

CREATE TABLE part_source_checks (
  id            bigserial PRIMARY KEY,
  part_id       bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  source_id     smallint NOT NULL REFERENCES sources(id),
  doc_id        text REFERENCES source_docs(doc_id),
  fetch_id      bigint REFERENCES fetches(id),
  checked_at    timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL CHECK (outcome IN ('facts_found', 'no_facts', 'not_listed', 'fetch_failed', 'blocked')),
  facts_found   int NOT NULL DEFAULT 0,
  fields_found  text[] NOT NULL DEFAULT '{}',
  run_id        bigint REFERENCES runs(id)
);
CREATE UNIQUE INDEX part_source_checks_uq ON part_source_checks (part_id, source_id, COALESCE(doc_id, ''));
CREATE INDEX part_source_checks_source_idx ON part_source_checks (source_id, checked_at DESC);

-- The engine evaluates conditional requirements against the part's own values, so the full
-- required list is per part and lives here, next to what is missing from it.
ALTER TABLE completeness ADD COLUMN required_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Every open gap, with the count of capable sources already consulted and still available.
-- A gap becomes `gap_confirmed` (a facts row with a NULL value) only when the pipeline has a
-- check row for every enabled capable source and none carried the field.
CREATE VIEW gap_ledger AS
SELECT c.part_id,
       p.vendor_id,
       p.category_id,
       m.field_key,
       COALESCE(f.state::text, 'gap_unattempted') AS state,
       (SELECT count(DISTINCT psc.source_id)
          FROM part_source_checks psc
          JOIN source_fields sf ON sf.source_id = psc.source_id
                               AND sf.field_key = m.field_key
                               AND (sf.category_id IS NULL OR sf.category_id = p.category_id)
         WHERE psc.part_id = c.part_id AND psc.outcome IN ('facts_found', 'no_facts', 'not_listed')) AS sources_checked,
       (SELECT count(DISTINCT s.id)
          FROM sources s
          JOIN source_fields sf ON sf.source_id = s.id
                               AND sf.field_key = m.field_key
                               AND (sf.category_id IS NULL OR sf.category_id = p.category_id)
         WHERE s.enabled) AS sources_capable
FROM completeness c
JOIN parts p ON p.id = c.part_id
CROSS JOIN LATERAL jsonb_array_elements_text(c.missing) AS m(field_key)
LEFT JOIN facts f ON f.part_id = c.part_id AND f.field_key = m.field_key AND f.superseded_by IS NULL;
