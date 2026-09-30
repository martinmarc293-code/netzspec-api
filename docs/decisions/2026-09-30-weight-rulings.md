# The weight rulings (Q22–Q25, tier variants, the printed-metric rule)

**Status: ruled by the reviewer 30 Sep 2026 on measurements taken the same day; built as below. Append-only.**
Report: `docs/reviewer/2026-09-28/weight-lane-report.md`.

## What was measured first

- 964 live Cisco hardware parts were blocked from shop_ready by weight **alone**.
- The eligible kinds for a category default (transceivers, cables, cords, small components) held **no measured weight at
  all**: transceiver `pluggable` 0 of 1,680, cables and cords 0, UCS drives 0 of 1,941, CPUs 0 of 1,700, memory 0. No held sheet
  prints an optic's weight. The recorded Hexwaren transceiver file's 0,05 / 0,20 kg is identical on all 227 rows, 5 m DACs
  included — a placeholder, not a p90.
- 49 of the 964 were licence-tier variants (C9300-24H-A / -E …) of a model whose weight the store held from the model's own sheet
  row, 0 disagreements. Under the ruling's full limits the population is 178 (the 49 plus variants with other blockers).
- The transceiver weight cup is stored in GRAMS (`UNIT_OVERRIDES`), and its band was the dictionary's KILOGRAM band
  `[0.01, 500]` read as grams: every real copper cable over half a kilo was refused (Cisco prints QDD-4ZQ100-CU3M at 800 g).
  No vendor held a transceiver weight, so it had never been exercised. The export refused every unit but kg, the same defect
  on the other side: no transceiver could ever have exported a weight.
- `shipping_weight` was typed a STRING (generated entry). Every vendor together held 3 facts, all Cisco routers, all
  "14.0 lb 6.35 kg".
- The normaliser read a mass printed "pounds then kilograms, no parentheses" by converting the pound figure: 117 current Cisco
  weights have that shape and 114 differ from the printed kilogram figure (6.304934 for a sheet that says 6.30; 0.499 for a
  sheet that says 0.487).
- The recorded switch file's Versandgewicht is NOT a function of Artikelgewicht: within one weight band the added amount runs
  +0,6 … +2,5 kg (995 rows).

## Rulings and what was built

| ruling | built | writes |
| --- | --- | --- |
| **Q22** category default only where a kind's physical range is narrow, the kind's p90 of measured weights — **waits**: "a default derived from zero measured weights is invention" | nothing | none |
| **tier variants** row by row on a multi-model sheet: licence-tier suffixes only (-A / -E), only the model's own row, exact model, never a configuration variant; `inherited_from` = the model row | `scripts/inherit-tier-weight.mts` (run kind AG); through `applyMerge`; gate re-reads each model row (SKU and number) with a control that it can fail | run 1437: 178 inserts, gate 90/90, re-plan 0 |
| **Q25** "Module weight (Max)" is the cable's weight, `derived:max-bound`; band **[1, 2000] g** (witness QDD-4ZQ100-CU3M 800 g) | `BAND_OVERRIDES.transceiver.weight`; witness table `data/reference/max-bound-weight-witnesses.json` (`scripts/max-bound-weight-witnesses.py`, reproducible from cache with `--check`); `scripts/derive-max-bound-weight.mts` (run kind G, every row re-read); `derivedReplay` + `DERIVED_FILL_PATHS.weight` | 28 cables; 2 class rows ("Optical modules 100 g") refused; 2 typo-shaped live parts skipped (below) |
| general rule: **a unit override carries its own band** | `unitOverridesWithoutBand()` in fieldSchema, required empty by `tests/weightRulings.test.ts` (sabotage: removing the gram band names `transceiver/weight`) | — |
| **Q23** Versandgewicht = weight + the median packaging delta of its band, `derived:shipping-allowance`, the recorded file as witness; `shipping_weight` retyped numeric (kg, the weight band), the 3 facts parsed to the printed metric figure | curated `FIELD_DICTIONARY.shipping_weight`; `data/reference/shipping-allowance-bands.json` (`scripts/shipping-allowance-bands.py`, witness sha256 recorded); `src/core/shippingAllowance.ts`; `scripts/derive-shipping-weight.mts` (run kind D); `derivedReplay` + `DERIVED_FILL_PATHS.shipping_weight` | every part with a served weight (862 at the dry run) |
| **printed metric, never converted** (Q23's wording, applied to every mass) | `specNormalize` 1.8.8: "N lb M kg" / "N lbs / M kg" reads M; only that exact two-figure shape | renormalize of `weight` (114 values move) and `shipping_weight` (3) |
| **Q24** a document-level weight on a sheet whose every hardware subject is one model is a per-SKU source (48 parts) | **not built yet** | — |

The allowance bands (kg): [0,1) +0,6 · [1,2) +0,8 · [2,3) +1,0 · [3,5) +1,5 · [5,8) +1,7 · [8,12) +2,0 · [12,20) +2,12 ·
[20,∞) +2,5, each with its n and quartiles in the table. The top band's spread runs to 30,5 kg: its median is the ruling's, and
the table is to be revisited when real shipping weights exist.

## Held, named

- Two live parts are typo-shaped duplicates of real cables, created from the sheets' own misprints and linked to no document:
  `QDD4ZQ100-CU2M` (part 70542, of QDD-4ZQ100-CU2M) and `QDD-4ZQ100CU1M` (both sheets print it without the second dash). No weight
  is written to either; retiring them is a membership decision (the Q15 precedent) and is asked separately.
- The 203 per-model packet buffers shape D reads disagree with 124 conflicts the store already holds; they get their own reading.
