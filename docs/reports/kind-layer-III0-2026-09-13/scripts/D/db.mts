// Read-only DB helper for kindlayer III.0 items 5/6. application_name agent/kindlayer-D,
// default_transaction_read_only = on. Reads DATABASE_URL from the cisco worktree .env by hand.
import { readFileSync } from "node:fs";
import pgmod from "file:///D:/Project/netzspec-api-cisco/node_modules/pg/lib/index.js";

const pg: any = (pgmod as any).default ?? pgmod;

function envUrl(): string {
  const txt = readFileSync("D:/Project/netzspec-api-cisco/.env", "utf8").replace(/\r/g, "");
  for (const line of txt.split("\n")) {
    const m = line.match(/^DATABASE_URL=(.*)$/);
    if (m) return m[1].trim().replace(/^"(.*)"$/, "$1");
  }
  throw new Error("DATABASE_URL not found in cisco .env");
}

export async function connect(): Promise<any> {
  const client = new pg.Client({ connectionString: envUrl(), application_name: "agent/kindlayer-D", statement_timeout: 120000 });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const ro = await client.query("SHOW default_transaction_read_only");
  if (ro.rows[0].default_transaction_read_only !== "on") throw new Error("read-only not set");
  return client;
}
