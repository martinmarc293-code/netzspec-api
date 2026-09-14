# Whitespace twins (layers review round 2, A.5) — DONE — 14 Sep 2026

**Approved** by the reviewer and by the operator ("Yes, both", 14 Sep 2026), under these conditions: one recorded run with the
two migrations; dry-run counts predicted vs actual; facts deduped so a fact present on both twins is kept once; the spaced twin
retired, not deleted; the canonical row keeps facts, relations and links; the partial unique index extended to the
whitespace-folded SKU; 0 twins asserted afterwards; the run id recorded here.

## What ran

| step | id | commit |
|---|---|---|
| migration `0019_parts_whitespace_fold` — alias kind `whitespace_variant`, non-unique fold index `parts_sku_ws_fold_idx` | schema_migrations | 8137c7b |
| **run #1064** `hygiene-whitespace-duplicates --vendor cisco --commit` (succeeded) | runs.id 1064 | 8137c7b (the runs row carries no git_sha column value) |
| migration `0020_parts_whitespace_unique` — guarded `parts_vendor_sku_ws_uq` on `(vendor_id, lower(regexp_replace(sku,'[[:space:]]','','g'))) WHERE retired_at IS NULL` | schema_migrations | this commit |
| run #1065 `recompute-completeness --vendor cisco --category switches` (succeeded: 9,976 parts, 344 written) | runs.id 1065 | |

Measured across ALL vendors before 0019: cisco 10 groups / 20 rows, every other vendor 0.

## Predicted (dry run) vs actual (run #1064)

| | predicted | actual |
|---|---|---|
| groups / merges | 10 / 10 | 10 merged, 0 refused |
| current facts on the spaced rows | 80 | 80 parked as history under the survivor's current row: 20 `agree_same_doc` (the same value from the same document — kept once) + 60 `refused_inherit` (a family value the inheritance gate does not let reach the survivor, which holds its own) |
| history facts | 40 | 40 moved |
| relations | 340 | 340 already on the survivor (same to_sku + kind) — dropped as duplicates, the survivor's 340 kept |
| conflicts | 40 | 40 moved to the survivor |
| document links | 10 | 10 already on the survivor — dropped as duplicates |
| images | 0 | 0 |
| lifecycle rows | 10 | 10 identical — dropped |
| aliases | — | 10 `whitespace_variant` created |
| parts retired | — | 10, each `retired_into` its survivor, reason `whitespace_duplicate:no_whitespace` |
| twins after | 0 | **0** (read back by a new query in the same command; 0 again from a new connection, all vendors) |

The reviewer's 120 facts are 80 current + 40 history; the 340 relations match.

## Reversible

The ten spaced rows are retired, not deleted, and keep their exact SKU, their history facts on the survivor carry their original
ids and provenance, and each spelling resolves through its alias.

## Code

- `src/pipeline/hygiene.ts`: `decideWhitespaceGroup` (the unspaced row survives; refuses a tier-0 spaced row, a group with no
  unspaced row, or unspaced rows the case rule cannot separate), `readWhitespaceGroups`, `checkWhitespaceDuplicates` (prints the
  prediction), the commit through the existing `mergePartInto`.
- `src/store/parts.ts`: `upsertPart` and `findPart` look parts up by the same fold, so the enumeration that wrote
  `C9200L-48P- 4G` now lands on the survivor instead of hitting the new index.
- `tests/hygieneWhitespace.test.ts` 14/0 (refusals and a sabotage); `tests/layersStanding.test.ts` asserts 0 twins on the pages.
- Kept `parts_vendor_sku_ci_uq` (0010) beside the new index: it adds no restriction, but `tests/db/hygiene.test.ts` replays 0010
  by name on the shared test databases.
