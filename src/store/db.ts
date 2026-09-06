// src/store/db.ts — the one connection pool. Everything that talks to Postgres gets it here.
//
// Two databases exist: the real one (DATABASE_URL) and a throwaway one for tests
// (DATABASE_URL_TEST). A test that accidentally ran against the real database would be the
// most expensive mistake this repo can make, so the guard is structural: NETZSPEC_DB=test
// selects the test URL AND that URL's database name must end in `_test`, or the pool refuses
// to open at all.
import pg from "pg";
import { loadEnv } from "../config.js";
import { assertOwnsDatabase, currentBrand } from "../core/brandOwnership.js";

const { Pool, types } = pg;

// numeric / bigint come back as strings by default. Specs are numbers; counts are numbers.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));   // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));     // int8

let pool: pg.Pool | null = null;

export function databaseName(url: string): string {
  const m = url.match(/\/([^/?]+)(\?|$)/);
  return m ? m[1] : "";
}

export function isTestMode(): boolean {
  return process.env.NETZSPEC_DB === "test";
}

/** The URL the pool will use. Throws rather than returning the wrong database. */
export function resolveDatabaseUrl(): string {
  const env = loadEnv();
  if (isTestMode()) {
    const url = env.DATABASE_URL_TEST;
    if (!url) throw new Error("NETZSPEC_DB=test but DATABASE_URL_TEST is not set");
    // netzspec_test, netzspec_test2 … one throwaway database per concurrent suite; anything else is refused
    if (!/_test\d*$/.test(databaseName(url))) throw new Error(`refusing to run tests against database "${databaseName(url)}" (name must end in _test or _test<N>)`);
    // ...and the name pattern is not enough. It accepts _test2, _test3, _test4 and _test5 equally
    // for every brand, so it protected nothing while three sessions ran concurrently: the 17 suites
    // under tests/db/ that issue TRUNCATE are TypeScript, and the ownership guard was Python only.
    // A brand that declares itself (NETZSPEC_BRAND, set in every worktree's .env) is now refused
    // another brand's database BY NAME, before a single row is touched.
    assertOwnsDatabase(env.NETZSPEC_BRAND ?? currentBrand(), url);
    return url;
  }
  return env.DATABASE_URL;
}

/**
 * What this process calls itself in `pg_stat_activity`.
 *
 * AN UNNAMED SESSION IS AN UNATTRIBUTABLE OUTAGE. On 6 Sep 2026 HPE's applies died on
 * `statement timeout` against an anonymous `idle in transaction` session running a long
 * `SELECT ... FROM parts`; they could not tell whose it was and rightly would not kill it. It
 * turned out to be the monitoring session's own audit query, ordering by a correlated subquery over
 * 87,083 parts and 134,599 facts. Naming it turns that from an outage nobody can attribute into one
 * query.
 *
 * It is also the missing half of serialising the writers of `source_docs` — the 120 s timeouts are
 * lock contention between `reclassify-docs` and `apply-acquired` (`while updating tuple ... in
 * relation "source_docs"` is Postgres saying BLOCKED, not slow), and **you cannot serialise writers
 * you cannot name.** `NETZSPEC_APP_NAME` overrides it for a one-off script.
 *
 * Postgres truncates `application_name` at 63 bytes.
 */
function appName(): string {
  // The override comes from the process environment rather than `.env`: it exists for a one-off
  // script that wants to name itself, and such a script sets it on the command line.
  const explicit = process.env.NETZSPEC_APP_NAME;
  if (explicit) return explicit.slice(0, 60);
  const file = (process.argv[1] ?? "").split(/[\\/]/).pop()?.replace(/\.[mc]?[tj]s$/, "") || "node";
  // THE SUBCOMMAND, not just the file. Every pipeline command runs through `cli.ts`, so a name
  // built from argv[1] alone would call BOTH contending writers `netzspec/cli/cisco` and leave them
  // indistinguishable — and telling `apply-acquired` from `reclassify-docs` is the entire reason
  // this exists. They are the two writers of `source_docs` whose lock contention produced the 120 s
  // timeouts. A name that cannot separate them names nothing that matters.
  const sub = (process.argv[2] ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  const cmd = file === "cli" && sub ? sub : file;
  const brand = loadEnv().NETZSPEC_BRAND ?? currentBrand() ?? "";
  return `netzspec/${cmd}${brand ? "/" + brand : ""}`.slice(0, 60);
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveDatabaseUrl(), max: 8, idleTimeoutMillis: 30_000,
      statement_timeout: 120_000, application_name: appName(),
    });
    pool.on("error", (e) => { console.error("pg pool error:", e.message); });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Run `fn` inside one transaction; rolls back on any throw. */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) { const p = pool; pool = null; await p.end(); }
}
