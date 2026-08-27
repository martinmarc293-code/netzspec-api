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

// Normalise a Cisco PID to a hardware core so bulletin coding (WS3850-24P/K9) and netzspec
// coding (WS-C3850-24P-E) unify. SAFE strips only: software/spare packaging (/K9, ++, =),
// vendor/ordering prefix (WS-C/WSC/WS/C1-, bare leading C), and a trailing HYPHENATED license
// grade (-E/-S/-L/-A). Port-type letters (…-12S, …-48U) are kept — no lossy concatenated strip,
// so 3850-12S never false-merges with a different port config.
const normPid = (s) => {
  let p = String(s || "").trim().toUpperCase();
  if (!p || p.includes(" ") || p.length < 5) return null;
  p = p.replace(/\/K9(\+\+)?$/, "").replace(/[+=]+$/, "");
  p = p.replace(/^(WS-C|WSC|WS-|WS|C1-)/, "");
  p = p.replace(/^C(?=\d)/, "");
  p = p.replace(/-([ESLA])$/, "");
  if (!p.includes("-") || !/\d{3,4}/.test(p) || p.length < 5) return null;
  return p;
};
const dateFields = (lc) => ["announce_date", "end_of_sale_date", "last_ship_date", "end_of_sw_maint", "end_of_vuln_support", "last_day_of_support"].filter((k) => lc?.[k]).length;

const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const raw = parsed.bulletins || parsed.records || [];

// Build a per-PID index: normalised affected PID -> the best bulletin covering it (+ its successor).
// A PID can appear in several bulletins (main + variant); keep the one with the most milestones,
// tie -> latest EoS. This is accurate: only PIDs a bulletin actually lists receive its dates.
const byPid = new Map();
// milestone DATES are per-bulletin (match by core); the SUCCESSOR is per-PID (grade-specific), so
// also index successors by a grade-PRESERVING key so a -S switch gets its -S successor, not the -E one.
const normFull = (s) => {
  let p = String(s || "").trim().toUpperCase();
  if (!p || p.includes(" ") || p.length < 5) return null;
  p = p.replace(/\/K9(\+\+)?$/, "").replace(/[+=]+$/, "");
  p = p.replace(/^(WS-C|WSC|WS-|WS|C1-)/, "");
  p = p.replace(/^C(?=\d)/, "");
  return p.includes("-") && /\d{3,4}/.test(p) ? p : null;
};
const succByFull = new Map();   // grade key -> successor (only when the bulletin gives one)
const presentFull = new Set();  // every grade key the bulletin lists (even with a BLANK successor)
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
    const full = normFull(row.pid);
    if (full) { presentFull.add(full); if (row.successor && !succByFull.has(full)) succByFull.set(full, row.successor); }
  }
}
// successor precedence: exact grade successor > explicitly-listed-blank (honor ∅) > core-level fallback
const resolveSuccessor = (sku, coreSucc) => {
  const full = normFull(sku);
  if (full && succByFull.has(full)) return succByFull.get(full);
  if (full && presentFull.has(full)) return null; // bulletin lists this PID with no successor
  return coreSucc;
};
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
  const successor = resolveSuccessor(p.sku, hit.successor);
  if (COMMIT) {
    const lifecycle = {
      ...hit.b.lifecycle,
      ...(successor ? { successor_sku: successor, successor_note: `Nachfolger (Cisco): ${successor}` } : {}),
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
