// src/api/schemas.ts — the TypeBox shapes shared by more than one route.
//
// These are the contract in docs/API.md, written once so the OpenAPI document, the response
// serialiser and the TypeScript types cannot disagree. Per-route shapes stay in the route file.
//
// `Nullable` uses the OpenAPI 3.0 `nullable: true` keyword rather than a `Type.Union` with
// null: fast-json-stringify serialises it directly (an anyOf would fall back to a slow path
// and, for objects, can pick the wrong branch), and swagger renders it as intended.
import { Type, type Static, type TSchema } from "@sinclair/typebox";

export const Nullable = <T extends TSchema>(t: T) => Type.Unsafe<Static<T> | null>({ ...t, nullable: true });

/** Any JSON value, including null: fact values, run manifests. */
export const AnyJson = Type.Unsafe<unknown>({});

export const ErrorEnvelope = Type.Object({
  error: Type.Object({
    code: Type.Union([
      Type.Literal("not_found"), Type.Literal("bad_request"), Type.Literal("unauthorized"),
      Type.Literal("rate_limited"), Type.Literal("internal"),
    ]),
    message: Type.String(),
  }),
});

/** The standard error responses every authenticated route can produce. */
export const ERROR_RESPONSES = {
  400: ErrorEnvelope, 401: ErrorEnvelope, 404: ErrorEnvelope, 429: ErrorEnvelope, 500: ErrorEnvelope,
};

export const PartSummary = Type.Object({
  vendor: Type.String(),
  sku: Type.String(),
  slug: Type.String(),
  category: Type.String(),
  family: Nullable(Type.String()),
  product_class: Type.String(),
  name: Nullable(Type.String()),
  /** `unknown` when no lifecycle row exists yet; never guessed as `active` */
  lifecycle_status: Type.String(),
  /** current facts in the rendered states (verified, corroborated) */
  fact_count: Type.Integer(),
  /** null when no completeness row exists or the part has no profile */
  completeness_pct: Nullable(Type.Number()),
  has_image: Type.Boolean(),
  updated_at: Type.String({ format: "date-time" }),
});
export type PartSummaryT = Static<typeof PartSummary>;

export const LifecycleRecord = Type.Object({
  status: Type.String(),
  announce_date: Nullable(Type.String({ format: "date" })),
  end_of_sale_date: Nullable(Type.String({ format: "date" })),
  last_ship_date: Nullable(Type.String({ format: "date" })),
  end_of_sw_maint: Nullable(Type.String({ format: "date" })),
  end_of_vuln_support: Nullable(Type.String({ format: "date" })),
  last_day_of_support: Nullable(Type.String({ format: "date" })),
  bulletin_id: Nullable(Type.String()),
  successor_sku: Nullable(Type.String()),
  successor_note: Nullable(Type.String()),
  source_url: Nullable(Type.String()),
  note: Nullable(Type.String()),
  verified_at: Nullable(Type.String({ format: "date" })),
});
export type LifecycleRecordT = Static<typeof LifecycleRecord>;

export const ListQuery = {
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
  cursor: Type.Optional(Type.String()),
};

export const ListOf = <T extends TSchema>(item: T, extra: Record<string, TSchema> = {}) =>
  Type.Object({ items: Type.Array(item), next_cursor: Nullable(Type.String()), ...extra });

export const SECURITY = [{ bearerAuth: [] as string[] }];
