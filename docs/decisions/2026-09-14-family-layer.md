# The family layer — layer 3 between product line and series (operator decision, 14 Sep 2026)

**Decision.** Layers become: category → product line (2) → **family (3)** → series (4) → kind / deploy_role underneath. A family
is added **only where Cisco names one** that groups series. Operator: "yes, only where Cisco names a family".

**Why not everywhere.** Measured over the 17 mappings: 104 product lines, 475 series; 46 lines hold 1–2 series. A family on
those restates the line or the series (CLAUDE.md: a level that restates the one above it adds nothing and misleads).

## Rules (enforced)

- `src/core/productLine.ts` `validateLineFile`: a family groups ≥ 2 series of ONE line; it may not equal its line's name or any
  series name; once a file declares `family_layer: "assigned"`, every line of 3+ series with a series outside a family records
  `no_family_reason`. Sabotage cases in `tests/layersStanding.test.ts` (each refused for its stated reason).
- A series a Cisco family would restate takes its platform names (the family "Nexus 7000" holds the series "Nexus 7004 / 7009 /
  7010 / 7018" and "Nexus 7700"); the old name is kept in the series note.
- Layer 3 on a row (`product_family` in rows.tsv / JSON) is the Cisco family, or `(shared across the line)` for a line-level
  shared-parts row (the part fits several families of the line or none — explicit, never blank), or empty ("—") where Cisco
  names no family. A part is never listed under two families: one row, one path, counts that add up. A family-scoped shared
  series ("Catalyst 9000 shared parts") carries its family.
- The field is `product_family`, NOT `parts.family` — that column is derived from datasheet titles and is known to name the series
  level and sometimes the wrong series.

## Switches (family_layer assigned)

| line | family | series (layer 4) | layered rows |
|---|---|---|---|
| Catalyst | Catalyst 9000 | 9200, 9300, 9350, 9400, 9500, 9550, 9600, 9610, Catalyst 9000 shared parts | 685 |
| Catalyst | Catalyst 6800 | Catalyst 6807-XL / 6880-X / 6840-X (was "Catalyst 6800"), 6800 Instant Access | 116 |
| Catalyst | Catalyst 4500 | 4500-E, 4500-X | 329 |
| Catalyst | Catalyst 3750 | 3750 / 3750G / 3750v2 (was "Catalyst 3750"), 3750-E, 3750-X | 156 |
| Catalyst | Catalyst 3560 | 3560 / 3560G / 3560v2 (was "Catalyst 3560"), 3560-E, 3560-X, 3560-C and 3560-CX | 139 |
| Catalyst | Catalyst 2960 | 2960 / 2960G (was "Catalyst 2960"), 2960-C/CX, 2960-X/XR, 2960-S, 2960-Plus, 2960-L | 356 |
| Nexus | Nexus 9000 | 9100, 9200, 9300, 9400, 9500, 9800, Nexus 9000 shared parts | 595 |
| Nexus | Nexus 7000 | Nexus 7004 / 7009 / 7010 / 7018 (was "Nexus 7000"), Nexus 7700 | 416 |
| Nexus | Nexus 5000 | Nexus 5010 / 5020 (was "Nexus 5000"), 5500, 5600 | 271 |
| Nexus | Nexus 3000 | Nexus 3016 / 3048 / 3064 / 3100 / 3200 / 3400 (was "Nexus 3000"), 3500, 3550, 3600 | 250 |

No family (reason recorded per line): Catalyst 6500, 4900, 3850, 3650, 1000, 1200, 1300, Micro, Digital Building, PON, RPS; Nexus
2000 FEX, 6000; Industrial Ethernet, Embedded Services, Small Business, Cisco Business, Meraki MS, Metro Ethernet (each model line
is its own Cisco series). Shared across the line: Catalyst 241, Nexus 39, Industrial Ethernet 5, Metro Ethernet 3.

## Routers (family_layer assigned)

| line | family | series | layered rows |
|---|---|---|---|
| ISR | ISR G2 | ISR 1900, 2900, 3900 | 336 |
| ISR | ISR G1 | ISR 1800, 2800, 3800 | 88 |
| Industrial and IoT Routers | Connected Grid Routers | CGR 1000, CGR 2010 | 106 |

No family: ISR 800, 819, 900, 1100, 4000; Secure Routers and Catalyst 8000 Edge (the line is Cisco's family); ASR, NCS, Legacy,
the other IoT series; the move-out Router Interface Modules. Lines of 1–2 series need no reason.

Not assigned yet (and so not validated for reasons): the other 15 categories — each gets its families in its own round.
Open for the reviewer: whether Cisco's "ASR 900 Series" family is meant to include the ASR 901 and ASR 920 (left separate: not
confirmed), and "Catalyst IE3x00 Rugged" as a family over IE 3100–3500H (left separate: not confirmed as a Cisco family name).

### Answered after the re-audit at 2f3d17a (14 Sep 2026, evening) — CLOSED

- **ASR 900** (reviewer): a family over ASR 901, ASR 920 and the chassis series, renamed "ASR 902 / 903 / 907 / 914" (was "ASR 900",
  so the family no longer restates a series). 235 layered rows after the label check.
- **ISR 800** (operator's call, "Family ISR 800"): a family over "ISR 810 / 840 / 860 / 870 / 880 / 890" (was "ISR 800") and
  "ISR 819 Hardened (M2M)". 340 layered rows.
- **IE3x00** (reviewer: a family only if document titles carry it): 0 document titles in the index contain "IE3x00", so no family;
  the Industrial Ethernet line's no_family_reason says so.
- **2960 / 3560 / 3750** confirmed by the reviewer; the renamed series strings are exactly "Catalyst 3750 / 3750G / 3750v2",
  "Catalyst 3560 / 3560G / 3560v2", "Catalyst 2960 / 2960G" (the reviewer's search had used abbreviated strings).

Routers after the round: ISR 800 340, ISR G2 310, ASR 900 235, Connected Grid Routers 96, ISR G1 89; shared across the line 518.
Switches: Catalyst 9000 614, Nexus 9000 570, Nexus 7000 416, Catalyst 2960 335, Catalyst 4500 326, Nexus 5000 271, Nexus 3000 240,
Catalyst 3750 152, Catalyst 3560 139, Catalyst 6800 116; shared across the line 495. (Family counts fell where the label check
moved unevidenced rows to the line's shared parts — see the layers round 2 record, round 2c.)
