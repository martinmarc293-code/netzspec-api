// scripts/retract-mis-keyed.mts — retract facts a NAMED rule proves are stored under the wrong cup, one rule per invocation.
//
//     npx tsx scripts/retract-mis-keyed.mts --vendor cisco --rule heat-sink-cpu-class [--commit --approved "<the ruling>"]
//
// A rule is two halves, and a row is retracted only when BOTH say so: a SQL selection (the field and the parts it could be on)
// and a per-row VERIFICATION that reads the evidence the rule is about (for the heat sink: the stored value IS the "<n> W" of
// its own name). A selected row the verification cannot confirm is HELD, named in the plan with the reason, never retracted by
// the selection alone -- a selection is a population, the verification is the proof. Plan file per invocation; approval
// recorded in the run; retraction rows via retractFact (nothing deleted).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, retractFact } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";

type Row = { id: string; sku: string; name: string | null; kind: string | null; category: string; value: unknown };
type Rule = { reason: string; field: string; where: string; verify: (r: Row) => string | null };

/** The rules. `where` is ANDed onto the current-own-fact selection; `verify` returns null to retract, else why it is held. */
const RULES: Record<string, Rule> = {
  // Ruling Q8 (29 Sep 2026): CMX-HS-C220M5 "Heat sink for UCS C220 M5 rack servers 150W CPUs & below" carried power_max 150 —
  // the wattage class of the CPUs it cools, mined from its own name. A heat sink draws nothing.
  "heat-sink-cpu-class": {
    reason: "heat-sink-cpu-class",
    field: "power_max",
    where: "p.name ~* 'heat ?sink'",
    verify: (r) => {
      const m = /(\d+(?:\.\d+)?)\s*W(?![A-Za-z])/.exec(r.name ?? "");
      if (!m) return "the name states no wattage, so nothing proves the value was read from it";
      return Number(m[1]) === Number(r.value) ? null : `the value ${JSON.stringify(r.value)} is not the ${m[1]} W of the name`;
    },
  },
  // RULING Q17 R1 (29 Sep 2026): a PLATFORM's slot count mined onto a part that is not the platform -- CRS-8-LIFT-TUBE= "8",
  // CRS-16-PWRSH-DC "16", N77-C7718-FAN-2 "18", C9606-FB-23-KIT "6": the number is the chassis the part fits, read off its own SKU.
  // BUNDLES ARE NOT SELECTED: a C4500E-7R bundle IS a 7-slot chassis system (true), a CRS-16-FC400/M-8P fabric pack is not -- read.
  "platform-slot-count": {
    reason: "platform-slot-count",
    field: "module_slots",
    where: "f.method = 'description_mining' AND p.sku_kind IN ('mechanical', 'fan', 'fabric', 'power', 'processor', 'accessory', 'power-cord', 'linecard', 'mux')",
    verify: (r) => {
      const v = Number(r.value);
      if (!Number.isInteger(v)) return `the value ${JSON.stringify(r.value)} is not a whole slot count`;
      const runs = r.sku.match(/[0-9]+/g) ?? [];
      // the number itself (CRS-16, 15454-M6) or a four-digit platform whose last two digits are it (C7718 -> 18, C9407 -> 7)
      const hit = runs.some((d) => Number(d) === v || (d.length === 4 && Number(d.slice(-2)) === v));
      return hit ? null : `${v} is not a platform number in the SKU (${runs.join(", ") || "no digits"})`;
    },
  },
  // RULING Q17: a mains CORD's voltage RATING stored as the input voltage a device accepts -- CAB-9K16A-US1 "Power Cord, 250VAC 16A":
  // {min 250, max 250} is what the cord is rated for, read off its own name. A cord has no input voltage.
  "cord-voltage-rating": {
    reason: "cord-voltage-rating",
    field: "input_voltage",
    where: "p.name ~* 'power ?cord'",
    verify: (r) => {
      const v = r.value as { min?: unknown; max?: unknown } | null;
      if (!v || typeof v !== "object" || v.min !== v.max) return `not a single rating (${JSON.stringify(r.value)})`;
      const m = /(\d{2,3})\s*V(?:AC)?(?![A-Za-z0-9])|(\d{2,3})VAC/i.exec(r.name ?? "");
      const named = m ? Number(m[1] ?? m[2]) : null;
      return named !== null && named === Number(v.min) ? null : `the value ${v.min} V is not the rating the name states (${named ?? "none"})`;
    },
  },
  // RULING Q17: a DC cable's "2000" is the rating of the PSU it feeds, read off its own SKU (PWR-2KW-DC-CBL): a cord draws nothing.
  "cord-power-rating": {
    reason: "cord-power-rating",
    field: "power_max",
    where: "p.sku_kind = 'power-cord'",
    verify: (r) => {
      const m = /(\d+(?:\.\d+)?)\s*(K?)W(?![A-Za-z])/i.exec(`${r.sku} ${r.name ?? ""}`);
      if (!m) return "neither SKU nor name states a wattage";
      const w = Number(m[1]) * (m[2] ? 1000 : 1);
      return w === Number(r.value) ? null : `the value ${JSON.stringify(r.value)} is not the ${w} W the SKU / name states`;
    },
  },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), ruleName = arg("--rule");
const commit = process.argv.includes("--commit"), approved = arg("--approved");
const rule = ruleName ? RULES[ruleName] : undefined;
if (!vendor || !rule) { console.error(`usage: retract-mis-keyed.mts --vendor <slug> --rule <${Object.keys(RULES).join("|")}> [--commit --approved "..."]`); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

const db = getPool();
const select = async (): Promise<Row[]> => (await db.query<Row>(`
  SELECT f.id::text AS id, p.sku, p.name, p.sku_kind AS kind, c.slug AS category, f.value
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
   WHERE v.slug = $1 AND f.field_key = $2 AND f.superseded_by IS NULL AND NOT f.inherited AND f.method NOT LIKE 'retracted:%'
     AND f.value IS NOT NULL AND p.retired_at IS NULL AND (${rule.where})
   ORDER BY p.sku`, [vendor, rule.field])).rows;
const rows = await select();
const verdicts = rows.map((r) => ({ r, held: rule.verify(r) }));
const hit = verdicts.filter((v) => v.held === null).map((v) => v.r);
const plan = planFile(ROOT, `retract-mis-keyed-${ruleName}-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tsku\tcategory\tkind\tfield\taction\tvalue\tname\twhy",
  ...verdicts.map(({ r, held }) => `${r.id}\t${r.sku}\t${r.category}\t${r.kind ?? ""}\t${rule.field}\t${held ? "hold" : "retract"}\t` +
    `${JSON.stringify(r.value)}\t${(r.name ?? "").replace(/\s+/g, " ")}\t${held ?? rule.reason}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
console.log(`${vendor} ${ruleName}: ${rows.length} current own ${rule.field} facts selected; retract ${hit.length}, hold ${rows.length - hit.length}`);
for (const { r, held } of verdicts) console.log(`  ${held ? "HOLD   " : "RETRACT"} ${r.sku} (${r.category}/${r.kind ?? "-"}) ${JSON.stringify(r.value)}${held ? ` — ${held}` : ""}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
const res = await withRun("retract-mis-keyed", { vendor, rule: ruleName, field: rule.field, retract: hit.length, plan: path.relative(ROOT, plan),
  plan_sha256: planSha, approved }, async (runId) => withTx(async (client) => {
    // the selection and the verification re-derived at write time: a row that stopped qualifying since the plan is not touched
    const again = new Set((await select()).filter((r) => rule.verify(r) === null).map((r) => r.id));
    let retracted = 0;
    for (const r of hit) if (again.has(r.id)) { await retractFact(client, Number(r.id), rule.reason, runId); retracted++; }
    if (retracted !== hit.length) throw new Error(`the plan named ${hit.length} and ${retracted} still qualify at write time — refused, nothing written`);
    return { stats: { retracted, held: rows.length - hit.length } };
  }));
console.log(`run ${res.runId}: retracted ${hit.length}`);
await closePool();
