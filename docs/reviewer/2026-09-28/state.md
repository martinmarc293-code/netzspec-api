# netzspec state — 28 Sep 2026. THE MEMORY. Read this + the current item's decision file. Nothing else.

## Standing rules
- Box, not tunnel, for any run measured in round trips: `ssh -i ~/.ssh/dubaifix_hetzner root@77.42.72.81`, deploy first. Same pass: 4 h vs 13 s.
- ONE WRITER AT A TIME. A write to `facts` IS a write to `parts` (`touch_parts_by_part_id` trigger) — that deadlock cost run 1275.
- One script per run: dry-run → gate (precision/recall; EMPTY sample scores 0) → commit → controls printed.
- Artefact order: recompute → ledgers → censuses → report. Building ledgers first refuses the build.
- A killed run is closed with `scripts/rollback-killed-run.mts`, never by hand. The harness's "exit 0" is the WRAPPER's.
- Report ONLY on: a batch of 3–4 items done, a claimed green, or a ruling needed. 5 lines: commit · flipped · blocked/ruling · verifier · self-test. No prose; dry-run rows in a repo file, give the path.
- A ruling needed mid-batch: park the item, continue the batch, question goes in the batch report. Nothing waits on the reviewer.
- Decision files short and append-only; no sabotage narration beyond the commit line. Verifier log committed with each report.
- Verify a chat send: composer must read 0 chars afterwards.

## Board: passed 32 | FAILED 1 | unavailable 0 | not exercised 0 (of 33) · self-test proven 24 | BROKEN 0 | unproven 9 (24271ed, 30 Sep)
HEAD/deployed 24271ed (artefacts built on b416463, contract c7b80d502adb8305). Red: vendor_coverage only (ruled out of scope). Log: docs/reviewer/2026-09-28/verifier.txt

## Flip order
| # | item | status | what to do (from its decision file) |
| --- | --- | --- | --- |
| 1 | fill_state_partition | BATCH A (predicate) | GREEN when: every live fact on a scored part in exactly ONE of the six states and they sum to live facts; histogram recorded per build; vs the previous build filled non-decreasing, unverified_seed + mined_from_eol non-increasing - a reversal without a recorded run is red. Only `filled` is filled (filled_inherited beside it, never merged); the share is PRINTED, not asserted |
| 2 | runs_have_approval | GREEN | run 1292: reviewer_retroactive on 20; run 1293 retro-gate: 952 pass → exception, 942/959 fail → 87 facts retracted (plan data/dryrun/retro-gate-2026-09-28.tsv) |
| 3 | openapi_schemas | GREEN | /v1/models/{vendor}/{model} routes Model (families = alias); the check now requires a route per level shape |
| 4 | doc_category_by_relevance | GREEN | runs 1289/1290: 68 titles, title_source pdf-info-trailer; run 1291: 15 title_state none |
| 5 | column_backed_never_facts | GREEN (on 0b4b83e) | run 1296 layers (MDS 9100/9200 lists renamed), run 1297: 45 -> 0 (19 chassis-member, 24 umbrella, 2 relations incl. 1 QSFP -> MDS 9000). Earlier: | run 1294: 102 prefix dups; run 1295: 933 relations + 1,111 retracted. 45 parked: unlisted chassis 24, MDS 9000 umbrella 20, 1 router series |
| 6 | enum_values_in_domain | BATCH A2 | fa0ac3e: CISCO line judges (out-of-domain + refused shape members + unclassified over data/ratchets/shape-unclassified-ceiling-cisco.json, missing = red), brand-wide printed; ceiling = min(ceiling, now) per build. Run 1350 correct-tier0: standard 433 normalised in place, 122 retracted. Left: audio_codecs 80, antenna_type 5, spatial_streams 5 (non-seed) |
| 7 | required_cup_defined | AWAITING-RULING | 30 cups = 3 keys. bundle_contents 0 facts, video_codecs 0 facts, product_compatibility 79 |
| 8 | relations_for_components | GREEN (3f2762b) | run 1306: 79 facts -> 45 model lists = 118 compatible relations, 29 prose + 5 mixed retracted; product_compatibility + bundle_contents now RELATION_BACKED (per-kind filled/not_held in the report) |
| 9 | conflicts_classified | BATCH A2 | run 1347 (2,097 states, 622 orphans); run 1351 backfill 1,135 evidence rows onto 786 facts; run 1352: 145 tier-0 flips (151 - 6 retracted by 1350) + 18 orphans (all left by 1350). --evidence HELD: +105 promotions, 397 demotions (371 set corroborated by migrate-atlas, one doc in fact_evidence) - ruling asked |
| 10 | twin_parity | BATCH B | 19 = 6 category (bases classed software in ios-nx-os-software/cloud-systems-management: PARKED, settled rule refuses) + 13 kind: 9 name propagation (--from-twin), 2 plurals, 1 inch-mark repair, 1 residue UCSW-MSX-PCBL. docs/decisions/2026-09-29-batch-b-twins-parity-derived-na.md |
| 11 | kind_profile_parity | BATCH B | widenings server/bundle/module + optical chassis (PARITY_WIDENINGS, 52 cups); evidence column; UCS power-cord kind (64); flash off im/memory. cable stays divergent (media in 8 cats, not 6: needs cable_construction) |
| 12 | unknown_zero | 363 | 12b block landed: ont/olt (18 PON rows + the D-PON ONT, moved), device (12 MobileAccessVE, wireless axis), CIT3-FI moved + fabric-interconnect, AIM-DES/BP series fixed (run 1313); AIR-N-3006-DTA-K9 back to unknown (a group-level guess); 362 = name gap. OPEN: pon_ports / pon_standard have no enabled source (source-fields) |
| 13 | four_sets_sum | BATCH B | na derived in kindQuestionSet (keyed, refuses without both; 340 pairs sum to 605; na min 166); veto FAILS the check; recompute asserts; /v1/fields?category=&kind= applicability |
| 14 | keys_hygiene | GREEN | operator revoked ids 1 and 6 (29 Sep 09:49, keys-cli); 3 (live site) and 16 (reviewer) active; check PASS on the box |
| 15 | vendor_coverage | OUT OF SCOPE | 3,476 parts, 12 vendors with no axis |

## Rulings given (never re-ask)
- MX move: 18 → security/firewall; 4 Z → routers/router role smb. DONE (runs 1268–1272, 1277/1278).
- Ghost MX rows MX16/18/26/650 → non_product + reason `datasheet_cell`. Class ALREADY non_product; only the reason is missing; detector population is the 716 `unknown`, not 4,313.
- DONE: cellular gate; German (ENUM_LABELS wins). RULINGS on batch 3 (NEXT, in order): (c) derived facts inherited=true + inherited_from = the input's family row (state stays filled-derived); (b) the 44 truncated inherited cells via apply-extract from the cached document (cache miss -> flag truncated, never complete); (a) stale replay per field ON THE BOX with --allow, 25 distinct (raw,value) samples per key read and quoted, predictions pinned (ieee_standards one-member runs fall; supported_protocols unclassified falls).
- Term 13 on meraki/security-camera: recorded exception EXPIRING on physical-security's creation. TODO.
- connector: domains per category as measured (+ d8/m12/din I added); routers + collab rows back; WIRELESS row withheld (82 of 141 are mains cords, no `power-cord` kind).
- column-backed: 5,156 duplicates retracted (run 1280); 728 only-source moved then retracted (run 1288); 1,258 remain.
- sub_brand: column landed (0028). Populate rule = vendor cisco AND (name/series says Meraki OR SKU ^M[SRXVGT]\d | ^Z\d | ^MA- | ^CW\d | -M(=)?$). ^GR/^GS OUT (505 false, 0 true). TODO.
- runs_have_approval: the table's 1,272 is right (the brief's 7,533 was the reviewer's error); judged from 2026-09-11 (first recorded approval); earlier misses named, never folded.
- Model: route /v1/models/{vendor}/{model}, field `model`, /v1/families is the alias. DONE d956173.
- PDF titles: Info-trailer /Title accepted (20-of-68 sample passed), title_source = pdf-info-trailer; the 15 with no title anywhere: title_state = none, nothing invented.
- The 23 runs: approved = reviewer_retroactive, evidence = plans_agree_with_rows (20). Gate misses 942/952/959: retro-gate; pass -> exception like 69, fail -> retract.
- 5a: licence/software fact naming its platform -> relation `licenses` (licence -> hardware SKU/series), then retract. Never a series on a licence.
- 5b: a chassis its series already lists -> retract as duplicate-by-membership (no information lost). Module/PSU naming a host chassis -> `compatible_with` relation (the 6.9 pass), then retract.
- 12: unknown_zero reports vendor_coverage's 3,476 counted apart; its own number is the 468. The 106 named parts -> kind decision process: ONE decision file, by series, passive-optical first.
- 29 Sep batch 1 (ACCEPTED): sync-dictionary unblocked (6052ee4; runs 1320-1322; the guard re-reads a label-unit raw from the stored value); MISS-level diff in run-tests + mould-build.sh (snapshots in /var/lib/netzspec-api/miss/<vendor>/); first baseline docs/reviewer/2026-09-28/miss-baseline-laptop-0453262.json. | batch 2 (A-D, code 664d515 deployed): A "switch model" admitted only over attributable PIDs + MODEL_ROW_UNATTRIBUTABLE + map anchored + 2 pon_ports rules; measured with REAL urls (my earlier harness passed a placeholder: CGP-* was always a PID): 3 pages +170/-14 (dividers/footnote), 4,755 silent drops now recorded; apply run 1323 inserted 16 (pon_ports on both OLTs + 4 ONTs). B pon_standard derivation registered, witness table 8/8 (G.987 = xg-pon, not the reviewer's xgs-pon). C dictionary_in_sync (rolled-back real sync). D host-named title check. Board 17/10/3/3 of 33, self-test 21/0/12 (3143985).
- 29 Sep batch 3 (rulings on batch 2), built: (1) source_docs.extract_defects (0033; RESULT carries defects; NULL = never measured) - run 1326 recorded the PON sheet's {VALUE_TRUNCATED 3, MODEL_ROW_UNATTRIBUTABLE 1}; (2) derive-pon-standard run 1327 wrote 7 gpon (idempotent; tampered witness refuses); (3) splitter 1.8.1 (prefix runs, PID-or) + extractor list cap for prefix runs: apply 1328 superseded the 2 psu_options, renormalize --doc run 1329 the 44 inherited ieee_standards; counts: PID-or 2 -> 0, prefix-run one-member 211 -> 167 (all 167 stale older-normaliser values the current code splits). Rulings -> batch 4. Found by the rebuild: derived facts were replayed by the normaliser (would_refuse 2; renormalize would retract) - 9ee38ca replays them through their derivation.
- 29 Sep batch 4 (rulings on batch 3): (c) run 1336, the 7 derived pon_standard now inherited=true from catalyst-pon-series. (a) rfc_compliance run 1337 (286 changed; 0 lose text, 0 undo a split). ieee/protocols HELD (92/116 replays grew a member) -> ruled NORM 1.8.2: the pre-bullet head takes the ordinary separators, a spaced middle-dot run is a bullet (sabotage red on both) -> grew 35/95, all by-design residue (a bullet item keeps its commas: 1+8 raws; commas only inside brackets: 1+7), 0 text lost. (b) CORRECTED: ieee_standards was always hand-written INHERIT_CLASS_A (my 'in no class' read only the generated file; the 9305ca0 C line was inert, removed); the real blocker was the family gate.
- 29 Sep batch 5 (rulings on batch 4): family gate = model OR layer 4 (refused->ok 10,172, ok->refused 0; partSeries required + undefined throws; the type found 4 callers in scripts/ incl. retract-inherited); freeze pins inherit_classes + normaliser; repair-truncated for the 1,072 cut cells over 61 docs (strict-prefix proof; cache miss / still cut never complete). Repair dry run 1,054 / 14 not cut / 4 refused (named, never by hand); reading its 57 cells found 1.8.3 (a prefix run delimits its ;-chunk: ieee 850 + rfc 72 change, 0 grow, 0 lost but 40 label heads); ORDER approved: deploy 1.8.3 -> repair -> renormalize both -> one rebuild. NEXT: comparator round (series-in-family; glued prefix, c9350 must not match a 9350 in another line), flips read first; remerge OFF until then.
- Judge a block by a MISS-LEVEL diff of every suite against the session baseline, never by suite pass/fail: layersStanding went 1 -> 36 and cupLedger 3 -> 6 behind a clean suite-level diff (fixed 28 Sep; now in mould-build.sh). Check and commit are separate commands (ec3fb28 shipped a type error by joining them).
- LANDED (28 Sep block, rulings now live in code + decision files): 12a relation-backed requirement (RELATION_BACKED on the dictionary key; sourced = doc_id or source_url; filled >=1 FROM the part else not_held, out of the denominator; per-kind filled/not_held in the report); 12b ont = ports + pon_ports, olt = + pon_standard + module_slots, in switches; AIR-330-* -> wireless `device` (a written ruling outranks my table); 5c series lists extended, umbrella/router facts retracted; the 106 per docs/decisions/2026-09-28-unknown-kind-106.md.
- STANDING ORDER (29 Sep, operator via reviewer; replaces the switches pilot): (1) board first -> 32 of 33 green, vendor_coverage red by ruling; (2) /v1/export?profile=jtl-main|jtl-attributes|jtl-faq|jtl-condition&vendor=cisco, paginated, product_class=hardware AND shop_ready; main 18 cols (no Ueberverkauf Plattform Hexwaren), attributes 4-col long, FAQ/Condition as recorded, German decimals, no prices; groups from the mould per category (Switches / Transceivers & SFP Modul names exact) + published group list; shop cups: switch layer, transceiver fiber_count/cable_construction/application/transceiver_type, gtin, hs_code, shipping_weight_kg, variant_of/bundle_of/model_of, sub_brand; shop_ready = every group attribute resolvable + real name + weight + Kat-3 + sanitized slug + no banned phrases, counts per category; (3) fill by unlock count: form_factor -> media -> 160-cut re-extraction -> mapper gaps -> name lane -> acquisition; (4) acceptance SKUs C9200-24P, C9200-48P-E, C9300-48P, CBS350, a Meraki MS, SFP-10G-SR, QSFP-100G-CU3M, QDD-400G-DR4.
- PAUSED 29 Sep ~14:00 UTC (laptop off). Batch C part 2 IN PROGRESS. Done since 6fbc16a: key id 17 `verifier-box` minted (read; holder+channel recorded; token ONLY in /root/netzspec-verifier.env mode 600 -- `set -a; . /root/netzspec-verifier.env; set +a` before the board); restamp-orphan-withdrawals full run: 1,602 inherited component rows retracted (605 held). RESUME, rulings of 29 Sep in hand: (d) PHYSICAL_OBJECT_CUPS rows + PARITY_WIDENINGS witnesses, measured lacks: bundle product_compatibility -> collab, sucs, wireless; chassis rack_units -> ROUTERS (not hci: hci asks; the pair view again); module data_rate -> interfaces-modules + routers (routers would hit rule 6: ask); module cellular_bands gated on `cellular` -> interfaces-modules, switches, security; supervisor fabric_bandwidth -> storage-networking + exception mac_table/uplink_ports (Fibre Channel); pluggable = transceiver profile; antenna_gain routers: measure, lease exception; cable pc/connector re-measure (collab connector domain has hdmi/usb). (a) drop REFUSED shape members (read 25 distinct per key, quote in --allow). (c) fix parsePorts (clause-local connector; PoE option), replay ports, then lan/wan. (e) layer_parity on layer 4; plans_agree reads the committed plans artefact; build the site. Then ONE rebuild (re-records fill_state), board with the key, report, Batch C rest (veto 249, unknown_zero: 47 FLMESH-HW-ACC by SKU).
- RESUMED 29 Sep ~16:30 UTC (new session; old chat full). Parity full view sent (1440244, parity-full-view.md). RULINGS 16:5x UTC:
  Q1 chassis = the UNION in all six cats (altitude_max, power_max, product_compatibility, temp_operating, temp_storage, rack_units; rack_units UNGATED on chassis in sucs/hci).
  Q2 module data_rate: exceptions interfaces-modules (DSP/voice/crypto, witness PVDM4-128) + routers (rule 6).
  Q3 fix parityRuled (a ruling covers ONLY the categories it names; the rest agree or carry their own); module power_max -> switches;
     wireless `module`: reclassify ~30 DIMM/SSD/CPU/RAID/TPM/NIC by SKU into component kinds, then re-measure.
  Q4 wireless: split power-cord by SKU (82 mains cords; the earlier ruling stands), then connector asked of the 59 RF cables.
  (a') APPROVED (replaces (a)'s plain drop, which lost 802.3by/IEC 60950-1/IPv4/SIP...): a refused member is REPLACED by the
     identifiers embedded in it; conditions: each salvaged id must classify ACCEPT by its key's shape; protocol vocabulary =
     closed table, witness per entry, sabotage (SVIs/LOM/VEPA loose grab must fail); per-key counts before/after (accepted,
     salvaged, dropped) in the plan; zero members left -> RETRACT, never empty; raw keeps the cell. NORM 1.8.5, then
     renormalize --vendor cisco ON THE BOX. Other vendors' 38 refused members: reported only.
  COMMITTED: 6bc3f05 (d) ; cccaa8e (a') NORM 1.8.5 salvage + (c) portParse + (e) verifier (layer_parity on layers, plans from
     the artefact, key sent, ledger_parity served-vs-committed, site built by mould-build). NEXT ON THE BOX: deploy -> sync-dictionary
     -> renormalize dry runs (ieee_standards, certifications, supported_protocols, ports; --vendor cisco; --allow quoting
     data/dryrun/refused-members-cisco-2026-09-29.txt) -> commit runs -> mould-build.sh -> board with key 17 -> report.
     lan/wan -> ports needs a ruling: the ports struct has NO role field ("retiring into ports with a role").
  DONE ON THE BOX (c249f73): sync-dictionary run 1379 (4 inserted, 48 updated); renormalize COMMITTED run 1380 ieee_standards
     466 superseded / 1 retracted, run 1381 supported_protocols 1,005 / 18, run 1382 ports 105 / 33 (all optics counts). A box
     probe proved ieee/protocols changes are the reshape alone (0 splitter-driven). portParse read row by row 4x -> 5 rules
     (c249f73). A rebuild was started and STOPPED in its read-only MISS phase (no write) to fold in Q5/Q6 first.
  RULINGS 18:1x UTC: Q5 NORM 1.8.6 then ONE certifications replay (fused members -> 0; bullet un-fusion stays; ' ; ' always
     splits; one sabotage per rule; per-key before/after in the plan). Q6 ports struct gets OPTIONAL role (lan|wan|uplink|mgmt),
     already ruled; measure across vendors first (expect 0 invalidated), then lan/wan convert into ports with their role;
     NOT lan_ports/wan_ports (duplicate cup). The five parsePorts rules accepted; combo SFP+ double count = named residue.
  Q7 RULED + DONE: run 1385 convert-lan-wan-ports: MX75/MX85 -> one ports fact each (roles), both documents as evidence,
     4 lan/wan retracted; 12 HELD (7 lan-only, 5 refused 'GE'). Plan files in data/dryrun/convert-lan-wan-ports-cisco-*.
  1.8.6 DONE (ea27527): sync run 1383 (2 shapes); run 1384 certifications 2,499 superseded, FUSED 2,052 -> 0, refused -> 0,
     unclassified 4,169 -> 3,912; all 16,846 members verbatim in their raw (the --allow's "all 764 read" was ~40: corrected
     in data/dryrun/certifications-186-replay-cisco-2026-09-29.txt). HELD for a ruling: 1.8.6 on ieee (24 facts, splits only)
     and supported_protocols (43 facts, unclassified +141 > ratchet ceiling: the other side of ' ; ' joins exposed).
  DONE 29 Sep ~19:00 UTC: rebuild on 0cbe5c5 (site WITH layer pages + BUILD.json; the deploy carries data/site), contract
     regenerated (had drifted since 28 Sep; one_build now compares with the code's hash), artefacts 501b7ed deployed, board
     27/6/0/0, self-test 24/0/9. Flipped: one_build, runs_have_approval, endpoints_alive (probes were malformed), link_integrity,
     keys_hygiene. Report + questions Q8-Q12: docs/reviewer/2026-09-28/batch-c2-report.md.
  RULINGS 19:1x UTC on batch-c2-report.md (verified 27/33 against the log):
  Q8 APPROVED all three: wireless heat sink/riser/interposer -> mechanical, CW-ACC-MEM-32G -> drive; retract the heat sink's
     power_max (mis-keyed CPU class); PHYSICAL_OBJECT_CUPS wireless.module += power_max.
  Q9 (1) FLMESH-HW-ACC -> accessory by SKU, (2) the 86 other doc-linked -> kind from their document titles (dry run read row by
     row) APPROVED. (3) the 232 no-name-no-document: their OWN TERM in the partition line AND on the acquisition queue; their
     apart-count is a RATCHET that may not grow; unknown_zero stays red until the evidenced ones reach 0.
  Q10 ieee: replay. protocols: extend the grammar over the 201 recovered members (witness per entry), replay, the ceiling rises
     only by the measured residue, recorded with the run id.
  Q11 APPROVED as proposed (class column, classifier, writer sets class, normaliser-split -> 0 by re-normalising, 86 orphans
     resolved no-live-value). The 7,218 same-doc-multicolumn: class NOW, they become the extractor's re-read plan AFTERWARDS.
  Q12 the standing order wins: FOUR profiles, 18-column Main, 4-column Attributes (ONE profile across all categories, the existing
     'Switches' and 'Transceivers & SFP Modul' group and attribute names exact), the check asserts the contract, not a 200.
     Build order: shop cups + shop_ready -> the four profiles -> the check -> the acceptance diff.
  NEXT (Batch D): Q8 -> Q9 -> Q10 -> Q11 (one writer at a time, dry run -> gate -> commit), ONE rebuild, board, report; then Q12.
  BATCH D DONE ON THE BOX (29 Sep ~19:30-20:00 UTC): run 1390 retract-mis-keyed heat-sink (1); sync 1391 (1 profile row);
     run 1392 ieee 24 superseded (NORM 1.8.7); run 1393 protocols 206 superseded (43 split + 163 NAT-PT swap); migration 0034;
     run 1394 classify-conflicts 15,930 (53 held); run 1395 86 orphans resolved no-live-value. Code: 4b35d45 Q8, b61a80f Q9,
     2923cf5+4061ad9 Q10, a767b3e+715fae2 Q11. CORRECTIONS told first: Q9(1) FLMESH = 32 cable/3 mech/3 PoE/6 acc (bulletin);
     Q11 doc_id is sha1(url) -> revision-drift 9, normaliser-split 826. Rebuild on 715fae2 running; then copy back, stamp, board,
     report docs/reviewer/2026-09-28/batch-d-report.md (Q13-Q18). Veto triage: data/dryrun/veto-triage-cisco-2026-09-29.tsv.
     Tunnel started 20:56 laptop time (D:/tmp/pg-tunnel.sh) for the store suite on netzspec_test4 (migrated to 0034).
  DONE: rebuild 715fae2 REGRESSED (3 cupLedger misses, mine: HX-16 os-license = named kind asked nothing; module:interfaces-modules
     exception missing; asked-nothing ceiling) -> fixed 55bba21 (HX-16 withdrawn to Q16) -> rebuild 55bba21 clean -> artefacts 6175802
     (contract 279d2ece1fd627bf, unknown ratchet 230) deployed -> board 28/5/0/0, self-test 24/0/9. Report: batch-d-report.md (Q13-Q18).
  RULINGS on batch-d-report.md (29 Sep ~20:40 UTC):
  Q13 the 826 normaliser-split -> resolve superseded-reading, the current fact id recorded. Q14 the 53 Atlas -> no-held-value.
  Q15 N9K-AC04-A/B -> non_product; 4X100G-LR-S -> retire (fragment); UCWS-WT-SM-INN12, MDS-9222I-75-PPT, 9270F-DIFL AND
     AIR-N-3006-DTA-K9 -> the no-evidence term (their documents say nothing; the 28 Sep call on AIR-N-3006 was a guess, withdrawn).
  Q16 HX-16-* (12) -> product_class licence. Q17 order: R1 retract + R3 rekey + R2 reclassify as plans read row by row -> R4
     widenings with witnesses -> the 90 read triples.
  Q18 THE NEW FORMATS WIN (the hexcat files are pre-September): Attributes 4 (Artikelnummer, Attributgruppe, Attributname,
     Attributwert); Condition 3 (Artikelnummer, Attributname, Attributwert); FAQ 3 (Artikelnummer, Attributname 'FAQ',
     Attributwert = Q||A pairs joined by ##); Main 18 incl. URL-Pfad, Titel-Tag (SEO), Meta-Description (SEO) (the export is the
     shop's surface). Groups exactly as in Wawi: 'Switch' (20 attributes), 'Transceivers & SFP Modul' (14).
  antenna_gain routers lease lapses 6 Oct: MEASURE before then.
  NEXT (Batch E): Q13+Q14 conflicts -> Q15+Q16 classes -> Q17 R1/R3/R2 -> rebuild, board; then R4 + the 90; then Q12 export.
     Veto triage (247) measured: four remedies (retract mis-mined module_slots, reclassify, rekey, widen) -> ask with counts.
  (d) was: check fix, rows, exceptions, KIND_QUESTION_SET_FROM, GATED_CUPS,
     wireless kinds (149 SKUs move: 82 power-cord, 19 drive, 14 memory, 9 fan, 9 storage-controller, 6 cpu, 6 tpm, 4 nic),
     cellular registered in DERIVED_FILL_PATHS. New vetoes measured: 3 triples / 17 part-cups (wireless ap tdp = Meraki
     "Power consumption" mis-keyed; antenna dram = retraction rows; optical cable wire_gauge -> KIND_DECLARED_OPTIONAL).
  BATCH E ON THE BOX (29 Sep ~20:29-21:10 UTC, code dcfb692 -> e3bbd1d): Q13 run 1400 resolve-superseded-readings 826; Q14 run 1401
     resolve-no-held-conflicts 53; Q15 run 1402 N9K-AC04-A/B non_product (+1403 retract-inherited), run 1405 4X100G-LR-S retired, the 4
     silent-document SKUs in the no-evidence term (code); Q16 run 1404 HX-16-* (12) licence; Q17 R1 run 1406 platform-slot-count 316
     retracted / 4 held (+40 bundles not selected: read with the 90), cords 1407 (81 input_voltage) + 1408 (1 power_max); R3 run 1409
     rekey 134 power_max->psu_rated_output + 19 antenna_connector->connector; R2 197 kind moves in code (ucsKind/sanKind/wireless).
     Rebuild on dcfb692 FAILED at recompute: 1 completeness row on a RETIRED part (run 1405 left 4X100G-LR-S's score; retirePart never
     dropped it) -> e3bbd1d: retirePart drops the score in the retirement (hygiene.test 125/0, sabotage 1 red), run 1412 dropped the
     stale score (computed 12 Sep < retired 20:36). Rebuild on e3bbd1d RUNNING (/tmp/mould-build-e3bbd1d....log).
  NEXT: board after the rebuild -> Batch E report; then R4 widenings + the 90 (re-measure the veto list first: R2 moved kinds);
     then Q12 export (recorded files read: Main ';' 19 cols, Attributes/Condition/FAQ ',' ; Switch 20 attrs, Transceivers 14;
     coverage of their source keys measured in /tmp only: weight 6% switches / 0% transceivers -> shop_ready will start near 0).
  BATCH E REPORTED (a6d9f64, deployed baffbd0): board 30/3/0/0, self-test 24/0/9; docs/reviewer/2026-09-28/batch-e-report.md. Fixes in it:
     retirePart drops the score (e3bbd1d, run 1412); run 1409 re-gated (1416) + rekey gate; AIR-N-3006 SILENT_NAMES; sync 1415; R4 116.
  REVIEWER on batch-e-report.md (29 Sep ~21:50 UTC): TAA compliant -> RETRACT (not a certification); video passive 'Mux/Demux 100G' ->
     REKEY to channel_spacing (not retract); AUDIT: R4 needs >= 1 html_table/pdf_table row (hexcat_seed = borrowed doc_id, N31) -> the
     18 seed-only R4 widenings REVERT pending a table read (98 stand); retract-read-pours.mts was not pushed (it is now). 'Otherwise
     Batch F as filed.'
  BATCH F (60311ed deployed): run 1419 rekey 30 (6 tdp, 8 power_max, 1 storage_capacity, 1 flash, 14 channel_spacing; gate PASS 30/30;
     2 refused: MEMUSB-128FT(=) 0.125 GB under storage_capacity's 1 GB band floor, held vetoed); run 1420 retract-read-pours 125 (0 held);
     Q17_READ 61 widenings; 219 kind moves by family rule (C880/C3X60/C3K/PCI25/EM3-AF, ST-M6-D100GF, 15454 ML cards, NCS2K frames,
     Y-cable drawer), replay read row by row; decision docs/decisions/2026-09-29-q17-read-triples.md. Rebuild on 60311ed RUNNING.
  OPEN after F: the 18 seed-only triples (333 part-cups) need a TABLE READ (propose: raw on its cached datasheet page = witness);
     the 2 MEMUSB band refusals; new vetoes the 219 kind moves may expose (re-run scripts/veto-triage.mts after the rebuild).
  NEXT: rebuild -> board -> Batch F report; then Q12 export (design: profiles jtl-main ';' 18 / jtl-attributes ',' 4 / jtl-condition
     ',' 3 / jtl-faq ',' 3 force-quoted; groups 'Switch' 20, 'Transceivers & SFP Modul' 14; shop_ready gate; BOM + CRLF).
  BATCH F REPORTED (7290b1c): board 29/4. RULINGS (29 Sep ~22:30 UTC): Q19 per triple the evidence decides (verbatim seed on its page
     -> widen; else retract the seed renderings); Q20 (b) gated: promote/compose then resolve promoted-reading, no locator -> no-live-value;
     Q21 lower storage_capacity's floor to 64 MB (witness MEMUSB-128FT).
  BATCH G DONE (runs 1423-1427): sync 1423 (band), rekey 1424 (MEMUSB 2), 1425 retracted 317 seed renderings, 1427 promoted 6 +
     composed 6 under a 39/39 re-read gate (1426 failed on facts_current_uq beside a tombstone, rolled back clean), 51 orphans resolved.
     Veto 0. Artefacts dae04c3 (contract b4fce311fad4b6a7).
  Q12 EXPORT LIVE (2030289 + 2df5351): /v1/export?profile=jtl-main|jtl-attributes|jtl-condition|jtl-faq (+ jtl-readiness);
     src/core/jtlExport.ts (contract, groups, shop_ready, jtlContractProblems), tests/jtlExport.test.ts 45/0. The check walks 84 pages.
  BOARD 32/1/0/0 (2df5351), self-test 24/0/9 = STANDING ORDER ITEM 1 MET (vendor_coverage red by ruling). Reported: batch-g-report.md.
  REVIEWER (29 Sep ~23:25 UTC): verified 32/33. RULING: weight jumps the queue. New fill order by shop_ready leverage:
     1 weight (mapper gap on held sheets first; shipping_weight_kg derivation follows), 2 FAQ faq<3 (a derivation from filled cups),
     3 name (sheet titles next), 4 the Wawi group attributes by count per category (throughput, certifications, power; form_factor /
     media where they unlock them). RE-MEASURE jtl-readiness AFTER EACH and report the ready count per category. Baseline: 33 ready.
  Q12 remaining: the acceptance diff vs the recorded files; the transceiver shop cups (transceiver_type, fiber_count,
     cable_construction, application) are referenced by the group but are not dictionary keys yet.
  WEIGHT LANE (30 Sep, docs/reviewer/2026-09-28/weight-lane-report.md): measured first -- the mapper gap proper is 14 parts;
     the held-sheet gap is an EXTRACTOR shape. b17015d shape D (nested 'label | Model | value' sub-tables, SMB sheets; 14 guards
     sabotaged; corpus diff +640 D records only). Run 1430: D-only apply (weights + dimensions; whole-sheet re-apply would refill
     retraction tombstones) 432 inserts, gate 60/60. Run 1431: 7 C8000 edge routers never re-applied after rule 47. 708ee4a
     mapper (rule 47 widened, ^system weight$, (grams) unit, rule 119 anchored); c5e3f64 artefacts (MISS new 0). Run 1434: 14
     mapper rows (IE-4010-4S24P withheld: header spans two columns with different weights). Served weight 448 -> 684.
  FAQ (1d46889): pairs derived from filled cups in the recorded shop's voice; the padding summary pair removed. First measured
     104 ready -- WRONG: 49 had no Attributes row; the board's one-set check went red; shopReady now names attributes:none. 55.
  READY: 33 -> 52 (weight) -> 55 (FAQ + run 1434 + the one-set clause): switches 54, routers 1.
  QUESTIONS OPEN (report): Q22 weight at catalogue scale (the recorded transceiver file carries a flat 0,05/0,20 placeholder);
     Q23 Versandgewicht not derivable (band deltas +0,6..+2,5); Q24 single-model sheets vs Class B (48 parts); Q25 'Module
     weight (Max)'.
  NEXT: name -- the per-SKU source is the DESCRIPTION CELL sheets print beside a PID (PDF spec sheets 'PID Description': 895
     name-blocked parts, servers 693, HCI 199; HTML ordering tables 71), not a sheet title (a title names a series). 6,171
     name-blocked in all. Then the Wawi group attributes (31 SMB switches blocked by Stromversorgung alone, 30 by
     Betriebstemperatur alone -- Class C, inheritable). Held: 203 per-model packet buffers vs 124 held conflicts.
  RULINGS (30 Sep ~02:00 UTC, on the weight-lane report): Q22 WAITS ("a default derived from zero measured weights is
     invention"); tier variants row by row (-A/-E only, the model's own row, exact model, inherited_from = model row);
     Q23 a ruled allowance (median packaging delta per band from the recorded switch file, derived:shipping-allowance) +
     shipping_weight retyped numeric, printed metric never converted; Q24 per-SKU when every hardware subject on the sheet is
     one model (incl. regional + licence-suffix variants); Q25 derived:max-bound, band [1, 2000] g, and "a unit override must
     carry its own band" as a check. "Name lane next as you've planned -- PID-description cells, not sheet titles."
  BUILT (all pushed; docs/reviewer/2026-09-28/weight-rulings-report.md): run 1437 tier 178 (55 -> 104 ready); runs 1438 sync,
     1439 renormalise weight (218 superseded / 404 restamped, printed metric), 1440 shipping 3, 1441 max-bound 28 (104 -> 109),
     1442 shipping 890, 1445 sync (profile rule: every profile asking weight declares shipping_weight opt -- the first board's
     four_sets_sum veto 18 triples / 664 part-cups); 07546d0 + run 1448 Q24 29 weights (26 sheets; guard: another build ordered
     as a table subject; HOLD 2 module sheets) + run 1449 shipping 29; 2785b6f artefacts -> board 31/2: four_sets_sum 5 triples
     / 9 part-cups -> 6b76fe8 Q24_R4 (weight OPTIONAL for 5 kinds, R4 by veto-triage).
  FOUND (8599a99): gate-extract's Python re-reader called cap_value(cell) with one argument since 67a4f95 (27 Sep) -> every
     PDF cell TypeError -> bare except -> "out_of_range". Latent (no PDF gate run since). Fixed + tests/scraper/
     test_cisco_specs_pdf.py runs the real script (the same commit had killed that suite at line 74). CHECKED FROM THEIR
     BRANCHES: only cisco has 67a4f95; hpe/juniper/main keep cap_value's default, so their re-reader works. The pair
     67a4f95 + 8599a99 must travel together (never cherry-pick 67a4f95 alone).
  NAME LANE (in progress, uncommitted): scripts/pid-description-names.py (--reextract runs the CURRENT pdf/deep adapters over
     the cache: 50 PDFs + 596 HTML) + scripts/name-from-description.mts (gate: description cell exact AND the row or column
     header names the SKU). First gate: 89 of 614 refused, 85 = footnote-fabricated live parts (data/reference/
     footnote-fabrications-cisco.json; 76 with live facts; 21 with no live real PID) -> question to the reviewer.
  10b3500 artefacts (MISS vs 07546d0: new 0 gone 0) -> BOARD 32/1/0/0, self-test 24/0/9, READY 110 (switches 103,
     transceiver 5, routers 2); export PASS 110 parts / 1,711 rows.
  LEVERAGE (per part, real jtlReadiness): sole blockers weight 909, attributes:none 53, Betriebstemperatur 45, PoE 39,
     Stromversorgung 33, Stacking 12, NAME 1 (name+weight 329). The 129 single-attribute parts are all switches (1300/1200/
     IE3500/IE3400, C9300, 350/350X, C9200) -- Class C from each series' sheet. Proposed to the reviewer: attributes next.
  QUESTIONS OUT (weight-rulings-report.md): order (attributes before more names?); the 85 fabrications (retire / promote
     real PID or rename); the 60-char CCW limit (34 names); the typo cables.
  RULINGS (30 Sep ~04:30 UTC, on weight-rulings-report.md): (0) ATTRIBUTES BEFORE NAMES -- order every fill by ready-gain
     per job, measured with the real jtlReadiness; Betriebstemperatur, PoE, Stromversorgung, Stacking from the series sheets,
     then re-measure and pick the next largest. (1) FOOTNOTE FABRICATIONS: merge or rename, never plain retire -- real PID
     live (64): re-attach the fabricated row's facts to the real part where the fact's cell names it and no duplicate exists,
     retire the fabrication with a REDIRECT to the real SKU; real PID absent (21): RENAME the row to the PID the page prints
     (gate: the page shows it), sku_kind recomputed, facts and relations stay attached. (2) 60-CHAR NAMES: accept where the
     cut lands on a word boundary, name_state = 'vendor-truncated', exported as printed; cut mid-word keeps refusing until a
     longer source closes it. (3) TYPO CABLES: retire with a redirect if the correct SKU is live and they hold no own facts,
     else merge as (1). (4) flag 8599a99 to whoever runs the hpe/juniper trees.
     MEASURED BEFORE BUILDING (0): the four fields are mostly PER-MODEL on those sheets, not one document-level value
     (C1300 temps -5/0 °C by model; C9300 poe_standard 22 raws over 87 parts; C9200L stackable 3 raws), and the same docs'
     "siblings" are partly hexcat_seed renderings with borrowed provenance -> build as per-model READS where the sheet
     pairs a value with a model, Class C only where a sheet states ONE value; report the split.
  ATTRIBUTE LANE decomposed (measured, sent) + PRE-RULINGS (30 Sep ~05:00 UTC): (A) inline per-model lists in one cell
     (Betriebstemperatur C1200 9 + C1300 21; three grammars) -> per-model inline-list reader, per-model READs: AS PROPOSED.
     (B) Stacking: stated stacking bandwidth > 0 derives stackable = yes for that sub-series, "N/A" derives no --
     registered derivation derived:stackable-from-bandwidth, witness the column header; the bandwidth itself stored as
     stacking_bandwidth. (C) SG350X 'Power: 100 to 240V ..., internal, universal' = Class C -> psu_config + input_voltage:
     AS PROPOSED. (D) "data only" / "non-PoE" in the ordering-table PID DESCRIPTION -> poe_standard = none; only those
     explicit phrases, state filled, method the description cell. IE enclosure-conditional temperatures: store the range
     that holds under EVERY stated condition (the intersection), all conditions kept in raw.
  SHAPE E BUILT (ee72905 + a48f489): 291 per-model records (Power 174 held for the (C) mapper rule, Operating temperature
     117), 16 sabotaged rules, corpus diff 0 other differences; scoped to the two measured labels; a numbered sentence after
     the last list is a CONDITION (C1300 cold start) and refused.
  RULINGS (30 Sep ~06:10 UTC): (1) CORRECTION WRITER approved -- supersede an inherited value with the per-model read of the
     SAME cell (gate: the cell re-read now, stored raw its capped head, the per-model value inside it; conflicts row resolved
     per_model_reread; plan = undo) -- AND fix the cause: isSameCellReread recognises a same cell by doc + locator with the
     stored raw a PREFIX of the re-read, not by equal raw text (the 160 cap made equal text impossible for these cells).
     (2) WRITE THE READS, NOT THE SEEDS ("a seed that agrees is still a typed value; the ready check wants filled"):
     C1200 9 -> the per-model read -5..50 supersedes the seed, conflict resolved per_model_reread; C1300 21 -> the read with
     the intersection rule applied, 0..50 (cold start included), condition kept in raw, supersedes the seed; IE3400/3500 15
     -> supersede the tier-0 seed with -40..60, all enclosure conditions in raw ("tier 0 protects against overwrite by a
     worse source, not by the sheet's own full statement"). Predicted +30 ready (C1200/C1300), more with IE: REPORT MEASURED.
  STANDING ORDER REPLACED (30 Sep ~06:40 UTC; operator to reviewer: "it is your job to fill every single data and you will
     give command to CC"; the reviewer's "FILL PIPELINE", replaces the last command):
     1 NIGHTLY on the box: `npm run fill:nightly`, cron 01:00, one writer lock, log in data/reports/ --
       a ACQUIRE for scored Cisco hardware lacking a spec-bearing doc: uncached Cisco datasheet / spec-sheet / ordering-guide /
         install-guide pages, cache first, <= 1 req / 2 s, stop + report on 403/429, never itprice / blocked aggregators;
       b EXTRACT -> MAP -> GATE -> APPLY only documents fetched or re-read tonight (never a whole-sheet re-apply), every
         write through its gate, a failed gate stops the run; c DERIVE every registered derivation, each with its control;
       d RECOMPUTE -> mould-build -> mould:verify -> jtl-readiness; e REPORT data/reports/fill-<date>.md <= 40 lines (ready
         per category today vs yesterday, top 5 blockers per category, runs + gates, anything stopped). HARD LIMITS: never
         override tier 0, a ruling, a retraction tombstone or a held conflict; Cisco only; a red board test blocks the next night.
     2 DAY WORK: read only the report; take the largest ready-gain blocker, write ONE rule for every affected part, dry-run,
       commit, the night applies it. Judgement calls (new rule type, source override, retraction) -> one-line question.
     3 FIELDS NO CISCO PAGE PRINTS (EAN/GTIN, HS code, component weights): find a token-free second source; evaluate candidates
       on a 50-PID sample (coverage, agreement with Cisco sheets, terms of use); report the table; importer after a yes.
       A source tier BELOW the vendor sheet: fills only empty cups, disagreement -> conflict, gate = 20-row check vs Cisco.
     4 REPORTS: one per batch, five lines (commit . ready before->after . blockers fixed . verifier . self-test).
     5 STOP: gate failure, verifier red, throttling, disk < 5 GB, or ready count falling without a recorded retraction.
  DONE (30 Sep): the temperature correction, run 1454 (154 written, gate 178/178, re-plan 0; undo data/dryrun/correct-temps-by-sheet-cisco-2026-09-30T053040080Z.tsv).
     Artefacts 24271ed (built on b416463, contract c7b80d502adb8305), deployed. READY 110 -> 154 (switches 103 -> 147).
     Held and asked: IE2000 (-34 C fan case), C130024MGP-4X (sheet typo live as a part). Candidates not written: C9500X fan-conditional, C9200 altitude.
  PARKED: the name lane (pid-description-names table 527 names / 79 refused, name-from-description writer) -- needs migration 0035
     (name_state 'vendor-truncated'), sticky NAME_STATE in derive-part-states, realName accepting it. Name alone blocks 1 part.
  ACQUIRE (ruled 30 Sep: A, the box): probe docs/reviewer/2026-09-28/acquire-probe.md (20/20 HTTP 200, 0 refusals; the 5
     non-documents identical from the laptop control). Box: google-chrome-stable 154.0.8037.92-1 + xvfb + /opt/netzspec/pw
     (playwright 1.60.0). Worker (4cd236e): --url-match, --stop-on-block (exit 3), --max-minutes, --summary-out; login page /
     Akamai error / redirect off the document -> SKIPPED with its class, never cached or retried; Akamai error pages stop the
     lane at 3 in a row or > 5% (from the 20th fetch). /c/[dam/]<lang>/<cc>/products/se/ refused at enqueue (worker + plan.py)
     and the 527 rows parked by run 1457 (HTML and DAM PDF both end on id.cisco.com "Log In to Cisco").
  NIGHTLY: scripts/fill-nightly.sh (npm run fill:nightly; cron 01:00 UTC on the box) -> /var/lib/netzspec-api/fill:
     lock, STOP (a stop blocks every later night until the day session clears it), nights/<date>/*.log, reports/fill-<date>.md,
     board-last.txt, ready-last.json, runs/acquired/... (APPLY by watermark: every day dir without .applied), vocab/.
     RULINGS 30 Sep (after 3 dry runs, docs/reviewer/2026-09-28/fill-dry-runs.md): A = the target is spec-shaped URLs under
     series whose parts hold no spec-bearing doc, most not-held parts first (scripts/fill-night-target.mts, worker --url-list);
     a family whose fetched docs list none of our parts is demoted (placed last). B = per DOCUMENT FAMILY (series directory;
     HTML and /c/dam/ PDF are separate): >= 5 golden rows in scope + defects <= 5% -> commits nightly (apply-extract, sample
     max(60, 5%)); otherwise STAGED (staged-*.json kept, dry gate); the day adds >= 5 golden rows from the family's own sheet,
     re-runs scripts/fill-split-families.py on the staged files, commits what qualifies. Report: families committed/staged,
     golden rows owed. Cron after A and B land (cfb1607).
     TRAP: the night rebuilds and stamps the artefacts IN THE DEPLOY TREE (STAMP_*_COMMIT = the deployed commit). The day
     session copies them into the repo, restamps, commits BEFORE ANY DEPLOY -- a deploy first would put the older committed
     artefacts back under the API.
## Pinned predictions
- run 1350 lands -> the enum CISCO line drops standard to 0 (was 555 seed); what remains red there is non-seed audio_codecs/antenna_type/spatial_streams + refused shape members. required_cup_defined not moved by it (other vendors seed untouched).
