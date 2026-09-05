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

for b in $BRANDS; do
  dir="$PARENT/netzspec-$b"
  branch="brand/$b"
  if [ -d "$dir" ]; then
    echo "  $b: $dir already exists — leaving it alone"
    continue
  fi
  if [ "$APPLY" != "--apply" ]; then
    echo "  $b: would create $dir on branch $branch, and copy .env into it"
    continue
  fi
  echo "  $b: creating $dir on $branch"
  # -B so a re-run after a deleted directory reuses the branch instead of failing
  git worktree add -B "$branch" "$dir" HEAD
  # .env is gitignored and every tool needs it: the tunnel URL, the API keys, the proxy secret.
  # Copied rather than symlinked so a brand can point at a different database without editing
  # everyone else's file.
  if [ -f "$ROOT/.env" ]; then
    cp "$ROOT/.env" "$dir/.env"
    echo "      .env copied (it is gitignored; each tree keeps its own)"
  fi
  # The cache is a junction on this machine and is deliberately SHARED - content-addressed by URL,
  # so three brands never pay to fetch the same document twice.
  echo "      NOTE: scraper/cache is shared on purpose; do not un-share it"
done

echo
if [ "$APPLY" != "--apply" ]; then
  echo "This was a dry run. Re-run with --apply to create them."
  echo
fi
cat <<'NOTES'
AFTER CREATING THEM

  1. Each session opens ITS OWN directory and works only there:
       cisco   -> ../netzspec-cisco
       hpe     -> ../netzspec-hpe
       juniper -> ../netzspec-juniper
  2. A brand commits on its own branch and merges to main when a piece is finished. A shared-engine
     change (worker.py, src/core/*, migrations) is still a coordinated act - it is now also a
     visible one, because it arrives as a merge somebody reviewed rather than as a file that
     changed under a running lane.
  3. `git worktree list` shows them all. `git worktree remove <dir>` takes one away.
  4. The advisory locks still apply and still matter: they are what stops two workers on one lane
     and two suites on one test database, and those are cross-process facts that no amount of
     directory separation would prevent.
NOTES
