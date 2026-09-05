// src/api/routes/docs.ts — the document shelf.
//
//   GET /v1/docs/{doc_id}   one source document, its class, and the SKUs it enumerates
//   GET /v1/docs            the shelf, filterable by vendor and class
//   GET /v1/docs/classes    documents per class, and how many parts each class reaches
//
// `spec_bearing` is on every response. A document's CLASS says what it is; `spec_bearing` says
// whether it is the kind of document that can carry a specification at all — an end-of-life
// notice lists affected part numbers and nothing else. That distinction is the difference between
// "we hold a datasheet for this part and the extractor is failing" and "we have never fetched a
// datasheet for this part", which call for opposite work and were indistinguishable in this API
// until 5 Sep 2026.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { docClassCounts, getDoc, listDocs } from "../queries/docs.js";
import { ERROR_RESPONSES, Nullable } from "../schemas.js";

const Params = Type.Object({ doc_id: Type.String() });

const DocFields = {
  doc_id: Type.String(),
  url: Type.String(),
  doc_type: Type.String({ description: "what the document IS, decided from the document itself" }),
  // `doc_class` IS NOT SERVED, and its absence is deliberate. It is a column from 0001_init.sql
  // belonging to a SUPERSEDED classifier, whose vocabulary is not this one — the migration's own
  // comment gives it as `hardware_datasheet | eol_bulletin | licence | ordering | thin | other`.
  //
  // It has exactly ONE writer left: apply-lifecycle.ts stamps `doc_class: "eol_bulletin"` on the
  // source_doc it creates for a bulletin, and ensureSourceDoc's COALESCE only fills a null. That
  // path has not produced a single populated row in production — 0 of 7,190 on 5 Sep 2026 — so
  // this endpoint declared the field in its response schema and returned `null` for every document
  // ever requested. (Checked rather than assumed: the first version of this comment said nothing
  // writes it, which the apply-lifecycle suite disproves in one assertion.)
  //
  // A field that is always null is worse than a field that is absent: a caller writes code against
  // it, gets null, and cannot tell "not classified yet" from "this API never fills this in". And a
  // field carrying a DIFFERENT taxonomy under a name that looks like this one's is worse again.
  // `doc_type` is the answer — it carries the classifier's verdict for all 7,190 documents. The
  // column stays in the table; retiring it is a migration and a change to apply-lifecycle.
  title: Nullable(Type.String({ description: "the document's own title — the evidence for its class" })),
  spec_bearing: Type.Boolean({ description: "true when this class of document can carry specifications" }),
  fetched_at: Nullable(Type.String({ format: "date" })),
  parts_count: Type.Integer(),
};

const DocRecord = Type.Object({ ...DocFields, parts: Type.Array(Type.String()) });
const DocListItem = Type.Object(DocFields);

const ListQuery = Type.Object({
  vendor: Type.Optional(Type.String()),
  doc_type: Type.Optional(Type.String()),
  spec_bearing: Type.Optional(Type.Boolean({ description: "only documents that can carry specifications" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  cursor: Type.Optional(Type.String()),
});

const ClassesQuery = Type.Object({ vendor: Type.Optional(Type.String()) });

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  // Registered BEFORE /docs/:doc_id so "classes" is not read as a document id — Fastify prefers a
  // static segment over a parameter, but the ordering is written down because a future rename that
  // made this dynamic would turn /docs/classes into a 404 for a document nobody named "classes".
  app.get<{ Querystring: Static<typeof ClassesQuery> }>("/docs/classes", {
    schema: {
      tags: ["provenance"],
      summary: "Documents per class, with how many parts each class reaches.",
      querystring: ClassesQuery,
      response: {
        200: Type.Object({
          classes: Type.Array(Type.Object({
            doc_type: Type.String(), spec_bearing: Type.Boolean(),
            documents: Type.Integer(), parts_linked: Type.Integer(),
          })),
        }),
        ...ERROR_RESPONSES,
      },
    },
  }, async (req) => ({ classes: await docClassCounts(req.query.vendor) }));

  app.get<{ Querystring: Static<typeof ListQuery> }>("/docs", {
    schema: {
      tags: ["provenance"],
      summary: "Source documents, filterable by vendor and class. spec_bearing=true is 'what is there to extract from'.",
      querystring: ListQuery,
      response: {
        200: Type.Object({
          items: Type.Array(DocListItem),
          next_cursor: Nullable(Type.String()),
        }),
        ...ERROR_RESPONSES,
      },
    },
  }, async (req) => listDocs({
    vendor: req.query.vendor,
    doc_type: req.query.doc_type,
    spec_bearing: req.query.spec_bearing,
    limit: req.query.limit ?? 50,
    cursor: req.query.cursor,
  }));

  app.get<{ Params: Static<typeof Params> }>("/docs/:doc_id", {
    schema: {
      tags: ["provenance"],
      summary: "A source document: class, whether it can carry specifications, fetch date, title, and the first 100 SKUs it enumerates.",
      params: Params,
      response: { 200: DocRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const doc = await getDoc(req.params.doc_id);
    if (!doc) throw notFound(`document ${req.params.doc_id} not found`);
    return doc;
  });
}
