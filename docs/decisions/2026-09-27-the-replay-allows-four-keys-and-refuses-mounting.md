# Four keys replayed with a reason; `mounting` refused, because its out-of-domain rows are empty

**27 Sep 2026.** The reviewer's condition for lifting `renormalize`'s 25% change-share ceiling:
*"allow only the ones whose samples you've read and quoted in the run's approval field; a key you
haven't sampled stays refused."*

So this is the reading, and it is a reading of the **whole population** rather than of a sample.
`--examples` shows forty rows; forty rows sorted by id is one antenna family and would have
confirmed anything. What licenses the word *every* below is a query over all distinct `(raw, value)`
pairs with their counts — a query may summarise where a person may not, which is this repo's most
repeated correction of the day.

## The four allowed, with what was read

### `antenna_connector` — 99 facts, **2** distinct pairs

    85  RP-TNC   -> rp-tnc
    14  N-type   -> n-type

Both spellings the domain already **accepts**. A pure case fold; not one value changes meaning.
99 of 99 change, 0 refused, 0 unrecoverable.

### `drive_interface` — 299 facts, **14** distinct pairs

Fold onto aliases that already exist: `SAS` 79, `SATA` 71, `NVMe` 68, `U.3` 20, `U.3 NVMe` 8,
`SAS-3` 5, `PCIe Gen5 x4` 3, `U.2` 2, `PCIe Gen5 x2` 1.

Refuse to gaps, and **should**, because they are not drive interfaces at all: `3X` 12 and `1X` 11
(a multiplier), `10/100` 9 and `10/100/1000` 6 (ethernet speeds), `1DWPD` 4 (a drive-writes-per-day
endurance figure). 42 refusals, each becoming a gap rather than a wrong value.

### `radio_bands` — 215 facts, **41** distinct pairs

The Wi-Fi spellings fold: `2.4 GHz` 56, `5 GHz` 30, `Dual-band` 15, `2.4GHz` 13, `Dual Band` 10,
`5GHz` 6, `2.4/5 GHz` 5, `5Ghz` 3, `Tri-band` 3, `tri-band` 3, `2.4 Ghz` 1, `2.4 and 5 GHz` 1.

**The refusals are not a normalisation problem — they are three other fields poured into this one**,
which the replay can only turn into gaps and which has to be fixed where the values arrive:

| what it actually is | examples |
|---|---|
| cellular bands | `700 MHz` 14, `800/900/1800/2100/2600 MHz` 10, `850/900/1900/2100 MHz` 4, and eleven prose rows: `LTE FDD 2100 MHz (band 1), 1900 MHz (band 2, band 25), …`, `GSM, GPRS, EDGE: 850 MHz, …`, `● 5G FR1: n1, n2, n3, …` |
| a **mains frequency** | `47 to 63 Hz` 3 |
| an **optical** band | `L: 184.48 to 191.56 THz (1565 to 1625 nm)` 1 |

A gap is the correct value for all of them until the mapping is fixed, because a cellular band
stored as a Wi-Fi radio band is a wrong value and indistinguishable downstream from a right one.

### `wifi_generation` — 188 facts, **16** distinct pairs

Fold onto one generation each: `Wi-Fi 6` 57, `WiFI6` 35, `Wi-Fi 6E` 13, `WiFi6` 11, `Wi-Fi 7` 8,
`WIFI6` 1, `WiFi 6` 1.

Refuse to null, which the reviewer had already ruled correct — *"a feature list and 'No' were never
generations"*: `2X2 MIMO` 18, `NA` 14, `No` 11, `DL-OFDMA**, UL-OFDMA**, TWT support**, BSS
coloring**` 8, `–` 4, `Yes` 3, `4` 2, `Yes, 4 Stream MU-MIMO` 1, `Yes, 8 Stream MU-MIMO` 1.

## `mounting` is refused — and the reason I first wrote down was the wrong reason

Reading the population against the domain refused this key, and then a second measurement refused my
reason for refusing it. Both numbers are below, because **the difference between them IS the finding**
and this is the day's most repeated correction: put the predicate next to the number.

**What I measured first**, cisco only, against the dictionary's global domain:

    mounting: 994 facts, 82 distinct (raw, value); OUT OF DOMAIN 95, in ONE distinct pair
        95  value null   <= raw ""

So: every out-of-domain cisco `mounting` row has a **null value and an empty raw**. Those are exactly
the 95 the replay calls unrecoverable — there is nothing to re-derive from — while the replay *would*
rewrite 115 rows whose stored value is already in the domain. An `--allow` written to close
out-of-domain values must not wave that through. **Refusal stands.**

**What the verifier counts is a different population.** `enum_values_in_domain` reads every vendor,
compares against `domainFor(category, key)`, and excludes retracted facts, retired parts and NULL
values. Under that predicate:

| | cisco vs global | cisco vs category | other vendors |
|---|---|---|---|
| `mounting` | 95 | 95 | **115** |

The cisco 95 are **not in the verifier's number at all** — their value is null, so the filter drops
them. The `mounting 115` on the board is entirely **hpe and aruba prose**: *"Mounts in an EIA standard
19-inch telco rack"*, *"Cable management kit included. 2-post rack…"*, *"Desktop"*. So the sentence
"mounting's out-of-domain population is 95 empty-raw cisco rows" was true of my query and false of
the red it was explaining. The refusal was right; the reason was about another set.

## And the six-key report was three keys short

The same reconciliation named three keys the dry-run table never listed, and their cause is different
again — **the replay cannot touch them**:

| key | out of domain | selected by a replay | would change | what it actually is |
|---|---|---|---|---|
| `audio_codecs` | 80 | 9 | **0** | already at normaliser 1.8.0 and still outside the domain |
| `spatial_streams` | 5 | 506 | **0** | ditto — 506 replayable rows, not one changes |
| `antenna_type` | 5 | 5 | 3 | `E: External antennas`, `I: Internal antennas` fold; the rest carry a gain figure in the value |

`audio_codecs` and `spatial_streams` are the useful pair: **a replay is a no-op on them**, because they
are not stamped with an old normaliser — they are current values that the domain does not admit
(`["G.711 (a-law/µ-law)", "G.722", …]`, `"8 x 8 multiple input, multiple output (MIMO)"`). That is alias
or domain work, not replay work, and calling it a version gap would have sent someone to run the wrong
command.

## What was run

Four recorded runs, one per key, each carrying the reading above verbatim in its `--allow` reason,
so the run row answers *why was the ceiling lifted* without anyone needing this file. Nothing was
run for `mounting`, and nothing was run for `standard` — the prose **is** the raw there, so
re-normalising it produces the same prose; that one is a seed retraction plus the seed lane's enum
contract in one plan, which is still with the reviewer.

Measured on the board afterwards: `enum_values_in_domain` **2,838 -> 2,011**, and the residue is now
four separate problems rather than one number — `standard` 1,806 (seed prose, with the reviewer),
`mounting` 115 (other vendors' prose), `audio_codecs` 80 + `spatial_streams` 5 (alias/domain, replay
is a no-op) and `antenna_type` 5. Four recorded runs: 1246 antenna_connector, 1247 drive_interface,
1248 wifi_generation, 1249 radio_bands; 628 facts superseded, 199 retracted to gaps, gate PASS on all
four.
