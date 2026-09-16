// src/pipeline/apply-compat.ts — Cisco TMG (Transceiver Module Group) matrix -> relations,
// inside a gated apply-compat run. The Postgres port of src/pipeline/legacy/apply-compat.mjs
// (optic records) and apply-tmg-platform.mjs (platform records).
//
//   ingest apply-compat <cisco-tmg.json | cisco-tmg-platform.json>... [--commit] [--sample N] [--vendor V]
//
// Two record shapes, both from scraper/run.py (adapters cisco_tmg and cisco_tmg_platform):
//   platform-compat  {family_query: "C9300", modules: [...], compatible_optics: [{sku, source_url}]}
//                    -> supports_transceiver  platform -> optic   (tier 1, the TMG source doc)
//                    -> compatible            optic -> platform   (tier 1) when the optic is a part of ours
//                    "platform" = every switch of the family the query names (FAMILY_OF_QUERY, the
//                    legacy map) plus the uplink MODULE part numbers the matrix lists, resolved to parts.
//   transceiver      {sku, datasheet_url, end_of_sale, compat: [{sku, note}]}
//                    -> equivalent  optic -> equivalent optic (tier 1, the optic's datasheet doc)
//                    -> a lifecycle row when TMG states a real End-of-Sale date (most optics are active)
//                    -> the datasheet URL filled onto the part when it has none (never overwritten)
//
// What this file guarantees:
//   * a relation target is written as the SKU the matrix wrote (relations.to_sku) whether or not we
//     hold the part; to_part_id resolves within the vendor, and the unresolved ones are COUNTED and
//     listed — they are the enumeration feed, not silently dropped rows;
//   * nothing is written for a family query that maps to no family and no module of ours; a family
//     query with no map entry is reported, never guessed from the prefix;
//   * a target that is not a part number (isPartNumber — no digit demanded: GLC-TE is a real optic) is
//     refused and counted; a wavelength-family placeholder (CWDM-SFP-XXXX) is skipped and counted.
//
// THE GATE is structural and says so. The TMG data comes from a runtime JSON API that
// netzscrape does not cache, so unlike the datasheet and bulletin gates nothing can be re-read
// from a source document offline. What the gate can honestly assert over a random sample of N
// records: every SKU is a well-formed part number, every source URL is on cisco.com, and every
// record carries at least one relation. `passed` therefore means "the file is well-formed", and
// docs/CISCO_PIPELINE.md tells the operator to spot-check pairs on tmgmatrix.cisco.com before
// trusting a fresh matrix.
import fs from "node:fs";
import path from "node:path";
import {
  getPool, closePool, withTx, withRun, hashFile, ensureSourceDoc, docIdFor, upsertRelation, upsertLifecycle, upsertPart,
  type Queryable, type RelationKind,
} from "../store/index.js";
import { isPartNumber } from "./apply-lifecycle.js";
import { REPO_ROOT } from "../config.js";

/** TMG lists wavelength FAMILIES as pseudo part numbers — CWDM-SFP-XXXX, DWDM-SFP10G-XX.XX, DWDM-X2-XX.XX.
 *  A relation to one would point at a part that cannot exist; they are skipped and counted, not refused as malformed. */
export function isPlaceholderSku(s: unknown): boolean {
  return /(?<![A-Za-z0-9])X{2,}(?:\.X{2,})?(?![A-Za-z0-9])/.test(String(s ?? ""));
}
/** TMG's endOfSale is a flag ("Y") or empty on the real matrix (228 records: 222 empty, 6 "Y"), never a date so far.
 *  A flag without a date earns no lifecycle row (a row with a status and no date would read as "checked, still shipping"). */
export const isEosFlag = (s: unknown): boolean => /^(y|n|yes|no)$/i.test(String(s ?? "").trim());

export const TMG_ORIGIN = "https://tmgmatrix.cisco.com/";

/** TMG family query -> the family name our parts carry (the legacy FAM map, unchanged). */
export const FAMILY_OF_QUERY: Record<string, string> = {
  C9300: "Cisco Catalyst 9300", C9200: "Cisco Catalyst 9200", C9500: "Cisco Catalyst 9500",
  C3650: "Cisco Catalyst 3650", C3850: "Cisco Catalyst 3850", C3750X: "Cisco Catalyst 3750-X",
  C3560X: "Cisco Catalyst 3560-X", C3560CX: "Cisco Catalyst 3560-CX", C2960X: "Cisco Catalyst 2960-X",
  C2960: "Cisco Catalyst 2960", C2960L: "Cisco Catalyst 2960-L", C1000: "Cisco Catalyst 1000",
  C4500X: "Cisco Catalyst 4500-X",
};

export type PlatformRecord = { vendor?: string; type: "platform-compat"; family_query: string; modules?: string[]; compatible_optics?: { sku: string; source_url?: string | null }[] };
export type OpticRecord = { vendor?: string; type: "transceiver"; sku: string; datasheet_url?: string | null; end_of_sale?: string | null; compat?: { sku: string; source_url?: string | null; note?: string | null }[] };
export type TmgRecord = PlatformRecord | OpticRecord;

export function loadTmg(p: string): { file: string; source: string | null; generated_at: string | null; records: TmgRecord[] } {
  const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${p}`);
  const data = JSON.parse(fs.readFileSync(abs, "utf8")) as { source?: string; generated_at?: string; records?: TmgRecord[] };
  if (!Array.isArray(data.records)) throw new Error(`${p}: no "records" array — not a cisco-tmg output file`);
  // The adapter writes `transceiverModelDataSheet or None`, and a whitespace-only string is truthy in
  // Python: QSFP-400G-VR4 on the 2026-08-31 matrix carries "  " as its datasheet. Blank is no URL.
  const blankToNull = (u: unknown): string | null => (typeof u === "string" && u.trim() ? u.trim() : null);
  for (const r of data.records) {
    if (r.type === "transceiver") { r.datasheet_url = blankToNull(r.datasheet_url); for (const c of r.compat ?? []) c.source_url = blankToNull(c.source_url); }
    else if (r.type === "platform-compat") for (const o of r.compatible_optics ?? []) o.source_url = blankToNull(o.source_url);
  }
  return { file: abs, source: data.source ?? null, generated_at: data.generated_at ?? null, records: data.records };
}

export const isoDate = (s: unknown): string | null => { const m = /\d{4}-\d{2}-\d{2}/.exec(String(s ?? "")); return m ? m[0] : null; };
export const onCisco = (u: unknown): boolean => /^https:\/\/(www\.|tmgmatrix\.)?cisco\.com\//i.test(String(u ?? ""));

export type CompatGate = {
  precision: number; recall: number; passed: boolean; sampled: number; misses: string[]; verdict: "pass" | "fail" | "unverified";
  structural: true; note: string; [extra: string]: unknown;
};

/** Structural well-formedness over a sample — see the module comment for why it cannot be more. */
export function gateCompat(records: TmgRecord[], sampleN: number, opts: { random?: () => number } = {}): CompatGate {
  const rnd = opts.random ?? Math.random;
  const sample = [...records].sort(() => 0.5 - rnd()).slice(0, Math.max(0, sampleN));
  const misses: string[] = [];
  let ok = 0, empty = 0;
  for (const r of sample) {
    const problems: string[] = [];
    if (r.type === "platform-compat") {
      if (!/^[A-Z0-9-]{3,}$/i.test(r.family_query ?? "")) problems.push(`family_query "${r.family_query}" is not a query`);
      const optics = r.compatible_optics ?? [];
      if (optics.length === 0) { empty++; problems.push("no compatible optic"); }
      for (const o of optics) { if (!isPlaceholderSku(o.sku) && !isPartNumber(o.sku)) problems.push(`optic "${o.sku}" is not a part number`); if (o.source_url && !onCisco(o.source_url)) problems.push(`source ${o.source_url} is not cisco.com`); }
      for (const m of r.modules ?? []) if (!isPartNumber(m)) problems.push(`module "${m}" is not a part number`);
    } else if (r.type === "transceiver") {
      if (!isPlaceholderSku(r.sku) && !isPartNumber(r.sku)) problems.push(`sku "${r.sku}" is not a part number`);
      if (r.datasheet_url && !onCisco(r.datasheet_url)) problems.push(`datasheet ${r.datasheet_url} is not cisco.com`);
      for (const c of r.compat ?? []) if (!isPlaceholderSku(c.sku) && !isPartNumber(c.sku)) problems.push(`equivalent "${c.sku}" is not a part number`);
      if (r.end_of_sale && !isoDate(r.end_of_sale) && !isEosFlag(r.end_of_sale)) problems.push(`end_of_sale "${r.end_of_sale}" is neither a date nor a Y/N flag`);
    } else problems.push(`unknown record type "${(r as { type?: string }).type}"`);
    if (problems.length === 0) ok++;
    else misses.push(`MALFORMED ${r.type === "platform-compat" ? r.family_query : (r as OpticRecord).sku}: ${problems.slice(0, 3).join("; ")}`);
  }
  const precision = sample.length ? Number((ok / sample.length).toFixed(4)) : 0;
  const recall = sample.length ? Number(((sample.length - empty) / sample.length).toFixed(4)) : 0;
  const verdict: CompatGate["verdict"] = sample.length === 0 ? "unverified" : precision >= 0.98 && recall === 1 ? "pass" : "fail";
  if (verdict === "unverified") misses.unshift("UNVERIFIED: no record to sample");
  return { precision, recall, passed: verdict === "pass", sampled: sample.length, misses: misses.slice(0, 40), verdict, structural: true,
    note: "structural: TMG API responses are not cached, so values are checked for shape, not re-read from a source document" };
}

export type Args = { paths: string[]; commit: boolean; sample: number; vendor: string };
export function parseArgs(argv: string[]): Args {
  const out: Args = { paths: [], commit: false, sample: 60, vendor: "cisco" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else if (a === "--vendor") out.vendor = argv[++i] ?? "cisco";
    else out.paths.push(a);
  }
  return out;
}

export type PartRef = { id: number; sku: string; category: string; family: string | null; datasheet_url: string | null };

async function partsBySku(vendor: string, skus: Iterable<string>, db: Queryable): Promise<(sku: string) => PartRef | null> {
  const wanted = [...new Set([...skus].map((s) => s.toUpperCase()))];
  const exact = new Map<string, PartRef>(), byNorm = new Map<string, PartRef>();
  for (let i = 0; i < wanted.length; i += 1000) {
    const r = await db.query<PartRef & { sku_norm: string }>(
      // `AND p.retired_at IS NULL` (16 Sep 2026): without it the exact-spelling map below reaches a
      // RETIRED row. `hygiene case-duplicates` merged the 127 case pairs migration 0010 refuses and
      // the loser keeps its exact SKU for ever, so all 127 are reachable here by sku_norm (105 of
      // them share their survivor's category). A TMG file quoting the retired spelling would take
      // `exact.get()` straight to the dead row and hang an edge off it. Excluding it also RESOLVES
      // the spelling correctly rather than dropping it: both twins share a sku_norm, so removing the
      // retired row leaves `byNorm` holding the survivor. Measured first — 0 relations currently
      // have a retired FROM side, so this moves no stored edge.
      `SELECT p.id, p.sku, p.sku_norm, c.slug AS category, p.family, p.datasheet_url FROM parts p JOIN categories c ON c.id = p.category_id
        WHERE p.vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND p.retired_at IS NULL AND p.sku_norm = ANY($2::text[]) ORDER BY p.sku`, [vendor, wanted.slice(i, i + 1000)]);
    for (const row of r.rows) { const ref = { id: row.id, sku: row.sku, category: row.category, family: row.family, datasheet_url: row.datasheet_url }; exact.set(row.sku, ref); if (!byNorm.has(row.sku_norm)) byNorm.set(row.sku_norm, ref); }
  }
  return (sku) => exact.get(sku) ?? byNorm.get(sku.toUpperCase()) ?? null;
}

async function familySwitches(vendor: string, family: string, db: Queryable): Promise<PartRef[]> {
  const r = await db.query<PartRef>(
    `SELECT p.id, p.sku, c.slug AS category, p.family, p.datasheet_url FROM parts p JOIN categories c ON c.id = p.category_id
      WHERE p.vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND p.retired_at IS NULL AND p.family = $2 AND p.product_class = 'hardware' AND c.slug = 'switches' ORDER BY p.sku`, [vendor, family]);
  return r.rows;
}

export type Edge = { from: PartRef; to_sku: string; kind: RelationKind; source_url: string | null; note: string | null };

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.paths.length) throw new Error("usage: ingest apply-compat <cisco-tmg.json|cisco-tmg-platform.json>... [--commit] [--sample N] [--vendor V]");
  const files = a.paths.map(loadTmg);
  const today = new Date().toISOString().slice(0, 10);
  // a record is dated by the file that stated it: an optic's End-of-Sale read on 31 Aug is verified on 31 Aug, whatever else is on the command line
  const dayOf = new Map<TmgRecord, string>();
  for (const f of files) for (const r of f.records) dayOf.set(r, f.generated_at?.slice(0, 10) ?? today);
  const records = files.flatMap((f) => f.records);
  const day = [...dayOf.values()].sort().pop() ?? today;
  const pool = getPool();
  const gate = gateCompat(records, a.sample);

  const skus = new Set<string>();
  for (const r of records) {
    if (r.type === "platform-compat") { for (const m of r.modules ?? []) skus.add(m); for (const o of r.compatible_optics ?? []) skus.add(o.sku); }
    else if (r.type === "transceiver") { skus.add(r.sku); for (const c of r.compat ?? []) skus.add(c.sku); }
  }
  const resolve = await partsBySku(a.vendor, skus, pool);

  const stats: Record<string, number> = {
    records: records.length, platform_records: 0, optic_records: 0, families_unmapped: 0, families_without_platform: 0, platforms: 0,
    supports_transceiver: 0, compatible: 0, equivalent: 0, targets_unresolved: 0, targets_invalid_pid: 0, placeholder_skus: 0, optics_not_held: 0, lifecycle: 0, eos_flag_without_date: 0, datasheet_filled: 0,
    docs_written: 0, relations_written: 0,
  };
  const unresolved = new Map<string, number>();
  const edges: Edge[] = [];
  const lifecycles: { part: PartRef; eos: string; day: string }[] = [];
  const datasheets: { part: PartRef; url: string }[] = [];
  const familyNotes: string[] = [];

  for (const r of records) {
    if (r.type === "platform-compat") {
      stats.platform_records++;
      const family = FAMILY_OF_QUERY[r.family_query];
      const platforms = new Map<number, PartRef>();
      if (family) for (const p of await familySwitches(a.vendor, family, pool)) platforms.set(p.id, p);
      else stats.families_unmapped++;
      for (const m of r.modules ?? []) { const p = resolve(m); if (p) platforms.set(p.id, p); else unresolved.set(m, (unresolved.get(m) ?? 0) + 1); }
      if (platforms.size === 0) { stats.families_without_platform++; familyNotes.push(`${r.family_query}: ${family ? `no hardware switch with family "${family}"` : "no family map entry"} and no listed module is a part`); continue; }
      const seen = new Set<string>();
      for (const o of r.compatible_optics ?? []) {
        if (!o.sku || seen.has(o.sku)) continue;
        seen.add(o.sku);
        if (isPlaceholderSku(o.sku)) { stats.placeholder_skus++; continue; }
        if (!isPartNumber(o.sku)) { stats.targets_invalid_pid++; continue; }
        const optic = resolve(o.sku);
        if (!optic) { stats.optics_not_held++; unresolved.set(o.sku, (unresolved.get(o.sku) ?? 0) + 1); }
        for (const p of platforms.values()) {
          edges.push({ from: p, to_sku: o.sku, kind: "supports_transceiver", source_url: o.source_url ?? TMG_ORIGIN, note: `TMG ${r.family_query}` });
          stats.supports_transceiver++;
          if (optic) { edges.push({ from: optic, to_sku: p.sku, kind: "compatible", source_url: o.source_url ?? TMG_ORIGIN, note: `TMG ${r.family_query}` }); stats.compatible++; }
        }
      }
      stats.platforms += platforms.size;
      familyNotes.push(`${r.family_query} -> ${family ?? "(modules only)"}: ${platforms.size} platform part(s), ${seen.size} optic(s)`);
    } else if (r.type === "transceiver") {
      stats.optic_records++;
      if (isPlaceholderSku(r.sku)) { stats.placeholder_skus++; continue; }
      const part = resolve(r.sku);
      if (!part) { stats.optics_not_held++; unresolved.set(r.sku, (unresolved.get(r.sku) ?? 0) + 1); continue; }
      for (const c of r.compat ?? []) {
        if (isPlaceholderSku(c.sku)) { stats.placeholder_skus++; continue; }
        if (!isPartNumber(c.sku)) { stats.targets_invalid_pid++; continue; }
        if (!resolve(c.sku)) { stats.targets_unresolved++; unresolved.set(c.sku, (unresolved.get(c.sku) ?? 0) + 1); }
        edges.push({ from: part, to_sku: c.sku, kind: "equivalent", source_url: c.source_url ?? r.datasheet_url ?? TMG_ORIGIN, note: c.note ?? "TMG vendor-verified equivalent" });
        stats.equivalent++;
      }
      const eos = isoDate(r.end_of_sale);
      if (eos) { lifecycles.push({ part, eos, day: dayOf.get(r) ?? today }); stats.lifecycle++; }
      else if (r.end_of_sale && isEosFlag(r.end_of_sale)) stats.eos_flag_without_date++;
      if (r.datasheet_url && onCisco(r.datasheet_url) && !part.datasheet_url) { datasheets.push({ part, url: r.datasheet_url }); stats.datasheet_filled++; }
    }
  }
  stats.targets_unresolved = unresolved.size;

  const reportsDir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const unresolvedFile = path.join(reportsDir, `tmg-unresolved-skus-${day}.jsonl`);
  fs.writeFileSync(unresolvedFile, [...unresolved.entries()].sort((x, y) => y[1] - x[1]).map(([sku, n]) => JSON.stringify({ sku, count: n })).join("\n") + (unresolved.size ? "\n" : ""));

  let runId: number | null = null;
  if (a.commit) {
    const out = await withRun("apply-compat", { files: files.map((f) => ({ ...hashFile(f.file), source: f.source })), commit: true, sample: a.sample, vendor: a.vendor }, async (id) => {
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate)}`);
      const tmgDoc = await ensureSourceDoc({ url: TMG_ORIGIN, doc_type: "vendor_tool", vendor: a.vendor, title: "Cisco Transceiver Module Group (TMG) compatibility matrix", fetched_at: day }, pool);
      stats.docs_written++;
      const docIds = new Map<string, string>([[TMG_ORIGIN, tmgDoc]]);
      const docFor = async (url: string | null): Promise<string> => {
        if (!url || !onCisco(url)) return tmgDoc;
        const cur = docIds.get(url);
        if (cur) return cur;
        const id2 = await ensureSourceDoc({ url, doc_type: url.endsWith(".pdf") ? "vendor_datasheet_pdf" : "vendor_datasheet_html", vendor: a.vendor }, pool);
        docIds.set(url, id2); stats.docs_written++;
        return id2;
      };
      // one transaction per source part, its edges together
      const byFrom = new Map<number, Edge[]>();
      for (const e of edges) byFrom.set(e.from.id, [...(byFrom.get(e.from.id) ?? []), e]);
      for (const [fromId, es] of byFrom) {
        const docs = await Promise.all(es.map((e) => docFor(e.source_url)));
        await withTx(async (client) => {
          for (let i = 0; i < es.length; i++) {
            await upsertRelation(fromId, { to_sku: es[i].to_sku, kind: es[i].kind, tier: 1, doc_id: docs[i], source_url: es[i].source_url, note: es[i].note }, id, client);
            stats.relations_written++;
          }
        });
      }
      for (const l of lifecycles) await upsertLifecycle(l.part.id, { status: "eol_announced", end_of_sale_date: l.eos, doc_id: tmgDoc, source_url: TMG_ORIGIN, verified_at: l.day, tier: 2 }, id, pool);
      for (const d of datasheets) await upsertPart({ vendor: a.vendor, sku: d.part.sku, category: d.part.category, datasheet_url: d.url }, { db: pool });
      return { stats, gate, notes: `files=${files.map((f) => path.basename(f.file)).join(",")}; ${gate.note}` };
    });
    runId = out.runId;
  }

  console.log(`${a.commit ? "COMMITTED run " + runId : "DRY RUN — no writes"}   ${files.map((f) => path.basename(f.file)).join(", ")}`);
  console.table(stats);
  for (const n of familyNotes) console.log(`  ${n}`);
  console.log(`unresolved SKUs: ${unresolved.size} -> ${path.relative(REPO_ROOT, unresolvedFile)}`);
  console.log(`gate (${gate.structural ? "structural" : ""}): ${gate.verdict.toUpperCase()} precision ${(gate.precision * 100).toFixed(1)}% recall ${(gate.recall * 100).toFixed(1)}% over ${gate.sampled} sampled records`);
  for (const m of gate.misses.slice(0, 20)) console.log(`  ${m}`);
  await closePool();
  if (!gate.passed) process.exitCode = 1;
}

if (process.argv[1] && /apply-compat\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
