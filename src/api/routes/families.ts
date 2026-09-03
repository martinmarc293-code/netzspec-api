// src/api/routes/families.ts — GET /v1/families and GET /v1/families/{vendor}/{family}: series
// counts, paged members, and the facts the whole family shares (>= 80 % of members with facts).
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getFamily, listFamilies } from "../queries/families.js";
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
const FamilyRecord = Type.Intersect([FamilyCounts, Type.Object({
  shared_facts: Type.Array(SharedFact),
  members: Type.Array(PartSummary),
  next_cursor: Nullable(Type.String()),
})]);

export async function familiesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof ListQ> }>("/families", {
    schema: {
      tags: ["catalogue"], summary: "Product families with live counts, largest first. Keyset-paged.",
      querystring: ListQ,
      response: { 200: ListOf(FamilyCounts), ...ERROR_RESPONSES },
    },
  }, async (req) => listFamilies({ vendor: req.query.vendor, category: req.query.category, limit: req.query.limit ?? 50, cursor: req.query.cursor }));

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
