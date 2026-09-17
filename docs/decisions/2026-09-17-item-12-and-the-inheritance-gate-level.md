# Item 12 sorted row by row — and the inheritance gate has been reading the wrong family level since 8 Sep

**17 Sep 2026. Status: MEASURED AND PREPARED, NOTHING APPLIED. Two decisions for the operator (§4). Nothing was written to
production; every number below comes from one of two read-only scripts and says what it counted.**

Reproduce before acting — the store moves:

```
npx tsx scripts/measure-family-mismatch-retractions.mts     # §1-§2 (item 12)
npx tsx scripts/measure-inheritance-gate-levels.mts         # §3 (the gate)
```

---

## 1. Item 12: what the 4 Sep `retracted:family:mismatch` rule withdrew from REQUIRED cups

**Population, reproduced exactly from the 16 Sep record:** current withdrawal rows with that method (`facts.superseded_by
IS NULL`), whose withdrawn row was inherited, on a live `hardware` part, on a cup the part's own kind requires
(`kindQuestionSet(category, partKind(category, sku, name)).required`) — **376 rows on 266 parts**: `ieee_standards` 176,
`certifications` 110, `altitude_max` 41, `dram` 20, `flash` 18, `temp_operating` 8, `supported_protocols` 2, `mounting` 1.
(The 16 Sep handoff listed the first six, which sum to 373.) The 376 come from two runs on 4 Sep: 56 (367 rows) and 62 (9).

For scale, the rule's whole footprint: 2,145 withdrawals (runs 56 and 62 on 4 Sep, 76 on 5 Sep); 1,797 still withdrawn,
inherited, on live parts; 1,454 of those on hardware — required 376, optional 900, not applicable for the part's kind 178.
**This sheet classifies the required 376 only.**

**Every one of the 376 values came from a document that LISTS the part** (`doc_parts`): 376 of 376. The same query with
each part paired to a DIFFERENT row's document returns 0 of 376 (earlier unsorted rotations gave 1 and 3), so the check
discriminates. The repo's hard rule — never inherit into a SKU the document does not list — was never at issue; the
retraction fired on the family-string comparison.

## 2. The three buckets

All 49 (part series ⇐ document title) groups were read on 17 Sep. The rules, in order; the first match decides:

| # | rule | bucket |
|---|---|---|
| 1 | the ISR G2 **Ordering Guide** — it lists every ISR G2 SKU; the values are the 1900 ISR's fixed memory (*"Fixed 512MB DRAM only"*) on 2900/3900 routers, UCS-E bundles and `MEM-` modules | keep |
| 2 | an **ONS 15454 card** datasheet — the card's operating temperature on compatible pluggables | keep |
| 3 | `AIR-ACC1530-PMK1` — a pole-mount kit given the LoRaWAN gateway's mounting options | keep |
| 4 | the part whose SKU is `IPv6` — a datasheet cell enumerated as a part | keep |
| 5 | `SPA500S` — an expansion module given the SPA525G phone's certifications | keep |
| 6 | a group not among the 49 read | UNREAD (never a candidate by default) |
| 7 | a prefix-less `3750-X` / `3560-C` model name (`3750X-24P`, `2960C-8PC-L`) | model-name row |
| 8 | everything else — one of the datasheet's own models, losing a line-wide value the datasheet states | restore candidate |

| bucket | rows | parts | fields |
|---|---|---|---|
| **restore candidate** | **267** | **190** | `ieee_standards` 148, `certifications` 92, `altitude_max` 25, `supported_protocols` 2 |
| model-name row | 60 | 28 | `ieee_standards` 28, `altitude_max` 16, `certifications` 16 |
| keep withdrawn | 49 | 48 | `dram` 20, `flash` 18, `temp_operating` 8, `certifications` 2, `mounting` 1 |
| unread | 0 | 0 | |

No part is in two buckets. **The field still predicts the side**: every hardware-specific row (`dram`, `flash`,
`temp_operating`, `mounting`) is in keep, and every line-wide row is a candidate except two certifications on
non-products. The 16 Sep sample of 13 said the same; this is all 376.

**The model-name rows** are 28 parts named only *"Cisco \<sku>"*, one document each, no relations, 2–6 served facts. The 12
`2960C…`/`3560C…` rows each have a live `WS-C` twin (`2960C-8PC-L` ↔ `WS-C2960C-8PC-L`); the 16 `3560X…`/`3750X…` rows are
models whose orderables carry a tier suffix (the `WS-C3750X-…-L/-S/-E` parts in group 22 below). They look like model
names enumerated from datasheet tables. Whether they should exist is a catalogue question that comes before putting
anything back onto them.

## 3. Why "restore" is not yet a safe instruction: the gate reads the wrong level

`describesPart` / `familyMatches` (`src/core/specMerge.ts`, `57a6ba6`, 4 Sep) decide whether a family-level value may reach
a part by comparing the part's family with the value's `inherited_from`, on shared model-number tokens. `applyMerge`
(`src/store/facts.ts`), `apply-extract` and `remerge` all pass **`parts.family`**. The gate was written when that column held
the document-title family. **On 8 Sep `parts.family` became the MODEL** — the SKU minus its orderable suffix (`c9d5f48`;
migration 0013 applied 21:19 UTC) — and the title family moved to `parts.family_raw`. `git log -L` over `describesPart`,
`familyMatches` and `familyModelTokens` returns only `57a6ba6`: the gate's code never followed.

**It is latent, not live.** The gate runs only on inherited writes; only `apply-extract` produces them (the `apply-specs`
runs; `apply-acquired` never inherits). The last `apply-specs` runs — 844 at 11:35 and 846 at 11:49 UTC on 8 Sep, with 50
and 446 family refusals — predate migration 0013, so **every family refusal on record was made under the old values.**
`apply-specs` is a manual command (`src/pipeline/cli.ts`); nothing schedules it. **The trigger is the next manual
`apply-specs` run**, and it would not look like a failure: a refused inheritance leaves the existing fact in place, and
`apply-extract`'s own KNOWN BOUNDARY note says a store-refused entry is still graded as produced by its gate.

**Over every current inherited value fact on a live part — 37,043 facts (cisco 37,001, arista 42) over 9,468 (part,
inherited_from) pairs — the real `describesPart`, run three ways:**

| the gate's verdict changes… | facts |
|---|---|
| accepted on `family_raw` (the input it was written for), **refused on today's model `family`** | **12,216** |
| refused on `family_raw`, accepted on today's model `family` | 150 |
| accepted on `family_raw`, refused on `series` | 2,057 |
| refused on `family_raw`, accepted on `series` | 10,448 |

The largest single cell: 10,558 facts accepted on `family_raw` and on `series`, refused on the model — e.g. the NCS 2000
attenuator `15216-ATT-LC-10=` (`family_raw` *"Network Convergence System 2000 Series"*, model `15216-ATT-LC-10`, document
family `network-convergence-system-2000-series`). **`series` is not a drop-in fix**: it would admit 10,448 facts' pairs the
old gate refused, including inheritance onto non-products such as a part whose SKU is `110V` (series *"Catalyst 4500"*).

**And for item 12 specifically**, the three levels disagree about the very rows a restore would write:

| bucket | today (model `family`) | on `family_raw` | on `series` |
|---|---|---|---|
| restore candidate (267) | mismatch 189, unknown 4, **accepted 74** | **accepted 231**, mismatch 35, unknown 1 | mismatch 267 |
| model-name row (60) | mismatch 35, accepted 25 | accepted 60 | mismatch 60 |
| keep (49) | mismatch 35, transceiver 8, accepted 5, unknown 1 | mismatch 35, transceiver 8, **accepted 6** | mismatch 41, transceiver 8 |

Two things follow. `family_raw` accepts 231 of the candidates, so the 4 Sep retraction was judged on family values that had
changed again by 8 Sep — the handoff's own *"the family values I read today are not the ones the rule compared"*, now
measured. (What changed them between 4 and 8 Sep was not traced.) And no level is a sufficient guard on its own: `family_raw`
would also accept 6 rows this sheet keeps withdrawn. **The bucket rules, not the gate, are what separate right from wrong
here.**

## 4. The decisions

**A. Which level should the inheritance gate read?** *Recommended: decide before any `apply-specs` run.*
- **(a) `family_raw`** — the input the gate was written and tested for (whether each existing inherited fact actually
  passed the gate when written was not measured; some may predate it). A column-name change at the three call sites
  plus a test. Costs: `family_raw` is frozen at 8 Sep and
  "sometimes the wrong series" (its own column comment), and it is null for parts that had no title family — those stay
  refused as `family:unknown`, as before 8 Sep. **The conservative interim.**
- **(b) `series`** — admits 10,448 facts' pairs the old gate refused (non-products among them) and refuses 2,057 it
  accepted; refuses all 267 item-12 candidates. Not recommended as a drop-in.
- **(c) keep the model** and teach `familyMatches` to compare a model with a series — the durable fix; needs its own design
  and the same three-way measurement before it lands.

**B. Item 12.** *Recommended:*
- **Restore the 267 candidates** — after A, by a prepared script that supersedes each withdrawal row with the withdrawn
  value and its original provenance (document, locator, tier, method, `inherited`, `inherited_from`) inside a gated run,
  refusing any row whose bucket is not "restore candidate" at run time. Not written yet; say the word.
- **Keep the 49 withdrawn.**
- **Hold the 60 model-name rows** until the parts themselves are decided.
- The 900 optional-cup rows the same rule withdrew are out of this sheet's scope and unmeasured.

---

## Appendix: every group (from `scripts/measure-family-mismatch-retractions.mts`, 17 Sep)

`bucket | rows | parts | part series <= document | fields | first SKUs (sorted)`

```
keep | 37 | 37 | 2900 ISR <= Cisco Integrated Services Routers Generation 2 Ordering Guide - Cisco | dram 19, flash 18 | C2911-UCSE/K9, C2921-UCSE/K9, C2951-ES24-UCSE/K9
keep | 1 | 1 | Business 350 <= Cisco 5940 Series Embedded Services Router Data Sheet - Cisco | dram 1 | IPv6
keep | 1 | 1 | Business 350 <= Cisco 890 Series Integrated Services Routers Data Sheet - Cisco | certifications 1 | IPv6
keep | 1 | 1 | Network Convergence System 2000 Series <= 8-Port Enhanced Data Muxponder Card for the Cisco ONS 15454 Data Sheet - Cisco | temp_operating 1 | ONS-SE-G2F-SX=
keep | 1 | 1 | Network Convergence System 2000 Series <= Cisco ONS 15454 4 x 2.5-Gbps Muxponder Card - Cisco | temp_operating 1 | ONS-SE-2G-S1=
keep | 1 | 1 | Network Convergence System 2000 Series <= Multirate DWDM OTU2 XPonder Card for the Cisco ONS 15454 MSTP Data Sheet - Cisco | temp_operating 1 | ONS-XC-10G-L2=
keep | 3 | 3 | Network Convergence System 4200 Series <= Cisco ONS 15454 Any Rate Enhanced Xponder Card - Cisco | temp_operating 3 | ONS-SE-100-BX10D=, ONS-SE-100-BX10U=, ONS-SE-Z1=
keep | 2 | 2 | Network Convergence System 4200 Series <= Gigabit Carrier Ethernet DWDM XPonder Card for the Cisco ONS 15454 MSTP Data Sheet - Cisco | temp_operating 2 | ONS-SI-100-FX=, ONS-SI-100-LX10=
keep | 1 | 1 | SPA500 IP Phones <= Cisco SPA525G 5-Line IP Phone with Color Display - Cisco | certifications 1 | SPA500S
keep | 1 | 1 | Wireless Gateway for LoRaWAN <= Cisco Wireless Gateway for LoRaWAN Data Sheet - Cisco | mounting 1 | AIR-ACC1530-PMK1
model-name row | 12 | 12 | 3560-C <= Cisco Catalyst 2960-C and 3560-C Series Compact Switches Data Sheet - Cisco | ieee_standards 12 | 2960C-12PC-L, 2960C-8PC-L, 2960C-8TC-L
model-name row | 48 | 16 | 3750-X <= Cisco Catalyst 3750-X and 3560-X Series Switches Data Sheet - Cisco | altitude_max 16, certifications 16, ieee_standards 16 | 3560X-24P, 3560X-24T, 3560X-24U
restore candidate | 10 | 10 | 2960Plus <= Cisco Catalyst 2960-Plus Series Switches Data Sheet - Cisco | ieee_standards 10 | WS-C2960+24LC-L, WS-C2960+24LC-S, WS-C2960+24PC-L
restore candidate | 5 | 5 | 3560C <= Cisco Catalyst 2960-C and 3560-C Series Compact Switches Data Sheet - Cisco | ieee_standards 5 | WS-C3560C-12PC-S, WS-C3560C-8PC-S, WS-C3560CG-8PC-S
restore candidate | 6 | 6 | 800 <= Cisco 819 4G LTE 2.0 Machine-to-Machine Integrated Services Routers Data Sheet - Cisco | certifications 6 | C819G-4G-GA-K9, C819G-4G-NA-K9, C819G-4G-ST-K9
restore candidate | 6 | 6 | 800 <= Cisco 819 4G LTE M2M Gateway Integrated Service Routers Data Sheet - Cisco | certifications 6 | C819G-4G-A-K9, C819G-4G-G-K9, C819G-4G-V-K9
restore candidate | 2 | 2 | 800 <= Cisco 819 Non-Hardened 4G LTE 2.0 Machine-to-Machine Integrated Services Routers with Wi-Fi - Data Sheet - Cisco | certifications 2 | C819GW-LTE-GA-EK9, C819GW-LTE-MNA-AK9
restore candidate | 3 | 3 | 800 <= Cisco 819 Non-Hardened 4G LTE 2.5 Machine-to-Machine Integrated Services Routers with Wi-Fi for Asia, Australia, and Selected Latin America Regions - Cisco | certifications 3 | C819GW-LTE-LA-CK9, C819GW-LTE-LA-NK9, C819GW-LTE-LA-QK9
restore candidate | 9 | 9 | 800 <= Cisco 880 Series Integrated Services Routers - Data Sheet - Cisco | certifications 9 | C886VA-K9, C886VAJ-K9, C887VA-K9
restore candidate | 2 | 2 | 800 ISR <= Cisco 809 Industrial Integrated Services Routers Data Sheet - Cisco | certifications 2 | IR809G-LTE-GA-K9, IR809G-LTE-LA-K9
restore candidate | 2 | 2 | Catalyst 2960-CX <= Cisco Catalyst 3560-CX and 2960-CX Series Compact Switches Data Sheet - Cisco | ieee_standards 2 | WS-C2960CX-8PC-L, WS-C2960CX-8TC-L
restore candidate | 75 | 25 | Catalyst 3750-X <= Cisco Catalyst 3750-X and 3560-X Series Switches Data Sheet - Cisco | altitude_max 25, certifications 25, ieee_standards 25 | WS-C3750X-12S-E, WS-C3750X-12S-S, WS-C3750X-24P-E
restore candidate | 2 | 2 | Catalyst IR1100 Rugged <= Cisco Catalyst IR1101 Rugged Series Router Data Sheet - Cisco | certifications 2 | IR1101-A-K9, IR1101-K9
restore candidate | 3 | 3 | CMICR <= Cisco Catalyst Micro Switches Data Sheet - Cisco | ieee_standards 3 | CMICR-4PC, CMICR-4PS, CMICR-4PT
restore candidate | 2 | 2 | IE 3010 <= Cisco Industrial Ethernet 3010 Series Switches Layer 2/Layer 3 - Cisco | ieee_standards 2 | IE-3010-16S-8PC, IE-3010-24TC
restore candidate | 4 | 4 | IE1000 <= Cisco Industrial Ethernet 1000 Series Switches Data Sheet - Cisco | ieee_standards 4 | IE-1000-4P2S-LM, IE-1000-4T1T-LM, IE-1000-6T2T-LM
restore candidate | 50 | 25 | IE2000 <= Cisco Industrial Ethernet 2000 Series Switches Data Sheet - Cisco | certifications 25, ieee_standards 25 | IE-2000-16PTC-G-E, IE-2000-16PTC-G-L, IE-2000-16PTC-G-NX
restore candidate | 12 | 12 | IE3400H <= Cisco Catalyst IE3400 Heavy Duty Series Data Sheet - Cisco | ieee_standards 12 | IE-3400H-16FT-A, IE-3400H-16FT-E, IE-3400H-16T-A
restore candidate | 16 | 16 | IE3500H <= Cisco IE3500 Heavy Duty Series Data Sheet - Cisco | ieee_standards 16 | IE-3500H-12FT4T-A, IE-3500H-12FT4T-E, IE-3500H-12P2MU2XA
restore candidate | 12 | 12 | IE4000 <= Cisco Industrial Ethernet 4000 Series Switches Data Sheet - Cisco | ieee_standards 12 | IE-4000-16GT4G-E, IE-4000-16T4G-E, IE-4000-4GC4GP4G-E
restore candidate | 2 | 2 | IP Phone 8800 Series <= Cisco Wireless IP Phone 8821 Data Sheet - Cisco | certifications 2 | CP-8821-K9-BUN, CP-8821-K9=
restore candidate | 4 | 2 | IP Phone 8800 Series <= Cisco Wireless IP Phone 8821-EX Data Sheet - Cisco | certifications 2, supported_protocols 2 | CP-8821-EX-K9-BUN, CP-8821-EX-K9=
restore candidate | 1 | 1 | MDS 9200 Series Multiservice <= Cisco MDS 9250i Multiservice Fabric Switch Data Sheet - Cisco | certifications 1 | DS-C9250I-K9=
restore candidate | 4 | 4 | MDS 9500 Series Multilayer Directors <= Cisco MDS 9513 Multilayer Director Data Sheet - Cisco | certifications 4 | DS-C9513, DS-C9513-3AK9, DS-C9513-4AK9
restore candidate | 1 | 1 | Meraki <= MS130R Datasheet - Cisco Meraki Documentation | certifications 1 | MS130R-8P
restore candidate | 8 | 8 | Nexus 3000 <= Cisco Nexus 3132Q, 3132Q-X, and 3132Q-XL Switches Data Sheet - Cisco | ieee_standards 8 | N3K-C3132Q-BA-L3, N3K-C3132Q-BD-L3, N3K-C3132Q-FA-L3
restore candidate | 1 | 1 | Nexus 3000 <= Cisco Nexus 3232C Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3232C=
restore candidate | 1 | 1 | Nexus 3016 <= Cisco Nexus 3016 Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3016Q-40GE
restore candidate | 1 | 1 | Nexus 3048 <= Cisco Nexus 3048 Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3048TP-1GE
restore candidate | 3 | 3 | Nexus 3064 <= Cisco Nexus 3064-X, 3064-T, and 3064-32T Switches Data Sheet - Cisco | ieee_standards 3 | N3K-C3064PQ-10GX, N3K-C3064TQ-10GT, N3K-C3064TQ-32T
restore candidate | 3 | 3 | Nexus 31108 <= Cisco Nexus 3100-V Platform Switches Data Sheet - Cisco | ieee_standards 3 | N3K-C31108PC-V, N3K-C31108TC-V, N3K-C31108TCV-32T
restore candidate | 1 | 1 | Nexus 3132C Z <= Cisco Nexus 3132C-Z Switches Data Sheet - Cisco | ieee_standards 1 | N3K-C3132C-Z
restore candidate | 1 | 1 | Nexus 3132Q V <= Cisco Nexus 3100-V Platform Switches Data Sheet - Cisco | ieee_standards 1 | N3K-C3132Q-V
restore candidate | 5 | 5 | Nexus 3172 <= Cisco Nexus 3172PQ, 3172TQ, 3172TQ-32T, 3172PQ-XL, and 3172TQ-XL Switches Data Sheet - Cisco | ieee_standards 5 | N3K-C3172PQ-10GE, N3K-C3172PQ-XL, N3K-C3172TQ-10GT
restore candidate | 1 | 1 | Nexus 3264C E <= Cisco Nexus 3264C-E Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3264C-E
restore candidate | 1 | 1 | Nexus 3432D S <= Cisco Nexus 3432D-S Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3432D-S
restore candidate | 4 | 4 | Nexus 3500 <= Cisco Nexus 3548-X, 3524-X, 3548-XL, and 3524-XL Switches Data Sheet - Cisco | ieee_standards 4 | N3K-C3524P-10GX, N3K-C3524P-XL, N3K-C3548P-10GX
restore candidate | 1 | 1 | Nexus 36180YC R <= Cisco Nexus C36180YC-R Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C36180YC-R
restore candidate | 1 | 1 | Nexus 3636C R <= Cisco Nexus 3636C-R Switch Data Sheet - Cisco | ieee_standards 1 | N3K-C3636C-R
restore candidate | 2 | 2 | SPA500 IP Phones <= Cisco SPA525G 5-Line IP Phone with Color Display - Cisco | certifications 2 | SPA525G, SPA525G-RC
```
