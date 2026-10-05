# Router throughput: one basis per sheet, rendered with its basis; required only where the sheets print it (5 Oct 2026)

Operator order, 5 Oct 2026 ~21:00 UTC: the Cisco router category only, until every router is shop_ready through
`/v1/export?vendor=cisco&category=routers`. This record is the throughput half of that work.

## The rulings (reviewer, verbatim)

**(a)** "Approved, one addition: router throughput bases differ across series (IPv4 forwarding vs IMIX vs NAT), so the export
renders the basis with the value — e.g. "1,5 Gbit/s (IPv4, 1400 Byte)" or "900 Mbit/s (NAT)" — never a bare number that invites
a false comparison. "(Performance License)" → __not_a_spec, ESP bandwidth not mapped, one basis per sheet, basis in raw."

**(b)** "Approved — cond(series ∈ the series whose sheets print it), optional elsewhere, the 8 Sep precedent; decision record,
freeze and ledgers on one commit. Don't chase the ISR G2 performance white papers; the sheets are the source."

## What was measured (5 Oct 2026)

Cache-only re-extract of the 257 documents linked to live hardware router parts (190 router sheets), the CURRENT mapper,
category `routers`:

- `router_throughput` is required of all 1,293 kind-router parts and filled on **0** of the 385 held (the store holds 3 such
  facts, all on C1100TG appliances). The mapper DOES produce it today; the router sheets were last applied on 3 Sep (run 59,
  apply-specs), before the throughput rules (cc7ccf6, 11 Sep). The fix is a re-apply, not only a rule.
- Bases printed per model: ISR 4000 "Aggregate Throughput (Default)" / "(Performance License)" / "Aggregate CEF Only [5]
  Throughput (Boost License)"; Catalyst 8200/8300/8500L "IPv4 Forwarding Throughput (1400 bytes)"; 8100–8400 Secure
  "Forwarding (512B)"; ISR 1000 "IPv4 forwarding throughput (IMIX)" (unmapped until this record); RV "NAT throughput"
  (natThroughput.ts, operator ruling 13 Sep: smb only, superseded by a forwarding row on the same sheet); ASR 1000 "ESP
  bandwidth" (the fitted module's figure). No per-model throughput at all on the held 800-series, ISR 900, 1900/2900/3900
  ISR G2, CGR and IR800 sheets.
- Defect found: the unanchored rule `aggregate throughput` (index 192) took "(Performance License)" as well as "(Default)",
  so a re-apply would have held a conflict on every ISR 4000.
- Offered per series after the changes below (planExtract over the re-extracted sheets, kind-router parts): 8000 15/20,
  4000 ISR 8/38, 4000 7/7, Catalyst 8300 4/6, Catalyst 8500L 4/4, 8200 Series Secure 4/4, 8100 Series Secure 2/34,
  Catalyst 8200 2/7, 8400 Series Secure 1/1; printed but not yet read by the pipeline: 1000 (bare-model / pattern headers)
  and RV Series (single-model sheets); 0 offered and none printed: 2900 ISR 269, 800 261, ASR 1000 88, 1900 ISR 36,
  800 ISR 36, 900 ISR 30, Catalyst 6500 29, ...

## What changed

1. `data/schema/attribute-aliases.en.json`, two rules scoped to `routers`, placed before the unanchored aggregate rule:
   `^aggregate throughput \(performance licen[cs]e\)$` → `__not_a_spec` (licence-conditional, like Boost);
   `^ipv4 forwarding throughput \(imix\)$` → `router_throughput`. NAT is deliberately NOT aliased (natThroughput.ts decides).
   Traced: switches, wireless and security map every throughput label exactly as before.
2. `src/pipeline/apply-extract.ts`: `LABEL_IN_RAW = {router_throughput}` — the stored raw keeps the printed label
   ("<label> | <cell>") even with no unit in it, counted as `raw_with_label_basis`.
3. `src/core/jtlExport.ts`: `THROUGHPUT_BASES` / `throughputBasisDe`; System-Durchsatz renders "<value> (<basis>)" —
   IPv4, IMIX · IPv4, 1400 Byte · 512 Byte · NAT · Aggregat, Standardlizenz. A raw with no readable basis renders NOTHING
   (the attribute is a gap, never a bare number). `loadPage` carries `raw`. tests/jtlExport 60/0 (2 new sabotages red when
   the export falls back to the bare number).
4. `src/core/fieldSchema.ts`: `router_throughput: cond({ all: [kind ∈ [router], series ∈ ROUTER_THROUGHPUT_SERIES] }, elseOpt)`
   with `ROUTER_THROUGHPUT_SERIES` = 1000, 4000, 4000 ISR, 8000, 8100/8200/8400 Series Secure, Catalyst 8200/8300/8500L,
   RV Series — 367 of 1,293 routers asked, 926 optional. Checked both ways: every name holds kind-router parts;
   "Catalyst 8500" holds none and is left out.
5. `src/api/queries/jtlExport.ts`: `exportRequired` — the export's question set is the kind's required set PLUS the pending
   cups the part's SERIES settles to required. Without it the export (kind-level) would have dropped System-Durchsatz for
   every router. Role conditions are NOT resolved, exactly as before. Measured catalogue-wide, one pass: ready 574 → 574
   (routers 199 → 199; the 3 routers that would be ready with no throughput requirement at all — C1101-4P, C1101-4PLTEP,
   C8455-G2 — sit in series that print it); 393 parts are asked more (routers 367, wireless 26).
6. `scripts/mould-verify.mts`: board check `router_throughput_series` — a listed series holding no router (dead entry) or a
   router OUTSIDE the list holding a throughput (missed series) fails. Sabotage: "Catalyst 8500" added → FAIL naming it.
   The missed-series direction is not exercised until router throughput facts land (the first router re-apply).

## Addendum, same night: two router sheet rows that reached the wrong cup

Found while hand-reading the ISR 4000 and 8000 Secure Router sheets for the first router golden rows (both rules scoped to
`routers`; switches and security trace exactly as before):

7. `^safety$|^regulatory compliance: safety$|^environmental: certifications$` → `certifications`. "Safety" is the router
   sheets' commonest certification row (104 sheets, 151 rows, "● USA: UL 60950-1 ● Canada: CAN/CSA C22.2 No. 60950-1 …"),
   and the unscoped heading rule sent every one to `__not_a_spec` whether or not it carried standards. Zertifizierungen is
   required of EVERY router, so this was the largest single reason routers could not certify. A heading row that only
   repeats its label is a `__section_heading` sentinel before any rule is consulted (traced: "Safety | Safety" → sentinel),
   so the rule takes only the rows that carry standards.
8. `^altitude \(china\)$` → `__not_a_spec`. The ISR 4000 sheet prints 0–2,000 m for China beside 0–3,050 m for the rest of
   the world; both reached `altitude_max`, so every ISR 4000 held a conflict. The China row is a market's limit, not the
   product's rating.

Owed, found the same way and NOT changed here: the normaliser refuses "3 Rack Units (3RU)" (UNIT_UNKNOWN "Rack") while
"1 RU" reads; the extractor never emits an all-caps row label ("DRAM", "EMC", "MTBF": `_looks_like_label` wants three
lowercase letters, every category); the ISR 4000 weights are printed per power-supply configuration (five rows reach
`weight`) and need a ruling on which is the article weight. The three affected golden rows are in `held_back` with these
reasons.

## Not in this record

The router re-apply itself (golden rows per family, the family gate, commits) and the extractor's header fix
(`_header_subjects`, tests HL1–HL16) ship beside it; the rebuilt freeze, ledgers, censuses and completeness report are on
the rebuild commit that follows the code commit (mould-build at the code commit, ONE BUILD).
