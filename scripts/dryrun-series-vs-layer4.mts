/**
 * scripts/dryrun-series-vs-layer4.mts — decision-sheet item 15. WRITES NOTHING.
 *
 *     npx tsx scripts/dryrun-series-vs-layer4.mts
 *
 * `parts.series` (the column `?series=` filters on, and the one profile `cond` conditions test) disagrees with the
 * layer artifact's layer 4 on most placed parts. This answers the only two questions that decide what to do about
 * it, and the second one overturned the obvious answer:
 *
 *   1. WHAT IS THE PART? Split by whole product / component / shared-parts bucket, because the two columns turn out
 *      to answer DIFFERENT questions for components — the column names the PLATFORM a drive belongs to, the artifact
 *      names a layering BUCKET — so a blanket repair would overwrite a real label with a navigation construct.
 *   2. WOULD A REPAIR CHANGE WHAT THE CATALOGUE DEMANDS? `series` is a cond field, and the condition lists were
 *      authored against the COLUMN's spellings, so repairing it switches conditions OFF.
 *
 * Every count prints its denominator, and a control prints the rows where the two already AGREE — a 100%
 * disagreement would be the shape of a broken join, not a finding.
 */
import fs from "node:fs";
import path from "node:path";
import { PROFILES, type Requirement } from "../src/core/fieldSchema.js";
import { kindAndRole } from "../src/api/queries/shared.js";
import { query, closePool } from "../src/store/db.js";
import { REPO_ROOT } from "../src/config.js";

/** Kinds that are a product a buyer chooses, rather than something fitted inside one. */
const WHOLE = new Set(["switch", "router", "access-point", "firewall", "phone", "server", "appliance", "wlc",
  "enterprise", "storage-array", "camera", "codec"]);

// ---- every series name any profile CONDITION tests -----------------------------------------------------------------
const condSeries = new Map<string, Set<string>>();
const walk = (cat: string, node: unknown): void => {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.field === "series") {
    const set = condSeries.get(cat) ?? new Set<string>();
    for (const k of ["inList", "notInList"] as const) for (const v of (o[k] as string[] | undefined) ?? []) set.add(v);
    condSeries.set(cat, set);
  }
  for (const v of Object.values(o)) Array.isArray(v) ? v.forEach((x) => walk(cat, x)) : walk(cat, v);
};
for (const [cat, prof] of Object.entries(PROFILES))
  for (const rule of Object.values(prof as Record<string, Requirement>)) walk(cat, rule);
console.log(`profile conditions test \`series\` in ${condSeries.size} categories, naming `
  + `${[...condSeries.values()].reduce((n, s) => n + s.size, 0)} distinct series:`);
for (const [c, s] of condSeries) console.log(`   ${c.padEnd(28)} ${s.size} names, e.g. ${[...s].slice(0, 2).join(" | ")}`);

// ---- the column against the artifact, for every placed part --------------------------------------------------------
type Row = { sku: string; cat: string; col: string | null; art: string; line: string; kind: string | null };
const rows: Row[] = [];
const dir = path.join(REPO_ROOT, "data", "layers");
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("cisco-") && x.endsWith(".rows.tsv"))) {
  const cat = f.slice("cisco-".length, -".rows.tsv".length);
  const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
  const h = L[0].split("\t"), ci = (n: string) => h.indexOf(n);
  if (ci("sku") < 0 || ci("series") < 0 || ci("product_line") < 0) { console.log(`   !! ${f}: header lacks a needed column, SKIPPED and not counted`); continue; }
  const art = new Map<string, { se: string; pl: string }>();
  for (const l of L.slice(1)) { const c = l.split("\t"); art.set(c[ci("sku")], { se: c[ci("series")], pl: c[ci("product_line")] }); }
  const db = (await query<{ sku: string; series: string | null; name: string | null; product_class: string }>(`
    SELECT p.sku, p.series, p.name, p.product_class::text AS product_class FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
     WHERE v.slug='cisco' AND c.slug=$1 AND p.retired_at IS NULL AND p.sku = ANY($2::text[])`, [cat, [...art.keys()]])).rows;
  for (const d of db) {
    const a = art.get(d.sku)!;
    rows.push({ sku: d.sku, cat, col: d.series, art: a.se, line: a.pl, kind: kindAndRole(cat, d.sku, d.name, d.product_class).kind ?? null });
  }
}
const diff = rows.filter((r) => (r.col ?? "") !== r.art);
console.log(`\n${rows.length.toLocaleString()} live placed parts; ${diff.length.toLocaleString()} disagree `
  + `(${(100 * diff.length / rows.length).toFixed(1)}%)`);

// ---- 1. WHAT IS THE PART -------------------------------------------------------------------------------------------
const isShared = (r: Row) => / shared parts$/.test(r.art);
const whole = diff.filter((r) => r.kind && WHOLE.has(r.kind) && !isShared(r));
const comp = diff.filter((r) => r.kind && !WHOLE.has(r.kind) && !isShared(r));
const shared = diff.filter(isShared);
const unknownKind = diff.filter((r) => !r.kind && !isShared(r));
console.log(`\nWHAT THE DISAGREEING PART IS — three populations needing three different answers:`);
console.log(`  WHOLE PRODUCT     ${String(whole.length).padStart(6)}   the artifact is more precise; a candidate repair`);
console.log(`  COMPONENT         ${String(comp.length).padStart(6)}   DIFFERENT QUESTIONS: column = the platform, artifact = a layering bucket`);
console.log(`  "… shared parts"  ${String(shared.length).padStart(6)}   the artifact value is navigation, never a product series`);
console.log(`  kind unresolved   ${String(unknownKind.length).padStart(6)}   counted here rather than folded into any of the above`);
const show = (t: string, rs: Row[]) => {
  console.log(`\n  ${t} — a SPREAD of ${rs.length}, not the head (both sides sort by category):`);
  for (let i = 0; i < rs.length; i += Math.max(1, Math.floor(rs.length / 6))) {
    const r = rs[i];
    console.log(`    ${String(r.kind).padEnd(12)} ${r.sku.padEnd(20)} column ${JSON.stringify(r.col).padEnd(34)} -> artifact ${JSON.stringify(r.art)}`);
  }
};
show("WHOLE PRODUCTS", whole); show("COMPONENTS", comp); show("SHARED-PARTS BUCKETS", shared);

// ---- 2. WOULD A REPAIR CHANGE WHAT IS DEMANDED ---------------------------------------------------------------------
let flips = 0, gained = 0, lost = 0; const ex: string[] = [];
for (const r of diff) {
  const names = condSeries.get(r.cat); if (!names) continue;
  const was = names.has(r.col ?? ""), now = names.has(r.art);
  if (was === now) continue;
  flips++; was ? lost++ : gained++;
  if (ex.length < 6) ex.push(`${r.cat}/${r.sku}: ${JSON.stringify(r.col)} (${was ? "matched" : "no match"}) -> ${JSON.stringify(r.art)} (${now ? "MATCHES" : "no match"})`);
}
console.log(`\nPARTS WHOSE PROFILE-CONDITION MEMBERSHIP WOULD FLIP: ${flips}  (would STOP matching ${lost}, would START matching ${gained})`);
for (const e of ex) console.log(`   ${e}`);
console.log(flips === 0
  ? `  -> a relabelling only: no requirement changes.`
  : `  -> NOT a relabelling. ${lost} parts would stop matching a condition, so ${lost > gained ? "a repair SWITCHES REQUIREMENTS OFF" : "requirements move both ways"}; the condition\n     lists were authored against the COLUMN's spellings and must be rewritten in the same commit as any repair.`);

console.log(`\nCONTROL rows where the column ALREADY equals the artifact: ${(rows.length - diff.length).toLocaleString()}`);
console.log(`(a 0 there would mean a broken comparison, not a 100% defect rate)`);
await closePool();
