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
