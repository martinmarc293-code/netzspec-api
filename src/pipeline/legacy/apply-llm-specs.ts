// scripts/universe/apply-llm-specs.ts — write LLM-extracted deep specs at TIER 2.
//
//   npx tsx scripts/universe/apply-llm-specs.ts <llm-extract.json>            dry run
//   npx tsx scripts/universe/apply-llm-specs.ts <llm-extract.json> --commit   write
//
// LLM extraction reads a vendor datasheet and outputs CLEAN per-SKU specs the deterministic
// table-parser could not attribute or normalise. It enters at tier 2 (vendor HTML), so by the
// merge rules it: FILLS fields the deterministic tier-1 pass left empty (insert), CORROBORATES
// where they agree, and safely LOSES to tier-1 / tier-0 on conflict (verified data is never
// corrupted). Every value is still run through normalizeField for unit canonicalisation + band
// checks, and the profile gate still applies. Provenance records method "llm_datasheet" + the
// source datasheet URL + the model's evidence snippet, so each spec stays auditable.
//
// Input JSON shape: { extracted: [ { url, cat, parts: [ { sku, specs: [ { field_key, value, unit?, evidence? } ] } ] } ] }
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import { completenessV2, PROFILES } from "../../core/fieldSchema.js";
import { normalizeField } from "../../core/specNormalize.js";
import { mergeField, type SpecEntry } from "../../core/specMerge.js";

const file = process.argv[2];
if (!file) { console.error("usage: apply-llm-specs.ts <llm-extract.json> [--commit]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");
const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const day = new Date("2026-09-02").toISOString().slice(0, 10);
const docIdFor = (url: string) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);

type LLMSpec = { field_key: string; value: string; unit?: string | null; evidence?: string };
type LLMPart = { sku: string; specs: LLMSpec[] };
const data = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), "utf8"));
const sheets: { url: string; cat: string; parts: LLMPart[] }[] = data.extracted || data;

// collect incoming per SKU (a SKU may be specced by more than one datasheet)
const incoming = new Map<string, SpecEntry[]>();
const stats = { rawSpecs: 0, normOk: 0, rejected: 0, rejectReasons: {} as Record<string, number> };
const rejectSamples: string[] = [];

for (const sh of sheets) {
  const prov = { tier: 2, method: "llm_datasheet", doc_id: docIdFor(sh.url), source_url: sh.url, extracted_at: day };
  for (const p of (sh.parts || [])) {
    for (const s of (p.specs || [])) {
      stats.rawSpecs++;
      // normalise for unit canonicalisation + band/enum checks (category from the datasheet cat as a hint;
      // the real category is re-read from the DB at merge time, but normalize only needs the field def + value)
      const n = normalizeField(sh.cat, s.field_key, String(s.value), { unitHint: s.unit || undefined, locale: "en" });
      if (!n.ok) {
        stats.rejected++; stats.rejectReasons[n.reason] = (stats.rejectReasons[n.reason] || 0) + 1;
        if (rejectSamples.length < 15) rejectSamples.push(`${s.field_key}="${s.value}" (${n.reason})`);
        continue;
      }
      stats.normOk++;
      const entry: SpecEntry = {
        k: s.field_key, raw: String(s.value), value: n.value, unit: n.unit, state: "verified",
        prov: { ...prov, evidence: (s.evidence || "").slice(0, 160) } as SpecEntry["prov"],
      };
      const arr = incoming.get(p.sku) || []; arr.push(entry); incoming.set(p.sku, arr);
    }
  }
}

const client = new MongoClient(env.MONGODB_URI as string, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true });
await client.connect();
const P: Collection = client.db(env.MONGODB_DB as string).collection("parts");

const merge = { insert: 0, corroborate: 0, skip: 0, conflict: 0, protected: 0, revision: 0, notInDb: 0, noProfile: 0, notInProfile: 0, partsTouched: 0 };
const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];

for (const [sku, add] of incoming) {
  const part = await P.findOne({ sku }, { projection: { _id: 0, sku: 1, category: 1, specs_v2: 1 } });
  if (!part) { merge.notInDb++; continue; }
  const cat = String(part.category || "");
  if (!PROFILES[cat]) { merge.noProfile++; continue; }
  const existing: SpecEntry[] = (part.specs_v2 as SpecEntry[]) || [];
  const byKey = new Map(existing.map((s) => [s.k, s]));
  let touched = false;
  for (const e of add) {
    if (!PROFILES[cat][e.k]) { merge.notInProfile++; continue; }
    const r = mergeField(sku, byKey.get(e.k), e);
    switch (r.action) {
      case "insert": merge.insert++; byKey.set(e.k, r.entry); touched = true; break;
      case "corroborate": merge.corroborate++; byKey.set(e.k, r.entry); touched = true; break;
      case "revision_change": merge.revision++; byKey.set(e.k, r.entry); touched = true; break;
      case "protected": merge.protected++; break;
      case "conflict": merge.conflict++; byKey.set(e.k, r.entry); touched = true; break;
      default: merge.skip++;
    }
  }
  if (!touched) continue;
  merge.partsTouched++;
  const merged = [...byKey.values()];
  const values: Record<string, unknown> = {};
  for (const s of merged) if (s.state === "verified" || s.state === "corroborated") values[s.k] = s.value;
  const c = completenessV2(cat, values);
  if (COMMIT) {
    ops.push({ updateOne: { filter: { sku }, update: { $set: { specs_v2: merged,
      completeness_v2: { required_total: c.required_total, required_present: c.required_present, pct: c.pct, missing: c.missing, no_profile: c.no_profile, computed_at: day } } } } });
    if (ops.length >= 400) await P.bulkWrite(ops.splice(0), { ordered: false });
  }
}
if (COMMIT && ops.length) await P.bulkWrite(ops, { ordered: false });
await client.close();

console.log(COMMIT ? "COMMIT" : "DRY RUN", "— LLM tier-2 specs from", sheets.length, "datasheets");
console.log(`raw specs ${stats.rawSpecs} | normalised OK ${stats.normOk} | rejected ${stats.rejected}`, stats.rejectReasons);
if (rejectSamples.length) console.log("reject samples:", rejectSamples.slice(0, 8).join(" · "));
console.log("merge:", merge);
