// scripts/universe/apply-description-specs.ts — mine specs out of the product's own name.
//
//   npx tsx scripts/universe/apply-description-specs.ts            dry run
//   npx tsx scripts/universe/apply-description-specs.ts --commit    write
//   npx tsx scripts/universe/apply-description-specs.ts --sku PID   explain one part
//
// WHY THIS SOURCE EXISTS AT ALL
//
// Most Cisco part numbers will never appear in a datasheet. They are in an ordering table or an
// end-of-life bulletin, and the only thing either document says about them is a description
// string — which is dense, abbreviated and, on inspection, packed with specifications:
//
//   "Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base"
//    -> 48 x rj45 1G + 2 x sfp-plus 10G, PoE, 740 W
//
// TIER 2, DELIBERATELY. A description is vendor HTML, so a datasheet table (tier 1) always wins
// on any field where both speak — see lib/specMerge. This source can only fill silence, never
// overrule a document.
//
// TWO INDEPENDENT PATHS, and they are different in kind:
//
//   ports        lib/portParse reads the WHOLE description. A port layout is a structure, not a
//                token, so no per-field regex can produce one; and a naive "\d+ ports" pattern
//                yields a bare count, which parsePorts refuses outright as "a count, not a port
//                layout" — correctly, because `ports` is a layout field.
//   everything   data/schema/description-patterns.json, each rule already proved against the
//   else        whole corpus of its category by lib/descPattern.mjs before it was written there.
//
// A pattern's value still goes through normalizeField here rather than being trusted from the
// accept-time measurement. The corpus can move, the dictionary can move, and a value that
// normalised cleanly in July is not thereby clean today.
import fs from "node:fs";
import path from "node:path";
import { MongoClient, type Collection } from "mongodb";
import { completenessV2 } from "../../core/fieldSchema.js";
import { normalizeField } from "../../core/specNormalize.js";
import { parsePorts } from "../../core/portParse.js";
import { mergeField, type SpecEntry } from "../../core/specMerge.js";

const COMMIT = process.argv.includes("--commit");
const si = process.argv.indexOf("--sku");
const ONLY = si >= 0 ? process.argv[si + 1] : null;

const ROOT = process.cwd();
const day = new Date().toISOString().slice(0, 10);

// Same .env.local reader as apply-specs-v2 and ~30 other scripts here. It is a duplicated helper,
// which this repo has been bitten by before, but the copies are already everywhere and diverging
// from them in one new file would make the situation worse rather than better.
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })) as Record<string, string>;

type Pattern = {
  id: string; category: string; field_key: string; regex: string;
  value_group: number; fixed_value?: unknown; unit?: string;
};

const stats = {
  described: 0, portsParsed: 0, portsRefused: 0, patternHits: 0, patternRejected: 0,
  notInDb: 0, partsTouched: 0, insert: 0, corroborate: 0, conflict: 0,
  protectedTier0: 0, skipLowerTier: 0,
  portRefusalReasons: {} as Record<string, number>,
  normReasons: {} as Record<string, number>,
};

async function main() {
  const descDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/part-descriptions.json"), "utf8"));
  const patternDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/description-patterns.json"), "utf8"));
  const byCategory = new Map<string, { p: Pattern; re: RegExp }[]>();
  for (const p of patternDoc.patterns as Pattern[]) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push({ p, re: new RegExp(p.regex, "i") });
  }
  console.log(`patterns: ${patternDoc.patterns.length} across ${byCategory.size} categories`);

  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true,
  });
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  const P: Collection = db.collection("parts");

  const entries = Object.entries(descDoc.descriptions as Record<string, { desc: string; source_url: string }>)
    .filter(([sku, rec]) => rec && rec.desc && (!ONLY || sku === ONLY));
  const skus = entries.map(([s]) => s);

  // Batched, for the reason recorded in apply-specs-v2: thousands of sequential findOne round
  // trips is a lot of surface for one transient topology failure to kill a finished run.
  const partBySku = new Map<string, { sku: string; category?: string; specs_v2?: unknown[] }>();
  for (let i = 0; i < skus.length; i += 500) {
    const rows = await P.find({ sku: { $in: skus.slice(i, i + 500) } },
      { projection: { _id: 0, sku: 1, category: 1, specs_v2: 1 } }).toArray();
    for (const r of rows) partBySku.set(String(r.sku), r as never);
  }
  console.log(`described parts: ${entries.length} | found in DB: ${partBySku.size}`);

  const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
  const plan: string[] = [];
  const fieldCounts: Record<string, number> = {};

  for (const [sku, rec] of entries) {
    stats.described++;
    const part = partBySku.get(sku);
    if (!part) { stats.notInDb++; continue; }
    const cat = String(part.category || "");
    // `method` is required on Prov and names HOW the value was obtained, which for this source is
    // the whole point: "description_mining" marks every value here as INFERRED FROM PROSE rather
    // than read from a labelled cell. A later audit that wants to re-check only the inferred
    // values — or drop them wholesale if the parser turns out to be wrong — needs that label to
    // exist from the first write, not to be reconstructed afterwards from a locator string.
    const prov = { tier: 2, method: "description_mining", source_url: rec.source_url,
      locator: "description", extracted_at: day, raw: rec.desc.slice(0, 300) };

    const incoming: SpecEntry[] = [];

    // ---- ports: the whole string, or nothing ------------------------------------------------
    const pp = parsePorts(rec.desc);
    if (pp.ok) {
      stats.portsParsed++;
      incoming.push({ k: "ports", raw: rec.desc, value: pp.value, state: "verified", prov } as SpecEntry);
    } else {
      stats.portsRefused++;
      const why = pp.detail.replace(/"[^"]*"/g, '"…"').slice(0, 44);
      stats.portRefusalReasons[why] = (stats.portRefusalReasons[why] || 0) + 1;
    }

    // ---- everything else: one validated pattern at a time -----------------------------------
    for (const { p, re } of byCategory.get(cat) || []) {
      const m = re.exec(rec.desc);
      if (!m) continue;
      const raw = p.fixed_value !== undefined ? String(p.fixed_value) : (m[p.value_group] ?? "");
      if (!String(raw).trim()) continue;
      const n = normalizeField(cat, p.field_key, String(raw), { locale: "en", unitHint: p.unit });
      if (!n.ok) {
        stats.patternRejected++;
        stats.normReasons[n.reason] = (stats.normReasons[n.reason] || 0) + 1;
        continue;
      }
      stats.patternHits++;
      incoming.push({ k: p.field_key, raw: String(raw), value: n.value, unit: n.unit,
        state: "verified", prov: { ...prov, locator: `description:${p.id}` } } as SpecEntry);
    }

    if (!incoming.length) continue;

    const existing: SpecEntry[] = (part.specs_v2 as SpecEntry[]) || [];
    const byKey = new Map(existing.map((s) => [s.k, s]));
    let changed = false;
    for (const e of incoming) {
      const r = mergeField(sku, byKey.get(e.k), e);
      switch (r.action) {
        case "insert": stats.insert++; byKey.set(e.k, r.entry); changed = true; break;
        case "corroborate": stats.corroborate++; byKey.set(e.k, r.entry); changed = true; break;
        case "conflict": stats.conflict++; byKey.set(e.k, r.entry); changed = true; break;
        case "protected": stats.protectedTier0++; break;
        default: stats.skipLowerTier++;
      }
      if (r.action === "insert") fieldCounts[e.k] = (fieldCounts[e.k] || 0) + 1;
      if (ONLY) plan.push(`  ${r.action.padEnd(16)} ${e.k.padEnd(22)} ${JSON.stringify(e.value)}${e.unit ? " " + e.unit : ""}`);
    }
    if (!changed) continue;

    stats.partsTouched++;
    if (COMMIT) {
      const merged = [...byKey.values()];
      const values: Record<string, unknown> = {};
      for (const s of merged) if (s.state === "verified" || s.state === "corroborated") values[s.k] = s.value;
      const c = completenessV2(cat, values);
      ops.push({ updateOne: { filter: { sku }, update: { $set: { specs_v2: merged,
        completeness_v2: { required_total: c.required_total, required_present: c.required_present,
          pct: c.pct, missing: c.missing, no_profile: c.no_profile, computed_at: day } } } } });
      if (ops.length >= 400) await P.bulkWrite(ops.splice(0), { ordered: false });
    }
  }
  if (COMMIT && ops.length) await P.bulkWrite(ops, { ordered: false });
  await client.close();

  if (ONLY) { console.log(`\n=== ${ONLY} ===`); for (const l of plan) console.log(l); }
  console.log(`\n${COMMIT ? "COMMITTED" : "DRY RUN — no writes"}`);
  console.log(`described ${stats.described} | not in DB ${stats.notInDb} | parts touched ${stats.partsTouched}`);
  console.log(`ports: ${stats.portsParsed} parsed, ${stats.portsRefused} refused`);
  console.log(`patterns: ${stats.patternHits} values, ${stats.patternRejected} failed normalisation ` +
    JSON.stringify(stats.normReasons));
  console.log(`merge: insert ${stats.insert} | corroborate ${stats.corroborate} | conflict ${stats.conflict}` +
    ` | tier-0 protected ${stats.protectedTier0} | skipped as lower tier ${stats.skipLowerTier}`);

  console.log("\nnew values by field:");
  for (const [k, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${k.padEnd(26)} ${String(n).padStart(6)}`);
  }
  // The refusals are reported rather than swallowed: they are the map of what a better parser
  // would have to understand next, and a silent refusal is indistinguishable from no data.
  console.log("\ntop reasons a description yielded no port layout:");
  for (const [r, n] of Object.entries(stats.portRefusalReasons).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(6)}  ${r}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
