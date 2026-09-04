-- 0007_image_candidates.sql — the image pipeline's inbox.
--
-- Until now `images` held only ASSIGNMENTS the operator had already decided on (the one-off
-- `scraper/images.py run --from-picks` of 3 Sep 2026: 2,736 Cisco rows). Meanwhile every
-- distributor page the workers fetch records `result.images` and apply-acquired threw all of it
-- away for a non-vendor source — 61,229 hardware parts with no picture while the URLs of their
-- pictures went past every night.
--
-- A candidate is NOT an assignment. It is "this page, on this source, showed this image URL for
-- this part". Nothing about it is trusted yet: a distributor's "product photo" is very often the
-- category banner, the site logo or a 1x1 spacer, and a WRONG picture on a part page is worse
-- than no picture. The fetch lane (`scraper/images.py run --from-db`) leases candidates, fetches
-- the bytes, and either promotes one to an `images` row with its WebP variants or marks the
-- candidate `rejected` WITH THE REASON, so the refusal is on record and countable rather than
-- silent.
--
-- Identity is (part_id, source_id, url_key), so re-applying the same day's pages — which happens
-- every nightshift cycle — updates one row instead of growing the table. `url_key` is the
-- normalised image URL (scheme dropped, host+path lower-cased, query dropped, the resizing
-- segments a CDN inserts removed); it is computed by src/core/imageCandidate.ts and by
-- scraper/images.py from the SAME rules file, data/schema/image-rules.json, so the two cannot
-- drift into disagreeing about what "the same image" means.
--
-- Statuses, and why there are exactly four:
--   pending   never fetched, or fetched and failed with attempts left. The lane's input.
--   done      the bytes were fetched, validated and promoted; `image_id` names the row.
--   rejected  TERMINAL and reasoned: placeholder-url, shared-across-parts, tiny-image,
--             unsupported-format, generic-content, part-already-has-image. Never retried.
--   failed    the fetch itself did not succeed (blocked, timeout, 5xx). Retried while
--             `attempts` < the lane's limit; "could not check" is not "is broken" (CLAUDE.md §6).

CREATE TABLE image_candidates (
  id           bigserial   PRIMARY KEY,
  part_id      bigint      NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  source_id    smallint    NOT NULL REFERENCES sources(id),
  page_url     text        NOT NULL,          -- the page that showed it, for the audit trail
  image_url    text        NOT NULL,          -- the URL actually fetched (the largest seen for this url_key)
  url_key      text        NOT NULL,          -- normalised identity; see src/core/imageCandidate.ts
  role         text,                          -- 'primary' | 'gallery' | ... as the ADAPTER reported it, untrusted
  alt          text,                          -- the page's own alt text; evidence, never a part name (docs/SCRAPING.md)
  kind         text,                          -- adapter's own label for the image, when it gives one
  width_hint   int,                           -- from the URL's own query (?width=316); used only to prefer the larger original
  height_hint  int,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected', 'failed')),
  reason       text,                          -- REQUIRED in practice for rejected/failed; the named reason, not a boolean
  image_id     bigint      REFERENCES images(id) ON DELETE SET NULL,
  attempts     smallint    NOT NULL DEFAULT 0,
  leased_at    timestamptz,                   -- a lease older than 30 min is reclaimed, as fetch_queue does
  seen_at      timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  run_id       bigint      REFERENCES runs(id),
  UNIQUE (part_id, source_id, url_key)
);

-- the lane's own query: pending/failed candidates, cheapest first
CREATE INDEX image_candidates_open_idx ON image_candidates (status, source_id, attempts) WHERE status IN ('pending', 'failed');
-- "how many different parts claim this same picture" — the placeholder rule that catches a
-- category banner no substring pattern could recognise (router-switch's routers-cisco.jpg)
CREATE INDEX image_candidates_urlkey_idx ON image_candidates (url_key);
CREATE INDEX image_candidates_part_idx ON image_candidates (part_id);
