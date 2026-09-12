# Orchestration ledger

The wall: no Agent, Workflow or background agent is spawned without a line here BEFORE it starts
(estimate + cap), and its actual usage is written back from the task notification when it ends.
Daily cap for this project: 1,500,000 subagent tokens. Per-task caps: mechanical edit 60k, hard
bounded edit 100k, diff review 30k. Over a cap = ask the operator first. Scripts, not agents, for
measurement, replays, suites and counts.

Routing: edits under a few hundred lines → main session; larger bounded edits → ONE agent with a brief
pack (file ranges + inline rules, no orientation reads, Sonnet unless judgement is needed); samples →
main session reads 20 rows; reviews → diff-only, one agent, only before a production write; follow-ups →
message the existing agent. One build at a time on this laptop.

| date (UTC) | task | kind | model/effort | estimate | cap | actual | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-04/05 | (before the ledger) adversarial review of 66 commits | workflow, 162 agents | opus/high | none | none | ~15.5M | 33 confirmed findings, 4 of them data-corrupting; the rest overpriced |
| 2026-09-04/05 | (before the ledger) fix rounds 1–2, reviewer per group | workflow, 16 agents | opus/high | none | none | ~3.6M | 8 of 8 groups fixed, 5 needed a second pass |
| 2026-09-04/05 | (before the ledger) ~25 single agents | agents | opus/high | none | none | ~8M | mixed; several ten-minute edits |
| 2026-09-05 | round 3 fixes | workflow, 12 agents | opus/high | none | none | STOPPED by operator mid-run | partial edits on disk (ops scripts, images, partnumber, merge-core, gate, api) — finish by hand |
| 2026-09-05 | proxy lanes build + review | workflow, 2 agents | opus/high | none | none | STOPPED by operator mid-run | partial edits on disk — finish by hand |
| 2026-09-05 | forensics + design, 4 + 4 | workflow, 8 agents | opus/high | none | none | STOPPED by operator mid-run | journal under subagents/workflows/wf_2448c142-27f |
| 2026-09-05 | recall audit + official lanes, 2 + 2 | workflow, 4 agents | opus/high | none | none | STOPPED by operator mid-run | journal under subagents/workflows/wf_29580478-c0c |
| 2026-09-05 | OPERATOR VERDICT: 11% of the weekly limit in 90 min — NO SUBAGENTS from here on unless named per task | | | | | | rule reinstated in CLAUDE.md and memory |
| 2026-09-11 | OPERATOR (Fri night, 42% of weekly limit used): "I am allowing you to use agents to work effectively" | | | | | | general permission; each spawn still logged here first |
| 2026-09-11 | security class-residue survey (1,222 flagged hardware parts) — READ-ONLY, proposes rules with evidence, main session implements | agent, 1 | opus | ~90k | 100k | 213,492 — OVER CAP (2.1x) | ~38 rules proposed with cross-vendor gating and refusals; not yet implemented; a survey of this size needs ~220k, size the next one so |
| 2026-09-11 | routers class-residue survey (782 flagged hardware parts) — READ-ONLY, proposes rules with evidence, main session implements | agent, 1 | opus | ~90k | 100k | 196,015 — OVER CAP (2.0x) | ~40 rules proposed; flagged list reproduced at 735 not 782; not yet implemented |
| 2026-09-12 | OPERATOR (Sat): "you can use agents if you want, fix all the issues" | | | | | | permission for today's round; each spawn logged here first |
| 2026-09-12 | routers KIND-marker survey (§6.2 of the reviewer's verdict) — READ-ONLY, measures part/device evidence per SKU marker, proposes routerKind rules + refusals | agent, 1 | opus | ~180k | 220k | 322,799 — OVER CAP (1.5x) | 14 ordered kind rules + default router, 25 pinned refusals, distribution sums to 6,460; no writes |
| 2026-09-12 | routers FIELD survey (§6.3/6.4) — READ-ONLY, existing keys per quantity, label counts, value ranges for bands | agent, 1 | opus | ~150k | 200k | 297,553 — OVER CAP (1.5x) | per-quantity table, 16 duplicate cups, alias list, band table checked against stored values; no writes |
| 2026-09-12 | OPERATOR (Sat, answering the gate's item 4): "Yes, run all 8" — eight category agents, ~3M tokens, over the 2M line | | | | | | approval for the eight below; each still logged here first |
| 2026-09-12 | CATEGORY agent: wireless — cups per kind, kind classifier, class rules, aliases, bands, ledger, report; own worktree D:\Project\nzs-agents\wireless, DB read-only, no commits | agent, 1 | opus | ~400k | 450k | 429,474 | wirelessKind (13 kinds, 172 cases), profile by kind, ledger, report — merged as 937c1ae. NOT done: class rules for ~870 licence/software rows, the wifi_generation misroute alias fix |
| 2026-09-12 | CATEGORY agent: video — same brief (D:\Project\nzs-agents\BRIEF.md), worktree nzs-agents\video | agent, 1 | opus | ~400k | 450k | (pending) | (pending) |
| 2026-09-12 | CATEGORY agent: collab (unified-communications, collaboration-endpoints, conferencing) — same brief, worktree nzs-agents\collab | agent, 1 | opus | ~400k | 450k | (pending) | (pending) |
| 2026-09-12 | CATEGORY agent: optical-storage (optical-networking, storage-networking) — same brief, worktree nzs-agents\optical-storage | agent, 1 | opus | ~400k | 450k | (pending) | (pending) |
| 2026-09-12 | CATEGORY agent: modules-misc (interfaces-modules, meraki, data-center-networking + the four residue categories) — same brief, worktree nzs-agents\modules-misc | agent, 1 | opus | ~400k | 450k | 478,451 — stopped AT CAP | investigation only, NO code: all 51 residue rows are misfiled hardware, interfaces-modules holds ~8 kinds incl. ~60 whole devices and ~40 datasheet cells, meraki splits cleanly by SKU letter; report in its worktree runs/reports. Lesson: a residue group needs a survey first, not a build brief |
| 2026-09-12 | CATEGORY agent: routers — reviewer §6 in order, fed by three surveys (class residue 11 Sep, fields 12 Sep, kind markers 12 Sep); worktree nzs-agents\routers | agent, 1 | opus | ~450k | 500k | (pending) | (pending) |
| 2026-09-12 | CATEGORY agent: security — reviewer §4 security + class-residue survey (11 Sep) + series survey (12 Sep); worktree nzs-agents\security | agent, 1 | opus | ~450k | 500k | 454,179 — stopped at its stop line | PARTIAL: 108 class rules (3,721 rows leave hardware, none with an own physical fact; productClass suite 5 misses, 1 = no test cases yet) and a draft securityKind (not registered); profile, tests, ledger, report NOT done |
| 2026-09-12 | CATEGORY agent: servers (servers-unified-computing, hyperconverged-systems, hyperconverged-infrastructure) — reviewer §4 servers + series survey; worktree nzs-agents\servers | agent, 1 | opus | ~450k | 500k | 422,047 | full brief done; merged as 813b070 |
| 2026-09-12 | (actuals for the rest) video 556,512 · collab 528,484 · routers 517,155 · optical-storage 615,315 — all over their 450-500k caps; eight category agents 4.00M, three surveys 1.02M, 5.02M in the day against a ~3M estimate | | | | | | the estimate was per agent and held for none of them: a category round costs 450-620k, not 400k |
| 2026-09-12 | OPERATOR (Sat evening): "you can use agents for fast and efffective work if u want" | | | | | | permission for the two finishing agents below |
| 2026-09-12 | FINISH agent: security — profile by kind, register securityKind, tests for the 108 class rules, bands, ledger, report (its partial work is in nzs-agents\security) | agent, 1 | opus | ~450k | 500k | (pending) | (pending) |
| 2026-09-12 | FINISH agent: modules-misc — implement from its own survey report (interfaces-modules, meraki, data-center-networking, 51 residue rows) | agent, 1 | opus | ~450k | 500k | (pending) | (pending) |
| 2026-09-12 | security + servers SERIES-repair survey (reviewer's 09-12 additive prompt) — READ-ONLY, series placement, SaaS-series hardware rows, proposed rules + refusals | agent, 1 | opus | ~180k | 220k | 396,831 — OVER CAP (1.8x) | 21 security + 7 servers class rules with refusals, component-axis securityKind markers, 606 SaaS-series rows read; no writes. Surveys run ~1.6x their estimate: size the next at ~300k |
| 2026-09-12 | FINISH agent: unified-communications class rules — the 1,456-row fallback measured as ~1,430 licence/software rows + 16 real PBX gateways; families read in full, refusals pinned | agent, 1 | opus | ~300k | 400k | 552,372 — OVER CAP (1.4x) | 95 rules deciding 1,937 rows, 0 with an own fact; 43 refusals + 22 sabotage cases; `unknown` 1,626 → 104. Found 3 defects its own fact gate could NOT see (a bare `BE6K-` prefix ate the Business Edition 6000 appliance + 4 servers + 13 components) by adding a SECOND control: rows it calls non-hardware that collabKind gives a physical kind. A class round costs ~550k, not 300k |
