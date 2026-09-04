// src/api/strictQuery.ts — an undeclared query parameter is a 400 that NAMES it.
//
// Why this module exists. `GET /v1/parts?sku=SFP-10G-ER&limit=10` used to answer 200 with ten
// unrelated parts: `sku` was not a filter, Fastify's Ajv defaults (@fastify/ajv-compiler:
// `removeAdditional: true`, which only removes when a schema says `additionalProperties: false`,
// and TypeBox writes no such keyword) left the key sitting unread in `req.query`, and the handler
// simply never looked at it. Nothing anywhere told the caller they had not been understood. A
// mistyped, renamed or misremembered parameter must never be answered with a full, wrong result
// set — the same rule filter.ts already applies to an unknown filter key, and tools.ts to an
// unknown facet parameter, lifted to every route.
//
// How it works. One `onRoute` hook on the /v1 scope reads each route's OWN querystring schema at
// registration time and precomputes the accepted set from `properties`. There is no hand-written
// list of parameter names anywhere: add a property to a route's schema and it is accepted; delete
// one and it is refused, both without touching this file. Routes that declare no querystring
// accept nothing but `api_key`.
//
// Two deliberate exceptions:
//   * `api_key` is accepted everywhere — auth.ts reads the key out of the query string for a
//     browser address bar, and it is never a route parameter.
//   * a schema written `{ additionalProperties: true }` is left alone: that route validates its
//     own parameter names against something this hook cannot see (GET /v1/tools/{id}/run checks
//     them against the tool definition and throws its own naming 400). Skipping it here keeps
//     ONE rejection per route rather than two that could disagree.
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import { badRequest } from "./errors.js";

/** Accepted on every route: auth.ts reads the key from the query string, not from the schema. */
export const ALWAYS_ACCEPTED_QUERY_PARAMS = ["api_key"] as const;

type JsonSchemaish = { properties?: Record<string, unknown>; additionalProperties?: unknown };

/**
 * The parameter names a route's querystring schema declares, or `null` when the schema opts out
 * of the check with `additionalProperties: true`. A missing schema declares nothing, which is not
 * the same as opting out: such a route legitimately accepts only `api_key`.
 */
export function declaredQueryParams(querystring: unknown): string[] | null {
  if (querystring === undefined || querystring === null) return [];
  if (typeof querystring !== "object") return [];
  const schema = querystring as JsonSchemaish;
  if (schema.additionalProperties === true) return null;
  const props = schema.properties;
  return props && typeof props === "object" ? Object.keys(props) : [];
}

/** The keys present in `query` that `accepted` does not contain, in the order the caller sent them. */
export function unknownQueryParams(query: unknown, accepted: ReadonlySet<string>): string[] {
  if (!query || typeof query !== "object") return [];
  return Object.keys(query as Record<string, unknown>).filter((k) => !accepted.has(k));
}

/**
 * Build the accepted set for a route: everything its schema declares, plus `api_key`.
 * Exported so a test can assert the set comes from the schema and not from a list kept by hand.
 */
export function acceptedQueryParams(querystring: unknown): Set<string> | null {
  const declared = declaredQueryParams(querystring);
  if (declared === null) return null;
  return new Set([...declared, ...ALWAYS_ACCEPTED_QUERY_PARAMS]);
}

export function strictQueryError(method: string, url: string, unknown: string[], accepted: ReadonlySet<string>) {
  const sorted = [...accepted].sort();
  const named = unknown.map((k) => `"${k}"`).join(", ");
  const noun = unknown.length === 1 ? "query parameter" : "query parameters";
  return badRequest(
    `unknown ${noun} ${named} for ${method} ${url}; this route accepts ${sorted.join(", ")}`,
    { unknown_parameters: unknown, accepted_parameters: sorted },
  );
}

/**
 * Register on an encapsulated scope (the /v1 plugin) BEFORE its routes: every route added below
 * inherits the check, so a new route cannot be written without it.
 */
export function registerStrictQuery(app: FastifyInstance): void {
  app.addHook("onRoute", (routeOptions: RouteOptions) => {
    const accepted = acceptedQueryParams(routeOptions.schema?.querystring);
    if (accepted === null) return;   // the route validates its own names (see the header)
    const method = Array.isArray(routeOptions.method) ? routeOptions.method[0] : routeOptions.method;
    const url = routeOptions.url;
    const check = async (req: FastifyRequest): Promise<void> => {
      const unknown = unknownQueryParams(req.query, accepted);
      if (unknown.length > 0) throw strictQueryError(method, url, unknown, accepted);
    };
    // preValidation, not preHandler: `req.query` still holds every key the caller sent, and the
    // rejection happens before any database work. preValidation may already be a function or an
    // array, so it is appended rather than replaced (Fastify Hooks.md, onRoute).
    const existing = routeOptions.preValidation;
    routeOptions.preValidation = existing
      ? [...(Array.isArray(existing) ? existing : [existing]), check]
      : [check];
  });
}
