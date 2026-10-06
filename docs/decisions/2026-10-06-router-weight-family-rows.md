# Router weights: family rows, configuration-qualified chassis weights, module model rows (6 Oct 2026)

## Why
After rulings (a) and the model-row writer, 94 routers-category parts were blocked ONLY by weight. A survey of every held sheet
linked to them (`/root/prov-1006/weight-survey.txt` on the box) found weights printed in five shapes no writer read. Five
questions went to the reviewer at ~22:50 UTC with the sheet text of each.

## Rulings (reviewer, 6 Oct 2026 ~22:50, verbatim)
"All five yes, with the method kept honest in each:
Q1 — yes, as a separate method derived:family-row (not model-row), so a value stated for a family stays distinguishable from one
stated for the model: the family row writes onto each PID the same sheet lists under that family — never by token match alone.
Q2 — "with 2× AC PSUs and fan tray" → derived:max-bound, unless the C8300 ordering guide shows the base PID ships with two PSUs
(then plain weight). C8500's two-value cell → max-bound of the larger (77.5). C8200 "Chassis weight 10 lb" → plain read weight.
Q3 — yes, and more: a shipment weight is the article plus packaging, so it is the Versandgewicht as read (shipping_weight, filled)
and the article weight's max-bound — both from the one row.
Q4 — yes. Different from Q25: the sheet itself bounds the class to exactly its own MPAs (NC57 sent elsewhere), so it names its
parts; derived:family-row, PID list from the same sheet.
Q5 — yes, extend the model-row writer to module and processor kinds with the same guards (model-token rule, held sheet lists the
PID)."

## What was built
- **Q5 + Q2 (run 1535, existing method derived:model-row):** `scripts/model-row-weight-witnesses.mts` takes `kinds` per source and
  a `requires` statement (a second page, re-read, recorded on the row). Ordering guides: "All Catalyst 8300 edge platforms, by
  default, ship with dual redundant AC power supplies and fan trays" and "Cisco Catalyst 8500 Series Edge Platforms ship with two
  (redundant) power supplies" -- so the 'with 2x AC power supplies and fan tray' rows are PLAIN (C8300 2RU 40 lbs / 1RU 20 lbs;
  C8500-12X4QC 20.75, -12X 20.25, 8500L 17). C8200's one column for both models: 10 lb. Q5: 84-MPA-2H12Z-M 3.08 lb; NC57-MPA-12L-S-FC
  1.1 lb (the NCS 5700 sheet's Table 3; its Table 2 is the 2D4H, and NC57-MPA-12L-S without -FC is not named); ASR1000-RP1/RP2 5.0 lb,
  each anchored between its own table caption and the next. +16 rows, 15 parts became shop-ready.
- **Q1 + Q4 (new method derived:family-row):** registered in `src/core/derivedReplay.ts`, `DERIVED_FILL_PATHS.weight`, the board's
  run-kind classes (`derive-family-row-weight`: G) and the bundle copier's registered derivations; written by
  `scripts/derive-max-bound-weight.mts --set family-row` from `data/reference/family-row-weight-witnesses.json`
  (`scripts/family-row-weight-witnesses.mts`). MEMBERSHIP IS THE SHEET'S OWN GROUPING: the PIDs an ordering table prints between the
  family's group heading (printed exactly once, or the source writes nothing) and the next heading, each also linked to the sheet;
  for Q4 the class the sheet bounds (NC55-MPA PIDs it prints; NC57 sent elsewhere by its own words). A PID with a model row never
  takes a family row (C897VAGW-LTE keeps its 6.1 lb inside the 89xG group's 5.7 lb). 28 rows over 28 PIDs. Plain rendering.
- **Not yet built:** Q3 (shipment weights: shipping_weight as read + weight max-bound, one row, description -> PID through the same
  sheet's ordering table) and the C8500-20X6C max-bound 77.5 (a per-column max-bound path). The C8500 ordering guide says the 20X6C
  ships with THREE PSUs, and the sheet prints "75 lbs. (3x AC)" for that configuration -- offered to the reviewer as a plain 75 instead.

## Proof
`tests/maxBoundWeight.test.ts` 35/0, 8 sabotage cases; table sabotage: a with-PSU row losing its licence -> red; the 20X6C as a
plain row -> red; a model-row PID given a family row -> red; a family row losing its grouping -> red.
