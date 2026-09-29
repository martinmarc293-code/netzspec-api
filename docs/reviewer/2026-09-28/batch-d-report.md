# Batch D (rulings Q8-Q11) — report, 29 Sep 2026

Board on the deployment (6175802, key 17): **28 passed, 5 failed, 0 unavailable, 0 not exercised (of 33)**; self-test **24 proven, 0
BROKEN, 9 unproven**. Flipped: kind_profile_parity (Q8). Red: four_sets_sum (Q17), unknown_zero (Q15/Q16), conflicts_classified
(Q13/Q14), export_profiles_roundtrip (Q12/Q18), vendor_coverage (ruled). Log: `docs/reviewer/2026-09-28/verifier.txt`.

## Two corrections first (each withdraws part of a ruling's premise)
1. **Q9 (1)** rested on my claim that the 44 FLMESH-HW-ACC were accessories. The URWB end-of-life bulletin names each one's
   Fluidmesh product (FLMESH-HW-ACC-10 = FM-LMR240-RPSMA2QMA-4FT ...), and wirelessKind already classifies those ids: **32
   cables, 3 mechanical, 3 PoE injectors, 6 accessories** (FM-EMP, which the axis cannot place, took (1)'s default). Applied
   by the document, as (2) rules for the rest.
2. **Q11** rested on my claim that `source_docs.doc_id` is a content hash. It is **sha1(url)** (0001_init: `doc_id ... sha1(url)`,
   `url UNIQUE`; content is `content_sha256`), so "revision-drift = structural 0" was a zero by construction. Re-measured:
   one URL + one cell 835 = **826 normaliser-split + 9 revision-drift** (2 whose raw text changed across fetches, 7 whose value
   changed under the SAME normaliser across fetches); one URL + two cells 7,218 (1,322 one fetch, 5,896 across fetches: still
   the multi-column reader, the cells differ); two URLs 7,835 + tier-0 42. Only 9 rows moved against the ruled proposal.

## Landed
- **Q8** 4b35d45: wireless heat sink / riser / interposer -> mechanical, CW-ACC-MEM-32G -> drive (in place of its 13 Sep
  `module` rule); replay over 41,073 stored kinds moved exactly 4. Run 1390 retracted the heat sink's power_max
  (scripts/retract-mis-keyed.mts: a named rule = selection AND per-row verification). wireless.module asks power_max; sync run 1391.
- **Q9** b61a80f + 55bba21: 113 KIND_OVERRIDES with the line of each part's own document (evidence field); 7 evidenced parts HELD,
  and the 12 HX-16 licences withdrawn (Q16)
  (data/dryrun/q9-kind-evidence-cisco-2026-09-29.tsv). src/core/unknownEvidence.ts is the one definition for unknown_zero,
  its self-test and the report's acquisition queue (`unclassifiable_no_evidence`); ratchet data/ratchets/unknown-no-evidence-cisco.json.
- **Q10** 2923cf5 + 4061ad9 (NORM 1.8.7): three protocol rules, each with its recovered witness; run 1392 ieee 24 superseded;
  run 1393 protocols 206 superseded = 43 from the 1.8.6 split + 163 from the grammar alone (one swap each: "IPv6 translation:
  ... (NAT-PT)" kept whole, the "IPv4" the salvage pulled from its description goes). Unclassified 5,671 -> 5,564: no raise.
- **Q11** a767b3e + 715fae2: migration 0034 (class, CHECK the four), conflictClass.ts shared by the writer (every new conflict
  classed at birth; store suite 108/108 on the migrated test DB) and the backfill; run 1394 classed 15,930 (53 held);
  run 1395 resolved the 86 orphans no-live-value. conflicts_classified now asserts plan A10 in full (0 normaliser-split too).

## Questions
Q13 **normaliser-split (826)**: "re-normalise both sides" cannot be done as ruled -- 818 never recorded the older side's raw
(rows older than migration 0008) -- and measuring what the current store serves shows every one is HISTORICAL: all 826 have a
current fact from the SAME URL, re-extracted since (newer locator) under a newer normaliser (1.8.7 310, 1.8.6 108, 1.8.3 139,
1.8.0 5, 1.7.0 38, 1.5.1 95, 1.5.0 131). In **694 neither disputed value is served any more** (both were older readings, e.g.
bullet-joined lists since split), in **114 the served value is the one the row REJECTED** (C6800-SUP6T-XL acl_entries 256 vs
256000: the K-magnitude fix; MS130 dimensions), in **18 the current normaliser reproduces the kept value** (altitude 4206.24 vs
4.20624). PROPOSAL: resolve all 826 `superseded-reading`, recording the current fact id -- a dispute between two readings of one
URL that the current extraction has replaced, never a disagreement between sources.
Q14 **the 53 Atlas conflicts**: "migrated: held in Atlas", no evidence object, and NEITHER value is held by any fact (so nothing
says where either came from). PROPOSAL: resolve `no-held-value` beside the orphans -- a disagreement between values the store
no longer holds.
Q15 **unknown_zero's 7 held evidenced parts** (the check stays red on them): N9K-AC04-A/B are switch HOSTNAMES in a white paper's
config listing -> class non_product; 4X100G-LR-S is a fragment of QDD-4X100G-LR-S (NCS 1014 data sheet) -> retire as a fragment;
UCWS-WT-SM-INN12 (both bulletins say VOID), MDS-9222I-75-PPT (row repeats the SKU), 9270F-DIFL (row names only
'9270-DIFLA/B/SI') -> their documents say nothing: count them with the no-evidence term; AIR-N-3006-DTA-K9 your 28 Sep call.
Q16 **HX-16-DC16C/DC24C/ST16C/ST24C (+ -NS, -RM): 12 Windows Server 2016 licences filed as hardware** (spec sheet lines). Giving
them kind os-license broke the round-7 acceptance (a NAMED kind asked nothing on hardware: cupLedger, caught by the 715fae2 build,
nothing from it committed), so they stay unknown (evidenced, 12 of unknown_zero's 19). PROPOSAL: product_class -> licence (they
leave the hardware denominator with reason non_hardware; kind os-license then as for every licence).
Q17 **four_sets_sum veto (243 triples, 2,634 part-cups)**, triaged by explicit rules (data/dryrun/veto-triage-cisco-2026-09-29.tsv):
| remedy | part-cups | triples | what |
| --- | --- | --- | --- |
| R4 widen | 1,225 | 134 | a datasheet (html/pdf table, seed) states it for the kind: mtbf on linecards/PSUs/modules, weight, dimensions, cooling, psu_redundant ... |
| R1 retract | 359 | 18 | module_slots mined from a platform number onto non-chassis parts (CRS-8-LIFT-TUBE= 8, N77-C7718-FAN-2 18) |
| R3 rekey | 154 | 7 | a PSU's rated output stored as power_max (135) -> psu_rated_output (the power kinds' REQUIRED cup); RF-cable antenna_connector (19) -> connector |
| R2 reclassify | 105 | 4 | storage-networking power cords filed as cable (61), an mLOM filed as memory (18), S3260 server nodes as chassis (16), S3260 drives as server (10) |
| to read | 791 | 90 | mined from names / bulletins (AP mounting 'wall'/'ceiling', bundle ports, video temps): each triple read before any remedy |
PROPOSAL: R1 + R3 + R2 as dry-run plans read row by row, then R4 as widenings with witnesses, then the 90 read triples.
Q18 **the export (Q12) against the recorded files** (hexcat Cisco_Switches_LATEST + stage3_Cisco, all UTF-8 BOM + CRLF): the
switch Attributgruppe is recorded as **"Switch"**, not "Switches" (13,384 rows); "Transceivers & SFP Modul" as ruled. The recorded
Attributes file has **8 columns** (Artikelnummer, GTIN, Attributgruppe, Attributname, Attributwert, Sortiernummer, Datentyp,
Attributart) where the ruling says 4; Condition 7 columns, FAQ 2 (force-quoted Q||A##Q||A), Main 19 (18 without "Überverkauf
Plattform Hexwaren"). The Wawi attribute names are 20 for Switch and 14 for Transceivers & SFP Modul. Which 4 Attributes columns,
and is the group "Switch"? Main carries Titel-Tag (SEO), Meta-Description (SEO) and URL-Pfad: confirm the export surface is where
this repo's "the site's concerns stay out" rule gives way.

## Residues
combo SFP+ double count · ETS missing from ISSUER (2 NCS2K facts) · MX75/MX85 corroborated-state recompute · antenna_gain routers
lease lapses 2026-10-06 · ucsKind calls a PCIe riser `nic` and an interposer `drive` (Q8 made them mechanical in wireless only).
