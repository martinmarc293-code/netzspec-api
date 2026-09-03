// scripts/universe/apply-name-specs.ts — mine specs from the product NAME already in the DB.
//
//   npx tsx scripts/universe/apply-name-specs.ts            dry run
//   npx tsx scripts/universe/apply-name-specs.ts --commit    write
//   npx tsx scripts/universe/apply-name-specs.ts --sku PID   explain one part
//
// apply-description-specs reads data/universe/part-descriptions.json, which was recovered from
// cached ordering tables and EoL bulletins. 13,391 parts are absent from that file — and 2,387 of
// them carry a perfectly good product name in the database anyway, EVERY ONE OF WHICH IS
// INDEXABLE. Those are the pages that actually rank, and no miner had ever looked at them:
//
//   "Cisco C9200L-24P-4G Managed Switch (L3) – 24× Gigabit-RJ45 (PoE+, 30 W) + 4× 1G-SFP"
//   "ISR4331/K9 – Cisco ISR 4331 (3GE,2NIM,1SM,4G FLASH,4G DRAM,IPB)"
//
// INSERT-ONLY, AND THAT IS THE WHOLE SAFETY ARGUMENT.
//
// These names are not an independent source. Many were composed BY US from specs already in the
// database, so mining them and merging normally would let a value agree with itself and be
// promoted to "corroborated" — the state that means two independent sources concur. That would
// manufacture confidence out of nothing, and it would be invisible, because a corroborated field
// looks exactly like a well-sourced one.
//
// So this writer only ever fills silence: if the part already holds the field, from any source at
// any tier, it is skipped outright. It cannot overwrite, cannot conflict, and cannot corroborate.
// The mergeField ladder is deliberately not used here — not because it is wrong, but because its
// corroboration rule assumes source independence that this input does not have.
import fs from "node:fs";
import path from "node:path";
import { MongoClient, type Collection } from "mongodb";
import { completenessV2 } from "../../lib/fieldSchema.js";
import { normalizeField } from "../../lib/specNormalize.js";
import { parsePorts } from "../../lib/portParse.js";
import type { SpecEntry } from "../../lib/specMerge.js";

const COMMIT = process.argv.includes("--commit");
const si = process.argv.indexOf("--sku");
const ONLY = si >= 0 ? process.argv[si + 1] : null;

const ROOT = process.cwd();
const day = new Date().toISOString().slice(0, 10);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })) as Record<string, string>;

type Pattern = { id: string; category: string; field_key: string; regex: string;
  value_group: number; fixed_value?: unknown; unit?: string };

const stats = {
  candidates: 0, alreadyMined: 0, placeholder: 0, tooShort: 0,
  portsParsed: 0, patternHits: 0, normFailed: 0,
  inserted: 0, skippedFieldPresent: 0, partsTouched: 0,
  normReasons: {} as Record<string, number>,
};

async function main() {
  const descDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/part-descriptions.json"), "utf8"));
  const mined = new Set(Object.keys(descDoc.descriptions));
  const patternDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/description-patterns.json"), "utf8"));
  const byCategory = new Map<string, { p: Pattern; re: RegExp }[]>();
  for (const p of patternDoc.patterns as Pattern[]) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push({ p, re: new RegExp(p.regex, "i") });
  }

  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true });
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  const P: Collection = db.collection("parts");

  const q: Record<string, unknown> = ONLY ? { sku: ONLY } : {};
  const rows = await P.find(q, { projection: { _id: 0, sku: 1, category: 1, specs_v2: 1, i18n: 1 } }).toArray();

  const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
  const fieldCounts: Record<string, number> = {};
  const plan: string[] = [];

  for (const r of rows as unknown as { sku: string; category?: string; specs_v2?: SpecEntry[];
      i18n?: { de?: { name?: string } } }[]) {
    if (mined.has(r.sku) && !ONLY) { stats.alreadyMined++; continue; }
    const name = r.i18n?.de?.name || "";
    if (!name) continue;
    if (name === `Cisco ${r.sku}`) { stats.placeholder++; continue; }
    // A short name is the SKU plus a word or two; there is nothing in it to mine, and a rule
    // that fires on one is almost certainly reading the part number.
    if (name.length <= 25) { stats.tooShort++; continue; }
    stats.candidates++;

    const cat = String(r.category || "");
    const existing: SpecEntry[] = r.specs_v2 || [];
    const have = new Set(existing.map((s) => s.k));
    const prov = { tier: 2, method: "product_name_mining", source_url: "", locator: "i18n.de.name",
      extracted_at: day, raw: name.slice(0, 300) };

    const add: SpecEntry[] = [];

    if (!have.has("ports")) {
      const pp = parsePorts(name);
      if (pp.ok) { stats.portsParsed++;
        add.push({ k: "ports", raw: name, value: pp.value, state: "verified", prov } as SpecEntry); }
    } else if (parsePorts(name).ok) stats.skippedFieldPresent++;

    for (const { p, re } of byCategory.get(cat) || []) {
      if (have.has(p.field_key)) { stats.skippedFieldPresent++; continue; }
      if (add.some((a) => a.k === p.field_key)) continue;       // first pattern for a field wins
      const m = re.exec(name);
      if (!m) continue;
      const raw = p.fixed_value !== undefined ? String(p.fixed_value) : (m[p.value_group] ?? "");
      if (!String(raw).trim()) continue;
      const n = normalizeField(cat, p.field_key, String(raw), { locale: "en", unitHint: p.unit });
      if (!n.ok) { stats.normFailed++; stats.normReasons[n.reason] = (stats.normReasons[n.reason] || 0) + 1; continue; }
      stats.patternHits++;
      add.push({ k: p.field_key, raw: String(raw), value: n.value, unit: n.unit, state: "verified",
        prov: { ...prov, locator: `i18n.de.name:${p.id}` } } as SpecEntry);
    }

    if (!add.length) continue;
    stats.partsTouched++;
    stats.inserted += add.length;
    for (const a of add) fieldCounts[a.k] = (fieldCounts[a.k] || 0) + 1;
    if (ONLY) for (const a of add) plan.push(`  insert  ${a.k.padEnd(22)} ${JSON.stringify(a.value)}${a.unit ? " " + a.unit : ""}`);

    if (COMMIT) {
      const merged = [...existing, ...add];
      const values: Record<string, unknown> = {};
      for (const s of merged) if (s.state === "verified" || s.state === "corroborated") values[s.k] = s.value;
      const c = completenessV2(cat, values);
      ops.push({ updateOne: { filter: { sku: r.sku }, update: { $set: { specs_v2: merged,
        completeness_v2: { required_total: c.required_total, required_present: c.required_present,
          pct: c.pct, missing: c.missing, no_profile: c.no_profile, computed_at: day } } } } });
      if (ops.length >= 400) await P.bulkWrite(ops.splice(0), { ordered: false });
    }
  }
  if (COMMIT && ops.length) await P.bulkWrite(ops, { ordered: false });
  await client.close();

  if (ONLY) { console.log(`\n=== ${ONLY} ===`); for (const l of plan) console.log(l); }
  console.log(`\n${COMMIT ? "COMMITTED" : "DRY RUN — no writes"}`);
  console.log(`already covered by part-descriptions.json: ${stats.alreadyMined} | placeholder names: ${stats.placeholder}` +
    ` | too short to mine: ${stats.tooShort}`);
  console.log(`names mined: ${stats.candidates} | parts gaining a value: ${stats.partsTouched}`);
  console.log(`values inserted: ${stats.inserted} (ports ${stats.portsParsed}, patterns ${stats.patternHits})`);
  console.log(`fields SKIPPED because the part already held them: ${stats.skippedFieldPresent}` +
    "   <- insert-only: a name we may have written ourselves must never corroborate its own source");
  console.log(`failed normalisation: ${stats.normFailed} ${JSON.stringify(stats.normReasons)}`);
  console.log("\nnew values by field:");
  for (const [k, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${k.padEnd(26)} ${String(n).padStart(6)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
