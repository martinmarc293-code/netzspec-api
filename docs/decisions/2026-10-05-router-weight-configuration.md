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
