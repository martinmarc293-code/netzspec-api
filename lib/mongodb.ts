import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "netzspec";

if (!uri) throw new Error("MONGODB_URI is not set (see .env.local)");

// Cache the client across hot-reloads in dev and across lambda invocations.
declare global {
  // eslint-disable-next-line no-var
  var _netzspecMongo: Promise<MongoClient> | undefined;
}

const clientPromise: Promise<MongoClient> =
  global._netzspecMongo ?? (global._netzspecMongo = new MongoClient(uri, { maxPoolSize: 10 }).connect());

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(dbName);
}

export default clientPromise;
