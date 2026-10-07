// scripts/inherit-spare.mts — a SPARE ("PID=") and its base PID share their spec facts (reviewer ruling, 7 Oct 2026).
//
//     npx tsx scripts/inherit-spare.mts [--category routers] [--commit]
//
// The ruling and its exclusions are quoted in src/core/spareInherit.ts, which holds the pure rules this script plans with.
//
// THE POPULATION is exactly a stored spare_of edge (build-spare-of.mts, Cisco's trailing "=") whose two ends are live HARDWARE parts
// of the category and of the same kind, whose SKUs are base + one "=" (re-asked, never trusted), and whose catalogue names do not
// say kit, bundle, licence or a different configuration (spareNameRefusal). A licence pair (FLS-A901-4S= "Paper License") is not
// hardware and never planned: licences are how a part is ordered.
//
// THE KEYS are every cup except box contents, ordering and lifecycle (SPARE_NOT_INHERITED, LIFECYCLE_KEY). BOTH WAYS: the base
// gives to the spare, and the spare gives to its base where only the spare is printed (as for -FC). A key the receiver already
// holds in ANY current state is never touched -- "where both sides hold read values, neither overwrites the other: a disagreement
// stays a conflict" -- so the write is idempotent in itself.
//
// Each fact is the giver's CURRENT served fact (verified / corroborated) with a document: a read, or a registered weight derivation
// (COPYABLE_DERIVED, the method travels so a max stays a max). It is written THROUGH applyMerge -- the one inheritance gate every
// writer passes -- carrying the giver's provenance: inherited = true, inherited_from = the giver's SKU. The store's gates
// (describesPart, the subject gate, applicability) are ASKED BEFORE PLANNING, so the plan agrees with the store and the
// all-or-nothing commit never rolls back on a refusal (run 1540).
//
// GATE: every distinct giver fact re-read on its cached page -- the head of its own raw cell printed there, and for a fact the giver
// READ for itself (not inherited) the giver's SKU too. An unreadable page fails the run. After the write a re-plan must find nothing.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { applyMerge } from "../src/store/facts.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";
import { planFile as planFileAt } from "../src/core/planFile.js";
import { notApplicable, type SpecEntry } from "../src/core/specMerge.js";
import { COPYABLE_DERIVED, exactSparePair, spareGate, spareKeyRefusal, spareNameRefusal, type GateReceiver } from "../src/core/spareInherit.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const commit = process.argv.includes("--commit");
const CATEGORY = arg("--category") ?? "routers";
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;

type Part = { id: number; sku: string; kind: string | null; name: string | null; product_class: string | null; family: string | null; product_series: string | null };
type GFact = { id: string; part_id: number; sku: string; key: string; value: unknown; unit: string | null; raw: string; method: string; tier: number;
  state: string; doc_id: string | null; locator: string | null; extracted_at: string | null; norm_v: string | null; truncated: boolean;
  inherited: boolean; cache_path: string | null; title: string | null };
type Plan = { to: Part; dir: "base->spare" | "spare->base"; g: GFact };

const db = getPool();
const rcv = (p: Part): GateReceiver => ({ sku: p.sku, name: p.name, product_class: p.product_class, category_slug: CATEGORY, family: p.family, product_series: p.product_series, vendor_slug: "cisco" });
async function plan(): Promise<{ plans: Plan[]; refused: string[]; pairs: number; nameRefused: string[]; partnerRefused: string[]; viaPartner: number }> {
  const rows = (await db.query<{ s: Part; b: Part }>(`
    SELECT json_build_object('id', s.id, 'sku', s.sku, 'kind', s.sku_kind, 'name', s.name, 'product_class', s.product_class, 'family', s.family, 'product_series', s.product_series) AS s,
           json_build_object('id', b.id, 'sku', b.sku, 'kind', b.sku_kind, 'name', b.name, 'product_class', b.product_class, 'family', b.family, 'product_series', b.product_series) AS b
      FROM relations r JOIN parts s ON s.id = r.from_part_id JOIN parts b ON b.id = r.to_part_id
      JOIN vendors v ON v.id = s.vendor_id JOIN categories cs ON cs.id = s.category_id JOIN categories cb ON cb.id = b.category_id
     WHERE r.kind = 'spare_of' AND v.slug = 'cisco' AND cs.slug = $1 AND cb.slug = $1 AND s.retired_at IS NULL AND b.retired_at IS NULL`, [CATEGORY])).rows;
  const refused: string[] = [], nameRefused: string[] = [], partnerRefused: string[] = [];
  let viaPartner = 0;
  const ok = rows.filter(({ s, b }) => {
    if (s.product_class !== "hardware" || b.product_class !== "hardware") { refused.push(`${s.sku}: ${s.product_class}/${b.product_class}, not a hardware pair (licences are ordering)`); return false; }
    if (!exactSparePair(s.sku, b.sku)) { refused.push(`${s.sku}: spare_of names ${b.sku}, not its SKU minus one "="`); return false; }
    if (s.kind !== b.kind) { refused.push(`${s.sku}: kind ${s.kind} is not its base ${b.sku}'s ${b.kind}`); return false; }
    const why = spareNameRefusal(s.name, b.name);
    if (why) { nameRefused.push(`${s.sku}: ${why} -- "${s.name}" vs "${b.name}"`); return false; }
    return true;
  });
  const ids = [...new Set(ok.flatMap(({ s, b }) => [s.id, b.id]))];
  const facts = (await db.query<GFact>(`
    SELECT f.id::text, f.part_id::int AS part_id, p.sku, f.field_key AS key, f.value, f.unit, f.raw, f.method, f.tier, f.state::text AS state, f.doc_id,
           f.locator, f.extracted_at::text AS extracted_at, f.norm_v, f.truncated, f.inherited, sd.cache_path, sd.title
      FROM facts f JOIN parts p ON p.id = f.part_id LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
     WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%'`, [ids])).rows;
  const held = new Set(facts.map((f) => `${f.part_id}|${f.key}`));
  const plans: Plan[] = [];
  const give = (from: Part, to: Part, dir: Plan["dir"]) => {
    for (const f of facts.filter((x) => x.part_id === from.id && ["verified", "corroborated"].includes(x.state))) {
      if (held.has(`${to.id}|${f.key}`)) continue;
      const kr = spareKeyRefusal(f.key);
      if (kr) { refused.push(`${to.sku} ${f.key}: ${kr}`); continue; }
      if (!f.doc_id || (f.method.startsWith("derived:") && !COPYABLE_DERIVED.has(f.method))) { refused.push(`${to.sku} ${f.key}: the giver's fact is ${f.method} with ${f.doc_id ? "a" : "no"} document -- only a read or a registered weight derivation is copied`); continue; }
      // THE STORE'S OWN GATES, asked before planning with exactly the inputs applyMerge will give them -- including ruling (A):
      // a refusal for the receiver is asked again with its spare_of partner (here: the giver) as receiver
      const g = spareGate(rcv(to), rcv(from), { docId: f.doc_id, docTitle: f.title, inheritedFrom: from.sku });
      if (g.refusal) {
        (g.answeredBy === "partner" ? partnerRefused : refused).push(`${to.sku} ${f.key}: ${g.refusal.rule} ${g.refusal.reason} [giver fact ${f.inherited ? "inherited" : "own read"} ${f.method}]`);
        continue;
      }
      if (g.receiverRefusal) viaPartner++;
      const na = notApplicable({ sku: to.sku, categorySlug: CATEGORY, fieldKey: f.key });
      if (na) { refused.push(`${to.sku} ${f.key}: ${na.rule} ${na.reason}`); continue; }
      plans.push({ to, dir, g: f });
    }
  };
  for (const { s, b } of ok) { give(b, s, "base->spare"); give(s, b, "spare->base"); }
  plans.sort((a, b) => a.to.sku.localeCompare(b.to.sku) || a.g.key.localeCompare(b.g.key));
  return { plans, refused, pairs: ok.length, nameRefused, partnerRefused, viaPartner };
}

const { plans, refused, pairs, nameRefused, partnerRefused, viaPartner } = await plan();
// GATE: each distinct giver fact re-read on its cached page. A raw in the "<label> | <cell>" replay form is two cells, so EACH
// segment's head must be printed; a merged list's raw "cellA ; cellB" is read by its first cell (as inherit-bundle-chassis does).
const heads = (raw: string) => raw.split(" ; ")[0].split(" | ").map((s) => ws(s).slice(0, 32).trim()).filter(Boolean);
let checked = 0, hits = 0, unreadable = 0;
const misses: string[] = [];
const seen = new Map<string, boolean>();
for (const p of plans) {
  if (seen.has(p.g.id)) continue;
  const text = cachedText(p.g.cache_path, CACHE);
  if (text === null) { unreadable++; seen.set(p.g.id, false); misses.push(`${p.g.sku} ${p.g.key}: ${p.g.doc_id} not readable from the cache`); continue; }
  checked++;
  const ok = (p.g.inherited || text.includes(ws(p.g.sku))) && heads(p.g.raw).every((h) => text.includes(h));
  if (ok) hits++; else misses.push(`${p.g.sku} ${p.g.key}: ${p.g.doc_id} does not print ${p.g.inherited ? "" : `"${p.g.sku}" and `}"${heads(p.g.raw).join(" + ")}"`);
  seen.set(p.g.id, ok);
}
const precision = checked ? hits / checked : plans.length ? 0 : 1;
const recall = seen.size ? (seen.size - unreadable) / seen.size : 1;
const gate = { method: "every giver fact re-read on its cached page: the head of its raw cell, and the giver's SKU for a fact it read itself", sampled: seen.size, checked,
  unreadable, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
  passed: plans.length === 0 || (precision === 1 && unreadable === 0), misses: misses.slice(0, 12) };

const planPath = planFileAt(ROOT, "inherit-spare");
fs.mkdirSync(path.dirname(planPath), { recursive: true });
fs.writeFileSync(planPath, ["part_id\tsku\taction\tgiver\tkey\tmethod\tinherited\tdoc_id\tlocator\traw",
  ...plans.map((p) => `${p.to.id}\t${p.to.sku}\twrite ${p.dir}\t${p.g.sku}\t${p.g.key}\t${p.g.method}\t${p.g.inherited}\t${p.g.doc_id}\t${p.g.locator}\t${JSON.stringify(p.g.raw.slice(0, 200))}`),
  ...nameRefused.map((r) => `\t\trefused-name\t\t\t\t\t\t\t${JSON.stringify(r)}`),
  ...partnerRefused.map((r) => `\t\trefused-partner-too\t\t\t\t\t\t\t${JSON.stringify(r)}`),
  ...refused.map((r) => `\t\trefused\t\t\t\t\t\t\t${JSON.stringify(r)}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
const byKey: Record<string, number> = {}, byDir: Record<string, number> = {}, byRefusal: Record<string, number> = {};
for (const p of plans) { byKey[p.g.key] = (byKey[p.g.key] ?? 0) + 1; byDir[p.dir] = (byDir[p.dir] ?? 0) + 1; }
for (const r of refused) { const k = r.split(": ").slice(1).join(": ").split(" ")[0].replace(/:.*$/, ""); byRefusal[k] = (byRefusal[k] ?? 0) + 1; }
console.log(`inherit-spare (${CATEGORY}): ${pairs} spare pairs planned on (hardware, exact "=", same kind, names agree); ${nameRefused.length} refused by name; ` +
  `${plans.length} facts to write on ${new Set(plans.map((p) => p.to.id)).size} parts ${JSON.stringify(byDir)}; ${refused.length} refused ${JSON.stringify(byRefusal)}`);
console.log(`by key ${JSON.stringify(byKey)}`);
// ruling (A): refused for the receiver, then asked AS the partner -- admitted (in the plan) or refused for the partner too (listed)
const byPartnerGate: Record<string, number> = {}, partnerGiver: Record<string, number> = {};
for (const r of partnerRefused) {
  const rule = /: (partner:\S+)/.exec(r)?.[1] ?? "?"; byPartnerGate[rule] = (byPartnerGate[rule] ?? 0) + 1;
  const giver = /\[giver fact ([^\]]+)\]/.exec(r)?.[1]?.split(" ").slice(0, 2).join(" ") ?? "?"; partnerGiver[giver] = (partnerGiver[giver] ?? 0) + 1;
}
console.log(`ruling (A): ${viaPartner} admitted on the partner's answer; ${partnerRefused.length} refused for the partner too ${JSON.stringify(byPartnerGate)}, giver facts ${JSON.stringify(partnerGiver)}`);
console.log(`gate ${JSON.stringify(gate)} -> ${path.relative(ROOT, planPath)} (sha256 ${planSha.slice(0, 12)})`);
for (const r of nameRefused) console.log(`  REFUSED-NAME ${r}`);
for (const r of partnerRefused.slice(0, 40)) console.log(`  REFUSED-PARTNER-TOO ${r.slice(0, 260)}`);
for (const r of refused.slice(0, 25)) console.log(`  REFUSED ${r}`);
if (!gate.passed) { console.error(`GATE FAILED, nothing written: ${misses.slice(0, 12).join("; ")}`); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!plans.length) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("inherit-spare", {
  category: CATEGORY, planned: plans.length, refused: refused.length, refused_by_name: nameRefused.length, plan: path.relative(ROOT, planPath), plan_sha256: planSha,
  approved: "reviewer ruling 7 Oct 2026 (spares): 'Spares: yes, with these adjustments.' -- not inherited: lifecycle dates, box contents (bundle_contents), " +
    "anything about how the part is ordered (name, orderability, licences); 'All spec cups otherwise, as proposed' (both ways where only the spare is printed); " +
    "pairing only through a stored spare_of relation or an exact base PID plus a single trailing '='; 'Your kit, bundle and different-configuration refusals stand as written'; " +
    "'Where both sides hold read values, neither overwrites the other: a disagreement stays a conflict.' Proof first: 260 of 261 shared read cells agree (the one: a PSU name with 'Spare')." +
    " Ruling (A) 7 Oct: 'don't bypass the gate -- ask it about the partner ... Passes for the partner: admit the fact ... Fails for the partner too: don't copy it, and list it'." +
    " Ruling (B) 7 Oct: 'inherit-spare runs after the fill runs and before recompute and readiness, under one writer, and copies only facts that pass (A)'.",
}, async (runId) => withTx(async (client) => {
  const actions: Record<string, number> = {};
  const notInserted: string[] = [];
  for (const p of plans) {
    const entry: SpecEntry = {
      k: p.g.key, raw: p.g.raw, value: p.g.value, unit: p.g.unit ?? undefined, state: "verified",
      inherited: true, inherited_from: p.g.sku, ...(p.g.truncated ? { truncated: true } : {}),
      prov: { tier: p.g.tier, method: p.g.method, doc_id: p.g.doc_id ?? undefined, locator: p.g.locator ?? undefined,
        extracted_at: p.g.extracted_at ?? undefined, norm_v: p.g.norm_v ?? undefined },
    };
    const r = await applyMerge(client, p.to.id, entry, runId);
    actions[r.action] = (actions[r.action] ?? 0) + 1;
    if (r.action !== "insert") notInserted.push(`${p.to.sku} ${p.g.key}: ${r.action}${"refused" in r && r.refused ? ` (${r.refused})` : ""}`);
  }
  // every planned fact must have been INSERTED: a refusal means the plan and the store disagree -> roll back, never half-apply
  if (notInserted.length) throw new Error(`inherit-spare: ${notInserted.length} planned facts were not inserted: ${notInserted.slice(0, 10).join("; ")}`);
  return { stats: { written: plans.length, refused: refused.length, refused_by_name: nameRefused.length, admitted_via_partner: viaPartner, refused_partner_too: partnerRefused.length, ...byDir, ...actions }, gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.plans.length}`);
if (again.plans.length) { console.error("the write did not take"); process.exitCode = 1; }
await closePool();
