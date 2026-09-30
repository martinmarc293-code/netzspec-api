// scripts/fill-report.mts — the FILL PIPELINE morning report (reviewer standing order, 30 Sep 2026), at most 40 lines.
//
//   npx tsx scripts/fill-report.mts --night <dir> --prev <ready-last.json> --since <ISO> --out <file.md> [--stopped "<step: reason>"]
//
// Reads what the night left in <dir> (acquire.json from the worker, ready.json from the jtl-readiness export, verifier.txt
// from the board) and the `runs` opened since <since>. Writes: ready per category today vs yesterday, the night's runs
// and gates, what the acquire fetched and what was not the document (by class), the board line, the top 5 blockers per
// category, and the five largest SOLE blockers (a part blocked by exactly one reason: the ready-gain order the day work
// takes). Exit 4 when the ready count FELL and no retraction was recorded tonight -- the order's stop condition -- so
// the night script can write its STOP file; the report says so on its first line either way.
import fs from "node:fs";
import { query, closePool } from "../src/store/db.js";
import { jtlReadiness } from "../src/api/queries/jtlExport.js";

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const night = arg("--night"), prevFile = arg("--prev"), since = arg("--since"), out = arg("--out"), stopped = arg("--stopped");
if (!night || !since || !out) { console.error("usage: --night <dir> --prev <file> --since <ISO> --out <file> [--stopped <why>]"); process.exit(2); }
const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

type Ready = { ready: number; scanned: number; by_category: Record<string, { parts: number; ready: number; reasons: Record<string, number> }> };
const today: Ready | null = readJson(`${night}/ready.json`);
const prev: Ready | null = prevFile ? readJson(prevFile) : null;
const acq = readJson(`${night}/acquire.json`);
const board = fs.existsSync(`${night}/verifier.txt`) ? fs.readFileSync(`${night}/verifier.txt`, "utf8") : "";

const L: string[] = [];
const runs = (await query<{ id: string; kind: string; status: string; gate: any; stats: any }>(
  "SELECT id::text, kind, status::text, gate, stats FROM runs WHERE started_at >= $1::timestamptz ORDER BY id", [since])).rows;
const retracted = runs.some((r) => /retract/.test(r.kind) && r.status === "succeeded");
let fell = false;
if (today && prev) fell = today.ready < prev.ready && !retracted;

const head = stopped ? `STOPPED at ${stopped}` : fell ? `STOP: ready fell ${prev!.ready} -> ${today!.ready} with no recorded retraction` : "COMPLETED";
L.push(`# FILL night ${since.slice(0, 10)} -- ${head}`, "");
if (today) {
  const d = prev ? today.ready - prev.ready : null;
  L.push(`ready ${prev ? `${prev.ready} -> ` : ""}${today.ready}${d !== null ? ` (${d >= 0 ? "+" : ""}${d})` : " (no previous snapshot)"} of ${today.scanned} scanned`);
} else L.push("ready: NOT MEASURED (no ready.json)");
if (acq) {
  const n = acq.night ?? {}, o = acq.outcomes ?? {}, b = acq.browser ?? {};
  const nd = Object.entries(n.not_document ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  L.push(`acquire: done ${acq.done}, failed ${acq.failed}, network fetches ${n.fetched ?? 0} (browser ${b.fetches ?? "?"}, cache hits ${b.cache_hits ?? "?"}), ` +
         `outcomes ${JSON.stringify(o)}; not the document: ${nd}; refused at enqueue ${JSON.stringify(acq.refused ?? {})}; ` +
         `stop: ${acq.stop_reason ?? "none"}${acq.budget_hit ? "; time budget reached" : ""}`);
} else L.push("acquire: no summary (the step did not run or did not finish)");
L.push("", "## runs tonight (kind, status, gate)");
for (const r of runs.slice(0, 12)) {
  const g = r.gate ? `gate ${r.gate.passed === false ? "FAILED" : "passed"}${r.gate.precision !== undefined ? ` p=${r.gate.precision}` : ""}` : "no gate";
  L.push(`- ${r.id} ${r.kind} ${r.status} ${g}`);
}
if (runs.length > 12) L.push(`- ... ${runs.length - 12} more (runs.started_at >= ${since})`);
if (!runs.length) L.push("- none");
const fl = board.match(/passed (\d+)\s+FAILED (\d+)/), failing = board.match(/failing: (.*)/);
L.push("", `board: ${fl ? `${fl[1]} passed / ${fl[2]} failed${failing ? ` (${failing[1].trim()})` : ""}` : "NOT RUN or unreadable"}`);
if (today) {
  L.push("", "## ready per category (today vs yesterday) and top 5 blockers (parts per reason)");
  const cats = Object.entries(today.by_category).sort((a, b) => b[1].parts - a[1].parts).slice(0, 12);
  for (const [cat, c] of cats) {
    const p = prev?.by_category?.[cat]?.ready;
    const top = Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k.replace(/^attribute:/, "")} ${v}`).join(" | ");
    L.push(`- ${cat}: ${p !== undefined ? `${p} -> ` : ""}${c.ready}/${c.parts} | ${top}`);
  }
  // SOLE blockers: the ready-gain order (a part blocked by exactly ONE reason becomes ready when that reason is fixed)
  const skus = (await query<{ sku: string }>(
    "SELECT p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'")).rows.map((r) => r.sku);
  const one = new Map<string, number>();
  for (let i = 0; i < skus.length; i += 2000) {
    const r = await jtlReadiness({ vendor: "cisco", skus: skus.slice(i, i + 2000) });
    for (const s of r.skus ?? []) { const rs = [...new Set(s.reasons)]; if (rs.length === 1) one.set(rs[0], (one.get(rs[0]) ?? 0) + 1); }
  }
  L.push("", "## largest sole blockers (parts that become ready when this one reason is fixed)");
  for (const [k, v] of [...one].sort((a, b) => b[1] - a[1]).slice(0, 5)) L.push(`- ${v} ${k}`);
}
const text = L.slice(0, 40).join("\n") + "\n";
fs.writeFileSync(out, text);
process.stdout.write(text);
await closePool();
process.exit(fell ? 4 : 0);
