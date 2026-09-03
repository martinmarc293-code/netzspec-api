// src/pipeline/apply-acquired.ts — acquired page results -> facts, inside a gated run.
//
//   ingest apply-acquired runs/acquired/provantage/2026-09-03 [more dirs or files] [--commit] [--vendor cisco] [--sample 60]
//
// The worker (scraper/worker.py) leaves one JSON per fetched page under runs/acquired/. Each
// holds RAW label/value strings. This command is where meaning is decided, and only here:
//   label -> field key        src/core/deepSpecMap.ts (alias rules in data/schema)
//   string -> typed value     src/core/specNormalize.ts (refuses rather than guesses)
//   value vs existing value   src/core/specMerge.ts through src/store/facts.ts (tiers, conflicts)
//
// A fact from an aggregator or distributor (tier 3/4) lands as `unverified`; it can corroborate a
// vendor fact or fill a labelled gap, never establish a verified one (docs/ARCHITECTURE.md).
//
// THE GATE. A run that writes facts must carry a passing gate (src/store/runs.ts refuses to close
// it otherwise). For acquired pages the gate has two halves:
//   recall     the source's adapter suite (tests/scraper/test_<source>.py) is run fresh; it asserts
//              exact label/value pairs on the fixtures, so a broken adapter cannot land data;
//   precision  a random sample of the facts written in THIS run is re-read from the cached page:
//              the raw value string and the label must both be present in the page text.
// Both are reported; passed = precision >= 0.98 and the suite is green.
//
// Two files come out of every run besides the database: the UNMAPPED labels with sample values
// (the input to the alias-proposal loop) and the UNKNOWN SKUs the pages named (the enumeration
// feed: a distributor listing a part number we do not have is how the catalogue grows).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  getPool, closePool, withTx, withRun, hashFile, findPart, getPart, ensureSourceDoc, docIdFor, linkDocParts,
  applyMerge, upsertAlias, upsertImage, upsertRelation, upsertLifecycle, recordSourceCheck,
  type RelationKind, type AliasKind, type CheckOutcome,
} from "../store/index.js";
import { mapFact } from "../core/deepSpecMap.js";
import { NORM_VERSION } from "../core/specNormalize.js";
import type { SpecEntry } from "../core/specMerge.js";
import { REPO_ROOT } from "../config.js";

type RawPair = { label: string; value: string; locator?: string };
type Result = {
  sku?: string; not_listed?: boolean; scope?: string; name?: string;
  facts?: RawPair[];
  aliases?: { kind: string; value: string }[];
  images?: { url: string; role?: string; alt?: string }[];
  relations?: { kind: string; sku: string; note?: string }[];
  lifecycle?: Record<string, string | null> | null;
  price?: Record<string, unknown> | null;
  others?: Result[];
};
type Acquired = {
  source: string; task: { id: number; task: string; key: string; part_id: number | null };
  url: string; final_url?: string; fetched_at: string; fetch_id?: number | null; cache_path?: string | null;
  result: Result;
};

const RELATION_KINDS = new Set<string>(["successor", "predecessor", "compatible", "module_of", "hosts_module", "supports_transceiver", "bundle_contains", "license_for", "accessory_for", "equivalent"]);
const ALIAS_KINDS = new Set<string>(["gtin", "upc", "ean", "legacy_sku", "variant_sku", "vendor_alias", "distributor_sku"]);
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function args(argv: string[]) {
  const out: { paths: string[]; commit: boolean; vendor: string | null; sample: number } = { paths: [], commit: false, vendor: null, sample: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--vendor") out.vendor = argv[++i];
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else out.paths.push(a);
  }
  return out;
}

function collect(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
    if (!fs.existsSync(abs)) throw new Error(`no such path: ${p}`);
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const f = path.join(abs, e.name);
        if (e.isDirectory()) files.push(...collect([f]));
        else if (e.name.endsWith(".json")) files.push(f);
      }
    } else files.push(abs);
  }
  return files.sort();
}

const normSku = (s: string) => s.toUpperCase().replace(/[+=\s]/g, "");
const ws = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function cachedText(cachePath: string | null | undefined): string | null {
  if (!cachePath) return null;
  const f = path.join(REPO_ROOT, "scraper", "cache", cachePath);
  if (!fs.existsSync(f)) return null;
  return ws(fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
}

export async function main(argv: string[]): Promise<void> {
  const a = args(argv);
  if (!a.paths.length) throw new Error("usage: ingest apply-acquired <dir|file>... [--commit] [--vendor V] [--sample N]");
  const files = collect(a.paths);
  if (!files.length) throw new Error("no acquired JSON files found");
  const pool = getPool();
  const sources = new Map((await pool.query<{ id: number; slug: string; tier: number; kind: string }>("SELECT id, slug, tier, kind FROM sources")).rows.map((r) => [r.slug, r]));
  const categories = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM categories")).rows.map((r) => [r.id, r.slug]));
  const vendors = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM vendors")).rows.map((r) => [r.id, r.slug]));

  const stats: Record<string, number> = {
    files: files.length, pages: 0, entries: 0, parts_matched: 0, sku_unknown: 0, family_scoped_skipped: 0,
    facts_raw: 0, facts_ok: 0, facts_unmapped: 0, facts_rejected: 0, facts_sentinel: 0,
    insert: 0, corroborate: 0, conflict: 0, protected: 0, revision_change: 0, skip_lower_tier: 0,
    aliases: 0, images: 0, images_skipped_non_vendor: 0, relations: 0, relations_invalid_kind: 0, lifecycle: 0, prices_seen: 0, checks: 0,
  };
  const unmapped = new Map<string, { count: number; samples: string[]; categories: Set<string> }>();
  const rejected = new Map<string, number>();
  const unknownSkus: Record<string, unknown>[] = [];
  const written: { raw: string; label: string; cache: string | null | undefined }[] = [];
  const sourcesTouched = new Set<string>();

  const runInputs = { files: files.length, first: files.slice(0, 5).map((f) => path.relative(REPO_ROOT, f)), hashes: files.slice(0, 200).map((f) => hashFile(f)), commit: a.commit };

  const body = async (runId: number | null) => {
    for (const file of files) {
      let doc: Acquired;
      try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error(`skip ${file}: ${(e as Error).message}`); continue; }
      const src = sources.get(doc.source);
      if (!src) { console.error(`skip ${file}: unknown source ${doc.source}`); continue; }
      sourcesTouched.add(doc.source);
      stats.pages++;
      const res = doc.result || {};
      const anchor = doc.task?.part_id ? await getPart(doc.task.part_id) : null;
      const vendorSlug = anchor ? vendors.get(anchor.vendor_id) ?? null : a.vendor;
      const pageUrl = doc.final_url || doc.url;
      const docType = src.kind === "vendor" ? "vendor_page" : src.kind === "aggregator" ? "aggregator_page" : "distributor_page";
      const fetchedDay = (doc.fetched_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const entries: Result[] = [];
      if (res.sku || (res.facts && res.facts.length)) entries.push(res);
      for (const o of res.others || []) entries.push(o);
      if (res.price) stats.prices_seen++;

      let docId: string | null = null;
      for (const entry of entries) {
        stats.entries++;
        if (entry.scope === "family") { stats.family_scoped_skipped++; continue; }
        const sku = entry.sku || (entry === res ? doc.task?.key : undefined);
        if (!sku) continue;
        let part = anchor && normSku(anchor.sku) === normSku(sku) ? anchor : null;
        if (!part && vendorSlug) part = await findPart(vendorSlug, sku);
        if (!part) {
          stats.sku_unknown++;
          unknownSkus.push({ source: doc.source, vendor: vendorSlug, sku, name: entry.name ?? null, url: pageUrl, facts: (entry.facts || []).length });
          continue;
        }
        stats.parts_matched++;
        const category = categories.get(part.category_id) ?? "switches";
        if (a.commit && runId !== null && !docId) {
          docId = await ensureSourceDoc({ url: pageUrl, doc_type: docType, vendor: vendorSlug ?? undefined, fetched_at: fetchedDay, cache_path: doc.cache_path ?? undefined });
        } else if (!docId) docId = docIdFor(pageUrl);
        if (a.commit && runId !== null) await linkDocParts(docId, [part.id]);

        const mappedKeys: string[] = [];
        const specEntries: SpecEntry[] = [];
        for (const f of entry.facts || []) {
          stats.facts_raw++;
          const m = mapFact({ label: f.label, value: f.value, locator: f.locator || "", shape: "pair", source_url: pageUrl, sku }, category);
          if (m.kind === "ok") {
            stats.facts_ok++;
            mappedKeys.push(m.key);
            specEntries.push({
              k: m.key, raw: f.value, value: m.value, unit: m.unit,
              state: src.tier <= 2 ? "verified" : "unverified",
              prov: { tier: src.tier, method: `${docType}:${src.slug}`, doc_id: docId, locator: f.locator || m.locator, extracted_at: fetchedDay, norm_v: NORM_VERSION },
            });
            written.push({ raw: f.value, label: f.label, cache: doc.cache_path });
          } else if (m.kind === "unmapped") {
            stats.facts_unmapped++;
            const u = unmapped.get(m.label) ?? { count: 0, samples: [], categories: new Set<string>() };
            u.count++; if (u.samples.length < 3 && !u.samples.includes(f.value)) u.samples.push(f.value.slice(0, 120)); u.categories.add(category);
            unmapped.set(m.label, u);
          } else if (m.kind === "rejected") {
            stats.facts_rejected++;
            rejected.set(`${m.key}:${m.reason}`, (rejected.get(`${m.key}:${m.reason}`) ?? 0) + 1);
          } else stats.facts_sentinel++;
        }

        if (a.commit && runId !== null) {
          await withTx(async (client) => {
            for (const e of specEntries) {
              const r = await applyMerge(client, part!.id, e, runId);
              stats[r.action] = (stats[r.action] ?? 0) + 1;
            }
          });
          for (const al of entry.aliases || []) {
            if (!ALIAS_KINDS.has(al.kind)) continue;
            await upsertAlias(part.id, { kind: al.kind as AliasKind, value: al.value, tier: src.tier, doc_id: docId, source_url: pageUrl }, runId); stats.aliases++;
          }
          for (const im of entry.images || []) {
            if (src.kind !== "vendor") { stats.images_skipped_non_vendor++; continue; }
            await upsertImage(part.id, { role: im.role || "gallery", source_url: im.url, doc_id: docId, assignment_method: "source-page", confidence: 0.7, license_note: `vendor product photo (${src.slug})`, source_id: src.id }, runId); stats.images++;
          }
          for (const rel of entry.relations || []) {
            if (!RELATION_KINDS.has(rel.kind)) { stats.relations_invalid_kind++; continue; }
            await upsertRelation(part.id, { to_sku: rel.sku, kind: rel.kind as RelationKind, tier: src.tier, doc_id: docId, source_url: pageUrl, note: rel.note ?? null }, runId); stats.relations++;
          }
          const lc = entry.lifecycle;
          if (lc && Object.values(lc).some((v) => typeof v === "string" && DATE_RX.test(v))) {
            const pick = (k: string) => (typeof lc[k] === "string" && DATE_RX.test(lc[k] as string) ? (lc[k] as string) : null);
            await upsertLifecycle(part.id, {
              status: pick("end_of_sale_date") || pick("last_day_of_support") ? "eol_announced" : "active",
              announce_date: pick("announce_date"), end_of_sale_date: pick("end_of_sale_date"), last_ship_date: pick("last_ship_date"),
              end_of_sw_maint: pick("end_of_sw_maint"), end_of_vuln_support: pick("end_of_vuln_support"), last_day_of_support: pick("last_day_of_support"),
              doc_id: docId, source_url: pageUrl, verified_at: fetchedDay, tier: src.tier, successor_sku: (lc.successor_sku as string) || null,
            }, runId); stats.lifecycle++;
          }
          const outcome: CheckOutcome = mappedKeys.length ? "facts_found" : entry.not_listed ? "not_listed" : "no_facts";
          await recordSourceCheck(part.id, src.id, { doc_id: docId, fetch_id: doc.fetch_id ?? null, outcome, facts_found: mappedKeys.length, fields_found: [...new Set(mappedKeys)] }, runId);
          stats.checks++;
        }
      }
    }

    // ---- the gate -------------------------------------------------------------------------
    const suiteResults: Record<string, boolean> = {};
    for (const slug of sourcesTouched) {
      const t = path.join(REPO_ROOT, "tests", "scraper", `test_${slug.replace(/-/g, "_")}.py`);
      if (!fs.existsSync(t)) { suiteResults[slug] = false; continue; }
      const r = spawnSync("python3.11", [t], { cwd: REPO_ROOT, encoding: "utf8" });
      suiteResults[slug] = r.status === 0;
    }
    const recall = Object.values(suiteResults).length && Object.values(suiteResults).every(Boolean) ? 1 : 0;
    const sample = [...written].sort(() => 0.5 - Math.random()).slice(0, a.sample);
    let hits = 0, checked = 0;
    const misses: string[] = [];
    for (const s of sample) {
      const text = cachedText(s.cache);
      if (text === null) continue;
      checked++;
      const lab = ws(s.label.split(">").pop() || s.label);
      if (text.includes(ws(s.raw)) && text.includes(lab)) hits++; else if (misses.length < 10) misses.push(`${s.label} = ${s.raw}`);
    }
    const precision = checked ? hits / checked : (written.length ? 0 : 1);
    const gate = { precision: Number(precision.toFixed(4)), recall, passed: precision >= 0.98 && recall === 1, sampled: checked, suites: suiteResults, misses };
    return { stats, gate, notes: `sources=${[...sourcesTouched].join(",")}` };
  };

  let out: { stats: Record<string, number>; gate: Record<string, unknown>; runId?: number };
  if (a.commit) {
    out = await withRun("apply-acquired", runInputs, body);
  } else {
    out = await body(null);
  }

  const day = new Date().toISOString().slice(0, 10);
  const tag = [...sourcesTouched].join("+") || "none";
  const outDir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const unmappedFile = path.join(outDir, `unmapped-${tag}-${day}.json`);
  fs.writeFileSync(unmappedFile, JSON.stringify({ generated_at: new Date().toISOString(), sources: [...sourcesTouched],
    labels: [...unmapped.entries()].map(([label, u]) => ({ label, count: u.count, samples: u.samples, categories: [...u.categories] })).sort((x, y) => y.count - x.count) }, null, 1));
  const unknownFile = path.join(outDir, `unknown-skus-${tag}-${day}.jsonl`);
  fs.writeFileSync(unknownFile, unknownSkus.map((u) => JSON.stringify(u)).join("\n") + (unknownSkus.length ? "\n" : ""));

  console.log(`${a.commit ? "COMMITTED run " + out.runId : "DRY RUN"} — ${[...sourcesTouched].join(", ")}`);
  console.table(out.stats);
  console.log("rejected by reason:", Object.fromEntries([...rejected.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)));
  console.log(`gate: ${JSON.stringify(out.gate)}`);
  console.log(`unmapped labels: ${unmapped.size} -> ${path.relative(REPO_ROOT, unmappedFile)}`);
  console.log(`unknown SKUs: ${unknownSkus.length} -> ${path.relative(REPO_ROOT, unknownFile)}`);
  await closePool();
  if (a.commit && !(out.gate as { passed: boolean }).passed) process.exitCode = 1;
}

if (process.argv[1] && /apply-acquired\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
