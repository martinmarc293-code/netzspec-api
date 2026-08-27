// lib/completeness.ts — the 10-group completeness score (Cycle 3 §3.1), one point per group (0–10).
// Canonical: imported by the promote pass and any reporting that needs the score. Distinct from
// isIndexable() (the 7-condition PUBLISH bar); completeness is a richer 0–10 data-quality metric.

export type ScorePart = {
  sku?: string; vendor?: string; family?: string; category?: string; type?: string;
  provenance?: { source_url?: string; verified_at?: string };
  i18n?: { de?: { name?: string; shortDesc?: string; attributes?: unknown[]; faq?: unknown[] } };
  lifecycle?: { status?: string; source_url?: string; successor_sku?: string; [k: string]: unknown };
  compat?: { relation?: string; source_url?: string }[];
};

export function completeness(p: ScorePart, opts: { reviewed?: Set<string> } = {}): { score: number; g: Record<string, boolean> } {
  const de = p.i18n?.de || {};
  const reviewed = opts.reviewed || new Set<string>();
  const refs = new Set<string>();
  if (p.provenance?.source_url) refs.add(p.provenance.source_url);
  if (p.lifecycle?.source_url) refs.add(p.lifecycle.source_url);
  for (const r of p.compat || []) if (r.source_url) refs.add(r.source_url);
  const g: Record<string, boolean> = {
    identity: !!(p.sku && p.vendor && p.family && p.category && p.type),
    description: !!(de.name && de.shortDesc),
    specs: (de.attributes || []).length >= 12,
    datasheet_source: !!(p.provenance?.source_url && p.provenance?.verified_at),
    lifecycle: (!!p.lifecycle && /\d{4}-\d{2}-\d{2}/.test(JSON.stringify(p.lifecycle))) || !!(p.lifecycle?.status === "active" && p.lifecycle?.source_url),
    compatibility: (p.compat || []).some((r) => r.relation === "vendor_verified") || !!p.lifecycle?.successor_sku,
    price_context: false, // decided by the sourcing memo (A/B); own-shop price is never on netzspec
    faq: (de.faq || []).length >= 3,
    family_prose: !!(p.family && reviewed.has(p.family)),
    second_reference: refs.size >= 2,
  };
  const score = Object.values(g).filter(Boolean).length;
  return { score, g };
}
