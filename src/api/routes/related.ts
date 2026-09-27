// src/api/routes/related.ts — the three part sub-resources that look OUTWARD from a part:
// /similar (siblings ranked by shared facts), /successors (the replacement chain in both
// directions) and /gaps (what the profile requires, what is missing and who was asked).
//
// None of them sends an ETag: their answer depends on other parts' rows, so a part's own
// updated_at is not a valid validator for them.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { partGaps } from "../queries/gaps.js";
import { resolvePart, type PartIdentity } from "../queries/shared.js";
import { similarParts } from "../queries/similar.js";
import { successorChain } from "../queries/successors.js";
import { AnyJson, ERROR_RESPONSES, FieldHead, Nullable, PartSummary } from "../schemas.js";

const Params = Type.Object({ vendor: Type.String(), sku: Type.String() });
const SimilarQuery = Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10 })) });

const DifferingField = Type.Object({
  ...FieldHead, type: Type.String(), unit: Nullable(Type.String()),
  value: AnyJson, other: AnyJson,
});
const SimilarItem = Type.Intersect([PartSummary, Type.Object({
  shared_facts: Type.Integer({ description: "rendered fact values held in common with the requested part" }),
  differs: Type.Array(DifferingField, { description: "every key rendered on either side whose values are not identical; value = this part, other = the sibling" }),
})]);
const Similar = Type.Object({
  items: Type.Array(SimilarItem),
  basis: Type.Union([Type.Literal("family"), Type.Literal("category")], { description: "the pool the siblings came from" }),
  next_cursor: Nullable(Type.String()),
});

const Hop = Type.Object({
  vendor: Type.String(), sku: Type.String(), in_catalog: Type.Boolean(),
  lifecycle_status: Type.String({ description: "unknown when the target is not in the catalogue or has no lifecycle row" }),
  via: Type.Union([Type.Literal("relation"), Type.Literal("lifecycle")]),
  tier: Nullable(Type.Integer({ description: "the relation's tier; null for a lifecycle edge, which stores none" })),
  source_url: Nullable(Type.String()),
});
const Chain = Type.Object({ successors: Type.Array(Hop), predecessors: Type.Array(Hop) });

const GapField = Type.Object({
  key: Type.String(), label_en: Type.String(),
  state: Type.String({ description: "the current fact state explaining the hole: gap_unattempted | gap_confirmed | conflict | unverified | not_applicable" }),
  sources_checked: Type.Integer(), sources_capable: Type.Integer(),
});
const GapCheck = Type.Object({
  source: Type.String(), outcome: Type.String(), checked_at: Type.String({ format: "date-time" }), facts_found: Type.Integer(),
});
const Gaps = Type.Object({
  no_profile: Type.Boolean({ description: "true for a non-hardware part or a category without a profile: the lists are empty by design" }),
  computed_at: Nullable(Type.String({ format: "date-time", description: "when completeness was last scored; null when never" })),
  required_fields: Type.Array(Type.String()),
  present: Type.Array(Type.String()),
  missing: Type.Array(GapField),
  checks: Type.Array(GapCheck, { description: "every source consultation on record, newest first" }),
  // DECLARED HERE OR NOT SERVED AT ALL. Fastify strips any key this object does not name, so a field
  // added to the query and not to the schema is invisible over HTTP while every producer-level check
  // shows it present -- which is exactly how the layer 2/3 markers were verified and still absent on
  // 27 Sep. Plain strings, never a union of literals: Nullable(Type.Union([...Literal])) serialises to
  // {anyOf, nullable} and the response serialiser refuses it, turning every part GET into a 500.
  no_profile_reason: Nullable(Type.String({
    description: "WHY this part is not scored, when it is not: brand_not_arranged | non_hardware | kind_refused_by_role_table | category_has_no_profile. null means it IS scored.",
  })),
  no_profile_rule: Nullable(Type.String({
    description: "the id of the rule that refused this row, for kind_refused_by_role_table only (e.g. sw.issue.ont), so a refusal can be traced without re-deriving it",
  })),
  pending: Type.Integer({
    description: "cups counted in required_fields that are open because their GATE is unanswered, not because nobody has read a datasheet. Already inside required_fields; this says how many of them are waiting on something else.",
  }),
  pending_gates: Type.Array(Type.Object({ cup: Type.String(), gate: Type.Array(Type.String()) }), {
    description: "which cup waits on which field. Answering the gate is a different job from extracting the value, and this is what says which one is in front of you.",
  }),
});

async function loadPart(params: Static<typeof Params>): Promise<PartIdentity> {
  const part = await resolvePart(params.vendor, params.sku);
  if (!part) throw notFound(`part ${params.vendor}/${params.sku} not found`);
  return part;
}

export async function relatedRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: Static<typeof Params>; Querystring: Static<typeof SimilarQuery> }>("/parts/:vendor/:sku/similar", {
    schema: {
      tags: ["parts"], summary: "Hardware siblings (same family, else same category) ranked by shared rendered facts, each with the fields that differ.",
      params: Params, querystring: SimilarQuery,
      response: { 200: Similar, ...ERROR_RESPONSES },
    },
  }, async (req) => similarParts(await loadPart(req.params), req.query.limit ?? 10));

  app.get<{ Params: Static<typeof Params> }>("/parts/:vendor/:sku/successors", {
    schema: {
      tags: ["lifecycle"], summary: "The successor chain (relations + lifecycle.successor_sku) and its predecessors, up to 6 hops, cycle-safe.",
      params: Params,
      response: { 200: Chain, ...ERROR_RESPONSES },
    },
  }, async (req) => successorChain(await loadPart(req.params)));

  app.get<{ Params: Static<typeof Params> }>("/parts/:vendor/:sku/gaps", {
    schema: {
      tags: ["meta"], summary: "Required fields, what is present, what is missing with its ledger state, and every source consultation.",
      params: Params,
      response: { 200: Gaps, ...ERROR_RESPONSES },
    },
  }, async (req) => partGaps(await loadPart(req.params)));
}
