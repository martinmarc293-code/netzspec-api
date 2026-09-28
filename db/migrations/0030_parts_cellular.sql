-- 0030_parts_cellular.sql — does this part carry a cellular radio?
--
-- `cellular_bands` is OPTIONAL on every routers role — smb, branch, industrial-iot, sp-core alike — so when
-- the four Meraki Z teleworker gateways moved to `routers` under the reviewer's ruling there was no gate to
-- verify. The reviewer ruled one in: a derived, column-backed `cellular`, with `cellular_bands` conditional
-- on it and optional everywhere else, and Z4C-HW as the witness.
--
-- WHY A COLUMN AND NOT A CONDITION ON THE SKU. `modular` and `deploy_role` are already derived columns the
-- profiles gate on, for the same reason: a gate has to be readable by `requirementFor` against a part row,
-- and a rule that re-derives from the SKU inside the profile would be a second copy of `src/core/cellular.ts`
-- that nothing compares to the first.
--
-- THE DERIVATION IS SCORED, not asserted, and it was wrong twice before it was right. 62 parts already hold
-- a `cellular_bands` fact, which is a ground truth a derived gate can be measured against:
--
--   anchored (LTE not followed by a letter)   MISSED 6 of the 62 — C1111-4PLTEEA, C1117-4PMLTEEAWE
--   unanchored (LTE anywhere)                 62 of 62, and claimed 1,067 parts of which 374 were URL
--                                             FILTERING licences, because "fiLTEr" contains LTE
--   token-scoped (landed)                     62 of 62, 477 claimed catalogue-wide, no FILTER row among them
--
-- and `4G` / `5G` are refused outright, because in a Cisco SKU they read GIGABIT far more often than
-- cellular: CBS220-48T-4G is four 1G uplinks. Including that marker claimed 462 switches.
--
-- Nullable and not backfilled here, as 0026 through 0029 were: a migration that also writes values is two
-- changes wearing one name. NULL means not yet derived, never "no radio" — the populate run is
-- `scripts/derive-cellular.mts`, recorded, with its offered-vs-updated control.

ALTER TABLE parts ADD COLUMN IF NOT EXISTS cellular boolean;

COMMENT ON COLUMN parts.cellular IS
  'True when the part carries a cellular radio, derived from the SKU by src/core/cellular.ts. NULL means not '
  'yet derived, NOT "no radio" — a gate must be able to tell those apart, and `cellular_bands` pends on NULL.';

-- Read by `cellular_bands`'s gate, which asks for the true rows only.
CREATE INDEX IF NOT EXISTS parts_cellular_idx ON parts (cellular) WHERE cellular IS TRUE;
