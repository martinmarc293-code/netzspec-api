# Schema — round-3 item 9, optical-networking + storage-networking (group `optical-r9`), 12 Sep 2026

Worktree `D:\Project\nzs-agents\optical-storage`, branch `cisco-agent/optical-storage`, from cisco HEAD `57a1f01`,
uncommitted. **Database read-only throughout**, and proven rather than asserted: the builders were run through
`DATABASE_URL=…?options=-c default_transaction_read_only=on` with `NETZSPEC_APP_NAME=cisco-agent/optical-r9`, and a
probe on that pool reported `transaction_read_only = on` and refused a `CREATE TEMP TABLE`
(`cannot execute CREATE TABLE in a read-only transaction`) before any builder ran. No pipeline command was run; no
run row was opened.

---

## Files changed

| file | what |
| --- | --- |
| `src/core/fieldSchema.ts` | curated keys `channel_spacing`, `total_output_power`, `filter_passband` (retypes) and `degrees` (new), in a `// optical-r9` block; optical-networking profile gains `filter_passband: opt`, `degrees: opt` and `dispersion_compensation: cond(kind dcu)` |
| `src/core/specNormalize.ts` | **3 hunks, listed line by line below** — `VALUE_REFUSALS` gains `channel_spacing` and `total_output_power`, and its lookup MOVES from the `s` branch into `normalizeField` so it can protect a number |
| `data/schema/attribute-aliases.en.json` | rule #1075 redirected `tx_power` → `total_output_power`; one new scoped rule `^osc filter passband$` → `filter_passband` |
| `data/schema/description-patterns.json` | 3 new (`opn-r9-degrees`, `opn-r9-dcf-ps-nm`, `opn-r9-dcu-ps-nm`); 2 redirected (`opt-itu-grid-ghz` → `channel_spacing`, `opt-edfa-output-dbm` → `total_output_power`) |
| `data/schema/source-fields.json` | `dispersion_compensation` added to the two Cisco datasheet `*` lists (247 / 125 keys), `profile_required` 107 → 108 |
| `tests/specNormalize.refusals.test.mjs` | +24 cases, +6 definition assertions (84/84) |
| `tests/specNormalize.units.test.mjs` | +18 cases with their sabotage twins (240/240) |
| `tests/cupLedger.test.ts` | `// optical-r9` block: 14 shape assertions (which kind owes which cup, and which must not) |
| `data/ledger/cisco-*.json`, `data/census/cisco-*.json` | both rebuilt for my two categories |
| `data/mapper/cisco-*.json` (all 17) | rebuilt — see "the merge note" |

**`specNormalize.ts`, exactly what I touched** (it is shared with two other agents this hour):

* `VALUE_REFUSALS` table (was 1353-1359, now 1353-1382): two entries appended, `channel_spacing` and
  `total_output_power`. The existing `radio_bands` entry is untouched.
* `normalizeField`, after the placeholder guard (5 lines inserted after the old 1392): the `VALUE_REFUSALS`
  lookup.
* the `case "s":` branch (was 1492-1496, now 3 lines): the same two lines REMOVED, replaced by a comment
  saying where they went.

Nothing else in that file was read-modified. The move is behaviour-preserving for the entry that was already
there — `radio_bands` is type `s`, so it reaches the identical refusal by the identical regex — and that is
asserted as a control: bare Hz still `RANGE_VIOLATION`, `"2.4/5 GHz"`, `"700MHz"` and `"1390 MHz - 1525 MHz"`
still stored verbatim.

---

## The six jobs

### 1. The amplifier's passband — it is `filter_passband`, in NANOMETRES, not `passband` (MHz)

The dictionary round refused merging `filter_passband` (nm) into `passband` (MHz) because they are different
quantities in different units. **Nothing about the amplifier changes that; the amplifier lands on the nm side of
the same refusal.** Measured rather than argued:

```
the ONLY passband any EDFA or Raman sheet in the corpus states, read out of the cache:
  OSC filter passband | 1500 to 1522 nm        Enhanced Optical Booster Amplifier for ONS 15454 MSTP
                                               (doc 11206df080e504f3), in the same table as
                                               "OSC filter insertion loss | 1.8 dB" and "Gain ripple"
the 46 `passband` occurrences, all of them:
  "Pass band" 33 · "Pass Band" 13 → "105-1002", "52-1002", "105 to 1218", "5 to 85"  MHz
                                               GS7000 HFC receivers — `video`'s amplifier, an RF one
```

So there are two amplifier populations and they were never the same cup: video's HFC node amplifier has an RF
passband in MHz, and an optical amplifier has a filter window in nm. `passband` keeps its MHz unit and its
declaration where it is.

**The decision, with its unit.** `filter_passband`, retyped `s` → `nr`, unit **nm**, band **[1200, 1700]**, and
declared `opt` in optical-networking. `nr` because the value is a window ("1500 to 1522"). The band spans every
single-mode telecom band (O 1260 through L 1625) with margin, and it is doing a second job: **three quantities
wear the word "passband" in nm and only one of them is an absolute window.**

```
1500 to 1522 nm     an absolute window (the OSC filter)                  -> stored {1500, 1522}
± 0.18 nm           "Minimum transmit filter passband (0.5 dB RBW)" 6×   -> RANGE_VIOLATION
3.49 nm             "Minimum filter passband (at -1 dB)" 2×              -> RANGE_VIOLATION
52-1218 MHz         an RF passband arriving in the optical cup           -> UNIT_UNKNOWN
```

The two refused values are WIDTHS, and their cup already exists: `channel_bandwidth` ("Channel bandwidth @
-0.5 dB", nm), which this category declares. A recorded gap for them is right; storing a 0.18 nm half-width in a
window cup is the weight-of-0.075-kg-read-as-75 shape.

Cost of the retype: `filter_passband` holds **0 facts anywhere**, and the only other declarer is
`interfaces-modules` (opt). Nothing moves. Its 6-occurrence label keeps pointing at it (rule #1108) and its
values are now refused rather than stored as free text — flagged to that group below.

Worth recording on the other side of the refusal too: **`passband` holds 0 active facts catalogue-wide** despite
its 46 label occurrences and twelve declaring categories. So neither cup loses a stored value, and the merge the
dictionary round refused would have had nothing to merge — it was a refusal about the quantities, not about the
data, and it is still the right one.

**Fill path.** New alias rule `^osc filter passband$` → `filter_passband`, scoped to optical-networking so it can
never reach video's cup. **Stated limit:** that label is not in `runs/vocab/cisco-datasheets/labels.json`
(8 Sep) — the inventory carries no "OSC filter" label at all — so the next mapper trace will report the rule as
reaching nothing in all 17 categories. That is the inventory being older and thinner than the corpus, not drift:
the document is on disk and the row is quoted above. Do not delete the rule on the trace's word alone.

### 2. `degrees` — a new cup, and it is NOT the ROADM's

`degrees`: type `n`, **no unit** (a count, like `module_slots`), band **[1, 16]**, declared **`opt`**.

Band: the catalogue's own names state 4, 5 and 8, the NCS 2000 mesh tops out at 12 ("4- to 12-degree"), and 16
leaves margin while refusing a channel count (40 / 80 / 96) or a port count (20) arriving under the wrong label.

**The measurement that decided the shaping.** Of the twelve parts whose name states a degree count, **eight are
kind `mux` and four are `accessory`. Not one is a `roadm`.**

```
mux        NCS2K-12-AD-CCOFS(=)  "12-port - 4-degree - Contentionless Add/Drop Unit"
           NCS2K-12CCOFS-OF      "NCS 2000 12-port 4-degree CCOFS"
           NCS2K-MF-DEG-5(-CV)=  "5 Degrees Mesh Interconnect" / "Up to 5 Degrees"
           NCS2K-MF-UPG-4=       "Mesh Interconnection MF Unit - Upgrade - 4 Degrees"
           NCS2K-MF-4X4-COFS=    "4-Degree and 4-Ports Add/Drop MF Unit"
           NCS2K-16-AD-CCOFS=    "16-port - 4- to 12-degree"     <- REFUSED, see below
accessory  15454-PP-4-SMR=, 15454-PP-MESH-4=, -8=, NCS2K-PPMESH8-5AD=   "8-Degree Mesh Patch Panel"
roadm      NCS2K-20-SMRFS "20-port Single Module ROADM" · 15454-40-WXC-C= "40Chs Broadcast Wavelength
           Cross-Connect" · NCS2K-9-SMR24FS "9-port … 12-24dB Gain"      <- ports, channels, gain. no degrees.
```

A ROADM card states its PORT count, its CHANNEL count and its gain; the degrees belong to the NODE the card sits
in, and the parts that state them are the units that WIRE the degrees together. Requiring it of `roadm` would
have opened 40 gaps that no ROADM datasheet can close, and of `mux` 263. It is therefore declared and asked of
nobody, with eleven fills available from the name — and `tests/cupLedger.test.ts` asserts that no kind requires
it, so a later round that makes it a ROADM requirement goes red and has to re-read this paragraph.

**Fill path**: `opn-r9-degrees`, replayed over all 2,821 named optical parts — **11 matches, clean rate 1.000**.
Three guards, each written against a shape in the corpus:

* `(?<![0-9][ -]{0,2}to[ -]{1,2})` refuses `NCS2K-16-AD-CCOFS=` "4- to 12-degree", which is the range of NODE
  sizes the card fits, not a count of anything the card has. `"Up to 5 Degrees"` still matches, because there the
  single number IS the unit's rating.
* `(?!\s*(?:[CF](?![a-z])|celsius|fahrenheit))` refuses "40 degrees C" and "degrees Celsius". **The word also
  means temperature**, and without this the cup would take an operating temperature. Nothing else in the pipeline
  would have noticed, because 40 is a plausible-looking number.
* `(?<![0-9a-z])` refuses "360-degree".

A bare "-40 degrees" with no scale letter still matches the pattern and is then refused by the band — which is
why the band is [1, 16] and not something generous.

### 3. DCU `dispersion_compensation` — the cup existed; what it lacked was a fill path

Unit **ps/nm**, band **[-3000, 3000]**, type `n` — unchanged, and re-justified: the catalogue's own values run
100 to 1983 ps/nm and margin both ways lets either spelling of the sign land. It is now **required of kind
`dcu`** (`cond({field:"kind", inList:["dcu"]})`), which is the change: a DCU is bought on exactly this number and
it was optional.

**Two new name patterns, replayed: 10 + 8 = 18 matches, clean rate 1.000 each.**

```
opn-r9-dcf-ps-nm   "DCF of -100 ps/nm" … "DCF of -1950 ps/nm"                    10
                   four of the ten write the sign DETACHED: "DCF of - 450 ps/nm"
opn-r9-dcu-ps-nm   "E-LEAF Dispersion Compensation Unit 200 ps/nm"                2
                   "SMF L-band Dispersion Compensation Unit 1000ps/nm"            6
```

The sign is optional in the pattern and **outside the capture** on purpose. Cisco writes the same quantity with
the sign on the DCF parts and without it on the DCU-E / DCU-L parts, so capturing the magnitude is what makes the
eighteen values comparable in one cup; and four of them write "- 450", which the shared `NUM` regex cannot read
as a number at all (job 6). The second pattern is anchored on the whole phrase rather than on "ps/nm", because
the tunable TDC units state a range and a bare ps/nm rule would take its first number.

**The other 32 of the 50, read one by one** — this is the denominator, not a percentage:

| n | what | fill path |
| --- | --- | --- |
| 18 | bare `DCU-100` … `DCU-L-1100`, named "Cisco &lt;sku&gt;" | none: these are the datasheet's own shorthand, not orderable PIDs. **product_class proposal P5** |
| 10 | `15216-FBGDCU-165=` … `-1983=`, named "Cisco &lt;sku&gt;" | the figure is in the PID only. **Proposal P6** (a derivation, with the convention's evidence) |
| 2 | `15216-DCU-L-800`, `-L-1100` (base PIDs of a named `=` spare) | inheritance from the sibling, not a parser |
| 2 | `15454-TDC-CC=`, `-FC=` tunable | they state a range; a recorded gap |

**The ledger prints `NO FILL PATH: dispersion_compensation` and will until the pattern has run once.** Its
`observed_fill_path` counts label occurrences and STORED `description_mining` facts, so a declared derivation
rule that has not been applied yet is invisible to it — while the brief's fillability rule admits exactly that
third source. The flag is honest and the replay is the evidence; it clears the first time
`apply-description-specs` runs. Worth fixing in the builder (proposal P8), because the same blind spot will
mislabel every future name-mined cup.

### 4. `channel_spacing` (GHz) and `total_output_power` (dBm) are numbers now

```
channel_spacing      s -> n    GHz    band [6.25, 400]
total_output_power   s -> nr   dBm    band [-40, 30]
```

`channel_spacing` band: 6.25 GHz is the ITU-T G.694.1 flex-grid granularity, 200 GHz the widest spacing in the
catalogue, 400 the widest plan a 400G line system uses. It refuses a channel count (40 / 80 / 96 — well, 96 is
in band; see the limit below) and a wavelength. `total_output_power` band: the observed span across the amplifier
sheets is **-29 … +21 dBm**, and the margin refuses a watt figure and a gain in dB — both of which sit in
adjacent rows on every amplifier sheet in the corpus.

`nr` for the power because Cisco states it both ways on the same shelf: "Total output power | 21 dBm | 17.5 dBm"
and "total output power of 20 dBm" are single figures, while the EDRA Raman sheet prints "Signal output power
range" as a span (-22 to -12, -1 to 14, 6 to 16, -29 to -14 dBm).

**The spellings the corpus uses, folded — and the half of the retype that nearly shipped wrong.** All 20 stored
`channel_spacing` facts are in `transceiver`; here is every distinct raw and what the numeric cup does with it:

| n | raw | before the guard | now |
| --- | --- | --- | --- |
| 2 | `50 GHz` | 50 | **50** |
| 1 | `50 GHz spacing` | 50 | **50** |
| 8 | `20 nm` | refused (length ≠ freq) | refused, `UNIT_UNKNOWN` |
| 3 | `50 GHz or 37.5 GHz` | **50** | refused, `PARSE_FAIL` |
| 1 | `75 GHz or 100 GHz` | **75** | refused |
| 1 | `75GHz or 100GHz` | **75** | refused |
| 3 | `50GHz or greater` | **50** | refused |
| 1 | `75 GHz or greater$\|$50GHz or greater` | **75** | refused |

**A number reader takes the first number it finds.** My first measurement of this retype accepted all six
alternation shapes — "50 GHz or 37.5 GHz" became 50, in band, and nothing downstream could have refused it. A
mutually exclusive pair silently collapsing onto its first member is the capability-statement defect in its
purest form, and the cup a mux is bought on is the wrong place for it. That is what the two new `VALUE_REFUSALS`
entries are for, and it is why a retype is not finished when the type changes. `$|$` is refused on its own
account too, because a pair of joined cells can arrive with no "or" in the second half; `total_output_power` gets
the same guard at zero cost (0 facts) because the L-band sheet prints two amplifiers in one row.

So **3 of 20 survive and 17 are retraction proposals** (P3): 8 are a real CWDM spacing in the wrong cup, 9 are
not values at all.

**20 nm is not 2,500 GHz.** A CWDM spacing is a wavelength spacing — 20 nm is ~2,500 GHz at 1550 nm and
~2,900 GHz at 1450 nm, so the conversion depends on where in the band you stand. It is the same refusal as
`filter_passband` (nm) not being `passband` (MHz), one cup over, and the missing cup for it is named in P4.

**The fill paths, and both were already in the code pointing at the wrong cup.**

```
channel_spacing     `opt-itu-grid-ghz` matched "(50|100|200) GHz" and wrote it to `itu_channel` — 539 facts in
                    this category holding THREE distinct values: "100" 414, "200" 108, "50" 17. That is a GRID
                    SPACING under a CHANNEL-NUMBER key, beside the real channel numbers `transceiver` (20..59)
                    and `video` keep in the same key. The pattern's own id says grid. REDIRECTED; re-replayed
                    over all 2,821 names under the new key: 539 matches, rate 1.000.
total_output_power  `opt-edfa-output-dbm` wrote an EDFA's output power to `tx_power` — 6 of this category's 7
                    tx_power facts (15216-EDFA1= 17 dBm ×5, 15454-OPT-AMP-C= 20 dBm). An amplifier has no
                    transmitter. Their own sheets name the figure: "total output power of 17 dBm"
                    (f915469e45d6cf77), "total output power of 20 dBm" (fe545d2769ab7ccf). REDIRECTED;
                    6 matches, rate 1.000.
```

Plus the labels: `^(maximum total output power|signal output power range)$` (13 occurrences) and
`^Channel spacing$` (5).

**One caveat the cup cannot carry, stated because it is why `total_output_power` stays `opt` rather than becoming
the amplifier's required cup.** The EDRA table qualifies each span with a Condition column — "Full channel load
with maximum value of signal output power" against "Single channel with minimum value" — and only the full-load
figure is a TOTAL. The extractor stores one value per label and cannot tell them apart.

**A limit of the `channel_spacing` band, stated:** 96 GHz is inside [6.25, 400], so a channel COUNT of 96
arriving under a "Channel spacing" label would be stored. The only writers are an anchored `(50|100|200)` pattern
and two exact labels, so it cannot arrive today; a closed list of ITU spacings would be the stronger guard and it
is proposal P9.

### 5. Director `airflow` — the directors are NOT asked one, and they must not be

First, the premise: **`airflow` is not asked of kind `director` in HEAD.** The profile gates it on
`["switch","power","fan"]` and the committed ledger agrees — director is asked 8 cups and airflow is not among
them. What follows is the measurement that says it must stay that way.

**The MDS directors state an airflow RATE. A fixed MDS switch states a DIRECTION.** Read out of the cached
datasheets:

```
MDS 9506 / 9509 / 9513   "Airflow: 300 linear feet per minute (lfm) through system fan assembly"
                         (d6370095b760aa17, 21031fae4600573e, b15589339b3b4262)
MDS 9718                 "Air flow: The MDS 9718 provides 30 to 100 Cubic Feet per Minute (CFM) total flow
                         through each line-card slot depending on the line-card type and fan-speed setting."
                         (f64dc0153dee65e5)
fixed switches, fan trays, supplies   "Port Side Intake" / "port-side exhaust" — in the PID's own name, and
                         all 52 stored airflow facts in this category are one of those two, mined from the name
                         (DS-C9132T-24PITK9, DS-C32S-FAN-E=, DS-CAC-500W-I=, …)
```

`airflow` is type `e` with a directional domain (`front-to-back | back-to-front | side | reversible |
port-side-intake | port-side-exhaust`). An lfm figure is an air VELOCITY and a CFM figure a VOLUME FLOW RATE.
Asked of a director, the cup would be unanswerable for every one of the 34 — and the failure would not be a clean
gap. Measured with the real normaliser:

```
"300 linear feet per minute (lfm) through system fan assembly"            -> ENUM_VIOLATION   (a clean gap)
"30 to 100 Cubic Feet per Minute (CFM) total flow through each slot"      -> ENUM_VIOLATION   (a clean gap)
"With the MDS 9718 using front-to-back cold-aisle and hot-aisle air flow,
 Cisco recommends that you maintain a minimum air space of 7 inches…"    -> "front-to-back"   <- A WRONG VALUE
```

That third line is the 9718's own prose, and the `/front.?to.?back/` rule lifts a direction out of a sentence
about wall clearances. **I checked the ordering rule before concluding anything**, as the job said: port-side
terms precede front/back deliberately (11 Sep, after 239 facts saying "port-side intake" were stored as
side-to-side by the `/seit|side/` rule), and the comment's reasoning — "a cell giving both is decided by the term
that cannot mean two things" — is right for the fixed switches it was written for and does nothing for a
director, whose cell contains no port-side term at all. **The ordering is not the problem and I changed nothing
in it.**

**The missing cup, reported and deliberately NOT added.** A volumetric airflow rate has no key anywhere in the
dictionary (`grep -i "cfm\|lfm\|linear feet\|cubic feet"` over `fieldSchema.ts`, `fieldSchema.generated.ts` and
`specNormalize.ts`: nothing). I did not add one, and the reason is the fillability rule read in both directions:

* lfm and CFM are **different dimensions**, and converting one to the other needs the duct cross-section — the
  `filter_passband`/`passband` refusal again. One cup cannot hold both.
* A CFM cup could hold **none of the four values that exist**: three are lfm, and the fourth is per-line-card-slot
  and a "30 to 100 … depending on the line-card type and fan-speed setting" capability statement.
* The only label evidence outside these four documents is `"Minimum CFM"` — 35 occurrences, 2 files, unmapped,
  values 200 / 21.9 / 50 — and its sample SKUs are **Alteon appliances**, i.e. very likely not a Cisco MDS row at
  all. Building a catalogue-wide key on that is the adjacent-corpus trap.
* "CFM" also means Connectivity Fault Management in six other labels (`Ethernet OAM Connectivity Fault
  Management (CFM)`, `Total number of IEEE 802.1ag CFM MEPs`), so any rule for it must be anchored whole-string.

So: proposal **P7**, with the four quoted values and the label counts, for whoever owns the decision. Two
assertions were added to `tests/cupLedger.test.ts` in the meantime — a director is not asked an airflow
direction, a fixed switch is — so the shaping cannot drift back silently in either direction.

### 6. The seven optical census refusals, and the `total_output_power` / `tx_power` conflict

**The 7 (unchanged by this round's rebuild: `would_refuse` is still 7).**

| n | cup | SKU | raw | verdict |
| --- | --- | --- | --- | --- |
| 5 | `min_software_release` | ONS-QSP28-LR4=, ONS-SC+-10G-{ER,LR,SR,ZR}= | `"NA"` | correctly refused by the 12 Sep placeholder guard; they were stored before it existed. **Retraction P1** |
| 1 | `tx_power` | CIM8-LE-K9 | `"+3 to - 10 dBm in 0.01 - dBm increments"` | two stacked parser defects, below |
| 1 | `input_power_range` | CIM8-LE-K9 | `"0 to - 12dBm"` | the same two |

**Those last two are TWO defects, not one, and only the second is on the books.** Measured with the real
normaliser:

```
"0 to - 12dBm"     UNIT_UNKNOWN: unit "to" not recognised
"0 to -12 dBm"     PARSE_FAIL:   range min 0 > max -12
"-12 to 0 dBm"     OK  {min: -12, max: 0}
```

1. **`NUM` does not allow whitespace between a sign and its digits.** `NUM` is
   `[-+−–‐‑]?[0-9][0-9.,…]*`, so `"- 10"` is not a number; the `nr` range regex then fails to match at all and
   the value dies `UNIT_UNKNOWN` on the word "to". Same family as the documented `"-40 to -72 VDC"`
   `NOT_RANGE_WORD` bug, one step further along. **It is not confined to this part: four of the ten DCU names
   write "DCF of - 450 ps/nm"**, which is why my dispersion pattern captures the magnitude and keeps the sign
   outside the capture.
2. **Once that is fixed the value hits `min > max`** — the census's own Q6 ("negative DC ranges read in the wrong
   order"). So **fixing the recorded defect alone converts one refusal reason into another and still stores
   nothing**; the pair has to land together. Proposal P2, with the one-line patch and the sabotage twin, and NOT
   written here: `NUM` and the `nr` branch are the shared spine of every numeric cup in seventeen categories, and
   two other agents are in that file this hour. A refusal is a recorded gap, so leaving it costs two facts on one
   part.

**The shadowed rules: eleven benign, one not.** The winner of each label computed with the real `traceLabel`, not
read off the file:

| rule | label | wins | verdict |
| --- | --- | --- | --- |
| #710 / #711 / #712 | Gain range / Standard / Extended | #402 → `gain` | **benign** — same cup, the winner's alternation already covers all three |
| #713 / #714 / #715 | Noise figure at nominal/minimum/maximum gain | #403 → `noise_figure` | **benign** — same cup, one alternation |
| #716 / #735 | Insertion loss / Insertion Loss | #404 → `insertion_loss_max` | **benign** — same cup; the file is case-insensitive, so these are one rule written twice |
| #719 | Maximum total output power | #406 → `total_output_power` | **benign** — same cup |
| #720 | Signal output power range | #406 → `total_output_power` | **benign** — same cup |
| #721 | Overload | #407 → `rx_max_input_power` | **benign** — same cup |
| #742 | Pass Band | #741 → `passband` | **benign** — case-insensitive duplicate of #741 |
| **#1075** | **Signal output power range** | **#406 → `total_output_power`** | **NOT benign — a different cup** |

#1075 is `^signal output power range` → **`tx_power`**. It is shadowed in **17 of 17** categories and wins that
label in none of them, so it has never fired — and that is what made it a landmine rather than a bug: the day
somebody scopes #406 to a category, this rule starts filing an EDFA's composite output power as a transmit power,
silently, into the cup 459 optical pluggables share.

**Which cup is right, and why it is not a coin toss.** An amplifier has no transmitter. `tx_power` is a laser's
launch power and its forty alias rules are all transceiver and radio labels ("optical transmit power", "launch
power", "radio: output power"). The label's own values, from the NCS 2000 EDRA sheet, are a composite figure with
a channel-load condition. #406 winning is correct.

**Fixed by REDIRECTING #1075's key, not by deleting the rule.** Deleting renumbers every later rule, and
`tests/mapperTrace.test.ts` freezes the conflict table BY INDEX while three branches are editing that file this
hour. After the redirect #1075 is a duplicate of #406 — exactly as benign as the other eleven — and the frozen
table loses one entry.

**The other two rules I read and left alone:** #741/#742 `^Pass band$` → `passband` are UNSCOPED, so they reach
optical-networking, where the cup is the wrong one (MHz). Nothing in the optical corpus carries that exact label
— the 46 occurrences are all GS7000 video receivers, and the amplifier's row is "OSC filter passband" — so the
risk is theoretical. Scoping #741 to `video` is a one-line proposal (P10) and not my write: it is video's rule
and video's traffic.

---

## Ledger and census after the change

```
optical-networking   parts 1,637   declared_fields 404 -> 406   profile_hash e2b0990c -> 22627183
                     required slots at nothing-known 5,368 -> 5,418   (+50 = the 50 dcu parts × 1 new cup)
                     dcu now asked 3: dispersion_compensation, insertion_loss_max, product_compatibility
storage-networking   unchanged except the rebuild stamp — nothing in its profile moved
census               optical would_refuse 7 (unchanged), 3 free-string candidates; storage 0 and 1
```

**The three optical free-string candidates, read.** `min_software_release` (45 distinct: "9.6.1", "16.7.1") is
legitimately free — a release string has no domain, and its only defect is the 5 "NA" placeholders above.
`tx_wavelength` (8 distinct) holds per-lane lists ("1271 ±6.5 (lane 1) 1291 ±6.5 (lane 2) …") that no single
number can carry; free is right, though it is worth noting it is type `s` while its symmetric partner
`rx_wavelength` is `nr` nm with a band. `standard` (8 distinct) holds "CWDM" 56 / "DWDM" 13 / four
"1000Base-*" — two quantities in one cup (a WDM grid type and an Ethernet PHY) — **and one junk value,
`15216-MD-ID-50=` = "5°C to 40°C"**, which is an operating temperature (P11). `standard` is declared by many
categories, so neither the split nor the retraction is mine to make.

**Storage's single candidate is `series`**, which is column-backed and by the brief's own rule never a slot.
Benign.

---

## PROPOSALS — database writes and other owners' lanes. NONE executed.

| # | rows | what | action |
| --- | --- | --- | --- |
| P1 | 5 | `min_software_release` = "NA" on ONS-QSP28-LR4= and four ONS-SC+-10G-* | retract; the guard already refuses the value, the facts predate it |
| P2 | 2 | CIM8-LE-K9 `tx_power` / `input_power_range` | fix `NUM` to allow a space after the sign **and** the `min > max` ordering for descending ranges, in one change, then renormalise. Either alone stores nothing |
| P3 | 17 | `transceiver` `channel_spacing` strings that the numeric cup refuses | retract 9 (6 alternations, 3 "or greater"/joined); the 8 `"20 nm"` are a real CWDM spacing waiting for P4 |
| P4 | — | no cup holds a CWDM channel spacing in nm | a decision: a second key, or `channel_bandwidth`. 8 facts are parked on it |
| P5 | 18 | bare `DCU-100` … `DCU-L-1100`, product_class `hardware`, named "Cisco &lt;sku&gt;" | reclassify: the datasheet's own shorthand, not orderable PIDs. Part of a wider count — **81 of the 1,638 optical hardware parts are named "Cisco " || sku**, including `40-SMR1`, `40-SMR2`, `40-WSS`, `40-WXC` |
| P6 | 10 | `15216-FBGDCU-<n>=` | a PID-suffix derivation for `dispersion_compensation`. The convention is proven by the 18 parts where the PID number and the prose figure agree; the FBG family is a different product line, so it needs its owner's yes before it is mined |
| P7 | — | no cup holds a volumetric/velocity airflow rate | a decision, with the four quoted director values and the "Minimum CFM" label counts. See job 5 |
| P8 | — | `build-cup-ledger`'s `observed_fill_path` cannot see a declared description pattern | count `data/schema/description-patterns.json` as a source, or it will report NO FILL PATH for every future name-mined cup |
| P9 | — | `channel_spacing`'s band admits 96 GHz | a closed list of ITU spacings would refuse a channel count arriving under the label |
| P10 | — | alias #741/#742 `^Pass band$` → `passband` are unscoped | scope to `video`: the cup is MHz and all 46 occurrences are HFC receivers. Video's rule, not mine |
| P11 | 1 | `15216-MD-ID-50=` `standard` = "5°C to 40°C" | retract; it is an operating temperature |
| P12 | 539 | optical `itu_channel` holding "100" / "200" / "50" | rekey to `channel_spacing`. The pattern that wrote them is redirected, but facts are append-only |
| P13 | 6 | optical `tx_power` on 15216-EDFA1=, 15216-EDFA2(-A)(=), 15454-OPT-AMP-C= | rekey to `total_output_power` |
| P14 | ~151 | `transceiver` `itu_channel` holding "100" (111) and "100 GHz" (40) | the same defect in that category: a grid spacing under a channel-number key. Their call |
| P15 | — | `im-itu-grid` (`([0-9]{2,3}) ?GHz ITU grid` → `itu_channel`, 34 matches) in `interfaces-modules` | the same defect a third time. Redirect to `channel_spacing`. Their file |
| P16 | — | `interfaces-modules` declares `filter_passband` (opt, 0 facts) | its "± 0.18 nm" values are now refused by the band. The right cup for a per-channel width is `channel_bandwidth`; rule #1108 may want redirecting. Flagged, not touched |
| P17 | — | all 17 `data/census` artifacts and `transceiver`'s in particular | rebuild after this merge: `channel_spacing`'s retype makes 17 transceiver values would-refuse, which its census does not yet show |

---

## The merge note

`data/mapper/cisco-*.json` — **all 17** — were rebuilt, because one shared alias rule changed its key and the
"shadowed in every category" claim in `tests/mapperTrace.test.ts` is computed across all seventeen artifacts.
Rebuilding only my two would have left fifteen files asserting the old cup while the suite stayed green on them,
which is a false green rather than a small inconsistency. With the rebuild, `KNOWN_CUP_CONFLICTS` loses its
`"Signal output power range|1075"` entry (thirteen → twelve) and the header comment's count follows. If another
branch also regenerates those artifacts, the conflict is resolved by re-running
`scripts/build-mapper-trace.mts --category <c>` per category after the merge; nothing in them is hand-written.

## Suites run

All ten permitted suites, every one exit 0, after the artifacts were rebuilt:

```
opticalKind             154 passed, 0 missed (48 positives, 48 refusals, 17 sabotaged families)
sanKind                  87 passed, 0 missed (23 positives, 25 refusals, 11 sabotaged families)
opticKind                78 passed, 0 missed          partKind   58 passed, 0 missed
fieldSchema              57 passed, 0 failed           aliasRules 259/259 (222 rule-table, 37 scoped)
cupLedger               318 passed, 0 missed (17 ledgers, 4 sabotage cases)
mapperTrace              28 passed, 0 missed (17 committed traces, 12 known cup conflicts — was 13)
specNormalize.refusals   84/84 (40 refusal cases, 9 definition assertions)
specNormalize.units     240/240  "every twin refuses for the right reason"
npx tsc --noEmit -p .   clean
```

`npm test` was NOT run (it truncates the shared test databases). No suite outside the permitted list was run.

## Anything I could not check

* **Whether the FBGDCU PID suffix really is ps/nm.** The ten values (165, 331, 496, 661, 826, 992, 1157, 1322,
  1653, 1983) are near-multiples of 165, which is about 10 km of SMF, and the convention holds for the 18 parts
  where the PID and the prose agree. That is an inference from a numeric pattern, not a stated spec, so P6 is a
  proposal and the ten parts stay gaps.
* **Whether the "Minimum CFM" label (35 occurrences) is ever a Cisco MDS row.** Its sample SKUs are Alteon
  appliances and the inventory is not per-document, so I could not attribute it. That is why P7 is a question.
* **Whether the director sheets state a direction anywhere.** I read the Airflow and Cooling rows of all four
  cached director datasheets and found a rate in every one, plus the 9718's prose sentence. I did not read the
  installation guides, which is where a front-to-back statement would live if there is one.
* **The 8 Sep label inventory is older than the corpus**, and the OSC filter row proves it: a real datasheet row,
  quoted above, that no label in `labels.json` carries. So every "label occurrences" figure in this report is a
  lower bound on that side and an upper bound on the category side (the inventory is not split by category).
* **No `recompute-completeness`**, so the ledger's `required_slots_stored` (5,326) still reflects the profile as
  it was before today; `at_nothing_known` (5,418) is the new shape. Closing that gap is a run, not a cup.
