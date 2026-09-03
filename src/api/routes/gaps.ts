// src/api/routes/gaps.ts — GET /v1/stats/gaps: open gaps aggregated by field and by category,
// cached 60 s per (vendor, category) selection.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { getGapStats } from "../queries/gaps.js";
import { ERROR_RESPONSES, Nullable } from "../schemas.js";

const Query = Type.Object({ vendor: Type.Optional(Type.String()), category: Type.Optional(Type.String()) });

const ByField = Type.Object({
  key: Type.String(), label_en: Type.String(),
  gap_unattempted: Type.Integer(), gap_confirmed: Type.Integer(),
  parts_missing: Type.Integer({ description: "hardware parts whose profile requires the field and that render no value for it, whatever the state" }),
});
const ByCategory = Type.Object({
  category: Type.String(), hardware_parts: Type.Integer(),
  parts_complete: Type.Integer({ description: "scored parts at 100 %" }),
  mean_pct: Nullable(Type.Number({ description: "mean completeness over scored parts; null when none is scored" })),
});
const GapStats = Type.Object({
  generated_at: Type.String({ format: "date-time" }),
  by_field: Type.Array(ByField, { description: "top 100 by parts_missing" }),
  by_category: Type.Array(ByCategory),
});

export async function gapStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/stats/gaps", {
    schema: {
      tags: ["meta"], summary: "Open gaps by field (top 100) and completeness by category. Cached 60 seconds per selection.",
      querystring: Query,
      response: { 200: GapStats, ...ERROR_RESPONSES },
    },
  }, async (req) => getGapStats(req.query.vendor, req.query.category));
}
