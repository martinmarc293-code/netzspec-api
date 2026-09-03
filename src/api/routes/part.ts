// src/api/routes/part.ts — GET /v1/parts/{vendor}/{sku} and its /facts, /history, /conflicts.
//
// Every part GET sends a weak ETag derived from (sku, updated_at with microseconds) and
// Last-Modified, and answers 304 to a matching If-None-Match. A consumer re-syncing 89k parts
// pays for a lookup, not for a record, when nothing changed. The ETag is weak because two
// representations of the same updated_at (different `states=`) are not byte-identical.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { parseStates, partConflicts, partFacts, partHistory, partRecord } from "../queries/part.js";
import { resolvePart, type PartIdentity } from "../queries/shared.js";
import { AnyJson, ERROR_RESPONSES, LifecycleRecord, Nullable } from "../schemas.js";

export type PartRouteOptions = { publicBaseUrl: string };

const Params = Type.Object({ vendor: Type.String(), sku: Type.String() });
const StatesQuery = Type.Object({ states: Type.Optional(Type.String({ description: "comma list of fact states, or `all`; default verified,corroborated" })) });

const FactSource = Nullable(Type.Object({
  doc_id: Type.String(), url: Nullable(Type.String()), locator: Nullable(Type.String()), extracted_at: Nullable(Type.String({ format: "date" })),
}));
const FactItem = Type.Object({
  key: Type.String(), label_en: Type.String(), label_de: Type.String(), type: Type.String(), value: AnyJson, unit: Nullable(Type.String()),
  raw: Type.String(), state: Type.String(), tier: Type.Integer(), method: Type.String(), inherited: Type.Boolean(),
  inherited_from: Nullable(Type.String()), source: FactSource, evidence_count: Type.Integer(),
});
const Evidence = Type.Object({
  doc_id: Nullable(Type.String()), url: Nullable(Type.String()), locator: Nullable(Type.String()), tier: Type.Integer(),
  method: Type.String(), extracted_at: Nullable(Type.String({ format: "date" })),
});
const ImageVariant = Type.Object({ variant: Type.String(), url: Type.String(), width: Type.Integer(), height: Type.Integer(), bytes: Type.Integer(), format: Type.String() });
const PartRecord = Type.Object({
  vendor: Type.String(), sku: Type.String(), slug: Type.String(),
  category: Type.Object({ slug: Type.String(), name_en: Type.String(), name_de: Type.String() }),
  family: Nullable(Type.String()), product_class: Type.String(), name: Nullable(Type.String()), description: Nullable(Type.String()),
  datasheet_url: Nullable(Type.String()),
  lifecycle: Nullable(LifecycleRecord),
  facts: Type.Array(FactItem),
  relations: Type.Array(Type.Object({
    kind: Type.String(), sku: Type.String(), in_catalog: Type.Boolean(), tier: Type.Integer(), source_url: Nullable(Type.String()), note: Nullable(Type.String()),
  })),
  images: Type.Array(Type.Object({
    role: Type.String(), url: Type.String(), width: Nullable(Type.Integer()), height: Nullable(Type.Integer()),
    alt_en: Nullable(Type.String()), alt_de: Nullable(Type.String()), variants: Type.Array(ImageVariant),
  })),
  completeness: Nullable(Type.Object({
    required_total: Type.Integer(), required_present: Type.Integer(), pct: Type.Number(), missing: Type.Array(Type.String()), no_profile: Type.Boolean(),
  })),
  sources: Type.Array(Type.Object({ doc_id: Type.String(), url: Type.String(), doc_type: Type.String(), fetched_at: Nullable(Type.String({ format: "date" })) })),
  updated_at: Type.String({ format: "date-time" }),
});

export function etagFor(part: PartIdentity): string {
  return `W/"${createHash("sha1").update(`${part.sku}|${part.updated_at_raw}`).digest("hex").slice(0, 32)}"`;
}

function etagValue(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

/** Sets ETag + Last-Modified; returns true when a 304 was sent and the handler must stop. */
function conditional(req: FastifyRequest, reply: FastifyReply, part: PartIdentity): boolean {
  const etag = etagFor(part);
  reply.header("ETag", etag);
  reply.header("Last-Modified", part.updated_at.toUTCString());
  const inm = req.headers["if-none-match"];
  if (typeof inm !== "string" || inm === "") return false;
  const matches = inm.split(",").some((t) => t.trim() === "*" || etagValue(t) === etagValue(etag));
  if (!matches) return false;
  reply.code(304).send();
  return true;
}

async function loadPart(params: Static<typeof Params>): Promise<PartIdentity> {
  const part = await resolvePart(params.vendor, params.sku);
  if (!part) throw notFound(`part ${params.vendor}/${params.sku} not found`);
  return part;
}

type Route = { Params: Static<typeof Params>; Querystring: Static<typeof StatesQuery> };

export async function partRoutes(app: FastifyInstance, opts: PartRouteOptions): Promise<void> {
  app.get<Route>("/parts/:vendor/:sku", {
    schema: {
      tags: ["parts"], summary: "The full part record: facts with provenance, lifecycle, relations, images, completeness, sources.",
      params: Params, querystring: StatesQuery,
      response: { 200: PartRecord, ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const states = parseStates(req.query.states);
    const part = await loadPart(req.params);
    if (conditional(req, reply, part)) return reply;
    return partRecord(part, states, opts.publicBaseUrl);
  });

  app.get<Route>("/parts/:vendor/:sku/facts", {
    schema: {
      tags: ["parts"], summary: "Facts only, each with every supporting evidence row.",
      params: Params, querystring: StatesQuery,
      response: { 200: Type.Object({ items: Type.Array(Type.Intersect([FactItem, Type.Object({ evidence: Type.Array(Evidence) })])) }), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const states = parseStates(req.query.states);
    const part = await loadPart(req.params);
    if (conditional(req, reply, part)) return reply;
    return { items: await partFacts(part, states) };
  });

  app.get<Route>("/parts/:vendor/:sku/history", {
    schema: {
      tags: ["parts"], summary: "Superseded fact rows, newest first.",
      params: Params,
      response: { 200: Type.Object({ items: Type.Array(Type.Object({
        key: Type.String(), value: AnyJson, unit: Nullable(Type.String()), state: Type.String(),
        superseded_at: Nullable(Type.String({ format: "date-time" })), superseded_by_value: AnyJson,
      })) }), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const part = await loadPart(req.params);
    if (conditional(req, reply, part)) return reply;
    return { items: await partHistory(part) };
  });

  app.get<Route>("/parts/:vendor/:sku/conflicts", {
    schema: {
      tags: ["parts"], summary: "Open conflicts: both values, both provenances, the reason the field is held.",
      params: Params,
      response: { 200: Type.Object({ items: Type.Array(Type.Object({
        key: Type.String(), kept: AnyJson, rejected: AnyJson, reason: Type.String(), kept_evidence: AnyJson, rejected_evidence: AnyJson,
        logged_at: Type.String({ format: "date-time" }),
      })) }), ...ERROR_RESPONSES },
    },
  }, async (req, reply) => {
    const part = await loadPart(req.params);
    if (conditional(req, reply, part)) return reply;
    return { items: await partConflicts(part) };
  });
}
