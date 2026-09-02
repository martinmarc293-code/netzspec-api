// scripts/universe/apply-specs-v2.ts — WP5 / roadmap step 3. The merge engine wired to Mongo.
//
//   npx tsx scripts/universe/apply-specs-v2.ts <extract.json>            dry run (default)
//   npx tsx scripts/universe/apply-specs-v2.ts <extract.json> --commit   write
//   npx tsx scripts/universe/apply-specs-v2.ts <extract.json> --sku PID  explain one SKU
//
// Writes datasheet-derived specs at TIER 1 through lib/specMerge, so by construction:
//   - operator-reviewed (tier 0) values are physically unwritable by this path; a differing
//     extraction is recorded in spec_conflicts and the stored value is left alone,
//   - disagreements are HELD in state "conflict" and logged, never resolved by write order,
//   - agreement between two independent tier<=2 sources upgrades a field to "corroborated",
//   - family-level facts are inherited ONLY through canInherit()'s scope check.
//
// STOP condition 2 applies: run scripts/universe/harness-cisco-specs.ts first. A bulk run behind
// a failing precision gate is exactly the thing the gate exists to prevent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import { completenessV2, PROFILES } from "../../lib/fieldSchema.js";
import { mapFact, loadExtract, type RawFact } from "../../lib/deepSpecMap.js";
import { mergeField, canInherit, inheritedEntry, INHERIT_CLASS_B, type SpecEntry } from "../../lib/specMerge.js";

const file = process.argv[2];
if (!file) { console.error("usage: apply-specs-v2.ts <extract.json> [--commit] [--sku PID]"); process.exit(2); }
const COMMIT = process.argv.includes("--commit");
const si = process.argv.indexOf("--sku");
const ONLY = si >= 0 ? process.argv[si + 1] : null;

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const docIdFor = (url: string) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
const PID_IN_TEXT = /\b((?:C1-)?(?:C\d{3,4}[A-Z]{0,3}|WS-C\d{3,4}[A-Z]?)-[0-9A-Z][0-9A-Z-]*)\b/g;

const stats = {
  facts: 0, skuScoped: 0, familyScoped: 0, unmapped: 0, sentinel: 0, rejected: 0,
  insert: 0, corroborate: 0, skip: 0, conflict: 0, protectedTier0: 0, revision: 0,
  inheritOk: 0, inheritClassB: 0, inheritScopeUnresolved: 0, inheritScopeViolation: 0,
  partsTouched: 0, notInDb: 0,
  reasons: {} as Record<string, number>,
};
const bump = (r: string) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };

type Conflict = { sku: string; k: string; kept: unknown; rejected: unknown; reason: string;
  kept_prov: unknown; rejected_prov: unknown; logged_at: string };

async function main() {
  const { docs, facts } = loadExtract(file);
  const day = new Date().toISOString().slice(0, 10);

  // Every fact used to be normalised as if it were a SWITCH, because mapFact's category
  // parameter defaults to "switches" and nothing passed one. The category is not cosmetic: it
  // selects UNIT_OVERRIDES and DOMAIN_OVERRIDES, so a transceiver's form_factor was checked
  // against the switch domain (rack-19, desktop, din-rail, modular-chassis) and every real
  // optic value — sfp, qsfp28, x2 — was rejected ENUM_VIOLATION. Its weight canonicalised to
  // kg rather than g for the same reason.
  //
  // So load sku -> category up front, one pass, before any mapping happens.
  const catClient = new MongoClient(env.MONGODB_URI as string);
  await catClient.connect();
  const catOfSku = new Map<string, string>();
  for await (const p of catClient.db(env.MONGODB_DB || "netzspec").collection("parts")
    .find({}, { projection: { _id: 0, sku: 1, category: 1 } })) {
    if (p.sku && p.category) catOfSku.set(String(p.sku), String(p.category));
  }
  await catClient.close();
  console.log(`sku->category loaded: ${catOfSku.size}`);
  // A family-scoped fact has no SKU of its own, so it takes the majority category of the
  // document's own PID list rather than silently falling back to "switches".
  const catOfDoc = new Map<string, string>();
  for (const d of docs) {
    const tally = new Map<string, number>();
    for (const pid of d.pid_list || []) {
      const c = catOfSku.get(pid);
      if (c) tally.set(c, (tally.get(c) || 0) + 1);
    }
    let best = "switches", bestN = 0;
    for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
    catOfDoc.set(d.source_url, best);
  }

  // document registry: doc_id -> url + its own PID enumeration (the inheritance scope set)
  const docByUrl = new Map<string, { doc_id: string; url: string; doc_type: string;
    fetched_at: string; pid_list: string[]; tables?: number }>();
  for (const d of docs) {
    docByUrl.set(d.source_url, {
      doc_id: docIdFor(d.source_url), url: d.source_url,
      doc_type: d.source_url.endsWith(".pdf") ? "vendor_datasheet_pdf" : "vendor_datasheet_html",
      fetched_at: day, pid_list: d.pid_list || [], tables: d.tables,
    });
  }

  // ---- build the per-SKU incoming set -----------------------------------------------------------
  const incoming = new Map<string, SpecEntry[]>();
  const addIncoming = (sku: string, e: SpecEntry) => {
    const arr = incoming.get(sku) || [];
    if (!arr.some((x) => x.k === e.k)) arr.push(e);   // first value from this run wins per field
    incoming.set(sku, arr);
  };

  for (const f of facts as RawFact[]) {
    stats.facts++;
    const m = mapFact(f, (f.sku && catOfSku.get(f.sku)) || catOfDoc.get(f.source_url) || "switches");
    if (m.kind === "unmapped") { stats.unmapped++; continue; }
    if (m.kind === "sentinel") { stats.sentinel++; continue; }
    if (m.kind === "rejected") { stats.rejected++; bump(m.reason); continue; }

    const doc = docByUrl.get(f.source_url);
    const prov = { tier: 1, method: "html_table", doc_id: doc?.doc_id,
      locator: m.locator, extracted_at: day, norm_v: "1.0.0" };

    if (f.sku) {
      stats.skuScoped++;
      addIncoming(f.sku, { k: m.key, raw: m.raw, value: m.value, unit: m.unit, state: "verified", prov });
      continue;
    }

    // ---- family-scoped: only through the scope check ---------------------------------------------
    stats.familyScoped++;
    if (INHERIT_CLASS_B.has(m.key)) { stats.inheritClassB++; continue; }

    const scopeLabel = f.family_scope || "";
    let scopePids: string[] | undefined;
    if (scopeLabel === "__document__") {
      scopePids = undefined;                       // whole document; canInherit checks the PID list
    } else {
      const found = [...scopeLabel.matchAll(PID_IN_TEXT)].map((x) => x[1]);
      if (found.length) scopePids = found;
      else {
        // "48-port models (1/10G uplinks)" names a group, not part numbers. Resolving it would
        // mean inferring membership from the PID's name — exactly the prefix-matching Q5 forbids,
        // and the mechanism behind the family-level EoL date that wrongly aged an active 9300.
        // Refused, counted, and reported rather than guessed.
        stats.inheritScopeUnresolved++;
        continue;
      }
    }

    const pidList = doc?.pid_list || [];
    for (const sku of pidList) {
      const chk = canInherit({ fieldKey: m.key, sku, docPidList: pidList,
        hasPerSkuException: (incoming.get(sku) || []).some((e) => e.k === m.key),
        scopeLabel, scopePids });
      if (!chk.ok) { stats.inheritScopeViolation++; continue; }
      stats.inheritOk++;
      addIncoming(sku, inheritedEntry(
        { k: m.key, raw: m.raw, value: m.value, unit: m.unit, state: "verified", prov },
        scopeLabel === "__document__" ? (doc?.url.split("/").slice(-2)[0] || "document") : scopeLabel));
    }
  }

  // ---- merge against what is already stored ------------------------------------------------------
  const client = new MongoClient(env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true,
  });
  await client.connect();
  const db = client.db(env.MONGODB_DB as string);
  const P: Collection = db.collection("parts");

  const conflicts: Conflict[] = [];
  const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
  const plan: string[] = [];

  const skus = ONLY ? [ONLY] : [...incoming.keys()];
  for (const sku of skus) {
    const add = incoming.get(sku) || [];
    if (!add.length) continue;
    const part = await P.findOne({ sku }, { projection: { _id: 0, sku: 1, category: 1, specs_v2: 1 } });
    if (!part) { stats.notInDb++; continue; }
    const cat = String(part.category || "");
    if (!PROFILES[cat]) continue;

    const existing: SpecEntry[] = (part.specs_v2 as SpecEntry[]) || [];
    const byKey = new Map(existing.map((s) => [s.k, s]));

    for (const e of add) {
      if (!PROFILES[cat][e.k]) continue;              // not in this category's profile
      const r = mergeField(sku, byKey.get(e.k), e);
      if (r.conflict) {
        conflicts.push({ ...r.conflict, logged_at: day } as Conflict);
      }
      switch (r.action) {
        case "insert": stats.insert++; byKey.set(e.k, r.entry); break;
        case "corroborate": stats.corroborate++; byKey.set(e.k, r.entry); break;
        case "revision_change": stats.revision++; byKey.set(e.k, r.entry); break;
        case "protected": stats.protectedTier0++; break;
        case "conflict": stats.conflict++; byKey.set(e.k, r.entry); break;
        default: stats.skip++;
      }
      if (ONLY) {
        plan.push(`  ${r.action.padEnd(16)} ${e.k.padEnd(20)} ${JSON.stringify(e.value)}` +
          `${e.unit ? " " + e.unit : ""}${e.inherited ? `  [inherited from ${e.inherited_from}]` : ""}` +
          (r.conflict ? `   CONFLICT: ${r.conflict.reason}` : ""));
      }
    }

    const merged = [...byKey.values()];
    const values: Record<string, unknown> = {};
    for (const s of merged) if (s.state === "verified" || s.state === "corroborated") values[s.k] = s.value;
    const c = completenessV2(cat, values);
    stats.partsTouched++;
    if (COMMIT) {
      ops.push({ updateOne: { filter: { sku },
        update: { $set: { specs_v2: merged, completeness_v2: {
          required_total: c.required_total, required_present: c.required_present, pct: c.pct,
          missing: c.missing, no_profile: c.no_profile, computed_at: day } } } } });
      if (ops.length >= 400) await P.bulkWrite(ops.splice(0), { ordered: false });
    }
  }
  if (COMMIT && ops.length) await P.bulkWrite(ops, { ordered: false });

  if (COMMIT) {
    if (docByUrl.size) {
      await db.collection("source_docs").bulkWrite([...docByUrl.values()].map((d) => ({
        updateOne: { filter: { doc_id: d.doc_id }, update: { $set: d }, upsert: true },
      })), { ordered: false });
    }
    if (conflicts.length) await db.collection("spec_conflicts").insertMany(conflicts as never[]);
  }
  await client.close();

  // ---- report --------------------------------------------------------------------------------------
  if (ONLY) {
    console.log(`\n=== ${ONLY} — action plan (${plan.length} fields) ===`);
    for (const l of plan) console.log(l);
  }
  console.log(`\n${COMMIT ? "COMMITTED" : "DRY RUN — no writes"}   source: ${path.basename(file)}`);
  console.log(`raw facts ${stats.facts} | sku-scoped ${stats.skuScoped} | family-scoped ${stats.familyScoped}` +
    ` | unmapped ${stats.unmapped} | sentinel ${stats.sentinel} | rejected ${stats.rejected}`);
  console.log(`normalise rejections: ${JSON.stringify(stats.reasons)}`);
  console.log(`\ninheritance:`);
  console.log(`  applied .................. ${stats.inheritOk}`);
  console.log(`  refused, class B ......... ${stats.inheritClassB}  (per-SKU source mandatory)`);
  console.log(`  refused, scope unresolved  ${stats.inheritScopeUnresolved}  (group label like "48-port models" — never inferred from a PID prefix)`);
  console.log(`  refused, scope violation . ${stats.inheritScopeViolation}  (SKU not in the document's PID list)`);
  console.log(`\nmerge actions:`);
  console.log(`  insert ................... ${stats.insert}`);
  console.log(`  corroborate .............. ${stats.corroborate}`);
  console.log(`  conflict (field HELD) .... ${stats.conflict}`);
  console.log(`  protected (tier-0 kept) .. ${stats.protectedTier0}`);
  console.log(`  revision change .......... ${stats.revision}`);
  console.log(`  skipped (lower tier) ..... ${stats.skip}`);
  console.log(`\nparts touched ${stats.partsTouched} | extractor SKUs not in the DB ${stats.notInDb}`);
  console.log(`spec_conflicts rows ${COMMIT ? "written" : "that would be written"}: ${conflicts.length}`);
  for (const c of conflicts.slice(0, 3)) {
    console.log(`  ${c.sku} ${c.k}: kept ${JSON.stringify(c.kept)} / rejected ${JSON.stringify(c.rejected)} — ${c.reason}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
