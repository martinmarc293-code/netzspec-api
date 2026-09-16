# Q-27 — the reverse label check, run everywhere (16 Sep 2026)

The operator's Q-27, after the runs: *"A name-rule pass for the 73 collaboration rows whose name alone names one series
(A10 verify 2), and the same scan elsewhere (B2)?"*

B2's point is the one that matters: **a hard SKU catch-all into shared parts is invisible to every check.** A rule like
`^CP-` → "IP Phones shared parts" places HARD, so the label check never judges those rows, and the device check sees only
device kinds. Collaboration's round ran a reverse scan by hand and moved 189 rows out. Nobody had run it anywhere else.

## The scan

`sharedPartsNamedBySeries` (src/core/layerChecks.ts). For a row sitting in a line's shared parts, would any SIBLING series
of that line keep it on its own evidence? It **calls `labelEvidence`** rather than re-implementing it, so the token
strength is exactly the forward check's — `sku-token` or `name` only, never `family` (too weak to name one series) and
never `compatible` (the built rows carry no relations).

**Exactly one winner is required**, and that needs no rule of its own: `labelEvidence`'s rival logic already returns
"none" when two series name a row as specifically, which is the collaboration round's own *"parts named for two products
stay in shared parts"* (CAB-SX80-IPQC "Quad Camera to SX80", CP-DX-HS-NB "for 6800 and 7811").

## The measurement — 6,607 shared-parts rows, 805 named by exactly one series

| category | shared-parts rows | named by one series | share |
| --- | ---: | ---: | ---: |
| servers-unified-computing | 2,196 | **264** | 12.0% |
| hyperconverged-infrastructure | 622 | **109** | 17.5% |
| collaboration-endpoints | 577 | **104** | 18.0% |
| switches | 681 | 98 | 14.4% |
| wireless | 257 | 66 | 25.7% |
| routers | 504 | 46 | 9.1% |
| storage-networking | 137 | 38 | 27.7% |
| hyperconverged-systems | 842 | 31 | 3.7% |
| security | 245 | 27 | 11.0% |
| interfaces-modules | 57 | 11 | 19.3% |
| unified-communications | 17 | 5 | 29.4% |
| video | 458 | 3 | 0.7% |
| optical-networking | 14 | 3 | 21.4% |
| transceiver, meraki | 0 | 0 | — |

Evidence kind: 494 by name, 311 by SKU token. Full list: `D:\tmp\q27-reverse-scan.tsv`.

**The collaboration answer is 104, not 73.** That round moved 189 rows and its own scan was run before the round's new
series existed — Room Panorama (9), TelePresence MXP (9), Headset 500 (7) are series this round created, and 55 more name
TelePresence MX. A scan run once, by hand, before the placement work finished, cannot stay true; that is the argument for
the standing check below rather than for another hand pass.

**The catch-alls B2 predicted, named by the count of rows they place that something else would judge:** `sku ^UCSC-` 152,
`sku ^HC[IO]` 107, `sku ^CSP-` 38, `sku ^NXA-` 37, `sku ^DS-` 34, `sku ^HX` 30, `accessory ^PWR-CORD (label TelePresence
MX Series)` 26, `sku ^UCSB-` 25, `sku ^AIR-(AP…)` 23, `sku ^UCSX-` 21, `sku ^ASA` 21.

## DECISION: it reports; it does not move. And 12 rows say why.

Reading the candidates found a false positive of a class the forward check has never produced: **a STANDARDS number read
as a platform.**

```
CAB-ACU            "AC Power Cord (UK), C13, BS 1363, 2.5m"          -> Catalyst 1300   (BS 1363)
CAB-BS1363-C19-UK= "Cisco CAB-BS1363-C19-UK="                        -> Catalyst 1300   (its own SKU)
PWR-CAB-AC-CHN     "Power Cord for AC V2 Power Module (China), GB2099" -> Catalyst 1000 (GB 2099)
PWR-CORD10-IND     "Power Cord, India, IEC60320/ C19, IS16A3, 7.0M"  -> Nexus 6000      (IEC 60320)
PWR-CAB-CHN-*  (8) "Internal C13-C14 Power Cord for China, IEC60320" -> TelePresence MXP (IEC 60320)
```

12 of the 805. Measured in both directions: **the live forward check keeps 0 rows on that shape today**, so this is not a
defect on the published pages — it is the guard a reverse scan would need before it could ever place anything. 878 live
rows carry `<standards body><digits>` in their name at all, so the prefix list (BS, IEC, EN, UL, CSA, DIN, ISO, ANSI,
NEMA, GB, AS/NZS, SANS, SABS, JIS, CEE, VDE, TIA, EIA) is proposed and **not applied**: adding it to
`NOT_PLATFORM_BEFORE` changes placement on published pages, which is a rebuild, not a check.

## The standing check: a recorded COUNT per category, not a floor of zero

`REVERSE_EXPECT` in `tests/layersStanding.test.ts` holds today's number for each of the 15 reviewed categories. A floor of
zero would be switched off on its first run; a recorded count makes the queue visible and makes a RISE — a new catch-all
placing rows nothing judges, which is exactly B2 — fail immediately, naming the new rows. Each category's next round
drives its number down and the record with it. Both directions fail, so neither drifts silently.

Proved by sabotage: recording 4 for unified-communications instead of 5 gives
`MISS reverse label check unified-communications: … now 5, recorded 4 — new: MEM-243-1X128D -> VG200 / VG202 / VG204 /
VG224 (sku-token 200); …`.

Standing checks **908 passed, 0 missed** (was 893 after Q-26, 869 before).

## What is NOT done here

The 805 rows are not moved. Each is a per-category placement decision of the kind every round has made by reading rows,
and 805 of them is a round of its own — the operator's call on when, and in which order. The two things this block
settles are that the queue is now **measured, everywhere** and that it **cannot grow in silence**.
