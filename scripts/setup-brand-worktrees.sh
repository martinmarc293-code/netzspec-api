#!/usr/bin/env bash
# scripts/setup-brand-worktrees.sh — give every brand session its own working tree.
#
#   bash scripts/setup-brand-worktrees.sh            # show what it would do
#   bash scripts/setup-brand-worktrees.sh --apply    # create them
#
# WHY THIS IS THE ONLY COMPLETE ANSWER.
#
# Three sessions share one checkout today. Everything else about their isolation has been made
# mechanical — each brand owns a test database and holds an advisory lock on it, each lane holds an
# advisory lock so a second worker is refused, ownership of every file is a table code can read.
# One hazard survives all of that, and it is the one the operator asked about: a session editing a
# shared file CHANGES THE BYTES ON DISK THAT ANOTHER SESSION'S RUNNING WORKER WILL IMPORT NEXT.
#
# A lock cannot fix that. `scraper/worker.py` is read from disk when a worker starts, so an edit
# saved at 14:02 is in the lane that starts at 14:03, whoever made it and whether or not it was
# finished. That is not a race anybody can be careful around; it is one directory being three
# people's desks.
#
# A worktree is a second checkout of the SAME repository — same history, same remote, separate
# files and separate index. After this, a Cisco edit cannot reach the HPE lane at all, because the
# HPE lane is reading different files. `git commit` cannot sweep another session's staging, because
# there is no shared index to sweep. That is the difference between "we agreed not to" and "it
# cannot happen".
#
# WHAT IT COSTS, stated plainly so the decision is informed:
#   * Each brand works on its own branch. Worktrees may not share one, and that is the mechanism,
#     not an inconvenience — two checkouts on one branch would reintroduce the shared index.
#   * Shared-engine changes now travel by merge instead of by being instantly visible. That is a
#     real cost and also the point: today a half-finished edit to worker.py is live in every lane
#     the moment it is saved.
#   * Each worktree needs its own .env (it is gitignored). The script copies it and says so.
#   * The scraper CACHE stays shared on purpose — it is content-addressed by URL, so sharing it
#     means three brands never re-fetch the same document. It is the one thing that SHOULD be
#     common, and nothing writes it destructively.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PARENT="$(dirname "$ROOT")"
APPLY="${1:-}"

BRANDS=$(python3.11 - <<'PY'
import sys
sys.path.insert(0, "scraper")
from brands import ownership as OWN
print(" ".join(OWN.brands()))
PY
)

echo "repository : $ROOT"
echo "brands     : $BRANDS"
echo

if [ -z "${BRANDS// }" ]; then
  echo "no brands in scraper/brands/ownership.py — nothing to do" >&2
  exit 1
fi


# A Windows junction, made idempotently and verified. `mklink /J` needs cmd; PowerShell's
# New-Item -ItemType Junction is the same thing without the quoting hazards.
link_shared() {
  local tree="$1" rel="$2" target="$3"
  local full="$tree/$rel"
  if [ -e "$full" ]; then
    echo "      $rel: already present"
    return 0
  fi
  if [ ! -e "$target" ]; then
    echo "      $rel: TARGET MISSING ($target) - skipped, and the tree will not run until it exists" >&2
    return 0
  fi
  mkdir -p "$(dirname "$full")"
  powershell -NoProfile -Command     "New-Item -ItemType Junction -Path '$(cygpath -w "$full" 2>/dev/null || echo "$full")' -Target '$(cygpath -w "$target" 2>/dev/null || echo "$target")' | Out-Null"     && echo "      $rel -> $target (junction, shared)"     || echo "      $rel: junction FAILED; create it by hand or the tree will not run" >&2
}

for b in $BRANDS; do
  # Convention already in use on this machine: the HPE session created
  # D:/Project/netzspec-api-hpe on branch `hpe`. Matching it rather than inventing a second
  # scheme - two naming conventions for the same thing is how a directory gets created twice.
  dir="$PARENT/netzspec-api-$b"
  branch="$b"
  if [ -d "$dir" ]; then
    echo "  $b: $dir already exists — leaving it alone"
    continue
  fi
  # A brand may already have a worktree under another path or branch name. Creating a second one
  # would give that session two checkouts and defeat the whole point, so ask git rather than the
  # filesystem.
  if git worktree list --porcelain | grep -qi "^branch refs/heads/$branch$"; then
    existing=$(git worktree list | grep -i "\[$branch\]" | awk '{print $1}')
    echo "  $b: already has a worktree at $existing on branch '$branch' — leaving it alone"
    continue
  fi
  if [ "$APPLY" != "--apply" ]; then
    echo "  $b: would create $dir on branch $branch, and copy .env into it"
    continue
  fi
  echo "  $b: creating $dir on $branch"
  # -B so a re-run after a deleted directory reuses the branch instead of failing
  git worktree add -B "$branch" "$dir" HEAD
  # WHICH BRAND IS THIS TREE? The pre-commit hook asks `git config netzspec.brand` to decide whose
  # files it is looking at. That key was set in SHARED config once, and a worktree does not get its
  # own config unless the repository says worktrees may HAVE one - so every checkout answered
  # "cisco", including HPE's. A guard reading the wrong session's name refuses that session's own
  # files as foreign and waves the named session's through: installed, and protecting the wrong
  # thing. `extensions.worktreeConfig` is what makes `--worktree` mean anything at all; without it
  # git ignores the flag silently, which is why it is set here and not assumed.
  git config extensions.worktreeConfig true
  git -C "$dir" config --worktree netzspec.brand "$b"
  got=$(git -C "$dir" config --get netzspec.brand)
  if [ "$got" = "$b" ]; then
    echo "      netzspec.brand=$b set on THIS worktree (the hook reads it to identify the session)"
  else
    echo "      netzspec.brand: set failed, reads '$got' — the commit guard would mis-identify this tree" >&2
  fi
  # .env is gitignored and every tool needs it: the tunnel URL, the API keys, the proxy secret.
  # Copied rather than symlinked so a brand can point at a different database without editing
  # everyone else's file.
  if [ -f "$ROOT/.env" ]; then
    cp "$ROOT/.env" "$dir/.env"
    echo "      .env copied (it is gitignored; each tree keeps its own)"
  fi
  # A fresh worktree contains only what git tracks, so everything GITIGNORED is missing - and
  # without it nothing in the tree runs at all. Found the hard way: the first worktree created had
  # no node_modules, so `npx tsx` and every suite failed, and no scraper/cache, so every lane would
  # have re-fetched the whole corpus.
  #
  #   scraper/cache   JUNCTION to the shared cache. Deliberately shared: it is content-addressed by
  #                   URL, so three brands never pay to fetch the same document twice, and nothing
  #                   writes it destructively (a challenge page is never cached; an unusable
  #                   capture is refused before the write).
  #   node_modules    JUNCTION to the main tree's. Same package.json, same lockfile; three copies
  #                   would be gigabytes and three `npm install` runs for no difference.
  #   runs/           NOT shared. Heartbeats, locks, watchdog reports and acquired pages are
  #                   per-brand state, and sharing them would put three brands' heartbeats in one
  #                   file - exactly the collision this whole exercise is removing.
  #   runs/vocab/     the ONE exception inside runs/, junctioned. A label inventory is not run
  #                   state: it is corpus-wide vocabulary derived from the whole database, keyed by
  #                   SOURCE, and two suites read it as evidence (aliasRules proves no ignore rule
  #                   shadows a mapped label; source-fields proves keysFromInventory maps a real
  #                   inventory to dictionary keys). Without it those checks cannot run, and a
  #                   check that cannot run in a fresh tree is a check that quietly stops being one.
  link_shared "$dir" "scraper/cache" "$(python3.11 -c "import os;print(os.path.realpath('scraper/cache'))")"
  link_shared "$dir" "node_modules"  "$ROOT/node_modules"
  mkdir -p "$dir/runs"
  echo "      runs/ created per-tree (heartbeats and reports must NOT be shared)"
  if [ -d "$ROOT/runs/vocab" ]; then
    link_shared "$dir" "runs/vocab" "$(python3.11 -c "import os;print(os.path.realpath('runs/vocab'))")"
  else
    echo "      runs/vocab: none in the main tree; the label-inventory checks will report a MISS" >&2
  fi
  # THE COMMIT GUARD, CHECKED RATHER THAN ASSUMED. `core.hooksPath` is REPOSITORY config, so every
  # worktree announces the same path whether or not a hook is actually there. On 5 Sep 2026 all
  # four checkouts said `scripts/git-hooks` and two of them held no hook file: git ran nothing and
  # said nothing, and a commit of another brand's files went through unrefused from the wrong tree.
  # That is this repository's signature failure - a check that reads as installed and does not
  # exist - and the fix is that the hook is TRACKED, so a checkout brings it. This block exists to
  # catch the day that stops being true, because the symptom is silence.
  git config core.hooksPath scripts/git-hooks
  if [ -x "$dir/scripts/git-hooks/pre-commit" ] || [ -f "$dir/scripts/git-hooks/pre-commit" ]; then
    echo "      commit guard present in this tree (core.hooksPath=scripts/git-hooks)"
  else
    echo "      COMMIT GUARD MISSING in $dir while core.hooksPath claims it is installed." >&2
    echo "      This tree can commit another brand's files with no refusal. The hook is tracked;" >&2
    echo "      if it is absent the branch predates it — merge it in before working here." >&2
  fi
done

echo
if [ "$APPLY" != "--apply" ]; then
  echo "This was a dry run. Re-run with --apply to create them."
  echo
fi
cat <<'NOTES'
AFTER CREATING THEM

  1. Each session opens ITS OWN directory and works only there:
       cisco   -> ../netzspec-api-cisco
       hpe     -> ../netzspec-api-hpe
       juniper -> ../netzspec-api-juniper
  2. A brand commits on its own branch and merges to main when a piece is finished. A shared-engine
     change (worker.py, src/core/*, migrations) is still a coordinated act - it is now also a
     visible one, because it arrives as a merge somebody reviewed rather than as a file that
     changed under a running lane.
  3. `git worktree list` shows them all. `git worktree remove <dir>` takes one away.
  4. The advisory locks still apply and still matter: they are what stops two workers on one lane
     and two suites on one test database, and those are cross-process facts that no amount of
     directory separation would prevent.
NOTES
