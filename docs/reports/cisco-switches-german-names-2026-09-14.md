# German shop titles in Cisco `parts.name` (layers review round 2, B.6) — 14 Sep 2026

**Status: DONE — run #1066** (`ingest name-language --vendor cisco --commit`, commit 4c24db4, after migration
`0021_parts_name_language`). Operator decision: the German text is kept in `name_de` for every row; `name` is English.

| category | German rows | English from the twin (`name_lang` en, `name_source` "twin: ‹sku›") | kept German, flagged `name_lang` de |
|---|---|---|---|
| switches | 613 | 174 | 439 |
| transceiver | 461 | 222 | 239 |
| **total** | **1,074** | **396** (predicted 396) | **678** (predicted 678) |

Read back from a new connection: 0 German rows unhandled, 0 handled rows without `name_de`.

**Residual for the reviewer:** 81 base rows (switches 59, transceiver 22) took an English name that is the SPARE's and says so,
e.g. C6800-48P-SFP → "C6800-48P-SFP= – Cisco Catalyst 6800 48-port 1GE fiber module with integrated DFC4 spare". Taken verbatim
as decided; stripping the spare wording is a name transformation and waits for a ruling. The 678 flagged rows go on the
coverage board as a store-quality item with the parked completeness rebuild (D items); phase 2 fills `name` from the datasheet
title or ordering table.

The measurement that led to the decision follows unchanged.

## How it was measured

- **Detector:** `scripts/audit-german-names.mts`, read-only. It runs one SELECT over live, unretired Cisco hardware (42,367
  rows) with `application_name` `cisco/audit-german-names`.
- **Markers:** umlauts, *gemanagt*, *Steckplatz*, inflected *modulare/r/s*, "N HE", German compounds (*Data-Center-Switch*,
  *Glasfaser*, *Kupfer*, *Leergehäuse* …), function words (*mit, und, für, bis, davon, zu*), nouns (*Modul, Zoll,
  ITU-Kanal, -kabel*), *lizenziert/abstimmbar/durchstimmbar*, and a decimal comma in a wavelength.
- **Boundaries:** explicit lookarounds, no `\b`.
- **Guard:** the script refuses to run unless six English control names stay unmatched and a known German row matches.
- **Two over-reaches caught while building it, both now controls:**
  - A first pattern ("HE", "×", "bis" alone) matched 900 switch rows.
  - A decimal comma alone matched the English "MX - Pwr cable United States 4,5m".
- **Precision:** 48 of 48 randomly sampled matches were German. Every one of the groups by marker was read.
- **Recall probe:** unmatched names were searched for further German words. The probe found *kompakter*, *Weitverkehr*,
  *durchstimmbar*, *zu*, *-kabel* and *erweiterte*, and all of them were added. What remains unmatched in the same shop
  template is language-neutral, e.g. "Catalyst-1000-Managed-Switch (L2, IOS) – 8× 1G-RJ45 + 2× 1G-Combo".

## Counts

| category | live hardware | German name | in the shop template "Cisco ‹SKU› …" | source `hexcat`, tier 0 | source null, tier null | English twin X/X= exists | naming document | no English name anywhere |
|---|---|---|---|---|---|---|---|---|
| switches | 7,541 | **613** | 521 | 608 | 5 | 174 | 0 | **439** |
| transceiver | 2,107 | **461** | 441 | 455 | 6 | 222 | 0 | **239** |
| routers and all others | — | 0 | — | — | — | — | — | — |

- **The reviewer's 393 is not reproduced.** 613 switch rows carry German text by this detector, and 521 of them use the full
  "Cisco ‹SKU› …" template. The other 92 are shop titles without the dash/× tail, e.g. "Cisco N7K-M108X2-12 I/O-Linecard für
  Nexus 7000".
- **Transceivers, not in the review's scope:** the same seed wrote 461 German titles there.
- **The 11 null-source rows** are the same template, e.g. C9200-48P "… 19-Zoll-Rackmontage" and SFP-10G-SR "… SFP+ Modul — 850
  nm MMF". They were written before `first_seen_source` was recorded.
- **"English twin"** means the base or spare (X / X=) of the same part holds a name that is neither German, nor "Cisco ‹SKU›",
  nor the shop template. Examples:
  - N7K-C7018-FAB-2 "Fabric-Modul für Nexus 7000" ↔ "Nexus 7000 - 18 Slot Chassis - 110Gbps/Slot Fabric Module"
  - DWDM-XFP-30.33 "ITU-Kanal 1530,33 nm" ↔ "10GBASE-DWDM 1530.33 nm XFP (100-GHz ITU grid)"
- **"Naming document"** is `parts.name_doc_id`. It is null on every German row: no vendor document is linked as the source of
  any of these names.

The full row list (category, sku, tier, source, name_doc_id, English twin name, German name) is re-created by
`npx tsx scripts/audit-german-names.mts --tsv <file>`.

## Why it matters on the layer pages

- A German title is still placed correctly: placement reads the SKU first.
- The shop text does feed name-based rules. "Kupfer", "Modul" and "Leergehäuse" are invisible to English name markers, so the
  name path silently does nothing for these rows.
- The page shows a German title beside English series names.

## Proposed supersede (for the operator; nothing below has run)

1. **Keep the German text, never delete it.** It is operator-seeded catalogue copy and the evidence of what the shop printed.
   Proposed home: a `part_aliases` row of a new kind `shop_title_de`, or a `name_de` column. Either is a migration and a
   decision.
2. **396 rows with an English twin** (switches 174, transceiver 222): propose the twin's English name as `parts.name`.
   - Record the German title per step 1.
   - Carry `review_tier` over unchanged.
   - Log it as one run row with the before/after pair per part.
   - The spare rule (A.1: X and X= are one part) is what licenses taking the twin's name.
3. **678 rows with no English name anywhere** (switches 439, transceiver 239): leave `parts.name` as it is, flag the row, and
   let acquisition supply the English title. Candidates are the Cisco datasheet ordering table and the EoL bulletin row for
   the PID. Do not translate: a machine translation would be a guessed value in the one field a buyer reads first.
4. Re-run `scripts/audit-german-names.mts` after each step. The German count must fall by exactly the rows handled.

Questions for the operator:

- Is the German shop title wanted at all once an English name exists (step 1 home)?
- Is the twin's name acceptable as the English name (step 2)?
