// src/api/routes/health.ts — GET /health, the only data route outside /v1 and the only one
// without a key: a load balancer or uptime probe holds no credentials. Answers 503 when the
// database cannot be reached, so the probe sees the failure rather than a cheerful 200.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { health } from "../queries/health.js";
import { Nullable } from "../schemas.js";

export type HealthOptions = { gitSha: string };

export async function healthRoutes(app: FastifyInstance, opts: HealthOptions): Promise<void> {
  app.get("/health", {
    schema: {
      tags: ["meta"],
      summary: "Liveness: database reachable, parts count, build sha. No key required.",
      security: [],
      response: {
        200: Type.Object({ ok: Type.Boolean(), db: Type.Boolean(), version: Type.String(), parts: Nullable(Type.Integer()) }),
        503: Type.Object({ ok: Type.Boolean(), db: Type.Boolean(), version: Type.String(), parts: Nullable(Type.Integer()) }),
      },
    },
  }, async (_req, reply) => {
    const h = await health(opts.gitSha);
    reply.code(h.ok ? 200 : 503);
    return h;
  });
}
