// isIndexable() — the minimum-to-index bar (web Cycle-2 §5.2, c4 STRICT per Cycle-3 §0.3).
// Pure + unit-tested. A part is indexable only if ALL seven conditions pass; otherwise it is
// a noindex,follow stub. Form-factor NEVER counts toward c4 (only a vendor-verified relation
// or a successor with a source_url). Family prose (c5) is passed in as the set of families
// whose reviewed prose exists.

export type IndexPart = {
  sku: string;
  family?: string;
  provenance?: { source_url?: string; verified_at?: string };
  i18n?: { de?: { attributes?: { name: string; value: string }[]; faq?: { q: string; a: string }[] } };
  lifecycle?: { status?: string; source_url?: string; successor_sku?: string; [k: string]: unknown };
  compat?: { relation?: string; source_url?: string }[];
  reviewedProse?: boolean; // set by caller from the reviewed-family set, or precomputed
};

const ISO = /\d{4}-\d{2}-\d{2}/;

export function isIndexable(
  p: IndexPart,
  opts: { reviewedFamilies?: Set<string> } = {}
): { ok: boolean; failing: string[] } {
  const de = p.i18n?.de || {};
  const attrs = de.attributes || [];
  const faq = de.faq || [];
  const lc = p.lifecycle || {};

  // c1 — verified datasheet source with a date
  const c1 = !!(p.provenance?.source_url && p.provenance?.verified_at);
  // c2 — ≥12 normalized spec fields
  const c2 = attrs.length >= 12;
  // c3 — lifecycle status with verification date (explicit dated negative counts)
  const c3 = (!!lc && ISO.test(JSON.stringify(lc))) || (lc.status === "active" && !!lc.source_url);
  // c4 STRICT — vendor-verified relation OR successor/predecessor (with source_url). NOT form-factor.
  const c4 = (p.compat || []).some((r) => r.relation === "vendor_verified" && !!r.source_url)
    || !!(lc.successor_sku && lc.source_url);
  // c5 — reviewed family prose exists
  const c5 = p.reviewedProse === true || (!!p.family && !!opts.reviewedFamilies?.has(p.family));
  // c6 — FAQ ≥3 with ≥2 answers carrying a SKU-specific value
  const skuLc = p.sku.toLowerCase();
  const specVals = attrs.map((a) => String(a.value).toLowerCase()).filter((v) => v.length > 2);
  const skuSpecific = faq.filter((f) => {
    const a = String(f.a || "").toLowerCase();
    return a.includes(skuLc) || specVals.some((v) => a.includes(v));
  }).length;
  const c6 = faq.length >= 3 && skuSpecific >= 2;
  // c7 — ≥2 distinct non-owned external references
  const refs = new Set<string>();
  if (p.provenance?.source_url) refs.add(p.provenance.source_url);
  if (lc.source_url) refs.add(lc.source_url);
  for (const r of p.compat || []) if (r.source_url) refs.add(r.source_url);
  const c7 = refs.size >= 2;

  const conds: Record<string, boolean> = { c1, c2, c3, c4, c5, c6, c7 };
  const failing = Object.entries(conds).filter(([, v]) => !v).map(([k]) => k);
  return { ok: failing.length === 0, failing };
}
