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
| 2026-09-11 | security class-residue survey (1,222 flagged hardware parts) — READ-ONLY, proposes rules with evidence, main session implements | agent, 1 | opus | ~90k | 100k | (pending) | (pending) |
| 2026-09-11 | routers class-residue survey (782 flagged hardware parts) — READ-ONLY, proposes rules with evidence, main session implements | agent, 1 | opus | ~90k | 100k | (pending) | (pending) |
