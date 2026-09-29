# Batch G report — 29/30 Sep 2026 (rulings Q19–Q21 on batch-f-report.md) + Q12 export

**Board 32 / 1 / 0 / 0 of 33 (2df5351 deployed), self-test 24 / 0 / 9. The one red is vendor_coverage, by ruling.**
Standing order item 1 is met; item 2 (the JTL export in the new formats) is live and its check asserts the contract.
Log: `docs/reviewer/2026-09-28/verifier.txt`.

## Q19–Q21 (runs 1423–1427)

- **Q19:** `switches/fex forwarding_rate` widens on its page (12 of 16 seed raws verbatim; witness N2K-C2148T "131 Mpps").
  The other 17 triples' **317 seed facts** (German shop renderings typed in as values) retracted by exact list, run 1425,
  `retracted:q19-seed-rendering`, 0 held (`data/reference/q19-seed-retractions-cisco-2026-09-29.tsv`).
- **Q20:** `scripts/promote-orphan-readings.mts`, run 1427: the six IE PSUs' `{5,95}` promoted (corroborated, 3–5 documents
  each), the two 15216-EF-40 muxes' ranges composed from their two cells (`{-5,65}` °C, `{-40,85}` °C, `{5,95}` %); gate =
  every one of the 39 source cells re-read from its cached document and re-derived by today's normaliser (39/39; an empty
  cache fails it 0/39). 51 conflicts resolved `promoted-reading #<fact>`, 0 orphans left. Two defects of mine on the way,
  both caught before a write landed: jsonb's key order made every reading look different (canonical JSON now), and the
  first commit (run 1426) inserted beside the pour's tombstone and failed on `facts_current_uq`, rolled back clean — a gap
  row is now superseded, a current value refused. The three mux triples then held real values and widen.
- **Q21:** `storage_capacity` floor 1 GB → 0.0625 GB (only Cisco holds the key: 1,268 facts, min 1); sync 1423, rekey
  1424 moved the two MEMUSB-128FT values under a passing gate. **Veto: 0.**

## Q12 export (build order as ruled: shop_ready → the four profiles → the check; the acceptance diff is next)

- `/v1/export?profile=jtl-main|jtl-attributes|jtl-condition|jtl-faq&vendor=cisco` — text/csv, UTF-8 BOM + CRLF, Main 18
  `;` (no "Überverkauf Plattform Hexwaren"), Attributes 4 / Condition 3 / FAQ 3 `,` (FAQ value force-quoted), paged by SKU
  with `X-Next-Cursor`; the four files share one Artikelnummer set per page. `profile=jtl-readiness` gives shop_ready
  counts per category with every reason counted, and per-SKU reasons.
- Groups exactly as recorded: **Switch** (20) and **Transceivers & SFP Modul** (14), in their Wawi order. Every value is a
  SERVED fact through the German rendering contract — absent when the store does not hold it, never copied from the
  recorded files. Other categories publish their German name and one attribute per required cup.
- **shop_ready** = every attribute the mould REQUIRES of the part's (category, kind) resolves (relation-backed cups are
  not_held, never gaps), a real name (not sku-only, not a bullet list), a weight (to the gram), a Kat-3 (R4: AOC is not
  DAC), URL path R3, no condition prose (R2), 3+ FAQ pairs.
- **The check** (`export_profiles_roundtrip`) walks every page of the four files (84 pages) and asserts the contract:
  PASS on 500 real rows, **33 shop_ready parts**. Found on the way: `fetch().text()` strips the BOM, so the first deployed
  run called every page BOM-less — the check now reads raw bytes (control recorded in the commit).
- **Measured: 33 of 41,058 Cisco hardware parts are shop_ready.** The blockers, by count: `weight` (almost every part),
  then FAQ < 3 pairs where a part has no series, then required cups. Acceptance SKUs, all not ready: C9200-24P and
  C9300-48P — Portanzahl / Port-Konfiguration / Port-Geschwindigkeit (their `ports` is `unverified`, mined from the product
  name, so it is not served); C9200-48P-E — Port-Geschwindigkeit, Stacking, weight; SFP-10G-SR — Standard, weight;
  QSFP-100G-CU3M — weight; QDD-400G-DR4 — Formfaktor, Geschwindigkeit, Fasertyp.

## Next (standing order 3–4)

The acceptance diff (our rows against the recorded Switches / Transceivers files, per SKU), then fill by unlock count —
**weight first**: it gates nearly every part, and the ruled order (form_factor → media → 160-cut re-extraction → mapper gaps
→ name lane → acquisition) was set before shop_ready measured it. A ruling is welcome on whether weight jumps the queue.
The shop cups the transceiver group names (transceiver_type, fiber_count, cable_construction, application) are
referenced by the group and not yet dictionary keys — they render nothing until they exist and are filled.
