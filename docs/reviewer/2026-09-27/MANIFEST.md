# Reviewer bundle — 27 Sep 2026, commit `28228b7`

Built by `npx tsx scripts/reviewer-bundle.mts` plus `git archive`. The zips and CSVs are gitignored; this
manifest is committed so what was handed over is answerable later without anyone's memory.

## Why a bundle rather than a token

The reviewer is a **browser-based Claude**. It cannot clone a repository and cannot set an `Authorization`
header, so the brief's STEP A.1 fine-grained PAT reaches a human or a Claude Code session and nobody else.
A bundle is what a web reviewer can actually read. (The live API is a second route that *does* work for it:
`src/api/auth.ts` accepts a key as a header, `x-api-key`, `?api_key=` **or a path segment**, which is why
the key it replaces was named `claude-web-url`.)

## What the six audit passes were actually reading, and why they were stale

| surface | commit it reported | date |
|---|---|---|
| arrangement site | `0240f1e` / `ffd240f` | 25 Sep |
| `/v1` endpoints' artefacts | `ea74e31` – `adcae72` | **13 Sep** |
| live API server | `cf95d4a` (from `/health`) | **13 Sep** |
| this bundle | `28228b7` | 27 Sep |

**None of those four commits was on any remote branch**, so the reviewer never read the repository — it read
the deployed surfaces and their self-reported stamps. The staleness is therefore the audit's own finding
N19/N45 ("the API serves a different mould than the site"), not a git problem: the deployed API is 14 days
behind. `cisco` has since been pushed (`6150146..28228b7`, 349 commits), verified from the remote rather than
from the push output. `main` is deliberately untouched, still 30 behind.

Everything from 26–27 Sep was invisible to the audit, including: the German rendering contract
(`text_de` on every fact, 96.31% of 69,381), layers 2+3 on the part record, the `sync-dictionary` outage that
had frozen `/v1/fields` for 13 days (run 1222), the five withdrawn `deploy_role` facts (run 1221), and
today's layer-3/layer-4 corrections.

## `code-28228b7.zip` — 12 MB, 945 entries

The complete tracked tree at `28228b7`: all of `src/`, `tests/`, `docs/` (106 reports, 64 decisions),
`data/reference` (the 17 product-line files), `data/layers`, `data/mapper`, `data/ledger`, `db/migrations`,
`scripts/`. Nothing excluded except what git already excludes.

## `data-28228b7.zip` — 2.4 MB (53.7 MB raw), 573,749 rows

| file | rows | raw | what it is |
|---|---|---|---|
| `parts.csv` | 91,682 | 3.9 MB | every part, live and retired, with the columns the layering and profiles read |
| `facts_current.csv` | 117,456 | 9.8 MB | current facts only (`superseded_by IS NULL`), including retraction rows, which carry no value |
| `doc_parts.csv` | 129,880 | 2.1 MB | every document→part link with basis and relevance — the held rule reads these |
| `conflicts.csv` | 45,844 | 12.5 MB | conflicts as logged, with both raws |
| `relations.csv` | 87,746 | 2.6 MB | successor / compatible / spare_of |
| `completeness.csv` | 91,533 | 16.7 MB | the per-part score as stored, so any percentage can be re-derived |
| `source_docs.csv` | 8,387 | 0.1 MB | every document known, with its classification |
| `runs.csv` | 1,221 | 6.0 MB | every recorded run — inputs, stats, gate |
| `QUERIES.md` | — | — | the query that produced each file |

**Every row count equals its table's own `count(*)`** — that is the control, and it is what proves the
composite-key pagination on `doc_parts` (primary key `(doc_id, part_id)`, no `id` column) lost nothing. A
single-column keyset over a composite key skips or repeats rows at each batch boundary and the file still
looks complete, which is why `dump()` uses a row-value comparison.

## Not included, stated rather than left to be noticed

- **`.env` and every credential.** Never tracked (only `.env.example`); `git log --all -- '*.env'` is empty.
- **The cached documents** — 12,231 files on the box at `/var/lib/netzspec-api/cache`. `source_docs.csv`
  carries each one's `cache_path` and `content_sha256`, so a document can be requested by name.
- **Fact HISTORY.** 32,832 superseded rows are excluded; only current rows are here.
- **The other three worktrees' uncommitted work.** Only what is committed and pushed.

## Errors found in STEP A by running it

1. `keys-cli.ts create --scopes read --label …` **fails**: `create needs --name`. There is no `--label`.
2. A read-only PAT issued before the push would have shown the reviewer **11 Sep** — staler than the 25 Sep
   state it had already audited.
3. A PAT cannot be used by a web reviewer at all (no clone, no headers).
