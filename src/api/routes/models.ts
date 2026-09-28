// src/api/routes/models.ts — GET /v1/models and GET /v1/models/{vendor}/{model}: the MODEL level, the SKU minus its
// orderable suffix. parts.family has held it since migration 0013, so this serves /v1/families' rows under the level's
// own name, with `model` in place of `family`; /v1/families stays as the alias (reviewer ruling, 28 Sep 2026).
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getFamily, listFamilies } from "../queries/families.js";
import { encodeSegment, linkBase, pagedUrl } from "../links.js";
import { ERROR_RESPONSES, FamilyCounts, ListOf, ListQuery } from "../schemas.js";
import { FamilyDetail } from "./families.js";

const ListQ = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String({ description: "keep models whose dominant category is this slug" })),
  ...ListQuery,
});
const Params = Type.Object({ vendor: Type.String(), model: Type.String({ description: "exactly as /v1/models spells it" }) });
const MembersQ = Type.Object({ ...ListQuery });

export const ModelCounts = Type.Composite([
  Type.Omit(FamilyCounts, ["family"]),
  Type.Object({ model: Type.String({ description: "the SKU minus its orderable suffix (parts.family)" }) }),
]);
/** Published in /openapi.json as `Model`. */
export const ModelRecord = Type.Intersect([ModelCounts, FamilyDetail]);

const asModel = <T extends { family: string }>({ family, ...rest }: T) => ({ ...rest, model: family });

export type ModelsRouteOptions = { publicBaseUrl: string };

export async function modelsRoutes(app: FastifyInstance, opts: ModelsRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof ListQ> }>("/models", {
    schema: {
      tags: ["catalogue"], summary: "Models (the SKU minus its orderable suffix) with live counts, largest first. Keyset-paged.",
      querystring: ListQ,
      response: { 200: ListOf(ModelCounts), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const page = await listFamilies({ vendor: req.query.vendor, category: req.query.category, limit: req.query.limit ?? 50, cursor: req.query.cursor });
    const base = linkBase(req, opts.publicBaseUrl);
    return {
      items: page.items.map((f) => ({ ...asModel(f), url: `${base}/models/${encodeSegment(f.vendor)}/${encodeSegment(f.family)}` })),
      next_cursor: page.next_cursor,
      next_url: pagedUrl(req, base, "/models", page.next_cursor),
    };
  });

  app.get<{ Params: Static<typeof Params>; Querystring: Static<typeof MembersQ> }>("/models/:vendor/:model", {
    schema: {
      tags: ["catalogue"], summary: "One model: counts, its members (paged), and the facts shared by at least 80 % of members with facts.",
      params: Params, querystring: MembersQ,
      response: { 200: ModelRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const fam = await getFamily(req.params.vendor, req.params.model, { limit: req.query.limit ?? 50, cursor: req.query.cursor });
    if (!fam) throw notFound(`model ${req.params.vendor}/${req.params.model} not found`);
    return asModel(fam);
  });
}
