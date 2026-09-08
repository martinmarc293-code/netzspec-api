// tests/tools.test.ts — proof that data/schema/tools.json cannot lie. No database.
//
//   npx tsx tests/tools.test.ts
//
// The rule this suite exists for: a finder that offers a control the category profile does not
// carry looks like "no products match" and is really "nobody ever stored this". So the shipped
// definitions are checked field by field, and — the half that matters — a deliberately broken
// definition is fed to the same loader and must be REFUSED FOR THE STATED REASON. A check that
// has never failed is not a check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIELD_DICTIONARY, PROFILES } from "../src/core/fieldSchema.js";
import { loadTools, runFilterTerms, runParamsOf, UI_FOR_TYPE, type Tool } from "../src/api/tools.js";

let pass = 0, miss = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { miss++; console.log(`MISS  ${name}${detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netzspec-tools-"));
let seq = 0;
/** Write a definitions file and return what the loader did with it. */
function loadRaw(defs: unknown[]): { ok: true; tools: Tool[] } | { ok: false; message: string } {
  const file = path.join(tmp, `tools-${seq++}.json`);
  fs.writeFileSync(file, JSON.stringify(defs), "utf8");
  try { return { ok: true, tools: loadTools(file) }; }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
/** A definition must be refused, and the message must name the tool AND the offending thing. */
function sabotage(name: string, defs: unknown[], ...needles: string[]): void {
  const r = loadRaw(defs);
  if (r.ok) { miss++; console.log(`MISS  SABOTAGE ${name} was ACCEPTED`); return; }
  const hit = needles.every((n) => r.message.includes(n));
  check(`SABOTAGE ${name} refused, naming ${needles.join(" + ")}`, hit, r.message);
}

// A definition that is valid in every respect; each sabotage case mutates exactly one thing, so
// a refusal can only be about that thing.
const GOOD = {
  id: "probe-tool", category: "switches",
  name_en: "Probe", name_de: "Probe", description_en: "A valid definition the sabotage cases mutate.",
  facets: [{ key: "poe_budget", ui: "range" }, { key: "layer", ui: "select" }],
  fixed_filter: "poe_standard!=none",
  sort: { key: "poe_budget", dir: "desc" },
  columns: ["poe_budget", "layer", "ports"],
  examples: [{ title: "PoE over 370 W", filter: "poe_budget_min=370" }],
};
const withGood = (patch: Record<string, unknown>) => [{ ...GOOD, ...patch }];

// ---- the shipped definitions ------------------------------------------------------------------
const tools = loadTools();

check(`at least 60 tool definitions ship (${tools.length})`, tools.length >= 60, tools.length);
check("the control definition itself is accepted (so every refusal below is about the sabotage)", loadRaw(withGood({})).ok);

{
  const ids = tools.map((t) => t.id);
  check("every id is unique", new Set(ids).size === ids.length);
  check("every id is a kebab slug", ids.every((i) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i)), ids.filter((i) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i)));
  const cats = new Set(tools.map((t) => t.category));
  check(`tools span at least 12 categories (${cats.size})`, cats.size >= 12, [...cats]);
  check("every category has a profile", [...cats].every((c) => !!PROFILES[c]), [...cats].filter((c) => !PROFILES[c]));
  check("every kind is facets, lifecycle or relations", tools.every((t) => ["facets", "lifecycle", "relations"].includes(t.kind)));
  check("at least one lifecycle-shaped and one relation-shaped tool",
    tools.some((t) => t.kind === "lifecycle") && tools.some((t) => t.kind === "relations"));
  check("every relation-shaped tool declares its relation", tools.filter((t) => t.kind === "relations").every((t) => t.relation !== null));
}

// The honesty rule, asserted independently of the loader that enforces it.
{
  const bad: string[] = [];
  for (const t of tools) {
    for (const f of t.facets) {
      const def = FIELD_DICTIONARY[f.key];
      if (!def) { bad.push(`${t.id}: facet ${f.key} not in dictionary`); continue; }
      if (!PROFILES[t.category]?.[f.key]) bad.push(`${t.id}: facet ${f.key} not in ${t.category} profile`);
      if (!UI_FOR_TYPE[def.type].includes(f.ui)) bad.push(`${t.id}: facet ${f.key} ui ${f.ui} on type ${def.type}`);
      if (def.type === "struct") bad.push(`${t.id}: facet ${f.key} is a struct`);
    }
    for (const c of t.columns) {
      if (!FIELD_DICTIONARY[c]) bad.push(`${t.id}: column ${c} not in dictionary`);
      else if (!PROFILES[t.category]?.[c]) bad.push(`${t.id}: column ${c} not in ${t.category} profile`);
    }
    if (t.sort && FIELD_DICTIONARY[t.sort.key]?.type !== "n") bad.push(`${t.id}: sort key ${t.sort.key} is not numeric`);
  }
  check("every facet, column and sort key is in the dictionary AND its category profile, with a legal ui", bad.length === 0, bad.slice(0, 10));
}

// Every example must be runnable against the tool that carries it.
{
  const bad: string[] = [];
  for (const t of tools) {
    const params = runParamsOf(t);
    if (t.examples.length === 0) bad.push(`${t.id}: no examples`);
    for (const e of t.examples) {
      for (const n of new URLSearchParams(e.filter).keys()) if (!params.has(n)) bad.push(`${t.id}: example param ${n}`);
      if (t.kind === "relations" && !e.filter.includes("part=")) bad.push(`${t.id}: relation example without part=`);
    }
  }
  check("every example is a runnable query string for its own tool", bad.length === 0, bad.slice(0, 10));
}

// ---- sabotage: each of these must be refused, naming the tool ----------------------------------

sabotage("an unknown field key as a facet", withGood({ facets: [{ key: "poe_bugdet", ui: "range" }] }),
  '"probe-tool"', '"poe_bugdet"', "not in the field dictionary");

sabotage("a key the CATEGORY PROFILE does not carry (laser_type on switches)",
  withGood({ facets: [{ key: "laser_type", ui: "select" }] }),
  '"probe-tool"', '"laser_type"', 'not in the "switches" profile');

sabotage('a facet ui "range" on an ENUM field', withGood({ facets: [{ key: "layer", ui: "range" }] }),
  '"probe-tool"', '"layer"', 'ui "range"', "is a e field");

sabotage('a facet ui "toggle" on a numeric field', withGood({ facets: [{ key: "poe_budget", ui: "toggle" }] }),
  '"poe_budget"', 'ui "toggle"', "is a n field");

sabotage('a facet ui "multi" on an enum field', withGood({ facets: [{ key: "layer", ui: "multi" }] }),
  '"layer"', 'ui "multi"');

sabotage("a STRUCT field as a facet", withGood({ facets: [{ key: "ports", ui: "select" }] }),
  '"ports"', "cannot be a facet at all");

sabotage("an unknown column", withGood({ columns: ["poe_budget", "no_such_field"] }),
  '"no_such_field"', "not in the field dictionary");

sabotage("a column outside the category profile (laser_type is an optic field)",
  withGood({ columns: ["poe_budget", "laser_type"] }),
  '"laser_type"', 'not in the "switches" profile');

sabotage("a duplicate id", [{ ...GOOD }, { ...GOOD, name_en: "Second" }], 'duplicate tool id "probe-tool"');

sabotage("a duplicate facet", withGood({ facets: [{ key: "layer", ui: "select" }, { key: "layer", ui: "select" }] }),
  'lists facet "layer" twice');

sabotage("an unknown category", withGood({ category: "sandwiches" }), '"sandwiches"', "has no profile");

sabotage("an unknown vendor", withGood({ vendor: "acme" }), 'unknown vendor "acme"');

sabotage("a non-numeric sort key", withGood({ sort: { key: "layer", dir: "desc" } }),
  '"layer"', "only a numeric (n) field can order a result");

sabotage("a sort direction that is not asc or desc", withGood({ sort: { key: "poe_budget", dir: "down" } }),
  'sort dir "down"');

// The example was `qos_queues`, which switches DECLARED on 8 Sep 2026 — it is one of the fields
// the corpus was already producing for switches while no profile mentioned it. So the sabotage
// went green for the right reason and the wrong cause: the RULE holds, its example moved inside
// the profile. `camera_zoom` is a videoconferencing lens property; a switch profile will not
// acquire it, so the case stays about the rule rather than about which fields switches declares.
sabotage("a fixed_filter naming a key outside the profile",
  withGood({ fixed_filter: "camera_zoom=4" }), '"camera_zoom"', 'not in the "switches" profile');

sabotage("a fixed_filter with a numeric operator on an enum field",
  withGood({ fixed_filter: "layer>=3" }), '"probe-tool"', "layer>=3", "needs a numeric field");

sabotage("a fixed_filter on a struct field",
  withGood({ fixed_filter: "ports=24" }), '"ports"', "structured field");

sabotage("a fixed_filter naming an unknown product_class",
  withGood({ fixed_filter: "product_class=widget" }), "unknown product_class", '"widget"');

sabotage("an example using a parameter the tool does not accept",
  withGood({ examples: [{ title: "wrong", filter: "mtbf_min=200000" }] }), '"mtbf_min"', "does not accept");

sabotage("an example using the bare key of a RANGE facet",
  withGood({ examples: [{ title: "wrong", filter: "poe_budget=370" }] }), '"poe_budget"', "does not accept");

sabotage("a tool with no examples", withGood({ examples: [] }), "at least one example");

sabotage("a tool with no columns", withGood({ columns: [] }), "at least one column");

sabotage('a "facets" tool with no facets', withGood({ facets: [] }), "declares no facets");

sabotage('a "relations" tool with no relation', withGood({ kind: "relations" }), "declares no");

sabotage("a relation kind the relations table has no value for",
  withGood({ kind: "relations", relation: { kind: "replaces", direction: "from" } }), 'relation kind "replaces"');

sabotage("a relation direction that is not from or to",
  withGood({ kind: "relations", relation: { kind: "successor", direction: "sideways" } }), 'direction "sideways"');

sabotage("an unknown kind", withGood({ kind: "search" }), 'has kind "search"');

sabotage("a missing name", withGood({ name_de: "" }), 'is missing "name_de"');

// ---- the run parameter surface -----------------------------------------------------------------
{
  const t = loadRaw(withGood({}));
  if (!t.ok) { miss++; console.log("MISS  control tool did not load"); }
  else {
    const tool = t.tools[0];
    const names = [...runParamsOf(tool).keys()];
    check("a range facet becomes _min and _max, never the bare key",
      names.includes("poe_budget_min") && names.includes("poe_budget_max") && !names.includes("poe_budget"), names);
    check("a select facet becomes the bare key", names.includes("layer"), names);
    check("limit and cursor are always accepted", names.includes("limit") && names.includes("cursor"));

    check("min/max translate to >= and <=",
      JSON.stringify(runFilterTerms(tool, { poe_budget_min: "370", poe_budget_max: "740" })) === JSON.stringify(["poe_budget>=370", "poe_budget<=740"]));
    check("a select translates to =", JSON.stringify(runFilterTerms(tool, { layer: "l3" })) === JSON.stringify(["layer=l3"]));
    check("limit and cursor contribute no filter terms", runFilterTerms(tool, { limit: 50, cursor: "abc" }).length === 0);

    const throwsWith = (name: string, fn: () => unknown, needle: string) => {
      try { fn(); check(name, false, "did not throw"); }
      catch (e) { const m = e instanceof Error ? e.message : String(e); check(name, m.includes(needle), m); }
    };
    throwsWith("SABOTAGE an unknown run parameter is refused, naming it and listing the real ones",
      () => runFilterTerms(tool, { poe_budgets_min: "370" }), 'unknown parameter "poe_budgets_min" for tool "probe-tool"');
    throwsWith("SABOTAGE a value containing a comma is refused (the grammar has no quoting)",
      () => runFilterTerms(tool, { layer: "l3,l2" }), "contains a comma");
    throwsWith("SABOTAGE a select given twice is refused",
      () => runFilterTerms(tool, { layer: ["l3", "l2"] }), 'facet "layer" is a "select" control');
  }
}
{
  // A "multi" facet is the one control that may repeat, and the terms AND together.
  const t = loadRaw(withGood({ facets: [{ key: "certifications", ui: "multi" }], sort: null, examples: [{ title: "x", filter: "certifications=ce" }] }));
  if (!t.ok) { miss++; console.log("MISS  multi control tool did not load: " + t.message); }
  else {
    check("a multi facet accepts repeated values and ANDs them",
      JSON.stringify(runFilterTerms(t.tools[0], { certifications: ["ce", "rohs"] })) === JSON.stringify(["certifications=ce", "certifications=rohs"]));
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntools definitions: ${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);
