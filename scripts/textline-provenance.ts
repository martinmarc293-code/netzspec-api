/**
 * Do TEXTLINE facts survive the provenance gate? Run their locators through the REAL re-reader.
 *
 *     npx tsx scripts/textline-provenance.ts <extract.json>
 *
 * WHY THIS IS THE TEST THAT MATTERS. The gate re-reads a sample of facts from the cached page and
 * requires the locator to name something holding the raw value. A locator that does not parse is
 * `no_locator`, which the gate counts as a MISS, not a pass — so a new shape whose locator form the
 * auditor cannot resolve does not merely go unverified: it FAILS, and takes its whole batch down
 * with it in a rollback. That is the 6 Sep "the scrapers run but nothing lands" outage, and adding
 * a shape without running this check is how it happens again.
 *
 * It uses reReadSource, the gate's own helper, rather than re-implementing the resolution — the
 * standing rule in this repo is that an audit runs the real code or reads the output the real code
 * recorded. A private copy would grade a different document.
 */
import fs from "node:fs";
import { parseLocator, reReadSource, cellMatches, type ReadItem } from "../src/pipeline/gate-extract.js";

type Fact = { label?: string; value?: string; shape?: string; locator?: string; source_url?: string };

const file = process.argv[2];
if (!file) { console.error("give the adapter output json"); process.exit(2); }
const facts = (JSON.parse(fs.readFileSync(file, "utf8")) as Fact[]).filter((f) => !("__doc__" in (f as object)));

const tl = facts.filter((f) => f.shape === "TEXTLINE");
const tbl = facts.filter((f) => f.shape && f.shape !== "TEXTLINE");
console.log(`  ${tl.length} TEXTLINE facts, ${tbl.length} table facts\n`);
if (!tl.length) { console.log("  NOTHING TO CHECK — this run proves nothing, it is not a pass."); process.exit(2); }

// Both shapes, so a TEXTLINE result can be read against a control from the same document rather
// than against an expectation. A number with no control beside it is a mood.
const sample = [...tl, ...tbl.slice(0, tl.length)];
const items: ReadItem[] = sample.map((f) => ({
  url: String(f.source_url), loc: parseLocator(f.locator), label: String(f.label ?? ""), value: String(f.value ?? ""),
}));

const unparsed = items.filter((i) => i.loc === null).length;
console.log(`  locators that do not parse: ${unparsed}   (each one is a GATE MISS, not an unknown)`);

const res = reReadSource(items);
let ok = 0, mismatch = 0, other = 0;
const bad: string[] = [];
res.forEach((r, i) => {
  const f = sample[i];
  if (r.status !== "ok") { other++; bad.push(`${f.shape} ${f.locator} -> ${r.status} ${r.detail ?? ""}`); return; }
  if (cellMatches(r.cell, String(f.value ?? ""))) ok++;
  else { mismatch++; bad.push(`${f.shape} ${f.locator} holds ${JSON.stringify(String(r.cell).slice(0, 50))}, fact has ${JSON.stringify(String(f.value).slice(0, 50))}`); }
});

const share = (s: string) => {
  const idx = sample.map((f, i) => [f, i] as const).filter(([f]) => (s === "TEXTLINE") === (f.shape === "TEXTLINE"));
  const good = idx.filter(([f, i]) => res[i].status === "ok" && cellMatches(res[i].cell, String(f.value ?? ""))).length;
  return `${good}/${idx.length}` + (idx.length ? ` = ${(100 * good / idx.length).toFixed(0)}%` : "");
};
console.log(`\n  re-read OK and value matches : ${ok}`);
console.log(`  value MISMATCH               : ${mismatch}`);
console.log(`  could not re-read            : ${other}`);
console.log(`\n  TEXTLINE ${share("TEXTLINE")}     table shapes (control) ${share("table")}`);
for (const b of bad.slice(0, 12)) console.log(`    !! ${b}`);
console.log(mismatch + other === 0 ? "\n  every sampled fact re-reads to its own value" : "");
process.exit(mismatch + other === 0 ? 0 : 1);
