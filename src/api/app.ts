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
import { v1Routes } from "./routes/index.js";

export type AppOptions = {
  config?: Config;
  /** reported by /health as `version`; server.ts passes GIT_SHA or "dev" */
  gitSha?: string;
  logger?: FastifyServerOptions["logger"];
  /** override the 600/min limit; tests use a small number to prove the 429 path */
  rateLimitMax?: number;
};

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadEnv();
  const app = Fastify({
    logger: opts.logger ?? { level: config.LOG_LEVEL },
    trustProxy: true,
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
        description: "The network-hardware spec API: every part number, every fact with its source, lifecycle with dates and successors. Read-only. See docs/API.md.",
      },
      servers: [{ url: config.PUBLIC_BASE_URL }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
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
