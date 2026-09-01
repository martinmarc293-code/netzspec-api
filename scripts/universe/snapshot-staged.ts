// scripts/universe/snapshot-staged.ts — WP2 invariant proof (STOP condition 1).
//
//   npx tsx scripts/universe/snapshot-staged.ts --save    baseline BEFORE the migration
//   npx tsx scripts/universe/snapshot-staged.ts --diff    compare AFTER; prints "changed: N of M"
//
// The invariant: the specs_v2 migration is ADDITIVE, so every part document must be byte-identical
// apart from the two new fields. Rather than enumerate the fields the part page renders — which
// would be a proxy, and would silently miss any field I forgot — this hashes the WHOLE document
// with the new keys removed. The renderer is a pure function of the document, so an unchanged
// document cannot render differently. That is an invariant, not an approximation.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const SAVE = process.argv.includes("--save");
const DIFF = process.argv.includes("--diff");
if (!SAVE && !DIFF) { console.error("pass --save or --diff"); process.exit(2); }

const root = process.cwd();
const OUT = path.join(root, "data/universe/staged-snapshot.json");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// Fields the migration is ALLOWED to add. Everything else must be identical.
const NEW_FIELDS = new Set(["specs_v2", "completeness_v2"]);

/** Stable stringify: key order in a Mongo document is not guaranteed across reads, so sort keys
 *  recursively before hashing. Without this the diff would report false changes. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => !NEW_FIELDS.has(k))
    .map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

async function main() {
  const client = new MongoClient(env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true,
  });
  await client.connect();
  const P = client.db(env.MONGODB_DB as string).collection("parts");
  const hashes: Record<string, string> = {};
  const cursor = P.find({}, { projection: { _id: 0 } }).batchSize(200);
  let n = 0;
  for await (const doc of cursor) {
    hashes[String(doc.sku)] = crypto.createHash("sha256").update(canonical(doc)).digest("hex").slice(0, 24);
    n++;
  }
  await client.close();

  if (SAVE) {
    fs.writeFileSync(OUT, JSON.stringify({ saved_at: new Date().toISOString(), count: n, hashes }, null, 0));
    console.log(`baseline saved: ${n} parts -> ${path.relative(root, OUT)}`);
    return;
  }

  if (!fs.existsSync(OUT)) { console.error("no baseline; run --save first"); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const prev: Record<string, string> = base.hashes;
  const changed: string[] = [], added: string[] = [], removed: string[] = [];
  for (const sku of Object.keys(hashes)) {
    if (!(sku in prev)) added.push(sku);
    else if (prev[sku] !== hashes[sku]) changed.push(sku);
  }
  for (const sku of Object.keys(prev)) if (!(sku in hashes)) removed.push(sku);

  console.log(`baseline: ${base.count} parts (saved ${base.saved_at})`);
  console.log(`now:      ${n} parts`);
  console.log(`changed: ${changed.length} of ${base.count}`);
  if (added.length) console.log(`added:   ${added.length} (${added.slice(0, 5).join(", ")})`);
  if (removed.length) console.log(`removed: ${removed.length} (${removed.slice(0, 5).join(", ")})`);
  if (changed.length) {
    console.log(`\nFAIL — the migration altered documents outside ${[...NEW_FIELDS].join("/")}:`);
    for (const s of changed.slice(0, 20)) console.log(`  ${s}`);
    process.exit(1);
  }
  console.log("\nOK — every part is byte-identical outside the additive fields.");
}

main().catch((e) => { console.error(e); process.exit(1); });
