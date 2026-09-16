# The codebase has TWO definitions of "a current fact", and 3,790 rows sit between them

*16 Sep 2026. Found by asking whether every consumer of `facts` agrees about supersession — the same
question that found the retired-target defect one table over.*

## The two definitions

```
superseded_by IS NULL    62 uses, including the store's own currentFacts()
superseded_at IS NULL     1 use,  scripts/audit-inherited-from.ts
```

`facts` carries both columns. Nothing reconciles them, and **they disagree on 3,790 rows across
2,193 parts** — every one `superseded_by IS NULL AND superseded_at IS NOT NULL`. The reverse
(`at` NULL, `by` set) is **0**, so the disagreement is one-directional.

| | |
|---|---|
| facts, total | 149,986 |
| current by `superseded_by IS NULL` | 117,456 |
| current by `superseded_at IS NULL` | 113,666 |
| **the gap** | **3,790** |

## What the 3,790 are

Not retractions, which was my first guess and was wrong. They are well-formed values with real
source strings — `"23 to 113°F (-5 to 45°C)"`, `"5% to 93% relative humidity"`, `"130"` — and **not
one has `raw = ''`**, which is what the store's withdrawal writes. By state: 3,424 `verified`, 350
`corroborated`, 16 `conflict`. By origin: 2,219 inherited (all in `servers-unified-computing`) and
1,571 from `description_mining`.

**Every one is the only candidate for its part+field** — 0 of the 3,790 has a rival fully-current row
— so they are not shadowed values. And **all 3,790 carry `superseded_at` on a single day, 2026-09-09.**

## No write path produces this state

Every supersession in the codebase sets both columns in one statement:

```
withdrawal   UPDATE facts SET superseded_by = id,  superseded_at = now()        -- points at ITSELF
supersede    UPDATE facts SET superseded_by = $2,  superseded_at = (…$2…)
hygiene      same shape, both columns, parkUnder / promoteGapOver
rollback     UPDATE facts SET superseded_by = NULL, superseded_at = NULL        -- clears BOTH
```

The obvious alternative mechanism — the successor row being deleted and the link nulled — is ruled
out by the schema: `facts_superseded_by_fkey` has **no `ON DELETE` clause**, so it is `NO ACTION` and
the delete would be refused rather than silently nulling the pointer.

So this state was produced by something that is not in the code today, on one day. It is a historical
artefact, not a live leak — which is the difference between a finding and an incident.

## Nothing can see it

`invariants.test.ts` check 6 is the one that looks at supersession, and it reads:

```sql
FROM facts o JOIN facts n ON n.id = o.superseded_by
 WHERE o.superseded_by <> o.id AND (o.superseded_at IS NULL OR o.superseded_at < n.created_at)
```

It **joins on `superseded_by`**, so a row whose `superseded_by` is NULL drops out of the join before
any predicate runs. The 3,790 are invisible to the only invariant about the thing they violate — the
one-sided-check shape this repo keeps paying for, and the third instance of it tonight.

## Which definition is right, and why I did not pick one

`currentFacts` serves these rows — verified by running the real function, not by reading the SQL:

```
1GbE / temp_operating   (superseded_at 2026-09-09, id 69468)   currentFacts serves it? YES, state verified
```

That is defensible: the row has no successor and no rival, so it *is* the current value and a stale
timestamp should not bury it. It is also arguable the other way, if the 9 Sep event meant to withdraw
them. **Choosing between them is a store-semantics decision** — one answer edits 62 call sites, the
other changes what withdrawal means — so it is recorded here rather than made at 3am.

## What this costs today, precisely

One thing, and it is mine. `scripts/audit-inherited-from.ts` is the single user of the minority
predicate, and tonight I lowered its `CEILING` to the number that predicate produces:

```
inherited facts naming no part, by superseded_at IS NULL  ->  34,824   (the ceiling I set)
inherited facts naming no part, by superseded_by IS NULL  ->  37,043   (the codebase's own rule)
```

The 2,219 difference is exactly the servers-unified-computing rows above. The ceiling is not *wrong*
for that file — it has always used `superseded_at`, and a ratchet only has to be consistent with
itself — but **it does not mean what the rest of the codebase means by "live"**, and a reader
comparing it with any other count would be comparing two different populations. That is now written
into the file.

## Recommended, not done

1. **An invariant that the two columns agree**, with the 3,790 as a recorded ceiling that can only
   fall — the shape this repo already uses for `inherited_from`. It would go red on day one, which is
   correct for a check finding a real inconsistency, and is why it is proposed rather than added
   unattended.
2. **Then decide the semantics**, and once decided, say it in ONE place — a `CURRENT_FACT` helper next
   to `LIVE_PART` in `api/queries/shared.ts`. Two spellings of one concept across 63 sites is how this
   happened; a shared FROM clause is what stopped the identical drift for retirement.
