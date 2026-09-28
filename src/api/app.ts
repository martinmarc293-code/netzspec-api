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
import { PartRecord, PartSummary, FactItem, LifecycleRecord, ErrorEnvelope, ConflictItem, RelationItem, LedgerRecord, CompletenessReport } from "./schemas.js";
import { FamilyRecord } from "./routes/families.js";
import { LineRecord } from "./routes/lines.js";
import { ModelRecord } from "./routes/models.js";
import { registerErrorHandling } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { PATH_KEY_HEADER, QUERY_KEY_HEADER, TOKEN_RE } from "./auth.js";
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
  delete req.headers[QUERY_KEY_HEADER];
  let url = req.url ?? "/";

  // THE QUERY KEY COMES OUT TOO, and this is not tidiness. The first version relied on a pino
  // `serializers.req` to redact it, deployed, and the key appeared in the app log anyway —
  // Fastify installs its own req serializer and mine never ran. Verified on the live box: three
  // post-deploy lines carried a working credential, from `?api_key=` and from `/health?api_key=`.
  // Removing it HERE, before routing and before any logger sees the request, does not depend on
  // the logging library's internals at all; the only URL anything downstream can write down is
  // the one this function returns.
  const qi = url.indexOf("?");
  if (qi >= 0) {
    const params = new URLSearchParams(url.slice(qi + 1));
    const qk = params.get("api_key");
    if (qk) {
      params.delete("api_key");
      req.headers[QUERY_KEY_HEADER] = qk;
      const rest = params.toString();
      url = url.slice(0, qi) + (rest ? `?${rest}` : "");
    }
  }

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
        // NAMED SHAPES, so a consumer can know what it will be sent without reading our routes.
        //
        // This repo paid for the distinction on 27 Sep: two new fields were verified by calling the
        // record builder directly, were present, and were absent from EVERY HTTP response, because
        // Fastify strips any key the response schema does not declare. A published schema IS a
        // consumer; "I called the function and saw the field" is a producer-level check.
        //
        // DERIVED FROM THE SAME TypeBox OBJECTS THE ROUTES USE, never re-typed by hand. A second
        // description of one shape is a second thing to drift, and this file already carries the
        // reasoning for refusing exactly that one line below, where the security scheme is described
        // in prose rather than duplicated across 31 paths.
        //
        // SIX MORE REGISTERED 27 Sep 2026, and the comment that used to stand here was right about the
        // hazard and wrong about the remedy. It said these shapes "have no named TypeBox object today;
        // they are built inline in their routes. Declaring them here would mean hand-writing a second
        // description of each, which is the drift this comment refuses." True -- so each shape is now
        // named ONCE in schemas.ts and the route and this document both use that one definition. The
        // inline object was itself the problem: it was the only description of what a client is sent,
        // and nothing outside its own file could see it.
        //
        // `Line` IS DECLARED 28 Sep 2026 BECAUSE THE ROUTE NOW EXISTS. The comment that stood here said
        // `Line` and `Model` were "missing on purpose ... a schema for a route that does not exist is
        // exactly the placeholder that agrees with nothing, so the work is either those two routes (a
        // decision) or striking them from the list with the reason". That was right, and the decision came
        // back as: build them. /v1/lines and /v1/lines/{vendor}/{line} serve layer 2, which had no route at
        // all -- the layers travelled on the part record and nothing could ask what lines exist.
        //
        // `Model` is the level parts.family holds since migration 0013; /v1/models serves it (routes/models.ts),
        // /v1/families is its alias (reviewer ruling 28 Sep 2026).
        //
        // ExportRow IS PartRecord, by the export contract: /v1/export serves whole records and
        // routes/part.ts states the shape equality as a promise the suite tests. One object, two names,
        // and they cannot drift because there is only one of them.
        schemas: {
          Part: PartRecord,
          PartSummary,
          Fact: FactItem,
          Lifecycle: LifecycleRecord,
          Error: ErrorEnvelope,
          Conflict: ConflictItem,
          Relation: RelationItem,
          Family: FamilyRecord,
          Line: LineRecord,
          Model: ModelRecord,
          Ledger: LedgerRecord,
          Completeness: CompletenessReport,
          ExportRow: PartRecord,
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
