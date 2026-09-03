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
- After the suite, `npm run typecheck`. `cmd | head; echo $?` reports head's exit code.

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
