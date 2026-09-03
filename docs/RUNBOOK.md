# netzspec-api — runbook

Operations only. Architecture is in `ARCHITECTURE.md`, the schema in `DATA_MODEL.md`.
Every command below is copy-pasteable. "On the box" means an SSH session as root; "on the
laptop" means the operator machine in the repo root `D:\Project\netzspec-api` (Git Bash).

Connect to the box:

```bash
ssh -i ~/.ssh/dubaifix_hetzner root@77.42.72.81
```

## The box, in one table

| Thing | Where |
| --- | --- |
| App tree | `/root/netzspec-api` (previous release: `/root/netzspec-api.old`) |
| Process | PM2 app `netzspec-api`, `node dist/api/server.js`, `127.0.0.1:3021` |
| Public | `https://api.netzspec.com` → Cloudflare (proxied) → Caddy (`tls internal`) → 3021 |
| Caddy config | `/etc/caddy/Caddyfile` (our vhost = `ops/Caddyfile.api.snippet`) |
| Database | Postgres 16, localhost only, database `netzspec`, role `netzspec_api` |
| Data | `/var/lib/netzspec-api/{cache,images,reference,runs,backups}` |
| Backup log | `/var/log/netzspec-api-backup.log` |
| PM2 logs | `pm2 logs netzspec-api` (`~/.pm2/logs/netzspec-api-*.log`) |

## Deploy

Deploys ship the committed `HEAD`. Nothing uncommitted can reach the server.

1. On the laptop, make sure the tree is clean and the suites pass.

```bash
git status
npm run typecheck && npm test
```

2. Deploy. The script builds into `.new`, runs migrations, swaps, restarts PM2, then polls
   `/health` for 30 s. If `/health` is not 200 in time it rolls back by itself and exits 1.

```bash
bash scripts/deploy.sh
```

3. Confirm the live commit matches.

```bash
git rev-parse HEAD
curl -s https://api.netzspec.com/health
```

If the deploy stops at "MIGRATION FAILED": the live app is untouched, the new tree is at
`/root/netzspec-api.new` for inspection. Fix the migration, commit, deploy again.

First deploy on a fresh box only: create `/root/netzspec-api/.env` (see Credentials) and install
the Caddy vhost (instructions at the top of `ops/Caddyfile.api.snippet`) before running step 2.

## Rollback

The previous release is kept at `/root/netzspec-api.old`. Rollback restores the previous
**code**. It does not undo migrations; migrations are forward-only and must be additive, so the
old code runs fine on the new schema.

1. On the box, swap the directories back and restart.

```bash
cd /root
mv netzspec-api netzspec-api.failed
mv netzspec-api.old netzspec-api
cd netzspec-api
GIT_SHA="$(cat GIT_SHA)" pm2 startOrRestart ops/pm2.config.cjs --update-env
pm2 save
```

2. Check health and the reported version.

```bash
curl -s http://127.0.0.1:3021/health
```

3. Keep `netzspec-api.failed` until the cause is known, then remove it.

```bash
rm -rf /root/netzspec-api.failed
```

## Backup

Nightly at 03:30 by cron: `pg_dump -Fc` to `/var/lib/netzspec-api/backups/netzspec-YYYYMMDD.dump`,
14 days kept; Sundays also `images-YYYYMMDD.tar.gz` (5 kept). The document cache is not backed
up; it is re-fetchable.

Install the cron job once:

```bash
install -m 644 /root/netzspec-api/ops/netzspec-api-backup.cron /etc/cron.d/netzspec-api-backup
systemctl reload cron
```

Run a backup by hand (add `--images` to force the images tar):

```bash
bash /root/netzspec-api/scripts/backup.sh
tail -n 20 /var/log/netzspec-api-backup.log
```

Check the backups exist and are recent. A backup log that stops is the only warning you get.

```bash
ls -lh /var/lib/netzspec-api/backups/
grep -c 'backup done' /var/log/netzspec-api-backup.log
```

Copy the newest dump to the laptop (optional, off-box copy):

```bash
scp -i ~/.ssh/dubaifix_hetzner "root@77.42.72.81:/var/lib/netzspec-api/backups/netzspec-$(date +%Y%m%d).dump" D:/backups/
```

## Restore

`restore.sh` restores into a **new** database `netzspec_restore_YYYYMMDD` and prints counts
next to the live database. It never drops anything. Swapping names is a hand-typed step.

1. On the box, restore and read the counts.

```bash
bash /root/netzspec-api/scripts/restore.sh 20260903
```

2. Compare `parts`, `facts_current`, `runs` and `migrations` against live. They should match
   the day of the dump. If `migrations` is lower than live, run the migrator against the restored
   copy before using it:

```bash
cd /root/netzspec-api
DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#/netzspec$#/netzspec_restore_20260903#')" npm run migrate
```

3. Only if you are replacing the live database, and only after step 2 matched:

```bash
pm2 stop netzspec-api
sudo -u postgres psql -c "ALTER DATABASE netzspec RENAME TO netzspec_old_$(date +%Y%m%d)"
sudo -u postgres psql -c "ALTER DATABASE netzspec_restore_20260903 RENAME TO netzspec"
pm2 start netzspec-api
curl -s http://127.0.0.1:3021/health
```

4. Keep the renamed old database until the API has been observed healthy for a day. Then drop
   it by hand. This is the only place a database is ever dropped.

```bash
sudo -u postgres dropdb netzspec_old_20260903
```

## Rotate an API key

Keys are bearer tokens. Only the sha256 is stored (`api_keys.key_hash`); the token is printed
once at creation. Rotation is create-new, hand over, revoke-old.

1. On the box, list keys and note the id of the one being replaced.

```bash
cd /root/netzspec-api
npx tsx src/api/keys-cli.ts list
```

2. Create the replacement. Copy the printed token to the consumer (netzspec.com, hexwaren.de)
   out of band. It is not shown again.

```bash
npx tsx src/api/keys-cli.ts create --name netzspec-com
```

3. Confirm the consumer works with the new key.

```bash
curl -s -H "Authorization: Bearer <new token>" https://api.netzspec.com/v1/vendors | head -c 300
```

4. Revoke the old one. Revoked keys answer 401 immediately; the row is kept for audit.

```bash
npx tsx src/api/keys-cli.ts revoke --id <old id>
npx tsx src/api/keys-cli.ts list
```

## Add a vendor

Vendors are rows in `vendors`. Add them through a migration so every database (live, test, CI)
gets the same row, and so the run log shows when it appeared.

1. Create the next migration file. Numbering is four digits, in order.

```bash
ls db/migrations/
```

```sql
-- db/migrations/0005_vendor_juniper.sql
INSERT INTO vendors (slug, name) VALUES ('juniper', 'Juniper Networks')
ON CONFLICT (slug) DO NOTHING;
```

2. Apply locally against the test database, then run the database suites.

```bash
NETZSPEC_DB=test npm run migrate
NETZSPEC_DB=test npm run test:db
```

3. Commit and deploy. The deploy applies it to the live database before the swap.

## Add a source

A source is a row in `sources` (tier, politeness, notes) plus, for gap tracking, rows in
`source_fields` saying which field keys it publishes for which categories. Tier decides what
its facts may become: tier 0 operator, 1 vendor PDF, 2 vendor HTML, 3 aggregator, 4 distributor.
Tier 3 and 4 can only corroborate or fill `unverified`.

1. Write the migration. Read `db/migrations/0003_acquisition.sql` and `0004_gaps.sql` first for
   the column meanings and the seed rows to copy.

```sql
-- db/migrations/0006_source_juniper_datasheets.sql
INSERT INTO sources (slug, name, host, kind, tier, politeness_ms, notes) VALUES
  ('juniper-datasheets', 'Juniper datasheets (HTML)', 'www.juniper.net', 'vendor', 2, 3000,
   'Product datasheets. Facts only. TLS resets seen from both egresses on 2026-09-01.')
ON CONFLICT (slug) DO NOTHING;
```

2. Apply and test as for a vendor. Then queue work for it and watch the queue.

```bash
NETZSPEC_DB=test npm run migrate && NETZSPEC_DB=test npm run test:db
npm run ingest -- queue-gaps
```

Disable a source without deleting it (its facts and checks stay on record):

```sql
UPDATE sources SET enabled = false WHERE slug = 'juniper-datasheets';
```

## Run a migration

`db/migrate.ts` applies `db/migrations/*.sql` in filename order, once each, each in its own
transaction, recorded in `schema_migrations`. There are no down-migrations. Every migration
must be additive: the previous release keeps running on it, because rollback does not undo it.

1. See what would be applied, touching nothing.

```bash
npm run migrate -- --plan
```

2. Apply to the test database and run the suites.

```bash
NETZSPEC_DB=test npm run migrate
NETZSPEC_DB=test npm run test:db
```

3. Apply to the live database. Normally the deploy does this. To run it by hand on the box:

```bash
cd /root/netzspec-api && npm run migrate
```

If it fails, the database is exactly as before (transaction). Fix the file, do not edit an
already-applied migration: add a new one.

## Inspect the fetch queue

Scrapers lease tasks from `fetch_queue`. Statuses: `queued`, `leased`, `done`, `failed`,
`skipped`, `blocked`. On the box, open psql as the app role:

```bash
set -a; . /root/.netzspec-api-db.env; set +a; psql -d netzspec
```

Queue by source and status:

```sql
SELECT s.slug, q.status, count(*), min(q.next_at) AS next_at
FROM fetch_queue q JOIN sources s ON s.id = q.source_id
GROUP BY 1, 2 ORDER BY 1, 2;
```

Stuck leases (leased more than an hour ago; a dead worker):

```sql
SELECT id, task, key, leased_by, leased_at
FROM fetch_queue WHERE status = 'leased' AND leased_at < now() - interval '1 hour';
```

Recent failures and why:

```sql
SELECT s.slug, q.task, q.key, q.attempts, left(q.last_error, 120) AS error
FROM fetch_queue q JOIN sources s ON s.id = q.source_id
WHERE q.status = 'failed' ORDER BY q.updated_at DESC LIMIT 30;
```

Requeue a dead lease (only after confirming the worker is gone):

```sql
UPDATE fetch_queue SET status = 'queued', leased_by = NULL, leased_at = NULL
WHERE status = 'leased' AND leased_at < now() - interval '1 hour';
```

Open gaps that nothing is queued for (an invariant violation, not a backlog; see `DATA_MODEL.md`):

```sql
SELECT * FROM gap_ledger LIMIT 30;
```

## When the SSH tunnel drops

Local development reaches Postgres through an SSH tunnel on `localhost:5433`; `.env` points
there. Symptoms: `ECONNREFUSED 127.0.0.1:5433`, or a query that hangs then times out.

1. Check whether anything listens on 5433.

```bash
netstat -an | grep 5433
```

2. Restart the tunnel (`D:\tmp\pg-tunnel.sh`). By hand it is:

```bash
ssh -i ~/.ssh/dubaifix_hetzner -N -L 5433:127.0.0.1:5432 root@77.42.72.81
```

3. Verify with a read-only query before running anything that writes.

```bash
NETZSPEC_DB=test npx tsx -e "import('./src/store/db.js').then(async m => { console.log((await m.query('select current_database() db, now()')).rows[0]); await m.closePool(); })"
```

Long jobs must not depend on the tunnel: run them on the box, or launch them with
PowerShell `Start-Process` so a dropped harness does not kill them. A job that was mid-run
when the tunnel dropped is inside a `runs` row; check its status before re-running.

```sql
SELECT id, kind, status, started_at, finished_at FROM runs ORDER BY id DESC LIMIT 5;
```

## Health checks

```bash
curl -s https://api.netzspec.com/health
curl -s http://127.0.0.1:3021/health          # on the box, bypasses Cloudflare and Caddy
pm2 status netzspec-api
pm2 logs netzspec-api --lines 50
caddy validate --config /etc/caddy/Caddyfile
```

`/health` returns `{ ok, db, version, parts }`. `db: false` with `ok: true` means the process is
up and Postgres is not; check `systemctl status postgresql`. `version` must equal the deployed
commit; if not, the PM2 environment is stale: `pm2 startOrRestart ops/pm2.config.cjs --update-env`.

## Where every credential lives

Names and paths only. Never paste a value into a chat, a commit, or a shell history.

| Credential | Lives at | Used by |
| --- | --- | --- |
| SSH key for the box | laptop `~/.ssh/dubaifix_hetzner` | `scripts/deploy.sh`, the tunnel, `scp` |
| App database URL (`DATABASE_URL`) | box `/root/netzspec-api/.env` | the API, `npm run migrate`, `ops/pm2.config.cjs` |
| Database credentials for shell tools | box `/root/.netzspec-api-db.env` (mode 600) | `backup.sh`, `restore.sh`, psql |
| Laptop `.env` (`DATABASE_URL` via tunnel, `DATABASE_URL_TEST`) | laptop `D:\Project\netzspec-api\.env` (gitignored) | local pipeline and tests |
| API bearer keys | not stored; `api_keys.key_hash` holds the sha256 | consumers (netzspec.com, hexwaren.de) |
| Postgres superuser | box, `sudo -u postgres` (peer auth, no password) | `restore.sh` createdb, renames |
| Cloudflare account | browser, account `aimanasgher3` | DNS for `api.netzspec.com` |

`.env` is never shipped from the laptop: the deploy copies the box's own copy into the new tree.
A missing variable fails startup with the variable named (`src/config.ts`); the fix is on the
box, followed by `pm2 startOrRestart ops/pm2.config.cjs --update-env`.
