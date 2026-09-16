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

## Left for the operator: the other three

Each needs a judgement I should not make alone, because in each the honest question is *which side is wrong*:

- **`inheritedFrom`** fails because the truncated test database holds no inherited facts — the suite says so itself, and
  its own NOTE already proposes the ending: *"zero orphans: replace this file with FOREIGN KEY (inherited_from)
  REFERENCES parts(sku) and delete it."* That is a schema decision, not a test edit.
- **`migrate-atlas`** collides on `parts_vendor_sku_ci_uq` with `hx-test-1`. Either its fixture predates 0010 (like
  `store`'s did) or it is leaving rows behind between runs — the hygiene suite hit the second shape tonight and the
  answer there was to construct and remove the state explicitly.
- **`reclassify`**'s sabotage asserts that classes its table did not decide are left alone, and picks `0.75K` and
  `15.0.1M` — SKUs the `catalogue-noise: fails is_part_number` rule now claims. So either the fixture should pick SKUs
  the noise rule does not touch, or the rule has widened past where that sabotage meant to stand.

## The rule this suggests

The five "red by design" suites are a deliberate, recorded state. These five were not — they were simply unobserved, and
`npm test` cannot see them. **Something should run `test:db` on a cadence, or the split should go away**; a suite that
nothing runs decays into a suite that asserts the past, and then the first person to run it cannot tell a real defect
from a stale premise. Tonight it took four separate investigations to make that distinction five times.
