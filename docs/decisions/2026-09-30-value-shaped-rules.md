# Value-shaped mapper rules and the stacking derivation (reviewer rulings B, C, D — 30 Sep 2026)

The three switch attributes the reviewer ruled before the FINAL FILL ORDER: PoE (D), Stromversorgung (C), Stacking (B).
Sole-blocked shop-ready parts measured before building: PoE 39, Stromversorgung 33, Stacking 12
(docs/reviewer/2026-09-28/three-rules-populations.txt). Predicted +84; measured coverage below.

## What changed in the arrangement

| unit | change |
| --- | --- |
| mapper | `VALUE_RULES` in `src/core/deepSpecMap.ts` (2 rules), pinned by the freeze as `mapper.value_rules_sha` |
| inheritance | `canInherit({ classOverride: "C" })`: a value rule may declare class C for ITS document-level cell; the keys stay class B everywhere else |
| derivations | `stackable` registered in `DERIVED_FILL_PATHS` (`derived:stackable-from-bandwidth`), replay in `src/core/derivedReplay.ts` |

No profile, cup set, gate, band or domain changed.

## (C) power line -> psu_config + input_voltage

Label `^power$`, category switches, value exactly `<V>-<V> V[,] <Hz>-<Hz> Hz, internal|external[, universal]`.
`internal` -> `fixed-internal` (the domain's only internal value; the cell does not say modular), `external` -> `external`.
Measured over the corpus (1,679 held Cisco HTML sheets re-extracted from cache, real `mapFactAll`):
174 per-model cells on small-business sheets (the shape-E count) + 3 document-level cells (350X 735986, 735874, 731284).
The first shape missed 24 comma-form lines ("100-240 V, 50-60 Hz, Internal"); the optional comma was added from that reading.
Left unread by design: lines with no placement ("100 to 240 VAC"), prose.
A document-level line reaches the sheet's listed parts as class C (the ruling): PID list, scope, describesPart, and no
per-SKU value in the same document all still hold. All 33 blocked parts already carry input_voltage (31 hexcat_seed,
2 html_table); the attribute needs psu_config.

## (D) "data only" / "non-PoE" -> poe_standard none

Label `[Product description]` / `Product description` / `Description`, category switches, the phrase explicit, per SKU only
(poe_standard stays class B). Refused, counted: a description that also names PoE (incl. "4PPoE"), and one that counts no
ports of its own. The corpus run read 24 cells at first; 4 were power supplies ("1000W AC power supply (data only)",
"power supply ... for all non-PoE 2960-XR switches") -- the phrase describes the supply or the switches it fits. With the port
condition: 20 cells (19 Catalyst 9300 ordering rows + C9400-LC-48TX), 4 refused.
Not covered by the ruling, stays blocked: 6 C9300 SFP models (their rows say nothing about PoE), 14 IEM expansion modules,
N9K-X9400-8D.

## (B) stacking bandwidth -> stackable

The Catalyst 9200 sheet prints a TRANSPOSED table (t0): rows are sub-series named by SKU prefix ("Fixed uplink Models
(C9200L SKUs)"), columns are attributes. The extractor files the column header as the scope and the row header as the
label, so no alias rule maps it and apply-extract refuses the group scope on purpose. The derivation reads exactly that
shape: C9200L 80 Gbps -> yes, C9200 160 Gbps -> yes, C9200CX "No" -> no; "C9200 Enhanced VN SKUs" refused (a qualified
group names no prefix). Members: parts the sheet lists, SKU `<prefix>-`, category switches, class hardware, kind switch,
no component shape. A read stackable is never overwritten. `stacking_bandwidth` itself is NOT written: it is class B and
the row is a group statement -- held for a ruling rather than slipped in beside the derivation.

## Proof

`tests/valueRules.test.ts` 33 cases, 6 sabotages; `tests/stackableFromBandwidth.test.ts` 19 cases, 5 sabotages (one needed a
combined break: JS `\s` already matches U+00A0, so the no-break-space header is protected twice).
