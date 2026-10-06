# Router weight printed per configuration: which row is a PID's article weight (5 Oct 2026)

**Ruling (reviewer, 5 Oct ~23:10 UTC, verbatim):** "Approved, with one adjustment: where a configuration row matches a distinct
orderable PID — a DC variant like ISR4331-DC/K9 or a PoE-bundled SKU — that row is that PID's article weight, not __not_a_spec.
Only rows describing an add-on configuration of the same PID (an extra PoE module, a 1,000 W upgrade) go to __not_a_spec. Base
PID = the no-module weight with the PSU it ships with, as you propose; 4321 stays 3.5 kg. Close the held conflicts as superseded
readings in one approval run, then the installation-guide reader."

**Measured.** The ISR 4000 sheet (c78-732542, table 4) prints five weight rows per model; all reached `weight`, so run 1495
wrote 14 weight facts in state `conflict` and the export served none — the last blocker on every ISR 4000. A census of the 455
router documents finds the same shape elsewhere: "Weight with internal power supply (no modules), AC/DC/HVDC PSU", "Typical
weight (fully loaded with modules)" (mapped to `weight` until now), "Weight (chassis only)" / "(full system)". Distinct
orderable DC/PoE variants among live router devices: ISR4331-DC/K9, C1-CISCO4331-DC/K9, CISCO2911-DC/K9, CISCO2951-DC/K9, the
ASR 9006/9010 DC chassis, C867VAE-POE-W-A-K9; there is no DC PID for the 4451/4431/4351.

**Rule** (`src/core/weightConfig.ts`, applied in `apply-extract` for `routers` only, per SKU and per series-level row, like
natThroughput.ts — the decision needs the PART, so it is not an alias): a row's label is `loaded` (fully loaded / full system),
`addon` (a 1,000 W supply, a PoE power module), `variant-dc` (DC / HVDC), `variant-poe` (PoE), `base` ("no modules", "chassis
only") or not a configuration row (plain "Weight": unchanged). loaded and addon are never an article weight; a base row is the
base PID's and not a variant PID's; a variant row is the variant PID's and an add-on for every other PID. A refused row is
counted (`weight_config_refused`) and filed `__not_a_spec`. tests/weightConfig.test.ts 13/0, 6 of them refusals.

**Golden** (`data/reference/golden/cisco-routers.golden.json`, hand-read): ISR4331/K9 6.2, ISR4431/K9 8.4, ISR4221/K9 3.22,
ISR4451-X/K9 13.1 and ISR4351/K9 13.1 (the 450-WAC row they ship with), ISR4321/K9 3.5 (the printed chassis, as ruled),
ISR4331-DC/K9 6.2 (the DC row).

**Still owed:** the held weight conflicts closed as superseded readings in ONE approval run after the re-apply; then the
installation-guide reader.

**Done 6 Oct 2026:** run 1501 closed 44 conflicts (the rejected row refused, the kept row the ruled one); run 1504 superseded
ISR4331-DC/K9's weight from the AC base row (t4:r49) to the DC row (t4:r50) on both URLs of c78-732542 and resolved its 4
conflicts (reviewer, 6 Oct ~07:50: "yes, supersede -- the DC row is that PID's article weight by the ruling"). 28 conflicts on
the 8800 -SYS chassis stay held for their own ruling.

## ANOMALY -- read this first if a later revision of c78-732542 disagrees (reviewer, 6 Oct ~16:20: "record it as an anomaly")

The DC cell that ISR4331-DC/K9's 6.2 kg is read from says, literally, **`13.5 lb (6.2 kg) (4431-DC)`** -- under the column
header **`Cisco 4331/ 4331-DC`** (table 4, row 50, column 5). The qualifier names a model that is not in that column, and the
sheet's whole DC row looks garbled: the 4451, 4431 and 4351 DC cells all read `28.8lb (13.1kg)`, while the 4431's AC chassis is
`18.5 lb (8.4 kg)`. The 6.2 kg was kept as the 4331-DC's because (1) the column header names 4331-DC, (2) the value equals its
AC sibling's `13.5 lb (6.2 kg)` on the row above, and (3) no 4431-DC PID exists in the catalogue -- and 6.2 kg cannot be a 4431,
whose AC chassis weighs 8.4 kg. The weight rule refuses the DC row for every PID that is not a DC variant, so the garbled cells
in the other columns reach nothing. If a later revision of the sheet moves or corrects that cell, re-read it before trusting
the stored value.
