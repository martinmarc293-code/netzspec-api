// src/store/db.ts — the one connection pool. Everything that talks to Postgres gets it here.
//
// Two databases exist: the real one (DATABASE_URL) and a throwaway one for tests
// (DATABASE_URL_TEST). A test that accidentally ran against the real database would be the
// most expensive mistake this repo can make, so the guard is structural: NETZSPEC_DB=test
// selects the test URL AND that URL's database name must end in `_test`, or the pool refuses
// to open at all.
import pg from "pg";
import { loadEnv } from "../config.js";

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
    return url;
  }
  return env.DATABASE_URL;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: resolveDatabaseUrl(), max: 8, idleTimeoutMillis: 30_000, statement_timeout: 120_000 });
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
