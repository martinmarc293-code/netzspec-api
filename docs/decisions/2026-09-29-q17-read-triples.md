# Q17 — the read triples (29 Sep 2026)

**Ruling (reviewer, Q17):** R1 / R3 / R2 as plans read row by row → R4 widenings with witnesses → **the read triples**.
**Reviewer on batch-e-report.md:** "Otherwise Batch F as filed", with two overrules and one audit finding (below).

## The reviewer's changes, applied

1. **"TAA compliant" is not a certification** (a country-of-origin procurement claim, no issuing body or standard number)
   → the 13 part-cups (switches supervisor / fabric / linecard) are **retracted**, not widened.
2. **Video passive "Mux/Demux 100G"** → **rekeyed to `channel_spacing`**, not retracted: the reading was right (the 100 /
   200 GHz DWDM grid), so the value belongs there. `rekey-psu-and-compat` gains its one `reshape` move: a bare `100` /
   `200` raw with unit Gbit/s becomes `"100 GHz"` / `"200 GHz"` (the form channel_spacing already stores), gate first.
3. **Audit of R4:** a hexcat_seed carries the datasheet's doc_id as BORROWED provenance (N31), so an R4 widening now needs
   at least one html_table / pdf_table row. **18 of the 116 landed R4 widenings were seed-only (333 part-cups)** and are
   reverted into `Q17_R4_REFUSED` pending a table read; 98 stand. `veto-triage.mts` applies the rule.

## The read, after the overrules

`data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv` — every one of the 105 triples, its remedy and why:

| remedy | triples | part-cups | mechanism |
| --- | ---: | ---: | --- |
| widen | 58 (+2 partial, +1 frame) | 676 (+9, +1) | `Q17_READ` in cupLedger.ts, witness each, declared optional |
| retract | 32 (+1) | 125 rows | `scripts/retract-read-pours.mts` over the exact list `data/reference/q17-read-pours-cisco-2026-09-29.tsv` |
| rekey | 5 | 32 (30 move, 2 refused) | `rekey-psu-and-compat`: cpu power_max→tdp, AP tdp→power_max, drive flash→storage_capacity, SD dram→flash, passive data_rate→channel_spacing |
| reclassify | 10 | 28 | axis rules, below |

**The two rekey refusals:** MEMUSB-128FT and MEMUSB-128FT= (128 MB USB flash tokens) — 0.125 GB is under
storage_capacity's band floor of 1 GB. Held as they are (still vetoed); a band change is a dictionary decision, not a
rekey's.

## The reclassification read its families

The veto named ten parts. Their families carried the same defect in every sibling — the machine token made every part of
the platform the platform — so the rules are per family, each family read in full, and the corpus replay was read row by
row: **219 of 41,058 live Cisco hardware parts change kind.**

| family | was | now |
| --- | --- | --- |
| C880 (170 rows) | `server` | 27 memory (DIMM kits), 9 cpu (E7), 10 nic (FC / 10G / 40G / 1GbE I/O), 6 storage-controller, 10 drive, 6 fan, 5 power, 10 chassis (JBOD enclosures, spare chassis), 45 mechanical (boards, midplanes, panels, FBU, mounts), 5 accessory (SFP+ modules); the SAP-HANA systems stay `server` |
| C3X60 (90 rows) | `chassis` | 45 drive (SSDs, drive rows, expander trays with drives), 6 storage-controller, 1 fan, 5 mechanical; UCSC-C3X60-BASE stays the chassis |
| C3K (17 rows) | `drive` | 6 server (S3260 M4 nodes), 2 io-module, 1 mechanical; the NVMe SSDs stay drives |
| UCS / HX PCI25, EM3-AF | `nic`, `memory` | 12 drive ("2.5in SFF PCIe/NVMe Storage", "480GB SSD + 4TB SSD Combo") |
| ST-M6-D100GF | `drive` | nic (a Mellanox CX-5 2x100GbE card) |
| 15454(E)-ML Ethernet cards | `pluggable` | 4 linecard |
| NCS2K-MF-1RU= / -6RU= | `mux` | 2 accessory (the mechanical frames) |
| 15454-YCBL-LC= | `cable` | accessory (a Y-cable DRAWER: `drawer` joins the cable marker's tray / holder exclusions) |

A 12 Sep refusal in `tests/ucsKind.test.ts` said UCSC-C3X60-56HD8 "is the C3160 chassis; 56HD8 is a drive COUNT" — it read
the SKU without its name, "UCS C3X60 4 rows of 8TB NL-SAS ... (56Total) 448TB": drive rows ordered into the chassis, whose
own PID is UCSC-C3X60-BASE. Overturned with the name, and the refusals now pin BASE, a server node, the HANA systems, the
FBU cable, the JBOD enclosure and an NVMe SSD. 18 new PRE_RULES, 18 probes, each sabotaged.
