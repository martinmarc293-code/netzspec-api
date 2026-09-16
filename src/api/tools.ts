// src/api/tools.ts — the finder "tools" layer: definitions as DATA, validated at startup.
//
// netzspec.com used to hand-build a product finder per buying question (PoE switch finder,
// transceiver by form factor, firewall by throughput …). Each one was a page, a query and a
// list of fields, and the three drifted: a finder offered `reach` for a category whose
// profile never carried it, so the control existed and the answer was always empty. A finder
// that filters on a field the data cannot supply is the read-side version of the pipeline's
// silent `continue` — it looks like "no products match" and it is really "nobody ever stored
// this".
//
// So a tool is a DEFINITION in data/schema/tools.json, and this module refuses to let the
// process start if any definition could lie:
//
//   * an unknown field key                       → the dictionary is the only vocabulary;
//   * a key the CATEGORY PROFILE does not carry  → the honesty rule: a tool may only expose
//                                                  keys its category is expected to have, so an
//                                                  empty result is a data gap, never a hidden
//                                                  filter;
//   * a facet `ui` the field's type cannot serve → a "range" slider over an enum would send
//                                                  `poe_standard>=x`, which filter.ts rejects
//                                                  at request time — one 400 per user instead
//                                                  of one refusal at boot;
//   * a struct field as a facet                  → filter.ts refuses struct keys (a struct may
//                                                  still be a COLUMN: showing it is fine,
//                                                  filtering on it is not);
//   * a duplicate id, a malformed fixed_filter, a sort key that is not numeric, an example
//     whose query string names a parameter the tool does not have.
//
// Every message names the tool, because "invalid tool definition" in a boot log is the same
// as no message at all.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { FIELD_DICTIONARY, PROFILES, unitFor, type FieldType } from "../core/fieldSchema.js";
import { PRODUCT_CLASSES as STORE_PRODUCT_CLASSES } from "../store/parts.js";
import { compileFilter, parseTerm, splitFilterTerms, type FilterDictionary } from "./filter.js";
import { badRequest } from "./errors.js";

export const TOOLS_FILE = path.join(REPO_ROOT, "data", "schema", "tools.json");

export type ToolUi = "range" | "select" | "multi" | "toggle";
export type ToolKind = "facets" | "lifecycle" | "relations";
export type RelationDirection = "from" | "to";

export type ToolFacet = {
  key: string;
  ui: ToolUi;
  /** overrides the dictionary label in a UI; the dictionary label is still returned */
  label_en: string | null;
  /** the canonical unit for the category, resolved from the dictionary when not stated */
  unit: string | null;
};

export type ToolSort = { key: string; dir: "asc" | "desc" };
export type ToolExample = { title: string; filter: string };
export type ToolRelation = { kind: string; direction: RelationDirection };

export type Tool = {
  id: string;
  kind: ToolKind;
  name_en: string;
  name_de: string;
  description_en: string;
  /** null = any vendor */
  vendor: string | null;
  category: string;
  facets: ToolFacet[];
  /** the `filter=` grammar, ANDed with whatever the caller sends; null when the tool adds none */
  fixed_filter: string | null;
  sort: ToolSort | null;
  columns: string[];
  examples: ToolExample[];
  relation: ToolRelation | null;
};

/** Which `ui` each dictionary type may wear. A struct appears nowhere: filter.ts refuses it. */
export const UI_FOR_TYPE: Record<FieldType, ToolUi[]> = {
  n: ["range"],
  nr: ["range"],
  b: ["toggle", "select"],
  e: ["select"],
  s: ["select"],
  ls: ["multi", "select"],
  struct: [],
};

/** The relation kinds `relations` table holds; a tool may not invent one. */
export const RELATION_KINDS = [
  "successor", "predecessor", "compatible", "module_of", "hosts_module",
  "supports_transceiver", "bundle_contains", "license_for", "accessory_for", "equivalent",
] as const;

/** Part-level columns a fixed_filter may name; everything else must be a dictionary key. */
export const PART_LEVEL_FILTER_KEYS = new Set(["product_class"]);
// DERIVED, for the reason in store/parts.ts: this was the SECOND hand-written copy of the same
// seven-element list, and it validates a tool's `fixed_filter`, so a tool scoped to non_product was
// refused at load as naming an unknown class.
const PRODUCT_CLASSES: ReadonlySet<string> = new Set(STORE_PRODUCT_CLASSES);

export const RESERVED_RUN_PARAMS = ["limit", "cursor", "api_key"] as const;
export const LIFECYCLE_RUN_PARAMS = ["status", "eos_after", "eos_before", "ldos_after", "ldos_before"] as const;
export const RELATION_RUN_PARAMS = ["part"] as const;

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export class ToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDefinitionError";
  }
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_COLUMNS = 12;

/** The dictionary filter.ts validates against, built from the CODE dictionary so a definition
 *  can be checked without a database (the pure suite does exactly that). */
export function codeFilterDictionary(): FilterDictionary {
  return new Map(Object.entries(FIELD_DICTIONARY).map(([k, d]) => [k, { type: d.type }] as const));
}

function fail(id: string, message: string): never {
  throw new ToolDefinitionError(`tools.json: tool "${id}" ${message}`);
}

/** A key is usable by a tool only when the dictionary defines it AND the category profile
 *  carries it. Returns the field type. */
function fieldTypeFor(id: string, category: string, key: string, role: string): FieldType {
  const def = FIELD_DICTIONARY[key];
  if (!def) fail(id, `${role} names unknown field key "${key}" (not in the field dictionary)`);
  const requirement = PROFILES[category]?.[key];
  if (!requirement) fail(id, `${role} key "${key}" is not in the "${category}" profile — a tool may only expose keys its category carries`);
  if (requirement.kind === "na") fail(id, `${role} key "${key}" is marked not-applicable in the "${category}" profile`);
  return def.type;
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function validateFixedFilter(id: string, category: string, raw: string): void {
  const dict = codeFilterDictionary();
  for (const rawTerm of splitFilterTerms(raw)) {
    const term = parseTerm(rawTerm);
    if (PART_LEVEL_FILTER_KEYS.has(term.key)) {
      if (term.op !== "=" && term.op !== "!=") fail(id, `fixed_filter term "${rawTerm}" uses operator ${term.op}; part-level key "${term.key}" takes only = and !=`);
      if (term.key === "product_class" && !PRODUCT_CLASSES.has(term.value)) fail(id, `fixed_filter term "${rawTerm}" names unknown product_class "${term.value}"`);
      continue;
    }
    fieldTypeFor(id, category, term.key, `fixed_filter term "${rawTerm}"`);
    // compileFilter enforces the operator/type rules and the enum/boolean/number parse; a
    // definition that would 400 on every request must not reach a consumer.
    try {
      compileFilter(rawTerm, dict, 1);
    } catch (e) {
      fail(id, `fixed_filter term "${rawTerm}" is invalid: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function validate(raw: unknown, seen: Set<string>): Tool {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ToolDefinitionError("tools.json: every entry must be an object");
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  if (!ID_RE.test(id)) throw new ToolDefinitionError(`tools.json: tool id "${String(o.id)}" is not a lowercase kebab-case slug`);
  if (seen.has(id)) throw new ToolDefinitionError(`tools.json: duplicate tool id "${id}"`);
  seen.add(id);

  for (const k of ["name_en", "name_de", "description_en"]) {
    if (!str(o[k])) fail(id, `is missing "${k}"`);
  }
  const kind: ToolKind = o.kind === undefined ? "facets" : (o.kind as ToolKind);
  if (kind !== "facets" && kind !== "lifecycle" && kind !== "relations") fail(id, `has kind "${String(o.kind)}" (expected facets, lifecycle or relations)`);

  const category = o.category;
  if (!str(category)) fail(id, "is missing \"category\"");
  if (!PROFILES[category]) fail(id, `names category "${category}", which has no profile in src/core/fieldSchema.ts`);

  const vendor = o.vendor === undefined || o.vendor === null ? null : o.vendor;
  if (vendor !== null) {
    if (!str(vendor)) fail(id, "has a non-string \"vendor\" (use null for any vendor)");
    const domain = FIELD_DICTIONARY.vendor.domain ?? [];
    if (!domain.includes(vendor)) fail(id, `names unknown vendor "${vendor}"`);
  }

  // ---- facets ----
  const facetsRaw = o.facets;
  if (!Array.isArray(facetsRaw)) fail(id, "is missing \"facets\" (use [] for a tool with no controls)");
  const facets: ToolFacet[] = [];
  const facetKeys = new Set<string>();
  for (const f of facetsRaw as unknown[]) {
    if (!f || typeof f !== "object") fail(id, "has a facet that is not an object");
    const fo = f as Record<string, unknown>;
    if (!str(fo.key)) fail(id, "has a facet with no \"key\"");
    const key = fo.key as string;
    if (facetKeys.has(key)) fail(id, `lists facet "${key}" twice`);
    facetKeys.add(key);
    const type = fieldTypeFor(id, category, key, `facet "${key}"`);
    const ui = fo.ui as ToolUi;
    const allowed = UI_FOR_TYPE[type];
    if (allowed.length === 0) fail(id, `facet "${key}" is a ${type} field, which cannot be a facet at all (filter= refuses struct keys; use it as a column instead)`);
    if (!allowed.includes(ui)) fail(id, `facet "${key}" has ui "${String(fo.ui)}" but is a ${type} field (allowed: ${allowed.join(", ")})`);
    facets.push({
      key, ui,
      label_en: str(fo.label_en) ? (fo.label_en as string) : null,
      unit: str(fo.unit) ? (fo.unit as string) : (unitFor(category, key) ?? null),
    });
  }
  if (kind === "facets" && facets.length === 0) fail(id, "is kind \"facets\" but declares no facets");

  // ---- fixed_filter ----
  let fixedFilter: string | null = null;
  if (o.fixed_filter !== undefined && o.fixed_filter !== null) {
    if (!str(o.fixed_filter)) fail(id, "has a non-string \"fixed_filter\"");
    fixedFilter = (o.fixed_filter as string).trim();
    validateFixedFilter(id, category, fixedFilter);
  }

  // ---- sort ----
  let sort: ToolSort | null = null;
  if (o.sort !== undefined && o.sort !== null) {
    const so = o.sort as Record<string, unknown>;
    if (!str(so.key)) fail(id, "has a \"sort\" with no key");
    const type = fieldTypeFor(id, category, so.key as string, `sort key "${String(so.key)}"`);
    // Ordering is over facts.value_num, so only a plain number can carry it. A range or an
    // enum would need a rule for which end sorts, and a guessed rule is a wrong answer.
    if (type !== "n") fail(id, `sort key "${String(so.key)}" is a ${type} field; only a numeric (n) field can order a result`);
    if (so.dir !== "asc" && so.dir !== "desc") fail(id, `sort dir "${String(so.dir)}" is not asc or desc`);
    sort = { key: so.key as string, dir: so.dir };
  }

  // ---- columns ----
  const colsRaw = o.columns;
  if (!Array.isArray(colsRaw) || colsRaw.length === 0) fail(id, "must list at least one column");
  if (colsRaw.length > MAX_COLUMNS) fail(id, `lists ${colsRaw.length} columns (max ${MAX_COLUMNS})`);
  const columns: string[] = [];
  for (const c of colsRaw as unknown[]) {
    if (!str(c)) fail(id, "has a column that is not a field key");
    if (columns.includes(c as string)) fail(id, `lists column "${c}" twice`);
    fieldTypeFor(id, category, c as string, `column "${c}"`);
    columns.push(c as string);
  }

  // ---- relation ----
  let relation: ToolRelation | null = null;
  if (o.relation !== undefined && o.relation !== null) {
    const ro = o.relation as Record<string, unknown>;
    if (!str(ro.kind) || !(RELATION_KINDS as readonly string[]).includes(ro.kind as string)) fail(id, `has relation kind "${String(ro.kind)}" (expected one of ${RELATION_KINDS.join(", ")})`);
    if (ro.direction !== "from" && ro.direction !== "to") fail(id, `has relation direction "${String(ro.direction)}" (expected from or to)`);
    relation = { kind: ro.kind as string, direction: ro.direction };
  }
  if (kind === "relations" && !relation) fail(id, "is kind \"relations\" but declares no \"relation\"");
  if (kind !== "relations" && relation) fail(id, `declares a relation but its kind is "${kind}"`);

  const tool: Tool = {
    id, kind, name_en: o.name_en as string, name_de: o.name_de as string, description_en: o.description_en as string,
    vendor, category, facets, fixed_filter: fixedFilter, sort, columns, examples: [], relation,
  };

  // ---- examples: each is a RUN query string, so an example that cannot be run is refused ----
  const exRaw = o.examples;
  if (!Array.isArray(exRaw) || exRaw.length === 0) fail(id, "must carry at least one example");
  const params = runParamsOf(tool);
  for (const e of exRaw as unknown[]) {
    if (!e || typeof e !== "object") fail(id, "has an example that is not an object");
    const eo = e as Record<string, unknown>;
    if (!str(eo.title)) fail(id, "has an example with no title");
    if (typeof eo.filter !== "string") fail(id, `example "${String(eo.title)}" has no "filter" query string`);
    for (const name of new URLSearchParams(eo.filter as string).keys()) {
      if (!params.has(name)) fail(id, `example "${String(eo.title)}" uses parameter "${name}", which the tool does not accept (accepts: ${[...params.keys()].join(", ")})`);
    }
    tool.examples.push({ title: eo.title as string, filter: eo.filter as string });
  }
  return tool;
}

// ---------------------------------------------------------------------------------------------
// The run parameter surface
// ---------------------------------------------------------------------------------------------

export type RunParamRole = "eq" | "min" | "max" | "reserved" | "lifecycle" | "relation";
export type RunParam = { name: string; key: string | null; ui: ToolUi | null; type: FieldType | null; role: RunParamRole };

/** Every query parameter `GET /v1/tools/{id}/run` accepts, by name. Anything else is a 400 that
 *  names it — the same rule filter.ts applies to an unknown filter key. */
export function runParamsOf(tool: Tool): Map<string, RunParam> {
  const out = new Map<string, RunParam>();
  const add = (name: string, p: Omit<RunParam, "name">) => out.set(name, { name, ...p });
  for (const f of tool.facets) {
    const type = FIELD_DICTIONARY[f.key].type;
    if (f.ui === "range") {
      add(`${f.key}_min`, { key: f.key, ui: f.ui, type, role: "min" });
      add(`${f.key}_max`, { key: f.key, ui: f.ui, type, role: "max" });
    } else {
      add(f.key, { key: f.key, ui: f.ui, type, role: "eq" });
    }
  }
  for (const n of RESERVED_RUN_PARAMS) add(n, { key: null, ui: null, type: null, role: "reserved" });
  if (tool.kind === "lifecycle") for (const n of LIFECYCLE_RUN_PARAMS) add(n, { key: null, ui: null, type: null, role: "lifecycle" });
  if (tool.kind === "relations") for (const n of RELATION_RUN_PARAMS) add(n, { key: null, ui: null, type: null, role: "relation" });
  return out;
}

/**
 * Translate a run request into terms of the existing `filter=` grammar. The caller ANDs these
 * with the tool's fixed_filter. Unknown parameters are a 400 NAMING them; a value carrying a
 * comma is a 400 too, because the grammar has no quoting and the term would silently split.
 */
export function runFilterTerms(tool: Tool, query: Record<string, unknown>): string[] {
  const params = runParamsOf(tool);
  const terms: string[] = [];
  for (const [name, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === "") continue;
    const p = params.get(name);
    if (!p) {
      const offered = [...params.values()].filter((x) => x.key !== null).map((x) => x.name);
      // Same envelope as strictQuery.ts raises for a schema-declared route, so a consumer reads
      // `error.unknown_parameters` the same way whatever route refused it. The accepted list is
      // every name the tool actually takes (facets plus limit/cursor/api_key and any kind-specific
      // ones), never a list written by hand.
      throw badRequest(
        `unknown parameter "${name}" for tool "${tool.id}"; its facet parameters are ${offered.length ? offered.join(", ") : "(none)"}`,
        { unknown_parameters: [name], accepted_parameters: [...params.keys()].sort() },
      );
    }
    if (p.key === null) continue;   // limit / cursor / lifecycle dates / part — handled by the query
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const v of values) {
      const value = String(v).trim();
      if (value === "") continue;
      if (value.includes(",")) throw badRequest(`parameter "${name}" value "${value}" contains a comma, which the filter grammar cannot carry`);
      if (p.role === "min") terms.push(`${p.key}>=${value}`);
      else if (p.role === "max") terms.push(`${p.key}<=${value}`);
      else if (values.length > 1 && p.ui !== "multi") throw badRequest(`parameter "${name}" was given ${values.length} times but facet "${p.key}" is a "${p.ui}" control, which takes one value`);
      else terms.push(`${p.key}=${value}`);
    }
  }
  return terms;
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

let cache: Tool[] | null = null;

/** Parse and validate every definition. Throws — the server must not start with a tool that
 *  would offer a control the data cannot answer. */
export function loadTools(file: string = TOOLS_FILE): Tool[] {
  if (cache && file === TOOLS_FILE) return cache;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new ToolDefinitionError(`tools.json: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ToolDefinitionError(`tools.json: not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) throw new ToolDefinitionError("tools.json: the file must hold an array of tool definitions");
  const seen = new Set<string>();
  const tools = parsed.map((t) => validate(t, seen));
  tools.sort((a, b) => (a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category)));
  if (file === TOOLS_FILE) cache = tools;
  return tools;
}

export function getTool(id: string): Tool | null {
  return loadTools().find((t) => t.id === id) ?? null;
}

/** Tests write a temporary definitions file; let them re-read it. */
export function resetToolsCache(): void {
  cache = null;
}
