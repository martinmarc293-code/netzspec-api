# `runs_have_approval`: the groups, and what the table says the convention actually is

**Status: a question for the reviewer. Nothing changed; the test still fails as written.**

The test reports *"1,126 of 1,260 runs record NO approval"*. Measured today over 1,272 runs, 136 carry
`inputs->approved`. Before approving anything per group, the groups have to say what KIND of run they are,
because the table shows three different conventions and only one of them is about approval.

## The groups, by kind and status

| kind | status | n | approved | first | last |
| --- | --- | ---: | ---: | --- | --- |
| apply-acquired | succeeded | 516 | 0 | 09-03 | 09-07 |
| apply-acquired | failed | 157 | 0 | 09-04 | 09-07 |
| recompute-completeness | succeeded | 151 | 0 | 09-08 | 09-28 |
| **move-category** | succeeded | **88** | **88** | 09-11 | 09-28 |
| apply-acquired | aborted | 53 | 0 | 09-04 | 09-07 |
| promote-unknown-skus | succeeded | 49 | 0 | 09-05 | 09-07 |
| sync-dictionary | succeeded | 42 | 0 | 09-03 | 09-26 |
| **class-change** | succeeded | **33** | **33** | 09-15 | 09-25 |
| apply-renormalize | succeeded | 33 | 0 | 09-05 | 09-27 |
| reclassify | succeeded | 21 | 0 | 09-04 | 09-13 |
| **apply-retract-inherited** | succeeded | **11** | **11** | 09-15 | 09-25 |
| write-layers-to-db | succeeded | 8 | 0 | 09-27 | 09-28 |
| … 50 more groups | | | | | |

## What the pattern is

Approval is not missing from 1,136 runs. It is **complete on exactly the kinds whose scripts demand it**:

    membership / retraction kinds record an approval    0 of 132 missing
    every apply-* run carries a GATE                    1 of 579 missing

`move-category`, `class-change` and `apply-retract-inherited` are the commands that change row membership or
withdraw facts, and every one of their 132 runs carries the operator's approval text. Every other kind is a
pipeline step, and for those CLAUDE.md states a different invariant — *"a run that writes facts must carry a
passing gate"* — which the table also satisfies, 578 of 579.

So the three classes appear to be:

1. **row-membership or retraction** → an approval. 132 of 132 today.
2. **writes facts** → a passing gate. 578 of 579.
3. **derives from what is already stored** (recompute, write-layers-to-db, build-*) → neither.

## The one real gap, named

`apply-remerge` **run 69**, 4 Sep 09:42, `inputs = {}`, no gate, notes *"operator 2026-09-04 (second
attempt; …)"*. That is the hand-run reopen of 4,164 conflicts CLAUDE.md records — the first attempt (run 63)
vanished into a psycopg savepoint. It cannot be given a gate retrospectively, so it is either a named
historical exception or the rule has to admit one.

## What is NOT reconciled

The brief cites **7,533 runs**; this table holds **1,272**. I cannot reconcile them, because the brief does
not say what it counted — and a number recorded without its definition cannot be re-checked by anyone,
including its author. Candidates: another database, runs across every branch's worktrees, or a different
table entirely. That needs the brief's own predicate before any per-group approval means anything.

## The decision asked for

Does the test keep its current blanket demand (and 1,136 runs need approving retrospectively, which is
writing an approval nobody gave), or does it become the three-class rule above with run 69 named? **This is a
narrowing of a predicate, which plan rule R4 forbids doing to make a test pass, so it is not being done
here.** The measurement is the argument; the ruling is the reviewer's.

## 28 Sep, a29aefa — the ruled rule, implemented; still red
Exhaustive `RUN_KIND_CLASS` in mould-verify (approval / gate / derived by what the command DOES); an unclassified kind fails; succeeded runs only; run 69 excepted.
Box: 1,287 runs = 1,033 judged + 253 failed/aborted + 1 exception. 102 owe an approval and carry none (promote-unknown-skus 49, reclassify 21, five retract-* kinds 11, reclassify-docs 5, hygiene-* 6, ten single runs); 6 owe a gate (migrate-atlas 2, remap / reroute / rekey / split-bidi 1 each). 85 of the 108 predate 2026-09-11, the first recorded approval.
Correction to myself: "132 of 132" was over three kinds, not over the membership class.
Question: judge only from 2026-09-11 on (23 remain), or rule the pre-convention kinds one by one?

## Ruling applied, d956173: judged from 2026-09-11; 85 pre-convention named in the output, never folded
The 23 for retroactive lines, by group:
- reclassify (approval): 933 935 939 951 956 969 973 999 1023
- retract-licence-mined (approval): 937 954 957 958 970
- retired-residue (approval): 988 993
- hygiene-whitespace-duplicates 1064 · revert-cross-vendor-layer-write 1243 · drop-orphan-keys 991 · retract-page-read-deploy-role 1221 (approval)
- GATE, not approval: reroute-per-slot-capacity 942 · rekey-psu-and-compat 952 · split-bidi-rx 959. A line cannot supply a gate; like run 69 they can only be named exceptions or re-run.

## Reviewer's retroactive line, written into each group (ruling 28 Sep 2026)
- reclassify 933 935 939 951 956 969 973 999 1023 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- retract-licence-mined 937 954 957 958 970 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- retired-residue 988 993 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- hygiene-whitespace-duplicates 1064 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- revert-cross-vendor-layer-write 1243 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- drop-orphan-keys 991 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
- retract-page-read-deploy-role 1221 — approved: reviewer_retroactive · evidence: plans_agree_with_rows
Recorded in runs.inputs by scripts/record-retroactive-approvals.mts (its own run carries the ruling); the check counts them apart.
Gate misses 942 952 959: NOT exceptions. scripts/retro-gate.mts re-runs the gate's value half (labels are not stored) with a gated apply run as control; pass -> named exception like 69, fail -> their facts retract.

## Closed 28 Sep, run 1293: 952 retro-gate PASS (283/283) -> named exception; 942 FAIL (57 retracted), 959 FAIL (30 retracted). Control run 307, 176/176. Plan: data/dryrun/retro-gate-2026-09-28.tsv
