// src/api/routes/search.ts — GET /v1/search?q=: trigram search over SKU and name.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { searchParts } from "../queries/search.js";
import { ERROR_RESPONSES, ListOf, PartSummary } from "../schemas.js";

const Query = Type.Object({
  q: Type.String({ minLength: 1 }),
  vendor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/search", {
    schema: {
      tags: ["parts"], summary: "Search SKU and name; part summaries with a score. Top-N, no cursor.",
      querystring: Query,
      response: { 200: ListOf(Type.Intersect([PartSummary, Type.Object({ score: Type.Number() })])), ...ERROR_RESPONSES },
    },
  }, async (req) => ({ items: await searchParts(req.query.q, req.query.limit ?? 50, req.query.vendor), next_cursor: null }));
}
