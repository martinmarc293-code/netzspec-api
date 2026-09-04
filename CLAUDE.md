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

## Session log (update every session; newest first)

- **2026-09-04 — improvement block (handoff, in progress).** DONE + deployed (`38105b3`):
  tools layer (126 finders, `/v1/tools`), vocabulary round 2, completeness counts vendor/series,
  normaliser locale + K-suffix fixes, planner ordered by product value, worker survives
  navigation during capture, 1,270 junk tasks purged and 772 noise "parts" reclassified,
  enumeration import (9 new), hourly netzspec sync on the box, endpoint sweep: 26/26 at
  200, worst 880 ms. FOUND by the Opus gap audit + adversarial review (docs/CISCO_GAPS.md):
  LANDED later in the block: required fields earned from evidence (+12 req, 9,591 more parts
  scored), catalogue hygiene (3,147 parts reclassified out of hardware for real; Cisco assembly
  and numeric PIDs accepted; capability matrix with "*" lists loaded: 117,042 gap entries gained
  a capable source), normaliser 1.2.0/1.3.0 (imperial units, per-axis dimensions, validated
  label hints, VALUE_IS_PID, dictionary units single and consistent). The watchdog paused
  provantage on a false "zero yield" over SEARCH pages — content vs discovery tasks are now
  counted apart (scraper agent). Completeness recompute for the reclassified parts is pending
  ON THE BOX (a 3k-part `--since` recompute through the tunnel exceeded 10 min) — DONE 4 Sep:
  full recompute on the box wrote 42,157 rows in ~15 min (hardware without a profile: 0).
  Apply-path hardening landed (`80f5c86`, deployed): collisions logged per run, random gate
  sample, produced-per-doc regression, partial-run progress, revision label from the fetch
  stamp, class-C per-SKU exception. Scraper training round 1 landed (`e5ed1f5`): provantage
  UPC/GTIN aliases (0→215 over 120 pages), router-switch waits for its rendered grid (117/226
  pages had been captured blank) and reads SKUs from title anchors, itprice refuses N/A cells
  and completes GPL rows, meraki comparison corner (MS425 0→50 facts), watchdog v3 (content vs
  discovery yield, dead discovery, hung lease > 20 min, tier-aware not-listed streak,
  content-only drift medians, unmapped labels per source), `docs/SCRAPING.md` playbook. The
  sentinel restarts idle lanes itself (`sys.executable`, not the Store alias). A locked
  heartbeat file killed a worker: `write_heartbeat` now retries and skips the beat.
  the deep-extraction apply resolves intra-document disagreements by write order (16,081 in
  shard 0), its gate samples the head of the file only, a failed run leaves facts committed;
  nine hardware categories have no required field (17,753 parts invisible to the gap
  ledger); `is_part_number` refuses 1,497 real Cisco PIDs; the capability matrix leaves
  100,167 gap entries with no capable source. Run #15 (the first apply) was aborted at 96
  facts and those rows removed. IN FLIGHT (Opus): apply-path hardening, required-field
  promotion from evidence, catalogue hygiene (reclassify, real-PID shapes, "*" capability),
  normaliser unit recovery, scraper training round, full-suite run. NEXT once hardening
  lands: deploy, then run the two extraction shards + the PDF file + recompute on the BOX
  (`/root/netzspec-api`, symlink `scraper/cache` → `/var/lib/netzspec-api/cache`, files under
  `/var/lib/netzspec-api/runs/extract/`), never through the tunnel again (an apply of 100k
  facts wrote nothing in an hour from the laptop). TRAPS: `npx tsc` from the wrong cwd runs
  a foreign "tsc" package — always `cd` first; PowerShell's Tee-Object writes UTF-16 logs.

- **2026-09-04 — orchestrator setup (handoff).** CLOSED: subagents default to Opus
  (`.claude/settings.json`, mirrored in netzspec), three project agents in `.claude/agents/`,
  agent + code-graph rules above. VERIFIED: an explicit-model spawn reports "Sonnet 5
  (claude-sonnet-5)" for mechanical work and "Opus 5 (claude-opus-5[1m])" for engineering,
  ~72k tokens each for a trivial task. NOT YET VERIFIED: the named agents (`worker-*`) and the
  settings fallback are read at session start, so this session could not spawn them; the next
  session must spawn `worker-mechanical` and `worker-code` once and record the observed models
  here. NEXT (in the order that finishes fastest): (1) `ingest apply-extract` `--commit` for
  `runs/extract/cisco-deep-2026-09-03-s0.json` and `-s1.json` (s0 dry run passed: precision
  100%, recall 100%); (2) confirm `images --db` linked the 2,752 assignments (images table was
  0 before); (3) re-run the PDF extraction (it died with the session) and apply; (4) merge the
  two normaliser fix sessions (`src/core/specNormalize.ts`, locale + K-suffix) and run
  `npm test`; (5) the finder "tools" layer (data-driven definitions over facets/filter);
  (6) netzspec sync cron on the box. TRAPS: agent definitions and settings need a fresh session;
  `START-SCRAPERS.cmd` run from a tool shell hangs on `start` (run it from Explorer or
  Start-Process); the netzspec repo commit for the settings mirror is local (branch carries 54
  unpushed commits from other sessions — do not push them from here).

- **2026-09-03/04 — build day.** Repo stood up, 89,090 parts migrated from Atlas (run #6,
  reconciliation clean), API live at api.netzspec.com with 26 endpoints, 8 adapters, supervisor,
  sentinel, watchdog. Costs: ~5M agent tokens across five fleets. **Operator budget rule:** no
  sub-agents past 69% of the weekly Claude limit; stop work at 80%.
- **Lessons that cost hours today, all now guarded:**
  - Windows PowerShell 5.1 reads a BOM-less script as ANSI: an em dash inside a string broke
    `nightshift.ps1` at parse time and the supervisor silently never ran. Scripts are ASCII with
    a BOM now; `tests/source-scan` should grow a "ps1 is ASCII" check.
  - `Start-Process npx` fails ("%1 is not a valid Win32 application"): launch
    `node node_modules/tsx/dist/cli.mjs ...` instead.
  - A PowerShell parameter named `$args` arrives empty (automatic variable): every step ran with
    no arguments. Named `$argv` now.
  - A worker process filter that matches its own command line kills the shell that runs it
    (`Where-Object CommandLine -like '*worker.py*'` matched the PowerShell doing the matching).
    Exclude `$PID`, match `-File ...` or `python*` by Name.
  - `sed` with `\t \d \c` in the replacement writes TAB, `d`, form-feed into a script. Repair
    paths through Python or the Edit tool only (D:\Project\CLAUDE.md §4 again).
  - `migrate-atlas --reload` truncates `fetch_queue` too: re-seed from `parts` afterwards.
  - The migration ensured source_docs from TRIMMED URLs but derived relation doc ids from the
    untrimmed URL: one trailing space = FK violation after 1,500 parts. Trim at both sites.
  - `deploy.sh` swapped the app directory and lost `.keys/`; it now carries `.keys` across.
  - Blank Chrome tabs are not idle scrapers: `images.py` and ad-hoc fetches open a tab and never
    navigate. The sentinel now distinguishes "no worker process" from "tab open".
  - The enumeration list carries quantity/range/date tokens next to PIDs; `is_part_number` in
    `scraper/sources/base.py` is the ONE gate at enqueue, in the watchdog and in `partNumber.ts`.

## Environment traps

- Python is `python3.11` on the operator's machine; `Get-Process python` matches nothing.
- Postgres lives on the VPS, localhost-only. Local development goes through the SSH tunnel on
  port 5433 (`D:\tmp\pg-tunnel.sh`); `.env` points there.
- Long jobs: launch with PowerShell `Start-Process`, not as harness background tasks.
- Line endings: LF in git, CRLF in the working tree. Normalise before string-matching.
- The scraper's cache lives on the VPS at `/var/lib/netzspec-api/cache`; the laptop copy is a
  working copy.

## Agents (orchestrator setup, operator decision 4 Sep 2026)

The main session is the brain only: it plans, reviews, decides and commits. It does **no bulk
reading, corpus replays, long suites or bulk edits itself** - those go to an agent, and only
the agent's summary comes back into this context.

- **Every Agent call carries an explicit model.** `.claude/settings.json` sets
  `CLAUDE_CODE_SUBAGENT_MODEL=opus` so an agent without one falls back to Opus, never to the
  session model. Never spawn a Fable subagent: 60% of a weekly limit went in a few hours on
  3 Sep 2026 because fleet agents inherited Fable.
- **Opus at effort max for judgement** (`worker-code`, `worker-review`), **Sonnet at low for
  mechanical work** (`worker-mechanical`), **Haiku for trivial lookups**. The three project
  agents live in `.claude/agents/`; their descriptions say when to pick them.
- Bounded-task rules are unchanged: one deliverable, a fixed file scope, schema-forced output,
  agents never commit, the recap reports what the agents did and what they cost.
- **Budget guard (operator, 4 Sep 2026):** with the orchestrator in place, spawn Opus/Sonnet
  agents freely; stop all work at 80% of the weekly Claude limit.
- Before any task that would read more than a few files, run a suite or replay the corpus,
  delegate it with an explicit model and keep only the summary here.
- At the end of each work block, write a handoff note in the session log below: decisions
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
