# The five "red by design" suites are TWO groups, and only three would clear on a rebuild

*16 Sep 2026. Written after verifying a phrase I had repeated all session without checking it.*

## The phrase, and what it was hiding

I have been reporting the same sentence every tick: *"five red by design until the step-5 rebuild."*
Tonight two of my own notes turned out to be wrong when I finally read the failures they described
(`inheritedFrom` was not a test; `migrate-atlas` does not fail an assertion, it crashes), so this one
got read too. It is wrong in the same way — a group assembled by assumption rather than by evidence.

Three of the five say, in their own output, exactly which command rebuilds them:

| suite | its own words |
|---|---|
| `arrangementFreeze` | *"the committed freeze predates layer 3 — `npx tsx scripts/build-freeze.mts --vendor cisco`"* |
| `cupLedger` | *"built before the kind-layer infra, rebuild: "* + all **17** category ledgers, by name |
| `completeness` | *"run `npx tsx scripts/build-completeness.mts --vendor cisco`"*, on every one of its 5 misses |

Those are stale ARTIFACTS. A rebuild clears them and nothing else needs deciding.

**The other two are not artifacts. They are open cup-side decisions, and a rebuild would not touch
them.**

## `source-fields`: 17 required fields that no enabled source publishes

The check is the one this repo already credits with catching an over-reach — *ask what the sources
can actually supply before deciding what the schema will demand*. It is failing on 17 pairs:

```
servers-unified-computing, unified-communications, hyperconverged-systems,
hyperconverged-infrastructure, collaboration-endpoints, conferencing   ->  dimm_slots, pcie_slots
transceiver  ->  tuning_range
security     ->  flows_per_second, max_endpoints, new_conn_per_sec
wireless     ->  link_budget
```

Each reads *"required by the profile and no enabled source publishes it"*. That is this file's oldest
named defect — **a required field that nothing can ever fill is a permanent gap, not a recorded
one** — sitting in the profiles of six categories at once.

It is not mine to resolve, for a reason stronger than caution: **`dimm_slots` and `tuning_range` are
the exact two fields on which a demote-recommendation was already shown to be wrong.** A sheet
earlier in this session said `dimm_slots` had "41 labels and NOT ONE of them is a DIMM-slot count";
read in full there are 42, and two are the literal string `DIMM slots`. It said `tuning_range` had no
label meaning *tunable*; there are seven. So the cheap answer here (demote them) has already been
attempted and already been caught, and the expensive answer (an alias rule per field, measured across
all vendors) is a dictionary change — which the standing rules put behind a recorded decision and a
measurement over every vendor, not one worktree's census.

## `securityShapes`: two archetype proposals, not yet applied

```
management / Security Manager / managed_devices_max -> req: got "opt"
    (kind-layer: MANAGEMENT archetype proposal (was opt: no enabled source publishes a label))
drive / Defense Center / drive_form_factor -> req: got "opt"
    (DRIVE archetype proposal (the NEW key the foundation created))
```

The suite encodes a PROPOSED cup set and the profiles still hold the old one. Note the parenthesis on
the first: *"was opt: no enabled source publishes a label"* — it is the **same question** as
`source-fields`, one layer up. Promoting a field to `req` when nothing publishes it is precisely what
creates the permanent gaps the other suite is refusing. These two reds argue with each other, and
that disagreement is the decision, not a defect to clear.

## What I did, and did not, do

**Did not run the rebuild**, though three suites name their command and it would take the reds from 7
to 4. The arrangement rules are explicit that it is one unit — *"it ships with the rebuilt ledgers,
censuses, traces, the completeness report AND the regenerated freeze file on the SAME commit; never a
ledger from one build and a dictionary from another"* — so there is no safe partial, and a full
rebuild freezes an arrangement with two open questions inside it. Running it would also make the
three greens look like progress while the two that matter stayed red and less visible.

**Did** correct the framing, because "five red by design" invites exactly the wrong next action: it
reads as one chore, when it is three chores and two decisions.

## The state, said accurately

```
npm run test:db   86 / 93        (was 83/93 at the start of the session)
  3  stale artifacts   arrangementFreeze, cupLedger, completeness   -> one coordinated rebuild
  2  open decisions    source-fields, securityShapes                -> cup side; not a rebuild
  1  recorded          migrate-atlas   legacy, do-not-re-run, crashes against 0010
  1  environment       apply-acquired  fixture page absent from this machine's cache
```

Zero unexplained failures, which is the thing that changed tonight. Every red now has a written
reason, and two of them are questions rather than chores.

## The rule

**A group of failures assembled under one phrase should be re-read before the phrase is repeated.**
"Red by design" is a claim about WHY, and I had checked it for three suites and extended it to five,
which is the same shape as reading eight labels of forty-one and writing "every one". The tell was
available at zero cost the whole time: three of them print the command that fixes them, and two print
a field name and a profile.
