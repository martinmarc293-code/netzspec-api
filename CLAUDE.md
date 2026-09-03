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

## Agents

Allowed on this project (operator decision, 3 Sep 2026) for bounded tasks with a fixed file
scope and schema-forced output. Not for extraction at scale. Every agent's output goes
through the same tests as hand-written work.
