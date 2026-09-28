// src/api/routes/lines.ts — GET /v1/lines and GET /v1/lines/{vendor}/{line}: the product-line layer.
//
// Layer 2 of the layer model had no route at all: the layers travelled on the part record and nothing could
// ask "what lines are there" or "what is in Catalyst". `openapi_schemas` wanted a `Line` schema and app.ts
// correctly refused to declare one for a route that did not exist; this is the route.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getLine, listLines } from "../queries/lines.js";
import { encodeSegment, linkBase, pagedUrl } from "../links.js";
import { ERROR_RESPONSES, LineCounts, ListOf, ListQuery, Nullable, PartSummary } from "../schemas.js";

const ListQ = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String({ description: "keep lines whose dominant category is this slug" })),
  ...ListQuery,
});
const Params = Type.Object({ vendor: Type.String(), line: Type.String({ description: "exactly as /v1/lines spells it" }) });
const MembersQ = Type.Object({ ...ListQuery });

const SeriesCount = Type.Object({
  series: Type.String({ description: "the series name, or '(no series)' for the parts this line has not placed" }),
  parts: Type.Integer(),
  hardware_parts: Type.Integer(),
});

/**
 * Published as `Line` in /openapi.json: ONE definition, used by the route and declared in the document.
 *
 * The detail carries a SERIES BREAKDOWN where /v1/families carries shared facts, and that is deliberate — a
 * line holds up to 3,231 parts across dozens of series, so "what do they all agree on" is either empty or
 * trivial. The layer below is what a line is bought through.
 */
export const LineRecord = Type.Intersect([LineCounts, Type.Object({
  series_breakdown: Type.Array(SeriesCount),
  members: Type.Array(PartSummary),
  next_cursor: Nullable(Type.String()),
})]);

export type LinesRouteOptions = { publicBaseUrl: string };

export async function linesRoutes(app: FastifyInstance, opts: LinesRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof ListQ> }>("/lines", {
    schema: {
      tags: ["catalogue"], summary: "Product lines (layer 2) with live counts and how many series each holds, largest first. Keyset-paged.",
      querystring: ListQ,
      response: { 200: ListOf(LineCounts), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const p = await listLines({ vendor: req.query.vendor, category: req.query.category, limit: req.query.limit ?? 50, cursor: req.query.cursor });
    const base = linkBase(req, opts.publicBaseUrl);
    return {
      items: p.items.map((l) => ({ ...l, url: `${base}/lines/${encodeSegment(l.vendor)}/${encodeSegment(l.line)}` })),
      next_cursor: p.next_cursor,
      next_url: pagedUrl(req, base, "/lines", p.next_cursor),
    };
  });

  app.get<{ Params: Static<typeof Params>; Querystring: Static<typeof MembersQ> }>("/lines/:vendor/:line", {
    schema: {
      tags: ["catalogue"],
      summary: "One product line: counts, the series it holds (including the parts it has NOT placed), and its members (paged).",
      params: Params, querystring: MembersQ,
      response: { 200: LineRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const line = await getLine(req.params.vendor, req.params.line, { limit: req.query.limit ?? 50, cursor: req.query.cursor });
    if (!line) throw notFound(`line ${req.params.vendor}/${req.params.line} not found`);
    return line;
  });
}
