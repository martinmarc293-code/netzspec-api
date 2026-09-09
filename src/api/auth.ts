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
    /** which form the key arrived in; set by authenticate(), used by the access log */
    apiKeyForm?: CredentialForm;
  }
}

export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The shape of a token this API issues: `nz_` + 43 base64url chars. */
export const TOKEN_RE = /^nz_[A-Za-z0-9_-]{30,}$/;

/**
 * Internal header carrying a key lifted out of the PATH by `rewriteUrl` in app.ts.
 *
 * It cannot be spoofed from outside: rewriteUrl runs on every request before routing and DELETES
 * any inbound copy before deciding whether to set its own. A client sending this header directly
 * is therefore ignored, which matters because the header is trusted like a path segment.
 */
export const PATH_KEY_HEADER = "x-netzspec-path-key";

export type CredentialForm = "header" | "x-api-key" | "query" | "path";

/**
 * Every credential on the request, with the form each arrived in.
 *
 * WHY ALL OF THEM AND NOT THE FIRST. Returning the first match makes two DIFFERENT keys look like
 * one — a stale key in a bookmarked URL silently overridden by a fresh header, or the reverse —
 * and the caller is never told which one authorised the read. Collecting them lets the caller
 * refuse a request that carries two different keys, which is the only honest answer: we cannot
 * know which one the sender meant.
 */
export function credentials(req: FastifyRequest): { token: string; form: CredentialForm }[] {
  const out: { token: string; form: CredentialForm }[] = [];
  const h = req.headers.authorization;
  if (typeof h === "string") {
    const m = h.match(/^Bearer\s+(\S+)\s*$/i);
    if (m) out.push({ token: m[1], form: "header" });
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) out.push({ token: x.trim(), form: "x-api-key" });
  const q = (req.query as Record<string, unknown> | undefined)?.api_key;
  if (typeof q === "string" && q.trim()) out.push({ token: q.trim(), form: "query" });
  const p = req.headers[PATH_KEY_HEADER];
  if (typeof p === "string" && p.trim()) out.push({ token: p.trim(), form: "path" });
  return out;
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h === "string") {
    const m = h.match(/^Bearer\s+(\S+)\s*$/i);
    if (m) return m[1];
  }
  // The same key may travel as a header a tool sets, or as ?api_key= for a browser address bar.
  // A key in a URL can end up in logs; the docs say so and recommend the header for programs.
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  const q = (req.query as Record<string, unknown> | undefined)?.api_key;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
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
  const found = credentials(req);
  if (found.length === 0) throw unauthorized("missing bearer token");
  // TWO DIFFERENT KEYS IS AN ERROR, NOT A PREFERENCE. Same key twice is fine — a client that
  // sends the header and keeps the key in the URL is doing nothing wrong. Two DIFFERENT keys
  // means we cannot know which the sender meant, and silently picking one would authorise a read
  // under a key the caller may have believed was revoked.
  const distinct = new Set(found.map((f) => f.token));
  if (distinct.size > 1) {
    throw unauthorized(
      `ambiguous_credentials: ${found.length} credentials in ${found.map((f) => f.form).join(", ")} ` +
      "carry different keys; send exactly one");
  }
  const { token, form } = found[0];
  const { rows } = await query<KeyRow>(
    "SELECT id, name, scopes FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashToken(token)],
  );
  // The message never echoes the token: a 401 body is the one place a bad key is most likely to
  // be copied into a bug report.
  if (rows.length === 0) throw unauthorized("invalid or revoked api key");
  const key: ApiKey = { id: rows[0].id, name: rows[0].name, scopes: rows[0].scopes };
  // Which FORM authorised this read, so a leak through one channel can be reasoned about — a key
  // seen only as `path` has been in URLs, and URLs go to places headers do not.
  req.apiKeyForm = form;
  await touchLastUsed(key, Date.now(), req.log);
  return key;
}

/** Register on the encapsulated /v1 plugin: every route below it requires a valid key. */
export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    // NO SHARED CACHE MAY STORE A /v1 RESPONSE. Set before authenticate() so a 401 carries it too:
    // once a key can travel in a URL, a cache keyed on that URL is a copy of the data AND of the
    // credential that opened it. Belt and braces with the Cloudflare rule — this one travels with
    // the response and is true even if someone puts a new proxy in front tomorrow.
    reply.header("Cache-Control", "private, no-store");
    req.apiKey = await authenticate(req);
  });
}
