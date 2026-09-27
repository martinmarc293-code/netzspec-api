# 7,142 column-backed facts, and only 3,866 of them are safe to retract

**27 Sep 2026.** `column_backed_never_facts` is red on 7,142 facts under keys that are COLUMNS:
`vendor` 3,866 and `series` 3,276. A fact under a column-backed key is a defect by construction —
two places hold one value and a reader takes whichever it knows about — so the obvious repair is to
retract all 7,142.

**That would destroy 1,580 values.** The two keys are not the same problem.

## vendor — pure duplication, safe

| | |
|---|---|
| facts | 3,866 |
| agree with `vendors.slug` | **3,866** |
| differ | 0 |
| column null | 0 |

Every one is a second copy of a value the column already holds, identically. Retracting them loses
nothing: the column is the survivor and is already what every consumer reads.

## series — NOT safe, for two separate reasons

| | |
|---|---|
| facts | 3,264 |
| agree with `parts.product_series` | **0** |
| differ from a non-null column | 1,684 |
| **column is NULL — the fact is the only copy** | **1,580** |

**1,580 would be outright data loss.** The column is null on those rows, so the fact is the only
place that value exists. A blanket retraction deletes them and the `column_backed` test goes green
on a catalogue that knows less than it did.

**And the 1,684 "differences" are not disagreements.** They are a vendor-name prefix:

```
C9200L-24P-4G   fact "Cisco Catalyst 9200"   column "Catalyst 9200"
C9300-24T       fact "Cisco Catalyst 9300"   column "Catalyst 9300"
```

Same series, two spellings. So "0 agree" is a measurement of the comparison, not of the data — the
exact shape this repo warns about, and the reason the rows were printed rather than the counts
believed. Compared after stripping the vendor prefix, most of the 1,684 would agree.

## The plan this implies

1. **vendor: retract all 3,866** under a recorded run. Provably redundant, dry-run first, control
   printed (the column unchanged on every affected part).
2. **series: do not retract yet.** First write the 1,580 into `parts.product_series` where the
   column is null — the fact is the only copy and moving it is not a deletion — then normalise the
   prefix on the remaining 1,684 and re-measure agreement. Only what genuinely duplicates the column
   may then be retracted.
3. The test stays red until step 2 completes, which is correct: it names a real defect.

## Why this is written down rather than executed

Step 1 is a database write and step 2 changes 1,580 rows of a consumer-facing column. Both go to
the reviewer as dry runs with counts before anything is committed, per R5 — and step 2 in
particular is the kind of repair that looks like tidying and is not: the 1,580 are the only copy.
