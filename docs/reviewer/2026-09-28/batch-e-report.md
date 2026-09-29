# Batch E report — 29 Sep 2026 (rulings Q13–Q17 on batch-d-report.md)

**Board 30 / 3 / 0 / 0 of 33 (baffbd0 deployed), self-test 24 / 0 / 9.** Red: four_sets_sum (the 105 read triples, below),
export_profiles_roundtrip (Q12, next), vendor_coverage (ruled). Log: `docs/reviewer/2026-09-28/verifier.txt`.

## Done

| ruling | runs / commits | result |
| --- | --- | --- |
| Q13 | run 1400 | 826 normaliser-split conflicts resolved `superseded-reading #<current fact id>` |
| Q14 | run 1401 | 53 Atlas conflicts resolved no-held-value |
| Q15 | runs 1402 (+1403 retract-inherited), 1405, 1412 | N9K-AC04-A/B non_product; 4X100G-LR-S retired into QDD-4X100G-LR-S; the 4 silent-document SKUs in the no-evidence term |
| Q16 | run 1404 | HX-16-* (12) licence |
| Q17 R1 | runs 1406–1408 | platform-slot-count 316 retracted / 4 held; cord input_voltage 81; cord power_max 1 |
| Q17 R3 | run 1409 (+1416) | 134 power_max → psu_rated_output, 19 antenna_connector → connector |
| Q17 R2 | code (ucsKind / sanKind / wirelessKind) | 197 kind moves, written by the rebuilds' write-layers runs |
| Q17 R4 | 0921763, `docs/decisions/2026-09-29-q17-r4-declared-optional.md` | 125 all-datasheet triples, every value distribution read: **116 widened** (KIND_DECLARED_OPTIONAL, witness each, no denominator moves), **9 refused on their values** and held na by a guard |

**Flipped green:** unknown_zero, conflicts_classified. Two reds appeared inside the batch and were closed in it (below).

## Found by the board or the build, and fixed (mine)

1. **The first rebuild stopped at recompute:** a completeness row on a RETIRED part — run 1405 retired 4X100G-LR-S and
   `retirePart` never dropped its score (only hygiene's merge path did; three callers left one each). e3bbd1d: `retirePart`
   drops it in the retirement's own transaction (hygiene.test **125/0** — the commit message says 126, it is 125; sabotage
   turns exactly the new case red); run 1412 dropped the stale score (computed 12 Sep, before the retirement).
2. **runs_have_approval went red on run 1409:** `rekey-psu-and-compat` is class `gate` and never computed one. Re-gated
   under the 28 Sep retro-gate ruling (run 1416: value half 153 of 153, PASS; `retro-gate --ruling` names the approval);
   the script now computes its gate BEFORE writing and refuses a failing one (`src/pipeline/rekeyGate.ts`, test 10/0,
   4 sabotage; a redundant clause proven dead and removed).
3. **dictionary_in_sync went red:** the Q17 R2 profile rows (3). Sync run 1415.
4. **unknown_zero kept AIR-N-3006-DTA-K9 EVIDENCED after Q15:** its NAME is its silent document's cell (`^NECJ AS3504
   DTA`). `SILENT_NAMES` matches that exact name (a real name later makes it evidenced again). The rebuild's min() had
   lowered the ruled ceiling 234 → 233 because the member never arrived; the raise is re-recorded, append-only.
5. layersStanding's exact optical label count 12 → 11: 4X100G-LR-S was one of them (reason recorded beside the number).

## Next: the read triples (Batch F), then Q12

`scripts/veto-triage.mts` (read-only) lists the veto part-cup by part-cup. **105 triples / 869 part-cups remain, all read:**
`data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv` gives each its remedy and why.

| remedy | triples | part-cups | how |
| --- | ---: | ---: | --- |
| widen (declared optional, witness) | 61 | 689 | e.g. wireless ap mounting 101, video transmitter connector 70, interface ports 46, switch airflow 45 |
| retract (exact rows) | 30 (+1) | 126 rows | `data/reference/q17-read-pours-cisco-2026-09-29.tsv`, full values; `scripts/retract-read-pours.mts` retracts only a row whose stored value is still exactly the listed one |
| rekey | 4 | 18 | wireless cpu power_max → tdp, wireless ap tdp → power_max (Meraki "power consumption"), routers drive flash → storage_capacity, switches flash dram → flash |
| reclassify (axis rules, replayed) | 10 | 28 | UCS-PCI25 / HX-PCI25 NVMe "NICs" → drive; C3X60 SSD / SAS controllers "chassis" → drive / storage-controller; C880 FC / SAS cards "servers" → nic / storage-controller; ST-M6-D100GF "drive" → nic; 15454-ML1000-2 "pluggable" → linecard; NCS2K-MF-1RU= "mux" → chassis |

Two of the retract triples are partial and then widen (switches power humidity: 6 `{95,95}` out, 3 `{5,95}` stay;
meraki camera ieee_standards: 2 `["No"]` out, 6 Wi-Fi lists stay), so they leave `Q17_R4_REFUSED`. Two calls a reviewer
may want to overrule: **"TAA compliant" kept as a certification** (3 triples, 13 part-cups), and **video passive
data_rate retracted** because "Mux/Demux 100G" is the 100 GHz channel grid, not a data rate (14).

**Q12 (read, not built):** the recorded files — Main `;` 19 columns (18 without "Überverkauf Plattform Hexwaren"),
Attributes / Condition / FAQ `,`, all UTF-8 BOM + CRLF; Switch 20 attributes, Transceivers & SFP Modul 14. Measured
before any code: the Artikelgewicht source (`weight`) is held by 6% of switches and 0% of transceivers, so shop_ready
will start near zero and the fill lanes decide how fast it grows.
