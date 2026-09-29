// src/api/routes/export.ts — GET /v1/export: full part records, paged by (updated_at, id) with
// the /v1/changes cursor, at most 200 per page. With `profile=jtl-main|jtl-attributes|jtl-condition|jtl-faq` it is the
// JTL shop's surface instead (rulings Q12 + Q18, 29 Sep 2026): the shop_ready hardware of one vendor as the recorded
// Wawi import file -- UTF-8 with BOM, CRLF, Main `;` and the long files `,` -- paged by SKU with the cursor in
// `X-Next-Cursor`. `profile=jtl-readiness` returns the shop_ready counts per category (JSON), every reason counted.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { EXPORT_DEFAULT_LIMIT, EXPORT_MAX_LIMIT, exportParts } from "../queries/export.js";
import { JTL_DEFAULT_LIMIT, JTL_MAX_LIMIT, jtlProfilePage, jtlReadiness } from "../queries/jtlExport.js";
import { JTL_PROFILES, type JtlProfile } from "../../core/jtlExport.js";
import { badRequest } from "../errors.js";
import { ERROR_RESPONSES, ListOf, PartRecord } from "../schemas.js";

export type ExportRouteOptions = { publicBaseUrl: string };

const PROFILE_VALUES = [...JTL_PROFILES, "jtl-readiness"] as const;
const Query = Type.Object({
  vendor: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  since: Type.Optional(Type.String({ description: "ISO-8601 timestamp; parts with updated_at strictly after it (a /v1/changes `now` watermark)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: JTL_MAX_LIMIT, description: `records per page: at most ${EXPORT_MAX_LIMIT} full records, or ${JTL_MAX_LIMIT} parts scanned per JTL page` })),
  cursor: Type.Optional(Type.String({ description: "opaque; the same cursor family as /v1/changes (a JTL page: the last SKU, as X-Next-Cursor returned it)" })),
  profile: Type.Optional(Type.Union(PROFILE_VALUES.map((p) => Type.Literal(p)), {
    description: "a JTL import file instead of JSON records: jtl-main (18 columns, ';'), jtl-attributes (Artikelnummer, Attributgruppe, " +
      "Attributname, Attributwert), jtl-condition, jtl-faq -- shop_ready hardware only; or jtl-readiness (JSON counts per category)" })),
  skus: Type.Optional(Type.String({ description: "JTL profiles only: a comma-separated SKU list to restrict the scope to" })),
});

const Readiness = Type.Object({
  vendor: Type.String(), category: Type.Union([Type.String(), Type.Null()]), scanned: Type.Integer(), ready: Type.Integer(),
  by_category: Type.Record(Type.String(), Type.Object({ parts: Type.Integer(), ready: Type.Integer(), reasons: Type.Record(Type.String(), Type.Integer()) })),
  skus: Type.Optional(Type.Array(Type.Object({ sku: Type.String(), ready: Type.Boolean(), reasons: Type.Array(Type.String()) }))),
}, { $id: "JtlReadiness" });

export async function exportRoutes(app: FastifyInstance, opts: ExportRouteOptions): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/export", {
    schema: {
      tags: ["sync"],
      summary: "Full part records in bulk (the /parts/{vendor}/{sku} shape), oldest change first, up to 200 per page, plus `now` for the next watermark. "
        + "With profile=jtl-*: the JTL shop import files (text/csv), or profile=jtl-readiness: shop_ready counts per category.",
      querystring: Query,
      // a JTL page is text/csv, which the JSON serializer never sees; the two JSON shapes are declared
      response: { 200: Type.Union([ListOf(PartRecord, { now: Type.String({ format: "date-time" }) }), Readiness, Type.String()]), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const q = req.query;
    if (q.profile) {
      if (!q.vendor) throw badRequest("a JTL profile needs vendor=");
      if (q.since) throw badRequest("since= is the JSON feed's watermark; a JTL page is a full scope, paged by cursor=");
      const skus = q.skus ? q.skus.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      if (q.profile === "jtl-readiness") return jtlReadiness({ vendor: q.vendor, category: q.category, skus });
      const page = await jtlProfilePage(q.profile as JtlProfile, { vendor: q.vendor, category: q.category, skus,
        limit: q.limit ?? JTL_DEFAULT_LIMIT, cursor: q.cursor });
      reply.header("X-Parts-Scanned", String(page.scanned));
      reply.header("X-Parts-Ready", String(page.ready));
      if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor);
      reply.header("Content-Disposition", `attachment; filename="${q.vendor}-${q.profile}.csv"`);
      reply.type("text/csv; charset=utf-8");
      return reply.send(page.csv);
    }
    if (q.skus) throw badRequest("skus= is a JTL-profile filter; the JSON feed pages the whole catalogue");
    const limit = q.limit ?? EXPORT_DEFAULT_LIMIT;
    if (limit > EXPORT_MAX_LIMIT) throw badRequest(`limit must be between 1 and ${EXPORT_MAX_LIMIT}`);
    return exportParts({ vendor: q.vendor, category: q.category, since: q.since, limit, cursor: q.cursor }, opts.publicBaseUrl);
  });
}
