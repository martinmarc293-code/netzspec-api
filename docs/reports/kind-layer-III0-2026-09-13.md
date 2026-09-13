# Kind layer: Part III.0 measurements, one report (13 Sep 2026)

For the reviewer, answering `netzspec-cisco-kind-layer-specification-2026-09-13.md` Part IV: *"Run Part III.0
first and return its outputs as one report."* **Nothing in Part II is implemented.** No cup set, role delta,
kind rename, category merge or `deploy_role` column was written. The only store writes in this window are
the phase-1 close runs, which are recorded separately.

- **Measured:** 13 Sep 2026, 01:00–02:45 UTC, by four read-only agents (`application_name agent/kindlayer-{A,B,C,D}`,
  `default_transaction_read_only = on`) on the cisco tree at `3aff73b`/`ea74e31`. The classifier files did not differ
  between those two commits.
- **Population:** live Cisco hardware, meaning `retired_at IS NULL AND product_class = 'hardware'`, which is
  **42,367** parts. The spec says 42,383 at `88bc982`; the difference is the 16 device-noun class changes
  (runs #1023/#1024).
- **Evidence:** every item file carries its own method, controls and "could not check" section.
  - Item files: `docs/reports/kind-layer-III0-2026-09-13/III0-{1..6}-*.md`
  - Raw outputs: `raw/`
  - Scripts that produced them: `scripts/{A,B,C,D}/`
  - Paths inside the item files that begin `D:/tmp/kindlayer-III0/` refer to the working copy these files were
    taken from. Large row dumps (`parts.json` and similar) were left there and not committed.
- **Cost:** 2,087,051 subagent tokens, which is 4% over the 2.0M cap. See `docs/ORCHESTRATION-LEDGER.md`.

## The layering problem, in one paragraph

Part II proposes cup sets per **kind**, with deltas per **role**, keyed on `series`. The measurements say
the three layers cannot be stacked in that order today:

1. **The kind is right more often than the series.** Series labels are wrong in bulk, and in ways that
   invert roles (items 3, 4).
2. **Many rows are not the kind at all.** 8.9% of switch rows, 21.4% of enterprise router rows and 16.6% of
   phone rows fall into this class (item 3).
3. **Most proposed required cups are not printed by the documents we hold.** 680 of 905 measured proposed
   required/pending cups fall under the 50% label-share bar (item 1).
4. **Every other vendor falls through to a default kind** that is named and therefore reads as resolved,
   and has no series at all (item 5).

So the order of repair is:

- **kind membership first:** move out the rows that are not the kind;
- **then roles:** from SKU tokens, never from `series`;
- **then cup sets:** from measured label shares;
- **cross-brand:** either name tokens or a Cisco-only scope.

The II.x cup sets as written would ask hundreds of questions that the documents we hold cannot answer.

## Item 1: label shares over held parts, per (kind, role)

`III0-1-label-shares.md`, `raw/item1-label-shares.json`

- **Method.** For each held spec-bearing document, the pipeline's own extractors were re-run over the laptop
  cache copy. Every label was mapped with `mapLabel` at HEAD, and the share of held parts evidenced for each
  proposed cup was computed.
- **Coverage and control.**
  - Held parts: 9,796 of 9,865 are readable (99.3%), over 997 held documents.
  - Control: 93.3% of 9,094 stored document-sourced facts are re-found in the re-extracted labels.
- **Verdicts over 217 (category, kind) rows:**

  | verdict | cups |
  |---|---:|
  | proposed required/pending that pass ≥50% | **225** |
  | proposed required/pending that fail (would be optional until measured) | **680** |
  | registered or proposed derivation | 11 (5 registered, 6 **not registered**) |
  | optional as proposed | 355 (61 of them pass ≥50% and are promotable) |
  | new keys | 16 |
  | not measurable (no readable held part) | 290 |

- **Switch** (4,942 parts, 1,520 readable held): **9 of 27 proposed core cups pass**.
  - Fail: `uplink_ports` 35.8, `forwarding_rate` 35.3, `mac_table` 42.7, `vlan_max` 16.6, `packet_buffer` 29.7,
    `poe_budget` 18.2, `power_max` 27.1, `stacking_bandwidth` 11.3, `rack_units` 3.3.
  - Near zero: `mgmt_class`, `psu_config`, `psu_redundant`, `poe_standard`, `stackable`, `module_slots`, `form_factor`.
  - The `datacenter` role passes **1 of 34**. `core-agg` fails even `ports` (3.8) and `switching_capacity` (41.5).
- **Demotions the spec proposes that the data refuses**, in role `smb`: `temp_storage` is 100, `flash` 86.2,
  `mtbf` 56. All three **stay required**.
- **Sensitivity test.** Reading the four Business series as `smb` rather than `industrial` flips four
  verdicts:
  - `mtbf` smb: 56 → 46.6 (demote)
  - `ipv6_routes` smb: 38.5 → 52.9
  - `input_voltage` industrial: 47.5 → 65 (required)
  - `mounting` industrial: 39.5 → 50.7 (required)
- **Other failures named in the brief:** phone `voice_lines` 2.2, pluggable `data_rate` 0.3.
- **Could not see.** Shares measure what the mapper at HEAD maps, so a mapper gap reads as label absence.
  The `hint_unmapped_share` column separates "not printed" from "not mapped". 18 held documents were
  unreadable here. The kinds the spec proposes that do not exist yet (chassis, cable, appliance, fc-switch)
  have no held population to measure.

## Item 2: term-13 label Jaccard, before and after the role split

`III0-2-jaccard.md`, `raw/item2-jaccard.json`

Weighted mean pairwise Jaccard over series groups, on the kind's required-cup keys. Below 0.5 fails.

| kind | before | after (pooled within role) |
|---|---:|---:|
| switches.switch | **0.413** | 0.515 (0.521 with Business → smb) |
| wireless.ap | **0.460** | 0.681 |
| routers.enterprise | **0.424** | 0.521 |
| collaboration-endpoints.phone | 0.615 | **0.605** (the split makes it slightly worse) |
| transceiver.pluggable | 0.509 | no role axis |
| servers-unified-computing.server | **0.464** | no role axis |
| servers-unified-computing.cpu | **0.394** | no role axis |

- **The split clears the bar for switch, ap and router, but only just for switch and router.**
- On the raw label strings the means are 0.08–0.31, so the pass is a property of the mapper's key
  collapse and not of the documents.
- The phone split is not justified by label granularity.

## Item 3: series → deploy_role, hand-read

`III0-3-series-roles.md`, `raw/deploy-role-series.proposed.json`, `raw/control.txt`

- **Rules.** Ordered SKU-token rules were applied to every live row of the four kinds and re-read per series.
  - 54 witness SKUs pass.
  - 4 sabotaged rule lists each fail on the witness they protect.
- **Null share.** At most 0.2% of kind members are left null, which meets the III.4 bar of 3%. **Over all
  current rows the bar is not met:**
  - switch 8.9% (441 rows)
  - router 21.5% (337)
  - phone 16.6% (85)

  Those rows are not unresolved roles. They are rows that are not the kind, and III.4 should count them
  separately.
- **The series label cannot carry roles:**
  - The four **Business 350/250/220/110 series are SMB, not industrial.** That is 628 rows; A.2's `industrial 879`
    against a real 211.
  - Catalyst 1200/1300 are SMB. This is a judgement from the OS line and is flagged.
  - Router `ASR 9000` holds **0** ASR 9000 routers, `8000` holds **0** SP 8000, and `High-Speed WAN Interface Cards`
    holds 38 router bundles.
  - `800 ISR` is the Industrial IR809/829.
  - AP `Catalyst 9163` is mostly indoor, and `Catalyst Embedded Controller` holds 37 outdoor units.
  - Phone 8865 is a desk phone, and 61 wireless 792x sets sit in `7900`.
- **Operator points, left open rather than guessed:**
  - C8455-G2/C8475-G2: branch or edge.
  - Catalyst 1200/1300: smb or access.
  - CG113: branch.
  - Modular chassis carry a switch role until a `chassis` kind exists.

## Item 4: counts for the uncounted `[J]` populations

`III0-4-counts.md`, `raw/kind-count-diff.json`, `raw/item6-unresolved-families.json`, `raw/item7.txt`

### Switch chassis

524 candidate rows were read:

| group | rows |
|---|---:|
| bare chassis PIDs | **75** (plus 7 LEM-slot chassis, which are a decision) |
| chassis bundles | 165 (→ bundle) |
| mechanical kits | 65 |
| switch + FEX bundles | 48 |
| fixed switches that say "chassis" | 41 |

The `form_factor = modular-chassis` fact finds only 14 of them.

### Other populations

- **DAC/AOC in transceiver.pluggable:** 191 rows. 115 are copper DAC/twinax and 69 active optical. 8 are
  breakout DACs, which belong in `breakout-cable`. SFP-CU-RJ45 and CX4 are modules and stay.
- **routers.module:** 660 rows. Only 266 fit the spec's NIM/HWIC/SM/PVDM/SPA families. 182 are SP port adapters
  and interface modules, and 155 are IoT/cellular pluggables. By function, 406 are interface, 157 cellular,
  41 DSP, 29 service.
- **Overturned or corrected spec moves:**
  - `security.firewall` "Secure Client": all 18 are **ASA VPN-edition hardware bundles**. The class-software
    move in II.8 would be wrong.
  - `routers.forwarding`: all 22 are **ASR1000 Embedded Services Processors**. `forwarding → linecard` would
    ask for `ports`, which an ESP does not have. `processor` fits.
  - `routers.transceiver`: all 5 are caps or an install kit, so `mechanical`.
  - `interfaces-modules` CPAK/CFP rows: **0**. The premise does not hold.
  - `wireless.appliance`: 9 of 20 are ASR 5000/5500. **115 ASR5K/ASR55K rows sit in `wireless`**, across 7
    kinds. The spec counted 15.
  - `transceiver.accessory`: all 14 are CWDM mux/demux/OADM units. They need a `mux` kind or a move to
    optical-networking.
  - `servers-unified-computing.unknown`: 145 of 539 are datasheet-cell fragments (retire), 88 are
    software/service PIDs, and **46 are NVMe drives** (`ucsKind` has no `NVE` token).
  - `servers-unified-computing.server` "foreign series": these are UCS servers under wrong labels. No
    transceiver or Nexus row is present.
- **No enterprise router row moves to `sp-core`.** A SKU-shape control over all 1,575 rows found 0
  HWIC/ASR9K/NCS/CRS/SP-8000 SKUs.

## Item 5: cross-brand check of the kind axis

`III0-5-cross-brand.md`, `raw/crossbrand-tab.md`, `raw/nouns-tab.md`

- **Consumer-level control.** For all 3,476 non-Cisco live hardware parts, stored `required_fields` equals what
  the classifier returns now (3,476 of 3,476). The table describes what these parts are actually asked.
- **`series` is NULL on 3,476 of 3,476 non-Cisco parts.** A series-keyed `deploy_role` is null for every
  non-Cisco switch, router and AP, which is 100% null against a 3% bar.
- **Unresolved share understates the problem.** The Cisco axes read SKU tokens that other vendors do not carry,
  so their parts fall through to a **named default kind** and read as resolved:
  - **HPE switches:** 234 of 447 are not switches (I/O modules, chassis, fabrics, MPUs, 13 Fibre Channel
    switches), and all of them are asked the 36-cup switch set.
  - **HPE interfaces-modules:** 309 of 347 are not modules (197 DAC/USB cables, PSUs, fans).
  - **HPE routers:** 61 are gateways asked 26 router cups.
  - **Juniper power-supplies and power-cables:** 302 parts are asked **0 cups**. These categories have no kind
    axis.
  - **Juniper interfaces-modules:** 53 line cards sit in `module`.
  - **Aruba switches:** 65 non-switches (line cards, uplink modules, a chassis) are asked the switch set.
  - **MikroTik:** 5 real `-RM` switches are `accessory`, because of the rack-mount token in the rule at
    `switchKind.ts:174`.
  - **All vendors:** 840 DAC/AOC rows sit in `transceiver.pluggable` across 11 vendors.
- **Cross-lane risk (not a kind finding, recorded here because it bites the same tables).** The HPE and
  Juniper trees still carry the old flat `recompute-completeness`. A recompute from those trees would
  overwrite the kind-aware rows the cisco tree wrote for their parts.

## Item 6: downstream dependencies of merges, renames and new kinds

`III0-6-downstream.md`, `raw/merge-counts.md`, `raw/rename-sets.md`

- **netzspec.com writes `category` only when it inserts a stub.** A category move in the API never reaches the
  site: `cw9166i`, `ta-c93180yc-fx` and `cts-5k-lc-switch` still breadcrumb to their old categories. A site
  redirect added before the site's own category is rewritten would hide parts.
- **Merges carry mostly licences.** `conferencing` holds 69 hardware parts and 3,680 non-hardware.
  "0 hardware rows left" is met by moving hardware only, which leaves a live licence category. Then no
  category redirect is correct. **Which classes move must be decided first.**
- **Kinds survive every proposed merge unchanged**: 69/69, 22/22, 1,204/1,204 and 786/786. There are 0 slug
  collisions.
- **Three "renames" are cup-set decisions under the freeze:**
  - `security-module → module` drops 7 firewall cups from 88 blades.
  - `ips-module → module` drops `ips_throughput` from 14 parts.
  - `forwarding → linecard` is wrong on all 22 rows (see item 4).
  - `psu → power` adds cups.
- **HexCat, hexwaren.de and JTL have no dependency.** Data flows HexCat → netzspec only.

## What v3 needs to decide (asked, not assumed)

1. **Order of repair.**
   - Kind membership moves go first: the §6 rows of item 3, the item 4 wrong-table rows, the 46 NVMe drives,
     the 115 ASR5K rows, the chassis/bundle split.
   - Roles come second, from `raw/deploy-role-series.proposed.json` (SKU-token rules). Series is kept only
     for traceability.
   - Cup sets come last, from item 1's measured shares.
2. **Required cups.** Either adopt item 1's rule (a cup under 50% label share over held parts is optional
   until measured), or name the cups the reviewer wants required regardless, with the reason.
3. **Business 350/250/220/110 and Catalyst 1200/1300 → smb.** The listed router, AP and phone role
   corrections apply as well.
4. **`forwarding` → `processor`, not `linecard`. Secure Client stays hardware.** Neither `security-module` nor
   `ips-module` folds into `module` without an explicit cup decision.
5. **Cross-brand.** Either `deploy_role` reads name tokens for non-Cisco vendors, or III.4's bar is Cisco-only.
   Juniper power-supplies and power-cables need a kind axis, or they stay at 0 cups by decision.
6. **Merges: which product classes move, before any site redirect.** netzspec.com's sync must learn to update
   `category`, and that belongs to the netzspec.com lane.
