// scripts/run-tests.ts — runs every test file under tests/ as its own process and fails if any
// fails. Deliberately plain: each suite prints its own pass/miss lines and exits non-zero on a
// miss, which is the convention every existing suite already follows. A runner that swallowed
// exit codes would turn "12 misses" into "all checks passed" (CLAUDE.md §3).
//
//   npm test           pure suites only (no database)
//   npm run test:db    also the suites in tests/db/, which need DATABASE_URL
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withDb = process.argv.includes("--db");
const only = process.argv.filter((a) => !a.startsWith("--")).slice(2);

function collect(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (/\.test\.(ts|mjs|js)$/.test(e.name) || /^test-.*\.(ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

// COUNT WHAT WAS NOT RUN, AND SAY SO (16 Sep 2026). `collect` used to skip the db/ directory silently, so `npm test` ended on
// "66/71 suites passed" — a number a reader takes for the whole picture while TWENTY-TWO database suites had not been run at
// all. The real denominator is 93, so the headline was hiding nearly a quarter of the suite. (I wrote "seventeen" here from
// memory before running it; the count is printed from the files themselves for the same reason.)
// That is this repo's own rule turned on itself: *count what you could not check as its own number and put it in the output,
// never folded into either*. Five of those suites were found rotted on 16 Sep, red for days, precisely because nothing ran them
// and nothing said they were missing. The split itself is right — they need DATABASE_URL and a tunnel — so the fix is not to
// merge them but to make their absence impossible to read past.
const dbDir = `${path.sep}db${path.sep}`;
const everything = collect(path.join(root, "tests"));
const notRun = withDb ? [] : everything.filter((f) => f.includes(dbDir));
const files = everything.filter((f) => !notRun.includes(f)).filter((f) => only.length === 0 || only.some((o) => f.includes(o)));
if (files.length === 0) { console.error("no test files found"); process.exit(1); }

const tsx = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
// EXIT 2 MEANS "I COULD NOT RUN", AND UNTIL NOW NOTHING READ IT (27 Sep 2026).
//
// Several suites already exit 2 to say their INPUT is absent -- a label inventory under runs/vocab, a
// runs/ tree, a .env -- rather than that anything is wrong with the code. This runner tested status === 0,
// so exit 1 and exit 2 were identical to it, and those suites were reported FAILED on every run. The cost
// was not hypothetical: CI pure has been red on EVERY push, 4 suites of 77, none naming a code defect --
// and because the database job declares needs: pure, the 21 DB suites have never executed in CI once. A
// permanently red gate gates nothing, and a real red inside it is invisible.
//
// Could-not-run is now its own count, printed and never folded into either side. What stops it becoming
// the new silent pass: it is LOUD (its own line, each suite named), and a suite may exit 2 ONLY when its
// input is genuinely ABSENT -- an input that exists and is unusable is a failure, decided in the suite,
// next to the file it reads.
let failed = 0;
const notExercised: string[] = [];
for (const f of files) {
  const rel = path.relative(root, f);
  const r = spawnSync(tsx, [f], { cwd: root, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  const ok = r.status === 0;
  const could = r.status === 2;
  if (!ok && !could) failed++;
  if (could) notExercised.push(rel);
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(ok ? -1 : -25).join("\n    ");
  console.log(`${ok ? "PASS" : could ? "----" : "FAIL"}  ${rel}\n    ${tail}`);
}
console.log(`\n${files.length - failed - notExercised.length}/${files.length} suites passed`
  + (notExercised.length ? `, ${notExercised.length} NOT EXERCISED (input absent, not a defect)` : "")
  + (failed ? `, ${failed} FAILED` : ""));
if (notExercised.length)
  console.log(`NOT EXERCISED - these could not reach an input and proved NOTHING; they are not passes:\n    `
    + notExercised.join("\n    "));
// the omission gets its own line, always, and names the command that closes it — a total that hides a whole category of
// suites is the shape that let five of them rot unnoticed
if (notRun.length)
  console.log(`${notRun.length} DATABASE suites were NOT RUN by this command (they need DATABASE_URL): ${notRun.map((f) => path.basename(f)).join(", ")}\n` +
    `  run them with:  npm run test:db`);
if (failed) process.exit(1);
