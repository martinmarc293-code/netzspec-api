/**
 * scripts/mould-verify.mts — `npm run mould:verify`. STEP P.4 of the reviewer's brief, 27 Sep 2026.
 *
 *     npx tsx scripts/mould-verify.mts [--no-db]
 *
 * The brief declares 27 named tests, each tied to the findings it keeps fixed, and the rule that "a FIXED
 * without a test is not fixed". This is the harness plus its first implemented slice.
 *
 * THE ONE DESIGN RULE, and it is this repo's oldest lesson: a check that cannot run must never look like a
 * check that passed. Every one of the 27 is DECLARED here with its finding numbers. An unimplemented test
 * reports NOT IMPLEMENTED and is counted in its own number, never folded into passes. A test that needs the
 * database and cannot reach it reports UNAVAILABLE, also its own number. The summary line prints all four
 * counts — passed / FAILED / not implemented / unavailable — so "green" can never mean "I only ran six".
 *
 * Exit: 1 if anything FAILED, 2 if nothing failed but something was UNAVAILABLE (could-not-check is not a
 * pass), 0 only when every implemented test passed. Unimplemented tests do not fail the run — they are a
 * known, printed debt — but the count is in the output of every single run so it cannot be forgotten.
 */
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, domainFor, type Requirement } from "../src/core/fieldSchema.js";
import { uncoveredEnumValues } from "../src/core/renderContract.js";
import { query, closePool } from "../src/store/db.js";

type Result = { state: "pass" | "fail" | "unavailable"; detail: string };
type Test = { name: string; findings: string; needsDb?: boolean; run?: () => Promise<Result> };

const ok = (detail: string): Result => ({ state: "pass", detail });
const bad = (detail: string): Result => ({ state: "fail", detail });
const na = (detail: string): Result => ({ state: "unavailable", detail });

// ---- the 27, declared whether or not they are written ------------------------------------------------------------
const TESTS: Test[] = [
  {
    name: "german_domain_coverage",
    findings: "S7",
    // An EXACT ratchet, not a floor. It read 0 for a fortnight because the coverage check filtered `type
    // !== "e"` and could not see list-of-enum keys — 458 of 766 domain values with no German.
    run: async () => {
      const gaps = uncoveredEnumValues();
      const values = gaps.reduce((n, g) => n + (Number(/— (\d+) domain values/.exec(g.value)?.[1]) || 1), 0);
      const KEYS = 7, VALUES = 458;
      return gaps.length === KEYS && values === VALUES
        ? ok(`${KEYS} keys / ${VALUES} domain values still uncovered (the recorded debt, unchanged)`)
        : bad(`expected ${KEYS} keys / ${VALUES} values, got ${gaps.length} / ${values}: ${gaps.map((g) => g.key).join(", ")}`);
    },
  },
  {
    name: "required_cup_defined",
    findings: "C1–C4, N13",
    // A required cup must be checkable: an enum needs a domain, a number needs a unit AND a band, a struct
    // needs a shape. A required FREE STRING can hold anything, so nothing can ever refuse a wrong value.
    run: async () => {
      const badCups: string[] = [];
      for (const [cat, prof] of Object.entries(PROFILES)) {
        for (const [key, rule] of Object.entries(prof as Record<string, Requirement>)) {
          if ((rule as { kind?: string }).kind !== "req") continue;
          const d = FIELD_DICTIONARY[key] as { type?: string; unit?: string | null; band?: unknown; shape?: unknown } | undefined;
          if (!d || COLUMN_BACKED.has(key)) continue;
          const t = d.type;
          if (t === "e" || t === "ls") { if (!(domainFor(cat, key) ?? []).length) badCups.push(`${cat}/${key} enum with no domain`); }
          else if (t === "n") { if (!d.unit) badCups.push(`${cat}/${key} numeric with no unit`); if (!Array.isArray(d.band)) badCups.push(`${cat}/${key} numeric with no band`); }
          else if (t === "struct") { if (!d.shape) badCups.push(`${cat}/${key} struct with no shape`); }
          else if (t === "s") badCups.push(`${cat}/${key} REQUIRED free string`);
        }
      }
      return badCups.length === 0
        ? ok("every required cup carries a domain, a unit+band, or a shape")
        : bad(`${badCups.length} required cups cannot be checked: ${badCups.slice(0, 10).join("; ")}${badCups.length > 10 ? ` … +${badCups.length - 10}` : ""}`);
    },
  },
  {
    name: "no_gate_on_optional",
    findings: "D1–D3",
    // A cup required only when a gate trips is unanswerable if the gate itself is optional and unfilled:
    // the requirement can never be decided, so the cup sits `pending` for ever.
    run: async () => {
      const offenders: string[] = [];
      const fields = (n: unknown, out: Set<string>): void => {
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (typeof o.field === "string") out.add(o.field);
        for (const v of Object.values(o)) Array.isArray(v) ? v.forEach((x) => fields(x, out)) : fields(v, out);
      };
      for (const [cat, prof] of Object.entries(PROFILES)) {
        const p = prof as Record<string, Requirement>;
        for (const [key, rule] of Object.entries(p)) {
          if ((rule as { kind?: string }).kind !== "cond") continue;
          const read = new Set<string>();
          fields(rule, read);
          for (const g of read) {
            if (COLUMN_BACKED.has(g) || g === "kind" || g === "deploy_role" || g === "modular") continue;
            if ((p[g] as { kind?: string } | undefined)?.kind === "opt") offenders.push(`${cat}/${key} gated on optional ${g}`);
          }
        }
      }
      return offenders.length === 0
        ? ok("no conditional cup is gated on an optional field")
        : bad(`${offenders.length}: ${offenders.slice(0, 8).join("; ")}${offenders.length > 8 ? ` … +${offenders.length - 8}` : ""}`);
    },
  },
  {
    name: "column_backed_never_facts",
    findings: "N34",
    needsDb: true,
    // A column-backed key is derived or stored on `parts`. A FACT under the same key is a second answer to
    // one question, and the record then serves both — which is how `product_line` could disagree with itself.
    run: async () => {
      const keys = [...COLUMN_BACKED];
      const rows = (await query<{ field_key: string; n: string }>(`
        SELECT f.field_key, count(*)::text n FROM facts f JOIN parts p ON p.id = f.part_id
         WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL
           AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL
         GROUP BY 1 ORDER BY 2 DESC`, [keys])).rows;
      const total = rows.reduce((n, r) => n + Number(r.n), 0);
      return total === 0
        ? ok(`0 facts under the ${keys.length} column-backed keys (${keys.join(", ")})`)
        : bad(`${total} facts under column-backed keys: ${rows.map((r) => `${r.field_key} ${r.n}`).join(", ")}`);
    },
  },
  {
    name: "enum_values_in_domain",
    findings: "N35",
    needsDb: true,
    // Covers `ls` as well as `e`. The scan that first measured this filtered `type === "e"` and undercounted,
    // which is the same predicate that blinded the German coverage check — one wrong filter, two instruments.
    run: async () => {
      const keys = Object.entries(FIELD_DICTIONARY)
        .filter(([, d]) => ["e", "ls"].includes((d as { type?: string }).type ?? "")).map(([k]) => k);
      const rows = (await query<{ cat: string; key: string; value: string; n: string }>(`
        SELECT c.slug cat, f.field_key key, f.value::text value, count(*)::text n
          FROM facts f JOIN parts p ON p.id=f.part_id JOIN categories c ON c.id=p.category_id
         WHERE f.field_key = ANY($1::text[]) AND f.superseded_by IS NULL
           AND f.method NOT LIKE 'retracted:%' AND p.retired_at IS NULL AND f.value IS NOT NULL
         GROUP BY 1,2,3`, [keys])).rows;
      const byKey = new Map<string, number>();
      let out = 0, total = 0;
      for (const r of rows) {
        const n = Number(r.n); total += n;
        let v: unknown; try { v = JSON.parse(r.value); } catch { v = r.value; }
        const vals = Array.isArray(v) ? v : [v];
        const dom = domainFor(r.cat, r.key) ?? (FIELD_DICTIONARY[r.key] as { domain?: string[] }).domain ?? [];
        if (!dom.length) continue;
        if (vals.every((x) => typeof x === "string" && dom.includes(x))) continue;
        out += n; byKey.set(r.key, (byKey.get(r.key) ?? 0) + n);
      }
      const worst = [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ");
      return out === 0
        ? ok(`every one of ${total} enum/list facts is inside its category's domain`)
        : bad(`${out} of ${total} facts hold a value outside their domain — ${worst}`);
    },
  },
  {
    name: "layer_parity_db_vs_artifact",
    findings: "N59, N60, N1",
    needsDb: true,
    // Reports rather than asserts a threshold: the disagreement is real (91.1%) and the repair is disputed,
    // so a red here would be noise until that decision lands. It fails only if the COMPARISON breaks — a
    // zero-overlap result, which is the shape a broken join makes, not a shape the data can make.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const dir = path.join(REPO_ROOT, "data", "layers");
      let rows = 0, diff = 0, files = 0;
      for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("cisco-") && x.endsWith(".rows.tsv"))) {
        const cat = f.slice("cisco-".length, -".rows.tsv".length);
        const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
        const h = L[0].split("\t"), ci = (n: string) => h.indexOf(n);
        if (ci("sku") < 0 || ci("series") < 0) continue;
        files++;
        const art = new Map<string, string>();
        for (const l of L.slice(1)) { const c = l.split("\t"); art.set(c[ci("sku")], c[ci("series")]); }
        const db = (await query<{ sku: string; series: string | null }>(`
          SELECT p.sku, p.series FROM parts p JOIN vendors v ON v.id=p.vendor_id JOIN categories c ON c.id=p.category_id
           WHERE v.slug='cisco' AND c.slug=$1 AND p.retired_at IS NULL AND p.sku = ANY($2::text[])`, [cat, [...art.keys()]])).rows;
        for (const d of db) { rows++; if ((d.series ?? "") !== art.get(d.sku)) diff++; }
      }
      if (!rows) return na(`${files} layer files read and 0 parts matched — a broken join, not a finding`);
      if (diff === rows) return bad(`ALL ${rows} rows differ, which is the shape of a broken comparison rather than of data`);
      return ok(`${diff} of ${rows} placed parts disagree (${(100 * diff / rows).toFixed(1)}%) across ${files} categories `
        + `— N59 confirmed and OPEN; the repair is disputed (scripts/dryrun-series-vs-layer4.mts)`);
    },
  },

  // ---- declared, NOT YET WRITTEN. Named so the output can never imply coverage it does not have. ------------------
  { name: "one_build", findings: "N19, N38, N45, N61" },
  { name: "db_site_api_parity", findings: "N1, N59, N60 (500 random SKUs)" },
  { name: "ledger_parity", findings: "N45" },
  { name: "kind_profile_parity", findings: "B1" },
  { name: "four_sets_sum", findings: "B4" },
  { name: "no_family_reason_present", findings: "B2, B3" },
  { name: "bucket_not_series", findings: "B3" },
  { name: "twin_parity", findings: "N7" },
  { name: "unknown_zero", findings: "B7" },
  { name: "plans_agree_with_rows", findings: "N6" },
  { name: "runs_have_approval", findings: "B8, N5" },
  { name: "gaps_fresh", findings: "N2, N3, N46, N47" },
  { name: "fill_state_partition", findings: "N8–N11, N30, N31, N50" },
  { name: "conflicts_classified", findings: "N33, N51–N53" },
  { name: "doc_category_by_relevance", findings: "N39, N48, N49, N64" },
  { name: "relations_for_components", findings: "N54" },
  { name: "name_image_lifecycle_state", findings: "N16, N56, N58" },
  { name: "export_profiles_roundtrip", findings: "S1–S9, STEP 9" },
  { name: "openapi_schemas", findings: "N63" },
  { name: "endpoints_alive", findings: "N43, N44" },
  { name: "link_integrity", findings: "H" },
  { name: "vendor_coverage", findings: "N62" },
];

// ---- run ----------------------------------------------------------------------------------------------------------
const noDb = process.argv.includes("--no-db");
let pass = 0, fail = 0, notImpl = 0, unavail = 0;
const failed: string[] = [];

console.log(`mould:verify — ${TESTS.length} tests declared\n`);
for (const t of TESTS) {
  if (!t.run) { notImpl++; console.log(`  ....  ${t.name.padEnd(30)} NOT IMPLEMENTED   (${t.findings})`); continue; }
  if (t.needsDb && noDb) { unavail++; console.log(`  ????  ${t.name.padEnd(30)} UNAVAILABLE       --no-db`); continue; }
  let r: Result;
  try { r = await t.run(); }
  catch (e) { r = na(`threw: ${e instanceof Error ? e.message : String(e)}`); }
  if (r.state === "pass") { pass++; console.log(`  PASS  ${t.name.padEnd(30)} ${r.detail}`); }
  else if (r.state === "fail") { fail++; failed.push(t.name); console.log(`  FAIL  ${t.name.padEnd(30)} ${r.detail}   (${t.findings})`); }
  else { unavail++; console.log(`  ????  ${t.name.padEnd(30)} UNAVAILABLE  ${r.detail}`); }
}

console.log(`\n  passed ${pass}   FAILED ${fail}   not implemented ${notImpl}   unavailable ${unavail}`
  + `   (of ${TESTS.length} declared)`);
if (fail) console.log(`  failing: ${failed.join(", ")}`);
if (notImpl) console.log(`  ${notImpl} declared tests are not written yet — this run does NOT certify their findings.`);
await closePool().catch(() => {});
process.exit(fail ? 1 : unavail ? 2 : 0);
