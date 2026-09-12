// src/api/routes/fields.ts — GET /v1/fields?category=: the dictionary, with the category's
// requirement per key when a category is named, and a link index when a category is named.
//
// THE LINK INDEX IS THE ENTRY POINT. A client whose fetcher only opens URLs it has already seen
// can reach exactly one URL of this API to begin with. Returning the whole audit surface as
// fully-expanded URLs from that one response makes everything else reachable in one hop, and the
// item-level `url` fields on /parts carry it the rest of the way. See src/api/links.ts for why a
// key appears in those URLs only when the caller already put it in one.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { listFields } from "../queries/fields.js";
import { seriesIndex } from "../queries/seriesIndex.js";
import { buildLinkIndex, linkBase, followable, qs } from "../links.js";
import { AnyJson, ERROR_RESPONSES, ListOf, Nullable } from "../schemas.js";

const Query = Type.Object({
  category: Type.Optional(Type.String()),
  /** Which vendor the link index is built for; the dictionary itself is vendor-neutral. */
  vendor: Type.Optional(Type.String({ description: "vendor slug for the `links` index (default cisco)" })),
});
const FieldItem = Type.Object({
  key: Type.String(), type: Type.String(), unit: Nullable(Type.String()), label_en: Type.String(), label_de: Type.String(),
  domain: AnyJson, band: AnyJson, shape: Nullable(Type.String()),
  /** a retired key names the key that holds its quantity now; null = not retired (migration 0015) */
  superseded_by: Nullable(Type.String()),
  requirement: Type.Optional(Type.Object({ kind: Type.String(), when: Type.Optional(AnyJson) })),
  /** round-7 ask F: current facts under this key per vendor slug, live parts only. {} = none anywhere. A dictionary
   *  change (a supersession, a retype, a closed domain) is measured across ALL vendors before it is made. */
  facts_current_by_vendor: Type.Record(Type.String(), Type.Integer()),
});

const LinkEntry = Type.Object({
  name: Type.String(),
  url: Type.String(),
  /** Rows the URL returns where that is known without running it — the hardware count for a
   *  series. null means NOT COUNTED, never zero: a reader must not read an uncounted link as an
   *  empty one, which is the same distinction `unreadable` keeps separate from `checked`. */
  rows: Nullable(Type.Integer()),
});
const Links = Type.Object({
  self: Type.String(),
  index: Type.Array(LinkEntry),
});

export type FieldsRouteOptions = { publicBaseUrl: string };

export async function fieldsRoutes(app: FastifyInstance, opts: FieldsRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/fields", {
    schema: {
      tags: ["catalogue"],
      summary: "The field dictionary; `requirement` per key when `category` is given, plus a "
             + "`links` index of every URL an audit of that category needs.",
      querystring: Query,
      response: { 200: ListOf(FieldItem, { links: Type.Optional(Links) }), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const items = await listFields(req.query.category);
    const category = req.query.category;
    // No category, no index: the index is a tour of ONE category, and building it for the whole
    // dictionary would mean a series query per category on a request that asked for none.
    if (!category) return { items, next_cursor: null };

    const vendor = req.query.vendor ?? "cisco";
    const base = linkBase(req, opts.publicBaseUrl);
    const series = await seriesIndex(vendor, category);
    return {
      items,
      next_cursor: null,
      links: {
        self: `${base}/fields${qs({ category, vendor: req.query.vendor })}`,
        index: buildLinkIndex(base, vendor, category, series),
      },
    };
  });

  // PATH FORM (12 Sep 2026): /start links here, because a URL taken out of a page loses its query string
  // (links.ts followable()). Same query and same builder as /fields?category=, one source of truth.
  app.get<{ Params: { category: string } }>("/fields/:category", {
    schema: {
      tags: ["catalogue"],
      summary: "The field dictionary with this category's requirement per key, with no query string — the followable form of /fields?category=.",
      params: Type.Object({ category: Type.String() }),
      response: { 200: ListOf(FieldItem, { links: Type.Optional(Links) }), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const category = req.params.category;
    const items = await listFields(category);
    const base = linkBase(req, opts.publicBaseUrl);
    const series = await seriesIndex("cisco", category);
    return {
      items, next_cursor: null,
      links: { self: followable(req, base, ["fields", category]), index: buildLinkIndex(base, "cisco", category, series) },
    };
  });
}
