# The port count is still the speed — and in two cases the real count is written in words beside it

*16 Sep 2026. MEASURED, NOT FIXED. A core parser used by every vendor's extraction is not something
to change at 4am, and the honest version of this fix refuses values it currently accepts.*

## Why I looked

`CLAUDE.md` records the defect and attaches a warning to it: *"315 of 325 TRANSCEIVERS hold a `ports`
fact claiming more than one port"*, and then *"A PARSER FIX DOES NOT UN-WRITE WHAT IS ALREADY
STORED … the bug report closes, the code is right, and the API keeps returning 315 wrong port
counts."* That is a specific, checkable claim about data being served now.

## The good news, and it is most of the story

**315 → 6.** Only **20** live transceivers hold a `ports` fact at all today, 16 of them with a count
above one, and reading all 16 against their raw strings: **ten are correct** — `CVR-4SFP10G-QSFP`
("4 x SFP10G to QSFP"), `ONS-QC-16GFC-LW=` ("4 X 16G"), `QSFP100GMX2-20-BUN` ("20x100G … Bundle").
Converters and bundles genuinely have more than one. The retraction and the parser work landed.

## The bad news: three of the six are still being PRODUCED

Not stale residue. Today's parser, run on the stored raw strings:

```
CE-10GSFP-SR        -> anzahl 10   "10 Gigabit Ethernet SFP Module"   the SPEED
EXP-10GSFP-SR-MP    -> anzahl 10   same
ONS-SC+-10G-EPXX.X  -> anzahl 15   "SFP+ 15XX.XX, 100 GHz"            the WAVELENGTH
SFP-1G-T-X          -> REFUSED     "1000BASE-T module for 10G-Ports"  (fixed; its row is residue)
```

`15XX.XX` is a shape the earlier write-up did not have: the count taken from a **wavelength prefix**.
So the file's own rule holds again — *a lesson written down is not a fix, and a fix for one phrasing
is not a fix for the field.*

## Sized across the whole catalogue, not just transceivers

Of **2,414** current rendered `ports` facts on live parts, **10** have a count equal to a standard
Ethernet speed with a speed word immediately after it in the raw — switches 4, transceiver 4,
servers-unified-computing 2. Reading all ten, roughly six are wrong. It is a small, bounded residue,
not a systemic collapse.

## The sharpest sub-case: the true count is written in words and ignored

```
N2XX-AMPCI01   stored 10   "Mellanox ConnectX-2 EN with DUAL 10GbE SFP+ ports"
C3KX-SM-10G    stored 10   "Service Module with TWO 10GbE SFP+ ports"
```

The correct answer — **2** — is in the string, as a word, and the parser took the digit that is the
speed instead. That is a better statement of the defect than "speed read as count": **the parser
prefers a digit to a written-out quantity even when the digit is a unit.**

## Why I did not fix it: the control refuses a cheap guard

The obvious rule — *a number followed by "Gigabit Ethernet" is a speed* — breaks the commonest
correct case in the corpus. Run against today's parser:

```
 ref   48 Gigabit Ethernet ports            refused (correct)
  40   40 Gigabit Ethernet QSFP+ ports      genuinely AMBIGUOUS
 100   100 Gigabit Ethernet QSFP28 module   wrong
  10   ● 10 x 5G 60W PoE++ ports            CORRECT — 10 really is the count
```

"48 Gigabit Ethernet ports" means forty-eight ports of 1GbE. "100 Gigabit Ethernet QSFP28 module"
means one module at 100GbE. **Same shape, opposite meaning**, and the only tell is that 48 is not a
standard speed while 100 is. "40 Gigabit Ethernet ports" is ambiguous to a human reader too.

So the honest fix is not a discriminator, it is a REFUSAL, and that makes it a strictness trade-off
rather than a bug fix — the category this repo says never to land under time pressure. It would
refuse values currently accepted across switches, which is a decision with a blast radius.

## Recommended, in order

1. **The words rule first, because it is unambiguous and not a trade-off.** A segment carrying a
   count word — `dual`, `two`, `three`, `quad` — next to a digit that is a standard speed should take
   the WORD. No reading of "dual 10GbE SFP+ ports" yields ten. That is a bug fix, it is narrow, and
   it fixes 2 of the 6.
2. **Then the refusal, as a decision with its measurement**: where the count equals a standard speed
   (10/25/40/100/400) and a speed word follows it directly, refuse and record a gap rather than
   guess — *for a field a device is bought on, a confident wrong value is worse than a missing one*.
   Measure the blast radius across all vendors before landing; the suspect population here is 10 of
   2,414, but that filter is deliberately narrow.
3. **Pair either with the retraction**, planned together and not after — the six stored rows do not
   un-write themselves, which is the whole point of the warning that started this.

## Not done

No parser change, no retraction, no database write. Everything above is reproducible from
`src/core/portParse.ts` and the raw strings quoted, which are stored on the facts themselves.
