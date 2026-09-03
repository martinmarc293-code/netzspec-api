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
import { AnyJson, ERROR_RESPONSES, FactItem, Nullable, PartRecord } from "../schemas.js";

export type PartRouteOptions = { publicBaseUrl: string };

const Params = Type.Object({ vendor: Type.String(), sku: Type.String() });
const StatesQuery = Type.Object({ states: Type.Optional(Type.String({ description: "comma list of fact states, or `all`; default verified,corroborated" })) });

const Evidence = Type.Object({
  doc_id: Nullable(Type.String()), url: Nullable(Type.String()), locator: Nullable(Type.String()), tier: Type.Integer(),
  method: Type.String(), extracted_at: Nullable(Type.String({ format: "date" })),
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
