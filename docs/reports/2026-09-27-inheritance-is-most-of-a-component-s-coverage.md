# A power cord "has" eighteen specifications it never had read for it

**27 Sep 2026.** Measured while building the evidence veto for B4's archetypes, and it changes what
B4 can safely do.

## Why this was measured at all

`na` says a cup is NEVER applicable to a kind, which closes a gap **permanently**. This repo has
already paid for getting that wrong: 48 `na` marks written for licences in September landed instead
on the 446 pieces of *hardware* sharing those categories, telling real endpoints they had no weight
and no operating temperature — closing the gaps of the only parts that could still have filled them.

So no archetype may mark a cup `na` for a kind if any part of that kind **already holds a fact for
it**. A fact existing is proof of applicability and it outranks any judgement I would make.

That veto list is built from the live facts. The first version said `mechanical` — a bracket, a
cover — holds facts for **49 distinct cups**, and `cable` 49, and `accessory` 41. Those numbers are
not credible for a bracket, which is what sent me one column further.

## The measurement

`inherited` excluded, so a value counts only if it was read **for that part**:

| kind | own cups | inherited-ONLY cups | own facts | inherited facts | inherited share |
|---|---|---|---|---|---|
| accessory | 12 | **29** | 36 | 565 | **94%** |
| flash | 2 | **17** | 18 | 79 | 81% |
| power-cord | 5 | **18** | 64 | 255 | 80% |
| mechanical | 16 | **33** | 515 | 1,565 | 75% |
| fan | 11 | 27 | 250 | 566 | 69% |
| power | 33 | 34 | 1,006 | 1,983 | 66% |
| memory | 8 | 16 | 408 | 455 | 53% |
| cable | 19 | 30 | 1,190 | 1,276 | 52% |
| drive | 8 | 16 | 1,957 | 1,577 | 45% |

**The "inherited-only" column is the finding.** Those are cups where the part holds a value and *not
one* of them was read for the part — every one arrived from the family. A power cord carries
eighteen such cups. An accessory carries twenty-nine, against twelve it can evidence itself.

## What it means

**For B4, immediately:** the veto list must be built from **own** facts only, and it now is. Built
from all facts it was measuring inheritance and would have vetoed `na` on exactly the cups an
archetype most needs to close — `mechanical` would have looked capable of 49 cups and been
un-markable on all of them.

**For B7, and it is the larger half:** inheritance is not a small correction on these kinds, it is
most of their apparent coverage. A power cord does not have a switching capacity; an accessory does
not have a firewall throughput. Those values are not fabrications — the family really does have
them — but they are attached to parts that cannot hold them, and every coverage figure counts them.

This is consistent with the whole-catalogue partition measured the same day: of 102,743 live facts,
only **8,007** are `filled` by the four conditions, while **33,364** are `filled_inherited`. This
table says where a large share of those 33,364 landed.

## What is NOT claimed here

That the inherited values are wrong **as values**. They are the family's real specifications. The
claim is narrower and checkable: they were not read for the part that now carries them, so they
cannot be used as evidence that the part's kind can hold that cup — which is the only thing this
measurement was for.

Nor is this a count of parts. It is a count of (kind, cup) pairs and of facts; the same defect on a
kind with three parts and a kind with three thousand reads identically here, and B7 will need the
per-part figure before deciding what to retract.

## Method

Kind comes from the layer artefacts' `.rows.tsv` (the same files the B2 writer reads, so the two
cannot disagree about which part is which kind), joined to live non-superseded facts in
`verified`/`corroborated`. 41,067 SKUs carry a kind; 27,110 (sku, cup) pairs could not be matched to
one because their SKU appears in no layer artefact, and that number is stated rather than folded in.

Scripts: `tmp/kindevidence.mts` (the veto list), `tmp/inherit_contam.mts` (this table).
