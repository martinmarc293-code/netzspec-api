// tests/buildLayersGuard.test.ts — a single-category layer WRITE is refused (the partial-rebuild trap that turned one_build
// red on 28 Sep 2026); the refusal happens before any store access, so this needs no database.
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };
const run = (args: string[]) => spawnSync("npx", ["tsx", "scripts/build-layers.mts", ...args],
  { cwd: REPO_ROOT, encoding: "utf8", shell: true, env: { ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" } });

const refused = run(["--vendor", "cisco", "--category", "storage-networking"]);
check("NEGATIVE a single-category write is refused, for the stated reason",
  refused.status === 2 && /one_build/.test(refused.stderr ?? ""), { status: refused.status, err: (refused.stderr ?? "").slice(0, 160) });
const allowed = run(["--vendor", "cisco", "--category", "storage-networking", "--dump"]);
check("--dump is not refused by the guard (it reads; the fake database then fails it for a different reason)",
  !/one_build/.test(allowed.stderr ?? ""), { status: allowed.status, err: (allowed.stderr ?? "").slice(0, 160) });

if (misses.length) { console.log(`build-layers guard: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`build-layers guard: ${pass} passed, 0 missed`);
