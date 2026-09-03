-- 0001_init.sql — the canonical store for network-hardware facts.
--
-- Why this shape (read docs/DATA_MODEL.md for the long version):
--   * A part is identity only. Everything known ABOUT a part is a FACT row with its own source,
--     tier and state, because the value of this dataset is that every number can be traced.
--   * Facts are append-only. A newer value SUPERSEDES the old row, it never overwrites it, so
--     "what did we say last month" and "what changed since" are plain queries.
--   * Corroboration is evidence rows, not a flag: a fact is corroborated because two independent
--     documents say so, and both documents are on record.
--   * Every write happens inside a RUN, and a run that writes facts must carry a passing gate.
--   * The dictionary is a table with a foreign key from facts: an unknown field key cannot be
--     stored, which is the invariant that used to be a silent `continue` in the old pipeline.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------------------------

CREATE TABLE vendors (
  id          smallserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,          -- 'cisco'
  name        text NOT NULL,                 -- 'Cisco'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          smallserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,          -- 'switches'
  name_en     text NOT NULL,
  name_de     text NOT NULL,
  -- false = a category whose members are software/services/licences; no physical spec profile is
  -- expected and its parts are not counted as a spec gap. Per-part product_class overrides this.
  is_hardware boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 100
);

CREATE TYPE product_class AS ENUM ('hardware', 'license', 'service', 'software', 'accessory', 'bundle', 'unknown');

CREATE TABLE parts (
  id                    bigserial PRIMARY KEY,
  vendor_id             smallint NOT NULL REFERENCES vendors(id),
  sku                   text NOT NULL,       -- exactly as the vendor writes it: case and the Cisco spare '=' suffix both matter
  sku_norm              text GENERATED ALWAYS AS (upper(sku)) STORED,
  slug                  text NOT NULL,       -- url-safe, unique per vendor
  category_id           smallint NOT NULL REFERENCES categories(id),
  family                text,                -- 'Cisco Catalyst 9200'
  product_class         product_class NOT NULL DEFAULT 'unknown',
  product_class_reason  text,                -- the rule that decided it, e.g. 'sku-prefix:CON-' or 'category:software'
  name                  text,                -- the vendor's own product name, language-neutral
  description           text,                -- the vendor's own one-line description (a fact, not our prose)
  name_doc_id           text,                -- document the name/description were read from (FK added below)
  datasheet_url         text,
  first_seen_source     text,                -- 'cisco-catalog-2026' | 'hexcat' | 'datasheet-enum'
  enumerated_at         date,
  review_tier           smallint,            -- 0 when an operator reviewed this part (HexCat), else NULL
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, sku),
  UNIQUE (vendor_id, slug)
);
CREATE INDEX parts_sku_norm_idx   ON parts (vendor_id, sku_norm);
CREATE INDEX parts_category_idx   ON parts (category_id);
CREATE INDEX parts_family_idx     ON parts (vendor_id, family);
CREATE INDEX parts_updated_idx    ON parts (updated_at, id);
CREATE INDEX parts_class_idx      ON parts (product_class);
CREATE INDEX parts_sku_trgm_idx   ON parts USING gin (sku gin_trgm_ops);
CREATE INDEX parts_name_trgm_idx  ON parts USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------------------------
-- sources and runs
-- ---------------------------------------------------------------------------------------------

CREATE TABLE source_docs (
  doc_id          text PRIMARY KEY,          -- sha1(url) first 16 hex chars, as the extractors already compute
  url             text NOT NULL UNIQUE,
  doc_type        text NOT NULL,             -- vendor_datasheet_html | vendor_datasheet_pdf | vendor_eol_bulletin | vendor_page | operator_review
  vendor_id       smallint REFERENCES vendors(id),
  title           text,
  doc_class       text,                      -- hardware_datasheet | eol_bulletin | licence | ordering | thin | other (classify-datasheets)
  fetched_at      date,
  content_sha256  text,
  cache_path      text,                      -- path inside the corpus store, relative
  tables          int,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_docs_type_idx ON source_docs (doc_type);

ALTER TABLE parts ADD CONSTRAINT parts_name_doc_fk FOREIGN KEY (name_doc_id) REFERENCES source_docs(doc_id);

-- Which parts a document itself enumerates. This is the ground truth that scopes family-level
-- facts: a series value may be inherited only by SKUs the document lists.
CREATE TABLE doc_parts (
  doc_id   text   NOT NULL REFERENCES source_docs(doc_id) ON DELETE CASCADE,
  part_id  bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, part_id)
);
CREATE INDEX doc_parts_part_idx ON doc_parts (part_id);

CREATE TYPE run_status AS ENUM ('running', 'succeeded', 'failed', 'aborted');

CREATE TABLE runs (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,                -- apply-specs | apply-lifecycle | apply-descriptions | migrate-atlas | images | enumeration | ...
  status       run_status NOT NULL DEFAULT 'running',
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  git_sha      text,
  inputs       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- file names + sha256 + flags: enough to reproduce
  gate         jsonb,                                -- precision-gate result; REQUIRED and passing for any run that writes facts
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- counts: inserted, superseded, conflicts, skipped, by reason
  notes        text
);
CREATE INDEX runs_kind_idx ON runs (kind, started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- vocabulary
-- ---------------------------------------------------------------------------------------------

CREATE TABLE field_dictionary (
  key                text PRIMARY KEY,       -- 'switching_capacity'
  type               text NOT NULL CHECK (type IN ('n', 'nr', 'b', 'e', 's', 'ls', 'struct')),
  unit               text,                   -- canonical unit; every stored value of this key is in it
  label_en           text NOT NULL,
  label_de           text NOT NULL,
  domain             jsonb,                  -- closed enum domain for type 'e'
  band               jsonb,                  -- [min,max] plausibility band for numerics
  shape              text,                   -- structural note for 'struct'
  etim               jsonb,                  -- verified ETIM feature codes, [] = closed gap
  icecat_feature_id  int,                    -- only ever from Icecat reference files, never guessed
  generated          boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category_profiles (
  category_id  smallint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  field_key    text NOT NULL REFERENCES field_dictionary(key),
  requirement  jsonb NOT NULL,               -- {kind:'req'|'opt'|'na'|'cond', when?: Condition}
  PRIMARY KEY (category_id, field_key)
);

-- ---------------------------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------------------------

CREATE TYPE fact_state AS ENUM (
  'verified',        -- tier <= 2 source, normaliser-parsed, no unresolved conflict
  'corroborated',    -- >= 2 independent tier <= 2 sources agree after normalisation
  'unverified',      -- only a tier-3 source, or a plausibility flag was raised
  'conflict',        -- sources disagree after normalisation; the field is HELD, never rendered
  'gap_confirmed',   -- tier-1 and tier-2 were checked for this part and the field is absent
  'gap_unattempted', -- no source checked yet
  'not_applicable'   -- the category profile marks it N/A for this part
);

CREATE TABLE facts (
  id              bigserial PRIMARY KEY,
  part_id         bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  field_key       text NOT NULL REFERENCES field_dictionary(key),
  value           jsonb,                     -- typed value in the canonical unit: number | {min,max} | {h,w,d} | boolean | string | string[] | struct
  value_num       numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric END) STORED,
  value_min       numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(value) = 'object' AND jsonb_typeof(value -> 'min') = 'number' THEN (value ->> 'min')::numeric END) STORED,
  value_max       numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(value) = 'object' AND jsonb_typeof(value -> 'max') = 'number' THEN (value ->> 'max')::numeric END) STORED,
  unit            text,
  raw             text NOT NULL,             -- the source string, ALWAYS retained: a normaliser bug is replayable
  state           fact_state NOT NULL,
  tier            smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),  -- 0 operator-reviewed · 1 vendor PDF · 2 vendor HTML/tool · 3 aggregator · 4 distributor
  method          text NOT NULL,             -- html_table | pdf_table | pdf_text | hexcat_seed | description_mining | product_name_mining | inherited
  doc_id          text REFERENCES source_docs(doc_id),
  locator         text,                      -- 't12:r9:c2' | 'description:<pattern-id>' — enough to re-find the cell
  extracted_at    date,
  norm_v          text,
  inherited       boolean NOT NULL DEFAULT false,
  inherited_from  text,                      -- the document/family scope a series value came from
  run_id          bigint REFERENCES runs(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  superseded_by   bigint REFERENCES facts(id),
  superseded_at   timestamptz,
  -- A verified or corroborated fact must be traceable to a document, unless an operator reviewed it (tier 0).
  CONSTRAINT facts_verified_needs_source CHECK (state NOT IN ('verified', 'corroborated') OR tier = 0 OR doc_id IS NOT NULL),
  -- Gap states carry no value; value states carry one.
  CONSTRAINT facts_gap_has_no_value CHECK (state NOT IN ('gap_confirmed', 'gap_unattempted', 'not_applicable') OR value IS NULL)
);
-- one CURRENT row per part+field; history rows are the superseded ones
CREATE UNIQUE INDEX facts_current_uq        ON facts (part_id, field_key) WHERE superseded_by IS NULL;
CREATE INDEX        facts_part_idx          ON facts (part_id) WHERE superseded_by IS NULL;
CREATE INDEX        facts_field_num_idx     ON facts (field_key, value_num) WHERE superseded_by IS NULL AND value_num IS NOT NULL;
CREATE INDEX        facts_field_state_idx   ON facts (field_key, state) WHERE superseded_by IS NULL;
CREATE INDEX        facts_doc_idx           ON facts (doc_id);
CREATE INDEX        facts_run_idx           ON facts (run_id);

-- Every document that supports a fact. Corroboration = two evidence rows from different documents.
CREATE TABLE fact_evidence (
  id            bigserial PRIMARY KEY,
  fact_id       bigint NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  doc_id        text REFERENCES source_docs(doc_id),
  locator       text,
  tier          smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),
  method        text NOT NULL,
  raw           text,
  extracted_at  date,
  run_id        bigint REFERENCES runs(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_evidence_fact_idx ON fact_evidence (fact_id);

-- Disagreements are recorded, never resolved by write order.
CREATE TABLE conflicts (
  id                 bigserial PRIMARY KEY,
  part_id            bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  field_key          text NOT NULL REFERENCES field_dictionary(key),
  kept               jsonb,
  rejected           jsonb,
  reason             text NOT NULL,
  kept_evidence      jsonb,
  rejected_evidence  jsonb,
  run_id             bigint REFERENCES runs(id),
  logged_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolution         text,
  resolved_by        text
);
CREATE INDEX conflicts_open_idx ON conflicts (part_id, field_key) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- lifecycle, relations, images, completeness
-- ---------------------------------------------------------------------------------------------

CREATE TYPE lifecycle_status AS ENUM ('active', 'eol_announced', 'end_of_sale', 'end_of_support', 'unknown');

CREATE TABLE lifecycle (
  part_id               bigint PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
  status                lifecycle_status NOT NULL,
  announce_date         date,
  end_of_sale_date      date,
  last_ship_date        date,
  end_of_sw_maint       date,
  end_of_vuln_support   date,
  last_day_of_support   date,
  bulletin_id           text,                -- 'EOL13773'
  doc_id                text REFERENCES source_docs(doc_id),
  source_url            text,
  successor_sku         text,
  successor_note        text,
  note                  text,
  verified_at           date,
  run_id                bigint REFERENCES runs(id),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lifecycle_status_idx ON lifecycle (status);
CREATE INDEX lifecycle_eos_idx    ON lifecycle (end_of_sale_date);
CREATE INDEX lifecycle_ldos_idx   ON lifecycle (last_day_of_support);

CREATE TYPE relation_kind AS ENUM (
  'successor', 'predecessor', 'compatible', 'module_of', 'hosts_module',
  'supports_transceiver', 'bundle_contains', 'license_for', 'accessory_for', 'equivalent'
);

CREATE TABLE relations (
  id            bigserial PRIMARY KEY,
  from_part_id  bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  to_part_id    bigint REFERENCES parts(id) ON DELETE SET NULL,
  to_sku        text NOT NULL,               -- retained even when the target is not (yet) a part of ours
  kind          relation_kind NOT NULL,
  tier          smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),  -- 1 vendor matrix/bulletin · 2 form-factor inference
  doc_id        text REFERENCES source_docs(doc_id),
  source_url    text,
  note          text,
  run_id        bigint REFERENCES runs(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_part_id, to_sku, kind)
);
CREATE INDEX relations_to_idx ON relations (to_part_id);

CREATE TABLE images (
  id                 bigserial PRIMARY KEY,
  part_id            bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  role               text NOT NULL DEFAULT 'primary',   -- primary | gallery | series
  source_url         text NOT NULL,                     -- the vendor's own CDN URL
  doc_id             text REFERENCES source_docs(doc_id),
  storage_path       text,                              -- relative path in IMAGE_DIR; NULL until downloaded
  width              int,
  height             int,
  format             text,
  bytes              int,
  sha256             text,
  alt_en             text,
  alt_de             text,
  assignment_method  text NOT NULL,                     -- caption-sku | caption-formfactor | product-figure | series | placeholder
  confidence         real,
  run_id             bigint REFERENCES runs(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (part_id, role, source_url)
);

CREATE TABLE completeness (
  part_id           bigint PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
  required_total    int NOT NULL,
  required_present  int NOT NULL,
  pct               numeric(5,1) NOT NULL,
  missing           jsonb NOT NULL DEFAULT '[]'::jsonb,
  no_profile        boolean NOT NULL DEFAULT false,     -- true = exclude from any average
  computed_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------------------------

CREATE TABLE api_keys (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  key_hash      text NOT NULL UNIQUE,        -- sha256 of the bearer token; the token itself is shown once and never stored
  scopes        text[] NOT NULL DEFAULT '{read}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- schema_migrations is owned by db/migrate.ts, which creates it before applying anything.

-- ---------------------------------------------------------------------------------------------
-- change tracking: any change to what is known about a part bumps parts.updated_at, which is
-- what /v1/changes pages over. Statement-level triggers with transition tables so bulk loads
-- cost one UPDATE per statement, not one per row.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_parts_by_part_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE parts p SET updated_at = now()
  FROM (SELECT DISTINCT part_id FROM changed) c
  WHERE p.id = c.part_id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION touch_parts_by_from_part_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE parts p SET updated_at = now()
  FROM (SELECT DISTINCT from_part_id AS part_id FROM changed) c
  WHERE p.id = c.part_id;
  RETURN NULL;
END $$;

CREATE TRIGGER facts_touch_ins AFTER INSERT ON facts REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER facts_touch_upd AFTER UPDATE ON facts REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER facts_touch_del AFTER DELETE ON facts REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();

CREATE TRIGGER lifecycle_touch_ins AFTER INSERT ON lifecycle REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER lifecycle_touch_upd AFTER UPDATE ON lifecycle REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER lifecycle_touch_del AFTER DELETE ON lifecycle REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();

CREATE TRIGGER images_touch_ins AFTER INSERT ON images REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER images_touch_upd AFTER UPDATE ON images REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER images_touch_del AFTER DELETE ON images REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();

CREATE TRIGGER relations_touch_ins AFTER INSERT ON relations REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_from_part_id();
CREATE TRIGGER relations_touch_upd AFTER UPDATE ON relations REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_from_part_id();
CREATE TRIGGER relations_touch_del AFTER DELETE ON relations REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_from_part_id();

-- Direct edits to a part row also bump updated_at unless the writer set it explicitly.
CREATE OR REPLACE FUNCTION parts_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER parts_updated_at BEFORE UPDATE ON parts FOR EACH ROW EXECUTE FUNCTION parts_set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- read views
-- ---------------------------------------------------------------------------------------------

-- Facts as a consumer sees them: current rows only, joined to their labels.
CREATE VIEW current_facts AS
SELECT f.id, f.part_id, f.field_key, d.label_en, d.label_de, d.type AS field_type,
       f.value, f.unit, f.raw, f.state, f.tier, f.method, f.doc_id, f.locator,
       f.extracted_at, f.inherited, f.inherited_from, f.run_id, f.created_at
FROM facts f
JOIN field_dictionary d ON d.key = f.field_key
WHERE f.superseded_by IS NULL;
