# `form_factor`: how much of the backlog a rule could answer

**27 Sep 2026.** Measured at the reviewer's request. Every figure carries the predicate that produced it,
because a number without its predicate cannot be re-checked by anyone, including its author.

## The backlog

**17,603 pending cups across 7,430 parts wait on `form_factor`** — the largest single gate in the Cisco
mould, 43% of the brand's 41,204 pending cups.

> Predicate: live Cisco parts (`retired_at IS NULL`) whose stored `completeness.pending_gates` contains an
> entry whose `gate` array includes `form_factor`. Read from the stored row written by
> `recompute-completeness`, not re-derived.

## The proposal, and the two readings of it

The suggestion was that `form_factor` "is derivable from SKU/series/rack_units for the great majority of
switches and routers, so it may be a derivation, not an extraction." That is two different mechanisms and
they measure very differently.

### Reading 1 — infer from what the catalogue already knows: **5.8%**

| signal (disjoint tiers, finest first) | parts | share |
| --- | ---: | ---: |
| holds a `rack_units` fact, so it is rack-mounted | 84 | 1.1% |
| MODEL (`parts.family`) unanimous over ≥2 described siblings | 19 | 0.3% |
| SERIES unanimous over ≥3 described siblings | 328 | 4.4% |
| **no signal** | **6,999** | **94.2%** |

**The ceiling is data coverage, not rule cleverness.** Only **1,615 of 41,067 live Cisco hardware parts
(3.9%)** hold a `form_factor` fact at all, and only **113 of 423 series** contain a single described part.
A sibling rule can speak only where a sibling already has the value, so this mechanism cannot exceed the
coverage it depends on. It is not a way to *start* filling the cup; it is something that becomes useful
*after* the cup is partly filled.

A finer grouping does not rescue it — the model axis adds 0.3%. The residue is concentrated in
`series = "Meraki"`, which holds **four different form factors across 25 described siblings**: the series
axis being too coarse to carry a specification is the operator's own layer-2 complaint, arriving here as a
fill-rate problem.

### Reading 2 — a hand-written prefix table, like `deployRole`'s: **65% for ~25 rules**

This is **not** bounded by current coverage, because a person writes the rule rather than learning it, so
the measurement above says nothing about it. What decides whether it is worth writing is **concentration**:

| leading SKU token | parts | cumulative |
| --- | ---: | ---: |
| `UCS` | 1,201 | 16.2% |
| `CBS350` | 395 | 21.5% |
| `WS` | 332 | 25.9% |
| `UCSC` | 292 | 29.9% |
| `SG350` | 233 | 33.0% |
| `CBS250` | 209 | 35.8% |
| `C1` | 197 | 38.5% |
| `DS` | 184 | 41.0% |
| `C880` | 152 | 43.0% |
| `N3` | 145 | 45.0% |

**Top 10 tokens cover 45.0%, top 25 cover 64.8%, top 50 cover 78.8%**, over 383 distinct tokens of which
76 appear exactly once. So roughly 25 hand-written rules reach two-thirds of the backlog — the same shape
and the same order of effort as the `deployRole` table.

> Predicate: leading `[A-Z]+[0-9]*` token of the SKU, uppercased. A crude split, chosen because it is what
> Cisco families announce themselves with; it is a sizing instrument, not the proposed rule.

## The trap in reading 2, and it is the biggest token

`UCS` is 1,201 parts and is **ambiguous by construction**: `UCSB` is a blade and `UCSC` is a rack server,
and both appear as separate tokens in the table above — which is encouraging — but bare `UCS` covers both
and more. A prefix table that answers `UCS` with one form factor would be confidently wrong on the single
largest group in the backlog. Each rule needs a checked reason per prefix, and the refusals need testing as
hard as the answers, exactly as `deployRole`'s table does.

## What this says

The instinct — *this is a derivation, not an extraction* — is right. The mechanism implied by
"SKU/series/rack_units" is not the one that works: inference from existing facts is capped at 5.8% because
there is almost nothing to infer from. The mechanism that works is a hand-written prefix table with a
checked reason per rule, sized at ~25 rules for ~65% of 17,603 cups, with `UCS` needing finer treatment
than a prefix.
