# Weight lane + FAQ — 30 Sep 2026 (ruling 29 Sep ~23:25 UTC: "weight — mapper gap on held sheets first", then FAQ)

**shop_ready 33 → 52 after weight → 55 after FAQ and run 1434** (switches 32 → 54, routers 1). **Correction:** this file first said 104 after FAQ; 49 of those had no row for the Attributes file, the deployed board's one-set check went red on it, and the gate now names that reason (item 7). Live Cisco
hardware parts with a served weight: **448 → 684** (run 1430 +215, run 1431 +7, run 1434 +14). Measured each time with
the API's own `jtlReadiness` over all 41,058 parts:

| category | parts | ready before | after weight (1430/1431) | after FAQ + 1434 |
| --- | --- | --- | --- | --- |
| servers-unified-computing | 8,262 | 0 | 0 | 0 |
| switches | 7,225 | 32 | 51 | 54 |
| routers | 5,119 | 1 | 1 | 1 |
| wireless | 3,907 | 0 | 0 | 0 |
| video | 3,260 | 0 | 0 | 0 |
| collaboration-endpoints | 2,937 | 0 | 0 | 0 |
| transceiver | 2,109 | 0 | 0 | 0 |
| security | 2,000 | 0 | 0 | 0 |
| hyperconverged-systems | 1,631 | 0 | 0 | 0 |
| hyperconverged-infrastructure | 1,216 | 0 | 0 | 0 |
| optical-networking | 1,157 | 0 | 0 | 0 |
| interfaces-modules | 1,079 | 0 | 0 | 0 |
| storage-networking | 661 | 0 | 0 | 0 |
| unified-communications | 426 | 0 | 0 | 0 |
| meraki | 69 | 0 | 0 | 0 |
| **all** | **41,058** | **33** | **52** | **55** |

## What the measurement said about the premise

Cisco's sheets do print weights — mostly not per model, and the mapper is the smallest part of the loss.

- **The mapper gap proper is 14 parts.** Across every extraction output held (4,254 acquired records, 16 extractor files),
  SKU-attributed weight-shaped rows reach ~550 live parts; 40,528 have none at all. Of the 62 parts whose SKU row was lost
  in mapping, 14 are fixable by rule; the rest are configuration alternatives already held as conflicts (chassis-only vs
  full system, AC/DC/HVDC PSU, blank vs loaded modules), bounds (`< 3 lb`), combined cells, and two Cisco typos
  (`5.1 (11.2 lb)`, `7.29. (16.1 lb)`), which stay refused.
- **Where the held sheets print weights** — every weight cell (a mass in a cell whose own text, row label, column header or
  section says "weight") on the 845 held HTML datasheets readable here (950 held; 63 PDFs not surveyed, 42 not in this
  cache), classified by what names its subject:

  | subject of the weight cell | sheets | parts it names that lack a weight |
  | --- | --- | --- |
  | already attributed by the extractor | 101 | — |
  | a PID of the sheet in another cell of the same row | 37 | 317 |
  | a PID as the column header | 20 | 23 |
  | nothing: one document-level weight | 509 | (Class B: never inherited) |

## Done

1. **Extractor shape D** (`b17015d`): Cisco's small-business sheets (Catalyst 1200/1300, Business 110/220/250/350,
   350X/550X, SF220/SF350) span one attribute over a sub-table of models inside a generic "Feature | Description" table, and
   shape B read the PID and the weight as two document-level values — the pairing lost. Read only on explicit geometry
   (sub-header = label | closed model word | named value; rows under the same label, rowspanned or blank, in the same column
   spans, first cell a PID of the sheet). 14 guards, each sabotaged and caught by its named case (SD1–SD14, 78/0). Corpus
   diff, HEAD vs this tree over all 845 sheets: **only** +640 shape-D records and the withheld shape-B readings of the same
   rows, 11 sheets, 0 other differences, 0 PID-list changes.
2. **Run 1430** — 432 inserts (215 weights, 217 dimensions), 0 conflicts, gate PASS (60/60 re-read, precision 1, recall 1).
   The input carried **only the new shape-D weight and dimension records** (4,509 other facts withheld): `applyMerge` fills
   any gap-state row, and a ruled retraction leaves a gap-state tombstone, so re-applying whole sheets could resurrect
   retractions. The 203 per-model **packet buffers were held back**: 124 disagree with conflicts the store already holds
   (e.g. CBS220-8T-E-2G: kept 12, the model's row says 4.1 Mb) — they get their own reading.
3. **Run 1431** — 7 Catalyst 8000 edge routers (C8140/C8211/C8231/C8235/C8355/C8455/C8475-G2): acquired 5 Sep, rule 47
   added 12 Sep, never re-applied. One datasheet URL per part: the same sheet sits at two collateral paths plus index and EoL
   pages, and applying all of them would have corroborated a document with itself. 7 inserts, gate 7/7.
4. **Mapper** (`708ee4a`): rule 47 widened to the two single-configuration variants ("Chassis weight (with fan tray)" —
   Catalyst 4500-E / 9400 chassis — and "… 2 AC power supplies …") and to switches; `^system weight$` appended (IE-4010 /
   IE-5000); "(grams)" read as a label unit (ENC ONTs); rule 119 anchored so "Weighted average" (41), WRED and WCMP stop
   reaching weight. No other vendor's inventory carries any of these labels. aliasRules 346/346. Artefacts rebuilt on the
   box (`c5e3f64`): MISS diff new 0 / gone 2 (the freeze misses the change caused) against its own baseline, 0/0 against
   the previous block; freeze reproduced; contract unchanged.
5. **Run 1434** — the mapper's 14 rows under the new rules (from the acquired records and a cache re-read of the IE-5000
   and 10G PON ONT sheets), again carrying only those rows: 14 inserts, gate 14/14. **IE-4010-4S24P withheld:** its sheet
   spans that model's header over two columns holding different weights (12.1 lb and 12.7 lb), so which one is its weight
   is not on the page; the other model on the sheet reads from its own column. (A colspanned model header over differing
   values is an extractor defect class — to size.)
6. **FAQ derived from filled cups** (`1d46889`, the ruled next step): the name, the series, one question per resolved
   attribute in its Wawi order in the recorded shop's own voice (the three port attributes folded into one answer, as the
   recorded example does: "bietet insgesamt 24 Ports: …"), and the weight when served. The pair that summarised up to five
   attributes is gone: it repeated the per-attribute pairs and already asked the operating temperature twice — padding
   the 3-pair bar. A part with one filled cup and no series now honestly has two pairs. No ready part can drop (a ready
   part has a weight pair, its name, and an attribute or series pair). jtlExport 50/0, five sabotages caught.
7. **The one-set clause** (the deployed board caught my regression): the FAQ change made 49 parts ready — switch fans (5)
   and fabric modules (12), interfaces-modules `interface` (32) — whose kinds require no group attribute, so their FAQ
   reached three pairs from name, series and weight while they had **no row for the Attributes file**; the served files
   then broke the importer's one-Artikelnummer-set rule (`export_profiles_roundtrip` red). The old FAQ had been holding
   that line by accident. shopReady now names it, `attributes:none`, with a sabotaged case; the four files carry one set
   of 55. The same reason now counts, per category, the parts with nothing to list at all (routers 4,154, servers 5,536,
   wireless 3,017 …) — exactly the counts the old `faq<3` was standing in for. **52 → 55 ready.**

## The ceiling, and the questions it raises

Everything above plus every remaining sized pool is roughly **780 parts with a weight, of 41,058**:

- other extractor shapes: transceiver "Module weight (Max)" tables (31 parts), FEX PSU/fan rows (20), 8000-series prose
  cells "Chassis weight only: 58 lb" (25), a handful more;
- document-level weights on sheets whose hardware subjects are all ONE model: 43 of the 509 sheets, 48 parts;
- the rest of the catalogue is components, spares and accessories that no held sheet weighs.

So weight cannot carry shop_ready at catalogue scale from held sheets. Two facts from the recorded Hexwaren files bear on it:
the **Cisco transceiver Main file carries a flat 0,05 kg / 0,20 kg on all 227 rows** — a category placeholder, not a
measurement — while the **Cisco switch file carries real weights, which agree with the store** (C9300-48P 7,59; WS-C4506-E
18,37; C1300-8T-E-2G 1,39; C9404R 17,20).

- **Q22.** shop_ready's weight clause: must it be a measured weight, or may the export carry a declared, labelled
  category default (as the recorded transceiver file does) — rendered in the export, never stored as a fact?
- **Q23.** Versandgewicht: the recorded values are not a function of Artikelgewicht (switch file, 995 rows: within one
  weight band the added amount runs +0,6 … +2,5 kg), so no derivation reproduces them. Leave it blank, or rule an allowance?
- **Q24.** A document-level weight on a sheet whose every hardware subject is ONE model (48 parts): a per-SKU source, or
  does Class B hold?
- **Q25.** "Module weight (Max)" (31 cables): a stated maximum as the part's weight?

## Next, in the ruled order

Name (sheet titles) next, then the Wawi group attributes by count. Among the parts given a weight today the ones still not
ready are blocked by the Switch group attributes: 31 by Stromversorgung alone and 30 by Betriebstemperatur alone (a
Class C field their own sheets state at document level — inheritable), a cheap unlock when step 4 arrives. The 203
per-model packet buffers wait on a reading of the 124 conflicts they disagree with.
