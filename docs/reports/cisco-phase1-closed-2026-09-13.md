# Cisco phase 1 ("arranging cups") — closed, 13 Sep 2026

Closing report required by `docs/reports/phase1-close-guide-2026-09-13.md` §5.7 and §8.

**Where everything lives:**

| what | where |
|---|---|
| progress surface | `/v1/completeness/cisco`, served from `data/completeness/cisco.json` |
| definitions | `docs/completeness-model.md` |
| freeze file | `data/freeze/cisco.json` |
| freeze hash | **`31894723abf98ce5a327ce330c377ab2ac463c9353c3848eab36b915efdbf9dc`** |

**Commits:**

- `dfa4852` carries the ledgers, censuses, traces and freeze. All were built from `ea74e31`.
- `adcae72` makes the completeness builder name the freeze.
- The commit that carries this file also carries the report built from `adcae72`.
- The only code difference between `ea74e31` and `adcae72` is that builder.

## 1. The §1 table, final

| # | Condition | Final measurement | State |
|---|---|---|---|
| 1 | Every hardware part is counted once, in one category and one kind, and is asked a finite named cup set | Ledgers sum to **42,367**, the same as the report's `hardware_parts` and live at build. `asked_nothing` is **1,427**, all of it fallback kinds (27 listed under `unresolved_kind.kinds`). The 16 fewer parts than 42,383 are the device-noun class changes (#1023). | **Met** |
| 2 | Every required or pending cup has an observed fill path | **0** required/pending cups have `observed_fill_path: false` across 17 ledgers. The 5 derivations are registered in `src/core/derivedFillPaths.ts` with validation counts. | **Met** |
| 3 | Every cup has a type, a unit and a domain or band | 604 keys. The 18 free-string required cups are decided in `docs/decisions/2026-09-13-free-string-cups.md`: closed lists, enums, structs and numbers, plus `cpu`, `image_sensor` and `display` as free text by decision. `tests/freeStringCups.test.ts` (166) fails on any new one. | **Met** |
| 4 | No required cup is asked twice under two names | The Cisco side has none. The cross-vendor merges are parked (§3). | **Met for Cisco** |
| 5 | A wrong or empty answer cannot sit in a cup and count as filled | The write-time placeholder guard is in (NORM 1.7.0, with a sabotage test). `placeholders_stored` is 0. `would_refuse` is 115 on held parts and 20 not held. **0 of the 3,541 facts written after the guard commit would be refused**; the control over all stock finds 405. | **Met** |
| 6 | "Empty" splits into no document, not read and not published | Spec-bearing **9,865**, EoL-only **27,104**, no document **5,398** (sums to 42,367). `gap_states` are defined in every ledger. | **Met** |
| 7 | One report shows 1–6 by brand, category, kind and cup | `data/completeness/cisco.json` passes 15 of 15 cross-checks at build; `tests/completeness.test.ts` has 349 checks with sabotage. | **Met** |
| 8 | The arrangement is frozen | `data/freeze/cisco.json` and `cisco-kinds.tsv`; `tests/arrangementFreeze.test.ts` (16). The report names the freeze hash, and the test fails if they differ. | **Met** |

## 2. §8 acceptance run

The run: 62/62 suites and `npm run typecheck` clean, on the commit carrying this file.

| assertion | expected | measured |
|---|---|---|
| sum(ledger parts) == report `hardware_parts` == live | equal | 42,367 == 42,367 == 42,367 (`live_at_build`); the served endpoints are in §5 |
| `asked_nothing` == live `parts_nothing_required`, and every asked-nothing kind is unresolved | equal | 1,427; cross-check `asked_nothing_matches` passed |
| required/pending cups with `observed_fill_path: false` | 0 | 0 |
| pending cups whose gate is not required/pending/column-backed of the same kind (`gateR1`) | 0 | 0 of 80 pending cups, measured over the 17 committed ledgers. 11 are gated on the column-backed `series` (security `appliance`); the control that ignores column-backed finds those 11. No standing test names this check yet. |
| `device_noun` over the union of both axes, exemptions printed | 0 | 0; `DEVICE_NOUN_RESIDUE` is empty; exempt kinds are `mechanical`, `cable`, `power-cord`, `stack-cable` |
| required `s` cups without a domain or a free-text decision | 0 | 0 (`tests/freeStringCups.test.ts`) |
| placeholders storable at write time | 0 | 0 (`tests/specNormalize.phase1`, sabotage) |
| `would_refuse` on facts newer than the guard commit (`6651cef`, 00:26:22Z) | 0 | **0 of 3,541**; the control with no date limit finds 405 |
| ledgers, censuses, traces, completeness report and freeze test on one commit, hash printed | yes | Artifacts built from `ea74e31` and committed in `dfa4852`. The report was rebuilt from `adcae72` only to name the hash; its numbers are identical. |
| completeness cross-checks | all pass | 15 / 15 |
| frozen-conflict entries without a recorded ruling | 0 | 0 of 15 (`tests/mapperTrace.test.ts`) |
| residue list in this report and in the completeness report | yes | §3 below and `residue` in the report |

## 3. Residue (§6)

Parked, not run, each with its trigger. Counts are from the completeness report's `residue` block unless stated.

| item | count | trigger |
|---|---|---|
| would-refuse dispositions (MOVE / RETRACT / KEEP-REFUSING / RESHAPE) | 401 (Σ census `would_refuse_total`, every live part and key; the guide quoted 352) | day one of filling, pilot first, group by group |
| held class changes (six old reclassify rules) | 582 (plan outside the store; the report cannot measure it) | a per-rule plan with three witnesses, approved rule by rule |
| ASR5K population in `wireless` | 84 by `ASR5K-` prefix; **115** counting `ASR55-`/`MIXS-` (kind-layer III.0 item 4) | an ASR5K kind rule plus a move plan under the guards |
| cross-vendor merges `rx_max_input_power` / `tx_wavelength` / `tx_max_output_power` | juniper 240 / 261 / 231; cisco 1 / 17 / 0 | the Juniper lane decides; Cisco moves its facts in the same run |
| term-6 duplicates holding facts | 146 facts | a move-then-supersede plan per pair, all vendors |
| unresolved kinds | 2,786 parts (6.6%) | family reads; III.0 item 4 already names 145 datasheet-cell rows and 46 NVMe drives in `servers.unknown` |
| tri-radio APs | 5 refused values | count the tri-radio population first |
| `UCS-SP-SD-1P6T-2` pack quantity | 1 | a description arrives |
| length-generic SKUs | 7 | with the class-change plan |
| `conferencing` and `data-center-networking` as categories | 91 hardware | operator decision; III.0 item 6 says to decide which product classes move first (conferencing holds 3,680 licences) |
| `cisco-datasheet-pdf` disabled; hexcat seed; inherited share | — | phase 2 day one: decide the PDF tap on the pilot |
| `filter_passband` pending moves | — | close with a §5.4-style batch if cheap |
| retyped keys' other-vendor values | `standard` refuses 1,055 other-vendor values, mostly tier-0 hexcat seed; plus 555 Cisco tier-0 `standard` | the owning lanes (the renormalize `--vendor` scope kept Cisco off their rows); tier-0 is the operator's call |
| facts under old orphaned runs, hidden from part pages | #842 (128), #843 (1,354), both `apply-specs` still `running` since 8 Sep; #406 (160, failed 6 Sep) | operator: roll back and re-apply, or close them. Counted as `filled_not_rendered` (1,493) |
| `could_not_replay` stock | 6,163 | not a defect; the unit is not in the row. Arrivals must be 0 (halting rule) |

## 4. Where the code disagrees with the guide

Nine recorded disagreements, unresolved and named, in `docs/completeness-model.md` §6 (D1–D9):

1. `required_total` definition;
2. two spec-bearing lists;
3. three meanings of "filled";
4. not-parsed;
5. not-published;
6. census scope against report scope;
7. product classes;
8. the inherited share basis (43% of stock against 29.8% of filled);
9. derived fill paths are not fills.

## 5. The brand block (`/v1/completeness/cisco`, `brand`, verbatim from the committed report)

```json
{
  "hardware_parts": 42367,
  "arranged": {
    "asked": 40940,
    "asked_nothing_fallback": 1427,
    "num": 40940,
    "den": 42367,
    "pct": 96.6
  },
  "held": {
    "spec_bearing": 9865,
    "eol_only": 27104,
    "no_document": 5398,
    "num": 9865,
    "den": 42367,
    "pct": 23.3
  },
  "filled": {
    "required_slots_held": 119408,
    "filled": 26784,
    "not_published": 0,
    "not_parsed": 92509,
    "would_refuse": 115,
    "filled_not_rendered": 1493,
    "not_held_parts": 32502,
    "not_held_slots": 316867,
    "not_held_filled": 10771,
    "num": 26784,
    "den": 119408,
    "pct": 22.4
  },
  "defects": {
    "would_refuse": 115,
    "would_refuse_not_held": 20,
    "could_not_replay": 6163,
    "placeholders_stored": 0
  },
  "inherited_share": {
    "inherited": 7970,
    "filled": 26784,
    "num": 7970,
    "den": 26784,
    "pct": 29.8
  },
  "weakest_category": "conferencing",
  "unresolved_kind": {
    "parts": 2786,
    "kinds": [
      "conferencing.accessory",
      "conferencing.unknown",
      "interfaces-modules.accessory",
      "routers.accessory",
      "optical-networking.accessory",
      "optical-networking.other",
      "video.unknown",
      "video.accessory",
      "security.accessory",
      "unified-communications.unknown",
      "unified-communications.accessory",
      "wireless.other",
      "wireless.accessory",
      "storage-networking.accessory",
      "storage-networking.other",
      "transceiver.accessory",
      "collaboration-endpoints.accessory",
      "collaboration-endpoints.unknown",
      "hyperconverged-systems.accessory",
      "hyperconverged-systems.unknown",
      "switches.accessory",
      "servers-unified-computing.unknown",
      "servers-unified-computing.accessory",
      "hyperconverged-infrastructure.accessory",
      "hyperconverged-infrastructure.unknown",
      "meraki.unknown",
      "meraki.accessory"
    ],
    "device_noun_union": 0,
    "device_noun_unresolved": 0
  }
}
```

## 6. What went wrong closing it, so it is not paid for twice

- **A run killed by a tunnel drop leaves its facts current under a non-succeeded run, and part pages hide them.**
  - `withRun` rolls back on a throw, but a process that dies with its connection never reaches the rollback.
  - I closed six such runs as `failed` with their written counts. That hid 1,387 values from part pages (`factRunSucceeded`), while their predecessors stayed superseded. The re-run could not re-select them either, because they already carried the new stamp.
  - Fixed by `rollbackRun` on every one before the re-run. The recovery script now does this after any non-zero exit.
  - **Closing an orphaned write run is a rollback, not a status change.**
- **Run database-heavy passes on the box.**
  - The same `renormalize` took 7 s for 2,595 rows on the box. From the laptop it managed about 30 rows a minute and died five times.
  - `recompute-completeness --vendor cisco` took 39 s. Seventeen ledgers, censuses and traces took 4 min.
  - The box ran a `git archive` of a named commit, so every artifact carries a real commit. The two git questions the builders ask were answered by a shim that prints the archive's SHA.
- **A builder written in parallel with the thing it reports hardcoded "does not exist yet".** A test now ties the report's hash to the freeze file, and it went red on the committed report before the fix.
- **Two deploys were running at once**, a foreground one and a `nohup` duplicate. Both were stopped in the upload phase, before anything touched the live tree.
