// src/api/routes/index.ts — the /v1 plugin: authentication, the per-key rate limit, and every
// versioned route, in one encapsulated scope.
//
// Both cross-cutting concerns are registered HERE rather than on the root instance so that
// /health, /docs and /openapi.json stay keyless and unlimited, and so that no /v1 route can
// be added without inheriting both. The limiter runs at preHandler — after the onRequest
// auth hook — so its key is the api_keys id: 600/min is per key, and an unauthenticated
// request is rejected before it can consume anyone's budget.
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "../../config.js";
import { registerAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { categoriesRoutes } from "./categories.js";
import { changesRoutes } from "./changes.js";
import { docsRoutes } from "./docs.js";
import { fieldsRoutes } from "./fields.js";
import { lifecycleRoutes } from "./lifecycle.js";
import { partRoutes } from "./part.js";
import { partsRoutes } from "./parts.js";
import { runsRoutes } from "./runs.js";
import { searchRoutes } from "./search.js";
import { statsRoutes } from "./stats.js";
import { vendorsRoutes } from "./vendors.js";

export const RATE_LIMIT_PER_MINUTE = 600;

export type V1Options = { config: Config; rateLimitMax?: number };

export async function v1Routes(app: FastifyInstance, opts: V1Options): Promise<void> {
  registerAuth(app);
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
  await app.register(fieldsRoutes);
  await app.register(partsRoutes);
  await app.register(partRoutes, { publicBaseUrl: opts.config.PUBLIC_BASE_URL });
  await app.register(lifecycleRoutes);
  await app.register(changesRoutes);
  await app.register(searchRoutes);
  await app.register(docsRoutes);
  await app.register(runsRoutes);
  await app.register(statsRoutes);
}
