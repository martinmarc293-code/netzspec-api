# scripts/legacy — tests that are not tests of this code

A file here ran as a suite once and no longer can. It is kept, with its reason, because deleting it
loses the record of what it used to prove; it is out of `tests/` because a suite that CANNOT go green
inside a gate makes the gate unreadable, and an unreadable gate is the failure this repo keeps paying
for.

## migrate-atlas.test.ts.legacy — moved 27 Sep 2026

`src/pipeline/migrate-atlas.ts` is a legacy one-shot already recorded **do not re-run**. Its documented
contract — *both case twins loaded as written* — was made **unsatisfiable** by a later migration that
folded case identity, so the suite does not fail an assertion, it **crashes** inside `flushBatch`.

It is therefore not a red that names a defect: it is a test of a contract that no longer exists, in a
suite that gates a deployment. Nothing here can make it green, and leaving it in `tests/db/` meant the
database job could never report green — which is exactly how a real red becomes invisible.

What it still proves, and why it is not deleted: its twin FIXTURE exercises `relations.ts`, which IS
production code. If that behaviour needs covering, it belongs in a suite about `relations.ts`, written
against the rule that holds today rather than the one that held before the fold.
