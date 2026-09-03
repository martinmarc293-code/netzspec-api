// src/api/routes/runs.ts — GET /v1/runs and /v1/runs/{id}: the write history of the store.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getRun, listRuns } from "../queries/runs.js";
import { AnyJson, ERROR_RESPONSES, ListOf, ListQuery, Nullable } from "../schemas.js";

const Query = Type.Object({ kind: Type.Optional(Type.String()), ...ListQuery });
const Params = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const RunRecord = Type.Object({
  id: Type.Integer(), kind: Type.String(), status: Type.String(), started_at: Type.String({ format: "date-time" }),
  finished_at: Nullable(Type.String({ format: "date-time" })), git_sha: Nullable(Type.String()),
  inputs: AnyJson, gate: AnyJson, stats: AnyJson, notes: Nullable(Type.String()),
});

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Static<typeof Query> }>("/runs", {
    schema: {
      tags: ["provenance"], summary: "Run manifests, newest first.",
      querystring: Query,
      response: { 200: ListOf(RunRecord), ...ERROR_RESPONSES },
    },
  }, async (req) => listRuns(req.query.kind, req.query.limit ?? 50, req.query.cursor));

  app.get<{ Params: Static<typeof Params> }>("/runs/:id", {
    schema: {
      tags: ["provenance"], summary: "One run manifest: inputs with hashes, gate result, stats.",
      params: Params,
      response: { 200: RunRecord, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const run = await getRun(req.params.id);
    if (!run) throw notFound(`run ${req.params.id} not found`);
    return run;
  });
}
