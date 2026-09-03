// src/api/routes/docs.ts — GET /v1/docs/{doc_id}: one source document and the SKUs it lists.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getDoc } from "../queries/docs.js";
import { ERROR_RESPONSES, Nullable } from "../schemas.js";

const Params = Type.Object({ doc_id: Type.String() });
const DocRecord = Type.Object({
  doc_id: Type.String(), url: Type.String(), doc_type: Type.String(), doc_class: Nullable(Type.String()),
  fetched_at: Nullable(Type.String({ format: "date" })), parts_count: Type.Integer(), parts: Type.Array(Type.String()),
});

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Static<typeof Params> }>("/docs/:doc_id", {
    schema: {
      tags: ["provenance"], summary: "A source document: type, class, fetch date, and the first 100 SKUs it enumerates.",
      params: Params,
      response: { 200: DocRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const doc = await getDoc(req.params.doc_id);
    if (!doc) throw notFound(`document ${req.params.doc_id} not found`);
    return doc;
  });
}
