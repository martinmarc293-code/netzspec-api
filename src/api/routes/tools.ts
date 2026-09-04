// src/api/routes/tools.ts — the finder layer: /v1/tools, /v1/tools/{id}, /v1/tools/{id}/run.
//
// A hundred finders, three endpoints. The definitions live in data/schema/tools.json and are
// validated by src/api/tools.ts when this plugin is registered — a bad definition fails
// buildApp(), so the process never serves a control the data cannot answer.
//
// The run endpoint's query string is deliberately open (`additionalProperties: true`): the
// legal parameter names come from the tool, not from a static schema, and an unknown one must
// produce a 400 that NAMES it rather than being silently dropped by the validator. That is the
// same rule filter.ts applies to an unknown filter key.
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { notFound } from "../errors.js";
import { getToolFacets, runTool } from "../queries/tools.js";
import {
  AnyJson, ERROR_RESPONSES, LifecycleRecord, ListOf, ListQuery, Nullable, PartSummary,
  ToolColumnCell, ToolDefinition, ToolExampleSpec,
} from "../schemas.js";
import { getTool, loadTools, runParamsOf, type Tool } from "../tools.js";

const ListToolsQuery = Type.Object({
  category: Type.Optional(Type.String()),
  vendor: Type.Optional(Type.String({ description: "matches tools pinned to this vendor and tools that accept any" })),
  kind: Type.Optional(Type.String({ description: "facets | lifecycle | relations" })),
});

const ToolListItem = Type.Object({
  id: Type.String(), kind: Type.String(),
  name_en: Type.String(), name_de: Type.String(), description_en: Type.String(),
  category: Type.String(), vendor: Nullable(Type.String()),
  facet_count: Type.Integer(),
  columns: Type.Array(Type.String()),
  examples: Type.Array(ToolExampleSpec),
});

const ToolFacetLive = Type.Object({
  key: Type.String(), label_en: Type.String(), label_de: Type.String(), type: Type.String(), unit: Nullable(Type.String()),
  ui: Type.String(),
  parts: Type.Integer({ description: "parts in the tool's selection with a rendered fact for this key; 0 is a data gap, not a hidden filter" }),
  filterable: Type.Boolean(),
  values: Nullable(Type.Array(Type.Object({ value: AnyJson, count: Type.Integer() }))),
  distinct: Nullable(Type.Integer()),
  range: Nullable(Type.Object({ min: Type.Number(), max: Type.Number(), count: Type.Integer() })),
});

const ToolDetail = Type.Object({
  tool: ToolDefinition,
  generated_at: Type.String({ format: "date-time" }),
  parts_in_selection: Type.Integer({ description: "parts matching category + vendor + fixed_filter" }),
  facets: Type.Array(ToolFacetLive),
  run_parameters: Type.Array(Type.String({ description: "every query parameter /run accepts" })),
});

const RunItem = Type.Intersect([PartSummary, Type.Object({
  columns: Type.Array(ToolColumnCell),
  /** the lifecycle record; null unless the tool is lifecycle-shaped */
  lifecycle: Nullable(LifecycleRecord),
})]);

const RunResult = Type.Object({
  items: Type.Array(RunItem),
  next_cursor: Nullable(Type.String()),
  filter: Type.String({ description: "the filter= string actually applied (fixed_filter AND the caller's facets)" }),
  unresolved: Nullable(Type.Array(Type.String(), { description: "relation targets the catalogue does not hold; null for other kinds" })),
});

function definition(t: Tool) {
  return {
    id: t.id, kind: t.kind, name_en: t.name_en, name_de: t.name_de, description_en: t.description_en,
    vendor: t.vendor, category: t.category,
    facets: t.facets.map((f) => ({ key: f.key, ui: f.ui, label_en: f.label_en, unit: f.unit })),
    fixed_filter: t.fixed_filter, sort: t.sort, columns: t.columns, examples: t.examples, relation: t.relation,
  };
}

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  // Registration-time load: a definition naming a key its category profile does not carry
  // must stop the server, not surprise the first consumer who opens that finder.
  const tools = loadTools();

  app.get<{ Querystring: Static<typeof ListToolsQuery> }>("/tools", {
    schema: {
      tags: ["catalogue"],
      summary: "The product finders: data-driven definitions over the facet/filter machinery. One definition per buying question.",
      querystring: ListToolsQuery,
      response: { 200: ListOf(ToolListItem, { total: Type.Integer() }), ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const q = req.query;
    const items = tools
      .filter((t) => (q.category === undefined || q.category === "" || t.category === q.category))
      .filter((t) => (q.kind === undefined || q.kind === "" || t.kind === q.kind))
      .filter((t) => (q.vendor === undefined || q.vendor === "" || t.vendor === null || t.vendor === q.vendor))
      .map((t) => ({
        id: t.id, kind: t.kind, name_en: t.name_en, name_de: t.name_de, description_en: t.description_en,
        category: t.category, vendor: t.vendor, facet_count: t.facets.length, columns: t.columns, examples: t.examples,
      }));
    return { items, next_cursor: null, total: tools.length };
  });

  app.get<{ Params: { id: string } }>("/tools/:id", {
    schema: {
      tags: ["catalogue"],
      summary: "One tool: its definition plus the live value distributions and ranges inside its own selection (category + vendor + fixed_filter). Cached 60 seconds.",
      params: Type.Object({ id: Type.String() }),
      response: { 200: ToolDetail, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const tool = getTool(req.params.id);
    if (!tool) throw notFound(`unknown tool "${req.params.id}"`);
    const live = await getToolFacets(tool);
    const uiBy = new Map(tool.facets.map((f) => [f.key, f.ui] as const));
    return {
      tool: definition(tool),
      generated_at: live.generated_at,
      parts_in_selection: live.parts_in_selection,
      facets: live.items.map((f) => ({ ...f, ui: uiBy.get(f.key) ?? "select" })),
      // Straight from runParamsOf, so the advertised list and the accepted list cannot drift.
      run_parameters: [...runParamsOf(tool).keys()].filter((n) => n !== "api_key").sort(),
    };
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>("/tools/:id/run", {
    schema: {
      tags: ["catalogue"],
      summary: "Run a tool: its fixed_filter AND the facet values given here, returning part summaries plus the tool's columns.",
      params: Type.Object({ id: Type.String() }),
      // Open on purpose: the legal names come from the definition, and an unknown one is a 400
      // naming it rather than a parameter the validator quietly threw away.
      querystring: Type.Object({ ...ListQuery }, { additionalProperties: true }),
      response: { 200: RunResult, ...ERROR_RESPONSES },
    },
  }, async (req) => {
    const tool = getTool(req.params.id);
    if (!tool) throw notFound(`unknown tool "${req.params.id}"`);
    const q = req.query as Record<string, unknown>;
    const limit = typeof q.limit === "number" ? q.limit : Number(q.limit ?? 50);
    return runTool(tool, { query: q, limit, cursor: typeof q.cursor === "string" ? q.cursor : undefined });
  });
}
