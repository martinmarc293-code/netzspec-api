// Shared domain types for netzspec.com

export interface Attribute {
  name: string;
  value: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Eol {
  status: string; // "Aktiv" | "EoS angekündigt" | ...
  source: string;
}

/** A part-number reference page — the core ranking + funnel asset. */
export interface Part {
  sku: string;
  slug: string;
  vendor: string; // cisco | hpe | aruba | juniper
  category: string; // switches | transceiver | ...
  type: string; // switch | transceiver
  name: string;
  shortDesc: string;
  description: string; // HTML (verified, from HexCat)
  seoTitle: string;
  metaDesc: string;
  attributes: Attribute[];
  faq: Faq[];
  listPriceEUR: number | null;
  priceNote?: string;
  eol: Eol;
  condition: string; // NewCondition
  compatible: string[]; // SKUs
  dataSource: string;
  verifiedBy?: string; // author slug — the expert who verified the data
  hexwarenUrl?: string | null; // the funnel target
  views?: number; // social-proof signal
  updatedAt: string;
}

/** Editorial content — buying guides, authenticity, comparisons (link/AI-citation magnets). */
export interface Guide {
  slug: string;
  title: string;
  excerpt: string;
  category: string; // Authentizität | Vergleich | Ratgeber | Lifecycle
  body: string; // markdown-lite
  relatedSkus: string[];
  authorSlug?: string;
  seoTitle: string;
  metaDesc: string;
  readMinutes?: number;
  updatedAt: string;
  publishedAt?: string;
}

/** Expert author/profile — seeds the "authoritative team" behind the data + guides (E-E-A-T). */
export interface Author {
  slug: string;
  name: string;
  role: string; // "Netzwerk-Ingenieur (CCNP)"
  bio: string;
  credentials?: string;
  expertise: string[]; // vendors/topics
  avatarColor?: string; // deterministic avatar tint
  guides?: number; // count, for profile display
  verifiedParts?: number;
  createdAt: string;
}

export const VENDORS = ["cisco", "hpe", "aruba", "juniper"] as const;
export type Vendor = (typeof VENDORS)[number];
