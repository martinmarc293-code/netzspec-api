// src/core/brandOwnership.ts — which brand may touch which test database, on the TypeScript side.
//
// WHY THIS EXISTS AT ALL, and why it is a SECOND copy of a table that already exists.
//
// scraper/brands/ownership.py has been the machine-readable statement of brand ownership since
// 5 Sep 2026, and `assert_owns_database` turns it into a refusal. But it is a PYTHON guard, and the
// suites that actually destroy data are TypeScript: 17 files under tests/db/ issue TRUNCATE. On the
// TypeScript side the only check was `resolveDatabaseUrl`'s name pattern — /_test\d*$/ — which
// accepts netzspec_test2, _test3, _test4 and _test5 equally, for every brand. So the guard
// protected the half of the codebase that could not do the damage.
//
// That was not theoretical. On 5 Sep 2026 all four worktrees had DATABASE_URL_TEST pointing at
// netzspec_test5 — the database ownership.py itself lists as UNOWNED, with the comment "no lock
// protects it, which is the state that cost the afternoon" — while test2, test3 and test4 sat
// idle. Two suites on one database truncate each other's rows mid-run and each reports its own
// cases as broken; that cost hours once already and produced 24 failures that had nothing to do
// with any code.
//
// A SECOND COPY, DELIBERATELY, WITH A CHECK THAT CATCHES DRIFT. The single-source rule is the right
// one and it cannot be applied here: Python cannot import a TypeScript constant and TypeScript
// cannot import a Python dict, and the alternative — parsing ownership.py from TypeScript at
// startup — puts a regex between every test run and its database. So this follows the project's own
// documented fallback for exactly this case: keep the copies and add something that FAILS when they
// disagree. tests/brandOwnership.test.ts reads scraper/brands/ownership.py and refuses to pass if
// one table knows a brand, a database or an unowned name the other does not. Adding a brand in one
// language and not the other is a red suite, not a silent hole.

/** brand -> the ONE test database it may use. Mirrors OWNERSHIP in scraper/brands/ownership.py. */
export const BRAND_TEST_DB: Readonly<Record<string, string>> = {
  cisco: "netzspec_test4",
  hpe: "netzspec_test2",
  juniper: "netzspec_test3",
};

/** Databases no brand owns. "Free" means "no lock protects it" — a brand suite must never use one. */
export const UNOWNED_TEST_DATABASES: readonly string[] = ["netzspec_test", "netzspec_test5"];

/** The database a connection string points at, or "" when it names none. */
export function databaseName(url: string): string {
  const m = /\/([^/?]+)(?:\?|$)/.exec(url || "");
  return m ? m[1] : "";
}

/** The brand this process is running as, from NETZSPEC_BRAND, or null when it does not say. */
export function currentBrand(env: Record<string, string | undefined> = process.env): string | null {
  const b = (env.NETZSPEC_BRAND || "").trim().toLowerCase();
  return b || null;
}

/**
 * Refuse a test database this brand does not own, BY NAME, before a single row is touched.
 *
 * Named refusal on purpose, and the wording mirrors the Python guard so an operator who has seen
 * one recognises the other. The failure this prevents does not look like a failure: the other
 * session's TRUNCATE simply removes rows mid-run and the suite reports its own cases as broken.
 *
 * A process that does not declare NETZSPEC_BRAND is NOT refused — the main checkout legitimately
 * runs one-off work against an unowned database, and refusing it would make this guard something
 * people switch off. Declaring a brand is what opts a tree into the protection, and every brand
 * worktree declares one.
 */
export function assertOwnsDatabase(brand: string | null, url: string): void {
  if (!brand) return;
  const want = BRAND_TEST_DB[brand];
  const got = databaseName(url);
  if (!want) {
    throw new Error(
      `REFUSED: NETZSPEC_BRAND is "${brand}", which has no ownership entry. Known brands: ` +
      `${Object.keys(BRAND_TEST_DB).sort().join(", ")}. Add it to BRAND_TEST_DB in ` +
      `src/core/brandOwnership.ts AND to OWNERSHIP in scraper/brands/ownership.py — the drift ` +
      `check refuses to pass while only one of them knows a brand.`);
  }
  if (got === want) return;
  const other = Object.keys(BRAND_TEST_DB).find((b) => BRAND_TEST_DB[b] === got);
  if (other) {
    throw new Error(
      `REFUSED: ${brand} may not use ${got} — it belongs to the ${other} brand. ${brand} owns ` +
      `${want}. Two suites on one test database truncate each other's rows mid-run and report ` +
      `failures that have nothing to do with the code (5 Sep 2026).`);
  }
  if (UNOWNED_TEST_DATABASES.includes(got)) {
    throw new Error(
      `REFUSED: ${brand} owns ${want}, but DATABASE_URL_TEST names ${got}. Unowned databases ` +
      `(${UNOWNED_TEST_DATABASES.join(", ")}) have no lock protecting them and must not be used ` +
      `by a brand suite — every worktree shared ${got} on 5 Sep 2026 while three owned databases ` +
      `sat idle.`);
  }
  throw new Error(
    `REFUSED: ${brand} owns ${want}, but DATABASE_URL_TEST names ${got || "(none)"}.`);
}
