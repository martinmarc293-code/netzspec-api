import { getDb } from "./mongodb";
import type { Part, Guide, Author } from "./types";

// ---- Parts -----------------------------------------------------------------
export async function listParts(filter: Partial<Pick<Part, "vendor" | "category" | "type">> = {}, limit = 5000): Promise<Part[]> {
  const db = await getDb();
  return db.collection<Part>("parts").find(filter as object, { projection: { _id: 0 } }).sort({ sku: 1 }).limit(limit).toArray();
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
export async function compatibleFor(part: Part): Promise<Part[]> {
  const db = await getDb();
  const rows = await db.collection<Part>("parts")
    .find({ $or: [{ sku: { $in: part.compatible || [] } }, { compatible: part.sku }] }, { projection: { _id: 0 } })
    .toArray();
  const seen = new Set<string>();
  return rows.filter((p) => (p.sku !== part.sku && !seen.has(p.sku) ? (seen.add(p.sku), true) : false));
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
  const rows = await db.collection("parts").aggregate([{ $group: { _id: "$vendor", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id as string, r.n as number]));
}

export async function categoryCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.collection("parts").aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]).toArray();
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
