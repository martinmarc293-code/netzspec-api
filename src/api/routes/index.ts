// src/api/routes/index.ts — the /v1 plugin: authentication, the strict query-parameter check,
// the per-key rate limit, and every versioned route, in one encapsulated scope.
//
// The cross-cutting concerns are registered HERE rather than on the root instance so that
// /health, /docs and /openapi.json stay keyless and unlimited, and so that no /v1 route can
// be added without inheriting both. The limiter runs at preHandler — after the onRequest
// auth hook — so its key is the api_keys id: 600/min is per key, and an unauthenticated
// request is rejected before it can consume anyone's budget.
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "../../config.js";
import { registerAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { registerStrictQuery } from "../strictQuery.js";
import { categoriesRoutes } from "./categories.js";
import { changesRoutes } from "./changes.js";
import { compareRoutes } from "./compare.js";
import { docsRoutes } from "./docs.js";
import { exportRoutes } from "./export.js";
import { facetsRoutes } from "./facets.js";
import { familiesRoutes } from "./families.js";
import { fieldsRoutes } from "./fields.js";
import { gapStatsRoutes } from "./gaps.js";
import { lifecycleRoutes } from "./lifecycle.js";
import { partRoutes } from "./part.js";
import { partsRoutes } from "./parts.js";
import { relatedRoutes } from "./related.js";
import { runsRoutes } from "./runs.js";
import { searchRoutes } from "./search.js";
import { sourcesRoutes } from "./sources.js";
import { statsRoutes } from "./stats.js";
import { toolsRoutes } from "./tools.js";
import { vendorsRoutes } from "./vendors.js";

export const RATE_LIMIT_PER_MINUTE = 600;

export type V1Options = { config: Config; rateLimitMax?: number };

export async function v1Routes(app: FastifyInstance, opts: V1Options): Promise<void> {
  registerAuth(app);
  // BEFORE every route below: an onRoute hook, so a route added later cannot be written without
  // the check. An undeclared query parameter is a 400 naming it, never a full, wrong result set.
  registerStrictQuery(app);
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitMax ?? RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : `ip:${req.ip}`),
    // The plugin THROWS whatever this returns (index.js: `throw params.errorResponseBuilder(...)`),
    // so it must be an error the handler in errors.ts recognises; a bare object became a 500.
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(429, "rate_limited", `rate limit of ${ctx.max} requests per minute exceeded; retry after ${ctx.after}`),
  });

  await app.register(vendorsRoutes);
  await app.register(categoriesRoutes);
  await app.register(fieldsRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(facetsRoutes);
  await app.register(partsRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(partRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(lifecycleRoutes);
  await app.register(changesRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(exportRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(searchRoutes);
  await app.register(docsRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(runsRoutes);
  await app.register(statsRoutes);
  // API-3: families, compare, the outward-looking part sub-resources, the source registry, gap stats.
  await app.register(familiesRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(compareRoutes);
  await app.register(relatedRoutes);
  await app.register(sourcesRoutes);
  await app.register(gapStatsRoutes);
  // API-4: the data-driven product finders. loadTools() runs here, so a definition that names
  // a key its category profile does not carry fails buildApp() rather than a consumer's request.
  await app.register(toolsRoutes);
}
