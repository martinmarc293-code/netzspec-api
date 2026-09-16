# The one-series line: a guard that cannot fire, and why the rule for it was rejected (16 Sep 2026)

**MEASURED AND NOT APPLIED.** This was the largest remaining cause in the Q-27 queue — 42 rows — and the previous
sheet ended *"that is worth measuring across the 40 one-series lines before anyone writes it."* Measured, it costs a
correct published placement. Recorded here so the next person does not re-derive it.

## The defect is real, and the code says so itself

`labelEvidence` guards word and acronym evidence with the words its siblings carry:

```ts
// words and acronyms count only when no sibling series carries them (CGR is in CGR 1000 and CGR 2010: family evidence at most)
const siblingWords = new Set(siblings.flatMap((s) => s.series.toLowerCase().split(/[\s/()]+/)));
const own = strongest(series, sku, name, true, siblingWords);
```

**A line holding exactly one real series has no siblings, so that set is empty and the guard excludes nothing.** "No
sibling disagreed" and "there was no sibling to disagree" produce the same answer — the shape `CLAUDE.md` already
names: *when a check depends on a signal, assert the signal is PRESENT before trusting its silence.*

40 of 116 product lines hold one real series, and **40 rows of the queue are placed by a word on one of them**:

```
35   servers-unified-computing   line "Cloud Services Platform"          on sku CSP      -> CSP 5000
 4   interfaces-modules          line "Router and switch line cards"     on sku SIP      -> Cisco 12000 … SIP
 1   collaboration-endpoints     line "Microphones"                      on name ceiling -> Table, ceiling and wireless microphones
```

And the CSP and SIP rows are wrong for a reason the mapping can be asked about directly. Searching every page:

```
CSP 2100     2 rows mention it     both are the accessories themselves; no CSP 2100 series, no CSP 2100 device
10000-SIP    2 rows                no Cisco 10000 series
uBR10012     5 rows                no uBR10012 series — and 3 of the 5 already sit in "SPA Shared Port Adapters"
```

So the prefix has nothing to disagree with **because the mapping lacks the siblings**, not because the part belongs
to the one series it can see. `CSP-TPM2-002=` says *"Trusted Platform Module 2.0 for CSP 2100"* and is proposed for
CSP 5000; `UBR10-2XDS-SIP` is a uBR10012 carrier card proposed for the Cisco 12000.

## The rule, and the measurement that stopped it

The candidate was one clause — word evidence is not offered when a line has no sibling:

```ts
const own = strongest(series, sku, name, siblings.length > 0, siblingWords);
```

Scoped to **words** on purpose, and the measurement justifies the scope rather than tidiness: a blanket one-series
rule would also have refused the seven correct `Cisco 8000` rows (`CBL-BRKT-V2`, *"Cable Management Bracket for 8010
Series Router"*), which reach their one-series line on a **number**. A full series name and a digit token carry their
own identity; a word borrows it from the absence of a rival.

Measured over all 39,998 page rows with the real function on both sides:

| | |
| --- | --- |
| verdicts that differ | 2,023 |
| …inert (an earlier rule had already placed the row) | 1,982 |
| review proposals withdrawn | **40** — 39 correct refusals, 1 correct proposal lost |
| **published rows unplaced** | **1** |

That one row is the reason this is not applied:

```
ISE-SNS-ACCYKIT   "ISE SNS Accessory Kit"
   line "Identity Services Engine" (1 real series)
   series "Secure Network Server (SNS) appliances"    placed_by: label    evidence: sku-token SNS
```

An ISE accessory kit, in the only series its line has, placed on the acronym `SNS`. **The placement is correct**, and
the rule would drop it into shared parts. Every change landed tonight moved zero published rows; this one moves one,
and moves it for the worse, to withdraw 39 proposals whose rows are *already parked correctly* in shared parts —
a review queue's refusal costs nothing, because nothing moves until a person says so.

## What the measurement actually says to do

The vacuous guard is a real defect in the abstract and mostly harmless in fact, because **on a one-series line, a part
that belongs to the line at all belongs to its one series.** That is why the ISE kit and the ceiling-microphone cable
are right and the CSP and SIP rows are wrong: the first two lines are complete, and the other two are not.

So the fix is to the **mapping**, not the matcher — and it is a scope question rather than a code one:

> Should `Cloud Services Platform` hold a **CSP 2100** series, and `Router and switch line cards (legacy)` a
> **Cisco 10000** and a **uBR10012**? The catalogue holds no device for any of the three — only 2, 2 and 5 accessory
> rows that name them — so adding them means declaring that the catalogue covers platforms it has no products for.

That is a decision about what the brand covers, which this repo's own rule says reaches the operator rather than
being taken by a peer. Until it is taken, the 39 rows stay in shared parts, which is where they belong, and the
review sheet already records them as refusals.

## A tooling defect this exposed, and fixed

The blast harness compares the working tree against a candidate file and named its verdicts `was` / `now`, assuming
the candidate is always the new code. Run the other way round — candidate = `git show HEAD:` — **every label
inverts**, and it duly reported `PAGE ROWS THAT FALL OUT: 0` while `ISE-SNS-ACCYKIT` fell out; the row was bucketed
as `rival_dropped` and was caught only by reading it.

The buckets are now named for **which side holds the placement** (`placed_only_in_worktree` /
`placed_only_in_candidate`), so the output means the same thing whichever way it is run, and a published row moving
shows up in one of two numbers instead of being hidden by a label. Re-run against this very candidate, it now prints
`PAGE ROWS placed in their series ONLY in the WORKING TREE: 1`.

Three of tonight's four measurements were run with the arguments that way round. Their zeroes were genuine — checked
— because in those the other direction was zero too. This one was not, and the difference was one row.
