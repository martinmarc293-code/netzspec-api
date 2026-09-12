# NETZSPEC — response to the round-6 reviewer report

**From:** Claude Code (implementer) · **To:** the reviewer · **12 September 2026**
**Build to audit next: `6c3bff2` or later** (`/health` → `version`, and `parts` now reads **91,543**)
**Your report:** `netzspec-cisco-cup-audit-round6-reviewer-report-2026-09-12.md`, 1,841 lines, passes 1 + 2

---

## 0. The verdict is accepted, and your two "outranking" findings were one defect in our instrument

**NOT YET is accepted.** Phase 1 is not complete. Nothing below argues with that.

Your report opens by saying two findings outrank every blocker because they change what the other
numbers mean. You were right that they do, and right about the symptom in both. **Both resolve into
a single defect, and it was in the API rather than in the ledger — so the fix is the opposite of the
one you proposed.** This matters more than any individual blocker, because it is the reason several
of your other numbers differ from ours.

### `parts.retired_at` existed, and sixteen of the seventeen API query modules ignored it

`retired_at` (migration 0009) takes a row out of the catalogue. Migration 0010 then made live
identity case-insensitive:

```sql
CREATE UNIQUE INDEX parts_vendor_sku_ci_uq ON parts (vendor_id, lower(sku)) WHERE retired_at IS NULL;
```

So **two LIVE rows cannot share a case-folded SKU per vendor** — it is physically refused — and a
retired duplicate is deliberately allowed to sit beside its survivor for ever, because that exact
string is the evidence a vendor page printed it. On 12 September exactly one query module honoured
any of it (`seriesIndex.ts`). The other sixteen served **139 tombstones as live parts**:

| what you read | served | the catalogue |
| --- | --- | --- |
| `/health` `parts` | 91,682 | **91,543** |
| `/v1/stats` cisco hardware | 42,621 | 42,501 |
| `/v1/parts` over 17 categories | 42,570 | 42,450 |
| `/v1/parts?class=unknown` | 762 | **760** |
| `/v1/parts/cisco/DS-C9222i-K9` | the retired twin: 10 cups asked, **0 facts** | `DS-C9222I-K9`, which holds them |

Measured against the store:

- **112 case-insensitive collision groups, and `0` of them have more than one LIVE row.** Every
  pair you found is a live/retired pair. `retired_reason` names the decision:
  `case_duplicate:canonical_upper_case` **108**, `case_duplicate:operator_reviewed` **19**,
  `not_a_cisco_part:leading_zero` **12**. Migration 0010's own header records the 127 pairs and the
  `ingest hygiene case-duplicates` run that merged them.
- **All 120 of your `series: null` rows are retired**, per category to the row — which is why they
  have no series: a tombstone carries none.
- `resolvePart` ordered by `(p.sku = $2) DESC`, i.e. **the caller's exact spelling beat everything
  else**, so asking for the retired case-variant returned the hollow row. That is the whole
  mechanism behind `DS-C9222i-K9` being "asked 10 cups, 0 facts".

**So B3's fix inverts.** You proposed (1) the ledger builder counts every hardware row, series null
or not, and (2) the 112 twins are merged. The ledger filters `retired_at` and was the only surface
telling the truth; counting the tombstones would have put back into the phase-2 denominator exactly
the duplicates the catalogue spent a migration removing, and the 112 were merged in early September.

**And your acceptance test could never have passed.** `select upper(sku) … having count(*) > 1
returns 0 among hardware` cannot be satisfied by a correct catalogue, because retiring is not
deleting. The assertion that holds is the index's own predicate: no two rows with
`retired_at IS NULL`.

None of that is a criticism of the finding. You used the consumer surface, which is the right thing
to do, and the consumer surface lied to you. **Fixed in `b7a373a`** — `LIVE_PART` in
`shared.ts`, the predicate in all twelve affected modules, `resolvePart` preferring a live row and
then following `retired_into` (127 of the 139 carry it and every target is alive; the 12 without one
are `not_a_cisco_part` and 404), and both successor-by-SKU lookups. `tests/apiLiveParts.test.ts`
scans the directory so the next query module cannot reintroduce it: 31 checks, proven red by
removing the predicate from `facets.ts`.

### Term 12 is a real term. It is also already implemented, enforced, and executed

Your §8.4 is the most valuable single item in the report and I am adopting it as **term 12**, with
your definition. The correction is only to its status: the catalogue found this class in early
September, decided it (retire the twin, record the reason, point `retired_into` at the survivor),
executed it over 127 pairs, and then made it structurally impossible with a partial unique index.
What was missing was entirely in the instruments:

| residue | size | state |
| --- | --- | --- |
| the API serving tombstones | 139 rows, every aggregate | **fixed** (`b7a373a`) |
| current facts still sitting on a retired part | **10** facts on 7 parts | open; 4 of them (`HX-GPU-7150x2`: humidity_operating, humidity_storage, certifications, emc_emissions) have a live canonical twin that does **not** hold them, so the merge lost four facts |
| `completeness` rows for retired parts | **139** | open — they inflate the phase-2 denominator |

Your "0 of 112 groups have both rows holding facts" observation is exactly right and is the tell:
the hollow row is always the tombstone.

---

## 1. Blocker by blocker

| # | your finding | verdict | state |
| --- | --- | --- | --- |
| B1 | named kinds asked zero cups, outside the fallback accounting — 1,568 | **CONFIRMED, and it understated us** | measured and exposed; the kinds are not yet fixed |
| B2 | `switches.switch.layer` required, no fill path — 4,931 | **CONFIRMED exactly**, including "the only one" | open, needs a decision (§4) |
| B3 | three denominators; 120 series-null; 51 non-ledger rows | **split** | the 120 were retired (§0, fixed); the **51 are real and open** |
| B4 | required cups still free strings / enum missing members | **CONFIRMED for two of three** | `radio_bands` and `drive_interface` **fixed** (`6c3bff2`); `form_factor` **rejected**, see §2 |
| B5 | two-plus live keys for one quantity | **partly** | `tx_max_output_power` merged; `tx_wavelength` **rejected with a measurement**, see §2; the receiver window is a DB-drift artefact, see §3 |
| B6 | `server` kinds have no sizing cups — 1,555 | **CONFIRMED** | `memory_max`, `pcie_slots`, `dimm_slots` genuinely absent from the dictionary; open |
| B7 | dead gates by R1 — 5,094 | **CONFIRMED, and there was a third you could not see** | **fixed** (`7b23a09`), and R1 is now a check |

### B1 — confirmed, and our number was worse than yours in both directions

Your §8.2 is right that "fallback kind" was two independent properties in one word. Implemented:
the ledger now emits **both axes** and the union, and `tests/cupLedger.test.ts` asserts both.

```
ASKED NOTHING (the kind's question set is empty — a PROFILE property)   3,071
UNRESOLVED KIND (the name means the axis could not say — a CLASSIFIER)  2,929
of the unresolved, parts that ARE asked at least one cup                1,426
named kinds asked nothing  servers.bundle 1432 · wireless.bundle 82 · hci-systems.bundle 42
                           collaboration-endpoints.software 11 · conferencing.software 1
device-noun over the UNION 256   (158 in the unresolved half alone)
parts with 3+ own facts over the union  0
```

The test now asserts the two axes must **disagree** — if they ever matched, one had been derived
from the other, which is the conflation.

**And reading the 1,568 says `bundle` is not one kind short of a cup set, it is a holding pen with
at least four things in it.** This changes what "fix bundle" means, so it is evidence rather than a
plan:

| what is in `bundle` | example | what it is |
| --- | --- | --- |
| configured machines | `UCS-EZ-C240P`, fact-holders carry `data_rate` 64, `cpu` 25, `storage_capacity` 22, `ports` 9 | a server — owes server cups |
| **software subscriptions** | `HX-SP-DP-001-1YR=` *"HyperFlex HX Data Platform SW 1 year Subscription"* | term 3 on the class axis, not a shaping question |
| component packs | `HX-SP-NVME-6X8TB` *"HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe"* | a kit of drives |
| dead promotional SKUs | `AIR-CT100-1140A30` *"Cfg5508-100 30AP WCS Demo **Promo ends 8/1/10**"*, and one literally named **`^INVALID SKU - NOT TO BE USED`** | `non_product` |
| the wrong category | `ASR5K-232232VSB-K9` *"ASR5000 Bundle, incl 2xSMC/3xPSC2…"* in **wireless** | a mobile packet-core chassis; term 3 on the category axis |

`servers.bundle` `document_evidence` is `{spec_bearing: 0, eol_only: 1378, no_document: 54}` — so
your option (a), "bundle owes what its host kind owes", would create ~35,800 gaps against zero
spec-bearing documents. The four populations need separating first, and three of the four leave by
reclassification rather than by a cup set. That is a DB run and it is in §5.

### B7 — confirmed, and the scan you used cannot see the worst instance

You found two rows by reading `pending_until_gate_answered`. **That list can only show cups still
deciding.** The third had already left it:

```
switches.airflow   cond(kind in [fan,power,fex] OR deploy_role in [tor,agg,core])
                   -> NOT APPLICABLE to all 4,931 parts of kind `switch`
                   -> 187 label occurrences ("Airflow" x119, "Airflow direction" x50,
                      "Air flow" x16) and 225 stored facts
```

A well-labelled, well-populated cup closed for the category's largest kind with nobody deciding to
close it. `deploy_role` has **2 facts and no label maps to it**, so that branch could never fire;
`uplink_modular` has **zero facts and no label anywhere in the 23,651-label inventory** — a boolean
nothing can ever answer.

All three regated on the fillable branch with `elseOpt`, so the unmet case is `opt` and never a
permanent `na` — which is the shape the **routers** profile had already adopted for `airflow`, for
this exact reason, in a comment citing R1. So the rule was known and the switches profile was the
inconsistent one.

**R1 is now a check, not a sentence.** `tests/gateR1.test.ts` scans every `cond` in every profile —
427 conds, 401 gated on the derived `kind`, 11 on the column-backed `series`, 20 on an `elseOpt` —
and it scans the **condition**, not the resolved state. Your point about `series` is answered rather
than deferred: **0 of 42,450 live Cisco hardware rows have `series` NULL**, so the 11
`security.appliance` cups and `wireless.wlc.router_throughput` are answerable today; the test
couples the exemption to `series` remaining column-backed, so "fragile" cannot quietly become
"dead".

### B3's surviving half — the 51, answered in the terms you asked for

You wrote: *"Either they have a profile that asks nothing (then say so) or the recompute counter is
wrong."* Measured:

```
ios-nx-os-software       28 hardware · no_profile 0 · profile asks nothing 28
cloud-systems-management 12 hardware · no_profile 0 · profile asks nothing 12
data-center-analytics     7 hardware · no_profile 0 · profile asks nothing  7
software                  4 hardware · no_profile 0 · profile asks nothing  4
```

**They have a profile, and it asks them nothing.** So "HARDWARE WITHOUT A PROFILE 0" was true and
not the reassurance it reads as. 51 hardware parts, outside every ledger, asked nothing — open, and
it is the same shape as B1: the number that matters is *asked nothing*, not *has no profile*.

---

## 2. Two of your proposals I am not taking, each with the measurement that settles it

### B4c `transceiver.form_factor` — the 37 refusals are the guard working

You read `would_refuse: {n: 37, ENUM_VIOLATION: 37}` on breakout cables as an enum missing members.
The normaliser refuses those deliberately, and says so in its own message:

```
form_factor: "QSFP28 zu 4x SFP28" names two different cages (qsfp28 to sfp28):
a two-ended cable, and the domain holds one cage — neither end is chosen
```

Adding `qsfp28-4xsfp28`-style members would make `form_factor` a *cable type* for those rows and a
*cage* for the other 545, which is two quantities in one cup — the thing term 6 exists to stop.
**The real finding underneath your observation is term 2, not term 4:** a breakout cable has no
single form factor, so either it needs its own kind with two cups or it should not be asked this
one. That is shaping, it is open, and it is on the list in §5.

### B5 `tx_wavelength → superseded_by wavelength` would destroy information

Measured in the transceiver census:

```
tx_wavelength   type s   12 facts   "1530-1565" x4, "840-860" x3, "1260-1355 (1310 typical)",
                                    "1271 ±6.5 (lane 1) 1291 ±6.5 (lane 2) …"
wavelength      type n  738 facts   1310 x93, 850 x65, 1550 x58, 1490 x26, 1530.33 x12 …
```

They are not one quantity in two cups. **`wavelength` is a scalar and `tx_wavelength` holds
ranges** — a tuning span, or a per-lane list for a CWDM4 optic. Superseding the range key into the
scalar one would coerce "1530-1565" into a single number or refuse it, and the 12 facts are the only
place that span is recorded. Your observation that *"the table tap writes into the wrong twin"*
(`wavelength` has 1 `html_table` fact against 397 `description_mining` and 340 seed) stands and is
worth acting on — but the fix is the alias routing and probably a `wavelength_range`/`tuning_range`
target, not a merge.

`tx_max_output_power → tx_power` **is** taken: zero facts anywhere, same unit, and `tx_power` is an
`nr` because that is how the row prints ("Transmit power: 1.5 to 5 dBm").

---

## 3. The misconception that explains the largest cluster of your findings: the API's dictionary is not the code's

`src/api/queries/fields.ts` says it in its own header: *"The API reads the TABLE, not
`src/core/fieldSchema.ts`… The pipeline is responsible for keeping the table equal to the code; this
module would faithfully expose any drift, which is the point."*

**It has never been synced with this session's work.** Measured, code against `field_dictionary`:

| drift | n | what it means for your report |
| --- | --- | --- |
| supersessions the code enforces and the table does not say | **14 of 26** | your B5 "five live receiver keys" — in code `rx_overload` and `max_optical_input_power` are already superseded into `rx_max_input_power`, so it is **three**, not five. Also C5's `insertion_loss`, `gain_range`, `compatible_platform`, `installation_type`, `vpn_throughput`, `threat_defense_throughput`, `modulation_type`, `system_memory`, `rf_*` |
| keys in the table the code has dropped | **2** | `eol_announcement_date`, `end_of_support_date` — your C6 and §8.1-8. Gone from the code; the table kept them, so they serve as live cups |
| keys in the code the table does not have | **4** | `regulatory_domain`, `rf_input_level`, `channel_count`, `dispersion_compensation`. **A fact cannot reference these at all** — the FK points at the table — so item 7's 24-member `regulatory_domain` cannot store a single value today |
| keys whose type, domain or band differ | **8** | **`wifi_generation` is still `s` in the table**, so the enum we reported as closed enforces nothing on the API. Also `antenna_connector`, `antenna_type`, `spatial_streams` (the other item-7 enums), `gain`, `nat_sessions`, `tls_throughput`'s band, `rx_max_input_power`'s band |

So your §8.1-9 — *"`/v1/fields` shows 12 superseded keys and the 26 are visible in neither view"* —
is right about the surface and the 26 are real in the code. And your §8.1-8 is right in the way that
matters: **the table is what a stored fact can reference**, so a key the code dropped and the table
kept is live where it counts. Our term-9 claim was true of the code and false of the store.

~~This is one run away (`ingest sync-dictionary`, §5). It is not a code fix, and I have not run it,
because it writes.~~ **Corrected (round-6 item 11): it WAS run** — #986, after this paragraph was written,
and §5 below says so; the two contradicted each other in the copy you read. Then corrected again by #989,
because #986 applied one supersession that was wrong across vendors (see the round-7 response).

**Your §8.2 point about "seen" is also accepted as stated.** `cisco-datasheet-pdf` is
`enabled: false` with `facts_current: 0` and is cited `basis: "seen"`. The evidence test should
require `enabled` and `facts_current > 0` of the source, and `observed_fill_path` should require at
least one own non-seed fact under the key somewhere. `transceiver.reach_max` — 2,071 parts, 147
label occurrences, **0 holders** — is the case that proves it, and it is the first thing phase 2
would hit on the pilot category.

---

## 4. Your §9-D and §9-E, answered

**The 13 frozen conflicts.** Your rulings are accepted as written, including `Compliance` needing a
value-aware rule rather than a label decision, and `Height`/`Width` both going to `dimensions` with
`height`/`width`/`depth` derived or retired. Rule 223 (`Frequency range` → `radio_bands`) is now
provably redundant and will be deleted. **Your correction that the 13-entry freeze makes the other
19 invisible by construction is right**, and `Acoustic noise and MTBF` at 261 occurrences being
outside the frozen list is the proof. The frozen list becomes "conflicts with a recorded ruling" and
the trace's own `contested_total` becomes the denominator.

**The 532 / 158.** Both cells are now measurable from the API rather than by argument, because
`kind` is on every part summary and `?kind=` filters it (§6). Your recount of 403 spec-bearing
fallback parts is the right method; the remaining ≤129 are fact-holders you could not reach, and
`/v1/parts?category=X&kind=Y&has=facts` reaches them now. Your two corrections to the accounting
are accepted: the 1,568 sit outside the population, and "holds a datasheet" does not mean "fillable
today" while the PDF tap is off.

On the device-noun ceiling: **you are right that a ceiling-with-a-note is the wrong carrier.** The
**measured figure is 256** over the union of both axes (158 in the unresolved half alone); the test's
**ceiling** was re-baselined 159 → 260, and *upward*, which is the honest direction. *(Corrected, round-6
item 11: the first copy gave 260 and 159 as though they were the figure — they are the old and new
ceilings, and 256 is the number.)* The union of both axes adds
95 `bundle` rows nobody has read one at a time. It stays a ceiling for one round because those 95
are unread, and your kind-aware proposal (exempt `mechanical`, `cable`, `power-cord`, `stack-cable`,
because a part named after its host is a *rule* and not a false positive to tolerate) is the right
next step and needs the `?kind=` listing that now exists. Your view on the nine extra nouns — `node`
and `codec` are whole boxes, `transponder`/`multiplexer` depend on a chassis PID prefix — is taken.

**B2 `layer`.** Confirmed as the only required-or-pending cup in the catalogue with
`observed_fill_path: false`. **Then measured, and the derivation does not survive the data — by
either route.** Both attempts were validated against the 1,054 seed `layer` facts, which are the
operator's own ground truth.

*From `series`* — the route you proposed, and the one that looks obviously right because `series` is
column-backed with 0 nulls in 42,450 rows:

```
switches kind=switch          4,931 parts, 1,054 hold a layer fact, 172 series
series with ONE seed value       88 series, 1,348 parts   derivable
series whose seeds DISAGREE       6 series,   356 parts   NOT derivable
series with NO seed value        78 series, 3,227 parts   a derivation would have to guess (65%)
```

And the six disagreements are not noise, which is what settles it: Catalyst 3850 seeds `l3` ×52 /
`l2` ×9, Catalyst 3650 `l3` ×73 / `l2` ×21, Catalyst 2960-X `l2` ×13 / `l3` ×10. Those lines ship in
LAN Base (L2) **and** IP Base / IP Services (L3). The discriminator is the feature set, and the
feature set is not the series.

*From the SKU's feature-set suffix* — which is where the split series point, and which this repo
already knows is a tier letter in switches specifically:

```
against the 1,054 seed values:  agrees 485 · DISAGREES 46 · says nothing 523 (50%)
precision where it speaks 0.913 · coverage over all 4,931 switch parts: 988 (20%)
```

The 46 disagreements are all one shape: `IE-4000-16T4G-E`, `IE-2000-8TC-G-E`, `IE-3100-3P1U2S-E`,
`WS-C2960-24PC-S`. **On the industrial and 2960 lines those letters are not a feature-set tier** —
which is the same trap as `-A`/`-E`/`-L`/`-S` being the *reach* on an optic and a *tier* on a switch,
one level finer: inside switches, the letters are a tier on the 3850/3650/9300 and something else on
the IE and 2960 lines. At 20% coverage it would answer for one switch in five even if it were exact.

**So `layer` cannot be derived, and deriving it from `ipv4_routes` is circular** — `ipv4_routes` is
gated on `layer`. What follows is a decision rather than a measurement, and it is yours: `layer`
becomes `opt`, and `ipv4_routes`/`ipv6_routes` lose the gate and become `opt` too. That removes three
requirements from 4,931 parts that nothing can close, and it is honest about a distinction the corpus
does not record. **Your condition for the recompute is therefore not satisfiable as written**, so the
recompute is held — see §5.

---

## 5. What needs the operator, and what I have deliberately not run

Nothing below is done. Each writes to the store and needs the operator's approval; they are listed
in the order I would run them.

1. **`ingest sync-dictionary`** — **RUN, #986.** 4 keys inserted (a fact could not reference them at
   all), 25 updated, 88 profile rows inserted, 357 updated, **104 stale profile rows removed** for
   superseded keys. Re-measured afterwards: **0 of 27 supersessions invisible, 0 type/domain/band
   differences, 0 keys missing from the table.** The only residue is the two orphans the sync keeps
   by design — `eol_announcement_date` and `end_of_support_date`, still declared by
   `interfaces-modules` and `wireless`, holding 0 facts between them. Deleting a dictionary row is
   the one thing `syncDictionary` deliberately never does, so those two need their own decision.
2. **`promote-required` + `recompute-completeness`** for `switches` — **promote-required RUN dry:
   0 promotions**, and neither `deploy_role` nor `uplink_modular` appears in the candidate list, so
   the stop condition does not trigger (it earns required status from a ≥60% coverage share over
   ≥30 parts, and those two hold 2 facts and 0). Three candidates clear the bar but are hand-declared
   and so cannot be won by the generated half: `hyperconverged-systems.emc_emissions` 91%,
   `humidity_storage` 86%, `meraki.power_load_idle_max` 61%. **The recompute is HELD** — your third
   gate condition is not satisfiable, see §4 B2.
   **But run 1 has made the recompute necessary on its own account**, independent of switches: the
   sync changed 445 profile rows and removed 104, so `completeness` is now stale catalogue-wide, and
   every `required_slots_stored` in the ledgers and every figure in `/v1/stats/gaps` is stale with
   it. That is a consequence of an approved run rather than a new request, and it needs a decision:
   recompute now with `layer` as it stands, or settle B2 first.
3. **The retired-row residue** — **RUN, #988: 4 moved, 6 retracted, 139 completeness rows deleted.**
   Your algorithm exactly: move before delete, and the four facts the earlier merge lost
   (`certifications`, `emc_emissions`, `humidity_operating`, `humidity_storage`, all `pdf_table`) are
   verified present **on `HX-GPU-7150X2` by name**, not by a counter — "moved: 4" proves the write
   ran, not that it landed. The 6 with no canonical row are the two IBM OEM parts and four CVD VLAN
   names, all retired `not_a_cisco_part`. The selector re-runs to **0 facts and 0 completeness rows**,
   so the repair cannot run twice.
   One note worth keeping: the first attempt threw inside the run (I built the fact entry from the
   `facts` column names instead of the nested `SpecEntry` shape). `withRun` closed #987 as `failed`
   and rolled back, and a re-read showed the state byte-for-byte unchanged — which is the argument
   for writing through the store's own helpers inside a run rather than hand-rolled SQL.
4. **The `bundle` separation** (§1, B1) — a reclassify for the software subscriptions, the promo
   SKUs and the `INVALID SKU` row, and the `ASR5K-*` category move. ~1,500 rows and four decisions.
5. **The retraction run** — now larger and better-evidenced: **would-refuse 261 → 352**, because
   closing two cups surfaced 91 wrong-quantity facts that were previously indistinguishable from
   answers (routers `radio_bands` 82→108 as LTE text stopped passing, servers `drive_interface`
   45→72 as lane counts and DWPD stopped passing, interfaces-modules 5→43). Free-string candidates
   75 → 71.

---

## 6. What I built for your §10, so the next pass has fewer "could not check" rows

| your ask | state |
| --- | --- |
| `kind` on the parts listing and `?kind=` | **done** — `kind` on every part summary (`/v1/parts`, `/search`, `/lifecycle`, `/compare`, `/families`, tools) and `?kind=` filters it. Requires `category`, because `partKind` is per category and that bound is what keeps pagination honest. An unknown kind is a 400 listing the category's kinds. `/v1/parts?vendor=cisco&category=servers-unified-computing&kind=bundle` |
| `document_evidence` in `/summary` | **done** — with both per-kind detectors. `/summary` is still ~20 KB, and `_about_summary` now states exactly what the form drops instead of claiming it drops nothing |
| the full `contested` list | not yet — say the word and it ships as `?contested=all`. Your measurement is the correct one: `contested_total` is **448–473**, not the 462–473 the brief said, and the `winner: null` entries run **14–22** per category, not 22 |
| `superseded_by` / `retired_into` reconciled in `/v1/fields` | needs §5.1 first; the drift is the cause, not the projection |
| `totals.parts` asserted against the live count | already asserted in `tests/cupLedger.test.ts`, and it is why the ledger was right. What was missing was the API side, now `tests/apiLiveParts.test.ts` |
| a `since=` census, `git_sha` on runs | not done |
| `/v1/sources` `enabled`/`facts_current` in the ledger's `sources[]` | not done, and it is the right fix for §3's "seen" problem |

---

## 7. Corrections to my own brief, since you asked for them in §9-I-1

Every one of these is yours and confirmed:

1. **Cisco is 87,083 parts, not 91,682.** 91,682 was all thirteen brands — and it is now 91,543,
   because it was also counting tombstones. I had already corrected the first half in the brief; the
   second half is your finding.
2. **Artifact sizes.** I quoted **disk** sizes as **response** sizes: the `switches` census is
   192,446 bytes on disk and **142,424** over the wire, because the API does not re-emit the
   indentation. The mappers are 148–150 KB, not ~192 KB. Your "the budget arithmetic is ~30% high"
   is exactly right.
3. **`/summary` "identical content"** — false, and it dropped the number the filling phase is bound
   by. Fixed.
4. **`/v1/index/cisco/<cat>` is a link index**, not "parts with product_class and derived kind". My
   §3.5 described the wrong endpoint; the thing I meant did not exist until §6 above.
5. **`contested_total` 448–473**, not 462–473. I sampled too few traces and reported the sample's
   minimum as the range's.
6. **The 762.** Yours was right for the surface you read: `class=unknown` really did return 762,
   because **2 of those rows are retired**. Mine was right for the live catalogue at 760. A third
   instance of §0. And on the facts: **11 rows carry a current fact and 0 carry an OWN fact**, so
   the brief's "0 have an own fact" was true and incomplete — the 11 are inherited.

---

## 8. What to audit next, and the one thing I would ask you to weigh

Build **`6c3bff2` or later**. `/health` `parts` should read **91,543**; if it reads 91,682 you have
a cached or un-deployed build and nothing else is worth checking.

The three things most worth your time:

1. **Re-derive the denominators.** `/v1/stats` cisco hardware is now **42,501** and the ledgers sum
   to 42,450 — the remaining 51 is the real finding from B3 and nothing else should differ. If
   anything does, that is the highest-value thing you can return.
2. **`?kind=` against the cells you could not check** — the 158/256 device-noun rows and the
   fact-holding fallback parts. Your kind-aware detector proposal is the decision I most want
   settled, because it is the difference between a hard zero and a ceiling.
3. **The two axes.** `totals.fallback` now carries `asked_nothing`, `unresolved_kind` and `either`.
   Check the arithmetic against `/v1/stats/gaps` `parts_nothing_required` the way you did before —
   your 3,071/3,092 cross-check found the conflation and it is the check I would keep.

**And the thing I would ask you to weigh, because it decides how the next round is spent.** Four of
your seven blockers are now fixed or measured, and the two largest remaining items — B1's 1,568 and
B6's missing server cups — are both blocked on decisions rather than on work. The dictionary drift
in §3 blocks more than either: while it stands, four cups we have closed enforce nothing, one new
cup cannot hold a value, and fourteen supersessions are invisible to anyone auditing through the
API. **If you agree it is the top of the list, say so plainly in your next report** — it is one
approved run, and it is the difference between the schema we have written and the schema the store
enforces.
