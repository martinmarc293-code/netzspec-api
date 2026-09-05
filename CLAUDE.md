# netzspec-api — rules for working here

Read `docs/ARCHITECTURE.md` first. The general lessons in `D:\Project\CLAUDE.md` apply in
full; the ones that bite hardest here are restated.

## Hard rules

- **Never write to the database outside a run.** Every pipeline command opens a `runs` row,
  records its inputs with hashes, and closes it with stats. A run that writes facts must
  carry a passing gate.
- **Never overwrite a fact.** Supersede it. `facts` is append-only by design.
- **Never resolve a disagreement by write order.** Hold it as a conflict.
- **Never inherit a family value into a SKU the document does not list.**
- **Never guess a value.** A normaliser or parser that cannot parse returns a reason; the
  caller quarantines. Store nothing.
- **Never add a field key by hand to a fact.** Add it to the dictionary with type, unit and
  labels; the FK enforces it.
- **The site's concerns stay out.** No slugs for URLs beyond the part slug, no SEO titles, no
  indexability, no shop prices.

## Proof rules

- **A check that has never failed is not a check.** Every gate gets a sabotage case: a
  deliberately broken input that must be rejected *for the stated reason*.
- **Run over the real corpus and read the output** before believing a green suite. Sort by
  the value most likely to be wrong and look.
- **`\b` is the wrong tool for product strings.** `4x10G`, `10GBASE-T`, `2xSFP` have no word
  boundaries where you expect them. Use explicit lookarounds.
- **Never write a regex through a Python heredoc.** Use the Write/Edit tool for anything
  with a backslash. `tests/` includes a control-character scan of the source tree.
- **A branch that returns before it reads the token has discarded it silently.** `convert()`
  opened with "no canonical unit, so nothing to check" and every unit-less count dropped its
  magnitude suffix: ipv4_routes "360K" was stored as 360, in band, for as long as the branch
  existed (3 Sep 2026). Fields *with* a unit failed safe on the same input. "No canonical unit"
  is not "no token": read the tail on every path, and refuse what the field cannot use rather
  than drop it. The glued-symbol versus spaced-word rule in `countValue` came from the 1,140
  stored values, not from clean cases — a rule that refused every non-bare number would have
  dropped 170 operator-reviewed facts ("6 zl2-Modul-Steckplätze", "8 PoE+").
- After the suite, `npm run typecheck`. `cmd | head; echo $?` reports head's exit code.
- **A resolution class is believed only after its rows are read against the STORED pair.**
  `remerge` reported 4,164 "exact" agreements; every one had kept ≠ rejected (2,494 compared
  two null raws re-normalised to the same nothing; altitude_max 4998.72 vs 3000 was "exact").
  The report's per-class samples were printed under the wrong heading and it passed review.
  Before trusting any bulk resolution, retraction or supersede: `SELECT kept, rejected` for a
  random 20 of the class and check the rule's own predicate by hand (4 Sep 2026).
- **psycopg3: a `with conn.transaction():` block after an earlier SELECT on a non-autocommit
  connection is a SAVEPOINT, not a commit.** The outer implicit transaction is rolled back when
  the script ends, and every print inside the session still shows the "committed" state. An
  operator reopen of 4,164 conflicts (run #63) vanished this way while its own output said
  "open conflicts now: 14,909" (4 Sep 2026). Open every ad-hoc write connection with
  `autocommit=True` and wrap the write in ONE explicit transaction, or `conn.commit()` and
  re-read from a NEW connection before believing it.

## Session log

**Start every session by reading the newest `docs/HANDOFF-*.md`** (currently
`docs/HANDOFF-2026-09-05.md`: rules in force, where things live, production numbers, what is
committed, what is on disk, the backlog in order, the traps). The per-session handoff log lives in
`docs/SESSION-LOG.md` (newest first; update it every session). It moved out of this file on 5 Sep 2026 because every agent reads this file and the
log had grown past 400 lines — see the delegation gate above.

## Environment traps

- Python is `python3.11` on the operator's machine; `Get-Process python` matches nothing.
- Postgres lives on the VPS, localhost-only. Local development goes through the SSH tunnel on
  port 5433 (`D:\tmp\pg-tunnel.sh`); `.env` points there.
- Long jobs: launch with PowerShell `Start-Process`, not as harness background tasks.
- Line endings: LF in git, CRLF in the working tree. Normalise before string-matching.
- The scraper's cache lives on the VPS at `/var/lib/netzspec-api/cache`; the laptop copy is a
  working copy.

## Agents (orchestrator setup, operator decision 4 Sep 2026)

**REINSTATED 5 Sep 2026 (operator): NO subagents, workflows or fleets unless the operator names
the task and approves it in the same message.** The orchestrator burned 11% of the weekly limit in
90 minutes; whenever agents were allowed, small tasks got delegated too. The main session does the
work: the code graph to find lines, scripts for measurement, direct edits, suites by hand. The
section below is kept for the day an agent IS approved — then one agent, priced in the ledger.

- **Every Agent call carries an explicit model.** `.claude/settings.json` sets
  `CLAUDE_CODE_SUBAGENT_MODEL=opus` so an agent without one falls back to Opus, never to the
  session model. Never spawn a Fable subagent: 60% of a weekly limit went in a few hours on
  3 Sep 2026 because fleet agents inherited Fable.
- **Opus at effort max for judgement** (`worker-code`, `worker-review`), **Sonnet at low for
  mechanical work** (`worker-mechanical`), **Haiku for trivial lookups**. The three project
  agents live in `.claude/agents/`; their descriptions say when to pick them.
- Bounded-task rules are unchanged: one deliverable, a fixed file scope, schema-forced output,
  agents never commit, the recap reports what the agents did and what they cost.
- **Budget guard:** stop all work at 80% of the weekly Claude limit (operator, 4 Sep 2026).
  The 4 Sep "spawn freely" permission is WITHDRAWN by the delegation gate below (5 Sep).
- Before any task that would read more than a few files, run a suite or replay the corpus,
  delegate it with an explicit model and keep only the summary here.

### The delegation gate (operator, 5 Sep 2026 — after ~30M subagent tokens in one day)

Every spawn, workflow or background agent passes this gate first, and the recap states the
estimated cost of each spawn:

1. **Do it yourself** when the work is under ~20 files to read or under an hour of edits, or
   when it needs the main session's judgement more than once. A flaky test clause, a missing
   table in a list, a comment fix, a guard widening: never an agent.
2. **One reviewer, not three,** and only where a wrong change damages data or production.
   Findings below high severity get no refuter at all.
3. **A workflow only for three or more independent, file-disjoint items.** Otherwise one agent,
   sequential. Never a reviewer per group re-running whole database suites on shared test
   databases (contention cost hours on 5 Sep).
4. **Estimate before spawning.** Over 300k tokens needs a written reason in the recap; over 2M,
   or any review with more than ten agents, waits for the operator's yes.
5. **Message an existing agent** (SendMessage) instead of spawning a new one while its context
   still applies.
6. **Keep this file short** — every agent reads it. The session log lives in
   `docs/SESSION-LOG.md`, not here.
7. **After a stall, a sleep or an outage, resume one agent at a time.** Do not relaunch a fleet.
8. The "ultracode" workflow mode ("token cost is not a constraint") is OFF for this project by
   operator decision, whatever the session flag says.
9. **The ledger is the wall.** `docs/ORCHESTRATION-LEDGER.md` gets a line BEFORE any spawn
   (estimate + cap) and the actual afterwards; daily cap 1.5M subagent tokens; per-task caps
   60k mechanical / 100k hard / 30k diff review; over a cap = ask first. Scripts, not agents,
   for measurement, replays, suites and counts. One build at a time on this laptop. Reviews
   only before a production write, diff-only.
- At the end of each work block, write a handoff note in `docs/SESSION-LOG.md`: decisions
  marked closed, what is done and verified, what is next, traps hit.

## Code graph first (graphify)

`graphify-out/` (gitignored, rebuilt by a post-commit hook at zero model cost) holds a graph of
this repo. Before reading files to orient, ask the graph:

```
graphify query "<question>" --budget 800
graphify explain "<Node>"
graphify path "A" "B"
graphify god-nodes
```

Open a source file only after the graph has pointed at it. Trust the graph only while
`built_at_commit` in `graphify-out/graph.json` matches `git rev-parse HEAD`. **Never run a
`/graphify` build or `--update` from a session**: its docs and images would go through the
session's model. `.graphifyignore` says what the graph leaves out.
