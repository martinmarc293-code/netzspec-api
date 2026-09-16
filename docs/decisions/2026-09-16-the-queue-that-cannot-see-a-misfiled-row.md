# Q-27's check is scoped to one product line, so a row in the wrong line is invisible to it (16 Sep 2026)

`sharedPartsNamedBySeries` asks: *of the series in this row's OWN product line, does exactly one name it?* That is the
right question for a review that promotes a row within its line, and it is the whole of the 800-row Q-27 queue.

It cannot see a row that is in the wrong line at all. The tell came from the letter-fence work: `N20-BBLKD2=` is a
**"UCS C250 M2 and M1 HDD blanking panel"** sitting in the **B-Series** line's shared parts, so the only series that
could ever claim it was `UCS B250` — the wrong answer, reached because the right one was never a candidate.

## Asking the same question across every line of the category

| | |
| --- | --- |
| shared-parts rows on every page | **6,607** |
| named by ANY series in their own line | 908 |
| …by **exactly one**, which is the Q-27 queue | **800** |
| named by exactly one series in **another** line — candidate mis-files | **541** |
| named by series in more than one other line (not a clean finding) | 384 |

The 800 is re-derived here by a different code path than `REVERSE_EXPECT`'s, and agrees.

## The 541 is not a queue yet, and the split says why

| the claim rests on | rows |
| --- | --- |
| a **widened** round number (`200` → `2xx`) | **410** |
| an exact 3–5 digit token | 30 |
| the full series name | 17 |
| a word of the series name | 84 |

410 of 541 rest on the same widening that
[the model-letter sheet](2026-09-16-the-model-letter-fence-prepared-not-applied.md) is about — so the bulk of this
list would be judged on evidence already known to be weak. **All 47 rows of the two strongest bands were read**, and
they are roughly 26 real to 21 false. Reporting 541 as a finding without that would be reporting a number whose
precision I had not measured.

### The real ones look like this

```
AIR-PSU1-770W     "770W AC Hot-Plug Power Supply for 5520 Controller"   in Wireless Antennas and Accessories
                                       -> 5500 (5508 / 5520 / 5540)      (AireOS Wireless LAN Controllers)
AIR-PSU2V2-1200W  "1200W V2 AC Power Supply for 8540 Controller"        in Wireless Antennas and Accessories
AIR-AP-BRACKET-9= "C9130AXE antenna bracket"                            in Aironet Access Points
                                       -> Catalyst 9130AX               (Catalyst 9100 Access Points)
AIR-ACC-KIT1=     "Accessory kit for Catalyst 9124AX (5x ethernet…)"    in Aironet Access Points
UCSX-TPM2-002     (six TPM modules)                                     in UCS X-Series Modular System
                                       -> TPM                           (UCS Server Components)
UCSX-MP-512GS-B0  "Intel Optane Persistent Memory, 512GB, 3200MHz"      in UCS X-Series Modular System
                                       -> Memory                        (UCS Server Components)
```

A power supply whose name states the controller it powers, sitting under Antennas, is exactly the shape this scan
exists to find and the Q-27 check structurally cannot.

### The false ones cluster into three named causes

```
1  the model letter    UCSC-CMA2, UCSC-RAIL2, UCSC-RAIL-2U-I= (5 rows)
                       "Rail Kit for C240, C260 rack servers" claimed by UCS B260 M4 / B460 M4.
                       C260 is not B260 — the prepared letter fence refuses all five.

2  variant codes       CO-10TDL50-X1001=, CO-40TDL40-X1010= … (4 rows)
                       The X1001 / X1010 of a customer-variant transponder read as NCS 1001 / 1010.
                       The optical mapping already records these as "customer-variant CO- transponders".

3  Meraki is a magnet  CAB-AC-250V/13A "…IEC320/C13…"      -> MS320   (IEC 320, a connector standard)
                       CAB-ACC         "…IEC 320, C13…"    -> MS320
                       CAB-SPWR-150CM  "150cm StackPower cable"  -> MS150   (a LENGTH)
                       SSD-120G        "USB3.0 120G SSD storage" -> MS120   (a CAPACITY)
                       Meraki series are named MS<number> with no other word, so any three-digit
                       number in a cable's description names one. The letter fence catches the two
                       IEC320 rows (C vs MS) and NOT the length or the capacity, which have no letter.
```

That third cluster is new and is the `"6 100 GE"` family once more: a length, a capacity and a connector standard
read as platforms. It is also a structural hazard rather than a bug — a series whose entire name is a bare number
has nothing else for the rule to require.

## What I recommend, and what I have not done

**Not built as a standing check.** A check emitting 541 rows at ~55% precision on its best band would be turned off
on its first run, which is the argument `REVERSE_EXPECT` already makes for itself in `tests/layersStanding.test.ts`.

The order that makes it usable is:

1. Settle the widened-number question (the letter fence sheet), which removes cluster 1 outright.
2. Decide whether a series whose name is a bare `MS<number>` may be named by a digit token at all, or needs its
   line's own word (`Meraki`, `MS`) present — cluster 3.
3. Re-run this scan and record it the way Q-27's is recorded: an exact count per category that fails in both
   directions, so it is a review queue that shrinks rather than a report nobody reads.

The 26 real rows found today are worth acting on regardless, and they are named above.
