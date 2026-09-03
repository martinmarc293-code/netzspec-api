-- 0005_watchdog.sql — the watchdog's audit trail and the per-source throughput it reasons from.
--
--   watchdog_events    one row per thing the watchdog saw or did: a junk key deleted, a source
--                      paused or backed off, a stall, a zero-yield or drift alarm, a resume.
--                      `acted` says whether the database was changed (an --act run) or the row
--                      only records an alarm. The report file is for a human tonight; this table
--                      is for the question "why is provantage disabled?" next week.
--   source_throughput  per source: tasks done in the last 1 h / 24 h / 7 d, raw facts reported in
--                      the last 24 h, and the median raw facts per listed page over 24 h against
--                      7 d. A 24 h median under half the 7 d median with enough pages is adapter
--                      drift: the site changed its markup and the parser is quietly reading less.
--
-- Rules:
--   * The watchdog is the only writer of watchdog_events, and only with --act. A report-only run
--     writes nothing anywhere (tests/scraper/test_watchdog.py asserts both).
--   * A resume is an event too: a source a human re-enables after a zero-yield pause is logged
--     as `resumed` the first time the watchdog sees it, so the pause/resume pair is in one place.
--   * Additive only (the previous release runs unchanged on it).

CREATE TABLE watchdog_events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  source_id  smallint REFERENCES sources(id),      -- NULL for events that are not about one source (junk sweep)
  kind       text NOT NULL CHECK (kind IN ('junk_deleted', 'source_paused', 'source_backoff', 'stall', 'zero_yield', 'drift', 'resumed')),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the numbers behind the verdict: counts, medians, keys, until
  acted      boolean NOT NULL DEFAULT false        -- true when the run changed the database because of this
);
CREATE INDEX watchdog_events_source_idx ON watchdog_events (source_id, at DESC);
CREATE INDEX watchdog_events_kind_idx ON watchdog_events (kind, at DESC);

-- "Listed pages" are done tasks whose result carries a facts count and whose outcome is not
-- not_listed: a page the site does not have says nothing about the adapter, and a datasheet
-- task (PDF lane) reports bytes, not facts, so it is excluded by the NULL.
CREATE VIEW source_throughput AS
WITH done AS (
  SELECT q.source_id, q.updated_at,
         CASE WHEN q.result ? 'facts' AND COALESCE(q.result->>'outcome', '') <> 'not_listed'
              THEN (q.result->>'facts')::int END AS page_facts
    FROM fetch_queue q
   WHERE q.status = 'done' AND q.updated_at > now() - interval '7 days'
)
SELECT s.id AS source_id,
       s.slug,
       s.enabled,
       s.politeness_ms,
       count(*) FILTER (WHERE d.updated_at > now() - interval '1 hour')  AS done_1h,
       count(*) FILTER (WHERE d.updated_at > now() - interval '24 hours') AS done_24h,
       count(*)                                                          AS done_7d,
       COALESCE(sum(d.page_facts) FILTER (WHERE d.updated_at > now() - interval '24 hours'), 0)::bigint AS facts_24h,
       count(d.page_facts) FILTER (WHERE d.updated_at > now() - interval '24 hours') AS pages_24h,
       count(d.page_facts)                                                           AS pages_7d,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY d.page_facts) FILTER (WHERE d.updated_at > now() - interval '24 hours') AS median_facts_per_page_24h,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY d.page_facts)                                                           AS median_facts_per_page_7d,
       (SELECT count(*) FROM fetch_queue q2 WHERE q2.source_id = s.id AND q2.status IN ('queued', 'failed')) AS queued
  FROM sources s
  LEFT JOIN done d ON d.source_id = s.id
 GROUP BY s.id, s.slug, s.enabled, s.politeness_ms;
