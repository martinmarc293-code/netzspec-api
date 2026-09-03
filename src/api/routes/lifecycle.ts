// src/api/routes/lifecycle.ts — GET /v1/lifecycle: parts with a lifecycle row, filtered by
// status and by end-of-sale / last-day-of-support windows.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listLifecycle } from "../queries/lifecycle.js";
import { ERROR_RESPONSES, LifecycleRecord, ListOf, ListQuery, PartSummary } from "../schemas.js";

const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "active | eol_announced | end_of_sale | end_of_support | unknown" })),
  eos_after: Type.Optional(Type.String({ description: "YYYY-MM-DD, inclusive" })),
  eos_before: Type.Optional(Type.String({ description: "YYYY-MM-DD, inclusive" })),
  ldos_after: Type.Optional(Type.String({ description: "YYYY-MM-DD, inclusive" })),
  ldos_before: Type.Optional(Type.String({ description: "YYYY-MM-DD, inclusive" })),
  family: Type.Optional(Type.String()),
  ...ListQuery,
});

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/lifecycle", {
    schema: {
      tags: ["lifecycle"], summary: "Parts with lifecycle data, soonest end-of-sale first. The 'what dies in the next 12 months' query.",
      querystring: Query,
      response: { 200: ListOf(Type.Intersect([PartSummary, Type.Object({ lifecycle: LifecycleRecord })])), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const q = req.query;
    return listLifecycle({
      vendor: q.vendor, status: q.status, eos_after: q.eos_after, eos_before: q.eos_before, ldos_after: q.ldos_after,
      ldos_before: q.ldos_before, family: q.family, limit: q.limit ?? 50, cursor: q.cursor,
    });
  });
}
