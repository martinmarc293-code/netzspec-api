# Q-27 review: servers-unified-computing, all 264 rows (16 Sep 2026)

The largest category in the reverse-label queue. **Every row was read**, grouped by the evidence the proposal rests
on — a group of 35 judged from three samples is the sample-as-census defect this project keeps paying for.

> **156 accept · 108 refuse.** The refusals are not scattered: every one of the 108 falls into five named causes,
> and 101 of them come from a number rule rather than from any judgement about the part.
>
> `38 + 46 + 14 + 3 + 7 = 108`, and `156 + 108 = 264`.

| the claim rests on | rows |
| --- | --- |
| an exact 3–5 digit token | 148 |
| a **widened** round number (`200` → `2xx`) | 57 |
| a word of the series name | 42 |
| the whole series name | 17 |

## Refuse — 108 rows, five causes

### 1. `CSP` names the LINE, and its line has only one series — 38 rows

Every `CSP-` prefixed part is proposed into **CSP 5000**: CPUs, DIMMs, power supplies, NICs, RAID controllers, an SD
card, a TPM. The reason is structural. `labelEvidence`'s rival rule returns *none* when two siblings are named
equally well, and that is what normally stops a family prefix from placing a generic part — but the line
**Cloud Services Platform** holds exactly one real series:

```
LINE: Cloud Services Platform
   series: 'CSP 5000'
   series: 'Cloud Services Platform shared parts'
```

With no sibling, there is nothing to disagree, so the bare prefix wins by default. **Two rows disprove the proposal
outright**, and they are the proof this is not a matter of taste:

```
CSP-PSUV2-1050DC   "1050W V2 -48 VDC Power Supply for CSP 2100 1RU appliance"
CSP-TPM2-002=      "Trusted Platform Module 2.0 for CSP 2100"
```

**CSP 2100 is a real Cisco product and the mapping does not hold it.** These parts are shared across CSP 2100 and
CSP 5000, which is exactly what "Cloud Services Platform shared parts" means — they are already filed correctly.

Three more in the same family come from the *number* rather than the prefix, and are worse: `CSP-CPU-5120` and
`CSP-CPU-I5220` match `5000` widened to `5[0-9]{3}` — those are **Intel CPU model numbers** — and
`CSP-SD960GM1X-EV` matches on **"Micron 5100"**.

**Sized across the catalogue: 40 of 116 product lines hold exactly one real series**, and 50 of the 800 queue rows
come from one. Any line in that shape makes its own family prefix a winning token.

### 2. A drive, GPU or NIC model number read as a platform — 46 rows

```
UCSC-NVMEHW-H800    "800GB 2.5in U.2 HGST SN200 NVMe…"       -> UCS C200 / C210 / C250 / C260   (SN200)
UCSC-NVME-H64003    "…6.4T HGST SN260 NVMe…"                 -> UCS C200 / C210 / C250 / C260   (SN260)
UCSB-NVMEHW-H3800   "…HGST SN200 NVMe…"                      -> UCS B200                        (SN200)
UCSC-GPU-H200-NVL1  (NVIDIA H200)                            -> UCS C200 / C210 / C250 / C260
UCSC-GPU-MI210      "AMD Instinct MI210:300W, 64GB…"         -> UCS C200 …  and  UCS X210c
UCSC-P-V5D200G      "Dual port 40/100/200G PCIe for C-Series" -> UCS C200 …  (a SPEED)
UCSC-GPU-P4-CH      "Nvidia P4 (PG414-200), PASSIVE, 75W"    -> UCS C200 …  (a board code)
```

### 3. A unit — voltage, capacity, connector, battery type — read as a platform — 14 rows

```
UCSC-PSU2-1400W   "1400W AC Power Supply (200 - 240V) 2U & 4U C Series"  -> UCS C200 …      a VOLTAGE RANGE
UCSV-HDD250G1F111= "250GB 6Gb SATA 7.2K RPM 2.5 HDD"                     -> UCS C200 …      a CAPACITY
UCSB-NVMEHW-I2000 "2TB 2.5in U.2 Intel P4600 NVMe"                       -> UCS 2000 IOM    a CAPACITY code
UCSB-RAID-2208CV  "Flash-backed write cache for LSI 2208R"               -> UCS 2000 IOM    an LSI CHIP
N20-MBLIBATT=     "Replacement Battery for Server Motherboard (CR2032)"  -> UCS 2000 IOM    a BATTERY TYPE
CAB-C19C203M-JP-D (a C19-to-C20 3 m power cord)                          -> UCS C200 …     a CONNECTOR + LENGTH
```

`CR2032` naming the UCS 2000 fabric extenders is the clearest single row in the queue.

### 4. The model letter is discarded — 3 rows

```
A04-BTHP3=   "Replacement Thermal Pad for UCS B440/B230"   -> UCS C200 / C210 / C250 / C260   (B230, not C2xx)
N20-BBLKD2   "HDD slot blanking panel for UCS C210/250"    -> UCS B250                        (C250, not B250)
N20-BBLKD2=  "UCS C250 M2 and M1 HDD blanking panel"       -> UCS B250
```

All three are refused by the prepared
[model-letter fence](2026-09-16-the-model-letter-fence-prepared-not-applied.md). `N20-BBLKD2=` is also filed in the
wrong **line** — see [the mis-filed-row sheet](2026-09-16-the-queue-that-cannot-see-a-misfiled-row.md).

### 5. A word of the series name that does not mean the series — 7 rows

```
UCSX-ML-V5D200GV2  "VIC 15230 2x100G mLOM for UCS X-Series M6 Compute Nodes"  -> UCS X-Series FABRIC MODULES
UCSX-ME-V5Q50G=    "VIC 15422 4x 25G Mezz X-Series w/Secure Boot"             -> UCS X-Series FABRIC MODULES
UCSX-M6-MLB        "UCSX M6 Modular Server and CHASSIS MLB"                   -> UCS X9508 chassis
```

A mLOM or mezzanine card is a **compute-node** adapter, not a fabric module; `X-Series` is the line's word, not that
series'. The two `MLB` rows are Major Line Bundles matched on the word *chassis*.

## Accept — 156 rows

These groups are clean on reading every member, and each row's own name or SKU states the series:

| rows | → series | on |
| --- | --- | --- |
| 22 | UCS C240 | every name says C240 (cables, CMAs, GPU power cables, rails) |
| 15 | UCS C460 / C480 | every name says C460 M4 (bezels, heat sinks, memory riser, rails) |
| 13 | UCS C200 / C210 / C250 / C260 | every SKU ends `-C260` and every name says C260 |
| 14 | UCS C240 | SKU-encoded `240` risers, cables, M.2 extender, supercap cables |
| 12 | UCS C220 | C220 cables, CMAs, rails (see the VSPEX note below) |
| 9 | UCS X210c compute node | "UCS 210c M6", "X210c-M6" |
| 12 | UCS C420 M3 | air baffle, SD cards, SAS cables, VIC brackets (`-C420` SKUs) |
| 10 | UCS C460 / C480, UCS C480 M5 | C460 thermal pad, 300 W AMD cable, RAID controller, C480 rails |
| 6 | UCS C125 / C4200 | "UCS C125 OCP … adapter panel" |
| 5 | UCS B420 / B440 / B460 / B480 | "for UCS B440 Blade Server" |
| 4 | UCS B260 M4 / B460 M4 | "for UCS B260 M4 & B460 M4" — the series covers both |
| 4 | UCS C220 | RAID mezz "for C220", supercap cable |
| 2 each | B22 M3, B250, B230, C240, Memory, 5108, C210, X9508, XE9305, X580p | full series name or an exact platform token |

### Two things to flag inside the accepts

**Eight rows name TWO series and are placed in one.** `UCSB-HS-01-EP` is a *"CPU Heat Sink for UCS B200 M3 **and
B420 M3**"* and goes to **UCS B200**; `N20-BHTS1` is *"for UCS B22 M3 **and B200 M1/M2**"* and goes to **UCS B22
M3**. The rival rule did not refuse them because the full series name scores 9 while the sibling matches on digits
at 1–2, so strength decides rather than ambiguity. That is defensible, but a heat sink fitting two blades is a
shared part by construction, and the stronger match is winning an argument it should arguably not be in.

**Four VSPEX rows are bundles, not parts.** `UCSC-VSPEX-M100` is *"UCS EZ VSPEX M100 /w2x5548, **4xC220**,
8x600GB"* — a rack of four C220s plus two Nexus 5548s, proposed into UCS C220 because it mentions C220. Accepting
puts a whole solution bundle on a server's parts page. My reading is that these belong in shared parts, and they are
listed here so the call is visible rather than buried in a count.

## What this category says about the queue as a whole

Of the 108 refusals, **101 come from a number rule and 7 from a word rule**, and not one comes from a row being
genuinely ambiguous about which server it belongs to. The queue's precision is a property of the digit matching, not
of the review.

The prepared [model-letter fence](2026-09-16-the-model-letter-fence-prepared-not-applied.md) removes cause 4 and a
large part of cause 2 mechanically. **Cause 1 needs a rule of its own**: a one-series line has no rival by
construction, so no amount of letter-fencing touches it. The narrow form would be that *a token which is also the
line's own name or prefix cannot by itself place a row* — `CSP` names the Cloud Services Platform line, so it can
never discriminate between that line's members, whether it has one member or ten. That is worth measuring across
the 40 one-series lines before anyone writes it.
