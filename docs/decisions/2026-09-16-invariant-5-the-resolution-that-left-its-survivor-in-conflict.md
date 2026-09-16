# Invariant 5: a resolution that closed both conflicts and left the survivor wearing `conflict` (16 Sep 2026)

**Read-only. Nothing written. The repair is named exactly and is the operator's to run.**

Invariant 5 — *no part has a conflict-state fact without an open conflicts row* — has been red in production with **51
rows**. The overnight report called it "a held field with nothing holding it" and left it, because the fix is a fact-state
write. This is what the 51 actually are.

## They are one thing, not fifty-one

| | |
| --- | --- |
| field | **`snmp_mibs`**, all 51 |
| category | switches, all 51 |
| written by | **run #70**, 4 Sep 2026, method `html_table` |
| current facts for that (part, field) | **exactly 1** each — the conflict-state row itself |
| conflicts rows | **2 each, 102 total, every one resolved** by `remerge` on 4 Sep |

The two resolutions per part are always the same pair:

```
rule:prefix_truncated   reason "higher tier rejected (2 > 1) and sources disagree"
rule:list_superset      reason "SAME_DOC_REEXTRACTION norm_v 1.5.0 -> 1.5.1 on <commit>"
```

Both are `remerge` doing exactly what it should: on one document re-extracted at a newer normaliser version it kept the
superset over the truncated prefix. `kept` and `rejected` differ in all 102 — this is not the "two nulls re-normalised to
the same nothing" class the repo recorded in September.

**So the dispute was settled correctly and the survivor's STATE was never restored.** `remerge` closed the conflicts rows
and left the winning fact in `conflict`.

## What it costs

`SERVED_STATES` is `verified, corroborated` — **a fact in state `conflict` is not served.** So those 51 switches carry a
correct, resolved `snmp_mibs` list that **nothing serves**: not the API, not the pages, not the shop feed.

It is not a completeness cost: **0 live cisco parts have a profile that requires `snmp_mibs`**, so no score moves. It is a
data-delivery cost — 51 parts silently withholding a value they hold.

Contained, too: across the whole catalogue the invariant-5 population is this one field. The other 51 conflict-state
`snmp_mibs` rows (102 in total) **do** have an open conflict and are correctly in dispute; the current states of the field
are `gap_unattempted` 364, `verified` 106, `conflict` 102, `corroborated` 6.

*(Method note: my first attempt to read the conflicts behind these joined `conflicts` to every conflict-state
`snmp_mibs` fact, which is all 102 — half of them parts that still have an open conflict. It printed four rows with
`resolved_at: null`, which flatly contradicted the finding, and that contradiction is what caught it. The adjacent
corpus is always the cheaper one to reach.)*

## The repair, stated exactly — NOT RUN

For each of the 51: **supersede** the conflict-state fact with a copy carrying the state its own resolution implies, in a
recorded run. Not an UPDATE — `facts` is append-only and the hard rule is *never overwrite a fact, supersede it*.

The one judgement in it, and the reason this is a decision rather than a cleanup: **which state the survivor should
take.** It is a single undisputed row, tier 2, `html_table`, from one document — `verified` on the face of it, but "what a
resolved survivor inherits" is a rule about the store's state machine and not a fact about these 51 rows. Whatever answer
is given should be written down as the rule, because `remerge` will produce this shape again.

**And the defect behind it is worth fixing at the source, or the 51 come back:** `remerge` resolves a conflict without
restoring the survivor's state. Today it has produced 51 rows on one field; every field it touches can produce more.

---

## The source defect, found and fixed (`b712984`) — the data repair is still the operator's

Reading the code after the rows, it had **two** parts, and only the first was the one I had predicted.

**One: the unhold sat inside the `agree` branch.** `unholdFact` refuses while any conflict on the pair is still open —
correctly — so on a pair holding *two* conflicts the agree unheld nothing (the other was still open) and the `rewrite`
branch never tried at all. Each of the 51 has exactly that pair: `prefix_truncated` is an **agree** (from
`agreementRule`) and `list_superset` is a **rewrite** (from the `list_union` action). The unhold now runs once per group,
after every decision in it.

**Two, which the regression test caught where I had not predicted it:** a `rewrite` goes through `applyMerge`, which
**supersedes** the disputed fact and writes a new one — and the new row inherits the entry's state, which is `conflict`.
So unholding `conflicts.fact_id` updated an already-superseded row and left the live one held. My first fix passed
typecheck and still failed the test, with the survivor sitting in `conflict` carrying the merged union value. `unholdFact`
now takes `(part, field)` and updates the **current** row.

`tests/db/remerge.test.ts` § 7b builds the production shape — one fact, two seeded conflicts, one agree and one rewrite —
and asserts all three things: both conflicts resolved, the survivor no longer `conflict`, and **invariant 5 holding on
the database afterwards**. Proved alive by disabling the group unhold (69/72, all three red, naming the state and the
union value); restored, 72/72, typecheck clean.

**This stops the 52nd. It does not repair the 51** — that is still the fact-state write described above, and still the
operator's.
