# Q-27 review: wireless (65) and routers (46) — and an alias keyed by a bare number (16 Sep 2026)

> **wireless 57 accept · 8 refuse** — every refusal a generic **word**, none a number.
> **routers 32 accept · 14 refuse** — two new number causes, plus a latent defect in `LABEL_ALIASES`.

## wireless — 57 accept, 8 refuse

Wireless is the mirror image of switches: there, every refusal came from the widened number and every word was
right. Here **all eight refusals are words** and every number is right.

**Accept (57)** — Catalyst 9800-80 / 9800-40 / 9800-L modules and supplies named by the full series (14); CW9172H,
CW9179F, CW9163E, CW9174E accessories on exact model numbers (13); AP-702 / AP702W brackets, AP1100/AP1131/AP1140
mount kits, AP-700 and 1200 Series kits on widened numbers that are doing their job (12); AP1540 / AP1560 covers and
solar shields (4); and 14 Meraki indoor antennas.

*Flagged:* the 14 Meraki rows match on the word **indoor** in the series `Meraki MR indoor`. They are genuinely
Meraki indoor antennas, so the page is right, but the evidence is a **variant qualifier** — the same shape as `Mini`
in collaboration. Their names say "for MR42E / MR46E / MR53E", so if a Meraki antenna series is ever added they
should move to it.

**Refuse (8)**:

```
AIR-AP-BRACKET-1  "Low-profile access point mounting bracket"   -> Aironet 1310 outdoor access point / bridge
AIR-AP-BRACKET-8  "Bracket for Cisco Catalyst 9105i access point mounting"      … 6 rows, all on the word "point"
AIR-AP-BRACKET-3= "802.11n AP In-Ceiling Mounting Bracket"      -> Aironet 700 / 802 / 852 / … on "802"
AIR-VPN-WLC       "VPN/enhanced security module for 4100 Series WLAN controller" -> WLC + access point BUNDLES
```

The six `point` rows are the sharpest example of the generic-word cause in the whole queue: the series name
`Aironet 1310 outdoor access point / bridge (legacy)` contains the **category noun** "access point", so every access
point bracket in the category matches it — including one whose own name says it is for a **Catalyst 9105i**.

`AIR-AP-BRACKET-3=` is the standards cause wearing its worst disguise: the series really does contain a model called
**802** (the Aironet 802), and the part really does say **802**.11n. Nothing about the match is malformed.

## routers — 32 accept, 14 refuse

**Accept (32)** — rack kits "for 8010 Series Router" → Cisco 8000 (7); ISR 4330/4350/4450 memory and slot covers
(6); WPAN antennas → IR 500 WPAN (5); LoRa antennas → Wireless Gateway for LoRaWAN (2); Catalyst 8200 and NCS 5500
by full name (4); `ASR1013` cord retention → ASR 1000 (2); Cisco 3925–3945E shields → ISR 3900 (2); NCS 6008 lift
bracket → NCS 6000 (2); CGR 2010 terminal cover (1); a FIPS shield naming Cisco 1905/1921 → ISR 1900 (1).

**Refuse (14)**, including two causes not seen before tonight:

```
NEW — a radio FREQUENCY read as a platform (3 rows)
ANT-LPWA-DB-O-N   "Outdoor omni-antenna, 863-928 MHz, 6 dBi, type N connector"  -> IR 800   on 863

NEW — an SAE standard read as a platform (3 rows)
OBD2-J1939Y1-MF4  (SAE J1939, the vehicle CAN-bus standard)                     -> CGR 1000 on 1939
OBD2-J1962YA-MF4  (SAE J1962, the OBD-II connector standard)                    -> CGR 1000 on 1962

an antenna's own model number (4 rows)
3G-ANTM1916-CM    "Multi-Band Omni-Directional Antenna - Ceiling Mount"         -> ISR 1900 on 1916

a CPU model number (2 rows) — the same cause as the CSP CPUs in servers
XRV-CPU-5120      (an Intel 5120)                                               -> ASR 5000 and 5500
XRV-CPU-E52667E   "3.20 GHz E5-2667 v4/135W"                                    -> ASR 5000 and 5500

an alias that means a different product family (2 rows) — see below
CAB-N5K6A-NA      "Power Cord, 200/240V 6A, North America (2.5 meters)"         -> NCS 5000 on "N5K"
```

`ANT-LPWA-DB-O-N` deserves a line of its own: **863–928 MHz is the LPWAN radio band**, and the `863` in it is read
as a platform in the `IR 800` family. A frequency is a unit like a wattage, and `NOT_PLATFORM_AFTER` already fences
`W`, `KW`, `VA`, `MHZ` — but here the number is followed by `-928 MHz`, so the unit is attached to the *other* end
of the range and the fence never sees it. **A number that is the low end of a range whose high end carries a unit is
a measurement, not a platform.**

## The alias leak: `LABEL_ALIASES` is keyed by a bare number

`CAB-N5K6A-NA` is a **Nexus 5000** power cord and `N5K` is the Nexus 5000 abbreviation, so how did it reach
`NCS 5000`? The alias table is keyed by the number, not the series:

```ts
"5000": ["N5K"], "5500": ["N55"], "5600": ["N56"], "3000": ["N3K", "3K/9K"], "2000": ["N2K"], "6000": ["N6K"],
"6500": ["C65", "C6K", "S720", "SUP720", "SUP2T", "SUP32", "WS-X6", "WS-F6", "DFC3", "DFC4", "CEF720", "MSFC", "CATALYST 6000", "C6X0"],
```

and `strongest` looks them up by `digitTokens(text)`:

```ts
const keys = [text, ...digitTokens(text), ...text.split(/[\s/()]+/)];
for (const k of keys) for (const a of LABEL_ALIASES[k] ?? []) { … }
```

So **every series whose name contains 5000 is offered `N5K`**, whether it is a Nexus or not. Measured across the
mapping: of 527 real series, **45 non-Nexus series inherit a Nexus or Catalyst alias this way.** The worst:

```
UCS 6500 Fabric Interconnects   inherits  S720, SUP720, SUP2T, WS-X6, MSFC, CATALYST 6000, DFC3 …
IPS 4300 / 4500                 inherits  X45, C45, WS-X4, C4K          (Catalyst 4500 line cards)
Desk Phone 9800 (9811 - 9871)   inherits  N9K-C98, N9K-X98, N9800
ASA 5500 / ASA 5500-X           inherits  N55                            (Nexus 5500)
TelePresence IX5000             inherits  N5K
NCS 2000, Meeting Server 1000 / 2000   inherit  N2K
```

**Sized honestly, the present cost is small.** A series that *can* inherit an alias is not a row placed by one:

| | |
| --- | --- |
| Q-27 proposals resting on a number-keyed alias | 7 |
| …of those, on a non-Nexus/Catalyst series | **2** (the `CAB-N5K6A-NA` pair) |
| rows **already placed on a page** by such an alias | 7 |
| …of those, on a non-Nexus/Catalyst series | **0** |

So this is a landmine rather than a fire, and it should be reported as one: two wrong proposals today, nothing
published wrong, and 45 series exposed the moment a part mentioning `SUP720` or `WS-X4` enters a category that holds
one of them. The fix is small — key the aliases by series name, or scope each entry to the line it belongs to — and
it is worth doing precisely because the exposure is broad while the blast radius is currently zero, which is the
cheapest moment to change anything.
