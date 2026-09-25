# `non_product` is not a subject a family datasheet describes (operator, 25 Sep 2026)

**Operator, 25 Sep 2026:** "fix all the gaps and holes and then informed me back and then we will run a deep audit to check
again". This is the first of those gaps: the class question that had blocked every `class → non_product` plan since 16 Sep.

## The question

`describesPart` (`src/core/specMerge.ts`) refuses to let a family-level fact reach a part whose `product_class` is in
`NON_PRODUCT_CLASSES`. Migration 0014 added the enum value `non_product` — "an ordering artefact, not a product" — and the
hand-written set never followed. On 16 Sep that omission was found, and deliberately NOT fixed: adding a member
**strengthens** a merge rule, which changes what every lane's apply refuses, and the repo's rule is never to land a
strictness trade-off under time pressure (`docs/decisions/2026-09-16-layers-round3-unattended-block.md` §5).

It also blocked work: `retract-inherited`'s gate re-reads each selected fact and requires **the store's own inheritance rule
to refuse it for the planned class**. With `non_product` outside the set, the rule refused nothing, the gate could not pass,
and the 905 pending class plans could not run — 2,035 rows stayed unlayered behind them.

## The measurement that settled it (all vendors, live parts, 25 Sep 2026)

Taken with the live store, not the 13 Sep report. `live` = `retired_at IS NULL`; an inherited fact counts when it is
current (`superseded_by IS NULL`), `inherited`, and holds a value (`raw` non-empty — a gap row holds none).

| vendor | live `non_product` parts | of those, carrying inherited values | current inherited facts on them |
|---|---|---|---|
| cisco | 1,061 | 41 | 136 |
| hpe | 0 | 0 | 0 |
| juniper | 0 | 0 | 0 |
| every other vendor | 0 | 0 | 0 |

**The class exists in one vendor's catalogue.** So the cross-vendor cost that made this a trade-off is zero today: no other
lane's apply changes behaviour, and nothing of theirs is retracted. What it costs here is bounded and countable: **136**
inherited values already sitting on `non_product` rows, plus **297** on the 905 rows the plans will reclassify (switches 75,
transceiver 101, routers 81, servers 20, HX 10, HCI 8, interfaces-modules 2, collaboration 0). Those parts' **own** 64 facts
are not touched by any of this — `retract-inherited` refuses to select them and prints them for reading.

## The decision

`non_product` moves from `PENDING_DECISION` into `NON_PRODUCT_CLASSES`. `PENDING_DECISION` stays as an (empty) set, because
`tests/specMerge.test.ts` asserts the three sets PARTITION the `product_class` enum — a value a future migration adds lands
in none of them and fails there rather than silently becoming a subject.

## Proof

- `tests/specMerge.test.ts`: 174/174. The pending-state cases are replaced by their opposites, asserted in both directions
  (the set holds it AND nothing is left pending), plus `class:non_product` as the refusal RULE — the string
  `retract-inherited`'s gate reads — and a control that a `hardware` part is still accepted.
- **Sabotage:** removing `non_product` from the set again turns exactly 3 checks red, each for its own reason (the partition
  check names it unaccounted; the decision check fails; the refusal returns `null`). Restored byte-identical; green again.

## What it unblocks, and what must follow

1. The eight `class → non_product` groups can now run, in the recorded order per group: `retract-inherited` → `class-change`
   → verify from a new connection.
2. **The box.** The apply tree on the box must carry this commit before those retractions are durable, or the next apply
   there re-inherits the values onto the same rows.
3. A `remerge` over the 1,061 existing rows would now withdraw the 136 inherited values they already hold. That is a
   separate pass, not part of the layering runs, and it is recorded here so it is a decision rather than a surprise.
