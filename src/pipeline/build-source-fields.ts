// src/pipeline/build-source-fields.ts — regenerate data/schema/source-fields.json from EVIDENCE.
//
//   ingest build-source-fields [--out data/schema/source-fields.json]
//   ingest source-fields                      then loads it (src/pipeline/queue.ts)
//
// WHY. source_fields is the capability matrix the gap ledger reasons from: a gap counts as
// `gap_confirmed` only when every source CAPABLE of the field was consulted, and queue-gaps sends
// a lookup only to capable sources. A hand-typed matrix is a hand-maintained list of things that
// exist, and those drift silently in both directions (D:\Project\CLAUDE.md § 3): a field a source
// really publishes is never asked for, or a source is consulted forever for a field it has never
// emitted. So the matrix is DERIVED, and the derivation is written into the file beside it:
//   * for every source with a label inventory (runs/vocab/<slug>/labels.json, made by
//     scraper/tools/label_inventory.py over the adapter's cached fixtures), every label is mapped
//     through mapLabel — the SAME alias rules apply-acquired uses — and the resulting field keys
//     are the source's capability under category "*" (an inventory carries no category);
//   * for cisco-datasheets and cisco-datasheet-pdf, the keys present in `facts` with method
//     html_table / pdf_table, per the part's category, when the database has such facts; else
//     the golden files under data/reference/golden/ (switches -> "switches", servers ->
//     "servers-unified-computing") — hand-verified facts the extractor is gated against;
//   * and, for those two vendor-datasheet sources ONLY, an any-category list under "*" =
//     everything the source has been seen to publish in any category PLUS every field a hardware
//     profile can require. Per-category evidence answers "where have we read this field", which is
//     not the same question as "can this source publish it": a vendor's own datasheet publishes
//     whatever that product's sheet states. Registering per category only left 100,167 gap_ledger
//     entries with sources_capable = 0 — mgmt_ports, uplink_ports, heat_dissipation, layer,
//     psu_config on 7,453-8,562 switches each, router_throughput on 5,766 routers — and a gap with
//     no capable source never reaches gap_confirmed and never becomes a queue task
//     (docs/CISCO_GAPS.md finding 5). The per-category lists are kept: they are the evidence, and
//     "*" is the capability that evidence implies.
// A key the dictionary (src/core/fieldSchema*.ts) does not define is dropped and LISTED under
// evidence.keys_not_in_dictionary; it would fail the FK in source_fields anyway, and listing it is
// what makes a stale alias rule visible. Sentinel keys ("__…") are not fields and are skipped.
//
// An enabled LOOKUP source (queue.ts LOOKUP_TASK — the sources queue-gaps sends SKU lookups to)
// must end up with at least one key, or with a RECORDED reason it has none: an inventory that was
// read and mapped no spec field is listed under evidence.lookup_sources_without_spec_fields with
// its unmapped labels (itprice publishes prices and end-of-sale dates, not specs — queue-gaps is
// right never to consult it, and the file says why). A lookup source with no evidence at all is
// a PROBLEM and the build refuses to write: that is the "forgot to inventory a source" case,
// which would otherwise read exactly like "publishes nothing".
//
// tests/source-fields.test.ts proves: only dictionary keys in the output, every enabled lookup
// source has at least one key or a recorded reason, EVERY required field of every hardware profile
// has at least one enabled capable source (against the file and against the real join the
// gap_ledger view uses), the derivation is deterministic, and loadSourceFields rejects a sabotaged
// entry with an unknown key.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../store/db.js";
import { mapLabel } from "../core/deepSpecMap.js";
import { FIELD_DICTIONARY, PROFILES } from "../core/fieldSchema.js";
import { GENERATED_FIELDS } from "../core/fieldSchema.generated.js";
import { LOOKUP_TASK, SOURCE_FIELDS_FILE, type SourceFieldsConfig } from "./queue.js";
import { REPO_ROOT } from "../config.js";

export const VOCAB_DIR = path.join(REPO_ROOT, "runs", "vocab");
export const GOLDEN_DIR = path.join(REPO_ROOT, "data", "reference", "golden");

/** golden file stem -> the category its SKUs belong to */
export const GOLDEN_CATEGORY: Record<string, string> = {
  "cisco-switches": "switches",
  "cisco-servers": "servers-unified-computing",
};

export type SourceEvidence = {
  enabled: boolean; tier: number; kind: string;
  method: "label-inventory" | "facts" | "golden" | "none";
  inventory?: string; labels?: number; mapped?: number; unmapped?: number; sentinels?: number;
  /** the labels the alias rules did not map (kept when the inventory yielded no key, so the absence is explained) */
  unmapped_labels?: string[];
  facts_method?: string; golden_files?: string[];
  /** for a vendor-datasheet source: how the any-category ("*") list was built */
  any_category?: { keys: number; seen_in_categories: number; profile_required: number; added_by_profile: string[] };
  /**
   * The list came from the file being replaced, not from this build. An inventory whose fixtures
   * are no longer in the local cache rebuilds as `labels: []`, which is indistinguishable from
   * "this source publishes nothing" — and dropping the source would delete a capability because a
   * cache was cold, which is the same silent drift in the other direction (D:\Project\CLAUDE.md
   * § 3, a hand-maintained list fails in BOTH directions). The keys are kept and flagged instead.
   */
  carried_forward?: { keys: number; why: string };
  keys: number;
};

export type SourceFieldsEvidence = {
  dictionary_keys: number;
  keys_not_in_dictionary: string[];
  lookup_sources: string[];
  /** enabled lookup sources whose inventory was read and mapped no spec field — a recorded absence, not a gap */
  lookup_sources_without_spec_fields: string[];
  /** sources whose inventory rebuilt empty and whose keys were kept from the previous file */
  carried_forward?: string[];
  sources: Record<string, SourceEvidence>;
};

export type BuiltSourceFields = SourceFieldsConfig & {
  _about: string;
  generated_at: string;
  evidence: SourceFieldsEvidence;
};

/** Every key the dictionary in code defines — the same set src/store/dictionary.ts syncs. */
export function dictionaryKeys(): Set<string> {
  return new Set([...Object.keys(FIELD_DICTIONARY), ...Object.keys(GENERATED_FIELDS)]);
}

/**
 * The sources that publish a vendor's own datasheets. These get an any-category ("*") list, and
 * the reason is in the schema of the thing rather than in a preference: a datasheet source
 * publishes whatever the datasheet of THAT product states, so the fields it has been seen to emit
 * for switches are fields it will emit for a router the day a router sheet is read. Registering it
 * per category only says "cisco-datasheets cannot publish mgmt_ports for a router", which is false
 * and cost 100,167 gap_ledger entries their only capable source (docs/CISCO_GAPS.md finding 5) —
 * and a gap with no capable source can never reach `gap_confirmed` and never becomes a queue task.
 */
export const ANY_CATEGORY_SOURCES = ["cisco-datasheets", "cisco-datasheet-pdf"] as const;

/**
 * Every field a category profile can REQUIRE of a part: `req` unconditionally, plus `cond`, which
 * is `req` for any part that trips its condition and lands in `completeness.missing` exactly the
 * same way. Only the eight hand-written profiles state requirements at all (the generated ones are
 * entirely `opt`), and all eight are hardware categories — so this is the hardware required set,
 * derived rather than listed, and a ninth profile gaining a `req` field joins it with no edit here.
 */
export function requiredKeysByCategory(profiles: Record<string, Record<string, { kind: string }>> = PROFILES): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cat, fields] of Object.entries(profiles)) {
    const keys = Object.keys(fields).filter((k) => fields[k].kind === "req" || fields[k].kind === "cond").sort();
    if (keys.length) out[cat] = keys;
  }
  return out;
}

/** The union of the above: every key any hardware profile can demand, in one sorted list. */
export function requiredProfileKeys(profiles?: Record<string, Record<string, { kind: string }>>): string[] {
  return [...new Set(Object.values(requiredKeysByCategory(profiles)).flat())].sort();
}

/** Does `cfg` give `field` in `category` at least one capable source among `enabled`? */
export function capableSources(cfg: SourceFieldsConfig, category: string, field: string, enabled?: string[]): string[] {
  const allow = enabled ? new Set(enabled) : null;
  return Object.entries(cfg.sources ?? {})
    .filter(([slug, byCat]) => (!allow || allow.has(slug)) && ((byCat["*"] ?? []).includes(field) || (byCat[category] ?? []).includes(field)))
    .map(([slug]) => slug);
}

/**
 * "category/field: no enabled source publishes it" for every REQUIRED field of every hardware
 * category that nothing can fill. This is the invariant docs/CISCO_GAPS.md finding 5 asks for, and
 * it is a real check rather than a tautology: the file is generated and committed while the
 * profiles live in code, so a `req` field added to a profile without regenerating turns it red,
 * and so does disabling the only source that publishes a field.
 */
export function requiredFieldCoverageProblems(cfg: SourceFieldsConfig, enabled?: string[], profiles?: Record<string, Record<string, { kind: string }>>): string[] {
  const problems: string[] = [];
  for (const [cat, keys] of Object.entries(requiredKeysByCategory(profiles))) {
    for (const k of keys) if (!capableSources(cfg, cat, k, enabled).length) problems.push(`${cat}/${k}: required by the profile and no enabled source publishes it`);
  }
  return problems;
}

export type LabelInventory = { source: string; labels: { label: string; count?: number }[] };

/** Map every label of an inventory; returns the field keys plus the counts that explain them. Pure. */
export function keysFromInventory(inv: LabelInventory): { keys: string[]; mapped: number; unmapped: number; sentinels: number; unmapped_labels: string[] } {
  const keys = new Set<string>();
  const unmapped_labels: string[] = [];
  let mapped = 0, sentinels = 0;
  for (const l of inv.labels ?? []) {
    const k = mapLabel(l.label);
    if (!k) { unmapped_labels.push(l.label); continue; }
    if (k.startsWith("__")) { sentinels++; continue; }
    mapped++; keys.add(k);
  }
  return { keys: [...keys].sort(), mapped, unmapped: unmapped_labels.length, sentinels, unmapped_labels };
}

export type GoldenFile = { expectations: { sku: string; field: string }[]; held_back?: { sku: string; field: string }[] };

/** Field keys per category from the golden files (expectations only — held_back is not evidence). */
export function keysFromGolden(dir: string = GOLDEN_DIR): { byCategory: Record<string, string[]>; files: string[] } {
  const byCategory: Record<string, Set<string>> = {};
  const files: string[] = [];
  if (!fs.existsSync(dir)) return { byCategory: {}, files };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".golden.json")).sort()) {
    const stem = f.replace(/\.golden\.json$/, "");
    const cat = GOLDEN_CATEGORY[stem];
    if (!cat) continue;
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as GoldenFile;
    files.push(f);
    for (const e of g.expectations ?? []) (byCategory[cat] ??= new Set()).add(e.field);
  }
  return { byCategory: Object.fromEntries(Object.entries(byCategory).map(([c, s]) => [c, [...s].sort()])), files };
}

/**
 * Split a per-category key map into the file's shape, keeping only dictionary keys and
 * reporting the rest. Categories with no surviving key are dropped.
 */
export function filterKeys(byCat: Record<string, string[]>, dict: Set<string>, slug: string, dropped: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cat, keys] of Object.entries(byCat)) {
    const keep = keys.filter((k) => { const ok = dict.has(k); if (!ok) dropped.push(`${slug}/${cat}/${k}`); return ok; });
    if (keep.length) out[cat] = [...new Set(keep)].sort();
  }
  return out;
}

/**
 * The checks tests/source-fields.test.ts runs over a built file, as one function so the CLI can
 * refuse to write a file that would fail them. Returns the problems, empty when sound.
 * `explainedEmpty` names the enabled lookup sources whose inventory was read and mapped nothing
 * (evidence.lookup_sources_without_spec_fields); any other enabled lookup source without a key
 * is a problem.
 */
export function sourceFieldsProblems(
  cfg: SourceFieldsConfig,
  opts: { dictionary: Set<string>; enabledLookupSources: string[]; explainedEmpty?: string[] },
): string[] {
  const problems: string[] = [];
  for (const [slug, byCat] of Object.entries(cfg.sources ?? {})) {
    for (const [cat, keys] of Object.entries(byCat)) {
      if (!Array.isArray(keys) || !keys.length) problems.push(`${slug}/${cat}: empty key list`);
      for (const k of keys ?? []) if (!opts.dictionary.has(k)) problems.push(`${slug}/${cat}/${k}: not in the dictionary`);
    }
  }
  const explained = new Set(opts.explainedEmpty ?? []);
  for (const slug of opts.enabledLookupSources) {
    const n = Object.values(cfg.sources?.[slug] ?? {}).reduce((s, ks) => s + ks.length, 0);
    if (!n && !explained.has(slug)) problems.push(`${slug}: enabled lookup source with no field key and no inventory explaining why (queue-gaps could never consult it)`);
  }
  return problems;
}

export type SourceRow = { id: number; slug: string; enabled: boolean; tier: number; kind: string };

export async function build(opts: { vocabDir?: string; goldenDir?: string; previous?: SourceFieldsConfig | null } = {}): Promise<BuiltSourceFields> {
  const vocabDir = opts.vocabDir ?? VOCAB_DIR;
  const pool = getPool();
  const sources = (await pool.query<SourceRow>("SELECT id, slug, enabled, tier, kind FROM sources ORDER BY id")).rows;
  const dict = dictionaryKeys();
  const dropped: string[] = [];
  const out: BuiltSourceFields = {
    _about: "GENERATED by `ingest build-source-fields` — do not edit by hand. Which fields each source has been SEEN to publish, per category ('*' = any), derived from the label inventories under runs/vocab/<source>/labels.json mapped through the alias rules, and for the Cisco datasheet sources from the facts table (method html_table / pdf_table) or the golden files. Those two vendor-datasheet sources also carry a '*' list = every key seen in any category plus every key a hardware profile can require, because a vendor's own datasheet publishes whatever that product's sheet states and per-category registration left 100,167 gap entries with no capable source. Loaded into source_fields by `ingest source-fields`. The `evidence` block says where every list came from.",
    generated_at: new Date().toISOString(),
    evidence: { dictionary_keys: dict.size, keys_not_in_dictionary: dropped, lookup_sources: Object.keys(LOOKUP_TASK), lookup_sources_without_spec_fields: [], sources: {} },
    sources: {},
  };
  const golden = keysFromGolden(opts.goldenDir);
  for (const s of sources) {
    const ev: SourceEvidence = { enabled: s.enabled, tier: s.tier, kind: s.kind, method: "none", keys: 0 };
    const factsMethod = s.slug === "cisco-datasheets" ? "html_table" : s.slug === "cisco-datasheet-pdf" ? "pdf_table" : null;
    const invFile = path.join(vocabDir, s.slug, "labels.json");
    if (factsMethod) {
      const rows = (await pool.query<{ category: string; field_key: string }>(
        `SELECT DISTINCT c.slug AS category, f.field_key FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id
          WHERE f.superseded_by IS NULL AND f.method = $1 ORDER BY 1, 2`, [factsMethod])).rows;
      if (rows.length) {
        const byCat: Record<string, string[]> = {};
        for (const r of rows) (byCat[r.category] ??= []).push(r.field_key);
        ev.method = "facts"; ev.facts_method = factsMethod;
        out.sources[s.slug] = filterKeys(byCat, dict, s.slug, dropped);
      } else {
        const want = factsMethod === "pdf_table" ? ["servers-unified-computing"] : ["switches"];
        const byCat = Object.fromEntries(Object.entries(golden.byCategory).filter(([c]) => want.includes(c)));
        ev.method = "golden"; ev.facts_method = factsMethod; ev.golden_files = golden.files;
        out.sources[s.slug] = filterKeys(byCat, dict, s.slug, dropped);
      }
      // The any-category list: everything this source has been seen to publish in ANY category,
      // plus everything any hardware profile can require. The per-category lists stay exactly as
      // they were — they are the evidence — and "*" is the capability the evidence implies.
      if ((ANY_CATEGORY_SOURCES as readonly string[]).includes(s.slug)) {
        const seen = [...new Set(Object.values(out.sources[s.slug] ?? {}).flat())].sort();
        const required = requiredProfileKeys();
        const addedByProfile = required.filter((k) => !seen.includes(k) && dict.has(k)).sort();
        const any = filterKeys({ "*": [...new Set([...seen, ...required])] }, dict, s.slug, dropped);
        if (any["*"]?.length) {
          out.sources[s.slug] = { ...any, ...(out.sources[s.slug] ?? {}) };
          ev.any_category = { keys: any["*"].length, seen_in_categories: seen.length, profile_required: required.length, added_by_profile: addedByProfile };
        }
      }
    } else if (fs.existsSync(invFile)) {
      const inv = JSON.parse(fs.readFileSync(invFile, "utf8")) as LabelInventory;
      const r = keysFromInventory(inv);
      ev.method = "label-inventory"; ev.inventory = path.relative(REPO_ROOT, invFile).replace(/\\/g, "/");
      ev.labels = inv.labels?.length ?? 0; ev.mapped = r.mapped; ev.unmapped = r.unmapped; ev.sentinels = r.sentinels;
      out.sources[s.slug] = filterKeys({ "*": r.keys }, dict, s.slug, dropped);
      if (!r.keys.length) ev.unmapped_labels = r.unmapped_labels;
    }
    ev.keys = Object.values(out.sources[s.slug] ?? {}).reduce((n, ks) => n + ks.length, 0);
    // An inventory that rebuilt EMPTY while the previous file held keys means the fixtures left the
    // local cache, not that the source stopped publishing. Keep the keys, flag them, never drop
    // them quietly: this build regenerated meraki as `labels: []` on 4 Sep 2026 because its cached
    // pages live on the VPS, and writing that would have deleted 25 capabilities in one commit.
    const prev = opts.previous?.sources?.[s.slug];
    const prevKeys = prev ? Object.values(prev).reduce((n, ks) => n + ks.length, 0) : 0;
    if (!ev.keys && prevKeys && ev.method === "label-inventory" && (ev.labels ?? 0) === 0) {
      out.sources[s.slug] = JSON.parse(JSON.stringify(prev)) as Record<string, string[]>;
      ev.keys = prevKeys;
      ev.carried_forward = { keys: prevKeys, why: `the inventory ${ev.inventory ?? ""} rebuilt with 0 labels (its fixtures are not in the local cache); the previous file's keys were kept rather than deleted` };
      (out.evidence.carried_forward ??= []).push(s.slug);
    }
    if (!ev.keys) delete out.sources[s.slug];
    if (!ev.keys && ev.enabled && LOOKUP_TASK[s.slug] && ev.method === "label-inventory" && (ev.labels ?? 0) > 0) {
      out.evidence.lookup_sources_without_spec_fields.push(s.slug);
    }
    out.evidence.sources[s.slug] = ev;
  }
  return out;
}

export function enabledLookupSources(ev: SourceFieldsEvidence): string[] {
  return Object.keys(LOOKUP_TASK).filter((slug) => ev.sources[slug]?.enabled);
}

/** Every source the registry had enabled when the file was built. */
export function enabledSources(ev: SourceFieldsEvidence): string[] {
  return Object.entries(ev.sources).filter(([, e]) => e.enabled).map(([slug]) => slug);
}

/** The problems of a built file, judged from its own evidence block. */
export function problemsOf(built: BuiltSourceFields, dictionary: Set<string> = dictionaryKeys()): string[] {
  return [
    ...sourceFieldsProblems(built, {
      dictionary, enabledLookupSources: enabledLookupSources(built.evidence), explainedEmpty: built.evidence.lookup_sources_without_spec_fields,
    }),
    ...requiredFieldCoverageProblems(built, enabledSources(built.evidence)),
  ];
}

export async function main(argv: string[]): Promise<void> {
  let outFile = SOURCE_FIELDS_FILE;
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--out") outFile = path.resolve(REPO_ROOT, argv[++i]);
  try {
    // read the file we are about to replace: a source whose inventory rebuilt empty keeps its keys
    const previous = fs.existsSync(outFile) ? (JSON.parse(fs.readFileSync(outFile, "utf8")) as SourceFieldsConfig) : null;
    const built = await build({ previous });
    const problems = problemsOf(built);
    for (const [slug, ev] of Object.entries(built.evidence.sources)) {
      if (ev.method === "none") continue;
      console.log(`${slug.padEnd(20)} ${ev.method.padEnd(16)} keys=${ev.keys}${ev.labels !== undefined ? ` labels=${ev.labels} mapped=${ev.mapped} unmapped=${ev.unmapped} sentinels=${ev.sentinels}` : ""}${ev.golden_files ? ` golden=${ev.golden_files.join(",")}` : ""}${ev.any_category ? ` any-category=${ev.any_category.keys} (${ev.any_category.seen_in_categories} seen + ${ev.any_category.added_by_profile.length} required by a profile but never yet emitted)` : ""}`);
    }
    if (built.evidence.keys_not_in_dictionary.length) console.log(`dropped (not in the dictionary): ${built.evidence.keys_not_in_dictionary.join(", ")}`);
    for (const slug of built.evidence.lookup_sources_without_spec_fields) {
      console.log(`${slug}: enabled lookup source whose inventory maps NO spec field (recorded, not a gap) — unmapped labels: ${(built.evidence.sources[slug].unmapped_labels ?? []).join(" | ")}`);
    }
    for (const slug of built.evidence.carried_forward ?? []) {
      console.log(`${slug}: KEPT from the previous file — ${built.evidence.sources[slug].carried_forward?.why}`);
    }
    const silent = Object.entries(built.evidence.sources).filter(([, ev]) => ev.method === "none" && ev.enabled).map(([s]) => s);
    if (silent.length) console.log(`enabled sources with no evidence at all (no inventory, no facts): ${silent.join(", ")}`);
    if (problems.length) {
      console.error(`REFUSING to write ${path.relative(REPO_ROOT, outFile)}:`);
      for (const p of problems) console.error(`  ${p}`);
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(outFile, JSON.stringify(built, null, 1) + "\n");
    console.log(`wrote ${path.relative(REPO_ROOT, outFile)}: ${Object.keys(built.sources).length} sources`);
  } finally {
    await closePool();
  }
}

if (process.argv[1] && /build-source-fields\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
