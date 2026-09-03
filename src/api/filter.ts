// src/api/filter.ts — the `filter=` grammar from docs/API.md, compiled to parameterised SQL.
//
//   filter=poe_budget>=370,poe_standard=802.3bt,stackable=true
//
// One EXISTS subquery per predicate, each against CURRENT facts (superseded_by IS NULL) in the
// rendered states (verified, corroborated). A held conflict or an unverified aggregator value
// never satisfies a filter: a consumer filtering on `poe_budget>=370` is asking "which parts
// are KNOWN to have that", and the answer must be the same set the part page would show.
//
// Rules enforced here:
//   * an unknown key is a 400 that NAMES the key — the old pipeline dropped unknown keys with a
//     silent `continue`, and a filter that silently matched nothing would be the same bug on the
//     read side;
//   * the value never reaches the SQL text; only `$n` placeholders do. The key is validated
//     against the dictionary AND passed as a parameter, never interpolated;
//   * numeric operators use the generated columns (value_num, value_min, value_max), so they
//     hit the index and never parse JSON; a numeric operator on a string field is a 400.
import { badRequest } from "./errors.js";

export type FilterFieldType = "n" | "nr" | "b" | "e" | "s" | "ls" | "struct";
export type FilterDictionary = ReadonlyMap<string, { type: FilterFieldType }>;

export type CompiledFilter = {
  /** SQL fragments, each a complete `EXISTS (...)` expression referencing the outer alias `p` */
  clauses: string[];
  params: unknown[];
};

const OPERATORS = ["!=", ">=", "<=", "=", ">", "<", "~"] as const;
type Operator = (typeof OPERATORS)[number];

const RENDERED_STATES_SQL = "('verified', 'corroborated')";

/** Split on commas: the grammar has no quoting, so a value cannot contain a comma. */
export function splitFilterTerms(input: string): string[] {
  return input.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

type Term = { key: string; op: Operator; value: string };

export function parseTerm(term: string): Term {
  // key, then the LONGEST operator that matches, then the value. Two-character operators are
  // tried first so `>=` is never read as `>` followed by a value starting with `=`.
  const keyMatch = term.match(/^([a-z0-9_]+)\s*(.*)$/s);
  if (!keyMatch) throw badRequest(`filter term "${term}" does not start with a field key`);
  const key = keyMatch[1];
  const rest = keyMatch[2];
  const op = OPERATORS.find((o) => rest.startsWith(o));
  if (!op) throw badRequest(`filter term "${term}" has no operator (expected one of ${OPERATORS.join(" ")})`);
  const value = rest.slice(op.length).trim();
  if (value === "") throw badRequest(`filter term "${term}" has no value`);
  return { key, op, value };
}

function likePattern(v: string): string {
  // Escape LIKE metacharacters so a consumer's "%" is a literal, then wrap for substring.
  return "%" + v.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

function parseNumeric(term: Term): number {
  const n = Number(term.value);
  if (!Number.isFinite(n)) throw badRequest(`filter "${term.key}${term.op}${term.value}": "${term.value}" is not a number`);
  return n;
}

function parseBoolean(term: Term): boolean {
  if (term.value === "true") return true;
  if (term.value === "false") return false;
  throw badRequest(`filter "${term.key}${term.op}${term.value}": boolean fields take true or false`);
}

/**
 * Compile one term into a condition over the fact alias `f`. Returns the condition SQL and the
 * parameters it consumed; placeholders are numbered from `next`.
 */
function compileCondition(term: Term, type: FilterFieldType, next: number): { sql: string; params: unknown[] } {
  const { op } = term;
  const p1 = `$${next}`;

  if (type === "struct") throw badRequest(`filter key "${term.key}" is a structured field and cannot be filtered`);

  if (op === ">=" || op === "<=" || op === ">" || op === "<") {
    if (type !== "n" && type !== "nr") throw badRequest(`filter "${term.key}${op}${term.value}": operator ${op} needs a numeric field (${term.key} is type ${type})`);
    const n = parseNumeric(term);
    if (type === "n") return { sql: `f.value_num ${op} ${p1}`, params: [n] };
    // A range satisfies `>= x` when its whole range does, i.e. its minimum does; `<= x` when its
    // maximum does. Consistent with "known to be at least x".
    const col = op === ">=" || op === ">" ? "f.value_min" : "f.value_max";
    return { sql: `${col} ${op} ${p1}`, params: [n] };
  }

  if (op === "=" || op === "!=") {
    const neg = op === "!=";
    const wrap = (sql: string) => (neg ? `NOT (${sql})` : sql);
    switch (type) {
      case "n": return { sql: wrap(`f.value_num = ${p1}`), params: [parseNumeric(term)] };
      case "nr": { const n = parseNumeric(term); return { sql: wrap(`f.value_min <= ${p1} AND f.value_max >= ${p1}`), params: [n] }; }
      case "b": return { sql: wrap(`f.value = to_jsonb(${p1}::boolean)`), params: [parseBoolean(term)] };
      case "e":
      case "s": return { sql: wrap(`(f.value #>> '{}') = ${p1}`), params: [term.value] };
      case "ls": return { sql: wrap(`jsonb_typeof(f.value) = 'array' AND f.value ? ${p1}::text`), params: [term.value] };
    }
  }

  // "~": substring on strings, membership-by-substring on lists.
  switch (type) {
    case "e":
    case "s": return { sql: `(f.value #>> '{}') ILIKE ${p1}`, params: [likePattern(term.value)] };
    case "ls": return { sql: `jsonb_typeof(f.value) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.value) AS el WHERE el ILIKE ${p1})`, params: [likePattern(term.value)] };
    default: throw badRequest(`filter "${term.key}~${term.value}": operator ~ needs a string or list field (${term.key} is type ${type})`);
  }
}

/**
 * Compile a whole `filter=` string. `firstParam` is the number of the first free `$n`
 * placeholder in the enclosing statement.
 */
export function compileFilter(input: string, dictionary: FilterDictionary, firstParam: number): CompiledFilter {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let next = firstParam;
  for (const raw of splitFilterTerms(input)) {
    const term = parseTerm(raw);
    const def = dictionary.get(term.key);
    if (!def) throw badRequest(`unknown filter key "${term.key}"`);
    const keyParam = `$${next}`;
    params.push(term.key);
    next++;
    const cond = compileCondition(term, def.type, next);
    params.push(...cond.params);
    next += cond.params.length;
    clauses.push(
      `EXISTS (SELECT 1 FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL` +
      ` AND f.state IN ${RENDERED_STATES_SQL} AND f.field_key = ${keyParam} AND (${cond.sql}))`,
    );
  }
  return { clauses, params };
}
