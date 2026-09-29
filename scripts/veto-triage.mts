// scripts/veto-triage.mts — the four_sets_sum VETO, part-cup by part-cup, with the evidence each fact came from (ruling Q17,
// 29 Sep 2026). READ-ONLY.
//
//     npx tsx scripts/veto-triage.mts --vendor cisco
//
// four_sets_sum names each (category, kind, cup) where a live part holds an OWN fact under a cup its kind's derivation marks
// na. It names the triple; the remedy depends on the rows. This lists every part-cup of every vetoed triple with the fact's
// method and its source document's type -- the two columns a remedy is chosen from -- and proposes one PER TRIPLE:
//
//   R4 widen   every part-cup of the triple was read off a vendor DATASHEET table (html_table / pdf_table, or an operator
//              hexcat_seed whose evidence is the datasheet): the vendor states the cup for this kind, so the kind's set is
//              what is wrong. The widening is a KIND_DECLARED_OPTIONAL entry (cupLedger.ts) naming the witness -- the SKU
//              with the most such facts -- never a required cup. AND at least one row must be a TABLE read (html_table /
//              pdf_table): reviewer audit, 29 Sep 2026 -- a hexcat_seed carries the datasheet's doc_id as BORROWED provenance
//              (N31), so a seed-only triple proves nobody read the value off that sheet; it goes to the read list.
//   to read    anything else, including a triple that MIXES datasheet rows with description mining or a bulletin: a person
//              reads the rows before either the fact or the set moves, because widening would also bless the pours.
//
// The veto set is computed exactly as four_sets_sum computes it (the same kindQuestionSet over the same LEDGER_KINDS, the
// same own-fact predicate), and the run prints its triple and part-cup totals so they can be compared with the board's line.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEDGER_KINDS, Q17_R4_REFUSED, kindQuestionSet } from "../src/core/cupLedger.js";
import { PROFILES } from "../src/core/fieldSchema.js";
import { query, closePool } from "../src/store/db.js";
import { planFile } from "../src/core/planFile.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const vendor = arg("--vendor");
if (!vendor) { console.error("usage: veto-triage.mts --vendor <slug>"); process.exit(2); }

/** A datasheet states it: the method read a table (or an operator seed) off a vendor datasheet. */
export const DATASHEET_METHODS: ReadonlySet<string> = new Set(["html_table", "pdf_table", "hexcat_seed"]);
export const DATASHEET_DOCS: ReadonlySet<string> = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf"]);
export const statesIt = (method: string, docType: string | null): boolean => DATASHEET_METHODS.has(method) && !!docType && DATASHEET_DOCS.has(docType);
/** A row actually READ off the sheet's table -- at least one per R4 triple (a seed's doc_id is borrowed, N31). */
export const TABLE_METHODS: ReadonlySet<string> = new Set(["html_table", "pdf_table"]);

const na = new Map<string, ReadonlySet<string>>();
for (const [cat, kinds] of Object.entries(LEDGER_KINDS)) {
  if (!PROFILES[cat]) continue;
  for (const kind of kinds as string[]) na.set(`${cat}|${kind}`, new Set(kindQuestionSet(cat, kind).not_applicable_by_kind));
}

type Row = { cat: string; kind: string; key: string; sku: string; value: string; method: string; doc_type: string | null };
const rows = (await query<Row>(`
  SELECT c.slug AS cat, p.sku_kind AS kind, f.field_key AS key, p.sku, left(f.value::text, 120) AS value, f.method, sd.doc_type
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN categories c ON c.id = p.category_id JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
   WHERE v.slug = $1 AND p.retired_at IS NULL AND p.sku_kind IS NOT NULL AND f.superseded_by IS NULL AND NOT f.inherited
     AND f.method NOT LIKE 'retracted:%' AND f.value IS NOT NULL
   ORDER BY 1, 2, 3, 4`, [vendor])).rows;
const vetoed = rows.filter((r) => na.get(`${r.cat}|${r.kind}`)?.has(r.key));

const byTriple = new Map<string, Row[]>();
for (const r of vetoed) { const k = `${r.cat}|${r.kind}|${r.key}`; (byTriple.get(k) ?? byTriple.set(k, []).get(k)!).push(r); }
type Verdict = { triple: string; remedy: "R4 widen" | "to read"; parts: number; witness: string; held: number; why?: string };
// A triple REFUSED as a widening after its values were read (cupLedger.ts Q17_R4_REFUSED) is "to read", with the reason.
const refusedWhy = new Map(Q17_R4_REFUSED.map((r) => [`${r.category}|${r.kind}|${r.cup}`, r.why]));
const verdicts: Verdict[] = [];
for (const [triple, rs] of byTriple) {
  const all = rs.every((r) => statesIt(r.method, r.doc_type)) && rs.some((r) => TABLE_METHODS.has(r.method));
  const tally = new Map<string, number>();
  for (const r of rs) if (statesIt(r.method, r.doc_type)) tally.set(r.sku, (tally.get(r.sku) ?? 0) + 1);
  const witness = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
  const why = refusedWhy.get(triple);
  verdicts.push({ triple, remedy: all && !why ? "R4 widen" : "to read", parts: new Set(rs.map((r) => r.sku)).size, witness, held: rs.length, why });
}
verdicts.sort((a, b) => a.remedy.localeCompare(b.remedy) || b.held - a.held);

const plan = planFile(ROOT, `veto-triage-${vendor}`);
fs.mkdirSync(path.dirname(plan), { recursive: true });
const remedyOf = new Map(verdicts.map((v) => [v.triple, v.remedy]));
fs.writeFileSync(plan, ["remedy\tcategory\tkind\tcup\tsku\tvalue\tmethod\tdoc_type",
  ...vetoed.map((r) => `${remedyOf.get(`${r.cat}|${r.kind}|${r.key}`)}\t${r.cat}\t${r.kind}\t${r.key}\t${r.sku}\t${r.value.replace(/[\t\r\n]+/g, " ")}\t${r.method}\t${r.doc_type ?? ""}`)].join("\n") + "\n");
const sum = (rem: string) => { const vs = verdicts.filter((v) => v.remedy === rem); return `${vs.length} triples / ${vs.reduce((n, v) => n + v.held, 0)} part-cups`; };
console.log(`${vendor}: ${byTriple.size} vetoed (category, kind, cup) triples on ${vetoed.length} part-cups — R4 widen ${sum("R4 widen")}; to read ${sum("to read")}`);
for (const v of verdicts) console.log(`  ${v.remedy.padEnd(8)} ${v.triple.padEnd(60)} ${String(v.held).padStart(5)} part-cups on ${String(v.parts).padStart(4)} parts  witness ${v.witness || "-"}${v.why ? `  [R4 REFUSED: ${v.why}]` : ""}`);
console.log(`  plan ${path.relative(ROOT, plan)}`);
await closePool();
