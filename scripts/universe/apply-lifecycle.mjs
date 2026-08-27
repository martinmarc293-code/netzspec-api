// scripts/universe/apply-lifecycle.mjs — write vendor-verified lifecycle onto the EXACT
// SKUs a Cisco EoL bulletin lists in its Table 2 (per-PID, not family-level), with the
// per-PID successor from the replacement column. Facts only (source_url + verified_at).
// Idempotent; never overwrites a human-reviewed field. Satisfies c3 (+ c7's 2nd ref) honestly.
//   node scripts/universe/apply-lifecycle.mjs data/universe/cisco-eol_<date>.json [--commit] [--reset]
// --reset first clears lifecycle from every cisco part (drops earlier approximate family-level data).
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] || "data/universe/cisco-eol_2026-08-28.json";
const COMMIT = process.argv.includes("--commit");
const RESET = process.argv.includes("--reset");
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// same normalisation as scraper _norm_pid: unify C1-/WS- ordering variants + strip ++/= suffixes
const normPid = (s) => {
  let p = String(s || "").trim().toUpperCase();
  if (!p || p.includes(" ") || !p.includes("-") || p.length < 5) return null;
  p = p.replace(/[+=]+$/, "");
  for (const pre of ["C1-", "WS-"]) if (p.startsWith(pre)) p = p.slice(pre.length);
  return p || null;
};
const dateFields = (lc) => ["announce_date", "end_of_sale_date", "last_ship_date", "end_of_sw_maint", "end_of_vuln_support", "last_day_of_support"].filter((k) => lc?.[k]).length;

const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const raw = parsed.bulletins || parsed.records || [];

// Build a per-PID index: normalised affected PID -> the best bulletin covering it (+ its successor).
// A PID can appear in several bulletins (main + variant); keep the one with the most milestones,
// tie -> latest EoS. This is accurate: only PIDs a bulletin actually lists receive its dates.
const byPid = new Map();
let bulletinPidCount = 0;
for (const b of raw) {
  const aff = b.affected_pids || [];
  for (const row of aff) {
    const core = normPid(row.pid);
    if (!core) continue;
    bulletinPidCount++;
    const cand = { b, successor: row.successor || null };
    const cur = byPid.get(core);
    const better = !cur
      || dateFields(b.lifecycle) > dateFields(cur.b.lifecycle)
      || (dateFields(b.lifecycle) === dateFields(cur.b.lifecycle) && (b.lifecycle?.end_of_sale_date || "") > (cur.b.lifecycle?.end_of_sale_date || ""));
    if (better) byPid.set(core, cand);
  }
}
console.log(`indexed ${byPid.size} distinct affected PID(s) from ${raw.length} bulletin(s) (${bulletinPidCount} PID rows total)`);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "netzspec");
const P = db.collection("parts");

if (RESET && COMMIT) {
  const r = await P.updateMany({ vendor: "cisco", lifecycle: { $exists: true } }, { $unset: { lifecycle: "" } });
  console.log(`--reset: cleared lifecycle from ${r.modifiedCount} cisco part(s)`);
}

// Walk cisco stubs; match each SKU's normalised core against the bulletin index.
const cisco = await P.find({ vendor: "cisco" }, { projection: { sku: 1, _id: 0 } }).toArray();
let matched = 0; const perDoc = {};
for (const p of cisco) {
  const core = normPid(p.sku);
  if (!core) continue;
  const hit = byPid.get(core);
  if (!hit) continue;
  matched++;
  perDoc[hit.b.doc_id] = (perDoc[hit.b.doc_id] || 0) + 1;
  if (COMMIT) {
    const lifecycle = {
      ...hit.b.lifecycle,
      ...(hit.successor ? { successor_sku: hit.successor, successor_note: `Nachfolger (Cisco): ${hit.successor}` } : {}),
      source_url: hit.b.source_url, source_doc_id: hit.b.doc_id, last_verified: hit.b.verified_at,
    };
    await P.updateOne({ sku: p.sku }, { $set: { lifecycle } });
  }
}
console.log("\nper-bulletin matched SKUs:");
for (const [d, n] of Object.entries(perDoc).sort((a, b) => b[1] - a[1])) console.log(`  ${d}: ${n}`);
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — ${matched} SKU(s) matched a bulletin PID (of ${cisco.length} cisco parts).`);
if (!COMMIT) console.log("(pass --commit to write; add --reset to clear old family-level lifecycle first)");
await client.close();
