# The database suites have rotted, and every rot is the same family (16 Sep 2026)

`npm test` is the suite people run and it does **not** include `tests/db/`. `npm run test:db` does. Run tonight for what
looks like the first time in a while:

> **83 of 93 suites passed.**

Five of the ten failures are the known "red by design until the step-5 rebuild" set (`arrangementFreeze`, `completeness`,
`cupLedger`, `securityShapes`, `source-fields`). **The other five are database suites nobody was watching**, and they
share one shape: *a fixture or an assertion whose premise the system has since changed*, which is the same shape as the
`netzspec_not_a_test` sabotage that ended in `_test`, and the same shape as everything else found tonight.

| suite | why it is red | whose problem |
| --- | --- | --- |
| `store` | asserted `abc-1` and `ABC-1` are **two parts** — migration 0010 made them one | the test. **Fixed.** |
| `apply-acquired` | its gate's recall half runs the adapter suites; both fail on an **uncached fixture page** | the environment, reported as an adapter fault |
| `inheritedFrom` | *"no live inherited facts at all — the query, not the data"*, and its own NOTE says to replace it with a FOREIGN KEY and delete the file | the test |
| `migrate-atlas` | `23505 Key (vendor_id, lower(sku))=(1, hx-test-1) already exists` | a fixture against a case-folding index |
| `reclassify` | a sabotage case picks two SKUs (`0.75K`, `15.0.1M`) the catalogue-noise rule now claims, so "left alone" is no longer true of them | the test, probably |

## Fixed: `store`

The assertion *"two SKUs differing only in case are two parts, each found exactly"* has been red since migration 0010
(`parts_vendor_sku_ci_uq`, extended to whitespace by 0020) deliberately made case-folded SKUs **one** part. It asserted
behaviour the store no longer has and no longer wants.

Rewritten to the rule that replaced it rather than deleted, because the behaviour deserves a check: `upsertPart` folds,
**says** it folded (`case_folded: true`, `created: false`, same id), `findPart` reaches the one part from either
spelling, and the stored SKU keeps the spelling it was first given — *a differently-cased mention is evidence, not a
correction*. Plus a sabotage: a raw `INSERT` of a third spelling is refused by the index itself, so the fold cannot be
walked around. **91/91, 25 sabotage cases.**

## Diagnosed, not fixed: `apply-acquired`, and it is the interesting one

The gate's **recall** half runs the scraper adapter suites. Run by hand:

```
meraki       71 pass, 1 miss   MISS | fixture | not cached: https://documentation.meraki.com/MS/…/MS130_Overview…
provantage    9 pass, 1 miss   MISS | fixture | not cached: https://www.provantage.com/~7CSC71M1.htm
```

Both are functionally green. Each fails on **one fixture page absent from this machine's copy of the scraper cache** —
the cache lives on the VPS and the laptop holds a working copy. The gate records `suites: {meraki: false,
provantage: false}` → `recall 0` → refuse. So **`apply-acquired --commit` can never pass its gate on this laptop**, and
the reason it gives says *the adapter is broken* when the truth is *this machine cannot check it*.

`runAdapterSuites` makes exactly that distinction, carefully and at length, for the Python interpreter one level up:

> *"'I could not run your suite' and 'your suite did not pass' are different facts, only one of them was true, and the
> gate reported the wrong one."*

The distinction does not reach the fixture case. **The refusal is the safe direction** — a suite that cannot check must
not bless a write — so nothing here is dangerous; the cost is that it sends the reader to the wrong place, and it is
very likely why the database suites stopped being run at all.

*(My MCS filter rule is not implicated: the string appears nowhere in either suite's output.)*

## Left for the operator: the other three — each now diagnosed to the line

The judgement in each is *which side is wrong*, which is not mine to make. But leaving them as investigations costs the
next person an evening, so each was chased to its exact cause. None is a real defect in the code under test.

**`migrate-atlas` — the same cause as `store`, and just as unambiguous.** Line 151 deliberately creates
`twinA = { sku: "hx-test-1" … "lower-case twin" }` beside `HX-TEST-1` at line 104, and line 364 asserts **"4 parts
loaded, both case twins as written"**. Migration 0010 made that impossible, so the insert raises
`23505 … (vendor_id, lower(sku))=(1, hx-test-1)`. It is a pre-0010 expectation, exactly like the one fixed in `store`.
*Why it was not fixed with `store`:* this suite covers a one-time historical Atlas migration, so whether its
expectations should be brought forward or the file retired is a question about the migration's life, not about 0010.

**`reclassify` — one stale token.** The sabotage holds where it matters: both fixture parts are still reported as
`foreign_by_reason` and neither appears in `changes`, so *"a class this table did not decide is left alone"* is still
true. What moved is the hypothetical label beside them — it asserts
`would_become["unknown->hardware"] === 1` and the plan now says `unknown->non_product`. The two parts are `0.75K`
(switches, `is_hardware: true`) and `15.0.1M` (routers), both `product_class: unknown`, one carrying the reason
`catalogue-noise: fails is_part_number`. A SKU that fails `is_part_number` resolving to `non_product` rather than
`hardware` is the direction round 3's junk work deliberately moved in — so this reads as the expectation being stale
rather than the rule being wrong, and the change is a single string. It is still an assertion about intended behaviour,
which is why it is named here instead of edited.

**`inheritedFrom` — its premise cannot hold in a truncated database.** It reports *"no live inherited facts at all — the
query, not the data"*, which is the suite correctly refusing to pass on nothing; the other database suites truncate
`facts`, so there is never anything for it to check. Its own NOTE already proposes the ending: *"zero orphans: replace
this file with FOREIGN KEY (inherited_from) REFERENCES parts(sku) and delete it."* A schema decision, not a test edit —
and note it is the same could-not-check-reported-as-a-miss shape as `apply-acquired` above, in a suite that has the
grace to say which it is.

## The rule this suggests

The five "red by design" suites are a deliberate, recorded state. These five were not — they were simply unobserved, and
`npm test` cannot see them. **Something should run `test:db` on a cadence, or the split should go away**; a suite that
nothing runs decays into a suite that asserts the past, and then the first person to run it cannot tell a real defect
from a stale premise. Tonight it took four separate investigations to make that distinction five times.

## Resolution of all five (16 Sep 2026, later the same night)

| suite | what it actually was | outcome |
|---|---|---|
| `store` | stale assertion — 0010 ended case identity | rewritten to the rule that replaced it (`6e0421c`) |
| `reclassify` | stale expectation — `classify()` learned a new rule | clause corrected, 30/30 (`d210016`) |
| `migrate-atlas` | **not a fixture at all** — the migration CRASHES, its contract made unsatisfiable by 0010 | recorded, not changed; already `do not re-run` (sheet: *a-retired-sku-is-not-a-target*) |
| `inheritedFrom` | **not a test at all** — a PRODUCTION ratchet filed under `tests/db/` | moved to `scripts/audit-inherited-from.ts` (`667fc03`) |
| `apply-acquired` | environment — its recall half needs a fixture page absent from this cache | unchanged; reported as an adapter/environment fault |

**Two of the five were category errors, not rot**, and that is the correction to this sheet's own diagnosis. I filed
`inheritedFrom` above as *"the test"* and `migrate-atlas` as *"a fixture against a case-folding index"*. Both were wrong
in the same direction: I assumed the file was a test whose expectations had aged, when the file was **not a test of code
at all**. `migrate-atlas` exercises a legacy one-shot tool already recorded do-not-re-run; `inheritedFrom` audits the
production catalogue and `npm run test:db` pointed it at a truncated database, so it had never once measured the thing
it is about — and it said so, in a sentence (*"no live inherited facts at all"*) that reads as data loss while
production held 34,824.

**The rule above still stands and gets sharper.** "Something should run `test:db` on a cadence" would not have helped
either of these: a cadence over the wrong database is what kept `inheritedFrom` dead, and no cadence can make a
crashing legacy loader pass. So the first question about a red suite is not *is its premise stale* but **is this a
test?** — of what code, against which database, and could it ever go green there. Two of five could not.

And the thing that found the only live defect of the night was not the fix to any of these: it was **reading
`migrate-atlas`'s twin fixture and noticing it exercises `relations.ts`**, which is live. A red suite's value can lie
entirely outside the suite.
