// src/pipeline/apply-enumeration.ts — every enumerated Cisco PID becomes a part, inside one run.
//
//   ingest apply-enumeration data/reference/cisco-pid-universe.json [--commit] [--sample N]
//   ingest apply-enumeration data/reference/cisco-enumeration-full.json [--commit]
//
// WHY. apply-extract maps a fact only when its SKU is a part row (the category comes from the
// part), so on a thin catalogue every PID a datasheet lists is "unknown" and its facts are lost.
// The enumeration files are the catalogue: 4,569 documents naming 69,487 PIDs (the universe),
// 86,869 records with a category and a family each (the full enumeration). This command turns
// them into identity rows — nothing more — so the fact pipeline has somewhere to land.
//
// Rules this module enforces:
//   * EXISTING PARTS ARE NEVER MODIFIED. Not filled, not re-slugged, not re-classed. The insert is
//     ON CONFLICT (vendor_id, sku) DO NOTHING, and a PID whose upper-cased form already exists is
//     counted `existing` before the insert is even attempted. HexCat's operator-reviewed rows
//     (review_tier 0) are the reason: an enumeration knows less than a datasheet.
//   * A token that is not a part number is REFUSED, by the same rules the scrapers use
//     (src/pipeline/partNumber.ts, lockstep-tested against scraper/sources/base.py). "0.125K",
//     "0-23", "2.4GHz" and "10GbE" are all in cisco-enumeration-full.json as SKUs.
//   * A category the categories table does not know is LISTED, never guessed. The PID is not
//     created; the raw category (or "(none)") and a count land in the stats and the report. The
//     legacy script defaulted everything unknown to "switches" — which is how licences got a
//     switch profile.
//   * Vendor is always cisco. Meraki records (vendor "meraki" in the full enumeration) are Cisco
//     PIDs in the "meraki" category and are folded, counted. Any other vendor value is refused.
//   * product_class comes from src/core/productClass.ts (the docs/DATA_MODEL.md table), with the
//     category's is_hardware, so a licence in a hardware category is still a licence.
//   * One run, kind apply-enumeration, dry by default. The kind starts with "apply-", so
//     src/store/runs.ts refuses to close it as succeeded without a passing gate; the gate here is
//     real, not decorative:
//       precision  a random sample of the parts CREATED in this run is re-read from the database
//                  and compared field by field with the input (sku exact, category, family,
//                  datasheet_url, first_seen_source, product_class), and — where the document is
//                  in the scraper cache as HTML — the PID must appear in the page text. A created
//                  part that could be checked no way at all is a miss, not a pass.
//       recall     every PID the run decided to create exists as a part afterwards.
//     passed = precision >= 0.98 and recall = 1. A failing gate closes the run FAILED and the
//     command exits 1; what was inserted stays traceable to that failed run id.
//   * A PID named by two documents is created once, from the first document in file order; the
//     second is counted `duplicate_in_file`, never silently merged.
//
// Decisions are pure functions (loadEnumeration, mapCategory, decide, planSlugs, auditSample,
// pidOnCachedPage) so tests/db/apply-enumeration.test.ts can sabotage each one; main() threads
// them through the database.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withTx, withRun, hashFile, slugify, type Queryable } from "../store/index.js";
import { classify, type ProductClass } from "../core/productClass.js";
import { isPartNumber } from "./partNumber.js";
import { REPO_ROOT, loadEnv } from "../config.js";

export type EnumRecord = {
  sku: string;
  vendor: string;                 // as the file says it; "cisco" or "meraki" are accepted
  category: string | null;        // raw category from the file, before mapping
  family: string | null;
  url: string | null;             // the document that named the PID
};

export type Enumeration = {
  shape: "universe" | "records";
  records: EnumRecord[];
  /** YYYY-MM-DD the file was generated, or null when it does not say */
  generated: string | null;
  /** PIDs named by more than one document / record; the first occurrence is kept */
  duplicate_in_file: number;
};

/**
 * Both reference shapes, read into one list. The universe is per document ({documents: {url:
 * {pids, category, series_name}}}); the full enumeration is per record ({records: [{sku, vendor,
 * category, product_family, datasheet_url}]}). A file that is neither is refused, naming it.
 */
export function loadEnumeration(file: string): Enumeration {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const seen = new Set<string>();
  const records: EnumRecord[] = [];
  let duplicate_in_file = 0;
  const push = (r: EnumRecord) => {
    const k = r.sku;
    if (seen.has(k)) { duplicate_in_file++; return; }
    seen.add(k);
    records.push(r);
  };
  if (raw.documents && typeof raw.documents === "object") {
    for (const [url, d] of Object.entries(raw.documents as Record<string, Record<string, unknown>>)) {
      const pids = Array.isArray(d.pids) ? (d.pids as unknown[]) : [];
      for (const p of pids) {
        push({ sku: String(p ?? ""), vendor: "cisco", category: typeof d.category === "string" ? d.category : null,
          family: typeof d.series_name === "string" && d.series_name ? d.series_name : null, url });
      }
    }
    const g = typeof raw.generated === "string" ? raw.generated.slice(0, 10) : null;
    return { shape: "universe", records, generated: g, duplicate_in_file };
  }
  if (Array.isArray(raw.records)) {
    for (const r of raw.records as Record<string, unknown>[]) {
      push({ sku: String(r.sku ?? ""), vendor: String(r.vendor ?? "cisco"), category: typeof r.category === "string" ? r.category : null,
        family: typeof r.product_family === "string" && r.product_family ? r.product_family : null,
        url: typeof r.datasheet_url === "string" && r.datasheet_url ? r.datasheet_url : null });
    }
    const g = typeof raw.generated_at === "string" ? raw.generated_at.slice(0, 10) : null;
    return { shape: "records", records, generated: g, duplicate_in_file };
  }
  throw new Error(`${file}: neither a PID universe ({documents}) nor an enumeration ({records})`);
}

/** Spellings the older enumerations used for a categories-table slug. Identity otherwise. */
export const CATEGORY_ALIASES: Record<string, string> = {
  transceivers: "transceiver",
  switch: "switches",
  router: "routers",
  firewall: "security",
  "access-point": "wireless",
  optical: "optical-networking",
  storage: "storage-networking",
  server: "servers-unified-computing",
};

/** The categories-table slug for a raw enumeration category, or null when nothing maps. */
export function mapCategory(raw: string | null | undefined, known: Set<string>): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (known.has(s)) return s;
  const a = CATEGORY_ALIASES[s];
  return a && known.has(a) ? a : null;
}

export type CategoryRow = { id: number; slug: string; is_hardware: boolean };

export type NewPart = {
  sku: string;
  category: string;
  category_id: number;
  family: string | null;
  product_class: ProductClass;
  product_class_reason: string;
  datasheet_url: string | null;
  slug?: string;
};

export type Listed = { count: number; examples: string[] };

export type Plan = {
  toCreate: NewPart[];
  stats: {
    records: number; duplicate_in_file: number; new: number; existing: number; existing_case_variant: number;
    vendor_folded_meraki: number; refused_total: number; category_unmapped_total: number;
    by_category: Record<string, number>; by_class: Record<string, number>;
  };
  refused: Record<string, Listed>;            // reason -> count + example tokens
  category_unmapped: Record<string, Listed>;  // raw category (or "(none)") -> count + example PIDs
};

const listed = (map: Record<string, Listed>, key: string, example: string, cap = 50) => {
  const row = map[key] ?? (map[key] = { count: 0, examples: [] });
  row.count++;
  if (row.examples.length < cap) row.examples.push(example);
};

/**
 * Every record gets exactly one decision: refused (with the part-number reason), vendor refused,
 * category unmapped (listed), existing, or new. Pure: the existing set and the categories are
 * handed in.
 */
export function decide(
  en: Enumeration,
  ctx: { existingSkuNorm: Set<string>; existingSkuExact: Set<string>; categories: Map<string, CategoryRow> },
): Plan {
  const known = new Set(ctx.categories.keys());
  const plan: Plan = {
    toCreate: [],
    stats: { records: en.records.length, duplicate_in_file: en.duplicate_in_file, new: 0, existing: 0, existing_case_variant: 0,
      vendor_folded_meraki: 0, refused_total: 0, category_unmapped_total: 0, by_category: {}, by_class: {} },
    refused: {}, category_unmapped: {},
  };
  for (const r of en.records) {
    const v = r.vendor.trim().toLowerCase();
    if (v === "meraki") plan.stats.vendor_folded_meraki++;
    else if (v !== "cisco") { plan.stats.refused_total++; listed(plan.refused, `vendor:${v || "(none)"}`, r.sku); continue; }
    const pn = isPartNumber(r.sku);
    if (!pn.ok) { plan.stats.refused_total++; listed(plan.refused, pn.reason, r.sku); continue; }
    const sku = r.sku.trim();
    if (ctx.existingSkuExact.has(sku)) { plan.stats.existing++; continue; }
    if (ctx.existingSkuNorm.has(sku.toUpperCase())) { plan.stats.existing++; plan.stats.existing_case_variant++; continue; }
    const cat = mapCategory(r.category, known);
    if (!cat) { plan.stats.category_unmapped_total++; listed(plan.category_unmapped, r.category ? String(r.category) : "(none)", sku); continue; }
    const c = ctx.categories.get(cat)!;
    const k = classify({ sku, categorySlug: cat, categoryIsHardware: c.is_hardware });
    plan.toCreate.push({ sku, category: cat, category_id: c.id, family: r.family, product_class: k.klass,
      product_class_reason: k.reason, datasheet_url: r.url });
    plan.stats.new++;
    plan.stats.by_category[cat] = (plan.stats.by_category[cat] ?? 0) + 1;
    plan.stats.by_class[k.klass] = (plan.stats.by_class[k.klass] ?? 0) + 1;
  }
  return plan;
}

/** Slugs unique per vendor, decided in memory: base, base-2, base-3 … against what is taken. */
export function planSlugs(parts: NewPart[], takenSlugs: Set<string>): void {
  const taken = new Set(takenSlugs);
  for (const p of parts) {
    const base = slugify(p.sku);
    let s = base;
    for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
    taken.add(s);
    p.slug = s;
  }
}

/**
 * Batched insert. ON CONFLICT (vendor_id, sku) DO NOTHING is the structural guarantee that an
 * existing part is untouched; a slug collision (UNIQUE (vendor_id, slug)) is an error, because
 * planSlugs already avoided every slug it was told about and a new one means the plan is stale.
 */
export async function insertParts(
  db: Queryable, vendorId: number, parts: NewPart[], meta: { firstSeenSource: string; enumeratedAt: string }, chunk = 1000,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < parts.length; i += chunk) {
    const b = parts.slice(i, i + chunk);
    const r = await db.query(
      `INSERT INTO parts (vendor_id, sku, slug, category_id, family, product_class, product_class_reason, datasheet_url, first_seen_source, enumerated_at)
       SELECT $1, t.sku, t.slug, t.category_id, t.family, t.product_class::product_class, t.reason, t.url, $2, $3::date
         FROM unnest($4::text[], $5::text[], $6::smallint[], $7::text[], $8::text[], $9::text[], $10::text[])
              AS t(sku, slug, category_id, family, product_class, reason, url)
       ON CONFLICT (vendor_id, sku) DO NOTHING`,
      [vendorId, meta.firstSeenSource, meta.enumeratedAt,
        b.map((p) => p.sku), b.map((p) => p.slug ?? slugify(p.sku)), b.map((p) => p.category_id), b.map((p) => p.family),
        b.map((p) => p.product_class), b.map((p) => p.product_class_reason), b.map((p) => p.datasheet_url)],
    );
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

export type StoredPart = { sku: string; category: string; family: string | null; datasheet_url: string | null; first_seen_source: string | null; product_class: string };

/** The re-read half of precision: what the database holds versus what the plan said. Pure. */
export function auditSample(
  planned: NewPart[], stored: Map<string, StoredPart>, firstSeenSource: string,
): { hits: number; checked: number; misses: string[] } {
  let hits = 0;
  const misses: string[] = [];
  for (const p of planned) {
    const s = stored.get(p.sku);
    const why = !s ? "not stored"
      : s.category !== p.category ? `category ${s.category} != ${p.category}`
      : (s.family ?? null) !== (p.family ?? null) ? `family ${s.family} != ${p.family}`
      : (s.datasheet_url ?? null) !== (p.datasheet_url ?? null) ? "datasheet_url differs"
      : s.first_seen_source !== firstSeenSource ? `first_seen_source ${s.first_seen_source} != ${firstSeenSource}`
      : s.product_class !== p.product_class ? `product_class ${s.product_class} != ${p.product_class}`
      : null;
    if (why) { if (misses.length < 20) misses.push(`${p.sku}: ${why}`); } else hits++;
  }
  return { hits, checked: planned.length, misses };
}

export const CACHE_DIR = loadEnv().CACHE_DIR;
const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

/**
 * The cache half of precision: true/false when the document is cached as HTML (netzscrape._key =
 * sha1(url) + ".html") and the PID is / is not in its text; null when it cannot be checked (not
 * cached, or a PDF — a .bin is not searchable as text and is not pretended to be).
 */
export function pidOnCachedPage(url: string | null, sku: string, cacheDir: string = CACHE_DIR): boolean | null {
  if (!url) return null;
  const f = path.join(cacheDir, `${sha1(url)}.html`);
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").toUpperCase();
  const pid = sku.toUpperCase();
  return text.includes(pid) || (pid.endsWith("=") && text.includes(pid.replace(/=+$/, "")));
}

export type Gate = {
  precision: number; recall: number; passed: boolean;
  sampled: number; db_checked: number; cache_checked: number; cache_unchecked: number;
  expected: number; found: number; misses: string[];
};

export function computeGate(
  audit: { hits: number; checked: number; misses: string[] },
  cache: { hits: number; checked: number; unchecked: number; misses: string[] },
  recall: { expected: number; found: number },
  created: number,
): Gate {
  const checked = audit.checked + cache.checked;
  const hits = audit.hits + cache.hits;
  const precision = checked ? Number((hits / checked).toFixed(4)) : (created ? 0 : 1);
  const rec = recall.expected ? Number((recall.found / recall.expected).toFixed(4)) : 1;
  return {
    precision, recall: rec, passed: precision >= 0.98 && rec === 1,
    sampled: Math.max(audit.checked, cache.checked + cache.unchecked), db_checked: audit.checked,
    cache_checked: cache.checked, cache_unchecked: cache.unchecked,
    expected: recall.expected, found: recall.found, misses: [...audit.misses, ...cache.misses].slice(0, 20),
  };
}

export type Args = { file: string | null; commit: boolean; sample: number };

export function parseArgs(argv: string[]): Args {
  const out: Args = { file: null, commit: false, sample: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else if (!out.file) out.file = a;
    else throw new Error(`unexpected argument ${a}: one enumeration file per run`);
  }
  return out;
}

function shuffle<T>(xs: T[]): T[] { return [...xs].sort(() => 0.5 - Math.random()); }

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.file) throw new Error("usage: ingest apply-enumeration <cisco-pid-universe.json|cisco-enumeration-full.json> [--commit] [--sample N]");
  const file = path.isAbsolute(a.file) ? a.file : path.join(REPO_ROOT, a.file);
  if (!fs.existsSync(file)) throw new Error(`no such file: ${a.file}`);
  const en = loadEnumeration(file);
  const today = new Date().toISOString().slice(0, 10);
  const enumeratedAt = en.generated ?? today;
  const firstSeenSource = `cisco-catalog-${enumeratedAt.slice(0, 4)}`;

  const pool = getPool();
  const vendorRow = (await pool.query<{ id: number }>("SELECT id FROM vendors WHERE slug = 'cisco'")).rows[0];
  if (!vendorRow) throw new Error("vendor cisco is not seeded (db/migrations/0002_seed.sql)");
  const vendorId = vendorRow.id;
  const categories = new Map((await pool.query<CategoryRow>("SELECT id, slug, is_hardware FROM categories")).rows.map((r) => [r.slug, r]));
  const existing = (await pool.query<{ sku: string; sku_norm: string; slug: string }>("SELECT sku, sku_norm, slug FROM parts WHERE vendor_id = $1", [vendorId])).rows;
  const plan = decide(en, {
    existingSkuExact: new Set(existing.map((r) => r.sku)),
    existingSkuNorm: new Set(existing.map((r) => r.sku_norm)),
    categories,
  });
  planSlugs(plan.toCreate, new Set(existing.map((r) => r.slug)));

  const runInputs = { file: hashFile(file), shape: en.shape, generated: en.generated, first_seen_source: firstSeenSource, commit: a.commit, sample: a.sample };
  const sample = shuffle(plan.toCreate).slice(0, a.sample);

  // the cache half of precision is the same in a dry run and a commit: it reads only the file
  const cache = { hits: 0, checked: 0, unchecked: 0, misses: [] as string[] };
  for (const p of sample) {
    const on = pidOnCachedPage(p.datasheet_url, p.sku);
    if (on === null) cache.unchecked++;
    else { cache.checked++; if (on) cache.hits++; else if (cache.misses.length < 20) cache.misses.push(`${p.sku}: not in cached ${p.datasheet_url}`); }
  }

  // The gate proper needs written rows to re-read, so it exists only on --commit. A dry run
  // reports the cache half on its own, labelled as such — never as a gate that passed.
  const body = async (runId: number) => {
    const inserted = await withTx((client) => insertParts(client, vendorId, plan.toCreate, { firstSeenSource, enumeratedAt }));
    const stored = new Map((await pool.query<StoredPart>(
      `SELECT p.sku, c.slug AS category, p.family, p.datasheet_url, p.first_seen_source, p.product_class::text AS product_class
         FROM parts p JOIN categories c ON c.id = p.category_id WHERE p.vendor_id = $1 AND p.sku = ANY($2::text[])`,
      [vendorId, sample.map((p) => p.sku)])).rows.map((r) => [r.sku, r]));
    const audit = auditSample(sample, stored, firstSeenSource);
    const found = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM parts WHERE vendor_id = $1 AND sku = ANY($2::text[])",
      [vendorId, plan.toCreate.map((p) => p.sku)]);
    const gate = computeGate(audit, cache, { expected: plan.toCreate.length, found: found.rows[0].n }, inserted);
    return { stats: { ...planStats, inserted }, gate, notes: `${en.shape} ${path.relative(REPO_ROOT, file)}; enumerated_at ${enumeratedAt}; run ${runId}` };
  };
  const planStats = { ...plan.stats, refused: Object.fromEntries(Object.entries(plan.refused).map(([k, v]) => [k, v.count])),
    category_unmapped: Object.fromEntries(Object.entries(plan.category_unmapped).map(([k, v]) => [k, v.count])) };

  let out: { stats: Record<string, unknown>; gate: Gate | null; runId: number | null };
  if (a.commit) out = await withRun("apply-enumeration", runInputs, body);
  else out = { stats: { ...planStats, inserted: 0 }, gate: null, runId: null };

  const outDir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const report = path.join(outDir, `apply-enumeration-${today}.json`);
  fs.writeFileSync(report, JSON.stringify({ generated_at: new Date().toISOString(), file: path.relative(REPO_ROOT, file), commit: a.commit, run_id: out.runId,
    stats: out.stats, gate: out.gate, cache_audit: { sampled: sample.length, ...cache }, refused: plan.refused, category_unmapped: plan.category_unmapped }, null, 1));

  console.log(`${a.commit ? "COMMITTED run " + out.runId : "DRY RUN"} — ${en.shape} ${path.relative(REPO_ROOT, file)} (${firstSeenSource})`);
  console.table({ ...plan.stats, by_category: undefined, by_class: undefined, inserted: out.stats.inserted });
  console.log("by category:", plan.stats.by_category);
  console.log("by class:", plan.stats.by_class);
  console.log("refused by reason:", Object.fromEntries(Object.entries(plan.refused).map(([k, v]) => [k, `${v.count} e.g. ${v.examples.slice(0, 4).join(", ")}`])));
  console.log("category unmapped (listed, NOT created):", Object.fromEntries(Object.entries(plan.category_unmapped).map(([k, v]) => [k, `${v.count} e.g. ${v.examples.slice(0, 4).join(", ")}`])));
  if (out.gate) console.log(`gate: ${JSON.stringify(out.gate)}`);
  else console.log(`dry run — cache audit only: ${cache.hits}/${cache.checked} sampled PIDs found on their cached page, ${cache.unchecked} not checkable (not cached or PDF); the gate is evaluated on --commit${cache.misses.length ? "; misses: " + cache.misses.join("; ") : ""}`);
  console.log(`report -> ${path.relative(REPO_ROOT, report)}`);
  await closePool();
  if (a.commit && !out.gate?.passed) process.exitCode = 1;
}

if (process.argv[1] && /apply-enumeration\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
