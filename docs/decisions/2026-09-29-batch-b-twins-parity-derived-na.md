# Batch B: twin names, kind parity with evidence, derived `na`

**Status: ruled by the reviewer 29 Sep 2026 on measurements taken the same day; built as below. Append-only.**

## 1. twin_parity (19 = 6 category + 13 kind)

Measured over the real `partKind` on all 8,506 live hardware `X` / `X=` pairs:

| class | pairs | what it is | done |
| --- | ---: | --- | --- |
| one member SKU-only, the other real | 9 of the 13 kind disagreements | the SKU-only member classifies from nothing | `ingest name-language --from-twin` (planTwinNames): the SKU-only member takes the real name; spare wording stripped; German titles refused |
| two real names, plural token | 2 | "Rear Rack Mounts" / "Power Supply Blanks": no singular token matched | `mounts`, `blanks`, `fillers` added to the mechanical words and the veto |
| two real names, inch-mark cut | 1 | UCSW-WT-35HDDT's base name was cut at `3.5"` by the upstream catalogue parser | the name lane repairs a name that is its twin's cut at an inch mark, by rule (1 live pair; no description holds the text) |
| two real names, device-noun veto | 1 | UCSW-MSX-PCBL: base "…Mellanox Switch Power Cable" (the noun Switch vetoes the cord reading) vs spare "…Jumper Cable" | **not fixed**: the spare's name never says power; reported |
| base filed under a software category | 6 | N540X-* ×4 in ios-nx-os-software, CGR1240/K9 and IC3000-2C2F-K9 in cloud-systems-management; spares in routers | **parked**: the bases are `product_class = software`, so the settled rule (product_class + unanimous siblings) refuses them; siblings are unanimously routers (127, 66, 1) |

The `=` alone moves 0 pairs today (the decision of 28 Sep counted 1).

## 2. kind_profile_parity

Widened (PHYSICAL_OBJECT_CUPS, with `PARITY_WIDENINGS` naming the richer side's witness; 52 cups in 26 rows, all landed):
collab / unified-communications / conferencing `server` +emc_emissions +humidity_storage (witness hyperconverged-systems,
HX-B200-M5-U); hyperconverged-systems `bundle` +product_compatibility (HCI-M6-MLB); routers `module` +power_max (3810-VCM3);
optical-networking `chassis` +altitude_max +product_compatibility +temp_storage (HCIX-9508-CH). Neither side holds one own
fact for any of these cups.

Refused on measurement, ruling accepted:
* collab `cable` media: 177 of 308 are HDMI/USB/AV/power leads, outside media's domain. The follow-through (hci's C19/C20
  "cables" are cords) is built: the UCS axis names `power-cord` (64 parts in the three UCS categories, asked cable_length +
  product_compatibility like every other category's cords). **It does not resolve `cable`**: media is asked of `cable` in
  8 categories and not in 6 (a two-category view hid this), so the kind stays divergent until a data-cable signal exists
  (`cable_construction`, GATE_NOT_YET_POSSIBLE since 27 Sep).
* collab `memory` flash: interfaces-modules `memory` no longer asks `flash` (its 2 live parts are route-memory DIMMs).
  moduleKind still files SD-X/USB-X cards under `memory` (0 live in the category); a `flash` kind there would be one no
  catalogue SKU reaches, which tests/moduleKind.test.ts refuses, so that split waits for the first live card.

The check gained the evidence column: `held.spec_bearing` per side from the completeness report, and two lines —
ONE OF YOU IS WRONG (a side holds spec sheets) and NEITHER CAN KNOW YET (acquisition).

A side effect found while building it: `applyPhysicalObjectCups` ran before GENERATED_FIELDS was merged into the dictionary,
so `humidity_storage` (a generated key) read as unknown and the row was refused; the applier now asks both halves.

## 3. four_sets_sum: `na` derived

`cupLedger.kindQuestionSet(category, kind)` — the keyed function the ledger, census, completeness report, recompute and
`/v1/fields?category=&kind=` all call — refuses a call without both, and derives `na` as the complement over the WHOLE
dictionary: a key the profile never mentions, a conditional settled false **by the kind alone** (a role never closes a cup:
rule 7), or a plainly optional cup the kind's archetype (kindArchetypes.ts) cannot hold. Measured over the ledger's
340 (category, kind) pairs: every pair sums to the 605 non-column-backed keys; na per pair min 166, median 244, max 514
(88,899 cells not in the profile, 11,457 settled conditionals, 2,599 archetype).

The veto FAILS four_sets_sum: an own (not inherited, not retracted) fact on a live part of the kind, under a cup the
derivation marks `na`, names the kind and the cup. The recompute asserts the same derivation for every part that has a kind.
