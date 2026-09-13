// Read-only pg pool for the kind-layer III.0 measurement (agent/kindlayer-A). Never writes.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("D:/Project/netzspec-api-cisco/package.json");
const pg = require("pg");

function databaseUrl(): string {
  const env = fs.readFileSync("D:/Project/netzspec-api-cisco/.env", "utf8").replace(/\r/g, "");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

export const pool = new pg.Pool({
  connectionString: databaseUrl(),
  application_name: "agent/kindlayer-A",
  max: 2,
  statement_timeout: 300_000,
  idle_in_transaction_session_timeout: 60_000,
});
pool.on("connect", (c) => {
  c.query("SET default_transaction_read_only = on").catch(() => undefined);
});

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("SET default_transaction_read_only = on");
    const r = await c.query(sql, params);
    return r.rows as T[];
  } finally {
    c.release();
  }
}
