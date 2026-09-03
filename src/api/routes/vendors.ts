// src/api/routes/vendors.ts — GET /v1/vendors.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { listVendors } from "../queries/vendors.js";
import { ERROR_RESPONSES, ListOf } from "../schemas.js";

const VendorItem = Type.Object({
  slug: Type.String(), name: Type.String(), parts: Type.Integer(), hardware_parts: Type.Integer(), parts_with_facts: Type.Integer(),
});

export async function vendorsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/vendors", {
    schema: {
      tags: ["catalogue"], summary: "Every vendor with live part counts.",
      response: { 200: ListOf(VendorItem), ...ERROR_RESPONSES },
    },
  }, async () => ({ items: await listVendors(), next_cursor: null }));
}
