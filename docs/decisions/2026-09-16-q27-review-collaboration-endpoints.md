# Q-27 review: collaboration-endpoints, all 100 rows (16 Sep 2026)

100 proposals in 24 evidence groups — the most varied category in the queue, and the one where the *word* rules do
most of the work (41 of 100) rather than the number rules.

> **75 accept · 25 refuse.**

## Accept — 75 rows

The largest group is the cleanest in the whole queue. **23 rows** whose names Cisco itself prefixes with the series:

```
PWR-CORD-EUR-E    "MX - Pwr cable Euro 5m"
PWR-CORD-JP-E     "MX - Pwr cable Japan 5m"
PWR-CORD-ZAF-E    "MX - Power Cable for South-Africa"       … 22 more country variants
```

These are MX power cables by the vendor's own naming and belong on the MX series page. (One row in the group,
`CAB-DIN-BRL-1.05M-`, names **MX600** — a model the series `TelePresence MX (MX200 / MX300 / MX700 / MX800)` does
not list. Still an MX part; flagged in case the series should carry MX600.)

The rest are straightforwardly right, each row naming its target:

| rows | → series | on |
| --- | --- | --- |
| 7 | TelePresence MX | "4-PIN MINI DIN, 0.3 meters for **MX700**", "Ski for Floor Stand Kit" |
| 4 | TelePresence MX | "…0.65 meters for **MX800**" |
| 7 | Headset 500 | "optional accessory for **530** Series" / "for **560** Series" — the widening to `5xx` is doing exactly its job |
| 7 | Room Panorama | "Room Panorama Wall Structure", display cavity springs, internal power cable |
| 3+3 | TelePresence SX | "SX 3.5mm ster. jack…", "Audio Cable Quad Camera to **SX80**" |
| 3 | Unified Wireless IP Phone 7920 / 7921 / 7925 / 7926 | "AC Power Cord … for Cisco Unified Wireless IP Phone **7920/7921G**" |
| 3 | Unified IP Phone 7900 | "power transformer for the **7900** phone series" |
| 3 | Room Navigator and Touch 10 | "**Touch** PoE power injector" |
| 2 | DX70 / DX80 | "HDMI/USB grey cable for Cisco Webex **DX80**" |
| 2 | TelePresence MX | "Ethernet cable for **MX300**" |
| 2 | Room Panorama | "Table Mount for Ethernet Switch **Panorama**" |
| 1 each | microphones, Webex Board, Codec Plus | "Cisco **Ceiling** Microphone optional cable", "Cisco **Webex** Board Pen Kit", "**Codec Plus** and Room 70-codec NAL label" |

**Two flagged**: `CP-DX-CORD=` is a *"Spare Handset Cord for Cisco IP Phone 8800, **DX600 Series**"* and
`CP-DX-HS-NB=` is *"Replacement Narrowband Handset for Cisco **6800 and 7811**"* — each names two products and is
placed in one, the same shape as the eight two-series heat sinks flagged in servers.

## Refuse — 25 rows

### A standards number read as a platform — 11 rows, and this is a new cause

```
PWR-CAB-CHN-0.6M   "Internal C13-C14 Power Cord for China, IEC60320, 3x18 AWG"
                   -> TelePresence MXP (1700 MXP / Integrator Package 6000 MXP)      on 6000, from IEC603 20
   … 8 rows, every one a China power cord

CTS-PWR-AIR-INJ5   "Power Injector (802.3af)"
                   -> TelePresence MX (MX200 / MX300 / MX700 / MX800)                on 800, from 802 .3af
   … 3 rows
```

**IEC 60320** is the connector standard every appliance cord in the world is built to, and **802.3af** is the IEEE
standard for Power over Ethernet. Neither is a product. This is the third standards-number false positive tonight —
the mis-filed-row sheet found `IEC 320` naming **MS320** in switches — so the class is now: *`IEC` and `802`
numbers, in power and cabling parts, matched by a widened platform token.* It is worth its own guard because both
prefixes are literal and short.

### The Avizia clinical carts — 8 rows

`AVIZ-CA750-*` (6) and `AVIZ-CA300-*` (2) proposed for TelePresence MX on `CA750` → `7xx` and `CA300` → `3xx`.
Refused by the prepared [model-letter fence](2026-09-16-the-model-letter-fence-prepared-not-applied.md), and the
mapping already records these as SKU-placed in TelePresence (legacy) shared parts.

### The Brazilian power cords — 4 rows

`PWR-CORD-BZ-A` *"Brazil Power Cord **EL223**, EL701B, 250V, 10A, 2M"* → TelePresence MX on `223` → `2xx`. Also
refused by the letter fence (`L` vs `MX`).

### A generic English word inside a series name — 2 rows

```
CAB-HDMI-MULT-9M  "Presentation Cable (HDMI to Multi (USB-C, Mini-DP and HDMI))"
                  -> Room Kit (Kit / Mini / Plus / Pro / EQ)        on the word "Mini", from Mini-DP
CTS-VX-EDUCATOR-K9 "VX Educator package"
                  -> TelePresence MXP (1700 MXP / Integrator Package 6000 MXP)   on the word "Package"
```

This cause cuts both ways and that is why it cannot simply be banned: **Codec**, **ceiling**, **Touch**, **Panorama**
and **Webex** are words in series names too, and all five produced correct accepts above. What separates them is
that `Mini` and `Package` are qualifiers *within* a longer series name — `Room Kit (Kit / Mini / Plus / Pro / EQ)`
means the Mini variant of a Room Kit, not anything called Mini — whereas `Panorama` and `Codec` carry the product's
identity. A rule would have to know which words of a series name are the name and which are the variant list.

## Where this category differs

Numbers still cause almost every refusal — **23 of 25**, against 101 of 108 in servers — so that finding survives a
category built differently. What is new is the other side of it: collaboration's series are named with words
(`Room Panorama`, `Codec Plus / Pro / EQ`, `Room Navigator and Touch 10`), so **41 of its 100 proposals rest on a
word, and 39 of those 41 are correct**. On this evidence the word rules are the strongest discriminator in the
queue and the number rules the weakest, which is the reverse of how `strongest` ranks them — an exact digit token
scores 3 and a word of the series name scores 1.

That ranking is worth re-examining on the back of the two reviews together: in
[hyperconverged](2026-09-16-q27-review-hyperconverged-infrastructure.md) a 240 GB capacity outranked the `HCIX`
prefix that actually identified the product, and here a 95%-accurate word rule sits below the rule responsible for
23 of 25 errors.
