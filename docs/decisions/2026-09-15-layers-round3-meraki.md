# Layers round 3 — meraki — 15 Sep 2026

**Status: rules committed at `735fb06`, pages rebuilt at that commit (`uncommitted_rule_files: []` on all 17 pages).** Worked under the
operator's instructions of 14 Sep 2026 (night): plans only, no database write. Inputs: the wireless round's two pending-round entries
(Meraki MR and Catalyst Wireless rows, "decided in the meraki round"), the Meraki MS precedent (run #1061 moved the MS switches to
switches), the operator's layer model ("Meraki MS" is a product line of switches).

## The page, before → after
| | at `778bdfc` | at `735fb06` |
|---|---|---|
| rows | 155 | 155 |
| layered / not-this-category / pending plan / unplaced | 155 / 0 / 0 / 0 | 91 / 0 / 64 / 0 |
| lines / series | 1 ("Meraki") / 8 | 5 / 43 |
| label check | not applied | applied: 0 label-placed (every row is SKU-placed; the mapping has no labels) |
| families | not assigned | Second Generation MV Cameras (6 series, 11 rows), Third Generation MV Cameras (6 series, 16 rows); "—" 64 |

## What changed
- **Product lines.** The file held one line "Meraki" whose "series" were whole products. Under the operator's model a buyer names
  "Meraki MS" as a line (switches) and "Meraki MR Access Points" (wireless), so the meraki category now has one line per product:
  **Meraki MV Smart Cameras, Meraki MX Security and SD-WAN Appliances, Meraki Z Teleworker Gateways, Meraki MG Cellular Gateways,
  Meraki MT Sensors**, each with Cisco's model series (the documents say "MV63 Series", "MG21/21E Datasheet", "MT10 Datasheet"; switches'
  Meraki MS line is built the same way, MS120 … MS450). SKU rules fence each model's digits (`^MX65(?![0-9])` does not take MX650,
  `^Z4(?![0-9C])` does not take Z4C).
- **Families (decision pending).** Cisco's documents name the MV camera generations with their models: "All second-generation MV cameras
  (MV12, MV2, MV22(x), MV32, MV52, MV72(x))" and "Third-generation MV cameras (MV13, MV33, MV63(x), MV93(x))" (MV Smart Camera FAQ),
  "Gen2 … Gen3: MV13/M, MV23M/X, MV33/M, MV63/M/X, MV73M/X, MV93/M/X" (MT FAQ), a datasheet titled "Second Generation MV Cameras". The
  routers file already carries generation families (ISR G1 / G2), so they are families here; MV21 / MV71 ("Gen 1", models not listed
  on the held pages) and MV44X / MV53X / MV84X stay outside with a `no_family_reason`. MX, MG and MT record reasons; Z has two series.
- **Every doubtful row read on its source page.** The meraki rows were enumerated from documentation.meraki.com pages; the fourteen
  cached pages were copied from the box read-only and each token read in context:

  | rows | what the page says | plan |
  |---|---|---|
  | MCS1, MCS2, MCS3, MCS5, MCS6 | the MR28 receive-sensitivity table ("802.11n (HT20) MCS0 18.5 -95 MCS1 …") | class non_product (datasheet cell) |
  | MS15, MV4, MX16, MX18, MX26 | firmware versions ("Prior to MS15 firmware", "firmware version MV4.15", "From MX16.2+", "The MX18.1 firmware release", "Beginning with MX26.1") | class non_product (datasheet token) |
  | MR4, MV5 | cut-off teasers ("the MR4... MR86 Datasheet", "camera models (MV5... Article type") | class non_product |
  | MV10, MGKIT-1 | fragments of accessory PIDs not held (MA-MNT-MV10, MA-ACC-MGKIT-1) | class non_product |
  | MX650 | page tags on the C8455-G2-MX datasheet ("MX650 Datasheet", "MX650 Installation"); no document or fact names an MX650 | class non_product |
  | CW917H, CW9166ID1 | misprints in the CW9172H / CW9166 datasheets (wireless holds CW9172H, CW9166I, CW9166D1) | class non_product (misprint) |

- **Family placeholders:** 15 bare model rows with no document and no fact whose orderable PID is held — MV13, MV13M, MV23M, MV23X, MV33,
  MV33M, MV63, MV63M, MV63X, MV73M, MV73X, MV93, MV93M, MV93X (their -HW rows stay) and CW9163E (CW9163E-MR / -x in wireless) → class
  non_product. **Bare model rows that carry facts stay** (MG21 … MG52E 5–6 facts, MT10 … MT30 3, Z4 / Z4C 9–10, MV53X 11, MV44X / MV84X 2,
  MR28 4): the Meraki datasheets name the model, not the -HW PID, so those rows are where the specifications are.
- **Meraki MR and Catalyst Wireless access points → wireless (32 move plans; decision pending).** MR11 … MR86-HW and CW9172 / CW9176 /
  CW9178: wireless holds the Meraki MR Access Points line and the Catalyst Wireless series, and the MS switches set the precedent of one
  home per noun. The wireless mapping places all 32 (checked with its own rules; the arrivals check agrees). The meraki MR, CW and MS
  series and "Meraki shared parts" are gone (nothing left to place there), and so are the cross-claim entries they created (switches ←
  meraki MS 180, wireless ← meraki CW 34 and MR 13).
- **Collaboration-endpoints, the claimant fix its round missed:** `^CS-PANO` → `^CS-PANO(?!-SWITCH)` and `^CTS-5K` →
  `^CTS-5K(?!-(LC|UI)-SWITCH)`, so CS-PANO-SWITCH+ / SWITCH2+ and CTS-5K-LC / UI-SWITCH (whole Catalyst switches, A.6) are no longer
  claimed; both switches ← collab entries removed. The collab page changes only in `placed_by` text (170 rows).
- **Checks:** REVIEWED + meraki; `FAMILY_EXPECT meraki in-use`; `LABEL_EXPECT meraki exactly 0`; `DEVICE_KINDS` + `access-point`
  (merakiKind's noun; wireless says `ap`) with a planted-row sabotage; the leakage sabotage that planted a Meraki MS row now plants a
  Meraki MV63-HW in switches. productLine: 11 meraki witnesses, a wireless witness for MR84, 5 refusals (MR84, CW9172, MS120-24P, MX650,
  MV10 are not placed by meraki).

## Measured
- **Row diffs against `778bdfc`:** 15 pages 0 changes; collaboration-endpoints `placed_by` text only (170); meraki 64 → pending plan,
  155 series / lines renamed.
- **Standing checks** (15 reviewed): **679 passed, 0 missed**. Sabotage (Edit tool, restored and read back): `^Z4(?![0-9C])` → `^Z4` fails
  the Z4C-HW witness, the rule-shadowing check ("Z4C :: ^Z4C lost 2 to Z4") and the placeholder check; dropping `access-point` fails the
  planted-row case. productLine 402/0, deployRole 73/0, typecheck clean.
- **Full suite:** 66/71; the 5 known reds with miss lines identical to the collaboration commit's.
- **Cross-claims** 43 → 38.

## Runs ready (dry-run counts, read-only)
| source | action | target | plans | matched |
|---|---|---|---|---|
| meraki | move | wireless | 32 | 32 |
| meraki | class | non_product | 32 | 32 |

## Decision pending
1. **Meraki MR / Catalyst Wireless home:** planned to wireless by the Meraki MS precedent (the wireless round's question 3). Confirm, or
   keep the Meraki-managed access points in meraki.
2. **MV camera generations as families** (Second / Third Generation MV Cameras), as ISR G1 / G2 are in routers.
3. **Bare model rows that carry facts:** kept here as the fact carriers; the wireless round planned MR36 (5 facts), MR46 (7), CW9162 (4),
   CW9166 (3) and AP1572EC (2) as family placeholders. One rule for both — keep the fact carriers (recommendation) or class them.
