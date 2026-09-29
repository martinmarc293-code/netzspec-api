// scripts/retract-read-pours.mts — retract, EXACTLY as listed, the facts the Q17 read of the veto judged POURS (29 Sep 2026).
//
//     npx tsx scripts/retract-read-pours.mts --vendor cisco --list data/reference/q17-read-pours-cisco-2026-09-29.tsv \
//       [--commit --approved "<the ruling>"]
//
// Ruling Q17: R1 / R3 / R2 as plans read row by row -> R4 widenings with witnesses -> the READ triples. Every triple of the
// veto that was not all-datasheet was read (data/dryrun/q17-read-decisions-cisco-2026-09-29.tsv says why each one is what it
// is); the pours among them are listed row by row with their FULL stored value (data/reference/q17-read-pours-*.tsv).
//
// A LIST, NOT A RULE. A row is retracted only when a current own fact of that live part, in that category, under that cup,
// still holds EXACTLY the listed value (canonical JSON). Anything else -- the value moved since the read, the fact is gone,
// the part left the category -- is HELD and named: a list read on one day is evidence about that day's rows, never a
// predicate for tomorrow's. Plan per invocation; approval recorded; retractFact (a tombstone, nothing deleted); the write
// re-derives the selection and refuses if the plan and the store disagree.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool, withRun, withTx, retractFact } from "../src/store/index.js";
import { planFile } from "../src/core/planFile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor"), list = arg("--list"), commit = process.argv.includes("--commit"), approved = arg("--approved");
// the tombstone's method (`retracted:<rule>`): one rule per ruling, so a later reader can tell the Q17 pours from the Q19 seeds
const rule = arg("--rule") ?? "q17-read-pour";
if (!/^[a-z0-9-]+$/.test(rule)) { console.error(`--rule must be a slug, got ${JSON.stringify(rule)}`); process.exit(2); }
if (!vendor || !list) { console.error("usage: retract-read-pours.mts --vendor <slug> --list <pours.tsv> [--commit --approved \"...\"]"); process.exit(2); }
if (commit && !approved) { console.error("--commit needs --approved \"<the ruling>\""); process.exit(2); }

type Pour = { category: string; kind: string; sku: string; cup: string; value: string; why: string };
const text = fs.readFileSync(path.resolve(ROOT, list), "utf8").replace(/\r\n/g, "\n").trim().split("\n");
const head = text[0].split("\t");
const want = ["category", "kind", "sku", "cup", "value", "why"];
if (head.join("|") !== want.join("|")) { console.error(`the list's header is ${head.join(",")}, not ${want.join(",")}`); process.exit(2); }
const pours: Pour[] = text.slice(1).map((l) => { const c = l.split("\t"); return { category: c[0], kind: c[1], sku: c[2], cup: c[3], value: c[4], why: c[5] }; });
const listSha = createHash("sha256").update(fs.readFileSync(path.resolve(ROOT, list))).digest("hex");

const db = getPool();
type Found = { p: Pour; factId: string | null; held: string | null };
/** Canonical JSON: jsonb returns objects with its own key order; the list was written from the same reads, so both sides are
 *  JSON.stringify of the value pg hands back. Compared as strings, exactly. */
const look = async (): Promise<Found[]> => {
  const out: Found[] = [];
  for (const p of pours) {
    const rows = (await db.query<{ id: string; value: unknown }>(`
      SELECT f.id::text AS id, f.value FROM facts f JOIN parts pt ON pt.id = f.part_id JOIN vendors v ON v.id = pt.vendor_id
        JOIN categories c ON c.id = pt.category_id
       WHERE v.slug = $1 AND c.slug = $2 AND pt.sku = $3 AND f.field_key = $4 AND pt.retired_at IS NULL
         AND f.superseded_by IS NULL AND NOT f.inherited AND f.method NOT LIKE 'retracted:%' AND f.value IS NOT NULL`,
      [vendor, p.category, p.sku, p.cup])).rows;
    if (!rows.length) { out.push({ p, factId: null, held: "no current own fact any more" }); continue; }
    const hit = rows.find((r) => JSON.stringify(r.value) === p.value);
    out.push(hit ? { p, factId: hit.id, held: null }
      : { p, factId: null, held: `the stored value is now ${rows.map((r) => JSON.stringify(r.value)).join(" / ").slice(0, 120)}, not the listed one` });
  }
  return out;
};
const found = await look();
const todo = found.filter((f) => f.factId !== null);
const plan = planFile(ROOT, `retract-read-pours-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
fs.writeFileSync(plan, ["fact_id\tcategory\tkind\tsku\tcup\taction\tvalue\twhy",
  ...found.map((f) => `${f.factId ?? ""}\t${f.p.category}\t${f.p.kind}\t${f.p.sku}\t${f.p.cup}\t${f.held ? "hold" : "retract"}\t${f.p.value}\t${f.held ?? f.p.why}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(plan)).digest("hex");
const byTriple = new Map<string, number>();
for (const f of todo) byTriple.set(`${f.p.category}/${f.p.kind} ${f.p.cup}`, (byTriple.get(`${f.p.category}/${f.p.kind} ${f.p.cup}`) ?? 0) + 1);
console.log(`${vendor}: ${pours.length} listed pours (list sha256 ${listSha.slice(0, 12)}); retract ${todo.length}, hold ${found.length - todo.length}`);
for (const [t, n] of [...byTriple].sort((a, b) => b[1] - a[1])) console.log(`  retract ${String(n).padStart(3)}  ${t}`);
for (const f of found.filter((x) => x.held)) console.log(`  HOLD    ${f.p.category}/${f.p.sku} ${f.p.cup} — ${f.held}`);
console.log(`  plan ${path.relative(ROOT, plan)} (sha256 ${planSha.slice(0, 12)})`);
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit --approved \"...\"."); await closePool(); process.exit(0); }
if (!todo.length) { console.log("nothing to do"); await closePool(); process.exit(0); }
const res = await withRun("retract-read-pours", { vendor, list, rule, list_sha256: listSha, plan: path.relative(ROOT, plan), plan_sha256: planSha,
  approved, retract: todo.length, held: found.length - todo.length }, async (runId) => withTx(async (client) => {
    // re-derived at write time: a row that stopped matching since the plan is not touched, and the run refuses
    const again = new Set((await look()).filter((f) => f.factId !== null).map((f) => f.factId));
    let retracted = 0;
    // the rule becomes the tombstone's method (`retracted:<rule>`); the per-row reason lives in the plan and the list
    for (const f of todo) if (again.has(f.factId)) { await retractFact(client, Number(f.factId), rule, runId); retracted++; }
    if (retracted !== todo.length) throw new Error(`the plan named ${todo.length} and ${retracted} still match at write time — refused, nothing written`);
    return { stats: { retracted, held: found.length - todo.length } };
  }));
console.log(`run ${res.runId}: retracted ${todo.length}`);
await closePool();
