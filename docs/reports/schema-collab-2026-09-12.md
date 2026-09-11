# Schema — collab group (unified-communications, collaboration-endpoints, conferencing), 12 Sep 2026

Branch `cisco-agent/collab` (from 6150146). Database: read-only, `cisco-agent/collab`, 60 s timeout, scoped to
the three categories (12,418 Cisco parts: UC 5,447 / CE 3,222 / conferencing 3,749; hardware 2,928 / 2,902 / 299).

## 1. The kind axis — ONE classifier for three categories (`src/core/collabKind.ts`)

The three share product families (CP-, CS-, CTS-, CAB-, PWR-, CIT/EXP/BE server parts appear in more than one),
so one axis: the same SKU gets the same kind wherever it is filed, which is what exposes misfilings (section 7).
Series is the wrong gate ("Room Series" holds codecs, cameras, 71 cords, 42 HDMI cables). Default `unknown`
asks NOTHING (no device majority exists; the likeliest miss is a licence still classed hardware).
Components run before device families (Cisco puts the family first and the accessory marker later).

Distribution over the real corpus (Cisco hardware, today's classes):

| kind | UC | CE | conf | | kind | UC | CE | conf |
|---|---|---|---|---|---|---|---|---|
| phone | 31 | 513 | | | gateway | 48 | | |
| dect-base | 1 | 12 | | | ata | 34 | | |
| video-device (screen) | 2 | 288 | | | voice-module | 23 | | |
| video-codec (no screen) | 3 | 242 | | | server | 86 | | 22 |
| camera | | 60 | | | server-component | 114 | 4 | 40 |
| microphone | | 55 | | | power-supply | 69 | 183 | 5 |
| speaker | 44 | 10 | | | power-cord | | 253 | |
| headset | | 78 | | | cable | | 289 | |
| touch-panel | | 61 | | | accessory | 42 | 642 | 1 |
| display | | 57 | | | transceiver | 8 | | |
| expansion-module | 1 | 16 | | | software | 275 | 27 | 4 |
| | | | | | unknown | 2,147 | 112 | 227 |

(Approximate after the last marker additions; the ledgers carry the exact counts.)
Read by name: every kind was checked with a name-evidence control (device words vs component words); the
contradictions were read and fixed or recorded. Refusals kept in the header and the test: `-BR` = Brazil
(SPA8000-BR), `KIT` = Room Kit, `MG` = Metal Grille variant unless a colour letter follows, CS-T10 `TS`/`WM`
= Navigator versions, `ADPT` without a wattage = connector pack, `+SW` on CP-7910 = switch port.
Known residue: IX5000 "Host CPU" and CMS 2000 blades filed `server-component`; Atlas IP clocks `unknown`;
three Catalyst switches inside room systems `unknown` (move proposed).

Test `tests/collabKind.test.ts`: 57 positives, 58 refusals (each with the kind it must take), and SABOTAGE
per rule — every one of 34 rules is removed in turn and at least one of its cases must change kind (found one
dead family on the first run: BRKT-/CTS-NAL-/SPBOARD- were shadowed by the marker rule; removed).

## 2. Per-kind question set (`collabBlock()` in fieldSchema.ts, shared by all three profiles)

Envelope for every endpoint (phone … server): dimensions, weight, temp_operating, humidity_operating,
temp_storage, certifications. Then:

| kind | required beyond the envelope |
|---|---|
| phone | display, voice_lines, poe_standard, ports, audio_codecs, supported_protocols, ui_languages, power_max |
| dect-base | poe_standard, ports, supported_protocols, power_max |
| video-device | display, video_codecs, max_resolution, audio_codecs, ports, supported_protocols, ui_languages, power_max |
| video-codec | as video-device minus display |
| camera | max_resolution, camera_zoom, field_of_view, power_max |
| microphone / headset | mic_type (headset/microphone); headset and mic draw from the host: no power_max |
| speaker | power_max |
| touch-panel | display, max_resolution, poe_standard, power_max |
| display | display, power_max |
| expansion-module | product_compatibility |
| gateway | form_factor (+rack_units pending), fxs_ports, ports, audio_codecs, supported_protocols, power_max |
| ata | fxs_ports, ports, audio_codecs, supported_protocols, power_max |
| server | form_factor (+rack_units pending), power_max |
| voice-module / server-component | product_compatibility |
| power-supply | psu_rated_output, product_compatibility |
| power-cord / cable | cable_length |
| accessory / software / transceiver / unknown | nothing |

All gates are on `kind` (R1). The GENERATED profiles' `req` (CE: temp_operating, humidity_operating,
temp_storage, supported_protocols, ui_languages; UC: certifications) are named in the curated blocks and
kind-gated; CE's three KNOWN_LEAKS entries closed (tests/profileMerge ratchet). UC and CE left
DEVICE_GATED_CATEGORIES; conferencing joined KIND_CATEGORIES.

## 3. Evidence per required cup (labels = cisco-datasheets inventory via mapLabel, upper bound; facts = parts)

audio_codecs 54 labels / 80 facts · certifications 751 / 172 · dimensions 1,278 / 0 · display 68 / 0 ·
humidity_operating 547 / 378 · temp_operating 861 / 332 · temp_storage 431 / 318 · supported_protocols 822 / 347 ·
ui_languages 44 / 323 · poe_standard 9 (+13 aliased) / 0 · ports 1,213 / 4 · voice_lines 6 / 6 · weight 1,061 / 0 ·
power_max 860 / 0 · video_codecs 35 / 0 · max_resolution 17 / 0 · camera_zoom 8 / 0 · field_of_view 16 / 0 ·
mic_type 6 / 0 · product_compatibility 372 / 0 · psu_rated_output 2 / 0 · cable_length 61 / 0 ·
form_factor 145 / 0 · fxs_ports 0 labels / 10 facts (UC, html_table, VG sheets). The ledger builder flags no
field as SEED-ONLY or NO FILL PATH. Most label counts come from other categories' sheets: the three categories
hold 2,615 facts in total, nearly all family-inherited phone rows.

## 4. Demoted / declared optional (with counts)

camera_pan_tilt_range 0/0 · mic_pickup_range 0/0 · mic_frequency_response 6 labels (headset) · speaker_* 5-6
labels (headset) · fxo_ports 6 facts (not universal: VG350 is FXS-only; gating on it would gate on an optional
fact) · video_inputs/outputs, keys_buttons, headset_support, handset, touchscreen, bluetooth_version, call_control,
cucm_versions, mounting, altitude_max, cpu, storage_raw_capacity, psu_config, content_share_resolution.

## 5. Duplicates (R2)

None retired. FOUND, not retired (outside my scope to count): `psu_output_power` ("Power supply output power",
W) vs `psu_rated_output` ("Rated power output", W) — the same quantity; 0 facts in my three categories; the
other categories' counts are needed before SUPERSEDED_KEYS. `optical_zoom` (b) beside `camera_zoom` is a
capability flag, not the factor — kept.

## 6. Bands and domains

BAND_OVERRIDES per category (not on the shared entries; routers declares fxs_ports): voice_lines [1,128] (stored
1..12), fxs_ports [1,512] (stored 2..144), fxo_ports [0,512] (stored 0..6). Others use existing bands:
weight [0.01,500], power_max [1,30000], psu_rated_output [5,20000], cable_length [0.1,100], temp/humidity nr bands;
poe_standard and form_factor enum domains. No stored values exist for weight / power_max / cable_length /
psu_rated_output in these categories to check against. String cups (display, video_codecs, max_resolution,
camera_zoom [s, unit x], field_of_view [s, unit deg], mic_type) are generated STRING types; retyping camera_zoom
and field_of_view to numbers is a global change (video declares them) — open question.

## 7. PROPOSALS (database writes — NOT executed)

Category moves (SKU / from / to / evidence = collabKind + name):
- 31 phones, 1 DECT base, 1 KEM, 5 video endpoints in unified-communications -> collaboration-endpoints:
  CP-6921-C-K9-APACP "Cisco UC Phone 6921", CP-7942G-APACSP, CP-7941G-PROMO, CP-6941-C-K9-LATAM, SPA302D-G1
  "Cordless Handset", SPA302DKIT-G1, 13 x CP-*-3PW-NA-MK9 "MLB Subscription - Phone 88xx", DBS-210-3PC-NA-MK9,
  CP-8800-A-KEM-M3PC, CS-DESKPRO-SUB-K9, CS-KIT-SUB-K9, CS-KITPLUS-SUB-K9, CS-KITPRO-SUB-K9, CS-ROOM-USB-SUB-K9
  (full list: 51 rows from D:\tmp\agent-collab\moves.txt).
- 8 SFP optics in unified-communications -> transceiver: CE-1GSFP-T(=), CE-10GSFP-SR(=), EXP-1GSFP-T(=),
  EXP-10GSFP-SR-MP(=) ("10GBASE-SR SFP+").
- 4 Catalyst switches in collaboration-endpoints -> switches: CS-PANO-SWITCH+ "Catalyst 3560-CX 12 Port",
  CS-PANO-SWITCH2+ "C1000 16 Port", CTS-5K-LC-SWITCH / CTS-5K-UI-SWITCH "Catalyst 2960C", C1200-8FP-2G-OPT.
Class (rules added, reclassify not run): HCS- 178, UNITYCN 138, UPG-UC 125, UPG-TP- 8, USOL- 54, CUWL 21,
A-SPK- 94, A-WRK- 61, A-WORK 46, A-PRM- 7, A-HST- 5, A-TPAAS 4 -> license; CTES-MRC- 11 -> service;
TLS_* 8, *-PER-ROOM 14 -> non_product. Held as proposals, no rule: A-CMS* 12 (Meeting Server subscriptions;
a rule would move the A-CMS-API contact-center test case), non-products 6.25A, 7.0A, 321ABC432DEF,
FCH20100312/WZP20100113, 19560-19660, 5060-5080, 15.1.T2, 15.1.3T (values and serial numbers enumerated as
parts), CP-PWR-CORD-xx= (family placeholder; the `-xx` region refusal keeps the rule from reaching it).
Remaining ~1,000 UC licence families (ER*, UCXN*, CM*, SME*, MIG-*, EA-*, R-*, FL-CUSP ...) stay hardware
with kind `unknown` (asked nothing), listed in the survey.
Retractions: family-INHERITED phone rows on non-phone kinds should be checked (not measured: budget).

## 8. Could not check

Cross-vendor collisions of the new class tokens (queries scoped to my categories; tokens chosen as Cisco
product names). Microphone/speaker/gateway datasheets are absent from the label inventory, so their label
evidence is borrowed from headset/phone/other-category sheets. npm test not run (per brief).
