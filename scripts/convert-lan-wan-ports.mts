// scripts/convert-lan-wan-ports.mts — lan_interfaces / wan_interfaces retire into `ports`, each group carrying its role
// (reviewer rulings Q6/Q7, 29 Sep 2026).
//
//     npx tsx scripts/convert-lan-wan-ports.mts --vendor cisco [--commit --approved "<the ruling>"]
//
// Q6: the ports struct carries an optional role (lan | wan | uplink | mgmt); one quantity, one cup -- never lan_ports /
// wan_ports. Q7: a part converts ONLY when EVERY one of its lan and wan facts parses (src/core/portParse.ts) and it holds no
// current `ports` fact; then ONE ports fact is written, lan groups role "lan" and wan groups role "wan", raw = the two cells
// joined by the extractor's own " ; ", provenance = the lan fact's; BOTH documents are evidence rows on the fact
// (fact_evidence), and the lan/wan rows are retracted (rekeyed-to-ports). Everything else is HELD and its lan/wan facts stay
// (optional): a ports value holding only the LAN half would score the cup filled while half the layout is unknown, and
// the fill state cannot say "partial". A wan row that is a gap (the 'or' retraction left five) is a side that does not
// parse. The plan file names every part, what it would write and why it is held.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, insertFact, insertEvidence, retractFact } from "../src/store/index.js";
import { structShapeProblem } from "../src/core/fieldSchema.js";
import { parsePorts, type PortGroup } from "../src/core/portParse.js";
import { planFile } from "../src/core/planFile.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), commit = process.argv.includes("--commit"), approved = arg("--approved");
if (!vendor) { console.error("usage: convert-lan-wan-ports.mts --vendor <slug> [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

type Row = { id: string; part_id: string; sku: string; field_key: "lan_interfaces" | "wan_interfaces"; raw: string | null; value: unknown;
  state: string; tier: number; method: string; doc_id: string | null; locator: string | null; extracted_at: string | null; has_ports: boolean };
const db = getPool();
const rows = (await db.query<Row>(`
  SELECT f.id::text AS id, f.part_id::text AS part_id, p.sku, f.field_key, f.raw, f.value, f.state::text AS state, f.tier,
         f.method::text AS method, f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
         EXISTS (SELECT 1 FROM facts c WHERE c.part_id = f.part_id AND c.field_key = 'ports' AND c.superseded_by IS NULL
                   AND c.method NOT LIKE 'retracted:%' AND c.value IS NOT NULL) AS has_ports
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.field_key IN ('lan_interfaces', 'wan_interfaces') AND f.superseded_by IS NULL AND p.retired_at IS NULL
   ORDER BY p.sku, f.field_key`, [vendor])).rows;

/** The verdict for ONE part, re-derivable from its rows alone (the gate re-derives it at write time). */
type PartPlan = { sku: string; part_id: string; lan?: Row; wan?: Row; value?: (PortGroup & { role: "lan" | "wan" })[]; hold?: string };
function planPart(sku: string, part: Row[]): PartPlan {
  const lan = part.find((r) => r.field_key === "lan_interfaces"), wan = part.find((r) => r.field_key === "wan_interfaces");
  const base = { sku, part_id: part[0].part_id, lan, wan };
  if (part.some((r) => r.has_ports)) return { ...base, hold: "already holds a current ports fact: never overwritten, never merged by write order" };
  if (!lan || !wan) return { ...base, hold: `no ${!lan ? "lan" : "wan"} fact: half a layout is not a layout` };
  const side = (r: Row, role: "lan" | "wan") => {
    if (r.method.startsWith("retracted:") || !r.raw?.trim()) return { err: `${role} is a gap row (${r.method})` };
    const p = parsePorts(r.raw);
    return p.ok ? { groups: p.value.map((g) => ({ ...g, role })) } : { err: `${role} refused: ${p.detail}` };
  };
  const l = side(lan, "lan"), w = side(wan, "wan");
  if ("err" in l || "err" in w) return { ...base, hold: [("err" in l ? l.err : ""), ("err" in w ? w.err : "")].filter(Boolean).join("; ") };
  return { ...base, value: [...l.groups, ...w.groups] };
}

const byPart = new Map<string, Row[]>();
for (const r of rows) byPart.set(r.sku, [...(byPart.get(r.sku) ?? []), r]);
const plans = [...byPart].map(([sku, part]) => planPart(sku, part));
const conv = plans.filter((p) => !p.hold), held = plans.filter((p) => p.hold);

const plan = planFile(ROOT, `convert-lan-wan-ports-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["sku\taction\tlan_fact\twan_fact\tports_value\treason",
  ...plans.map((p) => `${p.sku}\t${p.hold ? "hold" : "convert"}\t${p.lan?.id ?? "-"}\t${p.wan?.id ?? "-"}\t` +
    `${p.value ? JSON.stringify(p.value) : ""}\t${p.hold ?? "every lan and wan fact parses; one ports fact, both documents as evidence"}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
console.log(`${vendor} lan/wan: ${rows.length} facts on ${plans.length} parts -> CONVERT ${conv.length}, HOLD ${held.length}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
for (const p of conv) console.log(`  CONVERT ${p.sku}: ${p.value!.map((g) => `${g.anzahl}x${g.port_typ}(${g.role})`).join(" + ")}`);
for (const p of held) console.log(`  HOLD ${p.sku}: ${p.hold}`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }

const res = await withRun("convert-lan-wan-ports", { vendor, plan: path.relative(ROOT, plan), plan_sha256: planSha, approved,
  convert: conv.length, hold: held.length }, async (runId) => withTx(async (client) => {
  let inserted = 0, evidence = 0, retracted = 0, rederived = 0, onShape = 0;
  for (const p of conv) {
    // THE GATE, per part: the verdict re-derived from the rows at write time, and the value on the struct's declared shape
    const again = planPart(p.sku, byPart.get(p.sku)!);
    if (!again.hold && JSON.stringify(again.value) === JSON.stringify(p.value)) rederived++;
    if (structShapeProblem("ports", p.value) === null && p.value!.every((g) => g.role === "lan" || g.role === "wan")) onShape++;
    const lan = p.lan!, wan = p.wan!;
    const entry: SpecEntry = { k: "ports", raw: `${lan.raw} ; ${wan.raw}`, value: p.value, state: lan.state as SpecEntry["state"],
      prov: { tier: lan.tier, method: lan.method, doc_id: lan.doc_id ?? undefined, locator: lan.locator ?? undefined, extracted_at: lan.extracted_at ?? undefined } };
    const factId = await insertFact(client, Number(p.part_id), entry, runId); inserted++; evidence++;   // + the lan document's evidence row
    // the WAN side's document, as its own witness on the same fact (Q7: "a fact assembled from two sources names both")
    await insertEvidence(client, factId, { ...entry, raw: wan.raw ?? "", prov: { tier: wan.tier, method: wan.method,
      doc_id: wan.doc_id ?? undefined, locator: wan.locator ?? undefined, extracted_at: wan.extracted_at ?? undefined } }, runId); evidence++;
    await retractFact(client, Number(lan.id), "rekeyed-to-ports", runId); retracted++;
    await retractFact(client, Number(wan.id), "rekeyed-to-ports", runId); retracted++;
  }
  const n = conv.length;
  const gate = { precision: n ? onShape / n : 1, recall: n ? rederived / n : 1, passed: onShape === n && rederived === n,
    sampled: n, checked: n, unreadable: 0, written: inserted, vacuous: n === 0, suites: {}, misses: [] as string[] };
  if (!gate.passed) throw new Error(`gate failed: ${JSON.stringify(gate)}`);
  return { stats: { inserted, evidence, retracted, held: held.length }, gate };
}));
console.log(`run ${res.runId}: ${JSON.stringify(res.stats)}`);
await closePool();
