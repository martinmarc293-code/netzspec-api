# Layering re-check of 17 Sep 2026 (build 9906ab5) — fix list section 1 applied

Claude web re-audited the pages built at `9906ab5` (`cisco-layering-recheck-2026-09-17.md`, the findings and actionable TSVs, and
`cisco-layering-recheck-fix-list-for-claude-code-2026-09-17.md`). Everything the first fix list claimed was verified done. Section 1
of the new list is the residue of the components move (decision 4.2) plus deviation a of 2.2.1. **This record applies section 1 as
mapping and plan edits only: no run, no database write, nothing published.** Sections 2 (operator decisions), 3 (runs), 5
(arrangement site) and 6 (re-publish) wait on the operator.

## What changed, row by row

"Changed rows" = rows whose `series`, `bucket` or `product_line` differ between HEAD's `data/layers/cisco-<category>.rows.tsv` and the
rebuilt one; the SKU sets are identical (no row appeared or left). **56 rows: servers 44, hyperconverged-systems 1, wireless 11.
Every other category: 0.** All 56 were read.

| re-check item | applied | rows |
|---|---|---|
| class → non_product for the 9 datasheet cells | 9 class plans, `reason` "datasheet cell value or fragment enumerated as a part" (the one the 145 servers cell plans carry), evidence per row | CPU1, CPU2, M2511, NVMe4 (X-Series shared parts), HDD1, SSD1 (B-Series), RAID00, SAS/SATA/U.3 (C-Series), GPU3 (HyperFlex). Read in the store: each named "Cisco &lt;SKU&gt;", 0 facts; HDD1 and SSD1 linked to one datasheet PDF, the other seven to no document. Now `pending_plan`. |
| SSD-SATA-800G(=) → Drives and storage | `^SSD-SATA-800G` in Drives and storage | 2 — the exact PID, because `^SSD-SATA-` would also claim the ten routers SSDs (SSD-SATA-200G … 4T) |
| UCS-MCX32G2RE11, UCS-MCX64G2RE11 → Memory | `^UCS-MCX` in Memory | 2 |
| UCS-MSD-32G(=) → Drives and storage | `^UCS-MSD-` in Drives and storage | 2 |
| UCS-S3348-HBAM5(=), UCS-S3348-RAIDM5(=) → adapters | `^UCS-S3348-(HBA\|RAID)` in Network and storage adapters | 4 |
| UCS-CPU-CVR-EP-M4=, UCS-CPU-GREASE, -GREASE2(=), -GREASE3= out of Processors | the CPU token, in Processors AND in the five family fences, is now `CPU(?!-CVR\|-GREASE\|-TIM\|-E[NP]2?-PNP\|AT)` | **20, not 5** — see "found doing it" |
| UCSC-SD-RSR(=) out of Drives and storage | the SD token is now `SD(?!BKT\|-RSR)`, in Drives and in the five fences; `^UCSC-SD-RSR` in **UCS C460 / C480** | 2 — see "one deviation from the letter" |
| the 4 CIVS rows | a line of their own: **Video Surveillance appliances / Video Surveillance Multiservices Platform / Storage System (CIVS)**, `^CIVS-` | 4 — see "the CIVS decision" |
| deviation a (AIR-PSU-BLKP1U, AIR-PSU-650W, AIR-PCI-1A-240M4) | read the notices; the three stay where they are, placed by one rule of evidence; the 5500 note's citation corrected | 0 — see "deviation a" |

### Found doing it

- **The Processors rule held 20 non-processors, not 5.** Found by a keyword scan of the series' names, then read by name: the socket dust cover
  (UCS-CPU-CVR-EP-M4=), five thermal-grease rows (UCS-CPU-GREASE, GREASE=, GREASE2, GREASE2=, GREASE3= — the review named four),
  two thermal-interface-material rows (UCS-CPU-TIM=, UCSX-CPU-TIM=), seven pick-and-place tool sets (UCS-CPU-EN-PNP, -EN-PNP=,
  -EN-PNP-C=, -EP-PNP=, -EP-PNP-C=, -EP2-PNP=, -EP2-PNP-C=) and five assembly tools (UCS-CPUAT=, UCS-CPUATI-3=, UCSX-CPUAT=,
  UCSX-CPUATI-3=, UCSX-CPUATI-4=). One token excludes all of them; the 16 UCS- rows go to UCS Server Components shared parts, the
  4 UCSX- rows back to X-Series shared parts (the 4.2 rule: a family-prefixed part that is not a component stays with its family).
  Those four carry stored kind `cpu`, so the components check names them (below).
  **What is left, and how much of it was read.** Processors holds 1,659 rows after the change. Printed and read in full: the 398
  whose name does not read like a CPU (no GHz / Xeon / Intel / AMD / EPYC / core count / wattage) — every one a processor PID
  named only "Cisco &lt;SKU&gt;" (UCS-CPU-A9…, -E5…, -E7…, -I…, UCSX-CPU-…, UCSAI-CPU-…) — and the 84 whose name carries an accessory
  word (tool, cover, kit, heat sink, thermal, riser …): every one a CPU sold "NoHeatSink" or "No HS, Tools". The other 1,177 have a
  CPU description and no accessory word and were not read one by one. The same accessory-word scan over the other five component
  series: Memory 17 (the UCS-MKIT memory kits and the C460 memory risers UCSC-MRBD, kept by 4.2), Drives and storage 2 (the
  UCS-MSTOR-SD carriers, listed for the kind rebuild), adapters 1 (R2X0-ML002= "Mezz Card w/ 1-SAS Cable"), GPUs 0, TPM 0.
- **`UCS-CPU-LPCVR=` (hyperconverged-systems) is NOT fenced.** The token would suggest a cover, but no stored document says what it
  is: the only cached page that mentions it is the C240 M4 data sheet, in a metadata PID list with no description. It is not
  placed by the servers mapping (HyperFlex's label places it); its leakage entry keeps its one row. Open for the kind rebuild.
- **Wireless: four controller supplies and six controller SSDs sat in the antennas line's shared parts** by the label
  "Antennas/Accessories" although their names name the controller, and three server modules sat beside them instead of in the
  unnamed-platform series 2.2.1 created for exactly that class. Placed by the evidence the review accepted for AIR-PSU-930WDC:
  - `^AIR-PSU1-770W` → 5500: AIR-PSU1-770W(=) "770W AC Hot-Plug Power Supply for 5520 Controller";
  - `^AIR-PSU2V2-1200W` → 8500: AIR-PSU2V2-1200W(=) "1200W V2 AC Power Supply for 8540 Controller";
  - `^AIR-SD240G` → AireOS Wireless LAN Controllers shared parts: AIR-SD240GBKS2-EV= / -KS4-EV= "Spare SSD for Cisco Wireless
    Controller 5520 and 8540" with their base PIDs (two series of one line), and AIR-SD240G0KS2-EV(=), whose own end-of-sale notice
    (eos-eol-notice-c51-737832) is "for Wireless Controllers 5520 and 8540" and which already sat there by the label check;
  - `^AIR-MRAID12G`, `^AIR-TPM2-` → Modules and power (unnamed platform): AIR-MRAID12G, AIR-MRAID12G-1GB, AIR-TPM2-001 — the
    MegaRAID and TPM class that series already holds, listed by aironet-accessories-eol15454 with no platform.

### One deviation from the letter

The re-check said UCSC-SD-RSR(=) → C-Series shared parts. Its name is "C460 M4 SD riser card", which names one series of the line
(A.3 rule 1, the rule that moved N20-BBFLA-230 to B230). In C-Series shared parts the reverse check would have proposed it for
UCS C460 / C480 at once; `^UCSC-SD-RSR` places it there. Not a drive either way, which was the finding.

### Deviation a — the notices, read once

Every stored 5520 / 8540 controller notice (store query over `source_docs`, 12 documents) and the cached text on the box:

| document | lists AIR-PSU-BLKP1U | AIR-PSU-650W | AIR-PCI-1A-240M4 |
|---|---|---|---|
| 5520 EoS notice, English (`eos-eol-notice-c51-744430`, doc 207ce8f749ad0805) | no | no | no |
| 5520 EoS notice, French (`…-744430-fr`, doc 4e2c1dc45dfe5152) | **yes** — "Panneau d'obturation de bloc d'alimentation pour les serveurs C220 M4" | no | no |
| 8540 EoS notice, English and French (`…-744431`, docs 2bed9a76bc7334bc, 3e2aa923d67a7aa4) | no | no | no |
| 5520 / 8540 SSD notice (`…-737832`, EN and FR) | no | no | no |
| Aironet Accessories (`aironet-accessories-eol15454`) | yes | no | yes — "…for C240 M4", no controller |
| Wireless Miscellaneous Accessories (`wireless-misc-accessories-sw-lic-eol`) | no | yes — "650W power supply for C-series rack servers" | no |

**One rule for all three: a part goes to a controller series when its own name or that controller's notice names the controller.**
AIR-PSU-BLKP1U: the 5520 notice lists it → 5500 (unchanged). AIR-PSU-650W and AIR-PCI-1A-240M4: no controller notice lists them,
and the two accessory notices that do name a controller for the supplies beside them ("770W … for 5520 Controller", "1200W V2 …
for 8540 Controller") and none for these two → Modules and power (unnamed platform) (unchanged). "C240 M4" alone does not name the
8540: other C240 M4 / C220 M4 appliances exist in this catalogue. The 5500 note cited the English notice; it now cites the French
copy, the one that lists the parts.

### The CIVS decision (recommended; mapping only, so reversible — operator to confirm)

The re-check put it as "a series of their own, or a category decision". **There is no category to move them to:** no Video
Surveillance or physical-security category exists, and `video` is cable access (GS7000, Prisma II, cBR-8, RF Gateway). The four
rows — CIVS-MSP-MEMUP6G "MultiService Platform memory upgrade to 6GB", CIVS-FAN-2RU= "Fan Assembly for CIVS-MSP-2RU",
CIVS-SS-4RU-KIT= "CIVS-SS: Rail Kit … for 4-RU", CIVS-ENC-KIT-OPT "CIVS-ENC Video Card Manufacturing Kit Option" — are no other
live Cisco part's siblings (no other `CIVS-` row in any category) and are not UCS C-Series parts. So a line of their own in this
category, one series, because no row says which of the two platforms the encoder kit belongs to. The series name's words were
checked against the review queues: the reverse queue is identical, the cross-line queue lost one row (below), nothing was added.

## Counts the edits moved, each by the rows that moved it

| check | before → after | rows |
|---|---|---|
| STATUS servers / hyperconverged-systems | 1,263 → 1,271 / 57 → 58 | the 9 cell class plans |
| LABEL wireless | 23 → 21 | AIR-SD240G0KS2-EV(=), SKU-placed now |
| CROSSLINE servers | 15 → 14 | CIVS-MSP-MEMUP6G (was proposed for "Memory" on the word) — withdrawn, placed |
| CROSSLINE wireless | 25 → 21 | AIR-PSU1-770W(=), AIR-PSU2V2-1200W(=) — withdrawn, placed where the queue said |
| REVERSE (all) | unchanged | same content, computed on HEAD's rows and on the rebuilt rows with the current mapping; 0 differences |
| components check (component kinds left in family shared parts) | 36 → 29 | out: the 8 cells, CIVS-MSP-MEMUP6G, SSD-SATA-800G(=); in: UCSX-CPU-TIM=, UCSX-CPUAT=, UCSX-CPUATI-3=, UCSX-CPUATI-4= (stored kind `cpu`, wrong) |
| cross-claims | 4 entries re-keyed, same row counts | HCI Processors 33 and 20, HCI Drives 3, HX Processors 1 — the claimant rule strings changed; reasons say so |

## Verification

- Rebuild of all 17 pages from the live store (read-only): `parts` per category identical to HEAD's pages on all 17; `layered` /
  `pending` moved only on servers (8,229 / 1,263 → 8,221 / 1,271) and hyperconverged-systems (1,136 / 57 → 1,135 / 58); 56 changed
  rows, all intended.
- `tests/layersStanding.test.ts`: **997 passed, 0 missed** (1,004 before; the 7 retired "still exists" checks of the components list).
- `tests/productLine.test.ts`: **472 passed, 0 missed** — 20 new witnesses: 15 placements and 5 controls (a real CPU `UCS-CPU-E52690E`
  and an SD card `UCSC-SD-16G-C420=` still placed as components; BLKP1U, 650W and PCI-1A where they were).
- **Sabotage:** with HEAD's servers and wireless mappings restored in place, exactly the **15 predicted witnesses went red, each
  naming the old rule** (`sku ^UCS-CPU`, the old SD token, `label Antennas/Accessories` …), and the 5 controls stayed green. The
  edited mappings were put back and compared byte for byte.
- `npm test`: 67/72 — the same five pre-existing red suites (arrangementFreeze, completeness, cupLedger, securityShapes,
  source-fields) with **identical MISS lines** to the previous run at 9906ab5's build; the only differing lines are the two suites
  above. `npm run typecheck`: exit 0.

## Waiting on the operator

1. **Publish** the rebuilt pages (`bash scripts/publish-layers.sh cisco`).
2. **§2 decisions:** the non_product class question (§3.7 of the handoff — until answered, the 896 + 9 class plans cannot run);
   confirm the CIVS line.
3. **§3 runs**, group by group, each with its dry-run counts and a verification from a new connection.
4. **§5** the arrangement-site republish.
