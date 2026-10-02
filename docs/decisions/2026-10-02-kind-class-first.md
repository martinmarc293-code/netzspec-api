# 2026-10-02 — (3a) a non-hardware part never takes a hardware kind: the class decides before the axis

Reviewer, 2 Oct 2026 ~11:50 UTC: "(3a) approved as described: stored product_class first, SKU rules as fallback, no name regex
(the '…with licence' hardware bundles stay devices), measured against the frozen kinds before any write. Include SFP-10G-LR=
reading as switch — an optic in the switches category is a pluggable; check how many other spare optics/components the switches
axis reads as switch."

## The defect

The kind axes read SKU shapes and default to the category's box (switchKind -> `switch`, routerKind -> `router`). Nothing asked
the part's class first, so a licence in `switches` read as a switch. Measured 2 Oct over every live Cisco part (scratch
kind3a-store.mts, read-only): 36,231 parts in kind categories are stored non-hardware (license 29,032, software 3,911,
non_product 1,965, unknown 760, service 563); **5,371 of them held a DEVICE kind** (license->router 1,856, license->switch
1,498, software->router 453, license->sp-router 453, non_product->switch 380 ...), carrying 2,431 served facts (11 own, 2,420
inherited from a document). The doc-subject gate (b') judged them by that kind, so a licence read as a switch was IN for every
switch datasheet listing it.

## The rule (src/core/partKind.ts)

`partKind(category, sku, name?, productClass?)`: when the category has a kind axis, the class decides FIRST — before the axis,
the per-SKU overrides and the name path:
- the STORED `parts.product_class` when the caller passes it;
- else `classify({ sku, categorySlug, categoryIsHardware: true })` with NO name: the SKU rules, the explicit bundle plan and
  the UCS SKU-token axis (securityKind's step 1, generalised). No name rule: "ASR1002X-10G-VPNK9 … AES license" and the ASA
  "-BUN-K9" bundles are devices (stored hardware, category default) and stay devices.
- non-hardware -> `non-hardware`; `unknown` -> `unknown` (an undetermined class is evidence of neither); a category without an
  axis stays undefined.

Every production caller passes the stored class (29 sites: the API record and listing — `kindAndRole` now REQUIRES it — the
`?kind=` filter, recompute-completeness, derive-link-provenance, both apply paths' NAT decision, the doc-subject gate —
`subjectRefusal` REQUIRES it — and every builder/measure script, which select `p.product_class`). The freeze builder and the
drift check share one constant, `FREEZE_PRODUCT_CLASS`, so the snapshot's WHERE and its re-derivation name one population.

## Measured before any write

- **Frozen kinds** (data/freeze/cisco-kinds.tsv, 41,058 hardware rows): with the stored class passed, **0 move**; the control
  (today's partKind reproduces the freeze) 41,058/41,058. Through the fallback alone **7 move**: CRS-1-TEST-40G=, CRS-3-ANY-PK=,
  CRS-3-UPGRADE-BUN, CRS-DP-DLR, CRS-REBATE-ATT, CRS-X-UPGRADE-BUN, CRS1-SPA — exact `non_product` rules added 13 Sep
  (24dcd41) after the last reclassify run (1023), so the store still says hardware. A stale CLASS, not a kind question: the
  builders pass the stored class (0 move), and the 7 are a reclassify proposal (they leave the score and the freeze).
- **Every live part** (kind3a-blast.mts): 24,473 change kind, **0 of them stored hardware**. Mostly a fallback word becoming the
  class word (license unknown->non-hardware 3,905 + 3,795, os-license->non-hardware 2,368 ...); the device-kind movers above.
- **36 real devices filed in software categories** (Catalyst/DNA Center appliances DN1/2/3/4-HW-APL*, NCS 540/560/55A2/57,
  three Nexus 9300 in data-center-analytics, CW9164I) are stored `software` by the category default — reclassify run 973
  refused to class them hardware and the category move is a proposal (src/core/strayDevice.ts). The stored class decides, so
  they read `non-hardware` until that move lands: the class is the defect, not the kind. Nothing scored changes (no profile
  either way); the gate refuses rather than admits.
- **The switches axis** (the SFP-10G-LR= question): SFP-10G-LR= is category `transceiver`, kind `pluggable` (freeze); the
  "switches" premise came from a stale comment in specMerge.ts COMPONENT_SKU_SHAPES. Of the 4,224 live switches parts read as
  `switch`, 30 carry a component SKU shape and **all 30 are switches** whose SKU names its ports (SG350-10SFP, WS-C4500X-16SFP+,
  ME-4507E-S7L+96SFP bundles): 0 optics or spare components read as switch. Optic shapes outside `transceiver`: 190 hardware
  parts, none read as a device except those switches.

## After (store check, scripts/check-doc-subjects.mts, 2 Oct)

20,043 document-scoped inherited facts: IN 15,467 | OUT 0 | NOT JUDGED 4,576 — by receiver kind (stored class): non-hardware
(license) 3,605, non-hardware (software) 580, non-hardware (non_product) 83, bundle (hardware) 72, unknown 27, non-hardware
(service) 6. **4,274 served inherited document facts sit on stored non-hardware parts**: the receivers describesPart's class
rule (NON_PRODUCT_CLASSES) already refuses at write time, so no NEW one can be written; these predate that rule or the part's
reclassification. Bucket A (device receivers) is now 12,827 facts: admitted 6,971, family:mismatch 4,675, family:unknown
1,157, component:SFP 24 — no class:* rows left in it.

## Tests

partKind 71/0 (+14: class first, unknown, no axis, before an override, the fallback reads no name, the 7 CRS both ways, the
stray device both ways); docSubject 54/54 (+5); apiLiveParts 65/0 (+2); bundleFamily 31/31 — two pins moved, both rows the
approved bundle plan (round-7 ruling C) classed non-hardware: the 2 pallets (`non-product` -> `non-hardware`) and the `- 2`
compensation for EDU-C9800-BNDL / WIRELESS-PS-BUNDLE (programme labels the axis called `bundle`), now pinned by name.
Sabotage: no class check -> partKind 7, docSubject 3, apiLiveParts 1 red; the fallback reading the name -> exactly the two
no-name cases red; the drift check without FREEZE_PRODUCT_CLASS -> arrangementFreeze "reproduces all 41,058 frozen rows" red.
Each restored byte-identical (md5).
