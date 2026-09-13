# Decision: the 18 free-string required cups (phase-1 close guide §5.4)

**Date:** 13 Sep 2026 · **Measured on:** `e036389`, rebased onto `6651cef` (branch `cisco`, after the §5.1/§5.2
normaliser merge; replay counts identical on both) · **NORM_VERSION** 1.8.0 ·
**Status:** implemented in code, NOT synced. **Carrying commit** (rebuilt ledgers, censuses, traces, completeness
report, freeze file, `sync-dictionary` run id): pending — the parent's merge.

A required cup typed `s` with no domain makes "filled" mean "some string arrived". Each of the 18 cups of
guide Appendix A.1 is decided below: closed, retyped, split, or kept as **free text by decision**. The
recommendations were the reviewer's; where the stored values disagreed, the stored values decided and the
section says why.

## How it was measured

- **Population.** Every current fact on a live part, **all vendors**, with exactly the selector
  `syncDictionaryOn`'s reshape guard uses (`superseded_by IS NULL`, not `retracted:%`, `retired_at IS NULL`,
  `value IS NOT NULL`, non-empty `raw`). Read from production read-only (`application_name` `agent/free-strings`,
  `default_transaction_read_only = on`) on 13 Sep 2026: **7,095 facts** over the 18 keys plus `lte_bands`. No
  fact of any of these keys sat outside that selector.
- **Replay.** Every raw was run through the REAL `normalizeField` of this commit, with the guard's locale rule
  (`hexcat_seed` → `de`, else `en`). *accept-changed* = accepted with a value that differs from the stored one
  (every retype changes the stored shape; the stored `value` keeps the old shape until renormalised);
  *refused* = the guard would count it and the fact becomes a **defect** (guide §3.3), never silently dropped.
- **Zero-fact cups** were checked against the label samples of `runs/vocab/cisco-datasheets/labels.json`
  (23,651 labels), which are the values those cups will receive.
- **A finding that is not a decision but matters to all of them:** stored raws are cut at **160 characters**
  (`ui_languages` 323 of 340, `cellular_bands` 21 of 65, `mounting` 36 of 1,049). A cut list reads as a
  shorter, complete-looking list. It is an extraction defect upstream of this work and is reported, not fixed.

## Summary

| cup | outcome | shape | stored facts | accepted (changed) | refused, by vendor | `--allow-refusing` |
|---|---|---|---|---|---|---|
| `cellular_bands` | close | `ls`, 3GPP bands (236) | 65 | 62 | cisco 3 | **yes** |
| `mounting` | close (**list**, not enum) | `ls`, 10 members | 1,049 | 1,018 | cisco 31 (3 were already refused as placeholders) | **yes** |
| `standard` | close, one domain admitting four families | `ls`, 157 tokens | 3,839 | 2,654 | 1,185: arista 208, juniper 163, dell-emc 149, hpe 135, cisco 130, lenovo 104, extreme 102, nvidia 85, fortinet 58, ubiquiti 37, supermicro 10, aruba 4 | **yes** |
| `ip_rating` | close | `e`, IEC 60529 grid (80) | 9 | 9 | 0 | no |
| `audio_codecs` | retype | `ls` open | 80 | 80 | 0 | no |
| `video_codecs` | retype | `ls` open | 0 | – | 0 | no |
| `ui_languages` | close (data overrode "retype") | `ls`, 34 languages | 340 | 334 | cisco 6 | **yes** |
| `lan_interfaces` | retype | `ls` open | 14 | 14 | 0 | no |
| `wan_interfaces` | retype | `ls` open | 14 | 14 | 0 | no |
| `max_resolution` | close | `struct {w,h}` | 0 | – | 0 | no |
| `video_quality_max` | close | `struct {w,h}` | 9 | 9 | 0 | no |
| `camera_zoom` | retype | `n`, x, [1,100] | 0 | – | 0 | no |
| `field_of_view` | retype (**range**, not number) | `nr`, deg, [1,360] | 11 | 11 | 0 | no |
| `battery_life` | retype (**years**, not hours) | `n`, years, [0.1,30] | 6 | 6 | 0 | no |
| `mic_type` | close | `e`, 4 members | 0 | – | 0 | no |
| `display` | split | `display_size` `n` in [1,120] + `display_resolution` `struct {w,h}`; `display` stays `s`, now optional | 0 | – | 0 | no |
| `image_sensor` | **free text by decision** | `s` | 9 | 9 (unchanged) | 0 | no |
| `cpu` | **free text by decision** | `s` | 1,642 | 1,642 (unchanged) | 0 | no |

New keys: `display_size`, `display_resolution`. Refused facts in total: **1,225** (cisco 170, other vendors 1,055).

## cellular_bands

**Evidence.** 65 facts, all cisco (routers 47, interfaces-modules 14, cloud-systems-management 4), 42 distinct
raws, every one a sentence: `LTE bands 1-5, 7, 8, 12, 13, 20, 25, 26, 29, 30, and 41 FDD LTE 700 MHz (band 12), …`
(9), `LTE band 2 PCS 1900, band 4 AWS (1700/2100), band 5 (850), band 17 (700)` (3), `LTE: Bands 2, 4, 5, 12, 13,
14, 17, and 66 UMTS: Bands 2, 4, and 5`, `… EDGE/GSM/GPRS 900 MHz and 1900 MHz`.

**Outcome.** Close, as recommended. **Shape:** `ls` over `b1…b88` (E-UTRA), `n1…n106` + `n257…n262` (NR),
`umts-b1…umts-b32`, `gsm-850/900/1800/1900`. The parser (`cellularBandTokens`) reads band numbers only inside the
segment their technology header opens, never a frequency (a number followed by MHz), and refuses a band
number outside 3GPP numbering or a reversed range rather than dropping it.

**Refused:** cisco 3 — `850, 900, 1900, and 2100 MHz` (interfaces-modules): frequencies with no technology and no
band number; 850 MHz is band 5, 18, 19 or 26 depending on region. **`--allow-refusing cellular_bands`: yes.**

## mounting

**Evidence.** 1,049 facts: cisco 934, hpe 61, mikrotik 30, aruba 24; 105 distinct raws across 12 categories.
`Desktop` 136, `1U Rack Mount` 68, `Rack Mount` 55, `Ceiling Mount` 48, `The handset is wall-mountable…` 46,
`● DIN rail ● Panel mount` 35, HPE/Aruba `Mounts in an EIA-standard 19 in. Telco rack…` 47. **Many cells name
several** (`Desktop, wall-mount or rack mount` 7, `Desktop / Wall Mount` 12, `● DIN rail ● Panel mount` 35,
`Wall, pole mount` 17), so a single enum would keep one and drop the rest.

**Outcome.** Close, but as a **closed list**, not the recommended enum. **Shape:** `ls` of `rack-19, rack-23,
rack-etsi, desktop, under-desk, wall, ceiling, pole, din-rail, panel`. Every member is named by a stored value.
The proposed `embedded` and `vesa` are named by **no** stored value and are not added. A rack with no stated
width is a 19-inch rack (EIA-310) unless the cell names 23-inch or ETSI. It also fixes a silent defect: the
metric-restatement rewrite had stored `Front and midchassis mountable in a 19 in. (480mm) …` as `"480mm"`.

**Refused:** cisco 31 — `Surface mountable` 15, `● Included with the access point: mounting bracket AIR-AP-BRACKET-8` 4,
`-` 3 (already refused today by the placeholder guard), bare kit PIDs `Default: C84G2-ACCKIT-19[ Options: …]` /
`Default: C85G2-ACCKIT-19 Options: C85G2-4PT-KIT` / `Default: C8500-ACCKIT3R-19` 5, `Faceplate mount` 2,
`● Cable Duct` 1, `● Bracket is included with the access point` 1. **`--allow-refusing mounting`: yes.**

## standard

**Evidence.** 3,839 facts, 12 vendors, 413 distinct raws, in six categories and **four families**:

| category | facts | what it holds |
|---|---|---|
| transceiver | 2,107 | IEEE rate+PMD (`10GBASE-SR`), SONET, OTN, FC, SFF, WDM grid — and media, bare reach codes, cages |
| wireless | 768 | a Wi-Fi amendment: `802.11ac` 624, `802.11n` 109, `802.11ax` 35 |
| video | 690 | the WDM grid: `DWDM` 332, `CWDM` 237, `iWDM`/`IWDM` 121 |
| switches | 188 | a PHY: `10GBase-T` family |
| interfaces-modules | 74 | SONET/SDH `OC-3c/STM-1`, `10BASE-T`, `100BASE-TX` |
| optical-networking | 12 | `DWDM` |

**Outcome.** Close, as recommended, with **one domain that admits all four families** rather than a scoped cup:
each category's family is a legitimate transmission standard, and a per-category domain is invisible to
`field_dictionary`. **Shape:** `ls` of 157 designation tokens, each one stated by a stored cell
(`STANDARD_DOMAIN`): `10gbase-sr`, `1000base-lx/lh`, `100gbase-cwdm4`, `oc-192`, `otu2e`, `2gfc`, `cpri`,
`sff-8431`, `itu-t-g.709`, `802.11ac`, `dwdm`, `400zr`, `openzr+` … An 802.3 amendment is kept only when no
designation is stated. An unseen designation (`800GBASE-SR8`) is refused **by name** and added deliberately.

**Refused: 1,185 facts** — cisco 130, arista 208, juniper 163, dell-emc 149, hpe 135, lenovo 104, extreme 102,
nvidia 85, fortinet 58, ubiquiti 37, supermicro 10, aruba 4. By kind:

| kind | facts | by vendor | examples |
|---|---|---|---|
| a medium, not a standard | 712 | arista 206, dell-emc 102, cisco 81, nvidia 73, lenovo 71, hpe 69, extreme 52, fortinet 33, ubiquiti 25 | `DAC Kabel` 319, `AOC Kabel` 256, `fest konfektioniert (im Kabel enthalten)` 90, `… Active Optical Cable (AOC)` 39, `MPO Kabel`, `nicht enthalten` |
| a bare reach code with no rate | 439 | juniper 163, hpe 66, extreme 50, dell-emc 47, lenovo 33, fortinet 25, cisco 15, nvidia 12, ubiquiti 12, supermicro 10, aruba 4, arista 2 | `BX` 49, `SR` 43, `LR` 30, `LR4` 30, `SR4` 25, `LX` 17, `SX` 16, `T` 15, `LR-DWDM` 10 |
| a cage | 16 | cisco 16 | `CPAK` 12, `CXP` 3, `40GBASE QSFP` |
| a coherent family name, no designation | 14 | cisco 14 | `Digital Coherent Optics (DCO, integrierter DSP)` 11, `Analog Coherent Optics` 2, `100G ZR (kohärent, oFEC)` |
| another quantity or a product name | 4 | cisco 4 | `-40 bis 85 °C`, a whole environmental cell, `Cisco Fabric Extender Transceiver`, `WDM (Receive-Only)` |

The media rows belong to `media` / `dac_type`, and the reach codes are recoverable only together with
`data_rate` (a derivation, phase 2). Almost all non-Cisco refusals are `hexcat_seed` rows, i.e. **other lanes'
facts**: they become those vendors' `defects`. **`--allow-refusing standard`: yes** — and the owning lanes
should be told before the sync, not after.

## ip_rating

**Evidence.** 9 facts, all cisco switches, all `IP20`. Label samples: `IP66`, `IP 66`, `IP40`, `● Outdoor, IP67`,
`● IP40 rated ● IP54 rated with additional IP54-KIT (IR1800-IP54-KIT)`.

**Outcome.** Close. **Shape:** `e` whose domain is the IEC 60529 code grid (first digit 0-6/X, second 0-8/X,
plus ISO 20653 `ip69k`, without `ipxx`: 80 codes). That is the reviewer's pattern expressed as the domain the
dictionary can carry; it admits nothing the standard does not define. A cell naming two ratings (the IP54 kit)
is a capability statement and is refused. **Refused:** 0. **`--allow-refusing`: no.**

## audio_codecs

**Evidence.** 80 facts, cisco collaboration-endpoints, 6 distinct: `● OPUS, G.722, G.722.2, iSAC, G.711(a-law/μ-law),
G.729a/b, and iLBC` 45, `● G.711 (A-law and µ-law), G.722, G.722.2, G.729ab, iLBC, iSAC, OPUS` 16, …

**Outcome.** Retype, as recommended. **Shape:** open `ls`. Two per-key rules were needed for the stored cells to
split correctly: `a-law and mu-law` is one codec (the splitter read "and" as a boundary), and commas and
bullets become semicolons (the splitter's citation rule glued `G.722.2, iSAC` and `G.729ab, iLBC` into one member
on 61 cells). **Refused:** 0. **`--allow-refusing`: no.**

## video_codecs

**Evidence.** 0 facts. "Video standards" 27 label occurrences: `● H.264, H.265, AV1 and H.263 (Presentation channel)`.

**Outcome.** Retype. **Shape:** open `ls` (commas as boundaries, as for audio). **Refused:** 0. **`--allow-refusing`: no.**

## ui_languages

**Evidence.** 340 facts, cisco (collaboration-endpoints 329, routers 10, switches 1), 12 distinct. **323 are cut at
160 characters** (`… Czech (Czech R`). 34 run the languages together with no delimiter (`Arabic (Arabic Area)
Bulgarian (Bulgaria) …`), 11 say `User interface support for English`, 6 say `Support for more than 20 languages
is built in (depends on Cisco Unified CallManager software version).`

**Outcome.** Close — **the data overrode "retype"**: an open list would store the 34 run-together cells as one
member each and the 6 capability sentences as a language. **Shape:** `ls` of 34 languages (`arabic … ukrainian`);
region and script fold into the language (`English (United Kingdom)` → `english`), a recorded loss. Members after
Danish/Dutch come from the rest of the same Cisco phone localisation list the cut cells begin.

**Refused:** cisco 6 (the "more than 20 languages" sentence). **`--allow-refusing ui_languages`: yes.**

## lan_interfaces

**Evidence.** 14 facts, cisco (routers 12, meraki 2): `4-port GE managed switch` 5, `8-port 10/100/ 1000-Mbps managed
switch With 4-port Power over Ethernet (PoE) option` 5, `8 x Dedicated 1 Gigabit Ethernet RJ45 2 x Dedicated 1
Gigabit Ethernet SFP` 1.

**Outcome.** Retype, as recommended. **Shape:** open `ls`. Recorded limitation: 14 of 14 cells become a single
member, so the retype buys the type and not yet the content; the typed form is `ports`' struct
(`list{port_typ, speed, anzahl}`), a phase-2 question. **Refused:** 0. **`--allow-refusing`: no.**

## wan_interfaces

**Evidence.** 14 facts, cisco (routers 12, meraki 2): `2 ports Gigabit Ethernet (GE)` 3, `1 port GE and 1 VADSL (Annex
B/J)` (→ two members), `1 port Gigabit Ethernet or 1 port SFP VDSL/ADSL2+ Annex A/M` 2.

**Outcome.** Retype. **Shape:** open `ls`; same limitation as `lan_interfaces` (11 of 14 single-member).
**Refused:** 0. **`--allow-refusing`: no.**

## max_resolution

**Evidence.** 0 facts. "Resolution" 5 label occurrences: `1280 x 800`, `1920 x 1200`.

**Outcome.** Close. **Shape:** `struct { w: n, h: n }` — the reviewer's `^\d+x\d+$` pattern as two numbers, rather
than an enum of the resolutions that occur (which would refuse a real 2560x1440 the first time one arrived).
Named forms map only where unambiguous (`720p`, `1080p/i`, `1440p`, `2160p`, `4K UHD`, `Full HD`); a bare `4K`
without pixels is refused (UHD 3840 or DCI 4096); several different resolutions in one cell are refused; a
`WxH mm` box is not a resolution. The frame rate is another quantity and is not kept. **`--allow-refusing`: no.**

## video_quality_max

**Evidence.** 9 facts, cisco meraki cameras: `Up to 1080p HD w/ H.264, up to 20fps` 3, `720p HD, up to 15fps` 2,
`4K video recording (3840x2160) …`, `Up to 4.2MP (2058x2058) with H.264, up to 15fps`. The "Video" label (42, video
category) carries `Broadcast, VOD, and SDV` — a wrong pour, now refused at arrival.

**Outcome.** Close. **Shape:** `struct { w: n, h: n }`, parser shared with `max_resolution`. All 9 accept
(1920x1080, 1280x720, 3840x2160, 2058x2058). **Refused:** 0. **`--allow-refusing`: no.**

## camera_zoom

**Evidence.** 0 facts. Label samples: `4x digital zoom`, `2.5x optical zoom (5x with digital*)`, `4x optical zoom
(8x with digital*)`, `12x optical zoom`.

**Outcome.** Retype, as recommended. **Shape:** `n`, unit `x`, band [1, 100]. The cup is the **optical** factor;
a digital-only cell is refused (a crop, not the lens). **`--allow-refusing`: no.**

## field_of_view

**Evidence.** 11 facts, cisco meraki cameras: `Horizontal: 114° Vertical: 61° Diagonal: 132°` 2, `Horizontal: 28° - 82°
Vertical: 21° - 61° Diagonal: 37° - 107°` 2, `43° to 94°`, `96° to 41°`, `12° to 37°`, `Horizontal 12°-37°, Vertical 7°-22°`.
Labels: `23.9 to ~89.9º`, `37.5° to 103.7° (horizontal) 21.6° to 71.2° (vertical) …`, `60°`.

**Outcome.** Retype — **a range, not the recommended number**: 4 of 11 facts (and 2 of 3 label samples) are
varifocal spans, and a number keeps the first end. **Shape:** `nr`, unit `deg` (the house spelling of the angle
dimension since 4 Sep 2026; `°` is read as input), band [1, 360]. The horizontal figure when axes are labelled;
a span in either order is the same span; a cell labelling only vertical/diagonal is refused. All 11 accept.
**`--allow-refusing`: no.**

## battery_life

**Evidence.** 6 facts, cisco meraki MT sensors: `5 Years` 3, `up to 5 Years*` 2, `2 Years` 1. The generated
definition already carried unit `years`.

**Outcome.** Retype — **in years, not the recommended hours**. `years` and `h` are different dimensions in the unit
table, so `h` would have refused all six. **Shape:** `n`, unit `years`, band [0.1, 30]. Headset talk times
("Up to 23 hours") are a different label and are not mapped here. All 6 accept. **`--allow-refusing`: no.**

## mic_type

**Evidence.** 0 facts. "Microphone type" label samples (headsets): `Uni-directional ECM noise-canceling mic`,
`The microphone uplink solution consists of 2 directional Electret Condenser Microphones (ECMs)…`, `● Two MEMS
beamforming microphones …`, `6 MEMS Mic integrated into the earbuds …`, `Electret condenser/ECM`.

**Outcome.** Close. **Shape:** `e` `{omnidirectional, unidirectional, array, beamforming}` — the pickup pattern.
The reviewer's `cardioid` is folded into `unidirectional` (what the sheets say); `integrated` is left out (it says
where a microphone sits, not how it picks up). An element-only cell (MEMS, ECM) is refused: a different quantity
with no cup. **`--allow-refusing`: no.**

## display

**Evidence.** 0 `display` facts. 68 label occurrences ("Display" 39, "Graphical display" 19, …), each stating a
diagonal and a pixel resolution in one cell: `480x128-pixel backlit 24-bit color LCD, 3.9-in. (9.9-cm) diagonal`,
`● 23-inch (0.58m) LCD monitor ● Resolution: 1920 x 1080 (16:9)`; several describe several models (`● 9811:
2.6-inch … ● 9841: 3.5-inch …`).

**Outcome.** Split, as recommended. **Shape:** new `display_size` (`n`, unit `in`, band [1, 120]) and
`display_resolution` (`struct { w: n, h: n }`), both required of the collab screen kinds (`COLLAB_SCREEN`);
`display` stays `s` and becomes **optional**. Each normaliser reads its own quantity from the same display cell,
so a mapper can write one cell to both keys. A multi-model cell is refused by both. On the 13 label samples:
`display_size` 7 accepted / 6 refused, `display_resolution` 6 / 7.

**Fill path — open.** No alias rule writes `display_size` or `display_resolution` yet (alias rules are not in
this change's scope), and `data/schema/source-fields.json` does not list them, so `tests/source-fields.test.ts`
names them until the mapper routes the display labels to both keys and the file is rebuilt.
**`--allow-refusing`: no** (0 stored facts; the keys are new).

**AMENDED BY THE PARENT, 13 Sep 2026, before the sync — `display` stays required as free text by decision; the
split keys enter OPTIONAL.** Two reasons, both measured. (1) A mapper label pours into ONE cup, so no alias rule can
write one display cell to both keys; required, they would be two required cups with no tap, and the phase-1
invariant "no required cup without a fill path" would fail on the day it closes. (2) The reviewer's kind-layer
specification v2 (13 Sep, evening) rule 8: a NEW cup enters as optional and is promoted when its label share over
held parts crosses 50% — its Part III.0 measurement pass produces exactly that table. So: `display` is required of
`COLLAB_SCREEN` and is **free text by decision** (listed in `FREE_TEXT_BY_DECISION`) — "filled" means the display
cell was captured; `display_size` and `display_resolution` are optional, their normalisers ready, promoted by v3.

## image_sensor

**Free text by decision.** **Evidence.** 9 facts, cisco meraki cameras, 5 distinct: `1/3” 4MP (2688x1520) progressive
CMOS` 4, `1/3.2” 5MP (2560x1920) progressive CMOS` 2, `1/1.8” 8.4MP (3840x2160) progressive CMOS image sensor`, …
**Why no domain:** a sensor description combines an optical format, a megapixel count, a native resolution and a
technology; none of the four has a cup and no closed vocabulary covers the combination. "Filled" means a sensor
description was captured, and that is all it means. Recorded in `FREE_TEXT_BY_DECISION`. **`--allow-refusing`: no.**

## cpu

**Free text by decision.** **Evidence.** 1,642 facts (cisco 1,594, hpe 31, aruba 17), 392 distinct — servers 1,582
(`AMD 9575F` 29, `Intel I8480+` 10, …), switches 47 (`Quad Core ARM Cortex™ A72 @ 1.8GHz`, HPE/Aruba), 13 elsewhere.
**Why no domain:** a processor model string with no closed vocabulary; a `cpu_model` normaliser is phase-2 work.
"Filled" means a model string was captured. **Known ambiguity, recorded:** on a server `cpu` names the processor
the server holds; on a CPU part (servers kind `cpu`) the same key is that part's own model — two meanings on
one key. Recorded in `FREE_TEXT_BY_DECISION`. **`--allow-refusing`: no.**

## Sync

`--allow-refusing cellular_bands,mounting,standard,ui_languages` — and nothing else: every other reshaped key
re-reads with zero refusals. The four keys' refused facts (1,225) are this change's defects, listed above by vendor.
