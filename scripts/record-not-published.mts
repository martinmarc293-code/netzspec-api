// scripts/record-not-published.mts — record that Cisco does not publish a cup for a part: a gap_confirmed row (writeGapConfirmed),
// with every source that was checked written into the run (reviewer, 6 Oct 2026 ~19:10 and ~21:20 FLAG 3).
//
//     npx tsx scripts/record-not-published.mts --sku ISR4461/K9 --key weight --source <url> [--source <url> ...] --why "<text>" [--commit]
//
// The ruling for the ISR 4461 weight, verbatim (~19:10): "If it has no weight for the 4461, record it not published with the three
// sources checked (datasheet HTML, datasheet PDF, guide Overview + Preinstallation) as the reason; the shipping class then carries
// it, and it waits honestly." FLAG 3 (~21:20): "record 'not published' with the four sources."
//
// GATE: every named source must be readable from the cache (a source that cannot be read was not checked), the part must exist once
// and live, and writeGapConfirmed refuses over a value or a held conflict -- a gap is never written over something the part holds.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx } from "../src/store/index.js";
import { writeGapConfirmed } from "../src/store/facts.js";
import { CACHE_DIR } from "../src/pipeline/apply-acquired.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const one = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const all = (k: string) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const sku = one("--sku"), key = one("--key"), why = one("--why"), sources = all("--source"), commit = argv.includes("--commit");
if (!sku || !key || !why || !sources.length) { console.error("usage: --sku S --key K --source URL [--source URL ...] --why TEXT [--commit]"); process.exit(2); }
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const cached = (u: string) => {
  const h = createHash("sha1").update(u).digest("hex");
  return [".html", ".bin"].map((ext) => path.join(CACHE, h + ext)).find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) ?? null;
};
const checked = sources.map((u) => ({ url: u, cache: cached(u) }));
const unreadable = checked.filter((c) => !c.cache);
const db = getPool();
const parts = (await db.query<{ id: number }>(`SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id
  WHERE v.slug = 'cisco' AND p.sku = $1 AND p.retired_at IS NULL`, [sku])).rows;
const gate = { method: "every named source readable from the cache; the part live and unique; writeGapConfirmed refuses over a value",
  sampled: sources.length, checked: sources.length - unreadable.length, unreadable: unreadable.length,
  precision: parts.length === 1 ? 1 : 0, recall: sources.length ? (sources.length - unreadable.length) / sources.length : 0,
  passed: parts.length === 1 && unreadable.length === 0 };
console.log(`record-not-published ${sku} ${key}: ${sources.length} sources (${unreadable.length} unreadable), live parts ${parts.length}; gate ${JSON.stringify(gate)}`);
for (const c of checked) console.log(`  ${c.cache ? "read " : "MISS "} ${c.url}`);
if (!gate.passed) { console.error("GATE FAILED, nothing written"); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("record-not-published", { sku, key, why, sources,
  approved: "reviewer 6 Oct 2026 ~19:10: record it not published with the sources checked as the reason; ~21:20 FLAG 3: record 'not published' with the four sources" },
  async (runId) => withTx(async (client) => {
    const r = await writeGapConfirmed(client, parts[0].id, key, runId);
    return { stats: { action: r.action, fact_id: r.factId }, gate };
  }), { gitSha });
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}`);
await closePool();
