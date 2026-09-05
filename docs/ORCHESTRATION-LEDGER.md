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
| 2026-09-05 | round 3 fixes (running) | workflow, 12 agents | opus/high | none | none | pending | |
| 2026-09-05 | proxy lanes build + review (running) | workflow, 2 agents | opus/high | none | none | pending | |
| 2026-09-05 | forensics + design, 4 analysts + 4 skeptics (running) | workflow, 8 agents | opus/high | none | none | pending | |
| 2026-09-05 | recall audit + official lanes, 2 + 2 (running) | workflow, 4 agents | opus/high | none | none | pending | |
