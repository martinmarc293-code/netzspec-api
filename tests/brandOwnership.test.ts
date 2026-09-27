// tests/brandOwnership.test.ts — proof for src/core/brandOwnership.ts and the guard in src/store/db.ts.
//
//   npx tsx tests/brandOwnership.test.ts
//
// WHY. scraper/brands/ownership.py has refused a foreign test database since 5 Sep 2026, and the
// suites that actually destroy data are TypeScript: 17 files under tests/db/ issue TRUNCATE. On the
// TypeScript side the only check was a NAME PATTERN, /_test\d*$/, which accepts netzspec_test2,
// _test3, _test4 and _test5 equally for every brand. The guard covered the half of the codebase
// that could not do the damage, and the thing keeping three concurrent sessions apart was the
// contents of four .env files — a convention, which is what the whole ownership exercise exists to
// replace.
//
// TWO HALVES, and the second is the one that rots. The refusals below are the guard. The DRIFT
// CHECK at the end reads scraper/brands/ownership.py and fails if the two tables disagree about a
// brand, a database or an unowned name — because this file is a deliberate SECOND copy of a table
// that already exists in another language, and the project's rule for that case is to keep the
// copies and add something that fails when they diverge.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_TEST_DB, UNOWNED_TEST_DATABASES, assertOwnsDatabase, currentBrand, databaseName,
} from "../src/core/brandOwnership.js";
import { loadEnv } from "../src/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, miss = 0;
function check(id: string, what: string, ok: boolean, got: unknown = "") {
  if (ok) pass++; else miss++;
  console.log(`${ok ? "PASS" : "MISS"} | ${id.padEnd(5)} | ${what.slice(0, 84).padEnd(86)}${ok ? "" : ` | got ${String(got).slice(0, 150)}`}`);
}
function refuses(id: string, what: string, fn: () => unknown, mustSay: string): void {
  try { fn(); } catch (e) { const m = String((e as Error).message);
    check(id, what, m.toLowerCase().includes(mustSay.toLowerCase()), m.slice(0, 150)); return; }
  check(id, what, false, "did NOT refuse");
}

const U = (db: string) => `postgres://u:p@127.0.0.1:5433/${db}`;

// ---- the table itself ---------------------------------------------------------------------
check("T1", "every brand has a test database", Object.values(BRAND_TEST_DB).every(Boolean));
check("T2", "no two brands share one — the collision this whole file exists for",
  new Set(Object.values(BRAND_TEST_DB)).size === Object.keys(BRAND_TEST_DB).length, JSON.stringify(BRAND_TEST_DB));
check("T3", "no brand is handed a database documented as UNOWNED and unlocked",
  !Object.values(BRAND_TEST_DB).some((d) => UNOWNED_TEST_DATABASES.includes(d)), JSON.stringify(BRAND_TEST_DB));

// ---- the refusals -------------------------------------------------------------------------
refuses("T4", "SABOTAGE a brand is refused another brand's database, and the message NAMES the owner",
  () => assertOwnsDatabase("cisco", U(BRAND_TEST_DB.juniper)), "juniper");
refuses("T5", "SABOTAGE ...and the reverse direction is refused too, naming cisco",
  () => assertOwnsDatabase("juniper", U(BRAND_TEST_DB.cisco)), "cisco");
refuses("T6", "SABOTAGE an UNOWNED database is refused: 'free' means 'no lock protects it', and all "
            + "four worktrees shared netzspec_test5 while three owned databases sat idle",
  () => assertOwnsDatabase("cisco", U("netzspec_test5")), "unowned");
refuses("T7", "SABOTAGE a brand with no ownership entry is refused rather than waved through",
  () => assertOwnsDatabase("nosuchbrand", U("netzspec_test4")), "no ownership entry");
check("T8", "a brand's OWN database is allowed",
  (() => { try { assertOwnsDatabase("cisco", U(BRAND_TEST_DB.cisco)); return true; } catch { return false; } })());
check("T9", "a process that declares NO brand is NOT refused — the main checkout legitimately runs "
          + "one-off work, and a guard people must switch off is a guard people switch off",
  (() => { try { assertOwnsDatabase(null, U("netzspec_test5")); return true; } catch { return false; } })());
check("T10", "databaseName reads the database out of a URL, and says nothing for one that names none",
  databaseName(U("netzspec_test4")) === "netzspec_test4" && databaseName("") === "");

// ---- the plumbing: a guard that cannot see the brand is a guard that never fires -------------
// This is the case that nearly shipped. `.env` is read by readDotEnv and NEVER exported into the
// environment, so process.env.NETZSPEC_BRAND is undefined in every process this repo starts. The
// first version of the guard read it from there and would have been permanently inert — in the very
// code whose job is to make a guard real.
// NO .env IS COULD-NOT-RUN, NOT A FAILURE (27 Sep 2026). T11 and T13 are about THIS WORKTREE's .env --
// which brand it declares and which database that brand owns -- so they are per-machine by construction.
// CI has no .env, loadEnv() threw at src/config.ts, and the WHOLE FILE died on an uncaught error: D1-D5,
// which parse a Python file that IS in git and would have run fine, never executed either. That made this
// one of four suites keeping CI's pure job permanently red, which kept the database job (needs: pure) from
// ever running. Now the worktree half reports NOT EXERCISED (exit 2) and the drift half still runs.
const couldNotRun: string[] = [];
let env: ReturnType<typeof loadEnv> | null = null;
// THE DISCRIMINATOR IS THE FILE, NOT WHETHER loadEnv HAPPENS TO THROW. T11 and T13 ask what THIS
// WORKTREE'S .env declares, so the only thing that makes them unjudgeable is that file being absent.
// Catching the throw alone was not enough and the db job proved it within the hour: that job sets
// DATABASE_URL in the environment, so loadEnv() succeeded with no .env at all, T11 and T13 ran anyway
// and failed on an undefined NETZSPEC_BRAND -- an input PARTIALLY present read as an input present.
const envFile = path.join(ROOT, ".env");
if (!fs.existsSync(envFile)) {
  couldNotRun.push("no .env in this tree, so the worktree half (T11, T13) proved NOTHING: which brand "
    + "this tree declares and which database that brand owns are per-worktree facts with no answer here");
} else {
  try {
    env = loadEnv();
  } catch (err) {
    // The file EXISTS and could not be read: that is unusable, not absent, so it is a failure.
    check("T11", `this tree has a .env but loadEnv() could not read it: `
      + `${err instanceof Error ? err.message : String(err)}`, false);
  }
}
if (env) {
check("T11", "the brand actually REACHES the guard: loadEnv() carries NETZSPEC_BRAND from this "
           + "worktree's .env, which process.env does not",
  typeof env.NETZSPEC_BRAND === "string" && env.NETZSPEC_BRAND.length > 0,
  `loadEnv=${JSON.stringify(env.NETZSPEC_BRAND)} process.env=${JSON.stringify(process.env.NETZSPEC_BRAND)}`);
}
check("T12", "SABOTAGE currentBrand() reads an explicit environment when given one, and returns "
           + "null rather than a plausible default when nothing declares a brand",
  currentBrand({ NETZSPEC_BRAND: "hpe" }) === "hpe" && currentBrand({}) === null);
if (env) {
const e = env;
check("T13", "this worktree's .env points at the database this worktree's brand OWNS — the state "
           + "that was NOT true on 5 Sep 2026, when all four trees shared netzspec_test5",
  !!e.NETZSPEC_BRAND && databaseName(e.DATABASE_URL_TEST ?? "") === BRAND_TEST_DB[e.NETZSPEC_BRAND],
  `${e.NETZSPEC_BRAND} -> ${databaseName(e.DATABASE_URL_TEST ?? "")}, owns ${BRAND_TEST_DB[e.NETZSPEC_BRAND ?? ""]}`);
}

// ---- DRIFT: the two language copies must agree ----------------------------------------------
// Adding a brand in one language and not the other must be a RED SUITE, not a silent hole. Parsed
// from the Python source rather than imported, because that is the only thing TypeScript can read.
const py = fs.readFileSync(path.join(ROOT, "scraper", "brands", "ownership.py"), "utf8");
const pyBrands: Record<string, string> = {};
for (const m of py.matchAll(/^\s{4}"([a-z0-9_-]+)":\s*\{\s*$/gm)) {
  const after = py.slice(m.index ?? 0);
  const db = /"test_db":\s*"([^"]+)"/.exec(after.slice(0, 400));
  if (db) pyBrands[m[1]] = db[1];
}
const pyUnowned = (/UNOWNED_TEST_DATABASES\s*=\s*\(([^)]*)\)/.exec(py)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);

check("D1", `the Python table was actually PARSED (${Object.keys(pyBrands).length} brands) — a drift `
          + "check that reads nothing agrees with everything",
  Object.keys(pyBrands).length >= 3, JSON.stringify(pyBrands));
check("D2", "DRIFT: both languages know the same brands",
  JSON.stringify(Object.keys(pyBrands).sort()) === JSON.stringify(Object.keys(BRAND_TEST_DB).sort()),
  `py=${Object.keys(pyBrands).sort()} ts=${Object.keys(BRAND_TEST_DB).sort()}`);
check("D3", "DRIFT: every brand is given the SAME database in both — a mismatch here points two "
          + "guards at different databases and neither of them fires",
  Object.keys(pyBrands).every((b) => pyBrands[b] === BRAND_TEST_DB[b]),
  `py=${JSON.stringify(pyBrands)} ts=${JSON.stringify(BRAND_TEST_DB)}`);
check("D4", "DRIFT: both know the same UNOWNED databases",
  JSON.stringify([...pyUnowned].sort()) === JSON.stringify([...UNOWNED_TEST_DATABASES].sort()),
  `py=${pyUnowned} ts=${UNOWNED_TEST_DATABASES}`);
check("D5", "SABOTAGE the drift check can FAIL: an invented brand present in only one table is "
          + "caught, so D2 cannot pass by comparing two empty sets",
  JSON.stringify(Object.keys({ ...pyBrands, nz_only_in_python: "x" }).sort())
    !== JSON.stringify(Object.keys(BRAND_TEST_DB).sort()));

console.log(`\n${pass} passed, ${miss} missed` + (couldNotRun.length ? `, ${couldNotRun.length} NOT EXERCISED` : ""));
for (const m of couldNotRun) console.log(`  NOT EXERCISED  ${m}`);
// A real miss outranks an absent input, so could-not-run can never hide a defect.
process.exit(miss ? 1 : couldNotRun.length ? 2 : 0);
