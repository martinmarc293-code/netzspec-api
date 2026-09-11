// src/api/routes/linkIndex.ts — GET /v1/index?category=: the link index on a path of its own.
//
// WHY A SECOND PATH FOR A BODY /fields ALREADY CARRIES. A consumer's page fetcher caches by URL
// and collapses query variants onto the cached copy, so a client that fetched /fields before the
// index shipped keeps being served the pre-deploy document — 584 items, no `links` key — and
// there is no query string it can add to escape its own cache. `Cache-Control: private, no-store`
// has been on every /v1 response since 121b7ac and did not help, because the cache in question is
// not an HTTP cache obeying headers; it is a fetch memo keyed on the URL string.
//
// So the fix is a URL that consumer has never fetched. That is all this route is. It is not a
// workaround bolted onto the API's shape either: an index of a category's URLs is a reasonable
// resource in its own right, and serving it standalone means a client wanting the map does not
// have to download 584 dictionary entries to get it.
//
// /fields keeps its `links` block. Two representations of the same thing, from one builder, so
// they cannot drift.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { seriesIndex } from "../queries/seriesIndex.js";
import { buildLinkIndex, linkBase, followable, qs } from "../links.js";
import { ERROR_RESPONSES, Nullable } from "../schemas.js";

const Query = Type.Object({
  category: Type.String({ description: "category slug the index is built for" }),
  vendor: Type.Optional(Type.String({ description: "vendor slug (default cisco)" })),
});

const LinkEntry = Type.Object({
  name: Type.String(),
  url: Type.String(),
  /** Rows the URL returns where that is known without running it. null means NOT COUNTED —
   *  never zero, because a reader must not take "I did not count this" for "this is empty". */
  rows: Nullable(Type.Integer()),
});

const Response = Type.Object({
  links: Type.Object({ self: Type.String(), index: Type.Array(LinkEntry) }),
  category: Type.String(),
  vendor: Type.String(),
  /** How many entries, so a truncated read is visible as one. */
  count: Type.Integer(),
  generated_at: Type.String({ format: "date-time" }),
});

export type LinkIndexRouteOptions = { publicBaseUrl: string };

export async function linkIndexRoutes(app: FastifyInstance, opts: LinkIndexRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/index", {
    schema: {
      tags: ["catalogue"],
      summary: "Every URL an audit of one category needs, fully expanded. The entry point for a "
             + "client that can only fetch URLs it has already seen.",
      querystring: Query,
      response: { 200: Response, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const category = req.query.category;
    const vendor = req.query.vendor ?? "cisco";
    const base = linkBase(req, opts.publicBaseUrl);
    const series = await seriesIndex(vendor, category);
    const index = buildLinkIndex(base, vendor, category, series);
    return {
      links: { self: `${base}/index${qs({ category, vendor: req.query.vendor })}`, index },
      category,
      vendor,
      count: index.length,
      generated_at: new Date().toISOString(),
    };
  });

  // PATH FORM (12 Sep 2026): a URL lifted out of a page loses its query string, so /start links to this
  // shape instead. Same builder, so the two representations cannot drift. The entries INSIDE the index
  // keep their query strings where the resource genuinely needs one (a filter, a SKU prefix) — those are
  // pasteable, not followable, and the ledger and report links on /start are the followable path.
  app.get<{ Params: { vendor: string; category: string } }>("/index/:vendor/:category", {
    schema: {
      tags: ["catalogue"],
      summary: "Every URL an audit of one category needs, with no query string of its own — the followable form of /index.",
      params: Type.Object({ vendor: Type.String(), category: Type.String() }),
      response: { 200: Response, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const { vendor, category } = req.params;
    const base = linkBase(req, opts.publicBaseUrl);
    const series = await seriesIndex(vendor, category);
    const index = buildLinkIndex(base, vendor, category, series);
    return {
      links: { self: followable(req, base, ["index", vendor, category]), index },
      category, vendor, count: index.length, generated_at: new Date().toISOString(),
    };
  });
}
