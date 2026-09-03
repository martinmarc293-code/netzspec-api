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

// ---- the full part record: served by /parts/{vendor}/{sku} AND by /export, so it lives here ----

export const FactSource = Nullable(Type.Object({
  doc_id: Type.String(), url: Nullable(Type.String()), locator: Nullable(Type.String()), extracted_at: Nullable(Type.String({ format: "date" })),
}));
export const FactItem = Type.Object({
  key: Type.String(), label_en: Type.String(), label_de: Type.String(), type: Type.String(), value: AnyJson, unit: Nullable(Type.String()),
  raw: Type.String(), state: Type.String(), tier: Type.Integer(), method: Type.String(), inherited: Type.Boolean(),
  inherited_from: Nullable(Type.String()), source: FactSource, evidence_count: Type.Integer(),
});
export const ImageVariant = Type.Object({
  variant: Type.String(), url: Type.String(), width: Type.Integer(), height: Type.Integer(), bytes: Type.Integer(), format: Type.String(),
});
export const PartRecord = Type.Object({
  vendor: Type.String(), sku: Type.String(), slug: Type.String(),
  category: Type.Object({ slug: Type.String(), name_en: Type.String(), name_de: Type.String() }),
  family: Nullable(Type.String()), product_class: Type.String(), name: Nullable(Type.String()), description: Nullable(Type.String()),
  datasheet_url: Nullable(Type.String()),
  lifecycle: Nullable(LifecycleRecord),
  facts: Type.Array(FactItem),
  relations: Type.Array(Type.Object({
    kind: Type.String(), sku: Type.String(), in_catalog: Type.Boolean(), tier: Type.Integer(), source_url: Nullable(Type.String()), note: Nullable(Type.String()),
  })),
  images: Type.Array(Type.Object({
    role: Type.String(), url: Type.String(), width: Nullable(Type.Integer()), height: Nullable(Type.Integer()),
    alt_en: Nullable(Type.String()), alt_de: Nullable(Type.String()), variants: Type.Array(ImageVariant),
  })),
  completeness: Nullable(Type.Object({
    required_total: Type.Integer(), required_present: Type.Integer(), pct: Type.Number(), missing: Type.Array(Type.String()), no_profile: Type.Boolean(),
  })),
  sources: Type.Array(Type.Object({ doc_id: Type.String(), url: Type.String(), doc_type: Type.String(), fetched_at: Nullable(Type.String({ format: "date" })) })),
  updated_at: Type.String({ format: "date-time" }),
});

// ---- families: the counts block is served by /families AND /families/{vendor}/{family} ----

export const LifecycleBuckets = Type.Object({
  active: Type.Integer({ description: "members whose lifecycle row says active" }),
  eol_announced: Type.Integer({ description: "members with an end-of-life milestone (eol_announced, end_of_sale or end_of_support)" }),
  unknown: Type.Integer({ description: "members with no lifecycle row, or status unknown — never counted as active" }),
});
export const FamilyCounts = Type.Object({
  vendor: Type.String(),
  family: Type.String(),
  category: Type.String({ description: "the dominant category of the members" }),
  parts: Type.Integer(),
  hardware_parts: Type.Integer(),
  with_facts: Type.Integer({ description: "members with at least one rendered fact" }),
  lifecycle: LifecycleBuckets,
});
export type FamilyCountsT = Static<typeof FamilyCounts>;

/** A field label triple, reused by compare rows, shared facts and gap fields. */
export const FieldHead = {
  key: Type.String(), label_en: Type.String(), label_de: Type.String(),
};
