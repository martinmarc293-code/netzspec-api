-- 0028_parts_sub_brand.sql — the sub-brand a part is sold under, inside its vendor.
--
-- WHY A COLUMN. `vendor` is who makes it and `category` is what it is; neither can say that an MX105 is a
-- CISCO product sold as MERAKI. That distinction is not cosmetic: the 18 MX moved to `security` and the 4 Z
-- to `routers` on 28 Sep 2026 because an MX is a firewall and a Z is a router, and with the `meraki` category
-- no longer standing in for the brand, nothing on the row says which brand a buyer would search for. The
-- URL-prefix rule reads it.
--
-- NUMBERED 0028, NOT 0027 AS THE RULING SAID: 0027 is `parts_name_image_lifecycle_state`, already applied.
--
-- NULLABLE AND NOT BACKFILLED HERE, following 0026 and 0027. A migration that also writes values is two
-- changes wearing one name: the schema is reversible by a drop and the values are not. More to the point,
-- the values are not yet decided — the prefix rule the ruling proposed
-- (^M[SRXVGT]\d, ^Z\d, ^MA-, ^GR, ^GS) was measured over the live catalogue BEFORE this column existed to
-- write into, and it is wrong in both directions:
--
--   ^GS    466 hits, ZERO of which are Meraki — every one is the GS7000 cable-access optical node family
--          (GS7K-1.2G-DC12-35=, GS7KI-LA-1.2G). Meraki Go switches are GS110-nn and the catalogue holds NONE.
--   ^GR     39 hits, ZERO Meraki — GRWIC-* is the Connected Grid WIC line, plus one GROUND-LUG-KIT.
--   vendor  10 JUNIPER parts match ^M[SRXVGT]\d (MX2000-PSM-AC-BB, MX2K-MPC11E): sub_brand is Cisco's.
--   missed  70 parts SAY Meraki in their own name or series and the rule cannot reach them — 24
--           Meraki-managed Catalysts (the `-M` suffix: C9300L-48P-4X-M), 20 licences, 10 CW Catalyst
--           Wireless rows, 7 L-MX licences, 5 MCS placeholders, 3 NED-MERAKI, MGKIT-1.
--
-- So 505 of the rule's 929 hits would be wrong and 70 real ones absent. The populate run waits on the
-- reviewer settling the rule; this file only makes the column exist, and `DROP COLUMN` undoes it whole.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS sub_brand text;

COMMENT ON COLUMN parts.sub_brand IS
  'The sub-brand a part is sold under within its vendor (e.g. "meraki" for a Cisco MX). NULL means not yet '
  'derived, never "no sub-brand" — the derivation is a recorded run and is not part of this migration.';

-- Read by the URL-prefix rule and by any per-brand filter, both of which scan for a value rather than a range.
CREATE INDEX IF NOT EXISTS parts_sub_brand_idx ON parts (sub_brand) WHERE sub_brand IS NOT NULL;
