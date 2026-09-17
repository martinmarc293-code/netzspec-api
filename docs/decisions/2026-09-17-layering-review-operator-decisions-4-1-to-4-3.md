# Layering review — the operator's decisions of 17 Sep 2026 applied (fix list 4.1, 4.2, 4.3)

**Operator, 17 Sep 2026:** "yes publish, and go with your recommendations". The recommendations were those of
`2026-09-17-layering-review-fix-list-sections-1-2.md` §4: ON100-M6-K9 its own series in wireless; the AIR-ACC1530 kits in Aironet
Access Points shared parts; the C3160 series renamed "UCS C3160 / S3260"; the 47 split twins and the servers components by the
review's recommendations. **Not approved by that sentence and not done:** any §5 run (they need a yes per group), the §3.7
non_product class decision, and the arrangement-site publish (§6). No database write; no plan run.

**Published first:** the pages at `74df4e6` through `scripts/publish-layers.sh` — every guard passed, the 35 live files are
byte-identical to the checked build, and the live copy re-checked with 0 problems.

## 4.3 — three namings (commit `d1dc019`)

| decision | applied | evidence |
|---|---|---|
| ON100-M6-K9 | series **OnPlus Network Agent (ON100)** (`^ON100`) in Wireless Antennas and Accessories | the only document our store links is Cisco's "Wireless Miscellaneous Accessories" end-of-sale notice; it sat in Aironet shared parts on a rejected label |
| AIR-ACC1530-KIT1=, -PMK1, -PMK1=, -PMK2= | Aironet 1520 / 1530's rule fenced to `^AIR-(?!ACC1530-(KIT\|PMK)).*15[23]0`; they fall to Aironet Access Points shared parts | names say "AP1530/1560 Series"; the store links KIT1= to the 1560 ordering guide, PMK1 to the 1540 and 1560 guides — several series of one line; AIR-ACC1530-CVR= (AP1530 only) stays |
| C3160 | "UCS S3260" renamed **UCS C3160 / S3260** | 7 UCSC-C3160 rows by `C3[12]60`, 7 UCSC-C3X60 rows named "Cisco UCS C3160 …", the C3X60 family shared by both |
| (found doing it) `^UCSC-C3K-` | added to the same series | 17 S3260 / C3000 server nodes, I/O expanders and drives sat in C-Series shared parts because `^UCS-C3K-` misses the UCSC- spelling; 5 of them left the cross-line queue, 3 of which it had named for the S3260 series |

## 4.1 — split twins (commit `d1dc019`)

The rule the review quoted: one category per twin group; the base's platform category, generic UCS components in servers.
Applied to the 45 groups the standing check named pending Q-14 (34) / Q-17 (11) — every cross-category split with no joining plan:

- **generic UCS parts → servers-unified-computing:** UCS- / UCSC- / N20- / PACK- prefixes, and the RACK- accessories of the R42610 /
  R42612 racks (a servers series);
- **cords → the base's category** (the Q-19 rule the operator decided on 15 Sep).

**50 move plans** (run_id null): HX → servers 25, HX → HCI 2, HCI → servers 6, security → servers 11, servers → HCI 5,
switches → HCI 1. Pending after: servers 1,263, switches 317, HCI 49, HX 57, **security 0 → 11** (its UCS spares move to servers).
Q-14 / Q-17 stay OPEN for the untwinned generic UCS rows HX / HCI / security file (the cross-claims entries): fix list 4.1 joined
only the twins. **Four of the 45 groups will disagree on kind once both members sit in servers** (computed from each member's
current kind and each plan's `expected_kind_after`): UCSC-LP-C25-1485 and UCSC-LP-C40-1485 (mechanical vs accessory), UCSC-RAIL-D
and UCSC-RAILB-M4 (accessory vs mechanical) — the classifier reads the named member and the "Cisco <SKU>=" member differently. The
spare = base check will name them after the moves run; listed for the kind rebuild.

**Counts the plans moved, each explained by the rows taken out of the layered bucket:** STATUS_EXPECT above; LABEL_EXPECT wireless
24 → 23 (ON100), security 14 → 10 (N20-BKVM=, UCS-NVMEG4-M960-D=, UCS-SD16TBKANK9-D=, UCS-SD960GM2NK9-D=); REVERSE_EXPECT HX
31 → 30 (UCSC-PSU-BLKP240=); cross-claims: 8 counts lowered naming the rows, 7 groups removed whose every row is now pending.

## 4.2 — servers components by type (commit: this record's)

**The rule.** A processor, memory, drive, GPU, network or storage adapter or TPM of the UCS family lines (X, B, C, XE, AI) sits in
the component-type series of **UCS Server Components**; the platform stays visible in the SKU prefix. The component series claim
SKU tokens and the family shared-parts rules are fenced with the same tokens, generated from one token table.

**Read by name, not by kind.** The stored kind is wrong in both directions, and routing by kind would have carried the errors:
mLOM VICs (UCSB-MLOM, UCSC-MLOM, UCSX-ML-V…, UCSX-MLV…) and modular RAID controllers (MRAID) read *memory*; PCIe fillers and riser
boards read *nic*; the X GPU front-mezz blank reads *gpu*; an X-Fabric module reads *drive*. **The first cut was wrong twice and the
checks caught both:** a Memory token `M(R|L|P)` sent the VIC 15230 / 15420 / 15411 mLOMs to Memory and would have claimed
UCSC-MPSTOM6L-KIT= in HX (the leakage check named it), and reading every routed token group by name found fillers, riser boards, a
front-mezz blank, a GPU riser kit and an M.2 extender among the "adapters", "GPUs" and "drives". Fixed in the table: memory is
`MR(?!AID)`, `ML-<size>`, `MP-`; `ML-V` / `MLV` are adapters; `PCIE(?!-F|-R)`, `GPU(?!CBL|FM-BLK|-RKIT)`, `M2(?!EXT)`.

**Rows:** 1,633 move, every one from a UCS family shared-parts series into a UCS Server Components series, none anywhere else:
X → Processors 492, Drives 329, Memory 67, GPUs 50, adapters 40, TPM 14; C → adapters 253, Drives 124, GPUs 77, Memory 10,
Processors 3; B → Drives 70, adapters 40, Processors 24, GPUs 7; XE → Drives 14, Memory 8, adapters 6, GPUs 4, TPM 1.

**Kept where they are, each named in the standing check with its reason (36 rows):** 14 placed only by a label (datasheet cells
named "Cisco CPU1", "Cisco HDD1" …; the Cisco+ PLHC- variants; CIVS-MSP-MEMUP6G; CS-EZ-3TB-HDD; SSD-SATA-800G(=), whose prefix would
also claim 10 routers SSDs) and 22 whose stored component kind is wrong (fillers, riser boards, the MLOM and GPU-front-mezz blanks, a
C24 M3 drive backplane, an M.2 extender, an SD bracket, the X9516 X-Fabric module, the GPU riser kit). **CSP- components (33 rows)
stay with the Cloud Services Platform** — appliance components under the appliance's own prefix, as MSE- / CMX- stay with theirs in
wireless.

**Queues:** REVERSE_EXPECT servers 212 → 170 and CROSSLINE_EXPECT servers 47 → 15 — only withdrawals (computed under old and new rows):
the rows left shared parts, including known false readings (UCSX-M2-240G "240GB" proposed for UCS C240, UCSB-NVMEHW-I2000 for
"UCS 2000 fabric extenders"). **Leakage:** 8 new claim groups — the component series now read family-prefixed components HCI (32 rows)
and HX (1) file for their nodes — recorded `pending-decision:Q-14` like the existing UCS- component groups.

**A check for the decision itself**, because nothing else would notice a fence token dropped from one family (the components would stay
in shared parts, break no count and be no device): `componentKindsInFamilySharedParts` with the 36 exceptions named, exact in both
directions. Sabotage on the real mapping: GPU dropped from the X-Series fence only → 50 X GPU-kind rows stayed in shared parts and
**exactly one check went red, this one** (46 unrecorded); restored byte-identical, rebuild row-identical.
