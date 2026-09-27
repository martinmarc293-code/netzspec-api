# NETZSPEC — PLAN TO ALL GREEN ON `mould:verify` (deployed API) — 27 Sep 2026

Scoreboard now: **passed 4 | FAILED 9 | not implemented 17 | unavailable 2 | not exercised 0 — of 32.**
Target: **31 green + vendor_coverage OUT OF SCOPE (Cisco-first, printed with the twelve vendors' counts).**
Every line below ends with a DONE criterion that is a number on the public URL. Nothing counts from a laptop.

```text
RULES FOR THE WHOLE PLAN
R1  Order is fixed: PHASE A (write every missing test) → PHASE B (fix in the order that flips the most
    tests) → PHASE C (one page per category + the glass). No fixing in A. No new tests in B.
R2  A test is written when: it computes from the DB (or compares DB ↔ artefact ↔ API); it ships a negative
    fixture from the corpus and a positive twin; it prints its denominator and the query; it can return
    NOT EXERCISED with a producer; and `--self-test` proves the negative fixture fails it.
R3  Green is claimed only against the deployed API (/health names the commit) and the reviewer re-checks
    from /v1. Every message ends with the verifier line.
R4  A red that names a real defect stays red. A fix never narrows a predicate, never demotes a cup on a
    measurement, never edits an assertion to pass.
R5  Push at every step. Retractions and writes: dry-run printed → reviewer reads → recorded run →
    control printed (what did not move). Irreversible outward acts (key deactivation) wait for the
    operator's own word.
R6  Reviewer decisions already ruled (do not re-ask): Q1 = restore routers then min(3, cups asked);
    B4 = per-kind na from archetype, 6,310 witnesses stay opt; 1,104 runs = retroactive approval by
    group, no rollback; conferencing = retire profile with category; PON = kinds olt/ont in switches;
    Meraki = sub_brand, MX→security, MG/Z→routers, MV/MT→physical-security; keys = rename now, revoke
    with operator; vendor_coverage = Cisco-first, out of scope, printed.

=====================================================================
PHASE A — WRITE THE 17 (order = P.4 order; each ≤ 1 hour; report red/green, move on)
=====================================================================
A1  kind_profile_parity (B1)
    Checks: for every kind with parts, the resolved required/pending/optional/na sets are identical in every
    category unless a recorded exception {cup, reason, witness sku, doc, locator} exists in kindProfiles.
    How: resolve via requirementFor per (category, kind) on a synthetic part with only kind set; diff sets.
    Fixture: routers.power vs switches.power (today they differ) must be RED; twin: two categories with
    identical sets must be GREEN. Prints the 19 divergent kinds with their diff.
    DONE: red with the exact divergent list on the deployment.
A2  four_sets_sum (B4)
    Checks: per kind, |req|+|pend|+|opt|+|na| = dictionary size (after superseded keys retire); na > 0.
    Fixture: any kind today (na = 0) is RED; twin: a synthetic kind with na>0 is GREEN.
    DONE: red, count of kinds with na = 0 printed (expect 284).
A3  no_family_reason_present (B2, B3)
    Checks: every layered row has product_family_state ∈ {named, no_family_named, shared_across_line}
    AND, where no_family_named, a no_family_reason ∈ {vendor-names-none, single-series, not-reviewed};
    "(none)"/"(shared…)" never appear as a family value on the API record.
    Fixture: a row with state no_family_named and null reason is RED. DONE: count printed.
A4  bucket_not_series (B3)
    Checks: 0 rows whose product_series ends in "shared parts"; every bucket row carries a host list
    (≥1 host series) or a recorded "no single host" reason.
    Fixture: HCI today (1,089 in bucket) RED. DONE: per-category bucket counts printed.
A5  twin_parity (N7)
    Checks: for every sku ending "=" with a base row: category, kind, product_series identical; base
    missing → base_missing flag, not a failure.
    Fixture: the 13 known pairs RED (UCS-ACC-6536(=), CBR-PS-BLANK(=) …). DONE: 13 printed.
A6  unknown_zero (B7, G7)
    Checks: 0 parts in kind unknown; 0 kinds asked nothing; every refused part has a pending plan.
    Fixture: video.unknown 267 RED. DONE: 462 printed by category.
A7  plans_agree_with_rows (N6)
    Checks: every plan with a run_id has outcome == live row (category, kind); expected_kind_after is a
    kind, not a role word.
    Fixture: the 152 role-word plans + 11 run-1068 plans RED. DONE: counts printed.
A8  gaps_fresh (N2, N3, N46, N47)
    Checks: every completeness row carries the ledger data commit (or verified_at ≥ ledger build);
    required_total = required + pending only; pending stored = |pending_gates|.
    Needs: a stamp column or verified_at written by recompute on EVERY row (unchanged rows too).
    Fixture: C9200-24P computed 12 Sep RED. DONE: count of stale rows printed.
A9  fill_state_partition (N8–N11, N30, N31, N50)
    Checks: per required slot on a scored part exactly one of the eleven states; `filled` ⇒ own +
    spec-bearing doc_type + method ∈ {html_table, pdf_table, derived:*} + replayable + no open conflict.
    Fixture: C9200-24P's 10 hexcat_seed facts with a datasheet source RED (unverified, not filled);
    800-IL-PM-2 ports from an EoL notice RED. DONE: state histogram printed per category.
A10 conflicts_classified (N33, N51–N53)
    Checks: every open conflict has class ∈ {source-disagreement, same-doc-multicolumn, normaliser-split,
    revision-drift}; 0 conflicts without a live fact; 0 normaliser-split.
    Fixture: ATA191-PWR (11 conflicts, 0 facts) RED; C9200 dimensions c1/c2/c3 RED as multicolumn.
    DONE: class histogram of the 16,390 printed.
A11 doc_category_by_relevance (N39, N48, N49, N64)
    Checks: doc_category derived from spec_for_kind links; spec_bearing by spec_tables_found; ONE
    spec-bearing type list (docs/classes == report.inputs); every document titled.
    Fixture: the 12 foreign-title switch docs RED; 105 untitled RED. DONE: 421-foreign list printed.
A12 relations_for_components (N54)
    Checks: every component kind's product_compatibility resolves to ≥1 sourced relation or not-held;
    0 product_compatibility facts.
    Fixture: any reference component (2D-C2-1025WAC=) RED. DONE: slots without relation printed.
A13 name_image_lifecycle_state (N16, N56, N58)
    Checks: every scored part has name_state ∈ {real, sku-only}, image_state ∈ {own, series, none},
    lifecycle_state ∈ {verified-active, eol-announced, unknown-unchecked, unknown-checked}.
    Fixture: 6,472 "Cisco <SKU>" names RED. DONE: three histograms printed.
A14 export_profiles_roundtrip (S1–S9)
    Checks: /v1/export?profile=jtl-main|jtl-attributes-switches|jtl-attributes-transceivers|jtl-faq|
    jtl-condition exists; for C9200-24P, C9200-48P-E, SFP-10G-SR, QSFP-100G-CU3M, QDD-400G-DR4 the files
    validate (19 cols ";" BOM; 4-col attributes; exact Wawi group/attribute names; German decimals; Kat-3
    from the locked lists).
    Fixture: profile absent RED (today). DONE: NOT IMPLEMENTED→RED with "profile missing".
A15 openapi_schemas (N63)
    Checks: components.schemas has Part, Fact, Conflict, Relation, Ledger, Completeness, Line, Family,
    Model, ExportRow; a live response of each validates against its schema.
    Fixture: empty schemas RED. DONE: red with the missing list.
A16 endpoints_alive (N43, N44, N69)
    Checks: /openapi.json 200; /v1/ledger/{v}/{c} 200 + profile_hash; /compare?skus=A,B 200;
    /report lists names; /changes accepts vendor or documents why; /search exact SKU first;
    /gaps carries no_profile_reason, pending, pending_gates.
    DONE: red with the failing routes.
A17 link_integrity (H)
    Checks: every href on the arrangement site resolves; every category page links its layers page and
    back. DONE: 0 broken (green today) — write it anyway so it stays that way.
Also in A (they exist, need their producer or scope):
A18 refusals_consumed — every derivation that can return an issue has its rows recorded with reason;
    NOT EXERCISED with producer when no refused row exists.
A19 premises — comments carrying a measured premise (date + number + query) are re-measured.
A20 vendor_coverage — scoped: `--vendor cisco` reports the twelve as OUT OF SCOPE with counts; brand-wide
    stays red. Both printed.
PHASE A DONE: 32 declared, 0 NOT IMPLEMENTED, `--self-test` green for every negative fixture, line posted.
Expect ~26 red. That is the true size of the job and it is the last time the count surprises anyone.

=====================================================================
PHASE B — FIX IN THE ORDER THAT FLIPS THE MOST TESTS
=====================================================================
B1  one_build (flips: one_build, ledger_parity, gaps_fresh half, db_site_api_parity half)
    - src/core/mould-contract.json via `mould:contract`: dictionary, kind profiles (four sets), role
      domains, held rule + sha, slot-state enum, spec-bearing type list, sku_kind enum, doc-category
      rule, contract_hash.
    - `mould:build`: ledgers, censuses, mapper traces, completeness, /gaps for every row (stamp!), the
      arrangement site, the artefacts /v1/fields and /v1/ledger serve — one data commit.
    - Mandatory `build {data_commit, code_commit, contract_hash, generated_at}` on every artefact;
      whitelist of artefact paths; anything else fails; arrays included (plans.json).
    - /health prints code commit, data commit, contract_hash. Site republished on the deployed commit.
    DONE: one_build green on the deployment; ledger_parity green (byte-equal, same profile_hash).
B2  Layers into the DB (flips: db_site_api_parity, layer_parity, no_family_reason_present half)
    - Columns exist for product_line/product_family/state/product_series/bucket/sku_kind/family_carrier.
    - Plans per category: write from the reference files by recorded runs (dry-run counts first;
      N59 expects ≈ 92% of product_series to change). Reference files become run inputs.
    - db_site_api_parity across 8 columns on 500 seeded SKUs drawn from the DB, asymmetric counts printed.
    DONE: 0 differences on the deployment.
B3  Required cups (flips: required_cup_defined)
    - lan/wan → ports(role) with the 28 retracted (two commits, rows read first).
    - psu_options retired; product_compatibility shape; bundle_contents → relation (with B7).
    - video_codecs → optional, deliberately open (promote-required re-admits).
    DONE: 0 undefined; open-by-decision printed as its own number.
B4  Kind profiles + na (flips: kind_profile_parity, four_sets_sum)
    - kindProfiles.ts: one profile per kind, exceptions {cup, reason, witness}; routers' component kinds
      to the switches level; thin kinds completed with one witness each; security.appliance series gates
      → kind split with move plans; wireless.wlc router_throughput → wlc_throughput.
    - na from the archetype per kind; the 6,310 witnessed (kind, cup) pairs stay opt with the witness.
    - Q1 applied: routers.router pre-demotion set restored; held = min(3, cups asked).
    DONE: both green; four sets sum; na > 0 on every kind; held counts republished.
B5  Layers residue (flips: bucket_not_series, twin_parity, unknown_zero, no_family_reason_present)
    - shared parts → bucket with host lists via product_compatibility; family_carrier out of denominators.
    - Twin check on category+kind+series; 13 pairs planned; base_missing flag.
    - 462 unknown → kinds or non_product plans; GS7000 codes → sku_kind configurator-code + variant_of;
      PON → olt/ont; Meraki per R6; conferencing retired.
    DONE: all four green; partition line still sums.
B6  Runs and keys (flips: runs_have_approval, keys_hygiene half)
    - runs.json; the 1,104 grouped; reviewer rules per group; approval.kind = reviewer_retroactive.
    - keys renamed by holder; revoke-candidates listed; revocation waits for the operator.
    DONE: runs green; keys prints "revoke-candidates: n" red until the operator acts.
B7  Facts hygiene (flips: column_backed_never_facts, enum_values_in_domain, conflicts_classified,
    fill_state_partition, relations_for_components)
    - Retract 7,142 column-backed facts (recorded run).
    - Splitter fixes (bullet delimiter, protected tokens AS/NZS, CAN/CSA, CFR 47) + scoped replays from
      cached documents; (c) list-cup re-extraction under the 6,000 cap, per cup, dry-run first.
    - Enum normalisation/retraction plans per key from the accept/refuse/unclassified counts.
    - Conflict classes; orphans retracted; multi-column reader + list splitter fixed.
    - Inheritance writer disabled; inherited → filled-inherited; seed facts → unverified; EoL-sourced
      → mined.
    - product_compatibility relation pass (compatible_with / option_of); cup resolves via relation.
    DONE: all five green; retraction counts printed with their run ids.
B8  Documents (flips: doc_category_by_relevance)
    - doc_category from spec_for_kind; spec_tables_found; one type list; titles backfilled.
    DONE: green; foreign-title list 0.
B9  Part states (flips: name_image_lifecycle_state, gaps_fresh)
    - name/image/lifecycle states stored and served; recompute stamps every row.
    DONE: green.
B10 API surface (flips: openapi_schemas, endpoints_alive, export_profiles_roundtrip)
    - schemas; /compare, /report, /changes, /search fixed; five JTL export profiles + shop_ready.
    DONE: green; the five acceptance SKUs exported and diffed by the reviewer.

=====================================================================
PHASE C — THE GLASS (after all green)
=====================================================================
C1  One page per category from mould:build: layers → kinds → cups → stacked bars (filled | not_published
    | held_not_parsed | not_held | pending | mapper_gap | defect) at brand/category/line/family/series/
    part; children sum to parent (dashboard_sums test); partition line at the top; verifier result in the
    banner; pending sorted by unlock count; shop_ready bar per category.
C2  /v1/fill/{vendor}/... serves the same JSON the page renders. Nightly drift report.
DONE: the owner reads "Cisco: N% filled, M slots pending, first job form_factor 17,603" on one page.

=====================================================================
THEN FILL
=====================================================================
form_factor prefix table (refusals, 1,615-fact holdout, witness per rule) → media → mapper gaps on held
sheets (412) → list-cup re-extraction → acquisition for not-held. Each a plan, dry-run, recorded run,
control printed, bars move.
```
