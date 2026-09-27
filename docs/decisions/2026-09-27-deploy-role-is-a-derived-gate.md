# `deploy_role` is a derived gate and is declared like one

**27 Sep 2026.** Reviewer finding; option (a) of three, chosen by the reviewer with two conditions, both met.

## The defect

`modular` and `deploy_role` are both in `COLUMN_BACKED` and both **derived from the SKU** — neither is ever read
from a datasheet. They were declared differently, and that gave them opposite outcomes on a missing derivation:

| gate | declaration | resolves to | a null derivation leaves its dependents |
| --- | --- | --- | --- |
| `modular` | `cond({field:"kind", inList:["router"]})` | `req` | **`pending`** — gap open, naming the blocker |
| `deploy_role` | `opt` | `opt` | **`opt`** — gap closed, silently |

`requirementFor` treats an `opt` gate's absence as "nobody is obliged to answer it", and
`tests/pendingRequirement.test.ts` records that as a deliberate decision. It is right for a field a **datasheet
supplies** and wrong for one we **derive**: when the derivation returns nothing, no amount of scraping will fill
it, so the honest state is `pending` — *we cannot say yet, and here is the field that would settle it*.

Three categories were worse still: `meraki` (nine cups), `unified-communications` and `data-center-networking`
**gate cups on `deploy_role` and never declared the cup at all**, so the gate resolved `na` and every dependent
settled. Same silent closure, one step further along.

### The premise that expired

`fieldSchema.ts:2372` and `tests/fieldSchema.test.ts:65` both justify `deploy_role` being `opt` with: *"2 facts
catalogue-wide and NO label maps to it, so it will never be answered."* That was measured and true on 12 Sep.
**The kind layer made `deploy_role` derived on 13 Sep**, and it is now answered for 9,010 parts. Neither comment
changed a line; the world underneath them did. Both now say so.

## The decision

`deploy_role` is declared `cond({field:"kind", inList: roleAxisKinds(category)}, {elseOpt:true})` — required of the
kinds that are **sold by a deployment role**, optional of everything else.

- **The kinds come from `AXIS`** in `src/core/deployRole.ts`, via `roleAxisKinds()`. A hand-kept copy in each
  profile would be a second list of what exists, which is the drift this repo pays for everywhere; derived, a kind
  added to `AXIS` tomorrow is admitted with nothing to remember.
- **Per kind, never category-wide** — a power supply in `routers` must not be asked for a deployment role.
- **Applied once, after the `GENERATED_PROFILES` merge.** The generated file declares `deploy_role: opt` in eleven
  categories and `sync-dictionary` rewrites it, so a hand-edit there is reverted on the next regeneration.
- **A category with no role axis keeps its plain `opt`.** `inList: []` would be a condition matching nothing:
  firing for nobody while reading exactly like a live rule.

## Measured

Reach was measured **on this change**, not carried over from the leaf fix it completes (`63a95c5`), because a
declaration can move slots a leaf change cannot.

- `requirementFor` level, HEAD against this tree over all **41,067** live Cisco hardware parts with the values
  `recompute-completeness` builds: **54 cup verdicts differ, `opt` → `pending`**, every one on the **same 18 PON
  rows** (`switches` `fabric_bandwidth`, `latency`, `mounting`).
- **Pipeline level: zero.** Those 18 are exactly the rows `928cb96` stopped scoring
  (`no_profile_reason = kind_refused_by_role_table`). Recompute over `switches` after this change wrote **0 rows,
  10,031 unchanged**, and the control is unchanged: **41,049 scored parts / 394,411 required slots.**
- Role-bearing population, asserted by `mould-verify derived_gate_nulls`: **9,010 parts across 6 (category, kind)
  pairs**, roles derived on all but the 18 the table refuses. **Could-not-derive: 0.**

## What is checked, and what a future edit must not do

- The pinned case in `tests/pendingRequirement.test.ts` **flipped** from `SETTLED` to `pending`, so the suite
  records the transition rather than absorbing it.
- Two cases assert the two gates now **resolve alike** (`req` on `kind=router`). Asserting only a dependent would
  let the asymmetry re-open and surface later as a cup that quietly stopped being asked.
- `derived_gate_nulls` asserts the **denominator**, not just the null count: a check that counts only nulls gets
  *greener* when a kind loses its axis. Floors rather than exact equality, because this catalogue grows and an
  exact 9,010 would go red on the next real import and teach everyone to ignore the colour.

## Artifacts rebuilt on this commit

Seven category profile hashes moved — `collaboration-endpoints`, `data-center-networking`, `meraki`, `routers`,
`switches`, `unified-communications`, `wireless`. Cup ledgers rebuilt for the five that have one, and the
arrangement freeze rebuilt. Two test fixtures were **given the roles the real derivation produces** rather than
left roleless: `rackPoe`/`partial` are `access` (what `deployRole` gives `C9200L-24P-4G` and `C9300-24P`) and
`dinNoPoe` is `industrial` (what it gives `IE-4000-4TC4G-E`). A fixture with no role was a state production never
produces, and `tests/cupLedger.test.ts`'s synthetic profile now declares `deploy_role` for the same reason.

One control changed meaning and is worth recording: it asserted that a core at an **unresolved** role *is asked*
`altitude_max` and not `latency`. That asymmetry was an artefact of the `notInList` defect — an unanswered role
satisfied `notInList ["smb"]`. Both role-gated cups are now **pending** at nothing-known, which is the honest
reading, and the discrimination lives where it belongs: in the role blocks, whose control passed throughout.

## Still open, reported not fixed

`conferencing` gates `wifi_generation` on `deploy_role` and has **no role-axis kind at all**, so that gate is dead.
Fixing it is a decision about what conferencing kinds are actually sold on, not a declaration change.
