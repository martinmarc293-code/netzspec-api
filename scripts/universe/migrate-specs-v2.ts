// scripts/universe/migrate-specs-v2.ts — WP2. ADDITIVE migration of legacy German attributes
// into the typed specs_v2 record shape, through the WP4 normaliser.
//
//   npx tsx scripts/universe/migrate-specs-v2.ts              dry run, full report, no writes
//   npx tsx scripts/universe/migrate-specs-v2.ts --commit     write specs_v2 + completeness_v2
//   npx tsx scripts/universe/migrate-specs-v2.ts --limit 200  bounded run for iteration
//
// Nothing is deleted. `i18n.de.attributes` stays exactly as it is — the 236 staged Catalyst pages
// render from it, and constraint 8 says a schema migration must carry them forward, not invalidate
// them. specs_v2 is written ALONGSIDE, and snapshot-staged.ts proves the rest of the document is
// byte-identical afterwards.
//
// Trust tier 0 = operator-reviewed seed. HexCat attributes are the only operator-reviewed spec
// data in the system (§0.5), so they outrank every scraped tier and the WP5 merge engine may
// never overwrite them — a differing extraction goes to spec_conflicts instead.
//
// Re-running is safe: only entries whose prov.method is "hexcat_seed" are replaced; anything a
// later tier wrote is preserved.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import { completenessV2, PROFILES, FIELD_DICTIONARY } from "../../lib/fieldSchema.js";
import { normalizeField, NORM_VERSION } from "../../lib/specNormalize.js";

const COMMIT = process.argv.includes("--commit");
const li = process.argv.indexOf("--limit");
const LIMIT = li >= 0 ? parseInt(process.argv[li + 1], 10) : 0;
const SEED_METHOD = "hexcat_seed";

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const aliasFile = JSON.parse(fs.readFileSync(path.join(root, "data/schema/attribute-aliases.de.json"), "utf8"));
const ALIASES: Record<string, string | string[]> = aliasFile.aliases;

const day = new Date().toISOString().slice(0, 10);
const qDir = path.join(root, "data/universe/quarantine");
fs.mkdirSync(qDir, { recursive: true });
const qPath = path.join(qDir, `specs-v2-migration_${day}.jsonl`);
const qStream: string[] = [];

type SpecEntry = {
  k: string; raw: string; value?: unknown; unit?: string; state: string;
  prov: { tier: number; method: string; doc_id?: string; locator?: string; extracted_at?: string; norm_v: string };
};

const stats = {
  parts: 0, attrs: 0, mapped: 0, stored: 0,
  not_a_spec: 0, compat: 0, backlog: 0, unmapped: 0, out_of_profile: 0, rerouted: 0,
  reasons: {} as Record<string, number>,
  perField: {} as Record<string, { ok: number; fail: number }>,
};
const bump = (r: string) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };
const docIdFor = (url: string) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);

function buildSpecs(part: Record<string, unknown>): SpecEntry[] {
  const category = String(part.category || "");
  const profile = PROFILES[category];
  const attrs = ((part as { i18n?: { de?: { attributes?: { name: string; value: string }[] } } })
    .i18n?.de?.attributes) || [];
  const prov = (part as { provenance?: { source_url?: string; verified_at?: string } }).provenance || {};
  const out: SpecEntry[] = [];
  const seen = new Set<string>();

  for (const a of attrs) {
    stats.attrs++;
    const rawTarget = ALIASES[a.name];
    if (!rawTarget) { stats.unmapped++; bump("UNMAPPED_HEADER");
      qStream.push(JSON.stringify({ sku: part.sku, name: a.name, value: a.value, reason: "UNMAPPED_HEADER" }));
      continue; }
    // A target may be an ordered CANDIDATE LIST — one legacy name carries different concepts
    // across parts ("Formfaktor" = SFP+ here, "LR4" = an optical standard there). Take the first
    // candidate that both belongs to this category's profile and actually normalises.
    const candidates = Array.isArray(rawTarget) ? rawTarget : [rawTarget];
    if (candidates[0] === "__not_a_spec") { stats.not_a_spec++; continue; }
    if (candidates[0] === "__compat") { stats.compat++; continue; }
    if (candidates[0] === "__backlog") { stats.backlog++; continue; }

    const inProfile = candidates.filter((t) => profile && profile[t]);
    if (!inProfile.length) {
      // A real field that this category's profile does not carry (e.g. `standard` on a switch).
      // Recorded, not stored — storing it would put a value outside the denominator, which is
      // how an unmeasurable field crept in last time.
      stats.out_of_profile++;
      qStream.push(JSON.stringify({ sku: part.sku, category, name: a.name, field: candidates.join("|"), reason: "OUT_OF_PROFILE" }));
      continue;
    }
    stats.mapped++;
    let placed = false;
    let lastReason = "", lastDetail = "", lastKey = inProfile[0];
    for (const target of inProfile) {
      lastKey = target;
      if (seen.has(target)) {
        // this key is already filled on this part; try the next candidate before giving up
        lastReason = "INTRA_DOC_DUPLICATE"; lastDetail = `${target} already set`;
        continue;
      }
      const r = normalizeField(category, target, a.value);
      if (!r.ok) { lastReason = r.reason; lastDetail = r.detail; continue; }
      seen.add(target);
      (stats.perField[target] ||= { ok: 0, fail: 0 }).ok++;
      stats.stored++;
      if (candidates.length > 1 && target !== candidates[0]) stats.rerouted++;
      out.push({
        k: target, raw: String(a.value), value: r.value, unit: r.unit, state: "verified",
        prov: { tier: 0, method: SEED_METHOD, doc_id: prov.source_url ? docIdFor(prov.source_url) : undefined,
          locator: "hexcat:attributes", extracted_at: prov.verified_at, norm_v: NORM_VERSION },
      });
      placed = true;
      break;
    }
    if (!placed) {
      (stats.perField[lastKey] ||= { ok: 0, fail: 0 }).fail++;
      bump(lastReason || "PARSE_FAIL");
      qStream.push(JSON.stringify({ sku: part.sku, name: a.name, field: lastKey,
        tried: inProfile, value: a.value, reason: lastReason || "PARSE_FAIL", detail: lastDetail }));
    }
  }
  return out;
}

async function main() {
  const client = new MongoClient(env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true,
  });
  await client.connect();
  const db = client.db(env.MONGODB_DB as string);
  const P: Collection = db.collection("parts");

  // WP2 also creates the two side collections the merge engine needs (Q7). They must exist with
  // their indexes before WP5 writes to them; an empty spec_conflicts is a meaningful state.
  const existing = (await db.listCollections().toArray()).map((c) => c.name);
  for (const name of ["source_docs", "spec_conflicts"]) {
    if (!existing.includes(name)) {
      if (COMMIT) { await db.createCollection(name); console.log(`created collection ${name}`); }
      else console.log(`would create collection ${name}`);
    }
  }
  if (COMMIT) {
    await db.collection("source_docs").createIndex({ doc_id: 1 }, { unique: true });
    await db.collection("spec_conflicts").createIndex({ sku: 1, k: 1 });
  }

  const sourceDocs = new Map<string, { doc_id: string; url: string; doc_type: string; fetched_at?: string; pid_list: string[] }>();
  const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
  const distribution: Record<string, number[]> = {};

  // Stream with a cursor and a narrow projection. promote-tranche.ts slurps every full document
  // with .toArray() and that read just died on an Atlas ECONNRESET at 3,883 docs [M 2026-09-01].
  const cursor = P.find({}, {
    projection: { _id: 0, sku: 1, category: 1, vendor: 1, family: 1, provenance: 1,
      "i18n.de.attributes": 1, specs_v2: 1 },
  }).batchSize(200);

  for await (const part of cursor) {
    if (LIMIT && stats.parts >= LIMIT) break;
    stats.parts++;
    const seedSpecs = buildSpecs(part as Record<string, unknown>);

    // preserve anything a non-seed tier already wrote
    const prior: SpecEntry[] = ((part as { specs_v2?: SpecEntry[] }).specs_v2 || [])
      .filter((s) => s.prov?.method !== SEED_METHOD);
    const priorKeys = new Set(prior.map((s) => s.k));
    const merged = [...prior, ...seedSpecs.filter((s) => !priorKeys.has(s.k))];

    const values: Record<string, unknown> = {};
    for (const s of merged) values[s.k] = s.value;
    const c = completenessV2(String(part.category || ""), values);
    (distribution[String(part.category)] ||= []).push(c.no_profile ? -1 : c.required_present);

    if (COMMIT) {
      ops.push({ updateOne: { filter: { sku: part.sku },
        update: { $set: { specs_v2: merged, completeness_v2: {
          required_total: c.required_total, required_present: c.required_present,
          pct: c.pct, missing: c.missing, no_profile: c.no_profile, computed_at: day } } } } });
    }
    const url = (part as { provenance?: { source_url?: string; verified_at?: string } }).provenance?.source_url;
    if (url) {
      const id = docIdFor(url);
      const d = sourceDocs.get(id) || { doc_id: id, url, doc_type: url.endsWith(".pdf") ? "vendor_datasheet_pdf" : "vendor_datasheet_html",
        fetched_at: (part as { provenance?: { verified_at?: string } }).provenance?.verified_at, pid_list: [] };
      d.pid_list.push(String(part.sku));
      sourceDocs.set(id, d);
    }
    if (COMMIT && ops.length >= 500) { await P.bulkWrite(ops.splice(0), { ordered: false }); }
  }
  if (COMMIT && ops.length) await P.bulkWrite(ops, { ordered: false });

  if (COMMIT && sourceDocs.size) {
    await db.collection("source_docs").bulkWrite([...sourceDocs.values()].map((d) => ({
      updateOne: { filter: { doc_id: d.doc_id }, update: { $set: d }, upsert: true },
    })), { ordered: false });
  }

  fs.writeFileSync(qPath, qStream.join("\n") + (qStream.length ? "\n" : ""), "utf8");
  await client.close();

  // ---- report ----------------------------------------------------------------------------------
  console.log(`\n${COMMIT ? "COMMITTED" : "DRY RUN"} — parts scanned: ${stats.parts}`);
  console.log(`legacy attributes seen: ${stats.attrs}`);
  console.log(`  -> mapped to a profile field: ${stats.mapped}`);
  console.log(`     -> normalised + stored:    ${stats.stored}`);
  console.log(`     -> quarantined:            ${stats.mapped - stats.stored}`);
  console.log(`  -> __not_a_spec (commerce/marketing, deliberately dropped): ${stats.not_a_spec}`);
  console.log(`  -> __compat (belongs in the compat store):                  ${stats.compat}`);
  console.log(`  -> __backlog (named schema gap, next cycle):                ${stats.backlog}`);
  console.log(`  -> out of this category's profile:                          ${stats.out_of_profile}`);
  console.log(`  -> UNMAPPED_HEADER (never stored as a field name):          ${stats.unmapped}`);
  console.log(`     (of the stored, ${stats.rerouted} were re-routed to a SECOND candidate key -- the legacy name meant something else on that part)`);
  console.log(`\nquarantine reasons: ${JSON.stringify(stats.reasons)}`);
  console.log(`quarantine file: ${path.relative(root, qPath)} (${qStream.length} rows)`);
  console.log(`source_docs distinct: ${sourceDocs.size}`);

  console.log(`\nrequired-fields-present distribution (specs_v2, seed only):`);
  for (const [cat, arr] of Object.entries(distribution)) {
    const vals = arr.filter((v) => v >= 0).sort((a, b) => a - b);
    if (!vals.length) { console.log(`  ${cat}: no profile (${arr.length} parts excluded from scoring)`); continue; }
    const sum = vals.reduce((a, b) => a + b, 0);
    const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor((vals.length - 1) * p))];
    console.log(`  ${cat}: n=${vals.length} mean=${(sum / vals.length).toFixed(1)} ` +
      `min=${vals[0]} p50=${pct(0.5)} p90=${pct(0.9)} max=${vals[vals.length - 1]}`);
  }
  const worst = Object.entries(stats.perField).filter(([, v]) => v.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail).slice(0, 10);
  if (worst.length) {
    console.log(`\nfields losing the most values to quarantine:`);
    for (const [k, v] of worst) console.log(`  ${k.padEnd(22)} ok=${String(v.ok).padStart(5)} fail=${String(v.fail).padStart(5)}  (${FIELD_DICTIONARY[k]?.type})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
