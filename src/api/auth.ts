// src/api/auth.ts — Bearer key → sha256 → api_keys row. Nothing else is ever an identity.
//
// The token itself is never stored (docs/API.md): the table holds sha256(token), so a copy of
// the database is not a copy of anyone's access. A revoked key is a row with revoked_at set,
// not a deleted row, so "who used this and when" survives revocation.
//
// last_used_at is bookkeeping, not audit: it is written at most once per minute per key, from
// memory, so a consumer syncing at 600 req/min does not turn every read into a write.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "../store/db.js";
import { unauthorized } from "./errors.js";

export type ApiKey = { id: number; name: string; scopes: string[] };

declare module "fastify" {
  interface FastifyRequest {
    /** null until the /v1 onRequest hook has authenticated the request */
    apiKey: ApiKey | null;
  }
}

export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

type KeyRow = { id: number; name: string; scopes: string[] };

/** Per-process memory of the last time each key's last_used_at was written. */
const lastWritten = new Map<number, number>();

async function touchLastUsed(key: ApiKey, now: number, log: FastifyRequest["log"]): Promise<void> {
  const prev = lastWritten.get(key.id) ?? 0;
  if (now - prev < LAST_USED_WRITE_INTERVAL_MS) return;
  lastWritten.set(key.id, now);
  try {
    await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [key.id]);
  } catch (e) {
    // A failed bookkeeping write must not fail the read it was bookkeeping for.
    log.warn({ err: e, key: key.id }, "could not update api_keys.last_used_at");
  }
}

/** Exposed for tests: forget the once-a-minute memory so a fresh app writes again. */
export function resetLastUsedMemory(): void {
  lastWritten.clear();
}

export async function authenticate(req: FastifyRequest): Promise<ApiKey> {
  const token = bearerToken(req);
  if (!token) throw unauthorized("missing bearer token");
  const { rows } = await query<KeyRow>(
    "SELECT id, name, scopes FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashToken(token)],
  );
  if (rows.length === 0) throw unauthorized("invalid or revoked api key");
  const key: ApiKey = { id: rows[0].id, name: rows[0].name, scopes: rows[0].scopes };
  await touchLastUsed(key, Date.now(), req.log);
  return key;
}

/** Register on the encapsulated /v1 plugin: every route below it requires a valid key. */
export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    req.apiKey = await authenticate(req);
  });
}
