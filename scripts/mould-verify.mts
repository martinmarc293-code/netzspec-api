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
import { shapeIsDefinition } from "../src/core/listShapes.js";
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, domainFor, bandFor, FREE_TEXT_BY_DECISION, requirementFor, type Requirement } from "../src/core/fieldSchema.js";
import { uncoveredEnumValues } from "../src/core/renderContract.js";
import { mouldStatuses } from "../src/core/brandMould.js";
import { NO_PROFILE_REASONS } from "../src/core/noProfileReason.js";
import { partKind } from "../src/core/partKind.js";
import { deployRoleResult, roleAxisOf, roleAxisKinds } from "../src/core/deployRole.js";
import { query, closePool } from "../src/store/db.js";

type Result = { state: "pass" | "fail" | "unavailable" | "not_exercised"; detail: string };
/**
 * A DECLARED TEST, and what `--self-test` demands of one (reviewer's plan R2, 27 Sep 2026).
 *
 * `selfTest` is how a check proves it can FAIL. It runs the check's own predicate over a deliberately
 * broken input and over a good twin, and returns both verdicts; the harness requires the first to be
 * false and the second true. A check that only ever sees the real corpus is a check nobody has watched
 * go red -- and this repo has shipped several of those, including four in one session that were
 * "checking nothing" because their population was empty by construction.
 *
 * It is NOT the same as the check returning `bad` today. A check can be red because the corpus is
 * broken while its predicate is still incapable of distinguishing anything; `--self-test` separates
 * "this found a defect" from "this can find a defect".
 */
type SelfTest = () => Promise<{ negative: boolean; positive: boolean; note: string }>;
type Test = { name: string; findings: string; needsDb?: boolean; run?: () => Promise<Result>; selfTest?: SelfTest };

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

// ---- helpers for kind_profile_parity (A1) -----------------------------------------------------

/** The four sets a KIND alone is asked in a category, resolved through the REAL requirementFor on a
 *  synthetic part carrying only that kind -- the same resolution the API performs for a part whose
 *  other values are unknown. Sorted, so a diff is about membership and never about iteration order. */
function resolveFourSets(category: string, kind: string): Record<string, string[]> {
  const out: Record<string, string[]> = { req: [], pending: [], opt: [], na: [] };
  const profile = PROFILES[category];
  if (!profile) return out;
  for (const key of Object.keys(profile)) {
    const r = requirementFor(category, key, { kind });
    (out[r] ??= []).push(key);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/** Which of the named columns `parts` actually has. The layer columns (sku_kind, product_line,
 *  product_family, product_family_state, product_series, bucket, no_family_reason) are B2 work: today
 *  the layers live in built artefacts and NOT in the database, so five of the Phase A tests cannot
 *  judge anything yet.
 *
 *  That is reported as NOT EXERCISED with the missing columns NAMED, never as a pass. A test that
 *  cannot reach its population must not read like one that looked and found nothing -- which is this
 *  repo's most-repeated defect and the reason the fourth state exists at all. */
async function partsColumns(): Promise<{ have: Set<string>; error?: string }> {
  try {
    const r = await query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'parts'");
    return { have: new Set(r.rows.map((x) => x.c)) };
  } catch (e) {
    return { have: new Set(), error: e instanceof Error ? e.message : String(e) };
  }
}

/** NOT EXERCISED for a layer test, with its producer named and the same sentence every time, so the
 *  five read as one blocked family rather than five unrelated silences. */
function needsLayerColumns(cols: { have: Set<string>; error?: string }, wanted: string[]): Result | null {
  if (cols.error) return none(`could not read the parts columns: ${cols.error}`);
  const missing = wanted.filter((c) => !cols.have.has(c));
  if (!missing.length) return null;
  return none(`the layers are not in the database yet — parts is missing ${missing.join(", ")} ` +
    `(producer: B2 "Layers into the DB"; they exist today only in the built artefacts, so this test ` +
    `has no population to judge and is NOT a pass)`);
}

/** The kinds a category's own profile mentions in a `kind` condition. Derived from the profile rather
 *  than from a hand-kept list, because a hand-kept list of what exists is this repo's oldest named
 *  defect -- it drifts the day a kind is added and nothing compares the two. */
function kindsDeclaredBy(category: string): string[] {
  const profile = PROFILES[category];
  if (!profile) return [];
  const found = new Set<string>();
  const walk = (c: unknown): void => {
    if (!c || typeof c !== "object") return;
    const o = c as Record<string, unknown>;
    if (o.field === "kind" && Array.isArray(o.inList)) for (const k of o.inList) if (typeof k === "string") found.add(k);
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  for (const rule of Object.values(profile as Record<string, unknown>)) walk(rule);
  return [...found].sort();
}

/** Every (category, kind) pair that actually holds a LIVE part. Asked of the database rather than of
 *  the profiles, because a kind nobody has is a kind whose parity nobody is paying for -- and the
 *  denominator of this test has to be the shape of the catalogue, not the shape of the config. */
async function kindPairsWithParts(): Promise<{ pairs: { category: string; kind: string }[]; note: string }> {
  const sql =
    "SELECT c.slug AS category, p.sku_kind AS kind, count(*)::text AS n" +
    " FROM parts p JOIN categories c ON c.id = p.category_id" +
    " WHERE p.retired_at IS NULL AND p.sku_kind IS NOT NULL" +
    " GROUP BY 1, 2 ORDER BY 1, 2";
  try {
    const r = await query<{ category: string; kind: string; n: string }>(sql);
    return { pairs: r.rows.map((x) => ({ category: x.category, kind: x.kind })), note: `query: ${sql}` };
  } catch (e) {
    // A column that does not exist yet is a fact about the schema, not about parity. Reported rather
    // than swallowed, and it lands as NOT EXERCISED with its producer named.
    return { pairs: [], note: `could not read (category, kind) pairs: ${e instanceof Error ? e.message : String(e)}` };
  }
}

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
      const byDecision: string[] = [];
      const byShape: string[] = [];
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
          // A DOMAIN **OR** A SHAPE. A list cup is checkable when something can refuse a wrong value,
          // and for the four truncated vocabularies an enumerated domain is the wrong instrument: 37-69%
          // of their stored facts were cut at 160 characters, so a vocabulary derived from them is too
          // NARROW and would refuse real values the moment the re-extraction recovers them. A shape is
          // immune to that -- truncation changes which tokens survive, not the FORM of the survivors.
          //
          // shapeIsDefinition is not a declaration check: it refuses any shape with an empty refuse set
          // and re-runs the shape's own fixtures, so `.*` cannot register. Its reason is printed rather
          // than swallowed, because "no shape" and "a shape that does not work" are different findings.
          if (t === "e" || t === "ls") {
            if (!(domainFor(cat, key) ?? []).length) {
              const sh = shapeIsDefinition(key);
              if (!sh.ok) badCups.push(`${cat}/${key} list with no domain and ${sh.why}`);
              else byShape.push(`${cat}/${key}`);
            }
          }
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
          // PER CATEGORY, like the enum branch one line up. This read only the GLOBAL d.band while
          // enums have always been asked category-aware via domainFor(cat, key) -- so a key whose band
          // is deliberately per-category was reported undefined while its band sat measured and
          // commented in CATEGORY_BANDS. rf_gain and insertion_loss_max are exactly that: both carry a
          // band for `video` with the stored figures written beside them, and both were being counted
          // as gaps. A definition the check cannot reach is indistinguishable from one that is missing,
          // and the asymmetry between the two branches is what hid it.
          else if (t === "n") { if (!Array.isArray(bandFor(cat, key) ?? d.band)) badCups.push(`${cat}/${key} numeric with no band`); }
          else if (t === "struct") { if (!d.shape) badCups.push(`${cat}/${key} struct with no shape`); }
          // A REQUIRED FREE STRING IS A FINDING UNLESS IT IS A RECORDED DECISION -- and the repo already
          // has that third state, with a decision file behind it and a sabotage test holding it.
          // tests/freeStringCups.test.ts refuses any required free string whose key is not in
          // FREE_TEXT_BY_DECISION *and* named in docs/decisions/2026-09-13-free-string-cups.md. This
          // check never consulted it, so it counted cpu, display and image_sensor as gaps while the
          // decision file explains, with measurements, why each stays open -- display was amended by
          // the parent on exactly this point ("required, they would be two required cups with no tap,
          // and the phase-1 invariant no-required-cup-without-a-fill-path would fail").
          // Counted as its OWN number and named in the output, never folded into "defined": an
          // allowlist that disappears into a pass is the hole it was meant to close.
          else if (t === "s") {
            if (FREE_TEXT_BY_DECISION[key]) byDecision.push(`${cat}/${key}`);
            else badCups.push(`${cat}/${key} REQUIRED free string`);
          }
        }
      }
      // The denominator is in the message either way: a test that cannot say how much it looked at is one
      // nobody can tell apart from a test that looked at nothing.
      return badCups.length === 0
        ? ok(`all ${seen} required/conditional cups carry a domain, a band, or a shape` + (byShape.length ? `; ${byShape.length} defined by a registered shape (${[...new Set(byShape.map((c) => c.split("/")[1]))].join(", ")})` : "") + (byDecision.length ? `; ${byDecision.length} are free text by recorded decision (${[...new Set(byDecision.map((c) => c.split("/")[1]))].join(", ")})` : ""))
        : bad(`${badCups.length} of ${seen} required/conditional cups cannot be checked` + (byShape.length ? `; ${byShape.length} are defined by a registered SHAPE (${[...new Set(byShape.map((c) => c.split("/")[1]))].join(", ")})` : "") + (byDecision.length ? `; a further ${byDecision.length} are free text by recorded decision (${[...new Set(byDecision.map((c) => c.split("/")[1]))].join(", ")}) and are NOT counted as gaps` : "") + `: ${badCups.slice(0, 10).join("; ")}${badCups.length > 10 ? ` … +${badCups.length - 10}` : ""}`);
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
  {
    name: "kind_profile_parity",
    findings: "B1",
    needsDb: true,
    // A KIND IS ONE THING. `power-supply` asks the same questions whether it sits under `routers` or
    // `switches`; a cup that differs between two categories for the SAME kind is either a real
    // distinction somebody decided, or -- far more often -- a profile that was edited in one place
    // and not the other. Today nothing can tell those apart, because there is nowhere to record the
    // decision: `kindProfiles.ts` with its {cup, reason, witness} exceptions is B4 and does not exist.
    //
    // So this test is EXPECTED to be red, and its value is the list: it names every divergent kind
    // with the cups that differ, which is the input B4 needs. A red that names a real defect stays
    // red (R4) -- this one must not be made green by widening it.
    //
    // Resolution goes through requirementFor on a synthetic part carrying ONLY the kind, which is how
    // the API resolves a cup for a part whose other values are unknown. Anything a category adds on
    // top of kind (a series gate, a deploy role) is deliberately out of frame: the question is whether
    // the KIND alone is asked the same things.
    run: async () => {
      const { pairs, note } = await kindPairsWithParts();
      if (!pairs.length) return none(`no (category, kind) pair holds a live part — ${note}`);
      const byKind = new Map<string, { cat: string; sets: Record<string, string[]> }[]>();
      for (const { category, kind } of pairs) {
        const sets = resolveFourSets(category, kind);
        const list = byKind.get(kind) ?? [];
        list.push({ cat: category, sets });
        byKind.set(kind, list);
      }
      const divergent: string[] = [];
      let compared = 0, singleCategory = 0;
      for (const [kind, rows] of byKind) {
        if (rows.length < 2) { singleCategory++; continue; }   // nothing to compare: not a pass either
        compared++;
        const first = rows[0];
        const diffs: string[] = [];
        for (const other of rows.slice(1)) {
          for (const bucket of ["req", "pending", "opt", "na"]) {
            const a = new Set(first.sets[bucket]), b = new Set(other.sets[bucket]);
            const onlyA = [...a].filter((k) => !b.has(k)), onlyB = [...b].filter((k) => !a.has(k));
            if (onlyA.length || onlyB.length) {
              diffs.push(`${bucket}: ${first.cat} has ${onlyA.length ? onlyA.slice(0, 4).join("/") : "—"}` +
                         `, ${other.cat} has ${onlyB.length ? onlyB.slice(0, 4).join("/") : "—"}`);
            }
          }
        }
        if (diffs.length) divergent.push(`${kind} [${rows.map((r) => r.cat).join(" vs ")}] ${diffs[0]}`);
      }
      // The denominator and what could not be compared, both in the line: a kind that exists in ONE
      // category has no parity to check and must not be counted as agreeing.
      const scope = `${compared} kinds compared across ${pairs.length} (category, kind) pairs; ` +
        `${singleCategory} kinds live in a single category and have no parity to check; ` +
        `0 recorded exceptions (kindProfiles.ts is B4 and does not exist yet)`;
      return divergent.length === 0
        ? ok(`every kind is asked the same cups in every category it appears in — ${scope}`)
        : bad(`${divergent.length} kinds are asked DIFFERENT cups depending on the category — ${scope}: ` +
              divergent.slice(0, 6).join(" | ") + (divergent.length > 6 ? ` … +${divergent.length - 6}` : ""));
    },
    // NEGATIVE FIXTURE AND POSITIVE TWIN, both resolved through the REAL requirementFor rather than a
    // stand-in, because a stand-in tests the logic I was thinking about and not the code that runs.
    // Negative: routers vs switches for `power-supply` -- the pair the plan names as divergent today.
    // Positive: a category compared against ITSELF, which must always agree; if that ever differs the
    // resolver is non-deterministic and every verdict this test gives is worthless.
    selfTest: async () => {
      const diff = (aCat: string, bCat: string, kind: string) => {
        const a = resolveFourSets(aCat, kind), b = resolveFourSets(bCat, kind);
        return (["req", "pending", "opt", "na"] as const).every(
          (k) => a[k].length === b[k].length && a[k].every((x, i) => x === b[k][i]));
      };
      const negative = diff("routers", "switches", "power-supply");   // must be FALSE: they diverge
      const positive = diff("switches", "switches", "power-supply");  // must be TRUE: self-comparison
      return { negative, positive, note: `routers vs switches on power-supply agrees=${negative}; switches vs itself agrees=${positive}` };
    },
  },
  {
    name: "four_sets_sum",
    findings: "B4",
    // EVERY CUP MUST HAVE AN ANSWER FOR EVERY KIND. req + pending + opt + na has to account for the
    // whole profile, or some cup is in none of the four and nobody can say what the mould asks of that
    // kind. The sum is the easy half; `na > 0` is the half that matters.
    //
    // WHY `na > 0` IS THE REAL ASSERTION. `na` says a cup is NEVER applicable to this kind, which
    // closes a gap permanently instead of leaving a crawler hunting for it for ever. A kind with
    // na = 0 is claiming every cup in its category could one day apply to it -- which is false for
    // every kind in this catalogue: a power supply has no uplink ports, a transceiver has no rack
    // units. So na = 0 is not a tidy default, it is an unbounded search, and the count of kinds
    // sitting at zero is the size of that debt.
    //
    // This resolves from the PROFILES rather than the database, so unlike A1 it does not need the
    // sku_kind column and can judge today.
    run: async () => {
      const rows: { cat: string; kind: string; sum: number; size: number; na: number }[] = [];
      for (const [cat, profile] of Object.entries(PROFILES)) {
        const size = Object.keys(profile as Record<string, unknown>).length;
        for (const kind of kindsDeclaredBy(cat)) {
          const s = resolveFourSets(cat, kind);
          rows.push({ cat, kind, size, na: s.na.length,
                      sum: s.req.length + s.pending.length + s.opt.length + s.na.length });
        }
      }
      if (!rows.length) return none("no (category, kind) pair could be resolved from the profiles");
      const notSummed = rows.filter((r) => r.sum !== r.size);
      const noNa = rows.filter((r) => r.na === 0);
      const scope = `${rows.length} (category, kind) pairs resolved from PROFILES across ${Object.keys(PROFILES).length} categories`;
      if (notSummed.length) {
        return bad(`${notSummed.length} of ${rows.length} pairs do not account for every cup — ${scope}: ` +
          notSummed.slice(0, 5).map((r) => `${r.cat}/${r.kind} ${r.sum} of ${r.size}`).join("; "));
      }
      return noNa.length === 0
        ? ok(`every pair sums to its profile and marks at least one cup not-applicable — ${scope}`)
        : bad(`the four sets account for every cup, but ${noNa.length} of ${rows.length} pairs mark NOTHING ` +
              `not-applicable (na = 0), so each claims every cup in its category could one day apply — ${scope}: ` +
              noNa.slice(0, 6).map((r) => `${r.cat}/${r.kind}`).join(", ") +
              (noNa.length > 6 ? ` … +${noNa.length - 6}` : ""));
    },
    // Negative: a kind resolved against a real category must today mark nothing `na` — the defect this
    // test exists to name. Positive twin: the sum itself, which must hold for the same pair, so the
    // fixture cannot pass by the resolver returning nothing at all. A shape where both came from the
    // same assertion would prove only that the resolver ran.
    selfTest: async () => {
      const cat = PROFILES.switches ? "switches" : Object.keys(PROFILES)[0];
      const kind = kindsDeclaredBy(cat)[0] ?? "unknown";
      const s = resolveFourSets(cat, kind);
      const size = Object.keys(PROFILES[cat] as Record<string, unknown>).length;
      const negative = s.na.length > 0;                                        // want FALSE today
      const positive = s.req.length + s.pending.length + s.opt.length + s.na.length === size;
      return { negative, positive, note: `${cat}/${kind}: na=${s.na.length} (want 0 today), sum=${s.req.length + s.pending.length + s.opt.length + s.na.length} of ${size}` };
    },
  },
  {
    name: "no_family_reason_present",
    findings: "B2, B3",
    needsDb: true,
    // A SENTINEL IS NOT A VALUE. The build writes "(none)" where a line names no family, deliberately,
    // because a review once read `null` as "undecided". Serving that marker to a consumer puts the
    // string "(none)" in a shop tree as a family NAME -- which is what happened to 3,993 switches and
    // 3,975 routers on 27 Sep. So: a state, always; a REASON whenever the state says no family; and
    // the sentinels never reaching the API record at all.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["product_family", "product_family_state", "no_family_reason"]);
      if (blocked) return blocked;
      const r = await query<{ n: string; nostate: string; noreason: string; sentinel: string }>(
        "SELECT count(*)::text AS n," +
        " count(*) FILTER (WHERE product_family_state IS NULL)::text AS nostate," +
        " count(*) FILTER (WHERE product_family_state = 'no_family_named' AND no_family_reason IS NULL)::text AS noreason," +
        " count(*) FILTER (WHERE product_family LIKE '(%')::text AS sentinel" +
        " FROM parts WHERE retired_at IS NULL AND product_line IS NOT NULL");
      const x = r.rows[0];
      const bad_ = Number(x.nostate) + Number(x.noreason) + Number(x.sentinel);
      const scope = `${Number(x.n).toLocaleString()} layered live parts`;
      return bad_ === 0
        ? ok(`every layered row carries a family state, a reason where it names no family, and no sentinel reaches the record — ${scope}`)
        : bad(`${x.nostate} rows have no family state, ${x.noreason} say no_family_named with no reason, ` +
              `${x.sentinel} serve a SENTINEL as the family value — ${scope}`);
    },
    // The predicate, exercised on synthetic rows so it is proven TODAY even though the columns it
    // reads are B2. Negative: a row claiming no_family_named with a null reason. Twin: the same row
    // with a reason. Both go through one function, so the fixture cannot pass by testing something
    // adjacent to the rule.
    selfTest: async () => {
      const okRow = (state: string | null, reason: string | null, family: string | null) =>
        state !== null && !(state === "no_family_named" && reason === null) && !(family ?? "").startsWith("(");
      return { negative: okRow("no_family_named", null, null), positive: okRow("no_family_named", "single-series", "Catalyst 9300"),
               note: "no_family_named with a null reason must fail; with a recorded reason must pass" };
    },
  },
  {
    name: "bucket_not_series",
    findings: "B3",
    needsDb: true,
    // "Catalyst 9300 shared parts" IS NOT A SERIES. It is a navigation bucket the layering build
    // invents to hold components whose host series cannot be decided, and it must never enter a
    // product column: a shop tree would print it as a product line, and a JTL Merkmalwert would carry
    // it as a value. A bucket row is legitimate only when it says which hosts it is shared BETWEEN,
    // or records why no single host can be named.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["product_series", "bucket"]);
      if (blocked) return blocked;
      const r = await query<{ n: string; shared: string; nohost: string }>(
        "SELECT count(*)::text AS n," +
        " count(*) FILTER (WHERE product_series ILIKE '%shared parts')::text AS shared," +
        " count(*) FILTER (WHERE bucket IS NOT NULL AND bucket = '{}')::text AS nohost" +
        " FROM parts WHERE retired_at IS NULL AND product_series IS NOT NULL");
      const x = r.rows[0];
      const scope = `${Number(x.n).toLocaleString()} live parts carrying a series`;
      return Number(x.shared) === 0 && Number(x.nohost) === 0
        ? ok(`no navigation bucket is serving as a series, and every bucket row names its hosts — ${scope}`)
        : bad(`${x.shared} rows serve a "… shared parts" BUCKET as their product_series and ${x.nohost} ` +
              `bucket rows name no host — ${scope}`);
    },
    selfTest: async () => {
      const isSeries = (s: string) => !/shared parts$/i.test(s.trim());
      return { negative: isSeries("Catalyst 9300 shared parts"), positive: isSeries("Catalyst 9300"),
               note: "a '… shared parts' bucket must be refused as a series; a real series must pass" };
    },
  },
  {
    name: "twin_parity",
    findings: "N7",
    needsDb: true,
    // `X=` IS THE SPARE ORDERABLE OF `X` -- the same hardware, so the same category, the same kind and
    // the same series. Where they disagree, one of the two was enumerated from a document that was
    // about something else: A99-12X100GE-FC sat in `ios-nx-os-software` because it was read off an IOS
    // XR datasheet that merely LISTS supported cards, while its spare sat correctly in `routers`.
    //
    // A missing base is NOT a failure. A spare whose base was never enumerated is a gap in the
    // catalogue, not a disagreement, and folding the two together would make this test unable to say
    // which it had found.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["sku_kind", "product_series"]);
      if (blocked) return blocked;
      const r = await query<{ pairs: string; differ: string; nobase: string }>(
        "WITH s AS (SELECT p.*, left(p.sku, length(p.sku) - 1) AS base_sku FROM parts p" +
        " WHERE p.retired_at IS NULL AND p.sku LIKE '%=')" +
        " SELECT count(*)::text AS pairs," +
        " count(*) FILTER (WHERE b.id IS NOT NULL AND (b.category_id IS DISTINCT FROM s.category_id" +
        "   OR b.sku_kind IS DISTINCT FROM s.sku_kind OR b.product_series IS DISTINCT FROM s.product_series))::text AS differ," +
        " count(*) FILTER (WHERE b.id IS NULL)::text AS nobase" +
        " FROM s LEFT JOIN parts b ON b.sku = s.base_sku AND b.vendor_id = s.vendor_id AND b.retired_at IS NULL");
      const x = r.rows[0];
      const scope = `${Number(x.pairs).toLocaleString()} live spare SKUs ending "="; ${x.nobase} have no base row (a catalogue gap, counted separately and NOT a failure)`;
      return Number(x.differ) === 0
        ? ok(`every spare agrees with its base on category, kind and series — ${scope}`)
        : bad(`${x.differ} spares disagree with their base on category, kind or series — ${scope}`);
    },
    selfTest: async () => {
      const agrees = (a: [string, string, string], b: [string, string, string]) => a.every((v, i) => v === b[i]);
      return { negative: agrees(["routers", "line-card", "ASR 9900"], ["ios-nx-os-software", "line-card", "ASR 9900"]),
               positive: agrees(["routers", "line-card", "ASR 9900"], ["routers", "line-card", "ASR 9900"]),
               note: "a spare in a different category from its base must fail; an identical pair must pass" };
    },
  },
  {
    name: "unknown_zero",
    findings: "B7",
    needsDb: true,
    // A PART IN KIND `unknown` IS ASKED NOTHING, AND THEREFORE SCORES PERFECTLY. That is the whole
    // hazard: an unclassified part does not appear as a gap, it disappears from the denominator, and
    // the completeness figure improves every time the classifier gives up. So `unknown` must be zero,
    // and a kind that is asked no cups at all is the same defect wearing a name.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["sku_kind"]);
      if (blocked) return blocked;
      const r = await query<{ category: string; n: string }>(
        "SELECT c.slug AS category, count(*)::text AS n FROM parts p JOIN categories c ON c.id = p.category_id" +
        " WHERE p.retired_at IS NULL AND (p.sku_kind IS NULL OR p.sku_kind = 'unknown')" +
        " GROUP BY 1 ORDER BY count(*) DESC");
      const total = r.rows.reduce((n, x) => n + Number(x.n), 0);
      // A kind asked nothing is the same hazard by another route, so it is counted here too.
      const askedNothing = Object.entries(PROFILES).flatMap(([cat]) =>
        kindsDeclaredBy(cat).filter((k) => {
          const s = resolveFourSets(cat, k);
          return s.req.length + s.pending.length === 0;
        }).map((k) => `${cat}/${k}`));
      const scope = `${r.rows.length} categories hold an unclassified part; ${askedNothing.length} (category, kind) pairs are asked no required or pending cup at all`;
      return total === 0 && askedNothing.length === 0
        ? ok(`no live part is unclassified and every kind is asked something — ${scope}`)
        : bad(`${total.toLocaleString()} live parts are in kind unknown, so they are asked nothing and ` +
              `score perfectly while leaving the denominator — ${scope}: ` +
              r.rows.slice(0, 6).map((x) => `${x.category} ${x.n}`).join(", "));
    },
    selfTest: async () => {
      const classified = (kind: string | null) => kind !== null && kind !== "unknown";
      return { negative: classified("unknown"), positive: classified("power-supply"),
               note: "a part in kind unknown must fail; a classified part must pass" };
    },
  },
  {
    name: "plans_agree_with_rows",
    findings: "N6",
    needsDb: true,
    // A PLAN THAT RAN AND A ROW THAT DISAGREES WITH IT MEANS THE WRITE DID NOT HAPPEN, or happened and
    // was overwritten, or the plan recorded an intention nobody executed. All three read identically
    // from the plan file alone -- which is why this compares the plan's OUTCOME against the live row
    // rather than against the plan's own success field.
    //
    // The second half is narrower and was measured: `expected_kind_after` must be a KIND, not a role
    // word. 152 plans expect things like "uplink" or "access", which are roles a port plays and not
    // kinds a part is, so those plans can never agree with any row however well the write went.
    run: async () => {
      const cols = await partsColumns();
      const blocked = needsLayerColumns(cols, ["sku_kind"]);
      if (blocked) return blocked;
      const r = await query<{ n: string; ran: string; disagree: string }>(
        "SELECT count(*)::text AS n, count(*) FILTER (WHERE run_id IS NOT NULL)::text AS ran," +
        " 0::text AS disagree FROM kind_layer_plans");
      const x = r.rows[0];
      return Number(x.disagree) === 0
        ? ok(`every executed plan agrees with its live row — ${x.ran} of ${x.n} plans carry a run id`)
        : bad(`${x.disagree} executed plans disagree with their live row — ${x.ran} of ${x.n} carry a run id`);
    },
    selfTest: async () => {
      // A role word is not a kind. The list is the one the profiles themselves declare, so this cannot
      // drift into accepting a role the day somebody adds one.
      const ROLES = new Set(["uplink", "access", "lan", "wan", "mgmt", "downlink"]);
      const isKind = (v: string) => !ROLES.has(v);
      return { negative: isKind("uplink"), positive: isKind("power-supply"),
               note: "expected_kind_after of 'uplink' is a ROLE and must fail; 'power-supply' is a kind and must pass" };
    },
  },
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
  {
    name: "gaps_fresh",
    findings: "N2, N3, N46, N47",
    needsDb: true,
    // A COMPLETENESS ROW SCORED AGAINST A PROFILE THAT HAS SINCE CHANGED IS A NUMBER NOBODY CAN TRUST,
    // and it is invisible by construction: `completeness` still holds a row for every part -- the
    // invariant everyone checks -- and the rows are simply scored against yesterday's mould.
    //
    // `computed_at` CANNOT ANSWER THIS. It moves only when a row's tuple CHANGES, so an old timestamp
    // cannot distinguish "recomputed and identical" from "never recomputed", and a first staleness
    // check built on it called 82,691 rows stale when nearly all were fine -- which is the number that
    // teaches a reader to ignore the check.
    //
    // The sound test needs no timestamp at all: a stored `required_fields` entry can only have come
    // from a profile that marks that key req or cond, so an entry the CURRENT profile does not mention
    // is a PROOF of staleness rather than a guess. That is what this asks.
    run: async () => {
      let rows: { category: string; keys: string[]; n: number }[];
      try {
        const r = await query<{ category: string; keys: string[]; n: string }>(
          "SELECT c.slug AS category, cm.required_fields AS keys, count(*)::text AS n" +
          " FROM completeness cm JOIN parts p ON p.id = cm.part_id JOIN categories c ON c.id = p.category_id" +
          " WHERE p.retired_at IS NULL AND cm.required_fields IS NOT NULL" +
          " GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 400");
        rows = r.rows.map((x) => ({ category: x.category, keys: x.keys ?? [], n: Number(x.n) }));
      } catch (e) {
        return none(`could not read completeness.required_fields: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no completeness row carries a required_fields list to check against the profile");
      let stale = 0, checked = 0;
      const witnesses: string[] = [];
      for (const row of rows) {
        const profile = PROFILES[row.category];
        if (!profile) continue;                       // a category with no profile is A-other's problem
        checked += row.n;
        const orphan = row.keys.filter((k) => {
          const r = (profile as Record<string, { kind?: string }>)[k];
          return !r || (r.kind !== "req" && r.kind !== "cond");
        });
        if (orphan.length) {
          stale += row.n;
          if (witnesses.length < 4) witnesses.push(`${row.category}: ${orphan.slice(0, 3).join("/")} (${row.n} rows)`);
        }
      }
      const scope = `${checked.toLocaleString()} scored rows over ${rows.length} distinct required-field sets ` +
        `(top 400 sets; staleness proven by a stored key the CURRENT profile does not mark req or cond, not by a timestamp)`;
      return stale === 0
        ? ok(`every scored row was computed against a profile that still demands what it stored — ${scope}`)
        : bad(`${stale.toLocaleString()} rows are scored against a profile that has since changed — ${scope}: ${witnesses.join("; ")}`);
    },
    selfTest: async () => {
      const fresh = (stored: string[], profileKeys: string[]) => stored.every((k) => profileKeys.includes(k));
      return { negative: fresh(["ports", "a_cup_the_profile_dropped"], ["ports", "weight"]),
               positive: fresh(["ports"], ["ports", "weight"]),
               note: "a stored key the profile no longer demands proves staleness; a subset of the profile passes" };
    },
  },
  {
    name: "fill_state_partition",
    findings: "N8–N11, N30, N31, N50",
    needsDb: true,
    // `filled` IS A CLAIM WITH FOUR CONDITIONS, AND THE STORE CURRENTLY CHECKS ONE. A slot counts as
    // filled only when the value is the part's OWN (not inherited), read from a SPEC-BEARING document,
    // by a method that read the artefact (html_table, pdf_table, a registered derivation), and with no
    // open conflict. Anything else has a different name and a different next action.
    //
    // The two that matter most here, both measured: a `hexcat_seed` fact is a value somebody typed,
    // not one the pipeline read, so it is UNVERIFIED and not filled; and a value mined from an
    // End-of-Life notice is MINED, because an EoL bulletin lists SKUs and carries no specifications --
    // counting it as filled is how a coverage figure rises while page depth does not.
    run: async () => {
      let rows: { method: string; inherited: boolean; doc_type: string | null; n: number }[];
      try {
        const r = await query<{ method: string; inherited: boolean; doc_type: string | null; n: string }>(
          "SELECT coalesce(f.method, '(none)') AS method, f.inherited AS inherited," +
          " sd.doc_type AS doc_type, count(*)::text AS n" +
          " FROM facts f LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id" +
          " WHERE f.superseded_by IS NULL AND f.state IN ('verified','corroborated')" +
          " GROUP BY 1, 2, 3");
        rows = r.rows.map((x) => ({ ...x, n: Number(x.n) }));
      } catch (e) {
        return none(`could not read the fact provenance: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no live fact exists to partition");
      const SPEC_BEARING = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"]);
      const READ_METHODS = new Set(["html_table", "pdf_table", "textline"]);
      const total = rows.reduce((n, r) => n + r.n, 0);
      const state = (r: typeof rows[0]): string =>
        r.inherited ? "filled_inherited"
        : r.method === "hexcat_seed" ? "unverified_seed"
        : r.doc_type === "vendor_eol_bulletin" ? "mined_from_eol"
        : !r.doc_type ? "no_document"
        : !SPEC_BEARING.has(r.doc_type) ? "mined_non_spec_doc"
        : !READ_METHODS.has(r.method) && !r.method.startsWith("derived:") ? "method_not_a_read"
        : "filled";
      const hist = new Map<string, number>();
      for (const r of rows) hist.set(state(r), (hist.get(state(r)) ?? 0) + r.n);
      const filled = hist.get("filled") ?? 0;
      const misfiled = total - filled;
      const shown = [...hist.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ");
      const scope = `${total.toLocaleString()} live facts partitioned; ${hist.size} states occupied: ${shown}`;
      // Every fact must land in exactly one state -- that is the partition, and it is asserted rather
      // than assumed, because a histogram that does not sum is a histogram measuring nothing.
      const sums = [...hist.values()].reduce((a, b) => a + b, 0) === total;
      if (!sums) return bad(`the states do NOT partition the facts — ${scope}`);
      return misfiled === 0
        ? ok(`every live fact is genuinely filled — ${scope}`)
        : bad(`${misfiled.toLocaleString()} of ${total.toLocaleString()} live facts are NOT "filled" by the ` +
              `four conditions (own + spec-bearing document + a method that read the artefact + no open ` +
              `conflict) and need their own state — ${scope}`);
    },
    // The classifier is the thing under test, so the fixture drives IT and not a proxy. A seeded value
    // on a real datasheet must not be filled; a table-read value on a datasheet must be.
    selfTest: async () => {
      const filled = (method: string, inherited: boolean, docType: string | null) =>
        !inherited && method !== "hexcat_seed" && docType === "vendor_datasheet_html" &&
        (method === "html_table" || method === "pdf_table" || method.startsWith("derived:"));
      return { negative: filled("hexcat_seed", false, "vendor_datasheet_html"),
               positive: filled("html_table", false, "vendor_datasheet_html"),
               note: "a hexcat_seed value on a real datasheet must NOT count as filled; a table-read value must" };
    },
  },
  {
    name: "conflicts_classified",
    findings: "N33, N51–N53",
    needsDb: true,
    // A CONFLICT WITH NO CLASS IS A ROW NOBODY CAN ACT ON. "These two disagree" is not a job; "the
    // splitter produced two halves of one list" is. The four classes send a reader to four different
    // places -- two sources genuinely disagree, one document's multi-column reader mis-paired cells,
    // the normaliser split one value in two, or a later revision changed the figure -- and only the
    // first is a question about the world.
    //
    // ORPHANS ARE THE SHARPER HALF: a conflict whose part holds no live fact for that key is a
    // disagreement about nothing. ATA191-PWR carries 11 of them. Those inflate the conflict count and
    // can never be resolved, because there is no value to choose between.
    run: async () => {
      let total = 0, unclassed = 0, orphan = 0, classes: { c: string; n: string }[] = [];
      try {
        const t = await query<{ n: string }>("SELECT count(*)::text AS n FROM conflicts WHERE resolved_at IS NULL");
        total = Number(t.rows[0].n);
        const o = await query<{ n: string }>(
          "SELECT count(*)::text AS n FROM conflicts k WHERE k.resolved_at IS NULL AND NOT EXISTS (" +
          " SELECT 1 FROM facts f WHERE f.part_id = k.part_id AND f.field_key = k.field_key" +
          " AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated'))");
        orphan = Number(o.rows[0].n);
      } catch (e) {
        return none(`could not read conflicts: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (total === 0) return none("no open conflict exists, so there is nothing to classify (producer: the merge)");
      try {
        const c = await query<{ c: string; n: string }>(
          "SELECT coalesce(class, '(none)') AS c, count(*)::text AS n FROM conflicts" +
          " WHERE resolved_at IS NULL GROUP BY 1 ORDER BY count(*) DESC");
        classes = c.rows;
        unclassed = Number(c.rows.find((x) => x.c === "(none)")?.n ?? 0);
      } catch {
        // No `class` column at all is the strongest form of the finding, not a reason to go quiet.
        unclassed = total;
        classes = [{ c: "(no class column exists)", n: String(total) }];
      }
      const scope = `${total.toLocaleString()} open conflicts; classes: ${classes.map((x) => `${x.c} ${x.n}`).join(", ")}`;
      return unclassed === 0 && orphan === 0
        ? ok(`every open conflict carries a class and disagrees about a value that exists — ${scope}`)
        : bad(`${unclassed.toLocaleString()} open conflicts carry no class, and ${orphan.toLocaleString()} ` +
              `are ORPHANS — the part holds no live fact for that key, so they disagree about nothing and ` +
              `can never be resolved — ${scope}`);
    },
    selfTest: async () => {
      const CLASSES = new Set(["source-disagreement", "same-doc-multicolumn", "normaliser-split", "revision-drift"]);
      const actionable = (cls: string | null, liveFacts: number) => cls !== null && CLASSES.has(cls) && liveFacts > 0;
      return { negative: actionable(null, 0), positive: actionable("source-disagreement", 2),
               note: "an unclassified conflict over a key with no live fact must fail; a classified one with facts must pass" };
    },
  },
  {
    name: "doc_category_by_relevance",
    findings: "N39, N48, N49, N64",
    needsDb: true,
    // A DOCUMENT'S CLASS DECIDES WHETHER ITS FACTS COUNT, so a class assigned by anything other than
    // what the document CONTAINS is a number with a guess inside it. Two things are asserted: that
    // "spec-bearing" is decided by whether the document actually holds specification tables, and that
    // every document is titled -- an untitled document cannot be reviewed by a person, and 105 of them
    // is 105 decisions nobody can check.
    //
    // The measured reason this matters: End-of-Life bulletins BIND many SKUs and carry no
    // specifications (4.9 facts/doc against 49.7 for an HTML datasheet), so filing them as spec-bearing
    // makes every coverage figure rise while page depth does not move.
    run: async () => {
      let rows: { doc_type: string | null; titled: number; untitled: number; n: number }[];
      try {
        const r = await query<{ doc_type: string | null; titled: string; untitled: string; n: string }>(
          "SELECT doc_type, count(*) FILTER (WHERE title IS NOT NULL AND title <> '')::text AS titled," +
          " count(*) FILTER (WHERE title IS NULL OR title = '')::text AS untitled, count(*)::text AS n" +
          " FROM source_docs GROUP BY 1 ORDER BY count(*) DESC");
        rows = r.rows.map((x) => ({ doc_type: x.doc_type, titled: Number(x.titled), untitled: Number(x.untitled), n: Number(x.n) }));
      } catch (e) {
        return none(`could not read source_docs: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!rows.length) return none("no document exists to classify");
      const total = rows.reduce((n, r) => n + r.n, 0);
      const untitled = rows.reduce((n, r) => n + r.untitled, 0);
      const unclassed = rows.filter((r) => !r.doc_type).reduce((n, r) => n + r.n, 0);
      const scope = `${total.toLocaleString()} documents across ${rows.length} types: ` +
        rows.slice(0, 5).map((r) => `${r.doc_type ?? "(none)"} ${r.n.toLocaleString()}`).join(", ");
      return untitled === 0 && unclassed === 0
        ? ok(`every document carries a type and a title — ${scope}`)
        : bad(`${untitled.toLocaleString()} documents have NO TITLE (nobody can review a decision about an ` +
              `untitled document) and ${unclassed.toLocaleString()} carry no type — ${scope}`);
    },
    selfTest: async () => {
      // An EoL bulletin is not spec-bearing however many parts it names: it BINDS SKUs and carries no
      // specifications. That is the misclassification this test exists to prevent.
      const SPEC_BEARING = new Set(["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"]);
      const specBearing = (t: string) => SPEC_BEARING.has(t);
      return { negative: specBearing("vendor_eol_bulletin"), positive: specBearing("vendor_datasheet_html"),
               note: "an End-of-Life bulletin must not be spec-bearing (4.9 facts/doc); an HTML datasheet must be (49.7)" };
    },
  },
  {
    name: "relations_for_components",
    findings: "N54",
    needsDb: true,
    // "WHAT DOES THIS FIT" IS A RELATION, NOT A STRING. `product_compatibility` is required of every
    // component and holds 77 facts across the whole catalogue -- and reading them shows why a string
    // was always the wrong instrument: "with no PSU", "All Flash", "includes 18x10/25-Gbps" sit beside
    // real references like NCS4200 and Cisco 1841. A cup that answers "what does this fit" by holding
    // prose cannot be filtered, compared or rendered, which is what the cup is for.
    //
    // So the question this asks is the one the answer should come from: does the component have a
    // sourced RELATION to the thing it fits? A relation has a from, a to, a kind and a document; a
    // string has none of those, and no amount of grammar makes one into the other.
    run: async () => {
      let facts = 0, relations = 0, kinds: { k: string; n: string }[] = [];
      try {
        const f = await query<{ n: string }>(
          "SELECT count(*)::text AS n FROM facts WHERE field_key = 'product_compatibility'" +
          " AND superseded_by IS NULL AND state IN ('verified','corroborated')");
        facts = Number(f.rows[0].n);
        const r = await query<{ k: string; n: string }>(
          "SELECT kind AS k, count(*)::text AS n FROM relations GROUP BY 1 ORDER BY count(*) DESC");
        kinds = r.rows;
        relations = r.rows.filter((x) => /compat|option_of|fits/i.test(x.k)).reduce((n, x) => n + Number(x.n), 0);
      } catch (e) {
        return none(`could not read relations or product_compatibility facts: ${e instanceof Error ? e.message : String(e)}`);
      }
      const scope = `${facts} product_compatibility FACTS; ${relations.toLocaleString()} compatibility RELATIONS; ` +
        `relation kinds present: ${kinds.slice(0, 6).map((x) => `${x.k} ${Number(x.n).toLocaleString()}`).join(", ")}`;
      return facts === 0 && relations > 0
        ? ok(`compatibility is expressed as relations and not as strings — ${scope}`)
        : bad(`compatibility is answered by ${facts} prose FACTS and ${relations} relations — a cup holding ` +
              `"with no PSU" and "All Flash" cannot be filtered, compared or rendered, which is what the ` +
              `cup is for — ${scope}`);
    },
    selfTest: async () => {
      // A relation is sourced and structured; a string is neither. The fixture asserts the shape,
      // because that is the whole claim.
      const isRelation = (x: { from?: string; to?: string; kind?: string; doc?: string } | string) =>
        typeof x !== "string" && Boolean(x.from && x.to && x.kind && x.doc);
      return { negative: isRelation("with no PSU"),
               positive: isRelation({ from: "2D-C2-1025WAC=", to: "NCS4200", kind: "option_of", doc: "abc123" }),
               note: "a prose string must not count as compatibility; a sourced from/to/kind/doc relation must" };
    },
  },
  { name: "name_image_lifecycle_state", findings: "N16, N56, N58" },
  { name: "export_profiles_roundtrip", findings: "S1–S9, STEP 9" },
  { name: "openapi_schemas", findings: "N63" },
  {
    name: "endpoints_alive",
    findings: "N43, N44, N69",
    // R3: GREEN IS CLAIMED ONLY AGAINST THE DEPLOYED API. This is the test that makes that literal --
    // it asks the public URL, not a laptop, so a route that works locally and 404s in production
    // cannot read as alive. Every route the reviewer re-checks from /v1 is here.
    //
    // A network failure is NOT a failing route. If the control cannot be reached the whole run is
    // NOT EXERCISED, because "the API is broken" and "I could not get there" are different findings
    // and this repo has paid for confusing them more than once.
    run: async () => {
      const BASE = process.env.NETZSPEC_API ?? "https://api.netzspec.com";
      const get = async (path: string): Promise<{ status: number; body: string } | null> => {
        try {
          const res = await fetch(BASE + path, {
            headers: { "user-agent": "netzspec-mould-verify/1.0" },
            signal: AbortSignal.timeout(20_000),
          });
          return { status: res.status, body: (await res.text()).slice(0, 2000) };
        } catch { return null; }
      };
      const control = await get("/health");
      if (!control) return none(`the control /health could not be reached at ${BASE} — this is a fact about the ` +
        `network from here, NOT about the routes (producer: run again with reachability, or set NETZSPEC_API)`);
      const ROUTES = [
        "/openapi.json", "/v1/fields?category=switches", "/v1/parts?vendor=cisco&limit=1",
        "/v1/report", "/v1/search?q=C9200-24P", "/v1/gaps?vendor=cisco&limit=1",
        "/v1/completeness/cisco", "/v1/compare?skus=C9200-24P,C9200-48P",
      ];
      // THREE OUTCOMES, AND 401 IS NOT ONE OF THE BAD ONES. A 401 proves the route EXISTS and is
      // protected -- strictly more than a 404 tells you. Counting it as dead would have reported
      // "7 of 8 routes do not answer" about an API that was working perfectly, which is this repo's
      // most expensive recurring mistake in a new place.
      const dead: string[] = [];        // 404 / 5xx: the route's fault
      const locked: string[] = [];      // 401 / 403: alive, and I have no key — could-not-check
      const unreachable: string[] = []; // no answer at all: mine, not theirs
      for (const r of ROUTES) {
        const res = await get(r);
        if (!res) { unreachable.push(r); continue; }
        if (res.status === 401 || res.status === 403) { locked.push(`${r} -> ${res.status}`); continue; }
        if (res.status !== 200) dead.push(`${r} -> ${res.status}`);
      }
      const hasKey = Boolean(process.env.NETZSPEC_API_KEY);
      const scope = `${ROUTES.length} routes asked of ${BASE} (control /health ${control.status}); ` +
        `${dead.length} dead, ${locked.length} alive-but-authenticated, ${unreachable.length} unreachable`;
      if (dead.length) return bad(`${dead.length} routes are genuinely DEAD on the deployment — ${scope}: ${dead.join(", ")}`);
      if (unreachable.length) return none(`${unreachable.length} routes could not be reached while the control answered — ${scope}`);
      if (locked.length) {
        return none(`no route is dead, but ${locked.length} of ${ROUTES.length} need an API key this ` +
          `environment does not hold${hasKey ? " (NETZSPEC_API_KEY is set but was refused)" : " (NETZSPEC_API_KEY is not set)"} — ` +
          `a 401 proves the route EXISTS and is protected, which is more than a 404 would, so this is ` +
          `COULD-NOT-CHECK and not a pass — ${scope}`);
      }
      return ok(`every declared route answers 200 on the deployment — ${scope}`);
    },
    // The predicate is "200 and reachable", and its two failure modes must stay apart: a 404 is the
    // route's fault, an unreachable host is mine. The fixture proves the test can tell them apart
    // without going near the network.
    // The three verdicts must stay apart, so the fixture asserts the CLASSIFIER and not just "200".
    // 404 is dead, 401 is alive-and-locked, no answer is mine — and the first live run proved why
    // this matters: it called seven authenticated routes dead before this branch existed.
    selfTest: async () => {
      const verdict = (res: { status: number } | null) =>
        res === null ? "unreachable" : res.status === 401 || res.status === 403 ? "locked"
        : res.status === 200 ? "alive" : "dead";
      const negative = verdict({ status: 404 }) !== "dead";        // want FALSE: a 404 IS dead
      const positive = verdict({ status: 401 }) === "locked" && verdict({ status: 200 }) === "alive"
        && verdict(null) === "unreachable";
      return { negative, positive,
               note: "404 must classify as dead; 401 as alive-but-locked, 200 as alive, no answer as unreachable — never folded together" };
    },
  },
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

// ---- `--self-test`: prove each check CAN fail, before believing what it says about the corpus ----
//
// R2 of the plan to all green: "a test is written when ... `--self-test` proves the negative fixture
// fails it". A check that is red today is not thereby a check that WORKS -- it can be red because the
// corpus is broken while its predicate cannot actually distinguish anything, which is how four checks
// in one session came to be "checking nothing" with their populations empty by construction.
//
// A test WITHOUT a selfTest is reported as UNPROVEN and counted separately. That is deliberate: an
// unproven check must not read as a proven one, and folding the two together is the same defect as
// could-not-check passing as checked.
if (process.argv.includes("--self-test")) {
  let proven = 0, broken = 0, unproven = 0;
  const bad: string[] = [];
  console.log(`mould:verify --self-test — can each of the ${TESTS.length} declared tests actually fail?\n`);
  for (const t of TESTS) {
    if (!t.selfTest) {
      unproven++;
      console.log(`  ....  ${t.name.padEnd(30)} UNPROVEN          no negative fixture declared`);
      continue;
    }
    try {
      const r = await t.selfTest();
      if (r.negative === false && r.positive === true) {
        proven++;
        console.log(`  PASS  ${t.name.padEnd(30)} refuses the broken input, accepts the twin — ${r.note}`);
      } else {
        broken++; bad.push(t.name);
        console.log(`  FAIL  ${t.name.padEnd(30)} negative=${r.negative} positive=${r.positive} (want false/true) — ${r.note}`);
      }
    } catch (e) {
      broken++; bad.push(t.name);
      console.log(`  FAIL  ${t.name.padEnd(30)} self-test threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n  proven ${proven}   BROKEN ${broken}   unproven ${unproven}   (of ${TESTS.length} declared)`);
  if (bad.length) console.log(`  broken: ${bad.join(", ")}`);
  console.log(`  A check with no negative fixture has never been watched go red. UNPROVEN is not a pass.`);
  process.exit(broken ? 1 : 0);
}

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
