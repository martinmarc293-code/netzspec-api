// db/migrate.ts — applies db/migrations/*.sql in filename order, once each, each inside its own
// transaction. No ORM, no down-migrations: the schema IS the contract and it only moves forward.
//
//   npm run migrate            apply anything not yet applied
//   npm run migrate -- --plan  list what would be applied, touch nothing
//
// A migration that fails leaves the database exactly as it was (transaction) and the runner
// exits non-zero, so a deploy script that chains `migrate && restart` never restarts onto a
// half-applied schema.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.js";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "migrations");
const plan = process.argv.includes("--plan");

async function main() {
  const env = loadEnv();
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);

  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = new Set((await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, "")));
    if (pending.length === 0) { console.log(`migrate: up to date (${applied.size} applied)`); return; }
    for (const f of pending) {
      const version = f.replace(/\.sql$/, "");
      if (plan) { console.log(`would apply ${version}`); continue; }
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`applied ${version}`);
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`FAILED ${version}: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
