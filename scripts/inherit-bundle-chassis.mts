// scripts/inherit-bundle-chassis.mts — a LICENCE BUNDLE takes its base chassis's physical facts (reviewer ruling, 6 Oct 2026).
//
//     npx tsx scripts/inherit-bundle-chassis.mts [--category routers] [--commit]
//
// The ruling, verbatim (6 Oct ~20:40, on "37 parts gain a weight now; hardware affixes (-V, -VA, -4G, -LTE, W) excluded"):
// "(b) Yes — the -SEC/-AX/-AXV/-HSEC/C1- bundles are the same box with a licence; inherit the base chassis's physical facts
// (inherited_from = base PID, state filled-inherited). Hardware affixes excluded, as you have it."
//
// The population is EXACTLY: a live Cisco hardware part V in the category whose SKU is a live part M's SKU plus licence affixes
// only -- a "C1-" (Cisco ONE) prefix and/or ONE of -SEC, -AX, -AXV, -HSEC, -HSEC+ before the "/K9" -- where V and M share
// category and kind. A hardware affix (-V voice PVDM, -VA/-4G/-LTE/-SHDSL modules, -WAE/-SRE engines, a W wireless radio, -DC/
// -POE power builds) is never stripped, so such a SKU has no base here and is never planned.
//
// THE KEYS are the chassis's physical and compliance facts (PHYSICAL below): the same box ships under the licence, so its weight,
// size, power, environment and certifications are the box's. Throughput, crypto, QoS and memory are NOT copied -- they can depend
// on the licence or the factory build. A key V already holds in any current state is never touched (no overwrite), so the write
// is idempotent in itself.
//
// Each fact is M's CURRENT served fact (verified / corroborated) with a document, written THROUGH applyMerge -- the one
// inheritance gate every writer passes -- carrying M's provenance (document, locator, tier, method, raw): inherited = true,
// inherited_from = M's SKU. A fact of M's that is itself derived or has no document is refused and named, never copied.
//
// GATE: every distinct M fact is re-read on its cached page -- M's SKU and the head of the fact's own raw cell must both be
// printed there. An unreadable page is counted apart and fails the run (could not check is not a pass). After the write a re-plan
// must find nothing.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { applyMerge, retractFact } from "../src/store/facts.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import { planFile as planFileAt } from "../src/core/planFile.js";
import type { SpecEntry, FieldState } from "../src/core/specMerge.js";
import { subjectRefusal } from "../src/core/docSubject.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const commit = process.argv.includes("--commit");
const CATEGORY = arg("--category") ?? "routers";
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;

/** The chassis's physical and compliance facts: what the same box carries whatever licence it ships under. */
export const PHYSICAL = new Set([
  "weight", "dimensions", "rack_units", "wall_mount", "airflow", "acoustic_noise", "acoustic_sound_power",
  "temp_operating", "temp_short_term", "temp_storage", "humidity_operating", "humidity_storage", "altitude_max", "altitude_storage",
  "input_current", "input_freq", "input_voltage", "inrush_current", "power_max", "power_max_dc", "power_typical", "psu_options",
  "mtbf", "module_slots", "usb_ports", "oir_support", "certifications", "emc_emissions", "emc_immunity", "shipping_dimensions",
]);
/** Licence affixes: each sells software on the same box. Anything else in a SKU is hardware and is never stripped.
 *  -FC (Flexible Consumption), reviewer 6 Oct ~23:35 (verbatim): "B: yes — -FC joins the licence affixes; physical facts flow both
 *  ways between the -FC and the base, nothing else." (NC57-MPA-12L-S and -FC carry the same catalogue name.) */
const LICENCE_AFFIX = /-(?:SEC|AXV|AX|HSEC\+?|FC)(?=\/K9$|-K9$|$)/;
/** The affixes whose physical facts flow BOTH ways (base <- variant too, where only the variant is printed). */
export const BOTH_WAYS_AFFIX = new Set(["FC"]);
/** Sales variants named one by one, never by a suffix rule (reviewer ~23:35, C: "depends on what the bundle contains — read their
 *  catalogue names first. If a bundle adds only software or a licence, it inherits like (b); if it adds hardware ... the AXV rule").
 *  Read 6 Oct ~23:40: both carry the RP1's own name and DRAM with only a sales qualifier -- no hardware added. A "-BUN" elsewhere
 *  (40X10G-LSP-BUN=) is a linecard bundle that DOES carry hardware, which is why this is a list and not a pattern. */
export const SALES_VARIANT: ReadonlyMap<string, { base: string; name: string }> = new Map([
  ["ASR1000-RP1-BUN", { base: "ASR1000-RP1", name: "Cisco ASR1000 Route Processor 1, 4GB DRAM, Bundle Component" }],
  ["ASR1000-RP1-CB", { base: "ASR1000-RP1", name: "ASR1000 Route Processor 1, 4GB DRAM, China Special" }],
]);
/** Bundles that carry a module INSIDE the chassis (reviewer, 6 Oct ~21:20, correcting (b) on its premise): AXV ships a PVDM4 DSP
 *  ("ISR 4331 AXV Bundle, PVDM4-32 ..."), HSEC+ a VPN ISM module ("VPN ISM module HSEC bundles ..."; HSEC without + says "no ISM
 *  VPN module"). "Their module makes them a different physical object. Keep dimensions, environment, certifications." */
export const MODULE_AFFIX = new Set(["AXV", "HSEC+"]);
export const MODULE_SENSITIVE = new Set(["weight", "power_typical", "power_max", "power_max_dc", "input_current", "mtbf"]);
/** "SEC/AX bundles inherit router_throughput: the stated value is the standard-licence throughput, and a technology package
 *  doesn't change it. AXV excluded." (reviewer, 6 Oct ~21:20) */
export const THROUGHPUT_AFFIX = new Set(["SEC", "AX"]);
/** Derived base facts a bundle may copy: the registered weight derivations, each tied to a re-read page (DERIVED_FILL_PATHS.weight). */
export const COPYABLE_DERIVED = new Set(["derived:model-row", "derived:family-row", "derived:max-bound"]);
/** The licence affix a bundle SKU carries ("SEC", "AX", "AXV", "HSEC", "HSEC+"), or null (a C1- prefix alone, or no bundle). */
export function bundleAffix(sku: string): string | null {
  const m = LICENCE_AFFIX.exec(sku.toUpperCase().replace(/^C1-/, ""));
  return m ? m[0].slice(1) : null;
}
/** The keys a bundle takes from its base: the physical set, minus weight and power where a module sits inside, plus the
 *  standard-licence throughput where the affix is a technology package. */
export function keysFor(sku: string): Set<string> {
  const a = bundleAffix(sku);
  const keys = new Set([...PHYSICAL].filter((k) => !(a && MODULE_AFFIX.has(a) && MODULE_SENSITIVE.has(k))));
  if (a && THROUGHPUT_AFFIX.has(a)) keys.add("router_throughput");
  return keys;
}

/** The base chassis SKU a licence bundle names, or null when the SKU carries no licence affix at all. */
export function bundleBase(sku: string): string | null {
  const sales = SALES_VARIANT.get(sku.toUpperCase());
  if (sales) return sales.base;
  let s = sku.toUpperCase(), changed = false;
  if (s.startsWith("C1-")) { s = s.slice(3); changed = true; }
  const t = s.replace(LICENCE_AFFIX, "");
  if (t !== s) { s = t; changed = true; }
  return changed ? s : null;
}

type MFact = { id: string; sku: string; key: string; value: unknown; unit: string | null; raw: string; method: string; tier: number;
  state: FieldState; doc_id: string | null; locator: string | null; extracted_at: string | null; norm_v: string | null;
  truncated: boolean; inherited: boolean; cache_path: string | null; title: string | null };
type Plan = { vId: number; vSku: string; m: MFact };

const db = getPool();
async function plan(): Promise<{ plans: Plan[]; refused: string[]; bundles: number }> {
  const parts = (await db.query<{ id: number; sku: string; kind: string | null; name: string | null; product_class: string | null }>(`
    SELECT p.id, p.sku, p.sku_kind AS kind, p.name, p.product_class::text AS product_class FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = 'cisco' AND c.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'`, [CATEGORY])).rows;
  const bySku = new Map(parts.map((p) => [p.sku.toUpperCase(), p]));
  const forward = parts.map((v) => ({ v, m: bundleBase(v.sku) ? bySku.get(bundleBase(v.sku)!) : undefined })).filter((x) => x.m);
  // -FC flows both ways: the base also takes the variant's physical facts where only the variant is printed (keysFor(base) is the
  // physical set alone -- no throughput, no other key: "physical facts ... nothing else")
  const pairs = [...forward, ...forward.filter(({ v }) => BOTH_WAYS_AFFIX.has(bundleAffix(v.sku) ?? "")).map(({ v, m }) => ({ v: m!, m: v }))];
  const refused: string[] = [];
  const ok = pairs.filter(({ v, m }) => {
    if (m!.kind !== v.kind) { refused.push(`${v.sku}: kind ${v.kind} is not its base ${m!.sku}'s ${m!.kind}`); return false; }
    return true;
  });
  const ids = [...new Set(ok.flatMap(({ v, m }) => [v.id, m!.id]))];
  const facts = (await db.query<MFact & { part_id: number }>(`
    SELECT f.part_id, p.sku, f.id::text, f.field_key AS key, f.value, f.unit, f.raw, f.method, f.tier, f.state::text AS state, f.doc_id,
           f.locator, f.extracted_at::text AS extracted_at, f.norm_v, f.truncated, f.inherited, sd.cache_path, sd.title
      FROM facts f JOIN parts p ON p.id = f.part_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`, [ids])).rows;
  const held = new Set(facts.map((f) => `${f.part_id}|${f.key}`));
  const plans: Plan[] = [];
  for (const { v, m } of ok) {
    const keys = keysFor(v.sku);
    for (const f of facts.filter((x) => x.part_id === m!.id && keys.has(x.key) && ["verified", "corroborated"].includes(x.state))) {
      if (held.has(`${v.id}|${f.key}`)) continue;
      // a READ is copied, and so is a REGISTERED weight derivation that names its page (derived:model-row, derived:max-bound --
      // reviewer 6 Oct ~21:40: "Then the bundle re-run for the 1921 family"): the method travels with it, so a max stays a max
      if (!f.doc_id || (f.method.startsWith("derived:") && !COPYABLE_DERIVED.has(f.method))) { refused.push(`${v.sku} ${f.key}: the base's fact is ${f.method} with ${f.doc_id ? "a" : "no"} document -- only a read or a registered weight derivation is copied`); continue; }
      // THE STORE'S OWN SUBJECT GATE, asked before planning (run 1540 failed on it, 6 Oct ~23:45): the NCS 55A2 CHASSIS sheet's MPA
      // class weight cannot flow to NC55-MPA-2TH-S-FC, a module that sheet does not print -- the plan must agree with the store, or the
      // all-or-nothing commit below rolls back every other fact with it. A refusal here is recorded, never written.
      const subj = subjectRefusal({ vendor: "cisco", docId: f.doc_id, title: f.title, categorySlug: CATEGORY, sku: v.sku, name: v.name, productClass: v.product_class });
      if (subj) { refused.push(`${v.sku} ${f.key}: ${subj.reason} (the store's subject gate, asked before planning)`); continue; }
      plans.push({ vId: v.id, vSku: v.sku, m: f });
    }
  }
  plans.sort((a, b) => a.vSku.localeCompare(b.vSku) || a.m.key.localeCompare(b.m.key));
  return { plans, refused, bundles: ok.length };
}

// ---- RETRACT MODE (reviewer, 6 Oct ~21:20, FLAG 1): withdraw what this writer put on a MODULE bundle's weight and power keys
// before the module affixes were known (run 1517). keysFor() never plans those keys again, so the retraction stays retracted.
if (process.argv.includes("--retract-module")) {
  const sel = (await db.query<{ id: string; sku: string; key: string; inherited: boolean }>(`
    SELECT f.id::text, p.sku, f.field_key AS key, f.inherited FROM facts f JOIN parts p ON p.id = f.part_id
      JOIN categories c ON c.id = p.category_id JOIN runs r ON r.id = f.run_id
     WHERE c.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'
       AND r.kind = 'inherit-bundle-chassis' AND f.field_key = ANY($2::text[])`, [CATEGORY, [...MODULE_SENSITIVE]])).rows
    .filter((f) => MODULE_AFFIX.has(bundleAffix(f.sku) ?? ""));
  // gate: precision = each selected fact re-checked by the rule's own predicates; recall = an INDEPENDENT count by SKU pattern
  const ok = sel.filter((f) => f.inherited && MODULE_SENSITIVE.has(f.key) && MODULE_AFFIX.has(bundleAffix(f.sku) ?? "")).length;
  const counted = (await db.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN runs r ON r.id = f.run_id
     WHERE c.slug = $1 AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' AND r.kind = 'inherit-bundle-chassis'
       AND f.field_key = ANY($2::text[]) AND (upper(p.sku) LIKE '%-AXV/K9' OR upper(p.sku) LIKE '%-HSEC+/K9')`, [CATEGORY, [...MODULE_SENSITIVE]])).rows[0].n;
  const hi = Math.max(counted, sel.length);
  const rgate = { method: "each fact re-checked (inherited, module affix, weight/power key, written by inherit-bundle-chassis); recall = an independent SKU-pattern count",
    sampled: sel.length, checked: sel.length, unreadable: 0, precision: sel.length ? ok / sel.length : 1, recall: hi ? Math.min(counted, sel.length) / hi : 1,
    passed: ok === sel.length && counted === sel.length, counted };
  const bySku: Record<string, string[]> = {};
  for (const f of sel) (bySku[f.sku] ??= []).push(f.key);
  console.log(`retract-module (${CATEGORY}): ${sel.length} facts on ${Object.keys(bySku).length} module bundles; gate ${JSON.stringify(rgate)}`);
  for (const [s, ks] of Object.entries(bySku)) console.log(`  ${s.padEnd(20)} ${ks.sort().join(", ")}`);
  if (!rgate.passed) { console.error("GATE FAILED, nothing retracted"); await closePool(); process.exit(2); }
  if (!commit) { console.log("DRY RUN: nothing retracted. Re-run with --commit."); await closePool(); process.exit(0); }
  let rsha: string | undefined = process.env.GIT_SHA;
  if (!rsha) try { rsha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { rsha = undefined; }
  const rout = await withRun("retract-bundle-module-facts", { category: CATEGORY, fact_ids: sel.map((f) => f.id), by_sku: bySku,
    approved: "reviewer 6 Oct 2026 ~21:20, FLAG 1: approve -- retract the six physical-power/weight facts on the 11 AXV/HSEC+ bundles; their module makes them a different physical object. Keep dimensions, environment, certifications. HSEC (no +) stays." },
    async (runId) => withTx(async (client) => {
      for (const f of sel) await retractFact(client, Number(f.id), "bundle-module-not-chassis", runId);
      return { stats: { retracted: sel.length, bundles: Object.keys(bySku).length }, gate: rgate };
    }), { gitSha: rsha });
  console.log(`COMMITTED run ${rout.runId}: retracted ${sel.length} facts on ${Object.keys(bySku).length} bundles`);
  await closePool();
  process.exit(0);
}

const { plans, refused, bundles } = await plan();
// GATE: each distinct base fact re-read on its cached page -- the base SKU and the head of its own raw cell both printed there.
// A raw stored in the "<label> | <cell>" replay form is two cells on the page, so EACH segment's head must be printed (the label
// and the value both, which is stricter than the value alone); a merged list's raw is "cellA ; cellB" and its first cell is read.
const heads = (raw: string) => raw.split(" ; ")[0].split(" | ").map((s) => ws(s).slice(0, 32).trim()).filter(Boolean);
const head = (raw: string) => heads(raw).join(" + ");
let checked = 0, hits = 0, unreadable = 0;
const misses: string[] = [];
const seen = new Map<string, boolean>();
for (const p of plans) {
  if (seen.has(p.m.id)) continue;
  const text = cachedText(p.m.cache_path, CACHE);
  if (text === null) { unreadable++; seen.set(p.m.id, false); misses.push(`${p.m.sku} ${p.m.key}: ${p.m.doc_id} not readable from the cache`); continue; }
  checked++;
  const ok = text.includes(ws(p.m.sku)) && heads(p.m.raw).every((h) => text.includes(h));
  if (ok) hits++; else misses.push(`${p.m.sku} ${p.m.key}: ${p.m.doc_id} does not print "${p.m.sku}" and "${head(p.m.raw)}"`);
  seen.set(p.m.id, ok);
}
const precision = checked ? hits / checked : plans.length ? 0 : 1;
// recall = the share of the plan's base facts that could be re-read at all: an unreadable page is not a pass (closeRun requires it;
// run 1516 was refused at close without it and rolled back with 0 facts)
const recall = seen.size ? (seen.size - unreadable) / seen.size : 1;
const gate = { method: "every base fact re-read on its cached page: the base SKU and the head of the fact's raw cell", sampled: seen.size, checked,
  unreadable, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
  passed: plans.length === 0 || (precision === 1 && unreadable === 0), misses: misses.slice(0, 12) };

const planPath = planFileAt(ROOT, "inherit-bundle-chassis");
fs.mkdirSync(path.dirname(planPath), { recursive: true });
fs.writeFileSync(planPath, ["part_id\tsku\taction\tbase\tkey\tmethod\tdoc_id\tlocator\traw",
  ...plans.map((p) => `${p.vId}\t${p.vSku}\twrite\t${p.m.sku}\t${p.m.key}\t${p.m.method}\t${p.m.doc_id}\t${p.m.locator}\t${JSON.stringify(p.m.raw.slice(0, 200))}`),
  ...refused.map((r) => `\t\trefused\t\t\t\t\t\t${JSON.stringify(r)}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
const byKey: Record<string, number> = {};
for (const p of plans) byKey[p.m.key] = (byKey[p.m.key] ?? 0) + 1;
console.log(`inherit-bundle-chassis (${CATEGORY}): ${bundles} licence bundles with a live base of the same kind; ${plans.length} facts to write on ` +
  `${new Set(plans.map((p) => p.vId)).size} bundles, ${refused.length} refused; by key ${JSON.stringify(byKey)}`);
console.log(`gate ${JSON.stringify(gate)} -> ${path.relative(ROOT, planPath)} (sha256 ${planSha.slice(0, 12)})`);
for (const sku of [...new Set(plans.map((p) => `${p.vSku} <- ${p.m.sku}`))].slice(0, 40)) console.log(`  ${sku}`);
for (const r of refused.slice(0, 20)) console.log(`  REFUSED ${r}`);
if (!gate.passed) { console.error(`GATE FAILED, nothing written: ${misses.slice(0, 12).join("; ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("inherit-bundle-chassis", {
  category: CATEGORY, planned: plans.length, refused: refused.length, plan: path.relative(ROOT, planPath), plan_sha256: planSha,
  approved: "reviewer ruling 6 Oct 2026 ~20:40: (b) Yes -- the -SEC/-AX/-AXV/-HSEC/C1- bundles are the same box with a licence; inherit the base chassis's physical facts (inherited_from = base PID, state filled-inherited). Hardware affixes excluded" +
    "; reviewer ~23:35: 'B: yes -- -FC joins the licence affixes; physical facts flow both ways between the -FC and the base, nothing else.' and 'C: ... If a bundle adds only software or a licence, it inherits like (b)' (ASR1000-RP1-BUN / -RP1-CB: names read, RP1 + a sales qualifier)",
}, async (runId) => withTx(async (client) => {
  const actions: Record<string, number> = {};
  const notInserted: string[] = [];
  for (const p of plans) {
    const entry: SpecEntry = {
      k: p.m.key, raw: p.m.raw, value: p.m.value, unit: p.m.unit ?? undefined, state: "verified",
      inherited: true, inherited_from: p.m.sku, ...(p.m.truncated ? { truncated: true } : {}),
      prov: { tier: p.m.tier, method: p.m.method, doc_id: p.m.doc_id ?? undefined, locator: p.m.locator ?? undefined,
        extracted_at: p.m.extracted_at ?? undefined, norm_v: p.m.norm_v ?? undefined },
    };
    const r = await applyMerge(client, p.vId, entry, runId);
    actions[r.action] = (actions[r.action] ?? 0) + 1;
    if (r.action !== "insert") notInserted.push(`${p.vSku} ${p.m.key}: ${r.action}${"refused" in r && r.refused ? ` (${r.refused})` : ""}`);
  }
  // every planned fact must have been INSERTED: a refusal by the inheritance gate means the plan and the store disagree, and the
  // transaction is rolled back rather than half-applied
  if (notInserted.length) throw new Error(`inherit-bundle-chassis: ${notInserted.length} planned facts were not inserted: ${notInserted.slice(0, 10).join("; ")}`);
  return { stats: { written: plans.length, refused: refused.length, ...actions }, gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.plans.length}`);
if (again.plans.length) { console.error("the write did not take"); process.exitCode = 1; }
await closePool();
