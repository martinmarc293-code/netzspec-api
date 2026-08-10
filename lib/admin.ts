import { getDb } from "./mongodb";

// Bearer-auth for write endpoints (DubaiFix-style). Reads are open.
export function authed(req: Request): boolean {
  const key = process.env.ADMIN_API_KEY;
  return !!key && (req.headers.get("authorization") || "") === `Bearer ${key}`;
}

const KEY = { parts: "sku", guides: "slug", authors: "slug" } as const;
export type Coll = keyof typeof KEY;

export async function upsert(coll: Coll, doc: Record<string, unknown>) {
  const kf = KEY[coll];
  if (!doc[kf]) throw new Error(`field "${kf}" is required`);
  const db = await getDb();
  doc.updatedAt = new Date().toISOString();
  await db.collection(coll).updateOne({ [kf]: doc[kf] }, { $set: doc }, { upsert: true });
  return db.collection(coll).findOne({ [kf]: doc[kf] }, { projection: { _id: 0 } });
}

export async function remove(coll: Coll, id: string) {
  const db = await getDb();
  const r = await db.collection(coll).deleteOne({ [KEY[coll]]: id });
  return r.deletedCount > 0;
}

export async function counts() {
  const db = await getDb();
  const [parts, guides, authors] = await Promise.all([
    db.collection("parts").countDocuments(),
    db.collection("guides").countDocuments(),
    db.collection("authors").countDocuments(),
  ]);
  return { parts, guides, authors };
}

export const unauthorized = () => Response.json({ error: "unauthorized — send Authorization: Bearer <ADMIN_API_KEY>" }, { status: 401 });
