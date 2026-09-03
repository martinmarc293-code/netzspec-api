// src/api/routes/stats.ts — GET /v1/stats: live coverage, cached 60 s in-process.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { getStats } from "../queries/stats.js";
import { ERROR_RESPONSES } from "../schemas.js";

const group = {
  parts: Type.Integer(), hardware_parts: Type.Integer(), with_facts: Type.Integer(), mean_facts: Type.Number(),
  with_lifecycle: Type.Integer(), with_images: Type.Integer(), open_conflicts: Type.Integer(), gaps_confirmed: Type.Integer(),
};
const Stats = Type.Object({
  generated_at: Type.String({ format: "date-time" }),
  parts: Type.Integer(), hardware_parts: Type.Integer(), open_conflicts: Type.Integer(), gaps_confirmed: Type.Integer(),
  by_vendor: Type.Array(Type.Object({ vendor: Type.String(), ...group })),
  by_category: Type.Array(Type.Object({ category: Type.String(), ...group })),
});

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stats", {
    schema: {
      tags: ["meta"], summary: "Coverage computed from the tables, by vendor and category. Cached 60 seconds.",
      response: { 200: Stats, ...ERROR_RESPONSES },
    },
  }, async () => getStats());
}
