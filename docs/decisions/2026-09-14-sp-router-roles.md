# 2026-09-14 — `sp-router` kind with SP roles; router interface cards get one home

Source: the reviewer's layers review of switches + routers (14 Sep 2026), relayed by the operator. Items 1, 6 and 7 change
the arrangement (a kind name, a role axis, the `deploy_role` domain, and the category of 500 rows by plan); items 2–5 and 8
are mapping-file changes only (`data/reference/product-lines/cisco-routers.json`).

## 1. `sp-core` is renamed `sp-router` (routers kind axis)

**What changed.** `src/core/routerKind.ts`: every rule that returned `sp-core` returns `sp-router`; `RT_DEVICE` and
`RT_DEVICE_PORTED` carry the new name; rule ids are unchanged (`sp-crs`, `sp-asr9k`, `sp-asr900`, `sp-ncs`, `sp-8000`,
`sp-legacy`, `sp-n540-system`, `sp-asr5k`) so the census history lines up. `src/core/fieldSchema.ts`: the eight routers cup
conditions that named `sp-core` name `sp-router` — the cup set is unchanged (tests/routerKind.test.ts pins the required set
for `sp-router` with no role, `sp-access` and `sp-core`: identical). `data/reference/kind-definitions.json` renames the entry.

**Why.** `sp-core` named one role of the population, not the kind; ASR 901/920 and NCS 540 are access routers.

**Measured.** Cisco routers hardware rows classified by the HEAD classifier and by this one (5,470 rows): 264 `sp-core` before,
264 `sp-router` after, 0 other kind moves — the rename moves no row between kinds.

## 2. A `sp-router` role axis: sp-access / sp-edge / sp-core

**What changed.** `src/core/deployRole.ts`: `ROLE_DOMAINS["sp-router"] = ["sp-access", "sp-edge", "sp-core"]`, axis
`routers|sp-router`, series table = routers. There are NO SKU rules for this axis: every role comes from the series table.

| role | series (routers mapping) |
|---|---|
| sp-access | ASR 901 (incl. FLS-A901 upgrades, MWR-3941), ASR 900 (902/903/907/914), ASR 920, NCS 520/540/560, NCS 4200 |
| sp-edge | ASR 9000 (incl. A9KV), NCS 5500 (incl. NC55A1/A2), NCS 5700 |
| sp-core | CRS, Cisco 8000, NCS 6000 |
| none — open for the reviewer | NCS 5000 (15 rows), Cisco 7300 (CISCO7301/2+VPNK9, 1 row), ASR 5000 and 5500 (empty until the wireless move) |

One file now holds the series of two axes. A series role that belongs to NO axis of its table still throws (the switches
sabotage case is unchanged); a role of the SIBLING axis (an enterprise-kind row in an SP series, or the reverse) returns no
role and a kind issue naming the disagreement. Live count of such disagreements after this change: 0.

**`deploy_role` domain widening.** `sp-access`, `sp-edge`, `sp-core` join the closed domain in `fieldSchema.ts` (18 values).
Measured across ALL vendors on live facts before the change: 5 `deploy_role` facts exist anywhere, all Cisco, none with an
SP value (three "Centralized, Cisco FlexConnect…" AP deployment strings, two "Data center and server farm"). Nothing admitted
before is refused after; no sync `--allow-refusing` is needed. `deploy_role` is column-backed (derived), never a slot.

**Result (the 264 `sp-router` rows, none of them planned).** sp-access 115, sp-edge 89, sp-core 44, unresolved 16; 13 rows that were placed
in a role-bearing series only by their label got SKU rules (FLS-A901, MWR-, A9KV, NC55A1/A2), so the page and the role
engine agree on them.

## 3. Router interface cards: one home = `interfaces-modules` (item 7)

**Decision.** NIM, SPA, EPA, HWIC/EHWIC/VWIC/WIC, PVDM, VIC, SM-X/SM, NM/NME, ISM/EM and GRWIC cards live in
`interfaces-modules`, not in a routers product line. Reasons: Cisco's own product tree files them under "Interfaces and
Modules"; the store already holds 297 such rows there; and that category's kind classifier already separates interface cards,
cellular pluggables and DSP modules, which the routers axis lumps into `module`.

**Overlap measured (live hardware rows, cached 14 Sep 2026):**

| family | interfaces-modules | routers | switches | unified-communications |
|---|---|---|---|---|
| NIM | 5 | 89 | – | 1 |
| SPA | 62 | 55 | 24 | – |
| EPA | 3 | 21 | – | – |
| HWIC/EHWIC/VWIC/WIC | 127 | 31 | – | 6 |
| PVDM | 2 | 35 | – | 9 |
| VIC | 2 | 19 | – | 3 |
| SM-X / SM | 36 | 36 | – | 4 |
| NM/NME | 46 | 15 | – | – |
| ISM/EM | – | 13 | – | 1 |
| GRWIC | 14 | 24 | – | – |
| other router-module families (P-LTE/5G, IRM/IRMH, WP, WIM, MC/PCEX, UCS-E) | – | 122 | – | – |

Left where they are, by reading: security SM-40/48/56 (Firepower 9300 security modules), servers SM-HDD/ISM-SRE (SRE
drives and engines), cloud-systems-management NIM-BLANK= (a software-class row).

**How it lands.** 500 move plans in `data/reference/kind-layer-plans-2026-09-13.json` (routers 452, switches 24, unified-
communications 24), `run_id` null. NOT RUN: a category move is a recorded run and waits for the operator. Before it runs,
`interfaces-modules` needs kind rules for 101 SKU shapes its classifier returns `unknown` for today (C-NIM, C-SM, IRM/IRMH,
WP-WIFI6, WIM, ISM-VPN/SRE, P-5G/P-LTEA7) — each such plan says so in its reason. The routers "Router Interface Modules"
line stays in the mapping (every series carries a note) so an unrun or refused move is still placed.

## Freeze

`tests/arrangementFreeze.test.ts` was already red before this change (5,044 kind moves and the dictionary projection from
the 13 Sep kind-layer work; the refreeze is part of the parked rebuild). This record adds: the `sp-core` -> `sp-router`
rows of the kind snapshot, the role axis table (`axes_sha`), the `deploy_role` domain in the dictionary projection, and the
500 plans. The refreeze runs with the ledger / census / completeness rebuild, on one commit, per CLAUDE.md.
`tests/cupLedger.test.ts` and `tests/completeness.test.ts` fail on the same set before and after this change (compared on a
clean `git archive HEAD` extraction): the only difference is the routers ledger line naming `sp-router` instead of `sp-core`.
