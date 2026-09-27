# 2,838 out-of-domain values are three different problems

**27 Sep 2026.** `enum_values_in_domain` is red on 2,838 facts holding a value their domain does not
admit. Read rather than counted, they split into three populations that need **opposite** work, and
a single repair applied to all of them would be wrong for two thirds.

## A — a real value in the wrong spelling → **alias, no data write**

The value is correct; the normaliser has never been told the spelling.

| key | values |
|---|---|
| `wifi_generation` | `Wi-Fi 6` 57, `WiFI6` 35, `WiFi6` 11, `Wi-Fi 6E` 13, `Wi-Fi 7` 8 |
| `drive_interface` | `SAS` 73, `SATA` 43, `NVMe` 23, `U.3` 9, `U.3 NVMe` 8 |
| `radio_bands` | `2.4 GHz` 54, `5 GHz` 23, `2.4GHz` 10, `Dual-band` 15, `Dual Band` 10 |
| `standard` | `SR` 43, `LR` 30, `BX` 49 — real optical reach codes |

Three spellings of Wi-Fi 6 across 103 facts is one value, and an alias rule fixes every future
extraction without touching a stored row.

## B — a real value the domain OMITS → **widen the domain, with evidence**

| key | values | why |
|---|---|---|
| `antenna_connector` | `RP-TNC` 85, `N-type` 14 | both are standard RF connector types; the domain simply does not list them |

This is the whole out-of-domain population for that key — 99 of 99. A domain that refuses every
value its corpus holds is a domain that was never measured against the corpus, and the fix is the
domain, not the facts.

## C — a WRONG POUR → **retract, not normalise**

The value is not a bad spelling of anything; it belongs to a different question.

| key | values | what they actually are |
|---|---|---|
| `mounting` | `"Mounts in an EIA-standard 19 in. Telco rack or equipment cabinet. Horizontal surface mounting only. 2-post rack kit included."` 24, and 12 more sentences | the whole mounting *paragraph* poured into an enum cup |
| `radio_bands` | `50Hz/60Hz` 23 | **mains frequency** — a power-supply figure in a radio cup |
| `drive_interface` | `3X` 12, `1X` 11 | **lane counts**, the defect this repo already recorded for this key |
| `drive_interface` | `10/100` 9 | an Ethernet speed |
| `wifi_generation` | `2X2 MIMO` 18, `Yes, 8 Stream MU-MIMO` 1, `NA` 14 | an antenna configuration, and a literal "NA" |
| `standard` | `DAC Kabel` 319, `AOC Kabel` 256, `fest konfektioniert (im Kabel enthalten)` 90 | **German prose** — a rendering leaked into the fact |

`standard` is the largest key at 1,775 facts and the majority of it is population C: German cable
descriptions stored as though they were a standard. Aliasing those would enshrine prose as a legal
value of a closed domain.

## The order this implies

1. **Aliases first** (population A). No data write, no decision, and it stops the inflow — every one
   of these recurs on the next extraction otherwise.
2. **The `antenna_connector` domain** (B), measured across all vendors before the change, because
   the dictionary is shared and a domain edit reaches every lane.
3. **Retraction plans per key** (C), each a dry run with the rows printed. `standard` needs its own,
   because 665 of its facts are German prose and that is a rendering defect upstream — retracting
   them without fixing the producer means they return.

## What is NOT claimed

The counts are per (key, category, value) rows, not per part. And the A/B/C assignment is mine, read
off the values; each line above is checkable by looking at the value, which is why they are quoted in
full rather than summarised. A value I have misassigned would move between "alias" and "retract",
which is precisely the pair with opposite costs — so this list wants a second reader before any of
it executes.
