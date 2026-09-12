// src/api/routes/parts.ts — GET /v1/parts: the filtered, paged catalogue.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listParts } from "../queries/parts.js";
import { linkBase, pagedUrl, partUrl } from "../links.js";
import { ERROR_RESPONSES, ListOf, ListQuery, PartSummary } from "../schemas.js";

const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  series: Type.Optional(Type.String()),
  family: Type.Optional(Type.String()),
  class: Type.Optional(Type.String({ description: "product_class: hardware | license | service | software | accessory | bundle | unknown" })),
  kind: Type.Optional(Type.String({ description: "the DERIVED cup set inside the category (switch, server, bundle, accessory, unknown, '(none)' ...). Requires category; the ledger at /v1/ledger/<vendor>/<category> lists a category's kinds." })),
  sku: Type.Optional(Type.String({ description: "exact SKU, case-insensitive (sku_norm); returns 0 or 1 part per vendor" })),
  sku_prefix: Type.Optional(Type.String({ description: "SKU prefix, case-insensitive; % and _ are literal" })),
  q: Type.Optional(Type.String({ description: "substring / trigram match on sku and name" })),
  has: Type.Optional(Type.String({ description: "comma list of facts, lifecycle, images" })),
  updated_since: Type.Optional(Type.String({ description: "ISO-8601 timestamp" })),
  filter: Type.Optional(Type.String({ description: "comma list of `key op value` over verified/corroborated facts; ops = != >= <= > < ~" })),
  ...ListQuery,
});

export type PartsRouteOptions = { publicBaseUrl: string };

export async function partsRoutes(app: FastifyInstance, opts: PartsRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/parts", {
    schema: {
      tags: ["parts"], summary: "List parts (summaries), filtered and keyset-paged by SKU.",
      querystring: Query,
      response: { 200: ListOf(PartSummary), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const q = req.query;
    const page = await listParts({
      vendor: q.vendor, category: q.category, series: q.series, family: q.family, class: q.class, kind: q.kind,
      sku: q.sku, sku_prefix: q.sku_prefix, q: q.q, has: q.has,
      updated_since: q.updated_since, filter: q.filter, limit: q.limit ?? 50, cursor: q.cursor,
    });
    // Decorated HERE and not in the query layer: the URLs depend on how THIS request
    // authenticated, which the query layer neither knows nor should.
    const base = linkBase(req, opts.publicBaseUrl);
    return {
      items: page.items.map((p) => {
        const u = partUrl(base, p.vendor, p.sku);
        return { ...p, url: u, facts_url: `${u}/facts`, gaps_url: `${u}/gaps` };
      }),
      next_cursor: page.next_cursor,
      next_url: pagedUrl(req, base, "/parts", page.next_cursor),
    };
  });
}
