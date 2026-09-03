// src/api/routes/compare.ts — GET /v1/compare?skus=vendor:sku,vendor:sku[,…]: 2..8 parts side by
// side over rendered facts, one row per field.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { compareParts, parseRefs } from "../queries/compare.js";
import { AnyJson, ERROR_RESPONSES, FieldHead, Nullable, PartSummary } from "../schemas.js";

const Query = Type.Object({
  skus: Type.String({ description: "comma list of 2..8 refs, each vendor:sku (SKU case-insensitive)" }),
});
const Cell = Type.Object({
  ref: Type.String(),
  value: AnyJson,
  raw: Nullable(Type.String()),
  state: Nullable(Type.String({ description: "verified | corroborated for a rendered value; another state with value null when the field is held or a gap; null when the part has no row" })),
});
const Row = Type.Object({
  ...FieldHead,
  type: Type.String(), unit: Nullable(Type.String()),
  values: Type.Array(Cell, { description: "one cell per ref, in the order given" }),
  differs: Type.Boolean({ description: "false only when every part renders the same value" }),
});
const Comparison = Type.Object({ parts: Type.Array(PartSummary), rows: Type.Array(Row) });

export async function compareRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/compare", {
    schema: {
      tags: ["parts"], summary: "Compare 2..8 parts field by field over their rendered facts.",
      querystring: Query,
      response: { 200: Comparison, ...ERROR_RESPONSES },
    },
  }, async (req) => compareParts(parseRefs(req.query.skus)));
}
