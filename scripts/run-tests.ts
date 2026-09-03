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
    if (e.isDirectory()) { if (e.name === "db" && !withDb) continue; out.push(...collect(p)); }
    else if (/\.test\.(ts|mjs|js)$/.test(e.name) || /^test-.*\.(ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

const files = collect(path.join(root, "tests")).filter((f) => only.length === 0 || only.some((o) => f.includes(o)));
if (files.length === 0) { console.error("no test files found"); process.exit(1); }

const tsx = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let failed = 0;
for (const f of files) {
  const rel = path.relative(root, f);
  const r = spawnSync(tsx, [f], { cwd: root, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  const ok = r.status === 0;
  if (!ok) failed++;
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(ok ? -1 : -25).join("\n    ");
  console.log(`${ok ? "PASS" : "FAIL"}  ${rel}\n    ${tail}`);
}
console.log(`\n${files.length - failed}/${files.length} suites passed`);
if (failed) process.exit(1);
