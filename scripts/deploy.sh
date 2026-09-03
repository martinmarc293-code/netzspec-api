#!/usr/bin/env bash
# scripts/deploy.sh — ship the current git HEAD of netzspec-api to the Hetzner box.
#
# Why it looks like this (mirrors D:\Project\netzspec\scripts\deploy-vps.sh, the house style):
#   * `git archive HEAD` ships exactly what is committed. An uncommitted file cannot reach the
#     server, so "it works on my machine" is answerable with `git status`.
#   * Build into /root/netzspec-api.new, MIGRATE, then swap. The live app keeps serving the old
#     code until the new tree has compiled AND the schema has moved. A failed build or a failed
#     migration leaves the live directory untouched and exits non-zero.
#   * The previous tree is kept as /root/netzspec-api.old for rollback.
#   * After the restart the script polls /health for 30 s. Not 200 in time → automatic rollback
#     to .old and exit 1. A deploy that reports success while the process is crash-looping is the
#     failure mode this exists to prevent (CLAUDE.md §2: check the thing, not a proxy for it).
#   * GIT_SHA is exported into the PM2 environment so /health can report which commit is live.
#
# Usage:   bash scripts/deploy.sh            (from the repo root, on the operator machine)
# Infra:   Hetzner 77.42.72.81 · Node 22 · PM2 app "netzspec-api" on 127.0.0.1:3021 · Caddy vhost
#          api.netzspec.com (tls internal, behind Cloudflare) · Postgres 16 localhost-only.
#          SSH key ~/.ssh/dubaifix_hetzner · secrets live ONLY in /root/netzspec-api/.env on the box.
#
# Schema note: migrations are forward-only (db/migrate.ts). A rollback restores the previous
# CODE but not the previous schema, so every migration must be additive and safe under the
# previous release. docs/RUNBOOK.md → "Run a migration".
set -euo pipefail

SRV="${NETZSPEC_SSH_HOST:-root@77.42.72.81}"
KEY="${NETZSPEC_SSH_KEY:-$HOME/.ssh/dubaifix_hetzner}"
APP="/root/netzspec-api"
PM2_NAME="netzspec-api"
HEALTH_URL="http://127.0.0.1:3021/health"

cd "$(dirname "$0")/.."

if [ ! -f "$KEY" ]; then
  echo "deploy: SSH key not found at $KEY" >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ "${NETZSPEC_DEPLOY_ALLOW_DIRTY:-}" = "1" ]; then
    # Agents edit this tree while deploys happen. git archive ships HEAD regardless; the flag only
    # acknowledges that what is on disk is not what is being shipped. Say so, loudly.
    echo "deploy: WARNING working tree is dirty; shipping HEAD ($(git rev-parse --short HEAD)) as committed, not the files on disk:" >&2
    git status --porcelain --untracked-files=no | head -20 >&2
  else
    echo "deploy: working tree has uncommitted tracked changes; git archive ships HEAD, not these." >&2
    echo "        commit or stash first (git status), or set NETZSPEC_DEPLOY_ALLOW_DIRTY=1 to ship HEAD anyway." >&2
    exit 1
  fi
fi

GIT_SHA="$(git rev-parse HEAD)"
GIT_SHORT="$(git rev-parse --short HEAD)"
echo "→ deploying $GIT_SHORT to $SRV:$APP"

echo "→ shipping HEAD to server…"
git archive --format=tar HEAD | ssh -i "$KEY" "$SRV" \
  "rm -rf $APP.new && mkdir -p $APP.new && tar -x -C $APP.new"

echo "→ build → migrate → swap → restart → health check (keeps $APP.old for rollback)…"
# GIT_SHA is expanded locally (double quotes) and handed to the remote shell as an env var;
# the heredoc itself is single-quoted so nothing else expands on this side.
ssh -i "$KEY" "$SRV" "GIT_SHA=$GIT_SHA APP=$APP PM2_NAME=$PM2_NAME HEALTH_URL=$HEALTH_URL bash -s" <<'EOF'
set -euo pipefail
NEW="$APP.new"
OLD="$APP.old"

if [ ! -f "$APP/.env" ]; then
  echo "deploy: $APP/.env does not exist on the server. Create it first (docs/RUNBOOK.md → Credentials)." >&2
  exit 1
fi
cp "$APP/.env" "$NEW/.env"                       # carry over secrets; never shipped from the laptop
[ -d "$APP/.keys" ] && cp -r "$APP/.keys" "$NEW/.keys"   # API tokens shown once and kept here; a deploy must not lose them
echo "$GIT_SHA" > "$NEW/GIT_SHA"                 # read by ops/pm2.config.cjs when GIT_SHA is not in the env

cd "$NEW"
# devDependencies are needed: tsc builds, tsx runs db/migrate.ts. Do NOT set NODE_ENV=production here.
npm ci --no-audit --no-fund
npm run build                                    # tsc -p tsconfig.build.json → dist/
if [ ! -f dist/api/server.js ]; then
  echo "deploy: build produced no dist/api/server.js; live app untouched; $NEW left for inspection." >&2
  exit 1
fi

# Migrate BEFORE the swap. db/migrate.ts wraps each migration in a transaction and exits
# non-zero on failure, so a failed migration leaves the schema and the live app as they were.
echo "→ npm run migrate (against the live database)"
if ! npm run migrate; then
  echo "deploy: MIGRATION FAILED. Live app untouched. $NEW left in place for inspection." >&2
  exit 1
fi

# Swap.
rm -rf "$OLD"
if [ -d "$APP" ]; then mv "$APP" "$OLD"; fi
mv "$NEW" "$APP"
cd "$APP"

# startOrRestart re-reads ops/pm2.config.cjs, which loads .env and picks up GIT_SHA from the
# environment of this shell; --update-env makes the running process take the new values.
GIT_SHA="$GIT_SHA" pm2 startOrRestart ops/pm2.config.cjs --update-env
pm2 save

# Post-deploy check: /health must answer 200 within 30 s or we roll back.
ok=0
for i in $(seq 1 30); do
  code="$(curl -s -o /tmp/netzspec-health.json -w '%{http_code}' --max-time 2 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done

if [ "$ok" -ne 1 ]; then
  echo "deploy: /health did not return 200 within 30 s (last status: ${code:-none}). ROLLING BACK." >&2
  pm2 logs "$PM2_NAME" --nostream --lines 40 || true
  if [ -d "$OLD" ]; then
    rm -rf "$APP.failed"
    mv "$APP" "$APP.failed"
    mv "$OLD" "$APP"
    cd "$APP"
    GIT_SHA="$(cat "$APP/GIT_SHA" 2>/dev/null || echo unknown)" pm2 startOrRestart ops/pm2.config.cjs --update-env
    pm2 save
    echo "deploy: rolled back to $(cat "$APP/GIT_SHA" 2>/dev/null || echo '?'). Failed tree kept at $APP.failed." >&2
  else
    echo "deploy: no $OLD to roll back to (first deploy). Failed tree left at $APP." >&2
  fi
  exit 1
fi

# The health body should name the commit we just shipped. A mismatch means the env did not
# reach the process; it is a warning, not a rollback, because the service IS serving.
if ! grep -q "$GIT_SHA" /tmp/netzspec-health.json; then
  echo "deploy: WARNING /health is 200 but does not report version $GIT_SHA:" >&2
  cat /tmp/netzspec-health.json >&2; echo >&2
fi
echo "health: $(cat /tmp/netzspec-health.json)"
EOF

echo "✓ deployed $GIT_SHORT → https://api.netzspec.com/health"
echo "  rollback: docs/RUNBOOK.md → Rollback  (mv $APP.old → $APP, pm2 startOrRestart ops/pm2.config.cjs)"
