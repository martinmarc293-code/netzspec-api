import { getDb } from "./mongodb";
import type { Part, Guide, Author } from "./types";

// ---- Parts -----------------------------------------------------------------
// listParts returns INDEXABLE parts only (hubs/homepage/related). HexCat stubs are
// excluded here; the tools reach all SKUs via searchParts / getPartBySku / listSwitches.
export async function listParts(filter: Partial<Pick<Part, "vendor" | "category" | "type">> = {}, limit = 5000): Promise<Part[]> {
  const db = await getDb();
  return db.collection<Part>("parts").find({ ...(filter as object), indexable: { $ne: false } }, { projection: { _id: 0 } }).sort({ sku: 1 }).limit(limit).toArray();
}

export async function getPartBySlug(vendor: string, slug: string): Promise<Part | null> {
  const db = await getDb();
  return db.collection<Part>("parts").findOne({ vendor, slug }, { projection: { _id: 0 } });
}

export async function getPartBySku(sku: string): Promise<Part | null> {
  const db = await getDb();
  return db.collection<Part>("parts").findOne({ sku }, { projection: { _id: 0 } });
}

export async function getPartsBySkus(skus: string[]): Promise<Part[]> {
  if (!skus.length) return [];
  const db = await getDb();
  return db.collection<Part>("parts").find({ sku: { $in: skus } }, { projection: { _id: 0 } }).toArray();
}

/** Bidirectional verified compatibility for a part. */
// Compatible parts by explicit pairs (curated) OR form-factor matching (HexCat stubs).
// switch → optics whose formFactor ∈ switch.acceptsFF; optic → switches that accept its formFactor.
export async function compatibleFor(part: Part): Promise<Part[]> {
  const db = await getDb();
  const p = part as Part & { type?: string; acceptsFF?: string[]; formFactor?: string };
  const or: object[] = [{ sku: { $in: part.compatible || [] } }, { compatible: part.sku }];
  if (p.type === "switch" && p.acceptsFF?.length) or.push({ type: { $ne: "switch" }, formFactor: { $in: p.acceptsFF } });
  else if (p.type !== "switch" && p.formFactor) or.push({ type: "switch", acceptsFF: p.formFactor });
  const rows = await db.collection<Part>("parts")
    .find({ $or: or }, { projection: { _id: 0 } })
    .limit(120).toArray();
  const seen = new Set<string>();
  return rows.filter((r) => (r.sku !== part.sku && !seen.has(r.sku) ? (seen.add(r.sku), true) : false)).slice(0, 60);
}

// Lightweight refs for INDEXABLE parts only (tiny projection) — for sitemap + static params.
// Curated parts have no `indexable` field → `$ne: false` includes them; stubs are excluded.
export async function indexablePartRefs(): Promise<{ vendor: string; slug: string; category: string }[]> {
  const db = await getDb();
  return db.collection<Part>("parts")
    .find({ indexable: { $ne: false } }, { projection: { _id: 0, vendor: 1, slug: 1, category: 1 } })
    .toArray() as unknown as { vendor: string; slug: string; category: string }[];
}

// Comparison pages: an EoL switch family vs its successor family (highest-intent "[A] vs [B]" query).
const SUCC_FAM = (sku: string): string | null =>
  /C9300/.test(sku) ? "Cisco Catalyst 9300" : /C9200/.test(sku) ? "Cisco Catalyst 9200" :
  /C9500/.test(sku) ? "Cisco Catalyst 9500" : /C9400/.test(sku) ? "Cisco Catalyst 9400" : null;

// the richest-spec representative part of a family (for the side-by-side spec table)
export async function familyReprPart(family: string): Promise<{ sku: string; slug: string; vendor: string; name: string; attributes: { name: string; value: string }[] } | null> {
  const db = await getDb();
  const parts = await db.collection<Part>("parts")
    .find({ family, type: "switch" }, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, "i18n.de.name": 1, "i18n.de.attributes": 1 } }).toArray();
  parts.sort((a, b) => (b.i18n?.de?.attributes?.length || 0) - (a.i18n?.de?.attributes?.length || 0));
  const p = parts[0];
  if (!p || (p.i18n?.de?.attributes?.length || 0) < 8) return null;
  return { sku: p.sku, slug: p.slug, vendor: p.vendor, name: p.i18n?.de?.name || p.sku, attributes: (p.i18n?.de?.attributes || []) as { name: string; value: string }[] };
}

export async function comparisonPairs(): Promise<{ eolFamily: string; successorFamily: string; slug: string }[]> {
  const eol = await eolFamilies();
  const out: { eolFamily: string; successorFamily: string; slug: string }[] = [];
  const seen = new Set<string>();
  for (const f of eol) {
    const parts = await eolFamilyParts(f.family);
    const succCounts: Record<string, number> = {};
    for (const p of parts) { const s = (p as { lifecycle?: Record<string, string> }).lifecycle?.successor_sku; const fam = s ? SUCC_FAM(s) : null; if (fam) succCounts[fam] = (succCounts[fam] || 0) + 1; }
    const succFam = Object.entries(succCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!succFam || succFam === f.family) continue;
    // both sides must have a spec'd representative
    if (!(await familyReprPart(f.family)) || !(await familyReprPart(succFam))) continue;
    const sl = (x: string) => x.replace("Cisco Catalyst ", "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const slug = `catalyst-${sl(f.family)}-vs-${sl(succFam)}`;
    if (seen.has(slug)) continue; seen.add(slug);
    out.push({ eolFamily: f.family, successorFamily: succFam, slug });
  }
  return out;
}

// Compat content pages: switch families with vendor-verified optic compatibility (Cisco TMG).
export async function compatFamilies(): Promise<{ family: string; count: number }[]> {
  const db = await getDb();
  const r = await db.collection<Part>("parts").aggregate([
    { $match: { type: "switch", "compat.relation": "vendor_verified" } },
    { $group: { _id: "$family", count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, count: { $gte: 3 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  return r.map((x) => ({ family: x._id as string, count: x.count as number }));
}
export async function familyCompatOptics(family: string): Promise<{ optics: { sku: string; slug: string; vendor: string; formFactor: string | null; name: string }[]; source: string | null; opticCount: number }> {
  const db = await getDb();
  const switches = await db.collection<Part>("parts")
    .find({ family, type: "switch", "compat.0": { $exists: true } }, { projection: { compat: 1, _id: 0 } }).limit(50).toArray();
  const opticSkus = new Set<string>(); let source: string | null = null;
  for (const s of switches) for (const c of ((s as { compat?: { sku: string; relation?: string; source_url?: string }[] }).compat || [])) {
    if (c.relation === "vendor_verified" && c.sku) { opticSkus.add(c.sku); if (c.source_url && !source) source = c.source_url; }
  }
  const rows = opticSkus.size ? await db.collection<Part>("parts")
    .find({ sku: { $in: [...opticSkus] } }, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, formFactor: 1, "i18n.de.name": 1 } }).toArray() : [];
  const optics = rows.map((r) => ({ sku: r.sku, slug: r.slug, vendor: r.vendor, formFactor: (r as { formFactor?: string }).formFactor || null, name: r.i18n?.de?.name || r.sku }))
    .sort((a, b) => (a.formFactor || "").localeCompare(b.formFactor || "") || a.sku.localeCompare(b.sku));
  return { optics, source, opticCount: opticSkus.size };
}

// EOL content pages: switch families with verified lifecycle + enough models to be a real page.
export async function eolFamilies(): Promise<{ family: string; count: number }[]> {
  const db = await getDb();
  const r = await db.collection<Part>("parts").aggregate([
    { $match: { type: "switch", "lifecycle.end_of_sale_date": { $exists: true, $ne: null } } },
    { $group: { _id: "$family", count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, count: { $gte: 5 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  return r.map((x) => ({ family: x._id as string, count: x.count as number }));
}
export async function eolFamilyParts(family: string): Promise<Part[]> {
  const db = await getDb();
  return db.collection<Part>("parts")
    .find({ family, "lifecycle.end_of_sale_date": { $exists: true } }, { projection: { _id: 0 } })
    .toArray() as unknown as Part[];
}

// §3.5: the promote pass sets tranche:N + promoted_at; this powers sitemap-tranche-NN.xml (/de URLs).
export async function tranchePartRefs(tranche: number): Promise<{ vendor: string; slug: string; promoted_at?: string }[]> {
  const db = await getDb();
  return db.collection<Part>("parts")
    .find({ tranche, indexable: true }, { projection: { _id: 0, vendor: 1, slug: 1, promoted_at: 1 } })
    .toArray() as unknown as { vendor: string; slug: string; promoted_at?: string }[];
}

// Minimal switch list for the compat-tool dropdown (name + sku only; details fetched on select).
export async function listSwitches(): Promise<{ sku: string; slug: string; vendor: string; name_de: string }[]> {
  const db = await getDb();
  const rows = await db.collection<Part>("parts")
    .find({ type: "switch" }, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, "i18n.de.name": 1 } })
    .toArray();
  return rows.map((r) => ({ sku: r.sku, slug: r.slug, vendor: r.vendor, name_de: r.i18n?.de?.name || r.sku }));
}

export async function searchParts(q: string, limit = 40): Promise<Part[]> {
  const db = await getDb();
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return db.collection<Part>("parts")
    .find({ $or: [{ sku: rx }, { "i18n.en.name": rx }, { "i18n.de.name": rx }] }, { projection: { _id: 0 } })
    .limit(limit).toArray();
}

// a few well-specced representative parts per category (visual richness on the category page; a small
// curated set, not thousands of links).
export async function featuredParts(category: string, n = 8): Promise<{ sku: string; slug: string; vendor: string; name: string }[]> {
  const db = await getDb();
  const rows = await db.collection<Part>("parts")
    .find({ category, "i18n.de.attributes.11": { $exists: true } }, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, "i18n.de.name": 1 } })
    .sort({ sku: 1 }).limit(n).toArray();
  return rows.map((r) => ({ sku: r.sku, slug: r.slug, vendor: r.vendor, name: r.i18n?.de?.name || r.sku }));
}

// public search over the WHOLE universe (stubs included), lean + with lifecycle summary. Powers the
// EOL tool + category search without shipping the full DB to the client. Never returns price fields.
export async function searchPartsLean(q: string, opts: { category?: string; type?: string } = {}, limit = 25):
  Promise<{ sku: string; slug: string; vendor: string; name: string; type: string; category: string; lc: { status: string; eos: string; ldos: string; successor: string; doc: string } | null }[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = {};
  if (opts.category) filter.category = opts.category;
  if (opts.type) filter.type = opts.type;
  const qt = q.trim();
  if (qt) { const rx = new RegExp(qt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); filter.$or = [{ sku: rx }, { "i18n.de.name": rx }, { "i18n.en.name": rx }]; }
  const rows = await db.collection<Part>("parts")
    .find(filter, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, type: 1, category: 1, "i18n.de.name": 1, lifecycle: 1 } })
    .sort({ sku: 1 }).limit(limit).toArray();
  return rows.map((r) => {
    const lc = (r as { lifecycle?: Record<string, string> }).lifecycle;
    return { sku: r.sku, slug: r.slug, vendor: r.vendor, type: r.type, category: r.category, name: r.i18n?.de?.name || r.sku,
      lc: lc ? { status: lc.status || "", eos: lc.end_of_sale_date || "", ldos: lc.last_day_of_support || "", successor: lc.successor_sku || "", doc: lc.source_doc_id || "" } : null };
  });
}

export async function countParts(filter: object = {}): Promise<number> {
  const db = await getDb();
  return db.collection("parts").countDocuments(filter);
}

export async function vendorCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.collection("parts").aggregate([{ $match: { indexable: { $ne: false } } }, { $group: { _id: "$vendor", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id as string, r.n as number]));
}

export async function categoryCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.collection("parts").aggregate([{ $match: { indexable: { $ne: false } } }, { $group: { _id: "$category", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id as string, r.n as number]));
}
// ALL parts (stubs included) — for browse counts + tools. Stubs stay noindex; these are just numbers /
// a search surface, never thousands of crawlable links.
export async function categoryCountsAll(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.collection("parts").aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id as string, r.n as number]));
}
export async function vendorCountsAll(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.collection("parts").aggregate([{ $group: { _id: "$vendor", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id as string, r.n as number]));
}
// lean projection of EVERY part for the EOL tool (covers the whole universe, small payload).
export async function eolToolParts(): Promise<{ sku: string; slug: string; vendor: string; name: string; status: string; lc: { status: string; eos: string; ldos: string; successor: string; doc: string } | null }[]> {
  const db = await getDb();
  const rows = await db.collection<Part>("parts")
    .find({}, { projection: { _id: 0, sku: 1, slug: 1, vendor: 1, "i18n.de.name": 1, "eol.status": 1, lifecycle: 1 } })
    .toArray();
  return rows.map((r) => {
    const lc = (r as { lifecycle?: Record<string, string> }).lifecycle;
    return { sku: r.sku, slug: r.slug, vendor: r.vendor, name: r.i18n?.de?.name || r.sku, status: r.eol?.status || "",
      lc: lc ? { status: lc.status || "", eos: lc.end_of_sale_date || "", ldos: lc.last_day_of_support || "", successor: lc.successor_sku || "", doc: lc.source_doc_id || "" } : null };
  });
}

/** Parts in a category, grouped by vendor (for a category hub). */
export async function partsByCategoryGrouped(category: string): Promise<Record<string, Part[]>> {
  const parts = await listParts({ category });
  const out: Record<string, Part[]> = {};
  for (const p of parts) (out[p.vendor] ||= []).push(p);
  return out;
}

// ---- Guides ----------------------------------------------------------------
export async function listGuides(limit = 500): Promise<Guide[]> {
  const db = await getDb();
  return db.collection<Guide>("guides").find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(limit).toArray();
}
export async function getGuide(slug: string): Promise<Guide | null> {
  const db = await getDb();
  return db.collection<Guide>("guides").findOne({ slug }, { projection: { _id: 0 } });
}

// ---- Authors ---------------------------------------------------------------
export async function listAuthors(): Promise<Author[]> {
  const db = await getDb();
  return db.collection<Author>("authors").find({}, { projection: { _id: 0 } }).toArray();
}
export async function getAuthor(slug: string): Promise<Author | null> {
  const db = await getDb();
  return db.collection<Author>("authors").findOne({ slug }, { projection: { _id: 0 } });
}
