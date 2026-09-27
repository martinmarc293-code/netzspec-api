# `four_sets_sum` demands `na`, which this repo deliberately removed two days ago

**27 Sep 2026.** Not implemented, and this records why rather than leaving the test red with no
explanation — a red that names a real defect stays red (R4), but this one names a demand the
arrangement has already answered in the opposite direction.

## The demand

`four_sets_sum` (A2, written today from the plan) asserts that for every kind,
`|req| + |pend| + |opt| + |na| = dictionary size` **and `na > 0`**. It is red on all 304
(category, kind) pairs because not one marks anything not-applicable. B4 was to fix it by deriving
`na` from a per-kind archetype, which I built (`src/core/kindArchetypes.ts`): 394 proposals, 8
vetoed by an own fact, 4,980 (category, kind, cup) slots.

## Why it is not being implemented

**`requirementFor` refuses to produce `na` by design, on an operator ruling of 25 Sep 2026**, and
the reasoning is measured and sits in the code beside the line:

> AN UNMET CONDITIONAL LEAVES THE CUP OPTIONAL. IT NEVER CLOSES IT (operator, 25 Sep 2026: "there
> should be zero non-applicable cups — all the cups are always applicable somewhere").

Measured at the time:

- profile entries were `req` 45, `opt` 5,522, `cond` 607, and **`na` chosen outright ZERO times**;
- 469 of the 607 conds left `elseOpt` unset, **closing 7,846 (category, kind, key) cups** by
  inheriting that default — `dimensions` closed in 222 places, `weight` 208, `certifications` 242,
  on parts that are physical objects;
- and the catalogue already contradicted the closures: **149 triples held 6,310 rendered values in
  a cup the profile had closed** — 1,277 CPUs with a `power_max` on a kind said to have no power
  draw, 169 WDM muxes with a `wavelength` on a kind said to have none.

The conclusion recorded there is the one that decides this: *"`na` is a claim about the WORLD that
the catalogue cannot verify; `opt` is a claim about nothing — accepted if a source provides it,
never a gap if none does. The only thing closing ever bought over optional was the power to refuse
a value, and that power was being used wrongly 6,310 times."*

It is also guarded: `tests/cupLedger.test.ts` asserts no kind closes any cup, *"so a reintroduced
`na` cannot pass unnoticed"*.

## And it would buy nothing

This is the part that settles it independently of the ruling. **`completenessV2` and
`requiredFieldsFor` count `req` and `pending` only.** `na` and `opt` are identical to every
denominator, percentage and stored row; `completeness` does not even have a column for `na`.

So my own claim to the reviewer — *"4,980 slots would gain an `na`, every one a gap a crawler stops
hunting"* — **was wrong**. Those cups are already `opt`, and `opt` is already "never a gap if none
does". Nothing would stop hunting anything. The archetypes would change one word in a resolution
nobody scores, at the cost of reintroducing the exact mechanism that hid 6,310 real values.

## What this means for the test

`four_sets_sum`'s sum half is sound and passes on all 304 pairs. Its `na > 0` half asks the
arrangement for something the arrangement has decided against, for measured reasons, with a test
guarding the decision — so it cannot go green without reversing an operator ruling.

That is a decision for the reviewer and the operator, not something to resolve by editing either
side. The three honest options:

1. **Drop the `na > 0` half** and keep the sum. The test then asserts that every cup has an answer
   for every kind, which is true, checkable, and does not contradict anything.
2. **Keep it red permanently** as a standing disagreement between the scoreboard and the
   arrangement, with this record as its explanation.
3. **Reverse the 25 Sep ruling**, which needs the operator and would need the 6,310 rendered values
   re-measured first, because they are what killed it last time.

I have not picked one. The archetypes are committed and unwired: they are useful regardless, because
they give B7 its split — an inherited fact under a cup *outside* a kind's archetype is a wrong pour,
one *inside* it is legitimately filled-inherited — and that use makes no `na` claim at all.

## The pattern, since this is the fourth time today

A reviewer ruling collided with a written decision in this repo four times in one session:
`video_codecs` (a domain would be invention), `cpu` and `display` (free text by decision, one amended
by the parent on the fill-path invariant), and now `na`. Each time the ruling was reasonable and each
time the repo had already answered with a measurement the ruling did not have in front of it.

The cheap defence is mechanical and it worked every time it was used: **before implementing a
ruling, grep for the thing it changes and read what is written beside it.** The code comment, not
just the code.
