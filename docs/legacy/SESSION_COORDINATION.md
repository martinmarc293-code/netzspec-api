# Two Claude sessions, one repo — how they stay out of each other's way

**Set up 2026-09-01 after a real collision.** Two sessions were editing `D:\Project\netzspec`
simultaneously: a **forum/content session** that deploys the site, and a **scraper session**
building the spec-depth pipeline. Three failures in a few minutes:

- the scraper session's in-progress `.ts` files were type-checked by the content session's build,
  so a mid-edit state failed `tsc` and **aborted a deploy** — the site kept serving the old build;
- `git add -A` in the content session **swept the scraper session's half-finished files into its
  own deploy commits**;
- `tsc` flipped from error to clean mid-check because a file was being written live.

## The split

| | path | branch | owns |
|---|---|---|---|
| Content / deploy session | `D:\Project\netzspec` | `master` | `app/`, `components/`, `lib/` (site), sitemaps, deploys |
| Scraper session | `D:\Project\netzspec-scraper` | `feature/deep-specs` | `scraper/`, `lib/field*`, `lib/spec*`, `scripts/schema/`, `scripts/universe/` |

A **git worktree**, not just a branch. A branch alone does not help: both sessions would still
share one directory, so `git add -A` and `tsc` would still see the other's files. The worktree
gives a second checkout on its own branch, so the filesystems are genuinely separate.

`node_modules` in the worktree is a directory junction to the main one, and `.env.local` is
copied (it is gitignored). Both are already in place.

## Rules

1. **Never `git add -A` / `git commit -a`.** Add explicit paths. This was the root cause.
2. The scraper branch merges into `master` **only when `npx tsc --noEmit` is clean** and its
   suites pass.
3. Neither session edits the other's files. If a spec-pipeline type error ever appears on
   `master` again, a merge has happened — say so rather than patching around it.

## What is shared regardless of branch

- **The MongoDB Atlas database.** One database, both sessions. `specs_v2` and `completeness_v2`
  now exist on all 3,883 parts. The migration was **additive** and verified: `snapshot-staged.ts
  --diff` reported `changed: 0 of 3883` outside the two new fields, so every existing page
  renders byte-identically.
- **`data/schema/*.json` and `data/universe/*.json`** stay on `master` on purpose, so the content
  session keeps local access to the scraped output (including the 2,900-fact 9300 extraction).
- **`scraper/*.py`** stays on `master` too — Python is invisible to `tsc`.

Only the TypeScript moved, because only the TypeScript could break the build.
