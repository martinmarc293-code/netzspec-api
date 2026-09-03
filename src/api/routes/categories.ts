// src/api/routes/categories.ts — GET /v1/categories?vendor=.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listCategories } from "../queries/categories.js";
import { ERROR_RESPONSES, ListOf } from "../schemas.js";

const Query = Type.Object({ vendor: Type.Optional(Type.String()) });
const CategoryItem = Type.Object({
  slug: Type.String(), name_en: Type.String(), name_de: Type.String(), is_hardware: Type.Boolean(), parts: Type.Integer(),
});

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/categories", {
    schema: {
      tags: ["catalogue"], summary: "Every category, with part counts (optionally for one vendor).",
      querystring: Query,
      response: { 200: ListOf(CategoryItem), ...ERROR_RESPONSES },
    },
  }, async (req) => ({ items: await listCategories(req.query.vendor), next_cursor: null }));
}
