# Seven required fields nothing can fill — the sheet, one field at a time (16 Sep 2026)

**Prepared, not applied.** Profiles are cup-side and not mine to edit. Nothing here wrote to the store.

`tests/source-fields.test.ts` has been red with *"required by the profile and no enabled source publishes it"*. The test
names the pairs; it cannot say what each one costs to keep or to drop. This is that sheet, built the way the security
round settled the same question: **how many parts carry the slot, and does the document corpus hold a label for it at
all.** Those are different questions with different fixes — an unmapped label earns an alias rule and the field stays
required; no label at all means the field cannot be filled and the decision is to demote it.

## What the test is actually reporting

**17 problems over 7 distinct fields** (a first pass of mine said 124 over 668, because it passed the built file to
`enabledSources` instead of the file's `evidence` block, got an empty enabled list, and made every field look uncoverable
— the count is only meaningful beside what it was counted over).

Enabled sources today: `cisco-datasheets`, `cisco-eol`, `hpe-quickspecs`, `hpe-quickspecs-pdf`, `juniper`.

**No source publishes any of the seven — not even a disabled one.** So this is not "enable a source"; every one is a
profile decision.

## The cost: 5,633 permanently unfillable required slots on live parts

Counted from `completeness.required_fields`, which recompute writes from the profile the part's kind and role resolve to
— the authoritative "who is asked", rather than re-deriving the profile logic.

| field | parts asked | where |
| --- | ---: | --- |
| `dimm_slots` | **2,395** | servers 2,085 · HX 144 · UC 77 · HCI 59 · conferencing 30 |
| `pcie_slots` | **2,395** | the same parts |
| `new_conn_per_sec` | 468 | security |
| `flows_per_second` | 214 | security |
| `tuning_range` | 88 | transceiver |
| `link_budget` | 41 | wireless |
| `max_endpoints` | 32 | security |

By category: servers 4,170 unfillable slots over 12,906 scored parts; security 714 over 13,286; HX 288 over 1,772;
UC 154 over 5,405; HCI 118 over 1,004; transceiver 88 over 2,366; conferencing 60 over 3,749; wireless 41 over 6,194.

## The corpus: 15,130 distinct labels over 5,174 documents, probed one field at a time

Each probe is deliberately **wide** — a wide net that finds nothing is the finding.

### `dimm_slots` — 2,395 parts, 42 labels, and exactly **two** of them are the field

> **CORRECTED (later the same night).** This section first said *"41 labels and NOT ONE of them is a DIMM-slot count —
> every one is a weight … demote; no alias is safe here."* **I had read eight of the forty-one and generalised.** Read in
> full there are 42, and the picture is different in the one way that matters.

```
22  labels whose own text says "Weight"   Weight with following options and including rail kit: 1 HDD, 1 CPU, 1 DIMM …
14  weight-TABLE row labels               Bare (0 HDD, 0 CPU, 0 DIMM, one power supply) · Maximum (8 HDDs, 2 CPUs, 16 DIMMs …)
 4  not this field at all                 External USB flash-memory slots (Type A)      <- my probe's "memory slot" clause
 2  DIMM slots                            <- THE FIELD, exactly named
```

So the warning stands and is the important half: **an alias on `/DIMM/` would fill 2,395 parts' `dimm_slots` with
kilograms**, because 36 of the 42 are weight-table text. But *"no alias is safe here"* was wrong — the exact label
`DIMM slots` exists, twice.

→ **demote to `opt`, and alias on the exact label `DIMM slots` only** — never on a substring of it. Two occurrences
against 2,395 parts is still nearly nothing, so the demotion is unchanged; what changes is that the one real label is not
thrown away with the weights.

### `pcie_slots` — 2,395 parts, 9 labels, 15 occurrences
`Expansion Slots` ×3, `Expansion slots` ×3, `All PCIe Gen5 slots` ×2, `PCIe slots`, `PCIe Slots`, `Expansion Slot`,
`Expansion slot`, `PCI Integration` ×2, `Standards-based PCI-104`. I first wrote "the labels are real" — **two are not**:
`PCI Integration` is a feature statement and `Standards-based PCI-104` is a form factor, neither a slot count. Eleven
usable occurrences against 2,395 parts (0.5%). → **demote to `opt` and alias the `Expansion slot(s)` / `PCIe slot(s)`
spellings only.**

### `new_conn_per_sec` — 468 parts, 7 labels, 14 occurrences
`NAT max connections per second` ×3, `Maximum new connections per second, with AVC` ×3, `Connections per second` ×2,
`SSL/TLS Connections per Second` ×2 (×2 spellings), `Maximum new connections per second`, `New connections per second`.
Every one means what the field means. **14 occurrences against 468 parts (3%).** Note `SSL/TLS Connections per Second`
is a *different* measurement wearing the same words. → **demote to `opt`, alias the four unambiguous spellings, leave
the TLS ones alone.**

### `flows_per_second` — 214 parts, **0 labels, 0 occurrences**
Nothing in the corpus at all. The security round had already declared it `opt` on exactly this evidence; something
re-required it. → **demote.**

### `max_endpoints` — 32 parts, 10 labels, 14 occurrences, and half of them are a different quantity
```
2  Concurrent active endpoints supported by a dedicated PSN (Cisco ISE node only has PSN persona.)
2  Maximum endpoint PoE power available from PoE power supply (watts)      <- WATTS
1  Maximum number of devices across networks
```
The ISE lines mean the field; the PoE lines are a **power** figure with the same words — the security round's own
recorded trap ("one plausible label plus one that is a firewall figure wearing the same words"). → **demote to `opt`;
any alias must be anchored on `endpoints supported`, never on `maximum endpoint`.**

### `tuning_range` — 88 parts, **42** labels, 72 occurrences

> **CORRECTED.** This said *"31 labels … alias only a label that says tunable, of which the corpus holds none today."*
> I had read five of them. There are 42, and **several do say tunable** — which reverses the recommendation.

The bulk (~35) are **wavelength ranges** and the trap I described is real: `Receiver Wavelength Range (nm)` ×10,
`Operating Wavelength Range (nm)` ×7, `Transmitter Wavelength Range (nm)` ×4 … `wavelength` is already its own key, and a
fixed optic's wavelength range is its **tolerance**, not a tuning range. Aliasing those would record a ±0.5 nm tolerance
as a tunable band on optics that do not tune.

But the corpus does hold the field, in seven places I had not looked at:

```
6  ITU Channel        + 1  ITU Channels      <- the grid a tunable optic covers
1  Frequency tuning range (GHz)              <- the field, exactly
1  Number of Channels Tunable to
1  Tunable C-band operation
1  10 Gigabit DWDM Tunable XFP (50-GHz ITU grid) *
1  SFP+ (SR/LR/ER/ZR/Tunable-DWDM)                    <- a product list, not a value
```

→ **demote to `opt`, and alias the tunable / ITU-channel labels — never a "Wavelength Range" one.**

### `link_budget` — 41 parts, **10** labels, 12 occurrences
`Radio Capabilities: Link Budget` ×2, **`Link Budget (dB)` ×2** (which I had missed, and is the cleanest of them),
`Link Budget`, `Link budget`, `Link Budget (no amplification)`, `Link budget (no amplification)` — right; and
`Directivity (optical path loss)`, `Upgrade path loss`, two `Single-channel optical link (without DWDM) …` — **optical**,
on a field required of wireless. → **demote to `opt`; alias the bare `Link budget` / `Link Budget (dB)` spellings only.**

## A note on how these were read, because two of them were wrong

Four of the seven sections above originally quoted a handful of labels and characterised the rest. **Two of those
characterisations were false**, both in the same direction — I said a field had no usable label when it had one:
`dimm_slots` (the exact label `DIMM slots`) and `tuning_range` (`Frequency tuning range (GHz)`, `ITU Channel` ×7 and
three more that say *tunable*). A third, `pcie_slots`, called two labels real that are not. Only `max_endpoints`,
`new_conn_per_sec` and `flows_per_second` were read in full the first time and stood.

Every section now rests on the **complete** list. The failure mode is worth naming because it is the one that would have
cost something: **"no label exists" is the claim that licenses throwing the field away**, and it is exactly the claim a
partial read is least able to support.

## The recommendation, in one line

**All seven demote from required**, each to `opt` with the alias rule named in its own section above — including
`dimm_slots`, whose one real label (`DIMM slots`, exactly, never a substring) survives among 36 weight-table labels. That removes 5,633 slots that can never be closed, and it is the same call the
security round made for its own four, with the counts written beside each.

The alternative — keep them required and treat the gap as real — is this project's own recorded failure mode: *"a
required field that nothing can ever fill is a permanent gap, not a recorded one… Refusing to guess is correct; leaving a
required field unfillable is a decision to fail forever."*

**Not applied:** every one of these is a profile edit, and a profile edit is a DECISION that ships with the rebuilt
ledgers, censuses, traces, completeness report and freeze on one commit — which is itself blocked (see
`2026-09-16-step5-rebuild-is-blocked-at-its-first-step.md`).

---

# And the two the other way round: `securityShapes`, where the TEST asserts the proposal

`tests/securityShapes.test.ts` is red on two rows, and they are the opposite shape to the seven above — the test expects
**`req`** and the profile says **`opt`**:

```
MISS  management / Security Manager / managed_devices_max -> req: got "opt"
      (kind-layer: MANAGEMENT archetype proposal (was opt: no enabled source publishes a label))
MISS  drive / Defense Center / drive_form_factor -> req: got "opt"
      (DRIVE archetype proposal (the NEW key the foundation created))
```

So the test encodes an **archetype proposal that was never applied**, and one of them contradicts a decision the security
round had already taken on measured evidence (*"`managed_devices_max` two [labels] that are prose rather than specs"* →
declared `opt` with the counts beside it). Measured the same way as the seven:

### `managed_devices_max` — 16 live hardware parts in Security Manager; **5 labels, 5 occurrences**
```
1  Managed devices                                              <- the only one that means the field
1  Maximum number of devices across networks                    \
1  Maximum number of devices in a device group                   |  Meraki DASHBOARD limits — a different
1  Maximum number of devices in a network                        |  quantity about a different product
1  Maximum number of devices supported in a device group comparison  /
```
**One usable label in a corpus of 19,661.** The security round's `opt` is the answer the corpus supports.

### `drive_form_factor` — 106 live hardware parts in Defense Center; **3 labels, 3 occurrences, none of them the field**
```
1  Disk drives (SFF)                     <- a label whose VALUE is a drive list; SFF sits in the label text
1  SFF-based and CMIS-based management   <- SFF here is the Small Form Factor Pluggable committee, with CMIS:
                                            this is an OPTICS label, a different SFF entirely
1  Updates with LFF platform
```

Neither key holds a single current value anywhere in the catalogue, and neither is required of any part today.

**Recommendation: keep both `opt`, and correct the two expectations in `securityShapes.test.ts` with this measurement
beside them.** Promoting them would add 122 unfillable required slots to the 5,633 above and would re-open a question the
security round had already closed with evidence.

**Not done here, deliberately.** The red is a real open question, and silencing a check by editing its expectation is the
operator's call, not mine — this repo's own rule is that a permanently red check teaches readers to ignore it, which is
the argument for *ruling on it*, not for quietly making it green.
