-- 0012_parts_series.sql — the SERIES level, which the catalogue browses by and did not have.
--
-- WHAT WAS WRONG. `parts.family` was carrying SERIES values, not families:
--
--     switches   'Nexus 5000', 'Nexus 9000 Series Switches', 'Catalyst 6500 Series Switches'
--     servers    'UCS C-Series Rack Servers', 'Ucs B Series Blade Servers'
--     routers    'ASR 9000 Series Aggregation Services Routers'
--
-- Those are product LINES. A series and a family are not the same thing, so browsing
-- category -> series -> family -> part was impossible: the middle level existed under the wrong
-- name and the narrow level did not exist at all. 86,944 parts, every one of them affected.
--
-- AND THE VALUES DISAGREE WITH THEMSELVES. 'Nexus 5000' sits beside 'Nexus 9000 Series Switches'
-- for the same kind of thing, 'Ucs B Series Blade Servers' carries broken capitalisation, and
-- 'Cisco 2960S Switches' beside 'Cisco Catalyst 2960-X' names one line two ways. A grouping level
-- whose labels are not canonical groups nothing — the page would show the same series twice.
--
-- WHAT THIS MIGRATION DOES, and deliberately no more: it adds the COLUMNS and the indexes. It
-- does not populate them, because deriving a canonical series from an inconsistent free-text
-- label is a judgement that belongs in code that can be tested and re-run, not in a one-shot DDL
-- script nobody can replay. `scripts/derive-series.ts` fills them and can be run again when the
-- rules improve.
--
--   series        the canonical product line   'Catalyst 9300', 'Nexus 9000', 'UCS C-Series'
--   series_raw    the label it was derived FROM, kept so a wrong rule is traceable to its input
--                 rather than being an unattributable string
--
-- `family` is left exactly as it is. Re-deriving it to the narrower level is a separate change
-- with its own evidence; moving two levels at once would leave nothing to compare against.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS series      text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS series_raw  text;

-- Browsing is category -> series -> family, so that is the index the page will actually use.
CREATE INDEX IF NOT EXISTS parts_category_series_family_idx
    ON parts (category_id, series, family)
    WHERE retired_at IS NULL;

-- ... and a plain one for "everything in this series", which is the other page.
CREATE INDEX IF NOT EXISTS parts_series_idx
    ON parts (series)
    WHERE retired_at IS NULL AND series IS NOT NULL;

COMMENT ON COLUMN parts.series IS
  'Canonical product line (Catalyst 9300, Nexus 9000, UCS C-Series). Derived by '
  'scripts/derive-series.ts from series_raw; a series and a family are different levels.';
COMMENT ON COLUMN parts.series_raw IS
  'The free-text label the series was derived from, kept so a bad derivation is traceable.';
