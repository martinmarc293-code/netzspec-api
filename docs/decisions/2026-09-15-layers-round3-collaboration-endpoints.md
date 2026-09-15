# Layers round 3 — collaboration-endpoints — 15 Sep 2026

**Status: rules committed at `9e39957` + `7098042`, pages rebuilt at `7098042` (`uncommitted_rule_files: []` on all 17 pages).** Worked
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the claimant groups earlier rounds recorded
against collaboration-endpoints, the UC round's SPA302D arrangement, the round-3 adjustments (device kinds, per-category expectations,
family layer with reasons).

## The page, before → after
| | at `82fe3c0` (built at `0eecef0`) | at `7098042` |
|---|---|---|
| rows | 2,835 | 2,835 |
| layered / not-this-category / pending plan / unplaced | 2,818 / 0 / 17 / 0 | 2,817 / 0 / 18 / 0 |
| lines / series | 9 / 58 | 9 / 60 |
| rows in a line's shared parts | 826 | 577 (578 at `9e39957`; `7098042` moved CP-800-USBCH= to Wireless Phone 840 / 860 — corrected 15 Sep 2026, re-audit E-6) |
| whole devices (DEVICE_KINDS) in shared parts | 98 (video-codec 36, video-device 21, camera 19, microphone 11, expansion-module 6, display 5) | 3, each decision pending |
| label check | not applied | applied: 46 judged — 19 kept (12 SKU token, 7 name), 27 moved to their line's shared parts; 0 held |
| families | not assigned | none: `family_layer: "assigned"`, "—" 2,239, shared across the line 577 (see the row above) |

## What changed
- **Family layer:** `family_layer: "assigned"`; Cisco names the Headsets, the Desk / Board / Room Series products, the cameras, the legacy
  TelePresence systems and each IP phone series directly under the product, so every line of 3+ series carries a `no_family_reason` (7) and
  `FAMILY_EXPECT none`. Webex Share and Media Engines has two series and needs none.
- **The device check reached the endpoints.** `DEVICE_KINDS` gains the rest of collabKind's COLLAB_ENDPOINT: video-device, video-codec,
  dect-base, camera, microphone, speaker, headset, touch-panel, display, expansion-module. It named 98 rows in shared parts, placed by SKU
  rules naming their product: Desk Pro (`^CS-DSKPRO`), DX70 / DX80 Webex spares (`^CS-DX`), Room Kit Pro G2 / EQX / Room USB, the Room Codec
  Plus / Pro PIDs, Room Panorama 85 and its quad camera, Room 55 main units, SpeakerTrack 60 kit and array, Precision 40, Performance
  Microphone 20, MX cameras and codec, SX10, IX5000 monitors, C-series ATP codecs and QuickSet C20, 8831 / 8832 microphones, 8800 key
  expansion modules. Two new series, each a product Cisco sells under that name: **Desk Camera** (4K / 1080p) and **TelePresence MXP
  (1700 MXP / Integrator Package 6000 MXP)**; the Precision series gains Precision 40.
- **Accessories whose PID names their product** (read off a reverse scan: rows in shared parts whose SKU carries one series' token):
  the 7920 / 7921 / 7925 / 7926 batteries, cases, chargers and supplies (`^CP-.*792x`, 76 rows), the 8821 ones (`^CP-.*8821`, 41), the 6900
  wall-mount kits, the Wireless Phone 800 charger (`^CP-800-`), MX NAL labels / ATP demo units / speaker cables, SX10 / SX20 brackets, cables
  and NAL labels, Room Panorama speaker cables, the Room Kit EQX speaker cables, Codec Plus 2 antennas, Room 55 and DX70 / DX80 NAL labels,
  the Touch 10 / Navigator cables and Room USB Touch 10 kit, PTZ 4K and Quad Camera brackets, SpeakerTrack 60 short cables, Board 85 frame
  and Board S pen kit, Spark Board parts (`^SPBOARD-`), Desk Camera cables. Parts named for two products stay in shared parts
  (CAB-SX80-IPQC "Quad Camera to SX80", CS-BRD-PENKITSOFT, CP-DX-HS-NB "for 6800 and 7811").
- **The label check, read row by row.** Kept wrongly on a number that is not a platform: the Avizia CA300 / CA750 clinical carts
  (SolutionsPlus) sat in TelePresence MX because CA300 matched the MX300 token and CA750 the 7xx models of MX700 — now SKU-placed in
  TelePresence (legacy) shared parts beside AVIZ-EDU / SYN / TAC; AVIZ-MXCART= "Avizia MX Cart" names MX and stays. Split by wording:
  PA100-AS "Power Supply for Linksys VoIP Products" moved to shared parts while its four plug siblings name SPA500 — `^PA100-` keeps the one
  supply in SPA500. Kept in one series while naming several: MB100 "Wall-mount brackets for SPA 300, SPA 500, CP 500, and SPA 900" →
  IP Phones shared parts. Contradicted by this round's own series name: "Desk Camera (4K / 1080p)" made 1080 a platform token and moved
  ACC-PHD1080P= "Cable Accessories Kit for PrecisionHD Camera 1080p12x" out of Precision; the series is named "Desk Camera".
- **VXME accessories:** the nine SPVAC-C7416 / H5610 / UC725 rows (names are bare "Cisco <PID>") are listed by Cisco's "Virtualization
  Experience Media Engine Accessories Data Sheet" (c78-702849) → SKU rule on that series, which the label check had emptied.
- **SPA302D:** the empty collab series "SPA302D DECT handset" (kept only to give UC's handsets a dect role) is removed and "SPA300 IP
  Phones" fenced `^SPA3(?!02D)`; deployRole finds no role-bearing collab series for SPA302D and its own `ph.dect` rule gives dect. UC's seven
  rows: deploy_role unchanged (dect), role_rule `series:…` → `ph.dect`. The UC ← collaboration-endpoints claim entry is gone.
- **Claimant fences:** interfaces-modules `^WP-` → `^WP-(?!9821)` (the 17 Wireless Phone 9821 rows); wireless `^PWR-(CAB-(JPN|INT)-|…)` →
  `CAB-(JPN-|INT-0[.]7M)` (the other INT lengths are Room Panorama / Room Kit EQX amp-to-camera cables and TelePresence C13-C14 jumpers);
  the routers ← wireless pending-round entry carries the new rule text. `^CS-ROOM` removed from Webex Room Series shared parts (it decided
  nothing once the Room series rules existed).
- **Plans:** AIR-PWRINJ6 collab → wireless (its spare AIR-PWRINJ6= is there; an Aironet 802.3at injector); CP-BATT-7925G-EXT= servers →
  collab (filed under UCS Fabric Interconnects shared parts by the label "Mini Series"; its base and the 792X battery end-of-sale notice are
  collab's).
- **Checks:** `LABEL_EXPECT collaboration-endpoints exactly 46`; `DEVICE_EXCEPTIONS` (3, decision pending, each still-a-device checked);
  device sabotage on planted rows of the ten kinds against a mount, cable, supply and accessory. productLine: 26 witnesses and 8 refusals from
  real rows.

## Measured
- **Row diffs against `82fe3c0` (the published pages):** switches, routers, transceiver, HCI, HyperFlex, security, video, optical, storage,
  meraki, conferencing, DCN — 0 changes. interfaces-modules 36 and wireless 14 rows: `placed_by` rule text only. servers: CP-BATT-7925G-EXT=
  → pending plan. unified-communications: 7 `role_rule` only. collaboration-endpoints: 348 series changes (above), 1 → pending plan.
- **Standing checks** (14 reviewed): **666 passed, 0 missed**. Sabotage: removing `display` from DEVICE_KINDS fails the planted-row case and
  both CTS-LAPT-DISP stale-exception checks; reverting the `^WP-` fence fails productLine's refusal; removing `^AVIZ-CA(300|750)` fails its
  witness (the two mapping files restored from copies and verified byte-identical with `cmp`; layerChecks.ts restored with the Edit tool
  and read back in `git diff`). The mapping sabotage was applied with `sed`, against the house rule for regex text; the restore is proven
  by the byte comparison, and the Edit tool is used for sabotage from here on. productLine 388/0, deployRole 73/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the UC commit's.
- **Cross-claims** 44 → 43 (− the SPA302D entry; the routers ← wireless entry re-keyed to the fenced rule).
- **Not a standing check, measured once:** base / spare pairs filed in DIFFERENT categories (the spare = base check compares rows of one
  page). Over all 17 pages: 278 pairs, **94 with no move plan joining them** — most are the UCS component question already pending
  (servers ↔ HyperFlex ↔ HCI 35 — this record said 44 until the re-audit's E-5 correction of 15 Sep 2026; the pairs file counts 35 —,
  routers → servers 10, servers → security 9, switches → storage 9). List:
  `D:\tmp\cisco-layers-cross-category-pairs-2026-09-15.txt`. The four touching this category are below.
- **Left for a name-rule pass:** 73 rows in collab shared parts whose NAME alone names one series (SKU without a token): MX cables "for
  MX700 / MX800", "MX - Pwr cable" cords, Room 70 / Room 55D HDMI and USB cables, Room Panorama wall structures, the 7920 CAB-AC2 cords,
  NAL labels keyed by TTC code, CS-PWR-CUBE-7 "for Desk Pro". A SKU rule per row was not written this round; the shared parts they sit in
  are the conservative home. (The count includes false readings — "802.3af" as 800, "IEC60320" as 6000.)

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| collaboration-endpoints | class | license | 10 | 10 |
| collaboration-endpoints | class | non_product | 7 | 7 |
| collaboration-endpoints | move | wireless | 1 | 1 |
| servers-unified-computing | move | collaboration-endpoints | 2 | 2 (CIUS-BATTERY=, CP-BATT-7925G-EXT=) |

## Decision pending
1. **CTS-LAPT-DISP / CTS-LAPT-DISP= "TelePresence Laptop Display" and CTS-VX-EDUCATOR-K9 "VX Educator package"** — whole products no
   document ties to a TelePresence series (only the generic collaboration end-of-sale notices name them). Kept in TelePresence (legacy) shared
   parts; recorded in `DEVICE_EXCEPTIONS` and in that series' note.
2. **Generic power cords split across categories:** CAB-AC2 / CAB-AC2E / CAB-AC2UK (base in routers "AC Power cord …", listed by the 800BB
   end-of-sale notice; spare in collab named "… for Cisco Unified Wireless IP Phone 7920/7921G Multi-Charger") and CAB-PWR-C15-CHN-A (base in
   switches Nexus shared parts, spare in collab). Recommendation: leave as filed until the cross-category pair rule is decided.
3. **A cross-category spare = base check** (94 open pairs today, above): add it as a standing check with the known UCS pairs as recorded
   exceptions, or leave it a measurement.
