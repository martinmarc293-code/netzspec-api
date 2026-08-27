// FROZEN cross-site link policy (WP1 / Spec C, 2026-08-27).
// Adding a string to any list is a policy change → requires explicit review.
// The lists ARE the policy. netzspec→hexwaren links are sponsored+nofollow with
// branded/CTA anchors only; keyword/SKU anchors cross-site are forbidden.
// (Repo convention is lib/, not src/config/ — path adapted; flagged in the summary.)
import type { Locale } from "./types";

export const HEXWAREN_HOSTS = ["hexwaren.de", "www.hexwaren.de"] as const;

export const ALLOWED_SPONSORED_DE = [
  "Bei Hexwaren ansehen",
  "Verfügbarkeit bei Hexwaren prüfen",
  "Zum Hexwaren Shop",
  "Preis anfragen bei Hexwaren",
  "hexwaren.de",
] as const;

export const ALLOWED_SPONSORED_EN = [
  "View at Hexwaren",
  "Check availability at Hexwaren",
  "Visit the Hexwaren shop",
] as const;

// Editorial (followed) — branded only. No "kaufen", no product words, no SKUs.
export const ALLOWED_EDITORIAL = [
  "Hexwaren",
  "Hexwaren GmbH",
  "hexwaren.de",
  "bei Hexwaren",
] as const;

/** Every allowed cross-site anchor string (union), for the CI guard. */
export const ALL_ALLOWED_ANCHORS: readonly string[] = [
  ...ALLOWED_SPONSORED_DE,
  ...ALLOWED_SPONSORED_EN,
  ...ALLOWED_EDITORIAL,
];

/** Is this host one of hexwaren's? (accepts a hostname or a full URL) */
export function isHexwarenHost(hostOrUrl: string): boolean {
  let host = hostOrUrl;
  try { host = new URL(hostOrUrl).hostname; } catch { /* already a host */ }
  return (HEXWAREN_HOSTS as readonly string[]).includes(host.toLowerCase());
}

/** Deterministic, build-stable sponsored anchor for a SKU (no per-render randomness). */
export function sponsoredAnchor(sku: string, locale: Locale): string {
  const h = [...sku].reduce((a, c) => a + c.charCodeAt(0), 0);
  return locale === "de" ? ALLOWED_SPONSORED_DE[h % ALLOWED_SPONSORED_DE.length] : ALLOWED_SPONSORED_EN[h % ALLOWED_SPONSORED_EN.length];
}

/** Add campaign UTMs to a verified hexwaren product/category URL. */
export function hexwarenSponsoredHref(baseUrl: string, sku: string, campaign: "part-page" | "hub" | "embed" = "part-page"): string {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set("utm_source", "netzspec");
    u.searchParams.set("utm_medium", "partner");
    u.searchParams.set("utm_campaign", campaign);
    u.searchParams.set("utm_content", sku.toLowerCase());
    return u.toString();
  } catch {
    return baseUrl;
  }
}
