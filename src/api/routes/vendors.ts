// src/api/routes/vendors.ts — GET /v1/vendors.
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { listVendors } from "../queries/vendors.js";
import { ERROR_RESPONSES, ListOf } from "../schemas.js";

const VendorItem = Type.Object({
  slug: Type.String(), name: Type.String(), parts: Type.Integer(), hardware_parts: Type.Integer(), parts_with_facts: Type.Integer(),
  documents: Type.Integer({ description: "source documents held for this vendor" }),
  spec_bearing_documents: Type.Integer({ description: "of those, the ones whose CLASS can carry a specification at all - an EoL notice and a reseller page cannot" }),
  unclassified_documents: Type.Integer({ description: "documents whose class nothing established. 0 across the catalogue on 5 Sep 2026; visible so it cannot quietly stop being 0." }),
});

export async function vendorsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/vendors", {
    schema: {
      tags: ["catalogue"], summary: "Every vendor with live part counts.",
      response: { 200: ListOf(VendorItem), ...ERROR_RESPONSES },
    },
  }, async () => ({ items: await listVendors(), next_cursor: null }));
}
