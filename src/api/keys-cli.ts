// src/api/keys-cli.ts — create, list and revoke API keys.
//
//   npx tsx src/api/keys-cli.ts create --name netzspec [--scopes read] [--holder "who"] [--channel "how it is used"]
//   npx tsx src/api/keys-cli.ts list
//   npx tsx src/api/keys-cli.ts revoke --id 3
//
// The token is printed ONCE, at creation, and only its sha256 is stored: a copy of the
// database is not a copy of anyone's access, and there is no "show me the key again". Revoking
// sets revoked_at rather than deleting the row, so last_used_at survives as a record.
// Runs against DATABASE_URL, or DATABASE_URL_TEST when NETZSPEC_DB=test (src/store/db.ts).
import { randomBytes } from "node:crypto";
import { closePool, query } from "../store/db.js";
import { hashToken } from "./auth.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
  return v;
}

export function newToken(): string {
  // 32 random bytes, base64url: 43 characters, prefixed so a leaked token is recognisable in logs.
  return "nz_" + randomBytes(32).toString("base64url");
}

async function create(args: string[]): Promise<void> {
  const name = flag(args, "name");
  if (!name) throw new Error("create needs --name");
  const scopes = (flag(args, "scopes") ?? "read").split(",").map((s) => s.trim()).filter(Boolean);
  // HOLDER AND CHANNEL AT BIRTH (29 Sep 2026): keys_hygiene reports an active key with no recorded holder, and until now a
  // new key was born unattributable and needed a later run to name who held it. Optional, so an old invocation still works.
  const holder = flag(args, "holder") ?? null, channel = flag(args, "channel") ?? null;
  const token = newToken();
  const { rows } = await query<{ id: number }>(
    "INSERT INTO api_keys (name, key_hash, scopes, holder, channel) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [name, hashToken(token), scopes, holder, channel],
  );
  console.log(`created api key id=${rows[0].id} name=${name} scopes=${scopes.join(",")} holder=${holder ?? "(none)"} channel=${channel ?? "(none)"}`);
  console.log("token (shown once, never stored):");
  console.log(token);
}

async function list(): Promise<void> {
  const { rows } = await query<{ id: number; name: string; scopes: string[]; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
    "SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY id");
  if (rows.length === 0) { console.log("no api keys"); return; }
  for (const r of rows) {
    const state = r.revoked_at ? `REVOKED ${r.revoked_at.toISOString()}` : "active";
    console.log(`${String(r.id).padStart(4)}  ${r.name.padEnd(24)} ${r.scopes.join(",").padEnd(12)} created ${r.created_at.toISOString()}  last used ${r.last_used_at ? r.last_used_at.toISOString() : "never"}  ${state}`);
  }
}

async function revoke(args: string[]): Promise<void> {
  const idRaw = flag(args, "id");
  const id = Number(idRaw);
  if (!idRaw || !Number.isInteger(id) || id < 1) throw new Error("revoke needs --id <positive integer>");
  const { rowCount } = await query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  if (!rowCount) throw new Error(`api key ${id} does not exist or is already revoked`);
  console.log(`revoked api key id=${id}`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "create": await create(args); break;
    case "list": await list(); break;
    case "revoke": await revoke(args); break;
    default:
      throw new Error("usage: keys-cli.ts create --name <name> [--scopes read] | list | revoke --id <id>");
  }
}

main()
  .then(() => closePool())
  .catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    await closePool();
    process.exit(1);
  });
