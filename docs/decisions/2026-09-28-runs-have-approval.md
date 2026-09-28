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
