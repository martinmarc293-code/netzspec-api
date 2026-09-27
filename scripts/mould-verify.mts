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
 * counts — passed / FAILED / not implemented / unavailable / not exercised — so "green" can never mean "I only ran six".
 *
 * Exit: 1 if anything FAILED, 2 if nothing failed but something was UNAVAILABLE (could-not-check is not a
 * pass), 0 only when every implemented test passed. Unimplemented tests do not fail the run — they are a
 * known, printed debt — but the count is in the output of every single run so it cannot be forgotten.
 */
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, domainFor, type Requirement } from "../src/core/fieldSchema.js";
import { uncoveredEnumValues } from "../src/core/renderContract.js";
import { mouldStatuses } from "../src/core/brandMould.js";
import { NO_PROFILE_REASONS } from "../src/core/noProfileReason.js";
import { partKind } from "../src/core/partKind.js";
import { deployRoleResult, roleAxisOf, roleAxisKinds } from "../src/core/deployRole.js";
import { query, closePool } from "../src/store/db.js";

type Result = { state: "pass" | "fail" | "unavailable" | "not_exercised"; detail: string };
type Test = { name: string; findings: string; needsDb?: boolean; run?: () => Promise<Result> };

const ok = (detail: string): Result => ({ state: "pass", detail });
const bad = (detail: string): Result => ({ state: "fail", detail });
const na = (detail: string): Result => ({ state: "unavailable", detail });
/**
 * THE FOURTH STATE: the check ran, and the condition it exists to detect HAS NO POPULATION to test
 * against (reviewer, 27 Sep 2026). Not a pass, not a failure, and not "could not reach the database" --
 * it is "there was nothing here to judge", and it needs its own word for the same reason could-not-check
 * does: a check with no material reports exactly like a check that found nothing wrong.
 *
 * The case that forced it: three sabotages in completeness.test could no longer be staged once the 18
 * refused rows left the score, because they were the only live parts with an underivable role. The same
 * happens to refusals_consumed the day the reclassification plan runs and the 18 leave for good -- at
 * which point a check watching for unconsumed refusals has nothing to consume and must SAY so rather
 * than turning green and being quietly retired by accident.
 */
const none = (detail: string): Result => ({ state: "not_exercised", detail });

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
      let seen = 0;
      for (const [cat, prof] of Object.entries(PROFILES)) {
        for (const [key, rule] of Object.entries(prof as Record<string, Requirement>)) {
          // `cond` TOO. This read `!== "req"` and therefore evaluated ZERO cups of the 652 that can be
          // required: only 45 cups are unconditional `req` and every one of them is `vendor` or `series`,
          // both COLUMN_BACKED and skipped below — so the population was empty by construction while the
          // test printed PASS. The 607 `cond` cups ARE required whenever their gate trips, and they are
          // the ones a wrong value actually reaches. Found by the reviewer reading the code, not by any run.
          const kind = (rule as { kind?: string }).kind;
          if (kind !== "req" && kind !== "cond") continue;
          const d = FIELD_DICTIONARY[key] as { type?: string; unit?: string | null; band?: unknown; shape?: unknown } | undefined;
          if (!d || COLUMN_BACKED.has(key)) continue;
          seen++;
          const t = d.type;
          if (t === "e" || t === "ls") { if (!(domainFor(cat, key) ?? []).length) badCups.push(`${cat}/${key} enum with no domain`); }
          // A COUNT'S DEFINITION IS ITS BAND, AND DEMANDING A UNIT WAS THE WRONG DEMAND (27 Sep 2026).
          // This asked every numeric for a unit AND a band. Tried on the five counts that had a band and
          // no unit -- module_slots, vlan_max, poe_ports, radio_count, breakout_count -- and the
          // normaliser suites went red immediately: a DECLARED unit is a token convert() then requires in
          // the cell, so "8 PoE+", "6 zl2-Modul-Steckplätze" and "2x 2.4 GHz and 2x 5 GHz" stopped
          // parsing. They are real datasheet strings that parsed correctly before. A count has no
          // dimension: the unit would be a label, the BAND is what can refuse a wrong value, and
          // inventing a noun to satisfy a checklist made the mould worse at reading its own sources.
          // So a numeric is defined when it has a band; a unit is required only alongside one, never
          // instead of one. The 29 unit-only pairs were never undefined -- the check was.
          else if (t === "n") { if (!Array.isArray(d.band)) badCups.push(`${cat}/${key} numeric with no band`); }
          else if (t === "struct") { if (!d.shape) badCups.push(`${cat}/${key} struct with no shape`); }
          else if (t === "s") badCups.push(`${cat}/${key} REQUIRED free string`);
        }
      }
      // The denominator is in the message either way: a test that cannot say how much it looked at is one
      // nobody can tell apart from a test that looked at nothing.
      return badCups.length === 0
        ? ok(`all ${seen} required/conditional cups carry a domain, a unit+band, or a shape`)
        : bad(`${badCups.length} of ${seen} required/conditional cups cannot be checked: ${badCups.slice(0, 10).join("; ")}${badCups.length > 10 ? ` … +${badCups.length - 10}` : ""}`);
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
            // A DERIVED GATE IS EXEMPT ONLY WHERE THE DERIVATION CAN SPEAK (27 Sep 2026). This line used to
            // read `COLUMN_BACKED.has(g) || g === "kind" || g === "deploy_role" || g === "modular"`, which
            // exempted `deploy_role` unconditionally — so the check could not see a cup gated on it, which is
            // exactly the case it exists to catch. meraki gated NINE cups on a `deploy_role` its profile did
            // not declare, plus unified-communications and data-center-networking, and all of them resolved
            // `na` in silence while this test reported "no conditional cup is gated on an optional or
            // undeclared field". The reviewer read the miss as source-map-versus-merged; it is not — PROFILES
            // here IS the merged object, built at module load. The check was simply told to look away.
            //
            // `kind` is genuinely universal (partKind answers for every category that gates on it).
            // `deploy_role` is answerable only where AXIS gives the category a role-bearing kind, and
            // `modular` only in routers — so those exemptions are now conditional on the derivation having a
            // population at all. A gate nothing can ever answer is a dead gate wherever it lives.
            if (g === "kind") continue;
            if (g === "deploy_role" && roleAxisKinds(cat).length > 0) continue;
            if (g === "modular" && cat === "routers") continue;
            if (COLUMN_BACKED.has(g) && g !== "deploy_role" && g !== "modular") continue;
            // An UNDECLARED gate is as unanswerable as an optional one and used to pass in silence: p[g]
            // is undefined, the === "opt" test is false, and the cup sits pending for ever with nothing
            // saying why. Both are now reported, and named apart because the fix differs.
            const gk = (p[g] as { kind?: string } | undefined)?.kind;
            if (gk === "opt") offenders.push(`${cat}/${key} gated on OPTIONAL ${g}`);
            else if (gk === undefined) offenders.push(`${cat}/${key} gated on ${g}, undeclared in this profile`);
          }
        }
      }
      return offenders.length === 0
        ? ok(`no conditional cup is gated on an optional or undeclared field (${Object.keys(PROFILES).length} profiles)`)
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
      // NOT ok(). It printed PASS at 91.1% because the disagreement is expected and the repair disputed -
      // but a green line against a known-broken number is how a reader learns to stop reading the colour.
      return na(`${diff} of ${rows} placed parts disagree (${(100 * diff / rows).toFixed(1)}%) across ${files} `
        + `categories - N59 RECLASSIFIED: the series column is the platform axis, product_series is layer 4. `
        + `Not judgeable green or red until the ledger and pages read product_series`);
    },
  },

  // ---- declared, NOT YET WRITTEN. Named so the output can never imply coverage it does not have. ------------------
  {
    name: "one_build",
    findings: "N19, N38, N45, N61",
    // THE ROOT CAUSE the reviewer names: the site is built from reference JSON, the API from the DB and
    // completeness from a third snapshot, and nothing fails when they diverge. A build commit is recorded
    // under THREE different field names across the artefact set, which is itself part of why nobody noticed:
    // a reader checking `built_on_commit` sees agreement and never looks at the file that says `commit`.
    // The contract hash half cannot pass yet — there is no mould-contract.json — and that is reported as
    // UNAVAILABLE rather than quietly scored on the commit half alone.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const FIELDS = ["built_on_commit", "built_on_parent_commit", "commit"];
      const DIRS = ["ledger", "census", "completeness", "freeze", "layers", "mapper", "schema"];
      const byCommit = new Map<string, string[]>();
      const noField: string[] = [];
      for (const d of DIRS) {
        const dir = path.join(REPO_ROOT, "data", d);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
          const rel = `data/${d}/${name}`;
          let j: Record<string, unknown>;
          try { j = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
          if (typeof j !== "object" || j === null || Array.isArray(j)) continue;
          const f = FIELDS.find((k) => typeof j[k] === "string");
          if (!f) { noField.push(rel); continue; }
          const c = String(j[f]).slice(0, 7);
          byCommit.set(c, [...(byCommit.get(c) ?? []), rel]);
        }
      }
      const commits = [...byCommit.keys()];
      const contract = fs.existsSync(path.join(REPO_ROOT, "src", "core", "mould-contract.json"));
      if (!commits.length) return na("no artefact records a build commit at all");
      const spread = commits.map((c) => `${c} (${byCommit.get(c)!.length} files)`).join(", ");
      if (commits.length > 1) {
        const odd = commits.sort((a, b) => byCommit.get(a)!.length - byCommit.get(b)!.length)[0];
        return bad(`${commits.length} DIFFERENT build commits across the artefacts: ${spread}`
          + ` — the smallest is ${odd}: ${byCommit.get(odd)!.slice(0, 4).join(", ")}`
          + `; ${noField.length} artefacts record no build field at all`
          + `; contract hash ${contract ? "present" : "NOT POSSIBLE — no src/core/mould-contract.json exists"}`);
      }
      return contract
        ? ok(`one build commit ${commits[0]} across ${byCommit.get(commits[0])!.length} artefacts, contract hash present`)
        : na(`all artefacts agree on ${commits[0]}, but there is no mould-contract.json, so the contract-hash half of this test cannot run`);
    },
  },
  {
    name: "db_site_api_parity",
    findings: "N1, N59, N60",
    needsDb: true,
    // 500 SEEDED SKUs so two runs compare the same rows and a moved number means the DATA moved. The reviewer
    // asked for the per-category counts to be PRINTED by the test rather than estimated, because that number
    // is the dry-run count for the write plans — an estimate would become a plan nobody could check.
    //
    // WHAT THIS TEST CANNOT SEE, measured rather than assumed. The sample is drawn from the layer artifact's
    // own key set, so it can only ever check parts the layering already places. Asking "how many live cisco
    // hardware parts does the layering miss" returns 41,067 of 41,067 — EXACTLY zero, which is the shape of a
    // population compared with itself, and it is: the layer build's population IS live cisco hardware, so the
    // answer is a tautology and not a reassurance. The real blind spot is everything outside that class —
    // 10,547 live cisco `software` parts, and 3,476 live hardware parts across the other vendors — none of
    // which any layer test here can sample. `vendor_coverage` carries that half.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      const { partRecords } = await import("../src/api/queries/part.js");
      const { RENDERED_STATES } = await import("../src/api/queries/shared.js");
      let seed = 20260927;                                    // seeded, not Math.random: comparable across runs
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const art = new Map<string, { cat: string; series: string; line: string }>();
      const dir = path.join(REPO_ROOT, "data", "layers");
      for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("cisco-") && x.endsWith(".rows.tsv"))) {
        const cat = f.slice("cisco-".length, -".rows.tsv".length);
        const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
        const h = L[0].split("\t"), ci = (n: string) => h.indexOf(n);
        if (ci("sku") < 0 || ci("series") < 0 || ci("product_line") < 0) continue;
        for (const l of L.slice(1)) { const c = l.split("\t"); art.set(c[ci("sku")], { cat, series: c[ci("series")], line: c[ci("product_line")] }); }
      }
      const all = [...art.keys()];
      if (all.length < 500) return na(`only ${all.length} placed parts — cannot draw a 500 sample`);
      const pick = new Set<string>();
      while (pick.size < 500) pick.add(all[Math.floor(rnd() * all.length)]);
      const skus = [...pick];
      const ids = (await query<{ id: number; sku: string; series: string | null }>(`
        SELECT p.id, p.sku, p.series FROM parts p JOIN vendors v ON v.id=p.vendor_id
         WHERE v.slug='cisco' AND p.retired_at IS NULL AND p.sku = ANY($1::text[])`, [skus])).rows;
      if (!ids.length) return na(`0 of 500 sampled SKUs resolved in the DB — a broken join, not a finding`);
      const recs = await partRecords(ids.map((r) => r.id), [...RENDERED_STATES], "https://api.netzspec.com/v1") as unknown as
        { sku: string; product_line: string | null; product_series: string | null; series: string | null }[];
      const byCat = new Map<string, { n: number; seriesDiff: number; lineMissing: number }>();
      for (const r of recs) {
        const a = art.get(r.sku); if (!a) continue;
        const e = byCat.get(a.cat) ?? { n: 0, seriesDiff: 0, lineMissing: 0 };
        e.n++;
        if ((ids.find((i) => i.sku === r.sku)?.series ?? "") !== a.series) e.seriesDiff++;   // DB column vs layer page
        if (r.product_line !== a.line) e.lineMissing++;                                       // API record vs layer page
        byCat.set(a.cat, e);
      }
      const checked = [...byCat.values()].reduce((n, e) => n + e.n, 0);
      const sDiff = [...byCat.values()].reduce((n, e) => n + e.seriesDiff, 0);
      const lDiff = [...byCat.values()].reduce((n, e) => n + e.lineMissing, 0);
      const perCat = [...byCat].sort((a, b) => b[1].seriesDiff - a[1].seriesDiff)
        .map(([c, e]) => `${c} ${e.seriesDiff}/${e.n}`).join(", ");
      if (sDiff === 0 && lDiff === 0) return ok(`${checked} sampled SKUs: DB, layer page and API record agree on line and series`);
      return bad(`${checked} sampled: series DB-vs-page differs on ${sDiff} (${(100 * sDiff / checked).toFixed(1)}%), `
        + `product_line API-vs-page differs on ${lDiff}. PER-CATEGORY (the dry-run count for any series write): ${perCat}`);
    },
  },
  {
    name: "ledger_parity",
    findings: "N45",
    // Honestly unavailable rather than quietly absent: there is no /v1/ledger route at HEAD to compare against,
    // so this cannot be run here at all — and saying so is the point of the UNAVAILABLE state.
    run: async () => {
      const fs = await import("node:fs"), path = await import("node:path");
      const { REPO_ROOT } = await import("../src/config.js");
      // It tested for src/api/routes/ledger.ts, which has NEVER existed, and reported UNAVAILABLE for the
      // wrong reason - "no route" when the route is registered in start.ts and /v1/ledger answers 200. An
      // unavailable verdict with a false cause is worse than none: it sent the reviewer hunting a deleted
      // endpoint. Look for the REGISTRATION, not for a filename I assumed.
      const start = path.join(REPO_ROOT, "src", "api", "routes", "start.ts");
      const registered = fs.existsSync(start) && fs.readFileSync(start, "utf8").includes("/ledger/");
      return registered
        ? na("the /v1/ledger route IS registered in src/api/routes/start.ts; byte-comparing it needs the deployed service, which this run does not call")
        : na("no /v1/ledger registration found in src/api/routes/start.ts");
    },
  },
  { name: "kind_profile_parity", findings: "B1" },
  { name: "four_sets_sum", findings: "B4" },
  { name: "no_family_reason_present", findings: "B2, B3" },
  { name: "bucket_not_series", findings: "B3" },
  { name: "twin_parity", findings: "N7" },
  { name: "unknown_zero", findings: "B7" },
  { name: "plans_agree_with_rows", findings: "N6" },
  {
    name: "runs_have_approval",
    findings: "B8, N5",
    needsDb: true,
    // B8 reads as a paperwork gap ("the published run record shows no approval") and it is structural: there
    // is no approval COLUMN and no run carries one in `inputs`, so the blanket sentence of 25 Sep is not
    // recorded anywhere a check could read. The test also prints the run count, because the brief says 7,533
    // runs and the table holds a different number — a figure the reviewer and I should reconcile before
    // anyone approves "12 groups" of something neither of us has counted the same way.
    run: async () => {
      const cols = (await query<{ c: string }>(`SELECT column_name c FROM information_schema.columns
         WHERE table_schema='public' AND table_name='runs'`)).rows.map((r) => r.c);
      const hasCol = cols.some((c) => /approv|consent|authoris|authoriz/.test(c));
      const total = Number((await query<{ n: string }>(`SELECT count(*)::text n FROM runs`)).rows[0].n);
      // Scan for ANY approval-shaped key instead of guessing one. The first version tested a single
      // spelling and would have reported "none" just as confidently had the key been approved,
      // approval_quote or sign_off. A zero from a guessed field name is not a measurement.
      const keys = (await query<{ k: string }>(
        "SELECT DISTINCT k FROM runs, LATERAL jsonb_object_keys(inputs) k")).rows.map((r) => r.k);
      const apprKeys = keys.filter((k) => /approv|consent|authoris|authoriz|sign_?off/i.test(k));
      const inInputs = apprKeys.length === 0 ? 0 : Number((await query<{ n: string }>(
        "SELECT count(*)::text n FROM runs WHERE inputs ?| $1::text[]", [apprKeys])).rows[0].n);
      const writers = Number((await query<{ n: string }>(
        `SELECT count(*)::text n FROM runs WHERE status='succeeded' AND stats IS NOT NULL`)).rows[0].n);
      // EVERY NUMBER HERE IS COMPUTED. The first version guessed the key name `approval`, found none, and
      // reported "NO approval is recorded anywhere" — which was FALSE and which I passed on to both the
      // operator and the reviewer. The key is spelled `approved` and 134 runs carry one, several with the
      // operator's own words in them. The reviewer caught it by reading the code rather than the output.
      // The second version then hard-coded "NONE is approval-shaped" beside a count that said 134: prose
      // next to a computed value, contradicting it, for the third time in one session. Nothing is written
      // in words here that the query has not just answered.
      const found = apprKeys.length ? apprKeys.join(", ") : "none";
      return hasCol || inInputs === total
        ? ok(`all ${total} runs record an approval (key: ${found})`)
        : bad(`${total - inInputs} of ${total} runs record NO approval — ${inInputs} do, under ${found}; `
          + `runs has no approval column, so it lives in inputs by convention. ${writers} succeeded runs wrote `
          + `stats. The brief cites 7,533 runs; this table holds ${total} — reconcile before approving per group`);
    },
  },
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
  {
    name: "keys_hygiene",
    findings: "N70 (reclassified) — the reviewer's control, added 27 Sep",
    needsDb: true,
    // WHY THIS EXISTS. I rotated the reviewer's API key by revoking the id I remembered — 15,
    // "claude-web-url". The reviewer never had it. The token it had been using all day hashed to a row
    // called "owner" (id 2), minted 9 Sep, which had appeared VERBATIM in an audit prompt on 12 Sep and was
    // therefore in chat transcripts for three weeks. So the rotation revoked a key nobody held and left the
    // exposed one live, and both of us believed it was done: I said "the old one is revoked", the reviewer
    // said "revocation is not enforced", and neither was true — we were talking about different rows.
    //
    // The missing control is not "enforce revocation" (auth.ts:133 already does). It is that a key must
    // name its HOLDER and its CHANNEL, and a rotation must revoke by the hash of the token being replaced
    // rather than by an id from memory. Two active keys here are both called "netzspec"; one was last used
    // three weeks ago and one is in use today, and nothing on the row says which belongs to what.
    run: async () => {
      // Hand-written, and deliberately so: a list of what is EXCLUDED stays short, every line needs a
      // reason, and a key minted tomorrow is NOT admitted silently — which is the whole point here.
      const KNOWN: Record<number, string> = {
        3: "in daily use — presumed the netzspec.com site; holder unconfirmed, see below",
        16: "the reviewer, minted 27 Sep 2026, read scope",
      };
      const rows = (await query<{ id: number; name: string; last: string | null; scopes: string[] }>(`
        SELECT id, name, last_used_at::text last, scopes FROM api_keys WHERE revoked_at IS NULL ORDER BY id`)).rows;
      const problems: string[] = [];
      const unknown = rows.filter((r) => !(r.id in KNOWN));
      for (const r of unknown) problems.push(`id ${r.id} "${r.name}" active with no recorded holder (last used ${r.last ?? "never"})`);
      const byName = new Map<string, number[]>();
      for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r.id]);
      for (const [n, ids] of byName) if (ids.length > 1) problems.push(`${ids.length} active keys share the name "${n}" (ids ${ids.join(", ")}) — a rotation cannot tell them apart`);
      const write = rows.filter((r) => !r.scopes.every((sc) => sc === "read"));
      for (const r of write) problems.push(`id ${r.id} "${r.name}" is not read-only (${r.scopes.join(",")})`);
      return problems.length === 0
        ? ok(`${rows.length} active keys, each with a recorded holder and a unique name`)
        : bad(`${problems.length} of ${rows.length} active keys: ${problems.join("; ")}`);
    },
  },
  {
    name: "brand_isolation",
    findings: "operator 27 Sep — NOT one of the brief's 27, added because the brief has no test for it",
    needsDb: true,
    // vendor_coverage asks "which brands have no mould". This asks the sharper question the operator put:
    // is a brand WITHOUT a mould being measured by another brand's? Profiles are keyed by category, never by
    // vendor, so the answer was yes and silently: every non-cisco part in `switches` is asked for the cups
    // that were designed by reading cisco switches. Until this is zero, no statement about "cisco's mould is
    // complete" can be trusted, because cisco's denominators contain other brands' parts.
    run: async () => {
      const vendors = (await query<{ slug: string }>(`SELECT slug FROM vendors`)).rows.map((r) => r.slug);
      const arranged = new Set(mouldStatuses(vendors).filter((s) => s.arranged).map((s) => s.vendor));
      if (!arranged.size) return na("no brand has a mould at all — nothing to isolate");
      const rows = (await query<{ vendor: string; parts: string; req: string }>(`
        SELECT v.slug vendor, count(*)::text parts, coalesce(sum(cp.required_total),0)::text req
          FROM completeness cp JOIN parts p ON p.id=cp.part_id JOIN vendors v ON v.id=p.vendor_id
         WHERE p.retired_at IS NULL AND cp.no_profile = false AND NOT (v.slug = ANY($1::text[]))
         GROUP BY 1 ORDER BY 3 DESC`, [[...arranged]])).rows;
      if (!rows.length) return ok(`only arranged brands (${[...arranged].join(", ")}) carry a score`);
      const parts = rows.reduce((n, r) => n + Number(r.parts), 0);
      const slots = rows.reduce((n, r) => n + Number(r.req), 0);
      return bad(`${parts} parts of ${rows.length} UNARRANGED brands are scored against a mould built for `
        + `${[...arranged].join(", ")} — ${slots.toLocaleString()} required slots demanded of them: `
        + rows.slice(0, 5).map((r) => `${r.vendor} ${r.parts}p/${Number(r.req).toLocaleString()}s`).join(", "));
    },
  },
  {
    name: "no_profile_reason_recorded",
    findings: "reviewer 27 Sep — NO_MOULD_REASON exported and never written",
    needsDb: true,
    // `completeness.no_profile` was ONE boolean carrying FOUR unrelated facts: this brand has no mould, this
    // is a licence, the role table says this row is not the kind its category scores it as, and this category
    // has no profile at all. Each needs different work — arrange a brand, nothing, reclassify a part, build a
    // profile — so a single flag made the question unaskable, which is how 3,476 parts of twelve unarranged
    // brands sat inside Cisco's denominators unnoticed. Migration 0024 gives the row a reason and a rule id.
    //
    // TWO THINGS ARE CHECKED AND THEY FAIL FOR DIFFERENT REASONS.
    //
    // 1. The code's list against the SCHEMA's, in both directions. Nothing in this repo had ever compared a
    //    TypeScript list to the constraint that governs it, so every agreement check was comparing one
    //    hand-written list with another hand-written list. That is not a check; a value added to the code and
    //    not to the constraint fails on the first write, and one added to the constraint and not the code is a
    //    value no writer can ever produce.
    // 2. The pairing invariant over LIVE rows, in both directions: an unscored row must say why, and a scored
    //    row must not claim a reason. The first direction is the one that matters — a row marked not-scored
    //    with a NULL reason is precisely the state this column exists to end — and it is also the state every
    //    row was in before the backfill, so this check is what proves the backfill actually ran.
    run: async () => {
      const def = (await query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname = 'completeness_no_profile_reason_ck'`)).rows;
      if (!def.length) return bad("the CHECK constraint completeness_no_profile_reason_ck is missing — migration 0024 has not run here");
      const inSchema = new Set([...def[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]));
      const inCode = new Set<string>(NO_PROFILE_REASONS);
      const codeOnly = [...inCode].filter((r) => !inSchema.has(r));
      const schemaOnly = [...inSchema].filter((r) => !inCode.has(r));
      if (codeOnly.length || schemaOnly.length) {
        return bad(`the reason list disagrees with the schema: ${codeOnly.length ? "in code only " + codeOnly.join(", ") : ""}`
          + `${codeOnly.length && schemaOnly.length ? "; " : ""}${schemaOnly.length ? "in the constraint only " + schemaOnly.join(", ") : ""}`);
      }
      const inv = (await query<{ missing: string; spurious: string; rule_wrong: string }>(`
        SELECT count(*) FILTER (WHERE no_profile = true  AND no_profile_reason IS NULL)     missing,
               count(*) FILTER (WHERE no_profile = false AND no_profile_reason IS NOT NULL) spurious,
               count(*) FILTER (WHERE no_profile_rule IS NOT NULL
                                  AND no_profile_reason IS DISTINCT FROM 'kind_refused_by_role_table') rule_wrong
          FROM completeness cm JOIN parts p ON p.id = cm.part_id WHERE p.retired_at IS NULL`)).rows[0];
      const missing = Number(inv.missing), spurious = Number(inv.spurious), ruleWrong = Number(inv.rule_wrong);
      const by = (await query<{ r: string; n: string }>(`
        SELECT coalesce(no_profile_reason, '(null)') r, count(*) n
          FROM completeness cm JOIN parts p ON p.id = cm.part_id
         WHERE p.retired_at IS NULL AND cm.no_profile = true GROUP BY 1 ORDER BY count(*) DESC`)).rows;
      const breakdown = by.map((x) => `${x.r} ${Number(x.n).toLocaleString()}`).join(", ");
      if (missing || spurious || ruleWrong) {
        return bad(`${missing.toLocaleString()} unscored row(s) do not say WHY, ${spurious} scored row(s) claim a reason, `
          + `${ruleWrong} rule id(s) on a non-refusal — recompute has not backfilled every category. Breakdown: ${breakdown}`);
      }
      return ok(`${inCode.size} reasons, code and constraint agree both ways; every unscored row names one: ${breakdown}`);
    },
  },
  {
    name: "derived_gate_nulls",
    findings: "reviewer item 3 / D1 — a derived gate that derives to nothing",
    needsDb: true,
    // `deploy_role` is DERIVED from the SKU, not extracted, so "no value" cannot mean "nobody has scraped it
    // yet" — it means the rule table could not place the part, and no amount of scraping will change that.
    // This counts the nulls per (category, kind) and splits them by WHY, because the three reasons need
    // opposite handling and only one of them is a defect:
    //
    //   an ISSUE rule refuses the row   the table says it is not this kind. 18 PON rows; they leave the
    //                                   score entirely (completeness.no_profile_reason).
    //   axis exists, no rule matches    COULD-NOT-DERIVE. This is the one that must be zero: the part is
    //                                   scored, its role-gated cups go `pending`, and nothing can ever
    //                                   answer them. A number here is work, not noise.
    //   no role axis for the kind       not counted at all — a CPU has no deployment role.
    //
    // THE DENOMINATOR IS ASSERTED, NOT JUST THE NULLS (the reviewer's condition, and it is the sharp part).
    // A check that only counts nulls gets GREENER when a kind loses its axis by accident: the parts stop
    // being asked, the nulls go to zero, and nothing says the population vanished. So every pair AXIS
    // declares must still hold parts, and the total is printed on every run.
    //
    // FLOORS, NOT EXACT EQUALITY, and the reason is stated rather than assumed: this catalogue grows, so an
    // exact 9,010 would go red on the next import of real switches and teach everyone to ignore the colour.
    // A floor still fails in the direction that matters — a pair emptying, or the population shrinking —
    // which is the accident the reviewer named.
    run: async () => {
      const FLOOR: Record<string, number> = {  // measured 27 Sep 2026, cisco live hardware
        "switches|switch": 4242, "routers|router": 1288, "routers|sp-router": 264,
        "wireless|ap": 2767, "collaboration-endpoints|phone": 442, "unified-communications|phone": 7,
      };
      const rows = (await query<{ sku: string; name: string | null; cat: string }>(`
        SELECT p.sku, p.name, c.slug cat FROM parts p
          JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
         WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`)).rows;
      const seen = new Map<string, number>();
      let axisParts = 0, refused = 0, couldNotDerive = 0;
      const cnd: string[] = [];
      for (const r of rows) {
        const kind = partKind(r.cat, r.sku, r.name ?? undefined);
        if (!roleAxisOf(r.cat, kind)) continue;              // no axis: not this check's population
        axisParts++;
        seen.set(`${r.cat}|${kind}`, (seen.get(`${r.cat}|${kind}`) ?? 0) + 1);
        const res = deployRoleResult(r.cat, kind, r.sku, r.name);
        if (res.role !== null) continue;
        if (res.issue) { refused++; continue; }
        couldNotDerive++;
        if (cnd.length < 6) cnd.push(`${r.sku} (${r.cat}/${kind})`);
      }
      // NO POPULATION IS ITS OWN VERDICT, not a pass. Run this against a brand with no role-bearing kind
      // and every count below is 0 and every floor comparison is vacuous -- which reads exactly like
      // "all roles derived cleanly". It says so instead. This is also what makes `none()` a state with a
      // producer rather than a word in the vocabulary that nothing ever emits.
      if (axisParts === 0) {
        return none(`no part of any role-bearing (category, kind) pair exists here, so there is no role `
          + `derivation to judge -- this is not "all roles derived", it is nothing to derive`);
      }
      const shrunk = Object.entries(FLOOR).filter(([k, n]) => (seen.get(k) ?? 0) < n)
        .map(([k, n]) => `${k} ${seen.get(k) ?? 0} < ${n}`);
      const total = axisParts.toLocaleString();
      if (shrunk.length) {
        return bad(`a role-bearing population SHRANK, so fewer parts are being asked for a role than when this was `
          + `measured — a kind that loses its axis makes a null count greener, which is why this is here: ${shrunk.join(", ")}`);
      }
      if (couldNotDerive > 0) {
        return bad(`${couldNotDerive} part(s) of a role-bearing kind have a role that CANNOT BE DERIVED — their role-gated `
          + `cups are pending on a field nothing can ever answer: ${cnd.join(", ")}`);
      }
      return ok(`${total} parts of ${seen.size} role-bearing (category, kind) pairs, every floor held; `
        + `roles derived on all but ${refused} the table REFUSES as the wrong kind (they leave the score with a reason)`);
    },
  },
  {
    name: "vendor_coverage",
    findings: "N62",
    needsDb: true,
    // The mould is Cisco-only and the shop imports every vendor. N62 named five; the query counts them. Its HPE
    // figure and mine disagree, which is printed rather than reconciled silently — a coverage number nobody
    // can reproduce is the thing this whole exercise exists to stop.
    run: async () => {
      const rows = (await query<{ vendor: string; n: string }>(`
        SELECT v.slug vendor, count(*)::text n FROM parts p JOIN vendors v ON v.id=p.vendor_id
         WHERE v.slug <> 'cisco' AND p.retired_at IS NULL AND p.product_class='hardware'
         GROUP BY 1 ORDER BY 2 DESC`)).rows;
      const total = rows.reduce((n, r) => n + Number(r.n), 0);
      if (!rows.length) return ok("cisco is the only vendor with live hardware parts");
      const list = rows.map((r) => `${r.vendor} ${r.n}`).join(", ");
      return bad(`${rows.length} vendors hold ${total} live hardware parts with NO layering, ledger or kinds: ${list}`
        + ` — N62 named five of these ${rows.length}`);
    },
  },
];

// ---- run ----------------------------------------------------------------------------------------------------------
const noDb = process.argv.includes("--no-db");
let pass = 0, fail = 0, notImpl = 0, unavail = 0, notExercised = 0;
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
  else if (r.state === "not_exercised") { notExercised++; console.log(`  ----  ${t.name.padEnd(30)} NOT EXERCISED  ${r.detail}`); }
  else { unavail++; console.log(`  ????  ${t.name.padEnd(30)} UNAVAILABLE  ${r.detail}`); }
}

console.log(`\n  passed ${pass}   FAILED ${fail}   not implemented ${notImpl}   unavailable ${unavail}   not exercised ${notExercised}`
  + `   (of ${TESTS.length} declared)`);
if (fail) console.log(`  failing: ${failed.join(", ")}`);
if (notExercised) console.log(`  ${notExercised} test(s) had NO POPULATION to judge - they neither passed nor failed; what they watch for has no members today.`);
if (notImpl) console.log(`  ${notImpl} declared tests are not written yet — this run does NOT certify their findings.`);
await closePool().catch(() => {});
process.exit(fail ? 1 : unavail ? 2 : 0);
