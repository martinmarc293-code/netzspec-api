// src/api/routes/facets.ts — GET /v1/facets?vendor=&category=: the fields that have rendered
// facts inside a selection, with their value distributions or numeric ranges. Cached 60 s.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { getFacets } from "../queries/facets.js";
import { AnyJson, ERROR_RESPONSES, ListOf, Nullable } from "../schemas.js";

const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
});

const FacetItem = Type.Object({
  key: Type.String(), label_en: Type.String(), label_de: Type.String(), type: Type.String(), unit: Nullable(Type.String()),
  parts: Type.Integer({ description: "parts in the selection with a current verified/corroborated fact for this key" }),
  filterable: Type.Boolean({ description: "false for struct fields, which `filter=` refuses" }),
  values: Nullable(Type.Array(Type.Object({ value: AnyJson, count: Type.Integer() }), { description: "e/b/s/ls only: top 50 by count" })),
  distinct: Nullable(Type.Integer({ description: "e/b/s/ls only: number of distinct values, so a cut list is recognisable" })),
  range: Nullable(Type.Object({ min: Type.Number(), max: Type.Number(), count: Type.Integer() }, { description: "n/nr only" })),
});

export async function facetsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/facets", {
    schema: {
      tags: ["catalogue"],
      summary: "Fields with rendered facts inside a vendor/category selection, with value distributions or numeric ranges. Cached 60 seconds.",
      querystring: Query,
      response: { 200: ListOf(FacetItem, { generated_at: Type.String({ format: "date-time" }) }), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const facets = await getFacets(req.query.vendor, req.query.category);
    return { items: facets.items, next_cursor: null, generated_at: facets.generated_at };
  });
}
