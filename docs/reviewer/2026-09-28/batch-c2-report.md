# Batch C part 2 — report, 29 Sep 2026

Board on the deployment (501b7ed, key 17): **27 passed, 6 failed, 0 unavailable, 0 not exercised (of 33)**; self-test
**24 proven, 0 BROKEN, 9 unproven**. Log: `docs/reviewer/2026-09-28/verifier.txt`.

## Landed
- c249f73 / ea27527 / d2bd620: (a') salvage NORM 1.8.5, portParse (5 rules from replays), NORM 1.8.6, ports role, Q7 convert.
- Box runs 1379-1385 (sync 1379/1383; renormalize ieee 1380, protocols 1381, ports 1382, certifications 1384; convert 1385).
- 0cbe5c5 verifier + build: endpoints_alive probes were MALFORMED (/v1/report without `name`, `limit` on /v1/stats/gaps, bare SKUs
  on /v1/compare): three 400s reported as dead routes; a 400 is now its own verdict (refused = my defect). link_integrity: the site
  had no layer pages (build-layers ran without --site, 16 dangling hrefs); data/site/BUILD.json + the deploy carries the site + a
  stale-site guard. convert-lan-wan-ports classed AG; key 17's holder recorded.
- 785eebd kind_profile_parity prints the FULL grouping of an uncovered cup (it printed the one pair already ruled).
- af390a0 one_build compares the artefacts' contract hash with the one the CODE computes: the contract had drifted since 28 Sep
  (608 -> 610 keys, ports role, Batch C profiles; bcfc4c1ee314d3c2 vs 17b502e336ebefb6) and every artefact agreed on the stale hash.
- 501b7ed artefacts: rebuild on 0cbe5c5 (MISS diff new 0 vs both baselines), contract regenerated, 89 artefacts one build.
- Flipped: one_build, runs_have_approval, endpoints_alive, link_integrity, keys_hygiene.
- Transient, not a regression: the d2bd620 build's collabKind "failed without printing a MISS line" re-ran clean on the frozen tree.

## Red (6)
kind_profile_parity -> Q8 · unknown_zero -> Q9 · conflicts_classified -> Q11 · export_profiles_roundtrip -> Q12 ·
four_sets_sum (VETO 247 triples / 2,673 part-cups; top: wireless/ap mounting 101, routers/mechanical module_slots 76,
routers/power power_max 73, video/transmitter connector 70, storage-networking/cable input_voltage 61) -> next batch ·
vendor_coverage (red by ruling).

## Q8 — module power_max (the parity check's last kind)
Grouping (real requirementFor, live cisco hardware `module` parts; own = non-inherited current power_max facts):
| category | asks | modules | own power_max |
| --- | --- | --- | --- |
| interfaces-modules | req | 68 | 0 |
| security | req | 176 | 0 |
| switches | req (Q3) | 274 | 19 |
| routers | ruled (rule 6) | 351 | 0 |
| wireless | NOT asked | 54 | 1 |
The 54 wireless modules after the Q3 reclassification: AIR-RM3010L hyperlocation 19, AIR-RM3000M security monitor 10,
C9800 network modules 10, AIR-BLE-USB beacons 5, AIR-MOD-POE/SPOE 3, AIR-VPN-WLC, AIR-RM-VBLE2-K9=, COGNIO-SEWIFI-CB, and FOUR
that are not modules: CMX-HS-C220M5 (heat sink; ucsKind says mechanical), AIR-PCI-1A-240M4 (PCIe riser), IWA-SATAIN-220M6 (SATA
interposer), CW-ACC-MEM-32G (32 GB application-hosting storage). The one own fact is the heat sink's "150W" = the CPU class it
cools, mis-keyed.
PROPOSAL: (1) by SKU in wireless: heat sink, riser, interposer -> mechanical (passive boards; collab already refuses riser-as-nic);
CW-ACC-MEM-32G -> drive. (2) retract the heat sink's power_max fact (plan file, reason mis-keyed CPU class). (3) PHYSICAL_OBJECT_CUPS
wireless.module += power_max. Parity then holds: req in four categories, routers ruled.

## Q9 — unknown_zero (362 live cisco hardware parts in kind unknown)
361 have a name that says nothing beyond the SKU; 130 are linked to >=1 document; 232 are both SKU-only AND unlinked.
By category: video 260 (sku-only 260, doc-linked 52), wireless 48 (47, 46), sucs 20 (20, 7), hyperconverged-systems 13 (13, 12),
collaboration-endpoints 12 (12, 10), optical 5, hci 2, storage-networking 1, interfaces-modules 1.
Families: numeric 263 (4014289, 10-1022109-01 ...: video headend PIDs), FLMESH-HW-ACC 44 (all doc-linked), HX-16 12, SPVAC 9, N9K-AC04/N20-AC0002 4,
UCSC-LPC 4, UCSXE 3, UCSC-DLOM 3, HCIX/UCSX-NVL 4, TTC5 2, CIUS-BATTERY=, MDS-9222I-75-PPT, AIM-VOICE-30, XRV-PCIE-IQ10GF.
PROPOSAL: (1) FLMESH-HW-ACC -> accessory by SKU (44). (2) the other 86 doc-linked: kind from their document titles, dry run read
row by row. (3) the 232 with neither a name nor a document: counted APART by the check as "no evidence to classify" (named, a
number beside the red, like vendor_coverage), because any kind given them is a guess; the check stays red on the evidenced ones.

## Q10 — NORM 1.8.6 on ieee_standards and supported_protocols (held after run 1384)
Replay reading: `data/dryrun/ieee-protocols-186-replay-cisco-2026-09-29.txt`.
- ieee_standards: 24 of 2,091 facts change, all WAP5xx: the member "802.11i (WPA2 secur ; Safety:" loses its " ; Safety:" label;
  members 41,449 -> 41,449, verdicts identical, fused 47 -> 47. PROPOSAL: replay.
- supported_protocols: 43 of 2,161 change (39 other, 4 split); members 14,487 -> 14,688, unclassified +141 (over the ratchet),
  accept +56. The new members are chunks the old normaliser DROPPED from the raw cell: 802.11a/b/g/n/ac on the 8800 phones, the
  multicast list (PIM-SM, BSR, Auto-RP, MSDP) on Nexus 3000. PROPOSAL: extend the protocols grammar over those 201 members first
  (they are mostly protocols), replay, and let the ceiling rise only by the measured residue, recorded with the run id.

## Q11 — conflicts_classified: the class predicates (15,983 open; 86 orphans)
Measured over every open conflict (both sides' evidence: doc_id is a CONTENT hash, locator, norm_v):
| bucket | rows | class |
| --- | --- | --- |
| same doc, other cell | 7,218 | same-doc-multicolumn |
| same doc, same cell, other normaliser version | 820 | normaliser-split |
| same doc, same cell, same normaliser (dual-unit cells: 0.28 lb -> 0.127006 vs 0.13 kg; 1 pair identical) | 15 | normaliser-split |
| other documents | 7,835 | source-disagreement |
| a side names no document (tier 0 / operator) | 42 | source-disagreement |
| no evidence object (Atlas migration) | 53 | read, then classed from the facts' provenance |
| same URL, other bytes | 0 | revision-drift: a STRUCTURAL zero today (source_docs holds 8,387 urls = 8,387 doc_ids; no conflict names a replaced revision) |
PROPOSAL: migration `conflicts.class` (CHECK the four); classify-conflicts run (plan file); the conflict writer sets the class at
insert; normaliser-split -> 0 by re-normalising both sides under the current normaliser (agree -> resolved, still apart ->
re-classed); the 86 orphans resolved as `no-live-value` (never deleted). Vendor split: cisco 15,079, juniper 815, others 89 —
the classifier is vendor-agnostic; other lanes' rows classified, not resolved.

## Q12 — the export (standing order item 2) vs the check
The check asks FIVE profiles (jtl-main, jtl-attributes-switches, jtl-attributes-transceivers, jtl-faq, jtl-condition) and only
HTTP 200; its comment says a 19-column main file. The standing order says FOUR (jtl-main | jtl-attributes | jtl-faq |
jtl-condition), main 18 columns (no Ueberverkauf / Plattform / Hexwaren), attributes 4-column long. PROPOSAL: the standing order
wins; the check asks the four profiles and asserts the contract (BOM + CRLF, main `;` 18 named columns, attributes 4 columns,
FAQ `Q||A##Q||A` force-quoted, German decimal commas, no price column, the acceptance SKUs present or named as not shop_ready
with the failing condition). Build order: shop cups + shop_ready -> the four profiles -> the check -> the acceptance diff.

## Residues (named, not blocking)
combo SFP+ double count (ruled residue) · ETS missing from ISSUER (2 NCS2K facts) · MX75/MX85 ports facts carry two documents:
the `corroborated` state needs a recompute pass to reflect the second · antenna_gain routers lease lapses 2026-10-06 ·
mechanical: the ucsKind classifier calls a PCIe riser `nic` and an interposer `drive` (collab refuses riser-as-nic).
