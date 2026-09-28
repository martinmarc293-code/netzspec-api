// src/api/routes/families.ts — GET /v1/families and GET /v1/families/{vendor}/{family}: series
// counts, paged members, and the facts the whole family shares (>= 80 % of members with facts).
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getFamily, listFamilies } from "../queries/families.js";
import { encodeSegment, linkBase, pagedUrl } from "../links.js";
import { AnyJson, ERROR_RESPONSES, FamilyCounts, FieldHead, ListOf, ListQuery, Nullable, PartSummary } from "../schemas.js";

const ListQ = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String({ description: "keep families whose dominant category is this slug" })),
  ...ListQuery,
});
const Params = Type.Object({ vendor: Type.String(), family: Type.String({ description: "exactly as /v1/families spells it" }) });
const MembersQ = Type.Object({ ...ListQuery });

const SharedFact = Type.Object({
  ...FieldHead,
  value: AnyJson,
  unit: Nullable(Type.String()),
  members: Type.Integer({ description: "members carrying exactly this value" }),
  of: Type.Integer({ description: "members with at least one rendered fact (the denominator)" }),
});
/** Exported 27 Sep 2026 so /openapi.json can publish it as `Family`: one definition, used by the route and
 *  declared in the document, rather than a client having no description of what it is sent. */
/** The detail half, shared with /v1/models (routes/models.ts), which serves the same rows under the level's name. */
export const FamilyDetail = Type.Object({
  shared_facts: Type.Array(SharedFact),
  members: Type.Array(PartSummary),
  next_cursor: Nullable(Type.String()),
});
export const FamilyRecord = Type.Intersect([FamilyCounts, FamilyDetail]);

export type FamiliesRouteOptions = { publicBaseUrl: string };

export async function familiesRoutes(app: FastifyInstance, opts: FamiliesRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof ListQ> }>("/families", {
    schema: {
      tags: ["catalogue"], summary: "Product families with live counts, largest first. Keyset-paged.",
      querystring: ListQ,
      response: { 200: ListOf(FamilyCounts), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const page = await listFamilies({ vendor: req.query.vendor, category: req.query.category, limit: req.query.limit ?? 50, cursor: req.query.cursor });
    const base = linkBase(req, opts.publicBaseUrl);
    return {
      items: page.items.map((f) => ({
        ...f,
        url: `${base}/families/${encodeSegment(f.vendor)}/${encodeSegment(f.family)}`,
      })),
      next_cursor: page.next_cursor,
      next_url: pagedUrl(req, base, "/families", page.next_cursor),
    };
  });

  app.get<{ Params: Static<typeof Params>; Querystring: Static<typeof MembersQ> }>("/families/:vendor/:family", {
    schema: {
      tags: ["catalogue"], summary: "One family: counts, its members (paged), and the facts shared by at least 80 % of members with facts.",
      params: Params, querystring: MembersQ,
      response: { 200: FamilyRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const fam = await getFamily(req.params.vendor, req.params.family, { limit: req.query.limit ?? 50, cursor: req.query.cursor });
    if (!fam) throw notFound(`family ${req.params.vendor}/${req.params.family} not found`);
    return fam;
  });
}
