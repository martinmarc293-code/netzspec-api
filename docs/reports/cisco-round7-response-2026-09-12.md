# NETZSPEC — round-7 response: your twelve decisions, executed

**From:** Claude Code · **To:** the reviewer · **12 September 2026**
**Build to audit: `0629eee` or later** — `/health` `parts` 91,543. Suites 56/56, typecheck clean.

Your twelve decisions are below in your order. Each one says **done**, **done differently** (with the
measurement that forced the difference), or **held** (with the reason). Four of them came out different
from what you decided. One of those four would have repeated a mistake I had already shipped, and that
comes first.

---

## 0. I shipped a cross-lane mistake, and it was live for about a day

Round 6 merged `tx_max_output_power` into `tx_power`. The commit said *"holds ZERO facts anywhere"*, and
sync run #986 applied it. **It held zero Cisco facts and 231 Juniper facts.** A supersession deletes
the retired key's profile rows in every category, so it took that cup off Juniper's transceivers.

The cause is structural rather than careless, which is why it matters for your audit as well as mine.
**The census is measured per vendor. A supersession or a retype is global.** The dictionary and the
profiles belong to every lane, and this worktree only ever measures Cisco. Your round-6 decision 4 had
the same blind spot, because you read the same Cisco census:

| key | your decision | Cisco facts | **all vendors** |
| --- | --- | ---: | --- |
| `tx_max_output_power` | (mine, round 6) → `tx_power` | 0 | **Juniper 231** — shipped, now reverted |
| `rx_max_input_power` | → `input_power_range` | 0 | **Juniper 240** — caught before sync |
| `tx_wavelength` | → `wavelength_range`, facts moved | 17 | **Juniper 261** — caught before sync |

**What changed:**
- Reverted, and restored by sync **#989**: `tx_max_output_power` is live again and its transceiver
  profile row is back.
- `syncDictionaryOn` now **refuses a new supersession of a key that still holds current facts**, naming
  every vendor. Proven by sabotage: I added `tx_wavelength` back, the sync refused with *"juniper 261,
  cisco 17"* (run #990, closed `failed`), the file was restored byte-identical, and the table was
  unchanged.
- `CLAUDE.md` gained a hard rule: measure a dictionary change across all vendors first.
- **The guard does not cover retypes or closed domains.** I checked the round-6 retypes by hand.
  `drive_interface` is held by no other vendor. `radio_bands` holds 26 HPE facts, all `"50Hz/60Hz"` —
  mains frequency on power supplies, already refused by the bare-Hz rule before the retype. So those
  26 are the same term-7 wrong pour as Cisco's `N55-PAC-1100W`, now visible for HPE too.

**For your next audit, and it applies to both of us:** a "0 facts" claim about a dictionary key needs
a query with no vendor filter behind it.

---

## 1. `layer` — done, and the fill path is narrower than you estimated

`layer`, `ipv4_routes` and `ipv6_routes` are optional and ungated. The 1,054 seeds are kept.

`src/core/layerFromSku.ts` is the fill path, scoped exactly as you said: the tier-letter families
(3850/3650/3750-X/3560-X, Catalyst 9200/9300/9400/9500), with IE-* and the 2960 lines refused by name.
Measured against the seeds:

```
agrees 276 · disagrees 0 · precision 1.000
speaks for 500 of 4,931 switches (10.1%), of which 224 are not already seeded
of 225 seeded IE-*/2960 rows it gets 0 wrong
```

You estimated about 988 derivable parts. That was my **unscoped** 20% figure. The scoping that took
precision from 0.913 to 1.000 halves the coverage, and I think that is the right trade. It is also why
the cup stays optional: an exact path that reaches one switch in ten does not justify a requirement of
all 4,931. The function does not write. Storing derived values is filling-phase work.

**The number your round-6 B2 was about is now zero:** required or pending cups with no fill path,
catalogue-wide, **0** (it was 1). `recompute-completeness` ran **once, catalogue-wide** (7,601 rows
rewritten). All 17 ledgers, censuses and mapper traces are rebuilt on commit `0629eee`.

## 2. Server sizing — done, three ways differently

**Label evidence first**, as you asked, over the 23,651-label inventory:

| cup | label occurrences | decision |
| --- | --- | --- |
| `memory_max` (n, GB, band 1–32,768) | **84** over 15 labels | **required** of `server` in all five categories |
| `dimm_slots` (n) | **4** — the other labels a probe catches are USB flash slots and a flash slot *cover* | **optional**. Required, it is 1,555 gaps on four occurrences |
| `pcie_slots` (n) | **18**, and the sample is prose: *"10 PCIe 2.0 slots available (total of 11 slots)"*. It also overlaps `expansion_io` (a struct) | **optional** until the prose parses |
| socket count | ~25 | **required** — but see the merge direction below |

**The merge direction is reversed.** You said `cpu_sockets_max` → `cpu_sockets`. Measured:
**`cpu_sockets_max` holds 246 own facts and `cpu_sockets` holds zero, in every vendor.** The dictionary's
own rule is that the survivor is the key holding the facts, not the tidier name. So `cpu_sockets` →
`cpu_sockets_max`, which moves nothing.

**The evidence showed a wrong pour.** `"Memory Capacity"` (×14) and `"Memory capacity"` (×7) mapped to
`dram`, the cup for installed memory, while the stored value was *"32 DIMMs; up to 512 GB"*. That is a
maximum in the installed-memory cup. Those labels now go to `memory_max`. Eight alias rules were added
in total. Two of them exist because my own lookaheads excluded `"Maximum memory speed"` and
`"Number of CPUs required"` and sent them nowhere. A lookahead that excludes a label is only half a
decision; the other half is where the label goes.

UC and conferencing servers get the same two cups: 77 servers with 6 spec-bearing documents, and 22
with 4. That is thin, but no thinner than servers-unified-computing itself (9.8%). Their cross-category
exception stands for `cpu`, `drive_bays` and `memory_speed_max`.

## 3. Breakout cables — done, and the fill path is complete

A `breakout-cable` kind is asked `form_factor_a`, `form_factor_b`, `breakout_count`, `cable_length`,
`data_rate` and `media`, and not `form_factor`.

**The selector needs two markers.** A rule on the fan-out alone (`-4X10G`, `-4SFP`) catches **seven real
multi-lane pluggable optics**: `QSFP-4X10G-LR-S`, `QDD-4X100G-FR-S`, `QDD-8X100G-FR`, `QDD-2X400G-FR4`
and three more. Requiring a cable suffix as well (`-CU`/`-AOC`/`-AC`/`-CI` plus a length) gives
**51 caught, and 0 missed of the 27 parts whose own `form_factor` fact names two cages**. That is 51,
not 37: the kind also catches the breakout cables that hold no `form_factor` fact yet.

**Three new required cups with no fill path would have been your B2 three times over**, so they have
one: `src/core/breakoutEnds.ts`.
- It answers **51 of 51**: 32 from the stored value or the name, 19 spares from a table of Cisco's SKU
  families.
- That table was proven against the independent text reading before it was kept: it **agrees on all 32**.
- Its own sabotage case caught a defect. The first version of the table gave `QSFP-4X10G-LR-S`, an
  optic, breakout ends. It now requires the cable suffix too.

The ledger could not see a derivation as a fill path and reported *"NO FILL PATH"* for all three. It
now can: `DERIVED_FILL_PATHS` names the function, the population it was validated over, and the result.

## 4. Wavelengths and the receiver window — the part you decided was not done

**Added:** `wavelength_range` (nr, nm, band 780–1650) and `lane_wavelengths` with a strict per-lane
parser. The parser reads a centre per `"(lane N)"`, and refuses gaps, reordering, and a range posing as
lanes.

- It exists because reading the output caught a fake pass. The generic list split returned the whole
  cell as a one-element list — a free string wearing a list's type.
- The ranges parse with the label's `(nm)` as the unit hint: all 15 do, and the band refuses
  implausible spans.

**Not done:**
- **Superseding `tx_wavelength`.** Juniper holds 261 facts on it (§0).
- **Superseding `rx_max_input_power`.** Juniper holds 240. It also cannot be done in one hop: two keys
  already point at it, a direct supersession creates a chain, and chains are refused. All three must
  move together.
- **Moving Cisco's 17 facts on their own.** With the key live and its alias unchanged, a Cisco-only move
  splits one quantity across two cups and new extractions go back to the old one. It is a cross-lane
  decision, and I would rather hand it to the Juniper lane with the new cups ready than decide it for
  them.

**"Fix the alias so html_table rows reach `wavelength`":** the alias is not broken.
`"Wavelength"` (×36) and `"Transmitter Center Wavelength"` (×25) already reach `wavelength` in both
transceiver and optical-networking. The 1-in-738 html_table figure is extraction coverage, not routing.

**The trace did show a real wrong pour:** `"Passband Wavelengths"` (×15) → `wavelength`, a filter's
window in a scalar cup. It is not changed yet. The nm cup is `filter_passband` and `passband` is MHz, so
it is a unit decision and not a label fix.

## 5. Orphan dictionary rows — done

Checked first against every table that references the dictionary, all vendors: facts 0, conflicts 0,
source_fields 0, superseded_by 0, profile rows 2. Deleted profile rows first, then the dictionary rows,
re-checked inside the transaction: run **#991**.

## 6. The 51 non-ledger hardware rows — done, written and not run

It is an addendum to `cisco-bundle-separation-plan-2026-09-12.md`. All 51 were read, 0 are unplaced,
and each destination's kind is resolved **from the row's real name**. They are all real devices in the
wrong category, which is the only reason they are asked nothing: NCS 540/5500/8000 systems, NCS 5500
MPAs, ISR 1100 terminal gateways, Nexus 9300 and 3550-F, Catalyst Wi-Fi APs, and Catalyst Center/APIC
hardware.

**Two classifier preconditions were found, and both would have made the move wrong:**
- `N540-ACC-SYS` and `N540X-ACC-SYS` are full access routers, and the routers axis reads their
  `SFP+/QSFP28` name and calls them **transceivers**.
- The Catalyst Center appliance and five NICs land in `unknown`, which would add 7 rows to the
  asked-nothing count the plan is meant to reduce.

With both plans run, the ledger total equals `/v1/stats` at **42,376**.

## 7. The promote candidates — held

Requiring `emc_emissions` and `humidity_storage` of **hyperconverged-systems'** `server` alone makes that
`server` differ from the other two UCS categories. That trips the same cross-category rule you used in
the next sentence to hold `meraki.power_load_idle_max`. The evidence (91%, 86%) exists only in
hci-systems, so requiring them of all three creates gaps with no evidence in two. Say which you want: a
named exception for hci-systems, or both held.

## 8. Device-noun — kept as a ceiling for one more round

That is what you decided. The figure is **256** over the union of both axes, and the ceiling is 260.
The kind-aware detector comes after the bundle plan resolves the 95 bundle rows, as you sequenced it.

## 9. `?contested=all` — done, and it found half the conflicts

Two forms, both live:
- `/v1/mapper/<v>/<c>?contested=all`
- `/v1/mapper/<v>/<c>/contested` — the followable path

Both are served from a sidecar the builder now writes, with every contested label.

**The counting bug you found is fixed:** a label matched only by out-of-scope rules has no winner and is
unmapped, not contested. `winner: null` entries in the visible 200 went from **14–22 per category to 0**,
and those labels get their own count (41–66 per category).

**It proved your §8.3 point the same day.** Removing the null-winner entries opened slots in the visible
200, a real 7-occurrence conflict crossed the cutoff, and the frozen-conflict test reported it as NEW.
It had existed all along. So the test now scans the complete sidecars, and the frozen list is **26, not
13**:
- your original 13;
- 4 case twins with the same rule and ruling (`Output Holdup Time`, `Data Rate`, `Power and Cooling`,
  `Integrated Interface`);
- **9 newly visible, ruling pending:**

| label | occurrences | wants | loses to |
| --- | ---: | --- | --- |
| `Environmental: Operating/storage humidity` | 6 | `humidity_operating` | `humidity_storage` |
| `Operating/storage humidity` | 3 | `humidity_operating` | `humidity_storage` |
| `Maximum Input at Nominal Input Voltage (VA)` | 4 | `power_max` | `input_va_max` |
| `Maximum Input at Nominal Input Voltage (W)` | 4 | `power_max` | `input_va_max` — a watts figure in a VA cup |
| `Nominal Input Current (Arms)` | 4 | `input_current` | `input_current_nominal` |
| `Compliance (EMC)` | 3 | `certifications` | `ieee_standards` |
| `Compliance (EMC)` | 3 | `standard` | `ieee_standards` |
| `Maximum Rated Output (W) 1` | 2 | `psu_output_power` | `psu_rated_output` |
| `Safety Approvals` | 1 | `safety_standards` | `certifications` |

The frozen table was also keyed on rule index, so any new alias rule renumbered all 26. Adding the
eight rules for item 2 did exactly that. It is keyed on `label|wanted cup` now.

## 10. Still held — correct

The 352-fact disposition table exists (`cisco-refusal-dispositions-2026-09-12.md`) and is waiting for
the operator's group-by-group approval. The bundle plan is waiting for family-by-family approval.

## 11. The two contradictions — fixed in place

In `cisco-round6-response-2026-09-12.md`:
- sync-dictionary *was* run (#986, and corrected by #989);
- the device-noun figure is 256, while 159 and 260 are the old and new ceilings.

## 12. The audit build checklist

| you asked | state |
| --- | --- |
| recompute done | **yes** — once, catalogue-wide, then the three categories item 2 changed |
| ledgers on one commit | **yes** — `0629eee`, with the three follow-up ledgers in the next commit |
| `_about_summary` truthful | **yes** — it states what the form drops, and `document_evidence` plus both detectors are in it |
| `airflow` regating visible in the switch kind | **yes** — `airflow` is in `switch.optional` (from `na`); `ip_rating` and `module_slots` are optional for switches outside their gate |
| §8.2 "seen" rule | **implemented** — a disabled source or one with 0 facts reads `seen-but-inactive` and is not a tap. The new `observed_filled` field (one own, non-seed fact) sits beside `observed_fill_path`. `transceiver.reach_max` now shows the case you found: fill path `true`, filled `false` |

**One more instance of the round-6 defect, one layer down.** `recompute-completeness` did not filter
retired rows. It recreated the 139 completeness rows run #988 had just deleted — caught by reading the
part count it printed (91,682, the count *with* tombstones). The source is fixed, the rows were deleted
again (#993), and a later recompute left 0.

---

## What to audit next

1. **§0 first.** Pick any key this session superseded or retyped and query its facts **without a vendor
   filter**. If anything disagrees with the table above, that outranks everything else.
2. **The phase numbers:** required cups with no fill path = 0; asked-nothing = 3,071 (unchanged until the
   bundle plan runs); ledger hardware 42,450 against `/v1/stats` 42,501, where the 51 is item 6.
3. **The 9 newly visible conflicts** need rulings. **Item 7** needs a choice.
4. **`breakout-cable`:** `/v1/parts?vendor=cisco&category=transceiver&kind=breakout-cable`. Check the
   seven refused optics stay `pluggable`.

**What still stands between us and the filling phase, as I read it:**
- Operator approval of the bundle plan, the 51-row addendum and the 352 dispositions.
- Your rulings on the 9 conflicts and item 7.
- The cross-lane wavelength and receiver-window merge, which needs the Juniper lane.

None of those is a schema change still to be built on the Cisco side.
