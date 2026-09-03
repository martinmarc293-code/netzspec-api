// src/pipeline/apply-alias-proposals.ts — alias-rule proposals from the vocabulary agents ->
// data/schema/attribute-aliases.en.json and src/core/fieldSchema.generated.ts, under the gate.
//
//   ingest apply-alias-proposals <workflow-journal.jsonl | proposals.json> [--commit]
//
// A bad alias is the most dangerous artefact in this pipeline (src/core/aliasProposal.mjs says
// why). So nothing an agent proposes reaches the mapper without passing validateProposal here,
// against the REAL dictionary, the REAL existing rules and the REAL label inventory of the source
// (runs/vocab/<source>/labels.json, built by scraper/tools/label_inventory.py). What the agent
// says it validated is not trusted; it is re-validated.
//
// New fields are pooled across sources before aliases are validated, so an alias from one
// source may point at a field another source proposed (the legacy apply step learned this the
// hard way: order-dependent rejections). A new field lands in GENERATED_FIELDS only; profile
// membership (which categories require it) is decided later from evidence, never here.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { FIELD_DICTIONARY } from "../core/fieldSchema.js";
import { GENERATED_FIELDS } from "../core/fieldSchema.generated.js";
import { validateProposal } from "../core/aliasProposal.mjs";

type Alias = { regex: string; field_key: string; why?: string; example?: string };
type NewField = { field_key: string; en: string; de: string; type: string; unit?: string; domain?: string[]; why?: string };
type Proposal = { source: string; aliases: Alias[]; new_fields: NewField[]; rejected?: unknown[] };

const ALIAS_FILE = path.join(REPO_ROOT, "data", "schema", "attribute-aliases.en.json");
const GEN_FILE = path.join(REPO_ROOT, "src", "core", "fieldSchema.generated.ts");
const VALID_TYPES = new Set(["n", "nr", "b", "e", "s", "ls", "struct"]);

function loadProposals(file: string): Proposal[] {
  const text = fs.readFileSync(file, "utf8");
  const out: Proposal[] = [];
  if (file.endsWith(".jsonl")) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.type === "result" && r.result && r.result.source && Array.isArray(r.result.aliases)) out.push(r.result);
      } catch { /* partial line */ }
    }
  } else {
    const d = JSON.parse(text);
    for (const p of Array.isArray(d) ? d : [d]) if (p && p.source) out.push(p);
  }
  return out;
}

function inventoryLabels(source: string): string[] {
  const f = path.join(REPO_ROOT, "runs", "vocab", source, "labels.json");
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, "utf8")).labels || []).map((l: { label: string }) => l.label);
}

export async function main(argv: string[]): Promise<void> {
  const commit = argv.includes("--commit");
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: ingest apply-alias-proposals <journal.jsonl|proposals.json> [--commit]");
  const proposals = loadProposals(path.isAbsolute(file) ? file : path.join(REPO_ROOT, file));
  if (!proposals.length) throw new Error("no proposals with a `source` found in " + file);

  const aliasDoc = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as { rules: [string, string, string?][] };
  const existingRules = aliasDoc.rules.map(([pattern, key]) => {
    try { return { re: new RegExp(pattern, "i"), key, pattern }; } catch { return null; }
  }).filter((r): r is { re: RegExp; key: string; pattern: string } => r !== null);
  const existingPatterns = new Set(existingRules.map((r) => r.pattern));
  const knownFields = new Set([...Object.keys(FIELD_DICTIONARY), ...Object.keys(GENERATED_FIELDS)]);

  // 1. pool new fields
  const pooled = new Map<string, NewField & { sources: string[] }>();
  for (const p of proposals) for (const f of p.new_fields || []) {
    if (!f?.field_key) continue;
    const cur = pooled.get(f.field_key);
    if (cur) cur.sources.push(p.source); else pooled.set(f.field_key, { ...f, sources: [p.source] });
  }
  const badType = [...pooled.values()].filter((f) => !VALID_TYPES.has(f.type));
  for (const f of badType) pooled.delete(f.field_key);
  const poolV = validateProposal({ category: "__pooled__", aliases: [], new_fields: [...pooled.values()] }, knownFields, existingRules, []);
  const acceptedFields = new Map<string, NewField & { sources: string[] }>();
  for (const f of poolV.newFields as NewField[]) acceptedFields.set(f.field_key, pooled.get(f.field_key)!);
  const usable = new Set([...knownFields, ...acceptedFields.keys()]);

  // 2. aliases per source against that source's own labels
  const accepted: (Alias & { source: string })[] = [];
  const rejected: { source: string; regex?: string; reason: string }[] = [];
  const table: string[] = [];
  for (const p of proposals) {
    const labels = inventoryLabels(p.source);
    const v = validateProposal({ category: p.source, aliases: p.aliases || [], new_fields: [] }, usable, existingRules, labels);
    const fresh = (v.accepted as Alias[]).filter((a) => !existingPatterns.has(a.regex));
    for (const a of fresh) accepted.push({ ...a, source: p.source });
    for (const r of v.rejected as { reason: string; regex?: string }[]) rejected.push({ source: p.source, ...r });
    table.push(`  ${p.source.padEnd(16)} proposed ${String((p.aliases || []).length).padStart(4)}  accepted ${String(fresh.length).padStart(4)}  rejected ${String(v.rejected.length).padStart(4)}  labels-in-inventory ${labels.length}${labels.length ? "" : "  (NO INVENTORY: run scraper/tools/label_inventory.py " + p.source + ")"}`);
  }
  console.log("source           proposals\n" + table.join("\n"));
  const reasons: Record<string, number> = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  console.log("rejections by reason:", JSON.stringify(reasons));
  console.log(`new fields: ${pooled.size + badType.length} proposed, ${acceptedFields.size} accepted, ${badType.length} bad type`);
  for (const r of (poolV.rejected as { key: string; reason: string }[]).slice(0, 10)) console.log(`   field ${r.key}: ${r.reason}`);
  console.log(`aliases accepted: ${accepted.length} (file holds ${existingRules.length})`);
  if (!commit) { console.log("(dry run — pass --commit to write)"); return; }

  // 3. write aliases
  aliasDoc.rules.push(...accepted.map((a) => [a.regex, a.field_key, `${a.source}: ${(a.why || a.example || "").slice(0, 140)}`] as [string, string, string]));
  fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliasDoc, null, 1) + "\n");
  console.log(`alias rules: ${existingRules.length} -> ${aliasDoc.rules.length}`);

  // 4. write new fields into GENERATED_FIELDS (insert before the closing brace of that object)
  if (acceptedFields.size) {
    let gen = fs.readFileSync(GEN_FILE, "utf8");
    const start = gen.indexOf("export const GENERATED_FIELDS");
    const end = gen.indexOf("\n};", start);
    if (start < 0 || end < 0) throw new Error("GENERATED_FIELDS block not found in fieldSchema.generated.ts");
    const lines: string[] = [];
    for (const f of acceptedFields.values()) {
      const def: Record<string, unknown> = { key: f.field_key, de: f.de, en: f.en, type: f.type, etim: [], icecat: null };
      if (f.unit) def.unit = f.unit;
      if (f.type === "e" && f.domain?.length) def.domain = f.domain;
      lines.push(`  // ${f.sources.join(", ")} — ${(f.why || "").replace(/\s+/g, " ").slice(0, 120)}`);
      lines.push(`  ${f.field_key}: ${JSON.stringify(def).replace(/"([a-z_]+)":/g, "$1: ").replace(/,/g, ", ")},`);
    }
    gen = gen.slice(0, end) + "\n" + lines.join("\n") + gen.slice(end);
    fs.writeFileSync(GEN_FILE, gen);
    console.log(`generated fields: +${acceptedFields.size} -> ${GEN_FILE}`);
  }
  console.log("next: npm test (fieldSchema + alias suites) and `ingest sync-dictionary`");
}

if (process.argv[1] && /apply-alias-proposals\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
