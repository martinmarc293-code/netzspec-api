// Shared domain types for netzspec.com — BILINGUAL (English default + German).

export type Locale = "en" | "de";
export const LOCALES: Locale[] = ["en", "de"];
export const DEFAULT_LOCALE: Locale = "en";

export interface Attribute {
  name: string;
  value: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Eol {
  status: string; // language-neutral key resolved in UI, or short label
  source: string;
}

/** Per-locale content for a part. */
export interface PartL10n {
  name: string;
  shortDesc: string;
  description: string; // HTML
  seoTitle: string;
  metaDesc: string;
  attributes: Attribute[];
  faq: Faq[];
}

/** A part-number reference page — bilingual. Neutral fields + per-locale content. */
export interface Part {
  sku: string;
  slug: string;
  vendor: string;
  category: string;
  type: string;
  listPriceEUR: number | null;
  priceNote?: string;
  eol: Eol;
  condition: string;
  compatible: string[];
  dataSource: string;
  verifiedBy?: string; // author slug
  hexwarenUrl?: string | null; // funnel target (German shop)
  family?: string; // product-line family (canonical name; drives block 5/6 + c5)
  indexable?: boolean; // false = noindex stub; absent/true = indexable
  lifecycle?: Record<string, unknown>; // verified EoL milestones (block 3)
  provenance?: { source_url?: string; verified_at?: string; doc_id?: string };
  compat?: { sku?: string; relation?: string; source_url?: string; kind?: string; note?: string; inDb?: boolean }[];
  completeness_score?: number;
  tranche?: number;
  views?: number;
  updatedAt: string;
  i18n: Record<Locale, PartL10n>;
}

export interface GuideL10n {
  title: string;
  excerpt: string;
  body: string; // markdown-lite
  seoTitle: string;
  metaDesc: string;
}

export interface Guide {
  slug: string;
  category: string;
  relatedSkus: string[];
  authorSlug?: string;
  readMinutes?: number;
  publishedAt?: string;
  updatedAt: string;
  i18n: Record<Locale, GuideL10n>;
}

export interface AuthorL10n {
  role: string;
  bio: string;
}

export interface Author {
  slug: string;
  name: string; // neutral
  credentials?: string;
  expertise: string[];
  avatarColor?: string;
  createdAt: string;
  i18n: Record<Locale, AuthorL10n>;
}

export const VENDORS = ["cisco", "hpe", "aruba", "juniper"] as const;
export type Vendor = (typeof VENDORS)[number];

/** Pull the right locale content, falling back to the default locale. */
export function loc<T>(map: Record<Locale, T>, locale: Locale): T {
  return map[locale] ?? map[DEFAULT_LOCALE];
}
