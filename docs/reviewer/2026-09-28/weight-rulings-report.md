# The weight rulings, built — and a gate defect the name lane found (30 Sep 2026)

Decision record: `docs/decisions/2026-09-30-weight-rulings.md`. Every write went through `applyMerge` (or one guarded
statement) inside a run with its gate recorded; every dry run was read row by row before `--commit`.

## Ready (jtl-readiness, live, on 10b3500)

**110 ready** of 41,058 scanned: switches 103, transceiver 5, routers 2 (55 → 104 tier variants → 109 Q25 → 110 Q24).
Board 32/1/0/0 (vendor_coverage red by ruling; `export_profiles_roundtrip` PASS on 110 parts, 1,711 rows), self-test
24/0/9. Log: `docs/reviewer/2026-09-28/verifier.txt`.

**What blocks the rest, measured per part with the real `jtlReadiness`** (41,058 live hardware parts):

| blocked by exactly ONE reason | parts | | blocked by exactly TWO | parts |
| --- | ---: | --- | --- | ---: |
| weight | 909 | | Laufwerksanbindung + weight | 1,024 |
| attributes:none | 53 | | **name + weight** | 329 |
| attribute:Betriebstemperatur | 45 | | Wellenlänge + weight | 318 |
| attribute:PoE | 39 | | Betriebstemperatur + weight | 296 |
| attribute:Stromversorgung | 33 | | Maximale DIMM-Taktrate + weight | 262 |
| attribute:Stacking | 12 | | System-Durchsatz + weight | 176 |
| **name** | **1** | | | |

**Name alone blocks ONE part.** Its leverage is joint with weight (329), and weight at that scale waits on Q22. One group
attribute alone blocks **129 switches**: Betriebstemperatur 45 (Catalyst 1300 21, IE3500 11, 1200 9, IE3400 4), PoE 39
(Catalyst 9300 24, IE3400 8, IE3500 6, Nexus 9000 1), Stromversorgung 33 (350X 16, 350 15, IE3100 2), Stacking 12
(Catalyst 9200) — series whose sheets state these at document level (Class C).

## Built, in the order ruled

1. **Tier variants** (run 1437, `scripts/inherit-tier-weight.mts`, kind AG): -A/-E licence-tier suffixes only, the model's
   own row on the same sheet, exact model, `inherited_from` = the model row; gate re-reads every model row (SKU and number),
   with a control that it can fail. 178 inserts, gate 90/90, re-plan 0. **Ready 55 → 104.**
2. **Q25** (run 1441, kind G): 28 cables get "Module weight (Max)" as `derived:max-bound`, band [1, 2000] g (witness
   QDD-4ZQ100-CU3M 800 g); witness table reproducible from cache (34 rows / 2 sheets; 2 class rows refused, "Optical
   modules 100 g"). Your general rule is a check: `unitOverridesWithoutBand()` must be empty (sabotage: removing the gram
   band names `transceiver/weight`). The export converted g → kg (it refused every unit but kg: no transceiver could ever
   have exported a weight). **Ready 104 → 109.**
3. **Q23** (runs 1438 sync retype, 1439 renormalise, 1440, 1442, 1445): `shipping_weight` numeric kg with the weight band;
   the 3 stored facts parsed to the printed metric. "The metric figure the sheet prints, never a converted one" applied to
   every mass: specNormalize 1.8.8 reads "N lb M kg" as M; run 1439 superseded 218 (114 of that shape + 104 old
   parenthetical conversions, all within 0.98–1.014×; the 25 % change-share ceiling passed with `--allow` after all 218
   were read through renormalize's own `decide()`), restamped 404. Allowance table from the recorded switch file (995 rows,
   sha ce7c30b0…), 8 bands, median delta each. Run 1442: 890 derived shipping weights.
   **Found by the first deployed board:** `four_sets_sum` vetoed 18 triples / 664 part-cups — the new cup was named in one
   profile and the complement closed it everywhere else. Rule, in `fieldSchema` after every profile is final: every profile
   that asks `weight` declares `shipping_weight` optional (never required: an allowance is a convention). Sync 1445.
4. **Q24** (run 1448 + shipping run 1449, `scripts/apply-single-model-weight.mts`, kind AG): **26 sheets, 29 parts**, gate
   26/26 re-read, 0 unreadable, re-plan 0; 1 skipped (`NCS1K4-1.2TL-K9=`: the cell glues the PID to the value, the
   normaliser refuses it). Witness table `data/reference/single-model-weight-witnesses.json`, four conditions, every refusal
   listed. Reading every qualifying sheet against its model added the fourth:
   - **two sheets order several builds** and are linked to one (RSP440: -TR/-SE beside -LT; CRS LSP: CRS-LSP beside
     CRS-LSP400G) → refused as series sheets. Guard: same stem + same category + a different model as a TABLE SUBJECT.
     Sabotage: disabling it lets exactly those two back in. Its first, broad form fired on accessories and on the store's
     bare `MT11` beside `MT11-HW`; the measurement is in its docstring.
   - **a bundle is not another build**: NC55-24X100G-SB and NC55-18H18F-BA are line card + RTU licence (the Subcomponent
     column says so) → kept. My first reading held -SB as "two builds"; the ordering table corrected it.
   - two module sheets linked only to the optic they take (CRS-3 100GE → CFP-100G-LR4; N77 F3 → FET-10G): held by hand,
     one reason each, the build fails on a stale entry; the transceiver band refuses both values too.
   - "the 48" was the first sizing, before conditions 2–4. Refused since, each with its reason: no document-level weight
     34 sheets, a sub-labelled list 5, several statements 3, a bound 2, a multiple 1, another build 2, held 2.
   - 4 writes carry a base-unit qualifier ("…(6.35 kg) without optics"; MT sensors under "Weight (excluding batteries)").
     The store already holds that kind ("Without power supply: 13.7 lb (6.21 kg)").
5. **Q24_R4** (`6b76fe8`): the first board after 1448 read 31/2 — 5 triples / 9 part-cups (optical amplifier, OTDR /
   orchestrator controller, MDS supervisor, RF-gateway and NCS line cards) held a weight under a cup their kind marked na.
   `veto-triage` classed all 5 R4 (every one an html_table read off the datasheet), so by the Q17 R4 rule: `weight`
   OPTIONAL for those five kinds, with the triage's witnesses. Triage re-run: 0.

## Found: the gate's PDF re-reader had graded every PDF cell "out_of_range" since 27 Sep (`8599a99`)

`67a4f95` made `cap_value`'s cap REQUIRED ("a default is how the wrong one gets applied on the second call site"). The
second call site was the Python re-reader carried as a string in `gate-extract.ts`: `cap_value(cell)` with one argument
raised TypeError on every PDF cell, and a bare `except` turned each into `out_of_range` — a verdict that the cell is not on
the page. **Latent:** no gate run since 27 Sep re-read a PDF fact (the only re-reader run, 1427, was 39/39 HTML); the next
PDF apply would have scored every PDF fact a provenance miss and read as mass fabrication. The same commit killed
`tests/scraper/test_cisco_specs_pdf.py` at its line 74 (it needs the PDF cache, and the box never runs it). Fixed: the cell
is returned whole as the HTML branch always did (`cellMatches` owns the cap-aware comparison), and only a missing index is a
verdict — a reader exception is `pdf_error`, could-not-check. The Python suite now runs the REAL script extracted from the
TypeScript on a cached sheet (133/0; HEAD's re-reader turns both real cells red with `out_of_range`).
**CORRECTED after sending (checked from their branches, not assumed):** only `cisco` contains 67a4f95. `hpe`, `juniper` and
`main` still give `cap_value` its default cap, so their one-argument call works and their re-reader was never broken. The
risk for them is taking 67a4f95 WITHOUT 8599a99 (a cherry-pick); both sit on `cisco`, in order, so a merge brings the pair.

## Name lane — in progress, and what its gate found

`scripts/pid-description-names.py` → `data/reference/pid-description-names.json` proposes, for a live hardware part whose
name is only its SKU, the description cell a sheet prints beside that PID ("PID | PID Description"); refused labels are
counted (`PID Description Im`, the column-bleed fiction 108; `Replacement Product Description`, the successor 50); one text
per SKU; no bullet or private-use glyph; and Cisco's 60-character description limit (a cliff: 56:32 57:26 58:40 59:50
60:44 61:2 — most complete abbreviations, some cut by Cisco itself, "…Value Endu") refused unless it visibly closes.
`scripts/name-from-description.mts` re-reads every witness: the description cell exactly, AND a cell of its row (or its
column header, for transposed tables) naming the SKU.

That gate refused 89 of 614 on the first run. **85 are footnote-fabricated live parts**: the old extract carries
`HCI-HDL24TW1S74K1` where the page prints `HCI-HDL24TW1S74K` with a raised footnote 1, and the store holds the fabrication
as a live part — 76 of the 85 with 2–4 live facts each; for 64 the real PID is also live, for 21 it is not in the store at
all. The table is being rebuilt from the CURRENT extractor run offline over the cache (it strips the marker by geometry),
so no name goes to a fabrication; the list is `data/reference/footnote-fabrications-cisco.json`.

## Questions

0. **Order.** The ruled order is name, then the Wawi group attributes. Measured, name unlocks 1 part and one attribute
   unlocks 129. Proposal: land the name lane as built (it is good data, and the 329 wait on it with weight), then go
   straight to the four switch attributes, Class C from each series' sheet, before anything else. Or keep the order?
1. **The 85 footnote-fabricated parts** (the list, each with the PID its page prints): retire them — and for the 21 whose real
   PID is not in the store, is that the Q15 membership path (retire, and promote the real PID from its page), or a rename?
   Their facts are the real PID's row, re-attributed.
2. **The 60-character description limit**: accept a text at the limit as printed (the vendor's own, sometimes cut), or keep
   refusing unless it visibly closes? 34 names ride on it.
3. **Two typo-shaped cables** from the sheets' own misprints, linked to no document, no weight written: `QDD4ZQ100-CU2M`
   (part 70542) and `QDD-4ZQ100CU1M`. Retire (Q15 precedent)?

## Found in passing, not touched

- HPE lane: `JL762A` (aruba) holds weight 5.7 kg from "12.5 lbs (5.7 kg), with 1 PSU 13.8 lbs (6.27kg), with 2 PSUs"
  (run 83) — one configuration of two, stored as the weight.
