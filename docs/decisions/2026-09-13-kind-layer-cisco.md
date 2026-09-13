# Decision — the Cisco kind layer (layers 2 and 3) implemented from the III.0 measurements (13 Sep 2026)

**Status:** in progress (foundation landed; category work by parallel agents; parent rebuilds, freezes and deploys).
**Authority:** operator, 13 Sep 2026: *"fix the layering specification … the prompt has already guided you what should
be there … all the other categories were guided as well, fix this."* This replaces Part IV's "wait for v3": the III.0
measurements (docs/reports/kind-layer-III0-2026-09-13.md and its addendum) are applied directly, and every place where
they contradict spec v2 is recorded below and in the per-category notes.
**Spec:** `netzspec-cisco-kind-layer-specification-2026-09-13.md` v2 (Part I library, Part II per category, Part III.3 order).

## The rules every category is implemented under

1. **Layer 2 (kind) is membership first.** A row that is not the kind leaves it: by a classifier rule when the category
   is right (a line card filed as a switch becomes `linecard`), by a recorded move plan the parent runs under the
   move guards when the category is wrong (an MDS switch in `switches` goes to `storage-networking`). No kind rule is
   keyed on `series` alone — the III.0 item 3/4 reads showed the series label wrong in bulk.
2. **Layer 3 (role) is `deploy_role`, derived** by `src/core/deployRole.ts` (item 3's hand-read SKU-token rules,
   reproduced 9,783/9,783, 54 witnesses, 5 sabotage cases). It is column-backed like `vendor`/`series`: a discriminator
   of the question set, never a gap. A null role is asked the kind's core and is reported as `role: unresolved`.
3. **The cup bar (spec rule 5, measured, not guessed).** For a (kind, role) population:
   - a cup that is **not required today** becomes required only when its *mapped* label share over readable held parts
     is ≥ 50% (rule 8: new cups enter optional);
   - a cup that **is required today** stays required when mapped share ≥ 50%, **or** mapped + unmapped-printed share
     (`hint_unmapped_share`) ≥ 50% — the datasheet prints it and the mapper does not map it yet, which is filling work,
     not a reason to stop asking (measured: switch `poe_standard` 0% mapped / 66.6% printed, `stackable` 0% / 56.9%);
     otherwise it becomes optional;
   - a registered derivation (`DERIVED_FILL_PATHS`) is a fill path and may be required;
   - a population with **fewer than 30 readable held parts** does not decide on its own share: it takes the kind-level
     (all roles) measurement;
   - role deltas move cups to **optional, never `na`** (rule 7); booleans/enums whose printed answer is "No"/"none"
     are fills;
   - component kinds (cable, cord, kit, bezel, bracket) ask **≤ 3 required cups**, `product_compatibility` first;
   - every required cup keeps an observed fill path (`tests/cupLedger` enforces it).
4. **Where the measurement contradicts spec v2, the measurement wins** and the contradiction is written down. Known
   before implementation (III.0): Business 350/250/220/110 and Catalyst 1200/1300 are `smb`; `forwarding` (22 ASR1000
   ESPs) → `processor`, not `linecard`; Secure Client (18) are ASA hardware bundles and stay `firewall`; no
   `routers.enterprise` row moves to `sp-core` (0 CRS/ASR9K/NCS/SP-8000 SKUs); `transceiver.accessory` 14 are CWDM
   muxes; `interfaces-modules` holds 0 CPAK/CFP rows; `security-module`/`ips-module` → `module` would drop 7 / 1
   measured cups, so they are not folded without a cup decision; 115 ASR5K rows sit in `wireless`, not 15.
5. **Category merges move hardware only** (conferencing → collaboration-endpoints, data-center-networking → switches).
   Licence rows stay where they are; the two categories then hold 0 hardware and no ledger. netzspec.com writes
   `category` only at stub insert (III.0 item 6), so no site redirect is needed for this step; hexwaren.de's live
   category tree contains none of the four slugs (4,528 URLs checked, control `switches` 120).
   `interfaces-modules` vs `routers.module` keeps its current homes (the operator's host-vs-function choice, spec II.11).
   The HCI categories stay (their kinds are already identical to servers).
6. **Nothing is guessed into a store.** Kind changes are code; category and class moves are runs with reverse lists;
   dictionary changes go through `syncDictionaryOn` with its guards; ledgers, censuses, traces, the completeness report
   and the freeze are rebuilt on one commit.

## Dictionary changes (measured across all vendors first)

| key | change | facts anywhere before |
|---|---|---|
| `deploy_role` | domain → the four role axes; column-backed; derived | 5 (all Cisco html_table: 3 `access`, 2 `datacenter-tor` → refused, recorded in the sync run) |
| `drive_form_factor` | NEW, `e` (2.5 / 3.5 / m.2 / e1.s / e3.s / u.2 / u.3), optional until measured | 0 |
| `gpu_memory` | NEW, `n` GB, optional until measured | 0 |

## Per-category results

(filled in by the parent from each category's report when merged)
