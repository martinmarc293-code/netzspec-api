# `antenna_gain`: printed, mapped, and refused by its own shape — neither of the two branches

**28 Sep 2026.** `antenna_gain` is required of `antenna` in `wireless` (216 live parts) and holds **zero
facts in the entire catalogue, across every vendor**. The ruling on it was: *"a required cup with zero
facts across every vendor is either unfillable or never extracted, and those need opposite actions…
Measure before ruling — how many print a gain, how many labels the mapper sees for it, how many map."*

Measured. It is **neither** branch, and the third possibility is the one already written down in this
project's own lessons for a different field.

## 1. The sheets print it

Over the 4,254-file cisco-datasheets label inventory (23,651 distinct labels, 143,120 occurrences):

    labels containing "gain":  163 distinct, 555 occurrences

and the two most literally named are **unmapped**:

    14  unmapped   "Antenna Gain"          e.g. "● 2.4G: 0.6 dBi ● 5G: 0.8 dBi"
     8  unmapped   "Antenna gain in dBi"   e.g. "Maximum antenna gain of 4.35 dBi"

## 2. Labels DO map to it

    7 labels -> antenna_gain, 125 occurrences
       54  "Integrated antenna"   e.g. "● 2.4 GHz, peak gain 4 dBi, internal antennas"
       36  "Gain"                 e.g. "Booster (EDFA2-BST2): Up to 24 dB"
       11  "Integrated antennas"  e.g. "● 2.4 GHz, gain 2 dBi ● 5 GHz, gain 4 dBi"
        9  "Antenna"              e.g. "● 2.4 GHz: 1.9 dBi peak gain ● 5 GHz: 3.x dBi"
        7  "Peak Gain"            e.g. "6 dBi"
        4  "Integrated Antenna" · 4 "Integrated Antennas"

So "no label maps" is false: 125 occurrences reach the cup.

## 3. The cup refuses every value it is handed — `STRUCT_UNPARSED`

    antenna_gain: { type: "struct", unit: "dBi", shape: "{ band24: n, band5: n }" }

Through the real `normalizeField("wireless", "antenna_gain", …)`:

    REFUSE STRUCT_UNPARSED  <= "6 dBi"
    REFUSE STRUCT_UNPARSED  <= "● 2.4 GHz, peak gain 4 dBi, internal antennas"
    REFUSE STRUCT_UNPARSED  <= "● 2.4G: 0.6 dBi ● 5G: 0.8 dBi"
    REFUSE STRUCT_UNPARSED  <= "Maximum antenna gain of 4.35 dBi"
    REFUSE STRUCT_UNPARSED  <= "● 2.4 GHz, gain 2 dBi ● 5 GHz, gain 4 dBi"
    REFUSE STRUCT_UNPARSED  <= "4.35"

**It refuses the exact two-band form its own shape declares.** There is no parser behind the struct
branch — which is this project's own recorded defect, verbatim, in a different field:

> *"A required field that nothing can ever fill is a permanent gap, not a recorded one. `ports` was
> marked required for switches and its struct branch ended in `STRUCT_UNPARSED: needs a dedicated
> parser` … every switch reported a gap on the one specification a switch is bought for, no extraction
> could ever close it, and it was quietly the single largest normalise rejection in the pipeline."*

Same shape, same consequence: 216 antennas carry a gap on the one specification an antenna is bought
for, and no amount of extraction or mapping can close it.

## The answer, and what the first job actually is

**It stays required** — the ruling's own test, since the sheets plainly print it. But the first job is
**not a mapper job with a count**: it is a **struct parser** for `{ band24, band5 }`, accepting only
what the source states outright and refusing everything ambiguous, with the refusals tested as hard as
the successes. Mapping `"Antenna Gain"` and `"Antenna gain in dBi"` comes after it, because until the
parser exists those two labels would map to a cup that refuses them.

Its exclusion from the 22-row cup table (routers' `antenna`, 88 parts) stands until the parser lands.

## One hazard to fix WITH the parser, not after it

`"Gain"` — 36 occurrences — maps globally to `antenna_gain`, and its samples are **optical amplifier**
gains in dB: `Booster (EDFA2-BST2): Up to 24 dB`. The alias file knows this and scopes an
optical-networking rule ahead of the global one, so it is contained *there*. But the moment a struct
parser exists, the global rule will store an EDFA's dB as a wireless antenna's dBi anywhere else it
appears. The parser must refuse a bare `dB` value for a `dBi` cup.

## A methodological note, because my first measurement was wrong

The first run called `normalizeField("antenna_gain", value, …)` and got `UNMAPPED_HEADER` on all six
values. The signature is `(category, key, raw)`, so `"antenna_gain"` was being read as the *category*
and the value as the *key* — the right conclusion for the wrong reason. The tell was on screen:
`UNMAPPED_HEADER` means *no dictionary entry for this key*, about a key whose full entry the line above
had just printed. A guard called with the wrong shape answers the way you were hoping.
