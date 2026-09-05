-- 0011_sources_proxy.sql — a source can be fetched through the residential proxy, and every byte
-- it costs is recorded.
--
-- WHY. itprice.com and router-switch.com answer this laptop's IP with a Cloudflare challenge that
-- the lane's warm profile no longer clears (scraping was stopped by operator order on 4 Sep 2026
-- for exactly that). The operator bought a DataImpulse residential plan: 5 GB of traffic through
-- an HTTP/HTTPS gateway. Residential traffic is charged PER BYTE, so it is a scarce resource and
-- the opposite of the datacentre egress every other lane uses — which is why this is a per-source
-- decision in a row and not a switch in the code. A lane that is not blocked has no business
-- spending the plan, and `direct` is the default for that reason.
--
--   sources.proxy          'direct'      the lane's own Chrome talks to the host (every lane today)
--                          'residential' the lane's Chrome is launched with the DataImpulse
--                                        gateway as its proxy, the route filter drops images,
--                                        media, fonts and analytics, and every byte is counted
--                                        against a daily budget (NETZSPEC_PROXY_DAILY_MB).
--   sources.proxy_country  optional ISO-3166-1 alpha-2 code the gateway should exit from, e.g.
--                          'de' or 'us'. NULL means "the gateway's default, wherever it lands".
--                          The worker lower-cases it: DataImpulse's username suffix is `__cr.de`.
--   fetches.proxy_bytes    bytes THIS fetch pulled through the gateway. NULL for a direct lane —
--                          which is the distinction that matters: 0 means "proxied and measured
--                          nothing", NULL means "this fetch cost the plan nothing at all". The
--                          watchdog's plan-level total is a sum over this column, so a lane that
--                          wrote 0 where it should have written a number is visible as a lane
--                          whose spend does not move while its page count does.
--
-- The daily budget itself is deliberately NOT a column. It is one number for the machine
-- (NETZSPEC_PROXY_DAILY_MB in .env) applied PER SOURCE, so two proxied lanes each get it; the
-- plan-level guard is the watchdog's 4 GB alarm over the sum of this column. docs/SCRAPING.md
-- § Residential proxy says why, and what to change if that turns out to be the wrong shape.
--
-- Idempotent and additive: every statement is IF NOT EXISTS or guarded, the new column has a
-- default, and the previous release (which selects named columns from `sources` and never writes
-- `fetches.proxy_bytes`) runs unchanged on it.

ALTER TABLE sources ADD COLUMN IF NOT EXISTS proxy         text NOT NULL DEFAULT 'direct';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS proxy_country text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sources_proxy_check') THEN
    ALTER TABLE sources ADD CONSTRAINT sources_proxy_check CHECK (proxy IN ('direct', 'residential'));
  END IF;
  -- Two letters or nothing. A country the gateway does not know is a silent fall-back to its
  -- default exit, so the shape is checked here and the code that builds the username never has
  -- to guess what 'Germany' or 'de-DE' was supposed to mean.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sources_proxy_country_check') THEN
    ALTER TABLE sources ADD CONSTRAINT sources_proxy_country_check
      CHECK (proxy_country IS NULL OR proxy_country ~ '^[A-Za-z][A-Za-z]$');
  END IF;
END $$;

COMMENT ON COLUMN sources.proxy IS
  'direct = this lane fetches from the machine''s own IP; residential = through the DataImpulse gateway, metered and budgeted';
COMMENT ON COLUMN sources.proxy_country IS
  'ISO-3166-1 alpha-2 exit country for the gateway (lower-cased into the username suffix __cr.<cc>); NULL = the gateway default';

ALTER TABLE fetches ADD COLUMN IF NOT EXISTS proxy_bytes bigint;
COMMENT ON COLUMN fetches.proxy_bytes IS
  'bytes this fetch pulled through the residential gateway; NULL when the lane was direct (which is not the same as 0)';

-- the watchdog sums this per source per UTC day, and once more over all days for the plan total
CREATE INDEX IF NOT EXISTS fetches_proxy_bytes_idx ON fetches (source_id, fetched_at)
  WHERE proxy_bytes IS NOT NULL;
