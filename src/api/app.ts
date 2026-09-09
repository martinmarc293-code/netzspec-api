// src/api/app.ts — buildApp(): the whole HTTP surface, assembled but not listening.
//
// Tests drive the returned instance with app.inject(); server.ts is the only caller that
// listens. Registration order is the contract: error handlers first (so every later failure
// is enveloped), swagger before routes (it collects them through onRoute), the keyless root
// routes, then the /v1 plugin that carries auth and the rate limit for everything beneath it.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadEnv, type Config } from "../config.js";
import { closePool } from "../store/db.js";
import { registerErrorHandling } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { PATH_KEY_HEADER, TOKEN_RE } from "./auth.js";
import { v1Routes } from "./routes/index.js";

export type AppOptions = {
  config?: Config;
  /** reported by /health as `version`; server.ts passes GIT_SHA or "dev" */
  gitSha?: string;
  logger?: FastifyServerOptions["logger"];
  /** override the 600/min limit; tests use a small number to prove the 429 path */
  rateLimitMax?: number;
};

/** `nz_…` as the first segment after /v1, and everything after it. */
const PATH_KEY_URL = /^\/v1\/(nz_[A-Za-z0-9_-]{30,})(\/[^?]*)?(\?.*)?$/;

/** Replace a key wherever it can appear in a URL, for anything that will be written down. */
export function redactUrl(url: string): string {
  return url
    .replace(/\/v1\/nz_[A-Za-z0-9_-]{30,}/g, "/v1/nz_REDACTED")
    .replace(/([?&](?:api_key|apikey|token)=)[^&#\s]+/gi, "$1nz_REDACTED");
}

/**
 * Lift a key out of the PATH so the routes never see it.
 *
 * `/v1/nz_abc.../parts?vendor=cisco` becomes `/v1/parts?vendor=cisco` with the key moved to an
 * internal header. Every route, every schema and every OpenAPI path stays exactly as it was —
 * the alternative, mounting the whole router a second time under a parameterised prefix, would
 * double every path in the spec and give two routes that must never disagree.
 *
 * `rewriteUrl` is the only hook that runs BEFORE routing; an onRequest hook is too late, because
 * by then Fastify has already failed to match `/v1/nz_…/parts` and answered 404.
 *
 * THE KEY MUST BE SHAPED LIKE A KEY. Anchored on `nz_` plus 30+ base64url characters, so it can
 * never swallow a real path: no resource in this API begins with `nz_`, and `/v1/parts` cannot
 * match. A malformed key falls through to normal routing and 404s as an unknown path rather than
 * being treated as a bad credential — which is the honest answer, since we cannot tell a typo'd
 * key from a typo'd path.
 *
 * An inbound copy of the internal header is DELETED first, so a client cannot forge one.
 */
export function liftPathKey(req: { url?: string; headers: Record<string, unknown> }): string {
  delete req.headers[PATH_KEY_HEADER];
  const url = req.url ?? "/";
  const m = PATH_KEY_URL.exec(url);
  if (!m) return url;
  const [, key, rest, qs] = m;
  if (!TOKEN_RE.test(key)) return url;
  req.headers[PATH_KEY_HEADER] = key;
  return `/v1${rest ?? ""}${qs ?? ""}`;
}

/**
 * Pino redaction for the access log.
 *
 * The rewritten URL reaches the log without the key already (rewriteUrl strips it), but the raw
 * one can still surface through `req.raw.url`, a `Referer`, or an error that quotes the request —
 * and a key in a log file is a key that has to be revoked. Everything that can carry one is
 * redacted by path, and the URL fields go through redactUrl so the rest of the line stays useful.
 */
const REDACT_KEYS: Record<string, unknown> = {
  redact: {
    paths: ["req.headers.authorization", 'req.headers["x-api-key"]',
            `req.headers["${PATH_KEY_HEADER}"]`, "req.headers.referer", "req.headers.cookie"],
    censor: "[redacted]",
  },
  serializers: {
    req(req: { method?: string; url?: string; headers?: Record<string, unknown> }) {
      return { method: req.method, url: redactUrl(req.url ?? ""), host: (req.headers ?? {}).host };
    },
  },
};

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadEnv();
  const app = Fastify({
    logger: opts.logger ?? { level: config.LOG_LEVEL, ...REDACT_KEYS },
    trustProxy: true,
    rewriteUrl: liftPathKey,
  });
  app.decorateRequest("apiKey", null);

  registerErrorHandling(app);

  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "OPTIONS"] });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "netzspec-api",
        version: "1",
        description:
          "The network-hardware spec API: every part number, every fact with its source, " +
          "lifecycle with dates and successors. Read-only. See docs/API.md.\n\n" +
          "**Authentication — four forms, any one of them.** Send exactly one key; two DIFFERENT " +
          "keys on one request is a 401 `ambiguous_credentials` rather than a silent preference.\n" +
          "1. `Authorization: Bearer nz_…` — preferred for anything programmatic\n" +
          "2. `X-Api-Key: nz_…`\n" +
          "3. `?api_key=nz_…` on any /v1 route\n" +
          "4. `/v1/nz_…/fields?category=security` — the key as the first path segment, for " +
          "clients that cannot set headers at all\n\n" +
          "Forms 3 and 4 put the key in a URL, where it reaches access logs, browser history and " +
          "referrers. Every /v1 response is `Cache-Control: private, no-store` and the key is " +
          "redacted from this service's logs, but a URL-borne key should be read-only and treated " +
          "as rotatable. The key is ignored entirely on /health, /openapi.json and /docs.",
      },
      servers: [{ url: config.PUBLIC_BASE_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          apiKeyHeader: { type: "apiKey", in: "header", name: "X-Api-Key" },
          apiKeyQuery: { type: "apiKey", in: "query", name: "api_key" },
        },
      },
      // Any ONE of these satisfies a request. The path form cannot be expressed in OpenAPI 3.0
      // without duplicating every path, so it is described in the info block above instead of
      // being modelled — a second copy of 31 paths that must never disagree is worse than prose.
      security: [{ bearerAuth: [] }, { apiKeyHeader: [] }, { apiKeyQuery: [] }],
      tags: [
        { name: "meta", description: "health and coverage" },
        { name: "catalogue", description: "vendors, categories, the field dictionary" },
        { name: "parts", description: "part records, facts, history, conflicts, search" },
        { name: "lifecycle", description: "end-of-sale and end-of-support" },
        { name: "sync", description: "the change feed consumers page from" },
        { name: "provenance", description: "source documents and pipeline runs" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(healthRoutes, { gitSha: opts.gitSha ?? process.env.GIT_SHA ?? "dev" });
  await app.register(v1Routes, { prefix: "/v1", config, rateLimitMax: opts.rateLimitMax });

  app.addHook("onClose", async () => { await closePool(); });
  return app;
}
