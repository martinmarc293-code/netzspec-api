# NETZSPEC — round-8 response: the round-7 rulings and the bundle plan, executed

**From:** Claude Code · **To:** the reviewer and the operator · **12 September 2026**
**Build to audit: see §9 (commit and `/health`).**

Your round-7 rulings are below in your order: A (the nine conflicts), B (item 7), C (the bundle plan),
D (the 51-row addendum), E (still held), F (the instrument asks). Each item says **done**, **done
differently** (with the measurement behind the difference), or **held** (with the reason).

**Three results differ from your numbers, and each is a guard doing its job.** None of them is a silent
narrowing, so they come first:

1. **Group 7 (15 `ASR5K-*` rows → routers) is HELD.** Your condition was *"assert every one resolves to
   chassis or sp-core, none unknown/accessory"*. Measured before any write: **all 15 resolve to
   `enterprise`** (routerKind's default, 26 cups). The assertion fails, so the move did not run (§3.7).
2. **7 rows the plan placed in group 10 are real hardware, and the plan contradicted itself about them.**
   Its table filed them *programme label → non_product*, but its own text said *"they are inside group 1 by
   SKU prefix"*. Only one of those avoids writing false data, so they stay hardware: 5 configured B200 M4
   blades → `server`, 2 HyperFlex system PIDs → `bundle` (§3.10). As a result, 118 rows left hardware
   instead of 125.
3. **8 of the 9 pack quantities were stored, not 9.** `UCS-SP-SD-1P6T-2` is named "1.6TB 2.5in Enterprise
   Performance 12G SAS SSD(10Xendurance". The name is cut off before any pack text, so the only evidence
   is the SKU's `-2`. It is held, not guessed (§3.3).

So the totals move by exactly those rows: **Cisco hardware 42,383** (your 42,376 + the 7 held rows), and
ledger total == `/v1/stats` still holds as an equality (§8).

---

## A. The nine conflicts — done

| # | label | ruling | now reaches | how |
| --- | --- | --- | --- | --- |
| 1–2 | `Environmental: Operating/storage humidity`, `Operating/storage humidity` | neither cup | **`__backlog`** | one rule above `humidity_storage` that matches a combined operating/storage (or non-operating) row; plain "Operating humidity" / "Storage humidity" unchanged (controls) |
| 3 | `…Nominal Input Voltage (W)` / `(VA)` | W → power_max, never watts in VA | **`power_max`** / `input_va_max` | a `(w)`-anchored rule above #18 |
| 4 | `Nominal Input Current (Arms)` | → input_current; supersede nominal if empty | **`input_current`** | `input_current_nominal` held **0 facts in any state, any vendor** → superseded (sync #998 removed its 15 opt profile rows) |
| 5 | `Compliance (EMC)` | → certifications | **`certifications`** | `^compliance \((?:emc|safety|regulatory)\)$` above bare `Compliance`, which is unchanged. The probe found the siblings `(safety)` ×3 and `(regulatory)` ×3 on the same sheets, so they are included. |
| 6 | `Maximum Rated Output (W) 1` | → psu_rated_output; supersede empty ones | `psu_rated_output` | **`psu_output_power` (cisco 10) and `psu_output_rating` (cisco 26) are NOT empty → not superseded** |
| 7 | `Safety Approvals` | → certifications; supersede safety_standards if empty | `certifications` | **`safety_standards` holds cisco 34 + arista 4 → not superseded** |
| 8 | `Passband Wavelengths` ×15 | → filter_passband (nm) | **`filter_passband`** | exact-label rule. **Standing guard:** no label containing "wavelength" may reach a frequency-unit cup. Checked over 23,679 labels × 18 category scopes. It went red for the stated reason when I pointed the rule back at `passband`, then the file was restored byte-identical. |

The frozen conflict table went from **26 to 22**. Four are resolved outright: (W), nominal current, and
`Compliance (EMC)` counted twice. Five stay in the table with the winner your ruling chose, because the
losing rule still matches the label and still wants another cup, which is what the table counts. Alias
tests 291/291, mapper traces 39/39, all 17 traces rebuilt.

**Honest carry-over from round 6.** You *accepted* my round-6 rulings on the original 13 conflicts, but
six of them were never implemented: Width → dimensions, Power and cooling → psu_config, Data rate →
data_rate, Color scoping, Signal output power range scoping, and deleting rule 223. They are still in the
table with their old winners. I have not done them this round because nobody asked in round 7. They are
the next alias change.

## B. Item 7 — done

`hyperconverged-systems` `server` now requires `emc_emissions` and `humidity_storage`. It is the only UCS
category that does, and that is a **named exception** in `tests/cupLedger.test.ts`.

**One defect found on the way.** Making HX its own set left `server` two UCS categories against two
collaboration ones. The one-cup-set-per-kind check picked its "contract" by **file order**, so it crowned
conferencing (22 servers) and would have reported 1,334 UCS servers as rebels. My first fix, "most parts
wins", flipped six long-standing ties (switch, appliance, gateway, amplifier, pluggable, supervisor),
whose exceptions were written against the other side. **The tie now goes to the set that leaves the fewest
un-named rebels.** The exceptions table already says which side is the contract.

## C. The bundle plan — done, except group 7

**The mechanism, in one paragraph.** `src/core/bundleFamily.ts` holds the plan's family rules, ported
verbatim. It is shown **only** rows the SKU axis already called `bundle`, which is the whole of its
safety. Measured outside that cohort, the same name keywords catch 1,134–1,565 rows. Inside it, the port
reproduces the frozen approved reading **1,568 of 1,568 rows**. That reading is now committed as
`data/reference/cisco-bundle-rows-2026-09-12.json`, and a test compares every row. Sabotage: removing any
of four load-bearing rules turns its own rows red. The kind changes are confined to the cohort. A diff of
all 11,674 UCS hardware rows (HEAD vs this build) shows **1,144 changes, all from `bundle`, none
elsewhere**.

### 3.1 Group 1 → `server` — 827 + 5 HX
835 less the 8 `UCS-SPM-MDS-01E…08E` rows. Each of those names a C220/C240 **and** an MDS 9148S/9396S, so
they are `bundle` (group 4). Their 8 `data_rate` facts (`"16"`, the MDS FC speed) are **kept** as evidence
of the MDS in the contents, as you ruled.

### 3.2 Group 2 → 52 `chassis`, 44 `fabric-interconnect`
**The head noun decides, not the presence of a token.** My first rule said "any FI token means an
interconnect", and it filed `UCS-SP-MINI-2-5108` ("2nd Mini AC2 Chassis w. I/O Mod, **FI p.lic**") as an
FI. That row is a chassis that ships an FI port licence. Reading all 96 found it. `"6324 In-Chassis FI"`
is the mirror case and stays an FI. The **9 `ports` facts are retracted** (run #1002).

### 3.3 Group 3 → 95 `drive`, 15 `memory`; `pack_quantity` added
Fusion ioMemory, ioDrive and WarpDrive cards are `drive` (flash storage), and DIMMs are `memory`.
`pack_quantity` is new: type `n`, band [2, 100], optional. It was measured across all vendors first
(the key did not exist, 0 facts). **The cup means per unit, everywhere.** `storage_capacity` on
`UCS-SP-HD-4T-2` stays 4096, and `dram` on `UCS-EZ8-M16G-8` stays 16. Nothing is multiplied.
- **8 stored** (run #1002). Each raw is a verbatim span of the name, and each fact cites the same EoL
  bulletin as the capacity fact already on that part. The first two attempts (runs #1000 and #1001) failed
  the store's own rule, *a verified tier-2 fact must name its document*, and rolled back with nothing
  written. #1001 was a careless re-run of my own with a placeholder approval string; it failed the same
  way before any write.
- `"8Pk"` is refused by the count normaliser (a glued suffix it does not read), so that raw is the span
  `"8"` and the full token is in the locator. **The normaliser was not widened for one row.**
- **1 held:** `UCS-SP-SD-1P6T-2` (see the top of this report).

### 3.4 Group 4 (175 + the 8 MDS) and `bundle_contents` — done, with its fill path on the same commit
`bundle_contents` is type `ls`. It was measured across all vendors first (did not exist). It is **not**
`box_contents`: that key (cisco 9 facts) is a carton's packing list, while this one is a bill of
materials. It is required of `bundle` in the three UCS profiles and in wireless.

**The fill path, `src/core/bundleContents.ts`, parses the bundle's own name.** It is strict: every
**counted** token must be a device line or a recognised per-node build token (2x5675 CPUs, 8x16GB,
1xVIC). Otherwise the row is refused with a reason. Validated over your 277 rows, with an independent
reading of the **SKU** as the control:

| population | rows | parsed | SKU control on the parsed rows | refused (reason) |
| --- | ---: | ---: | --- | ---: |
| plan groups 4, 5, 6, 13 | **277** | **250** | **agree 175 · disagree 2 · SKU names nothing 73** | **27**: 20 "required, not included" (`+ Addnl 2xFI reqd`), 4 no contents, 1 range (`4 to 32 HX nodes`), 1 unrecognised item (`4x100VIEW`), 1 drive with no unit (`11x960 SATA`) |
| + the 8 UCS-SPM-MDS rows | 8 | 8 | agree 8 | 0 |
| + 2 HX system PIDs (§3.10) | 2 | 0 | — | 2 (no contents) |
| group 14 (101 "Cisco \<sku\>") | 101 | 0 | — | 101 by rule |

**The 2 disagreements are the vendor's own data, not the parser.** `UCS-SP-ES-B22HD=` is named
"…2xB200M3…", and `UCS-SP7-C240-V` is named "…4xC220…". In both, the name and the SKU name different
servers.

**Four defects the validation found, each fixed and pinned by a test:**
1. `BNDL2FIx1xChassis` dropped both FIs from nine bundles.
2. `C3260 Base Chassis` was counted as two devices.
3. `Disk Expansion Pack for C240M4` was read as *containing* a C240.
4. **The first control run read 55 of the 101 "Cisco \<sku\>" placeholders as a server each.** That is the
   SKU read a second time, which is the trap `nameMarker.ts` already records. Group 14 was approved as
   "asked, no name rule", and this is now that rule.

My own control also had a bug: two regexes lost their backslashes and matched nothing, so every row read
as *disagree*. I fixed the control before believing it.

The derivation is registered in the ledger builder's `DERIVED_FILL_PATHS` with those counts. It appears in
every ledger as `derived_by` / `derivation_validated`, and in `/summary` as `derived_fill_path` (§F).

### 3.5 Groups 5, 6, 13 — stay `bundle`, now asked `bundle_contents`
Group 6 is `bundle`, not `drive`.

### 3.6 Groups 9–12 and the pallets — class changes, by explicit list (run #999)
**118 rows**: 31 software, 71 programme labels (78 less the 7 held), 7 `not-sellable:self-declared`,
7 `expired-promotion`, 2 `packaging-not-a-product`. The selector is an **exact (category, SKU) list read
from the frozen reference**, never a kind name. Your group-9 trap is asserted: 19 of the 31 were kind
`bundle`. Group 10 is the residue of the family rules, so a name rule there would file every future
unread bundle as not-a-product. The **7 `standard` facts retract with their rows** (#1002). The reasons
are registered in `RULE_NAMES`, each with a real witness row.

**A trap caught before commit.** An unscoped `reclassify --commit` for Cisco would have written **707**
class changes. 582 of them came from rules registered on earlier days that were never re-run
(name-ordering-artefact 281, name-marker-not-a-part 111, datasheet-cell 62, name-regulatory-label 46,
ucs-datasheet-cell 44, stray-device 38). **`reclassify --only-rule` now scopes a commit.** The 582 are
counted in the run as HELD and were not written. They need their own decision.

### 3.7 Group 7 — HELD (the guard failed)
All 15 are `enterprise` under `routerKind`. The 13 "ASR5000 Bundle, incl 2xSMC/3xPSC…" and lab bundles
are whole packet-core systems, so `sp-core` is defensible for them. The two "Partner Lab Bundle, 3x
PPC / 3x PSC2" rows are **card packs** and would be neither. **Proposal for your call:** a `^ASR5K-`
system rule → `sp-core` for the 13, and hold the 2 card packs. Separately, there are **84 more `ASR5K-*`
hardware rows in wireless** (XGLC/QGLC line cards and PSC cards) outside this plan. They also resolve
to `enterprise` in routers.

### 3.8 Group 8 — done
4 memory, 3 drives, 2 mechanical (`SM-DSK-COVER`, `UCS-EZ-INFRA-RACK`), 2 pallets → non_product. The
spare pairs agree because they share a name. Nothing is merged, and `SM-HDDB-SATA500GB` stays separate.

### 3.9 FIX-PARSER notes
`"4x SFP cable 3m"` read as 4 chassis ports, and `802.11a/g/n` truncated to `802.11a`. Both stored values
are retracted. **The parsers are not yet fixed.** Both belong with the FIX-PARSER group in the 352
dispositions.

### 3.10 The seven rows the plan contradicted itself about
`UCS-SP-B200M4-BC1T/BC2T/BF1T/BF2T/BF3T` are named "(Not sold standalone) Hi-Core1w/2xE52683v4, 8x32GB,
VIC1340". They are configured B200 M4 blades whose names lost the model, and their non-T siblings are
group-1 servers. `HXAF2X0C-M5S` and `-BR` are named "Cisco Hyperconverged System": the HyperFlex system
umbrella PID a cluster is ordered under. They are held by the explicit list `NAME_OMITS_MODEL` →
`server` / `bundle`, and excluded from the class change. **If you want the plan's table honoured instead,
it is one line and one reclassify.**

## D. The addendum — done (8 runs, #1003–#1010), all 51 moved

- **D (N540 access systems).** The rule is **scoped to N540** (`sp-n540-system`), not to bare `-SYS`.
  Measured: routers holds 29 live `-SYS` rows, and 7 of them are line-card chassis (8608/8804/8808/8812/
  8818-SYS, ASR-9006/9010-SYS) that a bare rule would turn into `sp-core`. Test as you specified: **0 of
  5,439 routers rows changed kind** (HEAD vs build, whole category), and both movers resolve to `sp-core`.
  The plan also said the axis calls them transceivers; the precise cause is that `routerKind` said
  `accessory` (the `ACC` segment), and the name marker then read the cage tokens.
- **K / L.** `^DN3-HW-APL-` → `server`, `^(?:DN3|APIC)-[PO]-` → `nic`. `APIC-SD100G0KA2-E` (the drive) stays
  a drive, and the UCS diff shows 0 changes outside the bundle cohort.
- A, B, C, E, F, G, H, I, J as written. Every destination kind asks ≥ 2 cups, and the four software
  categories now hold **0 hardware rows** (§8).

## E. Still held
- **The 352 dispositions:** the table is `docs/reports/cisco-refusal-dispositions-2026-09-12.md`, re-sent
  with this report. Approve group by group.
- **The wavelength / receiver-window merge:** Juniper lane (240 + 261 facts are theirs).
- **New from this round:** the 582 held reclassify changes (§3.6), group 7 (§3.7), and the six round-6
  alias rulings (§A).

## F. The instrument asks

| ask | status |
| --- | --- |
| `kind` on part detail | **done**: `/v1/parts/{vendor}/{sku}` carries `kind`, from the same `partKind(category, sku, name)` call the list and the ledger use |
| `facts_current_by_vendor` on `/v1/fields` items | **done**: current facts on live parts per vendor slug, `{}` = none anywhere; cached 5 min |
| `derived_fill_path` in label_evidence | **done**: `{by, validated}` on every cup whose tap is a derivation (`bundle_contents`, `layer`, the breakout ends) |
| retype / domain guard | **done**: `syncDictionaryOn` re-reads every current fact (all vendors, live parts) of a key whose type, unit, domain or band changed, and **refuses** if any would now be refused, naming vendors. A deliberate reshape passes only with `--allow-refusing <key>` and is recorded in the run. **Sabotage:** narrowing `weight`'s band refused with *"cisco 466, hpe 66, aruba 17 of 549"*, inside a rolled-back transaction. **Limitation:** it counts values that ALREADY refuse under the old definition too (the same run showed `"7.27"` UNIT_MISSING), so its number is an upper bound, not a delta. |
| 53 vs 51 breakouts | 53 = **51 hardware + 2 `non_product`** length-generic SKUs (`QSFP-4SFP10G-CUxM`, `QDD-2Q200-CUxM`). The inconsistency: the equally generic `QSFP-4X10G-AOCxM` / `ACxM` are classed hardware. One class rule would settle it; not changed without your call. |
| all 17 ledgers on one commit | **done** (§9) |
| retired completeness rows == 0 after any recompute | **done**: `recompute-completeness` now fails its own run if any retired part holds a completeness row. It checks the whole table, not just the run's scope. It read 0 on every recompute this round, and a source test pins both halves (sabotaged: removing the filter turns it red). |

## 8. The numbers — every assertion you set, measured after the run

| assertion | yours | measured | |
| --- | ---: | ---: | --- |
| ledger total == /v1/stats Cisco hardware | 42,376 | **42,383 == 42,383** | +7 = the held rows (§3.10); equality holds per category too (0 mismatches over 17) |
| asked nothing | 1,503 | **1,503** | fallback kinds only: servers.unknown 590, video.unknown 423, wireless.other 192, hci-systems.unknown 82, collab.unknown 73, hci-infra.unknown 62, optical.other 43, uc.unknown 19, transceiver.accessory 14, storage.other 4, conferencing.unknown 1 |
| no bundle kind asked zero cups | 0 | **0** | servers bundle 314, hci-systems 16, wireless 73 (58 kits + the 15 held ASR5K), all asked `bundle_contents` |
| required cups without a fill path | 0 | **0** | |
| hardware rows in the four software categories | 0 | **0** | |
| completeness rows for retired parts | 0 | **0** | asserted by all 12 recomputes (#1011–#1022) |

Ratchets re-based in `tests/cupLedger.test.ts`, each with its reason: asked-nothing ceiling 3,100 → 1,550;
hyperconverged-systems fallback share 16.3% → 16.5% (22 rows left hardware, its 82 `unknown` did not move);
and the independence check, which REQUIRED a named kind asked nothing — the defect itself made load-bearing —
now asserts your acceptance condition instead. Fallback census 2,929 of 42,383 (6.91%, target < 5%); device-noun
over the union 158 (was 256).

**Runs, in order:** #998 sync-dictionary · #999 reclassify (118, scoped) · #1000/#1001 failed, rolled back,
nothing written · #1002 facts (17 retracted, 8 inserted) · #1003–#1010 the 51 moves · #1011–#1022 recompute.

**The coverage dashboard** (`127.0.0.1:8787/coverage`) was also measuring the wrong thing: columns asked =
all parts × the largest required count in the category, licences included — conferencing read 0 / 41,239 for 69
hardware parts. It now sums the stored per-part cups over live hardware (Cisco **36,193 / 435,496 = 8.3%** filled)
and shows cups per kind from these ledgers, cross-checked exactly against the store.

## 9. Build

(filled in below)
