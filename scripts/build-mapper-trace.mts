/**
 * Build the MAPPER TRACE for a category: which rule actually wins each datasheet label, which rules
 * matched and lost, and which rules never win anything here.
 *
 *     npx tsx scripts/build-mapper-trace.mts --category switches [--vendor cisco]
 *     -> data/mapper/<vendor>-<category>.json   (commit it; served at /v1/mapper/<vendor>/<category>)
 *
 * TERM 8, REACHABILITY (reviewer round 4). A rule that is correct and never fires is invisible from
 * the rules file: every rule reads fine on its own, and only the ORDER decides which one the pipeline
 * consults. Two were found by hand on 12 Sep — `^wireless ` swallowed "Wireless Standards", the only
 * label in 23,651 that asks a product which standard it speaks, into a `__backlog` sink; and a
 * `^frequency range$` -> radio_bands rule sat 168 rules below `^frequency range` -> input_freq, so it
 * had never fired once on any of its 32 occurrences. Both were found by reading what the mapper
 * RETURNS per category rather than what the rules say. This makes that a file.
 *
 * WHAT IS IN IT
 *   contested       every label more than one rule matched: the winner, and each loser with why it
 *                   lost (a lower index won, or it is scoped to other categories). Sorted by how many
 *                   times the label occurs, because a contest over a label with 175 occurrences is a
 *                   different size of problem from one over a label with 1.
 *   unreachable     rules that win NO label in this category. Per category this is normal — a rule
 *                   scoped elsewhere reaches nothing here. Unreachable in EVERY category is the
 *                   finding, and tests/mapperTrace.test.ts is what makes that claim.
 *   sinks           what each `__` sentinel eats here. A sink is a decision to drop a label, and a
 *                   decision nobody can see is the `^wireless ` defect waiting to happen again.
 *
 * Read-only and offline: it reads the committed rules and the label inventory, and writes one JSON
 * file. No database, no run row.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { traceLabel, ruleTable, type RuleHit } from "../src/core/deepSpecMap.js";
import { LEDGER_KINDS } from "../src/core/cupLedger.js";
import { SUPERSEDED_KEYS, FIELD_DICTIONARY } from "../src/core/fieldSchema.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const INVENTORY = path.join(ROOT, "runs/vocab/cisco-datasheets/labels.json");

/** Contested labels kept in the file, most-occurring first. The total is reported beside it, so a
 *  truncated list can never read as a complete one. */
const TOP_CONTESTED = 200;
/** Labels kept per sink. Same rule: the count is always stated. */
const TOP_PER_SINK = 40;

export type Trace = {
  labels: number; mapped: number; unmapped: number;
  contested_total: number;
  contested: unknown[];
  unreachable: { index: number; pattern: string; key: string; scope: string[] | null; reason: string }[];
  sinks: Record<string, { total: number; labels: { label: string; n: number }[] }>;
};

/** Pure, so the test can run it over every category without touching the filesystem twice. */
export function traceCategory(category: string, labels: { label: string; count: number }[]): Trace {
  const rules = ruleTable();
  const wins = new Map<number, number>();          // rule index -> labels won
  const contested: { label: string; n: number; key: string | null; winner: RuleHit | null; losers: RuleHit[]; via_bare: boolean }[] = [];
  const sinks: Record<string, { total: number; labels: { label: string; n: number }[] }> = {};
  let mapped = 0;
  for (const l of labels) {
    const t = traceLabel(l.label, category);
    if (t.winner) { wins.set(t.winner.index, (wins.get(t.winner.index) ?? 0) + 1); mapped++; }
    if (t.key?.startsWith("__")) {
      const s = sinks[t.key] ?? { total: 0, labels: [] };
      s.total += l.count; s.labels.push({ label: l.label, n: l.count }); sinks[t.key] = s;
    }
    if (t.losers.length) contested.push({ label: l.label, n: l.count, key: t.key, winner: t.winner, losers: t.losers, via_bare: t.via_bare });
  }
  for (const s of Object.values(sinks)) s.labels = s.labels.sort((a, b) => b.n - a.n).slice(0, TOP_PER_SINK);
  // WHY a rule reaches nothing here, stated per rule — "scoped elsewhere" and "no label matches it"
  // and "shadowed by an earlier rule" are three different facts and only the third is a defect.
  const unreachable = rules.filter((r) => !wins.has(r.index)).map((r) => {
    const scopedOut = r.scope !== null && !r.scope.includes(category);
    const shadowed = contested.some((c) => c.losers.some((l) => l.index === r.index && l.in_scope));
    return {
      index: r.index, pattern: r.pattern, key: r.key, scope: r.scope,
      reason: scopedOut ? "scoped to other categories"
        : shadowed ? "SHADOWED — it matches a label here and an earlier rule wins it"
        : "no label in this category's inventory matches it",
    };
  });
  return {
    labels: labels.length, mapped, unmapped: labels.length - mapped,
    contested_total: contested.length,
    contested: contested.sort((a, b) => b.n - a.n).slice(0, TOP_CONTESTED),
    unreachable, sinks,
  };
}

function main(): void {
  const category = arg("--category"), vendor = arg("--vendor") ?? "cisco";
  if (!category) throw new Error("--category is required");
  if (!LEDGER_KINDS[category]) throw new Error(`--category must be one of: ${Object.keys(LEDGER_KINDS).join(", ")}`);
  const inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
  const labels = Object.values(inv).find(Array.isArray) as { label: string; count: number }[];
  const t = traceCategory(category, labels);
  // A rule pointing at a RETIRED key is unreachable by construction and hides the label from the
  // survivor — the reviewer's §4.3. Checked here rather than left to a reader, because the retirement
  // list and the rules file are edited by different hands.
  const toRetired = ruleTable().filter((r) => r.key in SUPERSEDED_KEYS)
    .map((r) => ({ index: r.index, pattern: r.pattern, key: r.key, now: SUPERSEDED_KEYS[r.key] }));
  const toMissing = ruleTable().filter((r) => !r.key.startsWith("__") && !FIELD_DICTIONARY[r.key])
    .map((r) => ({ index: r.index, pattern: r.pattern, key: r.key }));
  const out = {
    _about: "GENERATED by scripts/build-mapper-trace.mts — do not edit by hand. Which rule actually wins each "
      + "datasheet label in this category, which rules matched and lost, and which reach nothing. Unreachable "
      + "HERE is normal (a rule scoped elsewhere); unreachable in EVERY category is the finding, and "
      + "tests/mapperTrace.test.ts makes that claim.",
    vendor, category,
    built_on_commit: execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(),
    inventory: path.relative(ROOT, INVENTORY).replace(/\\/g, "/"),
    contested_shown: Math.min(t.contested_total, TOP_CONTESTED),
    labels_per_sink_shown: TOP_PER_SINK,
    rules_pointing_at_a_retired_key: toRetired,
    rules_pointing_at_a_key_not_in_the_dictionary: toMissing,
    ...t,
  };
  const dir = path.join(ROOT, "data", "mapper");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${vendor}-${category}.json`), JSON.stringify(out, null, 1) + "\n");
  const shadowed = t.unreachable.filter((u) => u.reason.startsWith("SHADOWED")).length;
  console.log(`${category.padEnd(30)} ${String(t.labels).padStart(6)} labels  mapped ${String(t.mapped).padStart(5)}  `
    + `contested ${String(t.contested_total).padStart(5)}  unreachable ${String(t.unreachable.length).padStart(4)} (shadowed ${shadowed})  `
    + `retired-key rules ${toRetired.length}  missing-key rules ${toMissing.length}`);
}

main();
