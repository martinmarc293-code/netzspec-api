# Layers round 3 — security — 15 Sep 2026

**Status: rules committed at `9e2285e`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked unattended
under the operator's instructions of 14 Sep 2026 (night): plans only, no database write, "decision pending" where a check needed the
operator. Inputs: the operator's round-3 adjustments (whole-device kinds join the device check, per-category expectations, family layer with
reasons, A.3 rule 1), security's arrivals from interfaces-modules (NAM 2400, ASA-SSM, CSC-SSM) and servers (TG5500, DUO-TOKEN).

## The page, before → after
| | at `08bda4e` | at `9e2285e` |
|---|---|---|
| rows | 1,990 | 1,990 |
| layered / not-this-category / pending plan / unplaced | 1,979 / 4 / 7 / 0 | 1,967 / 0 / 23 / 0 |
| lines / series | 13 / 40 | 13 / 42 |
| label check | not applied | applied: 16 judged (CAB-CONS-USB-C= kept by the name token 1200, ISE-SNS-ACCYKIT by the SKU token SNS, 14 moved to their line's shared parts); 9 rows on labels mapped to shared parts not judged (C1) |
| families | — | none ("—" 1,712, shared across the line 255), `family_layer: "assigned"` |
| plans in (not run) | interfaces-modules 26, servers 2 | the same |

## What changed
- **Family layer:** `family_layer: "assigned"`; Cisco names the Secure Firewall / Firepower series, the ASA and ISA series, the Secure Network
  Analytics appliances, the Email / Web / Management appliances and the management products directly under each security product — no
  family between. `no_family_reason` on the five lines of 3+ series; `FAMILY_EXPECT none`.
- **The device check reached the security boxes.** `DEVICE_KINDS` gains securityKind's SEC_BOX kinds (`firewall`, `ips`, `email-gateway`,
  `web-gateway`, `management`, `analytics`, `identity`; `appliance` was in). It named 19 rows in shared parts:
  - **New series, named by Cisco:** "Prime Security Manager (PRSM) appliances" (`^PRSM-`: the PRSM-HW1 appliances, the PRSM software-on-
    appliance bundles and their CPU / memory / drive / RAID / PSU parts, 15 rows); "Telemetry Broker" (`^ST-TB`: TB 2300 / 2400 and RMA units).
  - **Into existing series:** Data Node 6300 / 6400 → Data Store (`^ST-DN`); ASA-VPN-15K-BUN "Cisco Recommended ASA VPN Bundle for 15K users"
    → Firepower 4100 (it is sold in the Firepower 4100 end-of-sale notice).
  - **Not products:** 5515-X, 5525-X, 5545-X — family placeholders named "Cisco <SKU>", cited only by the ASA FAQ (class plans).
- **Other rows put right:** SM-40 / SM-48 / SM-56, the Firepower 9300 security modules (15 facts each from the 9300 data sheet), which the
  label check had moved to shared parts → Firepower 9300 (`^SM-[0-9]{2}$`); UCSC-PSU1-1200W-D= "1200W Power Supply Spare for FMC1800, 2800,
  4800" (label "Identity Services Engine") → Management Center by a name rule.
- **Not this category:** NM-DES/MP "DES Crypto NM for Cisco 3620/40" joins the router crypto modules (→ interfaces-modules, beside AIM-DES and
  SM-EC-DES, now all planned); **the Cisco 7100 VPN router parts** — MEM-7100-CFL128M "Cisco 7160 Compact Flash Disk", MEM-7120/40-128P,
  MEM-71XX-1024S / 256S, PWR-AC-71XX, PWR-2XAC-71XX, PWR-BLANK-71XX, SM-71XX-BLANK — → routers. Cisco publishes their "Cisco Select 7100
  components" end-of-sale notice in the FirePOWER 7000 collateral, which is how they were filed there; the label check had KEPT six of them in
  FirePOWER 7000 on the evidence "7000" — a false keep (see For later rounds).
- **Targets:** routers series "Cisco 7100 VPN routers (7120 / 7140 / 7160)" (role edge, with the legacy 7200 / 7300 / 7600); interfaces-modules
  series "AIM (Advanced Integration Modules)" for AIM-DES/BP and, by A.3 rule 1 (multi-platform router card), routers' AIM-VOICE-30.
- **Claimant fences:** wireless' Fluidmesh `^FM-?[0-9A-Z]` → `^FM(?!C)…` (it claimed the 77 FMC rows); interfaces-modules' `^SM-(?!X)` →
  `^SM-(?!X|[0-9]{2}$)` (it claimed the Firepower 9300 modules). Removed: the empty series "Secure Client (AnyConnect)".
- **Checks:** `LABEL_EXPECT security exactly 16`; PAIR_EXCEPTION ASA5585-REAR-RACK (kind only: the base reads mechanical through "Rack
  Mount", the spare's "Rack Mounts (1 pair)" stays accessory); device sabotage on planted security boxes; productLine witnesses and refusals.

## Plans added (17; nothing run)
| source | action | target | rows | reason |
|---|---|---|---|---|
| security | move | routers | 8 | Cisco 7100 VPN router memory, power supplies and blanks (A.3 rule 1) |
| security | move | interfaces-modules | 5 | router crypto modules AIM-DES/BP, SM-EC-DES, SM-EC-3DES(=), NM-DES/MP (the exclusion's reason) |
| security | class | non_product | 3 | family placeholders 5515-X, 5525-X, 5545-X |
| routers | move | interfaces-modules | 1 | AIM-VOICE-30 (A.3 rule 1) |

## Measured
- **Row diffs against `08bda4e` (the published pages):** routers — AIM-VOICE-30 layered → pending plan, nothing else; switches, transceiver,
  interfaces-modules, wireless, servers, HCI, HX — 0 changes to bucket, line, family, series, kind, plan, role, label evidence. Security: every
  series change listed in the build (PRSM 15, SNS → ISE shared parts 9 by the label check, Data Store 5, Telemetry Broker 4, 2 + 2 + 1 + 1 + 1).
- **Kinds:** no change in this round.
- **Standing checks** (9 reviewed): **534 passed, 0 missed** at `9e2285e`. Sabotage: reverting the Fluidmesh fence makes the leakage check name
  77 FMC rows; dropping `management` from DEVICE_KINDS fails the planted-row case (restores verified byte-identical). productLine 327/0,
  securityKind 280/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the servers commit's.
- **Cross-claims** 50 → 51: + security ← servers Drives and storage 8 (UCS drive spares of the Stealthwatch and SNS appliances), decided-home.

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| security | move | routers | 8 | 8 |
| security | move | interfaces-modules | 5 | 5 |
| security | class | non_product | 4 | 4 |
| security | class | license | 6 | 6 |
| routers | move | interfaces-modules | 1 | 1 |

## Decision pending
1. **NAM 2400 in security** (carried from the interfaces-modules round, C5 medium confidence): the line "Network Analysis Module (NAM) appliances"
   stays as opened, awaiting its arrivals NAM2420-K9 / NAM2440-K9.
2. **UCS spares filed in security** (UCS-HD / UCS-SD drives, UCSC-PSU1-1200W=, UCSC-FAN-C22XM7=, UCSC-RAIL- kits under the ISE, Stealthwatch
   and Malware Analytics labels): kept in the lines' shared parts and the drive claim recorded decided-home — the same question as the
   servers round's question 2 (generic UCS parts filed outside servers).

## For later rounds (found here, not changed here)
- **labelEvidence:** a series label's platform number is matched against any four-digit number of its hundreds — "7000" kept "Cisco 7160 …"
  rows in FirePOWER 7000. Harmless now (those rows are planned out), but the same shape can keep a wrong row elsewhere.
- **securityKind:** ASA-SSC-AIP-5-K9= reads `appliance` (it is a card; the interfaces-modules plan records expected kind `module`) — after
  that run it would be a device kind in ASA shared parts (noted in the interfaces-modules round). The nameMarker reads "Rack Mount" and not
  "Rack Mounts" (ASA5585-REAR-RACK pair).
- **PRIME-ACC-REG** "Cisco Prime Access Registrar 7.X - Physical" (a software product on an appliance) and the IE power supplies PWR-IE50W-AC /
  -IEC (ISA 3000 and IE switches) sit in shared parts by the label check; the Duo subscriptions beside DUO-TOKEN-10PACK are licence plans.
