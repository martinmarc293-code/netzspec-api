// scripts/universe/write-status.ts — the handshake between the two sessions.
//
//   npx tsx scripts/universe/write-status.ts            write into the main worktree
//   npx tsx scripts/universe/write-status.ts --out DIR  write somewhere else
//
// Run this at the END of every scraper work session. It writes docs/SCRAPER_STATUS.md and
// data/scraper-status.json INTO THE MAIN WORKTREE (D:/Project/netzspec, branch master), which is
// what the content/deploy session reads. That session then never has to be told by hand what has
// landed — it reads one file.
//
// Design rule: as much as possible is DERIVED FROM THE LIVE DATABASE rather than declared, because
// a hand-maintained status file is a status file that lies. Where a step's completion cannot be
// derived, the declared value and the derived evidence are printed side by side and any
// disagreement is called out — a status file that cannot contradict itself is not a status file.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { MongoClient } from "mongodb";
import { FIELD_DICTIONARY, PROFILES, CATEGORIES, completenessV2, ENUM_LABELS } from "../../core/fieldSchema.js";

const outArg = process.argv.indexOf("--out");
const root = process.cwd();

/** Locate the MAIN worktree (the deploy checkout), not this one. */
function mainWorktree(): string {
  if (outArg >= 0) return process.argv[outArg + 1];
  try {
    const first = execSync("git worktree list", { encoding: "utf8" }).split("\n")[0];
    const p = first.split(/\s+/)[0];
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return path.resolve(root, "..", "netzspec");
}

// ---------------------------------------------------------------------------------------------
// The roadmap. `declared` is what I set; `derive` is evidence read from the live data.
// ---------------------------------------------------------------------------------------------
type Step = {
  n: number; title: string;
  declared: "done" | "in_progress" | "next" | "planned";
  effect: string;
  derive?: (f: Facts) => { done: boolean; evidence: string };
};

type Facts = {
  parts: number; withSpecs: number; entries: number; keys: string[];
  tiers: Record<string, number>; states: Record<string, number>;
  inherited: number; conflicts: number; sourceDocs: number;
  byCategory: Record<string, { n: number; mean: number; max: number }>;
  gapLedgerExists: boolean;
};

const ROADMAP: Step[] = [
  { n: 0, title: "Field schema registry + alias maps (the denominator)", declared: "done",
    effect: "completeness_v2 became measurable at all",
    derive: (f) => ({ done: f.keys.length > 0, evidence: `${Object.keys(FIELD_DICTIONARY).length} fields defined, ${CATEGORIES.length} category profiles` }) },
  { n: 1, title: "specs_v2 migration of the reviewed HexCat seed (tier 0)", declared: "done",
    effect: "typed, unit-normalised specs alongside i18n.de.attributes",
    derive: (f) => ({ done: (f.tiers["0"] || 0) > 0, evidence: `${f.tiers["0"] || 0} tier-0 entries on ${f.withSpecs} parts` }) },
  { n: 2, title: "Golden sample + >=98% precision gate on 10 Cisco datasheets", declared: "next",
    effect: "no data change; a hard STOP condition before any bulk write",
    derive: () => ({ done: fs.existsSync(path.join(root, "data/reference/golden")), evidence: "data/reference/golden/ present" }) },
  { n: 3, title: "Merge engine wired to Mongo (apply-specs-v2)", declared: "planned",
    effect: "first tier-1 entries; states corroborated/conflict/unverified go live; spec_conflicts starts filling",
    derive: (f) => ({ done: (f.tiers["1"] || 0) > 0, evidence: `${f.tiers["1"] || 0} tier-1 entries, ${f.conflicts} conflicts logged` }) },
  { n: 4, title: "Bulk run over Cisco switch datasheets", declared: "planned",
    effect: "THE BIG ONE - Cisco switches gain ~8 measured + ~8 inherited fields each",
    derive: (f) => ({ done: f.inherited > 0 && (f.tiers["1"] || 0) > 500, evidence: `${f.inherited} inherited entries` }) },
  { n: 5, title: "ports / uplink_ports struct parser", declared: "planned",
    effect: "closes the widest gap - both required, missing on ALL Cisco switches today",
    derive: (f) => ({ done: f.keys.includes("ports"), evidence: f.keys.includes("ports") ? "ports present in specs_v2" : "no ports entries yet" }) },
  { n: 6, title: "Gap ledger written to reports/", declared: "planned",
    effect: "per-family x per-field matrix of what is missing and which source closes it",
    derive: (f) => ({ done: f.gapLedgerExists, evidence: f.gapLedgerExists ? "reports/gap-ledger-*.json present" : "not written yet" }) },
  { n: 7, title: "Transceiver depth, then further vendors", declared: "planned",
    effect: "transceiver parts gain measured optical fields",
    derive: (f) => ({ done: (f.byCategory.transceiver?.mean ?? 0) > 12, evidence: `transceiver mean ${f.byCategory.transceiver?.mean ?? 0}` }) },
];

async function gather(): Promise<Facts> {
  const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const c = new MongoClient(env.MONGODB_URI as string, { serverSelectionTimeoutMS: 30000, retryReads: true });
  await c.connect();
  const db = c.db(env.MONGODB_DB as string), P = db.collection("parts");

  const parts = await P.countDocuments();
  const withSpecs = await P.countDocuments({ specs_v2: { $exists: true, $ne: [] } });
  const agg = async (field: string) => Object.fromEntries(
    (await P.aggregate([{ $unwind: "$specs_v2" }, { $group: { _id: `$specs_v2.${field}`, n: { $sum: 1 } } }]).toArray())
      .map((r) => [String(r._id), r.n as number]));
  const tiers = await agg("prov.tier");
  const states = await agg("state");
  const keyRows = await P.aggregate([{ $unwind: "$specs_v2" }, { $group: { _id: "$specs_v2.k", n: { $sum: 1 } } },
    { $sort: { n: -1 } }]).toArray();
  const entries = Object.values(tiers).reduce((a, b) => a + b, 0);
  const inherited = await P.countDocuments({ "specs_v2.inherited": true });
  const conflicts = await db.collection("spec_conflicts").countDocuments();
  const sourceDocs = await db.collection("source_docs").countDocuments();

  const byCategory: Facts["byCategory"] = {};
  const buckets: Record<string, number[]> = {};
  const cur = P.find({}, { projection: { _id: 0, category: 1, specs_v2: 1 } }).batchSize(300);
  for await (const p of cur) {
    const cat = String(p.category || "");
    if (!PROFILES[cat]) continue;
    const values: Record<string, unknown> = {};
    for (const s of (p.specs_v2 as { k: string; value: unknown }[]) || []) values[s.k] = s.value;
    (buckets[cat] ||= []).push(completenessV2(cat, values).required_present);
  }
  for (const [cat, arr] of Object.entries(buckets)) {
    byCategory[cat] = { n: arr.length, mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1), max: Math.max(...arr) };
  }
  await c.close();

  const reportsDir = path.join(root, "reports");
  const gapLedgerExists = fs.existsSync(reportsDir) &&
    fs.readdirSync(reportsDir).some((f) => f.startsWith("gap-ledger"));

  return { parts, withSpecs, entries, keys: keyRows.map((k) => String(k._id)), tiers, states,
    inherited, conflicts, sourceDocs, byCategory, gapLedgerExists };
}

async function main() {
  const out = mainWorktree();
  if (!fs.existsSync(out)) { console.error(`main worktree not found: ${out}`); process.exit(2); }
  const f = await gather();
  const now = new Date().toISOString();
  let branch = "?", head = "?";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch { /* not fatal */ }

  // resolve declared vs derived
  const steps = ROADMAP.map((s) => {
    const d = s.derive ? s.derive(f) : null;
    const derivedDone = d?.done ?? null;
    const declaredDone = s.declared === "done";
    return { ...s, derived_done: derivedDone, evidence: d?.evidence ?? "",
      disagreement: derivedDone !== null && derivedDone !== declaredDone };
  });
  const current = steps.find((s) => s.declared === "in_progress") || steps.find((s) => s.declared === "next");
  const done = steps.filter((s) => s.declared === "done");

  // ---- previous status, for the delta ----------------------------------------------------------
  const jsonPath = path.join(out, "data/scraper-status.json");
  let prev: { facts?: Facts; generated_at?: string } | null = null;
  if (fs.existsSync(jsonPath)) { try { prev = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch { prev = null; } }
  const delta = prev?.facts ? {
    entries: f.entries - prev.facts.entries,
    keys: f.keys.length - prev.facts.keys.length,
    tier1: (f.tiers["1"] || 0) - (prev.facts.tiers["1"] || 0),
    inherited: f.inherited - prev.facts.inherited,
    conflicts: f.conflicts - prev.facts.conflicts,
    since: prev.generated_at,
  } : null;

  // ---- machine-readable --------------------------------------------------------------------------
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: now, scraper_branch: branch, scraper_head: head,
    current_step: current ? { n: current.n, title: current.title, effect: current.effect } : null,
    completed_steps: done.map((s) => s.n),
    steps: steps.map((s) => ({ n: s.n, title: s.title, declared: s.declared,
      derived_done: s.derived_done, evidence: s.evidence, effect: s.effect, disagreement: s.disagreement })),
    facts: f, delta,
  }, null, 2));

  // ---- human-readable ------------------------------------------------------------------------------
  const md: string[] = [];
  md.push(`# Scraper status — GENERATED, do not edit by hand`);
  md.push(``);
  md.push(`**Generated ${now}** by \`scripts/universe/write-status.ts\` in the scraper worktree`);
  md.push(`(branch \`${branch}\` @ \`${head}\`). Machine-readable twin: \`data/scraper-status.json\`.`);
  md.push(``);
  md.push(`Everything below is read from the LIVE Atlas database at generation time, not written by hand.`);
  md.push(``);
  md.push(`## Where the scraper is`);
  md.push(``);
  md.push(current
    ? `**Now starting / in progress: step ${current.n} — ${current.title}**  \n_Effect on your data:_ ${current.effect}`
    : `**No step marked current.**`);
  md.push(``);
  md.push(`| # | step | declared | derived from data | evidence |`);
  md.push(`|---|---|---|---|---|`);
  for (const s of steps) {
    const der = s.derived_done === null ? "—" : s.derived_done ? "done" : "not yet";
    md.push(`| ${s.n} | ${s.title} | ${s.declared}${s.disagreement ? " ⚠️" : ""} | ${der} | ${s.evidence} |`);
  }
  const dis = steps.filter((s) => s.disagreement);
  if (dis.length) {
    md.push(``);
    md.push(`> ⚠️ **Declared status disagrees with the data** for step(s) ${dis.map((s) => s.n).join(", ")}.`);
    md.push(`> Trust the derived column — it is read from the database. Tell the scraper session.`);
  }
  md.push(``);
  md.push(`## What is in the database right now`);
  md.push(``);
  md.push(`| metric | value |`);
  md.push(`|---|---|`);
  md.push(`| parts | ${f.parts} |`);
  md.push(`| parts carrying \`specs_v2\` | ${f.withSpecs} |`);
  md.push(`| \`specs_v2\` entries | ${f.entries} |`);
  md.push(`| distinct \`field_key\`s in use | ${f.keys.length} |`);
  md.push(`| entries by tier | ${Object.entries(f.tiers).map(([t, n]) => `tier ${t}: ${n}`).join(" · ")} |`);
  md.push(`| entries by state | ${Object.entries(f.states).map(([s, n]) => `${s}: ${n}`).join(" · ")} |`);
  md.push(`| inherited (series-level) entries | ${f.inherited} |`);
  md.push(`| \`spec_conflicts\` rows | ${f.conflicts}${f.conflicts === 0 ? " (empty is a real state, not a bug)" : ""} |`);
  md.push(`| \`source_docs\` | ${f.sourceDocs} |`);
  md.push(``);
  md.push(`Completeness (\`required_present\`, computed per part):`);
  md.push(``);
  md.push(`| category | parts | mean | max |`);
  md.push(`|---|---|---|---|`);
  for (const [cat, s] of Object.entries(f.byCategory)) md.push(`| ${cat} | ${s.n} | ${s.mean} | ${s.max} |`);
  md.push(``);
  if (delta) {
    md.push(`## Changed since the last status (${delta.since})`);
    md.push(``);
    const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
    md.push(`\`specs_v2\` entries ${sign(delta.entries)} · field_keys ${sign(delta.keys)} · ` +
      `tier-1 entries ${sign(delta.tier1)} · inherited ${sign(delta.inherited)} · conflicts ${sign(delta.conflicts)}`);
    md.push(``);
    if (delta.tier1 > 0) md.push(`> **Tier-1 (vendor datasheet) data has landed.** Fields now carry measured values from Cisco's own datasheets, not just the HexCat seed.`);
    if (delta.inherited > 0) md.push(`> **Inherited entries have appeared.** Render these as „Serienangabe" with \`inherited_from\`, never as measured per-SKU values.`);
    if (delta.conflicts > 0) md.push(`> **\`spec_conflicts\` is no longer empty.** Fields in state \`conflict\` are HELD — do not render them.`);
    md.push(``);
  }
  md.push(`## How to read the data`);
  md.push(``);
  md.push(`Use \`lib/specsRead.ts\` — a self-contained reader with no dependency on the scraper's`);
  md.push(`internals, so scraper churn cannot break your build:`);
  md.push(``);
  md.push("```ts");
  md.push(`import { renderableSpecs, specValue } from "@/lib/specsRead";`);
  md.push(``);
  md.push(`const rows = renderableSpecs(part, "de");   // [{ key, label, text, inherited, unit }]`);
  md.push(`const cap  = specValue(part, "switching_capacity");  // { value: 56, unit: "Gbit/s" } | null`);
  md.push("```");
  md.push(``);
  md.push(`\`renderableSpecs\` already filters to states \`verified\` and \`corroborated\`, so`);
  md.push(`\`unverified\` and \`conflict\` values can never reach a page through it.`);
  md.push(``);
  md.push(`Full field-by-field contract: \`docs/DATA_CONTRACT_specs_v2.md\`.`);
  md.push(`Session/branch rules: \`docs/SESSION_COORDINATION.md\`.`);
  md.push(``);
  const mdPath = path.join(out, "docs/SCRAPER_STATUS.md");
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, md.join("\n") + "\n");

  // ---- generated label map for lib/specsRead.ts --------------------------------------------------
  // A plain TS const with no imports, so the content session's reader has ZERO dependency on the
  // scraper's modules and my churn can never break their build. It is GENERATED, and
  // validate-schema.ts fails if it drifts from the dictionary — CLAUDE.md's rule that a duplicated
  // constant needs a check that catches drift.
  const labels = Object.values(FIELD_DICTIONARY)
    .map((d) => `  ${JSON.stringify(d.key)}: { de: ${JSON.stringify(d.de)}, en: ${JSON.stringify(d.en)}` +
      (d.unit ? `, unit: ${JSON.stringify(d.unit)}` : "") + ` },`)
    .join("\n");
  const labelFile = `// GENERATED by scripts/universe/write-status.ts — do not edit by hand.
// Field labels for lib/specsRead.ts. Deliberately dependency-free: the content session's reader
// must not import anything from the scraper pipeline, or a mid-edit scraper file would break its
// build again. validate-schema.ts fails if this drifts from lib/fieldSchema.ts.
export const FIELD_LABELS: Record<string, { de: string; en: string; unit?: string }> = {
${labels}
};

// Enum values are STORED as machine slugs ("l3", "rack-19", "802.3at") so they compare and filter
// cleanly. These are the human strings; a page must never print the slug.
export const ENUM_LABELS: Record<string, Record<string, { de: string; en: string }>> = ${
  JSON.stringify(ENUM_LABELS, null, 2)
};
`;
  const labelPath = path.join(out, "lib/fieldLabels.generated.ts");
  fs.writeFileSync(labelPath, labelFile);
  // keep a copy in this worktree so the drift check can compare without reaching across worktrees
  fs.writeFileSync(path.join(root, "lib/fieldLabels.generated.ts"), labelFile);

  console.log(`wrote ${labelPath} (${Object.keys(FIELD_DICTIONARY).length} labels)`);
  console.log(`wrote ${mdPath}`);
  console.log(`wrote ${jsonPath}`);
  console.log(`current step: ${current ? `${current.n} — ${current.title}` : "none"}`);
  console.log(`entries ${f.entries} | keys ${f.keys.length} | tiers ${JSON.stringify(f.tiers)} | conflicts ${f.conflicts}`);
  if (dis.length) console.log(`WARNING: declared/derived disagreement on step(s) ${dis.map((s) => s.n).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
