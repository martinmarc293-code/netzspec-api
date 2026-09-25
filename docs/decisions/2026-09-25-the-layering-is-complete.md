# The Cisco layering is complete (operator, 25 Sep 2026)

**Operator, 25 Sep 2026:** "fix all the gaps and holes and then informed me back and then we will run a deep audit to check
again" — and, on what it is for: *"a system of empty body so when we have complete the cisco data we really know we have
completed it and also know which areas are still empty, just like when we fill water in an empty ice tray"*.

This records what that produced. The class decision it depended on is
`docs/decisions/2026-09-25-non-product-is-not-a-subject.md`.

## What ran

Every plan in `data/reference/kind-layer-plans-2026-09-13.json` — **7,533 of 7,533, none left pending**. Eighteen runs, each
gated, each verified from a NEW connection by the script that wrote it, none left open.

| | groups | parts | runs |
|---|---|---|---|
| class → `non_product` (retract inherited → class-change → verify) | 8 | 905 | 1189–1203 |
| moves, including the two merges | 10 | 4,821 | 1204–1213 |

297 inherited values were retracted before the class changes, on the rows that were about to stop being products. The
parts' own 64 facts were not touched and are still served — the scripts print them for reading, which is the point.

## The state that resulted

**All 17 categories DONE, 0 rows not layered, 41,067 live hardware parts, every one placed** (`data/layers/*.json`).
`conferencing` and `data-center-networking` hold no row at all: the merges are finished.

Before: 6 of 17 done, 2,035 rows unplaced. The tray now has a compartment for every part that is a product.

## The defect the standing check caught, which only a stale artifact could reveal

`scripts/build-layers.mts` derived its category list from the ROWS. A category whose every part had moved away therefore
stopped being built — and its page stayed on disk and on the published site saying **PENDING 68 about a merge that had
completed**. Nothing else would have noticed: the build reported success, and the category no longer appeared in its own
output. The standing check failed because it reads the artifact rather than the build's report.

Fixed: the list is now the mapping directory plus whatever the rows name, so a merged-away category is rebuilt as what it
is — 0 parts, nothing pending, DONE.

## What the checks say, and what moved in them

`tests/layersStanding.test.ts`: **1012 passed, 0 missed**. Every recorded number that moved is recorded with the rows that
moved it:

- **STATUS_EXPECT: every entry 0.** This table is now the layering's definition of done — any entry above 0 is a new
  unplaced row.
- **REVERSE_EXPECT** (the review queue of shared-parts rows a series names): servers 170 → 171, switches 90 → 92, HX
  30 → 31, collaboration 79 → 84, and **HCI 109 → 341**. The queue grows where rows ARRIVED: the 487 parts that came from
  servers are UCSC- / HCI- components whose SKUs carry a 220 / 240 platform token, so the C220 / C240 node series name
  them. Those are proposals to read, not placements — recorded exactly so the growth is visible rather than silent.
- **Cross-claims: 36 → 43 groups**, 4 counts updated. Every new group is a consequence of a merge: a merged row keeps its
  UCS-shaped SKU, so the mapping of the category it came from, or of the platform it is built on, still claims it. Each
  carries its own reason and the status `decided-home`.
- **Twelve spare=base exceptions retired** — their class plans ran, so the twins on the page now agree and a kept entry
  would be the stale exception the check exists to catch. **Four new ones added**, exactly where fix list 4.1 predicted
  them on 17 Sep: UCSC-LP-C25-1485, UCSC-LP-C40-1485, UCSC-RAIL-D, UCSC-RAILB-M4 disagree on KIND once both members sit
  in servers. Held for the kind rebuild.
- **Six plan witnesses became ran-class witnesses**: off the page AND a run id in the plan. Asserting only "not on the
  page" would pass for a row deleted, retired or never built.
- **The merge checks now assert the merge COMPLETED**, not that it was planned; and an empty category is exempt from the
  dead-placeholder check only when it is a recorded merge source. Sabotage proves the exemption is not a blanket pass:
  removing `conferencing` from `MERGE_CANDIDATES` turns that check red.

Also green: `tests/productLine.test.ts` 472/0, `npm run typecheck`. `npm test` 67/72 — the same five reds that predate
today, three of which are the stale ledgers, census and freeze this work is about to rebuild.

## What is still open on the tray, measured

| hole | before today | now | what closes it |
|---|---|---|---|
| rows with no place in the tree | 2,035 | **0** | done |
| parts whose kind asks NO cups | 695 | **462** (1.1%) | the kind pass below |
| kinds with a role axis and no role | 220 | **28** (routers 10, switches 18) | the same pass |

Of the 462: **362 are bare rows whose name is only their own SKU** — video's legacy Scientific-Atlanta numbers, HX-16-*,
UCSC-DLOM-01 and the like. No evidence we hold says what they are, and no rule can invent it; they are the honest residue
and must stay visible as a named number rather than be dressed up. **106 carry a real name** and are a judgement pass:
bundles, kits, "ATP Demo" units, promos and packing kits that should leave the hardware denominator by class; and real
hardware the axis cannot read yet — the VCS / Expressway appliances, MobileAccessVE units, two ONS 15454 Ethernet cards,
an EWDM amplifier, the DES / 3DES crypto modules, a VIC 1385, the C125 OCP adapter panels.
