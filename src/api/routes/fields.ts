// src/api/routes/fields.ts — GET /v1/fields?category=: the dictionary, with the category's
// requirement per key when a category is named.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listFields } from "../queries/fields.js";
import { AnyJson, ERROR_RESPONSES, ListOf, Nullable } from "../schemas.js";

const Query = Type.Object({ category: Type.Optional(Type.String()) });
const FieldItem = Type.Object({
  key: Type.String(), type: Type.String(), unit: Nullable(Type.String()), label_en: Type.String(), label_de: Type.String(),
  domain: AnyJson, band: AnyJson, shape: Nullable(Type.String()),
  requirement: Type.Optional(Type.Object({ kind: Type.String(), when: Type.Optional(AnyJson) })),
});

export async function fieldsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/fields", {
    schema: {
      tags: ["catalogue"], summary: "The field dictionary; `requirement` per key when `category` is given.",
      querystring: Query,
      response: { 200: ListOf(FieldItem), ...ERROR_RESPONSES },
    },
  }, async (req) => ({ items: await listFields(req.query.category), next_cursor: null }));
}
