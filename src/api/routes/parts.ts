// src/api/routes/parts.ts — GET /v1/parts: the filtered, paged catalogue.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listParts } from "../queries/parts.js";
import { ERROR_RESPONSES, ListOf, ListQuery, PartSummary } from "../schemas.js";

const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  family: Type.Optional(Type.String()),
  class: Type.Optional(Type.String({ description: "product_class: hardware | license | service | software | accessory | bundle | unknown" })),
  q: Type.Optional(Type.String({ description: "substring / trigram match on sku and name" })),
  has: Type.Optional(Type.String({ description: "comma list of facts, lifecycle, images" })),
  updated_since: Type.Optional(Type.String({ description: "ISO-8601 timestamp" })),
  filter: Type.Optional(Type.String({ description: "comma list of `key op value` over verified/corroborated facts; ops = != >= <= > < ~" })),
  ...ListQuery,
});

export async function partsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/parts", {
    schema: {
      tags: ["parts"], summary: "List parts (summaries), filtered and keyset-paged by SKU.",
      querystring: Query,
      response: { 200: ListOf(PartSummary), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const q = req.query;
    return listParts({
      vendor: q.vendor, category: q.category, family: q.family, class: q.class, q: q.q, has: q.has,
      updated_since: q.updated_since, filter: q.filter, limit: q.limit ?? 50, cursor: q.cursor,
    });
  });
}
