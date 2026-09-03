// src/api/routes/changes.ts — GET /v1/changes?since=: the sync feed, with `now` as the
// watermark the consumer stores.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listChanges } from "../queries/changes.js";
import { ERROR_RESPONSES, ListOf, ListQuery } from "../schemas.js";

const Query = Type.Object({
  since: Type.String({ description: "ISO-8601 timestamp; parts with updated_at strictly after it" }),
  ...ListQuery,
});
const ChangeItem = Type.Object({ vendor: Type.String(), sku: Type.String(), updated_at: Type.String({ format: "date-time" }) });

export async function changesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/changes", {
    schema: {
      tags: ["sync"], summary: "Parts changed since a timestamp, oldest first, plus `now` for the next watermark.",
      querystring: Query,
      response: { 200: ListOf(ChangeItem, { now: Type.String({ format: "date-time" }) }), ...ERROR_RESPONSES },
    },
  }, async (req) => listChanges(req.query.since, req.query.limit ?? 50, req.query.cursor));
}
