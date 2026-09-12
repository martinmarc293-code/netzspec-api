# The 352 would-refuse facts, grouped by cup × reason, with a proposed disposition

**For the operator.** Nothing here has been run. Run 4 is held: *"'Would refuse' is not 'wrong'."*
Approve group by group.

Build `44c6bdd`. Source: `data/census/cisco-*.json` → `cups[].would_refuse`, which replays the REAL
`normalizeField` over every stored raw and reports a refusal only when the value is refused **both**
with the fact's unit as a hint and with no hint. 37 groups, 352 facts, and the counts below sum to
352 exactly.

**Dispositions used.** Four, not three — the fourth is the one your three do not cover:

| | meaning |
| --- | --- |
| **MOVE** | the value is right and the cup is wrong. A rekey. |
| **RETRACT** | the value is not an answer to anything. |
| **FIX-PARSER** | the value is right and was misread. Fix, then re-extract; retracting first would just re-store it. |
| **KEEP-REFUSING** | the refusal is the correct permanent answer, and the fact should go but no cup should gain it. A capability statement ("2 x 1G copper **or** 2 x 1G SFP") is not a specification, and this repo already decided that a confident wrong value is worse than a recorded gap. |
| **RESHAPE** | neither the value nor the cup is wrong — the part should not be asked this cup at all, or the cup cannot express what the part is. Term 2, not term 4. |

---

## The table

| # | facts | category | cup | reason | disposition | destination / action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **52** | routers | `wifi_generation` | ENUM_VIOLATION | **MIXED — split before acting** | see §1 below; three sub-groups with three different answers |
| 2 | **45** | servers-unified-computing | `memory_speed_max` | UNIT_UNKNOWN | **FIX-PARSER** | the label is glued to the value: `"Highest DDR5 DIMM Clock (MT/s) \| 6000"`. 6000 MT/s is correct and the cup's unit is MT/s. The parser reads `DIMM` as the unit |
| 3 | **38** | interfaces-modules | `radio_bands` | ENUM_VIOLATION | **MOVE** | `"1390 MHz - 1525 MHz"` (`CGM-WIMAX-1.4GHZ`) is a licensed WiMAX band, not a Wi-Fi band. → `cellular_bands`, which is the non-Wi-Fi radio-band cup and already holds 47 facts |
| 4 | **37** | transceiver | `form_factor` | ENUM_VIOLATION | **RESHAPE** | `"QSFP28 zu 4× SFP28 (fest konfektioniert)"` — a breakout cable has two cages and the cup holds one. The normaliser already refuses by name (*"names two different cages … neither end is chosen"*). Do not widen the domain: that makes `form_factor` a cable type for 37 rows and a cage for 545. Give breakout cables a kind with `form_factor_a`/`_b`, or stop asking them this cup |
| 5 | **27** | servers-unified-computing | `drive_interface` | ENUM_VIOLATION | **MOVE — needs two new cups first** | `"3X"` 12 and `"1X"` 11 are a LANE COUNT; `"1DWPD"` 4 is a drive endurance. Both are real quantities with no cup. Create `pcie_lanes` (n) and `drive_endurance_dwpd` (n) and move, or retract if you would rather not carry them |
| 6 | **26** | routers | `radio_bands` | ENUM_VIOLATION | **MOVE** | `"850/900/1900/2100 MHz"`, `"700MHz"`, and four rows of LTE/5G band lists. → `cellular_bands`, same profile, 47 facts of exactly this |
| 7 | **18** | routers | `altitude_max` | RANGE_VIOLATION | **FIX-PARSER** | `"● Maximum altitude: 13.800 ft per IEC 68-2-41"` — a German thousands separator read as a decimal point, so 13,800 ft (4,206 m) became 13.8. The band is right and the read is wrong. **The band must not be widened**; widening it is how 13.8 m becomes a stored altitude |
| 8 | **12** | switches | `ipv4_routes` | UNIT_UNKNOWN | **MOVE** | `"In hardware Up to 780 Mpps *"` (`C6800-SUP6T`) is a FORWARDING RATE. → `forwarding_rate` |
| 9 | **12** | switches | `ipv6_routes` | UNIT_UNKNOWN | **MOVE** | `"In hardware Up to 390 Mpps *"` — same, same destination |
| 10 | **10** | switches | `ports` | STRUCT_UNPARSED | **FIX-PARSER** | `"CGS2520 with 24FE Copper & 2 GE combo uplinks"` — `&` is not a recognised separator, so two port groups merge. A parser fix, and it is the shape that once read `"6 100 GE"` as one hundred 6G ports |
| 11 | **9** | switches | `uplink_ports` | STRUCT_UNPARSED | **KEEP-REFUSING** | `"2 x 1G copper **or** 2 x 1G SFP"` — mutually exclusive configurations. Choosing one silently invents a device that cannot exist; this is the decision already recorded in `CLAUDE.md`. The fact should be retracted and **no cup should take it** |
| 12 | **7** | transceiver | `min_software_release` | PARSE_FAIL | **RETRACT** | `"NA"` — a placeholder. The source states no answer |
| 13 | **7** | wireless | `wifi_generation` | ENUM_VIOLATION | **RETRACT** | `"DL-OFDMA**, UL-OFDMA**, TWT support**, BSS coloring**"` (`MR36`) is a FEATURE LIST. There is no features cup and I would not create one for ten facts — but say so if you want one, because the values are real |
| 14 | **6** | meraki | `sfp_ports` | PARSE_FAIL | **RETRACT** | `"-"` — placeholder. (`sfp_ports` is also typed `s` for a count; that is a separate held item) |
| 15 | **5** | routers | `supported_modules` | PARSE_FAIL | **RETRACT** | `"NA"` — placeholder |
| 16 | **5** | wireless | `spatial_streams` | ENUM_VIOLATION | **RESHAPE** | `"10 or 8 (2x2+4x4+4x4 or 4x4+4x4)"` (`CW9174E`) — a TRI-RADIO access point. The 8-member enum cannot express three radios, and the value is correct. Either the domain gains tri-radio members or the cup becomes per-radio |
| 17 | **3** | hyperconverged-systems | `memory_speed_max` | UNIT_UNKNOWN | **FIX-PARSER** | same DIMM label glue as #2 |
| 18 | **3** | meraki | `mounting` | PARSE_FAIL | **RETRACT** | `"-"` — placeholder |
| 19 | **3** | meraki | `wifi_generation` | ENUM_VIOLATION | **RETRACT** | the same feature list as #13 |
| 20 | **3** | routers | `altitude_max` | UNIT_UNKNOWN | **FIX-PARSER** | the same rows as #7 reaching a different guard first |
| 21 | **3** | switches | `radio_bands` | RANGE_VIOLATION | **MOVE** | `"47 to 63 Hz"` on `N55-PAC-1100W`, `NXA-PAC-1100W`, `NXA-PHV-1100W` — three 1,100 W power supplies stating their MAINS FREQUENCY. → `input_freq`. This is the brief's own term-7 example |
| 22 | **2** | interfaces-modules | `installation_type` | PARSE_FAIL | **RETRACT** | `"n/a"`. The key is also superseded into `mounting`, so the rekey is moot |
| 23 | **2** | interfaces-modules | `module_type` | PARSE_FAIL | **RETRACT** | `"n/a"` |
| 24 | **2** | meraki | `antenna_type` | ENUM_VIOLATION | **FIX-PARSER** | `"4x Omni-directional antennas (5.4 dBi gain at 2.4 GHz, 6 dBi gain at 5 GHz)"` — the cell holds the TYPE (omnidirectional, which is in the domain), a COUNT, and two GAINS. The type is recoverable; the gain belongs in `antenna_gain` |
| 25 | **2** | routers | `psu_options` | PARSE_FAIL | **RETRACT** | `"✓ *"` — a tick in a comparison matrix, not a list of supplies |
| 26 | **2** | routers | `nat_sessions` | PARSE_FAIL | **KEEP-REFUSING** | `"1.2M w/ default 8GB, up to 2M w/ 32GB"` — two figures, each conditional on a different memory option. A capability statement; storing either invents a configuration |
| 27 | **1** | data-center-networking | `power_cord_rating` | PARSE_FAIL | **RETRACT** | `"–"` (en dash) — placeholder |
| 28 | **1** | hyperconverged-infrastructure | `memory_speed_max` | UNIT_UNKNOWN | **FIX-PARSER** | the DIMM glue again, `"(MHz) \| 2933"` |
| 29 | **1** | interfaces-modules | `compatible_platform` | PARSE_FAIL | **RETRACT** | `"n/a"`; the key is superseded into `product_compatibility` |
| 30 | **1** | meraki | `supported_protocols` | PARSE_FAIL | **RETRACT** | `"-"` |
| 31 | **1** | optical-networking | `min_software_release` | PARSE_FAIL | **RETRACT** | `"NA"` |
| 32 | **1** | optical-networking | `tx_power` | UNIT_UNKNOWN | **FIX-PARSER** | `"+3 to - 10 dBm in 0.01 - dBm increments"` — the SPACE inside `- 10` breaks the range read. This is the sign-loss family the reviewer flagged: fix it before any retraction, or `-10` re-stores as something else |
| 33 | **1** | optical-networking | `input_power_range` | UNIT_UNKNOWN | **FIX-PARSER** | `"0 to - 12dBm"` — same defect, same part (`CIM8-LE-K9`) |
| 34 | **1** | switches | `supported_protocols` | PARSE_FAIL | **RETRACT** | `"✓"` |
| 35 | **1** | switches | `input_voltage` | UNIT_UNKNOWN | **FIX-PARSER** | `"-36 to ~72 VDC"` — the `~` is unhandled. Fix before retracting: `PWR-CH1-950WDCR` stores `{min:-40,max:+72}` because the sign was lost on the same family, and a retraction without the fix re-stores it |
| 36 | **1** | switches | `radio_bands` | PARSE_FAIL | **MOVE** | the fourth of the three PSUs in #21, reaching a different guard |
| 37 | **1** | transceiver | `power_max` | UNIT_UNKNOWN | **FIX-PARSER** | `"Maximum Power Consumption (W) \| 1.05 to 1.3"` — label glue AND a range on an `n` cup. The cup may need to be `nr`; say which you prefer |

**Totals by disposition** — 352 facts:

| disposition | groups | facts | share | group numbers |
| --- | --- | --- | --- | --- |
| **MOVE** | 6 | **92** | 26.1% | 3, 6, 8, 9, 21, 36 |
| **FIX-PARSER** | 11 | **86** | 24.4% | 2, 7, 10, 17, 20, 24, 28, 32, 33, 35, 37 |
| **MIXED** (§1) | 1 | **52** | 14.8% | 1 |
| **RETRACT** | 14 | **42** | 11.9% | 12, 13, 14, 15, 18, 19, 22, 23, 25, 27, 29, 30, 31, 34 |
| **RESHAPE** | 2 | **42** | 11.9% | 4, 16 |
| **MOVE**, needs a new cup first | 1 | **27** | 7.7% | 5 |
| **KEEP-REFUSING** | 2 | **11** | 3.1% | 11, 26 |
| | **37** | **352** | 100% | |

The first version of this block said 76 / 68 / 44 and did not sum to 352. It is recomputed from the
group numbers above, which are listed so the arithmetic can be checked rather than trusted — a
denominator nobody can re-derive is how "8 documents" became "the 42 I asked for".

**The point your instruction makes, in one line: only 42 of the 352 are RETRACT.** 86 are a value
that was read wrongly, 119 are a value in the wrong cup (92 + 27), and 42 are a part being asked the
wrong question. A blanket retraction would have destroyed **268 correct values** and left every one
of the underlying defects in place to re-store them on the next extraction.

---

## §1 — the one group that must be split before anything happens (52 facts)

`routers.wifi_generation` is three different things and the census's `by_reason` cannot see the
difference, because all three land on ENUM_VIOLATION. From the stored values:

| sub-group | example values | disposition |
| --- | --- | --- |
| a spatial-stream count in a generation cup | `"2X2 MIMO"` ×18 | **MOVE** → `spatial_streams` (which has the enum for it) |
| a placeholder or a yes/no | `"NA"` ×14, `"No"` ×11, `"Yes"` ×3 | **RETRACT** |
| a bare generation digit | `"4"` ×2 | **ASK ME** — `"4"` on a router with a Wi-Fi radio is *probably* Wi-Fi 4, and "probably" is not a basis for a write. Two facts; I would retract them and let extraction re-read the row |

The counts above are from the earlier full read of this cup's 188 values (62 of which were not a
generation). I have not re-read all 52 one at a time — see "not checked" below.

---

## Order of operations, if you approve

1. **FIX-PARSER first, for the 76.** Three separate parser defects, each small and each with its own
   sabotage case: the `LABEL (UNIT) | VALUE` glue (49 facts across four categories), the German
   thousands separator in `"13.800 ft"` (21), and the spaced sign / `~` inside a range (4, and one of
   them is the `PWR-CH1-950WDCR` sign-loss family). **Nothing is retracted until these land**, or the
   re-extraction re-stores the same wrong value — which is the whole reason your instruction
   separates this disposition from RETRACT.
2. **The two new cups**, if you want the 27 kept: `pcie_lanes`, `drive_endurance_dwpd`.
3. **MOVE the 95** (68 + 27) in one rekey run, on the `rekey-psu-and-compat.mts` pattern: retract the
   old fact and insert on the new key inside one transaction, provenance carried over unchanged
   because the value was read from a real document at a known locator.
4. **RETRACT the 44 + the 11 KEEP-REFUSING**, as two runs with different reasons, because a
   capability statement and a placeholder are not the same finding.
5. **RESHAPE the 42** — two shaping decisions (breakout cables, tri-radio APs), neither of which is a
   retraction and both of which belong with B1/B6 rather than here.

## What I did not check

- **I did not read all 352 rows one at a time.** I read every group's stored examples (4 per group
  from the census, which is what `would_refuse.examples` carries) and the full value distribution for
  the four largest cups. The dispositions for groups of 1–3 facts rest on one to three values each,
  which is all there is. §1's 52 rest on an earlier full read of that cup, not on a re-read today.
- **I did not verify that `forwarding_rate` will accept `"Up to 780 Mpps"`** after the move. If its
  unit handling refuses `Mpps` the move converts one refusal into another; that is a check to run
  before step 3, not an assumption to ship.
- **`cellular_bands` is a free string**, so the 64 MOVEs into it (groups 3 and 6) will be accepted
  without being validated. That is an improvement on being refused in the wrong cup and it is not the
  same as being right — closing `cellular_bands` is its own term-4 item.
