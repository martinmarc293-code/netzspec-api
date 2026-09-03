// src/api/routes/export.ts — GET /v1/export: full part records, paged by (updated_at, id) with
// the /v1/changes cursor, at most 200 per page.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { EXPORT_DEFAULT_LIMIT, EXPORT_MAX_LIMIT, exportParts } from "../queries/export.js";
import { ERROR_RESPONSES, ListOf, PartRecord } from "../schemas.js";

export type ExportRouteOptions = { publicBaseUrl: string };

const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  since: Type.Optional(Type.String({ description: "ISO-8601 timestamp; parts with updated_at strictly after it (a /v1/changes `now` watermark)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: EXPORT_MAX_LIMIT, default: EXPORT_DEFAULT_LIMIT })),
  cursor: Type.Optional(Type.String({ description: "opaque; the same cursor family as /v1/changes" })),
});

export async function exportRoutes(app: FastifyInstance, opts: ExportRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/export", {
    schema: {
      tags: ["sync"],
      summary: "Full part records in bulk (the /parts/{vendor}/{sku} shape), oldest change first, up to 200 per page, plus `now` for the next watermark.",
      querystring: Query,
      response: { 200: ListOf(PartRecord, { now: Type.String({ format: "date-time" }) }), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const q = req.query;
    return exportParts({ vendor: q.vendor, category: q.category, since: q.since, limit: q.limit ?? EXPORT_DEFAULT_LIMIT, cursor: q.cursor }, opts.publicBaseUrl);
  });
}
