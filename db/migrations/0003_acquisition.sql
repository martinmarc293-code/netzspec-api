-- 0003_acquisition.sql — where facts come from, and the queue that keeps scrapers busy day and
-- night without fetching anything twice.
--
--   sources        the registry of places we read, each with the tier a fact from it is worth
--   fetch_queue    the work list: one row per (source, task, key); workers lease, fetch, report
--   fetches        every fetch that happened, content-addressed on disk
--   part_aliases   GTIN/UPC/EAN and alternative part numbers — identity facts with a source
--   image_variants the WebP renditions of an image at the sizes Google Merchant wants
--
-- Design rules:
--   * A worker never decides what to fetch; it takes the next lease from the queue. Adding a
--     source or re-prioritising is a row change, not a code change.
--   * A page fetched is a page cached. Extraction runs over the cache, so a parser fix never
--     costs a second request to the host.
--   * Aggregators and distributors are tier 3 and 4. A fact only they state stays `unverified`;
--     the merge engine upgrades nothing on their word alone. They corroborate vendor facts and
--     fill gaps visibly labelled, which is exactly what they are worth.

CREATE TABLE sources (
  id             smallserial PRIMARY KEY,
  slug           text NOT NULL UNIQUE,     -- 'cisco-datasheets', 'provantage', 'router-switch'
  name           text NOT NULL,
  host           text NOT NULL,            -- host used for politeness accounting
  kind           text NOT NULL CHECK (kind IN ('vendor', 'aggregator', 'distributor', 'operator', 'standards')),
  tier           smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),   -- default tier of a fact from here
  politeness_ms  int NOT NULL DEFAULT 2000, -- minimum gap between two requests to this host
  enabled        boolean NOT NULL DEFAULT true,
  notes          text,                     -- what we take from it, what we do not, terms observed
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE fetch_status AS ENUM ('queued', 'leased', 'done', 'failed', 'skipped', 'blocked');

CREATE TABLE fetch_queue (
  id           bigserial PRIMARY KEY,
  source_id    smallint NOT NULL REFERENCES sources(id),
  task         text NOT NULL,              -- 'part-page' | 'search' | 'listing' | 'datasheet' | 'image' | 'eol'
  key          text NOT NULL,              -- the SKU, URL or listing id this task is about
  url          text,                       -- resolved URL once known
  part_id      bigint REFERENCES parts(id) ON DELETE CASCADE,
  priority     smallint NOT NULL DEFAULT 100,   -- lower runs first
  status       fetch_status NOT NULL DEFAULT 'queued',
  attempts     smallint NOT NULL DEFAULT 0,
  leased_by    text,
  leased_at    timestamptz,
  next_at      timestamptz NOT NULL DEFAULT now(),   -- back-off target after a failure
  last_error   text,
  result       jsonb,                      -- {fetch_id, cache_path, http_status, facts_extracted, ...}
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, task, key)
);
CREATE INDEX fetch_queue_pick_idx ON fetch_queue (source_id, priority, next_at) WHERE status IN ('queued', 'failed');
CREATE INDEX fetch_queue_part_idx ON fetch_queue (part_id);
CREATE INDEX fetch_queue_status_idx ON fetch_queue (status);

CREATE TABLE fetches (
  id              bigserial PRIMARY KEY,
  source_id       smallint NOT NULL REFERENCES sources(id),
  url             text NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  http_status     int,
  content_sha256  text,
  cache_path      text,                    -- relative to CACHE_DIR
  bytes           int,
  worker          text,
  doc_id          text REFERENCES source_docs(doc_id)
);
CREATE INDEX fetches_url_idx ON fetches (url, fetched_at DESC);

-- ---------------------------------------------------------------------------------------------
-- identity facts that are not "specs": barcodes and alternative part numbers
-- ---------------------------------------------------------------------------------------------

CREATE TABLE part_aliases (
  id          bigserial PRIMARY KEY,
  part_id     bigint NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('gtin', 'upc', 'ean', 'legacy_sku', 'variant_sku', 'vendor_alias', 'distributor_sku')),
  value       text NOT NULL,
  tier        smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),
  doc_id      text REFERENCES source_docs(doc_id),
  source_url  text,
  run_id      bigint REFERENCES runs(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (part_id, kind, value)
);
CREATE INDEX part_aliases_value_idx ON part_aliases (kind, value);

CREATE TRIGGER part_aliases_touch_ins AFTER INSERT ON part_aliases REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();
CREATE TRIGGER part_aliases_touch_del AFTER DELETE ON part_aliases REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION touch_parts_by_part_id();

-- ---------------------------------------------------------------------------------------------
-- images: renditions and merchant readiness
-- ---------------------------------------------------------------------------------------------
-- Google Merchant Center: at least 800x800 px recommended (100x100 minimum), JPEG/PNG/GIF/WebP,
-- no watermark, promotional text or border, product filling 75-90% of the frame on a white or
-- transparent background. We keep the original and emit WebP at 1200, 800 and 400 px square
-- (padded, never stretched), and record why an image is not merchant-ready rather than hiding it.

ALTER TABLE images ADD COLUMN merchant_ready   boolean NOT NULL DEFAULT false;
ALTER TABLE images ADD COLUMN merchant_issues  jsonb;      -- e.g. ["below-800px", "watermark-suspected", "not-white-background"]
ALTER TABLE images ADD COLUMN license_note     text;       -- 'vendor product photo (Cisco CDN)'
ALTER TABLE images ADD COLUMN source_id        smallint REFERENCES sources(id);

CREATE TABLE image_variants (
  id            bigserial PRIMARY KEY,
  image_id      bigint NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  variant       text NOT NULL,             -- 'original' | 'webp-1200' | 'webp-800' | 'webp-400'
  storage_path  text NOT NULL,             -- relative to IMAGE_DIR
  width         int NOT NULL,
  height        int NOT NULL,
  bytes         int NOT NULL,
  format        text NOT NULL,
  sha256        text NOT NULL,
  background    text,                      -- 'white' | 'transparent' | 'other', measured from the corners
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (image_id, variant)
);

-- ---------------------------------------------------------------------------------------------
-- seed: the sources we know today. Tiers follow docs/DATA_MODEL.md.
-- ---------------------------------------------------------------------------------------------

INSERT INTO sources (slug, name, host, kind, tier, politeness_ms, notes) VALUES
  ('hexcat',            'HexCat operator-reviewed seed',      'local',                 'operator',    0, 0,    'Datasheet-verified by the operator. Protected: never overwritten by extraction.'),
  ('cisco-datasheets',  'Cisco datasheets (HTML)',            'www.cisco.com',         'vendor',      2, 2000, 'Product datasheets and ordering tables. Facts only.'),
  ('cisco-datasheet-pdf','Cisco datasheets (PDF)',            'www.cisco.com',         'vendor',      1, 2000, 'UCS/HyperFlex spec sheets and other PDF-only datasheets.'),
  ('cisco-eol',         'Cisco end-of-life bulletins',        'www.cisco.com',         'vendor',      2, 2000, 'Milestone tables, affected PIDs, replacements.'),
  ('cisco-tmg',         'Cisco transceiver compatibility',    'tmgmatrix.cisco.com',   'vendor',      2, 2000, 'Optics-to-platform matrix. Tier-1 compatibility relations.'),
  ('meraki',            'Cisco Meraki',                       'documentation.meraki.com','vendor',    2, 2000, 'Datasheets and hardware pages.'),
  ('hpe-quickspecs',    'HPE / Aruba QuickSpecs',             'www.hpe.com',           'vendor',      1, 3000, 'QuickSpecs PDFs. Connection resets from datacentre egress; needs the browser lane.'),
  ('juniper',           'Juniper datasheets',                 'www.juniper.net',       'vendor',      2, 3000, 'Redirects into hpe.com since 2026; verify each run.'),
  ('arista',            'Arista datasheets',                  'www.arista.com',        'vendor',      2, 3000, 'Bot challenge on every path from datacentre egress; browser lane.'),
  ('fortinet',          'Fortinet datasheets',                'www.fortinet.com',      'vendor',      1, 3000, 'PDF datasheets per family.'),
  ('mikrotik',          'MikroTik product pages',             'mikrotik.com',          'vendor',      2, 2000, 'Spec tables on every product page; cleanest vendor source we have.'),
  ('ubiquiti',          'Ubiquiti tech specs',                'techspecs.ui.com',      'vendor',      2, 2000, 'Structured spec pages.'),
  ('extreme',           'Extreme Networks datasheets',        'www.extremenetworks.com','vendor',     2, 3000, NULL),
  ('dell',              'Dell networking documentation',      'www.dell.com',          'vendor',      2, 3000, NULL),
  ('nvidia',            'NVIDIA networking (Mellanox)',       'docs.nvidia.com',       'vendor',      2, 3000, NULL),
  ('icecat-open',       'Icecat Open Catalog',                'live.icecat.biz',       'aggregator',  3, 1000, 'Open brands only; Cisco/HPE require the full licence. GTIN and feature IDs.'),
  ('provantage',        'Provantage',                         'www.provantage.com',    'distributor', 4, 3000, 'Structured spec tables and UPC codes. Facts only, never prose or images.'),
  ('router-switch',     'Router-switch.com',                  'www.router-switch.com', 'aggregator',  3, 3000, 'Spec tabs and supported-device lists. Facts only, never prose or Q&A.'),
  ('itprice',           'ITprice',                            'itprice.com',           'aggregator',  3, 3000, 'Cisco global list price and basic specs. Per-SKU lookups only; no bulk mirror.'),
  ('cdw',               'CDW',                                'www.cdw.com',           'distributor', 4, 3000, 'Spec tables and UPC. Facts only.')
ON CONFLICT (slug) DO NOTHING;
