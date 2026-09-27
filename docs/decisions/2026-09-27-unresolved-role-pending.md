# An unresolved role holds its cups open — for demotions *and* additions

**27 Sep 2026.** Reviewer decision, after the change collided with a test that was defending the opposite.

## What was there, and it was deliberate

`tests/routerKind.test.ts` asserted an **asymmetric** design and defended it with a sabotage:

- *"role DEMOTION: flash is required of the core and of branch, optional (never na) for smb"*
- *"role ADDITION: dram is required of industrial-iot only; **the unresolved role gets OPTIONAL, not
  pending**"*
- *"**SABOTAGE** a demotion written with `ne` would wrongly close flash for an unresolved router
  (`notInList` keeps it)"*

Read together: at an unresolved role a **demotion keeps** its cup and an **addition does not add** its
cup. The core set was the floor, and a part nobody could place was asked the floor and no more. The
mechanism that delivered it was `notInList` returning **true** for an absent `deploy_role` — the very
behaviour a later reading called a defect — and its author wrote a sabotage so nobody would replace
`notInList` with `ne` and silently lose it.

That sabotage did its job: it stopped the change, and it is the reason this file exists rather than six
assertions being quietly rewritten.

## What actually differed

`required_total` counts `req` **and** `pending`, so the two halves are not the same size:

| cup | before | after | effect on the denominator |
| --- | --- | --- | --- |
| `flash` (demotion) | `req` | `pending` | **none** — counted before, counted now; only the label moved |
| `dram` (addition) | `opt` | `pending` | **grows** — not counted before, counted now |

So the demotion half preserves its intent exactly ("an unplaced router is not let off flash"), and the
addition half is the real change. **Live impact: zero.** The freeze reports 8,992 parts on a role axis
and **0 unresolved** — the only scored parts that ever had an underivable role were the 18 the role-table
refusal now removes from scoring. The shape was decided against a population of nobody, which is the
cheapest moment to decide it and also the moment when nothing forces the answer.

## The decision: `pending`, both halves

The reviewer's reasoning, which is stronger than the symmetry argument and is why this went their way:

> the resolver already made this decision everywhere else and `routerKind` is the one place that predates
> it. `rack_units` is a role-addition in all but name — asked only when `form_factor` says rack-19 — and
> an unanswered `form_factor` leaves it *pending*, 17,603 times in the freeze. `stacking_bandwidth` on
> `stackable`, `poe_budget` on `poe_standard`, `psu_redundant` on `psu_config`: **41,204 pending cups
> exist today because "the gate is unanswered" resolves to "hold it open and name the gate."** A
> role-addition at an unresolved role is the same shape with a different gate. Treating it as optional
> would make `deploy_role` the one gate in the mould whose dependents are let off when it is unanswered —
> and the reason would be a design written before `pending` existed.

**The argument for `optional` is real and is recorded here:** an addition is by definition not what every
member of the kind is bought on, so demanding it of a part we cannot place asks for something we have no
evidence applies. What decides it is that the mould does not need to *demand* `dram` of an unplaced
router — it needs to say *"I cannot tell whether this part owes `dram` until someone derives its role"*,
which is what `pending` says and `opt` does not. And the cost falls only on unplaced parts, which the
kind-issue plan (G1) requires to be 0 or planned, so growing their denominator is pressure in the right
direction.

## What replaced the sabotage

It was **retired, not rewritten**, because it can no longer fire. With the leaf fixed, `ne` and
`notInList` are **identical at `undefined`** — both evaluate false, neither is settled, both resolve to
`pending` — so "a demotion written with `ne` would wrongly close flash" has no distinguishing case left.
It would pass whatever anyone wrote, which is worse than no case, because it reads as protection.

Two cases that *can* fire replace it:

1. at an unresolved role, a demotion cup and an addition cup are **both `pending`**, and both name
   `deploy_role` as the gate;
2. **sabotage**: a resolver returning `opt` for the addition half fails — the pre-27-Sep design, stated as
   a test rather than a comment, so reverting it silently is not possible.

The retired assertion's text is quoted verbatim in `tests/routerKind.test.ts` beside its replacement, so
a reader who goes looking for it finds *why* it changed rather than finding it gone.
`tests/switchKind.test.ts` carries the same decision for `fabric_bandwidth`, `latency` and `mounting`.

## What did not change

Every role block. A router placed in `branch` still owes `flash` and `dimensions`; one placed in `smb`
still owes neither; `industrial-iot` still owes `dram`. The discrimination lives where it belongs — in the
roles — and only the case where no role could be derived is held open instead of being answered by
default in one direction or the other.
