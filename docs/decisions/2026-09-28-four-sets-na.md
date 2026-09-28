# `four_sets_sum`: `na = 0` is not 303 judgements, it is one missing rule over 77,098 cells

**Status: a measurement and a proposal for the reviewer. Nothing changed.**

The check's reasoning is right and worth quoting, because the size of what follows from it is the finding:

> `na` says a cup is NEVER applicable to this kind, which closes a gap permanently instead of leaving a
> crawler hunting for it for ever. A kind with `na = 0` is claiming every cup in its category could one day
> apply to it — which is false for every kind in this catalogue: a power supply has no uplink ports, a
> transceiver has no rack units. So `na = 0` is not a tidy default, it is an unbounded search.

Measured over the 232 (category, kind) pairs that hold live parts, resolving through the real
`requirementFor`:

    cups resolving OPT across them                                      78,914
    of those, held by NO part of that pair in ANY vendor                77,098   (97.7%)

    switches/memory      opt 448, never held 443        switches/drive   opt 448, never held 442
    switches/bundle      opt 449, never held 441        switches/fabric  opt 448, never held 440

## Why the evidence signal is useless here, which is the point

97.7% is not a finding about the corpus. A profile declares ~450 keys for its whole CATEGORY, and any one
kind legitimately touches a handful of them: a `switches/memory` module is not asked 443 cups because nobody
has filled them, it is asked them because the profile is written per category and `memory` is one of fifteen
kinds inside it. "No part of this pair holds this cup" is true of almost every cell and therefore licenses
almost nothing — and this catalogue already records why it licenses nothing at all on its own, in the
`not_parsed` / `not_published` distinction: nobody having one is not nobody being able to have one.

So marking `na` from evidence is out, and marking 77,098 cells by hand is not a task.

## The proposal: derive it, do not decide it

The kind layer ALREADY states what each kind is asked — that is what the cup sets and
`PHYSICAL_OBJECT_CUPS` are. `na` is their complement:

> a cup that is neither required nor conditional for a (category, kind), and is not in that kind's declared
> optional set, is `na` for that kind.

That turns 303 judgements into one rule plus the per-kind opt sets the profiles already carry, and it makes
the claim checkable: the day a part of that kind stores a fact for a cup marked `na`, something is wrong with
the kind's set and the store says so, which is the opposite of an unbounded search.

## The two hazards, both already paid for here

1. **A rule is read by whatever the caller hands it.** The licence-profile `na` marks of 8 Sep were written
   for 13,056 licences and landed on the 446 pieces of HARDWARE in the same categories, because
   `recompute-completeness` gives every non-hardware part `no_profile` before it ever looks up a profile.
   Any derivation of `na` has to be checked against the population that actually REACHES it, and the tell
   there was a per-branch count matching one sub-population exactly.
2. **`na` closes a gap permanently.** Getting a kind's opt set slightly wrong marks a fillable cup
   unfillable and nothing downstream can tell that from a real impossibility. So the derivation wants the
   same sabotage a gate gets: a cup wrongly excluded from a kind's set must show up as a refused fact, not
   as silence.

Neither is a reason to leave `na = 0`; both are reasons not to write 77,098 cells by hand or by evidence.
