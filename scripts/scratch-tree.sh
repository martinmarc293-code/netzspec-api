#!/usr/bin/env bash
# scripts/scratch-tree.sh -- a SCRATCH copy of the working tree on the box, for DRY runs of uncommitted changes against the
# live store without touching the deployed tree. HEAD by git archive, then every tracked file that differs from HEAD and every
# path named on the command line overlaid on top; node_modules is the deployed tree's (same lockfile is assumed and checked),
# .env is copied (never shipped from the laptop), the page cache is the box's own link. GIT_SHA reads "<head>+scratch" so a run
# opened from here can never pass for a deployed commit.
#
#     bash scripts/scratch-tree.sh [extra paths...]      # then: ssh box 'cd /root/rt-work && npx tsx ...'
#
# A scratch tree is for DRY runs. A write run belongs to a commit, deployed (CLAUDE.md: never production code from no commit).
set -euo pipefail
KEY=~/.ssh/dubaifix_hetzner; SRV=root@77.42.72.81; DIR=/root/rt-work
HEAD=$(git rev-parse HEAD)
git archive --format=tar.gz HEAD | ssh -i "$KEY" "$SRV" "rm -rf $DIR && mkdir -p $DIR && tar -xz -C $DIR"
mapfile -t CHANGED < <( { git diff --name-only HEAD; printf '%s\n' "$@"; } | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done )
if [ ${#CHANGED[@]} -gt 0 ]; then tar -cf - "${CHANGED[@]}" | ssh -i "$KEY" "$SRV" "tar -xf - -C $DIR"; fi
ssh -i "$KEY" "$SRV" "set -e; cd $DIR; cmp -s package-lock.json /root/netzspec-api/package-lock.json || { echo 'scratch-tree: package-lock differs from the deployed tree -- refusing to borrow its node_modules' >&2; exit 1; }
  ln -sfn /root/netzspec-api/node_modules node_modules; cp /root/netzspec-api/.env .env; mkdir -p scraper; ln -sfn /var/lib/netzspec-api/cache scraper/cache
  echo '${HEAD}+scratch' > GIT_SHA"
echo "scratch tree $DIR on $SRV: HEAD ${HEAD:0:7} + ${#CHANGED[@]} overlaid file(s): ${CHANGED[*]:-none}"
