// src/api/routes/sources.ts — GET /v1/sources: the source registry with live coverage.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { listSources } from "../queries/sources.js";
import { ERROR_RESPONSES, ListOf, Nullable } from "../schemas.js";

const SourceItem = Type.Object({
  slug: Type.String(), name: Type.String(),
  kind: Type.String({ description: "vendor | aggregator | distributor | operator | standards" }),
  tier: Type.Integer(), enabled: Type.Boolean(),
  parts_checked: Type.Integer({ description: "distinct parts with a consultation on record" }),
  parts_with_facts: Type.Integer({ description: "distinct parts whose consultation found facts" }),
  facts_current: Type.Integer({ description: "current facts (any state, with a value) whose method names the source or whose document, or an evidence row's, came from it" }),
  last_checked_at: Nullable(Type.String({ format: "date-time" })),
});

export async function sourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sources", {
    schema: {
      tags: ["provenance"], summary: "Every registered source with tier, enabled flag and what it has delivered.",
      response: { 200: ListOf(SourceItem), ...ERROR_RESPONSES },
    },
  }, async () => ({ items: await listSources(), next_cursor: null }));
}
