// scripts/derive-shipping-class.mts — FINAL FILL ORDER item 4 (reviewer, 30 Sep 2026): "small components (optics, cables, cords,
// DIMMs, drives, CPUs, blanks, brackets, kits) get Versandgewicht from a shipping-class table (class -> kg, recorded as
// derived:shipping-class with the table as witness); Artikelgewicht stays EMPTY until a measured weight exists." Fans included
// by the reviewer's verdict of 30 Sep.
//
//     npx tsx scripts/derive-shipping-class.mts [--commit]
//
// Population: live Cisco hardware whose (category, kind) the table lists (src/core/shippingClass.ts) and that has NO served
// weight -- a part with a measured weight takes its Versandgewicht from derive-shipping-weight (ruling Q23), never from here.
// A served shipping_weight by any other method is kept (counted); the same derivation already right is left; a gap row, or an
// older derived:shipping-class the table has since moved, is superseded. The write is idempotent in itself.
//
// THE TABLE AS WITNESS: a verified fact needs a document (facts_verified_needs_source), and the witness here is the table, so the
// table is registered as a source_doc of type `reference_table` whose URL carries the table's sha256 -- a changed table is a new
// witness, never a stale hash under an old one. `reference_table` is not a spec-bearing type (heldEvidence.SPEC_BEARING_DOC_TYPES),
// so the witness can never make a part "held". The plan TSV is the undo, unique per invocation.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, supersedeFact, ensureSourceDoc } from "../src/store/index.js";
import { NORM_VERSION } from "../src/core/specNormalize.js";
import { shippingClassOf, shippingClassRaw, SHIPPING_CLASS_FILE } from "../src/core/shippingClass.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import { partKind } from "../src/core/partKind.js";
import { SPEC_BEARING_DOC_TYPES } from "../src/core/heldEvidence.js";
import type { SpecEntry } from "../src/core/specMerge.js";

export const METHOD = "derived:shipping-class";
const DOC_TYPE = "reference_table";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = process.argv.includes("--commit");
if (SPEC_BEARING_DOC_TYPES.includes(DOC_TYPE)) throw new Error(`${DOC_TYPE} is spec-bearing: the witness would make parts held`);
const sha = createHash("sha256").update(fs.readFileSync(SHIPPING_CLASS_FILE)).digest("hex");
const WITNESS_URL = `netzspec://reference/shipping-classes.json#sha256=${sha.slice(0, 16)}`;
const db = getPool();

const parts = (await db.query<{ id: number; sku: string; name: string | null; category: string }>(
  `SELECT p.id, p.sku, p.name, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' ORDER BY p.sku`)).rows;
const inClass = parts.map((p) => ({ p, c: shippingClassOf(p.category, partKind(p.category, p.sku, p.name ?? undefined)) })).filter((x) => x.c);
const ids = inClass.map((x) => x.p.id);
const cur = new Map<string, { part_id: number; key: string; id: number; method: string; value: unknown; state: string }>();
for (const r of (await db.query<{ part_id: number; key: string; id: number; method: string; value: unknown; state: string }>(
  `SELECT part_id, field_key AS key, id, method, value, state::text AS state FROM facts
    WHERE superseded_by IS NULL AND field_key IN ('weight', 'shipping_weight') AND part_id = ANY($1::bigint[])`, [ids])).rows) cur.set(`${r.part_id}|${r.key}`, r);

type Plan = { sku: string; partId: number; entry: SpecEntry; replaces: number | null; was: string; cls: string };
const plans: Plan[] = [];
const refused: string[] = [];
let measured = 0, keptOther = 0, alreadyRight = 0;
const byClass = new Map<string, number>();
for (const { p, c } of inClass) {
  const w = cur.get(`${p.id}|weight`);
  if (w && w.value !== null && (w.state === "verified" || w.state === "corroborated")) { measured++; continue; }
  const raw = shippingClassRaw(c!);
  const replay = replayDerived(METHOD, raw);
  if (replay) { refused.push(`${p.sku}: ${replay.reason} ${replay.detail}`); continue; }
  const s = cur.get(`${p.id}|shipping_weight`);
  if (s && s.value !== null && s.method !== METHOD) { keptOther++; continue; }
  if (s && s.method === METHOD && Number(s.value) === c!.kg) { alreadyRight++; continue; }
  const cls = `${c!.category}/${c!.kind} ${c!.tier}`;
  byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
  plans.push({ sku: p.sku, partId: p.id, replaces: s?.id ?? null, was: s ? `${s.state} ${s.method}` : "", cls, entry: {
    k: "shipping_weight", raw, value: c!.kg, unit: "kg", state: "verified",
    prov: { tier: 2, method: METHOD, doc_id: undefined, locator: `class:${c!.category}/${c!.kind}`, extracted_at: new Date().toISOString().slice(0, 10), norm_v: NORM_VERSION },
  } });
}
console.log(`derived:shipping-class: ${inClass.length} live parts of a listed (category, kind) (table sha256 ${sha.slice(0, 12)}); ${plans.length} to write ` +
  `(${plans.filter((x) => x.replaces).length} superseding), ${measured} have a measured weight (Q23's lane), ${keptOther} keep another shipping weight, ` +
  `${alreadyRight} already right, ${refused.length} refused`);
for (const [cls, n] of [...byClass].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${cls}`);
if (refused.length) { console.error(`REFUSED, nothing written:\n  ${refused.slice(0, 20).join("\n  ")}`); await closePool(); process.exit(2); }
const planFile = path.join(ROOT, "data", "dryrun", `derive-shipping-class-${new Date().toISOString().replace(/[:.]/g, "")}${commit ? "" : "-dry"}.tsv`);
fs.mkdirSync(path.dirname(planFile), { recursive: true });
fs.writeFileSync(planFile, ["sku\tpart_id\tkg\tclass\tsupersedes\twas", ...plans.map((x) => [x.sku, x.partId, x.entry.value, x.cls, x.replaces ?? "", x.was].join("\t"))].join("\n") + "\n");
console.log(`plan: ${path.relative(ROOT, planFile)}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
const out = await withRun("derive-shipping-class", {
  table: path.relative(ROOT, SHIPPING_CLASS_FILE), table_sha256: sha, witness_url: WITNESS_URL, planned: plans.length, plan: path.relative(ROOT, planFile),
  approved: "FINAL FILL ORDER item 4 (reviewer, 30 Sep 2026): small components get Versandgewicht from a shipping-class table, derived:shipping-class, the table as witness; fans included by the verdict of 30 Sep",
}, async (runId) => withTx(async (client) => {
  const docId = await ensureSourceDoc({ url: WITNESS_URL, doc_type: DOC_TYPE, vendor: null, title: "netzspec shipping-class table (FINAL FILL ORDER item 4)",
    fetched_at: new Date().toISOString().slice(0, 10), content_sha256: sha, cache_path: null }, client);
  for (const x of plans) {
    const e = { ...x.entry, prov: { ...x.entry.prov, doc_id: docId } };
    if (x.replaces) await supersedeFact(client, x.replaces, e, runId);
    else await insertFact(client, x.partId, e, runId);
  }
  // the gate: every raw replays to its value through the registered derivation (checked before the transaction), and the witness
  // document is the table whose sha256 is in the run's inputs
  const gate = { method: "every raw replays through derived:shipping-class against the table named by sha256", sampled: plans.length, checked: plans.length,
    unreadable: 0, precision: 1, recall: 1, passed: refused.length === 0 };
  return { stats: { written: plans.length, superseded: plans.filter((x) => x.replaces).length, measured_weight: measured, kept_other: keptOther, already_right: alreadyRight }, gate };
}));
console.log(`run ${out.runId}: wrote ${plans.length} derived:shipping-class facts`);
await closePool();
