/**
 * Record who holds an API key and how it is used. Dry run by default; --commit writes.
 *
 *     npx tsx scripts/backfill-key-holders.mts [--commit]
 *
 * NO KEY MATERIAL IS READ OR WRITTEN. The query selects id, name, scopes and timestamps; `key_hash` is never
 * in a projection, because a hash or even a prefix in a transcript is a credential in a transcript.
 *
 * ONLY WHAT EVIDENCE SUPPORTS, and blankness is the point. `keys_hygiene` reports keys "active with no
 * recorded holder", and until 0029 there was nowhere to put one — "who" was carried by the NAME, which is
 * free text and is duplicated: ids 1 and 3 are both `netzspec` and only 3 has been used since 3 September.
 * A rotation reading the name cannot tell them apart, and this catalogue has already had a rotation revoke a
 * row nobody held while the exposed key stayed live.
 *
 * So two rows are filled and two are deliberately left NULL:
 *
 *   id  3  netzspec              last used TODAY   -> the live site key
 *   id 16  reviewer-2026-09-27   created by the reviewer for its own reads
 *   id  1  netzspec              last used 3 Sep, 25 days ago  -> LEFT BLANK
 *   id  6  claude-web            never used since the day it was made, its two same-named siblings revoked
 *                                that same day                 -> LEFT BLANK
 *
 * Blank is the finding. Guessing a holder for 1 and 6 would make them look attributable and take them off
 * the revoke-candidate list, which is the opposite of what is wanted: they are candidates precisely because
 * nobody can say who holds them.
 *
 * IT REVOKES NOTHING. Revocation is the operator's, on ids they can attribute, and it comes after this.
 */
import { getPool, closePool, withTx } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";

type Row = { id: number; name: string; last_used: string | null; holder: string | null; channel: string | null };

/** id -> (holder, channel), and ONLY where the evidence in the table supports it. */
const KNOWN: Record<number, { holder: string; channel: string; why: string }> = {
  3: { holder: "netzspec.com (the live site)", channel: "site",
       why: "the only `netzspec` key used since 3 Sep — last used today, continuously" },
  16: { holder: "the reviewer (claude.ai session e61ab913)", channel: "reviewer",
        why: "created 27 Sep for the reviewer's own reads and used the same day" },
};

const commit = process.argv.includes("--commit");
const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT id, name, last_used_at::date::text AS last_used, holder, channel
     FROM api_keys WHERE revoked_at IS NULL ORDER BY id`);

console.log(`active keys: ${rows.length}`);
const todo: Row[] = [];
for (const r of rows) {
  const k = KNOWN[r.id];
  const state = k ? (r.holder === k.holder && r.channel === k.channel ? "already recorded" : `-> ${k.holder} / ${k.channel}`)
                  : "LEFT BLANK — nobody can say who holds it, which is why it is a revoke candidate";
  console.log(`  id ${String(r.id).padStart(3)}  ${r.name.padEnd(22)} last used ${r.last_used ?? "NEVER"}   ${state}`);
  if (k && !(r.holder === k.holder && r.channel === k.channel)) todo.push(r);
}
// A SELECTOR THAT MATCHES NOTHING IS A BROKEN SELECTOR until proven otherwise: if both ids are already
// recorded this prints "nothing to do" and exits 0, but an id missing from the table entirely is a refusal.
const absent = Object.keys(KNOWN).map(Number).filter((id) => !rows.some((r) => r.id === id));
if (absent.length) {
  console.error(`REFUSED: ${absent.join(", ")} are not active keys in this database — the table and this list disagree, which is for a person to read`);
  await closePool(); process.exit(2);
}
if (!commit) {
  console.log(`\nDRY RUN — would fill ${todo.length} row(s). Re-run with --commit.`);
  await closePool(); process.exit(0);
}
if (!todo.length) { console.log("\nnothing to do — both rows already carry their holder and channel"); await closePool(); process.exit(0); }

const out = await withRun("apply-key-holders",
  { approved: "reviewer ruling 28 Sep 2026: holder + channel on 3 and 16 from evidence already held; 1 and 6 left blank, blank is the finding",
    filling: todo.map((r) => r.id), leaving_blank: rows.filter((r) => !KNOWN[r.id]).map((r) => r.id) },
  async () => {
    let n = 0;
    await withTx(async (c) => {
      for (const r of todo) {
        const k = KNOWN[r.id];
        const res = await c.query(`UPDATE api_keys SET holder = $2, channel = $3 WHERE id = $1 AND revoked_at IS NULL`, [r.id, k.holder, k.channel]);
        n += res.rowCount ?? 0;
      }
    });
    return { stats: { filled: n, offered: todo.length }, gate: { precision: 1, recall: 1, passed: true, checked: todo.length, sampled: todo.length } };
  });
console.log(`\nrun #${out.runId}: offered ${todo.length}, updated ${out.stats.filled}`);
await closePool();

// The control, from a NEW connection: exactly two active keys carry a holder, and they are 3 and 16.
const { Client } = await import("pg");
const fs = await import("node:fs");
const { REPO_ROOT } = await import("../src/config.js");
const env: Record<string, string> = {};
for (const line of fs.readFileSync(`${REPO_ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const v = new Client({ connectionString: env.DATABASE_URL, application_name: "netzspec/key-holders-verify/cisco" });
await v.connect();
const got = await v.query<{ id: number; holder: string | null; channel: string | null }>(
  `SELECT id, holder, channel FROM api_keys WHERE revoked_at IS NULL ORDER BY id`);
const filled = got.rows.filter((r) => r.holder !== null).map((r) => r.id);
const blank = got.rows.filter((r) => r.holder === null).map((r) => r.id);
console.log(`control — active keys WITH a holder: ${filled.join(", ")} (must be 3, 16); WITHOUT: ${blank.join(", ")} (must be 1, 6)`);
await v.end();
process.exit(JSON.stringify(filled) === "[3,16]" && JSON.stringify(blank) === "[1,6]" ? 0 : 2);
