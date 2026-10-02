// tests/codeSha.test.ts — which commit a run records (src/store/runs.ts resolveCodeSha). 2 Oct 2026: runs 1469 and 1472, two
// approved retractions run on the box, recorded git_sha NULL -- the deployed tree has no .git and GIT_SHA was not in the
// environment, though deploy.sh writes it into every tree. The order is the caller's value, the environment, then that file; a
// value that is not a sha is never recorded (a guess is worse than a null, which at least says nobody knew).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodeSha } from "../src/store/runs.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++; else misses.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codesha-"));
const file = path.join(dir, "GIT_SHA");
fs.writeFileSync(file, "1b210b37f5dffa8b3e5ca6813d0dda069613446c\n");
const absent = path.join(dir, "absent");

check("the caller's sha wins", resolveCodeSha("625e6ed", { GIT_SHA: "8405b9c" }, file), "625e6ed");
check("no caller sha: the environment's", resolveCodeSha(undefined, { GIT_SHA: "8405b9c" }, file), "8405b9c");
check("SABOTAGE the box's case -- no caller sha, no env: the deploy tree's GIT_SHA file", resolveCodeSha(undefined, {}, file), "1b210b37f5dffa8b3e5ca6813d0dda069613446c");
check("nothing anywhere: null, never a guess", resolveCodeSha(undefined, {}, absent), null);
check("SABOTAGE a file that is not a sha is not recorded", (fs.writeFileSync(path.join(dir, "BAD"), "unknown\n"), resolveCodeSha(undefined, {}, path.join(dir, "BAD"))), null);
check("an empty caller value falls through", resolveCodeSha("", {}, file), "1b210b37f5dffa8b3e5ca6813d0dda069613446c");
fs.rmSync(dir, { recursive: true, force: true });

const TOTAL = 6;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} code-sha cases passed`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} code-sha cases passed`);
