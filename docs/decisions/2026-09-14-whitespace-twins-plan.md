# Whitespace twins (layers review round 2, A.5) — DRY RUN, awaiting the operator's yes — 14 Sep 2026

**Reviewer item.** "Whitespace twins: fold whitespace in the unique index; merge the 10 switch groups."

Nothing below has been written to the database. The counts come from read-only queries (D:\tmp\a5-twins.mts, application
name `cisco/a5-twins-dryrun`) over live, unretired Cisco parts.

## The 10 groups (all `switches`, all Catalyst 9200L, all created 2026-09-03)

| survivor (no whitespace) | id | facts | conflicts | refs | twin (spaced) | id | facts | conflicts | refs |
|---|---|---|---|---|---|---|---|---|---|
| C9200L-24P-4G | 2001 | 29 | 13 | img 1, rel-to 9, rel-from 34 | `C9200L-24P- 4G` | 5787 | 12 | 4 | rel-from 34 |
| C9200L-24P-4X | 3101 | 29 | 14 | img 1, rel-to 7, rel-from 34 | `C9200L-24P- 4X` | 5789 | 12 | 4 | rel-from 34 |
| C9200L-24T-4G | 3097 | 26 | 11 | img 1, rel-to 9, rel-from 34 | `C9200L-24T- 4G` | 5786 | 12 | 4 | rel-from 34 |
| C9200L-24T-4X | 3100 | 26 | 11 | img 1, rel-to 5, rel-from 34 | `C9200L-24T- 4X` | 5788 | 12 | 4 | rel-from 34 |
| C9200L-48P-4G | 2006 | 29 | 14 | img 1, rel-to 8, rel-from 34 | `C9200L-48P- 4G` | 5791 | 12 | 4 | rel-from 34 |
| C9200L-48P-4X | 3103 | 27 | 11 | img 1, rel-to 10, rel-from 34 | `C9200L-48P- 4X` | 5794 | 12 | 4 | rel-from 34 |
| C9200L-48PL-4G | 3099 | 29 | 14 | img 1, rel-from 34 | `C9200L-48PL- 4G` | 5792 | 12 | 4 | rel-from 34 |
| C9200L-48PL-4X | 3104 | 29 | 14 | img 1, rel-from 34 | `C9200L-48PL- 4X` | 5795 | 12 | 4 | rel-from 34 |
| C9200L-48T-4G | 3098 | 26 | 11 | img 1, rel-to 9, rel-from 34 | `C9200L-48T- 4G` | 5790 | 12 | 4 | rel-from 34 |
| C9200L-48T-4X | 3102 | 26 | 11 | img 1, rel-to 5, rel-from 34 | `C9200L-48T- 4X` | 5793 | 12 | 4 | rel-from 34 |

Every member also holds 1 completeness row, 1 doc_parts row and 1 lifecycle row. Across all Cisco parts there are exactly
these 10 whitespace groups (the 127 case groups were merged earlier and are retired).

## Proposed mechanics (the existing case-duplicate machinery, one new fold)

1. **Code (no database):** a `whitespace-duplicates` hygiene check beside `case-duplicates`. Survivor = the one live row
   whose SKU has no whitespace (Cisco writes none); refuse a group with zero or two such rows, or an operator-reviewed
   (review_tier 0) spaced row. Merge via `mergePartInto` / `mergeFactsInto` (facts moved, a disagreement HELD as a conflict,
   never resolved by write order), loser RETIRED with `retired_into`, its exact spelling kept as an alias. A pure decision
   test and a sabotage case.
2. **Migration A:** allow the alias kind `whitespace_variant` on `part_aliases` (drop/re-add the check, as 0009 did).
3. **Lookups:** `findPart` / `upsertPart` fold whitespace as well as case, with an expression index, so the enumeration
   that produced `C9200L-48P- 4G` lands on the survivor instead of failing on step 5's index.
4. **Run (database write, needs the yes):** `npm run ingest -- hygiene whitespace-duplicates --vendor cisco --commit` —
   one run row, 10 merges, then `ingest recompute-completeness --category switches`.
5. **Migration B (the guard):** `CREATE UNIQUE INDEX parts_vendor_sku_ws_uq ON parts (vendor_id, lower(regexp_replace(sku,
   '\s', '', 'g'))) WHERE retired_at IS NULL`, preceded by a count guard that names the command, as 0010 does. It
   supersedes `parts_vendor_sku_ci_uq` (every case duplicate is also a whitespace-fold duplicate).

Order: code + migration A → migrate → run (step 4) → migration B → migrate. The index cannot be created while the 10 pairs
are live, which is why B waits.
