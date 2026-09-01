// scripts/universe/spot-check.ts — the completeness measure.
//
//   npx tsx scripts/universe/spot-check.ts
//   npx tsx scripts/universe/spot-check.ts --verbose
//
// Reports a SCORE, not a total. The total part-number count measures nothing: it climbed from
// 11,377 to 19,952 across a day in which four separate bugs were silently discarding data, and
// went UP while the score went DOWN. Whenever the two disagree, the score is right.
//
// Three outcomes, deliberately distinct:
//   FOUND             the exact order code is present
//   FOUND_AS_VARIANT  present under a form Cisco actually publishes (region placeholder, AC/DC
//                     chassis variant, spare "=" suffix)
//   MISSING           a real gap. Split into reachable and expected-unreachable, because a part
//                     behind a robots.txt disallow is a decision we made, not a defect to chase.
import fs from "node:fs";
import path from "node:path";

const VERBOSE = process.argv.includes("--verbose");
const root = process.cwd();

type Entry = { pid: string; category: string; basis: string; accepts?: string[]; expected_unreachable?: string };

const spec = JSON.parse(fs.readFileSync(path.join(root, "data/universe/spot-check.json"), "utf8"));
const entries: Entry[] = spec.entries;

const pids = new Set<string>();
let docs = 0, eolBulletins = 0;
const pidFile = path.join(root, "data/universe/cisco-pid-universe.json");
if (fs.existsSync(pidFile)) {
  const store = JSON.parse(fs.readFileSync(pidFile, "utf8")).documents || {};
  docs = Object.keys(store).length;
  for (const d of Object.values(store) as { pids?: string[] }[]) for (const p of d.pids || []) pids.add(p);
}
const merakiFile = path.join(root, "data/universe/meraki-pids.json");
if (fs.existsSync(merakiFile)) {
  const m = JSON.parse(fs.readFileSync(merakiFile, "utf8"));
  for (const d of Object.values(m) as { pids?: string[] }[]) for (const p of d.pids || []) pids.add(p);
}
const eolFile = path.join(root, "data/universe/cisco-eol-pids.json");
if (fs.existsSync(eolFile)) {
  const eol = JSON.parse(fs.readFileSync(eolFile, "utf8"));
  eolBulletins = Object.keys(eol.bulletins || {}).length;
  for (const d of Object.values(eol.bulletins || {}) as { pids?: string[] }[]) for (const p of d.pids || []) pids.add(p);
}

// A "=" suffix marks a spare of the same part; treat it as the same fact.
const norm = (p: string) => p.replace(/=+$/, "");
const normalised = new Set([...pids].map(norm));

const rows: { e: Entry; status: string; via?: string }[] = [];
for (const e of entries) {
  if (pids.has(e.pid) || normalised.has(norm(e.pid))) { rows.push({ e, status: "FOUND" }); continue; }
  const via = (e.accepts || []).find((a) => pids.has(a) || normalised.has(norm(a)));
  if (via) { rows.push({ e, status: "FOUND_AS_VARIANT", via }); continue; }
  rows.push({ e, status: e.expected_unreachable ? "MISSING_EXPECTED" : "MISSING" });
}

const n = (s: string) => rows.filter((r) => r.status === s).length;
const found = n("FOUND") + n("FOUND_AS_VARIANT");
const reachable = entries.length - n("MISSING_EXPECTED");

console.log(`catalogue: ${pids.size.toLocaleString()} part numbers | ${docs} documents | ${eolBulletins} EoL bulletins\n`);
for (const r of rows) {
  const mark = r.status === "FOUND" ? "  ok  " : r.status === "FOUND_AS_VARIANT" ? " var  "
    : r.status === "MISSING_EXPECTED" ? " n/a  " : " MISS ";
  let line = `${mark} ${r.e.pid.padEnd(20)} ${r.e.category}`;
  if (r.via) line += `  -> found as ${r.via}`;
  if (r.status === "MISSING_EXPECTED") line += `  (${r.e.expected_unreachable})`;
  console.log(line);
  if (VERBOSE && r.status.startsWith("MISSING")) console.log(`        basis: ${r.e.basis}`);
}
console.log(`\nSCORE ${found}/${entries.length}  ` +
  `(exact ${n("FOUND")}, variant ${n("FOUND_AS_VARIANT")}, missing ${n("MISSING")}, ` +
  `expected-unreachable ${n("MISSING_EXPECTED")})`);
console.log(`REACHABLE SCORE ${found}/${reachable} — excludes parts we deliberately do not fetch`);
if (n("MISSING")) {
  console.log(`\nreal gaps: ${rows.filter((r) => r.status === "MISSING").map((r) => r.e.pid).join(", ")}`);
  process.exit(1);
}
